const express = require('express');
const { Pool } = require('pg');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// Configure Postgres Connection
const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

// Configure new Gemini API SDK
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Helper: Ensure we have a user and conversation ID
async function ensureUserSession(req) {
  let { userId, conversationId } = req.body;
  if (!userId) {
    const userResult = await pool.query(`INSERT INTO users (persona_name) VALUES ('Session User') RETURNING id`);
    userId = userResult.rows[0].id;
  }
  if (!conversationId) {
    const convResult = await pool.query(`INSERT INTO conversations (user_id) VALUES ($1) RETURNING id`, [userId]);
    conversationId = convResult.rows[0].id;
  }
  return { userId, conversationId };
}

// 1. CHAT ENDPOINT
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const { userId, conversationId } = await ensureUserSession(req);

    // Save User Message
    const userMsgResult = await pool.query(
      `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3) RETURNING id`,
      [conversationId, 'user', message]
    );
    const userMessageId = userMsgResult.rows[0].id;

    // Retrieve Similar Memories for Context (Using pgvector)
    const promptEmbeddingRes = await ai.models.embedContent({
      model: 'gemini-embedding-001',
      contents: message,
      config: { outputDimensionality: 768 },
    });

    const promptEmbedding = promptEmbeddingRes.embeddings[0].values;
    // Format embedding as pgvector string: '[x, y, z...]'
    const embeddingStr = `[${promptEmbedding.join(',')}]`;

    // Query DB for top 5 closest memories
    const relevantMemories = await pool.query(
      `SELECT id, content, memory_type, category 
       FROM memories 
       WHERE user_id = $1 
       ORDER BY embedding <=> $2::vector 
       LIMIT 5`,
      [userId, embeddingStr]
    );

    // Log the telemetry
    await pool.query(
      `INSERT INTO queries_log (user_id, natural_query, search_embedding) VALUES ($1, $2, $3)`,
      [userId, message, embeddingStr]
    );

    // Format context for prompt
    let memoryContext = "You are Sam's personal assistant. Use the following facts to respond gracefully, but do not announce that you are reading from a memory bank. Just act naturally.\n\nMemories:\n";
    relevantMemories.rows.forEach(m => {
      memoryContext += `- ${m.content} (Type: ${m.memory_type}, Category: ${m.category})\n`;
    });

    const prompt = `${memoryContext}\nUser Prompt: ${message}`;

    // Call Gemini for the Chat response
    const chatResult = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt
    });
    const aiResponse = chatResult.text;

    // Save AI message
    await pool.query(
      `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
      [conversationId, 'ai', aiResponse]
    );

    // BACKGROUND: Trigger Memory Extraction Pipeline
    extractMemoriesAsync(message, userId, userMessageId).catch(console.error);

    res.json({
      userId,
      conversationId,
      response: aiResponse,
      memoriesUsed: relevantMemories.rows
    });
  } catch (err) {
    console.error("Error in /api/chat:", err);
    res.status(500).json({ error: "Failed to process chat" });
  }
});

// MEMORY EXTRACTION LOGIC
async function extractMemoriesAsync(userMessage, userId, messageId) {
  const extractionPrompt = `
    Analyze the following user message. We are building a memory profile for this user.
    Extract ANY explicit facts (Facts), preferences (Pref), or implicit behavioral traits/styles (Implicit).
    Return the result as a raw JSON array of objects (NO Markdown blocks, just the JSON array).
    Format: [{"content": "string fact/sentence", "type": "FACT|PREF|IMPLICIT", "category": "General|Travel|Hobby|Persona"}]
    If nothing is found, return [].
    Message: "${userMessage}"
    `;

  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: extractionPrompt
  });
  let rawJson = result.text.replace(/^```json/g, '').replace(/```$/g, '').trim();

  let extracted;
  try {
    extracted = JSON.parse(rawJson);
  } catch (e) {
    console.warn("Could not parse extracted JSON:", rawJson);
    return;
  }

  if (Array.isArray(extracted) && extracted.length > 0) {
    // Compute embeddings and save each to the DB
    for (const memory of extracted) {
      const embedRes = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: memory.content,
        config: { outputDimensionality: 768 },
      });
      const vectorData = `[${embedRes.embeddings[0].values.join(',')}]`;

      await pool.query(
        `INSERT INTO memories (user_id, content, memory_type, category, embedding, source_message_id)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, memory.content, memory.type.toUpperCase(), memory.category, vectorData, messageId]
      );
      console.log(`Saved new memory: ${memory.content}`);
    }
  }
}

// 2. FETCH ALL MEMORIES ENDPOINT (For the 3D Visualization)
app.get('/api/memories', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.json({ nodes: [], links: [] });

    // Fetch all memories for the user
    const result = await pool.query(
      `SELECT id, content, memory_type, category, embedding::text as vector 
             FROM memories WHERE user_id = $1`, [userId]
    );

    const nodes = result.rows.map(row => ({
      id: row.id,
      name: row.content,
      type: row.memory_type,
      category: row.category,
      // Keep the raw embedding to compute mock distances for clustering in UI if needed
      val: JSON.parse(row.vector)
    }));

    // We could dynamically compute distance edges in SQL, but to keep the tutorial simple, 
    // we'll pass the embeddings to the front end which handles spatial clustering via force-graph physics.
    // Or we can build some loose links server-side.
    const links = [];

    // Simple threshold clustering: link nodes that are semantically very similar
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const similarity = cosineSimilarity(nodes[i].val, nodes[j].val);
        if (similarity > 0.82) { // Cosine similarity threshold for displaying a line
          links.push({
            source: nodes[i].id,
            target: nodes[j].id,
            value: similarity
          });
        }
      }
    }

    // We don't actually need to send the massive vector arrays to the frontend once links are computed
    const cleanedNodes = nodes.map(n => {
      delete n.val;
      return n;
    });

    res.json({ nodes: cleanedNodes, links });
  } catch (err) {
    console.error("Error fetching memories:", err);
    res.status(500).json({ error: "Failed to fetch memories" });
  }
});

// Simple Cosine Similarity Function
function cosineSimilarity(A, B) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < A.length; i++) {
    dotProduct += A[i] * B[i];
    normA += A[i] * A[i];
    normB += B[i] * B[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

app.listen(port, () => {
  console.log(`Living Memory Demo Backend listening at http://localhost:${port}`);
});

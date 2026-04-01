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

const ai = new GoogleGenAI({ vertexai: true, });

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

    // Get user's persona name for the prompt
    const userResult = await pool.query(`SELECT persona_name FROM users WHERE id = $1`, [userId]);
    const personaName = userResult.rows[0]?.persona_name || 'User';

    // Format context for prompt
    let memoryContext = `You are ${personaName}'s personal assistant. Use the following facts to respond gracefully, but do not announce that you are reading from a memory bank. Just act naturally.\n\nMemories:\n`;
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

// 2. FETCH ALL MEMORIES ENDPOINT (For the 2D Visualization)
app.get('/api/memories', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.json({ nodes: [], links: [] });

    // Fetch all memories for the user
    const result = await pool.query(
      `SELECT id, content, memory_type, category, embedding::text as vector 
             FROM memories WHERE user_id = $1 ORDER BY id`, [userId]
    );

    const allFacts = result.rows;
    const uniqueEdges = {};
    const nodeConnectionCount = {};
    allFacts.forEach(row => {
      nodeConnectionCount[row.id] = 0;
    });

    // Query for similar facts using PGVector
    for (const row of allFacts) {
      const neighborsQuery = await pool.query(`
        SELECT id, 1 - (embedding <=> $1) as similarity
        FROM memories
        WHERE id != $2 AND user_id = $3
        ORDER BY embedding <=> $1 ASC
        LIMIT 6
      `, [row.vector, row.id, userId]);

      for (const neighbor of neighborsQuery.rows) {
        if (neighbor.similarity > 0.70) {
          // Sort IDs so a->b and b->a are the same edge key
          const edgeKeyPair = [row.id, neighbor.id].sort((a, b) => a - b).join('-');

          if (!uniqueEdges[edgeKeyPair]) {
            const thickness = Math.pow(neighbor.similarity, 3) * 50;
            uniqueEdges[edgeKeyPair] = {
              source: row.id,
              target: neighbor.id,
              value: thickness,
              similarity: neighbor.similarity
            };
            nodeConnectionCount[row.id] += 1;
            nodeConnectionCount[neighbor.id] += 1;
          }
        }
      }
    }

    const links = Object.values(uniqueEdges);

    const nodes = allFacts.map(row => {
      const count = nodeConnectionCount[row.id] || 0;
      return {
        id: row.id,
        name: row.content,
        type: row.memory_type,
        category: row.category,
        size: 10 + (count * 4) // dynamic sizing based on connections
      };
    });

    res.json({ nodes, links });
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

// CREATE A NEW USER
app.post('/api/users', async (req, res) => {
  try {
    const { persona_name } = req.body;
    if (!persona_name) return res.status(400).json({ error: "Missing persona_name" });

    const result = await pool.query(
      `INSERT INTO users (persona_name) VALUES ($1) RETURNING *`,
      [persona_name]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error creating user:", err);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// FETCH ALL USERS
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM users ORDER BY created_at DESC`);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// FETCH CONVERSATIONS FOR USER
app.get('/api/conversations/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      `SELECT * FROM conversations WHERE user_id = $1 ORDER BY started_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching conversations:", err);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// FETCH MESSAGES FOR CONVERSATION
app.get('/api/messages/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const result = await pool.query(
      `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching messages:", err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// SEED DEMO USER & MEMORIES
app.post('/api/seed', async (req, res) => {
  try {
    // 1. Create Demo User
    const userResult = await pool.query(
      `INSERT INTO users (persona_name) VALUES ('Demo User') RETURNING id`
    );
    const userId = userResult.rows[0].id;

    // 2. Create Initial Conversation
    const convResult = await pool.query(
      `INSERT INTO conversations (user_id) VALUES ($1) RETURNING id`,
      [userId]
    );
    const conversationId = convResult.rows[0].id;

    // 3. Example Memories to Seed
    const seedMemories = [
      { content: "User works as a software engineer at a startup.", type: "FACT", category: "Career" },
      { content: "User prefers dark mode for all their applications.", type: "PREF", category: "General" },
      { content: "User speaks enthusiastically about artificial intelligence.", type: "IMPLICIT", category: "Persona" },
      { content: "User drinks 3 cups of coffee every morning.", type: "FACT", category: "Habit" },
      { content: "User enjoys hiking in the Pacific Northwest.", type: "FACT", category: "Hobby" },
      { content: "User dislikes crowded tourist traps.", type: "PREF", category: "Travel" },
      { content: "User writes concise, action-oriented messages.", type: "IMPLICIT", category: "Communication" },
      { content: "User owns a 3-year-old golden retriever named Max.", type: "FACT", category: "Pets" },
      { content: "User wants to learn Rust programming in the next 6 months.", type: "PREF", category: "Learning" },
      { content: "User uses highly technical vocabulary casually.", type: "IMPLICIT", category: "Communication" },
      { content: "User is allergic to peanuts.", type: "FACT", category: "Health" },
      { content: "User prefers MacOS over Windows.", type: "PREF", category: "Technology" },
      { content: "User tends to ask follow-up questions.", type: "IMPLICIT", category: "Persona" },
      { content: "User visited Japan twice in 2023.", type: "FACT", category: "Travel" },
      { content: "User loves authentic ramen but hates sushi.", type: "PREF", category: "Food" },
      { content: "User values efficiency and quick responses.", type: "IMPLICIT", category: "Persona" },
      { content: "User plays electric guitar.", type: "FACT", category: "Hobby" },
      { content: "User mostly listens to classic rock and synthwave.", type: "PREF", category: "Music" },
      { content: "User exhibits a dry sense of humor.", type: "IMPLICIT", category: "Persona" },
      { content: "User bought a new home in Seattle last year.", type: "FACT", category: "Life" },
      { content: "User avoids taking morning meetings when possible.", type: "PREF", category: "Career" },
      { content: "User frequently expresses gratitude.", type: "IMPLICIT", category: "Behavior" },
      { content: "User ran a half-marathon in under 2 hours.", type: "FACT", category: "Health" },
      { content: "User prefers sci-fi over fantasy books.", type: "PREF", category: "Entertainment" },
      { content: "User tends to be skeptical of marketing claims.", type: "IMPLICIT", category: "Persona" },
    ];

    // Create a dummy message to tie the memories to
    const msgResult = await pool.query(
      `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3) RETURNING id`,
      [conversationId, 'user', "Hello, I am the demo user."]
    );
    const messageId = msgResult.rows[0].id;

    // 4. Compute embeddings and insert them into DB
    const insertPromises = seedMemories.map(async (memory) => {
      const embedRes = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: memory.content,
        config: { outputDimensionality: 768 },
      });
      const vectorData = `[${embedRes.embeddings[0].values.join(',')}]`;

      return pool.query(
        `INSERT INTO memories (user_id, content, memory_type, category, embedding, source_message_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, memory.content, memory.type.toUpperCase(), memory.category, vectorData, messageId]
      );
    });

    await Promise.all(insertPromises);

    res.json({ message: "Seed successful", userId, conversationId, memoryCount: seedMemories.length });
  } catch (err) {
    console.error("Error during seed:", err);
    res.status(500).json({ error: "Seed failed" });
  }
});

app.listen(port, () => {
  console.log(`Living Memory Demo Backend listening at http://localhost:${port}`);
});

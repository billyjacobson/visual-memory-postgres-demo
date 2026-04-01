require('dotenv').config();
const { Pool } = require('pg');
const { GoogleGenAI } = require('@google/genai');

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

const ai = new GoogleGenAI({ vertexai: true, });

const demoUsers = [
  {
    name: 'Sarah - The Artist',
    facts: [
      { content: "User is a 28-year-old freelance illustrator living in Brooklyn.", type: "FACT", category: "Life" },
      { content: "User works primarily with physical watercolors and digital Procreate.", type: "FACT", category: "Career" },
      { content: "User loves visiting independent coffee shops with lots of plants.", type: "PREF", category: "General" },
      { content: "User is highly visual and appreciates descriptive, colorful language.", type: "IMPLICIT", category: "Communication" },
      { content: "User has a golden retriever named 'Ochre'.", type: "FACT", category: "Pets" },
      { content: "User dislikes corporate jargon and overly formal tone.", type: "PREF", category: "Communication" },
      { content: "User is currently trying to learn 3D modeling in Blender.", type: "FACT", category: "Learning" },
      { content: "User draws inspiration from Studio Ghibli films.", type: "PREF", category: "Inspiration" },
      { content: "User tends to ask for creative brainstorming help.", type: "IMPLICIT", category: "Behavior" },
      { content: "User prefers late-night work sessions.", type: "PREF", category: "Habit" },
      { content: "User takes weekend trips upstate for nature sketching.", type: "FACT", category: "Hobby" },
      { content: "User values empathy and emotional intelligence in conversations.", type: "IMPLICIT", category: "Persona" },
      { content: "User collects vintage fountain pens.", type: "FACT", category: "Hobby" },
      { content: "User avoids social media debates.", type: "PREF", category: "Behavior" },
      { content: "User is vegetarian and loves trying new recipes.", type: "FACT", category: "Food" }
    ]
  },
  {
    name: 'David - The Tech Bro',
    facts: [
      { content: "User is a 34-year-old Staff Software Engineer in San Francisco.", type: "FACT", category: "Career" },
      { content: "User is obsessed with optimizing workflows and system latency.", type: "IMPLICIT", category: "Persona" },
      { content: "User strongly prefers dark mode everywhere.", type: "PREF", category: "General" },
      { content: "User communicates in bullet points and concise technical jargon.", type: "IMPLICIT", category: "Communication" },
      { content: "User drinks exactly 3 shots of espresso every morning.", type: "FACT", category: "Habit" },
      { content: "User believes Rust is the future of systems programming.", type: "PREF", category: "Technology" },
      { content: "User goes bouldering three times a week.", type: "FACT", category: "Hobby" },
      { content: "User drives a Tesla Model 3.", type: "FACT", category: "Life" },
      { content: "User dislikes small talk and wants direct answers.", type: "PREF", category: "Communication" },
      { content: "User is currently architecting a Kubernetes microservices migration.", type: "FACT", category: "Career" },
      { content: "User closely follows Y Combinator startup news.", type: "FACT", category: "Interest" },
      { content: "User values efficiency above emotional nuance.", type: "IMPLICIT", category: "Behavior" },
      { content: "User uses a split mechanical keyboard with tactical switches.", type: "FACT", category: "Technology" },
      { content: "User is skeptical of unproven hype technologies.", type: "IMPLICIT", category: "Persona" },
      { content: "User tracks all personal finances in a complex spreadsheet.", type: "FACT", category: "Life" }
    ]
  },
  {
    name: 'Elena - The Travel Blogger',
    facts: [
      { content: "User is a 31-year-old digital nomad currently based in Lisbon.", type: "FACT", category: "Life" },
      { content: "User speaks English, Spanish, and basic Portuguese.", type: "FACT", category: "Skills" },
      { content: "User loves discovering hidden local spots rather than tourist traps.", type: "PREF", category: "Travel" },
      { content: "User communicates with high energy, often using emojis.", type: "IMPLICIT", category: "Communication" },
      { content: "User makes a living through affiliate marketing and YouTube.", type: "FACT", category: "Career" },
      { content: "User relies heavily on lightweight tech like iPad Pro and action cameras.", type: "PREF", category: "Technology" },
      { content: "User is planning a cross-continental train trip across Asia next year.", type: "FACT", category: "Travel" },
      { content: "User values engaging, storytelling-driven responses.", type: "IMPLICIT", category: "Behavior" },
      { content: "User is allergic to seafood.", type: "FACT", category: "Health" },
      { content: "User asks a lot of logistics and cultural questions.", type: "IMPLICIT", category: "Behavior" },
      { content: "User prefers hostels or boutique Airbnbs for social networking.", type: "PREF", category: "Travel" },
      { content: "User is highly adaptable and handles chaos well.", type: "IMPLICIT", category: "Persona" },
      { content: "User takes hundreds of photos a day and worries about cloud storage.", type: "FACT", category: "Technology" },
      { content: "User loves trying obscure street food.", type: "PREF", category: "Food" },
      { content: "User usually starts her mornings with yoga.", type: "FACT", category: "Habit" }
    ]
  }
];

async function seedDatabase() {
  try {
    console.log("Starting DB Wipe...");
    
    // Wipe everything (ON DELETE CASCADE will handle memories, messages, collabs via user_id)
    await pool.query('DELETE FROM users');
    
    console.log("Database wiped perfectly. Starting seed process...");

    for (const persona of demoUsers) {
      console.log(`\nCreating User: ${persona.name}...`);
      
      // 1. Create User
      const userRes = await pool.query(
        `INSERT INTO users (persona_name) VALUES ($1) RETURNING id`,
        [persona.name]
      );
      const userId = userRes.rows[0].id;

      // 2. Create an initial conversation
      const convRes = await pool.query(
        `INSERT INTO conversations (user_id) VALUES ($1) RETURNING id`,
        [userId]
      );
      const conversationId = convRes.rows[0].id;
      
      // 3. Create a dummy initial message connecting the memory
      const msgRes = await pool.query(
        `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3) RETURNING id`,
        [conversationId, 'user', "Initial memory seed message."]
      );
      const messageId = msgRes.rows[0].id;

      // 4. Compute and Insert Memories
      console.log(`Embedding ${persona.facts.length} memories via Gemini API...`);
      for (const memory of persona.facts) {
        // Embed the standalone text via real Gemini call
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
      }
      
      console.log(`Successfully completed seed for ${persona.name}`);
    }

    console.log("\n✅ Entire database successfully seeded with Demo Data!");
    process.exit(0);

  } catch (err) {
    console.error("FATAL ERROR during seed:", err);
    process.exit(1);
  }
}

seedDatabase();

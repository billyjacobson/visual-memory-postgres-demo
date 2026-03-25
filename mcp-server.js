#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

const server = new Server(
  {
    name: "living-memory-db-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "run_query",
        description: "Run a READ-ONLY SQL query against the living_memory database. Useful for visualizing user statistics, memory categories, or database schema. Allowed tables: users, conversations, messages, memories.",
        inputSchema: {
          type: "object",
          properties: {
            sql: {
              type: "string",
              description: "The SQL query to execute. Example: SELECT category, COUNT(*) FROM memories GROUP BY category ORDER BY COUNT(*) DESC"
            }
          },
          required: ["sql"]
        }
      },
      {
        name: "get_schema",
        description: "Get the database schema to understand the tables and columns.",
        inputSchema: {
          type: "object",
          properties: {},
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_schema") {
    const query = `
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;
    try {
      const result = await pool.query(query);
      return {
        content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }]
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: "Error fetching schema: " + e.message }],
        isError: true
      };
    }
  }

  if (name === "run_query") {
    const sql = args.sql;
    // Basic safety check
    if (sql.match(/insert|update|delete|drop|alter|truncate|create/i)) {
      return {
        content: [{ type: "text", text: "Error: Only SELECT queries are permitted using this tool." }],
        isError: true
      };
    }
    
    try {
      const result = await pool.query(sql);
      return {
        content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }]
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: "Error executing query: " + e.message }],
        isError: true
      };
    }
  }

  throw new Error(`Tool not found: ${name}`);
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Living Memory MCP Server running on stdio");
}

run().catch(console.error);

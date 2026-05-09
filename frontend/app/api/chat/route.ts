import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { GoogleGenAI } from "@google/genai";

const DB_CONFIG = {
  host: process.env.POSTGRES_HOST || "localhost",
  port: parseInt(process.env.POSTGRES_PORT || "5433"),
  database: process.env.POSTGRES_DB || "ragdb",
  user: process.env.POSTGRES_USER || "postgres",
  password: process.env.POSTGRES_PASSWORD || "postgres",
};

const TOP_K = 5;

function getAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenAI({ apiKey });
}

async function embedQuery(query: string): Promise<number[]> {
  const ai = getAI();
  const result = await ai.models.embedContent({
    model: "gemini-embedding-2",
    contents: query,
    config: { taskType: "RETRIEVAL_QUERY" },
  });
  return result.embeddings![0].values!;
}

async function retrieveContext(embedding: number[]): Promise<string[]> {
  const client = new Client(DB_CONFIG);
  await client.connect();
  try {
    const vectorLiteral = `[${embedding.join(",")}]`;
    const res = await client.query(
      `SELECT content
       FROM documents
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [vectorLiteral, TOP_K]
    );
    return res.rows.map((r: { content: string }) => r.content);
  } finally {
    await client.end();
  }
}

async function generateAnswer(question: string, chunks: string[]): Promise<ReadableStream<Uint8Array>> {
  const ai = getAI();

  const context = chunks
    .map((c, i) => `[${i + 1}] ${c}`)
    .join("\n\n");

  const prompt = `You are a clinical genomics assistant helping interpret NGS quality reports.
Answer the question using only the provided context. Be concise and precise.
If the context doesn't contain enough information, say so clearly.

Context:
${context}

Question: ${question}

Answer:`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const response = await ai.models.generateContentStream({
          model: "gemini-2.0-flash",
          contents: prompt,
        });
        for await (const chunk of response) {
          const text = chunk.text;
          if (text) {
            controller.enqueue(encoder.encode(text));
          }
        }
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });

  return stream;
}

export async function POST(req: NextRequest) {
  let question: string;
  try {
    const body = await req.json();
    question = (body.message || "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!question) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  try {
    const embedding = await embedQuery(question);
    const chunks = await retrieveContext(embedding);
    const stream = await generateAnswer(question, chunks);

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    console.error("Chat error:", err);
    return NextResponse.json({ error: "Failed to generate response" }, { status: 500 });
  }
}

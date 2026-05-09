import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import Anthropic from "@anthropic-ai/sdk";

const DB_CONFIG = {
  host: process.env.POSTGRES_HOST || "localhost",
  port: parseInt(process.env.POSTGRES_PORT || "5433"),
  database: process.env.POSTGRES_DB || "ragdb",
  user: process.env.POSTGRES_USER || "postgres",
  password: process.env.POSTGRES_PASSWORD || "postgres",
};

const TOP_K = 5;

type CitationMetadata = Record<string, unknown>;

type RetrievedChunk = {
  id: number;
  source: string | null;
  content: string;
  metadata: CitationMetadata;
  chunkIndex: number | null;
  rank: number;
};

function getAI() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey });
}

async function embedQuery(query: string): Promise<number[]> {
  const embedUrl = process.env.EMBED_SERVER_URL || "http://localhost:8000/embed";
  const res = await fetch(embedUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: query }),
  });
  if (!res.ok) throw new Error(`Embed server error: ${res.status}`);
  const data = await res.json();
  return data.embedding;
}

function cleanMetadata(metadata: unknown): CitationMetadata {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return metadata as CitationMetadata;
}

function metadataString(metadata: CitationMetadata, key: string): string | null {
  const value = metadata[key];
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function sourceLabel(chunk: RetrievedChunk): string {
  const metadata = chunk.metadata;
  const source = metadataString(metadata, "source_file") || chunk.source || `document ${chunk.id}`;
  const page = metadataString(metadata, "page") || metadataString(metadata, "page_number");
  const table = metadataString(metadata, "table") || metadataString(metadata, "table_name");
  const sample = metadataString(metadata, "sample_id");
  const patient = metadataString(metadata, "patient_id");
  const report = metadataString(metadata, "report_type");
  const chunkIndex = chunk.chunkIndex ?? metadataString(metadata, "chunk_index") ?? chunk.rank - 1;

  const details = [
    page ? `page ${page}` : null,
    sample ? `sample ${sample}` : null,
    patient ? `patient ${patient}` : null,
    table ? `table ${table}` : null,
    report ? `report ${report}` : null,
    `chunk ${chunkIndex}`,
  ].filter(Boolean);

  return `${source}${details.length ? `, ${details.join(", ")}` : ""}`;
}

function formatContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((chunk) => `[${chunk.rank}] Citation: ${sourceLabel(chunk)}\nContent:\n${chunk.content}`)
    .join("\n\n");
}

async function ensureCitationColumns(client: Client): Promise<void> {
  await client.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb");
  await client.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS chunk_index INTEGER");
}

async function retrieveContext(embedding: number[]): Promise<RetrievedChunk[]> {
  const client = new Client(DB_CONFIG);
  await client.connect();
  try {
    await ensureCitationColumns(client);
    const vectorLiteral = `[${embedding.join(",")}]`;
    const res = await client.query(
      `SELECT id, source, content, metadata, chunk_index
       FROM documents
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [vectorLiteral, TOP_K]
    );
    return res.rows.map(
      (
        r: {
          id: number;
          source: string | null;
          content: string;
          metadata: unknown;
          chunk_index: number | null;
        },
        i: number
      ) => ({
        id: r.id,
        source: r.source,
        content: r.content,
        metadata: cleanMetadata(r.metadata),
        chunkIndex: r.chunk_index,
        rank: i + 1,
      })
    );
  } finally {
    await client.end();
  }
}

async function generateAnswer(question: string, chunks: RetrievedChunk[]): Promise<ReadableStream<Uint8Array>> {
  const anthropic = getAI();

  const context = formatContext(chunks);

  const systemPrompt = `You are a clinical genomics assistant helping interpret NGS quality reports.
Answer the question using only the provided context. Be concise and precise.
If the context doesn't contain enough information, say so clearly.
Every factual claim based on retrieved context must include one or more inline citation markers like [1] or [1][3].
Use only the citation numbers provided in the context. Do not invent citation numbers.
End every answer with a "## Sources" section listing only the cited sources you actually used.
For each source, copy the citation label from the matching context block, for example:
[1] report.pdf, page 4, sample SG222-LPA, table coverage
Format answers in clean GitHub-flavored Markdown:
- Use short headings for sections.
- Use **bold** for important findings, gene names, and warnings.
- Use *italic* text for clarifying notes or caveats.
- Use Markdown tables for lists of genes, exons, regions, thresholds, or findings.
- Prefer bullets only for short supporting details.
- Do not say you cannot generate visual graphs unless the user explicitly asks for an image/chart file.

Context:
${context}`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const response = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: question }],
        });

        for await (const chunk of response) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text));
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

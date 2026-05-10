# Clinical Genomics Quality Report Assistant

An AI-powered workspace for interpreting NGS (Next-Generation Sequencing) quality reports. It helps clinical genomicists, molecular pathologists, and lab teams quickly triage sample quality, understand report evidence, and turn findings into follow-up actions.

Built at the **SOPHiA DDM Health Hackathon**.

---

## Why it matters

Genomic pathologists work under heavy cognitive load: they need to review molecular quality metrics, inspect patient-specific evidence, compare samples, prepare clinical interpretations, and manage follow-up work across multiple cases. Much of that work is still spread across dense PDFs, dashboards, tables, and raw technical outputs.

This platform brings those scattered signals into a single AI-assisted workflow. Instead of forcing specialists to hunt through reports, it surfaces the most important quality findings, lets users ask questions in natural language, and converts insights into clear next steps.

**Core value: less manual searching, faster triage, clearer prioritization, and more time for expert clinical judgment.**

---

## What it does

- **QA Report Summarizer** - Produces a five-bullet overview of medical sample QA, giving pathologists an immediate snapshot of run quality, coverage risks, failed thresholds, and samples that need attention before deeper review.
- **Conversational Report Chat** - Replaces complicated dashboards with a natural language interface. Users can ask questions such as "Compare sample A and sample B" or "Which genes have low coverage?" and receive grounded answers from the report content.
- **Individual Sample Summaries** - Creates patient- or sample-level deep dives with key findings, quality concerns, and recommended follow-up actions.
- **Follow-up Task Management** - Lets users add recommended actions to a to-do list, helping pathologists prioritize unresolved checks, reruns, clarifications, and downstream review tasks.
- **Grounded RAG Answers** - Retrieves relevant report passages from the document store so chat responses are based on the uploaded report context.
- **Audio Briefings** - Generates podcast-style MP3 summaries of quality reports via ElevenLabs TTS for hands-free review.
- **PDF Viewer** - Provides integrated access to source sample and request documents alongside AI-generated insights.

---

## Demo narrative

A genomic pathologist's day stacks up fast. Between reviewing molecular data, writing clinical reports, and handling administrative duties, the cognitive load is immense. This platform introduces a cleaner way to work: one designed to help pathologists make better decisions, faster.

The QA Report Summarizer gives users a concise five-bullet overview of sample quality instead of making them dig through raw files first. It supports fast triage by highlighting the cases, metrics, and quality concerns that deserve immediate attention.

The chat interface introduces a more natural UI for complex genomic review. Instead of clicking through messy data or fragmented dashboards, the user can ask plain-English questions about the documents: compare samples, find genes with low coverage, identify failed thresholds, or clarify report evidence.

When the user focuses on a specific case, the Individual Sample Summarizer provides a deeper view of key findings and recommended follow-up actions. Those actions can then be added directly to a unified to-do list, turning report interpretation into organized next steps.

**Less cognitive load. Faster quality review. Better prioritization for genomic pathology teams.**

---

## Technological system

The application combines a modern clinical frontend, retrieval-augmented generation, local embeddings, vector search, and voice synthesis.

```text
+---------------------------------------------------------+
|                    Next.js Frontend                     |
|  Dashboard | RAG Chat | PDF Viewer | Audio Player | To-do |
+---------------------------+-----------------------------+
                            |
                            | API routes
                            |
          +-----------------+------------------+
          |                                    |
          v                                    v
+-------------------+              +-----------------------+
|   Claude API      |              |    ElevenLabs TTS     |
|   Anthropic LLM   |              |    Audio briefings    |
+---------+---------+              +-----------------------+
          |
          | grounded context
          v
+-------------------+       vector similarity       +-------------------+
| PostgreSQL 16     | <---------------------------> | Embedding Server  |
| pgvector + HNSW   |                               | all-mpnet-base-v2 |
| port 5433         |                               | port 8000         |
+-------------------+                               +-------------------+
```

**Stack:**

- Frontend: Next.js 15, React, TypeScript
- AI: Anthropic Claude (`claude-sonnet-4-6`), Google Gemini fallback
- TTS: ElevenLabs
- Embeddings: `sentence-transformers/all-mpnet-base-v2` with 768-dimensional vectors
- Database: PostgreSQL 16 + pgvector with HNSW indexing and cosine similarity
- Python backend: `uv`, `pdfplumber`, `sentence-transformers`, `psycopg2`

---

## How the RAG pipeline works

1. A genomic PDF report is parsed into structured text chunks.
2. Each chunk is embedded using `sentence-transformers/all-mpnet-base-v2`.
3. Embeddings are stored in PostgreSQL with pgvector.
4. The user asks a question in the chat interface.
5. The question is embedded by the local embedding microservice.
6. The system retrieves the top semantically similar report chunks using cosine similarity.
7. Retrieved chunks are passed to Claude as grounded context.
8. Claude returns an answer based on the report content and supporting citations.

---

## Setup

### Prerequisites

- Node.js 18+
- Python 3.12+
- [uv](https://docs.astral.sh/uv/) Python package manager
- Docker + Docker Compose

### 1. Clone and install

```bash
git clone <repo-url>
cd eth-health-hackathon

# Install frontend dependencies
cd frontend && npm install && cd ..

# Install Python dependencies
cd backend/ingestion && uv sync && cd ../..
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=genomics

# AI APIs
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
ELEVENLABS_MODEL_ID=eleven_turbo_v2
```

### 3. Start all services

```bash
bash dev.sh
```

This starts:

1. PostgreSQL with pgvector on port 5433
2. Embedding microservice on port 8000
3. Next.js dev server on port 3000

Open [http://localhost:3000](http://localhost:3000).

---

## Ingesting a report

To load a new genomic PDF report into the system:

```bash
# 1. Parse and chunk the PDF into embeddings
cd backend
uv run python pdf_chunker.py path/to/report.pdf

# 2. Load embeddings into the database
cd ingestion
uv run python load-embeddings.py

# 3. Generate QA assets, summaries, and audio briefings
cd backend
uv run python generate_assets.py report.pdf lab
```

Supported audience types: `lab`, `clinical`, `general`

---

## Project structure

```text
eth-health-hackathon/
|-- frontend/
|   |-- app/
|   |   |-- page.tsx              # Main dashboard
|   |   |-- Chatbot.tsx           # RAG chat interface
|   |   `-- api/
|   |       |-- chat/             # RAG endpoint
|   |       |-- qa-report/        # QA report generation
|   |       |-- podcast/          # Audio briefing serving
|   |       |-- summary-audio/    # ElevenLabs TTS synthesis
|   |       `-- report/           # PDF serving
|-- backend/
|   |-- pdf_chunker.py            # PDF parse -> chunk -> embed pipeline
|   |-- generate_assets.py        # Report and audio generation
|   `-- ingestion/
|       |-- embed_server.py       # Embedding microservice
|       |-- load-embeddings.py    # DB ingestion script
|       `-- txt-ingest.py         # Plain text ingestion
|-- db/
|   `-- init.sql                  # PostgreSQL schema
|-- docker-compose.yml
|-- dev.sh                        # One-command dev startup
`-- .env.example
```

---

## Database schema

```sql
CREATE TABLE documents (
    id           SERIAL PRIMARY KEY,
    source       TEXT,
    content      TEXT NOT NULL,
    metadata     JSONB DEFAULT '{}',
    chunk_index  INTEGER,
    embedding    vector(768)
);

-- HNSW index for fast approximate nearest-neighbor search
CREATE INDEX documents_embedding_idx
    ON documents USING hnsw (embedding vector_cosine_ops);
```

Metadata fields: `source_file`, `page`, `sample_id`, `patient_id`, `report_type`, `table_name`, `chunk_index`

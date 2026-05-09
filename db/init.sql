CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
    id        SERIAL PRIMARY KEY,
    source    TEXT,
    content   TEXT NOT NULL,
    metadata  JSONB DEFAULT '{}'::jsonb,
    chunk_index INTEGER,
    embedding vector(768)
);

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS chunk_index INTEGER;

CREATE INDEX IF NOT EXISTS documents_embedding_idx
    ON documents USING hnsw (embedding vector_cosine_ops);

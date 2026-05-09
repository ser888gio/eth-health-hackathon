CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
    id        SERIAL PRIMARY KEY,
    source    TEXT,
    content   TEXT NOT NULL,
    embedding vector(768)
);

CREATE INDEX IF NOT EXISTS documents_embedding_idx
    ON documents USING hnsw (embedding vector_cosine_ops);

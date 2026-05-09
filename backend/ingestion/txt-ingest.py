"""
RAG ingestion pipeline: chunks txt files and stores embeddings in pgvector.

Usage:
    uv run ingest.py path/to/file.txt [path/to/other.txt ...]
    uv run ingest.py example/          # ingest all .txt in a folder
"""

import os
import sys
import glob
import hashlib
import textwrap
import psycopg2
from pathlib import Path
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

load_dotenv(Path(__file__).parents[2] / ".env")

# ── Config ──────────────────────────────────────────────────────────────────
CHUNK_SIZE = 500        # characters per chunk
CHUNK_OVERLAP = 50      # character overlap between consecutive chunks
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"  # 384-dim, free, fast

DB_CONFIG = {
    "host": os.getenv("POSTGRES_HOST", "localhost"),
    "port": int(os.getenv("POSTGRES_PORT", 5433)),
    "dbname": os.getenv("POSTGRES_DB", "ragdb"),
    "user": os.getenv("POSTGRES_USER", "postgres"),
    "password": os.getenv("POSTGRES_PASSWORD", "postgres"),
}


# ── Chunking ─────────────────────────────────────────────────────────────────
def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping fixed-size character chunks."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + size
        chunks.append(text[start:end].strip())
        start += size - overlap
    return [c for c in chunks if c]


# ── DB helpers ───────────────────────────────────────────────────────────────
def connect() -> psycopg2.extensions.connection:
    return psycopg2.connect(**DB_CONFIG)


def source_already_ingested(cur, source: str) -> bool:
    cur.execute("SELECT 1 FROM documents WHERE source = %s LIMIT 1", (source,))
    return cur.fetchone() is not None


def insert_chunks(cur, source: str, chunks: list[str], embeddings) -> int:
    inserted = 0
    for chunk, emb in zip(chunks, embeddings):
        cur.execute(
            "INSERT INTO documents (source, content, embedding) VALUES (%s, %s, %s)",
            (source, chunk, emb.tolist()),
        )
        inserted += 1
    return inserted


# ── Ingestion ────────────────────────────────────────────────────────────────
def ingest_file(path: Path, model: SentenceTransformer, conn) -> int:
    source = str(path.resolve())
    text = path.read_text(encoding="utf-8", errors="replace")
    chunks = chunk_text(text)

    with conn.cursor() as cur:
        if source_already_ingested(cur, source):
            print(f"  skip (already ingested): {path.name}")
            return 0

        print(f"  embedding {len(chunks)} chunks from {path.name} …", end="", flush=True)
        embeddings = model.encode(chunks, show_progress_bar=False, batch_size=64)
        print(f" done")

        n = insert_chunks(cur, source, chunks, embeddings)
    conn.commit()
    return n


def resolve_paths(args: list[str]) -> list[Path]:
    paths = []
    for arg in args:
        p = Path(arg)
        if p.is_dir():
            paths.extend(sorted(p.glob("**/*.txt")))
        elif p.suffix == ".txt" and p.exists():
            paths.append(p)
        else:
            print(f"warning: skipping {arg} (not a .txt file or directory)")
    return paths


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    paths = resolve_paths(sys.argv[1:])
    if not paths:
        print("No .txt files found.")
        sys.exit(1)

    print(f"Loading model {MODEL_NAME} …")
    model = SentenceTransformer(MODEL_NAME)

    print(f"Connecting to postgres at {DB_CONFIG['host']}:{DB_CONFIG['port']} …")
    conn = connect()

    total = 0
    for path in paths:
        n = ingest_file(path, model, conn)
        total += n
        if n:
            print(f"  inserted {n} chunks from {path.name}")

    conn.close()
    print(f"\nDone. Total chunks inserted: {total}")


if __name__ == "__main__":
    main()

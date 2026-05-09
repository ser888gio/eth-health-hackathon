"""
RAG ingestion pipeline: chunks txt files and stores embeddings in pgvector.

Embedding priority:
  1. Google Gemini text-embedding-004 (768-dim) — requires GEMINI_API_KEY in .env
  2. HuggingFace all-mpnet-base-v2 (768-dim)    — free local fallback

Usage:
    uv run python txt-ingest.py path/to/file.txt [path/to/other.txt ...]
    uv run python txt-ingest.py example/          # ingest all .txt in a folder
"""

import os
import sys
import psycopg2
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parents[2] / ".env")

# ── Config ───────────────────────────────────────────────────────────────────
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
HF_MODEL_NAME = "sentence-transformers/all-mpnet-base-v2"  # 768-dim fallback
EMBEDDING_DIM = 768

DB_CONFIG = {
    "host": os.getenv("POSTGRES_HOST", "localhost"),
    "port": int(os.getenv("POSTGRES_PORT", 5433)),
    "dbname": os.getenv("POSTGRES_DB", "ragdb"),
    "user": os.getenv("POSTGRES_USER", "postgres"),
    "password": os.getenv("POSTGRES_PASSWORD", "postgres"),
}


# ── Embedding backends ────────────────────────────────────────────────────────
def _gemini_embed(chunks: list[str]) -> list[list[float]]:
    from google import genai
    from google.genai import types

    client = genai.Client(
        api_key=os.environ["GEMINI_API_KEY"],
        http_options={"api_version": "v1"},
    )
    result = client.models.embed_content(
        model="text-embedding-004",
        contents=chunks,
        config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT"),
    )
    return [e.values for e in result.embeddings]


def _hf_embed(chunks: list[str], model) -> list[list[float]]:
    return model.encode(chunks, show_progress_bar=False, batch_size=64).tolist()


def load_embedder():
    """Return (embed_fn, label). Tries Gemini first, falls back to HuggingFace."""
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    if gemini_key:
        try:
            # Smoke-test with a single string to catch auth/quota errors early
            _gemini_embed(["test"])
            print("Embedder: Gemini text-embedding-004")
            return (lambda chunks: _gemini_embed(chunks), "gemini")
        except Exception as e:
            print(f"Gemini unavailable ({e}), falling back to HuggingFace …")

    print(f"Embedder: HuggingFace {HF_MODEL_NAME}")
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(HF_MODEL_NAME)
    return (lambda chunks: _hf_embed(chunks, model), "huggingface")


# ── Chunking ──────────────────────────────────────────────────────────────────
def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    chunks = []
    start = 0
    while start < len(text):
        chunks.append(text[start:start + size].strip())
        start += size - overlap
    return [c for c in chunks if c]


# ── DB helpers ────────────────────────────────────────────────────────────────
def connect():
    return psycopg2.connect(**DB_CONFIG)


def source_already_ingested(cur, source: str) -> bool:
    cur.execute("SELECT 1 FROM documents WHERE source = %s LIMIT 1", (source,))
    return cur.fetchone() is not None


def insert_chunks(cur, source: str, chunks: list[str], embeddings: list[list[float]]) -> int:
    for chunk, emb in zip(chunks, embeddings):
        cur.execute(
            "INSERT INTO documents (source, content, embedding) VALUES (%s, %s, %s)",
            (source, chunk, emb),
        )
    return len(chunks)


# ── Ingestion ─────────────────────────────────────────────────────────────────
def ingest_file(path: Path, embed_fn, conn) -> int:
    source = str(path.resolve())
    text = path.read_text(encoding="utf-8", errors="replace")
    chunks = chunk_text(text)

    with conn.cursor() as cur:
        if source_already_ingested(cur, source):
            print(f"  skip (already ingested): {path.name}")
            return 0

        print(f"  embedding {len(chunks)} chunks from {path.name} …", end="", flush=True)
        embeddings = embed_fn(chunks)
        print(" done")

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

    embed_fn, _ = load_embedder()

    print(f"Connecting to postgres at {DB_CONFIG['host']}:{DB_CONFIG['port']} …")
    conn = connect()

    total = 0
    for path in paths:
        n = ingest_file(path, embed_fn, conn)
        total += n
        if n:
            print(f"  inserted {n} chunks from {path.name}")

    conn.close()
    print(f"\nDone. Total chunks inserted: {total}")


if __name__ == "__main__":
    main()

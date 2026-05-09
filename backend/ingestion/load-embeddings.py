"""
Bulk-loads a parquet file produced by embed_colab.ipynb into pgvector.

Usage:
    uv run python load-embeddings.py embeddings.parquet
"""

import os
import sys
import psycopg2
import pandas as pd
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parents[2] / ".env")

DB_CONFIG = {
    "host": os.getenv("POSTGRES_HOST", "localhost"),
    "port": int(os.getenv("POSTGRES_PORT", 5433)),
    "dbname": os.getenv("POSTGRES_DB", "ragdb"),
    "user": os.getenv("POSTGRES_USER", "postgres"),
    "password": os.getenv("POSTGRES_PASSWORD", "postgres"),
}


def source_already_ingested(cur, source: str) -> bool:
    cur.execute("SELECT 1 FROM documents WHERE source = %s LIMIT 1", (source,))
    return cur.fetchone() is not None


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    parquet_path = Path(sys.argv[1])
    if not parquet_path.exists():
        print(f"File not found: {parquet_path}")
        sys.exit(1)

    print(f"Loading {parquet_path} …")
    df = pd.read_parquet(parquet_path)
    print(f"  {len(df)} rows, columns: {list(df.columns)}")

    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    skipped = 0
    inserted = 0

    sources = df["source"].unique()
    for source in sources:
        if source_already_ingested(cur, source):
            print(f"  skip (already ingested): {source}")
            skipped += df[df["source"] == source].shape[0]
            continue

        subset = df[df["source"] == source]
        print(f"  inserting {len(subset)} chunks for {source} …", end="", flush=True)

        rows = [
            (row["source"], row["content"], row["embedding"])
            for _, row in subset.iterrows()
        ]
        cur.executemany(
            "INSERT INTO documents (source, content, embedding) VALUES (%s, %s, %s)",
            rows,
        )
        conn.commit()
        inserted += len(subset)
        print(" done")

    cur.close()
    conn.close()
    print(f"\nDone. Inserted: {inserted}  Skipped: {skipped}")


if __name__ == "__main__":
    main()

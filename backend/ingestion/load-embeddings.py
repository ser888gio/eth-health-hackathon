"""
Bulk-loads parquet files produced by embed_colab.ipynb into pgvector.

Usage:
    uv run python load-embeddings.py embeddings.parquet [more.parquet ...]
    uv run python load-embeddings.py txt-parquets/       # load all parquets in a folder
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


def load_parquet(parquet_path: Path, cur, conn) -> tuple[int, int]:
    print(f"\nLoading {parquet_path.name} …")
    df = pd.read_parquet(parquet_path)
    print(f"  {len(df)} rows across {df['source'].nunique()} source(s)")

    inserted = skipped = 0
    for source in df["source"].unique():
        if source_already_ingested(cur, source):
            n = (df["source"] == source).sum()
            print(f"  skip (already ingested): {source}  ({n} chunks)")
            skipped += n
            continue

        subset = df[df["source"] == source]
        print(f"  inserting {len(subset)} chunks for {source} …", end="", flush=True)
        cur.executemany(
            "INSERT INTO documents (source, content, embedding) VALUES (%s, %s, %s)",
            [(row["source"], row["content"], [float(x) for x in row["embedding"]]) for _, row in subset.iterrows()],
        )
        conn.commit()
        inserted += len(subset)
        print(" done")

    return inserted, skipped


def resolve_paths(args: list[str]) -> list[Path]:
    paths = []
    for arg in args:
        p = Path(arg)
        if p.is_dir():
            paths.extend(sorted(p.glob("*.parquet")))
        elif p.suffix == ".parquet" and p.exists():
            paths.append(p)
        else:
            print(f"warning: skipping {arg} (not a .parquet file or directory)")
    return paths


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    paths = resolve_paths(sys.argv[1:])
    if not paths:
        print("No parquet files found.")
        sys.exit(1)

    print(f"Found {len(paths)} parquet file(s)")
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    total_inserted = total_skipped = 0
    for path in paths:
        ins, skp = load_parquet(path, cur, conn)
        total_inserted += ins
        total_skipped += skp

    cur.close()
    conn.close()
    print(f"\nAll done. Inserted: {total_inserted}  Skipped: {total_skipped}")


if __name__ == "__main__":
    main()

"""
Bulk-loads parquet files produced by embed_colab.ipynb into pgvector.

Usage:
    uv run python load-embeddings.py embeddings.parquet [more.parquet ...]
    uv run python load-embeddings.py txt-parquets/       # load all parquets in a folder
    uv run python load-embeddings.py embeddings.parquet --source-col source_file
"""

import argparse
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


def load_parquet(parquet_path: Path, cur, conn, source_col: str = "source") -> tuple[int, int]:
    print(f"\nLoading {parquet_path.name} …")
    df = pd.read_parquet(parquet_path)
    if source_col not in df.columns:
        raise KeyError(f"Column '{source_col}' not found. Available: {df.columns.tolist()}")
    if source_col != "source":
        df = df.rename(columns={source_col: "source"})
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
    parser = argparse.ArgumentParser(description="Bulk-load parquet embeddings into pgvector.")
    parser.add_argument("paths", nargs="+", help="Parquet files or directories")
    parser.add_argument("--source-col", default="source", help="Column to use as source (default: source)")
    args = parser.parse_args()

    paths = resolve_paths(args.paths)
    if not paths:
        print("No parquet files found.")
        sys.exit(1)

    print(f"Found {len(paths)} parquet file(s)")
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    total_inserted = total_skipped = 0
    for path in paths:
        ins, skp = load_parquet(path, cur, conn, source_col=args.source_col)
        total_inserted += ins
        total_skipped += skp

    cur.close()
    conn.close()
    print(f"\nAll done. Inserted: {total_inserted}  Skipped: {total_skipped}")


if __name__ == "__main__":
    main()

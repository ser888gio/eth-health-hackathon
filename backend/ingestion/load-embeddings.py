"""
Bulk-loads parquet files produced by embed_colab.ipynb into pgvector.

Usage:
    uv run python load-embeddings.py embeddings.parquet [more.parquet ...]
    uv run python load-embeddings.py txt-parquets/       # load all parquets in a folder
    uv run python load-embeddings.py embeddings.parquet --source-col source_file
"""

import argparse
import json
import os
import sys
import psycopg2
from psycopg2.extras import Json
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

METADATA_COLUMNS = (
    "source_file",
    "page",
    "page_number",
    "table",
    "table_name",
    "sample_id",
    "patient_id",
    "report_type",
    "chunk_index",
    "chunk_id",
    "external_id",
)


def ensure_citation_columns(cur, conn) -> None:
    cur.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb")
    cur.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS chunk_index INTEGER")
    conn.commit()


def clean_value(value):
    if isinstance(value, dict):
        return {str(k): clean_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean_value(v) for v in value]
    if hasattr(value, "tolist"):
        return clean_value(value.tolist())
    if pd.isna(value):
        return None
    return value.item() if hasattr(value, "item") else value


def build_metadata(row) -> dict:
    raw_metadata = row.get("metadata", {})
    if isinstance(raw_metadata, str):
        try:
            raw_metadata = json.loads(raw_metadata)
        except json.JSONDecodeError:
            raw_metadata = {}
    metadata = raw_metadata if isinstance(raw_metadata, dict) else {}
    metadata = clean_value(dict(metadata))
    for column in METADATA_COLUMNS:
        if column in row.index:
            value = clean_value(row[column])
            if value is not None:
                metadata.setdefault(column, value)
    return metadata


def get_chunk_index(row, fallback: int) -> int:
    if "chunk_index" not in row.index:
        return fallback
    value = clean_value(row["chunk_index"])
    try:
        return int(value) if value is not None else fallback
    except (TypeError, ValueError):
        return fallback


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
            """
            INSERT INTO documents (source, content, metadata, chunk_index, embedding)
            VALUES (%s, %s, %s, %s, %s)
            """,
            [
                (
                    row["source"],
                    row["content"],
                    Json(build_metadata(row)),
                    get_chunk_index(row, i),
                    [float(x) for x in row["embedding"]],
                )
                for i, (_, row) in enumerate(subset.iterrows())
            ],
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
    ensure_citation_columns(cur, conn)

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

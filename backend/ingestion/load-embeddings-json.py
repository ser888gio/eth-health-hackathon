"""
Bulk-loads JSON embedding files into pgvector.

Expected JSON schema (array of objects):
  { "source_file": "...", "text": "...", "embedding": [...], ...metadata... }

Usage:
    uv run python load-embeddings-json.py chunks_embedded.json [more.json ...]
    uv run python load-embeddings-json.py pdf-files/pdf/   # all .json in a folder
"""

import argparse
import json
import os
import sys
import psycopg2
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


def load_json(json_path: Path, cur, conn) -> tuple[int, int]:
    print(f"\nLoading {json_path.name} …")
    with open(json_path, encoding="utf-8") as f:
        records = json.load(f)

    if not records:
        print("  empty file, skipping")
        return 0, 0

    # Validate expected fields on first record
    first = records[0]
    for field in ("source_file", "text", "embedding"):
        if field not in first:
            raise KeyError(f"Expected field '{field}' not found. Available: {list(first.keys())}")

    sources = {r["source_file"] for r in records}
    print(f"  {len(records)} chunks across {len(sources)} source(s)")

    inserted = skipped = 0
    for source in sorted(sources):
        if source_already_ingested(cur, source):
            n = sum(1 for r in records if r["source_file"] == source)
            print(f"  skip (already ingested): {source}  ({n} chunks)")
            skipped += n
            continue

        subset = [r for r in records if r["source_file"] == source]
        print(f"  inserting {len(subset)} chunks for {source} …", end="", flush=True)
        cur.executemany(
            "INSERT INTO documents (source, content, embedding) VALUES (%s, %s, %s)",
            [(r["source_file"], r["text"], [float(x) for x in r["embedding"]]) for r in subset],
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
            paths.extend(sorted(p.glob("*.json")))
        elif p.suffix == ".json" and p.exists():
            paths.append(p)
        else:
            print(f"warning: skipping {arg} (not a .json file or directory)")
    return paths


def main():
    parser = argparse.ArgumentParser(description="Bulk-load JSON embeddings into pgvector.")
    parser.add_argument("paths", nargs="+", help="JSON files or directories")
    args = parser.parse_args()

    paths = resolve_paths(args.paths)
    if not paths:
        print("No JSON files found.")
        sys.exit(1)

    print(f"Found {len(paths)} JSON file(s)")
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    total_inserted = total_skipped = 0
    for path in paths:
        ins, skp = load_json(path, cur, conn)
        total_inserted += ins
        total_skipped += skp

    cur.close()
    conn.close()
    print(f"\nAll done. Inserted: {total_inserted}  Skipped: {total_skipped}")


if __name__ == "__main__":
    main()

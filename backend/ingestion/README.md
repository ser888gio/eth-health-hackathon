# Ingestion testing with pgvector

This project uses a local Postgres database with the `pgvector` extension for RAG ingestion. The database is defined in the repo root `docker-compose.yml` and initialized by `db/init.sql`.

By default, ingestion scripts connect to:

- host: `localhost`
- port: `5433`
- database: `ragdb`
- user/password: `postgres` / `postgres`

## Recommended teammate setup

Each teammate should run their own local pgvector database. This keeps CSV, PDF, and TXT pipeline testing isolated and avoids depending on one person's computer.

From the repo root:

```bash
cp .env.example .env
docker compose up -d db
```

On Windows PowerShell, use:

```powershell
Copy-Item .env.example .env
docker compose up -d db
```

Then run an ingestion command from `backend/ingestion`:

```bash
uv run python txt-ingest.py path/to/file.txt
uv run python load-embeddings.py path/to/embeddings.parquet
```

The `txt-ingest.py` script chunks and embeds `.txt` files directly. The `load-embeddings.py` script loads parquet files that already contain `source`, `content`, and `embedding` columns.

## Shared ingestion contract

All ingestion pipelines should write to the same table:

```sql
documents (
    id SERIAL PRIMARY KEY,
    source TEXT,
    content TEXT NOT NULL,
    embedding vector(768)
)
```

CSV, PDF, and TXT ingestion should all produce 768-dimensional embeddings and insert rows using:

```sql
INSERT INTO documents (source, content, embedding) VALUES (...)
```

The current scripts skip a source if any row with the same `source` already exists. Keep that duplicate-source behavior consistent across new pipelines so repeated test runs are predictable.

## Verify the database

Check that the container is healthy:

```bash
docker compose ps
```

Verify the pgvector extension and table:

```bash
docker compose exec db psql -U postgres -d ragdb -c "SELECT extname FROM pg_extension WHERE extname = 'vector';"
docker compose exec db psql -U postgres -d ragdb -c "\d documents"
```

Check loaded rows:

```bash
docker compose exec db psql -U postgres -d ragdb -c "SELECT source, COUNT(*) AS chunks FROM documents GROUP BY source ORDER BY chunks DESC;"
```

If you need a clean local database, remove the Docker volume and start again:

```bash
docker compose down -v
docker compose up -d db
```

This deletes only your local Docker database volume.

## Other testing options

Local Docker is the default for development. For a shared demo or integration environment, use a hosted Postgres provider that supports pgvector, run `db/init.sql`, and share only the connection settings through a private channel.

Sharing one person's local database over a network or tunnel can work temporarily, but it is fragile: that computer must stay online, teammates can collide on duplicate sources, and database credentials need to be protected.

For parser-only work, teammates can test CSV/PDF chunking and embedding without a live database by producing parquet files with `source`, `content`, and `embedding`, then loading them later with `load-embeddings.py`.

## Secrets

Do not commit `.env` or real API keys. Use `.env.example` as the template and keep real credentials local. If a real Gemini key was shared in chat, screenshots, or committed history, rotate it before the team relies on it.

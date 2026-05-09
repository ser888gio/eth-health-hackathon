#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Starting Docker (pgvector DB)..."
docker compose -f "$ROOT/docker-compose.yml" up -d

echo "Waiting for DB to be healthy..."
until docker compose -f "$ROOT/docker-compose.yml" exec db pg_isready -U postgres &>/dev/null; do
  sleep 1
done
echo "DB is ready."

echo "Starting Embed server (all-mpnet-base-v2)..."
cd "$ROOT/backend/ingestion" && uv run python embed_server.py &
EMBED_PID=$!

echo "Waiting for embed server to be ready (model load may take ~30s)..."
until curl -sf -o /dev/null -X POST http://localhost:8000/embed \
    -H "Content-Type: application/json" -d '{"text":"warmup"}' 2>/dev/null; do
  sleep 2
done
echo "Embed server is ready."

echo "Starting Frontend (Next.js)..."
cd "$ROOT/frontend" && npm run dev &
FE_PID=$!

echo ""
echo "Services started:"
echo "  DB     -> localhost:5433 (pgvector/postgres)"
echo "  Embed  -> http://localhost:8000 (pid $EMBED_PID)"
echo "  FE     -> http://localhost:3000 (pid $FE_PID)"
echo ""
echo "Backend scripts (run manually):"
echo "  cd backend/ingestion && uv run python load-embeddings.py"
echo "  cd backend/summarisation && uv run python main.py"
echo ""
echo "Press Ctrl+C to stop all services."

cleanup() {
  echo "Stopping services..."
  kill $FE_PID 2>/dev/null
  kill $EMBED_PID 2>/dev/null
  docker compose -f "$ROOT/docker-compose.yml" down
}
trap cleanup EXIT INT TERM

wait $FE_PID

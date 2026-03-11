#!/usr/bin/env bash
# Start OpenFind: Redis, Flask API, Celery worker, and frontend.
# Run from project root: ./scripts/start-openfind-go.sh  or  ./start-openfind-go.sh
# To stop: press Ctrl+C (stops all child processes).

set -e
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# Load .env
if [ -f .env ]; then set -a; . ./.env; set +a; fi
REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"

# PIDs to kill on exit
FLASK_PID=""
CELERY_PID=""
FRONTEND_PID=""
EXTRACTION_PID=""
EMBEDDING_PID=""

cleanup() {
  echo ""
  echo "Stopping OpenFind..."
  [ -n "$FRONTEND_PID" ]    && kill "$FRONTEND_PID" 2>/dev/null || true
  [ -n "$CELERY_PID" ]      && kill "$CELERY_PID" 2>/dev/null || true
  [ -n "$EXTRACTION_PID" ]  && kill "$EXTRACTION_PID" 2>/dev/null || true
  [ -n "$EMBEDDING_PID" ]   && kill "$EMBEDDING_PID" 2>/dev/null || true
  [ -n "$FLASK_PID" ]       && kill "$FLASK_PID" 2>/dev/null || true
  echo "Done."
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "=============================================="
echo "  Start OpenFind Go – Redis, Extraction, Fast Extract, Flask, Worker, Frontend"
echo "=============================================="

# 1. Redis
echo ""
echo "1. Redis..."
if command -v docker &>/dev/null; then
  if docker compose up redis -d 2>/dev/null || docker-compose up redis -d 2>/dev/null; then
    echo "   Redis started (Docker)."
  else
    echo "   Redis container may already be running."
  fi
else
  echo "   Docker not found. Using Redis at $REDIS_URL (start manually if needed)."
fi

# 2. Wait for Redis
echo ""
echo "2. Waiting for Redis..."
for i in $(seq 1 20); do
  if python -c "
import os, sys
url = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
try:
  import redis
  r = redis.from_url(url)
  r.ping()
  sys.exit(0)
except Exception:
  sys.exit(1)
" 2>/dev/null; then
    echo "   Redis is ready."
    break
  fi
  [ "$i" -eq 20 ] && { echo "   Redis did not become reachable."; exit 1; }
  sleep 1
done

# 3. Doc extraction service (Node) — required for chat file attachments (PDF, Word, Excel, etc.)
if [ -d "$PROJECT_ROOT/services/doc-extraction-node" ] && command -v node &>/dev/null; then
  echo ""
  echo "3. Starting doc extraction service (port 5002)..."
  EXTRACTION_DIR="$PROJECT_ROOT/services/doc-extraction-node"
  if [ ! -d "$EXTRACTION_DIR/node_modules" ]; then
    echo "   Installing dependencies (first run)..."
    (cd "$EXTRACTION_DIR" && npm install) || { echo "   npm install failed. Run: cd services/doc-extraction-node && npm install"; }
  fi
  if (cd "$EXTRACTION_DIR" && npm run build); then
    if [ -f "$PROJECT_ROOT/services/doc-extraction-node/dist/server.js" ]; then
      (cd "$PROJECT_ROOT/services/doc-extraction-node" && node dist/server.js) &>/tmp/openfind-extraction.log &
      EXTRACTION_PID=$!
      export EXTRACTION_SERVICE_URL="${EXTRACTION_SERVICE_URL:-http://localhost:5002}"
      # Wait for extraction service to be ready (retry health check)
      EXTRACTION_READY=""
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        if kill -0 "$EXTRACTION_PID" 2>/dev/null; then
          if command -v curl &>/dev/null && curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 http://127.0.0.1:5002/health 2>/dev/null | grep -q 200; then
            EXTRACTION_READY=1
            break
          fi
        else
          echo "   Doc extraction process exited. Check /tmp/openfind-extraction.log"
          EXTRACTION_PID=""
          break
        fi
        sleep 2
      done
      if [ -n "$EXTRACTION_PID" ]; then
        if [ -n "$EXTRACTION_READY" ]; then
          echo "   Doc extraction running (PID $EXTRACTION_PID). Health check OK. Logs: /tmp/openfind-extraction.log"
        else
          echo "   Doc extraction running (PID $EXTRACTION_PID). Health check not ready yet; may be available shortly. Logs: /tmp/openfind-extraction.log"
        fi
      fi
    else
      echo "   Doc extraction skipped (dist/server.js missing after build)."
    fi
  else
    echo "   Doc extraction build failed. Run: cd services/doc-extraction-node && npm install && npm run build"
  fi
else
  if [ ! -d "$PROJECT_ROOT/services/doc-extraction-node" ]; then
    echo ""
    echo "3. Doc extraction skipped (services/doc-extraction-node not found)."
  elif ! command -v node &>/dev/null; then
    echo ""
    echo "3. Doc extraction skipped (Node.js not found). Install Node >=18 for file attachment extraction."
  fi
fi
# If extraction URL still unset but port 5002 is reachable (e.g. started manually), use it
if [ -z "${EXTRACTION_SERVICE_URL}" ] && command -v curl &>/dev/null && curl -s -o /dev/null -w "%{http_code}" --connect-timeout 1 http://127.0.0.1:5002/health 2>/dev/null | grep -q 200; then
  export EXTRACTION_SERVICE_URL="http://localhost:5002"
  echo "   Using existing extraction service on port 5002."
fi

# 4. Fast extraction / local embedding server (port 5003, optional)
if command -v python &>/dev/null; then
  echo ""
  echo "4. Starting fast extraction (local embedding server, port 5003)..."
  if python -c "from sentence_transformers import SentenceTransformer" 2>/dev/null; then
    (cd "$PROJECT_ROOT" && python -m uvicorn backend.services.embedding_server:app --host 127.0.0.1 --port 5003) &>/tmp/openfind-embedding.log &
    EMBEDDING_PID=$!
    sleep 3
    if kill -0 "$EMBEDDING_PID" 2>/dev/null; then
      if command -v curl &>/dev/null && curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 http://127.0.0.1:5003/health 2>/dev/null | grep -q 200; then
        echo "   Fast extraction (embedding server) running (PID $EMBEDDING_PID). Logs: /tmp/openfind-embedding.log"
      else
        echo "   Fast extraction (embedding server) running (PID $EMBEDDING_PID). Logs: /tmp/openfind-embedding.log"
      fi
    else
      echo "   Fast extraction skipped (failed to start). Logs: /tmp/openfind-embedding.log"
      EMBEDDING_PID=""
    fi
  else
    echo "   Fast extraction skipped (sentence-transformers not installed). pip install sentence-transformers"
  fi
else
  echo ""
  echo "4. Fast extraction skipped (Python not found)."
fi

# 5. Flask API
echo ""
echo "5. Starting Flask API (port 5001)..."
python main.py &>/tmp/openfind-flask.log &
FLASK_PID=$!
sleep 2
if kill -0 "$FLASK_PID" 2>/dev/null; then
  echo "   Flask running (PID $FLASK_PID). Logs: /tmp/openfind-flask.log"
else
  echo "   Flask failed to start. Check /tmp/openfind-flask.log"
  exit 1
fi

# 6. Celery worker
echo ""
echo "6. Starting Celery worker..."
python run_celery_worker.py &>/tmp/openfind-celery.log &
CELERY_PID=$!
sleep 2
if kill -0 "$CELERY_PID" 2>/dev/null; then
  echo "   Celery worker running (PID $CELERY_PID). Logs: /tmp/openfind-celery.log"
else
  echo "   Celery may still be starting. Logs: /tmp/openfind-celery.log"
fi

# 7. Frontend
echo ""
echo "7. Starting frontend (Vite)..."
(cd frontend-ts && npm run dev) &>/tmp/openfind-frontend.log &
FRONTEND_PID=$!
sleep 3
if kill -0 "$FRONTEND_PID" 2>/dev/null; then
  echo "   Frontend running (PID $FRONTEND_PID). Logs: /tmp/openfind-frontend.log"
else
  echo "   Frontend may still be starting. Logs: /tmp/openfind-frontend.log"
fi

echo ""
echo "=============================================="
echo "  OpenFind is up."
echo "  API:      http://localhost:5001"
echo "  Frontend: http://localhost:5173 (or port in log)"
echo "  Worker:   processing uploads in background"
[ -n "$EXTRACTION_PID" ] && echo "  Extract:  http://localhost:5002 (LobeHub file-loaders)"
[ -n "$EMBEDDING_PID" ] && echo "  Fast extract: http://localhost:5003 (local embeddings)"
echo "=============================================="
echo "  Press Ctrl+C to stop all services."
echo "=============================================="

# Wait for frontend (Ctrl+C or frontend exit triggers cleanup)
wait $FRONTEND_PID 2>/dev/null || true
cleanup

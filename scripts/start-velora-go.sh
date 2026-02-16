#!/usr/bin/env bash
# Start Velora: Redis, Flask API, Celery worker, and frontend.
# Run from project root: ./scripts/start-velora-go.sh  or  ./start-velora-go.sh
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

cleanup() {
  echo ""
  echo "Stopping Velora..."
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  [ -n "$CELERY_PID" ]  && kill "$CELERY_PID" 2>/dev/null || true
  [ -n "$FLASK_PID" ]   && kill "$FLASK_PID" 2>/dev/null || true
  echo "Done."
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "=============================================="
echo "  Start Velora Go – Redis, Flask, Worker, Frontend"
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

# 3. Flask API
echo ""
echo "3. Starting Flask API (port 5001)..."
python main.py &>/tmp/velora-flask.log &
FLASK_PID=$!
sleep 2
if kill -0 "$FLASK_PID" 2>/dev/null; then
  echo "   Flask running (PID $FLASK_PID). Logs: /tmp/velora-flask.log"
else
  echo "   Flask failed to start. Check /tmp/velora-flask.log"
  exit 1
fi

# 4. Celery worker
echo ""
echo "4. Starting Celery worker..."
python run_celery_worker.py &>/tmp/velora-celery.log &
CELERY_PID=$!
sleep 2
if kill -0 "$CELERY_PID" 2>/dev/null; then
  echo "   Celery worker running (PID $CELERY_PID). Logs: /tmp/velora-celery.log"
else
  echo "   Celery may still be starting. Logs: /tmp/velora-celery.log"
fi

# 5. Frontend
echo ""
echo "5. Starting frontend (Vite)..."
(cd frontend-ts && npm run dev) &>/tmp/velora-frontend.log &
FRONTEND_PID=$!
sleep 3
if kill -0 "$FRONTEND_PID" 2>/dev/null; then
  echo "   Frontend running (PID $FRONTEND_PID). Logs: /tmp/velora-frontend.log"
else
  echo "   Frontend may still be starting. Logs: /tmp/velora-frontend.log"
fi

echo ""
echo "=============================================="
echo "  Velora is up."
echo "  API:      http://localhost:5001"
echo "  Frontend: http://localhost:5173 (or port in log)"
echo "  Worker:   processing uploads in background"
echo "=============================================="
echo "  Press Ctrl+C to stop all services."
echo "=============================================="

# Wait for frontend (Ctrl+C or frontend exit triggers cleanup)
wait $FRONTEND_PID 2>/dev/null || true
cleanup

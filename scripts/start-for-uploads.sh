#!/usr/bin/env bash
# Start Redis (and optionally Flask + Celery) so document uploads and processing work.
# Uploads need: Redis (Celery broker), Flask (API), Celery worker (background processing).

set -e
cd "$(dirname "$0")/.."
# Load .env if present (REDIS_URL, etc.)
if [ -f .env ]; then set -a; . ./.env; set +a; fi
REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"

echo "=============================================="
echo "  SoloSway – start services for uploads"
echo "=============================================="

# 1. Start Redis (Docker)
if command -v docker &>/dev/null; then
  echo ""
  echo "1. Starting Redis with Docker Compose..."
  if docker compose up redis -d 2>/dev/null || docker-compose up redis -d 2>/dev/null; then
    echo "   Redis container started."
  else
    echo "   Warning: Could not start Redis. Is Docker running?"
    exit 1
  fi
else
  echo ""
  echo "1. Docker not found. Start Redis manually, e.g.:"
  echo "   brew services start redis   # macOS"
  echo "   redis-server                # or run in a terminal"
  echo ""
  read -p "   Is Redis already running? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "   Start Redis and run this script again."
    exit 1
  fi
fi

# 2. Wait for Redis
echo ""
echo "2. Checking Redis..."
for i in $(seq 1 15); do
  if REDIS_URL="$REDIS_URL" python -c "
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
    echo "   Redis is reachable."
    break
  fi
  if [[ $i -eq 15 ]]; then
    echo "   Redis did not become reachable. Check Docker or redis-server."
    exit 1
  fi
  sleep 1
done

# 3. Instructions for Flask and Celery
echo ""
echo "3. Run the API and worker in separate terminals:"
echo ""
echo "   Terminal 1 (Flask API):"
echo "   $ python main.py"
echo ""
echo "   Terminal 2 (Celery worker – processes uploads):"
echo "   $ python run_celery_worker.py"
echo ""
echo "   Or use Docker for everything:"
echo "   $ docker compose up web worker redis -d"
echo ""
echo "=============================================="
echo "  Set REDIS_URL=$REDIS_URL in .env if different."
echo "=============================================="

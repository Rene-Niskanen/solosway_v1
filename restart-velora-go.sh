#!/usr/bin/env bash
# Restart Velora: stop Flask, Celery, and frontend (by port/process), then run start-velora-go.
# Run from project root: ./restart-velora-go.sh
# Redis is left running; other services are killed and restarted.

set -e
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

echo "=============================================="
echo "  Restart Velora Go"
echo "=============================================="

# Kill by port (works even if started by start-velora-go.sh in another terminal)
echo ""
echo "Stopping existing services..."

for port in 5001 5173; do
  if command -v lsof &>/dev/null; then
    pids=$(lsof -ti ":$port" 2>/dev/null) || true
    if [ -n "$pids" ]; then
      echo "  Killing process(es) on port $port: $pids"
      echo "$pids" | xargs kill -9 2>/dev/null || true
    fi
  fi
done

# Kill Celery worker (main process; children may exit with it)
pkill -f "run_celery_worker.py" 2>/dev/null && echo "  Stopped Celery worker." || true
# Kill Flask if not caught by port (e.g. binding delay)
pkill -f "python main.py" 2>/dev/null || true

sleep 2
echo "  Done stopping."
echo ""

# Start again
exec ./start-velora-go.sh

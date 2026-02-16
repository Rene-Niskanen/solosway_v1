#!/usr/bin/env bash
# Start Velora (Redis, Flask, Celery worker, frontend).
# From project root: ./start-velora-go.sh
# Or: bash start-velora-go.sh
cd "$(dirname "$0")"
exec ./scripts/start-velora-go.sh "$@"

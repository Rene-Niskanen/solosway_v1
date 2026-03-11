#!/usr/bin/env bash
# Start OpenFind (Redis, Flask, Celery worker, frontend).
# From project root: ./start-openfind-go.sh
# Or: bash start-openfind-go.sh
cd "$(dirname "$0")"
exec ./scripts/start-openfind-go.sh "$@"

#!/bin/bash
cd "$(dirname "$0")"
export $(cat .env | grep -v '^#' | xargs)
uvicorn backend.services.embedding_server:app --host 0.0.0.0 --port 5003

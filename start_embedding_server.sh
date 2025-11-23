#!/bin/bash

# Start Local Embedding Server
# This script starts the FastAPI embedding server on port 5003

echo "🚀 Starting Local Embedding Server..."
echo ""

# Set default environment variables if not set
export EMBEDDING_MODEL=${EMBEDDING_MODEL:-"BAAI/bge-small-en-v1.5"}
export EMBEDDING_DEVICE=${EMBEDDING_DEVICE:-"cpu"}
export EMBEDDING_SERVER_PORT=${EMBEDDING_SERVER_PORT:-5003}

echo "Configuration:"
echo "  Model: $EMBEDDING_MODEL"
echo "  Device: $EMBEDDING_DEVICE"
echo "  Port: $EMBEDDING_SERVER_PORT"
echo ""

# Check if uvicorn is installed
if ! command -v uvicorn &> /dev/null; then
    echo "❌ uvicorn not found. Installing dependencies..."
    pip install fastapi uvicorn sentence-transformers
fi

# Start the server
echo "Starting server..."
cd "$(dirname "$0")"
uvicorn backend.services.embedding_server:app \
    --host 0.0.0.0 \
    --port $EMBEDDING_SERVER_PORT \
    --reload


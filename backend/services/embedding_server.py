"""
Local Embedding Server using Sentence Transformers (CPU-based).

This FastAPI server hosts embedding models (BGE, GTE, E5) on CPU,
providing a local alternative to OpenAI embeddings for cost savings.

Usage:
    # Development
    uvicorn backend.services.embedding_server:app --host 0.0.0.0 --port 5002 --reload
    
    # Production
    gunicorn -w 4 -k uvicorn.workers.UvicornWorker backend.services.embedding_server:app --bind 0.0.0.0:5002
"""

from fastapi import FastAPI, HTTPException
from sentence_transformers import SentenceTransformer
import logging
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Local Embedding Server",
    description="CPU-based embedding service using Sentence Transformers",
    version="1.0.0"
)

# CPU-friendly embedding model
# Options: 
# - "BAAI/bge-small-en-v1.5" (384d) - Best for English, verified working
# - "sentence-transformers/all-MiniLM-L6-v2" (384d) - Very popular, fast
# - "intfloat/e5-small-v2" (384d) - Good general purpose
# - "sentence-transformers/all-mpnet-base-v2" (768d) - Higher quality, slower
MODEL_NAME = os.environ.get("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
DEVICE = os.environ.get("EMBEDDING_DEVICE", "cpu")  # "cpu" or "cuda"

logger.info(f"Loading embedding model: {MODEL_NAME} on {DEVICE}")
try:
    model = SentenceTransformer(MODEL_NAME, device=DEVICE)
    embedding_dimension = model.get_sentence_embedding_dimension()
    logger.info(f"Embedding model loaded successfully")
    logger.info(f"   Model: {MODEL_NAME}")
    logger.info(f"   Device: {DEVICE}")
    logger.info(f"   Dimensions: {embedding_dimension}")
except Exception as e:
    logger.error(f"Failed to load embedding model: {e}")
    raise


@app.post("/embed")
async def embed(payload: dict):
    """
    Embed a list of texts.
    
    Request:
        {
            "texts": ["text1", "text2", ...]
        }
    
    Response:
        {
            "embeddings": [[0.1, 0.2, ...], [0.3, 0.4, ...], ...],
            "dimensions": 384,
            "count": 2,
            "model": "BAAI/bge-small-en-v1.5"
        }
    """
    texts = payload.get("texts", [])
    if not texts:
        raise HTTPException(status_code=400, detail="No texts provided")
    
    if not isinstance(texts, list):
        raise HTTPException(status_code=400, detail="texts must be a list")
    
    if len(texts) == 0:
        raise HTTPException(status_code=400, detail="texts list cannot be empty")
    
    try:
        # Generate embeddings (batch processing for efficiency)
        embeddings = model.encode(
            texts, 
            batch_size=32, 
            show_progress_bar=False,
            normalize_embeddings=True,  # Normalize for cosine similarity
            convert_to_numpy=True
        )
        
        # Convert numpy arrays to lists for JSON serialization
        return {
            "embeddings": embeddings.tolist(),
            "dimensions": len(embeddings[0]) if len(embeddings) > 0 else 0,
            "count": len(embeddings),
            "model": MODEL_NAME
        }
    except Exception as e:
        logger.error(f"Embedding error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    """Health check endpoint."""
    try:
        return {
            "status": "healthy", 
            "model": MODEL_NAME,
            "device": DEVICE,
            "dimensions": embedding_dimension
        }
    except NameError:
        # Model not loaded yet
        return {
            "status": "error",
            "model": MODEL_NAME,
            "device": DEVICE,
            "error": "Model not loaded"
        }


@app.get("/")
async def root():
    """Root endpoint with server info."""
    try:
        dim = embedding_dimension
    except NameError:
        dim = "unknown"
    
    return {
        "service": "Local Embedding Server",
        "model": MODEL_NAME,
        "device": DEVICE,
        "dimensions": dim,
        "endpoints": {
            "embed": "/embed (POST)",
            "health": "/health (GET)"
        }
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("EMBEDDING_SERVER_PORT", 5002))
    uvicorn.run(app, host="0.0.0.0", port=port)


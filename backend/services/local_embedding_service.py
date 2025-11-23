"""
Local Embedding Service Client.

This service connects to the local embedding server (FastAPI) or falls back to OpenAI.
Supports lazy embedding with automatic fallback.
"""

import os
import requests
from typing import List, Optional
import logging
from openai import OpenAI

logger = logging.getLogger(__name__)

class LocalEmbeddingService:
    """
    Local embedding service using BGE/E5 models.
    Falls back to OpenAI if local service unavailable.
    """
    
    def __init__(self):
        # Local embedding server URL
        # Detect if running in Docker (check for service name) or locally
        # In Docker: use service name 'embedding-server'
        # Locally: use 'localhost'
        default_host = 'embedding-server' if os.environ.get('DOCKER_ENV') else 'localhost'
        default_url = f'http://{default_host}:5003/embed'
        
        self.local_embedding_url = os.environ.get(
            'LOCAL_EMBEDDING_URL', 
            default_url
        )
        self.openai_api_key = os.environ.get('OPENAI_API_KEY')
        self.use_local = os.environ.get('USE_LOCAL_EMBEDDINGS', 'true').lower() == 'true'
        self.fallback_to_openai = os.environ.get('FALLBACK_TO_OPENAI', 'true').lower() == 'true'
        self.embedding_dimension = 1536  # Default to OpenAI dimension
        
        # Test local service availability
        if self.use_local:
            try:
                health_url = self.local_embedding_url.replace('/embed', '/health')
                response = requests.get(health_url, timeout=2)
                if response.status_code == 200:
                    health_data = response.json()
                    self.embedding_dimension = health_data.get('dimensions', 384)
                    model_name = health_data.get('model', 'unknown')
                    logger.info(f"✅ Local embedding service available at {self.local_embedding_url}")
                    logger.info(f"   Model: {model_name}, Dimensions: {self.embedding_dimension}")
                else:
                    logger.warning(f"⚠️ Local embedding service returned {response.status_code}")
                    if self.fallback_to_openai:
                        self.use_local = False
                        self.embedding_dimension = 1536  # OpenAI dimension
                        logger.info("🔄 Falling back to OpenAI embeddings")
            except requests.exceptions.RequestException as e:
                logger.warning(f"⚠️ Local embedding service unavailable: {e}")
                if self.fallback_to_openai:
                    self.use_local = False
                    self.embedding_dimension = 1536  # OpenAI dimension
                    logger.info("🔄 Falling back to OpenAI embeddings")
        else:
            logger.info("Local embeddings disabled (USE_LOCAL_EMBEDDINGS=false), using OpenAI")
        
    def embed_chunks(self, chunks: List[str]) -> List[List[float]]:
        """
        Embed chunks using local model or OpenAI fallback.
        
        Args:
            chunks: List of text chunks to embed
            
        Returns:
            List of embedding vectors
        """
        if not chunks:
            return []
        
        if self.use_local:
            try:
                return self._embed_local(chunks)
            except Exception as e:
                logger.warning(f"Local embedding failed: {e}, falling back to OpenAI")
                if self.fallback_to_openai:
                    return self._embed_openai(chunks)
                else:
                    raise
        else:
            return self._embed_openai(chunks)
    
    def _embed_local(self, chunks: List[str]) -> List[List[float]]:
        """Embed using local BGE/E5 model server."""
        response = requests.post(
            self.local_embedding_url,
            json={'texts': chunks},
            timeout=120  # Allow time for batch processing
        )
        response.raise_for_status()
        result = response.json()
        
        if 'error' in result:
            raise Exception(f"Embedding server error: {result['error']}")
        
        embeddings = result.get('embeddings', [])
        if len(embeddings) != len(chunks):
            raise ValueError(f"Embedding count mismatch: expected {len(chunks)}, got {len(embeddings)}")
        
        logger.info(f"✅ Generated {len(embeddings)} embeddings locally (dim: {result.get('dimensions', 'unknown')})")
        return embeddings
    
    def _embed_openai(self, chunks: List[str]) -> List[List[float]]:
        """Fallback to OpenAI embeddings."""
        if not self.openai_api_key:
            raise ValueError("OpenAI API key not available and local service failed")
        
        client = OpenAI(api_key=self.openai_api_key)
        response = client.embeddings.create(
            model="text-embedding-3-small",
            input=chunks
        )
        embeddings = [item.embedding for item in response.data]
        logger.info(f"✅ Generated {len(embeddings)} embeddings via OpenAI")
        return embeddings
    
    def get_embedding_dimension(self) -> int:
        """Get the dimension of embeddings (for compatibility checks)."""
        return self.embedding_dimension
    
    def is_local_available(self) -> bool:
        """Check if local embedding service is available."""
        return self.use_local


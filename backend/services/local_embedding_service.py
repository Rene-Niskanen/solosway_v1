"""
Local Embedding Service Client.

This service connects to the local embedding server (FastAPI) or falls back to OpenAI.
Supports lazy embedding with automatic fallback.
Also provides context generation (document-level and chunk-level) using local server.

Uses singleton pattern with TTL-based health check caching for scalability.
"""

import os
import requests
import time
import threading
from typing import List, Optional, Dict, Any
import logging
from openai import OpenAI

logger = logging.getLogger(__name__)

# Module-level singleton state with thread-safe initialization
_instance_lock = threading.Lock()
_default_instance: Optional['LocalEmbeddingService'] = None
_health_check_cache: Optional[Dict[str, Any]] = None
_health_check_ttl = int(os.environ.get('EMBEDDING_HEALTH_CHECK_TTL', 60))  # Default 60 seconds
_last_health_check_time = 0

class LocalEmbeddingService:
    """
    Local embedding service using BGE/E5 models.
    Falls back to OpenAI if local service unavailable.
    
    Note: Use get_default_service() factory function for singleton pattern with health check caching.
    Direct instantiation still works but will use cached health checks.
    """
    
    def __init__(self, skip_health_check: bool = False):
        """
        Initialize LocalEmbeddingService.
        
        Args:
            skip_health_check: If True, skip health check (useful for singleton initialization)
        """
        # Local embedding server URL
        # Priority: 1. LOCAL_EMBEDDING_URL env var, 2. Docker service name if DOCKER_ENV, 3. localhost
        # In Docker: use service name 'embedding-server' on port 5003
        # Locally: use 'localhost' on port 5003
        # Get embedding URL from environment or construct it
        env_url = os.environ.get('LOCAL_EMBEDDING_URL')
        if env_url:
            self.local_embedding_url = env_url.strip()
        else:
            # Construct URL based on Docker environment
            default_host = 'embedding-server' if os.environ.get('DOCKER_ENV') else 'localhost'
            self.local_embedding_url = f'http://{default_host}:5003/embed'
        
        # Validate and normalize URL
        if not self.local_embedding_url.startswith('http://') and not self.local_embedding_url.startswith('https://'):
            logger.warning(f"⚠️ Invalid URL format, prepending http://: {self.local_embedding_url}")
            self.local_embedding_url = f"http://{self.local_embedding_url}"
        
        # Ensure URL ends with /embed if it doesn't already
        if not self.local_embedding_url.endswith('/embed'):
            if self.local_embedding_url.endswith('/'):
                self.local_embedding_url = f"{self.local_embedding_url}embed"
            else:
                self.local_embedding_url = f"{self.local_embedding_url}/embed"
        
        logger.info(f"🔧 Local embedding service URL configured: {self.local_embedding_url}")
        self.openai_api_key = os.environ.get('OPENAI_API_KEY')
        self.use_local = os.environ.get('USE_LOCAL_EMBEDDINGS', 'true').lower() == 'true'
        self.fallback_to_openai = os.environ.get('FALLBACK_TO_OPENAI', 'true').lower() == 'true'
        self.embedding_dimension = 1536  # Default to OpenAI dimension
        
        # Perform health check with caching (unless explicitly skipped)
        if not skip_health_check:
            self._check_health_with_cache()
        else:
            # Initialize defaults without health check
            logger.debug("Skipping health check during initialization")
    
    def _get_health_url(self) -> str:
        """Construct health check URL from embedding URL."""
        if self.local_embedding_url.endswith('/embed'):
            # Remove last 6 characters '/embed' and add '/health'
            return self.local_embedding_url[:-6] + '/health'
        elif self.local_embedding_url.endswith('embed'):
            # Remove last 5 characters 'embed' and add 'health'
            return self.local_embedding_url[:-5] + 'health'
        else:
            # Fallback: use rsplit to safely get base URL and append /health
            base_url = self.local_embedding_url.rsplit('/embed', 1)[0] if '/embed' in self.local_embedding_url else self.local_embedding_url.rstrip('/')
            return f"{base_url}/health"
    
    def _perform_health_check(self, force: bool = False) -> Dict[str, Any]:
        """
        Perform health check on embedding server (with caching).
        
        Args:
            force: If True, bypass cache and perform fresh health check
            
        Returns:
            Dict with health check results: {
                'available': bool,
                'embedding_dimension': int,
                'model_name': str,
                'error': Optional[str]
            }
        """
        global _health_check_cache, _last_health_check_time
        
        current_time = time.time()
        
        # Check cache validity (unless forced)
        if not force and _health_check_cache is not None:
            time_since_check = current_time - _last_health_check_time
            if time_since_check < _health_check_ttl:
                logger.debug(f"Using cached health check result (age: {time_since_check:.1f}s, TTL: {_health_check_ttl}s)")
                return _health_check_cache
        
        # Perform actual health check
        health_url = self._get_health_url()
        result = {
            'available': False,
            'embedding_dimension': 1536,  # Default to OpenAI dimension
            'model_name': 'unknown',
            'error': None
        }
        
        if not self.use_local:
            result['error'] = 'Local embeddings disabled'
            _health_check_cache = result
            _last_health_check_time = current_time
            return result
        
        try:
            logger.debug(f"🔍 Performing health check: {health_url}")
            response = requests.get(health_url, timeout=5)
            
            if response.status_code == 200:
                health_data = response.json()
                result['available'] = True
                result['embedding_dimension'] = health_data.get('dimensions', 384)
                result['model_name'] = health_data.get('model', 'unknown')
                logger.debug(f"✅ Health check passed: {result['model_name']} ({result['embedding_dimension']}d)")
            else:
                result['error'] = f"HTTP {response.status_code}"
                logger.warning(f"⚠️ Health check failed: HTTP {response.status_code}")
                
        except requests.exceptions.RequestException as e:
            error_str = str(e)
            result['error'] = error_str
            
            # Check for URL corruption issues
            if 'healthding' in health_url or 'healthding' in self.local_embedding_url:
                logger.error(f"❌ CRITICAL: Detected malformed URL with 'healthding'")
                logger.error(f"   This suggests a URL parsing bug or corrupted environment variable")
                # Force a clean URL reconstruction
                clean_host = 'embedding-server' if os.environ.get('DOCKER_ENV') else 'localhost'
                self.local_embedding_url = f'http://{clean_host}:5003/embed'
                logger.info(f"   Reconstructed clean URL: {self.local_embedding_url}")
                # Retry with corrected URL
                return self._perform_health_check(force=True)
            
            logger.debug(f"⚠️ Health check failed: {error_str}")
        
        # Cache the result
        _health_check_cache = result
        _last_health_check_time = current_time
        
        return result
    
    def _check_health_with_cache(self):
        """Check health using cached results when available."""
        # Store original preference from environment
        env_preference = os.environ.get('USE_LOCAL_EMBEDDINGS', 'true').lower() == 'true'
        
        health_result = self._perform_health_check()
        
        if health_result['available']:
            # Service is available - enable local mode if environment allows
            if env_preference:
                self.use_local = True
                self.embedding_dimension = health_result['embedding_dimension']
                model_name = health_result['model_name']
                logger.info(f"✅ Local embedding service available at {self.local_embedding_url}")
                logger.info(f"   Model: {model_name}, Dimensions: {self.embedding_dimension}")
            else:
                # Environment says not to use local, even if available
                self.use_local = False
                logger.info("Local embeddings disabled via USE_LOCAL_EMBEDDINGS env var")
        else:
            # Service unavailable
            if self.fallback_to_openai:
                self.use_local = False
                self.embedding_dimension = 1536  # OpenAI dimension
                logger.info("🔄 Falling back to OpenAI embeddings (for embedding generation only)")
                logger.info("   Note: Document context generation will use Anthropic fallback")
            else:
                self.use_local = False  # Still set to False even if no fallback
                logger.warning("Local embedding service unavailable and fallback disabled")
        
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
    
    def generate_document_context(
        self, 
        document_text: str, 
        metadata: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Generate document-level context using local service.
        
        Args:
            document_text: Full document text
            metadata: Document metadata (classification_type, original_filename, etc.)
            
        Returns:
            Dict with summary, entities, key_values, party_names, etc.
        """
        if not self.use_local:
            raise ValueError("Local embedding service not available")
        
        try:
            # Use context endpoint on same server
            # CRITICAL: Only replace trailing /embed to avoid corrupting hostname (e.g., 'embedding-server')
            if self.local_embedding_url.endswith('/embed'):
                # Remove last 6 characters '/embed' and add '/context/document'
                context_url = self.local_embedding_url[:-6] + '/context/document'
            else:
                base_url = self.local_embedding_url.rsplit('/embed', 1)[0] if '/embed' in self.local_embedding_url else self.local_embedding_url.rstrip('/')
                context_url = f"{base_url}/context/document"
            
            response = requests.post(
                context_url,
                json={
                    'text': document_text,
                    'metadata': metadata
                },
                timeout=60  # Allow time for processing
            )
            response.raise_for_status()
            result = response.json()
            
            logger.debug(f"Generated document context using local service")
            return result
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Local context generation failed: {e}")
            raise Exception(f"Failed to generate document context: {e}")
    
    def generate_chunk_contexts_batch(
        self, 
        chunks: List[str], 
        metadata: Dict[str, Any],
        batch_size: int = 8
    ) -> List[str]:
        """
        Generate chunk contexts in batches using local service.
        
        Args:
            chunks: List of chunk texts
            metadata: Document metadata
            batch_size: Number of chunks to process per batch (default: 8)
            
        Returns:
            List of context strings (same order as input chunks)
        """
        if not self.use_local:
            raise ValueError("Local embedding service not available")
        
        if not chunks:
            return []
        
        all_contexts = []
        total_chunks = len(chunks)
        
        logger.info(f"Generating contexts for {total_chunks} chunks (batch_size={batch_size})...")
        
        try:
            # Use context batch endpoint
            # CRITICAL: Only replace trailing /embed to avoid corrupting hostname (e.g., 'embedding-server')
            if self.local_embedding_url.endswith('/embed'):
                # Remove last 6 characters '/embed' and add '/context/batch'
                context_url = self.local_embedding_url[:-6] + '/context/batch'
            else:
                base_url = self.local_embedding_url.rsplit('/embed', 1)[0] if '/embed' in self.local_embedding_url else self.local_embedding_url.rstrip('/')
                context_url = f"{base_url}/context/batch"
            
            # Process in batches
            for i in range(0, total_chunks, batch_size):
                batch = chunks[i:i + batch_size]
                batch_num = (i // batch_size) + 1
                total_batches = (total_chunks + batch_size - 1) // batch_size
                
                logger.debug(f"Processing batch {batch_num}/{total_batches} ({len(batch)} chunks)...")
                
                response = requests.post(
                    context_url,
                    json={
                        'chunks': batch,
                        'metadata': metadata
                    },
                    timeout=120  # Allow time for batch processing
                )
                response.raise_for_status()
                result = response.json()
                
                batch_contexts = result.get('contexts', [])
                if len(batch_contexts) != len(batch):
                    logger.warning(
                        f"Context count mismatch: expected {len(batch)}, got {len(batch_contexts)}"
                    )
                    # Pad with empty strings if needed
                    while len(batch_contexts) < len(batch):
                        batch_contexts.append("")
                
                all_contexts.extend(batch_contexts)
            
            successful = len([c for c in all_contexts if c])
            logger.info(f"Generated {successful}/{total_chunks} chunk contexts")
            
            return all_contexts
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Local chunk context generation failed: {e}")
            # Return empty contexts on failure (graceful degradation)
            return [""] * len(chunks)


def get_default_service(force_refresh: bool = False) -> LocalEmbeddingService:
    """
    Get the default singleton LocalEmbeddingService instance.
    
    This factory function provides a thread-safe singleton pattern with TTL-based
    health check caching. Health checks are only performed:
    - On first instantiation
    - When cache expires (default: 60 seconds, configurable via EMBEDDING_HEALTH_CHECK_TTL)
    - When force_refresh=True
    
    This dramatically reduces the number of health check requests, making the service
    scalable for high-throughput scenarios (e.g., multiple Celery workers processing
    documents simultaneously).
    
    Args:
        force_refresh: If True, force a fresh health check even if cache is valid
        
    Returns:
        LocalEmbeddingService instance (singleton)
    
    Example:
        # Preferred usage (singleton with caching):
        service = get_default_service()
        
        # Force fresh health check:
        service = get_default_service(force_refresh=True)
        
        # Direct instantiation still works (but uses cached health checks):
        service = LocalEmbeddingService()
    """
    global _default_instance, _instance_lock
    
    # Double-checked locking pattern for thread safety
    if _default_instance is None or force_refresh:
        with _instance_lock:
            # Check again inside lock (another thread might have created it)
            if _default_instance is None or force_refresh:
                if force_refresh:
                    # Clear health check cache when forcing refresh
                    global _health_check_cache, _last_health_check_time
                    _health_check_cache = None
                    _last_health_check_time = 0
                    logger.info("🔄 Forcing refresh of embedding service health check")
                
                # Create new instance (will use cached health check if available)
                _default_instance = LocalEmbeddingService()
                logger.debug("✅ Created new LocalEmbeddingService singleton instance")
    
    return _default_instance


def clear_service_cache():
    """
    Clear the singleton instance and health check cache.
    
    Useful for testing or when you need to force complete re-initialization.
    """
    global _default_instance, _health_check_cache, _last_health_check_time
    
    with _instance_lock:
        _default_instance = None
        _health_check_cache = None
        _last_health_check_time = 0
        logger.debug("🧹 Cleared LocalEmbeddingService singleton and health check cache")


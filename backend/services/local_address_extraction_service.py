"""
Local Address Extraction Service using Ollama.

Extracts subject property address from document chunks using a local LLM.
Used for file system linking (not map display).

Similar pattern to local_embedding_service.py for consistency.
"""

import os
import requests
import logging
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

class LocalAddressExtractionService:
    """Service for extracting addresses using Ollama (local LLM)."""
    
    def __init__(self):
        """
        Initialize LocalAddressExtractionService.
        
        URL resolution priority:
        1. OLLAMA_URL environment variable (if set)
        2. Docker service name 'ollama' if DOCKER_ENV=true
        3. localhost (for local development)
        """
        # Get Ollama URL from environment
        # Priority: 1. OLLAMA_URL env var, 2. Docker service name if DOCKER_ENV, 3. localhost
        # In Docker: use service name 'ollama' on port 11434
        # Locally: use 'localhost' on port 11434
        env_url = os.environ.get('OLLAMA_URL')
        if env_url:
            self.ollama_url = env_url.strip().rstrip('/')
        else:
            # Construct URL based on Docker environment
            default_host = 'ollama' if os.environ.get('DOCKER_ENV') else 'localhost'
            self.ollama_url = f'http://{default_host}:11434'
        
        # Validate and normalize URL
        if not self.ollama_url.startswith('http://') and not self.ollama_url.startswith('https://'):
            logger.warning(f"⚠️ Invalid URL format, prepending http://: {self.ollama_url}")
            self.ollama_url = f"http://{self.ollama_url}"
        
        # Ensure URL doesn't have trailing slash
        self.ollama_url = self.ollama_url.rstrip('/')
        
        self.model_name = os.environ.get('OLLAMA_MODEL', 'llama3.2:3b')
        self.timeout = int(os.environ.get('OLLAMA_TIMEOUT', '15'))
        
        logger.info(f"🔧 Ollama service configured: {self.ollama_url}")
        logger.info(f"   Model: {self.model_name}")
        logger.info(f"   Timeout: {self.timeout}s")
    
    def _check_health(self) -> bool:
        """
        Check if Ollama service is available.
        
        Returns:
            True if Ollama is available, False otherwise
        """
        try:
            response = requests.get(
                f"{self.ollama_url}/api/tags",
                timeout=2
            )
            return response.status_code == 200
        except Exception as e:
            logger.debug(f"Ollama health check failed: {e}")
            return False
    
    def extract_address_from_chunks(
        self, 
        chunks: List[Dict[str, Any]],
        max_chunks: int = 10,
        max_chunk_length: int = 500
    ) -> Optional[Dict[str, Any]]:
        """
        Extract subject property address from document chunks.
        
        Args:
            chunks: List of chunk dictionaries with 'content' or 'text' field
            max_chunks: Maximum number of chunks to analyze (default: 10)
            max_chunk_length: Maximum characters per chunk to include (default: 500)
            
        Returns:
            Dict with 'address', 'confidence', 'source', and 'model', or None if not found
        """
        if not chunks:
            logger.warning("No chunks provided for address extraction")
            return None
        
        # Check health first, but don't fail completely - try the request anyway
        # Health check might fail even if Ollama is working (e.g., during startup)
        health_ok = self._check_health()
        if not health_ok:
            logger.warning("⚠️ Ollama health check failed, but attempting request anyway (health check may be unreliable)")
        
        # Get first few chunks (address is usually near the beginning)
        chunk_texts = []
        for chunk in chunks[:max_chunks]:
            content = chunk.get('content', '') or chunk.get('text', '') or chunk.get('chunk_text', '')
            if content:
                chunk_texts.append(content[:max_chunk_length])
        
        if not chunk_texts:
            logger.warning("No valid chunk content found for address extraction")
            return None
        
        combined_text = '\n\n'.join(chunk_texts)
        
        # Create optimized prompt for address extraction
        # This prompt is designed to extract property addresses from real estate documents
        prompt = f"""You are an expert at extracting property addresses from real estate documents.

Extract the SUBJECT PROPERTY address from the document text below. This is the property being valued, sold, or described in the document.

Instructions:
- Return ONLY the complete address (street number, street name, city/town, postcode if available)
- Do NOT include any additional text, explanations, or formatting
- If multiple addresses appear, extract the MAIN SUBJECT PROPERTY address (usually mentioned first or in a "Property Address" section)
- If no address is found, return exactly "NOT_FOUND"
- Format: "123 Main Street, London, SW1A 1AA" or similar

Document text:
{combined_text}

Address:"""
        
        try:
            logger.info(f"🔍 Extracting address using Ollama ({self.model_name})...")
            
            response = requests.post(
                f"{self.ollama_url}/api/generate",
                json={
                    "model": self.model_name,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0,  # Deterministic output
                        "num_predict": 200,  # Max tokens for address
                        "stop": ["\n\n", "Document"]  # Stop at new sections
                    }
                },
                timeout=self.timeout
            )
            
            response.raise_for_status()
            result = response.json()
            address = result.get('response', '').strip()
            
            # Clean up the response
            if "NOT_FOUND" in address.upper() or len(address) < 10:
                logger.info("❌ No address found in document")
                return None
            
            # Remove common prefixes/suffixes
            address = address.replace("Address:", "").strip()
            address = address.split("\n")[0].strip()  # Take first line only
            
            logger.info(f"✅ Address extracted: {address[:50]}...")
            
            return {
                'address': address,
                'confidence': 0.85,  # Ollama is good but not perfect
                'source': 'ollama',
                'model': self.model_name
            }
            
        except requests.exceptions.Timeout:
            logger.error(f"⏱️ Ollama request timed out after {self.timeout}s")
            return None
        except requests.exceptions.RequestException as e:
            logger.error(f"❌ Ollama request failed: {e}")
            return None
        except Exception as e:
            logger.error(f"❌ Unexpected error in address extraction: {e}")
            return None
    
    def extract_address_from_text(self, text: str) -> Optional[Dict[str, Any]]:
        """
        Extract address from raw text (convenience method).
        
        Args:
            text: Raw document text
            
        Returns:
            Dict with 'address' and 'confidence', or None if not found
        """
        # Convert text to chunk-like format
        chunks = [{'content': text[:2000]}]  # Limit to first 2000 chars
        return self.extract_address_from_chunks(chunks, max_chunks=1)


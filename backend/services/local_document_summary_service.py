"""
Local Document Summary Service using Ollama.

Generates structured document summaries for semantic search retrieval using a local LLM.
Used for Level 1 (document) retrieval in two-level RAG architecture.

Similar pattern to local_address_extraction_service.py for consistency.
"""

import os
import requests
import logging
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

class LocalDocumentSummaryService:
    """Service for generating document summaries using Ollama (local LLM)."""
    
    def __init__(self):
        """
        Initialize LocalDocumentSummaryService.
        
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
            
            # Smart fallback: If URL contains Docker service name but we're not in Docker,
            # try localhost instead (for running tests/scripts from host machine)
            if not os.environ.get('DOCKER_ENV') and '://ollama:' in self.ollama_url:
                # Running from host machine, Docker service name won't resolve
                # Try localhost instead
                self.ollama_url = self.ollama_url.replace('://ollama:', '://localhost:')
                logger.info(f"🔄 Detected Docker service URL but running outside Docker, using localhost")
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
        # Document summaries take longer than address extraction, so use longer timeout
        # For document summaries, we need at least 60s (address extraction uses 15s)
        # Check for document-specific timeout, otherwise use general timeout, otherwise default to 60s
        doc_timeout = os.environ.get('OLLAMA_DOCUMENT_TIMEOUT')  # Document-specific timeout
        if doc_timeout:
            self.timeout = int(doc_timeout)
        else:
            # Use general timeout if set, but ensure minimum 60s for document summaries
            general_timeout = int(os.environ.get('OLLAMA_TIMEOUT', '60'))
            self.timeout = max(general_timeout, 60)  # At least 60s for document summaries
        
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
                timeout=5  # Increased timeout for slower connections
            )
            if response.status_code == 200:
                return True
            else:
                logger.debug(f"Ollama health check returned status {response.status_code}")
                return False
        except requests.exceptions.Timeout:
            logger.debug(f"Ollama health check timed out after 5s (URL: {self.ollama_url})")
            return False
        except requests.exceptions.ConnectionError as e:
            logger.debug(f"Ollama health check connection error: {e} (URL: {self.ollama_url})")
            return False
        except Exception as e:
            logger.debug(f"Ollama health check failed: {e} (URL: {self.ollama_url})")
            return False
    
    def generate_document_summary(
        self,
        chunks: List[Dict[str, Any]],
        document_type: str,
        property_address: Optional[str] = None,
        max_chunks: int = 10,
        max_chunk_length: int = 2000
    ) -> Optional[str]:
        """
        Generate structured document summary for semantic search retrieval.
        
        This summary will be embedded and used for Level 1 (document) retrieval.
        Must be deterministic, structured, and 300-800 tokens.
        
        Args:
            chunks: List of chunk dictionaries with 'chunk_text_clean', 'chunk_text', or 'content' field
            document_type: Document classification type (e.g., 'valuation_report', 'letter_of_offer')
            property_address: Optional property address if known
            max_chunks: Maximum number of chunks to analyze (default: 10)
            max_chunk_length: Maximum characters per chunk to include (default: 2000)
            
        Returns:
            Structured summary text (300-800 tokens) or None if generation failed
        """
        if not chunks:
            logger.warning("No chunks provided for document summary generation")
            return None
        
        # Check health first, but don't fail completely - try the request anyway
        # Health check might fail even if Ollama is working (e.g., during startup)
        health_ok = self._check_health()
        if not health_ok:
            logger.warning("⚠️ Ollama health check failed, but attempting request anyway (health check may be unreliable)")
        
        # Get first few chunks (most relevant information usually at the beginning)
        chunk_texts = []
        total_length = 0
        max_total_length = 6000  # Limit total input to ~6000 chars for 3B model
        
        for chunk in chunks[:max_chunks]:
            # Try different field names for chunk text
            content = (
                chunk.get('chunk_text_clean', '') or 
                chunk.get('chunk_text', '') or 
                chunk.get('content', '') or
                chunk.get('text', '')
            )
            
            if content:
                # Truncate chunk if needed
                chunk_text = content[:max_chunk_length]
                
                # Check if adding this chunk would exceed total limit
                if total_length + len(chunk_text) > max_total_length:
                    # Add partial chunk to fill remaining space
                    remaining = max_total_length - total_length
                    if remaining > 100:  # Only add if meaningful amount left
                        chunk_texts.append(chunk_text[:remaining])
                    break
                
                chunk_texts.append(chunk_text)
                total_length += len(chunk_text)
        
        if not chunk_texts:
            logger.warning("No valid chunk content found for document summary generation")
            return None
        
        combined_text = '\n\n'.join(chunk_texts)
        
        # Create structured prompt for deterministic summary generation
        # This prompt is designed to generate summaries matching the architecture doc format
        address_line = f"Property Address: {property_address}\n" if property_address else ""
        
        prompt = f"""Summarize this document for search retrieval. Generate 400-800 tokens.

Document Type: {document_type}
{address_line}
Content:
{combined_text}

Format (one field per line):
Document Type: [type]
Primary Subject: [2-3 sentence description]
Property: [address or "Not specified"]
Time Period: [dates mentioned]
Key Numeric Facts: [all numbers, amounts, measurements]
Legal/Financial Nature: [document type and legal nature]
Key Topics: [10-15 comma-separated topics]
What This Document Answers: [5-10 specific questions]

Requirements:
- 400-800 tokens total (aim for 500-600)
- Be detailed and comprehensive
- List ALL numbers, dates, amounts found
- Include 10-15 topics, not just a few
- List 5-10 questions this document answers
- Use factual language only

Summary:"""
        
        try:
            logger.info(f"🔍 Generating document summary using Ollama ({self.model_name})...")
            logger.debug(f"   Input: {len(combined_text)} chars from {len(chunk_texts)} chunks")
            
            response = requests.post(
                f"{self.ollama_url}/api/generate",
                json={
                    "model": self.model_name,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0,  # CRITICAL: Deterministic output
                        "num_predict": 800,  # Target: 300-800 tokens (reduced from 1000 for faster generation)
                        "stop": ["\n\nDocument Type:", "\n\n---", "Document Content:"]  # Stop at new sections
                    }
                },
                timeout=self.timeout
            )
            
            response.raise_for_status()
            result = response.json()
            summary = result.get('response', '').strip()
            
            if not summary or len(summary) < 50:
                logger.warning("⚠️ Generated summary is too short or empty")
                return None
            
            # Post-process to ensure format consistency
            summary = self._post_process_summary(summary, document_type, property_address)
            
            logger.info(f"✅ Document summary generated: {len(summary)} chars")
            logger.debug(f"   Summary preview: {summary[:200]}...")
            
            return summary
            
        except requests.exceptions.Timeout:
            logger.error(f"⏱️ Ollama request timed out after {self.timeout}s")
            return None
        except requests.exceptions.RequestException as e:
            logger.error(f"❌ Ollama request failed: {e}")
            return None
        except Exception as e:
            logger.error(f"❌ Unexpected error in document summary generation: {e}")
            return None
    
    def _post_process_summary(self, summary: str, document_type: str, property_address: Optional[str]) -> str:
        """
        Post-process summary to ensure format consistency.
        
        Args:
            summary: Raw summary from Ollama
            document_type: Document type for validation
            property_address: Property address for validation
            
        Returns:
            Cleaned and formatted summary
        """
        # Remove common prefixes/suffixes that might be added
        summary = summary.strip()
        
        # Remove "Summary:" prefix if present
        if summary.startswith("Summary:"):
            summary = summary[8:].strip()
        
        # Ensure it starts with "Document Type:"
        if not summary.startswith("Document Type:"):
            # Try to find where "Document Type:" appears
            doc_type_idx = summary.find("Document Type:")
            if doc_type_idx > 0:
                summary = summary[doc_type_idx:].strip()
            else:
                # Prepend if missing
                summary = f"Document Type: {document_type}\n{summary}"
        
        # Remove markdown formatting (**, __, etc.) that Ollama sometimes adds
        import re
        summary = re.sub(r'\*\*([^*]+)\*\*', r'\1', summary)  # Remove **bold**
        summary = re.sub(r'__([^_]+)__', r'\1', summary)  # Remove __bold__
        summary = re.sub(r'\*([^*]+)\*', r'\1', summary)  # Remove *italic*
        summary = re.sub(r'_([^_]+)_', r'\1', summary)  # Remove _italic_
        
        # Ensure each field is on its own line
        # Replace multiple spaces/newlines with single newline
        summary = re.sub(r'\n{3,}', '\n\n', summary)  # Max 2 consecutive newlines
        summary = re.sub(r' +', ' ', summary)  # Single spaces
        
        # Validate required fields are present (at least check for key ones)
        required_fields = ["Document Type:", "Primary Subject:", "Key Topics:"]
        for field in required_fields:
            if field not in summary:
                logger.warning(f"⚠️ Required field '{field}' missing from summary, adding placeholder")
                if field == "Primary Subject:":
                    summary += f"\n{field} {document_type.replace('_', ' ').title()}"
                elif field == "Key Topics:":
                    summary += f"\n{field} {document_type.replace('_', ' ').title()}"
        
        return summary.strip()
    
    def generate_summary_from_text(
        self,
        text: str,
        document_type: str,
        property_address: Optional[str] = None
    ) -> Optional[str]:
        """
        Generate summary from raw text (convenience method).
        
        Args:
            text: Raw document text
            document_type: Document classification type
            property_address: Optional property address
            
        Returns:
            Structured summary text or None if generation failed
        """
        # Convert text to chunk-like format
        # Split into chunks of ~2000 chars
        chunk_size = 2000
        chunks = []
        for i in range(0, len(text), chunk_size):
            chunks.append({
                'chunk_text': text[i:i+chunk_size],
                'chunk_index': i // chunk_size
            })
        
        return self.generate_document_summary(
            chunks=chunks,
            document_type=document_type,
            property_address=property_address,
            max_chunks=10
        )


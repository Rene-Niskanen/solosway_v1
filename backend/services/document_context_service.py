"""
Document-Level Contextualization Service.

Generates ONE document-level summary instead of per-chunk contexts.
Uses local embedding service for fast, cheap context generation.
Falls back to Anthropic if local service unavailable.
Reduces costs by 99.7% (1 API call vs 307 per document).
"""

import anthropic
import json
import os
import re
from typing import Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)

class DocumentContextService:
    """Generate document-level context using local service or Anthropic fallback."""
    
    def __init__(self):
        # Check if we should use local context generation
        self.use_local_context = os.environ.get('USE_LOCAL_CONTEXT', 'true').lower() == 'true'
        
        # Initialize local embedding service if enabled (using singleton for scalability)
        self.local_service = None
        if self.use_local_context:
            try:
                from .local_embedding_service import get_default_service
                self.local_service = get_default_service()
                if self.local_service.is_local_available():
                    logger.info("Document Context Service enabled (Local Embedding Service)")
                else:
                    logger.warning("Local embedding service not available, will try Anthropic fallback")
                    self.local_service = None
            except Exception as e:
                logger.warning(f"Failed to initialize local embedding service: {e}")
                self.local_service = None
        
        # Initialize Anthropic as fallback
        self.anthropic_api_key = os.environ.get('ANTHROPIC_API_KEY')
        if self.anthropic_api_key:
            self.client = anthropic.Anthropic(api_key=self.anthropic_api_key)
            logger.info("Anthropic fallback available for document context")
        else:
            self.client = None
            if not self.local_service:
                logger.warning("Neither local service nor Anthropic available - using simple extraction")
    
    def generate_document_summary(
        self, 
        document_text: str, 
        metadata: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Generate ONE document-level summary with entities.
        
        Uses local embedding service if available, falls back to Anthropic or simple extraction.
        
        Returns:
            {
                "summary": "2-3 sentence document summary",
                "top_entities": list of key entities,
                "document_tags": list of categories,
                "subject_address": optional address/location,
                "key_dates": list of important dates,
                "key_values": dict of key-value pairs,
                "party_names": dict of role -> name (flexible roles per document type)
            }
        """
        # Try local service first (fast, cheap)
        if self.local_service and self.local_service.is_local_available():
            try:
                logger.debug("Using local embedding service for document context")
                return self.local_service.generate_document_context(document_text, metadata)
            except Exception as e:
                logger.warning(f"Local context generation failed: {e}, trying Anthropic fallback")
                # Fall through to Anthropic
        
        # Fallback to Anthropic if available
        if self.client:
            return self._generate_with_anthropic(document_text, metadata)
        
        # Last resort: simple extraction
            return self._generate_simple_summary(document_text, metadata)
    
    def _generate_with_anthropic(
        self, 
        document_text: str, 
        metadata: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Generate document summary using Anthropic Claude (fallback)."""
        
        # Limit document text to avoid token limits
        max_chars = 50000
        truncated_text = document_text[:max_chars]
        if len(document_text) > max_chars:
            truncated_text += "\n\n[... document truncated ...]"
        
        prompt = f"""Analyze this document and extract structured context. The document can be any type (contract, report, letter, form, valuation, etc.).

<document>
{truncated_text}
</document>

<metadata>
Document Type: {metadata.get('classification_type', 'Unknown')}
Filename: {metadata.get('original_filename', 'Unknown')}
</metadata>

Return JSON with:
1. summary: 2-3 sentences describing what the document is, its purpose, and main points (suitable for any document type)
2. top_entities: List of key entities mentioned (names, places, IDs, amounts — whatever is relevant)
3. document_tags: List of categories that fit the document (e.g. contract, report, letter, invoice, valuation, etc.)
4. subject_address: Primary address or location if relevant (optional; use null if not applicable)
5. key_dates: List of important dates
6. key_values: Object with key-value pairs (amounts, quantities, etc.)
7. party_names: Object mapping role names to person/entity names. Use whatever roles fit the document (e.g. author, signatory, client, vendor, valuer, buyer, seller, etc.). If a role is not found, set the value to null. Use snake_case for keys (e.g. author, signatory, valuer).

Return ONLY valid JSON, no markdown formatting:"""

        try:
            response = self.client.messages.create(
                model="claude-3-haiku-20240307",  # Cheapest model
                max_tokens=600,  # Increased to accommodate party_names extraction
                messages=[{"role": "user", "content": prompt}]
            )
            
            # Extract JSON from response
            content = response.content[0].text
            # Remove markdown code blocks if present
            content = re.sub(r'```json\s*', '', content)
            content = re.sub(r'```\s*', '', content)
            content = content.strip()
            
            return json.loads(content)
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse JSON response: {e}, using simple extraction")
            return self._generate_simple_summary(document_text, metadata)
        except Exception as e:
            logger.error(f"Anthropic context generation failed: {e}")
            return self._generate_simple_summary(document_text, metadata)
    
    def _generate_simple_summary(self, text: str, metadata: Dict) -> Dict:
        """Fallback: Simple regex-based extraction."""
        # Extract address
        address_patterns = [
            r'\b\d+[,\s]+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Road|Street|Avenue|Lane|Drive|Close|Way)\b',
            r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Road|Street|Avenue|Lane|Drive)\s+\d+\b'
        ]
        address = None
        for pattern in address_patterns:
            match = re.search(pattern, text)
            if match:
                address = match.group(0)
                break
        
        # Extract price
        price_patterns = [
            r'[£$€]\s*[\d,]+',
            r'[\d,]+\s*(?:KES|USD|GBP|EUR)',
            r'[\d,]+\s*million\s*(?:KES|USD|GBP)'
        ]
        price = None
        for pattern in price_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                price = match.group(0)
                break
        
        # Extract dates
        date_pattern = r'\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b'
        dates = re.findall(date_pattern, text)
        
        doc_type = metadata.get('classification_type', 'Document')
        return {
            "summary": f"{doc_type}. Document summary." if doc_type else "Document summary.",
            "top_entities": [e for e in [address, price] if e],
            "document_tags": [doc_type or 'document'] if doc_type else ['document'],
            "subject_property_address": address,
            "subject_address": address,
            "key_dates": dates[:5],  # Limit to 5 dates
            "key_values": {"price": price} if price else {},
            "party_names": {}
        }

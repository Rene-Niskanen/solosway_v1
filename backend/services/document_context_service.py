"""
Document-Level Contextualization Service.

Generates ONE document-level summary instead of per-chunk contexts.
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
    """Generate document-level context instead of per-chunk."""
    
    def __init__(self):
        self.anthropic_api_key = os.environ.get('ANTHROPIC_API_KEY')
        if self.anthropic_api_key:
            self.client = anthropic.Anthropic(api_key=self.anthropic_api_key)
            logger.info("Document Context Service enabled (Anthropic)")
        else:
            self.client = None
            logger.warning("ANTHROPIC_API_KEY not set - using simple extraction")
    
    def generate_document_summary(
        self, 
        document_text: str, 
        metadata: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Generate ONE document-level summary with entities.
        
        Returns:
            {
                "summary": "2-3 sentence document summary",
                "top_entities": ["address", "price", "date"],
                "document_tags": ["valuation", "inspection"],
                "subject_property_address": "...",
                "key_dates": ["2024-01-15"],
                "key_values": {"price": "£450,000", "size": "250 sqm"},
                "party_names": {
                    "valuer": "John Smith MRICS" or null,
                    "seller": "Jane Doe" or null,
                    "buyer": "Bob Johnson" or null,
                    "estate_agent": "Savills" or null
                }
            }
        """
        if not self.client:
            return self._generate_simple_summary(document_text, metadata)
        
        # Limit document text to avoid token limits
        max_chars = 50000
        truncated_text = document_text[:max_chars]
        if len(document_text) > max_chars:
            truncated_text += "\n\n[... document truncated ...]"
        
        prompt = f"""Analyze this real estate document and extract structured context.

<document>
{truncated_text}
</document>

<metadata>
Document Type: {metadata.get('classification_type', 'Unknown')}
Filename: {metadata.get('original_filename', 'Unknown')}
</metadata>

Return JSON with:
1. summary: 2-3 sentences situating the document (type, subject property, time period)
2. top_entities: List of key entities (addresses, parcel IDs, owner names, prices)
3. document_tags: List of document categories (valuation, inspection, sale, lease, etc.)
4. subject_property_address: Primary property address if found
5. key_dates: List of important dates (valuation date, sale date, etc.)
6. key_values: Object with key-value pairs (price, size, bedrooms, etc.)
7. party_names: Object with party names if found:
   - valuer: Name of the valuer/appraiser/surveyor who conducted the valuation/inspection (look for "MRICS", "FRICS", "inspected by", "valued by", "conducted by")
   - seller: Name of the seller/vendor if mentioned
   - buyer: Name of the buyer/purchaser if mentioned
   - estate_agent: Name of the estate agent/letting agent/marketing agent or agency (e.g., "Savills", "Knight Frank", etc.)

For party_names, extract the full name including any professional qualifications (MRICS, FRICS). If a name is not found, set the value to null.

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
            logger.error(f"Context generation failed: {e}")
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
        
        return {
            "summary": f"{metadata.get('classification_type', 'Document')} for property analysis",
            "top_entities": [e for e in [address, price] if e],
            "document_tags": [metadata.get('classification_type', 'document')],
            "subject_property_address": address,
            "key_dates": dates[:5],  # Limit to 5 dates
            "key_values": {"price": price} if price else {},
            "party_names": {
                "valuer": None,
                "seller": None,
                "buyer": None,
                "estate_agent": None
            }
        }

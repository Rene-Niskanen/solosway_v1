"""
BM25/full-text lexical search retriever using PostgreSQL tsvector.

This retriever searches chunk text directly (no embeddings required),
making it perfect for lazy embedding scenarios where chunks may not be embedded yet.
"""

from typing import List, Optional
from backend.llm.types import RetrievedDocument
from backend.services.supabase_client_factory import get_supabase_client
import logging
import json

logger = logging.getLogger(__name__)

class BM25DocumentRetriever:
    """BM25/full-text lexical search using PostgreSQL tsvector."""
    
    def __init__(self):
        self.supabase = get_supabase_client()
    
    def _preprocess_query(self, query_text: str) -> str:
        """
        Preprocess query for better BM25 matching.
        
        Handles:
        - Numbers: "5 bedroom" -> "5 bedroom bedrooms" (adds plural)
        - Common property terms: expands abbreviations
        - Removes stop words that don't help search
        """
        import re
        
        # Normalize whitespace
        query = ' '.join(query_text.split())
        
        # Handle numbers with property terms - add plural forms
        # "5 bedroom" -> "5 bedroom bedrooms" to match both singular and plural
        property_terms = {
            'bedroom': 'bedroom bedrooms bed',
            'bathroom': 'bathroom bathrooms bath',
            'room': 'room rooms',
            'bed': 'bed bedroom bedrooms',
            'bath': 'bath bathroom bathrooms'
        }
        
        for singular, expanded in property_terms.items():
            # Match patterns like "5 bedroom", "five bedroom", etc.
            pattern = rf'(\d+|five|four|three|two|one)\s+{singular}s?'
            def replace(match):
                num = match.group(1)
                return f'{num} {expanded}'
            query = re.sub(pattern, replace, query, flags=re.IGNORECASE)
        
        # Also handle standalone property terms
        for singular, expanded in property_terms.items():
            # If query contains just the singular, add plural
            if re.search(rf'\b{singular}\b', query, re.IGNORECASE) and not re.search(rf'\b{singular}s\b', query, re.IGNORECASE):
                query = query.replace(singular, expanded)
        
        return query
    
    def query_documents(
        self,
        query_text: str,
        top_k: int = 50,
        property_id: Optional[str] = None,
        classification_type: Optional[str] = None,
        business_id: Optional[str] = None
    ) -> List[RetrievedDocument]:
        """
        Search documents using BM25/full-text search.
        
        Best for: Exact matches (addresses, postcodes, property IDs, codes)
        Works on: ALL chunks (embedded or unembedded) - searches text directly
        
        Args:
            query_text: Search query
            top_k: Number of results to return
            property_id: Optional filter by property UUID
            classification_type: Optional filter (inspection, appraisal, etc)
            business_id: Optional filter by business ID
            
        Returns:
            List of RetrievedDocument with BM25 rank scores
        """
        try:
            # Preprocess query for better matching (handles plurals, numbers, etc.)
            processed_query = self._preprocess_query(query_text)
            logger.debug(f"BM25 query preprocessing: '{query_text}' -> '{processed_query}'")
            
            # Use RPC function for complex queries with JOINs
            payload = {
                'query_text': processed_query,
                'filter_property_id': property_id,
                'filter_classification_type': classification_type,
                'match_count': top_k
            }
            # Only add business_id if provided to avoid type issues
            if business_id:
                payload['filter_business_id'] = str(business_id)
            
            try:
                result = self.supabase.rpc('bm25_search_documents', payload).execute()
            except Exception as rpc_error:
                # Handle database function type mismatch gracefully
                error_msg = str(rpc_error)
                if 'does not match function result type' in error_msg or 'real' in error_msg.lower():
                    logger.warning(
                        "BM25 search failed due to database schema issue (real vs double precision). "
                        "This needs to be fixed in Supabase. Returning empty results."
                    )
                    result = type('obj', (object,), {'data': []})()  # Create empty result object
                else:
                    raise  # Re-raise if it's a different error
            
            # Convert to RetrievedDocument format with document-level context
            results = []
            
            # Cache document summaries to avoid repeated queries
            document_summaries_cache = {}
            
            for row in result.data:
                # Parse bbox if it's a JSON string
                bbox = row.get('bbox')
                if isinstance(bbox, str):
                    try:
                        bbox = json.loads(bbox)
                    except:
                        bbox = None
                elif bbox is None:
                    bbox = None
                
                doc_id = row.get('document_id')
                chunk_text = row.get('chunk_text', '')
                chunk_context = row.get('chunk_context', '')  # Legacy per-chunk context
                
                # Get document summary if available (for document-level contextualization)
                document_summary = None
                if doc_id and doc_id not in document_summaries_cache:
                    try:
                        doc_result = self.supabase.table('documents')\
                            .select('document_summary')\
                            .eq('id', doc_id)\
                            .maybe_single()\
                            .execute()
                        
                        if doc_result.data and doc_result.data.get('document_summary'):
                            summary_data = doc_result.data['document_summary']
                            # Handle both cases: dict (new format) or JSON string (old format)
                            if isinstance(summary_data, dict):
                                document_summary = summary_data
                            elif isinstance(summary_data, str):
                                # Try to parse JSON string (may be double-encoded)
                                try:
                                    document_summary = json.loads(summary_data)
                                    # If still a string after parsing, parse again
                                    if isinstance(document_summary, str):
                                        document_summary = json.loads(document_summary)
                                except (json.JSONDecodeError, TypeError):
                                    document_summary = None
                            else:
                                document_summary = summary_data
                            document_summaries_cache[doc_id] = document_summary
                    except Exception:
                        document_summaries_cache[doc_id] = None
                elif doc_id:
                    document_summary = document_summaries_cache.get(doc_id)
                
                # Build full content with document-level context prepended
                content_parts = []
                
                # Prepend document-level summary if available
                if document_summary:
                    # CRITICAL: Prepend party names first (valuer, seller, buyer, estate agent)
                    # This ensures the LLM has access to party information for name-based queries
                    party_names = document_summary.get('party_names', {})
                    if party_names:
                        name_parts = []
                        if valuer := party_names.get('valuer'):
                            name_parts.append(f"Valuer: {valuer}")
                        if seller := party_names.get('seller'):
                            name_parts.append(f"Seller: {seller}")
                        if buyer := party_names.get('buyer'):
                            name_parts.append(f"Buyer: {buyer}")
                        if agent := party_names.get('estate_agent'):
                            name_parts.append(f"Estate Agent: {agent}")
                        
                        if name_parts:
                            content_parts.append("PARTY_NAMES: " + " | ".join(name_parts))
                    
                    summary_text = document_summary.get('summary', '')
                    if summary_text:
                        content_parts.append(f"DOCUMENT: {summary_text}")
                    
                    property_addr = document_summary.get('subject_property_address')
                    if property_addr:
                        content_parts.append(f"PROPERTY: {property_addr}")
                    
                    key_values = document_summary.get('key_values', {})
                    if key_values:
                        key_vals_str = ', '.join([f"{k}: {v}" for k, v in key_values.items()])
                        if key_vals_str:
                            content_parts.append(f"KEY_VALUES: {key_vals_str}")
                
                # Add legacy chunk context if present (backward compatibility)
                if chunk_context:
                    content_parts.append(f"CHUNK_CONTEXT: {chunk_context}")
                
                # Add the actual chunk text
                content_parts.append(chunk_text)
                
                full_content = "\n\n".join(content_parts)
                
                # Get embedding status (for lazy embedding trigger)
                embedding_status = row.get('embedding_status', 'unknown')
                
                # Create document with embedding status stored as extra metadata
                doc = RetrievedDocument(
                    vector_id=row['id'],
                    doc_id=row['document_id'],
                    property_id=row.get('property_id'),
                    content=full_content,  # Now includes document summary + chunk
                    classification_type=row.get('classification_type', ''),
                    chunk_index=row.get('chunk_index', 0),
                    page_number=row.get('page_number', 0),
                    bbox=bbox,  # ✅ Bbox for location pinpointing
                    similarity_score=float(row.get('rank', 0.0)),  # BM25 rank
                    source="bm25",  # Mark as BM25 result
                    address_hash=row.get('address_hash'),
                    business_id=row.get('business_uuid'),
                )
                
                # Store embedding status as attribute (not in TypedDict, but accessible)
                doc['_embedding_status'] = embedding_status
                
                results.append(doc)
            
            logger.info(f"BM25 search returned {len(results)} documents for: {query_text[:50]}")
            return results
            
        except Exception as e:
            logger.error(f"BM25 search failed: {e}")
            import traceback
            traceback.print_exc()
            return []


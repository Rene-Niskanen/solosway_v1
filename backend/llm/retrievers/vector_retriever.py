"""
Vector similarity search retriever using Supabase pgvector.
"""

from typing import Optional, List, Set
import logging
import re

from backend.llm.types import RetrievedDocument
from backend.llm.config import config
from langchain_openai import OpenAIEmbeddings

from backend.services.supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)

PRICE_QUERY_PATTERN = re.compile(
    r'(?:£|\$|€)\s*\d|\b(?:price|value|valuation|market value|sale price|asking price|market rent)\b',
    re.IGNORECASE,
)
PRICE_CHUNK_PATTERN = re.compile(
    r'(?:£|\$|€)\s*\d[\d,\.]*(?:\s*(?:million|bn|billion|m))?|\bmarket value\b|\bopinion of value\b',
    re.IGNORECASE,
)

class VectorDocumentRetriever:
    """Query supabase pgvector using semantic similarity search."""
     
    def __init__(self):
        self.embeddings = OpenAIEmbeddings(
            api_key=config.openai_api_key,
            model=config.openai_embedding_model,
        )
        self.supabase = get_supabase_client()

    def _is_price_query(self, query: str) -> bool:
        return bool(PRICE_QUERY_PATTERN.search(query))

    def _get_adaptive_threshold(self, query: str) -> float:
        """
        Calculate adaptive similarity threshold based on query characteristics.
        
        Specific queries (with numbers, addresses) need higher thresholds.
        Semantic queries (descriptions, conditions) can use lower thresholds.
        
        Args:
            query: The user's search query
            
        Returns:
            Adaptive similarity threshold
        """
        # Check for specific indicators that suggest high-precision query
        has_numbers = bool(re.search(r'\d+', query))
        has_price = self._is_price_query(query)
        has_address = bool(re.search(r'\b(?:road|street|avenue|lane|drive|way|rd|st|ave)\b', query, re.IGNORECASE))
        is_short_query = len(query.split()) <= 3
        
        # Price-focused questions benefit from lower thresholds to improve recall
        if has_price:
            if has_numbers:
                return max(config.min_similarity_threshold, 0.28)
            return max(config.min_similarity_threshold, 0.32)
        
        if has_address:
            return 0.45  # Very specific query, need high precision
        if has_numbers or is_short_query:
            return 0.40  # Moderately specific
        
        # Lower threshold for semantic/descriptive queries (need recall)
        return config.similarity_threshold  # Default (0.35)
    
    def query_documents(
        self,
        user_query: str,
        top_k: int = None,
        property_id: Optional[str] = None,
        classification_type: Optional[str] = None,
        address_hash: Optional[str] = None,
        business_id: Optional[str] = None,
        document_ids: Optional[List[str]] = None,
    ) -> List[RetrievedDocument]:
        """
        Search for documents using semantic similarity with adaptive thresholding.

        Args:
            user_query: Natural language query to embed
            top_k: Number of results (defauls to config.vector_top_k)
            property_id: Optional filter by property UUID
            classification_type: Optional filter (inspection, appraisal, etc)
            address_hash: Optional filter by address hash 
            business_id: Optional filter by business ID

        Returns:
            List of RetrievedDocument dicts sorted by similarity
        """
        if top_k is None:
            top_k = config.vector_top_k

        try:
            document_ids_set: Optional[Set[str]] = set(document_ids) if document_ids else None
            # step one: embed the query 
            query_embedding = self.embeddings.embed_query(user_query)
            price_query = self._is_price_query(user_query)
            if price_query and top_k < config.vector_top_k * 2:
                top_k = config.vector_top_k * 2

            def _fetch(match_threshold: float, property_filter: Optional[str] = property_id):
                payload = {
                    'query_embedding': query_embedding,
                    'match_count': top_k,
                    'match_threshold': match_threshold,
                    'filter_classification_type': classification_type,
                    'filter_address_hash': address_hash
                }

                if property_filter:
                    payload['filter_property_id'] = property_filter
                # Add business_id if provided (now only UUID version exists after migration)
                if business_id:
                    payload['filter_business_id'] = str(business_id)
                
                try:
                    response = self.supabase.rpc('match_documents', payload).execute()
                    data = response.data or []
                    # DEBUG: Log bbox info from RPC response
                    if data:
                        for i, row in enumerate(data[:3]):
                            bbox_val = row.get('bbox')
                            logger.info(f"[BBOX RPC DEBUG] Row {i}: doc_id={row.get('document_id', '')[:8]}, chunk_idx={row.get('chunk_index')}, has_bbox={bool(bbox_val)}, bbox_type={type(bbox_val).__name__}, bbox_sample={str(bbox_val)[:100] if bbox_val else 'None'}")
                    if document_ids_set and not property_filter:
                        data = [
                            row for row in data
                            if row.get('document_id') in document_ids_set
                        ]
                    return data
                except Exception as rpc_error:
                    # Handle function overloading ambiguity
                    error_msg = str(rpc_error)
                    if 'Could not choose the best candidate function' in error_msg or 'PGRST203' in error_msg:
                        logger.warning(
                            "Vector search failed due to function overloading ambiguity. "
                            "Trying without business_id filter."
                        )
                        # Try without business_id filter if it causes ambiguity
                        if 'filter_business_id' in payload:
                            payload_without_business = payload.copy()
                            del payload_without_business['filter_business_id']
                            try:
                                response = self.supabase.rpc('match_documents', payload_without_business).execute()
                                # Filter results by business_id manually if needed
                                data = response.data or []
                                if business_id:
                                    data = [row for row in data if str(row.get('business_id', '')) == str(business_id)]
                                return data
                            except Exception:
                                pass
                        # If that fails, return empty results
                        logger.error("Vector search failed completely, returning empty results")
                        return []
                    else:
                        raise  # Re-raise if it's a different error

            # step two: Call supabase RPC with filters + adaptive threshold
            # NEW: Use adaptive threshold based on query characteristics
            primary_threshold = self._get_adaptive_threshold(user_query)
            logger.debug(f"Using adaptive threshold {primary_threshold:.2f} for query: {user_query[:50]}")
            rows = _fetch(primary_threshold)

            if not rows and primary_threshold > config.min_similarity_threshold:
                logger.info(
                    "Vector search returned no rows at threshold %.2f, retrying with %.2f",
                    primary_threshold,
                    config.min_similarity_threshold,
                )
                rows = _fetch(config.min_similarity_threshold)

            # If property filter excluded the known document, retry without the filter
            if (
                not rows
                and property_id
                and document_ids_set
            ):
                logger.info(
                    "Vector search returned 0 rows for property_id %s; retrying without property filter",
                    property_id[:8],
                )
                rows = _fetch(primary_threshold, property_filter=None)
                if not rows and primary_threshold > config.min_similarity_threshold:
                    rows = _fetch(config.min_similarity_threshold, property_filter=None)

            # step 3: convert to typed results with document-level context prepending
            results: List[RetrievedDocument] = []
            
            # Cache document summaries to avoid repeated queries
            document_summaries_cache = {}
            
            if price_query and rows:
                for row in rows:
                    chunk_text = row.get("chunk_text", "")
                    if PRICE_CHUNK_PATTERN.search(chunk_text):
                        row['similarity_score'] = (row.get('similarity_score') or 0.0) + 0.15

            for row in rows:
                doc_id = row.get("document_id")
                chunk_text = row.get("chunk_text", "")
                chunk_context = row.get("chunk_context", "")  # Legacy per-chunk context (may be empty)
                
                # Get document summary if available (for document-level contextualization)
                document_summary = None
                if doc_id and doc_id not in document_summaries_cache:
                    try:
                        # Try to fetch document summary from documents table
                        doc_result = self.supabase.table('documents')\
                            .select('document_summary')\
                            .eq('id', doc_id)\
                            .maybe_single()\
                            .execute()
                        
                        if doc_result.data and doc_result.data.get('document_summary'):
                            import json
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
                    except Exception as e:
                        # Document summary not available or table doesn't exist, continue without it
                        document_summaries_cache[doc_id] = None
                        logger.debug(f"Could not fetch document summary for {doc_id}: {e}")
                elif doc_id:
                    # Use cached summary
                    document_summary = document_summaries_cache.get(doc_id)
                
                # Build full content with document-level context prepended
                content_parts = []
                
                # Prepend document-level summary if available (NEW - document-level contextualization)
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
                    
                    # Add property address if available
                    property_addr = document_summary.get('subject_property_address')
                    if property_addr:
                        content_parts.append(f"PROPERTY: {property_addr}")
                    
                    # Add key values if available
                    key_values = document_summary.get('key_values', {})
                    if key_values:
                        key_vals_str = ', '.join([f"{k}: {v}" for k, v in key_values.items()])
                        if key_vals_str:
                            content_parts.append(f"KEY_VALUES: {key_vals_str}")
                
                # Add legacy chunk context if present (for backward compatibility)
                if chunk_context:
                    content_parts.append(f"CHUNK_CONTEXT: {chunk_context}")
                
                # Add the actual chunk text
                content_parts.append(chunk_text)
                
                # Combine all parts
                full_content = "\n\n".join(content_parts)
                
                # Parse bbox from JSON string if needed (stored as JSON string in database)
                raw_bbox = row.get("bbox")
                parsed_bbox = None
                if raw_bbox:
                    if isinstance(raw_bbox, dict):
                        parsed_bbox = raw_bbox
                    elif isinstance(raw_bbox, str):
                        try:
                            import json
                            parsed_bbox = json.loads(raw_bbox)
                        except (json.JSONDecodeError, TypeError):
                            parsed_bbox = None
                
                results.append(
                    RetrievedDocument(
                        vector_id=row["id"],
                        doc_id=row["document_id"],
                        property_id=row.get("property_id"),
                        content=full_content,  # Now includes document summary + chunk
                        classification_type=row.get("classification_type", ""),
                        chunk_index=row.get("chunk_index", 0),
                        page_number=row.get("page_number", 0),
                        bbox=parsed_bbox,  # Now parsed from JSON string
                        similarity_score=float(row.get("similarity", 0.0)),
                        source="vector",
                        address_hash=row.get("address_hash"),
                        business_id=row.get("business_uuid"),
                        original_filename=row.get("original_filename"),
                        property_address=row.get("property_address") or row.get("formatted_address"),
                    )
                )

            logger.info(f"Vector search returned {len(results)} documents for query: {user_query[:50]}")
            return results

        except Exception as e:
            logger.error(f"vector retrieval failed: {e}")
            return []



    
"""
Vector similarity search retriever using Supabase pgvector.
"""

from typing import Optional, List
from backend.llm.types import RetrievedDocument
from backend.llm.config import config 
from backend.llm.utils import batch_expand_chunks, merge_expanded_chunks
from langchain_openai import OpenAIEmbeddings
import logging 
import os

from backend.services.supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)

class VectorDocumentRetriever:
    """Query supabase pgvector using semantic similarity search."""
     
    def __init__(self):
        use_voyage = os.environ.get('USE_VOYAGE_EMBEDDINGS', 'true').lower() == 'true'
        
        if use_voyage:
            # Use Voyage AI for query embeddings
            from voyageai import Client  # type: ignore
            voyage_api_key = os.environ.get('VOYAGE_API_KEY')
            if not voyage_api_key:
                raise ValueError("VOYAGE_API_KEY required when USE_VOYAGE_EMBEDDINGS=true")
            
            self.voyage_client = Client(api_key=voyage_api_key)
            self.voyage_model = os.environ.get('VOYAGE_EMBEDDING_MODEL', 'voyage-law-2')
            self.use_voyage = True
            logger.info(f"Using Voyage AI for query embeddings: {self.voyage_model}")
        else:
            # Use OpenAI (existing code)
            self.embeddings = OpenAIEmbeddings(
                api_key=config.openai_api_key,
                model=config.openai_embedding_model,
            )
            self.use_voyage = False
        
        self.supabase = get_supabase_client()

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
        import re
        
        # Check for specific indicators that suggest high-precision query
        has_numbers = bool(re.search(r'\d+', query))
        has_price = bool(re.search(r'[\$£€]\s*\d+|price|cost|value', query, re.IGNORECASE))
        has_address = bool(re.search(r'\b(?:road|street|avenue|lane|drive|way|rd|st|ave)\b', query, re.IGNORECASE))
        is_short_query = len(query.split()) <= 3
        
        # Higher threshold for specific queries (need precision)
        if (has_numbers and has_price) or has_address:
            return 0.45  # Very specific query, need high similarity
        elif has_numbers or is_short_query:
            return 0.40  # Moderately specific
        else:
            # Lower threshold for semantic/descriptive queries (need recall)
            return config.similarity_threshold  # Default (0.35)
    
    def query_documents(
        self,
        user_query: str,
        top_k: int = None,
        property_id: Optional[str] = None,
        classification_type: Optional[str] = None,
        address_hash: Optional[str] = None,
        business_id: Optional[str] = None
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
            # step one: embed the query 
            if self.use_voyage:
                # Use Voyage AI for query embedding
                response = self.voyage_client.embed(
                    texts=[user_query],
                    model=self.voyage_model,
                    input_type='query'  # Use 'query' for query embeddings
                )
                query_embedding = response.embeddings[0]
            else:
                # Use OpenAI
                query_embedding = self.embeddings.embed_query(user_query)

            def _fetch(match_threshold: float):
                payload = {
                    'query_embedding': query_embedding,
                    'match_count': top_k,
                    'match_threshold': match_threshold,
                    'filter_property_id': property_id,
                    'filter_classification_type': classification_type,
                    'filter_address_hash': address_hash
                }
                # Add business_id if provided (now only UUID version exists after migration)
                if business_id:
                    payload['filter_business_id'] = str(business_id)
                
                try:
                    response = self.supabase.rpc('match_documents', payload).execute()
                    return response.data or []
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

            # step 3: convert to typed results with document-level context prepending
            results: List[RetrievedDocument] = []
            
            # Cache document summaries to avoid repeated queries
            document_summaries_cache = {}
            
            # NEW: Batch expand chunks if enabled (more efficient than expanding one-by-one)
            expanded_chunks_cache = {}
            if config.chunk_expansion_enabled and rows:
                # Prepare list of chunks that need expansion
                chunks_to_expand = []
                for row in rows:
                    doc_id = row.get("document_id")
                    chunk_index = row.get("chunk_index")
                    if doc_id and chunk_index is not None:
                        chunks_to_expand.append({
                            'doc_id': doc_id,
                            'chunk_index': chunk_index
                        })
                
                # Batch expand all chunks in one go (efficient)
                if chunks_to_expand:
                    try:
                        expanded_chunks_cache = batch_expand_chunks(
                            chunk_list=chunks_to_expand,
                            expand_left=config.chunk_expansion_size,
                            expand_right=config.chunk_expansion_size,
                            supabase_client=self.supabase
                        )
                        logger.debug(f"Batch expanded {len(expanded_chunks_cache)}/{len(chunks_to_expand)} chunks")
                    except Exception as e:
                        logger.warning(f"Chunk expansion failed, falling back to original chunks: {e}")
                        expanded_chunks_cache = {}
            
            # Batch fetch missing filenames for documents that don't have original_filename from RPC
            document_filenames_cache = {}
            doc_ids_missing_filename = []
            for row in rows:
                doc_id = row.get("document_id")
                if doc_id and not row.get("original_filename"):
                    doc_ids_missing_filename.append(doc_id)
            
            if doc_ids_missing_filename:
                try:
                    # Batch fetch filenames for documents missing them
                    unique_doc_ids = list(set(doc_ids_missing_filename))
                    filename_results = self.supabase.table('documents')\
                        .select('id, original_filename')\
                        .in_('id', unique_doc_ids)\
                        .execute()
                    
                    for doc_row in filename_results.data:
                        doc_id = doc_row.get('id')
                        filename = doc_row.get('original_filename')
                        if doc_id and filename:
                            document_filenames_cache[doc_id] = filename
                    
                    logger.debug(f"Fetched {len(document_filenames_cache)} missing filenames from documents table")
                except Exception as e:
                    logger.warning(f"Could not fetch missing filenames: {e}")
            
            for row in rows:
                doc_id = row.get("document_id")
                chunk_index = row.get("chunk_index", 0)
                chunk_text = row.get("chunk_text", "")
                chunk_context = row.get("chunk_context", "")  # Legacy per-chunk context (may be empty)
                
                # NEW: Use expanded chunks if expansion is enabled and available
                if config.chunk_expansion_enabled:
                    expanded_chunks = expanded_chunks_cache.get((doc_id, chunk_index))
                    if expanded_chunks:
                        # Use expanded chunks (merge with separator for LLM)
                        chunk_text = merge_expanded_chunks(expanded_chunks)
                        logger.debug(f"Using expanded chunks for doc {doc_id[:8]}, chunk {chunk_index} ({len(expanded_chunks)} chunks)")
                    # If expansion failed or not available, fall back to original chunk_text
                
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
                
                # Get original_filename from row, or fallback to cache if missing
                original_filename = row.get("original_filename")
                if not original_filename and doc_id:
                    original_filename = document_filenames_cache.get(doc_id)
                
                results.append(
                    RetrievedDocument(
                        vector_id=row["id"],
                        doc_id=row["document_id"],
                        property_id=row.get("property_id"),
                        content=full_content,  # Now includes document summary + chunk
                        classification_type=row.get("classification_type", ""),
                        chunk_index=row.get("chunk_index", 0),
                        page_number=row.get("page_number", 0),
                        bbox=row.get("bbox"),
                        similarity_score=float(row.get("similarity", 0.0)),
                        source="vector",
                        address_hash=row.get("address_hash"),
                        business_id=row.get("business_uuid"),
                        original_filename=original_filename,
                        property_address=row.get("property_address") or row.get("formatted_address"),
                    )
                )

            logger.info(f"Vector search returned {len(results)} documents for query: {user_query[:50]}")
            return results

        except Exception as e:
            logger.error(f"vector retrieval failed: {e}")
            return []



    
"""
Hybrid Document Retriever combining BM25 (lexical) + Vector (semantic) search.

Strategy:
1. BM25 for exact matches (addresses, postcodes, IDs) - works on ALL chunks
2. Vector for semantic matches (descriptions, concepts) - only embedded chunks
3. Combines results with Reciprocal Rank Fusion (RRF)

Note: All chunks are embedded immediately when documents are processed (lazy_embedding=False).
The lazy embedding trigger is disabled by default but kept for edge cases (legacy documents).
"""

from typing import List, Optional
from backend.llm.types import RetrievedDocument
from backend.llm.retrievers.bm25_retriever import BM25DocumentRetriever
from backend.llm.retrievers.vector_retriever import VectorDocumentRetriever
from backend.llm.utils import reciprocal_rank_fusion
import logging
import concurrent.futures
import os
import re
import time

logger = logging.getLogger(__name__)

class HybridDocumentRetriever:
    """
    Combines BM25 (lexical) + Vector (semantic) search with RRF.
    
    Strategy:
    1. BM25 for exact matches (addresses, postcodes, IDs) - works on ALL chunks
    2. Vector for semantic matches (descriptions, concepts) - only embedded chunks
    3. RRF to merge and rank results
    
    Note: All chunks are embedded immediately when documents are processed.
    Lazy embedding trigger is disabled by default (set to False) to avoid unnecessary overhead.
    """
    
    def __init__(self):
        self.bm25_retriever = BM25DocumentRetriever()
        self.vector_retriever = VectorDocumentRetriever()
    
    def query_documents(
        self,
        user_query: str,
        top_k: int = None,  # Default will be set from env var or 25
        property_id: Optional[str] = None,
        classification_type: Optional[str] = None,
        business_id: Optional[str] = None,
        document_ids: Optional[List[str]] = None,  # NEW: Filter by specific document IDs
        bm25_weight: float = 0.4,  # 40% BM25, 60% vector
        vector_weight: float = 0.6,
        trigger_lazy_embedding: bool = False  # Disabled by default (all chunks embedded upfront)
    ) -> List[RetrievedDocument]:
        """
        Hybrid search: BM25 + Vector with weighted RRF and lazy embedding triggers.
        
        Now runs BM25 and Vector searches in parallel for better performance.
        
        Args:
            user_query: User's search query
            top_k: Number of results to return (default: 25, configurable via INITIAL_RETRIEVAL_TOP_K)
            property_id: Optional filter by property UUID
            classification_type: Optional filter
            business_id: Optional filter by business ID
            document_ids: Optional list of document IDs to filter results to (NEW)
            bm25_weight: Weight for BM25 results in RRF (default 0.4)
            vector_weight: Weight for Vector results in RRF (default 0.6)
            trigger_lazy_embedding: If True, triggers embedding for unembedded chunks (disabled by default)
            
        Returns:
            List of RetrievedDocument sorted by combined RRF score
        """
        # Set default top_k from env var or use 25 (reduced from 50 for performance)
        if top_k is None:
            top_k = int(os.getenv("INITIAL_RETRIEVAL_TOP_K", "25"))
        
        # Prepare document_ids set for logging (filtering now happens in individual retrievers)
        if document_ids and len(document_ids) > 0:
            logger.info(f"[HYBRID_SEARCH] Document filtering enabled: {len(document_ids)} document(s) selected - filtering at retriever level")
            # When searching within a single document, increase top_k to get more candidates
            # because the search space is smaller
            if len(document_ids) == 1:
                top_k = max(top_k, 50)  # Minimum 50 chunks for single-document search
                logger.info(f"[HYBRID_SEARCH] Single-document search detected - increased top_k to {top_k} for better coverage")
        
        # Check if parallel search is enabled (default: True)
        enable_parallel = os.getenv("ENABLE_PARALLEL_HYBRID_SEARCH", "true").lower() == "true"
        
        # Check if early exit is enabled (default: False - too aggressive, causing issues)
        enable_early_exit = os.getenv("ENABLE_EARLY_EXIT_BM25", "false").lower() == "true"
        
        start_time = time.time()
        
        if enable_parallel:
            # Run BM25 and Vector searches in parallel using ThreadPoolExecutor
            logger.info(f"[HYBRID_SEARCH] Starting parallel search (BM25 + Vector) for query: '{user_query[:50]}...'")
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                # Submit both searches concurrently
                bm25_start = time.time()
                bm25_future = executor.submit(
                    self.bm25_retriever.query_documents,
                    query_text=user_query,
                    top_k=top_k * 2,  # Get more candidates for better coverage
                    property_id=property_id,
                    classification_type=classification_type,
                    business_id=business_id,
                    document_ids=document_ids  # NEW: Pass document_ids for filtering
                )
                
                vector_start = time.time()
                vector_future = executor.submit(
                    self.vector_retriever.query_documents,
                    user_query=user_query,
                    top_k=top_k,
                    property_id=property_id,
                    classification_type=classification_type,
                    business_id=business_id,
                    document_ids=document_ids  # NEW: Pass document_ids for filtering
                )
                
                # Wait for BM25 first to check for early exit (with timeout to prevent hanging)
                try:
                    bm25_results = bm25_future.result(timeout=30)  # 30s timeout
                    # Note: Filtering by document_ids now happens inside BM25 retriever
                    bm25_time = time.time() - bm25_start
                    logger.info(f"[HYBRID_SEARCH] BM25 search completed in {bm25_time:.2f}s, found {len(bm25_results)} results" + (f" (filtered to {len(document_ids)} selected documents)" if document_ids else ""))
                except concurrent.futures.TimeoutError:
                    logger.error(f"[HYBRID_SEARCH] BM25 search timed out after 30s")
                    bm25_results = []
                    bm25_time = 30.0
                
                # Early exit: Skip vector search if BM25 found high-confidence exact matches
                # DISABLED BY DEFAULT - too aggressive, can miss semantic matches
                if enable_early_exit and bm25_results:
                    top_bm25_score = bm25_results[0].get('similarity_score', 0.0) if bm25_results else 0.0
                    # Check if query contains specific identifiers (postcodes, property names)
                    has_postcode = bool(re.search(r'[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2}', user_query, re.IGNORECASE))
                    has_property_name = any(len(w) > 3 and w[0].isupper() and w[1:].islower() for w in user_query.split())
                    
                    # Skip vector search if:
                    # 1. BM25 top result has very high score (>0.95, stricter) AND
                    # 2. Query contains postcode (not just property name - too broad)
                    if top_bm25_score > 0.95 and has_postcode:
                        logger.info(
                            f"[HYBRID_SEARCH] Early exit: BM25 found very high-confidence match (score={top_bm25_score:.2f}) "
                            f"with postcode, skipping vector search"
                        )
                        vector_results = []
                    else:
                        # Wait for vector search to complete (with timeout)
                        try:
                            vector_results = vector_future.result(timeout=30)  # 30s timeout
                            # Note: Filtering by document_ids now happens inside Vector retriever
                            vector_time = time.time() - vector_start
                            logger.info(f"[HYBRID_SEARCH] Vector search completed in {vector_time:.2f}s, found {len(vector_results)} results" + (f" (filtered to {len(document_ids)} selected documents)" if document_ids else ""))
                        except concurrent.futures.TimeoutError:
                            logger.error(f"[HYBRID_SEARCH] Vector search timed out after 30s")
                            vector_results = []
                            vector_time = 30.0
                else:
                    # Wait for both to complete (with timeout)
                    try:
                        vector_results = vector_future.result(timeout=30)  # 30s timeout
                        # Note: Filtering by document_ids now happens inside Vector retriever
                        vector_time = time.time() - vector_start
                        logger.info(f"[HYBRID_SEARCH] Vector search completed in {vector_time:.2f}s, found {len(vector_results)} results" + (f" (filtered to {len(document_ids)} selected documents)" if document_ids else ""))
                    except concurrent.futures.TimeoutError:
                        logger.error(f"[HYBRID_SEARCH] Vector search timed out after 30s")
                        vector_results = []
                        vector_time = 30.0
        else:
            # Sequential fallback (original behavior)
        # Step 1: BM25 search (fast, exact matches, works on unembedded chunks)
            bm25_start_time = time.perf_counter()
            bm25_results = self.bm25_retriever.query_documents(
                query_text=user_query,
                top_k=top_k * 2,  # Get more candidates for better coverage
                property_id=property_id,
                classification_type=classification_type,
                business_id=business_id,
                document_ids=document_ids  # NEW: Pass document_ids for filtering
            )
            # Note: Filtering by document_ids now happens inside BM25 retriever
            bm25_time = time.perf_counter() - bm25_start_time
            logger.info(f"[HYBRID_SEARCH] BM25 search completed in {bm25_time:.2f}s, found {len(bm25_results)} results (sequential)" + (f" (filtered to {len(document_ids)} selected documents)" if document_ids else ""))
            
            # Step 2: Vector search (semantic matches, only on embedded chunks)
            # Early exit disabled by default - always run vector search for better results
            vector_start_time = time.perf_counter()
            vector_results = self.vector_retriever.query_documents(
                user_query=user_query,
                top_k=top_k,
                property_id=property_id,
                classification_type=classification_type,
                business_id=business_id,
                document_ids=document_ids  # NEW: Pass document_ids for filtering
            )
            # Note: Filtering by document_ids now happens inside Vector retriever
            vector_time = time.perf_counter() - vector_start_time
            logger.info(f"[HYBRID_SEARCH] Vector search completed in {vector_time:.2f}s, found {len(vector_results)} results (sequential)" + (f" (filtered to {len(document_ids)} selected documents)" if document_ids else ""))
        
        # Step 3: Identify unembedded chunks and trigger lazy embedding (after both searches complete)
        unembedded_chunk_ids = []
        unembedded_doc_ids = set()
        
        if trigger_lazy_embedding:
            for result in bm25_results:
                # Check if chunk needs embedding (using internal field)
                # result is a dict (RetrievedDocument), so use .get()
                embedding_status = result.get('_embedding_status')
                if embedding_status in ('pending', None) or embedding_status is None:
                    chunk_id = result.get('vector_id')
                    doc_id = result.get('doc_id')
                    if chunk_id and doc_id:
                        unembedded_chunk_ids.append((chunk_id, doc_id))
                        unembedded_doc_ids.add(doc_id)
            
            # Trigger lazy embedding for unembedded chunks (high priority)
            if unembedded_chunk_ids:
                try:
                    from backend.tasks import embed_chunk_on_demand, embed_document_chunks_lazy
                    
                    # Limit to top 20 chunks to avoid overwhelming the queue
                    chunks_to_embed = unembedded_chunk_ids[:20]
                    
                    # Trigger embedding for individual chunks (high priority)
                    for chunk_id, doc_id in chunks_to_embed:
                        embed_chunk_on_demand.delay(chunk_id, doc_id)
                    
                    # Also trigger batch embedding for documents (catches remaining chunks)
                    for doc_id in list(unembedded_doc_ids)[:5]:  # Limit to 5 documents
                        embed_document_chunks_lazy.delay(str(doc_id), priority='high')
                    
                    logger.info(
                        f"🚀 Triggered lazy embedding for {len(chunks_to_embed)} chunks "
                        f"from {len(unembedded_doc_ids)} documents"
                    )
                except Exception as e:
                    logger.warning(f"Failed to trigger lazy embedding: {e}")
        
        # Step 4: Merge with weighted RRF
        # RRF expects lists of dicts with 'doc_id' key, not wrapped in 'doc'
        # Apply weights to similarity scores before RRF
        weighted_bm25 = []
        for r in bm25_results:
            weighted_r = r.copy()
            weighted_r['similarity_score'] = (r.get('similarity_score', 0.0) * bm25_weight)
            weighted_bm25.append(weighted_r)
        
        weighted_vector = []
        for r in vector_results:
            weighted_r = r.copy()
            weighted_r['similarity_score'] = (r.get('similarity_score', 0.0) * vector_weight)
            weighted_vector.append(weighted_r)
        
        # OPTIMIZATION: Adaptive RRF k parameter based on result set size
        total_results = len(weighted_bm25) + len(weighted_vector)
        if total_results > 100:
            rrf_k = 60  # Large result set: use higher k for better ranking
        elif total_results > 50:
            rrf_k = 40  # Medium result set: moderate k
        else:
            rrf_k = 30  # Small result set: more aggressive ranking
        
        # Merge with RRF (expects lists of dicts with 'doc_id' key)
        merged = reciprocal_rank_fusion([weighted_bm25, weighted_vector], k=rrf_k)
        
        # Return top-k
        final_results = merged[:top_k]
        
        total_time = time.time() - start_time
        search_mode = "parallel" if enable_parallel else "sequential"
        logger.info(
            f"[HYBRID_SEARCH] {search_mode.capitalize()} search completed in {total_time:.2f}s: "
            f"BM25={len(bm25_results)}, Vector={len(vector_results)}, Final={len(final_results)}"
            + (f" (triggered embedding for {len(unembedded_chunk_ids)} chunks)" if unembedded_chunk_ids else "")
        )
        
        return final_results


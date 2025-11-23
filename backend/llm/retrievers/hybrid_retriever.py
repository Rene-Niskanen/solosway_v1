"""
Hybrid Document Retriever combining BM25 (lexical) + Vector (semantic) search.

Uses BM25-first strategy for lazy embedding:
1. BM25 finds relevant chunks (works on unembedded chunks)
2. Triggers lazy embedding for unembedded chunks
3. Vector search on embedded chunks only
4. Combines results with Reciprocal Rank Fusion (RRF)
"""

from typing import List, Optional
from backend.llm.types import RetrievedDocument
from backend.llm.retrievers.bm25_retriever import BM25DocumentRetriever
from backend.llm.retrievers.vector_retriever import VectorDocumentRetriever
from backend.llm.utils import reciprocal_rank_fusion
import logging

logger = logging.getLogger(__name__)

class HybridDocumentRetriever:
    """
    Combines BM25 (lexical) + Vector (semantic) search with RRF.
    
    Strategy (BM25-First for Lazy Embedding):
    1. BM25 for exact matches (addresses, postcodes, IDs) - works on ALL chunks
    2. Trigger lazy embedding for unembedded chunks found by BM25
    3. Vector for semantic matches (descriptions, concepts) - only embedded chunks
    4. RRF to merge and rank results
    """
    
    def __init__(self):
        self.bm25_retriever = BM25DocumentRetriever()
        self.vector_retriever = VectorDocumentRetriever()
    
    def query_documents(
        self,
        user_query: str,
        top_k: int = 50,
        property_id: Optional[str] = None,
        classification_type: Optional[str] = None,
        business_id: Optional[str] = None,
        bm25_weight: float = 0.4,  # 40% BM25, 60% vector
        vector_weight: float = 0.6,
        trigger_lazy_embedding: bool = True  # Enable lazy embedding triggers
    ) -> List[RetrievedDocument]:
        """
        Hybrid search: BM25 + Vector with weighted RRF and lazy embedding triggers.
        
        Args:
            user_query: User's search query
            top_k: Number of results to return
            property_id: Optional filter by property UUID
            classification_type: Optional filter
            business_id: Optional filter by business ID
            bm25_weight: Weight for BM25 results in RRF (default 0.4)
            vector_weight: Weight for Vector results in RRF (default 0.6)
            trigger_lazy_embedding: If True, triggers embedding for unembedded chunks
            
        Returns:
            List of RetrievedDocument sorted by combined RRF score
        """
        # Step 1: BM25 search (fast, exact matches, works on unembedded chunks)
        bm25_results = self.bm25_retriever.query_documents(
            query_text=user_query,
            top_k=top_k * 2,  # Get more candidates for better coverage
            property_id=property_id,
            classification_type=classification_type,
            business_id=business_id
        )
        
        # Step 2: Identify unembedded chunks and trigger lazy embedding
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
        
        # Step 3: Vector search (semantic matches, only on embedded chunks)
        vector_results = self.vector_retriever.query_documents(
            user_query=user_query,
            top_k=top_k,
            property_id=property_id,
            classification_type=classification_type,
            business_id=business_id
        )
        
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
        
        # Merge with RRF (expects lists of dicts with 'doc_id' key)
        merged = reciprocal_rank_fusion([weighted_bm25, weighted_vector], k=60)
        
        # Return top-k
        final_results = merged[:top_k]
        
        logger.info(
            f"Hybrid search: BM25={len(bm25_results)}, Vector={len(vector_results)}, "
            f"Final={len(final_results)} (triggered embedding for {len(unembedded_chunk_ids)} chunks)"
        )
        
        return final_results


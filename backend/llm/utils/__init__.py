"""
Utility functions for LLM pipeline.
"""

from typing import List, Dict

# Import chunk expansion utilities
from .chunk_expansion import (
    expand_chunk_with_adjacency,
    batch_expand_chunks,
    merge_expanded_chunks
)

__all__ = [
    'reciprocal_rank_fusion',
    'expand_chunk_with_adjacency',
    'batch_expand_chunks',
    'merge_expanded_chunks'
]


def reciprocal_rank_fusion(result_lists: List[List[dict]], k: int = 60) -> List[dict]:
    """
    Merge multiple ranked lists using Reciprocal Rank Fusion (RRF).
    
    RRF is better than simple deduplication - it combines ranking signals
    from multiple searches to produce a better overall ranking.
    
    Formula: RRF_score(d) = Σ(1 / (k + rank_i(d)))
    where rank_i(d) is the rank of document d in list i.
    
    Args:
        result_lists: List of result lists from different queries
        k: Constant to prevent overweighting top-ranked items (default 60)
        
    Returns:
        Merged and re-ranked list of documents
    """
    doc_scores = {}
    
    for results in result_lists:
        for rank, doc in enumerate(results, start=1):
            doc_id = doc.get('doc_id')
            if not doc_id:
                continue
            
            # RRF score: 1 / (k + rank)
            rrf_score = 1.0 / (k + rank)
            
            if doc_id in doc_scores:
                doc_scores[doc_id]['score'] += rrf_score
                # Keep highest similarity from any query
                doc_scores[doc_id]['doc']['similarity_score'] = max(
                    doc_scores[doc_id]['doc'].get('similarity_score', 0),
                    doc.get('similarity_score', 0)
                )
            else:
                doc_scores[doc_id] = {
                    'doc': doc,
                    'score': rrf_score
                }
    
    # Sort by RRF score (highest first)
    sorted_docs = sorted(
        doc_scores.values(),
        key=lambda x: x['score'],
        reverse=True
    )
    
    return [item['doc'] for item in sorted_docs]


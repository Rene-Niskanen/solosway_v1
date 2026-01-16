"""
Retrieval nodes: Query classification, vector search, SQL search, deduplication, clarification.
"""

import json
import logging
import os
import os
import re
import time
from typing import Optional, List, Dict, Any, Tuple

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

from backend.llm.config import config
from backend.llm.types import MainWorkflowState, RetrievedDocument
from backend.llm.retrievers.vector_retriever import VectorDocumentRetriever
from backend.llm.retrievers.hybrid_retriever import HybridDocumentRetriever
from backend.llm.utils import reciprocal_rank_fusion
from backend.llm.utils.system_prompts import get_system_prompt
from backend.services.supabase_client_factory import get_supabase_client
from backend.llm.prompts import (
    get_query_rewrite_human_content,
    get_query_expansion_human_content,
    get_query_routing_human_content,
    get_llm_sql_query_human_content,
    get_reranking_human_content
)
# SQLDocumentRetriever is still under development. Import when ready.
# from backend.llm.retrievers.sql_retriever import SQLDocumentRetriever

logger = logging.getLogger(__name__)

# Local debug log writes are expensive and should be disabled in production.
_LLM_DEBUG = os.environ.get("LLM_DEBUG") == "1"
_DEBUG_LOG_PATH = os.environ.get("LLM_DEBUG_LOG_PATH", "/Users/thomashorner/solosway_v1/.cursor/debug.log")

def _debug_log(payload: dict) -> None:
    if not _LLM_DEBUG:
        return
    try:
        import json
        with open(_DEBUG_LOG_PATH, "a") as f:
            f.write(json.dumps(payload) + "\n")
    except Exception:
        pass


# ============================================================================
# SMART RETRIEVAL ALGORITHM - Multi-Factor Chunk Selection
# ============================================================================

def detect_query_characteristics(query: str) -> Dict[str, Any]:
    """
    Analyze query to determine its characteristics for adaptive retrieval.
    
    Returns:
        Dictionary with:
        - complexity_score: 0.0-1.0 (higher = more complex)
        - needs_comprehensive: bool (True if query needs all information)
        - query_type: str (assessment, activity, attribute, relationship, general)
        - expects_later_pages: bool (True if info likely on later pages)
    """
    query_lower = query.lower()
    
    _debug_log({
        "location": "retrieval_nodes.detect_query_characteristics:called",
        "data": {"query": query, "query_lower": query_lower},
    })
    
    # Detect query type
    # FIXED: Make assessment detection more precise - require context around "value"
    # Only classify as assessment if "value" appears with property/valuation context
    assessment_terms_precise = ['valuation', 'market value', 'property value', 'assess', 'opinion', 'appraisal', 'evaluate', 'determine']
    activity_terms = ['sold', 'offer', 'listed', 'marketing', 'transaction', 'history']
    attribute_terms = ['bedroom', 'bathroom', 'size', 'area', 'floor', 'feature', 'amenity', 'condition']
    relationship_terms = ['who', 'valued', 'inspected', 'prepared', 'author', 'company']
    
    query_type = 'general'
    
    # Check precise terms first
    if any(term in query_lower for term in assessment_terms_precise):
        query_type = 'assessment'
        matched = [term for term in assessment_terms_precise if term in query_lower]
        _debug_log({
            "location": "retrieval_nodes.detect_query_characteristics:assessment_precise",
            "data": {"query": query, "matched_term": matched},
        })
    # Check broad "value" term only if it appears with property/valuation context
    elif 'value' in query_lower:
        # Require context: property value, market value, value of property, value of the property, etc.
        value_context_patterns = [
            'property value', 'market value', 'value of', 'value for', 
            'value is', 'value was', 'value at', 'value:', 'value =',
            'the value', 'its value', 'property\'s value', 'property value'
        ]
        has_value_context = any(pattern in query_lower for pattern in value_context_patterns)
        if has_value_context:
            query_type = 'assessment'
            matched = [p for p in value_context_patterns if p in query_lower]
            _debug_log({
                "location": "retrieval_nodes.detect_query_characteristics:assessment_value_context",
                "data": {"query": query, "matched_pattern": matched},
            })
        else:
            _debug_log({
                "location": "retrieval_nodes.detect_query_characteristics:value_no_context",
                "data": {"query": query},
            })
    elif any(term in query_lower for term in activity_terms):
        query_type = 'activity'
    elif any(term in query_lower for term in attribute_terms):
        query_type = 'attribute'
    elif any(term in query_lower for term in relationship_terms):
        query_type = 'relationship'
    
    # Detect complexity indicators
    comprehensive_indicators = [
        'all', 'every', 'comprehensive', 'complete', 'tell me about', 'describe',
        'scenario', 'assumption', 'period', 'day', 'marketing period'
    ]
    needs_comprehensive = any(indicator in query_lower for indicator in comprehensive_indicators)
    
    # CRITICAL FIX: Assessment queries (especially valuation queries) need comprehensive search
    # because they often contain multiple scenarios (primary value, 90-day, 180-day, etc.)
    # that must all be extracted. Simple "value" queries should retrieve all relevant chunks.
    if query_type == 'assessment':
        needs_comprehensive = True  # Force comprehensive for all assessment queries
    
    # Multi-part queries (asking for multiple things)
    multi_part_indicators = ['and', 'also', 'as well', 'including', 'plus']
    has_multiple_parts = sum(1 for indicator in multi_part_indicators if indicator in query_lower) > 1
    
    # Calculate complexity score
    complexity_score = 0.0
    if needs_comprehensive:
        complexity_score += 0.4
    if has_multiple_parts:
        complexity_score += 0.3
    if query_type == 'assessment':
        complexity_score += 0.2  # Assessments often need comprehensive info
    if len(query.split()) > 10:
        complexity_score += 0.1  # Longer queries tend to be more complex
    
    complexity_score = min(1.0, complexity_score)
    
    # Detect if later pages are expected
    expects_later_pages = (
        query_type == 'assessment' or  # Valuations often on later pages
        'scenario' in query_lower or
        'assumption' in query_lower or
        'period' in query_lower or
        needs_comprehensive
    )
    
    result = {
        'complexity_score': complexity_score,
        'needs_comprehensive': needs_comprehensive,
        'query_type': query_type,
        'expects_later_pages': expects_later_pages
    }
    
    _debug_log({
        "location": "retrieval_nodes.detect_query_characteristics:result",
        "data": {"query": query, "result": result},
    })
    
    return result


def detect_semantic_authority(chunk_content: str, query_type: str) -> float:
    """
    Detect semantic authority of chunk content (professional assessments vs market activity).
    Works for all query types, not just valuations.
    
    Returns:
        Authority score (0.0-1.0) where 1.0 = highly authoritative
    """
    if not chunk_content:
        return 0.0
    
    content_lower = chunk_content.lower()
    authority_score = 0.0
    
    # Professional assessment language patterns
    professional_patterns = [
        'we are of the opinion',
        'we conclude',
        'we determine',
        'we assess',
        'we evaluate',
        'professional assessment',
        'formal opinion',
        'market value',
        'our assessment',
        'our evaluation',
        'established that',
        'determined to be',
        'concluded that',
        'assessment indicates',
        'evaluation shows'
    ]
    
    # Professional qualifications
    qualification_patterns = [
        'mrics', 'frics', 'rics', 'chartered surveyor',
        'registered valuer', 'qualified', 'accredited'
    ]
    
    # Formal structure indicators
    structure_patterns = [
        'scenario', 'assumption', 'based on', 'in accordance with',
        'following', 'per', 'as per', 'according to'
    ]
    
    # Count matches
    professional_matches = sum(1 for pattern in professional_patterns if pattern in content_lower)
    qualification_matches = sum(1 for pattern in qualification_patterns if pattern in content_lower)
    structure_matches = sum(1 for pattern in structure_patterns if pattern in content_lower)
    
    # Calculate authority score
    if professional_matches > 0:
        authority_score += min(0.5, professional_matches * 0.15)
    if qualification_matches > 0:
        authority_score += min(0.3, qualification_matches * 0.2)
    if structure_matches > 0:
        authority_score += min(0.2, structure_matches * 0.1)
    
    # Boost for query-specific authority
    if query_type == 'assessment' and authority_score > 0.3:
        authority_score = min(1.0, authority_score * 1.3)
    
    return min(1.0, authority_score)


def calculate_page_diversity_score(chunk: Dict, all_chunks: List[Dict]) -> float:
    """
    Calculate page diversity score for a chunk.
    Higher score = chunk is from a page range with fewer other chunks selected.
    
    Returns:
        Diversity score (0.0-1.0)
    """
    page_num = chunk.get('page_number', 0)
    if page_num <= 0:
        return 0.5  # Neutral score for chunks without page numbers
    
    # Define page ranges
    if page_num <= 10:
        page_range = 'early'
    elif page_num <= 20:
        page_range = 'mid'
    elif page_num <= 30:
        page_range = 'late'
    else:
        page_range = 'very_late'
    
    # Count chunks in same page range
    chunks_in_range = sum(
        1 for c in all_chunks
        if c.get('page_number', 0) > 0 and (
            (page_range == 'early' and c.get('page_number', 0) <= 10) or
            (page_range == 'mid' and 10 < c.get('page_number', 0) <= 20) or
            (page_range == 'late' and 20 < c.get('page_number', 0) <= 30) or
            (page_range == 'very_late' and c.get('page_number', 0) > 30)
        )
    )
    
    # Inverse relationship: fewer chunks in range = higher diversity score
    # Normalize to 0.0-1.0 range
    if chunks_in_range == 0:
        return 1.0
    elif chunks_in_range <= 2:
        return 0.8
    elif chunks_in_range <= 5:
        return 0.6
    elif chunks_in_range <= 10:
        return 0.4
    else:
        return 0.2


def calculate_query_relevance(chunk: Dict, query: str) -> float:
    """
    Calculate query relevance score based on keyword and semantic matching.
    
    Returns:
        Relevance score (0.0-1.0)
    """
    content = chunk.get('content', '').lower()
    query_lower = query.lower()
    
    if not content or not query_lower:
        return 0.0
    
    # Extract key terms from query (exclude common words)
    common_words = {'the', 'a', 'an', 'of', 'in', 'for', 'to', 'and', 'or', 
                   'is', 'are', 'what', 'who', 'how', 'when', 'where', 'why'}
    query_terms = [term for term in query_lower.split() 
                   if term not in common_words and len(term) > 2]
    
    # Count exact matches
    exact_matches = sum(1 for term in query_terms if term in content)
    
    # Count partial matches (substring)
    partial_matches = sum(1 for term in query_terms 
                         if any(term in word or word in term for word in content.split()))
    
    # Calculate relevance
    if len(query_terms) == 0:
        return 0.5  # Neutral if no meaningful terms
    
    relevance = (exact_matches * 0.7 + partial_matches * 0.3) / len(query_terms)
    return min(1.0, relevance)


def calculate_multi_factor_score(chunk: Dict, query: str, query_type: str, all_chunks: List[Dict]) -> float:
    """
    Calculate multi-factor score for chunk selection.
    
    Factors:
    - Similarity (40%): Base similarity from vector/BM25 search
    - Page Diversity (20%): Inverse of page concentration
    - Semantic Authority (20%): Professional/authoritative language detection
    - Query Relevance (20%): Keyword/semantic match to query
    
    Returns:
        Final score (0.0-1.0)
    """
    # Base similarity (normalize to 0.0-1.0 if needed)
    similarity = chunk.get('similarity', 0.0)
    if similarity > 1.0:
        similarity = similarity / 100.0  # Normalize if needed
    similarity = max(0.0, min(1.0, similarity))
    
    # Page diversity
    page_diversity = calculate_page_diversity_score(chunk, all_chunks)
    
    # Semantic authority
    content = chunk.get('content', '')
    authority = detect_semantic_authority(content, query_type)
    
    # Query relevance
    relevance = calculate_query_relevance(chunk, query)
    
    # Weighted combination
    final_score = (
        similarity * 0.4 +
        page_diversity * 0.2 +
        authority * 0.2 +
        relevance * 0.2
    )
    
    return final_score


def ensure_page_diversity(chunks_with_scores: List[Tuple[Dict, float]], min_per_range: int = 2) -> List[Tuple[Dict, float]]:
    """
    Ensure page diversity by guaranteeing minimum chunks from each page range.
    
    Args:
        chunks_with_scores: List of (chunk, score) tuples
        min_per_range: Minimum chunks to include from each page range
    
    Returns:
        List of (chunk, score) tuples with page diversity enforced
    """
    # Group chunks by page range
    page_ranges = {
        'early': [],      # 1-10
        'mid': [],        # 11-20
        'late': [],       # 21-30
        'very_late': []   # 31+
    }
    
    for chunk, score in chunks_with_scores:
        page_num = chunk.get('page_number', 0)
        if page_num <= 0:
            page_ranges['early'].append((chunk, score))  # Default to early
        elif page_num <= 10:
            page_ranges['early'].append((chunk, score))
        elif page_num <= 20:
            page_ranges['mid'].append((chunk, score))
        elif page_num <= 30:
            page_ranges['late'].append((chunk, score))
        else:
            page_ranges['very_late'].append((chunk, score))
    
    # Select minimum from each range, sorted by score
    diverse_chunks = []
    for range_name, range_chunks in page_ranges.items():
        range_chunks.sort(key=lambda x: x[1], reverse=True)  # Sort by score
        diverse_chunks.extend(range_chunks[:min_per_range])
    
    # Add remaining chunks sorted by score
    all_chunk_ids = {id(chunk) for chunk, _ in diverse_chunks}
    remaining = [(chunk, score) for chunk, score in chunks_with_scores 
                 if id(chunk) not in all_chunk_ids]
    remaining.sort(key=lambda x: x[1], reverse=True)
    diverse_chunks.extend(remaining)
    
    return diverse_chunks


def smart_select_chunks(chunks: List[Dict], user_query: str, query_type: str) -> List[Dict]:
    """
    Smart chunk selection algorithm using multi-factor scoring and adaptive limits.
    
    Algorithm:
    1. Analyze query characteristics (complexity, comprehensiveness needs)
    2. Calculate adaptive chunk limit
    3. Score all chunks using multi-factor scoring
    4. Ensure page diversity
    5. Return top N chunks
    
    Args:
        chunks: List of chunk dictionaries with content, similarity, page_number, etc.
        user_query: Original user query
        query_type: Query type (assessment, activity, attribute, etc.)
    
    Returns:
        Selected chunks (List[Dict])
    """
    if not chunks:
        return []
    
    # 1. Analyze query characteristics
    characteristics = detect_query_characteristics(user_query)
    complexity = characteristics['complexity_score']
    needs_comprehensive = characteristics['needs_comprehensive']
    
    # 2. Calculate adaptive limit
    if needs_comprehensive:
        chunk_limit = len(chunks)  # Use all chunks for comprehensive queries
    else:
        base_limit = 20
        chunk_limit = int(base_limit * (1 + complexity * 2))  # 20-60 chunks
    
    # Ensure we don't exceed available chunks
    chunk_limit = min(chunk_limit, len(chunks))
    
    # 3. Calculate multi-factor scores for all chunks
    scored_chunks = []
    for chunk in chunks:
        score = calculate_multi_factor_score(chunk, user_query, query_type, chunks)
        scored_chunks.append((chunk, score))
    
    # 4. Ensure page diversity (minimum 2 chunks per page range if available)
    diverse_chunks = ensure_page_diversity(scored_chunks, min_per_range=2)
    
    # 5. Sort by final score and return top N
    diverse_chunks.sort(key=lambda x: x[1], reverse=True)
    selected = [chunk for chunk, score in diverse_chunks[:chunk_limit]]
    
    logger.debug(
        f"[SMART_SELECT] Selected {len(selected)}/{len(chunks)} chunks "
        f"(complexity={complexity:.2f}, comprehensive={needs_comprehensive}, type={query_type})"
    )
    
    return selected


# ============================================================================
# SIMILARITY-BASED CHUNK RETRIEVAL
# ============================================================================

def retrieve_chunks_by_similarity(doc_id: str, user_query: str, top_k: int, match_threshold: float = 0.3, query_type: str = None) -> List[Dict]:
    """
    Retrieve chunks from a document using vector similarity search.
    This replaces sequential chunk_index ordering with similarity-based ordering.
    
    Args:
        doc_id: Document UUID
        user_query: User query to find similar chunks
        top_k: Number of chunks to retrieve
        match_threshold: Minimum similarity threshold (0.0-1.0) - will be lowered for assessment queries
        query_type: Query type (assessment, activity, etc.) - used to adjust threshold
    
    Returns:
        List of chunk dictionaries ordered by similarity (highest first)
        Each dict contains: chunk_text, chunk_index, page_number, similarity_score, etc.
    """
    # #region agent log
    try:
        import json as json_module
        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
            f.write(json_module.dumps({
                'sessionId': 'debug-session',
                'runId': 'run1',
                'hypothesisId': 'E',
                'location': 'retrieval_nodes.py:468',
                'message': 'retrieve_chunks_by_similarity: FUNCTION ENTRY',
                'data': {
                    'doc_id': doc_id[:8],
                    'query': user_query[:50],
                    'top_k': top_k,
                    'match_threshold': match_threshold,
                    'query_type': query_type
                },
                'timestamp': int(__import__('time').time() * 1000)
            }) + '\n')
    except: pass
    # #endregion
    # CRITICAL FIX: Lower threshold for assessment queries to ensure we don't miss valuation chunks
    # Assessment queries (especially valuations) often have chunks with lower similarity scores
    # because they use formal terminology that may not match the user's simple query
    if query_type == 'assessment':
        match_threshold = min(match_threshold, 0.2)  # Lower threshold for assessment queries
        logger.debug(f"[SIMILARITY_CHUNKS] Assessment query detected - using lower threshold: {match_threshold}")
    from backend.llm.retrievers.vector_retriever import VectorDocumentRetriever
    
    try:
        supabase = get_supabase_client()
        
        # 1. Embed the user query
        vector_retriever = VectorDocumentRetriever()
        
        # Use the same embedding method as VectorDocumentRetriever
        if vector_retriever.use_voyage:
            expanded_query = vector_retriever._expand_query_semantically(user_query)
            response = vector_retriever.voyage_client.embed(
                texts=[expanded_query],
                model=vector_retriever.voyage_model,
                input_type='query'
            )
            query_embedding = response.embeddings[0]
        else:
            expanded_query = vector_retriever._expand_query_semantically(user_query)
            query_embedding = vector_retriever.embeddings.embed_query(expanded_query)
        
        # 2. Search for similar chunks using pgvector cosine similarity
        # Use RPC function if available, otherwise use direct SQL query
        # #region agent log
        try:
            import json as json_module
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json_module.dumps({
                    'sessionId': 'debug-session',
                    'runId': 'run1',
                    'hypothesisId': 'E',
                    'location': 'retrieval_nodes.py:513',
                    'message': 'retrieve_chunks_by_similarity: Attempting RPC call',
                    'data': {
                        'doc_id': doc_id[:8],
                        'query': user_query[:50],
                        'top_k': top_k,
                        'match_threshold': match_threshold
                    },
                    'timestamp': int(__import__('time').time() * 1000)
                }) + '\n')
        except: pass
        # #endregion
        try:
            # Try RPC function first (if it exists in Supabase)
            result = supabase.rpc(
                'match_chunks_by_similarity',
                {
                    'document_id': doc_id,
                    'query_embedding': query_embedding,
                    'match_count': top_k,
                    'match_threshold': match_threshold
                }
            ).execute()
            
            # #region agent log
            try:
                import json as json_module
                sample_rpc = result.data[:3] if result.data else []
                with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                    f.write(json_module.dumps({
                        'sessionId': 'debug-session',
                        'runId': 'run1',
                        'hypothesisId': 'E',
                        'location': 'retrieval_nodes.py:527',
                        'message': 'retrieve_chunks_by_similarity: RPC call result',
                        'data': {
                            'doc_id': doc_id[:8],
                            'rpc_succeeded': True,
                            'num_chunks': len(result.data) if result.data else 0,
                            'has_data': bool(result.data),
                            'sample_chunks': [{'has_id': 'id' in c, 'id_preview': str(c.get('id', 'NO_ID'))[:8] if c.get('id') else 'NO_ID', 'has_similarity': 'similarity_score' in c} for c in sample_rpc],
                            'will_return_early': bool(result.data)
                        },
                        'timestamp': int(__import__('time').time() * 1000)
                    }) + '\n')
            except: pass
            # #endregion
            
            if result.data:
                logger.debug(f"[SIMILARITY_CHUNKS] Found {len(result.data)} chunks via RPC for doc {doc_id[:8]}")
                return result.data
        except Exception as rpc_error:
            # RPC function doesn't exist, use direct SQL query
            logger.debug(f"[SIMILARITY_CHUNKS] RPC not available, using direct query: {rpc_error}")
            # #region agent log
            try:
                import json as json_module
                with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                    f.write(json_module.dumps({
                        'sessionId': 'debug-session',
                        'runId': 'run1',
                        'hypothesisId': 'E',
                        'location': 'retrieval_nodes.py:530',
                        'message': 'retrieve_chunks_by_similarity: RPC call failed',
                        'data': {
                            'doc_id': doc_id[:8],
                            'rpc_error': str(rpc_error)[:200],
                            'will_continue_to_embedding_check': True
                        },
                        'timestamp': int(__import__('time').time() * 1000)
                    }) + '\n')
            except: pass
            # #endregion
        
        # 3. Fallback: Direct SQL query using pgvector
        # Query document_vectors table with cosine similarity
        # Note: This requires the embedding column to exist and be a vector type
        query = f"""
        SELECT 
            id,
            chunk_text,
            chunk_index,
            page_number,
            embedding_status,
            1 - (embedding <=> %s::vector) as similarity_score
        FROM document_vectors
        WHERE document_id = %s
          AND embedding IS NOT NULL
          AND embedding_status = 'embedded'
          AND (1 - (embedding <=> %s::vector)) >= %s
        ORDER BY embedding <=> %s::vector
        LIMIT %s
        """
        
        # Use raw SQL via Supabase (if supported) or fallback to sequential
        # For now, use a simpler approach: fetch all chunks and filter by embedding status
        # Then use Python to calculate similarity (less efficient but works)
        
        # Alternative: Use Supabase's built-in vector search if available
        # Check if chunks are embedded first
        chunks_check = supabase.table('document_vectors')\
            .select('id, embedding_status')\
            .eq('document_id', doc_id)\
            .eq('embedding_status', 'embedded')\
            .limit(1)\
            .execute()
        
        # #region agent log
        try:
            import json as json_module
            total_chunks_check = supabase.table('document_vectors')\
                .select('id, embedding_status')\
                .eq('document_id', doc_id)\
                .limit(100)\
                .execute()
            total_count = len(total_chunks_check.data) if total_chunks_check.data else 0
            embedded_count = len([c for c in (total_chunks_check.data or []) if c.get('embedding_status') == 'embedded'])
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json_module.dumps({
                    'sessionId': 'debug-session',
                    'runId': 'run1',
                    'hypothesisId': 'E',
                    'location': 'retrieval_nodes.py:558',
                    'message': 'retrieve_chunks_by_similarity: Embedding status check',
                    'data': {
                        'doc_id': doc_id[:8],
                        'has_embedded_chunks': bool(chunks_check.data),
                        'total_chunks_sampled': total_count,
                        'embedded_chunks_count': embedded_count,
                        'query': user_query[:50],
                        'will_fallback_to_sequential': not bool(chunks_check.data)
                    },
                    'timestamp': int(__import__('time').time() * 1000)
                }) + '\n')
        except: pass
        # #endregion
        
        if not chunks_check.data:
            # No embedded chunks, fallback to sequential retrieval
            logger.warning(f"[SIMILARITY_CHUNKS] No embedded chunks for doc {doc_id[:8]}, falling back to sequential")
            chunks_result = supabase.table('document_vectors')\
                .select('id, chunk_text, chunk_index, page_number, embedding_status')\
                .eq('document_id', doc_id)\
                .order('chunk_index')\
                .limit(top_k)\
                .execute()
            # #region agent log
            try:
                import json as json_module
                sample_sequential = chunks_result.data[:3] if chunks_result.data else []
                with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                    f.write(json_module.dumps({
                        'sessionId': 'debug-session',
                        'runId': 'run1',
                        'hypothesisId': 'E',
                        'location': 'retrieval_nodes.py:574',
                        'message': 'retrieve_chunks_by_similarity: Sequential fallback',
                        'data': {
                            'doc_id': doc_id[:8],
                            'num_chunks_returned': len(chunks_result.data) if chunks_result.data else 0,
                            'sample_chunks': [{'chunk_index': c.get('chunk_index'), 'page': c.get('page_number'), 'text_preview': c.get('chunk_text', '')[:100]} for c in sample_sequential],
                            'has_epc_in_sequential': any('epc' in str(c.get('chunk_text', '')).lower() for c in (chunks_result.data or [])[:20])
                        },
                        'timestamp': int(__import__('time').time() * 1000)
                    }) + '\n')
            except: pass
            # #endregion
            return chunks_result.data or []
        
        # Use vector similarity search via Supabase PostgREST
        # We'll use a workaround: fetch chunks and calculate similarity in Python
        # For production, this should use a proper RPC function or direct SQL
        
        # Get all embedded chunks for this document
        all_chunks = supabase.table('document_vectors')\
            .select('id, chunk_text, chunk_index, page_number, embedding, embedding_status')\
            .eq('document_id', doc_id)\
            .eq('embedding_status', 'embedded')\
            .execute()
        
        if not all_chunks.data:
            logger.warning(f"[SIMILARITY_CHUNKS] No embedded chunks found for doc {doc_id[:8]}")
            return []
        
        # Calculate similarity for each chunk
        import numpy as np
        
        chunks_with_similarity = []
        for chunk in all_chunks.data:
            chunk_embedding = chunk.get('embedding')
            if not chunk_embedding:
                continue
            
            # Calculate cosine similarity
            try:
                # Convert to numpy arrays if needed
                if isinstance(chunk_embedding, list):
                    chunk_vec = np.array(chunk_embedding)
                else:
                    chunk_vec = np.array(chunk_embedding)
                
                if isinstance(query_embedding, list):
                    query_vec = np.array(query_embedding)
                else:
                    query_vec = np.array(query_embedding)
                
                # Cosine similarity: dot product / (norm1 * norm2)
                similarity = np.dot(chunk_vec, query_vec) / (np.linalg.norm(chunk_vec) * np.linalg.norm(query_vec))
                
                if similarity >= match_threshold:
                    chunk_result = {
                        'chunk_text': chunk.get('chunk_text', ''),
                        'chunk_index': chunk.get('chunk_index', 0),
                        'page_number': chunk.get('page_number', 0),
                        'embedding_status': chunk.get('embedding_status', ''),
                        'similarity_score': float(similarity),
                        'id': chunk.get('id')
                    }
                    chunks_with_similarity.append(chunk_result)
            except Exception as calc_error:
                logger.debug(f"[SIMILARITY_CHUNKS] Error calculating similarity: {calc_error}")
                continue
        
        # Sort by similarity (highest first) and return top_k
        chunks_with_similarity.sort(key=lambda x: x.get('similarity_score', 0.0), reverse=True)
        result = chunks_with_similarity[:top_k]
        
        # #region agent log
        try:
            import json as json_module
            sample_result = result[:3] if result else []
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json_module.dumps({
                    'sessionId': 'debug-session',
                    'runId': 'run1',
                    'hypothesisId': 'E',
                    'location': 'retrieval_nodes.py:632',
                    'message': 'retrieve_chunks_by_similarity: Similarity search results',
                    'data': {
                        'doc_id': doc_id[:8],
                        'num_results': len(result),
                        'num_candidates': len(chunks_with_similarity),
                        'match_threshold': match_threshold,
                        'sample_results': [{'similarity': r.get('similarity_score', 0), 'page': r.get('page_number'), 'text_preview': r.get('chunk_text', '')[:100]} for r in sample_result],
                        'has_epc_in_results': any('epc' in str(r.get('chunk_text', '')).lower() for r in result[:10])
                    },
                    'timestamp': int(__import__('time').time() * 1000)
                }) + '\n')
        except: pass
        # #endregion
        
        logger.info(f"[SIMILARITY_CHUNKS] Retrieved {len(result)}/{len(all_chunks.data)} chunks by similarity for doc {doc_id[:8]}")
        return result
        
    except Exception as e:
        logger.error(f"[SIMILARITY_CHUNKS] Error retrieving chunks by similarity: {e}")
        import traceback
        traceback_str = traceback.format_exc()
        logger.debug(traceback_str)
        
        # Fallback to BM25 keyword search on error (better than sequential)
        logger.warning(f"[SIMILARITY_CHUNKS] Falling back to BM25 keyword search")
        # #region agent log
        try:
            import json as json_module
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json_module.dumps({
                    'sessionId': 'debug-session',
                    'runId': 'run1',
                    'hypothesisId': 'E',
                    'location': 'retrieval_nodes.py:800',
                    'message': 'retrieve_chunks_by_similarity: Exception handler fallback',
                    'data': {
                        'doc_id': doc_id[:8],
                        'error_occurred': True,
                        'error_type': type(e).__name__,
                        'error_message': str(e)[:500],
                        'traceback_preview': traceback_str.split('\n')[-5:] if traceback_str else [],
                        'will_use_bm25': True
                    },
                    'timestamp': int(__import__('time').time() * 1000)
                }) + '\n')
        except: pass
        # #endregion
        try:
            # Use BM25 keyword search as fallback (searches all chunks, not just first 20)
            from backend.llm.retrievers.bm25_retriever import BM25DocumentRetriever
            bm25_retriever = BM25DocumentRetriever()
            bm25_results = bm25_retriever.query_documents(
                query_text=user_query,
                top_k=top_k * 2,  # Get more results to account for filtering
                document_ids=[doc_id]  # Filter to this specific document
            )
            
            # Convert RetrievedDocument to chunk format
            # Each RetrievedDocument represents a single chunk
            chunks_from_bm25 = []
            seen_indices = set()
            supabase = get_supabase_client()
            
            for result in bm25_results:
                # Only process chunks from the target document
                if str(result.get('doc_id', '')) != str(doc_id):
                    continue
                
                chunk_idx = result.get('chunk_index')
                if chunk_idx is None or chunk_idx in seen_indices:
                    continue  # Skip duplicates or invalid
                seen_indices.add(chunk_idx)
                
                # Fetch the chunk ID and full data from database
                try:
                    chunk_data = supabase.table('document_vectors')\
                        .select('id, embedding_status')\
                        .eq('document_id', doc_id)\
                        .eq('chunk_index', chunk_idx)\
                        .limit(1)\
                        .execute()
                    chunk_id = chunk_data.data[0].get('id') if chunk_data.data else None
                    embedding_status = chunk_data.data[0].get('embedding_status', 'unknown') if chunk_data.data else 'unknown'
                except:
                    chunk_id = None
                    embedding_status = 'unknown'
                
                chunks_from_bm25.append({
                    'id': chunk_id,
                    'chunk_text': result.get('content', ''),
                    'chunk_index': chunk_idx,
                    'page_number': result.get('page_number', 0),
                    'embedding_status': embedding_status,
                    'similarity_score': result.get('similarity_score', 0.0),  # Use BM25 score
                })
            
            # Sort by score (already sorted by BM25, but ensure)
            unique_chunks = sorted(chunks_from_bm25, key=lambda x: x.get('similarity_score', 0.0), reverse=True)
            
            # #region agent log
            try:
                import json as json_module
                sample_bm25 = unique_chunks[:3] if unique_chunks else []
                with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                    f.write(json_module.dumps({
                        'sessionId': 'debug-session',
                        'runId': 'run1',
                        'hypothesisId': 'E',
                        'location': 'retrieval_nodes.py:850',
                        'message': 'retrieve_chunks_by_similarity: BM25 fallback result',
                        'data': {
                            'doc_id': doc_id[:8],
                            'num_chunks': len(unique_chunks),
                            'sample_chunks': [{'chunk_index': c.get('chunk_index'), 'page': c.get('page_number'), 'score': c.get('similarity_score', 0), 'text_preview': c.get('chunk_text', '')[:100]} for c in sample_bm25],
                            'has_epc': any('epc' in str(c.get('chunk_text', '')).lower() for c in unique_chunks[:20])
                        },
                        'timestamp': int(__import__('time').time() * 1000)
                    }) + '\n')
            except: pass
            # #endregion
            
            if unique_chunks:
                return unique_chunks[:top_k]
            
            # If BM25 also fails, fall back to sequential
            logger.warning(f"[SIMILARITY_CHUNKS] BM25 fallback also failed, using sequential retrieval")
            supabase = get_supabase_client()
            chunks_result = supabase.table('document_vectors')\
                .select('id, chunk_text, chunk_index, page_number, embedding_status')\
                .eq('document_id', doc_id)\
                .order('chunk_index')\
                .limit(top_k)\
                .execute()
            return chunks_result.data or []
        except Exception as fallback_error:
            logger.error(f"[SIMILARITY_CHUNKS] BM25 fallback also failed: {fallback_error}")
            # Final fallback: sequential retrieval
            try:
                supabase = get_supabase_client()
                chunks_result = supabase.table('document_vectors')\
                    .select('id, chunk_text, chunk_index, page_number, embedding_status')\
                    .eq('document_id', doc_id)\
                    .order('chunk_index')\
                    .limit(top_k)\
                    .execute()
                return chunks_result.data or []
            except Exception:
                return []


def _rewrite_query_keywords(query: str, conversation_history: List[Dict[str, Any]] = None) -> str:
    """
    Rule-based query rewriting using keyword patterns.
    Handles common property query patterns without LLM overhead.
    """
    if conversation_history is None:
        conversation_history = []
    
    rewritten = query
    query_lower = query.lower()
    words = query.split()
    
    # Extract property name from query (capitalized words, excluding common words)
    common_words = {'the', 'a', 'an', 'of', 'in', 'for', 'to', 'and', 'or', 'please', 'find', 'me', 'what', 'is', 'are', 'show', 'get', 'tell', 'who', 'how', 'why', 'when', 'where'}
    property_names = [w for w in words if len(w) > 3 and w[0].isupper() and w[1:].islower() and w.lower() not in common_words]
    
    # Expand value/price queries for better retrieval
    if any(term in query_lower for term in ['value', 'worth', 'valuation']):
        if 'market value' not in query_lower and 'valuation' not in query_lower:
            # Add synonyms for better BM25/vector matching
            rewritten = rewritten.replace('value', 'value valuation market value price worth')
        elif 'market value' not in query_lower:
            rewritten = rewritten.replace('valuation', 'valuation market value')
    
    # Expand bedroom/bathroom abbreviations (handles "5 bed" → "5 bedroom bedrooms")
    rewritten = re.sub(r'(\d+)\s+bed\b', r'\1 bedroom bedrooms bed', rewritten, flags=re.IGNORECASE)
    rewritten = re.sub(r'(\d+)\s+bath\b', r'\1 bathroom bathrooms bath', rewritten, flags=re.IGNORECASE)
    rewritten = re.sub(r'(\d+)\s+br\b', r'\1 bedroom bedrooms', rewritten, flags=re.IGNORECASE)
    rewritten = re.sub(r'(\d+)\s+ba\b', r'\1 bathroom bathrooms', rewritten, flags=re.IGNORECASE)
    
    # Normalize UK postcodes (AB12CD → AB1 2CD)
    postcode_pattern = r'\b([A-Z]{1,2}\d{1,2})\s?(\d[A-Z]{2})\b'
    def format_postcode(match):
        return f"{match.group(1)} {match.group(2)}"
    rewritten = re.sub(postcode_pattern, format_postcode, rewritten, flags=re.IGNORECASE)
    
    # Expand address-related queries
    if 'address' in query_lower and 'location' not in query_lower:
        rewritten = rewritten.replace('address', 'address location property address')
    
    # CRITICAL: Add property name/address from conversation history for follow-up questions
    # This ensures we don't retrieve information about the wrong property
    if conversation_history:
        # Extract from last assistant response and previous user query
        last_exchange = conversation_history[-1] if conversation_history else {}
        last_response = ''
        last_query = ''
        
        if isinstance(last_exchange, dict):
            if 'summary' in last_exchange:
                last_response = last_exchange['summary']
            elif 'content' in last_exchange and last_exchange.get('role') == 'assistant':
                last_response = last_exchange['content']
            if 'query' in last_exchange:
                last_query = last_exchange['query']
            elif 'content' in last_exchange and last_exchange.get('role') == 'user':
                last_query = last_exchange['content']
        
        # Also check previous exchanges for property context
        property_context = ''
        for exchange in reversed(conversation_history[-3:]):  # Check last 3 exchanges
            if isinstance(exchange, dict):
                text_to_search = ''
                if 'summary' in exchange:
                    text_to_search = exchange['summary']
                elif 'content' in exchange:
                    text_to_search = exchange['content']
                elif 'query' in exchange:
                    text_to_search = exchange['query']
                
                if text_to_search:
                    # Look for property addresses (common patterns)
                    # Pattern for UK addresses: "Property Name, Street, City, Postcode"
                    address_pattern = r'([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Road|Street|Lane|Drive|Avenue|Close|Way|Place)),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)'
                    address_match = re.search(address_pattern, text_to_search)
                    if address_match:
                        property_context = ' '.join(address_match.groups())
                        break
                    
                    # Look for property names (capitalized words that aren't common words)
                    words = text_to_search.split()
                    property_names_found = [w for w in words if len(w) > 3 and w[0].isupper() and w[1:].islower() and w.lower() not in common_words]
                    if property_names_found and not property_context:
                        # Prefer longer property names
                        property_context = max(property_names_found, key=len)
                    
                    # Look for postcodes (UK format: letters, numbers, space, letters, numbers)
                    postcode_pattern = r'[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2}'
                    postcode_match = re.search(postcode_pattern, text_to_search)
                    if postcode_match:
                        if property_context:
                            property_context = f"{property_context} {postcode_match.group()}"
                        else:
                            property_context = postcode_match.group()
        
        # If we found property context and it's not already in the query, add it
        if property_context and property_context.lower() not in query_lower:
            rewritten = f"{rewritten} {property_context}"
            logger.info(f"[REWRITE_QUERY] Added property context from history: {property_context}")
    
    # Clean up multiple spaces
    rewritten = ' '.join(rewritten.split())
    return rewritten.strip()


def _needs_llm_rewrite(query: str, conversation_history: List[Dict[str, Any]] = None) -> bool:
    """
    Determine if LLM-based rewrite is necessary.
    Returns False for most queries (use keyword rewrite), True only for complex cases.
    """
    if conversation_history is None:
        conversation_history = []
    
    query_lower = query.lower()
    words = query.split()
    
    # Skip LLM for queries with specific terms (these are already clear)
    specific_terms = ['value', 'price', 'worth', 'valuation', 'bedroom', 'bathroom', 'bed', 'bath', 
                      'address', 'postcode', 'epc', 'energy', 'size', 'sqft', 'square', 'footage',
                      'buyer', 'seller', 'valuer', 'surveyor', 'agent', 'owner']
    if any(term in query_lower for term in specific_terms):
        return False
    
    # Skip LLM for property name queries (capitalized words indicate specific property)
    if any(len(w) > 3 and w[0].isupper() and w[1:].islower() for w in words):
        return False
    
    # Skip LLM for postcode queries (UK format: AB1 2CD or AB12CD)
    if re.search(r'[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2}', query, re.IGNORECASE):
        return False
    
    # Skip LLM for short specific queries (< 6 words with question words)
    if len(words) < 6 and any(term in query_lower for term in ['what', 'how much', 'where', 'when', 'who']):
        return False
    
    # Skip LLM for queries with numbers (specific values, counts, etc.)
    if re.search(r'\d+', query):
        return False
    
    # Use LLM for vague queries that need context expansion
    vague_terms = ['tell me about', 'what can you', 'find information', 'show me', 'describe', 
                   'give me details', 'what do you know', 'explain']
    if any(term in query_lower for term in vague_terms):
        return True
    
    # Use LLM if query references previous conversation without context
    if conversation_history and any(ref in query_lower for ref in ['it', 'that', 'the property', 'the document', 'this', 'those']):
        return True
    
    # Use LLM for complex multi-concept queries
    complex_indicators = ['and', 'or', 'but', 'also', 'including', 'except']
    if len(words) > 8 and sum(1 for term in complex_indicators if term in query_lower) >= 2:
        return True
    
    # Default: skip LLM (keyword rewrite is sufficient for most queries)
    return False


def _should_expand_query(query: str) -> bool:
    """
    Determine if query expansion is necessary.
    
    Returns False (skip expansion) for:
    - Queries with property names (capitalized words > 3 chars)
    - Specific value queries ("£2.3m", "value of X", "price")
    - Short queries (< 5 words) with specific terms
    - Queries with postcodes (UK format: "AB1 2CD" or "AB12CD")
    - Queries with exact property identifiers (addresses, IDs)
    - Queries with numbers (specific counts, values)
    
    Returns True (require expansion) for:
    - Vague queries ("tell me about", "what can you find")
    - Conceptual queries ("foundation issues", "structural problems")
    - Multi-concept queries requiring synonyms
    - Queries with abstract terms needing expansion
    """
    query_lower = query.lower()
    words = query.split()
    
    # Skip expansion for queries with property names (capitalized words indicate specific property)
    if any(len(w) > 3 and w[0].isupper() and w[1:].islower() for w in words):
        logger.debug(f"[EXPAND_QUERY] Skipping expansion - query contains property name")
        return False
    
    # Skip expansion for postcode queries (UK format: AB1 2CD or AB12CD)
    if re.search(r'[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2}', query, re.IGNORECASE):
        logger.debug(f"[EXPAND_QUERY] Skipping expansion - query contains postcode")
        return False
    
    # Skip expansion for short specific queries (< 5 words with specific terms)
    specific_terms = ['value', 'price', 'worth', 'valuation', 'bedroom', 'bathroom', 'bed', 'bath',
                      'address', 'postcode', 'epc', 'energy', 'size', 'sqft', 'square', 'footage',
                      'buyer', 'seller', 'valuer', 'surveyor', 'agent', 'owner', 'date', 'when']
    if len(words) < 5 and any(term in query_lower for term in specific_terms):
        logger.debug(f"[EXPAND_QUERY] Skipping expansion - short query with specific term")
        return False
    
    # Skip expansion for queries with numbers (specific values, counts, etc.)
    if re.search(r'\d+', query):
        # Check if number is part of a specific query pattern
        number_patterns = [
            r'\d+\s*(bedroom|bed|bathroom|bath|br|ba)',  # "5 bedroom"
            r'£\s*\d+',  # "£2.3m" or "£2300000"
            r'\d+\s*(million|m|thousand|k)',  # "2.3 million"
            r'\d+\s*(sqft|sq\s*ft|square\s*feet)',  # "2500 sqft"
        ]
        if any(re.search(pattern, query, re.IGNORECASE) for pattern in number_patterns):
            logger.debug(f"[EXPAND_QUERY] Skipping expansion - query contains specific number pattern")
            return False
    
    # Skip expansion for queries with exact identifiers (UUIDs, IDs)
    uuid_pattern = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    if re.search(uuid_pattern, query, re.IGNORECASE):
        logger.debug(f"[EXPAND_QUERY] Skipping expansion - query contains UUID")
        return False
    
    # Require expansion for vague queries that need context
    vague_terms = ['tell me about', 'what can you', 'find information', 'show me', 'describe',
                   'give me details', 'what do you know', 'explain', 'what information',
                   'what details', 'what can you tell']
    if any(term in query_lower for term in vague_terms):
        logger.debug(f"[EXPAND_QUERY] Requiring expansion - vague query detected")
        return True
    
    # Require expansion for conceptual queries (benefit from synonym expansion)
    conceptual_terms = ['issue', 'problem', 'defect', 'damage', 'condition', 'quality',
                        'feature', 'amenity', 'characteristic', 'aspect', 'detail']
    if any(term in query_lower for term in conceptual_terms):
        logger.debug(f"[EXPAND_QUERY] Requiring expansion - conceptual query detected")
        return True
    
    # Require expansion for multi-concept queries (need synonym coverage)
    complex_indicators = ['and', 'or', 'but', 'also', 'including', 'except', 'plus']
    if len(words) > 6 and sum(1 for term in complex_indicators if term in query_lower) >= 2:
        logger.debug(f"[EXPAND_QUERY] Requiring expansion - complex multi-concept query")
        return True
    
    # Default: skip expansion for most queries (keyword-based retrieval is sufficient)
    # Only expand when we're confident it will help
    logger.debug(f"[EXPAND_QUERY] Default: skipping expansion for query")
    return False


def check_cached_documents(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Check for Cached Documents from Previous Conversation Turns
    
    For follow-up questions about the same property, reuse previously retrieved documents
    instead of performing a new search. This dramatically speeds up follow-up queries.
    
    CRITICAL: Only use cache for document search queries. General queries and text transformations
    should NOT use cached documents, even if they exist.
    
    Logic:
    1. Quick check: Is this a general query or text transformation? If yes, skip cache
    2. Check if there are cached documents from previous conversation turns (via checkpointer)
    3. Extract property context from current query and conversation history
    4. If property context matches, reuse cached documents
    5. If property context differs or no cache exists, clear cache and proceed with normal retrieval
    
    Args:
        state: MainWorkflowState with user_query, conversation_history, and potentially cached relevant_documents
        
    Returns:
        Updated state with cached documents if applicable, or empty dict to proceed with normal retrieval
    """
    conversation_history = state.get('conversation_history', []) or []
    user_query = state.get('user_query', '').strip()
    document_ids = state.get('document_ids', [])
    property_id = state.get('property_id')
    
    # CRITICAL: Quick check - is this clearly a general query or text transformation?
    # If yes, skip cache and proceed to classification
    user_query_lower = user_query.lower()
    
    # Check for general query indicators (date/time, general knowledge)
    general_indicators = [
        'what is the date', 'what is today', 'current date', 'current time',
        'explain', 'what is', 'how does', 'tell me about',
        'capital of', 'who is', 'when was', 'where is'
    ]
    has_general = any(indicator in user_query_lower for indicator in general_indicators)
    
    # Check for text transformation indicators
    transformation_verbs = ['make', 'reorganize', 'rewrite', 'improve', 'sharpen', 'concise', 'rephrase']
    transformation_refs = ['this', 'that', 'the above', 'previous response', 'pasted text']
    has_transformation = any(verb in user_query_lower for verb in transformation_verbs)
    has_transformation_ref = any(ref in user_query_lower for ref in transformation_refs)
    
    # If it's clearly a general query or text transformation, skip cache
    if has_general and not document_ids and not property_id:
        logger.info("[CHECK_CACHED_DOCS] Query appears to be general query - skipping cache, proceeding to classification")
        return {}  # Skip cache, proceed to classification
    
    if has_transformation and (has_transformation_ref or len(user_query) > 200):
        logger.info("[CHECK_CACHED_DOCS] Query appears to be text transformation - skipping cache, proceeding to classification")
        return {}  # Skip cache, proceed to classification
    
    # Check if there are cached documents from previous state (loaded from checkpointer)
    cached_docs = state.get('relevant_documents', [])
    
    # If no conversation history AND no cached docs, proceed with normal retrieval
    if (not conversation_history or len(conversation_history) == 0) and (not cached_docs or len(cached_docs) == 0):
        logger.debug("[CHECK_CACHED_DOCS] No conversation history and no cached documents - proceeding with normal retrieval")
        return {}  # No changes, proceed with normal flow
    
    # If no cached docs but we have history, proceed with normal retrieval
    if not cached_docs or len(cached_docs) == 0:
        logger.debug("[CHECK_CACHED_DOCS] No cached documents found - proceeding with normal retrieval")
        return {}  # No cached docs, proceed with normal retrieval
    
    logger.info(f"[CHECK_CACHED_DOCS] Found {len(cached_docs)} cached documents from previous conversation")
    
    # Extract property context from current query
    current_property_context = _extract_property_context(user_query, conversation_history)
    
    # Extract property context from previous conversation
    previous_property_context = _extract_property_context_from_history(conversation_history)
    
    # Check if property contexts match (same property)
    if current_property_context and previous_property_context:
        # Normalize for comparison (case-insensitive, whitespace-insensitive)
        current_normalized = ' '.join(current_property_context.lower().split())
        previous_normalized = ' '.join(previous_property_context.lower().split())
        
        # Check if they match (allowing for partial matches)
        if current_normalized in previous_normalized or previous_normalized in current_normalized:
            logger.info(f"[CHECK_CACHED_DOCS] ✅ Property context matches - reusing {len(cached_docs)} cached documents")
            logger.info(f"[CHECK_CACHED_DOCS] Current context: '{current_property_context}', Previous: '{previous_property_context}'")
            return {"relevant_documents": cached_docs}  # Return cached documents
        else:
            logger.info(f"[CHECK_CACHED_DOCS] ❌ Property context differs - clearing cache and proceeding with new retrieval")
            logger.info(f"[CHECK_CACHED_DOCS] Current: '{current_property_context}', Previous: '{previous_property_context}'")
            return {"relevant_documents": []}  # Clear cache, proceed with normal retrieval
    elif current_property_context:
        # Current query has property context but previous doesn't - check if current matches cached docs
        logger.info(f"[CHECK_CACHED_DOCS] Current query has property context: '{current_property_context}'")
        # Check if cached docs are about the current property by examining document metadata
        if _documents_match_property(cached_docs, current_property_context):
            logger.info(f"[CHECK_CACHED_DOCS] ✅ Cached documents match current property context - reusing {len(cached_docs)} documents")
            return {"relevant_documents": cached_docs}
        else:
            logger.info(f"[CHECK_CACHED_DOCS] ❌ Cached documents don't match current property - clearing cache and proceeding with new retrieval")
            return {"relevant_documents": []}  # Clear cache
    elif previous_property_context:
        # Previous had property context but current doesn't - likely same conversation, reuse cache
        logger.info(f"[CHECK_CACHED_DOCS] ✅ No property context in current query, but previous had context - reusing {len(cached_docs)} cached documents")
        return {"relevant_documents": cached_docs}
    else:
        # No property context in either - likely same conversation, reuse cache
        logger.info(f"[CHECK_CACHED_DOCS] ✅ No property context in query or history - reusing {len(cached_docs)} cached documents (likely same conversation)")
        return {"relevant_documents": cached_docs}


def _extract_property_context(query: str, conversation_history: List[Dict[str, Any]] = None) -> str:
    """
    Extract property name/address/postcode from query and conversation history.
    
    Returns:
        Property context string (name, address, or postcode) or empty string
    """
    if conversation_history is None:
        conversation_history = []
    
    context_parts = []
    
    # Extract from current query
    query_lower = query.lower()
    
    # Look for postcodes (UK format)
    postcode_pattern = r'\b[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2}\b'
    postcode_matches = re.findall(postcode_pattern, query, re.IGNORECASE)
    if postcode_matches:
        context_parts.extend(postcode_matches)
    
    # Look for property names (capitalized words)
    common_words = {'the', 'a', 'an', 'of', 'in', 'for', 'to', 'and', 'or', 'please', 'find', 'me', 'what', 'is', 'are', 'show', 'get', 'tell', 'who', 'how', 'why', 'when', 'where', 'property', 'value', 'valuation', 'market'}
    words = query.split()
    property_names = [w for w in words if len(w) > 3 and w[0].isupper() and w[1:].islower() and w.lower() not in common_words]
    if property_names:
        context_parts.extend(property_names[:2])  # Take first 2 property name words
    
    # Extract from conversation history if not found in query
    if not context_parts and conversation_history:
        for exchange in reversed(conversation_history[-3:]):  # Check last 3 exchanges
            if isinstance(exchange, dict):
                text_to_search = ''
                if 'summary' in exchange:
                    text_to_search = exchange['summary']
                elif 'content' in exchange:
                    text_to_search = exchange['content']
                elif 'query' in exchange:
                    text_to_search = exchange['query']
                
                if text_to_search:
                    # Look for addresses
                    address_pattern = r'([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Road|Street|Lane|Drive|Avenue|Close|Way|Place)),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)'
                    address_match = re.search(address_pattern, text_to_search)
                    if address_match:
                        context_parts.append(' '.join(address_match.groups()))
                        break
                    
                    # Look for postcodes
                    postcode_matches = re.findall(postcode_pattern, text_to_search, re.IGNORECASE)
                    if postcode_matches:
                        context_parts.extend(postcode_matches)
                        break
                    
                    # Look for property names
                    words = text_to_search.split()
                    property_names = [w for w in words if len(w) > 3 and w[0].isupper() and w[1:].islower() and w.lower() not in common_words]
                    if property_names:
                        context_parts.append(max(property_names, key=len))  # Take longest property name
                        break
    
    return ' '.join(context_parts[:3]) if context_parts else ''  # Return first 3 context parts


def _extract_property_context_from_history(conversation_history: List[Dict[str, Any]]) -> str:
    """
    Extract property context from conversation history (previous queries/responses).
    
    Returns:
        Property context string or empty string
    """
    if not conversation_history:
        return ''
    
    # Check last few exchanges for property context
    for exchange in reversed(conversation_history[-3:]):
        if isinstance(exchange, dict):
            text_to_search = ''
            if 'summary' in exchange:
                text_to_search = exchange['summary']
            elif 'content' in exchange:
                text_to_search = exchange['content']
            elif 'query' in exchange:
                text_to_search = exchange['query']
            
            if text_to_search:
                context = _extract_property_context(text_to_search, [])
                if context:
                    return context
    
    return ''


def _documents_match_property(documents: List[RetrievedDocument], property_context: str) -> bool:
    """
    Check if cached documents are about the specified property.
    
    Args:
        documents: List of cached RetrievedDocument objects
        property_context: Property name/address/postcode to match
        
    Returns:
        True if documents match the property, False otherwise
    """
    if not documents or not property_context:
        return False
    
    property_lower = property_context.lower()
    
    # Check document metadata for property matches
    for doc in documents[:5]:  # Check first 5 documents
        # Check document ID/filename
        doc_id = str(doc.get('document_id', '')).lower()
        doc_metadata = doc.get('metadata', {})
        filename = doc_metadata.get('original_filename', '').lower()
        source = doc_metadata.get('source', '').lower()
        
        # Check if property context appears in document identifiers
        if property_lower in doc_id or property_lower in filename or property_lower in source:
            return True
        
        # Check document content (first 500 chars)
        content = str(doc.get('content', ''))[:500].lower()
        if property_lower in content:
            return True
    
    return False


async def rewrite_query_with_context(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Query Rewriting with Conversation Context
    
    Uses keyword-based rewriting for most queries (fast, no LLM).
    Falls back to LLM rewriting only for complex/vague queries.
    
    Examples:
        "What's the price?" → "What's the price for Highlands, Berden Road property?"
        "Review the document" → "Review Highlands_Berden_Bishops_Stortford valuation report"
        "Show amenities" → "Show amenities for the 5-bedroom property at Highlands"
    
    Args:
        state: MainWorkflowState with user_query and conversation_history
        
    Returns:
        Updated state with rewritten user_query (or unchanged if no context needed)
    """
    conversation_history = state.get('conversation_history', []) or []
    user_query = state.get('user_query', '')
    
    # Check if LLM rewrite is needed
    if not _needs_llm_rewrite(user_query, conversation_history):
        # Use fast keyword-based rewrite
        rewritten = _rewrite_query_keywords(user_query, conversation_history)
        if rewritten != user_query:
            logger.info(f"[REWRITE_QUERY] Keyword rewrite: '{user_query[:50]}...' -> '{rewritten[:50]}...'")
            return {"user_query": rewritten}
        logger.debug(f"[REWRITE_QUERY] No rewrite needed for query: '{user_query[:50]}...'")
        return {}  # No changes needed
    
    # Proceed with LLM rewrite for complex queries (existing code below)
    logger.info(f"[REWRITE_QUERY] Using LLM rewrite for complex query: '{user_query[:50]}...'")
    
    # Skip if no conversation history (original query is fine)
    if not conversation_history or len(conversation_history) == 0:
        logger.info("[REWRITE_QUERY] No conversation history, using original query")
        return {}  # No changes to state
    
    # PERFORMANCE OPTIMIZATION: Use faster/cheaper model for query rewriting
    # gpt-3.5-turbo is much faster and cheaper than gpt-4 for this task
    rewrite_model = os.getenv("OPENAI_REWRITE_MODEL", "gpt-3.5-turbo")
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=rewrite_model,  # Use faster model for rewriting
        temperature=0,
    )
    
    # Build conversation context (last 2 exchanges)
    recent_history = state['conversation_history'][-2:]
    history_lines = []
    for exchange in recent_history:
        # Handle different conversation history formats:
        # Format 1: From summary_nodes (has 'query' and 'summary')
        # Format 2: From frontend/views (has 'role' and 'content')
        if 'query' in exchange and 'summary' in exchange:
            # Format from summary_nodes
            history_lines.append(f"User asked: {exchange['query']}")
            summary_preview = exchange['summary'][:400].replace('\n', ' ')
            history_lines.append(f"Assistant responded: {summary_preview}...")
        elif 'role' in exchange and 'content' in exchange:
            # Format from frontend (role-based messages)
            role = exchange['role']
            content = exchange['content']
            if role == 'user':
                history_lines.append(f"User asked: {content}")
            elif role == 'assistant':
                content_preview = content[:400].replace('\n', ' ')
                history_lines.append(f"Assistant responded: {content_preview}...")
        else:
            # Skip malformed entries
            logger.warning(f"[REWRITE_QUERY] Skipping malformed conversation entry: {exchange.keys()}")
            continue
    
    history_context = "\n".join(history_lines)
    
    # Get system prompt for rewrite task
    system_msg = get_system_prompt('rewrite')
    
    # Get human message content
    human_content = get_query_rewrite_human_content(
        user_query=state['user_query'],
        conversation_history=history_context
    )
    
    try:
        # Use LangGraph message format - ASYNC for better performance
        messages = [system_msg, HumanMessage(content=human_content)]
        response = await llm.ainvoke(messages)
        rewritten = response.content.strip().strip('"').strip("'")  # Clean quotes
        
        # Only use rewritten if it's different and not too long
        if rewritten != state['user_query'] and len(rewritten) < 500:
            logger.info(f"[REWRITE_QUERY]   Original: '{state['user_query']}'")
            logger.info(f"[REWRITE_QUERY]  Rewritten: '{rewritten}'")
            return {"user_query": rewritten}
        else:
            logger.info("[REWRITE_QUERY]   No rewrite needed")
            return {}
            
    except Exception as exc:
        logger.error(f"[REWRITE_QUERY]  Failed to rewrite: {exc}")
        return {}  # Keep original query on error


async def expand_query_for_retrieval(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Query Expansion for Better Recall
    
    Generates query variations to catch different phrasings and synonyms.
    Now uses smart heuristics to skip expansion for simple, specific queries.
    
    Examples:
        "foundation issues" → ["foundation issues", "foundation damage and structural problems", 
                               "concrete defects and settlement issues"]
        "What's the price?" → ["What's the price?", "property sale price and valuation",
                               "market value and asking price"]
    
    Args:
        state: MainWorkflowState with user_query
        
    Returns:
        Updated state with query_variations list
    """
    
    original_query = state['user_query']
    
    # Check if expansion is needed using smart heuristics
    enable_smart_expansion = os.getenv("ENABLE_SMART_EXPANSION", "true").lower() == "true"
    
    if enable_smart_expansion and not _should_expand_query(original_query):
        logger.info(f"[EXPAND_QUERY] Skipping expansion for simple query: '{original_query[:50]}...'")
        return {"query_variations": [original_query]}  # Return original query as single variation
    
    # PERFORMANCE OPTIMIZATION: Use faster/cheaper model for query expansion
    # gpt-3.5-turbo is much faster and cheaper than gpt-4 for this task
    expansion_model = os.getenv("OPENAI_EXPANSION_MODEL", "gpt-3.5-turbo")
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=expansion_model,  # Use faster model for expansion
        temperature=0.4,  # Slight creativity for variations
    )
    
    # Get system prompt for expansion task
    system_msg = get_system_prompt('expand')
    
    # Get human message content
    human_content = get_query_expansion_human_content(original_query=original_query)
    
    try:
        # Use LangGraph message format - ASYNC for better performance
        messages = [system_msg, HumanMessage(content=human_content)]
        response = await llm.ainvoke(messages)
        variations = [v.strip() for v in response.content.strip().split('\n') if v.strip()]
        
        # Limit to 2 variations
        variations = variations[:2]
        
        # Combine: original + variations
        all_queries = [original_query] + variations
        
        logger.info(f"[EXPAND_QUERY] Generated {len(variations)} variations:")
        for i, q in enumerate(all_queries, 1):
            logger.info(f"  {i}. {q}")
        
        return {"query_variations": all_queries}
        
    except Exception as exc:
        logger.error(f"[EXPAND_QUERY] Failed to expand query: {exc}")
        return {"query_variations": [original_query]}


async def route_query(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Route/Classify Query Intent 

    Uses LLM to classify query as semantic, structured, or hybrid.
    This determines which retrieval paths to activate.
    Now includes conversation history for context-aware classification.

    Args:
        state: MainWorkflowState with user_query and conversation_history

    Returns:
        Updated state with query_intent
    """
    
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )

    # Build conversation context if history exists
    history_context = ""
    if state.get('conversation_history'):
        recent_history = state['conversation_history'][-3:]  # Last 3 exchanges
        history_lines = []
        for exchange in recent_history:
            # Handle different conversation history formats
            if 'query' in exchange and 'summary' in exchange:
                # Format from summary_nodes
                history_lines.append(f"User: {exchange['query']}")
                history_lines.append(f"Assistant: {exchange['summary'][:200]}...")
            elif 'role' in exchange and 'content' in exchange:
                # Format from frontend (role-based messages)
                role = exchange['role']
                content = exchange['content']
                if role == 'user':
                    history_lines.append(f"User: {content}")
                elif role == 'assistant':
                    history_lines.append(f"Assistant: {content[:200]}...")
        if history_lines:
            history_context = f"\n\nPrevious conversation:\n" + "\n".join(history_lines)

    # Get system prompt for classification task
    system_msg = get_system_prompt('classify')
    
    # Get human message content
    human_content = get_query_routing_human_content(
        user_query=state['user_query'],
        conversation_history=history_context
    )
    
    # Use LangGraph message format - ASYNC for better performance
    messages = [system_msg, HumanMessage(content=human_content)]
    response = await llm.ainvoke(messages)
    intent = response.content.lower().strip()

    if intent not in {"semantic", "structured", "hybrid"}:
        logger.warning("Invalid intent '%s', defaulting to 'hybrid'", intent)
        intent = "hybrid"

    logger.info("[ROUTE_QUERY] Classified query as: %s", intent)
    return {"query_intent": intent}


async def query_vector_documents(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Hybrid Search (BM25 + Vector) with Lazy Embedding Support + Structured Query Fallback

    Uses hybrid retriever combining:
    - BM25 (lexical) for exact matches (addresses, postcodes, IDs) - works on ALL chunks
    - Vector (semantic) for conceptual matches - only embedded chunks
    - Triggers lazy embedding for unembedded chunks found by BM25
    - Structured query fallback: For property-specific queries (bedrooms, bathrooms, etc.), 
      queries property_details table directly for fast, accurate results
    
    This dramatically improves recall and handles lazy embedding seamlessly.
    
    PERFORMANCE OPTIMIZATION: If relevant_documents already exist (from cache), skip retrieval.

    Args:
        state: MainWorkflowState with user_query, query_variations, business_id

    Returns:
        Updated state with hybrid search results appended to relevant_documents
    """
    # PERFORMANCE OPTIMIZATION: Check if documents were already retrieved from cache
    existing_docs = state.get('relevant_documents', [])
    if existing_docs and len(existing_docs) > 0:
        logger.info(f"[QUERY_VECTOR_DOCUMENTS] Skipping retrieval - {len(existing_docs)} documents already cached from previous conversation")
        return {}  # No changes needed, use cached documents
    
    node_start = time.time()
    user_query = state.get('user_query', '')
    document_ids = state.get('document_ids')
    business_id = state.get("business_id")
    
    # CRITICAL: Log business_id to diagnose filtering issues
    logger.info(
        f"[QUERY_VECTOR_DOCUMENTS] Starting retrieval for query: '{user_query[:50]}...'"
        f"{' (filtered to ' + str(len(document_ids)) + ' selected documents)' if document_ids and len(document_ids) > 0 else ''}"
        f" | business_id: {business_id[:8] if business_id else 'MISSING'}..."
    )
    
    # CRITICAL: Validate business_id is present
    if not business_id:
        logger.error("[QUERY_VECTOR_DOCUMENTS] ❌ business_id is MISSING from state! This will cause 0 results.")
        logger.error(f"[QUERY_VECTOR_DOCUMENTS] State keys: {list(state.keys())}")
        # Don't return empty - try to continue but log the issue
    else:
        logger.info(f"[QUERY_VECTOR_DOCUMENTS] ✅ business_id present: {business_id}")

    try:
        # STEP 1: Check if query is property-specific (bedrooms, bathrooms, price, etc.)
        # If so, query property_details table directly for fast, accurate results
        user_query = state.get('user_query', '').lower()
        business_id = state.get("business_id")
        
        structured_results = []
        if business_id and any(term in user_query for term in ['bedroom', 'bathroom', 'bed', 'bath', 'price', 'square', 'sqft', 'sq ft']):
            try:
                from backend.services.supabase_client_factory import get_supabase_client
                supabase = get_supabase_client()
                
                # Extract numbers from query (e.g., "5 bedroom" -> 5)
                # Handle plurals, abbreviations, and variations
                import re
                # Match: "5 bedroom", "5 bedrooms", "5 bed", "5 beds", "5BR", "5 br", etc.
                bedroom_patterns = [
                    r'(\d+)\s*(?:bedroom|bedrooms|bed|beds|br|brs)\b',
                    r'(\d+)\s*-\s*(?:bedroom|bed|br)',
                    r'(?:bedroom|bed|br)\s*[:=]\s*(\d+)',
                ]
                bedroom_match = None
                for pattern in bedroom_patterns:
                    bedroom_match = re.search(pattern, user_query, re.IGNORECASE)
                    if bedroom_match:
                        break
                
                # Match: "5 bathroom", "5 bathrooms", "5 bath", "5 baths", "5BA", "5 ba", etc.
                bathroom_patterns = [
                    r'(\d+)\s*(?:bathroom|bathrooms|bath|baths|ba|bas)\b',
                    r'(\d+)\s*-\s*(?:bathroom|bath|ba)',
                    r'(?:bathroom|bath|ba)\s*[:=]\s*(\d+)',
                ]
                bathroom_match = None
                for pattern in bathroom_patterns:
                    bathroom_match = re.search(pattern, user_query, re.IGNORECASE)
                    if bathroom_match:
                        break
                
                logger.info(f"[QUERY_STRUCTURED] Extracted - Bedrooms: {bedroom_match.group(1) if bedroom_match else None}, Bathrooms: {bathroom_match.group(1) if bathroom_match else None}")
                
                # SECURITY: First get property_ids for this business to ensure multi-tenancy
                # This prevents querying other companies' property_details
                business_properties = supabase.table('properties')\
                    .select('id')\
                    .eq('business_uuid', business_id)\
                    .execute()
                
                if not business_properties.data:
                    logger.info(f"[QUERY_STRUCTURED] No properties found for business {business_id}")
                    property_results = type('obj', (object,), {'data': []})()  # Empty result
                else:
                    business_property_ids = [p['id'] for p in business_properties.data]
                    logger.info(f"[QUERY_STRUCTURED] Filtering property_details for {len(business_property_ids)} properties in business")
                    
                    # Build property_details query - ONLY for this business's properties
                property_query = supabase.table('property_details')\
                        .select('property_id, number_bedrooms, number_bathrooms')\
                        .in_('property_id', business_property_ids)  # CRITICAL: Filter by business
                
                if bedroom_match:
                    bedrooms = int(bedroom_match.group(1))
                    property_query = property_query.eq('number_bedrooms', bedrooms)
                
                if bathroom_match:
                    bathrooms = int(bathroom_match.group(1))
                    property_query = property_query.eq('number_bathrooms', bathrooms)
                
                # Get properties matching criteria (exact match first)
                property_results = property_query.execute()
                
                # RETRY LOGIC: If no exact matches, try similarity-based search
                if not property_results.data and (bedroom_match or bathroom_match) and business_properties.data:
                    logger.info(f"[QUERY_STRUCTURED] No exact matches found, trying similarity-based search...")
                    
                    business_property_ids = [p['id'] for p in business_properties.data]
                    
                    # Try ranges: ±1 bedroom/bathroom - STILL FILTERED BY BUSINESS
                    similarity_query = supabase.table('property_details')\
                        .select('property_id, number_bedrooms, number_bathrooms')\
                        .in_('property_id', business_property_ids)  # CRITICAL: Filter by business
                    
                    if bedroom_match:
                        bedrooms = int(bedroom_match.group(1))
                        # Try range: bedrooms-1 to bedrooms+1
                        similarity_query = similarity_query.gte('number_bedrooms', max(1, bedrooms - 1))\
                            .lte('number_bedrooms', bedrooms + 1)
                        logger.info(f"[QUERY_STRUCTURED] Trying bedroom range: {max(1, bedrooms - 1)}-{bedrooms + 1}")
                    
                    if bathroom_match:
                        bathrooms = int(bathroom_match.group(1))
                        # Try range: bathrooms-1 to bathrooms+1
                        similarity_query = similarity_query.gte('number_bathrooms', max(1, bathrooms - 1))\
                            .lte('number_bathrooms', bathrooms + 1)
                        logger.info(f"[QUERY_STRUCTURED] Trying bathroom range: {max(1, bathrooms - 1)}-{bathrooms + 1}")
                    
                    property_results = similarity_query.execute()
                    if property_results.data:
                        logger.info(f"[QUERY_STRUCTURED] Found {len(property_results.data)} similar properties (not exact matches)")
                
                if property_results.data:
                    # Get document_ids for these properties
                    property_ids = [p['property_id'] for p in property_results.data]
                    
                    # Get documents linked to these properties
                    doc_results = supabase.table('document_relationships')\
                        .select('document_id, property_id')\
                        .in_('property_id', property_ids)\
                        .execute()
                    
                    if doc_results.data:
                        # Get document details including document_summary for party names
                        doc_ids = list(set([d['document_id'] for d in doc_results.data]))
                        docs = supabase.table('documents')\
                            .select('id, original_filename, classification_type, document_summary')\
                            .in_('id', doc_ids)\
                            .eq('business_uuid', business_id)\
                            .execute()
                        
                        # Get property addresses - FILTER BY BUSINESS for security
                        addresses = supabase.table('properties')\
                            .select('id, formatted_address')\
                            .in_('id', property_ids)\
                            .eq('business_uuid', business_id)\
                            .execute()
                        
                        address_map = {a['id']: a['formatted_address'] for a in addresses.data}
                        
                        # Get property_details for each property to prepend to content
                        property_details_map = {}
                        if property_ids:
                            try:
                                prop_details = supabase.table('property_details')\
                                    .select('property_id, number_bedrooms, number_bathrooms, property_type, size_sqft, size_unit, asking_price, sold_price, rent_pcm, epc_rating, tenure, condition, other_amenities, notes')\
                                    .in_('property_id', property_ids)\
                                    .execute()
                                property_details_map = {pd['property_id']: pd for pd in prop_details.data}
                                logger.info(f"[QUERY_STRUCTURED] Fetched property_details for {len(property_details_map)} properties")
                            except Exception as e:
                                logger.warning(f"[QUERY_STRUCTURED] Failed to fetch property_details: {e}")
                        
                        # Fetch actual chunks from document_vectors for each document
                        for doc in docs.data:
                            # Find property_id for this document
                            prop_id = next((dr['property_id'] for dr in doc_results.data if dr['document_id'] == doc['id']), None)
                            
                            # Get property details for this property
                            prop_details = property_details_map.get(prop_id, {}) if prop_id else {}
                            
                            # Extract party names from document_summary
                            party_names_context = ""
                            try:
                                import json
                                document_summary = doc.get('document_summary')
                                if document_summary:
                                    # Handle both dict and JSON string formats
                                    if isinstance(document_summary, str):
                                        try:
                                            document_summary = json.loads(document_summary)
                                            if isinstance(document_summary, str):
                                                document_summary = json.loads(document_summary)
                                        except (json.JSONDecodeError, TypeError):
                                            document_summary = None
                                    
                                    if isinstance(document_summary, dict):
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
                                                party_names_context = "PARTY_NAMES: " + " | ".join(name_parts) + "\n\n"
                            except Exception as e:
                                logger.debug(f"[QUERY_STRUCTURED] Could not extract party names: {e}")
                            
                            # Build property details context to prepend to chunks
                            # This is VERIFIED information from the property database (including manually updated values)
                            property_context = ""
                            if prop_details:
                                context_parts = []
                                if prop_details.get('number_bedrooms') is not None:
                                    context_parts.append(f"{prop_details['number_bedrooms']} bedroom(s)")
                                if prop_details.get('number_bathrooms') is not None:
                                    context_parts.append(f"{prop_details['number_bathrooms']} bathroom(s)")
                                if prop_details.get('property_type'):
                                    context_parts.append(f"Type: {prop_details['property_type']}")
                                if prop_details.get('size_sqft'):
                                    size_value = prop_details['size_sqft']
                                    size_unit = prop_details.get('size_unit', '').lower() if prop_details.get('size_unit') else ''
                                    # Only show as acres if explicitly stated in size_unit field
                                    if size_unit in ('acres', 'acre'):
                                        context_parts.append(f"Size: {size_value:,.2f} acres")
                                    else:
                                        context_parts.append(f"Size: {size_value:,.0f} sqft")
                                if prop_details.get('asking_price'):
                                    context_parts.append(f"Asking price: £{prop_details['asking_price']:,.0f}")
                                if prop_details.get('sold_price'):
                                    context_parts.append(f"Sold price: £{prop_details['sold_price']:,.0f}")
                                if prop_details.get('rent_pcm'):
                                    context_parts.append(f"Rent (pcm): £{prop_details['rent_pcm']:,.0f}")
                                if prop_details.get('tenure'):
                                    context_parts.append(f"Tenure: {prop_details['tenure']}")
                                if prop_details.get('epc_rating'):
                                    context_parts.append(f"EPC: {prop_details['epc_rating']}")
                                if prop_details.get('condition'):
                                    context_parts.append(f"Condition: {prop_details['condition']}")
                                
                                if context_parts:
                                    # Make it very clear this is verified property information
                                    property_context = f"""PROPERTY DETAILS (VERIFIED FROM DATABASE - INCLUDES MANUALLY UPDATED VALUES):
This property has: {', '.join(context_parts)}.

This information has been verified and extracted from the property database, including any manually updated values. The document below may contain additional details about this property.

"""
                            
                            # Fetch chunks for this document
                            # First, try to find chunks that contain bedroom/bathroom keywords for better relevance
                            keyword_chunks = []
                            if bedroom_match or bathroom_match:
                                keywords = []
                                if bedroom_match:
                                    keywords.extend(['bedroom', 'bedrooms', 'bed', 'beds'])
                                if bathroom_match:
                                    keywords.extend(['bathroom', 'bathrooms', 'bath', 'baths'])
                                
                                # OPTIMIZATION: Enhanced keyword-based retrieval with similarity search
                                # First, find keyword matches
                                all_chunks = supabase.table('document_vectors')\
                                    .select('chunk_text, chunk_index, page_number, embedding_status')\
                                    .eq('document_id', doc['id'])\
                                    .execute()
                                
                                # Filter chunks that contain bedroom/bathroom keywords
                                for chunk in all_chunks.data:
                                    chunk_text_lower = (chunk.get('chunk_text', '') or '').lower()
                                    if any(kw in chunk_text_lower for kw in keywords):
                                        keyword_chunks.append(chunk)
                                
                                # Sort by chunk_index and take up to 10 keyword chunks
                                keyword_chunks.sort(key=lambda x: x.get('chunk_index', 0))
                                keyword_chunks = keyword_chunks[:10]
                                
                                # ENHANCEMENT: Also use similarity search to find related chunks
                                user_query = state.get('user_query', '')
                                characteristics = detect_query_characteristics(user_query)
                                query_type = characteristics.get('query_type', 'general')
                                similar_chunks = retrieve_chunks_by_similarity(
                                    doc_id=doc['id'],
                                    user_query=user_query,
                                    top_k=15,  # Get top 15 similar chunks
                                    match_threshold=0.3,
                                    query_type=query_type
                                )
                                
                                # Combine keyword matches with similarity-based matches
                                chunk_indices_seen = set(c.get('chunk_index') for c in keyword_chunks)
                                all_chunks_list = list(keyword_chunks)
                                
                                # Add similar chunks that weren't already included
                                # Prioritize chunks with both keyword matches AND high similarity
                                for chunk in similar_chunks:
                                    chunk_idx = chunk.get('chunk_index', 0)
                                    if chunk_idx not in chunk_indices_seen:
                                        # Check if this similar chunk also has keywords (bonus)
                                        chunk_text_lower = (chunk.get('chunk_text', '') or '').lower()
                                        has_keywords = any(kw in chunk_text_lower for kw in keywords)
                                        
                                        if has_keywords:
                                            # Prioritize: add at the beginning
                                            all_chunks_list.insert(0, chunk)
                                        else:
                                            # Add to end
                                            all_chunks_list.append(chunk)
                                        chunk_indices_seen.add(chunk_idx)
                                        
                                        if len(all_chunks_list) >= 20:
                                            break
                                
                                # If we still need more chunks, add sequential ones for context
                                if len(all_chunks_list) < 20:
                                    for chunk in all_chunks.data:
                                        if chunk.get('chunk_index') not in chunk_indices_seen and len(all_chunks_list) < 20:
                                            all_chunks_list.append(chunk)
                                            chunk_indices_seen.add(chunk.get('chunk_index'))
                                
                                # Sort by chunk_index for proper ordering (but keyword/similar chunks are prioritized)
                                all_chunks_list.sort(key=lambda x: x.get('chunk_index', 0))
                                
                                # Create a mock result object with the combined chunks
                                class MockResult:
                                    def __init__(self, data):
                                        self.data = data
                                chunks_result = MockResult(all_chunks_list[:20])
                            else:
                                # OPTIMIZATION: Use similarity-based chunk retrieval instead of sequential
                                # This ensures chunks from all pages (including page 30+) are retrieved if similar
                                user_query = state.get('user_query', '')
                                characteristics = detect_query_characteristics(user_query)
                                complexity = characteristics['complexity_score']
                                needs_comprehensive = characteristics['needs_comprehensive']
                                
                                # Base limit: 20 chunks, scale up based on complexity
                                base_limit = 20
                                if needs_comprehensive:
                                    chunk_limit = 150  # Use more chunks for comprehensive queries
                                else:
                                    chunk_limit = int(base_limit * (1 + complexity * 4))  # 20-100 chunks
                                chunk_limit = min(chunk_limit, 150)  # Cap at 150
                                
                                # Use similarity-based retrieval (finds chunks across all pages by similarity)
                                query_type = characteristics.get('query_type', 'general')
                                similar_chunks = retrieve_chunks_by_similarity(
                                    doc_id=doc['id'],
                                    user_query=user_query,
                                    top_k=chunk_limit,
                                    match_threshold=0.3,  # Minimum similarity threshold (will be lowered for assessment queries)
                                    query_type=query_type
                                )
                                
                                # Convert to expected format
                                class MockResult:
                                    def __init__(self, data):
                                        self.data = data
                                chunks_result = MockResult(similar_chunks)
                            
                            # Combine chunks into content
                            chunk_texts = []
                            has_unembedded = False
                            
                            if chunks_result.data:
                                for chunk in chunks_result.data:
                                    chunk_text = chunk.get('chunk_text', '').strip()
                                    if chunk_text and len(chunk_text) > 10:  # Filter out very short chunks
                                        chunk_texts.append(chunk_text)
                                    
                                    # Track unembedded chunks for lazy embedding
                                    if chunk.get('embedding_status') == 'pending':
                                        has_unembedded = True
                                
                                # Combine chunks with separators and prepend party names + property context
                                if chunk_texts:
                                    combined_content = party_names_context + property_context + "\n\n---\n\n".join(chunk_texts)
                                    logger.debug(f"[QUERY_STRUCTURED] Fetched {len(chunk_texts)} chunks for doc {doc['id'][:8]}, total length: {len(combined_content)} chars")
                                else:
                                    # Fallback: use property details if chunks are empty
                                    combined_content = party_names_context + property_context + f"Property with matching criteria from {doc.get('original_filename', 'document')}. Document chunks are being processed."
                                
                                # Trigger lazy embedding for this document if chunks are unembedded (edge case: legacy documents)
                                # Note: All new documents are embedded upfront, so this should rarely trigger
                                if has_unembedded:
                                    try:
                                        from backend.tasks import embed_document_chunks_lazy
                                        embed_document_chunks_lazy.delay(str(doc['id']), business_id)
                                        logger.info(f"[QUERY_STRUCTURED] Triggered lazy embedding for document {doc['id'][:8]} (legacy document)")
                                    except Exception as e:
                                        logger.warning(f"[QUERY_STRUCTURED] Failed to trigger lazy embedding: {e}")
                            else:
                                # No chunks found, use property details as fallback
                                combined_content = party_names_context + property_context + f"Property with matching criteria from {doc.get('original_filename', 'document')}. Document chunks are being processed."
                                logger.warning(f"[QUERY_STRUCTURED] No chunks found for document {doc['id'][:8]}, using property details only")
                            
                            # Get page numbers from chunks
                            page_numbers = sorted(set(
                                c.get('page_number') for c in chunks_result.data 
                                if c.get('page_number') and c.get('page_number') > 0
                            )) if chunks_result.data else []
                            
                            structured_results.append({
                                'doc_id': doc['id'],
                                'document_id': doc['id'],
                                'property_id': prop_id,
                                'property_address': address_map.get(prop_id, 'Unknown'),
                                'original_filename': doc.get('original_filename', ''),
                                'classification_type': doc.get('classification_type', ''),
                                'content': combined_content,  # Actual chunk content!
                                'similarity_score': 1.0,  # High score for exact matches
                                'source': 'structured_query',
                                'chunk_index': 0,  # Single merged result
                                'page_number': page_numbers[0] if page_numbers else None,
                                'page_numbers': page_numbers
                            })
                        
                        logger.info(f"[QUERY_STRUCTURED] Found {len(structured_results)} documents via property_details query with {sum(len(r.get('content', '').split('---')) for r in structured_results)} chunks")
                else:
                    logger.warning(f"[QUERY_STRUCTURED] No properties found matching criteria")
            except Exception as e:
                logger.warning(f"[QUERY_STRUCTURED] Structured query failed: {e}")
                import traceback
                logger.debug(traceback.format_exc())
        
        # STEP 2: Use hybrid retriever (BM25 + Vector with lazy embedding triggers)
        hybrid_start = time.time()
        retriever = HybridDocumentRetriever()
        
        # Get query variations (or just original if expansion didn't run)
        queries = state.get('query_variations', [state['user_query']])
        logger.info(f"[QUERY_VECTOR_DOCUMENTS] Running hybrid search for {len(queries)} query variation(s)")
        
        # OPTIMIZATION: Process query variations in parallel instead of sequentially
        def process_single_query(query: str, query_index: int) -> Tuple[int, List[Dict]]:
            """Process a single query variation and return (index, results)."""
            query_start = time.time()
            # Adjust top_k based on detail_level and query characteristics (adaptive)
            detail_level = state.get('detail_level', 'concise')
            user_query = state.get('user_query', '')
            characteristics = detect_query_characteristics(user_query)
            complexity = characteristics['complexity_score']
            needs_comprehensive = characteristics['needs_comprehensive']
            
            # CRITICAL: Get business_id from state (closure variable might not be accessible in all cases)
            query_business_id = state.get("business_id") or business_id
            if not query_business_id:
                logger.error(f"[QUERY_VECTOR_DOCUMENTS] ❌ business_id MISSING in process_single_query! Query: '{query[:50]}...'")
            
            if needs_comprehensive:
                # For comprehensive queries, fetch significantly more chunks
                top_k = int(os.getenv("INITIAL_RETRIEVAL_TOP_K_VALUATION", "100"))
                logger.info(f"[QUERY_VECTOR_DOCUMENTS] Comprehensive query detected - using top_k={top_k}")
            elif detail_level == 'detailed':
                # Scale based on complexity for detailed mode
                base_top_k = int(os.getenv("INITIAL_RETRIEVAL_TOP_K_DETAILED", "50"))
                top_k = int(base_top_k * (1 + complexity * 0.5))  # 50-75 chunks
            else:
                # Scale based on complexity for concise mode
                base_top_k = int(os.getenv("INITIAL_RETRIEVAL_TOP_K", "20"))
                top_k = int(base_top_k * (1 + complexity * 1.5))  # 20-50 chunks
            
            # NEW: Header-Priority Retrieval (Pass 1)
            # Search for chunks with matching section headers first, then boost them in results
            # Query-driven: Uses query terms directly to find relevant section headers
            header_results = []
            relevant_headers = None
            from backend.llm.utils.section_header_matcher import get_relevant_section_headers, should_use_header_retrieval
            from backend.llm.utils.section_header_detector import _normalize_header
            import re
            
            document_type = state.get("classification_type")
            if should_use_header_retrieval(query, document_type):
                # Build query-driven header search terms
                # Strategy: Use query terms directly + mapped section headers as enhancement
                query_lower = query.lower()
                query_words = [re.sub(r'[^\w\s]', '', w) for w in query_lower.split() if len(w) > 2]  # Remove short words and punctuation
                
                # Get mapped section headers (as enhancement, not primary)
                mapped_headers = get_relevant_section_headers(query, document_type)
                
                # Combine: query terms + mapped headers (query terms take priority)
                # Normalize all terms for consistent matching
                header_search_terms = set()
                
                # Add query terms directly (primary - query-driven)
                for word in query_words:
                    if word not in ['the', 'and', 'or', 'for', 'with', 'from', 'this', 'that', 'what', 'where', 'when', 'how']:
                        header_search_terms.add(word)
                
                # Add mapped headers (enhancement)
                for header in mapped_headers:
                    # Normalize and split header into individual words
                    normalized = _normalize_header(header)
                    header_search_terms.add(normalized)
                    # Also add individual words from multi-word headers
                    header_search_terms.update(normalized.split())
                
                if header_search_terms:
                    logger.info(f"[HEADER_RETRIEVAL] Query-driven header search terms: {sorted(header_search_terms)}")
                    try:
                        from backend.llm.retrievers.bm25_retriever import BM25DocumentRetriever
                        bm25_retriever = BM25DocumentRetriever()
                        
                        # Build query string for BM25 search (OR all terms - query-driven)
                        # Use phrase search for multi-word terms, individual words for single terms
                        header_query_parts = []
                        for term in header_search_terms:
                            if ' ' in term:
                                # Multi-word term: use as phrase
                                header_query_parts.append(f'"{term}"')
                            else:
                                # Single word: use directly
                                header_query_parts.append(term)
                        
                        header_query = " OR ".join(header_query_parts)
                        
                        # Search for chunks with these section headers (query-driven)
                        header_results = bm25_retriever.query_documents(
                            query_text=header_query,
                            top_k=int(os.getenv("MAX_HEADER_MATCHES", "20")),  # Limit header matches
                            business_id=query_business_id,  # Use query_business_id from closure
                            property_id=state.get("property_id"),
                            classification_type=document_type
                        )
                        
                        if header_results:
                            logger.info(f"[HEADER_RETRIEVAL] Found {len(header_results)} chunks with query-driven header matches")
                            # Runtime header detection for header results
                            from backend.llm.utils.section_header_detector import detect_section_header
                            for result in header_results:
                                result['_header_match'] = True
                                # Detect section headers from chunk text at runtime
                                chunk_text = result.get('chunk_text', '')
                                if chunk_text:
                                    header_info = detect_section_header(chunk_text)
                                    if header_info:
                                        result['_detected_section_header'] = header_info.get('section_header')
                                        result['_detected_normalized_header'] = header_info.get('normalized_header')
                                        logger.debug(f"[RUNTIME_HEADER] Detected header in header result: '{header_info.get('section_header')}'")
                    except Exception as e:
                        logger.warning(f"[HEADER_RETRIEVAL] Header search failed: {e}, continuing with standard retrieval")
            
            # Standard Hybrid Search (Pass 2)
            # Pass document_ids to hybrid retriever for early filtering
            # CRITICAL: Validate business_id before calling retriever
            if not query_business_id:
                logger.error(f"[QUERY_VECTOR_DOCUMENTS] ❌ business_id is MISSING - cannot perform search! Query: '{query[:50]}...'")
                results = []  # Return empty results if business_id is missing
            else:
                logger.info(f"[QUERY_VECTOR_DOCUMENTS] Calling hybrid retriever with business_id: {query_business_id[:8]}...")
                results = retriever.query_documents(
                    user_query=query,
                    top_k=top_k,  # Adjusted based on detail_level
                    business_id=query_business_id,  # Use query_business_id from closure
                    property_id=state.get("property_id"),
                    classification_type=state.get("classification_type"),
                    document_ids=document_ids,  # NEW: Pass document_ids for filtering
                    trigger_lazy_embedding=False  # Disabled: all chunks embedded upfront
                    # TODO: Add section_headers parameter once hybrid retriever supports it
                )
                logger.info(f"[QUERY_VECTOR_DOCUMENTS] Hybrid retriever returned {len(results)} results for query: '{query[:50]}...'")
            
            # Runtime Section Header Detection (Phase 1): Detect headers in standard results
            from backend.llm.utils.section_header_detector import detect_section_header, _normalize_header
            from backend.llm.utils.section_header_matcher import get_relevant_section_headers
            
            # Get relevant section headers for this query (generic - works for any query type)
            relevant_headers = get_relevant_section_headers(query, document_type)
            relevant_normalized = {_normalize_header(h) for h in relevant_headers} if relevant_headers else set()
            
            # Detect headers in standard results and tag them
            for result in results:
                chunk_text = result.get('chunk_text', '')
                if chunk_text:
                    header_info = detect_section_header(chunk_text)
                    if header_info:
                        detected_header = header_info.get('section_header')
                        detected_normalized = header_info.get('normalized_header')
                        
                        result['_detected_section_header'] = detected_header
                        result['_detected_normalized_header'] = detected_normalized
                        
                        # Generic boost: if detected header matches query intent
                        if detected_normalized in relevant_normalized:
                            current_score = result.get('similarity_score', 0.0)
                            result['similarity_score'] = current_score * 2.0  # 2x boost for matching headers
                            logger.debug(f"[RUNTIME_HEADER] Boosted chunk with matching header: '{detected_header}' (score: {current_score:.3f} → {result['similarity_score']:.3f})")
            
            # Boost header-based results (multiply RRF score by 1.5x)
            if header_results:
                section_header_boost = float(os.getenv("SECTION_HEADER_BOOST", "1.5"))
                header_doc_chunk_pairs = {(r.get('doc_id'), r.get('chunk_index')) for r in header_results}
                
                for result in results:
                    chunk_key = (result.get('doc_id'), result.get('chunk_index'))
                    if result.get('_header_match') or chunk_key in header_doc_chunk_pairs:
                        current_score = result.get('similarity_score', 0.0)
                        result['similarity_score'] = current_score * section_header_boost
                        logger.debug(f"[HEADER_RETRIEVAL] Boosted chunk {result.get('chunk_index')} from {current_score:.3f} to {result['similarity_score']:.3f}")
            
            # Combine header results with standard results (header results get priority)
            # Deduplicate by doc_id + chunk_index
            seen_chunks = set()
            combined_results = []
            
            # Add header results first (they get priority)
            for result in header_results:
                chunk_key = (result.get('doc_id'), result.get('chunk_index'))
                if chunk_key not in seen_chunks:
                    combined_results.append(result)
                    seen_chunks.add(chunk_key)
            
            # Add standard results (skip duplicates)
            for result in results:
                chunk_key = (result.get('doc_id'), result.get('chunk_index'))
                if chunk_key not in seen_chunks:
                    combined_results.append(result)
                    seen_chunks.add(chunk_key)
            
            # Post-Retrieval Header-Based Boosting (Phase 2): Apply additional boosting to combined results
            # This ensures chunks with matching section headers get prioritized even after combination
            if relevant_normalized:
                for result in combined_results:
                    chunk_text = result.get('chunk_text', '')
                    if chunk_text:
                        # If header not already detected, detect it now
                        if '_detected_normalized_header' not in result:
                            header_info = detect_section_header(chunk_text)
                            if header_info:
                                result['_detected_section_header'] = header_info.get('section_header')
                                result['_detected_normalized_header'] = header_info.get('normalized_header')
                        
                        # Boost if detected header matches query intent (generic matching)
                        detected_normalized = result.get('_detected_normalized_header')
                        if detected_normalized and detected_normalized in relevant_normalized:
                            current_score = result.get('similarity_score', 0.0)
                            # Additional 1.5x boost for matching headers in combined results
                            result['similarity_score'] = current_score * 1.5
                            logger.debug(f"[RUNTIME_HEADER] Post-retrieval boost for matching header: '{result.get('_detected_section_header')}' (score: {current_score:.3f} → {result['similarity_score']:.3f})")
            
            # Use combined results
            results = combined_results
            query_time = time.time() - query_start
            logger.info(f"[QUERY_HYBRID] Query {query_index}/{len(queries)} '{query[:40]}...' → {len(results)} docs in {query_time:.2f}s")
            return (query_index, results)
        
        # OPTIMIZATION: Process all queries in parallel using ThreadPoolExecutor
        # Since retriever.query_documents is synchronous, we use threads for parallelization
        import concurrent.futures
        if len(queries) > 1:
            # Parallel execution for multiple queries
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(queries), 3)) as executor:
                futures = [executor.submit(process_single_query, query, i+1) for i, query in enumerate(queries)]
                query_results = [future.result() for future in concurrent.futures.as_completed(futures)]
            # Sort by query_index to maintain order
            query_results.sort(key=lambda x: x[0])
            all_results = [results for _, results in query_results]
        else:
            # Single query - no need for parallelization
            _, results = process_single_query(queries[0], 1)
            all_results = [results]
        
        hybrid_time = time.time() - hybrid_start
        logger.info(f"[QUERY_VECTOR_DOCUMENTS] Hybrid search completed in {hybrid_time:.2f}s")
        
        # Merge results using Reciprocal Rank Fusion
        if len(all_results) > 1:
            merged_results = reciprocal_rank_fusion(all_results)
            logger.info(
                f"[QUERY_HYBRID] Merged {len(merged_results)} unique documents from {len(queries)} query variations"
            )
        else:
            merged_results = all_results[0] if all_results else []
            logger.info(
                f"[QUERY_HYBRID] Retrieved {len(merged_results)} documents via hybrid search"
            )
        
        # CRITICAL: Log if merged_results is empty
        if len(merged_results) == 0:
            logger.error(
                f"[QUERY_HYBRID] ❌ Hybrid search returned 0 results! "
                f"Query: '{user_query[:50]}...', "
                f"business_id: {business_id[:8] if business_id else 'MISSING'}..., "
                f"all_results count: {len(all_results)}, "
                f"all_results lengths: {[len(r) for r in all_results]}"
            )
        
        # STEP 3: LLM-Driven SQL Query with Tool (if structured query found nothing or needs refinement)
        # Let LLM agent use the SQL query tool directly to find properties
        llm_sql_results = []
        if (not structured_results or len(structured_results) < 3) and business_id:
            try:
                from langchain_openai import ChatOpenAI
                from backend.llm.tools.sql_query_tool import create_property_query_tool, SQLQueryTool
                from backend.services.supabase_client_factory import get_supabase_client
                
                supabase = get_supabase_client()  # Get supabase client for LLM SQL queries
                
                # Create the tool instance
                sql_tool = SQLQueryTool(business_id=business_id)
                
                # Create LLM with tool binding (agent can invoke tool directly)
                llm = ChatOpenAI(
                    api_key=config.openai_api_key,
                    model=config.openai_model,
                    temperature=0.3,
                )
                
                # Use centralized prompt
                # Get system prompt for SQL query task
                system_msg_sql = get_system_prompt('sql_query')
                
                # Get human message content
                human_content_sql = get_llm_sql_query_human_content(user_query=state['user_query'])
                
                # Use LangGraph message format - ASYNC for better performance
                messages_sql = [system_msg_sql, HumanMessage(content=human_content_sql)]
                prompt = messages_sql  # Keep variable name for compatibility
                
                response = await llm.ainvoke(prompt)
                import json
                import re
                
                # Extract JSON from response
                json_match = re.search(r'\{[^}]+\}', response.content, re.DOTALL)
                if json_match:
                    query_params = json.loads(json_match.group(0))
                    logger.info(f"[QUERY_LLM_SQL] LLM generated query params: {query_params}")
                    
                    # Execute SQL query with LLM-generated parameters
                    similar_properties = sql_tool.query_properties(
                        number_bedrooms=query_params.get('number_bedrooms'),
                        number_bathrooms=query_params.get('number_bathrooms'),
                        bedroom_min=query_params['bedroom_range'][0] if query_params.get('bedroom_range') else None,
                        bedroom_max=query_params['bedroom_range'][1] if query_params.get('bedroom_range') else None,
                        bathroom_min=query_params['bathroom_range'][0] if query_params.get('bathroom_range') else None,
                        bathroom_max=query_params['bathroom_range'][1] if query_params.get('bathroom_range') else None,
                        property_type=query_params.get('property_type'),
                        min_price=query_params.get('min_price'),
                        max_price=query_params.get('max_price'),
                        min_size_sqft=query_params.get('min_size_sqft'),
                        max_size_sqft=query_params.get('max_size_sqft'),
                        limit=20
                    )
                    
                    if similar_properties:
                        # Convert to document results (same format as structured_results)
                        property_ids = [p['property_id'] for p in similar_properties]
                        
                        # Get documents linked to these properties
                        doc_results = supabase.table('document_relationships')\
                            .select('document_id, property_id')\
                            .in_('property_id', property_ids)\
                            .execute()
                        
                        if doc_results.data:
                            doc_ids = list(set([d['document_id'] for d in doc_results.data]))
                            docs = supabase.table('documents')\
                                .select('id, original_filename, classification_type, document_summary')\
                                .in_('id', doc_ids)\
                                .eq('business_uuid', business_id)\
                                .execute()
                            
                            addresses = supabase.table('properties')\
                                .select('id, formatted_address')\
                                .in_('id', property_ids)\
                                .execute()
                            
                            address_map = {a['id']: a['formatted_address'] for a in addresses.data}
                            property_details_map = {p['property_id']: p for p in similar_properties}
                            
                            for doc in docs.data:
                                prop_id = next((dr['property_id'] for dr in doc_results.data if dr['document_id'] == doc['id']), None)
                                prop_details = property_details_map.get(prop_id, {}) if prop_id else {}
                                
                                # Build property context (include all fields for completeness)
                                property_context = ""
                                if prop_details:
                                    context_parts = []
                                    if prop_details.get('number_bedrooms') is not None:
                                        context_parts.append(f"{prop_details['number_bedrooms']} bedroom(s)")
                                    if prop_details.get('number_bathrooms') is not None:
                                        context_parts.append(f"{prop_details['number_bathrooms']} bathroom(s)")
                                    if prop_details.get('property_type'):
                                        context_parts.append(f"Type: {prop_details['property_type']}")
                                    if prop_details.get('size_sqft'):
                                        size_value = prop_details['size_sqft']
                                        size_unit = prop_details.get('size_unit', '').lower() if prop_details.get('size_unit') else ''
                                        # Only show as acres if explicitly stated in size_unit field
                                        if size_unit in ('acres', 'acre'):
                                            context_parts.append(f"Size: {size_value:,.2f} acres")
                                        else:
                                            context_parts.append(f"Size: {size_value:,.0f} sqft")
                                    if prop_details.get('asking_price'):
                                        context_parts.append(f"Asking price: £{prop_details['asking_price']:,.0f}")
                                    if prop_details.get('sold_price'):
                                        context_parts.append(f"Sold price: £{prop_details['sold_price']:,.0f}")
                                    if prop_details.get('rent_pcm'):
                                        context_parts.append(f"Rent (pcm): £{prop_details['rent_pcm']:,.0f}")
                                    if prop_details.get('tenure'):
                                        context_parts.append(f"Tenure: {prop_details['tenure']}")
                                    if prop_details.get('epc_rating'):
                                        context_parts.append(f"EPC: {prop_details['epc_rating']}")
                                    if prop_details.get('condition'):
                                        context_parts.append(f"Condition: {prop_details['condition']}")
                                    if context_parts:
                                        property_context = f"""PROPERTY DETAILS (VERIFIED FROM DATABASE - INCLUDES MANUALLY UPDATED VALUES):
This property has: {', '.join(context_parts)}.

This information has been verified and extracted from the property database, including any manually updated values. The document below may contain additional details about this property.

"""
                                
                                # Get chunks
                                # OPTIMIZATION: Adaptive chunk limit based on query characteristics
                                user_query = state.get('user_query', '')
                                characteristics = detect_query_characteristics(user_query)
                                complexity = characteristics['complexity_score']
                                needs_comprehensive = characteristics['needs_comprehensive']
                                
                                # Base limit: 50 chunks, scale up based on complexity
                                base_limit = 50
                                if needs_comprehensive:
                                    chunk_limit = 150  # Use more chunks for comprehensive queries
                                else:
                                    chunk_limit = int(base_limit * (1 + complexity * 2))  # 50-150 chunks
                                chunk_limit = min(chunk_limit, 150)  # Cap at 150
                                
                                # OPTIMIZATION: Use similarity-based chunk retrieval instead of sequential
                                # This ensures chunks from all pages (including page 30+) are retrieved if similar
                                query_type = characteristics.get('query_type', 'general')
                                similar_chunks = retrieve_chunks_by_similarity(
                                    doc_id=doc['id'],
                                    user_query=user_query,
                                    top_k=chunk_limit,
                                    match_threshold=0.3,  # Minimum similarity threshold (will be lowered for assessment queries)
                                    query_type=query_type
                                )
                                
                                # Convert to expected format
                                class MockResult:
                                    def __init__(self, data):
                                        self.data = data
                                chunks_result = MockResult(similar_chunks)
                                
                                chunk_texts = [c.get('chunk_text', '').strip() for c in chunks_result.data if c.get('chunk_text', '').strip() and len(c.get('chunk_text', '').strip()) > 10]
                                # Extract party names for this document (similar to structured query above)
                                party_names_context_llm = ""
                                try:
                                    import json
                                    document_summary_llm = doc.get('document_summary')
                                    if document_summary_llm:
                                        if isinstance(document_summary_llm, str):
                                            try:
                                                document_summary_llm = json.loads(document_summary_llm)
                                                if isinstance(document_summary_llm, str):
                                                    document_summary_llm = json.loads(document_summary_llm)
                                            except (json.JSONDecodeError, TypeError):
                                                document_summary_llm = None
                                        
                                        if isinstance(document_summary_llm, dict):
                                            party_names_llm = document_summary_llm.get('party_names', {})
                                            if party_names_llm:
                                                name_parts_llm = []
                                                if valuer := party_names_llm.get('valuer'):
                                                    name_parts_llm.append(f"Valuer: {valuer}")
                                                if seller := party_names_llm.get('seller'):
                                                    name_parts_llm.append(f"Seller: {seller}")
                                                if buyer := party_names_llm.get('buyer'):
                                                    name_parts_llm.append(f"Buyer: {buyer}")
                                                if agent := party_names_llm.get('estate_agent'):
                                                    name_parts_llm.append(f"Estate Agent: {agent}")
                                                
                                                if name_parts_llm:
                                                    party_names_context_llm = "PARTY_NAMES: " + " | ".join(name_parts_llm) + "\n\n"
                                except Exception as e:
                                    logger.debug(f"[QUERY_LLM_SQL] Could not extract party names: {e}")
                                
                                combined_content = party_names_context_llm + property_context + "\n\n---\n\n".join(chunk_texts) if chunk_texts else party_names_context_llm + property_context + f"Similar property from {doc.get('original_filename', 'document')}."
                                
                                llm_sql_results.append({
                                    'doc_id': doc['id'],
                                    'document_id': doc['id'],
                                    'property_id': prop_id,
                                    'property_address': address_map.get(prop_id, 'Unknown'),
                                    'original_filename': doc.get('original_filename', ''),
                                    'classification_type': doc.get('classification_type', ''),
                                    'content': combined_content,
                                    'similarity_score': 0.8,  # Lower than exact matches
                                    'source': 'llm_sql_query',
                                    'chunk_index': 0,
                                    'page_number': None,
                                    'page_numbers': []
                                })
                        
                        logger.info(f"[QUERY_LLM_SQL] Found {len(llm_sql_results)} documents via LLM-driven SQL query")
            except Exception as e:
                logger.warning(f"[QUERY_LLM_SQL] LLM SQL query failed: {e}")
                import traceback
                logger.debug(traceback.format_exc())
        
        # STEP 4: Filter by document_ids EARLY if provided (for document-specific search)
        # This ensures we only search within selected documents, not across all documents
        # Note: document_ids was already retrieved from state at the start of the function
        document_ids_set = None
        if document_ids and len(document_ids) > 0:
            # Convert to set for faster lookup
            document_ids_set = set(str(doc_id) for doc_id in document_ids)  # Ensure all are strings
            logger.info(f"[QUERY_FILTER] Document filtering enabled: {len(document_ids)} document(s) selected: {[str(d)[:8] + '...' for d in document_ids[:5]]}")
        
        # STEP 5: Combine ALL search results (structured + LLM SQL + hybrid)
        # Priority: Structured (exact) > LLM SQL (similar) > Hybrid (semantic)
        # IMPORTANT: Filter each result set BEFORE adding to final_results
        seen_doc_ids = set()
        final_results = []
        
        # Helper function to check if document is in selected set
        def is_document_selected(doc: dict) -> bool:
            """Check if document is in the selected document_ids set."""
            if document_ids_set is None:
                return True  # No filtering - all documents allowed
            doc_id = doc.get('doc_id') or doc.get('document_id')
            if not doc_id:
                return False  # No doc_id - exclude
            # Convert to string for comparison (handles UUID vs string mismatches)
            return str(doc_id) in document_ids_set
        
        # 1. Add structured results first (exact matches, highest priority)
        # FILTER: Only add if in selected document_ids
        for doc in structured_results:
            if not is_document_selected(doc):
                continue  # Skip documents not in selection
            doc_id = doc.get('doc_id') or doc.get('document_id')
            if doc_id and doc_id not in seen_doc_ids:
                final_results.append(doc)
                seen_doc_ids.add(doc_id)
        
        # 2. Add LLM SQL results (similar matches, medium priority)
        # FILTER: Only add if in selected document_ids
        for doc in llm_sql_results:
            if not is_document_selected(doc):
                continue  # Skip documents not in selection
            doc_id = doc.get('doc_id') or doc.get('document_id')
            if doc_id and doc_id not in seen_doc_ids:
                final_results.append(doc)
                seen_doc_ids.add(doc_id)
        
        # 3. Add hybrid results (semantic matches, lower priority, avoid duplicates)
        # FILTER: Only add if in selected document_ids
        logger.info(f"[QUERY_VECTOR_DOCUMENTS] Processing {len(merged_results)} hybrid results, document_ids_set: {document_ids_set is not None}")
        hybrid_added = 0
        hybrid_skipped = 0
        for doc in merged_results:
            if not is_document_selected(doc):
                hybrid_skipped += 1
                continue  # Skip documents not in selection
            doc_id = doc.get('doc_id') or doc.get('document_id')
            if doc_id and doc_id not in seen_doc_ids:
                final_results.append(doc)
                seen_doc_ids.add(doc_id)
                hybrid_added += 1
        logger.info(f"[QUERY_VECTOR_DOCUMENTS] Hybrid results: {hybrid_added} added, {hybrid_skipped} skipped (filtered)")
        
        # Log filtering results
        if document_ids_set:
            logger.info(
                f"[QUERY_FILTERED] Document filtering applied: "
                f"Structured: {len([d for d in structured_results if is_document_selected(d)])}/{len(structured_results)}, "
                f"LLM SQL: {len([d for d in llm_sql_results if is_document_selected(d)])}/{len(llm_sql_results)}, "
                f"Hybrid: {len([d for d in merged_results if is_document_selected(d)])}/{len(merged_results)}, "
                f"Final: {len(final_results)}"
            )
        
        node_time = time.time() - node_start
        
        # CRITICAL: Log final results before returning
        final_count = len(final_results)
        top_k_limit = config.vector_top_k
        final_returned = final_results[:top_k_limit] if final_count > 0 else []
        
        logger.info(
            f"[QUERY_VECTOR_DOCUMENTS] Completed in {node_time:.2f}s: "
            f"Structured: {len(structured_results)}, LLM SQL: {len(llm_sql_results)}, "
            f"Hybrid: {len(merged_results)}, Final: {final_count}, Returning: {len(final_returned)} (limit: {top_k_limit})"
        )
        
        # CRITICAL: Warn if no results found
        if final_count == 0:
            logger.error(
                f"[QUERY_VECTOR_DOCUMENTS] ❌ NO RESULTS FOUND! "
                f"Query: '{user_query[:50]}...', "
                f"business_id: {business_id[:8] if business_id else 'MISSING'}..., "
                f"Structured: {len(structured_results)}, Hybrid: {len(merged_results)}"
            )
        else:
            logger.info(f"[QUERY_VECTOR_DOCUMENTS] ✅ Returning {len(final_returned)} documents")
        
        return {"relevant_documents": final_returned}

    except Exception as exc:  # pylint: disable=broad-except
        node_time = time.time() - node_start
        logger.error(f"[QUERY_VECTOR_DOCUMENTS] Failed after {node_time:.2f}s: {exc}", exc_info=True)
        logger.error("[QUERY_HYBRID] Hybrid search failed: %s", exc, exc_info=True)
        # Fallback to vector-only search if hybrid fails
        try:
            logger.info("[QUERY_HYBRID] Falling back to vector-only search")
            retriever = VectorDocumentRetriever()
            results = retriever.query_documents(
                user_query=state['user_query'],
                top_k=config.vector_top_k,
                business_id=state.get("business_id"),
            )
            return {"relevant_documents": results}
        except Exception as fallback_exc:
            logger.error("[QUERY_HYBRID] Fallback also failed: %s", fallback_exc, exc_info=True)
            return {"relevant_documents": []}


def query_structured_documents(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: SQL search (Structured Attributes)

    Converts natural language query to SQL and queries extracted property attributes.
    Only executes if query_intent includes "structured".
    
    Args:
        state: MainWorkflowState with user_query, query_intent
    
    Returns:
        Updated state with SQL results appended to relevant_documents
    """

    # Skip if not a structured query 
    if "structured" not in state['query_intent']:
        logger.debug("[QUERY_SQL] Skipping - not a structured query")
        return {"relevant_documents": []}

    logger.warning(
        "[QUERY_SQL] Structured retrieval not implemented yet; returning no results"
    )
    return {"relevant_documents": []}


def combine_and_deduplicate(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Combine and Deduplicate Results
    
    Merges vector and SQL results, removes duplicates by doc_id.
    If same document appears in both, marks as "hybrid" and merges metadata.
    
    Args:
        state: MainWorkflowState with relevant_documents (from both retrievers)
    
    Returns:
        Updated state with deduplicated relevant_documents
    """
    
    combined = state['relevant_documents']
    
    if not combined:
        logger.debug("[COMBINE] No documents to combine")
        return {"relevant_documents": []}

    seen = {}
    for doc in combined:
        key = (doc.get("doc_id"), doc.get("property_id"))
        existing = seen.get(key)
        if existing is None:
            seen[key] = doc
            continue

        # Mark as hybrid if sourced from multiple retrievers
        if doc.get("source") != existing.get("source"):
            existing["source"] = "hybrid"

        # Keep maximum similarity score (if available)
        existing["similarity_score"] = max(
            existing.get("similarity_score", 0.0),
            doc.get("similarity_score", 0.0),
        )

    deduplicated = list(seen.values())
    logger.info(
        "[COMBINE] Deduplicated %d documents to %d unique results",
        len(combined),
        len(deduplicated),
    )
    return {"relevant_documents": deduplicated}


async def clarify_relevant_docs(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Clarify/Re-rank Documents
    
    1. Groups chunks by doc_id (merges chunks from same document)
    2. Uses LLM to re-rank documents by relevance to the original query
    3. Goes beyond vector similarity to semantic understanding
    
    Args:
        state: MainWorkflowState with relevant_documents
    
    Returns:
        Updated state with re-ranked, deduplicated relevant_documents
    """
    
    docs = state['relevant_documents']
    
    if not docs:
        logger.debug("[CLARIFY] No documents to clarify")
        return {"relevant_documents": []}
    
    # Step 1: Group chunks by doc_id
    doc_groups = {}
    for doc in docs:
        doc_id = doc.get('doc_id')
        if not doc_id:
            logger.warning("[CLARIFY] Skipping document with no doc_id")
            continue
        
        # Log first occurrence for debugging
        if doc_id not in doc_groups:
            logger.debug(f"[CLARIFY] Creating new group for doc_id: {doc_id[:8]}...")
            
        if doc_id not in doc_groups:
            # Initialize with first chunk's metadata
            doc_groups[doc_id] = {
                'doc_id': doc_id,
                'property_id': doc.get('property_id'),
                'classification_type': doc.get('classification_type'),
                'business_id': doc.get('business_id'),
                'address_hash': doc.get('address_hash'),
                'source': doc.get('source'),
                'chunks': [],
                'max_similarity': doc.get('similarity_score', 0.0),
                # NEW: Store filename and address from first chunk
                'original_filename': doc.get('original_filename'),
                'property_address': doc.get('property_address'),
            }
        
        # Append chunk content WITH bbox metadata
        doc_groups[doc_id]['chunks'].append({
            'content': doc.get('content', ''),
            'chunk_index': doc.get('chunk_index', 0),
            'page_number': doc.get('page_number', 0),
            'similarity': doc.get('similarity_score', 0.0),
            'bbox': doc.get('bbox'),  # NEW: Preserve bbox for citation/highlighting
            'vector_id': doc.get('vector_id'),  # NEW: Preserve vector_id for lookup
        })
        
        # Track highest similarity score across all chunks
        doc_groups[doc_id]['max_similarity'] = max(
            doc_groups[doc_id]['max_similarity'],
            doc.get('similarity_score', 0.0)
        )
    
    # Step 2: Merge chunks and create single document entry per doc_id
    merged_docs = []
    for doc_id, group in doc_groups.items():
        # Sort chunks by chunk_index for proper ordering
        # Handle None values by treating them as 0 (or a large number to put them at the end)
        group['chunks'].sort(key=lambda x: x.get('chunk_index') if x.get('chunk_index') is not None else 0)
        
        # Merge chunk content using smart multi-factor selection algorithm
        # This replaces hardcoded valuation logic with adaptive algorithm for all query types
        user_query = state.get('user_query', '')
        query_characteristics = detect_query_characteristics(user_query)
        query_type = query_characteristics.get('query_type', 'general')
        
        # Use smart chunk selection algorithm
        top_chunks = smart_select_chunks(group['chunks'], user_query, query_type)
        
        merged_content = "\n\n".join([chunk['content'] for chunk in top_chunks])
        
        # Extract page numbers from top chunks (filter out 0 and None)
        page_numbers = sorted(set(
            chunk['page_number'] for chunk in top_chunks 
            if chunk.get('page_number') and chunk.get('page_number') > 0
        ))
        
        if len(page_numbers) > 1:
            page_range = f"pages {min(page_numbers)}-{max(page_numbers)}"
        elif len(page_numbers) == 1:
            page_range = f"page {page_numbers[0]}"
        else:
            # No valid page numbers, show chunk count instead
            page_range = f"{len(group['chunks'])} chunks"
        
        merged_docs.append({
            'doc_id': doc_id,
            'property_id': group['property_id'],
            'content': merged_content,
            'classification_type': group['classification_type'],
            'business_id': group['business_id'],
            'address_hash': group['address_hash'],
            'source': group['source'],
            'similarity_score': group['max_similarity'],
            'chunk_count': len(group['chunks']),
            'page_numbers': page_numbers,  # List of page numbers
            'page_range': page_range,  # Human-readable page range
            # NEW: Pass through filename and address
            'original_filename': group.get('original_filename'),
            'property_address': group.get('property_address'),
            # NEW: Store source chunks with full metadata for citation/highlighting
            'source_chunks_metadata': [
                {
                    'content': chunk['content'],
                    'chunk_index': chunk['chunk_index'],
                    'page_number': chunk['page_number'],
                    'bbox': chunk.get('bbox'),
                    'vector_id': chunk.get('vector_id'),
                    'similarity': chunk['similarity'],
                    'doc_id': doc_id  # NEW: Include doc_id in each chunk for citation recovery
                }
                for chunk in top_chunks  # Only top chunks used in summary
            ]
        })
    
    logger.info(
        "[CLARIFY] Grouped %d chunks into %d unique documents:",
        len(docs),
        len(merged_docs)
    )
    
    # Log unique doc IDs for debugging
    for idx, doc in enumerate(merged_docs[:10], 1):
        property_id = doc.get('property_id') or 'none'
        logger.info(
            f"  {idx}. Doc {doc['doc_id'][:8]}... | Property {property_id[:8]}... | "
            f"{doc.get('page_range', 'unknown')} | {doc.get('chunk_count', 0)} chunks"
        )
    
    # PERFORMANCE OPTIMIZATION: Skip reranking for small result sets or when Cohere is disabled
    # Reranking adds latency and isn't necessary when we have few documents or high confidence
    max_docs_for_reranking = int(os.getenv("MAX_DOCS_FOR_RERANKING", "8"))
    if len(merged_docs) <= max_docs_for_reranking:
        logger.info(
            "[CLARIFY] Only %d documents (threshold: %d), skipping re-ranking for speed",
            len(merged_docs),
            max_docs_for_reranking
        )
        return {"relevant_documents": merged_docs}
    
    # Also skip if documents have very high similarity scores (already well-ranked)
    high_confidence_docs = [doc for doc in merged_docs if doc.get('similarity_score', 0) > 0.8]
    if len(high_confidence_docs) >= len(merged_docs) * 0.7:  # 70% have high confidence
        logger.info(
            "[CLARIFY] %d%% of documents have high confidence scores (>0.8), skipping re-ranking",
            int(len(high_confidence_docs) / len(merged_docs) * 100)
        )
        return {"relevant_documents": merged_docs}

    # Step 3: Cohere reranking (replaces expensive LLM reranking)
    # PERFORMANCE OPTIMIZATION: Only rerank if we have many documents and Cohere is enabled
    try:
        from backend.llm.retrievers.cohere_reranker import CohereReranker
        
        reranker = CohereReranker()
        
        # Only rerank if we have enough documents to justify the latency
        min_docs_for_reranking = int(os.getenv("MIN_DOCS_FOR_RERANKING", "6"))
        should_rerank = (
            reranker.is_enabled() 
            and config.cohere_rerank_enabled 
            and len(merged_docs) >= min_docs_for_reranking
        )
        
        if should_rerank:
            logger.info("[CLARIFY] Using Cohere reranker for %d documents", len(merged_docs))
            
            # Rerank documents using Cohere (limit to reasonable number for speed)
            max_rerank = min(len(merged_docs), 15)  # Reduced from 20 for speed
            reranked_docs = reranker.rerank(
                query=state['user_query'],
                documents=merged_docs,
                top_n=max_rerank
            )
            
            logger.info("[CLARIFY] Cohere reranked %d documents", len(reranked_docs))
            return {"relevant_documents": reranked_docs}
        else:
            if not reranker.is_enabled() or not config.cohere_rerank_enabled:
                logger.info("[CLARIFY] Cohere reranker disabled, using original order")
            else:
                logger.info(
                    "[CLARIFY] Only %d documents (threshold: %d), skipping Cohere reranking for speed",
                    len(merged_docs),
                    min_docs_for_reranking
                )
            return {"relevant_documents": merged_docs}
            
    except ImportError:
        logger.warning("[CLARIFY] Cohere reranker not available, falling back to LLM")
        # Fallback to LLM reranking if Cohere not available
        return await _llm_rerank_fallback(state, merged_docs)
    except Exception as exc:
        logger.error("[CLARIFY] Cohere reranker failed: %s", exc)
        logger.warning("[CLARIFY] Falling back to original order")
        return {"relevant_documents": merged_docs}


async def _llm_rerank_fallback(state: MainWorkflowState, merged_docs: List[Dict]) -> MainWorkflowState:
    """Fallback LLM reranking if Cohere fails."""
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )

    # LLM re-ranking (for merged documents)
    doc_summary = "\n".join(
        (
            f"- Doc {idx + 1}: ID={(doc.get('doc_id') or 'unknown')[:8]} | "
            f"Property={(doc.get('property_id') or 'none')[:8]} | "
            f"Type={doc.get('classification_type', '')} | "
            f"Chunks={doc.get('chunk_count', 1)} | "
            f"Similarity={doc.get('similarity_score', 0.0):.2f} | "
            f"Source={doc.get('source', 'unknown')}"
        )
        for idx, doc in enumerate(merged_docs)
    )

    # Get system prompt for ranking task
    system_msg = get_system_prompt('rank')
    
    # Get human message content
    human_content = get_reranking_human_content(
        user_query=state['user_query'],
        doc_summary=doc_summary
    )
    
    try:
        # Use LangGraph message format - ASYNC for better performance
        messages = [system_msg, HumanMessage(content=human_content)]
        response = await llm.ainvoke(messages)
        ranked_ids = json.loads(response.content)
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("[CLARIFY] Failed to parse ranking; returning original order: %s", exc)
        return {"relevant_documents": merged_docs}

    doc_map = {doc["doc_id"]: doc for doc in merged_docs if doc.get("doc_id")}
    reordered = [doc_map[doc_id] for doc_id in ranked_ids if doc_id in doc_map]

    # Append any documents missing from LLM output
    for doc in merged_docs:
        if doc not in reordered:
            reordered.append(doc)

    logger.info("[CLARIFY] LLM fallback re-ranked %d unique documents", len(reordered))
    return {"relevant_documents": reordered}


async def create_source_chunks_metadata_for_single_chunk(chunk: Dict[str, Any], doc_id: str) -> Dict[str, Any]:
    """
    Create source_chunks_metadata for a single chunk by fetching blocks from database.
    
    This function is used when clarify_relevant_docs is skipped and individual chunks
    need metadata for citation/BBOX functionality.
    
    Args:
        chunk: Chunk dictionary with chunk_index, page_number, content, etc.
        doc_id: Document ID to fetch blocks from
        
    Returns:
        Dictionary with metadata structure:
        {
            'content': str,
            'chunk_index': int,
            'page_number': int,
            'bbox': dict,
            'blocks': list[dict],
            'vector_id': str,
            'similarity': float,
            'doc_id': str
        }
    """
    from backend.services.supabase_client_factory import get_supabase_client
    
    chunk_index = chunk.get('chunk_index', 0)
    page_number = chunk.get('page_number', 0)
    content = chunk.get('content', '')
    similarity_value = chunk.get('similarity') or chunk.get('similarity_score', 0.0)
    vector_id = chunk.get('vector_id', '')
    bbox = chunk.get('bbox')
    
    # Try to get blocks from chunk first (if already present)
    blocks = chunk.get('blocks', [])
    
    # If blocks not in chunk, fetch from database (with caching)
    if not blocks or not isinstance(blocks, list) or len(blocks) == 0:
        # Check cache first
        if doc_id in _document_summary_cache:
            document_summary = _document_summary_cache[doc_id]
        else:
            try:
                supabase = get_supabase_client()
                
                # Fetch document to get document_summary with reducto_chunks
                doc_result = supabase.table('documents')\
                    .select('id, document_summary')\
                    .eq('id', doc_id)\
                    .single()\
                    .execute()
            
                if doc_result.data:
                    import json
                    document_summary = doc_result.data.get('document_summary')
                    
                    # Parse document_summary if it's a string
                    if isinstance(document_summary, str):
                        try:
                            document_summary = json.loads(document_summary)
                            if isinstance(document_summary, str):
                                document_summary = json.loads(document_summary)
                        except (json.JSONDecodeError, TypeError):
                            document_summary = None
                    
                    # Cache the parsed document_summary
                    if isinstance(document_summary, dict):
                        _document_summary_cache[doc_id] = document_summary
            except Exception as e:
                logger.warning(
                    f"[CREATE_METADATA] Failed to fetch document_summary for doc {doc_id[:8]}: {e}"
                )
                document_summary = None
        
        # Extract blocks from reducto_chunks (from cache or fresh fetch)
        if isinstance(document_summary, dict):
            reducto_chunks = document_summary.get('reducto_chunks', [])
            if reducto_chunks and isinstance(reducto_chunks, list):
                # Find chunk by chunk_index
                for rc in reducto_chunks:
                    rc_index = rc.get('chunk_index')
                    if rc_index is None:
                        # Try to match by position if chunk_index not stored
                        try:
                            rc_index = reducto_chunks.index(rc)
                        except ValueError:
                            continue
                    
                    if rc_index == chunk_index:
                        blocks = rc.get('blocks', [])
                        # Also get bbox if not already set
                        if not bbox:
                            bbox = rc.get('bbox')
                        break
                
                logger.debug(
                    f"[CREATE_METADATA] Fetched {len(blocks) if blocks else 0} blocks for chunk {chunk_index} (doc {doc_id[:8]})"
                )
    
    # Create metadata structure
    metadata = {
        'content': content,
        'chunk_index': chunk_index,
        'page_number': page_number,
        'bbox': bbox,
        'blocks': blocks if blocks else [],
        'vector_id': vector_id,
        'similarity': similarity_value,
        'doc_id': doc_id
    }
    
    return metadata


# Request-scoped cache for document_summary to prevent duplicate fetches
_document_summary_cache: Dict[str, Dict] = {}


async def batch_create_source_chunks_metadata(chunks: List[Dict[str, Any]], doc_ids: List[str]) -> Dict[Tuple[str, int], Dict[str, Any]]:
    """
    Batch create source_chunks_metadata for multiple chunks, grouping by doc_id to minimize database queries.
    
    This function fetches document_summary for all unique doc_ids in one batch, then distributes
    blocks to chunks in memory. This is much more efficient than calling create_source_chunks_metadata_for_single_chunk
    for each chunk individually.
    
    Args:
        chunks: List of chunk dictionaries, each with chunk_index, page_number, content, etc.
        doc_ids: List of document IDs corresponding to chunks (same length as chunks)
        
    Returns:
        Dictionary mapping (doc_id, chunk_index) tuple to metadata dictionary:
        {
            (doc_id, chunk_index): {
                'content': str,
                'chunk_index': int,
                'page_number': int,
                'bbox': dict,
                'blocks': list[dict],
                'vector_id': str,
                'similarity': float,
                'doc_id': str
            }
        }
    """
    from backend.services.supabase_client_factory import get_supabase_client
    import json
    
    if not chunks or not doc_ids or len(chunks) != len(doc_ids):
        logger.warning("[BATCH_METADATA] Invalid input: chunks and doc_ids must be same length")
        return {}
    
    # Group chunks by doc_id to minimize queries
    chunks_by_doc: Dict[str, List[Tuple[int, Dict]]] = {}  # doc_id -> [(chunk_index, chunk), ...]
    for idx, (chunk, doc_id) in enumerate(zip(chunks, doc_ids)):
        if doc_id not in chunks_by_doc:
            chunks_by_doc[doc_id] = []
        chunks_by_doc[doc_id].append((chunk.get('chunk_index', idx), chunk))
    
    # Fetch all unique document_summaries in parallel
    unique_doc_ids = list(chunks_by_doc.keys())
    supabase = get_supabase_client()
    
    # Batch fetch all document_summaries using IN clause
    try:
        doc_results = supabase.table('documents')\
            .select('id, document_summary')\
            .in_('id', unique_doc_ids)\
            .execute()
        
        # Parse document_summaries and cache them
        doc_summaries: Dict[str, Dict] = {}
        for doc_result in doc_results.data:
            doc_id = doc_result.get('id')
            document_summary = doc_result.get('document_summary')
            
            # Parse document_summary if it's a string
            if isinstance(document_summary, str):
                try:
                    document_summary = json.loads(document_summary)
                    if isinstance(document_summary, str):
                        document_summary = json.loads(document_summary)
                except (json.JSONDecodeError, TypeError):
                    document_summary = None
            
            if isinstance(document_summary, dict):
                doc_summaries[doc_id] = document_summary
                # Cache for potential future use in same request
                _document_summary_cache[doc_id] = document_summary
        
        logger.info(
            f"[BATCH_METADATA] Fetched {len(doc_summaries)} document_summaries for {len(unique_doc_ids)} unique documents"
        )
    except Exception as e:
        logger.warning(f"[BATCH_METADATA] Failed to batch fetch document_summaries: {e}")
        doc_summaries = {}
    
    # Distribute blocks to chunks
    # Use (doc_id, chunk_index) as key to ensure uniqueness across documents
    result: Dict[Tuple[str, int], Dict[str, Any]] = {}
    
    for doc_id, chunk_list in chunks_by_doc.items():
        document_summary = doc_summaries.get(doc_id)
        reducto_chunks = []
        
        if isinstance(document_summary, dict):
            reducto_chunks = document_summary.get('reducto_chunks', [])
            if not isinstance(reducto_chunks, list):
                reducto_chunks = []
        
        for chunk_index, chunk in chunk_list:
            # Find blocks for this chunk
            blocks = chunk.get('blocks', [])
            bbox = chunk.get('bbox')
            
            # If blocks not in chunk, extract from reducto_chunks
            if (not blocks or not isinstance(blocks, list) or len(blocks) == 0) and reducto_chunks:
                for rc in reducto_chunks:
                    rc_index = rc.get('chunk_index')
                    if rc_index is None:
                        # Try to match by position if chunk_index not stored
                        try:
                            rc_index = reducto_chunks.index(rc)
                        except ValueError:
                            continue
                    
                    if rc_index == chunk_index:
                        blocks = rc.get('blocks', [])
                        if not bbox:
                            bbox = rc.get('bbox')
                        break
            
            # Create metadata structure
            metadata = {
                'content': chunk.get('content', ''),
                'chunk_index': chunk_index,
                'page_number': chunk.get('page_number', 0),
                'bbox': bbox,
                'blocks': blocks if blocks else [],
                'vector_id': chunk.get('vector_id', ''),
                'similarity': chunk.get('similarity') or chunk.get('similarity_score', 0.0),
                'doc_id': doc_id
            }
            
            # Use (doc_id, chunk_index) as key to ensure uniqueness
            result[(doc_id, chunk_index)] = metadata
    
    logger.info(
        f"[BATCH_METADATA] Created metadata for {len(result)} chunks from {len(unique_doc_ids)} documents"
    )
    
    return result


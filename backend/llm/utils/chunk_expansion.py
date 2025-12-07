"""
Chunk Expansion Utility for Adjacency-Based Context Retrieval.

This module provides utilities to expand retrieved chunks with their adjacent neighbors,
which dramatically improves retrieval accuracy for multi-paragraph concepts (e.g., lease
clauses, covenants, conditions) that are split across multiple chunks during chunking.

Example:
    Query: "What are the renewal terms?"
    
    Without expansion:
        Returns: Chunk 48 ("Break clause and renewal terms")
        Problem: References to chunks 47 and 49 are missing
    
    With expansion (±2):
        Returns: Chunks 46, 47, 48, 49, 50
        Result: LLM sees full context, 20-40% accuracy improvement

Key Features:
    - Fetches adjacent chunks by chunk_index (±N)
    - Handles edge cases (missing chunks, document boundaries)
    - Batch expansion for performance optimization
    - Preserves ordering (left → center → right)
"""

from typing import List, Dict, Tuple, Optional, Any
import logging

logger = logging.getLogger(__name__)


def expand_chunk_with_adjacency(
    doc_id: str,
    chunk_index: int,
    expand_left: int = 2,
    expand_right: int = 2,
    supabase_client=None
) -> List[str]:
    """
    Fetch adjacent chunks for a given chunk and return ordered list of chunk texts.
    
    Retrieves chunks within range [chunk_index - expand_left, chunk_index + expand_right]
    and returns them as an ordered list. Missing chunks are skipped (e.g., if chunk_index
    is at document start, left chunks won't exist).
    
    Args:
        doc_id: Document ID to fetch chunks from
        chunk_index: The center chunk index (the chunk that matched the query)
        expand_left: Number of chunks to fetch before chunk_index (default: 2)
        expand_right: Number of chunks to fetch after chunk_index (default: 2)
        supabase_client: Supabase client instance (will be created if None)
        
    Returns:
        List of chunk texts in order: [left_chunks..., center_chunk, right_chunks...]
        Returns empty list if center chunk doesn't exist or on error.
        
    Example:
        >>> expand_chunk_with_adjacency("doc-123", 48, expand_left=2, expand_right=2)
        [
            "Term of lease...",      # chunk_index 46
            "Lease duration...",     # chunk_index 47
            "Break clause and renewal terms...",  # chunk_index 48 (center)
            "Tenant obligations...", # chunk_index 49
            "Service charges..."     # chunk_index 50
        ]
    """
    if not doc_id or chunk_index is None:
        logger.warning("expand_chunk_with_adjacency called with invalid doc_id or chunk_index")
        return []
    
    # Import here to avoid circular dependencies
    if supabase_client is None:
        from backend.services.supabase_client_factory import get_supabase_client
        supabase_client = get_supabase_client()
    
    try:
        # Calculate chunk index range
        min_index = max(0, chunk_index - expand_left)  # Don't go below 0
        max_index = chunk_index + expand_right
        
        logger.debug(
            f"Expanding chunk {chunk_index} from document {doc_id[:8]}... "
            f"(range: {min_index} to {max_index})"
        )
        
        # Fetch all chunks in range with a single query (efficient)
        result = supabase_client.table('document_vectors')\
            .select('chunk_index, chunk_text')\
            .eq('document_id', doc_id)\
            .gte('chunk_index', min_index)\
            .lte('chunk_index', max_index)\
            .order('chunk_index', desc=False)\
            .execute()
        
        if not result.data:
            logger.warning(
                f"No chunks found for document {doc_id[:8]} in range [{min_index}, {max_index}]"
            )
            return []
        
        # Build ordered list of chunk texts
        # Create a dict for O(1) lookup: {chunk_index: chunk_text}
        chunks_dict = {item['chunk_index']: item['chunk_text'] for item in result.data}
        
        # Check if center chunk exists (required)
        if chunk_index not in chunks_dict:
            logger.warning(
                f"Center chunk {chunk_index} not found in document {doc_id[:8]}"
            )
            return []
        
        # Build ordered list: left chunks → center chunk → right chunks
        expanded_chunks = []
        
        # Add left chunks (in order)
        for idx in range(min_index, chunk_index):
            if idx in chunks_dict:
                expanded_chunks.append(chunks_dict[idx])
            # Missing chunks are skipped (no error - they just don't exist)
        
        # Add center chunk (required - this is the one that matched)
        expanded_chunks.append(chunks_dict[chunk_index])
        
        # Add right chunks (in order)
        for idx in range(chunk_index + 1, max_index + 1):
            if idx in chunks_dict:
                expanded_chunks.append(chunks_dict[idx])
            # Missing chunks are skipped
        
        logger.debug(
            f"Expanded chunk {chunk_index} to {len(expanded_chunks)} chunks "
            f"(requested range: {expand_left + expand_right + 1} chunks)"
        )
        
        return expanded_chunks
        
    except Exception as e:
        logger.error(
            f"Error expanding chunk {chunk_index} for document {doc_id[:8]}: {e}",
            exc_info=True
        )
        return []


def batch_expand_chunks(
    chunk_list: List[Dict[str, Any]],
    expand_left: int = 2,
    expand_right: int = 2,
    supabase_client=None
) -> Dict[Tuple[str, int], List[str]]:
    """
    Batch expand multiple chunks efficiently (avoids N+1 query problem).
    
    Fetches all needed chunks in minimal queries by grouping by document_id.
    This is much more efficient than calling expand_chunk_with_adjacency() in a loop.
    
    Args:
        chunk_list: List of dicts with keys: {'doc_id': str, 'chunk_index': int, ...}
                   Each dict represents a chunk that needs expansion
        expand_left: Number of chunks to fetch before each chunk_index (default: 2)
        expand_right: Number of chunks to fetch after each chunk_index (default: 2)
        supabase_client: Supabase client instance (will be created if None)
        
    Returns:
        Dict mapping (doc_id, chunk_index) tuples to lists of expanded chunk texts.
        Format: {(doc_id, chunk_index): [chunk_text, ...]}
        Only includes entries where the center chunk was successfully found.
        
    Example:
        >>> chunks = [
        ...     {'doc_id': 'doc-1', 'chunk_index': 5, ...},
        ...     {'doc_id': 'doc-1', 'chunk_index': 10, ...},
        ...     {'doc_id': 'doc-2', 'chunk_index': 3, ...}
        ... ]
        >>> batch_expand_chunks(chunks, expand_left=1, expand_right=1)
        {
            ('doc-1', 5): ['chunk 4', 'chunk 5', 'chunk 6'],
            ('doc-1', 10): ['chunk 9', 'chunk 10', 'chunk 11'],
            ('doc-2', 3): ['chunk 2', 'chunk 3', 'chunk 4']
        }
    """
    if not chunk_list:
        return {}
    
    # Import here to avoid circular dependencies
    if supabase_client is None:
        from backend.services.supabase_client_factory import get_supabase_client
        supabase_client = get_supabase_client()
    
    # Group chunks by document_id for efficient batch fetching
    chunks_by_doc: Dict[str, List[int]] = {}
    chunk_metadata: Dict[Tuple[str, int], Dict[str, Any]] = {}
    
    for chunk in chunk_list:
        doc_id = chunk.get('doc_id') or chunk.get('document_id')
        chunk_index = chunk.get('chunk_index')
        
        if not doc_id or chunk_index is None:
            logger.warning(f"Skipping chunk with missing doc_id or chunk_index: {chunk}")
            continue
        
        if doc_id not in chunks_by_doc:
            chunks_by_doc[doc_id] = []
        
        chunks_by_doc[doc_id].append(chunk_index)
        chunk_metadata[(doc_id, chunk_index)] = chunk
    
    logger.debug(
        f"Batch expanding {len(chunk_list)} chunks across {len(chunks_by_doc)} documents"
    )
    
    # Result: {(doc_id, chunk_index): [expanded_chunk_texts]}
    expanded_results: Dict[Tuple[str, int], List[str]] = {}
    
    # Process each document separately (one query per document)
    for doc_id, chunk_indices in chunks_by_doc.items():
        try:
            # Calculate the min/max chunk_index range for this document
            # This allows us to fetch all needed chunks in one query
            all_indices = set(chunk_indices)
            
            # For each center chunk, calculate its expansion range
            min_indices = [max(0, idx - expand_left) for idx in chunk_indices]
            max_indices = [idx + expand_right for idx in chunk_indices]
            
            # Overall range to fetch (union of all ranges)
            min_range = min(min_indices)
            max_range = max(max_indices)
            
            # Fetch all chunks in range for this document
            result = supabase_client.table('document_vectors')\
                .select('chunk_index, chunk_text')\
                .eq('document_id', doc_id)\
                .gte('chunk_index', min_range)\
                .lte('chunk_index', max_range)\
                .order('chunk_index', desc=False)\
                .execute()
            
            if not result.data:
                logger.warning(
                    f"No chunks found for document {doc_id[:8]} in range [{min_range}, {max_range}]"
                )
                continue
            
            # Build lookup dict: {chunk_index: chunk_text}
            chunks_dict = {item['chunk_index']: item['chunk_text'] for item in result.data}
            
            # Expand each center chunk individually
            for center_index in chunk_indices:
                # Check if center chunk exists (required)
                if center_index not in chunks_dict:
                    logger.warning(
                        f"Center chunk {center_index} not found in document {doc_id[:8]}"
                    )
                    continue
                
                # Calculate this chunk's expansion range
                chunk_min = max(0, center_index - expand_left)
                chunk_max = center_index + expand_right
                
                # Build ordered list: left → center → right
                expanded = []
                
                # Left chunks
                for idx in range(chunk_min, center_index):
                    if idx in chunks_dict:
                        expanded.append(chunks_dict[idx])
                
                # Center chunk
                expanded.append(chunks_dict[center_index])
                
                # Right chunks
                for idx in range(center_index + 1, chunk_max + 1):
                    if idx in chunks_dict:
                        expanded.append(chunks_dict[idx])
                
                expanded_results[(doc_id, center_index)] = expanded
                
        except Exception as e:
            logger.error(
                f"Error batch expanding chunks for document {doc_id[:8]}: {e}",
                exc_info=True
            )
            # Continue with other documents even if one fails
    
    logger.debug(
        f"Batch expansion completed: {len(expanded_results)}/{len(chunk_list)} chunks expanded"
    )
    
    return expanded_results


def merge_expanded_chunks(expanded_chunks: List[str], separator: str = "\n\n---\n\n") -> str:
    """
    Merge expanded chunk texts into a single string with separators.
    
    Useful for creating a single content string from expanded chunks that can be
    passed to the LLM. The separator helps the LLM distinguish between chunks.
    
    Args:
        expanded_chunks: List of chunk text strings (from expand_chunk_with_adjacency)
        separator: String to insert between chunks (default: "\n\n---\n\n")
        
    Returns:
        Single merged string with chunks separated by separator.
        Returns empty string if expanded_chunks is empty.
        
    Example:
        >>> chunks = ["Chunk 1 text", "Chunk 2 text", "Chunk 3 text"]
        >>> merge_expanded_chunks(chunks)
        "Chunk 1 text\n\n---\n\nChunk 2 text\n\n---\n\nChunk 3 text"
    """
    if not expanded_chunks:
        return ""
    
    return separator.join(expanded_chunks)


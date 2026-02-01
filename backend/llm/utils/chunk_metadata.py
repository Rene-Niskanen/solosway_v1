"""
Chunk metadata creation utilities.

These functions create source_chunks_metadata for chunks.
"""

import logging
from typing import List, Dict, Any, Tuple

logger = logging.getLogger(__name__)


async def create_source_chunks_metadata_for_single_chunk(
    chunk: Dict[str, Any],
    doc_id: str
) -> Dict[str, Any]:
    """
    Create source_chunks_metadata for a single chunk.
    
    Args:
        chunk: Chunk dictionary with chunk_index, chunk_text, etc.
        doc_id: Document ID
        
    Returns:
        Metadata dictionary with blocks, page_number, etc.
    """
    # TODO: Implement proper metadata creation if needed
    # For now, return basic metadata structure
    logger.warning(
        "[CHUNK_METADATA] create_source_chunks_metadata_for_single_chunk is a stub - "
        "metadata creation may be incomplete"
    )
    
    return {
        'blocks': chunk.get('blocks', []),
        'page_number': chunk.get('page_number', 0),
        'chunk_index': chunk.get('chunk_index', 0),
        'bbox': chunk.get('bbox'),
    }


async def batch_create_source_chunks_metadata(
    chunks: List[Dict[str, Any]],
    doc_ids: List[str]
) -> Dict[Tuple[str, int], Dict[str, Any]]:
    """
    Batch create source_chunks_metadata for multiple chunks.
    
    Args:
        chunks: List of chunk dictionaries
        doc_ids: List of document IDs (one per chunk)
        
    Returns:
        Dictionary mapping (doc_id, chunk_index) to metadata
    """
    # TODO: Implement proper batch metadata creation if needed
    # For now, return basic metadata for each chunk
    logger.warning(
        "[CHUNK_METADATA] batch_create_source_chunks_metadata is a stub - "
        "metadata creation may be incomplete"
    )
    
    metadata_dict = {}
    for chunk, doc_id in zip(chunks, doc_ids):
        chunk_index = chunk.get('chunk_index', 0)
        metadata_key = (doc_id, chunk_index)
        metadata_dict[metadata_key] = {
            'blocks': chunk.get('blocks', []),
            'page_number': chunk.get('page_number', 0),
            'chunk_index': chunk_index,
            'bbox': chunk.get('bbox'),
        }
    
    return metadata_dict


"""
Citation Mapping Service - Maps block IDs to bbox coordinates.

This service processes citation tool calls from the LLM and maps block IDs
to their bbox coordinates using the metadata lookup tables.
No text matching needed - LLM provides block ID directly.
"""

import logging
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)


def map_block_id_to_bbox(
    block_id: str,
    metadata_lookup_table: Dict[str, Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """
    Map block ID to bbox coordinates (simple lookup - no text matching).
    
    Args:
        block_id: Block ID from LLM tool call (e.g., "BLOCK_CITE_ID_3")
        metadata_lookup_table: Metadata table with bbox coordinates
            Format: {block_id -> {page, bbox_left, bbox_top, bbox_width, bbox_height, ...}}
    
    Returns:
        Dict with bbox, page, doc_id, etc., or None if not found
        Format: {
            'bbox': {'left': float, 'top': float, 'width': float, 'height': float, 'page': int},
            'page': int,
            'doc_id': str,
            'chunk_index': int,
            'confidence': str,
            'method': 'block-id-lookup'
        }
    """
    block_metadata = metadata_lookup_table.get(block_id)
    
    if not block_metadata:
        logger.warning(f"🟡 [CITATION_MAP] Block ID {block_id} not found in metadata table")
        return None
    
    # Extract bbox coordinates
    bbox_left = block_metadata.get('bbox_left', 0.0)
    bbox_top = block_metadata.get('bbox_top', 0.0)
    bbox_width = block_metadata.get('bbox_width', 0.0)
    bbox_height = block_metadata.get('bbox_height', 0.0)
    page = block_metadata.get('page', 0)
    
    # Build normalized bbox dict
    bbox = {
        'left': round(float(bbox_left), 4),
        'top': round(float(bbox_top), 4),
        'width': round(float(bbox_width), 4),
        'height': round(float(bbox_height), 4),
        'page': int(page) if page is not None else 0
    }
    
    logger.info(
        f"🟢 [CITATION_MAP] Mapped {block_id} to bbox "
        f"(page: {bbox['page']}, area: {bbox['width'] * bbox['height']:.4f})"
    )
    
    return {
        'bbox': bbox,
        'page': int(page) if page is not None else 0,
        'doc_id': block_metadata.get('doc_id', ''),
        'chunk_index': block_metadata.get('chunk_index', 0),
        'confidence': block_metadata.get('confidence', 'medium'),
        'method': 'block-id-lookup'
    }


def process_citations_from_tools(
    citations_from_tools: List[Dict[str, Any]],
    metadata_lookup_tables: Dict[str, Dict[str, Dict[str, Any]]]
    # Format: doc_id -> block_id -> metadata
) -> Dict[str, Dict[str, Any]]:
    """
    Process citations from tool calls - simple block ID lookup.
    
    This function takes citation tool calls from the LLM (via streaming)
    and maps them to bbox coordinates using the metadata lookup tables.
    
    Args:
        citations_from_tools: List of citation tool calls from LLM
            Each citation dict contains:
            - citation_number: int (1, 2, 3, etc.)
            - block_id: str (e.g., "BLOCK_CITE_ID_3")
            - cited_text: str (LLM's paraphrased text)
        metadata_lookup_tables: Map of doc_id -> metadata_table
            Format: {
                'doc_123': {
                    'BLOCK_CITE_ID_1': {page: 1, bbox_left: 0.1, ...},
                    'BLOCK_CITE_ID_2': {page: 1, bbox_left: 0.2, ...}
                },
                'doc_456': {
                    'BLOCK_CITE_ID_3': {page: 3, bbox_left: 0.05, ...}
                }
            }
    
    Returns:
        Dict mapping citation_number -> citation data with bbox
        Format: {
            '1': {
                'doc_id': 'doc_123',
                'page': 1,
                'bbox': {'left': 0.1, 'top': 0.2, 'width': 0.8, 'height': 0.3, 'page': 1},
                'method': 'block-id-lookup'
            },
            '2': {...}
        }
    """
    processed_citations = {}
    
    if not citations_from_tools:
        logger.info("[CITATION_MAP] No citations from tools to process")
        return processed_citations
    
    if not metadata_lookup_tables:
        logger.warning("[CITATION_MAP] No metadata lookup tables provided")
        return processed_citations
    
    for citation in citations_from_tools:
        citation_num = citation.get('citation_number')
        block_id = citation.get('block_id')
        
        if not citation_num:
            logger.warning("[CITATION_MAP] Citation missing citation_number, skipping")
            continue
        
        if not block_id:
            logger.warning(f"[CITATION_MAP] Citation {citation_num} missing block_id, skipping")
            continue
        
        citation_num_str = str(citation_num)
        
        # Find which doc this block belongs to by searching metadata tables
        block_metadata = None
        doc_id = None
        
        for doc_id_candidate, metadata_table in metadata_lookup_tables.items():
            if block_id in metadata_table:
                block_metadata = metadata_table[block_id]
                doc_id = doc_id_candidate
                break
        
        if not block_metadata:
            logger.warning(
                f"⚠️ [CITATION_MAP] Block ID {block_id} (citation {citation_num_str}) "
                f"not found in any metadata table"
            )
            continue
        
        # Map to bbox using the metadata table that contains this block
        # Create a lookup table with just this block for the mapping function
        single_block_table = {block_id: block_metadata}
        citation_data = map_block_id_to_bbox(block_id, single_block_table)
        
        if citation_data:
            processed_citations[citation_num_str] = {
                'doc_id': doc_id,
                'page': citation_data['page'],
                'bbox': citation_data['bbox'],
                'method': citation_data['method'],
                'chunk_index': citation_data.get('chunk_index', 0),
                'confidence': citation_data.get('confidence', 'medium')
            }
            
            logger.info(
                f"🟢 [CITATION_MAP] Processed citation {citation_num_str} "
                f"from block {block_id} (doc: {doc_id[:8] if doc_id else 'UNKNOWN'}, "
                f"page: {citation_data['page']}, method: {citation_data['method']})"
            )
        else:
            logger.warning(
                f"🟡 [CITATION_MAP] Failed to map block {block_id} "
                f"for citation {citation_num_str}"
            )
    
    logger.info(
        f"[CITATION_MAP] Processed {len(processed_citations)}/{len(citations_from_tools)} citations successfully"
    )
    
    return processed_citations


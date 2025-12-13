"""
Block ID Formatter - Formats document extracts with embedded block IDs for citation mapping.

This module provides functionality to format document content with block IDs embedded,
enabling the LLM to reference specific blocks directly via block IDs instead of text matching.
"""

import logging
from typing import Dict, Any, Tuple, Optional

logger = logging.getLogger(__name__)


def format_document_with_block_ids(doc_output: dict) -> Tuple[str, Dict[str, Dict[str, Any]]]:
    """
    Format document content with block IDs embedded and create metadata lookup table.
    
    This function processes a document output (from processing_nodes) and:
    1. Embeds unique block IDs (BLOCK_CITE_ID_N) into the formatted content
    2. Creates a metadata lookup table mapping block IDs to bbox coordinates
    
    The formatted content will have blocks wrapped in <BLOCK> tags with IDs:
    <BLOCK id="BLOCK_CITE_ID_1">
    Content: [block content]
    </BLOCK>
    
    Args:
        doc_output: Document output dictionary containing:
            - output: str (document content)
            - doc_id: str (document ID)
            - source_chunks_metadata: list[dict] (chunks with blocks)
                Each chunk dict contains:
                - chunk_index: int
                - page_number: int
                - bbox: dict (chunk-level bbox: left, top, width, height, page)
                - blocks: list[dict] (block-level metadata)
                    Each block dict contains:
                    - content: str
                    - bbox: dict (block-level bbox: left, top, width, height, page)
                    - type: str (optional)
                    - confidence: str (optional)
                - content: str (chunk-level content, fallback)
    
    Returns:
        Tuple[str, Dict[str, Dict[str, Any]]]:
            - formatted_content: str - Document content with embedded block IDs
            - metadata_table: dict - Maps block_id -> {
                'page': int,
                'bbox_left': float,
                'bbox_top': float,
                'bbox_width': float,
                'bbox_height': float,
                'chunk_index': int,
                'doc_id': str,
                'confidence': str
            }
    """
    doc_content = doc_output.get('output', '')
    source_chunks_metadata = doc_output.get('source_chunks_metadata', [])
    doc_id = doc_output.get('doc_id', '')
    
    formatted_blocks = []
    metadata_table = {}
    block_id_counter = 1
    
    if not source_chunks_metadata:
        logger.warning(
            f"[BLOCK_ID_FORMATTER] No source_chunks_metadata found for doc {doc_id[:8] if doc_id else 'UNKNOWN'}, "
            f"using output content as fallback"
        )
        # Fallback: use output content as a single block
        if doc_content:
            block_id = f"BLOCK_CITE_ID_{block_id_counter}"
            formatted_blocks.append(
                f'<BLOCK id="{block_id}">\n'
                f'Content: {doc_content}\n'
                f'</BLOCK>\n'
            )
            metadata_table[block_id] = {
                'page': 0,
                'bbox_left': 0.0,
                'bbox_top': 0.0,
                'bbox_width': 1.0,
                'bbox_height': 1.0,
                'chunk_index': 0,
                'doc_id': doc_id,
                'confidence': 'low'  # Fallback confidence
            }
    
    # #region agent log
    # Debug: Log blocks availability for Hypothesis A and C
    try:
        total_chunks = len(source_chunks_metadata)
        chunks_with_blocks = sum(1 for chunk in source_chunks_metadata if chunk.get('blocks') and isinstance(chunk.get('blocks'), list) and len(chunk.get('blocks')) > 0)
        import json
        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
            f.write(json.dumps({
                'sessionId': 'debug-session',
                'runId': 'run1',
                'hypothesisId': 'A,C',
                'location': 'block_id_formatter.py:90',
                'message': 'Checking blocks in source_chunks_metadata',
                'data': {
                    'doc_id': doc_id[:8] if doc_id else 'unknown',
                    'total_chunks': total_chunks,
                    'chunks_with_blocks': chunks_with_blocks,
                    'has_source_chunks_metadata': bool(source_chunks_metadata)
                },
                'timestamp': int(__import__('time').time() * 1000)
            }) + '\n')
    except Exception:
        pass  # Silently fail instrumentation
    # #endregion
    
    for chunk in source_chunks_metadata:
        chunk_index = chunk.get('chunk_index', 0)
        blocks = chunk.get('blocks', [])
        page_number = chunk.get('page_number', 0)
        
        if blocks and isinstance(blocks, list) and len(blocks) > 0:
            # Format each block with ID
            for block in blocks:
                block_content = block.get('content', '').strip()
                if not block_content:
                    # Skip empty blocks
                    continue
                
                block_id = f"BLOCK_CITE_ID_{block_id_counter}"
                block_id_counter += 1
                
                # Format block with ID
                formatted_blocks.append(
                    f'<BLOCK id="{block_id}">\n'
                    f'Content: {block_content}\n'
                    f'</BLOCK>\n'
                )
                
                # Extract bbox coordinates from block
                bbox = block.get('bbox', {})
                
                # #region agent log
                # Debug: Log bbox extraction for Hypothesis B
                try:
                    has_bbox = bool(bbox and isinstance(bbox, dict))
                    bbox_valid = False
                    if has_bbox:
                        bbox_valid = (
                            isinstance(bbox.get('left'), (int, float)) and
                            isinstance(bbox.get('top'), (int, float)) and
                            isinstance(bbox.get('width'), (int, float)) and
                            isinstance(bbox.get('height'), (int, float))
                        )
                    import json
                    with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                        f.write(json.dumps({
                            'sessionId': 'debug-session',
                            'runId': 'run1',
                            'hypothesisId': 'B',
                            'location': 'block_id_formatter.py:128',
                            'message': 'Bbox extracted from block',
                            'data': {
                                'block_id': block_id,
                                'has_bbox': has_bbox,
                                'bbox_valid': bbox_valid,
                                'bbox': bbox if has_bbox else None,
                                'page_number': page_number,
                                'doc_id': doc_id[:8] if doc_id else 'unknown'
                            },
                            'timestamp': int(__import__('time').time() * 1000)
                        }) + '\n')
                except Exception:
                    pass  # Silently fail instrumentation
                # #endregion
                
                # Normalize bbox values (ensure they're numbers, default to 0 if missing)
                bbox_left = float(bbox.get('left', 0)) if bbox and isinstance(bbox, dict) else 0.0
                bbox_top = float(bbox.get('top', 0)) if bbox and isinstance(bbox, dict) else 0.0
                bbox_width = float(bbox.get('width', 0)) if bbox and isinstance(bbox, dict) else 0.0
                bbox_height = float(bbox.get('height', 0)) if bbox and isinstance(bbox, dict) else 0.0
                
                # Get page from bbox first, fallback to chunk page_number
                block_page = bbox.get('page') if bbox and isinstance(bbox, dict) else page_number
                if block_page is None:
                    block_page = page_number
                
                # Add to metadata lookup table
                metadata_table[block_id] = {
                    'page': int(block_page) if block_page is not None else 0,
                    'bbox_left': round(bbox_left, 4),
                    'bbox_top': round(bbox_top, 4),
                    'bbox_width': round(bbox_width, 4),
                    'bbox_height': round(bbox_height, 4),
                    'chunk_index': chunk_index,
                    'doc_id': doc_id,
                    'confidence': block.get('confidence', 'medium'),
                    'content': block_content  # Store block content for verification
                }
                
                # #region agent log
                # Debug: Log bbox validity for Hypothesis C
                try:
                    bbox_valid = (0 <= bbox_left <= 1 and 0 <= bbox_top <= 1 and 
                                 0 < bbox_width <= 1 and 0 < bbox_height <= 1 and
                                 not (bbox_left == 0 and bbox_top == 0 and bbox_width == 0 and bbox_height == 0))
                    import json
                    with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                        f.write(json.dumps({
                            'sessionId': 'debug-session',
                            'runId': 'run1',
                            'hypothesisId': 'C',
                            'location': 'block_id_formatter.py:128',
                            'message': 'Block bbox added to metadata table',
                            'data': {
                                'block_id': block_id,
                                'bbox': {'left': bbox_left, 'top': bbox_top, 'width': bbox_width, 'height': bbox_height, 'page': block_page},
                                'bbox_valid': bbox_valid,
                                'doc_id': doc_id[:8] if doc_id else 'unknown'
                            },
                            'timestamp': int(__import__('time').time() * 1000)
                        }) + '\n')
                except Exception:
                    pass  # Silently fail instrumentation
                # #endregion
                
                logger.debug(
                    f"[BLOCK_ID_FORMATTER] Created block {block_id} "
                    f"(page: {block_page}, chunk: {chunk_index}, "
                    f"bbox: [{bbox_left:.4f}, {bbox_top:.4f}, {bbox_width:.4f}, {bbox_height:.4f}])"
                )
        else:
            # No blocks - use chunk-level content with ID
            chunk_content = chunk.get('content', '').strip()
            if not chunk_content:
                # Skip empty chunks
                continue
            
            block_id = f"BLOCK_CITE_ID_{block_id_counter}"
            block_id_counter += 1
            
            formatted_blocks.append(
                f'<BLOCK id="{block_id}">\n'
                f'Content: {chunk_content}\n'
                f'</BLOCK>\n'
            )
            
            # Use chunk-level bbox (fallback)
            bbox = chunk.get('bbox', {})
            
            # Normalize bbox values
            bbox_left = float(bbox.get('left', 0)) if bbox and isinstance(bbox, dict) else 0.0
            bbox_top = float(bbox.get('top', 0)) if bbox and isinstance(bbox, dict) else 0.0
            bbox_width = float(bbox.get('width', 0)) if bbox and isinstance(bbox, dict) else 0.0
            bbox_height = float(bbox.get('height', 0)) if bbox and isinstance(bbox, dict) else 0.0
            
            # Add to metadata lookup table
            metadata_table[block_id] = {
                'page': int(page_number) if page_number is not None else 0,
                'bbox_left': round(bbox_left, 4),
                'bbox_top': round(bbox_top, 4),
                'bbox_width': round(bbox_width, 4),
                'bbox_height': round(bbox_height, 4),
                'chunk_index': chunk_index,
                'doc_id': doc_id,
                'confidence': 'medium',  # Chunk-level confidence (no block-level data)
                'content': chunk_content  # Store chunk content for verification
            }
            
            logger.debug(
                f"[BLOCK_ID_FORMATTER] Created chunk-level block {block_id} "
                f"(page: {page_number}, chunk: {chunk_index}, "
                f"bbox: [{bbox_left:.4f}, {bbox_top:.4f}, {bbox_width:.4f}, {bbox_height:.4f}])"
            )
    
    formatted_content = "\n".join(formatted_blocks)
    
    # #region agent log
    # Debug: Log metadata table summary for Hypothesis C
    try:
        import json
        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
            f.write(json.dumps({
                'sessionId': 'debug-session',
                'runId': 'run1',
                'hypothesisId': 'C',
                'location': 'block_id_formatter.py:232',
                'message': 'Metadata lookup table created',
                'data': {
                    'doc_id': doc_id[:8] if doc_id else 'unknown',
                    'metadata_table_size': len(metadata_table),
                    'formatted_blocks_count': len(formatted_blocks),
                    'sample_block_ids': list(metadata_table.keys())[:5] if metadata_table else []
                },
                'timestamp': int(__import__('time').time() * 1000)
            }) + '\n')
    except Exception:
        pass  # Silently fail instrumentation
    # #endregion
    
    logger.info(
        f"[BLOCK_ID_FORMATTER] Formatted doc {doc_id[:8] if doc_id else 'UNKNOWN'} "
        f"with {len(metadata_table)} block IDs"
    )
    
    return formatted_content, metadata_table


"""
Retroactive Section Header Extraction Script

Extracts section headers from existing Reducto blocks and updates document_vectors metadata.

This script:
1. Fetches all chunks for a business that have blocks but missing section headers
2. Extracts section headers from blocks using the existing extraction code
3. Propagates section headers to subsequent chunks (like vector_service does)
4. Updates the metadata JSONB column in batches

Usage:
    python backend/scripts/retroactive_section_header_extraction.py --business-id <business_id> [--document-id <document_id>] [--dry-run]
"""

import os
import sys
import argparse
import logging
from typing import List, Dict, Optional
from dotenv import load_dotenv

# Add parent directory to path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

# Load environment variables
load_dotenv()

from backend.services.supabase_client_factory import get_supabase_client
from backend.services.section_header_extractor import (
    extract_section_header_from_blocks,
    extract_keywords
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def extract_section_headers_from_chunks(
    chunks: List[Dict],
    business_id: str
) -> List[Dict]:
    """
    Extract section headers from chunks' blocks and propagate them.
    
    This mimics the logic in vector_service.py (lines 1187-1251).
    
    Args:
        chunks: List of chunk dictionaries from database
        business_id: Business ID for logging
        
    Returns:
        List of updated metadata dictionaries (one per chunk)
    """
    updated_metadata_list = []
    current_section_header = None
    current_section_title = None
    current_section_level = None
    
    for i, chunk in enumerate(chunks):
        chunk_id = chunk.get('id')
        chunk_blocks = chunk.get('blocks', [])
        existing_metadata = chunk.get('metadata', {}) or {}
        chunk_page = chunk.get('page_number')
        chunk_bbox = chunk.get('bbox')
        
        section_header_info = None
        
        # PHASE 1: Extract section header from blocks array (primary source - Reducto)
        if chunk_blocks and isinstance(chunk_blocks, list):
            section_header_info = extract_section_header_from_blocks(chunk_blocks)
        
        # PHASE 2: Propagate section header if no new one found
        if section_header_info:
            # New section header found - update current section
            current_section_header = section_header_info['section_header']
            current_section_title = section_header_info['section_title']
            current_section_level = section_header_info['section_level']
            logger.debug(
                f"📑 [SECTION_HEADER] Chunk {i} ({chunk_id[:8]}...): "
                f"Found new section header '{current_section_header}' (level {current_section_level})"
            )
        elif current_section_header:
            # No new header, but we have a current section - propagate it
            section_header_info = {
                "section_header": current_section_header,
                "section_title": current_section_title,
                "section_level": current_section_level,
                "page_number": None,  # Not from this chunk
                "bbox": None
            }
            logger.debug(
                f"📑 [SECTION_HEADER] Chunk {i} ({chunk_id[:8]}...): "
                f"Propagating section '{current_section_header}'"
            )
        
        # Fallback: Check existing metadata for section header (legacy support)
        if not section_header_info:
            section_header = existing_metadata.get('section_header')
            section_title = existing_metadata.get('section_title')
            section_level = existing_metadata.get('section_level')
            normalized_header = existing_metadata.get('normalized_header')
            has_section_header = existing_metadata.get('has_section_header', False)
            
            if has_section_header and section_header:
                section_header_info = {
                    "section_header": section_header,
                    "section_title": section_title or normalized_header,
                    "section_level": section_level or 2,  # Default to level 2
                    "page_number": chunk_page,
                    "bbox": chunk_bbox
                }
                # Update current section for propagation
                current_section_header = section_header
                current_section_title = section_title or normalized_header
                current_section_level = section_level or 2
        
        # Build updated metadata JSONB
        updated_metadata = existing_metadata.copy() if existing_metadata else {}
        
        if section_header_info:
            # Extract keywords from section header
            section_keywords = extract_keywords(section_header_info['section_header'])
            
            # Update metadata with section header info
            updated_metadata.update({
                'section_header': section_header_info['section_header'],
                'section_title': section_header_info['section_title'],  # Normalized title (used as section_id)
                'section_level': section_header_info['section_level'],  # Hierarchy level (1, 2, 3)
                'normalized_header': section_header_info['section_title'],  # Same as section_title
                'section_keywords': section_keywords,
                'has_section_header': (section_header_info.get('page_number') is not None)  # True if header is in this chunk
            })
        else:
            # No section header (document start, before first header)
            # Only update if not already set (preserve existing metadata)
            if 'has_section_header' not in updated_metadata:
                updated_metadata['has_section_header'] = False
            if 'section_title' not in updated_metadata:
                updated_metadata['section_title'] = None
            if 'section_level' not in updated_metadata:
                updated_metadata['section_level'] = None
        
        updated_metadata_list.append({
            'chunk_id': chunk_id,
            'metadata': updated_metadata
        })
    
    return updated_metadata_list


def update_chunks_metadata(
    supabase,
    updated_metadata_list: List[Dict],
    dry_run: bool = False
) -> int:
    """
    Update chunks' metadata in Supabase.
    
    Args:
        supabase: Supabase client
        updated_metadata_list: List of {chunk_id, metadata} dictionaries
        dry_run: If True, only log what would be updated (don't actually update)
        
    Returns:
        Number of chunks updated
    """
    if not updated_metadata_list:
        logger.info("No chunks to update")
        return 0
    
    updated_count = 0
    batch_size = 50  # Update in batches to avoid overwhelming the database
    
    for i in range(0, len(updated_metadata_list), batch_size):
        batch = updated_metadata_list[i:i + batch_size]
        
        for item in batch:
            chunk_id = item['chunk_id']
            metadata = item['metadata']
            
            if dry_run:
                has_header = metadata.get('has_section_header', False)
                section_header = metadata.get('section_header', 'None')
                logger.info(
                    f"[DRY RUN] Would update chunk {chunk_id[:8]}... "
                    f"with section_header='{section_header}', has_section_header={has_header}"
                )
            else:
                try:
                    result = supabase.table('document_vectors').update({
                        'metadata': metadata
                    }).eq('id', chunk_id).execute()
                    
                    if result.data:
                        updated_count += 1
                        if updated_count % 10 == 0:
                            logger.info(f"Updated {updated_count} chunks...")
                    else:
                        logger.warning(f"Failed to update chunk {chunk_id[:8]}... (no data returned)")
                except Exception as e:
                    logger.error(f"Error updating chunk {chunk_id[:8]}...: {e}")
                    continue
    
    return updated_count


def main():
    parser = argparse.ArgumentParser(
        description='Retroactively extract section headers from Reducto blocks and update metadata'
    )
    parser.add_argument(
        '--business-id',
        type=str,
        required=True,
        help='Business ID (UUID or text) to process chunks for'
    )
    parser.add_argument(
        '--document-id',
        type=str,
        default=None,
        help='Optional: Specific document ID to process (if not provided, processes all documents for business)'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Dry run mode: show what would be updated without actually updating'
    )
    parser.add_argument(
        '--min-blocks',
        type=int,
        default=1,
        help='Minimum number of blocks required for a chunk to be processed (default: 1)'
    )
    
    args = parser.parse_args()
    
    logger.info(f"Starting retroactive section header extraction for business: {args.business_id}")
    if args.document_id:
        logger.info(f"Processing document: {args.document_id}")
    if args.dry_run:
        logger.info("DRY RUN MODE - No changes will be made")
    
    # Get Supabase client
    try:
        supabase = get_supabase_client()
    except Exception as e:
        logger.error(f"Failed to get Supabase client: {e}")
        sys.exit(1)
    
    # Fetch chunks
    logger.info("Fetching chunks from database...")
    query = supabase.table('document_vectors').select(
        'id, document_id, chunk_index, page_number, bbox, blocks, metadata'
    ).eq('business_id', args.business_id)
    
    if args.document_id:
        query = query.eq('document_id', args.document_id)
    
    # Order by document_id, then chunk_index to maintain document order
    query = query.order('document_id').order('chunk_index')
    
    result = query.execute()
    
    if not result.data:
        logger.warning(f"No chunks found for business {args.business_id}")
        sys.exit(0)
    
    chunks = result.data
    logger.info(f"Found {len(chunks)} chunks")
    
    # Filter chunks that have blocks
    chunks_with_blocks = [
        chunk for chunk in chunks
        if chunk.get('blocks') and isinstance(chunk.get('blocks'), list) and len(chunk.get('blocks', [])) >= args.min_blocks
    ]
    logger.info(f"Found {len(chunks_with_blocks)} chunks with blocks (min {args.min_blocks} blocks)")
    
    # Group chunks by document_id to process each document separately
    chunks_by_doc = {}
    for chunk in chunks_with_blocks:
        doc_id = chunk.get('document_id')
        if doc_id not in chunks_by_doc:
            chunks_by_doc[doc_id] = []
        chunks_by_doc[doc_id].append(chunk)
    
    logger.info(f"Processing {len(chunks_by_doc)} documents...")
    
    total_updated = 0
    for doc_id, doc_chunks in chunks_by_doc.items():
        logger.info(f"\n📄 Processing document {doc_id[:8]}... ({len(doc_chunks)} chunks)")
        
        # Sort chunks by chunk_index to maintain order
        doc_chunks.sort(key=lambda x: x.get('chunk_index', 0))
        
        # Extract section headers
        updated_metadata_list = extract_section_headers_from_chunks(
            doc_chunks,
            args.business_id
        )
        
        # Count how many chunks will get section headers
        chunks_with_headers = sum(
            1 for item in updated_metadata_list
            if item['metadata'].get('has_section_header') or item['metadata'].get('section_header')
        )
        logger.info(f"  Extracted section headers for {chunks_with_headers} chunks")
        
        # Update metadata
        updated_count = update_chunks_metadata(
            supabase,
            updated_metadata_list,
            dry_run=args.dry_run
        )
        
        total_updated += updated_count
        logger.info(f"  ✅ Updated {updated_count} chunks for document {doc_id[:8]}...")
    
    logger.info(f"\n✅ Complete! Updated {total_updated} chunks total")
    if args.dry_run:
        logger.info("(DRY RUN - No actual changes were made)")


if __name__ == '__main__':
    main()


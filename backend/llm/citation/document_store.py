"""
Document Store - Layer 1: Low-level data access.

Pure data access layer. No intelligence, no LLM awareness, no ranking.
Responsibilities:
- Fetch chunks from database
- Fetch blocks for a chunk
- Fetch document metadata (filename, etc.)
- Raw data retrieval only

Rules:
- ✅ Pure database queries
- ✅ No embeddings
- ✅ No regex
- ✅ No LLM awareness
- ✅ Deterministic (same input → same output)
- ❌ No ranking
- ❌ No relevance scoring
- ❌ No evidence extraction
"""

import logging
from typing import Dict, Any, List, Optional
from backend.services.supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)


def fetch_chunk_blocks(chunk_id: str) -> Optional[Dict[str, Any]]:
    """
    Fetch Parse blocks from database for a given chunk.
    
    Args:
        chunk_id: UUID of the chunk
        
    Returns:
        Dict with 'blocks' array and metadata, or None if not found
    """
    try:
        supabase = get_supabase_client()
        response = supabase.table('document_vectors').select(
            'id, document_id, blocks, page_number, bbox, metadata'
        ).eq('id', chunk_id).single().execute()
        
        if not response.data:
            logger.warning(f"[DOCUMENT_STORE] Chunk {chunk_id[:20]}... not found in database")
            return None
        
        return response.data
    except Exception as e:
        logger.error(f"[DOCUMENT_STORE] Error fetching blocks for chunk {chunk_id[:20]}...: {e}", exc_info=True)
        return None


def fetch_chunks(document_ids: List[str]) -> List[Dict[str, Any]]:
    """
    Fetch chunks for given document IDs.
    
    Args:
        document_ids: List of document UUIDs
        
    Returns:
        List of chunk dicts with chunk_id, chunk_text, document_id, etc.
    """
    if not document_ids:
        return []
    
    try:
        supabase = get_supabase_client()
        response = supabase.table('document_vectors').select(
            'id, document_id, chunk_index, chunk_text, chunk_text_clean, page_number, metadata'
        ).in_('document_id', document_ids).execute()
        
        return response.data or []
    except Exception as e:
        logger.error(f"[DOCUMENT_STORE] Error fetching chunks for documents: {e}", exc_info=True)
        return []


def fetch_document_filename(doc_id: str) -> str:
    """
    Fetch original filename for a document.
    
    Args:
        doc_id: Document UUID
        
    Returns:
        Filename string or 'document.pdf' as fallback
    """
    try:
        supabase = get_supabase_client()
        response = supabase.table('documents').select('original_filename').eq('id', doc_id).single().execute()
        
        if response.data and response.data.get('original_filename'):
            return response.data['original_filename']
        
        return 'document.pdf'
    except Exception as e:
        logger.warning(f"[DOCUMENT_STORE] Error fetching filename for doc {doc_id[:8]}...: {e}")
        return 'document.pdf'


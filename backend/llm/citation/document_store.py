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


FETCH_CHUNKS_BY_IDS_MAX = 20


def fetch_chunks_by_ids(
    chunk_ids: List[str],
    business_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Fetch chunks by their IDs (document_vectors.id). Direct DB lookup, no semantic search.

    Args:
        chunk_ids: List of chunk UUIDs from prior retrieve_chunks result
        business_id: Optional business filter (for multi-tenancy)

    Returns:
        List of chunk dicts with chunk_id, document_id, document_filename, page_number, etc.
        Format matches retrieve_chunks output for responder compatibility.
    """
    if not chunk_ids or not isinstance(chunk_ids, list):
        return []
    valid_ids = []
    for cid in chunk_ids[:FETCH_CHUNKS_BY_IDS_MAX]:
        if cid is None:
            continue
        s = str(cid).strip()
        if s and len(s) >= 32:
            valid_ids.append(s)
    if not valid_ids:
        return []
    try:
        supabase = get_supabase_client()
        response = supabase.table('document_vectors').select(
            'id, document_id, chunk_index, chunk_text, chunk_text_clean, page_number, bbox, blocks, metadata'
        ).in_('id', valid_ids).execute()
        rows = response.data or []
        if not rows:
            logger.debug("[DOCUMENT_STORE] fetch_chunks_by_ids: no chunks found for %d ids", len(valid_ids))
            return []
        doc_ids = list({str(r.get('document_id', '')) for r in rows if r.get('document_id')})
        doc_metadata = {}
        if doc_ids:
            doc_response = supabase.table('documents').select(
                'id, original_filename, classification_type, business_uuid'
            ).in_('id', doc_ids).execute()
            for doc in (doc_response.data or []):
                did = str(doc.get('id', ''))
                if business_id and str(doc.get('business_uuid', '')) != str(business_id):
                    continue
                doc_metadata[did] = {
                    'filename': doc.get('original_filename', 'document'),
                    'classification_type': doc.get('classification_type', 'unknown'),
                }
            if business_id and not doc_metadata:
                logger.debug("[DOCUMENT_STORE] fetch_chunks_by_ids: no docs in business %s", business_id[:8])
                return []
        out = []
        for r in rows:
            doc_id = str(r.get('document_id', ''))
            if business_id and doc_id not in doc_metadata:
                continue
            meta = doc_metadata.get(doc_id, {}) if doc_metadata else {'filename': 'document', 'classification_type': 'unknown'}
            chunk_id = str(r.get('id', ''))
            if not chunk_id:
                continue
            chunk_text = r.get('chunk_text', '') or r.get('chunk_text_clean', '')
            out.append({
                'chunk_id': chunk_id,
                'document_id': doc_id,
                'document_filename': meta.get('filename', 'document'),
                'document_type': meta.get('classification_type', 'unknown'),
                'chunk_index': r.get('chunk_index', 0),
                'chunk_text': r.get('chunk_text', ''),
                'chunk_text_clean': r.get('chunk_text_clean', ''),
                'page_number': int(r.get('page_number', 0)) if r.get('page_number') is not None else 0,
                'bbox': r.get('bbox'),
                'blocks': r.get('blocks', []),
                'score': 1.0,
                'metadata': r.get('metadata') if isinstance(r.get('metadata'), dict) else {},
            })
        logger.info("[DOCUMENT_STORE] fetch_chunks_by_ids: returned %d chunks for %d ids", len(out), len(valid_ids))
        return out
    except Exception as e:
        logger.error("[DOCUMENT_STORE] fetch_chunks_by_ids failed: %s", e, exc_info=True)
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


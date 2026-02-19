"""
In-memory cache of full-document chunks for same-doc follow-ups.

After a response is generated, we prime the cache in the background (fire-and-forget)
so the next same-doc follow-up can search over cached chunks in-memory instead of
hitting the DB. Response path never waits on cache.
"""

import asyncio
import logging
import time
from threading import Lock
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# TTL per cache entry (seconds)
CACHE_TTL = 600  # 10 minutes
# Max entries to prevent unbounded growth (evict oldest by expiry)
CACHE_MAX_ENTRIES = 1000

# Global cache: key = (thread_id, doc_id), value = (list_of_chunks, expiry_ts)
_cache: Dict[tuple, tuple] = {}
_cache_lock = Lock()


def _cache_cleanup() -> None:
    """Remove expired entries; if still over limit, remove oldest by expiry."""
    now = time.time()
    with _cache_lock:
        expired = [k for k, (_, exp) in _cache.items() if exp <= now]
        for k in expired:
            del _cache[k]
        while len(_cache) > CACHE_MAX_ENTRIES:
            oldest = min(_cache.items(), key=lambda x: x[1][1])
            del _cache[oldest[0]]


def get_cache() -> Dict[tuple, tuple]:
    """Return the global cache (for tests). Normal code uses get_cached_chunks / prime_doc_chunks."""
    return _cache


def _format_chunk(row: dict, doc_id: str, doc_filename: str, doc_type: str) -> dict:
    """Format a DB row into the chunk shape expected by responder/citations."""
    chunk_id = str(row.get("id", "")) or f"{doc_id}_{row.get('chunk_index', 0)}"
    chunk_metadata = row.get("metadata") or {}
    if isinstance(chunk_metadata, str):
        try:
            import json
            chunk_metadata = json.loads(chunk_metadata)
        except Exception:
            chunk_metadata = {}
    return {
        "chunk_id": chunk_id,
        "document_id": doc_id,
        "document_filename": doc_filename,
        "document_type": doc_type,
        "chunk_index": row.get("chunk_index", 0),
        "chunk_text": row.get("chunk_text") or row.get("chunk_text_clean", ""),
        "chunk_text_clean": row.get("chunk_text_clean") or row.get("chunk_text", ""),
        "page_number": row.get("page_number", 0),
        "bbox": row.get("bbox"),
        "blocks": row.get("blocks") or [],
        "section_title": chunk_metadata.get("section_title") if isinstance(chunk_metadata, dict) else None,
        "score": 1.0,
        "metadata": chunk_metadata if isinstance(chunk_metadata, dict) else {},
    }


async def prime_doc_chunks(thread_id: str, document_ids: List[str]) -> None:
    """
    Load all chunks for each document_id from the DB and store in cache.
    Call from a background task; do not await in the response path.
    """
    if not thread_id or not document_ids:
        return
    try:
        from backend.services.supabase_client_factory import get_supabase_client
        supabase = get_supabase_client()
    except Exception as e:
        logger.warning("[DOC_CHUNK_CACHE] Could not get Supabase client: %s", e)
        return
    expiry = time.time() + CACHE_TTL
    for doc_id in document_ids:
        if not doc_id or not str(doc_id).strip():
            continue
        doc_id = str(doc_id).strip()
        try:
            rows = supabase.table("document_vectors").select(
                "id, document_id, chunk_index, chunk_text, chunk_text_clean, page_number, metadata, bbox, blocks"
            ).eq("document_id", doc_id).order("page_number").order("chunk_index").execute()
            raw_chunks = rows.data or []
            # Document metadata for filename/type
            doc_response = supabase.table("documents").select(
                "id, original_filename, classification_type"
            ).eq("id", doc_id).limit(1).execute()
            doc_filename = "unknown"
            doc_type = "unknown"
            if doc_response.data and len(doc_response.data) > 0:
                d = doc_response.data[0]
                doc_filename = d.get("original_filename", "unknown")
                doc_type = d.get("classification_type", "unknown")
            chunks = [_format_chunk(r, doc_id, doc_filename, doc_type) for r in raw_chunks]
            with _cache_lock:
                _cache[(thread_id, doc_id)] = (chunks, expiry)
            logger.debug("[DOC_CHUNK_CACHE] Primed thread_id=%s doc_id=%s chunks=%d", thread_id[:8], doc_id[:8], len(chunks))
        except Exception as e:
            logger.warning("[DOC_CHUNK_CACHE] Failed to prime doc_id=%s: %s", doc_id[:8] if doc_id else "", e)
    _cache_cleanup()


def get_cached_chunks(thread_id: str, document_ids: List[str]) -> Optional[Dict[str, List[dict]]]:
    """
    Return {doc_id: [chunks]} if all requested document_ids are in the cache and not expired; else None.
    """
    if not thread_id or not document_ids:
        return None
    _cache_cleanup()
    now = time.time()
    result = {}
    with _cache_lock:
        for doc_id in document_ids:
            doc_id = str(doc_id).strip()
            key = (thread_id, doc_id)
            if key not in _cache:
                return None
            chunks, exp = _cache[key]
            if exp <= now:
                del _cache[key]
                return None
            result[doc_id] = list(chunks)
    return result


def schedule_prime(thread_id: str, document_ids: List[str]) -> None:
    """Fire-and-forget: schedule priming the cache. Do not await in the response path."""
    if not document_ids:
        return
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(prime_doc_chunks(thread_id, list(document_ids)))
    except RuntimeError:
        logger.debug("[DOC_CHUNK_CACHE] No running loop; cannot schedule prime")
    except Exception as e:
        logger.debug("[DOC_CHUNK_CACHE] Could not schedule prime: %s", e)


def _keyword_score(query: str, chunk: dict) -> float:
    """Score a chunk by keyword overlap with query (chunk_text / chunk_text_clean)."""
    q = (query or "").lower().strip()
    if not q:
        return 0.0
    words = [w for w in q.split() if len(w) > 2]
    text = ((chunk.get("chunk_text") or "") + " " + (chunk.get("chunk_text_clean") or "")).lower()
    if not text:
        return 0.0
    if q in text:
        return 1.0
    score = 0.0
    for w in words:
        if w in text:
            score += 0.2
    return min(1.0, score)


def run_in_memory_retrieval(
    query: str,
    cached_chunks_by_doc: Dict[str, List[dict]],
    top_k: int = 12,
) -> List[dict]:
    """
    Score cached chunks by keyword overlap with query, return top_k chunks in the same
    format as retrieve_chunks (so they can be used as execution_results result).
    """
    all_chunks = []
    for doc_id, chunks in cached_chunks_by_doc.items():
        for c in chunks:
            c = dict(c)
            c["score"] = _keyword_score(query, c)
            all_chunks.append(c)
    all_chunks.sort(key=lambda x: -float(x.get("score", 0)))
    return all_chunks[:top_k]


def build_execution_results_from_chunks(top_chunks: List[dict], step_id: str = "cached_chunks") -> List[Dict[str, Any]]:
    """Build execution_results in the shape the executor produces (for responder)."""
    return [
        {
            "step_id": step_id,
            "action": "retrieve_chunks",
            "result": top_chunks,
            "success": True,
        }
    ]

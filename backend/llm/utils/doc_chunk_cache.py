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


def get_concrete_retrieval_phrases(query: str) -> List[str]:
    """
    Return concrete document phrases to search for when the query is value-seeking.
    These are terms that appear in docs (e.g. "Zone 2", "flood zone") so we don't
    rely only on query wording ("flood risk") and surface actual values.
    """
    if not query or not isinstance(query, str):
        return []
    q = query.lower().strip()
    out: List[str] = []
    if any(phrase in q for phrase in ("flood", "risk", "flood risk")):
        out.extend(["zone 2", "zone 3", "flood zone", "flood risk", "probability", "medium probability", "high probability"])
    if any(phrase in q for phrase in ("epc", "energy", "rating", "certificate")):
        out.extend(["epc", "energy performance", "band", "rating", "certificate"])
    if any(phrase in q for phrase in ("size", "area", "dimensions", "square", "sq ft", "sqft", "gia", "gross internal")):
        out.extend(["gia", "gross internal", "sq ft", "square metres", "square feet"])
    return list(dict.fromkeys(out))  # dedupe, preserve order


def _get_keybert_phrases_for_retrieval(query: str) -> List[str]:
    """
    Use KeyBERT to extract semantic keyphrases from the query, then merge in
    concrete document phrases (e.g. "zone 2", "flood zone") so retrieval
    searches for actual values, not just query wording.
    """
    if not query or not query.strip():
        return []
    phrases: List[str] = []
    try:
        from backend.llm.utils import entity_extraction
        if getattr(entity_extraction, "_use_keybert", True):
            keybert = entity_extraction._get_keybert_phrases(query)
            if keybert:
                phrases.extend(keybert[:8])
    except Exception as e:
        logger.debug("[DOC_CHUNK_CACHE] KeyBERT expansion skipped: %s", e)
    # Always add concrete phrases for value-seeking so we search for Zone 2, EPC band, etc.
    concrete = get_concrete_retrieval_phrases(query)
    for p in concrete:
        if p not in phrases:
            phrases.append(p)
    return phrases[:12]  # cap total so we don't blow up the query


def _expand_query_for_retrieval(query: str) -> str:
    """
    Add retrieval-relevant terms: KeyBERT keyphrases (semantic) plus hand-coded fallbacks for
    common property concepts so in-doc phrasing (e.g. "Zone 2", "EPC 56 D", "GIA 4,480 sq ft")
    matches user queries ("flood risk", "EPC rating", "size of the property") without requiring
    exact keyword overlap.
    """
    q = (query or "").lower().strip()
    if not q:
        return q
    parts = [q]

    # KeyBERT: semantic keyphrases from the query (e.g. "property size", "market value")
    keybert_phrases = _get_keybert_phrases_for_retrieval(query)
    if keybert_phrases:
        parts.append(" ".join(keybert_phrases))
        logger.debug("[DOC_CHUNK_CACHE] KeyBERT expansion added: %s", keybert_phrases[:5])

    # Hand-coded fallbacks when KeyBERT doesn't add relevant terms (or is unavailable)
    additions = []
    if any(phrase in q for phrase in ("flood", "risk", "flood risk")):
        additions.extend(["flood", "zone", "zone 2", "zone 3", "probability", "medium", "high"])
    if any(phrase in q for phrase in ("epc", "energy", "rating", "certificate")):
        additions.extend(["epc", "energy", "performance", "certificate", "rating"])
    if any(phrase in q for phrase in ("size", "area", "dimensions", "square", "sq ft", "sqft", "gia", "gross internal")):
        additions.extend(["size", "area", "dimensions", "gia", "gross", "internal", "sq", "ft", "square", "metres", "meters"])
    if additions:
        parts.append(" ".join(additions))

    return " ".join(parts)


def _keyword_score(query: str, chunk: dict) -> float:
    """Score a chunk by keyword overlap with query (chunk_text / chunk_text_clean).
    Avoids giving 1.0 for exact phrase match so semantic relevance and value signals
    (e.g. Zone 2, EPC band) can outrank generic disclaimers that repeat the query words."""
    expanded = _expand_query_for_retrieval(query)
    q = (expanded or "").lower().strip()
    if not q:
        return 0.0
    words = [w for w in q.split() if len(w) > 2]
    text = ((chunk.get("chunk_text") or "") + " " + (chunk.get("chunk_text_clean") or "")).lower()
    if not text:
        return 0.0
    # Cap exact-phrase match so value-rich chunks (Zone 2, EPC band) can win via semantic score
    if q in text:
        return 0.55
    score = 0.0
    matches = 0
    for w in words:
        if w in text:
            score += 0.2
            matches += 1
    # Bonus for chunks matching multiple query terms (e.g. "EPC rating" prefers chunks with both)
    if matches >= 2:
        score += 0.2
    return min(1.0, score)


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    """Cosine similarity between two vectors. Returns 0 if invalid."""
    if not a or not b or len(a) != len(b):
        return 0.0
    try:
        import math
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(x * x for x in b))
        if norm_a <= 0 or norm_b <= 0:
            return 0.0
        return float(dot / (norm_a * norm_b))
    except Exception:
        return 0.0


def run_in_memory_retrieval(
    query: str,
    cached_chunks_by_doc: Dict[str, List[dict]],
    top_k: int = 12,
) -> List[dict]:
    """
    Score cached chunks by keyword overlap and optional semantic similarity. Returns top_k chunks
    in the format expected by retrieve_chunks. Uses hybrid scoring when embeddings are available
    so conceptually related content (e.g. "flood risk" matching "Zone 2 probability") surfaces without
    hardcoding domain terms.
    """
    all_chunks = []
    for doc_id, chunks in cached_chunks_by_doc.items():
        for c in chunks:
            c = dict(c)
            c["score"] = _keyword_score(query, c)
            all_chunks.append(c)
    all_chunks.sort(key=lambda x: -float(x.get("score", 0)))

    # Run semantic scoring on a larger pool so chunks with weak keyword match (e.g. "Zone 2"
    # for "flood risk") can still surface. Supabase in_() handles up to ~100 IDs.
    semantic_pool = min(len(all_chunks), max(top_k * 5, 60))
    candidate_chunks = all_chunks[:semantic_pool]
    chunk_ids = [c.get("chunk_id") for c in candidate_chunks if c.get("chunk_id")]

    if chunk_ids:
        try:
            from backend.llm.hyde import get_query_embedding_for_retrieval
            query_embedding = get_query_embedding_for_retrieval(query)
            if query_embedding:
                from backend.services.supabase_client_factory import get_supabase_client
                supabase = get_supabase_client()
                emb_response = supabase.table("document_vectors").select("id, embedding").in_("id", chunk_ids).execute()
                chunk_embeddings = {}
                for row in emb_response.data or []:
                    emb = row.get("embedding")
                    if emb is not None:
                        if isinstance(emb, str):
                            import ast
                            try:
                                emb = ast.literal_eval(emb)
                            except Exception:
                                try:
                                    import json
                                    emb = json.loads(emb)
                                except Exception:
                                    continue
                        chunk_embeddings[str(row["id"])] = emb

                if chunk_embeddings:
                    from backend.llm.utils.retrieval_rerank import is_value_seeking_query
                    value_seeking = is_value_seeking_query(query)
                    # For value-seeking queries (flood risk, EPC, etc.) weight semantic more
                    # so chunks with actual values (Zone 2, band D) outrank exact-phrase disclaimers
                    kw_w = 0.35 if value_seeking else 0.5
                    sem_w = 0.65 if value_seeking else 0.5
                    for c in all_chunks:
                        cid = c.get("chunk_id")
                        emb = chunk_embeddings.get(str(cid)) if cid else None
                        if emb:
                            sem = _cosine_similarity(query_embedding, emb)
                            kw = float(c.get("score", 0))
                            c["score"] = kw_w * kw + sem_w * max(0, sem)
                    all_chunks.sort(key=lambda x: -float(x.get("score", 0)))
        except Exception as e:
            logger.debug("[DOC_CHUNK_CACHE] Semantic scoring skipped: %s", e)

    # Value-seeking rerank: prefer chunks with actual values (EPC band, Zone 2) over disclaimers
    try:
        from backend.llm.utils.retrieval_rerank import apply_value_seeking_rerank
        apply_value_seeking_rerank(query, all_chunks)
        all_chunks.sort(key=lambda x: -float(x.get("score", 0)))
    except Exception as e:
        logger.debug("[DOC_CHUNK_CACHE] Value-seeking rerank skipped: %s", e)

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

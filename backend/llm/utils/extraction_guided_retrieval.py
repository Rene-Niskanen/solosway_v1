"""
Extraction-guided retrieval: use the document's own wording as the vector search query.

Flow: user query + document_ids → fetch document text → LLM extracts the exact passage
that answers the query (using doc wording) → embed that passage → use as query embedding
for chunk search. So we search for "chunks similar to what the doc actually says about this",
not similar to the user's question or a hypothetical answer. Improves precision for
value-seeking questions (flood zone, EPC, valuation, etc.).

Controlled by USE_EXTRACTION_GUIDED_RETRIEVAL (default true for value-seeking queries when
we have document text). Falls back to normal query/HyDE embedding on failure or when disabled.
"""

import logging
from typing import List, Optional

logger = logging.getLogger(__name__)

# Max document text to send to LLM for extraction (chars)
_MAX_DOC_TEXT_FOR_EXTRACT = 120000
# Target length for extracted passage (chars) so embedding is stable
_EXTRACT_MAX_CHARS = 800


def _get_document_text(supabase, document_ids: List[str], business_id: Optional[str] = None) -> str:
    """Fetch and concatenate document text from parsed_text, document_summary, or document_vectors."""
    if not document_ids:
        return ""
    try:
        sel = supabase.table("documents").select("id, parsed_text, document_summary").in_("id", document_ids)
        if business_id:
            sel = sel.eq("business_uuid", business_id)
        result = sel.execute()
        rows = result.data or []
    except Exception as e:
        logger.debug("Extraction-guided: failed to fetch documents: %s", e)
        return ""

    parts = []
    for row in rows:
        text = (row.get("parsed_text") or "").strip()
        doc_summary = row.get("document_summary")
        if isinstance(doc_summary, str) and doc_summary.strip():
            try:
                import json
                doc_summary = json.loads(doc_summary)
            except Exception:
                doc_summary = None
        if not text and isinstance(doc_summary, dict):
            text = (doc_summary.get("reducto_parsed_text") or "").strip()
        if not text and isinstance(doc_summary, dict):
            chunk_texts = []
            for ch in (doc_summary.get("reducto_chunks") or []):
                if isinstance(ch, dict):
                    part = ch.get("content") or ch.get("embed") or ch.get("text") or ""
                    if part and isinstance(part, str):
                        chunk_texts.append(part)
            if chunk_texts:
                text = "\n".join(chunk_texts)
        if text:
            parts.append(text)

    if not parts:
        # Fallback: concatenate chunk_text from document_vectors
        try:
            r = supabase.table("document_vectors").select("chunk_text, chunk_index").in_(
                "document_id", document_ids
            ).order("chunk_index").execute()
            if r.data:
                parts = [row.get("chunk_text") or "" for row in r.data if row.get("chunk_text")]
        except Exception as e:
            logger.debug("Extraction-guided: document_vectors fallback failed: %s", e)
    return "\n\n".join(parts).strip() if parts else ""


def get_document_text_for_responder(
    document_ids: List[str],
    business_id: Optional[str] = None,
    max_chars: int = 12000,
    max_docs: int = 2,
) -> str:
    """
    Fetch full document text for the given document_ids (for responder synthetic paste context).
    Limits to first max_docs and total length max_chars to control token usage.
    Used when we have document_ids from retrieval but no attachment_context, so the responder
    can see full doc text like the attachment path.
    """
    if not document_ids:
        return ""
    ids = document_ids[:max_docs]
    try:
        from backend.services.supabase_client_factory import get_supabase_client
        supabase = get_supabase_client()
        text = _get_document_text(supabase, ids, business_id)
        if not text:
            return ""
        if len(text) > max_chars:
            text = text[:max_chars] + "\n\n[Document text truncated for length.]"
        return text
    except Exception as e:
        logger.debug("get_document_text_for_responder failed: %s", e)
        return ""


def _extract_passage_for_query(doc_text: str, query: str) -> Optional[str]:
    """Use LLM to extract 1–4 sentences from doc_text that directly answer the query. Exact doc wording."""
    if not doc_text or not query or len(doc_text.strip()) < 50:
        return None
    text = doc_text.strip()
    if len(text) > _MAX_DOC_TEXT_FOR_EXTRACT:
        text = text[:_MAX_DOC_TEXT_FOR_EXTRACT] + "\n\n[Document truncated.]"
    try:
        from backend.llm.config import config
        if not getattr(config, "openai_api_key", None):
            return None
        from openai import OpenAI
        client = OpenAI(api_key=config.openai_api_key)
        model = getattr(config, "openai_model", "gpt-4o-mini")
        prompt = f"""From the following document text, extract only the 1–4 sentences that directly answer this question. Use the exact wording from the document; do not paraphrase. If the document does not contain an answer, output exactly: NONE.

Question: {query.strip()}

Document text:
{text}

Output only the extracted passage (or NONE). No explanation."""

        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=_EXTRACT_MAX_CHARS,
        )
        passage = (response.choices[0].message.content or "").strip()
        if not passage or passage.upper() == "NONE":
            return None
        return passage[:_EXTRACT_MAX_CHARS]
    except Exception as e:
        logger.debug("Extraction-guided: LLM extract failed: %s", e)
        return None


def _embed_passage(passage: str) -> Optional[List[float]]:
    """Embed the passage using the same model as retrieval (Gemini, Voyage, or OpenAI)."""
    if not passage or not passage.strip():
        return None
    try:
        from backend.llm.config import config
        use_gemini = getattr(config, "use_gemini_embeddings", False) and getattr(config, "gemini_api_key", None)
        if use_gemini:
            from backend.services.gemini_embedding_helper import embed_with_gemini
            embs = embed_with_gemini(
                [passage.strip()],
                task_type="RETRIEVAL_DOCUMENT",
                api_key=config.gemini_api_key,
                model=getattr(config, "gemini_embedding_model", "models/gemini-embedding-2-preview"),
                dimension=getattr(config, "gemini_embedding_dimension", 768),
            )
            if embs and len(embs) > 0:
                return embs[0]
        use_voyage = getattr(config, "use_voyage_embeddings", True) and getattr(config, "voyage_api_key", None)
        if use_voyage:
            from voyageai import Client
            client = Client(api_key=config.voyage_api_key)
            model = getattr(config, "voyage_embedding_model", "voyage-law-2")
            response = client.embed(texts=[passage.strip()], model=model, input_type="document")
            if response.embeddings and len(response.embeddings) > 0:
                return response.embeddings[0]
        else:
            from openai import OpenAI
            client = OpenAI(api_key=config.openai_api_key)
            response = client.embeddings.create(
                model=getattr(config, "openai_embedding_model", "text-embedding-3-small"),
                input=[passage.strip()],
            )
            if response.data and len(response.data) > 0:
                return response.data[0].embedding
    except Exception as e:
        logger.debug("Extraction-guided: embed failed: %s", e)
    return None


def get_extraction_guided_embedding(
    document_ids: List[str],
    query: str,
    business_id: Optional[str] = None,
) -> Optional[List[float]]:
    """
    Get embedding of the document passage that answers the query. Use this as the
    vector search query for chunk retrieval so we match chunks that contain the
    actual answer wording.

    Returns None on failure or when extraction is disabled; caller should fall back
    to normal query/HyDE embedding.
    """
    try:
        from backend.llm.config import config
        if not getattr(config, "use_extraction_guided_retrieval", True):
            return None
    except Exception:
        pass

    if not document_ids or not query or not query.strip():
        return None

    try:
        from backend.services.supabase_client_factory import get_supabase_client
        supabase = get_supabase_client()
    except Exception as e:
        logger.debug("Extraction-guided: no supabase: %s", e)
        return None

    doc_text = _get_document_text(supabase, document_ids, business_id)
    if not doc_text:
        logger.debug("Extraction-guided: no document text for %d doc(s)", len(document_ids))
        return None

    passage = _extract_passage_for_query(doc_text, query)
    if not passage:
        logger.debug("Extraction-guided: no passage extracted for query")
        return None

    logger.info("Extraction-guided: using %d-char passage for vector search", len(passage))
    return _embed_passage(passage)

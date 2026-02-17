"""
HyDE (Hypothetical Document Embeddings) for retrieval.

Generates short hypothetical answer paragraphs, embeds them as documents, and uses
the (averaged) embedding for vector search so we match "documents that look like
this answer" rather than the raw query. Keyword search always uses the original query.

- Entity-preserving prompt (keeps street names, addresses, company/person names).
- Optional cache so one HyDE per query is reused for both document and chunk retrieval.
- Skip HyDE for very short queries (keyword-like) via hyde_skip_max_words.
"""

from typing import List, Optional
import logging
import time

from backend.llm.config import config

logger = logging.getLogger(__name__)

# In-memory cache: key -> (embedding, timestamp). TTL cleared on access.
_embedding_cache: dict = {}
_CACHE_TTL = 60  # seconds; overridden from config in get_query_embedding_for_retrieval


def _cache_key(query: str) -> str:
    return (query or "").strip()[:500]


def _clean_expired_cache():
    now = time.time()
    expired = [k for k, (_, ts) in _embedding_cache.items() if now - ts > _CACHE_TTL]
    for k in expired:
        del _embedding_cache[k]


def generate_hypothetical_documents(query: str, num: int = 2) -> List[str]:
    """
    Generate num short paragraphs that could appear in a document answering the question.
    Uses OpenAI with low temperature. Preserves entities (names, addresses) from the query.
    Returns empty list on failure.
    """
    if not query or not query.strip():
        return []
    model = config.hyde_model or config.openai_model
    api_key = config.openai_api_key
    if not api_key:
        logger.warning("OPENAI_API_KEY not set, cannot generate HyDE documents")
        return []
    prompt = f"""Write exactly {num} short paragraphs that could appear in a factual document that answers this exact question. Use only information implied by the question.

Use factual, formal language and terminology typical of property, legal, or business documents (e.g. commission, disclosure, agreement, particulars, valuation).

Preserve all specific names, addresses, street names, company or person names, property names, and document names from the user's question. Do not generalise or remove them.

Do not add facts or details not implied by the question. Each paragraph must be 2-4 sentences only.

User question:
{query.strip()}

Output exactly {num} paragraphs, separated by a blank line. No numbering or labels."""

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=400,
        )
        text = (response.choices[0].message.content or "").strip()
        if not text:
            logger.debug("HyDE returned empty content, will use raw query")
            return []
        # Split into paragraphs (blank line or newline)
        paragraphs = [p.strip() for p in text.replace("\r\n", "\n").split("\n\n") if p.strip()]
        # If we got one block, try splitting by single newline for 2 parts
        if len(paragraphs) == 1 and num > 1:
            parts = [s.strip() for s in paragraphs[0].split("\n") if s.strip()]
            if len(parts) >= 2:
                paragraphs = parts[:num]
        paragraphs = paragraphs[:num]
        if paragraphs:
            logger.debug("HyDE generated %d hypothetical doc(s)", len(paragraphs))
        else:
            logger.debug("HyDE produced no valid paragraphs, will use raw query")
        return paragraphs
    except Exception as e:
        logger.warning("HyDE generation failed: %s, will use raw query", e)
        return []


def get_query_embedding_for_retrieval(query: str) -> Optional[List[float]]:
    """
    Return the embedding to use for vector retrieval. When HyDE is enabled and query is
    long enough, generates hypothetical documents, embeds them as documents, and returns
    the averaged vector. Otherwise embeds the raw query. Uses cache so the same query
    reuses one HyDE for both document and chunk retrieval.
    Returns None on embedding failure.
    """
    global _CACHE_TTL
    _CACHE_TTL = getattr(config, "hyde_cache_ttl_seconds", 60)

    if not query or not query.strip():
        return None

    word_count = len(query.strip().split())
    # Skip HyDE for short or entity-heavy queries (e.g. "what is the value of highlands?")
    # so we rely on raw query + keyword; HyDE helps when user phrasing doesn't match doc wording.
    skip_hyde = word_count <= getattr(config, "hyde_skip_max_words", 8)
    use_hyde = getattr(config, "use_hyde", False) and not skip_hyde

    if skip_hyde:
        logger.debug("HyDE skipped for short query (%d words)", word_count)

    # Check cache (for any path: raw or HyDE)
    key = _cache_key(query)
    _clean_expired_cache()
    if key in _embedding_cache:
        emb, _ = _embedding_cache[key]
        return emb

    texts_to_embed: List[str] = []
    input_type = "query"

    if use_hyde:
        num = getattr(config, "hyde_num_docs", 2)
        hyde_paragraphs = generate_hypothetical_documents(query, num=num)
        if hyde_paragraphs:
            texts_to_embed = hyde_paragraphs
            input_type = "document"
        # else fall through to raw query

    if not texts_to_embed:
        texts_to_embed = [query.strip()]
        input_type = "query"

    use_voyage = getattr(config, "use_voyage_embeddings", True)
    if use_voyage and getattr(config, "voyage_api_key", None):
        try:
            from voyageai import Client
            voyage_client = Client(api_key=config.voyage_api_key)
            voyage_model = getattr(config, "voyage_embedding_model", "voyage-law-2")
            response = voyage_client.embed(
                texts=texts_to_embed,
                model=voyage_model,
                input_type=input_type,
            )
            embeddings = response.embeddings or []
        except Exception as e:
            logger.error("Voyage embedding failed in HyDE path: %s", e)
            return None
    else:
        try:
            from openai import OpenAI
            openai_client = OpenAI(api_key=config.openai_api_key)
            response = openai_client.embeddings.create(
                model=getattr(config, "openai_embedding_model", "text-embedding-3-small"),
                input=texts_to_embed,
            )
            embeddings = [d.embedding for d in response.data] if response.data else []
        except Exception as e:
            logger.error("OpenAI embedding failed in HyDE path: %s", e)
            return None

    if not embeddings:
        return None

    if len(embeddings) == 1:
        query_embedding = embeddings[0]
    else:
        dim = len(embeddings[0])
        query_embedding = [
            sum(emb[i] for emb in embeddings) / len(embeddings)
            for i in range(dim)
        ]

    _embedding_cache[key] = (query_embedding, time.time())
    return query_embedding

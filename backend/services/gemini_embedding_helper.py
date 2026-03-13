"""
Helper for Gemini embeddings used by query embedding (hyde.py), extraction-guided retrieval, and vector service.
Provides task-specific embedding (RETRIEVAL_QUERY for queries, RETRIEVAL_DOCUMENT for passages/chunks).
Note: HyDE is disabled; hyde.py still handles raw query embedding.
"""
import logging
from typing import List, Optional

logger = logging.getLogger(__name__)


def _l2_normalize(vec: List[float]) -> List[float]:
    """L2-normalize for cosine similarity (required for 768/1536 dims)."""
    import numpy as np
    arr = np.array(vec, dtype=np.float32)
    norm = np.linalg.norm(arr)
    if norm < 1e-10:
        return vec
    return (arr / norm).tolist()


def embed_with_gemini(
    texts: List[str],
    task_type: str = "RETRIEVAL_QUERY",
    api_key: Optional[str] = None,
    model: str = "models/gemini-embedding-2-preview",
    dimension: int = 768,
) -> Optional[List[List[float]]]:
    """
    Embed texts using Gemini API. Returns None on failure.
    task_type: RETRIEVAL_QUERY (for queries) or RETRIEVAL_DOCUMENT (for passages/chunks).
    """
    if not texts or not all(t and t.strip() for t in texts):
        return None
    if not api_key:
        return None
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=api_key)
        result = client.models.embed_content(
            model=model,
            contents=texts,
            config=types.EmbedContentConfig(
                task_type=task_type,
                output_dimensionality=dimension,
            ),
        )
        embeddings = []
        for emb_obj in (result.embeddings or []):
            vals = getattr(emb_obj, "values", emb_obj)
            if isinstance(vals, list):
                lst = vals
            else:
                lst = list(vals) if vals and hasattr(vals, "__iter__") and not isinstance(vals, str) else []
            if lst:
                embeddings.append(_l2_normalize(lst))
        if len(embeddings) != len(texts):
            logger.warning("Gemini returned %d embeddings for %d texts", len(embeddings), len(texts))
        return embeddings if embeddings else None
    except Exception as e:
        logger.debug("Gemini embedding failed: %s", e)
        return None

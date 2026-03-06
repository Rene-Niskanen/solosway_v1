"""
Exa Web Search Tool – searches the web via Exa API and returns
titles, URLs, highlights, and summaries for LLM context.
"""

import logging
import os
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_exa_client = None


def _get_exa_client():
    """Lazy-init a single Exa client (reused across calls)."""
    global _exa_client
    if _exa_client is None:
        try:
            from exa_py import Exa
        except ImportError:
            raise ImportError("exa-py is not installed. Run: pip install exa-py")

        api_key = os.getenv("EXA_API_KEY")
        if not api_key:
            logger.error("[EXA] EXA_API_KEY environment variable is not set - Web search will return no results. Set EXA_API_KEY in .env to enable Exa.")
            raise ValueError("EXA_API_KEY environment variable is not set")
        _exa_client = Exa(api_key=api_key)
    return _exa_client


def _get_attr(r: Any, *keys: str, default: Any = None) -> Any:
    """Get attribute from result object, trying snake_case and camelCase keys."""
    for key in keys:
        val = getattr(r, key, None)
        if val is not None:
            return val
    return default


def exa_web_search(
    query: str,
    num_results: int = 5,
    category: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Search the web via Exa and return structured results.

    Uses exa.search() with contents (text + summary). Does not use highlights
    (removed in newer Exa SDKs). Returns a list of dicts with keys:
        title, url, published_date, author, highlights (list[str]), summary (str)
    """
    try:
        exa = _get_exa_client()

        contents: Dict[str, Any] = {
            "text": True,
            "summary": {"query": query},
        }

        result = exa.search(
            query,
            num_results=num_results,
            type="auto",
            contents=contents,
            category=category if category else None,
        )

        raw_results = getattr(result, "results", None) or []
        results: List[Dict[str, Any]] = []
        for r in raw_results:
            title = _get_attr(r, "title", default="") or ""
            url = _get_attr(r, "url", default="") or ""
            published_date = _get_attr(r, "published_date", "publishedDate", default=None)
            author = _get_attr(r, "author", default=None)
            highlights = _get_attr(r, "highlights", default=None) or []
            if not isinstance(highlights, list):
                highlights = []
            summary = _get_attr(r, "summary", default=None) or ""
            text = _get_attr(r, "text", default=None) or ""
            if not summary and text:
                summary = (text[:1500] + "...") if len(text) > 1500 else text
            results.append({
                "title": title,
                "url": url,
                "published_date": published_date,
                "author": author,
                "highlights": highlights,
                "summary": summary,
            })

        logger.info("[EXA] Search for '%s' returned %d results", query[:60], len(results))
        return results

    except Exception as e:
        logger.error(
            "[EXA] Web search failed: %s (query=%r)",
            e,
            query[:100] if query else "",
            exc_info=True,
        )
        return []

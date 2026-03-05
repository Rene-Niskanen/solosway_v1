"""
Value-seeking retrieval reranking.

When the user asks for a specific fact (EPC rating, flood risk, market value),
prefer chunks that contain the actual value over chunks that only mention the
topic in a disclaimer (e.g. "we have not been provided with an EPC").
"""

import re
from typing import Dict, List, Any

# Queries that ask for a concrete value/fact - apply value-preference reranking
_VALUE_SEEKING_PHRASES = (
    "epc", "epc rating", "energy performance", "flood risk", "flood zone",
    "market value", "valuation", "price", "rent", "deposit", "term",
    "tenure", "condition", "rating", "score", "band",
    "size", "area", "dimensions", "square feet", "sq ft", "sqft", "gia", "gross internal",
)

# Chunk text suggesting a factual value (boost these when value-seeking)
_VALUE_SIGNAL_PATTERNS = [
    re.compile(r"epc\s*(?:rating)?\s*[:\s]*(?:band\s*)?[a-g]\b", re.I),
    re.compile(r"(?:rating|band)\s*[a-g]\b", re.I),
    re.compile(r"\b\d{2,3}\s*[a-g]\b", re.I),  # e.g. "56 D", "71 C"
    re.compile(r"zone\s*[23]\b", re.I),
    re.compile(r"(?:high|medium|low)\s+probability", re.I),
    re.compile(r"£[\d,]+(?:\.\d{2})?", re.I),
    re.compile(r"[\d,]+\s*(?:years?|months?)\b", re.I),
    re.compile(r"(?:gia|gross\s+internal\s+area)[\s:]+[\d,]+", re.I),
    re.compile(r"[\d,]+\s*(?:sq\.?\s*ft|sqft|ft²)\b", re.I),
    re.compile(r"[\d,]+\s*(?:sq\.?\s*m|m²|square\s+metres?)\b", re.I),
    re.compile(r"(?:area|size)[\s:]+[\d,]+", re.I),
]

# Chunk text suggesting a disclaimer about missing data (penalize when value-seeking)
_DISCLAIMER_PATTERNS = [
    re.compile(r"not\s+(?:been\s+)?(?:provided|received|supplied)\s+with", re.I),
    re.compile(r"have\s+not\s+(?:been\s+)?(?:provided|received)", re.I),
    re.compile(r"(?:our|the)\s+valuation\s+assumes", re.I),
    re.compile(r"assumes?\s+(?:that|any)\s+(?:transaction|the)", re.I),
    re.compile(r"no\s+(?:copy|record)\s+of\s+an?\s+(?:epc|energy)", re.I),
    re.compile(r"lacks?\s+specific\s+(?:epc|energy)", re.I),
    # Generic statements about risk not precluding mortgage/insurance (favoured by exact-match)
    re.compile(r"(?:would\s+not\s+)?preclude\s+(?:its\s+)?(?:mortgageability|insurance)", re.I),
    re.compile(r"insurance\s+(?:being\s+)?available\s+at\s+a\s+commercial\s+rate", re.I),
    re.compile(r"not\s+preclude\s+.*(?:mortgage|insurance)", re.I),
]


def is_value_seeking_query(query: str) -> bool:
    """True if the query asks for a specific fact/value (EPC, flood risk, etc.)."""
    if not query or not isinstance(query, str):
        return False
    q = query.lower().strip()
    return any(phrase in q for phrase in _VALUE_SEEKING_PHRASES)


def _chunk_text(chunk: Dict[str, Any]) -> str:
    """Get combined chunk text for pattern matching."""
    text = (chunk.get("chunk_text") or "") + " " + (chunk.get("chunk_text_clean") or "")
    return (text or "").strip()


def _value_signal_score(chunk: Dict[str, Any]) -> float:
    """Boost for chunks containing actual values (EPC band, Zone N, £X, etc.)."""
    text = _chunk_text(chunk)
    if not text:
        return 0.0
    matches = sum(1 for p in _VALUE_SIGNAL_PATTERNS if p.search(text))
    return min(0.35, matches * 0.10)  # Stronger boost so Zone 2 / EPC chunks beat exact-match disclaimers


def _disclaimer_penalty(chunk: Dict[str, Any]) -> float:
    """Penalty for chunks that are predominantly disclaimers about missing data."""
    text = _chunk_text(chunk)
    if not text:
        return 0.0
    matches = sum(1 for p in _DISCLAIMER_PATTERNS if p.search(text))
    return -min(0.4, matches * 0.14)  # Stronger penalty so value chunks rank above disclaimer text


def apply_value_seeking_rerank(query: str, chunks: List[Dict[str, Any]]) -> None:
    """
    Mutate chunk scores: boost chunks with actual values, penalize disclaimer-heavy chunks
    when the query asks for a specific fact (EPC, flood risk, etc.).
    """
    if not is_value_seeking_query(query):
        return
    for chunk in chunks:
        base = float(chunk.get("score", 0))
        boost = _value_signal_score(chunk)
        penalty = _disclaimer_penalty(chunk)
        chunk["score"] = base + boost + penalty

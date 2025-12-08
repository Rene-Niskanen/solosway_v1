"""
Utilities for capturing and post-processing LLM evidence feedback so that
citations/highlights can point to the exact passages the model used.

This module defines a lightweight “feedback channel” contract:

1. The answering LLM is instructed to append a machine-readable block enclosed in
   `<EVIDENCE_FEEDBACK>...</EVIDENCE_FEEDBACK>` tags after its natural language reply.
2. Each entry in that block describes a fact the LLM cited (document id, verbatim
   quote/snippet, optional rationale).
3. The backend parses the block, then aligns the snippets against chunk metadata
   to determine the precise bbox/page to highlight.

By keeping the parsing/matching logic here, both the LangGraph nodes and the
Flask view layer can reuse the same helpers without duplicating heuristics.
"""

from __future__ import annotations

import json
import logging
import re
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Sequence, Tuple, TypedDict

EVIDENCE_FEEDBACK_START = "<EVIDENCE_FEEDBACK>"
EVIDENCE_FEEDBACK_END = "</EVIDENCE_FEEDBACK>"


class EvidenceFeedbackRecord(TypedDict, total=False):
    """
    Structured representation of a single fact the LLM claims to have used.

    Fields:
        citation_label: Optional string (e.g., "[1]") the LLM associated with the fact.
        doc_id: Document UUID the evidence originated from.
        snippet: Verbatim quote or tight paraphrase copied from the source chunk.
        rationale: Optional note describing what question it answered.
        page_hint: Optional page indicator (the LLM may mention this in its answer).
    """

    citation_label: Optional[str]
    doc_id: str
    snippet: str
    rationale: Optional[str]
    page_hint: Optional[str]


class MatchedEvidenceRecord(TypedDict, total=False):
    """
    Result of aligning a feedback record with a specific chunk/bbox.
    """

    feedback: EvidenceFeedbackRecord
    matched_chunk: Optional[dict]
    score: float


def build_feedback_instruction() -> str:
    """
    Instruction snippet that can be appended to an LLM prompt to request
    structured evidence feedback.
    """

    return (
        "\nAFTER you finish your natural language answer, append a JSON array "
        "inside `<EVIDENCE_FEEDBACK>...</EVIDENCE_FEEDBACK>` tags. Each object "
        "MUST contain:\n"
        '  - "doc_id": the exact document_id you relied on,\n'
        '  - "snippet": a verbatim quote (max ~240 characters) you referenced,\n'
        '  - "rationale": short note describing what question the snippet answered,\n'
        '  - optional "citation_label": the bracketed number you used in the text.\n'
        "Example:\n"
        "<EVIDENCE_FEEDBACK>\n"
        '[{"doc_id":"123","snippet":"£2,400,000 was paid...","rationale":"Sale price"}]\n'
        "</EVIDENCE_FEEDBACK>\n"
        "Do not explain the block; just output the JSON."
    )


def extract_feedback_from_answer(
    llm_answer: str,
    logger: Optional[logging.Logger] = None,
) -> Tuple[str, List[EvidenceFeedbackRecord]]:
    """
    Split the user-facing answer from the hidden evidence feedback block.

    Returns:
        clean_answer: Answer text with the feedback block removed.
        feedback: Parsed list of evidence records (empty if none/invalid).
    """

    start_idx = llm_answer.find(EVIDENCE_FEEDBACK_START)
    if start_idx == -1:
        return llm_answer.strip(), []

    end_idx = llm_answer.find(EVIDENCE_FEEDBACK_END, start_idx)
    if end_idx == -1:
        if logger:
            logger.warning(
                "[EVIDENCE_FEEDBACK] Start tag found without matching end tag."
            )
        return llm_answer.strip(), []

    feedback_payload = llm_answer[
        start_idx + len(EVIDENCE_FEEDBACK_START) : end_idx
    ].strip()
    clean_answer = (llm_answer[:start_idx] + llm_answer[end_idx + len(EVIDENCE_FEEDBACK_END) :]).strip()

    if not feedback_payload:
        return clean_answer, []

    try:
        parsed = json.loads(feedback_payload)
    except json.JSONDecodeError as err:
        if logger:
            logger.warning("[EVIDENCE_FEEDBACK] Failed to decode JSON: %s", err)
        return clean_answer, []

    if isinstance(parsed, dict):
        # Allow single-object payloads
        parsed = [parsed]
    if not isinstance(parsed, list):
        if logger:
            logger.warning("[EVIDENCE_FEEDBACK] Payload was not a list.")
        return clean_answer, []

    normalized: List[EvidenceFeedbackRecord] = []
    for idx, record in enumerate(parsed):
        if not isinstance(record, dict):
            if logger:
                logger.debug(
                    "[EVIDENCE_FEEDBACK] Skipping non-dict entry at index %s", idx
                )
            continue
        doc_id = str(record.get("doc_id", "")).strip()
        snippet = str(record.get("snippet", "")).strip()
        if not doc_id or not snippet:
            if logger:
                logger.debug(
                    "[EVIDENCE_FEEDBACK] Missing doc_id/snippet at index %s: %s",
                    idx,
                    record,
                )
            continue
        normalized.append(
            EvidenceFeedbackRecord(
                citation_label=(record.get("citation_label") or "").strip() or None,
                doc_id=doc_id,
                snippet=snippet[:500],  # keep payload tight
                rationale=(record.get("rationale") or "").strip() or None,
                page_hint=(record.get("page_hint") or "").strip() or None,
            )
        )

    return clean_answer, normalized


MIN_SNIPPET_MATCH_SCORE = 0.15
PRICE_SNIPPET_PATTERN = re.compile(
    r'(?:£|\$|€)\s*\d[\d,\.]*(?:\s*(?:million|bn|billion|m))?|\b\d[\d,\.]*\s*(?:million|bn|billion|m)\b|\b(?:market value|sale price|valuation|asking price|market rent|opinion of value)\b',
    re.IGNORECASE,
)
PRICE_VALUE_TOKEN_PATTERN = re.compile(
    r'(?:£|\$|€)?\s*\d[\d,\.]*(?:\s*(?:million|bn|billion|m))?',
    re.IGNORECASE,
)
VALUATION_KEYWORD_PATTERN = re.compile(
    r'\b(market value|valuation figure|market valuation|opinion of value|valuation)\b',
    re.IGNORECASE,
)


def _extract_price_tokens(text: str) -> List[str]:
    if not text:
        return []
    tokens = []
    for match in PRICE_VALUE_TOKEN_PATTERN.findall(text):
        token = match.strip().lower().replace(",", "").replace(" ", "")
        if token:
            tokens.append(token)
    return tokens


def match_feedback_to_chunks(
    feedback: Sequence[EvidenceFeedbackRecord],
    document_outputs: Sequence[Dict[str, Any]],
    logger: Optional[logging.Logger] = None,
) -> List[MatchedEvidenceRecord]:
    """
    Attempt to align each feedback snippet with a specific chunk from
    source_chunks_metadata so downstream code can grab bbox coordinates.
    """

    doc_lookup: Dict[str, Dict[str, Any]] = {
        (doc.get("doc_id") or ""): doc for doc in document_outputs if doc.get("doc_id")
    }
    ordinal_lookup: Dict[str, Dict[str, Any]] = {
        str(idx + 1): doc
        for idx, doc in enumerate(document_outputs)
        if doc.get("doc_id")
    }
    matches: List[MatchedEvidenceRecord] = []

    for record in feedback:
        doc_id = record["doc_id"]
        snippet = record.get("snippet", "")
        snippet_has_price = bool(PRICE_SNIPPET_PATTERN.search(snippet))
        snippet_has_valuation = bool(VALUATION_KEYWORD_PATTERN.search(snippet))
        doc = doc_lookup.get(doc_id)
        resolved_doc_id = doc_id

        if not doc:
            ordinal_doc = ordinal_lookup.get(doc_id)
            if ordinal_doc:
                resolved_doc_id = ordinal_doc.get("doc_id", resolved_doc_id)
                doc = ordinal_doc
                if resolved_doc_id and resolved_doc_id != record["doc_id"]:
                    record["doc_id"] = resolved_doc_id
                    if logger:
                        logger.info(
                            "[EVIDENCE_FEEDBACK] Interpreted doc_id '%s' as ordinal -> %s",
                            doc_id,
                            resolved_doc_id[:8],
                        )
                if resolved_doc_id:
                    doc_lookup.setdefault(resolved_doc_id, doc)

        doc_id = record["doc_id"]

        if not doc:
            if logger:
                logger.warning(
                    "[EVIDENCE_FEEDBACK] No document output found for doc_id=%s",
                    doc_id[:8],
                )
            matches.append(MatchedEvidenceRecord(feedback=record, matched_chunk=None, score=0.0))
            continue

        chunks = doc.get("source_chunks_metadata") or []
        best_chunk, best_score = _find_best_chunk_by_snippet(snippet, chunks)
        min_score = MIN_SNIPPET_MATCH_SCORE
        if best_chunk:
            chunk_text = best_chunk.get('content', '') or ''
            if snippet_has_price and PRICE_SNIPPET_PATTERN.search(chunk_text):
                min_score = max(0.12, MIN_SNIPPET_MATCH_SCORE - 0.08)
            if snippet_has_valuation and best_chunk.get("valuation_priority"):
                min_score = max(0.10, min_score - 0.05)
        if best_chunk and best_score < min_score:
            if logger:
                logger.info(
                    "[EVIDENCE_FEEDBACK] Discarding weak match for doc=%s | score=%.3f < %.2f | snippet='%s...'",
                    doc_id[:8],
                    best_score,
                    min_score,
                    snippet[:60],
                )
            best_chunk = None
            best_score = 0.0
        elif logger:
            logger.info(
                "[EVIDENCE_FEEDBACK] doc=%s | snippet='%s...' | best_score=%.3f | page=%s | chunk_idx=%s",
                doc_id[:8],
                snippet[:60],
                best_score,
                best_chunk.get("page_number") if best_chunk else None,
                best_chunk.get("chunk_index") if best_chunk else None,
            )

        matches.append(
            MatchedEvidenceRecord(
                feedback=record,
                matched_chunk=best_chunk,
                score=best_score,
            )
        )

    return matches


def _find_best_chunk_by_snippet(
    snippet: str,
    chunks: Sequence[Dict[str, Any]],
) -> Tuple[Optional[dict], float]:
    """
    Heuristic scoring to locate which chunk most likely contained the snippet.
    """

    if not snippet or not chunks:
        return None, 0.0

    normalized_snippet = _normalize_text(snippet)
    snippet_price_tokens = set(_extract_price_tokens(snippet))
    snippet_has_price = bool(snippet_price_tokens or PRICE_SNIPPET_PATTERN.search(snippet))
    snippet_has_valuation = bool(VALUATION_KEYWORD_PATTERN.search(snippet))
    best_chunk: Optional[dict] = None
    best_score = 0.0

    for chunk in chunks:
        content = chunk.get("content") or ""
        normalized_chunk = _normalize_text(content)
        if not normalized_chunk:
            continue

        exact_match = normalized_snippet in normalized_chunk
        similarity = SequenceMatcher(None, normalized_snippet, normalized_chunk).ratio()

        score = similarity
        if exact_match:
            score += 1.0  # strong boost for literal inclusion

        # Prefer chunks with bbox/page metadata present
        if chunk.get("bbox"):
            score += 0.1

        chunk_has_price = bool(PRICE_SNIPPET_PATTERN.search(content))
        chunk_price_tokens = set(_extract_price_tokens(content))
        if snippet_has_price and chunk_price_tokens and snippet_price_tokens & chunk_price_tokens:
            score += 0.5
        elif snippet_has_price and chunk_has_price:
            score += 0.25
        elif snippet_has_price:
            score += 0.12
        elif chunk_has_price:
            score += 0.05
        valuation_priority = bool(chunk.get("valuation_priority"))
        if snippet_has_valuation and valuation_priority:
            score += 0.35
        elif snippet_has_valuation and chunk_has_price:
            score += 0.15
        price_boost = chunk.get("price_boost") or 0.0
        if price_boost:
            score += min(0.3, price_boost)
        if snippet_has_price and valuation_priority:
            score += 0.25
        elif valuation_priority:
            score += 0.1

        if score > best_score:
            best_score = score
            best_chunk = chunk

    return best_chunk, best_score


_WHITESPACE_RE = re.compile(r"\s+")


def _normalize_text(text: str) -> str:
    """
    Normalize text for fuzzy comparison.
    """

    lowered = text.lower()
    collapsed = _WHITESPACE_RE.sub(" ", lowered)
    return collapsed.strip()



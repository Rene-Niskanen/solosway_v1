"""
Responder Node - Generates final answer from execution results.

This node takes the execution results and generates a conversational answer.
It reuses the existing conversational answer generation logic but receives
structured results instead of tool messages.

Key Principle: Generate answer from operational results, not internal reasoning.
"""

import logging
import re
import uuid
import json
from typing import Dict, Any, List, Tuple, Optional, Literal
from dataclasses import dataclass
from pydantic import BaseModel, Field
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from langgraph.prebuilt import ToolNode

from backend.llm.types import MainWorkflowState, Citation
from backend.llm.utils.execution_events import ExecutionEvent, ExecutionEventEmitter
from backend.llm.utils.node_logging import log_node_perf
from backend.llm.nodes.agent_node import generate_conversational_answer, extract_chunk_citations_from_messages, get_document_filename
from backend.llm.contracts.validators import validate_responder_output
from backend.llm.config import config
from backend.llm.prompts import _get_main_answer_tagging_rule, ensure_main_tags_when_missing
from backend.llm.prompts.responder import (
    get_responder_fact_mapping_system_prompt,
    get_responder_fact_mapping_human_prompt,
    get_responder_natural_language_system_prompt,
    get_responder_natural_language_human_prompt,
    get_responder_conversational_tool_citations_system_prompt,
    get_responder_conversational_pre_citations_system_prompt,
    get_responder_block_citation_system_content,
    get_responder_formatted_answer_system_prompt,
    get_responder_formatted_answer_human_prompt,
)
from backend.llm.utils.personality_prompts import (
    PERSONALITY_CHOICE_INSTRUCTION,
    VALID_PERSONALITY_IDS,
    DEFAULT_PERSONALITY_ID,
)
from backend.llm.tools.citation_mapping import create_chunk_citation_tool, _narrow_bbox_to_cited_line
from backend.llm.prompts.conversation import format_memories_section
from backend.llm.prompts.no_results import (
    get_responder_no_chunks_system_prompt,
    get_responder_no_chunks_human_prompt,
)
from backend.llm.utils.workspace_context import build_workspace_context
from backend.llm.prompts.human_templates import format_attachment_context
from backend.services.supabase_client_factory import get_supabase_client

# Import from new citation architecture modules
from backend.llm.citation import (
    fetch_chunk_blocks,
    extract_evidence_blocks_from_chunks,
    deduplicate_evidence_blocks,
    rank_evidence_by_relevance,
    create_evidence_registry,
    format_evidence_table_for_llm,
    map_citation_numbers_to_citations,
    deduplicate_and_renumber_citations,
    extract_atomic_facts_from_block,
    extract_clause_evidence_from_block,
    EvidenceBlock
)

logger = logging.getLogger(__name__)

# Patterns for closing phrases that must only appear at the end (move to end when they appear with more content after)
_MID_RESPONSE_CLOSING_PATTERNS = [
    # "Please let me know if you need more details about the transaction process or any other aspect! 📄 ✨"
    re.compile(
        r"\s*Please\s+let\s+me\s+know\s+if\s+you\s+need\s+more\s+details(?:\s+about\s+[^.!?]+)?\s+or\s+any\s+other\s+aspect\!?\s*[📄✨\s]*",
        re.IGNORECASE,
    ),
    re.compile(
        r"\s*If\s+you\s+need\s+more\s+details(?:\s+about[^.!?]*?)?(?:\s+or\s+any\s+other\s+aspect)?[^.]*?[!.]?\s*[📄✨\s]*",
        re.IGNORECASE,
    ),
    re.compile(
        r"\s*Let\s+me\s+know\s+if\s+you\s+have\s+any\s+(?:other\s+)?questions[^.]*?[!.]?\s*[📄✨\s]*",
        re.IGNORECASE,
    ),
    # "If you want to dive deeper into specific sections or concepts, feel free to ask! 📊 ✨"
    re.compile(
        r"\s*If\s+you\s+want\s+to\s+dive\s+deeper(?:\s+into\s+specific\s+sections\s+or\s+concepts)?\s*,\s*feel\s+free\s+to\s+ask\!?\s*[\s📄✨📋🌳📊💡✅😊]*",
        re.IGNORECASE,
    ),
    # Generic "feel free to ask" + optional "dive deeper" variant
    re.compile(
        r"\s*Feel\s+free\s+to\s+ask(?:\s+if\s+you\s+want\s+to\s+dive\s+deeper[^.!?\n]*)?\!?\s*[\s📄✨📋🌳📊💡✅😊🙂]*",
        re.IGNORECASE,
    ),
    # "If you need further details or assistance, feel free to ask! 🙂"
    re.compile(
        r"\s*If\s+you\s+need\s+further\s+details\s+or\s+assistance\s*,\s*feel\s+free\s+to\s+ask\!?\s*[\s🙂😊📄✨📋🌳📊💡✅]*",
        re.IGNORECASE,
    ),
    # Catch-all: "If you need [anything], feel free to ask" (generic opener before substantive content)
    re.compile(
        r"\s*If\s+you\s+need\s+(?:further\s+)?(?:details\s+or\s+assistance|more\s+information|any\s+clarification)[^.!?]*feel\s+free\s+to\s+ask\!?\s*[\s🙂😊📄✨📋🌳📊💡✅]*",
        re.IGNORECASE,
    ),
    # "If you have any more questions about the fees or the process, feel free to ask! 😊" (must only be at end)
    re.compile(
        r"\s*If\s+you\s+have\s+any\s+(?:more\s+)?questions(?:\s+about\s+[^.!?\n]+)?\s*,\s*feel\s+free\s+to\s+ask\!?\s*[\s😊🙂📄✨📋🌳📊💡✅]*",
        re.IGNORECASE,
    ),
]

# Closing phrases to strip entirely (never show to user)
_STRIP_ENTIRELY_CLOSING_PATTERNS = [
    # "If you need further insights into the comparables or the valuation process, feel free to ask! 😊"
    re.compile(
        r"\s*If\s+you\s+need\s+further\s+insights\s+into\s+(?:the\s+)?comparables\s+or\s+(?:the\s+)?valuation\s+process\s*,\s*feel\s+free\s+to\s+ask\!?\s*[😊🙂📄✨\s]*",
        re.IGNORECASE,
    ),
    # "If you have any more questions about the details or next steps, feel free to ask! 😊" (and similar)
    re.compile(
        r"\s*If\s+you\s+have\s+any\s+(?:more\s+)?questions\s+about\s+(?:the\s+)?details\s+or\s+next\s+steps\s*,\s*feel\s+free\s+to\s+ask\!?\s*[😊🙂📄✨\s]*",
        re.IGNORECASE,
    ),
    # Any "If you have any [more] questions about [X], feel free to ask! [emojis]"
    re.compile(
        r"\s*If\s+you\s+have\s+any\s+(?:more\s+)?questions\s+about\s+[^.!?\n]+,\s*feel\s+free\s+to\s+ask\!?\s*[😊🙂📄✨📋🌳📊💡✅\s]*",
        re.IGNORECASE,
    ),
    # "If you need further details or assistance, feel free to ask!"
    re.compile(
        r"\s*If\s+you\s+need\s+further\s+details\s+or\s+assistance\s*,\s*feel\s+free\s+to\s+ask\!?\s*[😊🙂📄✨\s]*",
        re.IGNORECASE,
    ),
    # Generic "feel free to ask" standalone closing line (with optional lead-in)
    re.compile(
        r"\s*(?:If\s+you\s+need\s+more\s+details[^.!?\n]*?|Hope\s+that\s+helps\.?)\s*,\s*feel\s+free\s+to\s+ask\!?\s*[😊🙂📄✨\s]*",
        re.IGNORECASE,
    ),
]


def _looks_like_closing_line(s: str) -> bool:
    """True if the string looks like a standalone closing/follow-up line (for dedupe when moving to end)."""
    if not s or len(s) > 200:
        return False
    t = s.strip().lower()
    return (
        "feel free to ask" in t
        or "let me know" in t
        or "need more details" in t
        or "further details or assistance" in t
        or "dive deeper" in t
        or "any more questions" in t
        or "any further questions" in t
    )


# Patterns that match closing fragments *embedded* in a line (e.g. "Offer Details for Banda Lane free to ask! 😊")
# Strip these from the end of any line that is NOT the last paragraph (leakage from LLM putting closing in heading).
_EMBEDDED_CLOSING_SUFFIX_PATTERNS = [
    re.compile(r"\s+free to ask\!?\s*[😊🙂📄✨📋🌳📊💡✅\s]*$", re.IGNORECASE),
    re.compile(r",?\s*feel free to ask\!?\s*[😊🙂📄✨📋🌳📊💡✅\s]*$", re.IGNORECASE),
    re.compile(r"\s+If you need (?:more )?information or further assistance, feel\s*$", re.IGNORECASE),
    re.compile(r"\s+If you need further details or assistance, feel free to ask\!?\s*[😊🙂\s]*$", re.IGNORECASE),
    re.compile(r"\s+let me know(?: if you need[^.]*)?\!?\s*[😊🙂📄✨\s]*$", re.IGNORECASE),
]

# Fragments that leak at the *start* or *middle* of a line (e.g. after "**Market Value**").
# Strip these from non-final paragraphs / headings so the closing only appears at the end.
_EMBEDDED_CLOSING_MIDLINE_PATTERNS = [
    # Full phrase including optional "**Label** " or "Market Value " so we remove the whole leakage in one go
    re.compile(
        r"(?:\*\*[^*]+\*\*\s+)?(?:Market\s+Value\s+)?or\s+related\s+details\s*,\s*feel\s+free\s+to\s+ask\!?\s*[😊🙂📄✨📋🌳📊💡✅\s]*",
        re.IGNORECASE,
    ),
    # "any more questions about [X], feel free to ask! 😊" leaking before the value (e.g. before **£1,950,000**)
    re.compile(
        r"\s*any\s+more\s+questions\s+about\s+[^.!?\n]+(?:,\s*feel\s+free\s+to\s+ask\!?\s*[😊🙂📄✨\s]*)?(?=\s*\*\*|\s*£|\s*\[?\d+\]?)",
        re.IGNORECASE,
    ),
    re.compile(r"\s+or\s+need\s+more\s+details\s*,\s*feel\s+free\s+to\s+ask\!?\s*[😊🙂\s]*", re.IGNORECASE),
    re.compile(r",\s*feel\s+free\s+to\s+ask\!?\s*[😊🙂📄✨\s]*(?=\s*\*\*|\s*\[?\d+\]?|\s*£|\s*\d)", re.IGNORECASE),
]

# Full closing phrase when it appears in the *middle* of a paragraph (e.g. after "Completion Deadline").
# Only match when followed by more content (lookahead) so we don't strip a legitimate closing at end.
_EMBEDDED_CLOSING_MIDLINE_FULL_PHRASE = re.compile(
    r"\s+If\s+you\s+need\s+further\s+details\s+or\s+assistance\s*,\s*feel\s+free\s+to\s+ask\!?\s*[😊🙂📄✨📋🌳📊💡✅\s]*"
    r"(?=\s+[A-Z]|\s+The\s+|\s+This\s+|\s+\d|\s*\[)",
    re.IGNORECASE,
)

# Parentheticals that are spelled-out amounts from source docs (e.g. "(One Million, Nine Hundred and Fifty Thousand Pounds)")
# Strip these so they don't leak into the answer.
_AMOUNT_IN_WORDS_PAREN = re.compile(
    r"\s*\(\s*[^)]*(?:Million|Thousand|Hundred)[^)]*(?:Pounds|Dollars|Euros|USD|GBP)\s*\)\s*",
    re.IGNORECASE,
)

# Bare citation digits: model sometimes outputs "**£1,950,000**1" or "Pounds)2" instead of [1] [2]
_BARE_CITATION_AFTER_BOLD = re.compile(r"\*\*(\d)(?=\s|$|,|\s*\()")
_BARE_CITATION_AFTER_PAREN = re.compile(r"\)(\d)(?=\s|$|,)")


def _strip_embedded_closing_fragments(text: str) -> str:
    """Remove closing phrases that were leaked into headings or mid-response lines (e.g. 'Offer Details for X free to ask! 😊' or '**Market Value** or related details, feel free to ask!')."""
    if not (text or text.strip()):
        return text
    paras = re.split(r"\n\n+", text)
    out = []
    for i, para in enumerate(paras):
        is_last = i == len(paras) - 1
        # Strip embedded closing fragments from: (1) any non-final paragraph, or (2) a line that looks like a heading (leakage)
        looks_like_heading = "**" in para or para.strip().startswith("#")
        if not is_last or looks_like_heading:
            for pat in _EMBEDDED_CLOSING_SUFFIX_PATTERNS:
                para = pat.sub("", para).rstrip()
                para = re.sub(r"\s*[,–\-]\s*$", "", para)
            # Strip closing fragments that appear in the *middle* of a line (e.g. "**Market Value** or related details, feel free to ask! **£1,950,000**")
            for pat in _EMBEDDED_CLOSING_MIDLINE_PATTERNS:
                para = pat.sub(" ", para)
            para = re.sub(r"  +", " ", para).strip()
        # Always strip the full "If you need further details or assistance, feel free to ask! 😊" when it appears
        # in the middle of any paragraph (e.g. "Completion Deadline If you need... The preferred...") — only when
        # followed by more content, so we don't remove a legitimate closing at end.
        para = _EMBEDDED_CLOSING_MIDLINE_FULL_PHRASE.sub(" ", para)
        para = re.sub(r"  +", " ", para).strip()
        out.append(para)
    return "\n\n".join(out)


def _strip_amount_in_words_parentheticals(text: str) -> str:
    """Remove source-doc leakage like (One Million, Nine Hundred and Fifty Thousand Pounds)."""
    if not text:
        return text
    return _AMOUNT_IN_WORDS_PAREN.sub(" ", text)


def _normalize_bare_citation_digits(text: str) -> str:
    """Turn **£1,950,000**1 and )2 into **£1,950,000**[1] and )[2]."""
    if not text:
        return text
    text = _BARE_CITATION_AFTER_BOLD.sub(r"**[\1]", text)
    text = _BARE_CITATION_AFTER_PAREN.sub(r")[\1]", text)
    return text


def _strip_leaked_heading_before_value(text: str) -> str:
    """Remove leaked 'Market Value ' (or similar) when it appears right before a bold value."""
    if not text:
        return text
    # Only when followed by ** (bold value) so we don't strip legitimate "Market Value" in prose
    return re.sub(r"(^|\s)Market\s+Value\s+(?=\*\*)", r"\1", text, flags=re.IGNORECASE)


def _strip_entirely_closings(text: str) -> str:
    """Remove closing phrases that should never appear (e.g. comparables/valuation 'feel free to ask')."""
    if not (text or text.strip()):
        return text
    result = text
    for pat in _STRIP_ENTIRELY_CLOSING_PATTERNS:
        result = pat.sub("", result)
    result = re.sub(r"\n{3,}", "\n\n", result).strip()
    result = re.sub(r"  +", " ", result)
    return result


def _strip_mid_response_generic_closings(text: str) -> str:
    """Move closing phrases that appear in the middle or start of a response to the end (on their own line)."""
    if not (text or text.strip()):
        return text
    # Remove phrases that must never appear (e.g. "further insights into comparables/valuation... feel free to ask")
    text = _strip_entirely_closings(text)
    # First: remove closing fragments embedded in headings/mid lines (e.g. "Offer Details for Banda Lane free to ask! 😊")
    result = _strip_embedded_closing_fragments(text)
    changed = True
    while changed:
        changed = False
        for pattern in _MID_RESPONSE_CLOSING_PATTERNS:
            for m in pattern.finditer(result):
                end = m.end()
                rest = result[end:].strip()
                if rest and re.search(r"[a-zA-Z0-9\u00C0-\u024F]", rest):
                    closing_line = m.group(0).strip()
                    result = (result[: m.start()] + " " + result[end:]).strip()
                    result = re.sub(r"  +", " ", result)
                    result = re.sub(r"\n{3,}", "\n\n", result)
                    # Append at end on its own line, unless it's already there
                    last_para = result.rsplit("\n\n", 1)[-1].strip() if "\n\n" in result else result.strip()
                    if not _looks_like_closing_line(last_para):
                        result = result.rstrip() + "\n\n" + closing_line
                    changed = True
                    break
            if changed:
                break
    # Normalize bare citation digits (**...**1 → **...**[1], )2 → )[2]) then strip source-doc leakage
    result = _normalize_bare_citation_digits(result)
    result = _strip_amount_in_words_parentheticals(result)
    result = _strip_leaked_heading_before_value(result)
    result = re.sub(r"  +", " ", result).strip() if result else result
    # Remove any "strip entirely" closings that were moved to the end (so they never appear)
    result = _strip_entirely_closings(result)
    return result


def _build_responder_workspace_section(
    state: Dict[str, Any], execution_results: List[Dict[str, Any]]
) -> Tuple[str, Optional[List[str]]]:
    """
    Build workspace context for the responder: either from state (property_id/document_ids)
    or from execution_results when no attachment.
    We prefer document_ids from the retrieve_chunks result (docs we actually used to answer),
    so follow-ups stay on the same doc(s); fall back to retrieve_docs only if no chunks.
    Returns (workspace_section, derived_document_ids). derived_document_ids is non-None only when
    we had no scope in state and we derived doc IDs - so the caller can persist them for the next turn.
    """
    try:
        business_id = state.get("business_id")
        if not business_id:
            return "", None
        property_id = state.get("property_id")
        document_ids = state.get("document_ids")
        if property_id or document_ids:
            doc_ids = [str(d) for d in document_ids] if isinstance(document_ids, list) else None
            return build_workspace_context(property_id, doc_ids, str(business_id)), None
        # No attachment: derive document_ids from the chunks we actually used (retrieve_chunks),
        # so follow-ups stay on the same doc(s) we answered from. Fall back to retrieve_docs only if no chunks.
        doc_ids_from_chunks = []
        for item in execution_results or []:
            if item.get("action") == "retrieve_chunks" and item.get("success"):
                result = item.get("result") or []
                if isinstance(result, list):
                    for chunk in result:
                        if isinstance(chunk, dict):
                            did = chunk.get("document_id")
                            if did and str(did) not in doc_ids_from_chunks:
                                doc_ids_from_chunks.append(str(did))
        if doc_ids_from_chunks:
            return build_workspace_context(None, doc_ids_from_chunks, str(business_id)), doc_ids_from_chunks
        # Fallback: no chunks or no document_id in chunks – use first retrieve_docs result
        for item in execution_results or []:
            if item.get("action") == "retrieve_docs":
                result = item.get("result") or []
                if isinstance(result, list) and len(result) > 0:
                    doc_ids = []
                    for r in result:
                        did = r.get("document_id") or r.get("id")
                        if did:
                            doc_ids.append(str(did))
                    if doc_ids:
                        return build_workspace_context(None, doc_ids, str(business_id)), doc_ids
                break
        return "", None
    except Exception as e:
        logger.warning("[RESPONDER] _build_responder_workspace_section failed: %s", e)
        return "", None


def _strip_markdown_for_citation(text: str) -> str:
    """Strip common markdown so we can extract values from e.g. **£2,400,000**."""
    if not text:
        return text
    return re.sub(r'\*+', '', text).strip()


def _distinctive_values_from_cited_text(cited_text: str) -> List[str]:
    """
    Extract distinctive values (numbers, currency, dates) from cited text so we can
    prefer the block that actually contains the cited figure (e.g. £2,300,000)
    over a similar block (e.g. "Market Value... 180 days") when multiple blocks
    in the same chunk have overlapping wording.
    """
    if not cited_text or not cited_text.strip():
        return []
    # Strip markdown so **£2,400,000** is matched as £2,400,000
    text = _strip_markdown_for_citation(cited_text)
    values = []
    # Currency amounts: £2,300,000 or £6,000 (keep as-is for substring match)
    for m in re.finditer(r"£[\d,]+(?:\.[\d]+)?", text):
        values.append(m.group(0))
    # Large numbers with commas (often valuations): 2,300,000
    for m in re.finditer(r"\b[\d]{1,3}(?:,[\d]{3})+\b", text):
        val = m.group(0)
        if val not in values:
            values.append(val)
        # Also add digits-only form so we match blocks that have "2400000" or "2 400 000"
        digits_only = val.replace(",", "")
        if digits_only not in values:
            values.append(digits_only)
    # Date-like: "12th February 2024" or "February 12, 2024"
    for m in re.finditer(r"\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}", text, re.IGNORECASE):
        values.append(m.group(0))
    for m in re.finditer(r"(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}", text, re.IGNORECASE):
        if m.group(0) not in values:
            values.append(m.group(0))
    return values


def _block_looks_like_footer_or_url(block_content: str) -> bool:
    """True if block is likely footer/header/URL, not the cited factual content."""
    if not block_content or len(block_content.strip()) < 20:
        return True
    s = block_content.lower().strip()
    if "www." in s or ".com" in s or ".co.uk" in s:
        return True
    # Short boilerplate line like "United Kingdom - Spain - Portugal - Gibraltar"
    if len(block_content) < 100 and "united kingdom" in s and ("spain" in s or "portugal" in s or "gibraltar" in s):
        return True
    return False


# Evidence-First Citation Architecture Types
EvidenceType = Literal["atomic", "clause"]


class PersonalityResponse(BaseModel):
    """Structured output: chosen personality and the answer text (same-call personality selection)."""
    personality_id: str = Field(
        description="One of: default, friendly, efficient, professional, nerdy, candid, cynical, listener, robot, quirky"
    )
    response: str = Field(
        description="The full answer to the user in Markdown, with citations as [ID: X](BLOCK_CITE_ID_N)"
    )


class EvidenceAnswerOutput(BaseModel):
    """Structured output for LLM answer with citation numbers (legacy - for backward compatibility)."""
    answer: str = Field(
        description="The conversational answer with citation numbers embedded. CRITICAL: You MUST wrap the exact thing the user is looking for in <<<MAIN>>>...<<<END_MAIN>>> (e.g. <<<MAIN>>>£2,300,000<<<END_MAIN>>> or <<<MAIN>>>+44 (0) 203 463 8725<<<END_MAIN>>>). Use figure-first format. Put ONLY the value/fact in MAIN. Never omit MAIN tags. Cite as needed."
    )
    citations: List[int] = Field(
        description="Array of citation numbers used in the answer (e.g., [1, 2, 3])"
    )
    unsupported_claims: List[str] = Field(
        default=[],
        description="Any claims the user asked about that have no supporting evidence"
    )


class EvidenceClaim(BaseModel):
    """Single claim with its supporting evidence."""
    claim: str = Field(
        description="The factual claim (e.g., 'Market value of the property')",
        max_length=200
    )
    citations: List[int] = Field(
        description="Citation numbers supporting this claim (e.g., [1, 2])",
        min_length=1,
        max_length=5
    )


class EvidenceSelectionOutput(BaseModel):
    """Structured output from Pass 1: Evidence selection."""
    facts: List[EvidenceClaim] = Field(
        description="List of claims with their supporting citations",
        max_length=10
    )
    unsupported_claims: List[str] = Field(
        default=[],
        description="Any claims the user asked about that have no supporting evidence",
        max_length=5
    )


class NaturalLanguageOutput(BaseModel):
    """Structured output from Pass 2: Natural language rendering."""
    answer: str = Field(
        description="Conversational answer with citation numbers embedded",
        max_length=2000
    )
    citations: List[int] = Field(
        description="Array of citation numbers used (e.g., [1, 2, 3])",
        max_length=10
    )


logger = logging.getLogger(__name__)


def extract_chunks_from_results(execution_results: list[Dict[str, Any]]) -> str:
    """
    Extract chunk text from execution results.
    
    Similar to extract_chunk_text_only but works with execution_results structure.
    """
    chunk_texts = []
    
    for result in execution_results:
        if result.get("action") == "retrieve_chunks" and result.get("success"):
            result_data = result.get("result", [])
            if isinstance(result_data, list):
                for chunk in result_data:
                    if isinstance(chunk, dict):
                        # Extract chunk text
                        chunk_text = chunk.get('chunk_text') or chunk.get('chunk_text_clean', '')
                        if chunk_text:
                            chunk_texts.append(chunk_text.strip())
    
    return "\n\n---\n\n".join(chunk_texts)


def extract_chunks_with_metadata(execution_results: list[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Extract chunks with metadata (chunk_id, chunk_text, document_id, bbox, page_number, blocks) from execution results.
    
    Returns:
        List of chunk dictionaries with full metadata for citation mapping
    """
    chunks_metadata = []
    
    for result in execution_results:
        if result.get("action") == "retrieve_chunks" and result.get("success"):
            result_data = result.get("result", [])
            if isinstance(result_data, list):
                for chunk in result_data:
                    if isinstance(chunk, dict):
                        chunk_text = chunk.get('chunk_text') or chunk.get('chunk_text_clean', '')
                        if chunk_text:
                            chunks_metadata.append({
                                'chunk_id': chunk.get('chunk_id'),
                                'chunk_text': chunk_text.strip(),
                                'document_id': chunk.get('document_id'),
                                'document_filename': chunk.get('document_filename'),
                                'page_number': chunk.get('page_number', 0),
                                'bbox': chunk.get('bbox'),  # Chunk-level bbox (fallback)
                                'blocks': chunk.get('blocks', [])  # Block-level data for precise citations
                            })
    
    return chunks_metadata


def format_chunks_with_ids(chunks_metadata: List[Dict[str, Any]]) -> str:
    """
    Format chunks with chunk_ids visible to LLM.
    
    Format: [CHUNK_ID: uuid] chunk text here
    
    This allows the LLM to see which chunk_id corresponds to which text,
    so it can call match_citation_to_chunk with the correct chunk_id and exact text.
    """
    formatted_chunks = []
    
    for chunk in chunks_metadata:
        chunk_id = chunk.get('chunk_id', '')
        chunk_text = chunk.get('chunk_text', '')
        if chunk_id and chunk_text:
            formatted_chunks.append(f"[CHUNK_ID: {chunk_id}]\n{chunk_text}")
    
    return "\n\n---\n\n".join(formatted_chunks)


def format_chunks_with_short_ids(chunks_metadata: List[Dict[str, Any]]) -> Tuple[str, Dict[str, Dict[str, Any]]]:
    """
    Format chunks with short integer IDs for LLM, creating a lookup mapping.
    
    Format: [SOURCE_ID: 1] chunk text here
           [SOURCE_ID: 2] chunk text here
    
    This allows the LLM to see simple numbers (1, 2, 3) instead of long UUIDs,
    dramatically improving citation accuracy and reducing token usage.
    
    Returns:
        - formatted_text: Chunks formatted with short IDs
        - short_id_lookup: Dict mapping short_id (str) -> full chunk metadata
    """
    formatted_chunks = []
    short_id_lookup = {}
    
    for idx, chunk in enumerate(chunks_metadata, start=1):
        short_id = str(idx)  # "1", "2", "3", etc.
        chunk_id = chunk.get('chunk_id', '')
        chunk_text = chunk.get('chunk_text', '')
        
        if chunk_id and chunk_text:
            # Format with short ID at the beginning
            formatted_chunks.append(f"[SOURCE_ID: {short_id}]\n{chunk_text}")
            
            # Store ALL blocks for this chunk (not just one bbox)
            # We'll select the best block when extracting citations based on context
            blocks = chunk.get('blocks', [])
            chunk_bbox = chunk.get('bbox')  # Fallback to chunk-level bbox
            
            # Map short_id -> full chunk metadata (including UUID, bbox, page_number, blocks)
            short_id_lookup[short_id] = {
                'chunk_id': chunk_id,  # Full UUID for database lookup
                'short_id': short_id,  # The simple number (1, 2, 3)
                'page_number': chunk.get('page_number', 0),
                'bbox': chunk_bbox,  # Chunk-level bbox (fallback)
                'blocks': blocks,  # All blocks for this chunk (for precise block selection)
                'doc_id': chunk.get('document_id'),
                'original_filename': chunk.get('document_filename', ''),
                'chunk_text': chunk_text
            }
            
            # Log block information for debugging
            if blocks and isinstance(blocks, list):
                logger.info(
                    f"[CITATION_DEBUG] Chunk {short_id} ({chunk_id[:8]}...): "
                    f"{len(blocks)} blocks, chunk_bbox={chunk_bbox is not None}"
                )
                for block_idx, block in enumerate(blocks[:3]):  # Log first 3 blocks
                    if isinstance(block, dict):
                        block_type = block.get('type', 'unknown')
                        block_content_preview = (block.get('content', '') or '')[:50]
                        block_bbox = block.get('bbox')
                        logger.debug(
                            f"  Block {block_idx}: type={block_type}, "
                            f"content_preview='{block_content_preview}...', "
                            f"bbox={block_bbox is not None}"
                        )
    
    formatted_text = "\n\n---\n\n".join(formatted_chunks)
    return formatted_text, short_id_lookup


# Regex for optional (BLOCK_CITE_ID_N) after a citation - used for jan28th-style block-id lookup
_BLOCK_ID_IN_RESPONSE = re.compile(r'\s*\(\s*(BLOCK_CITE_ID_\d+)\s*\)')
# Fallback: block id without parentheses (e.g. [ID: 1] BLOCK_CITE_ID_42)
_BLOCK_ID_NO_PARENS = re.compile(r'\s+(BLOCK_CITE_ID_\d+)\b')

# Max blocks per doc in the prompt metadata table (avoids token overflow; resolution still uses full table)
MAX_BLOCKS_PER_DOC_IN_PROMPT = 500

# Max characters for pasted/attachment context in paste+docs path (avoids token overflow)
MAX_PASTE_CONTEXT_CHARS = 12000


def _resolve_block_id_to_metadata(
    block_id: str,
    metadata_lookup_tables: Dict[str, Dict[str, Dict[str, Any]]],
) -> Optional[Dict[str, Any]]:
    """Resolve BLOCK_CITE_ID_N to bbox, doc_id, page (jan28th-style). Returns None if not found."""
    for doc_id, table in metadata_lookup_tables.items():
        if block_id in table:
            meta = table[block_id].copy()
            meta['doc_id'] = doc_id
            meta['original_filename'] = meta.get('original_filename', '')
            meta['bbox'] = {
                'left': meta.get('bbox_left', 0),
                'top': meta.get('bbox_top', 0),
                'width': meta.get('bbox_width', 0),
                'height': meta.get('bbox_height', 0),
                'page': meta.get('page', 0),
            }
            return meta
    return None


def extract_citations_with_positions(
    llm_response: str,
    short_id_lookup: Dict[str, Dict[str, Any]],
    metadata_lookup_tables: Optional[Dict[str, Dict[str, Dict[str, Any]]]] = None,
) -> List[Dict[str, Any]]:
    """
    Extract citations from LLM response. Prefers jan28th-style [ID: X](BLOCK_CITE_ID_N):
    when (BLOCK_CITE_ID_N) is present, resolve bbox from metadata_lookup_tables. Otherwise
    use short_id_lookup and select best block within the chunk.
    """
    citations = []
    pattern = r'\[ID:\s*([^\]]+)\]'
    matches = list(re.finditer(pattern, llm_response))

    logger.info(f"[CITATION_DEBUG] Extracting citations from LLM response ({len(matches)} matches found)")

    for idx, match in enumerate(matches, start=1):
        short_id = match.group(1).strip()
        start_position = match.start()
        end_position = match.end()

        # Jan28th-style: look for (BLOCK_CITE_ID_N) or BLOCK_CITE_ID_N immediately after [ID: X]
        block_id_from_response = None
        search_span = llm_response[end_position:end_position + 60]
        block_id_match = _BLOCK_ID_IN_RESPONSE.match(search_span)
        if block_id_match:
            block_id_from_response = block_id_match.group(1)
            end_position = end_position + block_id_match.end()
        else:
            block_id_match = _BLOCK_ID_NO_PARENS.match(search_span)
            if block_id_match:
                block_id_from_response = block_id_match.group(1)
                end_position = end_position + block_id_match.end()
        
        # Extract context around the citation to help match to the right block
        # Use a smaller context window to get more specific context
        context_start = max(0, start_position - 50)
        context_end = min(len(llm_response), end_position + 50)
        citation_context = llm_response[context_start:context_end].lower()
        
        # Extract the sentence containing the citation for better matching
        # Find sentence boundaries around the citation
        sentence_start = citation_context.rfind('.', 0, start_position - context_start)
        sentence_end = citation_context.find('.', end_position - context_start)
        if sentence_start == -1:
            sentence_start = 0
        else:
            sentence_start += 1  # Skip the period
        if sentence_end == -1:
            sentence_end = len(citation_context)
        else:
            sentence_end += 1  # Include the period
        
        # Use the sentence containing the citation as the primary context
        sentence_context = citation_context[sentence_start:sentence_end].strip()
        # Cited text for sub-level bbox: phrase that should be highlighted (sentence or key value)
        # Prefer sentence; fallback to short window before marker (often contains "£X" or "value")
        cited_text_for_bbox = sentence_context if sentence_context else llm_response[max(0, start_position - 80):start_position].strip()
        if len(cited_text_for_bbox) > 200:
            cited_text_for_bbox = cited_text_for_bbox[-200:]

        # Jan28th-style: resolve by block_id when present (exact bbox, no heuristic)
        # Citation number = order of appearance (1, 2, 3...) so UI shows [1], [2], [3], not block id.
        if block_id_from_response and metadata_lookup_tables:
            resolved = _resolve_block_id_to_metadata(block_id_from_response, metadata_lookup_tables)
            if resolved:
                citation_number = idx  # Sequential by appearance in response
                bbox = resolved.get('bbox')
                page_number = int(resolved.get('page', 0))
                citation = {
                    'citation_number': citation_number,
                    'short_id': short_id,
                    'chunk_id': '',
                    'position': start_position,
                    'end_position': end_position,
                    'bbox': bbox,
                    'page_number': page_number,
                    'doc_id': resolved.get('doc_id', ''),
                    'original_filename': resolved.get('original_filename', ''),
                    'block_id': block_id_from_response,
                    'method': 'block-id-lookup',
                    'block_info': None,
                    'cited_text': cited_text_for_bbox,
                    'citation_debug': {
                        'short_id': short_id,
                        'citation_number': citation_number,
                        'cited_text_for_bbox': cited_text_for_bbox,
                        'distinctive_values': [],
                        'chosen_bbox': dict(bbox) if isinstance(bbox, dict) else None,
                        'block_id': block_id_from_response,
                        'block_index': None,
                        'block_type': None,
                        'block_content_preview': None,
                        'match_score': None,
                        'source': 'block-id-lookup',
                        'num_blocks_considered': 0,
                    },
                }
                citations.append(citation)
                logger.info(
                    f"[CITATION_DEBUG] Citation {idx} resolved by block_id {block_id_from_response} "
                    f"(page={page_number}, doc_id={resolved.get('doc_id', '')[:8]})"
                )
                continue

        # Look up full metadata for this short ID (fallback when no block_id in response)
        metadata = short_id_lookup.get(short_id)
        if metadata:
            # Find the best matching block for this citation
            best_bbox = metadata.get('bbox')  # Fallback to chunk-level bbox
            best_block_info = None
            
            blocks = metadata.get('blocks', [])
            distinctive = _distinctive_values_from_cited_text(cited_text_for_bbox) if cited_text_for_bbox else []
            if blocks and isinstance(blocks, list) and len(blocks) > 0:
                # Distinctive values (e.g. £2,300,000, 12th February 2024) so we pick the block
                # that actually contains the cited figure, not a similar block (e.g. "180 days").
                best_match_score = 0

                for block_idx, block in enumerate(blocks):
                    if not isinstance(block, dict):
                        continue

                    block_content_lower = (block.get('content', '') or '').lower()
                    block_content_raw = (block.get('content', '') or '')
                    block_type = block.get('type', '').lower()
                    block_bbox = block.get('bbox')

                    if not block_content_lower or not isinstance(block_bbox, dict):
                        continue

                    # Skip headings/titles (they're usually not what we want to highlight)
                    if block_type in ['title', 'heading']:
                        continue

                    # When we have cited figures, skip blocks that look like footer/URL
                    # (e.g. "www.mjgroupint.com" or "United Kingdom - Spain - Portugal")
                    if distinctive and _block_looks_like_footer_or_url(block_content_raw):
                        continue

                    # Normalize block content for value check (remove spaces in numbers: "2 400 000" -> "2400000")
                    block_normalized = re.sub(r'(\d)\s+(\d)', r'\1\2', block_content_raw) if block_content_raw else ''

                    # Calculate match score based on keyword overlap
                    context_words = set(word for word in citation_context.split() if len(word) > 3)
                    block_words = set(word for word in block_content_lower.split() if len(word) > 3)
                    overlap = len(context_words & block_words)
                    match_score = overlap

                    if sentence_context:
                        sentence_words = set(word for word in sentence_context.split() if len(word) > 3)
                        sentence_overlap = len(sentence_words & block_words)
                        match_score += sentence_overlap * 2

                    if len(block_content_lower) > 50:
                        match_score += 1

                    if sentence_context and sentence_context in block_content_lower:
                        match_score += 10

                    # When the citation contains distinctive values (e.g. £2,300,000, 12th February 2024),
                    # only consider blocks that contain at least one of them. Otherwise we can highlight
                    # the wrong block (e.g. "Market Value... 180 days" or footer "www.mjgroupint.com").
                    if distinctive:
                        block_has_value = any(
                            val in block_content_raw or val in block_normalized
                            for val in distinctive
                        )
                        if not block_has_value:
                            continue  # skip this block
                        match_score += 100  # strong bonus for containing the cited value

                    if match_score > best_match_score:
                        best_match_score = match_score
                        best_bbox = block_bbox
                        best_block_info = {
                            'block_index': block_idx,
                            'block_type': block_type,
                            'content_preview': block.get('content', '')[:80],
                            'match_score': match_score,
                            'content': block.get('content', '') or '',
                        }
                
                # Narrow bbox to the line containing the cited text (avoid highlighting whole block)
                if best_block_info and cited_text_for_bbox and isinstance(best_bbox, dict):
                    block_content_for_narrow = best_block_info.get('content', '') or best_block_info.get('content_preview', '')
                    if block_content_for_narrow:
                        try:
                            narrowed = _narrow_bbox_to_cited_line(
                                block_content_for_narrow, best_bbox, cited_text_for_bbox
                            )
                            if narrowed and narrowed != best_bbox:
                                best_bbox = narrowed
                        except Exception as e:
                            logger.debug("Could not narrow bbox to cited line: %s", e)
                
                # Log block selection for debugging
                if best_block_info:
                    logger.info(
                        f"[CITATION_DEBUG] Citation {idx} (short_id={short_id}): "
                        f"Selected block {best_block_info['block_index']} "
                        f"(type={best_block_info['block_type']}, "
                        f"score={best_block_info['match_score']}, "
                        f"bbox={best_bbox is not None})"
                    )
                    logger.debug(
                        f"  Block content preview: '{best_block_info['content_preview']}...'"
                    )
                else:
                    logger.warning(
                        f"[CITATION_DEBUG] Citation {idx} (short_id={short_id}): "
                        f"No matching block found, using chunk-level bbox"
                    )
            
            # Ensure bbox is a dict (not None or invalid)
            if not isinstance(best_bbox, dict):
                logger.warning(f"Citation {idx}: bbox is not a dict (got {type(best_bbox)}), using fallback")
                best_bbox = None

            # Use page from the selected block's bbox when available (not chunk-level default).
            page_number = metadata.get('page_number', 0)
            if isinstance(best_bbox, dict) and best_bbox.get('page') is not None:
                try:
                    page_number = int(best_bbox.get('page', page_number))
                except (TypeError, ValueError):
                    pass

            # Citation number = order of appearance (1, 2, 3...) so UI shows [1], [2], [3].
            citation_number = idx

            chunk_id = metadata.get('chunk_id', '')
            block_index = best_block_info.get('block_index') if best_block_info else None
            block_id = f"chunk_{chunk_id or 'unknown'}_block_{block_index if block_index is not None else 0}" if (chunk_id or block_index is not None) else None

            # Debug payload: exact data used to choose this bbox (for citation mapping diagnosis)
            citation_debug = {
                'short_id': short_id,
                'citation_number': citation_number,
                'cited_text_for_bbox': cited_text_for_bbox,  # Exact sentence/markdown used for matching
                'distinctive_values': list(distinctive),
                'chosen_bbox': dict(best_bbox) if isinstance(best_bbox, dict) else None,
                'block_id': block_id,
                'block_index': block_index,
                'block_type': best_block_info.get('block_type') if best_block_info else None,
                'block_content_preview': (best_block_info.get('content', '') or best_block_info.get('content_preview', ''))[:300] if best_block_info else None,
                'match_score': best_block_info.get('match_score') if best_block_info else None,
                'source': 'block' if best_block_info else 'chunk',
                'num_blocks_considered': len(blocks) if blocks else 0,
            }
            
            citation = {
                'citation_number': citation_number,
                'short_id': short_id,
                'chunk_id': chunk_id,
                'position': start_position,
                'end_position': end_position,
                'bbox': best_bbox,  # Best matching block bbox or chunk-level bbox
                'page_number': page_number,  # From selected block when available
                'doc_id': metadata.get('doc_id'),
                'original_filename': metadata.get('original_filename', ''),
                'method': 'direct-id-extraction',
                'block_info': best_block_info,  # For debugging
                'cited_text': cited_text_for_bbox,  # For sub-level bbox: match exact line in block
                'citation_debug': citation_debug,
            }
            citations.append(citation)
            
            logger.info(
                f"[CITATION_DEBUG] Citation {idx} extracted: "
                f"doc_id={metadata.get('doc_id', '')[:8]}, "
                f"page={page_number}, "
                f"bbox_valid={isinstance(best_bbox, dict)}, "
                f"bbox_left={best_bbox.get('left', 'N/A') if isinstance(best_bbox, dict) else 'N/A'}, "
                f"bbox_top={best_bbox.get('top', 'N/A') if isinstance(best_bbox, dict) else 'N/A'}"
            )
        else:
            logger.warning(
                f"Short ID '{short_id}' not found in lookup. "
                f"Available IDs: {list(short_id_lookup.keys())}"
            )
    
    logger.info(f"[CITATION_DEBUG] Extracted {len(citations)} citations total")
    return citations


def format_chunks_with_block_ids(
    chunks_metadata: List[Dict[str, Any]]
) -> Tuple[str, Dict[str, Dict[str, Any]], Dict[str, Dict[str, Dict[str, Any]]]]:
    """
    Format chunks with block-level BLOCK_CITE_ID tags (jan28th-style) and build metadata lookup.
    The LLM sees each block with an id and must cite using [ID: X](BLOCK_CITE_ID_N).
    Returns:
        - formatted_text: [SOURCE_ID: 1] followed by <BLOCK id="BLOCK_CITE_ID_N">Content: ...</BLOCK> per block
        - short_id_lookup: short_id -> chunk metadata (for fallback when block_id missing)
        - metadata_lookup_tables: doc_id -> block_id -> { page, bbox_left, bbox_top, bbox_width, bbox_height, doc_id, original_filename }
    """
    formatted_parts = []
    short_id_lookup = {}
    metadata_lookup_tables = {}  # doc_id -> block_id -> metadata
    block_id_counter = 1

    for idx, chunk in enumerate(chunks_metadata, start=1):
        short_id = str(idx)
        chunk_id = chunk.get('chunk_id', '')
        chunk_text = chunk.get('chunk_text', '')
        doc_id = chunk.get('document_id', '')
        original_filename = chunk.get('document_filename', '') or ''
        page_number = chunk.get('page_number', 0)
        chunk_bbox = chunk.get('bbox')
        blocks = chunk.get('blocks', [])

        if not chunk_id or not chunk_text:
            continue

        # Ensure we have a metadata table for this doc
        if doc_id not in metadata_lookup_tables:
            metadata_lookup_tables[doc_id] = {}

        block_parts = []
        if blocks and isinstance(blocks, list):
            for block in blocks:
                if not isinstance(block, dict):
                    continue
                block_content = (block.get('content') or '').strip()
                if not block_content:
                    continue
                block_id = f"BLOCK_CITE_ID_{block_id_counter}"
                block_id_counter += 1
                block_parts.append(
                    f'<BLOCK id="{block_id}">\nContent: {block_content}\n</BLOCK>'
                )
                bbox = block.get('bbox') or {}
                bbox_left = float(bbox.get('left', 0)) if isinstance(bbox, dict) else 0.0
                bbox_top = float(bbox.get('top', 0)) if isinstance(bbox, dict) else 0.0
                bbox_width = float(bbox.get('width', 0)) if isinstance(bbox, dict) else 0.0
                bbox_height = float(bbox.get('height', 0)) if isinstance(bbox, dict) else 0.0
                block_page = bbox.get('page') if isinstance(bbox, dict) else page_number
                if block_page is None:
                    block_page = page_number
                metadata_lookup_tables[doc_id][block_id] = {
                    'page': int(block_page) if block_page is not None else 0,
                    'bbox_left': round(bbox_left, 4),
                    'bbox_top': round(bbox_top, 4),
                    'bbox_width': round(bbox_width, 4),
                    'bbox_height': round(bbox_height, 4),
                    'doc_id': doc_id,
                    'original_filename': original_filename,
                }
        if not block_parts:
            # No blocks: one block per chunk
            block_id = f"BLOCK_CITE_ID_{block_id_counter}"
            block_id_counter += 1
            block_parts.append(
                f'<BLOCK id="{block_id}">\nContent: {chunk_text}\n</BLOCK>'
            )
            bbox_left = bbox_top = bbox_width = bbox_height = 0.0
            if isinstance(chunk_bbox, dict):
                bbox_left = float(chunk_bbox.get('left', 0))
                bbox_top = float(chunk_bbox.get('top', 0))
                bbox_width = float(chunk_bbox.get('width', 0))
                bbox_height = float(chunk_bbox.get('height', 0))
            metadata_lookup_tables[doc_id][block_id] = {
                'page': int(page_number) if page_number is not None else 0,
                'bbox_left': round(bbox_left, 4),
                'bbox_top': round(bbox_top, 4),
                'bbox_width': round(bbox_width, 4),
                'bbox_height': round(bbox_height, 4),
                'doc_id': doc_id,
                'original_filename': original_filename,
            }

        formatted_parts.append(f"[SOURCE_ID: {short_id}]\n" + "\n".join(block_parts))
        short_id_lookup[short_id] = {
            'chunk_id': chunk_id,
            'short_id': short_id,
            'page_number': page_number,
            'bbox': chunk_bbox,
            'blocks': blocks,
            'doc_id': doc_id,
            'original_filename': original_filename,
            'chunk_text': chunk_text,
        }

    formatted_text = "\n\n---\n\n".join(formatted_parts)
    logger.info(
        f"[CITATION_DEBUG] Formatted chunks with block IDs: {block_id_counter - 1} blocks, "
        f"{len(metadata_lookup_tables)} docs"
    )
    return formatted_text, short_id_lookup, metadata_lookup_tables


def replace_ids_with_citation_numbers(
    llm_response: str, 
    citations: List[Dict[str, Any]]
) -> str:
    """
    Replace [ID: X] with [1], [2], [3] in the LLM response using position-based string slicing.
    
    This prevents "overlapping replacement" bugs by replacing from end to start,
    ensuring positions remain valid during replacement.
    
    Args:
        llm_response: Original LLM response with [ID: X] citations
        citations: List of citation dictionaries with position and citation_number
    
    Returns:
        Response text with [ID: X] replaced by [1], [2], [3], etc.
    """
    if not citations:
        return llm_response
    
    response = llm_response
    # Sort by position in reverse order (end to start) to avoid position shifting
    sorted_citations = sorted(
        citations, 
        key=lambda c: c.get('position', 0), 
        reverse=True
    )
    
    for citation in sorted_citations:
        start = citation.get('position', 0)
        end = citation.get('end_position', start)
        citation_number = citation.get('citation_number')
        
        if citation_number and start is not None and end is not None:
            # Safe position-based replacement
            response = (
                response[:start] + 
                f'[{citation_number}]' + 
                response[end:]
            )
    
    return response


def format_citations_for_frontend(
    citations: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Format citations for frontend consumption.
    
    Converts internal citation dictionaries to Citation TypedDict format expected by the frontend.
    Keeps every citation (one payload per in-text [1], [2], [3]) so numbers match the response.
    
    Args:
        citations: List of citation dictionaries (already with sequential citation_number 1,2,3...)
    
    Returns:
        List of Citation dictionaries for frontend
    """
    frontend_citations = []
    # Sort by position so order matches the response text
    sorted_citations = sorted(citations, key=lambda c: c.get('position', 0))

    for citation in sorted_citations:
        citation_number = citation.get('citation_number', 0)
        # Extract bbox data - only include if valid
        bbox_data = citation.get('bbox')
        bbox = None
        
        if isinstance(bbox_data, dict):
            # Validate bbox has required fields
            left = bbox_data.get('left')
            top = bbox_data.get('top')
            width = bbox_data.get('width')
            height = bbox_data.get('height')
            
            # Only create bbox if all required fields are present and valid
            if (left is not None and top is not None and 
                width is not None and height is not None and
                width > 0 and height > 0):
                bbox = {
                    'left': float(left),
                    'top': float(top),
                    'width': float(width),
                    'height': float(height),
                    'page': bbox_data.get('page', citation.get('page_number', 0)),
                    'original_page': bbox_data.get('original_page', citation.get('page_number', 0))
                }
            else:
                logger.debug(
                    f"Citation {citation.get('citation_number', '?')}: Invalid bbox values "
                    f"(left={left}, top={top}, width={width}, height={height}), skipping bbox"
                )
        
        # Citation mapping fix: pass through block_index from block_info and set block_id for frontend mapping/highlighting
        block_index = citation.get('block_index')
        if block_index is None and citation.get('block_info'):
            block_index = citation['block_info'].get('block_index')
        chunk_id = citation.get('chunk_id', '')
        block_id = citation.get('block_id')
        if not block_id and (chunk_id or block_index is not None):
            block_id = f"chunk_{chunk_id or 'unknown'}_block_{block_index if block_index is not None else 0}"

        # Create Citation TypedDict-compatible dictionary
        # Note: bbox can be None - frontend will handle opening document on correct page without highlighting
        frontend_citation: Dict[str, Any] = {
            'citation_number': citation_number,
            'chunk_id': chunk_id,
            'block_id': block_id,  # For citation mapping (frontend) - synthetic from chunk_id + block_index when needed
            'block_index': block_index,  # Pass through for views.py synthetic block_id when block_id missing
            'cited_text': citation.get('cited_text', '') or '',  # Include when available
            'bbox': bbox,  # Can be None if bbox data is missing/invalid
            'page_number': citation.get('page_number', 0),
            'doc_id': citation.get('doc_id', ''),
            'original_filename': citation.get('original_filename', ''),
            'confidence': 'high',  # Direct citations are high confidence
            'method': citation.get('method', 'direct-id-extraction'),
            'block_content': None,  # Not used in direct citation system
            'verification': None,  # Not used in direct citation system
            'matched_block_content': None,  # Not used in direct citation system
            'debug': citation.get('citation_debug'),  # For UI: bbox choice, cited text, block id, etc.
        }
        frontend_citations.append(frontend_citation)
    
    return frontend_citations


def validate_citations(
    citations: List[Dict[str, Any]], 
    short_id_lookup: Dict[str, Dict[str, Any]]
) -> bool:
    """
    Validate that all citations have valid short IDs in the lookup dictionary.
    
    Args:
        citations: List of citation dictionaries
        short_id_lookup: Dictionary mapping short_id -> full chunk metadata
    
    Returns:
        True if all citations are valid, False otherwise
    """
    if not citations:
        return True
    
    for citation in citations:
        short_id = citation.get('short_id')
        if not short_id or short_id not in short_id_lookup:
            logger.warning(f"Invalid citation: short_id '{short_id}' not found in lookup")
            return False
    
    return True


def extract_key_facts_from_text(text: str) -> List[Dict[str, Any]]:
    """
    Extract key facts (values, dates, names, amounts) from text.
    
    Only extracts distinct, high-value facts. Avoids generic patterns that create duplicates.
    
    Returns:
        List of facts with {'text': str, 'confidence': str, 'type': str, 'match_start': int, 'match_end': int}
    """
    facts = []
    seen_matches = set()  # Track match positions to avoid overlaps
    
    # Extract monetary values - ONLY specific patterns (no generic amounts)
    value_patterns = [
        (r'Market Value[:\s]+£?([\d,]+\.?\d*)', 'Market Value', 40),
        (r'90[- ]day[:\s]+value[:\s]+£?([\d,]+\.?\d*)', '90-day value', 40),
        (r'180[- ]day[:\s]+value[:\s]+£?([\d,]+\.?\d*)', '180-day value', 40),
        (r'Market Rent[:\s]+£?([\d,]+\.?\d*)', 'Market Rent', 40),
        (r'rent[:\s]+£?([\d,]+\.?\d*)\s*(?:per\s+)?(?:calendar\s+)?month', 'Monthly Rent', 50),
        (r'KSH\s+([\d,]+\.?\d*)', 'KSH Amount', 30),  # Kenyan Shillings
        (r'KSHS\s+([\d,]+\.?\d*)', 'KSHS Amount', 30),
    ]
    
    for pattern, label, context_size in value_patterns:
        matches = list(re.finditer(pattern, text, re.IGNORECASE))
        for match in matches:
            match_key = (match.start(), match.end())
            # Skip if this position was already matched
            if any(start <= match.start() < end or start < match.end() <= end 
                   for start, end in seen_matches):
                continue
            
            seen_matches.add(match_key)
            # Use capturing group as value when present to avoid context-window leakage (e.g. markdown)
            if match.lastindex and match.lastindex >= 1:
                value_text = (match.group(1) or '').strip()
            else:
                start = max(0, match.start() - context_size)
                end = min(len(text), match.end() + context_size)
                value_text = text[start:end].strip()
            if not value_text:
                continue
            facts.append({
                'text': value_text,
                'confidence': 'high',
                'type': 'value',
                'label': label,
                'match_start': match.start(),
                'match_end': match.end()
            })
    
    # Extract dates - ONLY specific date patterns
    date_patterns = [
        (r'Valuation date[:\s]+(\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4})', 'Valuation date', 30),
        (r'(\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4})', 'Date', 20),  # Generic date (but only if not already matched)
    ]
    
    for pattern, label, context_size in date_patterns:
        matches = list(re.finditer(pattern, text, re.IGNORECASE))
        for match in matches:
            match_key = (match.start(), match.end())
            # Skip if this position was already matched
            if any(start <= match.start() < end or start < match.end() <= end 
                   for start, end in seen_matches):
                continue
            
            seen_matches.add(match_key)
            if match.lastindex and match.lastindex >= 1:
                value_text = (match.group(1) or '').strip()
            else:
                start = max(0, match.start() - context_size)
                end = min(len(text), match.end() + context_size)
                value_text = text[start:end].strip()
            if not value_text:
                continue
            facts.append({
                'text': value_text,
                'confidence': 'high',
                'type': 'date',
                'label': label,
                'match_start': match.start(),
                'match_end': match.end()
            })
    
    # Extract names - ONLY specific name patterns
    name_patterns = [
        (r'Valuer[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+(?:\s+MRICS)?)', 'Valuer', 20),
        (r'conducted by[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+(?:\s+MRICS)?)', 'Conducted by', 20),
    ]
    
    for pattern, label, context_size in name_patterns:
        matches = list(re.finditer(pattern, text, re.IGNORECASE))
        for match in matches:
            match_key = (match.start(), match.end())
            # Skip if this position was already matched
            if any(start <= match.start() < end or start < match.end() <= end 
                   for start, end in seen_matches):
                continue
            
            seen_matches.add(match_key)
            if match.lastindex and match.lastindex >= 1:
                value_text = (match.group(1) or '').strip()
            else:
                start = max(0, match.start() - context_size)
                end = min(len(text), match.end() + context_size)
                value_text = text[start:end].strip()
            if not value_text:
                continue
            facts.append({
                'text': value_text,
                'confidence': 'high',
                'type': 'name',
                'label': label,
                'match_start': match.start(),
                'match_end': match.end()
            })
    
    # Month YYYY dates (e.g. "February 2024") - common in reports
    month_year_patterns = [
        (r'(\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b', 'Date', 15),
    ]
    for pattern, label, context_size in month_year_patterns:
        matches = list(re.finditer(pattern, text, re.IGNORECASE))
        for match in matches:
            match_key = (match.start(), match.end())
            if any(start <= match.start() < end or start < match.end() <= end for start, end in seen_matches):
                continue
            seen_matches.add(match_key)
            if match.lastindex and match.lastindex >= 1:
                value_text = (match.group(1) or '').strip()
            else:
                start = max(0, match.start() - context_size)
                end = min(len(text), match.end() + context_size)
                value_text = text[start:end].strip()
            if not value_text:
                continue
            facts.append({
                'text': value_text,
                'confidence': 'high',
                'type': 'date',
                'label': label,
                'match_start': match.start(),
                'match_end': match.end()
            })
    
    # UK address / postcode (e.g. "..., Town, POSTCODE" or standalone postcode)
    uk_postcode = r'[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}'
    address_patterns = [
        (rf'(Address[:\s]+(.{{10,80}}?{uk_postcode}))', 'Address', 0),  # "Address: ... CM23 1AB"
        (rf'((?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,?\s+){{1,4}},?\s*{uk_postcode})', 'Location', 0),  # "..., Town, CM23 1AB"
        (rf'(\b{uk_postcode}\b)', 'Postcode', 20),
    ]
    for pattern, label, context_size in address_patterns:
        matches = list(re.finditer(pattern, text, re.IGNORECASE))
        for match in matches:
            match_key = (match.start(), match.end())
            if any(start <= match.start() < end or start < match.end() <= end for start, end in seen_matches):
                continue
            seen_matches.add(match_key)
            if match.lastindex and match.lastindex >= 1:
                value_text = (match.group(1) or '').strip()
            else:
                start = max(0, match.start() - context_size)
                end = min(len(text), match.end() + context_size)
                value_text = text[start:end].strip()
            # Normalise whitespace and cap length for display
            if len(value_text) > 80:
                value_text = value_text[:77].rstrip() + '…'
            if not value_text:
                continue
            facts.append({
                'text': value_text,
                'confidence': 'high',
                'type': 'address',
                'label': label,
                'match_start': match.start(),
                'match_end': match.end()
            })
    
    # Fallback: if we have substantial text but no structured facts, add first meaningful line as "Summary"
    if not facts and len(text.strip()) > 100:
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        for line in lines[:3]:
            if len(line) >= 20 and len(line) <= 120 and not line.startswith(('•', '-', '*', '1.', '2.')):
                facts.append({
                    'text': line,
                    'confidence': 'low',
                    'type': 'summary',
                    'label': 'Summary',
                    'match_start': 0,
                    'match_end': len(line)
                })
                break
            if 20 <= len(line) <= 120:
                facts.append({
                    'text': line[:100] + ('…' if len(line) > 100 else ''),
                    'confidence': 'low',
                    'type': 'summary',
                    'label': 'Summary',
                    'match_start': 0,
                    'match_end': min(100, len(line))
                })
                break
    
    # Sort by match position to maintain order
    facts.sort(key=lambda x: x.get('match_start', 0))
    
    return facts


# ============================================================================
# Evidence-First Citation Architecture Functions
# MOVED TO: backend.llm.citation modules
# ============================================================================

# All citation functions have been moved to:
# - backend.llm.citation.document_store
# - backend.llm.citation.evidence_extractor
# - backend.llm.citation.evidence_registry
# - backend.llm.citation.citation_mapper

# All citation functions have been moved to backend.llm.citation modules
# Functions removed:
# - fetch_chunk_blocks -> backend.llm.citation.document_store
# - extract_atomic_facts_from_block -> backend.llm.citation.evidence_extractor
# - extract_clause_evidence_from_block -> backend.llm.citation.evidence_extractor
# - extract_evidence_blocks_from_chunks -> backend.llm.citation.evidence_extractor
# - deduplicate_evidence_blocks -> backend.llm.citation.evidence_registry
# - rank_evidence_by_relevance -> backend.llm.citation.evidence_registry
# - create_evidence_registry -> backend.llm.citation.evidence_registry
# - format_evidence_table_for_llm -> backend.llm.citation.evidence_registry
# - extract_citations_from_answer_text -> backend.llm.citation.citation_mapper
# - map_citation_numbers_to_citations -> backend.llm.citation.citation_mapper
# - deduplicate_and_renumber_citations -> backend.llm.citation.citation_mapper


# ============================================================================
# Phase 4: Two-Pass Answer Generation
# ============================================================================

async def generate_evidence_selection(
    user_query: str,
    evidence_table: str,
    citation_num_to_evidence_id: Dict[int, str]
) -> EvidenceSelectionOutput:
    """
    Pass 1: Machine-like evidence selection.
    
    Token budget: ~500 tokens per call
    - System prompt: ~200 tokens
    - Human message: ~300 tokens (query + evidence table)
    
    LLM task:
    - Parse user query
    - Match query parts to evidence items
    - Return structured claims with citations
    
    NO prose. NO Markdown. NO creativity.
    """
    system_prompt_content = get_responder_fact_mapping_system_prompt()
    human_message_content = get_responder_fact_mapping_human_prompt(user_query, evidence_table)

    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,  # Deterministic
    )
    
    structured_llm = llm.with_structured_output(EvidenceSelectionOutput)
    
    response = await structured_llm.ainvoke([
        SystemMessage(content=system_prompt_content),
        HumanMessage(content=human_message_content)
    ])
    
    return response

# All citation functions have been moved to backend.llm.citation modules
# These duplicate definitions have been removed - use imports from citation module instead


# Removed duplicate functions - now imported from backend.llm.citation:
# - extract_clause_evidence_from_block
# - extract_evidence_blocks_from_chunks
# - deduplicate_evidence_blocks
# - rank_evidence_by_relevance
# - create_evidence_registry
# - format_evidence_table_for_llm
# All these functions are now imported from backend.llm.citation module above


# ============================================================================
# Phase 4: Two-Pass Answer Generation
# ============================================================================

# Removed duplicate functions - now imported from backend.llm.citation:
# - deduplicate_evidence_blocks
# - rank_evidence_by_relevance
# - create_evidence_registry  
# - format_evidence_table_for_llm


# ============================================================================
# Phase 4: Two-Pass Answer Generation
# ============================================================================

async def generate_evidence_selection(
    user_query: str,
    evidence_table: str,
    citation_num_to_evidence_id: Dict[int, str]
) -> EvidenceSelectionOutput:
    """
    Pass 1: Machine-like evidence selection.
    
    Token budget: ~500 tokens per call
    - System prompt: ~200 tokens
    - Human message: ~300 tokens (query + evidence table)
    
    LLM task:
    - Parse user query
    - Match query parts to evidence items
    - Return structured claims with citations
    
    NO prose. NO Markdown. NO creativity.
    """
    system_prompt_content = get_responder_fact_mapping_system_prompt()
    human_message_content = get_responder_fact_mapping_human_prompt(user_query, evidence_table)

    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,  # Deterministic
    )
    
    structured_llm = llm.with_structured_output(EvidenceSelectionOutput)
    
    response = await structured_llm.ainvoke([
        SystemMessage(content=system_prompt_content),
        HumanMessage(content=human_message_content)
    ])
    
    return response


async def generate_natural_language_answer(
    user_query: str,
    evidence_selection: EvidenceSelectionOutput,
    evidence_table: str
) -> NaturalLanguageOutput:
    """
    Pass 2: Natural language rendering.
    
    Token budget: ~1100 tokens per call
    - System prompt: ~300 tokens
    - Human message: ~800 tokens (query + claims + evidence ref)
    
    LLM task:
    - Convert structured claims into conversational prose
    - Embed citation numbers naturally
    - Format with Markdown
    
    DO NOT add or remove facts.
    """
    # Format claims for prompt (~500 tokens max for 10 claims)
    claims_text = "\n".join([
        f"- {claim.claim} [citations: {', '.join(map(str, claim.citations))}]"
        for claim in evidence_selection.facts
    ])
    
    system_prompt_content = get_responder_natural_language_system_prompt()
    human_message_content = get_responder_natural_language_human_prompt(
        user_query, claims_text, evidence_table
    )

    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0.3,  # Slight creativity for prose
    )
    
    structured_llm = llm.with_structured_output(NaturalLanguageOutput)
    
    # Invoke
    response = await structured_llm.ainvoke([
        SystemMessage(content=system_prompt_content),
        HumanMessage(content=human_message_content)
    ])
    
    return response


# ============================================================================
# Phase 4: Structured LLM Output with Evidence IDs (Legacy - Single-Pass)
# ============================================================================

async def generate_answer_with_evidence_ids(
    user_query: str,
    chunks_metadata: List[Dict[str, Any]],
    evidence_registry: Dict[str, EvidenceBlock],
    request_id: str,
    evidence_table: str,
    citation_num_to_evidence_id: Dict[int, str]
) -> Dict[str, Any]:
    """
    Generate answer with citation numbers [1], [2], [3] using two-pass approach.
    
    Total token budget: ~1600 tokens
    - Pass 1: ~500 tokens (evidence selection)
    - Pass 2: ~1100 tokens (natural language rendering)
    
    This ensures perfect citation accuracy by separating fact selection from prose generation.
    
    Args:
        user_query: User's question
        chunks_metadata: List of chunks with chunk_id, chunk_text, document_id
        evidence_registry: Dict mapping evidence_id -> EvidenceBlock
        request_id: UUID for request-scoped evidence IDs
        evidence_table: Pre-formatted evidence table string with citation numbers
        citation_num_to_evidence_id: Dict mapping citation_number (1, 2, 3...) -> evidence_id
        
    Returns:
        Dict with 'answer', 'citations', and 'unsupported_claims' keys:
        {
            "answer": str,  # Answer text with citation numbers embedded (e.g., "The value is [AMOUNT] [1]")
            "citations": List[int]  # Array of citation numbers used (e.g., [1, 2, 3])
            "unsupported_claims": List[str]  # Claims user asked about with no supporting evidence
        }
    """
    # Pass 1: Evidence selection (~500 tokens)
    logger.info("[EVIDENCE] Pass 1: Evidence selection...")
    evidence_selection = await generate_evidence_selection(
        user_query,
        evidence_table,
        citation_num_to_evidence_id
    )
    
    # Validate: Check for hallucinations
    if evidence_selection.unsupported_claims:
        logger.warning(
            f"[EVIDENCE] ⚠️ Unsupported claims detected: {evidence_selection.unsupported_claims}"
        )
    
    # Pass 2: Natural language rendering (~1100 tokens)
    logger.info("[EVIDENCE] Pass 2: Natural language rendering...")
    natural_language = await generate_natural_language_answer(
        user_query,
        evidence_selection,
        evidence_table
    )
    
    return {
        "answer": natural_language.answer,
        "citations": natural_language.citations,  # List[int]
        "unsupported_claims": evidence_selection.unsupported_claims
    }


# All citation mapping functions moved to backend.llm.citation.citation_mapper

def map_evidence_ids_to_citations(
    llm_output: Dict[str, Any],
    evidence_registry: Dict[str, EvidenceBlock],
    request_id: str
) -> Tuple[List[Citation], Dict[str, int]]:
    """
    Map evidence IDs from LLM output to Citation objects.
    
    Args:
        llm_output: Dict with 'answer' and 'citations' keys
        evidence_registry: Dict mapping evidence_id -> EvidenceBlock
        request_id: UUID for constructing full evidence IDs
        
    Returns:
        Tuple of:
        - List of Citation objects with exact bbox coordinates
        - Dict mapping evidence_id (e.g., "E1") -> citation_number (e.g., 1)
    """
    citations = []
    citation_number = 1
    evidence_id_to_citation_num = {}  # Map "E1" -> 1, "E2" -> 2, etc.
    
    evidence_ids = llm_output.get('citations', [])
    if not evidence_ids:
        logger.warning("[EVIDENCE] No citations found in LLM output")
        return citations, evidence_id_to_citation_num
    
    for evidence_id in evidence_ids:
        # Strip any whitespace
        evidence_id = evidence_id.strip()
        
        # Store mapping from evidence_id to citation_number (for text replacement)
        evidence_id_to_citation_num[evidence_id] = citation_number
        
        # Construct full evidence ID with request_id prefix
        if not evidence_id.startswith(request_id):
            # LLM only sees "E1", "E2", etc., so we need to add request_id prefix
            full_evidence_id = f"{request_id}:{evidence_id}"
        else:
            full_evidence_id = evidence_id
        
        # Look up EvidenceBlock in registry
        evidence_block = evidence_registry.get(full_evidence_id)
        
        if not evidence_block:
            logger.warning(
                f"[EVIDENCE] Evidence ID '{evidence_id}' (full: '{full_evidence_id}') not found in registry. "
                f"Available IDs: {list(evidence_registry.keys())[:5]}..."
            )
            continue
        
        # Create Citation object with exact bbox from EvidenceBlock
        citation: Citation = {
            'citation_number': citation_number,
            'chunk_id': evidence_block.chunk_id,
            'block_index': evidence_block.block_index,
            'block_id': None,  # Not used in evidence-id-mapping method
            'cited_text': evidence_block.text_preview,  # Use preview for display
            'bbox': evidence_block.bbox.copy(),  # Exact copy from Parse block
            'page_number': evidence_block.page,
            'doc_id': evidence_block.doc_id,
            'original_filename': None,  # Will be added later
            'confidence': 'high',  # Deterministic mapping
            'method': 'evidence-id-mapping',
            'block_content': evidence_block.exact_text,  # Store exact text for verification
            'verification': None,
            'matched_block_content': evidence_block.exact_text
        }
        
        citations.append(citation)
        citation_number += 1
    
    logger.info(f"[EVIDENCE] Mapped {len(citations)} citations from {len(evidence_ids)} evidence IDs")
    return citations, evidence_id_to_citation_num


def pre_extract_citation_candidates(chunks_metadata: List[Dict[str, Any]]) -> List[Citation]:
    """
    Pre-extract citation candidates from chunks by identifying key facts.
    
    This function:
    1. Iterates through all chunks
    2. Identifies key facts (values, dates, names, amounts, etc.) in each block
    3. Creates citation objects with bbox coordinates immediately
    4. Deduplicates citations from the same block/chunk
    5. Numbers them sequentially
    
    Returns:
        List of pre-created Citation objects with citation_number, chunk_id, 
        block_index, cited_text, bbox, page, doc_id, etc.
    """
    citations: List[Citation] = []
    citation_number = 1
    
    # Track citations by (chunk_id, block_index, cited_text_normalized) to avoid duplicates
    seen_citations = set()
    
    supabase = get_supabase_client()
    
    for chunk in chunks_metadata:
        chunk_id = chunk.get('chunk_id')
        doc_id = chunk.get('document_id')
        
        if not chunk_id or not doc_id:
            continue
        
        try:
            # Fetch chunk blocks from database
            response = supabase.table('document_vectors').select(
                'id, document_id, blocks, page_number, bbox'
            ).eq('id', chunk_id).single().execute()
            
            if not response.data:
                logger.warning(f"[CITATION_PRE_EXTRACT] Chunk {chunk_id[:20]}... not found in database")
                continue
            
            chunk_data = response.data
            blocks = chunk_data.get('blocks', [])
            
            if not blocks:
                # Fallback: create citation from chunk-level bbox
                chunk_bbox = chunk_data.get('bbox', {})
                page = chunk_data.get('page_number', chunk_bbox.get('page', 0))
                
                # Extract key facts from chunk_text using regex/pattern matching
                chunk_text = chunk.get('chunk_text', '')
                facts = extract_key_facts_from_text(chunk_text)
                
                # Limit to max 3 facts per chunk (if no blocks)
                facts = facts[:3]
                
                for fact in facts:
                    # Normalize cited_text for deduplication
                    cited_text_normalized = fact['text'].lower().strip()[:100]  # First 100 chars
                    citation_key = (chunk_id, None, cited_text_normalized)
                    
                    if citation_key in seen_citations:
                        continue
                    
                    seen_citations.add(citation_key)
                    
                    citation: Citation = {
                        'citation_number': citation_number,
                        'chunk_id': chunk_id,
                        'block_id': None,
                        'block_index': None,
                        'cited_text': fact['text'],
                        'bbox': {
                            'left': round(float(chunk_bbox.get('left', 0.0)), 4),
                            'top': round(float(chunk_bbox.get('top', 0.0)), 4),
                            'width': round(float(chunk_bbox.get('width', 0.0)), 4),
                            'height': round(float(chunk_bbox.get('height', 0.0)), 4),
                            'page': int(page) if page is not None else 0
                        },
                        'page_number': int(page) if page is not None else 0,
                        'doc_id': doc_id,
                        'original_filename': None,  # Will be filled later
                        'confidence': 'medium',  # Chunk-level is less precise
                        'method': 'pre-extracted-chunk-level',
                        'block_content': None,
                        'verification': None,
                        'matched_block_content': None
                    }
                    citations.append(citation)
                    citation_number += 1
            else:
                # Extract citations from each block
                for block_index, block in enumerate(blocks):
                    block_content = block.get('content', '')
                    if not block_content:
                        continue
                    
                    # Extract key facts from this block
                    facts = extract_key_facts_from_text(block_content)
                    
                    # Limit to max 2 facts per block to avoid over-citation
                    facts = facts[:2]
                    
                    for fact in facts:
                        # Normalize cited_text for deduplication
                        cited_text_normalized = fact['text'].lower().strip()[:100]  # First 100 chars
                        citation_key = (chunk_id, block_index, cited_text_normalized)
                        
                        if citation_key in seen_citations:
                            continue
                        
                        seen_citations.add(citation_key)
                        
                        block_bbox = block.get('bbox', {})
                        page = block_bbox.get('page', chunk_data.get('page_number', 0))
                        
                        citation: Citation = {
                            'citation_number': citation_number,
                            'chunk_id': chunk_id,
                            'block_id': None,
                            'block_index': block_index,
                            'cited_text': fact['text'],
                            'bbox': {
                                'left': round(float(block_bbox.get('left', 0.0)), 4),
                                'top': round(float(block_bbox.get('top', 0.0)), 4),
                                'width': round(float(block_bbox.get('width', 0.0)), 4),
                                'height': round(float(block_bbox.get('height', 0.0)), 4),
                                'page': int(page) if page is not None else 0
                            },
                            'page_number': int(page) if page is not None else 0,
                            'doc_id': doc_id,
                            'original_filename': None,  # Will be filled later
                            'matched_block_content': block_content,
                            'confidence': fact.get('confidence', 'high'),
                            'method': 'pre-extracted-block-level',
                            'block_content': None,
                            'verification': None
                        }
                        citations.append(citation)
                        citation_number += 1
                        
        except Exception as e:
            logger.error(f"[CITATION_PRE_EXTRACT] Error extracting citations from chunk {chunk_id[:20] if chunk_id else 'UNKNOWN'}...: {e}", exc_info=True)
            continue
    
    logger.info(f"[CITATION_PRE_EXTRACT] ✅ Pre-extracted {len(citations)} distinct citation candidates (deduplicated)")
    return citations


def format_pre_created_citations(citations: List[Citation]) -> str:
    """
    Format pre-created citations for LLM to reference.
    
    Returns:
        Formatted string showing available citations with their numbers
    """
    if not citations:
        return ""
    
    citation_lines = []
    citation_lines.append("**Available Citations (use citation numbers in your answer):**\n")
    
    for citation in citations:
        citation_num = citation.get('citation_number', 0)
        cited_text = citation.get('cited_text', '')
        # Truncate for display but keep enough context
        if len(cited_text) > 100:
            cited_text = cited_text[:100] + "..."
        
        citation_lines.append(f"[{citation_num}] {cited_text}")
    
    return "\n".join(citation_lines)


async def generate_conversational_answer_with_citations(
    user_query: str,
    chunks_metadata: List[Dict[str, Any]]
) -> Tuple[str, List]:
    """
    Generate conversational answer with citation tool access.
    
    This function:
    - Formats chunks with chunk_ids visible to LLM
    - Gives LLM access to match_citation_to_chunk tool
    - LLM calls tool with exact text from chunks
    - Extracts citations from tool calls
    
    Args:
        user_query: User's question
        chunks_metadata: List of chunks with chunk_id, chunk_text, document_id
    
    Returns:
        Tuple of (answer_text, citations_list)
    """
    # NOTE: This is a fallback function using tool-based citations
    main_tagging_rule = _get_main_answer_tagging_rule()
    system_prompt_content = get_responder_conversational_tool_citations_system_prompt(main_tagging_rule)
    system_prompt = SystemMessage(content=system_prompt_content)
    
    # Create citation tool
    citation_tool = create_chunk_citation_tool()
    
    # Create LLM with citation tool
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    ).bind_tools([citation_tool], tool_choice="auto")
    
    # NOTE: Raw chunk text removed - LLM will use citation tool based on question and chunks_metadata
    # This fallback function is used when evidence extraction fails
    # The citation tool has access to chunk data internally
    human_message = HumanMessage(content=f"""User question: {user_query}

⚠️ IMPORTANT: 
- Answer the user's question using the citation tool to cite information from chunks
- **ANY information you use from chunks MUST be cited** - whether it's a fact, explanation, definition, or any other type of information
- For EVERY piece of information you mention that comes from chunks, call match_citation_to_chunk
- The citation tool will search chunks for the exact text you provide
- Call match_citation_to_chunk BEFORE finishing your answer
- **CRITICAL**: Include citation numbers [1], [2], [3] immediately after each piece of information from chunks - place them inline, not at the end
  * Example: "<<<MAIN>>>[AMOUNT]<<<END_MAIN>>> is the property value [1]. This represents the purchase price [1]. <<<MAIN>>>[AMOUNT]<<<END_MAIN>>> is the deposit [2]."
  * Number citations sequentially starting from [1]
  * **DO NOT** put all citations at the end - each citation must appear right after its corresponding information

Provide a helpful, conversational answer using Markdown formatting:
- Use `##` for main section headings, `###` for subsections
- Use `**bold**` for emphasis or labels
- Use `-` for bullet points when listing items
- Use line breaks between sections for better readability
- Put any closing or follow-up only at the very end after a blank line; never at the start or after the first heading.
- Extract and present information directly from the excerpts if it is present
- Only say information is not found if it is genuinely not in the excerpts
- Include appropriate context based on question type
- Is professional and polite
- Never mentions documents, files, or retrieval steps

Answer (use Markdown formatting for structure and clarity):""")
    
    # Invoke LLM
    logger.info(f"[RESPONDER] Invoking LLM with {len(chunks_metadata)} chunks (with citation tool)")
    response = await llm.ainvoke([system_prompt, human_message])
    
    # Extract answer text
    answer_text = response.content if hasattr(response, 'content') and response.content else ""
    
    # Initialize messages list for tool execution
    messages = [system_prompt, human_message, response]
    citations = []
    
    # If LLM made tool calls, execute them
    if hasattr(response, 'tool_calls') and response.tool_calls:
        logger.info(f"[RESPONDER] LLM made {len(response.tool_calls)} tool call(s) for citations")
        
        # Execute tool calls using ToolNode
        tool_node = ToolNode([citation_tool])
        tool_state = {"messages": messages}
        tool_result = await tool_node.ainvoke(tool_state)
        
        # Add tool results to messages
        if "messages" in tool_result:
            messages.extend(tool_result["messages"])
        
        # Extract citations from tool results
        citations = extract_chunk_citations_from_messages(messages)
        if citations:
            logger.info(f"[RESPONDER] ✅ Extracted {len(citations)} citations from tool calls")
            for i, citation in enumerate(citations, 1):
                logger.debug(
                    f"[RESPONDER] Citation {i}: chunk_id={citation.get('chunk_id', '')[:20]}..., "
                    f"page={citation.get('page_number', 0)}, confidence={citation.get('confidence', 'low')}"
                )
    
    # If no answer text but we have tool calls, we might need to continue the conversation
    if not answer_text and hasattr(response, 'tool_calls') and response.tool_calls:
        # LLM made tool calls but no text - continue to get answer
        logger.info("[RESPONDER] LLM made tool calls but no answer text, continuing conversation...")
        continue_response = await llm.ainvoke(messages)
        answer_text = continue_response.content if hasattr(continue_response, 'content') and continue_response.content else ""
        messages.append(continue_response)
        
        # Check for more tool calls
        if hasattr(continue_response, 'tool_calls') and continue_response.tool_calls:
            tool_node = ToolNode([citation_tool])
            tool_state = {"messages": messages}
            tool_result = await tool_node.ainvoke(tool_state)
            if "messages" in tool_result:
                messages.extend(tool_result["messages"])
            citations = extract_chunk_citations_from_messages(messages)

    answer_text = _strip_mid_response_generic_closings(answer_text)
    return answer_text, citations


async def generate_conversational_answer_with_pre_citations(
    user_query: str,
    chunks_metadata: List[Dict[str, Any]],
    pre_created_citations: List[Citation]
) -> Tuple[str, List[Citation]]:
    """
    Generate answer with pre-created citations.
    
    LLM just references citation numbers [1], [2], [3] - no tool calling needed.
    
    Args:
        user_query: User's question
        chunks_metadata: List of chunks with chunk_id, chunk_text, document_id
        pre_created_citations: Pre-extracted citations with citation numbers
    
    Returns:
        Tuple of (answer_text, citations_list)
    """
    citations_display = format_pre_created_citations(pre_created_citations)
    main_tagging_rule = _get_main_answer_tagging_rule()
    system_prompt_content = get_responder_conversational_pre_citations_system_prompt(main_tagging_rule)
    system_prompt = SystemMessage(content=system_prompt_content)
    
    # Create LLM WITHOUT citation tool (not needed - citations are pre-created)
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )
    
    # NOTE: Raw chunk text removed - using pre-created citations only
    # This fallback function is used when evidence extraction fails
    human_message = HumanMessage(content=f"""User question: {user_query}

{citations_display}

⚠️ IMPORTANT: 
- **ANY information you use from chunks MUST be cited** - whether it's a fact, explanation, definition, or any other type of information
- Use the citation numbers [1], [2], [3] shown above when you reference ANY information from chunks
- Do NOT call any tools - citations are pre-created
- Include citation numbers immediately after the information you're citing
- Example: "<<<MAIN>>>[AMOUNT]<<<END_MAIN>>> is the property value [1]. This represents the purchase price [1] located at [ADDRESS] [2]."

Provide a helpful, conversational answer using Markdown formatting:
- Use `##` for main section headings, `###` for subsections
- Use `**bold**` for emphasis or labels
- Use `-` for bullet points when listing items
- Use line breaks between sections for better readability
- Put any closing or follow-up only at the very end after a blank line; never at the start or after the first heading.
- Extract and present information directly from the excerpts if it is present
- Only say information is not found if it is genuinely not in the excerpts
- Include appropriate context based on question type
- Is professional and polite
- Never mentions documents, files, or retrieval steps

Answer (use Markdown formatting for structure and clarity):""")
    
    # Invoke LLM
    logger.info(f"[RESPONDER] Invoking LLM with {len(chunks_metadata)} chunks and {len(pre_created_citations)} pre-created citations")
    response = await llm.ainvoke([system_prompt, human_message])
    
    # Extract answer text and move any closing line that appeared mid-response to the end
    answer_text = response.content if hasattr(response, 'content') and response.content else ""
    answer_text = _strip_mid_response_generic_closings(answer_text)

    # Return answer and pre-created citations (already numbered)
    return answer_text, pre_created_citations


def _build_metadata_table_section(metadata_lookup_tables: Dict[str, Dict[str, Dict[str, Any]]]) -> str:
    """Build the Metadata Look-Up Table section for the prompt (jan28th-style)."""
    if not metadata_lookup_tables:
        return ""
    lines = [
        "",
        "--- Metadata Look-Up Table ---",
        "Block IDs below map to bbox coordinates. When you cite a fact, use the block id from the <BLOCK> tag that contains that fact.",
        ""
    ]
    for doc_id, table in metadata_lookup_tables.items():
        doc_short = (doc_id[:12] + "...") if len(doc_id) > 12 else doc_id
        lines.append(f"Document {doc_short}:")
        limited = list(sorted(table.items()))[:MAX_BLOCKS_PER_DOC_IN_PROMPT]
        for block_id, meta in limited:
            p = meta.get("page", 0)
            l_ = meta.get("bbox_left", 0)
            t = meta.get("bbox_top", 0)
            w = meta.get("bbox_width", 0)
            h = meta.get("bbox_height", 0)
            lines.append(f"  {block_id}: page={p}, bbox=({l_:.4f},{t:.4f},{w:.4f},{h:.4f})")
        lines.append("")
    return "\n".join(lines)


async def generate_conversational_answer_with_citations(
    user_query: str,
    formatted_chunks: str,
    metadata_lookup_tables: Optional[Dict[str, Dict[str, Dict[str, Any]]]] = None,
    previous_personality: Optional[str] = None,
    is_first_message: bool = False,
    user_id: Optional[str] = None,
    workspace_section: str = "",
    paste_context: str = "",
) -> Tuple[str, str]:
    """
    Generate conversational answer with citation instructions (jan28th-style).
    The LLM sees content with <BLOCK id="BLOCK_CITE_ID_N"> and must cite as [ID: X](BLOCK_CITE_ID_N).
    Also chooses personality for this turn and returns (personality_id, answer_text).
    When paste_context is non-empty (paste+other-docs path), the LLM gets pasted/attached content
    plus retrieved document content; cite only the document content (block IDs).
    """
    # Temperature 0.38: slight increase for more natural variation; revert if responses become inconsistent or repetitive (see plan: conversational responses).
    llm = ChatOpenAI(
        model=config.openai_model,
        temperature=0.38,
        max_tokens=4096  # Avoid mid-sentence cutoff; 2000 was too low for full answers
    )

    metadata_section = _build_metadata_table_section(metadata_lookup_tables or {})

    personality_context = f"""
Previous personality for this conversation (or None if first message): {previous_personality or 'None'}
Is this the first message in the conversation? {is_first_message}
"""
    system_content = get_responder_block_citation_system_content(personality_context)

    if workspace_section:
        system_content = system_content + "\n\n" + workspace_section

    # --- Mem0 memory injection (Phase 2) ---
    if getattr(config, "mem0_enabled", False):
        try:
            from backend.services.memory_service import velora_memory
            _mem_results = await velora_memory.search(
                query=user_query,
                user_id=user_id or "anonymous",
                limit=getattr(config, "mem0_search_limit", 5),
            )
            _mem_text = format_memories_section(_mem_results)
            if _mem_text:
                system_content = system_content + "\n" + _mem_text
                logger.info(f"[RESPONDER] Injected {len(_mem_results)} memories")
        except Exception as _mem_err:
            logger.warning(f"[RESPONDER] Memory search failed: {_mem_err}")

    system_prompt = SystemMessage(content=system_content)

    paste_section = ""
    if paste_context and paste_context.strip():
        paste_section = f"""
**Pasted/attached content (use for context; cite only the document content below with block IDs):**
{paste_context.strip()}

"""
    doc_section = f"""**Document content from search (each fact is inside a <BLOCK id="..."> tag):**

{formatted_chunks}
{metadata_section}
"""
    instructions = "- Answer based on the content above. For each fact you use, cite it as [ID: X](BLOCK_CITE_ID_N) where the block id is from the <BLOCK> whose content actually contains that fact (e.g. the block with \"56\" and \"D\" for EPC current rating)."
    if paste_section:
        instructions = "- Use both the pasted/attached content and the document content from search. For facts from the pasted content, explain in your own words (no citation). For facts from the document content, cite as [ID: X](BLOCK_CITE_ID_N). " + instructions
    instructions += """
- **Place each citation immediately after the fact it supports**, not at the end of the sentence (e.g. "...payment stablecoins are not considered securities [ID: 1](BLOCK_CITE_ID_5), amending various acts..." not "...to reflect this [ID: 1](BLOCK_CITE_ID_5).").
- **In bullet lists:** put each citation at the end of the bullet it supports (e.g. "- Incredible Location [ID: 1](BLOCK_CITE_ID_1)"), never all citations at the end of the last bullet.
- Put any closing or follow-up only at the very end after a blank line; never at the start or after the first heading.
- Explain in a clear, conversational way; use Markdown where it helps readability. Be accurate.
"""

    human_message = HumanMessage(content=f"""
**User Question:**
{user_query}
{paste_section}{doc_section}
**Instructions:**
{instructions}
""")

    logger.info(
        f"[RESPONDER] Invoking LLM with block-id citation instructions "
        f"({len(formatted_chunks.split('[SOURCE_ID:')) - 1} source groups)"
    )
    structured_llm = llm.with_structured_output(PersonalityResponse)
    try:
        parsed = await structured_llm.ainvoke([system_prompt, human_message])
        personality_id = (
            parsed.personality_id
            if parsed.personality_id in VALID_PERSONALITY_IDS
            else DEFAULT_PERSONALITY_ID
        )
        answer_text = (parsed.response or "").strip()
        answer_text = _strip_mid_response_generic_closings(answer_text)
        logger.info(f"[RESPONDER] Chose personality_id={personality_id}")
        return personality_id, answer_text
    except Exception as e:
        logger.warning(f"[RESPONDER] Structured output failed, using default personality: {e}")
        # Fallback: invoke without structured output and return default personality
        fallback_llm = ChatOpenAI(model=config.openai_model, temperature=0.38, max_tokens=4096)
        response = await fallback_llm.ainvoke([system_prompt, human_message])
        answer_text = response.content if hasattr(response, 'content') and response.content else ""
        answer_text = _strip_mid_response_generic_closings(answer_text)
        return DEFAULT_PERSONALITY_ID, answer_text


async def generate_answer_with_direct_citations(
    user_query: str,
    execution_results: list[Dict[str, Any]],
    previous_personality: Optional[str] = None,
    is_first_message: bool = False,
    user_id: Optional[str] = None,
    workspace_section: str = "",
    paste_context: str = "",
) -> Tuple[str, List[Dict[str, Any]], str]:
    """
    Generate answer using direct citation system with short IDs.

    Flow:
    1. Extract chunks with metadata
    2. Format chunks with block-level BLOCK_CITE_ID tags
    3. Generate LLM response (with personality selection); get (personality_id, raw response)
    4. Extract citations, replace IDs, format for frontend
    5. Return (formatted_answer, citations_list, personality_id)

    Args:
        user_query: User's question
        execution_results: Execution results from executor node
        previous_personality: Personality from previous turn (or None)
        is_first_message: True if this is the first message in the conversation

    Returns:
        Tuple of (formatted_answer, citations_list, personality_id)
    """
    try:
        # Step 1: Extract chunks with metadata
        chunks_metadata = extract_chunks_with_metadata(execution_results)

        if not chunks_metadata:
            logger.warning("[DIRECT_CITATIONS] No chunks found in execution results")
            return "No relevant information found.", [], DEFAULT_PERSONALITY_ID

        logger.info(f"[DIRECT_CITATIONS] Extracted {len(chunks_metadata)} chunks with metadata")

        # Step 2: Format chunks with block-level BLOCK_CITE_ID tags and metadata table (jan28th-style)
        formatted_chunks, short_id_lookup, metadata_lookup_tables = format_chunks_with_block_ids(chunks_metadata)
        logger.info(
            f"[DIRECT_CITATIONS] Formatted chunks with block IDs: "
            f"{list(short_id_lookup.keys())}, {sum(len(t) for t in metadata_lookup_tables.values())} blocks"
        )

        # Step 3: Generate LLM response (with personality selection)
        logger.info(f"[DIRECT_CITATIONS] Generating LLM response with block-id citation instructions...")
        personality_id, llm_response = await generate_conversational_answer_with_citations(
            user_query, formatted_chunks, metadata_lookup_tables,
            previous_personality=previous_personality,
            is_first_message=is_first_message,
            user_id=user_id,
            workspace_section=workspace_section,
            paste_context=paste_context,
        )
        logger.info(f"[DIRECT_CITATIONS] LLM response generated ({len(llm_response)} chars), personality_id={personality_id}")

        # Step 4: Extract citations (prefer block_id lookup when (BLOCK_CITE_ID_N) present)
        citations = extract_citations_with_positions(
            llm_response, short_id_lookup, metadata_lookup_tables
        )
        logger.info(f"[DIRECT_CITATIONS] Extracted {len(citations)} citations from response")

        # Step 4b: Assign sequential citation numbers 1, 2, 3... by order of appearance (position).
        # This ensures UI shows [1], [2], [3] and we never collapse two in-text citations into one.
        citations.sort(key=lambda c: c.get('position', 0))
        for seq, citation in enumerate(citations, start=1):
            citation['citation_number'] = seq
        
        # Step 5: Validate citations
        if not validate_citations(citations, short_id_lookup):
            logger.warning("[DIRECT_CITATIONS] Some citations failed validation, continuing anyway...")
        
        # Step 6: Replace [ID: 1] with [1], [ID: 2] with [2], etc. (safe replacement)
        formatted_response = replace_ids_with_citation_numbers(llm_response, citations)
        formatted_response = _strip_mid_response_generic_closings(formatted_response)
        logger.info(f"[DIRECT_CITATIONS] Replaced citation IDs with numbers")
        
        # Step 7: Format citations for frontend
        frontend_citations = format_citations_for_frontend(citations)
        logger.info(f"[DIRECT_CITATIONS] Formatted {len(frontend_citations)} citations for frontend")

        return formatted_response, frontend_citations, personality_id

    except Exception as e:
        logger.error(f"[DIRECT_CITATIONS] Error in citation generation: {e}", exc_info=True)
        # Fallback: return answer without citations
        chunks_metadata = extract_chunks_with_metadata(execution_results)
        if chunks_metadata:
            chunk_texts = [chunk.get('chunk_text', '') for chunk in chunks_metadata if chunk.get('chunk_text')]
            formatted_chunk_text = "\n\n---\n\n".join(chunk_texts)
            fallback_answer = await generate_conversational_answer(user_query, formatted_chunk_text)
            return fallback_answer, [], DEFAULT_PERSONALITY_ID
        return "I encountered an error while generating the answer. Please try again.", [], DEFAULT_PERSONALITY_ID


async def generate_formatted_answer(
    user_query: str,
    prior_turn_content: Optional[str],
    execution_results: List[Dict[str, Any]],
    format_instruction: str,
) -> str:
    """
    Combine prior answer and/or new retrieval into one block formatted per format_instruction.
    Used for refine/format flows (e.g. "make that into a concise paragraph").
    """
    from langchain_openai import ChatOpenAI

    prior_block = ""
    if prior_turn_content and prior_turn_content.strip():
        prior_block = f"<prior_answer>\n{prior_turn_content.strip()}\n</prior_answer>\n\n"

    new_block = ""
    chunks_metadata = extract_chunks_with_metadata(execution_results)
    if chunks_metadata:
        chunk_texts = [c.get("chunk_text", "") for c in chunks_metadata if c.get("chunk_text")]
        if chunk_texts:
            new_block = "<new_retrieval>\n" + "\n\n---\n\n".join(chunk_texts) + "\n</new_retrieval>\n\n"

    system_content = get_responder_formatted_answer_system_prompt()
    user_content = get_responder_formatted_answer_human_prompt(
        user_query, format_instruction, prior_block, new_block
    )

    llm = ChatOpenAI(api_key=config.openai_api_key, model=config.openai_model, temperature=0)
    response = await llm.ainvoke([SystemMessage(content=system_content), HumanMessage(content=user_content)])
    answer = (response.content or "").strip()
    return _strip_mid_response_generic_closings(answer)


@log_node_perf("responder")
async def responder_node(state: MainWorkflowState, runnable_config=None) -> MainWorkflowState:
    """
    Responder node - generates final answer from execution results.
    
    This node:
    1. Extracts chunk text from execution results
    2. Generates conversational answer using existing logic
    3. Emits completion event
    4. Returns final answer
    
    Args:
        state: MainWorkflowState with execution_results, user_query
        runnable_config: Optional RunnableConfig from LangGraph
        
    Returns:
        Updated state with final_summary
    """
    user_query = state.get("user_query", "")
    execution_results = state.get("execution_results", [])
    prior_turn_content = state.get("prior_turn_content")
    format_instruction = (state.get("format_instruction") or "").strip()
    emitter = state.get("execution_events")
    previous_personality = state.get("personality_id")
    is_first_message = previous_personality is None
    if emitter is None:
        logger.warning("[RESPONDER] ⚠️  Emitter is None - reasoning events will not be emitted")
    plan_refinement_count = state.get("plan_refinement_count", 0)
    refinement_limit_reached = plan_refinement_count >= 3
    
    logger.info(f"[RESPONDER] Generating answer from {len(execution_results)} execution results")

    # Format branch: user asked to restructure/format (refine + copy-paste)
    if format_instruction:
        logger.info(f"[RESPONDER] Format path: format_instruction={format_instruction[:80]}...")
        if emitter:
            emitter.emit_reasoning(label="Formatting", detail=format_instruction[:60])
        try:
            formatted_answer = await generate_formatted_answer(
                user_query, prior_turn_content, execution_results, format_instruction
            )
            formatted_answer = ensure_main_tags_when_missing(formatted_answer, user_query)
            responder_output = {
                "final_summary": formatted_answer,
                "personality_id": previous_personality or DEFAULT_PERSONALITY_ID,
                "citations": [],
                "chunk_citations": [],
                "messages": [AIMessage(content=formatted_answer)],
            }
            validate_responder_output(responder_output)
            return responder_output
        except Exception as e:
            logger.error(f"[RESPONDER] Format path error: {e}", exc_info=True)
            fallback_msg = "I couldn't reformat that. Please try again."
            return {
                "final_summary": fallback_msg,
                "personality_id": previous_personality or DEFAULT_PERSONALITY_ID,
                "citations": [],
                "chunk_citations": [],
                "messages": [AIMessage(content=fallback_msg)],
            }
    
    # Extract chunks WITH metadata (chunk_id, chunk_text, document_id)
    chunks_metadata = extract_chunks_with_metadata(execution_results)
    has_chunks = len(chunks_metadata) > 0
    
    if has_chunks:
        logger.info(f"[RESPONDER] ✅ Chunks detected ({len(chunks_metadata)} chunks), generating answer with direct citations...")
        
        # Log document sources for debugging
        from collections import defaultdict
        doc_sources = defaultdict(int)
        for chunk in chunks_metadata:
            filename = chunk.get('document_filename', 'unknown')
            doc_sources[filename] += 1
        
        if doc_sources:
            logger.info(f"[RESPONDER] Chunk sources: {dict(doc_sources)}")
        
        # Emit "Analysing" reasoning event BEFORE generating answer
        if emitter:
            emitter.emit_reasoning(
                label="Analysing",
                detail=None
            )
        
        # Generate answer with direct citations (includes personality selection in same LLM call)
        try:
            workspace_section, derived_document_ids = _build_responder_workspace_section(state, execution_results)
            paste_context_str = ""
            if state.get("use_paste_plus_docs") and state.get("attachment_context"):
                paste_context_str = format_attachment_context(state["attachment_context"])
                if len(paste_context_str) > MAX_PASTE_CONTEXT_CHARS:
                    paste_context_str = paste_context_str[:MAX_PASTE_CONTEXT_CHARS] + "\n\n... [pasted content truncated for length]"
                    logger.info(f"[RESPONDER] Paste+docs path: truncated pasted context to {MAX_PASTE_CONTEXT_CHARS} chars")
                else:
                    logger.info(f"[RESPONDER] Paste+docs path: including {len(paste_context_str)} chars of pasted/attachment context")
            logger.info(f"[RESPONDER] Generating answer with direct citation system...")
            formatted_answer, citations, personality_id = await generate_answer_with_direct_citations(
                user_query, execution_results,
                previous_personality=previous_personality,
                is_first_message=is_first_message,
                user_id=state.get("user_id"),
                workspace_section=workspace_section,
                paste_context=paste_context_str,
            )
            formatted_answer = ensure_main_tags_when_missing(formatted_answer, user_query)
            if state.get("paste_requested_but_missing"):
                formatted_answer = "You asked to use pasted content, but no attachment was included with this message. Below is an answer based on the documents I found.\n\n" + formatted_answer

            logger.info(f"[RESPONDER] ✅ Answer generated ({len(formatted_answer)} chars) with {len(citations)} citations, personality_id={personality_id}")

            # Prepare output with citations and persist chosen personality for next turn.
            # When we had no attachment but derived document_ids from retrieval, persist them so
            # the next turn (follow-up) reuses the same docs instead of running a new search.
            responder_output = {
                "final_summary": formatted_answer,
                "personality_id": personality_id,
                "citations": citations if citations else [],
                "chunk_citations": citations if citations else [],
                "messages": [AIMessage(content=formatted_answer)],
            }
            if derived_document_ids and not state.get("document_ids"):
                responder_output["document_ids"] = derived_document_ids
                logger.info(f"[RESPONDER] Persisting derived document_ids for follow-up ({len(derived_document_ids)} doc(s))")
            
            # Validate output against contract
            try:
                validate_responder_output(responder_output)
            except ValueError as e:
                logger.error(f"[RESPONDER] ❌ Contract violation: {e}")
                raise
            
            return responder_output
            
        except Exception as e:
            logger.error(f"[RESPONDER] ❌ Error generating answer with citations: {e}", exc_info=True)
            # Fallback to simple answer without citations
            try:
                chunk_texts = [chunk.get('chunk_text', '') for chunk in chunks_metadata if chunk.get('chunk_text')]
                formatted_chunk_text = "\n\n---\n\n".join(chunk_texts)
                fallback_answer = await generate_conversational_answer(user_query, formatted_chunk_text)
                error_answer = fallback_answer
            except Exception as fallback_error:
                logger.error(f"[RESPONDER] ❌ Fallback also failed: {fallback_error}", exc_info=True)
                error_answer = "I encountered an error while generating the answer. Please try again."
            
            # Prepare error output (keep previous personality)
            error_output = {
                "final_summary": error_answer,
                "personality_id": previous_personality or DEFAULT_PERSONALITY_ID,
                "messages": [AIMessage(content=error_answer)],
            }
            
            # Validate error output (should still be valid string)
            try:
                validate_responder_output(error_output)
            except ValueError as e:
                logger.error(f"[RESPONDER] ❌ Error output contract violation: {e}")
                # Fallback to minimal valid output
                fallback_msg = "I encountered an error. Please try again."
                error_output = {
                    "final_summary": fallback_msg,
                    "personality_id": previous_personality or DEFAULT_PERSONALITY_ID,
                    "messages": [AIMessage(content=fallback_msg)],
                }
            
            if emitter:
                emitter.emit_reasoning(
                    label="Error generating answer",
                    detail="Please try again"
                )
            
            return error_output
    
    else:
        # No chunks found - generate helpful message via prompt (no hard-coded strings)
        logger.warning("[RESPONDER] ⚠️ No chunks found in execution results")
        has_documents = any(r.get("action") == "retrieve_docs" and r.get("result") for r in execution_results)
        fallback_answer = "I couldn't find that. Please try rephrasing or adding more detail."
        try:
            llm = ChatOpenAI(api_key=config.openai_api_key, model=config.openai_model, temperature=0)
            response = await llm.ainvoke([
                SystemMessage(content=get_responder_no_chunks_system_prompt()),
                HumanMessage(content=get_responder_no_chunks_human_prompt(
                    user_query, has_documents, refinement_limit_reached
                )),
            ])
            answer = (response.content or "").strip() or fallback_answer
        except Exception as e:
            logger.warning("[RESPONDER] No-chunks LLM fallback: %s", e)
            answer = fallback_answer
        # Prepare no-results output (keep previous personality)
        no_results_output = {
            "final_summary": answer,
            "personality_id": previous_personality or DEFAULT_PERSONALITY_ID,
            "messages": [AIMessage(content=answer)],
        }
        
        # Validate output
        try:
            validate_responder_output(no_results_output)
        except ValueError as e:
            logger.error(f"[RESPONDER] ❌ No-results output contract violation: {e}")
            raise
        
        if emitter:
            if has_documents:
                emitter.emit_reasoning(
                    label="No relevant information found",
                    detail="The documents don't contain the requested information"
                )
            else:
                emitter.emit_reasoning(
                    label="No relevant documents found",
                    detail="Please try rephrasing your question"
                )
        
        return no_results_output


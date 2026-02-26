"""
Fast LLM classifier: same-doc follow-up vs new question.

Used before cache-first: we only reuse cached execution_results when the classifier
returns "same_doc_follow_up". For "new_question" or on error we run the full planner.
"""

import logging
from typing import Any, Dict, List, Literal, Optional

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

from backend.llm.config import config

logger = logging.getLogger(__name__)

Result = Literal["same_doc_follow_up", "new_question", "paste_and_docs"]

# Decision-checklist prompt (replaces long example list). Safe default: unparseable or empty → new_question.
SYSTEM_PROMPT = """Reply with exactly one word: SAME_DOC or NEW_QUESTION or PASTE_AND_DOCS. No other text.

Labels:
- SAME_DOC: User continues on the same doc(s)—more detail, reformat, clarification, or another attribute of the same entity.
- NEW_QUESTION: User asks about a different document/file, or it's ambiguous. When in doubt, use NEW_QUESTION.
- PASTE_AND_DOCS: User wants pasted/attached content together with other docs. No attachment present → NEW_QUESTION.

Entity = property or document name. Attribute = value, condition, date, parties, terms, flood risk, EPC, etc. (details about that entity).

**CRITICAL: "The property", "of the property", "this property" = reference to the SAME entity from the previous turn.** Do NOT treat these as NEW_QUESTION. Queries like "what is the flood risk of the property" or "what is the EPC of the property" are SAME_DOC—they ask about an attribute of the same entity. Only treat as NEW_QUESTION when the user names a *different* specific entity (e.g. "Nzohe lease", "the other property", "Banda Lane").

Decision checklist (follow in order):
1. What entity was the previous answer about?
2. Does current query name a *different* entity (different doc/file/property by name)? → NEW_QUESTION
3. Does current ask about an attribute of the same entity (value, condition, flood risk, date, parties)? → SAME_DOC
4. Is it reformat / expand / clarify of the prior answer? → SAME_DOC
5. Paste+attachment intent with file attached? → PASTE_AND_DOCS. No attachment? → NEW_QUESTION
6. Unsure? → NEW_QUESTION

Pattern exemplars:
- "Value of Highlands?" → "What is the property condition?" = SAME_DOC (same entity, different attribute)
- "Value of Highlands?" → "What is the flood risk of the property?" = SAME_DOC ("the property" = same entity)
- "Key dates?" → "Format as a list" = SAME_DOC (reformat)
- "Highlands valuation?" → "The other property?" = NEW_QUESTION (explicit switch to different entity)
- "Banda Lane" → "Nzohe lease" = NEW_QUESTION (different entity)
- "Compare pasted to lease" + attachment = PASTE_AND_DOCS

Reply with exactly one word: SAME_DOC or NEW_QUESTION or PASTE_AND_DOCS. No other text."""


# Truncate so we stay within a small token budget
MAX_PREV_ANSWER_CHARS = 400
MAX_PREV_QUERY_CHARS = 200
MAX_DOC_NAMES = 5
MAX_PREV_EXCHANGES_FOR_CLASSIFIER = 2  # Last N exchanges for same_doc vs new_question


def should_use_paste_plus_docs(
    classification: str,
    attachment_context: Optional[dict],
) -> bool:
    """
    Return True only when we should set use_paste_plus_docs: classifier said
    paste_and_docs AND the request has usable attachment content.
    Used by views to avoid setting a flag we cannot fulfill.
    """
    if classification != "paste_and_docs":
        return False
    if not attachment_context or not isinstance(attachment_context, dict):
        return False
    texts = attachment_context.get("texts")
    if not texts or not isinstance(texts, list):
        return False
    if not any(t and (len(str(t).strip()) > 0) for t in texts):
        return False
    return True


def _build_user_prompt(
    current_query: str,
    conversation_history: List[Dict[str, Any]],
    doc_names: List[str],
    has_attachment: bool = False,
) -> str:
    lines = []
    if conversation_history:
        recent = conversation_history[-MAX_PREV_EXCHANGES_FOR_CLASSIFIER:]
        for i, last in enumerate(recent):
            if not isinstance(last, dict):
                continue
            prev_query = (last.get("query") or "").strip()[:MAX_PREV_QUERY_CHARS]
            prev_summary = (last.get("summary") or "").strip()[:MAX_PREV_ANSWER_CHARS]
            if prev_query:
                lines.append(f"Previous user question: {prev_query}")
            if prev_summary:
                lines.append(f"Previous answer (summary): {prev_summary}")
            if i < len(recent) - 1:
                lines.append("")
    if doc_names:
        names = doc_names[:MAX_DOC_NAMES]
        lines.append(f"Documents from that turn: {', '.join(names)}")
    lines.append(f"Current user message: {current_query}")
    if has_attachment:
        lines.append("Current message includes an attached/pasted file.")
    lines.append("\nReply SAME_DOC or NEW_QUESTION or PASTE_AND_DOCS.")
    return "\n".join(lines)


# Words that often follow a document/entity name in queries ("X lease", "X offer", ...)
# Used only by current_query_mentions_different_document (optional utility, not used for routing)
_DOC_TYPE_WORDS = frozenset({
    "lease", "leases", "offer", "offers", "valuation", "valuations",
    "property", "document", "documents", "file", "files", "contract",
    "contracts", "agreement", "invoice", "invoices", "memo", "survey",
    "epc", "nda", "certificate", "report", "letter",
})

# Generic words that are not document identifiers
_GENERIC_QUERY_WORDS = frozenset({
    "the", "a", "an", "main", "key", "commercial", "terms", "from",
    "list", "summarise", "summarize", "what", "when", "who", "which",
    "that", "this", "those", "these", "other", "same", "different",
})


def _doc_name_tokens(doc_names: List[str]) -> set:
    """Normalize doc names to a set of lowercase tokens (no extension)."""
    tokens = set()
    for name in doc_names or []:
        base = (name or "").strip()
        if "." in base:
            base = base.rsplit(".", 1)[0]
        for part in base.replace("-", " ").replace("_", " ").split():
            if part:
                tokens.add(part.lower())
    return tokens


def current_query_mentions_different_document(
    current_query: str,
    doc_names: List[str],
) -> bool:
    """
    Return True if the current query explicitly mentions a document/entity that does
    not appear in the previous turn's doc names (e.g. "Nzohe lease" when docs were
    "Banda Lane"). Used to force NEW_QUESTION and avoid reusing the wrong cache.
    """
    if not (current_query or "").strip() or not doc_names:
        return False
    prev_tokens = _doc_name_tokens(doc_names)
    q = current_query.strip()
    # Find candidate document references: word(s) immediately before a doc-type word
    # e.g. "the Nzohe lease" -> "Nzohe", "from the Banda Lane offer" -> "Banda", "Lane"
    # Skip when "the property", "of the property", "this property" etc. = anaphoric reference to same entity
    _SAME_ENTITY_PREFIXES = ("the ", "of the ", "this ", "that ", "a ", "the same ")
    q_lower = q.lower()
    candidates = []
    for doc_word in _DOC_TYPE_WORDS:
        pos = q_lower.find(" " + doc_word)
        if pos == -1:
            continue
        before = q[:pos].strip().lower()
        if not before:
            continue
        # "the property", "of the property" etc. = same entity; do not treat as different doc
        if any(before.endswith(p.rstrip()) or before == p.rstrip() for p in _SAME_ENTITY_PREFIXES):
            continue
        # Take the last 1–3 words before the doc-type word (e.g. "from the Nzohe" -> "Nzohe")
        words_before = before.split()[-3:]
        for w in words_before:
            w_clean = "".join(c for c in w if c.isalnum())
            if len(w_clean) >= 2 and w_clean.lower() not in _GENERIC_QUERY_WORDS:
                candidates.append(w_clean.lower())
    # Also consider capitalized words that look like names (e.g. "Nzohe" in "List ... Nzohe lease")
    for word in q.split():
        if len(word) >= 2 and word[0].isupper() and word.isalpha():
            w_lower = word.lower()
            if w_lower not in _GENERIC_QUERY_WORDS:
                candidates.append(w_lower)
    if not candidates:
        return False
    # If any candidate does not appear in previous doc names, user is likely asking about a different doc
    for c in candidates:
        if c not in prev_tokens:
            logger.info("[FOLLOW_UP_CLASSIFIER] Query mentions '%s' not in prev docs %s → treat as new question", c, list(prev_tokens)[:10])
            return True
    return False


def current_query_mentions_different_document_from_results(
    current_query: str,
    execution_results: List[Dict[str, Any]],
) -> bool:
    """Convenience: extract doc names from execution_results and run different-doc check."""
    return current_query_mentions_different_document(
        current_query, _extract_doc_names(execution_results)
    )


def _extract_doc_names(execution_results: List[Dict[str, Any]]) -> List[str]:
    names = []
    seen = set()
    for item in execution_results or []:
        if item.get("action") != "retrieve_chunks" or not item.get("success"):
            continue
        for chunk in (item.get("result") or []):
            if not isinstance(chunk, dict):
                continue
            fn = chunk.get("document_filename") or chunk.get("original_filename") or ""
            if fn and fn not in seen:
                seen.add(fn)
                names.append(fn)
    return names


def extract_document_ids_from_results(execution_results: List[Dict[str, Any]]) -> List[str]:
    """
    Extract unique document IDs from cached execution_results so we can re-run retrieval
    within the same doc(s) for a same-doc follow-up (instead of reusing the same chunks).
    """
    doc_ids = []
    seen = set()
    for item in execution_results or []:
        if not item.get("success"):
            continue
        action = item.get("action")
        result = item.get("result") or []
        if not isinstance(result, list):
            continue
        if action == "retrieve_docs":
            for doc in result:
                if isinstance(doc, dict):
                    did = doc.get("document_id")
                    if did and str(did) not in seen:
                        seen.add(str(did))
                        doc_ids.append(str(did))
        elif action == "retrieve_chunks":
            for chunk in result:
                if isinstance(chunk, dict):
                    did = chunk.get("document_id") or chunk.get("doc_id")
                    if did and str(did) not in seen:
                        seen.add(str(did))
                        doc_ids.append(str(did))
    return doc_ids


def _parse_response(content: str) -> Result:
    if not content:
        return "new_question"
    text = content.strip().upper()
    if "NEW_QUESTION" in text or "NEW QUESTION" in text:
        return "new_question"
    if "PASTE_AND_DOCS" in text or "PASTE AND DOCS" in text:
        return "paste_and_docs"
    if "SAME_DOC" in text or "SAME DOC" in text:
        return "same_doc_follow_up"
    # Default: don't cache
    return "new_question"


async def classify_follow_up(
    current_query: str,
    conversation_history: List[Any],
    execution_results: List[Dict[str, Any]],
    has_attachment: bool = False,
) -> Result:
    """
    Use LLM with decision checklist to classify. No hardcoded word matching for routing—
    the model generalizes from the checklist (entity vs attribute, different doc, paste intent, etc.).

    Decides: same-doc follow-up (use cache), new question (run planner), or paste_and_docs.

    On timeout or error returns "new_question" so we do not cache (safe default).
    has_attachment: when True, the current message includes an attached/pasted file (so PASTE_AND_DOCS is valid).
    """
    query = (current_query or "").strip()
    if not query:
        return "new_question"

    doc_names = _extract_doc_names(execution_results)
    user_content = _build_user_prompt(query, conversation_history or [], doc_names, has_attachment=has_attachment)

    try:
        llm = ChatOpenAI(
            api_key=config.openai_api_key,
            model=config.openai_followup_classifier_model,
            temperature=0,
            max_tokens=15,
        )
        response = await llm.ainvoke([
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=user_content),
        ])
        content = (response.content or "").strip()
        result = _parse_response(content)
        logger.info("[FOLLOW_UP_CLASSIFIER] result=%s (raw=%s)", result, content[:80])
        return result
    except Exception as e:
        logger.warning("[FOLLOW_UP_CLASSIFIER] Error (defaulting to new_question): %s", e)
        return "new_question"

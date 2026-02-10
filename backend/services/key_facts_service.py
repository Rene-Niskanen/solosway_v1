"""
Shared service to build and store document key facts.
Used by the document pipeline (tasks) to generate once at processing time,
and by the key-facts API (views) to return stored facts or fall back to on-the-fly generation.
"""
import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_KEY_FACT_VALUE_MAX_LENGTH = 60
_LLM_KEY_FACTS_TEXT_MAX_LENGTH = 12000


def _sanitise_key_fact_value(value: str) -> str:
    """
    Sanitise a key-fact value for display: strip markdown, collapse whitespace, truncate.
    Applied to all fact values (from doc_summary, text extraction, and LLM).
    """
    if not value or not isinstance(value, str):
        return ''
    # Collapse newlines and multiple spaces to single space
    s = re.sub(r'\s+', ' ', value).strip()
    # Strip common markdown / structure chars (##, **, |, leading -/*)
    s = re.sub(r'^#+\s*', '', s)
    s = re.sub(r'\s*#+\s*', ' ', s)
    s = re.sub(r'\*\*', '', s)
    s = re.sub(r'\s*\|\s*', ' ', s)
    s = re.sub(r'^[\s\-*•]+\s*', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    # First line only if multi-line leakage remains
    if '\n' in s:
        s = s.split('\n')[0].strip()
    # First sentence (up to first . or ; or :) if still long
    if len(s) > _KEY_FACT_VALUE_MAX_LENGTH:
        for sep in ('. ', '; ', ': '):
            idx = s.find(sep)
            if 0 < idx < _KEY_FACT_VALUE_MAX_LENGTH:
                s = s[: idx + 1].strip()
                break
    if len(s) > _KEY_FACT_VALUE_MAX_LENGTH:
        s = s[:_KEY_FACT_VALUE_MAX_LENGTH - 1].rstrip() + '…'
    return s


def _get_document_text_from_vectors(document_id: str) -> str:
    """Fallback: get document text by concatenating chunk_text from document_vectors."""
    try:
        from backend.services.supabase_client_factory import get_supabase_client
        supabase = get_supabase_client()
        result = supabase.table('document_vectors').select('chunk_text, chunk_index').eq(
            'document_id', str(document_id)
        ).order('chunk_index', desc=False).execute()
        if not result.data:
            return ''
        parts = [row.get('chunk_text') or '' for row in result.data if row.get('chunk_text')]
        return '\n'.join(parts).strip()
    except Exception as e:
        logger.debug("Key facts: document_vectors fallback failed: %s", e)
        return ''


def get_document_text_for_key_facts(
    document: dict,
    doc_summary: dict,
    document_id: Optional[str] = None,
) -> str:
    """Get full document text from document row, document_summary, or document_vectors."""
    text = (document.get('parsed_text') or '').strip()
    if not text and isinstance(doc_summary, dict):
        text = (doc_summary.get('reducto_parsed_text') or '').strip()
    if not text and isinstance(doc_summary, dict):
        chunks = doc_summary.get('reducto_chunks') or []
        parts = []
        for ch in chunks:
            if isinstance(ch, dict):
                part = ch.get('content') or ch.get('embed') or ch.get('text') or ''
                if part and isinstance(part, str):
                    parts.append(part)
        if parts:
            text = '\n'.join(parts).strip()
    if not text and document_id:
        text = _get_document_text_from_vectors(document_id)
    return text or ''


def llm_summarise_document_for_key_facts(doc_text: str) -> Tuple[Optional[str], List[Dict[str, Any]]]:
    """
    Use LLM to produce a short summary and optional key facts from document text.
    Returns (summary_str or None, list of {label, value}) or (None, []) on failure.
    """
    if not doc_text or len(doc_text.strip()) < 100:
        return None, []
    text = doc_text.strip()
    if len(text) > _LLM_KEY_FACTS_TEXT_MAX_LENGTH:
        text = text[:_LLM_KEY_FACTS_TEXT_MAX_LENGTH] + "\n\n[Document truncated for summary.]"
    try:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import HumanMessage, SystemMessage
        from backend.llm.config import config
        if not getattr(config, 'openai_api_key', None):
            logger.debug("Key facts LLM: no OpenAI API key, skipping LLM summarisation")
            return None, []
        llm = ChatOpenAI(
            api_key=config.openai_api_key,
            model=config.openai_model,
            temperature=0,
        )
        system_msg = SystemMessage(content="""You extract key information from any type of document (reports, letters, forms, etc.).
Respond with valid JSON only, no markdown or extra text, in this exact shape:
{"summary": "Two to four sentences summarising the document.", "key_facts": [{"label": "Fact label", "value": "Fact value"}, ...]}
- summary: brief overview (2-4 sentences). Required.
- key_facts: 3-8 items relevant to this document. Each has "label" (short, e.g. "Date", "Parties", "Amount", "Location", "Subject") and "value" (concise, under 60 chars if possible). Choose labels that fit the document type.
- Labels and values must be plain text, no newlines. If the document has no clear facts, set key_facts to [] but always provide a summary.""")
        human_msg = HumanMessage(content=f"Document text:\n\n{text}")
        response = llm.invoke([system_msg, human_msg])
        content = (response.content or "").strip()
        if content.startswith("```"):
            content = re.sub(r"^```(?:json)?\s*", "", content)
            content = re.sub(r"\s*```$", "", content)
        data = json.loads(content)
        summary = (data.get("summary") or "").strip() or None
        raw_facts = data.get("key_facts") or []
        facts = []
        for item in raw_facts:
            if isinstance(item, dict):
                label = (item.get("label") or "").strip()
                value = _sanitise_key_fact_value((item.get("value") or "").strip())
                if label and value:
                    facts.append({"label": label, "value": value})
        return summary, facts
    except json.JSONDecodeError as e:
        logger.warning("Key facts LLM: invalid JSON from model: %s", e)
        return None, []
    except Exception as e:
        logger.warning("Key facts LLM summarisation failed: %s", e)
        return None, []


def build_key_facts_from_document(
    document: dict,
    document_id: Optional[str] = None,
) -> Tuple[List[Dict[str, str]], Optional[str]]:
    """
    Build key_facts list from document (Supabase row with document_summary).
    Returns (facts, llm_summary).
    facts: list of {label, value}. llm_summary: str or None (only set when LLM fallback was used).
    """
    doc_summary = document.get('document_summary') or {}
    if isinstance(doc_summary, str):
        try:
            doc_summary = json.loads(doc_summary)
        except Exception:
            doc_summary = {}
    if doc_summary is None:
        doc_summary = {}
    facts = []
    # Address / location (generic for any document type)
    addr = doc_summary.get('extracted_address') or doc_summary.get('normalized_address') or doc_summary.get('filename_address')
    if addr and str(addr).strip():
        facts.append({'label': 'Address', 'value': _sanitise_key_fact_value(str(addr).strip())})
    # Document type
    doc_type = doc_summary.get('classification_type') or document.get('classification_type')
    if doc_type and str(doc_type).strip():
        facts.append({'label': 'Document type', 'value': _sanitise_key_fact_value(str(doc_type).replace('_', ' ').strip())})
    # Party names
    party_names = doc_summary.get('party_names')
    if isinstance(party_names, dict):
        for role, name in party_names.items():
            if name and str(name).strip():
                facts.append({'label': role.replace('_', ' ').title(), 'value': _sanitise_key_fact_value(str(name).strip())})
    elif isinstance(party_names, list):
        for item in party_names:
            if isinstance(item, dict) and item.get('name'):
                label = item.get('role', 'Party').replace('_', ' ').title()
                facts.append({'label': label, 'value': _sanitise_key_fact_value(str(item['name']).strip())})
            elif isinstance(item, str) and item.strip():
                facts.append({'label': 'Party', 'value': _sanitise_key_fact_value(item.strip())})

    existing_labels = {f['label'].lower() for f in facts}
    doc_text = get_document_text_for_key_facts(document, doc_summary, document_id=document_id)
    if doc_text:
        try:
            from backend.llm.nodes.responder_node import extract_key_facts_from_text
            text_facts = extract_key_facts_from_text(doc_text)
            for tf in text_facts:
                label = (tf.get('label') or 'Fact').strip()
                if not label:
                    continue
                value = _sanitise_key_fact_value((tf.get('text') or '').strip())
                if not value:
                    continue
                if label.lower() in existing_labels:
                    continue
                existing_labels.add(label.lower())
                facts.append({'label': label, 'value': value})
        except Exception as e:
            logger.warning("Key facts from text extraction failed: %s", e)
    elif document_id:
        logger.info(
            "Key facts: no document text available for document_id=%s (parsed_text, reducto_parsed_text, reducto_chunks, document_vectors all empty or missing)",
            str(document_id)[:8],
        )

    llm_summary = None
    if doc_text and len(doc_text.strip()) >= 100 and len(facts) == 0:
        llm_summary, llm_facts = llm_summarise_document_for_key_facts(doc_text)
        if llm_facts:
            for f in llm_facts:
                label = (f.get('label') or '').strip()
                value = _sanitise_key_fact_value((f.get('value') or '').strip())
                if label and value and label.lower() not in existing_labels:
                    existing_labels.add(label.lower())
                    facts.append({'label': label, 'value': value})

    return facts, llm_summary

"""
Query Classification Node: Determines query intent and routes to appropriate handler.

Classifies queries into one of five categories:
- general_query: General knowledge questions (no document search)
- text_transformation: Transform/reorganize text
- document_search: Requires document search (existing)
- follow_up_document_search: Asking for more detail on previous document search (NEW)
- hybrid: Needs both general knowledge + document search

Uses a fast LLM (gpt-4o-mini) for classification with rule-based fallback.
"""

import logging
import re
from typing import Dict, Optional
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from backend.llm.config import config
from backend.llm.types import MainWorkflowState
from backend.llm.utils.system_prompts import get_system_prompt
from backend.llm.prompts import get_query_classification_prompt

logger = logging.getLogger(__name__)


async def classify_query_intent(state: MainWorkflowState) -> MainWorkflowState:
    """
    Classify query into one of five categories:
    - "general_query": General knowledge (no document search)
    - "text_transformation": Transform/reorganize text
    - "document_search": Requires document search (existing)
    - "follow_up_document_search": Asking for more detail on previous document search (NEW)
    - "hybrid": Needs both general knowledge + document search
    
    CRITICAL: This runs AFTER check_cached_documents, so we can check if documents
    are already cached (indicates document_search path).
    """
    user_query = state.get("user_query", "").strip()
    document_ids = state.get("document_ids", [])
    property_id = state.get("property_id")  # Can be None
    relevant_documents = state.get("relevant_documents", [])
    
    # Ensure document_ids is a list
    if document_ids and not isinstance(document_ids, list):
        document_ids = [str(document_ids)]
    elif not document_ids:
        document_ids = []
    
    # FAST PATH: If documents are cached or document_ids provided, it's document_search
    if (document_ids and len(document_ids) > 0) or (relevant_documents and len(relevant_documents) > 0):
        logger.info("[CLASSIFY] Fast path: document_search (documents provided/cached)")
        return {"query_category": "document_search"}
    
    # FAST PATH: If property_id and document-related terms, it's document_search
    user_query_lower = user_query.lower()
    if property_id and any(word in user_query_lower for word in [
        "report", "document", "inspection", "appraisal", "valuation", 
        "lease", "contract", "the document", "this document", "property"
    ]):
        logger.info("[CLASSIFY] Fast path: document_search (property context)")
        return {"query_category": "document_search"}
    
    if not user_query:
        logger.warning("[CLASSIFY] No user_query found, defaulting to document_search")
        return {"query_category": "document_search"}
    
    conversation_history = state.get("conversation_history", [])
    
    logger.info(f"[CLASSIFY] Conversation history length: {len(conversation_history)}")
    if conversation_history:
        logger.info(f"[CLASSIFY] Conversation history entries: {[list(entry.keys()) if isinstance(entry, dict) else type(entry).__name__ for entry in conversation_history[-3:]]}")
        # Log details of last entry
        if isinstance(conversation_history[-1], dict):
            last_entry = conversation_history[-1]
            logger.info(f"[CLASSIFY] Last entry has block_ids: {bool(last_entry.get('block_ids'))}, "
                       f"block_ids count: {len(last_entry.get('block_ids', []))}, "
                       f"query_category: {last_entry.get('query_category')}")
    
    # Check if this is a follow-up query to previous document search
    previous_entry = _get_last_document_search_entry(conversation_history)
    
    if previous_entry:
        logger.info(f"[CLASSIFY] Found previous entry with block_ids: {bool(previous_entry.get('block_ids'))}, "
                    f"block_ids count: {len(previous_entry.get('block_ids', []))}, "
                    f"has citations: {bool(previous_entry.get('citations'))}, "
                    f"has document_ids: {bool(previous_entry.get('document_ids'))}, "
                    f"document_ids count: {len(previous_entry.get('document_ids', []))}")
        
        if previous_entry.get('block_ids'):
            # Use LLM to intelligently determine if this is a follow-up query
            logger.info(f"[CLASSIFY] Checking if query is follow-up: '{user_query[:50]}...'")
            is_follow_up = await _is_follow_up_query_llm(user_query, previous_entry)
            if is_follow_up:
                logger.info("[CLASSIFY] ✅ LLM detected follow-up document search query")
                return {"query_category": "follow_up_document_search"}
            else:
                logger.info("[CLASSIFY] ❌ LLM determined this is NOT a follow-up query")
        else:
            logger.warning("[CLASSIFY] Previous entry found but no block_ids - not a document search entry")
            logger.debug(f"[CLASSIFY] Previous entry keys: {list(previous_entry.keys())}")
    else:
        logger.warning(f"[CLASSIFY] No previous document search entry found in conversation history (length: {len(conversation_history)})")
        if conversation_history:
            logger.debug(f"[CLASSIFY] Last entry type: {type(conversation_history[-1])}")
            if isinstance(conversation_history[-1], dict):
                logger.debug(f"[CLASSIFY] Last entry keys: {list(conversation_history[-1].keys())}")
                logger.debug(f"[CLASSIFY] Last entry has block_ids: {bool(conversation_history[-1].get('block_ids'))}")
                logger.debug(f"[CLASSIFY] Last entry query_category: {conversation_history[-1].get('query_category')}")
    
    # Build conversation context
    history_context = ""
    if conversation_history:
        recent_history = conversation_history[-3:]
        history_lines = []
        for exchange in recent_history:
            # Handle both formats
            if 'query' in exchange and 'summary' in exchange:
                history_lines.append(f"Previous Q: {exchange['query']}")
                history_lines.append(f"Previous A: {exchange['summary'][:200]}...\n")
            elif 'role' in exchange and 'content' in exchange:
                role = exchange['role']
                content = exchange['content']
                if role == 'user':
                    history_lines.append(f"Previous Q: {content}")
                elif role == 'assistant':
                    history_lines.append(f"Previous A: {content[:200]}...\n")
        if history_lines:
            history_context = "\n\n".join(history_lines)
    
    # Use fast LLM for classification
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model="gpt-4o-mini",  # Fast model for quick classification
        temperature=0,  # Deterministic classification
        timeout=3,  # 3-second timeout
    )
    
    try:
        # Get system prompt
        system_msg = get_system_prompt('classify_intent')
        
        # Get human prompt
        human_prompt = get_query_classification_prompt(
            user_query=user_query,
            conversation_history=history_context
        )
        
        messages = [
            system_msg,
            HumanMessage(content=human_prompt)
        ]
        
        response = await llm.ainvoke(messages)
        result = response.content.strip().lower()
        
        # Validate response
        valid_categories = ["general_query", "text_transformation", "document_search", "follow_up_document_search", "hybrid"]
        if result not in valid_categories:
            logger.warning(f"[CLASSIFY] Invalid response '{result}', using fallback")
            return _fallback_classification(user_query, property_id, conversation_history)
        
        # CRITICAL: If LLM classified as text_transformation but we have a previous document search entry,
        # use LLM to check if it's actually a follow-up query
        if result == "text_transformation":
            previous_entry = _get_last_document_search_entry(conversation_history)
            if previous_entry and previous_entry.get('block_ids'):
                is_follow_up = await _is_follow_up_query_llm(user_query, previous_entry)
                if is_follow_up:
                    logger.info("[CLASSIFY] Overriding text_transformation -> follow_up_document_search (LLM detected follow-up)")
                    result = "follow_up_document_search"
        
        logger.info(f"[CLASSIFY] Query classified as: {result} for query: '{user_query[:50]}...'")
        
        return {"query_category": result}
        
    except Exception as exc:
        logger.error(f"[CLASSIFY] Error during classification: {exc}", exc_info=True)
        # Fallback: use heuristics
        return _fallback_classification(user_query, property_id, conversation_history)


def _fallback_classification(user_query: str, property_id: str = None, conversation_history: list = None) -> Dict[str, str]:
    """
    Fallback heuristic-based classification if LLM fails.
    
    Uses keyword matching to determine query category.
    """
    query_lower = user_query.lower()
    
    # Check for follow-up query first (if conversation history available)
    # Use pattern-based detection for fallback (synchronous)
    if conversation_history:
        previous_entry = _get_last_document_search_entry(conversation_history)
        if previous_entry and previous_entry.get('block_ids'):
            if _is_follow_up_query_patterns(user_query, previous_entry):
                logger.info("[CLASSIFY] Fallback: detected 'follow_up_document_search' from patterns")
                return {"query_category": "follow_up_document_search"}
    
    # Text transformation keywords
    transformation_keywords = [
        'make', 'reorganize', 'rewrite', 'improve', 'sharpen', 'concise',
        'rephrase', 'restructure', 'edit', 'refine', 'polish', 'tighten',
        'expand', 'enhance', 'clarify', 'simplify'
    ]
    transformation_references = [
        'this', 'that', 'the above', 'previous response', 'pasted text',
        'the text', 'above text', 'that text', 'this text'
    ]
    
    # Check for text transformation indicators
    has_transformation_verb = any(keyword in query_lower for keyword in transformation_keywords)
    has_transformation_ref = any(ref in query_lower for ref in transformation_references)
    
    # Check for long pasted text (rough heuristic: query has > 200 chars and contains transformation verb)
    has_long_text = len(user_query) > 200 and has_transformation_verb
    
    if has_transformation_verb and (has_transformation_ref or has_long_text):
        logger.info("[CLASSIFY] Fallback: detected 'text_transformation' from keywords")
        return {"query_category": "text_transformation"}
    
    # General query keywords (questions about general knowledge)
    general_query_keywords = [
        'what is the date', 'what is today', 'current date', 'current time',
        'explain', 'what is', 'how does', 'tell me about',
        'capital of', 'who is', 'when was', 'where is'
    ]
    
    # Document search keywords
    document_keywords = [
        'market value', 'valuation', 'property', 'bedroom', 'bathroom',
        'document', 'report', 'inspection', 'appraisal', 'lease',
        'find properties', 'search', 'comparable', 'comp'
    ]
    
    # Check for general query (no property/document context)
    has_general = any(keyword in query_lower for keyword in general_query_keywords)
    has_document = any(keyword in query_lower for keyword in document_keywords)
    
    # If property_id exists, likely document search
    if property_id or has_document:
        logger.info("[CLASSIFY] Fallback: detected 'document_search' from keywords/property context")
        return {"query_category": "document_search"}
    
    # If general knowledge question and no document context
    if has_general and not has_document and not property_id:
        logger.info("[CLASSIFY] Fallback: detected 'general_query' from keywords")
        return {"query_category": "general_query"}
    
    # Default to document_search (safest fallback)
    logger.info("[CLASSIFY] Fallback: no clear indicators, defaulting to document_search")
    return {"query_category": "document_search"}


def _get_last_document_search_entry(conversation_history: list) -> Optional[dict]:
    """Get last conversation entry that was a document search (has block_ids)"""
    if not conversation_history:
        return None
    
    # Search backwards for entry with block_ids
    for entry in reversed(conversation_history):
        if isinstance(entry, dict) and entry.get('block_ids'):
            return entry
    
    return None


async def _is_follow_up_query_llm(user_query: str, previous_entry: dict) -> bool:
    """
    Use LLM to intelligently determine if query is asking for more detail on previous response.
    
    This is more dynamic than pattern matching and can handle various phrasings.
    """
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage, SystemMessage
    
    # Get previous query and summary for context
    previous_query = previous_entry.get('query', '')
    previous_summary = previous_entry.get('summary', '')[:500]  # Truncate for context
    has_citations = bool(previous_entry.get('citations') or previous_entry.get('block_ids'))
    
    # Build context about previous response
    context = f"""**Previous Query:** "{previous_query}"
**Previous Response Summary:** "{previous_summary}..."
**Has Citations/Block IDs:** {has_citations}"""
    
    # System prompt for follow-up detection
    system_prompt = """You are a query classifier. Determine if a user's query is asking for MORE DETAIL on a specific topic from a previous document-based response.

**Follow-up Query Characteristics:**
- Asks for more information about a specific topic mentioned in the previous response
- References concepts, values, assumptions, or details from the previous answer
- Examples: "make the assumptions more detailed", "tell me more about the 90-day value", "what are the assumptions for each value"

**NOT a Follow-up Query if:**
- Asks to transform/reorganize existing text (text transformation)
- References "this text", "that text", "the above text" (text transformation)
- Is a completely new question unrelated to the previous response
- Asks general knowledge questions

**Return ONLY:** "yes" if it's a follow-up query asking for more detail, or "no" if it's not."""
    
    # Human prompt
    human_prompt = f"""**Context from Previous Conversation:**
{context}

**Current User Query:**
"{user_query}"

Is this query asking for MORE DETAIL on a specific topic from the previous document-based response?

Return ONLY "yes" or "no"."""
    
    try:
        # Use fast model for quick classification
        llm = ChatOpenAI(
            api_key=config.openai_api_key,
            model="gpt-4o-mini",  # Fast model for quick classification
            temperature=0,  # Deterministic
            timeout=3,  # 3-second timeout
        )
        
        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=human_prompt)
        ])
        
        result = response.content.strip().lower()
        is_follow_up = result.startswith('yes')
        
        logger.info(f"[CLASSIFY] LLM follow-up detection: '{result}' -> {is_follow_up}")
        return is_follow_up
        
    except Exception as exc:
        logger.warning(f"[CLASSIFY] LLM follow-up detection failed: {exc}, falling back to pattern matching")
        return _is_follow_up_query_patterns(user_query, previous_entry)


def _is_follow_up_query_patterns(user_query: str, previous_entry: dict) -> bool:
    """
    Fast pattern-based fallback for follow-up detection.
    Used when LLM call fails or as a quick pre-check.
    """
    query_lower = user_query.lower()
    
    # Quick exclusion: if it clearly references text transformation, it's not a follow-up
    transformation_refs = ['this text', 'that text', 'the above text', 'the text above', 'pasted text']
    if any(ref in query_lower for ref in transformation_refs):
        return False
    
    # Follow-up indicators (simple keyword matching)
    follow_up_phrases = [
        'more detailed', 'more information', 'more about', 'explain more',
        'what about', 'can you elaborate', 'more detail', 'more details',
        'tell me more', 'expand on', 'elaborate on'
    ]
    
    if any(phrase in query_lower for phrase in follow_up_phrases):
        # If previous entry has citations, it's likely a follow-up
        if previous_entry.get('citations') or previous_entry.get('block_ids'):
            logger.info(f"[CLASSIFY] Pattern-based follow-up detection (has citations/block_ids)")
            return True
    
    return False




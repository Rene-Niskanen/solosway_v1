"""
Combined Query Preparation Node: Classification + Detail Level + Expansion in ONE LLM call.

This node replaces 3 separate LLM calls with a single structured output call:
- classify_query_intent (~500-800ms)
- determine_detail_level (~500-800ms)  
- expand_query_for_retrieval (~500-800ms)

Savings: ~1-1.5s per query (30-40% faster on pre-retrieval phase)

Uses structured JSON output to get all results in one call.
"""

import json
import logging
import re
from typing import Dict, List, Optional, Any
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from backend.llm.config import config
from backend.llm.types import MainWorkflowState

logger = logging.getLogger(__name__)


async def classify_and_prepare_query(state: MainWorkflowState) -> MainWorkflowState:
    """
    COMBINED NODE: Classification + Detail Level + Query Expansion in ONE LLM call.
    
    Classifies query into one of five categories AND prepares for retrieval:
    - "general_query": General knowledge (no document search, no expansion needed)
    - "text_transformation": Transform/reorganize text (no expansion needed)
    - "document_search": Requires document search (expansion + detail level needed)
    - "follow_up_document_search": Follow-up on previous search (expansion + detail level needed)
    - "hybrid": Both general + document search (expansion + detail level needed)
    
    Returns:
        State with query_category, detail_level, and query_variations (if applicable)
    """
    user_query = state.get("user_query", "").strip()
    document_ids = state.get("document_ids", [])
    property_id = state.get("property_id")
    relevant_documents = state.get("relevant_documents", [])
    conversation_history = state.get("conversation_history", [])
    
    # Ensure document_ids is a list
    if document_ids and not isinstance(document_ids, list):
        document_ids = [str(document_ids)]
    elif not document_ids:
        document_ids = []
    
    # FAST PATH 0: CITATION QUERY - Always route to document_search to use citation_context
    # This ensures citation queries NEVER go to follow_up which doesn't use citation_context
    citation_context = state.get("citation_context")
    if citation_context and citation_context.get("cited_text"):
        logger.info("⚡ [COMBINED] Fast path: document_search (citation_context present - prioritizing cited document)")
        return await _prepare_document_search_query(user_query, conversation_history)
    
    # FAST PATH 1: If documents are provided/cached, skip classification - it's document_search
    if (document_ids and len(document_ids) > 0) or (relevant_documents and len(relevant_documents) > 0):
        logger.info("[COMBINED] Fast path: document_search (documents provided/cached)")
        # Still need detail level and expansion for document queries
        return await _prepare_document_search_query(user_query, conversation_history)
    
    # FAST PATH 2: If property_id and document-related terms, it's document_search
    user_query_lower = user_query.lower()
    if property_id and any(word in user_query_lower for word in [
        "report", "document", "inspection", "appraisal", "valuation", 
        "lease", "contract", "the document", "this document", "property"
    ]):
        logger.info("[COMBINED] Fast path: document_search (property context)")
        return await _prepare_document_search_query(user_query, conversation_history)
    
    if not user_query:
        logger.warning("[COMBINED] No user_query found, defaulting to document_search")
        return {"query_category": "document_search", "detail_level": "concise", "query_variations": [""]}
    
    # Check for follow-up query context
    previous_entry = _get_last_document_search_entry(conversation_history)
    has_follow_up_context = previous_entry and previous_entry.get('block_ids')
    
    # Build conversation context for LLM
    history_context = _build_history_context(conversation_history)
    
    # SINGLE LLM CALL: Classification + Detail Level + Expansion
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model="gpt-4o-mini",  # Fast model for combined task
        temperature=0,
        timeout=5,  # 5-second timeout
    )
    
    system_prompt = """You are a query analyzer. Analyze the user's query and return a JSON object with:

1. "category": One of:
   - "general_query": General knowledge questions not requiring document search (e.g., "What's the weather?", "Who is Einstein?")
   - "text_transformation": Requests to transform, rewrite, or reorganize text (e.g., "Make this more concise", "Rewrite this professionally")
   - "follow_up_document_search": Asking for more detail on a previous document-based response (e.g., "Tell me more about that", "What about the assumptions?")
   - "document_search": Questions requiring document search (e.g., "What's the property value?", "Find inspection reports")
   - "hybrid": Needs both general knowledge AND document search

2. "detail_level": Either "concise" or "detailed"
   - "concise": Simple factual queries (names, dates, single values, yes/no questions)
   - "detailed": Complex queries needing comprehensive analysis (comparisons, explanations, multi-part questions)

3. "needs_expansion": Boolean - whether query needs semantic expansion for better retrieval
   - true: Vague or conceptual queries that would benefit from synonyms/rephrasing
   - false: Specific queries with proper nouns, addresses, exact terms

4. "query_variations": Array of 2-3 query variations (only if needs_expansion is true AND category is document_search/follow_up/hybrid)
   - Include semantically similar phrasings
   - Include relevant synonyms
   - Return empty array [] if needs_expansion is false

IMPORTANT:
- For text transformation, look for references to "this", "that", "above text", "previous response"
- For follow-up queries, check if user is asking for more detail on a topic from conversation history
- Return ONLY valid JSON, no markdown or explanation"""

    human_prompt = f"""Analyze this query and return JSON:

**User Query:** "{user_query}"

**Has Previous Document Search:** {has_follow_up_context}

**Conversation History:**
{history_context if history_context else "No conversation history"}

Return JSON with: category, detail_level, needs_expansion, query_variations"""

    try:
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=human_prompt)
        ]
        
        response = await llm.ainvoke(messages)
        result_text = response.content.strip()
        
        # Clean up JSON (remove markdown code blocks if present)
        if result_text.startswith("```"):
            result_text = re.sub(r'^```(?:json)?\n?', '', result_text)
            result_text = re.sub(r'\n?```$', '', result_text)
        
        result = json.loads(result_text)
        
        category = result.get("category", "document_search")
        detail_level = result.get("detail_level", "concise")
        needs_expansion = result.get("needs_expansion", False)
        query_variations = result.get("query_variations", [])
        
        # Validate category
        valid_categories = ["general_query", "text_transformation", "document_search", "follow_up_document_search", "hybrid"]
        if category not in valid_categories:
            logger.warning(f"[COMBINED] Invalid category '{category}', defaulting to document_search")
            category = "document_search"
        
        # Ensure query_variations always includes original query for document searches
        if category in ["document_search", "follow_up_document_search", "hybrid"]:
            if not query_variations or user_query not in query_variations:
                query_variations = [user_query] + (query_variations or [])
            # Limit to 3 total variations
            query_variations = query_variations[:3]
        else:
            # Non-document queries don't need variations
            query_variations = [user_query]
        
        logger.info(
            f"[COMBINED] Query analyzed: category={category}, detail_level={detail_level}, "
            f"needs_expansion={needs_expansion}, variations={len(query_variations)}"
        )
        
        return {
            "query_category": category,
            "detail_level": detail_level,
            "query_variations": query_variations,
            "skip_expansion": True  # Always skip separate expansion node (we did it here)
        }
        
    except json.JSONDecodeError as e:
        logger.error(f"[COMBINED] JSON parse error: {e}, response: {result_text[:200]}")
        return _fallback_classification(user_query, property_id, conversation_history)
    except Exception as exc:
        logger.error(f"[COMBINED] Error during combined analysis: {exc}", exc_info=True)
        return _fallback_classification(user_query, property_id, conversation_history)


async def _prepare_document_search_query(user_query: str, conversation_history: list) -> MainWorkflowState:
    """
    Fast path for queries already identified as document_search.
    Still determines detail level and expansions in one call.
    """
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model="gpt-4o-mini",
        temperature=0,
        timeout=3,
    )
    
    system_prompt = """Analyze this document search query and return JSON with:
1. "detail_level": "concise" or "detailed"
   - "concise": Simple factual queries (single values, names, dates)
   - "detailed": Complex queries needing comprehensive analysis
2. "query_variations": Array of 2-3 semantically similar query variations for better retrieval

Return ONLY valid JSON."""

    try:
        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=f'Query: "{user_query}"\n\nReturn JSON with detail_level and query_variations')
        ])
        
        result_text = response.content.strip()
        if result_text.startswith("```"):
            result_text = re.sub(r'^```(?:json)?\n?', '', result_text)
            result_text = re.sub(r'\n?```$', '', result_text)
        
        result = json.loads(result_text)
        
        detail_level = result.get("detail_level", "concise")
        query_variations = result.get("query_variations", [])
        
        # Ensure original query is first
        if user_query not in query_variations:
            query_variations = [user_query] + query_variations
        query_variations = query_variations[:3]
        
        logger.info(f"[COMBINED] Fast path prepared: detail_level={detail_level}, variations={len(query_variations)}")
        
        return {
            "query_category": "document_search",
            "detail_level": detail_level,
            "query_variations": query_variations,
            "skip_expansion": True
        }
        
    except Exception as exc:
        logger.warning(f"[COMBINED] Fast path LLM failed: {exc}, using defaults")
        return {
            "query_category": "document_search",
            "detail_level": "concise",
            "query_variations": [user_query],
            "skip_expansion": True
        }


def _fallback_classification(user_query: str, property_id: str = None, conversation_history: list = None) -> Dict[str, Any]:
    """
    Fallback heuristic-based classification if LLM fails.
    """
    query_lower = user_query.lower()
    
    # Text transformation keywords
    transformation_keywords = ['make', 'reorganize', 'rewrite', 'improve', 'sharpen', 'concise', 'rephrase']
    transformation_refs = ['this', 'that', 'the above', 'previous response', 'pasted text']
    
    has_transformation_verb = any(kw in query_lower for kw in transformation_keywords)
    has_transformation_ref = any(ref in query_lower for ref in transformation_refs)
    
    if has_transformation_verb and has_transformation_ref:
        return {
            "query_category": "text_transformation",
            "detail_level": "concise",
            "query_variations": [user_query],
            "skip_expansion": True
        }
    
    # General query keywords
    general_keywords = ['what is the date', 'current date', 'explain', 'who is', 'capital of']
    if any(kw in query_lower for kw in general_keywords) and not property_id:
        return {
            "query_category": "general_query",
            "detail_level": "concise",
            "query_variations": [user_query],
            "skip_expansion": True
        }
    
    # Default to document_search
    return {
        "query_category": "document_search",
        "detail_level": "concise",
        "query_variations": [user_query],
        "skip_expansion": True
    }


def _get_last_document_search_entry(conversation_history: list) -> Optional[dict]:
    """Get last conversation entry that was a document search (has block_ids)"""
    if not conversation_history:
        return None
    
    for entry in reversed(conversation_history):
        if isinstance(entry, dict) and entry.get('block_ids'):
            return entry
    
    return None


def _build_history_context(conversation_history: list) -> str:
    """Build conversation context string for LLM"""
    if not conversation_history:
        return ""
    
    recent_history = conversation_history[-3:]
    history_lines = []
    
    for exchange in recent_history:
        if isinstance(exchange, dict):
            if 'query' in exchange and 'summary' in exchange:
                history_lines.append(f"Q: {exchange['query']}")
                history_lines.append(f"A: {exchange['summary'][:200]}...\n")
            elif 'role' in exchange and 'content' in exchange:
                role = exchange['role']
                content = exchange['content']
                if role == 'user':
                    history_lines.append(f"Q: {content}")
                elif role == 'assistant':
                    history_lines.append(f"A: {content[:200]}...\n")
    
    return "\n".join(history_lines)


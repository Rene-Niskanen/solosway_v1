"""
Retrieval nodes: Query classification, vector search, SQL search, deduplication, clarification.
"""

import json
import logging
import os
import re
import time
from typing import Optional, List, Dict, Any

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

from backend.llm.config import config
from backend.llm.types import MainWorkflowState, RetrievedDocument
from backend.llm.retrievers.vector_retriever import VectorDocumentRetriever
from backend.llm.retrievers.hybrid_retriever import HybridDocumentRetriever
from backend.llm.utils import reciprocal_rank_fusion
from backend.llm.utils.system_prompts import get_system_prompt
from backend.llm.prompts import (
    get_query_rewrite_human_content,
    get_query_expansion_human_content,
    get_query_routing_human_content,
    get_llm_sql_query_human_content,
    get_reranking_human_content
)
# SQLDocumentRetriever is still under development. Import when ready.
# from backend.llm.retrievers.sql_retriever import SQLDocumentRetriever

logger = logging.getLogger(__name__)


def _rewrite_query_keywords(query: str, conversation_history: List[Dict[str, Any]] = None) -> str:
    """
    Rule-based query rewriting using keyword patterns.
    Handles common property query patterns without LLM overhead.
    """
    if conversation_history is None:
        conversation_history = []
    
    rewritten = query
    query_lower = query.lower()
    words = query.split()
    
    # Extract property name from query (capitalized words, excluding common words)
    common_words = {'the', 'a', 'an', 'of', 'in', 'for', 'to', 'and', 'or', 'please', 'find', 'me', 'what', 'is', 'are', 'show', 'get', 'tell', 'who', 'how', 'why', 'when', 'where'}
    property_names = [w for w in words if len(w) > 3 and w[0].isupper() and w[1:].islower() and w.lower() not in common_words]
    
    # Expand value/price queries for better retrieval
    if any(term in query_lower for term in ['value', 'worth', 'valuation']):
        if 'market value' not in query_lower and 'valuation' not in query_lower:
            # Add synonyms for better BM25/vector matching
            rewritten = rewritten.replace('value', 'value valuation market value price worth')
        elif 'market value' not in query_lower:
            rewritten = rewritten.replace('valuation', 'valuation market value')
    
    # Expand bedroom/bathroom abbreviations (handles "5 bed" → "5 bedroom bedrooms")
    rewritten = re.sub(r'(\d+)\s+bed\b', r'\1 bedroom bedrooms bed', rewritten, flags=re.IGNORECASE)
    rewritten = re.sub(r'(\d+)\s+bath\b', r'\1 bathroom bathrooms bath', rewritten, flags=re.IGNORECASE)
    rewritten = re.sub(r'(\d+)\s+br\b', r'\1 bedroom bedrooms', rewritten, flags=re.IGNORECASE)
    rewritten = re.sub(r'(\d+)\s+ba\b', r'\1 bathroom bathrooms', rewritten, flags=re.IGNORECASE)
    
    # Normalize UK postcodes (AB12CD → AB1 2CD)
    postcode_pattern = r'\b([A-Z]{1,2}\d{1,2})\s?(\d[A-Z]{2})\b'
    def format_postcode(match):
        return f"{match.group(1)} {match.group(2)}"
    rewritten = re.sub(postcode_pattern, format_postcode, rewritten, flags=re.IGNORECASE)
    
    # Expand address-related queries
    if 'address' in query_lower and 'location' not in query_lower:
        rewritten = rewritten.replace('address', 'address location property address')
    
    # CRITICAL: Add property name/address from conversation history for follow-up questions
    # This ensures we don't retrieve information about the wrong property
    if conversation_history:
        # Extract from last assistant response and previous user query
        last_exchange = conversation_history[-1] if conversation_history else {}
        last_response = ''
        last_query = ''
        
        if isinstance(last_exchange, dict):
            if 'summary' in last_exchange:
                last_response = last_exchange['summary']
            elif 'content' in last_exchange and last_exchange.get('role') == 'assistant':
                last_response = last_exchange['content']
            if 'query' in last_exchange:
                last_query = last_exchange['query']
            elif 'content' in last_exchange and last_exchange.get('role') == 'user':
                last_query = last_exchange['content']
        
        # Also check previous exchanges for property context
        property_context = ''
        for exchange in reversed(conversation_history[-3:]):  # Check last 3 exchanges
            if isinstance(exchange, dict):
                text_to_search = ''
                if 'summary' in exchange:
                    text_to_search = exchange['summary']
                elif 'content' in exchange:
                    text_to_search = exchange['content']
                elif 'query' in exchange:
                    text_to_search = exchange['query']
                
                if text_to_search:
                    # Look for property addresses (common patterns)
                    # Pattern for UK addresses: "Property Name, Street, City, Postcode"
                    address_pattern = r'([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Road|Street|Lane|Drive|Avenue|Close|Way|Place)),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)'
                    address_match = re.search(address_pattern, text_to_search)
                    if address_match:
                        property_context = ' '.join(address_match.groups())
                        break
                    
                    # Look for property names (capitalized words that aren't common words)
                    words = text_to_search.split()
                    property_names_found = [w for w in words if len(w) > 3 and w[0].isupper() and w[1:].islower() and w.lower() not in common_words]
                    if property_names_found and not property_context:
                        # Prefer longer property names
                        property_context = max(property_names_found, key=len)
                    
                    # Look for postcodes (UK format: letters, numbers, space, letters, numbers)
                    postcode_pattern = r'[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2}'
                    postcode_match = re.search(postcode_pattern, text_to_search)
                    if postcode_match:
                        if property_context:
                            property_context = f"{property_context} {postcode_match.group()}"
                        else:
                            property_context = postcode_match.group()
        
        # If we found property context and it's not already in the query, add it
        if property_context and property_context.lower() not in query_lower:
            rewritten = f"{rewritten} {property_context}"
            logger.info(f"[REWRITE_QUERY] Added property context from history: {property_context}")
    
    # Clean up multiple spaces
    rewritten = ' '.join(rewritten.split())
    return rewritten.strip()


def _needs_llm_rewrite(query: str, conversation_history: List[Dict[str, Any]] = None) -> bool:
    """
    Determine if LLM-based rewrite is necessary.
    Returns False for most queries (use keyword rewrite), True only for complex cases.
    """
    if conversation_history is None:
        conversation_history = []
    
    query_lower = query.lower()
    words = query.split()
    
    # Skip LLM for queries with specific terms (these are already clear)
    specific_terms = ['value', 'price', 'worth', 'valuation', 'bedroom', 'bathroom', 'bed', 'bath', 
                      'address', 'postcode', 'epc', 'energy', 'size', 'sqft', 'square', 'footage',
                      'buyer', 'seller', 'valuer', 'surveyor', 'agent', 'owner']
    if any(term in query_lower for term in specific_terms):
        return False
    
    # Skip LLM for property name queries (capitalized words indicate specific property)
    if any(len(w) > 3 and w[0].isupper() and w[1:].islower() for w in words):
        return False
    
    # Skip LLM for postcode queries (UK format: AB1 2CD or AB12CD)
    if re.search(r'[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2}', query, re.IGNORECASE):
        return False
    
    # Skip LLM for short specific queries (< 6 words with question words)
    if len(words) < 6 and any(term in query_lower for term in ['what', 'how much', 'where', 'when', 'who']):
        return False
    
    # Skip LLM for queries with numbers (specific values, counts, etc.)
    if re.search(r'\d+', query):
        return False
    
    # Use LLM for vague queries that need context expansion
    vague_terms = ['tell me about', 'what can you', 'find information', 'show me', 'describe', 
                   'give me details', 'what do you know', 'explain']
    if any(term in query_lower for term in vague_terms):
        return True
    
    # Use LLM if query references previous conversation without context
    if conversation_history and any(ref in query_lower for ref in ['it', 'that', 'the property', 'the document', 'this', 'those']):
        return True
    
    # Use LLM for complex multi-concept queries
    complex_indicators = ['and', 'or', 'but', 'also', 'including', 'except']
    if len(words) > 8 and sum(1 for term in complex_indicators if term in query_lower) >= 2:
        return True
    
    # Default: skip LLM (keyword rewrite is sufficient for most queries)
    return False


def _should_expand_query(query: str) -> bool:
    """
    Determine if query expansion is necessary.
    
    Returns False (skip expansion) for:
    - Queries with property names (capitalized words > 3 chars)
    - Specific value queries ("£2.3m", "value of X", "price")
    - Short queries (< 5 words) with specific terms
    - Queries with postcodes (UK format: "AB1 2CD" or "AB12CD")
    - Queries with exact property identifiers (addresses, IDs)
    - Queries with numbers (specific counts, values)
    
    Returns True (require expansion) for:
    - Vague queries ("tell me about", "what can you find")
    - Conceptual queries ("foundation issues", "structural problems")
    - Multi-concept queries requiring synonyms
    - Queries with abstract terms needing expansion
    """
    query_lower = query.lower()
    words = query.split()
    
    # Skip expansion for queries with property names (capitalized words indicate specific property)
    if any(len(w) > 3 and w[0].isupper() and w[1:].islower() for w in words):
        logger.debug(f"[EXPAND_QUERY] Skipping expansion - query contains property name")
        return False
    
    # Skip expansion for postcode queries (UK format: AB1 2CD or AB12CD)
    if re.search(r'[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2}', query, re.IGNORECASE):
        logger.debug(f"[EXPAND_QUERY] Skipping expansion - query contains postcode")
        return False
    
    # Skip expansion for short specific queries (< 5 words with specific terms)
    specific_terms = ['value', 'price', 'worth', 'valuation', 'bedroom', 'bathroom', 'bed', 'bath',
                      'address', 'postcode', 'epc', 'energy', 'size', 'sqft', 'square', 'footage',
                      'buyer', 'seller', 'valuer', 'surveyor', 'agent', 'owner', 'date', 'when']
    if len(words) < 5 and any(term in query_lower for term in specific_terms):
        logger.debug(f"[EXPAND_QUERY] Skipping expansion - short query with specific term")
        return False
    
    # Skip expansion for queries with numbers (specific values, counts, etc.)
    if re.search(r'\d+', query):
        # Check if number is part of a specific query pattern
        number_patterns = [
            r'\d+\s*(bedroom|bed|bathroom|bath|br|ba)',  # "5 bedroom"
            r'£\s*\d+',  # "£2.3m" or "£2300000"
            r'\d+\s*(million|m|thousand|k)',  # "2.3 million"
            r'\d+\s*(sqft|sq\s*ft|square\s*feet)',  # "2500 sqft"
        ]
        if any(re.search(pattern, query, re.IGNORECASE) for pattern in number_patterns):
            logger.debug(f"[EXPAND_QUERY] Skipping expansion - query contains specific number pattern")
            return False
    
    # Skip expansion for queries with exact identifiers (UUIDs, IDs)
    uuid_pattern = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    if re.search(uuid_pattern, query, re.IGNORECASE):
        logger.debug(f"[EXPAND_QUERY] Skipping expansion - query contains UUID")
        return False
    
    # Require expansion for vague queries that need context
    vague_terms = ['tell me about', 'what can you', 'find information', 'show me', 'describe',
                   'give me details', 'what do you know', 'explain', 'what information',
                   'what details', 'what can you tell']
    if any(term in query_lower for term in vague_terms):
        logger.debug(f"[EXPAND_QUERY] Requiring expansion - vague query detected")
        return True
    
    # Require expansion for conceptual queries (benefit from synonym expansion)
    conceptual_terms = ['issue', 'problem', 'defect', 'damage', 'condition', 'quality',
                        'feature', 'amenity', 'characteristic', 'aspect', 'detail']
    if any(term in query_lower for term in conceptual_terms):
        logger.debug(f"[EXPAND_QUERY] Requiring expansion - conceptual query detected")
        return True
    
    # Require expansion for multi-concept queries (need synonym coverage)
    complex_indicators = ['and', 'or', 'but', 'also', 'including', 'except', 'plus']
    if len(words) > 6 and sum(1 for term in complex_indicators if term in query_lower) >= 2:
        logger.debug(f"[EXPAND_QUERY] Requiring expansion - complex multi-concept query")
        return True
    
    # Default: skip expansion for most queries (keyword-based retrieval is sufficient)
    # Only expand when we're confident it will help
    logger.debug(f"[EXPAND_QUERY] Default: skipping expansion for query")
    return False


def check_cached_documents(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Check for Cached Documents from Previous Conversation Turns
    
    For follow-up questions about the same property, reuse previously retrieved documents
    instead of performing a new search. This dramatically speeds up follow-up queries.
    
    Logic:
    1. Check if there are cached documents from previous conversation turns (via checkpointer)
    2. Extract property context from current query and conversation history
    3. If property context matches, reuse cached documents
    4. If property context differs or no cache exists, clear cache and proceed with normal retrieval
    
    Args:
        state: MainWorkflowState with user_query, conversation_history, and potentially cached relevant_documents
        
    Returns:
        Updated state with cached documents if applicable, or empty dict to proceed with normal retrieval
    """
    conversation_history = state.get('conversation_history', []) or []
    user_query = state.get('user_query', '')
    
    # Check if there are cached documents from previous state (loaded from checkpointer)
    cached_docs = state.get('relevant_documents', [])
    
    # If no conversation history AND no cached docs, proceed with normal retrieval
    if (not conversation_history or len(conversation_history) == 0) and (not cached_docs or len(cached_docs) == 0):
        logger.debug("[CHECK_CACHED_DOCS] No conversation history and no cached documents - proceeding with normal retrieval")
        return {}  # No changes, proceed with normal flow
    
    # If no cached docs but we have history, proceed with normal retrieval
    if not cached_docs or len(cached_docs) == 0:
        logger.debug("[CHECK_CACHED_DOCS] No cached documents found - proceeding with normal retrieval")
        return {}  # No cached docs, proceed with normal retrieval
    
    logger.info(f"[CHECK_CACHED_DOCS] Found {len(cached_docs)} cached documents from previous conversation")
    
    # Extract property context from current query
    current_property_context = _extract_property_context(user_query, conversation_history)
    
    # Extract property context from previous conversation
    previous_property_context = _extract_property_context_from_history(conversation_history)
    
    # Check if property contexts match (same property)
    if current_property_context and previous_property_context:
        # Normalize for comparison (case-insensitive, whitespace-insensitive)
        current_normalized = ' '.join(current_property_context.lower().split())
        previous_normalized = ' '.join(previous_property_context.lower().split())
        
        # Check if they match (allowing for partial matches)
        if current_normalized in previous_normalized or previous_normalized in current_normalized:
            logger.info(f"[CHECK_CACHED_DOCS] ✅ Property context matches - reusing {len(cached_docs)} cached documents")
            logger.info(f"[CHECK_CACHED_DOCS] Current context: '{current_property_context}', Previous: '{previous_property_context}'")
            return {"relevant_documents": cached_docs}  # Return cached documents
        else:
            logger.info(f"[CHECK_CACHED_DOCS] ❌ Property context differs - clearing cache and proceeding with new retrieval")
            logger.info(f"[CHECK_CACHED_DOCS] Current: '{current_property_context}', Previous: '{previous_property_context}'")
            return {"relevant_documents": []}  # Clear cache, proceed with normal retrieval
    elif current_property_context:
        # Current query has property context but previous doesn't - check if current matches cached docs
        logger.info(f"[CHECK_CACHED_DOCS] Current query has property context: '{current_property_context}'")
        # Check if cached docs are about the current property by examining document metadata
        if _documents_match_property(cached_docs, current_property_context):
            logger.info(f"[CHECK_CACHED_DOCS] ✅ Cached documents match current property context - reusing {len(cached_docs)} documents")
            return {"relevant_documents": cached_docs}
        else:
            logger.info(f"[CHECK_CACHED_DOCS] ❌ Cached documents don't match current property - clearing cache and proceeding with new retrieval")
            return {"relevant_documents": []}  # Clear cache
    elif previous_property_context:
        # Previous had property context but current doesn't - likely same conversation, reuse cache
        logger.info(f"[CHECK_CACHED_DOCS] ✅ No property context in current query, but previous had context - reusing {len(cached_docs)} cached documents")
        return {"relevant_documents": cached_docs}
    else:
        # No property context in either - likely same conversation, reuse cache
        logger.info(f"[CHECK_CACHED_DOCS] ✅ No property context in query or history - reusing {len(cached_docs)} cached documents (likely same conversation)")
        return {"relevant_documents": cached_docs}


def _extract_property_context(query: str, conversation_history: List[Dict[str, Any]] = None) -> str:
    """
    Extract property name/address/postcode from query and conversation history.
    
    Returns:
        Property context string (name, address, or postcode) or empty string
    """
    if conversation_history is None:
        conversation_history = []
    
    context_parts = []
    
    # Extract from current query
    query_lower = query.lower()
    
    # Look for postcodes (UK format)
    postcode_pattern = r'\b[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2}\b'
    postcode_matches = re.findall(postcode_pattern, query, re.IGNORECASE)
    if postcode_matches:
        context_parts.extend(postcode_matches)
    
    # Look for property names (capitalized words)
    common_words = {'the', 'a', 'an', 'of', 'in', 'for', 'to', 'and', 'or', 'please', 'find', 'me', 'what', 'is', 'are', 'show', 'get', 'tell', 'who', 'how', 'why', 'when', 'where', 'property', 'value', 'valuation', 'market'}
    words = query.split()
    property_names = [w for w in words if len(w) > 3 and w[0].isupper() and w[1:].islower() and w.lower() not in common_words]
    if property_names:
        context_parts.extend(property_names[:2])  # Take first 2 property name words
    
    # Extract from conversation history if not found in query
    if not context_parts and conversation_history:
        for exchange in reversed(conversation_history[-3:]):  # Check last 3 exchanges
            if isinstance(exchange, dict):
                text_to_search = ''
                if 'summary' in exchange:
                    text_to_search = exchange['summary']
                elif 'content' in exchange:
                    text_to_search = exchange['content']
                elif 'query' in exchange:
                    text_to_search = exchange['query']
                
                if text_to_search:
                    # Look for addresses
                    address_pattern = r'([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Road|Street|Lane|Drive|Avenue|Close|Way|Place)),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)'
                    address_match = re.search(address_pattern, text_to_search)
                    if address_match:
                        context_parts.append(' '.join(address_match.groups()))
                        break
                    
                    # Look for postcodes
                    postcode_matches = re.findall(postcode_pattern, text_to_search, re.IGNORECASE)
                    if postcode_matches:
                        context_parts.extend(postcode_matches)
                        break
                    
                    # Look for property names
                    words = text_to_search.split()
                    property_names = [w for w in words if len(w) > 3 and w[0].isupper() and w[1:].islower() and w.lower() not in common_words]
                    if property_names:
                        context_parts.append(max(property_names, key=len))  # Take longest property name
                        break
    
    return ' '.join(context_parts[:3]) if context_parts else ''  # Return first 3 context parts


def _extract_property_context_from_history(conversation_history: List[Dict[str, Any]]) -> str:
    """
    Extract property context from conversation history (previous queries/responses).
    
    Returns:
        Property context string or empty string
    """
    if not conversation_history:
        return ''
    
    # Check last few exchanges for property context
    for exchange in reversed(conversation_history[-3:]):
        if isinstance(exchange, dict):
            text_to_search = ''
            if 'summary' in exchange:
                text_to_search = exchange['summary']
            elif 'content' in exchange:
                text_to_search = exchange['content']
            elif 'query' in exchange:
                text_to_search = exchange['query']
            
            if text_to_search:
                context = _extract_property_context(text_to_search, [])
                if context:
                    return context
    
    return ''


def _documents_match_property(documents: List[RetrievedDocument], property_context: str) -> bool:
    """
    Check if cached documents are about the specified property.
    
    Args:
        documents: List of cached RetrievedDocument objects
        property_context: Property name/address/postcode to match
        
    Returns:
        True if documents match the property, False otherwise
    """
    if not documents or not property_context:
        return False
    
    property_lower = property_context.lower()
    
    # Check document metadata for property matches
    for doc in documents[:5]:  # Check first 5 documents
        # Check document ID/filename
        doc_id = str(doc.get('document_id', '')).lower()
        doc_metadata = doc.get('metadata', {})
        filename = doc_metadata.get('original_filename', '').lower()
        source = doc_metadata.get('source', '').lower()
        
        # Check if property context appears in document identifiers
        if property_lower in doc_id or property_lower in filename or property_lower in source:
            return True
        
        # Check document content (first 500 chars)
        content = str(doc.get('content', ''))[:500].lower()
        if property_lower in content:
            return True
    
    return False


def rewrite_query_with_context(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Query Rewriting with Conversation Context
    
    Uses keyword-based rewriting for most queries (fast, no LLM).
    Falls back to LLM rewriting only for complex/vague queries.
    
    Examples:
        "What's the price?" → "What's the price for Highlands, Berden Road property?"
        "Review the document" → "Review Highlands_Berden_Bishops_Stortford valuation report"
        "Show amenities" → "Show amenities for the 5-bedroom property at Highlands"
    
    Args:
        state: MainWorkflowState with user_query and conversation_history
        
    Returns:
        Updated state with rewritten user_query (or unchanged if no context needed)
    """
    conversation_history = state.get('conversation_history', []) or []
    user_query = state.get('user_query', '')
    
    # Check if LLM rewrite is needed
    if not _needs_llm_rewrite(user_query, conversation_history):
        # Use fast keyword-based rewrite
        rewritten = _rewrite_query_keywords(user_query, conversation_history)
        if rewritten != user_query:
            logger.info(f"[REWRITE_QUERY] Keyword rewrite: '{user_query[:50]}...' -> '{rewritten[:50]}...'")
            return {"user_query": rewritten}
        logger.debug(f"[REWRITE_QUERY] No rewrite needed for query: '{user_query[:50]}...'")
        return {}  # No changes needed
    
    # Proceed with LLM rewrite for complex queries (existing code below)
    logger.info(f"[REWRITE_QUERY] Using LLM rewrite for complex query: '{user_query[:50]}...'")
    
    # Skip if no conversation history (original query is fine)
    if not conversation_history or len(conversation_history) == 0:
        logger.info("[REWRITE_QUERY] No conversation history, using original query")
        return {}  # No changes to state
    
    # PERFORMANCE OPTIMIZATION: Use faster/cheaper model for query rewriting
    # gpt-3.5-turbo is much faster and cheaper than gpt-4 for this task
    rewrite_model = os.getenv("OPENAI_REWRITE_MODEL", "gpt-3.5-turbo")
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=rewrite_model,  # Use faster model for rewriting
        temperature=0,
    )
    
    # Build conversation context (last 2 exchanges)
    recent_history = state['conversation_history'][-2:]
    history_lines = []
    for exchange in recent_history:
        # Handle different conversation history formats:
        # Format 1: From summary_nodes (has 'query' and 'summary')
        # Format 2: From frontend/views (has 'role' and 'content')
        if 'query' in exchange and 'summary' in exchange:
            # Format from summary_nodes
            history_lines.append(f"User asked: {exchange['query']}")
            summary_preview = exchange['summary'][:400].replace('\n', ' ')
            history_lines.append(f"Assistant responded: {summary_preview}...")
        elif 'role' in exchange and 'content' in exchange:
            # Format from frontend (role-based messages)
            role = exchange['role']
            content = exchange['content']
            if role == 'user':
                history_lines.append(f"User asked: {content}")
            elif role == 'assistant':
                content_preview = content[:400].replace('\n', ' ')
                history_lines.append(f"Assistant responded: {content_preview}...")
        else:
            # Skip malformed entries
            logger.warning(f"[REWRITE_QUERY] Skipping malformed conversation entry: {exchange.keys()}")
            continue
    
    history_context = "\n".join(history_lines)
    
    # Get system prompt for rewrite task
    system_msg = get_system_prompt('rewrite')
    
    # Get human message content
    human_content = get_query_rewrite_human_content(
        user_query=state['user_query'],
        conversation_history=history_context
    )
    
    try:
        # Use LangGraph message format
        messages = [system_msg, HumanMessage(content=human_content)]
        response = llm.invoke(messages)
        rewritten = response.content.strip().strip('"').strip("'")  # Clean quotes
        
        # Only use rewritten if it's different and not too long
        if rewritten != state['user_query'] and len(rewritten) < 500:
            logger.info(f"[REWRITE_QUERY]   Original: '{state['user_query']}'")
            logger.info(f"[REWRITE_QUERY]  Rewritten: '{rewritten}'")
            return {"user_query": rewritten}
        else:
            logger.info("[REWRITE_QUERY]   No rewrite needed")
            return {}
            
    except Exception as exc:
        logger.error(f"[REWRITE_QUERY]  Failed to rewrite: {exc}")
        return {}  # Keep original query on error


def expand_query_for_retrieval(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Query Expansion for Better Recall
    
    Generates query variations to catch different phrasings and synonyms.
    Now uses smart heuristics to skip expansion for simple, specific queries.
    
    Examples:
        "foundation issues" → ["foundation issues", "foundation damage and structural problems", 
                               "concrete defects and settlement issues"]
        "What's the price?" → ["What's the price?", "property sale price and valuation",
                               "market value and asking price"]
    
    Args:
        state: MainWorkflowState with user_query
        
    Returns:
        Updated state with query_variations list
    """
    
    original_query = state['user_query']
    
    # Check if expansion is needed using smart heuristics
    enable_smart_expansion = os.getenv("ENABLE_SMART_EXPANSION", "true").lower() == "true"
    
    if enable_smart_expansion and not _should_expand_query(original_query):
        logger.info(f"[EXPAND_QUERY] Skipping expansion for simple query: '{original_query[:50]}...'")
        return {"query_variations": [original_query]}  # Return original query as single variation
    
    # PERFORMANCE OPTIMIZATION: Use faster/cheaper model for query expansion
    # gpt-3.5-turbo is much faster and cheaper than gpt-4 for this task
    expansion_model = os.getenv("OPENAI_EXPANSION_MODEL", "gpt-3.5-turbo")
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=expansion_model,  # Use faster model for expansion
        temperature=0.4,  # Slight creativity for variations
    )
    
    # Get system prompt for expansion task
    system_msg = get_system_prompt('expand')
    
    # Get human message content
    human_content = get_query_expansion_human_content(original_query=original_query)
    
    try:
        # Use LangGraph message format
        messages = [system_msg, HumanMessage(content=human_content)]
        response = llm.invoke(messages)
        variations = [v.strip() for v in response.content.strip().split('\n') if v.strip()]
        
        # Limit to 2 variations
        variations = variations[:2]
        
        # Combine: original + variations
        all_queries = [original_query] + variations
        
        logger.info(f"[EXPAND_QUERY] Generated {len(variations)} variations:")
        for i, q in enumerate(all_queries, 1):
            logger.info(f"  {i}. {q}")
        
        return {"query_variations": all_queries}
        
    except Exception as exc:
        logger.error(f"[EXPAND_QUERY] Failed to expand query: {exc}")
        return {"query_variations": [original_query]}


def route_query(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Route/Classify Query Intent 

    Uses LLM to classify query as semantic, structured, or hybrid.
    This determines which retrieval paths to activate.
    Now includes conversation history for context-aware classification.

    Args:
        state: MainWorkflowState with user_query and conversation_history

    Returns:
        Updated state with query_intent
    """
    
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )

    # Build conversation context if history exists
    history_context = ""
    if state.get('conversation_history'):
        recent_history = state['conversation_history'][-3:]  # Last 3 exchanges
        history_lines = []
        for exchange in recent_history:
            # Handle different conversation history formats
            if 'query' in exchange and 'summary' in exchange:
                # Format from summary_nodes
                history_lines.append(f"User: {exchange['query']}")
                history_lines.append(f"Assistant: {exchange['summary'][:200]}...")
            elif 'role' in exchange and 'content' in exchange:
                # Format from frontend (role-based messages)
                role = exchange['role']
                content = exchange['content']
                if role == 'user':
                    history_lines.append(f"User: {content}")
                elif role == 'assistant':
                    history_lines.append(f"Assistant: {content[:200]}...")
        if history_lines:
            history_context = f"\n\nPrevious conversation:\n" + "\n".join(history_lines)

    # Get system prompt for classification task
    system_msg = get_system_prompt('classify')
    
    # Get human message content
    human_content = get_query_routing_human_content(
        user_query=state['user_query'],
        conversation_history=history_context
    )
    
    # Use LangGraph message format
    messages = [system_msg, HumanMessage(content=human_content)]
    response = llm.invoke(messages)
    intent = response.content.lower().strip()

    if intent not in {"semantic", "structured", "hybrid"}:
        logger.warning("Invalid intent '%s', defaulting to 'hybrid'", intent)
        intent = "hybrid"

    logger.info("[ROUTE_QUERY] Classified query as: %s", intent)
    return {"query_intent": intent}


def query_vector_documents(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Hybrid Search (BM25 + Vector) with Lazy Embedding Support + Structured Query Fallback

    Uses hybrid retriever combining:
    - BM25 (lexical) for exact matches (addresses, postcodes, IDs) - works on ALL chunks
    - Vector (semantic) for conceptual matches - only embedded chunks
    - Triggers lazy embedding for unembedded chunks found by BM25
    - Structured query fallback: For property-specific queries (bedrooms, bathrooms, etc.), 
      queries property_details table directly for fast, accurate results
    
    This dramatically improves recall and handles lazy embedding seamlessly.
    
    PERFORMANCE OPTIMIZATION: If relevant_documents already exist (from cache), skip retrieval.

    Args:
        state: MainWorkflowState with user_query, query_variations, business_id

    Returns:
        Updated state with hybrid search results appended to relevant_documents
    """
    # PERFORMANCE OPTIMIZATION: Check if documents were already retrieved from cache
    existing_docs = state.get('relevant_documents', [])
    if existing_docs and len(existing_docs) > 0:
        logger.info(f"[QUERY_VECTOR_DOCUMENTS] Skipping retrieval - {len(existing_docs)} documents already cached from previous conversation")
        return {}  # No changes needed, use cached documents
    
    node_start = time.time()
    user_query = state.get('user_query', '')
    logger.info(f"[QUERY_VECTOR_DOCUMENTS] Starting retrieval for query: '{user_query[:50]}...'")

    try:
        # STEP 1: Check if query is property-specific (bedrooms, bathrooms, price, etc.)
        # If so, query property_details table directly for fast, accurate results
        user_query = state.get('user_query', '').lower()
        business_id = state.get("business_id")
        
        structured_results = []
        if business_id and any(term in user_query for term in ['bedroom', 'bathroom', 'bed', 'bath', 'price', 'square', 'sqft', 'sq ft']):
            try:
                from backend.services.supabase_client_factory import get_supabase_client
                supabase = get_supabase_client()
                
                # Extract numbers from query (e.g., "5 bedroom" -> 5)
                # Handle plurals, abbreviations, and variations
                import re
                # Match: "5 bedroom", "5 bedrooms", "5 bed", "5 beds", "5BR", "5 br", etc.
                bedroom_patterns = [
                    r'(\d+)\s*(?:bedroom|bedrooms|bed|beds|br|brs)\b',
                    r'(\d+)\s*-\s*(?:bedroom|bed|br)',
                    r'(?:bedroom|bed|br)\s*[:=]\s*(\d+)',
                ]
                bedroom_match = None
                for pattern in bedroom_patterns:
                    bedroom_match = re.search(pattern, user_query, re.IGNORECASE)
                    if bedroom_match:
                        break
                
                # Match: "5 bathroom", "5 bathrooms", "5 bath", "5 baths", "5BA", "5 ba", etc.
                bathroom_patterns = [
                    r'(\d+)\s*(?:bathroom|bathrooms|bath|baths|ba|bas)\b',
                    r'(\d+)\s*-\s*(?:bathroom|bath|ba)',
                    r'(?:bathroom|bath|ba)\s*[:=]\s*(\d+)',
                ]
                bathroom_match = None
                for pattern in bathroom_patterns:
                    bathroom_match = re.search(pattern, user_query, re.IGNORECASE)
                    if bathroom_match:
                        break
                
                logger.info(f"[QUERY_STRUCTURED] Extracted - Bedrooms: {bedroom_match.group(1) if bedroom_match else None}, Bathrooms: {bathroom_match.group(1) if bathroom_match else None}")
                
                # SECURITY: First get property_ids for this business to ensure multi-tenancy
                # This prevents querying other companies' property_details
                business_properties = supabase.table('properties')\
                    .select('id')\
                    .eq('business_uuid', business_id)\
                    .execute()
                
                if not business_properties.data:
                    logger.info(f"[QUERY_STRUCTURED] No properties found for business {business_id}")
                    property_results = type('obj', (object,), {'data': []})()  # Empty result
                else:
                    business_property_ids = [p['id'] for p in business_properties.data]
                    logger.info(f"[QUERY_STRUCTURED] Filtering property_details for {len(business_property_ids)} properties in business")
                    
                    # Build property_details query - ONLY for this business's properties
                property_query = supabase.table('property_details')\
                        .select('property_id, number_bedrooms, number_bathrooms')\
                        .in_('property_id', business_property_ids)  # CRITICAL: Filter by business
                
                if bedroom_match:
                    bedrooms = int(bedroom_match.group(1))
                    property_query = property_query.eq('number_bedrooms', bedrooms)
                
                if bathroom_match:
                    bathrooms = int(bathroom_match.group(1))
                    property_query = property_query.eq('number_bathrooms', bathrooms)
                
                # Get properties matching criteria (exact match first)
                property_results = property_query.execute()
                
                # RETRY LOGIC: If no exact matches, try similarity-based search
                if not property_results.data and (bedroom_match or bathroom_match) and business_properties.data:
                    logger.info(f"[QUERY_STRUCTURED] No exact matches found, trying similarity-based search...")
                    
                    business_property_ids = [p['id'] for p in business_properties.data]
                    
                    # Try ranges: ±1 bedroom/bathroom - STILL FILTERED BY BUSINESS
                    similarity_query = supabase.table('property_details')\
                        .select('property_id, number_bedrooms, number_bathrooms')\
                        .in_('property_id', business_property_ids)  # CRITICAL: Filter by business
                    
                    if bedroom_match:
                        bedrooms = int(bedroom_match.group(1))
                        # Try range: bedrooms-1 to bedrooms+1
                        similarity_query = similarity_query.gte('number_bedrooms', max(1, bedrooms - 1))\
                            .lte('number_bedrooms', bedrooms + 1)
                        logger.info(f"[QUERY_STRUCTURED] Trying bedroom range: {max(1, bedrooms - 1)}-{bedrooms + 1}")
                    
                    if bathroom_match:
                        bathrooms = int(bathroom_match.group(1))
                        # Try range: bathrooms-1 to bathrooms+1
                        similarity_query = similarity_query.gte('number_bathrooms', max(1, bathrooms - 1))\
                            .lte('number_bathrooms', bathrooms + 1)
                        logger.info(f"[QUERY_STRUCTURED] Trying bathroom range: {max(1, bathrooms - 1)}-{bathrooms + 1}")
                    
                    property_results = similarity_query.execute()
                    if property_results.data:
                        logger.info(f"[QUERY_STRUCTURED] Found {len(property_results.data)} similar properties (not exact matches)")
                
                if property_results.data:
                    # Get document_ids for these properties
                    property_ids = [p['property_id'] for p in property_results.data]
                    
                    # Get documents linked to these properties
                    doc_results = supabase.table('document_relationships')\
                        .select('document_id, property_id')\
                        .in_('property_id', property_ids)\
                        .execute()
                    
                    if doc_results.data:
                        # Get document details including document_summary for party names
                        doc_ids = list(set([d['document_id'] for d in doc_results.data]))
                        docs = supabase.table('documents')\
                            .select('id, original_filename, classification_type, document_summary')\
                            .in_('id', doc_ids)\
                            .eq('business_uuid', business_id)\
                            .execute()
                        
                        # Get property addresses - FILTER BY BUSINESS for security
                        addresses = supabase.table('properties')\
                            .select('id, formatted_address')\
                            .in_('id', property_ids)\
                            .eq('business_uuid', business_id)\
                            .execute()
                        
                        address_map = {a['id']: a['formatted_address'] for a in addresses.data}
                        
                        # Get property_details for each property to prepend to content
                        property_details_map = {}
                        if property_ids:
                            try:
                                prop_details = supabase.table('property_details')\
                                    .select('property_id, number_bedrooms, number_bathrooms, property_type, size_sqft, size_unit, asking_price, sold_price, rent_pcm, epc_rating, tenure, condition, other_amenities, notes')\
                                    .in_('property_id', property_ids)\
                                    .execute()
                                property_details_map = {pd['property_id']: pd for pd in prop_details.data}
                                logger.info(f"[QUERY_STRUCTURED] Fetched property_details for {len(property_details_map)} properties")
                            except Exception as e:
                                logger.warning(f"[QUERY_STRUCTURED] Failed to fetch property_details: {e}")
                        
                        # Fetch actual chunks from document_vectors for each document
                        for doc in docs.data:
                            # Find property_id for this document
                            prop_id = next((dr['property_id'] for dr in doc_results.data if dr['document_id'] == doc['id']), None)
                            
                            # Get property details for this property
                            prop_details = property_details_map.get(prop_id, {}) if prop_id else {}
                            
                            # Extract party names from document_summary
                            party_names_context = ""
                            try:
                                import json
                                document_summary = doc.get('document_summary')
                                if document_summary:
                                    # Handle both dict and JSON string formats
                                    if isinstance(document_summary, str):
                                        try:
                                            document_summary = json.loads(document_summary)
                                            if isinstance(document_summary, str):
                                                document_summary = json.loads(document_summary)
                                        except (json.JSONDecodeError, TypeError):
                                            document_summary = None
                                    
                                    if isinstance(document_summary, dict):
                                        party_names = document_summary.get('party_names', {})
                                        if party_names:
                                            name_parts = []
                                            if valuer := party_names.get('valuer'):
                                                name_parts.append(f"Valuer: {valuer}")
                                            if seller := party_names.get('seller'):
                                                name_parts.append(f"Seller: {seller}")
                                            if buyer := party_names.get('buyer'):
                                                name_parts.append(f"Buyer: {buyer}")
                                            if agent := party_names.get('estate_agent'):
                                                name_parts.append(f"Estate Agent: {agent}")
                                            
                                            if name_parts:
                                                party_names_context = "PARTY_NAMES: " + " | ".join(name_parts) + "\n\n"
                            except Exception as e:
                                logger.debug(f"[QUERY_STRUCTURED] Could not extract party names: {e}")
                            
                            # Build property details context to prepend to chunks
                            # This is VERIFIED information from the property database (including manually updated values)
                            property_context = ""
                            if prop_details:
                                context_parts = []
                                if prop_details.get('number_bedrooms') is not None:
                                    context_parts.append(f"{prop_details['number_bedrooms']} bedroom(s)")
                                if prop_details.get('number_bathrooms') is not None:
                                    context_parts.append(f"{prop_details['number_bathrooms']} bathroom(s)")
                                if prop_details.get('property_type'):
                                    context_parts.append(f"Type: {prop_details['property_type']}")
                                if prop_details.get('size_sqft'):
                                    size_value = prop_details['size_sqft']
                                    size_unit = prop_details.get('size_unit', '').lower() if prop_details.get('size_unit') else ''
                                    # Only show as acres if explicitly stated in size_unit field
                                    if size_unit in ('acres', 'acre'):
                                        context_parts.append(f"Size: {size_value:,.2f} acres")
                                    else:
                                        context_parts.append(f"Size: {size_value:,.0f} sqft")
                                if prop_details.get('asking_price'):
                                    context_parts.append(f"Asking price: £{prop_details['asking_price']:,.0f}")
                                if prop_details.get('sold_price'):
                                    context_parts.append(f"Sold price: £{prop_details['sold_price']:,.0f}")
                                if prop_details.get('rent_pcm'):
                                    context_parts.append(f"Rent (pcm): £{prop_details['rent_pcm']:,.0f}")
                                if prop_details.get('tenure'):
                                    context_parts.append(f"Tenure: {prop_details['tenure']}")
                                if prop_details.get('epc_rating'):
                                    context_parts.append(f"EPC: {prop_details['epc_rating']}")
                                if prop_details.get('condition'):
                                    context_parts.append(f"Condition: {prop_details['condition']}")
                                
                                if context_parts:
                                    # Make it very clear this is verified property information
                                    property_context = f"""PROPERTY DETAILS (VERIFIED FROM DATABASE - INCLUDES MANUALLY UPDATED VALUES):
This property has: {', '.join(context_parts)}.

This information has been verified and extracted from the property database, including any manually updated values. The document below may contain additional details about this property.

"""
                            
                            # Fetch chunks for this document
                            # First, try to find chunks that contain bedroom/bathroom keywords for better relevance
                            keyword_chunks = []
                            if bedroom_match or bathroom_match:
                                keywords = []
                                if bedroom_match:
                                    keywords.extend(['bedroom', 'bedrooms', 'bed', 'beds'])
                                if bathroom_match:
                                    keywords.extend(['bathroom', 'bathrooms', 'bath', 'baths'])
                                
                                # Fetch all chunks for this document to search for keywords
                                all_chunks = supabase.table('document_vectors')\
                                    .select('chunk_text, chunk_index, page_number, embedding_status')\
                                    .eq('document_id', doc['id'])\
                                    .execute()
                                
                                # Filter chunks that contain bedroom/bathroom keywords
                                for chunk in all_chunks.data:
                                    chunk_text_lower = (chunk.get('chunk_text', '') or '').lower()
                                    if any(kw in chunk_text_lower for kw in keywords):
                                        keyword_chunks.append(chunk)
                                
                                # Sort by chunk_index and take up to 10 keyword chunks
                                keyword_chunks.sort(key=lambda x: x.get('chunk_index', 0))
                                keyword_chunks = keyword_chunks[:10]
                                
                                # Use the keyword chunks as the base, then add sequential chunks for context
                                chunk_indices_seen = set(c.get('chunk_index') for c in keyword_chunks)
                                all_chunks_list = list(keyword_chunks)
                                
                                # Add sequential chunks that weren't already included (for context)
                                for chunk in all_chunks.data:
                                    if chunk.get('chunk_index') not in chunk_indices_seen and len(all_chunks_list) < 20:
                                        all_chunks_list.append(chunk)
                                        chunk_indices_seen.add(chunk.get('chunk_index'))
                                
                                # Sort by chunk_index for proper ordering
                                all_chunks_list.sort(key=lambda x: x.get('chunk_index', 0))
                                
                                # Create a mock result object with the combined chunks
                                class MockResult:
                                    def __init__(self, data):
                                        self.data = data
                                chunks_result = MockResult(all_chunks_list[:20])
                            else:
                                # No keyword search needed, just fetch sequential chunks
                                chunks_result = (supabase.table('document_vectors')
                                    .select('chunk_text, chunk_index, page_number, embedding_status')
                                    .eq('document_id', doc['id'])
                                    .order('chunk_index')
                                    .limit(20)  # Get more chunks for better context
                                    .execute())
                            
                            # Combine chunks into content
                            chunk_texts = []
                            has_unembedded = False
                            
                            if chunks_result.data:
                                for chunk in chunks_result.data:
                                    chunk_text = chunk.get('chunk_text', '').strip()
                                    if chunk_text and len(chunk_text) > 10:  # Filter out very short chunks
                                        chunk_texts.append(chunk_text)
                                    
                                    # Track unembedded chunks for lazy embedding
                                    if chunk.get('embedding_status') == 'pending':
                                        has_unembedded = True
                                
                                # Combine chunks with separators and prepend party names + property context
                                if chunk_texts:
                                    combined_content = party_names_context + property_context + "\n\n---\n\n".join(chunk_texts)
                                    logger.debug(f"[QUERY_STRUCTURED] Fetched {len(chunk_texts)} chunks for doc {doc['id'][:8]}, total length: {len(combined_content)} chars")
                                else:
                                    # Fallback: use property details if chunks are empty
                                    combined_content = party_names_context + property_context + f"Property with matching criteria from {doc.get('original_filename', 'document')}. Document chunks are being processed."
                                
                                # Trigger lazy embedding for this document if chunks are unembedded (edge case: legacy documents)
                                # Note: All new documents are embedded upfront, so this should rarely trigger
                                if has_unembedded:
                                    try:
                                        from backend.tasks import embed_document_chunks_lazy
                                        embed_document_chunks_lazy.delay(str(doc['id']), business_id)
                                        logger.info(f"[QUERY_STRUCTURED] Triggered lazy embedding for document {doc['id'][:8]} (legacy document)")
                                    except Exception as e:
                                        logger.warning(f"[QUERY_STRUCTURED] Failed to trigger lazy embedding: {e}")
                            else:
                                # No chunks found, use property details as fallback
                                combined_content = party_names_context + property_context + f"Property with matching criteria from {doc.get('original_filename', 'document')}. Document chunks are being processed."
                                logger.warning(f"[QUERY_STRUCTURED] No chunks found for document {doc['id'][:8]}, using property details only")
                            
                            # Get page numbers from chunks
                            page_numbers = sorted(set(
                                c.get('page_number') for c in chunks_result.data 
                                if c.get('page_number') and c.get('page_number') > 0
                            )) if chunks_result.data else []
                            
                            structured_results.append({
                                'doc_id': doc['id'],
                                'document_id': doc['id'],
                                'property_id': prop_id,
                                'property_address': address_map.get(prop_id, 'Unknown'),
                                'original_filename': doc.get('original_filename', ''),
                                'classification_type': doc.get('classification_type', ''),
                                'content': combined_content,  # Actual chunk content!
                                'similarity_score': 1.0,  # High score for exact matches
                                'source': 'structured_query',
                                'chunk_index': 0,  # Single merged result
                                'page_number': page_numbers[0] if page_numbers else None,
                                'page_numbers': page_numbers
                            })
                        
                        logger.info(f"[QUERY_STRUCTURED] Found {len(structured_results)} documents via property_details query with {sum(len(r.get('content', '').split('---')) for r in structured_results)} chunks")
                else:
                    logger.warning(f"[QUERY_STRUCTURED] No properties found matching criteria")
            except Exception as e:
                logger.warning(f"[QUERY_STRUCTURED] Structured query failed: {e}")
                import traceback
                logger.debug(traceback.format_exc())
        
        # STEP 2: Use hybrid retriever (BM25 + Vector with lazy embedding triggers)
        hybrid_start = time.time()
        retriever = HybridDocumentRetriever()
        
        # Get query variations (or just original if expansion didn't run)
        queries = state.get('query_variations', [state['user_query']])
        logger.info(f"[QUERY_VECTOR_DOCUMENTS] Running hybrid search for {len(queries)} query variation(s)")
        
        # Search with each query variation using hybrid retriever
        all_results = []
        for i, query in enumerate(queries, 1):
            query_start = time.time()
            # Adjust top_k based on detail_level
            detail_level = state.get('detail_level', 'concise')
            if detail_level == 'detailed':
                top_k = int(os.getenv("INITIAL_RETRIEVAL_TOP_K_DETAILED", "50"))  # More chunks for detailed mode
            else:
                top_k = int(os.getenv("INITIAL_RETRIEVAL_TOP_K", "20"))  # Fewer chunks for concise mode
            
            # NEW: Header-Priority Retrieval (Pass 1)
            # Search for chunks with matching section headers first, then boost them in results
            # Query-driven: Uses query terms directly to find relevant section headers
            header_results = []
            relevant_headers = None
            from backend.llm.utils.section_header_matcher import get_relevant_section_headers, should_use_header_retrieval
            from backend.llm.utils.section_header_detector import _normalize_header
            import re
            
            document_type = state.get("classification_type")
            if should_use_header_retrieval(query, document_type):
                # Build query-driven header search terms
                # Strategy: Use query terms directly + mapped section headers as enhancement
                query_lower = query.lower()
                query_words = [re.sub(r'[^\w\s]', '', w) for w in query_lower.split() if len(w) > 2]  # Remove short words and punctuation
                
                # Get mapped section headers (as enhancement, not primary)
                mapped_headers = get_relevant_section_headers(query, document_type)
                
                # Combine: query terms + mapped headers (query terms take priority)
                # Normalize all terms for consistent matching
                header_search_terms = set()
                
                # Add query terms directly (primary - query-driven)
                for word in query_words:
                    if word not in ['the', 'and', 'or', 'for', 'with', 'from', 'this', 'that', 'what', 'where', 'when', 'how']:
                        header_search_terms.add(word)
                
                # Add mapped headers (enhancement)
                for header in mapped_headers:
                    # Normalize and split header into individual words
                    normalized = _normalize_header(header)
                    header_search_terms.add(normalized)
                    # Also add individual words from multi-word headers
                    header_search_terms.update(normalized.split())
                
                if header_search_terms:
                    logger.info(f"[HEADER_RETRIEVAL] Query-driven header search terms: {sorted(header_search_terms)}")
                    try:
                        from backend.llm.retrievers.bm25_retriever import BM25DocumentRetriever
                        bm25_retriever = BM25DocumentRetriever()
                        
                        # Build query string for BM25 search (OR all terms - query-driven)
                        # Use phrase search for multi-word terms, individual words for single terms
                        header_query_parts = []
                        for term in header_search_terms:
                            if ' ' in term:
                                # Multi-word term: use as phrase
                                header_query_parts.append(f'"{term}"')
                            else:
                                # Single word: use directly
                                header_query_parts.append(term)
                        
                        header_query = " OR ".join(header_query_parts)
                        
                        # Search for chunks with these section headers (query-driven)
                        header_results = bm25_retriever.query_documents(
                            query_text=header_query,
                            top_k=int(os.getenv("MAX_HEADER_MATCHES", "20")),  # Limit header matches
                            business_id=business_id,
                            property_id=state.get("property_id"),
                            classification_type=document_type
                        )
                        
                        if header_results:
                            logger.info(f"[HEADER_RETRIEVAL] Found {len(header_results)} chunks with query-driven header matches")
                            # Runtime header detection for header results
                            from backend.llm.utils.section_header_detector import detect_section_header
                            for result in header_results:
                                result['_header_match'] = True
                                # Detect section headers from chunk text at runtime
                                chunk_text = result.get('chunk_text', '')
                                if chunk_text:
                                    header_info = detect_section_header(chunk_text)
                                    if header_info:
                                        result['_detected_section_header'] = header_info.get('section_header')
                                        result['_detected_normalized_header'] = header_info.get('normalized_header')
                                        logger.debug(f"[RUNTIME_HEADER] Detected header in header result: '{header_info.get('section_header')}'")
                    except Exception as e:
                        logger.warning(f"[HEADER_RETRIEVAL] Header search failed: {e}, continuing with standard retrieval")
            
            # Standard Hybrid Search (Pass 2)
            results = retriever.query_documents(
                user_query=query,
                top_k=top_k,  # Adjusted based on detail_level
                business_id=business_id,
                property_id=state.get("property_id"),
                classification_type=state.get("classification_type"),
                trigger_lazy_embedding=False  # Disabled: all chunks embedded upfront
                # TODO: Add section_headers parameter once hybrid retriever supports it
            )
            
            # Runtime Section Header Detection (Phase 1): Detect headers in standard results
            from backend.llm.utils.section_header_detector import detect_section_header, _normalize_header
            from backend.llm.utils.section_header_matcher import get_relevant_section_headers
            
            # Get relevant section headers for this query (generic - works for any query type)
            relevant_headers = get_relevant_section_headers(query, document_type)
            relevant_normalized = {_normalize_header(h) for h in relevant_headers} if relevant_headers else set()
            
            # Detect headers in standard results and tag them
            for result in results:
                chunk_text = result.get('chunk_text', '')
                if chunk_text:
                    header_info = detect_section_header(chunk_text)
                    if header_info:
                        detected_header = header_info.get('section_header')
                        detected_normalized = header_info.get('normalized_header')
                        
                        result['_detected_section_header'] = detected_header
                        result['_detected_normalized_header'] = detected_normalized
                        
                        # Generic boost: if detected header matches query intent
                        if detected_normalized in relevant_normalized:
                            current_score = result.get('similarity_score', 0.0)
                            result['similarity_score'] = current_score * 2.0  # 2x boost for matching headers
                            logger.debug(f"[RUNTIME_HEADER] Boosted chunk with matching header: '{detected_header}' (score: {current_score:.3f} → {result['similarity_score']:.3f})")
            
            # Boost header-based results (multiply RRF score by 1.5x)
            if header_results:
                section_header_boost = float(os.getenv("SECTION_HEADER_BOOST", "1.5"))
                header_doc_chunk_pairs = {(r.get('doc_id'), r.get('chunk_index')) for r in header_results}
                
                for result in results:
                    chunk_key = (result.get('doc_id'), result.get('chunk_index'))
                    if result.get('_header_match') or chunk_key in header_doc_chunk_pairs:
                        current_score = result.get('similarity_score', 0.0)
                        result['similarity_score'] = current_score * section_header_boost
                        logger.debug(f"[HEADER_RETRIEVAL] Boosted chunk {result.get('chunk_index')} from {current_score:.3f} to {result['similarity_score']:.3f}")
            
            # Combine header results with standard results (header results get priority)
            # Deduplicate by doc_id + chunk_index
            seen_chunks = set()
            combined_results = []
            
            # Add header results first (they get priority)
            for result in header_results:
                chunk_key = (result.get('doc_id'), result.get('chunk_index'))
                if chunk_key not in seen_chunks:
                    combined_results.append(result)
                    seen_chunks.add(chunk_key)
            
            # Add standard results (skip duplicates)
            for result in results:
                chunk_key = (result.get('doc_id'), result.get('chunk_index'))
                if chunk_key not in seen_chunks:
                    combined_results.append(result)
                    seen_chunks.add(chunk_key)
            
            # Post-Retrieval Header-Based Boosting (Phase 2): Apply additional boosting to combined results
            # This ensures chunks with matching section headers get prioritized even after combination
            if relevant_normalized:
                for result in combined_results:
                    chunk_text = result.get('chunk_text', '')
                    if chunk_text:
                        # If header not already detected, detect it now
                        if '_detected_normalized_header' not in result:
                            header_info = detect_section_header(chunk_text)
                            if header_info:
                                result['_detected_section_header'] = header_info.get('section_header')
                                result['_detected_normalized_header'] = header_info.get('normalized_header')
                        
                        # Boost if detected header matches query intent (generic matching)
                        detected_normalized = result.get('_detected_normalized_header')
                        if detected_normalized and detected_normalized in relevant_normalized:
                            current_score = result.get('similarity_score', 0.0)
                            # Additional 1.5x boost for matching headers in combined results
                            result['similarity_score'] = current_score * 1.5
                            logger.debug(f"[RUNTIME_HEADER] Post-retrieval boost for matching header: '{result.get('_detected_section_header')}' (score: {current_score:.3f} → {result['similarity_score']:.3f})")
            
            # Use combined results
            results = combined_results
            query_time = time.time() - query_start
            all_results.append(results)
            logger.info(f"[QUERY_HYBRID] Query {i}/{len(queries)} '{query[:40]}...' → {len(results)} docs in {query_time:.2f}s")
        
        hybrid_time = time.time() - hybrid_start
        logger.info(f"[QUERY_VECTOR_DOCUMENTS] Hybrid search completed in {hybrid_time:.2f}s")
        
        # Merge results using Reciprocal Rank Fusion
        if len(all_results) > 1:
            merged_results = reciprocal_rank_fusion(all_results)
            logger.info(
                f"[QUERY_HYBRID] Merged {len(merged_results)} unique documents from {len(queries)} query variations"
            )
        else:
            merged_results = all_results[0] if all_results else []
            logger.info(
                f"[QUERY_HYBRID] Retrieved {len(merged_results)} documents via hybrid search"
            )
        
        # STEP 3: LLM-Driven SQL Query with Tool (if structured query found nothing or needs refinement)
        # Let LLM agent use the SQL query tool directly to find properties
        llm_sql_results = []
        if (not structured_results or len(structured_results) < 3) and business_id:
            try:
                from langchain_openai import ChatOpenAI
                from backend.llm.tools.sql_query_tool import create_property_query_tool, SQLQueryTool
                from backend.services.supabase_client_factory import get_supabase_client
                
                supabase = get_supabase_client()  # Get supabase client for LLM SQL queries
                
                # Create the tool instance
                sql_tool = SQLQueryTool(business_id=business_id)
                
                # Create LLM with tool binding (agent can invoke tool directly)
                llm = ChatOpenAI(
                    api_key=config.openai_api_key,
                    model=config.openai_model,
                    temperature=0.3,
                )
                
                # Use centralized prompt
                # Get system prompt for SQL query task
                system_msg_sql = get_system_prompt('sql_query')
                
                # Get human message content
                human_content_sql = get_llm_sql_query_human_content(user_query=state['user_query'])
                
                # Use LangGraph message format
                messages_sql = [system_msg_sql, HumanMessage(content=human_content_sql)]
                prompt = messages_sql  # Keep variable name for compatibility
                
                response = llm.invoke(prompt)
                import json
                import re
                
                # Extract JSON from response
                json_match = re.search(r'\{[^}]+\}', response.content, re.DOTALL)
                if json_match:
                    query_params = json.loads(json_match.group(0))
                    logger.info(f"[QUERY_LLM_SQL] LLM generated query params: {query_params}")
                    
                    # Execute SQL query with LLM-generated parameters
                    similar_properties = sql_tool.query_properties(
                        number_bedrooms=query_params.get('number_bedrooms'),
                        number_bathrooms=query_params.get('number_bathrooms'),
                        bedroom_min=query_params['bedroom_range'][0] if query_params.get('bedroom_range') else None,
                        bedroom_max=query_params['bedroom_range'][1] if query_params.get('bedroom_range') else None,
                        bathroom_min=query_params['bathroom_range'][0] if query_params.get('bathroom_range') else None,
                        bathroom_max=query_params['bathroom_range'][1] if query_params.get('bathroom_range') else None,
                        property_type=query_params.get('property_type'),
                        min_price=query_params.get('min_price'),
                        max_price=query_params.get('max_price'),
                        min_size_sqft=query_params.get('min_size_sqft'),
                        max_size_sqft=query_params.get('max_size_sqft'),
                        limit=20
                    )
                    
                    if similar_properties:
                        # Convert to document results (same format as structured_results)
                        property_ids = [p['property_id'] for p in similar_properties]
                        
                        # Get documents linked to these properties
                        doc_results = supabase.table('document_relationships')\
                            .select('document_id, property_id')\
                            .in_('property_id', property_ids)\
                            .execute()
                        
                        if doc_results.data:
                            doc_ids = list(set([d['document_id'] for d in doc_results.data]))
                            docs = supabase.table('documents')\
                                .select('id, original_filename, classification_type, document_summary')\
                                .in_('id', doc_ids)\
                                .eq('business_uuid', business_id)\
                                .execute()
                            
                            addresses = supabase.table('properties')\
                                .select('id, formatted_address')\
                                .in_('id', property_ids)\
                                .execute()
                            
                            address_map = {a['id']: a['formatted_address'] for a in addresses.data}
                            property_details_map = {p['property_id']: p for p in similar_properties}
                            
                            for doc in docs.data:
                                prop_id = next((dr['property_id'] for dr in doc_results.data if dr['document_id'] == doc['id']), None)
                                prop_details = property_details_map.get(prop_id, {}) if prop_id else {}
                                
                                # Build property context (include all fields for completeness)
                                property_context = ""
                                if prop_details:
                                    context_parts = []
                                    if prop_details.get('number_bedrooms') is not None:
                                        context_parts.append(f"{prop_details['number_bedrooms']} bedroom(s)")
                                    if prop_details.get('number_bathrooms') is not None:
                                        context_parts.append(f"{prop_details['number_bathrooms']} bathroom(s)")
                                    if prop_details.get('property_type'):
                                        context_parts.append(f"Type: {prop_details['property_type']}")
                                    if prop_details.get('size_sqft'):
                                        size_value = prop_details['size_sqft']
                                        size_unit = prop_details.get('size_unit', '').lower() if prop_details.get('size_unit') else ''
                                        # Only show as acres if explicitly stated in size_unit field
                                        if size_unit in ('acres', 'acre'):
                                            context_parts.append(f"Size: {size_value:,.2f} acres")
                                        else:
                                            context_parts.append(f"Size: {size_value:,.0f} sqft")
                                    if prop_details.get('asking_price'):
                                        context_parts.append(f"Asking price: £{prop_details['asking_price']:,.0f}")
                                    if prop_details.get('sold_price'):
                                        context_parts.append(f"Sold price: £{prop_details['sold_price']:,.0f}")
                                    if prop_details.get('rent_pcm'):
                                        context_parts.append(f"Rent (pcm): £{prop_details['rent_pcm']:,.0f}")
                                    if prop_details.get('tenure'):
                                        context_parts.append(f"Tenure: {prop_details['tenure']}")
                                    if prop_details.get('epc_rating'):
                                        context_parts.append(f"EPC: {prop_details['epc_rating']}")
                                    if prop_details.get('condition'):
                                        context_parts.append(f"Condition: {prop_details['condition']}")
                                    if context_parts:
                                        property_context = f"""PROPERTY DETAILS (VERIFIED FROM DATABASE - INCLUDES MANUALLY UPDATED VALUES):
This property has: {', '.join(context_parts)}.

This information has been verified and extracted from the property database, including any manually updated values. The document below may contain additional details about this property.

"""
                                
                                # Get chunks
                                chunks_result = supabase.table('document_vectors')\
                                    .select('chunk_text, chunk_index, page_number')\
                                    .eq('document_id', doc['id'])\
                                    .order('chunk_index')\
                                    .limit(20)\
                                    .execute()
                                
                                chunk_texts = [c.get('chunk_text', '').strip() for c in chunks_result.data if c.get('chunk_text', '').strip() and len(c.get('chunk_text', '').strip()) > 10]
                                # Extract party names for this document (similar to structured query above)
                                party_names_context_llm = ""
                                try:
                                    import json
                                    document_summary_llm = doc.get('document_summary')
                                    if document_summary_llm:
                                        if isinstance(document_summary_llm, str):
                                            try:
                                                document_summary_llm = json.loads(document_summary_llm)
                                                if isinstance(document_summary_llm, str):
                                                    document_summary_llm = json.loads(document_summary_llm)
                                            except (json.JSONDecodeError, TypeError):
                                                document_summary_llm = None
                                        
                                        if isinstance(document_summary_llm, dict):
                                            party_names_llm = document_summary_llm.get('party_names', {})
                                            if party_names_llm:
                                                name_parts_llm = []
                                                if valuer := party_names_llm.get('valuer'):
                                                    name_parts_llm.append(f"Valuer: {valuer}")
                                                if seller := party_names_llm.get('seller'):
                                                    name_parts_llm.append(f"Seller: {seller}")
                                                if buyer := party_names_llm.get('buyer'):
                                                    name_parts_llm.append(f"Buyer: {buyer}")
                                                if agent := party_names_llm.get('estate_agent'):
                                                    name_parts_llm.append(f"Estate Agent: {agent}")
                                                
                                                if name_parts_llm:
                                                    party_names_context_llm = "PARTY_NAMES: " + " | ".join(name_parts_llm) + "\n\n"
                                except Exception as e:
                                    logger.debug(f"[QUERY_LLM_SQL] Could not extract party names: {e}")
                                
                                combined_content = party_names_context_llm + property_context + "\n\n---\n\n".join(chunk_texts) if chunk_texts else party_names_context_llm + property_context + f"Similar property from {doc.get('original_filename', 'document')}."
                                
                                llm_sql_results.append({
                                    'doc_id': doc['id'],
                                    'document_id': doc['id'],
                                    'property_id': prop_id,
                                    'property_address': address_map.get(prop_id, 'Unknown'),
                                    'original_filename': doc.get('original_filename', ''),
                                    'classification_type': doc.get('classification_type', ''),
                                    'content': combined_content,
                                    'similarity_score': 0.8,  # Lower than exact matches
                                    'source': 'llm_sql_query',
                                    'chunk_index': 0,
                                    'page_number': None,
                                    'page_numbers': []
                                })
                        
                        logger.info(f"[QUERY_LLM_SQL] Found {len(llm_sql_results)} documents via LLM-driven SQL query")
            except Exception as e:
                logger.warning(f"[QUERY_LLM_SQL] LLM SQL query failed: {e}")
                import traceback
                logger.debug(traceback.format_exc())
        
        # STEP 4: Combine ALL search results (structured + LLM SQL + hybrid)
        # Priority: Structured (exact) > LLM SQL (similar) > Hybrid (semantic)
        seen_doc_ids = set()
        final_results = []
        
        # 1. Add structured results first (exact matches, highest priority)
        for doc in structured_results:
            doc_id = doc.get('doc_id') or doc.get('document_id')
            if doc_id and doc_id not in seen_doc_ids:
                final_results.append(doc)
                seen_doc_ids.add(doc_id)
        
        # 2. Add LLM SQL results (similar matches, medium priority)
        for doc in llm_sql_results:
            doc_id = doc.get('doc_id') or doc.get('document_id')
            if doc_id and doc_id not in seen_doc_ids:
                final_results.append(doc)
                seen_doc_ids.add(doc_id)
        
        # 3. Add hybrid results (semantic matches, lower priority, avoid duplicates)
        for doc in merged_results:
            doc_id = doc.get('doc_id') or doc.get('document_id')
            if doc_id and doc_id not in seen_doc_ids:
                final_results.append(doc)
                seen_doc_ids.add(doc_id)
        
        # STEP 5: Filter by document_ids if provided (for document-specific search)
        document_ids = state.get('document_ids')
        if document_ids and len(document_ids) > 0:
            # Convert to set for faster lookup
            document_ids_set = set(document_ids)
            filtered_results = [
                doc for doc in final_results
                if (doc.get('doc_id') or doc.get('document_id')) in document_ids_set
            ]
            logger.info(f"[QUERY_FILTERED] Filtered from {len(final_results)} to {len(filtered_results)} documents by document_ids")
            final_results = filtered_results
        
        node_time = time.time() - node_start
        logger.info(
            f"[QUERY_VECTOR_DOCUMENTS] Completed in {node_time:.2f}s: "
            f"Structured: {len(structured_results)}, LLM SQL: {len(llm_sql_results)}, "
            f"Hybrid: {len(merged_results)}, Final: {len(final_results)}"
        )
        return {"relevant_documents": final_results[:config.vector_top_k]}

    except Exception as exc:  # pylint: disable=broad-except
        node_time = time.time() - node_start
        logger.error(f"[QUERY_VECTOR_DOCUMENTS] Failed after {node_time:.2f}s: {exc}", exc_info=True)
        logger.error("[QUERY_HYBRID] Hybrid search failed: %s", exc, exc_info=True)
        # Fallback to vector-only search if hybrid fails
        try:
            logger.info("[QUERY_HYBRID] Falling back to vector-only search")
            retriever = VectorDocumentRetriever()
            results = retriever.query_documents(
                user_query=state['user_query'],
                top_k=config.vector_top_k,
                business_id=state.get("business_id"),
            )
            return {"relevant_documents": results}
        except Exception as fallback_exc:
            logger.error("[QUERY_HYBRID] Fallback also failed: %s", fallback_exc, exc_info=True)
            return {"relevant_documents": []}


def query_structured_documents(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: SQL search (Structured Attributes)

    Converts natural language query to SQL and queries extracted property attributes.
    Only executes if query_intent includes "structured".
    
    Args:
        state: MainWorkflowState with user_query, query_intent
    
    Returns:
        Updated state with SQL results appended to relevant_documents
    """

    # Skip if not a structured query 
    if "structured" not in state['query_intent']:
        logger.debug("[QUERY_SQL] Skipping - not a structured query")
        return {"relevant_documents": []}

    logger.warning(
        "[QUERY_SQL] Structured retrieval not implemented yet; returning no results"
    )
    return {"relevant_documents": []}


def combine_and_deduplicate(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Combine and Deduplicate Results
    
    Merges vector and SQL results, removes duplicates by doc_id.
    If same document appears in both, marks as "hybrid" and merges metadata.
    
    Args:
        state: MainWorkflowState with relevant_documents (from both retrievers)
    
    Returns:
        Updated state with deduplicated relevant_documents
    """
    
    combined = state['relevant_documents']
    
    if not combined:
        logger.debug("[COMBINE] No documents to combine")
        return {"relevant_documents": []}

    seen = {}
    for doc in combined:
        key = (doc.get("doc_id"), doc.get("property_id"))
        existing = seen.get(key)
        if existing is None:
            seen[key] = doc
            continue

        # Mark as hybrid if sourced from multiple retrievers
        if doc.get("source") != existing.get("source"):
            existing["source"] = "hybrid"

        # Keep maximum similarity score (if available)
        existing["similarity_score"] = max(
            existing.get("similarity_score", 0.0),
            doc.get("similarity_score", 0.0),
        )

    deduplicated = list(seen.values())
    logger.info(
        "[COMBINE] Deduplicated %d documents to %d unique results",
        len(combined),
        len(deduplicated),
    )
    return {"relevant_documents": deduplicated}


def clarify_relevant_docs(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Clarify/Re-rank Documents
    
    1. Groups chunks by doc_id (merges chunks from same document)
    2. Uses LLM to re-rank documents by relevance to the original query
    3. Goes beyond vector similarity to semantic understanding
    
    Args:
        state: MainWorkflowState with relevant_documents
    
    Returns:
        Updated state with re-ranked, deduplicated relevant_documents
    """
    
    docs = state['relevant_documents']
    
    if not docs:
        logger.debug("[CLARIFY] No documents to clarify")
        return {"relevant_documents": []}
    
    # Step 1: Group chunks by doc_id
    doc_groups = {}
    for doc in docs:
        doc_id = doc.get('doc_id')
        if not doc_id:
            logger.warning("[CLARIFY] Skipping document with no doc_id")
            continue
        
        # Log first occurrence for debugging
        if doc_id not in doc_groups:
            logger.debug(f"[CLARIFY] Creating new group for doc_id: {doc_id[:8]}...")
            
        if doc_id not in doc_groups:
            # Initialize with first chunk's metadata
            doc_groups[doc_id] = {
                'doc_id': doc_id,
                'property_id': doc.get('property_id'),
                'classification_type': doc.get('classification_type'),
                'business_id': doc.get('business_id'),
                'address_hash': doc.get('address_hash'),
                'source': doc.get('source'),
                'chunks': [],
                'max_similarity': doc.get('similarity_score', 0.0),
                # NEW: Store filename and address from first chunk
                'original_filename': doc.get('original_filename'),
                'property_address': doc.get('property_address'),
            }
        
        # Append chunk content WITH bbox metadata
        doc_groups[doc_id]['chunks'].append({
            'content': doc.get('content', ''),
            'chunk_index': doc.get('chunk_index', 0),
            'page_number': doc.get('page_number', 0),
            'similarity': doc.get('similarity_score', 0.0),
            'bbox': doc.get('bbox'),  # NEW: Preserve bbox for citation/highlighting
            'vector_id': doc.get('vector_id'),  # NEW: Preserve vector_id for lookup
        })
        
        # Track highest similarity score across all chunks
        doc_groups[doc_id]['max_similarity'] = max(
            doc_groups[doc_id]['max_similarity'],
            doc.get('similarity_score', 0.0)
        )
    
    # Step 2: Merge chunks and create single document entry per doc_id
    merged_docs = []
    for doc_id, group in doc_groups.items():
        # Sort chunks by chunk_index for proper ordering
        group['chunks'].sort(key=lambda x: x['chunk_index'])
        
        # Merge chunk content (keep top 7 most relevant chunks for better context with 1200-char chunks)
        top_chunks = sorted(group['chunks'], key=lambda x: x['similarity'], reverse=True)[:7]
        merged_content = "\n\n".join([chunk['content'] for chunk in top_chunks])
        
        # Extract page numbers from top chunks (filter out 0 and None)
        page_numbers = sorted(set(
            chunk['page_number'] for chunk in top_chunks 
            if chunk.get('page_number') and chunk.get('page_number') > 0
        ))
        
        if len(page_numbers) > 1:
            page_range = f"pages {min(page_numbers)}-{max(page_numbers)}"
        elif len(page_numbers) == 1:
            page_range = f"page {page_numbers[0]}"
        else:
            # No valid page numbers, show chunk count instead
            page_range = f"{len(group['chunks'])} chunks"
        
        merged_docs.append({
            'doc_id': doc_id,
            'property_id': group['property_id'],
            'content': merged_content,
            'classification_type': group['classification_type'],
            'business_id': group['business_id'],
            'address_hash': group['address_hash'],
            'source': group['source'],
            'similarity_score': group['max_similarity'],
            'chunk_count': len(group['chunks']),
            'page_numbers': page_numbers,  # List of page numbers
            'page_range': page_range,  # Human-readable page range
            # NEW: Pass through filename and address
            'original_filename': group.get('original_filename'),
            'property_address': group.get('property_address'),
            # NEW: Store source chunks with full metadata for citation/highlighting
            'source_chunks_metadata': [
                {
                    'content': chunk['content'],
                    'chunk_index': chunk['chunk_index'],
                    'page_number': chunk['page_number'],
                    'bbox': chunk.get('bbox'),
                    'vector_id': chunk.get('vector_id'),
                    'similarity': chunk['similarity'],
                    'doc_id': doc_id  # NEW: Include doc_id in each chunk for citation recovery
                }
                for chunk in top_chunks  # Only top chunks used in summary
            ]
        })
    
    logger.info(
        "[CLARIFY] Grouped %d chunks into %d unique documents:",
        len(docs),
        len(merged_docs)
    )
    
    # Log unique doc IDs for debugging
    for idx, doc in enumerate(merged_docs[:10], 1):
        property_id = doc.get('property_id') or 'none'
        logger.info(
            f"  {idx}. Doc {doc['doc_id'][:8]}... | Property {property_id[:8]}... | "
            f"{doc.get('page_range', 'unknown')} | {doc.get('chunk_count', 0)} chunks"
        )
    
    # PERFORMANCE OPTIMIZATION: Skip reranking for small result sets or when Cohere is disabled
    # Reranking adds latency and isn't necessary when we have few documents or high confidence
    max_docs_for_reranking = int(os.getenv("MAX_DOCS_FOR_RERANKING", "8"))
    if len(merged_docs) <= max_docs_for_reranking:
        logger.info(
            "[CLARIFY] Only %d documents (threshold: %d), skipping re-ranking for speed",
            len(merged_docs),
            max_docs_for_reranking
        )
        return {"relevant_documents": merged_docs}
    
    # Also skip if documents have very high similarity scores (already well-ranked)
    high_confidence_docs = [doc for doc in merged_docs if doc.get('similarity_score', 0) > 0.8]
    if len(high_confidence_docs) >= len(merged_docs) * 0.7:  # 70% have high confidence
        logger.info(
            "[CLARIFY] %d%% of documents have high confidence scores (>0.8), skipping re-ranking",
            int(len(high_confidence_docs) / len(merged_docs) * 100)
        )
        return {"relevant_documents": merged_docs}

    # Step 3: Cohere reranking (replaces expensive LLM reranking)
    # PERFORMANCE OPTIMIZATION: Only rerank if we have many documents and Cohere is enabled
    try:
        from backend.llm.retrievers.cohere_reranker import CohereReranker
        
        reranker = CohereReranker()
        
        # Only rerank if we have enough documents to justify the latency
        min_docs_for_reranking = int(os.getenv("MIN_DOCS_FOR_RERANKING", "6"))
        should_rerank = (
            reranker.is_enabled() 
            and config.cohere_rerank_enabled 
            and len(merged_docs) >= min_docs_for_reranking
        )
        
        if should_rerank:
            logger.info("[CLARIFY] Using Cohere reranker for %d documents", len(merged_docs))
            
            # Rerank documents using Cohere (limit to reasonable number for speed)
            max_rerank = min(len(merged_docs), 15)  # Reduced from 20 for speed
            reranked_docs = reranker.rerank(
                query=state['user_query'],
                documents=merged_docs,
                top_n=max_rerank
            )
            
            logger.info("[CLARIFY] Cohere reranked %d documents", len(reranked_docs))
            return {"relevant_documents": reranked_docs}
        else:
            if not reranker.is_enabled() or not config.cohere_rerank_enabled:
                logger.info("[CLARIFY] Cohere reranker disabled, using original order")
            else:
                logger.info(
                    "[CLARIFY] Only %d documents (threshold: %d), skipping Cohere reranking for speed",
                    len(merged_docs),
                    min_docs_for_reranking
                )
            return {"relevant_documents": merged_docs}
            
    except ImportError:
        logger.warning("[CLARIFY] Cohere reranker not available, falling back to LLM")
        # Fallback to LLM reranking if Cohere not available
        return _llm_rerank_fallback(state, merged_docs)
    except Exception as exc:
        logger.error("[CLARIFY] Cohere reranker failed: %s", exc)
        logger.warning("[CLARIFY] Falling back to original order")
        return {"relevant_documents": merged_docs}


def _llm_rerank_fallback(state: MainWorkflowState, merged_docs: List[Dict]) -> MainWorkflowState:
    """Fallback LLM reranking if Cohere fails."""
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )

    # LLM re-ranking (for merged documents)
    doc_summary = "\n".join(
        (
            f"- Doc {idx + 1}: ID={(doc.get('doc_id') or 'unknown')[:8]} | "
            f"Property={(doc.get('property_id') or 'none')[:8]} | "
            f"Type={doc.get('classification_type', '')} | "
            f"Chunks={doc.get('chunk_count', 1)} | "
            f"Similarity={doc.get('similarity_score', 0.0):.2f} | "
            f"Source={doc.get('source', 'unknown')}"
        )
        for idx, doc in enumerate(merged_docs)
    )

    # Get system prompt for ranking task
    system_msg = get_system_prompt('rank')
    
    # Get human message content
    human_content = get_reranking_human_content(
        user_query=state['user_query'],
        doc_summary=doc_summary
    )
    
    try:
        # Use LangGraph message format
        messages = [system_msg, HumanMessage(content=human_content)]
        response = llm.invoke(messages)
        ranked_ids = json.loads(response.content)
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("[CLARIFY] Failed to parse ranking; returning original order: %s", exc)
        return {"relevant_documents": merged_docs}

    doc_map = {doc["doc_id"]: doc for doc in merged_docs if doc.get("doc_id")}
    reordered = [doc_map[doc_id] for doc_id in ranked_ids if doc_id in doc_map]

    # Append any documents missing from LLM output
    for doc in merged_docs:
        if doc not in reordered:
            reordered.append(doc)

    logger.info("[CLARIFY] LLM fallback re-ranked %d unique documents", len(reordered))
    return {"relevant_documents": reordered}




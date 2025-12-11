"""
Detail Level Detection Node: Determines if a query requires detailed RICS-level 
professional answers or concise factual answers.

Uses a fast LLM (gpt-4o-mini) to classify queries based on complexity and 
information requirements.
"""

import logging
import os
from typing import Dict, Any
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from backend.llm.config import config
from backend.llm.types import MainWorkflowState

logger = logging.getLogger(__name__)


def determine_detail_level(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Determine Detail Level
    
    Analyzes the user query to determine if it requires:
    - "detailed": RICS-level professional answers with assumptions, multiple perspectives, methodology
    - "concise": Fast, factual answers for simple queries
    
    If detail_level is already set in state (manual override), skip detection.
    
    Args:
        state: MainWorkflowState with user_query, conversation_history (optional)
    
    Returns:
        Updated state with detail_level set
    """
    
    # Check if detail_level is already set (manual override from API)
    if state.get('detail_level'):
        logger.info(f"[DETAIL_LEVEL] Using manual override: {state.get('detail_level')}")
        # Return the existing detail_level to ensure it's in state (LangGraph may need explicit return)
        return {"detail_level": state.get('detail_level')}
    
    user_query = state.get('user_query', '')
    if not user_query:
        logger.warning("[DETAIL_LEVEL] No user_query found, defaulting to concise")
        return {"detail_level": "concise"}
    
    conversation_history = state.get('conversation_history', [])
    
    # Use fast LLM for classification
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model="gpt-4o-mini",  # Fast model for quick classification
        temperature=0,  # Deterministic classification
        timeout=2,  # 2-second timeout
    )
    
    # Build context from conversation history if available
    context = ""
    if conversation_history:
        recent_messages = conversation_history[-3:]  # Last 3 messages for context
        context = "\n\nRecent conversation:\n"
        for msg in recent_messages:
            if isinstance(msg, dict):
                role = msg.get('role', 'user')
                content = msg.get('content', '')
                context += f"{role}: {content}\n"
    
    # System prompt
    system_prompt = """You are a query classifier for a property document analysis system. 
Your task is to determine if a query requires a detailed RICS-level professional answer or a concise factual answer.

Return ONLY one word: "detailed" or "concise"

Use "detailed" for queries that need:
- Value/valuation/price queries (require assumptions, multiple perspectives, methodology)
- Analysis queries (risks, condition, opportunities, defects, structural issues)
- Comparison queries (comparable properties, market analysis, comparable sales)
- Professional queries (valuer information, methodology, qualifications, firm names)
- Complex multi-part queries requiring comprehensive analysis

Use "concise" for queries that need:
- Simple factual information (bedrooms, bathrooms, address, postcode, EPC rating, size, date)
- Single-value questions
- Yes/no questions
- Property identification queries
- Simple lookups"""

    # Human prompt
    human_prompt = f"""Analyze this property document query and determine if it requires a detailed RICS-level professional answer or a concise factual answer.

Query: "{user_query}"
{context}

Return ONLY: "detailed" or "concise"
"""
    
    try:
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=human_prompt)
        ]
        
        response = llm.invoke(messages)
        result = response.content.strip().lower()
        
        # Validate response
        if result not in ["detailed", "concise"]:
            logger.warning(f"[DETAIL_LEVEL] Invalid response '{result}', defaulting to concise")
            result = "concise"
        
        logger.info(f"[DETAIL_LEVEL] Query classified as: {result} for query: '{user_query[:50]}...'")
        
        return {"detail_level": result}
        
    except Exception as exc:
        logger.error(f"[DETAIL_LEVEL] Error during classification: {exc}", exc_info=True)
        # Fallback: use heuristics
        return _fallback_detection(user_query)
    

def _fallback_detection(query: str) -> Dict[str, str]:
    """
    Fallback heuristic-based detection if LLM fails.
    
    Uses keyword matching to determine detail level.
    """
    query_lower = query.lower()
    
    # Detailed mode keywords
    detailed_keywords = [
        'value', 'valuation', 'price', 'worth', 'cost',
        'risk', 'condition', 'defect', 'issue', 'problem', 'opportunity',
        'comparable', 'comp', 'market analysis', 'comparison',
        'valuer', 'appraiser', 'surveyor', 'methodology', 'assumption',
        'perspective', 'view', 'opinion', 'assessment', 'evaluation'
    ]
    
    # Concise mode keywords
    concise_keywords = [
        'bedroom', 'bathroom', 'bed', 'bath',
        'address', 'postcode', 'location', 'where',
        'epc', 'energy rating',
        'size', 'sqft', 'square feet', 'area',
        'date', 'when', 'year',
        'who owns', 'owner', 'buyer', 'seller'  # Simple identification
    ]
    
    # Check for detailed keywords
    has_detailed = any(keyword in query_lower for keyword in detailed_keywords)
    has_concise = any(keyword in query_lower for keyword in concise_keywords)
    
    # If both present, prefer detailed (more comprehensive)
    if has_detailed:
        logger.info(f"[DETAIL_LEVEL] Fallback: detected 'detailed' from keywords")
        return {"detail_level": "detailed"}
    elif has_concise:
        logger.info(f"[DETAIL_LEVEL] Fallback: detected 'concise' from keywords")
        return {"detail_level": "concise"}
    else:
        # Default to concise for unknown queries (faster)
        logger.info(f"[DETAIL_LEVEL] Fallback: no keywords found, defaulting to concise")
        return {"detail_level": "concise"}


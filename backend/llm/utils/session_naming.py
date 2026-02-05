"""
Session Naming Utility

Generates meaningful session names from the first user message using an LLM.
This provides better UX than generic "New Chat" titles in the chat history sidebar.
"""

import logging
from typing import Optional
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage
from backend.llm.config import config

logger = logging.getLogger(__name__)


async def generate_session_name(first_message: str, max_retries: int = 2) -> str:
    """
    Generate a concise, meaningful session name from the first user message.
    
    Args:
        first_message: The user's first message in the conversation
        max_retries: Number of retry attempts if generation fails
    
    Returns:
        A 3-5 word session name, or "New Chat" if generation fails
    
    Examples:
        "What's the value of the Highland property?" → "Highland Property Valuation"
        "Find me comparable properties in Bristol" → "Bristol Comparables Search"
        "Show me all documents from last month" → "Recent Documents Review"
    """
    # Fallback if message is empty or too short
    if not first_message or len(first_message.strip()) < 5:
        return "New Chat"
    
    try:
        # Use a smaller, cheaper model for naming (gpt-4o-mini)
        llm = ChatOpenAI(
            model="gpt-4o-mini",
            api_key=config.openai_api_key,
            temperature=0.0,  # Deterministic for consistency
            max_tokens=20  # Limit to prevent long names
        )
        
        naming_prompt = f"""Generate a concise 3-5 word title for this conversation.

User's first message: "{first_message[:200]}"

Requirements:
- 3-5 words maximum
- Descriptive and specific
- Include location/property name if mentioned
- Use title case
- No quotes or punctuation at start/end
- Be professional and clear

Examples:
- "Highland Property Valuation"
- "Bristol City Centre Comps"
- "Q3 Portfolio Analysis"
- "Berden Road Survey"

Title:"""
        
        response = await llm.ainvoke([HumanMessage(content=naming_prompt)])
        generated_name = response.content.strip()
        
        # Validate the generated name
        if not generated_name or len(generated_name) > 50:
            logger.warning(f"[SESSION_NAMING] Generated name too long or empty: '{generated_name}'")
            return "New Chat"
        
        # Remove quotes if present
        generated_name = generated_name.strip('"\'')
        
        logger.info(f"[SESSION_NAMING] ✅ Generated name: '{generated_name}' from message: '{first_message[:50]}...'")
        return generated_name
        
    except Exception as e:
        logger.error(f"[SESSION_NAMING] ❌ Error generating session name: {e}", exc_info=True)
        
        # Retry logic
        if max_retries > 0:
            logger.info(f"[SESSION_NAMING] Retrying... ({max_retries} retries left)")
            return await generate_session_name(first_message, max_retries - 1)
        
        # Final fallback
        return "New Chat"


def generate_session_name_sync(first_message: str) -> str:
    """
    Synchronous wrapper for generate_session_name.
    
    For use in non-async contexts. Falls back to simple heuristic-based naming.
    
    Args:
        first_message: The user's first message in the conversation
    
    Returns:
        A session name based on simple heuristics
    """
    if not first_message or len(first_message.strip()) < 5:
        return "New Chat"
    
    # Simple heuristic: extract capitalized words (likely names/locations)
    words = first_message.split()
    capitalized_words = [w for w in words if len(w) > 2 and w[0].isupper() and w.lower() not in 
                         {'the', 'a', 'an', 'of', 'in', 'for', 'to', 'and', 'or', 'what', 'is', 'are'}]
    
    if capitalized_words:
        # Use first 2-3 capitalized words + context
        name_parts = capitalized_words[:2]
        
        # Add context based on keywords
        query_lower = first_message.lower()
        if any(word in query_lower for word in ['value', 'valuation', 'worth']):
            name_parts.append('Valuation')
        elif any(word in query_lower for word in ['comparable', 'comps', 'comparison']):
            name_parts.append('Comparables')
        elif any(word in query_lower for word in ['survey', 'inspection', 'report']):
            name_parts.append('Survey')
        elif any(word in query_lower for word in ['document', 'documents', 'file']):
            name_parts.append('Documents')
        
        return ' '.join(name_parts[:4])  # Max 4 words
    
    # Final fallback: use first few words
    preview = ' '.join(words[:4])
    if len(preview) > 30:
        preview = preview[:27] + '...'
    return preview if preview else "New Chat"


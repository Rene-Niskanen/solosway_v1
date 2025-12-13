"""
Response Formatting Node - Formats and structures LLM responses for better readability.
"""

import logging
from typing import Dict, Any
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

from backend.llm.config import config
from backend.llm.types import MainWorkflowState
from backend.llm.utils.system_prompts import get_system_prompt
from backend.llm.prompts import get_response_formatting_prompt

logger = logging.getLogger(__name__)


async def format_response(state: MainWorkflowState) -> MainWorkflowState:
    """
    Format and structure the final response for better readability.
    
    This node takes the raw LLM response from summarize_results and formats it
    with better structure, organization, and formatting while preserving all content.
    
    Args:
        state: MainWorkflowState with final_summary
        
    Returns:
        Updated state with formatted final_summary
    """
    final_summary = state.get("final_summary", "")
    user_query = state.get("user_query", "")
    
    if not final_summary:
        logger.warning("[FORMAT_RESPONSE] No final_summary to format")
        return state
    
    try:
        # Get formatting prompt
        formatting_prompt = get_response_formatting_prompt(final_summary, user_query)
        
        # Create LLM instance
        llm = ChatOpenAI(
            model=config.OPENAI_MODEL,
            temperature=config.TEMPERATURE,
            streaming=False
        )
        
        # Format the response
        system_prompt = get_system_prompt()
        messages = [
            {"role": "system", "content": system_prompt},
            HumanMessage(content=formatting_prompt)
        ]
        
        formatted_response = await llm.ainvoke(messages)
        formatted_summary = formatted_response.content.strip()
        
        logger.info(f"[FORMAT_RESPONSE] Response formatted successfully ({len(formatted_summary)} chars)")
        
        # Update state with formatted summary
        state["final_summary"] = formatted_summary
        
        return state
        
    except Exception as e:
        logger.error(f"[FORMAT_RESPONSE] Error formatting response: {e}", exc_info=True)
        # Return original summary if formatting fails
        return state

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
    
    This node takes the raw LLM response from summarize_results, general_query, or transform_text
    and formats it with better structure, organization, and formatting while preserving all content.
    
    Args:
        state: MainWorkflowState with final_summary
        
    Returns:
        Updated state with formatted final_summary
    """
    final_summary = state.get("final_summary", "")
    user_query = state.get("user_query", "")
    query_category = state.get("query_category", "")
    agent_actions = state.get("agent_actions")
    
    if not final_summary:
        logger.warning("[FORMAT_RESPONSE] No final_summary to format")
        return state
    
    # Skip formatting for navigation actions - they're already conversational
    # Navigation responses like "Sure thing!\n\nNavigating to the property now..." don't need reformatting
    if agent_actions and any(a.get('action') in ['navigate_to_property_by_name', 'show_map_view', 'select_property_pin'] for a in agent_actions if isinstance(a, dict)):
        logger.info("[FORMAT_RESPONSE] Skipping formatting for navigation action response")
        return state
    
    # For general queries and text transformations, formatting is optional
    # They might already be well-formatted, but we can still improve structure
    # For document search, formatting is more important (handles citations, etc.)
    
    try:
        # Get formatting prompt
        formatting_prompt = get_response_formatting_prompt(final_summary, user_query)
        
        # Create LLM instance (use correct config)
        llm = ChatOpenAI(
            api_key=config.openai_api_key,
            model=config.openai_model,  # CORRECT
            temperature=0,  # CORRECT
            streaming=False
        )
        
        # Format the response (use correct system prompt with task parameter)
        system_prompt = get_system_prompt('format')  # CORRECT - use 'format' task
        messages = [
            system_prompt,  # SystemMessage object
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

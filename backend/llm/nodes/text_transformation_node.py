"""
Text Transformation Node: Transforms text based on user instruction.

Handles requests like "Make this sharper", "Reorganize this", "Make this more concise".
"""

import logging
from datetime import datetime
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

from backend.llm.config import config
from backend.llm.types import MainWorkflowState
from backend.llm.utils.system_prompts import get_system_prompt
from backend.llm.prompts import get_text_transformation_prompt

logger = logging.getLogger(__name__)


async def transform_text(state: MainWorkflowState) -> MainWorkflowState:
    """
    Transform text based on user instruction.
    
    Examples:
    - "Make this sharper" → Improve clarity, remove fluff
    - "Reorganize this" → Better structure and flow
    - "Make this more concise" → Reduce length while keeping key points
    
    CRITICAL: Updates conversation_history like summarize_results does
    """
    text_to_transform = state.get("text_to_transform", "")
    transformation_instruction = state.get("transformation_instruction", "")
    user_query = state.get("user_query", "")
    
    if not text_to_transform:
        logger.warning("[TRANSFORM_TEXT] No text to transform")
        error_msg = "I don't see any text to transform. Please paste the text or refer to a previous response."
        return {
            "final_summary": error_msg,
            "conversation_history": [],
            "citations": []
        }
    
    try:
        # Get system prompt
        system_msg = get_system_prompt('text_transformation')
        
        # Get human prompt
        human_prompt = get_text_transformation_prompt(
            text_to_transform=text_to_transform,
            transformation_instruction=transformation_instruction,
            user_query=user_query
        )
        
        # Call LLM (use correct config)
        llm = ChatOpenAI(
            api_key=config.openai_api_key,
            model=config.openai_model,
            temperature=0,
            streaming=False
        )
        
        response = await llm.ainvoke([system_msg, HumanMessage(content=human_prompt)])
        summary = response.content.strip()
        
        # Preserve citations if they exist in the original text
        existing_citations = state.get("citations", [])
        
        # Update conversation_history (same pattern as summarize_results)
        conversation_entry = {
            "query": user_query,
            "summary": summary,
            "timestamp": datetime.now().isoformat(),
            "document_ids": []  # No documents for transformations
        }
        
        logger.info(f"[TRANSFORM_TEXT] Transformed text ({len(summary)} chars)")
        
        return {
            "final_summary": summary,
            "conversation_history": [conversation_entry],  # operator.add will append
            "citations": existing_citations  # Preserve existing citations if transforming document response
        }
        
    except Exception as exc:
        logger.error(f"[TRANSFORM_TEXT] Error transforming text: {exc}", exc_info=True)
        return {
            "final_summary": "I encountered an error while transforming the text. Please try again.",
            "conversation_history": [],
            "citations": state.get("citations", [])  # Preserve existing citations
        }


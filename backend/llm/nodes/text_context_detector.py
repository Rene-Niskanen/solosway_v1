"""
Text Context Detection Node: Detects and extracts text to transform.

Combined node that detects what text the user wants to transform AND extracts it in one step.
Handles both pasted text and references to previous responses.
"""

import logging
import re
from typing import Dict

from backend.llm.types import MainWorkflowState

logger = logging.getLogger(__name__)


def detect_and_extract_text(state: MainWorkflowState) -> MainWorkflowState:
    """
    Detect what text user wants to transform AND extract it in one step.
    
    Priority:
    1. Pasted text in query (long text blocks > 100 chars)
    2. Previous assistant response (from conversation_history)
    3. Specific document content (if referenced)
    
    Returns state with text_to_transform and transformation_instruction populated
    """
    try:
        user_query = state.get("user_query", "")
        conversation_history = state.get("conversation_history", [])
        
        if not user_query:
            logger.warning("[TEXT_CONTEXT] No user_query found")
            return {
                "text_to_transform": "",
                "transformation_instruction": ""
            }
        
        # Extract transformation instruction from query
        transformation_instruction = _extract_transformation_instruction(user_query)
        
        # Detection logic:
        # 1. Check for pasted text (text blocks separated from question)
        pasted_text = _detect_pasted_text(user_query)
        if pasted_text:
            logger.info(f"[TEXT_CONTEXT] Detected pasted text ({len(pasted_text)} chars)")
            return {
                "text_to_transform": pasted_text,
                "transformation_instruction": transformation_instruction
            }
        
        # 2. Check for references to "previous response", "that", "the above"
        if _references_previous_response(user_query):
            previous_text = _get_previous_response(conversation_history)
            if previous_text:
                logger.info(f"[TEXT_CONTEXT] Detected previous response reference ({len(previous_text)} chars)")
                return {
                    "text_to_transform": previous_text,
                    "transformation_instruction": transformation_instruction
                }
        
        # 3. No text found
        logger.warning("[TEXT_CONTEXT] No text to transform found")
        return {
            "text_to_transform": "",
            "transformation_instruction": transformation_instruction
        }
    except Exception as exc:
        logger.error(f"[TEXT_CONTEXT] Error detecting text source: {exc}", exc_info=True)
        return {
            "text_to_transform": "",
            "transformation_instruction": ""
        }


def _extract_transformation_instruction(user_query: str) -> str:
    """
    Extract the transformation instruction from the query.
    Examples: "make sharper", "reorganize", "make more concise"
    """
    query_lower = user_query.lower()
    
    # Common transformation verbs
    transformation_verbs = [
        'make', 'reorganize', 'rewrite', 'improve', 'sharpen', 'concise',
        'rephrase', 'restructure', 'edit', 'refine', 'polish', 'tighten',
        'expand', 'enhance', 'clarify', 'simplify', 'shorten', 'lengthen'
    ]
    
    # Find transformation verb and following words
    for verb in transformation_verbs:
        if verb in query_lower:
            # Extract the phrase starting with the verb
            pattern = rf'\b{verb}\b\s+([^\n\.]+)'
            match = re.search(pattern, user_query, re.IGNORECASE)
            if match:
                return match.group(0).strip()
    
    # Default: return the query itself if no clear instruction found
    return user_query.strip()


def _detect_pasted_text(user_query: str) -> str:
    """
    Detect pasted text in query (long text blocks > 100 chars that aren't part of the question).
    
    Strategy:
    - Look for text blocks separated by newlines or quotes
    - Text blocks > 100 chars are likely pasted content
    - The question is usually shorter and at the beginning or end
    """
    # Split by newlines
    lines = user_query.split('\n')
    
    # Find the longest continuous block of text
    text_blocks = []
    current_block = []
    
    for line in lines:
        line = line.strip()
        if len(line) > 50:  # Substantial line
            current_block.append(line)
        else:
            if current_block:
                text_blocks.append('\n'.join(current_block))
                current_block = []
    
    # Add last block if exists
    if current_block:
        text_blocks.append('\n'.join(current_block))
    
    # If we have multiple blocks, the longest one is likely the pasted text
    if len(text_blocks) > 1:
        # Sort by length, longest first
        text_blocks.sort(key=len, reverse=True)
        longest = text_blocks[0]
        if len(longest) > 100:
            return longest
    
    # If single block but very long (> 200 chars), might be pasted text
    if len(user_query) > 200:
        # Check if it looks like a question (starts with question words) vs pasted text
        question_starters = ['what', 'how', 'why', 'when', 'where', 'who', 'can', 'could', 'should', 'would', 'please']
        first_words = user_query.lower().split()[:3]
        is_question = any(word in first_words for word in question_starters)
        
        # If it doesn't start like a question and is long, likely pasted text
        if not is_question:
            return user_query
    
    return ""


def _references_previous_response(user_query: str) -> bool:
    """
    Check if query references a previous response.
    """
    query_lower = user_query.lower()
    reference_phrases = [
        'previous response', 'that response', 'the above', 'above text',
        'that text', 'this text', 'the text', 'that answer', 'this answer',
        'previous answer', 'last response', 'last answer', 'that', 'this'
    ]
    
    # Check for transformation verbs + references
    transformation_verbs = ['make', 'reorganize', 'rewrite', 'improve', 'sharpen', 'concise', 'rephrase']
    has_transformation = any(verb in query_lower for verb in transformation_verbs)
    has_reference = any(phrase in query_lower for phrase in reference_phrases)
    
    return has_transformation and has_reference


def _get_previous_response(conversation_history: list) -> str:
    """
    Extract previous assistant response from conversation history.
    Handles both formats:
    - Format 1: {'query': str, 'summary': str}
    - Format 2: {'role': str, 'content': str}
    """
    if not conversation_history:
        return ""
    
    # Get the last entry
    last_entry = conversation_history[-1]
    
    # Format 1: From summary_nodes
    if isinstance(last_entry, dict) and 'summary' in last_entry:
        return last_entry.get('summary', '')
    
    # Format 2: From frontend
    if isinstance(last_entry, dict) and last_entry.get('role') == 'assistant':
        return last_entry.get('content', '')
    
    # Try to find any assistant message in recent history
    for entry in reversed(conversation_history[-5:]):  # Check last 5 entries
        if isinstance(entry, dict):
            if 'summary' in entry:
                return entry.get('summary', '')
            if entry.get('role') == 'assistant':
                return entry.get('content', '')
    
    return ""


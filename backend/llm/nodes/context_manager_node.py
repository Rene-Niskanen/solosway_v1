"""
Context Manager Node - Automatic summarization for long conversations.

Monitors token count and automatically summarizes old messages when the
conversation exceeds 8,000 tokens. Keeps the last 6 messages for context.
"""

from langchain_core.messages import SystemMessage, HumanMessage
from langchain_openai import ChatOpenAI
from backend.llm.config import config
from backend.llm.types import MainWorkflowState
from backend.llm.prompts.context_manager import (
    get_context_summary_prompt,
    get_context_summary_message_content,
)
import logging

logger = logging.getLogger(__name__)


async def context_manager_node(state: MainWorkflowState) -> MainWorkflowState:
    """
    Automatically summarize old messages when token count exceeds 8k.
    
    Strategy:
    1. Check total token count in message history
    2. If under 8k tokens: do nothing (pass through)
    3. If over 8k tokens:
       - Keep last 6 messages (recent context)
       - Summarize all older messages using GPT-4o-mini
       - Replace old messages with 1 summary message
    
    This prevents token overflow crashes while preserving conversation context.
    
    Args:
        state: MainWorkflowState with messages list
        
    Returns:
        Updated state with summarized messages (if triggered) or empty dict (no change)
    """
    # Inject current user message so planner/responder see full thread (refine/format + follow-up)
    user_query = (state.get("user_query") or "").strip()
    if user_query:
        messages = state.get("messages", [])
        last_is_same = (
            messages
            and hasattr(messages[-1], "__class__")
            and messages[-1].__class__.__name__ == "HumanMessage"
            and (getattr(messages[-1], "content", "") or "").strip() == user_query
        )
        if not last_is_same:
            logger.debug(f"[CONTEXT_MGR] Injecting user message ({len(user_query)} chars)")
            return {"messages": [HumanMessage(content=user_query)]}

    messages = state.get("messages", [])
    
    # Skip if no messages or too few to summarize
    if not messages or len(messages) <= 6:
        logger.debug(f"[CONTEXT_MGR] Only {len(messages)} messages - no summarization needed")
        return {}
    
    # Fast path: very short conversations are under 8k; skip token count
    if len(messages) <= 8:
        logger.debug(f"[CONTEXT_MGR] Only {len(messages)} messages - skip token count")
        return {}
    
    # Estimate token count (1 token ≈ 4 characters)
    total_tokens = sum(
        len(str(msg.content)) // 4 
        if hasattr(msg, 'content') and msg.content 
        else 0 
        for msg in messages
    )
    
    logger.info(f"[CONTEXT_MGR] Message count: {len(messages)}, Estimated tokens: ~{total_tokens:,}")
    
    # Check if we need to summarize
    if total_tokens < 8000:
        logger.info(f"[CONTEXT_MGR] ✅ Under limit ({total_tokens:,} < 8,000) - no action needed")
        return {}
    
    # Summarization needed!
    logger.warning(
        f"[CONTEXT_MGR] ⚠️  Token limit exceeded! "
        f"({total_tokens:,} >= 8,000) - Triggering summarization..."
    )
    
    # Split messages: old (to summarize) vs recent (to keep)
    old_messages = messages[:-6]
    recent_messages = messages[-6:]
    
    logger.info(
        f"[CONTEXT_MGR] Summarizing {len(old_messages)} old messages, "
        f"keeping {len(recent_messages)} recent"
    )
    
    try:
        # Format old messages for the LLM to summarize
        messages_text = _format_messages_for_summary(old_messages)
        
        # Call cheap LLM to create summary
        llm = ChatOpenAI(model="gpt-4o-mini", api_key=config.openai_api_key, temperature=0)
        
        summary_prompt = get_context_summary_prompt(messages_text)
        
        # Generate summary
        summary_response = await llm.ainvoke([HumanMessage(content=summary_prompt)])
        summary_text = summary_response.content.strip()
        
        # Calculate stats
        summary_tokens = len(summary_text) // 4
        recent_tokens = sum(
            len(str(msg.content)) // 4 
            if hasattr(msg, 'content') and msg.content 
            else 0 
            for msg in recent_messages
        )
        new_total_tokens = summary_tokens + recent_tokens
        
        reduction_percent = int((1 - new_total_tokens / total_tokens) * 100)
        
        logger.info(
            f"[CONTEXT_MGR] ✅ Summarization complete!\n"
            f"  • Summary length: {len(summary_text)} chars (~{summary_tokens:,} tokens)\n"
            f"  • Token reduction: {total_tokens:,} → {new_total_tokens:,} ({reduction_percent}% reduction)\n"
            f"  • Message count: {len(messages)} → {len(recent_messages) + 1}"
        )
        
        # Create summary message
        summary_message = SystemMessage(
            content=get_context_summary_message_content(summary_text, len(old_messages))
        )
        
        # Return new message list: [summary] + recent messages
        return {
            "messages": [summary_message] + recent_messages,
        }
        
    except Exception as e:
        logger.error(
            f"[CONTEXT_MGR] ❌ Failed to summarize messages: {e}",
            exc_info=True
        )
        # On error, keep all messages (prevents data loss, but risky for token limits)
        logger.warning(
            "[CONTEXT_MGR] Keeping all messages due to summarization error - "
            "may hit token limits soon!"
        )
        return {}


def _format_messages_for_summary(messages: list) -> str:
    """
    Format messages into readable text for summarization.
    
    Args:
        messages: List of BaseMessage objects
        
    Returns:
        Formatted string with message history
    """
    formatted_lines = []
    
    for i, msg in enumerate(messages, 1):
        msg_type = msg.__class__.__name__
        
        # Determine role label
        if msg_type == "HumanMessage":
            role = "User"
        elif msg_type == "AIMessage":
            role = "Assistant"
        elif msg_type == "SystemMessage":
            role = "System"
        elif msg_type == "ToolMessage":
            role = "Tool Result"
        else:
            role = msg_type
        
        # Get content
        if hasattr(msg, 'content') and msg.content:
            # Truncate very long messages (keep first 500 chars)
            content = str(msg.content)
            if len(content) > 500:
                content = content[:500] + "... [truncated]"
        elif hasattr(msg, 'tool_calls') and msg.tool_calls:
            # Show tool calls
            tool_names = [tc.get('name', 'unknown') for tc in msg.tool_calls]
            content = f"(Called tools: {', '.join(tool_names)})"
        else:
            content = "(no content)"
        
        formatted_lines.append(f"{i}. {role}: {content}")
    
    return "\n\n".join(formatted_lines)


def estimate_tokens(messages: list) -> int:
    """
    Estimate token count for a list of messages.
    
    Uses rough approximation: 1 token ≈ 4 characters
    
    Args:
        messages: List of BaseMessage objects
        
    Returns:
        Estimated token count
    """
    return sum(
        len(str(msg.content)) // 4 
        if hasattr(msg, 'content') and msg.content 
        else 0 
        for msg in messages
    )


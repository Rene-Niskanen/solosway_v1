"""
Agent turn context: detect when the user is replying to the assistant's request for content
(e.g. for USER.md) so we can route to the agent and instruct it to use the message as content.

Used by routing_nodes.classify_intent and agent_node for OpenClaw-style follow-up intent.
"""

# Phrases in the assistant's last message that indicate it asked for content (e.g. for USER.md).
# When the next message is the user's reply, we treat it as user_context and use it as content.
# Exposed for routing fallback (conversation_history); use last_turn_was_request_for_user_content when possible.
AI_REQUESTED_CONTENT_PHRASES = (
    "provide the content",
    "content you'd like",
    "content you would like",
    "content for your user.md",
    "content for your user md",
    "content you'd like to update",
    "content you would like to update",
    "what content",
    "please provide",
    "content to put",
    "content to write",
    "what you'd like",
    "what you would like",
    "make the changes",
    "i'll make the changes",
    "and i'll make the changes",
)


def _is_ai_message(msg) -> bool:
    """True if msg is an AI message (AIMessage instance or dict from checkpointer)."""
    if hasattr(msg, "__class__") and msg.__class__.__name__ == "AIMessage":
        return True
    if isinstance(msg, dict):
        t = msg.get("type") or msg.get("__class__") or ""
        return t in ("ai", "AIMessage", "aimessage")
    return False


def _is_human_message(msg) -> bool:
    """True if msg is a Human message (HumanMessage instance or dict from checkpointer)."""
    if hasattr(msg, "__class__") and msg.__class__.__name__ == "HumanMessage":
        return True
    if isinstance(msg, dict):
        t = msg.get("type") or msg.get("__class__") or ""
        return t in ("human", "HumanMessage", "humanmessage")
    return False


def _get_message_content(msg) -> str:
    """Get content from a message object or dict (checkpointer deserialization)."""
    if hasattr(msg, "content"):
        return (msg.content or "") if isinstance(msg.content, str) else str(msg.content or "")
    if isinstance(msg, dict):
        c = msg.get("content")
        return (c or "") if isinstance(c, str) else str(c or "")
    return ""


def last_turn_was_request_for_user_content(messages: list) -> bool:
    """
    True if the second-to-last message is an AI message that asked the user for content
    (e.g. for USER.md), so the last (current) message is the user's reply with that content.

    Handles both LangChain message objects and dicts (from checkpointer deserialization).
    Used to route follow-up replies to the agent and to inject turn context.
    """
    if not messages or len(messages) < 2:
        return False
    prev = messages[-2]
    last = messages[-1]
    if not _is_human_message(last) or not _is_ai_message(prev):
        return False
    prev_content = _get_message_content(prev).strip()
    if not prev_content:
        return False
    prev_lower = prev_content.lower()
    return any(phrase in prev_lower for phrase in AI_REQUESTED_CONTENT_PHRASES)


AGENT_TURN_CONTEXT_USER_REPLYING_WITH_CONTENT = """# TURN CONTEXT
Turn type: user_replying_to_content_request
Reply goal: The user is providing the content you asked for (e.g. for USER.md). Use their message as the content for write_workspace_file(USER.md, ...). Do not search documents or ask again.

"""

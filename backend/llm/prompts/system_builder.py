"""
System prompt builder: prepends turn context (turn_type + reply_goal) to conversation
and responder system prompts so the model sees "what this turn is".

Used by conversation_node and by the block-citation generate_conversational_answer_with_citations.
"""

from typing import Literal, Optional

from backend.llm.prompts.conversation import get_conversation_system_content
from backend.llm.prompts.responder import get_responder_block_citation_system_content


def _section_turn_context(mode: str, state: dict) -> str:
    """
    Return a short turn-context block for the system prompt, or empty string.
    Requires state to be a dict; if None or not a dict, returns "".
    """
    if state is None or not isinstance(state, dict):
        return ""
    if mode == "conversation":
        turn_type = "conversation"
        reply_goal = "Answer in a warm, conversational way."
    elif mode == "responder":
        if state.get("use_cached_results"):
            turn_type = "same_doc_follow_up"
            reply_goal = "Answer the follow-up in continuity with the previous answer."
        elif state.get("format_instruction") or state.get("prior_turn_content"):
            turn_type = "format_or_refine"
            reply_goal = "Format or refine the prior answer as requested."
        else:
            turn_type = "initial_question"
            reply_goal = "Answer the user's question clearly using the document content."
    else:
        return ""
    return f"# TURN CONTEXT\nTurn type: {turn_type}\nReply goal: {reply_goal}\n"


def build_system_content(
    mode: Literal["conversation", "responder"],
    state: Optional[dict],
    *,
    personality_context: str = "",
    memories_section: str = "",
    workspace_section: str = "",
) -> str:
    """
    Build system content with optional turn context prepended.

    Conversation: turn_context + get_conversation_system_content(...).
    Responder: turn_context + workspace + get_responder_block_citation_system_content(...).
    When state is None, no turn context is prepended.
    Mem0 injection is NOT done here; it stays in the block-citation function.
    """
    if mode == "conversation":
        base = get_conversation_system_content(
            personality_context=personality_context,
            memories_section=memories_section,
            workspace_section=workspace_section,
        )
        if state is None:
            return base
        return _section_turn_context("conversation", state) + base

    if mode == "responder":
        base = get_responder_block_citation_system_content(personality_context)
        prefix = (workspace_section + "\n\n") if workspace_section else ""
        full = prefix + base
        if state is None:
            return full
        return _section_turn_context("responder", state) + full

    return ""

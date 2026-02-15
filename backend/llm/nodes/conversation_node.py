"""
Conversation node — handles chat messages that don't need document retrieval.

Writes the same state fields as the responder so the frontend needs no changes:
final_summary, personality_id, citations, chunk_citations, messages.
"""

import logging
from langchain_core.messages import AIMessage, SystemMessage, HumanMessage
from langchain_openai import ChatOpenAI

from backend.llm.config import config
from backend.llm.types import MainWorkflowState
from backend.llm.prompts.conversation import (
    get_conversation_system_content,
    format_memories_section,
)
from backend.llm.utils.workspace_context import build_workspace_context
from backend.llm.prompts.personality import (
    VALID_PERSONALITY_IDS,
    DEFAULT_PERSONALITY_ID,
)
from backend.llm.nodes.responder_node import PersonalityResponse

logger = logging.getLogger(__name__)


async def conversation_node(state: MainWorkflowState) -> MainWorkflowState:
    """
    Generate a conversational reply (no document retrieval).

    Uses the same PersonalityResponse structured output as the responder
    so personality selection works identically.
    """
    user_query = state.get("user_query", "")
    messages = state.get("messages", [])
    previous_personality = state.get("personality_id")
    is_first_message = previous_personality is None

    logger.info(
        f"[CONVERSATION] Generating reply for: '{user_query[:80]}...' "
        f"(history: {len(messages)} msgs, prev_personality: {previous_personality})"
    )

    # --- Memory injection (Phase 2 — no-op until mem0_enabled) ---
    memories_section = ""
    if getattr(config, "mem0_enabled", False):
        try:
            from backend.services.memory_service import velora_memory

            memories = await velora_memory.search(
                query=user_query,
                user_id=state.get("user_id", "anonymous"),
                limit=getattr(config, "mem0_search_limit", 5),
            )
            memories_section = format_memories_section(memories)
            if memories_section:
                logger.info(f"[CONVERSATION] Injected {len(memories)} memories")
        except Exception as e:
            logger.warning(f"[CONVERSATION] Memory search failed: {e}")

    # --- Workspace context (current project / documents in scope) ---
    workspace_section = ""
    try:
        property_id = state.get("property_id")
        document_ids = state.get("document_ids")
        business_id = state.get("business_id")
        if business_id and (property_id or document_ids):
            doc_ids = [str(d) for d in document_ids] if isinstance(document_ids, list) else None
            workspace_section = build_workspace_context(property_id, doc_ids, str(business_id))
    except Exception as e:
        logger.warning("[CONVERSATION] build_workspace_context failed: %s", e)

    # --- Build system prompt ---
    personality_context = (
        f"\nPrevious personality for this conversation "
        f"(or None if first message): {previous_personality or 'None'}\n"
        f"Is this the first message in the conversation? {is_first_message}\n"
    )
    system_content = get_conversation_system_content(
        personality_context=personality_context,
        memories_section=memories_section,
        workspace_section=workspace_section,
    )
    system_msg = SystemMessage(content=system_content)

    # --- Build human message (just the user query) ---
    human_msg = HumanMessage(content=user_query)

    # --- Call LLM with structured output ---
    llm = ChatOpenAI(
        model=config.openai_model,
        temperature=0.38,
        max_tokens=4096,  # Avoid mid-sentence cutoff; 1500 was too low for full replies
    )
    structured_llm = llm.with_structured_output(PersonalityResponse)

    try:
        parsed = await structured_llm.ainvoke(
            [system_msg] + messages[-10:] + [human_msg]
        )
        personality_id = (
            parsed.personality_id
            if parsed.personality_id in VALID_PERSONALITY_IDS
            else DEFAULT_PERSONALITY_ID
        )
        response_text = (parsed.response or "").strip()
    except Exception as e:
        logger.warning(f"[CONVERSATION] Structured output failed: {e}")
        fallback_llm = ChatOpenAI(
            model=config.openai_model, temperature=0.38, max_tokens=4096
        )
        response = await fallback_llm.ainvoke(
            [system_msg] + messages[-10:] + [human_msg]
        )
        personality_id = previous_personality or DEFAULT_PERSONALITY_ID
        response_text = (
            response.content
            if hasattr(response, "content") and response.content
            else ""
        )

    logger.info(
        f"[CONVERSATION] Reply generated ({len(response_text)} chars), "
        f"personality={personality_id}"
    )

    return {
        "final_summary": response_text,
        "personality_id": personality_id,
        "citations": [],
        "chunk_citations": [],
        "messages": [AIMessage(content=response_text)],
    }

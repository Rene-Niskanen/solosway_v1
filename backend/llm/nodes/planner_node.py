"""
Planner Node - Generates structured execution plans from user queries.

This node replaces the agent's ad-hoc tool calling with a structured planning phase.
The planner outputs a JSON plan (not text reasoning) that is safe to show to users.

Key Principle: Show operational steps (what will be done), not cognitive reasoning (how the LLM thinks).
"""

import logging
from typing import Any, Optional, List
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from pydantic import BaseModel, Field
from langchain_core.output_parsers import PydanticOutputParser

from backend.llm.config import config
from backend.llm.types import MainWorkflowState
from backend.llm.contracts.validators import validate_planner_output
from backend.llm.prompts.planner import (
    get_planner_system_prompt,
    get_planner_initial_prompt,
    get_planner_followup_prompt,
    REFINE_HINT,
)
from backend.llm.utils.workspace_context import build_workspace_context, get_document_ids_for_property

logger = logging.getLogger(__name__)


def _is_valid_uuid(s: str) -> bool:
    """True if s is a valid UUID string."""
    if not isinstance(s, str) or not s.strip():
        return False
    try:
        from uuid import UUID
        UUID(s.strip())
        return True
    except (ValueError, TypeError):
        return False


def _is_from_step_ref(s: str) -> bool:
    """True if s is a step reference like <from_step_search_docs>."""
    return isinstance(s, str) and s.strip().startswith("<from_step_") and s.strip().endswith(">")


def _has_invalid_document_ids(document_ids: Optional[List[str]]) -> bool:
    """True if any entry is not a valid UUID and not a <from_step_*> reference."""
    if not document_ids:
        return False
    for ref in document_ids:
        if not _is_valid_uuid(ref) and not _is_from_step_ref(ref):
            return True
    return False


def _canonical_two_step_plan(user_query: str) -> dict:
    """Fixed 2-step plan: retrieve_docs then retrieve_chunks with <from_step_search_docs>."""
    q = (user_query or "").strip() or "Search documents"
    return {
        "objective": f"Answer query: {q[:80]}{'...' if len(q) > 80 else ''}",
        "steps": [
            {"id": "search_docs", "action": "retrieve_docs", "query": q, "reasoning_label": "Searched documents", "reasoning_detail": None},
            {"id": "search_chunks", "action": "retrieve_chunks", "query": q, "document_ids": ["<from_step_search_docs>"], "reasoning_label": "Reviewed relevant sections", "reasoning_detail": None},
        ],
        "use_prior_context": False,
        "format_instruction": None,
    }


def _normalize_document_ids(execution_plan: dict, state: MainWorkflowState) -> dict:
    """
    For any retrieve_chunks step with invalid document_ids (placeholder or non-UUID),
    replace from state.document_ids, or resolve state.property_id to doc IDs, or rewrite to 2-step.
    """
    steps = execution_plan.get("steps") or []
    state_doc_ids = state.get("document_ids")
    state_doc_ids = [str(d) for d in state_doc_ids] if isinstance(state_doc_ids, list) and state_doc_ids else None
    property_id = state.get("property_id")
    business_id = state.get("business_id") or ""

    for step in steps:
        if step.get("action") != "retrieve_chunks":
            continue
        doc_ids = step.get("document_ids") or []
        if not _has_invalid_document_ids(doc_ids):
            continue

        if state_doc_ids:
            step["document_ids"] = state_doc_ids
            logger.info("[PLANNER] Normalizer: replaced document_ids from state (%d docs)", len(state_doc_ids))
        elif property_id and business_id:
            resolved = get_document_ids_for_property(property_id, business_id)
            if resolved:
                step["document_ids"] = resolved
                logger.info("[PLANNER] Normalizer: replaced document_ids from property_id (%d docs)", len(resolved))
            else:
                # Can't resolve property -> rewrite to 2-step
                user_query = (state.get("user_query") or "").strip()
                execution_plan.update(_canonical_two_step_plan(user_query))
                logger.info("[PLANNER] Normalizer: invalid document_ids and property_id resolved to 0 docs; rewrote to 2-step")
                return execution_plan
        else:
            # No scope: rewrite entire plan to canonical 2-step
            user_query = (state.get("user_query") or "").strip()
            execution_plan.update(_canonical_two_step_plan(user_query))
            logger.info("[PLANNER] Normalizer: invalid document_ids and no scope; rewrote to 2-step")
            return execution_plan

    return execution_plan

# Prompt for chip-path query rewrite (one short LLM call so retrieval matches document wording)
CHIP_QUERY_REWRITE_PROMPT = """The user is asking a follow-up question about a document they were just viewing. Output a short keyword phrase (3-8 words) that would appear in the document and help find the right passage. Use terms from legal/lease docs when relevant.
Examples:
- "who are the parties involved?" → parties landlord tenant names
- "key dates?" → key dates commencement expiry term
- "main terms?" → main terms conditions
- "renewal options?" → renewal extension options
Output ONLY the keyword phrase, nothing else."""

async def _rewrite_chip_query_for_retrieval(user_query: str) -> str:
    """One short LLM call to turn the user message into a retrieval-effective query. Falls back to user_query on failure."""
    if not (user_query or "").strip():
        return user_query or ""
    try:
        llm = ChatOpenAI(model=config.openai_planner_model, api_key=config.openai_api_key, temperature=0)
        out = await llm.ainvoke([
            SystemMessage(content=CHIP_QUERY_REWRITE_PROMPT),
            HumanMessage(content=(user_query or "").strip()),
        ])
        rewritten = (out.content or "").strip()
        if rewritten and len(rewritten) < 200:
            logger.info("[PLANNER] Chip query rewritten for retrieval: %r -> %r", (user_query or "")[:50], rewritten[:60])
            return rewritten
    except Exception as e:
        logger.warning("[PLANNER] Chip query rewrite failed (%s), using literal", e)
    return user_query or ""

# --- Constants (tunable in one place) ---
SHORT_QUERY_WORD_THRESHOLD = 8
PRIOR_TURN_CONTENT_MAX_CHARS = 8000
OBJECTIVE_PREVIEW_LEN = 60
QUERY_LOG_TRUNCATE = 80

REFINE_PATTERNS = (
    "make that into", "turn that into", "format that as",
    "can you put that in", "rewrite that as", "put that in a",
)
INCOMPLETE_FOLLOWUP_PATTERNS = (
    "that's not all", "not all of them", "that not all", "add the rest",
    "what else", "missing some", "incomplete", "and the others", "need more",
)


def _matches_any(text: str, patterns: tuple) -> bool:
    """True if text (lowercased) contains any of the given patterns."""
    return any(p in (text or "").lower() for p in patterns)


def _is_short_query(user_query: str) -> bool:
    """True if the query has fewer than SHORT_QUERY_WORD_THRESHOLD words."""
    return len((user_query or "").strip().split()) < SHORT_QUERY_WORD_THRESHOLD


def _get_last_ai_content(messages: List[Any], max_chars: int = PRIOR_TURN_CONTENT_MAX_CHARS) -> Optional[str]:
    """Extract content of the last AIMessage in the list, truncated to max_chars."""
    for msg in reversed(messages or []):
        if getattr(msg, "__class__", None) and getattr(msg.__class__, "__name__", "") == "AIMessage":
            content = (getattr(msg, "content", "") or "").strip()
            if content:
                return content[:max_chars] if len(content) > max_chars else content
    return None


def _plan_dict_to_execution_plan(plan_dict: Any) -> dict:
    """Convert parsed Pydantic plan to TypedDict-style execution_plan."""
    return {
        "objective": plan_dict.objective,
        "steps": [
            {
                "id": step.id,
                "action": step.action,
                "query": step.query,
                "document_ids": step.document_ids,
                "reasoning_label": step.reasoning_label,
                "reasoning_detail": step.reasoning_detail,
            }
            for step in plan_dict.steps
        ],
        "use_prior_context": getattr(plan_dict, "use_prior_context", False),
        "format_instruction": getattr(plan_dict, "format_instruction", None),
    }


def _normalize_two_step_plan(execution_plan: dict) -> dict:
    """
    Ensure a 2-step plan is exactly: (1) retrieve_docs, (2) retrieve_chunks.
    If the LLM returns two retrieve_docs steps (causing two "Searching for" in the UI),
    convert the second to retrieve_chunks so we show one search then "Found N docs" / "Reading".
    """
    steps = execution_plan.get("steps") or []
    if len(steps) != 2:
        return execution_plan
    first, second = steps[0], steps[1]
    if (first.get("action") == "retrieve_docs" and second.get("action") == "retrieve_docs"):
        logger.info(
            "[PLANNER] Normalizing plan: second step was retrieve_docs (would show two 'Searching for'); converting to retrieve_chunks"
        )
        # Use first step's query for chunk retrieval so we have one search intent
        query = (first.get("query") or second.get("query") or "").strip()
        first_id = first.get("id") or "search_docs"
        execution_plan["steps"] = [
            first,
            {
                "id": second.get("id") or "search_chunks",
                "action": "retrieve_chunks",
                "query": query,
                "document_ids": [f"<from_step_{first_id}>"],
                "reasoning_label": second.get("reasoning_label") or "Reviewed relevant sections",
                "reasoning_detail": second.get("reasoning_detail"),
            },
        ]
    return execution_plan


def _make_fallback_plan(user_query: str) -> dict:
    """Build a minimal 2-step fallback plan when LLM/parsing fails."""
    q = user_query or ""
    return {
        "objective": f"Answer query: {q}",
        "steps": [
            {"id": "search_docs", "action": "retrieve_docs", "query": q, "reasoning_label": "Searched documents", "reasoning_detail": None},
            {"id": "search_chunks", "action": "retrieve_chunks", "query": q, "document_ids": ["<from_step_search_docs>"], "reasoning_label": "Reviewed relevant sections", "reasoning_detail": None},
        ],
        "use_prior_context": False,
        "format_instruction": None,
    }


def _rephrase_query_to_finding(user_query: str) -> str:
    """Rephrase user query as 'Finding the [X] of [Y]' for the planning step (e.g. 'Find me the EPC of highlands' -> 'Finding the EPC rating of highlands')."""
    q = (user_query or "").strip()
    if not q:
        return "Planning next moves"
    q_lower = q.lower()
    # Strip common lead-in phrases to get the thing they're asking for
    for lead in ("find me the ", "get me the ", "what is the ", "what's the ", "show me the ", "tell me the ", "give me the "):
        if q_lower.startswith(lead):
            rest = q_lower[len(lead):].strip()
            break
    else:
        rest = q_lower
    # Expand common abbreviations for display (e.g. "epc" -> "EPC rating")
    display_rest = rest
    if display_rest.startswith("epc ") or display_rest.startswith("epc of") or display_rest == "epc":
        display_rest = "EPC rating" + display_rest[3:]  # len("epc") = 3
    elif display_rest.startswith("mv ") or display_rest.startswith("mv of") or display_rest == "mv":
        display_rest = "market value" + display_rest[2:]
    # Capitalise first letter; preserve property/location name (e.g. "highlands")
    if " of " in display_rest:
        part, name = display_rest.split(" of ", 1)
        part = part.strip().capitalize() if part else "information"
        name = name.strip().title() if name else ""
        return f"Finding the {part} of {name}" if name else f"Finding the {part}"
    if " for " in display_rest:
        part, name = display_rest.split(" for ", 1)
        part = part.strip().capitalize() if part else "information"
        name = name.strip().title() if name else ""
        return f"Finding the {part} for {name}" if name else f"Finding the {part}"
    return f"Finding the {display_rest.strip().capitalize()}" if display_rest else "Planning next moves"


def _log_rewrite_if_applied(execution_plan: dict, user_query: str) -> None:
    """Log when the first step's query differs from user query (likely rewritten for short follow-up)."""
    steps = execution_plan.get("steps") or []
    uq = (user_query or "").strip()
    if not steps or not uq:
        return
    first_q = (steps[0].get("query") or "").strip().lower()
    uq_lower = uq.lower()
    if first_q != uq_lower and uq_lower not in first_q:
        logger.info('[PLANNER] Rewrote short follow-up query -> "%s"', (steps[0].get("query") or "")[:QUERY_LOG_TRUNCATE])


class ExecutionStepModel(BaseModel):
    """Pydantic model for a single execution step - simplified for Golden Path RAG"""
    id: str = Field(description="Unique step identifier (e.g., 'search_docs', 'search_chunks')")
    action: str = Field(description="Action type: 'retrieve_docs' or 'retrieve_chunks'")
    query: str = Field(description="Search query - MUST be the user's query, passed through unchanged")
    document_ids: Optional[List[str]] = Field(default=None, description="Document IDs for retrieve_chunks (use '<from_step_X>' to reference previous steps)")
    reasoning_label: str = Field(description="Human-readable action label for user (e.g., 'Searched documents')")
    reasoning_detail: Optional[str] = Field(default=None, description="Optional clarification for user")


class ExecutionPlanModel(BaseModel):
    """Pydantic model for execution plan"""
    objective: str = Field(description="High-level goal of the plan")
    steps: list[ExecutionStepModel] = Field(description="Ordered list of execution steps (0, 1, or 2)")
    use_prior_context: bool = Field(default=False, description="True when user asks to restructure/format prior answer")
    format_instruction: Optional[str] = Field(default=None, description="User-requested output format (e.g. one concise paragraph)")


async def planner_node(state: MainWorkflowState, runnable_config=None) -> MainWorkflowState:
    """
    Planner node - generates structured execution plan from user query.
    
    This node:
    1. Takes user query
    2. Generates structured JSON plan (not text reasoning)
    3. Emits plan as execution event (visible to user)
    4. Outputs plan to state for executor
    
    Args:
        state: MainWorkflowState with user_query
        runnable_config: Optional RunnableConfig from LangGraph
        
    Returns:
        Updated state with execution_plan
    """
    user_query = state.get("user_query", "") or ""
    messages = state.get("messages", []) or []
    emitter = state.get("execution_events")
    plan_refinement_count = state.get("plan_refinement_count", 0)
    if emitter is None:
        logger.warning("[PLANNER] ⚠️  Emitter is None - reasoning events will not be emitted")

    # Chip path: document_ids in state → fixed 1-step plan (retrieve_chunks only). One short LLM call to rewrite query for retrieval.
    raw_doc_ids = state.get("document_ids")
    if raw_doc_ids and isinstance(raw_doc_ids, list) and len(raw_doc_ids) > 0:
        document_ids = [str(d) for d in raw_doc_ids if d]
        if document_ids:
            retrieval_query = await _rewrite_chip_query_for_retrieval(user_query)
            logger.info("[PLANNER] Chip query: 1-step plan (retrieve_chunks with %d doc(s))", len(document_ids))
            execution_plan = {
                "objective": f"Answer: {user_query[:80]}{'...' if len(user_query) > 80 else ''}" if user_query else "Answer using selected document(s)",
                "steps": [
                    {
                        "id": "search_chunks",
                        "action": "retrieve_chunks",
                        "query": retrieval_query,
                        "document_ids": document_ids,
                        "reasoning_label": "Pulling relevant passages",
                        "reasoning_detail": None,
                    }
                ],
                "use_prior_context": False,
                "format_instruction": None,
            }
            if emitter:
                planning_label = _rephrase_query_to_finding(user_query)
                emitter.emit_reasoning(label=planning_label, detail=None)
            plan_message = AIMessage(
                content=f"Generated execution plan: {execution_plan['objective']} (1 step)"
            )
            planner_output = {
                "execution_plan": execution_plan,
                "current_step_index": 0,
                "execution_results": [],
                "messages": [plan_message],
                "plan_refinement_count": plan_refinement_count,
                "prior_turn_content": None,
                "format_instruction": None,
            }
            validate_planner_output(planner_output)
            return planner_output

    # No-scope path: no document_ids, no property_id -> inject fixed 2-step plan (skip LLM for plan shape)
    property_id = state.get("property_id")
    has_document_scope = bool(
        (raw_doc_ids and isinstance(raw_doc_ids, list) and len(raw_doc_ids) > 0)
        or property_id
    )
    if not has_document_scope:
        # When router sends us back after "no results", we must increment refinement count so the loop eventually stops
        is_refinement = state.get("execution_plan") is not None
        if is_refinement:
            plan_refinement_count += 1
            logger.info("[PLANNER] Refining plan (attempt %s/3) for query: '%s...'", plan_refinement_count, (user_query or "")[:80])
        user_query_stripped = (user_query or "").strip() or "Search documents"
        execution_plan = _canonical_two_step_plan(user_query_stripped)
        logger.info("[PLANNER] No scope: injected fixed 2-step plan (no LLM)")
        if emitter:
            planning_label = _rephrase_query_to_finding(user_query)
            emitter.emit_reasoning(label=planning_label, detail=None)
        plan_message = AIMessage(
            content=f"Generated execution plan: {execution_plan['objective']} (2 steps)"
        )
        planner_output = {
            "execution_plan": execution_plan,
            "current_step_index": 0,
            "execution_results": [],
            "messages": [plan_message],
            "plan_refinement_count": plan_refinement_count,
            "prior_turn_content": None,
            "format_instruction": None,
        }
        validate_planner_output(planner_output)
        return planner_output

    is_refinement = plan_refinement_count > 0 or state.get("execution_plan") is not None
    if is_refinement:
        plan_refinement_count += 1
        logger.info("[PLANNER] Refining plan (attempt %s/3) for query: '%s...'", plan_refinement_count, user_query[:80])
    else:
        logger.info("[PLANNER] Generating initial plan for query: '%s...'", user_query[:80])

    parser = PydanticOutputParser(pydantic_object=ExecutionPlanModel)
    planner_base = get_planner_system_prompt()
    workspace_section = ""
    try:
        property_id = state.get("property_id")
        document_ids = state.get("document_ids")
        business_id = state.get("business_id")
        if business_id and (property_id or document_ids):
            doc_ids = [str(d) for d in document_ids] if isinstance(document_ids, list) else None
            workspace_section = build_workspace_context(property_id, doc_ids, str(business_id))
    except Exception as e:
        logger.warning("[PLANNER] build_workspace_context failed: %s", e)
    if workspace_section:
        planner_base = planner_base + "\n\n" + workspace_section
    system_prompt = SystemMessage(content=planner_base)

    is_refine_format = _matches_any(user_query, REFINE_PATTERNS)
    refine_hint = REFINE_HINT if is_refine_format else ""

    if not messages:
        prompt = get_planner_initial_prompt(user_query, refine_hint, parser.get_format_instructions())
        messages_to_use = [system_prompt, HumanMessage(content=prompt)]
    else:
        # LLM decides follow-up and infers query via FOLLOW_UP_DECISION_PARAGRAPH in the prompt
        prompt = get_planner_followup_prompt(user_query, refine_hint, parser.get_format_instructions())
        messages_to_use = [system_prompt] + messages + [HumanMessage(content=prompt)]

    # Use planner-specific model (default gpt-4o-mini) to keep main-path latency lower.
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_planner_model,
        temperature=0,
    )

    try:
        response = await llm.ainvoke(messages_to_use)
        plan_dict = parser.parse(response.content)
        execution_plan = _plan_dict_to_execution_plan(plan_dict)
        execution_plan = _normalize_two_step_plan(execution_plan)
        execution_plan = _normalize_document_ids(execution_plan, state)

        logger.info("[PLANNER] ✅ Generated plan with %s steps", len(execution_plan["steps"]))
        logger.info("[PLANNER] Objective: %s", execution_plan["objective"])
        for i, step in enumerate(execution_plan["steps"]):
            logger.info("  [%s] %s: %s - %s...", i, step["id"], step["action"], (step.get("query") or "N/A")[:50])
        _log_rewrite_if_applied(execution_plan, user_query)

        if emitter:
            # Rephrase user query as "Finding the [X] of [Y]" (e.g. "Finding the EPC rating of highlands")
            planning_label = _rephrase_query_to_finding(user_query)
            emitter.emit_reasoning(label=planning_label, detail=None)

        prior_turn_content = None
        if execution_plan.get("use_prior_context") and messages:
            prior_turn_content = _get_last_ai_content(messages)

        plan_message = AIMessage(
            content=f"Generated execution plan: {execution_plan['objective']} ({len(execution_plan['steps'])} steps)"
        )
        planner_output = {
            "execution_plan": execution_plan,
            "current_step_index": 0,
            "execution_results": [],
            "messages": [plan_message],
            "plan_refinement_count": plan_refinement_count,
            "prior_turn_content": prior_turn_content,
            "format_instruction": execution_plan.get("format_instruction"),
        }
        validate_planner_output(planner_output)
        return planner_output

    except Exception as e:
        logger.error("[PLANNER] ❌ Error generating plan: %s", e, exc_info=True)
        fallback_plan = _make_fallback_plan(user_query)
        logger.warning("[PLANNER] Using fallback plan")
        fallback_output = {
            "execution_plan": fallback_plan,
            "current_step_index": 0,
            "execution_results": [],
            "plan_refinement_count": plan_refinement_count,
            "prior_turn_content": None,
            "format_instruction": None,
        }
        try:
            validate_planner_output(fallback_output)
        except ValueError as val_err:
            logger.error("[PLANNER] ❌ Fallback plan contract violation: %s", val_err)
            raise
        return fallback_output


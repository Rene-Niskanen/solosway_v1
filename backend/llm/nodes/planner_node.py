"""
Planner Node - Generates structured execution plans from user queries.

This node replaces the agent's ad-hoc tool calling with a structured planning phase.
The planner outputs a JSON plan (not text reasoning) that is safe to show to users.

Key Principle: Show operational steps (what will be done), not cognitive reasoning (how the LLM thinks).
"""

import logging
import json
from typing import Dict, Any, Optional, List
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field
from langchain_core.output_parsers import PydanticOutputParser

from backend.llm.config import config
from backend.llm.types import MainWorkflowState, ExecutionPlan, ExecutionStep
from backend.llm.utils.system_prompts import get_system_prompt
from backend.llm.utils.execution_events import ExecutionEvent, ExecutionEventEmitter
from backend.llm.contracts.validators import validate_planner_output

logger = logging.getLogger(__name__)


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
    steps: list[ExecutionStepModel] = Field(description="Ordered list of execution steps")


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
    user_query = state.get("user_query", "")
    messages = state.get("messages", [])
    emitter = state.get("execution_events")
    if emitter is None:
        logger.warning("[PLANNER] ⚠️  Emitter is None - reasoning events will not be emitted")
    business_id = state.get("business_id")
    plan_refinement_count = state.get("plan_refinement_count", 0)
    
    # Increment refinement count if this is a refinement (not the first plan)
    # A refinement occurs when:
    # 1. plan_refinement_count > 0 (already refined before)
    # 2. execution_plan exists (router sent us back to refine)
    is_refinement = plan_refinement_count > 0 or state.get("execution_plan") is not None
    if is_refinement:
        plan_refinement_count += 1
        logger.info(f"[PLANNER] Refining plan (attempt {plan_refinement_count}/3) for query: '{user_query[:80]}...'")
    else:
        logger.info(f"[PLANNER] Generating initial plan for query: '{user_query[:80]}...'")
    
    # Create output parser for structured plan
    parser = PydanticOutputParser(pydantic_object=ExecutionPlanModel)
    
    # Build simplified planner prompt - Golden Path RAG
    system_prompt_content = """You are a simple planning assistant that creates a 2-step execution plan.

CRITICAL RULES:
1. Output ONLY a valid JSON plan (no explanations, no reasoning, no text)
2. Always generate exactly 2 steps:
   - Step 1: retrieve_docs with user's query (unchanged)
   - Step 2: retrieve_chunks with user's query (unchanged) and document_ids from step 1
3. Pass the user's query through UNCHANGED - do not modify, expand, or interpret it
4. Use simple reasoning labels like "Searched documents" and "Reviewed relevant sections"

EXAMPLE PLAN:
{
  "objective": "Answer: [USER_QUERY]",
  "steps": [
    {
      "id": "search_docs",
      "action": "retrieve_docs",
      "query": "[USER_QUERY - UNCHANGED]",
      "reasoning_label": "Searched documents"
    },
    {
      "id": "search_chunks",
      "action": "retrieve_chunks",
      "query": "[USER_QUERY - UNCHANGED]",
      "document_ids": ["<from_step_search_docs>"],
      "reasoning_label": "Reviewed relevant sections"
    }
  ]
}

Now generate a plan for the user's query."""
    
    system_prompt = SystemMessage(content=system_prompt_content)
    
    # Use existing messages if available, otherwise create new
    if not messages:
        prompt = f"""User Query: {user_query}

Generate a structured execution plan to answer this query.

{parser.get_format_instructions()}"""
        messages_to_use = [system_prompt, HumanMessage(content=prompt)]
    else:
        # Use existing conversation context BUT focus queries on CURRENT query
        prompt = f"""Based on the conversation history, generate a structured execution plan for the latest query.

⚠️ CRITICAL: When generating the "query" field for each step, use keywords from the CURRENT user query below, NOT from conversation history. The conversation history is only for understanding context, but search queries must target the current question.

Current User Query: {user_query}

{parser.get_format_instructions()}"""
        messages_to_use = [system_prompt] + messages + [HumanMessage(content=prompt)]
    
    # Create LLM with structured output
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )
    
    try:
        # Invoke LLM to generate plan
        response = await llm.ainvoke(messages_to_use)
        
        # Parse structured output
        plan_dict = parser.parse(response.content)
        
        # Convert Pydantic model to TypedDict - simplified
        execution_plan: ExecutionPlan = {
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
            ]
        }
        
        logger.info(f"[PLANNER] ✅ Generated plan with {len(execution_plan['steps'])} steps")
        logger.info(f"[PLANNER] Objective: {execution_plan['objective']}")
        for i, step in enumerate(execution_plan['steps']):
            logger.info(f"  [{i}] {step['id']}: {step['action']} - {step.get('query', 'N/A')[:50]}...")
        
        # Emit user-facing reasoning events (not internal plan details)
        if emitter:
            # Emit user-facing reasoning for the overall plan
            objective_preview = execution_plan['objective'][:60] + "..." if len(execution_plan['objective']) > 60 else execution_plan['objective']
            emitter.emit_reasoning(
                label=f"Planning search for: {objective_preview}",
                detail=None  # Keep it concise
            )
            
            # Don't emit internal plan structure - that's implementation noise
            # The executor will emit reasoning events for each step
        
        # Add plan message to conversation history
        from langchain_core.messages import AIMessage
        plan_message = AIMessage(content=f"Generated execution plan: {execution_plan['objective']} ({len(execution_plan['steps'])} steps)")
        
        # Prepare output (after plan_message is defined)
        planner_output = {
            "execution_plan": execution_plan,
            "current_step_index": 0,
            "execution_results": [],
            "messages": [plan_message],
            "plan_refinement_count": plan_refinement_count  # Track refinement count
        }
        
        # Validate output against contract
        try:
            validate_planner_output(planner_output)
        except ValueError as e:
            logger.error(f"[PLANNER] ❌ Contract violation: {e}")
            raise
        
        return planner_output
        
    except Exception as e:
        logger.error(f"[PLANNER] ❌ Error generating plan: {e}", exc_info=True)
        # Fallback: Create a simple 2-step plan
        fallback_plan: ExecutionPlan = {
            "objective": f"Answer query: {user_query}",
            "steps": [
                {
                    "id": "search_docs",
                    "action": "retrieve_docs",
                    "query": user_query,
                    "reasoning_label": "Searched documents",
                    "reasoning_detail": None
                },
                {
                    "id": "search_chunks",
                    "action": "retrieve_chunks",
                    "query": user_query,
                    "document_ids": ["<from_step_search_docs>"],
                    "reasoning_label": "Reviewed relevant sections",
                    "reasoning_detail": None
                }
            ]
        }
        
        logger.warning(f"[PLANNER] Using fallback plan")
        fallback_output = {
            "execution_plan": fallback_plan,
            "current_step_index": 0,
            "execution_results": [],
            "plan_refinement_count": plan_refinement_count  # Track refinement count
        }
        
        # Validate fallback output
        try:
            validate_planner_output(fallback_output)
        except ValueError as e:
            logger.error(f"[PLANNER] ❌ Fallback plan contract violation: {e}")
            raise
        
        return fallback_output


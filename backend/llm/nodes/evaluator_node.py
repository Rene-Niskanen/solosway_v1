"""
Evaluator Node - Evaluates plan execution and emits evaluation events.

IMPORTANT: This node does NOT decide routing. It only:
1. Evaluates execution status
2. Emits evaluation events (visible to user)
3. Returns empty state (routing handled by centralized router)

Key Principle: Nodes emit events, router decides flow.
"""

import logging
from backend.llm.types import MainWorkflowState
from backend.llm.utils.execution_events import ExecutionEvent, ExecutionEventEmitter
from backend.llm.contracts.validators import validate_evaluator_input
from backend.llm.utils.node_logging import log_node_perf

logger = logging.getLogger(__name__)


@log_node_perf("evaluator")
async def evaluator_node(state: MainWorkflowState, runnable_config=None) -> MainWorkflowState:
    """
    Evaluator node - evaluates execution and emits evaluation event.
    
    This node:
    1. Checks plan completion status
    2. Evaluates result sufficiency
    3. Emits evaluation event (visible to user)
    4. Returns empty state (routing handled by centralized router)
    
    IMPORTANT: This node does NOT decide routing. The centralized router
    (RouterContract.route) makes routing decisions based on state.
    
    Args:
        state: MainWorkflowState with execution_plan, current_step_index, execution_results
        runnable_config: Optional RunnableConfig from LangGraph
        
    Returns:
        Empty dict (no state modifications, routing handled by router)
    """
    # Validate input against contract
    try:
        validate_evaluator_input(state)
    except ValueError as e:
        logger.error(f"[EVALUATOR] ❌ Contract violation: {e}")
        raise
    
    execution_plan = state.get("execution_plan")
    current_step_index = state.get("current_step_index", 0)
    execution_results = state.get("execution_results", [])
    emitter = state.get("execution_events")
    
    if not execution_plan:
        logger.warning("[EVALUATOR] No execution plan found")
        return {}
    
    steps = execution_plan.get("steps", [])
    total_steps = len(steps)
    completed_steps = current_step_index
    
    # Count successful results
    successful_results = sum(1 for r in execution_results if r.get("success", False))
    has_documents = any(r.get("action") == "retrieve_docs" and r.get("result") for r in execution_results)
    has_chunks = any(r.get("action") == "retrieve_chunks" and r.get("result") for r in execution_results)
    
    # Determine evaluation status (for event emission only, not routing)
    all_steps_complete = current_step_index >= total_steps
    
    # Determine evaluation status for logging
    if all_steps_complete:
        evaluation_status = "complete"
    elif has_chunks:
        evaluation_status = "has_chunks"
    elif has_documents:
        evaluation_status = "has_documents"
    else:
        evaluation_status = "in_progress"
    
    # Don't emit evaluation events - they're not user-relevant
    # The frontend will show "Analysing..." when loading
    
    logger.info(f"[EVALUATOR] Evaluation: {evaluation_status} (steps: {completed_steps}/{total_steps}, successful: {successful_results})")
    
    # Return empty state (routing handled by centralized router)
    return {}


"""
Node Contracts - Explicit Input/Output shapes for all nodes.

This enforces:
- What each node expects (input)
- What each node produces (output)
- What events each node emits
- How nodes interact with state

Key Principle: Nodes are pure functions with explicit contracts.
"""

from typing import TypedDict, Literal, Optional, List, Dict, Any
from backend.llm.types import MainWorkflowState, ExecutionPlan, ExecutionStep
from backend.llm.utils.execution_events import ExecutionEvent


# ============================================================================
# PLANNER NODE CONTRACT
# ============================================================================

class PlannerInput(TypedDict, total=False):
    """Input contract for planner_node"""
    user_query: str
    messages: Optional[List]  # Conversation history
    execution_events: Optional[Any]  # ExecutionEventEmitter
    business_id: Optional[str]


class PlannerOutput(TypedDict):
    """Output contract for planner_node"""
    execution_plan: ExecutionPlan  # REQUIRED: Must produce a plan
    current_step_index: int  # REQUIRED: Always starts at 0
    execution_results: List[Dict[str, Any]]  # REQUIRED: Empty list initially
    messages: Optional[List]  # Optional: Plan message for history


class PlannerEventContract:
    """Event contract for planner_node"""
    REQUIRED_EVENTS = [
        {
            "type": "phase",
            "description": "Plan: {objective}",
            "metadata": {
                "objective": str,
                "step_count": int,
                "steps": List[Dict[str, str]]  # [{"id": str, "action": str, "query": str}]
            }
        }
    ]


# ============================================================================
# EXECUTOR NODE CONTRACT
# ============================================================================

class ExecutorInput(TypedDict, total=False):
    """Input contract for executor_node"""
    execution_plan: ExecutionPlan  # REQUIRED: Must have plan
    current_step_index: int  # REQUIRED: Which step to execute
    execution_results: List[Dict[str, Any]]  # REQUIRED: Previous results
    execution_events: Optional[Any]  # ExecutionEventEmitter
    business_id: Optional[str]


class ExecutorOutput(TypedDict):
    """Output contract for executor_node"""
    current_step_index: int  # REQUIRED: Updated to next step
    execution_results: List[Dict[str, Any]]  # REQUIRED: Appended with new result
    # Result structure: {
    #   "step_id": str,
    #   "action": str,
    #   "result": Any,
    #   "success": bool,
    #   "error": Optional[str]
    # }


class ExecutorEventContract:
    """Event contract for executor_node
    
    REQUIRED_EVENTS:
    - Pre-execution event: type is "retrieve_docs", "retrieve_chunks", or "tool"
    - Post-execution event: type matches pre-event, status is "success" or "error"
    """
    # Note: Event types are validated at runtime, not in class definition
    REQUIRED_EVENTS = [
        {
            "type": "retrieve_docs",  # Or "retrieve_chunks" or "tool"
            "description": "Pre-execution description",
            "metadata": {"step_id": str, "action": str, "query": Optional[str]}
        },
        {
            "type": "retrieve_docs",  # Or "retrieve_chunks" or "tool" (matches pre-event)
            "description": "Post-execution result",
            "metadata": {"step_id": str, "status": "success", "result_count": int},  # status: "success" or "error"
            "parent_event_id": str  # Links to pre-event
        }
    ]


# ============================================================================
# EVALUATOR NODE CONTRACT
# ============================================================================

class EvaluatorInput(TypedDict, total=False):
    """Input contract for evaluator_node"""
    execution_plan: ExecutionPlan  # REQUIRED
    current_step_index: int  # REQUIRED
    execution_results: List[Dict[str, Any]]  # REQUIRED
    execution_events: Optional[Any]  # ExecutionEventEmitter


class EvaluatorOutput(TypedDict, total=False):
    """Output contract for evaluator_node"""
    # Evaluator doesn't modify state, only emits events
    # Routing decision is returned via router function
    pass


class EvaluatorEventContract:
    """Event contract for evaluator_node
    
    REQUIRED_EVENTS:
    - Evaluation event: type is "phase", evaluation_status in metadata
    """
    REQUIRED_EVENTS = [
        {
            "type": "phase",
            "description": "Evaluation text",
            "metadata": {
                "evaluation_status": "in_progress",  # Or "complete_sufficient", "complete_partial", "complete_insufficient"
                "steps_completed": int,
                "total_steps": int,
                "successful_results": int,
                "has_documents": bool,
                "has_chunks": bool
            }
        }
    ]


# ============================================================================
# RESPONDER NODE CONTRACT
# ============================================================================

class ResponderInput(TypedDict, total=False):
    """Input contract for responder_node"""
    user_query: str  # REQUIRED
    execution_results: List[Dict[str, Any]]  # REQUIRED
    execution_events: Optional[Any]  # ExecutionEventEmitter


class ResponderOutput(TypedDict):
    """Output contract for responder_node"""
    final_summary: str  # REQUIRED: Must produce answer


class ResponderEventContract:
    """Event contract for responder_node
    
    REQUIRED_EVENTS:
    - Completion event: type is "phase", description is "Answer generated", "Error generating answer", or "No results found"
    """
    REQUIRED_EVENTS = [
        {
            "type": "phase",
            "description": "Answer generated",  # Or "Error generating answer" or "No results found"
            "metadata": {
                "status": "complete",  # Or "error" or "no_results"
                "answer_length": Optional[int],
                "chunks_used": Optional[int]
            }
        }
    ]


# ============================================================================
# ROUTER CONTRACT (Single Owner of Flow Control)
# ============================================================================

class RouterDecision(TypedDict):
    """Router decision contract"""
    next_node: Literal["executor", "planner", "responder", "END"]
    reason: str  # Why this decision was made
    metadata: Optional[Dict[str, Any]]  # Additional context


class RouterContract:
    """
    Router Contract - Single owner of "what happens next"
    
    Rules:
    1. Router is the ONLY place that decides flow
    2. Nodes never decide routing (they only emit events)
    3. Router reads state and returns decision
    4. Graph edges use router function
    
    Flow Rules:
    - executor → evaluator (always, after each step)
    - evaluator → router decision:
      * More steps? → executor
      * All steps done + results sufficient? → responder
      * All steps done + results insufficient? → planner (refine)
      * Error? → END (with error message)
    - planner → executor (always, after plan generation)
    - responder → END (always, after answer generation)
    """
    
    @staticmethod
    def route(state: MainWorkflowState) -> RouterDecision:
        """
        Centralized routing logic.
        
        This is the SINGLE SOURCE OF TRUTH for flow control.
        
        Args:
            state: Current workflow state
            
        Returns:
            RouterDecision with next_node and reason
        """
        import logging
        logger = logging.getLogger(__name__)
        
        execution_plan = state.get("execution_plan")
        current_step_index = state.get("current_step_index", 0)
        execution_results = state.get("execution_results", [])
        plan_refinement_count = state.get("plan_refinement_count", 0)
        
        # CIRCUIT BREAKER: Prevent infinite refinement loops
        MAX_REFINEMENTS = 3
        if plan_refinement_count >= MAX_REFINEMENTS:
            logger.warning(f"[ROUTER] ⚠️ Plan refinement limit ({MAX_REFINEMENTS}) reached, routing to responder with 'no results' message")
            return RouterDecision(
                next_node="responder",
                reason=f"Plan refinement limit ({MAX_REFINEMENTS}) reached - no results found after multiple attempts",
                metadata={
                    "has_documents": False,
                    "has_chunks": False,
                    "refinement_limit_reached": True,
                    "refinement_count": plan_refinement_count
                }
            )
        
        # No plan = error state
        if not execution_plan:
            logger.warning("[ROUTER] No execution plan found, routing to END")
            return RouterDecision(
                next_node="END",
                reason="No execution plan found",
                metadata={"error": "missing_plan"}
            )
        
        steps = execution_plan.get("steps", [])
        total_steps = len(steps)
        
        # Check if all steps are complete
        if current_step_index >= total_steps:
            logger.info(f"[ROUTER] All {total_steps} steps completed, evaluating results")
            
            # Evaluate result sufficiency
            has_documents = any(
                r.get("action") == "retrieve_docs" and r.get("result")
                for r in execution_results
            )
            has_chunks = any(
                r.get("action") == "retrieve_chunks" and r.get("result")
                for r in execution_results
            )
            
            if has_chunks:
                logger.info("[ROUTER] ✅ Results sufficient (chunks found), routing to responder")
                return RouterDecision(
                    next_node="responder",
                    reason="All steps complete, chunks found - sufficient for answer",
                    metadata={"has_documents": has_documents, "has_chunks": has_chunks}
                )
            elif has_documents and not has_chunks:
                # Documents but no chunks - might need refinement, but try responder first
                logger.warning("[ROUTER] ⚠️ Documents found but no chunks - attempting answer")
                return RouterDecision(
                    next_node="responder",
                    reason="All steps complete, documents found but no chunks - attempting answer",
                    metadata={"has_documents": True, "has_chunks": False}
                )
            else:
                # No results - refine plan (but check circuit breaker first)
                if plan_refinement_count >= MAX_REFINEMENTS:
                    logger.warning(f"[ROUTER] ⚠️ Plan refinement limit ({MAX_REFINEMENTS}) reached, routing to responder")
                    return RouterDecision(
                        next_node="responder",
                        reason=f"Plan refinement limit ({MAX_REFINEMENTS}) reached - no results found after multiple attempts",
                        metadata={
                            "has_documents": False,
                            "has_chunks": False,
                            "refinement_limit_reached": True,
                            "refinement_count": plan_refinement_count
                        }
                    )
                # Planner will increment refinement_count when it sees existing execution_plan
                logger.warning(f"[ROUTER] ⚠️ No results found (current refinement: {plan_refinement_count}/{MAX_REFINEMENTS}), routing to planner for refinement")
                return RouterDecision(
                    next_node="planner",
                    reason=f"All steps complete but no results - refining plan (attempt {plan_refinement_count + 1}/{MAX_REFINEMENTS})",
                    metadata={"has_documents": False, "has_chunks": False, "refinement_count": plan_refinement_count}
                )
        
        # More steps remaining
        logger.info(f"[ROUTER] Step {current_step_index + 1}/{total_steps} complete, continuing execution")
        return RouterDecision(
            next_node="executor",
            reason=f"Step {current_step_index + 1}/{total_steps} complete, continuing execution",
            metadata={"current_step": current_step_index, "total_steps": total_steps}
        )


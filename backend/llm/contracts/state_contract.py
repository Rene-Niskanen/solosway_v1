"""
State Contract - Explicit shared state model for Planner → Executor → Responder flow.

This defines:
- What state fields are required/optional
- How state flows between nodes
- State invariants (what must be true at each stage)

Key Principle: State is explicit and validated at each stage.
"""

from typing import TypedDict, Optional, List, Dict, Any
from backend.llm.types import ExecutionPlan


class PlannerExecutorState(TypedDict, total=False):
    """
    State contract for Planner → Executor → Responder flow.
    
    Invariants:
    - If execution_plan exists, current_step_index must be valid (0 <= index <= len(steps))
    - execution_results length must equal current_step_index (one result per executed step)
    - If current_step_index == len(steps), all steps are complete
    
    State Flow:
    1. START → planner: Requires user_query
    2. planner → executor: Requires execution_plan, current_step_index=0, execution_results=[]
    3. executor → evaluator: Requires execution_plan, current_step_index (incremented), execution_results (appended)
    4. evaluator → router: Requires execution_plan, current_step_index, execution_results
    5. router → executor/planner/responder: Based on evaluation
    6. responder → END: Requires final_summary
    """
    # REQUIRED for planner (input)
    user_query: str
    execution_events: Optional[Any]  # ExecutionEventEmitter
    
    # REQUIRED after planner (output)
    execution_plan: ExecutionPlan
    current_step_index: int  # Must be 0 after planner, incremented by executor
    execution_results: List[Dict[str, Any]]  # One entry per executed step
    
    # REQUIRED after responder (output)
    final_summary: str
    
    # Optional (for context)
    business_id: Optional[str]
    messages: Optional[List]  # Conversation history


def validate_state_invariants(state: Dict[str, Any]) -> bool:
    """
    Validate state invariants.
    
    Raises ValueError if invariants are violated.
    """
    execution_plan = state.get("execution_plan")
    current_step_index = state.get("current_step_index", 0)
    execution_results = state.get("execution_results", [])
    
    if execution_plan:
        steps = execution_plan.get("steps", [])
        total_steps = len(steps)
        
        # Invariant 1: current_step_index must be valid
        if current_step_index < 0 or current_step_index > total_steps:
            raise ValueError(
                f"Invalid current_step_index: {current_step_index} "
                f"(must be 0 <= index <= {total_steps})"
            )
        
        # Invariant 2: execution_results length should equal current_step_index
        # (one result per executed step)
        if len(execution_results) != current_step_index:
            raise ValueError(
                f"execution_results length ({len(execution_results)}) "
                f"does not match current_step_index ({current_step_index})"
            )
    
    return True


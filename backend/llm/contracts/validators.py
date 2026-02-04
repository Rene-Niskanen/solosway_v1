"""
Node Validators - Enforce contracts at runtime.

This catches contract violations early and provides clear error messages.

Key Principle: Fail fast with clear error messages.
"""

from typing import Dict, Any
import logging
from backend.llm.contracts.node_contracts import (
    PlannerOutput,
    ExecutorOutput,
    ResponderOutput,
    EvaluatorInput,
)
from backend.llm.contracts.state_contract import validate_state_invariants

logger = logging.getLogger(__name__)


def validate_planner_output(output: Dict[str, Any], input_state: Dict[str, Any] = None) -> bool:
    """
    Validate planner node output matches contract.
    
    Args:
        output: Planner node output
        input_state: Optional input state for additional validation
        
    Returns:
        True if valid
        
    Raises:
        ValueError if contract violated
    """
    required = ["execution_plan", "current_step_index", "execution_results"]
    for field in required:
        if field not in output:
            raise ValueError(f"Planner output missing required field: {field}")
    
    # Check that current_step_index is 0
    if output["current_step_index"] != 0:
        raise ValueError(
            f"Planner must set current_step_index to 0, got {output['current_step_index']}"
        )
    
    # Check that execution_results is empty list
    if output["execution_results"] != []:
        raise ValueError(
            f"Planner must initialize execution_results as empty list, got {output['execution_results']}"
        )
    
    # Check that execution_plan has required fields
    plan = output["execution_plan"]
    if "objective" not in plan or "steps" not in plan:
        raise ValueError("execution_plan must have 'objective' and 'steps' fields")
    
    if not isinstance(plan["steps"], list):
        raise ValueError("execution_plan.steps must be a list")
    
    if len(plan["steps"]) not in (0, 1, 2):
        raise ValueError(
            f"execution_plan.steps must have 0, 1, or 2 steps, got {len(plan['steps'])}"
        )
    
    logger.debug("[VALIDATOR] ✅ Planner output contract validated")
    return True


def validate_executor_output(output: Dict[str, Any], input_state: Dict[str, Any]) -> bool:
    """
    Validate executor node output matches contract.
    
    Args:
        output: Executor node output
        input_state: Input state (required for validation)
        
    Returns:
        True if valid
        
    Raises:
        ValueError if contract violated
    """
    if not input_state:
        raise ValueError("validate_executor_output requires input_state")
    
    required = ["current_step_index", "execution_results"]
    for field in required:
        if field not in output:
            raise ValueError(f"Executor output missing required field: {field}")
    
    # Check that step_index incremented by exactly 1
    old_index = input_state.get("current_step_index", 0)
    new_index = output["current_step_index"]
    if new_index != old_index + 1:
        raise ValueError(
            f"Executor must increment step_index by 1 "
            f"(was {old_index}, got {new_index})"
        )
    
    # Check that results list grew by exactly 1
    old_results = input_state.get("execution_results", [])
    new_results = output["execution_results"]
    old_len = len(old_results) if old_results else 0
    new_len = len(new_results) if new_results else 0
    
    if new_len != old_len + 1:
        raise ValueError(
            f"Executor must append exactly one result "
            f"(was {old_len}, got {new_len})"
        )
    
    # Check that the new result has required fields
    new_result = new_results[-1]
    required_result_fields = ["step_id", "action", "success"]
    for field in required_result_fields:
        if field not in new_result:
            raise ValueError(f"Executor result missing required field: {field}")
    
    logger.debug("[VALIDATOR] ✅ Executor output contract validated")
    return True


def validate_responder_output(output: Dict[str, Any], input_state: Dict[str, Any] = None) -> bool:
    """
    Validate responder node output matches contract.
    
    Args:
        output: Responder node output
        input_state: Optional input state for additional validation
        
    Returns:
        True if valid
        
    Raises:
        ValueError if contract violated
    """
    if "final_summary" not in output:
        raise ValueError("Responder output missing required field: final_summary")
    
    if not isinstance(output["final_summary"], str):
        raise ValueError(
            f"Responder final_summary must be a string, got {type(output['final_summary'])}"
        )
    
    if len(output["final_summary"]) == 0:
        raise ValueError("Responder final_summary cannot be empty")
    
    logger.debug("[VALIDATOR] ✅ Responder output contract validated")
    return True


def validate_evaluator_input(state: Dict[str, Any]) -> bool:
    """
    Validate evaluator node input matches contract.
    
    Args:
        state: Input state for evaluator node
        
    Returns:
        True if valid
        
    Raises:
        ValueError if contract violated
    """
    required = ["execution_plan", "current_step_index", "execution_results"]
    for field in required:
        if field not in state:
            raise ValueError(f"Evaluator input missing required field: {field}")
    
    # Also validate state invariants
    validate_state_invariants(state)
    
    logger.debug("[VALIDATOR] ✅ Evaluator input contract validated")
    return True


def validate_node_output(node_name: str, output: Dict[str, Any], input_state: Dict[str, Any] = None) -> bool:
    """
    Validate node output based on node name.
    
    Convenience function to route to appropriate validator.
    
    Args:
        node_name: Name of the node ("planner", "executor", "responder", "evaluator")
        output: Node output
        input_state: Optional input state
        
    Returns:
        True if valid
        
    Raises:
        ValueError if contract violated
    """
    if node_name == "planner":
        return validate_planner_output(output, input_state)
    elif node_name == "executor":
        if not input_state:
            raise ValueError("validate_node_output requires input_state for executor")
        return validate_executor_output(output, input_state)
    elif node_name == "responder":
        return validate_responder_output(output, input_state)
    elif node_name == "evaluator":
        # Evaluator doesn't have output validation (returns empty dict)
        # But we can validate input if provided
        if input_state:
            return validate_evaluator_input(input_state)
        return True
    else:
        raise ValueError(f"Unknown node name: {node_name}")


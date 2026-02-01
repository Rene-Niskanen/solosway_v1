"""
Contracts module - Explicit contracts for Planner → Executor → Responder architecture.

This module enforces:
- Node input/output contracts
- State model contracts
- Event schema contracts
- Router contracts (single owner of flow control)
"""

from backend.llm.contracts.node_contracts import (
    PlannerInput,
    PlannerOutput,
    PlannerEventContract,
    ExecutorInput,
    ExecutorOutput,
    ExecutorEventContract,
    EvaluatorInput,
    EvaluatorOutput,
    EvaluatorEventContract,
    ResponderInput,
    ResponderOutput,
    ResponderEventContract,
    RouterDecision,
    RouterContract,
)

from backend.llm.contracts.state_contract import PlannerExecutorState

from backend.llm.contracts.validators import (
    validate_planner_output,
    validate_executor_output,
    validate_responder_output,
    validate_evaluator_input,
)

__all__ = [
    # Node contracts
    "PlannerInput",
    "PlannerOutput",
    "PlannerEventContract",
    "ExecutorInput",
    "ExecutorOutput",
    "ExecutorEventContract",
    "EvaluatorInput",
    "EvaluatorOutput",
    "EvaluatorEventContract",
    "ResponderInput",
    "ResponderOutput",
    "ResponderEventContract",
    # Router
    "RouterDecision",
    "RouterContract",
    # State
    "PlannerExecutorState",
    # Validators
    "validate_planner_output",
    "validate_executor_output",
    "validate_responder_output",
    "validate_evaluator_input",
]


"""
No Results Node: Shared failure handler for exhausted retries.

This node returns a canonical no-results message (template) and no_results flag
so the frontend can show "Files and sources" / "Choose project" actions.
"""

import logging

from backend.llm.types import MainWorkflowState
from backend.llm.prompts.no_results import get_no_results_template_message

logger = logging.getLogger(__name__)


async def no_results_node(state: MainWorkflowState) -> MainWorkflowState:
    """
    Return helpful no-results message when retrieval exhausts all retries.
    Uses canonical templates so the frontend can show action buttons.
    """
    retrieved_documents = state.get("retrieved_documents", [])
    has_documents = bool(retrieved_documents)
    plan_refinement_count = state.get("plan_refinement_count", 0)
    refinement_limit_reached = plan_refinement_count >= 3

    failure_message = get_no_results_template_message(has_documents, refinement_limit_reached)
    logger.info(
        f"[NO_RESULTS] Returning template message (has_documents={has_documents}, "
        f"refinement_limit_reached={refinement_limit_reached})"
    )

    return {
        "final_summary": failure_message,
        "no_results": True,
        "agent_actions": [],
    }


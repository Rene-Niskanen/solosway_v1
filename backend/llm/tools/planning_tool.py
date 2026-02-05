"""
Planning Tool - Share high-level intent and next action with user.

This tool allows the agent to communicate WHAT it's about to do and WHY,
without exposing internal reasoning or step-by-step deliberation.

Key Principle: "What the agent is doing and why it matters, not how it thinks."
"""

from langchain_core.tools import tool
from typing import Optional
from backend.llm.utils.execution_events import ExecutionEvent, ExecutionEventEmitter

def _plan_step_impl(
    intent: str,
    next_action: str,
    emitter: Optional[ExecutionEventEmitter] = None
) -> str:
    """
    Internal implementation of plan_step that accepts emitter.
    
    This is wrapped by plan_step() which doesn't expose emitter to Pydantic.
    """
    # Emit execution event for visible planning
    if emitter:
        event = ExecutionEvent(
            type="phase",  # High-level marker (not "decision" or "reasoning")
            description=intent,
            metadata={
                "next_action": next_action,
                "visibility": "user"
            }
        )
        emitter.emit(event)
    
    return intent

@tool
def plan_step(
    intent: str,
    next_action: str
) -> str:
    """
    Share a high-level plan or intent with the user.
    
    Use this to explain WHAT you're about to do and WHY, without exposing
    internal reasoning or step-by-step deliberation.
    
    This builds trust and transparency by showing your intent and next action,
    not your internal thought process.
    
    Args:
        intent: What you're going to do and why it matters (e.g., 
                "I'm going to look for documents related to the property valuation 
                to find the specific valuation figures you requested.")
        next_action: The specific action you're about to take (e.g., 
                     "Search valuation-related documents")
    
    Returns:
        The intent message (for LLM context)
    
    Example:
        plan_step(
            intent="I'm going to search for documents related to the property valuation.",
            next_action="Search valuation-related documents"
        )
    """
    # Emitter is injected at runtime by tool_execution_node
    # For now, just return intent (emitter will be injected by wrapper)
    return intent


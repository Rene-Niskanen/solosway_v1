"""
System-level prompts for LangGraph architecture.

Re-exports from backend.llm.prompts.base_system for backward compatibility.
Prefer: from backend.llm.prompts import get_system_prompt, BASE_ROLE, TASK_GUIDANCE
"""

from backend.llm.prompts.base_system import (
    BASE_ROLE,
    TASK_GUIDANCE,
    get_base_role,
    get_system_prompt,
    get_task_guidance,
)

__all__ = [
    "BASE_ROLE",
    "TASK_GUIDANCE",
    "get_base_role",
    "get_system_prompt",
    "get_task_guidance",
]

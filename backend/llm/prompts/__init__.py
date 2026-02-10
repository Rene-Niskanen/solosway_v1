"""
Central prompts package: base system, personality, and human message templates.

Import from this package for backward compatibility:
  from backend.llm.prompts import get_system_prompt, get_final_answer_prompt, ...
"""

from backend.llm.prompts.human_templates import *  # noqa: F401, F403
from backend.llm.prompts.human_templates import _get_main_answer_tagging_rule  # used by nodes
from backend.llm.prompts.base_system import (
    BASE_ROLE,
    TASK_GUIDANCE,
    get_base_role,
    get_system_prompt,
    get_task_guidance,
)
from backend.llm.prompts.personality import (
    DEFAULT_PERSONALITY_ID,
    PERSONALITY_CHOICE_INSTRUCTION,
    PERSONALITY_OVERLAYS,
    VALID_PERSONALITY_IDS,
    get_personality_choice_instruction,
    get_personality_overlay,
)

__all__ = [
    # human_templates (explicit for private name used by nodes)
    "_get_main_answer_tagging_rule",
    # base_system
    "BASE_ROLE",
    "TASK_GUIDANCE",
    "get_base_role",
    "get_system_prompt",
    "get_task_guidance",
    # personality
    "DEFAULT_PERSONALITY_ID",
    "PERSONALITY_CHOICE_INSTRUCTION",
    "PERSONALITY_OVERLAYS",
    "VALID_PERSONALITY_IDS",
    "get_personality_choice_instruction",
    "get_personality_overlay",
]

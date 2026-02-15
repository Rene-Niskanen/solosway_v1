"""
Personality (tone) overlays for Velora responses.

Re-exports from backend.llm.prompts.personality for backward compatibility.
Prefer: from backend.llm.prompts import get_personality_overlay, PERSONALITY_OVERLAYS, ...
"""

from backend.llm.prompts.personality import (
    DEFAULT_PERSONALITY_ID,
    PERSONALITY_CHOICE_INSTRUCTION,
    PERSONALITY_OVERLAYS,
    VALID_PERSONALITY_IDS,
    get_personality_choice_instruction,
    get_personality_overlay,
)

__all__ = [
    "DEFAULT_PERSONALITY_ID",
    "PERSONALITY_CHOICE_INSTRUCTION",
    "PERSONALITY_OVERLAYS",
    "VALID_PERSONALITY_IDS",
    "get_personality_choice_instruction",
    "get_personality_overlay",
]

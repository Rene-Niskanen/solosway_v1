"""
Personality overlay content for Velora.

Each module (e.g. candid.py) defines an OVERLAY_<ID> constant used by
backend.llm.prompts.personality to build PERSONALITY_OVERLAYS.
"""

from backend.llm.prompts.personalities.candid import OVERLAY_CANDID
from backend.llm.prompts.personalities.cynical import OVERLAY_CYNICAL
from backend.llm.prompts.personalities.default import OVERLAY_DEFAULT
from backend.llm.prompts.personalities.efficient import OVERLAY_EFFICIENT
from backend.llm.prompts.personalities.friendly import OVERLAY_FRIENDLY
from backend.llm.prompts.personalities.listener import OVERLAY_LISTENER
from backend.llm.prompts.personalities.nerdy import OVERLAY_NERDY
from backend.llm.prompts.personalities.professional import OVERLAY_PROFESSIONAL
from backend.llm.prompts.personalities.quirky import OVERLAY_QUIRKY
from backend.llm.prompts.personalities.robot import OVERLAY_ROBOT

__all__ = [
    "OVERLAY_CANDID",
    "OVERLAY_CYNICAL",
    "OVERLAY_DEFAULT",
    "OVERLAY_EFFICIENT",
    "OVERLAY_FRIENDLY",
    "OVERLAY_LISTENER",
    "OVERLAY_NERDY",
    "OVERLAY_PROFESSIONAL",
    "OVERLAY_QUIRKY",
    "OVERLAY_ROBOT",
]

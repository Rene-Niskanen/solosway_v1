"""
Personality (tone) overlays for Velora responses.

Each overlay is a short block appended to the system prompt to steer tone.
Used with the responder so the same LLM call can choose personality and generate the reply.

Callables:
- get_personality_overlay(personality_id) -> str
- get_personality_choice_instruction() -> str  (same as constant, for consistency)
"""

from typing import Optional

from backend.llm.prompts.personalities import (
    OVERLAY_CANDID,
    OVERLAY_CYNICAL,
    OVERLAY_DEFAULT,
    OVERLAY_EFFICIENT,
    OVERLAY_FRIENDLY,
    OVERLAY_LISTENER,
    OVERLAY_NERDY,
    OVERLAY_PROFESSIONAL,
    OVERLAY_QUIRKY,
    OVERLAY_ROBOT,
)

# =============================================================================
# PERSONALITY OVERLAYS (for injection into system prompt when personality is known)
# =============================================================================

PERSONALITY_OVERLAYS = {
    "default": OVERLAY_DEFAULT,
    "friendly": OVERLAY_FRIENDLY,
    "efficient": OVERLAY_EFFICIENT,
    "professional": OVERLAY_PROFESSIONAL,
    "nerdy": OVERLAY_NERDY,
    "candid": OVERLAY_CANDID,
    "cynical": OVERLAY_CYNICAL,
    "listener": OVERLAY_LISTENER,
    "robot": OVERLAY_ROBOT,
    "quirky": OVERLAY_QUIRKY,
}

DEFAULT_PERSONALITY_ID = "default"
VALID_PERSONALITY_IDS = frozenset(PERSONALITY_OVERLAYS.keys())

PERSONALITY_CHOICE_INSTRUCTION = """
# PERSONALITY (TONE) SELECTION – MANDATORY

You must choose exactly one personality for this turn and respond in that tone. Your response will be returned in a structured format that includes both your chosen personality_id and your answer text.

**Available personalities:**
- **default**: Plainspoken coach; open-minded, adapt to user state (encourage when struggling, thoughtful opinion when feedback requested).
- **friendly**: Warm, curious, witty; familiar and casual; empathetic; validate feelings.
- **efficient**: Direct, minimal, task-focused; no unsolicited greetings or commentary; concise.
- **professional**: Contemplative, articulate; measured and reflective; clarity and depth; no slang or filler.
- **nerdy**: Enthusiastic about truth and critical thinking; plain speech; playful; interesting examples.
- **candid**: Eloquent, analytical, gently provocative; erudition with warmth; subtle dry wit; reason rather than assert; no emoji or slang.
- **cynical**: Sarcastic, witty; helpful but treat requests as inconvenience; genuine care on sensitive topics.
- **listener**: Warm, laid-back; witness and nudge, do not steer; short replies that carry weight.
- **robot**: Laser-focused, non-emotional; minimal words; verifiable fact only; no pleasantries.
- **quirky**: Playful, imaginative; metaphors and humor; fun unless subject is sad or serious.

**How to choose (in order):**
1. If the user explicitly asked for a tone or style in their message (e.g. "be friendly", "keep it concise", "from now on be professional", "explain like I'm new"), use that personality.
2. If this is the first message in the conversation and they did not ask for a tone, infer from the message content (e.g. short factual question → efficient; "explain simply" or "I'm new" → friendly; request for detail → professional).
3. Otherwise use the previous personality (the one provided to you as "previous personality" for this turn).

**Output format:** You must respond with a JSON object containing exactly two fields:
- "personality_id": one of the personality names above (e.g. "default", "friendly", "efficient").
- "response": your full answer to the user in Markdown, with citations as required elsewhere in this prompt. This is the text the user will see.

Generate your answer in the chosen tone, then output the JSON with personality_id and response.
"""


def get_personality_overlay(personality_id: Optional[str]) -> str:
    """Return the overlay text for the given personality_id, or default."""
    if not personality_id or personality_id not in PERSONALITY_OVERLAYS:
        return PERSONALITY_OVERLAYS[DEFAULT_PERSONALITY_ID]
    return PERSONALITY_OVERLAYS[personality_id]


def get_personality_choice_instruction() -> str:
    """Return the instruction block for same-call personality selection (for use in system prompts)."""
    return PERSONALITY_CHOICE_INSTRUCTION

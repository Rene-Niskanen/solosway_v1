"""
Format instruction extraction for refine/format queries.

Used when agent_loop path doesn't have a planner to set format_instruction.
Responder uses this to enable the format branch for queries like "format that as bullet points".
"""

import re
from typing import Optional

# Match planner_node REFINE_PATTERNS
REFINE_PATTERNS = (
    "make that into",
    "turn that into",
    "format that as",
    "can you put that in",
    "rewrite that as",
    "put that in a",
)


def _matches_any(text: str, patterns: tuple) -> bool:
    """True if text (lowercased) contains any of the given patterns."""
    return any(p in (text or "").lower() for p in patterns)


def _extract_format_instruction_from_query(user_query: str) -> Optional[str]:
    """
    Extract format instruction from refine-style user query.
    E.g. "format that as bullet points" -> "bullet points"
    "make that into a table" -> "a table"
    """
    q = (user_query or "").strip()
    if not q:
        return None
    q_lower = q.lower()
    # Try pattern: "format that as X" -> X
    for pattern in REFINE_PATTERNS:
        if pattern in q_lower:
            idx = q_lower.find(pattern)
            rest = q[idx + len(pattern) :].strip()
            # Strip leading "a " or "an " if present
            rest = re.sub(r"^\s*(?:a|an)\s+", "", rest, flags=re.I).strip()
            if rest:
                return rest[:500]  # Cap length
    return None


def extract_format_instruction_if_refine(
    user_query: str, has_context: bool
) -> Optional[str]:
    """
    If user query matches REFINE_PATTERNS and we have context (chunks or prior),
    extract format_instruction. Otherwise return None.
    """
    if not has_context:
        return None
    if not _matches_any(user_query, REFINE_PATTERNS):
        return None
    return _extract_format_instruction_from_query(user_query)

"""
Constants and types for bootstrap / USER.md context injection.
"""

from typing import Optional, TypedDict

# Limits (chars)
DEFAULT_BOOTSTRAP_MAX_CHARS = 20_000
DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS = 150_000
MIN_BOOTSTRAP_FILE_BUDGET_CHARS = 64
BOOTSTRAP_HEAD_RATIO = 0.7
BOOTSTRAP_TAIL_RATIO = 0.2

# Filenames and order (Phase 1: USER.md only)
USER_MD_FILENAME = "USER.md"
BOOTSTRAP_FILE_ORDER_PHASE1 = ("USER.md",)


class BootstrapFileEntry(TypedDict):
    """Single bootstrap file: name, display path, optional content, missing flag."""
    name: str
    path_or_id: str
    content: Optional[str]
    missing: bool

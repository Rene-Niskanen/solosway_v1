"""
Bootstrap / USER.md: project context loaded from DB and injected into system prompts.
"""

from backend.llm.bootstrap.constants import (
    BootstrapFileEntry,
    BOOTSTRAP_FILE_ORDER_PHASE1,
    USER_MD_FILENAME,
    DEFAULT_BOOTSTRAP_MAX_CHARS,
    DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS,
    MIN_BOOTSTRAP_FILE_BUDGET_CHARS,
    BOOTSTRAP_HEAD_RATIO,
    BOOTSTRAP_TAIL_RATIO,
)
from backend.llm.bootstrap.build import (
    resolve_bootstrap_max_chars,
    resolve_bootstrap_total_max_chars,
    trim_bootstrap_content,
    clamp_to_budget,
    build_bootstrap_context_files,
    format_project_context_section,
)
from backend.llm.bootstrap.loaders import (
    BootstrapScope,
    get_bootstrap_context,
    load_user_md_from_db,
)

__all__ = [
    "BootstrapFileEntry",
    "BootstrapScope",
    "BOOTSTRAP_FILE_ORDER_PHASE1",
    "USER_MD_FILENAME",
    "DEFAULT_BOOTSTRAP_MAX_CHARS",
    "DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS",
    "MIN_BOOTSTRAP_FILE_BUDGET_CHARS",
    "BOOTSTRAP_HEAD_RATIO",
    "BOOTSTRAP_TAIL_RATIO",
    "resolve_bootstrap_max_chars",
    "resolve_bootstrap_total_max_chars",
    "trim_bootstrap_content",
    "clamp_to_budget",
    "build_bootstrap_context_files",
    "format_project_context_section",
    "get_bootstrap_context",
    "load_user_md_from_db",
]

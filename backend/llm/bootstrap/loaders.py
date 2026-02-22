"""
Load bootstrap files (USER.md) from DB and build section string for system prompt.
"""

import logging
from dataclasses import dataclass

from backend.llm.bootstrap.constants import BootstrapFileEntry, USER_MD_FILENAME
from backend.llm.bootstrap.build import (
    build_bootstrap_context_files,
    format_project_context_section,
    resolve_bootstrap_max_chars,
    resolve_bootstrap_total_max_chars,
)

logger = logging.getLogger(__name__)


@dataclass
class BootstrapScope:
    """Scope for loading bootstrap files: user and business."""
    user_id: str
    business_id: str


def load_user_md_from_db(scope: BootstrapScope) -> BootstrapFileEntry:
    """
    Load USER.md row from velora_bootstrap_files. On missing or error, return missing entry.
    """
    try:
        from backend.services.supabase_client_factory import get_supabase_client
        supabase = get_supabase_client()
        result = (
            supabase.table("velora_bootstrap_files")
            .select("content")
            .eq("business_id", str(scope.business_id))
            .eq("user_id", scope.user_id)
            .eq("name", USER_MD_FILENAME)
            .limit(1)
            .execute()
        )
        if not result.data or len(result.data) == 0:
            return BootstrapFileEntry(
                name=USER_MD_FILENAME,
                path_or_id=USER_MD_FILENAME,
                content=None,
                missing=True,
            )
        row = result.data[0]
        content = row.get("content")
        if content is None or (isinstance(content, str) and not content.strip()):
            return BootstrapFileEntry(
                name=USER_MD_FILENAME,
                path_or_id=USER_MD_FILENAME,
                content=None,
                missing=True,
            )
        return BootstrapFileEntry(
            name=USER_MD_FILENAME,
            path_or_id=USER_MD_FILENAME,
            content=content if isinstance(content, str) else str(content),
            missing=False,
        )
    except Exception as e:
        logger.warning("[BOOTSTRAP] load_user_md_from_db failed: %s", e)
        return BootstrapFileEntry(
            name=USER_MD_FILENAME,
            path_or_id=USER_MD_FILENAME,
            content=None,
            missing=True,
        )


def get_bootstrap_context(scope: BootstrapScope, config) -> str:
    """
    Load USER.md for scope, build and return '# Project Context' section string (or "").
    When USER.md is missing or empty, return "" so no section is injected.
    """
    entry = load_user_md_from_db(scope)
    if entry.get("missing") or not (entry.get("content") or "").strip():
        return ""
    files = [entry]
    max_c = resolve_bootstrap_max_chars(config)
    total_c = resolve_bootstrap_total_max_chars(config)
    blocks = build_bootstrap_context_files(
        files, max_c, total_c, warn=logger.warning
    )
    return format_project_context_section(blocks)

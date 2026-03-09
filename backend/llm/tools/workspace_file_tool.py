"""
Workspace file tools - read/write USER.md (and future project files) from velora_bootstrap_files (legacy table name).

The agent can read or update USER.md when the user asks. user_id and business_id are
injected by ExecutionAwareToolNode from state; the LLM only passes file_name (and content for write).
"""

import logging
from typing import Optional

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.llm.bootstrap.constants import (
    USER_MD_FILENAME,
    DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS,
)

logger = logging.getLogger(__name__)

WORKSPACE_FILE_ALLOWLIST = ("USER.md",)


class ReadWorkspaceFileInput(BaseModel):
    """Input for read_workspace_file. user_id and business_id are injected by the graph."""
    file_name: str = Field(description="Name of the file to read, e.g. USER.md")
    user_id: Optional[str] = Field(default=None, description="Injected by system")
    business_id: Optional[str] = Field(default=None, description="Injected by system")


class WriteWorkspaceFileInput(BaseModel):
    """Input for write_workspace_file. user_id and business_id are injected by the graph."""
    file_name: str = Field(description="Name of the file to write, e.g. USER.md")
    content: str = Field(description="Full content to save")
    user_id: Optional[str] = Field(default=None, description="Injected by system")
    business_id: Optional[str] = Field(default=None, description="Injected by system")


def _normalize_business_id(business_id: Optional[str]) -> str:
    """Return a string UUID for DB use, or empty string. Caller must check before using."""
    if business_id is None:
        return ""
    s = str(business_id).strip()
    return s if s else ""


def read_workspace_file_impl(
    file_name: str,
    user_id: Optional[str] = None,
    business_id: Optional[str] = None,
) -> str:
    """Read workspace file (e.g. USER.md) from velora_bootstrap_files."""
    if file_name not in WORKSPACE_FILE_ALLOWLIST:
        return f"[error] Only USER.md is supported. Requested: {file_name}."
    user_id = user_id or "anonymous"
    business_id = _normalize_business_id(business_id)
    if not business_id:
        return "[error] Session missing business context. Please refresh the page and try again."
    try:
        from backend.services.supabase_client_factory import get_supabase_client
        supabase = get_supabase_client()
        result = (
            supabase.table("velora_bootstrap_files")
            .select("content")
            .eq("business_id", business_id)
            .eq("user_id", user_id)
            .eq("name", file_name)
            .limit(1)
            .execute()
        )
        if not result.data or len(result.data) == 0:
            return "[empty]"
        content = result.data[0].get("content")
        if content is None or (isinstance(content, str) and not content.strip()):
            return "[empty]"
        return content if isinstance(content, str) else str(content)
    except Exception as e:
        logger.warning("[WORKSPACE_FILE] read failed: %s", e)
        return "[error] Failed to read file."


def write_workspace_file_impl(
    file_name: str,
    content: str,
    user_id: Optional[str] = None,
    business_id: Optional[str] = None,
) -> str:
    """Write workspace file (e.g. USER.md) to velora_bootstrap_files."""
    if file_name not in WORKSPACE_FILE_ALLOWLIST:
        return "[error] Only USER.md is supported."
    user_id = user_id or "anonymous"
    business_id = _normalize_business_id(business_id)
    if not business_id:
        return "[error] Session missing business context. Please refresh the page and try again."
    truncated = content
    if len(truncated) > DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS:
        truncated = truncated[:DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS]
    truncation_note = ""
    if len(content) > DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS:
        truncation_note = " Content was truncated to 150000 characters."
    try:
        from backend.services.supabase_client_factory import get_supabase_client
        from datetime import datetime, timezone
        supabase = get_supabase_client()
        supabase.table("velora_bootstrap_files").upsert(
            {
                "business_id": business_id,
                "user_id": user_id,
                "name": file_name,
                "content": truncated,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="business_id,user_id,name",
        ).execute()
        return f"Saved {file_name} successfully." + truncation_note
    except Exception as e:
        logger.warning("[WORKSPACE_FILE] write failed: %s", e)
        return "[error] Failed to write file."


def create_read_workspace_file_tool() -> StructuredTool:
    """Create the read_workspace_file tool for the agent."""
    return StructuredTool.from_function(
        func=read_workspace_file_impl,
        name="read_workspace_file",
        description=(
            "Read the content of a workspace file. Currently only USER.md is supported. "
            "USER.md is the user's profile/context that OpenFind uses to personalize responses. "
            "Use when the user asks what's in their USER.md, profile, or user context."
        ),
        args_schema=ReadWorkspaceFileInput,
    )


def create_write_workspace_file_tool() -> StructuredTool:
    """Create the write_workspace_file tool for the agent."""
    return StructuredTool.from_function(
        func=write_workspace_file_impl,
        name="write_workspace_file",
        description=(
            "Write or update a workspace file. Currently only USER.md is supported. "
            "Use when the user asks to update, set, or change their USER.md or user context. "
            "Provide the full new content for the file."
        ),
        args_schema=WriteWorkspaceFileInput,
    )

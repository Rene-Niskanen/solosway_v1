"""
Pure helpers: resolve config limits, trim/clamp content, build and format bootstrap section.
"""

import math
from typing import Callable, List, Optional, Tuple

from backend.llm.bootstrap.constants import (
    BootstrapFileEntry,
    DEFAULT_BOOTSTRAP_MAX_CHARS,
    DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS,
    MIN_BOOTSTRAP_FILE_BUDGET_CHARS,
    BOOTSTRAP_HEAD_RATIO,
    BOOTSTRAP_TAIL_RATIO,
)


def resolve_bootstrap_max_chars(config) -> int:
    """Return config.bootstrap_max_chars if positive int, else default."""
    v = getattr(config, "bootstrap_max_chars", None)
    if isinstance(v, int) and v > 0:
        return v
    return DEFAULT_BOOTSTRAP_MAX_CHARS


def resolve_bootstrap_total_max_chars(config) -> int:
    """Return config.bootstrap_total_max_chars if positive int, else default."""
    v = getattr(config, "bootstrap_total_max_chars", None)
    if isinstance(v, int) and v > 0:
        return v
    return DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS


def trim_bootstrap_content(
    content: str, file_name: str, max_chars: int
) -> Tuple[str, bool, int]:
    """
    Trim end only (rstrip). If over max_chars, keep head (70%) + marker + tail (20%).
    Returns (trimmed_content, was_truncated, original_length).
    """
    trimmed = content.rstrip()
    orig_len = len(trimmed)
    if orig_len <= max_chars:
        return (trimmed, False, orig_len)
    head_chars = max(0, int(math.floor(max_chars * BOOTSTRAP_HEAD_RATIO)))
    tail_chars = max(0, int(math.floor(max_chars * BOOTSTRAP_TAIL_RATIO)))
    head = trimmed[:head_chars]
    tail = trimmed[-tail_chars:] if tail_chars else ""
    line1 = "[...truncated, read " + file_name + " for full content...]"
    line2 = (
        "\u2026(truncated "
        + file_name
        + ": kept "
        + str(head_chars)
        + "+"
        + str(tail_chars)
        + " chars of "
        + str(orig_len)
        + ")\u2026"
    )
    marker = "\n" + line1 + "\n" + line2 + "\n"
    return (head + marker + tail, True, orig_len)


def clamp_to_budget(content: str, budget: int) -> str:
    """If content exceeds budget chars, return prefix + ellipsis; else return content."""
    if budget <= 0:
        return ""
    if len(content) <= budget:
        return content
    return content[: budget - 1] + "\u2026"


def build_bootstrap_context_files(
    files: List[BootstrapFileEntry],
    max_chars: int,
    total_max_chars: int,
    warn: Optional[Callable[[str], None]] = None,
) -> List[Tuple[str, str]]:
    """
    Build list of (path_for_display, content) respecting per-file and total budgets.
    Empty content is skipped (no block, no budget used).
    """
    result: List[Tuple[str, str]] = []
    remaining = max(1, total_max_chars)
    for file in files:
        if remaining <= 0:
            break
        if file.get("missing"):
            text = "[MISSING] Expected at: " + file["path_or_id"]
            capped = clamp_to_budget(text, remaining)
            if not capped:
                break
            result.append((file["path_or_id"], capped))
            remaining -= len(capped)
            continue
        if remaining < MIN_BOOTSTRAP_FILE_BUDGET_CHARS:
            if warn:
                warn("Bootstrap: remaining budget below minimum, skipping further files")
            break
        file_max = max(1, min(max_chars, remaining))
        raw = (file.get("content") or "").rstrip()
        if not raw:
            continue
        trimmed, truncated, orig_len = trim_bootstrap_content(
            raw, file["name"], file_max
        )
        within = clamp_to_budget(trimmed, remaining)
        if not within:
            continue
        if truncated or len(within) < len(trimmed):
            if warn:
                warn(
                    f"Bootstrap: truncated {file['name']} (orig={orig_len}, kept={len(within)})"
                )
        result.append((file["path_or_id"], within))
        remaining -= len(within)
    return result


def format_project_context_section(blocks: List[Tuple[str, str]]) -> str:
    """Format list of (path, content) as '# Project Context' markdown section."""
    if not blocks:
        return ""
    header = "# Project Context\n\nThe following project context files have been loaded:\n\n"
    parts = [header]
    for path, content in blocks:
        parts.append("## " + path + "\n\n" + content + "\n\n")
    return "".join(parts)

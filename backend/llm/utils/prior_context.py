"""
Prior retrieval context for follow-up queries.

Extracts compact chunk metadata (chunk_id, filename, page) from execution_results
so the agent knows which chunks were used and can fetch them by ID when needed.
"""

import logging
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

MAX_CHUNKS_IN_CONTEXT = 10
MAX_TOTAL_CHARS = 500


def extract_prior_chunk_context(execution_results: List[Dict[str, Any]]) -> str:
    """
    Build a compact context string from prior retrieve_chunks results.
    Returns chunk IDs, filenames, pages - no chunk text.

    Args:
        execution_results: List of {action, success, result} from checkpoint

    Returns:
        Formatted string for prior_chunk_context, or "" if no valid data
    """
    if not execution_results or not isinstance(execution_results, list):
        return ""
    seen: set = set()
    lines = []
    for item in execution_results:
        if item.get("action") != "retrieve_chunks" or not item.get("success"):
            continue
        result = item.get("result")
        if not isinstance(result, list):
            continue
        for chunk in result:
            if not isinstance(chunk, dict):
                continue
            chunk_id = str(chunk.get("chunk_id") or chunk.get("id") or "").strip()
            if not chunk_id or chunk_id in seen:
                continue
            seen.add(chunk_id)
            filename = chunk.get("document_filename") or chunk.get("original_filename") or "document"
            page = chunk.get("page_number")
            if page is not None:
                try:
                    page_str = str(int(page))
                except (TypeError, ValueError):
                    page_str = "?"
            else:
                page_str = "?"
            lines.append(f"- chunk_id: {chunk_id} | doc: {filename} | page {page_str}")
            if len(lines) >= MAX_CHUNKS_IN_CONTEXT:
                break
        if len(lines) >= MAX_CHUNKS_IN_CONTEXT:
            break
    if not lines:
        return ""
    header = "Prior answer used these chunks:\n"
    body = "\n".join(lines)
    combined = header + body
    if len(combined) > MAX_TOTAL_CHARS:
        combined = combined[:MAX_TOTAL_CHARS].rsplit("\n", 1)[0] + "\n..."
    return combined

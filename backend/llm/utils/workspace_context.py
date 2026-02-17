"""
Workspace context builder for the LLM.

Builds a short "Documents in scope" block listing relevant documents with each
labeled by its property/workspace (where it came from). Used when the user has
scope (property or documents) or when retrieval returned documents (no attachment).
Multi-doc and multi-property are supported.
"""

import logging
from typing import List, Optional

from backend.services.supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)

WORKSPACE_MAX_PER_DOC_CHARS = 200
WORKSPACE_MAX_TOTAL_CHARS = 2000
WORKSPACE_MAX_DOCS_LISTED = 20
WORKSPACE_HEADING = "## Current workspace"


def get_document_ids_for_property(property_id: Optional[str], business_id: str) -> List[str]:
    """
    Resolve property_id to a list of document IDs (same source as build_workspace_context).
    Used by planner normalizer when we have property scope but invalid/placeholder document_ids.
    """
    if not property_id or not business_id:
        return []
    try:
        supabase = get_supabase_client()
        rel_result = (
            supabase.table("document_relationships")
            .select("document_id")
            .eq("property_id", property_id)
            .execute()
        )
        return [str(r["document_id"]) for r in (rel_result.data or []) if r.get("document_id")]
    except Exception as e:
        logger.warning("get_document_ids_for_property failed: %s", e)
        return []


def get_documents_with_property_context(
    document_ids: List[str],
    business_id: str,
) -> List[dict]:
    """
    For each document_id, fetch document metadata and resolve property_id + human-readable label.

    Returns list of:
        {document_id, original_filename, classification_type, property_id, property_label}
    """
    if not document_ids or not business_id:
        return []
    try:
        supabase = get_supabase_client()
        # 1. Fetch document metadata (id, original_filename, classification_type)
        doc_ids = list(dict.fromkeys([str(d) for d in document_ids if d]))[:WORKSPACE_MAX_DOCS_LISTED * 2]
        if not doc_ids:
            return []
        docs_result = (
            supabase.table("documents")
            .select("id, original_filename, classification_type")
            .in_("id", doc_ids)
            .eq("business_uuid", str(business_id))
            .execute()
        )
        docs_map = {}
        for row in docs_result.data or []:
            doc_id = str(row.get("id", ""))
            if doc_id:
                docs_map[doc_id] = {
                    "document_id": doc_id,
                    "original_filename": row.get("original_filename") or "Unknown",
                    "classification_type": row.get("classification_type") or "document",
                    "property_id": None,
                    "property_label": None,
                }
        if not docs_map:
            return []
        # 2. Resolve property_id per document from document_relationships
        rel_result = (
            supabase.table("document_relationships")
            .select("document_id, property_id")
            .in_("document_id", list(docs_map.keys()))
            .execute()
        )
        for row in rel_result.data or []:
            doc_id = str(row.get("document_id", ""))
            prop_id = row.get("property_id")
            if doc_id in docs_map and prop_id:
                docs_map[doc_id]["property_id"] = str(prop_id)
        # 3. Fetch property labels (formatted_address) for all property_ids
        prop_ids = list({d["property_id"] for d in docs_map.values() if d["property_id"]})
        prop_label_map = {}
        if prop_ids:
            prop_result = (
                supabase.table("properties")
                .select("id, formatted_address")
                .in_("id", prop_ids)
                .execute()
            )
            for row in prop_result.data or []:
                prop_id = str(row.get("id", ""))
                if prop_id:
                    prop_label_map[prop_id] = (row.get("formatted_address") or "").strip() or f"Property {prop_id[:8]}"
        for doc_id, d in docs_map.items():
            pid = d.get("property_id")
            if pid and pid in prop_label_map:
                d["property_label"] = prop_label_map[pid]
            elif pid:
                d["property_label"] = f"Property {pid[:8]}"
            else:
                d["property_label"] = "(no property)"
        # Return in same order as document_ids (preserve retrieval order when applicable)
        out = []
        for doc_id in document_ids:
            doc_id = str(doc_id)
            if doc_id in docs_map:
                out.append(docs_map[doc_id])
        return out
    except Exception as e:
        logger.warning("get_documents_with_property_context failed: %s", e)
        return []


def build_workspace_context(
    property_id: Optional[str],
    document_ids: Optional[List[str]],
    business_id: str,
) -> str:
    """
    Build a capped string describing the current workspace (documents in scope with per-doc property labels).

    - When document_ids is non-empty: list each doc with its property label (multi-doc support).
    - When property_id is set and document_ids empty: list docs for that property.
    - When both set: prefer document_ids and label each by its property.
    Returns empty string if no scope or on error.
    """
    if not business_id:
        return ""
    doc_list: List[dict] = []
    single_property_label: Optional[str] = None

    if document_ids and len(document_ids) > 0:
        doc_list = get_documents_with_property_context(
            [str(d) for d in document_ids if d],
            business_id,
        )
    elif property_id:
        try:
            supabase = get_supabase_client()
            rel_result = (
                supabase.table("document_relationships")
                .select("document_id")
                .eq("property_id", property_id)
                .execute()
            )
            doc_ids_from_prop = [str(r["document_id"]) for r in (rel_result.data or []) if r.get("document_id")]
            if doc_ids_from_prop:
                doc_list = get_documents_with_property_context(doc_ids_from_prop, business_id)
                if doc_list and doc_list[0].get("property_label"):
                    single_property_label = doc_list[0]["property_label"]
        except Exception as e:
            logger.warning("build_workspace_context: resolve docs for property failed: %s", e)

    if not doc_list:
        return ""

    # Format lines: filename (type) — property_label [id: document_id] (so planner can output 1-step for follow-ups)
    lines: List[str] = []
    total_len = 0
    for i, d in enumerate(doc_list):
        if i >= WORKSPACE_MAX_DOCS_LISTED:
            lines.append(f"... and {len(doc_list) - WORKSPACE_MAX_DOCS_LISTED} more.")
            total_len += 30
            break
        filename = (d.get("original_filename") or "Unknown").strip()
        doc_type = (d.get("classification_type") or "document").replace("_", " ").title()
        label = d.get("property_label") or "(no property)"
        doc_id = d.get("document_id", "")
        line = f"{filename} ({doc_type}) — {label} [id: {doc_id}]" if doc_id else f"{filename} ({doc_type}) — {label}"
        if len(line) > WORKSPACE_MAX_PER_DOC_CHARS:
            line = line[: WORKSPACE_MAX_PER_DOC_CHARS - 3] + "..."
        lines.append(line)
        total_len += len(line) + 1
        if total_len >= WORKSPACE_MAX_TOTAL_CHARS - 100:
            break

    doc_block = "\n".join(lines)
    if total_len > WORKSPACE_MAX_TOTAL_CHARS:
        doc_block = doc_block[: WORKSPACE_MAX_TOTAL_CHARS - 20].rsplit("\n", 1)[0] + "\n..."

    parts = []
    if single_property_label and doc_list and all(
        d.get("property_label") == single_property_label for d in doc_list[:5]
    ):
        parts.append(f"{WORKSPACE_HEADING}\n{single_property_label}\n\nDocuments in scope:\n{doc_block}")
    else:
        parts.append(f"{WORKSPACE_HEADING}\n\nDocuments in scope:\n{doc_block}")

    return "\n".join(parts).strip()

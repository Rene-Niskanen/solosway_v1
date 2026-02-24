#!/usr/bin/env python3
"""
Analyse the latest document sent through processing.

Fetches the most recently created document from Supabase, then reports:
- Basic metadata (filename, status, created_at, classification)
- Document summary (if present)
- Chunk/embedding stats (document_vectors)
- Processing history timeline
- Any failure/error info

Usage (from project root):
  python scripts/analyze_latest_upload.py
  BUSINESS_UUID=<uuid> python scripts/analyze_latest_upload.py   # optional: limit to your business
"""
import sys
import json
from pathlib import Path
from datetime import datetime

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv
load_dotenv(project_root / ".env")

from backend.services.supabase_client_factory import get_supabase_client


def main():
    supabase = get_supabase_client()
    business_uuid = __import__("os").environ.get("BUSINESS_UUID")

    # Fetch latest document (optionally scoped to business)
    q = (
        supabase.table("documents")
        .select("*")
        .order("created_at", desc=True)
        .limit(1)
    )
    if business_uuid:
        # Prefer business_uuid; fallback to business_id if your schema uses it
        try:
            from uuid import UUID
            UUID(business_uuid)
            q = q.eq("business_uuid", business_uuid)
        except ValueError:
            q = q.eq("business_id", business_uuid)
    result = q.execute()

    if not result.data or len(result.data) == 0:
        print("No documents found in storage.")
        if business_uuid:
            print(f"(Filtered by BUSINESS_UUID={business_uuid})")
        return 1

    doc = result.data[0]
    doc_id = doc.get("id")
    filename = doc.get("original_filename", "—")
    status = doc.get("status", "—")
    created_at = doc.get("created_at", "—")
    classification_type = doc.get("classification_type")
    classification_confidence = doc.get("classification_confidence")
    document_summary_raw = doc.get("document_summary")
    metadata_json = doc.get("metadata_json") or {}
    page_count = doc.get("page_count")
    property_id = doc.get("property_id")

    # Document summary (often JSON string or dict)
    document_summary = None
    if document_summary_raw is not None:
        if isinstance(document_summary_raw, str):
            try:
                document_summary = json.loads(document_summary_raw)
            except Exception:
                document_summary = {"_raw_preview": document_summary_raw[:500]}
        else:
            document_summary = document_summary_raw

    # Chunks / vectors
    chunks_result = (
        supabase.table("document_vectors")
        .select("chunk_index, chunk_text, chunk_context, embedding_status, created_at")
        .eq("document_id", doc_id)
        .order("chunk_index")
        .execute()
    )
    chunks = chunks_result.data or []
    total_chunks = len(chunks)
    with_context = sum(1 for c in chunks if c.get("chunk_context"))
    embedded = sum(1 for c in chunks if c.get("embedding") is not None or c.get("embedding_status") == "embedded")
    pending = sum(1 for c in chunks if c.get("embedding_status") == "pending")
    queued = sum(1 for c in chunks if c.get("embedding_status") == "queued")

    # Processing history
    history_result = (
        supabase.table("document_processing_history")
        .select("*")
        .eq("document_id", doc_id)
        .order("started_at")
        .execute()
    )
    history = history_result.data or []

    # ----- Print report -----
    print()
    print("=" * 72)
    print("  LATEST UPLOAD — ANALYSIS")
    print("=" * 72)
    print()
    print("  Document ID    ", doc_id)
    print("  Filename       ", filename)
    print("  Status         ", status)
    print("  Created        ", created_at)
    if classification_type is not None:
        print("  Classification ", classification_type, end="")
        if classification_confidence is not None:
            print(f"  (confidence: {classification_confidence})")
        else:
            print()
    else:
        print("  Classification (not set)")
    if page_count is not None:
        print("  Page count     ", page_count)
    if property_id:
        print("  Property ID    ", property_id)
    print()

    # Summary
    print("-" * 72)
    print("  DOCUMENT SUMMARY")
    print("-" * 72)
    if document_summary:
        summary_text = (
            document_summary.get("summary")
            or document_summary.get("summary_text")
            or document_summary.get("document_summary")
        )
        if summary_text:
            preview = (summary_text[:600] + "…") if len(str(summary_text)) > 600 else summary_text
            print(preview)
        else:
            print(json.dumps(document_summary, indent=2)[:1200])
        print()
    else:
        print("  (none yet)")
        print()

    # Chunks / embeddings
    print("-" * 72)
    print("  CHUNKS & EMBEDDINGS")
    print("-" * 72)
    print(f"  Total chunks: {total_chunks}")
    print(f"  With context: {with_context}")
    print(f"  Embedded:     {embedded}")
    if pending or queued:
        print(f"  Pending:      {pending}  Queued: {queued}")
    print()

    # Processing history
    print("-" * 72)
    print("  PROCESSING HISTORY")
    print("-" * 72)
    if history:
        for h in history:
            step = h.get("step_name", "—")
            step_status = h.get("step_status", "—")
            started = h.get("started_at", "—")
            completed = h.get("completed_at") or "—"
            err = h.get("error_message")
            print(f"  {step}: {step_status}  (started: {started})")
            if completed != "—":
                print(f"    completed: {completed}")
            if err:
                print(f"    error: {err}")
        print()
    else:
        print("  (no history rows)")
        print()

    # Errors in metadata
    if metadata_json and isinstance(metadata_json, dict):
        err_msg = metadata_json.get("error") or metadata_json.get("error_message") or metadata_json.get("failure_reason")
        if err_msg:
            print("-" * 72)
            print("  METADATA / ERROR")
            print("-" * 72)
            print(" ", err_msg)
            print()

    print("=" * 72)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())

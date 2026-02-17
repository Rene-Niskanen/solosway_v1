#!/usr/bin/env python3
"""
Backfill page_count for completed documents: prefer PDF page count from file, else from reducto_chunks.
Run from project root: python backend/scripts/backfill_document_page_counts.py

Loads .env first so DB is available.
"""

import json
import sys
from pathlib import Path

# Load env before any backend import
project_root = Path(__file__).resolve().parent.parent.parent
from dotenv import load_dotenv
load_dotenv(project_root / ".env")

sys.path.insert(0, str(project_root))

from backend.tasks import extract_page_number_from_chunk, get_pdf_page_count_from_bytes, _download_document_bytes_from_s3
from backend.services.document_storage_service import DocumentStorageService


def main():
    import logging
    logging.basicConfig(level=logging.INFO)
    log = logging.getLogger(__name__)

    storage = DocumentStorageService()
    result = (
        storage.supabase.table("documents")
        .select("id, business_uuid, business_id, document_summary, page_count")
        .eq("status", "completed")
        .execute()
    )
    rows = result.data or []
    updated = 0
    skipped = 0
    errors = 0
    used_pdf = 0
    used_chunks = 0
    download_failures = 0
    by_business: dict = {}  # business_id -> { "docs": N, "total_pages": N }

    for row in rows:
        doc_id = row.get("id")
        business_uuid = row.get("business_uuid")
        business_id = business_uuid or row.get("business_id")
        if not business_id:
            business_id = str(business_uuid) if business_uuid else None
        if not business_id:
            errors += 1
            continue

        bid = str(business_id)
        if bid not in by_business:
            by_business[bid] = {"docs": 0, "total_pages": 0}

        # Prefer actual PDF page count from file
        page_count = None
        try:
            file_content, _ = _download_document_bytes_from_s3(str(doc_id), str(business_id))
            page_count = get_pdf_page_count_from_bytes(file_content)
            if page_count is not None:
                used_pdf += 1
        except Exception as e:
            download_failures += 1
            log.warning("Download failed for doc %s: %s", doc_id, e)

        # Fallback: derive from stored reducto_chunks
        if page_count is None:
            summary = row.get("document_summary")
            if isinstance(summary, str):
                try:
                    summary = json.loads(summary)
                except Exception:
                    summary = {}
            if not isinstance(summary, dict):
                summary = {}
            chunks = summary.get("reducto_chunks") or []
            if not chunks:
                skipped += 1
                continue
            page_numbers = []
            for ch in chunks:
                p = extract_page_number_from_chunk(ch)
                if p is not None:
                    page_numbers.append(p)
            page_count = max(page_numbers) if page_numbers else 0
            used_chunks += 1

        ok, err = storage.update_document_status(
            document_id=str(doc_id),
            status="completed",
            business_id=str(business_id),
            additional_data={"page_count": page_count},
        )
        if ok:
            updated += 1
            by_business[bid]["docs"] += 1
            by_business[bid]["total_pages"] += page_count
        else:
            errors += 1

    print(f"Backfill done: {updated} updated, {skipped} skipped (no chunks + no PDF), {errors} errors")
    print(f"  Source: PDF={used_pdf}, chunks={used_chunks}, download_failures={download_failures}")
    for bid, data in by_business.items():
        print(f"  Business {bid[:8]}...: {data['docs']} docs, {data['total_pages']} total pages")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

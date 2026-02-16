#!/usr/bin/env python3
"""
One-off script to find and remove documents stuck in 'processing' state
matching the given filenames (FTNEA2023001.pdf and Why_is_takes_so_long_for_banks_...).
Uses UnifiedDeletionService so S3, Supabase, and related records are all cleaned up.
"""

import os
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv
load_dotenv(project_root / ".env")


def main():
    from backend.services.supabase_client_factory import get_supabase_client
    from backend.services.unified_deletion_service import UnifiedDeletionService
    from backend.services.document_processing_tasks import get_and_clear_document_processing_task_id

    supabase = get_supabase_client()

    # Find documents in 'processing' with these filename patterns
    result = (
        supabase.table("documents")
        .select("id, original_filename, status, business_id, business_uuid, s3_path")
        .eq("status", "processing")
        .execute()
    )

    if not result.data:
        print("No documents with status 'processing' found.")
        return

    # Filter to the two specific files (match start of filename)
    targets = [
        "FTNEA2023001.pdf",
        "Why_is_takes_so_long_for_banks",
    ]
    to_delete = []
    for doc in result.data:
        name = (doc.get("original_filename") or "")
        for t in targets:
            if name == t or name.startswith(t):
                to_delete.append(doc)
                break

    if not to_delete:
        print("No processing documents matching FTNEA2023001.pdf or Why_is_takes_so_long_for_banks_... found.")
        print("Current processing documents:")
        for doc in result.data:
            print(f"  - {doc.get('original_filename')} (id={doc.get('id')})")
        return

    deletion_service = UnifiedDeletionService()
    for doc in to_delete:
        doc_id = str(doc["id"])
        filename = doc.get("original_filename", "")
        business_id = doc.get("business_uuid") or doc.get("business_id")
        if not business_id:
            business_id = str(doc.get("business_id", ""))
        else:
            business_id = str(business_id)
        s3_path = doc.get("s3_path")

        print(f"Deleting: {filename} (id={doc_id})")
        try:
            # Revoke any Celery task for this document so worker stops
            task_id = get_and_clear_document_processing_task_id(doc_id)
            if task_id:
                try:
                    from backend import create_app
                    app = create_app()
                    celery_app = app.extensions.get("celery")
                    if celery_app:
                        celery_app.control.revoke(task_id, terminate=True)
                        print(f"  Revoked processing task {task_id}")
                except Exception as e:
                    print(f"  (Could not revoke task: {e})")

            res = deletion_service.delete_document_complete(
                document_id=doc_id,
                business_id=business_id,
                s3_path=s3_path,
                delete_s3=bool(s3_path),
                recompute_properties=True,
                cleanup_orphans=True,
            )
            if res.success:
                print(f"  Deleted successfully.")
            else:
                print(f"  Deletion had issues: {res.errors}")
        except Exception as e:
            print(f"  Error: {e}")
            import traceback
            traceback.print_exc()

    print("Done.")


if __name__ == "__main__":
    main()

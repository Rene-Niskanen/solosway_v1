#!/usr/bin/env python3
"""
Remove document records whose S3 files no longer exist (orphaned records).

Checks each document's s3_path via S3 head_object. If the object is missing (NoSuchKey),
deletes the document record and all related data (document_vectors, processing_history, etc.)
using UnifiedDeletionService. Does NOT attempt to delete from S3 (file already gone).

Usage:
  python scripts/remove_orphaned_documents.py           # Dry run: report only
  python scripts/remove_orphaned_documents.py --delete  # Actually remove orphaned records
  python scripts/remove_orphaned_documents.py --limit 50  # Check at most 50 docs (for testing)
"""
import os
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv
load_dotenv(project_root / ".env")


def head_object_exists(bucket: str, key: str) -> bool:
    """Return True if the S3 object exists, False if NoSuchKey or error."""
    try:
        import boto3
        from botocore.exceptions import ClientError
        client = boto3.client(
            's3',
            aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID'),
            aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY'),
            region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
        )
        client.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as e:
        if e.response.get('Error', {}).get('Code') in ('404', 'NoSuchKey', 'NotFound'):
            return False
        raise
    except Exception:
        raise


def main():
    dry_run = '--delete' not in sys.argv
    limit = None
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a == '--limit' and i + 1 < len(args):
            try:
                limit = int(args[i + 1])
            except ValueError:
                pass
            break

    bucket = os.environ.get('S3_UPLOAD_BUCKET')
    if not bucket:
        print("❌ S3_UPLOAD_BUCKET not set in .env")
        return 1

    from backend.services.supabase_client_factory import get_supabase_client
    from backend.services.unified_deletion_service import UnifiedDeletionService

    supabase = get_supabase_client()
    deletion_service = UnifiedDeletionService()

    # Fetch all documents with s3_path
    result = supabase.table('documents').select('id, original_filename, s3_path, business_uuid').execute()
    docs = result.data or []
    if limit:
        docs = docs[:limit]

    if not docs:
        print("No documents found.")
        return 0

    orphans = []
    for d in docs:
        s3_path = d.get('s3_path')
        if not s3_path or not s3_path.strip():
            continue
        if not head_object_exists(bucket, s3_path):
            orphans.append(d)

    print(f"\n📄 Checked {len(docs)} documents. Found {len(orphans)} orphaned (S3 file missing).\n")
    if not orphans:
        print("No orphaned records to remove.")
        return 0

    print("Orphaned documents (S3 file missing):")
    print("-" * 80)
    for o in orphans:
        print(f"  {o.get('id', '')[:8]}... | {o.get('original_filename', '—')[:50]}")

    if dry_run:
        print("\n⚠️  DRY RUN. Run with --delete to remove these records.")
        return 0

    print("\n🗑️  Removing orphaned records...")
    ok = 0
    fail = 0
    for o in orphans:
        doc_id = o.get('id')
        biz = o.get('business_uuid') or ''
        s3_path = o.get('s3_path') or ''
        try:
            r = deletion_service.delete_document_complete(
                document_id=doc_id,
                business_id=biz,
                s3_path=s3_path,
                delete_s3=False,
                recompute_properties=True,
                cleanup_orphans=True,
            )
            if r.success:
                ok += 1
                print(f"  ✅ Removed {o.get('original_filename', '')[:40]}...")
            else:
                fail += 1
                print(f"  ❌ Failed {doc_id}: {r.errors}")
        except Exception as e:
            fail += 1
            print(f"  ❌ Error {doc_id}: {e}")

    print(f"\n✅ Removed {ok} orphaned record(s). Failed: {fail}.")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

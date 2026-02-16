#!/usr/bin/env python3
"""
Script to process unprocessed documents through the ingestion pipeline.

This script identifies documents with status "uploaded" (not yet processed)
and triggers the full ingestion pipeline to:
1. Parse documents with Reducto
2. Create chunks
3. Generate chunk embeddings
4. Generate document embeddings
5. Update document metadata

Usage:
    python scripts/process_unprocessed_documents.py --business-id <uuid>
    python scripts/process_unprocessed_documents.py --all-documents
    python scripts/process_unprocessed_documents.py --document-id <uuid> --dry-run
"""

import argparse
import logging
import sys
import os
from typing import List, Optional
from uuid import UUID

# CRITICAL: Load .env file BEFORE any backend imports
# This ensures SUPABASE_DB_URL and other env vars are available when backend.config is imported
from dotenv import load_dotenv

# Load environment variables from .env file
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(env_path)

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.services.supabase_client_factory import get_supabase_client

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def get_unprocessed_documents(business_id: Optional[str] = None) -> List[dict]:
    """
    Get documents that are unprocessed (status='uploaded' and no chunks).
    
    Args:
        business_id: Optional business UUID to filter documents
        
    Returns:
        List of document dictionaries with id, original_filename, status, etc.
    """
    supabase = get_supabase_client()
    
    # Query documents with status 'uploaded' or 'processing' that have no chunks
    query = supabase.table('documents').select(
        'id, original_filename, status, business_uuid, created_at, s3_path'
    )
    
    if business_id:
        try:
            UUID(business_id)  # Validate UUID format
            query = query.eq('business_uuid', business_id)
        except (ValueError, TypeError):
            query = query.eq('business_id', business_id)
    
    # Filter for unprocessed documents
    query = query.in_('status', ['uploaded', 'processing'])
    
    response = query.execute()
    documents = response.data or []
    
    # Filter out documents that already have chunks
    unprocessed = []
    for doc in documents:
        doc_id = doc['id']
        
        # Check if document has chunks
        chunks_response = supabase.table('document_vectors').select(
            'id', count='exact'
        ).eq('document_id', doc_id).limit(1).execute()
        
        chunk_count = chunks_response.count if hasattr(chunks_response, 'count') else len(chunks_response.data or [])
        
        if chunk_count == 0:
            unprocessed.append(doc)
            logger.info(f"  📄 {doc['original_filename']} ({doc_id[:8]}...) - {doc['status']} - 0 chunks")
    
    return unprocessed


def trigger_document_processing(document_id: str, dry_run: bool = False) -> bool:
    """
    Trigger document processing via Celery task using send_task (avoids import issues).
    
    Args:
        document_id: UUID of document to process
        dry_run: If True, only log what would be done without actually processing
        
    Returns:
        True if processing was triggered successfully, False otherwise
    """
    if dry_run:
        logger.info(f"  [DRY RUN] Would trigger processing for document {document_id[:8]}...")
        return True
    
    try:
        # Get document details
        supabase = get_supabase_client()
        doc_response = supabase.table('documents').select(
            'id, s3_path, original_filename, business_id, business_uuid, uploaded_by_user_id'
        ).eq('id', document_id).single().execute()
        
        if not doc_response.data:
            logger.error(f"  ❌ Document {document_id[:8]}... not found")
            return False
        
        doc = doc_response.data
        
        # Use business_uuid if available, otherwise business_id
        business_id = doc.get('business_uuid') or doc.get('business_id')
        
        # Initialize Celery app without importing backend.tasks
        # This avoids the boto3/botocore import issues
        from celery import Celery
        import os
        
        redis_url = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
        celery_app = Celery('tasks', broker=redis_url, backend=redis_url)
        
        # Use send_task to call the task by name (avoids importing the module)
        logger.info(f"  🚀 Triggering processing for {doc['original_filename']}...")
        
        task = celery_app.send_task(
            'backend.tasks.process_document_with_dual_stores',
            args=[document_id, doc['original_filename'], business_id],
            kwargs={'job_id': None}  # Will trigger new Reducto job
        )
        
        logger.info(f"  ✅ Processing task queued: {task.id}")
        return True
        
    except Exception as e:
        logger.error(f"  ❌ Failed to trigger processing for {document_id[:8]}...: {e}", exc_info=True)
        return False


def main():
    parser = argparse.ArgumentParser(
        description='Process unprocessed documents through the ingestion pipeline'
    )
    parser.add_argument(
        '--business-id',
        type=str,
        help='Business UUID to filter documents (optional)'
    )
    parser.add_argument(
        '--all-documents',
        action='store_true',
        help='Process all unprocessed documents (across all businesses)'
    )
    parser.add_argument(
        '--document-id',
        type=str,
        help='Process a specific document by UUID'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be processed without actually processing'
    )
    
    args = parser.parse_args()
    
    if args.document_id:
        # Process specific document
        logger.info(f"🔍 Processing specific document: {args.document_id}")
        success = trigger_document_processing(args.document_id, dry_run=args.dry_run)
        sys.exit(0 if success else 1)
    
    # Get unprocessed documents
    logger.info("🔍 Finding unprocessed documents...")
    if args.business_id:
        logger.info(f"  Filtering by business_id: {args.business_id[:8]}...")
    elif args.all_documents:
        logger.info("  Processing all unprocessed documents (all businesses)")
    else:
        logger.error("❌ Must specify --business-id, --all-documents, or --document-id")
        sys.exit(1)
    
    unprocessed = get_unprocessed_documents(
        business_id=args.business_id if not args.all_documents else None
    )
    
    if not unprocessed:
        logger.info("✅ No unprocessed documents found")
        sys.exit(0)
    
    logger.info(f"\n📊 Found {len(unprocessed)} unprocessed document(s):")
    for doc in unprocessed:
        logger.info(f"  - {doc['original_filename']} ({doc['id'][:8]}...) - {doc['status']}")
    
    if args.dry_run:
        logger.info("\n🔍 [DRY RUN] Would process the above documents")
        sys.exit(0)
    
    # Process each document
    logger.info(f"\n🚀 Processing {len(unprocessed)} document(s)...")
    success_count = 0
    for doc in unprocessed:
        doc_id = doc['id']
        logger.info(f"\n📄 Processing: {doc['original_filename']} ({doc_id[:8]}...)")
        
        if trigger_document_processing(doc_id, dry_run=False):
            success_count += 1
        else:
            logger.warning(f"  ⚠️ Failed to trigger processing for {doc['original_filename']}")
    
    logger.info(f"\n✅ Successfully triggered processing for {success_count}/{len(unprocessed)} document(s)")
    
    if success_count < len(unprocessed):
        logger.warning(f"  ⚠️ {len(unprocessed) - success_count} document(s) failed to process")
        sys.exit(1)
    
    sys.exit(0)


if __name__ == '__main__':
    main()


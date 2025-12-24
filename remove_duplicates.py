#!/usr/bin/env python3
"""
Script to remove duplicate documents from the database.
Duplicates are identified by: original_filename + file_size + business_uuid.
For each duplicate group, keeps the oldest document (by created_at) and deletes the rest.

Usage:
    python remove_duplicates.py [business_uuid]
    
If business_uuid is not provided, the script will process all businesses.
"""

import os
import sys
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.services.supabase_document_service import SupabaseDocumentService
from backend.services.unified_deletion_service import UnifiedDeletionService
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def remove_duplicates_for_business(business_uuid: str = None, skip_confirmation: bool = False):
    """
    Remove duplicate documents for a specific business or all businesses.
    
    Args:
        business_uuid: Optional business UUID. If None, processes all businesses.
        skip_confirmation: If True, skip the confirmation prompt.
    """
    doc_service = SupabaseDocumentService()
    supabase = doc_service.supabase
    deletion_service = UnifiedDeletionService()
    
    # Get all documents (optionally filtered by business)
    if business_uuid:
        logger.info(f"🔍 [REMOVE-DUPLICATES] Fetching documents for business {business_uuid}")
        all_docs = supabase.table('documents')\
            .select('id, original_filename, file_size, created_at, s3_path, business_uuid')\
            .eq('business_uuid', business_uuid)\
            .order('created_at', desc=False)\
            .execute()
    else:
        logger.info(f"🔍 [REMOVE-DUPLICATES] Fetching all documents (all businesses)")
        all_docs = supabase.table('documents')\
            .select('id, original_filename, file_size, created_at, s3_path, business_uuid')\
            .order('created_at', desc=False)\
            .execute()
    
    if not all_docs.data:
        logger.info("📄 [REMOVE-DUPLICATES] No documents found")
        return {
            'success': True,
            'message': 'No documents found',
            'duplicates_removed': 0,
            'details': []
        }
    
    logger.info(f"📄 [REMOVE-DUPLICATES] Found {len(all_docs.data)} total documents")
    
    # Group documents by (original_filename, file_size, business_uuid)
    # This identifies duplicates within each business
    duplicate_groups = {}
    for doc in all_docs.data:
        business_id = doc.get('business_uuid')
        key = (doc.get('original_filename'), doc.get('file_size'), business_id)
        if key not in duplicate_groups:
            duplicate_groups[key] = []
        duplicate_groups[key].append(doc)
    
    # Find groups with duplicates (more than 1 document)
    duplicates_to_remove = []
    for key, docs in duplicate_groups.items():
        if len(docs) > 1:
            # Sort by created_at (oldest first)
            docs_sorted = sorted(docs, key=lambda x: x.get('created_at', ''))
            # Keep the oldest (first), mark the rest for deletion
            keep_doc = docs_sorted[0]
            remove_docs = docs_sorted[1:]
            
            duplicates_to_remove.append({
                'filename': key[0],
                'file_size': key[1],
                'business_uuid': key[2],
                'keep': {
                    'id': keep_doc.get('id'),
                    'created_at': keep_doc.get('created_at')
                },
                'remove': [
                    {
                        'id': doc.get('id'),
                        'created_at': doc.get('created_at'),
                        's3_path': doc.get('s3_path')
                    }
                    for doc in remove_docs
                ]
            })
    
    if not duplicates_to_remove:
        logger.info("✅ [REMOVE-DUPLICATES] No duplicate documents found")
        return {
            'success': True,
            'message': 'No duplicate documents found',
            'duplicates_removed': 0,
            'details': []
        }
    
    logger.info(f"🔄 [REMOVE-DUPLICATES] Found {len(duplicates_to_remove)} duplicate groups")
    
    # Show summary before deletion
    total_to_delete = sum(len(group['remove']) for group in duplicates_to_remove)
    logger.info(f"📊 [REMOVE-DUPLICATES] Will delete {total_to_delete} duplicate document(s)")
    logger.info(f"📊 [REMOVE-DUPLICATES] Will keep {len(duplicates_to_remove)} original document(s)")
    
    # Ask for confirmation
    print("\n" + "="*80)
    print("⚠️  DUPLICATE REMOVAL SUMMARY")
    print("="*80)
    print(f"Found {len(duplicates_to_remove)} duplicate groups")
    print(f"Will delete {total_to_delete} duplicate document(s)")
    print(f"Will keep {len(duplicates_to_remove)} original document(s)")
    print("\nDuplicate groups:")
    for i, group in enumerate(duplicates_to_remove[:10], 1):  # Show first 10
        print(f"  {i}. {group['filename']} ({group['file_size']} bytes)")
        print(f"     Keep: {group['keep']['id']} (created: {group['keep']['created_at']})")
        print(f"     Delete: {len(group['remove'])} duplicate(s)")
    if len(duplicates_to_remove) > 10:
        print(f"  ... and {len(duplicates_to_remove) - 10} more groups")
    print("="*80)
    
    if not skip_confirmation:
        response = input("\nProceed with deletion? (yes/no): ").strip().lower()
        if response not in ['yes', 'y']:
            logger.info("❌ [REMOVE-DUPLICATES] Deletion cancelled by user")
            return {
                'success': False,
                'message': 'Deletion cancelled by user',
                'duplicates_removed': 0
            }
    else:
        logger.info("⏭️ [REMOVE-DUPLICATES] Skipping confirmation (--yes flag)")
    
    # Delete duplicates
    deletion_results = []
    total_deleted = 0
    total_failed = 0
    
    for group in duplicates_to_remove:
        filename = group['filename']
        business_uuid = group['business_uuid']
        keep_id = group['keep']['id']
        
        for doc_to_remove in group['remove']:
            doc_id = doc_to_remove['id']
            s3_path = doc_to_remove.get('s3_path')
            
            try:
                logger.info(f"🗑️ [REMOVE-DUPLICATES] Deleting duplicate: {filename} (ID: {doc_id})")
                
                # Use UnifiedDeletionService to properly delete the document
                result = deletion_service.delete_document_complete(
                    document_id=doc_id,
                    business_id=business_uuid,
                    s3_path=s3_path,
                    delete_s3=True,
                    recompute_properties=True,
                    cleanup_orphans=True
                )
                
                if result.success:
                    total_deleted += 1
                    deletion_results.append({
                        'filename': filename,
                        'deleted_id': doc_id,
                        'kept_id': keep_id,
                        'status': 'success'
                    })
                    logger.info(f"✅ [REMOVE-DUPLICATES] Successfully deleted duplicate {doc_id}")
                else:
                    total_failed += 1
                    deletion_results.append({
                        'filename': filename,
                        'deleted_id': doc_id,
                        'kept_id': keep_id,
                        'status': 'failed',
                        'errors': result.errors
                    })
                    logger.error(f"❌ [REMOVE-DUPLICATES] Failed to delete duplicate {doc_id}: {result.errors}")
                    
            except Exception as e:
                total_failed += 1
                deletion_results.append({
                    'filename': filename,
                    'deleted_id': doc_id,
                    'kept_id': keep_id,
                    'status': 'error',
                    'error': str(e)
                })
                logger.error(f"❌ [REMOVE-DUPLICATES] Error deleting duplicate {doc_id}: {e}", exc_info=True)
    
    logger.info(f"✅ [REMOVE-DUPLICATES] Completed: {total_deleted} deleted, {total_failed} failed")
    
    return {
        'success': True,
        'message': f'Removed {total_deleted} duplicate document(s)',
        'duplicates_removed': total_deleted,
        'duplicates_failed': total_failed,
        'duplicate_groups_found': len(duplicates_to_remove),
        'details': deletion_results
    }


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Remove duplicate documents from the database')
    parser.add_argument('business_uuid', nargs='?', help='Optional business UUID to filter by')
    parser.add_argument('--yes', '-y', action='store_true', help='Skip confirmation prompt')
    args = parser.parse_args()
    
    try:
        result = remove_duplicates_for_business(args.business_uuid, skip_confirmation=args.yes)
        
        print("\n" + "="*80)
        print("📊 REMOVAL RESULTS")
        print("="*80)
        print(f"Success: {result['success']}")
        print(f"Message: {result['message']}")
        print(f"Duplicates removed: {result['duplicates_removed']}")
        if result.get('duplicates_failed', 0) > 0:
            print(f"Duplicates failed: {result['duplicates_failed']}")
        print("="*80)
        
        if not result['success']:
            sys.exit(1)
            
    except KeyboardInterrupt:
        logger.info("\n❌ [REMOVE-DUPLICATES] Interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"❌ [REMOVE-DUPLICATES] Error: {e}", exc_info=True)
        sys.exit(1)

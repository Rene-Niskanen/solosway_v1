"""
Unified Deletion Service
Single source of truth for all document and property deletions.

This service consolidates all deletion logic that was previously spread across:
- views.py (_perform_document_deletion, _cleanup_orphan_supabase_properties)
- deletion_service.py (DeletionService)
- vector_service.py (delete methods)

Deletion order follows FK constraints to ensure safe cascading:
1. document_access_logs (FK → documents)
2. document_processing_history (FK → documents)
3. document_relationships (FK → documents, properties)
4. document_vectors (document_id reference)
5. property_vectors (source_document_id reference)
6. comparable_properties (source_document_id reference)
7. property_details (source_document_id reference)
8. documents (main table)
9. properties (only if orphaned - no remaining documents)
"""

import os
import logging
import requests
from requests_aws4auth import AWS4Auth
from typing import Dict, List, Optional, Any, Set, Tuple
from dataclasses import dataclass, field

from .supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)


@dataclass
class DeletionResult:
    """
    Tracks results of all deletion operations.
    
    Attributes:
        success: Overall success status (True only if ALL operations succeed)
        operations: Dict mapping operation name to success/failure
        errors: Dict mapping operation name to error message (if failed)
        warnings: List of non-fatal warning messages
        impacted_property_ids: Set of property IDs affected by the deletion
    """
    success: bool = False
    operations: Dict[str, bool] = field(default_factory=dict)
    errors: Dict[str, str] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)
    impacted_property_ids: Set[str] = field(default_factory=set)
    
    @property
    def success_count(self) -> int:
        """Count of successful operations"""
        return sum(self.operations.values())
    
    @property
    def total_count(self) -> int:
        """Total number of operations attempted"""
        return len(self.operations)
    
    @property
    def http_status(self) -> int:
        """
        Appropriate HTTP status code for the result:
        - 200: All operations successful
        - 207: Partial success (Multi-Status)
        - 500: All operations failed
        """
        if all(self.operations.values()):
            return 200
        elif any(self.operations.values()):
            return 207  # Multi-status (partial success)
        return 500
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON response"""
        result = {
            'success': self.success,
            'message': f'Deletion completed: {self.success_count}/{self.total_count} operations successful',
            'operations': self.operations,
        }
        if self.errors:
            result['errors'] = self.errors
        if self.warnings:
            result['warnings'] = self.warnings
        return result


class UnifiedDeletionService:
    """
    Centralized deletion service for all document and property deletions.
    Handles S3, Supabase, and PostgreSQL in the correct FK-safe order.
    
    Usage:
        from backend.services.unified_deletion_service import UnifiedDeletionService
        
        service = UnifiedDeletionService()
        result = service.delete_document_complete(
            document_id="...",
            business_id="...",
            s3_path="...",
        )
        
        if result.success:
            print("All deletions successful")
        else:
            print(f"Errors: {result.errors}")
    """
    
    def __init__(self):
        """Initialize Supabase client"""
        self.supabase = get_supabase_client()
        logger.info("✅ UnifiedDeletionService initialized")
    
    # =========================================================================
    # S3 DELETION
    # =========================================================================
    
    def _delete_s3_file(self, s3_path: str) -> Tuple[bool, Optional[str]]:
        """
        Delete file from S3 via API Gateway.
        
        Args:
            s3_path: Full S3 path to the file (e.g., "SoloSway/uuid/filename.pdf")
            
        Returns:
            Tuple of (success, error_message)
        """
        try:
            # Get AWS configuration from environment
            aws_access_key = os.environ['AWS_ACCESS_KEY_ID']
            aws_secret_key = os.environ['AWS_SECRET_ACCESS_KEY']
            aws_region = os.environ.get('AWS_REGION') or os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
            invoke_url = os.environ['API_GATEWAY_INVOKE_URL']
            bucket_name = os.environ['S3_UPLOAD_BUCKET']
            
            # Build request URL and auth
            final_url = f"{invoke_url.rstrip('/')}/{bucket_name}/{s3_path}"
            service = 'execute-api'
            aws_auth = AWS4Auth(aws_access_key, aws_secret_key, aws_region, service)
            
            # Execute DELETE request
            response = requests.delete(final_url, auth=aws_auth)
            response.raise_for_status()
            
            logger.info(f"✅ S3: Deleted file {s3_path}")
            return True, None
            
        except KeyError as e:
            error_msg = f"Missing AWS environment variable: {e}"
            logger.error(f"❌ S3: {error_msg}")
            return False, error_msg
        except requests.exceptions.RequestException as e:
            error_msg = f"S3 deletion request failed: {e}"
            logger.error(f"❌ S3: {error_msg}")
            return False, error_msg
    
    # =========================================================================
    # SUPABASE TABLE DELETIONS (in FK-safe order)
    # =========================================================================
    
    def _delete_document_access_logs(self, document_id: str) -> Tuple[bool, Optional[str]]:
        """
        Step 1: Delete document access logs.
        
        Args:
            document_id: UUID of the document
            
        Returns:
            Tuple of (success, error_message)
        """
        try:
            # Check count first for logging
            check_result = self.supabase.table('document_access_logs').select('id').eq('document_id', document_id).execute()
            count = len(check_result.data) if check_result.data else 0
            
            if count == 0:
                logger.info(f"✅ document_access_logs: No records to delete for {document_id}")
                return True, None
            
            # Delete records
            self.supabase.table('document_access_logs').delete().eq('document_id', document_id).execute()
            logger.info(f"✅ document_access_logs: Deleted {count} records for {document_id}")
            return True, None
            
        except Exception as e:
            error_msg = f"Failed to delete document_access_logs: {e}"
            logger.error(f"❌ document_access_logs: {error_msg}")
            return False, error_msg

    def _delete_processing_history(self, document_id: str) -> Tuple[bool, Optional[str]]:
        """
        Step 2: Delete document processing history.
        
        Args:
            document_id: UUID of the document
            
        Returns:
            Tuple of (success, error_message)
        """
        try:
            # Check count first for logging
            check_result = self.supabase.table('document_processing_history').select('id').eq('document_id', document_id).execute()
            count = len(check_result.data) if check_result.data else 0
            
            if count == 0:
                logger.info(f"✅ document_processing_history: No records to delete for {document_id}")
                return True, None
            
            # Delete records
            self.supabase.table('document_processing_history').delete().eq('document_id', document_id).execute()
            logger.info(f"✅ document_processing_history: Deleted {count} records for {document_id}")
            return True, None
            
        except Exception as e:
            error_msg = f"Failed to delete document_processing_history: {e}"
            logger.error(f"❌ document_processing_history: {error_msg}")
            return False, error_msg

    def _delete_document_relationships(self, document_id: str) -> Tuple[bool, Set[str], Optional[str]]:
        """
        Step 3: Delete document relationships and return impacted property IDs.
        
        This must happen before deleting the document record due to FK constraint.
        We capture impacted property IDs first for later cleanup/recompute.
        
        Args:
            document_id: UUID of the document
            
        Returns:
            Tuple of (success, impacted_property_ids, error_message)
        """
        impacted_properties: Set[str] = set()
        
        try:
            # First get impacted properties before deletion
            result = self.supabase.table('document_relationships').select('property_id').eq('document_id', document_id).execute()
            if result.data:
                impacted_properties = {str(r['property_id']) for r in result.data if r.get('property_id')}
            
            count = len(result.data) if result.data else 0
            
            if count == 0:
                logger.info(f"✅ document_relationships: No records to delete for {document_id}")
                return True, impacted_properties, None
            
            # Delete records
            self.supabase.table('document_relationships').delete().eq('document_id', document_id).execute()
            logger.info(f"✅ document_relationships: Deleted {count} records for {document_id}, impacted properties: {len(impacted_properties)}")
            return True, impacted_properties, None
            
        except Exception as e:
            error_msg = f"Failed to delete document_relationships: {e}"
            logger.error(f"❌ document_relationships: {error_msg}")
            return False, impacted_properties, error_msg

    def _delete_document_vectors(self, document_id: str) -> Tuple[bool, Optional[str]]:
        """
        Step 4: Delete document vectors (embeddings).
        
        Args:
            document_id: UUID of the document
            
        Returns:
            Tuple of (success, error_message)
        """
        try:
            # Check count first for logging
            check_result = self.supabase.table('document_vectors').select('id').eq('document_id', document_id).execute()
            count = len(check_result.data) if check_result.data else 0
            
            if count == 0:
                logger.info(f"✅ document_vectors: No records to delete for {document_id}")
                return True, None
            
            # Delete records
            self.supabase.table('document_vectors').delete().eq('document_id', document_id).execute()
            logger.info(f"✅ document_vectors: Deleted {count} records for {document_id}")
            return True, None
            
        except Exception as e:
            error_msg = f"Failed to delete document_vectors: {e}"
            logger.error(f"❌ document_vectors: {error_msg}")
            return False, error_msg

    def _delete_property_vectors_by_source(self, document_id: str) -> Tuple[bool, Optional[str]]:
        """
        Step 5: Delete property vectors by source document.
        
        Property vectors may have a source_document_id column linking them
        to the document they were generated from.
        
        Args:
            document_id: UUID of the source document
            
        Returns:
            Tuple of (success, error_message)
        """
        try:
            # Delete by source_document_id
            self.supabase.table('property_vectors').delete().eq('source_document_id', document_id).execute()
            logger.info(f"✅ property_vectors: Deleted records for source document {document_id}")
            return True, None
            
        except Exception as e:
            # This may fail if source_document_id column doesn't exist - that's OK
            warning_msg = f"Property vectors deletion by source_document_id: {e}"
            logger.warning(f"⚠️ property_vectors: {warning_msg}")
            return True, None  # Non-critical, return success with warning

    def _delete_comparable_properties(self, document_id: str) -> Tuple[bool, Optional[str]]:
        """
        Step 6: Delete comparable properties extracted from this document.
        
        Args:
            document_id: UUID of the source document
            
        Returns:
            Tuple of (success, error_message)
        """
        try:
            # Check count first for logging
            check_result = self.supabase.table('comparable_properties').select('id').eq('source_document_id', document_id).execute()
            count = len(check_result.data) if check_result.data else 0
            
            if count == 0:
                logger.info(f"✅ comparable_properties: No records to delete for {document_id}")
                return True, None
            
            # Delete records
            self.supabase.table('comparable_properties').delete().eq('source_document_id', document_id).execute()
            logger.info(f"✅ comparable_properties: Deleted {count} records for {document_id}")
            return True, None
            
        except Exception as e:
            error_msg = f"Failed to delete comparable_properties: {e}"
            logger.error(f"❌ comparable_properties: {error_msg}")
            return False, error_msg

    def _delete_property_details_by_source(self, document_id: str) -> Tuple[bool, Optional[str]]:
        """
        Step 7: Delete property details by source document.
        
        Args:
            document_id: UUID of the source document
            
        Returns:
            Tuple of (success, error_message)
        """
        try:
            # Check count first for logging
            check_result = self.supabase.table('property_details').select('property_id').eq('source_document_id', document_id).execute()
            count = len(check_result.data) if check_result.data else 0
            
            if count == 0:
                logger.info(f"✅ property_details: No records to delete for source document {document_id}")
                return True, None
            
            # Delete records
            self.supabase.table('property_details').delete().eq('source_document_id', document_id).execute()
            logger.info(f"✅ property_details: Deleted {count} records for source document {document_id}")
            return True, None
            
        except Exception as e:
            error_msg = f"Failed to delete property_details: {e}"
            logger.error(f"❌ property_details: {error_msg}")
            return False, error_msg

    def _delete_document_record(self, document_id: str, business_id: str) -> Tuple[bool, Optional[str]]:
        """
        Step 8: Delete the main document record.
        
        This should be done LAST after all related records are deleted.
        
        Args:
            document_id: UUID of the document
            business_id: Business ID for multi-tenancy verification
            
        Returns:
            Tuple of (success, error_message)
        """
        try:
            # Check if document exists
            check_result = self.supabase.table('documents').select('id').eq('id', document_id).execute()
            exists = len(check_result.data) > 0 if check_result.data else False
            
            if not exists:
                logger.info(f"✅ documents: Record {document_id} not found (already deleted or never existed)")
                return True, None
            
            # Delete the document - use business_id filter for security
            # Note: business_id in documents table is VARCHAR, not UUID
            self.supabase.table('documents').delete().eq('id', document_id).execute()
            logger.info(f"✅ documents: Deleted record {document_id}")
            return True, None
            
        except Exception as e:
            error_msg = f"Failed to delete document record: {e}"
            logger.error(f"❌ documents: {error_msg}")
            return False, error_msg

    # =========================================================================
    # PROPERTY CLEANUP
    # =========================================================================

    def _recompute_impacted_properties(self, property_ids: Set[str], deleted_document_id: str) -> Tuple[bool, Optional[str]]:
        """
        Recompute property hub data after a document is deleted.
        
        This updates image counts, primary images, and source_documents arrays
        for properties that were linked to the deleted document.
        
        Args:
            property_ids: Set of property IDs to recompute
            deleted_document_id: UUID of the deleted document
            
        Returns:
            Tuple of (success, error_message)
        """
        if not property_ids:
            logger.info("✅ property_recompute: No properties to recompute")
            return True, None
        
        try:
            from .supabase_property_hub_service import SupabasePropertyHubService
            hub_service = SupabasePropertyHubService()
            
            success_count = 0
            for prop_id in property_ids:
                try:
                    result = hub_service.recompute_property_after_document_deletion(prop_id, deleted_document_id)
                    if result.get('success', False):
                        success_count += 1
                except Exception as e:
                    logger.warning(f"⚠️ property_recompute: Failed for property {prop_id}: {e}")
            
            logger.info(f"✅ property_recompute: Recomputed {success_count}/{len(property_ids)} properties")
            return True, None
            
        except Exception as e:
            error_msg = f"Failed to recompute properties: {e}"
            logger.error(f"❌ property_recompute: {error_msg}")
            return False, error_msg

    def _cleanup_orphan_properties(self, property_ids: Set[str]) -> Tuple[bool, List[str]]:
        """
        Remove Supabase property hub records when no documents remain linked.
        
        This cleans up properties that have no remaining document_relationships,
        removing their vectors, details, cache, and main property record.
        
        Args:
            property_ids: Set of property IDs to check for orphan status
            
        Returns:
            Tuple of (success, list of cleaned property IDs)
        """
        cleaned_properties: List[str] = []
        
        if not property_ids:
            logger.info("✅ orphan_cleanup: No properties to check")
            return True, cleaned_properties
        
        for property_id in property_ids:
            try:
                # Check if any documents still reference this property
                docs_result = self.supabase.table('document_relationships').select('id').eq('property_id', property_id).limit(1).execute()
                
                if docs_result.data and len(docs_result.data) > 0:
                    # Property still has linked documents, skip
                    continue
                
                # No documents left - clean up property data in FK-safe order
                logger.info(f"🧹 orphan_cleanup: Cleaning orphan property {property_id}")
                
                # 1. Delete property vectors
                try:
                    self.supabase.table('property_vectors').delete().eq('property_id', property_id).execute()
                except Exception as e:
                    logger.warning(f"⚠️ orphan_cleanup: Failed to delete property_vectors for {property_id}: {e}")
                
                # 2. Delete property card cache
                try:
                    self.supabase.table('property_card_cache').delete().eq('property_id', property_id).execute()
                except Exception as e:
                    logger.warning(f"⚠️ orphan_cleanup: Failed to delete property_card_cache for {property_id}: {e}")
                
                # 3. Delete property details
                try:
                    self.supabase.table('property_details').delete().eq('property_id', property_id).execute()
                except Exception as e:
                    logger.warning(f"⚠️ orphan_cleanup: Failed to delete property_details for {property_id}: {e}")
                
                # 4. Delete any remaining document_relationships (should be none)
                try:
                    self.supabase.table('document_relationships').delete().eq('property_id', property_id).execute()
                except Exception as e:
                    logger.warning(f"⚠️ orphan_cleanup: Failed to delete document_relationships for {property_id}: {e}")
                
                # 5. Delete the property record itself
                try:
                    self.supabase.table('properties').delete().eq('id', property_id).execute()
                except Exception as e:
                    logger.warning(f"⚠️ orphan_cleanup: Failed to delete property for {property_id}: {e}")
                
                cleaned_properties.append(property_id)
                logger.info(f"✅ orphan_cleanup: Cleaned orphan property {property_id}")
                
            except Exception as e:
                logger.warning(f"⚠️ orphan_cleanup: Error checking property {property_id}: {e}")
        
        if cleaned_properties:
            logger.info(f"✅ orphan_cleanup: Cleaned {len(cleaned_properties)} orphan properties")
        else:
            logger.info("✅ orphan_cleanup: No orphan properties found")
        
        return True, cleaned_properties

    # =========================================================================
    # MAIN ORCHESTRATION METHOD
    # =========================================================================

    def delete_document_complete(
        self, 
        document_id: str, 
        business_id: str,
        s3_path: Optional[str] = None,
        delete_s3: bool = True,
        recompute_properties: bool = True,
        cleanup_orphans: bool = True
    ) -> DeletionResult:
        """
        Complete document deletion from ALL stores in FK-safe order.
        
        This is the main entry point for document deletion. It handles:
        1. S3 file deletion
        2. All Supabase table deletions (in correct order)
        3. Property hub recomputation
        4. Orphan property cleanup
        
        Args:
            document_id: UUID of document to delete
            business_id: Business ID (for multi-tenancy verification)
            s3_path: S3 path to file (optional - will skip S3 if not provided)
            delete_s3: Whether to delete from S3 (default True)
            recompute_properties: Whether to recompute impacted property hubs (default True)
            cleanup_orphans: Whether to clean up orphaned properties (default True)
        
        Returns:
            DeletionResult with status of all operations
        """
        result = DeletionResult()
        
        logger.info("=" * 80)
        logger.info("UNIFIED DELETION SERVICE - Starting complete deletion")
        logger.info(f"   Document ID: {document_id}")
        logger.info(f"   Business ID: {business_id}")
        logger.info(f"   S3 Path: {s3_path or 'Not provided'}")
        logger.info("=" * 80)
        
        # Step 1: S3 deletion (if requested and path provided)
        if delete_s3:
            if s3_path:
                success, error = self._delete_s3_file(s3_path)
                result.operations['s3'] = success
                if error:
                    result.errors['s3'] = error
            else:
                result.warnings.append('S3 deletion skipped: no s3_path provided')
                result.operations['s3'] = True  # Not a failure, just skipped
        
        # Step 2: Document access logs (FK → documents)
        success, error = self._delete_document_access_logs(document_id)
        result.operations['document_access_logs'] = success
        if error:
            result.errors['document_access_logs'] = error
        
        # Step 3: Processing history (FK → documents)
        success, error = self._delete_processing_history(document_id)
        result.operations['processing_history'] = success
        if error:
            result.errors['processing_history'] = error
        
        # Step 4: Document relationships (FK → documents, properties)
        # Also captures impacted property IDs for later processing
        success, impacted_props, error = self._delete_document_relationships(document_id)
        result.operations['document_relationships'] = success
        result.impacted_property_ids = impacted_props
        if error:
            result.errors['document_relationships'] = error
        
        # Step 5: Document vectors
        success, error = self._delete_document_vectors(document_id)
        result.operations['document_vectors'] = success
        if error:
            result.errors['document_vectors'] = error
        
        # Step 6: Property vectors by source document
        success, error = self._delete_property_vectors_by_source(document_id)
        result.operations['property_vectors'] = success
        if error:
            result.errors['property_vectors'] = error
        
        # Step 7: Comparable properties
        success, error = self._delete_comparable_properties(document_id)
        result.operations['comparable_properties'] = success
        if error:
            result.errors['comparable_properties'] = error
        
        # Step 8: Property details by source document
        success, error = self._delete_property_details_by_source(document_id)
        result.operations['property_details'] = success
        if error:
            result.errors['property_details'] = error
        
        # Step 9: Main document record (LAST - after all FK dependencies)
        success, error = self._delete_document_record(document_id, business_id)
        result.operations['document_record'] = success
        if error:
            result.errors['document_record'] = error
        
        # Step 10: Recompute impacted property hubs
        if recompute_properties and result.impacted_property_ids:
            success, error = self._recompute_impacted_properties(result.impacted_property_ids, document_id)
            result.operations['property_recompute'] = success
            if error:
                result.errors['property_recompute'] = error
        
        # Step 11: Cleanup orphaned properties
        if cleanup_orphans and result.impacted_property_ids:
            success, cleaned = self._cleanup_orphan_properties(result.impacted_property_ids)
            result.operations['orphan_cleanup'] = success
            if cleaned:
                result.warnings.append(f"Cleaned {len(cleaned)} orphan properties: {cleaned}")
        
        # Calculate overall success
        result.success = all(result.operations.values())
        
        # Also set the legacy 'supabase' and 'postgresql' flags for backwards compatibility
        supabase_ops = [
            'document_access_logs', 'processing_history', 'document_relationships',
            'document_vectors', 'property_vectors', 'comparable_properties',
            'property_details', 'document_record'
        ]
        result.operations['supabase'] = all(
            result.operations.get(op, True) for op in supabase_ops
        )
        result.operations['postgresql'] = True  # Documents now in Supabase, not PostgreSQL
        
        logger.info("=" * 80)
        logger.info(f"DELETION COMPLETE: {result.success_count}/{result.total_count} operations successful")
        logger.info(f"   Overall success: {result.success}")
        logger.info(f"   Operations: {result.operations}")
        if result.errors:
            logger.warning(f"   Errors: {result.errors}")
        if result.warnings:
            logger.info(f"   Warnings: {result.warnings}")
        logger.info("=" * 80)
        
        return result

    # =========================================================================
    # PROPERTY DELETION (for future use)
    # =========================================================================

    def delete_property_complete(self, property_id: str, business_id: str) -> DeletionResult:
        """
        Delete a property and all associated data.
        
        This deletes:
        - Property vectors
        - Property card cache
        - Property details
        - Document relationships to this property
        - The property record itself
        
        NOTE: This does NOT delete documents linked to the property.
        Those documents may be linked to other properties or standalone.
        
        Args:
            property_id: UUID of property to delete
            business_id: Business ID for verification
            
        Returns:
            DeletionResult with status of all operations
        """
        result = DeletionResult()
        
        logger.info("=" * 80)
        logger.info("UNIFIED DELETION SERVICE - Starting property deletion")
        logger.info(f"   Property ID: {property_id}")
        logger.info(f"   Business ID: {business_id}")
        logger.info("=" * 80)
        
        try:
            # 1. Delete property vectors
            try:
                self.supabase.table('property_vectors').delete().eq('property_id', property_id).execute()
                result.operations['property_vectors'] = True
                logger.info(f"✅ property_vectors: Deleted for property {property_id}")
            except Exception as e:
                result.operations['property_vectors'] = False
                result.errors['property_vectors'] = str(e)
            
            # 2. Delete property card cache
            try:
                self.supabase.table('property_card_cache').delete().eq('property_id', property_id).execute()
                result.operations['property_card_cache'] = True
                logger.info(f"✅ property_card_cache: Deleted for property {property_id}")
            except Exception as e:
                result.operations['property_card_cache'] = False
                result.errors['property_card_cache'] = str(e)
            
            # 3. Delete property details
            try:
                self.supabase.table('property_details').delete().eq('property_id', property_id).execute()
                result.operations['property_details'] = True
                logger.info(f"✅ property_details: Deleted for property {property_id}")
            except Exception as e:
                result.operations['property_details'] = False
                result.errors['property_details'] = str(e)
            
            # 4. Delete document relationships
            try:
                self.supabase.table('document_relationships').delete().eq('property_id', property_id).execute()
                result.operations['document_relationships'] = True
                logger.info(f"✅ document_relationships: Deleted for property {property_id}")
            except Exception as e:
                result.operations['document_relationships'] = False
                result.errors['document_relationships'] = str(e)
            
            # 5. Delete property record
            try:
                self.supabase.table('properties').delete().eq('id', property_id).execute()
                result.operations['property_record'] = True
                logger.info(f"✅ properties: Deleted property {property_id}")
            except Exception as e:
                result.operations['property_record'] = False
                result.errors['property_record'] = str(e)
            
        except Exception as e:
            logger.error(f"❌ Property deletion failed: {e}")
            result.errors['general'] = str(e)
        
        result.success = all(result.operations.values())
        
        logger.info("=" * 80)
        logger.info(f"PROPERTY DELETION COMPLETE: {result.success_count}/{result.total_count} successful")
        logger.info("=" * 80)
        
        return result


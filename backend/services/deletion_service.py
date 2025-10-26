import os
import requests
import uuid
import logging

# Set up logging
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

class DeletionService:
    def __init__(self):
        pass
    
    def delete_document_from_all_stores(self, document_id, business_id):
        """
        Delete document data from ALL databases in the 6-database architecture:
        1. Supabase Documents table (document metadata & central registry)
        2. Supabase Comparable Properties (extracted property data)
        3. Supabase Document Vectors (document chunk embeddings)
        4. Supabase Property Vectors (property embeddings)
        5. Supabase Processing History (audit trail)
        6. PostgreSQL Property nodes (linking only)
        
        Note: S3 and local PostgreSQL Document table are handled separately in views.py
        """
        logger.info("=" * 80)
        logger.info(f"DELETION SERVICE - Starting complete deletion")
        logger.info(f"Document ID: {document_id}")
        logger.info(f"Business ID: {business_id}")
        logger.info("=" * 80)
        
        deletion_results = {
            'supabase_documents': False,
            'supabase_property_details': False,
            'supabase_document_vectors': False,
            'supabase_property_vectors': False,
            'supabase_processing_history': False,
            'supabase_document_access_logs': False,
            'postgresql_properties': False
        }
        
        deletion_errors = {
            'supabase_documents': None,
            'supabase_property_details': None,
            'supabase_document_vectors': None,
            'supabase_property_vectors': None,
            'supabase_processing_history': None,
            'supabase_document_access_logs': None,
            'postgresql_properties': None
        }
        
        try:
            # 1. Delete from Supabase property_vectors FIRST (before deleting properties!)
            logger.info("[1/6] Deleting from Supabase property_vectors...")
            try:
                deletion_results['supabase_property_vectors'] = self.delete_supabase_property_vectors(document_id)
                if deletion_results['supabase_property_vectors']:
                    logger.info("    SUCCESS: Property vectors deletion")
                else:
                    logger.warning("    FAILED: Property vectors deletion")
            except Exception as e:
                deletion_errors['supabase_property_vectors'] = str(e)
                logger.error(f"    ERROR: Property vectors deletion - {e}")
            
            # 2. Delete from Supabase document_vectors
            logger.info("[2/6] Deleting from Supabase document_vectors...")
            try:
                deletion_results['supabase_document_vectors'] = self.delete_supabase_document_vectors(document_id)
                if deletion_results['supabase_document_vectors']:
                    logger.info("    SUCCESS: Document vectors deletion")
                else:
                    logger.warning("    FAILED: Document vectors deletion")
            except Exception as e:
                deletion_errors['supabase_document_vectors'] = str(e)
                logger.error(f"    ERROR: Document vectors deletion - {e}")
            
            # 3. Delete from Supabase property_details (AFTER property vectors!)
            logger.info("[3/6] Deleting from Supabase property_details...")
            try:
                deletion_results['supabase_property_details'] = self.delete_supabase_property_details(document_id)
                if deletion_results['supabase_property_details']:
                    logger.info("    SUCCESS: Property details deletion")
                else:
                    logger.warning("    FAILED: Property details deletion")
            except Exception as e:
                deletion_errors['supabase_property_details'] = str(e)
                logger.error(f"    ERROR: Property details deletion - {e}")
            
            # 4. Delete from Supabase document_processing_history
            logger.info("[4/7] Deleting from Supabase document_processing_history...")
            try:
                deletion_results['supabase_processing_history'] = self.delete_supabase_processing_history(document_id)
                if deletion_results['supabase_processing_history']:
                    logger.info("    SUCCESS: Processing history deletion")
                else:
                    logger.warning("    FAILED: Processing history deletion")
            except Exception as e:
                deletion_errors['supabase_processing_history'] = str(e)
                logger.error(f"    ERROR: Processing history deletion - {e}")
            
            # 5. Delete from Supabase document_access_logs
            logger.info("[5/7] Deleting from Supabase document_access_logs...")
            try:
                deletion_results['supabase_document_access_logs'] = self.delete_supabase_document_access_logs(document_id)
                if deletion_results['supabase_document_access_logs']:
                    logger.info("    SUCCESS: Document access logs deletion")
                else:
                    logger.warning("    FAILED: Document access logs deletion")
            except Exception as e:
                deletion_errors['supabase_document_access_logs'] = str(e)
                logger.error(f"    ERROR: Document access logs deletion - {e}")
            
            # 6. Delete from PostgreSQL Property nodes (linking only)
            logger.info("[6/7] Deleting from PostgreSQL Property nodes...")
            try:
                deletion_results['postgresql_properties'] = self.delete_postgresql_property_nodes(document_id)
                if deletion_results['postgresql_properties']:
                    logger.info("    SUCCESS: PostgreSQL property nodes deletion")
                else:
                    logger.warning("    FAILED: PostgreSQL property nodes deletion")
            except Exception as e:
                deletion_errors['postgresql_properties'] = str(e)
                logger.error(f"    ERROR: PostgreSQL property nodes deletion - {e}")
            
            # 7. Delete from Supabase documents table (central registry)
            logger.info("[7/7] Deleting from Supabase documents table...")
            try:
                deletion_results['supabase_documents'] = self.delete_supabase_document(document_id, business_id)
                if deletion_results['supabase_documents']:
                    logger.info("    SUCCESS: Supabase document deletion")
                else:
                    logger.warning("    FAILED: Supabase document deletion")
            except Exception as e:
                deletion_errors['supabase_documents'] = str(e)
                logger.error(f"    ERROR: Supabase document deletion - {e}")
            
            overall_success = all(deletion_results.values())
            success_count = sum(deletion_results.values())
            total_count = len(deletion_results)
            
            logger.info("=" * 80)
            logger.info(f"DELETION SUMMARY:")
            logger.info(f"   Success: {success_count}/{total_count}")
            logger.info(f"   Results: {deletion_results}")
            if any(deletion_errors.values()):
                logger.error(f"   Errors: {deletion_errors}")
            logger.info("=" * 80)
            
            return overall_success, deletion_results
            
        except Exception as e:
            logger.error(f"CRITICAL ERROR in complete deletion: {e}")
            import traceback
            traceback.print_exc()
            return False, deletion_results
    
    def delete_postgresql_property_nodes(self, document_id):
        """Delete property nodes from PostgreSQL (only if no other documents linked)"""
        try:
            from ..models import db, Property, Document
            from .. import create_app
            
            # Get the document to find its property_id
            document = Document.query.get(document_id)
            if not document or not document.property_id:
                print("✅ No property node linked to this document")
                return True
            
            property_id = document.property_id
            
            # Check if other documents are linked to this property
            other_documents = Document.query.filter(
                Document.property_id == property_id,
                Document.id != document_id
            ).count()
            
            if other_documents > 0:
                print(f"✅ Property node {property_id} has {other_documents} other documents - keeping property node")
                return True
            
            # No other documents linked, safe to delete property node
            property_node = Property.query.get(property_id)
            if property_node:
                db.session.delete(property_node)
                db.session.commit()
                print(f"✅ Deleted property node {property_id}")
            else:
                print(f"✅ Property node {property_id} not found (already deleted)")
            
            return True
            
        except Exception as e:
            print(f"❌ Error deleting PostgreSQL property nodes: {e}")
            try:
                db.session.rollback()
            except:
                pass
            return False
    
    def _get_supabase_client(self):
        """Get Supabase client"""
        from supabase import create_client, Client
        supabase_url = os.environ.get('SUPABASE_URL')
        supabase_key = os.environ.get('SUPABASE_SERVICE_KEY')
        
        if not supabase_url or not supabase_key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required")
        
        return create_client(supabase_url, supabase_key)
    
    def delete_supabase_property_details(self, document_id):
        """Delete property details from Supabase"""
        try:
            supabase = self._get_supabase_client()
            logger.info(f"🔍 Querying property_details for document_id: {document_id}")
            
            # First check what exists
            check_result = supabase.table('property_details').select('property_id').eq('source_document_id', document_id).execute()
            count_before = len(check_result.data) if check_result.data else 0
            logger.info(f"   Found {count_before} property details to delete")
            
            if count_before == 0:
                logger.info(f"   ✅ No property details to delete (clean)")
                return True
            
            # Delete them
            result = supabase.table('property_details').delete().eq('source_document_id', document_id).execute()
            logger.info(f"   ✅ Deleted {count_before} property details for document {document_id}")
            logger.info(f"   Delete response: {result}")
            return True
        except Exception as e:
            logger.error(f"❌ Error deleting property details: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def delete_supabase_document_vectors(self, document_id):
        """Delete document vectors from Supabase"""
        try:
            supabase = self._get_supabase_client()
            logger.info(f"🔍 Querying document_vectors for document_id: {document_id}")
            
            # First check what exists
            check_result = supabase.table('document_vectors').select('id').eq('document_id', document_id).execute()
            count_before = len(check_result.data) if check_result.data else 0
            logger.info(f"   Found {count_before} document vectors to delete")
            
            if count_before == 0:
                logger.info(f"   ✅ No document vectors to delete (clean)")
                return True
            
            # Delete them
            result = supabase.table('document_vectors').delete().eq('document_id', document_id).execute()
            logger.info(f"   ✅ Deleted {count_before} document vectors for document {document_id}")
            return True
        except Exception as e:
            logger.error(f"❌ Error deleting document vectors: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def delete_supabase_property_vectors(self, document_id):
        """Delete property vectors from Supabase (via property_id link)"""
        try:
            supabase = self._get_supabase_client()
            logger.info(f"🔍 Querying property_vectors via property_details for document_id: {document_id}")
            
            # First get property IDs from property_details
            props_result = supabase.table('property_details').select('property_id').eq('source_document_id', document_id).execute()
            
            if props_result.data:
                property_ids = [prop['property_id'] for prop in props_result.data]
                logger.info(f"   Found {len(property_ids)} properties with potential vectors")
                logger.info(f"   Property IDs: {property_ids[:3]}..." if len(property_ids) > 3 else f"   Property IDs: {property_ids}")
                
                total_deleted = 0
                for i, prop_id in enumerate(property_ids, 1):
                    # Check how many vectors exist for this property
                    logger.info(f"   [{i}/{len(property_ids)}] Checking property {prop_id}...")
                    check_result = supabase.table('property_vectors').select('id').eq('property_id', prop_id).execute()
                    vector_count = len(check_result.data) if check_result.data else 0
                    logger.info(f"      Found {vector_count} vectors for property {prop_id}")
                    
                    if vector_count > 0:
                        delete_result = supabase.table('property_vectors').delete().eq('property_id', prop_id).execute()
                        total_deleted += vector_count
                        logger.info(f"      ✅ Deleted {vector_count} vectors (API response: {len(delete_result.data) if delete_result.data else 0} rows)")
                    else:
                        logger.info(f"      ⚠️ No vectors found for this property")
                
                logger.info(f"   ✅ Deleted {total_deleted} total property vectors across {len(property_ids)} properties")
                
                # VERIFY: Double-check no vectors remain
                verification = supabase.table('property_vectors').select('id').in_('property_id', property_ids).execute()
                remaining = len(verification.data) if verification.data else 0
                if remaining > 0:
                    logger.error(f"   ❌ VERIFICATION FAILED: {remaining} property vectors still remain!")
                    return False
                else:
                    logger.info(f"   ✅ VERIFICATION PASSED: No property vectors remaining")
            else:
                logger.info(f"   ✅ No properties found, so no property vectors to delete")
            return True
        except Exception as e:
            logger.error(f"❌ Error deleting property vectors: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def delete_supabase_processing_history(self, document_id):
        """Delete processing history from Supabase"""
        try:
            supabase = self._get_supabase_client()
            logger.info(f"🔍 Querying document_processing_history for document_id: {document_id}")
            
            # First check what exists
            check_result = supabase.table('document_processing_history').select('id').eq('document_id', document_id).execute()
            count_before = len(check_result.data) if check_result.data else 0
            logger.info(f"   Found {count_before} processing history entries to delete")
            
            if count_before == 0:
                logger.info(f"   ✅ No processing history to delete (clean)")
                return True
            
            # Delete them
            result = supabase.table('document_processing_history').delete().eq('document_id', document_id).execute()
            logger.info(f"   ✅ Deleted {count_before} processing history entries for document {document_id}")
            return True
        except Exception as e:
            logger.error(f"❌ Error deleting processing history: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def delete_supabase_document(self, document_id, business_id):
        """Delete document record from Supabase documents table"""
        try:
            supabase = self._get_supabase_client()
            logger.info(f"🔍 Querying documents table for document_id: {document_id}, business_id: {business_id}")
            
            # First check if it exists
            check_result = supabase.table('documents').select('id').eq('id', document_id).eq('business_id', business_id).execute()
            exists = len(check_result.data) > 0 if check_result.data else False
            logger.info(f"   Document exists in Supabase: {exists}")
            
            if not exists:
                logger.info(f"   ✅ Document not in Supabase (already deleted or never synced)")
                return True
            
            # Delete it
            result = supabase.table('documents').delete().eq('id', document_id).eq('business_id', business_id).execute()
            logger.info(f"   ✅ Deleted document {document_id} from Supabase documents table")
            logger.info(f"   Delete response: {result}")
            return True
        except Exception as e:
            logger.error(f"❌ Error deleting document from Supabase: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def delete_supabase_document_access_logs(self, document_id):
        """Delete document access logs from Supabase"""
        try:
            supabase = self._get_supabase_client()
            logger.info(f"🔍 Querying document_access_logs for document_id: {document_id}")
            
            # First check what exists
            check_result = supabase.table('document_access_logs').select('id').eq('document_id', document_id).execute()
            count_before = len(check_result.data) if check_result.data else 0
            logger.info(f"   Found {count_before} document access log entries to delete")
            
            if count_before == 0:
                logger.info(f"   ✅ No document access logs to delete (clean)")
                return True
            
            # Delete them
            result = supabase.table('document_access_logs').delete().eq('document_id', document_id).execute()
            logger.info(f"   ✅ Deleted {count_before} document access log entries for document {document_id}")
            return True
        except Exception as e:
            logger.error(f"❌ Error deleting document access logs: {e}")
            import traceback
            traceback.print_exc()
            return False
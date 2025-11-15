import logging
from datetime import datetime

from .supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)

class SupabaseDocumentService:
    """Document service using Supabase as primary database"""
    
    def __init__(self):
        self.supabase = get_supabase_client()
    
    def get_documents_for_business(self, business_id, limit=100):
        """Get all documents for a business from Supabase"""
        try:
            if not business_id:
                logger.warning("SupabaseDocumentService.get_documents_for_business called with empty business_id")
                return []

            result = (
                self.supabase
                .table('documents')
                .select('*')
                .eq('business_uuid', str(business_id))
                .order('created_at', desc=True)
                .limit(limit)
                .execute()
            )
            return result.data if result.data else []
        except Exception as e:
            logger.error(f"Error fetching documents from Supabase: {e}")
            return []
    
    def get_document_by_id(self, document_id):
        """Get a specific document by ID from Supabase"""
        try:
            result = self.supabase.table('documents').select('*').eq('id', document_id).execute()
            if result.data:
                return result.data[0]
            return None
        except Exception as e:
            logger.error(f"Error fetching document from Supabase: {e}")
            return None
    
    def create_document(self, document_data):
        """Create a new document in Supabase"""
        try:
            result = self.supabase.table('documents').insert(document_data).execute()
            if result.data:
                return result.data[0]
            return None
        except Exception as e:
            logger.error(f"Error creating document in Supabase: {e}")
            return None
    
    def update_document(self, document_id, document_data):
        """Update document in Supabase"""
        try:
            result = self.supabase.table('documents').update(document_data).eq('id', document_id).execute()
            if result.data:
                return result.data[0]
            return None
        except Exception as e:
            logger.error(f"Error updating document in Supabase: {e}")
            return None
    
    def delete_document(self, document_id):
        """Delete document from Supabase"""
        try:
            result = self.supabase.table('documents').delete().eq('id', document_id).execute()
            return True
        except Exception as e:
            logger.error(f"Error deleting document from Supabase: {e}")
            return False
    
    def get_document_status(self, document_id):
        """Get document status from Supabase"""
        try:
            result = self.supabase.table('documents').select('status, classification_type, classification_confidence').eq('id', document_id).execute()
            if result.data:
                return result.data[0]
            return None
        except Exception as e:
            logger.error(f"Error fetching document status from Supabase: {e}")
            return None
    
    def update_document_status(self, document_id, status, additional_data=None):
        """Update document status in Supabase"""
        try:
            update_data = {'status': status}
            if additional_data:
                update_data.update(additional_data)
            
            result = self.supabase.table('documents').update(update_data).eq('id', document_id).execute()
            return True
        except Exception as e:
            logger.error(f"Error updating document status in Supabase: {e}")
            return False

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
    
    def get_document_chunks(self, document_id: str) -> list:
        """
        Get all chunks for a document from document_vectors table.
        
        Args:
            document_id: Document UUID
            
        Returns:
            List of chunk dictionaries with:
            - id: Chunk UUID
            - chunk_text: Original chunk text
            - chunk_text_clean: Cleaned chunk text (for embedding)
            - chunk_index: Index of chunk in document
            - page_number: Page number where chunk appears
            - metadata: Additional chunk metadata (JSONB)
        """
        try:
            result = (
                self.supabase
                .table('document_vectors')
                .select('id, chunk_text, chunk_text_clean, chunk_index, page_number, metadata')
                .eq('document_id', document_id)
                .order('chunk_index', desc=False)  # Order by chunk_index ascending
                .execute()
            )
            
            chunks = result.data if result.data else []
            logger.debug(f"Retrieved {len(chunks)} chunks for document {document_id[:8]}...")
            return chunks
            
        except Exception as e:
            logger.error(f"Error fetching document chunks from Supabase: {e}")
            return []
    
    def get_documents_without_embeddings(
        self, 
        business_id: str = None, 
        limit: int = None
    ) -> list:
        """
        Get documents that need backfilling (missing document_embedding or summary_text).
        
        Args:
            business_id: Optional business UUID to filter by
            limit: Optional limit on number of documents to return
            
        Returns:
            List of document dictionaries that need backfilling
        """
        try:
            query = (
                self.supabase
                .table('documents')
                .select('*')
                .or_('document_embedding.is.null,summary_text.is.null')
            )
            
            # Filter by business_id if provided
            if business_id:
                # Check if business_id is UUID format
                try:
                    from uuid import UUID
                    UUID(business_id)
                    # It's a UUID, use business_uuid field
                    query = query.eq('business_uuid', business_id)
                except (ValueError, TypeError):
                    # Not a UUID, use business_id field
                    query = query.eq('business_id', business_id)
            
            # Order by created_at (oldest first for backfilling)
            query = query.order('created_at', desc=False)
            
            # Apply limit if provided
            if limit:
                query = query.limit(limit)
            
            result = query.execute()
            documents = result.data if result.data else []
            
            logger.info(
                f"Found {len(documents)} documents without embeddings"
                f"{f' for business {business_id[:8]}...' if business_id else ''}"
            )
            return documents
            
        except Exception as e:
            logger.error(f"Error fetching documents without embeddings from Supabase: {e}")
            return []
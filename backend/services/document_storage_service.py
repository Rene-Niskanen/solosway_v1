"""
Document Storage Service for Supabase
Manages document metadata, processing history, and access logs
"""
import logging
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
import uuid
from supabase import Client
import json

from .supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)

class DocumentStorageService:
    """Service for managing document metadata in Supabase"""
    
    def __init__(self):
        """Initialize Supabase client"""
        self.supabase: Client = get_supabase_client()
        
        # Table names
        self.documents_table = "documents"
        self.processing_history_table = "document_processing_history"
        self.access_logs_table = "document_access_logs"
        self.relationships_table = "document_relationships"
        
        logger.info("✅ DocumentStorageService initialized with Supabase")
    
    def create_document(self, document_data: Dict[str, Any]) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Create a new document record in Supabase
        
        Args:
            document_data: Dictionary containing document information
                Required fields: original_filename, s3_path, business_id, uploaded_by_user_id
                Optional fields: file_type, file_size, status, classification_type, etc.
        
        Returns:
            Tuple of (success, document_id, error_message)
        """
        try:
            # Validate required fields
            required_fields = ['original_filename', 's3_path', 'business_id', 'uploaded_by_user_id']
            for field in required_fields:
                if field not in document_data:
                    return False, None, f"Missing required field: {field}"
            
            # Generate UUID if not provided
            if 'id' not in document_data:
                document_data['id'] = str(uuid.uuid4())
            
            # Set default values
            document_data.setdefault('status', 'uploaded')
            document_data.setdefault('created_at', datetime.utcnow().isoformat())
            document_data.setdefault('updated_at', datetime.utcnow().isoformat())
            
            # Insert document
            result = self.supabase.table(self.documents_table).insert(document_data).execute()
            
            if result.data and len(result.data) > 0:
                document_id = result.data[0]['id']
                logger.info(f"✅ Created document {document_id} for business {document_data['business_id']}")
                
                # Log document creation access
                self.log_document_access(
                    document_id=document_id,
                    user_id=document_data['uploaded_by_user_id'],
                    business_id=document_data['business_id'],
                    access_type='share',  # Using 'share' as closest to 'create'
                    access_context={'action': 'document_created', 'filename': document_data['original_filename']}
                )
                
                return True, document_id, None
            else:
                return False, None, "Failed to create document - no data returned"
                
        except Exception as e:
            logger.error(f"❌ Error creating document: {e}")
            return False, None, str(e)
    
    def get_document(self, document_id: str, business_id: str) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
        """
        Retrieve a document by ID and business_id
        
        Args:
            document_id: UUID of the document
            business_id: Business identifier for multi-tenancy
        
        Returns:
            Tuple of (success, document_data, error_message)
        """
        try:
            result = self.supabase.table(self.documents_table).select('*').eq('id', document_id).eq('business_id', business_id).execute()
            
            if result.data and len(result.data) > 0:
                document_data = result.data[0]
                logger.info(f"✅ Retrieved document {document_id}")
                
                # Log document access
                self.log_document_access(
                    document_id=document_id,
                    user_id=document_data.get('uploaded_by_user_id'),
                    business_id=business_id,
                    access_type='view'
                )
                
                return True, document_data, None
            else:
                return False, None, "Document not found"
                
        except Exception as e:
            logger.error(f"❌ Error retrieving document {document_id}: {e}")
            return False, None, str(e)
    
    def update_document_status(self, document_id: str, status: str, business_id: str = None, additional_data: Dict[str, Any] = None) -> Tuple[bool, Optional[str]]:
        """
        Update document status and optionally other fields
        
        Args:
            document_id: UUID of the document
            status: New status ('uploaded', 'processing', 'completed', 'failed', etc.)
            business_id: Business identifier for multi-tenancy (optional if already known)
            additional_data: Additional fields to update
        
        Returns:
            Tuple of (success, error_message)
        """
        try:
            # Validate status
            # All statuses must be lowercase for Supabase constraint compatibility
            valid_statuses = ['started', 'processing', 'completed', 'failed']
            if status not in valid_statuses:
                return False, f"Invalid status: {status}. Must be one of {valid_statuses}"
            
            # Prepare update data
            update_data = {
                'status': status,
                'updated_at': datetime.utcnow().isoformat()
            }
            
            # Add additional fields if provided
            if additional_data:
                update_data.update(additional_data)
            
            # Build query
            query = self.supabase.table(self.documents_table).update(update_data).eq('id', document_id)
            
            # Add business_id filter if provided
            if business_id:
                query = query.eq('business_id', business_id)
            
            result = query.execute()
            
            if result.data and len(result.data) > 0:
                logger.info(f"✅ Updated document {document_id} status to {status}")
                
                # Log processing history
                self.log_processing_step(
                    document_id=document_id,
                    step_name='status_update',
                    step_status='completed',
                    step_message=f"Status updated to {status}",
                    step_metadata=additional_data or {}
                )
                
                return True, None
            else:
                return False, "Document not found or not updated"
                
        except Exception as e:
            logger.error(f"❌ Error updating document {document_id} status: {e}")
            return False, str(e)
    
    def search_documents(self, business_id: str, filters: Dict[str, Any] = None) -> Tuple[bool, List[Dict[str, Any]], Optional[str]]:
        """
        Search documents with filters
        
        Args:
            business_id: Business identifier for multi-tenancy
            filters: Dictionary of search filters
                - search_query: Text search in filename
                - status: Filter by status
                - file_type: Filter by file type
                - limit: Maximum results (default 50)
                - offset: Offset for pagination (default 0)
        
        Returns:
            Tuple of (success, documents_list, error_message)
        """
        try:
            filters = filters or {}
            
            # Use the search_documents function we created in SQL
            result = self.supabase.rpc('search_documents', {
                'business_id_param': business_id,
                'search_query': filters.get('search_query', ''),
                'status_filter': filters.get('status'),
                'file_type_filter': filters.get('file_type'),
                'limit_count': filters.get('limit', 50),
                'offset_count': filters.get('offset', 0)
            }).execute()
            
            if result.data is not None:
                documents = result.data
                logger.info(f"✅ Found {len(documents)} documents for business {business_id}")
                return True, documents, None
            else:
                return True, [], None
                
        except Exception as e:
            logger.error(f"❌ Error searching documents for business {business_id}: {e}")
            return False, [], str(e)
    
    def log_document_access(self, document_id: str, user_id: int, business_id: str, access_type: str, access_context: Dict[str, Any] = None) -> bool:
        """
        Log document access for audit trail
        
        Args:
            document_id: UUID of the document
            user_id: User ID accessing the document
            business_id: Business identifier
            access_type: Type of access ('view', 'download', 'delete', 'process', 'share')
            access_context: Additional context information
        
        Returns:
            Success status
        """
        try:
            access_log = {
                'document_id': document_id,
                'user_id': user_id,
                'business_id': business_id,
                'access_type': access_type,
                'access_timestamp': datetime.utcnow().isoformat(),
                'access_context': access_context or {}
            }
            
            result = self.supabase.table(self.access_logs_table).insert(access_log).execute()
            
            if result.data:
                logger.info(f"✅ Logged {access_type} access for document {document_id}")
                return True
            else:
                logger.warning(f"⚠️ Failed to log access for document {document_id}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error logging document access: {e}")
            return False
    
    def log_processing_step(self, document_id: str, step_name: str, step_status: str, step_message: str = None, step_metadata: Dict[str, Any] = None, duration_seconds: int = None) -> bool:
        """
        Log document processing step
        
        Args:
            document_id: UUID of the document
            step_name: Name of the processing step
            step_status: Status of the step ('started', 'completed', 'failed')
            step_message: Optional message
            step_metadata: Additional metadata
            duration_seconds: Duration of the step
        
        Returns:
            Success status
        """
        try:
            processing_log = {
                'document_id': document_id,
                'step_name': step_name,
                'step_status': step_status,
                'step_message': step_message,
                'step_metadata': step_metadata or {},
                'started_at': datetime.utcnow().isoformat(),
                'completed_at': datetime.utcnow().isoformat() if step_status in ['completed', 'failed'] else None,
                'duration_seconds': duration_seconds
            }
            
            result = self.supabase.table(self.processing_history_table).insert(processing_log).execute()
            
            if result.data:
                logger.info(f"✅ Logged {step_name} step for document {document_id}: {step_status}")
                return True
            else:
                logger.warning(f"⚠️ Failed to log processing step for document {document_id}")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error logging processing step: {e}")
            return False
    
    def get_document_statistics(self, business_id: str) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
        """
        Get document statistics for a business
        
        Args:
            business_id: Business identifier
        
        Returns:
            Tuple of (success, statistics, error_message)
        """
        try:
            result = self.supabase.rpc('get_document_statistics', {
                'business_id_param': business_id
            }).execute()
            
            if result.data and len(result.data) > 0:
                stats = result.data[0]
                logger.info(f"✅ Retrieved statistics for business {business_id}")
                return True, stats, None
            else:
                return False, None, "No statistics found"
                
        except Exception as e:
            logger.error(f"❌ Error getting document statistics for business {business_id}: {e}")
            return False, None, str(e)
    
    def update_document_classification(self, document_id: str, classification_type: str, classification_confidence: float, business_id: str = None) -> Tuple[bool, Optional[str]]:
        """
        Update document classification information
        
        Args:
            document_id: UUID of the document
            classification_type: Type of classification ('valuation_report', 'market_appraisal', 'other_documents')
            classification_confidence: Confidence score (0.0 to 1.0)
            business_id: Business identifier for multi-tenancy
        
        Returns:
            Tuple of (success, error_message)
        """
        try:
            update_data = {
                'classification_type': classification_type,
                'classification_confidence': classification_confidence,
                'classification_timestamp': datetime.utcnow().isoformat(),
                'updated_at': datetime.utcnow().isoformat()
            }
            
            query = self.supabase.table(self.documents_table).update(update_data).eq('id', document_id)
            
            if business_id:
                query = query.eq('business_id', business_id)
            
            result = query.execute()
            
            if result.data and len(result.data) > 0:
                logger.info(f"✅ Updated classification for document {document_id}: {classification_type} ({classification_confidence})")
                
                # Log processing step
                self.log_processing_step(
                    document_id=document_id,
                    step_name='classification',
                    step_status='completed',
                    step_message=f"Classified as {classification_type} with confidence {classification_confidence}",
                    step_metadata={'classification_type': classification_type, 'confidence': classification_confidence}
                )
                
                return True, None
            else:
                return False, "Document not found or not updated"
                
        except Exception as e:
            logger.error(f"❌ Error updating document classification: {e}")
            return False, str(e)
    
    def update_document_extraction(self, document_id: str, parsed_text: str, extracted_json: Dict[str, Any], business_id: str = None) -> Tuple[bool, Optional[str]]:
        """
        Update document with parsed text and extracted JSON
        
        Args:
            document_id: UUID of the document
            parsed_text: Full parsed text content
            extracted_json: Extracted structured data
            business_id: Business identifier for multi-tenancy
        
        Returns:
            Tuple of (success, error_message)
        """
        try:
            update_data = {
                'parsed_text': parsed_text,
                'extracted_json': json.dumps(extracted_json) if isinstance(extracted_json, dict) else extracted_json,
                'updated_at': datetime.utcnow().isoformat()
            }
            
            query = self.supabase.table(self.documents_table).update(update_data).eq('id', document_id)
            
            if business_id:
                query = query.eq('business_id', business_id)
            
            result = query.execute()
            
            if result.data and len(result.data) > 0:
                logger.info(f"✅ Updated extraction data for document {document_id}")
                
                # Log processing step
                self.log_processing_step(
                    document_id=document_id,
                    step_name='extraction',
                    step_status='completed',
                    step_message=f"Extracted {len(parsed_text)} characters of text",
                    step_metadata={'text_length': len(parsed_text), 'extracted_keys': list(extracted_json.keys()) if isinstance(extracted_json, dict) else []}
                )
                
                return True, None
            else:
                return False, "Document not found or not updated"
                
        except Exception as e:
            logger.error(f"❌ Error updating document extraction: {e}")
            return False, str(e)
    
    def delete_document(self, document_id: str, business_id: str) -> Tuple[bool, Optional[str]]:
        """
        Delete a document record (cascade will handle related records)
        
        Args:
            document_id: UUID of the document
            business_id: Business identifier for multi-tenancy
        
        Returns:
            Tuple of (success, error_message)
        """
        try:
            # Log deletion access before deleting
            self.log_document_access(
                document_id=document_id,
                user_id=0,  # System deletion
                business_id=business_id,
                access_type='delete',
                access_context={'action': 'document_deleted'}
            )
            
            result = self.supabase.table(self.documents_table).delete().eq('id', document_id).eq('business_id', business_id).execute()
            
            if result.data is not None:
                logger.info(f"✅ Deleted document {document_id}")
                return True, None
            else:
                return False, "Document not found"
                
        except Exception as e:
            logger.error(f"❌ Error deleting document {document_id}: {e}")
            return False, str(e)
    
    def get_document_processing_history(self, document_id: str, business_id: str = None) -> Tuple[bool, List[Dict[str, Any]], Optional[str]]:
        """
        Get processing history for a document
        
        Args:
            document_id: UUID of the document
            business_id: Business identifier for multi-tenancy (optional)
        
        Returns:
            Tuple of (success, processing_history, error_message)
        """
        try:
            query = self.supabase.table(self.processing_history_table).select('*').eq('document_id', document_id).order('started_at')
            
            result = query.execute()
            
            if result.data is not None:
                history = result.data
                logger.info(f"✅ Retrieved {len(history)} processing steps for document {document_id}")
                return True, history, None
            else:
                return True, [], None
                
        except Exception as e:
            logger.error(f"❌ Error getting processing history for document {document_id}: {e}")
            return False, [], str(e)
    
    def get_document_access_logs(self, document_id: str, business_id: str = None, limit: int = 50) -> Tuple[bool, List[Dict[str, Any]], Optional[str]]:
        """
        Get access logs for a document
        
        Args:
            document_id: UUID of the document
            business_id: Business identifier for multi-tenancy (optional)
            limit: Maximum number of logs to return
        
        Returns:
            Tuple of (success, access_logs, error_message)
        """
        try:
            query = self.supabase.table(self.access_logs_table).select('*').eq('document_id', document_id).order('access_timestamp', desc=True).limit(limit)
            
            result = query.execute()
            
            if result.data is not None:
                logs = result.data
                logger.info(f"✅ Retrieved {len(logs)} access logs for document {document_id}")
                return True, logs, None
            else:
                return True, [], None
                
        except Exception as e:
            logger.error(f"❌ Error getting access logs for document {document_id}: {e}")
            return False, [], str(e)
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from ..models import db, DocumentProcessingHistory
import uuid

from .supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)

class ProcessingHistoryService:
    """
    Service for logging document processing pipeline events.
    Provides audit trail and debugging capabilities.
    Writes to both local PostgreSQL and Supabase for redundancy.
    """

    def __init__(self):
        """Initialize Supabase client for dual-write logging."""
        try:
            self.supabase = get_supabase_client()
            self.use_supabase = True
            logger.info("✅ ProcessingHistoryService initialized with Supabase")
        except Exception as e:
            logger.warning(f"⚠️ Failed to initialize Supabase client: {e}")
            self.supabase = None
            self.use_supabase = False
            logger.info("ProcessingHistoryService using local PostgreSQL only")

    def log_step_start(self, document_id: str, step_name: str, step_metadata: Optional[Dict[str, Any]] = None) -> str:
        """
        Log the start of the processing step.

        Args: 
            document_id: UUID of the document being processed
            step_name: Name of the processing step (Classification, Extraction, Normalization, Linking, Vectorization)
            step_metadata: Optional metadata for the step

        Returns:
            UUID of the created history record
        """

        try:
            history_id = str(uuid.uuid4())
            started_at = datetime.now(timezone.utc)
            
            # Write to Supabase first (if available)
            if self.use_supabase:
                try:
                    history_data = {
                        'id': history_id,
                        'document_id': document_id,
                        'step_name': step_name,
                        'step_status': 'started',  # FIXED: lowercase to match Supabase constraint
                        'step_message': f"Step started: {step_name}",
                        'started_at': started_at.isoformat(),
                        'step_metadata': step_metadata or {}
                    }
                    # FIXED: Handle duplicate key violations gracefully
                    try:
                        result = self.supabase.table('document_processing_history').insert(history_data).execute()
                        if result.data:
                            logger.debug(f"✅ Logged to Supabase: {step_name} start for document {document_id}")
                    except Exception as insert_error:
                        # Check if it's a duplicate key error
                        error_str = str(insert_error).lower()
                        if 'duplicate' in error_str or 'unique' in error_str or 'already exists' in error_str:
                            logger.warning(f"⚠️ Duplicate history record detected, using existing: {history_id}")
                            # Try to fetch existing record
                            try:
                                existing = self.supabase.table('document_processing_history').select('id').eq('id', history_id).execute()
                                if existing.data:
                                    logger.info(f"✅ Using existing history record: {history_id}")
                                else:
                                    # Generate new ID and retry once
                                    history_id = str(uuid.uuid4())
                                    history_data['id'] = history_id
                                    result = self.supabase.table('document_processing_history').insert(history_data).execute()
                                    if result.data:
                                        logger.info(f"✅ Retried with new ID: {history_id}")
                            except Exception as retry_error:
                                logger.warning(f"⚠️ Failed to handle duplicate key: {retry_error}")
                        else:
                            raise  # Re-raise if not a duplicate key error
                except Exception as e:
                    logger.warning(f"⚠️ Failed to log to Supabase (non-fatal): {e}")
            
            # Write to local PostgreSQL (with duplicate handling)
            try:
                history_record = DocumentProcessingHistory(
                    id=history_id,
                    document_id=document_id,
                    step_name=step_name,
                    step_status='started',
                    step_message=f"Step started: {step_name}",
                    started_at=started_at,
                    step_metadata=step_metadata or {}
                )

                db.session.add(history_record)
                db.session.commit()
            except Exception as db_error:
                # Handle duplicate key in local DB
                error_str = str(db_error).lower()
                if 'duplicate' in error_str or 'unique' in error_str or 'already exists' in error_str:
                    logger.warning(f"⚠️ Duplicate history record in local DB, checking existing...")
                    db.session.rollback()
                    # Try to find existing record
                    existing = DocumentProcessingHistory.query.filter_by(
                        document_id=document_id,
                        step_name=step_name,
                        step_status='started'
                    ).first()
                    if existing:
                        history_id = str(existing.id)
                        logger.info(f"✅ Using existing history record: {history_id}")
                    else:
                        # Generate new ID and retry
                        history_id = str(uuid.uuid4())
                        history_record = DocumentProcessingHistory(
                            id=history_id,
                            document_id=document_id,
                            step_name=step_name,
                            step_status='started',
                            step_message=f"Step started: {step_name}",
                            started_at=started_at,
                            step_metadata=step_metadata or {}
                        )
                        db.session.add(history_record)
                        db.session.commit()
                else:
                    raise  # Re-raise if not a duplicate key error

            logger.info(f"✅ Logged start of {step_name} step for document {document_id}")
            return history_id

        except Exception as e:
            logger.error(f"❌ Error logging start of {step_name} step for document {document_id}: {e}")
            db.session.rollback()
            # FIXED: Return None but log as non-fatal (pipeline should continue)
            logger.warning(f"⚠️ History logging failed but continuing pipeline (non-fatal)")
            return None

    def log_step_completion(self, history_id: str, step_message: str = None, step_metadata: Optional[Dict[str, Any]] = None) -> bool:
        """
        Log the successful completion of the processing step

        Args:
            history_id: UUID of the history record
            step_message: Optional message 
            step_metadata: Optional additional metadata

        Returns:
            Success status
        """
        # FIXED: Handle None history_id gracefully (non-fatal)
        if not history_id:
            logger.warning(f"⚠️ Cannot log step completion: history_id is None (non-fatal, continuing)")
            return False

        try:
            completed_at = datetime.now(timezone.utc)
            
            # Update Supabase first 
            if self.use_supabase:
                try:
                    update_data = {
                        'step_status': 'completed',  # FIXED: lowercase to match Supabase constraint
                        'completed_at': completed_at.isoformat(),
                        'step_message': step_message or f"Successfully completed step"
                    }
                    if step_metadata:
                        update_data['step_metadata'] = step_metadata
                    
                    result = self.supabase.table('document_processing_history').update(update_data).eq('id', history_id).execute()
                    if result.data:
                        logger.debug(f"✅ Updated completion in Supabase for history {history_id}")
                except Exception as e:
                    logger.warning(f"⚠️ Failed to update Supabase (non-fatal): {e}")
            
            # Update local PostgreSQL
            history_record = DocumentProcessingHistory.query.get(history_id)
            if not history_record:
                logger.warning(f"⚠️ History record not found: {history_id} (non-fatal, continuing)")
                return False

            history_record.step_status = 'completed'  # Lowercase to match Supabase constraint
            history_record.completed_at = completed_at
            started_at = history_record.started_at.replace(tzinfo=None)
            completed_at_naive = completed_at.replace(tzinfo=None)
            history_record.duration_seconds = int((completed_at_naive - started_at).total_seconds())

            if step_message:
                history_record.step_message = step_message
            else:
                history_record.step_message = f"successfully completed {history_record.step_name} step"

            # update metadata if provided
            if step_metadata:
                current_metadata = history_record.step_metadata or {}
                current_metadata.update(step_metadata)
                history_record.step_metadata = current_metadata

            db.session.commit()

            logger.info(f"✅ Logged completion of {history_record.step_name} step for document {history_record.document_id}")
            return True

        except Exception as e:
            logger.error(f"❌ Error logging completion: {e}")
            db.session.rollback()
            return False

    
    def log_step_failure(self, history_id: str, error_message: str, step_metadata: Optional[Dict[str, Any]] = None) -> bool:
        """
        Log the failure of a processing step

        Args:
            history_id: UUID of the history record
            error_message: Error details
            step_metadata: Optional additional metadata
        """

        try:
            completed_at = datetime.now(timezone.utc)
            
            # Update Supabase first (if available)
            if self.use_supabase:
                try:
                    update_data = {
                        'step_status': 'failed',  # FIXED: lowercase to match Supabase constraint
                        'completed_at': completed_at.isoformat(),
                        'step_message': f"Failed: {error_message}"
                    }
                    if step_metadata:
                        update_data['step_metadata'] = step_metadata
                    
                    result = self.supabase.table('document_processing_history').update(update_data).eq('id', history_id).execute()
                    if result.data:
                        logger.debug(f"✅ Updated failure in Supabase for history {history_id}")
                except Exception as e:
                    logger.warning(f"⚠️ Failed to update Supabase (non-fatal): {e}")
            
            # Update local PostgreSQL
            history_record = DocumentProcessingHistory.query.get(history_id)
            if not history_record:
                logger.error(f"History record {history_id} not found")
                return False
            
            history_record.step_status = 'failed'  # Lowercase to match Supabase constraint
            history_record.completed_at = completed_at
            started_at = history_record.started_at.replace(tzinfo=None)
            completed_at_naive = completed_at.replace(tzinfo=None)
            history_record.duration_seconds = int((completed_at_naive - started_at).total_seconds())
            history_record.step_message = f"Failed to complete {history_record.step_name} step: {error_message}"
            
            # Update metadata if provided
            if step_metadata:
                current_metadata = history_record.step_metadata or {}
                current_metadata.update(step_metadata)
                history_record.step_metadata = current_metadata
            
            db.session.commit()
            
            logger.error(f"❌ Logged step failure: {history_record.step_name} - {error_message}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to log step failure: {e}")
            db.session.rollback()
            return False
    
    def log_step_retry(self, history_id: str, retry_count: int, 
                      retry_reason: str = None) -> bool:
        """
        Log a retry attempt for a processing step.
        
        Args:
            history_id: UUID of the history record to update
            retry_count: Number of retry attempts
            retry_reason: Optional reason for retry
            
        Returns:
            Success status
        """
        try:
            history_record = DocumentProcessingHistory.query.get(history_id)
            if not history_record:
                logger.error(f"History record {history_id} not found")
                return False
            
            history_record.step_status = 'retry'  # Lowercase to match Supabase constraint
            history_record.step_message = f"Retry attempt {retry_count}: {retry_reason or 'Unknown reason'}"
            
            # Update metadata with retry info
            current_metadata = history_record.step_metadata or {}
            current_metadata.update({
                'retry_count': retry_count,
                'retry_reason': retry_reason,
                'last_retry_at': datetime.utcnow().isoformat()
            })
            history_record.step_metadata = current_metadata
            
            db.session.commit()
            
            logger.warning(f"🔄 Logged step retry: {history_record.step_name} (attempt {retry_count})")
            return True
            
        except Exception as e:
            logger.error(f"Failed to log step retry: {e}")
            db.session.rollback()
            return False
    
    def get_document_processing_history(self, document_id: str) -> list:
        """
        Get complete processing history for a document.
        Tries Supabase first, falls back to PostgreSQL.
        
        Args:
            document_id: UUID of the document
            
        Returns:
            List of processing history records
        """
        # Try Supabase first (primary source)
        if self.use_supabase:
            try:
                result = self.supabase.table('document_processing_history')\
                    .select('*')\
                    .eq('document_id', document_id)\
                    .order('started_at')\
                    .execute()
                
                if result.data:
                    # Convert Supabase format to serialized format
                    history = []
                    for record in result.data:
                        history.append({
                            'id': record.get('id'),
                            'document_id': record.get('document_id'),
                            'step_name': record.get('step_name'),
                            'step_status': record.get('step_status', '').lower(),
                            'step_message': record.get('step_message'),
                            'step_metadata': record.get('step_metadata', {}),
                            'started_at': record.get('started_at'),
                            'completed_at': record.get('completed_at'),
                            'duration_seconds': record.get('duration_seconds')
                        })
                    logger.debug(f"✅ Retrieved {len(history)} history records from Supabase for document {document_id}")
                    return history
            except Exception as e:
                logger.warning(f"⚠️ Failed to get history from Supabase: {e}, falling back to PostgreSQL")
        
        # Fallback to PostgreSQL
        try:
            history_records = DocumentProcessingHistory.query.filter_by(
                document_id=document_id
            ).order_by(DocumentProcessingHistory.started_at.asc()).all()
            
            return [record.serialize() for record in history_records]
            
        except Exception as e:
            logger.error(f"Failed to get processing history from PostgreSQL: {e}")
            return []
    
    def get_processing_statistics(self, business_id: str = None) -> Dict[str, Any]:
        """
        Get processing statistics across all documents or for a specific business.
        
        Args:
            business_id: Optional business ID to filter by
            
        Returns:
            Dictionary with processing statistics
        """
        try:
            from ..models import Document
            
            # Base query
            query = db.session.query(DocumentProcessingHistory)
            
            if business_id:
                # Join with documents table to filter by business_id
                query = query.join(Document).filter(Document.business_id == business_id)
            
            all_records = query.all()
            
            if not all_records:
                return {
                    'total_steps': 0,
                    'success_rate': 0,
                    'average_duration': 0,
                    'by_step': {},
                    'by_status': {}
                }
            
            # Calculate statistics
            total_steps = len(all_records)
            successful_steps = len([r for r in all_records if r.step_status.lower() == 'completed'])
            failed_steps = len([r for r in all_records if r.step_status.lower() == 'failed'])
            
            # Average duration (only for completed steps)
            completed_steps = [r for r in all_records if r.duration_seconds is not None]
            avg_duration = sum(r.duration_seconds for r in completed_steps) / len(completed_steps) if completed_steps else 0
            
            # Statistics by step
            by_step = {}
            for record in all_records:
                step_name = record.step_name
                if step_name not in by_step:
                    by_step[step_name] = {
                        'total': 0,
                        'completed': 0,
                        'failed': 0,
                        'average_duration': 0
                    }
                
                by_step[step_name]['total'] += 1
                if record.step_status == 'COMPLETED':
                    by_step[step_name]['completed'] += 1
                elif record.step_status == 'FAILED':
                    by_step[step_name]['failed'] += 1
            
            # Calculate success rates and durations by step
            for step_name, stats in by_step.items():
                stats['success_rate'] = stats['completed'] / stats['total'] if stats['total'] > 0 else 0
                
                step_durations = [r.duration_seconds for r in all_records 
                                if r.step_name == step_name and r.duration_seconds is not None]
                stats['average_duration'] = sum(step_durations) / len(step_durations) if step_durations else 0
            
            # Statistics by status
            by_status = {}
            for record in all_records:
                status = record.step_status
                by_status[status] = by_status.get(status, 0) + 1
            
            return {
                'total_steps': total_steps,
                'success_rate': successful_steps / total_steps if total_steps > 0 else 0,
                'failed_rate': failed_steps / total_steps if total_steps > 0 else 0,
                'average_duration': avg_duration,
                'by_step': by_step,
                'by_status': by_status
            }
            
        except Exception as e:
            logger.error(f"Failed to get processing statistics: {e}")
            return {} 

    def get_pipeline_progress(self, document_id: str) -> dict:
        """
        Get progress of document through its pipeline.
        Uses Supabase document if available, falls back to PostgreSQL.
        """
        try:
            from .supabase_document_service import SupabaseDocumentService
            
            # Define pipeline steps
            PIPELINE_STEPS = {
                'full': [
                    'classification',
                    'extraction',
                    'normalization',
                    'linking',
                    'vectorization'
                ],
                'minimal': [
                    'classification',
                    'minimal_extraction'
                ]
            }
            
            # Try to get document from Supabase first
            doc_service = SupabaseDocumentService()
            document = doc_service.get_document_by_id(document_id)
            
            # Fallback to PostgreSQL if not in Supabase
            if not document:
                try:
                    from ..models import Document
                    sqlalchemy_doc = Document.query.get(document_id)
                    if sqlalchemy_doc:
                        document = {
                            'id': str(sqlalchemy_doc.id),
                            'classification_type': sqlalchemy_doc.classification_type,
                            'status': sqlalchemy_doc.status.value if sqlalchemy_doc.status else 'unknown'
                        }
                except Exception as e:
                    logger.warning(f"⚠️ Could not get document from PostgreSQL: {e}")
            
            if not document:
                return {'error': 'Document not found'}
                
            history = self.get_document_processing_history(document_id)
            
            # Determine pipeline type based on classification
            classification_type = document.get('classification_type') if isinstance(document, dict) else getattr(document, 'classification_type', None)
            pipeline_type = 'full' if classification_type in ['valuation_report', 'market_appraisal'] else 'minimal'
            steps = PIPELINE_STEPS[pipeline_type]
            
            # Calculate progress
            completed_steps = [h for h in history if h.get('step_status', '').lower() == 'completed']
            failed_steps = [h for h in history if h.get('step_status', '').lower() == 'failed']
            
            # Get status
            status = document.get('status') if isinstance(document, dict) else (document.status.value if hasattr(document, 'status') and document.status else 'unknown')
            
            return {
                'pipeline_type': pipeline_type,
                'total_steps': len(steps),
                'completed_steps': len(completed_steps),
                'failed_steps': len(failed_steps),
                'current_step': status,
                'steps': steps,
                'history': history
            }
            
        except Exception as e:
            logger.error(f"Error getting pipeline progress: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return {'error': str(e)}


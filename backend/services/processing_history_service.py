import os
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from ..models import db, DocumentProcessingHistory
import uuid

logger = logging.getLogger(__name__)

class ProcessingHistoryService:
    """
    Service for logging document processing pipeline events.
    Provides audit trail and debugging capabilities.
    Writes to both local PostgreSQL and Supabase for redundancy.
    """

    def __init__(self):
        # Initialize Supabase client for dual-write
        self.supabase_url = os.environ.get('SUPABASE_URL')
        self.supabase_key = os.environ.get('SUPABASE_SERVICE_KEY')
        
        if self.supabase_url and self.supabase_key:
            try:
                from supabase import create_client, Client
                self.supabase: Client = create_client(self.supabase_url, self.supabase_key)
                self.use_supabase = True
                logger.info("✅ ProcessingHistoryService initialized with Supabase")
            except Exception as e:
                logger.warning(f"⚠️ Failed to initialize Supabase client: {e}")
                self.supabase = None
                self.use_supabase = False
        else:
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
                    result = self.supabase.table('document_processing_history').insert(history_data).execute()
                    if result.data:
                        logger.debug(f"✅ Logged to Supabase: {step_name} start for document {document_id}")
                except Exception as e:
                    logger.warning(f"⚠️ Failed to log to Supabase (non-fatal): {e}")
            
            # Write to local PostgreSQL
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

            logger.info(f"✅ Logged start of {step_name} step for document {document_id}")
            return history_id

        except Exception as e:
            logger.error(f"❌ Error logging start of {step_name} step for document {document_id}: {e}")
            db.session.rollback()
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
                logger.error(f"❌ History record not found: {history_id}")
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
        
        Args:
            document_id: UUID of the document
            
        Returns:
            List of processing history records
        """
        try:
            history_records = DocumentProcessingHistory.query.filter_by(
                document_id=document_id
            ).order_by(DocumentProcessingHistory.started_at.asc()).all()
            
            return [record.serialize() for record in history_records]
            
        except Exception as e:
            logger.error(f"Failed to get processing history: {e}")
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
        """Get progress of document through its pipeline"""
        try:
            from ..models import Document
            
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
            
            document = Document.query.get(document_id)
            if not document:
                return {'error': 'Document not found'}
                
            history = self.get_document_processing_history(document_id)
            
            # Determine pipeline type based on classification
            pipeline_type = 'full' if document.classification_type in ['valuation_report', 'market_appraisal'] else 'minimal'
            steps = PIPELINE_STEPS[pipeline_type]
            
            # Calculate progress
            completed_steps = [h for h in history if h['step_status'].lower() == 'completed']
            failed_steps = [h for h in history if h['step_status'].lower() == 'failed']
            
            return {
                'pipeline_type': pipeline_type,
                'total_steps': len(steps),
                'completed_steps': len(completed_steps),
                'failed_steps': len(failed_steps),
                'current_step': document.status.value if document.status else 'unknown',
                'steps': steps,
                'history': history
            }
            
        except Exception as e:
            logger.error(f"Error getting pipeline progress: {e}")
            return {'error': str(e)}


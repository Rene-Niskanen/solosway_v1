"""
Background context generation tasks for Celery.

These tasks generate document-level and chunk-level contexts asynchronously
using the local embedding service, allowing document uploads to return immediately.
"""

from celery import shared_task
import os
import logging
from typing import Dict, Any, List

logger = logging.getLogger(__name__)


@shared_task(bind=True, name="generate_document_context")
def generate_document_context_task(self, document_id: str, document_text: str, metadata: Dict[str, Any]):
    """
    Generate document-level context in background (HIGH priority).
    
    This task:
    1. Uses LocalEmbeddingService to generate document summary
    2. Stores result in documents.document_summary (JSONB)
    3. Takes ~0.2-0.5s per document
    4. Cost: $0 (local processing)
    
    Args:
        document_id: Document UUID
        document_text: Full document text
        metadata: Document metadata (business_id, classification_type, etc.)
    
    Returns:
        bool: Success status
    """
    from backend import create_app
    app = create_app()
    
    with app.app_context():
        try:
            logger.info(f"🔄 Generating document context for {document_id}")
            
            # Use LocalEmbeddingService for context generation (singleton for scalability)
            from backend.services.local_embedding_service import get_default_service
            local_service = get_default_service()
            
            if not local_service.is_local_available():
                logger.warning(f"⚠️ Local embedding service not available for document {document_id}, skipping context generation")
                # Fallback to DocumentContextService (which will try Anthropic or simple extraction)
                from backend.services.document_context_service import DocumentContextService
                context_service = DocumentContextService()
                context = context_service.generate_document_summary(document_text, metadata)
            else:
                # Generate context using local service
                context = local_service.generate_document_context(document_text, metadata)
            
            # Store in documents.document_summary
            from backend.services.document_storage_service import DocumentStorageService
            doc_storage = DocumentStorageService()
            
            business_id = metadata.get('business_id')
            if not business_id:
                logger.error(f"business_id not provided in metadata for document {document_id}")
                return False
            
            success, error = doc_storage.update_document_summary(
                document_id=document_id,
                business_id=business_id,
                updates={
                    **context,  # AI-generated summary fields
                    'document_entities': context.get('top_entities', []),
                    'document_tags': context.get('document_tags', [])
                },
                merge=True  # Merge with existing data (preserves Reducto data)
            )
            
            if success:
                logger.info(f"✅ Document context generated and stored for {document_id}")
                return True
            else:
                logger.error(f"❌ Failed to store document context for {document_id}: {error}")
                return False
            
        except Exception as e:
            logger.error(f"❌ Document context generation failed for {document_id}: {e}")
            import traceback
            logger.debug(traceback.format_exc())
            return False


@shared_task(bind=True, name="generate_chunk_contexts_batch")
def generate_chunk_contexts_batch_task(
    self, 
    document_id: str, 
    chunks_data: List[Dict[str, Any]], 
    metadata: Dict[str, Any]
):
    """
    Generate chunk contexts in batches (MEDIUM priority).
    
    This task:
    1. Processes chunks in batches of 8 (configurable)
    2. Uses LocalEmbeddingService to generate concise contexts
    3. Updates document_vectors.chunk_context for each chunk
    4. Takes ~0.1s per chunk (batched)
    5. Cost: $0 (local processing)
    
    Args:
        document_id: Document UUID
        chunks_data: List of dicts with:
            - chunk_text: The chunk text
            - chunk_index: Index of the chunk
            - metadata: Optional chunk metadata
        metadata: Document metadata (business_id, classification_type, etc.)
    
    Returns:
        bool: Success status
    """
    from backend import create_app
    app = create_app()
    
    with app.app_context():
        try:
            logger.info(f"🔄 Generating chunk contexts for document {document_id} ({len(chunks_data)} chunks)")
            
            # Extract chunks and indices
            chunks = [item['chunk_text'] for item in chunks_data]
            chunk_indices = [item['chunk_index'] for item in chunks_data]
            
            if not chunks:
                logger.warning(f"No chunks provided for document {document_id}")
                return False
            
            # Use LocalEmbeddingService (singleton for scalability)
            from backend.services.local_embedding_service import get_default_service
            local_service = get_default_service()
            
            if not local_service.is_local_available():
                logger.warning(f"⚠️ Local embedding service not available for document {document_id}, skipping chunk context generation")
                # Return empty contexts (graceful degradation)
                contexts = [""] * len(chunks)
            else:
                # Generate contexts in batches
                batch_size = int(os.getenv('CHUNK_CONTEXT_BATCH_SIZE', '8'))
                contexts = local_service.generate_chunk_contexts_batch(
                    chunks=chunks,
                    metadata=metadata,
                    batch_size=batch_size
                )
                
                # Ensure we have the same number of contexts as chunks
                if len(contexts) != len(chunks):
                    logger.warning(
                        f"Context count mismatch: expected {len(chunks)}, got {len(contexts)}. "
                        f"Padding with empty strings."
                    )
                    while len(contexts) < len(chunks):
                        contexts.append("")
                    contexts = contexts[:len(chunks)]  # Truncate if too many
            
            # Update document_vectors.chunk_context
            from backend.services.vector_service import SupabaseVectorService
            vector_service = SupabaseVectorService()
            
            # Create dict mapping chunk_index to context
            chunk_contexts_dict = dict(zip(chunk_indices, contexts))
            
            success = vector_service.update_chunk_contexts(
                document_id=document_id,
                chunk_contexts=chunk_contexts_dict
            )
            
            if success:
                successful_contexts = len([c for c in contexts if c])
                logger.info(
                    f"✅ Generated {successful_contexts}/{len(chunks)} chunk contexts for document {document_id}"
                )
                return True
            else:
                logger.error(f"❌ Failed to update chunk contexts for document {document_id}")
                return False
            
        except Exception as e:
            logger.error(f"❌ Chunk context generation failed for document {document_id}: {e}")
            import traceback
            logger.debug(traceback.format_exc())
            return False


@shared_task(bind=True, name="generate_embeddings_after_context")
def generate_embeddings_after_context_task(self, document_id: str, metadata: Dict[str, Any] = None):
    """
    Generate embeddings for chunks after context is ready (LOW priority).
    
    This task:
    1. Waits for context to be generated (chunks should have chunk_context)
    2. Uses existing embed_document_chunks_lazy task to generate embeddings
    3. Updates document_vectors.embedding for pending chunks
    4. Takes ~0.1-0.2s per chunk (batched)
    5. Cost: $0 (local processing) or Voyage API cost
    
    Args:
        document_id: Document UUID
        metadata: Optional document metadata (for logging)
    
    Returns:
        bool: Success status
    """
    from backend import create_app
    app = create_app()
    
    with app.app_context():
        try:
            logger.info(f"🔄 Generating embeddings for document {document_id} (after context)")
            
            # Use existing lazy embedding task (already implemented!)
            # Import here to avoid circular imports
            from backend.tasks import embed_document_chunks_lazy
            
            # Call the task synchronously within this task context
            # This ensures proper error handling and logging
            try:
                # Check if there are pending chunks first
                from backend.services.supabase_client_factory import get_supabase_client
                supabase = get_supabase_client()
                
                result = supabase.table('document_vectors').select('id, embedding_status').eq(
                    'document_id', document_id
                ).in_('embedding_status', ['pending', 'queued']).execute()
                
                if not result.data:
                    logger.info(f"✅ No pending chunks for document {document_id} (already embedded)")
                    return True
                
                pending_count = len(result.data)
                logger.info(f"Found {pending_count} pending chunks for document {document_id}")
                
                # Queue the existing lazy embedding task
                # This will handle batch embedding of all pending chunks
                # Use .delay() to queue it as a separate task (allows proper task tracking)
                try:
                    task_result = embed_document_chunks_lazy.delay(str(document_id), priority='normal')
                    logger.info(
                        f"✅ Queued embedding generation task {task_result.id} for {pending_count} chunks in document {document_id}"
                    )
                    return True
                except Exception as task_error:
                    logger.error(
                        f"❌ Failed to queue embed_document_chunks_lazy task for {document_id}: {task_error}"
                    )
                    import traceback
                    logger.debug(traceback.format_exc())
                    # Try using apply_async as fallback
                    try:
                        logger.warning(f"⚠️ Attempting apply_async fallback for embed_document_chunks_lazy...")
                        task_result = embed_document_chunks_lazy.apply_async(
                            args=[str(document_id)],
                            kwargs={'priority': 'normal'}
                        )
                        logger.info(
                            f"✅ Successfully queued via apply_async: task {task_result.id} for {pending_count} chunks in document {document_id}"
                        )
                        return True
                    except Exception as async_error:
                        logger.error(f"❌ apply_async fallback also failed: {async_error}")
                        logger.debug(traceback.format_exc())
                        return False
                    
            except Exception as e:
                logger.error(f"❌ Failed to generate embeddings for {document_id}: {e}")
                import traceback
                logger.debug(traceback.format_exc())
                return False
            
        except Exception as e:
            logger.error(f"❌ Embedding generation task failed for {document_id}: {e}")
            import traceback
            logger.debug(traceback.format_exc())
            return False


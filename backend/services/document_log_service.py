"""
Document Log Service - Real-time log capture using Redis

Stores processing log messages for documents so the frontend can display
real-time progress information similar to what appears in backend worker logs.

Uses Redis for fast read/write with automatic TTL expiration.
"""

import redis
import json
import os
import logging
from datetime import datetime
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)


class DocumentLogService:
    """
    Service for storing and retrieving real-time document processing logs.
    
    Uses Redis lists to store log messages with automatic expiration.
    Each document has its own log stream that expires after 1 hour.
    """
    
    def __init__(self):
        """Initialize Redis connection."""
        redis_host = os.environ.get('REDIS_HOST', 'redis')
        redis_port = int(os.environ.get('REDIS_PORT', 6379))
        redis_db = int(os.environ.get('REDIS_LOG_DB', 1))  # Use DB 1 for logs (separate from Celery)
        
        try:
            self.redis = redis.Redis(
                host=redis_host,
                port=redis_port,
                db=redis_db,
                decode_responses=True  # Return strings instead of bytes
            )
            # Test connection
            self.redis.ping()
            self._available = True
            logger.debug(f"DocumentLogService connected to Redis at {redis_host}:{redis_port} db={redis_db}")
        except Exception as e:
            logger.warning(f"DocumentLogService: Redis not available ({e}), logs will not be stored")
            self._available = False
            self.redis = None
        
        self.TTL = 3600  # 1 hour expiry
        self.MAX_LOGS = 100  # Keep last 100 messages per document
    
    def _get_key(self, document_id: str) -> str:
        """Get Redis key for a document's log stream."""
        return f"doc:logs:{document_id}"
    
    def emit(self, document_id: str, message: str, stage: Optional[str] = None, 
             level: str = "info", metadata: Optional[Dict] = None) -> bool:
        """
        Emit a log message for a document.
        
        Args:
            document_id: The document UUID
            message: The log message text
            stage: Processing stage (e.g., 'parsing', 'embedding', 'storage')
            level: Log level ('info', 'warning', 'error', 'success')
            metadata: Optional additional data (e.g., chunk_count, job_id)
        
        Returns:
            True if successfully stored, False otherwise
        """
        if not self._available:
            return False
        
        try:
            key = self._get_key(document_id)
            entry = {
                'timestamp': datetime.utcnow().isoformat() + 'Z',
                'message': message,
                'stage': stage,
                'level': level
            }
            if metadata:
                entry['metadata'] = metadata
            
            # Push to list (newest first)
            self.redis.lpush(key, json.dumps(entry))
            
            # Trim to keep only last N messages
            self.redis.ltrim(key, 0, self.MAX_LOGS - 1)
            
            # Set/refresh TTL
            self.redis.expire(key, self.TTL)
            
            logger.debug(f"[DOC_LOG] {document_id[:8]}: [{stage or 'general'}] {message}")
            return True
            
        except Exception as e:
            logger.warning(f"DocumentLogService.emit failed: {e}")
            return False
    
    def get_logs(self, document_id: str, limit: int = 20) -> List[Dict]:
        """
        Get recent log messages for a document.
        
        Args:
            document_id: The document UUID
            limit: Maximum number of messages to return (default 20)
        
        Returns:
            List of log entries, oldest first (chronological order)
        """
        if not self._available:
            return []
        
        try:
            key = self._get_key(document_id)
            # Get entries (stored newest first, so we reverse for chronological order)
            entries = self.redis.lrange(key, 0, limit - 1)
            
            # Parse and reverse to get chronological order
            logs = []
            for entry_str in reversed(entries):
                try:
                    logs.append(json.loads(entry_str))
                except json.JSONDecodeError:
                    continue
            
            return logs
            
        except Exception as e:
            logger.warning(f"DocumentLogService.get_logs failed: {e}")
            return []
    
    def clear_logs(self, document_id: str) -> bool:
        """
        Clear all logs for a document.
        
        Args:
            document_id: The document UUID
        
        Returns:
            True if successful, False otherwise
        """
        if not self._available:
            return False
        
        try:
            key = self._get_key(document_id)
            self.redis.delete(key)
            return True
        except Exception as e:
            logger.warning(f"DocumentLogService.clear_logs failed: {e}")
            return False
    
    def is_available(self) -> bool:
        """Check if the service is available (Redis connected)."""
        return self._available


# Singleton instance for easy importing
_log_service_instance = None

def get_document_log_service() -> DocumentLogService:
    """Get the singleton DocumentLogService instance."""
    global _log_service_instance
    if _log_service_instance is None:
        _log_service_instance = DocumentLogService()
    return _log_service_instance


# Convenience function for quick logging
def emit_doc_log(document_id: str, message: str, stage: Optional[str] = None,
                 level: str = "info", metadata: Optional[Dict] = None) -> bool:
    """
    Quick helper to emit a document log message.
    
    Usage:
        from backend.services.document_log_service import emit_doc_log
        emit_doc_log(doc_id, "Uploading to Reducto (4.07MB)", "parsing")
    """
    service = get_document_log_service()
    return service.emit(document_id, message, stage, level, metadata)

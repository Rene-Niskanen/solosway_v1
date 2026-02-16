"""
Track Celery task IDs per document so we can revoke processing when the user deletes a file.
Uses Redis; no-op if Redis is unavailable.
"""

import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

REDIS_KEY_PREFIX = "doc_processing_task:"
TTL = 3600  # 1 hour


def _get_redis():
    """Return Redis client or None if unavailable."""
    try:
        import redis
        redis_host = os.environ.get('REDIS_HOST', 'redis')
        redis_port = int(os.environ.get('REDIS_PORT', 6379))
        r = redis.Redis(host=redis_host, port=redis_port, db=0, decode_responses=True)
        r.ping()
        return r
    except Exception as e:
        logger.debug(f"Document processing task tracking: Redis not available ({e})")
        return None


def set_document_processing_task_id(document_id: str, task_id: str) -> None:
    """Store the Celery task ID for a document so it can be revoked on delete."""
    r = _get_redis()
    if r is None:
        return
    try:
        key = f"{REDIS_KEY_PREFIX}{document_id}"
        r.set(key, task_id, ex=TTL)
        logger.debug(f"Stored processing task_id {task_id} for document {document_id}")
    except Exception as e:
        logger.warning(f"Failed to store document processing task_id: {e}")


def get_and_clear_document_processing_task_id(document_id: str) -> Optional[str]:
    """Return the task ID for the document and remove it from Redis. Returns None if not found or Redis unavailable."""
    r = _get_redis()
    if r is None:
        return None
    try:
        key = f"{REDIS_KEY_PREFIX}{document_id}"
        task_id = r.get(key)
        if task_id:
            r.delete(key)
            return task_id
        return None
    except Exception as e:
        logger.warning(f"Failed to get/clear document processing task_id: {e}")
        return None


def clear_document_processing_task_id(document_id: str) -> None:
    """Remove the stored task ID for a document (e.g. when task completes)."""
    r = _get_redis()
    if r is None:
        return
    try:
        key = f"{REDIS_KEY_PREFIX}{document_id}"
        r.delete(key)
    except Exception as e:
        logger.debug(f"Failed to clear document processing task_id: {e}")

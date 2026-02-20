"""
Shared store for incremental citation events during streaming.

Views creates a buffer list and registers it with a unique key; passes the key in config.
The responder node looks up the buffer by key and appends citation events.
This avoids config being deep-copied so the responder would append to a different list.
"""
import threading
import uuid
import logging

logger = logging.getLogger(__name__)

# Key -> list (buffer of citation events to yield to client)
_buffers: dict[str, list] = {}
_lock = threading.Lock()


def register_buffer(buffer: list) -> str:
    """Register a buffer list; return a unique key to pass in config."""
    key = str(uuid.uuid4())
    with _lock:
        _buffers[key] = buffer
    return key


def get_buffer(key: str | None):
    """Return the buffer list for this key, or None."""
    if not key:
        return None
    with _lock:
        return _buffers.get(key)


def unregister_buffer(key: str) -> None:
    """Remove the buffer from the store (call when stream ends to avoid leak)."""
    with _lock:
        _buffers.pop(key, None)

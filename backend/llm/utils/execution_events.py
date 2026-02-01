"""
Execution Event System - Reusable across all agents.

This module provides:
- ExecutionEvent schema (what users see, not internal reasoning)
- ExecutionEventEmitter (manages event collection and queue-based streaming)

Key Design Principles:
- Tools receive emitter explicitly (not via state) - framework agnostic
- Events are action-only (no "decision" type, use "phase" for high-level markers)
- Pre/post events are linked via parent_event_id
- Streaming uses queue (not callbacks) for reliability
"""

from dataclasses import dataclass, field
from typing import Literal, Dict, Optional, List
import time
import uuid
from queue import Queue
import logging
import threading

logger = logging.getLogger(__name__)


@dataclass
class ReasoningEvent:
    """
    User-facing reasoning event - intent-level actions (Cursor-style).
    
    This is what users see, NOT internal tool names or prompts.
    Examples:
    - "Checked letter of offer for vendor agent details"
    - "Searched relevant sections"
    - "No vendor agents found in document"
    """
    label: str  # Short human-readable action (e.g., "Checked letter of offer")
    detail: Optional[str] = None  # Optional clarification (e.g., "Looking for vendor agent information")
    timestamp: float = field(default_factory=time.time)
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    
    def to_dict(self) -> Dict:
        """Convert to dict for JSON serialization"""
        return {
            "type": "reasoning",  # Always "reasoning" type
            "label": self.label,
            "detail": self.detail,
            "timestamp": self.timestamp,
            "event_id": self.event_id
        }


@dataclass
class ExecutionEvent:
    """Execution event schema - internal events (not shown to user directly)"""
    type: Literal[
        "read", 
        "search", 
        "grep", 
        "tool", 
        "retrieve_docs", 
        "retrieve_chunks", 
        "query_db", 
        "api_call",
        "phase"  # High-level task marker (not "decision")
    ]
    description: str
    metadata: Optional[Dict] = None
    timestamp: float = field(default_factory=time.time)
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))  # Unique ID for linking
    parent_event_id: Optional[str] = None  # Link pre/post events
    
    def to_dict(self) -> Dict:
        """Convert to dict for JSON serialization"""
        return {
            "type": self.type,
            "description": self.description,
            "metadata": self.metadata or {},
            "timestamp": self.timestamp,
            "event_id": self.event_id,
            "parent_event_id": self.parent_event_id
        }


class ExecutionEventEmitter:
    """Manages execution event collection and queue-based streaming"""
    
    def __init__(self):
        self.events: List[ExecutionEvent] = []  # Internal events (not shown to user)
        self.reasoning_events: List[ReasoningEvent] = []  # User-facing reasoning events
        self.stream_queue: Optional[Queue] = None  # Queue for streaming
        self._lock = threading.Lock()  # Thread-safe event appending
    
    def emit(self, event: ExecutionEvent):
        """Emit an execution event (internal - not shown to user directly)"""
        with self._lock:
            self.events.append(event)
        
        # Don't stream internal execution events to frontend
        # Only reasoning events are streamed
    
    def emit_reasoning(self, label: str, detail: Optional[str] = None):
        """
        Emit a user-facing reasoning event (Cursor-style).
        
        Args:
            label: Short human-readable action (e.g., "Checked letter of offer")
            detail: Optional clarification (e.g., "Looking for vendor agent information")
        """
        reasoning_event = ReasoningEvent(label=label, detail=detail)
        
        with self._lock:
            self.reasoning_events.append(reasoning_event)
        
        # Stream reasoning events to frontend (convert to ExecutionEvent format for compatibility)
        if self.stream_queue:
            try:
                # Convert to ExecutionEvent format for compatibility with existing frontend
                execution_event = ExecutionEvent(
                    type="phase",  # Use "phase" for reasoning events
                    description=label if not detail else f"{label} ({detail})",
                    metadata={"reasoning": True, "detail": detail, "label": label},
                    timestamp=reasoning_event.timestamp,
                    event_id=reasoning_event.event_id
                )
                self.stream_queue.put(execution_event, block=False)
                logger.debug(f"[EXECUTION_EVENTS] ✅ Emitted reasoning event: {label}" + (f" ({detail})" if detail else ""))
            except Exception as e:
                logger.warning(f"[EXECUTION_EVENTS] Stream queue full or error: {e}")
        else:
            logger.warning(f"[EXECUTION_EVENTS] ⚠️  Stream queue not set - reasoning event '{label}' not streamed")
    
    def get_reasoning_events(self) -> List[ReasoningEvent]:
        """Get all reasoning events (thread-safe copy)"""
        with self._lock:
            return self.reasoning_events.copy()
    
    def clear(self):
        """Clear all events (for new query)"""
        with self._lock:
            self.events.clear()
            self.reasoning_events.clear()
    
    def get_events(self) -> List[ExecutionEvent]:
        """Get all events (thread-safe copy)"""
        with self._lock:
            return self.events.copy()
    
    def set_stream_queue(self, queue: Queue):
        """Set queue for real-time streaming (queue instead of callback)"""
        self.stream_queue = queue


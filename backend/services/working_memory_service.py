"""
Working Memory Service - Session state and findings storage for autonomous browsing.

This service maintains the memory of an autonomous browsing session, including:
- Extracted findings from pages
- Visited URLs (to avoid revisiting)
- Action history
- Current hypothesis/working answer
- Sub-goal progress

Enables the agent to accumulate knowledge across multiple steps.
"""

import logging
from typing import List, Dict, Any, Optional, Set
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

logger = logging.getLogger(__name__)


class ExtractionMethod(str, Enum):
    """How a finding was extracted"""
    ARIA_SNAPSHOT = "aria_snapshot"
    SCREENSHOT_OCR = "screenshot_ocr"
    PAGE_TEXT = "page_text"
    USER_PROVIDED = "user_provided"
    LLM_INFERENCE = "llm_inference"


@dataclass
class Finding:
    """
    A piece of information extracted during browsing.
    
    Represents a single fact/data point with its source and confidence.
    """
    id: str
    fact: str
    source_url: str
    extraction_method: ExtractionMethod
    confidence: float  # 0.0 to 1.0
    timestamp: datetime
    goal_id: str  # Which sub-goal this finding relates to
    element_ref: Optional[str] = None  # ARIA ref if applicable
    raw_text: Optional[str] = None  # Original text before processing
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            "id": self.id,
            "fact": self.fact,
            "source_url": self.source_url,
            "extraction_method": self.extraction_method.value,
            "confidence": self.confidence,
            "timestamp": self.timestamp.isoformat(),
            "goal_id": self.goal_id,
            "element_ref": self.element_ref,
            "raw_text": self.raw_text,
            "metadata": self.metadata
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Finding":
        """Create from dictionary"""
        return cls(
            id=data["id"],
            fact=data["fact"],
            source_url=data["source_url"],
            extraction_method=ExtractionMethod(data.get("extraction_method", "aria_snapshot")),
            confidence=data.get("confidence", 0.5),
            timestamp=datetime.fromisoformat(data["timestamp"]) if data.get("timestamp") else datetime.now(),
            goal_id=data.get("goal_id", ""),
            element_ref=data.get("element_ref"),
            raw_text=data.get("raw_text"),
            metadata=data.get("metadata", {})
        )


@dataclass
class ActionRecord:
    """Record of an action taken during the session"""
    action_type: str  # click, type, navigate, scroll, done
    action_data: Dict[str, Any]
    url_before: str
    url_after: str
    timestamp: datetime
    success: bool
    error: Optional[str] = None
    goal_id: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "action_type": self.action_type,
            "action_data": self.action_data,
            "url_before": self.url_before,
            "url_after": self.url_after,
            "timestamp": self.timestamp.isoformat(),
            "success": self.success,
            "error": self.error,
            "goal_id": self.goal_id
        }


@dataclass
class SessionMemory:
    """
    Complete memory for a browsing session.
    
    Tracks everything the agent has learned and done.
    """
    session_id: str
    original_task: str
    created_at: datetime
    
    # Findings accumulated during browsing
    findings: List[Finding] = field(default_factory=list)
    
    # URLs visited (to avoid loops)
    visited_urls: Set[str] = field(default_factory=set)
    
    # Full action history
    action_history: List[ActionRecord] = field(default_factory=list)
    
    # Working hypothesis - current best answer
    current_hypothesis: str = ""
    
    # Open questions still to answer
    open_questions: List[str] = field(default_factory=list)
    
    # Session metadata
    last_activity: datetime = field(default_factory=datetime.now)
    status: str = "active"  # active, completed, failed, timeout
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "original_task": self.original_task,
            "created_at": self.created_at.isoformat(),
            "findings": [f.to_dict() for f in self.findings],
            "visited_urls": list(self.visited_urls),
            "action_history": [a.to_dict() for a in self.action_history],
            "current_hypothesis": self.current_hypothesis,
            "open_questions": self.open_questions,
            "last_activity": self.last_activity.isoformat(),
            "status": self.status
        }


class WorkingMemoryService:
    """
    Service for managing session memory and findings.
    
    Provides methods to store and retrieve information accumulated
    during autonomous browsing sessions.
    """
    
    def __init__(self):
        self.sessions: Dict[str, SessionMemory] = {}
        self._finding_counter = 0
    
    def create_session(self, session_id: str, task: str) -> SessionMemory:
        """
        Create a new session memory.
        
        Args:
            session_id: Unique session identifier
            task: Original task description
            
        Returns:
            New SessionMemory object
        """
        memory = SessionMemory(
            session_id=session_id,
            original_task=task,
            created_at=datetime.now()
        )
        self.sessions[session_id] = memory
        logger.info(f"📝 [MEMORY] Created session memory for {session_id}")
        return memory
    
    def get_session(self, session_id: str) -> Optional[SessionMemory]:
        """Get session memory by ID"""
        return self.sessions.get(session_id)
    
    def add_finding(
        self,
        session_id: str,
        fact: str,
        source_url: str,
        goal_id: str,
        confidence: float = 0.8,
        extraction_method: ExtractionMethod = ExtractionMethod.ARIA_SNAPSHOT,
        element_ref: Optional[str] = None,
        raw_text: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Optional[Finding]:
        """
        Add a finding to session memory.
        
        Args:
            session_id: Session identifier
            fact: The extracted fact/information
            source_url: URL where this was found
            goal_id: Which sub-goal this relates to
            confidence: Confidence score 0-1
            extraction_method: How it was extracted
            element_ref: ARIA ref if applicable
            raw_text: Original unprocessed text
            metadata: Additional context
            
        Returns:
            Created Finding object or None
        """
        memory = self.sessions.get(session_id)
        if not memory:
            logger.warning(f"📝 [MEMORY] Session {session_id} not found")
            return None
        
        self._finding_counter += 1
        finding = Finding(
            id=f"f{self._finding_counter}",
            fact=fact,
            source_url=source_url,
            extraction_method=extraction_method,
            confidence=confidence,
            timestamp=datetime.now(),
            goal_id=goal_id,
            element_ref=element_ref,
            raw_text=raw_text,
            metadata=metadata or {}
        )
        
        memory.findings.append(finding)
        memory.last_activity = datetime.now()
        
        logger.info(f"📝 [MEMORY] Added finding: {fact[:50]}... (confidence: {confidence})")
        return finding
    
    def get_findings(
        self, 
        session_id: str, 
        goal_id: Optional[str] = None,
        min_confidence: float = 0.0
    ) -> List[Finding]:
        """
        Get findings for a session, optionally filtered.
        
        Args:
            session_id: Session identifier
            goal_id: Filter by specific goal
            min_confidence: Minimum confidence threshold
            
        Returns:
            List of Finding objects
        """
        memory = self.sessions.get(session_id)
        if not memory:
            return []
        
        findings = memory.findings
        
        if goal_id:
            findings = [f for f in findings if f.goal_id == goal_id]
        
        if min_confidence > 0:
            findings = [f for f in findings if f.confidence >= min_confidence]
        
        return findings
    
    def add_visited_url(self, session_id: str, url: str) -> None:
        """Mark a URL as visited"""
        memory = self.sessions.get(session_id)
        if memory:
            # Normalize URL (remove fragments, trailing slash)
            normalized = url.split('#')[0].rstrip('/')
            memory.visited_urls.add(normalized)
            memory.last_activity = datetime.now()
    
    def get_visited_urls(self, session_id: str) -> Set[str]:
        """Get all visited URLs for a session"""
        memory = self.sessions.get(session_id)
        return memory.visited_urls if memory else set()
    
    def has_visited(self, session_id: str, url: str) -> bool:
        """Check if a URL has been visited"""
        memory = self.sessions.get(session_id)
        if not memory:
            return False
        normalized = url.split('#')[0].rstrip('/')
        return normalized in memory.visited_urls
    
    def add_action(
        self,
        session_id: str,
        action_type: str,
        action_data: Dict[str, Any],
        url_before: str,
        url_after: str,
        success: bool,
        error: Optional[str] = None,
        goal_id: Optional[str] = None
    ) -> None:
        """
        Record an action taken during the session.
        
        Args:
            session_id: Session identifier
            action_type: Type of action (click, type, navigate, etc.)
            action_data: Action parameters
            url_before: URL before action
            url_after: URL after action
            success: Whether action succeeded
            error: Error message if failed
            goal_id: Associated sub-goal
        """
        memory = self.sessions.get(session_id)
        if not memory:
            return
        
        record = ActionRecord(
            action_type=action_type,
            action_data=action_data,
            url_before=url_before,
            url_after=url_after,
            timestamp=datetime.now(),
            success=success,
            error=error,
            goal_id=goal_id
        )
        
        memory.action_history.append(record)
        memory.last_activity = datetime.now()
        
        # Also track visited URL
        if url_after:
            self.add_visited_url(session_id, url_after)
    
    def get_action_history(
        self, 
        session_id: str, 
        limit: Optional[int] = None
    ) -> List[ActionRecord]:
        """Get action history, optionally limited to recent actions"""
        memory = self.sessions.get(session_id)
        if not memory:
            return []
        
        history = memory.action_history
        if limit:
            history = history[-limit:]
        return history
    
    def update_hypothesis(self, session_id: str, hypothesis: str) -> None:
        """Update the current working hypothesis/answer"""
        memory = self.sessions.get(session_id)
        if memory:
            memory.current_hypothesis = hypothesis
            memory.last_activity = datetime.now()
            logger.info(f"📝 [MEMORY] Updated hypothesis: {hypothesis[:100]}...")
    
    def get_hypothesis(self, session_id: str) -> str:
        """Get current hypothesis"""
        memory = self.sessions.get(session_id)
        return memory.current_hypothesis if memory else ""
    
    def add_open_question(self, session_id: str, question: str) -> None:
        """Add an open question to investigate"""
        memory = self.sessions.get(session_id)
        if memory and question not in memory.open_questions:
            memory.open_questions.append(question)
    
    def resolve_question(self, session_id: str, question: str) -> None:
        """Mark a question as resolved"""
        memory = self.sessions.get(session_id)
        if memory and question in memory.open_questions:
            memory.open_questions.remove(question)
    
    def get_session_summary(self, session_id: str) -> str:
        """
        Get a formatted summary of the session for LLM context.
        
        Returns a string summarizing:
        - Original task
        - Findings so far
        - Current hypothesis
        - Open questions
        """
        memory = self.sessions.get(session_id)
        if not memory:
            return "No session found."
        
        lines = [
            f"TASK: {memory.original_task}",
            "",
            f"FINDINGS ({len(memory.findings)}):"
        ]
        
        for f in memory.findings:
            conf_str = f"[{f.confidence:.0%}]" if f.confidence < 1.0 else ""
            lines.append(f"  • {f.fact} {conf_str} (from {f.source_url})")
        
        if not memory.findings:
            lines.append("  (none yet)")
        
        if memory.current_hypothesis:
            lines.extend([
                "",
                f"CURRENT HYPOTHESIS: {memory.current_hypothesis}"
            ])
        
        if memory.open_questions:
            lines.extend([
                "",
                "OPEN QUESTIONS:"
            ])
            for q in memory.open_questions:
                lines.append(f"  • {q}")
        
        lines.extend([
            "",
            f"PAGES VISITED: {len(memory.visited_urls)}",
            f"ACTIONS TAKEN: {len(memory.action_history)}"
        ])
        
        return "\n".join(lines)
    
    def get_findings_for_goal(self, session_id: str, goal_id: str) -> List[Finding]:
        """Get all findings related to a specific goal"""
        return self.get_findings(session_id, goal_id=goal_id)
    
    def complete_session(self, session_id: str, status: str = "completed") -> None:
        """Mark a session as complete"""
        memory = self.sessions.get(session_id)
        if memory:
            memory.status = status
            memory.last_activity = datetime.now()
            logger.info(f"📝 [MEMORY] Session {session_id} marked as {status}")
    
    def cleanup_session(self, session_id: str) -> None:
        """Remove a session from memory"""
        if session_id in self.sessions:
            del self.sessions[session_id]
            logger.info(f"📝 [MEMORY] Cleaned up session {session_id}")
    
    def get_stats(self, session_id: str) -> Dict[str, Any]:
        """Get statistics for a session"""
        memory = self.sessions.get(session_id)
        if not memory:
            return {}
        
        return {
            "findings_count": len(memory.findings),
            "urls_visited": len(memory.visited_urls),
            "actions_taken": len(memory.action_history),
            "successful_actions": sum(1 for a in memory.action_history if a.success),
            "failed_actions": sum(1 for a in memory.action_history if not a.success),
            "has_hypothesis": bool(memory.current_hypothesis),
            "open_questions": len(memory.open_questions),
            "status": memory.status,
            "duration_seconds": (datetime.now() - memory.created_at).total_seconds()
        }


# Global singleton instance
working_memory_service = WorkingMemoryService()

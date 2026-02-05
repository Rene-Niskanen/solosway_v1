"""
Session Manager - Maps user sessions to LangGraph thread_ids
Ensures consistent session identification across frontend and backend.

Key Features:
- Generate unique thread_ids for new sessions
- Map user_id + business_id + session_id → thread_id
- Support multi-tenant sessions (user + business)
- Parse thread_id back into components
"""

import uuid
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class SessionManager:
    """
    Manages session lifecycle for LangGraph checkpointer.
    
    Key responsibilities:
    - Generate unique thread_ids for new sessions
    - Map user_id + session_id → thread_id
    - Support multi-tenant sessions (user + business)
    - Parse thread_id for debugging/cleanup
    """
    
    def get_thread_id(
        self, 
        user_id: int, 
        business_id: str,
        session_id: Optional[str] = None
    ) -> str:
        """
        Get or generate a thread_id for LangGraph checkpointer.
        
        Args:
            user_id: Current user ID
            business_id: Current business UUID (shortened for readability)
            session_id: Optional explicit session ID (from frontend chat history)
        
        Returns:
            Unique thread_id for LangGraph checkpointer
        
        Format:
            - With session_id: "user_{user_id}_biz_{business_short}_sess_{session_id}"
            - New session: "user_{user_id}_biz_{business_short}_sess_{uuid}"
        
        Examples:
            >>> mgr.get_thread_id(1, "abc-123-def", "chat-1234567890-xyz")
            "user_1_biz_abc123_sess_chat-1234567890-xyz"
            
            >>> mgr.get_thread_id(1, "abc-123-def")  # New session
            "user_1_biz_abc123_sess_chat-a7b3f9e2"
        """
        # Shorten business_id for cleaner thread_id (first 8 chars, remove dashes)
        business_short = str(business_id).replace('-', '')[:8]
        
        if session_id:
            # Explicit session - resume conversation
            thread_id = f"user_{user_id}_biz_{business_short}_sess_{session_id}"
            logger.info(f"[SESSION_MGR] Resuming session: {thread_id[:60]}...")
            return thread_id
        
        # New session - generate unique ID
        new_session_id = f"chat-{uuid.uuid4().hex[:12]}"
        thread_id = f"user_{user_id}_biz_{business_short}_sess_{new_session_id}"
        logger.info(f"[SESSION_MGR] Created new session: {thread_id[:60]}...")
        return thread_id
    
    def parse_thread_id(self, thread_id: str) -> dict:
        """
        Parse thread_id back into components.
        
        Useful for:
        - Debugging
        - Session cleanup (delete all sessions for a user)
        - Analytics (sessions per user/business)
        
        Args:
            thread_id: Thread ID to parse
        
        Returns:
            Dict with user_id, business_id_short, session_id
            Returns empty dict if parsing fails
        
        Example:
            >>> mgr.parse_thread_id("user_1_biz_abc123_sess_chat-xyz")
            {'user_id': 1, 'business_id_short': 'abc123', 'session_id': 'chat-xyz'}
        """
        try:
            # Split by underscore
            parts = thread_id.split("_")
            
            # Expected format: user_{id}_biz_{short}_sess_{session}
            if len(parts) >= 6 and parts[0] == "user" and parts[2] == "biz" and parts[4] == "sess":
                return {
                    "user_id": int(parts[1]),
                    "business_id_short": parts[3],
                    "session_id": "_".join(parts[5:])  # Session ID may contain underscores
                }
            else:
                logger.warning(f"[SESSION_MGR] Unexpected thread_id format: {thread_id}")
                return {}
                
        except (IndexError, ValueError) as e:
            logger.error(f"[SESSION_MGR] Failed to parse thread_id '{thread_id}': {e}")
            return {}
    
    def build_thread_id_for_session(
        self,
        user_id: int,
        business_id: str,
        session_id: str
    ) -> str:
        """
        Build thread_id from known session_id (for cleanup/deletion).
        
        This is a convenience method that always uses the provided session_id
        (never generates a new one).
        
        Args:
            user_id: User ID
            business_id: Business UUID
            session_id: Known session ID (e.g., from frontend chat history)
        
        Returns:
            Thread ID for checkpointer lookup
        """
        business_short = str(business_id).replace('-', '')[:8]
        thread_id = f"user_{user_id}_biz_{business_short}_sess_{session_id}"
        return thread_id


# Global instance (singleton pattern)
# Import this in views.py: from backend.llm.utils.session_manager import session_manager
session_manager = SessionManager()


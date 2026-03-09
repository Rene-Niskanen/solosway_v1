"""
OpenFind memory service — wraps Mem0 AsyncMemory for persistent user memory.

Uses Mem0's native AsyncMemory (not sync Memory + to_thread).
See: https://docs.mem0.ai/open-source/features/async-memory

Usage:
    from backend.services.memory_service import openfind_memory

    # Search (before building prompt)
    memories = await openfind_memory.search("hello", user_id="user_123")

    # Add (after each turn, fire-and-forget)
    await openfind_memory.add(
        [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}],
        user_id="user_123",
    )
"""

import asyncio
import logging
import os

logger = logging.getLogger(__name__)

# Lazy import — only loaded when mem0_enabled is True
_memory_instance = None

# ============================================================================
# CUSTOM FACT EXTRACTION PROMPT
# ============================================================================
# Controls what Mem0 stores. Without this, Mem0 would extract facts from
# document discussions (e.g. "EPC rating is D") which we don't want as
# user memory. This prompt limits extraction to user preferences,
# personal info, and behavioral patterns.
# See: https://docs.mem0.ai/open-source/features/custom-fact-extraction-prompt

OPENFIND_FACT_EXTRACTION_PROMPT = """
Please only extract facts about the USER as a person — their preferences,
personal information, goals, communication style, and behavioral patterns.

DO NOT extract:
- Facts about documents, filings, properties, or real estate data
- Financial figures, valuations, EPC ratings, or contract terms
- Technical details from document content the user asked about

Here are some few-shot examples:

Input: Hi, I'm Thomas. I work in property management.
Output: {"facts": ["User's name is Thomas", "User works in property management"]}

Input: What's the EPC rating on my Highlands property?
Output: {"facts": []}

Input: I prefer concise answers, don't over-explain things.
Output: {"facts": ["User prefers concise answers"]}

Input: The valuation report says the property is worth 450,000.
Output: {"facts": []}

Input: I'm based in London and I manage about 30 properties.
Output: {"facts": ["User is based in London", "User manages about 30 properties"]}

Input: Can you search my documents for the lease terms?
Output: {"facts": []}

Input: Thanks, that's really helpful. I love how you explain things clearly.
Output: {"facts": ["User appreciates clear explanations"]}

Return the facts in JSON format as shown above.
"""


# ============================================================================
# MEM0 CONFIGURATION
# ============================================================================

def _get_mem0_config() -> dict:
    """
    Build Mem0 configuration dict.

    Default: Qdrant on-disk at a persistent path + OpenAI for LLM/embeddings.
    For production: change vector_store to a hosted Qdrant or pgvector instance.
    """
    # Use a persistent path (not /tmp which is wiped on restart on some systems)
    qdrant_path = os.environ.get(
        "MEM0_QDRANT_PATH",
        os.path.expanduser("~/.velora/mem0/qdrant"),
    )

    return {
        "vector_store": {
            "provider": "qdrant",
            "config": {
                "path": qdrant_path,  # On-disk persistent storage
                "on_disk": True,
            },
        },
        "llm": {
            "provider": "openai",
            "config": {
                "model": "gpt-4.1-nano-2025-04-14",
                "temperature": 0.1,  # Low temp for deterministic extraction
            },
        },
        "embedder": {
            "provider": "openai",
            "config": {
                "model": "text-embedding-3-small",
            },
        },
        "custom_fact_extraction_prompt": OPENFIND_FACT_EXTRACTION_PROMPT,
        "version": "v1.1",
    }


def _get_memory():
    """Return Mem0 AsyncMemory singleton. Must call init_memory_async() at startup."""
    global _memory_instance
    if _memory_instance is None:
        # AsyncMemory.from_config is async; calling it without await stores a coroutine,
        # causing "'coroutine' object has no attribute 'search'". Use sync init fallback.
        _init_memory_sync()
    return _memory_instance


async def init_memory_async() -> bool:
    """
    Initialize Mem0 AsyncMemory asynchronously. Call from app startup (e.g. main.py).
    Returns True if initialized, False if skipped or failed.
    """
    global _memory_instance
    if _memory_instance is not None:
        return True
    try:
        from mem0 import AsyncMemory

        config = _get_mem0_config()
        if hasattr(AsyncMemory, "from_config"):
            maybe_coro = AsyncMemory.from_config(config)
            _memory_instance = await maybe_coro if asyncio.iscoroutine(maybe_coro) else maybe_coro
        else:
            _memory_instance = AsyncMemory(config=config)
        logger.info("[MEMORY] Mem0 AsyncMemory initialized (async)")
        return True
    except Exception as e:
        logger.warning("[MEMORY] Async init failed: %s, will use sync fallback on first use", e)
        return False


def _init_memory_sync() -> None:
    """Fallback: initialize in sync context via asyncio.run (for first-use before async init)."""
    global _memory_instance
    if _memory_instance is not None:
        return
    try:
        import asyncio
        from mem0 import AsyncMemory

        config = _get_mem0_config()
        # from_config is async; must await it
        async def _do_init():
            if hasattr(AsyncMemory, "from_config"):
                return await AsyncMemory.from_config(config)
            return AsyncMemory(config=config)

        loop = asyncio.new_event_loop()
        try:
            _memory_instance = loop.run_until_complete(_do_init())
            logger.info("[MEMORY] Mem0 AsyncMemory initialized (sync fallback)")
        finally:
            loop.close()
    except Exception as e:
        logger.warning("[MEMORY] Sync init failed: %s", e)
        raise


# ============================================================================
# OPENFIND MEMORY CLASS
# ============================================================================

class OpenFindMemory:
    """
    Async wrapper around Mem0 AsyncMemory for OpenFind.

    Uses Mem0's native async API — no thread wrappers needed.

    - search(): returns relevant memories as strings (with timeout)
    - add(): stores new memories from a conversation turn
    - forget(): deletes a specific memory
    - get_all(): list all memories for a user (debugging)
    """

    async def search(
        self,
        query: str,
        user_id: str,
        limit: int = 5,
        timeout: float = 2.0,
    ) -> list[str]:
        """
        Search for relevant memories.

        Returns a list of memory strings, or empty list on
        timeout / error.
        """
        try:
            result = await asyncio.wait_for(
                _get_memory().search(
                    query=query,
                    user_id=user_id,
                    limit=limit,
                ),
                timeout=timeout,
            )
            memories = [
                entry["memory"]
                for entry in result.get("results", [])
                if entry.get("memory")
            ]
            if memories:
                logger.info(
                    f"[MEMORY] Found {len(memories)} memories for "
                    f"user={user_id[:8]}..."
                )
            return memories
        except asyncio.TimeoutError:
            logger.warning(
                f"[MEMORY] Search timed out ({timeout}s) for "
                f"user={user_id[:8]}..."
            )
            return []
        except Exception as e:
            logger.warning(
                "[MEMORY] Search failed: %s (%s)",
                e,
                type(e).__name__,
                exc_info=False,
            )
            return []

    async def add(
        self,
        messages: list[dict],
        user_id: str,
        metadata: dict | None = None,
    ) -> None:
        """
        Store new memories from a conversation turn.

        Fire-and-forget: errors are logged, never raised.
        Mem0 automatically extracts facts, deduplicates, and
        resolves conflicts with existing memories.
        """
        try:
            await _get_memory().add(
                messages,
                user_id=user_id,
                metadata=metadata or {},
            )
            logger.info(
                f"[MEMORY] Stored memories from turn for "
                f"user={user_id[:8]}..."
            )
        except Exception as e:
            logger.warning(
                "[MEMORY] Add failed: %s (%s)",
                e,
                type(e).__name__,
                exc_info=False,
            )

    async def forget(
        self,
        memory_id: str,
    ) -> None:
        """Delete a specific memory (for future 'forget' feature)."""
        try:
            await _get_memory().delete(memory_id=memory_id)
            logger.info(f"[MEMORY] Deleted memory {memory_id}")
        except Exception as e:
            logger.warning(f"[MEMORY] Forget failed: {e}")

    async def get_all(
        self,
        user_id: str,
    ) -> list[str]:
        """Get all memories for a user (for debugging / admin)."""
        try:
            result = await _get_memory().get_all(user_id=user_id)
            return [
                entry["memory"]
                for entry in result.get("results", [])
                if entry.get("memory")
            ]
        except Exception as e:
            logger.warning(f"[MEMORY] get_all failed: {e}")
            return []


# Singleton — import and use directly
openfind_memory = OpenFindMemory()

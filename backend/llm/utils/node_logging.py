"""
Performance logging for LangGraph nodes. Logs node start and finish with duration.
"""

import logging
import time
import functools

logger = logging.getLogger(__name__)


def log_node_perf(name=None):
    """
    Async decorator that logs [PERF] Node <name> started and Node <name> finished in X.XXs.
    On exception, logs finished in X.XXs (error: ...) and re-raises.
    """
    def decorator(func):
        node_name = name or func.__name__
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            logger.info("[PERF] Node %s started", node_name)
            t0 = time.perf_counter()
            try:
                out = await func(*args, **kwargs)
                elapsed = time.perf_counter() - t0
                logger.info("[PERF] Node %s finished in %.2fs", node_name, elapsed)
                return out
            except Exception as e:
                elapsed = time.perf_counter() - t0
                logger.info("[PERF] Node %s finished in %.2fs (error: %s)", node_name, elapsed, e)
                raise
        return wrapper
    return decorator

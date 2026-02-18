import asyncio
import logging
import threading
from typing import Any, AsyncIterator, Optional, Tuple

logger = logging.getLogger(__name__)


class GraphRunner:
    """
    Run LangGraph on a single long-lived asyncio loop in a background thread.

    Goals:
    - Avoid per-request asyncio.run()
    - Avoid per-request checkpointer creation + graph compilation
    - Preserve follow-up strength via checkpointer
    """

    def __init__(self) -> None:
        self._thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._ready = threading.Event()
        self._ready_error: Optional[BaseException] = None
        self._graph: Any = None
        self._checkpointer: Any = None
        # Lock: only one stream runs on the runner at a time; others fall back to per-request loop
        self._stream_lock = threading.Lock()

    def start(self) -> None:
        """Start the background runner thread (idempotent)."""
        if self._thread and self._thread.is_alive():
            return

        self._ready.clear()
        self._ready_error = None

        def _run() -> None:
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                self._loop = loop
                loop.run_until_complete(self._initialize())
                self._ready.set()
                loop.run_forever()
            except BaseException as e:
                self._ready_error = e
                self._ready.set()
                logger.error("GraphRunner failed to start: %s", e, exc_info=True)
            finally:
                try:
                    if self._loop and not self._loop.is_closed():
                        self._loop.stop()
                        self._loop.close()
                except Exception:
                    pass

        self._thread = threading.Thread(target=_run, name="LangGraphRunner", daemon=True)
        self._thread.start()

    def wait_ready(self, timeout: float = 15.0) -> None:
        """Block until runner is ready or raises."""
        ok = self._ready.wait(timeout=timeout)
        if not ok:
            raise TimeoutError("GraphRunner did not become ready in time")
        if self._ready_error:
            raise RuntimeError("GraphRunner failed to initialize") from self._ready_error

    async def _initialize(self) -> None:
        from backend.llm.graphs.main_graph import build_main_graph, create_checkpointer_for_current_loop

        logger.info("GraphRunner initializing checkpointer + compiled graph...")
        checkpointer = await create_checkpointer_for_current_loop()
        if checkpointer:
            graph, _ = await build_main_graph(use_checkpointer=True, checkpointer_instance=checkpointer)
        else:
            logger.warning("GraphRunner: checkpointer unavailable, falling back to stateless graph")
            graph, _ = await build_main_graph(use_checkpointer=False)

        self._graph = graph
        self._checkpointer = checkpointer
        logger.info("GraphRunner ready (checkpointer=%s)", bool(checkpointer))

    def get_graph(self) -> Any:
        self.wait_ready()
        return self._graph

    def get_checkpointer(self) -> Any:
        self.wait_ready()
        return self._checkpointer

    def try_acquire_stream(self) -> bool:
        """Acquire the stream lock (non-blocking). Call release_stream() when done."""
        return self._stream_lock.acquire(blocking=False)

    def release_stream(self) -> None:
        """Release the stream lock after streaming finishes."""
        try:
            self._stream_lock.release()
        except RuntimeError:
            pass  # Lock was not held (e.g. already released)

    def run_query_sync(self, initial_state: dict, thread_id: Optional[str]) -> dict:
        """
        Run graph.ainvoke on the runner loop and block for the result.
        Used by non-stream endpoint after endpoint refactor.
        """
        self.wait_ready()
        if not self._loop:
            raise RuntimeError("GraphRunner loop not available")

        async def _run() -> dict:
            cfg = {"configurable": {"thread_id": thread_id}} if thread_id else {}
            return await self._graph.ainvoke(initial_state, cfg)

        fut = asyncio.run_coroutine_threadsafe(_run(), self._loop)
        return fut.result()

    def stream_events_sync(
        self,
        initial_state: dict,
        thread_id: Optional[str],
        version: str = "v2",
    ) -> AsyncIterator[dict]:
        """
        Return an async iterator of graph.astream_events bound to runner loop.
        Note: consumers should iterate this on the runner loop; the streaming endpoint
        will bridge to sync via a queue.
        """
        self.wait_ready()
        if not self._loop:
            raise RuntimeError("GraphRunner loop not available")

        async def _iter() -> AsyncIterator[dict]:
            cfg = {"configurable": {"thread_id": thread_id}} if thread_id else {}
            async for ev in self._graph.astream_events(initial_state, cfg, version=version):
                yield ev

        return _iter()


graph_runner = GraphRunner()



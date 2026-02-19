---
name: ""
overview: ""
todos: []
isProject: false
---

# Speed improvements for streaming (updated for current codebase)

Plan for reducing time-to-first-token and total latency without changing answer quality. All references point to the current codebase as of this plan.

---

## Safety and disruption analysis (re-check before implementing)

**1. Context manager fast path**  

- **Risk:** If we return early for `len(messages) <= 12` **without** checking tokens, a thread with e.g. 10 very long messages (10 × 2000 tokens ≈ 20k) would never be summarized and could hit token limits or overflow later.  
- **Safe approach:** Use a **lower threshold (8)** so that “under 8 messages” is a safe proxy for “under 8k tokens” (8 × ~1000 ≈ 8k). For 9+ messages we always run the existing token count and 8k check.  
- **No other disruption:** Downstream only sees the same `{}` (no state change); planner/responder behaviour is unchanged.

**2. Skip checkpoint for new chats**  

- **Risk:** If we wrongly treat a follow-up as a new chat, we skip loading checkpoint and lose conversation history and cache-first (reuse of execution_results).  
- **Safe approach:**  
  - Prefer **explicit** `isNewChat: true` from the frontend (e.g. when sending the first message of a new chat). The frontend already has `isNewChatSession = !currentChatIdValue || currentMessagesLength === 0` (SideChatPanel) but does **not** currently send this to the API; add it to the stream request body and read it in the backend.  
  - If we **infer** instead: only skip when `len(message_history) == 0`. That is correct only if the frontend **always** sends `messageHistory` for follow-ups (never omits it to save payload). Document that requirement.
- **No other disruption:** For a true new chat, `aget_state` returns nothing useful; skipping only avoids a redundant call. Follow-up behaviour is unchanged when we don’t skip.

**3. Run streaming on GraphRunner’s loop**  

- **Concurrency:** The runner has a **single** event loop. Only one stream (or one non-stream query) runs at a time. Concurrent requests are effectively **serialized**. (Update: multiple chats must still run in parallel—see below.) For single-user or low-concurrency use this is acceptable; for high concurrency we’d need a pool or multiple runners later.  
- **State isolation:** Each request uses its own `initial_state` and `config_dict` (with its own `thread_id` / session_id). The checkpointer isolates state by thread_id, so no cross-request leakage.  
- **Fallback:** When GraphRunner is not ready or checkpointer is None, keep the **current** behaviour (new loop + per-request graph) so streaming still works when the runner isn’t used.  
- **No shared mutable state:** Build `initial_state` and `config_dict` in the requesting thread; only the async iteration runs on the runner loop. Don’t mutate shared objects between requests.

---

## 1. Context manager fast path (quick win)

**Goal:** Skip token counting and summarization when the conversation is short.

**File:** [backend/llm/nodes/context_manager_node.py](backend/llm/nodes/context_manager_node.py)

**Current behavior:** The node already returns early when `len(messages) <= 6` (lines 57–60). For 7+ messages it always estimates token count (lines 61–69) and then checks `total_tokens < 8000` (lines 72–74).

**Change:** Add an earlier return when `len(messages) <= 8` **before** the token estimation loop. That avoids the token count and 8k check for very short conversations. Use **8** (not 12) so we don’t skip the check when a thread could already be near 8k tokens (8 × ~1000 ≈ 8k; 12 long messages could exceed 8k and cause overflow if we skipped).

**Placement:** Right after the existing `if not messages or len(messages) <= 6` block (after line 60). Add:

```python
# Fast path: very short conversations are under 8k; skip token count
if len(messages) <= 8:
    logger.debug(f"[CONTEXT_MGR] Only {len(messages)} messages - skip token count")
    return {}
```

Then keep the existing `# Estimate token count` and below for `len(messages) > 8` only.

**Risk:** Low. Safe threshold; no change to behaviour for long threads; downstream unchanged.

---

## 2. Skip checkpoint load for new chats

**Goal:** Avoid loading checkpoint state when the user starts a brand‑new chat (no prior turns).

**File:** [backend/views.py](backend/views.py)

**Current behavior:** In the streaming path, after building the graph and config (around 1189–1210), we always call `existing_state = await graph.aget_state(config_dict)` when `checkpointer` exists. We use that for follow-up detection and cache-first (reuse execution_results). For a new chat there is no prior state, so this call only adds latency.

**Change:**

- **Option A (preferred, no disruption):** Have the frontend send `isNewChat: true` only when the user is sending the **first** message of a new chat (e.g. when `!currentChatIdValue || currentMessagesLength === 0`). In the stream handler, read `is_new_chat = data.get('isNewChat', False)` (near where we read `message_history`, ~665). When `is_new_chat` is true, skip the block `if checkpointer: existing_state = await graph.aget_state(...)` and the cache-first block. Set `is_followup = False` and `loaded_conversation_history = []`. For any request where `isNewChat` is false or missing, behave as today (load checkpoint, cache-first). This way follow-ups are never mistaken for new chats.
- **Option B (infer):** Infer new chat when `len(message_history) == 0`. Skip `aget_state` only then. **Requirement:** The frontend must **always** send `messageHistory` for follow-up messages (never omit it), or we could wrongly skip loading and lose context.

**Placement:** In the async `run_and_stream()` body, around lines 1189–1210. Guard with `if not is_new_chat and checkpointer:` for the `aget_state` and cache-first blocks.

**Risk:** Low if Option A is used (explicit flag). With Option B, risk of disruption only if follow-ups are ever sent with empty `messageHistory`.

---

## 3. Run streaming on GraphRunner’s loop (reuse graph + checkpointer)

**Goal:** Reuse the single graph and checkpointer from [backend/llm/runtime/graph_runner.py](backend/llm/runtime/graph_runner.py) for streaming instead of building a new graph and checkpointer per request. This removes per-request graph build and checkpointer creation cost.

**Current behavior:**

- [backend/views.py](backend/views.py) `generate_stream()` defines an async `run_and_stream()` (around 1086) that:
  - Creates a **new** checkpointer and graph for the **current** event loop (1129–1165).
  - Builds `initial_state` and `config_dict` (1167–1183).
  - Calls `graph.aget_state(config_dict)` when checkpointer exists (1191–1201).
  - Runs `graph.astream_events(initial_state, config_dict, version="v2")` and processes events in a `while True` loop (1283 onward).
- The async generator `run_and_stream()` is consumed from a **separate thread** that creates its **own** event loop (2946–2954: `new_loop = asyncio.new_event_loop()`, then `async_gen = run_and_stream()` and `async for chunk in async_gen`). So every stream request gets a new loop, new graph, new checkpointer.

**Desired behavior:**

- Use `graph_runner.get_graph()` and `graph_runner.get_checkpointer()` (and the runner’s single event loop) for streaming.
- When the runner loop is **busy** (another stream is running), do **not** use it for the new request: create a new event loop and per-request graph so the new stream runs in parallel. Only use the runner when it is free.
- Run the same event-processing logic (astream_events + reasoning steps + token streaming) on the **runner’s** loop and pass SSE chunks back to the Flask thread via the existing `chunk_queue`.

**Implementation outline:**

1. **GraphRunner** already exposes `get_graph()`, `get_checkpointer()`, and `_loop`. It does **not** currently expose a way to run an async generator that **yields** chunks and have those chunks consumed by another thread. So we need a small extension or a clear pattern in views.
2. **Option A – Run full stream logic on runner loop:**
  - In views, define a coroutine `run_and_stream_into_queue(chunk_queue, initial_state, config_dict, ...)` that does the same work as the current `run_and_stream()` but instead of `yield chunk` it does `chunk_queue.put(chunk)`.  
  - When GraphRunner is ready, do **not** create a new loop in the stream thread. Instead, schedule this coroutine on the runner’s loop:  
  `fut = asyncio.run_coroutine_threadsafe(run_and_stream_into_queue(...), graph_runner._loop)`.  
  - The sync generator (in the Flask thread) keeps reading from `chunk_queue` and yielding to the client as it does now.  
  - Ensure `initial_state` and `config_dict` are built in the Flask thread (or in a sync part) and only the async iteration runs on the runner loop.  
  - If GraphRunner is not ready, checkpointer is None, or the runner is busy (another stream is running), fall back to the current behaviour (new loop + per-request graph) so streaming still works and multiple chats can run in parallel.
3. **Option B – Use GraphRunner.stream_events_sync:**
  - [graph_runner.py](backend/llm/runtime/graph_runner.py) already has `stream_events_sync(initial_state, thread_id, version="v2")` which returns an **async** iterator of raw events. That iterator must be consumed on the runner’s loop.  
  - We could run a consumer on the runner loop that does `async for ev in stream_events_sync(...)`, runs the **same** event-processing logic we have today (reasoning steps, capture state, stream tokens), and puts resulting SSE chunks into `chunk_queue`. That duplicates the event-processing loop from views into a runner-loop coroutine.  
  - Option A reuses the existing `run_and_stream()` logic by only changing where it runs and replacing `yield` with `chunk_queue.put`, so it’s less duplication.

**Files to touch:**

- [backend/views.py](backend/views.py): In the stream path, branch on “use GraphRunner when available”. When true, build `initial_state` and `config_dict` as today, then schedule one coroutine on `graph_runner._loop` that runs the current stream logic and puts chunks into `chunk_queue`; when false, keep the current “new loop + run_and_stream” thread. Ensure session_id is passed as thread_id for checkpointing.
- Optionally [backend/llm/runtime/graph_runner.py](backend/llm/runtime/graph_runner.py): Add a helper that runs a given async generator on the runner loop and puts items into a queue (if we want to keep a single “run_and_stream” generator and avoid duplicating logic).

**Requirement (no disruption to multi-chat):** Users must still be able to send queries in multiple chats at the same time. So we must **not** run all streams on a single loop and block the second chat. **Implementation:** Use GraphRunner's loop only when it's **free** (no other stream is using it). When the runner is busy (another chat is already streaming), run the new request with the **current** behaviour (new event loop + per-request graph) so it runs **in parallel**. Result: first request gets graph reuse; second request gets its own loop and both streams run at the same time. No blocking of multiple chats.

**Risk:** Low if we fall back when runner is busy. Ensure no shared mutable state between requests.

---

## 4. Optional improvements (lower priority)

- **“Searching…” when executor starts:** We already emit a searching step from executor output (e.g. “Locating …”). Optionally emit a generic “Searching…” as soon as the executor node **starts** (on_chain_start for executor) so the UI shows it earlier. Small change in the same event loop in views.
- **Always yield something on exit:** Ensure we always send at least one SSE chunk (e.g. complete or error) so the frontend never hangs waiting. Current code already tends to do this; just verify error paths and timeouts.
- **Real-time responder tokens:** Today we capture the full response from the responder (or RunnableSequence) and then stream it in chunks. True token-by-token streaming would require the responder to stream from the LLM and the view to forward token events; larger change in [backend/llm/nodes/responder_node.py](backend/llm/nodes/responder_node.py) and views.

---

## Order of implementation

1. **Context manager fast path** – single file, few lines, immediate win for short conversations.
2. **Skip checkpoint for new chats** – one guarded block in views, small latency win on first message.
3. **Run streaming on GraphRunner** – refactor where the async stream runs and how chunks are bridged; biggest gain, more care needed.

Optional items can be done after or in parallel if desired.
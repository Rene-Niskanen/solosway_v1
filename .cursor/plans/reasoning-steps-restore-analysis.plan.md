---
name: ""
overview: ""
todos: []
isProject: false
---

# Reasoning Steps Restore Analysis

**Context:** User reported that for working queries they only see "Planning next moves" and "Generating response", while for non-working (no-info) queries they see "Planning next moves", "Searching", and "Generating response". The goal was to properly map reasoning steps (including which documents are being read) from tool calling to the backend and stream them to the frontend without slowing queries.

**Current State (post git restore):** Codebase matches commit `b7274cd` (agent loop node, profile columns, etc.). The following analysis identifies what exists, what is dead/broken, and what may still be missing.

---

## 1. What Exists and Works

### Backend (views.py)

- **Emitter setup:** `ExecutionEventEmitter` with `stream_queue` is created and passed in `initial_state["execution_events"]` (line 1077).
- **Phase event conversion:** When `payload.type == 'phase'` and `metadata.reasoning`, labels are converted to `reasoning_step` events (lines 1709–1737):
  - "Searched", "Searching for", "Finding", etc. → `searching_documents`
  - "Analysing N documents" → `analysing_documents`
  - "Found N sections" → `found_sections`
  - "No documents found", "No relevant", "Error occurred" → `search_status`
- **on_chain_start (agent_loop/executor):** Emits "Searching" immediately when `agent_loop` or `executor` starts (lines 1758–1770). Uses `details: {}` (no `_get_search_corpus_type_counts`).
- **on_chain_end (agent_loop/executor):** Handles `execution_results` to emit `found_documents` + per-doc `read_doc_exec_{i}` steps (lines 1946–2072).
- **Queue draining:** `consume_execution_events()` is called in the event loop before processing each graph event (line 1695).

### Agent Loop (agent_loop_node.py)

- Emits "Planning next moves" at iteration 0 (line 280).
- Emits search intro (e.g. "Finding valuation information") before each tool call (lines 318–322).
- Emits "Analysing N documents" when `retrieve_docs` returns (lines 341–345).
- Emits "Found N relevant sections" when `retrieve_chunks` returns (lines 346–351).
- Returns `execution_results` with `action`, `result` for each tool call (lines 333–338).

### Frontend (ReasoningSteps.tsx, SideChatPanel.tsx)

- `isSearchingActive` includes `nextStep.action_type === 'analysing'` so carousel animates during Generating (line 968).
- No `getAllDocuments` fetch when Searching step is shown (SideChatPanel).
- Step types: `planning`, `searching`, `reading`, `analysing`, `exploring`, etc. are rendered.

---

## 2. Dead or Obsolete Code

### query_vector_documents Handler (views.py, lines 1841–1935)

**Status: DEAD.** The node `query_vector_documents` was removed from the graph (see `main_graph.py` line 440: "REMOVED: query_vector_documents"). 

The views.py still has an `elif node_name == "query_vector_documents"` block that emits `found_documents` + `analyzing_documents` from `relevant_documents` in the node output. This path **never runs** because the graph now uses `agent_loop` instead.

**Impact:** No functional effect (code is unreachable), but it adds noise and confusion.

---

## 3. Potential Gaps / Why Working Queries Might Not Show Document Steps

### 3.1 LangGraph on_chain_end Event Structure

The views.py extracts `execution_results` like this:

```python
event_data = event.get("data", {})
state_update = event_data.get("data", {})
output = event_data.get("output", {})
state_data = state_update or output or event_data
execution_results = state_data.get("execution_results", [])
```

LangChain docs say `on_chain_end` has `data: { input, output }`, so `output` should be the node’s return value. For `agent_loop`, that is `{"execution_results": [...], "messages": [...]}`.

**Risk:** LangGraph’s `astream_events` for a `StateGraph` might wrap or rename the node output. If the actual structure differs (e.g. `output` is nested or uses different keys), `execution_results` would be empty and no found_documents/read steps would be emitted.

**Recommendation:** Add logging in the `agent_loop` on_chain_end handler to print `event_data` (or at least keys and shapes). Verify `execution_results` is present and non-empty.

### 3.2 execution_results Shape vs. Views Expectation

The handler expects:

- `action == "retrieve_docs"` and `result` → list of doc dicts
- `action == "retrieve_chunks"` and `result` → list of chunk dicts
- Chunks with `document_id` or `doc_id`

Agent loop stores:

```python
execution_results.append({
    "action": "retrieve_docs" | "retrieve_chunks",
    "result": result,  # from retrieve_documents() or retrieve_chunks()
    ...
})
```

- `retrieve_documents` returns items with `document_id`, `filename`, etc.
- `retrieve_chunks` returns formatted chunks with `document_id` in each.

So the shapes should match. A mismatch (e.g. different key names) could cause the handler to miss docs or chunks.

### 3.3 Event Ordering and Queue Drain Timing

Phase events are emitted by the agent loop into `stream_queue`. The main loop drains them with `consume_execution_events()` before processing each graph event.

If the graph emits events in large batches, or if the agent loop is slow to emit, phase events might be drained only after the responder has already started. The user might then see "Generating response" before "Analysing N documents" or "Found N sections".

**Mitigation:** Ensure phase events are emitted as soon as tool results are available, and that the queue is drained at the right points. Consider draining more frequently if needed.

### 3.4 Cache-First Path (document_cached)

When `use_cached_results` and `execution_results` are set, routing goes straight to `responder` and skips `agent_loop`. In that case, only "Planning next moves" and "Generating response" would appear, which matches the “working query” behaviour if the user is doing a follow-up.

**Question:** Are the “working queries” that lack document steps follow-up queries that hit the cache path?

---

## 4. What to Restore / Add

### 4.1 Verification Logging (Low Risk)

In `views.py`, inside the `elif node_name in ("executor", "agent_loop")` block (around line 1949):

```python
# Add temporary logging
logger.info("[REASONING_DEBUG] agent_loop on_chain_end: event_data keys=%s, has_output=%s, exec_results_len=%s",
    list(event_data.keys()) if isinstance(event_data, dict) else type(event_data),
    "output" in (event_data or {}),
    len(execution_results))
```

This confirms that `agent_loop` on_chain_end runs and that `execution_results` is populated.

### 4.2 Optional Cleanup

- Remove or comment out the dead `query_vector_documents` branch (lines 1841–1935) to avoid confusion.

### 4.3 If execution_results Is Empty

If logging shows `execution_results` is empty in on_chain_end:

1. Inspect the real `event` / `event_data` structure from LangGraph.
2. Adjust extraction (e.g. try `event.get("data", {}).get("output", {})` or whatever the actual structure is).
3. Ensure the agent loop return value is what LangGraph exposes in `on_chain_end`.

### 4.4 If Cache Path Is the Cause

If “working” queries are follow-ups and go through `document_cached`:

- Either accept that cached follow-ups skip detailed steps, or
- Optionally emit a synthetic “Using N cached documents” step before responder for cache-first requests (would need new logic in views or graph).

---

## 5. Summary Table


| Component                    | Status     | Notes                                              |
| ---------------------------- | ---------- | -------------------------------------------------- |
| Emitter + queue              | OK         | Correctly set up and passed to agent loop          |
| Phase event conversion       | OK         | Phase events → reasoning steps                     |
| on_chain_start Searching     | OK         | Emitted for agent_loop/executor                    |
| on_chain_end found_documents | UNVERIFIED | Assumes LangGraph event shape matches expectations |
| query_vector_documents       | DEAD       | Node removed; handler is unused                    |
| Frontend carousel            | OK         | Animates during Searching and Generating           |
| Frontend getAllDocuments     | OK         | Removed to avoid extra API call                    |


---

## 6. Recommended Next Steps

1. Add debug logging in the `agent_loop` on_chain_end handler and run a working query that should show document steps.
2. From logs, confirm:
  - `agent_loop` on_chain_end runs
  - `event_data` / `output` contain `execution_results`
  - `execution_results` has the expected structure
3. If the structure is wrong, update extraction logic to match the real event shape.
4. If the structure is correct but steps still do not appear, inspect frontend handling of `found_documents` and `read_doc_exec_*` (ReasoningSteps, message state, etc.).
5. Optionally remove the dead `query_vector_documents` handler once the above is resolved.


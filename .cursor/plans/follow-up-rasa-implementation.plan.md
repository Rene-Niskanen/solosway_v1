---
name: ""
overview: ""
todos: []
isProject: false
---

# Follow-Up Fix: Implementation Plan (Rasa-Aligned, Code-Ready)

## Goal

Make follow-up queries work by never overwriting checkpoint `document_ids` when the request did not provide document scope. Align with Rasa: only the graph writes conversation scope; the request must not send or overwrite it.

---

## Rasa ↔ Velora alignment (cross-reference)


| Rasa                                                                                                                                 | Velora (this plan)                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request never sends slot values; only `sender_id`, message text, optional metadata.                                                  | We never put `document_ids` in `initial_state` unless the request **explicitly** provided scope (user attached docs or selected property). So a plain follow-up message does not send scope.                                  |
| Tracker is **loaded** from store by `sender_id`; stored slots come from store.                                                       | Checkpoint is loaded by `thread_id`; if we don't pass `document_ids` in input, LangGraph keeps the checkpoint's `document_ids` (from last turn).                                                                              |
| Only **events** update the tracker: `UserUttered`, `SlotSet` from actions, etc. Slots are set by actions, not by the HTTP request.   | Only the **graph** writes `document_ids`: the responder derives and persists them. The request only sets `document_ids` when it's an explicit user action (new attachment/property), not as "current state" on every message. |
| `log_message` → get tracker → `tracker.update(UserUttered(...))` → run actions → `save_tracker`. No slot merge from request.         | Build `initial_state` without `document_ids` for follow-ups → graph runs with checkpoint scope → responder writes `document_ids` → checkpoint saved. No overwrite of scope from request.                                      |
| Metadata from request is applied only at **session start** (`SlotSet(SESSION_START_METADATA_SLOT, metadata)`), not on every message. | `citation_context`, `response_mode`, `property_id` are request-level; we keep those. Scope (`document_ids`) is conversation memory and follows the rule above.                                                                |


**Conclusion:** Our logic is the same as Rasa's applied to Velora: conversation scope is stored state, written only by the pipeline; the request must not send or overwrite it except when the user explicitly sets new scope (attach/select).

---

## Current State

- **Streaming path** ([backend/views.py](backend/views.py) ~706–764): Already fixed. Uses `effective_document_ids` and only sets `initial_state["document_ids"]` when request provided scope (attachment or property-resolved).
- **Non-streaming path** ([backend/views.py](backend/views.py) ~3586–3618): **Bug.** Sets `initial_state["document_ids"] = document_ids if document_ids else None`, which overwrites the checkpoint with `None` on follow-ups (no attachment).
- **Responder / Planner:** No changes needed.

---

## Implementation (copy-paste ready)

All edits are in **backend/views.py** in the non-streaming `/api/llm/query` path. Use search-and-replace with the exact strings below (indentation is 8 spaces for the block level).

---

### Step 1: Insert effective_document_ids and property resolution (before initial_state)

**Find this exact text** (around line 3604–3606):

```python
            except Exception as e:
                logger.warning(f"Could not find document for property {property_id}: {e}")
        
        # Build initial state for LangGraph
```

**Replace with** (keep the `except` block as-is; add the new block between it and `# Build initial state`):

```python
            except Exception as e:
                logger.warning(f"Could not find document for property {property_id}: {e}")
        
        # When request sent no document_ids but we resolved one from property_id, pass it to the graph
        effective_document_ids = document_ids if document_ids else ([document_id] if document_id else None)
        
        # Scope resolution: when user sent document_ids but no property_id, resolve property_id from first document
        resolved_property_id = None
        if (not property_id) and effective_document_ids and len(effective_document_ids) > 0:
            try:
                supabase = get_supabase_client()
                first_doc_id = effective_document_ids[0] if isinstance(effective_document_ids[0], str) else str(effective_document_ids[0])
                rel_result = supabase.table('document_relationships')\
                    .select('property_id')\
                    .eq('document_id', first_doc_id)\
                    .limit(1)\
                    .execute()
                if rel_result.data and len(rel_result.data) > 0 and rel_result.data[0].get('property_id'):
                    resolved_property_id = rel_result.data[0]['property_id']
                    logger.info(f"Resolved property_id from document(s): {resolved_property_id}")
            except Exception as e:
                logger.warning("Could not resolve property_id from document_ids: %s", e)
        
        effective_property_id = property_id or resolved_property_id
        
        # Build initial state for LangGraph
```

**Note:** `get_supabase_client` is already imported/used in this view; no new import needed.

---

### Step 2: Build initial_state without document_ids; set document_ids only when request provided scope

**Find this exact text** (lines 3605–3618; line numbers shift after Step 1):

```python
        # Build initial state for LangGraph
        # Note: conversation_history will be loaded from checkpoint if thread_id exists
        # Only provide minimal required fields - checkpointing will restore previous state
        initial_state = {
            "user_query": query,
            "user_id": str(current_user.id) if current_user.is_authenticated else "anonymous",
            "business_id": business_id,
            "session_id": session_id,
            "property_id": property_id,
            "document_ids": document_ids if document_ids else None,  # NEW: Pass document IDs for fast path
            "citation_context": citation_context,  # NEW: Pass structured citation metadata (bbox, page, text)
            "response_mode": response_mode if response_mode else None,  # NEW: Response mode for attachments (fast/detailed/full) - ensure None not empty string
            "attachment_context": attachment_context if attachment_context else None  # NEW: Extracted text from attached files - ensure None not empty dict
        }
```

**Replace with:**

```python
        # Build initial state for LangGraph
        # Note: conversation_history will be loaded from checkpoint if thread_id exists.
        # Do NOT pass document_ids when request has none – so checkpoint keeps responder-persisted
        # document_ids from the previous turn (follow-up stays on same doc(s)).
        initial_state = {
            "user_query": query,
            "user_id": str(current_user.id) if current_user.is_authenticated else "anonymous",
            "business_id": business_id,
            "session_id": session_id,
            "property_id": effective_property_id,
            "citation_context": citation_context,
            "response_mode": response_mode if response_mode else None,
            "attachment_context": attachment_context if attachment_context else None,
        }
        # Only set document_ids when request provided them (attachment or property). Otherwise leave unset so checkpoint keeps previous turn's document_ids for follow-ups.
        if effective_document_ids is not None and (not isinstance(effective_document_ids, list) or len(effective_document_ids) > 0):
            initial_state["document_ids"] = effective_document_ids
```

---

### Step 3: Perf log – use effective_document_ids for doc_ids_count

**Find this exact text** (around line 3721; line numbers shift after Steps 1–2):

```python
        logger.info("🟣 [PERF][QUERY] %s", json.dumps({
            "endpoint": "/api/llm/query",
            "session_id": session_id,
            "doc_ids_count": len(document_ids) if document_ids else 0,
            "timing": timing.to_ms()
        }))
```

**Replace with:**

```python
        logger.info("🟣 [PERF][QUERY] %s", json.dumps({
            "endpoint": "/api/llm/query",
            "session_id": session_id,
            "doc_ids_count": len(effective_document_ids) if effective_document_ids and isinstance(effective_document_ids, list) else 0,
            "timing": timing.to_ms()
        }))
```

---

### Step 4: Cleanup – remove unused follow-up code

Follow-up is now determined by **state** (document_ids in checkpoint), not by a separate module or heuristic. Remove the old unused code.

**4a. Delete the unused follow-up module**

- **File to delete:** [backend/llm/utils/follow_up.py](backend/llm/utils/follow_up.py)
- **Reason:** Nothing imports it. Follow-up behavior is driven by checkpoint scope (document_ids) and the planner; no pattern-based or heuristic follow-up detection is used.

**4b. Remove `is_follow_up` from state**

- **File:** [backend/llm/types.py](backend/llm/types.py)
- **Find this line** (around line 117):

```python
    is_follow_up: Optional[bool]  # Set by first-prompt classifier: True if current message continues same doc/topic
```

- **Action:** Delete that entire line (including the comment). No code sets or reads `is_follow_up`; follow-up is inferred from document_ids in checkpoint.

**4c. Fix outdated comment in main_graph**

- **File:** [backend/llm/graphs/main_graph.py](backend/llm/graphs/main_graph.py)
- **Find this comment** (around line 331):

```python
    # NEW: Context Manager Node (auto-summarize at 8k tokens; also sets is_follow_up from heuristic)
```

- **Replace with:**

```python
    # NEW: Context Manager Node (auto-summarize at 8k tokens)
```

---

## Summary and build order


| Step | File                             | Action                                                                                                                                                        |
| ---- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | backend/views.py                 | Search for the "Find" snippet in Step 1; replace with the "Replace with" block (adds `effective_document_ids`, property resolution, `effective_property_id`). |
| 2    | backend/views.py                 | Search for the "Find" snippet in Step 2; replace with the "Replace with" block (initial_state without `document_ids`, then conditional set).                  |
| 3    | backend/views.py                 | Search for the "Find" snippet in Step 3; replace with the "Replace with" block (perf log `doc_ids_count`).                                                    |
| 4a   | backend/llm/utils/follow_up.py   | Delete the file (unused; no imports).                                                                                                                         |
| 4b   | backend/llm/types.py             | Remove the `is_follow_up` line from `MainWorkflowState`.                                                                                                      |
| 4c   | backend/llm/graphs/main_graph.py | Update the context manager comment (remove "also sets is_follow_up from heuristic").                                                                          |


Do steps in order 1 → 2 → 3 → 4a → 4b → 4c. After Step 1, the line number of the initial_state block increases; use the exact "Find" strings to locate the next blocks.

---

## Double-check (no issues found)

- **Condition for setting `document_ids`:** Same as streaming path: set only when `effective_document_ids is not None` and (not a list or non-empty list). So we never write `document_ids: []` from the request; checkpoint is never overwritten with empty scope on follow-up.
- **Request sends `documentIds: []`:** After parsing, `document_ids` is `[]` (falsy). So `effective_document_ids = document_ids if document_ids else ([document_id] if document_id else None)` → we get `[document_id]` if property resolved, else `None`. We don't set `initial_state["document_ids"]` when `None` or when we'd set `[]` (the condition excludes empty list). So checkpoint is preserved.
- `**get_supabase_client`:** Already imported at top of `views.py`; no new import needed. Used in the new property-resolution block when resolving `property_id` from first document.
- **Variable scope:** `effective_document_ids` and `effective_property_id` are defined in the same `try` block as the rest of the route; they are in scope for Step 2 (initial_state) and Step 3 (perf log).

---

## Verification

1. **Streaming:** Unchanged; already correct.
2. **Non-streaming follow-up:** Same session (same `sessionId`): first message with property or attachment, then follow-up with no attachment (e.g. "Who are the parties?"). Second reply should be from the same document(s), not "couldn't find relevant information" or search across other docs.
3. **New attachment:** User sends new `documentIds` or different property → `effective_document_ids` is set and overwrites checkpoint scope as intended.


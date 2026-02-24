---
name: Fix agent_loop formatting mismatches
overview: Align agent_loop execution_results and format_instruction handling with the old planner→executor→responder path so response formatting matches the "good" state.
todos:
  - id: 1
    content: Normalize action name in agent_loop (retrieve_documents → retrieve_docs)
    status: pending
  - id: 2
    content: Add format_instruction extraction for agent_loop path
    status: pending
  - id: 3
    content: Accept both retrieve_docs and retrieve_documents in consumers (defensive)
    status: pending
  - id: 4
    content: Verify views.py and doc_chunk_cache handle both action names
    status: pending
  - id: 5
    content: Regression test document queries and format/refine flows
    status: pending
isProject: true
---

# Fix agent_loop Formatting to Match Pre-Unification State

**Goal:** Fix the formatting mismatches between the current agent_loop path and the old planner→executor→responder path so responses look and behave like they did when formatting was good.

**Root causes identified:**

1. **Action name mismatch:** agent_loop stores `action: "retrieve_documents"` but responder, follow_up_classifier, evaluator, and node_contracts expect `"retrieve_docs"`.
2. **Missing format_instruction:** The planner used to detect refine/format queries (e.g. "format that as bullet points") and set `format_instruction` in the execution plan. Agent_loop has no planner, so `format_instruction` is never set and the responder's format branch is never taken.

---

## Phase 1: Normalize action name in agent_loop

The executor (planner path) uses `action: "retrieve_docs"` in execution_results. The responder and all downstream consumers expect this. Agent_loop should emit the same shape for compatibility.

### File: `backend/llm/nodes/agent_loop_node.py`

**Change:** When appending to `execution_results`, store `action: "retrieve_docs"` when the tool was `RETRIEVE_DOCUMENTS`, not `"retrieve_documents"`.

```python
# Before (line ~338):
"action": RETRIEVE_DOCUMENTS if tool_name == RETRIEVE_DOCUMENTS else RETRIEVE_CHUNKS,

# After:
"action": "retrieve_docs" if tool_name == RETRIEVE_DOCUMENTS else "retrieve_chunks",
```

This aligns with the executor's output shape and fixes:

- `responder_node._build_responder_workspace_section` (fallback: line 351)
- `responder_node` no-chunks branch `has_documents` (line 2669)
- `follow_up_classifier.extract_document_ids_from_results` (line 239)
- `evaluator_node` has_documents (line 64)
- `node_contracts` RouterContract (line 266)

**Note:** views.py already handles both `"retrieve_docs"` and `"retrieve_documents"` (line 1851). No change needed there.

---

## Phase 2: Add format_instruction extraction for agent_loop path

The planner used to set `format_instruction` for refine/format queries (REFINE_PATTERNS: "make that into", "turn that into", "format that as", etc.). The responder's format branch (lines 2500–2532) only runs when `format_instruction` is non-empty.

### Option A (Recommended): Extract in responder when missing

Add logic at the start of `responder_node_impl` in `backend/llm/nodes/responder_node.py`:

1. If `format_instruction` is already set, skip.
2. If `user_query` matches `REFINE_PATTERNS` and we have `execution_results` or `prior_turn_content`, extract `format_instruction` from the user query.

**Implementation:**

- Import `REFINE_PATTERNS` and `_matches_any` from `planner_node` (or duplicate the constants in a shared util like `backend/llm/utils/format_extraction.py`).
- Add helper `_extract_format_instruction_from_query(user_query: str) -> Optional[str]`:
  - For patterns like "format that as X", "make that into X", extract X.
  - Simple regex: e.g. `re.search(r'format\s+that\s+as\s+(.+)', q, re.I)` or split on the pattern and take the remainder.
  - Fallback: use the full user_query when it matches REFINE_PATTERNS (generate_formatted_answer can interpret it).
- In `responder_node_impl`, after reading `format_instruction` from state:

```python
  if not format_instruction and _matches_any(user_query, REFINE_PATTERNS):
      format_instruction = _extract_format_instruction_from_query(user_query)
  

```

### Option B: Add a lightweight format-extractor node

Create a small node that runs before agent_loop when REFINE_PATTERNS match. It would set `format_instruction` in state. More intrusive (graph change); Option A is simpler.

### File: `backend/llm/nodes/responder_node.py`

- Add `_extract_format_instruction_from_query()` (or import from shared util).
- At the start of `responder_node_impl`, if `format_instruction` empty and REFINE_PATTERNS match, populate it.

### Shared constants (optional refactor)

Move `REFINE_PATTERNS` and `_matches_any` to `backend/llm/utils/format_extraction.py` so both planner_node and responder_node can import them without circular deps.

---

## Phase 3: Defensive acceptance of both action names

Even after Phase 1, some paths (e.g. cached execution_results from an older run, or future tool renames) might still have `"retrieve_documents"`. Add a small helper and use it everywhere we check for document-level retrieval.

### File: `backend/llm/utils/execution_results.py` (new)

```python
"""Helpers for execution_results compatibility (retrieve_docs vs retrieve_documents)."""

def is_doc_retrieval_action(action: str) -> bool:
    """True if action is document-level retrieval (retrieve_docs or retrieve_documents)."""
    return action in ("retrieve_docs", "retrieve_documents")
```

### Consumers to update (use helper)


| File                      | Current check                                 | Change                                |
| ------------------------- | --------------------------------------------- | ------------------------------------- |
| `responder_node.py`       | `action == "retrieve_docs"` (lines 351, 2669) | Use `is_doc_retrieval_action(action)` |
| `follow_up_classifier.py` | `action == "retrieve_docs"` (line 239)        | Use `is_doc_retrieval_action(action)` |
| `evaluator_node.py`       | `action == "retrieve_docs"` (line 64)         | Use `is_doc_retrieval_action(action)` |
| `node_contracts.py`       | `action == "retrieve_docs"` (line 266)        | Use `is_doc_retrieval_action(action)` |


---

## Phase 4: Verify views.py and doc_chunk_cache

### views.py

- Line 1851 already checks `r.get("action") in ("retrieve_docs", "retrieve_documents")`. **No change needed.**

### doc_chunk_cache / extract_document_ids_from_results

- `follow_up_classifier.extract_document_ids_from_results` is used when priming the cache. After Phase 3, it will accept both. **Verify** it works when execution_results have `"retrieve_documents"` (e.g. from agent_loop before Phase 1 is deployed, or from mixed sources).

---

## Phase 5: Regression testing

1. **Document query** – "What is the EPC rating of Highlands?" → agent_loop → responder. Verify:
  - Response has proper structure (headings, key facts, citations)
  - `_build_responder_workspace_section` gets document_ids (fallback path works)
  - Citations are inline and correctly mapped
2. **Format/refine query** – After answering a document question, follow up: "format that as bullet points". Verify:
  - `format_instruction` is set (from extraction)
  - Responder takes the format branch (`generate_formatted_answer`)
  - Output is reformatted as requested
3. **No-chunks path** – Query that finds documents but no relevant chunks. Verify:
  - `has_documents` is True (so message is "No relevant information found" not "No relevant documents found")
  - Works for both action names
4. **Cache-first follow-up** – Same-doc follow-up with `use_cached_results`. Verify:
  - `extract_document_ids_from_results` returns doc_ids correctly
  - Citations and formatting still correct

---

## File checklist


| File                                        | Phase | Changes                                                                              |
| ------------------------------------------- | ----- | ------------------------------------------------------------------------------------ |
| `backend/llm/nodes/agent_loop_node.py`      | 1     | Store `action: "retrieve_docs"` for RETRIEVE_DOCUMENTS                               |
| `backend/llm/nodes/responder_node.py`       | 2, 3  | Extract format_instruction when REFINE_PATTERNS match; use `is_doc_retrieval_action` |
| `backend/llm/utils/execution_results.py`    | 3     | **Create** – `is_doc_retrieval_action()` helper                                      |
| `backend/llm/utils/format_extraction.py`    | 2     | **Create** (optional) – REFINE_PATTERNS, `_extract_format_instruction_from_query`    |
| `backend/llm/nodes/planner_node.py`         | 2     | Optional: import REFINE_PATTERNS from format_extraction                              |
| `backend/llm/utils/follow_up_classifier.py` | 3     | Use `is_doc_retrieval_action(action)`                                                |
| `backend/llm/nodes/evaluator_node.py`       | 3     | Use `is_doc_retrieval_action(action)`                                                |
| `backend/llm/contracts/node_contracts.py`   | 3     | Use `is_doc_retrieval_action(action)`                                                |
| `backend/views.py`                          | 4     | **Verify** – already handles both (no change)                                        |


---

## Rollback

- Phase 1: Revert agent_loop to store `RETRIEVE_DOCUMENTS` as action.
- Phase 2: Remove format extraction; format branch will only run when planner sets it (not applicable on agent_loop path).
- Phase 3: Revert to direct `action == "retrieve_docs"` checks.


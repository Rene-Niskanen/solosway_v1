---
name: ""
overview: ""
todos: []
isProject: false
---

# Planner document_ids fix – high-level plan

## 1. Problem in one sentence

The planner sometimes outputs placeholder text as `document_ids` instead of real UUIDs or a step reference; the executor then sends that to the database, which errors, so retrieval returns nothing and the user sees "couldn't find any matching information" even when the right document exists.

---

## 2. Why it matters

- **Core document Q&A is broken** for many queries (no chip/property selected).
- We should **never** rely on the LLM to "copy" UUIDs from workspace text; document scope must come from **state** or from **step 1 (retrieve_docs)**.
- The current executor fallback (run retrieve_docs then retrieve_chunks when document_ids is empty) fixes the symptom but does not stop the planner from emitting invalid data. The fix is to correct the **source**: prompt, plan shape, and normalization so the executor only ever sees valid inputs.

---

## 3. Design principles

- **Single source of truth for document scope:** Either (a) `state.document_ids` (user selected docs), (b) `state.property_id` resolved to doc IDs in code (same DB query as workspace), or (c) step 1 result via `["<from_step_search_docs>"]`. Never free-form LLM text.
- **Deterministic when no scope:** If there is no document scope, the plan must always be 2 steps: retrieve_docs then retrieve_chunks with `document_ids = ["<from_step_search_docs>"]`. No 1-step plan with placeholder.
- **Don't create the mess:** Prefer enforcing the correct plan up front (no-scope → fixed 2-step in code, like the chip path for 1-step) rather than letting the LLM output a bad 1-step plan and then "normalizing" it. Normalizer is for edge cases only (e.g. invalid IDs when we have state.document_ids or property_id).
- **Validate/normalize for edge cases:** When the LLM path is used and document_ids are invalid but we have scope (state.document_ids or property_id), replace from state or resolve property_id in code. Executor only resolves `<from_step_*>` and valid UUIDs; fallback when step 1 returns no docs.
- **HyDE unchanged:** HyDE runs inside the retrieval tools. Fixing plan shape and document_ids only ensures those tools are invoked with valid inputs; no change to HyDE logic.

---

## 4. High-level changes

**4.1 No scope: fixed 2-step plan in code (primary)**

- When there is **no** document scope (no `state.document_ids`, no `state.property_id`), do **not** rely on the LLM to output 2 steps. In the planner node, **before** calling the LLM, check: if no document scope, inject a **fixed 2-step plan** (retrieve_docs then retrieve_chunks with `document_ids = ["<from_step_search_docs>"]`) and skip the LLM for plan shape—same idea as the existing "chip path" that injects a 1-step plan when the user has selected docs. This way we never create a bad 1-step plan for the no-scope case.

**4.2 Planner prompt (when LLM is used)**

- Remove any example that uses instructional text (e.g. "") as a value for `document_ids`. Use only real UUIDs or `["<from_step_search_docs>"]` in examples.
- Add an explicit rule: when there is no document scope, the plan **must** be 2 steps; never output placeholder or instructional text for `document_ids`. (This backs up the code path in 4.1 for any path where the LLM is still invoked.)

**4.3 Plan normalization (after LLM, for edge cases only)**

- Run only when the LLM was used (e.g. we have property_id or state.document_ids and got a 1-step plan). For every `retrieve_chunks` step with invalid `document_ids` (not valid UUIDs, not `<from_step_*>`):
  - If **state has `document_ids**`: replace this step's `document_ids` with `state.document_ids`.
  - Else if **state has `property_id**`: resolve property_id to document IDs via the same DB path as `build_workspace_context`, set this step's `document_ids` to that list.
  - Else: rewrite to canonical 2-step (safety net if no-scope somehow reached the LLM and returned bad 1-step).
- Run after parsing and after any existing plan normalization, before the plan is stored or emitted.

**4.4 Executor**

- Keep current behaviour: resolve `<from_step_*>` to IDs from previous step results; drop any non-UUID, non–from_step string. When a `retrieve_chunks` step ends up with no document_ids, run retrieve_documents then retrieve_chunks with the docs found (fallback for "step 1 returned no docs").
- No new logic required; the goal is that invalid document_ids never reach the executor because of prompt + normalizer.

**4.5 Where UUIDs come from (no LLM copying)**

- **User selected docs:** `state.document_ids` (chip path or normalizer).
- **Property in scope only:** DB query from `state.property_id` in normalizer (same as workspace context).
- **No scope:** Step 1 result; planner uses `["<from_step_search_docs>"]`, executor resolves from execution_results.

---

## 5. End-to-end flow (target behaviour)

1. User sends a query (e.g. "what is the value of highlands?") with no doc chip.
2. Planner node: no document scope → inject **fixed 2-step plan** in code (no LLM). Plan is step 1 retrieve_docs, step 2 retrieve_chunks with `document_ids = ["<from_step_search_docs>"]`.
3. Executor runs step 1: retrieve_documents(query). Document search returns a list of docs (e.g. Highlands valuation). Executor stores the result (all document_ids).
4. Executor runs step 2: resolves `["<from_step_search_docs>"]` to **all** document IDs from step 1's result, then retrieve_chunks(query, document_ids). All docs from step 1 are passed, not just one.
5. Chunks are returned; responder generates the answer. User sees the value.

If the user had selected a doc (chip), state has document_ids; either the chip path or the normalizer injects those, and a 1-step retrieve_chunks plan runs with valid IDs. No placeholder ever reaches the DB.

---

## 6. Sense check and validation (before sign-off)

Use this as a final pass to ensure the implementation is correct and clean.

**6.1 Trace: no scope (e.g. "what is the value of highlands?")**

- Planner node sees no document scope → injects fixed 2-step plan (no LLM). No bad 1-step plan is created.
- Executor: step 1 retrieve_docs runs → returns list of docs. Step 2 document_ids = resolve `<from_step_search_docs>` → **all** UUIDs from step 1 (executor collects every document_id from step 1 result). retrieve_chunks(query, those UUIDs) runs.
- No placeholder string is ever passed to Supabase. No UUID parse error. Chunks returned and answer generated.
- **Check:** Logs show "retrieve_documents" then "retrieve_chunks" with N document(s); no "invalid input syntax for type uuid". All docs from step 1 are passed to step 2.

**6.2 Trace: user selected doc (chip)**

- state.document_ids is set. Planner chip path builds 1-step plan with state.document_ids. No LLM output for plan shape. So document_ids are already valid.
- If for some reason the LLM path is taken and outputs invalid document_ids, normalizer sees state.document_ids and replaces step's document_ids with state.document_ids.
- Executor runs retrieve_chunks(query, state.document_ids). Works.
- **Check:** Chip flow still works; no double retrieve_docs when user already selected a doc.

**6.3 Trace: property in scope, no doc list in state**

- Workspace shows "Documents in scope" from property_id (built via document_relationships). Planner might output 1 step with invalid/placeholder document_ids.
- Normalizer: invalid document_ids and state has property_id → resolve property_id to document_ids (same query as build_workspace_context), inject into step.
- Executor runs retrieve_chunks(query, resolved document_ids). Works.
- **Check:** No reliance on LLM copying UUIDs from workspace text. Normalizer uses only state + DB.

**6.4 Code cleanliness**

- **No duplicate sources of truth:** Document IDs for retrieve_chunks come only from (a) state.document_ids, (b) property_id → DB in normalizer, or (c) step 1 result in executor. Nowhere do we parse "workspace text" or LLM output for UUIDs.
- **Executor:** Still only resolves `<from_step_*>` and validates UUIDs; fallback (retrieve_docs then retrieve_chunks when document_ids empty) remains for "step 1 returned no docs". No new edge cases introduced; we only reduce the chance of invalid document_ids reaching it.
- **Planner:** No-scope → fixed 2-step in code (no LLM); prompt has no placeholder and requires 2-step when no scope. Normalizer corrects invalid document_ids only when we have state/property_id or as a safety net.
- **HyDE and retrieval tools:** Unchanged. They receive (query, document_ids). Fix only ensures document_ids are valid and plan shape is correct.

**6.5 Failure modes**

- **LLM still outputs placeholder sometimes:** Normalizer rewrites to 2-step or injects from state/property_id. Executor never sees placeholder.
- **Step 1 returns no docs:** Executor fallback runs retrieve_documents then retrieve_chunks; user may get "no matching information" only when the document truly isn't found (e.g. wrong business, no such doc). Acceptable.
- **Normalizer bug (e.g. wrong property_id resolution):** Same as today if wrong docs are in scope; no new failure mode. Can add a unit test for normalizer: given invalid document_ids and state with property_id, expect document_ids to become list of UUIDs from DB.

**6.6 Sign-off checklist**

- No-scope path: planner node injects fixed 2-step plan in code when no document scope; no LLM for plan shape in that case.
- Prompt: no example with placeholder text; explicit rule for 2-step when no scope (backup for any LLM path).
- Normalizer: invalid document_ids → replace from state.document_ids, or from property_id via DB, or rewrite to 2-step; runs after other plan normalization (edge cases only).
- Executor: unchanged except already-done UUID filtering and fallback; step 2 receives all document_ids from step 1.
- Trace "no scope" path: fixed 2-step runs, no UUID error, answer returned when doc exists.
- Trace "chip" path: 1-step with state IDs, no regression.
- Trace "property only" path: normalizer injects IDs from DB; no LLM copy.
- HyDE and retrieval code: no changes; they receive valid inputs.

---

## 7. Files to touch (summary)

- **[backend/llm/nodes/planner_node.py](backend/llm/nodes/planner_node.py):** (1) **No-scope path:** When there is no document scope (no state.document_ids, no state.property_id), before calling the LLM, inject a fixed 2-step plan and skip the LLM for plan shape—mirror the existing chip path logic. (2) **Normalizer:** When the LLM was used and a retrieve_chunks step has invalid document_ids, replace from state.document_ids or resolve property_id via DB, or rewrite to 2-step; call after existing normalizations; pass state into normalizer. (3) Optional: helper to resolve property_id → list of document_ids (reuse or extract from workspace_context).
- **[backend/llm/prompts/planner.py](backend/llm/prompts/planner.py):** Remove placeholder from examples; add rule that 2-step is required when no scope and never output instructional text for document_ids.
- **[backend/llm/nodes/executor_node.py](backend/llm/nodes/executor_node.py):** No further changes if UUID filtering and fallback are already in place. Confirm step 1 result is used to pass **all** document_ids to step 2 (already implemented).

No changes to HyDE, document_retriever_tool, or chunk_retriever_tool.
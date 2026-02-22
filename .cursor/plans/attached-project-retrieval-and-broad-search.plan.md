# Attached project retrieval semantics and broad-search (implementation plan)

## Overview

This plan defines how attached project(s) affect retrieval context and makes **scope depend on the query**, not on attachment count. The planner decides whether to search only the attached project(s), only broadly, or both. We also fix single- and multi-project scope representation and add planner-driven **broad search** when the user asks for similar properties, comparables, or alternatives.

**Core principle: scope is query-dependent.** We only restrict search to the attached project(s) when the **query** is about those projects (e.g. “summarise this”, “what’s the valuation?”). When the query asks for **similar property**, **comparables**, or **alternatives**, restricting to the attached project would defeat the point—so the planner must use a broad search (or scoped + broad).

**Summary of behaviour:**
- **Query about the attached project(s)** (e.g. summarise, valuation, compare these) → planner outputs 1 or 2 steps with **scoped** retrieval (use `property_id` / `document_ids` from state). Scope = that project’s docs (or union of attached projects’ docs).
- **Query: similar property / comparables / alternatives** (with or without attachments) → planner outputs **3 steps**: scoped (for context on “this”) + **broad** (no scope) + chunks over union. Executor does not inject scope for the broad step.
- **One project attached** does **not** automatically mean “only search that project”; it means “we have that project as context; the planner chooses scoped vs broad vs both based on the query.”
- **Multiple projects attached** → same idea: context is union of those projects’ docs; planner still decides per query whether to scope to them or add a broad step.

---

## Part 1: Retrieval scope semantics (query-dependent)

### 1.1 Scope is decided by the planner based on the query

- **Attachments** provide context: `property_id` and/or `document_ids` (or union for multiple projects) are put in state so the executor *can* scope when the plan says so.
- **The planner** decides per query:
  - **Query about the attached project(s):** e.g. “summarise this property”, “what’s the valuation?”, “compare these two” → output 1 or 2 steps **without** `scope: "broad"`. The executor will inject state’s `property_id`/`document_ids`, so retrieval is scoped to the attached project(s). This is correct: we only search those projects.
  - **Query that needs data outside the attachment:** e.g. “find a similar property”, “comparables”, “alternatives” → output **3 steps** (scoped + broad + chunks). The broad step has `scope: "broad"` so the executor does **not** inject scope; we search the full corpus for similars. Limiting to the attached project for such a query would defeat the point.
- So: we only search “only the project” when the **query** is about that project. When the query is about finding similars/comparables/alternatives, we must not restrict to the project only.

### 1.2 Single project attached (context only; scope still depends on query)

- **State:** When the request has `property_id` and **no** user-provided `document_ids`, do **not** set `initial_state["document_ids"]` from the single-document lookup in `views.py`. Leave `document_ids` unset so that when the planner *does* choose a scoped step, the document retriever uses the `property_id` scope filter and returns all docs for that project (not one doc). Workspace context already resolves all docs for that property via `build_workspace_context(property_id, None, business_id)`.
- **Planner:** If the query is about that project → 1 or 2 steps, scoped. If the query is similar/comparables/alternatives → 3 steps with a broad step.

### 1.3 Multiple projects attached (context only; scope still depends on query)

- **Intent:** When the query is **about** those projects (e.g. “using these 2 projects, summarise”), scope = union of all attached projects’ documents.
- **Implementation:**
  - **Frontend:** When the user has multiple property attachments, send either multiple property IDs (e.g. `propertyIds: string[]`) or the **union** of document IDs from each project’s hub as `documentIds`. Prefer sending `documentIds` (union) so backend stays simple.
  - **Backend:** Accept `propertyIds` (array) or keep single `propertyId` and rely on `documentIds`. If `documentIds` is present and non-empty, use it as scope (already the case). If only `propertyIds` is sent (array), resolve in `views.py`: for each `property_id` in `propertyIds`, fetch document IDs from `document_relationships`, take the union, set `initial_state["document_ids"]` to that list; set `property_id` to first for workspace label if needed. If the API stays single `propertyId`, frontend must send the union of document IDs when multiple projects are attached.
- **Planner:** Same as single project: if query is about those projects → scoped steps (use state’s document_ids). If query is similar/comparables/alternatives → 3 steps with broad.

### 1.4 Priority when both project(s) and document chips are present

- If the user attaches **document** chips (explicit doc selection), those `document_ids` define the scoped context and take precedence. Current retriever already applies `document_ids` filter first, then `property_id`. No change. Planner still decides whether to add a broad step based on the query.

---

## Part 2: Broad search when user asks for similar property / comparables

### 2.1 Intent

When the user asks for things like “find me a similar property”, “comparables”, “alternatives”, “other properties like this”, the answer may require documents **outside** the attached project(s). **Searching only the attached project would defeat the whole point**—similars and comparables are by definition elsewhere. The system should:

1. Still use attached project(s) to understand “this” (scoped retrieval).
2. **Also** run an unscoped document search across the full corpus to find similar properties / comparables.
3. Run chunk retrieval over the **union** of docs from (1) and (2) so the responder can answer from both.

### 2.2 Approach: planner-driven broad step (Option A)

- The **planner** decides when the query needs external data (similar property, comparables, alternatives). When it does, it outputs **three** steps:
  1. `retrieve_docs` **scoped** (default): use current workspace/attachments so the model has context for “these” properties.
  2. `retrieve_docs` **broad**: same or refined query, with step-level flag so the executor does **not** inject `property_id`/`document_ids`.
  3. `retrieve_chunks` with `document_ids` = **union** of doc IDs from step 1 and step 2 (using two step references).

- **Executor:** For a `retrieve_docs` step, if the step has `scope: "broad"` (or `scope_broad: true`), call `retrieve_documents` **without** passing `property_id` or `document_ids` from state (so search is across all documents the user can access).
- **Step reference resolution:** When resolving `document_ids` for a `retrieve_chunks` step, allow **multiple** `"<from_step_StepId>"` entries; resolve each to the document IDs from that step’s result and merge into one list (union). So e.g. `["<from_step_search_docs>", "<from_step_search_broad>"]` → all doc IDs from step 1 and step 2.

### 2.3 Contract and types

- **ExecutionStep** ([backend/llm/types.py](backend/llm/types.py)): Add optional field  
  `scope: Optional[Literal["scoped", "broad"]]`  
  For `retrieve_docs` steps, default is `"scoped"` (current behaviour). When `"broad"`, the executor must not inject scope.
- **ExecutionStepModel** ([backend/llm/nodes/planner_node.py](backend/llm/nodes/planner_node.py)): Add optional field  
  `scope: Optional[str] = Field(default=None, description="For retrieve_docs: 'scoped' or 'broad'. Use 'broad' only for similar-property/comparables second search.")`  
  so the planner's structured output can emit it.
- **Planner output:** Allow **0, 1, 2, or 3** steps. Validator in [backend/llm/contracts/validators.py](backend/llm/contracts/validators.py): change from `len(plan["steps"]) in (0, 1, 2)` to `len(plan["steps"]) in (0, 1, 2, 3)` and document that 3 steps are used for “scoped + broad + chunks” flows.
- **Planner node** ([backend/llm/nodes/planner_node.py](backend/llm/nodes/planner_node.py)): If there is a check that `len(steps) != 2`, extend to allow 3 steps when the third is `retrieve_chunks` and the first two are both `retrieve_docs` (one can have `scope: "broad"`).

---

## Part 3: Planner prompt (property-specific, implementation-ready)

Add a **new numbered rule** and **examples** to the planner system prompt in [backend/llm/prompts/planner.py](backend/llm/prompts/planner.py). Keep wording specific to properties (similar property, comparables, alternatives); do not genericise to “external data”.

### 3.1 New rule (insert after the existing “2 steps (follow-up but no workspace)” rule)

**6. 3 steps (similar property / comparables / alternatives)** – When the user has attached one or more **projects** (or has a workspace with documents in scope) and asks to **find a similar property**, **comparables**, **alternatives**, **other properties like this**, or **what else is on the market like this**, you MUST output **3 steps**:

- **Step 1 – Scoped document search:** `retrieve_docs` with the user’s query (or a refined version, e.g. “valuation details [property name]” or “key attributes of attached properties”). Do **not** set `scope`. This step uses the current workspace (attached projects) so the system knows what “this” or “these” properties are.
- **Step 2 – Broad document search:** `retrieve_docs` with a query aimed at **finding similar properties or comparables** (e.g. “similar property valuation”, “comparable sales”, “alternative properties same area”). Set **`"scope": "broad"`** on this step so the system searches across all documents, not only the attached projects. Use a short, keyword-rich `query` and a clear `reasoning_label` (e.g. “Searching for similar properties”).
- **Step 3 – Chunk retrieval:** `retrieve_chunks` with `document_ids` set to **both** step 1 and step 2 results. Use the exact step IDs from steps 1 and 2 in the document_ids array, e.g. `["<from_step_search_docs>", "<from_step_search_broad>"]`. Set `query` to a keyword-rich phrase that matches what the user wants (e.g. “similar property comparables valuation location”).

Only use this 3-step pattern when the user’s intent clearly requires looking **outside** the attached projects (similar property, comparables, alternatives). For such queries, do **not** output only 1 or 2 scoped steps—that would limit the search to the attached project(s) and defeat the point. For normal summarisation or questions only about the attached projects, use 1 or 2 steps (scoped) as before.

**Intent edge cases (robustness):** "Compare these two" / "compare the attached" → scoped. "Compare to similar" / "find comparables" → 3 steps. When there is **no** workspace and user asks for similar/comparables, use **2 steps** with step 1 having scope: "broad". Strong 3-step triggers: "similar property", "comparables", "alternative properties", "other properties like this", "what else is on the market".

### 3.2 Prompt text to add (exact copy-paste style)

Add the following block to `PLANNER_SYSTEM_PROMPT` in `planner.py` after the existing step-5 paragraph (before "FIELDS:"):

```
6. **3 steps (similar property / comparables / alternatives)** – When the user has attached project(s) or has "Documents in scope" and asks to find a **similar property**, **comparables**, **alternatives**, **other properties like this**, or **what else is on the market like this**, output exactly 3 steps:
   - Step 1: retrieve_docs with query describing the attached property/ies (e.g. "valuation and key details [property name]"). Do not set scope (defaults to scoped). reasoning_label e.g. "Understanding the selected properties".
   - Step 2: retrieve_docs with query aimed at similar properties/comparables (e.g. "similar property valuation comparables", "comparable sales same area"). Set "scope": "broad" on this step. reasoning_label e.g. "Searching for similar properties".
   - Step 3: retrieve_chunks with document_ids = ["<from_step_<Step1Id>>", "<from_step_<Step2Id>>"] (use the actual step ids from step 1 and 2), query e.g. "similar property comparables valuation location". reasoning_label e.g. "Reviewing relevant passages from selected and similar properties".
   Only use 3 steps for this intent; do not scope-only to the attached project(s) for similar/comparables or the search would be pointless. For normal questions only about the attached projects, use 1 or 2 steps.
   **When there is NO workspace** (no attached projects) and the user asks for similar property or comparables: output **2 steps** only—step 1 retrieve_docs with "scope": "broad", step 2 retrieve_chunks with document_ids = ["<from_step_<Step1Id>>"]. Do not use 3 steps when there are no attached projects.
   **Compare:** "compare these two [attached]" = scoped (1 or 2 steps). "compare to similar" / "find comparables" = 3 steps (or 2 with broad if no workspace).
```

### 3.3 FIELDS update

In the FIELDS bullet for `steps`, add:

- For retrieve_docs steps you may set **scope**: `"scoped"` (default) or `"broad"`. Use `"broad"` only for the second retrieve_docs step when the user asks for similar property, comparables, or alternatives.
- Steps array may have **0, 1, 2, or 3** steps. Use 3 steps only for the similar-property/comparables flow above.

### 3.4 Examples to add

**3 steps (similar property, user attached one project):**
```json
{"objective": "Find a similar property to the attached one", "steps": [
  {"id": "search_docs", "action": "retrieve_docs", "query": "valuation and key details attached property", "reasoning_label": "Understanding the selected property"},
  {"id": "search_broad", "action": "retrieve_docs", "query": "similar property valuation comparables", "scope": "broad", "reasoning_label": "Searching for similar properties"},
  {"id": "search_chunks", "action": "retrieve_chunks", "query": "similar property comparables valuation location", "document_ids": ["<from_step_search_docs>", "<from_step_search_broad>"], "reasoning_label": "Reviewing passages from selected and similar properties"}
], "use_prior_context": false, "format_instruction": null}
```

**3 steps (comparables, user attached two projects):**
```json
{"objective": "Find comparables to these two properties", "steps": [
  {"id": "search_docs", "action": "retrieve_docs", "query": "key attributes and valuation both properties", "reasoning_label": "Understanding the two selected properties"},
  {"id": "search_broad", "action": "retrieve_docs", "query": "comparable sales similar valuation area", "scope": "broad", "reasoning_label": "Searching for comparables"},
  {"id": "search_chunks", "action": "retrieve_chunks", "query": "comparables valuation location attributes", "document_ids": ["<from_step_search_docs>", "<from_step_search_broad>"], "reasoning_label": "Reviewing relevant passages"}
], "use_prior_context": false, "format_instruction": null}
```

---

## Part 4: Executor changes

### 4.1 Resolve step references for multiple retrieve_docs steps

**File:** [backend/llm/nodes/executor_node.py](backend/llm/nodes/executor_node.py)

In `resolve_step_references`, when resolving `document_ids` for a step:

- For each entry in `document_ids`:
  - If it is a string of the form `"<from_step_<StepId>>"` (e.g. `"<from_step_search_docs>"`, `"<from_step_search_broad>"`), extract `StepId`, find the execution result with `step_id == StepId` and action `retrieve_docs`, and collect all `document_id` from that result’s `result` list.
  - If it is a valid UUID string, keep it.
- Merge all collected document IDs (union) and set `resolved_step["document_ids"]` to that list (deduplicated, order can be step order then by doc appearance).

So after resolution, a step with `document_ids: ["<from_step_search_docs>", "<from_step_search_broad>"]` gets a single list of all doc IDs from both steps.

### 4.2 Honour scope: "broad" for retrieve_docs

**File:** [backend/llm/nodes/executor_node.py](backend/llm/nodes/executor_node.py)

Where `retrieve_documents` is called for a `retrieve_docs` step (the direct path and the fallback path when a `retrieve_chunks` step has no document_ids):

- Read `resolved_step.get("scope")` (or `resolved_step.get("scope_broad")` if you use a boolean).
- If the step has **`scope == "broad"`** (or `scope_broad == True`):
  - Call `retrieve_documents(..., property_id=None, document_ids=None, ...)` so no scope is applied (do not pass state’s `property_id` or `document_ids`).
- Otherwise (scoped, default):
  - Keep current behaviour: pass `property_id=state.get("property_id")`, `document_ids=_doc_ids` from state.

Apply the same logic in the **tool_execution_node** when the agent calls `retrieve_documents`: if the tool call’s args contain `scope: "broad"` (or a dedicated flag), do not overwrite with state’s `property_id`/`document_ids` for that call. (If the agent path does not use step-based plans, you can leave tool_execution_node as-is and rely on the executor path for the 3-step flow.)

---

## Part 5: Document retriever

**File:** [backend/llm/tools/document_retriever_tool.py](backend/llm/tools/document_retriever_tool.py)

- No change to filter logic: when `property_id` is None and `document_ids` is None or empty, no scope filter is applied (current behaviour).
- Optionally add a one-line comment at the scope-filter block (around line 582): “When the user attaches project(s), scope is all documents for that/those properties; when they attach specific documents, scope is those IDs. A step with scope=broad passes no property_id/document_ids here.”

---

## Part 6: Backend views.py (single-project and multi-project)

**File:** [backend/views.py](backend/views.py)

### 6.1 Single project, no document_ids

- In the stream endpoint, where you currently set `effective_document_ids = document_ids if document_ids else ([document_id] if document_id else None)` after looking up one `document_id` from `property_id`:
  - When the request has **`property_id`** and **no** `document_ids` (or empty), set **`effective_document_ids = None`** (or do not set `initial_state["document_ids"]`). Do not use the single-document lookup to populate `document_ids`. This keeps retrieval scoped by `property_id` to all docs for that project.

### 6.2 Multiple projects

- **Option A (recommended):** Keep request shape as today (`propertyId` single, `documentIds` array). When the frontend has multiple property attachments, it fetches document IDs for each (e.g. `getPropertyHubDocuments` per property), merges them into one array, and sends that as `documentIds`; optionally send the first `propertyId` for workspace label. Backend then sets `initial_state["document_ids"]` to that list and does not need to change.
- **Option B:** Add support for `propertyIds` (array) in the request. If `propertyIds` is present and non-empty, query `document_relationships` for each id, collect union of `document_id`, set `initial_state["document_ids"]` to that union; set `property_id` to `propertyIds[0]` for backward compatibility. If `documentIds` is also provided, let `documentIds` take precedence (user explicitly selected docs).

---

## Part 7: Frontend (multi-project)

**File:** [frontend-ts/src/components/SideChatPanel.tsx](frontend-ts/src/components/SideChatPanel.tsx) (and any other caller that builds the request)

- When building the request payload for the stream API:
  - If there are **multiple** property attachments (e.g. `propertyAttachments.length > 1`):
    - Either send **all** property IDs if the backend supports `propertyIds` (Option B above), or
    - For each attachment, obtain the list of document IDs for that project (e.g. from `propertyHub.documents` or via `getPropertyHubDocuments(propertyId)`), merge into one array (union), and send as `documentIds`; send `propertyId` as the first attachment’s id for workspace/labels (Option A).
- Ensure the backend receives either a single `propertyId` with no `documentIds` (single project, Part 6.1) or the union of document IDs when multiple projects are attached.

---

## Part 8: Validator and planner node

- **File:** [backend/llm/contracts/validators.py](backend/llm/contracts/validators.py)  
  Change validation from `len(plan["steps"]) in (0, 1, 2)` to `len(plan["steps"]) in (0, 1, 2, 3)`.

- **File:** [backend/llm/nodes/planner_node.py](backend/llm/nodes/planner_node.py)  
  If there is logic that assumes exactly 2 steps (e.g. `if len(steps) != 2`), extend it to allow 3 steps when the plan is the similar-property pattern (e.g. two `retrieve_docs` and one `retrieve_chunks`).

---

## Part 9: Responder

- No change required. It already consumes `execution_results` and `extract_chunks_with_metadata` gathers chunks from every `retrieve_chunks` result. The single `retrieve_chunks` step in the 3-step plan will have run with the merged document list, so its result already contains chunks from both scoped and broad docs.

---

## Implementation order (suggested)

1. **Types:** Add `scope` to `ExecutionStep` in `types.py`.
2. **Validator:** Allow 3 steps in `validators.py`.
3. **Planner prompt:** Add rule 6, FIELDS update, and examples in `planner.py`.
4. **Executor:** Implement multi-step reference resolution (union of doc IDs from multiple `<from_step_*>`) and `scope: "broad"` handling in `executor_node.py`.
5. **Views:** Single-project fix (do not set `document_ids` when only `property_id` is sent) in `views.py`.
6. **Frontend:** Multi-project: send union of document IDs (and/or `propertyIds` if backend extended) in `SideChatPanel.tsx`.
7. **Backend (optional):** Support `propertyIds` in views if you prefer backend to resolve union.
8. **Document retriever:** Optional comment in `document_retriever_tool.py`.
9. **Planner node:** Allow 3-step plans in `planner_node.py` where applicable.

---

## Summary table

Scope is **query-dependent**. Attachments supply context; the planner decides whether to scope or add a broad step.

| Query type | Scope behaviour | Notes |
|------------|-----------------|-------|
| About the attached project(s) (summarise, valuation, compare these) | Scoped to attached project(s) | Planner outputs 1 or 2 steps; executor injects property_id/document_ids. One project → all its docs (views: do not set document_ids from single-doc lookup). Multiple → union of their docs. |
| Similar property / comparables / alternatives | Scoped (for context) + broad (all docs) | Planner outputs 3 steps; step 2 has scope: "broad". We must not restrict to the project only or the search would be pointless. |
| Doc chips attached | Scoped to those document IDs when plan is scoped | document_ids take precedence; planner still decides broad when query asks for similars/comparables. |

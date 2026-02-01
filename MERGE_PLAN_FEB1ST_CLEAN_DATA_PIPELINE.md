# Merge Plan: feature/new-clean-data-pipeline → Local (Feb 1st)

**Goal:** Replace current retrieval logic entirely with the PR’s clean data pipeline. For conflicts (reasoning steps, state shape, graph structure), prefer the PR. Current retrieval is buggy; the PR introduces a two-level retrieval flow (documents → chunks) and a planner/executor/responder graph.

---

## Phase 1: Preserve current work (do first)

1. **Commit any uncommitted changes** (frontend components, Intro.mp4, etc.)
   ```bash
   git status   # confirm: AuthGuard, ChatPanel, DocumentPreviewModal, etc.
   git add -A
   git commit -m "WIP Feb 1st: frontend and local changes before clean-data-pipeline merge"
   ```

2. **Create and push backup branch `Feb1stprogress`**
   ```bash
   git checkout -b Feb1stprogress
   git push -u origin Feb1stprogress
   ```

3. **Return to integration branch**
   ```bash
   git checkout before.merge.feb1st
   ```
   (Or use a new branch, e.g. `integrate/clean-data-pipeline`, and do the merge there.)

---

## Phase 2: Understand the two codebases

### Current branch (before.merge.feb1st) – retrieval flow

- **Graph:** `main_graph.py` ~174 lines  
  - Linear: `rewrite_query` → `query_vector_documents` → `clarify_relevant_docs` → `process_documents` → `summarize_results`
- **Retrieval:** Single-level chunk retrieval
  - `retrieval_nodes.py`: `VectorDocumentRetriever`, `rewrite_query_with_context`, `query_vector_documents`, `clarify_relevant_docs`
  - No document-level step; goes straight to chunks + LLM clarify
- **State:** `MainWorkflowState` in `types.py` – simpler (e.g. `query_intent: str`, no `ExecutionPlan`, no `retrieved_documents`, no `messages`)

### PR branch (feature/new-clean-data-pipeline) – retrieval flow

- **Graph:** `main_graph.py` ~901 lines  
  - Router → `agent_node` (tools) → planner → executor → evaluator → responder; routing nodes for citations/attachments/navigation
  - Uses `ToolNode` / `ExecutionAwareToolNode`; tools drive retrieval
- **Retrieval:** Two-level pipeline
  - **Level 1:** `document_retriever_tool.py` – `retrieve_documents()` (document-level hybrid: vector + keyword)
  - **Level 2:** `chunk_retriever_tool.py` – `retrieve_chunks()` (chunks within Level 1 docs, with adaptive top_k/min_score)
  - Optional: `planning_tool.py` for planning
- **State:** Richer `MainWorkflowState`: `query_intent` (dict), `retrieved_documents`, `execution_plan`, `execution_results`, `messages`, `chunk_citations`, `execution_events`, etc.
- **New modules:** `backend/llm/contracts/`, `backend/llm/citation/` (citation_mapper, document_store, evidence_*), `backend/llm/utils/checkpointer_wrapper.py`, `execution_events.py`, `chunk_metadata.py`, `query_characteristics.py`, `session_manager.py`, `session_naming.py`; new nodes: `agent_node`, `planner_node`, `executor_node`, `evaluator_node`, `responder_node`, `no_results_node`, `context_manager_node`, `tool_execution_node`

**Conflict resolution rule:** For anything touching retrieval, graph structure, state shape, reasoning steps, or citations, **use the PR version**.

---

## Phase 3: Merge strategy

**Recommended:** Merge `feature/new-clean-data-pipeline` into your branch, then resolve conflicts by preferring the PR for backend LLM/retrieval/graph/views (stream endpoint).

1. **Fetch and merge**
   ```bash
   git fetch origin feature/new-clean-data-pipeline
   git merge origin/feature/new-clean-data-pipeline -m "Merge feature/new-clean-data-pipeline: replace retrieval with clean two-level pipeline"
   ```

2. **When conflicts occur:**  
   - **Backend LLM (graph, nodes, retrievers, tools, types, contracts, citation, utils):** keep **PR** version.  
   - **Backend `views.py` (e.g. `/api/llm/query/stream`, reasoning steps, initial_state, event handling):** keep **PR** version.  
   - **Frontend, auth, non-LLM backend:** keep **your** version unless the PR has a clear fix you want.  
   - **Config/env:** merge manually (e.g. keep both LANGSMITH and LANGCHAIN vars if PR adds them).

---

## Phase 4: Files to treat as “replace with PR” (retrieval + graph)

Use PR version for these (or add if new). In conflicts, choose **theirs** (PR).

| Area | Files |
|------|--------|
| **Graph** | `backend/llm/graphs/main_graph.py` |
| **State & contracts** | `backend/llm/types.py`, `backend/llm/contracts/` (all) |
| **Retrieval nodes** | `backend/llm/nodes/retrieval_nodes.py` |
| **New nodes** | `backend/llm/nodes/agent_node.py`, `planner_node.py`, `executor_node.py`, `evaluator_node.py`, `responder_node.py`, `no_results_node.py`, `context_manager_node.py`, `tool_execution_node.py` |
| **Routing** | `backend/llm/nodes/routing_nodes.py` |
| **Retrieval tools** | `backend/llm/tools/document_retriever_tool.py`, `chunk_retriever_tool.py`, `planning_tool.py`, `retrieval_tools.py` |
| **Retrievers** | `backend/llm/retrievers/__init__.py`, `vector_retriever.py`, `bm25_retriever.py`, `hybrid_retriever.py`, `sql_retriever.py` |
| **Citation** | `backend/llm/citation/` (replace or add; PR has `citation_mapper`, `document_store`, `evidence_*`) |
| **Utils** | `backend/llm/utils/checkpointer_wrapper.py`, `execution_events.py`, `chunk_metadata.py`, `query_characteristics.py`, `session_manager.py`, `session_naming.py` |
| **Processing/summary/formatting** | `backend/llm/nodes/processing_nodes.py`, `summary_nodes.py`, `formatting_nodes.py` |
| **Other LLM** | `backend/llm/config.py`, `prompts.py`, `tools/agent_actions.py`, `citation_mapping.py`, `sql_query_tool.py`; `combined_query_preparation.py`, `detail_level_detector.py`, `follow_up_query_node.py`, `query_classifier.py`, `text_context_detector.py`, `text_transformation_node.py`, `general_query_node.py` |
| **Stream endpoint & reasoning** | In `backend/views.py`: everything for `/api/llm/query/stream`, `initial_state` shape, `astream_events` handling, reasoning step emission – use **PR** logic (node names will be planner/executor/agent/responder, not rewrite_query/query_vector_documents/clarify_relevant_docs). |
| **Runtime** | `backend/llm/runtime/graph_runner.py` – use PR if it differs (e.g. checkpointer or graph build). |
| **Services** | `backend/services/chunk_quality_service.py`, `chunk_validation_service.py` (add if present in PR). |
| **Supabase** | PR may add `get_supabase_db_url_for_checkpointer` in `supabase_client_factory`; use PR. |
| **Migrations** | All new migrations under `backend/migrations/` from PR (e.g. `add_chunk_embedding_hnsw_index.sql`, `add_chunk_quality_score.sql`, `add_document_embedding_columns.sql`, `fix_voyage_embedding_dimensions.sql`, `rename_match_documents_function.sql`) – apply/keep PR versions. |

---

## Phase 5: Post-merge checklist

- [ ] **Build:** `pip install -r requirements.txt` (PR may add deps); run backend (e.g. `python main.py` or your start script).
- [ ] **Env:** Set any new vars the PR expects (e.g. LangSmith/LANGCHAIN_*, DB URL for checkpointer if used).
- [ ] **DB:** Run any new migrations from PR (document/chunk embeddings, HNSW, quality score, etc.).
- [ ] **Stream endpoint:** Send a test query to `/api/llm/query/stream`; confirm reasoning steps and final summary; confirm node names in events match PR graph (e.g. `planner_node`, `executor_node`, `agent_node`).
- [ ] **Citations:** Test citation flow (open doc, highlight) with PR citation/citation_mapper logic.
- [ ] **Frontend:** Confirm ChatPanel / DocumentPreviewModal / PropertyDetailsPanel still work with the new response shape (e.g. `final_summary`, reasoning steps structure).
- [ ] **Non-stream path:** If you have a non-stream LLM endpoint, call it and confirm it uses the new graph and state.

---

## Phase 6: If merge is too noisy (alternative)

If you prefer a smaller blast radius:

1. **Branch from PR:** `git checkout -b integrate/clean-pipeline origin/feature/new-clean-data-pipeline`
2. **Cherry-pick or re-apply** only your frontend and non-LLM changes from `Feb1stprogress` (e.g. `frontend-ts/`, `AuthGuard`, `ChatPanel`, etc.), then fix any breakage.

Use this if the merge produces too many conflicts; the “replace retrieval completely” goal is still satisfied because the base is the PR.

---

## Summary

| Step | Action |
|------|--------|
| 1 | Commit local changes, create and push `Feb1stprogress`. |
| 2 | Merge `origin/feature/new-clean-data-pipeline` into your branch. |
| 3 | Resolve conflicts: **PR wins** for retrieval, graph, state, reasoning steps, citations, and stream endpoint. |
| 4 | Run migrations, env, and tests; validate stream + citations + frontend. |

**Reasoning steps / event handling:** Use the PR’s `views.py` logic for the stream endpoint so reasoning steps and node names align with the new graph (planner → executor → responder and tool-driven retrieval).

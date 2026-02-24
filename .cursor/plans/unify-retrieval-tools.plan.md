---
name: ""
overview: ""
todos: []
isProject: false
---

# Unify Retrieval Tools: agent_loop → Shared LangChain Tools

**Goal:** Remove duplicate `retrieve_docs` / `retrieve_chunks` in agent_loop. Use the shared `retrieve_documents` and `retrieve_chunks` LangChain tools everywhere.

**Current state:** agent_loop has its own `_build_tool_definitions()` (OpenAI format) and `_execute_tool()` that manually calls `retrieve_documents()` / `retrieve_chunks()`. The rest of the app uses LangChain StructuredTools from `document_retriever_tool.py` and `chunk_retriever_tool.py`.

---

## Phase 1: Tool Registry (Optional but Recommended)

Create `backend/llm/tools/__init__.py` as a single place for tool definitions:

```python
"""Central tool registry - single source of truth for all LLM-callable tools."""

from backend.llm.tools.document_retriever_tool import create_document_retrieval_tool
from backend.llm.tools.chunk_retriever_tool import create_chunk_retrieval_tool
from backend.llm.tools.workspace_file_tool import (
    create_read_workspace_file_tool,
    create_write_workspace_file_tool,
)

def get_retrieval_tools():
    """Document + chunk retrieval tools (Level 1 + Level 2 RAG)."""
    return [
        create_document_retrieval_tool(),
        create_chunk_retrieval_tool(),
    ]

def get_workspace_tools():
    """USER.md read/write tools."""
    return [
        create_read_workspace_file_tool(),
        create_write_workspace_file_tool(),
    ]
```

Update `main_graph.py` and `agent_node.py` to import from this registry instead of importing individual tool factories.

---

## Phase 2: Make agent_loop Use Shared Tools

**Option A: agent_loop → ToolNode (Graph Change)**

Change agent_loop from a single node that does its own tool calling to a graph sub-graph: `agent_loop` (LLM) → `tools` (ToolNode) → `agent_loop` (loop). This matches the existing `agent` path structure.

- **Pros:** Full reuse of ExecutionAwareToolNode, consistent execution, shared state injection.
- **Cons:** Graph restructuring, agent_loop becomes an LLM node only; needs careful handling of `execution_results` for responder.

**Option B: agent_loop Keeps Its Loop, Uses Tools as Callables (Simpler)**

Keep agent_loop as one node with its own `bind_tools` + loop. Replace `_build_tool_definitions()` with the LangChain tools, and replace `_execute_tool()` with direct invocation of the tool's `func` (or `ainvoke`).

- **Pros:** Minimal graph change, agent_loop stays self-contained.
- **Cons:** Still manual execution; state injection must stay in agent_loop.

**Recommended: Option B** for lower risk. Option A can be a later refactor.

### Option B Steps

1. **agent_loop_node.py**
  - Remove `RETRIEVE_DOCS` / `RETRIEVE_CHUNKS` constants (or alias them to tool names).
  - Remove `_build_tool_definitions()`. Replace with:

```python
     from backend.llm.tools.document_retriever_tool import create_document_retrieval_tool
     from backend.llm.tools.chunk_retriever_tool import create_chunk_retrieval_tool
     tools = [create_document_retrieval_tool(), create_chunk_retrieval_tool()]
     llm_with_tools = llm.bind_tools(tools)
     

```

- In the tool-call loop, use tool names `retrieve_documents` and `retrieve_chunks` (not `retrieve_docs`).
- Replace `_execute_tool()` with a helper that:
  - Takes `tool_name`, `tool_args`, `state`.
  - Injects `business_id`, `property_id`, `document_ids` from state (same logic as `_inject_state_context`).
  - Looks up the tool by name and invokes it: `tool.invoke(injected_args)` or `tool.func(**injected_args)`.
- Update `execution_results` append logic to use `action == "retrieve_documents"` and `action == "retrieve_chunks"` (to match views.py `on_chain_end` handler).
- Update emitter labels: keep "retrieve_docs" → "retrieve_documents" in reasoning; no functional change needed if we keep the same labels for display.
- Update `_summarize_tool_result_for_context` to handle `retrieve_documents` instead of `RETRIEVE_DOCS`.

1. **views.py**
  - In the `agent_loop` `on_chain_end` handler, ensure we look for `action == "retrieve_documents"` and `action == "retrieve_chunks"` in `execution_results` (currently expects `retrieve_docs` and `retrieve_chunks`). Update the condition from `retrieve_docs` to `retrieve_documents`.

---

## Phase 3: Verify and Test

1. Run a document query through agent_loop (e.g. "what is the value of highlands?").
2. Confirm reasoning steps show Searching → Found documents → Reading → Generating.
3. Confirm response and citations are correct.
4. Run a user_context query (USER.md) through the `agent` path; confirm tools still work.
5. Run a cached follow-up; confirm no regressions.

---

## Phase 4: Cleanup

- Remove `_build_tool_definitions`, `_execute_tool` (replaced by shared tools).
- Remove any redundant helper logic.
- Update docstrings to reference the shared tools.

---

## File Checklist


| File                                   | Changes                                                         |
| -------------------------------------- | --------------------------------------------------------------- |
| `backend/llm/tools/__init__.py`        | **Create** – tool registry (Phase 1)                            |
| `backend/llm/nodes/agent_loop_node.py` | Use shared tools, invoke by name, update action names (Phase 2) |
| `backend/views.py`                     | Update `on_chain_end` to check `retrieve_documents` (Phase 2)   |
| `backend/llm/graphs/main_graph.py`     | Optional: import from registry (Phase 1)                        |
| `backend/llm/nodes/agent_node.py`      | Optional: import from registry (Phase 1)                        |


---

## Rollback

If issues arise, revert agent_loop_node.py to use `_build_tool_definitions` and `_execute_tool`; the underlying `retrieve_documents()` and `retrieve_chunks()` functions are unchanged.
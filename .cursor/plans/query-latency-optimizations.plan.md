---
name: Query Latency Optimizations
overview: Implement direct retrieval path and faster agent model to reduce query latency. Streaming removed due to citation/preview dependency.
todos:
  - id: direct-retrieval-heuristic
    content: Implement is_direct_doc_question() with generic doc-question heuristics
    status: pending
  - id: direct-retrieval-node
    content: Create direct_retrieval_node (retrieve_docs -> retrieve_chunks -> execution_results)
    status: pending
  - id: direct-retrieval-routing
    content: Add direct_retrieval branch and edges in main_graph.py
    status: pending
  - id: agent-model-config
    content: Add openai_agent_model config and use it in agent_loop_node
    status: pending
isProject: false
---

# Query Latency Optimizations (Revised)

## 1. Direct Retrieval Path (Bypass Agent for Doc Questions)

**Goal:** For clear document questions, skip the agent tool loop and run retrieval directly: `retrieve_docs -> retrieve_chunks -> responder`. Saves 2–3 LLM calls (agent tool decisions).

**Routing:** Add a new branch in `after_context_manager` in [main_graph.py](backend/llm/graphs/main_graph.py). Before routing to `agent_loop`, check `is_direct_doc_question(user_query)`. If true, route to a new `direct_retrieval` node.

**Heuristics (generic, not property-focused):**


| Category          | Patterns                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Summarisation     | `summarise`, `summarize`, `overview`, `key points`, `main points`, `what does it say`, `give me a summary` |
| Search/intent     | `find`, `search for`, `look for`, `show me`, `get me`, `where does it`                                     |
| Question patterns | `explain`, `describe`, `what is`, `what are`, `how does`, `tell me about`, `extract`, `list the`           |
| Document context  | `in the document`, `in this file`, `from the doc`                                                          |


**Exclusions:** Queries already handled by earlier branches (greetings, `user_context`), queries shorter than ~8 chars, and phrases that suggest agent-only tasks (`edit`, `write`, `change`, `update`).

**New node:** `direct_retrieval_node`:

- If `document_ids` in state (e.g. from chip): call `retrieve_chunks` only.
- Else: call `retrieve_documents`, then `retrieve_chunks` with returned doc IDs.
- Build `execution_results` in the same shape as agent_loop.
- Return state with `execution_results` set, route to `responder`.

**Graph changes:** Add `direct_retrieval` node and edge: `context_manager -> direct_retrieval -> responder`.

---

## 2. Faster Model for Agent Tool Selection

**Goal:** Use a cheaper/faster model (e.g. `gpt-4o-mini`) only for the agent’s tool-calling decisions. Keep the main model for the final answer. Cuts ~1–2 seconds per agent call.

**Config:** Add to [config.py](backend/llm/config.py):

```python
openai_agent_model: str = os.environ.get('OPENAI_AGENT_MODEL', 'gpt-4o-mini')
```

**Usage:** In [agent_loop_node.py](backend/llm/nodes/agent_loop_node.py) (line 449), replace `config.openai_model` with `config.openai_agent_model` for the agent loop. The responder keeps `config.openai_model` for answer quality.

---

## File Summary


| File                                                                                   | Changes                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [backend/llm/config.py](backend/llm/config.py)                                         | Add `openai_agent_model`                                |
| [backend/llm/nodes/agent_loop_node.py](backend/llm/nodes/agent_loop_node.py)           | Use `config.openai_agent_model` for agent LLM           |
| [backend/llm/graphs/main_graph.py](backend/llm/graphs/main_graph.py)                   | Add `direct_retrieval` node, routing, and edges         |
| [backend/llm/nodes/routing_nodes.py](backend/llm/nodes/routing_nodes.py) or new module | Add `is_direct_doc_question()`, `direct_retrieval_node` |



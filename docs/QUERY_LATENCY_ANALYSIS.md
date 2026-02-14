# Query Response Latency Analysis

This document explains what happens when a user submits a query and what is making the response slow.

## End-to-end flow (summary)

1. **Frontend** → `queryDocumentsStreamFetch()` in `frontend-ts/src/services/backendApi.ts` → `POST /api/llm/query/stream`
2. **Backend** → `query_documents_stream()` in `backend/views.py` → `generate_stream()` → `run_and_stream()` (async generator)
3. **Stream execution** runs in a **new thread with a new event loop** (see below). Inside that loop:
   - A **new checkpointer** and **new compiled graph** are created for every request
   - The LangGraph is executed via `graph.astream_events(initial_state, config)`
4. **Graph path** (typical document query):  
   `START → simple_route → context_manager → classify_intent → planner → executor → evaluator → responder → format_response → END`

---

## Major latency sources (in order of impact)

### 1. Per-request graph + checkpointer creation (high impact)

**Where:** `backend/views.py` inside `run_and_stream()` (lines ~1002–1035).

**What happens:** For each request, the streaming path:

- Creates a **new asyncio event loop** in a dedicated thread (`run_async_gen()` → `asyncio.new_event_loop()`).
- Because the graph must run on that loop (and `GraphRunner`’s graph is bound to a different loop), the code **does not** use the pre-built graph from `GraphRunner`. Instead it:
  - Calls `create_checkpointer_for_current_loop()` → DB connection/pool, `checkpointer.setup()` (with timeout).
  - Calls `build_main_graph(use_checkpointer=True, checkpointer_instance=checkpointer)` → full graph construction and compile.

**Why it’s slow:** Checkpointer creation can involve DB connections and schema setup; graph build compiles the entire LangGraph (all nodes and edges). This cost is paid **on every query**.

**Rough order:** Hundreds of ms to low seconds, depending on DB and machine.

---

### 2. Planner node – LLM call (high impact)

**Where:** `backend/llm/nodes/planner_node.py` → `planner_node()`.

**What happens:** For non–chip queries (no pre-selected documents), the planner:

- Builds a system + user prompt (initial or follow-up).
- Calls `llm.ainvoke(messages_to_use)` (OpenAI `config.openai_planner_model`, typically gpt-4o-mini).
- Parses the response into a structured execution plan (steps: `retrieve_docs`, `retrieve_chunks`).

**Why it’s slow:** One full LLM round-trip before any retrieval or answer. No streaming until the plan is done.

**Rough order:** ~0.5–2+ seconds depending on model and prompt size.

**Note:** When the user has selected documents (chip query), the planner **skips the LLM** and builds a fixed 1-step plan (retrieve_chunks only).

---

### 3. Document retrieval – embedding + DB (high impact)

**Where:** `backend/llm/tools/document_retriever_tool.py` → `retrieve_documents()`.

**What happens:**

1. **Embedding:** One call to Voyage AI (or OpenAI fallback) to embed the query.
2. **Vector search:** Supabase RPC `match_document_embeddings` with the query embedding.
3. **Keyword search:** Supabase `documents` table query with ILIKE on `summary_text`, `original_filename`, etc.
4. **Business filtering:** Optional extra Supabase read to filter by `business_uuid`.
5. **Fusion:** Combine vector + keyword results and score.

**Why it’s slow:** Embedding API latency + multiple Supabase round-trips (RPC + table query + optional filter). All sequential in one tool call.

**Rough order:** ~0.3–1.5+ seconds.

---

### 4. Chunk retrieval – embedding + per-document DB work (high impact)

**Where:** `backend/llm/tools/chunk_retriever_tool.py` → `retrieve_chunks()`.

**What happens:**

1. **One embedding:** Voyage (or OpenAI) embeds the query once.
2. **Per document:**
   - **Vector:** Supabase RPC `match_chunks` with query embedding and `target_document_id`.
   - **Keyword (non-summarize):** Supabase `document_vectors` with ILIKE on `chunk_text` / `chunk_text_clean`.
   - **Bbox fetch:** Optional extra Supabase read for chunks missing `bbox`/`blocks`.
3. Merge vector + keyword, rerank, apply per-doc and global limits.

**Why it’s slow:** One embedding plus **N document rounds** (vector RPC + keyword + bbox). More documents ⇒ more round-trips and more work.

**Rough order:** ~0.2–1s for embedding + ~0.2–0.5s+ per document (depends on DB and chunk count).

---

### 5. Responder node – LLM call (high impact for TTFB)

**Where:** `backend/llm/nodes/responder_node.py`.

**What happens:** The responder builds a large prompt (execution results, citations, evidence, formatting rules) and calls the LLM to generate the final answer. Response is streamed, but **time to first token** still waits for:

- Prompt construction (including citation/evidence formatting).
- One LLM round-trip up to the first token.

**Why it’s slow:** Big prompt + model latency. Users don’t see text until this first token arrives.

**Rough order:** ~0.5–2+ seconds to first token, then streaming.

---

### 6. Context manager node (lower impact)

**Where:** `backend/llm/nodes/context_manager_node.py` (and routing).

**What happens:** Token counting / summarization for long conversations. Typically cheap unless it triggers summarization (extra LLM call).

---

### 7. Classify intent (negligible)

**Where:** `backend/llm/nodes/routing_nodes.py` → `classify_intent()`.

**What happens:** Pure heuristics (keywords, document_ids, property_id, greetings). **No LLM.**

---

### 8. Evaluator node (medium impact if it loops)

**Where:** `backend/llm/nodes/evaluator_node.py`.

**What happens:** Can invoke an LLM to decide whether to continue execution, refine the plan, or go to the responder. If it triggers a refinement loop, you pay another planner + executor cycle.

---

## Flow diagram (simplified)

```
Request → generate_stream()
            → run_async_gen() [new thread + new event loop]
                  → run_and_stream()
                        → create_checkpointer_for_current_loop()  ← slow
                        → build_main_graph()                      ← slow
                        → graph.astream_events(initial_state)
                              → context_manager
                              → classify_intent (fast)
                              → planner (LLM)                     ← slow
                              → executor
                                    → retrieve_documents (embed + Supabase)  ← slow
                                    → retrieve_chunks (embed + N×Supabase)   ← slow
                              → evaluator (maybe LLM, maybe loop)
                              → responder (LLM, stream)            ← slow (TTFB)
                              → format_response
```

---

## Recommended next steps (short list)

1. **Reuse graph/checkpointer per request where possible**  
   - Run the stream on the same event loop as `GraphRunner` (e.g. submit work to the runner’s loop and stream from there), or  
   - Use a small pool of pre-created loops + graph/checkpointer instances so each request doesn’t create a new checkpointer and `build_main_graph()`.

2. **Reduce planner latency**  
   - Consider a lighter/faster model or a cached “plan template” for common query shapes.  
   - Keep the chip path (no LLM planner) for document-scoped queries.

3. **Parallelize retrieval where possible**  
   - e.g. Run document embedding + keyword search in parallel; run chunk retrieval across documents in parallel (with a cap) instead of strictly sequential.

4. **Optimize chunk retrieval**  
   - Reduce per-document round-trips (e.g. ensure `match_chunks` returns bbox/blocks where possible to avoid extra bbox fetch).  
   - Consider batching or limiting the number of documents passed to chunk retrieval.

5. **Improve responder TTFB**  
   - Shrink or simplify the responder prompt where safe.  
   - Consider streaming from a smaller/faster model for the start of the answer if architecture allows.

6. **Add timing logs**  
   - Log durations for: checkpointer creation, graph build, planner, retrieve_documents, retrieve_chunks (per doc), responder to first token. Use these to validate improvements.

---

## Where timing is already logged

- **views.py:** `_Timing()` and `timing.mark(...)` (e.g. `parsed_request`, `business_id`, `checkpointer_created`, `graph_built`, `graph_execution_start`, `node_<name>_start` / `node_<name>_end`).
- **Node end events:** If a node takes >1s, it’s logged as `⏱️ [PERF] Node '<name>' took X.XXs` (see `views.py` around the `on_chain_end` handler).

Checking backend logs for these marks and `[PERF]` lines will show which of the above steps dominate in your environment.

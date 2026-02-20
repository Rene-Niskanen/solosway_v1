---
name: ""
overview: ""
todos: []
isProject: false
---

# Plan: Other time efficiencies (beyond parallel chunk retrieval)

## Context

Parallel chunk retrieval is done: when **multiple documents** are passed to `retrieve_chunks`, per-document chunk search runs in parallel. Remaining bottlenecks from LangSmith traces:

1. **First executor step (~5–6s):** `retrieve_documents` (document-level search).
2. **Responder / LLM (~12–13s):** Single `ChatOpenAI` call; "time to first token" is the full generation time because the responder uses `ainvoke` (no token streaming).

This plan outlines **concrete, low-risk improvements** for those two areas, plus optional follow-ups.

---

## 1. Document retrieval (first executor step): run vector and keyword in parallel

**Current flow in** [backend/llm/tools/document_retriever_tool.py](backend/llm/tools/document_retriever_tool.py):

1. Get query embedding (HyDE when enabled).
2. **Vector search:** `supabase.rpc('match_document_embeddings', ...)`.
3. **Keyword search:** `supabase.table('documents').select(...).or_(...).limit(...).execute()`.
4. Business filter, merge, score, entity gating, threshold, then **step 8: per-doc chunk check** (loop over `filtered_results`, one `document_vectors` select per doc), then top_k.

Vector and keyword are independent after the embedding. Running them in parallel can save roughly the smaller of the two (often ~1–3s).

**Design:**

- After `query_embedding = get_query_embedding_for_retrieval(query)`:
  - Start two tasks: one runs the vector RPC, one runs the keyword query (and fallback filename search if used).
  - Use `concurrent.futures.ThreadPoolExecutor(max_workers=2)` or a simple `threading.Thread` pair and `join`.
  - Use the same Supabase client in both threads **only if** the Supabase client is documented as thread-safe for concurrent calls; otherwise create one extra client for the second task (e.g. `create_supabase_client_uncached()` for the keyword task).
- Merge results exactly as today (business filter on vector results, merge into `vector_results_dict`, keyword scoring, etc.). No change to scoring or thresholds.

**Risks:** Supabase client thread-safety. Mitigation: use a dedicated client for the keyword path if the main client is not safe for concurrent use (same pattern as chunk retriever).

**Files:** `backend/llm/tools/document_retriever_tool.py` only. No change to executor or graph.

---

## 2. Document retrieval: parallelize or batch the "has chunks" check

**Current (step 8):** For each doc in `filtered_results`, a loop does:

```python
chunk_check = supabase.table('document_vectors').select('id').eq('document_id', doc_id).limit(1).execute()
```

So N documents ⇒ N round-trips. For 5–8 docs this can add ~0.5–2s depending on latency.

**Option A – Batch in one query:** One query that returns which of the candidate doc IDs have at least one chunk, e.g.:

- `SELECT DISTINCT document_id FROM document_vectors WHERE document_id = ANY($1)` (or equivalent with `in_('document_id', doc_ids)` in Supabase).
- Build the set of doc_ids that have chunks; filter `filtered_results` to those.

**Option B – Parallel per-doc checks:** If batching is awkward (e.g. RPC/API limits), run the existing per-doc check in a small thread pool (e.g. 4 workers), one client per worker, then merge.

Recommendation: **Option A** if Supabase supports `in_('document_id', doc_ids)` and returning distinct document_id; else Option B.

**Files:** `backend/llm/tools/document_retriever_tool.py` only.

---

## 3. Embedding reuse (optional)

**Current:** `retrieve_documents` and `retrieve_chunks` each call `get_query_embedding_for_retrieval(query)`. HyDE already caches by query (TTL 60s), so the second call is often a cache hit. No change required for correctness.

**Optional optimization:** When the executor runs both steps with the same query, the planner/executor could call the embedding once and pass it (e.g. in state or as an optional argument). That would avoid a cache lookup and any rare duplicate work. Lower priority than 1 and 2.

---

## 4. Responder / time to first token

**Current:** The responder uses `generate_conversational_answer_with_citations` → `structured_llm.ainvoke(...)`. The full answer is generated before the node returns. The backend then receives `final_summary` and streams it to the client in chunks. So "time to first token" in LangSmith is the **full LLM generation time** (~12s); the user sees no text until the entire response is ready.

**Options (in order of impact vs effort):**

### 4a. True LLM streaming in the responder (largest impact)

- In the responder, use the LLM’s **streaming** API (e.g. `astream` or `stream` on the chat model) instead of `ainvoke`.
- Stream tokens (or short chunks) into the existing **execution_events** mechanism (emitter) so the backend can forward them as `type: 'token'` SSE events as they arrive.
- The backend already has a loop that consumes events and yields tokens; it would need to handle a new event type (e.g. `stream_token` from the responder) and yield it immediately instead of waiting for `final_summary`.
- **Result:** User sees first tokens as soon as the model produces them; time to first token drops to model latency (e.g. 1–3s) instead of full generation time.

**Complexity:** Medium–high. Requires:

- Responder to produce a stream of tokens and emit them via the same emitter/queue the graph uses.
- Views to map that stream to SSE `token` events and to still collect the full text for `final_summary` (e.g. concatenate streamed tokens) for citations and completion payload.
- Care that citation extraction still runs on the full text once the stream is complete.

### 4b. Reduce context size (medium impact, lower effort)

- Reduce the number or length of chunks passed into the responder prompt (e.g. lower `per_doc_limit`, or truncate chunk text to a max length).
- Fewer tokens in context ⇒ faster reading and sometimes faster generation. Trade-off: slightly less context for the model.

### 4c. Faster model for responder (configurable)

- Use a faster/smaller model (e.g. a dedicated env var like `OPENAI_RESPONDER_MODEL`) for the responder only. Reduces latency at the cost of possible quality; make it configurable so it can be reverted.

---

## 5. Implementation order


| Priority | Item                                                            | Expected gain                                    | Risk                                |
| -------- | --------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------- |
| 1        | Doc retrieval: parallel vector + keyword (Section 1)            | ~1–3s on first executor step                     | Low (same results, order preserved) |
| 2        | Doc retrieval: batch or parallel "has chunks" check (Section 2) | ~0.5–2s on first executor step                   | Low                                 |
| 3        | Responder: true LLM streaming (Section 4a)                      | Large drop in time to first token (~10s → ~1–3s) | Medium (stream plumbing, citations) |
| 4        | Responder: reduce context or faster model (4b, 4c)              | Moderate                                         | Low                                 |


Recommendation: implement **1** and **2** first (document retrieval only, no change to responder or streaming). Then, if time to first token is still the main complaint, implement **4a** (true streaming) with tests to ensure citations and `final_summary` remain correct.

---

## 6. What not to change

- Executor node: still calls `retrieve_documents` and `retrieve_chunks` the same way.
- Chunk retriever: already parallel; no change.
- Graph structure, planner, evaluator: no change.
- Public API of `retrieve_documents` (inputs and return shape): unchanged.

---

## 7. Verification

- **Document retrieval:** Run a query that hits the first executor step; compare LangSmith trace for that step before/after (expect a few seconds shorter). Confirm document list and order are unchanged.
- **Responder streaming (if done):** Run a query; confirm first token appears in the UI within a few seconds of "Summarising content", and that the full answer and citations are unchanged.

---

## Summary

- **Doc retrieval:** Parallelize vector + keyword search; batch or parallelize the "has chunks" check. Same behaviour, fewer seconds on the first executor step.
- **Responder:** Best gain is true LLM streaming so the first token is sent as soon as the model produces it; optional: smaller context or faster model.
- Implement doc retrieval optimizations first; then add responder streaming if time to first token remains the main issue.


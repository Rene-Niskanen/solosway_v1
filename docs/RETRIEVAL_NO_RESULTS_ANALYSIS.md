# Analysis: Why Retrieval Returns No Information

This document analyzes potential causes for empty retrieval results (no chunks, no documents, or generic "no information" responses) in the backend.

---

## End-to-end flow

1. **Planner** → produces execution plan: `retrieve_docs` then `retrieve_chunks`
2. **Executor** → runs `retrieve_documents` → gets doc IDs
3. **Executor** → resolves `document_ids` from step 1 result (e.g. `<from_step_search_docs>`)
4. **Executor** → runs `retrieve_chunks(query, document_ids)` 
5. **Chunk retriever** → for each doc: calls `match_chunks_hybrid` RPC (or direct select for summarize)
6. If chunks empty → executor fallback: `search_document_vectors` (global search)
7. **Responder** → receives `execution_results` with chunks → generates answer

---

## Potential failure points

### 1. **match_chunks_hybrid RPC fails or returns empty**

**Symptoms:** `retrieve_chunks` returns `[]`, no chunks for the responder.

**Possible causes:**

- **RPC not found:** Migration not run on the DB the app connects to (e.g. prod vs local). PostgREST would return 404 or function-not-found. The Python client may raise or return empty.
- **Parameter type mismatch:** `target_document_id` expects UUID; if an invalid string is passed (e.g. unresolved `"<from_step_search_docs>"`), PostgreSQL casts fail and the RPC errors.
- **docs CTE returns 0 rows:** In `match_chunks_hybrid`, `docs` is `SELECT ... FROM documents WHERE id = target_document_id`. If the document is missing, `docs` is empty. `CROSS JOIN docs` then yields 0 rows for both vector and keyword branches, so the RPC returns nothing even when `document_vectors` has rows for that `document_id` (e.g. if the FK allows orphans or the document was deleted after retrieval).
- **Lazy embedding:** Chunks with `embedding IS NULL` are excluded from vector search. Keyword search does not use `embedding`, so those chunks can still match. If both vector and keyword return nothing, either there are no chunks or none match.
- **Overly strict vector threshold:** `match_threshold = max(0.2, effective_min_score * 0.5)` — for "fact" queries this is 0.3. Chunks with similarity ≤ 0.3 are excluded from vector results. Keyword search can still return matches.

### 2. **document_ids not resolved**

**Symptoms:** `retrieve_chunks` gets invalid or placeholder IDs.

**Possible causes:**

- **Planner output:** Step has `document_ids: ["<from_step_search_docs>"]` but the previous `retrieve_docs` result is missing or malformed.
- **Step ID mismatch:** Reference `<from_step_search_docs>` looks for `step_id == "search_docs"`. If the planner uses a different ID (e.g. `"search_documents"`), the reference is not resolved.
- **Result shape:** `resolve_step_references` expects `retrieve_docs` result to be a list of `{document_id: "uuid", ...}`. If the shape differs, document IDs are not extracted.
- **Empty retrieve_docs:** If `retrieve_documents` returns `[]`, there is nothing to resolve and `document_ids` stay unresolved.

### 3. **Business ID filtering removes all documents**

**Location:** `chunk_retriever_tool.py` lines 157–166.

```python
business_map = {str(doc['id']): doc.get('business_uuid') for doc in doc_check.data or []}
valid_document_ids = [doc_id for doc_id in valid_document_ids if str(business_map.get(doc_id)) == business_id]
```

**Possible causes:**

- **Key mismatch:** `business_map` keys are `str(doc['id'])`. If Supabase returns `doc['id']` in a different format (e.g. with/without hyphens), `business_map.get(doc_id)` can be `None`, and all documents get filtered out.
- **business_uuid vs business_id:** Comparison `str(business_map.get(doc_id)) == business_id` assumes `business_id` matches `business_uuid`. A mismatch would drop documents.

### 4. **Embedding generation fails**

**Location:** Before chunk retrieval (HyDE, extraction-guided, or raw query embedding).

**Possible causes:**

- **Extraction-guided retrieval:** Fetches document text and calls an LLM to extract a passage. If this fails or returns `None`, the code falls back to HyDE/raw. If that also fails, `query_embedding` is `None` and the retriever returns `[]`.
- **HyDE / Voyage API errors:** Network issues, rate limits, or invalid API keys cause embedding calls to fail. `get_query_embedding_for_retrieval` returns `None`.
- **Empty query:** If the query is empty or becomes empty after processing, embedding or downstream logic may fail.

### 5. **retrieve_documents returns 0 documents**

Upstream of chunk retrieval; no documents means no document IDs and no chunks.

**Possible causes:** See `docs/QUERY_LATENCY_ANALYSIS.md` and `document_retriever_tool.py` (entity gating, thresholds, keyword/vector search logic).

### 6. **Fallback global search fails**

**Location:** `executor_node.py` 534–554.

When `retrieve_chunks` returns empty, the executor calls `vector_service.search_document_vectors()`, which uses the `search_document_vectors` RPC.

**Possible causes:**

- **RPC missing:** `search_document_vectors` may not exist in the DB.
- **RPC signature mismatch:** Parameter names or types differ from what the Python client sends.
- **RPC returns empty:** Same semantics as above (no matches, bad params, etc.).

### 7. **Exceptions swallowed**

**Location:** `_chunks_for_one_document` in `chunk_retriever_tool.py`:

```python
except Exception as doc_error:
    logger.warning(f"   Failed to retrieve chunks for document {doc_id[:8]}: {doc_error}")
    return []
```

RPC errors (e.g. function not found, type errors) are caught and converted to `[]`, so the caller sees no chunks and cannot tell if the failure was due to bad input, missing RPC, or a transient error.

---

## Recommended next steps

1. **Improve error logging:** Log the full exception (including traceback) when `match_chunks_hybrid` fails, not only a short message.
2. **Add fallback to old retrieval path:** If `match_chunks_hybrid` raises or returns empty, retry with the previous approach (`match_chunks` + keyword + bbox + doc metadata). This isolates RPC issues from logic issues.
3. **Verify RPCs exist:** Confirm `match_chunks_hybrid` and `search_document_vectors` exist in the target database (e.g. Supabase SQL editor or migration logs).
4. **Log resolved document_ids:** In the executor, log the `document_ids` passed to `retrieve_chunks` to ensure they are valid UUIDs.
5. **Check backend logs:** Search for `[EXECUTOR]`, `[RETRIEVER]`, `[PERF]`, `Failed to retrieve chunks`, and `No chunks found` to identify where the pipeline fails.

---

## Quick diagnostics

Run a query and inspect logs for:

- `[EXECUTOR] Calling retrieve_chunks: '...' (N documents)` — N should be > 0.
- `[RETRIEVER] Query profile: ...` — confirms the retriever is invoked.
- `match_chunks_hybrid found M chunks` — M > 0 means the RPC returned results.
- `Failed to retrieve chunks for document` — indicates an RPC or per-document error.
- `[EXECUTOR] ⚠️ No chunks found` — chunk retrieval returned empty before fallback.
- `[EXECUTOR] Global chunk search fallback returned N chunks` — fallback succeeded.

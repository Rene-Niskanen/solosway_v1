---
name: ""
overview: ""
todos: []
isProject: false
---

# HyDE retrieval integration (robust)

Integrate HyDE (Hypothetical Document Embeddings) into the two-level RAG so vector search uses an LLM-generated hypothetical answer embedding instead of the raw user query, improving recall when user wording does not match document wording (e.g. "declare themselves legally" vs "commission"). Keyword search always uses the original query. Plan includes reuse of one HyDE per query, robust prompt (preserve entities), skip-HyDE heuristic for short queries, low temperature, and clear failure behaviour.

---

## 1. Goal and constraints

- **Goal:** Improve retrieval for natural-language questions whose phrasing does not match the documents (e.g. Knight Frank commission / legal declaration).
- **Vector path only:** HyDE affects only the embedding used for vector similarity search. Keyword search (ILIKE, exact matches) always uses the **original user query**.
- **Never surface HyDE:** Hypothetical text is never shown to the user; the answer is always built from **retrieved chunks** and the final LLM. Failure mode of HyDE is "wrong docs retrieved", not "fake facts shown".
- **No new API keys:** Reuse existing `OPENAI_API_KEY` (HyDE generation + optional embedding fallback) and `VOYAGE_API_KEY` (embeddings when enabled).

---

## 2. Config

**File:** [backend/llm/config.py](backend/llm/config.py)

Add:

- `use_hyde: bool = os.getenv("USE_HYDE", "false").lower() == "true"` (default off).
- `hyde_num_docs: int = int(os.getenv("HYDE_NUM_DOCS", "2"))` (number of hypothetical paragraphs to generate and average).
- `hyde_model: str = os.getenv("HYDE_MODEL", "") or openai_model` (LLM for hypothetical text).
- `hyde_skip_max_words: int = int(os.getenv("HYDE_SKIP_MAX_WORDS", "5"))` (skip HyDE when query word count ≤ this; use raw query embed for short/keyword-like queries).

No other config changes.

---

## 3. New module: `backend/llm/hyde.py`

Single responsibility: generate hypothetical documents and produce the embedding used for vector retrieval, with optional caching so one query reuses one HyDE for both retrieval levels.

### 3.1 HyDE prompt (robust)

Use a single system/user prompt that:

- **Anchors to the question:** "Write exactly [N] short paragraphs that could appear in a factual document that **answers this exact question**. Use only information implied by the question."
- **Document-style language:** "Use factual, formal language and terminology typical of property/legal/business documents (e.g. commission, disclosure, agreement, particulars, valuation)."
- **Preserve entities:** "**Preserve all specific names, addresses, street names, company or person names, property names, and document names from the user's question.** Do not generalise or remove them."
- **No speculation:** "Do not add facts or details not implied by the question. Each paragraph: 2–4 sentences only."

This keeps hypotheticals on-topic, in document vocabulary, and entity-preserving (so "Knight Frank", "Banda Lane", etc. stay in the text and the embedding).

### 3.2 `generate_hypothetical_documents(query: str, num: int = 2) -> List[str]`

- Sync; use OpenAI API (`config.openai_api_key`, `config.hyde_model`).
- **Temperature:** `0` or `0.2` for stable, focused output.
- Return list of non-empty strings (one per paragraph). Parse response (e.g. split by double newline or numbered points); strip and filter empty. On API failure or empty list, return `[]`.
- Log at debug: "HyDE generated N hypothetical docs" / "HyDE failed or empty, will use raw query".

### 3.3 `get_query_embedding_for_retrieval(query: str) -> Optional[List[float]]`

- **Skip-HyDE heuristic:** If `query` has word count ≤ `config.hyde_skip_max_words` (default 5), do **not** call HyDE; embed the raw `query` with `input_type='query'` and return. This avoids over-interpreting short/keyword-like queries (e.g. "Banda Lane deposit") and keeps exact matches strong.
- **When HyDE is off:** Embed `query` with `input_type='query'`, return. (Same as current behaviour.)
- **When HyDE is on and query is long enough:**
  - **Cache (reuse one HyDE per query):** Use an in-memory cache keyed by normalized query (e.g. `query.strip()[:500]`) with TTL 30–60 seconds. If cache hit, return cached embedding. This way the same query used for `retrieve_documents` and then `retrieve_chunks` reuses one HyDE generation (saves ~0.3–0.5s and keeps doc/chunk search aligned).
  - On cache miss: call `generate_hypothetical_documents(query, num=config.hyde_num_docs)`. If the list is empty, **fall back** to embedding raw `query` with `input_type='query'`, cache that, return.
  - Else: embed the hypothetical strings with `**input_type='document'**` (Voyage) or equivalent (OpenAI); if multiple vectors, **average element-wise**; cache and return.
- Use same Voyage/OpenAI and env vars as current tools: `USE_VOYAGE_EMBEDDINGS`, `VOYAGE_API_KEY`, `VOYAGE_EMBEDDING_MODEL`, and OpenAI fallback.
- On any embedding failure, return `None` (callers return `[]`).

### 3.4 Voyage `input_type`

- Stored doc/chunk embeddings use `input_type='document'`. HyDE text is hypothetical **document** content, so embed with `input_type='document'`. Raw query always uses `input_type='query'`.

---

## 4. Document retriever

**File:** [backend/llm/tools/document_retriever_tool.py](backend/llm/tools/document_retriever_tool.py)

- Replace the entire "Generate query embedding" block (Voyage + OpenAI fallback) with:
  - `query_embedding = get_query_embedding_for_retrieval(query)` from `backend.llm.hyde`.
  - If `query_embedding is None`, `return []`.
- Leave unchanged: keyword search, score fusion, query_type/thresholds, business filtering, scope filter, entity boost, all parameters.
- Docstring: "When HyDE is enabled, vector search may use embeddings of hypothetical answer text (entity-preserving); keyword search always uses the original query."

---

## 5. Chunk retriever

**File:** [backend/llm/tools/chunk_retriever_tool.py](backend/llm/tools/chunk_retriever_tool.py)

- **Summarize path:** Do not call `get_query_embedding_for_retrieval` (we do not use embeddings there). No change.
- **Non-summarize path:** Replace the "Generate query embedding" block with:
  - `query_embedding = get_query_embedding_for_retrieval(query)`.
  - If `query_embedding is None`, `return []`.
- Leave unchanged: query profile heuristics, keyword search, fusion/reranking, all other logic.
- Docstring: Same as document retriever (vector may use HyDE when enabled; keyword always original query).

Because of the cache in `get_query_embedding_for_retrieval`, the same user query used for doc then chunk retrieval will reuse one HyDE (one LLM call per query instead of two).

---

## 6. Cleanup and consistency

- **Single place for retrieval embedding:** All retrieval embedding logic (HyDE on/off, Voyage/OpenAI, averaging) lives in `hyde.get_query_embedding_for_retrieval`. No duplicated Voyage/OpenAI blocks in the two tools.
- **Doc/comment:** In document_retriever_tool, optionally add a one-line comment that `query_type` is planner/agent-provided (no in-tool heuristic) to avoid confusion with docstring wording.
- **Conflicting logic:** None. HyDE only changes the vector embedding input; keyword, query_type, thresholds, and fusion are unchanged.

---

## 7. Fallbacks and edge cases

- **USE_HYDE=false:** Behaviour identical to current (embed raw query).
- **HyDE generation fails or returns empty:** Fall back to embedding raw query; do not fail the request.
- **Embedding failure:** Return `None`; both tools return `[]` (existing behaviour).
- **Short query (≤ N words):** Skip HyDE; embed raw query (better for keyword-heavy/exact-match queries).
- **Executor fallback (global chunk search):** No change in this implementation; continues to use raw query in `SupabaseVectorService`. Optional later: use `get_query_embedding_for_retrieval` there too.

---

## 8. Call sites and prompts

No changes to:

- [backend/llm/nodes/executor_node.py](backend/llm/nodes/executor_node.py), [backend/llm/graphs/main_graph.py](backend/llm/graphs/main_graph.py), [backend/llm/nodes/agent_node.py](backend/llm/nodes/agent_node.py), [backend/llm/nodes/tool_execution_node.py](backend/llm/nodes/tool_execution_node.py), [backend/llm/nodes/routing_nodes.py](backend/llm/nodes/routing_nodes.py).
- Agent or planner prompts ([backend/llm/prompts/agent.py](backend/llm/prompts/agent.py), [backend/llm/prompts/planner.py](backend/llm/prompts/planner.py)).

Tool names and signatures unchanged.

---

## 9. Testing and validation

- **Manual:** With `USE_HYDE=true`, run a Knight Frank–style question and confirm docs/chunks about commission/disclosure are retrieved when present.
- **Short query:** Query with ≤5 words (e.g. "Banda Lane deposit") and confirm behaviour (no HyDE; raw query embed).
- **Regression:** With `USE_HYDE=false`, run existing flows; confirm no behaviour change.
- **Optional unit test:** `generate_hypothetical_documents` returns non-empty list for a simple query; prompt preserves entities when present in query; `get_query_embedding_for_retrieval` returns correct dimension and respects skip heuristic.

---

## 10. Summary of files


| File                                                                                         | Action                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [backend/llm/config.py](backend/llm/config.py)                                               | Add `use_hyde`, `hyde_num_docs`, `hyde_model`, `hyde_skip_max_words`.                                                                     |
| **New** `backend/llm/hyde.py`                                                                | Implement prompt (3.1), `generate_hypothetical_documents` (3.2), `get_query_embedding_for_retrieval` (3.3) with cache and skip heuristic. |
| [backend/llm/tools/document_retriever_tool.py](backend/llm/tools/document_retriever_tool.py) | Replace embedding block with `get_query_embedding_for_retrieval(query)`; update docstring.                                                |
| [backend/llm/tools/chunk_retriever_tool.py](backend/llm/tools/chunk_retriever_tool.py)       | Replace embedding block in non-summarize path with `get_query_embedding_for_retrieval(query)`; update docstring.                          |


No changes to views, executor call sites, agent/node wiring, or prompts beyond optional comments.
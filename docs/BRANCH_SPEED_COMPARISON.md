# Why `feature/merge-citation-with-speed-improvements` Was Faster Than Current Branch

This document compares the **speed branch** (`feature/merge-citation-with-speed-improvements`) with the **current branch** (`velora/working-well-new-version.streaming`) and explains why the former felt quicker.

---

## Summary: What Changed

The current branch replaced the **linear, rule-based pipeline** (with cache and simple-path skips) with a **planner → executor → evaluator → responder** pipeline. That added extra LLM calls and removed the cache/skip optimizations that made the speed branch fast.

| Aspect | Speed branch | Current branch |
|--------|--------------|----------------|
| **First step** | `check_cached_documents` → often skip retrieval | No cache; every query goes through context_manager → planner |
| **Routing** | `route_query` (no LLM): direct / simple / complex | `simple_route`: only fast paths; rest → planner |
| **Plan** | Implicit (graph structure); no planner LLM | **Planner node** (LLM) generates execution plan |
| **Retrieval** | One node `query_vector_documents` (hybrid retriever); could skip if cached | **Executor** calls tools: `retrieve_documents` then `retrieve_chunks` (each with embedding + DB) |
| **Simple queries** | simple_search → straight to `query_vector_documents` (no rewrite, no expand, no detail_level) | All document queries go through planner → executor (no “simple path” skip) |
| **Answer** | Single `summarize_results` (one LLM) | **Responder** (heavy pipeline: evidence, citations, formatting) |
| **Graph size** | ~476 lines, fewer nodes | ~905 lines, planner/executor/evaluator/responder/agent/tools |

---

## 1. Cache First: `check_cached_documents` (Biggest Win on Speed Branch)

**Speed branch:**

- **START → check_cached_documents**
- If the previous turn had already retrieved documents and the context (e.g. property) still matches, state already had `relevant_documents`.
- **Conditional:** “use cached” → go **directly to `process_documents`** (skip route_query, rewrite, expand, query_vector_documents, clarify).
- So **follow-up questions often skipped retrieval entirely** and only paid for process_documents + summarize_results.

**Current branch:**

- No `check_cached_documents`. Every request runs context_manager → classify_intent → planner → executor → … .
- Follow-ups always pay for planner LLM + executor (retrieve_documents + retrieve_chunks) even when the same documents could be reused.

**Impact:** Follow-up latency on the speed branch was often **~2–4s** (process + summarize). On the current branch it’s **~6–12s+** (planner + retrieval tools + evaluator + responder).

---

## 2. No Planner LLM: Graph Structure Was the Plan

**Speed branch:**

- **No planner node.** The “plan” was fixed by the graph:
  - direct_document → fetch_direct_chunks → process → summarize
  - simple_search → query_vector_documents → (maybe clarify) → process → summarize
  - complex_search → rewrite → detail_level → expand → query_vector_documents → clarify → process → summarize
- `route_query` was **synchronous and rule-based** (word count, keywords, document_ids, property_id). It only set flags like `skip_expansion`, `skip_clarify` in state.

**Current branch:**

- **Planner node** runs an **LLM** (e.g. gpt-4o-mini) to produce a structured execution plan (steps: retrieve_docs, retrieve_chunks).
- So **every non–chip query pays for one full LLM round-trip** before any retrieval.
- Chip queries (pre-selected documents) still skip the planner and use a fixed 1-step plan.

**Impact:** ~0.5–2s extra latency on the current branch for every non–chip document query.

---

## 3. Simple Path: Skip Rewrite / Expand / Detail Level

**Speed branch:**

- For **simple_search** (short query + simple keywords like “what is”, “price”, “value”, “address”, etc.):
  - **Conditional after route_query:** go straight to **query_vector_documents**.
  - No `rewrite_query`, no `determine_detail_level`, no `expand_query`.
- So simple queries had: **check_cached → route_query → query_vector_documents → (maybe skip clarify) → process → summarize.**

**Current branch:**

- There is no “simple_search” shortcut. All document queries that are not citation/attachment/navigation go: **context_manager → planner → executor → …**
- So even a simple “What is the value?” pays for planner + full executor (two tool calls with embeddings + DB).

**Impact:** Simple queries on the speed branch avoided 1–3 extra nodes (and on complex path, 1–2 LLM calls: rewrite, detail_level, expand). Current branch always pays planner + executor.

---

## 4. Single Retrieval Node vs. Executor + Two Tools

**Speed branch:**

- **query_vector_documents:** One node that used `HybridDocumentRetriever` / `VectorDocumentRetriever` (BM25 + vector, document-level).
- If `relevant_documents` was already in state (from cache), the node **returned immediately** and did no work.
- Retrieval was **document-level** in that node; the rest of the pipeline (process_documents, summarize_results) worked on those docs.

**Current branch:**

- **Executor** runs steps from the plan; each step is a **tool call**:
  - **retrieve_documents:** 1× embedding + Supabase vector + keyword + business filter.
  - **retrieve_chunks:** 1× embedding + per-document Supabase (match_chunks, keyword, optional bbox).
- So you always have at least **two tool invocations**, each with its own embedding and DB round-trips. No “skip retrieval” when state could have reused prior docs.

**Impact:** Speed branch could do one coordinated retrieval (or skip it via cache). Current branch always does two separate tool calls with more round-trips and no cache shortcut.

---

## 5. One Summary LLM vs. Responder Pipeline

**Speed branch:**

- **summarize_results:** One LLM call that took `document_outputs` + `user_query` (+ optional conversation) and produced the final answer. No separate “responder” or evidence/citation subgraph.

**Current branch:**

- **Responder node:** Builds a large prompt (execution results, citations, evidence registry, formatting rules, etc.) and runs a heavier pipeline (citation mapping, evidence extraction, formatting). More tokens and more logic before the final LLM call.

**Impact:** Time-to-first-token and total answer time are higher on the current branch because of the heavier responder pipeline and larger prompt.

---

## 6. What’s the Same (So Not the Cause of the Difference)

- **Per-request graph build:** Both branches build the graph (and checkpointer) inside `run_and_stream()` for the request’s event loop. So the slowdown is **not** from a new “build graph every time” in the current branch; that was already the case on the speed branch.
- **Streaming:** Both use the same streaming pattern (async generator, new loop in a thread, SSE).

So the **only** reason the speed branch felt quicker is the **graph design and node set**: cache first, rule-based routing, simple-path skips, single retrieval node, and a single summary LLM.

---

## Recommendations to Recover Speed (While Keeping Current Features)

1. **Reintroduce “cache first” for follow-ups**  
   - Before planner/executor, check state (or checkpointer) for existing `relevant_documents` / `execution_results` that still match the current context (e.g. same property/session).  
   - If so, skip planner + executor and go straight to responder (or a lightweight “answer from cached results” path).

2. **Reintroduce a “simple” path that skips the planner**  
   - Use a **rule-based classifier** (like the old `route_query`): e.g. if the query is short and has simple keywords and no document_ids, set a flag `use_simple_plan`.  
   - When `use_simple_plan` is true, inject a **fixed 2-step plan** (retrieve_docs → retrieve_chunks) and **skip the planner LLM**.  
   - This keeps the same executor/responder but removes one LLM round-trip for simple queries.

3. **Optional: Reuse retrieval results when possible**  
   - If the executor has already run for this session/query and the query hasn’t changed meaningfully, reuse `execution_results` instead of calling retrieve_documents + retrieve_chunks again.

4. **Keep chip path as-is**  
   - Chip queries already skip the planner; no change needed there.

5. **Consider lighter responder for “simple” path**  
   - For the “simple plan” path, you could use a lighter responder (e.g. one LLM call similar to old `summarize_results`) instead of the full citation/evidence pipeline when you don’t need fine-grained citations.

Implementing (1) and (2) would bring behavior and latency much closer to the speed branch while keeping the current architecture (planner/executor/responder) for complex and citation-heavy flows.

# Plan: Improve document retrieval (wrong-property) further

## What’s already in place

- Single gate: keep only docs whose **summary** mentions the entity (distinctive token, e.g. "banda"); relax only if 0 results.
- Wrong-property exclusion: drop docs where summary has another address / wrong-party names and no entity (or entity dominated).
- Entity extraction from **full user message** (`user_query_for_entity`).
- Stricter (specific) threshold when we have gate phrases.
- Configurable `conflicting_location_patterns` in `entity_gate_config.json`.
- Default conflicting list includes Dik Dik, Nzohe, Mellifera, Martin Wainaina, Carlos Espindola.

---

## Improvements to add (in order)

### 1. Chunk-level backstop (high impact)

**Goal:** Never cite a chunk that is clearly about another property, even if the doc passed retrieval.

**Where:** Responder or citation path (where we attach chunks to the answer). Before using a chunk for the answer or citation:

- If the request was entity-specific (we have gate phrases from the user query – may need to pass a flag or re-call entity extraction with `user_query`), check the **chunk text**:
  - If chunk does **not** contain the entity (same distinctive-token logic as doc summary) and **does** contain a conflicting pattern → do not use this chunk (skip or don’t cite).
- Reuse the same helpers or a thin wrapper: e.g. `_entity_mentioned_in_summary(chunk_text, gate_phrases)` and `_summary_clearly_about_another_property(chunk_text, gate_phrases)` (or move these to a shared util and call from both document_retriever_tool and responder).

**Files:** [backend/llm/nodes/responder_node.py](backend/llm/nodes/responder_node.py) (or wherever chunks are selected for citation); optionally a shared util in [backend/llm/utils/](backend/llm/utils/) for entity-in-text and wrong-property-in-text.

**Success:** Answers never quote or cite a sentence that is clearly about Dik Dik Lane / another property when the user asked about Banda Lane.

---

### 2. Ensure key documents have summaries

**Goal:** The “entity in summary” gate only works if the right document has a non-empty `summary_text`. If the real Banda Lane doc has no summary, it gets dropped (or only kept when we relax).

**Actions:**

- Add a one-off or periodic check: list documents that have no `summary_text` or very short one; prioritise filling summaries for property-named or high-value docs.
- In processing/ingestion: ensure every document gets a summary (e.g. from existing pipeline or a summary step). If summaries are generated elsewhere, ensure they include the property/entity name when relevant (e.g. “Application for purchase at Banda Lane…”).
- Optional: in retrieval, when we relax “entity in summary” because we’d have 0 results, log which docs were kept without entity in summary (e.g. by filename) so you can target those for summary improvement.

**Files:** Document ingestion/summary pipeline; optional logging in [backend/llm/tools/document_retriever_tool.py](backend/llm/tools/document_retriever_tool.py).

---

### 3. Relaxation ordering (medium impact)

**Goal:** When we relax (keep docs that would have been excluded so we don’t return 0), still rank the “least wrong” first.

**How:** After the wrong-property exclusion step, if we relaxed (we kept some excluded docs), sort so:

1. Docs with entity in summary first (already boosted; ensure they’re first).
2. Docs with entity in filename but not in summary.
3. Docs that were excluded for wrong-property but we kept them due to relaxation (e.g. put these last).

**File:** [backend/llm/tools/document_retriever_tool.py](backend/llm/tools/document_retriever_tool.py) – add an explicit sort key or a small “tier” field (entity_in_summary=2, entity_in_filename_only=1, relaxed_wrong_property=0) then sort by tier desc, then score desc.

**Success:** When we have to relax, the Banda Lane doc (if present) appears above the Dik Dik doc.

---

### 4. Smarter “other address” detection (medium impact, more maintainable)

**Goal:** Don’t rely only on a fixed list; detect address-like phrases that don’t match the query entity.

**How:**

- Keep `conflicting_location_patterns` for known wrong properties.
- Add pattern-based checks (run only when we have gate phrases):
  - **L.R. NO / LR NO:** If summary contains “l.r. no: X” or “lr no: X”, extract X. Optionally compare to a known “right” parcel for the entity (if we ever have that in config); if we don’t, treat any “L.R. NO: …” as a signal and combine with “no entity in summary” or “entity not dominant” to exclude.
  - **“X Lane” / “X Road”:** Extract the word(s) before “Lane” or “Road” (e.g. “3 Dik Dik Lane” → “dik dik”). If that token set doesn’t overlap with the gate phrase tokens (e.g. “banda”), treat as another address for exclusion/dominance logic.
- Implement in a small helper used by `_summary_clearly_about_another_property` so the main list stays the primary source and patterns add coverage for new properties.

**File:** [backend/llm/tools/document_retriever_tool.py](backend/llm/tools/document_retriever_tool.py) (helpers + `_summary_clearly_about_another_property`).

---

### 5. Document type hint for ranking (low effort, optional)

**Goal:** When the user says “Banda Lane **offer**” or “Banda Lane **lease**”, prefer docs whose `classification_type` matches (e.g. application/offer vs lease).

**How:** When we have gate phrases and multiple docs with similar scores, add a small ranking boost for docs whose `document_type` (or `classification_type`) matches keywords from the query (e.g. “offer” → boost application/offer types; “lease” → boost lease type). Only if classification is reliable in your DB.

**File:** [backend/llm/tools/document_retriever_tool.py](backend/llm/tools/document_retriever_tool.py) – after entity-in-summary boost, optionally add a type-match boost before the final sort.

---

### 6. Logging and observability

**Goal:** Easier debugging and tuning.

**Actions:**

- Log when we relax: “Entity-in-summary relaxed (0 docs would remain)” and “Wrong-property exclusion relaxed (0 docs would remain)” with list of doc ids/filenames kept.
- Log each excluded doc: reason = “no entity in summary” vs “wrong property (other address/party)”.
- Optional: expose a simple metric or admin view – e.g. count of requests where we relaxed, count of docs excluded for wrong-property – so you can tune patterns and summaries.

**Files:** [backend/llm/tools/document_retriever_tool.py](backend/llm/tools/document_retriever_tool.py) (logging); optional: small analytics or admin endpoint if needed.

---

### 7. Shared entity/wrong-property helpers (refactor)

**Goal:** One place for “entity in text” and “wrong property in text” so document retrieval and chunk backstop use the same rules.

**How:** Move `_entity_mentioned_in_summary`, `_summary_clearly_about_another_property` (and any new pattern-based “other address” helper) to a shared module, e.g. [backend/llm/utils/entity_extraction.py](backend/llm/utils/entity_extraction.py) or a new [backend/llm/utils/property_match.py](backend/llm/utils/property_match.py). Document retriever and responder both import from there. Signatures can stay “summary” in the name but accept any text (summary or chunk).

**Files:** New or existing util module; [backend/llm/tools/document_retriever_tool.py](backend/llm/tools/document_retriever_tool.py); responder/citation code (for chunk backstop).

---

## Priority order

1. **Chunk-level backstop** – stops wrong-property content from appearing in the answer even when retrieval slips.
2. **Summaries for key docs** – makes the current gate effective for the right document.
3. **Relaxation ordering** – better behaviour when we have to relax.
4. **Smarter other-address detection** – less reliance on a fixed list; works for new properties.
5. **Document type hint** – nice-to-have ranking improvement.
6. **Logging** – ongoing; can be done in parallel.
7. **Shared helpers** – refactor when adding chunk backstop to avoid duplication.

---

## Success criteria (overall)

- User asks about “Banda Lane” → only documents whose summary (and cited chunks) are about Banda Lane are used; the Dik Dik lease is never returned or cited.
- When we relax, the correct doc (if present) ranks above wrong-property docs.
- New properties (e.g. “Oak Street”) can be handled without hardcoding every name (pattern-based “other address” + config list).
- Logs make it clear when and why docs were excluded or relaxed.

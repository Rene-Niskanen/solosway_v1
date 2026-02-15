---
name: ""
overview: ""
todos: []
isProject: false
---

# Citation mapping: 100% accuracy and clean code

## Goal

- **Accuracy:** Every citation highlights the block that actually contains (or best matches) the cited text. Cited text is the source of truth; the model’s block_id is only a hint.
- **Clean code:** One clear resolution path, no redundant branches, naming and comments aligned with prompts.

---

## Phase 1: Fix the map (merge, don’t overwrite)

**File:** [backend/llm/nodes/summary_nodes.py](backend/llm/nodes/summary_nodes.py)

**Change:** When building `metadata_lookup_tables`, merge each chunk’s `metadata_table` into the existing table for that `doc_id` instead of replacing it.

- Today: `metadata_lookup_tables[doc_id] = metadata_table` (last chunk wins).
- New: If `doc_id` already exists, `metadata_lookup_tables[doc_id].update(metadata_table)`; otherwise set `metadata_lookup_tables[doc_id] = metadata_table`.
- Block IDs are already unique (chained `next_block_id`), so no key collisions.

**Result:** The lookup table contains blocks from all chunks of each document, so any block_id or text-based resolution can find the right block.

---

## Phase 2: Unique block IDs in the content the LLM sees

**Files:** [backend/llm/nodes/summary_nodes.py](backend/llm/nodes/summary_nodes.py), optionally [backend/llm/nodes/processing_nodes.py](backend/llm/nodes/processing_nodes.py)

**Change:** Ensure the string sent to the LLM has globally unique block IDs (no duplicate “BLOCK_CITE_ID_1” across chunks).

- **Option A (recommended):** In `summarize_results`, do **not** use pre-formatted content for the citation path. Always call `format_document_with_block_ids(output, starting_block_id=next_block_id)` here so block IDs are chained in the concatenated content. Pre-formatting in `process_documents` can remain for other uses but is ignored when building the Phase 1/2 prompt content.
- **Option B:** Keep pre-formatting but, when using it, renumber block IDs in `formatted_content` and in `metadata_table` to the current `next_block_id` range before merging (so the prompt still has unique IDs).

**Result:** Each block ID in the prompt refers to exactly one block; the model can refer to a specific block unambiguously.

---

## Phase 3: Resolve by cited text first (source of truth)

**File:** [backend/llm/tools/citation_mapping.py](backend/llm/tools/citation_mapping.py)

**Idea:** For each citation we have `cited_text` and (optionally) `block_id` from the LLM. We resolve the **bbox** by finding the block whose **content** best matches `cited_text`, and use that block’s bbox. The LLM’s `block_id` is used only to narrow scope (e.g. which doc) or as fallback if text matching fails.

**Concrete steps:**

1. **Single resolution function**
  Add a function, e.g. `resolve_citation_to_block(cited_text, block_id_hint, metadata_lookup_tables) -> (doc_id, block_id, block_metadata) | None`:
  - If `block_id_hint` is present and in the tables, optionally restrict search to that doc (or use it as first candidate).
  - Search **all** blocks (in that doc, or all docs if no hint) and score each with `verify_citation_match(cited_text, block_content)` (and numeric_matches, etc.).
  - Return the block with the best score above a minimum confidence (e.g. high or medium); if none, return the block_id_hint block if available (fallback).
2. **Use it in `add_citation**`
  In `add_citation`:
  - Call `resolve_citation_to_block(cited_text, block_id, self.metadata_lookup_tables)` to get `(doc_id, block_id, block_metadata)`.
  - Store that block’s bbox/page/doc_id for the citation. No separate “trust Phase 1” vs “same-doc fallback” vs “numeric fallback” branches; one path: resolve by text (with hint), then store.
3. **Edge cases**
  - Duplicate detection: keep existing `_is_duplicate_citation` (by normalized cited text / block).
  - Missing block_id: resolve only by text across all docs.
  - No good match: if resolution returns nothing, fall back to block_id_hint if it exists in tables; else record citation without bbox and log.

**Result:** Highlight is always driven by “which block contains this cited text?” so we get the right block for the right piece of text.

---

## Phase 4: Citation code cleanup

**Files:** [backend/llm/tools/citation_mapping.py](backend/llm/tools/citation_mapping.py), [backend/llm/nodes/summary_nodes.py](backend/llm/nodes/summary_nodes.py) (citation-related sections)

**Goals:**

- **One resolution path:** All bbox resolution goes through `resolve_citation_to_block` (or the single logic that “resolve by cited text first” uses). Remove redundant branches (e.g. “trust Phase 1” then “same-doc fallback” then “numeric fallback”) and replace with: resolve once, then store.
- **Naming:** Use consistent names: `cited_text`, `block_id` (hint), `metadata_lookup_tables`, `resolve_citation_to_block`. Avoid mixed “direct block” / “best match” / “fallback” in the main flow; name the one function clearly.
- **Comments:** Short comments that state: “Cited text is source of truth; we find the block that best matches it and use that block’s bbox.”
- **Logging:** Keep `[CITATION_DEBUG]` (or one clear prefix) for resolution result (which block was chosen, why). Remove or consolidate noisy branches.
- **summary_nodes:** Where citations are built and renumbered, ensure we only pass resolved citations (with bbox from the resolution step). No second “override by semantic search” logic in renumbering that duplicates resolution.

**Result:** Code reads as a single, clear flow: “resolve citation by text (with optional block hint) → store bbox.”

---

## Phase 5: Align prompts with “cited text is source of truth”

**File:** [backend/llm/prompts.py](backend/llm/prompts.py)

**Changes:**

- `**get_citation_extraction_prompt`:**  
  - State that **cited_text** is what we use to find the right place in the document; **block_id** should point to the block that contains that fact (and we use it as a hint; our system will find the best-matching block).
  - Keep the workflow “for each fact, call cite_source(cited_text=..., block_id=...)” but add one line: “We use the cited_text to locate the exact block; provide the block_id of the block that contains this fact.”
  - No need to overload the prompt with “we will override by text”; just say block_id should be the block containing the fact, and that cited_text is required and used for precise placement.
- `**get_final_answer_prompt`:**  
  - Optionally add a single line: “Citation numbers [1], [2], … link to the exact sentence in the source; cite immediately after the fact.”
  - Otherwise leave as-is so the model keeps using the same citation numbers as Phase 1.

**Result:** Prompts describe the same contract as the code: cited text is the main signal; block_id is the block that contains it (and we resolve by text for 100% accuracy).

---

## Phase 6: Final review (flow and consistency)

**Scope:** Citation path end-to-end.

1. **Trace one citation** from Phase 1 tool call → resolution → stored citation → renumbering → views → frontend. Confirm there is no second place that overwrites bbox or block_id after resolution.
2. **Read** [citation_mapping.py](backend/llm/tools/citation_mapping.py) (add_citation, resolve function, create_citation_tool) and [summary_nodes.py](backend/llm/nodes/summary_nodes.py) (metadata merge, formatting, renumbering, where citations are read). Ensure:
  - Metadata is merged per doc_id; block IDs are unique in the prompt.
  - Resolution is “by cited text first” in one place only.
  - Renumbering only reorders citations and updates numbers; it does not re-resolve bbox.
3. **Read** [get_citation_extraction_prompt](backend/llm/prompts.py) and [get_final_answer_prompt](backend/llm/prompts.py) and ensure wording matches: cited_text required and used for placement; block_id is the block containing the fact.
4. **Remove** dead code and redundant comments (e.g. “trust Phase 1”, “same-doc fallback” as separate concepts if they’re replaced by one resolver).

**Result:** One clear data flow, one resolution strategy, prompts and code in sync.

---

## Implementation order


| Step | What                                                                    |
| ---- | ----------------------------------------------------------------------- |
| 1    | Merge metadata per doc_id in summary_nodes (Phase 1).                   |
| 2    | Ensure unique block IDs in LLM content (Phase 2).                       |
| 3    | Add `resolve_citation_to_block` and use it in `add_citation` (Phase 3). |
| 4    | Clean up citation_mapping and summary_nodes citation flow (Phase 4).    |
| 5    | Update citation and final-answer prompts (Phase 5).                     |
| 6    | Full read-through and consistency check (Phase 6).                      |


---

## Success criteria

- For a query that returns “EPC rating D, 8th August 2023” with citation [1], the preview highlights the block that contains that EPC/date text, not High Voltage or contact info.
- Backend logs show resolution choosing the block that matches the cited text (and optional block_id hint).
- Code: single resolution path, clear names, prompts and code aligned.


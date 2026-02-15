# Citation Mapping: Agentic_Velora vs Current Branch

## Summary

Agentic_Velora uses the **same 2-phase citation flow** as our branch (Phase 1: cite_source tool calls → Phase 2: answer with [1],[2]). The main difference is **when** we override the LLM’s block_id with a “semantic” block: Agentic_Velora has a broken semantic loop (so the override is effectively random), while we fixed the loop but still override. If the LLM’s block is often correct, overriding it can swap in a wrong block (e.g. contact info) and cause wrong highlights.

---

## Agentic_Velora Citation Logic

### 1. Flow (same as ours)

- **Phase 1:** LLM gets `get_citation_extraction_prompt(...)` and must call `cite_source(cited_text, block_id, citation_number)` for each fact.
- Tool calls are processed: `citation_tool_instance.add_citation(...)` for each.
- **Phase 2:** LLM gets `get_final_answer_prompt(..., citations=citations_from_state)` and generates answer with `[1]`, `[2]`, etc.
- **Renumber:** `_renumber_citations_by_appearance(summary, citations_from_state, metadata_lookup_tables)` so citation numbers match order of appearance in text.
- **Views:** `processed_citations[citation_num_str] = citation_data` (citation_number → bbox) and streamed to frontend.

### 2. citation_mapping.py (Agentic_Velora)

- **Exports:** `verify_citation_match`, `CitationInput`, `CitationTool`, `create_citation_tool` only. No `build_searchable_blocks_from_metadata_lookup_tables`, `resolve_anchor_quote_to_bbox`, etc.
- **CitationTool.add_citation:** Same structure as ours: find block in table → direct `verify_citation_match(cited_text, direct_block_content)` → if not high/medium, run “semantic search” over all blocks and optionally replace block_id/bbox.
- **Bug on Agentic_Velora:** The semantic search loop is broken (scoring/update runs once per doc using only the last block; `if score > best_score` is nested inside `if numeric_matches`). So when fallback runs, the chosen block is effectively arbitrary. So on Agentic_Velora, when direct verification fails, highlights are often wrong; when it passes, they use the LLM’s block and can be right.

### 3. summary_nodes.py (Agentic_Velora)

- **No** FALLBACK 1 (split same number for different facts) or FALLBACK 2 (all citations same number).
- **Deduplication:** By normalized cited text (`CitationTool._normalize_cited_text`), same as we restored.
- **Renumbering semantic search:** Simple loop only (verify + score + best_match). No extra “descriptive/negative/exact phrase” rules or “skip this block” logic. We aligned with this.
- **_extract_citations_from_text:** Present but **not used** in the main summarize path; citations come only from Phase 1 tool calls.

### 4. Phase 1 prompt (Agentic_Velora)

- Longer, more explicit “VERIFY BLOCK_ID MATCHES CITED_TEXT” section with step-by-step verification and examples (e.g. “no recent planning history”, “granted” vs “refused”).
- Rule 11: “When you later write your response in Phase 2, you MUST use the EXACT citation numbers from Phase 1 that match your facts.”
- So Phase 2 is instructed to use the same numbers as Phase 1; renumbering then only fixes order of appearance.

### 5. views.py (Agentic_Velora)

- Same idea: `citations_from_state` → `processed_citations[citation_num_str] = citation_data`, then stream. No `doc_filename_map` / `original_filename` in the snippet we saw; we have that for display.

---

## Why Citations Can Still Be Wrong on Our Branch

1. **Semantic fallback overrides a correct block**  
   When the LLM’s block_id is correct but `verify_citation_match` returns low (e.g. paraphrased cited_text), we still run semantic search and can replace the correct block with another (e.g. contact block with numbers). We fixed the loop so the “best” block is now a real best match, but if the best match is still wrong (e.g. phone number block scores high), we keep swapping in the wrong bbox.

2. **Trust Phase 1 when block_id is in the table**  
   If the block_id from the LLM exists in the metadata table, we can **always** use that block’s bbox and **never** override it with semantic search. We only need semantic search when the block_id is missing or invalid. That avoids replacing a correct block with a wrong one.

---

## Recommendation

- **Option A (minimal, recommended):** In `CitationTool.add_citation`, when `block_id` is found in the metadata table, **do not run semantic fallback**. Use the LLM’s block for bbox in all such cases. Only run semantic search when the block_id is not in the table (e.g. hallucinated ID). This “trust Phase 1” behavior matches the intent of Agentic_Velora’s prompt (verify block before calling) and prevents wrong overrides.
- **Option B:** Port the full Phase 1 prompt from Agentic_Velora (including the detailed verification instructions and examples) so the LLM picks the right block more often; keep current add_citation logic.
- **Option C:** Use Agentic_Velora’s citation_mapping.py and summary_nodes citation/renumber logic verbatim (including the broken loop) to see if behavior matches that branch; then fix only the loop and keep everything else.

Implementing Option A next.

---

## Root cause: Block IDs not globally unique (wrong doc highlighted)

**What was wrong:** `format_document_with_block_ids` was called per document with default `starting_block_id=1`, so every document got blocks `BLOCK_CITE_ID_1`, `BLOCK_CITE_ID_2`, … The same block_id string therefore existed in multiple docs. In `CitationTool.add_citation` we did:

```python
for doc_id_candidate, metadata_table in self.metadata_lookup_tables.items():
    if block_id in metadata_table:
        block_metadata = metadata_table[block_id]
        doc_id = doc_id_candidate
        break
```

So we always used the **first** doc that had that block_id. If the LLM meant citation [2] for the second block of the **Highlands** PDF but the **first** doc in iteration order had a different “BLOCK_CITE_ID_2” (e.g. a contact block), we showed the wrong bbox (e.g. contact info).

**Fixes applied:**

1. **Disambiguate by cited_text when multiple docs have the same block_id** (`citation_mapping.py`):  
   Collect all `(doc_id, block_metadata)` where `block_id` is in that doc’s table. If only one candidate, use it. If multiple, score each with `verify_citation_match(cited_text, block_content)` (confidence + numeric_matches bonus) and use the best match. This fixes wrong-doc highlights even when pre-formatted content is used (where we don’t chain IDs).

2. **Chain block IDs across documents** (`summary_nodes.py`):  
   Initialize `next_block_id = 1` before the loop. For each document, call `format_document_with_block_ids(output, starting_block_id=next_block_id)` and set `next_block_id` to the returned `next_block_id`. When using pre-formatted content, advance `next_block_id` by `len(metadata_table)`. That way, when we format in summarize_results, block IDs are globally unique and the LLM’s BLOCK_CITE_ID_2 refers to a single block. Pre-formatted content from processing_nodes still has per-doc IDs; disambiguation (1) handles that case.

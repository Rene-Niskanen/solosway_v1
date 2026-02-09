# Analysis: feature/citations-working vs current branch

## Summary

On **feature/citations-working**, citations work via a **two-phase summarization flow** with **mandatory tool calls**: the LLM calls `cite_source(block_id=..., citation_number=..., cited_text=...)` for each fact, and bbox is resolved **only** from the metadata table by block_id. Citation numbers are then **renumbered by order of appearance** of superscripts (¹, ², ³) in the final answer.

On the **current branch**, we use an **agentic flow** (planner → executor → **responder**) with **in-text citations** `[ID: X](BLOCK_CITE_ID_N)`: the model writes the block id in the response, we parse it and resolve bbox from a metadata table. Numbering is by **position** in the response and we **don’t deduplicate** so every [1], [2] gets a payload.

---

## 1. Graph and flow

| Aspect | feature/citations-working | Current branch |
|--------|---------------------------|----------------|
| **Graph** | No planner/executor. Path: … → **process_documents** → **summarize_results** → END | Planner → Executor → **Responder** → (summarize_results for streaming) |
| **Where citations are produced** | **summary_nodes.summarize_results** | **responder_node** (direct citation generation) |
| **Input to citation step** | **document_outputs** (per-doc content + `source_chunks_metadata`) | **Execution results** → chunks from executor’s retrieve_chunks |

So on the working branch there is **no responder_node**; the only summary step is `summarize_results`, which does both “what to say” and “what to cite.”

---

## 2. Block formatting and metadata table

| Aspect | feature/citations-working | Current branch |
|--------|---------------------------|----------------|
| **Formatter** | **block_id_formatter.format_document_with_block_ids(doc_output)** | **responder_node.format_chunks_with_block_ids(chunks_metadata)** |
| **Input shape** | One call **per document**: `doc_output` has `output`, `doc_id`, **source_chunks_metadata** (chunks with blocks) | One call for **all chunks** from executor: flat list `chunks_metadata` (chunk_text, blocks, doc_id, etc.) |
| **Output** | Per-doc formatted content + **metadata_table** (block_id → bbox, page, doc_id) | Single **formatted_text** ([SOURCE_ID: 1] + &lt;BLOCK&gt;…) + **short_id_lookup** + **metadata_lookup_tables** (doc_id → block_id → metadata) |
| **Block ID scope** | Block IDs are **per document** (each doc’s blocks numbered from 1) | Block IDs are **global** across all chunks (one counter for all chunks) |

So on the working branch the metadata table is built **per doc** from `source_chunks_metadata`; on the current branch it’s built **once** from the flat chunk list. The idea (block_id → bbox via metadata table) is the same; the **data source** (doc outputs vs. executor chunks) and **who builds it** (summary vs. responder) differ.

---

## 3. How the LLM cites

| Aspect | feature/citations-working | Current branch |
|--------|---------------------------|----------------|
| **Mechanism** | **Tool calls**: LLM **must** call `cite_source(block_id="BLOCK_CITE_ID_N", citation_number=N, cited_text="...")` (Phase 1). | **In-text**: LLM writes `[ID: X](BLOCK_CITE_ID_N)` in the answer; we **parse** the response. |
| **Citation format in final text** | **Superscripts** ¹, ², ³ (Phase 2 writes the answer with superscripts; numbers come from Phase 1 tool calls, then renumbered). | **Bracketed numbers** [1], [2], [3] (we replace `[ID: X](BLOCK_CITE_ID_N)` with `[citation_number]`). |
| **Bbox resolution** | **Only** from metadata: tool gives `block_id` → lookup in **metadata_lookup_tables** → bbox. No heuristic. | **Same when block_id is present**: we resolve from **metadata_lookup_tables**. If the model omits block_id we fall back to short_id + “best block” heuristic. |

So the working branch **never** infers the block from text; the model **explicitly** chooses the block via the tool. The current branch relies on the model putting the right block id in the text; if it doesn’t, we fall back to heuristics (which can pick the wrong block, e.g. EPC vs “High Voltage…”).

---

## 4. Citation numbering (why [1], [2], [3] and one payload per number)

| Aspect | feature/citations-working | Current branch |
|--------|---------------------------|----------------|
| **Who assigns numbers** | Phase 1: LLM passes **citation_number** in each `cite_source` call. Phase 2: LLM writes superscripts. Then **renumber by appearance**. | We assign **citation_number = 1, 2, 3…** by **position** in the response after parsing `[ID: X](BLOCK_CITE_ID_N)`. |
| **Renumbering** | **_renumber_citations_by_appearance(summary, citations)**: find superscripts ¹²³ in order → map old_num → new_num (1, 2, 3…) → replace superscripts in text and renumber citation list. | **Sort citations by position**, then `citation_number = 1, 2, 3…`. No separate “appearance” pass; position **is** appearance. |
| **Deduplication** | N/A: each tool call is one citation; renumbering keeps one entry per displayed number. | We **removed** deduplication in **format_citations_for_frontend** so each in-text citation gets its own payload (fix for “Formatted 1 citations” when two refs shared a number). |

So the working branch guarantees sequential numbers by **reordering** according to where superscripts appear. The current branch does the same idea by **position order** and by **not** collapsing multiple refs into one payload.

---

## 5. Why citations “work” on feature/citations-working

1. **Block choice is explicit**  
   The model doesn’t “mention” a block in prose; it **calls** `cite_source(block_id=...)`. So the cited block (and thus bbox) is unambiguous.

2. **Bbox only from metadata**  
   No heuristic block selection: bbox always comes from the metadata table for that block_id.

3. **Numbering is by appearance**  
   `_renumber_citations_by_appearance` makes the UI numbers 1, 2, 3… match the order of superscripts in the text.

4. **Data path**  
   `document_outputs` with `source_chunks_metadata` are produced by **process_documents** and already have block-level structure; the formatter and metadata table align with what the model sees.

---

## 6. Why the current branch behaves differently

1. **Different graph**  
   We use planner → executor → **responder**. The responder gets **execution_results** (chunks from retrieve_chunks), not the same `document_outputs` + `source_chunks_metadata` as on the working branch.

2. **In-text citations instead of tool calls**  
   The model writes `[ID: X](BLOCK_CITE_ID_N)`. If it picks the wrong block (e.g. BLOCK_CITE_ID_2 for EPC when 2 is “High Voltage…”), we still resolve that block and show that bbox. So wrong highlights are **model choice**, not missing metadata.

3. **Prompt and block granularity**  
   We added instructions to “cite only the block that contains the fact,” but retrieval/chunking still determine which blocks exist; if EPC and “High Voltage…” are in different blocks, the model must pick the right one.

4. **Numbering and payloads**  
   We fixed numbering by assigning 1, 2, 3… by position and not deduplicating in `format_citations_for_frontend`, so the UI should show [1], [2], [3] with one payload per number.

---

## 7. What we could port or align

- **Renumber-by-appearance idea**: We already do the equivalent (sort by position, assign 1,2,3…; no dedup). No change needed for numbering.
- **Tool-call citation (optional)**: On the current graph we could add an optional “citation tool” in the responder so the model can call `cite_source(block_id=..., citation_number=..., cited_text=...)` in addition to (or instead of) in-text `[ID: X](BLOCK_CITE_ID_N)`. That would mirror the working branch’s explicit block choice and avoid wrong-block picks when the model would use the tool correctly.
- **Data shape**: Our metadata table is built from the same kind of block data (block_id → bbox, page, doc_id); the difference is we build it from **chunks_metadata** in the responder instead of from **doc_output.source_chunks_metadata** in summarize. Keeping block_id resolution and metadata table structure aligned is already done; no structural change required unless we want to also support a “per-document” formatting path like the working branch.

---

## 8. File-level comparison

| feature/citations-working | Current branch |
|---------------------------|----------------|
| **backend/llm/nodes/summary_nodes.py** – Phase 1 (citation extraction with `cite_source`), Phase 2 (final answer), `_renumber_citations_by_appearance` | **backend/llm/nodes/responder_node.py** – `format_chunks_with_block_ids`, `extract_citations_with_positions`, `replace_ids_with_citation_numbers`, `format_citations_for_frontend`, sequential numbering by position |
| **backend/llm/utils/block_id_formatter.py** – `format_document_with_block_ids(doc_output)` per doc | **responder_node** – `format_chunks_with_block_ids(chunks_metadata)` over flat chunks |
| **backend/llm/tools/citation_mapping.py** – `CitationTool`, `create_citation_tool` (cite_source), bbox from metadata only | **responder_node** – parsing of `[ID: X](BLOCK_CITE_ID_N)`, `_resolve_block_id_to_metadata`; **citation_mapping.py** still has tool for other flows |
| **backend/llm/graphs/main_graph.py** – process_documents → summarize_results → END (no responder) | **main_graph.py** – … → responder → … (summarize_results used for streaming, citations from responder’s chunk_citations) |

---

## 9. Missing `blocks` in current branch (fixed)

**Root cause:** We do **not** get `source_chunks_metadata` in the responder flow, but we do get **chunks with a `blocks` field** — as long as the retriever passes it through.

- **feature/citations-working:** `document_outputs` are produced by **process_documents**; each has `source_chunks_metadata` (chunks with blocks). So block-level data is always present when building the metadata table.
- **Current branch:** Chunks come from **retrieve_chunks** → **execution_results**. The **match_chunks** RPC returns only `id, document_id, chunk_index, chunk_text, chunk_text_clean, page_number, metadata, similarity` — **no `bbox` or `blocks`**. We then do a follow-up fetch for `id, bbox, blocks` but were only assigning **bbox** to the chunk, not **blocks**. So vector-retrieved chunks had no block-level data; `format_chunks_with_block_ids` saw empty `blocks` and fell back to one block per chunk (chunk-level bbox only).

**Fix (in chunk_retriever_tool.py):** When we fetch `id, bbox, blocks` for chunks that lack bbox (after match_chunks or in the 6a batch), we now also set `chunks_dict[chunk_id]['blocks'] = blocks` (and in the 6a loop, set `chunk['blocks'] = blocks_lookup[chunk_id]`). So the responder receives chunks with block-level data and can build a proper metadata table and BLOCK_CITE_IDs per block.

---

## Conclusion

On **feature/citations-working**, citations work because:

1. The LLM **cites by block_id via tool calls**, so the chosen block (and bbox) is explicit.  
2. Bbox is **only** from the metadata table (no heuristic).  
3. Citation numbers are **renumbered by order of appearance** in the final text.

On the **current branch** we keep the same **block_id → metadata table** resolution and have aligned **numbering** (by position, no dedup). The main difference is **citation mechanism** (in-text `[ID: X](BLOCK_CITE_ID_N)` vs. tool calls). When the model writes the wrong block id, we still resolve it and show that bbox; improving that is mostly about **prompting** and/or **optionally adding a cite_source-style tool** in the responder so the model can explicitly pass block_id and citation_number.

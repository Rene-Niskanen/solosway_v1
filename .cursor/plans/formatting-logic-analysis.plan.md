---
name: ""
overview: ""
todos: []
isProject: false
---

# Formatting Logic Analysis — Agent Loop & Response Quality

## Summary

Analysis of the `beforeagentoolunification` branch to document the formatting logic the agent loop uses and identify why responses may appear "ruined" (missing document preview cards, altered structure, or inconsistent layout).

---

## 1. Architecture: Agent Loop Path (beforeagentoolunification)

**Flow:** `context_manager` → `agent_loop` → `responder` → END

- **agent_loop**: Model decides tool use (retrieve_documents, retrieve_chunks, read_workspace_file, write_workspace_file). Accumulates `execution_results`.
- **responder**: Generates final answer from `execution_results` using `generate_answer_with_direct_citations`.

---

## 2. Formatting Logic the Responder Uses

### 2.1 System prompt: `get_responder_block_citation_system_content()`

Located in `backend/llm/prompts/responder.py`:

```
BLOCK_CITATION_BASE           — citation instructions ([ID: X](BLOCK_CITE_ID_N))
+ OUTPUT_FORMATTING_RULES     — layout, headings, key facts, citations
+ CLOSING_AND_FOLLOWUP_PROMPT — closing line rules
+ personality_context
```

### 2.2 OUTPUT_FORMATTING_RULES (`backend/llm/prompts/output_formatting.py`)

Used by:

- `responder.py` (BLOCK_CITATION_BASE, get_document_answer_system_prompt)
- `base_system.py` (TASK_GUIDANCE for 'classify')
- `conversation.py`

**Content:** Layout, heading hierarchy, key-facts presentation (value on own line, bold value), information grouping, lists/bullets, citation punctuation, sentence style, density control, output cleanliness, emoji rules.

---

## 3. Main Branch vs beforeagentoolunification

**Critical finding:** On `main`, the following are **deleted**:

- `backend/llm/prompts/output_formatting.py`
- `backend/llm/nodes/responder_node.py`
- `backend/llm/nodes/agent_loop_node.py`
- Most of `backend/llm/prompts/` (responder, base_system, human_templates, etc.)
- Citation tools, executor, planner, etc.

`main` has a different architecture (retrieval_nodes, sql_retriever, etc.). **If main is merged into beforeagentoolunification (or vice versa), formatting logic will be lost.**

---

## 4. Document Preview Card Issue (Fixed)

**Cause:** `format_citations_for_frontend` in responder_node.py rejected citations with invalid bbox (width/height 0 or missing). Frontend needs `docId && hasBbox && !isWordDoc` to show the preview.

**Fix:** Use a full-page fallback bbox `{left: 0, top: 0, width: 1, height: 1}` when bbox is missing so the preview still renders.

---

## 5. Potential Formatting Interference

### 5.1 Frontend: `responseTextPreprocessing.ts`

`prepareResponseTextForDisplay()` runs before ReactMarkdown. It:

- `normalizeIdCitationsToBracket` — [ID: X](BLOCK_CITE_ID_N) → [X]
- `stripBlockCiteIdFromDisplay` — removes BLOCK_CITE_ID markers
- `ensureParagraphBreaksBeforeBoldSections` — adds `\n\n` before **Label:**
- `stripRedundantColonAfterBoldLabel` — removes redundant `:`  after bold labels
- `promoteBoldSectionLabelsFromListItems` — converts `"- **Label:**"` to `"**Label:**"` (removes bullet)
- `mergeConsecutiveListItemsAsOne` — merges bullets
- `mergeCitationOnlyLinesWithPrevious` — merges citation-only lines

These can alter structure. In particular:

- **promoteBoldSectionLabelsFromListItems** changes list items that look like section headers into plain bold lines. That matches OUTPUT_FORMATTING_RULES (section headings, not list items), but may conflict if the LLM intentionally used bullets for subsections.
- **ensureParagraphBreaksBeforeBoldSections** can add breaks in places the model did not intend.

### 5.2 summarize_results path (fetch_direct_chunks)

`summarize_results` uses `get_system_prompt('summarize')`. `TASK_GUIDANCE` only defines `'classify'`; `'summarize'` falls back to the default `"Perform your assigned task accurately."`, so it does **not** get `OUTPUT_FORMATTING_RULES`.

The agent_loop → responder path does use `OUTPUT_FORMATTING_RULES`.

---

## 6. Recommendations

1. **Merge safety:** Do not merge `main` into `beforeagentoolunification` without careful handling of prompts, responder, and output formatting; main removes this logic.
2. **summarize task:** Add a `'summarize'` entry in `TASK_GUIDANCE` that includes `OUTPUT_FORMATTING_RULES`, so the summarize path matches the responder path.
3. **Document preview:** The bbox fallback is in place; confirm citations include `doc_id`, `original_filename`, and fallback bbox.
4. **Frontend preprocessing:** Review `promoteBoldSectionLabelsFromListItems` and `ensureParagraphBreaksBeforeBoldSections` for edge cases that change intended layout.
5. **Testing:** Run queries like "summarise the lease terms of [property]" and compare structure, bullets, and preview cards between branches.


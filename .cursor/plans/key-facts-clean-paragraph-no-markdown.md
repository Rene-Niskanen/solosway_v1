# Plan: Key Facts as Clean Paragraph(s) with No Raw Markdown

## Goal

1. **No raw markdown**: Key facts and summary must never show `##`, `**`, bullets, or other markdown in the UI. All text should be plain, readable prose.
2. **Structured as a paragraph**: Replace the current label/value list (and any concatenated “label: value. label: value.”) with one or more short paragraphs that explain the document in plain English.
3. **Generic**: Works for any document type (boarding passes, contracts, letters, reports, etc.); no property-specific wording.

---

## Why You See Raw Markdown Today

- **Summary**: The backend returns `summary` from `document_summary.summary` or from the LLM. That string is **never sanitised**. If the source (e.g. document text or an LLM) contains headings like `## Departure`, they appear as-is in the “Key facts” panel.
- **Fact values**: Values are sanitised in `key_facts_service._sanitise_key_fact_value` (which strips HTML and markdown), but the **summary** is not run through that or any similar strip. So the main fix is to sanitise the summary everywhere it is stored or returned.
- **Display**: The UI currently shows summary in one block and facts as “label: value. label: value.” So any markdown in the summary (or in an unsanitised fact value) is visible.

---

## 1. Backend: No Raw Markdown

### 1.1 Sanitise summary everywhere

- **Where summary is produced**: In `key_facts_service.llm_summarise_document_for_key_facts`, after reading `summary` from the LLM response, run it through a **plain-text sanitiser** (same idea as `_strip_html_and_markdown` / `_sanitise_key_fact_value`): strip `#`, `**`, HTML, bullets, extra newlines; collapse spaces. Then store/return that.
- **Where summary is returned**: In `get_document_key_facts` (views.py), before returning `summary`, run it through the same sanitiser. That way even old stored summaries that contain markdown get cleaned on read until they are overwritten.
- **Reuse**: Add a small helper in `key_facts_service` (e.g. `sanitise_summary_for_display(s: str) -> str`) that uses the same stripping rules as the fact values (no markdown, no HTML, collapse spaces). Use it in the LLM response path and in the API response path.

### 1.2 Keep fact values clean

- Fact values already go through `_sanitise_key_fact_value`. Ensure any **new** source of fact text (e.g. from Reducto chunks or document_vectors) is always passed through that before being added to the list. No new code paths that append raw document text to a fact value without sanitising.

---

## 2. Backend: Single paragraph form (`key_facts_text`)

### 2.1 Add a paragraph formatter

- **New field**: Store in `document_summary` a string `key_facts_text`: one or more paragraphs of plain text that explain the document. **No markdown** (no `#`, no `**`, no bullets). Just sentences.
- **How to produce it** (choose one; both must output plain text only):
  - **Option A – Formatter (no extra LLM)**: After building the list of `(facts, llm_summary)` with `build_key_facts_from_document`, format them into 1–2 short paragraphs in a **generic** way, e.g. start with the summary if present, then weave in fact labels/values as natural sentences. Iterate over whatever labels/values exist; do not assume “Address”, “Date”, etc. Run the result through `sanitise_summary_for_display` before storing.
  - **Option B – LLM**: Same inputs (summary + list of facts). Call the LLM with a prompt: “Write 1–3 short paragraphs that explain this document. Use only the given summary and facts. Output plain text only: no markdown, no headings, no bullet points.” Then sanitise the LLM output before storing.

### 2.2 When to generate and store

- **Pipeline (tasks.py)**: After document text and `document_summary` are ready (parsed text, type, address, parties, etc.), call a new helper e.g. `build_key_facts_and_text(document, document_id)` that:
  - Gets `(facts, llm_summary)` from `build_key_facts_from_document`.
  - Produces `key_facts_text` (paragraph form, sanitised).
  - Returns `(facts, llm_summary, key_facts_text)`.
- Store `key_facts_text` (and optionally `stored_key_facts` / `summary` as now) in `document_summary` via `update_document_summary`.

### 2.3 API

- **GET `/api/documents/<id>/key-facts`**:
  - Prefer stored: if `document_summary.key_facts_text` is present and non-empty, return it as `data.key_facts_text` and do not recompute. Also return a **sanitised** `data.summary` if you keep it for other consumers.
  - Fallback (e.g. old documents): Call `build_key_facts_and_text`, format paragraph on the fly, sanitise it, return as `key_facts_text`. Optionally write it back to `document_summary` so the next request is fast.
  - Response shape: `{ key_facts_text: string | null, summary?: string | null, key_facts?: [...] }`. Frontend will use `key_facts_text` as the single source for the “Key facts” panel when present.

---

## 3. Frontend: One paragraph block, no markdown

### 3.1 Data

- Extend the key-facts API client and types to include `key_facts_text`.
- When `key_facts_text` is present and non-empty, use **only** that for the “Key facts” panel. Do not render the old list of label/value boxes or the separate summary block for that panel.

### 3.2 Display

- Render `key_facts_text` as one or more paragraphs (e.g. preserve `\n\n` as paragraph breaks). Use simple typography (e.g. `text-gray-700 text-xs leading-relaxed`). Do **not** interpret any part of the string as markdown (no `dangerouslySetInnerHTML` with a markdown renderer). Plain text only.
- If `key_facts_text` is null or empty, fall back to: show a single paragraph built from sanitised summary + sanitised facts (e.g. summary sentence, then “Key details: …” from the list). That fallback should also be plain text (e.g. backend or frontend strips any remaining markdown from summary/fact values before concatenating).

### 3.3 Refresh button

- Keep “Refresh” only if you have (or add) a way to regenerate key facts and `key_facts_text` on demand. Otherwise remove it so users don’t expect live regeneration.

---

## 4. Implementation order

1. **Sanitise summary** (backend): Add `sanitise_summary_for_display`, use it in the LLM key-facts path and in `get_document_key_facts` before returning `summary`. Ensures no raw markdown in current summary.
2. **Paragraph formatter + storage** (backend): Add `build_key_facts_and_text` that returns `key_facts_text` (plain paragraphs). Add pipeline step to compute and store `key_facts_text` in `document_summary`. Extend `get_document_key_facts` to return `key_facts_text` (from DB or on-the-fly + optional write-back).
3. **Frontend**: Use `key_facts_text` when present; render as plain paragraphs. Fallback to sanitised summary + facts as one paragraph when `key_facts_text` is missing. Ensure no markdown is rendered anywhere in the Key facts panel.

---

## 5. Files to touch

| Area     | File(s) |
|----------|---------|
| Backend  | `backend/services/key_facts_service.py` (sanitise summary, formatter or LLM for `key_facts_text`, `build_key_facts_and_text`) |
| Backend  | `backend/views.py` (`get_document_key_facts`: return and optionally compute `key_facts_text`, sanitise `summary`) |
| Backend  | `backend/tasks.py` (pipeline step: call `build_key_facts_and_text`, store `key_facts_text`) |
| Frontend | `frontend-ts/src/components/FileViewModal.tsx` (use `key_facts_text`, render paragraphs only; fallback without markdown) |
| Frontend | `frontend-ts/src/services/backendApi.ts` (types and response for `key_facts_text`) |

---

## 6. Summary

- **Root cause of raw markdown**: Summary (and possibly some fact values from unsanitised paths) are not stripped of markdown before display. Fix by sanitising the summary everywhere and ensuring all fact values go through the existing sanitiser.
- **Nice paragraph**: Introduce `key_facts_text` as stored prose (1–3 paragraphs), generated at upload and returned by the API. Frontend shows only that (or a sanitised fallback) as plain text, so the Key facts panel is always structured writing with no raw markdown.

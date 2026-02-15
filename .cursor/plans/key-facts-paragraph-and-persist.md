# Plan: Key Facts as Neat Paragraph(s) + Generate Once at Upload and Store

## Goal

1. **UI**: Replace the current "Key facts" container design (individual grey boxes per label/value) with a neat paragraph or more that states the key facts in prose. No box/card layout.
2. **Backend**: Generate key facts **once** when the document is uploaded/processed, then **store** them in the database (e.g. in `document_summary`) so they are saved and not recomputed on every view.
3. **Generic for all document types**: Key facts must work for **any** document type (e.g. legal, medical, reports, letters, contracts, property, invoices)—no property-specific or real-estate–specific logic, labels, or wording. The formatter and any LLM prompts must be document-type agnostic.

---

## Current Behaviour

- **Display**: `FileViewModal` shows "Key facts" as a list of grey rounded boxes, each with a label (e.g. "Document type", "Location") and value (often truncated at 60 chars). A separate "summary" paragraph can appear from the backend.
- **Data**: Key facts are **not** stored. The backend builds them on demand in `get_document_key_facts` (views.py) by:
  - Reading `document_summary` (which may contain type, address/location, parties, or other fields depending on document type)
  - Getting document text from parsed/chunk sources
  - Optionally calling `_build_key_facts_from_document` which uses `extract_key_facts_from_text` and/or `_llm_summarise_document_for_key_facts` to produce a list of `{label, value}` and an LLM summary.
- **API**: `GET /api/documents/<id>/key-facts` returns `{ key_facts: [{label, value}], summary?: string }`.

---

## 1. Backend: Generate Once at Upload and Store

### 1.1 Where to generate

- Key facts need **document text** and **document_summary** (which may include type, location/address, parties, or other extracted fields depending on document type). That is available **after** the extraction/classification step in the pipeline (e.g. in `tasks.py` after Reducto parse and `update_document_summary` with reducto chunks/parsed text).
- **Recommended hook**: Add a dedicated step **after** document text and summary fields are written (e.g. after the block in `tasks.py` that does address extraction and stores `reducto_parsed_text` / `reducto_chunks`), and **before or after** embedding (so we don’t block the critical path; can be same task or a follow-up).
- **Reuse**: Reuse the same logic as `_build_key_facts_from_document` (views.py) to get `(facts, llm_summary)` from the document row (so we use document_summary + document text and optional LLM fallback).

### 1.2 What to store

- Add a single stored field for the **paragraph form** of key facts:
  - **Option A – New field in `document_summary`**: e.g. `key_facts_text` (string). One or more paragraphs of plain text stating the key facts.
- Keep existing `document_summary` fields (e.g. `summary` if already used elsewhere). The UI will prioritise `key_facts_text` for the Key facts panel.

### 1.3 How to produce the paragraph(s)

- **Generic requirement**: The formatter and any LLM prompts must **not** assume property, real estate, or any specific document domain. They should take whatever facts were extracted (e.g. Document type, Date, Parties, Location, Subject, Amount, etc.) and turn them into neutral prose that works for contracts, letters, reports, invoices, medical docs, etc.
- **Option A – LLM (recommended for “neat” prose)**: Reuse/extend the existing key-facts LLM flow:
  - After building `(facts, llm_summary)` with `_build_key_facts_from_document`, call an LLM with: summary + list of (label, value) and ask for “1–3 short paragraphs stating the key facts in clear prose, no bullet points or labels. Do not assume any specific document type (e.g. not only property or legal); use the given labels and values as-is.”
  - Store the result in `document_summary.key_facts_text`.
- **Option B – No extra LLM**: Format the list of facts into one or two paragraphs in a **generic** way: e.g. “This document is a [Document type]. [Label]: [value]. [Label]: [value]…” or short sentences built from each fact. Do **not** hardcode property/address/valuer phrasing; iterate over whatever labels and values exist. Simpler and free; can be refined with a small formatter that is document-type agnostic.
- **Suggestion**: Start with **Option B** for speed and cost; add **Option A** later if you want more polished prose.

### 1.4 Implementation steps (backend)

1. **Extract a shared helper** (e.g. in `views.py` or a small module used by both views and tasks):
   - `build_key_facts_and_text(document, document_id) -> (facts: list, llm_summary: str | None, key_facts_text: str | None)`.
   - Internally call `_build_key_facts_from_document` to get `(facts, llm_summary)`, then:
     - If you have an LLM step for prose: call it with `(summary or "", facts)` and return the paragraph as `key_facts_text`. Ensure the LLM prompt is generic (all document types).
     - Else: implement a **generic** formatter that turns any list of `{label, value}` (and optionally `llm_summary`) into 1–2 paragraphs—no hardcoded labels or property-specific sentence templates.
2. **Pipeline step** (in `tasks.py`):
   - After document text and `document_summary` are written (parsed text, address, type, chunks, etc.):
     - Load the document row (from Supabase).
     - Call `build_key_facts_and_text(document, document_id)`.
     - If `key_facts_text` is non-empty, call `doc_storage.update_document_summary(..., updates={'key_facts_text': key_facts_text}, merge=True)`.
   - Use the same `document_id` and `business_id` as the rest of the task. Ensure this runs only once per document (idempotent: overwriting `key_facts_text` is fine).
3. **GET endpoint** (`get_document_key_facts`):
   - Prefer stored content:
     - If `document_summary.key_facts_text` is present and non-empty, return it in the API (e.g. `data.key_facts_text`) and do **not** recompute key facts for display.
   - Fallback for old documents without `key_facts_text`:
     - Call `build_key_facts_and_text` (or keep current `_build_key_facts_from_document`), then format on the fly to get a paragraph, and return that as `key_facts_text` (optionally write it back to `document_summary` so next time it’s stored).
   - Keep response shape compatible: e.g. `{ key_facts_text: string | null, summary?: string }`. You can keep returning `key_facts` for backward compatibility or drop it if the frontend only uses `key_facts_text`.

---

## 2. API Response Shape

- **Proposed**: `GET /api/documents/<id>/key-facts` returns:
  - `data.key_facts_text`: string | null — the paragraph(s) to show in the Key facts panel. This is the single source of truth for the new UI.
  - `data.summary`: string | null — optional; keep if other consumers use it.
  - Optionally retain `data.key_facts` for legacy or other UIs; the FileViewModal will ignore it when `key_facts_text` is present.

---

## 3. Frontend: Neat Paragraph(s), No Container Design

### 3.1 FileViewModal (and any other “Key facts” panel)

- **Data**: Request and use `key_facts_text` from the existing key-facts API (extend the type and response handling to include `key_facts_text`).
- **Display**:
  - Remove the grey box list: do not render `key_facts.map(...)` with the current card/container styling.
  - Render `key_facts_text` as one or more paragraphs:
    - Use a simple container (e.g. a `<div>` or `<section>`) with typography classes (e.g. `text-gray-700 text-xs leading-relaxed`, preserve line breaks if the backend sends `\n\n` for paragraph breaks).
  - If `key_facts_text` is null or empty, show a single line such as “No key facts available for this document.”
- **Refresh button**:
  - **Option 1**: Remove it (key facts are fixed after upload).
  - **Option 2**: Keep it and add a backend endpoint or flag to “regenerate key facts” (re-run the same pipeline step and overwrite `key_facts_text`); then “Refresh” would call that and refetch. Prefer **Option 1** unless you need on-demand regeneration.

### 3.2 Cleanup

- Remove or simplify state that was only used for the list (e.g. `keyFacts` array) if the UI no longer shows it; keep `keyFactsSummary` only if you still use `summary` for something, or replace with `keyFactsText` and one paragraph block.
- Ensure no duplicate “Key facts” headings or redundant summary + list; a single “Key facts” section with one or more paragraphs is enough.

---

## 4. Edge Cases and Notes

- **Existing documents**: Documents processed before this change will not have `key_facts_text`. The GET endpoint should fall back to building key facts and formatting them into paragraph(s) on first read (and optionally persist that result so the next read is fast).
- **Truncation / HTML**: The current UI truncates fact values and some backend data had HTML (e.g. `<br />`). When building `key_facts_text`, strip HTML and avoid truncation in the stored prose so the paragraph reads well.
- **Length**: Cap the stored paragraph length if needed (e.g. 1–2k characters) to avoid huge JSONB values; the formatter or LLM can be instructed to keep it concise.
- **Pipeline failure**: If key-facts generation fails during upload, leave `key_facts_text` unset; the GET can still fall back to on-the-fly generation so the UI keeps working.
- **Document-type agnostic**: When implementing `_build_key_facts_from_document` or the formatter, avoid property-only logic (e.g. do not assume “Address” or “Valuer” always exist). Use whatever fields are present in `document_summary` and whatever facts are extracted from text for any document type.

---

## 5. Implementation Order

1. **Backend – formatter and storage**
   - Add `key_facts_text` formatter (list of facts + optional summary → string).
   - Add pipeline step to compute and store `key_facts_text` in `document_summary` after extraction/summary is ready.
2. **Backend – API**
   - Extend `get_document_key_facts` to return `key_facts_text` (from DB or from on-the-fly generation + optional write-back).
3. **Frontend**
   - Extend API client and types to include `key_facts_text`.
   - Change FileViewModal to show only paragraph(s) from `key_facts_text`, remove container design and list rendering.
   - Remove or repurpose “Refresh” as above.
4. **Optional**
   - Add an LLM step for prose-style `key_facts_text` if you want more natural wording.
   - Add “Regenerate key facts” (and optional endpoint) if you want on-demand refresh later.

---

## 6. Files to Touch (Summary)

| Area        | File(s) |
|------------|---------|
| Backend    | `backend/views.py` (helpers, `get_document_key_facts`), `backend/tasks.py` (pipeline step), optionally a small `backend/services/key_facts_service.py` for formatter + shared logic |
| Storage    | No schema change; use existing `document_summary` JSONB and add key `key_facts_text` |
| Frontend   | `frontend-ts/src/components/FileViewModal.tsx`, `frontend-ts/src/services/backendApi.ts` (types and response handling) |

**Generic behaviour**: When touching `_build_key_facts_from_document` and `_llm_summarise_document_for_key_facts` in `views.py`, ensure they remain (or are made) generic: use whatever fields exist in `document_summary` (address/location, type, parties, etc. are optional and document-type dependent) and avoid any wording or logic that assumes property/real estate documents only.

---

This plan gives you a single source of truth for key facts (stored at upload), a neat paragraph-based UI that works for **all document types**, and a safe fallback for documents that were processed before the change.

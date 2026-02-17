---
name: Document and page counter
overview: "Add a simple document and page counter for the current user's profile: backend stores page_count per document and exposes a stats endpoint; processing pipeline sets page_count from Reducto chunks; frontend shows 'X documents · Y pages' and refetches when the list changes."
todos:
  - id: schema
    content: Add page_count column (integer, nullable) to Supabase documents table
    status: pending
  - id: backend-stats
    content: Add GET /api/documents/stats endpoint and optional get_document_stats in DocumentStorageService
    status: pending
  - id: pipeline-page-count
    content: Set document.page_count from Reducto chunks when processing completes (tasks.py + doc_storage.update_document_status)
    status: pending
  - id: frontend-api
    content: Add getDocumentStats() in backendApi and call it from FilingSidebar
    status: pending
  - id: frontend-ui
    content: Display 'X documents · Y pages' in FilingSidebar (refetch on open and after upload/delete)
    status: pending
isProject: false
---

# Plan: Document and page counter (with pages)

Implement a simple profile counter: **document count** and **total pages**, shown in the UI and updated when the user uploads or the list changes. No billing, limits, or tiers. **Only documents with the green dot (Full Extraction / status = completed) are counted** for both numbers.

---

## Scope

- **Backend:** Store `page_count` per document; expose one stats endpoint. Set `page_count` when processing completes (from Reducto chunks).
- **Frontend:** One place (e.g. FilingSidebar) shows "X documents · Y pages", refetching when the sidebar opens and after upload/delete/refresh.

---

## 1. Schema

**Supabase `documents` table**

- Add column: `page_count` (integer, nullable).
- Existing rows stay `NULL` until processing runs or backfill; stats endpoint will treat NULL as 0 when summing.

**Where:** Run in Supabase SQL Editor (or add a migration):

```sql
ALTER TABLE documents ADD COLUMN IF NOT EXISTS page_count integer;
```

---

## 2. Backend: stats endpoint

**New route:** `GET /api/documents/stats`

- **Auth:** `@login_required`.
- **Resolve scope:** Use `_ensure_business_uuid()` (same as [backend/views.py](backend/views.py) `get_files` and proxy_upload). Return 400 if no business.
- **Logic:** For that `business_uuid`, **only count documents that have the green dot (Full Extraction)** — i.e. `status = 'completed'`. So:
  - `document_count` = count of rows in `documents` where `business_uuid` = X **and** `status` = `'completed'`.
  - `total_pages` = sum of `page_count` for those same rows (treat NULL as 0). Each document row is counted once.
- **Response:** `{ "success": true, "document_count": N, "total_pages": M }`.

**Implementation options**

- **A (recommended):** In [backend/views.py](backend/views.py), use Supabase client: one query with `.select('id, page_count', count='exact').eq('business_uuid', business_uuid).eq('status', 'completed')` and in Python compute count and sum(page_count). Or two queries: one count, one sum (if Supabase supports sum in one go, use that). Filter by `status = 'completed'` so only green-dot (fully extracted) docs are included.
- **B:** Add a method on [backend/services/document_storage_service.py](backend/services/document_storage_service.py), e.g. `get_document_stats(business_id)` returning `(document_count, total_pages)`, and call it from the new view. Keeps Supabase logic in one place.

**File:** New view in [backend/views.py](backend/views.py) (e.g. next to `get_files` around 6241). Register route under the same blueprint (e.g. `views`).

---

## 3. Backend: set page_count when processing completes

**Source of page count:** Reducto chunks stored in `document_summary.reducto_chunks` have bbox with `original_page` (or `page`). The max page across all chunks = number of pages for that document.

**Where to set it:** In [backend/tasks.py](backend/tasks.py), in the same place(s) where `document_summary['reducto_chunks']` is written and `doc_storage.update_document_status(..., additional_data={...})` is called. There are at least two flows that store chunks:

- Around **957–960** (and similar after): after building `document_summary['reducto_chunks']`, before or with `update_document_status`.
- Around **2085–2088** (process_document_with_dual_stores or similar): same pattern.

**Logic**

1. From the `chunks` list (same one you put into `document_summary['reducto_chunks']`), compute:
  - For each chunk, get page from `chunk.get('bbox', {}).get('original_page') or chunk.get('bbox', {}).get('page')`, or from first block's bbox; ignore non-numeric.
  - `max_page = max(pages)`; if no pages, `max_page = 0` or leave document unchanged.
2. When calling `doc_storage.update_document_status(document_id, status, business_id, additional_data={...})`, add `'page_count': max_page` to `additional_data`. **Always overwrite** when the pipeline runs (including reprocess), so the latest processing wins.
3. **Do not** set or update `page_count` when the user opens a file in the UI (FileViewModal). Only the processing pipeline writes `page_count`; opening a doc does not touch it.

**Reuse:** You already have `extract_page_number_from_chunk` in [backend/tasks.py](backend/tasks.py). Use it to collect page numbers from all chunks and take the max.

**Edge cases:** If chunks is empty, leave `page_count` as NULL or set 0. No need to backfill old documents in this plan; they’ll get `page_count` when reprocessed or via a separate backfill later.

---

## 4. Frontend: API and UI

**BackendApi**

- In [frontend-ts/src/services/backendApi.ts](frontend-ts/src/services/backendApi.ts) add:
  - `getDocumentStats(): Promise<ApiResponse<{ document_count: number; total_pages: number }>>` that calls `GET /api/documents/stats` with credentials.

**FilingSidebar**

- In [frontend-ts/src/components/FilingSidebar.tsx](frontend-ts/src/components/FilingSidebar.tsx):
  - State: e.g. `documentCount: number | null`, `totalPages: number | null` (null = loading or not loaded).
  - Fetch stats when the sidebar becomes relevant (e.g. when sidebar is opened or when `getAllDocuments` is about to be called). Same triggers as when you refresh the document list (e.g. after upload, delete, or manual refresh).
  - Display: e.g. above or below the file list: "X documents · Y pages" (or "X documents" if you prefer to keep pages on one line). Format numbers with locale (e.g. `toLocaleString()`).
  - Refetch stats after a successful upload (in the same place you refresh the document list) and after delete/refresh so the counter updates in real time without a full page reload.

**Placement:** Near the header of the filing sidebar or just above the list, so it’s visible whenever the user is looking at their files.

---

## 5. Order of implementation

1. **Schema** – Add `page_count` to `documents` in Supabase.
2. **Stats endpoint** – Implement `GET /api/documents/stats` and optional `get_document_stats` in DocumentStorageService.
3. **Pipeline** – In both places in tasks.py where reducto_chunks are stored, compute max page from chunks and pass `page_count` in `update_document_status(..., additional_data={'page_count': max_page})`.
4. **Frontend API** – Add `getDocumentStats()` in backendApi.
5. **Frontend UI** – In FilingSidebar, fetch stats on open and after upload/delete/refresh; render "X documents · Y pages".

---

## 6. Optional later

- **Backfill:** One-off job or script: for each document with `document_summary.reducto_chunks` and NULL `page_count`, compute max page and update `documents.page_count`.
- **Upload-time page count:** When you later add billing, you can set `page_count` at upload time (e.g. via quick_extract) and keep the pipeline update as a fallback so the counter stays correct even if upload-time extraction wasn’t used.

---

## 7. Files to touch


| Step             | File                                                                                         | Change                                                                                                                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema           | Supabase                                                                                     | `ALTER TABLE documents ADD COLUMN page_count integer;`                                                                                                                                                                                       |
| Stats            | [backend/views.py](backend/views.py)                                                         | New route `GET /api/documents/stats`; use `_ensure_business_uuid()`, query documents with `status = 'completed'` only (green dot), then count + sum(page_count).                                                                            |
| Stats (optional) | [backend/services/document_storage_service.py](backend/services/document_storage_service.py) | Optional `get_document_stats(business_id)` returning (count, total_pages).                                                                                                                                                                   |
| Pipeline         | [backend/tasks.py](backend/tasks.py)                                                         | After storing reducto_chunks, compute max_page from chunks; **always overwrite** `page_count` when pipeline runs (reprocess updates it); do not set page_count from opening files in UI. Pass `page_count` in `update_document_status(..., additional_data={'page_count': max_page})` in both code paths. |
| Frontend API     | [frontend-ts/src/services/backendApi.ts](frontend-ts/src/services/backendApi.ts)             | Add `getDocumentStats()`.                                                                                                                                                                                                                    |
| Frontend UI      | [frontend-ts/src/components/FilingSidebar.tsx](frontend-ts/src/components/FilingSidebar.tsx) | State for stats; fetch on open and after upload/delete/refresh; display "X documents · Y pages".                                                                                                                                             |


No new dependencies. Existing patterns (Supabase, Flask route, backendApi, FilingSidebar refresh) are reused.
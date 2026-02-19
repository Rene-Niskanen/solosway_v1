---
name: ""
overview: ""
todos: []
isProject: false
---

# Citation single-page preview API – implementation plan

## Goal

Make citation callout previews load much faster by having the backend serve **one page as an image** per citation instead of the frontend downloading the full PDF and rendering one page. Same auth and access rules as the existing download endpoint; clear fallback if the new endpoint fails.

## Out of scope

- No change to “View document” (full PDF) flow.
- No change to citation text, numbering, or bbox positioning.
- No change to backend streaming (LLM token streaming) in this plan.

---

## Phase 1: Backend – single-page preview endpoint

### 1.1 New route

- **URL:** `GET /api/files/document/<document_id>/page/<int:page_number>/preview`
- **Auth:** `@login_required` (same as [views.py `download_file](backend/views.py)` around 8146).
- **Query or path:** Prefer path args: `document_id` (UUID string), `page_number` (1-based, integer). Optional query `width=1200` to match current frontend scale (default 1200).

### 1.2 Behaviour (reuse existing patterns)

1. **Resolve document and authorize**
  - Use the same logic as `download_file`: get `document_id` from path, call `SupabaseDocumentService().get_document_by_id(document_id)`.
  - If not found → 404.
  - Call `_ensure_business_uuid()`; if missing → 400.
  - If `document['business_uuid'] != business_uuid_str` → 403.
  - Get `s3_path` from document; if missing → 404.
2. **Download PDF from S3**
  - Same S3 client and bucket as `download_file`; `get_object` and read body to bytes. On S3 `NoSuchKey`/NotFound → 404; other ClientError → 500.
3. **Render one page with PyMuPDF**
  - `import fitz` (PyMuPDF). Open with `fitz.open(stream=file_content, filetype="pdf")`.
  - Page index: `page_number` is 1-based; use `doc[page_number - 1]`. If `page_number` < 1 or > `len(doc)` → 404.
  - Target width (e.g. 1200px): get page rect, compute scale so that rendered width ≈ requested `width`, then e.g. `matrix = fitz.Matrix(scale, scale)`, `pix = page.get_pixmap(matrix=matrix, alpha=False)`.
  - Encode: `pix.tobytes("png")` (or equivalent) and return as response body.
4. **Response**
  - `Content-Type: image/png`.
  - Optional headers for frontend cache entry: `X-Image-Width`, `X-Image-Height` (pix.width, pix.height) so the client can build `HoverPreviewCacheEntry` without loading the image to read dimensions.
  - Optional short cache: `Cache-Control: private, max-age=300` (5 minutes) to avoid re-rendering the same page repeatedly. No long-term or public caching (documents are private).
5. **Errors and edge cases**
  - Non-PDF (e.g. unsupported type): after S3 download, try `fitz.open(...)`; on failure return 400 or 415 with a clear message.
  - Invalid `document_id` format (e.g. not UUID): 400.
  - Close the fitz doc in a `try/finally` to avoid leaks.
  - Log errors (e.g. logger.warning for 4xx, logger.error for 5xx) without leaking internals to the client.

### 1.3 Placement and style

- Add the new view in [backend/views.py](backend/views.py) next to `download_file` (after ~8233). Share no new global state; keep S3 and fitz usage local to the handler.
- Reuse `_ensure_business_uuid()` and the same SupabaseDocumentService / S3 pattern as `download_file` so auth and access rules stay identical.

---

## Phase 2: Frontend – use preview API for citation callouts

### 2.1 Preview URL helper

- In [SideChatPanel.tsx](frontend-ts/src/components/SideChatPanel.tsx) (or a small util used by it), add a function that returns the preview URL for a given `docId` and `pageNumber`, e.g.  
`getCitationPagePreviewUrl(docId: string, pageNumber: number, width?: number): string`  
using `VITE_BACKEND_URL` and path `/api/files/document/${docId}/page/${pageNumber}/preview` (and optional `?width=...` if the backend supports it). Use the same base URL as existing `/api/files/download` calls.

### 2.2 New load path in `preloadHoverPreview`

- **Current behaviour:** [preloadHoverPreview](frontend-ts/src/components/SideChatPanel.tsx) (around 3096) fetches full PDF from `/api/files/download?document_id=...`, parses with pdf.js, renders one page to canvas, caches a data URL in `hoverPreviewCache` with `HoverPreviewCacheEntry` (`pageImage`, `imageWidth`, `imageHeight`).
- **New behaviour (prefer preview API):**
  1. Cache key remains `hover-${docId}-${pageNumber}`. If `hoverPreviewCache.has(cacheKey)` or `hoverPreviewLoadingPromises.has(cacheKey)`, behave as now (return cached or existing promise).
  2. Try the new preview API first: `fetch(previewUrl, { credentials: 'include' })`. If response is not ok (e.g. 404, 403, 500), **fallback**: run the existing full-PDF + pdf.js path unchanged (so behaviour is identical when the backend doesn’t support the endpoint or returns an error).
  3. If response is ok: read body as `blob()`, then either:
    - Read optional headers `X-Image-Width` and `X-Image-Height`; if both present, use them for `imageWidth` and `imageHeight`.
    - Otherwise create an `Image()`, set `src` to a blob URL from the blob, and on load use `naturalWidth` and `naturalHeight`; then revoke the blob URL if you created one only for dimension reading, and use a new blob URL for the cache entry (so the cached `pageImage` is a blob URL that stays valid).
  4. Build `HoverPreviewCacheEntry`: `pageImage` = blob URL (or the stable blob URL you use for display), `imageWidth`, `imageHeight`, `timestamp`. Store in `hoverPreviewCache` and resolve the promise. Clean up `hoverPreviewLoadingPromises` in a `finally` (same as today).
  5. **Blob URL lifetime:** Keep the blob URL in the cache; revoke it only when evicting the cache entry (if you add eviction later). For now, no eviction is required; same as current data URLs.

### 2.3 Call sites

- No change to **when** we call `preloadHoverPreview`: keep calling it from `onCitation` (all three streaming paths) and from CitationCallout’s effect when `canShowPreview && inView`. Only the **implementation** of `preloadHoverPreview` changes (try preview API first, then fallback).
- No change to [CitationCallout](frontend-ts/src/components/SideChatPanel.tsx) or [CitationPagePreviewContent](frontend-ts/src/components/CitationClickPanel.tsx): they already consume `CachedPageImage` with `pageImage` (string), `imageWidth`, `imageHeight`. They work with both data URLs and blob URLs.

### 2.4 Fallback and robustness

- If the preview request fails (network, 4xx, 5xx), **always** fall back to the current full-PDF + pdf.js path so that citations still show even when the new endpoint is missing or broken.
- Do not show a generic error to the user for a failed preview request; only fall back and optionally log (e.g. `console.warn`) for debugging.

---

## Phase 3: Testing and rollback

### 3.1 Backend

- **Unit or route test:** With a test user and a known PDF document in the DB/S3, GET the new preview URL for page 1; assert 200, `Content-Type: image/png`, and body size > 0. Request an out-of-range page; assert 404. Request with another business’s document ID (or unauthenticated); assert 403 (or 401).
- **Manual:** Open the preview URL in the browser (while logged in); confirm the image displays.

### 3.2 Frontend

- **Manual:** Trigger a citation (e.g. ask a question that produces citations). Confirm callout previews load and match previous appearance (bbox, zoom, layout). Check network: preview requests to the new endpoint and no full-PDF download for the same citation when the preview succeeds.
- **Fallback:** Temporarily break the backend route (e.g. return 404) or use a backend that doesn’t have the route; confirm citations still load via the full-PDF path and no console errors that block rendering.

### 3.3 Rollback

- **Backend:** Remove or disable the new route; no other behaviour depends on it.
- **Frontend:** Revert the changes inside `preloadHoverPreview` so it only uses the full-PDF path again; no API contract change for parents or CitationCallout.

---

## Summary


| Item       | Action                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend    | New `GET /api/files/document/<id>/page/<page>/preview`: same auth as download, S3 fetch, PyMuPDF render one page to PNG, return with optional X-Image-Width/Height and short private cache. |
| Frontend   | `preloadHoverPreview` tries this URL first; on success cache blob URL + dimensions; on failure fall back to existing full-PDF + pdf.js path.                                                |
| Call sites | Unchanged (onCitation + CitationCallout effect).                                                                                                                                            |
| Rollback   | Remove route or revert `preloadHoverPreview` to current implementation.                                                                                                                     |


This keeps access control and behaviour identical while making citation previews much faster when the new endpoint is available, and preserves correctness when it is not.
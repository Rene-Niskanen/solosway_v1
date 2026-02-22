# LobeHub-style file attachments and better extraction

## Part A: Fix routing (existing plan summary)

- In `main_graph.simple_route`, route to `handle_attachment_fast` when `attachment_context` has content and `response_mode == 'fast'` (instead of checking `attached_document` / `fast_mode` which are never set).
- No new state keys; keep using `attachment_context` and `response_mode` from `views.py`.

---

## Part B: Better extraction (use LobeHub-style methods)

**Current state:** We use PyMuPDF (PDF), python-docx (DOCX), and plain decode (TXT). No OCR, no legacy .doc, no layout-aware extraction.

**What LobeHub uses** ([packages/file-loaders](https://github.com/lobehub/lobehub/tree/canary/packages/file-loaders)):

- **PDF:** `pdfjs-dist` (Mozilla PDF.js)
- **DOCX:** `mammoth`
- **Legacy .doc:** `word-extractor`
- **Office (broad):** `officeparser`
- **Excel:** `xlsx`
- **Optional:** PDF OCR skill (external), Unstructured mentioned in self-hosting docs

Their stack is **Node/JS**. We are **Python**. So we don’t copy their code literally; we use **equivalent or better Python options** so extraction is “like LobeHub” but in our backend.

### B.1 Options to improve our extraction

| Goal | LobeHub-style | Our Python approach |
|------|----------------|---------------------|
| Richer PDF (layout, tables) | pdfjs-dist | **Unstructured.io** (Python) or keep PyMuPDF and add `get_text("dict")` / blocks for order |
| Scanned PDF / image PDF | OCR skill | **Unstructured** with OCR, or **pytesseract + pdf2image** as fallback when PyMuPDF returns almost no text |
| Legacy .doc | word-extractor | **textract** or **antiword** (CLI) or **olefile** + extract text |
| More formats (PPT, HTML, etc.) | officeparser, etc. | **Unstructured.io** (PDF, DOCX, PPT, HTML, MD, …) |
| Single “best practice” pipeline | file-loaders | **Unstructured** as primary for quick-extract (one lib, many formats, layout + optional OCR) |

### B.2 Recommended: Add Unstructured.io for quick-extract

- **Why:** One Python library, many formats, layout-aware chunks, optional OCR. Matches the “better methods” idea and LobeHub’s mention of Unstructured in self-hosting.
- **How:** In [backend/services/quick_extract_service.py](backend/services/quick_extract_service.py):
  - Add optional use of `unstructured` (e.g. `partition_pdf`, `partition_docx`) when available.
  - Keep PyMuPDF + python-docx as fallback (or use Unstructured as primary and current code as fallback if Unstructured fails).
  - Return same shape: `success`, `text`, `page_texts`, `page_count`, `error`.
- **Deps:** `pip install unstructured` (and system deps if using OCR: `tesseract`, `poppler`). Optional: `unstructured[pdf]` or `unstructured[all]` for minimal install.

### B.3 Optional improvements

- **OCR fallback:** When PyMuPDF (or Unstructured) returns very little text from a PDF, run an OCR path (Unstructured OCR or pytesseract on rendered pages) and use that for `page_texts` / `text`.
- **Legacy .doc:** Add a branch in `quick_extract_service` for `file_type == 'doc'` using `textract` or `antiword`; return same dict shape.
- **Layout order:** If we keep PyMuPDF-only for PDF, use `get_text("dict")` or blocks to reconstruct reading order and join text, so tables and columns are less jumbled.

### B.4 Implementation order

1. **Routing fix** (Part A) so attachment fast path runs.
2. **Unstructured.io** for quick-extract (primary or fallback) so we have one “better” extraction path that matches LobeHub-style quality.
3. **OCR fallback** for image-only PDFs when extracted text length is below a threshold.
4. **.doc support** and layout tweaks as needed.

This keeps our architecture and Python backend while making extraction quality and format support closer to what LobeHub and similar repos use.

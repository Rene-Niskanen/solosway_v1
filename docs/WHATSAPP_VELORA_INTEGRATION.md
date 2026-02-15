# WhatsApp Integration for Velora (Query + Citation Screenshots)

This doc outlines what it takes to add a WhatsApp channel so users can query Velora like the web app, with citations delivered as **screenshot images** instead of in-document preview.

## High-level flow

1. User sends a WhatsApp message (query).
2. Your backend receives it via **WhatsApp Business Cloud API** webhook.
3. Backend maps the WhatsApp user to a Velora user/session and runs the **same RAG pipeline** as the web (`/api/llm/query/stream` logic, but non-streaming).
4. Response = **text reply** (answer) + **one image per citation** (screenshot of the cited page/region).

---

## 1. WhatsApp Business setup

- **WhatsApp Business Cloud API** (Meta): create app, get App ID, configure webhook, get permanent access token.
- **Business phone number** verified and linked to the app.
- **Webhook**:
  - **Verify**: `GET` with `hub.mode`, `hub.verify_token`, `hub.challenge`; respond with `hub.challenge` if token matches.
  - **Receive messages**: `POST` with JSON body; parse `messages` (e.g. `type: text`), extract `from` (phone), `text.body` (query). Reply with 200 quickly, then process async.
- **Send API**: use Cloud API to send:
  - Text message (the answer).
  - Image messages (citation screenshots) — e.g. `type: image`, image by URL or binary upload.

Docs: [Set up webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/), [Send messages](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages/).

---

## 2. Backend: what to add

### 2.1 Webhook endpoint (new)

- Route, e.g. `POST /api/webhooks/whatsapp` (and optionally `GET` for verification).
- Verify webhook signature/token (use `WEBHOOK_VERIFY_TOKEN` env).
- From webhook payload:
  - Get sender phone (and optionally name).
  - Get message text → **user query**.
- **Map phone → Velora user**:  
  Either store `phone_number → user_id` (after linking in app) or use a single “WhatsApp bot” user; then resolve `user_id` and optionally `business_id` / `property_id` / `document_ids` from your DB (e.g. “default project” or last context).
- Call your existing **query pipeline** (see 2.2) with that user/session.
- When pipeline returns **summary + citations**, generate citation images (2.3) and send **one text message + N image messages** via WhatsApp Send API.

All of this can live in a small Flask blueprint or a separate service that calls into your existing app.

### 2.2 Reuse the existing query pipeline (non-streaming)

- The web uses **streaming**: `run_and_stream()` in `backend/views.py` (e.g. around 2646–2669) yields SSE chunks and at the end a `complete` chunk with:
  - `summary`
  - `citations` / `citations_array` (doc_id, page_number, bbox, original_filename, etc.).
- For WhatsApp you don’t need SSE. Options:
  - **Option A**: Add a non-streaming path that runs the same graph and returns a single result (e.g. a function that runs the main graph and returns `{ summary, citations }`). Reuse the same inputs: `query`, `property_id`, `document_ids`, `message_history`, `session_id`, `citation_context`, etc.
  - **Option B**: Call the existing stream endpoint internally and consume the stream until you get the `complete` event; then use `summary` and `citations` from that.
- Use the same **session_id** rules (e.g. `SessionManager.get_thread_id(user_id, business_id, session_id)`) so conversation history is consistent. For WhatsApp you might derive `session_id` from phone number (e.g. `wa-<phone>`).

So: **same RAG, same citations structure** — only the transport (WhatsApp) and citation presentation (images) change.

### 2.3 Citation screenshot (backend)

Today, citation “preview” is done in the **browser**: PDF is downloaded via `/api/files/download?document_id=...`, then pdf.js renders a page to canvas and (optionally) crops to bbox. For WhatsApp you need the same **server-side**.

- **New internal API or service** (e.g. “citation image service”) that:
  - **Input**: `document_id`, `page_number`, optional `bbox` (normalized or in page coords), optional `scale`/DPI.
  - **Steps**:
    1. Load file bytes the same way as `/api/files/download` (using existing auth/service identity), but **server-side** (no cookie; use the same storage/S3 path resolution).
    2. If PDF: use **PyMuPDF** (already used in `backend/services/quick_extract_service.py`) to render the page to an image:
      - `fitz.open(stream=file_bytes, filetype="pdf")`
      - `page = doc[page_number - 1]`
      - If `bbox`: convert to `fitz.Rect` and use `page.get_pixmap(matrix=..., clip=rect)` (or render full page then crop in PIL if you prefer).
      - If no bbox: `page.get_pixmap(dpi=150)` (or similar) for full page.
      - `pix.tobytes("png")` or `pix.save(...)` to get PNG bytes.
    3. If DOCX: you don’t currently render DOCX to images in the backend; options are (a) skip image for DOCX and send “Citation from &lt;filename&gt; (page X)” as text, or (b) add a DOCX→image path (e.g. LibreOffice headless or a docx-to-pdf then PyMuPDF).
- **Output**: PNG bytes (or a temporary file/URL) to be sent as WhatsApp image.
- **Auth**: This should be callable only by your backend (e.g. internal call with `user_id` or system token), not exposed to the public; the WhatsApp webhook handler would call it after the RAG returns citations.

So: **one new backend piece** that, for each citation with `doc_id` and `page_number` (and optional bbox), produces one PNG and then you send it as an image message in WhatsApp.

---

## 3. Data and auth

- **Linking WhatsApp to Velora**: You need a way to know which Velora user (and optionally which property/project) the WhatsApp number is querying. For example:
  - In the web app, “Link WhatsApp” flow: user enters phone, you send a code; after verification, store `user_id ↔ phone_number` (and optionally default `property_id`).
  - Or use a single shared “bot” user and one default context.
- **Scoping**: Use the same `property_id` / `document_ids` / `message_history` / `session_id` as the web so that “what documents can this user see?” and “what conversation is this?” are consistent.
- **Rate limits / abuse**: WhatsApp has its own limits; you may also want per-user or per-phone rate limits so one user can’t overload your RAG pipeline.

---

## 4. Summary checklist

| Piece | Status in Velora | What to do |
|-------|-------------------|------------|
| WhatsApp Business + webhook | New | Meta app, webhook URL (HTTPS), verify + receive messages |
| Map phone → user/session | New | DB + optional “Link WhatsApp” in web app |
| Run RAG query (same as web) | Exists | Add non-streaming path or consume stream; same inputs (query, property_id, document_ids, session_id, etc.) |
| Citation payload (doc_id, page, bbox) | Exists | Already in `citations_map_for_frontend` / `citations_array` |
| PDF page → image | Partial | PyMuPDF in backend; add a small “citation image” service that uses `/api/files/download`-style file fetch + `fitz` to render page (and optional bbox) to PNG |
| DOCX citation image | Not in backend | Optional: add DOCX→image or send text-only for DOCX citations |
| Send text + images via WhatsApp | New | Call WhatsApp Cloud API: one text (answer), then one image per citation (upload or URL) |

So: **WhatsApp connection** = webhook + user mapping + reusing the existing query pipeline; **citations as photos** = backend service that turns each citation (doc_id + page + optional bbox) into a PNG using PyMuPDF (and optionally DOCX later), then send those PNGs as WhatsApp images after the text reply.

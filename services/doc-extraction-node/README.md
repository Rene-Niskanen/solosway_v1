# Doc Extraction Service

HTTP wrapper around the **same extraction stack as LobeHub file-loaders** (open-source; no LobeHub API key or hosted service). Used by the Python backend when `EXTRACTION_SERVICE_URL` is set (e.g. `http://localhost:5002`).

- **Same libraries** as [LobeHub file-loaders](https://github.com/lobehub/lobehub/tree/main/packages/file-loaders): pdfjs-dist, mammoth, word-extractor, officeparser, xlsx. We run this **locally** — LobeHub does not provide a hosted extraction API or private key.
- **Formats:** PDF, DOC, DOCX, XLS/XLSX, PPTX, and all text-readable extensions (txt, md, json, etc.).
- **Port 5002 is reserved for this service.** Do not run the embedding server (embedding_server.py) on 5002; use a different port (e.g. 5003).

## Endpoints

- `POST /extract` — multipart form field `file`; returns JSON matching the backend quick-extract shape (`success`, `text`, `page_texts`, `page_count`, `file_type`, `filename`, etc.).
- `GET /health` — returns `{"status":"ok"}`.

## Run locally

```bash
npm install
npm run build
npm start
# Or: npm run dev  (tsx, no build)
```

Listens on port 5002 (or `PORT` env). The main app start script (`./start-velora-go.sh`) starts this service when present and Node is available. Ensure nothing else (e.g. the local embedding server) is bound to 5002.

## Env (backend)

Set in `.env` to enable:

```
EXTRACTION_SERVICE_URL=http://localhost:5002
```

If unset or the service is unreachable, the backend falls back to Python extractors (PDF, DOCX, TXT only).

---
name: ""
overview: ""
todos: []
isProject: false
---

# Doc extraction implementation – fixes plan

## Issues identified

### 1. Node server: no Multer error handling (medium)

**Issue:** When the uploaded file exceeds the size limit, Multer rejects the request and calls `next(err)` with a `MulterError` (e.g. `LIMIT_FILE_SIZE`). The app has no Express error-handling middleware for that, so the client gets Express’s default error response (often HTML or a generic 500), not the JSON shape the Python client expects.

**Impact:** Python’s `requests.post(...)` may get 413 or 500 with a non-JSON body; `resp.json()` can raise `JSONDecodeError`. The code is already in a broad `try/except`, so we fall back to Python, but the log is a generic exception instead of “file too large”, and the client might see an unhelpful error.

**Fix:**

- In [services/doc-extraction-node/src/server.ts](services/doc-extraction-node/src/server.ts), add Express error-handling middleware **after** the routes (e.g. after `app.post('/extract', ...)`).
- In that middleware, detect `err.code === 'LIMIT_FILE_SIZE'` (Multer’s code for file size). Respond with **413**, `Content-Type: application/json`, and body `{ "success": false, "error": "File too large (max 100 MB)." }` (see item 4 for limit).
- Optionally handle other Multer errors (e.g. `LIMIT_UNEXPECTED_FILE`) with 400 and a similar JSON body so all Multer failures return the same contract.

**Reference:** Multer passes errors to `next(err)`; Express 4 error middleware is `(err, req, res, next) => { ... }`.

---

### 2. Start script: Node build runs in background (medium)

**Issue:** In [scripts/start-velora-go.sh](scripts/start-velora-go.sh), step 3 runs:

```bash
(cd "$PROJECT_ROOT/services/doc-extraction-node" && npm run build 2>/dev/null; node dist/server.js) & ...
```

The whole command is run in the background. So `npm run build` runs in the background too. After only **1 second** the script continues to step 4 (Flask). On first run or after a clean, `npm run build` can take several seconds; `node dist/server.js` may not have started yet, or may start before `dist/` exists and then exit. Flask can then receive quick-extract requests before the Node service is listening, causing fallbacks or 5xx from the client.

**Fix:**

- Run the build **synchronously** before backgrounding the Node process. For example:
  - `(cd ... && npm run build 2>/dev/null)` (no `&`) so the script waits for build to finish (or fail).
  - Then start the server in the background: `(cd ... && node dist/server.js) &`.
- Optionally, only start the Node server if `dist/server.js` exists (e.g. `[ -f .../dist/server.js ] && node dist/server.js &`), so we don’t start Node if build failed silently due to `2>/dev/null`.

---

### 3. Python: non-JSON response from Node (low)

**Issue:** In [backend/services/quick_extract_service.py](backend/services/quick_extract_service.py), `_extract_via_node_service` does `resp.json()`. If the Node service returns an error page (e.g. 502/504 from a proxy, or HTML from Express on an unhandled error), `resp.json()` raises `requests.exceptions.JSONDecodeError`. It’s caught by the broad `except Exception`, so we fall back to Python correctly, but the log message is generic (“Node service call failed …”) and doesn’t indicate “response was not JSON”.

**Fix:**

- In the same `try` block, catch `ValueError` (or `requests.exceptions.JSONDecodeError` if you use that) when calling `resp.json()`. Log a clear message such as “Node returned non-JSON response (status=%s)” and then return `None` (or re-raise and let the outer `except` handle it). This keeps behavior the same (fallback to Python) but makes debugging easier when Node is misconfigured or returns HTML/plain text.

---

### 4. Increase file size limit to 100 MB and align timeouts (new)

**Requirement:** Allow uploads up to **100 MB** and ensure timeouts are sufficient for large upload + parse.

**Changes:**

- **Node** [services/doc-extraction-node/src/server.ts](services/doc-extraction-node/src/server.ts):
  - Set `MAX_FILE_SIZE = 100 * 1024 * 1024` (100 MB). Use this in `multer({ limits: { fileSize: MAX_FILE_SIZE } })`.
  - Set `REQUEST_TIMEOUT_MS = 120_000` (120 seconds) so large uploads and parsing have enough time; keep `req.setTimeout(REQUEST_TIMEOUT_MS)` in the `/extract` handler.
  - In the Multer error middleware (item 1), use error message: `"File too large (max 100 MB)."`.
- **Python** [backend/services/quick_extract_service.py](backend/services/quick_extract_service.py):
  - Set `NODE_EXTRACTION_TIMEOUT = 115` (seconds), i.e. slightly less than Node’s 120 s so the client times out first and gets a clean timeout instead of a broken connection.

Optional: make the limit configurable via env (e.g. `EXTRACTION_MAX_FILE_MB`, default 100) and document in README / `.env.example`; the plan assumes a fixed 100 MB for simplicity.

---

## Summary


| #   | Location                 | Issue                                                                         | Fix                                                                                                                               |
| --- | ------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Node server              | No handler for Multer errors (e.g. file too large)                            | Add Express error middleware; on LIMIT_FILE_SIZE return 413 with JSON body "max 100 MB"; optionally 400 for other Multer errors.  |
| 2   | start-velora-go.sh       | Build and server both run in background; Flask may start before Node is ready | Run `npm run build` synchronously, then start `node dist/server.js` in background; optionally guard with `[ -f dist/server.js ]`. |
| 3   | quick_extract_service.py | Node non-JSON response only logged as generic exception                       | Catch JSON decode error and log “Node returned non-JSON (status=…)” then return None.                                             |
| 4   | Node + Python            | Limit 50 MB / 60 s may be tight for larger docs                               | Node: 100 MB max file size, 120 s request timeout; Python: NODE_EXTRACTION_TIMEOUT = 115 s.                                       |


No changes to the API contract or frontend are required; the fixes are robustness and operability only.
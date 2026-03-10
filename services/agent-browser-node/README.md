# agent-browser Service

HTTP wrapper around [agent-browser](https://github.com/vercel-labs/agent-browser) for URL content extraction. Used by OpenFind to enrich web search results (Exa URLs) with full page content.

## Setup

```bash
cd services/agent-browser-node
npm install
npx agent-browser install   # Downloads Chromium (required, one-time)
npm run build
npm start
```

## Endpoints

- `GET /health` — Readiness check. Returns 503 if agent-browser/Chromium is not available.
- `POST /extract` — Body: `{ urls: string[] }`. Visits each URL, extracts title and body text. Returns `{ success, results: [{ url, title, content, error? }] }`.

## Environment

- `PORT` — Server port (default: 5004)
- `AGENT_BROWSER_EXTRACT_TIMEOUT` — Per-URL timeout in seconds (default: 15)
- `AGENT_BROWSER_MAX_URLS` — Max URLs to fetch per request (default: 3)

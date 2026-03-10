/**
 * HTTP server for agent-browser URL content extraction.
 * POST /extract: { urls: string[] } -> { results: { url, title, content }[] }
 * GET /health: readiness check (verifies agent-browser/Chromium available)
 */

import express, { Request, Response } from 'express';
import { extractFromUrls } from './browser';

const PORT = parseInt(process.env.PORT || '5004', 10);
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_URLS = 3;

const app = express();
app.use(express.json());

app.get('/health', async (_req: Request, res: Response) => {
  try {
    // Quick sanity check: agent-browser --help should work
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec);
    await execAsync('npx agent-browser --help', { timeout: 5000 });
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      error: 'agent-browser not available. Run: npx agent-browser install',
    });
  }
});

app.post('/extract', async (req: Request, res: Response) => {
  const body = req.body as { urls?: string[] };
  const urls = Array.isArray(body?.urls) ? body.urls : [];

  if (urls.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing or empty urls array. Send { urls: string[] }.',
    });
  }

  const timeoutSec = parseInt(process.env.AGENT_BROWSER_EXTRACT_TIMEOUT || '15', 10);
  const maxUrls = parseInt(process.env.AGENT_BROWSER_MAX_URLS || '3', 10);

  try {
    const results = await extractFromUrls(urls, {
      timeoutMs: timeoutSec * 1000,
      maxUrls,
    });
    res.status(200).json({ success: true, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Extract error:', message);
    res.status(500).json({
      success: false,
      error: `Extraction failed: ${message}`,
    });
  }
});

app.listen(PORT, () => {
  console.log(`agent-browser service listening on http://localhost:${PORT}`);
});

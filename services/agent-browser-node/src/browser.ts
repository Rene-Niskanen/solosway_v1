/**
 * agent-browser invocation logic for URL content extraction.
 * Uses agent-browser CLI via subprocess for reliability.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = 15_000; // 15s per URL
const MAX_CONTENT_CHARS = 15_000;

export interface ExtractResult {
  url: string;
  title: string;
  content: string;
  error?: string;
}

/**
 * Extract title and main text content from a URL using agent-browser.
 * Uses an isolated session to avoid cross-request interference.
 */
export async function extractFromUrl(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ExtractResult> {
  const sessionId = `extract-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const runCmd = async (cmd: string): Promise<string> => {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: Math.min(timeoutMs, 25_000), // agent-browser default Playwright timeout is 25s
      maxBuffer: 1024 * 1024, // 1MB
      env: { ...process.env, AGENT_BROWSER_SESSION: sessionId },
    });
    if (stderr && !stdout) throw new Error(stderr);
    return (stdout || '').trim();
  };

  try {
    // 1. Open URL
    await runCmd(`npx agent-browser --session ${sessionId} open "${url}"`);

    // 2. Get title
    let title = '';
    try {
      title = await runCmd(`npx agent-browser --session ${sessionId} get title`);
    } catch {
      title = new URL(url).hostname || url;
    }

    // 3. Get main content (body text) - use --json for structured output
    // Use String() instead of '' to avoid shell quote escaping issues
    let content = '';
    try {
      const expr = `(document.body&&document.body.innerText||String()).slice(0,${MAX_CONTENT_CHARS})`;
      const raw = await runCmd(`npx agent-browser --session ${sessionId} eval "${expr}" --json`);
      const parsed = JSON.parse(raw) as { success?: boolean; data?: { result?: string } };
      if (parsed?.data?.result != null && typeof parsed.data.result === 'string') {
        content = parsed.data.result;
      }
    } catch {
      content = '';
    }

    // 4. Close browser
    try {
      await runCmd(`npx agent-browser --session ${sessionId} close`);
    } catch {
      // Ignore close failures
    }

    return { url, title, content };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Try to close session on error
    try {
      await runCmd(`npx agent-browser --session ${sessionId} close`).catch(() => {});
    } catch {
      // ignore
    }
    return {
      url,
      title: '',
      content: '',
      error: `Extraction failed: ${message}`,
    };
  }
}

/**
 * Extract content from multiple URLs. Returns partial results on partial failure.
 */
export async function extractFromUrls(
  urls: string[],
  options: { timeoutMs?: number; maxUrls?: number } = {}
): Promise<ExtractResult[]> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxUrls = 3 } = options;
  const toFetch = urls.slice(0, maxUrls);
  const results: ExtractResult[] = [];

  for (const url of toFetch) {
    try {
      const result = await extractFromUrl(url, timeoutMs);
      results.push(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        url,
        title: '',
        content: '',
        error: message,
      });
    }
  }

  return results;
}

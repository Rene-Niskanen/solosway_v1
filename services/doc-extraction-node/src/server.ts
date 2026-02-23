/**
 * HTTP server wrapping LobeHub file-loaders for document extraction.
 * POST /extract: multipart file -> extract -> return quick-extract shape.
 * GET /health: readiness check.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express, { Request, Response } from 'express';
import multer from 'multer';

import { loadFile } from './loadFile';
import type { FileDocument } from './types';

const PORT = parseInt(process.env.PORT || '5002', 10);
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const REQUEST_TIMEOUT_MS = 120_000; // 120 seconds (large upload + parse)
const MAX_PAGES = 50; // mirror Python MAX_QUICK_EXTRACT_PAGES

const app = express();

const tempBase = path.join(os.tmpdir(), 'doc-extraction');
fsSync.mkdirSync(tempBase, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(tempBase, String(Date.now()) + '-' + Math.random().toString(36).slice(2));
      fsSync.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const base = path.basename(file.originalname || 'document') || 'document';
      const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
      cb(null, safe);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE },
});

function fileDocumentToQuickExtractShape(
  doc: FileDocument,
  filename: string,
  truncated: boolean,
): Record<string, unknown> {
  const pageTexts = (doc.pages ?? []).map((p) => p.pageContent);
  const text = doc.content ?? '';
  const pageCount = pageTexts.length;
  const success = !doc.metadata?.error && (pageCount > 0 || text.length > 0);

  return {
    success,
    text,
    page_texts: pageTexts,
    page_count: pageCount,
    file_type: doc.fileType ?? 'unknown',
    filename,
    ...(doc.metadata?.error && { error: doc.metadata.error }),
    char_count: doc.totalCharCount ?? text.length,
    word_count: text.split(/\s+/).filter(Boolean).length,
    extracted_pages: pageCount,
    truncated,
  };
}

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.post(
  '/extract',
  upload.single('file'),
  (reqOrErr: Request | Error, _resOrReq: Response | Request, _nextOrRes: unknown, next?: (err?: Error) => void) => {
    // When Multer calls next(err), Express invokes this with (err, req, res, next). Forward to error middleware.
    const err = reqOrErr as { code?: string };
    if (next && err && (err instanceof Error || typeof err.code === 'string')) return next(err as Error);
    if (typeof _nextOrRes === 'function') (_nextOrRes as () => void)();
  },
  async (req: Request, res: Response) => {
    req.setTimeout(REQUEST_TIMEOUT_MS);
    const tmpDir = req.file?.destination;
    const filePath = req.file?.path;
    const filename = req.file?.originalname || req.file?.filename || 'document';

    if (!filePath || !req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file provided. Send multipart/form-data with field "file".',
      });
    }

    try {
      const doc: FileDocument = await loadFile(filePath, { filename });
      let pageTexts = doc.pages ?? [];
      let content = doc.content ?? '';
      let truncated = false;

      if (pageTexts.length > MAX_PAGES) {
        truncated = true;
        pageTexts = pageTexts.slice(0, MAX_PAGES);
        content = pageTexts.map((p) => p.pageContent).join('\n\n');
      }

      const result = fileDocumentToQuickExtractShape(
        { ...doc, pages: pageTexts, content },
        filename,
        truncated,
      );
      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Extraction error:', message);
      res.status(500).json({
        success: false,
        error: `Extraction failed: ${message}`,
      });
    } finally {
      try {
        if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
      } catch (e) {
        console.warn('Failed to remove temp dir:', tmpDir, e);
      }
    }
  },
);

// Multer / upload errors -> JSON response for Python client
app.use((err: unknown, _req: Request, res: Response, _next: () => void) => {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: string }).code;
    if (code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        success: false,
        error: 'File too large (max 100 MB).',
      });
      return;
    }
    if (code === 'LIMIT_UNEXPECTED_FILE' || code === 'LIMIT_PART_COUNT' || code === 'LIMIT_FIELD_KEY') {
      const msg = err instanceof Error ? err.message : (err as { message?: string }).message ?? 'Bad request.';
      res.status(400).json({
        success: false,
        error: msg,
      });
      return;
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error('Unhandled error:', message);
  res.status(500).json({ success: false, error: `Extraction failed: ${message}` });
});

app.listen(PORT, () => {
  console.log(`Doc extraction service listening on http://localhost:${PORT}`);
});

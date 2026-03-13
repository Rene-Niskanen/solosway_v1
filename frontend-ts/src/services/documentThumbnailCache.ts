/**
 * In-memory cache of document thumbnail blob URLs (first-page previews) for the FilingSidebar.
 * Preloaded when the document list is available so thumbnails load instantly.
 */

const MAX_CACHE_SIZE = 80;
const PRELOAD_LIMIT = 60;
const PRELOAD_CONCURRENCY = 12;
const THUMBNAIL_WIDTH = 200; // 48px display, backend min is 200 – smaller than 280 for faster loads

type CacheEntry = { url: string };
const cache = new Map<string, CacheEntry>();
const accessOrder: string[] = [];

type Listener = () => void;
const listeners = new Set<Listener>();

function evictOne(): void {
  if (accessOrder.length === 0) return;
  const id = accessOrder.shift()!;
  const entry = cache.get(id);
  if (entry) {
    try {
      URL.revokeObjectURL(entry.url);
    } catch (_) {}
    cache.delete(id);
  }
}

function touch(id: string): void {
  const idx = accessOrder.indexOf(id);
  if (idx >= 0) accessOrder.splice(idx, 1);
  accessOrder.push(id);
}

function buildPreviewUrl(docId: string): string {
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';
  return `${backendUrl}/api/files/document/${encodeURIComponent(docId)}/page/1/preview?width=${THUMBNAIL_WIDTH}`;
}

export function getDocumentThumbnailUrl(docId: string): string {
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';
  return `${backendUrl}/api/files/document/${encodeURIComponent(docId)}/page/1/preview?width=${THUMBNAIL_WIDTH}`;
}

export function getCachedThumbnailUrl(docId: string): string | null {
  const entry = cache.get(docId);
  if (!entry) return null;
  touch(docId);
  return entry.url;
}

function setCachedThumbnailUrl(docId: string, url: string): void {
  if (cache.has(docId)) {
    touch(docId);
    return;
  }
  while (cache.size >= MAX_CACHE_SIZE) evictOne();
  cache.set(docId, { url });
  accessOrder.push(docId);
  listeners.forEach((cb) => cb());
}

/** Subscribe to cache updates (e.g. when preload adds new entries). */
export function subscribeToThumbnailCache(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export interface DocForThumbnail {
  id: string;
  original_filename?: string;
}

function isPdfForThumbnail(doc: DocForThumbnail): boolean {
  const f = (doc.original_filename || '').toLowerCase();
  return f.endsWith('.pdf') && !['.doc', '.docx', '.xlsx', '.xls', '.pptx', '.ppt'].some((ext) => f.endsWith(ext));
}

/**
 * Preload thumbnails for PDF docs (skips already-cached).
 * Call when the document list is available so thumbnails load before they scroll into view.
 */
export async function preloadThumbnails(docs: DocForThumbnail[]): Promise<void> {
  const toFetch = docs
    .filter((d) => isPdfForThumbnail(d) && !cache.has(d.id))
    .slice(0, PRELOAD_LIMIT);
  if (toFetch.length === 0) return;

  const run = async (batch: DocForThumbnail[]): Promise<void> => {
    await Promise.all(
      batch.map(async (doc) => {
        try {
          const url = buildPreviewUrl(doc.id);
          const res = await fetch(url, { credentials: 'include' });
          if (!res.ok) return;
          const blob = await res.blob();
          const objectUrl = URL.createObjectURL(blob);
          setCachedThumbnailUrl(doc.id, objectUrl);
        } catch (_) {
          // ignore per-doc errors
        }
      })
    );
  };

  for (let i = 0; i < toFetch.length; i += PRELOAD_CONCURRENCY) {
    await run(toFetch.slice(i, i + PRELOAD_CONCURRENCY));
  }
}

/**
 * Get the best URL for a thumbnail: cached blob if available, else direct API URL.
 */
export function getThumbnailSrc(docId: string): string {
  return getCachedThumbnailUrl(docId) || getDocumentThumbnailUrl(docId);
}

/**
 * Clear thumbnail cache (e.g. when fixing stale previews after backend changes).
 */
export function clearDocumentThumbnailCache(): void {
  for (const [, entry] of cache) {
    try {
      URL.revokeObjectURL(entry.url);
    } catch (_) {}
  }
  cache.clear();
  accessOrder.length = 0;
  listeners.forEach((cb) => cb());
}

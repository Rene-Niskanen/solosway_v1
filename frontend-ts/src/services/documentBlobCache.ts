/**
 * In-memory cache of document blobs (object URLs) for the File View pop-up.
 * Preloaded when FilingSidebar opens so clicking a file opens instantly.
 */

const MAX_CACHE_SIZE = 50;
const PRELOAD_LIMIT = 40;
const PRELOAD_CONCURRENCY = 10;

type CacheEntry = { url: string };
const cache = new Map<string, CacheEntry>();
const accessOrder: string[] = []; // oldest first, for LRU eviction

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

export function getDocumentBlobUrl(docId: string): string | null {
  const entry = cache.get(docId);
  if (!entry) return null;
  touch(docId);
  return entry.url;
}

export function setDocumentBlobUrl(docId: string, url: string): void {
  if (cache.has(docId)) {
    touch(docId);
    return;
  }
  while (cache.size >= MAX_CACHE_SIZE) evictOne();
  cache.set(docId, { url });
  accessOrder.push(docId);
}

export interface DocForPreload {
  id: string;
  s3_path?: string;
}

function buildDownloadUrl(doc: DocForPreload): string {
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
  return doc.s3_path
    ? `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(doc.s3_path)}`
    : `${backendUrl}/api/files/download?document_id=${doc.id}`;
}

/**
 * Preload document blobs for the given docs (skips already-cached).
 * Fetches up to PRELOAD_LIMIT docs with PRELOAD_CONCURRENCY in flight.
 */
export async function preloadDocumentBlobs(docs: DocForPreload[]): Promise<void> {
  const toFetch = docs
    .filter((d) => !cache.has(d.id))
    .slice(0, PRELOAD_LIMIT);
  if (toFetch.length === 0) return;

  const run = async (batch: DocForPreload[]): Promise<void> => {
    await Promise.all(
      batch.map(async (doc) => {
        try {
          const url = buildDownloadUrl(doc);
          const res = await fetch(url, { credentials: 'include' });
          if (!res.ok) return;
          const blob = await res.blob();
          const objectUrl = URL.createObjectURL(blob);
          setDocumentBlobUrl(doc.id, objectUrl);
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

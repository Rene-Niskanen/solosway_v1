/**
 * Clear all document-related caches to fix stale thumbnails, 404s, or orphaned references.
 * Use when documents show incorrect thumbnails or download failures after S3/DB changes.
 */

import { clearDocumentBlobCache } from '../services/documentBlobCache';

const PROJECTS_PAGE_CACHE_KEY = 'projectsPage_propertyHubsCache';

/**
 * Clears document caches:
 * - localStorage projectsPage_propertyHubsCache (dashboard document list)
 * - window.__preloadedDocumentCovers (in-memory thumbnail cache)
 * - thumbnailDataUrlCache (RecentDocumentCard thumbnails)
 * - documentBlobCache (File View blob URLs)
 */
export async function clearDocumentCache(): Promise<void> {
  try {
    localStorage.removeItem(PROJECTS_PAGE_CACHE_KEY);
  } catch {}

  if (typeof window !== 'undefined') {
    (window as any).__preloadedDocumentCovers = {};
  }

  const { clearThumbnailCache } = await import('../components/RecentDocumentCard');
  clearThumbnailCache();

  clearDocumentBlobCache();
}

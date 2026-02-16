/**
 * Pre-loaded cache for @ mention popover (properties + documents).
 * Popover shows results instantly from cache; no "Searching..." state.
 */

import { backendApi } from '@/services/backendApi';

export type AtMentionItemType = 'property' | 'document';

export interface AtMentionItem {
  type: AtMentionItemType;
  id: string;
  primaryLabel: string;
  secondaryLabel: string;
  payload?: unknown;
}

/** Max items shown when no @ query (initial dropdown). */
const MAX_ITEMS = 15;
/** Max filtered matches when user types (e.g. @highlands) so any doc can be found. */
const MAX_FILTERED_ITEMS = 50;

let cachedItems: AtMentionItem[] = [];
let preloadPromise: Promise<void> | null = null;
let preloadStarted = false;

function normalizePropertyList(data: any): any[] {
  if (!data) return [];
  const raw = Array.isArray(data) ? data : (data?.data && Array.isArray(data.data) ? data.data : data?.data ?? []);
  return Array.isArray(raw) ? raw : [];
}

function normalizeDocList(data: any): Array<{ id: string; filename?: string; original_filename?: string; name?: string; [k: string]: any }> {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  // Backend /api/files returns { success, data: documents }; fetchApi returns { success, data: body } so data may be { success, data: [...] }
  if (data?.data != null && Array.isArray(data.data)) return data.data;
  if (data?.documents && Array.isArray(data.documents)) return data.documents;
  if (data?.data?.documents && Array.isArray(data.data.documents)) return data.data.documents;
  return [];
}

function buildPropertyItems(propertyList: any[]): AtMentionItem[] {
  return (propertyList as any[]).map((hub: any) => {
    const p = hub.property || hub;
    const addr = p.formatted_address || p.normalized_address || p.address || 'Unknown Address';
    return {
      type: 'property' as const,
      id: String(p.id ?? hub.id),
      primaryLabel: p.custom_name || addr,
      secondaryLabel: (hub.property_details || p).property_type || '',
      payload: p,
    };
  });
}

function buildDocItems(docList: Array<{ id: string; filename?: string; original_filename?: string; name?: string; [k: string]: any }>): AtMentionItem[] {
  return docList.map((d: any) => ({
    type: 'document' as const,
    id: String(d.id),
    primaryLabel: d.filename || d.original_filename || d.name || 'Document',
    secondaryLabel: '',
    payload: d,
  }));
}

/**
 * Preload properties and documents into memory. Safe to call multiple times;
 * only the first call performs the fetch; subsequent calls await the same promise.
 */
export function preloadAtMentionCache(): Promise<void> {
  if (preloadPromise) return preloadPromise;
  preloadStarted = true;
  preloadPromise = (async () => {
    try {
      const [propertiesRes, documentsRes] = await Promise.all([
        backendApi.searchPropertyHubs('', {}),
        backendApi.getAllDocuments(),
      ]);
      const propertyList = normalizePropertyList(propertiesRes.success ? propertiesRes.data : null);
      // documentsRes.data may be the array or { success, data: array } (double-wrapped by fetchApi)
      const rawDocs = documentsRes?.data;
      const docList = normalizeDocList(documentsRes?.success ? rawDocs : null);
      const propertyItems = buildPropertyItems(propertyList);
      const docItems = buildDocItems(docList);
      // Documents first so files show in the list; then properties alongside
      cachedItems = [...docItems, ...propertyItems];
    } catch (err) {
      console.warn('@ mention cache preload failed:', err);
      cachedItems = [];
    }
  })();
  return preloadPromise;
}

/**
 * Get filtered items for the popover from cache (instant, no network).
 * When no query: up to MAX_ITEMS (documents first, then properties).
 * When filtering (e.g. @highlands): up to MAX_FILTERED_ITEMS so any document can be found.
 */
export function getFilteredAtMentionItems(query: string): AtMentionItem[] {
  const q = (query || '').trim().toLowerCase();
  if (!q) return cachedItems.slice(0, MAX_ITEMS);
  const filtered = cachedItems.filter((item) =>
    item.primaryLabel.toLowerCase().includes(q) || item.secondaryLabel.toLowerCase().includes(q)
  );
  return filtered.slice(0, MAX_FILTERED_ITEMS);
}

/**
 * Whether the cache has been filled (after preload completed).
 */
export function isAtMentionCacheReady(): boolean {
  return preloadStarted && cachedItems.length >= 0;
}

/**
 * Invalidate cache so next preload refetches. Optional; use if you want to refresh in background.
 */
export function invalidateAtMentionCache(): void {
  preloadPromise = null;
  preloadStarted = false;
  cachedItems = [];
}

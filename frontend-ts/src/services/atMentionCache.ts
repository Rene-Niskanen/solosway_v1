import { backendApi } from './backendApi';

export interface AtMentionItem {
  type: "property" | "document";
  id: string;
  primaryLabel: string;
  payload?: unknown;
}

let cachedItems: AtMentionItem[] | null = null;
let cachePromise: Promise<void> | null = null;

export async function preloadAtMentionCache(): Promise<void> {
  if (cachedItems !== null) return;
  if (cachePromise) return cachePromise;

  cachePromise = (async () => {
    try {
      const [propertiesResult, documentsResult] = await Promise.all([
        backendApi.searchPropertyHubs(''),
        backendApi.getAllDocuments(),
      ]);

      const items: AtMentionItem[] = [];

      if (propertiesResult.success && propertiesResult.data) {
        for (const prop of propertiesResult.data) {
          items.push({
            type: "property",
            id: String(prop.id),
            primaryLabel: (prop as any).custom_name || (prop as any).formatted_address || prop.address || 'Unknown',
            payload: prop,
          });
        }
      }

      if (documentsResult.success && documentsResult.data) {
        for (const doc of documentsResult.data) {
          items.push({
            type: "document",
            id: String(doc.id),
            primaryLabel: doc.original_filename || doc.filename || 'Untitled',
            payload: doc,
          });
        }
      }

      cachedItems = items;
    } catch (error) {
      console.error('Failed to preload @ mention cache:', error);
      cachedItems = [];
    }
  })();

  return cachePromise;
}

export function getFilteredAtMentionItems(query: string): AtMentionItem[] {
  if (!cachedItems) return [];

  const q = query.toLowerCase().trim();
  if (!q) return cachedItems.slice(0, 15);

  const filtered = cachedItems.filter((item) =>
    item.primaryLabel.toLowerCase().includes(q)
  );

  // Sort: documents first, then properties
  filtered.sort((a, b) => {
    if (a.type === "document" && b.type === "property") return -1;
    if (a.type === "property" && b.type === "document") return 1;
    return 0;
  });

  return filtered.slice(0, 15);
}

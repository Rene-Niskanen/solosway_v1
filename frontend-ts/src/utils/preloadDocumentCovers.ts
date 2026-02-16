/**
 * Shared preload for document thumbnails (images, PDFs, DOCX).
 * Populates window.__preloadedDocumentCovers so PropertyDetailsPanel (and others) render instantly.
 * For PDFs, pre-renders first page to a data URL so cards can show <img> without loading iframes.
 * Call on project card hover to warm cache before user clicks.
 */

import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Match RecentDocumentCard thumbnail size for faster render and smaller payload
const TARGET_THUMB_WIDTH = 200;
const PDF_THUMB_JPEG_QUALITY = 0.82;

async function renderPdfBlobToDataUrl(blob: Blob): Promise<string | null> {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = TARGET_THUMB_WIDTH / viewport.width;
    const scaledViewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const renderContext = {
      canvasContext: ctx,
      viewport: scaledViewport,
    };
    // @ts-expect-error - pdfjs-dist types
    await page.render(renderContext).promise;
    return canvas.toDataURL('image/jpeg', PDF_THUMB_JPEG_QUALITY);
  } catch {
    return null;
  }
}

export interface DocForPreload {
  id: string;
  original_filename: string;
  file_type?: string;
  url?: string;
  download_url?: string;
  file_url?: string;
  s3_url?: string;
  s3_path?: string;
}

function getDownloadUrl(doc: DocForPreload, backendUrl: string): string | null {
  if (doc.url || doc.download_url || doc.file_url || doc.s3_url) {
    return doc.url || doc.download_url || doc.file_url || doc.s3_url || null;
  }
  if (doc.s3_path) {
    return `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(doc.s3_path)}`;
  }
  return `${backendUrl}/api/files/download?document_id=${doc.id}`;
}

function classifyDoc(doc: DocForPreload): 'image' | 'pdf' | 'docx' | null {
  const fileType = (doc.file_type || '').toLowerCase();
  const fileName = (doc.original_filename || '').toLowerCase();
  if (fileType.includes('image') || /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName)) return 'image';
  if (fileType.includes('pdf') || fileName.endsWith('.pdf')) return 'pdf';
  if (
    fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    fileType === 'application/msword' ||
    fileType.includes('word') ||
    fileType.includes('document') ||
    fileName.endsWith('.docx') ||
    fileName.endsWith('.doc')
  ) return 'docx';
  return null;
}

/**
 * Preload document covers into the global cache. Optionally call onBatchComplete when a batch finishes (e.g. to trigger re-render).
 */
export function preloadDocumentCovers(
  docs: DocForPreload[],
  onBatchComplete?: () => void
): void {
  if (!docs || docs.length === 0) return;

  if (typeof window === 'undefined') return;
  if (!(window as any).__preloadedDocumentCovers) {
    (window as any).__preloadedDocumentCovers = {};
  }

  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
  const cache = (window as any).__preloadedDocumentCovers as Record<string, { url: string; type?: string; isDocx?: boolean; thumbnailUrl?: string; timestamp: number }>;

  const imageDocs: DocForPreload[] = [];
  const pdfDocs: DocForPreload[] = [];
  const docxDocs: DocForPreload[] = [];

  docs.forEach((doc) => {
    if (cache[doc.id]) return;
    const kind = classifyDoc(doc);
    if (kind === 'image') imageDocs.push(doc);
    else if (kind === 'pdf') pdfDocs.push(doc);
    else if (kind === 'docx') docxDocs.push(doc);
  });

  let hasTriggeredFirst = false;
  const trigger = () => {
    if (onBatchComplete && !hasTriggeredFirst) {
      hasTriggeredFirst = true;
      onBatchComplete();
    }
  };

  const preloadSingle = async (doc: DocForPreload, priority: 'high' | 'auto' = 'auto', triggerRender = false) => {
    if (cache[doc.id]) return;
    try {
      const downloadUrl = getDownloadUrl(doc, backendUrl);
      if (!downloadUrl) return;
      const response = await fetch(downloadUrl, { credentials: 'include', priority } as RequestInit);
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      cache[doc.id] = { url, type: blob.type, timestamp: Date.now() };
      if (triggerRender) trigger();
    } catch {
      // ignore
    }
  };

  const preloadPdfWithThumbnail = async (doc: DocForPreload, priority: 'high' | 'auto' = 'auto', triggerRender = false) => {
    if (cache[doc.id]) return;
    try {
      const downloadUrl = getDownloadUrl(doc, backendUrl);
      if (!downloadUrl) return;
      const response = await fetch(downloadUrl, { credentials: 'include', priority } as RequestInit);
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const thumbnailUrl = await renderPdfBlobToDataUrl(blob);
      cache[doc.id] = { url, type: blob.type, thumbnailUrl: thumbnailUrl ?? undefined, timestamp: Date.now() };
      if (thumbnailUrl && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('documentCoverReady', { detail: { doc_id: doc.id, thumbnailUrl } }));
      }
      if (triggerRender) trigger();
    } catch {
      // ignore
    }
  };

  const preloadDocx = async (doc: DocForPreload) => {
    if (cache[doc.id]) return;
    try {
      const downloadUrl = getDownloadUrl(doc, backendUrl);
      if (!downloadUrl) return;
      const response = await fetch(downloadUrl, { credentials: 'include' });
      if (!response.ok) return;
      const blob = await response.blob();
      const formData = new FormData();
      formData.append('file', blob, doc.original_filename);
      const uploadResponse = await fetch(`${backendUrl}/api/documents/temp-preview`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (uploadResponse.ok) {
        const data = await uploadResponse.json();
        if (data.presigned_url) {
          cache[doc.id] = { url: data.presigned_url, type: 'docx', isDocx: true, timestamp: Date.now() };
          if (onBatchComplete) onBatchComplete();
        }
      }
    } catch {
      // ignore
    }
  };

  const imagePromises = imageDocs.map((doc, i) =>
    preloadSingle(doc, i < 6 ? 'high' : 'auto', i < 3)
  );
  const pdfPromises = pdfDocs.map((doc, i) =>
    preloadPdfWithThumbnail(doc, i < 4 ? 'high' : 'auto', i < 2)
  );
  const docxPromises = docxDocs.map((doc) => preloadDocx(doc));

  Promise.allSettled([...imagePromises, ...pdfPromises, ...docxPromises]).then(() => {
    if (onBatchComplete) onBatchComplete();
  });
}

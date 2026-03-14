"use client";

import * as React from "react";
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { motion } from "framer-motion";

// Configure pdf.js worker - use local bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface DocumentData {
  id: string;
  original_filename: string;
  created_at: string;
  file_type?: string;
  property_id?: string;
  url?: string;
  download_url?: string;
  file_url?: string;
  s3_url?: string;
  s3_path?: string;
  cover_image_url?: string;
  first_page_image_url?: string;
  updated_at?: string;
}

interface RecentDocumentCardProps {
  document: DocumentData;
  onClick?: () => void;
  /** When true, use smaller card size (e.g. projects page files area) */
  compact?: boolean;
  /** When true, hint browser to load this thumbnail with higher priority (first few cards) */
  priority?: boolean;
}

// ==================== UNIFIED THUMBNAIL CACHE ====================
// Stores rendered thumbnails as data URLs - works for BOTH images and PDFs
const thumbnailDataUrlCache = new Map<string, string>();
const renderingInProgress = new Set<string>();

// Concurrency limit: run many thumbnails in parallel so they all load quickly
const MAX_CONCURRENT_THUMBNAILS = 10;
let activeThumbnailRenders = 0;
const thumbnailQueue: Array<() => void> = [];

function runNextThumbnailInQueue() {
  if (activeThumbnailRenders >= MAX_CONCURRENT_THUMBNAILS || thumbnailQueue.length === 0) return;
  activeThumbnailRenders++;
  const next = thumbnailQueue.shift();
  if (next) next();
}

function releaseThumbnailSlot() {
  activeThumbnailRenders = Math.max(0, activeThumbnailRenders - 1);
  runNextThumbnailInQueue();
}

// Get display name from filename
const getDocumentName = (filename: string): string => {
  if (!filename) return 'Document';
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
  return nameWithoutExt.length > 20 ? nameWithoutExt.substring(0, 17) + '...' : nameWithoutExt;
};

const getDocumentExtension = (filename: string): string => {
  if (!filename) return 'FILE';
  const ext = filename.split('.').pop()?.trim();
  return ext ? ext.toUpperCase().slice(0, 6) : 'FILE';
};

// Determine document type for display - PRIORITIZE filename extension over file_type
// (fixes cases like client_email.docx incorrectly labeled as PDF when backend has wrong file_type)
const getDocumentTypeForDisplay = (doc: DocumentData): 'pdf' | 'doc' | 'docx' | 'xls' | 'xlsx' | 'csv' | 'ppt' | 'pptx' | 'image' | 'file' => {
  const filename = doc.original_filename?.toLowerCase() || '';
  const ext = filename.split('.').pop()?.trim() || '';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['doc'].includes(ext)) return 'doc';
  if (['docx'].includes(ext)) return 'docx';
  if (['xls'].includes(ext)) return 'xls';
  if (['xlsx'].includes(ext)) return 'xlsx';
  if (['csv'].includes(ext)) return 'csv';
  if (['ppt'].includes(ext)) return 'ppt';
  if (['pptx'].includes(ext)) return 'pptx';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  const fileType = doc.file_type?.toLowerCase() || '';
  if (fileType.includes('pdf')) return 'pdf';
  if (fileType.includes('word') || fileType.includes('document')) return 'docx';
  if (fileType.includes('sheet') || fileType.includes('excel') || fileType.includes('csv')) return 'xlsx';
  if (fileType.includes('presentation') || fileType.includes('powerpoint')) return 'pptx';
  if (fileType.startsWith('image/')) return 'image';
  return 'file';
};

// Doc type icon component for card label
const DOC_TYPE_ICON_SIZE = 14;
const DocTypeIcon: React.FC<{ doc: DocumentData }> = ({ doc }) => {
  const type = getDocumentTypeForDisplay(doc);
  const style = { width: DOC_TYPE_ICON_SIZE, height: DOC_TYPE_ICON_SIZE, objectFit: 'contain' as const };
  if (type === 'pdf') return <img src="/PDF(1).png" alt="PDF" style={style} />;
  if (type === 'doc' || type === 'docx') return <img src="/word.png" alt="Word" style={style} />;
  if (type === 'xls' || type === 'xlsx' || type === 'csv') return <img src="/excel.png" alt="Excel" style={style} />;
  if (type === 'ppt' || type === 'pptx') return <img src="/powerpoint.png" alt="PowerPoint" style={style} />;
  // Fallback: show extension text for unknown types
  return (
    <span style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.06em', color: '#4B5563' }}>
      {getDocumentExtension(doc.original_filename)}
    </span>
  );
};

// Get download URL for a document
const getDownloadUrl = (doc: DocumentData): string | null => {
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';
  if (doc.url || doc.download_url || doc.file_url || doc.s3_url) {
    return doc.url || doc.download_url || doc.file_url || doc.s3_url || null;
  } else if (doc.s3_path) {
    return `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(doc.s3_path)}`;
  } else if (doc.id) {
    return `${backendUrl}/api/files/download?document_id=${doc.id}`;
  }
  return null;
};

// Check if document is a PDF (for thumbnail rendering)
// Filename extension takes precedence - fixes client_email.docx incorrectly treated as PDF
const isPdfDocument = (doc: DocumentData): boolean => {
  const fileName = doc.original_filename?.toLowerCase() || '';
  const fileType = doc.file_type?.toLowerCase() || '';
  if (fileName.endsWith('.docx') || fileName.endsWith('.doc') || fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv') || fileName.endsWith('.pptx') || fileName.endsWith('.ppt')) {
    return false;
  }
  return fileType.includes('pdf') || fileName.endsWith('.pdf');
};

// Render PDF first page to a data URL using pdf.js
// Smaller target and lower quality for faster render; still looks good at card size
const PDF_THUMB_TARGET_WIDTH = 140;
const PDF_THUMB_JPEG_QUALITY = 0.68;

const renderPdfThumbnail = async (url: string, targetWidth: number = PDF_THUMB_TARGET_WIDTH): Promise<string> => {
  const loadingTask = pdfjsLib.getDocument({
    url,
    withCredentials: true,
  });
  
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  
  const viewport = page.getViewport({ scale: 1 });
  const scale = targetWidth / viewport.width;
  const scaledViewport = page.getViewport({ scale });
  
  const canvas = document.createElement('canvas');
  canvas.width = scaledViewport.width;
  canvas.height = scaledViewport.height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) throw new Error('Canvas context failed');
  
  const renderContext = {
    canvasContext: ctx,
    viewport: scaledViewport,
  };
  // @ts-expect-error - pdfjs-dist types require canvas but it works without
  await page.render(renderContext).promise;
  
  return canvas.toDataURL('image/jpeg', PDF_THUMB_JPEG_QUALITY);
};

// Max dimension for image thumbnails - keeps data URL small and decode fast
const IMAGE_THUMB_MAX_SIZE = 200;

// Render image to a data URL at card size (smaller payload = faster decode/paint)
const renderImageThumbnail = async (url: string): Promise<string> => {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error('Fetch failed');
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const w = bitmap.width;
  const h = bitmap.height;
  const scale = Math.min(IMAGE_THUMB_MAX_SIZE / w, IMAGE_THUMB_MAX_SIZE / h, 1);
  const tw = Math.round(w * scale);
  const th = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  ctx.drawImage(bitmap, 0, 0, tw, th);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  return dataUrl;
};

// Main function to render and cache a thumbnail (works for both PDFs and images)
// Uses a concurrency limit so only MAX_CONCURRENT_THUMBNAILS run at once
const renderAndCacheThumbnail = async (docId: string, url: string, isPdf: boolean): Promise<string> => {
  const cached = thumbnailDataUrlCache.get(docId);
  if (cached) return cached;
  
  if (renderingInProgress.has(docId)) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const result = thumbnailDataUrlCache.get(docId);
        if (result) {
          clearInterval(checkInterval);
          resolve(result);
        }
      }, 80);
    });
  }
  
  return new Promise<string>((resolve, reject) => {
    const run = async (): Promise<string> => {
      renderingInProgress.add(docId);
      try {
        const dataUrl = isPdf
          ? await renderPdfThumbnail(url)
          : await renderImageThumbnail(url);
        thumbnailDataUrlCache.set(docId, dataUrl);
        if (typeof window !== 'undefined') {
          if (!(window as any).__preloadedDocumentCovers) (window as any).__preloadedDocumentCovers = {};
          const c = (window as any).__preloadedDocumentCovers;
          c[docId] = { ...c[docId], thumbnailUrl: dataUrl, timestamp: Date.now() };
        }
        return dataUrl;
      } finally {
        renderingInProgress.delete(docId);
        releaseThumbnailSlot();
      }
    };
    const wrapped = () => {
      run().then(resolve).catch(reject);
    };
    if (activeThumbnailRenders < MAX_CONCURRENT_THUMBNAILS) {
      activeThumbnailRenders++;
      wrapped();
    } else {
      thumbnailQueue.push(wrapped);
    }
  });
};

// Check if thumbnail is cached
const isThumbnailCached = (docId: string): boolean => {
  return thumbnailDataUrlCache.has(docId);
};

// Get cached thumbnail
const getCachedThumbnail = (docId: string): string | null => {
  return thumbnailDataUrlCache.get(docId) || null;
};

/** Max documents to preload upfront; rest load when their card enters viewport */
export const PRELOAD_THUMBNAIL_LIMIT = 8;

/** Cache key used by ProjectsPage – must match so we can warmup from cache at dashboard start */
const PROJECTS_PAGE_CACHE_KEY = 'projectsPage_propertyHubsCache';

/** Clear thumbnail cache (use when fixing stale refs/404s). */
export function clearThumbnailCache(): void {
  thumbnailDataUrlCache.clear();
  renderingInProgress.clear();
}

/** Call as soon as the dashboard mounts (e.g. DashboardLayout) to start loading thumbnails from cache before ProjectsPage renders. */
export const warmupDashboardThumbnailsFromCache = (): void => {
  try {
    const raw = localStorage.getItem(PROJECTS_PAGE_CACHE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as { documents?: DocumentData[]; timestamp?: number };
    const docs = data?.documents;
    if (Array.isArray(docs) && docs.length > 0) {
      preloadDocumentThumbnails(docs, PRELOAD_THUMBNAIL_LIMIT);
    }
  } catch {
    // ignore
  }
};

// Export preload function for parent components (only first N to avoid slow initial load)
// All preloads start immediately so thumbnails fill in as fast as possible
export const preloadDocumentThumbnails = (documents: DocumentData[], limit?: number): void => {
  const cap = limit ?? PRELOAD_THUMBNAIL_LIMIT;
  const toPreload = documents.slice(0, cap);

  toPreload.forEach((doc) => {
    if (isThumbnailCached(doc.id)) return;
    const url = doc.cover_image_url || doc.first_page_image_url || getDownloadUrl(doc);
    if (!url) return;
    const isPdf = isPdfDocument(doc);
    renderAndCacheThumbnail(doc.id, url, isPdf).catch(() => {});
  });
};

// ==================== COMPONENT ====================
const CARD_WIDTH = 180;
const CARD_HEIGHT = 280;
const COMPACT_WIDTH = 134;
const COMPACT_HEIGHT = 196;

export const RecentDocumentCard: React.FC<RecentDocumentCardProps> = React.memo(({ document, onClick, compact = false, priority = false }) => {
  const width = compact ? COMPACT_WIDTH : CARD_WIDTH;
  const height = compact ? COMPACT_HEIGHT : CARD_HEIGHT;
  // Check both caches for instant display (local thumbnailDataUrlCache + shared __preloadedDocumentCovers)
  const localCached = getCachedThumbnail(document.id);
  const sharedCached = typeof window !== 'undefined' ? (window as any).__preloadedDocumentCovers?.[document.id]?.thumbnailUrl : null;
  const cachedThumbnail = localCached || sharedCached || null;
  
  const [thumbnailUrl, setThumbnailUrl] = React.useState<string | null>(cachedThumbnail);
  const [isLoading, setIsLoading] = React.useState(!cachedThumbnail);
  const [hasError, setHasError] = React.useState(false);
  // Lazy load: only fetch thumbnail when card is in (or near) viewport
  const [shouldLoad, setShouldLoad] = React.useState(!!cachedThumbnail);
  const cardContainerRef = React.useRef<HTMLDivElement>(null);
  
  // Drag state for visual feedback
  const [isDragging, setIsDragging] = React.useState(false);

  // Intersection Observer: start loading thumbnail when card is visible
  React.useEffect(() => {
    if (cachedThumbnail || shouldLoad) return;
    const el = cardContainerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setShouldLoad(true);
      },
      { rootMargin: '120px', threshold: 0.01 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cachedThumbnail, shouldLoad]);
  
  // Handle drag start - set drag data and visual state
  const handleDragStart = React.useCallback((e: React.DragEvent) => {
    setIsDragging(true);
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'document',
      documentId: document.id,
      filename: document.original_filename,
    }));
    e.dataTransfer.effectAllowed = 'copy';
  }, [document.id, document.original_filename]);
  
  // Handle drag end - reset visual state
  const handleDragEnd = React.useCallback(() => {
    setIsDragging(false);
  }, []);
  
  // Handle click - only fire if not dragging
  const handleClick = React.useCallback(() => {
    if (!isDragging && onClick) {
      onClick();
    }
  }, [isDragging, onClick]);
  
  // When shared preload finishes (e.g. from util), show thumbnail immediately
  React.useEffect(() => {
    const handler = (e: CustomEvent<{ doc_id: string; thumbnailUrl?: string }>) => {
      if (e.detail?.doc_id === document.id && e.detail?.thumbnailUrl && isLoading) {
        setThumbnailUrl(e.detail.thumbnailUrl);
        setIsLoading(false);
      }
    };
    window.addEventListener('documentCoverReady', handler as EventListener);
    return () => window.removeEventListener('documentCoverReady', handler as EventListener);
  }, [document.id, isLoading]);

  // Render thumbnail when visible and not cached
  React.useEffect(() => {
    if (!shouldLoad || thumbnailUrl || hasError) return;
    
    const url = document.cover_image_url || document.first_page_image_url || getDownloadUrl(document);
    if (!url) {
      setHasError(true);
      setIsLoading(false);
      return;
    }
    
    const isPdf = isPdfDocument(document);
    
    renderAndCacheThumbnail(document.id, url, isPdf)
      .then((dataUrl) => {
        setThumbnailUrl(dataUrl);
        setIsLoading(false);
      })
      .catch(() => {
        setHasError(true);
        setIsLoading(false);
      });
  }, [document.id, document.cover_image_url, document.first_page_image_url, shouldLoad, thumbnailUrl, hasError]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { 
      month: 'numeric', day: 'numeric', year: 'numeric' 
    });
  };

  const documentName = getDocumentName(document.original_filename);
  const shortDate = new Date(document.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const surfaceRadius = compact ? '6px' : '8px';
  const previewRadius = compact ? '4px' : '6px';
  const contentPadding = compact ? '10px' : '12px';

  return (
    <div
      ref={cardContainerRef}
      draggable="true"
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      style={{ width: `${width}px`, paddingTop: compact ? '2px' : '4px' }}
    >
    <div 
      className="group flex flex-col cursor-pointer"
      style={{ 
        width: `${width}px`,
        opacity: isDragging ? 0.5 : 1,
      }}
      onClick={handleClick}
    >
      <motion.div 
        className="relative overflow-hidden"
        style={{ 
          width: `${width}px`,
          height: `${height}px`,
          borderRadius: surfaceRadius,
          border: '1px solid rgba(15, 23, 42, 0.09)',
          background: '#FFFFFF',
          boxShadow: '0 8px 24px -18px rgba(15, 23, 42, 0.2)',
          pointerEvents: 'auto',
          zIndex: 0,
        }}
        whileHover={!isDragging ? { 
          scale: 1.01,
          zIndex: 1,
          y: -1,
          boxShadow: '0 12px 30px -18px rgba(15, 23, 42, 0.24)'
        } : {}}
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      >
        <div className="relative flex h-full flex-col" style={{ padding: contentPadding }}>
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center">
              <DocTypeIcon doc={document} />
            </span>
            <span
              style={{
                color: '#64748B',
                fontSize: compact ? '10px' : '11px',
                fontWeight: 500,
              }}
            >
              {shortDate}
            </span>
          </div>
          <p
            title={document.original_filename}
            style={{
              marginTop: '8px',
              marginBottom: 0,
              color: '#0F172A',
              fontSize: compact ? '11px' : '12px',
              fontWeight: 600,
              lineHeight: 1.4,
              letterSpacing: '-0.01em',
              display: '-webkit-box',
              WebkitLineClamp: compact ? 2 : 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              minHeight: compact ? '31px' : '34px',
            }}
          >
            {documentName}
          </p>
          <div
            className="relative flex-1 overflow-hidden"
            style={{
              marginTop: '-4px',
              borderRadius: previewRadius,
              background: '#F8FAFC',
              border: '1px solid rgba(15, 23, 42, 0.07)',
            }}
          >
            {isLoading ? (
              <div className="absolute inset-0 animate-pulse p-3">
                <div className="h-full rounded-[inherit] bg-white p-3">
                  <div className="mb-3 h-2.5 w-2/3 rounded-full bg-slate-200/90" />
                  <div className="space-y-1.5">
                    <div className="h-1.5 w-full rounded-full bg-slate-200/75" />
                    <div className="h-1.5 w-11/12 rounded-full bg-slate-200/65" />
                    <div className="h-1.5 w-4/5 rounded-full bg-slate-200/55" />
                  </div>
                  <div className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50 px-3 py-4">
                    <div className="h-16 rounded-lg bg-slate-100/90" />
                  </div>
                </div>
              </div>
            ) : thumbnailUrl ? (
              <img 
                src={thumbnailUrl}
                alt={document.original_filename}
                className="h-full w-full object-cover object-top transition-transform duration-300 ease-out group-hover:scale-[1.015]"
                decoding="async"
                loading={priority ? "eager" : "lazy"}
                // @ts-expect-error - use lowercase fetchpriority per React DOM warning; types use fetchPriority
                fetchpriority={priority ? "high" : "auto"}
              />
            ) : (
              <div className="flex h-full flex-col justify-between p-3">
                <div>
                  <h4
                    className="leading-tight"
                    style={{ fontSize: compact ? '11px' : '12px', fontWeight: 600, color: '#0F172A' }}
                  >
                    {documentName}
                  </h4>
                  <p
                    style={{
                      marginTop: '6px',
                      color: '#64748B',
                      fontSize: compact ? '10px' : '11px',
                      lineHeight: 1.45,
                    }}
                  >
                    Preview unavailable. Open to inspect the full file.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <div className="h-1.5 w-full rounded-full bg-slate-200/80" />
                  <div className="h-1.5 w-5/6 rounded-full bg-slate-200/70" />
                  <div className="h-1.5 w-2/3 rounded-full bg-slate-200/60" />
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
      
    </div>
    </div>
  );
});

RecentDocumentCard.displayName = 'RecentDocumentCard';

export default RecentDocumentCard;

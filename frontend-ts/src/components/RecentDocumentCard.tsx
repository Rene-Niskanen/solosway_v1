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
}

// ==================== UNIFIED THUMBNAIL CACHE ====================
// Stores rendered thumbnails as data URLs - works for BOTH images and PDFs
const thumbnailDataUrlCache = new Map<string, string>();
const renderingInProgress = new Set<string>();

// Concurrency limit: max N thumbnail renders at a time so first cards appear quickly
const MAX_CONCURRENT_THUMBNAILS = 3;
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

// Check if document is a PDF
const isPdfDocument = (doc: DocumentData): boolean => {
  const fileName = doc.original_filename?.toLowerCase() || '';
  const fileType = doc.file_type?.toLowerCase() || '';
  return fileType.includes('pdf') || fileName.endsWith('.pdf');
};

// Render PDF first page to a data URL using pdf.js
// Smaller target (200px) and lower JPEG quality for faster render and smaller payload; still sharp at card size
const PDF_THUMB_TARGET_WIDTH = 200;
const PDF_THUMB_JPEG_QUALITY = 0.82;

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

// Render image to a data URL (for caching)
const renderImageThumbnail = async (url: string): Promise<string> => {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error('Fetch failed');
  const blob = await response.blob();
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
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
export const PRELOAD_THUMBNAIL_LIMIT = 6;

// Export preload function for parent components (only first N to avoid slow initial load)
export const preloadDocumentThumbnails = (documents: DocumentData[], limit?: number): void => {
  const cap = limit ?? PRELOAD_THUMBNAIL_LIMIT;
  const toPreload = documents.slice(0, cap);
  
  toPreload.forEach(doc => {
    if (isThumbnailCached(doc.id)) return;
    
    const url = doc.cover_image_url || doc.first_page_image_url || getDownloadUrl(doc);
    if (!url) return;
    
    const isPdf = isPdfDocument(doc);
    renderAndCacheThumbnail(doc.id, url, isPdf).catch(() => {
      // Silently fail - component will show fallback
    });
  });
};

// ==================== COMPONENT ====================
const CARD_WIDTH = 180;
const CARD_HEIGHT = 240;
const COMPACT_WIDTH = 128;
const COMPACT_HEIGHT = 168;

export const RecentDocumentCard: React.FC<RecentDocumentCardProps> = React.memo(({ document, onClick, compact = false }) => {
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

  return (
    <div
      ref={cardContainerRef}
      draggable="true"
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      style={{ width: `${width}px`, paddingTop: compact ? '2px' : '4px' }}
    >
    <div 
      className="flex flex-col cursor-pointer"
      style={{ 
        width: `${width}px`,
        opacity: isDragging ? 0.5 : 1,
      }}
      onClick={handleClick}
    >
      {/* Miniature window preview - single motion container for all effects */}
      <motion.div 
        className="bg-white"
        style={{ 
          width: `${width}px`,
          height: `${height}px`,
          borderRadius: compact ? '4px' : '6px',
          border: '1px solid rgba(0, 0, 0, 0.18)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.1)',
          pointerEvents: 'auto',
          zIndex: 0,
        }}
        whileHover={!isDragging ? { 
          scale: 1.02,
          zIndex: 1,
          boxShadow: '0 12px 24px -8px rgba(0, 0, 0, 0.15), 0 4px 8px -4px rgba(0, 0, 0, 0.1)'
        } : {}}
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      >
        <div className="w-full h-full bg-white flex flex-col" style={{ borderRadius: compact ? '4px' : '6px', overflow: 'hidden' }}>
          {/* Document content area */}
          <div className="flex-1 overflow-hidden relative bg-gray-50">
            {isLoading ? (
              // Loading skeleton
              <div className="absolute inset-0 p-3 flex flex-col">
                <div className="h-2 bg-gray-200 rounded w-3/4 mb-2" />
                <div className="h-1.5 bg-gray-100 rounded w-full mb-1" />
                <div className="h-1.5 bg-gray-100 rounded w-11/12 mb-1" />
                <div className="h-1.5 bg-gray-100 rounded w-full mb-1" />
                <div className="h-1.5 bg-gray-100 rounded w-4/5 mb-1" />
                <div className="h-1.5 bg-gray-100 rounded w-full mb-1" />
                <div className="h-1.5 bg-gray-100 rounded w-9/12 mb-1" />
              </div>
            ) : thumbnailUrl ? (
              // Cached thumbnail - async decode so it doesn't block main thread
              <img 
                src={thumbnailUrl}
                alt={document.original_filename}
                className="w-full h-full object-cover object-top"
                decoding="async"
              />
            ) : (
              // Fallback: Text placeholder
              <div className="p-3 flex flex-col h-full">
                <h4 
                  className="mb-2 leading-tight"
                  style={{ fontSize: '11px', fontWeight: 600, color: '#1F2937' }}
                >
                  {documentName}
                </h4>
                <div className="flex-1 flex flex-col" style={{ gap: '4px' }}>
                  <div className="h-1 bg-gray-100 rounded w-full" />
                  <div className="h-1 bg-gray-100 rounded" style={{ width: '90%' }} />
                  <div className="h-1 bg-gray-100 rounded w-full" />
                  <div className="h-1 bg-gray-100 rounded" style={{ width: '75%' }} />
                  <div className="h-1 bg-gray-100 rounded w-full" />
                  <div className="h-1 bg-gray-100 rounded" style={{ width: '85%' }} />
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
      
      {/* Name and date below card - visible on light (Projects) and dark backgrounds */}
      <p 
        className="truncate"
        style={{
          fontSize: compact ? '12px' : '13px',
          fontWeight: 500,
          color: '#374151',
          marginTop: compact ? '8px' : '10px',
          width: `${width}px`,
        }}
        title={document.original_filename}
      >
        {documentName}
      </p>
      <p 
        style={{
          fontSize: compact ? '11px' : '12px',
          color: '#6B7280',
          marginTop: '2px',
          fontWeight: 400,
          width: `${width}px`,
        }}
      >
        {formatDate(document.created_at)}
      </p>
    </div>
    </div>
  );
});

RecentDocumentCard.displayName = 'RecentDocumentCard';

export default RecentDocumentCard;

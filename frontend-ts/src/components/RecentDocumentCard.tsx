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
}

// ==================== UNIFIED THUMBNAIL CACHE ====================
// Stores rendered thumbnails as data URLs - works for BOTH images and PDFs
const thumbnailDataUrlCache = new Map<string, string>();
const renderingInProgress = new Set<string>();

// Get display name from filename
const getDocumentName = (filename: string): string => {
  if (!filename) return 'Document';
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
  return nameWithoutExt.length > 20 ? nameWithoutExt.substring(0, 17) + '...' : nameWithoutExt;
};

// Get download URL for a document
const getDownloadUrl = (doc: DocumentData): string | null => {
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
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
// Using 2x resolution for retina displays (360px width for 180px display)
const renderPdfThumbnail = async (url: string, targetWidth: number = 360): Promise<string> => {
  const loadingTask = pdfjsLib.getDocument({
    url,
    withCredentials: true,
  });
  
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  
  // Calculate scale to fit target width (2x for high DPI)
  const viewport = page.getViewport({ scale: 1 });
  const scale = targetWidth / viewport.width;
  const scaledViewport = page.getViewport({ scale });
  
  // Create canvas and render at higher resolution
  const canvas = document.createElement('canvas');
  canvas.width = scaledViewport.width;
  canvas.height = scaledViewport.height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) throw new Error('Canvas context failed');
  
  // Render the page
  const renderContext = {
    canvasContext: ctx,
    viewport: scaledViewport,
  };
  // @ts-expect-error - pdfjs-dist types require canvas but it works without
  await page.render(renderContext).promise;
  
  // Convert to high quality JPEG (0.92 quality)
  return canvas.toDataURL('image/jpeg', 0.92);
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
const renderAndCacheThumbnail = async (docId: string, url: string, isPdf: boolean): Promise<string> => {
  // Check cache first
  const cached = thumbnailDataUrlCache.get(docId);
  if (cached) {
    console.log('[ThumbnailCache] HIT:', docId.substring(0, 8));
    return cached;
  }
  
  // Wait if already rendering
  if (renderingInProgress.has(docId)) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const result = thumbnailDataUrlCache.get(docId);
        if (result) {
          clearInterval(checkInterval);
          resolve(result);
        }
      }, 100);
    });
  }
  
  renderingInProgress.add(docId);
  console.log('[ThumbnailCache] Rendering:', docId.substring(0, 8), isPdf ? '(PDF)' : '(Image)');
  
  try {
    const dataUrl = isPdf 
      ? await renderPdfThumbnail(url)
      : await renderImageThumbnail(url);
    
    thumbnailDataUrlCache.set(docId, dataUrl);
    renderingInProgress.delete(docId);
    console.log('[ThumbnailCache] CACHED:', docId.substring(0, 8), '- total:', thumbnailDataUrlCache.size);
    return dataUrl;
  } catch (error) {
    renderingInProgress.delete(docId);
    console.error('[ThumbnailCache] Failed:', docId.substring(0, 8), error);
    throw error;
  }
};

// Check if thumbnail is cached
const isThumbnailCached = (docId: string): boolean => {
  return thumbnailDataUrlCache.has(docId);
};

// Get cached thumbnail
const getCachedThumbnail = (docId: string): string | null => {
  return thumbnailDataUrlCache.get(docId) || null;
};

// Export preload function for parent components
export const preloadDocumentThumbnails = (documents: DocumentData[]): void => {
  console.log('[ThumbnailCache] Preloading', documents.length, 'documents');
  
  documents.forEach(doc => {
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
export const RecentDocumentCard: React.FC<RecentDocumentCardProps> = React.memo(({ document, onClick }) => {
  // Check if already cached (instant display)
  const cachedThumbnail = getCachedThumbnail(document.id);
  
  const [thumbnailUrl, setThumbnailUrl] = React.useState<string | null>(cachedThumbnail);
  const [isLoading, setIsLoading] = React.useState(!cachedThumbnail);
  const [hasError, setHasError] = React.useState(false);
  
  // Drag state for visual feedback
  const [isDragging, setIsDragging] = React.useState(false);
  
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
  
  // Log mount status
  React.useEffect(() => {
    console.log('[RecentDocumentCard] Mount:', document.original_filename.substring(0, 20), {
      cached: !!cachedThumbnail,
      cacheSize: thumbnailDataUrlCache.size
    });
  }, []);

  // Render thumbnail if not cached
  React.useEffect(() => {
    if (thumbnailUrl || hasError) return;
    
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
  }, [document.id, thumbnailUrl, hasError]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { 
      month: 'numeric', day: 'numeric', year: 'numeric' 
    });
  };

  const documentName = getDocumentName(document.original_filename);

  return (
    <div
      draggable="true"
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      style={{ width: '180px', paddingTop: '4px' }}
    >
    <div 
      className="flex flex-col cursor-pointer"
      style={{ 
        width: '180px',
        opacity: isDragging ? 0.5 : 1,
      }}
      onClick={handleClick}
    >
      {/* Miniature window preview - single motion container for all effects */}
      <motion.div 
        className="bg-white"
        style={{ 
          width: '180px',
          height: '240px',
          borderRadius: '6px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.1)',
        }}
        whileHover={!isDragging ? { 
          y: -4,
          boxShadow: '0 12px 24px -8px rgba(0, 0, 0, 0.15), 0 4px 8px -4px rgba(0, 0, 0, 0.1)'
        } : {}}
        whileTap={{ scale: 0.98, y: -2 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      >
        <div className="w-full h-full bg-white flex flex-col" style={{ borderRadius: '6px', overflow: 'hidden' }}>
          {/* Window title bar */}
          <div 
            className="flex items-center gap-1.5 flex-shrink-0"
            style={{
              padding: '6px 8px',
              borderBottom: '1px solid #F3F4F6',
              backgroundColor: '#FAFAFA',
            }}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />
            <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />
            <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />
          </div>
          
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
              // Cached thumbnail - instant display
              <img 
                src={thumbnailUrl}
                alt={document.original_filename}
                className="w-full h-full object-cover object-top"
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
      
      {/* Name and date below card */}
      <p 
        className="truncate"
        style={{
          fontSize: '13px',
          fontWeight: 500,
          color: '#1F2937',
          marginTop: '10px',
          width: '180px',
        }}
        title={document.original_filename}
      >
        {documentName}
      </p>
      <p 
        style={{
          fontSize: '12px',
          color: '#6B7280',
          marginTop: '2px',
          fontWeight: 400,
          width: '180px',
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

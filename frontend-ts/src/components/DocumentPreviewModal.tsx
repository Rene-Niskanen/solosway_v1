"use client";

import * as React from "react";
import { createPortal, flushSync } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Download, RotateCw, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, FileText, Image as ImageIcon, Globe, Plus, RefreshCw, ChevronDown, Loader2 } from "lucide-react";
import { FileAttachmentData } from './FileAttachment';
import { usePreview, CitationHighlight } from '../contexts/PreviewContext';
import { backendApi } from '../services/backendApi';

// PDF.js for canvas-based PDF rendering with precise highlight positioning
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
// Vite handles this import and returns the correct URL for the worker
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set worker source immediately at module load time
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface DocumentPreviewModalProps {
  files: FileAttachmentData[];
  activeTabIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onTabChange: (index: number) => void;
  onTabClose: (index: number) => void;
  onTabReorder?: (newOrder: FileAttachmentData[]) => void;
  onAddAttachment?: () => void;
  isMapVisible?: boolean;
  isSidebarCollapsed?: boolean;
  chatPanelWidth?: number; // Width of the SideChatPanel in pixels
  sidebarWidth?: number; // Width of the sidebar in pixels
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
  files,
  activeTabIndex,
  isOpen,
  onClose,
  onTabChange,
  onTabClose,
  onTabReorder,
  onAddAttachment,
  isMapVisible = false,
  isSidebarCollapsed = false,
  chatPanelWidth = 0,
  sidebarWidth = 56
}) => {
  const file = files[activeTabIndex] || null;
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = React.useState(100);
  const [rotation, setRotation] = React.useState(0);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const prevFileIdRef = React.useRef<string | null>(null); // Track previous file ID for optimization
  
  // Get highlight citation and PDF cache functions from context
  const { 
    highlightCitation, 
    clearHighlightCitation,
    getCachedPdfDocument,
    setCachedPdfDocument,
    getCachedRenderedPage,
    setCachedRenderedPage,
    preloadPdfPage
  } = usePreview();
  
  // Check if current file has a highlight
  const fileHighlight = React.useMemo(() => {
    if (!highlightCitation || !file) return null;
    if (highlightCitation.fileId === file.id) {
      return highlightCitation;
    }
    return null;
  }, [highlightCitation, file]);
  
  // Expand small BBOXes to ensure citations are always visible
  // The stored BBOX may only cover a single block (e.g., 8% x 3% of page)
  // We expand it to a minimum readable size while keeping the center position
  const expandedBbox = React.useMemo(() => {
    if (!fileHighlight?.bbox) return null;
    
    const bbox = fileHighlight.bbox;
    
    // Validate bbox values
    if (
      typeof bbox.left !== 'number' || bbox.left < 0 || bbox.left > 1 ||
      typeof bbox.top !== 'number' || bbox.top < 0 || bbox.top > 1 ||
      typeof bbox.width !== 'number' || bbox.width <= 0 || bbox.width > 1 ||
      typeof bbox.height !== 'number' || bbox.height <= 0 || bbox.height > 1
    ) {
      console.warn('⚠️ [BBOX] Invalid bbox values, skipping highlight:', bbox);
      return null;
    }
    
    // Check if bbox area is suspiciously large
    const area = bbox.width * bbox.height;
    if (area > 0.5) {
      console.warn('⚠️ [BBOX] Bbox area too large, may be incorrect:', { area, bbox });
      // Still render, but log warning
    }
    
    // IMPROVED: Use tighter minimum dimensions for precise highlighting
    // Small BBOXes are often CORRECT (e.g., just "£2,300,000")
    const MIN_WIDTH = 0.12;   // Minimum 12% of page width (enough for a price)
    const MIN_HEIGHT = 0.025; // Minimum 2.5% of page height (one line of text)
    
    // Only add minimal padding for very small bboxes to prevent overlap issues
    const MIN_PADDING_X = 0.005;  // 0.5% horizontal padding (minimal)
    const MIN_PADDING_Y = 0.003;  // 0.3% vertical padding (minimal)
    
    let { left, top, width, height, page } = bbox;
    const original_page = (bbox as any).original_page; // Optional field, may not be in type
    
    // Only expand if the BBOX is tiny (likely a rendering issue, not a precise match)
    const isTooSmall = width < 0.02 || height < 0.005;
    
    if (isTooSmall) {
      console.log('📐 [BBOX] Expanding tiny bbox:', { 
        original: { left, top, width, height },
        reason: 'too small to be visible'
      });
      
      // Expand to minimum visible size
      const centerX = left + width / 2;
      const centerY = top + height / 2;
      
      width = Math.max(width, MIN_WIDTH);
      height = Math.max(height, MIN_HEIGHT);
      
      // Re-center around original position
      left = Math.max(0, centerX - width / 2);
      top = Math.max(0, centerY - height / 2);
      
      // Ensure within bounds
      if (left + width > 1) left = 1 - width;
      if (top + height > 1) top = 1 - height;
      
      console.log('📐 [BBOX] Expanded to:', { left, top, width, height });
    } else {
      // For precise bboxes, only add minimal padding if they're still quite small
      // This prevents overlap issues when multiple citations are close together
      const isSmallButVisible = width < 0.08 || height < 0.02;
      
      if (isSmallButVisible) {
        // Add minimal padding only for small but visible bboxes
        const paddedLeft = Math.max(0, left - MIN_PADDING_X);
        const paddedTop = Math.max(0, top - MIN_PADDING_Y);
        const paddedWidth = Math.min(width + MIN_PADDING_X * 2, 1 - paddedLeft);
        const paddedHeight = Math.min(height + MIN_PADDING_Y * 2, 1 - paddedTop);
        
        left = paddedLeft;
        top = paddedTop;
        width = paddedWidth;
        height = paddedHeight;
        
        console.log('📐 [BBOX] Using small bbox with minimal padding:', { left, top, width, height });
      } else {
        // For larger precise bboxes, use them as-is to prevent overlap
        console.log('📐 [BBOX] Using precise bbox without padding (large enough):', { left, top, width, height });
      }
    }
    
    // Phase 6: Validate bbox coordinates before returning
    const finalBbox = { 
      left: Number(left.toFixed(4)), 
      top: Number(top.toFixed(4)), 
      width: Number(width.toFixed(4)), 
      height: Number(height.toFixed(4)), 
      page, 
      ...(original_page !== undefined && { original_page }) 
    };
    
    // Validate bbox is reasonable
    if (finalBbox.top > 0.9) {
      console.warn('⚠️ [BBOX] Suspicious bbox - likely footer area:', finalBbox);
      console.warn('⚠️ [BBOX] This may indicate incorrect block matching in backend');
    }
    
    if (finalBbox.width * finalBbox.height > 0.5) {
      console.warn('⚠️ [BBOX] Suspicious bbox - very large area (>50% of page):', finalBbox);
    }
    
    // Log the actual block position for debugging
    console.log('📋 [BBOX] Highlighting block at:', {
      page: finalBbox.page,
      position: `${(finalBbox.top * 100).toFixed(1)}% from top`,
      left: `${(finalBbox.left * 100).toFixed(1)}% from left`,
      area: `${(finalBbox.width * finalBbox.height * 100).toFixed(2)}% of page`,
      dimensions: `${(finalBbox.width * 100).toFixed(1)}% × ${(finalBbox.height * 100).toFixed(1)}%`
    });
    
    return finalBbox;
  }, [fileHighlight?.bbox]);
  
  const [imageNaturalHeight, setImageNaturalHeight] = React.useState<number | null>(null);
  const [imageNaturalWidth, setImageNaturalWidth] = React.useState<number | null>(null);
  const [imageRenderedHeight, setImageRenderedHeight] = React.useState<number | null>(null);
  const [imageRenderedWidth, setImageRenderedWidth] = React.useState<number | null>(null);
  const [forceUpdate, setForceUpdate] = React.useState(0);
  const [headerHeight, setHeaderHeight] = React.useState(50);
  
  // PDF.js state for canvas-based rendering with precise highlight positioning
  const [pdfDocument, setPdfDocument] = React.useState<PDFDocumentProxy | null>(null);
  const [pdfPageRendering, setPdfPageRendering] = React.useState(false);
  const [pdfCanvasDimensions, setPdfCanvasDimensions] = React.useState<{ width: number; height: number } | null>(null);
  const [pdfViewportTransform, setPdfViewportTransform] = React.useState<number[] | null>(null);
  const pdfCanvasRef = React.useRef<HTMLCanvasElement>(null);
  
  // Reprocess document state
  const [isReprocessing, setIsReprocessing] = React.useState(false);
  const [reprocessDropdownOpen, setReprocessDropdownOpen] = React.useState(false);
  const [reprocessResult, setReprocessResult] = React.useState<{ success: boolean; message: string } | null>(null);
  const [showAllChunkBboxes, setShowAllChunkBboxes] = React.useState(false);

  React.useEffect(() => {
    if (fileHighlight) {
      console.log('📄 fileHighlight updated', {
        fileId: file?.id,
        page: fileHighlight.bbox.page,
        bbox: fileHighlight.bbox,
        chunkCount: fileHighlight.chunks?.length ?? 0
      });
    }
  }, [fileHighlight, file?.id]);

  React.useEffect(() => {
    if (!expandedBbox) return;
    console.log('🎯 [PreviewHighlight] render state', {
      fileId: file?.id,
      highlightPage: expandedBbox.page,
      visibleOnCurrentPage: expandedBbox.page === currentPage,
      originalBbox: fileHighlight?.bbox,
      expandedBbox,
      currentPage
    });
  }, [expandedBbox, fileHighlight?.bbox, currentPage, file?.id]);
  
  // Set initial dimensions immediately based on file type (no shrinking effect)
  // Calculate dimensions synchronously before state initialization
  const getInitialDimensions = React.useMemo(() => {
    const fileType = file?.type || '';
    const fileName = file?.name || '';
    const isDOCXFile = fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                       fileType === 'application/msword' ||
                       (fileName && (fileName.toLowerCase().endsWith('.docx') || fileName.toLowerCase().endsWith('.doc')));
    const isPDFFile = fileType === 'application/pdf';
    const isImageFile = fileType.startsWith('image/');
    
    console.log('📐 Calculating initial dimensions - isMapVisible:', isMapVisible, 'isPDF:', isPDFFile, 'isDOCX:', isDOCXFile);
    
    // All documents should open at the default map view dimensions (640px × 75vh)
    if (isDOCXFile || isPDFFile) {
      return { height: '75vh', width: '640px' };
    } else if (isImageFile) {
      // For images, use default that will be recalculated, but prevent visible shrinking
      return { height: '85vh', width: '90vw' };
    } else {
      return { height: '75vh', width: '640px' }; // Default to map view dimensions
    }
  }, [file?.type, file?.name, isMapVisible]);
  
  const [calculatedModalHeight, setCalculatedModalHeight] = React.useState<string | number>(getInitialDimensions.height);
  const [calculatedModalWidth, setCalculatedModalWidth] = React.useState<string | number>(getInitialDimensions.width);
  const [isResizing, setIsResizing] = React.useState(false);
  const [resizeDirection, setResizeDirection] = React.useState<string | null>(null);
  const [resizeStartPos, setResizeStartPos] = React.useState<{ x: number; y: number } | null>(null);
  const [resizeStartSize, setResizeStartSize] = React.useState<{ width: number; height: number } | null>(null);
  const [resizeStartPosition, setResizeStartPosition] = React.useState<{ left: number; top: number } | null>(null);
  const [modalPosition, setModalPosition] = React.useState<{ left?: number | string; top?: number | string } | null>(null);
  const [docxPublicUrl, setDocxPublicUrl] = React.useState<string | null>(null);
  const [isUploadingDocx, setIsUploadingDocx] = React.useState(false);
  const [docxIframeSrc, setDocxIframeSrc] = React.useState<string | null>(null);
  const [pdfObjectWidth, setPdfObjectWidth] = React.useState<number | string>('100%');
  const [pdfObjectHeight, setPdfObjectHeight] = React.useState<number | string>('100%');
  const docxCurrentZoomRef = React.useRef<number>(15);
  const headerRef = React.useRef<HTMLDivElement>(null);
  const iframeRef = React.useRef<HTMLObjectElement | HTMLIFrameElement>(null);
  const docxIframeRef = React.useRef<HTMLIFrameElement>(null);
  const imgRef = React.useRef<HTMLImageElement>(null);
  const previewAreaRef = React.useRef<HTMLDivElement>(null);
  const pdfWrapperRef = React.useRef<HTMLDivElement>(null);
  const modalRef = React.useRef<HTMLDivElement>(null);
  const tabsContainerRef = React.useRef<HTMLDivElement>(null);
  const tabRefs = React.useRef<Map<number, HTMLDivElement>>(new Map());
  const currentBlobUrlRef = React.useRef<string | null>(null);
  const [draggedTabIndex, setDraggedTabIndex] = React.useState<number | null>(null);
  const [dragOverTabIndex, setDragOverTabIndex] = React.useState<number | null>(null);

  // Create URL when file changes - use preloaded blob URL if available
  React.useEffect(() => {
    console.log('🔄 File change effect triggered:', {
      hasFile: !!file,
      fileName: file?.name,
      fileType: file?.type,
      isOpen,
      activeTabIndex,
      filesCount: files.length,
      hasBlobUrl: !!blobUrl,
      stackTrace: new Error().stack?.split('\n').slice(0, 8).join('\n')
    });
    if (file && isOpen) {
      const isPDF = file.type === 'application/pdf';
      
      // Revoke old blob URL first (if any)
      const oldUrl = currentBlobUrlRef.current || blobUrl;
      if (oldUrl && oldUrl.startsWith('blob:')) {
        // Only revoke if it's not a preloaded blob (check if it's in our cache)
        const isPreloaded = (window as any).__preloadedAttachmentBlobs && 
                           Object.values((window as any).__preloadedAttachmentBlobs).includes(oldUrl);
        if (!isPreloaded) {
          URL.revokeObjectURL(oldUrl);
        }
        currentBlobUrlRef.current = null;
      }
      
      // First, check for preloaded blob URL (Instagram-style preloading)
      const preloadedBlobUrl = (window as any).__preloadedAttachmentBlobs?.[file.id];
      if (preloadedBlobUrl) {
        console.log('✅ Using preloaded blob URL for file:', file.name);
        currentBlobUrlRef.current = preloadedBlobUrl;
        setBlobUrl(preloadedBlobUrl);
      } else {
        // Create blob URL if not preloaded
        console.log('🖼️ DocumentPreviewModal: Creating blob URL for file:', file.name, file.type);
        try {
          // Check if file.file is valid before creating blob URL
          if (!file.file) {
            console.error('❌ No file object:', file);
            setBlobUrl(null);
            return;
          }
          // Type check: file.file should be a File or Blob
          const fileObj = file.file as File | Blob;
          if (!(fileObj instanceof File) && !(fileObj instanceof Blob)) {
            console.error('❌ Invalid file object type:', file);
            setBlobUrl(null);
            return;
          }
          const url = URL.createObjectURL(file.file);
          currentBlobUrlRef.current = url;
          console.log('✅ Blob URL created:', url.substring(0, 50) + '...');
          setBlobUrl(url);
        } catch (error) {
          console.error('❌ Error creating blob URL:', error);
          setBlobUrl(null);
          // If blob URL creation fails, the file object might be stale
          // This can happen when re-selecting the same document
        }
      }
      
      // Set initial zoom to fit document to container - use page-fit for both views
      // This ensures the document is properly sized relative to the preview container
      // For DOCX files, start at 50% zoom for better width fitting
      const isDOCXFile = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                         file.type === 'application/msword' ||
                         (file.name && (file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.doc')));
      // Don't set zoom for DOCX here - it will be calculated based on container width in the useEffect
      // For DOCX, we'll calculate the zoom in the useEffect, so set a placeholder that won't trigger updates
      if (!isDOCXFile) {
        setZoomLevel(100);
      }
      // For DOCX, don't set zoomLevel here - let the useEffect calculate it
      setRotation(0);
      // OPTIMIZATION: Don't reset page if switching to same document (faster switching)
      // Only reset if it's a different document
      const isDifferentFile = prevFileIdRef.current !== file.id;
      if (isDifferentFile) {
      setCurrentPage(1);
        prevFileIdRef.current = file.id;
      }
      setImageNaturalHeight(null); // Reset image height when file changes
      setImageNaturalWidth(null); // Reset image width when file changes
      setImageRenderedHeight(null); // Reset rendered height when file changes
      setImageRenderedWidth(null); // Reset rendered width when file changes
      setForceUpdate(0); // Reset force update
      setDocxPublicUrl(null); // Reset DOCX public URL
      
      // For PDFs, we'll need to detect total pages from the iframe
      if (isPDF) {
        // PDF pages will be detected by the iframe
        setTotalPages(1); // Will be updated if we can detect it
      }
      
      return () => {
        // Cleanup: revoke blob URL when component unmounts or file changes
        // Only revoke if it's not a preloaded blob (check if it's in our cache)
        const urlToRevoke = currentBlobUrlRef.current;
        if (urlToRevoke && urlToRevoke.startsWith('blob:')) {
          const isPreloaded = (window as any).__preloadedAttachmentBlobs && 
                             Object.values((window as any).__preloadedAttachmentBlobs).includes(urlToRevoke);
          if (!isPreloaded) {
            try {
              URL.revokeObjectURL(urlToRevoke);
            } catch (e) {
              // URL might already be revoked, ignore
            }
          }
          currentBlobUrlRef.current = null;
        }
      };
    } else {
      // When modal closes, reset all state but don't revoke preloaded blob URLs
      setBlobUrl(null);
      setImageNaturalHeight(null);
      setImageNaturalWidth(null);
      setImageRenderedHeight(null);
      setImageRenderedWidth(null);
      setModalPosition(null); // Reset position when modal closes
      setDocxPublicUrl(null); // Reset DOCX public URL
      setZoomLevel(100); // Reset zoom
      setRotation(0); // Reset rotation
      // OPTIMIZATION: Don't reset page if switching to same document (faster switching)
      // Only reset if it's a different document
      if (file) {
        const isDifferentFile = prevFileIdRef.current !== file.id;
        if (isDifferentFile) {
          setCurrentPage(1);
          prevFileIdRef.current = file.id;
        }
      } else {
        prevFileIdRef.current = null;
      }
      currentBlobUrlRef.current = null; // Clear ref but don't revoke preloaded URLs
    }
  }, [file, isOpen, isMapVisible, activeTabIndex]);

  // Determine file types (must be before useEffects that use them)
  const isPDF = file?.type === 'application/pdf';
  const isImage = file?.type.startsWith('image/');
  const isDOCX = file?.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                 file?.type === 'application/msword' ||
                 (file?.name && (file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.doc')));

  // Reset debug overlays when document or modal state changes
  React.useEffect(() => {
    if (!isOpen) {
      setShowAllChunkBboxes(false);
    }
  }, [isOpen, file?.id]);

  // Keyboard shortcut: Shift + D toggles debug chunk overlays
  React.useEffect(() => {
    if (!isOpen) return;
    
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'd' && event.shiftKey) {
        event.preventDefault();
        setShowAllChunkBboxes(prev => !prev);
        console.log(`[📄 Preview Debug] Chunk overlay ${!showAllChunkBboxes ? 'enabled' : 'disabled'} (Shift + D)`);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showAllChunkBboxes]);

  const chunkOverlaysForPage = React.useMemo(() => {
    if (!showAllChunkBboxes || !fileHighlight?.chunks) return [];
    return fileHighlight.chunks.filter(chunk => {
      const bboxPage = chunk?.bbox?.page ?? chunk?.page_number ?? fileHighlight?.bbox?.page;
      return bboxPage === currentPage && chunk?.bbox;
    });
  }, [showAllChunkBboxes, fileHighlight, currentPage]);

  // Navigate to correct page when highlight is set (for PDFs)
  // OPTIMIZATION: Navigate immediately and pre-render page if not cached
  React.useEffect(() => {
    if (fileHighlight && isPDF && fileHighlight.bbox.page && file && pdfDocument) {
      const targetPage = fileHighlight.bbox.page;
      if (targetPage !== currentPage) {
        console.log('📄 Navigating to page', targetPage, 'for highlight');
        
        // Pre-render target page if not cached (for instant switching)
        const cached = getCachedRenderedPage?.(file.id, targetPage);
        if (!cached && preloadPdfPage) {
          preloadPdfPage(file.id, targetPage, pdfDocument, zoomLevel / 100).catch(err => {
            console.warn('⚠️ Failed to pre-render page:', err);
          });
        }
        
        // Set page immediately - if cached, rendering will be instant
        setCurrentPage(targetPage);
      }
    }
  }, [fileHighlight, isPDF, currentPage, file?.id, pdfDocument, getCachedRenderedPage, preloadPdfPage, zoomLevel]);

  // Load PDF with PDF.js for canvas-based rendering (enables precise highlight positioning)
  // OPTIMIZATION: Use cached PDF document if available to avoid reloading when switching
  React.useEffect(() => {
    if (!isPDF || !file?.file || !isOpen) {
      setPdfDocument(null);
      return;
    }

    let cancelled = false;
    
    const loadPdf = async () => {
      try {
        // OPTIMIZATION: Check cache first - avoid reloading if already cached
        const cachedPdf = getCachedPdfDocument?.(file.id);
        if (cachedPdf) {
          console.log('⚡ [PDF_CACHE] Using cached PDF document:', file.id);
          if (!cancelled) {
            setPdfDocument(cachedPdf);
            setTotalPages(cachedPdf.numPages);
          }
          return;
        }
        
        console.log('📄 Loading PDF with PDF.js for canvas rendering...');
        const arrayBuffer = await file.file.arrayBuffer();
        const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        
        if (cancelled) {
          pdf.destroy();
          return;
        }
        
        console.log('📄 PDF loaded successfully, pages:', pdf.numPages);
        
        // OPTIMIZATION: Cache the PDF document for fast switching
        setCachedPdfDocument?.(file.id, pdf);
        
        if (!cancelled) {
        setPdfDocument(pdf);
        setTotalPages(pdf.numPages);
          
          // OPTIMIZATION: If there's a highlight citation for this document, pre-render that page immediately
          // This ensures the page is ready when user sees the preview
          if (fileHighlight && fileHighlight.bbox?.page && preloadPdfPage) {
            const targetPage = fileHighlight.bbox.page;
            preloadPdfPage(file.id, targetPage, pdf, 1.0).catch(err => {
              console.warn('⚠️ Failed to pre-render highlight page:', err);
            });
          }
        }
      } catch (error) {
        console.error('❌ Failed to load PDF with PDF.js:', error);
      }
    };
    
    loadPdf();
    
    return () => {
      cancelled = true;
      // OPTIMIZATION: Don't destroy PDF document - keep it in cache for fast switching
      // Only destroy if file is being removed from previewFiles (handled in PreviewContext)
    };
  }, [isPDF, file?.file, file?.id, isOpen, getCachedPdfDocument, setCachedPdfDocument]);

  // Render current PDF page to canvas with zoom level
  // OPTIMIZATION: Use cached rendered page if available for instant switching
  React.useEffect(() => {
    if (!pdfDocument || !pdfCanvasRef.current || !isOpen || !file) return;
    
    let cancelled = false;
    let animationFrameId: number | null = null;
    let renderTask: any = null; // Track PDF.js render task to cancel if needed
    
    const renderPage = async () => {
      try {
        const scale = zoomLevel / 100;
        
        // OPTIMIZATION: Check cache first - use cached rendered page if available
        const cachedImageData = getCachedRenderedPage?.(file.id, currentPage);
        if (cachedImageData && pdfCanvasRef.current) {
          const canvas = pdfCanvasRef.current;
          const context = canvas.getContext('2d');
          
          if (context && !cancelled) {
            // Restore cached page instantly
            // CRITICAL: Clear canvas before restoring cached image to prevent overlap
            canvas.width = cachedImageData.width;
            canvas.height = cachedImageData.height;
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.putImageData(cachedImageData, 0, 0);
            
            // Store dimensions for highlight positioning
            setPdfCanvasDimensions({ width: canvas.width, height: canvas.height });
            
            // Calculate viewport transform (approximate, since we cached at scale 1.0)
            // For exact positioning, we still need to get the page viewport
            const page = await pdfDocument.getPage(currentPage);
            const viewport = page.getViewport({ scale, rotation });
            const transform = viewport.transform;
            setPdfViewportTransform([transform[0], transform[1], transform[2], transform[3], transform[4], transform[5]]);
            
            console.log('⚡ [PAGE_CACHE] Restored cached page instantly:', file.id, 'page', currentPage);
            setPdfPageRendering(false);
            return;
          }
        }
        
        // If not cached, render normally
        setPdfPageRendering(true);
        console.log('📄 Rendering PDF page', currentPage, 'at zoom', zoomLevel, '%');
        
        // CRITICAL: Clear canvas immediately when starting new render to prevent overlap
        const canvas = pdfCanvasRef.current;
        if (canvas) {
          const context = canvas.getContext('2d');
          if (context) {
            // Clear canvas immediately to prevent showing previous page content
            context.clearRect(0, 0, canvas.width, canvas.height);
          }
        }
        
        const page = await pdfDocument.getPage(currentPage);
        
        if (cancelled) return;
        
        const viewport = page.getViewport({ scale, rotation });
        
        if (!canvas) return;
        
        const context = canvas.getContext('2d');
        if (!context) return;
        
        // OPTIMIZATION: Use requestAnimationFrame for smoother rendering
        animationFrameId = requestAnimationFrame(() => {
          if (cancelled) return;
        
        // Set canvas dimensions to match the viewport
        // CRITICAL: Setting width/height automatically clears canvas, but we also explicitly clear
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        // Store dimensions for highlight positioning
        setPdfCanvasDimensions({ width: viewport.width, height: viewport.height });
        
        // Store viewport transform for highlight positioning (PDF.js transform matrix)
        const transform = viewport.transform;
        setPdfViewportTransform([transform[0], transform[1], transform[2], transform[3], transform[4], transform[5]]);
        
        // Render the page
        // CRITICAL: Store render task so we can cancel it if page changes
        renderTask = page.render({
          canvasContext: context,
          viewport,
          canvas
        } as any);
        
        renderTask.promise.then(() => {
        if (!cancelled) {
          console.log('📄 PDF page rendered successfully:', viewport.width, 'x', viewport.height);
              
              // OPTIMIZATION: Cache the rendered page for instant future access
              if (file && scale === 1.0 && rotation === 0) {
                // Only cache at default scale/rotation to save memory
                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                setCachedRenderedPage?.(file.id, currentPage, imageData);
              }
              
          setPdfPageRendering(false);
        }
          }).catch((error) => {
            console.error('❌ Failed to render PDF page:', error);
            setPdfPageRendering(false);
          });
        });
      } catch (error) {
        console.error('❌ Failed to render PDF page:', error);
        setPdfPageRendering(false);
      }
    };
    
    renderPage();
    
    return () => {
      cancelled = true;
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      // CRITICAL: Cancel any in-progress PDF.js render task to prevent overlapping pages
      if (renderTask && renderTask.cancel) {
        try {
          renderTask.cancel();
          console.log('🛑 [PDF_RENDER] Cancelled in-progress render task');
        } catch (e) {
          // Ignore errors from cancellation
        }
      }
    };
  }, [pdfDocument, currentPage, zoomLevel, rotation, isOpen, file?.id, getCachedRenderedPage, setCachedRenderedPage]);

  // Upload DOCX for Office Online Viewer
  React.useEffect(() => {
    if (isDOCX && file && isOpen && !docxPublicUrl && !isUploadingDocx) {
      setIsUploadingDocx(true);
      const formData = new FormData();
      formData.append('file', file.file);
      fetch(`${import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000'}/api/documents/temp-preview`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      })
      .then(r => r.json())
      .then(data => data.presigned_url && setDocxPublicUrl(data.presigned_url))
      .catch(e => console.error('Preview error:', e))
      .finally(() => setIsUploadingDocx(false));
    }
  }, [isDOCX, file, isOpen, docxPublicUrl, isUploadingDocx]);

  // Update DOCX iframe src when docxPublicUrl is first set
  React.useEffect(() => {
    if (isDOCX && docxPublicUrl && !docxIframeSrc) {
      // Use embed.aspx with ui=2 for better width fitting
      // Calculate zoom based on container width - typical Word doc is ~8.5" wide (816px at 96dpi)
      // For a 800px container, we want ~50% zoom to fit width
      // For a 1000px container, we want ~60% zoom
      // Use wider container for DOCX files for better document rendering
      const containerWidth = isMapVisible ? 900 : 1100;
      const docWidth = 816; // Standard Word document width in pixels
      const calculatedZoom = Math.round((containerWidth / docWidth) * 100);
      const finalZoom = Math.max(30, Math.min(100, calculatedZoom)); // Clamp between 30% and 100%
      
      const baseUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(docxPublicUrl)}&action=embedview&wdEmbedCode=0&ui=2`;
      const newSrc = `${baseUrl}&wdZoom=${finalZoom}`;
      console.log('📄 Initial DOCX iframe src with calculated zoom:', finalZoom, '% (container width:', containerWidth, 'px)');
      
      // Set iframe src directly with calculated zoom - update zoomLevel immediately but second useEffect will skip
      // Use setTimeout to avoid flushSync warning during render
      setTimeout(() => {
        // Update ref FIRST to match calculated zoom - this ensures second useEffect skips
        docxCurrentZoomRef.current = finalZoom;
        // Set iframe src with calculated zoom - this is the ONLY place we set it initially
        setDocxIframeSrc(newSrc);
        // Update zoomLevel to show correct percentage in UI
        // Second useEffect will skip because ref already matches
        setZoomLevel(finalZoom);
      }, 0);
    } else if (!isDOCX || !docxPublicUrl) {
      setDocxIframeSrc(null);
      docxCurrentZoomRef.current = 50;
    }
  }, [isDOCX, docxPublicUrl, isMapVisible]);

  // Update DOCX iframe src when zoom level changes (only for user-initiated changes)
  React.useEffect(() => {
    // Only proceed if iframe src is already set (initial load is complete)
    if (!docxIframeSrc) {
      return;
    }
    
    if (isDOCX && docxIframeRef.current && docxPublicUrl) {
      // Check if the iframe src already has this zoom level FIRST - this prevents running on initial load
      const currentSrc = docxIframeRef.current.src;
      const expectedZoom = `wdZoom=${zoomLevel}`;
      if (currentSrc.includes(expectedZoom)) {
        // Iframe already has this zoom - sync ref and skip update
        docxCurrentZoomRef.current = zoomLevel;
        return;
      }
      
      // Skip if ref and state already match (no actual change)
      if (docxCurrentZoomRef.current === zoomLevel) {
        return;
      }
      
      // This is a user-initiated zoom change - update the iframe
      const baseUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(docxPublicUrl)}&action=embedview&wdEmbedCode=0&ui=2`;
      const newSrc = `${baseUrl}&wdZoom=${zoomLevel}`;
      console.log('🔍 User zoom change from', docxCurrentZoomRef.current, 'to', zoomLevel, '- updating iframe');
      docxCurrentZoomRef.current = zoomLevel;
      // Use setTimeout to ensure state updates are complete
      setTimeout(() => {
        if (docxIframeRef.current) {
          docxIframeRef.current.src = newSrc;
          console.log('✅ DOCX iframe src updated to zoom:', zoomLevel);
        }
      }, 0);
    }
  }, [zoomLevel, isDOCX, docxPublicUrl, docxIframeSrc]);

  // Helper function to validate scroll position and container dimensions
  const validateScrollBounds = (wrapper: HTMLDivElement, newScrollLeft: number, newScrollTop: number) => {
    const maxScrollLeft = Math.max(0, wrapper.scrollWidth - wrapper.clientWidth);
    const maxScrollTop = Math.max(0, wrapper.scrollHeight - wrapper.clientHeight);
    
    // Debug logging to identify scroll issues
    if (zoomLevel > 100) {
      console.log('📊 Scroll Debug:', {
        scrollWidth: wrapper.scrollWidth,
        clientWidth: wrapper.clientWidth,
        scrollHeight: wrapper.scrollHeight,
        clientHeight: wrapper.clientHeight,
        maxScrollLeft,
        maxScrollTop,
        currentScrollLeft: wrapper.scrollLeft,
        currentScrollTop: wrapper.scrollTop,
        newScrollLeft,
        newScrollTop,
        zoomLevel
      });
    }
    
    return {
      scrollLeft: Math.max(0, Math.min(newScrollLeft, maxScrollLeft)),
      scrollTop: Math.max(0, Math.min(newScrollTop, maxScrollTop))
    };
  };

  // Calculate PDF object dimensions in pixels based on container size and zoom level
  React.useEffect(() => {
    if (isPDF && isOpen && pdfWrapperRef.current) {
      const wrapper = pdfWrapperRef.current;
      const containerWidth = wrapper.clientWidth;
      const containerHeight = wrapper.clientHeight;
      
      if (containerWidth > 0 && containerHeight > 0) {
        if (zoomLevel > 100) {
          // Calculate pixel dimensions when zoomed - ensure object is SIGNIFICANTLY larger than container
          // This ensures there's always scrollable content
          const zoomMultiplier = zoomLevel / 100;
          const objectWidth = Math.ceil(containerWidth * zoomMultiplier);
          const objectHeight = Math.ceil(containerHeight * zoomMultiplier);
          
          // Force minimum size to be at least 10% larger than container to ensure scrolling works
          const minWidth = Math.ceil(containerWidth * 1.1);
          const minHeight = Math.ceil(containerHeight * 1.1);
          
          const finalWidth = Math.max(objectWidth, minWidth);
          const finalHeight = Math.max(objectHeight, minHeight);
          
          setPdfObjectWidth(finalWidth);
          setPdfObjectHeight(finalHeight);
          
          // Force a reflow to ensure scrollWidth/scrollHeight update
          requestAnimationFrame(() => {
            if (pdfWrapperRef.current) {
              console.log('📐 PDF Scroll Dimensions:', {
                containerWidth: pdfWrapperRef.current.clientWidth,
                containerHeight: pdfWrapperRef.current.clientHeight,
                scrollWidth: pdfWrapperRef.current.scrollWidth,
                scrollHeight: pdfWrapperRef.current.scrollHeight,
                canScrollX: pdfWrapperRef.current.scrollWidth > pdfWrapperRef.current.clientWidth,
                canScrollY: pdfWrapperRef.current.scrollHeight > pdfWrapperRef.current.clientHeight,
                zoomLevel,
                objectWidth: finalWidth,
                objectHeight: finalHeight
              });
            }
          });
        } else {
          // At 100% or less, use 100% to fit container
          setPdfObjectWidth('100%');
          setPdfObjectHeight('100%');
        }
      }
    }
  }, [isPDF, isOpen, zoomLevel, file?.id]);

  // Reset scroll position for PDFs when file or page changes
  React.useEffect(() => {
    if (isPDF && isOpen && pdfWrapperRef.current) {
      // Reset scroll to top-left when PDF file or page changes - use pdfWrapperRef, not previewAreaRef
      pdfWrapperRef.current.scrollLeft = 0;
      pdfWrapperRef.current.scrollTop = 0;
    }
  }, [isPDF, isOpen, file?.id, currentPage]);

  // Handle mouse wheel / touchpad zoom for all document types
  React.useEffect(() => {
    if (!isOpen || !modalRef.current) return;
    
    // Attach to the entire modal to prevent browser navigation within the modal
    const modalElement = modalRef.current;

    const handleWheel = (e: WheelEvent) => {
      // Check if event is within the modal - if not, don't interfere
      const target = e.target as Node;
      if (!modalElement.contains(target)) {
        return; // Event is outside modal, let browser handle it
      }
      
      // Only handle zoom when Ctrl/Cmd is pressed
      const isZoomGesture = e.ctrlKey || e.metaKey;
      
      if (isZoomGesture) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        // Determine zoom direction based on wheel delta
        const zoomDelta = e.deltaY > 0 ? -5 : 5;
        const newZoom = Math.max(10, Math.min(200, zoomLevel + zoomDelta));
        
        setZoomLevel(newZoom);
        
        // Apply zoom immediately for PDFs
        if (isPDF && iframeRef.current && blobUrl) {
          const pdfUrl = newZoom > 100 
            ? `${blobUrl}#page=${currentPage}&zoom=${newZoom}`
            : `${blobUrl}#page=${currentPage}&zoom=${newZoom}&view=Fit`;
          if (iframeRef.current instanceof HTMLObjectElement) {
            iframeRef.current.data = pdfUrl;
          } else if (iframeRef.current instanceof HTMLIFrameElement) {
            iframeRef.current.src = pdfUrl;
          }
        }
      } else if (isPDF && pdfWrapperRef.current) {
        // For PDFs: ALWAYS prevent default to stop browser navigation and handle ALL scrolling manually
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        const wrapper = pdfWrapperRef.current;
        const deltaX = e.deltaX || 0;
        const deltaY = e.deltaY || 0;
        
        // Handle both horizontal and vertical scrolling manually
        if (deltaX !== 0 || deltaY !== 0) {
          const scrollMultiplier = 2.0;
          
          // Scroll horizontally - always handle this to prevent browser navigation
          if (deltaX !== 0) {
            wrapper.scrollLeft += deltaX * scrollMultiplier;
          }
          
          // Scroll vertically when content is taller than container (regardless of zoom level)
          if (deltaY !== 0 && wrapper.scrollHeight > wrapper.clientHeight) {
            wrapper.scrollTop += deltaY * scrollMultiplier;
          }
          
          // Debug log to see if scrolling is actually happening
          console.log('🖐️ Two-finger pan:', {
            deltaX,
            deltaY,
            scrollLeft: wrapper.scrollLeft,
            scrollTop: wrapper.scrollTop,
            scrollWidth: wrapper.scrollWidth,
            clientWidth: wrapper.clientWidth,
            scrollHeight: wrapper.scrollHeight,
            clientHeight: wrapper.clientHeight,
            canScroll: wrapper.scrollWidth > wrapper.clientWidth || wrapper.scrollHeight > wrapper.clientHeight
          });
        }
      }
    };

    // Also prevent browser navigation gestures at document level when modal is open
    const preventBrowserNavigation = (e: WheelEvent) => {
      // Only prevent if event is within modal
      if (modalElement.contains(e.target as Node)) {
        // If it's a horizontal scroll (two-finger pan), prevent browser navigation
        if (e.deltaX !== 0 && isPDF) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      }
    };

    // Use capture phase with highest priority to catch events before browser handles them
    // Attach to both modal and document to catch all events
    modalElement.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    document.addEventListener('wheel', preventBrowserNavigation, { passive: false, capture: true });

    return () => {
      modalElement.removeEventListener('wheel', handleWheel, { capture: true });
      document.removeEventListener('wheel', preventBrowserNavigation, { capture: true });
    };
  }, [isOpen, zoomLevel, isPDF, blobUrl, currentPage]);

  // Handle keyboard shortcuts
  React.useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && file?.type === 'application/pdf') {
        setCurrentPage(prev => Math.max(1, prev - 1));
      } else if (e.key === 'ArrowRight' && file?.type === 'application/pdf') {
        setCurrentPage(prev => Math.min(totalPages, prev + 1));
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoomLevel(prev => Math.min(200, prev + 10));
      } else if (e.key === '-') {
        e.preventDefault();
        setZoomLevel(prev => Math.max(25, prev - 10));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, file, totalPages]);

  const handleDownload = () => {
    console.log('📥 handleDownload called:', {
      hasBlobUrl: !!blobUrl,
      fileName: file?.name,
      stackTrace: new Error().stack
    });
    if (!file) {
      console.log('❌ Download cancelled - missing file');
      return;
    }
    
    // For data URLs (PDFs), we need to create a blob URL for download
    // For blob URLs, use them directly
    let downloadUrl = blobUrl;
    if (blobUrl && blobUrl.startsWith('data:')) {
      // Convert data URL to blob URL for download
      const response = fetch(blobUrl);
      response.then(res => res.blob()).then(blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      });
      return;
    }
    
    if (!downloadUrl) {
      console.log('❌ Download cancelled - missing URL');
      return;
    }
    
    console.log('✅ Creating download link for:', file.name);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = file.name;
    document.body.appendChild(link);
    console.log('✅ Triggering download click');
    link.click();
    document.body.removeChild(link);
    console.log('✅ Download link removed');
  };

  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  // Handle document reprocessing for BBOX extraction
  const handleReprocess = async (mode: 'full' | 'bbox_only') => {
    if (!file?.id) {
      console.error('❌ No document ID available for reprocessing');
      return;
    }
    
    setIsReprocessing(true);
    setReprocessDropdownOpen(false);
    setReprocessResult(null);
    
    try {
      console.log(`🔄 Reprocessing document ${file.id} in ${mode} mode...`);
      const result = await backendApi.reprocessDocument(file.id, mode);
      
      if (result.success && result.data) {
        setReprocessResult({
          success: true,
          message: result.data.message || `Successfully reprocessed with ${result.data.chunks_with_bbox || result.data.chunks_updated || 0} chunks containing BBOX`
        });
        console.log('✅ Reprocess complete:', result.data);
      } else {
        setReprocessResult({
          success: false,
          message: result.error || 'Failed to reprocess document'
        });
        console.error('❌ Reprocess failed:', result.error);
      }
    } catch (error) {
      setReprocessResult({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      console.error('❌ Reprocess error:', error);
    } finally {
      setIsReprocessing(false);
      // Clear result message after 5 seconds
      setTimeout(() => setReprocessResult(null), 5000);
    }
  };

  const handleZoomIn = () => {
    setZoomLevel(prev => {
      const newZoom = Math.min(200, prev + 10);
      console.log('🔍 Zoom In:', {
        prev,
        newZoom,
        fileType: file?.type,
        fileName: file?.name,
        isPDF,
        isImage,
        isDOCX
      });
      
      // For PDFs, update object data with new zoom
      // Remove view parameter when zoomed to allow free panning in all directions
      if (isPDF && iframeRef.current && blobUrl) {
        const pdfUrl = newZoom > 100 
          ? `${blobUrl}#page=${currentPage}&zoom=${newZoom}` // No view constraint when zoomed - allows free panning
          : `${blobUrl}#page=${currentPage}&zoom=${newZoom}&view=Fit`; // Use Fit when at 100% or less
        if (iframeRef.current instanceof HTMLObjectElement) {
          iframeRef.current.data = pdfUrl;
        } else if (iframeRef.current instanceof HTMLIFrameElement) {
          iframeRef.current.src = pdfUrl;
        }
        console.log('✅ PDF zoom updated to:', newZoom + '%');
      }
      
      // For images, the zoom is applied via CSS transform (scale) - no action needed here
      // The zoomLevel state change will trigger a re-render with the new transform
      if (isImage) {
        console.log('✅ Image zoom updated to:', newZoom + '% (applied via CSS transform)');
      }
      
      // For DOCX files, the useEffect will handle iframe src updates
      if (isDOCX) {
        console.log('✅ DOCX zoom updated to:', newZoom + '% (useEffect will handle iframe update)');
      }
      
      return newZoom;
    });
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => {
      const newZoom = Math.max(10, prev - 10);
      console.log('🔍 Zoom Out:', {
        prev,
        newZoom,
        fileType: file?.type,
        fileName: file?.name,
        isPDF,
        isImage,
        isDOCX
      });
      
      // For PDFs, update object data with new zoom
      // Remove view parameter when zoomed to allow free panning in all directions
      if (isPDF && iframeRef.current && blobUrl) {
        const pdfUrl = newZoom > 100 
          ? `${blobUrl}#page=${currentPage}&zoom=${newZoom}` // No view constraint when zoomed - allows free panning
          : `${blobUrl}#page=${currentPage}&zoom=${newZoom}&view=Fit`; // Use Fit when at 100% or less
        if (iframeRef.current instanceof HTMLObjectElement) {
          iframeRef.current.data = pdfUrl;
        } else if (iframeRef.current instanceof HTMLIFrameElement) {
          iframeRef.current.src = pdfUrl;
        }
        console.log('✅ PDF zoom updated to:', newZoom + '%');
      }
      
      // For images, the zoom is applied via CSS transform (scale) - no action needed here
      // The zoomLevel state change will trigger a re-render with the new transform
      if (isImage) {
        console.log('✅ Image zoom updated to:', newZoom + '% (applied via CSS transform)');
      }
      
      // For DOCX files, the useEffect will handle iframe src updates
      if (isDOCX) {
        console.log('✅ DOCX zoom updated to:', newZoom + '% (useEffect will handle iframe update)');
      }
      
      return newZoom;
    });
  };

  const handlePreviousPage = () => {
    setCurrentPage(prev => {
      const newPage = Math.max(1, prev - 1);
      // Update object data when page changes - always use Fit view for proper sizing
      if (isPDF && iframeRef.current && blobUrl) {
        if (iframeRef.current instanceof HTMLObjectElement) {
          iframeRef.current.data = `${blobUrl}#page=${newPage}&zoom=page-fit&view=Fit`;
        } else if (iframeRef.current instanceof HTMLIFrameElement) {
          iframeRef.current.src = `${blobUrl}#page=${newPage}&zoom=page-fit&view=Fit`;
        }
      }
      return newPage;
    });
  };

  const handleNextPage = () => {
    setCurrentPage(prev => {
      const newPage = Math.min(totalPages, prev + 1);
      // Update object data when page changes - always use Fit view for proper sizing
      if (isPDF && iframeRef.current && blobUrl) {
        if (iframeRef.current instanceof HTMLObjectElement) {
          iframeRef.current.data = `${blobUrl}#page=${newPage}&zoom=page-fit&view=Fit`;
        } else if (iframeRef.current instanceof HTMLIFrameElement) {
          iframeRef.current.src = `${blobUrl}#page=${newPage}&zoom=page-fit&view=Fit`;
        }
      }
      return newPage;
    });
  };

  // Measure actual header height when modal opens
  React.useEffect(() => {
    if (isOpen && headerRef.current) {
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        if (headerRef.current) {
          const height = headerRef.current.offsetHeight;
          setHeaderHeight(height);
        }
      });
    }
  }, [isOpen]);

  // Use ResizeObserver to track actual rendered image size
  React.useEffect(() => {
    if (!isImage || !imgRef.current || isMapVisible) return;

    const img = imgRef.current;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { height, width } = entry.contentRect;
        if (height > 0) {
          setImageRenderedHeight(height);
        }
        if (width > 0) {
          setImageRenderedWidth(width);
        }
      }
    });

    resizeObserver.observe(img);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isImage, isMapVisible, blobUrl]);

  // Track if we've already calculated dimensions to prevent infinite loops
  const dimensionsCalculatedRef = React.useRef(false);
  const lastNaturalDimsRef = React.useRef<{ width: number | null; height: number | null }>({ width: null, height: null });
  
  // Calculate modal dimensions based on content type
  // For images: fit tightly to image dimensions (with minimal padding and header)
  // For PDFs: use standard dimensions
  // Only recalculate if dimensions haven't been set yet or for images (which need image dimensions)
  React.useEffect(() => {
    // For PDFs and DOCX, dimensions are already set correctly in initial state - skip recalculation
    if (!isImage && (isPDF || isDOCX)) {
      return; // Dimensions already correct, no need to recalculate
    }
    
    if (isImage) {
      // Only calculate once when we first get natural dimensions, or if natural dimensions changed
      const naturalDimsChanged = 
        lastNaturalDimsRef.current.width !== imageNaturalWidth ||
        lastNaturalDimsRef.current.height !== imageNaturalHeight;
      
      // If we've already calculated and natural dims haven't changed, skip
      if (dimensionsCalculatedRef.current && !naturalDimsChanged) {
        return;
      }
      
      // If we don't have natural dimensions yet, wait
      if (!imageNaturalHeight || !imageNaturalWidth) {
        return;
      }
      
      // Update ref to track we're calculating
      dimensionsCalculatedRef.current = true;
      lastNaturalDimsRef.current = { width: imageNaturalWidth, height: imageNaturalHeight };
      
      // Calculate width first based on viewport constraints
      // For map view, use smaller max width (accounting for sidebar)
      // For dashboard view, use larger max width
      const maxWidth = isMapVisible 
        ? Math.min(window.innerWidth * 0.4, 600) // Max 40% viewport or 600px for map view
        : Math.min(window.innerWidth * 0.9, 1400); // Max 90% viewport or 1400px for dashboard
      // Allow smaller minimum width - tabs will scroll if needed
      const minWidth = isMapVisible ? 250 : 300; // Minimum width for usability
      
      // Start with natural width, but constrain it
      let calculatedWidth = imageNaturalWidth;
      
      // If image is wider than max, scale it down
      if (calculatedWidth > maxWidth) {
        calculatedWidth = maxWidth;
      }
      // If image is narrower than min, use min (but don't stretch the image)
      if (calculatedWidth < minWidth && imageNaturalWidth >= minWidth) {
        calculatedWidth = minWidth;
      }
      
      // Calculate height based on aspect ratio (use natural dimensions only - NOT rendered to prevent feedback loop)
      const imageAspectRatio = imageNaturalHeight / imageNaturalWidth;
      const calculatedHeight = calculatedWidth * imageAspectRatio;
      
      // Set width
      setCalculatedModalWidth(calculatedWidth);
      
      // Set height
      if (calculatedHeight && calculatedHeight > 0) {
        // Padding is 4px total (2px top + 2px bottom from inline style padding: '2px 4px')
        const padding = 4; // 4px total (2px top + 2px bottom)
        const maxHeight = window.innerHeight * 0.95; // Max 95% of viewport
        // Add header height and padding to get total modal height
        const totalHeight = calculatedHeight + headerHeight + padding;
        
        // Use calculated height if it's reasonable, otherwise use max
        const newHeight = Math.min(totalHeight, maxHeight);
        setCalculatedModalHeight(newHeight);
      }
    }
    // Removed PDF/DOCX dimension setting - they're already set correctly in initial state
    // Removed imageRenderedHeight and imageRenderedWidth from dependencies to prevent feedback loop
  }, [isImage, imageNaturalHeight, imageNaturalWidth, isMapVisible, headerHeight, isPDF, isDOCX]);
  
  // Reset calculation flag when file changes
  React.useEffect(() => {
    dimensionsCalculatedRef.current = false;
    lastNaturalDimsRef.current = { width: null, height: null };
  }, [file?.id]);

  const modalHeight = calculatedModalHeight;
  // Allow smaller minimum width - tabs will scroll if needed
  const baseMinWidth = isMapVisible ? 250 : 300;
  const modalWidth = calculatedModalWidth;

  // Auto-scroll active tab into view when it changes
  React.useEffect(() => {
    if (activeTabIndex >= 0 && tabsContainerRef.current) {
      const activeTabElement = tabRefs.current.get(activeTabIndex);
      if (activeTabElement) {
        // Use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
          const container = tabsContainerRef.current;
          if (container) {
            const containerRect = container.getBoundingClientRect();
            const tabRect = activeTabElement.getBoundingClientRect();
            // Calculate scroll position to center the tab while respecting padding
            const scrollLeft = activeTabElement.offsetLeft - (containerRect.width / 2) + (tabRect.width / 2);
            // Ensure we don't scroll past the end (accounting for spacer)
            const maxScroll = container.scrollWidth - container.clientWidth;
            container.scrollTo({
              left: Math.max(0, Math.min(scrollLeft, maxScroll)),
              behavior: 'smooth'
            });
          }
        });
      }
    }
  }, [activeTabIndex, files.length]);

  // Use refs to store resize state for performance (avoid re-renders during drag)
  const resizeStateRef = React.useRef<{
    startPos: { x: number; y: number };
    startSize: { width: number; height: number };
    startPosition: { left: number; top: number };
    direction: string;
  } | null>(null);
  const rafIdRef = React.useRef<number | null>(null);

  // Handle resize functionality
  const handleResizeStart = (e: React.MouseEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (modalRef.current) {
      const rect = modalRef.current.getBoundingClientRect();
      setIsResizing(true);
      setResizeDirection(direction);
      
      // Store in ref for fast access during drag
      resizeStateRef.current = {
        startPos: { x: e.clientX, y: e.clientY },
        startSize: { width: rect.width, height: rect.height },
        startPosition: { left: rect.left, top: rect.top },
        direction
      };
      
      // Also set state for initial values
      setResizeStartPos({ x: e.clientX, y: e.clientY });
      setResizeStartSize({ width: rect.width, height: rect.height });
      setResizeStartPosition({ left: rect.left, top: rect.top });
    }
  };

  React.useEffect(() => {
    if (!isResizing || !resizeStateRef.current) {
      return;
    }

    const state = resizeStateRef.current;
    const direction = state.direction;

    // Determine min/max constraints - allow resizing for DOCX
    const minWidth = isDOCX 
      ? (isMapVisible ? 550 : 750)
      : (isMapVisible ? 250 : 300);
    const maxWidth = isDOCX
      ? (isMapVisible ? window.innerWidth - 32 : window.innerWidth * 0.95)
      : (isMapVisible 
        ? window.innerWidth - 32
        : Math.min(window.innerWidth * 0.9, 1400));
    const minHeight = 200;
    const chatBarTop = isMapVisible ? window.innerHeight - 120 : window.innerHeight;
    const paddingAboveChat = 16;
    const maxAllowedBottom = chatBarTop - paddingAboveChat;

    const handleMouseMove = (e: MouseEvent) => {
      // Cancel any pending RAF
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }

      // Use requestAnimationFrame for smooth updates
      rafIdRef.current = requestAnimationFrame(() => {
        if (!modalRef.current || !resizeStateRef.current) return;

        const deltaX = e.clientX - state.startPos.x;
        const deltaY = e.clientY - state.startPos.y;

        let newWidth = state.startSize.width;
        let newHeight = state.startSize.height;
        let newLeft: number | undefined;
        let newTop: number | undefined;

        // Handle width changes
        if (direction.includes('e')) {
          newWidth = Math.min(Math.max(state.startSize.width + deltaX, minWidth), maxWidth);
        }
        if (direction.includes('w')) {
          newWidth = Math.min(Math.max(state.startSize.width - deltaX, minWidth), maxWidth);
          newLeft = state.startPosition.left + (state.startSize.width - newWidth);
        }
        
        // Handle height changes
        if (direction.includes('s')) {
          const proposedHeight = state.startSize.height + deltaY;
          const proposedBottom = state.startPosition.top + proposedHeight;
          if (isMapVisible && proposedBottom > maxAllowedBottom) {
            newHeight = maxAllowedBottom - state.startPosition.top;
          } else {
            newHeight = Math.min(Math.max(proposedHeight, minHeight), window.innerHeight * 0.95);
          }
        }
        if (direction.includes('n')) {
          const proposedHeight = state.startSize.height - deltaY;
          const proposedBottom = state.startPosition.top + proposedHeight;
          if (isMapVisible && proposedBottom > maxAllowedBottom) {
            newHeight = maxAllowedBottom - state.startPosition.top;
          } else {
            newHeight = Math.min(Math.max(proposedHeight, minHeight), window.innerHeight * 0.95);
          }
          newTop = state.startPosition.top + (state.startSize.height - newHeight);
        }

        // Direct DOM manipulation for immediate visual feedback
        const modal = modalRef.current;
        if (modal) {
          modal.style.width = `${newWidth}px`;
          modal.style.height = `${newHeight}px`;
          
          if (isMapVisible && (newLeft !== undefined || newTop !== undefined)) {
            if (newLeft !== undefined) modal.style.left = `${newLeft}px`;
            if (newTop !== undefined) modal.style.top = `${newTop}px`;
          }
        }

        // Update state (will be applied on mouseup for final values)
        setCalculatedModalWidth(newWidth);
        setCalculatedModalHeight(newHeight);
        
        if (isMapVisible && (newLeft !== undefined || newTop !== undefined)) {
          setModalPosition({
            ...(newLeft !== undefined ? { left: newLeft } : {}),
            ...(newTop !== undefined ? { top: newTop } : {})
          });
        }
      });
    };

    const handleMouseUp = () => {
      // Cancel any pending RAF
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      setIsResizing(false);
      setResizeDirection(null);
      setResizeStartPos(null);
      setResizeStartSize(null);
      setResizeStartPosition(null);
      resizeStateRef.current = null;
      
      if (!isMapVisible) {
        setModalPosition(null);
      }
    };

    // Use passive listeners for better performance
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [isResizing, isMapVisible, isDOCX]);

  // Get file icon component based on file type
  const getFileIcon = (fileType: string) => {
    const iconStyle = { width: '16px', height: '16px', minWidth: '16px', minHeight: '16px', maxWidth: '16px', maxHeight: '16px', flexShrink: 0 };
    if (fileType.includes('pdf')) {
      return <FileText className="text-gray-600" style={iconStyle} />;
    }
    if (fileType.includes('image')) {
      return <ImageIcon className="text-gray-600" style={iconStyle} />;
    }
    if (fileType.includes('word') || fileType.includes('document')) {
      return <FileText className="text-gray-600" style={iconStyle} />;
    }
    return <Globe className="text-gray-600" style={iconStyle} />;
  };

  // Truncate file name for tab display
  const truncateFileName = (name: string, maxLength: number = 20): string => {
    if (name.length <= maxLength) return name;
    const extension = name.split('.').pop();
    const nameWithoutExt = name.substring(0, name.lastIndexOf('.'));
    const truncated = nameWithoutExt.substring(0, maxLength - extension.length - 4);
    return `${truncated}...${extension ? '.' + extension : ''}`;
  };

  // Add CSS for highlight animation
  React.useEffect(() => {
    const styleId = 'document-preview-highlight-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes fadeInHighlight {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
      `;
      document.head.appendChild(style);
    }
    return () => {
      // Don't remove style on unmount - it's shared
    };
  }, []);

  // Use portal to render outside of parent container to avoid transform issues
  const modalContent = (
    <AnimatePresence>
      {isOpen && files.length > 0 && file && (
        <>
          {/* Backdrop - Only show in non-map view */}
          {!isMapVisible && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
            />
          )}
          
          {/* Modal Content - Centered Dialog or Top-Left for Map View */}
          <motion.div
            data-document-preview-modal="true"
            layout={false}
            initial={{ 
              opacity: 1, 
              scale: 1, 
              x: 0,
              y: 0,
            }}
            animate={{ 
              opacity: 1, 
              scale: 1, 
              x: 0,
              y: 0,
              // Don't animate dimensions - they're controlled by style prop for instant display
            }}
            exit={{ 
              opacity: 0, 
              scale: 1, 
              x: 0,
              y: 0,
            }}
            transition={{ 
              duration: 0, // Instant - no animation for all properties
            }}
            style={{
              position: 'fixed',
              ...(isResizing ? { willChange: 'width, height, left, top' } : {}),
              ...(isMapVisible 
                ? { 
                    // Position to the right of the chat panel when chat is open
                    // Chat panel is positioned at sidebarWidth, with width chatPanelWidth
                    // Add 16px spacing between chat panel and document preview
                    left: modalPosition?.left !== undefined 
                      ? `${modalPosition.left}px`
                      : (chatPanelWidth > 0 
                          ? `${sidebarWidth + chatPanelWidth + 16}px` // Position to the right of chat panel
                          : (isSidebarCollapsed 
                              ? '24px' 
                              : 'calc(max(40px, 56px) + 24px)')), // Fallback: after sidebar
                    top: modalPosition?.top !== undefined 
                      ? `${modalPosition.top}px`
                      : '16px', 
                    width: typeof modalWidth === 'number' ? `${modalWidth}px` : (typeof modalWidth === 'string' ? modalWidth : (isImage ? '450px' : (isDOCX ? '600px' : '450px'))),
                    minWidth: isDOCX ? '550px' : '250px', // Allow resizing for DOCX in map view
                    height: typeof modalHeight === 'number' ? `${modalHeight}px` : (typeof modalHeight === 'string' ? modalHeight : 'auto'),
                    maxWidth: 'none', // Remove right-side limit in map view
                    zIndex: 100,
                    transform: 'none', // Override transform for map view
                    // Prevent any visual transitions on dimensions
                    transition: 'none',
                    // Resize cursor
                    ...(isResizing ? { cursor: resizeDirection === 'se' ? 'nwse-resize' : resizeDirection === 'sw' ? 'nesw-resize' : resizeDirection === 'ne' ? 'nesw-resize' : resizeDirection === 'nw' ? 'nwse-resize' : resizeDirection === 'e' || resizeDirection === 'w' ? 'ew-resize' : resizeDirection === 'n' || resizeDirection === 's' ? 'ns-resize' : 'default' } : {})
                  } 
                : { 
                    left: '50%', 
                    top: '50%', 
                    width: typeof modalWidth === 'number' ? `${modalWidth}px` : (typeof modalWidth === 'string' ? modalWidth : '640px'), // Default to 640px (map view width)
                    height: typeof modalHeight === 'number' ? `${modalHeight}px` : (typeof modalHeight === 'string' ? modalHeight : '75vh'), // Default to 75vh (map view height)
                    maxWidth: isDOCX ? 'none' : (typeof modalWidth === 'number' ? `${modalWidth}px` : typeof modalWidth === 'string' ? modalWidth : '640px'), // Use 640px as maxWidth for all documents
                    minWidth: isDOCX ? '640px' : '300px', // Minimum width matches default
                    maxHeight: '75vh', // Constrain max height to 75vh
                    boxSizing: 'border-box', // Ensure padding/borders don't expand width
                    overflow: 'hidden', // Prevent content from expanding modal
                    zIndex: 50,
                    border: 'none',
                    // Prevent any visual transitions on dimensions
                    transition: 'none',
                    // Transform handled by CSS class .modal-centered to override Framer Motion
                    // Resize cursor
                    ...(isResizing ? { cursor: resizeDirection === 'se' ? 'nwse-resize' : resizeDirection === 'sw' ? 'nesw-resize' : resizeDirection === 'ne' ? 'nesw-resize' : resizeDirection === 'nw' ? 'nwse-resize' : resizeDirection === 'e' || resizeDirection === 'w' ? 'ew-resize' : resizeDirection === 'n' || resizeDirection === 's' ? 'ns-resize' : 'default' } : {})
                  }
              )
            }}
            className={`flex flex-col bg-white rounded-lg shadow-2xl overflow-hidden relative ${!isMapVisible ? 'modal-centered' : ''} ${isResizing ? 'select-none' : ''}`}
            onClick={(e) => e.stopPropagation()}
            ref={modalRef}
          >
            {/* Close Button - Always in top right corner */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="absolute top-4 right-4 z-50 p-1.5 hover:bg-gray-100 rounded transition-colors"
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                zIndex: 50,
              }}
              title="Close"
            >
              <X className="w-4 h-4 text-gray-600" />
            </button>
            {/* Tabs Bar */}
            {files.length > 0 && (
              <div 
                ref={tabsContainerRef}
                className="flex items-end gap-0 pt-3 pb-0 overflow-x-auto overflow-y-visible tabs-scrollbar" 
                style={{ 
                  background: 'white', 
                  width: '100%',
                  minWidth: '100%',
                  maxWidth: '100%',
                  paddingLeft: '16px', 
                  paddingRight: '16px',
                  marginBottom: '0',
                  paddingBottom: '0',
                  flexWrap: 'nowrap',
                  alignItems: 'flex-end',
                  boxSizing: 'border-box',
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  flexShrink: 0,
                  flexGrow: 0,
                  position: 'relative',
                  zIndex: 1,
                  borderBottom: 'none',
                }}
              >
                {files.map((tabFile, index) => {
                  const isActive = index === activeTabIndex;
                  return (
                    <div
                      key={tabFile.id}
                      ref={(el) => {
                        if (el) {
                          tabRefs.current.set(index, el);
                        } else {
                          tabRefs.current.delete(index);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      draggable={onTabReorder ? true : false}
                      onDragStart={(e) => {
                        if (!onTabReorder) return;
                        setDraggedTabIndex(index);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', index.toString());
                        // Add visual feedback
                        if (e.currentTarget) {
                          e.currentTarget.style.opacity = '0.5';
                          e.currentTarget.style.cursor = 'grabbing';
                        }
                      }}
                      onDragEnd={(e) => {
                        setDraggedTabIndex(null);
                        setDragOverTabIndex(null);
                        // Reset visual feedback
                        if (e.currentTarget) {
                          e.currentTarget.style.opacity = '1';
                          e.currentTarget.style.cursor = onTabReorder ? 'grab' : 'pointer';
                        }
                      }}
                      onDragOver={(e) => {
                        if (!onTabReorder || draggedTabIndex === null) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOverTabIndex !== index && draggedTabIndex !== index) {
                          setDragOverTabIndex(index);
                        }
                      }}
                      onDragLeave={(e) => {
                        // Only clear dragOver if we're actually leaving the element
                        const rect = e.currentTarget.getBoundingClientRect();
                        const x = e.clientX;
                        const y = e.clientY;
                        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                          if (dragOverTabIndex === index) {
                            setDragOverTabIndex(null);
                          }
                        }
                      }}
                      onDrop={(e) => {
                        if (!onTabReorder || draggedTabIndex === null) return;
                        e.preventDefault();
                        e.stopPropagation();
                        
                        const dragIndex = draggedTabIndex;
                        const dropIndex = index;
                        
                        if (dragIndex === dropIndex) {
                          setDraggedTabIndex(null);
                          setDragOverTabIndex(null);
                          return;
                        }
                        
                        // Create new array with reordered files
                        const newFiles = [...files];
                        const [draggedFile] = newFiles.splice(dragIndex, 1);
                        newFiles.splice(dropIndex, 0, draggedFile);
                        
                        // Calculate new active tab index
                        let newActiveIndex = activeTabIndex;
                        if (dragIndex === activeTabIndex) {
                          // If we dragged the active tab, it moves to dropIndex
                          newActiveIndex = dropIndex;
                        } else if (dragIndex < activeTabIndex && dropIndex >= activeTabIndex) {
                          // Active tab moved left
                          newActiveIndex = activeTabIndex - 1;
                        } else if (dragIndex > activeTabIndex && dropIndex <= activeTabIndex) {
                          // Active tab moved right
                          newActiveIndex = activeTabIndex + 1;
                        }
                        
                        // Call the reorder callback
                        onTabReorder(newFiles);
                        
                        // Update active tab if needed
                        if (newActiveIndex !== activeTabIndex) {
                          onTabChange(newActiveIndex);
                        }
                        
                        setDraggedTabIndex(null);
                        setDragOverTabIndex(null);
                      }}
                      onMouseDown={(e) => {
                        // Don't prevent default on drag start
                        if (e.button !== 0) {
                          e.preventDefault();
                          e.stopPropagation();
                        }
                      }}
                      onClick={(e) => {
                        // Don't trigger click if we just finished dragging
                        if (draggedTabIndex !== null) {
                          e.preventDefault();
                          e.stopPropagation();
                          return;
                        }
                        // Prevent all default behaviors that could trigger downloads
                        e.preventDefault();
                        e.stopPropagation();
                        // Access native event for stopImmediatePropagation
                        const nativeEvent = e.nativeEvent;
                        if (nativeEvent && nativeEvent.stopImmediatePropagation) {
                          nativeEvent.stopImmediatePropagation();
                        }
                        // Prevent any link-like behavior
                        if (e.target instanceof HTMLAnchorElement) {
                          e.target.href = 'javascript:void(0)';
                        }
                        onTabChange(index);
                        return false;
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onAuxClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      className={`
                        flex items-center gap-2 px-3 py-2 text-sm font-medium cursor-pointer transition-all relative
                        ${isActive 
                          ? 'bg-white text-gray-900 rounded-t-lg border-t border-l border-r border-gray-200 -mb-px' 
                          : 'text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-t-lg border-t border-l border-r border-transparent hover:border-gray-200'
                        }
                        ${draggedTabIndex === index ? 'opacity-50' : ''}
                        ${dragOverTabIndex === index && draggedTabIndex !== index ? 'ring-2 ring-blue-400' : ''}
                        flex-shrink-0
                      `}
                      style={{
                        zIndex: isActive ? 10 : 1,
                        minWidth: 'fit-content',
                        maxWidth: 'none',
                        width: 'auto',
                        flexBasis: 'auto',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        flexGrow: 0,
                        boxSizing: 'border-box',
                        display: 'inline-flex',
                        userSelect: 'none',
                        WebkitUserSelect: 'none',
                        touchAction: onTabReorder ? 'none' : 'none',
                        position: 'relative',
                        cursor: onTabReorder ? 'grab' : 'pointer',
                      }}
                    >
                      {/* Icon */}
                      {(() => {
                        const iconStyle = { width: '12px', height: '12px', minWidth: '12px', minHeight: '12px', maxWidth: '12px', maxHeight: '12px', flexShrink: 0 };
                        const iconColor = isActive ? 'text-gray-900' : 'text-gray-500';
                        if (tabFile.type.includes('pdf')) {
                          return <FileText className={`flex-shrink-0 ${iconColor}`} style={iconStyle} />;
                        }
                        if (tabFile.type.includes('image')) {
                          return <ImageIcon className={`flex-shrink-0 ${iconColor}`} style={iconStyle} />;
                        }
                        if (tabFile.type.includes('word') || tabFile.type.includes('document') || tabFile.name?.toLowerCase().endsWith('.docx') || tabFile.name?.toLowerCase().endsWith('.doc')) {
                          return <FileText className={`flex-shrink-0 ${iconColor}`} style={iconStyle} />;
                        }
                        return <Globe className={`flex-shrink-0 ${iconColor}`} style={iconStyle} />;
                      })()}
                      {/* File name */}
                      <span 
                        className={`text-xs ${isActive ? 'text-gray-900' : 'text-gray-600'}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        style={{ 
                          fontSize: '12px', 
                          lineHeight: '1.2',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          flexShrink: 0,
                          minWidth: 0,
                          pointerEvents: 'none',
                        }}
                      >
                        {truncateFileName(tabFile.name, 20)}
                      </span>
                      {/* Close button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onTabClose(index);
                        }}
                        className="ml-0.5 p-0.5 rounded hover:bg-gray-300/50 flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity focus:outline-none outline-none"
                        title="Close tab"
                      >
                        <X className="w-3 h-3 text-gray-600" />
                      </button>
                      {isActive && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
                      )}
                    </div>
                  );
                })}
                {/* Plus button to add new attachment - Standalone icon */}
                {files.length < 4 && onAddAttachment && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddAttachment();
                    }}
                    className="flex items-center justify-center focus:outline-none outline-none transition-opacity duration-150 hover:opacity-70"
                    style={{
                      flexShrink: 0,
                      marginLeft: '16px',
                      background: 'transparent',
                      border: 'none',
                      padding: '0',
                      width: 'auto',
                      height: 'auto',
                      alignSelf: 'center',
                      marginTop: '2px',
                    }}
                    title="Add attachment"
                  >
                    <Plus className="w-4 h-4 text-gray-500" />
                  </button>
                )}
              </div>
            )}
            
            {/* Top Bar - File Name and Controls (Browser-like) */}
            <div ref={headerRef} className="flex items-center justify-between px-4 py-2.5 bg-white">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <h2 className="text-sm font-medium text-gray-900 truncate">
                  {file.name}
                </h2>
              </div>
              
              <div className="flex items-center gap-1.5">
                {/* Page Navigation (for PDFs) */}
                {isPDF && (
                  <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 rounded hover:bg-gray-100 transition-colors">
                    <button
                      onClick={handlePreviousPage}
                      disabled={currentPage === 1}
                      className="p-1 hover:bg-gray-200 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      title="Previous page"
                    >
                      <ChevronLeft className="w-4 h-4 text-gray-600" />
                    </button>
                    <span className="text-xs text-gray-600 font-normal px-1.5">
                      {currentPage} / {totalPages}
                    </span>
                    <button
                      onClick={handleNextPage}
                      disabled={currentPage === totalPages}
                      className="p-1 hover:bg-gray-200 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      title="Next page"
                    >
                      <ChevronRight className="w-4 h-4 text-gray-600" />
                    </button>
                  </div>
                )}
                
                {/* Zoom Controls */}
                <div className="flex items-center gap-0.5 px-1.5 py-1 bg-gray-50 rounded hover:bg-gray-100 transition-colors">
                  <button
                    onClick={handleZoomOut}
                    className="p-1 hover:bg-gray-200 rounded transition-colors"
                    title="Zoom out"
                  >
                    <ZoomOut className="w-4 h-4 text-gray-600" />
                  </button>
                  <span className="text-xs text-gray-600 font-normal px-1.5 min-w-[2.5rem] text-center">
                    {zoomLevel}%
                  </span>
                  <button
                    onClick={handleZoomIn}
                    className="p-1 hover:bg-gray-200 rounded transition-colors"
                    title="Zoom in"
                  >
                    <ZoomIn className="w-4 h-4 text-gray-600" />
                  </button>
                </div>
                
                {/* Rotate (for images) */}
                {isImage && (
                  <button
                    onClick={handleRotate}
                    className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                    title="Rotate"
                  >
                    <RotateCw className="w-4 h-4 text-gray-600" />
                  </button>
                )}
                
                {/* Download */}
                <button
                  onClick={handleDownload}
                  className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                  title="Download"
                >
                  <Download className="w-4 h-4 text-gray-600" />
                </button>
                
                {/* Reprocess for BBOX - Only show if file has an ID (from backend) */}
                {file?.id && (
                  <div className="relative">
                    <button
                      onClick={() => setReprocessDropdownOpen(!reprocessDropdownOpen)}
                      className={`p-1.5 hover:bg-gray-100 rounded transition-colors flex items-center gap-0.5 ${isReprocessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                      title="Reprocess document for citation highlighting"
                      disabled={isReprocessing}
                    >
                      {isReprocessing ? (
                        <Loader2 className="w-4 h-4 text-gray-600 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4 text-gray-600" />
                      )}
                      <ChevronDown className="w-3 h-3 text-gray-400" />
                    </button>
                    
                    {/* Dropdown Menu */}
                    {reprocessDropdownOpen && !isReprocessing && (
                      <div 
                        className="absolute right-0 top-full mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50"
                        onMouseLeave={() => setReprocessDropdownOpen(false)}
                      >
                        <button
                          onClick={() => handleReprocess('full')}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex flex-col gap-0.5"
                        >
                          <span className="font-medium text-gray-800">Full Reprocess</span>
                          <span className="text-xs text-gray-500">Re-embed & extract BBOX (slower)</span>
                        </button>
                        <button
                          onClick={() => handleReprocess('bbox_only')}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex flex-col gap-0.5"
                        >
                          <span className="font-medium text-gray-800">Update BBOX Only</span>
                          <span className="text-xs text-gray-500">Keep embeddings, add BBOX (faster)</span>
                        </button>
                      </div>
                    )}
                    
                    {/* Result Toast */}
                    {reprocessResult && (
                      <div 
                        className={`absolute right-0 top-full mt-1 px-3 py-2 rounded-lg shadow-lg text-sm whitespace-nowrap z-50 ${
                          reprocessResult.success 
                            ? 'bg-green-50 text-green-800 border border-green-200' 
                            : 'bg-red-50 text-red-800 border border-red-200'
                        }`}
                      >
                        {reprocessResult.message}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            
            {/* Document Preview Area - Clean white background like browser */}
            <div 
              ref={previewAreaRef}
              className={isImage ? "overflow-hidden bg-white flex items-center justify-center" : isDOCX ? "flex-1 overflow-hidden bg-white flex items-center justify-center docx-scrollbar" : "flex-1 overflow-auto bg-white"}
              style={isImage ? { 
                height: 'auto',
                lineHeight: 0, // Remove any line-height spacing
                fontSize: 0, // Remove any font-size spacing
              } : isDOCX ? {
                position: 'relative',
                minHeight: 0, // Allow flex shrinking
                // Translucent scrollbar styling
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(0, 0, 0, 0.2) transparent',
              } : {
                padding: '0', // Infinity pool style - no outer padding, inner wrapper handles spacing
                boxSizing: 'border-box',
              }}
            >
              {blobUrl && (
                <>
                  {isPDF ? (
                    <div 
                      ref={pdfWrapperRef}
                      className="w-full h-full"
                      style={{
                        pointerEvents: 'auto',
                        padding: '8px', // Minimal padding for infinity pool effect - keeps title fix while reducing overall padding
                        margin: '0',
                        display: 'block',
                        position: 'relative',
                        height: '100%',
                        boxSizing: 'border-box',
                        overflow: 'auto', // Allow scrolling when zoomed in
                        WebkitOverflowScrolling: 'touch', // Smooth scrolling on iOS
                        touchAction: 'pan-x pan-y', // Explicitly allow panning gestures
                      }}
                    >
                      <div
                        style={{
                          width: pdfCanvasDimensions ? `${pdfCanvasDimensions.width}px` : (typeof pdfObjectWidth === 'number' ? `${pdfObjectWidth}px` : pdfObjectWidth),
                          height: pdfCanvasDimensions ? `${pdfCanvasDimensions.height}px` : (typeof pdfObjectHeight === 'number' ? `${pdfObjectHeight}px` : pdfObjectHeight),
                          minWidth: zoomLevel > 100 && pdfCanvasDimensions ? `${pdfCanvasDimensions.width}px` : (zoomLevel > 100 && typeof pdfObjectWidth === 'number' ? `${pdfObjectWidth}px` : undefined),
                          minHeight: zoomLevel > 100 && pdfCanvasDimensions ? `${pdfCanvasDimensions.height}px` : (zoomLevel > 100 && typeof pdfObjectHeight === 'number' ? `${pdfObjectHeight}px` : undefined),
                          display: 'block',
                          position: 'relative'
                        }}
                      >
                        {/* PDF.js Canvas-based rendering for precise highlight positioning */}
                        {pdfDocument ? (
                          <>
                            {/* Wrap canvas and highlight in a container that matches canvas dimensions */}
                            {/* This ensures highlight is positioned relative to canvas, not container */}
                            <div
                              style={{
                                position: 'relative',
                                width: pdfCanvasDimensions ? `${pdfCanvasDimensions.width}px` : 'auto',
                                height: pdfCanvasDimensions ? `${pdfCanvasDimensions.height}px` : 'auto',
                                margin: '0 auto', // Center the container (same as canvas)
                                display: 'block'
                              }}
                            >
                              <canvas
                                ref={pdfCanvasRef}
                                style={{
                                  display: 'block',
                                  margin: '0 auto',
                                  backgroundColor: '#fff',
                                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
                                }}
                              />
                              
                              {/* Highlight overlay for citations - positioned relative to canvas container */}
                              {/* Uses expandedBbox (normalized 0-1) converted to pixels using PDF.js viewport dimensions */}
                              {expandedBbox && expandedBbox.page === currentPage && pdfCanvasDimensions && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    // Position directly using normalized coordinates converted to pixels
                                    left: `${expandedBbox.left * pdfCanvasDimensions.width}px`,
                                    top: `${expandedBbox.top * pdfCanvasDimensions.height}px`,
                                    width: `${expandedBbox.width * pdfCanvasDimensions.width}px`,
                                    height: `${expandedBbox.height * pdfCanvasDimensions.height}px`,
                                    backgroundColor: 'rgba(255, 235, 59, 0.4)', // Yellow highlight
                                    border: '2px solid rgba(255, 193, 7, 0.9)', // Darker yellow border
                                    borderRadius: '2px',
                                    pointerEvents: 'none',
                                    zIndex: 10,
                                    boxShadow: '0 2px 8px rgba(255, 193, 7, 0.3)',
                                    opacity: 0,
                                    animation: 'fadeInHighlight 0.3s ease-in forwards',
                                    // REMOVED: Don't apply viewport transform - it's already applied to canvas rendering
                                    transformOrigin: 'top left',
                                  }}
                                />
                              )}
                            </div>
                            
                            {/* Loading indicator while rendering - positioned relative to outer container */}
                            {pdfPageRendering && (
                              <div
                                style={{
                                  position: 'absolute',
                                  top: '50%',
                                  left: '50%',
                                  transform: 'translate(-50%, -50%)',
                                  padding: '8px 16px',
                                  backgroundColor: 'rgba(0, 0, 0, 0.7)',
                                  color: 'white',
                                  borderRadius: '4px',
                                  fontSize: '12px',
                                  zIndex: 20
                                }}
                              >
                                Loading page...
                              </div>
                            )}
                            
                            {/* Debug overlay showing all chunk bboxes when enabled */}
                            {showAllChunkBboxes && chunkOverlaysForPage.length > 0 && chunkOverlaysForPage.map((chunk, idx) => (
                              <div
                                key={`debug-bbox-${chunk.chunk_index ?? idx}`}
                                style={{
                                  position: 'absolute',
                                  left: `${(chunk.bbox!.left ?? 0) * 100}%`,
                                  top: `${(chunk.bbox!.top ?? 0) * 100}%`,
                                  width: `${(chunk.bbox!.width ?? 0) * 100}%`,
                                  height: `${(chunk.bbox!.height ?? 0) * 100}%`,
                                  border: '1.5px dashed rgba(33, 150, 243, 0.9)',
                                  backgroundColor: 'rgba(33, 150, 243, 0.13)',
                                  borderRadius: '2px',
                                  pointerEvents: 'none',
                                  zIndex: 9,
                                }}
                              >
                                <span
                                  style={{
                                    position: 'absolute',
                                    top: '-18px',
                                    left: 0,
                                    backgroundColor: 'rgba(33, 150, 243, 0.95)',
                                    color: '#fff',
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    padding: '1px 4px',
                                    borderRadius: '3px'
                                  }}
                                >
                                  #{chunk.chunk_index ?? idx}
                                </span>
                              </div>
                            ))}

                            {showAllChunkBboxes && chunkOverlaysForPage.length > 0 && (
                              <div
                                style={{
                                  position: 'absolute',
                                  top: '8px',
                                  right: '8px',
                                  padding: '4px 8px',
                                  backgroundColor: 'rgba(0,0,0,0.65)',
                                  color: '#fff',
                                  fontSize: '11px',
                                  borderRadius: '4px',
                                  zIndex: 20,
                                }}
                              >
                                Debug overlays: {chunkOverlaysForPage.length} chunk{chunkOverlaysForPage.length === 1 ? '' : 's'} (Shift + D)
                              </div>
                            )}
                          </>
                        ) : (
                          /* Fallback to object tag if PDF.js hasn't loaded yet */
                          <object
                            ref={iframeRef as React.RefObject<HTMLObjectElement>}
                            key={`pdf-${file.id}-${blobUrl}-${zoomLevel}`}
                            data={zoomLevel > 100 
                              ? `${blobUrl}#page=${currentPage}&zoom=${zoomLevel}`
                              : `${blobUrl}#page=${currentPage}&zoom=page-fit&view=Fit`}
                            type="application/pdf"
                            className="border-0 bg-white"
                            style={{
                              width: '100%',
                              height: '100%',
                              pointerEvents: zoomLevel > 100 ? 'none' : 'auto',
                              imageRendering: 'auto',
                              WebkitFontSmoothing: 'antialiased',
                              transform: 'translateZ(0)',
                              backfaceVisibility: 'hidden',
                              display: 'block',
                              margin: '0',
                              padding: '0',
                              boxSizing: 'border-box',
                              touchAction: 'none',
                            }}
                            title={file.name}
                            tabIndex={-1}
                            onLoad={() => console.log('📄 PDF object loaded (fallback)')}
                            onError={(e) => console.error('❌ PDF object error:', e)}
                          >
                            <p>PDF cannot be displayed. <a href={blobUrl || undefined} download={file.name}>Download PDF</a></p>
                          </object>
                        )}
                      </div>
                    </div>
                  ) : isImage ? (
                    <img
                      ref={imgRef}
                      src={blobUrl}
                      alt={file.name}
                      className="w-full h-auto object-contain"
                      style={{
                        transform: `rotate(${rotation}deg) scale(${zoomLevel / 100})`,
                        transition: 'transform 0.2s ease',
                        display: 'block',
                        padding: '2px 4px', // 2px top/bottom, 4px left/right
                        margin: '0 auto', // Center horizontally
                        verticalAlign: 'top', // Align to top to remove bottom spacing
                      }}
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        console.log('🖼️ Image loaded! Natural dimensions:', img.naturalWidth, 'x', img.naturalHeight);
                        // Use requestAnimationFrame to ensure image is fully rendered
                        requestAnimationFrame(() => {
                          const naturalH = img.naturalHeight;
                          const naturalW = img.naturalWidth;
                          const renderedH = img.offsetHeight;
                          const renderedW = img.offsetWidth;
                          console.log('🖼️ Setting image dimensions - Natural:', naturalW, 'x', naturalH, 'Rendered:', renderedW, 'x', renderedH);
                          setImageNaturalHeight(naturalH);
                          setImageNaturalWidth(naturalW);
                          // Get actual rendered dimensions after image loads
                          setImageRenderedHeight(renderedH);
                          setImageRenderedWidth(renderedW);
                          setForceUpdate(prev => prev + 1); // Force recalculation
                        });
                      }}
                    />
                  ) : isDOCX ? (
                    isUploadingDocx ? (
                      <div className="flex flex-col items-center justify-center p-8 text-gray-500 h-full">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-4"></div>
                        <p className="text-sm">Uploading file for preview...</p>
                      </div>
                    ) : docxPublicUrl && docxIframeSrc ? (
                      <div className="w-full h-full docx-scrollbar" style={{ position: 'relative', overflow: 'auto' }}>
                        <iframe
                          ref={docxIframeRef}
                          src={docxIframeSrc}
                          className="w-full h-full border-0 bg-white"
                          style={{
                            border: 'none',
                            display: 'block',
                          }}
                          title={file.name}
                          allowFullScreen
                          onError={() => {
                            console.warn('Office Online Viewer failed');
                          }}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center p-8 text-gray-500 h-full">
                        <FileText className="w-16 h-16 text-gray-400 mb-4" />
                        <p className="text-sm mb-2 font-medium">DOCX Preview</p>
                        <p className="text-xs text-gray-400 mb-4 text-center max-w-md">
                          Unable to generate preview. Click download to open in your preferred application.
                        </p>
                        <button
                          onClick={handleDownload}
                          className="px-4 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-colors"
                        >
                          Download File
                        </button>
                      </div>
                    )
                  ) : (
                    <div className="flex flex-col items-center justify-center p-8 text-gray-500 h-full">
                      <p className="text-sm mb-2">Preview not available for this file type</p>
                      <button
                        onClick={handleDownload}
                        className="px-4 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-colors"
                      >
                        Download File
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
            
            {/* Resize Handles - Available for all document types */}
            <>
                {/* Corner handles - positioned exactly at corners */}
                <div
                  onMouseDown={(e) => handleResizeStart(e, 'se')}
                  className="absolute cursor-nwse-resize z-20 hover:bg-blue-500/10"
                  style={{
                    width: '32px',
                    height: '32px',
                    background: 'transparent',
                    touchAction: 'none',
                    userSelect: 'none',
                    bottom: '-16px',
                    right: '-16px',
                  }}
                  title="Resize"
                />
                <div
                  onMouseDown={(e) => handleResizeStart(e, 'sw')}
                  className="absolute cursor-nesw-resize z-20 hover:bg-blue-500/10"
                  style={{
                    width: '32px',
                    height: '32px',
                    background: 'transparent',
                    touchAction: 'none',
                    userSelect: 'none',
                    bottom: '-16px',
                    left: '-16px',
                  }}
                  title="Resize"
                />
                <div
                  onMouseDown={(e) => handleResizeStart(e, 'ne')}
                  className="absolute cursor-nesw-resize z-20 hover:bg-blue-500/10"
                  style={{
                    width: '32px',
                    height: '32px',
                    background: 'transparent',
                    touchAction: 'none',
                    userSelect: 'none',
                    top: '-16px',
                    right: '-16px',
                  }}
                  title="Resize"
                />
                <div
                  onMouseDown={(e) => handleResizeStart(e, 'nw')}
                  className="absolute cursor-nwse-resize z-20 hover:bg-blue-500/10"
                  style={{
                    width: '32px',
                    height: '32px',
                    background: 'transparent',
                    touchAction: 'none',
                    userSelect: 'none',
                    top: '-16px',
                    left: '-16px',
                  }}
                  title="Resize"
                />
                
                {/* Edge handles - positioned exactly at edges */}
                <div
                  onMouseDown={(e) => handleResizeStart(e, 'e')}
                  className="absolute top-0 cursor-ew-resize z-20 hover:bg-blue-500/10"
                  style={{
                    width: '12px',
                    height: '100%',
                    background: 'transparent',
                    touchAction: 'none',
                    userSelect: 'none',
                    right: '-6px',
                  }}
                  title="Resize width"
                />
                <div
                  onMouseDown={(e) => handleResizeStart(e, 'w')}
                  className="absolute top-0 cursor-ew-resize z-20 hover:bg-blue-500/10"
                  style={{
                    width: '12px',
                    height: '100%',
                    background: 'transparent',
                    touchAction: 'none',
                    userSelect: 'none',
                    left: '-6px',
                  }}
                  title="Resize width"
                />
                <div
                  onMouseDown={(e) => handleResizeStart(e, 's')}
                  className="absolute left-0 cursor-ns-resize z-20 hover:bg-blue-500/10"
                  style={{
                    width: '100%',
                    height: '12px',
                    background: 'transparent',
                    touchAction: 'none',
                    userSelect: 'none',
                    bottom: '-6px',
                  }}
                  title="Resize height"
                />
                <div
                  onMouseDown={(e) => handleResizeStart(e, 'n')}
                  className="absolute left-0 cursor-ns-resize z-20 hover:bg-blue-500/10"
                  style={{
                    width: '100%',
                    height: '12px',
                    background: 'transparent',
                    touchAction: 'none',
                    userSelect: 'none',
                    top: '-6px',
                  }}
                  title="Resize height"
                />
            </>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  // Render to document body to avoid parent container transform issues
  if (typeof window !== 'undefined') {
    return createPortal(modalContent, document.body);
  }
  
  return modalContent;
};


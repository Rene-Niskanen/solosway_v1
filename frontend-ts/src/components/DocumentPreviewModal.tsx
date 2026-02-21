"use client";

import * as React from "react";
import { createPortal, flushSync } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Download, RotateCw, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, FileText, Image as ImageIcon, Globe, Plus, RefreshCw, ChevronDown, Loader2, Share2, Printer, MoreVertical, Square } from "lucide-react";
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
  sidebarWidth?: number; // Width of the sidebar in pixels (includes base sidebar + filing sidebar)
  filingSidebarWidth?: number; // Width of the FilingSidebar in pixels (for instant recalculation)
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
  sidebarWidth = 56,
  filingSidebarWidth = 0
}) => {
  const file = files[activeTabIndex] || null;
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = React.useState(100);
  const [rotation, setRotation] = React.useState(0);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const prevFileIdRef = React.useRef<string | null>(null); // Track previous file ID for optimization
  
  // Local state for instant close - hides modal immediately before parent state updates
  const [isLocallyHidden, setIsLocallyHidden] = React.useState(false);
  
  // Reset locally hidden state when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setIsLocallyHidden(false);
    }
  }, [isOpen]);

  // Reset PDF render width trigger when modal closes so next open gets a fresh render
  React.useEffect(() => {
    if (!isOpen) {
      setContainerWidthForPdfRender(null);
      lastContainerWidthForPdfRenderRef.current = null;
    }
  }, [isOpen]);

  // Instant close handler - hides immediately, then notifies parent
  const handleInstantClose = React.useCallback(() => {
    setIsLocallyHidden(true); // Hide immediately (local re-render returns null)
    onClose(); // Notify parent synchronously - React batches state updates
  }, [onClose]);
  
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
  
  // Use bbox as-is; only validate. Positioning is handled solely by scrolling to center it vertically.
  const expandedBbox = React.useMemo(() => {
    if (!fileHighlight?.bbox) return null;
    const bbox = fileHighlight.bbox;
    if (
      typeof bbox.left !== 'number' || bbox.left < 0 || bbox.left > 1 ||
      typeof bbox.top !== 'number' || bbox.top < 0 || bbox.top > 1 ||
      typeof bbox.width !== 'number' || bbox.width <= 0 || bbox.width > 1 ||
      typeof bbox.height !== 'number' || bbox.height <= 0 || bbox.height > 1
    ) {
      return null;
    }
    const original_page = (bbox as any).original_page;
    return {
      left: bbox.left,
      top: bbox.top,
      width: bbox.width,
      height: bbox.height,
      page: bbox.page,
      ...(original_page !== undefined && { original_page })
    };
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
  
  // Continuous scrolling: render all pages
  const [renderedPages, setRenderedPages] = React.useState<Map<number, { canvas: HTMLCanvasElement; dimensions: { width: number; height: number }; yOffset: number }>>(new Map());
  const [pageOffsets, setPageOffsets] = React.useState<Map<number, number>>(new Map()); // page number -> y offset
  const [baseScale, setBaseScale] = React.useState<number>(1.0); // Base scale for rendering (calculated once)
  // Track the last width used for scale calculation to detect when recalculation is needed
  const lastScaleWidthRef = React.useRef<number>(0);
  const lastRenderedFileIdRef = React.useRef<string | null>(null);
  const [dimensionsStable, setDimensionsStable] = React.useState<boolean>(false); // Track when dimensions are stable for bbox positioning
  const pdfPagesContainerRef = React.useRef<HTMLDivElement>(null);
  // Width that triggers PDF full re-render; only updated when width changes by >50px to avoid jitter and restarts
  const [containerWidthForPdfRender, setContainerWidthForPdfRender] = React.useState<number | null>(null);
  const lastContainerWidthForPdfRenderRef = React.useRef<number | null>(null);
  const [scrollResetApplied, setScrollResetApplied] = React.useState(true);
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
    
    // For non-map view: centered modal (67.5vw × 82.5vh)
    // For map view: use smaller dimensions
    if (isMapVisible) {
      // Map view: use smaller dimensions
      if (isDOCXFile || isPDFFile) {
        return { height: '75vh', width: '640px' };
      } else if (isImageFile) {
        return { height: '85vh', width: '90vw' };
      } else {
        return { height: '75vh', width: '640px' };
      }
    } else {
      // Non-map view: centered modal (65-70% width, 80-85% height)
      return { height: '82.5vh', width: '67.5vw' };
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
      // Reset base scale when file changes so it recalculates for new document
      setBaseScale(1.0);
      lastScaleWidthRef.current = 0; // Reset width tracking to force recalculation
      setDimensionsStable(false); // Reset until PDF re-renders at correct scale
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
      setBaseScale(1.0); // Reset base scale
      lastScaleWidthRef.current = 0; // Reset width tracking to force recalculation
      setDimensionsStable(false); // Reset dimensions stable flag - will be set true after PDF renders
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

  const chunkOverlaysForAllPages = React.useMemo(() => {
    if (!showAllChunkBboxes || !fileHighlight?.chunks) return [];
    return fileHighlight.chunks.filter(chunk => {
      return chunk?.bbox; // Show all chunks across all pages
    });
  }, [showAllChunkBboxes, fileHighlight]);

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

  // Render ALL PDF pages to canvas for continuous scrolling.
  // Only re-runs when containerWidthForPdfRender changes (set once after layout, then on resize >50px) so we don't restart on jitter.
  React.useEffect(() => {
    if (!pdfDocument || !isOpen || !file || totalPages === 0) return;
    if (containerWidthForPdfRender == null) return;

    const currentContainerWidth =
      containerWidthForPdfRender ||
      (previewAreaRef.current?.clientWidth > 100 ? previewAreaRef.current.clientWidth : 0) ||
      (pdfWrapperRef.current?.clientWidth > 100 ? pdfWrapperRef.current.clientWidth : 0) ||
      (typeof calculatedModalWidth === 'number' && calculatedModalWidth > 100 ? calculatedModalWidth : 0) ||
      (typeof calculatedModalWidth === 'string' && calculatedModalWidth.endsWith('vw')
        ? Math.round((parseFloat(calculatedModalWidth) / 100) * window.innerWidth)
        : 0) ||
      (typeof calculatedModalWidth === 'string' && calculatedModalWidth.endsWith('px') ? parseInt(calculatedModalWidth, 10) || 0 : 0);

    if (currentContainerWidth <= 100) return;

    let cancelled = false;
    const renderTasks = new Map<number, any>(); // Track render tasks per page

    const renderAllPages = async () => {
      try {
        // Always render at base scale - zoom will be applied via CSS transform for smooth experience
        // Calculate base scale to fit container width (recalculate when width changes significantly)
        let scale = baseScale;
        
        // Get current container width for comparison
        let currentContainerWidth = 0;
        if (previewAreaRef.current && previewAreaRef.current.clientWidth > 100) {
          currentContainerWidth = previewAreaRef.current.clientWidth;
        } else if (pdfWrapperRef.current && pdfWrapperRef.current.clientWidth > 100) {
          currentContainerWidth = pdfWrapperRef.current.clientWidth;
        } else if (typeof calculatedModalWidth === 'number' && calculatedModalWidth > 100) {
          currentContainerWidth = calculatedModalWidth;
        }
        
        // Recalculate scale if:
        // - baseScale is still default (1.0) - first render
        // - lastScaleWidthRef is 0 - hasn't been calculated yet
        // - container width changed by more than 50px - significant resize
        const widthChangedSignificantly = lastScaleWidthRef.current > 0 && 
          Math.abs(currentContainerWidth - lastScaleWidthRef.current) > 50;
        const needsScaleRecalculation = baseScale === 1.0 || lastScaleWidthRef.current === 0 || widthChangedSignificantly;
        
        if (needsScaleRecalculation) {
          console.log('📐 Recalculating scale:', { 
            reason: baseScale === 1.0 ? 'baseScale is 1.0' : 
                    lastScaleWidthRef.current === 0 ? 'lastScaleWidth is 0' : 
                    'width changed significantly',
            lastWidth: lastScaleWidthRef.current,
            currentWidth: currentContainerWidth,
            baseScale
          });
          try {
            // INSTANT calculation - no delays, use available dimensions or fallback to typical scale
            if (cancelled) return;
            
            const firstPage = await pdfDocument.getPage(1);
            if (cancelled) return;
            
            const naturalViewport = firstPage.getViewport({ scale: 1.0, rotation });
            const pageWidth = naturalViewport.width;
            
            // Get container width - prefer actual container dimensions, then convert viewport units
            let containerWidth = 0;
            
            // First, try to get actual container dimensions (most accurate)
            if (previewAreaRef.current && previewAreaRef.current.clientWidth > 100) {
              containerWidth = previewAreaRef.current.clientWidth;
              console.log('📐 Using preview area width:', containerWidth);
            } else if (pdfWrapperRef.current && pdfWrapperRef.current.clientWidth > 100) {
              containerWidth = pdfWrapperRef.current.clientWidth;
              console.log('📐 Using wrapper width:', containerWidth);
            } else if (modalRef.current && modalRef.current.clientWidth > 100) {
              containerWidth = modalRef.current.clientWidth;
              console.log('📐 Using modal ref width:', containerWidth);
            }
            
            // If container not ready, try to use the modal width setting
            if (containerWidth <= 0) {
              if (typeof calculatedModalWidth === 'number' && calculatedModalWidth > 100) {
                containerWidth = calculatedModalWidth;
                console.log('📐 Using modal width setting (number):', containerWidth);
              } else if (typeof calculatedModalWidth === 'string') {
                // Handle viewport units (vw) and pixel units (px)
                if (calculatedModalWidth.endsWith('vw')) {
                  const vwValue = parseFloat(calculatedModalWidth);
                  containerWidth = Math.round((vwValue / 100) * window.innerWidth);
                  console.log('📐 Converted vw to pixels:', calculatedModalWidth, '->', containerWidth);
                } else if (calculatedModalWidth.endsWith('px')) {
                  containerWidth = parseInt(calculatedModalWidth);
                  console.log('📐 Parsed modal width from px string:', containerWidth);
                }
              }
            }
            
            console.log('📐 Scale calculation - container width:', containerWidth, 'page width:', pageWidth.toFixed(0));
            
            // Only calculate fit scale if container has valid width
            if (containerWidth > 100) {
              const fitScale = containerWidth / pageWidth;
              console.log('📐 Fit scale:', fitScale.toFixed(3), '(container:', containerWidth, 'page:', pageWidth.toFixed(0), ')');
              
              // Use the fit scale if it's reasonable (between 0.5 and 2.5 for better fit)
              // Lowered minimum from 0.8 to 0.5 to support smaller container widths
              if (fitScale >= 0.5 && fitScale <= 2.5) {
                scale = fitScale;
                // Update ref BEFORE setting state to prevent race condition
                lastScaleWidthRef.current = containerWidth;
                setBaseScale(fitScale); // Store base scale
                console.log('✅ Calculated and stored base scale:', fitScale.toFixed(3));
              } else {
                // If fit scale is too small (container very narrow), use the fitScale anyway
                // so pages actually fit the container - clamped to minimum 0.3 for readability
                if (fitScale < 0.5) {
                  // For narrow containers, scale down to fit rather than using fixed scale
                  scale = Math.max(0.3, fitScale);
                  lastScaleWidthRef.current = containerWidth;
                  setBaseScale(scale);
                  console.log('⚠️ Container narrow, using smaller scale:', scale.toFixed(3));
                } else {
                  scale = Math.min(2.0, fitScale);
                  lastScaleWidthRef.current = containerWidth;
                  setBaseScale(scale);
                  console.log('⚠️ Fit scale too large, clamped to:', scale.toFixed(3));
                }
              }
            } else {
              // Container not ready - use a reasonable default scale based on typical dimensions
              const typicalPageWidth = 595; // A4 width in points
              const typicalContainerWidth = 900; // Typical modal width
              scale = (typicalContainerWidth / typicalPageWidth) * 0.95;
              scale = Math.max(1.2, Math.min(1.8, scale)); // Clamp to reasonable range
              lastScaleWidthRef.current = 0; // Mark as not properly calculated
              setBaseScale(scale);
              console.log('⚠️ Container width not available:', containerWidth, 'using typical scale:', scale.toFixed(3));
          }
          } catch (error) {
            console.warn('⚠️ Failed to calculate fit scale, using default:', error);
            scale = 1.0;
            lastScaleWidthRef.current = 0; // Reset to indicate calculation failed
            setBaseScale(1.0);
          }
        } else {
          // Use stored base scale
          scale = baseScale;
        }
        
        setPdfPageRendering(true);
        console.log('📄 Rendering all PDF pages for continuous scrolling:', totalPages, 'pages at base scale', scale.toFixed(3));
        
        const newRenderedPages = new Map<number, { canvas: HTMLCanvasElement; dimensions: { width: number; height: number }; yOffset: number }>();
        const newPageOffsets = new Map<number, number>();
        let currentYOffset = 0;
        
        // Render all pages sequentially (can be optimized to parallel later)
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          if (cancelled) break;
          
          try {
            // OPTIMIZATION: Check cache first
            const cachedImageData = getCachedRenderedPage?.(file.id, pageNum);
            
            const page = await pdfDocument.getPage(pageNum);
            if (cancelled) break;
            
            const viewport = page.getViewport({ scale, rotation });
            
            // Create canvas for this page
            const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
            const context = canvas.getContext('2d');
            
            if (!context) continue;
            
            if (cachedImageData && scale === 1.0 && rotation === 0) {
              // Restore from cache
              context.putImageData(cachedImageData, 0, 0);
              console.log('⚡ [PAGE_CACHE] Restored cached page instantly:', file.id, 'page', pageNum);
            } else {
        // Render the page
              const renderTask = page.render({
          canvasContext: context,
          viewport,
          canvas
        } as any);
        
              renderTasks.set(pageNum, renderTask);
              
              await renderTask.promise;
              
              // Cache the rendered page
              if (file && scale === 1.0 && rotation === 0) {
                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                setCachedRenderedPage?.(file.id, pageNum, imageData);
              }
            }
            
            // Store page data
            newRenderedPages.set(pageNum, {
              canvas,
              dimensions: { width: viewport.width, height: viewport.height },
              yOffset: currentYOffset
            });
            
            newPageOffsets.set(pageNum, currentYOffset);
            
            // Update Y offset for next page (add small gap between pages)
            currentYOffset += viewport.height + 16; // 16px gap between pages
            
            console.log('📄 PDF page', pageNum, 'rendered successfully:', viewport.width, 'x', viewport.height, 'yOffset:', currentYOffset);
          } catch (error) {
            console.error(`❌ Failed to render PDF page ${pageNum}:`, error);
          }
        }
        
        if (!cancelled) {
          if (file?.id) lastRenderedFileIdRef.current = file.id;
          setRenderedPages(newRenderedPages);
          setPageOffsets(newPageOffsets);

          // Set dimensions for first page (for BBOX positioning reference)
          if (newRenderedPages.size > 0) {
            const firstPage = newRenderedPages.get(1);
            if (firstPage) {
              setPdfCanvasDimensions(firstPage.dimensions);
            }
          }

          setPdfPageRendering(false);
          // Mark dimensions as stable - PDF is now rendered at correct scale
          // This allows bbox auto-scroll to proceed with accurate coordinates
          setDimensionsStable(true);
          console.log('✅ All PDF pages rendered for continuous scrolling - dimensions stable');
        }
      } catch (error) {
        console.error('❌ Failed to render PDF pages:', error);
        setPdfPageRendering(false);
      }
    };
    
    renderAllPages();
    
    return () => {
      cancelled = true;
      // Cancel all render tasks
      renderTasks.forEach((task, pageNum) => {
        if (task && task.cancel) {
        try {
            task.cancel();
            console.log(`🛑 [PDF_RENDER] Cancelled render task for page ${pageNum}`);
        } catch (e) {
          // Ignore errors from cancellation
        }
      }
      });
    };
  }, [pdfDocument, totalPages, rotation, isOpen, file?.id, containerWidthForPdfRender, getCachedRenderedPage, setCachedRenderedPage, isResizing]);

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
      // Calculate zoom based on actual container width - typical Word doc is ~8.5" wide (816px at 96dpi)
      // Use actual modal width if available, otherwise use defaults
      let containerWidth: number;
      if (typeof calculatedModalWidth === 'number' && calculatedModalWidth > 100) {
        containerWidth = calculatedModalWidth;
      } else if (typeof calculatedModalWidth === 'string' && calculatedModalWidth.endsWith('px')) {
        containerWidth = parseInt(calculatedModalWidth);
      } else if (previewAreaRef.current && previewAreaRef.current.clientWidth > 100) {
        containerWidth = previewAreaRef.current.clientWidth;
      } else {
        containerWidth = isMapVisible ? 900 : 1100;
      }
      
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
  }, [isDOCX, docxPublicUrl, isMapVisible, calculatedModalWidth]);

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

  // Only hide PDF when the file changes (not on page nav). Avoids flicker when center-bbox or other effects re-run.
  const prevOpenFileIdRef = React.useRef<string>('');
  React.useEffect(() => {
    if (!isOpen) {
      prevOpenFileIdRef.current = '';
      return;
    }
    const fileId = file?.id ?? '';
    if (fileId !== prevOpenFileIdRef.current) {
      prevOpenFileIdRef.current = fileId;
      setScrollResetApplied(false);
    }
  }, [isOpen, file?.id]);

  // Reset scroll for PDFs when file changes and there is no highlight. With a highlight, only the center-bbox effect touches scroll.
  React.useEffect(() => {
    if (!isPDF || !isOpen) {
      requestAnimationFrame(() => setScrollResetApplied(true));
      return;
    }
    if (!expandedBbox && pdfWrapperRef.current) {
      pdfWrapperRef.current.scrollLeft = 0;
      pdfWrapperRef.current.scrollTop = 0;
      requestAnimationFrame(() => setScrollResetApplied(true));
    }
  }, [isPDF, isOpen, file?.id, expandedBbox]);

  // Single positioning rule: scroll so the bbox is vertically centered. Only apply when bbox position actually changes to avoid spazzing from effect re-runs.
  const lastCenterBboxRef = React.useRef<{ fileId: string; page: number; top: number; height: number } | null>(null);
  React.useEffect(() => {
    if (!isPDF || !isOpen || !expandedBbox || !pdfWrapperRef.current || !file?.id) return;
    if (!pageOffsets.size) return;
    const pageNum = expandedBbox.page;
    const pageData = renderedPages.get(pageNum);
    const pageOffset = pageOffsets.get(pageNum);
    if (pageData == null || pageOffset == null) {
      requestAnimationFrame(() => setScrollResetApplied(true));
      return;
    }
    const bboxKey = { fileId: file.id, page: pageNum, top: expandedBbox.top, height: expandedBbox.height };
    const prev = lastCenterBboxRef.current;
    const alreadyApplied = prev && prev.fileId === bboxKey.fileId && prev.page === bboxKey.page &&
      Math.abs(prev.top - bboxKey.top) < 1e-6 && Math.abs(prev.height - bboxKey.height) < 1e-6;
    if (alreadyApplied) return;
    lastCenterBboxRef.current = bboxKey;

    const wrapper = pdfWrapperRef.current;
    const viewportHeight = wrapper.clientHeight;
    const pageHeight = pageData.dimensions.height;
    const bboxCenterY = pageOffset + (expandedBbox.top + expandedBbox.height / 2) * pageHeight;
    const scrollTop = Math.max(0, bboxCenterY - viewportHeight / 2);
    const maxScrollTop = Math.max(0, wrapper.scrollHeight - viewportHeight);
    // Instant scroll when moving between citations (no animation)
    wrapper.scrollTo({ top: Math.min(scrollTop, maxScrollTop), left: 0, behavior: 'auto' });
    requestAnimationFrame(() => setScrollResetApplied(true));
  }, [isPDF, isOpen, file?.id, expandedBbox, pageOffsets, renderedPages]);

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
      
      // Pinch zoom is disabled - prevent zoom gestures (Ctrl/Cmd + wheel or trackpad pinch)
      const isZoomGesture = e.ctrlKey || e.metaKey;
      
      if (isZoomGesture) {
        // Block pinch-to-zoom entirely - prevent default without applying zoom
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return; // Don't apply zoom, just block the gesture
      } else if (isPDF && pdfWrapperRef.current) {
        // Always use native smooth scrolling for continuous scrolling mode
        // Only prevent pure horizontal scrolls to avoid browser navigation
        if (e.deltaX !== 0 && e.deltaY === 0) {
          // Pure horizontal scroll - prevent browser navigation
        e.preventDefault();
        e.stopPropagation();
          return;
        }
        // Vertical or diagonal scroll - allow native scrolling for smooth experience
      }
    };

    // Also prevent browser navigation gestures at document level when modal is open
    const preventBrowserNavigation = (e: WheelEvent) => {
      // Only prevent if event is within modal
      if (modalElement.contains(e.target as Node)) {
        // Only prevent pure horizontal scrolls (two-finger pan) to avoid browser navigation
        // Allow vertical scrolling to work natively for smooth experience
        if (e.deltaX !== 0 && e.deltaY === 0 && isPDF) {
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
        handleInstantClose();
      } else if (e.key === 'ArrowLeft' && file?.type === 'application/pdf') {
        setCurrentPage(prev => Math.max(1, prev - 1));
      } else if (e.key === 'ArrowRight' && file?.type === 'application/pdf') {
        setCurrentPage(prev => Math.min(totalPages, prev + 1));
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoomLevel(prev => Math.min(200, prev + 1)); // Reduced to 1% for much less sensitive zooming
      } else if (e.key === '-') {
        e.preventDefault();
        setZoomLevel(prev => Math.max(25, prev - 1)); // Reduced to 1% for much less sensitive zooming
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleInstantClose, file, totalPages]);

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

  // Quick zoom handler - jumps directly to preset zoom level
  const handleQuickZoom = (targetZoom: number) => {
    const newZoom = Math.max(25, Math.min(200, targetZoom));
    console.log('🔍 Quick Zoom:', {
      targetZoom: newZoom,
      fileType: file?.type,
      fileName: file?.name,
      isPDF,
      isImage,
      isDOCX
    });
    
    setZoomLevel(newZoom);
    
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
  };

  const handleZoomIn = () => {
    handleQuickZoom(zoomLevel + 10); // Increment by 10% for keyboard shortcuts
  };

  const handleZoomOut = () => {
    handleQuickZoom(zoomLevel - 10); // Decrement by 10% for keyboard shortcuts
  };

  const handlePreviousPage = () => {
    setCurrentPage(prev => {
      const newPage = Math.max(1, prev - 1);
      
      // For continuous scrolling PDFs, scroll to the page offset
      if (isPDF && pdfWrapperRef.current && pageOffsets.has(newPage)) {
        const pageOffset = pageOffsets.get(newPage);
        if (pageOffset !== undefined) {
          pdfWrapperRef.current.scrollTop = pageOffset;
        }
      } else if (isPDF && iframeRef.current && blobUrl) {
        // Fallback for non-continuous scrolling (iframe mode)
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
      
      // For continuous scrolling PDFs, scroll to the page offset
      if (isPDF && pdfWrapperRef.current && pageOffsets.has(newPage)) {
        const pageOffset = pageOffsets.get(newPage);
        if (pageOffset !== undefined) {
          pdfWrapperRef.current.scrollTop = pageOffset;
        }
      } else if (isPDF && iframeRef.current && blobUrl) {
        // Fallback for non-continuous scrolling (iframe mode)
        if (iframeRef.current instanceof HTMLObjectElement) {
          iframeRef.current.data = `${blobUrl}#page=${newPage}&zoom=page-fit&view=Fit`;
        } else if (iframeRef.current instanceof HTMLIFrameElement) {
          iframeRef.current.src = `${blobUrl}#page=${newPage}&zoom=page-fit&view=Fit`;
        }
      }
      return newPage;
    });
  };

  // New handler functions for redesigned UI
  const handleShare = () => {
    console.log('📤 Share clicked');
    // TODO: Implement share functionality
  };

  const handlePrint = () => {
    console.log('🖨️ Print clicked');
    if (window && blobUrl) {
      window.print();
    }
  };

  const handleMoreOptions = () => {
    console.log('⋯ More options clicked');
    // TODO: Implement more options dropdown menu
  };

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value) && value >= 1 && value <= totalPages) {
      setCurrentPage(value);
      // Scroll to page for continuous scrolling PDFs
      if (isPDF && pdfWrapperRef.current && pageOffsets.has(value)) {
        const pageOffset = pageOffsets.get(value);
        if (pageOffset !== undefined) {
          pdfWrapperRef.current.scrollTop = pageOffset;
        }
      }
    }
  };

  const handleFitToPage = () => {
    console.log('📐 Fit to page clicked');
    setZoomLevel(100);
    // For PDFs, reset to fit view
    if (isPDF && iframeRef.current && blobUrl) {
      const pdfUrl = `${blobUrl}#page=${currentPage}&zoom=page-fit&view=Fit`;
      if (iframeRef.current instanceof HTMLObjectElement) {
        iframeRef.current.data = pdfUrl;
      } else if (iframeRef.current instanceof HTMLIFrameElement) {
        iframeRef.current.src = pdfUrl;
      }
    }
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

  // When sidebar/chat widths change, only trigger PDF re-render when needed. Do NOT set
  // calculatedModalWidth/Height here — the modal is already constrained by CSS (maxWidth uses
  // sidebarWidth + chatPanelWidth). Let ResizeObserver be the single source for dimension updates
  // so we avoid a race on open (sidebar effect reading 0 or stale size and fighting with ResizeObserver).
  React.useEffect(() => {
    if (!isOpen || !isPDF) return;
    if (!previewAreaRef.current) return;
    const container = previewAreaRef.current;
    const currentWidth = container.clientWidth;
    if (currentWidth <= 100) return;
    const prevPdfWidth = lastContainerWidthForPdfRenderRef.current;
    const pdfWidthSignificant = prevPdfWidth === null || Math.abs(currentWidth - prevPdfWidth) > 50;
    if (pdfWidthSignificant) {
      queueMicrotask(() => {
        lastContainerWidthForPdfRenderRef.current = currentWidth;
        setContainerWidthForPdfRender(currentWidth);
        setBaseScale(1.0);
        lastScaleWidthRef.current = 0;
        setDimensionsStable(false);
      });
    }
  }, [sidebarWidth, chatPanelWidth, filingSidebarWidth, isOpen, isPDF]);

  // ResizeObserver to detect modal size changes; use 2px threshold to avoid render loops from subpixel jitter.
  // On first open the container is often 0x0 until layout completes - capture initial size after layout (double rAF).
  const RESIZE_THRESHOLD_PX = 2;
  React.useEffect(() => {
    if (!isOpen || !previewAreaRef.current) return;

    const container = previewAreaRef.current;
    let lastWidth = container.clientWidth;
    let lastHeight = container.clientHeight;

    const applySize = (width: number, height: number) => {
      if (width <= 100 || height <= 100) return;
      lastWidth = width;
      lastHeight = height;
      const prevPdfWidth = lastContainerWidthForPdfRenderRef.current;
      const pdfWidthSignificant = prevPdfWidth === null || Math.abs(width - prevPdfWidth) > 50;
      queueMicrotask(() => {
        // Do NOT set modal width/height from preview area size - that causes the modal to
        // jump/shrink on open (preview area is smaller than modal). Keep initial 67.5vw/82.5vh.
        if (isPDF && pdfWidthSignificant) {
          lastContainerWidthForPdfRenderRef.current = width;
          setContainerWidthForPdfRender(width);
          setBaseScale(1.0);
          lastScaleWidthRef.current = 0;
          setDimensionsStable(false);
        }
      });
    };

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width <= 100 || height <= 100) continue;
        const widthChanged = Math.abs(width - lastWidth) > RESIZE_THRESHOLD_PX;
        const heightChanged = Math.abs(height - lastHeight) > RESIZE_THRESHOLD_PX;
        if (widthChanged || heightChanged) applySize(width, height);
      }
    });
    ro.observe(container);

    // First open often has 0x0 until layout completes - capture after layout
    let cancelled = false;
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled || !previewAreaRef.current) return;
        const w = previewAreaRef.current.clientWidth;
        const h = previewAreaRef.current.clientHeight;
        if (w > 100 && h > 100) applySize(w, h);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      ro.disconnect();
    };
  }, [isOpen, isPDF, isDOCX, isImage]);

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
      // For non-map view, use centered modal dimensions
      if (!isMapVisible) {
        // Centered modal mode - set to 67.5vw and 82.5vh
        setCalculatedModalWidth('67.5vw');
        setCalculatedModalHeight('82.5vh');
        dimensionsCalculatedRef.current = true;
        return;
      }
      
      // Map view: calculate based on image dimensions
      const maxWidth = Math.min(window.innerWidth * 0.4, 600); // Max 40% viewport or 600px for map view
      const minWidth = 250; // Minimum width for usability
      
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

  // Ensure centered modal dimensions for non-map view when modal opens or file changes
  React.useEffect(() => {
    if (!isMapVisible && isOpen) {
      // Force centered modal dimensions for non-map view (65-70% width, 80-85% height)
      setCalculatedModalWidth('67.5vw');
      setCalculatedModalHeight('82.5vh');
    }
  }, [isMapVisible, isOpen, file?.id]);

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

      // Direct DOM manipulation for immediate visual feedback (instant)
      const modal = modalRef.current;
      if (modal) {
        modal.style.width = `${newWidth}px`;
        modal.style.height = `${newHeight}px`;
        
        if (isMapVisible && (newLeft !== undefined || newTop !== undefined)) {
          if (newLeft !== undefined) modal.style.left = `${newLeft}px`;
          if (newTop !== undefined) modal.style.top = `${newTop}px`;
        }
      }

      // Use flushSync for INSTANT synchronous state updates (bypasses React batching)
      flushSync(() => {
        setCalculatedModalWidth(newWidth);
        setCalculatedModalHeight(newHeight);
        
        // Force immediate PDF recalculation
        if (isPDF) {
          setBaseScale(1.0);
          lastScaleWidthRef.current = 0; // Reset width tracking to force recalculation
        }
        
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

      // Flush final resize IMMEDIATELY with flushSync (instant snap - like section opening)
      if (modalRef.current && resizeStateRef.current) {
        const rect = modalRef.current.getBoundingClientRect();
        // Use flushSync for instant synchronous updates (bypasses React batching)
        flushSync(() => {
          setCalculatedModalWidth(rect.width);
          setCalculatedModalHeight(rect.height);
          
          // Force immediate document recalculation - instant like section opening
          if (isPDF) {
            setBaseScale(1.0); // Reset to force recalculation
            lastScaleWidthRef.current = 0; // Reset width tracking to force recalculation
            setDimensionsStable(false); // Reset until PDF re-renders at final size
          }
        });
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
      style.textContent = ``; // Animation removed - BBOXs appear instantly
      document.head.appendChild(style);
    }
    return () => {
      // Don't remove style on unmount - it's shared
    };
  }, []);

  // Use portal to render outside of parent container to avoid transform issues
  const modalContent = (
    <AnimatePresence mode="sync">
      {isOpen && !isLocallyHidden && files.length > 0 && file && (
        <>
          {/* Backdrop - Dark Translucent Overlay - Always show for centered modal */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0 }}
            onClick={handleInstantClose}
            className="fixed inset-0 bg-black/75"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: '100vw',
              height: '100vh',
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              zIndex: 40
            }}
          />
          
          {/* Modal Content - Centered Dialog or Top-Left for Map View */}
          <motion.div
            data-document-preview-modal="true"
            layout={false}
            initial={{ 
              opacity: 1, 
              scale: 1, 
            }}
            animate={{ 
              opacity: 1, 
              scale: 1, 
            }}
            exit={{ 
              opacity: 0, 
              scale: 1, 
            }}
            transition={{ 
              duration: 0, // Instant - no animation for all properties
            }}
            style={{
              position: 'fixed',
              ...(isResizing ? { willChange: 'width, height, left, top' } : {}),
              // Always use centered positioning with overlay (not map view positioning)
              left: '50%', 
              top: '50%', 
              width: typeof modalWidth === 'number' ? `${modalWidth}px` : (typeof modalWidth === 'string' ? modalWidth : '67.5vw'), // 65-70% of viewport width (using 67.5% as middle)
              height: typeof modalHeight === 'number' ? `${modalHeight}px` : (typeof modalHeight === 'string' ? modalHeight : '82.5vh'), // 80-85% of viewport height (using 82.5% as middle)
              // Ensure modal adjusts instantly when ANY sidebar opens (viewport shrinks)
              // sidebarWidth already includes filing sidebar, so we use it directly
              maxWidth: `min(70vw, calc(100vw - ${sidebarWidth + chatPanelWidth}px - 32px))`, // Account for all sidebars + chat panel + padding, but cap at 70vw
              minWidth: isDOCX ? '640px' : '300px', // Minimum width
              maxHeight: '85vh', // Max 85% height
              boxSizing: 'border-box', // Ensure padding/borders don't expand width
              overflow: 'hidden', // Prevent content from expanding modal
              zIndex: 50,
              border: 'none',
              borderRadius: '16px', // Rounded corners like Prism
              transform: 'translate(-50%, -50%)', // Center the modal - apply directly in style
              // Prevent any visual transitions on dimensions - instant like section opening
              transition: 'none',
              transitionProperty: 'none',
              transitionDuration: '0s',
              transitionTimingFunction: 'none',
              // Resize cursor
              ...(isResizing ? { cursor: resizeDirection === 'se' ? 'nwse-resize' : resizeDirection === 'sw' ? 'nesw-resize' : resizeDirection === 'ne' ? 'nesw-resize' : resizeDirection === 'nw' ? 'nwse-resize' : resizeDirection === 'e' || resizeDirection === 'w' ? 'ew-resize' : resizeDirection === 'n' || resizeDirection === 's' ? 'ns-resize' : 'default' } : {})
            }}
            className={`flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden relative ${!isMapVisible ? 'modal-centered' : ''} ${isResizing ? 'select-none' : ''}`}
            onClick={(e) => e.stopPropagation()}
            ref={modalRef}
          >
            {/* Close button is now in the header - removed from here */}
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
            
            {/* Dark Header Bar - Document Name in Top Left, Action Icons on Right */}
            <div ref={headerRef} className="flex items-center justify-between px-4 py-3 bg-gray-900 shrink-0" style={{ height: '56px' }}>
              {/* Left Section - Document Name in Top Left Corner */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <button
                  onClick={handleInstantClose}
                  className="p-1.5 hover:bg-gray-800 rounded transition-colors flex-shrink-0"
                  title="Close"
                >
                  <X className="w-4 h-4 text-white" />
                </button>
                {isPDF && (
                  <FileText className="w-4 h-4 text-red-500 flex-shrink-0" />
                )}
                <h2 className="text-sm font-medium text-white truncate">
                  {file.name}
                </h2>
              </div>
              
              {/* Right Section - Action Icons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleShare}
                  className="p-1.5 hover:bg-gray-800 rounded transition-colors"
                  title="Share"
                >
                  <Share2 className="w-4 h-4 text-white" />
                </button>
                <button
                  onClick={handlePrint}
                  className="p-1.5 hover:bg-gray-800 rounded transition-colors"
                  title="Print"
                >
                  <Printer className="w-4 h-4 text-white" />
                </button>
                <button
                  onClick={handleDownload}
                  className="p-1.5 hover:bg-gray-800 rounded transition-colors"
                  title="Download"
                >
                  <Download className="w-4 h-4 text-white" />
                </button>
                <button
                  onClick={handleMoreOptions}
                  className="p-1.5 hover:bg-gray-800 rounded transition-colors"
                  title="More options"
                >
                  <MoreVertical className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>
            
            {/* Document Preview Area - Clean white background like browser */}
            <div 
              ref={previewAreaRef}
              className={isImage ? "overflow-hidden bg-white flex items-center justify-center" : isDOCX ? "flex-1 overflow-hidden bg-white flex items-center justify-center docx-scrollbar" : "flex-1 overflow-auto bg-white"}
              style={{
                ...(isImage ? { 
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
                  padding: '0',
                  boxSizing: 'border-box',
                  minHeight: 0, // Allow flex shrinking so inner overflow:auto can scroll
                }),
                // Instant transitions - no animation like section opening
                transition: 'none',
                transitionProperty: 'none',
                transitionDuration: '0s',
              }}
            >
              {blobUrl && (
                <>
                  {isPDF ? (
                    <div 
                      ref={pdfWrapperRef}
                      className="w-full h-full document-preview-scroll"
                      style={{
                        pointerEvents: scrollResetApplied ? 'auto' : 'none',
                        padding: '0',
                        margin: '0',
                        display: 'block',
                        position: 'relative',
                        height: '100%',
                        boxSizing: 'border-box',
                        overflow: 'auto',
                        WebkitOverflowScrolling: 'touch',
                        touchAction: 'pan-x pan-y',
                        scrollBehavior: 'auto',
                        overscrollBehavior: 'contain',
                        opacity: scrollResetApplied ? 1 : 0,
                        visibility: scrollResetApplied ? 'visible' : 'hidden',
                      }}
                    >
                      <div
                        ref={pdfPagesContainerRef}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          width: '100%',
                          position: 'relative',
                          transform: `scale(${zoomLevel / 100})`, // Use CSS transform scale - doesn't affect scroll position
                          transformOrigin: 'top center',
                          transition: 'none', // Instant transform changes - no animation
                          transitionProperty: 'none',
                          transitionDuration: '0s',
                          willChange: isResizing ? 'transform' : 'auto', // Optimize during resize
                        }}
                      >
                        {/* PDF.js Canvas-based rendering for continuous scrolling - always render all pages */}
                        {pdfDocument ? (
                          <>
                            {/* Render all pages in continuous scrollable view */}
                            {renderedPages.size > 0 && Array.from(renderedPages.entries()).map(([pageNum, pageData]) => {
                              const pageDimensions = pageData.dimensions;
                              const isHighlightPage = expandedBbox && expandedBbox.page === pageNum;
                              
                              // Keep pages at original dimensions - zoom is handled by CSS transform on container
                              // This way scroll position is independent of zoom (like PropertyDetailsPanel)
                              
                              return (
                                <div
                                  key={`page-${pageNum}`}
                              style={{
                                position: 'relative',
                                    width: `${pageDimensions.width}px`,
                                    margin: '0 auto 16px auto', // Center and add gap between pages
                                display: 'block'
                              }}
                            >
                              <canvas
                                    key={`canvas-page-${pageNum}`}
                                    ref={(el) => {
                                      if (el && pageData.canvas) {
                                        // Copy canvas content to the rendered canvas
                                        const ctx = el.getContext('2d');
                                        if (ctx) {
                                          el.width = pageData.canvas.width;
                                          el.height = pageData.canvas.height;
                                          ctx.drawImage(pageData.canvas, 0, 0);
                                        }
                                      }
                                    }}
                                style={{
                                  display: 'block',
                                  backgroundColor: '#fff',
                                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                                      width: `${pageDimensions.width}px`,
                                      height: `${pageDimensions.height}px`,
                                }}
                              />
                              
                                  {/* Highlight overlay - bbox at its actual position on the page (no transition when moving between citations) */}
                                  {isHighlightPage && expandedBbox && (
                                    <div
                                      style={{
                                        position: 'absolute',
                                        left: `${expandedBbox.left * 100}%`,
                                        top: `${expandedBbox.top * 100}%`,
                                        width: `${expandedBbox.width * 100}%`,
                                        height: `${expandedBbox.height * 100}%`,
                                        backgroundColor: 'rgba(188, 212, 235, 0.4)',
                                        border: 'none',
                                        borderRadius: '2px',
                                        pointerEvents: 'none',
                                        zIndex: 10,
                                        transition: 'none',
                                      }}
                                    />
                                  )}
                            </div>
                              );
                            })}
                            
                            {/* Debug overlay showing all chunk bboxes when enabled - render on each page */}
                            {showAllChunkBboxes && chunkOverlaysForAllPages.length > 0 && Array.from(renderedPages.entries()).map(([pageNum, pageData]) => {
                              const chunksForPage = chunkOverlaysForAllPages.filter(chunk => {
                                const bboxPage = chunk?.bbox?.page ?? chunk?.page_number ?? fileHighlight?.bbox?.page;
                                return bboxPage === pageNum;
                              });
                              
                              if (chunksForPage.length === 0) return null;
                              
                              return (
                              <div
                                  key={`debug-overlays-page-${pageNum}`}
                                style={{
                                  position: 'absolute',
                                    top: `${pageData.yOffset}px`,
                                  left: '50%',
                                    transform: 'translateX(-50%)',
                                    width: `${pageData.dimensions.width}px`,
                                    height: `${pageData.dimensions.height}px`,
                                    pointerEvents: 'none',
                                    zIndex: 9
                                  }}
                                >
                                  {chunksForPage.map((chunk, idx) => (
                              <div
                                      key={`debug-bbox-${chunk.chunk_index ?? idx}-page-${pageNum}`}
                                style={{
                                  position: 'absolute',
                                  left: `${(chunk.bbox!.left ?? 0) * 100}%`,
                                  top: `${(chunk.bbox!.top ?? 0) * 100}%`,
                                  width: `${(chunk.bbox!.width ?? 0) * 100}%`,
                                  height: `${(chunk.bbox!.height ?? 0) * 100}%`,
                                  border: 'none',
                                  backgroundImage: 'repeating-linear-gradient(90deg, rgba(71, 85, 105, 0.95) 0px, rgba(71, 85, 105, 0.95) 1.5px, rgba(33, 150, 243, 0.13) 1.5px, rgba(33, 150, 243, 0.13) 12px), repeating-linear-gradient(0deg, rgba(71, 85, 105, 0.95) 0px, rgba(71, 85, 105, 0.95) 1.5px, rgba(33, 150, 243, 0.13) 1.5px, rgba(33, 150, 243, 0.13) 12px), repeating-linear-gradient(90deg, rgba(71, 85, 105, 0.95) 0px, rgba(71, 85, 105, 0.95) 1.5px, rgba(33, 150, 243, 0.13) 1.5px, rgba(33, 150, 243, 0.13) 12px), repeating-linear-gradient(0deg, rgba(71, 85, 105, 0.95) 0px, rgba(71, 85, 105, 0.95) 1.5px, rgba(33, 150, 243, 0.13) 1.5px, rgba(33, 150, 243, 0.13) 12px)',
                                  backgroundSize: '12px 1.5px, 1.5px 12px, 12px 1.5px, 1.5px 12px',
                                  backgroundPosition: '0 0, 100% 0, 0 100%, 0 0',
                                  backgroundRepeat: 'repeat-x, repeat-y, repeat-x, repeat-y',
                                  backgroundColor: 'rgba(33, 150, 243, 0.13)',
                                  borderRadius: '2px',
                                  pointerEvents: 'none',
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
                                </div>
                              );
                            })}

                            {showAllChunkBboxes && chunkOverlaysForAllPages.length > 0 && (
                              <div
                                style={{
                                  position: 'fixed',
                                  top: '8px',
                                  right: '8px',
                                  padding: '4px 8px',
                                  backgroundColor: 'rgba(0,0,0,0.65)',
                                  color: '#fff',
                                  fontSize: '11px',
                                  borderRadius: '4px',
                                  zIndex: 10000,
                                }}
                              >
                                Debug overlays: {chunkOverlaysForAllPages.length} chunk{chunkOverlaysForAllPages.length === 1 ? '' : 's'} (Shift + D)
                              </div>
                            )}
                          </>
                        ) : (
                          /* Loading state while PDF.js loads */
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              height: '100%',
                              width: '100%',
                              backgroundColor: '#fff'
                            }}
                          >
                            <div
                              style={{
                                padding: '24px 48px',
                                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                                color: 'white',
                                borderRadius: '8px',
                                fontSize: '16px',
                                textAlign: 'center'
                              }}
                            >
                              <div style={{ marginBottom: '12px' }}>Loading document...</div>
                              <div style={{ fontSize: '14px', opacity: 0.8 }}>
                                Preparing PDF viewer
                              </div>
                            </div>
                          </div>
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
                        transition: rotation !== 0 ? 'transform 0.2s ease' : 'none', // Only animate rotation, not zoom (instant zoom for buttons)
                        display: 'block',
                        padding: '24px', // Padding around image preview for better spacing
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
                        <div className="w-5 h-5 border-2 border-neutral-200 border-t-neutral-800 rounded-full animate-spin mb-4"></div>
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
            
            {/* Dark Footer Bar - Page Navigation (Center) and Zoom Controls (Right) */}
            <div className="flex items-center justify-between px-4 py-3 bg-gray-900 shrink-0" style={{ height: '56px' }}>
              {/* Center Section - Page Navigation */}
              <div className="flex items-center gap-2 absolute left-1/2 transform -translate-x-1/2">
                <button
                  onClick={handlePreviousPage}
                  disabled={currentPage <= 1}
                  className="p-1.5 hover:bg-gray-800 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Previous page"
                >
                  <ChevronLeft className="w-4 h-4 text-white" />
                </button>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-white">Page</span>
                  <input
                    type="number"
                    min="1"
                    max={totalPages}
                    value={currentPage}
                    onChange={handlePageInputChange}
                    className="w-12 px-2 py-1 text-sm text-white bg-gray-800 border border-gray-700 rounded text-center focus:outline-none focus:border-gray-600"
                    style={{ color: 'white' }}
                  />
                  <span className="text-sm text-white">/</span>
                  <span className="text-sm text-white">{totalPages}</span>
                </div>
                <button
                  onClick={handleNextPage}
                  disabled={currentPage >= totalPages}
                  className="p-1.5 hover:bg-gray-800 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Next page"
                >
                  <ChevronRight className="w-4 h-4 text-white" />
                </button>
              </div>
              
              {/* Right Side - Quick Zoom Dropdown */}
              <div className="relative ml-auto">
                <select
                  value={(() => {
                    const presets = [50, 75, 100, 125, 150, 200];
                    const closest = presets.find(p => zoomLevel === p);
                    return closest !== undefined ? closest.toString() : 'fit';
                  })()}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === 'fit') {
                      handleFitToPage();
                    } else {
                      handleQuickZoom(parseInt(value, 10));
                    }
                  }}
                  className="appearance-none pl-2.5 pr-7 py-1.5 text-xs font-medium bg-gray-800/50 text-gray-300 hover:bg-gray-800 hover:text-white rounded transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-gray-600 border-none"
                  style={{ minWidth: '70px' }}
                >
                  <option value="50">50%</option>
                  <option value="75">75%</option>
                  <option value="100">100%</option>
                  <option value="125">125%</option>
                  <option value="150">150%</option>
                  <option value="200">200%</option>
                  <option value="fit">Fit</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
              </div>
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


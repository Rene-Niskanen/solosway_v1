"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Maximize, Maximize2, Minimize2, ZoomIn, ZoomOut, ChevronDown, Download } from 'lucide-react';
import { usePreview } from '../contexts/PreviewContext';
import { backendApi } from '../services/backendApi';
import { useFilingSidebar } from '../contexts/FilingSidebarContext';
import { useChatPanel } from '../contexts/ChatPanelContext';
import { CitationActionMenu } from './CitationActionMenu';
import { useActiveChatState } from '../contexts/ChatStateStore';
import type { CitationData } from '../contexts/ChatStateStore';
import { CHAT_PANEL_WIDTH } from './SideChatPanel';
import veloraLogo from '/Velora Logo.jpg';

// PDF.js for canvas-based PDF rendering
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface StandaloneExpandedCardViewProps {
  docId: string;
  filename: string;
  highlight?: { 
    fileId: string; 
    bbox: { left: number; top: number; width: number; height: number; page: number };
    // Full citation metadata for CitationActionMenu
    doc_id?: string;
    block_id?: string;
    block_content?: string;
    original_filename?: string;
  };
  onClose: () => void;
  chatPanelWidth?: number; // Width of the chat panel (0 when closed)
  sidebarWidth?: number; // Width of the sidebar
  onResizeStart?: (e: React.MouseEvent) => void; // Callback when left edge drag starts
  isResizing?: boolean; // Whether resize is in progress (for cursor styling)
}

export const StandaloneExpandedCardView: React.FC<StandaloneExpandedCardViewProps> = ({
  docId,
  filename,
  highlight,
  onClose,
  chatPanelWidth = 0,
  sidebarWidth = 56,
  onResizeStart,
  isResizing = false
}) => {
  // Local state for instant close - hides component immediately before parent state updates
  const [isLocallyHidden, setIsLocallyHidden] = useState(false);
  
  // Track when resize ends to prevent accidental close on drag release
  const lastResizeEndTimeRef = useRef<number>(0);
  
  // Update last resize end time when isResizing changes from true to false
  const wasResizingRef = useRef(false);
  useEffect(() => {
    if (wasResizingRef.current && !isResizing) {
      // Resize just ended - record the time
      lastResizeEndTimeRef.current = Date.now();
    }
    wasResizingRef.current = isResizing;
  }, [isResizing]);
  
  // Reset isLocallyHidden when docId changes (new document opened)
  useEffect(() => {
    setIsLocallyHidden(false);
  }, [docId]);
  
  // Instant close handler - hides immediately, then notifies parent
  const handleInstantClose = useCallback(() => {
    setIsLocallyHidden(true); // Hide immediately (local re-render returns null)
    onClose(); // Notify parent synchronously - React batches state updates
  }, [onClose]);
  
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [blobType, setBlobType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Start with filename prop, but always fetch the real name from backend
  // If the filename is a generic fallback like "document.pdf", don't use it - wait for the real name
  const [displayFilename, setDisplayFilename] = useState<string>(
    filename && filename !== 'document.pdf' ? filename : 'Document'
  );
  
  // PDF.js state
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [renderedPages, setRenderedPages] = useState<Map<number, { canvas: HTMLCanvasElement; dimensions: { width: number; height: number } }>>(new Map());
  const [baseScale, setBaseScale] = useState<number>(1.0);
  const [visualScale, setVisualScale] = useState<number>(1.0); // CSS transform scale for immediate visual feedback
  const [totalPages, setTotalPages] = useState<number>(0);
  const [manualZoom, setManualZoom] = useState<number | null>(null); // Manual zoom level set by user (null = auto)
  const [isZooming, setIsZooming] = useState<boolean>(false); // Track if zoom is being adjusted
  const zoomTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Timeout to re-enable BBOX after zoom stops
  const renderTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Timeout to debounce re-renders during zoom
  const pdfPagesContainerRef = useRef<HTMLDivElement>(null);
  const pdfWrapperRef = useRef<HTMLDivElement>(null);
  // Refs for smooth pinch-to-zoom (direct DOM manipulation, no React state during gesture)
  const currentZoomRef = useRef<number>(1.0); // Current zoom level during gesture
  const isGestureActiveRef = useRef<boolean>(false); // Track if gesture is in progress
  const hasRenderedRef = useRef<boolean>(false);
  const currentDocIdRefForPdf = useRef<string | null>(null);
  const prevScaleRef = useRef<number>(1.0); // Track previous scale for scroll position preservation
  const targetScaleRef = useRef<number>(1.0); // Track target scale for smooth transitions
  const firstPageCacheRef = useRef<{ page: any; viewport: any } | null>(null); // Cache first page for instant scale calculation
  const wasFullscreenRef = useRef<boolean>(false); // Track previous fullscreen state for zoom reset
  
  // Citation action menu state
  const [citationMenuPosition, setCitationMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<any>(null);

  // Build a stable key for the current highlight target (doc + page + bbox coords).
  // Used to coordinate one-time "jump to bbox" with resize scroll-preservation logic.
  const getHighlightKey = useCallback(() => {
    if (!highlight || highlight.fileId !== docId || !highlight.bbox) return null;
    const b = highlight.bbox;
    return `${docId}:${b.page}:${b.left.toFixed(4)}:${b.top.toFixed(4)}:${b.width.toFixed(4)}:${b.height.toFixed(4)}`;
  }, [highlight, docId]);
  
  const { previewFiles, getCachedPdfDocument, setCachedPdfDocument, getCachedRenderedPage, setCachedRenderedPage, isAgentOpening, setIsAgentOpening, openExpandedCardView } = usePreview();
  const { isOpen: isFilingSidebarOpen, width: filingSidebarWidth, isResizing: isFilingSidebarResizing } = useFilingSidebar();
  const { isOpen: isChatHistoryPanelOpen, width: chatHistoryPanelWidth } = useChatPanel();
  
  // Get active chat state to access citations
  const activeChatState = useActiveChatState();
  
  // Collect and sort citations for the current document
  const { sortedCitations, currentCitationIndex, hasMultipleCitations } = useMemo(() => {
    if (!activeChatState || !highlight) {
      return { sortedCitations: [], currentCitationIndex: -1, hasMultipleCitations: false };
    }
    
    // Collect citations from streaming state
    const streamingCitations = Object.values(activeChatState.streaming.citations || {});
    
    // Collect citations from messages
    const messageCitations: CitationData[] = [];
    activeChatState.messages.forEach(msg => {
      if (msg.citations) {
        messageCitations.push(...Object.values(msg.citations));
      }
    });
    
    // Combine all citations
    const allCitations = [...streamingCitations, ...messageCitations];
    
    // Filter citations for the current document
    const documentCitations = allCitations.filter(citation => 
      citation.doc_id === docId || citation.doc_id === highlight.fileId
    );
    
    // Remove duplicates based on bbox coordinates
    const uniqueCitations = documentCitations.filter((citation, index, self) => 
      index === self.findIndex(c => 
        c.doc_id === citation.doc_id &&
        c.bbox?.page === citation.bbox?.page &&
        Math.abs((c.bbox?.left || 0) - (citation.bbox?.left || 0)) < 0.001 &&
        Math.abs((c.bbox?.top || 0) - (citation.bbox?.top || 0)) < 0.001
      )
    );
    
    // Sort citations by page number, then by position (top to bottom, left to right)
    const sorted = uniqueCitations.sort((a, b) => {
      const pageA = a.page || a.bbox?.page || a.page_number || 0;
      const pageB = b.page || b.bbox?.page || b.page_number || 0;
      
      if (pageA !== pageB) {
        return pageA - pageB;
      }
      
      // Same page - sort by top position, then left position
      const topA = a.bbox?.top || 0;
      const topB = b.bbox?.top || 0;
      if (Math.abs(topA - topB) > 0.001) {
        return topA - topB;
      }
      
      const leftA = a.bbox?.left || 0;
      const leftB = b.bbox?.left || 0;
      return leftA - leftB;
    });
    
    // Find current citation index
    let currentIndex = -1;
    if (highlight && highlight.bbox) {
      currentIndex = sorted.findIndex(citation => {
        const citationPage = citation.page || citation.bbox?.page || citation.page_number || 0;
        const citationTop = citation.bbox?.top || 0;
        const citationLeft = citation.bbox?.left || 0;
        
        return (
          citationPage === highlight.bbox.page &&
          Math.abs(citationTop - highlight.bbox.top) < 0.001 &&
          Math.abs(citationLeft - highlight.bbox.left) < 0.001
        );
      });
    }
    
    // If current citation not found, try to match by page only (in case bbox coordinates differ slightly)
    if (currentIndex === -1 && highlight && highlight.bbox) {
      currentIndex = sorted.findIndex(citation => {
        const citationPage = citation.page || citation.bbox?.page || citation.page_number || 0;
        return citationPage === highlight.bbox.page;
      });
    }
    
    return {
      sortedCitations: sorted,
      currentCitationIndex: currentIndex >= 0 ? currentIndex : 0,
      hasMultipleCitations: sorted.length > 1
    };
  }, [activeChatState, docId, highlight]);
  
  // Navigate to next citation
  const handleReviewNextCitation = useCallback(() => {
    if (!hasMultipleCitations || sortedCitations.length === 0) return;
    
    // Calculate next citation index (wrap around if at end)
    const nextIndex = (currentCitationIndex + 1) % sortedCitations.length;
    const nextCitation = sortedCitations[nextIndex];
    
    if (!nextCitation || !nextCitation.bbox) return;
    
    // Convert CitationData to CitationHighlight format
    const pageNumber = nextCitation.page || nextCitation.bbox?.page || nextCitation.page_number || 1;
    const highlightData = {
      fileId: nextCitation.doc_id || docId,
      bbox: {
        left: nextCitation.bbox.left,
        top: nextCitation.bbox.top,
        width: nextCitation.bbox.width,
        height: nextCitation.bbox.height,
        page: pageNumber
      },
      doc_id: nextCitation.doc_id,
      block_id: nextCitation.block_id,
      block_content: nextCitation.matched_chunk_metadata?.content || '',
      original_filename: nextCitation.original_filename || filename
    };
    
    // Navigate to next citation
    openExpandedCardView(
      nextCitation.doc_id || docId,
      nextCitation.original_filename || filename,
      highlightData,
      false // Not agent-triggered
    );
  }, [hasMultipleCitations, sortedCitations, currentCitationIndex, docId, filename, openExpandedCardView]);

  // Fetch document metadata to get the real filename
  useEffect(() => {
    const fetchDocumentMetadata = async () => {
      try {
        const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
        const response = await fetch(`${backendUrl}/api/documents/${docId}`, {
          credentials: 'include'
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.original_filename) {
            setDisplayFilename(data.original_filename);
          }
        }
      } catch (error) {
        console.error('Failed to fetch document metadata:', error);
      }
    };
    
    fetchDocumentMetadata();
  }, [docId]);

  // AGENT GLOW: Turn off glow effect when document finishes loading
  useEffect(() => {
    if (!loading && isAgentOpening) {
      // Small delay to ensure the document is visually rendered before removing glow
      const timer = setTimeout(() => {
        setIsAgentOpening(false);
      }, 500); // 500ms delay for smooth visual transition
      
      return () => clearTimeout(timer);
    }
  }, [loading, isAgentOpening, setIsAgentOpening]);

  // Load document
  useEffect(() => {
    const loadDocument = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Check cache first
        const cachedBlob = (window as any).__preloadedDocumentBlobs?.[docId];
        if (cachedBlob && cachedBlob.url) {
          setPreviewUrl(cachedBlob.url);
          setBlobType(cachedBlob.type);
          // Update filename from cache if available
          if (cachedBlob.filename && cachedBlob.filename !== 'document.pdf') {
            setDisplayFilename(cachedBlob.filename);
          }
          setLoading(false);
          return;
        }

        // Reuse PreviewContext preloaded File (from citation preloading) to avoid a second download.
        const cachedFileEntry = previewFiles.find(f => f.id === docId);
        if (cachedFileEntry?.file) {
          const url = URL.createObjectURL(cachedFileEntry.file);
          const type = cachedFileEntry.type || cachedFileEntry.file.type || 'application/pdf';
          
          // Update filename from cached file if available
          if (cachedFileEntry.name && cachedFileEntry.name !== 'document.pdf') {
            setDisplayFilename(cachedFileEntry.name);
          }
          
          if (!(window as any).__preloadedDocumentBlobs) {
            (window as any).__preloadedDocumentBlobs = {};
          }
          (window as any).__preloadedDocumentBlobs[docId] = { 
            url, 
            type, 
            filename: cachedFileEntry.name || displayFilename,
            timestamp: Date.now() 
          };
          
          setPreviewUrl(url);
          setBlobType(type);
          setLoading(false);
          return;
        }
        
        // Download document
        const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
        const downloadUrl = `${backendUrl}/api/files/download?document_id=${docId}`;
        
        const response = await fetch(downloadUrl, {
          credentials: 'include'
        });
        
        if (!response.ok) {
          throw new Error(`Failed to load: ${response.status}`);
        }
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        // Try to extract filename from response headers or use current displayFilename
        const contentDisposition = response.headers.get('Content-Disposition');
        let extractedFilename = displayFilename;
        if (contentDisposition) {
          // Try to match filename=value (with optional quotes)
          // Also handle filename*=UTF-8''encoded format
          let filenameMatch = contentDisposition.match(/filename\*?=['"]?([^'";\n]+)['"]?/i);
          if (!filenameMatch) {
            // Try alternative format: filename="value"
            filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
          }
          if (filenameMatch && filenameMatch[1]) {
            extractedFilename = filenameMatch[1].replace(/['"]/g, '');
            // Decode URL-encoded filename (handles UTF-8 encoded filenames)
            try {
              extractedFilename = decodeURIComponent(extractedFilename);
            } catch (e) {
              // If decoding fails, use as-is
            }
          }
        }
        
        // Cache it
        if (!(window as any).__preloadedDocumentBlobs) {
          (window as any).__preloadedDocumentBlobs = {};
        }
        (window as any).__preloadedDocumentBlobs[docId] = {
          url: url,
          type: blob.type,
          filename: extractedFilename,
          timestamp: Date.now()
        };
        
        // Update display filename if we extracted one from Content-Disposition
        if (extractedFilename && extractedFilename !== 'document.pdf') {
          setDisplayFilename(extractedFilename);
        }
        // If still no filename, fetch from metadata API
        if (!extractedFilename || extractedFilename === 'document.pdf') {
          try {
            const metadataResponse = await fetch(`${backendUrl}/api/documents/${docId}`, {
              credentials: 'include'
            });
            if (metadataResponse.ok) {
              const data = await metadataResponse.json();
              if (data.original_filename) {
                setDisplayFilename(data.original_filename);
              }
            }
          } catch (e) {
            console.error('Failed to fetch document metadata for filename:', e);
          }
        }
        
        setPreviewUrl(url);
        setBlobType(blob.type);
        setLoading(false);
      } catch (err: any) {
        console.error('Failed to load document:', err);
        setError(err.message || 'Failed to load document');
        setLoading(false);
      }
    };
    
    loadDocument();
  }, [docId, previewFiles]);

  // Load PDF with PDF.js and cache first page for instant scale calculation
  useEffect(() => {
    if (!previewUrl || blobType !== 'application/pdf' || pdfDocument) return;
    
    const loadPdf = async () => {
      try {
        // Check cache
        const cachedPdf = getCachedPdfDocument?.(docId);
        if (cachedPdf) {
          setPdfDocument(cachedPdf);
          setTotalPages(cachedPdf.numPages);
          // Cache first page for instant scale calculation
          const firstPage = await cachedPdf.getPage(1);
          const naturalViewport = firstPage.getViewport({ scale: 1.0 });
          firstPageCacheRef.current = { page: firstPage, viewport: naturalViewport };
          return;
        }
        
        const loadingTask = pdfjs.getDocument({ url: previewUrl }).promise;
        const pdf = await loadingTask;
        
        setCachedPdfDocument?.(docId, pdf);
        setPdfDocument(pdf);
        setTotalPages(pdf.numPages);
        
        // Cache first page immediately for instant scale calculation
        const firstPage = await pdf.getPage(1);
        const naturalViewport = firstPage.getViewport({ scale: 1.0 });
        firstPageCacheRef.current = { page: firstPage, viewport: naturalViewport };
      } catch (error) {
        console.error('Failed to load PDF:', error);
      }
    };
    
    loadPdf();
  }, [previewUrl, blobType, docId, getCachedPdfDocument, setCachedPdfDocument, pdfDocument]);

  // Track container width for responsive zoom
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const prevContainerWidthRef = useRef<number>(0);
  const isRecalculatingRef = useRef<boolean>(false);

  // Calculate target scale immediately for real-time visual feedback
  // Uses cached first page for instant calculation (no async delay)
  const calculateTargetScale = useCallback((containerWidth: number) => {
    if (!pdfDocument || containerWidth <= 50) return null;
    
    // If user has set manual zoom, use that instead of auto-calculating
    if (manualZoom !== null) {
      return manualZoom;
    }
    
    try {
      // Use cached first page if available for instant calculation
      let pageWidth: number;
      if (firstPageCacheRef.current) {
        pageWidth = firstPageCacheRef.current.viewport.width;
      } else {
        // Fallback: calculate synchronously if possible, or return null to trigger async
        // This should rarely happen as we cache it after first load
        return null;
      }
      
      const availableWidth = containerWidth - 128; // Account for padding (64px on each side)
      
      // In fullscreen mode, use fixed 100% (1.0x) zoom as starting level
      if (isFullscreen) {
        return 1.0; // 100% starting zoom for fullscreen mode
      } else {
        // Normal mode: scale to fit available width (no cap - allow zooming beyond 100%)
        const fitScale = (availableWidth / pageWidth) * 0.98;
        // Only enforce a minimum scale to prevent documents from being too small
        if (fitScale >= 0.3) {
          return fitScale;
        } else {
          return Math.max(0.25, fitScale);
        }
      }
    } catch (error) {
      console.error('Failed to calculate target scale:', error);
      return null;
    }
  }, [pdfDocument, isFullscreen, manualZoom]);

  // Helper to manage zoom state and BBOX visibility
  const handleZoomStart = useCallback(() => {
    setIsZooming(true);
    // Clear any existing timeout
    if (zoomTimeoutRef.current) {
      clearTimeout(zoomTimeoutRef.current);
    }
  }, []);

  const handleZoomEnd = useCallback(() => {
    // Set timeout to re-enable BBOX after 1 second of no zoom activity
    if (zoomTimeoutRef.current) {
      clearTimeout(zoomTimeoutRef.current);
    }
    zoomTimeoutRef.current = setTimeout(() => {
      setIsZooming(false);
      zoomTimeoutRef.current = null;
    }, 1000);
  }, []);

  // Quick zoom handler - jumps directly to preset zoom level (scale factor)
  const handleQuickZoom = useCallback((targetPercentage: number) => {
    handleZoomStart();
    const targetScale = targetPercentage / 100; // Convert percentage to scale (e.g., 150% = 1.5)
    const newZoom = Math.max(0.25, Math.min(3.0, targetScale));
    setManualZoom(newZoom);
    // Trigger re-render with new scale - PDF.js will use it in getViewport({ scale: newZoom })
    setBaseScale(1.0); // Reset trigger to force recalculation
    hasRenderedRef.current = false;
    // Re-enable BBOX instantly for button clicks (not trackpad zoom)
    if (zoomTimeoutRef.current) {
      clearTimeout(zoomTimeoutRef.current);
      zoomTimeoutRef.current = null;
    }
    setIsZooming(false);
  }, [handleZoomStart]);

  // Zoom handlers - use PDF.js native zoom by directly updating scale in getViewport
  const handleZoomIn = useCallback(() => {
    const currentScale = manualZoom !== null ? manualZoom : (baseScale || 1.0);
    const currentPercentage = Math.round(currentScale * 100);
    // Find next preset level above current
    const presets = [50, 75, 100, 125, 150, 200];
    const nextPreset = presets.find(p => p > currentPercentage) || 200;
    handleQuickZoom(nextPreset);
  }, [manualZoom, baseScale, handleQuickZoom]);

  const handleZoomOut = useCallback(() => {
    const currentScale = manualZoom !== null ? manualZoom : (baseScale || 1.0);
    const currentPercentage = Math.round(currentScale * 100);
    // Find next preset level below current
    const presets = [50, 75, 100, 125, 150, 200];
    const prevPreset = [...presets].reverse().find(p => p < currentPercentage) || 50;
    handleQuickZoom(prevPreset);
  }, [manualZoom, baseScale, handleQuickZoom]);

  const handleZoomReset = useCallback(() => {
    handleZoomStart();
    setManualZoom(null); // Reset to auto-zoom
    setBaseScale(1.0); // Trigger recalculation
    hasRenderedRef.current = false;
    // Re-enable BBOX instantly for button clicks (not trackpad zoom)
    if (zoomTimeoutRef.current) {
      clearTimeout(zoomTimeoutRef.current);
      zoomTimeoutRef.current = null;
    }
    setIsZooming(false);
  }, [handleZoomStart]);

  // Trackpad pinch-to-zoom and mouse wheel zoom support
  // Uses direct DOM manipulation for smooth 60fps performance (no React state during gesture)
  useEffect(() => {
    if (!pdfWrapperRef.current) return;

    let rafId: number | null = null;
    let accumulatedDelta = 0;
    let gestureRenderTimeout: NodeJS.Timeout | null = null;
    let gestureEndTimeout: NodeJS.Timeout | null = null;

    // Initialize zoom ref from current state
    currentZoomRef.current = manualZoom !== null ? manualZoom : (baseScale || 1.0);

    // Apply CSS transform directly to DOM (no React state = no re-renders = smooth 60fps)
    const applyTransformDirectly = (scale: number) => {
      const container = pdfPagesContainerRef.current;
      if (container) {
        const transformScale = scale / (baseScale || 1.0);
        container.style.transform = `scale(${transformScale})`;
        container.style.transformOrigin = 'top center';
      }
    };

    const applyZoomUpdate = () => {
      if (accumulatedDelta === 0) {
        rafId = null;
        return;
      }

      // Mark gesture as active (using ref, not state)
      if (!isGestureActiveRef.current) {
        isGestureActiveRef.current = true;
        setIsZooming(true); // Single state update at gesture start
      }

      // Clear any existing timeouts
      if (gestureRenderTimeout) clearTimeout(gestureRenderTimeout);
      if (gestureEndTimeout) clearTimeout(gestureEndTimeout);

      // Calculate new zoom level
      const zoomChangePercent = accumulatedDelta * 0.0015; // Slightly increased sensitivity
      const zoomChange = currentZoomRef.current * zoomChangePercent;
      const newZoom = Math.max(0.25, Math.min(3.0, currentZoomRef.current + zoomChange));
      currentZoomRef.current = newZoom;
      
      // Apply CSS transform directly to DOM (instant, no React re-render)
      applyTransformDirectly(newZoom);
      
      accumulatedDelta = 0;
      rafId = null;

      // Debounce the expensive PDF re-render until gesture stops
      gestureRenderTimeout = setTimeout(() => {
        // Update React state and trigger high-quality re-render
        setManualZoom(currentZoomRef.current);
        setVisualScale(currentZoomRef.current);
        setBaseScale(1.0);
        hasRenderedRef.current = false;
        
        // Reset transform after re-render (pages now rendered at correct scale)
        setTimeout(() => {
          const container = pdfPagesContainerRef.current;
          if (container) {
            container.style.transform = 'none';
          }
        }, 50);
      }, 250);

      // Mark gesture as ended after inactivity
      gestureEndTimeout = setTimeout(() => {
        isGestureActiveRef.current = false;
        setIsZooming(false);
      }, 400);
    };

    const handleWheel = (e: WheelEvent) => {
      // Handle zoom with Cmd/Ctrl key OR trackpad pinch gesture
      const isModifierZoom = e.metaKey || e.ctrlKey;
      
      if (isModifierZoom) {
        e.preventDefault();
        e.stopPropagation();
        
        // Accumulate delta (invert: positive deltaY = zoom out)
        accumulatedDelta -= e.deltaY;
        
        // Schedule update via RAF for smooth 60fps
        if (rafId === null) {
          rafId = requestAnimationFrame(applyZoomUpdate);
        }
      }
    };

    const container = pdfWrapperRef.current;
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (gestureRenderTimeout) clearTimeout(gestureRenderTimeout);
      if (gestureEndTimeout) clearTimeout(gestureEndTimeout);
    };
  }, [manualZoom, baseScale]);

  // Touch screen pinch-to-zoom support (direct DOM manipulation for smooth performance)
  useEffect(() => {
    if (!pdfWrapperRef.current) return;

    let initialDistance = 0;
    let initialScale = 1.0;
    let isPinching = false;
    let gestureRenderTimeout: NodeJS.Timeout | null = null;

    // Initialize zoom ref
    currentZoomRef.current = manualZoom !== null ? manualZoom : (baseScale || 1.0);

    const getDistance = (touch1: Touch, touch2: Touch): number => {
      const dx = touch1.clientX - touch2.clientX;
      const dy = touch1.clientY - touch2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    // Apply CSS transform directly to DOM
    const applyTransformDirectly = (scale: number) => {
      const container = pdfPagesContainerRef.current;
      if (container) {
        const transformScale = scale / (baseScale || 1.0);
        container.style.transform = `scale(${transformScale})`;
        container.style.transformOrigin = 'top center';
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        isPinching = true;
        isGestureActiveRef.current = true;
        initialDistance = getDistance(e.touches[0], e.touches[1]);
        initialScale = currentZoomRef.current;
        setIsZooming(true); // Single state update at gesture start
        e.preventDefault();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPinching || e.touches.length !== 2) return;
      
      e.preventDefault();
      
      const currentDistance = getDistance(e.touches[0], e.touches[1]);
      const scaleFactor = currentDistance / initialDistance;
      const newZoom = Math.max(0.25, Math.min(3.0, initialScale * scaleFactor));
      currentZoomRef.current = newZoom;
      
      // Apply CSS transform directly (no React state = smooth 60fps)
      applyTransformDirectly(newZoom);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (isPinching && e.touches.length < 2) {
        isPinching = false;
        
        // Clear any pending timeout
        if (gestureRenderTimeout) clearTimeout(gestureRenderTimeout);
        
        // Debounce the high-quality re-render
        gestureRenderTimeout = setTimeout(() => {
          // Update React state with final zoom level
          setManualZoom(currentZoomRef.current);
          setVisualScale(currentZoomRef.current);
          setBaseScale(1.0);
          hasRenderedRef.current = false;
          
          // Reset transform after re-render
          setTimeout(() => {
            const container = pdfPagesContainerRef.current;
            if (container) {
              container.style.transform = 'none';
            }
            isGestureActiveRef.current = false;
            setIsZooming(false);
          }, 100);
        }, 150);
      }
    };

    const container = pdfWrapperRef.current;
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      if (gestureRenderTimeout) clearTimeout(gestureRenderTimeout);
    };
  }, [manualZoom, baseScale]);

  // Reset manual zoom only when exiting fullscreen (not when entering)
  // Don't reset when entering fullscreen - preserve user's zoom preference
  useEffect(() => {
    // Only reset when transitioning from fullscreen to non-fullscreen
    if (wasFullscreenRef.current && !isFullscreen) {
      // Exiting fullscreen - reset manual zoom
      setManualZoom(null);
    }
    wasFullscreenRef.current = isFullscreen;
  }, [isFullscreen]);

  useEffect(() => {
    setManualZoom(null); // Reset when document changes
  }, [docId]);

  // Force recalculation when positioning changes (filing sidebar, chat panel)
  // This ensures zoom updates even when container width doesn't change but available space does
  // BUT: Skip recalculation if user has set manual zoom (don't override user's choice)
  useEffect(() => {
    if (pdfDocument && totalPages > 0 && manualZoom === null) {
      // Only recalculate if manual zoom is not set
      // Immediate synchronous update - no RAF delay
      if (pdfWrapperRef.current) {
        const currentWidth = pdfWrapperRef.current.clientWidth;
        if (currentWidth > 50) {
          // Calculate and apply visual scale immediately (synchronous)
          const targetScale = calculateTargetScale(currentWidth);
          if (targetScale !== null) {
            // Update visual scale - don't adjust scroll here
            setVisualScale(targetScale);
            targetScaleRef.current = targetScale;
          }
          
          // Always trigger recalculation when positioning changes
          // Scroll will be preserved after re-render completes
          prevContainerWidthRef.current = currentWidth;
          setContainerWidth(currentWidth);
          
          // Trigger immediately - no delay
          setBaseScale(1.0);
          hasRenderedRef.current = false;
        }
      }
      
      // No cleanup needed - synchronous updates
    }
  }, [isFilingSidebarOpen, filingSidebarWidth, chatPanelWidth, pdfDocument, totalPages, calculateTargetScale, manualZoom]);

  // Watch for container width changes using ResizeObserver - ultra-fast real-time updates
  useEffect(() => {
    if (!pdfWrapperRef.current || !pdfDocument || totalPages === 0) return;

    // Minimal batching - update visual scale immediately, only batch the heavy re-render
    const rafIdRef = { current: 0 as number };
    const pendingWidthRef = { current: 0 as number };
    // Use ref to access current manualZoom value in closures
    const manualZoomRef = { current: manualZoom };
    
    // Update ref whenever manualZoom changes
    manualZoomRef.current = manualZoom;

    const flushResize = (force = false) => {
      rafIdRef.current = 0;
      const newWidth = pendingWidthRef.current;
      if (newWidth <= 50) return;

      // Don't recalculate zoom if user has set manual zoom - respect their choice
      // Only update container width tracking, but don't trigger zoom recalculation
      if (manualZoomRef.current !== null) {
        prevContainerWidthRef.current = newWidth;
        setContainerWidth(newWidth);
        // Still update visual scale to match manual zoom
        if (manualZoomRef.current > 0) {
          setVisualScale(manualZoomRef.current);
          targetScaleRef.current = manualZoomRef.current;
        }
        return;
      }

      // Minimal threshold - only skip truly identical widths
      const prev = prevContainerWidthRef.current;
      if (!force && Math.abs(newWidth - prev) < 0.000001) return;

      // If we haven't finished the initial citation jump-to-bbox, avoid triggering a rerender here.
      // (Rerender changes scrollHeight and can fight highlight centering.)
      const highlightKey = getHighlightKey();
      const suppressDuringInitialHighlightJump =
        !!highlightKey && didAutoScrollToHighlightRef.current !== highlightKey;
      if (suppressDuringInitialHighlightJump) {
        prevContainerWidthRef.current = newWidth;
        setContainerWidth(newWidth);
        // Still update visual scale immediately even during highlight jump
        const targetScale = calculateTargetScale(newWidth);
        if (targetScale !== null) {
          setVisualScale(targetScale);
          targetScaleRef.current = targetScale;
        }
        return;
      }

      prevContainerWidthRef.current = newWidth;
      setContainerWidth(newWidth);

      // Update visual scale immediately (synchronous - no delay)
      const targetScale = calculateTargetScale(newWidth);
      if (targetScale !== null) {
        setVisualScale(targetScale);
        targetScaleRef.current = targetScale;
      }

      // Trigger re-render (only batch this heavy operation)
      if (!isRecalculatingRef.current) {
        setBaseScale(1.0);
        hasRenderedRef.current = false;
      }
    };

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = entry.contentRect.width;
        pendingWidthRef.current = newWidth;
        
        // Update visual scale IMMEDIATELY (synchronous) for instant visual feedback
        // But only if manual zoom is not set - if manual zoom is set, use that instead
        if (newWidth > 50) {
          // Update ref to current value
          manualZoomRef.current = manualZoom;
          if (manualZoomRef.current !== null) {
            // Use manual zoom instead of recalculating
            setVisualScale(manualZoomRef.current);
            targetScaleRef.current = manualZoomRef.current;
          } else {
            // Auto-calculate zoom only when manual zoom is not set
            const targetScale = calculateTargetScale(newWidth);
            if (targetScale !== null) {
              setVisualScale(targetScale);
              targetScaleRef.current = targetScale;
            }
          }
        }
        
        // Only batch the heavy re-render operation
        if (!rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(() => flushResize(false));
        }
      }
    });

    // Immediately flush pending resize when user releases drag (instant snap)
    const handleResizeEnd = () => {
      // Cancel pending RAF and flush immediately
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
      // Force immediate flush of any pending width (bypass threshold for instant snap)
      if (pendingWidthRef.current > 50) {
        flushResize(true); // force=true bypasses threshold check
      }
    };

    resizeObserver.observe(pdfWrapperRef.current);

    // Listen for mouseup/touchend to instantly snap on resize release
    document.addEventListener('mouseup', handleResizeEnd, { passive: true });
    document.addEventListener('touchend', handleResizeEnd, { passive: true });

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      resizeObserver.disconnect();
      document.removeEventListener('mouseup', handleResizeEnd);
      document.removeEventListener('touchend', handleResizeEnd);
    };
  }, [pdfDocument, totalPages, calculateTargetScale, getHighlightKey, manualZoom]);

  // Render PDF pages with PDF.js native zoom - use manualZoom directly as scale
  useEffect(() => {
    if (!pdfDocument || totalPages === 0) return;
    
    // Check if we need to re-render:
    // 1. Haven't rendered this doc yet
    // 2. baseScale is 1.0 (reset trigger)
    // 3. manualZoom changed (user zoomed)
    const currentScale = manualZoom !== null ? manualZoom : 
        (isFullscreen ? 1.0 : // 100% starting zoom for fullscreen mode
          (firstPageCacheRef.current && pdfWrapperRef.current ? 
            (() => {
              const pageWidth = firstPageCacheRef.current!.viewport.width;
              const containerWidth = pdfWrapperRef.current!.clientWidth;
              const availableWidth = containerWidth - 128; // Account for padding (64px on each side)
              const zoomFactor = 0.98;
              return (availableWidth / pageWidth) * zoomFactor;
            })() : 1.0));
    
    const shouldSkip = hasRenderedRef.current && 
                       currentDocIdRefForPdf.current === docId && 
                       baseScale !== 1.0 &&
                       Math.abs(prevScaleRef.current - currentScale) < 0.01;
    
    if (shouldSkip) {
      return;
    }
    
    let cancelled = false;
    isRecalculatingRef.current = true;
    
    // Save viewport center point before recalculating (to preserve what user is viewing)
    // This is the single source of truth for scroll preservation
    const savedScrollTop = pdfWrapperRef.current?.scrollTop || 0;
    const savedClientHeight = pdfWrapperRef.current?.clientHeight || 0;
    const savedScrollHeight = pdfWrapperRef.current?.scrollHeight || 0;
    // Calculate the center point of the current viewport in document coordinates
    const savedViewportCenter = savedScrollTop + (savedClientHeight / 2);
    
    const renderAllPages = async () => {
      try {
        let scale = baseScale;
        const oldScale = prevScaleRef.current;
        
        // Always recalculate scale when baseScale is 1.0 (initial load or after width change)
        if (baseScale === 1.0) {
          // If manualZoom is set, use it directly (highest priority)
          if (manualZoom !== null) {
            scale = manualZoom;
            targetScaleRef.current = manualZoom; // Sync target scale
          } else if (targetScaleRef.current > 0) {
            // Use the target scale that was already calculated for visual feedback
            scale = targetScaleRef.current;
          } else {
            // Fallback: calculate scale if target wasn't set yet
            // Use cached first page for instant calculation
            let pageWidth: number;
            if (firstPageCacheRef.current) {
              pageWidth = firstPageCacheRef.current.viewport.width;
            } else {
              // If cache not available, get it (should be rare)
              const firstPage = await pdfDocument.getPage(1);
              if (cancelled) {
                isRecalculatingRef.current = false;
                return;
              }
              const naturalViewport = firstPage.getViewport({ scale: 1.0 });
              pageWidth = naturalViewport.width;
              firstPageCacheRef.current = { page: firstPage, viewport: naturalViewport };
            }
            
            let currentContainerWidth = 0;
            if (pdfWrapperRef.current && pdfWrapperRef.current.clientWidth > 50) {
              currentContainerWidth = pdfWrapperRef.current.clientWidth;
            } else if (containerWidth > 50) {
              currentContainerWidth = containerWidth;
            }
            
            if (currentContainerWidth > 50) {
              // Calculate auto-zoom (manualZoom already checked above)
              // In fullscreen mode, use fixed 100% (1.0x) zoom as starting level
              if (isFullscreen) {
                scale = 1.0; // 100% starting zoom for fullscreen mode
              } else {
                const availableWidth = currentContainerWidth - 128; // Account for padding (64px on each side)
                const zoomFactor = 0.98;
                const fitScale = (availableWidth / pageWidth) * zoomFactor;
                
                // Only enforce a minimum scale to prevent documents from being too small
                if (fitScale >= 0.3) {
                  scale = fitScale;
                } else {
                  scale = Math.max(0.25, fitScale);
                }
              }
            } else {
              const typicalPageWidth = 595;
              const typicalContainerWidth = 900;
              scale = (typicalContainerWidth / typicalPageWidth) * 0.95;
              scale = Math.max(0.25, Math.min(2.5, scale));
            }
          }
          
          setBaseScale(scale);
          // Sync visual scale with rendered scale to remove CSS transform and ensure BBOX alignment
          setVisualScale(scale);
          targetScaleRef.current = scale;
        } else {
          scale = baseScale;
        }
        
        // OPTIMIZATION: Render citation/highlight page FIRST for instant display
        // Then render remaining pages in background
        const newRenderedPages = new Map<number, { canvas: HTMLCanvasElement; dimensions: { width: number; height: number } }>();
        const highlightPage = highlight?.bbox?.page || 1;
        
        // Helper function to render a single page
        const renderPage = async (pageNum: number): Promise<{ canvas: HTMLCanvasElement; dimensions: { width: number; height: number } } | null> => {
          try {
            const cachedImageData = getCachedRenderedPage?.(docId, pageNum);
            const page = await pdfDocument.getPage(pageNum);
            if (cancelled) return null;
            
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const context = canvas.getContext('2d');
            
            if (!context) return null;
            
            if (cachedImageData && scale === 1.0) {
              context.putImageData(cachedImageData, 0, 0);
            } else {
              await page.render({
                canvasContext: context,
                viewport
              } as any).promise;
              
              if (scale === 1.0) {
                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                setCachedRenderedPage?.(docId, pageNum, imageData);
              }
            }
            
            return {
              canvas,
              dimensions: { width: viewport.width, height: viewport.height }
            };
          } catch (error) {
            console.error(`Failed to render page ${pageNum}:`, error);
            return null;
          }
        };
        
        // STEP 1: Render highlight page FIRST and display immediately
        // Scroll positioning is handled by useLayoutEffect (runs before paint)
        if (highlightPage >= 1 && highlightPage <= totalPages) {
          const highlightPageData = await renderPage(highlightPage);
          if (cancelled) return;
          
          if (highlightPageData) {
            newRenderedPages.set(highlightPage, highlightPageData);
            // Show highlight page immediately - useLayoutEffect will position scroll before paint
            setRenderedPages(new Map(newRenderedPages));
          }
        }
        
        // STEP 2: Render remaining pages in background
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          if (cancelled) break;
          if (pageNum === highlightPage) continue; // Already rendered
          
          const pageData = await renderPage(pageNum);
          if (cancelled) break;
          
          if (pageData) {
            newRenderedPages.set(pageNum, pageData);
          }
        }
        
        // STEP 3: Final update with all pages
        if (!cancelled) {
          setRenderedPages(new Map(newRenderedPages));
          hasRenderedRef.current = true;
          currentDocIdRefForPdf.current = docId;
          prevContainerWidthRef.current = pdfWrapperRef.current?.clientWidth || containerWidth || 0;
          prevScaleRef.current = scale;
          
          // Restore viewport center after re-render completes.
          // IMPORTANT: Don't fight the INITIAL citation jump-to-bbox.
          // Once we've already jumped to the bbox, resume normal resize preservation.
          const highlightKey = getHighlightKey();
          const shouldSkipViewportRestoreForInitialHighlightJump =
            !!highlightKey && didAutoScrollToHighlightRef.current !== highlightKey;

          if (!shouldSkipViewportRestoreForInitialHighlightJump && oldScale > 0 && oldScale !== scale && savedScrollHeight > 0) {
            // Minimal delay for faster adjustment - single RAF is enough
            requestAnimationFrame(() => {
              if (pdfWrapperRef.current && !cancelled) {
                const newScrollHeight = pdfWrapperRef.current.scrollHeight;
                const newClientHeight = pdfWrapperRef.current.clientHeight;
                
                if (newScrollHeight > 0 && oldScale > 0 && scale > 0) {
                  // Calculate scale ratio
                  const scaleRatio = scale / oldScale;
                  // The viewport center in document coordinates scales with the scale ratio
                  const newViewportCenter = savedViewportCenter * scaleRatio;
                  // Calculate new scroll position to keep the same document position visible
                  const newScrollTop = newViewportCenter - (newClientHeight / 2);
                  const maxScroll = Math.max(0, newScrollHeight - newClientHeight);
                  pdfWrapperRef.current.scrollTop = Math.max(0, Math.min(newScrollTop, maxScroll));
                }
              }
            });
          }
        }
        isRecalculatingRef.current = false;
      } catch (error) {
        console.error('Failed to render PDF pages:', error);
        isRecalculatingRef.current = false;
      }
    };
    
    renderAllPages();
    
    return () => {
      cancelled = true;
      isRecalculatingRef.current = false;
    };
  }, [pdfDocument, docId, totalPages, baseScale, containerWidth, getCachedRenderedPage, setCachedRenderedPage, getHighlightKey, manualZoom, isFullscreen]);


  // Reset scroll tracking when document changes
  useEffect(() => {
    didAutoScrollToHighlightRef.current = null;
  }, [docId]);

  // Auto-scroll to highlight when pages before it are added - position BBOX at ~35% from top
  // Uses useLayoutEffect to run BEFORE browser paint, preventing visible twitch when pages are added
  const didAutoScrollToHighlightRef = useRef<string | null>(null);
  React.useLayoutEffect(() => {
    if (highlight && highlight.fileId === docId && highlight.bbox && renderedPages.size > 0 && pdfWrapperRef.current) {
      const pageNum = highlight.bbox.page;
      const pageData = renderedPages.get(pageNum);
      
      if (pageData) {
        // Include page count in key so we re-scroll when pages before highlight are added
        // This ensures proper positioning after progressive page loading
        const pagesBeforeHighlight = Array.from(renderedPages.keys()).filter(n => n < pageNum).length;
        const baseKey = getHighlightKey() || `${docId}:${pageNum}`;
        const key = `${baseKey}:${pagesBeforeHighlight}`;
        if (didAutoScrollToHighlightRef.current === key) return; // prevent repeated jittery scrolls
        const expandedBbox = highlight.bbox;
        
        // Calculate the vertical position of the BBOX center on the page
        const bboxTop = expandedBbox.top * pageData.dimensions.height;
        const bboxHeight = expandedBbox.height * pageData.dimensions.height;
        const bboxCenterY = bboxTop + (bboxHeight / 2);
        
        // Calculate the horizontal position of the BBOX center on the page
        const bboxLeft = expandedBbox.left * pageData.dimensions.width;
        const bboxWidth = expandedBbox.width * pageData.dimensions.width;
        const bboxCenterX = bboxLeft + (bboxWidth / 2);
        
        // Calculate the offset from the top of the document to the target page
        const pageOffset = Array.from(renderedPages.entries())
          .filter(([num]) => num < pageNum)
          .reduce((sum, [, data]) => sum + data.dimensions.height + 16, 0); // +16 for margin-bottom
        
        // Calculate the absolute position of the BBOX center in the document
        const bboxCenterAbsoluteY = pageOffset + bboxCenterY;
        
        // Get viewport dimensions
        const viewportHeight = pdfWrapperRef.current.clientHeight;
        const viewportWidth = pdfWrapperRef.current.clientWidth;
        
        // Position BBOX at 35% from top (65% up the page) instead of center
        // This keeps more context visible below the citation
        const scrollTop = bboxCenterAbsoluteY - (viewportHeight * 0.35);
        
        // Center horizontally
        const scrollLeft = bboxCenterX - (viewportWidth / 2);
        
        // SYNCHRONOUS scroll adjustment - no RAF needed since useLayoutEffect runs before paint
        // This prevents the visible "twitch" when pages are added before the highlight
        const maxScrollTop = Math.max(0, pdfWrapperRef.current.scrollHeight - pdfWrapperRef.current.clientHeight);
        const maxScrollLeft = Math.max(0, pdfWrapperRef.current.scrollWidth - pdfWrapperRef.current.clientWidth);
        
        pdfWrapperRef.current.scrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop));
        pdfWrapperRef.current.scrollLeft = Math.max(0, Math.min(scrollLeft, maxScrollLeft));
        
        didAutoScrollToHighlightRef.current = key;
      }
    }
  }, [highlight, docId, renderedPages, getHighlightKey]);

  const isPDF = blobType === 'application/pdf';
  const isImage = blobType?.startsWith('image/');
  const isDOCX = displayFilename.toLowerCase().endsWith('.docx') || blobType?.includes('wordprocessingml');

  const isChatPanelOpen = chatPanelWidth > 0;
  
  // Track previous chatPanelWidth to detect when resizing is happening
  const prevChatPanelWidthRef = useRef<number>(chatPanelWidth);
  const [isChatPanelResizing, setIsChatPanelResizing] = useState<boolean>(false);
  
  // Detect when chat panel is being resized (width is changing)
  useEffect(() => {
    if (prevChatPanelWidthRef.current !== chatPanelWidth && isChatPanelOpen) {
      setIsChatPanelResizing(true);
      // Reset after resize completes (typically fast, but allow some buffer)
      const timeout = setTimeout(() => {
        setIsChatPanelResizing(false);
      }, 150);
      prevChatPanelWidthRef.current = chatPanelWidth;
      return () => clearTimeout(timeout);
    } else {
      prevChatPanelWidthRef.current = chatPanelWidth;
    }
  }, [chatPanelWidth, isChatPanelOpen]);
  
  // Calculate the width and right position for the document preview
  // Always anchor the right edge to the screen's right edge (accounting for agent sidebar)
  // When chat panel resizes, the document preview width adjusts automatically
  const agentSidebarWidth = isChatHistoryPanelOpen ? chatHistoryPanelWidth : 0;
  const availableWidth = typeof window !== 'undefined' ? window.innerWidth - sidebarWidth - agentSidebarWidth : 0;
  
  const { panelWidth, leftPosition } = (() => {
    // Minimum width for document preview
    const minDocPreviewWidth = CHAT_PANEL_WIDTH.DOC_PREVIEW_MIN;
    // Round chatPanelWidth for consistent positioning
    const roundedChatPanelWidth = Math.round(chatPanelWidth);
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
    
    // CORRECT LAYOUT: Sidebar (far left) | Chat Panel (left) | Document Preview (RIGHT)
    // Document preview is positioned AFTER sidebar AND chat panel
    // Natural left position = sidebarWidth + chatPanelWidth + gap
    const naturalDocLeft = sidebarWidth + roundedChatPanelWidth + 12;
    
    // Cap left position to ensure document preview stays on screen with minimum width
    // maxLeft + minDocWidth + rightGap = viewport - agentSidebar
    const maxDocLeft = viewportWidth - agentSidebarWidth - 12 - minDocPreviewWidth;
    const docLeft = Math.min(naturalDocLeft, maxDocLeft);
    
    // Calculate available width for document preview based on capped left position
    const availableWidth = viewportWidth - docLeft - agentSidebarWidth - 12;
    
    // Enforce minimum width for document preview
    const finalWidth = Math.max(availableWidth, minDocPreviewWidth);
    
    return {
      panelWidth: Math.round(finalWidth),
      leftPosition: docLeft
    };
  })();
  
  // Calculate if there's enough space for the Velora logo without overlapping buttons
  // Left buttons: Close (~60px) + Fullscreen (~100px) + gap (8px) + padding (24px) = ~192px
  // Right buttons (fullscreen): Zoom controls (~180px) + padding (16px) = ~196px
  // Right buttons (normal): Spacer (96px) + padding (16px) = ~112px
  // Logo width: ~80px (logo image at h-6)
  // Minimum space needed: max(left + right + logo, 550px) to ensure no overlap
  const leftButtonsWidth = 192; // Approximate width of left buttons + padding
  const rightButtonsWidth = isFullscreen ? 196 : 112; // Zoom controls in fullscreen, spacer otherwise
  const referenceAgentTextWidth = 80; // Approximate width of Velora logo
  const minSpacing = 16; // Minimum spacing on each side to prevent touching
  const minRequiredWidth = leftButtonsWidth + rightButtonsWidth + referenceAgentTextWidth + (minSpacing * 2);
  const shouldHideReferenceAgent = panelWidth < minRequiredWidth;

  const content = (
    <motion.div
      data-document-preview="true"
      data-sidebar-width={sidebarWidth}
      data-agent-sidebar-width={agentSidebarWidth}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0 }} // Instant close for responsive feel
      className={isFullscreen ? "fixed inset-0 bg-white flex flex-col z-[10000]" : "bg-white flex flex-col z-[9999]"}
      style={{
        ...(isFullscreen ? {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100vw',
          height: '100vh'
        } : {
          position: 'fixed',
          // Use explicit left + width positioning (not right) to guarantee minimum width
          // When resizing, DON'T apply React's values - let DOM manipulation control position
          // This prevents "pop out" caused by React overwriting with stale values
          ...(isResizing ? {} : {
            left: `${leftPosition}px`,
            width: `${panelWidth}px`,
          }),
          // Top and bottom margins for rounded corner effect
          top: '12px',
          bottom: '12px',
          // Enforce minimum width as CSS fallback
          minWidth: `${CHAT_PANEL_WIDTH.DOC_PREVIEW_MIN}px`,
          maxWidth: `calc(100vw - ${sidebarWidth + agentSidebarWidth + 24}px)`, // Never exceed available space
          overflow: 'hidden', // Contain content within rounded corners
          margin: 0, // Explicitly remove any margins
          padding: 0, // Explicitly remove any padding
          borderRadius: '16px', // All corners rounded like Prism
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08)',
          border: '1px solid rgba(226, 232, 240, 0.6)',
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: 'auto',
          // No transition for instant positioning - prevents gaps
          transition: 'none',
          transitionProperty: 'none',
          boxSizing: 'border-box',
          // Ensure no gaps by using exact positioning
          transform: 'translateZ(0)', // Force hardware acceleration
          willChange: isFilingSidebarResizing ? 'width, left' : 'auto', // Optimize during resize
          // Show resize cursor on entire container when actively resizing
          ...(isResizing && { cursor: 'ew-resize' })
        })
      }}
      onClick={(e) => {
        // Don't close if we're resizing or just finished resizing (prevents accidental close on drag release)
        if (isResizing) return;
        // Don't close if resize ended within the last 200ms (click event from drag release)
        if (Date.now() - lastResizeEndTimeRef.current < 200) return;
        if (e.target === e.currentTarget) {
          handleInstantClose();
        }
      }}
    >
      {/* Left edge resize handle - drag to resize chat panel */}
      {/* Only show when onResizeStart is provided (side-by-side mode with chat) */}
      {onResizeStart && !isFullscreen && (
        <div
          onMouseDown={onResizeStart}
          style={{
            position: 'absolute',
            left: -6, // Extend slightly outside for easier grabbing
            top: 0,
            bottom: 0,
            width: '12px', // Wide grab area
            cursor: 'ew-resize',
            zIndex: 10001, // Above all content
            backgroundColor: 'transparent',
            pointerEvents: 'auto',
          }}
        />
      )}
      
      {/* Agent Glow Border Effect - Pulsing gradient when agent opens document */}
      {isAgentOpening && (
        <div 
          className="agent-glow-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 10000,
            borderRadius: isFullscreen ? 0 : '16px', // Match container - all corners rounded
            overflow: 'hidden',
          }}
        >
          {/* Top edge glow */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '20px',
            background: 'linear-gradient(to bottom, rgba(217, 119, 8, 0.6), rgba(217, 119, 8, 0))',
            animation: 'agentGlowPulse 1.5s ease-in-out infinite',
          }} />
          {/* Bottom edge glow */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '20px',
            background: 'linear-gradient(to top, rgba(217, 119, 8, 0.6), rgba(217, 119, 8, 0))',
            animation: 'agentGlowPulse 1.5s ease-in-out infinite',
          }} />
          {/* Left edge glow */}
          <div style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: '20px',
            background: 'linear-gradient(to right, rgba(217, 119, 8, 0.6), rgba(217, 119, 8, 0))',
            animation: 'agentGlowPulse 1.5s ease-in-out infinite',
          }} />
          {/* Right edge glow */}
          <div style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            right: 0,
            width: '20px',
            background: 'linear-gradient(to left, rgba(217, 119, 8, 0.6), rgba(217, 119, 8, 0))',
            animation: 'agentGlowPulse 1.5s ease-in-out infinite',
          }} />
          {/* Corner glow overlays for smoother corners */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '40px',
            height: '40px',
            background: 'radial-gradient(ellipse at top left, rgba(217, 119, 8, 0.5), rgba(217, 119, 8, 0) 70%)',
            animation: 'agentGlowPulse 1.5s ease-in-out infinite',
          }} />
          <div style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '40px',
            height: '40px',
            background: 'radial-gradient(ellipse at top right, rgba(217, 119, 8, 0.5), rgba(217, 119, 8, 0) 70%)',
            animation: 'agentGlowPulse 1.5s ease-in-out infinite',
          }} />
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '40px',
            height: '40px',
            background: 'radial-gradient(ellipse at bottom left, rgba(217, 119, 8, 0.5), rgba(217, 119, 8, 0) 70%)',
            animation: 'agentGlowPulse 1.5s ease-in-out infinite',
          }} />
          <div style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: '40px',
            height: '40px',
            background: 'radial-gradient(ellipse at bottom right, rgba(217, 119, 8, 0.5), rgba(217, 119, 8, 0) 70%)',
            animation: 'agentGlowPulse 1.5s ease-in-out infinite',
          }} />
          {/* CSS Keyframes injected via style tag */}
          <style>{`
            @keyframes agentGlowPulse {
              0%, 100% {
                opacity: 1;
              }
              50% {
                opacity: 0.4;
              }
            }
          `}</style>
        </div>
      )}

      {/* Header */}
      <div className="pr-4 pl-6 shrink-0" style={{ 
        backgroundColor: 'white',
        border: '4px solid white',
        paddingTop: '15px',
        paddingBottom: '19px',
        borderTopLeftRadius: isFullscreen ? 0 : '16px',
        borderTopRightRadius: isFullscreen ? 0 : '16px',
        margin: '8px',
        borderRadius: '8px'
      }}>
        <div className="flex items-center justify-between">
          {/* Left spacer to balance the layout */}
          <div className="flex items-center" style={{ minWidth: '80px' }}>
          </div>
          
          {/* Center: Close button + PDF icon + Document name */}
          <div 
            className="flex items-center gap-2 min-w-0"
            style={{
              zIndex: 1,
              borderBottom: '2px solid rgba(0, 0, 0, 0.8)',
              paddingBottom: '4px',
              width: 'fit-content',
              margin: '0 auto'
            }}
          >
            <button
              onClick={onClose}
              className="flex items-center justify-center rounded-sm hover:bg-[#f0f0f0] active:bg-[#e8e8e8] flex-shrink-0"
              style={{
                padding: '4px',
                height: '22px',
                width: '22px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: 'transparent',
                transition: 'none',
                marginRight: '12px'
              }}
              title="Close document"
            >
              <X className="w-3.5 h-3.5 text-[#666]" strokeWidth={2} />
            </button>
            <img src="/PDF.png" alt="PDF" className="w-4 h-4 object-contain flex-shrink-0" />
            <span className="text-slate-700 text-sm font-medium truncate min-w-0">
              {displayFilename}
            </span>
          </div>
          
          {/* Right: Fullscreen button and zoom controls */}
          <div className="flex items-center gap-2 justify-end" style={{ minWidth: '80px' }}>
            {/* Quick Zoom dropdown - only show in fullscreen mode */}
            {isFullscreen && (
              <div className="relative">
                <select
                  value={(() => {
                    const currentScale = manualZoom !== null ? manualZoom : (baseScale || 1.0);
                    const currentPercentage = Math.round(currentScale * 100);
                    // Find closest preset or return 'fit' if none match
                    const presets = [50, 75, 100, 125, 150, 200];
                    const closest = presets.find(p => Math.abs(currentPercentage - p) < 5);
                    return closest !== undefined ? closest.toString() : 'fit';
                  })()}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === 'fit') {
                      handleZoomReset();
                    } else {
                      handleQuickZoom(parseInt(value, 10));
                    }
                  }}
                  className="appearance-none pl-2.5 pr-7 py-1.5 text-xs font-medium border border-slate-200/60 hover:border-slate-300/80 bg-white/90 hover:bg-slate-50/90 text-slate-700 rounded-md transition-all duration-200 shadow-sm cursor-pointer focus:outline-none focus:ring-1 focus:ring-slate-300"
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
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
              </div>
            )}
            {/* Download button */}
            <motion.button
              onClick={() => {
                if (previewUrl) {
                  const link = document.createElement('a');
                  link.href = previewUrl;
                  link.download = displayFilename || 'document.pdf';
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }
              }}
              whileHover={{ backgroundColor: '#f0f0f0' }}
              whileTap={{ backgroundColor: '#e8e8e8' }}
              className="flex items-center justify-center rounded-sm transition-all duration-150"
              style={{
                padding: '5px',
                height: '26px',
                width: '26px',
                minHeight: '26px',
                minWidth: '26px',
                border: 'none',
                cursor: 'pointer'
              }}
              title="Download file"
            >
              <Download className="w-4 h-4 text-[#666]" strokeWidth={1.75} />
            </motion.button>
            {/* Fullscreen button */}
            <motion.button
              onClick={() => setIsFullscreen(!isFullscreen)}
              whileHover={{ backgroundColor: '#f0f0f0' }}
              whileTap={{ backgroundColor: '#e8e8e8' }}
              className="flex items-center justify-center rounded-sm transition-all duration-150"
              style={{
                padding: '5px',
                height: '26px',
                width: '26px',
                minHeight: '26px',
                minWidth: '26px',
                border: 'none',
                cursor: 'pointer'
              }}
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4 text-[#666]" strokeWidth={1.75} />
              ) : (
                <Maximize className="w-4 h-4 text-[#666]" strokeWidth={1.75} />
              )}
            </motion.button>
          </div>
        </div>
        
        {/* Review Next Citation button */}
        {hasMultipleCitations && (
          <div className="flex justify-center w-full mt-3">
            <button
              onClick={handleReviewNextCitation}
              style={{
                backgroundColor: '#f5f5f5',
                color: '#333',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 16px',
                fontSize: '14px',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontWeight: 400,
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.5)',
                transition: 'background-color 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#e8e8e8';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#f5f5f5';
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.backgroundColor = '#dcdcdc';
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.backgroundColor = '#e8e8e8';
              }}
              title={`Review next citation (${currentCitationIndex + 1} of ${sortedCitations.length})`}
            >
              Review Next Citation
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div 
        className="bg-gray-50" 
        ref={pdfWrapperRef}
        style={{
          flex: 1,
          minHeight: 0, // Critical: allows flex item to shrink and enable scrolling
          overflow: 'auto',
          borderBottomLeftRadius: isFullscreen ? 0 : '16px',
          borderBottomRightRadius: isFullscreen ? 0 : '16px'
        }}
      >
        {error && (
          <div className="flex items-center justify-center h-full">
            <div className="text-red-500">Error: {error}</div>
          </div>
        )}
        
        {/* Show content immediately if we have rendered pages, even if still loading more */}
        {!error && (
          <>
            {isPDF && renderedPages.size > 0 && (
              <div
                ref={pdfPagesContainerRef}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '64px',
                  // Transform is applied directly via DOM manipulation during pinch gestures
                  // This avoids React re-renders for smooth 60fps performance
                  transformOrigin: 'top center',
                  willChange: isZooming ? 'transform' : 'auto'
                }}
              >
                {Array.from(renderedPages.entries()).sort(([a], [b]) => a - b).map(([pageNum, { canvas, dimensions }]) => (
                  <div
                    key={pageNum}
                    style={{
                      position: 'relative',
                      width: dimensions.width,
                      height: dimensions.height,
                      marginBottom: '16px',
                      backgroundColor: 'white',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                    }}
                  >
                    {React.createElement('canvas', {
                      ref: (node: HTMLCanvasElement | null) => {
                        if (node && canvas) {
                          const ctx = node.getContext('2d');
                          if (ctx) {
                            node.width = canvas.width;
                            node.height = canvas.height;
                            ctx.drawImage(canvas, 0, 0);
                          }
                        }
                      },
                      style: { display: 'block', width: '100%', height: '100%' }
                    })}
                    {highlight && highlight.fileId === docId && highlight.bbox.page === pageNum && !isZooming && (() => {
                      // Calculate logo size: fixed height = slightly larger to better match small BBOX highlights (2.0% of page height, minus 1px for bottom alignment)
                      const logoHeight = 0.02 * dimensions.height - 1;
                      // Assume logo is roughly square or slightly wider (adjust aspect ratio as needed)
                      // If logo is 1000x800, ratio is 1.25, so width = height * 1.25
                      // For now, using 1:1 ratio (square) - adjust if needed based on actual logo dimensions
                      const logoWidth = logoHeight; // Square logo, adjust if needed
                      // Calculate BBOX dimensions with centered padding
                      const padding = 4; // Equal padding on all sides
                      const originalBboxWidth = highlight.bbox.width * dimensions.width;
                      const originalBboxHeight = highlight.bbox.height * dimensions.height;
                      const originalBboxLeft = highlight.bbox.left * dimensions.width;
                      const originalBboxTop = highlight.bbox.top * dimensions.height;
                      
                      // Calculate center of original BBOX
                      const centerX = originalBboxLeft + originalBboxWidth / 2;
                      const centerY = originalBboxTop + originalBboxHeight / 2;
                      
                      // Calculate minimum BBOX height to match logo height (prevents staggered appearance)
                      const minBboxHeightPx = logoHeight; // Minimum height = logo height (exact match)
                      const baseBboxHeight = Math.max(originalBboxHeight, minBboxHeightPx);
                      
                      // Calculate final dimensions with equal padding
                      // If at minimum height, don't add padding to keep it exactly at logo height
                      const finalBboxWidth = originalBboxWidth + padding * 2;
                      const finalBboxHeight = baseBboxHeight === minBboxHeightPx 
                        ? minBboxHeightPx // Exactly logo height when at minimum (no padding)
                        : baseBboxHeight + padding * 2; // Add padding only when BBOX is naturally larger
                      
                      // Center the BBOX around the original text
                      const bboxLeft = Math.max(0, centerX - finalBboxWidth / 2);
                      const bboxTop = Math.max(0, centerY - finalBboxHeight / 2);
                      
                      // Ensure BBOX doesn't go outside page bounds
                      const constrainedLeft = Math.min(bboxLeft, dimensions.width - finalBboxWidth);
                      const constrainedTop = Math.min(bboxTop, dimensions.height - finalBboxHeight);
                      const finalBboxLeft = Math.max(0, constrainedLeft);
                      const finalBboxTop = Math.max(0, constrainedTop);
                      
                      // Position logo: Logo's top-right corner aligns with BBOX's top-left corner
                      // Logo's right border edge overlaps with BBOX's left border edge
                      const logoLeft = finalBboxLeft - logoWidth + 2; // Move 2px right so borders overlap
                      const logoTop = finalBboxTop; // Logo's top = BBOX's top (perfectly aligned)
                      
                      return (
                        <>
                          {/* Velora logo - positioned so top-right aligns with BBOX top-left */}
                          <img
                            src={veloraLogo}
                            alt="Velora"
                            style={{
                              position: 'absolute',
                              left: `${logoLeft}px`,
                              top: `${logoTop}px`,
                              width: `${logoWidth}px`,
                              height: `${logoHeight}px`,
                              objectFit: 'contain',
                              pointerEvents: 'none',
                              zIndex: 11,
                              userSelect: 'none',
                              border: '2px solid rgba(255, 193, 7, 0.9)',
                              borderRadius: '2px',
                              backgroundColor: 'white', // Ensure logo has background for border visibility
                              boxSizing: 'border-box' // Ensure border is included in width/height for proper overlap
                            }}
                          />
                          {/* BBOX highlight */}
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              // Build full citation object for CitationActionMenu
                              setSelectedCitation({
                                fileId: highlight.fileId,
                                doc_id: highlight.doc_id || docId,
                                bbox: highlight.bbox,
                                block_content: highlight.block_content || '',
                                original_filename: highlight.original_filename || filename,
                                block_id: highlight.block_id || ''
                              });
                              // Position menu at click location (use click X, below citation Y)
                              setCitationMenuPosition({
                                x: e.clientX, // Use actual click X position
                                y: rect.bottom + 8 // Position below with 8px gap
                              });
                            }}
                            style={{
                              position: 'absolute',
                              left: `${finalBboxLeft}px`,
                              top: `${finalBboxTop}px`,
                              width: `${Math.min(dimensions.width, finalBboxWidth)}px`,
                              height: `${Math.min(dimensions.height, finalBboxHeight)}px`,
                              backgroundColor: 'rgba(255, 235, 59, 0.4)',
                              border: '2px solid rgba(255, 193, 7, 0.9)',
                              borderRadius: '2px',
                              pointerEvents: 'auto',
                              cursor: 'pointer',
                              zIndex: 10,
                              boxShadow: '0 2px 8px rgba(255, 193, 7, 0.3)',
                              transition: 'none' // No animation when changing between BBOXs
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = 'rgba(255, 235, 59, 0.6)';
                              e.currentTarget.style.borderColor = 'rgba(255, 193, 7, 1)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'rgba(255, 235, 59, 0.4)';
                              e.currentTarget.style.borderColor = 'rgba(255, 193, 7, 0.9)';
                            }}
                            title="Click to interact with this citation"
                          />
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
            
            {/* Show loading only if no pages rendered yet and still loading */}
            {isPDF && renderedPages.size === 0 && loading && (
              <div className="flex items-center justify-center h-full">
                <div className="text-gray-500" style={{ paddingTop: '80px' }}>Loading...</div>
              </div>
            )}
            
            {isImage && (
              <div className="flex items-center justify-center h-full p-4">
                <img src={previewUrl} alt={displayFilename} className="max-w-full max-h-full object-contain" />
              </div>
            )}
            
            {isDOCX && (
              <div className="flex items-center justify-center h-full p-4">
                <iframe
                  src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(previewUrl)}`}
                  className="w-full h-full border-0"
                  title={displayFilename}
                />
              </div>
            )}
          </>
        )}
      </div>
      
      {/* Citation Action Menu */}
      {citationMenuPosition && selectedCitation && (
        <CitationActionMenu
          citation={selectedCitation}
          position={citationMenuPosition}
          onClose={() => {
            setCitationMenuPosition(null);
            setSelectedCitation(null);
          }}
          onAskMore={(citation) => {
            const citationText = citation.block_content || 'this information';
            const query = `Tell me more about: ${citationText.substring(0, 200)}${citationText.length > 200 ? '...' : ''}`;
            const event = new CustomEvent('citation-ask-more', {
              detail: { query, citation, documentId: citation.fileId || citation.doc_id }
            });
            window.dispatchEvent(event);
          }}
          onAddToWriting={(citation) => {
            const curatedKey = 'curated_writing_citations';
            const existing = JSON.parse(localStorage.getItem(curatedKey) || '[]');
            const newEntry = {
              id: `citation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              citation,
              addedAt: new Date().toISOString(),
              documentName: citation.original_filename || 'Unknown document',
              content: citation.block_content || ''
            };
            existing.push(newEntry);
            localStorage.setItem(curatedKey, JSON.stringify(existing));
            window.dispatchEvent(new CustomEvent('citation-added-to-writing', { detail: newEntry }));
          }}
        />
      )}

    </motion.div>
  );

  // Hide immediately when local state is set (before parent state updates)
  if (isLocallyHidden) {
    return null;
  }
  
  if (isFullscreen) {
    return createPortal(content, document.body);
  }

  // Background layer that fills the entire document preview area (without rounded corners)
  // This prevents seeing through to the map behind the rounded corners
  const backgroundLayer = (
    <div
      style={{
        position: 'fixed',
        // Match document preview positioning (extend slightly for rounded corners)
        left: `${leftPosition - 12}px`,
        width: `${panelWidth + 24}px`, // Extend to cover rounded corner area
        top: 0,
        bottom: 0,
        backgroundColor: '#FCFCF9', // Match the chat panel background
        zIndex: 9998, // Below the document preview (9999)
        pointerEvents: 'none',
        transition: 'none',
      }}
    />
  );

  // Render without backdrop - positioned alongside chat panel
  return createPortal(
    <>
      {backgroundLayer}
      {content}
    </>,
    document.body
  );
};


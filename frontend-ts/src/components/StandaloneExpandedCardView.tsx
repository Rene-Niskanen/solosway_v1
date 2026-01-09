"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Maximize2, Minimize2, TextCursorInput } from 'lucide-react';
import { usePreview } from '../contexts/PreviewContext';
import { backendApi } from '../services/backendApi';
import { useFilingSidebar } from '../contexts/FilingSidebarContext';
import { CitationActionMenu } from './CitationActionMenu';

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
}

export const StandaloneExpandedCardView: React.FC<StandaloneExpandedCardViewProps> = ({
  docId,
  filename,
  highlight,
  onClose,
  chatPanelWidth = 0,
  sidebarWidth = 56
}) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [blobType, setBlobType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [displayFilename, setDisplayFilename] = useState<string>(filename || 'document.pdf');
  
  // PDF.js state
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [renderedPages, setRenderedPages] = useState<Map<number, { canvas: HTMLCanvasElement; dimensions: { width: number; height: number } }>>(new Map());
  const [baseScale, setBaseScale] = useState<number>(1.0);
  const [visualScale, setVisualScale] = useState<number>(1.0); // CSS transform scale for immediate visual feedback
  const [totalPages, setTotalPages] = useState<number>(0);
  const pdfPagesContainerRef = useRef<HTMLDivElement>(null);
  const pdfWrapperRef = useRef<HTMLDivElement>(null);
  const hasRenderedRef = useRef<boolean>(false);
  const currentDocIdRefForPdf = useRef<string | null>(null);
  const prevScaleRef = useRef<number>(1.0); // Track previous scale for scroll position preservation
  const targetScaleRef = useRef<number>(1.0); // Track target scale for smooth transitions
  const firstPageCacheRef = useRef<{ page: any; viewport: any } | null>(null); // Cache first page for instant scale calculation
  
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
  
  const { previewFiles, getCachedPdfDocument, setCachedPdfDocument, getCachedRenderedPage, setCachedRenderedPage } = usePreview();
  const { isOpen: isFilingSidebarOpen, width: filingSidebarWidth } = useFilingSidebar();

  // Try to get filename from cached file data if not provided
  useEffect(() => {
    if (!filename || filename === 'document.pdf') {
      // Check if we have the file in previewFiles cache
      const cachedFile = previewFiles.find(f => f.id === docId);
      if (cachedFile?.name) {
        setDisplayFilename(cachedFile.name);
        return;
      }
      
      // Check if we have it in preloaded blobs cache
      const cachedBlob = (window as any).__preloadedDocumentBlobs?.[docId];
      if (cachedBlob?.filename) {
        setDisplayFilename(cachedBlob.filename);
        return;
      }
    } else {
      setDisplayFilename(filename);
    }
  }, [docId, filename, previewFiles]);

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
          if (cachedBlob.filename && (!displayFilename || displayFilename === 'document.pdf')) {
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
          if (cachedFileEntry.name && (!displayFilename || displayFilename === 'document.pdf')) {
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
          const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
          if (filenameMatch && filenameMatch[1]) {
            extractedFilename = filenameMatch[1].replace(/['"]/g, '');
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
        
        // Update display filename if we extracted a better one
        if (extractedFilename && extractedFilename !== 'document.pdf' && (!displayFilename || displayFilename === 'document.pdf')) {
          setDisplayFilename(extractedFilename);
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
      
      const availableWidth = containerWidth - 32; // Account for padding
      const fitScale = (availableWidth / pageWidth) * 0.98;
      
      if (fitScale >= 0.3 && fitScale <= 2.5) {
        return fitScale;
      } else if (fitScale < 0.3) {
        return Math.max(0.25, fitScale);
      } else {
        return 2.5;
      }
    } catch (error) {
      console.error('Failed to calculate target scale:', error);
      return null;
    }
  }, [pdfDocument]);

  // Force recalculation when positioning changes (filing sidebar, chat panel)
  // This ensures zoom updates even when container width doesn't change but available space does
  useEffect(() => {
    if (pdfDocument && totalPages > 0) {
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
  }, [isFilingSidebarOpen, filingSidebarWidth, chatPanelWidth, pdfDocument, totalPages, calculateTargetScale]);

  // Watch for container width changes using ResizeObserver - ultra-fast real-time updates
  useEffect(() => {
    if (!pdfWrapperRef.current || !pdfDocument || totalPages === 0) return;

    // Minimal batching - update visual scale immediately, only batch the heavy re-render
    const rafIdRef = { current: 0 as number };
    const pendingWidthRef = { current: 0 as number };

    const flushResize = (force = false) => {
      rafIdRef.current = 0;
      const newWidth = pendingWidthRef.current;
      if (newWidth <= 50) return;

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
        if (newWidth > 50) {
          const targetScale = calculateTargetScale(newWidth);
          if (targetScale !== null) {
            setVisualScale(targetScale);
            targetScaleRef.current = targetScale;
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
  }, [pdfDocument, totalPages, calculateTargetScale, getHighlightKey]);

  // Render PDF pages with responsive zoom - real-time updates
  useEffect(() => {
    if (!pdfDocument || totalPages === 0) return;
    
    // Always recalculate if baseScale is 1.0 (reset trigger) or if we haven't rendered this doc yet
    // Don't skip if baseScale is 1.0 - that means we need to recalculate
    const shouldSkip = hasRenderedRef.current && 
                       currentDocIdRefForPdf.current === docId && 
                       baseScale !== 1.0;
    
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
          // Use the target scale that was already calculated for visual feedback
          // This ensures consistency between visual and rendered scale
          if (targetScaleRef.current > 0) {
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
              const availableWidth = currentContainerWidth - 32;
              const fitScale = (availableWidth / pageWidth) * 0.98;
              
              if (fitScale >= 0.3 && fitScale <= 2.5) {
                scale = fitScale;
              } else if (fitScale < 0.3) {
                scale = Math.max(0.25, fitScale);
              } else {
                scale = 2.5;
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
        
        // Render all pages - update state only once after all pages are ready (prevents glitchy updates)
        const newRenderedPages = new Map<number, { canvas: HTMLCanvasElement; dimensions: { width: number; height: number } }>();
        
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          if (cancelled) break;
          
          try {
            const cachedImageData = getCachedRenderedPage?.(docId, pageNum);
            const page = await pdfDocument.getPage(pageNum);
            if (cancelled) break;
            
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const context = canvas.getContext('2d');
            
            if (!context) continue;
            
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
            
            newRenderedPages.set(pageNum, {
              canvas,
              dimensions: { width: viewport.width, height: viewport.height }
            });
          } catch (error) {
            console.error(`Failed to render page ${pageNum}:`, error);
          }
        }
        
        // Update state only once after all pages are rendered (prevents glitchy progressive updates)
        if (!cancelled) {
          setRenderedPages(newRenderedPages);
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
  }, [pdfDocument, docId, totalPages, baseScale, containerWidth, getCachedRenderedPage, setCachedRenderedPage, getHighlightKey]);

  // Auto-scroll to highlight - center BBOX vertically in viewport
  const didAutoScrollToHighlightRef = useRef<string | null>(null);
  useEffect(() => {
    if (highlight && highlight.fileId === docId && highlight.bbox && renderedPages.size > 0 && pdfWrapperRef.current) {
      const pageNum = highlight.bbox.page;
      const pageData = renderedPages.get(pageNum);
      
      if (pageData) {
        const key = getHighlightKey() || `${docId}:${pageNum}`;
        if (didAutoScrollToHighlightRef.current === key) return; // prevent repeated jittery scrolls
        const expandedBbox = highlight.bbox;
        
        // Calculate the vertical position of the BBOX center on the page
        const bboxTop = expandedBbox.top * pageData.dimensions.height;
        const bboxHeight = expandedBbox.height * pageData.dimensions.height;
        const bboxCenter = bboxTop + (bboxHeight / 2);
        
        // Calculate the offset from the top of the document to the target page
        const pageOffset = Array.from(renderedPages.entries())
          .filter(([num]) => num < pageNum)
          .reduce((sum, [, data]) => sum + data.dimensions.height + 16, 0); // +16 for margin-bottom
        
        // Calculate the absolute position of the BBOX center in the document
        const bboxCenterAbsolute = pageOffset + bboxCenter;
        
        // Get viewport height
        const viewportHeight = pdfWrapperRef.current.clientHeight;
        
        // Calculate scroll position to center the BBOX vertically
        // Scroll position = BBOX center - (viewport height / 2)
        const scrollTop = bboxCenterAbsolute - (viewportHeight / 2);
        
        // Make the FIRST citation jump deterministic and non-jittery:
        // - no timeout
        // - no smooth animation (animation combined with re-render/scale can feel like "fighting")
        requestAnimationFrame(() => {
          if (pdfWrapperRef.current) {
            const maxScroll = Math.max(0, pdfWrapperRef.current.scrollHeight - pdfWrapperRef.current.clientHeight);
            pdfWrapperRef.current.scrollTop = Math.max(0, Math.min(scrollTop, maxScroll));
          }
        });
        didAutoScrollToHighlightRef.current = key;
      }
    }
  }, [highlight, docId, renderedPages, getHighlightKey]);

  const isPDF = blobType === 'application/pdf';
  const isImage = blobType?.startsWith('image/');
  const isDOCX = displayFilename.toLowerCase().endsWith('.docx') || blobType?.includes('wordprocessingml');

  const isChatPanelOpen = chatPanelWidth > 0;
  
  // Calculate the actual left position for the document preview
  // This must match the logic in MainContent.tsx for SideChatPanel's sidebarWidth calculation
  // When chat panel is open: chatPanelWidth is the width, chat panel's left = calculated sidebarWidth (includes filing sidebar)
  // So document preview left = chatPanelLeft + chatPanelWidth + gap
  // When chat panel is closed: position after sidebar (which may include filing sidebar) + gap
  // Memoized to prevent recalculation on every render
  const calculateLeftPosition = useCallback(() => {
    const toggleRailWidth = 12;
    
    // Calculate the actual sidebar width (base + filing sidebar if open)
    // This matches the logic in MainContent.tsx (lines 3575-3599)
    let actualSidebarWidth = sidebarWidth; // Base sidebar width
    
    if (isFilingSidebarOpen) {
      if (sidebarWidth <= 8) {
        // Collapsed sidebar: FilingSidebar starts at 12px, ends at 12px + filingSidebarWidth
        actualSidebarWidth = 12 + filingSidebarWidth;
      } else {
        // Not collapsed: FilingSidebar starts at sidebarWidth + 12px, ends at sidebarWidth + 12px + filingSidebarWidth
        actualSidebarWidth = sidebarWidth + toggleRailWidth + filingSidebarWidth;
      }
    }
    
    if (isChatPanelOpen) {
      // Document preview starts immediately after chat panel ends (no gap)
      // Chat panel's left = actualSidebarWidth, its right = actualSidebarWidth + chatPanelWidth
      return actualSidebarWidth + chatPanelWidth;
    } else {
      // Chat panel closed - position immediately after sidebar (which may include filing sidebar)
      return actualSidebarWidth;
    }
  }, [sidebarWidth, isFilingSidebarOpen, filingSidebarWidth, isChatPanelOpen, chatPanelWidth]);
  
  // Memoize the left position to prevent jitter
  const leftPosition = useMemo(() => calculateLeftPosition(), [calculateLeftPosition]);

  const content = (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
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
          // Position alongside chat panel with no gaps
          // Calculates correct position accounting for filing sidebar
          left: `${leftPosition}px`,
          right: '0px', // No gap from right edge - this automatically calculates width
          top: '0px', // No gap from top
          bottom: '0px', // No gap from bottom - this automatically calculates height
          borderRadius: '0px', // No border radius when edge-to-edge
          // Remove the heavy shadow in split-view (it reads like a shadow on the chat edge).
          // Use a subtle divider instead.
          boxShadow: 'none',
          borderLeft: '1px solid rgba(226, 232, 240, 0.9)',
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: 'auto',
          // No transition for left positioning - updates instantly when chatPanelWidth or filing sidebar changes
          transition: 'none',
          boxSizing: 'border-box' // Ensure padding/borders are included in width/height
        })
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      {/* Header */}
      <div className="h-14 px-4 border-b border-gray-100 flex items-center justify-between bg-white shrink-0 relative">
        <div className="flex items-center gap-2 absolute left-1/2 transform -translate-x-1/2">
          <TextCursorInput className="w-4 h-4 text-gray-600 flex-shrink-0" />
          <span className="text-sm font-medium text-gray-900">
            Reference Agent
          </span>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 hover:bg-gray-100 rounded transition-colors"
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div 
        className="flex-1 overflow-auto bg-gray-50" 
        ref={pdfWrapperRef}
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0, // Allow flex item to shrink below content size
          flex: '1 1 auto' // Ensure it takes available space
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
                  padding: '16px',
                  // Apply CSS transform only when visualScale differs from baseScale (during transition)
                  // This provides smooth visual feedback while re-rendering in background
                  // Once baseScale matches visualScale, remove transform so BBOX highlights align correctly
                  transform: Math.abs(visualScale - baseScale) > 0.01 && baseScale > 0 ? `scale(${visualScale / baseScale})` : 'scale(1)',
                  transformOrigin: 'top center',
                  transition: Math.abs(visualScale - baseScale) > 0.01 && baseScale > 0 ? 'transform 0.1s ease-out' : 'none',
                  willChange: Math.abs(visualScale - baseScale) > 0.01 && baseScale > 0 ? 'transform' : 'auto'
                }}
              >
                {Array.from(renderedPages.entries()).map(([pageNum, { canvas, dimensions }]) => (
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
                    {highlight && highlight.fileId === docId && highlight.bbox.page === pageNum && (
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
                          left: `${Math.max(0, highlight.bbox.left * dimensions.width - 4)}px`,
                          top: `${Math.max(0, highlight.bbox.top * dimensions.height - 4)}px`,
                          width: `${Math.min(dimensions.width, highlight.bbox.width * dimensions.width + 8)}px`,
                          height: `${Math.min(dimensions.height, highlight.bbox.height * dimensions.height + 8)}px`,
                          backgroundColor: 'rgba(255, 235, 59, 0.4)',
                          border: '2px solid rgba(255, 193, 7, 0.9)',
                          borderRadius: '2px',
                          pointerEvents: 'auto',
                          cursor: 'pointer',
                          zIndex: 10,
                          boxShadow: '0 2px 8px rgba(255, 193, 7, 0.3)',
                          transition: 'all 0.2s ease'
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
                    )}
                  </div>
                ))}
              </div>
            )}
            
            {/* Show loading only if no pages rendered yet and still loading */}
            {isPDF && renderedPages.size === 0 && loading && (
              <div className="flex items-center justify-center h-full">
                <div className="text-gray-500">Loading...</div>
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

  if (isFullscreen) {
    return createPortal(content, document.body);
  }

  // Render without backdrop - positioned alongside chat panel
  return createPortal(content, document.body);
};


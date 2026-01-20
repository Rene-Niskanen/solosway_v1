"use client";

import * as React from "react";
import { FileAttachmentData } from "../components/FileAttachment";
import type { PDFDocumentProxy } from 'pdfjs-dist';

// Cache for pre-rendered PDF pages (page number -> ImageData)
export type RenderedPageCache = Map<number, ImageData>;
export type DocumentPageCache = Map<string, RenderedPageCache>; // fileId -> page cache

// Highlight metadata for citation-based document viewing
export interface CitationChunkMetadata {
  chunk_index?: number;
  page_number?: number;
  content?: string;
  bbox?: {
    left: number;
    top: number;
    width: number;
    height: number;
    page?: number;
  };
}

export interface CitationHighlight {
  fileId: string;  // Match file.id in previewFiles array
  bbox: {
    left: number;
    top: number;
    width: number;
    height: number;
    page: number;
  };
  chunks?: CitationChunkMetadata[];
  // Full citation metadata for CitationActionMenu (to enable ask questions on cited content)
  doc_id?: string;
  block_id?: string;
  block_content?: string;
  original_filename?: string;
}

interface PreviewContextType {
  previewFiles: FileAttachmentData[];
  activePreviewTabIndex: number;
  isPreviewOpen: boolean;
  setPreviewFiles: React.Dispatch<React.SetStateAction<FileAttachmentData[]>>;
  setActivePreviewTabIndex: React.Dispatch<React.SetStateAction<number>>;
  setIsPreviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  addPreviewFile: (file: FileAttachmentData, highlight?: CitationHighlight) => void;
  preloadFile: (file: FileAttachmentData) => void; // NEW: Preload file without opening preview
  getCachedPdfDocument: (fileId: string) => PDFDocumentProxy | null; // NEW: Get cached PDF document
  setCachedPdfDocument: (fileId: string, pdf: PDFDocumentProxy | null) => void; // NEW: Cache PDF document
  highlightCitation: CitationHighlight | null;
  setHighlightCitation: React.Dispatch<React.SetStateAction<CitationHighlight | null>>;
  clearHighlightCitation: () => void;
  getCachedRenderedPage: (fileId: string, pageNumber: number) => ImageData | null; // NEW: Get cached rendered page
  setCachedRenderedPage: (fileId: string, pageNumber: number, imageData: ImageData | null) => void; // NEW: Cache rendered page
  preloadPdfPage: (fileId: string, pageNumber: number, pdf: PDFDocumentProxy, scale: number) => Promise<void>; // NEW: Pre-render page
  // NEW: Standalone ExpandedCardView support
  expandedCardViewDoc: { docId: string; filename: string; highlight?: CitationHighlight } | null;
  setExpandedCardViewDoc: React.Dispatch<React.SetStateAction<{ docId: string; filename: string; highlight?: CitationHighlight } | null>>;
  openExpandedCardView: (docId: string, filename: string, highlight?: CitationHighlight, isAgentTriggered?: boolean) => void;
  closeExpandedCardView: () => void;
  // NEW: Agent opening state for glowing border effect
  isAgentOpening: boolean;
  setIsAgentOpening: React.Dispatch<React.SetStateAction<boolean>>;
  // NEW: Agent task overlay state (for navigation tasks)
  isAgentTaskActive: boolean;
  agentTaskMessage: string;
  setAgentTaskActive: (active: boolean, message?: string) => void;
  stopAgentTask: () => void;
  // NEW: Map navigation glow effect state
  isMapNavigating: boolean;
  setMapNavigating: (active: boolean) => void;
  // NEW: Chat panel visibility tracking for document preview gating
  isChatPanelVisible: boolean;
  setIsChatPanelVisible: React.Dispatch<React.SetStateAction<boolean>>;
  // NEW: Pending document preview (queued when chat is hidden)
  pendingExpandedCardViewDoc: { docId: string; filename: string; highlight?: CitationHighlight } | null;
  clearPendingExpandedCardView: () => void;
  // NEW: Pending preview files (queued when chat is hidden, opened when chat becomes visible)
  pendingPreviewFiles: FileAttachmentData[];
  pendingPreviewHighlight: CitationHighlight | null;
  MAX_PREVIEW_TABS: number;
}

const PreviewContext = React.createContext<PreviewContextType | undefined>(undefined);

export const PreviewProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const MAX_PREVIEW_TABS = 4;
  const [previewFiles, setPreviewFiles] = React.useState<FileAttachmentData[]>([]);
  const [activePreviewTabIndex, setActivePreviewTabIndex] = React.useState(0);
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(false);
  const [highlightCitation, setHighlightCitation] = React.useState<CitationHighlight | null>(null);
  // NEW: Standalone ExpandedCardView state
  const [expandedCardViewDoc, setExpandedCardViewDoc] = React.useState<{ docId: string; filename: string; highlight?: CitationHighlight } | null>(null);
  // NEW: Agent opening state for glowing border effect
  const [isAgentOpening, setIsAgentOpening] = React.useState<boolean>(false);
  // NEW: Agent task overlay state (for navigation tasks)
  const [isAgentTaskActive, setIsAgentTaskActiveState] = React.useState<boolean>(false);
  const [agentTaskMessage, setAgentTaskMessage] = React.useState<string>('');
  // NEW: Map navigation glow effect state
  const [isMapNavigating, setIsMapNavigatingState] = React.useState<boolean>(false);
  // NEW: Chat panel visibility tracking for document preview gating
  const [isChatPanelVisible, setIsChatPanelVisible] = React.useState<boolean>(false);
  // NEW: Pending document preview (queued when chat is hidden, opened when chat becomes visible)
  const [pendingExpandedCardViewDoc, setPendingExpandedCardViewDoc] = React.useState<{ docId: string; filename: string; highlight?: CitationHighlight } | null>(null);
  // NEW: Pending preview files (queued when chat is hidden, opened when chat becomes visible)
  const [pendingPreviewFiles, setPendingPreviewFiles] = React.useState<FileAttachmentData[]>([]);
  const [pendingPreviewHighlight, setPendingPreviewHighlight] = React.useState<CitationHighlight | null>(null);
  // NEW: Cache PDF documents in memory to avoid reloading when switching between documents
  const [pdfDocumentCache, setPdfDocumentCache] = React.useState<Map<string, PDFDocumentProxy>>(new Map());
  // NEW: Cache rendered PDF pages (fileId -> pageNumber -> ImageData) for instant page switching
  const [renderedPageCache, setRenderedPageCache] = React.useState<DocumentPageCache>(new Map());
  // NEW: Track pages currently being pre-rendered to prevent duplicate concurrent renders
  const preRenderingInProgressRef = React.useRef<Set<string>>(new Set()); // Format: "fileId:pageNumber"

  const clearHighlightCitation = React.useCallback(() => {
    setHighlightCitation(null);
  }, []);

  // NEW: Open standalone ExpandedCardView
  // Modified to gate document preview based on chat panel visibility
  const openExpandedCardView = React.useCallback((docId: string, filename: string, highlight?: CitationHighlight, isAgentTriggered?: boolean) => {
    // If chat panel is not visible, queue the document for later (silent background opening)
    if (!isChatPanelVisible) {
      console.log('📋 [PREVIEW] Chat panel hidden - queueing document for later:', { docId, filename });
      setPendingExpandedCardViewDoc({ docId, filename, highlight });
      return;
    }
    
    // Chat panel is visible - open normally
    if (isAgentTriggered) {
      setIsAgentOpening(true);
    }
    setExpandedCardViewDoc({ docId, filename, highlight });
  }, [isChatPanelVisible]);

  // NEW: Close standalone ExpandedCardView
  const closeExpandedCardView = React.useCallback(() => {
    setExpandedCardViewDoc(null);
    setIsAgentOpening(false); // Reset glow state when closing
  }, []);

  // NEW: Clear pending document preview (e.g., when starting a new chat)
  const clearPendingExpandedCardView = React.useCallback(() => {
    setPendingExpandedCardViewDoc(null);
    // Also clear pending preview files
    setPendingPreviewFiles([]);
    setPendingPreviewHighlight(null);
  }, []);

  // NEW: Effect to open pending document when chat becomes visible
  React.useEffect(() => {
    if (isChatPanelVisible && pendingExpandedCardViewDoc) {
      console.log('📋 [PREVIEW] Chat panel visible - opening queued document:', pendingExpandedCardViewDoc);
      setExpandedCardViewDoc(pendingExpandedCardViewDoc);
      setPendingExpandedCardViewDoc(null);
    }
  }, [isChatPanelVisible, pendingExpandedCardViewDoc]);

  // NEW: Effect to open pending preview files when chat becomes visible
  React.useEffect(() => {
    if (isChatPanelVisible && pendingPreviewFiles.length > 0) {
      console.log('📋 [PREVIEW] Chat panel visible - opening queued preview files:', pendingPreviewFiles.length);
      // Add all pending files to preview
      setPreviewFiles(prev => {
        // Merge pending files with existing, avoiding duplicates
        const existingIds = new Set(prev.map(f => f.id));
        const newFiles = pendingPreviewFiles.filter(f => !existingIds.has(f.id));
        const merged = [...prev, ...newFiles];
        
        // Limit to MAX_PREVIEW_TABS
        const finalFiles = merged.length > MAX_PREVIEW_TABS 
          ? merged.slice(-MAX_PREVIEW_TABS) 
          : merged;
        
        // Set active tab to the last pending file
        if (newFiles.length > 0) {
          const lastPendingFile = newFiles[newFiles.length - 1];
          const index = finalFiles.findIndex(f => f.id === lastPendingFile.id);
          if (index !== -1) {
            setActivePreviewTabIndex(index);
          }
        }
        
        return finalFiles;
      });
      
      // Open preview and set highlight if provided
      setIsPreviewOpen(true);
      if (pendingPreviewHighlight) {
        setHighlightCitation(pendingPreviewHighlight);
      }
      
      // Clear pending state
      setPendingPreviewFiles([]);
      setPendingPreviewHighlight(null);
    }
  }, [isChatPanelVisible, pendingPreviewFiles, pendingPreviewHighlight, MAX_PREVIEW_TABS]);

  // NEW: Effect to close preview when chat panel becomes hidden
  React.useEffect(() => {
    if (!isChatPanelVisible && isPreviewOpen) {
      console.log('📋 [PREVIEW] Chat panel hidden - closing preview modal');
      setIsPreviewOpen(false);
    }
    
    // Queue expanded card view document when chat becomes hidden
    if (!isChatPanelVisible && expandedCardViewDoc) {
      console.log('📋 [PREVIEW] Chat panel hidden - queueing expanded card view document:', expandedCardViewDoc);
      setPendingExpandedCardViewDoc(expandedCardViewDoc);
      setExpandedCardViewDoc(null);
      setIsAgentOpening(false); // Reset glow state
    }
  }, [isChatPanelVisible, isPreviewOpen, expandedCardViewDoc]);

  // NEW: Set agent task active (for navigation overlay)
  const setAgentTaskActive = React.useCallback((active: boolean, message?: string) => {
    setIsAgentTaskActiveState(active);
    setAgentTaskMessage(message || '');
  }, []);

  // NEW: Stop agent task (for overlay stop button)
  const stopAgentTask = React.useCallback(() => {
    setIsAgentTaskActiveState(false);
    setAgentTaskMessage('');
    setIsMapNavigatingState(false); // Also stop map glow
  }, []);

  // NEW: Set map navigation glow state
  const setMapNavigating = React.useCallback((active: boolean) => {
    setIsMapNavigatingState(active);
  }, []);

  // NEW: Preload file without opening preview (for citation preloading)
  const preloadFile = React.useCallback((file: FileAttachmentData) => {
    setPreviewFiles(prev => {
      // Check if file is already in preview tabs
      const existingTabIndex = prev.findIndex(f => f.id === file.id);
      
      if (existingTabIndex !== -1) {
        // File already cached - update with fresh File object but don't open preview
        const updatedFiles = [...prev];
        updatedFiles[existingTabIndex] = file;
        return updatedFiles;
      } else {
        // Add to cache silently (without opening preview)
        // Limit cache size to MAX_PREVIEW_TABS
        let newFiles: FileAttachmentData[];
        
        if (prev.length >= MAX_PREVIEW_TABS) {
          // Remove oldest tab (first one) and add new one
          // Also clean up PDF cache for removed file
          const removedFile = prev[0];
          if (removedFile) {
            setPdfDocumentCache(cache => {
              const newCache = new Map(cache);
              newCache.delete(removedFile.id);
              return newCache;
            });
          }
          newFiles = [...prev.slice(1), file];
        } else {
          // Add new file to cache
          newFiles = [...prev, file];
        }
        
        return newFiles;
      }
    });
  }, [MAX_PREVIEW_TABS]);

  // NEW: Get cached PDF document (avoids reloading when switching between documents)
  const getCachedPdfDocument = React.useCallback((fileId: string): PDFDocumentProxy | null => {
    return pdfDocumentCache.get(fileId) || null;
  }, [pdfDocumentCache]);

  // NEW: Cache PDF document (keeps it in memory for fast switching)
  const setCachedPdfDocument = React.useCallback((fileId: string, pdf: PDFDocumentProxy | null) => {
    setPdfDocumentCache(prev => {
      const newCache = new Map(prev);
      if (pdf) {
        newCache.set(fileId, pdf);
      } else {
        // Clean up when setting to null
        const removed = newCache.delete(fileId);
        if (removed) {
          // Also clean up rendered page cache for this document
          setRenderedPageCache(pageCache => {
            const newPageCache = new Map(pageCache);
            newPageCache.delete(fileId);
            return newPageCache;
          });
        }
      }
      return newCache;
    });
  }, []);

  // NEW: Get cached rendered page (for instant page switching)
  const getCachedRenderedPage = React.useCallback((fileId: string, pageNumber: number): ImageData | null => {
    const docCache = renderedPageCache.get(fileId);
    return docCache?.get(pageNumber) || null;
  }, [renderedPageCache]);

  // NEW: Cache rendered page (for instant page switching)
  const setCachedRenderedPage = React.useCallback((fileId: string, pageNumber: number, imageData: ImageData | null) => {
    setRenderedPageCache(prev => {
      const newCache = new Map(prev);
      if (imageData) {
        let docCache = newCache.get(fileId);
        if (!docCache) {
          docCache = new Map();
          newCache.set(fileId, docCache);
        }
        docCache.set(pageNumber, imageData);
      } else {
        // Clean up when setting to null
        const docCache = newCache.get(fileId);
        if (docCache) {
          docCache.delete(pageNumber);
          if (docCache.size === 0) {
            newCache.delete(fileId);
          }
        }
      }
      return newCache;
    });
  }, []);

  // NEW: Pre-render PDF page in background (for instant citation navigation)
  // OPTIMIZATION: Made more aggressive - pre-renders immediately without waiting
  // Also prevents duplicate concurrent renders of the same page
  const preloadPdfPage = React.useCallback(async (
    fileId: string,
    pageNumber: number,
    pdf: PDFDocumentProxy,
    scale: number = 1.0
  ): Promise<void> => {
    const cacheKey = `${fileId}:${pageNumber}`;
    
    try {
      // Check if already cached - if so, skip (already instant)
      const cached = getCachedRenderedPage(fileId, pageNumber);
      if (cached) {
        return;
      }

      // Check if already being pre-rendered - prevent duplicate concurrent renders
      if (preRenderingInProgressRef.current.has(cacheKey)) {
        return;
      }

      // Mark as in progress
      preRenderingInProgressRef.current.add(cacheKey);
      
      // OPTIMIZATION: Use requestIdleCallback if available for non-blocking rendering
      // Otherwise render immediately
      const renderPage = async () => {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale, rotation: 0 });
        
        // Create offscreen canvas for rendering
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        
        if (!context) {
          console.warn('⚠️ [PRELOAD] Failed to get canvas context');
          return;
        }

        // Render page to offscreen canvas
        await page.render({
          canvasContext: context,
          viewport
        } as any).promise;

        // Cache the rendered image data
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        setCachedRenderedPage(fileId, pageNumber, imageData);
        
      };
      
      // Use requestIdleCallback for non-blocking rendering, but with a timeout
      // This ensures pages are pre-rendered even if browser is busy
      if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(async () => {
          try {
            await renderPage();
          } finally {
            // Always remove from in-progress set when done
            preRenderingInProgressRef.current.delete(cacheKey);
          }
        }, { timeout: 1000 });
      } else {
        // Fallback: render immediately but don't block
        setTimeout(async () => {
          try {
            await renderPage();
          } finally {
            // Always remove from in-progress set when done
            preRenderingInProgressRef.current.delete(cacheKey);
          }
        }, 0);
      }
    } catch (error) {
      console.warn('⚠️ [PRELOAD] Failed to pre-render page:', error);
      // Remove from in-progress set on error
      preRenderingInProgressRef.current.delete(cacheKey);
    }
  }, [getCachedRenderedPage, setCachedRenderedPage]);

  const addPreviewFile = React.useCallback((file: FileAttachmentData, highlight?: CitationHighlight) => {
    // If chat panel is not visible, queue the file for later (silent background opening)
    if (!isChatPanelVisible) {
      console.log('📋 [PREVIEW] Chat panel hidden - queueing preview file for later:', file.name || file.id);
      setPendingPreviewFiles(prev => {
        // Check if file is already in pending queue
        if (prev.some(f => f.id === file.id)) {
          return prev; // Already queued
        }
        return [...prev, file];
      });
      if (highlight) {
        setPendingPreviewHighlight(highlight);
      }
      return;
    }
    
    // Chat panel is visible - open normally
    setPreviewFiles(prev => {
      // Check if file is already in preview tabs
      const existingTabIndex = prev.findIndex(f => f.id === file.id);
      
      if (existingTabIndex !== -1) {
        // File is already open - refresh the File object to ensure it's valid
        // This fixes the issue where re-selecting the same document fails because the File object is stale
        const updatedFiles = [...prev];
        updatedFiles[existingTabIndex] = file; // Update with fresh File object
        setActivePreviewTabIndex(existingTabIndex);
        setIsPreviewOpen(true);
        
        // Set highlight if provided
        if (highlight) {
          setHighlightCitation({
            ...highlight,
            fileId: file.id
          });
        }
        
        return updatedFiles;
      } else {
        // Add new tab (limit to MAX_PREVIEW_TABS)
        let newFiles: FileAttachmentData[];
        let newActiveIndex: number;
        
        if (prev.length >= MAX_PREVIEW_TABS) {
          // Remove oldest tab (first one) and add new one
          // Clean up PDF cache for removed file
          const removedFile = prev[0];
          if (removedFile) {
            setPdfDocumentCache(cache => {
              const newCache = new Map(cache);
              const pdf = newCache.get(removedFile.id);
              if (pdf) {
                pdf.destroy(); // Clean up PDF.js resources
                newCache.delete(removedFile.id);
              }
              return newCache;
            });
          }
          newActiveIndex = MAX_PREVIEW_TABS - 1;
          newFiles = [...prev.slice(1), file];
        } else {
          // Add new tab
          newActiveIndex = prev.length;
          newFiles = [...prev, file];
        }
        
        setActivePreviewTabIndex(newActiveIndex);
        setIsPreviewOpen(true);
        
        // Set highlight if provided
        if (highlight) {
          setHighlightCitation({
            ...highlight,
            fileId: file.id
          });
        }
        
        return newFiles;
      }
    });
  }, [isChatPanelVisible]);

  // NEW: Gated setIsPreviewOpen - only opens if chat is visible, but always allows closing
  const gatedSetIsPreviewOpen = React.useCallback((open: boolean) => {
    if (open && !isChatPanelVisible) {
      console.log('📋 [PREVIEW] Attempted to open preview but chat panel is hidden - ignoring');
      return;
    }
    // Always allow closing, even if chat is not visible
    setIsPreviewOpen(open);
  }, [isChatPanelVisible]);

  const value = React.useMemo(() => ({
    previewFiles,
    activePreviewTabIndex,
    isPreviewOpen,
    setPreviewFiles,
    setActivePreviewTabIndex,
    setIsPreviewOpen: gatedSetIsPreviewOpen,
    addPreviewFile,
    expandedCardViewDoc,
    setExpandedCardViewDoc,
    openExpandedCardView,
    closeExpandedCardView,
    isAgentOpening,
    setIsAgentOpening,
    isAgentTaskActive,
    agentTaskMessage,
    setAgentTaskActive,
    stopAgentTask,
    isMapNavigating,
    setMapNavigating,
    isChatPanelVisible,
    setIsChatPanelVisible,
    pendingExpandedCardViewDoc,
    clearPendingExpandedCardView,
    pendingPreviewFiles,
    pendingPreviewHighlight,
    preloadFile,
    getCachedPdfDocument,
    setCachedPdfDocument,
    getCachedRenderedPage,
    setCachedRenderedPage,
    preloadPdfPage,
    highlightCitation,
    setHighlightCitation,
    clearHighlightCitation,
    MAX_PREVIEW_TABS
  }), [previewFiles, activePreviewTabIndex, isPreviewOpen, addPreviewFile, preloadFile, getCachedPdfDocument, setCachedPdfDocument, getCachedRenderedPage, setCachedRenderedPage, preloadPdfPage, highlightCitation, clearHighlightCitation, expandedCardViewDoc, openExpandedCardView, closeExpandedCardView, isAgentOpening, isAgentTaskActive, agentTaskMessage, setAgentTaskActive, stopAgentTask, isMapNavigating, setMapNavigating, isChatPanelVisible, pendingExpandedCardViewDoc, clearPendingExpandedCardView, pendingPreviewFiles, pendingPreviewHighlight, gatedSetIsPreviewOpen]);

  return (
    <PreviewContext.Provider value={value}>
      {children}
    </PreviewContext.Provider>
  );
};

export const usePreview = () => {
  const context = React.useContext(PreviewContext);
  if (context === undefined) {
    throw new Error('usePreview must be used within a PreviewProvider');
  }
  return context;
};


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
  
  // ========== DEPRECATED: Document Preview State ==========
  // These are being replaced by ChatStateStore which provides per-chat isolation.
  // Document previews are now stored per-chat to prevent cross-contamination.
  // These remain for backward compatibility during migration.
  // Use ChatStateStore.openDocumentForChat() and ChatStateStore.closeDocumentForChat() instead.
  // =========================================================
  /** @deprecated Use ChatStateStore.getChatState(chatId).documentPreview instead */
  expandedCardViewDoc: { docId: string; filename: string; highlight?: CitationHighlight; scrollRequestId?: number; isAgentTriggered?: boolean } | null;
  /** @deprecated Use ChatStateStore directly */
  setExpandedCardViewDoc: React.Dispatch<React.SetStateAction<{ docId: string; filename: string; highlight?: CitationHighlight; scrollRequestId?: number; isAgentTriggered?: boolean } | null>>;
  /** @deprecated Use ChatStateStore.openDocumentForChat() instead */
  openExpandedCardView: (docId: string, filename: string, highlight?: CitationHighlight, isAgentTriggered?: boolean) => void;
  /** @deprecated Use ChatStateStore.closeDocumentForChat() instead */
  closeExpandedCardView: () => void;
  
  // Agent UI state (still valid - not chat-specific)
  isAgentOpening: boolean;
  setIsAgentOpening: React.Dispatch<React.SetStateAction<boolean>>;
  isAgentTaskActive: boolean;
  agentTaskMessage: string;
  setAgentTaskActive: (active: boolean, message?: string) => void;
  stopAgentTask: () => void;
  isMapNavigating: boolean;
  setMapNavigating: (active: boolean) => void;
  
  // Chat panel visibility (still valid - used for UI gating)
  isChatPanelVisible: boolean;
  setIsChatPanelVisible: React.Dispatch<React.SetStateAction<boolean>>;
  
  // ========== DEPRECATED: Pending Document State ==========
  // No longer needed - ChatStateStore maintains per-chat document preview state.
  // =========================================================
  /** @deprecated No longer needed with ChatStateStore */
  pendingExpandedCardViewDoc: { docId: string; filename: string; highlight?: CitationHighlight } | null;
  /** @deprecated No longer needed with ChatStateStore */
  clearPendingExpandedCardView: () => void;
  /** @deprecated No longer needed with ChatStateStore */
  pendingPreviewFiles: FileAttachmentData[];
  /** @deprecated No longer needed with ChatStateStore */
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
  
  // DEPRECATED: Document preview state - being replaced by ChatStateStore
  // This global state causes cross-contamination between chats.
  // ChatStateStore provides per-chat document preview isolation.
  const [expandedCardViewDoc, setExpandedCardViewDoc] = React.useState<{ docId: string; filename: string; highlight?: CitationHighlight; scrollRequestId?: number; isAgentTriggered?: boolean } | null>(null);
  
  // Agent UI state (not chat-specific)
  const [isAgentOpening, setIsAgentOpening] = React.useState<boolean>(false);
  const [isAgentTaskActive, setIsAgentTaskActiveState] = React.useState<boolean>(false);
  const [agentTaskMessage, setAgentTaskMessage] = React.useState<string>('');
  const [isMapNavigating, setIsMapNavigatingState] = React.useState<boolean>(false);
  
  // Chat panel visibility tracking for document preview gating
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
  // When agent opens a doc we record timestamp; glow on "chat visible" only if this was recent (avoid glow on re-enter)
  const agentOpenedDocAtRef = React.useRef<number>(0);

  const clearHighlightCitation = React.useCallback(() => {
    setHighlightCitation(null);
  }, []);

  // NEW: Open standalone ExpandedCardView
  // Modified to gate document preview based on chat panel visibility
  const openExpandedCardView = React.useCallback((docId: string, filename: string, highlight?: CitationHighlight, isAgentTriggered?: boolean) => {
    // Helper to check if the same document with same highlight is already open
    // This prevents unnecessary re-renders when clicking the same citation twice
    const isSameDocument = () => {
      if (!expandedCardViewDoc) return false;
      if (expandedCardViewDoc.docId !== docId) return false;
      if (expandedCardViewDoc.filename !== filename) return false;
      
      // Compare highlights - both undefined is same, both defined need deep comparison
      const currentHighlight = expandedCardViewDoc.highlight;
      if (!currentHighlight && !highlight) return true;
      if (!currentHighlight || !highlight) return false;
      
      // Compare highlight bbox (the key differentiator)
      if (currentHighlight.fileId !== highlight.fileId) return false;
      if (!currentHighlight.bbox || !highlight.bbox) return currentHighlight.bbox === highlight.bbox;
      
      return (
        currentHighlight.bbox.page === highlight.bbox.page &&
        currentHighlight.bbox.left === highlight.bbox.left &&
        currentHighlight.bbox.top === highlight.bbox.top &&
        currentHighlight.bbox.width === highlight.bbox.width &&
        currentHighlight.bbox.height === highlight.bbox.height
      );
    };
    
    // CRITICAL: For agent-triggered opens, always set expandedCardViewDoc immediately (silent background opening)
    // This ensures the document is "opened" in state even when chat is hidden
    // The document won't be visible because isChatPanelVisible is false, but it will be ready when chat becomes visible
    if (isAgentTriggered) {
      console.log('📂 [PREVIEW] Agent-triggered document open - opening silently in background:', { 
        docId, 
        filename, 
        chatVisible: isChatPanelVisible,
        hasHighlight: !!highlight,
        currentExpandedDoc: expandedCardViewDoc?.docId
      });
      agentOpenedDocAtRef.current = Date.now(); // So we only show glow when chat becomes visible if this was recent
      setIsAgentOpening(true);
      // Always set expandedCardViewDoc immediately for agent actions (silent opening)
      // It won't render until chat becomes visible, but it's already loaded in state
      setExpandedCardViewDoc({ docId, filename, highlight, isAgentTriggered: true });
      console.log('✅ [PREVIEW] expandedCardViewDoc set for agent action - document ready in background');
      return;
    }
    
    // For user-triggered opens, always update state so that re-clicking the same citation
    // triggers a new scrollRequestId and StandaloneExpandedCardView re-scrolls to the citation.
    // (If we skipped when isSameDocument(), re-click would do nothing.)
    const scrollRequestId = Date.now();
    console.log('📂 [PREVIEW] User-triggered document open - setting directly:', { 
      docId, 
      filename,
      chatVisible: isChatPanelVisible,
      scrollRequestId
    });
    setExpandedCardViewDoc({ docId, filename, highlight, scrollRequestId });
  }, [isChatPanelVisible, expandedCardViewDoc]);

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
  // This handles user-triggered documents that were queued when chat was hidden
  // Agent-triggered documents are already in expandedCardViewDoc state (silent background opening)
  React.useEffect(() => {
    if (isChatPanelVisible && pendingExpandedCardViewDoc) {
      console.log('📋 [PREVIEW] Chat panel visible - opening queued user-triggered document:', pendingExpandedCardViewDoc);
      setExpandedCardViewDoc(pendingExpandedCardViewDoc);
      setPendingExpandedCardViewDoc(null);
    }
  }, [isChatPanelVisible, pendingExpandedCardViewDoc]);
  
  // NEW: Effect to restore agent opening state when chat becomes visible with document already open
  // Only show glow when the document was *recently* opened by the agent (e.g. agent opened while chat was hidden).
  // When re-entering a chat that had a document open from before, do NOT show the glow (no opening animation).
  const glowShownForDocRef = React.useRef<string | null>(null);
  const prevChatVisibleRef = React.useRef<boolean>(isChatPanelVisible);

  // Depend only on docId (and visibility) so we don't re-run when object reference changes (e.g. new scrollRequestId)
  const expandedDocId = expandedCardViewDoc?.docId ?? null;
  React.useEffect(() => {
    const chatJustBecameVisible = !prevChatVisibleRef.current && isChatPanelVisible;
    prevChatVisibleRef.current = isChatPanelVisible;

    // Only trigger glow when chat JUST became visible and this document was *recently* opened by the agent
    // (within last 3s). When re-entering a chat that had the doc open from before, agentOpenedDocAtRef is old → no glow.
    const recentlyOpenedByAgent = agentOpenedDocAtRef.current > 0 && (Date.now() - agentOpenedDocAtRef.current) < 3000;
    if (
      chatJustBecameVisible &&
      expandedCardViewDoc &&
      expandedCardViewDoc.isAgentTriggered === true &&
      expandedCardViewDoc.docId !== glowShownForDocRef.current &&
      recentlyOpenedByAgent
    ) {
      console.log('📋 [PREVIEW] Chat panel visible with recently agent-opened document - restoring agent opening state');
      glowShownForDocRef.current = expandedCardViewDoc.docId;
      setIsAgentOpening(true);
      const timer = setTimeout(() => {
        setIsAgentOpening(false);
      }, 2000);
      return () => clearTimeout(timer);
    }

    // Reset glow tracking when document ID actually changes (different doc)
    if (expandedCardViewDoc && expandedCardViewDoc.docId !== glowShownForDocRef.current) {
      glowShownForDocRef.current = null;
    }
  // expandedCardViewDoc in deps for isAgentTriggered; expandedDocId keeps runs minimal when only scrollRequestId changes
  }, [isChatPanelVisible, expandedDocId, expandedCardViewDoc]);

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

  // CRITICAL: When chat becomes hidden, keep expandedCardViewDoc in state (don't queue it)
  // This allows silent background opening - document is already "opened" but not visible
  // When chat becomes visible again, document is already there and appears immediately
  // Only reset agent opening state, but keep the document in state
  // NOTE: We removed the auto-close logic for DocumentPreviewModal because it's rendered
  // in MainContent and can work independently of chat panel visibility
  React.useEffect(() => {
    if (!isChatPanelVisible && expandedCardViewDoc) {
      console.log('📋 [PREVIEW] Chat panel hidden - keeping document in state (silent background, will appear when chat visible):', expandedCardViewDoc);
      setIsAgentOpening(false); // Reset glow state when chat is hidden
      // DON'T clear expandedCardViewDoc - keep it in state for silent background opening
      // DON'T queue it - it's already set, just not visible
    }
  }, [isChatPanelVisible, expandedCardViewDoc]);

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
    // Always open the preview modal, regardless of chat panel visibility
    // The DocumentPreviewModal in MainContent can be displayed independently
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
  }, [setPreviewFiles, setActivePreviewTabIndex, setIsPreviewOpen, setHighlightCitation, setPdfDocumentCache, MAX_PREVIEW_TABS]);

  // Gated setIsPreviewOpen - allows opening/closing regardless of chat visibility
  // DocumentPreviewModal is rendered in MainContent and works independently
  // This was previously gated to prevent reasoning steps from opening previews,
  // but that should be handled at the source (don't call addPreviewFile from reasoning steps)
  const gatedSetIsPreviewOpen = React.useCallback((open: boolean) => {
    // Always allow opening/closing - DocumentPreviewModal can work independently of chat panel
    setIsPreviewOpen(open);
  }, []);

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


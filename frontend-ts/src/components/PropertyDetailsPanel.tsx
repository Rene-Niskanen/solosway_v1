"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { File, X, Upload, FileText, Image as ImageIcon, ArrowUp, CheckSquare, Square, Trash2, Search, SquareMousePointer, Maximize2, Minimize2, Building2, ChevronLeft, ChevronRight, Plus, RefreshCw, Loader2, ChevronDown, FolderOpen } from 'lucide-react';
import { useBackendApi } from './BackendApi';
import { backendApi } from '../services/backendApi';
import { usePreview } from '../contexts/PreviewContext';
import { FileAttachmentData } from './FileAttachment';
import { usePropertySelection } from '../contexts/PropertySelectionContext';
import { useDocumentSelection } from '../contexts/DocumentSelectionContext';
import { PropertyData } from './PropertyResultsDisplay';
import { ReprocessProgressMonitor } from './ReprocessProgressMonitor';
import { useFilingSidebar } from '../contexts/FilingSidebarContext';
import { useChatPanel } from '../contexts/ChatPanelContext';
import { CitationActionMenu } from './CitationActionMenu';
import { usePropertyAccess } from '../hooks/usePropertyAccess';
import veloraLogo from '/Velora Logo.jpg';

// PDF.js for canvas-based PDF rendering with precise highlight positioning
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
// Vite handles this import and returns the correct URL for the worker
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set worker source immediately at module load time
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface PropertyDetailsPanelProps {
  property: any;
  isVisible: boolean;
  onClose: () => void;
  onPropertySelect?: (property: PropertyData) => void;
  isLargeCardMode?: boolean;
  pinPosition?: { x: number; y: number } | null;
  isInChatMode?: boolean; // Add chat mode prop
  chatPanelWidth?: number; // Width of the chat panel (0 when closed)
  sidebarWidth?: number; // Width of the sidebar for centering calculations
}

interface Document {
  id: string;
  original_filename: string;
  classification_type: string;
  classification_confidence: number;
  created_at: string;
  updated_at?: string;
  status: string;
  parsed_text?: string;
  extracted_json?: string;
}

// Global ref for DOCX loaded state (shared across all instances)
if (typeof window !== 'undefined' && !(window as any).__docxLoadedRef) {
  (window as any).__docxLoadedRef = new Set<string>();
}

// Memoized DOCX Card Component - prevents iframe from reloading
// Once loaded, this component NEVER re-renders - completely frozen in final state
const DocxCard: React.FC<{
  docId: string;
  docxUrl: string;
  isLoaded: boolean;
  onLoad: () => void;
}> = React.memo(({ docId, docxUrl, isLoaded, onLoad }) => {
  // Use ref to track if we've already called onLoad to prevent multiple calls
  const hasCalledOnLoadRef = React.useRef(false);
  
  // CRITICAL: Use the SAME key for both states - prevents React from recreating the iframe
  const stableKey = `docx-${docId}`;
  
  // Once loaded, render final state and never change
  if (isLoaded) {
    return (
      <iframe
        key={stableKey}
        src={docxUrl}
        className="absolute top-0 left-0 border-none pointer-events-none bg-white"
        style={{
          width: '250%',
          height: '250%',
          transform: 'scale(0.45)',
          transformOrigin: 'top left',
          zIndex: 1,
          opacity: 1,
          visibility: 'visible',
          position: 'absolute',
          top: 0,
          left: 0,
          willChange: 'auto',
          contain: 'layout style paint', // Prevent layout shifts
          backfaceVisibility: 'hidden', // Prevent flickering
          transformStyle: 'preserve-3d' // Stable 3D context
        }}
        title="preview"
        loading="lazy"
        scrolling="no"
        // No onLoad handler once loaded - prevents any callbacks
      />
    );
  }
  
  // Loading state - will transition to loaded state (SAME key so React reuses the iframe)
  return (
    <>
      <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
        <FileText className="w-8 h-8 text-gray-300" />
      </div>
      <iframe
        key={stableKey}
        src={docxUrl}
        className="absolute top-0 left-0 border-none pointer-events-none bg-white"
        style={{
          width: '250%',
          height: '250%',
          transform: 'scale(0.45)',
          transformOrigin: 'top left',
          zIndex: 0,
          opacity: 0,
          visibility: 'hidden',
          position: 'absolute',
          top: 0,
          left: 0,
          contain: 'layout style paint', // Prevent layout shifts
          backfaceVisibility: 'hidden', // Prevent flickering
          transformStyle: 'preserve-3d' // Stable 3D context
        }}
        title="preview"
        loading="eager"
        scrolling="no"
        onLoad={() => {
          if (!hasCalledOnLoadRef.current) {
            hasCalledOnLoadRef.current = true;
            onLoad();
          }
        }}
      />
    </>
  );
}, (prevProps, nextProps) => {
  // CRITICAL: Once loaded, NEVER re-render - completely frozen
  if (prevProps.isLoaded && nextProps.isLoaded) {
    return true; // Skip re-render - already in final state
  }
  // Only re-render if transitioning from loading to loaded
  return prevProps.isLoaded === nextProps.isLoaded && 
         prevProps.docxUrl === nextProps.docxUrl &&
         prevProps.docId === nextProps.docId;
});

DocxCard.displayName = 'DocxCard';

// Expanded Card View Component - moved outside to prevent recreation on every render
// This prevents refs from being reset when parent component re-renders
const ExpandedCardView: React.FC<{
  selectedDoc: Document | undefined;
  onClose: () => void;
  onDocumentClick: (doc: Document) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  highlightCitation?: { fileId: string; bbox: { left: number; top: number; width: number; height: number; page: number }; block_content?: string; doc_id?: string; original_filename?: string } | null;
  onCitationAction?: (action: 'ask_more' | 'add_to_writing', citation: any) => void;
  propertyId?: string; // Property ID for citation queries
}> = React.memo(({ selectedDoc, onClose, onDocumentClick, isFullscreen, onToggleFullscreen, highlightCitation, onCitationAction, propertyId }) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [blobType, setBlobType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [docxPublicUrl, setDocxPublicUrl] = useState<string | null>(null);
  const [isUploadingDocx, setIsUploadingDocx] = useState(false);
  const createdBlobUrlRef = useRef<string | null>(null); // Track if we created this blob URL
  const isLoadingRef = useRef(false); // Prevent race conditions
  const currentDocIdRef = useRef<string | null>(null); // Track current document ID
  const previewUrlRef = useRef<string | null>(null); // Track preview URL to prevent unnecessary state updates
  
  // Citation action menu state
  const [citationMenuPosition, setCitationMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<any>(null);
  
  // PDF.js state for canvas-based rendering with precise highlight positioning
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [renderedPages, setRenderedPages] = useState<Map<number, { canvas: HTMLCanvasElement; dimensions: { width: number; height: number } }>>(new Map());
  const [baseScale, setBaseScale] = useState<number>(1.0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const pdfPagesContainerRef = useRef<HTMLDivElement>(null);
  const pdfWrapperRef = useRef<HTMLDivElement>(null);
  const hasRenderedRef = useRef<boolean>(false); // Track if we've already rendered this document
  const currentDocIdRefForPdf = useRef<string | null>(null); // Track current document ID for PDF rendering
  
  // Get PDF cache functions from PreviewContext
  const { getCachedPdfDocument, setCachedPdfDocument, getCachedRenderedPage, setCachedRenderedPage } = usePreview();
  
  useEffect(() => {
    if (!selectedDoc) {
      setPreviewUrl(null);
      setBlobType(null);
      setLoading(false);
      setError(null);
      setImageError(false);
      // Don't clear ref here immediately to prevent flash if same doc re-opened
      return;
    }
    
    // Early return: If document ID hasn't changed, skip ALL work to prevent re-renders
    const docId = selectedDoc.id;
    
    // CRITICAL: If document ID is unchanged AND we already have a preview URL, return immediately
    // This prevents the flashing when parent component re-renders (e.g., typing in chat)
    // Check both the ref AND the state to ensure we've already loaded this doc
    if (currentDocIdRef.current === docId && previewUrl !== null) {
      // Document ID unchanged and preview already loaded - do nothing, return silently
      // This prevents any state updates, logging, or re-fetching
      return;
    }
    
    // New document (ID changed) - proceed with loading
    const cachedBlob = (window as any).__preloadedDocumentBlobs?.[docId];
    
    
    // Check cache first (Instagram-style persistent cache)
    if (cachedBlob && cachedBlob.url) {
      // This is a new document (ID changed) - log and update state
      console.log('✅ Using cached preview blob for:', docId);
      previewUrlRef.current = cachedBlob.url; // Update ref first
      setPreviewUrl(cachedBlob.url);
      setBlobType(cachedBlob.type);
      setLoading(false);
      setError(null);
      setImageError(false);
      isLoadingRef.current = false;
      createdBlobUrlRef.current = null; // We didn't create it in this mount, so don't cleanup
      currentDocIdRef.current = docId;
      return;
    }
    
    // If we're already loading this doc, don't restart
    if (isLoadingRef.current && currentDocIdRef.current === docId) {
      return;
    }
    
    currentDocIdRef.current = docId;
    
    const loadPreview = async () => {
      try {
        isLoadingRef.current = true;
        setLoading(true);
        setError(null);
        setImageError(false);
        
        const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
        let downloadUrl: string | null = null;
        
        if ((selectedDoc as any).url || (selectedDoc as any).download_url || (selectedDoc as any).file_url || (selectedDoc as any).s3_url) {
          downloadUrl = (selectedDoc as any).url || (selectedDoc as any).download_url || (selectedDoc as any).file_url || (selectedDoc as any).s3_url || null;
        } else if ((selectedDoc as any).s3_path) {
          downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent((selectedDoc as any).s3_path)}`;
        } else {
          downloadUrl = `${backendUrl}/api/files/download?document_id=${selectedDoc.id}`;
        }
        
        if (!downloadUrl) {
          throw new Error('No download URL available');
        }
        
        const response = await fetch(downloadUrl, {
          credentials: 'include'
        });
        
        if (!response.ok) {
          throw new Error(`Failed to load: ${response.status}`);
        }
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        createdBlobUrlRef.current = url; 
        
        // Cache it globally
        if (!(window as any).__preloadedDocumentBlobs) {
          (window as any).__preloadedDocumentBlobs = {};
        }
        (window as any).__preloadedDocumentBlobs[docId] = {
          url: url,
          type: blob.type,
          timestamp: Date.now()
        };
        
        previewUrlRef.current = url; // Update ref first
        setPreviewUrl(url);
        setBlobType(blob.type);
        setLoading(false);
        isLoadingRef.current = false;
      } catch (err: any) {
        setError(err.message || 'Failed to load preview');
        setLoading(false);
        isLoadingRef.current = false;
        createdBlobUrlRef.current = null;
      }
    };
    
    loadPreview();
    
    return () => {
      // Don't revoke URL on unmount to keep cache alive
      isLoadingRef.current = false;
    };
  }, [selectedDoc?.id]); // Only depend on document ID, not the entire object
  
  // Upload DOCX for Office Online Viewer
  useEffect(() => {
    if (!selectedDoc) {
      setDocxPublicUrl(null);
      setIsUploadingDocx(false);
      return;
    }
    
    // Calculate if this is a DOCX file
    const fileType = (selectedDoc as any).file_type || '';
    const fileName = selectedDoc.original_filename.toLowerCase();
    const isDOCX = 
      fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      fileType === 'application/msword' ||
      fileType.includes('word') ||
      fileType.includes('document') ||
      fileName.endsWith('.docx') ||
      fileName.endsWith('.doc');
    
    if (!isDOCX) {
      setDocxPublicUrl(null);
      setIsUploadingDocx(false);
      return;
    }
    
    // If we already have a public URL for this document, don't re-upload
    if (docxPublicUrl) {
      return;
    }
    
    // Upload DOCX file to get presigned URL for Office Online Viewer
    if (!isUploadingDocx && previewUrl) {
      setIsUploadingDocx(true);
      
      // Fetch the file blob and upload it
      fetch(previewUrl)
        .then(response => response.blob())
        .then(blob => {
          const formData = new FormData();
          formData.append('file', blob, selectedDoc.original_filename);
          
          const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
          return fetch(`${backendUrl}/api/documents/temp-preview`, {
            method: 'POST',
            body: formData,
            credentials: 'include',
          });
        })
        .then(r => r.json())
        .then(data => {
          if (data.presigned_url) {
            setDocxPublicUrl(data.presigned_url);
          } else {
            throw new Error('No presigned URL received');
          }
        })
        .catch(e => {
          console.error('DOCX preview error:', e);
          setError('Failed to load DOCX preview');
        })
        .finally(() => {
          setIsUploadingDocx(false);
        });
    }
  }, [selectedDoc?.id, previewUrl, docxPublicUrl, isUploadingDocx, selectedDoc]);
  
  // Cleanup cache only on full page reload or specific memory management
  // We removed the aggressive cleanup effect to keep blobs alive for cache
  
  if (!selectedDoc) return null;
  
  const fileType = (selectedDoc as any).file_type || '';
  const fileName = selectedDoc.original_filename.toLowerCase();
  
  const isPDF = fileType.includes('pdf') || fileName.endsWith('.pdf') || blobType?.includes('pdf');
  const isImage = 
    fileType.includes('image') || 
    blobType?.startsWith('image/') ||
    fileName.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff)$/i) ||
    fileName.includes('screenshot');
  const isDOCX = 
    fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    fileType === 'application/msword' ||
    fileType.includes('word') ||
    fileType.includes('document') ||
    fileName.endsWith('.docx') ||
    fileName.endsWith('.doc');
  
  // Load PDF with PDF.js for canvas-based rendering (enables precise highlight positioning)
  useEffect(() => {
    if (!isPDF || !previewUrl || !selectedDoc) {
      setPdfDocument(null);
      setRenderedPages(new Map());
      setTotalPages(0);
      hasRenderedRef.current = false;
      currentDocIdRefForPdf.current = null;
      setBaseScale(1.0); // Reset base scale when document changes
      return;
    }

    // Reset render flag when document changes
    if (currentDocIdRefForPdf.current !== selectedDoc.id) {
      hasRenderedRef.current = false;
      currentDocIdRefForPdf.current = selectedDoc.id;
      setBaseScale(1.0);
    }

    let cancelled = false;
    
    const loadPdf = async () => {
      try {
        // Check cache first
        const cachedPdf = getCachedPdfDocument?.(selectedDoc.id);
        if (cachedPdf) {
          console.log('⚡ [PDF_CACHE] Using cached PDF document:', selectedDoc.id);
          if (!cancelled) {
            setPdfDocument(cachedPdf);
            setTotalPages(cachedPdf.numPages);
          }
          return;
        }
        
        console.log('📄 Loading PDF with PDF.js for canvas rendering...');
        const response = await fetch(previewUrl);
        const arrayBuffer = await response.arrayBuffer();
        const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        
        if (cancelled) {
          pdf.destroy();
          return;
        }
        
        console.log('📄 PDF loaded successfully, pages:', pdf.numPages);
        
        // Cache the PDF document
        setCachedPdfDocument?.(selectedDoc.id, pdf);
        
        if (!cancelled) {
          setPdfDocument(pdf);
          setTotalPages(pdf.numPages);
        }
      } catch (error) {
        console.error('❌ Failed to load PDF with PDF.js:', error);
        setError('Failed to load PDF');
      }
    };
    
    loadPdf();
    
    return () => {
      cancelled = true;
    };
  }, [isPDF, previewUrl, selectedDoc?.id, getCachedPdfDocument, setCachedPdfDocument]);

  // Render all PDF pages to canvas for accurate BBOX positioning
  useEffect(() => {
    if (!pdfDocument || !selectedDoc || totalPages === 0) return;
    
    // Skip if we've already rendered this document
    if (hasRenderedRef.current && currentDocIdRefForPdf.current === selectedDoc.id) {
      return;
    }
    
    let cancelled = false;
    
    const renderAllPages = async () => {
      try {
        // Calculate base scale to fit container width
        let scale = baseScale;
        
        if (baseScale === 1.0) {
          try {
            await new Promise(resolve => requestAnimationFrame(resolve));
            await new Promise(resolve => setTimeout(resolve, 50));
            
            if (cancelled) return;
            
            const firstPage = await pdfDocument.getPage(1);
            if (cancelled) return;
            
            const naturalViewport = firstPage.getViewport({ scale: 1.0 });
            const pageWidth = naturalViewport.width;
            
            // Get container width
            let containerWidth = 0;
            if (pdfWrapperRef.current && pdfWrapperRef.current.clientWidth > 100) {
              containerWidth = pdfWrapperRef.current.clientWidth;
            } else if (pdfPagesContainerRef.current && pdfPagesContainerRef.current.clientWidth > 100) {
              containerWidth = pdfPagesContainerRef.current.clientWidth;
            }
            
            if (containerWidth > 100) {
              const availableWidth = containerWidth - 32; // Account for padding
              const fitScale = (availableWidth / pageWidth) * 0.98;
              
              if (fitScale >= 0.8 && fitScale <= 2.5) {
                scale = fitScale;
                setBaseScale(fitScale);
              } else {
                const typicalPageWidth = 595;
                const typicalContainerWidth = 900;
                scale = (typicalContainerWidth / typicalPageWidth) * 0.95;
                scale = Math.max(1.2, Math.min(1.8, scale));
                setBaseScale(scale);
              }
            } else {
              const typicalPageWidth = 595;
              const typicalContainerWidth = 900;
              scale = (typicalContainerWidth / typicalPageWidth) * 0.95;
              scale = Math.max(1.2, Math.min(1.8, scale));
              setBaseScale(scale);
            }
          } catch (error) {
            console.warn('⚠️ Failed to calculate fit scale, using default:', error);
            scale = 1.5;
            setBaseScale(1.5);
          }
        } else {
          scale = baseScale;
        }
        
        console.log('📄 Rendering all PDF pages:', totalPages, 'pages at scale', scale.toFixed(3));
        
        const newRenderedPages = new Map<number, { canvas: HTMLCanvasElement; dimensions: { width: number; height: number } }>();
        
        // Render all pages
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          if (cancelled) break;
          
          try {
            const cachedImageData = getCachedRenderedPage?.(selectedDoc.id, pageNum);
            
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
              console.log('⚡ [PAGE_CACHE] Restored cached page:', selectedDoc.id, 'page', pageNum);
            } else {
              await page.render({
                canvasContext: context,
                viewport
              } as any).promise;
              
              if (scale === 1.0) {
                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                setCachedRenderedPage?.(selectedDoc.id, pageNum, imageData);
              }
            }
            
            newRenderedPages.set(pageNum, {
              canvas,
              dimensions: { width: viewport.width, height: viewport.height }
            });
          } catch (error) {
            console.error(`❌ Failed to render PDF page ${pageNum}:`, error);
          }
        }
        
        if (!cancelled) {
          setRenderedPages(newRenderedPages);
          hasRenderedRef.current = true;
          currentDocIdRefForPdf.current = selectedDoc.id;
          console.log('✅ All PDF pages rendered');
        }
      } catch (error) {
        console.error('❌ Failed to render PDF pages:', error);
      }
    };
    
    renderAllPages();
    
    return () => {
      cancelled = true;
    };
  }, [pdfDocument, selectedDoc?.id, totalPages]); // Removed baseScale and cache functions from dependencies to prevent infinite loops
  

  // Auto-scroll to highlight when citation is clicked - center BBOX both vertically and horizontally
  useEffect(() => {
    if (highlightCitation && highlightCitation.fileId === selectedDoc?.id && highlightCitation.bbox && renderedPages.size > 0 && pdfWrapperRef.current) {
      const targetPage = highlightCitation.bbox.page;
      const pageData = renderedPages.get(targetPage);
      
      if (pageData) {
        // Calculate the vertical position of the BBOX center on the page
        const bboxTop = highlightCitation.bbox.top * pageData.dimensions.height;
        const bboxHeight = highlightCitation.bbox.height * pageData.dimensions.height;
        const bboxCenterY = bboxTop + (bboxHeight / 2);
        
        // Calculate the horizontal position of the BBOX center on the page
        const bboxLeft = highlightCitation.bbox.left * pageData.dimensions.width;
        const bboxWidth = highlightCitation.bbox.width * pageData.dimensions.width;
        const bboxCenterX = bboxLeft + (bboxWidth / 2);
        
        // Calculate scroll position: sum of all previous pages' heights
        let pageOffset = 0;
        for (let i = 1; i < targetPage; i++) {
          const prevPage = renderedPages.get(i);
          if (prevPage) {
            pageOffset += prevPage.dimensions.height + 16; // 16px gap between pages
          }
        }
        
        // Calculate the absolute position of the BBOX center in the document
        const bboxCenterAbsoluteY = pageOffset + bboxCenterY;
        
        // Scroll to center BBOX
        requestAnimationFrame(() => {
          if (pdfWrapperRef.current) {
            const viewportHeight = pdfWrapperRef.current.clientHeight;
            const viewportWidth = pdfWrapperRef.current.clientWidth;
            
            // Calculate scroll position to center the BBOX vertically
            const scrollTop = bboxCenterAbsoluteY - (viewportHeight / 2);
            
            // Calculate scroll position to center the BBOX horizontally
            const scrollLeft = bboxCenterX - (viewportWidth / 2);
            
            const maxScrollTop = Math.max(0, pdfWrapperRef.current.scrollHeight - viewportHeight);
            const maxScrollLeft = Math.max(0, pdfWrapperRef.current.scrollWidth - viewportWidth);
            
            pdfWrapperRef.current.scrollTo({
              top: Math.max(0, Math.min(scrollTop, maxScrollTop)),
              left: Math.max(0, Math.min(scrollLeft, maxScrollLeft)),
              behavior: 'smooth'
            });
          }
        });
      }
    }
  }, [highlightCitation, selectedDoc?.id, renderedPages]);
  

  const previewContent = (
    <motion.div
      key={`expanded-${selectedDoc.id}`}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className={isFullscreen ? "fixed inset-0 bg-white flex flex-col z-[10000]" : "absolute inset-0 bg-white flex flex-col z-20"}
      style={{
        // Prevent re-rendering during parent layout changes
        isolation: 'isolate',
        contain: 'layout style paint',
        willChange: 'auto',
        // Ensure fullscreen covers entire viewport
        ...(isFullscreen ? {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100vw',
          height: '100vh'
        } : {})
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
        {/* Preview Header */}
        <div className="h-14 px-4 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0">
              {isPDF ? <FileText size={16} className="text-slate-700" /> : 
               isImage ? <ImageIcon size={16} className="text-purple-500" /> : 
               isDOCX ? <FileText size={16} className="text-slate-700" /> :
               <File size={16} className="text-gray-400" />}
            </div>
            <div className="flex flex-col min-w-0">
              <h3 className="text-sm font-medium text-gray-900 truncate">{selectedDoc.original_filename}</h3>
              <span className="text-xs text-gray-500">
                {new Date(selectedDoc.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Fullscreen Toggle Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFullscreen();
              }}
              className="p-2 hover:bg-gray-50 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
            
            <div className="w-px h-4 bg-gray-200 mx-1" />
            
            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-2 hover:bg-red-50 hover:text-red-500 rounded-lg text-gray-400 transition-colors"
              title="Close Preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        {/* Preview Content Area */}
        <div 
          className="flex-1 overflow-hidden bg-gray-50 relative"
          style={{
            // Optimize rendering to prevent glitches during parent layout changes
            willChange: 'auto',
            contain: 'layout style paint', // Isolate rendering to prevent parent layout from affecting preview
            isolation: 'isolate', // Create a new stacking context to prevent re-renders
            transform: 'translateZ(0)' // Force GPU acceleration and isolation
          }}
        >
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
              <div className="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          </div>
          )}
          
          {error && (
            <div className="flex items-center justify-center h-full text-red-500 gap-2">
               <span className="text-sm">{error}</span>
            </div>
          )}

          {(previewUrl || docxPublicUrl) && !loading && !error && (
            <div 
              className="w-full h-full flex items-center justify-center"
              style={{
                // Prevent re-rendering during parent layout changes
                isolation: 'isolate'
              }}
            >
              {isPDF ? (
                <div 
                  ref={pdfWrapperRef}
                  className="w-full h-full overflow-auto bg-gray-100"
                  style={{ scrollBehavior: 'smooth' }}
                >
                  {renderedPages.size > 0 ? (
                    <div
                      ref={pdfPagesContainerRef}
                  style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        width: '100%',
                        padding: '16px 0'
                      }}
                    >
                      {Array.from(renderedPages.entries()).map(([pageNum, pageData]) => {
                        const pageDimensions = pageData.dimensions;
                        const isHighlightPage = highlightCitation && highlightCitation.fileId === selectedDoc.id && highlightCitation.bbox && highlightCitation.bbox.page === pageNum;
                        
                        return (
                          <div
                            key={`page-${pageNum}`}
                            style={{
                              position: 'relative',
                              width: `${pageDimensions.width}px`,
                              margin: '0 auto 16px auto',
                              display: 'block'
                            }}
                          >
                            <canvas
                              ref={(el) => {
                                if (el && pageData.canvas) {
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
                                height: `${pageDimensions.height}px`
                              }}
                            />
                            
                            {/* BBOX Highlight Overlay - positioned accurately using page dimensions */}
                            {isHighlightPage && highlightCitation && highlightCitation.bbox && (() => {
                              // Calculate logo size: fixed height = slightly larger to better match small BBOX highlights (2.0% of page height, minus 1px for bottom alignment)
                              const logoHeight = 0.02 * pageDimensions.height - 1;
                              // Assume logo is roughly square or slightly wider (adjust aspect ratio as needed)
                              const logoWidth = logoHeight; // Square logo, adjust if needed
                              // Calculate BBOX dimensions with centered padding
                              const padding = 4; // Equal padding on all sides
                              const originalBboxWidth = highlightCitation.bbox.width * pageDimensions.width;
                              const originalBboxHeight = highlightCitation.bbox.height * pageDimensions.height;
                              const originalBboxLeft = highlightCitation.bbox.left * pageDimensions.width;
                              const originalBboxTop = highlightCitation.bbox.top * pageDimensions.height;
                              
                              // Calculate center of original BBOX
                              const centerX = originalBboxLeft + originalBboxWidth / 2;
                              const centerY = originalBboxTop + originalBboxHeight / 2;
                              
                              // Calculate minimum BBOX height to match logo height (prevents staggered appearance)
                              const minBboxHeightPx = logoHeight; // Minimum height = logo height
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
                              const constrainedLeft = Math.min(bboxLeft, pageDimensions.width - finalBboxWidth);
                              const constrainedTop = Math.min(bboxTop, pageDimensions.height - finalBboxHeight);
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
                                      const pageRect = e.currentTarget.closest('.pdf-page-container')?.getBoundingClientRect();
                                      if (pageRect) {
                                        setSelectedCitation(highlightCitation);
                                        // Position menu at click location (use click X, below citation Y)
                                        setCitationMenuPosition({
                                          x: e.clientX, // Use actual click X position
                                          y: rect.bottom + 8 // Position below with 8px gap
                                        });
                                      }
                                    }}
                                    style={{
                                      position: 'absolute',
                                      left: `${finalBboxLeft}px`,
                                      top: `${finalBboxTop}px`,
                                      width: `${Math.min(pageDimensions.width, finalBboxWidth)}px`,
                                      height: `${Math.min(pageDimensions.height, finalBboxHeight)}px`,
                                      backgroundColor: 'rgba(255, 235, 59, 0.4)',
                                      border: '2px solid rgba(255, 193, 7, 0.9)',
                                      borderRadius: '2px',
                      pointerEvents: 'auto',
                                      cursor: 'pointer',
                                      zIndex: 10,
                                      boxShadow: '0 2px 8px rgba(255, 193, 7, 0.3)',
                                      transformOrigin: 'top left',
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
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                    </div>
                  )}
                </div>
              ) : isImage ? (
                <img
                  key={selectedDoc.id} // Stable key prevents image reload
                  src={previewUrl!}
                  alt={selectedDoc.original_filename}
                  className="max-w-full max-h-full object-contain p-4"
                  onError={() => setImageError(true)}
                  onLoad={() => setImageError(false)}
                  style={{
                    // Prevent image from re-rendering
                    imageRendering: 'auto',
                    isolation: 'isolate', // Isolate image rendering
                    transform: 'translateZ(0)' // Force GPU layer
                  }}
                />
              ) : isDOCX && docxPublicUrl ? (
                <iframe
                  key={`docx-${selectedDoc.id}`} // Stable key prevents iframe reload
                  src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(docxPublicUrl)}&action=embedview&wdEmbedCode=0&ui=2`}
                  className="w-full h-full border-0"
                  title={selectedDoc.original_filename}
                  style={{
                    // Prevent iframe from reloading during layout changes
                    pointerEvents: 'auto',
                    isolation: 'isolate', // Isolate iframe rendering
                    transform: 'translateZ(0)' // Force GPU layer
                  }}
                />
              ) : isDOCX && isUploadingDocx ? (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                  <div className="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-4" />
                  <p className="text-sm text-gray-600">Preparing document preview...</p>
                </div>
              ) : (
                 /* Fallback for other types */
                <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                  <div className="w-20 h-20 bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center mb-4">
                    <FileText className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-900 mb-1">{selectedDoc.original_filename}</p>
                  <p className="text-xs text-gray-500 mb-6">Preview not available for this file type</p>
                  <button
                    onClick={() => onDocumentClick(selectedDoc)}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-xs font-medium shadow-sm"
                  >
                    Download File
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Citation Action Menu */}
        {citationMenuPosition && selectedCitation && (
          <CitationActionMenu
            citation={selectedCitation}
            position={citationMenuPosition}
            propertyId={propertyId}
            onClose={() => {
              setCitationMenuPosition(null);
              setSelectedCitation(null);
            }}
            onAskMore={(citation) => {
              if (onCitationAction) {
                onCitationAction('ask_more', citation);
              }
            }}
            onAddToWriting={(citation) => {
              if (onCitationAction) {
                onCitationAction('add_to_writing', citation);
              }
            }}
          />
        )}
      </motion.div>
  );

  // Always render with AnimatePresence, but use portal for fullscreen to escape parent constraints
  const content = (
    <AnimatePresence mode="wait">
      {previewContent}
    </AnimatePresence>
  );

  // When fullscreen, render in a portal to escape parent constraints
  if (isFullscreen) {
    return createPortal(content, document.body);
  }

  // Normal mode - render inline
  return content;
}, (prevProps, nextProps) => {
  // Only re-render if the document or fullscreen state actually changed (return true if props are equal = skip re-render)
  // Compare by document ID and fullscreen state - callbacks are stable via useCallback
  return prevProps.selectedDoc?.id === nextProps.selectedDoc?.id && 
         prevProps.isFullscreen === nextProps.isFullscreen;
});

ExpandedCardView.displayName = 'ExpandedCardView';

export const PropertyDetailsPanel: React.FC<PropertyDetailsPanelProps> = ({
  property,
  isVisible,
  onClose,
  onPropertySelect,
  isLargeCardMode = false,
  pinPosition = null,
  isInChatMode = false, // Default to false
  chatPanelWidth = 0, // Default to 0 (chat panel closed)
  sidebarWidth = 0 // Default to 0 (will be passed from parent for centering)
}) => {
  // Determine if chat panel is actually open based on width
  const isChatPanelOpen = chatPanelWidth > 0 || isInChatMode;
  
  // FilingSidebar integration
  const { openSidebar: openFilingSidebar, setSelectedProperty, setViewMode, width: filingSidebarWidth, isOpen: isFilingSidebarOpen } = useFilingSidebar();
  // ChatPanel integration
  const { isOpen: isChatPanelOpenContext, width: chatPanelWidthContext } = useChatPanel();
  
  // Property access control
  const { accessLevel, canUpload, canDelete, isLoading: isLoadingAccess } = usePropertyAccess(property?.id);
  
  // Calculate the left position for property details panel
  // Property details should start where the chat panel ends
  const propertyDetailsLeft = React.useMemo(() => {
    if (!isChatPanelOpen) return 'auto';
    
    // When in fullscreen property view (from Projects page) with isInChatMode
    // Use chatPanelWidth + sidebarWidth for proper resize tracking
    if (sidebarWidth && isInChatMode && chatPanelWidth > 0) {
      // Chat panel starts at sidebarWidth and has width chatPanelWidth
      // So property details starts at sidebarWidth + chatPanelWidth
      return sidebarWidth + chatPanelWidth;
    }
    
    // Fallback for other cases (map view, etc.) - use numeric calculation
    // Base calculation: chatPanelWidth (this works when filing sidebar is closed)
    let left = chatPanelWidth;
    
    // If filing sidebar is open, we need to add its width to account for the shift
    // The chat panel shifts right by: toggleRailWidth (12px) + filingSidebarWidth
    if (isFilingSidebarOpen) {
      const toggleRailWidth = 12;
      left = chatPanelWidth + toggleRailWidth + filingSidebarWidth;
    }
    
    return Math.max(left, 320); // Minimum 320px like old commit
  }, [isChatPanelOpen, isFilingSidebarOpen, filingSidebarWidth, chatPanelWidth, sidebarWidth, isInChatMode]);
  
  // Track when chat panel is resizing to disable layout animations
  const [isChatPanelResizing, setIsChatPanelResizing] = React.useState<boolean>(false);
  const prevChatPanelWidthRef = React.useRef<number>(chatPanelWidth);
  
  // Detect when chatPanelWidth is changing (resizing) and disable layout animations
  React.useEffect(() => {
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
  const backendApiContext = useBackendApi();
  const { isSelectionModeActive, addPropertyAttachment, propertyAttachments } = usePropertySelection();
  
  // Check if this property is already selected
  const currentPropertyId = property?.id?.toString() || property?.property_id?.toString();
  const isPropertySelected = propertyAttachments.some(
    p => (p.propertyId?.toString() || p.propertyId) === currentPropertyId?.toString()
  );
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cachedCoversVersion, setCachedCoversVersion] = useState(0); // Triggers re-render when covers are cached
  const docxLoadedRef = useRef<Set<string>>(new Set()); // Track which DOCX iframes have loaded
  // Track which covers have been rendered with their final src - prevent src changes
  const renderedCoversRef = useRef<Map<string, string>>(new Map()); // docId -> final src URL
  // Store actual DOM elements - once rendered, reuse them directly to prevent React from recreating
  const coverElementsRef = useRef<Map<string, HTMLElement>>(new Map()); // docId -> actual DOM element
  const [isFilesModalOpen, setIsFilesModalOpen] = useState(false);
  const [filesSearchQuery, setFilesSearchQuery] = useState<string>(''); // Search query for filtering documents
  const [selectedCardIndex, setSelectedCardIndex] = useState<number | null>(null); // Track which card is expanded
  const [hoveredCardIndex, setHoveredCardIndex] = useState<number | null>(null); // Track hover state for wave effect
  const [isFullscreen, setIsFullscreen] = useState(false); // Fullscreen state for document preview
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null); // Selected image for preview
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadProgressRef = useRef<number>(0); // Track progress to prevent backward jumps
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingToDelete, setIsDraggingToDelete] = useState(false);
  const [draggedDocumentId, setDraggedDocumentId] = useState<string | null>(null);
  // Use document selection context
  const {
    selectedDocumentIds,
    isDocumentSelectionMode: isChatSelectionMode,
    toggleDocumentSelection,
    clearSelectedDocuments,
    setDocumentSelectionMode
  } = useDocumentSelection();
  
  // Local selection mode for PropertyDetailsPanel (for deletion)
  // This is separate from chat selection mode (for querying)
  const [isLocalSelectionMode, setIsLocalSelectionMode] = useState(false);
  const [localSelectedDocumentIds, setLocalSelectedDocumentIds] = useState<Set<string>>(new Set());
  
  // Combined selection mode: true if either chat mode or local mode is active
  const isSelectionMode = isChatSelectionMode || isLocalSelectionMode;
  
  // Use ref to track current selection mode to avoid stale closures in click handlers
  const isSelectionModeRef = React.useRef(isSelectionMode);
  
  // Debug: Log when selection mode changes
  React.useEffect(() => {
    isSelectionModeRef.current = isSelectionMode;
    console.log('🔍 PropertyDetailsPanel: Selection mode changed:', {
      isSelectionMode,
      isChatSelectionMode,
      isLocalSelectionMode,
      selectedDocumentIdsSize: selectedDocumentIds.size
    });
  }, [isSelectionMode, isChatSelectionMode, isLocalSelectionMode, selectedDocumentIds.size]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Reprocess state
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [reprocessingDocumentId, setReprocessingDocumentId] = useState<string | null>(null);
  const [reprocessDropdownOpen, setReprocessDropdownOpen] = useState(false);
  const [reprocessResult, setReprocessResult] = useState<{ success: boolean; message: string } | null>(null);
  // Filter state
  const [activeFilter, setActiveFilter] = useState<'all' | 'images' | 'pdfs'>('all');
  
  // Section order - persisted in localStorage
  const [sectionOrder, setSectionOrder] = useState<('documents' | 'propertyDetails')[]>(() => {
    // Load persisted order from localStorage
    if (typeof window !== 'undefined') {
      const savedOrder = localStorage.getItem('propertyDetailsPanel_sectionOrder');
      if (savedOrder) {
        try {
          const parsed = JSON.parse(savedOrder);
          // Validate that it contains both sections
          if (Array.isArray(parsed) && parsed.length === 2 && 
              parsed.includes('documents') && parsed.includes('propertyDetails')) {
            return parsed;
          }
        } catch (e) {
          console.error('Failed to parse saved section order:', e);
        }
      }
    }
    // Default order
    return ['documents', 'propertyDetails'];
  });
  
  // Section state - determines which view we're in
  // Default to the first tab in the order (leftmost tab)
  // Editable field state management
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [savingFields, setSavingFields] = useState<Set<string>>(new Set());
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  
  // Debounce timers for each field to prevent spamming the database
  const saveTimersRef = useRef<Record<string, NodeJS.Timeout>>({});
  // Track pending saves to cancel them if user edits again
  const pendingSavesRef = useRef<Record<string, AbortController>>({});
  
  // Refs for textarea auto-resize
  const amenitiesTextareaRef = useRef<HTMLTextAreaElement>(null);
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Local state for property details to enable optimistic updates
  const [localPropertyDetails, setLocalPropertyDetails] = useState<any>(null);
  
  // Sync local property details with prop when property changes
  useEffect(() => {
    if (property?.propertyHub?.property_details) {
      setLocalPropertyDetails({ ...property.propertyHub.property_details });
    } else {
      setLocalPropertyDetails({});
    }
  }, [property?.propertyHub?.property_details, property?.id]);

  // Cleanup: Cancel all pending saves and timers on unmount
  useEffect(() => {
    return () => {
      // Cancel all pending timers
      Object.values(saveTimersRef.current).forEach(timer => {
        if (timer) clearTimeout(timer);
      });
      saveTimersRef.current = {};
      
      // Abort all pending API calls
      Object.values(pendingSavesRef.current).forEach(controller => {
        if (controller) controller.abort();
      });
      pendingSavesRef.current = {};
    };
  }, []);

  const [activeSection, setActiveSection] = useState<'documents' | 'propertyDetails'>(() => {
    // Load persisted order to determine initial active section
    if (typeof window !== 'undefined') {
      const savedOrder = localStorage.getItem('propertyDetailsPanel_sectionOrder');
      if (savedOrder) {
        try {
          const parsed = JSON.parse(savedOrder);
          if (Array.isArray(parsed) && parsed.length > 0 && 
              (parsed[0] === 'documents' || parsed[0] === 'propertyDetails')) {
            return parsed[0];
          }
        } catch (e) {
          // Fall through to default
        }
      }
    }
    return 'documents'; // Default
  });
  
  // When panel becomes visible, ensure we're showing the leftmost tab
  useEffect(() => {
    if (isVisible && sectionOrder.length > 0) {
      // Only update if we're not already on the leftmost tab
      // This prevents switching tabs when user is just reordering
      const leftmostTab = sectionOrder[0];
      if (activeSection !== leftmostTab) {
        setActiveSection(leftmostTab);
      }
    }
  }, [isVisible]); // Only run when visibility changes, not when sectionOrder changes
  
  // Drag state for tab reordering
  const [draggedTabIndex, setDraggedTabIndex] = useState<number | null>(null);
  const [draggedSection, setDraggedSection] = useState<'documents' | 'propertyDetails' | null>(null);
  const [dragOverSection, setDragOverSection] = useState<'documents' | 'propertyDetails' | null>(null);
  const [previewOrder, setPreviewOrder] = useState<('documents' | 'propertyDetails')[] | null>(null);
  
  // Use refs to track drag state - avoids closure issues and prevents spamming
  const lastDragOverSectionRef = useRef<'documents' | 'propertyDetails' | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const draggedSectionRef = useRef<'documents' | 'propertyDetails' | null>(null);
  const sectionOrderRef = useRef<('documents' | 'propertyDetails')[]>(sectionOrder);
  const previewOrderRef = useRef<('documents' | 'propertyDetails')[] | null>(null);
  
  // Sync refs with state
  useEffect(() => {
    sectionOrderRef.current = sectionOrder;
  }, [sectionOrder]);
  
  useEffect(() => {
    draggedSectionRef.current = draggedSection;
  }, [draggedSection]);
  
  useEffect(() => {
    previewOrderRef.current = previewOrder;
  }, [previewOrder]);
  
  // Use preview order during drag, otherwise use actual order
  const displayOrder = previewOrder || sectionOrder;
  
  // Throttle preview updates using requestAnimationFrame
  // This function uses refs to avoid closure issues and prevent unnecessary work
  const updatePreviewOrder = useCallback((targetSection: 'documents' | 'propertyDetails') => {
    // Cancel any pending update
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    
    // Schedule update for next frame
    rafIdRef.current = requestAnimationFrame(() => {
      // Use refs to get current values (avoid stale closures)
      const currentDraggedSection = draggedSectionRef.current;
      const currentSectionOrder = sectionOrderRef.current;
      
      if (currentDraggedSection !== null && targetSection !== currentDraggedSection) {
        // Create preview order
        const newPreviewOrder = [...currentSectionOrder];
        const draggedIndex = newPreviewOrder.indexOf(currentDraggedSection);
        newPreviewOrder.splice(draggedIndex, 1);
        const targetIndex = currentSectionOrder.indexOf(targetSection);
        newPreviewOrder.splice(targetIndex, 0, currentDraggedSection);
        
        // Only update if order actually changed
        const currentOrder = previewOrderRef.current || currentSectionOrder;
        const orderChanged = JSON.stringify(newPreviewOrder) !== JSON.stringify(currentOrder);
        
        if (orderChanged) {
          setDragOverSection(targetSection);
          setPreviewOrder(newPreviewOrder);
        }
      }
      rafIdRef.current = null;
    });
  }, []); // No dependencies - uses refs instead
  
  // Save order to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('propertyDetailsPanel_sectionOrder', JSON.stringify(sectionOrder));
    }
  }, [sectionOrder]);

  // Store original pin coordinates (user-set location) - don't let backend data override them
  const originalPinCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  
  // Helper function to save property to recent projects (only when user actually interacts)
  const saveToRecentProjects = React.useCallback((propertyToSave: any) => {
    if (!propertyToSave || !propertyToSave.id || !propertyToSave.address) {
      return;
    }
    
    // Only save real properties (not temp ones)
    if (propertyToSave.id.startsWith('temp-')) {
      return;
    }
    
    // Calculate document count using the same logic as PropertyDetailsPanel display
    let docCount = 0;
    if (documents.length > 0) {
      docCount = documents.length;
    } else if (propertyToSave.propertyHub?.documents?.length) {
      docCount = propertyToSave.propertyHub.documents.length;
    } else if (propertyToSave.documentCount) {
      docCount = propertyToSave.documentCount;
    } else if (propertyToSave.document_count) {
      docCount = propertyToSave.document_count;
    }
    
    // CRITICAL: Save property pin location (user-set final coordinates from Create Property Card), not document-extracted coordinates
    // This is where the user placed/confirmed the pin. Prioritize explicitly provided coordinates
    const pinLatitude = originalPinCoordsRef.current?.lat || propertyToSave.latitude;
    const pinLongitude = originalPinCoordsRef.current?.lng || propertyToSave.longitude;
    
    // Use the utility function to save to array
    import('../utils/recentProjects').then((module) => {
      module.saveToRecentProjects({
      id: propertyToSave.id,
      address: propertyToSave.address,
      latitude: pinLatitude, // Property pin location (user-set), not document-extracted coordinates
      longitude: pinLongitude, // Property pin location (user-set), not document-extracted coordinates
      primary_image_url: propertyToSave.primary_image_url || propertyToSave.image,
      documentCount: docCount,
      timestamp: new Date().toISOString()
      });
    }).catch((error) => {
      console.error('Error saving to recent projects:', error);
    });
  }, [documents.length]);
  
  // State for cached property card data
  const [cachedPropertyData, setCachedPropertyData] = useState<any>(() => {
    // Synchronously check cache when component initializes - no useEffect delay
    if (property && property.id) {
      try {
        const cacheKey = `propertyCardCache_${property.id}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const cacheData = JSON.parse(cached);
          const CACHE_MAX_AGE = 30 * 60 * 1000; // 30 minutes
          const cacheAge = Date.now() - cacheData.timestamp;
          
          if (cacheAge < CACHE_MAX_AGE && cacheData.data) {
            console.log('✅ INSTANT: PropertyDetailsPanel initialized with cached data (synchronous)');
            return cacheData.data;
          }
        }
      } catch (e) {
        console.warn('Failed to read cache on init:', e);
      }
    }
    return null;
  });
  
  // Use shared preview context
  const { addPreviewFile, highlightCitation, setHighlightCitation } = usePreview();
  
  // Sync ref with state
  React.useEffect(() => {
    isFilesModalOpenRef.current = isFilesModalOpen;
  }, [isFilesModalOpen]);
  const [hasFilesFetched, setHasFilesFetched] = useState(false);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [showEmptyState, setShowEmptyState] = useState(false);
  const isFilesModalOpenRef = useRef(false); // Track modal state in ref to avoid race conditions

  // Load property card summary from cache or fetch from backend
  useEffect(() => {
    if (property && property.id) {
      const propertyId = property.id;
      
      // IMPORTANT: Store original pin coordinates BEFORE backend fetch might override them
      if (property.latitude && property.longitude) {
        originalPinCoordsRef.current = { lat: property.latitude, lng: property.longitude };
      } else {
        originalPinCoordsRef.current = null;
      }
    }
  }, [property?.id]);

  // Helper functions for formatting numbers with commas
  const formatNumberWithCommas = (value: number | string | null | undefined): string => {
    if (value === null || value === undefined || value === '') return '';
    const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
    if (isNaN(num)) return '';
    return num.toLocaleString('en-US');
  };

  const removeCommas = (value: string): string => {
    return value.replace(/,/g, '');
  };

  // Helper functions for editable fields
  const startEditing = (fieldName: string, currentValue: any) => {
    // Cancel any pending save for this field when starting to edit
    if (saveTimersRef.current[fieldName]) {
      clearTimeout(saveTimersRef.current[fieldName]);
      delete saveTimersRef.current[fieldName];
    }
    // Cancel any pending API call for this field
    if (pendingSavesRef.current[fieldName]) {
      pendingSavesRef.current[fieldName].abort();
      delete pendingSavesRef.current[fieldName];
    }
    
    setEditingField(fieldName);
    const priceFields = ['asking_price', 'sold_price', 'rent_pcm'];
    let displayValue = '';
    
    if (currentValue !== null && currentValue !== undefined) {
      if (priceFields.includes(fieldName)) {
        // Format price fields with commas
        displayValue = formatNumberWithCommas(currentValue);
            } else {
        displayValue = String(currentValue);
      }
    }
    
    setEditValues(prev => ({
      ...prev,
      [fieldName]: displayValue
    }));
    setFieldErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[fieldName];
      return newErrors;
    });
    
    // Auto-resize textareas when editing starts
    requestAnimationFrame(() => {
      if (fieldName === 'other_amenities' && amenitiesTextareaRef.current) {
        amenitiesTextareaRef.current.style.height = 'auto';
        amenitiesTextareaRef.current.style.height = `${amenitiesTextareaRef.current.scrollHeight}px`;
      } else if (fieldName === 'notes' && notesTextareaRef.current) {
        notesTextareaRef.current.style.height = 'auto';
        notesTextareaRef.current.style.height = `${notesTextareaRef.current.scrollHeight}px`;
      }
    });
  };

  const handleFieldChange = (fieldName: string, value: string) => {
    const priceFields = ['asking_price', 'sold_price', 'rent_pcm'];
    
    if (priceFields.includes(fieldName)) {
      // Allow only digits and commas, remove any other characters
      const cleaned = value.replace(/[^\d,]/g, '');
      // Format with commas as user types
      const withoutCommas = removeCommas(cleaned);
      if (withoutCommas === '') {
        setEditValues(prev => ({ ...prev, [fieldName]: '' }));
        return;
      }
      const num = parseFloat(withoutCommas);
      if (!isNaN(num)) {
        const formatted = formatNumberWithCommas(num);
        setEditValues(prev => ({ ...prev, [fieldName]: formatted }));
      } else {
        setEditValues(prev => ({ ...prev, [fieldName]: cleaned }));
      }
    } else {
      setEditValues(prev => ({
        ...prev,
        [fieldName]: value
      }));
      
      // Auto-resize textareas for amenities and notes
      if (fieldName === 'other_amenities' && amenitiesTextareaRef.current) {
        amenitiesTextareaRef.current.style.height = 'auto';
        amenitiesTextareaRef.current.style.height = `${amenitiesTextareaRef.current.scrollHeight}px`;
      } else if (fieldName === 'notes' && notesTextareaRef.current) {
        notesTextareaRef.current.style.height = 'auto';
        notesTextareaRef.current.style.height = `${notesTextareaRef.current.scrollHeight}px`;
      }
    }
  };

  const validateField = (fieldName: string, value: string): string | null => {
    const numericFields = ['number_bedrooms', 'number_bathrooms', 'size_sqft', 'asking_price', 'sold_price', 'rent_pcm'];
    
    if (numericFields.includes(fieldName)) {
      if (value.trim() === '') {
        return null; // Empty is valid (will set to null)
      }
      // Remove commas before parsing
      const cleanedValue = removeCommas(value.trim());
      const num = fieldName === 'size_sqft' || fieldName.includes('price') || fieldName === 'rent_pcm' 
        ? parseFloat(cleanedValue) 
        : parseInt(cleanedValue, 10);
      if (isNaN(num) || num < 0) {
        return 'Please enter a valid number';
      }
    }
    return null;
  };
  
  const saveField = async (fieldName: string, value: string) => {
    // Cancel any pending save for this field to prevent duplicate saves
    if (pendingSavesRef.current[fieldName]) {
      pendingSavesRef.current[fieldName].abort();
      delete pendingSavesRef.current[fieldName];
    }
    
    // Cancel any pending timer
    if (saveTimersRef.current[fieldName]) {
      clearTimeout(saveTimersRef.current[fieldName]);
      delete saveTimersRef.current[fieldName];
    }
    
    // Get property ID - try multiple possible locations
    const propertyId = property?.id?.toString() || property?.property_id?.toString() || property?.propertyHub?.property?.id?.toString();
    
    if (!propertyId) {
      console.error('Cannot save: property ID not found', property);
      setFieldErrors(prev => ({ ...prev, [fieldName]: 'Property ID not found' }));
      return;
    }

    const error = validateField(fieldName, value);
    if (error) {
      setFieldErrors(prev => ({ ...prev, [fieldName]: error }));
      return;
    }

    // Create abort controller for this save
    const abortController = new AbortController();
    pendingSavesRef.current[fieldName] = abortController;

    setSavingFields(prev => new Set(prev).add(fieldName));
    setFieldErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[fieldName];
      return newErrors;
    });

    try {
      // Parse value based on field type
      let parsedValue: any = value.trim() === '' ? null : value;
      const numericFields = ['number_bedrooms', 'number_bathrooms', 'size_sqft', 'asking_price', 'sold_price', 'rent_pcm'];
      
      if (numericFields.includes(fieldName)) {
        if (value.trim() === '') {
          parsedValue = null;
            } else {
          // Remove commas before parsing
          const cleanedValue = removeCommas(value.trim());
          parsedValue = fieldName === 'size_sqft' || fieldName.includes('price') || fieldName === 'rent_pcm'
            ? parseFloat(cleanedValue)
            : parseInt(cleanedValue, 10);
        }
      }

      console.log(`💾 Saving ${fieldName}:`, { 
        value, 
        parsedValue, 
        propertyId,
        fieldType: typeof parsedValue
      });
      
      // Check if save was aborted before making API call
      if (abortController.signal.aborted) {
        console.log(`⏭️ Save for ${fieldName} was aborted before API call`);
        return;
      }
      
      const result = await backendApi.updatePropertyDetails(propertyId, {
        [fieldName]: parsedValue
      } as any);
      
      // Check if save was aborted after API call
      if (abortController.signal.aborted) {
        console.log(`⏭️ Save for ${fieldName} was aborted after API call`);
        return;
      }

      console.log(`✅ Save result for ${fieldName}:`, {
        success: result.success,
        error: result.error,
        message: result.message,
        data: result.data,
        fullResult: result
      });

      // The backend response is wrapped in result.data
      const backendResponse = result.data || result;
      const isSuccess = backendResponse.success || result.success;

      if (isSuccess) {
        // Use the updated data from backend response if available, otherwise use parsedValue
        const updatedData = backendResponse.data || backendResponse;
        const savedValue = updatedData && updatedData[fieldName] !== undefined 
          ? updatedData[fieldName] 
          : parsedValue;
        
        // Update local property details state with the saved value from backend
        setLocalPropertyDetails(prev => ({
          ...prev,
          [fieldName]: savedValue
        }));
        
        // Also update the property prop if it exists (for persistence across panel reopens)
        if (property?.propertyHub?.property_details) {
          property.propertyHub.property_details = {
            ...property.propertyHub.property_details,
            [fieldName]: savedValue
          };
        }
        
        setEditingField(null);
        setEditValues(prev => {
          const newValues = { ...prev };
          delete newValues[fieldName];
          return newValues;
        });
        console.log(`✅ Successfully saved ${fieldName} = ${savedValue}`);
      } else {
        const errorMsg = backendResponse.error || result.error || 'Failed to save';
        console.error(`❌ Failed to save ${fieldName}:`, errorMsg);
        setFieldErrors(prev => ({ ...prev, [fieldName]: errorMsg }));
      }
    } catch (error: any) {
      // Don't show error if the save was aborted
      if (error.name === 'AbortError' || abortController.signal.aborted) {
        console.log(`⏭️ Save for ${fieldName} was aborted`);
        return;
      }
      console.error(`Error saving ${fieldName}:`, error);
      setFieldErrors(prev => ({ ...prev, [fieldName]: error.message || 'Failed to save' }));
    } finally {
      // Clean up
      delete pendingSavesRef.current[fieldName];
      setSavingFields(prev => {
        const newSet = new Set(prev);
        newSet.delete(fieldName);
        return newSet;
      });
    }
  };

  const handleFieldBlur = (fieldName: string) => {
    const value = editValues[fieldName] ?? '';
    
    // Cancel any existing timer for this field
    if (saveTimersRef.current[fieldName]) {
      clearTimeout(saveTimersRef.current[fieldName]);
      delete saveTimersRef.current[fieldName];
    }
    
    // Save immediately on blur (no debounce for blur, but still cancel pending)
    saveField(fieldName, value);
  };

  const handleFieldKeyDown = (e: React.KeyboardEvent, fieldName: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = editValues[fieldName] ?? '';
      saveField(fieldName, value);
    } else if (e.key === 'Escape') {
      setEditingField(null);
      setEditValues(prev => {
        const newValues = { ...prev };
        delete newValues[fieldName];
        return newValues;
      });
      setFieldErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[fieldName];
        return newErrors;
      });
    }
  };

  // CRITICAL: Do NOT load documents when property card opens
  // Documents should ONLY be loaded when user clicks "View Files" button
  // BUT for this simplified view, we probably want to load them immediately since it's ONLY documents
  useEffect(() => {
    if (property && property.id) {
      console.log('📄 PropertyDetailsPanel: Property changed, loading files for Documents view:', property.id);
      
      // INSTANT RENDERING: Check for documents in propertyHub first (from onPropertyCreated callback)
      if (property.propertyHub?.documents && property.propertyHub.documents.length > 0) {
        console.log('⚡ INSTANT: Using documents from propertyHub:', property.propertyHub.documents.length, 'documents');
        setDocuments(property.propertyHub.documents);
        setHasFilesFetched(true);
        setIsLoadingDocuments(false);
        setShowEmptyState(false);
        preloadDocumentCovers(property.propertyHub.documents);
        // Cache for future use
        if (!(window as any).__preloadedPropertyFiles) {
          (window as any).__preloadedPropertyFiles = {};
        }
        (window as any).__preloadedPropertyFiles[property.id] = property.propertyHub.documents;
        // Still fetch fresh data in background to get updated status
        loadPropertyDocuments();
        return; // Exit early - documents already displayed
      }
      
      // Reset states when property changes
      setIsLoadingDocuments(true);
      setShowEmptyState(false);
      setHasFilesFetched(false);
      loadPropertyDocuments();
    } else {
      console.log('⚠️ PropertyDetailsPanel: No property or property.id');
      setDocuments([]);
      setIsLoadingDocuments(false);
      setShowEmptyState(false);
      setHasFilesFetched(false);
    }
  }, [property]);

  // Initialize DOCX loaded state from cache when documents change
  useEffect(() => {
    if (documents.length > 0 && (window as any).__preloadedDocumentCovers) {
      documents.forEach(doc => {
        const cachedCover = (window as any).__preloadedDocumentCovers[doc.id];
        if (cachedCover?.isDocx && cachedCover?.isDocxLoaded) {
          docxLoadedRef.current.add(doc.id);
        }
      });
    }
  }, [documents]);

  const loadPropertyDocuments = async (): Promise<number> => {
    if (!property?.id) {
      console.log('⚠️ loadPropertyDocuments: No property or property.id');
      return 0;
    }
    
    // Set loading state and hide empty state immediately
    setIsLoadingDocuments(true);
    setShowEmptyState(false);
    setError(null);
    
    // OPTIMIZATION: Use cached documents immediately if available
    const cachedDocs = (window as any).__preloadedPropertyFiles?.[property.id];
    if (cachedDocs && cachedDocs.length > 0) {
      console.log('⚡ Using cached documents:', cachedDocs.length, 'documents');
      setDocuments(cachedDocs);
      setHasFilesFetched(true);
      setIsLoadingDocuments(false);
      preloadDocumentCovers(cachedDocs);
      // Still fetch fresh data in background
    }
    
    try {
      console.log('📄 Loading documents for property:', property.id);
      const response = await backendApi.getPropertyHubDocuments(property.id);
      
      let documentsToUse = null;
      
      // OPTIMIZATION: New lightweight endpoint returns { success: true, data: { documents: [...], document_count: N } }
      if (response && response.success && response.data) {
        // Check for new lightweight endpoint format: response.data.documents
        if (response.data.documents && Array.isArray(response.data.documents)) {
          documentsToUse = response.data.documents;
        }
        // Check for nested structure: response.data.data.documents (legacy)
        else if (response.data.data && response.data.data.documents && Array.isArray(response.data.data.documents)) {
          documentsToUse = response.data.data.documents;
        } 
        // Check if response.data is an array (legacy)
        else if (Array.isArray(response.data)) {
          documentsToUse = response.data;
        }
      } else if (response && (response as any).documents && Array.isArray((response as any).documents)) {
        documentsToUse = (response as any).documents;
      } else if (Array.isArray(response)) {
        documentsToUse = response;
      }
      
      if (documentsToUse && documentsToUse.length > 0) {
        console.log('✅ Loaded documents:', documentsToUse.length, 'documents');
        setDocuments(documentsToUse);
        setHasFilesFetched(true);
        setIsLoadingDocuments(false);
        setShowEmptyState(false);
        // Preload document covers for instant rendering
        preloadDocumentCovers(documentsToUse);
        // Store in preloaded files for future use
        if (!(window as any).__preloadedPropertyFiles) {
          (window as any).__preloadedPropertyFiles = {};
        }
        (window as any).__preloadedPropertyFiles[property.id] = documentsToUse;
        
        // Update recent projects with accurate document count (documents.length takes priority)
        if (property) {
          saveToRecentProjects({
            ...property,
            propertyHub: {
              ...property.propertyHub,
              documents: documentsToUse
            }
          });
        }
      } else {
        // Fallback to propertyHub documents if API returns nothing
        if (property.propertyHub?.documents && property.propertyHub.documents.length > 0) {
          setDocuments(property.propertyHub.documents);
          setHasFilesFetched(true);
          setIsLoadingDocuments(false);
          setShowEmptyState(false);
          // Preload covers for fallback documents
          preloadDocumentCovers(property.propertyHub.documents);
        } else {
          setDocuments([]);
          setHasFilesFetched(true);
          setIsLoadingDocuments(false);
          // Add minimum delay before showing empty state (give time for files to load)
          setTimeout(() => {
            setShowEmptyState(true);
          }, 800); // 800ms delay to allow files to load
        }
      }
    } catch (err) {
      console.error('❌ Error loading documents:', err);
      setError('Failed to load documents');
      setIsLoadingDocuments(false);
      // Fallback to propertyHub documents on error
      if (property.propertyHub?.documents && property.propertyHub.documents.length > 0) {
        setDocuments(property.propertyHub.documents);
        setHasFilesFetched(true);
        setShowEmptyState(false);
        // Preload covers even on error fallback
        preloadDocumentCovers(property.propertyHub.documents);
      } else {
        setDocuments([]);
        setHasFilesFetched(true);
        // Add minimum delay before showing empty state on error
        setTimeout(() => {
          setShowEmptyState(true);
        }, 800); // 800ms delay to allow files to load
      }
    }
  };

  const formatFileName = (name: string): string => {
    // Truncate long file names
    if (name.length > 30) {
      const extension = name.split('.').pop();
      const nameWithoutExt = name.substring(0, name.lastIndexOf('.'));
      return `${nameWithoutExt.substring(0, 27)}...${extension ? '.' + extension : ''}`;
    }
    return name;
  };

  // Function to open a document by ID in ExpandedCardView (used by citations)
  const openDocumentById = useCallback((documentId: string) => {
    const docIndex = documents.findIndex(doc => doc.id === documentId);
    if (docIndex !== -1) {
      setSelectedCardIndex(docIndex);
    } else {
      console.warn('⚠️ Document not found in property documents:', documentId);
    }
  }, [documents]);

  const handleDocumentClick = useCallback(async (document: Document) => {
    // Find the document index in documents and open it in ExpandedCardView
    const docIndex = documents.findIndex(doc => doc.id === document.id);
    if (docIndex !== -1) {
      setSelectedCardIndex(docIndex);
    } else {
      console.warn('⚠️ Document not found in documents, falling back to DocumentPreviewModal');
      // Fallback to old behavior if document not found
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
      let downloadUrl: string | null = null;
      
      if ((document as any).url || (document as any).download_url || (document as any).file_url || (document as any).s3_url) {
        downloadUrl = (document as any).url || (document as any).download_url || (document as any).file_url || (document as any).s3_url || null;
        } else if ((document as any).s3_path) {
        downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent((document as any).s3_path)}`;
        } else {
        const docId = document.id;
        if (docId) {
          downloadUrl = `${backendUrl}/api/files/download?document_id=${docId}`;
        }
      }
      
      if (!downloadUrl) {
        throw new Error('No download URL available');
      }
      
      const response = await fetch(downloadUrl, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }
      
      const blob = await response.blob();
      // @ts-ignore - File constructor is available in modern browsers
      const file = new File([blob], document.original_filename, { 
        type: (document as any).file_type || blob.type || 'application/pdf'
      });
      
      const fileData: FileAttachmentData = {
        id: document.id,
        file: file,
        name: document.original_filename,
        type: (document as any).file_type || blob.type || 'application/pdf',
        size: (document as any).file_size || blob.size
      };
      
      addPreviewFile(fileData);
    } catch (err) {
      console.error('❌ Error opening document:', err);
    }
    }
  }, [documents, addPreviewFile]);

  const handleDeleteDocument = async (documentId: string) => {
    // Check access level
    if (!canDelete()) {
      alert('You do not have permission to delete files. Only editors and owners can delete files from this property.');
      return;
    }

    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
      const response = await fetch(`${backendUrl}/api/documents/${documentId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Handle 404 as success - document is already gone
      if (response.status === 404) {
        console.info(`Document ${documentId} was already deleted, removing from UI`);
        // Fall through to remove from local state
      } else if (!response.ok) {
        throw new Error(`Failed to delete document: ${response.status}`);
      }

      // Remove from local state
      setDocuments(prev => {
        const updated = prev.filter(doc => doc.id !== documentId);
        
        // Save to recent projects after successful file deletion (user interaction)
        if (property) {
          saveToRecentProjects({
            ...property,
            documentCount: updated.length
          });
        }
        
        return updated;
      });
      
      // If the deleted document was selected, close the preview
      if (selectedCardIndex !== null && filteredDocuments[selectedCardIndex]?.id === documentId) {
        setSelectedCardIndex(null);
      }
    } catch (err: unknown) {
      console.error('Error deleting document:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      alert(`Failed to delete document: ${errorMessage}`);
    }
  };

  // Handle reprocessing selected documents for BBOX extraction
  const handleReprocessSelected = async (mode: 'full' | 'bbox_only') => {
    if (localSelectedDocumentIds.size === 0) {
      return;
    }
    
    setIsReprocessing(true);
    setReprocessDropdownOpen(false);
    setReprocessResult(null);
    
    const documentIds = Array.from(localSelectedDocumentIds);
    let successCount = 0;
    let failCount = 0;
    
    try {
      console.log(`🔄 Reprocessing ${documentIds.length} document(s) in ${mode} mode...`);
      
      for (const docId of documentIds) {
        try {
          // Set the current document being processed (for progress monitor)
          setReprocessingDocumentId(docId);
          
          const result = await backendApi.reprocessDocument(docId, mode);
          if (result.success) {
            successCount++;
          } else {
            failCount++;
          }
        } catch (error) {
          console.error(`❌ Failed to reprocess document ${docId}:`, error);
          failCount++;
        }
      }
      
      // Clear the reprocessing document ID
      setReprocessingDocumentId(null);
      
      if (successCount > 0) {
        setReprocessResult({
          success: true,
          message: `Successfully reprocessed ${successCount} document(s)`
        });
      } else {
        setReprocessResult({
          success: false,
          message: `Failed to reprocess ${failCount} document(s)`
        });
      }
    } catch (error) {
      setReprocessingDocumentId(null);
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

  const handleDocumentDragStart = (e: React.DragEvent, document: Document) => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
    
    // Set dragged document ID for deletion and show delete zone
    setDraggedDocumentId(document.id);
    setIsDraggingToDelete(true);
    
    // Try multiple download URL patterns
    let downloadUrl: string | null = null;
    
    if ((document as any).url || (document as any).download_url || (document as any).file_url || (document as any).s3_url) {
      downloadUrl = (document as any).url || (document as any).download_url || (document as any).file_url || (document as any).s3_url || null;
    } else if ((document as any).s3_path) {
      downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent((document as any).s3_path)}`;
    } else {
      downloadUrl = `${backendUrl}/api/files/download?document_id=${document.id}`;
    }
    
    // Allow both copy (for chat) and move (for delete)
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', document.original_filename);
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'property-document',
      documentId: document.id,
      filename: document.original_filename,
      fileType: (document as any).file_type || 'application/pdf',
      downloadUrl: downloadUrl
    }));
    
    (e.target as HTMLElement).style.opacity = '0.5';
  };

  const handleDocumentDragEnd = (e: any) => {
    (e.target as HTMLElement).style.opacity = '1';
    setIsDraggingToDelete(false);
    setDraggedDocumentId(null);
  };

  const handleDeleteZoneDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setIsDraggingToDelete(true);
  };

  const handleDeleteZoneDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingToDelete(false);
  };

  const handleDeleteZoneDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingToDelete(false);
    
    if (draggedDocumentId) {
      handleDeleteDocument(draggedDocumentId);
      setDraggedDocumentId(null);
    }
  };
  
  const getDownloadUrl = (doc: any) => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
    if (doc.url || doc.download_url || doc.file_url || doc.s3_url) {
      return doc.url || doc.download_url || doc.file_url || doc.s3_url;
    } else if (doc.s3_path) {
      return `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(doc.s3_path)}`;
    } else {
      return `${backendUrl}/api/files/download?document_id=${doc.id}`;
    }
  };

  // Preload document covers (thumbnails) for faster rendering
  const preloadDocumentCovers = useCallback(async (docs: Document[]) => {
    if (!docs || docs.length === 0) return;
    
    // Initialize cache if it doesn't exist
    if (!(window as any).__preloadedDocumentCovers) {
      (window as any).__preloadedDocumentCovers = {};
    }
    
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
    
    // Separate docs by type for optimized loading order
    const imageDocs: Document[] = [];
    const pdfDocs: Document[] = [];
    const docxDocs: Document[] = [];
    
    docs.forEach(doc => {
      if ((window as any).__preloadedDocumentCovers[doc.id]) return; // Skip cached
      
      const fileType = (doc as any).file_type || '';
      const fileName = doc.original_filename.toLowerCase();
      const isImage = fileType.includes('image') || fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i);
      const isPDF = fileType.includes('pdf') || fileName.endsWith('.pdf');
      const isDOCX = 
        fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        fileType === 'application/msword' ||
        fileType.includes('word') ||
        fileType.includes('document') ||
        fileName.endsWith('.docx') ||
        fileName.endsWith('.doc');
      
      if (isImage) imageDocs.push(doc);
      else if (isPDF) pdfDocs.push(doc);
      else if (isDOCX) docxDocs.push(doc);
    });
    
    // Track if we've triggered first re-render
    let hasTriggeredFirstRender = false;
    
    // Helper to preload a single document - triggers re-render on each success
    const preloadSingleDoc = async (doc: Document, priority: 'high' | 'auto' = 'auto', triggerRender = true) => {
      const docId = doc.id;
      if ((window as any).__preloadedDocumentCovers[docId]) return;
      
      try {
        let downloadUrl: string | null = null;
        if ((doc as any).url || (doc as any).download_url || (doc as any).file_url || (doc as any).s3_url) {
          downloadUrl = (doc as any).url || (doc as any).download_url || (doc as any).file_url || (doc as any).s3_url || null;
        } else if ((doc as any).s3_path) {
          downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent((doc as any).s3_path)}`;
        } else {
          downloadUrl = `${backendUrl}/api/files/download?document_id=${doc.id}`;
        }
        
        if (!downloadUrl) return;
        
        const response = await fetch(downloadUrl, {
          credentials: 'include',
          // @ts-ignore
          priority: priority
        });
        
        if (!response.ok) return;
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        (window as any).__preloadedDocumentCovers[docId] = {
          url: url,
          type: blob.type,
          timestamp: Date.now()
        };
        
        // Trigger re-render immediately for first few, then batch for rest
        if (triggerRender && !hasTriggeredFirstRender) {
          hasTriggeredFirstRender = true;
          setCachedCoversVersion(v => v + 1);
        }
      } catch (error) {
        // Silently fail
      }
    };
    
    // Helper to preload DOCX (requires upload to S3)
    const preloadDocx = async (doc: Document) => {
      const docId = doc.id;
      if ((window as any).__preloadedDocumentCovers[docId]) return;
      
      try {
        let downloadUrl: string | null = null;
        if ((doc as any).url || (doc as any).download_url || (doc as any).file_url || (doc as any).s3_url) {
          downloadUrl = (doc as any).url || (doc as any).download_url || (doc as any).file_url || (doc as any).s3_url || null;
        } else if ((doc as any).s3_path) {
          downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent((doc as any).s3_path)}`;
        } else {
          downloadUrl = `${backendUrl}/api/files/download?document_id=${doc.id}`;
        }
        
        if (!downloadUrl) return;
        
        const response = await fetch(downloadUrl, { credentials: 'include' });
        if (!response.ok) return;
        
        const blob = await response.blob();
        const formData = new FormData();
        formData.append('file', blob, doc.original_filename);
        
        const uploadResponse = await fetch(`${backendUrl}/api/documents/temp-preview`, {
          method: 'POST',
          credentials: 'include',
          body: formData
        });
        
        if (uploadResponse.ok) {
          const data = await uploadResponse.json();
          if (data.presigned_url) {
            (window as any).__preloadedDocumentCovers[docId] = {
              url: data.presigned_url,
              type: 'docx',
              isDocx: true,
              timestamp: Date.now()
            };
            setCachedCoversVersion(v => v + 1);
          }
        }
      } catch (error) {
        // Silently fail
      }
    };
    
    // FAST LOADING STRATEGY: Load ALL in parallel immediately
    // Images, PDFs, and DOCX all start loading at the same time
    const imagePromises = imageDocs.map((doc, i) => 
      preloadSingleDoc(doc, i < 6 ? 'high' : 'auto', i < 3)
    );
    
    const pdfPromises = pdfDocs.map((doc, i) => 
      preloadSingleDoc(doc, i < 4 ? 'high' : 'auto', false)
    );
    
    // DOCX files load in parallel immediately (no delay)
    const docxPromises = docxDocs.map(doc => preloadDocx(doc));
    
    // Execute ALL in parallel - images, PDFs, and DOCX
    Promise.allSettled([...imagePromises, ...pdfPromises, ...docxPromises]).then(() => {
      setCachedCoversVersion(v => v + 1);
    });
  }, []);
  
  // Filter documents based on search query, active filter, and sort by created_at
  // Memoized to prevent recalculation on every render (only when dependencies change)
  const filteredDocuments = useMemo(() => {
    return documents
    .filter(doc => {
        // Search Filter
        if (filesSearchQuery.trim()) {
      const query = filesSearchQuery.toLowerCase();
          if (!doc.original_filename.toLowerCase().includes(query)) return false;
        }

        // Type Filter
        const fileType = (doc as any).file_type || '';
        const fileName = doc.original_filename.toLowerCase();
        const isPDF = fileType.includes('pdf') || fileName.endsWith('.pdf');
        const isImage = fileType.includes('image') || fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i);

        if (activeFilter === 'images') return isImage;
        if (activeFilter === 'pdfs') return isPDF;
        
        return true;
    })
    .sort((a, b) => {
      // Sort by created_at descending (newest first) so new files appear at top of stack
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateB - dateA;
    });
  }, [documents, filesSearchQuery, activeFilter]);

  // When a citation is clicked, open the document in ExpandedCardView
  // This works regardless of whether PropertyDetailsPanel is visible - it will open it if needed
  React.useEffect(() => {
    if (highlightCitation && highlightCitation.fileId) {
      // Use filteredDocuments (which includes all documents when no filter is active)
      const allDocuments = filteredDocuments.length > 0 ? filteredDocuments : documents;
      
      if (allDocuments.length > 0) {
        console.log('📚 [PropertyDetailsPanel] Checking for citation document:', {
          highlightFileId: highlightCitation.fileId,
          documentsCount: allDocuments.length,
          documentIds: allDocuments.map(d => d.id),
          isVisible,
          currentSelectedCardIndex: selectedCardIndex
        });
        
        const docIndex = allDocuments.findIndex(doc => doc.id === highlightCitation.fileId);
        console.log('📚 [PropertyDetailsPanel] Document index found:', docIndex, 'current selectedCardIndex:', selectedCardIndex);
        
        if (docIndex !== -1) {
          // Document is in this property's documents - open it in ExpandedCardView
          // Always set selectedCardIndex, even if already selected, to ensure it opens and highlights
          console.log('✅ [PropertyDetailsPanel] Opening document from citation in ExpandedCardView:', highlightCitation.fileId, 'at index:', docIndex);
          // Force update by setting to null first, then to the index (ensures re-render)
          if (selectedCardIndex === docIndex) {
            // Already selected, but force a re-render to show highlight
            setSelectedCardIndex(null);
            setTimeout(() => {
              setSelectedCardIndex(docIndex);
            }, 10);
          } else {
            setSelectedCardIndex(docIndex);
          }
        } else if (docIndex === -1) {
          console.log('ℹ️ [PropertyDetailsPanel] Citation document not in this property - will try to find property and open it');
        }
      } else {
        // Documents not loaded yet - wait a bit and retry
        // This handles the case where PropertyDetailsPanel just opened and documents are still loading
        console.log('ℹ️ [PropertyDetailsPanel] Documents not loaded yet - will retry in 500ms');
        const retryTimeout = setTimeout(() => {
          const retryDocuments = filteredDocuments.length > 0 ? filteredDocuments : documents;
          if (retryDocuments.length > 0) {
            const retryDocIndex = retryDocuments.findIndex(doc => doc.id === highlightCitation.fileId);
            if (retryDocIndex !== -1) {
              console.log('✅ [PropertyDetailsPanel] Found document on retry, opening in ExpandedCardView:', highlightCitation.fileId, 'at index:', retryDocIndex);
              setSelectedCardIndex(retryDocIndex);
            }
          }
        }, 500);
        
        return () => clearTimeout(retryTimeout);
      }
    }
  }, [highlightCitation, documents, filteredDocuments, selectedCardIndex, isVisible]);

  // Citation action handler
  const handleCitationAction = React.useCallback((action: 'ask_more' | 'add_to_writing', citation: any) => {
    if (action === 'ask_more') {
      // Generate a query from the citation content
      const citationText = citation.block_content || citation.cited_text || 'this information';
      const query = `Tell me more about: ${citationText.substring(0, 200)}${citationText.length > 200 ? '...' : ''}`;
      
      // Open chat panel with pre-filled query
      // We'll use a custom event or callback to communicate with MainContent
      // For now, we'll use a custom event that MainContent can listen to
      const event = new CustomEvent('citation-ask-more', {
        detail: {
          query,
          citation,
          documentId: citation.fileId || citation.doc_id
        }
      });
      window.dispatchEvent(event);
      
      console.log('📝 [CITATION] Ask more action triggered:', { query, citation });
    } else if (action === 'add_to_writing') {
      // Store citation in curated writing collection (localStorage for now)
      const curatedKey = 'curated_writing_citations';
      const existing = JSON.parse(localStorage.getItem(curatedKey) || '[]');
      const newEntry = {
        id: `citation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        citation,
        addedAt: new Date().toISOString(),
        documentName: citation.original_filename || 'Unknown document',
        content: citation.block_content || citation.cited_text || ''
      };
      existing.push(newEntry);
      localStorage.setItem(curatedKey, JSON.stringify(existing));
      
      // Show notification (you can use a toast library here)
      console.log('📚 [CITATION] Added to curated writing:', newEntry);
      
      // Dispatch event for UI updates
      window.dispatchEvent(new CustomEvent('citation-added-to-writing', {
        detail: newEntry
      }));
    }
  }, []);

  // File upload handler
  const handleFileUpload = async (file: File) => {
    // CRITICAL: Capture property at the start to ensure we use the correct property_id
    const currentProperty = property;
    if (!currentProperty?.id) {
      setUploadError('No property selected');
      return;
    }

    // Check access level
    if (!canUpload()) {
      setUploadError('You do not have permission to upload files. Only editors and owners can upload files to this property.');
      return;
    }

    // Open files modal when upload starts so user can see the file appear
    setIsFilesModalOpen(true);
    isFilesModalOpenRef.current = true;

    setUploading(true);
    setUploadError(null);
    // Reset progress to 0 and ensure it starts from 0
    setUploadProgress(0);
    uploadProgressRef.current = 0;
    console.log('🚀 Starting upload for property:', currentProperty.id, currentProperty.address);

    try {
      // CRITICAL: Always use currentProperty (captured at start) to prevent property leakage
      const response = await backendApi.uploadPropertyDocumentViaProxy(
        file, 
        { 
          property_id: currentProperty.id,
          property_address: currentProperty.address,
          property_latitude: currentProperty.latitude,
          property_longitude: currentProperty.longitude
        },
        (percent) => {
          // Update progress in real-time - only increase, never decrease
          const currentProgress = uploadProgressRef.current;
          // Allow updates if progress increased OR if we're starting from 0
          if (percent > currentProgress || (percent === 0 && currentProgress === 0)) {
            uploadProgressRef.current = percent;
            setUploadProgress(percent);
          }
        }
      );
      
      if (response.success) {
        const currentProgress = uploadProgressRef.current;
        if (currentProgress < 95) {
          uploadProgressRef.current = 95;
          setUploadProgress(95);
        }
        
        // CRITICAL: Reload documents for the property we uploaded to (use captured currentProperty)
        const propertyId = currentProperty.id;
        try {
          // Retry loading documents with exponential backoff to handle race condition
          // The relationship might not be immediately visible in Supabase queries
          let retries = 3;
          let delay = 300;
          let documentsLoaded = false;
          
          while (retries > 0 && !documentsLoaded) {
            await new Promise(resolve => setTimeout(resolve, delay));
            await loadPropertyDocuments(); // Reload documents
            
            // Check if documents were loaded (check state after a brief moment)
            await new Promise(resolve => setTimeout(resolve, 100));
            if (documents.length > 0) {
              documentsLoaded = true;
              console.log('✅ Documents loaded successfully after upload');
            } else {
              retries--;
              delay *= 2; // Exponential backoff: 300ms, 600ms, 1200ms
              console.log(`🔄 Retrying document load (${retries} retries left, delay: ${delay}ms)`);
            }
          }
          
          if (!documentsLoaded && retries === 0) {
            console.warn('⚠️ Documents not found after upload - they may appear after processing completes');
          }
            
            // Wait for React to render the file, then set progress to 100%
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const finalProgress = uploadProgressRef.current;
                if (finalProgress < 100) {
                  uploadProgressRef.current = 100;
                  setUploadProgress(100);
                }
                
                // Wait a moment to show 100%, then reset
                setTimeout(() => {
                  setUploading(false);
                  setUploadProgress(0);
                  uploadProgressRef.current = 0;
                }, 300);
              });
            });
        } catch (error) {
          console.error('Error reloading documents:', error);
          // Don't show error for reload failure, just log it
          setUploading(false);
        }
      } else {
        const errorMessage = response.error || 'Upload failed';
        window.dispatchEvent(new CustomEvent('upload-error', { 
          detail: { fileName: file.name, error: errorMessage } 
        }));
        setUploadError(null); // Clear local error, let UploadProgressBar handle it
        setUploading(false);
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      window.dispatchEvent(new CustomEvent('upload-error', { 
        detail: { fileName: file.name, error: errorMessage } 
      }));
      setUploadError(null); // Clear local error, let UploadProgressBar handle it
      setUploading(false);
    }
  };

  // File input change handler
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      Array.from(files).forEach(file => {
        handleFileUpload(file);
      });
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };


  // Expanded Card View Component - shows document preview within container
  // Memoized to prevent re-renders when parent layout changes (e.g., chat panel opens/closes)
  // Reset fullscreen when document changes
  const previousCardIndexRef = useRef<number | null>(null);
    useEffect(() => {
    if (selectedCardIndex !== null && previousCardIndexRef.current !== null && previousCardIndexRef.current !== selectedCardIndex) {
      setIsFullscreen(false); // Reset fullscreen when switching to a different document
    }
    previousCardIndexRef.current = selectedCardIndex;
  }, [selectedCardIndex]);

  // Reset image preview when property changes
  useEffect(() => {
    setSelectedImageIndex(null);
  }, [property?.id]);

  // Reset image preview when property changes
  useEffect(() => {
    setSelectedImageIndex(null);
  }, [property?.id]);

  // Memoized callback to close preview - stable reference prevents re-renders
  const handleClosePreview = useCallback(() => {
    setSelectedCardIndex(null);
    setIsFullscreen(false); // Reset fullscreen when closing preview
  }, []);

  // Memoize the selected document to ensure stable reference
  // Only recalculate when filteredDocuments or selectedCardIndex changes
  const selectedDocument = useMemo(() => {
    if (selectedCardIndex === null || !filteredDocuments[selectedCardIndex]) {
      return undefined;
    }
    return filteredDocuments[selectedCardIndex];
  }, [filteredDocuments, selectedCardIndex]);


  if (!isVisible) return null;

  return (
    <>
      {createPortal(
    <AnimatePresence>
      {isVisible && (
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center font-sans pointer-events-none transition-all duration-300 ease-out" 
          style={{ 
            pointerEvents: 'none',
            // Offset for sidebar so content centers in available space (same as MapChatBar)
            paddingLeft: isChatPanelOpen ? 0 : sidebarWidth,
          }}
        >
          {/* Backdrop Removed - Allow clicking behind */}

          {/* Main Window - Compact Grid Layout (Artboard Style) */}
          <motion.div
            layout={selectedCardIndex === null && !isChatPanelResizing} // Disable layout animations when chat panel is resizing
            initial={{ opacity: 1, scale: 1, y: 0 }}
            animate={{ 
              opacity: 1, 
              scale: 1, 
              y: 0
            }}
            exit={{ opacity: 0, scale: 0.99, y: 5 }}
            transition={{ 
              duration: 0, // Instant appearance - no opening transition
              ease: [0.12, 0, 0.39, 0], // Very smooth easing curve for buttery smooth handover
              layout: isChatPanelResizing ? { duration: 0 } : { duration: 0.3 } // Disable layout transitions during resize
            }}
            className={`bg-[#FCFCF9] flex overflow-hidden pointer-events-auto ${
              // In split-view (chat + property details), remove heavy shadows so there's no "divider shadow"
              isChatPanelOpen ? '' : 'shadow-2xl ring-1 ring-black/5'
            }`}
            style={{ 
              // Switch to fixed positioning in chat mode to reliably fill screen
              position: isChatPanelOpen ? 'fixed' : 'relative',
              
              // Chat Mode: Anchored to screen edges (sidebar + margins)
              // Split view: remove outer gaps so the panel sits flush against the chat panel and viewport edges
              // The chatPanelWidth prop is just the width, so we need to calculate where the chat panel ends
              // Chat panel left = base sidebar + filing sidebar (if open), so property details left = chat panel left + chat panel width
              // propertyDetailsLeft can be: 'auto', a CSS calc string, or a number - handle each case
              left: isChatPanelOpen 
                ? (typeof propertyDetailsLeft === 'string' ? propertyDetailsLeft : `${propertyDetailsLeft}px`)
                : 'auto',
              right: isChatPanelOpen ? (isChatPanelOpenContext ? `${chatPanelWidthContext}px` : '0px') : 'auto',
              top: isChatPanelOpen ? '0px' : 'auto',
              bottom: isChatPanelOpen ? '0px' : 'auto',
              width: isChatPanelOpen ? 'auto' : '800px',
              height: isChatPanelOpen ? 'auto' : '600px',
              // Minimum width when chat panel is open: enough for 3 document cards
              // Each card is 160px, gaps are 24px (gap-6), padding is 24px each side (p-6)
              // 3 cards: 3 * 160px + 2 * 24px (gaps) + 48px (padding) = 576px, round to 600px
              minWidth: isChatPanelOpen ? '600px' : 'auto',
              transition: 'none', // No transition for width/position changes - instant like chat
              
              // Normal Mode: Centered with margins (parent container handles sidebar offset via paddingLeft)
              marginBottom: isChatPanelOpen ? '0' : '15vh',
              
              // Reset constraints
              maxWidth: isChatPanelOpen ? 'none' : '90vw', 
              maxHeight: isChatPanelOpen ? 'none' : '85vh',
              
              display: 'flex',
              flexDirection: 'column',
              zIndex: 9999,
              // Add left border in chat mode to create visible divider line
              borderLeft: isChatPanelOpen ? '1px solid rgba(156, 163, 175, 0.3)' : 'none',
              // Optimize rendering during layout changes
              willChange: selectedCardIndex !== null ? 'auto' : 'transform'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Section Picker - File Tab Style (Fixed) - Draggable */}
            <div className="px-10 pt-4 pb-3 bg-[#FCFCF9] relative" style={{ zIndex: 1, borderBottom: 'none' }}>
              <div className="flex items-end justify-between gap-1">
                <div className="flex items-end gap-1" style={{ maxWidth: 'fit-content' }}>
                {displayOrder.map((section, index) => {
                  const isActive = activeSection === section;
                  const sectionConfig = {
                    documents: {
                      label: 'Documents',
                      icon: FileText,
                    },
                    propertyDetails: {
                      label: 'Property Details',
                      icon: Building2,
                    },
                  }[section];
                  const IconComponent = sectionConfig.icon;
                  
                  return (
                    <button
                      key={section}
                      draggable
                      onDragStart={(e) => {
                        // Cancel any pending animation frame
                        if (rafIdRef.current !== null) {
                          cancelAnimationFrame(rafIdRef.current);
                          rafIdRef.current = null;
          }
                        // Store the original index and section from sectionOrder (not displayOrder)
                        const originalIndex = sectionOrder.indexOf(section);
                        setDraggedTabIndex(originalIndex);
                        setDraggedSection(section);
                        setPreviewOrder(null); // Clear any previous preview
                        setDragOverSection(null);
                        lastDragOverSectionRef.current = null; // Reset ref
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', section);
                        (e.currentTarget as HTMLElement).style.opacity = '0.5';
                      }}
                      onDragEnd={(e) => {
                        // Cancel any pending animation frame
                        if (rafIdRef.current !== null) {
                          cancelAnimationFrame(rafIdRef.current);
                          rafIdRef.current = null;
        }
                        // If we have a preview order, commit it
                        if (previewOrder) {
                          setSectionOrder(previewOrder);
                        }
                        setDraggedTabIndex(null);
                        setDraggedSection(null);
                        setDragOverSection(null);
                        setPreviewOrder(null);
                        lastDragOverSectionRef.current = null; // Reset ref
                        (e.currentTarget as HTMLElement).style.opacity = '1';
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'move';
                        
                        // Use refs to check state (avoids stale closures)
                        const currentDraggedSection = draggedSectionRef.current;
                        if (currentDraggedSection !== null && section !== currentDraggedSection) {
                          // Only update if we've moved to a different section
                          // This prevents rapid re-renders and state updates
                          if (lastDragOverSectionRef.current !== section) {
                            lastDragOverSectionRef.current = section;
                            // Throttle updates using requestAnimationFrame
                            updatePreviewOrder(section);
                          }
                        }
                      }}
                      onDragLeave={(e) => {
                        // Only clear if we're actually leaving the tab area
                        const rect = e.currentTarget.getBoundingClientRect();
                        const x = e.clientX;
                        const y = e.clientY;
                        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                          setDragOverSection(null);
                          lastDragOverSectionRef.current = null; // Reset ref
                          // Revert to original order when leaving
                          setPreviewOrder(null);
            }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        // Check access level before allowing drop
                        if (!canUpload()) {
                          alert('You do not have permission to upload files. Only editors and owners can upload files to this property.');
                          return;
                        }
                        
                        // Cancel any pending RAF
                        if (rafIdRef.current !== null) {
                          cancelAnimationFrame(rafIdRef.current);
                          rafIdRef.current = null;
                        }
                        
                        // Get current values from refs
                        const currentDraggedSection = draggedSectionRef.current;
                        const currentSectionOrder = sectionOrderRef.current;
    
                        // Always calculate the final order based on where we dropped
                        // This ensures it works even if RAF hasn't completed yet
                        if (currentDraggedSection !== null && section !== currentDraggedSection) {
                          const finalOrder = [...currentSectionOrder];
                          const draggedIndex = finalOrder.indexOf(currentDraggedSection);
                          finalOrder.splice(draggedIndex, 1);
                          const targetIndex = currentSectionOrder.indexOf(section);
                          finalOrder.splice(targetIndex, 0, currentDraggedSection);
                          setSectionOrder(finalOrder);
                        } else {
                          // If no valid drop, use preview order if available, otherwise keep current
                          const currentPreviewOrder = previewOrderRef.current;
                          if (currentPreviewOrder) {
                            setSectionOrder(currentPreviewOrder);
                          }
                        }
                        
                        setDraggedTabIndex(null);
                        setDraggedSection(null);
                        setDragOverSection(null);
                        setPreviewOrder(null);
                        lastDragOverSectionRef.current = null; // Reset ref
                      }}
                      onClick={() => setActiveSection(section)}
                      className={`
                        flex items-center gap-2 px-3 py-2 text-sm font-medium cursor-pointer transition-all relative
                        ${isActive 
                          ? 'bg-white text-gray-900 border-t border-l border-r border-gray-200 rounded-t-lg shadow-sm' 
                          : 'text-gray-500 hover:text-gray-700 bg-gray-50 border-t border-l border-r border-gray-200 rounded-t-lg hover:bg-gray-100'
                        }
                        ${dragOverSection === section ? 'border-blue-400 border-2' : ''}
                        flex-shrink-0
                      `}
                      style={{
                        marginBottom: isActive ? '-1px' : '0',
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
                        touchAction: 'none',
                        position: 'relative',
                      }}
                    >
                      {/* Icon */}
                      <IconComponent className={`flex-shrink-0 ${isActive ? 'text-gray-900' : 'text-gray-500'}`} style={{ width: '12px', height: '12px', minWidth: '12px', minHeight: '12px', maxWidth: '12px', maxHeight: '12px', flexShrink: 0, pointerEvents: 'none' }} />
                      {/* Section name */}
                      <span 
                        className={`text-xs ${isActive ? 'text-gray-900' : 'text-gray-600'}`}
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
                        {sectionConfig.label}
                      </span>
                      {isActive && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
                      )}
                    </button>
                  );
                })}
                  </div>
                
                {/* Close Button - Aligned with section tabs in top right */}
          <button
            onClick={onClose}
                  className="p-2 hover:bg-gray-50 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
                  title="Close Panel"
                  style={{
                    marginBottom: '0px', // Align with tabs, no negative margin
                    zIndex: 10,
                  }}
                >
                  <X size={16} />
          </button>
                  </div>
              </div>

            {/* Header Area - Clean & Minimal */}
            <div className="px-6 bg-[#FCFCF9]" style={{ borderTop: 'none' }}>
              <div className="flex items-center gap-3">
                {activeSection === 'documents' && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>Documents</span>
                    <span className="font-medium">{filteredDocuments.length}</span>
            </div>
            )}

                {activeSection === 'documents' && (
                  <>
                    <div className="relative flex-1 group">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                      <input
                        type="text"
                        placeholder="Search documents..."
                        value={filesSearchQuery}
                        onChange={(e) => setFilesSearchQuery(e.target.value)}
                        className="w-full bg-gray-50 hover:bg-gray-100 focus:bg-white border border-gray-200 focus:border-blue-500 rounded-lg py-1.5 pl-9 pr-3 text-xs text-gray-900 placeholder-gray-400 focus:outline-none transition-all h-8"
                  />
                          </div>
                
                    <div className="flex items-center gap-2 border-l border-gray-200 pl-3">
                    <button
                            onClick={() => {
                          setIsLocalSelectionMode(!isLocalSelectionMode);
                          // Clear local selection when toggling off
                          if (isLocalSelectionMode) {
                            setLocalSelectedDocumentIds(new Set());
                          }
                        }}
                        className={`p-2 rounded-lg border transition-all ${
                          isLocalSelectionMode 
                            ? 'bg-blue-50 border-blue-200 text-blue-600' 
                            : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                        }`}
                        title="Select documents to delete"
                      >
                        <SquareMousePointer size={18} />
                    </button>
                    <button
                      onClick={() => {
                        if (property?.id) {
                          const propertyId = typeof property.id === 'string' ? property.id : String(property.id);
                          setSelectedProperty(propertyId);
                          setViewMode('property');
                          openFilingSidebar();
                        }
                      }}
                      className="p-2 rounded-lg border bg-white border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-all"
                      title="Open in Filing Sidebar"
                    >
                      <FolderOpen size={18} />
                    </button>
                  </div>
                  </>
                )}
                
                {/* Fullscreen Toggle Button - Always visible in top right when document is open */}
                {selectedCardIndex !== null && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsFullscreen(!isFullscreen);
                    }}
                    className="p-2 hover:bg-gray-50 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
                    title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                  >
                    {isFullscreen ? (
                      <Minimize2 className="w-4 h-4" />
                    ) : (
                      <Maximize2 className="w-4 h-4" />
                        )}
                      </button>
                )}
                  </div>
                
              {/* Filter Pills - Only show in documents section */}
              {activeSection === 'documents' && (
                <div className="flex items-center gap-2 overflow-x-auto pb-2 pt-3 scrollbar-hide">
                    <button
                    onClick={() => setActiveFilter('all')}
                    className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                      activeFilter === 'all' 
                        ? 'bg-[#F3F4F6] text-gray-900' 
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 bg-transparent'
                    }`}
                  >
                    All
                  </button>
                  <button 
                    onClick={() => setActiveFilter('images')}
                    className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                      activeFilter === 'images' 
                        ? 'bg-[#F3F4F6] text-gray-900' 
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 bg-transparent'
                  }`}
                  >
                    Images
                  </button>
                  <button 
                    onClick={() => setActiveFilter('pdfs')}
                    className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                      activeFilter === 'pdfs' 
                        ? 'bg-[#F3F4F6] text-gray-900' 
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 bg-transparent'
                    }`}
                  >
                    PDFs
                    </button>
                  </div>
                )}
              </div>
                  
            {/* Content Area - Both sections rendered, inactive one hidden to preserve state */}
            {/* Documents Section - hidden when not active to prevent PDF iframe reload */}
              <div className={`flex-1 bg-[#FCFCF9] relative ${activeSection !== 'documents' ? 'hidden' : ''} ${selectedCardIndex !== null ? 'overflow-hidden' : 'overflow-y-auto px-10 py-6'}`}>
              {/* Delete Zone */}
                    <AnimatePresence>
                      {isDraggingToDelete && draggedDocumentId && (
                        <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] bg-red-50 text-red-600 px-8 py-4 rounded-full shadow-lg border-2 border-red-100 flex items-center gap-3"
                          onDragOver={handleDeleteZoneDragOver}
                          onDragLeave={handleDeleteZoneDragLeave}
                          onDrop={handleDeleteZoneDrop}
                        >
                    <Trash2 className="w-5 h-5" />
                    <span className="font-medium">Drop to delete</span>
        </motion.div>
                      )}
      </AnimatePresence>

                    {/* Document Grid - Always rendered but hidden when preview is open */}
                    <div className={selectedCardIndex !== null ? 'hidden' : ''}>
                    {filteredDocuments.length === 0 && showEmptyState && hasFilesFetched ? (
                        <div className="h-full flex flex-col items-center justify-center text-gray-500">
                          <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4 border border-gray-100">
                            <Search size={32} className="text-gray-300" />
                  </div>
                          <p className="text-lg font-medium text-gray-900 mb-1">No documents found</p>
                          <p className="text-sm text-gray-500 mb-6">Try adjusting your search or upload a new file.</p>
                          <button 
                            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-full transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-600/30 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => {
                              if (!property?.id) {
                                alert('Please select a property first');
                                return;
                              }
                              if (!canUpload()) {
                                alert('You do not have permission to upload files. Only editors and owners can upload files to this property.');
                                return;
                              }
                              fileInputRef.current?.click();
                            }}
                            disabled={uploading || !property?.id || !canUpload() || isLoadingAccess}
                            title={
                              !property?.id 
                                ? "Please select a property first" 
                                : !canUpload() 
                                  ? "You do not have permission to upload files. Only editors and owners can upload files."
                                  : "Upload document"
                            }
                          >
                            {uploading ? (
                              <>
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                <span>Uploading...</span>
                              </>
                            ) : (
                              <>
                                <Upload size={16} strokeWidth={2.5} />
                                <span>Upload Document</span>
                              </>
                            )}
                          </button>
                      </div>
                    ) : (
                      <div 
                          className="grid gap-6 pb-20" 
                        style={{ 
                            gridTemplateColumns: 'repeat(auto-fill, 160px)',
                            justifyContent: 'flex-start'
                          }}
                        >
                        {/* Add New Document Card */}
                        {canUpload() && (
                        <motion.div
                          className="group relative bg-white border border-gray-200 cursor-pointer flex flex-col overflow-hidden"
                          style={{
                            width: '160px',
                            height: '213px', // 3:4 aspect ratio (160 * 4/3)
                            aspectRatio: '3/4',
                          }}
                          whileHover={{ 
                            y: -4, 
                            boxShadow: '0 12px 24px -8px rgba(0, 0, 0, 0.15), 0 4px 8px -4px rgba(0, 0, 0, 0.1)',
                            borderColor: 'rgb(209, 213, 219)'
                          }}
                          whileTap={{ scale: 0.98, y: -2 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                          onClick={() => {
                            if (!canUpload()) {
                              alert('You do not have permission to upload files. Only editors and owners can upload files to this property.');
                              return;
                            }
                            fileInputRef.current?.click();
                          }}
                >
                          {/* Upper Section - Light grey with plus icon (2/3 of card height) */}
                          <div className="flex items-center justify-center flex-[2] border-b border-gray-100 bg-gray-50">
                            {uploading ? (
                              <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
                            ) : (
                              <Plus className="w-8 h-8 text-gray-400 group-hover:text-gray-600 transition-colors" strokeWidth={2} />
                            )}
                          </div>
                          {/* Lower Section - White with text (1/3 of card height) */}
                          <div className="flex items-center justify-center flex-1 bg-white px-2">
                            <span className="text-xs font-semibold text-gray-600 text-center">Add Document</span>
                          </div>
                        </motion.div>
                        )}

                        {filteredDocuments.map((doc, index) => {
                          const fileType = (doc as any).file_type || '';
                          const fileName = doc.original_filename.toLowerCase();
                    const isPDF = fileType.includes('pdf') || fileName.endsWith('.pdf');
                    const isDOC = fileType.includes('word') || fileType.includes('document') || fileName.endsWith('.docx');
                    const isImage = fileType.includes('image') || fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                    
                    // Check if document is selected in either local (deletion) or chat (query) mode
                    const isSelected = isLocalSelectionMode 
                      ? localSelectedDocumentIds.has(doc.id)
                      : selectedDocumentIds.has(doc.id);
                    
                    // Determine selection color based on mode
                    const borderColor = isLocalSelectionMode ? 'border-red-500' : 'border-blue-500';
                    const shadowColor = isLocalSelectionMode 
                      ? 'shadow-[0_0_0_2px_rgba(239,68,68,0.3)]' 
                      : 'shadow-[0_0_0_2px_rgba(59,130,246,0.3)]';
                    const outlineColor = isLocalSelectionMode 
                      ? 'rgba(239, 68, 68, 0.5)' 
                      : 'rgba(59, 130, 246, 0.5)';
                          
                          return (
                            <motion.div
                              key={doc.id}
                        className={`group relative bg-white border cursor-pointer flex flex-col overflow-hidden ${
                          isSelected 
                            ? `border-2 ${borderColor} ${shadowColor}` 
                            : 'border-gray-200'
                        }`}
                        style={{
                          width: '160px',
                          height: '213px', // 3:4 aspect ratio (160 * 4/3)
                          aspectRatio: '3/4',
                          ...(isSelected ? {
                            outline: `2px solid ${outlineColor}`,
                            outlineOffset: '2px',
                            zIndex: 10
                          } : {})
                        }}
                        whileHover={!isSelected ? { 
                          y: -4, 
                          boxShadow: '0 12px 24px -8px rgba(0, 0, 0, 0.15), 0 4px 8px -4px rgba(0, 0, 0, 0.1)',
                          borderColor: 'rgb(209, 213, 219)'
                        } : {}}
                        whileTap={{ scale: 0.98, y: -2 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                // Use ref to get the most current selection mode value
                                const currentSelectionMode = isSelectionModeRef.current;
                                console.log('📄 Document card clicked:', {
                                  docId: doc.id,
                                  isSelectionMode: isSelectionMode,
                                  isSelectionModeRef: currentSelectionMode,
                                  isChatSelectionMode: isChatSelectionMode,
                                  isLocalSelectionMode: isLocalSelectionMode,
                                  selectedDocumentIds: Array.from(selectedDocumentIds)
                                });
                                // Always check selection mode first - if active, toggle selection instead of opening
                                // Use ref value to ensure we have the latest state
                                if (currentSelectionMode) {
                                  console.log('✅ Selection mode active - toggling selection');
                                  // If local selection mode (for deletion), use local state
                                  // If chat selection mode (for querying), use global context
                                  if (isLocalSelectionMode) {
                                    setLocalSelectedDocumentIds(prev => {
                                      const newSet = new Set(prev);
                                      if (newSet.has(doc.id)) {
                                        newSet.delete(doc.id);
                          } else {
                                        newSet.add(doc.id);
                                      }
                                      return newSet;
                                    });
                                  } else {
                                    // Chat selection mode - use global context
                                    console.log('🔄 Calling toggleDocumentSelection with doc.id:', doc.id);
                                    toggleDocumentSelection(doc.id);
                                    // Log state after a brief delay to see if it updated
                                    setTimeout(() => {
                                      console.log('✅ After toggleDocumentSelection - selectedDocumentIds:', Array.from(selectedDocumentIds));
                                    }, 100);
                                  }
                          } else {
                                  console.log('📖 Selection mode NOT active - opening preview');
                                setSelectedCardIndex(index);
                          }
                        }}
                                draggable
                        onDragStart={(e) => handleDocumentDragStart(e as any, doc)}
                                onDragEnd={handleDocumentDragEnd}
                      >
                                  
                        {/* Top Preview Area - Full Card Preview */}
                         <div
                          className="flex-1 bg-gray-50 relative flex items-center justify-center overflow-hidden group-hover:bg-gray-100/50"
                                style={{
                            pointerEvents: isSelectionMode ? 'none' : 'auto'
                          }}
                        >
                          {(() => {
                            // Safety check - ensure doc exists
                            if (!doc || !doc.id) {
                              return (
                                <div className="w-full h-full flex items-center justify-center bg-gray-50">
                                  <FileText className="w-8 h-8 text-gray-300" />
                                </div>
                              );
                            }
                            
                            // Get cached cover - check ONCE and use stored value
                            const cachedCover = (window as any).__preloadedDocumentCovers?.[doc.id];
                            
                            // CRITICAL: Once a cover has been rendered, NEVER change its src
                            // Check if we've already rendered this cover - if yes, use the stored src
                            const previouslyRenderedSrc = renderedCoversRef.current.get(doc.id);
                            
                            let coverUrl: string;
                            if (previouslyRenderedSrc) {
                              // Already rendered - use the exact same src to prevent reload
                              coverUrl = previouslyRenderedSrc;
                            } else if (cachedCover?.url) {
                              // Use cached URL - this is stable and won't change
                              coverUrl = cachedCover.url;
                              // Store it so we never change it
                              renderedCoversRef.current.set(doc.id, coverUrl);
                            } else {
                              // Not cached yet - calculate and store it
                              coverUrl = getDownloadUrl(doc);
                              // Store in cache immediately to prevent recalculation
                              if (!(window as any).__preloadedDocumentCovers) {
                                (window as any).__preloadedDocumentCovers = {};
                              }
                              (window as any).__preloadedDocumentCovers[doc.id] = {
                                url: coverUrl,
                                type: (doc as any).file_type || '',
                                timestamp: Date.now()
                              };
                              // Store the rendered src
                              renderedCoversRef.current.set(doc.id, coverUrl);
                            }
                            
                            const hasDocxPreview = cachedCover?.isDocx && cachedCover?.url;
                            
                            if (isImage) {
                              // Use the stable src that never changes
                              const imageSrc = coverUrl;
                              // Once rendered, use stable props - never change loading/fetchPriority
                              const wasCached = !!cachedCover || !!previouslyRenderedSrc;
  return (
                                <img 
                                  key={`img-${doc.id}`}
                                  src={imageSrc} 
                                  className="w-full h-full object-cover opacity-90 group-hover:opacity-100"
                                  alt={doc.original_filename}
                                  loading={wasCached ? "lazy" : "eager"}
                                  decoding="async"
                                  fetchPriority={wasCached ? "auto" : "high"}
                                  style={{
                                    contentVisibility: 'auto',
                                    containIntrinsicSize: '160px 213px',
                                    pointerEvents: 'auto',
                                    imageRendering: 'auto'
                                  }}
                                />
                              );
                            } else if (isPDF) {
                              // Use stable src - once rendered, never change
                              // CRITICAL: Use the stored src to prevent reloading
                              const pdfSrc = `${coverUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`;
                              
                              // Stable key ensures React reuses the same iframe
                              const pdfIframeKey = `pdf-iframe-${doc.id}`;
                              
                              // Once rendered, use stable props - never change loading
                              const wasCached = !!cachedCover || !!previouslyRenderedSrc;
                              
                              return (
                                <div key={`pdf-${doc.id}`} className="w-full h-full relative bg-gray-50">
                                  {/* Placeholder shown while PDF loads - only if not cached */}
                                  {!wasCached && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-0">
                                      <FileText className="w-8 h-8 text-gray-300" />
                 </div>
                                )}
                                  <iframe
                                    key={pdfIframeKey}
                                    src={pdfSrc}
                                    className="w-full h-[150%] -mt-[2%] border-none opacity-90 pointer-events-none scale-100 origin-top relative z-[1] bg-white"
                                    title="preview"
                                    loading={wasCached ? "lazy" : "eager"}
                                    scrolling="no"
                                    // Prevent iframe from reloading when parent re-renders
                                    style={{
                                      contain: 'layout style paint'
                                    }}
                                  />
                                  {/* Transparent overlay to allow clicking the card */}
                                  <div className="absolute inset-0 bg-transparent z-10" />
              </div>
        );
                            } else if (isDOC && hasDocxPreview) {
                              // DOCX with cached presigned URL - use Office Online Viewer
                              // Check both ref and cache for loaded state (cache persists across re-renders)
                              const isDocxLoadedInRef = docxLoadedRef.current.has(doc.id);
                              const isDocxLoadedInCache = cachedCover.isDocxLoaded === true;
                              const isDocxLoaded = isDocxLoadedInRef || isDocxLoadedInCache;
                              
                              // CRITICAL: Use stored presigned URL - once rendered, never change
                              // Check if we've already rendered this DOCX
                              const storedDocxUrl = renderedCoversRef.current.get(`docx-${doc.id}`);
                              let docxUrl: string;
                              if (storedDocxUrl) {
                                // Already rendered - use exact same URL to prevent reload
                                docxUrl = storedDocxUrl;
                              } else {
                                // First time rendering - create URL and store it
                                docxUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(cachedCover.url)}&action=embedview&wdStartOn=1`;
                                renderedCoversRef.current.set(`docx-${doc.id}`, docxUrl);
                              }
                              
        return (
                                <div 
                                  key={`docx-container-${doc.id}`} 
                                  className="w-full h-full relative bg-white overflow-hidden"
                                  style={{
                                    contain: 'layout style paint', // Prevent layout shifts
                                    willChange: isDocxLoaded ? 'auto' : 'contents' // Optimize for loaded state
                                  }}
                                >
                                  {/* Memoized DOCX card component - prevents iframe from reloading */}
                                  <DocxCard
                                    docId={doc.id}
                                    docxUrl={docxUrl}
                                    isLoaded={isDocxLoaded}
                                    onLoad={() => {
                                      // Only update if not already loaded - prevents re-renders
                                      if (!docxLoadedRef.current.has(doc.id)) {
                                        docxLoadedRef.current.add(doc.id);
                                        // Persist loaded state in cache
                                        if ((window as any).__preloadedDocumentCovers[doc.id]) {
                                          (window as any).__preloadedDocumentCovers[doc.id].isDocxLoaded = true;
                                        }
                                        // Only trigger state update ONCE when first loaded
                                        // After this, isDocxLoaded will be true and component won't re-render
                                        setCachedCoversVersion(v => v + 1);
                                      }
                                    }}
                                  />
                                  {/* Transparent overlay to allow clicking the card */}
                                  <div className="absolute inset-0 bg-transparent z-10" />
                 </div>
                              );
                            } else {
                              return (
                                <div className="w-full h-full flex flex-col p-4 bg-white">
                                {/* Document Header/Title Simulation */}
                                <div className="w-1/3 h-1.5 bg-gray-800 mb-3 opacity-80 rounded-full"></div>
                                
                                {/* Text Content - Real or Simulated */}
                                <div className="text-[6px] leading-[1.8] text-gray-500 font-serif text-justify select-none overflow-hidden opacity-70 h-full fade-bottom">
                                  {doc.parsed_text ? (
                                    doc.parsed_text
                                  ) : (
                                    /* High-fidelity text simulation */
                                    Array(30).fill("The property valuation report indicates a substantial increase in market value over the last fiscal quarter. Comparable sales in the immediate vicinity support this assessment, with three recent transactions involving similar square footage and amenities. Environmental factors and zoning regulations remain favorable for continued appreciation. The structure appears sound with no immediate repairs required. Rental yield projections suggest a stable income stream for investors.").join(" ")
                                  )}
              </div>
                                {/* Realistic Page Fade */}
                                <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white via-white/90 to-transparent pointer-events-none" />
          </div>
        );
                            }
      
                            // Fallback - should never reach here, but ensures we always return something
        return (
                              <div className="w-full h-full flex items-center justify-center bg-gray-50">
                                <FileText className="w-8 h-8 text-gray-300" />
                  </div>
                            );
                          })()}
                                
                          {/* Hover Action Button - Only show for non-PDF/Image or if needed */}
                          {/* <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200">
                             <button className="bg-white/90 hover:bg-white text-gray-700 px-3 py-1.5 rounded-full text-xs font-medium shadow-sm backdrop-blur-sm transform translate-y-2 group-hover:translate-y-0 transition-all">
                               Open
                             </button>
                          </div> */}
                  </div>
                                  
                        {/* Bottom Metadata Area */}
                        <div className="h-[72px] px-3 py-2.5 bg-white border-t border-gray-100 flex flex-col justify-center gap-0.5">
                          <div className="flex items-start justify-between gap-2">
                             <span className="text-xs font-semibold text-gray-700 truncate leading-tight" title={doc.original_filename}>
                               {doc.original_filename}
                      </span>
                  </div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">
                              {isPDF ? 'PDF' : isDOC ? 'DOC' : isImage ? 'IMG' : 'FILE'}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              {new Date(doc.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>
              </motion.div>
                          );
                        })}
            </div>
                      )}
          </div>
                                
                    </div>
                            
            {/* Property Details Section - hidden when not active */}
                <div className={`flex-1 overflow-hidden bg-[#FCFCF9] ${activeSection !== 'propertyDetails' ? 'hidden' : ''}`}>
                  {(() => {
                    // Use local property details if available (for optimistic updates), otherwise use prop
                    const propertyDetails = localPropertyDetails || property?.propertyHub?.property_details || {};
                    const propertyImages = property?.propertyHub?.property_details?.property_images || 
                                         property?.property_images || [];
                    const primaryImage = property?.propertyHub?.property_details?.primary_image_url || 
                                       property?.primary_image_url || 
                                       (propertyImages.length > 0 ? propertyImages[0]?.url : null);
                    const address = property?.address || property?.propertyHub?.property?.formatted_address || 
                                   property?.propertyHub?.property?.normalized_address || 'Address not available';
                    
        return (
                      <div className="flex h-full">
                        {/* Left: Images Gallery or Preview */}
                        {propertyImages.length > 0 && (
                          <div className="w-1/2 border-r border-gray-100 flex flex-col overflow-y-auto scrollbar-hide h-full"
                            style={{
                              scrollbarWidth: 'none',
                              msOverflowStyle: 'none'
                            }}
                          >
                            {selectedImageIndex !== null ? (
                              /* Image Preview Mode */
                              <div 
                                className="flex-1 relative bg-gray-50 flex items-center justify-center"
                                onKeyDown={(e) => {
                                  if (e.key === 'ArrowLeft' && propertyImages.length > 1) {
                                    setSelectedImageIndex((selectedImageIndex - 1 + propertyImages.length) % propertyImages.length);
                                  } else if (e.key === 'ArrowRight' && propertyImages.length > 1) {
                                    setSelectedImageIndex((selectedImageIndex + 1) % propertyImages.length);
                                  } else if (e.key === 'Escape') {
                                    setSelectedImageIndex(null);
                                  }
                                }}
                                tabIndex={0}
                              >
                                {/* Previous Button */}
                                {propertyImages.length > 1 && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedImageIndex((selectedImageIndex - 1 + propertyImages.length) % propertyImages.length);
                                    }}
                                    className="absolute left-4 z-10 p-2 bg-white/90 hover:bg-white rounded-full shadow-sm transition-all opacity-80 hover:opacity-100"
                                    aria-label="Previous image"
                                  >
                                    <ChevronLeft className="w-5 h-5 text-gray-700" />
                                  </button>
                                )}
                                
                                {/* Main Preview Image */}
                                <div className="flex-1 h-full flex items-center justify-center p-8">
                                  <img
                                    src={propertyImages[selectedImageIndex]?.url || propertyImages[selectedImageIndex]}
                                    alt={`Property image ${selectedImageIndex + 1}`}
                                    className="max-w-full max-h-full object-contain cursor-pointer"
                                    onClick={() => setSelectedImageIndex(null)}
                                  />
                    </div>
                                
                                {/* Next Button */}
                                {propertyImages.length > 1 && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedImageIndex((selectedImageIndex + 1) % propertyImages.length);
                                    }}
                                    className="absolute right-4 z-10 p-2 bg-white/90 hover:bg-white rounded-full shadow-sm transition-all opacity-80 hover:opacity-100"
                                    aria-label="Next image"
                                  >
                                    <ChevronRight className="w-5 h-5 text-gray-700" />
                                  </button>
                                )}
                                
                                {/* Close Button */}
                                <button
                                  onClick={() => setSelectedImageIndex(null)}
                                  className="absolute top-2 right-2 z-10 p-2 bg-white/90 hover:bg-white rounded-full shadow-sm transition-all opacity-80 hover:opacity-100"
                                  aria-label="Close preview"
                                >
                                  <X className="w-4 h-4 text-gray-700" />
                                </button>
                                
                                {/* Image Counter */}
                                {propertyImages.length > 1 && (
                                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 bg-white/90 rounded-full text-xs text-gray-700 shadow-sm">
                                    {selectedImageIndex + 1} / {propertyImages.length}
                  </div>
                    )}
                    </div>
                            ) : (
                              /* Thumbnail Grid Mode */
                              <div 
                                className="grid grid-cols-2 gap-0 bg-gray-50" 
                                style={{ 
                                  gridAutoRows: 'min-content'
                                }}
                              >
                                {propertyImages.map((img: any, idx: number) => (
                                  <div
                                    key={`img-${idx}-${img.url || img.id || img}`}
                                    className="aspect-[4/3] bg-gray-100 overflow-hidden relative group cursor-pointer focus:outline-none"
                                    style={{ width: '100%', height: 'auto', outline: 'none', border: 'none', boxShadow: 'none' }}
                                    onClick={() => {
                                      setSelectedImageIndex(idx);
                                    }}
                                  >
                                    <img
                                      src={img.url || img}
                                      alt={`Property image ${idx + 1}`}
                                      className="w-full h-full object-cover focus:outline-none"
                                      style={{ display: 'block', outline: 'none', border: 'none', boxShadow: 'none' }}
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                      }}
                                    />
                    </div>
                                ))}
                  </div>
                            )}
                </div>
                        )}
                        
                        {/* Right: Content */}
                        <div 
                          className={`flex-1 overflow-y-auto scrollbar-hide h-full py-6 ${propertyImages.length > 0 ? '' : 'w-full'}`}
                          style={{
                            scrollbarWidth: 'none',
                            msOverflowStyle: 'none'
                          }}
                        >
                          <div className="px-10">
                            {/* Address Header */}
                            <div className="mb-10">
                              <h2 className="text-sm font-semibold text-gray-900 mb-0 leading-tight truncate" title={address}>{address}</h2>
                              {propertyDetails.property_type && (
                                <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wide mb-3">{propertyDetails.property_type}</p>
                              )}
                    </div>
                            
                            {/* Key Details Grid - Bedrooms, Bathrooms, Size */}
                            {(() => {
                              // Get size_unit from property details - use whatever unit is in the documents
                              const sizeUnit = property?.propertyHub?.property_details?.size_unit || (propertyDetails as any).size_unit || 'sqft';
                              const isInAcres = sizeUnit.toLowerCase() === 'acres' || sizeUnit.toLowerCase() === 'acre';
                              
                              // Check for plot/land size from property details
                              let plotSize = property?.propertyHub?.property_details?.land_size || 
                                           property?.propertyHub?.property_details?.plot_size ||
                                           (propertyDetails as any).land_size || 
                                           (propertyDetails as any).plot_size;
                              let plotSizeUnit = property?.propertyHub?.property_details?.land_size_unit || 
                                                property?.propertyHub?.property_details?.plot_size_unit ||
                                                (propertyDetails as any).land_size_unit || 
                                                (propertyDetails as any).plot_size_unit;
                              
                              // Fallback: Try to extract plot size from notes if not explicitly stored
                              if (!plotSize && propertyDetails.notes) {
                                const notesText = propertyDetails.notes.toLowerCase();
                                // Look for patterns like "11 acres", "plot of approximately 11 acres", etc.
                                const acreMatch = notesText.match(/(?:plot|land|site|grounds?|acreage).*?(\d+(?:\.\d+)?)\s*(?:acre|acres)/i);
                                if (acreMatch) {
                                  plotSize = parseFloat(acreMatch[1]);
                                  plotSizeUnit = 'acres';
                                }
                              }
                              
                              const plotIsInAcres = plotSizeUnit && (plotSizeUnit.toLowerCase() === 'acres' || plotSizeUnit.toLowerCase() === 'acre');
                              
                              // Show plot size if it exists (regardless of house size unit)
                              // Also check if plotSize is a valid number
                              const showPlotSize = plotSize !== undefined && plotSize !== null && !isNaN(Number(plotSize)) && Number(plotSize) > 0;
                              
                              console.log('🔍 Size display check:', {
                                sizeUnit,
                                isInAcres,
                                size_sqft: propertyDetails.size_sqft,
                                plotSize,
                                plotSizeType: typeof plotSize,
                                plotSizeValue: plotSize,
                                plotSizeUnit,
                                plotIsInAcres,
                                showPlotSize,
                                propertyDetailsKeys: Object.keys(propertyDetails),
                                propertyDetails: JSON.parse(JSON.stringify(propertyDetails)),
                                propertyHubKeys: property?.propertyHub?.property_details ? Object.keys(property?.propertyHub?.property_details) : [],
                                propertyHub: property?.propertyHub?.property_details ? JSON.parse(JSON.stringify(property?.propertyHub?.property_details)) : null
                              });
                              
                              return (
                                <div className={`grid ${showPlotSize ? 'grid-cols-4' : 'grid-cols-3'} gap-3 mb-4 pb-4 border-b border-gray-100`}>
                                  {/* Bedrooms */}
                                  <div className="text-center">
                                    {editingField === 'number_bedrooms' ? (
                                      <>
                      <input
                                          type="number"
                                          min="0"
                                          step="1"
                                          value={editValues['number_bedrooms'] ?? ''}
                                          onChange={(e) => handleFieldChange('number_bedrooms', e.target.value)}
                                          onBlur={() => handleFieldBlur('number_bedrooms')}
                                          onKeyDown={(e) => handleFieldKeyDown(e, 'number_bedrooms')}
                                          className="text-sm font-semibold text-gray-900 mb-0.5 w-full text-center border-b border-gray-300 focus:border-blue-500 focus:outline-none bg-transparent"
                                          autoFocus
                                          disabled={savingFields.has('number_bedrooms')}
                                        />
                                        <div className="text-[9px] text-gray-500 font-medium uppercase tracking-wide">Bedrooms</div>
                                        {fieldErrors['number_bedrooms'] && (
                                          <div className="text-[8px] text-red-500 mt-0.5">{fieldErrors['number_bedrooms']}</div>
                                        )}
                                      </>
                                    ) : (
                                      <div
                                        onClick={() => startEditing('number_bedrooms', propertyDetails.number_bedrooms)}
                                        className="cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5 -mx-1 -my-0.5"
                                      >
                                        {propertyDetails.number_bedrooms ? (
                                          <>
                                            <div className="text-sm font-semibold text-gray-900 mb-0.5">{propertyDetails.number_bedrooms}</div>
                                            <div className="text-[9px] text-gray-500 font-medium uppercase tracking-wide">Bedrooms</div>
                          </>
                        ) : (
                          <>
                                            <div className="text-sm font-normal text-gray-400 mb-0.5">Input detail</div>
                                            <div className="text-[9px] text-gray-400 font-medium uppercase tracking-wide">Bedrooms</div>
                          </>
                        )}
                  </div>
                                    )}
                    </div>
                
                                  {/* Bathrooms */}
                                  <div className="text-center">
                                    {editingField === 'number_bathrooms' ? (
                                      <>
                                        <input
                                          type="number"
                                          min="0"
                                          step="1"
                                          value={editValues['number_bathrooms'] ?? ''}
                                          onChange={(e) => handleFieldChange('number_bathrooms', e.target.value)}
                                          onBlur={() => handleFieldBlur('number_bathrooms')}
                                          onKeyDown={(e) => handleFieldKeyDown(e, 'number_bathrooms')}
                                          className="text-sm font-semibold text-gray-900 mb-0.5 w-full text-center border-b border-gray-300 focus:border-blue-500 focus:outline-none bg-transparent"
                                          autoFocus
                                          disabled={savingFields.has('number_bathrooms')}
                                        />
                                        <div className="text-[9px] text-gray-500 font-medium uppercase tracking-wide">Bathrooms</div>
                                        {fieldErrors['number_bathrooms'] && (
                                          <div className="text-[8px] text-red-500 mt-0.5">{fieldErrors['number_bathrooms']}</div>
                                        )}
                                      </>
                                    ) : (
                                      <div
                                        onClick={() => startEditing('number_bathrooms', propertyDetails.number_bathrooms)}
                                        className="cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5 -mx-1 -my-0.5"
                                      >
                                        {propertyDetails.number_bathrooms ? (
                                          <>
                                            <div className="text-sm font-semibold text-gray-900 mb-0.5">{propertyDetails.number_bathrooms}</div>
                                            <div className="text-[9px] text-gray-500 font-medium uppercase tracking-wide">Bathrooms</div>
                          </>
                        ) : (
                          <>
                                            <div className="text-sm font-normal text-gray-400 mb-0.5">Input detail</div>
                                            <div className="text-[9px] text-gray-400 font-medium uppercase tracking-wide">Bathrooms</div>
                          </>
                        )}
                    </div>
                                    )}
                      </div>
                                  
                                  {/* Size */}
                                  <div className="text-center">
                                    {editingField === 'size_sqft' ? (
                                      <>
                                        <input
                                          type="number"
                                          min="0"
                                          step="0.01"
                                          value={editValues['size_sqft'] ?? ''}
                                          onChange={(e) => handleFieldChange('size_sqft', e.target.value)}
                                          onBlur={() => handleFieldBlur('size_sqft')}
                                          onKeyDown={(e) => handleFieldKeyDown(e, 'size_sqft')}
                                          className="text-sm font-semibold text-gray-900 mb-0.5 w-full text-center border-b border-gray-300 focus:border-blue-500 focus:outline-none bg-transparent"
                                          autoFocus
                                          disabled={savingFields.has('size_sqft')}
                                        />
                                        <div className="text-[9px] text-gray-500 font-medium uppercase tracking-wide">
                                          {isInAcres ? 'acres' : 'sq ft'}
                                        </div>
                                        {fieldErrors['size_sqft'] && (
                                          <div className="text-[8px] text-red-500 mt-0.5">{fieldErrors['size_sqft']}</div>
                                        )}
                                      </>
                    ) : (
                      <div 
                                        onClick={() => startEditing('size_sqft', propertyDetails.size_sqft)}
                                        className="cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5 -mx-1 -my-0.5"
                                      >
                                        {propertyDetails.size_sqft ? (
                                          <>
                                            <div className="text-sm font-semibold text-gray-900 mb-0.5">
                                              {isInAcres 
                                                ? (propertyDetails.size_sqft % 1 === 0 ? propertyDetails.size_sqft.toString() : propertyDetails.size_sqft.toFixed(2))
                                                : propertyDetails.size_sqft.toLocaleString()}
                  </div>
                                            <div className="text-[9px] text-gray-500 font-medium uppercase tracking-wide">
                                              {isInAcres ? 'acres' : 'sq ft'}
                </div>
                                          </>
                                        ) : (
                                          <>
                                            <div className="text-sm font-normal text-gray-400 mb-0.5">Input detail</div>
                                            <div className="text-[9px] text-gray-400 font-medium uppercase tracking-wide">Size</div>
                                          </>
                                        )}
              </div>
                                    )}
            </div>
                  
                                  {/* Plot Size */}
                                  {showPlotSize && (
                                    <div className="text-center">
                                      <div className="text-sm font-semibold text-gray-900 mb-0.5">
                                        {(() => {
                                          const num = typeof plotSize === 'number' ? plotSize : Number(plotSize);
                                          return num % 1 === 0 ? num.toString() : num.toFixed(2);
                                        })()}
                                      </div>
                                      <div className="text-[9px] text-gray-500 font-medium uppercase tracking-wide">
                                        {plotIsInAcres ? 'acres' : (plotSizeUnit || 'acres')}
                                      </div>
                                    </div>
                                  )}
          </div>
        );
                            })()}
                            
                            {/* Pricing & Details - Two Column Layout */}
                            <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-4 pb-4 border-b border-gray-100">
                              {/* Pricing Column */}
                              <div className="space-y-2.5">
                                {/* Asking Price */}
                                {editingField === 'asking_price' ? (
                                  <div>
                                    <div className="text-[9px] text-gray-500 mb-0.5 font-medium uppercase tracking-wide">Asking Price</div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-xs text-gray-500">£</span>
                      <input
                        type="text"
                                        inputMode="numeric"
                                        value={editValues['asking_price'] ?? ''}
                                        onChange={(e) => handleFieldChange('asking_price', e.target.value)}
                                        onBlur={() => handleFieldBlur('asking_price')}
                                        onKeyDown={(e) => handleFieldKeyDown(e, 'asking_price')}
                                        className="text-xs font-semibold text-gray-900 flex-1 border-b border-gray-300 focus:border-blue-500 focus:outline-none bg-transparent"
                                        autoFocus
                                        disabled={savingFields.has('asking_price')}
                                        placeholder="0"
                  />
                          </div>
                                    {fieldErrors['asking_price'] && (
                                      <div className="text-[8px] text-red-500 mt-0.5">{fieldErrors['asking_price']}</div>
                                    )}
                                  </div>
                                ) : (
                                  <div
                                    onClick={() => startEditing('asking_price', propertyDetails.asking_price)}
                                    className="cursor-pointer hover:bg-gray-50 rounded px-2 py-1 -mx-2 -my-1"
                                  >
                                    <div className="text-[9px] text-gray-500 mb-0.5 font-medium uppercase tracking-wide">Asking Price</div>
                                    {propertyDetails.asking_price ? (
                                      <div className="text-xs font-semibold text-gray-900">
                                        £{propertyDetails.asking_price.toLocaleString()}
                      </div>
                                    ) : (
                                      <div className="text-xs font-normal text-gray-400">Input detail</div>
                                    )}
                                  </div>
                                )}
                                
                                {/* Sold Price */}
                                {editingField === 'sold_price' ? (
                                  <div>
                                    <div className="text-[9px] text-gray-500 mb-0.5 font-medium uppercase tracking-wide">Sold Price</div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-xs text-gray-500">£</span>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        value={editValues['sold_price'] ?? ''}
                                        onChange={(e) => handleFieldChange('sold_price', e.target.value)}
                                        onBlur={() => handleFieldBlur('sold_price')}
                                        onKeyDown={(e) => handleFieldKeyDown(e, 'sold_price')}
                                        className="text-xs font-semibold text-gray-900 flex-1 border-b border-gray-300 focus:border-blue-500 focus:outline-none bg-transparent"
                                        autoFocus
                                        disabled={savingFields.has('sold_price')}
                                        placeholder="0"
                                      />
                                    </div>
                                    {fieldErrors['sold_price'] && (
                                      <div className="text-[8px] text-red-500 mt-0.5">{fieldErrors['sold_price']}</div>
                                    )}
                                  </div>
                    ) : (
                      <div 
                                    onClick={() => startEditing('sold_price', propertyDetails.sold_price)}
                                    className="cursor-pointer hover:bg-gray-50 rounded px-2 py-1 -mx-2 -my-1"
                                  >
                                    <div className="text-[9px] text-gray-500 mb-0.5 font-medium uppercase tracking-wide">Sold Price</div>
                                    {propertyDetails.sold_price ? (
                                      <div className="text-xs font-semibold text-gray-900">
                                        £{propertyDetails.sold_price.toLocaleString()}
                                      </div>
                                    ) : (
                                      <div className="text-xs font-normal text-gray-400">Input detail</div>
                                    )}
                                  </div>
                                )}
                                  
                                {/* Rent */}
                                {editingField === 'rent_pcm' ? (
                                  <div>
                                    <div className="text-[9px] text-gray-500 mb-0.5 font-medium uppercase tracking-wide">Rent (pcm)</div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-xs text-gray-500">£</span>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        value={editValues['rent_pcm'] ?? ''}
                                        onChange={(e) => handleFieldChange('rent_pcm', e.target.value)}
                                        onBlur={() => handleFieldBlur('rent_pcm')}
                                        onKeyDown={(e) => handleFieldKeyDown(e, 'rent_pcm')}
                                        className="text-xs font-semibold text-gray-900 flex-1 border-b border-gray-300 focus:border-blue-500 focus:outline-none bg-transparent"
                                        autoFocus
                                        disabled={savingFields.has('rent_pcm')}
                                        placeholder="0"
                                      />
                                    </div>
                                    {fieldErrors['rent_pcm'] && (
                                      <div className="text-[8px] text-red-500 mt-0.5">{fieldErrors['rent_pcm']}</div>
                                    )}
                                  </div>
                                ) : (
                                  <div
                                    onClick={() => startEditing('rent_pcm', propertyDetails.rent_pcm)}
                                    className="cursor-pointer hover:bg-gray-50 rounded px-2 py-1 -mx-2 -my-1"
                                  >
                                    <div className="text-[9px] text-gray-500 mb-0.5 font-medium uppercase tracking-wide">Rent (pcm)</div>
                                    {propertyDetails.rent_pcm ? (
                                      <div className="text-xs font-semibold text-gray-900">
                                        £{propertyDetails.rent_pcm.toLocaleString()}
                        </div>
                                    ) : (
                                      <div className="text-xs font-normal text-gray-400">Input detail</div>
                                    )}
                                  </div>
                                )}
                  </div>
                  
                              {/* Details Column */}
                              <div className="space-y-2.5">
                                {/* Tenure */}
                                {editingField === 'tenure' ? (
                                  <div>
                                    <div className="text-[9px] text-gray-500 mb-0.5 font-medium uppercase tracking-wide">Tenure</div>
                                    <input
                                      type="text"
                                      value={editValues['tenure'] ?? ''}
                                      onChange={(e) => handleFieldChange('tenure', e.target.value)}
                                      onBlur={() => handleFieldBlur('tenure')}
                                      onKeyDown={(e) => handleFieldKeyDown(e, 'tenure')}
                                      className="text-xs text-gray-900 font-medium w-full border-b border-gray-300 focus:border-blue-500 focus:outline-none bg-transparent"
                                      autoFocus
                                      disabled={savingFields.has('tenure')}
                                      placeholder="e.g. Freehold, Leasehold"
                                    />
                                    {fieldErrors['tenure'] && (
                                      <div className="text-[8px] text-red-500 mt-0.5">{fieldErrors['tenure']}</div>
                                    )}
                                  </div>
                                ) : (
                                  <div
                                    onClick={() => startEditing('tenure', propertyDetails.tenure)}
                                    className="cursor-pointer hover:bg-gray-50 rounded px-2 py-1 -mx-2 -my-1"
                                  >
                                    <div className="text-[9px] text-gray-500 mb-0.5 font-medium uppercase tracking-wide">Tenure</div>
                                    {propertyDetails.tenure ? (
                                      <div className="text-xs text-gray-900 font-medium">{propertyDetails.tenure}</div>
                                    ) : (
                                      <div className="text-xs font-normal text-gray-400">Input detail</div>
                                    )}
                                  </div>
                                )}
                                  
                                {/* EPC Rating */}
                                {editingField === 'epc_rating' ? (
                                  <div>
                                    <div className="text-[9px] text-gray-500 mb-0.5 font-medium uppercase tracking-wide">EPC Rating</div>
                                    <input
                                      type="text"
                                      value={editValues['epc_rating'] ?? ''}
                                      onChange={(e) => handleFieldChange('epc_rating', e.target.value)}
                                      onBlur={() => handleFieldBlur('epc_rating')}
                                      onKeyDown={(e) => handleFieldKeyDown(e, 'epc_rating')}
                                      className="text-xs text-gray-900 font-medium w-full border-b border-gray-300 focus:border-blue-500 focus:outline-none bg-transparent"
                                      autoFocus
                                      disabled={savingFields.has('epc_rating')}
                                      placeholder="e.g. A, B, C, D, E, F, G"
                                    />
                                    {fieldErrors['epc_rating'] && (
                                      <div className="text-[8px] text-red-500 mt-0.5">{fieldErrors['epc_rating']}</div>
                                    )}
                  </div>
                                ) : (
                                  <div
                                    onClick={() => startEditing('epc_rating', propertyDetails.epc_rating)}
                                    className="cursor-pointer hover:bg-gray-50 rounded px-2 py-1 -mx-2 -my-1"
                                  >
                                    <div className="text-[9px] text-gray-500 mb-0.5 font-medium uppercase tracking-wide">EPC Rating</div>
                                    {propertyDetails.epc_rating ? (
                                      <div className="text-xs text-gray-900 font-medium">{propertyDetails.epc_rating}</div>
                                    ) : (
                                      <div className="text-xs font-normal text-gray-400">Input detail</div>
                                    )}
                      </div>
                                )}
                                
                                {/* Condition */}
                                {editingField === 'condition' ? (
                                  <div>
                                    <div className="text-[9px] text-gray-500 mb-0.5 font-medium uppercase tracking-wide">Condition</div>
                                    <input
                                      type="text"
                                      value={editValues['condition'] ?? ''}
                                      onChange={(e) => handleFieldChange('condition', e.target.value)}
                                      onBlur={() => handleFieldBlur('condition')}
                                      onKeyDown={(e) => handleFieldKeyDown(e, 'condition')}
                                      className="text-xs text-gray-900 font-medium w-full border-b border-gray-300 focus:border-blue-500 focus:outline-none bg-transparent"
                                      autoFocus
                                      disabled={savingFields.has('condition')}
                                      placeholder="e.g. Excellent, Good, Fair"
                                    />
                                    {fieldErrors['condition'] && (
                                      <div className="text-[8px] text-red-500 mt-0.5">{fieldErrors['condition']}</div>
                                    )}
                                    </div>
                    ) : (
                      <div 
                                    onClick={() => startEditing('condition', propertyDetails.condition)}
                                    className="cursor-pointer hover:bg-gray-50 rounded px-2 py-1 -mx-2 -my-1"
                                  >
                                    <div className="text-[9px] text-gray-500 mb-0.5 font-medium uppercase tracking-wide">Condition</div>
                                    {propertyDetails.condition ? (
                                      <div className="text-xs text-gray-900 font-medium">{propertyDetails.condition}</div>
                                    ) : (
                                      <div className="text-xs font-normal text-gray-400">Input detail</div>
                                    )}
                                  </div>
                                )}
                                  </div>
                                </div>
                                
                            {/* Amenities */}
                            <div className="mb-4 pb-4 border-b border-gray-100">
                              <div className="text-[9px] text-gray-500 mb-1.5 font-medium uppercase tracking-wide">Amenities</div>
                              {editingField === 'other_amenities' ? (
                                <>
                                  <textarea
                                    ref={amenitiesTextareaRef}
                                    value={editValues['other_amenities'] ?? ''}
                                    onChange={(e) => handleFieldChange('other_amenities', e.target.value)}
                                    onBlur={() => handleFieldBlur('other_amenities')}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') {
                                        setEditingField(null);
                                        setEditValues(prev => {
                                          const newValues = { ...prev };
                                          delete newValues['other_amenities'];
                                          return newValues;
                                        });
                                      }
                                    }}
                                    className="text-xs text-gray-900 leading-relaxed w-full border border-gray-300 focus:border-blue-500 focus:outline-none rounded px-2 py-1.5 resize-none overflow-hidden"
                                    autoFocus
                                    disabled={savingFields.has('other_amenities')}
                                    placeholder="Enter amenities..."
                                  />
                                  {fieldErrors['other_amenities'] && (
                                    <div className="text-[8px] text-red-500 mt-0.5">{fieldErrors['other_amenities']}</div>
                                  )}
                                </>
                              ) : (
                                <div
                                  onClick={() => startEditing('other_amenities', propertyDetails.other_amenities)}
                                  className="cursor-pointer hover:bg-gray-50 rounded px-2 py-1.5 -mx-2 -my-1.5"
                                >
                                  {propertyDetails.other_amenities ? (
                                    <div className="text-xs text-gray-900 leading-relaxed whitespace-pre-wrap">{propertyDetails.other_amenities}</div>
                                  ) : (
                                    <div className="text-xs font-normal text-gray-400">Input detail</div>
                                  )}
                                  </div>
                                )}
                                </div>
                                  
                            {/* Notes/Bio */}
                            <div>
                              <div className="text-[9px] text-gray-500 mb-1.5 font-medium uppercase tracking-wide">Notes</div>
                              {editingField === 'notes' ? (
                                <>
                                  <textarea
                                    ref={notesTextareaRef}
                                    value={editValues['notes'] ?? ''}
                                    onChange={(e) => handleFieldChange('notes', e.target.value)}
                                    onBlur={() => handleFieldBlur('notes')}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') {
                                        setEditingField(null);
                                        setEditValues(prev => {
                                          const newValues = { ...prev };
                                          delete newValues['notes'];
                                          return newValues;
                                        });
                                      }
                                    }}
                                    className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap w-full border border-gray-300 focus:border-blue-500 focus:outline-none rounded px-2 py-1.5 resize-none overflow-hidden"
                                    autoFocus
                                    disabled={savingFields.has('notes')}
                                    placeholder="Enter notes..."
                                  />
                                  {fieldErrors['notes'] && (
                                    <div className="text-[8px] text-red-500 mt-0.5">{fieldErrors['notes']}</div>
                                  )}
                                </>
                              ) : (
                                <div
                                  onClick={() => startEditing('notes', propertyDetails.notes)}
                                  className="cursor-pointer hover:bg-gray-50 rounded px-2 py-1.5 -mx-2 -my-1.5"
                                >
                                  {propertyDetails.notes ? (
                                    <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">{propertyDetails.notes}</div>
                                  ) : (
                                    <div className="text-xs font-normal text-gray-400">Input detail</div>
                                  )}
                                    </div>
                              )}
                                </div>
                                
                            {/* Empty State */}
                            {!propertyDetails.property_type && 
                             !propertyDetails.number_bedrooms && 
                             !propertyDetails.size_sqft && 
                             !propertyDetails.asking_price && 
                             !propertyDetails.notes && 
                             propertyImages.length === 0 && (
                              <div className="flex items-center justify-center h-64 text-center">
                                <div>
                                  <p className="text-gray-400 text-sm">No property details available</p>
                                  <p className="text-gray-300 text-xs mt-1">Upload documents to extract property information</p>
                                   </div>
                                </div>
                    )}
                            </div>
                              </div>
                              </div>
                          );
                  })()}
                    </div>
            
            {/* Hidden Input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
            
            {/* Upload errors are now handled by UploadProgressBar component */}
            
             {/* Selection Floating Bar - Updated Style */}
                {/* Only show when in local selection mode (for deletion), not chat selection mode */}
                {isLocalSelectionMode && localSelectedDocumentIds.size > 0 && (
                        <div
                    className="absolute bottom-6 left-0 right-0 mx-auto w-fit bg-gray-900 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-4 z-50"
                  >
                    <span className="font-medium text-sm">{localSelectedDocumentIds.size} selected</span>
                    <div className="h-4 w-px bg-gray-700"></div>
                    
                    {/* Reprocess Button with Dropdown */}
                    <div className="relative">
                      <button
                        onClick={() => setReprocessDropdownOpen(!reprocessDropdownOpen)}
                        className={`text-blue-400 hover:text-blue-300 font-medium text-sm flex items-center gap-1.5 transition-colors ${isReprocessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                        disabled={isReprocessing}
                        title="Reprocess documents for citation highlighting"
                      >
                        {isReprocessing ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <RefreshCw size={14} />
                        )}
                        Reprocess
                        <ChevronDown size={12} className="opacity-70" />
                      </button>
                      
                      {/* Dropdown Menu */}
                      {reprocessDropdownOpen && !isReprocessing && (
                        <div 
                          className="absolute bottom-full left-0 mb-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50"
                          onMouseLeave={() => setReprocessDropdownOpen(false)}
                        >
                          <button
                            onClick={() => handleReprocessSelected('full')}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex flex-col gap-0.5 text-gray-800"
                          >
                            <span className="font-medium">Full Reprocess</span>
                            <span className="text-xs text-gray-500">Re-embed & extract BBOX (slower)</span>
                          </button>
                          <button
                            onClick={() => handleReprocessSelected('bbox_only')}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex flex-col gap-0.5 text-gray-800"
                          >
                            <span className="font-medium">Update BBOX Only</span>
                            <span className="text-xs text-gray-500">Keep embeddings, add BBOX (faster)</span>
                          </button>
                        </div>
                      )}
                      
                      {/* Result Toast */}
                      {reprocessResult && (
                        <div 
                          className={`absolute bottom-full left-0 mb-2 px-3 py-2 rounded-lg shadow-lg text-sm whitespace-nowrap z-50 ${
                            reprocessResult.success 
                              ? 'bg-green-50 text-green-800 border border-green-200' 
                              : 'bg-red-50 text-red-800 border border-red-200'
                          }`}
                        >
                          {reprocessResult.message}
                        </div>
                      )}
                    </div>
                    
                    <div className="h-4 w-px bg-gray-700"></div>
                    <button 
                      onClick={() => setShowDeleteConfirm(true)}
                      className="text-red-400 hover:text-red-300 font-medium text-sm flex items-center gap-1.5 transition-colors"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                    <button 
                      onClick={() => {
                        setLocalSelectedDocumentIds(new Set());
                        setIsLocalSelectionMode(false);
                      }}
                      className="text-gray-400 hover:text-white text-sm transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
             
             {/* Delete Confirmation Dialog */}
             <AnimatePresence>
                {showDeleteConfirm && (
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                          <motion.div
                      initial={{ scale: 0.96, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.96, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="bg-white w-full shadow-xl"
                      style={{ borderRadius: 0, maxWidth: '340px' }}
                    >
                       <div className="px-5 py-4 border-b border-gray-100">
                         <h3 className="text-base font-semibold text-gray-900">Delete Documents?</h3>
                       </div>
                       <div className="px-5 py-4">
                         <p className="text-sm text-gray-600 leading-relaxed">
                           Are you sure? This will permanently delete {localSelectedDocumentIds.size} {localSelectedDocumentIds.size === 1 ? 'document' : 'documents'}. This action cannot be undone.
                       </p>
                       </div>
                       <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
                              <button
                                onClick={() => setShowDeleteConfirm(false)}
                           className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={async () => {
                                  // Optimistically update UI immediately for instant feedback
                                  const documentsToDelete = Array.from(localSelectedDocumentIds);
                                  const previousDocuments = [...documents];
                                  
                                  // Remove documents from UI immediately
                                  setDocuments(prev => prev.filter(doc => !localSelectedDocumentIds.has(doc.id)));
                                  
                                  // Close preview if deleted document was open
                                  if (selectedCardIndex !== null) {
                                    const selectedDoc = documents[selectedCardIndex];
                                    if (selectedDoc && localSelectedDocumentIds.has(selectedDoc.id)) {
                                      setSelectedCardIndex(null);
                                }
                                  }
                                  
                                  // Clear selection and close dialog immediately
                                  setLocalSelectedDocumentIds(new Set());
                                  setIsLocalSelectionMode(false);
                                setShowDeleteConfirm(false);
                                  
                                  // Delete in parallel in the background (non-blocking)
                                  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
                                  Promise.all(
                                    documentsToDelete.map(async (docId) => {
                                      try {
                                        const response = await fetch(`${backendUrl}/api/documents/${docId}`, {
                                          method: 'DELETE',
                                          credentials: 'include',
                                          headers: { 'Content-Type': 'application/json' },
                                        });
                                        if (!response.ok) throw new Error(`Failed to delete: ${response.status}`);
                                        
                                        // Update recent projects after successful deletion
                                        if (property) {
                                          const updatedCount = documents.length - documentsToDelete.length;
                                          saveToRecentProjects({
                                            ...property,
                                            documentCount: updatedCount
                                          });
                                        }
                              } catch (e) {
                                        console.error('Error deleting document:', e);
                                        // Revert on error
                                        setDocuments(previousDocuments);
                                      }
                                    })
                                  ).catch(e => {
                                    console.error('Error in batch delete:', e);
                                    setDocuments(previousDocuments);
                                  });
                                }}
                           className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 transition-colors"
                              >
                                Delete
                              </button>
                            </div>
                          </motion.div>
                  </div>
              )}
            </AnimatePresence>

            {/* Document Preview - Covers entire panel including headers */}
            {selectedCardIndex !== null && (
              <div 
                className="absolute inset-0 z-[200] bg-white"
            style={{ 
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0
                }}
              >
                <ExpandedCardView
                  selectedDoc={selectedDocument}
                  onClose={handleClosePreview}
                  onDocumentClick={handleDocumentClick}
                  isFullscreen={isFullscreen}
                  onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
                  highlightCitation={highlightCitation}
                  onCitationAction={handleCitationAction}
                  propertyId={property?.id}
                />
                      </div>
            )}
        </motion.div>
                        </div>
          )}
        </AnimatePresence>,
        document.body
      )}
      
      {/* Progress monitor for document reprocessing */}
      <ReprocessProgressMonitor
        documentId={reprocessingDocumentId}
        isActive={isReprocessing && reprocessingDocumentId !== null}
        onComplete={(success) => {
          console.log('Reprocess completed:', success);
        }}
        onClose={() => {
          setIsReprocessing(false);
          setReprocessingDocumentId(null);
        }}
      />
    </>
  );
};

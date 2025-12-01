"use client";

import * as React from "react";
import { createPortal, flushSync } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Download, RotateCw, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, FileText, Image as ImageIcon, Globe, Plus } from "lucide-react";
import { FileAttachmentData } from './FileAttachment';
import { usePreview, CitationHighlight } from '../contexts/PreviewContext';

interface DocumentPreviewModalProps {
  files: FileAttachmentData[];
  activeTabIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onTabChange: (index: number) => void;
  onTabClose: (index: number) => void;
  onAddAttachment?: () => void;
  isMapVisible?: boolean;
  isSidebarCollapsed?: boolean;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
  files,
  activeTabIndex,
  isOpen,
  onClose,
  onTabChange,
  onTabClose,
  onAddAttachment,
  isMapVisible = false,
  isSidebarCollapsed = false
}) => {
  const file = files[activeTabIndex] || null;
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = React.useState(100);
  const [rotation, setRotation] = React.useState(0);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  
  // Get highlight citation from context
  const { highlightCitation, clearHighlightCitation } = usePreview();
  
  // Check if current file has a highlight
  const fileHighlight = React.useMemo(() => {
    if (!highlightCitation || !file) return null;
    if (highlightCitation.fileId === file.id) {
      return highlightCitation;
    }
    return null;
  }, [highlightCitation, file]);
  const [imageNaturalHeight, setImageNaturalHeight] = React.useState<number | null>(null);
  const [imageNaturalWidth, setImageNaturalWidth] = React.useState<number | null>(null);
  const [imageRenderedHeight, setImageRenderedHeight] = React.useState<number | null>(null);
  const [imageRenderedWidth, setImageRenderedWidth] = React.useState<number | null>(null);
  const [forceUpdate, setForceUpdate] = React.useState(0);
  const [headerHeight, setHeaderHeight] = React.useState(50);
  
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
      setCurrentPage(1);
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
      setCurrentPage(1); // Reset page
      currentBlobUrlRef.current = null; // Clear ref but don't revoke preloaded URLs
    }
  }, [file, isOpen, isMapVisible, activeTabIndex]);

  // Determine file types (must be before useEffects that use them)
  const isPDF = file?.type === 'application/pdf';
  const isImage = file?.type.startsWith('image/');
  const isDOCX = file?.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                 file?.type === 'application/msword' ||
                 (file?.name && (file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.doc')));

  // Navigate to correct page when highlight is set (for PDFs)
  React.useEffect(() => {
    if (fileHighlight && isPDF && fileHighlight.bbox.page) {
      const targetPage = fileHighlight.bbox.page;
      if (targetPage !== currentPage) {
        console.log('📄 Navigating to page', targetPage, 'for highlight');
        setCurrentPage(targetPage);
      }
    }
  }, [fileHighlight, isPDF, currentPage]);

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
                    // Calculate left position based on sidebar state or resize position
                    // Sidebar is 40px (w-10) on mobile, 56px (lg:w-14) on desktop when expanded
                    // Add spacing after sidebar to match top spacing proportionally (24px to match 16px top)
                    left: modalPosition?.left !== undefined 
                      ? `${modalPosition.left}px`
                      : (isSidebarCollapsed 
                          ? '24px' 
                          : 'calc(max(40px, 56px) + 24px)'), // Responsive: 40px mobile, 56px desktop + 24px spacing (1.5x top spacing)
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
                    // Prevent any visual transitions on dimensions
                    transition: 'none',
                    // Transform handled by CSS class .modal-centered to override Framer Motion
                    // Resize cursor
                    ...(isResizing ? { cursor: resizeDirection === 'se' ? 'nwse-resize' : resizeDirection === 'sw' ? 'nesw-resize' : resizeDirection === 'ne' ? 'nesw-resize' : resizeDirection === 'nw' ? 'nwse-resize' : resizeDirection === 'e' || resizeDirection === 'w' ? 'ew-resize' : resizeDirection === 'n' || resizeDirection === 's' ? 'ns-resize' : 'default' } : {})
                  }
              )
            }}
            className={`flex flex-col bg-white rounded-lg shadow-2xl overflow-hidden ${!isMapVisible ? 'modal-centered' : ''} ${isResizing ? 'select-none' : ''}`}
            onClick={(e) => e.stopPropagation()}
            ref={modalRef}
          >
            {/* Tabs Bar - File Tab Style - Fixed container */}
            {files.length > 0 && (
              <div 
                ref={tabsContainerRef}
                className="flex items-end gap-1 pt-4 pb-0 overflow-x-auto overflow-y-visible tabs-scrollbar border-b border-gray-100" 
                style={{ 
                  background: 'white', 
                  width: '100%',
                  minWidth: '100%',
                  maxWidth: '100%',
                  paddingLeft: '16px', 
                  paddingRight: '16px',
                  marginBottom: '0',
                  flexWrap: 'nowrap',
                  alignItems: 'flex-end', // Align tabs at bottom
                  boxSizing: 'border-box',
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  flexShrink: 0,
                  flexGrow: 0,
                  position: 'relative',
                  zIndex: 1,
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
                      draggable={false}
                      onMouseDown={(e) => {
                        console.log('🖱️ Tab mousedown:', {
                          index,
                          fileName: tabFile.name,
                          target: e.target,
                          currentTarget: e.currentTarget,
                          defaultPrevented: e.defaultPrevented,
                          type: e.type
                        });
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        console.log('🖱️ Tab click:', {
                          index,
                          fileName: tabFile.name,
                          target: e.target,
                          currentTarget: e.currentTarget,
                          defaultPrevented: e.defaultPrevented,
                          type: e.type,
                          button: e.button,
                          detail: e.detail,
                          ctrlKey: e.ctrlKey,
                          metaKey: e.metaKey,
                          shiftKey: e.shiftKey
                        });
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
                        console.log('✅ Calling onTabChange with index:', index);
                        onTabChange(index);
                        console.log('✅ onTabChange called');
                        // Return false to prevent any default behavior
                        return false;
                      }}
                      onContextMenu={(e) => {
                        console.log('🖱️ Tab contextmenu:', {
                          index,
                          fileName: tabFile.name
                        });
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onAuxClick={(e) => {
                        console.log('🖱️ Tab auxclick (middle mouse):', {
                          index,
                          fileName: tabFile.name,
                          button: e.button
                        });
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      className={`
                        flex items-center gap-2 px-3 py-2 text-sm font-medium cursor-pointer transition-all relative
                        ${isActive 
                          ? 'bg-white text-gray-900 border-t border-l border-r border-gray-200 rounded-t-lg shadow-sm' 
                          : 'text-gray-500 hover:text-gray-700 bg-gray-50 border-t border-l border-r border-gray-200 rounded-t-lg hover:bg-gray-100'
                        }
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
                {/* Plus button to add new attachment */}
                {files.length < 4 && onAddAttachment && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddAttachment();
                    }}
                    className="flex items-center justify-center w-7 h-7 rounded-t-lg hover:bg-gray-100/50 transition-all duration-150 focus:outline-none outline-none border-t border-l border-r border-gray-200 bg-gray-50"
                    style={{
                      marginBottom: '0',
                    }}
                    title="Add attachment"
                  >
                    <Plus className="w-4 h-4 text-gray-600" />
                  </button>
                )}
              </div>
            )}
            
            {/* Top Bar - File Name and Controls (Browser-like) */}
            <div ref={headerRef} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white">
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
                
                {/* Close */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                  }}
                  className="p-1.5 hover:bg-gray-100 rounded transition-colors ml-1"
                  title="Close"
                >
                  <X className="w-4 h-4 text-gray-600" />
                </button>
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
                          width: typeof pdfObjectWidth === 'number' ? `${pdfObjectWidth}px` : pdfObjectWidth,
                          height: typeof pdfObjectHeight === 'number' ? `${pdfObjectHeight}px` : pdfObjectHeight,
                          minWidth: zoomLevel > 100 && typeof pdfObjectWidth === 'number' ? `${pdfObjectWidth}px` : undefined,
                          minHeight: zoomLevel > 100 && typeof pdfObjectHeight === 'number' ? `${pdfObjectHeight}px` : undefined,
                          display: 'block',
                          position: 'relative'
                        }}
                      >
                        <object
                          ref={iframeRef as React.RefObject<HTMLObjectElement>}
                          key={`pdf-${file.id}-${blobUrl}-${zoomLevel}`}
                          data={zoomLevel > 100 
                            ? `${blobUrl}#page=${currentPage}&zoom=${zoomLevel}` // No view constraint when zoomed - allows free panning
                            : `${blobUrl}#page=${currentPage}&zoom=page-fit&view=Fit`} // Use Fit when at 100% or less
                          type="application/pdf"
                          className="border-0 bg-white"
                          style={{
                            width: '100%',
                            height: '100%',
                            pointerEvents: zoomLevel > 100 ? 'none' : 'auto', // Disable pointer events when zoomed so container handles all scrolling
                            imageRendering: 'auto',
                            WebkitFontSmoothing: 'antialiased',
                            transform: 'translateZ(0)',
                            backfaceVisibility: 'hidden',
                            display: 'block',
                            margin: '0',
                            padding: '0',
                            boxSizing: 'border-box',
                            touchAction: 'none', // Prevent object from interfering with scroll events - let container handle scrolling
                          }}
                        title={file.name}
                        tabIndex={-1}
                        onLoad={(e) => {
                          console.log('📄 PDF object loaded');
                          // Reset scroll position to top-left when PDF loads - use pdfWrapperRef, not previewAreaRef
                          if (pdfWrapperRef.current) {
                            pdfWrapperRef.current.scrollLeft = 0;
                            pdfWrapperRef.current.scrollTop = 0;
                          }
                        }}
                        onError={(e) => {
                          console.error('❌ PDF object error:', e);
                        }}
                      >
                          <p>PDF cannot be displayed. <a href={blobUrl || undefined} download={file.name}>Download PDF</a></p>
                        </object>
                        
                        {/* Highlight overlay for citations */}
                        {fileHighlight && fileHighlight.bbox && (() => {
                          // Calculate highlight position from normalized bbox coordinates (0-1) to pixels
                          const container = pdfWrapperRef.current;
                          if (!container) return null;
                          
                          const containerWidth = container.clientWidth;
                          const containerHeight = container.clientHeight;
                          
                          // Bbox coordinates are normalized (0-1), convert to pixels
                          const highlightLeft = containerWidth * fileHighlight.bbox.left;
                          const highlightTop = containerHeight * fileHighlight.bbox.top;
                          const highlightWidth = containerWidth * fileHighlight.bbox.width;
                          const highlightHeight = containerHeight * fileHighlight.bbox.height;
                          
                          return (
                            <div
                              style={{
                                position: 'absolute',
                                left: `${highlightLeft}px`,
                                top: `${highlightTop}px`,
                                width: `${highlightWidth}px`,
                                height: `${highlightHeight}px`,
                                backgroundColor: 'rgba(255, 235, 59, 0.3)', // Yellow highlight, 30% opacity
                                border: '2px solid rgba(255, 193, 7, 0.8)', // Darker yellow border
                                borderRadius: '2px',
                                pointerEvents: 'none', // Don't block interactions
                                zIndex: 10, // Above PDF, below UI controls
                                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                                opacity: 0,
                                animation: 'fadeInHighlight 0.3s ease-in forwards',
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                // Clear highlight on click
                                clearHighlightCitation();
                              }}
                            />
                          );
                        })()}
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


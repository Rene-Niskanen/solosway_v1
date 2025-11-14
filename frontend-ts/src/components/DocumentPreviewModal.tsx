"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Download, RotateCw, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from "lucide-react";
import { FileAttachmentData } from './FileAttachment';

interface DocumentPreviewModalProps {
  file: FileAttachmentData | null;
  isOpen: boolean;
  onClose: () => void;
  isMapVisible?: boolean;
  isSidebarCollapsed?: boolean;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
  file,
  isOpen,
  onClose,
  isMapVisible = false,
  isSidebarCollapsed = false
}) => {
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = React.useState(100);
  const [rotation, setRotation] = React.useState(0);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [imageNaturalHeight, setImageNaturalHeight] = React.useState<number | null>(null);
  const [imageNaturalWidth, setImageNaturalWidth] = React.useState<number | null>(null);
  const [imageRenderedHeight, setImageRenderedHeight] = React.useState<number | null>(null);
  const [forceUpdate, setForceUpdate] = React.useState(0);
  const [headerHeight, setHeaderHeight] = React.useState(50);
  const [calculatedModalHeight, setCalculatedModalHeight] = React.useState<string | number>('85vh');
  const headerRef = React.useRef<HTMLDivElement>(null);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const imgRef = React.useRef<HTMLImageElement>(null);
  const previewAreaRef = React.useRef<HTMLDivElement>(null);

  // Create blob URL when file changes
  React.useEffect(() => {
    if (file && isOpen) {
      const url = URL.createObjectURL(file.file);
      setBlobUrl(url);
      // Set initial zoom to fit document to container - use page-fit for both views
      // This ensures the document is properly sized relative to the preview container
      setZoomLevel(100); // Will be overridden by page-fit in iframe src
      setRotation(0);
      setCurrentPage(1);
      setImageNaturalHeight(null); // Reset image height when file changes
      setImageNaturalWidth(null); // Reset image width when file changes
      setImageRenderedHeight(null); // Reset rendered height when file changes
      setForceUpdate(0); // Reset force update
      
      // For PDFs, we'll need to detect total pages from the iframe
      if (file.type === 'application/pdf') {
        // PDF pages will be detected by the iframe
        setTotalPages(1); // Will be updated if we can detect it
      }
      
      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setBlobUrl(null);
      setImageNaturalHeight(null);
      setImageNaturalWidth(null);
      setImageRenderedHeight(null);
    }
  }, [file, isOpen, isMapVisible]);

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
    if (!blobUrl || !file) return;
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  const handleZoomIn = () => {
    setZoomLevel(prev => {
      const newZoom = prev + 10;
      // For images, update zoom level
      // For PDFs, always use page-fit to ensure proper sizing relative to container
      if (isPDF && iframeRef.current && blobUrl) {
        // Use a percentage zoom that's relative to page-fit
        iframeRef.current.src = `${blobUrl}#page=${currentPage}&zoom=${newZoom}&view=Fit`;
      }
      return Math.min(200, newZoom);
    });
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => {
      const newZoom = prev - 10;
      // For images, update zoom level
      // For PDFs, always use Fit view to ensure proper sizing relative to container
      if (isPDF && iframeRef.current && blobUrl) {
        iframeRef.current.src = `${blobUrl}#page=${currentPage}&zoom=${newZoom}&view=Fit`;
      }
      return Math.max(25, newZoom);
    });
  };

  const handlePreviousPage = () => {
    setCurrentPage(prev => {
      const newPage = Math.max(1, prev - 1);
      // Update iframe src when page changes - always use Fit view for proper sizing
      if (isPDF && iframeRef.current && blobUrl) {
        iframeRef.current.src = `${blobUrl}#page=${newPage}&zoom=page-fit&view=Fit`;
      }
      return newPage;
    });
  };

  const handleNextPage = () => {
    setCurrentPage(prev => {
      const newPage = Math.min(totalPages, prev + 1);
      // Update iframe src when page changes - always use Fit view for proper sizing
      if (isPDF && iframeRef.current && blobUrl) {
        iframeRef.current.src = `${blobUrl}#page=${newPage}&zoom=page-fit&view=Fit`;
      }
      return newPage;
    });
  };

  const isPDF = file?.type === 'application/pdf';
  const isImage = file?.type.startsWith('image/');

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
        const { height } = entry.contentRect;
        if (height > 0) {
          setImageRenderedHeight(height);
        }
      }
    });

    resizeObserver.observe(img);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isImage, isMapVisible, blobUrl]);

  // Calculate modal height based on content type
  // For images: fit tightly to image height (with minimal padding and header)
  // For PDFs: use standard height (85vh)
  React.useEffect(() => {
    if (isImage && !isMapVisible) {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        // Try to get actual rendered height from the image element
        let imageHeight = imageRenderedHeight;
        
        // If we don't have rendered height yet, try to get it from the ref
        if (!imageHeight && imgRef.current) {
          imageHeight = imgRef.current.offsetHeight;
        }
        
        // If still no height, calculate from natural dimensions
        if (!imageHeight && imageNaturalHeight && imageNaturalWidth) {
          const modalWidth = Math.min(window.innerWidth * 0.9, 1152);
          const imageAspectRatio = imageNaturalHeight / imageNaturalWidth;
          imageHeight = modalWidth * imageAspectRatio;
        }
        
        // Only update if we have a valid height
        if (imageHeight && imageHeight > 0) {
          // Padding is 4px total (2px top + 2px bottom from inline style padding: '2px 4px')
          const padding = 4; // 4px total (2px top + 2px bottom)
          const maxHeight = window.innerHeight * 0.95; // Max 95% of viewport
          // Add header height and padding to get total modal height
          const totalHeight = imageHeight + headerHeight + padding;
          
          // Use calculated height if it's reasonable, otherwise use max
          const newHeight = Math.min(totalHeight, maxHeight);
          setCalculatedModalHeight(newHeight);
        }
      });
    } else {
      // For PDFs or map view, use standard height
      setCalculatedModalHeight(isMapVisible ? '650px' : '85vh');
    }
  }, [isImage, imageNaturalHeight, imageNaturalWidth, imageRenderedHeight, isMapVisible, headerHeight, forceUpdate]);

  const modalHeight = calculatedModalHeight;

  // Use portal to render outside of parent container to avoid transform issues
  const modalContent = (
    <AnimatePresence>
      {isOpen && file && (
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
            layout={isImage}
            initial={{ 
              opacity: 0, 
              scale: 0.95, 
              ...(isMapVisible 
                ? { x: -20, y: -20 } 
                : { x: '-50%', y: '-50%' }
              )
            }}
            animate={{ 
              opacity: 1, 
              scale: 1, 
              ...(isMapVisible 
                ? { x: 0, y: 0 } 
                : { x: '-50%', y: '-50%' }
              ),
              height: typeof modalHeight === 'number' ? `${modalHeight}px` : modalHeight,
            }}
            exit={{ 
              opacity: 0, 
              scale: 0.95, 
              ...(isMapVisible 
                ? { x: -20, y: -20 } 
                : { x: '-50%', y: '-50%' }
              )
            }}
            transition={{ 
              duration: 0.2,
              height: { duration: 0.3, ease: 'easeOut' }
            }}
            style={{
              position: 'fixed',
              ...(isMapVisible 
                ? { 
                    // Calculate left position based on sidebar state
                    // Sidebar is 40px (w-10) on mobile, 56px (lg:w-14) on desktop when expanded
                    // Add 16px spacing after sidebar
                    left: isSidebarCollapsed 
                      ? '16px' 
                      : 'calc(max(40px, 56px) + 16px)', // Responsive: 40px mobile, 56px desktop + 16px spacing
                    top: '16px', 
                    width: '450px', 
                    zIndex: 100,
                    transform: 'none', // Override transform for map view
                    // For images, height is animated via Framer Motion, for PDFs use static height
                    ...(isImage ? {} : { height: typeof modalHeight === 'number' ? `${modalHeight}px` : modalHeight })
                  } 
                : { 
                    left: '50%', 
                    top: '50%', 
                    width: '90vw', 
                    maxWidth: '1152px',
                    maxHeight: '90vh',
                    zIndex: 50,
                    // Transform is handled by Framer Motion animate prop for centering
                    // For images, height is animated via Framer Motion, for PDFs use static height
                    ...(isImage ? {} : { height: typeof modalHeight === 'number' ? `${modalHeight}px` : modalHeight })
                  }
              )
            }}
            className="flex flex-col bg-white rounded-lg shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
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
              className={isImage ? "overflow-hidden bg-white flex items-center justify-center" : "flex-1 overflow-auto bg-white"}
              style={isImage ? { 
                height: 'auto',
                lineHeight: 0, // Remove any line-height spacing
                fontSize: 0, // Remove any font-size spacing
              } : {}}
            >
              {blobUrl && (
                <>
                  {isPDF ? (
                    <div className="flex items-center justify-center w-full h-full">
                      <iframe
                        ref={iframeRef}
                        src={`${blobUrl}#page=${currentPage}&zoom=page-fit&view=Fit`}
                        className="w-full h-full border-0 bg-white"
                        style={{
                          height: '100%',
                          width: '100%',
                        }}
                        title={file.name}
                      />
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
                        // Use requestAnimationFrame to ensure image is fully rendered
                        requestAnimationFrame(() => {
                          setImageNaturalHeight(img.naturalHeight);
                          setImageNaturalWidth(img.naturalWidth);
                          // Get actual rendered height after image loads
                          const renderedHeight = img.offsetHeight;
                          setImageRenderedHeight(renderedHeight);
                          setForceUpdate(prev => prev + 1); // Force recalculation
                        });
                      }}
                    />
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


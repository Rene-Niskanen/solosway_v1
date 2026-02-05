"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { FileText } from "lucide-react";
import { DocumentPreviewModal } from './DocumentPreviewModal';
import { FileAttachmentData } from './FileAttachment';
import { usePreview } from '../contexts/PreviewContext';

interface PropertyDocument {
  id: string;
  original_filename: string;
  file_type?: string;
  file_size?: number;
  created_at?: string;
  s3_path?: string;
  s3_url?: string;
  file_url?: string;
  url?: string;
  download_url?: string;
  document_id?: string; // Sometimes the ID field might be named differently
}

interface PropertyFilesModalProps {
  propertyId: string;
  propertyAddress?: string;
  isOpen: boolean;
  onClose: () => void;
  position?: { top: number; left: number };
  onLoadingStateChange?: (isLoading: boolean, hasFetched: boolean) => void;
  isMapVisible?: boolean;
  isSidebarCollapsed?: boolean;
}

export const PropertyFilesModal: React.FC<PropertyFilesModalProps> = ({
  propertyId,
  propertyAddress,
  isOpen,
  onClose,
  position,
  onLoadingStateChange,
  isMapVisible = false,
  isSidebarCollapsed = false
}) => {
  const [documents, setDocuments] = React.useState<PropertyDocument[]>([]);
  const [isLoading, setIsLoading] = React.useState(false); // No loading state - files are preloaded
  const [error, setError] = React.useState<string | null>(null);
  const [hasFetched, setHasFetched] = React.useState(false); // Track if we've attempted to fetch
  const [searchQuery, setSearchQuery] = React.useState<string>(''); // Search query for filtering documents
  
  // Use shared preview context instead of local state
  const {
    previewFiles,
    activePreviewTabIndex,
    isPreviewOpen,
    setPreviewFiles,
    setActivePreviewTabIndex,
    setIsPreviewOpen,
    addPreviewFile,
    MAX_PREVIEW_TABS
  } = usePreview();
  const modalRef = React.useRef<HTMLDivElement>(null);
  const lastFetchedPropertyIdRef = React.useRef<string | null>(null);

  // Clear documents when property changes (but not when just closing/opening)
  React.useEffect(() => {
    if (propertyId && lastFetchedPropertyIdRef.current && lastFetchedPropertyIdRef.current !== propertyId) {
      // Property changed - clear old documents
      setDocuments([]);
      setHasFetched(false);
      lastFetchedPropertyIdRef.current = null;
    }
  }, [propertyId]);

  // Fetch documents when modal opens - check for preloaded files first
  React.useEffect(() => {
    if (isOpen && propertyId) {
      // First, check for preloaded files (Instagram-style preloading)
      const preloadedFiles = (window as any).__preloadedPropertyFiles?.[propertyId];
      if (preloadedFiles && Array.isArray(preloadedFiles) && preloadedFiles.length > 0) {
        console.log('✅ Using preloaded files for property:', propertyId, 'Count:', preloadedFiles.length);
        setDocuments(preloadedFiles);
        setIsLoading(false);
        // Always set hasFetched to true when we have preloaded files
        setHasFetched(true);
        lastFetchedPropertyIdRef.current = propertyId;
        return; // Skip fetching - files already preloaded
      }
      
      // Check if property changed
      const propertyChanged = lastFetchedPropertyIdRef.current !== null && lastFetchedPropertyIdRef.current !== propertyId;
      
      // If we already have documents loaded for this property, don't reset state
      if (documents.length > 0 && lastFetchedPropertyIdRef.current === propertyId) {
        console.log('✅ Using existing documents for property:', propertyId, 'Count:', documents.length);
        setIsLoading(false);
        setHasFetched(true);
        return; // Skip fetching if we already have documents for this property
      }
      
      // Track which property we're fetching for
      const previousPropertyId = lastFetchedPropertyIdRef.current;
      lastFetchedPropertyIdRef.current = propertyId;
      
      // Only reset state if property changed (not when just reopening)
      if (propertyChanged) {
        console.log('🔄 Property changed, resetting state');
        setIsLoading(false);
        setHasFetched(false);
        setDocuments([]);
        setError(null);
      } else {
        // Don't reset hasFetched if we're just reopening - keep existing state
        // This allows the modal to show immediately if documents were already loaded
        console.log('🔄 Reopening modal for same property, keeping existing state');
      }
      
      // Fetch documents silently in background (only if we don't have them)
      if (documents.length === 0 || propertyChanged) {
        fetchDocuments();
      }
    } else if (!isOpen) {
      // Don't reset documents when modal closes - keep them in memory
      // This prevents showing loading state again when reopening
      setIsLoading(false);
      // Keep hasFetched true if we have documents (so we don't show empty state)
      if (documents.length > 0) {
        setHasFetched(true);
      }
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, propertyId]);

  // Close modal when clicking outside (but not on backdrop since we removed it)
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Only close if clicking outside the modal and not on any interactive element
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        // Don't close if clicking on chat or search elements
        const target = event.target as HTMLElement;
        const isChatElement = target.closest('[data-chat-interface]') || 
                              target.closest('[data-chat-container]') ||
                              target.closest('[data-chat-wrapper]');
        
        // Don't close if clicking on the View Files/Close Files button or property panel
        const isPropertyPanel = target.closest('[data-property-panel]');
        const isViewFilesButton = target.closest('button') && (
          target.textContent?.includes('View Files') || 
          target.textContent?.includes('Close Files') ||
          target.closest('button')?.textContent?.includes('View Files') ||
          target.closest('button')?.textContent?.includes('Close Files')
        );
        
        // Don't close if clicking on the DocumentPreviewModal (preview modal) or if preview is open
        const isPreviewModal = target.closest('[data-document-preview-modal]') ||
                              target.closest('.document-preview-modal') ||
                              (target.closest('[role="dialog"]') && target.closest('[class*="preview"]'));
        
        // Also check if preview modal is currently open (from shared context)
        // If preview is open, don't close the files modal when clicking outside
        if (!isChatElement && !isViewFilesButton && !isPropertyPanel && !isPreviewModal && !isPreviewOpen) {
          onClose();
        }
      }
    };

    if (isOpen) {
      // Use capture phase and a small delay to avoid conflicts with button clicks
      const timeoutId = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside, true);
      }, 150);
      
      return () => {
        clearTimeout(timeoutId);
        document.removeEventListener('mousedown', handleClickOutside, true);
      };
    }
  }, [isOpen, onClose, isPreviewOpen]);

  const fetchDocuments = async (): Promise<void> => {
    // Don't show loading state - load silently
    setError(null);
    // Don't reset hasFetched here - let it be set based on results
    try {
      // Use the backend API endpoint
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';
      const response = await fetch(`${backendUrl}/api/property-hub/${propertyId}/documents`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }
      
      const data = await response.json();
      if (data.success && data.data?.documents) {
        const fetchedDocuments = data.data.documents;
        setDocuments(fetchedDocuments);
        // Store in preloaded files for future use
        if (!(window as any).__preloadedPropertyFiles) {
          (window as any).__preloadedPropertyFiles = {};
        }
        (window as any).__preloadedPropertyFiles[propertyId] = fetchedDocuments;
        // Only set hasFetched to true if we have documents (never show empty state)
        setHasFetched(fetchedDocuments.length > 0);
        console.log('✅ Fetched documents for property:', propertyId, 'Count:', fetchedDocuments.length);
      } else {
        setDocuments([]);
        // Don't set hasFetched to true if no documents - keep modal hidden
        setHasFetched(false);
        console.log('⚠️ No documents found for property:', propertyId);
      }
    } catch (err) {
      console.error('❌ Error fetching property documents:', err);
      setError('Failed to load documents');
      setDocuments([]);
      // Don't set hasFetched to true on error - keep modal hidden
      setHasFetched(false);
    }
  };

  // Notify parent of loading state changes
  React.useEffect(() => {
    if (onLoadingStateChange) {
      onLoadingStateChange(isLoading, hasFetched);
    }
  }, [isLoading, hasFetched, onLoadingStateChange]);

  const getFileTypeLabel = (type?: string, filename?: string): string => {
    if (!type && !filename) return 'FILE';
    const fileType = type?.toLowerCase() || '';
    const fileName = filename?.toLowerCase() || '';
    
    if (fileType.includes('pdf') || fileName.endsWith('.pdf')) return 'PDF';
    if (fileType.includes('word') || fileType.includes('document') || fileName.endsWith('.doc') || fileName.endsWith('.docx')) return 'DOC';
    if (fileType.includes('excel') || fileType.includes('spreadsheet') || fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) return 'XLS';
    if (fileType.startsWith('image/') || fileName.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) return 'IMG';
    if (fileType.includes('text') || fileName.endsWith('.txt')) return 'TXT';
    return 'FILE';
  };

  const formatFileName = (name: string): string => {
    // Truncate long file names similar to FileAttachment
    if (name.length > 30) {
      const extension = name.split('.').pop();
      const nameWithoutExt = name.substring(0, name.lastIndexOf('.'));
      return `${nameWithoutExt.substring(0, 27)}...${extension ? '.' + extension : ''}`;
    }
    return name;
  };

  const handleDocumentDragStart = (e: React.DragEvent, document: PropertyDocument) => {
    // Store document info in dataTransfer for the drop handler to fetch
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';
    
    // Try multiple download URL patterns (same as handleDocumentClick)
    let downloadUrl: string | null = null;
    
    // First, try if document has a direct URL (check all possible URL fields)
    if (document.url || document.download_url || document.file_url || document.s3_url) {
      downloadUrl = document.url || document.download_url || document.file_url || document.s3_url || null;
    } 
    // Try S3 path if available - construct download URL
    else if (document.s3_path) {
      // Use the standard files download endpoint with s3_path
      downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(document.s3_path)}`;
    }
    // Fallback to document ID - use standard document download endpoint
    else {
      const docId = document.id || document.document_id;
      if (docId) {
        // Try standard document download endpoint
        downloadUrl = `${backendUrl}/api/files/download?document_id=${docId}`;
      } else {
        downloadUrl = `${backendUrl}/api/files/download?document_id=${document.id}`;
      }
    }
    
    if (!downloadUrl) {
      console.error('❌ No download URL available for drag and drop');
      e.preventDefault(); // Prevent drag if no URL
      return;
    }
    
    // Store document metadata in dataTransfer
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', document.original_filename);
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'property-document',
      documentId: document.id || document.document_id,
      filename: document.original_filename,
      fileType: document.file_type || 'application/pdf',
      downloadUrl: downloadUrl
    }));
    
    console.log('📤 Starting drag for property document:', document.original_filename, 'URL:', downloadUrl);
    
    // Set a custom data attribute on the drag element for visual feedback
    (e.target as HTMLElement).style.opacity = '0.5';
  };

  const handleDocumentClick = async (document: PropertyDocument) => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';
      
      // Try multiple download URL patterns
      let downloadUrl: string | null = null;
      
      // First, try if document has a direct URL (check all possible URL fields)
      if (document.url || document.download_url || document.file_url || document.s3_url) {
        downloadUrl = document.url || document.download_url || document.file_url || document.s3_url || null;
      } 
      // Try S3 path if available - construct download URL
      else if (document.s3_path) {
        // Use the standard files download endpoint with s3_path
        downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(document.s3_path)}`;
      }
      // Fallback to document ID - use standard document download endpoint
      else {
        const docId = document.id || document.document_id;
        if (docId) {
          // Try standard document download endpoint
          downloadUrl = `${backendUrl}/api/files/download?document_id=${docId}`;
        } else {
          downloadUrl = `${backendUrl}/api/files/download?document_id=${document.id}`;
        }
      }
      
      if (!downloadUrl) {
        throw new Error('No download URL available');
      }
      
      console.log('📄 Opening document:', document.original_filename, 'from URL:', downloadUrl);
      
      // Fetch the file
      const response = await fetch(downloadUrl, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        console.error('❌ Download failed:', response.status, response.statusText);
        // If download endpoint doesn't exist, try alternative endpoints
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }
      
      const blob = await response.blob();
      const file = new File([blob], document.original_filename, { type: document.file_type || blob.type || 'application/pdf' });
      
      console.log('✅ Document loaded:', file.name, file.size, 'bytes');
      
      // Convert to FileAttachmentData format for DocumentPreviewModal
      const fileData: FileAttachmentData = {
        id: document.id || document.document_id || `doc-${Date.now()}`,
        file: file,
        name: document.original_filename,
        type: document.file_type || blob.type || 'application/pdf',
        size: document.file_size || blob.size
      };
      
      // Use shared preview context to add file (will add to existing preview if open)
      addPreviewFile(fileData);
    } catch (err) {
      console.error('❌ Error opening document:', err);
      // Fallback: try to open in new tab using document URL or S3 path
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';
      let fallbackUrl: string;
      
      if (document.url || document.download_url || document.file_url || document.s3_url) {
        fallbackUrl = document.url || document.download_url || document.file_url || document.s3_url || '';
      } else if (document.s3_path) {
        fallbackUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(document.s3_path)}`;
      } else {
        const docId = document.id || document.document_id;
        if (docId) {
          fallbackUrl = `${backendUrl}/api/files/download?document_id=${docId}`;
        } else {
          fallbackUrl = `${backendUrl}/api/files/download?document_id=${document.id}`;
        }
      }
      
      if (fallbackUrl) {
        console.log('🔄 Opening fallback URL:', fallbackUrl);
        window.open(fallbackUrl, '_blank');
      } else {
        console.error('❌ No fallback URL available');
      }
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const modalContent = (
    <AnimatePresence>
      {isOpen && hasFetched && documents.length > 0 && (
        <>
          {/* No backdrop - transparent overlay */}
          
          {/* Modal */}
          <motion.div
            key={`property-files-modal-${propertyId}`}
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className={`fixed bg-white rounded-lg shadow-2xl border border-gray-200 ${position ? 'property-files-modal-positioned' : ''}`}
            style={{
              ...(position ? {
                top: `${position.top}px`,
                left: `${position.left}px`,
                // Transform handled by CSS class to override Framer Motion
              } : {
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
              }),
              width: '420px',
              maxHeight: '600px',
              zIndex: 9999, // Very high z-index to appear above everything
              backgroundColor: '#ffffff', // Explicit white to match property card
              filter: 'none', // Remove any filters that might affect brightness
              opacity: 1, // Ensure full opacity
            }}
            onClick={(e) => e.stopPropagation()} // Prevent clicks from closing modal
          >
            {/* Content */}
            <div className="overflow-y-auto rounded-b-lg" style={{ maxHeight: '500px' }}>
              {hasFetched && documents.length > 0 ? (
                <>
                  {/* Header - Only show when documents are loaded */}
                  <div className="px-4 pt-3 pb-2 border-b border-gray-200 bg-white rounded-t-lg">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-gray-900">Property Files</h3>
                      <div className="flex items-center gap-2">
                        {/* Sort icon */}
                        <button className="p-1.5 hover:bg-gray-100 rounded transition-colors">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                          </svg>
                        </button>
                        {/* Filter icon */}
                        <button className="p-1.5 hover:bg-gray-100 rounded transition-colors">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    {/* Search bar */}
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Search documents..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full h-7 px-2.5 pr-8 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-300 focus:border-gray-300 bg-white placeholder:text-gray-400"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 rounded transition-colors"
                        >
                          <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                      {!searchQuery && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                          <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Documents Content */}
                  <div className="px-4 py-3">
                    {error ? (
                      <div className="flex items-center justify-center" style={{ minHeight: '200px' }}>
                        <div className="text-sm text-red-500">{error}</div>
                      </div>
                    ) : (() => {
                      // Filter documents based on search query in real-time
                      const filteredDocuments = documents.filter(doc => {
                        if (!searchQuery.trim()) return true;
                        const query = searchQuery.toLowerCase();
                        return doc.original_filename.toLowerCase().includes(query);
                      });
                      
                      if (filteredDocuments.length === 0) {
                        return (
                          <div className="flex items-center justify-center" style={{ minHeight: '200px' }}>
                            <div className="text-sm text-gray-500">No documents match your search</div>
                          </div>
                        );
                      }
                      
                      return (
                        <div className="flex flex-col gap-2">
                          {filteredDocuments.map((doc) => {
                    const isPDF = doc.file_type?.includes('pdf') || doc.original_filename.toLowerCase().endsWith('.pdf');
                    const isDOC = doc.file_type?.includes('word') || doc.file_type?.includes('document') || 
                                  doc.original_filename.toLowerCase().endsWith('.doc') || 
                                  doc.original_filename.toLowerCase().endsWith('.docx');
                    const isImage = doc.file_type?.startsWith('image/') || 
                                    doc.original_filename.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
                    
                    return (
                      <div
                        key={doc.id}
                        draggable
                        onDragStart={(e) => handleDocumentDragStart(e, doc)}
                        onDragEnd={(e) => {
                          // Reset opacity after drag ends
                          (e.target as HTMLElement).style.opacity = '1';
                        }}
                        onClick={() => handleDocumentClick(doc)}
                        className="relative bg-white rounded-lg border border-gray-200 px-2.5 py-2 shadow-sm cursor-pointer hover:border-gray-300 hover:shadow-md transition-all duration-100 w-full"
                        title={`Click to open or drag to chat: ${doc.original_filename}`}
                      >
                        <div className="flex items-center gap-2">
                          {/* File Icon - Red square with white document outline (matching FileAttachment) */}
                          <div className={`w-6 h-6 ${isPDF ? 'bg-red-500' : isDOC ? 'bg-blue-600' : isImage ? 'bg-red-500' : 'bg-gray-600'} rounded flex items-center justify-center flex-shrink-0`}>
                            <FileText className="w-4 h-4 text-white" strokeWidth={2} />
                          </div>
                          
                          {/* File Info */}
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-xs font-medium text-black truncate">
                              {formatFileName(doc.original_filename)}
                            </span>
                            <span className="text-[10px] text-gray-500 font-normal">
                              {getFileTypeLabel(doc.file_type, doc.original_filename)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                        </div>
                      );
                    })()}
                  </div>
                </>
              ) : (
                // Don't show anything until files are loaded - never show "No documents found"
                <div className="flex items-center justify-center" style={{ minHeight: '200px' }}>
                  {/* Empty state - files are loading silently in background or no documents available */}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  // Use portal to render outside of parent container to avoid z-index and positioning issues
  const portalContent = typeof window !== 'undefined' 
    ? createPortal(modalContent, document.body)
    : modalContent;

  return (
    <>
      {portalContent}
      {/* Document Preview Modal is now rendered at MainContent level using shared context */}
    </>
  );
};


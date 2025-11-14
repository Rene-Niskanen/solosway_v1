"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { FileText } from "lucide-react";
import { DocumentPreviewModal } from './DocumentPreviewModal';
import { FileAttachmentData } from './FileAttachment';

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
  const [isLoading, setIsLoading] = React.useState(true); // Start as true to prevent premature "No documents found"
  const [error, setError] = React.useState<string | null>(null);
  const [hasFetched, setHasFetched] = React.useState(false); // Track if we've attempted to fetch
  const [loadingProgress, setLoadingProgress] = React.useState(0); // Progress bar state
  const [previewFile, setPreviewFile] = React.useState<FileAttachmentData | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(false);
  const modalRef = React.useRef<HTMLDivElement>(null);
  const progressIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
  const currentProgressRef = React.useRef<number>(0);

  // Fetch documents when modal opens
  React.useEffect(() => {
    if (isOpen && propertyId) {
      // Reset state when modal opens to prevent showing "No documents found" prematurely
      setIsLoading(true);
      setHasFetched(false);
      setDocuments([]);
      setError(null);
      setLoadingProgress(0);
      currentProgressRef.current = 0;
      
      const fetchStartTime = Date.now();
      
      // Start slow progress animation that will be completed when fetch finishes
      progressIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - fetchStartTime;
        // Gradually increase progress slowly (reaches ~70% over 2 seconds if fetch is slow)
        // This provides visual feedback, but won't reach 100% until fetch completes
        const progress = Math.min(70, (elapsed / 2000) * 70);
        currentProgressRef.current = progress;
        setLoadingProgress(progress);
      }, 16); // ~60fps
      
      const fetchPromise = fetchDocuments();
      fetchPromise.then(() => {
        // Fetch completed - clear interval and animate to 100%
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }
        
        const fetchDuration = Date.now() - fetchStartTime;
        // Animate to 100% - duration based on how quick the fetch was
        // Quick fetches animate quickly, slower fetches animate more smoothly
        const animationDuration = Math.max(150, Math.min(400, fetchDuration / 4));
        
        // Animate to 100% smoothly from current progress
        const startProgress = currentProgressRef.current;
        const startTime = Date.now();
        const animateTo100 = () => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(100, startProgress + ((100 - startProgress) * (elapsed / animationDuration)));
          currentProgressRef.current = progress;
          setLoadingProgress(progress);
          
          if (progress < 100) {
            requestAnimationFrame(animateTo100);
          } else {
            currentProgressRef.current = 100;
            setLoadingProgress(100);
          }
        };
        requestAnimationFrame(animateTo100);
      }).catch(() => {
        // Fetch failed - still complete the progress bar
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }
        
        const fetchDuration = Date.now() - fetchStartTime;
        const animationDuration = Math.max(150, Math.min(400, fetchDuration / 4));
        
        const startProgress = currentProgressRef.current;
        const startTime = Date.now();
        const animateTo100 = () => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(100, startProgress + ((100 - startProgress) * (elapsed / animationDuration)));
          currentProgressRef.current = progress;
          setLoadingProgress(progress);
          
          if (progress < 100) {
            requestAnimationFrame(animateTo100);
          } else {
            currentProgressRef.current = 100;
            setLoadingProgress(100);
          }
        };
        requestAnimationFrame(animateTo100);
      });
    } else if (!isOpen) {
      // Reset when modal closes
      setDocuments([]);
      setIsLoading(true); // Reset to true so next open doesn't show "No documents found"
      setHasFetched(false);
      setError(null);
      setLoadingProgress(0);
      currentProgressRef.current = 0;
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    }
    
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
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
        
        if (!isChatElement) {
          onClose();
        }
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onClose]);

  const fetchDocuments = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    setHasFetched(false);
    try {
      // Use the backend API endpoint
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
      const response = await fetch(`${backendUrl}/api/property-hub/${propertyId}/documents`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }
      
      const data = await response.json();
      if (data.success && data.data?.documents) {
        setDocuments(data.data.documents);
      } else {
        setDocuments([]);
      }
      setHasFetched(true);
    } catch (err) {
      console.error('Error fetching property documents:', err);
      setError('Failed to load documents');
      setDocuments([]);
      setHasFetched(true);
    } finally {
      setIsLoading(false);
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
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
    
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
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
      
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
      
      setPreviewFile(fileData);
      setIsPreviewOpen(true);
    } catch (err) {
      console.error('❌ Error opening document:', err);
      // Fallback: try to open in new tab using document URL or S3 path
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
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
      {isOpen && (
        <>
          {/* No backdrop - transparent overlay */}
          
          {/* Modal */}
          <motion.div
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
            }}
            onClick={(e) => e.stopPropagation()} // Prevent clicks from closing modal
          >
            {/* Content */}
            <div className="overflow-y-auto rounded-b-lg" style={{ maxHeight: '500px' }}>
              {isLoading || !hasFetched ? (
                // Show thin loading progress bar while fetching - no header, minimal padding, no white container
                <div className="w-full py-1 px-4">
                  <motion.div
                    className="h-1 bg-gray-700"
                    initial={{ width: '0%' }}
                    animate={{ width: `${loadingProgress}%` }}
                    transition={{ duration: 0.15, ease: 'linear' }}
                    style={{ 
                      borderRadius: 0,
                      willChange: 'width'
                    }}
                  />
                </div>
              ) : (
                <>
                  {/* Header - Only show when documents are loaded */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white rounded-t-lg">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">Document</h3>
                    </div>
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
                  
                  {/* Documents Content */}
                  <div className="px-4 py-3">
                    {error ? (
                      <div className="flex items-center justify-center" style={{ minHeight: '200px' }}>
                        <div className="text-sm text-red-500">{error}</div>
                      </div>
                    ) : documents.length === 0 ? (
                      <div className="flex items-center justify-center" style={{ minHeight: '200px' }}>
                        <div className="text-sm text-gray-500">No documents found</div>
                      </div>
                    ) : (
                <div className="flex flex-col gap-2">
                  {documents.map((doc) => {
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
                  )}
                  </div>
                </>
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
      
      {/* Document Preview Modal */}
      <DocumentPreviewModal
        file={previewFile}
        isOpen={isPreviewOpen}
        onClose={() => {
          setIsPreviewOpen(false);
          setPreviewFile(null);
        }}
        isMapVisible={isMapVisible}
        isSidebarCollapsed={isSidebarCollapsed}
      />
    </>
  );
};


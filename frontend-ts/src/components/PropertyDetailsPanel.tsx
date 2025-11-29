"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { File, X, Upload, FileText, Image as ImageIcon, ArrowUp, CheckSquare, Square, Trash2, Search, SquareMousePointer, Maximize2, Minimize2, Building2, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useBackendApi } from './BackendApi';
import { backendApi } from '../services/backendApi';
import { usePreview } from '../contexts/PreviewContext';
import { FileAttachmentData } from './FileAttachment';
import { usePropertySelection } from '../contexts/PropertySelectionContext';
import { useDocumentSelection } from '../contexts/DocumentSelectionContext';
import { PropertyData } from './PropertyResultsDisplay';

interface PropertyDetailsPanelProps {
  property: any;
  isVisible: boolean;
  onClose: () => void;
  onPropertySelect?: (property: PropertyData) => void;
  isLargeCardMode?: boolean;
  pinPosition?: { x: number; y: number } | null;
  isInChatMode?: boolean; // Add chat mode prop
  chatPanelWidth?: number; // Width of the chat panel (0 when closed)
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

// Expanded Card View Component - moved outside to prevent recreation on every render
// This prevents refs from being reset when parent component re-renders
const ExpandedCardView: React.FC<{
  selectedDoc: Document | undefined;
  onClose: () => void;
  onDocumentClick: (doc: Document) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}> = React.memo(({ selectedDoc, onClose, onDocumentClick, isFullscreen, onToggleFullscreen }) => {
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
                <iframe
                  key={selectedDoc.id} // Stable key prevents iframe reload
                  src={previewUrl!}
                  className="w-full h-full border-0"
                  title={selectedDoc.original_filename}
                  style={{
                    // Prevent iframe from reloading during layout changes
                    pointerEvents: 'auto',
                    isolation: 'isolate', // Isolate iframe rendering
                    transform: 'translateZ(0)' // Force GPU layer
                  }}
                />
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
  chatPanelWidth = 0 // Default to 0 (chat panel closed)
}) => {
  // Determine if chat panel is actually open based on width
  const isChatPanelOpen = chatPanelWidth > 0 || isInChatMode;
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
    // This is where the user placed/confirmed the pin. Only use coordinates if geocoding_status === 'manual'
    const geocodingStatus = propertyToSave.geocoding_status;
    const isPinLocation = geocodingStatus === 'manual';
    const pinLatitude = isPinLocation ? (propertyToSave.latitude || originalPinCoordsRef.current?.lat) : originalPinCoordsRef.current?.lat;
    const pinLongitude = isPinLocation ? (propertyToSave.longitude || originalPinCoordsRef.current?.lng) : originalPinCoordsRef.current?.lng;
    
    const lastProperty = {
      id: propertyToSave.id,
      address: propertyToSave.address,
      latitude: pinLatitude, // Property pin location (user-set), not document-extracted coordinates
      longitude: pinLongitude, // Property pin location (user-set), not document-extracted coordinates
      primary_image_url: propertyToSave.primary_image_url || propertyToSave.image,
      documentCount: docCount,
      timestamp: new Date().toISOString()
    };
    
    localStorage.setItem('lastInteractedProperty', JSON.stringify(lastProperty));
    // Dispatch custom event to update RecentProjectsSection in the same tab
    window.dispatchEvent(new CustomEvent('lastPropertyUpdated'));
    console.log('💾 Saved property to recent projects after interaction:', lastProperty.address, `(${docCount} docs)`);
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
  const { addPreviewFile } = usePreview();
  
  // Sync ref with state
  React.useEffect(() => {
    isFilesModalOpenRef.current = isFilesModalOpen;
  }, [isFilesModalOpen]);
  const [hasFilesFetched, setHasFilesFetched] = useState(false);
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

  // CRITICAL: Do NOT load documents when property card opens
  // Documents should ONLY be loaded when user clicks "View Files" button
  // BUT for this simplified view, we probably want to load them immediately since it's ONLY documents
  useEffect(() => {
    if (property && property.id) {
      console.log('📄 PropertyDetailsPanel: Property changed, loading files for Documents view:', property.id);
      loadPropertyDocuments();
    } else {
      console.log('⚠️ PropertyDetailsPanel: No property or property.id');
      setDocuments([]);
    }
  }, [property]);

  const loadPropertyDocuments = async () => {
    if (!property?.id) {
      console.log('⚠️ loadPropertyDocuments: No property or property.id');
      return;
    }
    
    // Don't show loading state - load silently in background
    setError(null);
    
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
        } else {
          setDocuments([]);
          setHasFilesFetched(false);
        }
      }
    } catch (err) {
      console.error('❌ Error loading documents:', err);
      setError('Failed to load documents');
      // Fallback to propertyHub documents on error
      if (property.propertyHub?.documents && property.propertyHub.documents.length > 0) {
        setDocuments(property.propertyHub.documents);
      } else {
        setDocuments([]);
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

  const handleDocumentClick = useCallback(async (document: Document) => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
      
      // Try multiple download URL patterns
      let downloadUrl: string | null = null;
      
      // First, try if document has a direct URL
      if ((document as any).url || (document as any).download_url || (document as any).file_url || (document as any).s3_url) {
        downloadUrl = (document as any).url || (document as any).download_url || (document as any).file_url || (document as any).s3_url || null;
      } 
      // Try S3 path if available
      else if ((document as any).s3_path) {
        downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent((document as any).s3_path)}`;
      }
      // Fallback to document ID
      else {
        const docId = document.id;
        if (docId) {
          downloadUrl = `${backendUrl}/api/files/download?document_id=${docId}`;
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
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }
      
      const blob = await response.blob();
      // Create a File object from the blob
      // @ts-ignore - File constructor is available in modern browsers
      const file = new File([blob], document.original_filename, { 
        type: (document as any).file_type || blob.type || 'application/pdf'
      });
      
      // Convert to FileAttachmentData format for DocumentPreviewModal
      const fileData: FileAttachmentData = {
        id: document.id,
        file: file,
        name: document.original_filename,
        type: (document as any).file_type || blob.type || 'application/pdf',
        size: (document as any).file_size || blob.size
      };
      
      // Use shared preview context to add file
      addPreviewFile(fileData);
    } catch (err) {
      console.error('❌ Error opening document:', err);
    }
  }, [addPreviewFile]);

  const handleDeleteDocument = async (documentId: string) => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
      const response = await fetch(`${backendUrl}/api/document/${documentId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
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
    } catch (err: any) {
      console.error('Error deleting document:', err);
      alert(`Failed to delete document: ${err.message}`);
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
    
    // Limit concurrent preloads to avoid overwhelming the network (load first 6 immediately, rest in batches)
    const MAX_CONCURRENT = 6;
    const priorityDocs = docs.slice(0, MAX_CONCURRENT);
    const remainingDocs = docs.slice(MAX_CONCURRENT);
    
    // Preload priority documents first (visible ones)
    const priorityPromises = priorityDocs.map(async (doc, index) => {
      const docId = doc.id;
      
      // Skip if already cached
      if ((window as any).__preloadedDocumentCovers[docId]) {
        return;
      }
      
      try {
        const fileType = (doc as any).file_type || '';
        const fileName = doc.original_filename.toLowerCase();
        const isImage = fileType.includes('image') || fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i);
        const isPDF = fileType.includes('pdf') || fileName.endsWith('.pdf');
        
        // Only preload images and PDFs (they have visual covers)
        if (!isImage && !isPDF) {
          return;
        }
        
        let downloadUrl: string | null = null;
        if ((doc as any).url || (doc as any).download_url || (doc as any).file_url || (doc as any).s3_url) {
          downloadUrl = (doc as any).url || (doc as any).download_url || (doc as any).file_url || (doc as any).s3_url || null;
        } else if ((doc as any).s3_path) {
          downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent((doc as any).s3_path)}`;
        } else {
          downloadUrl = `${backendUrl}/api/files/download?document_id=${doc.id}`;
        }
        
        if (!downloadUrl) return;
        
        // Fetch with high priority for first few images
        const response = await fetch(downloadUrl, {
          credentials: 'include',
          // @ts-ignore - fetchPriority is not in all TypeScript definitions yet
          priority: index < 3 ? 'high' : 'auto'
        });
        
        if (!response.ok) return;
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        // Cache the cover
        (window as any).__preloadedDocumentCovers[docId] = {
          url: url,
          type: blob.type,
          timestamp: Date.now()
        };
      } catch (error) {
        // Silently fail - don't block other preloads
      }
    });
    
    // Execute priority preloads immediately
    Promise.all(priorityPromises).catch(() => {});
    
    // Preload remaining documents in batches to avoid overwhelming network
    if (remainingDocs.length > 0) {
      const BATCH_SIZE = 3;
      for (let i = 0; i < remainingDocs.length; i += BATCH_SIZE) {
        const batch = remainingDocs.slice(i, i + BATCH_SIZE);
        // Wait a bit between batches to avoid network congestion
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const batchPromises = batch.map(async (doc) => {
          const docId = doc.id;
          if ((window as any).__preloadedDocumentCovers[docId]) return;
          
          try {
            const fileType = (doc as any).file_type || '';
            const fileName = doc.original_filename.toLowerCase();
            const isImage = fileType.includes('image') || fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i);
            const isPDF = fileType.includes('pdf') || fileName.endsWith('.pdf');
            
            if (!isImage && !isPDF) return;
            
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
              credentials: 'include'
            });
            
            if (!response.ok) return;
            
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            
            (window as any).__preloadedDocumentCovers[docId] = {
              url: url,
              type: blob.type,
              timestamp: Date.now()
            };
          } catch (error) {
            // Silently fail
          }
        });
        
        Promise.all(batchPromises).catch(() => {});
      }
    }
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

  // File upload handler
  const handleFileUpload = async (file: File) => {
    // CRITICAL: Capture property at the start to ensure we use the correct property_id
    const currentProperty = property;
    if (!currentProperty?.id) {
      setUploadError('No property selected');
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
          await loadPropertyDocuments(); // Reload documents
            
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
          setUploadError('Upload successful but failed to reload file list');
            setUploading(false);
        }
      } else {
        setUploadError(response.error || 'Upload failed');
          setUploading(false);
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
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

  return createPortal(
    <AnimatePresence>
      {isVisible && (
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center font-sans pointer-events-none transition-all duration-300 ease-out" 
          style={{ 
            pointerEvents: 'none',
          }}
        >
          {/* Backdrop Removed - Allow clicking behind */}

          {/* Main Window - Compact Grid Layout (Artboard Style) */}
          <motion.div
            layout={selectedCardIndex === null} // Only enable layout animations when preview is NOT open
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ 
              opacity: 1, 
              scale: 1, 
              y: 0
            }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ 
              duration: selectedCardIndex === null ? 0.4 : 0.2, // Faster transition when preview is open
              ease: [0.25, 0.8, 0.25, 1],
              layout: { duration: 0.3 } // Smooth layout transitions
            }}
            className="bg-white shadow-2xl flex overflow-hidden ring-1 ring-black/5 pointer-events-auto"
            style={{ 
              // Switch to fixed positioning in chat mode to reliably fill screen
              position: isChatPanelOpen ? 'fixed' : 'relative',
              
              // Chat Mode: Anchored to screen edges (sidebar + margins)
              left: isChatPanelOpen ? `${Math.max(chatPanelWidth, 320) + 22}px` : 'auto', // 320px width + 20px margin + 8px gap
              right: isChatPanelOpen ? '12px' : 'auto', // Consistent 12px gap
              top: isChatPanelOpen ? '12px' : 'auto', // Consistent 12px gap
              bottom: isChatPanelOpen ? '12px' : 'auto', // Consistent 12px gap
              width: isChatPanelOpen ? 'auto' : '800px',
              height: isChatPanelOpen ? 'auto' : '600px',
              transition: 'none', // No transition for width changes - instant like chat
              
              // Normal Mode: Centered with margins
              marginBottom: isChatPanelOpen ? '0' : '15vh',
              
              // Reset constraints
              maxWidth: isChatPanelOpen ? 'none' : '90vw', 
              maxHeight: isChatPanelOpen ? 'none' : '85vh',
              
              display: 'flex',
              flexDirection: 'column',
              zIndex: 9999,
              // Optimize rendering during layout changes
              willChange: selectedCardIndex !== null ? 'auto' : 'transform'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Section Picker - File Tab Style (Fixed) - Draggable */}
            <div className="px-6 pt-4 pb-2 bg-white border-b border-gray-100 relative" style={{ zIndex: 1 }}>
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
            <div className="px-6 py-4 pb-6 bg-white">
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
                  
            {/* Content Area - Switch between sections */}
            {activeSection === 'documents' ? (
              <div className="flex-1 overflow-y-auto p-6 bg-white">
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

                    {filteredDocuments.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-500">
                  <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4 border border-gray-100">
                    <Search size={32} className="text-gray-300" />
                  </div>
                  <p className="text-lg font-medium text-gray-900 mb-1">No documents found</p>
                  <p className="text-sm text-gray-500">Try adjusting your search or upload a new file.</p>
                      </div>
                    ) : selectedCardIndex !== null ? (
                      <ExpandedCardView
                        selectedDoc={selectedDocument}
                        onClose={handleClosePreview}
                        onDocumentClick={handleDocumentClick}
                        isFullscreen={isFullscreen}
                        onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
                      />
                    ) : (
                      <div 
                  className="grid gap-6 pb-20" 
                        style={{ 
                    gridTemplateColumns: 'repeat(auto-fill, 160px)',
                    justifyContent: 'flex-start'
                  }}
                >
                        {/* Add New Document Card */}
                        <div
                          className="group relative bg-white border border-gray-200 hover:border-gray-300 hover:shadow-lg cursor-pointer flex flex-col overflow-hidden"
                          style={{
                            width: '160px',
                            height: '213px', // 3:4 aspect ratio (160 * 4/3)
                            aspectRatio: '3/4',
                          }}
                          onClick={() => fileInputRef.current?.click()}
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
                        </div>

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
                            <div
                              key={doc.id}
                        className={`group relative bg-white border cursor-pointer flex flex-col overflow-hidden ${
                          isSelected 
                            ? `border-2 ${borderColor} ${shadowColor}` 
                            : 'border-gray-200 hover:border-gray-300 hover:shadow-lg'
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
                                    toggleDocumentSelection(doc.id);
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
                            // Check for cached cover first
                            const cachedCover = (window as any).__preloadedDocumentCovers?.[doc.id];
                            const coverUrl = cachedCover?.url || getDownloadUrl(doc);
                            
                            if (isImage) {
                              return (
                                <img 
                                  src={coverUrl} 
                                  className="w-full h-full object-cover opacity-90 group-hover:opacity-100"
                                  alt={doc.original_filename}
                                  loading={cachedCover ? "eager" : "lazy"}
                                  decoding="async"
                                  fetchPriority={index < 6 ? "high" : "auto"}
                                style={{
                                    contentVisibility: 'auto',
                                    containIntrinsicSize: '160px 213px',
                                    pointerEvents: isSelectionMode ? 'none' : 'auto'
                                  }}
                                />
                              );
                            } else if (isPDF) {
                              return (
                                <div className="w-full h-full relative bg-white">
                                  <iframe
                                    src={`${coverUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                                    className="w-full h-[150%] -mt-[2%] border-none opacity-90 pointer-events-none scale-100 origin-top"
                                    title="preview"
                                    loading={cachedCover ? "eager" : "lazy"}
                                    scrolling="no"
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
                                </div>
                          );
                        })}
                      </div>
                    )}
                    </div>
              ) : (
                /* Property Details Section */
                <div className="flex-1 overflow-hidden bg-white">
                  {(() => {
                    const propertyDetails = property?.propertyHub?.property_details || {};
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
                          <div className="w-1/2 border-r border-gray-100 flex flex-col">
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
                                className="flex-1 grid grid-cols-2 gap-0 bg-gray-50 overflow-y-auto scrollbar-hide" 
                                style={{ 
                                  gridAutoRows: 'min-content',
                                  scrollbarWidth: 'none',
                                  msOverflowStyle: 'none'
                                }}
                              >
                                {propertyImages.map((img: any, idx: number) => (
                                  <div
                                    key={idx}
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
                          className={`flex-1 overflow-y-auto scrollbar-hide ${propertyImages.length > 0 ? '' : 'w-full'}`}
                          style={{
                            scrollbarWidth: 'none',
                            msOverflowStyle: 'none'
                          }}
                        >
                          <div className="px-6 py-4">
                            {/* Address Header */}
                            <div className="mb-6">
                              <h2 className="text-sm font-semibold text-gray-900 mb-0.5 leading-tight truncate" title={address}>{address}</h2>
                              {propertyDetails.property_type && (
                                <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">{propertyDetails.property_type}</p>
                              )}
                            </div>
                            
                            {/* Key Details Grid - Bedrooms, Bathrooms, Size */}
                            {(propertyDetails.number_bedrooms || propertyDetails.number_bathrooms || propertyDetails.size_sqft) && (() => {
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
                                  {propertyDetails.number_bedrooms && (
                                    <div className="text-center">
                                      <div className="text-sm font-semibold text-gray-900 mb-0.5">{propertyDetails.number_bedrooms}</div>
                                      <div className="text-[9px] text-gray-500 font-medium uppercase tracking-wide">Bedrooms</div>
                              </div>
                                  )}
                                  {propertyDetails.number_bathrooms && (
                                    <div className="text-center">
                                      <div className="text-sm font-semibold text-gray-900 mb-0.5">{propertyDetails.number_bathrooms}</div>
                                      <div className="text-[9px] text-gray-500 font-medium uppercase tracking-wide">Bathrooms</div>
                                    </div>
                                  )}
                                  {propertyDetails.size_sqft && (
                                    <div className="text-center">
                                      <div className="text-sm font-semibold text-gray-900 mb-0.5">
                                        {isInAcres 
                                          ? (propertyDetails.size_sqft % 1 === 0 ? propertyDetails.size_sqft.toString() : propertyDetails.size_sqft.toFixed(2))
                                          : propertyDetails.size_sqft.toLocaleString()}
                                      </div>
                                      <div className="text-[9px] text-gray-500 font-medium uppercase tracking-wide">
                                        {isInAcres ? 'acres' : 'sq ft'}
                                      </div>
                                    </div>
                                  )}
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
                            {(propertyDetails.asking_price || propertyDetails.sold_price || propertyDetails.rent_pcm || 
                              propertyDetails.tenure || propertyDetails.epc_rating || propertyDetails.condition) && (
                              <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-4 pb-4 border-b border-gray-100">
                                {/* Pricing Column */}
                                <div className="space-y-2.5">
                                  {propertyDetails.asking_price && (
                                    <div>
                                      <div className="text-[9px] text-gray-500 mb-0.5 font-medium uppercase tracking-wide">Asking Price</div>
                                      <div className="text-xs font-semibold text-gray-900">
                                        £{propertyDetails.asking_price.toLocaleString()}
                                      </div>
                                    </div>
                                  )}
                                  {propertyDetails.sold_price && (
                                    <div>
                                      <div className="text-[9px] text-gray-500 mb-0.5 font-medium uppercase tracking-wide">Sold Price</div>
                                      <div className="text-xs font-semibold text-gray-900">
                                        £{propertyDetails.sold_price.toLocaleString()}
                                      </div>
                                    </div>
                                  )}
                                  {propertyDetails.rent_pcm && (
                                    <div>
                                      <div className="text-[9px] text-gray-500 mb-0.5 font-medium uppercase tracking-wide">Rent (pcm)</div>
                                      <div className="text-xs font-semibold text-gray-900">
                                        £{propertyDetails.rent_pcm.toLocaleString()}
                                      </div>
                      </div>
                    )}
                    </div>
                                
                                {/* Details Column */}
                                <div className="space-y-2.5">
                                  {propertyDetails.tenure && (
                                    <div>
                                      <div className="text-[9px] text-gray-500 mb-0.5 font-medium uppercase tracking-wide">Tenure</div>
                                      <div className="text-xs text-gray-900 font-medium">{propertyDetails.tenure}</div>
                                    </div>
                                  )}
                                  {propertyDetails.epc_rating && (
                                    <div>
                                      <div className="text-[9px] text-gray-500 mb-0.5 font-medium uppercase tracking-wide">EPC Rating</div>
                                      <div className="text-xs text-gray-900 font-medium">{propertyDetails.epc_rating}</div>
                                    </div>
                                  )}
                                  {propertyDetails.condition && (
                                    <div>
                                      <div className="text-[9px] text-gray-500 mb-0.5 font-medium uppercase tracking-wide">Condition</div>
                                      <div className="text-xs text-gray-900 font-medium">{propertyDetails.condition}</div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                            
                            {/* Amenities */}
                            {propertyDetails.other_amenities && (
                              <div className="mb-4 pb-4 border-b border-gray-100">
                                <div className="text-[9px] text-gray-500 mb-1.5 font-medium uppercase tracking-wide">Amenities</div>
                                <div className="text-xs text-gray-900 leading-relaxed">{propertyDetails.other_amenities}</div>
                              </div>
                            )}
                            
                            {/* Notes/Bio */}
                            {propertyDetails.notes && (
                              <div>
                                <div className="text-[9px] text-gray-500 mb-1.5 font-medium uppercase tracking-wide">Notes</div>
                                <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto">
                                  {propertyDetails.notes}
                                </div>
                              </div>
                            )}
                            
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
              )}
            
            {/* Hidden Input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
            
            {uploadError && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 bg-red-500 text-white rounded-full shadow-xl flex items-center gap-3 z-50 animate-in fade-in slide-in-from-bottom-4">
                <X size={18} />
                <span className="font-medium text-sm">{uploadError}</span>
              </div>
            )}
            
             {/* Selection Floating Bar - Updated Style */}
                {/* Only show when in local selection mode (for deletion), not chat selection mode */}
                {isLocalSelectionMode && localSelectedDocumentIds.size > 0 && (
                        <div
                    className="absolute bottom-6 left-0 right-0 mx-auto w-fit bg-gray-900 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-4 z-50"
                  >
                    <span className="font-medium text-sm">{localSelectedDocumentIds.size} selected</span>
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
                                        const response = await fetch(`${backendUrl}/api/document/${docId}`, {
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
        </motion.div>
                        </div>
          )}
        </AnimatePresence>,
        document.body
  );
};

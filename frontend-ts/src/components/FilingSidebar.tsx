"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Plus, Folder, FolderOpen, Files, FileText, File as FileIcon, ChevronRight, MoreVertical, CheckSquare, Square, Upload, MousePointer2, Trash2, ChevronDown, MapPin, RefreshCw, Link, Info } from 'lucide-react';
import OrbitProgress from 'react-loading-indicators/OrbitProgress';
import { useFilingSidebar } from '../contexts/FilingSidebarContext';
import { useUsage } from '../contexts/UsageContext';
import { backendApi } from '../services/backendApi';
import { preloadDocumentBlobs } from '../services/documentBlobCache';
import { usePreview } from '../contexts/PreviewContext';
import { useBackendApi } from './BackendApi';
import { uploadEvents } from './UploadProgressBar';
import { usePropertyAccess } from '../hooks/usePropertyAccess';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import {
  PipelineStagesHoverPreview,
  mapPipelineProgressToStages,
  type PipelineProgressData,
} from './PipelineStagesHoverPreview';
import { toast } from '@/hooks/use-toast';

interface Document {
  id: string;
  original_filename: string;
  file_type?: string;
  file_size?: number;
  created_at?: string;
  updated_at?: string;
  property_id?: string;
  property_address?: string;
  folder_id?: string;
  s3_path?: string;
  status?: string; // 'uploaded', 'processing', 'completed', 'failed'
  /** From list API; when present, FileViewModal shows key facts without an extra request */
  key_facts?: Array<{ label: string; value: string }>;
  summary?: string | null;
}

interface Folder {
  id: string;
  name: string;
  document_count?: number;
  parent_id?: string;
  property_id?: string;
}

interface FilingSidebarProps {
  sidebarWidth?: number;
  isSmallSidebarMode?: boolean;
  /** When true, hide the header close button (e.g. when in chat – close is in View dropdown). */
  hideCloseButton?: boolean;
  /** When provided, file row click opens the File View pop-up with this doc instead of the shared DocumentPreviewModal. */
  onOpenFileView?: (doc: Document) => void;
  /** ID of the document currently open in the File View pop-up; that row gets a faint selection style. */
  openFileViewDocumentId?: string | null;
  /** When true, dashboard is visible; document list preload runs on first dashboard view for instant sidebar open. */
  isDashboardVisible?: boolean;
  /** When provided, "Go to Usage & Billing" in the usage popup will call this (e.g. close sidebar and navigate to settings). */
  onNavigateToUsageBilling?: () => void;
}

/** Parse getAllDocuments() response into a Document array. Shared by preload and open-sidebar fetch. */
function parseAllDocumentsResponse(response: any): Document[] {
  if (!response?.success) return [];
  const data = response.data;
  if (Array.isArray(data)) return data;
  if (data?.data && Array.isArray(data.data)) return data.data;
  if (data?.success && data?.data && Array.isArray(data.data)) return data.data;
  if (data?.documents && Array.isArray(data.documents)) return data.documents;
  if (data?.data?.documents && Array.isArray(data.data.documents)) return data.data.documents;
  return [];
}

// Stable key for a pending file (must match key used in parent)
const getPendingFileKey = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;

/** Scale factor for file/folder list proportions (1 = 100%, 0.9 = 10% smaller). */
const FILING_SIDEBAR_FILE_SCALE = 0.9;

// Component for displaying pending file with image preview
const PendingFileItem: React.FC<{
  file: File;
  index: number;
  isSelected?: boolean;
  showOutline?: boolean;
  isUploading?: boolean;
  onSelect?: (index: number) => void;
  onRemove: (index: number) => void;
  getFileIcon: (doc: Document) => React.ReactNode;
}> = ({ file, index, isSelected = false, showOutline = false, isUploading = false, onSelect, onRemove, getFileIcon }) => {
  const isImage = file.type.startsWith('image/');
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  
  // Create blob URL for images
  React.useEffect(() => {
    if (isImage && file) {
      const url = URL.createObjectURL(file);
      setImageUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    }
  }, [isImage, file]);
  
  // Create a mock document object for getFileIcon
  const mockDoc: Document = {
    id: `pending-${index}`,
    original_filename: file.name,
    file_type: file.type
  };
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0 } }}
      transition={{ 
        duration: 0.4,
        delay: index * 0.04,
        ease: [0.25, 0.46, 0.45, 0.94]
      }}
      onClick={() => onSelect?.(index)}
      role={onSelect ? 'button' : undefined}
      className={`flex items-center gap-2.5 px-3 py-2 bg-white border rounded-lg transition-all duration-200 group cursor-pointer ${showOutline ? 'border-gray-400 ring-1 ring-gray-300' : 'border-gray-200/60 hover:border-gray-300/80'}`}
    >
      {/* Image preview or file icon */}
      <div className="flex-shrink-0 flex items-center justify-center">
        {isImage && imageUrl ? (
          <div
            style={{
              width: `${40 * FILING_SIDEBAR_FILE_SCALE}px`,
              height: `${40 * FILING_SIDEBAR_FILE_SCALE}px`,
              borderRadius: '4px',
              overflow: 'hidden',
              backgroundColor: '#F3F4F6',
              border: '1px solid #E5E7EB',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <img
              src={imageUrl}
              alt={file.name}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block'
              }}
            />
          </div>
        ) : (
          <div className="w-3.5 h-3.5 flex items-center justify-center">
            {getFileIcon(mockDoc)}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-normal text-gray-900 truncate" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '-0.01em', fontSize: `${12 * FILING_SIDEBAR_FILE_SCALE}px` }}>
          {file.name}
        </div>
      </div>
      {isUploading ? (
        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
          <OrbitProgress color="#22c55e" size="small" dense text="" textColor="" speedPlus={1} style={{ fontSize: '2px' }} />
        </div>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(index);
          }}
          className="p-0.5 hover:bg-gray-100 rounded flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-150"
          title="Remove file"
        >
          <div className="w-3 h-3 flex items-center justify-center">
            <X className="w-3 h-3 text-gray-400" strokeWidth={1.5} />
          </div>
        </button>
      )}
    </motion.div>
  );
};

export const FilingSidebar: React.FC<FilingSidebarProps> = ({ 
  sidebarWidth,
  isSmallSidebarMode = false,
  hideCloseButton = false,
  onOpenFileView,
  openFileViewDocumentId = null,
  isDashboardVisible = false,
  onNavigateToUsageBilling,
}) => {
  const {
    isOpen,
    viewMode,
    selectedPropertyId,
    searchQuery,
    selectedItems,
    width: contextWidth,
    closeSidebar,
    setViewMode,
    setSearchQuery,
    toggleItemSelection,
    clearSelection,
    selectAll,
    setWidth: setContextWidth,
    setIsResizing: setContextIsResizing,
    initialPendingFiles,
    setInitialPendingFiles,
    setFilesUploading,
  } = useFilingSidebar();
  const { getAllPropertyHubs } = useBackendApi();

  const [documents, setDocuments] = useState<Document[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [openContextMenuId, setOpenContextMenuId] = useState<string | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [expandedProperties, setExpandedProperties] = useState<Set<string>>(new Set());
  const [propertyAddresses, setPropertyAddresses] = useState<Map<string, string>>(new Map());
  const [documentToPropertyHubMap, setDocumentToPropertyHubMap] = useState<Map<string, string>>(new Map()); // document.id -> propertyHub.id
  const [isResizing, setIsResizing] = useState(false);
  const [draggedWidth, setDraggedWidth] = useState<number | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [selectedPendingFileIndex, setSelectedPendingFileIndex] = useState<number | null>(null);
  const [outlinedPendingFileIndex, setOutlinedPendingFileIndex] = useState<number | null>(null); // outline only when user clicked the file
  const [selectedPropertyForUpload, setSelectedPropertyForUpload] = useState<{ id: string; address: string; type: 'property' | 'folder' } | null>(null);
  const [propertySearchQuery, setPropertySearchQuery] = useState<string>('');
  
  // Property access control - only check when uploading to a property
  const propertyIdForAccess = selectedPropertyForUpload?.type === 'property' ? selectedPropertyForUpload.id : null;
  const { canUpload: canUploadToProperty } = usePropertyAccess(propertyIdForAccess);
  const [availableProperties, setAvailableProperties] = useState<any[]>([]);
  const [showPropertySelector, setShowPropertySelector] = useState<boolean>(false);
  const [duplicateDialog, setDuplicateDialog] = useState<{
    isOpen: boolean;
    filename: string;
    fileSize: number;
    existingDocuments: any[];
    file: File | null;
    isExactDuplicate: boolean;
  }>({
    isOpen: false,
    filename: '',
    fileSize: 0,
    existingDocuments: [],
    file: null,
    isExactDuplicate: false
  });
  /** Placeholders shown at top of file list while uploads are in progress (used when not using pending list) */
  const [uploadingPlaceholders, setUploadingPlaceholders] = useState<Array<{ id: string; name: string }>>([]);
  /** Keys of pending files currently uploading (same list stays visible with spinner) */
  const [uploadingFileKeys, setUploadingFileKeys] = useState<Set<string>>(new Set());
  /** Document IDs we just uploaded; keep sidebar spinner until they reach completed/failed */
  const [processingDocumentIds, setProcessingDocumentIds] = useState<Set<string>>(new Set());
  const [showSecureInfo, setShowSecureInfo] = useState(false);
  /** Document/page stats (completed docs only). Fetched with document list. */
  const [docStats, setDocStats] = useState<{ document_count: number; total_pages: number } | null>(null);

  // Usage (billing) — bar + popup in place of doc stats (from UsageContext)
  const { usage: usageData, loading: usageLoading, error: usageError } = useUsage();
  const [usagePopupOpen, setUsagePopupOpen] = useState(false);
  const usagePopupLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usagePopupEnterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const USAGE_POPUP_HOVER_DELAY_MS = 500;

  const clearUsagePopupLeaveTimer = useCallback(() => {
    if (usagePopupLeaveTimerRef.current) {
      clearTimeout(usagePopupLeaveTimerRef.current);
      usagePopupLeaveTimerRef.current = null;
    }
  }, []);
  const clearUsagePopupEnterTimer = useCallback(() => {
    if (usagePopupEnterTimerRef.current) {
      clearTimeout(usagePopupEnterTimerRef.current);
      usagePopupEnterTimerRef.current = null;
    }
  }, []);
  const scheduleUsagePopupOpen = useCallback(() => {
    clearUsagePopupEnterTimer();
    usagePopupEnterTimerRef.current = setTimeout(() => setUsagePopupOpen(true), USAGE_POPUP_HOVER_DELAY_MS);
  }, [clearUsagePopupEnterTimer]);
  const scheduleUsagePopupClose = useCallback(() => {
    clearUsagePopupEnterTimer();
    clearUsagePopupLeaveTimer();
    usagePopupLeaveTimerRef.current = setTimeout(() => setUsagePopupOpen(false), 150);
  }, [clearUsagePopupLeaveTimer, clearUsagePopupEnterTimer]);
  const onUsageBarOrPopupEnter = useCallback(() => {
    clearUsagePopupLeaveTimer();
    clearUsagePopupEnterTimer();
    setUsagePopupOpen(true);
  }, [clearUsagePopupLeaveTimer, clearUsagePopupEnterTimer]);
  useEffect(() => () => {
    clearUsagePopupLeaveTimer();
    clearUsagePopupEnterTimer();
  }, [clearUsagePopupLeaveTimer, clearUsagePopupEnterTimer]);

  // Remove from processingDocumentIds when docs reach completed/failed (so spinner can turn off)
  useEffect(() => {
    setProcessingDocumentIds((prev) => {
      if (prev.size === 0) return prev;
      let next: Set<string> | null = null;
      for (const id of prev) {
        const doc = documents.find((d) => d.id === id);
        if (doc && (doc.status === 'completed' || doc.status === 'failed')) {
          if (!next) next = new Set(prev);
          next.delete(id);
        }
      }
      return next ?? prev;
    });
  }, [documents]);

  // Poll document list while we have docs still processing so we can clear spinner when done
  useEffect(() => {
    if (processingDocumentIds.size === 0) return;
    const uploadCacheKey =
      viewMode === 'property' && selectedPropertyId ? `property_${selectedPropertyId}` : 'global';
    const interval = setInterval(async () => {
      documentCacheRef.current.delete(uploadCacheKey);
      cacheTimestampRef.current.delete(uploadCacheKey);
      if (viewMode === 'property' && selectedPropertyId) {
        const response = await backendApi.getPropertyHubDocuments(selectedPropertyId);
        if (response.success && response.data) {
          let docs: Document[] = [];
          const data = response.data;
          if (Array.isArray(data)) docs = data;
          else if (data?.data?.documents && Array.isArray(data.data.documents)) docs = data.data.documents;
          else if (data?.data && Array.isArray(data.data)) docs = data.data;
          else if (Array.isArray(data?.documents)) docs = data.documents;
          else if (data?.documents && Array.isArray(data.documents)) docs = data.documents;
          setDocuments(docs);
        }
      } else {
        const response = await backendApi.getAllDocuments();
        const docs = parseAllDocumentsResponse(response);
        if (response.success) setDocuments(docs);
      }
      // Refresh document/page stats when list refreshes (e.g. processing completed)
      try {
        const statsRes = await backendApi.getDocumentStats();
        if (statsRes.success && statsRes.data) setDocStats(statsRes.data);
        // Notify sidebar + Settings > Usage & Billing to refetch page count (linked to this upload area + UploadOverlay + NewPropertyPinWorkflow)
        window.dispatchEvent(new CustomEvent('usageShouldRefresh'));
      } catch (_) {}
    }, 3000);
    return () => clearInterval(interval);
  }, [viewMode, selectedPropertyId, processingDocumentIds.size]);

  // Sync uploading state to context so Sidebar can show spinner until upload + processing are done
  useEffect(() => {
    const hasProcessingDocs =
      processingDocumentIds.size > 0 &&
      Array.from(processingDocumentIds).some((id) => {
        const doc = documents.find((d) => d.id === id);
        return !doc || doc.status === 'uploaded' || doc.status === 'processing';
      });
    const uploading =
      uploadingFileKeys.size > 0 || uploadingPlaceholders.length > 0 || hasProcessingDocs;
    setFilesUploading(uploading);
  }, [uploadingFileKeys, uploadingPlaceholders, processingDocumentIds, documents, setFilesUploading]);

  // Delete confirmation pop-up state
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{
    isOpen: boolean;
    itemId: string | null;
    isFolder: boolean;
    itemName: string;
    position: { x: number; y: number } | null;
  }>({
    isOpen: false,
    itemId: null,
    isFolder: false,
    itemName: '',
    position: null,
  });
  
  // Track documents being reprocessed and successfully reprocessed
  const [reprocessingDocs, setReprocessingDocs] = useState<Set<string>>(new Set());
  const [reprocessedDocs, setReprocessedDocs] = useState<Set<string>>(new Set()); // Successfully reprocessed this session
  // Pipeline stages hover pop-up: which doc is hovered, progress from API, show popup after delay
  const [hoveredPipelineDoc, setHoveredPipelineDoc] = useState<{ documentId: string; doc: Document } | null>(null);
  const [pipelineProgress, setPipelineProgress] = useState<PipelineProgressData | null>(null);
  const [showPipelinePreview, setShowPipelinePreview] = useState(false);
  const [pipelinePreviewPosition, setPipelinePreviewPosition] = useState({ x: 0, y: 0 });
  const [pipelinePreviewBounds, setPipelinePreviewBounds] = useState<{ left: number; right: number } | undefined>(undefined);
  const pipelineHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pipelineLeaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pipelinePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const newMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const deleteConfirmRef = useRef<HTMLDivElement>(null);
  const panelElementRef = useRef<HTMLElement | null>(null);
  const resizeStateRef = useRef<{ startPos: { x: number }; startWidth: number } | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const propertySelectorRef = useRef<HTMLDivElement>(null);
  const uploadZoneBottomRef = useRef<HTMLDivElement>(null);
  const pendingSectionRef = useRef<HTMLDivElement>(null);
  
  // Document cache: key is "viewMode_propertyId" or "viewMode_global"
  const documentCacheRef = useRef<Map<string, Document[]>>(new Map());
  const cacheTimestampRef = useRef<Map<string, number>>(new Map());
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache duration
  const preloadStartedRef = useRef(false);
  const hoverPreloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { addPreviewFile, setPreviewFiles, setIsPreviewOpen } = usePreview();

  // Preload blob for a single doc (e.g. on hover) so click opens file popup instantly
  const scheduleHoverPreload = useCallback((doc: Document) => {
    if (hoverPreloadTimeoutRef.current) clearTimeout(hoverPreloadTimeoutRef.current);
    hoverPreloadTimeoutRef.current = setTimeout(() => {
      hoverPreloadTimeoutRef.current = null;
      preloadDocumentBlobs([{ id: doc.id, s3_path: doc.s3_path }]);
    }, 200);
  }, []);
  const cancelHoverPreload = useCallback(() => {
    if (hoverPreloadTimeoutRef.current) {
      clearTimeout(hoverPreloadTimeoutRef.current);
      hoverPreloadTimeoutRef.current = null;
    }
  }, []);

  // Number of doc blobs to preload for "above the fold" in the sidebar (viewable height)
  const VISIBLE_PRELOAD_COUNT = 15;

  // Pre-load global documents when dashboard is first visible (not when sidebar opens) so Files opens instantly.
  // Run warmConnection and getAllDocuments in parallel for speed; preload blobs for first VISIBLE_PRELOAD_COUNT docs.
  useEffect(() => {
    if (!isDashboardVisible || preloadStartedRef.current) return;
    preloadStartedRef.current = true;
    const run = async () => {
      try {
        // Don't await warmConnection – fetch documents immediately for faster load
        void backendApi.warmConnection?.();
        const response = await backendApi.getAllDocuments();
        const docs = parseAllDocumentsResponse(response);
        documentCacheRef.current.set('global', docs);
        cacheTimestampRef.current.set('global', Date.now());
        if (docs.length > 0) {
          preloadDocumentBlobs(
            docs.slice(0, VISIBLE_PRELOAD_COUNT).map((d) => ({ id: d.id, s3_path: d.s3_path }))
          );
        }
      } catch (_) {
        // Ignore; sidebar will fetch when opened
      }
    };
    run();
  }, [isDashboardVisible]);

  // Fetch properties and folders when selector opens; prefetch first 2 properties' documents for instant switch
  useEffect(() => {
    if (showPropertySelector && availableProperties.length === 0) {
      const loadProperties = async () => {
        try {
          const response = await backendApi.getAllPropertyHubs();
          if (response.success && response.data) {
            const properties = Array.isArray(response.data) 
              ? response.data 
              : (response.data as any).properties || [];
            setAvailableProperties(properties);
            // Prefetch documents for first 2 properties so switching to them is instant
            for (const p of properties.slice(0, 2)) {
              const id = (p as any)?.property?.id ?? (p as any)?.id;
              if (id) {
                backendApi.getPropertyHubDocuments(id).then((res) => {
                  if (!res.success || !res.data) return;
                  let docs: any[] = [];
                  const d = res.data;
                  if (Array.isArray(d)) docs = d;
                  else if (d?.data?.documents) docs = d.data.documents;
                  else if (Array.isArray(d?.documents)) docs = d.documents;
                  if (docs.length) {
                    documentCacheRef.current.set(`property_${id}`, docs);
                    cacheTimestampRef.current.set(`property_${id}`, Date.now());
                  }
                }).catch(() => {});
              }
            }
          }
        } catch (error) {
          console.error('Failed to load properties:', error);
        }
      };
      loadProperties();
    }
  }, [showPropertySelector]);

  // Fetch documents when sidebar opens or view changes
  useEffect(() => {
    if (!isOpen) return;

    const fetchData = async () => {
      // Initialize folders as empty - will be loaded after documents
      setFolders([]);
      
      // Generate cache key based on view mode and property ID
      const cacheKey = viewMode === 'property' && selectedPropertyId
        ? `property_${selectedPropertyId}`
        : 'global';
      
      // Check cache first (stale-while-revalidate: show any cached data immediately)
      const cachedDocs = documentCacheRef.current.get(cacheKey);
      const cacheTimestamp = cacheTimestampRef.current.get(cacheKey);
      const now = Date.now();
      const isCacheValid = cachedDocs && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION;
      const hasStaleCache = !!(cachedDocs && cachedDocs.length >= 0);
      
      // Helper function to load folders
      const loadFolders = () => {
        if (viewMode === 'property' && !currentFolderId) {
          setFolders([]);
        } else {
          const storageKey = viewMode === 'property' && selectedPropertyId
            ? `folders_${selectedPropertyId}_${currentFolderId || 'root'}`
            : `folders_global_${currentFolderId || 'root'}`;
          const savedFolders = JSON.parse(localStorage.getItem(storageKey) || '[]');
          setFolders(savedFolders);
        }
      };

      // Stale-while-revalidate: show cached data immediately (even if expired) so UI is instant
      if (hasStaleCache && cachedDocs) {
        setDocuments(cachedDocs);
        loadFolders();
        setIsLoading(false);
        setError(null);
      } else {
        // No cache: show skeleton immediately (no delay) so user sees placeholders, not empty or spinner
        setError(null);
        setIsLoading(true);
      }

      try {
        if (viewMode === 'property' && selectedPropertyId) {
          // Fetch property-specific documents
          const response = await backendApi.getPropertyHubDocuments(selectedPropertyId);
          
          if (response.success && response.data) {
            // Backend returns: { success: True, data: { documents: [...], document_count: N } }
            // fetchApi wraps it: { success: true, data: { success: True, data: { documents: [...] } } }
            let docs: any[] = [];
            
            // Try to extract documents from various possible structures
            if (Array.isArray(response.data)) {
              docs = response.data;
            } else if (response.data.data && Array.isArray(response.data.data.documents)) {
              docs = response.data.data.documents;
            } else if (response.data.data && Array.isArray(response.data.data)) {
              docs = response.data.data;
            } else if (Array.isArray(response.data.documents)) {
              docs = response.data.documents;
            } else if (response.data.documents && Array.isArray(response.data.documents)) {
              docs = response.data.documents;
            }
            
            documentCacheRef.current.set(cacheKey, docs);
            cacheTimestampRef.current.set(cacheKey, Date.now());
            
            // Update UI when we didn't have valid cache (no cache, or stale-while-revalidate)
            if (!isCacheValid) {
              setDocuments(docs);
              loadFolders();
              setIsLoading(false); // clear loader as soon as data is ready
            }
            // Fetch document/page stats (completed docs only, business-wide)
            try {
              const statsRes = await backendApi.getDocumentStats();
              if (statsRes.success && statsRes.data) setDocStats(statsRes.data);
            } catch (_) {}
          } else if (!isCacheValid) {
            setError(response.error || 'Failed to load property documents');
            setDocuments([]);
            setFolders([]);
            setIsLoading(false);
          }
        } else {
          // Fetch all documents globally
          try {
            const response = await backendApi.getAllDocuments();
            const docs = parseAllDocumentsResponse(response);
            if (response.success) {
              documentCacheRef.current.set(cacheKey, docs);
              cacheTimestampRef.current.set(cacheKey, Date.now());
              if (!isCacheValid) {
                setDocuments(docs);
                loadFolders();
                setIsLoading(false); // clear loader as soon as data is ready
              }
              // Fetch document/page stats (completed docs only)
              try {
                const statsRes = await backendApi.getDocumentStats();
                if (statsRes.success && statsRes.data) setDocStats(statsRes.data);
              } catch (_) {}
            } else if (!isCacheValid) {
              setError(response.error || 'Failed to load documents');
              setDocuments([]);
              setFolders([]);
              setIsLoading(false);
            }
          } catch (err) {
            if (!isCacheValid) {
              setError('Failed to load documents');
              setDocuments([]);
              setFolders([]);
              setIsLoading(false);
            }
          }
        }
      } catch (err) {
        console.error('Error fetching documents:', err);
        setError('Failed to load documents');
        setDocuments([]);
        setIsLoading(false);
      } finally {
        setIsLoading(false); // ensure loader is always cleared
      }
    };

    fetchData();
  }, [isOpen, viewMode, selectedPropertyId]);

  // When sidebar opens with files from the upload overlay, merge them into pending files
  useEffect(() => {
    if (!isOpen || !initialPendingFiles || initialPendingFiles.length === 0) return;
    setPendingFiles((prev) => [...prev, ...initialPendingFiles]);
    setInitialPendingFiles(null);
  }, [isOpen, initialPendingFiles, setInitialPendingFiles]);

  // Fetch property addresses and document-to-property mappings from property hubs
  useEffect(() => {
    if (viewMode === 'property' && isOpen && documents.length > 0) {
      const fetchPropertyData = async () => {
        try {
          // Use BackendApi.tsx getAllPropertyHubs (same as SquareMap) - returns array directly
          const properties = await getAllPropertyHubs();
          const addressesMap = new Map<string, string>();
          const docToPropertyHubMap = new Map<string, string>(); // document.id -> propertyHub.id
          
          // Map property.id -> property.address AND document.id -> property.id
          properties.forEach((property: any) => {
            const propertyId = property?.property?.id || property?.id;
            const address = property?.address || property?.property?.formatted_address || property?.property_details?.property_address;
            
            if (propertyId && address) {
              addressesMap.set(propertyId, address);
              
              // Map documents in this property hub to the property hub ID
              if (property?.documents && Array.isArray(property.documents)) {
                property.documents.forEach((doc: any) => {
                  if (doc.id) {
                    docToPropertyHubMap.set(doc.id, propertyId);
                  }
                });
              }
            }
          });
          
          setPropertyAddresses(addressesMap);
          setDocumentToPropertyHubMap(docToPropertyHubMap);
          
          console.log('🔍 FilingSidebar: Property addresses map:', Array.from(addressesMap.entries()));
          console.log('🔍 FilingSidebar: Document to property hub map:', Array.from(docToPropertyHubMap.entries()));
        } catch (error) {
          console.warn('Failed to fetch property data:', error);
        }
      };
      
      fetchPropertyData();
    }
  }, [viewMode, isOpen, documents, getAllPropertyHubs]);

  // Preload document blobs when sidebar opens so File View pop-up opens instantly on click
  useEffect(() => {
    if (!isOpen || documents.length === 0) return;
    preloadDocumentBlobs(
      documents.slice(0, 40).map((d) => ({ id: d.id, s3_path: d.s3_path }))
    );
  }, [isOpen, documents]);

  // Handle resize functionality - same as SideChatPanel
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!panelElementRef.current) return;
    
    const rect = panelElementRef.current.getBoundingClientRect();
    const currentWidth = draggedWidth !== null ? draggedWidth : contextWidth; // Use context width as default
    
    setIsResizing(true);
    setContextIsResizing(true); // Notify context that resizing has started
    
    // Store in ref for fast access during drag
    resizeStateRef.current = {
      startPos: { x: e.clientX },
      startWidth: currentWidth
    };
  };

  // Handle resize mouse move and cleanup - using useEffect like SideChatPanel
  useEffect(() => {
    if (!isResizing || !resizeStateRef.current || !panelElementRef.current) {
      return;
    }

    const state = resizeStateRef.current;
    const minWidth = 360; // Minimum width for resize
    // Max width based on file card max-width (max-w-md = 448px) + margins (mx-4 = 32px) + padding
    const fileCardMaxWidth = 448; // max-w-md in pixels
    const cardMargins = 32; // mx-4 = 16px on each side
    const contentPadding = 16; // Additional padding for content area
    const calculatedMaxWidth = fileCardMaxWidth + cardMargins + contentPadding;
    const maxWidth = Math.min(calculatedMaxWidth, window.innerWidth - (sidebarWidth || 56) - 100);

    const handleMouseMove = (e: MouseEvent) => {
      // Cancel any pending RAF
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }

      // Use requestAnimationFrame for smooth updates
      rafIdRef.current = requestAnimationFrame(() => {
        if (!panelElementRef.current || !resizeStateRef.current) return;

        const deltaX = e.clientX - state.startPos.x;
        
        // Calculate new width based on delta (dragging right = positive delta = wider)
        const newWidth = Math.min(Math.max(state.startWidth + deltaX, minWidth), maxWidth);
        
        // Direct DOM manipulation for immediate visual feedback
        if (panelElementRef.current) {
          panelElementRef.current.style.width = `${newWidth}px`;
        }
        
        // Update state
        setDraggedWidth(newWidth);
        // Sync to context so other components can use it
        setContextWidth(newWidth);
      });
    };

    const handleMouseUp = () => {
      // Cancel any pending RAF
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      setIsResizing(false);
      setContextIsResizing(false); // Notify context that resizing has ended
      resizeStateRef.current = null;
      
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    // Use passive listeners for better performance
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseup', handleMouseUp, { passive: true });
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    return () => {
      // Cleanup
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, sidebarWidth]);

  // Close new menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(event.target as Node)) {
        setShowNewMenu(false);
      }
    };

    if (showNewMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showNewMenu]);

  // Close property selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (propertySelectorRef.current && !propertySelectorRef.current.contains(event.target as Node)) {
        setShowPropertySelector(false);
      }
    };

    if (showPropertySelector) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showPropertySelector]);

  // Clear file outline when clicking outside the pending files section
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        outlinedPendingFileIndex !== null &&
        pendingSectionRef.current &&
        !pendingSectionRef.current.contains(event.target as Node)
      ) {
        setOutlinedPendingFileIndex(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [outlinedPendingFileIndex]);

  // Filter documents based on search query and current folder
  const filteredItems = useMemo(() => {
    let filteredDocs = documents;
    let filteredFolders = folders;

    // In property view (when not inside a folder), don't show folders
    // Folders should only appear in "All Files" view or when navigating inside a folder
    if (viewMode === 'property' && !currentFolderId) {
      filteredFolders = [];
    } else {
      // Filter by current folder
      if (currentFolderId) {
        filteredDocs = filteredDocs.filter(doc => doc.folder_id === currentFolderId);
        filteredFolders = filteredFolders.filter(folder => folder.parent_id === currentFolderId);
      } else {
        filteredDocs = filteredDocs.filter(doc => !doc.folder_id);
        filteredFolders = folders.filter(folder => !folder.parent_id);
      }
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filteredDocs = filteredDocs.filter(doc =>
        doc.original_filename.toLowerCase().includes(query) ||
        doc.property_address?.toLowerCase().includes(query)
      );
      filteredFolders = filteredFolders.filter(folder =>
        folder.name.toLowerCase().includes(query)
      );
    }

    // Sort documents by created_at descending (newest / just uploaded at top)
    const sortedDocs = [...filteredDocs].sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });

    // Sort folders alphabetically by name
    const sortedFolders = [...filteredFolders].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '')
    );

    return { documents: sortedDocs, folders: sortedFolders };
  }, [documents, folders, currentFolderId, searchQuery, viewMode]);

  // Group documents by property hub (property card) when in property view
  const groupedDocumentsByProperty = useMemo(() => {
    if (viewMode !== 'property' || currentFolderId) {
      // Don't group if not in property view or if inside a folder
      return null;
    }

    const grouped = new Map<string, Document[]>();
    
    filteredItems.documents.forEach(doc => {
      // First, try to find which property hub this document belongs to via document_relationships
      let propertyHubId: string | null = null;
      
      // Check document-to-property-hub mapping (from property hubs' documents array)
      const mappedPropertyHubId = documentToPropertyHubMap.get(doc.id);
      if (mappedPropertyHubId) {
        propertyHubId = mappedPropertyHubId;
      } else if (doc.property_id) {
        // Fallback to document's property_id if no mapping found
        propertyHubId = doc.property_id;
      }
      
      if (!propertyHubId) {
        // Documents without any property association go to "Unknown Property" group
        const unknownKey = 'unknown';
        if (!grouped.has(unknownKey)) {
          grouped.set(unknownKey, []);
        }
        grouped.get(unknownKey)!.push(doc);
        return;
      }
      
      if (!grouped.has(propertyHubId)) {
        grouped.set(propertyHubId, []);
      }
      grouped.get(propertyHubId)!.push(doc);
    });

    // Convert to array and sort by property address (EXACT same as RecentProjectsSection)
    const result = Array.from(grouped.entries())
      .map(([propertyId, docs]) => {
        // Get property address (EXACT same as RecentProjectCard uses propertyAddress prop)
        let propertyAddress: string;
        if (propertyId === 'unknown') {
          propertyAddress = 'Unknown Property';
        } else {
          // Get property address from propertyAddresses map (propertyId is now the property hub ID)
          const addressFromHub = propertyAddresses.get(propertyId);
          
          if (addressFromHub) {
            propertyAddress = addressFromHub;
          } else {
            // Fallback to document property_address
            const docWithAddress = docs.find(d => d.property_address);
            propertyAddress = docWithAddress?.property_address || `Property ${propertyId}`;
          }
        }
        
        return {
          propertyId: propertyId === 'unknown' ? 'unknown' : propertyId,
          propertyAddress,
          documents: docs.sort((a, b) => {
            const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
            const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
            return bTime - aTime;
          })
        };
      })
      .sort((a, b) => {
        // Put "Unknown Property" at the end
        if (a.propertyId === 'unknown') return 1;
        if (b.propertyId === 'unknown') return -1;
        return a.propertyAddress.localeCompare(b.propertyAddress);
      });
    
    return result;
  }, [filteredItems.documents, viewMode, currentFolderId, propertyAddresses, documentToPropertyHubMap]);

  // Toggle property section expansion
  const togglePropertyExpansion = (propertyId: string) => {
    setExpandedProperties(prev => {
      const next = new Set(prev);
      if (next.has(propertyId)) {
        next.delete(propertyId);
      } else {
        next.add(propertyId);
      }
      return next;
    });
  };

  // Get file type icon (sized to match row proportions)
  const getFileIcon = (doc: Document) => {
    const filename = doc.original_filename.toLowerCase();
    const iconClass = "w-3.5 h-3.5 object-contain flex-shrink-0";
    if (filename.endsWith('.pdf')) {
      return <img src="/PDF.png" alt="PDF" className={iconClass} />;
    } else if (filename.endsWith('.doc') || filename.endsWith('.docx')) {
      return <img src="/word.png" alt="Word" className={iconClass} />;
    } else if (filename.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      return <FileIcon className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />;
    }
    return <FileIcon className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />;
  };

  // Format date
  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    } catch {
      return '';
    }
  };

  // Format date for card display (day number + day abbreviation)
  const formatDateForCard = (dateString: string | undefined): { day: string; dayName: string } => {
    if (!dateString) return { day: '--', dayName: '---' };
    try {
      const date = new Date(dateString);
      const day = date.getDate().toString();
      const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      const dayName = dayNames[date.getDay()];
      return { day, dayName };
    } catch {
      return { day: '--', dayName: '---' };
    }
  };

  // Check if document is linked to a property
  const isDocumentLinked = (doc: Document): boolean => {
    return !!doc.property_id || !!documentToPropertyHubMap.get(doc.id);
  };

  // Handle document click - open in preview
  const handleDocumentClick = async (doc: Document) => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
      let downloadUrl: string;

      if (doc.s3_path) {
        downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(doc.s3_path)}`;
      } else {
        downloadUrl = `${backendUrl}/api/files/download?document_id=${doc.id}`;
      }

      const response = await fetch(downloadUrl, { credentials: 'include' });
      if (!response.ok) throw new Error('Download failed');

      const blob = await response.blob();
      const file = new File([blob], doc.original_filename, {
        type: doc.file_type || blob.type || 'application/pdf',
      });

      const fileData = {
        id: doc.id,
        name: doc.original_filename,
        type: doc.file_type || blob.type,
        size: blob.size,
        file,
      };

      setPreviewFiles([fileData]);
      setIsPreviewOpen(true);
    } catch (err) {
      console.error('Error opening document:', err);
    }
  };

  // Handle drag start for file items
  const handleDragStart = (e: React.DragEvent, doc: Document) => {
    const payload = {
      type: 'filing-sidebar-document',
      documentId: doc.id,
      filename: doc.original_filename,
      fileType: doc.file_type,
      s3Path: doc.s3_path
    };
    const jsonStr = JSON.stringify(payload);
    e.dataTransfer.effectAllowed = 'copy';
    // Use text/plain for cross-browser compatibility (Chrome often blocks getData for custom MIME types)
    e.dataTransfer.setData('text/plain', jsonStr);
    e.dataTransfer.setData('application/json', jsonStr);
    if (e.dataTransfer.setDragImage) {
      const target = e.currentTarget as HTMLElement;
      if (target) e.dataTransfer.setDragImage(target, 20, 20);
    }
    console.log('📤 FilingSidebar: Started dragging document:', doc.original_filename);
  };

  // Handle folder navigation
  const handleFolderClick = (folderId: string) => {
    setCurrentFolderId(folderId);
    clearSelection();
  };

  // Handle back navigation
  const handleBack = () => {
    setCurrentFolderId(null);
    clearSelection();
  };

  // Get breadcrumb path
  const breadcrumbs = useMemo(() => {
    // TODO: Build breadcrumb path when folder structure is available
    return currentFolderId ? [{ id: currentFolderId, name: 'Current Folder' }] : [];
  }, [currentFolderId]);

  // Select all items
  const handleSelectAll = () => {
    const allIds = [
      ...filteredItems.folders.map(f => f.id),
      ...filteredItems.documents.map(d => d.id),
    ];
    if (selectedItems.size === allIds.length) {
      clearSelection();
    } else {
      selectAll(allIds);
    }
  };

  // Context menu handlers
  const handleContextMenuClick = (e: React.MouseEvent, itemId: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenuPosition({ x: rect.right - 200, y: rect.top + 20 });
    setOpenContextMenuId(openContextMenuId === itemId ? null : itemId);
  };

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setOpenContextMenuId(null);
        setContextMenuPosition(null);
      }
      // Also close delete confirmation pop-up when clicking outside
      if (deleteConfirmRef.current && !deleteConfirmRef.current.contains(e.target as Node)) {
        setDeleteConfirmDialog({ isOpen: false, itemId: null, isFolder: false, itemName: '', position: null });
      }
    };
    if (openContextMenuId || deleteConfirmDialog.isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [openContextMenuId, deleteConfirmDialog.isOpen]);

  // Handle rename
  const handleRename = (itemId: string, currentName: string, isFolder: boolean) => {
    setEditingItemId(itemId);
    setEditingName(currentName);
    setOpenContextMenuId(null);
    setContextMenuPosition(null);
    // TODO: Implement rename API call
  };

  // Handle create folder
  const handleCreateFolder = async () => {
    try {
      // Generate a temporary ID
      const tempId = `folder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newFolder: Folder = {
        id: tempId,
        name: 'New Folder',
        document_count: 0,
        parent_id: currentFolderId || undefined,
        property_id: viewMode === 'property' ? selectedPropertyId : undefined,
      };

      // Add to folders state immediately (optimistic update)
      setFolders(prev => [...prev, newFolder]);
      
      // Put it in edit mode immediately
      setEditingItemId(tempId);
      setEditingName('New Folder');
      
      // Save to localStorage for persistence
      const storageKey = viewMode === 'property' && selectedPropertyId
        ? `folders_${selectedPropertyId}_${currentFolderId || 'root'}`
        : `folders_global_${currentFolderId || 'root'}`;
      const existingFolders = JSON.parse(localStorage.getItem(storageKey) || '[]');
      existingFolders.push(newFolder);
      localStorage.setItem(storageKey, JSON.stringify(existingFolders));

      // Try to create folder via API (optional - for backend persistence)
      try {
        const response = await backendApi.createFolder(
          'New Folder',
          currentFolderId || undefined,
          viewMode === 'property' ? selectedPropertyId : undefined
        );
        if (response.success && response.data) {
          // Update with real ID from backend if provided
          const realId = response.data.id || response.data.folder_id;
          if (realId && realId !== tempId) {
            setFolders(prev => prev.map(f => f.id === tempId ? { ...f, id: realId } : f));
            // Update localStorage with real ID
            const updatedFolders = existingFolders.map((f: Folder) => 
              f.id === tempId ? { ...f, id: realId } : f
            );
            localStorage.setItem(storageKey, JSON.stringify(updatedFolders));
            setEditingItemId(realId);
          }
        }
      } catch (apiError) {
        // API call failed, but folder is still created locally
        console.warn('Failed to create folder via API, using local storage:', apiError);
      }
    } catch (error) {
      console.error('Error creating folder:', error);
      setError('Failed to create folder');
    }
  };

  // Handle save rename
  const handleSaveRename = async (itemId: string, isFolder: boolean) => {
    if (!editingName.trim()) {
      // If empty name and it's a new folder, remove it
      if (isFolder && itemId.startsWith('folder-')) {
        setFolders(prev => prev.filter(f => f.id !== itemId));
        // Remove from localStorage
        const storageKey = viewMode === 'property' && selectedPropertyId
          ? `folders_${selectedPropertyId}_${currentFolderId || 'root'}`
          : `folders_global_${currentFolderId || 'root'}`;
        const existingFolders = JSON.parse(localStorage.getItem(storageKey) || '[]');
        const updatedFolders = existingFolders.filter((f: Folder) => f.id !== itemId);
        localStorage.setItem(storageKey, JSON.stringify(updatedFolders));
      }
      setEditingItemId(null);
      setEditingName('');
      return;
    }

    if (isFolder) {
      const newName = editingName.trim();
      
      // Update folder name in state
      setFolders(prev => prev.map(f => 
        f.id === itemId ? { ...f, name: newName } : f
      ));
      
      // Update localStorage
      const storageKey = viewMode === 'property' && selectedPropertyId
        ? `folders_${selectedPropertyId}_${currentFolderId || 'root'}`
        : `folders_global_${currentFolderId || 'root'}`;
      const existingFolders = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const updatedFolders = existingFolders.map((f: Folder) => 
        f.id === itemId ? { ...f, name: newName } : f
      );
      localStorage.setItem(storageKey, JSON.stringify(updatedFolders));

      // Update folder name via API if it's not a temp ID
      if (!itemId.startsWith('folder-')) {
        try {
          // Try to update via API (if endpoint exists)
          // For now, we'll just log - can add PUT endpoint later
          console.log('Renaming folder', itemId, 'to', newName);
        } catch (apiError) {
          console.warn('Failed to update folder name via API:', apiError);
        }
      }
    } else {
      // TODO: Implement document rename API call
      console.log('Renaming document', itemId, 'to', editingName);
    }
    
    setEditingItemId(null);
    setEditingName('');
    
    // Refresh documents if needed
    if (!isFolder) {
      if (viewMode === 'property' && selectedPropertyId) {
        const response = await backendApi.getPropertyHubDocuments(selectedPropertyId);
        if (response.success && response.data) {
          const docs = response.data.documents || response.data.data?.documents || response.data;
          setDocuments(Array.isArray(docs) ? docs : []);
        }
      } else {
        const response = await backendApi.getAllDocuments();
        if (response.success && response.data) {
          const docs = response.data.documents || response.data;
          setDocuments(Array.isArray(docs) ? docs : []);
        }
      }
    }
  };

  // Handle delete confirmation
  const handleDeleteClick = (itemId: string, isFolder: boolean, event?: React.MouseEvent) => {
    const item = isFolder 
      ? folders.find(f => f.id === itemId)
      : documents.find(d => d.id === itemId);
    const itemName = isFolder ? (item as Folder)?.name : (item as Document)?.original_filename;
    
    // Calculate position near the context menu or delete button
    let position = { x: 0, y: 0 };
    if (contextMenuPosition) {
      // Use context menu position if available (preferred)
      position = contextMenuPosition;
    } else if (event && panelElementRef.current) {
      // Calculate from button click position
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const sidebarRect = panelElementRef.current.getBoundingClientRect();
      position = {
        x: rect.right - sidebarRect.left - 200, // Position to the left of the button
        y: rect.top - sidebarRect.top + 20
      };
    }
    
    setDeleteConfirmDialog({
      isOpen: true,
      itemId,
      isFolder,
      itemName: itemName || 'item',
      position,
    });
    setOpenContextMenuId(null);
    setContextMenuPosition(null);
  };

  // Handle delete (after confirmation)
  const handleDelete = async () => {
    const { itemId, isFolder } = deleteConfirmDialog;
    if (!itemId) return;

    // Close dialog and remove from UI immediately so the list updates before any async work
    setDeleteConfirmDialog({ isOpen: false, itemId: null, isFolder: false, itemName: '', position: null });

    if (isFolder) {
      // Delete folder and all its children from state
      const deleteFolderRecursive = (folderId: string, folderList: Folder[]): Folder[] => {
        return folderList.filter(f => {
          if (f.id === folderId) return false;
          if (f.parent_id === folderId) {
            // Also delete children of this folder
            return false;
          }
          return true;
        }).map(f => {
          // If this folder's parent was deleted, it becomes a root folder
          if (f.parent_id === folderId) {
            return { ...f, parent_id: undefined };
          }
          return f;
        });
      };
      
      // OPTIMISTIC UPDATE: Remove from state immediately for instant UI feedback
      setFolders(prev => deleteFolderRecursive(itemId, prev));
      
      // Remove from localStorage - need to update all relevant keys
      // Delete from current view's localStorage
      const currentStorageKey = viewMode === 'property' && selectedPropertyId
        ? `folders_${selectedPropertyId}_${currentFolderId || 'root'}`
        : `folders_global_${currentFolderId || 'root'}`;
      
      const currentFolders = JSON.parse(localStorage.getItem(currentStorageKey) || '[]');
      const updatedCurrentFolders = deleteFolderRecursive(itemId, currentFolders);
      localStorage.setItem(currentStorageKey, JSON.stringify(updatedCurrentFolders));
      
      // Also delete from root level if it exists there
      const rootStorageKey = viewMode === 'property' && selectedPropertyId
        ? `folders_${selectedPropertyId}_root`
        : `folders_global_root`;
      
      if (rootStorageKey !== currentStorageKey) {
        const rootFolders = JSON.parse(localStorage.getItem(rootStorageKey) || '[]');
        const updatedRootFolders = deleteFolderRecursive(itemId, rootFolders);
        localStorage.setItem(rootStorageKey, JSON.stringify(updatedRootFolders));
      }
      
      // Delete from all property-specific keys if in global view
      if (viewMode === 'global') {
        // Get all property IDs and clean up their folder storage
        const allPropertyIds = new Set<string>();
        documents.forEach(doc => {
          const propId = documentToPropertyHubMap.get(doc.id);
          if (propId) allPropertyIds.add(propId);
        });
        
        allPropertyIds.forEach(propId => {
          const propStorageKey = `folders_${propId}_root`;
          const propFolders = JSON.parse(localStorage.getItem(propStorageKey) || '[]');
          const updatedPropFolders = deleteFolderRecursive(itemId, propFolders);
          localStorage.setItem(propStorageKey, JSON.stringify(updatedPropFolders));
        });
      }
      
      // If we're inside the deleted folder, navigate back
      if (currentFolderId === itemId) {
        setCurrentFolderId(null);
      }
      
      // Also try to delete from Supabase if it exists there (async, non-blocking)
      backendApi.deleteFolder(itemId).catch((error) => {
        // Ignore errors - folders might only be in localStorage
        console.log('Folder deletion from Supabase (if exists):', error);
      });
    } else {
      // Delete document - remove from UI immediately so the file disappears before the API call
      const documentToDelete = documents.find(d => d.id === itemId);
      const cacheKey = viewMode === 'property' && selectedPropertyId
        ? `property_${selectedPropertyId}`
        : 'global';

      flushSync(() => {
        setDocuments(prev => prev.filter(d => d.id !== itemId));
      });
      documentCacheRef.current.delete(cacheKey);
      cacheTimestampRef.current.delete(cacheKey);

      // Check access and delete via API (async, non-blocking)
      if (documentToDelete?.property_id) {
        // Document belongs to a property - check access via API
        try {
          const accessResponse = await backendApi.getPropertyAccess(documentToDelete.property_id);
          if (accessResponse.success && accessResponse.data) {
            const accessList = Array.isArray(accessResponse.data) 
              ? accessResponse.data 
              : accessResponse.data.access_list || [];
            
            // Get current user email
            const authResult = await backendApi.checkAuth();
            const userEmail = authResult.success && authResult.data?.user?.email 
              ? authResult.data.user.email.toLowerCase() 
              : null;
            
            if (userEmail) {
              const userAccess = accessList.find(
                (access: any) => 
                  access.user_email.toLowerCase() === userEmail &&
                  access.status === 'accepted'
              );
              
              // If user has access but is only a viewer, deny delete and restore
              if (userAccess && userAccess.access_level === 'viewer') {
                // Restore document to state
                if (documentToDelete) {
                  setDocuments(prev => [...prev, documentToDelete]);
                }
                alert('You do not have permission to delete files. Only editors and owners can delete files from this property.');
                return;
              }
              // If user is not in access list, they might be the owner (same business) - allow
            }
          }
        } catch (error) {
          console.error('Error checking property access:', error);
          // On error, allow deletion (fallback to prevent blocking legitimate users)
        }
      }
      
      try {
        const response = await backendApi.deleteDocument(itemId);
        if (!response.success) {
          // Treat 404 / "Document not found" as success (already deleted)
          const isNotFound = response.statusCode === 404 ||
            (typeof response.error === 'string' && (response.error.includes('Document not found') || response.error.includes('not found')));
          if (isNotFound) {
            return; // Already removed from UI, nothing to do
          }
          // Restore document if deletion failed
          if (documentToDelete) {
            setDocuments(prev => [...prev, documentToDelete]);
          }
          alert(`Failed to delete document: ${response.error || 'Unknown error'}`);
        }
      } catch (error) {
        console.error('Error deleting document:', error);
        // Restore document if deletion failed
        if (documentToDelete) {
          setDocuments(prev => [...prev, documentToDelete]);
        }
        alert('Failed to delete document. Please try again.');
      }

      // Refresh document/page stats after delete (succeeded or not, so count stays correct)
      try {
        const statsRes = await backendApi.getDocumentStats();
        if (statsRes.success && statsRes.data) setDocStats(statsRes.data);
      } catch (_) {}
    }
  };

  // Handle document reprocessing (for documents stuck in 'uploaded' or 'failed' status)
  // API success only means "task queued"; we poll until backend reports completed or failed.
  const handleReprocessDocument = async (doc: Document, e: React.MouseEvent) => {
    e.stopPropagation();

    if (reprocessingDocs.has(doc.id)) return;

    setReprocessingDocs(prev => new Set(prev).add(doc.id));
    setDocuments(prev => prev.map(d => (d.id === doc.id ? { ...d, status: 'processing' } : d)));

    try {
      console.log(`🔄 Reprocessing document: ${doc.original_filename} (${doc.id})`);
      const response = await backendApi.reprocessDocument(doc.id, 'full');

      if (!response.success) {
        console.error(`❌ Reprocess failed:`, response.error);
        alert(`Failed to reprocess document: ${response.error || 'Unknown error'}`);
        setDocuments(prev => prev.map(d => (d.id === doc.id ? { ...d, status: doc.status } : d)));
        setReprocessingDocs(prev => {
          const next = new Set(prev);
          next.delete(doc.id);
          return next;
        });
        return;
      }

      console.log(`✅ Reprocess queued:`, response.data);
      documentCacheRef.current.clear();
      cacheTimestampRef.current.clear();

      // Poll until backend reports completed or failed (task is only queued at this point)
      const POLL_INTERVAL_MS = 2500;
      const POLL_TIMEOUT_MS = 5 * 60 * 1000;
      const startedAt = Date.now();

      const pollOnce = async (): Promise<'completed' | 'failed' | 'pending'> => {
        const res = await backendApi.getDocumentStatus(doc.id);
        if (!res?.success || !res?.data) return 'pending';
        const status = (res.data as { status?: string }).status;
        if (status === 'completed') return 'completed';
        if (status === 'failed') return 'failed';
        return 'pending';
      };

      const intervalId = setInterval(async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          clearInterval(intervalId);
          setReprocessingDocs(prev => {
            const next = new Set(prev);
            next.delete(doc.id);
            return next;
          });
          setDocuments(prev => prev.map(d => (d.id === doc.id ? { ...d, status: 'failed' } : d)));
          return;
        }
        const result = await pollOnce();
        if (result === 'completed') {
          clearInterval(intervalId);
          setDocuments(prev => prev.map(d => (d.id === doc.id ? { ...d, status: 'completed' } : d)));
          setReprocessedDocs(prev => new Set(prev).add(doc.id));
          window.dispatchEvent(new CustomEvent('usageShouldRefresh'));
          setReprocessingDocs(prev => {
            const next = new Set(prev);
            next.delete(doc.id);
            return next;
          });
        } else if (result === 'failed') {
          clearInterval(intervalId);
          setDocuments(prev => prev.map(d => (d.id === doc.id ? { ...d, status: 'failed' } : d)));
          setReprocessingDocs(prev => {
            const next = new Set(prev);
            next.delete(doc.id);
            return next;
          });
        }
      }, POLL_INTERVAL_MS);

      // First check immediately
      const first = await pollOnce();
      if (first === 'completed') {
        clearInterval(intervalId);
        setDocuments(prev => prev.map(d => (d.id === doc.id ? { ...d, status: 'completed' } : d)));
        setReprocessedDocs(prev => new Set(prev).add(doc.id));
        window.dispatchEvent(new CustomEvent('usageShouldRefresh'));
        setReprocessingDocs(prev => {
          const next = new Set(prev);
          next.delete(doc.id);
          return next;
        });
      } else if (first === 'failed') {
        clearInterval(intervalId);
        setDocuments(prev => prev.map(d => (d.id === doc.id ? { ...d, status: 'failed' } : d)));
        setReprocessingDocs(prev => {
          const next = new Set(prev);
          next.delete(doc.id);
          return next;
        });
      }
    } catch (error) {
      console.error('Error reprocessing document:', error);
      alert('Failed to reprocess document. Please try again.');
      setDocuments(prev => prev.map(d => (d.id === doc.id ? { ...d, status: doc.status } : d)));
      setReprocessingDocs(prev => {
        const next = new Set(prev);
        next.delete(doc.id);
        return next;
      });
    }
  };

  // Pipeline stages hover: show popup when hovering over spinner or completed tick
  const canShowPipelinePopup = (doc: Document) =>
    reprocessingDocs.has(doc.id) ||
    doc.status === 'processing' ||
    doc.status === 'uploaded' ||
    reprocessedDocs.has(doc.id) ||
    doc.status === 'completed';

  const handlePipelineTriggerMouseEnter = (doc: Document, e: React.MouseEvent<HTMLDivElement>) => {
    if (!canShowPipelinePopup(doc)) return;
    if (pipelineLeaveTimeoutRef.current) {
      clearTimeout(pipelineLeaveTimeoutRef.current);
      pipelineLeaveTimeoutRef.current = null;
    }
    setPipelinePreviewPosition({ x: e.clientX, y: e.clientY });
    setHoveredPipelineDoc({ documentId: doc.id, doc });
    if (doc.status === 'processing' || reprocessingDocs.has(doc.id)) {
      setPipelineProgress(null);
    } else {
      setPipelineProgress(null);
    }
    pipelineHoverTimeoutRef.current = setTimeout(() => setShowPipelinePreview(true), 450);
  };

  const handlePipelineTriggerMouseLeave = () => {
    if (pipelineHoverTimeoutRef.current) {
      clearTimeout(pipelineHoverTimeoutRef.current);
      pipelineHoverTimeoutRef.current = null;
    }
    pipelineLeaveTimeoutRef.current = setTimeout(() => {
      setShowPipelinePreview(false);
      setHoveredPipelineDoc(null);
      setPipelineProgress(null);
      if (pipelinePollingRef.current) {
        clearInterval(pipelinePollingRef.current);
        pipelinePollingRef.current = null;
      }
      pipelineLeaveTimeoutRef.current = null;
    }, 100);
  };

  const handlePipelinePreviewMouseEnter = () => {
    if (pipelineLeaveTimeoutRef.current) {
      clearTimeout(pipelineLeaveTimeoutRef.current);
      pipelineLeaveTimeoutRef.current = null;
    }
  };

  const handlePipelinePreviewMouseLeave = () => {
    setShowPipelinePreview(false);
    setHoveredPipelineDoc(null);
    setPipelineProgress(null);
    if (pipelinePollingRef.current) {
      clearInterval(pipelinePollingRef.current);
      pipelinePollingRef.current = null;
    }
  };

  // Poll document status when hovering over a processing document
  useEffect(() => {
    const doc = hoveredPipelineDoc?.doc;
    if (!hoveredPipelineDoc || !doc || (doc.status !== 'processing' && !reprocessingDocs.has(doc.id))) {
      return;
    }
    const documentId = hoveredPipelineDoc.documentId;
    const poll = async () => {
      try {
        const response = await backendApi.getDocumentStatus(documentId);
        if (response?.success && response?.data) {
          const data = response.data as { status?: string; pipeline_progress?: PipelineProgressData };
          setPipelineProgress(data.pipeline_progress ?? null);
          if (data.status === 'completed' || data.status === 'failed') {
            if (pipelinePollingRef.current) {
              clearInterval(pipelinePollingRef.current);
              pipelinePollingRef.current = null;
            }
            if (data.status === 'completed') {
              window.dispatchEvent(new CustomEvent('usageShouldRefresh'));
            }
          }
        }
      } catch (_) {
        // Ignore poll errors
      }
    };
    poll();
    pipelinePollingRef.current = setInterval(poll, 1000);
    return () => {
      if (pipelinePollingRef.current) {
        clearInterval(pipelinePollingRef.current);
        pipelinePollingRef.current = null;
      }
    };
  }, [hoveredPipelineDoc?.documentId, hoveredPipelineDoc?.doc?.status, reprocessingDocs]);

  // Cleanup pipeline hover timeouts on unmount
  useEffect(() => {
    return () => {
      if (pipelineHoverTimeoutRef.current) clearTimeout(pipelineHoverTimeoutRef.current);
      if (pipelineLeaveTimeoutRef.current) clearTimeout(pipelineLeaveTimeoutRef.current);
      if (pipelinePollingRef.current) clearInterval(pipelinePollingRef.current);
    };
  }, []);

  // Accepted file types for drag-and-drop (matches input accept)
  const ACCEPTED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xlsx', '.xls', '.csv'];
  const isAcceptedFile = useCallback((file: File) => {
    const name = (file.name || '').toLowerCase();
    return ACCEPTED_EXTENSIONS.some(ext => name.endsWith(ext));
  }, []);

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy'; // Required in some browsers to allow drop
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only clear drag state if we're actually leaving the drop zone (not entering a child)
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (relatedTarget == null || !e.currentTarget.contains(relatedTarget)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter(isAcceptedFile);
    if (droppedFiles.length === 0) return;
    // Add files to pending state instead of uploading immediately
    setPendingFiles(prev => [...prev, ...droppedFiles]);
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    // Add files to pending state instead of uploading immediately
    setPendingFiles(prev => [...prev, ...selectedFiles]);
    // Reset input to allow re-selecting same file
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUploadAreaClick = () => {
    fileInputRef.current?.click();
  };

  // Remove a single uploading placeholder (e.g. when one upload completes or hits duplicate)
  const removeUploadingPlaceholder = useCallback((placeholderId: string) => {
    setUploadingPlaceholders((prev) => prev.filter((p) => p.id !== placeholderId));
  }, []);

  // Handle uploading all pending files: keep same list visible with inline loading, then refresh doc list and clear in one go
  const handleUploadPendingFiles = async () => {
    if (pendingFiles.length === 0) return;

    const filesToUpload = [...pendingFiles];

    // (1) Keep files in place: mark them as uploading (spinner) instead of clearing the list
    setSelectedPendingFileIndex(null);
    setOutlinedPendingFileIndex(null);
    setShowPropertySelector(false);
    setUploadingFileKeys(new Set(filesToUpload.map((f) => getPendingFileKey(f))));

    // (2) Process all uploads in parallel (no full-page loading spinner); collect document IDs for processing tracking
    const uploadResults = await Promise.all(
      filesToUpload.map((file) =>
        handleFileUpload(file, undefined).then(
          (documentId) => ({ ok: true as const, documentId }),
          () => ({ ok: false as const, documentId: undefined })
        )
      )
    );
    const successCount = uploadResults.filter((r) => r.ok).length;
    const uploadedDocumentIds = uploadResults
      .filter((r): r is { ok: true; documentId: string } => r.ok && !!r.documentId)
      .map((r) => r.documentId);

    // (3) Refresh document list first, then clear pending/uploading; keep spinner until docs finish processing
    const uploadCacheKey =
      viewMode === 'property' && selectedPropertyId ? `property_${selectedPropertyId}` : 'global';
    documentCacheRef.current.delete(uploadCacheKey);
    cacheTimestampRef.current.delete(uploadCacheKey);
    if (viewMode === 'property' && selectedPropertyId) {
      const response = await backendApi.getPropertyHubDocuments(selectedPropertyId);
      if (response.success && response.data) {
        let docs: Document[] = [];
        const data = response.data;
        if (Array.isArray(data)) docs = data;
        else if (data?.data?.documents && Array.isArray(data.data.documents)) docs = data.data.documents;
        else if (data?.data && Array.isArray(data.data)) docs = data.data;
        else if (Array.isArray(data?.documents)) docs = data.documents;
        else if (data?.documents && Array.isArray(data.documents)) docs = data.documents;
        setDocuments(docs);
        documentCacheRef.current.set(uploadCacheKey, docs);
        cacheTimestampRef.current.set(uploadCacheKey, Date.now());
      }
    } else {
      const response = await backendApi.getAllDocuments();
      const docs = parseAllDocumentsResponse(response);
      if (response.success) {
        setDocuments(docs);
        documentCacheRef.current.set(uploadCacheKey, docs);
        cacheTimestampRef.current.set(uploadCacheKey, Date.now());
      }
    }

    // Refresh document/page stats after upload
    try {
      const statsRes = await backendApi.getDocumentStats();
      if (statsRes.success && statsRes.data) setDocStats(statsRes.data);
    } catch (_) {}

    setPendingFiles([]);
    setUploadingFileKeys(new Set());
    setUploadingPlaceholders([]);
    setSelectedPropertyForUpload(null);
    // Keep sidebar spinner until these docs reach completed/failed (polling + effect will clear processingDocumentIds)
    if (uploadedDocumentIds.length > 0) {
      setProcessingDocumentIds((prev) => {
        const next = new Set(prev);
        uploadedDocumentIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  // Remove a file from pending list
  const handleRemovePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
    setSelectedPendingFileIndex(prev => {
      if (prev === null) return null;
      if (prev === index) return null;
      if (prev > index) return prev - 1;
      return prev;
    });
    setOutlinedPendingFileIndex(prev => {
      if (prev === null) return null;
      if (prev === index) return null;
      if (prev > index) return prev - 1;
      return prev;
    });
  };

  // Handle file upload with duplicate checking. placeholderId: when in batch upload, remove from uploading list on done/duplicate.
  // Returns document_id on success so caller can track processing.
  const handleFileUpload = async (file: File, placeholderId?: string): Promise<string | undefined> => {
    try {
      // Check for duplicates first
      const duplicateCheck = await backendApi.checkDuplicateDocument(file.name, file.size);

      if (duplicateCheck.success && duplicateCheck.data) {
        const { is_duplicate, is_exact_duplicate, existing_document, existing_documents } = duplicateCheck.data;

        if (is_duplicate) {
          if (placeholderId) removeUploadingPlaceholder(placeholderId);
          setDuplicateDialog({
            isOpen: true,
            filename: file.name,
            fileSize: file.size,
            existingDocuments: existing_documents || (existing_document ? [existing_document] : []),
            file: file,
            isExactDuplicate: is_exact_duplicate || false
          });
          return undefined;
        }
      }

      // No duplicate - proceed with upload
      return await proceedWithUpload(file, placeholderId);
    } catch (error) {
      console.error('Error checking for duplicate:', error);
      return await proceedWithUpload(file, placeholderId);
    }
  };

  // Proceed with actual upload. placeholderId: when in batch upload, remove from uploading list when done.
  // Returns document_id on success so caller can track processing.
  const proceedWithUpload = async (file: File, placeholderId?: string): Promise<string | undefined> => {
    try {
      setError(null);

      // Check access level if uploading to a property
      if (selectedPropertyForUpload?.type === 'property' && !canUploadToProperty()) {
        setError('You do not have permission to upload files. Only editors and owners can upload files to this property.');
        if (placeholderId) removeUploadingPlaceholder(placeholderId);
        return undefined;
      }

      // Dispatch upload start event for global progress bar
      uploadEvents.start(file.name);

      let result: { success: boolean; data?: { document_id?: string }; error?: string };
      if (selectedPropertyForUpload) {
        if (selectedPropertyForUpload.type === 'property') {
          result = await backendApi.uploadPropertyDocumentViaProxy(
            file,
            { property_id: selectedPropertyForUpload.id },
            (progress) => {
              uploadEvents.progress(progress, file.name);
            }
          );
        } else if (selectedPropertyForUpload.type === 'folder') {
          result = await backendApi.uploadDocument(file, (progress) => {
            uploadEvents.progress(progress, file.name);
          });
          if (result.success && result.data?.document_id) {
            try {
              await backendApi.moveDocument(result.data.document_id, selectedPropertyForUpload.id);
            } catch (error) {
              console.error('Failed to move document to folder:', error);
            }
          }
        } else {
          result = { success: false };
        }
      } else {
        result = await backendApi.uploadDocument(file, (progress) => {
          uploadEvents.progress(progress, file.name);
        });
      }

      if (result.success) {
        const documentId = result.data?.document_id;
        uploadEvents.complete(file.name, documentId);
        if (placeholderId) removeUploadingPlaceholder(placeholderId);
        // Batch upload refreshes list in handleUploadPendingFiles; single-file upload refreshes here
        if (!placeholderId) {
          const uploadCacheKey =
            viewMode === 'property' && selectedPropertyId ? `property_${selectedPropertyId}` : 'global';
          documentCacheRef.current.delete(uploadCacheKey);
          cacheTimestampRef.current.delete(uploadCacheKey);
          if (viewMode === 'property' && selectedPropertyId) {
            const response = await backendApi.getPropertyHubDocuments(selectedPropertyId);
            if (response.success && response.data) {
              let docs: Document[] = [];
              const data = response.data;
              if (Array.isArray(data)) docs = data;
              else if (data?.data?.documents && Array.isArray(data.data.documents)) docs = data.data.documents;
              else if (data?.data && Array.isArray(data.data)) docs = data.data;
              else if (Array.isArray(data?.documents)) docs = data.documents;
              else if (data?.documents && Array.isArray(data.documents)) docs = data.documents;
              setDocuments(docs);
              documentCacheRef.current.set(uploadCacheKey, docs);
              cacheTimestampRef.current.set(uploadCacheKey, Date.now());
            }
          } else {
            const response = await backendApi.getAllDocuments();
            const docs = parseAllDocumentsResponse(response);
            if (response.success) {
              setDocuments(docs);
              documentCacheRef.current.set(uploadCacheKey, docs);
              cacheTimestampRef.current.set(uploadCacheKey, Date.now());
            }
          }
        }
        setDuplicateDialog({ isOpen: false, filename: '', fileSize: 0, existingDocuments: [], file: null, isExactDuplicate: false });
        return documentId;
      } else {
        if (placeholderId) removeUploadingPlaceholder(placeholderId);
        if (result.error && (result.error.includes('already exists') || result.error.includes('duplicate'))) {
          uploadEvents.error(file.name, 'Document already exists');
          setDuplicateDialog({
            isOpen: true,
            filename: file.name,
            fileSize: file.size,
            existingDocuments: [],
            file: null,
            isExactDuplicate: true
          });
        } else {
          uploadEvents.error(file.name, result.error || 'Upload failed');
          setError(result.error || 'Upload failed');
        }
        return undefined;
      }
    } catch (error) {
      console.error('Upload error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      uploadEvents.error(file.name, errorMessage);
      setError(errorMessage);
      if (placeholderId) removeUploadingPlaceholder(placeholderId);
      return undefined;
    }
  };

  // Handle bulk delete (no confirmation needed - user already selected items)
  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return;
    
    const itemsToDelete = Array.from(selectedItems);
    
    // Separate folders and documents
    const folderIds = new Set<string>();
    const documentIds = new Set<string>();
    
    itemsToDelete.forEach(id => {
      if (folders.some(f => f.id === id)) {
        folderIds.add(id);
      } else {
        documentIds.add(id);
      }
    });
    
    // Store documents to delete for potential restoration
    const documentsToDelete = documents.filter(d => documentIds.has(d.id));
    
    // OPTIMISTIC UPDATE: Delete folders from state immediately
    folderIds.forEach(folderId => {
      const deleteFolderRecursive = (folderId: string, folderList: Folder[]): Folder[] => {
        return folderList.filter(f => {
          if (f.id === folderId) return false;
          if (f.parent_id === folderId) return false;
          return true;
        }).map(f => {
          if (f.parent_id === folderId) {
            return { ...f, parent_id: undefined };
          }
          return f;
        });
      };
      
      setFolders(prev => deleteFolderRecursive(folderId, prev));
      
      const currentStorageKey = viewMode === 'property' && selectedPropertyId
        ? `folders_${selectedPropertyId}_${currentFolderId || 'root'}`
        : `folders_global_${currentFolderId || 'root'}`;
      
      const currentFolders = JSON.parse(localStorage.getItem(currentStorageKey) || '[]');
      const updatedCurrentFolders = deleteFolderRecursive(folderId, currentFolders);
      localStorage.setItem(currentStorageKey, JSON.stringify(updatedCurrentFolders));
      
      const rootStorageKey = viewMode === 'property' && selectedPropertyId
        ? `folders_${selectedPropertyId}_root`
        : `folders_global_root`;
      
      if (rootStorageKey !== currentStorageKey) {
        const rootFolders = JSON.parse(localStorage.getItem(rootStorageKey) || '[]');
        const updatedRootFolders = deleteFolderRecursive(folderId, rootFolders);
        localStorage.setItem(rootStorageKey, JSON.stringify(updatedRootFolders));
      }
      
      if (viewMode === 'global') {
        const allPropertyIds = new Set<string>();
        documents.forEach(doc => {
          const propId = documentToPropertyHubMap.get(doc.id);
          if (propId) allPropertyIds.add(propId);
        });
        
        allPropertyIds.forEach(propId => {
          const propStorageKey = `folders_${propId}_root`;
          const propFolders = JSON.parse(localStorage.getItem(propStorageKey) || '[]');
          const updatedPropFolders = deleteFolderRecursive(folderId, propFolders);
          localStorage.setItem(propStorageKey, JSON.stringify(updatedPropFolders));
        });
      }
      
      if (currentFolderId === folderId) {
        setCurrentFolderId(null);
      }
      
      // Delete from API (async, non-blocking)
      backendApi.deleteFolder(folderId).catch(() => {});
    });
    
    // OPTIMISTIC UPDATE: Delete documents from state immediately
    setDocuments(prev => prev.filter(d => !documentIds.has(d.id)));
    
    // Invalidate cache for current view
    const cacheKey = viewMode === 'property' && selectedPropertyId
      ? `property_${selectedPropertyId}`
      : 'global';
    documentCacheRef.current.delete(cacheKey);
    cacheTimestampRef.current.delete(cacheKey);
    
    // Delete documents via API (async, non-blocking)
    documentIds.forEach(async (docId) => {
      try {
        const response = await backendApi.deleteDocument(docId);
        if (!response.success) {
          // Restore document if deletion failed
          const docToRestore = documentsToDelete.find(d => d.id === docId);
          if (docToRestore) {
            setDocuments(prev => [...prev, docToRestore]);
          }
        }
      } catch (error) {
        console.error('Error deleting document:', error);
        // Restore document if deletion failed
        const docToRestore = documentsToDelete.find(d => d.id === docId);
        if (docToRestore) {
          setDocuments(prev => [...prev, docToRestore]);
        }
      }
    });
    
    clearSelection();
  };

  // Always render to prevent gaps - just position off-screen when closed
  return (
    <>
      {/* Backdrop overlay for click-off functionality */}
      {isOpen && (
        <div
          onClick={closeSidebar}
          className="fixed inset-0 z-[9999]"
          style={{
            backgroundColor: 'transparent',
            pointerEvents: 'auto',
          }}
          aria-hidden="true"
        />
      )}
      <div
          ref={(el) => { if (el) panelElementRef.current = el; }}
          data-filing-sidebar="true"
          className="fixed top-0 h-full flex flex-col z-[100001] min-h-0"
          onClick={(e) => e.stopPropagation()}
          style={{
            height: '100vh',
            maxHeight: '100vh',
            // Match ChatPanel / agent sidebar background for consistent look
            background: '#F2F2EF',
            // Position FilingSidebar at main sidebar edge (parent passes effective width: 12 when collapsed, 56 icons-only, 224 full, 320 expanded)
            // When collapsed: FilingSidebar starts at 12px (after toggle rail)
            // When open (isSmallSidebarMode): FilingSidebar starts at sidebarWidth (56 / 224 / 320)
            left: isOpen 
              ? (sidebarWidth !== undefined 
                ? (isSmallSidebarMode 
                  ? `${sidebarWidth}px` // Not collapsed: start exactly at sidebar edge (224px), covering toggle rail
                  : '12px') // Collapsed: after toggle rail (12px)
                : '224px') // Fallback: sidebar edge (224px)
              : '-1000px', // Move off-screen when closed to prevent gaps
            width: isOpen 
              ? (draggedWidth !== null ? `${Math.max(draggedWidth, 360)}px` : `${Math.max(contextWidth, 360)}px`) // Use context width as default, ensure minimum 360px
              : '360px', // Keep width when closed to prevent layout shift
            // Instant transitions to prevent map showing through gaps
            transition: isResizing ? 'none' : 'left 0s ease-out, width 0s ease-out',
            willChange: isResizing ? 'left, width' : 'auto', // Optimize for performance
            // Force GPU acceleration for smoother rendering
            transform: 'translateZ(0)',
            backfaceVisibility: 'hidden',
            // 3D overhang on right: soft shadow cast right + subtle edge
            boxShadow: '4px 0 10px -2px rgba(0,0,0,0.06), 8px 0 16px -4px rgba(0,0,0,0.03), inset -1px 0 0 rgba(0,0,0,0.04)',
            borderRight: 'none',
            // Extend slightly beyond to ensure full coverage
            minWidth: '360px',
            right: 'auto',
            // Hide pointer events when closed
            pointerEvents: isOpen ? 'auto' : 'none',
            // Visible so right-edge shadow isn't clipped; scroll is on inner content
            overflow: 'visible',
          }}
        >
        {/* Header - Unified Design */}
        <div className="px-4 pt-4 pb-1 border-b border-gray-100 w-full" style={{ boxSizing: 'border-box' }}>
          {/* Close Button - same container/styling as SideChatPanel close (hidden in chat; close is in View dropdown) */}
          <div className="flex items-center space-x-2 min-w-0 justify-end mb-3 min-h-[2rem] mr-3">
            {!hideCloseButton ? (
              <button
                onClick={closeSidebar}
                className="flex items-center gap-1.5 rounded-sm hover:bg-[#f0f0f0] active:bg-[#e8e8e8] transition-all duration-150 flex-shrink-0"
                aria-label="Close Files"
                title="Close Files"
                type="button"
                style={{
                  padding: '7px 11px',
                  height: '32px',
                  minHeight: '32px',
                  position: 'relative',
                  pointerEvents: 'auto',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: 'rgba(0, 0, 0, 0.02)'
                }}
              >
                <span className="text-[13px] font-normal text-[#666]">Close</span>
              </button>
            ) : null}
          </div>

          {/* Drag and Drop Upload Area */}
          <div className="px-4">
            <div
              onDragOver={handleDragOver}
              onDragLeave={(e) => { handleDragLeave(e); setShowSecureInfo(false); }}
              onDrop={handleDrop}
              onClick={handleUploadAreaClick}
              onMouseLeave={() => setShowSecureInfo(false)}
              className={`relative cursor-pointer select-none transition-all duration-150 ease-out w-full overflow-hidden
                hover:bg-gray-50/40 active:scale-[0.99] active:opacity-95 active:bg-gray-100/50
                ${isDragOver ? 'opacity-90' : ''} ${pendingFiles.length > 0 ? 'mb-0' : 'mb-4'}`}
              style={{
                border: '2px dotted #D1D5DB',
                borderRadius: pendingFiles.length > 0 ? '8px 8px 0 0' : '8px'
              }}
            >
              {/* Blur overlay + centered Secure File Uploads card when (i) is hovered */}
              {showSecureInfo && (
                <div
                  className="absolute inset-0 z-[5] flex items-center justify-center p-4"
                  style={{ backgroundColor: '#F3F4F6' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    className="overflow-hidden flex-shrink-0"
                    style={{
                      border: '2px dotted #D1D5DB',
                      borderRadius: '8px',
                      backgroundColor: '#F9FAFB',
                      lineHeight: 0,
                    }}
                  >
                    <img
                      src="/(info)upload.png"
                      alt="Secure file uploads – Velora uses AWS S3 for secure file encryption (AES-256)"
                      className="block w-full h-auto align-bottom"
                      style={{ width: '260px', height: 'auto', display: 'block', objectFit: 'contain' }}
                    />
                  </div>
                </div>
              )}
              {/* Info icon: hover shows secure uploads overlay */}
              <div
                className="absolute top-2 left-2 z-10"
                onClick={(e) => e.stopPropagation()}
                onMouseEnter={() => setShowSecureInfo(true)}
                onMouseLeave={() => setShowSecureInfo(false)}
              >
                <button
                  type="button"
                  className="flex items-center justify-center w-6 h-6 rounded-full bg-white/90 hover:bg-white border border-gray-200/80 shadow-sm text-gray-500 hover:text-gray-700 transition-colors"
                  aria-label="Secure file uploads info"
                >
                  <Info className="w-3.5 h-3.5" />
                </button>
              </div>
              <img
                src="/upload(1) 2.png"
                alt="Secure file uploads"
                className="block w-full h-auto pointer-events-none rounded-lg"
                style={{
                  width: '100%',
                  height: 'auto',
                  display: 'block',
                  transform: 'scale(1.12) translateY(-18px)',
                  transformOrigin: 'center top',
                }}
              />

            {/* Hidden File Input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".xlsx,.xls,.csv,.pdf,.doc,.docx"
              onChange={handleFileInputChange}
              className="hidden"
            />
            </div>
          </div>

          {/* Pending Files Section - z-[70] so Link-to-property dropdown appears above Search/Actions (z-[60]); scrollable so many files don't push content down */}
          {pendingFiles.length > 0 && (
            <div ref={pendingSectionRef} className="px-4 mb-4 relative z-[70]">
              <div>
                <div className="bg-gray-50 border border-gray-200 border-t-0 rounded-b-lg pl-2 pr-3 py-2 space-y-1 max-h-48 overflow-y-auto filing-pending-files-scroll">
                  <AnimatePresence mode="popLayout">
                    {pendingFiles.map((file, index) => {
                      const fileKey = getPendingFileKey(file);
                      const isUploading = uploadingFileKeys.has(fileKey);
                      return (
                        <PendingFileItem
                          key={fileKey}
                          file={file}
                          index={index}
                          isSelected={selectedPendingFileIndex === index}
                          showOutline={outlinedPendingFileIndex === index}
                          isUploading={isUploading}
                          onSelect={isUploading ? undefined : (idx) => {
                            setSelectedPendingFileIndex(idx);
                            setOutlinedPendingFileIndex(idx);
                          }}
                          onRemove={handleRemovePendingFile}
                          getFileIcon={getFileIcon}
                        />
                      );
                    })}
                  </AnimatePresence>
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-center gap-2 relative" ref={propertySelectorRef}>
                  {/* Property Selector: narrow when just "Link", flex-1 when dropdown selector */}
                  <div className={`relative min-w-0 ${selectedPendingFileIndex === null ? 'w-24 shrink-0' : 'flex-1'}`}>
                    {selectedPendingFileIndex === null ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (pendingFiles.length > 0 && uploadingFileKeys.size === 0) {
                            setSelectedPendingFileIndex(0);
                            setShowPropertySelector(true);
                          }
                        }}
                        disabled={uploadingFileKeys.size > 0}
                        className={`w-full px-3 py-2 border text-xs font-medium rounded-sm flex items-center justify-center gap-2 transition-colors ${
                          pendingFiles.length > 0 && uploadingFileKeys.size === 0
                            ? 'bg-white border-gray-300 text-gray-900 hover:bg-gray-50 cursor-pointer'
                            : 'bg-gray-50 border-gray-200 text-gray-500 cursor-default'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <Link className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>Link</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => setShowPropertySelector(!showPropertySelector)}
                        className="w-full px-3 py-2 bg-white hover:bg-gray-50 border border-gray-300 text-gray-900 text-xs font-medium rounded-sm transition-colors flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <MapPin className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                          <span className="truncate">
                            {selectedPropertyForUpload 
                              ? selectedPropertyForUpload.address 
                              : 'Link to property or folder'}
                          </span>
                        </div>
                        <ChevronDown className={`w-3.5 h-3.5 text-gray-500 flex-shrink-0 transition-transform ${showPropertySelector ? 'rotate-180' : ''}`} />
                      </button>
                    )}
                  </div>
                  
                  {/* Property Dropdown - Full Width */}
                  <AnimatePresence>
                    {showPropertySelector && (
                      <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-[100] left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-sm shadow-lg max-h-64 overflow-hidden"
                      >
                          {/* Search Input */}
                          <div className="p-2 border-b border-gray-200">
                            <div className="relative">
                              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                              <input
                                type="text"
                                placeholder="Search properties..."
                                value={propertySearchQuery}
                                onChange={(e) => setPropertySearchQuery(e.target.value)}
                                className="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-200 rounded-none focus:outline-none focus:ring-1 focus:ring-gray-300"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                          </div>
                          
                          {/* Property and Folder List */}
                          <div className="max-h-48 overflow-y-auto">
                            {/* Properties */}
                            {(() => {
                              const filteredProperties = availableProperties.filter(p => {
                                const address = p?.address || p?.formatted_address || p?.property?.formatted_address || p?.property_details?.property_address || '';
                                return address.toLowerCase().includes(propertySearchQuery.toLowerCase());
                              });
                              const filteredFolders = folders.filter(f => 
                                f.name.toLowerCase().includes(propertySearchQuery.toLowerCase())
                              );
                              
                              return (
                                <>
                                  {filteredProperties.map((property) => {
                                // Extract property ID and address - handle nested structure
                                const propertyId = property?.property?.id || property?.id;
                                const address = property?.address || property?.formatted_address || property?.property?.formatted_address || property?.property_details?.property_address || 'Unknown address';
                                
                                // Count documents for this property
                                const docCount = documents.filter(doc => {
                                  const propId = documentToPropertyHubMap.get(doc.id) || doc.property_id;
                                  return propId === propertyId;
                                }).length;
                                
                                return (
                                  <button
                                    key={`property-${propertyId}`}
                                    onClick={() => {
                                      setSelectedPropertyForUpload({
                                        id: propertyId,
                                        address: address,
                                        type: 'property'
                                      });
                                      setShowPropertySelector(false);
                                      setPropertySearchQuery('');
                                    }}
                                    className={`w-full px-2.5 py-2.5 text-left text-xs hover:bg-gray-50 transition-colors border-b border-gray-100 ${
                                      selectedPropertyForUpload?.id === propertyId && selectedPropertyForUpload?.type === 'property' ? 'bg-blue-50' : ''
                                    }`}
                                  >
                                    <div className="flex items-center gap-2.5">
                                      <span className="w-3.5 h-3.5 flex-shrink-0 block">
                                      <img 
                                        src="/projectsfolder.png" 
                                        alt=""
                                        className="w-full h-full object-contain pointer-events-none"
                                        style={{ display: 'block' }}
                                        draggable={false}
                                      />
                                    </span>
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs font-normal text-gray-900 truncate" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '-0.01em' }}>
                                          {address}
                                        </div>
                                      </div>
                                      <span className="text-xs text-gray-500 flex-shrink-0 font-medium">
                                        {docCount}
                                      </span>
                                    </div>
                                  </button>
                                );
                              })}
                            
                              {/* Folders */}
                              {filteredFolders.map((folder) => (
                                <button
                                  key={`folder-${folder.id}`}
                                  onClick={() => {
                                    setSelectedPropertyForUpload({
                                      id: folder.id,
                                      address: folder.name,
                                      type: 'folder'
                                    });
                                    setShowPropertySelector(false);
                                    setPropertySearchQuery('');
                                  }}
                                  className={`w-full px-3 py-2 text-left text-xs hover:bg-gray-50 transition-colors border-b border-gray-100 ${
                                    selectedPropertyForUpload?.id === folder.id && selectedPropertyForUpload?.type === 'folder' ? 'bg-blue-50' : ''
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5">
                                    <Folder className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                                    <span className="text-xs font-normal text-gray-900 truncate" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '-0.01em' }}>
                                      {folder.name}
                                    </span>
                                  </div>
                                </button>
                              ))}
                                </>
                              );
                            })()}
                            
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  
                  {/* Upload Button - same style as Link; wider when just Link, compact when dropdown selector shown */}
                  <button
                    onClick={handleUploadPendingFiles}
                    disabled={isLoading || uploadingFileKeys.size > 0}
                    className={`py-2 text-xs font-medium rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 ${
                      selectedPendingFileIndex === null ? 'flex-1 min-w-0 px-4' : 'flex-shrink-0 px-3'
                    } bg-white hover:bg-gray-50 border border-gray-300 text-gray-900`}
                  >
                    <Upload className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>Upload</span>
                  </button>
                  {/* Clear - icon only, clears all selected/pending files (disabled while uploading) */}
                  <button
                    type="button"
                    onClick={() => {
                      if (uploadingFileKeys.size > 0) return;
                      setPendingFiles([]);
                      setSelectedPendingFileIndex(null);
                      setShowPropertySelector(false);
                      setSelectedPropertyForUpload(null);
                    }}
                    disabled={uploadingFileKeys.size > 0}
                    className="p-2 rounded-sm border border-gray-300 bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-700 transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Clear selected files"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Search Bar and Actions Row Container - z-[60] so Add dropdown appears above content (z-50); ref for pipeline popup minTop */}
          <div ref={uploadZoneBottomRef} className="w-full px-4 pt-3 pb-3 relative z-[60]" style={{ boxSizing: 'border-box' }}>
            {/* Search Bar */}
            <div className="relative mb-4">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-gray-200 text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
                style={{ borderRadius: '8px', WebkitTapHighlightColor: 'transparent', transition: 'none', boxShadow: 'none' }}
              />
            </div>

            {/* Page usage this month — thin bar + hover popup (replaces doc count) */}
            <div
              className="relative mb-3"
              onMouseEnter={scheduleUsagePopupOpen}
              onMouseLeave={scheduleUsagePopupClose}
            >
              <div
                className={`absolute bottom-full left-0 right-0 mb-2 rounded-md border border-gray-200 bg-white p-2 shadow-lg transition-opacity duration-150 z-[10001] ${usagePopupOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
                style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                onMouseEnter={onUsageBarOrPopupEnter}
                onMouseLeave={scheduleUsagePopupClose}
              >
                {usageLoading ? (
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[12px] font-medium text-gray-900">Your usage</span>
                      <span className="text-[10px] text-gray-400">Loading...</span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-gray-200" />
                  </div>
                ) : usageError ? (
                  <div className="space-y-1.5">
                    <p className="text-[12px] font-medium text-gray-900">Usage</p>
                    <p className="text-[11px] text-gray-500">Unable to load usage.</p>
                    {onNavigateToUsageBilling && (
                      <button
                        onClick={() => { closeSidebar(); onNavigateToUsageBilling(); }}
                        className="w-full py-1 rounded text-[12px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                      >
                        Go to Usage & Billing
                      </button>
                    )}
                  </div>
                ) : usageData ? (
                  (() => {
                    const overAllowance = (usageData.pages_used ?? 0) > (usageData.monthly_limit ?? 0);
                    const percentLabel = overAllowance ? "100%+" : `${Math.round(usageData.usage_percent ?? 0)}%`;
                    const barFill = Math.min((usageData.usage_percent ?? 0) / 100, 1);
                    return (
                  <>
                    <div className="flex justify-between items-center gap-1.5 mb-1">
                      <span className="text-[12px] font-medium text-gray-900">Your usage this period</span>
                      <span className="flex-shrink-0 rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {percentLabel}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-700 mb-1">
                      {(usageData.pages_used ?? 0).toLocaleString()} of {(usageData.monthly_limit ?? 0).toLocaleString()} pages used{overAllowance ? " (over allowance)" : ""}
                    </p>
                    <p className="text-[10px] text-gray-500 mb-1.5">
                      {overAllowance ? "0 pages remaining" : `${(usageData.remaining ?? 0).toLocaleString()} pages remaining`}
                    </p>
                    <div className="flex gap-0.5 h-1 rounded overflow-hidden mb-1.5" aria-hidden>
                      {Array.from({ length: 32 }).map((_, i) => {
                        const fill = (i + 1) / 32 <= barFill;
                        return (
                          <div
                            key={i}
                            className={`flex-1 min-w-0 ${fill ? 'bg-gradient-to-r from-orange-500 to-orange-600' : 'bg-gray-200'}`}
                          />
                        );
                      })}
                    </div>
                    {onNavigateToUsageBilling && (
                      <button
                        onClick={() => { closeSidebar(); onNavigateToUsageBilling(); }}
                        className="w-full py-1 rounded text-[12px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                      >
                        Go to Usage & Billing
                      </button>
                    )}
                  </>
                    ); })()
                ) : null}
              </div>
              <div
                className="flex gap-0.5 h-1.5 rounded overflow-hidden cursor-default"
                aria-label="Page usage this period"
                title="Hover for details"
              >
                {usageLoading ? (
                  <div className="flex-1 h-full rounded bg-gray-200" />
                ) : usageData ? (
                  Array.from({ length: 32 }).map((_, i) => {
                    const barFill = Math.min((usageData.usage_percent ?? 0) / 100, 1);
                    const fill = (i + 1) / 32 <= barFill;
                    return (
                      <div
                        key={i}
                        className={`flex-1 min-w-0 h-full ${fill ? 'bg-gradient-to-r from-orange-500 to-orange-600' : 'bg-gray-200'}`}
                      />
                    );
                  })
                ) : (
                  <div className="flex-1 h-full rounded bg-gray-200" />
                )}
              </div>
            </div>

            {/* Actions Row - Unified Style */}
            <div className="flex items-center gap-2 w-full" style={{ width: '100%', boxSizing: 'border-box' }}>
            {/* View Mode Toggle */}
            <div className="flex items-center gap-0 bg-gray-100 rounded-md p-1">
              <button
                onClick={() => setViewMode('global')}
                className={`text-[11px] font-medium rounded-sm transition-all duration-150 ${
                  viewMode === 'global'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                style={{
                  padding: '5px 8px',
                  height: '26px',
                  minHeight: '26px'
                }}
              >
                All Files
              </button>
              <button
                onClick={() => setViewMode('property')}
                className={`text-[11px] font-medium rounded-sm transition-all duration-150 ${
                  viewMode === 'property'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                style={{
                  padding: '5px 8px',
                  height: '26px',
                  minHeight: '26px'
                }}
              >
                By Project
              </button>
            </div>

            <div className="flex items-center gap-1 ml-auto">
              {/* Selection Mode Toggle Button */}
              <button
                onClick={() => {
                  setIsSelectionMode(!isSelectionMode);
                  if (isSelectionMode) {
                    clearSelection();
                  }
                }}
                className={`flex items-center justify-center gap-1.5 px-2 py-1 rounded-sm transition-all duration-200 ${
                  isSelectionMode 
                    ? 'text-slate-700' 
                    : 'text-slate-600 hover:text-slate-700'
                }`}
                style={{
                  padding: '5px 8px',
                  height: '26px',
                  minHeight: '26px',
                  backgroundColor: isSelectionMode ? '#f1f5f9' : '#FFFFFF',
                  border: isSelectionMode ? '1px solid rgba(148, 163, 184, 0.5)' : '1px solid rgba(203, 213, 225, 0.3)',
                  opacity: 1,
                  backdropFilter: 'none'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = isSelectionMode ? '#e2e8f0' : '#FFFFFF';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = isSelectionMode ? '#f1f5f9' : '#FFFFFF';
                }}
                title={isSelectionMode ? 'Cancel selection mode' : 'Select documents'}
              >
                <MousePointer2 className={`w-3.5 h-3.5 ${isSelectionMode ? 'text-slate-700' : 'text-slate-600'}`} strokeWidth={1.5} />
                <span className="text-[11px]">{isSelectionMode ? 'Done' : 'Select'}</span>
              </button>

              <div className="relative" ref={newMenuRef}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowNewMenu(!showNewMenu);
                  }}
                  className="flex items-center justify-center gap-1.5 px-2 py-1 border border-slate-200/60 hover:border-slate-300/80 rounded-sm transition-all duration-200"
                  style={{
                    padding: '5px 8px',
                    height: '26px',
                    minHeight: '26px',
                    backgroundColor: '#FFFFFF',
                    opacity: 1,
                    backdropFilter: 'none'
                  }}
                  title="Add"
                >
                  <Plus className="w-3.5 h-3.5 text-slate-600" strokeWidth={1.5} />
                  <span className="text-slate-600 text-[11px]">Add</span>
                </button>

              {/* New Menu Popup - Compact style */}
              <AnimatePresence>
                {showNewMenu && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 top-full mt-1 w-36 bg-white rounded-md py-0.5 z-[100]"
                    style={{ boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Folder Option */}
                    <button
                      onClick={async () => {
                        setShowNewMenu(false);
                        await handleCreateFolder();
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-gray-50 transition-colors text-left"
                    >
                      <Folder className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" strokeWidth={1.75} />
                      <span className="text-xs font-medium text-gray-700">New folder</span>
                    </button>

                    <div className="h-px bg-gray-100 my-0.5 mx-2" />

                    {/* Upload Option */}
                    <button
                      onClick={() => {
                        setShowNewMenu(false);
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.multiple = true;
                        input.accept = '*/*';
                        input.onchange = async (e) => {
                          const selectedFiles = Array.from((e.target as HTMLInputElement).files || []);
                          if (selectedFiles.length === 0) return;
                          // Add files to pending state instead of uploading immediately
                          setPendingFiles(prev => [...prev, ...selectedFiles]);
                        };
                        input.click();
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-gray-50 transition-colors text-left"
                    >
                      <Upload className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" strokeWidth={1.75} />
                      <span className="text-xs font-medium text-gray-700">Upload file</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
              </div>
            </div>
          </div>
          </div>
        </div>

        {/* Breadcrumb Navigation */}
        {breadcrumbs.length > 0 && (
          <div className="px-4 py-2 flex items-center gap-2">
            <button
              onClick={handleBack}
              className="flex items-center gap-1 px-2 py-1 text-gray-500 hover:text-gray-700 hover:bg-white/60 rounded-md transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5 rotate-180" strokeWidth={1.75} />
              <span className="text-[12px] font-medium">Back</span>
            </button>
            <span className="text-gray-300">/</span>
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.id}>
                <span className={`text-[12px] ${idx === breadcrumbs.length - 1 ? 'text-gray-700 font-medium' : 'text-gray-500'}`}>
                  {crumb.name}
                </span>
                {idx < breadcrumbs.length - 1 && <span className="text-gray-300">/</span>}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Content Area - Clean Background - relative z-50 so it stacks above the chat panel; min-h-0 so flex child can shrink and scroll; pb-12 on container so initial view shows 17 files (one row hidden until scroll) */}
        <div
          className="flex-1 min-h-0 overflow-y-auto w-full px-4 pb-12 relative z-50 filing-sidebar-main-scroll"
          style={{ boxSizing: 'border-box', WebkitOverflowScrolling: 'touch' }}
        >
          {isLoading ? (
            <div className="flex items-center justify-center w-full min-h-[280px] pt-16 pb-8" aria-label="Loading documents">
              <dotlottie-wc
                src="https://lottie.host/891f46d7-df4a-4f54-b603-f087ba16403d/aDqReJsKPr.lottie"
                style={{ width: 300, height: 300 }}
                autoplay
                loop
              />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-red-500">{error}</div>
            </div>
          ) : filteredItems.folders.length === 0 && filteredItems.documents.length === 0 && uploadingPlaceholders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Files className="w-10 h-10 text-gray-300 mb-3" strokeWidth={1.5} />
              <p className="text-[13px] font-medium text-gray-500 mb-1">No documents</p>
              <p className="text-[12px] text-gray-400 text-center">Upload files or adjust your search</p>
            </div>
          ) : (
            <div className="w-full py-0.5 pb-80" style={{ boxSizing: 'border-box' }}>
              {/* Folders - Premium Container Design */}
              {filteredItems.folders.map((folder) => {
                const isSelected = selectedItems.has(folder.id);
                return (
                <div
                  key={folder.id}
                  onMouseEnter={() => setHoveredItemId(folder.id)}
                  onMouseLeave={() => setHoveredItemId(null)}
                  className={`flex items-center gap-2.5 pl-8 pr-3 py-1.5 w-full cursor-pointer group transition-all duration-200 rounded-md border ${
                    isSelectionMode 
                      ? (isSelected 
                          ? 'bg-gray-100/50 border-gray-300/60 hover:border-gray-400/80' 
                          : 'bg-white border-gray-200/60 hover:border-gray-300/80 hover:bg-gray-50/50')
                      : 'bg-white border-gray-200/60 hover:border-gray-300/80 hover:bg-gray-50/50'
                  }`}
                  onClick={(e) => {
                    if (editingItemId) return;
                    if (isSelectionMode) {
                      e.stopPropagation();
                      toggleItemSelection(folder.id);
                    } else {
                      handleFolderClick(folder.id);
                    }
                  }}
                >
                  {isSelectionMode && (
                    <div className="flex-shrink-0 w-2.5">
                      <motion.div
                        className="relative"
                        initial={false}
                        animate={{
                          scale: isSelected ? 1 : 1,
                        }}
                        transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                      >
                        <div
                          className="flex items-center justify-center"
                          style={{
                            width: '10px',
                            height: '10px',
                            borderRadius: '2px',
                            border: isSelected 
                              ? '1px solid #6b7280' 
                              : '1px solid #D1D5DB',
                            backgroundColor: isSelected ? '#9ca3af' : 'transparent',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {isSelected && (
                            <motion.svg
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0, opacity: 0 }}
                              transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                              width="6"
                              height="6"
                              viewBox="0 0 10 10"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path
                                d="M2 5L4 7L8 3"
                                stroke="white"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </motion.svg>
                          )}
                        </div>
                      </motion.div>
                    </div>
                  )}
                  <Folder className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" strokeWidth={1.75} />
                  <div className="flex-1 min-w-0">
                    {editingItemId === folder.id ? (
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename(folder.id, true);
                          if (e.key === 'Escape') {
                            setEditingItemId(null);
                            setEditingName('');
                          }
                        }}
                        onBlur={() => handleSaveRename(folder.id, true)}
                        className="w-full px-2 py-1 border border-blue-500 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
                        style={{ fontSize: `${12 * FILING_SIDEBAR_FILE_SCALE}px` }}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div className="font-normal text-gray-900 truncate" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '-0.01em', fontSize: `${12 * FILING_SIDEBAR_FILE_SCALE}px` }}>
                        {folder.name}
                      </div>
                    )}
                  </div>
                  {!editingItemId && (
                    <>
                      <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0" strokeWidth={1.75} />
                      {hoveredItemId === folder.id && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleContextMenuClick(e, folder.id);
                          }}
                          className="p-0.5 hover:bg-gray-100 rounded flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-150"
                        >
                          <MoreVertical className="w-3 h-3 text-gray-400" strokeWidth={1.5} />
                        </button>
                      )}
                    </>
                  )}
                </div>
                );
              })}

              {/* Files - Grouped by property in property view - pr-8 keeps property header narrow */}
              {viewMode === 'property' && groupedDocumentsByProperty && !currentFolderId ? (
                <div className="pr-8 w-full" style={{ boxSizing: 'border-box' }}>
                {/* Uploading placeholders at top so user sees them uploading */}
                {uploadingPlaceholders.length > 0 && (
                  <div className="px-0 mb-0.5">
                    <div className="px-4 py-2 ml-4 mr-8 rounded-md border bg-gray-50/80 border-gray-200/60 flex items-center gap-2.5">
                      <OrbitProgress color="#22c55e" size="small" dense text="" textColor="" speedPlus={1} style={{ fontSize: '2px' }} />
                      <span className="font-medium text-gray-600" style={{ fontSize: `${12 * FILING_SIDEBAR_FILE_SCALE}px` }}>Uploading</span>
                    </div>
                    <div className="py-0.5 w-full" style={{ boxSizing: 'border-box' }}>
                      {uploadingPlaceholders.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center gap-2.5 pl-3 pr-3 py-1.5 ml-4 mr-8 bg-white border border-gray-200/60 rounded-md"
                        >
                          <div className="flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center">
                            <OrbitProgress color="#22c55e" size="small" dense text="" textColor="" speedPlus={1} style={{ fontSize: '2px' }} />
                          </div>
                          <div className="flex-1 min-w-0 font-normal text-gray-700 truncate" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '-0.01em', fontSize: `${12 * FILING_SIDEBAR_FILE_SCALE}px` }}>
                            {p.name}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {groupedDocumentsByProperty.map(({ propertyId, propertyAddress, documents: propertyDocs }) => {
                  const isExpanded = expandedProperties.has(propertyId);
                  const anyExpanded = expandedProperties.size > 0;
                  // When a property is expanded, hide other (collapsed) property containers; only show expanded one(s)
                  if (anyExpanded && !isExpanded) return null;
                  
                  // Skip rendering sections that don't have a valid property address
                  // (These are documents not associated with any property card)
                  if (propertyAddress === 'Unknown Property' || propertyAddress.startsWith('Property ')) {
                    return null;
                  }
                  
                  return (
                    <div key={propertyId} className="px-0 mb-0.5">
                      {/* Property Section Header - inset (ml-4 mr-8) so file rows below can be full width */}
                      <div 
                        onClick={() => togglePropertyExpansion(propertyId)}
                        className={`px-4 py-2 ml-4 mr-8 cursor-pointer transition-all duration-200 rounded-md border flex items-center gap-2.5 w-full ${
                          isExpanded 
                            ? 'bg-gray-50 border-gray-200/60' 
                            : 'bg-white border-gray-200/60 hover:border-gray-300/80 hover:bg-gray-50/50'
                        }`}
                      >
                        <ChevronRight 
                          className={`w-3 h-3 text-gray-400 flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                          strokeWidth={1.75}
                        />
                        <span className="w-5 h-5 flex-shrink-0 block">
                          <img 
                            src="/projectsfolder.png" 
                            alt=""
                            className="w-full h-full object-contain pointer-events-none"
                            style={{ display: 'block' }}
                            draggable={false}
                          />
                        </span>
                        <div className="flex-1 min-w-0">
                          {propertyAddress && 
                           !propertyAddress.startsWith('Property ') && 
                           propertyAddress !== 'Unknown Property' && (
                            <div className="font-normal text-gray-900 truncate" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '-0.01em', fontSize: `${12 * FILING_SIDEBAR_FILE_SCALE}px` }}>
                              {propertyAddress}
                            </div>
                          )}
                        </div>
                        <span className="text-gray-500 flex-shrink-0 font-medium" style={{ fontSize: `${12 * FILING_SIDEBAR_FILE_SCALE}px` }}>
                          {propertyDocs.length}
                        </span>
                      </div>
                      {/* Documents in this property - ml-4 mr-8 matches property header width exactly (no layout change to list/header) */}
                      {isExpanded && (
                        <div className="py-0.5 w-full" style={{ boxSizing: 'border-box' }}>
                          {propertyDocs.map((doc) => {
                            const isLinked = isDocumentLinked(doc);
                            const isSelected = selectedItems.has(doc.id);
                            const isOpenInFileView = openFileViewDocumentId === doc.id;
                            const isHoveredDoc = hoveredPipelineDoc?.doc?.id === doc.id;
                            const progressForThisDoc = isHoveredDoc ? pipelineProgress : null;
                            const { completedStages: completedStagesForDoc } = mapPipelineProgressToStages(progressForThisDoc, doc.status);
                            const isRecentlyCreated = doc.created_at && (Date.now() - new Date(doc.created_at).getTime() <= 60000);
                            const showAsComplete = (doc.status === 'completed' && !isRecentlyCreated) || reprocessedDocs.has(doc.id);
                            const isRecentlyUploaded = doc.status === 'uploaded' && doc.created_at && (Date.now() - new Date(doc.created_at).getTime() <= 60000);
                            const showLoadingIndicator = doc.status === 'processing' || isRecentlyUploaded || (doc.status === 'completed' && isRecentlyCreated);

                            return (
                              <div
                                key={doc.id}
                                draggable={!isSelectionMode && !editingItemId}
                                onDragStart={(e) => {
                                  if (!isSelectionMode && !editingItemId) {
                                    handleDragStart(e, doc);
                                  }
                                }}
                                onMouseEnter={() => {
                                  setHoveredItemId(doc.id);
                                  if (onOpenFileView) scheduleHoverPreload(doc);
                                }}
                                onMouseLeave={() => {
                                  setHoveredItemId(null);
                                  cancelHoverPreload();
                                }}
                                className={`flex items-center gap-2.5 pl-3 pr-3 py-1.5 ml-4 mr-8 cursor-pointer group rounded-md border transition-[transform,background-color,border-color] duration-150 ease-out active:scale-[0.99] ${
                                  isSelectionMode 
                                    ? (isSelected 
                                        ? 'bg-gray-100/50 border-gray-300/60 hover:bg-blue-50/90 hover:border-blue-200/70' 
                                        : 'bg-white border-gray-200/60 hover:bg-blue-50/90 hover:border-blue-200/70')
                                    : isOpenInFileView
                                      ? 'bg-blue-50/60 border-blue-200/50 hover:bg-blue-100/70 hover:border-blue-300/60 active:bg-blue-100/80'
                                      : 'bg-white border-gray-200/60 hover:bg-blue-50/90 hover:border-blue-200/70 active:bg-blue-50'
                                }`}
                                onClick={(e) => {
                                  if (editingItemId) return;
                                  if (isSelectionMode) {
                                    e.stopPropagation();
                                    toggleItemSelection(doc.id);
                                  } else {
                                    setSelectedDocumentId(doc.id);
                                    if (onOpenFileView) {
                                      onOpenFileView(doc);
                                    } else {
                                      handleDocumentClick(doc);
                                    }
                                  }
                                }}
                              >
                                {isSelectionMode && (
                                  <div className="flex-shrink-0 w-2.5">
                                    <motion.div
                                      className="relative"
                                      initial={false}
                                      animate={{
                                        scale: isSelected ? 1 : 1,
                                      }}
                                      transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                                    >
                                      <div
                                        className="flex items-center justify-center"
                                        style={{
                                          width: '10px',
                                          height: '10px',
                                          borderRadius: '2px',
                                          border: isSelected 
                                            ? '1px solid #6b7280' 
                                            : '1px solid #D1D5DB',
                                          backgroundColor: isSelected ? '#9ca3af' : 'transparent',
                                          transition: 'all 0.15s ease',
                                        }}
                                      >
                                        {isSelected && (
                                          <motion.svg
                                            initial={{ scale: 0, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            exit={{ scale: 0, opacity: 0 }}
                                            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                                            width="6"
                                            height="6"
                                            viewBox="0 0 10 10"
                                            fill="none"
                                            xmlns="http://www.w3.org/2000/svg"
                                          >
                                            <path
                                              d="M2 5L4 7L8 3"
                                              stroke="white"
                                              strokeWidth="1.5"
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                            />
                                          </motion.svg>
                                        )}
                                      </div>
                                    </motion.div>
                                  </div>
                                )}
                                <div className="flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center">{getFileIcon(doc)}</div>
                                <div className="flex-1 min-w-0">
                                  {editingItemId === doc.id ? (
                                    <input
                                      type="text"
                                      value={editingName}
                                      onChange={(e) => setEditingName(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSaveRename(doc.id, false);
                                        if (e.key === 'Escape') {
                                          setEditingItemId(null);
                                          setEditingName('');
                                        }
                                      }}
                                      onBlur={() => handleSaveRename(doc.id, false)}
                                      className="w-full px-2 py-1 border border-blue-500 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
                                      style={{ fontSize: `${12 * FILING_SIDEBAR_FILE_SCALE}px` }}
                                      autoFocus
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  ) : (
                                    <div className="font-normal text-gray-900 truncate" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '-0.01em', fontSize: `${12 * FILING_SIDEBAR_FILE_SCALE}px` }}>
                                      {doc.original_filename}
                                    </div>
                                  )}
                                </div>
                                {!editingItemId && (
                                  <div className="flex items-center gap-0.5 flex-shrink-0">
                                    {/* Reprocess button / status indicator; hover wrapper for pipeline popup on spinner or tick */}
                                    {(reprocessingDocs.has(doc.id) || doc.status === 'processing' || isRecentlyUploaded || showLoadingIndicator || reprocessedDocs.has(doc.id) || doc.status === 'completed' || showAsComplete) ? (
                                      <div
                                        onMouseEnter={(e) => handlePipelineTriggerMouseEnter(doc, e)}
                                        onMouseLeave={handlePipelineTriggerMouseLeave}
                                        className="flex items-center justify-center w-3 h-3 flex-shrink-0 cursor-default relative z-10 overflow-visible"
                                      >
                                        {!showAsComplete && reprocessingDocs.has(doc.id) ? (
                                          <OrbitProgress color="#22c55e" size="small" dense text="" textColor="" speedPlus={1} style={{ fontSize: '2px' }} />
                                        ) : !showAsComplete && showLoadingIndicator ? (
                                          <OrbitProgress color="#22c55e" size="small" dense text="" textColor="" speedPlus={1} style={{ fontSize: '2px' }} />
                                        ) : (
                                          <span
                                            className="w-1.5 h-1.5 rounded-full bg-green-500/60 flex-shrink-0 block relative z-10"
                                            style={{
                                              boxShadow: '0 0 0 1px rgba(34, 197, 94, 0.1)',
                                            }}
                                            aria-hidden
                                          />
                                        )}
                                      </div>
                                    ) : doc.status === 'failed' ? (
                                      // Failed - same slot size as green so red dot aligns with green
                                      <div className="relative flex items-center justify-center w-3 h-3 flex-shrink-0 cursor-default">
                                        <span
                                          className="w-1.5 h-1.5 rounded-full bg-red-500 block opacity-100 group-hover:opacity-0 transition-opacity duration-150"
                                          style={{ boxShadow: '0 0 0 1px rgba(239, 68, 68, 0.2)' }}
                                          title="Processing failed"
                                          aria-hidden
                                        />
                                        <button
                                          onClick={(e) => handleReprocessDocument(doc, e)}
                                          title="Reprocess document (processing failed)"
                                          className="absolute inset-0 flex items-center justify-center hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                                        >
                                          <RefreshCw className="w-3 h-3 text-red-500" strokeWidth={1.5} />
                                        </button>
                                      </div>
                                    ) : doc.status === 'uploaded' && (!doc.created_at || (Date.now() - new Date(doc.created_at).getTime() > 60000)) ? (
                                      // Stuck (uploaded but not processed for a while) - orange dot; not shown when just uploaded
                                      <div className="relative flex items-center justify-center w-3 h-3 flex-shrink-0 cursor-default">
                                        <span
                                          className="w-1.5 h-1.5 rounded-full bg-amber-500 block opacity-100 group-hover:opacity-0 transition-opacity duration-150"
                                          style={{ boxShadow: '0 0 0 1px rgba(245, 158, 11, 0.2)' }}
                                          title="Not yet processed (stuck)"
                                          aria-hidden
                                        />
                                        <button
                                          onClick={(e) => handleReprocessDocument(doc, e)}
                                          title="Reprocess document (generate embeddings)"
                                          className="absolute inset-0 flex items-center justify-center hover:bg-gray-100 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                                        >
                                          <RefreshCw className="w-3 h-3 text-amber-600" strokeWidth={1.5} />
                                        </button>
                                      </div>
                                    ) : null}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleContextMenuClick(e, doc.id);
                                      }}
                                      className="p-0.5 hover:bg-gray-100 rounded flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-150"
                                    >
                                      <MoreVertical className="w-3 h-3 text-gray-400" strokeWidth={1.5} />
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
              ) : (
                // Flat list for global view or when inside a folder - Premium Design; uploading placeholders at top
                <div className="py-0.5 w-full" style={{ boxSizing: 'border-box' }}>
                  {uploadingPlaceholders.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-2.5 pl-3 pr-3 py-1.5 mx-4 bg-white border border-gray-200/60 rounded-md"
                    >
                      <div className="flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center">
                        <OrbitProgress color="#22c55e" size="small" dense text="" textColor="" speedPlus={1} style={{ fontSize: '2px' }} />
                      </div>
                      <div className="flex-1 min-w-0 font-normal text-gray-700 truncate" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '-0.01em', fontSize: `${12 * FILING_SIDEBAR_FILE_SCALE}px` }}>
                        {p.name}
                      </div>
                    </div>
                  ))}
                  {filteredItems.documents.map((doc) => {
                  const isLinked = isDocumentLinked(doc);
                  const isSelected = selectedItems.has(doc.id);
                  const isOpenInFileView = openFileViewDocumentId === doc.id;
                  const isHoveredDocFlat = hoveredPipelineDoc?.doc?.id === doc.id;
                  const progressForThisDocFlat = isHoveredDocFlat ? pipelineProgress : null;
                  const { completedStages: completedStagesForDocFlat } = mapPipelineProgressToStages(progressForThisDocFlat, doc.status);
                  const isRecentlyCreatedFlat = doc.created_at && (Date.now() - new Date(doc.created_at).getTime() <= 60000);
                  const showAsCompleteFlat = (doc.status === 'completed' && !isRecentlyCreatedFlat) || reprocessedDocs.has(doc.id);
                  const isRecentlyUploadedFlat = doc.status === 'uploaded' && doc.created_at && (Date.now() - new Date(doc.created_at).getTime() <= 60000);
                  const showLoadingIndicatorFlat = doc.status === 'processing' || isRecentlyUploadedFlat || (doc.status === 'completed' && isRecentlyCreatedFlat);

                  return (
                    <div
                      key={doc.id}
                      draggable={!isSelectionMode && !editingItemId}
                      onDragStart={(e) => {
                        if (!isSelectionMode && !editingItemId) {
                          handleDragStart(e, doc);
                        }
                      }}
                      onMouseEnter={() => {
                        setHoveredItemId(doc.id);
                        if (onOpenFileView) scheduleHoverPreload(doc);
                      }}
                      onMouseLeave={() => {
                        setHoveredItemId(null);
                        cancelHoverPreload();
                      }}
                      className={`flex items-center gap-2.5 pl-3 pr-3 py-1.5 mx-4 cursor-pointer group rounded-md border transition-[transform,background-color,border-color] duration-150 ease-out active:scale-[0.99] ${
                        isSelectionMode 
                          ? (isSelected 
                              ? 'bg-gray-100/50 border-gray-300/60 hover:bg-blue-50/90 hover:border-blue-200/70' 
                              : 'bg-white border-gray-200/60 hover:bg-blue-50/90 hover:border-blue-200/70')
                          : isOpenInFileView
                            ? 'bg-blue-50/60 border-blue-200/50 hover:bg-blue-100/70 hover:border-blue-300/60 active:bg-blue-100/80'
                            : 'bg-white border-gray-200/60 hover:bg-blue-50/90 hover:border-blue-200/70 active:bg-blue-50'
                      }`}
                      onClick={(e) => {
                        if (editingItemId) return;
                        if (isSelectionMode) {
                          e.stopPropagation();
                          toggleItemSelection(doc.id);
                        } else {
                          setSelectedDocumentId(doc.id);
                          if (onOpenFileView) {
                            onOpenFileView(doc);
                          } else {
                            handleDocumentClick(doc);
                          }
                        }
                      }}
                    >
                      {isSelectionMode && (
                        <div className="flex-shrink-0 w-2.5">
                          <motion.div
                            className="relative"
                            initial={false}
                            animate={{
                              scale: isSelected ? 1 : 1,
                            }}
                            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                          >
                            <div
                              className="flex items-center justify-center"
                              style={{
                                width: '10px',
                                height: '10px',
                                borderRadius: '2px',
                                border: isSelected 
                                  ? '1px solid #6b7280' 
                                  : '1px solid #D1D5DB',
                                backgroundColor: isSelected ? '#9ca3af' : 'transparent',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              {isSelected && (
                                <motion.svg
                                  initial={{ scale: 0, opacity: 0 }}
                                  animate={{ scale: 1, opacity: 1 }}
                                  exit={{ scale: 0, opacity: 0 }}
                                  transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                                  width="6"
                                  height="6"
                                  viewBox="0 0 10 10"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path
                                    d="M2 5L4 7L8 3"
                                    stroke="white"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </motion.svg>
                              )}
                            </div>
                          </motion.div>
                        </div>
                      )}
                      <div className="flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center">{getFileIcon(doc)}</div>
                      <div className="flex-1 min-w-0">
                        {editingItemId === doc.id ? (
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRename(doc.id, false);
                              if (e.key === 'Escape') {
                                setEditingItemId(null);
                                setEditingName('');
                              }
                            }}
                            onBlur={() => handleSaveRename(doc.id, false)}
                            className="w-full px-2 py-1 border border-blue-500 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
                            style={{ fontSize: `${12 * FILING_SIDEBAR_FILE_SCALE}px` }}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <div className="font-normal text-gray-900 truncate" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '-0.01em', fontSize: `${12 * FILING_SIDEBAR_FILE_SCALE}px` }}>
                            {doc.original_filename}
                          </div>
                        )}
                      </div>
                      {!editingItemId && (
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          {/* Reprocess button / status indicator; hover wrapper for pipeline popup on spinner or tick */}
                          {(reprocessingDocs.has(doc.id) || doc.status === 'processing' || isRecentlyUploadedFlat || showLoadingIndicatorFlat || reprocessedDocs.has(doc.id) || doc.status === 'completed' || showAsCompleteFlat) ? (
                            <div
                              onMouseEnter={(e) => handlePipelineTriggerMouseEnter(doc, e)}
                              onMouseLeave={handlePipelineTriggerMouseLeave}
                              className="flex items-center justify-center w-3 h-3 flex-shrink-0 cursor-default relative z-10 overflow-visible"
                            >
                              {!showAsCompleteFlat && reprocessingDocs.has(doc.id) ? (
                                <OrbitProgress color="#22c55e" size="small" dense text="" textColor="" speedPlus={1} style={{ fontSize: '2px' }} />
                              ) : !showAsCompleteFlat && showLoadingIndicatorFlat ? (
                                <OrbitProgress color="#22c55e" size="small" dense text="" textColor="" speedPlus={1} style={{ fontSize: '2px' }} />
                              ) : (
                                <span
                                  className="w-1.5 h-1.5 rounded-full bg-green-500/60 flex-shrink-0 block relative z-10"
                                  style={{
                                    boxShadow: '0 0 0 1px rgba(34, 197, 94, 0.1)',
                                  }}
                                  aria-hidden
                                />
                              )}
                            </div>
                          ) : doc.status === 'failed' ? (
                            // Failed - same slot size as green so red dot aligns with green
                            <div className="relative flex items-center justify-center w-3 h-3 flex-shrink-0 cursor-default">
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-red-500 block opacity-100 group-hover:opacity-0 transition-opacity duration-150"
                                style={{ boxShadow: '0 0 0 1px rgba(239, 68, 68, 0.2)' }}
                                title="Processing failed"
                                aria-hidden
                              />
                              <button
                                onClick={(e) => handleReprocessDocument(doc, e)}
                                title="Reprocess document (processing failed)"
                                className="absolute inset-0 flex items-center justify-center hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                              >
                                <RefreshCw className="w-3 h-3 text-red-500" strokeWidth={1.5} />
                              </button>
                            </div>
                          ) : doc.status === 'uploaded' && (!doc.created_at || (Date.now() - new Date(doc.created_at).getTime() > 60000)) ? (
                            // Stuck (uploaded but not processed for a while) - orange dot; not shown when just uploaded
                            <div className="relative flex items-center justify-center w-3 h-3 flex-shrink-0 cursor-default">
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-amber-500 block opacity-100 group-hover:opacity-0 transition-opacity duration-150"
                                style={{ boxShadow: '0 0 0 1px rgba(245, 158, 11, 0.2)' }}
                                title="Not yet processed (stuck)"
                                aria-hidden
                              />
                              <button
                                onClick={(e) => handleReprocessDocument(doc, e)}
                                title="Reprocess document (generate embeddings)"
                                className="absolute inset-0 flex items-center justify-center hover:bg-gray-100 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                              >
                                <RefreshCw className="w-3 h-3 text-amber-600" strokeWidth={1.5} />
                              </button>
                            </div>
                          ) : null}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleContextMenuClick(e, doc.id);
                            }}
                            className="p-0.5 hover:bg-gray-100 rounded flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-150"
                          >
                            <MoreVertical className="w-3 h-3 text-gray-400" strokeWidth={1.5} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pipeline stages hover pop-up (portal) */}
        {showPipelinePreview && hoveredPipelineDoc && (() => {
          const doc = hoveredPipelineDoc.doc;
          const isComplete = doc.status === 'completed' || reprocessedDocs.has(doc.id);
          const progressForDoc =
            doc.status === 'processing' || reprocessingDocs.has(doc.id) ? pipelineProgress : null;
          const { completedStages, currentStageIndex } = mapPipelineProgressToStages(
            progressForDoc,
            doc.status
          );
          return (
            <PipelineStagesHoverPreview
              position={pipelinePreviewPosition}
              containerBounds={pipelinePreviewBounds}
              minTop={(() => { const r = uploadZoneBottomRef.current?.getBoundingClientRect(); return r != null ? r.bottom + 8 : undefined; })()}
              completedStages={isComplete ? 5 : completedStages}
              currentStageIndex={isComplete ? null : currentStageIndex}
              isComplete={isComplete}
              documentName={doc.original_filename}
              pipelineProgress={progressForDoc}
              onMouseEnter={handlePipelinePreviewMouseEnter}
              onMouseLeave={handlePipelinePreviewMouseLeave}
            />
          );
        })()}

        {/* Duplicate Confirmation Dialog */}
        <AnimatePresence>
          {duplicateDialog.isOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/5 z-[20000] flex items-center justify-center p-4"
              style={{ backdropFilter: 'none' }}
              onClick={() => setDuplicateDialog({ isOpen: false, filename: '', fileSize: 0, existingDocuments: [], file: null, isExactDuplicate: false })}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-lg shadow-xl border border-gray-200 max-w-md w-full p-6"
              >
                <div className="flex items-start gap-4 mb-4">
                  <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                    duplicateDialog.isExactDuplicate ? 'bg-red-50' : 'bg-amber-50'
                  }`}>
                    <FileText className={`w-5 h-5 ${duplicateDialog.isExactDuplicate ? 'text-red-600' : 'text-amber-600'}`} />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-gray-900 mb-1">
                      {duplicateDialog.isExactDuplicate ? 'Exact Duplicate Found' : 'Document Already Exists'}
                    </h3>
                    <p className="text-xs text-gray-600">
                      {duplicateDialog.isExactDuplicate ? (
                        <>A document with the same name and size already exists: <span className="font-medium">"{duplicateDialog.filename}"</span>. Please rename the file or delete the existing document first.</>
                      ) : (
                        <>A document with the name <span className="font-medium">"{duplicateDialog.filename}"</span> already exists with a different file size.</>
                      )}
                    </p>
                  </div>
                </div>
                
                {duplicateDialog.existingDocuments.length > 0 && (
                  <div className="mb-4 p-3 bg-gray-50 rounded-md space-y-2">
                    <p className="text-xs font-medium text-gray-700 mb-2">Existing document(s):</p>
                    {duplicateDialog.existingDocuments.map((doc, idx) => (
                      <div key={idx} className="text-xs text-gray-600">
                        <span className="font-medium">{doc.original_filename || doc.filename}</span>
                        {' '}• {(doc.file_size / 1024).toFixed(1)} KB
                        {doc.created_at && ` • ${new Date(doc.created_at).toLocaleDateString()}`}
                      </div>
                    ))}
                    <div className="pt-2 border-t border-gray-200 mt-2">
                      <p className="text-xs font-medium text-gray-700 mb-1">New file:</p>
                      <div className="text-xs text-gray-600">
                        <span className="font-medium">{duplicateDialog.filename}</span>
                        {' '}• {(duplicateDialog.fileSize / 1024).toFixed(1)} KB
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={() => setDuplicateDialog({ isOpen: false, filename: '', fileSize: 0, existingDocuments: [], file: null, isExactDuplicate: false })}
                    className="px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 rounded transition-colors"
                  >
                    Cancel
                  </button>
                  {!duplicateDialog.isExactDuplicate && (
                    <button
                      onClick={async () => {
                        if (duplicateDialog.file) {
                          await proceedWithUpload(duplicateDialog.file);
                        }
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-gray-900 hover:bg-gray-800 rounded transition-colors"
                    >
                      Upload Anyway
                    </button>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Context Menu - portaled to body so z-index is above DashboardLayout toggle rail (100002) */}
        {typeof document !== 'undefined' && createPortal(
          <AnimatePresence>
            {openContextMenuId && contextMenuPosition && (
              <motion.div
                ref={contextMenuRef}
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{ duration: 0.12 }}
                className="fixed rounded-md py-0.5 w-max bg-white border border-slate-200"
                style={{
                  left: `${contextMenuPosition.x}px`,
                  top: `${contextMenuPosition.y}px`,
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
                  zIndex: 100003,
                }}
              >
                {(() => {
                  const isFolder = filteredItems.folders.some(f => f.id === openContextMenuId);
                  const item = isFolder 
                    ? filteredItems.folders.find(f => f.id === openContextMenuId)
                    : filteredItems.documents.find(d => d.id === openContextMenuId);
                  const itemName = isFolder ? (item as Folder)?.name : (item as Document)?.original_filename;
                  
                  return (
                    <>
                      <button
                        onClick={() => {
                          if (item) {
                            handleRename(openContextMenuId!, itemName || '', isFolder);
                          }
                        }}
                        className="w-full px-2.5 py-1 text-left text-xs text-slate-700 hover:bg-slate-100 transition-colors"
                      >
                        Rename
                      </button>
                      {!isFolder && (
                        <button
                          onClick={() => {
                            console.log('Move to folder:', openContextMenuId);
                            setOpenContextMenuId(null);
                            setContextMenuPosition(null);
                          }}
                          className="w-full px-2.5 py-1 text-left text-xs text-slate-700 hover:bg-slate-100 transition-colors"
                        >
                          Move to folder
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (openContextMenuId) {
                            handleDeleteClick(openContextMenuId, isFolder);
                          }
                        }}
                        className="w-full px-2.5 py-1 text-left text-xs text-red-600 hover:bg-red-50 transition-colors"
                      >
                        Delete
                      </button>
                    </>
                  );
                })()}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}

        {/* Bulk Actions Bar - at bottom of sidebar */}
        {isSelectionMode && selectedItems.size > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 w-full flex items-center flex-shrink-0" style={{ backgroundColor: '#F2F2EE', boxSizing: 'border-box', minHeight: '32px' }}>
            <div className="flex items-center gap-2 w-full" style={{ width: '100%', boxSizing: 'border-box' }}>
              <span className="text-[10px] font-medium text-gray-600">
                {selectedItems.size} {selectedItems.size === 1 ? 'item' : 'items'} selected
              </span>
              <div className="flex items-center gap-1 ml-auto">
                <motion.button
                  onClick={handleBulkDelete}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="flex items-center justify-center gap-1 px-2 py-1 rounded-sm font-medium text-slate-600 hover:text-slate-700 border border-slate-200/60 hover:border-slate-300/80 transition-all duration-200 flex-shrink-0"
                  style={{
                    padding: '6px 8px',
                    height: '26px',
                    minHeight: '26px',
                    backgroundColor: '#FFFFFF',
                    opacity: 1,
                    backdropFilter: 'none'
                  }}
                  title="Delete selected"
                >
                  <Trash2 className="w-3 h-3 text-red-600" strokeWidth={1.5} />
                  <span className="text-slate-600 text-[10px]">Delete</span>
                </motion.button>
                <motion.button
                  onClick={clearSelection}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="flex items-center justify-center gap-1 px-2 py-1 rounded-sm font-medium text-slate-600 hover:text-slate-700 border border-slate-200/60 hover:border-slate-300/80 transition-all duration-200 flex-shrink-0"
                  style={{
                    padding: '6px 8px',
                    height: '26px',
                    minHeight: '26px',
                    backgroundColor: '#FFFFFF',
                    opacity: 1,
                    backdropFilter: 'none'
                  }}
                  title="Cancel selection"
                >
                  <span className="text-slate-600 text-[10px]">Cancel</span>
                </motion.button>
              </div>
            </div>
          </div>
        )}
        
        {/* Drag handle for resizing from right edge - seamless design */}
        <div
          onMouseDown={handleResizeStart}
          className="group"
          style={{
            position: 'absolute',
            right: '-6px',
            top: 0,
            bottom: 0,
            width: '12px',
            cursor: 'ew-resize',
            zIndex: 50,
            backgroundColor: 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'auto',
          }}
        >
          {/* Subtle hover indicator */}
          <div
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            style={{
              width: '2px',
              height: '100%',
              backgroundColor: 'rgba(156, 163, 175, 0.2)',
              borderRadius: '1px',
            }}
          />
        </div>
        
        {/* Delete Confirmation Pop-up - compact like context menu (same coords as context menu) */}
        {typeof document !== 'undefined' && createPortal(
          <AnimatePresence>
            {deleteConfirmDialog.isOpen && deleteConfirmDialog.position && (
              <motion.div
                ref={deleteConfirmRef}
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{ duration: 0.12 }}
                className="fixed bg-white rounded-md py-0.5 border border-slate-200 min-w-[116px] max-w-[150px]"
                style={{
                  left: `${deleteConfirmDialog.position.x + 30}px`,
                  top: `${deleteConfirmDialog.position.y}px`,
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
                  zIndex: 100004,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-2.5 py-1.5 border-b border-gray-100">
                  <p className="text-xs font-medium text-gray-900">
                    Delete {deleteConfirmDialog.isFolder ? 'folder' : 'file'}?
                  </p>
                  <p className="text-[11px] text-gray-500 truncate mt-0.5">
                    &quot;{deleteConfirmDialog.itemName}&quot;
                  </p>
                  {deleteConfirmDialog.isFolder && (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      All contents will be deleted.
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setDeleteConfirmDialog({ isOpen: false, itemId: null, isFolder: false, itemName: '', position: null });
                  }}
                  className="w-full px-2.5 py-1 text-left text-xs text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>

                <div className="h-px bg-gray-100 my-0.5" />

                <button
                  type="button"
                  onClick={() => {
                    handleDelete();
                  }}
                  className="w-full px-2.5 py-1 text-left text-xs text-red-600 hover:bg-red-50 transition-colors"
                >
                  Delete
                </button>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
      </div>
    </>
  );
};


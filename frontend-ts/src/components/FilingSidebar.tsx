"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Plus, Folder, FolderOpen, FolderSymlink, Files, FileText, File as FileIcon, ChevronRight, MoreVertical, CloudUpload, ChevronDown, RefreshCw, Check, Pause, Zap, Brain } from 'lucide-react';
import OrbitProgress from 'react-loading-indicators/OrbitProgress';
import { useFilingSidebar } from '../contexts/FilingSidebarContext';
import { useUsage } from '../contexts/UsageContext';
import { backendApi } from '../services/backendApi';
import { preloadDocumentBlobs } from '../services/documentBlobCache';
import { preloadThumbnails, getThumbnailSrc, subscribeToThumbnailCache } from '../services/documentThumbnailCache';
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
import { useTheme } from 'next-themes';

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
  /** When provided, file row click opens the File View pop-up with this doc. */
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

// File type label for pending files (matches getFileTypeLabelFromFilename)
const getPendingFileTypeLabel = (filename: string): string => {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'PDF';
  if (lower.endsWith('.doc') || lower.endsWith('.docx')) return 'DOC';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'XLS';
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) return 'PPT';
  if (lower.match(/\.(jpg|jpeg|png|gif|webp)$/)) return 'IMG';
  return 'FILE';
};

// Component for displaying pending file with image preview (same row size as document list items)
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
    <div
      onClick={() => onSelect?.(index)}
      role={onSelect ? 'button' : undefined}
      className={`flex items-center gap-2 px-2 py-1.5 bg-white rounded-lg group cursor-pointer ${showOutline ? 'ring-1 ring-gray-300' : 'hover:bg-[#f5f5f5] active:bg-[#ebebeb]'}`}
    >
      {/* Image preview or file icon — same size as document list (w-5 h-5) */}
      <div className="flex-shrink-0 flex items-center justify-center">
        {isImage && imageUrl ? (
          <div className="w-5 h-5 rounded overflow-hidden bg-gray-100 border border-gray-200 flex items-center justify-center flex-shrink-0">
            <img
              src={imageUrl}
              alt={file.name}
              className="w-full h-full object-cover block"
            />
          </div>
        ) : (
          getFileIcon(mockDoc)
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col min-h-[28px]">
        <span className="text-xs font-medium text-slate-600 truncate" style={{ fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif" }}>
          {file.name}
        </span>
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
          className="p-0.5 -ml-0.5 rounded flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
          title="Remove file"
        >
          <div className="w-4 h-4 flex items-center justify-center">
            <X className="w-4 h-4 text-gray-400" strokeWidth={1.5} aria-hidden />
          </div>
        </button>
      )}
    </div>
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
    setSidebarDocuments,
    openSidebar: openFilingSidebar,
    registerUploadFromChat,
  } = useFilingSidebar();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light' && resolvedTheme !== undefined;
  const filingBg = isDark ? 'hsl(var(--muted))' : '#F2F2EF';
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
  const [addMenuPosition, setAddMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [searchExpanded, setSearchExpanded] = useState(false);
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
  const [, setThumbnailCacheVersion] = useState(0);

  // Re-render when thumbnail cache gains new entries so we switch to blob URLs
  useEffect(() => {
    return subscribeToThumbnailCache(() => setThumbnailCacheVersion((v) => v + 1));
  }, []);

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
  /** Real-time upload progress 0–100 by filename (for placeholder rows) */
  const [uploadProgressByFileName, setUploadProgressByFileName] = useState<Record<string, number>>({});
  /** Keys of pending files currently uploading (same list stays visible with spinner) */
  const [uploadingFileKeys, setUploadingFileKeys] = useState<Set<string>>(new Set());
  const [showMoveDropdown, setShowMoveDropdown] = useState(false);
  const [moveSearchQuery, setMoveSearchQuery] = useState('');
  /** Document IDs we just uploaded; keep sidebar spinner until they reach completed/failed */
  const [processingDocumentIds, setProcessingDocumentIds] = useState<Set<string>>(new Set());
  /** Timestamps when each document ID was added to processingDocumentIds (for timeout) */
  const processingDocumentTimestamps = useRef<Map<string, number>>(new Map());
  /** AbortControllers for in-flight uploads - keyed by placeholderId for batch, or fileName for single */
  const uploadAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  /** Document/page stats (completed docs only). Fetched with document list. */
  const [docStats, setDocStats] = useState<{ document_count: number; total_pages: number } | null>(null);
  /** Extraction mode: 'standard' (fast) or 'deep' (agentic). Only applies to new uploads. */
  const [extractionMode, setExtractionMode] = useState<'standard' | 'deep'>('standard');
  /** Hover state for unselected extraction cards (collapsed → expand on hover). */

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

  // Remove from processingDocumentIds when docs reach a terminal status or after timeout
  const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  useEffect(() => {
    setProcessingDocumentIds((prev) => {
      if (prev.size === 0) return prev;
      const now = Date.now();
      let next: Set<string> | null = null;
      for (const id of prev) {
        const doc = documents.find((d) => d.id === id);
        const isTerminal = doc && (doc.status === 'completed' || doc.status === 'processed' || doc.status === 'failed');
        const addedAt = processingDocumentTimestamps.current.get(id) ?? now;
        const isTimedOut = now - addedAt > PROCESSING_TIMEOUT_MS;
        if (isTerminal || isTimedOut) {
          if (!next) next = new Set(prev);
          next.delete(id);
          processingDocumentTimestamps.current.delete(id);
        }
      }
      return next ?? prev;
    });
  }, [documents]);

  // Poll document list while we have docs still processing so we can clear spinner when done
  useEffect(() => {
    if (processingDocumentIds.size === 0) return;

    // Check if all remaining IDs are already timed out — if so, clear them immediately
    const now = Date.now();
    const allTimedOut = Array.from(processingDocumentIds).every((id) => {
      const addedAt = processingDocumentTimestamps.current.get(id) ?? 0;
      return now - addedAt > PROCESSING_TIMEOUT_MS;
    });
    if (allTimedOut) {
      setProcessingDocumentIds(new Set());
      processingDocumentTimestamps.current.clear();
      return;
    }

    const uploadCacheKey =
      viewMode === 'property' && selectedPropertyId
        ? `property_${selectedPropertyId}`
        : viewMode === 'property'
          ? 'projects'
          : 'global';
    const interval = setInterval(async () => {
      // Force timeout cleanup even if documents haven't changed
      const pollNow = Date.now();
      let anyTimedOut = false;
      for (const id of processingDocumentIds) {
        const addedAt = processingDocumentTimestamps.current.get(id) ?? 0;
        if (pollNow - addedAt > PROCESSING_TIMEOUT_MS) { anyTimedOut = true; break; }
      }
      if (anyTimedOut) {
        setProcessingDocumentIds((prev) => {
          const next = new Set(prev);
          for (const id of prev) {
            const addedAt = processingDocumentTimestamps.current.get(id) ?? 0;
            if (pollNow - addedAt > PROCESSING_TIMEOUT_MS) {
              next.delete(id);
              processingDocumentTimestamps.current.delete(id);
            }
          }
          return next;
        });
      }

      documentCacheRef.current.delete(uploadCacheKey);
      cacheTimestampRef.current.delete(uploadCacheKey);
      const applyDocs = (newDocs: Document[]) => {
        setDocuments((prev) => {
          if (prev.length === 0) return newDocs;
          const prevById = new Map(prev.map((d) => [d.id, d]));
          const newIds = new Set(newDocs.map((d) => d.id));
          const merged = newDocs.map((d) => {
            const existing = prevById.get(d.id);
            if (existing && (existing.status === 'completed' || existing.status === 'processed') && d.status === 'processing') {
              return { ...d, status: existing.status };
            }
            return d;
          });
          for (const id of processingDocumentIds) {
            if (!newIds.has(id)) {
              const existing = prevById.get(id);
              if (existing) merged.push(existing);
            }
          }
          return merged;
        });
      };
      if (viewMode === 'property' && selectedPropertyId) {
        const response = await backendApi.getPropertyHubDocuments(selectedPropertyId);
        let docs: Document[] = [];
        if (response.success && response.data) {
          const d = response.data;
          if (Array.isArray(d)) docs = d;
          else if (d?.data?.documents) docs = d.data.documents;
          else if (d?.documents) docs = d.documents;
        }
        applyDocs(docs);
      } else if (viewMode === 'property') {
        const response = await backendApi.getAllPropertyHubs();
        if (response.success && response.data) {
          const hubs = Array.isArray(response.data) ? response.data : (response.data as any)?.properties || [];
          const docs: Document[] = [];
          hubs.forEach((hub: any) => {
            (hub?.documents || []).forEach((d: any) => {
              if (d?.id) docs.push(d);
            });
          });
          applyDocs(docs);
        }
      } else {
        const response = await backendApi.getAllDocuments();
        const docs = parseAllDocumentsResponse(response);
        if (response.success) applyDocs(docs);
      }
      // Refresh document/page stats when list refreshes (e.g. processing completed)
      try {
        const statsRes = await backendApi.getDocumentStats();
        if (statsRes.success && statsRes.data) setDocStats(statsRes.data);
        window.dispatchEvent(new CustomEvent('usageShouldRefresh'));
      } catch (_) {}
    }, 50);
    return () => clearInterval(interval);
  }, [viewMode, selectedPropertyId, processingDocumentIds.size]);

  // Sync uploading state to context so Sidebar can show spinner until upload + processing are done.
  // Match FilingSidebar file list: show spinner whenever any file is still uploading or processing.
  useEffect(() => {
    const now = Date.now();
    const hasProcessingDocs =
      processingDocumentIds.size > 0 &&
      Array.from(processingDocumentIds).some((id) => {
        const addedAt = processingDocumentTimestamps.current.get(id) ?? now;
        if (now - addedAt > PROCESSING_TIMEOUT_MS) return false;
        const doc = documents.find((d) => d.id === id);
        return !doc || doc.status === 'uploaded' || doc.status === 'processing';
      });
    // Also show sidebar spinner when any document in the list is still processing (same as file row spinner)
    const hasAnyProcessingInList = documents.some(
      (d) => d.status === 'uploaded' || d.status === 'processing'
    );
    const uploading =
      uploadingFileKeys.size > 0 ||
      uploadingPlaceholders.length > 0 ||
      hasProcessingDocs ||
      hasAnyProcessingInList;
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
  /** Pipeline progress per doc (background poll) so inline % is real-time without hovering */
  const [pipelineProgressByDocId, setPipelineProgressByDocId] = useState<Record<string, PipelineProgressData>>({});
  const [showPipelinePreview, setShowPipelinePreview] = useState(false);
  const [pipelinePreviewPosition, setPipelinePreviewPosition] = useState({ x: 0, y: 0 });
  const [pipelinePreviewBounds, setPipelinePreviewBounds] = useState<{ left: number; right: number } | undefined>(undefined);
  const pipelineHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pipelineLeaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pipelinePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const newMenuRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
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

  const { addPreviewFile, openExpandedCardView } = usePreview();

  // Preload blob for a single doc (e.g. on hover) so click opens file popup instantly
  const scheduleHoverPreload = useCallback((doc: Document) => {
    if (hoverPreloadTimeoutRef.current) clearTimeout(hoverPreloadTimeoutRef.current);
    hoverPreloadTimeoutRef.current = setTimeout(() => {
      hoverPreloadTimeoutRef.current = null;
      preloadDocumentBlobs([{ id: doc.id, s3_path: doc.s3_path }]);
    }, 60); // Shorter delay for snappier FileViewModal open
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
          const slice = docs.slice(0, VISIBLE_PRELOAD_COUNT);
          preloadDocumentBlobs(slice.map((d) => ({ id: d.id, s3_path: d.s3_path })));
          void preloadThumbnails(slice);
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
      
      // Generate cache key: property-specific, projects (hub docs only), or global (all docs)
      const cacheKey = viewMode === 'property' && selectedPropertyId
        ? `property_${selectedPropertyId}`
        : viewMode === 'property'
          ? 'projects'
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
          // Project-level folders (no property_id) stored in folders_global_root
          const savedFolders = JSON.parse(localStorage.getItem('folders_global_root') || '[]');
          setFolders(savedFolders.filter((f: Folder) => !f.property_id));
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
        } else if (viewMode === 'property' && !selectedPropertyId) {
          // Projects view (no property selected): only show documents linked to property hubs (document_relationships).
          // Unlinked uploads do NOT appear here—they only show in the Files tab.
          try {
            const response = await backendApi.getAllPropertyHubs();
            if (response.success && response.data) {
              const hubs = Array.isArray(response.data) ? response.data : (response.data as any)?.properties || [];
              const docs: Document[] = [];
              hubs.forEach((hub: any) => {
                (hub?.documents || []).forEach((d: any) => {
                  if (d?.id) docs.push(d);
                });
              });
              documentCacheRef.current.set(cacheKey, docs);
              cacheTimestampRef.current.set(cacheKey, Date.now());
              if (!isCacheValid) {
                setDocuments(docs);
                loadFolders();
                setIsLoading(false);
              }
              try {
                const statsRes = await backendApi.getDocumentStats();
                if (statsRes.success && statsRes.data) setDocStats(statsRes.data);
              } catch (_) {}
            } else if (!isCacheValid) {
              setError(response.error || 'Failed to load projects');
              setDocuments([]);
              setFolders([]);
              setIsLoading(false);
            }
          } catch (err) {
            if (!isCacheValid) {
              setError('Failed to load projects');
              setDocuments([]);
              setFolders([]);
              setIsLoading(false);
            }
          }
        } else {
          // Files view (global): fetch all documents including unlinked uploads
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

  // Sync current document list to context so Searching carousel can rotate through file-sidebar docs
  useEffect(() => {
    setSidebarDocuments(documents.map((d) => ({ id: d.id, original_filename: d.original_filename })));
  }, [documents, setSidebarDocuments]);

  // When sidebar opens with files from the upload overlay, merge them into pending files
  useEffect(() => {
    if (!isOpen || !initialPendingFiles || initialPendingFiles.length === 0) return;
    setPendingFiles((prev) => [...prev, ...initialPendingFiles]);
    setInitialPendingFiles(null);
  }, [isOpen, initialPendingFiles, setInitialPendingFiles]);

  // Fetch property addresses and document-to-property mappings from property hubs
  // Run when in Projects view (even with no documents) so we show property hubs even when empty
  useEffect(() => {
    if (viewMode === 'property' && isOpen) {
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
  }, [viewMode, isOpen, getAllPropertyHubs]);

  // Preload document blobs and thumbnails when sidebar opens so File View and thumbnails load instantly
  useEffect(() => {
    if (!isOpen || documents.length === 0) return;
    const slice = documents.slice(0, 40);
    preloadDocumentBlobs(slice.map((d) => ({ id: d.id, s3_path: d.s3_path })));
    void preloadThumbnails(slice);
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

  // Close new menu when clicking outside (button in newMenuRef; portaled menu in addMenuRef)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const inButton = newMenuRef.current?.contains(target);
      const inMenu = addMenuRef.current?.contains(target);
      if (!inButton && !inMenu) {
        setShowNewMenu(false);
        setAddMenuPosition(null);
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

  // Fetch properties when move project list opens (reuses availableProperties state)
  useEffect(() => {
    if (showMoveDropdown && availableProperties.length === 0) {
      const loadProperties = async () => {
        try {
          const response = await backendApi.getAllPropertyHubs();
          if (response.success && response.data) {
            const properties = Array.isArray(response.data) 
              ? response.data 
              : (response.data as any).properties || [];
            setAvailableProperties(properties);
          }
        } catch (error) {
          console.error('Failed to load properties:', error);
        }
      };
      loadProperties();
    }
  }, [showMoveDropdown]);

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

    // In property view at root: show project-level folders (no property_id).
    // When inside a folder, filter by parent_id.
    if (viewMode === 'property' && !currentFolderId) {
      filteredFolders = folders.filter(f => !f.parent_id && !f.property_id);
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
  // Include all property hubs (from propertyAddresses) so projects show even when they have no documents
  const groupedDocumentsByProperty = useMemo(() => {
    if (viewMode !== 'property' || currentFolderId) {
      // Don't group if not in property view or if inside a folder
      return null;
    }

    const grouped = new Map<string, Document[]>();
    
    // Seed with all property hubs so we show projects even when they have no documents
    propertyAddresses.forEach((address, propertyId) => {
      if (address !== 'Unknown Property' && !address.startsWith('Property ')) {
        grouped.set(propertyId, []);
      }
    });
    
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

  // Get file type icon (same size as FileAttachment chip: w-5 h-5)
  const iconClass = "w-5 h-5 object-contain flex-shrink-0 rounded";
  const getFileIcon = (doc: Document) => {
    const filename = doc.original_filename.toLowerCase();
    if (filename.endsWith('.pdf')) {
      return <img src="/PDF(1).png" alt="PDF" className={iconClass} />;
    }
    if (filename.endsWith('.doc') || filename.endsWith('.docx')) {
      return <img src="/word.png" alt="Word" className={iconClass} />;
    }
    if (filename.endsWith('.xlsx') || filename.endsWith('.xls') || filename.endsWith('.csv')) {
      return <img src="/excel.png" alt="Excel" className={iconClass} />;
    }
    if (filename.endsWith('.pptx') || filename.endsWith('.ppt')) {
      return <img src="/powerpoint.png" alt="PowerPoint" className={iconClass} />;
    }
    if (filename.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      return <FileIcon className="w-5 h-5 text-green-500 flex-shrink-0" aria-hidden />;
    }
    return <FileIcon className="w-5 h-5 text-gray-600 flex-shrink-0" aria-hidden />;
  };

  // Document thumbnail (PDF first page) or type icon - slightly bigger than w-5 h-5
  const thumbSizeClass = "w-10 h-10 object-cover flex-shrink-0 rounded";
  const docTypeIconSmallClass = "w-3 h-3 object-contain flex-shrink-0 rounded-[1px]";
  const getDocTypeIconSmall = (doc: Document) => {
    const filename = doc.original_filename.toLowerCase();
    if (filename.endsWith('.pdf')) return <img src="/PDF(1).png" alt="PDF" className={docTypeIconSmallClass} />;
    if (filename.endsWith('.doc') || filename.endsWith('.docx')) return <img src="/word.png" alt="Word" className={docTypeIconSmallClass} />;
    if (filename.endsWith('.xlsx') || filename.endsWith('.xls') || filename.endsWith('.csv')) return <img src="/excel.png" alt="Excel" className={docTypeIconSmallClass} />;
    if (filename.endsWith('.pptx') || filename.endsWith('.ppt')) return <img src="/powerpoint.png" alt="PowerPoint" className={docTypeIconSmallClass} />;
    if (filename.match(/\.(jpg|jpeg|png|gif|webp)$/i)) return <FileIcon className={`${docTypeIconSmallClass} text-green-500`} aria-hidden />;
    return <FileIcon className={`${docTypeIconSmallClass} text-gray-600`} aria-hidden />;
  };
  const isPdfForThumbnail = (doc: Document) => {
    const f = doc.original_filename?.toLowerCase() || '';
    return f.endsWith('.pdf') && !['.doc', '.docx', '.xlsx', '.xls', '.pptx', '.ppt'].some(ext => f.endsWith(ext));
  };

  // File type label for chip (matches FileAttachment: PDF, DOC, XLS, PPT, etc.)
  const getFileTypeLabelFromFilename = (filename: string): string => {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.pdf')) return 'PDF';
    if (lower.endsWith('.doc') || lower.endsWith('.docx')) return 'DOC';
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) return 'XLS';
    if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) return 'PPT';
    if (lower.match(/\.(jpg|jpeg|png|gif|webp)$/)) return 'IMG';
    return 'FILE';
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

  // Handle document click - open in the 50/50 document preview panel
  const handleDocumentClick = (doc: Document) => {
    openExpandedCardView(doc.id, doc.original_filename || 'Document');
  };

  // Handle drag start for file items
  const handleDragStart = (e: React.DragEvent, doc: Document) => {
    const docAny = doc as Document & { filename?: string };
    const displayName = docAny.original_filename || docAny.filename || 'Document';
    const payload = {
      type: 'filing-sidebar-document',
      documentId: doc.id,
      filename: displayName,
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

  // Context menu handlers - position menu just left of the 3-dots trigger
  const handleContextMenuClick = (e: React.MouseEvent, itemId: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const menuWidth = 132;
    setContextMenuPosition({ x: rect.left - menuWidth, y: rect.top });
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

  // Close sidebar when clicking outside (click-off to close)
  // Exclude Add button + Add menu (portaled to body) so clicking Add or its dropdown doesn't close
  useEffect(() => {
    if (!isOpen || duplicateDialog.isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelElementRef.current?.contains(target)) return;
      if (contextMenuRef.current?.contains(target)) return;
      if (deleteConfirmRef.current?.contains(target)) return;
      if (newMenuRef.current?.contains(target)) return;
      if (addMenuRef.current?.contains(target)) return;
      closeSidebar();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, duplicateDialog.isOpen, closeSidebar]);

  // Handle rename
  const handleRename = (itemId: string, currentName: string, isFolder: boolean) => {
    setEditingItemId(itemId);
    setEditingName(currentName);
    setOpenContextMenuId(null);
    setContextMenuPosition(null);
    // TODO: Implement rename API call
  };

  // Handle create folder (creates in Projects section)
  const handleCreateFolder = async () => {
    try {
      // Switch to Projects view so new folder appears there
      setViewMode('property');

      // Generate a temporary ID
      const tempId = `folder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newFolder: Folder = {
        id: tempId,
        name: 'New Folder',
        document_count: 0,
        parent_id: currentFolderId || undefined,
        property_id: selectedPropertyId ?? undefined,
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
    const fileRow = (e.currentTarget as HTMLElement).closest('.rounded-md');
    if (fileRow) {
      const rect = fileRow.getBoundingClientRect();
      setPipelinePreviewBounds({
        left: rect.left,
        right: typeof window !== 'undefined' ? window.innerWidth - 10 : rect.right + 200,
      });
    } else {
      setPipelinePreviewBounds(undefined);
    }
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
      setPipelinePreviewBounds(undefined);
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

  // Background poll pipeline progress for all processing docs so inline % updates without hovering
  const processingDocIds = useMemo(
    () =>
      documents
        .filter((d) => d.status === 'processing' || reprocessingDocs.has(d.id))
        .map((d) => d.id),
    [documents, reprocessingDocs]
  );
  useEffect(() => {
    if (processingDocIds.length === 0) return;
    const poll = async () => {
      const results = await Promise.all(
        processingDocIds.map((id) =>
          backendApi.getDocumentStatus(id).then((r) => ({
            id,
            success: r.success,
            data: r.data as { status?: string; pipeline_progress?: PipelineProgressData } | undefined,
          }))
        )
      );
      setPipelineProgressByDocId((prev) => {
        const next = { ...prev };
        for (const { id, success, data } of results) {
          if (success && data?.pipeline_progress) {
            next[id] = data.pipeline_progress;
          }
          if (data?.status === 'completed' || data?.status === 'failed') {
            delete next[id];
          }
        }
        return next;
      });
    };
    poll();
    const iv = setInterval(poll, 2500);
    return () => clearInterval(iv);
  }, [processingDocIds.join(',')]);

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

  const handleStopUploads = useCallback(() => {
    const controllers = uploadAbortControllersRef.current;
    controllers.forEach((c) => {
      try { c.abort(); } catch (_) {}
    });
    controllers.clear();
    setUploadingPlaceholders([]);
    setUploadingFileKeys(new Set());
    setUploadProgressByFileName({});
    toast({ description: 'Uploads stopped', duration: 2000 });
  }, []);

  const handleStopSingleUpload = useCallback((placeholderId: string, fileName?: string) => {
    const controller = uploadAbortControllersRef.current.get(placeholderId);
    if (controller) {
      try { controller.abort(); } catch (_) {}
      uploadAbortControllersRef.current.delete(placeholderId);
    }
    setUploadingPlaceholders((prev) => prev.filter((x) => x.id !== placeholderId));
    if (fileName) {
      setUploadProgressByFileName((prev) => {
        const p = { ...prev };
        delete p[fileName];
        return p;
      });
    }
  }, []);

  // Remove a single uploading placeholder (e.g. when one upload completes or hits duplicate)
  const removeUploadingPlaceholder = useCallback((placeholderId: string) => {
    setUploadingPlaceholders((prev) => prev.filter((p) => p.id !== placeholderId));
  }, []);

  // Subscribe to upload events so placeholder rows show real-time progress
  useEffect(() => {
    const onStart = (e: CustomEvent<{ fileName: string }>) => {
      setUploadProgressByFileName((prev) => ({ ...prev, [e.detail.fileName]: 0 }));
    };
    const onProgress = (e: CustomEvent<{ progress: number; fileName: string }>) => {
      setUploadProgressByFileName((prev) => ({ ...prev, [e.detail.fileName]: e.detail.progress }));
    };
    const onComplete = (e: CustomEvent<{ fileName: string }>) => {
      setUploadProgressByFileName((prev) => {
        const next = { ...prev };
        delete next[e.detail.fileName];
        return next;
      });
    };
    const onError = (e: CustomEvent<{ fileName: string }>) => {
      setUploadProgressByFileName((prev) => {
        const next = { ...prev };
        delete next[e.detail.fileName];
        return next;
      });
    };
    window.addEventListener('upload-start', onStart as EventListener);
    window.addEventListener('upload-progress', onProgress as EventListener);
    window.addEventListener('upload-complete', onComplete as EventListener);
    window.addEventListener('upload-error', onError as EventListener);
    return () => {
      window.removeEventListener('upload-start', onStart as EventListener);
      window.removeEventListener('upload-progress', onProgress as EventListener);
      window.removeEventListener('upload-complete', onComplete as EventListener);
      window.removeEventListener('upload-error', onError as EventListener);
    };
  }, []);

  // Register upload-from-chat handler so Add to database routes through sidebar and shows processing
  useEffect(() => {
    const uploadFromChat = async (files: File[]): Promise<{ successCount: number }> => {
      if (files.length === 0) return { successCount: 0 };
      openFilingSidebar();
      const placeholders = files.map((f, i) => ({ id: `chat-${Date.now()}-${i}-${f.name}`, name: f.name }));
      setUploadingPlaceholders((prev) => [...prev, ...placeholders]);
      const uploadedIds: string[] = [];
      let completed = 0;
      let failed = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const placeholderId = placeholders[i].id;
        uploadEvents.start(file.name);
        try {
          const result = await backendApi.uploadDocument(file, (p) => uploadEvents.progress(p, file.name));
          if (result.success && result.data?.document_id) {
            uploadEvents.complete(file.name, result.data.document_id);
            uploadedIds.push(result.data.document_id);
            completed++;
          } else {
            uploadEvents.error(file.name, result.error || 'Upload failed');
            failed++;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Upload failed';
          uploadEvents.error(file.name, msg);
          failed++;
        }
        removeUploadingPlaceholder(placeholderId);
      }
      if (uploadedIds.length > 0) {
        setProcessingDocumentIds((prev) => { const next = new Set(prev); uploadedIds.forEach((id) => next.add(id)); return next; });
        const uploadCacheKey = viewMode === 'property' && selectedPropertyId ? `property_${selectedPropertyId}` : viewMode === 'property' ? 'projects' : 'global';
        documentCacheRef.current.delete(uploadCacheKey);
        cacheTimestampRef.current.delete(uploadCacheKey);
        if (viewMode === 'property' && selectedPropertyId) {
          const res = await backendApi.getPropertyHubDocuments(selectedPropertyId);
          let docs: Document[] = [];
          if (res.success && res.data) {
            const d = res.data;
            if (Array.isArray(d)) docs = d;
            else if (d?.data?.documents) docs = d.data.documents;
            else if (d?.documents) docs = d.documents;
          }
          setDocuments(docs);
          documentCacheRef.current.set(uploadCacheKey, docs);
          cacheTimestampRef.current.set(uploadCacheKey, Date.now());
        } else if (viewMode === 'property') {
          const res = await backendApi.getAllPropertyHubs();
          if (res.success && res.data) {
            const hubs = Array.isArray(res.data) ? res.data : (res.data as any)?.properties || [];
            const docs: Document[] = [];
            hubs.forEach((hub: any) => { (hub?.documents || []).forEach((d: any) => { if (d?.id) docs.push(d); }); });
            setDocuments(docs);
            documentCacheRef.current.set(uploadCacheKey, docs);
            cacheTimestampRef.current.set(uploadCacheKey, Date.now());
          }
        } else {
          const response = await backendApi.getAllDocuments();
          const docs = parseAllDocumentsResponse(response);
          if (response.success) { setDocuments(docs); documentCacheRef.current.set(uploadCacheKey, docs); cacheTimestampRef.current.set(uploadCacheKey, Date.now()); }
        }
        try { const statsRes = await backendApi.getDocumentStats(); if (statsRes.success && statsRes.data) setDocStats(statsRes.data); } catch (_) {}
      }
      if (failed === 0 && completed > 0) {
        toast({ description: completed === 1 ? 'File added to your database.' : `${completed} files added to your database.`, duration: 2500 });
      } else if (failed > 0 && completed > 0) {
        toast({ description: `${completed} uploaded; ${failed} failed.`, variant: 'destructive', duration: 3000 });
      } else if (failed > 0) {
        toast({ description: 'Upload failed.', variant: 'destructive', duration: 3000 });
      }
      return { successCount: completed };
    };
    registerUploadFromChat(uploadFromChat);
    return () => registerUploadFromChat(null);
  }, [openFilingSidebar, removeUploadingPlaceholder, registerUploadFromChat, viewMode, selectedPropertyId]);

  // Handle uploading all pending files: clear drop zone immediately and show uploading state only in file list (at top so visible instantly)
  const handleUploadPendingFiles = async () => {
    if (pendingFiles.length === 0) return;

    const filesToUpload = [...pendingFiles];
    const placeholders = filesToUpload.map((f, i) => ({ id: `pending-${Date.now()}-${i}-${f.name}`, name: f.name }));

    // (1) Clear drop zone and add placeholders in one flush so the list shows loading indicators immediately
    flushSync(() => {
      setUploadingPlaceholders((prev) => [...prev, ...placeholders]);
      setPendingFiles([]);
      setSelectedPendingFileIndex(null);
      setOutlinedPendingFileIndex(null);
      setShowPropertySelector(false);
      setSelectedPropertyForUpload(null);
    });

    // (2) Process all uploads in parallel; each completion removes its placeholder from the list
    const uploadResults = await Promise.all(
      filesToUpload.map((file, i) =>
        handleFileUpload(file, placeholders[i].id).then(
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
      viewMode === 'property' && selectedPropertyId
        ? `property_${selectedPropertyId}`
        : viewMode === 'property'
          ? 'projects'
          : 'global';
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
    } else if (viewMode === 'property') {
      const response = await backendApi.getAllPropertyHubs();
      if (response.success && response.data) {
        const hubs = Array.isArray(response.data) ? response.data : (response.data as any)?.properties || [];
        const docs: Document[] = [];
        hubs.forEach((hub: any) => {
          (hub?.documents || []).forEach((d: any) => {
            if (d?.id) docs.push(d);
          });
        });
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
      const now = Date.now();
      uploadedDocumentIds.forEach((id) => processingDocumentTimestamps.current.set(id, now));
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
    const uploadKey = placeholderId ?? `${file.name}-${file.size}`;
    const controller = new AbortController();
    uploadAbortControllersRef.current.set(uploadKey, controller);

    try {
      setError(null);

      // Check access level if uploading to a property
      if (selectedPropertyForUpload?.type === 'property' && !canUploadToProperty()) {
        setError('You do not have permission to upload files. Only editors and owners can upload files to this property.');
        uploadAbortControllersRef.current.delete(uploadKey);
        if (placeholderId) removeUploadingPlaceholder(placeholderId);
        return undefined;
      }

      // Dispatch upload start event for global progress bar
      uploadEvents.start(file.name);

      const signal = controller.signal;

      let result: { success: boolean; data?: { document_id?: string }; error?: string };
      if (selectedPropertyForUpload) {
        if (selectedPropertyForUpload.type === 'property') {
          result = await backendApi.uploadPropertyDocumentViaProxy(
            file,
            { property_id: selectedPropertyForUpload.id, extraction_mode: extractionMode, signal },
            (progress) => {
              uploadEvents.progress(progress, file.name);
            }
          );
        } else if (selectedPropertyForUpload.type === 'folder') {
          result = await backendApi.uploadDocument(file, (progress) => {
            uploadEvents.progress(progress, file.name);
          }, { extractionMode, signal });
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
        }, { extractionMode, signal });
      }

      uploadAbortControllersRef.current.delete(uploadKey);

      if (result.success) {
        const documentId = result.data?.document_id;
        uploadEvents.complete(file.name, documentId);
        if (placeholderId) removeUploadingPlaceholder(placeholderId);
        // Batch upload refreshes list in handleUploadPendingFiles; single-file upload refreshes here
        if (!placeholderId) {
          const uploadCacheKey =
            viewMode === 'property' && selectedPropertyId
              ? `property_${selectedPropertyId}`
              : viewMode === 'property'
                ? 'projects'
                : 'global';
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
          } else if (viewMode === 'property') {
            const response = await backendApi.getAllPropertyHubs();
            if (response.success && response.data) {
              const hubs = Array.isArray(response.data) ? response.data : (response.data as any)?.properties || [];
              const docs: Document[] = [];
              hubs.forEach((hub: any) => {
                (hub?.documents || []).forEach((d: any) => {
                  if (d?.id) docs.push(d);
                });
              });
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
        if (result.error === 'Upload was aborted') {
          uploadEvents.error(file.name, 'Upload stopped');
          // Don't setError - handleStopUploads already showed toast
        } else if (result.error && (result.error.includes('already exists') || result.error.includes('duplicate'))) {
          uploadEvents.error(file.name, 'Document already exists');
          toast({
            title: 'Duplicate document',
            description: `"${file.name}" already exists.`,
            variant: 'destructive',
            duration: 4000,
          });
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
          toast({
            title: 'Upload failed',
            description: result.error || `Failed to upload ${file.name}`,
            variant: 'destructive',
            duration: 5000,
          });
        }
        return undefined;
      }
    } catch (error) {
      uploadAbortControllersRef.current.delete(uploadKey);
      console.error('Upload error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      uploadEvents.error(file.name, errorMessage);
      setError(errorMessage);
      toast({
        title: 'Upload failed',
        description: errorMessage,
        variant: 'destructive',
        duration: 5000,
      });
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

  const handleBulkMove = async (targetPropertyId: string) => {
    if (selectedItems.size === 0) return;

    const docIds = Array.from(selectedItems).filter(id => !folders.some(f => f.id === id));
    if (docIds.length === 0) return;

    setShowMoveDropdown(false);
    setMoveSearchQuery('');
    clearSelection();
    setIsSelectionMode(false);

    let failedCount = 0;
    await Promise.all(docIds.map(async (docId) => {
      try {
        const response = await backendApi.linkDocumentToProperty(docId, targetPropertyId);
        if (!response.success) failedCount++;
      } catch {
        failedCount++;
      }
    }));

    documentCacheRef.current.clear();
    cacheTimestampRef.current.clear();

    if (failedCount > 0) {
      toast({ title: `Failed to move ${failedCount} file${failedCount > 1 ? 's' : ''}`, variant: 'destructive' });
    } else {
      toast({ title: `Moved ${docIds.length} file${docIds.length > 1 ? 's' : ''} to project` });
    }
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
            background: filingBg,
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
            // 3D overhang on right: soft shadow cast right (no inset line to avoid visible divider)
            boxShadow: '4px 0 10px -2px rgba(0,0,0,0.06), 8px 0 16px -4px rgba(0,0,0,0.03)',
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
        <div className={`px-4 pt-4 pb-1 w-full ${isDark ? '' : 'border-b border-gray-100'}`} style={{ boxSizing: 'border-box' }}>
          {/* Close Button - same container/styling as SideChatPanel close (hidden in chat; close is in View dropdown) */}
          <div className="flex items-center space-x-2 min-w-0 justify-end mb-3 min-h-[2rem] mr-3">
            {!hideCloseButton ? (
              <button
                onClick={closeSidebar}
                className={`flex items-center justify-center p-1.5 rounded-sm transition-opacity duration-150 flex-shrink-0 hover:opacity-70 active:opacity-90 ${isDark ? 'text-slate-300' : 'text-[#374151]'}`}
                aria-label="Close Files"
                title="Close Files"
                type="button"
              >
                <X className="w-4 h-4" strokeWidth={1.5} aria-hidden />
              </button>
            ) : null}
          </div>

          {/* Drag and Drop Upload Area */}
          <div className="px-4">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleUploadAreaClick}
              className={`relative cursor-pointer select-none w-full overflow-hidden
                hover:bg-gray-50/40 active:scale-[0.99] active:opacity-95 active:bg-gray-100/50
                ${pendingFiles.length > 0 ? 'transition-none mb-0' : 'transition-all duration-150 ease-out mb-4'}
                ${isDragOver ? 'opacity-90' : ''}`}
              style={{
                borderRadius: pendingFiles.length > 0 ? '8px 8px 0 0' : '8px'
              }}
            >
              <img
                src="/fileupload3.png"
                alt="Secure file uploads"
                className="block w-full h-auto pointer-events-none rounded-lg"
                style={{
                  width: '100%',
                  height: 'auto',
                  display: 'block',
                  transform: 'scale(1.05)',
                  transformOrigin: 'center center',
                }}
              />
              {/* Overlay to hide "file" and "+" text on the upload graphic (top portion only) */}
              <div
                className="absolute top-0 left-0 right-0 pointer-events-none rounded-t-lg"
                style={{ height: '25%', backgroundColor: '#FFFFFF' }}
                aria-hidden
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
            <div
              ref={pendingSectionRef}
              className="px-4 mb-4 relative z-[70]"
            >
              <div>
                <div className="bg-white rounded-b-lg pl-2 pr-3 py-2 space-y-1 max-h-48 overflow-y-auto filing-pending-files-scroll">
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
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-center gap-2 relative w-full" ref={propertySelectorRef}>
                  {/* Property Selector: always show Link to Project button (no separate Link step) */}
                  <div className="relative min-w-0 w-[180px] shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        if (pendingFiles.length > 0 && uploadingFileKeys.size === 0) {
                          setShowPropertySelector(!showPropertySelector);
                        }
                      }}
                      disabled={uploadingFileKeys.size > 0}
                      className={`w-full h-[40px] px-3 py-2.5 text-xs font-medium rounded-md flex items-center justify-between gap-2 transition-colors ${
                        pendingFiles.length > 0 && uploadingFileKeys.size === 0
                          ? 'bg-white text-slate-600 hover:bg-gray-50 cursor-pointer'
                          : 'bg-gray-50 text-gray-500 cursor-default'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {selectedPropertyForUpload ? (
                          <span className="w-4 h-4 flex-shrink-0 block">
                            <img
                              src="/projectsfolder.png"
                              alt=""
                              className="w-full h-full object-contain pointer-events-none"
                              style={{ display: 'block' }}
                              draggable={false}
                            />
                          </span>
                        ) : (
                          <FolderSymlink className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" aria-hidden />
                        )}
                        <span className="truncate">
                          {selectedPropertyForUpload 
                            ? selectedPropertyForUpload.address 
                            : 'Link to Project'}
                        </span>
                      </div>
                      {selectedPropertyForUpload ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPropertyForUpload(null);
                            setShowPropertySelector(false);
                          }}
                          className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 flex-shrink-0 transition-colors"
                          title="Unselect project"
                          aria-label="Unselect project"
                        >
                          <X className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                        </button>
                      ) : (
                        <ChevronDown className={`w-3.5 h-3.5 text-gray-500 flex-shrink-0 transition-transform ${showPropertySelector ? 'rotate-180' : ''}`} aria-hidden />
                      )}
                    </button>
                  </div>
                  
                  {/* Property Dropdown - Full Width */}
                  {showPropertySelector && (
                    <div
                      className="absolute z-[100] left-0 right-0 top-full mt-3 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-hidden"
                    >
                          {/* Search Input */}
                          <div className="p-2">
                            <div className="relative">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" aria-hidden />
                              <input
                                type="text"
                                placeholder="Search projects..."
                                value={propertySearchQuery}
                                onChange={(e) => setPropertySearchQuery(e.target.value)}
                                className="w-full pl-8 pr-2 py-1.5 text-xs text-gray-900 bg-gray-100 border-0 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-300 focus:bg-gray-100 placeholder:text-gray-500"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                          </div>
                          
                          {/* Property and Folder List */}
                          <div className="max-h-48 overflow-y-auto rounded-b-lg">
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
                                    className={`w-full px-2 py-1 text-left hover:bg-gray-50 transition-colors flex items-center gap-0.5 ${
                                      selectedPropertyForUpload?.id === propertyId && selectedPropertyForUpload?.type === 'property' ? 'bg-gray-200' : ''
                                    }`}
                                  >
                                    <div className="flex-shrink-0 flex items-center justify-center" style={{ width: 48, height: 48 }}>
                                      <img 
                                        src="/projectsfolder.png" 
                                        alt=""
                                        className="w-6 h-6 object-contain pointer-events-none"
                                        style={{ display: 'block' }}
                                        draggable={false}
                                      />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <span className="text-xs font-medium text-slate-600 truncate block" style={{ fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif", letterSpacing: '-0.01em' }}>
                                        {address}
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
                                  className={`w-full px-2 py-1 text-left hover:bg-gray-50 transition-colors flex items-center gap-0.5 ${
                                    selectedPropertyForUpload?.id === folder.id && selectedPropertyForUpload?.type === 'folder' ? 'bg-gray-200' : ''
                                  }`}
                                >
                                  <div className="flex-shrink-0 flex items-center justify-center" style={{ width: 48, height: 48 }}>
                                    <Folder className="w-6 h-6 text-gray-500" strokeWidth={1.75} aria-hidden />
                                  </div>
                                  <span className="flex-1 min-w-0 text-xs font-medium text-slate-600 truncate" style={{ fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif", letterSpacing: '-0.01em' }}>
                                    {folder.name}
                                  </span>
                                </button>
                              ))}
                                </>
                              );
                            })()}
                            
                          </div>
                    </div>
                  )}
                  
                  {/* Upload Button - flex-1 to fill remaining space (Link has fixed width when chosen) */}
                  <button
                    onClick={handleUploadPendingFiles}
                    disabled={isLoading || uploadingFileKeys.size > 0}
                    className="py-2.5 px-3 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 flex-1 min-w-0 bg-white hover:bg-gray-50 text-slate-600 h-[40px]"
                  >
                    <CloudUpload className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
                    <span>Upload</span>
                  </button>
                </div>
                {/* Extraction mode — Cursor-style compact toggle: icon + label + one-line description. Hidden when project selector overlay open. */}
                <div className={`mt-4 flex flex-col gap-1.5 ${showPropertySelector ? 'invisible' : ''}`}>
                  <button
                    type="button"
                    onClick={() => setExtractionMode('standard')}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors border ${
                      extractionMode === 'standard'
                        ? 'bg-white border-slate-200/60'
                        : 'bg-white border-slate-200/40'
                    }`}
                  >
                    <div className={`flex-shrink-0 w-11 h-11 flex items-center justify-center ${
                      extractionMode === 'standard' ? 'text-slate-600' : 'text-slate-500'
                    }`}>
                      <Zap className="w-6 h-6" strokeWidth={1.5} aria-hidden />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-slate-800">Standard</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">Fast extraction for digital docs and typed text</div>
                    </div>
                    {extractionMode === 'standard' && (
                      <Check className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" strokeWidth={2.5} aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setExtractionMode('deep')}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors border ${
                      extractionMode === 'deep'
                        ? 'bg-white border-slate-200/60'
                        : 'bg-white border-slate-200/40'
                    }`}
                  >
                    <div className={`flex-shrink-0 w-11 h-11 flex items-center justify-center ${
                      extractionMode === 'deep' ? 'text-slate-600' : 'text-slate-500'
                    }`}>
                      <Brain className="w-6 h-6" strokeWidth={1.5} aria-hidden />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-slate-800">Deep Extract</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">AI-powered reasoning for handwritten notes and tricky scans</div>
                    </div>
                    {extractionMode === 'deep' && (
                      <Check className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" strokeWidth={2.5} aria-hidden />
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Search and Actions Row Container - hidden when pending files (upload focus mode); matches sidebar colour */}
          <div
            ref={uploadZoneBottomRef}
            className="w-full px-4 pt-3 pb-3 relative z-[60]"
            style={{ boxSizing: 'border-box', display: pendingFiles.length > 0 ? 'none' : undefined, backgroundColor: filingBg }}
          >
            {/* Page usage this month — thin bar + hover popup (replaces doc count) */}
            <div
              className="relative mb-3"
              onMouseEnter={scheduleUsagePopupOpen}
              onMouseLeave={scheduleUsagePopupClose}
            >
              <div
                className={`absolute bottom-full left-0 right-0 mb-2 rounded-md border border-gray-200 bg-white p-2 shadow-lg transition-opacity duration-150 z-[9999] ${usagePopupOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
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
                        className="w-full py-1 rounded text-[12px] font-medium text-white bg-orange-500 hover:bg-orange-600 transition-colors"
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
                    <div className="h-1 w-full rounded-full bg-gray-200 overflow-hidden mb-1.5" aria-hidden>
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-orange-500 to-orange-600 transition-[width] duration-200"
                        style={{ width: `${barFill * 100}%` }}
                      />
                    </div>
                    {onNavigateToUsageBilling && (
                      <button
                        onClick={() => { closeSidebar(); onNavigateToUsageBilling(); }}
                        className="w-full py-1 rounded text-[12px] font-medium text-white bg-orange-500 hover:bg-orange-600 transition-colors"
                      >
                        Go to Usage & Billing
                      </button>
                    )}
                  </>
                    ); })()
                ) : null}
              </div>
              <div
                className="flex items-center gap-2 cursor-default"
                aria-label="Page usage this period"
              >
                <div className="flex-1 min-w-0 h-1.5 rounded-full bg-gray-50 overflow-hidden">
                  {usageLoading ? null : usageData ? (
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-orange-500 to-orange-600 transition-[width] duration-200"
                      style={{ width: `${Math.min((usageData.usage_percent ?? 0) / 100, 1) * 100}%` }}
                    />
                  ) : null}
                </div>
                {usageData && (
                  <span className="flex-shrink-0 text-[10px] font-medium text-gray-400 tabular-nums">
                    {((usageData.pages_used ?? 0) > (usageData.monthly_limit ?? 0) ? '100+' : Math.round(usageData.usage_percent ?? 0))}%
                  </span>
                )}
              </div>
            </div>

            {/* Actions Row - Cursor-like minimal bar; matches sidebar colour in all modes */}
            <div className="flex items-center h-8 w-full min-w-0 overflow-x-hidden overflow-y-visible pl-1 pr-2 py-0 gap-0.5 rounded" style={{ width: '100%', boxSizing: 'border-box', backgroundColor: filingBg }}>
            {searchExpanded ? (
              /* Expanded: search bar fixed width, same height as row; no focus ring */
              <div className="relative w-64 max-w-[18rem] flex-shrink-0 flex items-center h-full rounded bg-white">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600 flex-shrink-0 pointer-events-none" aria-hidden />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search documents..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onBlur={() => { if (!searchQuery.trim()) setSearchExpanded(false); }}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setSearchExpanded(false); e.currentTarget.blur(); } }}
                  className="filing-sidebar-search-input w-full h-full pl-8 pr-8 py-0 bg-transparent text-[12px] leading-none text-gray-900 placeholder:text-gray-400 rounded border-0"
                  style={{ borderRadius: '8px' }}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => { setSearchExpanded(false); if (!searchQuery.trim()) setSearchQuery(''); }}
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 flex items-center justify-center rounded flex-shrink-0"
                  style={{ width: '24px', height: '24px', minWidth: '24px', minHeight: '24px' }}
                  title="Close search"
                >
                  <X className="w-3.5 h-3.5 text-slate-600" strokeWidth={1.5} aria-hidden />
                </button>
              </div>
            ) : (
              <>
            {/* Search Icon - expands inline to replace buttons */}
            <button
              type="button"
              onClick={() => { setSearchExpanded(true); setTimeout(() => searchInputRef.current?.focus(), 0); }}
              className={`flex items-center justify-center flex-shrink-0 p-1 rounded-[3px] hover:opacity-80 transition-opacity ${isDark ? 'text-slate-300' : 'text-[#4B5563]'}`}
              title="Search documents"
            >
              <Search className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden />
            </button>
            {/* Files / Projects tabs - Cursor-like: thin tabs, selected bg; theme-aware text for visibility */}
            {isSelectionMode && selectedItems.size > 0 ? (
              <>
                <motion.button
                  onClick={handleBulkDelete}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="flex items-center justify-center gap-0.5 px-1.5 py-0.5 rounded-[3px] flex-shrink-0 ml-1 text-red-500 hover:opacity-80 transition-opacity"
                  title="Delete selected"
                >
                  <span className="text-[12.5px] font-normal">Delete</span>
                </motion.button>
                <motion.button
                  onClick={() => { clearSelection(); setShowMoveDropdown(false); setMoveSearchQuery(''); }}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className={`flex items-center justify-center px-1.5 py-0.5 rounded-[3px] flex-shrink-0 hover:opacity-80 transition-opacity ${isDark ? 'text-slate-300' : 'text-[#374151]'}`}
                  title="Cancel selection"
                >
                  <span className="text-[12.5px] font-normal">Cancel</span>
                </motion.button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setViewMode('global')}
                  className={`text-[12.5px] font-normal px-1.5 py-0.5 rounded-[3px] flex-shrink-0 ml-1 transition-all duration-75 ${
                    viewMode === 'global'
                      ? isDark ? 'bg-card text-slate-100' : 'bg-white text-[#141413]'
                      : isDark ? 'text-slate-300 hover:opacity-90' : 'text-[#4B5563] hover:opacity-90'
                  }`}
                  style={viewMode === 'global' ? { boxShadow: isDark ? undefined : '0 1px 2px rgba(0, 0, 0, 0.04)' } : undefined}
                >
                  Files
                </button>
                <button
                  onClick={() => setViewMode('property')}
                  className={`text-[12.5px] font-normal px-1.5 py-0.5 rounded-[3px] flex-shrink-0 transition-all duration-75 ${
                    viewMode === 'property'
                      ? isDark ? 'bg-card text-slate-100' : 'bg-white text-[#141413]'
                      : isDark ? 'text-slate-300 hover:opacity-90' : 'text-[#4B5563] hover:opacity-90'
                  }`}
                  style={viewMode === 'property' ? { boxShadow: isDark ? undefined : '0 1px 2px rgba(0, 0, 0, 0.04)' } : undefined}
                >
                  Projects
                </button>
              </>
            )}

            <div className="flex items-center gap-0.5 flex-shrink-0 min-w-0 overflow-visible ml-auto">
              {/* Selection Mode Toggle - Cursor-like */}
              <button
                onClick={() => {
                  setIsSelectionMode(!isSelectionMode);
                  if (isSelectionMode) {
                    clearSelection();
                    setShowMoveDropdown(false);
                    setMoveSearchQuery('');
                  }
                }}
                className={`flex items-center justify-center px-1.5 py-0.5 text-[12.5px] font-normal flex-shrink-0 min-w-0 rounded-[3px] transition-all duration-75 ${
                  isSelectionMode
                    ? isDark ? 'bg-card text-slate-100' : 'bg-white text-[#141413]'
                    : isDark ? 'text-slate-300 hover:opacity-90' : 'text-[#4B5563] hover:opacity-90'
                }`}
                style={isSelectionMode ? { boxShadow: isDark ? undefined : '0 1px 2px rgba(0, 0, 0, 0.04)' } : undefined}
                title={isSelectionMode ? 'Cancel selection mode' : 'Select documents'}
              >
                {isSelectionMode ? 'Done' : 'Select'}
              </button>

              {isSelectionMode && selectedItems.size > 0 ? (
                <div className="flex-shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMoveDropdown(!showMoveDropdown);
                    }}
                    className={`flex items-center justify-center gap-1 px-1.5 py-0.5 text-[12.5px] font-normal min-w-0 rounded-[3px] transition-opacity ${
                      showMoveDropdown ? 'text-blue-400' : isDark ? 'text-slate-300 hover:opacity-90' : 'text-[#4B5563] hover:opacity-90'
                    }`}
                    title="Move to project"
                  >
                    <span>Move</span>
                  </button>
                </div>
              ) : (
              <div className="relative flex-shrink-0 overflow-visible" ref={newMenuRef}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!showNewMenu) {
                      const rect = newMenuRef.current?.getBoundingClientRect();
                      if (rect) {
                        const menuWidth = 144; // w-36
                        setAddMenuPosition({ x: rect.right - menuWidth, y: rect.bottom + 4 });
                      }
                      setShowNewMenu(true);
                    } else {
                      setShowNewMenu(false);
                      setAddMenuPosition(null);
                    }
                  }}
                  className={`flex items-center justify-center gap-1 px-1.5 py-0.5 text-[12.5px] font-normal min-w-0 rounded-[3px] hover:opacity-80 transition-opacity ${isDark ? 'text-slate-300' : 'text-[#4B5563]'}`}
                  title="Add"
                >
                  <Plus className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden />
                  <span>Add</span>
                </button>
              </div>
              )}
            </div>
            </>
            )}
          </div>
          </div>
        </div>

        {/* Add menu - portaled to body so it is never clipped by overflow */}
        {typeof document !== 'undefined' && createPortal(
          <AnimatePresence>
            {showNewMenu && addMenuPosition && (
              <motion.div
                ref={addMenuRef}
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{ duration: 0.12 }}
                className="fixed w-36 bg-white rounded-md py-0.5"
                style={{
                  left: `${addMenuPosition.x}px`,
                  top: `${addMenuPosition.y}px`,
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                  zIndex: 100003,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={async () => {
                    setShowNewMenu(false);
                    setAddMenuPosition(null);
                    await handleCreateFolder();
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-gray-50 transition-colors text-left"
                >
                  <Folder className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className="text-xs font-medium text-gray-700">New folder</span>
                </button>

                <div className="h-px bg-gray-100 my-0.5 mx-2" />

                <button
                  onClick={() => {
                    setShowNewMenu(false);
                    setAddMenuPosition(null);
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.multiple = true;
                    input.accept = '*/*';
                    input.onchange = async (e) => {
                      const selectedFiles = Array.from((e.target as HTMLInputElement).files || []);
                      if (selectedFiles.length === 0) return;
                      setPendingFiles(prev => [...prev, ...selectedFiles]);
                    };
                    input.click();
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-gray-50 transition-colors text-left"
                >
                  <CloudUpload className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className="text-xs font-medium text-gray-700">Upload file</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}

        {/* Breadcrumb Navigation */}
        {breadcrumbs.length > 0 && (
          <div className="px-4 py-2 flex items-center gap-2" style={{ display: pendingFiles.length > 0 ? 'none' : undefined }}>
            <button
              onClick={handleBack}
              className="flex items-center gap-1 px-2 py-1 text-gray-500 hover:text-gray-700 hover:bg-white/60 rounded-md transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5 rotate-180" strokeWidth={1.75} aria-hidden />
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

        {/* Content Area - hidden when pending files (upload focus mode); Clean Background - relative z-50 so it stacks above the chat panel; min-h-0 so flex child can shrink and scroll; pb-12 on container so initial view shows 17 files (one row hidden until scroll) */}
        <div
          className="flex-1 min-h-0 overflow-y-auto w-full px-4 pb-12 relative z-50 filing-sidebar-main-scroll"
          style={{ boxSizing: 'border-box', WebkitOverflowScrolling: 'touch', display: pendingFiles.length > 0 ? 'none' : undefined }}
        >
          {showMoveDropdown ? (
            <div className="w-full py-0 pb-80 space-y-0" style={{ boxSizing: 'border-box' }}>
              <div className="px-2 pt-1 pb-2">
                <span className="text-[11px] font-medium text-gray-500">
                  Move {selectedItems.size} {selectedItems.size === 1 ? 'file' : 'files'} to...
                </span>
              </div>
              <div className="pr-8 w-full" style={{ boxSizing: 'border-box' }}>
                {(() => {
                  const filteredProps = availableProperties.filter(p => {
                    const address = p?.address || p?.formatted_address || p?.property?.formatted_address || p?.property_details?.property_address || '';
                    return address.toLowerCase().includes(moveSearchQuery.toLowerCase());
                  });

                  if (availableProperties.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                        <OrbitProgress color="#9ca3af" size="small" dense text="" textColor="" speedPlus={1} style={{ fontSize: '3px' }} />
                        <span className="text-xs mt-3">Loading projects...</span>
                      </div>
                    );
                  }

                  if (filteredProps.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                        <span className="text-xs">No projects found</span>
                      </div>
                    );
                  }

                  return filteredProps.map((property) => {
                    const propertyId = property?.property?.id || property?.id;
                    const address = property?.address || property?.formatted_address || property?.property?.formatted_address || property?.property_details?.property_address || 'Unknown address';

                    return (
                      <div key={`move-${propertyId}`} className="px-0 mb-0.5">
                        <div
                          onClick={() => handleBulkMove(propertyId)}
                          className="flex items-center gap-0.5 px-2 py-1 ml-4 mr-8 w-full cursor-pointer transition-all duration-200 rounded-md border-t border-x border-gray-100 last:border-b bg-white hover:bg-[#f0f0f0] active:bg-[#e8e8e8]"
                        >
                          <div className="flex-shrink-0 flex items-center justify-center" style={{ width: 48, height: 48 }}>
<span className="w-6 h-6 flex-shrink-0 block">
                            <img
                              src="/projectsfolder.png"
                              alt=""
                              className="w-full h-full object-contain pointer-events-none"
                              style={{ display: 'block' }}
                              draggable={false}
                            />
                          </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-slate-600 truncate" style={{ fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif", letterSpacing: '-0.01em' }}>
                              {address}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          ) : isLoading ? (
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
          ) : filteredItems.folders.length === 0 && filteredItems.documents.length === 0 && uploadingPlaceholders.length === 0 && !(viewMode === 'property' && !currentFolderId && groupedDocumentsByProperty && groupedDocumentsByProperty.length > 0) ? (
            <div className={`flex flex-col items-center justify-center h-full ml-8 mr-8 pt-4 ${isDark ? 'text-slate-300' : 'text-gray-400'}`}>
              <Files className="w-10 h-10 mb-3 text-inherit" strokeWidth={1.5} aria-hidden />
              <p className="text-[13px] font-medium mb-1">
                {viewMode === 'property' && !currentFolderId ? 'No projects' : 'No documents'}
              </p>
              <p className="text-[12px] text-center">
                {viewMode === 'property' && !currentFolderId ? 'Create a project or upload files to get started' : 'Upload files or adjust your search'}
              </p>
            </div>
          ) : (
            <div className="w-full pt-4 pb-80 space-y-0" style={{ boxSizing: 'border-box' }}>
              {/* Folders - same pr-8 as property cards for aligned right edge */}
              <div className={`space-y-0 ${viewMode === 'property' && !currentFolderId ? 'pr-8 w-full' : 'w-full'}`}>
              {filteredItems.folders.map((folder) => {
                const isSelected = selectedItems.has(folder.id);
                return (
                <div
                  key={folder.id}
                  onMouseEnter={() => setHoveredItemId(folder.id)}
                  onMouseLeave={() => setHoveredItemId(null)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (!editingItemId) handleContextMenuClick(e, folder.id);
                  }}
className={`flex items-center gap-0.5 px-2 py-1 ml-4 mr-8 w-full cursor-pointer transition-all duration-200 rounded-md border-t border-x border-gray-100 last:border-b ${
                    isSelectionMode 
                      ? (isSelected 
                          ? 'bg-gray-200 ring-1 ring-gray-300 hover:bg-gray-200'
                          : 'bg-white hover:bg-[#f0f0f0] active:bg-[#e8e8e8]')
                      : 'bg-white hover:bg-[#f0f0f0] active:bg-[#e8e8e8]'
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
                  <div className="flex-shrink-0 flex items-center justify-center" style={{ width: 48, height: 48 }}>
<span className="w-6 h-6 flex-shrink-0 block">
                            <img
                              src="/projectsfolder.png"
                              alt=""
                              className="w-full h-full object-contain pointer-events-none"
                              style={{ display: 'block' }}
                              draggable={false}
                            />
                          </span>
                  </div>
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
                        className="w-full px-2 py-1 border border-gray-200 rounded-sm focus:outline-none focus:ring-0 bg-white text-xs font-medium text-slate-600"
                        style={{ fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif", letterSpacing: '-0.01em' }}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div className="text-xs font-medium text-slate-600 truncate" style={{ fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif", letterSpacing: '-0.01em' }}>
                        {folder.name}
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
              </div>

              {/* Files - Grouped by property in property view - pr-8 keeps property header narrow */}
              {viewMode === 'property' && groupedDocumentsByProperty && !currentFolderId ? (
                <div className="pr-8 w-full" style={{ boxSizing: 'border-box' }}>
                {/* Uploading placeholders at top so they appear instantly when user clicks Upload */}
                {uploadingPlaceholders.length > 0 && (
                  <div className="px-0 mb-0.5">
                    <div className="py-0 w-full space-y-0" style={{ boxSizing: 'border-box' }}>
                      {uploadingPlaceholders.map((p) => {
                        const mockDoc: Document = { id: '', original_filename: p.name, file_type: '' };
                        return (
                          <div
                            key={p.id}
                            className="flex items-center gap-0.5 pl-3 pr-2 py-1.5 ml-5 mr-8 bg-white rounded-md border-t border-x border-gray-100 last:border-b"
                          >
                            <div className="flex-shrink-0 flex items-center justify-center overflow-hidden rounded bg-white relative" style={{ width: 48, height: 48 }}>
                              <div className="flex items-center justify-center" style={{ width: 48, height: 48 }}>
                                <OrbitProgress color="#22c55e" size="small" dense text="" textColor="" speedPlus={1} style={{ fontSize: '6px' }} />
                              </div>
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col min-h-[36px] justify-center gap-0">
                              <div className="flex flex-col gap-0.5 min-w-0 w-full">
                                <div className="flex items-center gap-1.5 min-h-[14px] w-full min-w-0 ml-1">
                                  <div className="flex-shrink-0">{getDocTypeIconSmall(mockDoc)}</div>
                                  <span className="text-xs font-medium text-slate-600 truncate flex-1 min-w-0" style={{ fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif" }}>
                                    {p.name}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleStopSingleUpload(p.id, p.name)}
                              className="flex items-center justify-center flex-shrink-0 p-0.5 hover:bg-gray-100 rounded bg-transparent border-0 focus:outline-none outline-none hover:opacity-70 transition-opacity cursor-pointer"
                              title="Stop upload"
                            >
                              <Pause className="w-2 h-2 text-gray-400" strokeWidth={1.5} aria-hidden />
                            </button>
                        </div>
                      );
                    })}
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
                      {/* Property Section Header - slightly larger containers, no doc count on right */}
                      <div 
                        onClick={() => {
                          if (isSelectionMode) return;
                          togglePropertyExpansion(propertyId);
                        }}
                        className={`flex items-center gap-0.5 pl-3 pr-2 py-1.5 ml-5 mr-8 w-full cursor-pointer transition-all duration-200 rounded-md border-t border-x border-gray-100 last:border-b ${
                          isExpanded 
                            ? 'bg-gray-50'
                            : 'bg-white hover:bg-[#f0f0f0] active:bg-[#e8e8e8]'
                        }`}
                      >
                        <div className="flex-shrink-0 flex items-center justify-center" style={{ width: 48, height: 48 }}>
<span className="w-6 h-6 flex-shrink-0 block">
                            <img
                              src="/projectsfolder.png"
                              alt=""
                              className="w-full h-full object-contain pointer-events-none"
                              style={{ display: 'block' }}
                              draggable={false}
                            />
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          {propertyAddress &&
                           !propertyAddress.startsWith('Property ') &&
                           propertyAddress !== 'Unknown Property' && (
                            <div className="text-xs font-medium text-slate-600 truncate" style={{ fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif", letterSpacing: '-0.01em' }}>
                              {propertyAddress}
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Documents in this property - ml-5 mr-8 matches property header width exactly; space-y-0 = compact gap between files */}
                      {isExpanded && (
                        <div className="py-0 w-full space-y-0" style={{ boxSizing: 'border-box' }}>
                          {propertyDocs.length === 0 ? (
                            <div className={`flex flex-col items-center justify-center pt-10 pb-8 px-4 ml-8 mr-8 rounded-md ${isDark ? 'text-slate-300' : 'text-gray-400'}`}>
                              <Files className="w-10 h-10 mb-3 text-inherit" strokeWidth={1.5} aria-hidden />
                              <p className="text-[13px] font-medium mb-1">No documents</p>
                              <p className="text-[12px] text-center">
                                Upload files or adjust your search
                              </p>
                            </div>
                          ) : propertyDocs.map((doc, propDocIndex) => {
                            const isLinked = isDocumentLinked(doc);
                            const isSelected = selectedItems.has(doc.id);
                            const isOpenInFileView = openFileViewDocumentId === doc.id;
                            const isHoveredDoc = hoveredPipelineDoc?.doc?.id === doc.id;
                            const progressForThisDoc =
                              isHoveredDoc ? pipelineProgress : (pipelineProgressByDocId[doc.id] ?? null);
                            const { completedStages: completedStagesForDoc } = mapPipelineProgressToStages(progressForThisDoc, doc.status);
                            const isRecentlyCreated = doc.created_at && (Date.now() - new Date(doc.created_at).getTime() <= 60000);
                            const showAsComplete = doc.status === 'completed' || doc.status === 'processed' || reprocessedDocs.has(doc.id);
                            const isRecentlyUploaded = doc.status === 'uploaded' && doc.created_at && (Date.now() - new Date(doc.created_at).getTime() <= 60000);
                            const showLoadingIndicator = doc.status === 'processing' || isRecentlyUploaded;

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
                                className={`flex items-center gap-0.5 pl-3 pr-2 py-1.5 ml-5 mr-8 cursor-pointer group rounded-md transition-all duration-100 active:scale-[0.99] outline-none focus:outline-none focus:ring-0 border-t border-x border-gray-100 last:border-b ${
                                  isSelectionMode 
                                    ? (isSelected 
                                        ? 'bg-gray-200 ring-1 ring-gray-300 hover:bg-gray-200' 
                                        : 'bg-white hover:bg-[#f5f5f5] active:bg-[#ebebeb]')
                                    : isOpenInFileView
                                      ? 'bg-gray-200 hover:bg-gray-300'
                                      : 'bg-white hover:bg-[#f5f5f5] active:bg-[#ebebeb]'
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
                                <div className="flex-shrink-0 flex items-center justify-center overflow-hidden rounded bg-gray-100 relative" style={{ width: 48, height: 48 }}>
                                  {isPdfForThumbnail(doc) ? (
                                    <>
                                      <img
                                        src={getThumbnailSrc(doc.id)}
                                        alt=""
                                        className={`${thumbSizeClass} absolute inset-0 w-full h-full`}
                                        loading="lazy"
                                        fetchPriority={propDocIndex < 6 ? 'high' : undefined}
                                        onError={(e) => {
                                          (e.target as HTMLImageElement).style.display = 'none';
                                          const fb = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                                          if (fb) fb.style.display = 'flex';
                                        }}
                                      />
                                      <div className="hidden absolute inset-0 flex items-center justify-center bg-gray-50" style={{ display: 'none' }}>
                                        <img src="/PDF(1).png" alt="PDF" className="w-5 h-5 object-contain" />
                                      </div>
                                    </>
                                  ) : (
                                    <div className="flex items-center justify-center" style={{ width: 48, height: 48 }}>
                                      {getFileIcon(doc)}
                                    </div>
                                  )}
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col min-h-[36px] justify-center gap-0">
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
                                      className="w-full px-2 py-1 border border-gray-200 rounded-md focus:outline-none focus:ring-0 bg-white text-xs"
                                      autoFocus
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  ) : (
                                    <>
                                      <div className="flex flex-col gap-0.5 min-w-0 w-full">
                                        {/* Doc type icon + name + status dot on right */}
                                        <div className="flex items-center gap-1.5 min-h-[14px] w-full min-w-0 ml-1">
                                          <div className="flex-shrink-0">{getDocTypeIconSmall(doc)}</div>
                                          <span className="text-xs font-medium text-slate-600 truncate flex-1 min-w-0" style={{ fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif" }}>
                                            {doc.original_filename}
                                          </span>
                                          {(reprocessingDocs.has(doc.id) || doc.status === 'processing' || isRecentlyUploaded || showLoadingIndicator || reprocessedDocs.has(doc.id) || doc.status === 'completed' || showAsComplete) ? (
                                            <div
                                              onMouseEnter={(e) => handlePipelineTriggerMouseEnter(doc, e)}
                                              onMouseLeave={handlePipelineTriggerMouseLeave}
                                              className="flex items-center flex-shrink-0 cursor-default relative z-10 overflow-visible"
                                            >
                                              {!showAsComplete && (reprocessingDocs.has(doc.id) || showLoadingIndicator) ? (
                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                  <div className="flex items-center justify-center w-3 h-3 flex-shrink-0">
                                                    <OrbitProgress color="#22c55e" size="small" dense text="" textColor="" speedPlus={1} style={{ fontSize: '2px' }} />
                                                  </div>
                                                  <Pause className="w-2 h-2 text-gray-400 flex-shrink-0" strokeWidth={1.5} aria-hidden />
                                                </div>
                                              ) : (
                                                <span
                                                  className="w-1.5 h-1.5 rounded-full bg-green-500/45 flex-shrink-0 block relative z-10"
                                                  style={{ boxShadow: '0 0 0 1px rgba(34, 197, 94, 0.1)' }}
                                                  aria-hidden
                                                />
                                              )}
                                            </div>
                                          ) : doc.status === 'failed' ? (
                                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 block flex-shrink-0" style={{ boxShadow: '0 0 0 1px rgba(239, 68, 68, 0.2)' }} title="Processing failed" aria-hidden />
                                          ) : doc.status === 'uploaded' && (!doc.created_at || (Date.now() - new Date(doc.created_at).getTime() > 60000)) ? (
                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 block flex-shrink-0" style={{ boxShadow: '0 0 0 1px rgba(245, 158, 11, 0.2)' }} title="Not yet processed" aria-hidden />
                                          ) : null}
                                        </div>
                                      </div>
                                    </>
                                  )}
                                </div>
                                {!editingItemId && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleContextMenuClick(e, doc.id);
                                    }}
                                    className="p-0.5 hover:bg-gray-100 rounded flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-150"
                                  >
                                    <MoreVertical className="w-3 h-3 text-gray-400" strokeWidth={1.5} aria-hidden />
                                  </button>
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
                // Flat list for global view or when inside a folder - uploading placeholders at top; space-y-0 = compact gap between files
                <div className="py-0 w-full space-y-0" style={{ boxSizing: 'border-box' }}>
                  {uploadingPlaceholders.length > 0 && uploadingPlaceholders.map((p) => {
                    const mockDoc: Document = { id: '', original_filename: p.name, file_type: '' };
                    return (
                      <div
                        key={p.id}
                        className="flex items-center gap-0.5 px-2 py-1 mx-4 bg-white rounded-md border-t border-x border-gray-100 last:border-b"
                      >
                        <div className="flex-shrink-0 flex items-center justify-center overflow-hidden rounded bg-white relative" style={{ width: 48, height: 48 }}>
                          <div className="flex items-center justify-center" style={{ width: 48, height: 48 }}>
                            <OrbitProgress color="#22c55e" size="small" dense text="" textColor="" speedPlus={1} style={{ fontSize: '6px' }} />
                          </div>
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col min-h-[36px] justify-center gap-0">
                          <div className="flex flex-col gap-0.5 min-w-0 w-full">
                            <div className="flex items-center gap-1.5 min-h-[14px] w-full min-w-0 ml-1">
                              <div className="flex-shrink-0">{getDocTypeIconSmall(mockDoc)}</div>
                              <span className="text-xs font-medium text-slate-600 truncate flex-1 min-w-0" style={{ fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif" }}>
                                {p.name}
                              </span>
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleStopSingleUpload(p.id, p.name)}
                          className="flex items-center justify-center flex-shrink-0 p-0.5 hover:bg-gray-100 rounded bg-transparent border-0 focus:outline-none outline-none hover:opacity-70 transition-opacity cursor-pointer"
                          title="Stop upload"
                        >
                          <Pause className="w-2 h-2 text-gray-400" strokeWidth={1.5} aria-hidden />
                        </button>
                      </div>
                    );
                  })}
                  {filteredItems.documents.map((doc, flatIndex) => {
                  const isLinked = isDocumentLinked(doc);
                  const isSelected = selectedItems.has(doc.id);
                  const isOpenInFileView = openFileViewDocumentId === doc.id;
                  const isHoveredDocFlat = hoveredPipelineDoc?.doc?.id === doc.id;
                  const progressForThisDocFlat =
                    isHoveredDocFlat ? pipelineProgress : (pipelineProgressByDocId[doc.id] ?? null);
                  const { completedStages: completedStagesForDocFlat } = mapPipelineProgressToStages(progressForThisDocFlat, doc.status);
                  const isRecentlyCreatedFlat = doc.created_at && (Date.now() - new Date(doc.created_at).getTime() <= 60000);
                  const showAsCompleteFlat = doc.status === 'completed' || doc.status === 'processed' || reprocessedDocs.has(doc.id);
                  const isRecentlyUploadedFlat = doc.status === 'uploaded' && doc.created_at && (Date.now() - new Date(doc.created_at).getTime() <= 60000);
                  const showLoadingIndicatorFlat = doc.status === 'processing' || isRecentlyUploadedFlat;

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
                      className={`flex items-center gap-0.5 px-2 py-1 mx-4 cursor-pointer group rounded-md transition-all duration-100 active:scale-[0.99] outline-none focus:outline-none focus:ring-0 border-t border-x border-gray-100 last:border-b ${
isSelectionMode 
                          ? (isSelected 
                              ? 'bg-gray-200 ring-1 ring-gray-300 hover:bg-gray-200'
                              : 'bg-white hover:bg-[#f5f5f5] active:bg-[#ebebeb]')
                          : isOpenInFileView
                            ? 'bg-gray-200 hover:bg-gray-300'
                            : 'bg-white hover:bg-[#f5f5f5] active:bg-[#ebebeb]'
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
                      <div className="flex-shrink-0 flex items-center justify-center overflow-hidden rounded bg-gray-100 relative" style={{ width: 48, height: 48 }}>
                      {isPdfForThumbnail(doc) ? (
                        <>
                          <img
                            src={getThumbnailSrc(doc.id)}
                            alt=""
                            className={`${thumbSizeClass} absolute inset-0 w-full h-full`}
                            loading="lazy"
                            fetchPriority={flatIndex < 6 ? 'high' : undefined}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              const fb = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                              if (fb) fb.style.display = 'flex';
                            }}
                          />
                          <div className="hidden absolute inset-0 flex items-center justify-center bg-gray-50" style={{ display: 'none' }}>
                            <img src="/PDF(1).png" alt="PDF" className="w-5 h-5 object-contain" />
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center justify-center" style={{ width: 48, height: 48 }}>
                          {getFileIcon(doc)}
                        </div>
                      )}
                    </div>
                      <div className="flex-1 min-w-0 flex flex-col min-h-[36px] justify-center gap-0">
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
                            className="w-full px-2 py-1 border border-gray-200 rounded-md focus:outline-none focus:ring-0 bg-white text-xs"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <>
                            <div className="flex flex-col gap-0.5 min-w-0 w-full">
                              {/* Doc type icon + name + status dot on right */}
                              <div className="flex items-center gap-1.5 min-h-[14px] w-full min-w-0 ml-1">
                                <div className="flex-shrink-0">{getDocTypeIconSmall(doc)}</div>
                                <span className="text-xs font-medium text-slate-600 truncate flex-1 min-w-0" style={{ fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif" }}>
                                  {doc.original_filename}
                                </span>
                                {(reprocessingDocs.has(doc.id) || doc.status === 'processing' || isRecentlyUploadedFlat || showLoadingIndicatorFlat || reprocessedDocs.has(doc.id) || doc.status === 'completed' || showAsCompleteFlat) ? (
                                  <div
                                    onMouseEnter={(e) => handlePipelineTriggerMouseEnter(doc, e)}
                                    onMouseLeave={handlePipelineTriggerMouseLeave}
                                    className="flex items-center flex-shrink-0 cursor-default relative z-10 overflow-visible"
                                  >
                                    {!showAsCompleteFlat && (reprocessingDocs.has(doc.id) || showLoadingIndicatorFlat) ? (
                                      <div className="flex items-center gap-1 flex-shrink-0">
                                        <div className="flex items-center justify-center w-3 h-3 flex-shrink-0">
                                          <OrbitProgress color="#22c55e" size="small" dense text="" textColor="" speedPlus={1} style={{ fontSize: '2px' }} />
                                        </div>
                                        <Pause className="w-2 h-2 text-gray-400 flex-shrink-0" strokeWidth={1.5} aria-hidden />
                                      </div>
                                    ) : (
                                      <span
                                        className="w-1.5 h-1.5 rounded-full bg-green-500/45 flex-shrink-0 block relative z-10"
                                        style={{ boxShadow: '0 0 0 1px rgba(34, 197, 94, 0.1)' }}
                                        aria-hidden
                                      />
                                    )}
                                  </div>
                                ) : doc.status === 'failed' ? (
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 block flex-shrink-0" style={{ boxShadow: '0 0 0 1px rgba(239, 68, 68, 0.2)' }} title="Processing failed" aria-hidden />
                                ) : doc.status === 'uploaded' && (!doc.created_at || (Date.now() - new Date(doc.created_at).getTime() > 60000)) ? (
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 block flex-shrink-0" style={{ boxShadow: '0 0 0 1px rgba(245, 158, 11, 0.2)' }} title="Not yet processed" aria-hidden />
                                ) : null}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                      {!editingItemId && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleContextMenuClick(e, doc.id);
                          }}
                          className="p-0.5 hover:bg-gray-100 rounded flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-150"
                        >
                          <MoreVertical className="w-3 h-3 text-gray-400" strokeWidth={1.5} aria-hidden />
                        </button>
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
                    <FileText className={`w-5 h-5 ${duplicateDialog.isExactDuplicate ? 'text-red-600' : 'text-amber-600'}`} aria-hidden />
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
                className="fixed rounded-md py-0.5 min-w-0 max-w-[130px] bg-white border border-slate-200"
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
                        className="w-full px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100 transition-colors truncate"
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
                          className="w-full px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100 transition-colors truncate"
                        >
                          Move to folder
                        </button>
                      )}
                      {!isFolder && (item as Document) && (
                        (() => {
                          const doc = item as Document;
                          const ageMs = doc.created_at ? Date.now() - new Date(doc.created_at).getTime() : 0;
                          const showRetry =
                            doc.status === 'failed' ||
                            (doc.status === 'uploaded' && ageMs > 60000) ||
                            (doc.status === 'processing' && ageMs > 300000);
                          if (!showRetry) return null;
                          return (
                            <button
                              onClick={() => {
                                if (openContextMenuId && item) {
                                  handleReprocessDocument(item as Document, { stopPropagation: () => {} } as React.MouseEvent);
                                  setOpenContextMenuId(null);
                                  setContextMenuPosition(null);
                                }
                              }}
                              disabled={reprocessingDocs.has((item as Document).id)}
                              className="w-full px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100 transition-colors truncate disabled:opacity-50"
                            >
                              {reprocessingDocs.has((item as Document).id) ? 'Retrying...' : 'Retry processing'}
                            </button>
                          );
                        })()
                      )}
                      <button
                        onClick={() => {
                          if (openContextMenuId) {
                            handleDeleteClick(openContextMenuId, isFolder);
                          }
                        }}
                        className="w-full px-2 py-1 text-left text-xs text-red-600 hover:bg-red-50 transition-colors truncate"
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

        {/* Selection count indicator at bottom */}
        {isSelectionMode && selectedItems.size > 0 && (
          <div className="px-4 py-2 border-t border-gray-200 w-full flex items-center flex-shrink-0" style={{ backgroundColor: filingBg, boxSizing: 'border-box', minHeight: '28px' }}>
            <span className="text-[10px] font-medium text-gray-600">
              {selectedItems.size} {selectedItems.size === 1 ? 'item' : 'items'} selected
            </span>
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
                  left: `${deleteConfirmDialog.position.x}px`,
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


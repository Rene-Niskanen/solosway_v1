"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Plus, Folder, FolderOpen, FileText, File as FileIcon, ChevronRight, MoreVertical, CheckSquare, Square, Upload, MousePointer2, Trash2, ChevronDown, MapPin } from 'lucide-react';
import { useFilingSidebar } from '../contexts/FilingSidebarContext';
import { backendApi } from '../services/backendApi';
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
}

// Component for displaying pending file with image preview
const PendingFileItem: React.FC<{
  file: File;
  index: number;
  onRemove: (index: number) => void;
  getFileIcon: (doc: Document) => React.ReactNode;
}> = ({ file, index, onRemove, getFileIcon }) => {
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
      className="flex items-center gap-2.5 px-3 py-2 bg-white border border-gray-200/60 hover:border-gray-300/80 rounded-lg transition-all duration-200 group"
    >
      {/* Image preview or file icon */}
      <div className="flex-shrink-0 flex items-center justify-center">
        {isImage && imageUrl ? (
          <div
            style={{
              width: '40px',
              height: '40px',
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
        <div className="text-xs font-normal text-gray-900 truncate" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '-0.01em' }}>
          {file.name}
        </div>
      </div>
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
    </motion.div>
  );
};

export const FilingSidebar: React.FC<FilingSidebarProps> = ({ 
  sidebarWidth,
  isSmallSidebarMode = false 
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
  const newMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const deleteConfirmRef = useRef<HTMLDivElement>(null);
  const panelElementRef = useRef<HTMLElement | null>(null);
  const resizeStateRef = useRef<{ startPos: { x: number }; startWidth: number } | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const propertySelectorRef = useRef<HTMLDivElement>(null);
  
  // Document cache: key is "viewMode_propertyId" or "viewMode_global"
  const documentCacheRef = useRef<Map<string, Document[]>>(new Map());
  const cacheTimestampRef = useRef<Map<string, number>>(new Map());
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache duration

  const { addPreviewFile, setPreviewFiles, setIsPreviewOpen } = usePreview();

  // Fetch properties and folders when selector opens
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
      
      // Check cache first
      const cachedDocs = documentCacheRef.current.get(cacheKey);
      const cacheTimestamp = cacheTimestampRef.current.get(cacheKey);
      const now = Date.now();
      const isCacheValid = cachedDocs && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION;
      
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

      // Use cached data immediately if available
      if (isCacheValid && cachedDocs) {
        console.log('📦 FilingSidebar: Using cached documents:', cachedDocs.length, 'documents');
        setDocuments(cachedDocs);
        loadFolders(); // Load folders with cached data
        
        setIsLoading(false);
        setError(null);
        
        // Still fetch fresh data in background to update cache
        // (but don't show loading state or reload folders to avoid double loading)
      } else {
        // No valid cache, show loading and fetch
        setIsLoading(true);
        setError(null);
      }

      try {
        if (viewMode === 'property' && selectedPropertyId) {
          // Fetch property-specific documents
          const response = await backendApi.getPropertyHubDocuments(selectedPropertyId);
          console.log('📄 FilingSidebar: getPropertyHubDocuments response:', response);
          console.log('📄 FilingSidebar: response.success:', response.success);
          console.log('📄 FilingSidebar: response.data:', response.data);
          console.log('📄 FilingSidebar: response.data type:', typeof response.data);
          
          if (response.success && response.data) {
            // Backend returns: { success: True, data: { documents: [...], document_count: N } }
            // fetchApi wraps it: { success: true, data: { success: True, data: { documents: [...] } } }
            let docs: any[] = [];
            
            // Try to extract documents from various possible structures
            if (Array.isArray(response.data)) {
              // Direct array
              docs = response.data;
            } else if (response.data.data && Array.isArray(response.data.data.documents)) {
              // Double-wrapped: response.data.data.documents
              docs = response.data.data.documents;
            } else if (response.data.data && Array.isArray(response.data.data)) {
              // response.data.data is array
              docs = response.data.data;
            } else if (Array.isArray(response.data.documents)) {
              // response.data.documents
              docs = response.data.documents;
            } else if (response.data.documents && Array.isArray(response.data.documents)) {
              // Nested documents
              docs = response.data.documents;
            }
            
            console.log('📄 FilingSidebar: Parsed property documents count:', docs.length);
            if (docs.length > 0) {
              console.log('📄 FilingSidebar: First property document sample:', docs[0]);
            }
            
            // Update cache
            documentCacheRef.current.set(cacheKey, docs);
            cacheTimestampRef.current.set(cacheKey, Date.now());
            
            // Only update documents and folders if we didn't use cached data
            // (to avoid double loading when cache was used)
            if (!isCacheValid) {
              setDocuments(docs);
              loadFolders();
            }
            // If cache was used, just update cache silently - don't reload UI
          } else {
            // Only set error if we didn't use cached data
            if (!isCacheValid) {
              console.warn('📄 FilingSidebar: Property documents request failed:', response.error || 'Unknown error');
              setError(response.error || 'Failed to load property documents');
              setDocuments([]);
              setFolders([]);
            }
          }
        } else {
          // Fetch all documents globally
          try {
            const response = await backendApi.getAllDocuments();
            console.log('📄 FilingSidebar: getAllDocuments response:', response);
            console.log('📄 FilingSidebar: response.success:', response.success);
            console.log('📄 FilingSidebar: response.data:', response.data);
            console.log('📄 FilingSidebar: response.data type:', typeof response.data);
            console.log('📄 FilingSidebar: response.data isArray:', Array.isArray(response.data));
            
            if (response.success) {
              // /api/files returns: { success: True, data: documents }
              // fetchApi wraps it: { success: true, data: { success: True, data: documents } }
              // So documents are at: response.data.data
              let docs: any[] = [];
              
              // Try multiple possible response structures
              if (Array.isArray(response.data)) {
                // Direct array (from /api/documents)
                docs = response.data;
              } else if (response.data && Array.isArray(response.data.data)) {
                // Wrapped: { success: true, data: { success: True, data: documents } }
                docs = response.data.data;
              } else if (response.data && response.data.success && Array.isArray(response.data.data)) {
                // Double-wrapped: response.data.success and response.data.data
                docs = response.data.data;
              } else if (response.data && Array.isArray(response.data.documents)) {
                // Alternative structure: { documents: [...] }
                docs = response.data.documents;
              } else if (response.data && response.data.data && Array.isArray(response.data.data.documents)) {
                // Triple-wrapped: response.data.data.documents
                docs = response.data.data.documents;
              }
              
              console.log('📄 FilingSidebar: Final parsed documents count:', docs.length);
              if (docs.length > 0) {
                console.log('📄 FilingSidebar: First document sample:', docs[0]);
              } else {
                console.warn('📄 FilingSidebar: No documents found in response. Response structure:', JSON.stringify(response.data, null, 2));
              }
              
              // Update cache
              documentCacheRef.current.set(cacheKey, docs);
              cacheTimestampRef.current.set(cacheKey, Date.now());
              
              // Only update documents and folders if we didn't use cached data
              // (to avoid double loading when cache was used)
              if (!isCacheValid) {
                setDocuments(docs);
                loadFolders();
              }
              // If cache was used, just update cache silently - don't reload UI
            } else {
              // Only set error if we didn't use cached data
              if (!isCacheValid) {
                console.warn('📄 FilingSidebar: Request failed:', response.error);
                setError(response.error || 'Failed to load documents');
                setDocuments([]);
                setFolders([]);
              }
            }
          } catch (err) {
            console.error('📄 FilingSidebar: Exception fetching all documents:', err);
            setError('Failed to load documents');
            setDocuments([]);
            setFolders([]);
          }
        }
      } catch (err) {
        console.error('Error fetching documents:', err);
        setError('Failed to load documents');
        setDocuments([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [isOpen, viewMode, selectedPropertyId]);

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
    const minWidth = 360; // Increased to accommodate all buttons (Global/Properties toggle + Selection + New buttons)
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

    // Sort documents alphabetically by filename
    const sortedDocs = [...filteredDocs].sort((a, b) => 
      (a.original_filename || '').localeCompare(b.original_filename || '')
    );
    
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
          documents: docs.sort((a, b) => 
            (a.original_filename || '').localeCompare(b.original_filename || '')
          )
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

  // Get file type icon
  const getFileIcon = (doc: Document) => {
    const filename = doc.original_filename.toLowerCase();
    if (filename.endsWith('.pdf')) {
      return <img src="/PDF.png" alt="PDF" className="w-4 h-4 object-contain" />;
    } else if (filename.endsWith('.doc') || filename.endsWith('.docx')) {
      return <FileText className="w-4 h-4 text-blue-600" />;
    } else if (filename.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      return <FileIcon className="w-4 h-4 text-green-600" />;
    }
    return <FileIcon className="w-4 h-4 text-gray-600" />;
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
    // Store document data in dataTransfer for drop handlers
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'filing-sidebar-document',
      documentId: doc.id,
      filename: doc.original_filename,
      fileType: doc.file_type,
      s3Path: doc.s3_path
    }));
    // Also set text data as fallback
    e.dataTransfer.setData('text/plain', doc.id);
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
      // Delete document - OPTIMISTIC UPDATE: Remove from UI immediately
      const documentToDelete = documents.find(d => d.id === itemId);
      
      // Optimistically remove from state immediately
      setDocuments(prev => prev.filter(d => d.id !== itemId));
      
      // Invalidate cache for current view
      const cacheKey = viewMode === 'property' && selectedPropertyId
        ? `property_${selectedPropertyId}`
        : 'global';
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
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only clear drag state if we're actually leaving the drop zone
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!e.currentTarget.contains(relatedTarget)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
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

  // Handle uploading all pending files
  const handleUploadPendingFiles = async () => {
    if (pendingFiles.length === 0) return;
    
    // Process each pending file
    for (const file of pendingFiles) {
      await handleFileUpload(file);
    }
    
    // Clear pending files and property selection after processing
    setPendingFiles([]);
    setSelectedPropertyForUpload(null);
  };

  // Remove a file from pending list
  const handleRemovePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Handle file upload with duplicate checking
  const handleFileUpload = async (file: File) => {
    try {
      // Check for duplicates first
      const duplicateCheck = await backendApi.checkDuplicateDocument(file.name, file.size);
      
      if (duplicateCheck.success && duplicateCheck.data) {
        const { is_duplicate, is_exact_duplicate, existing_document, existing_documents } = duplicateCheck.data;
        
        if (is_duplicate) {
          // Show dialog for both exact duplicates and same name/different size
          setDuplicateDialog({
            isOpen: true,
            filename: file.name,
            fileSize: file.size,
            existingDocuments: existing_documents || (existing_document ? [existing_document] : []),
            file: file,
            isExactDuplicate: is_exact_duplicate || false
          });
          return;
        }
      }
      
      // No duplicate - proceed with upload
      await proceedWithUpload(file);
    } catch (error) {
      console.error('Error checking for duplicate:', error);
      // If check fails, proceed with upload anyway
      await proceedWithUpload(file);
    }
  };

  // Proceed with actual upload
  const proceedWithUpload = async (file: File) => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Check access level if uploading to a property
      if (selectedPropertyForUpload?.type === 'property' && !canUploadToProperty()) {
        setError('You do not have permission to upload files. Only editors and owners can upload files to this property.');
        setIsLoading(false);
        return;
      }
      
      // Dispatch upload start event for global progress bar
      uploadEvents.start(file.name);
      
      let result;
      if (selectedPropertyForUpload) {
        if (selectedPropertyForUpload.type === 'property') {
          // Use property upload endpoint when property is selected
          result = await backendApi.uploadPropertyDocumentViaProxy(
            file,
            { property_id: selectedPropertyForUpload.id },
            (progress) => {
              console.log(`Upload progress: ${progress}%`);
              // Dispatch progress event for global progress bar
              uploadEvents.progress(progress, file.name);
            }
          );
        } else if (selectedPropertyForUpload.type === 'folder') {
          // Use general upload endpoint when folder is selected
          result = await backendApi.uploadDocument(file, (progress) => {
            console.log(`Upload progress: ${progress}%`);
            // Dispatch progress event for global progress bar
            uploadEvents.progress(progress, file.name);
          });
          
          // After upload, move document to folder
          if (result.success && result.data?.document_id) {
            try {
              await backendApi.moveDocument(result.data.document_id, selectedPropertyForUpload.id);
            } catch (error) {
              console.error('Failed to move document to folder:', error);
              // Don't fail the upload if move fails
            }
          }
        }
      } else {
        // Use general upload endpoint
        result = await backendApi.uploadDocument(file, (progress) => {
          console.log(`Upload progress: ${progress}%`);
          // Dispatch progress event for global progress bar
          uploadEvents.progress(progress, file.name);
        });
      }
      
      if (result.success) {
        // Dispatch upload complete event
        uploadEvents.complete(file.name, result.data?.document_id);
        
        // Invalidate cache for current view
        const uploadCacheKey = viewMode === 'property' && selectedPropertyId
          ? `property_${selectedPropertyId}`
          : 'global';
        documentCacheRef.current.delete(uploadCacheKey);
        cacheTimestampRef.current.delete(uploadCacheKey);
        
        // Refresh documents list
        const response = await backendApi.getAllDocuments();
        if (response.success && response.data) {
          const docs = Array.isArray(response.data) ? response.data : (response.data.documents || []);
          setDocuments(docs);
          
          // Update cache with new documents
          documentCacheRef.current.set(uploadCacheKey, docs);
          cacheTimestampRef.current.set(uploadCacheKey, Date.now());
        }
        setDuplicateDialog({ isOpen: false, filename: '', fileSize: 0, existingDocuments: [], file: null, isExactDuplicate: false });
      } else {
        // Check if error is due to duplicate (backend safety net)
        if (result.error && (result.error.includes('already exists') || result.error.includes('duplicate'))) {
          // Dispatch error event for duplicates
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
          // Dispatch error event
          uploadEvents.error(file.name, result.error || 'Upload failed');
          setError(result.error || 'Upload failed');
        }
      }
    } catch (error) {
      console.error('Upload error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      // Dispatch error event
      uploadEvents.error(file.name, errorMessage);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
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
          className="fixed top-0 h-full flex flex-col z-[10000]"
          onClick={(e) => e.stopPropagation()}
          style={{
            // Match sidebar grey background for seamless look - always solid
            background: '#F1F1F1',
            // Position FilingSidebar at sidebar edge (covers toggle rail for seamless look)
            // When closed, move off-screen to the left to prevent gaps
            // Sidebar widths: w-0 (collapsed) = 0px, w-56 (normal) = 224px
            // When collapsed: FilingSidebar starts at 12px (after toggle rail)
            // When normal (isSmallSidebarMode): FilingSidebar starts at sidebarWidth (covers toggle rail)
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
            // Ensure background extends fully to prevent any gaps
            boxShadow: 'none',
            borderRight: 'none',
            // Extend slightly beyond to ensure full coverage
            minWidth: '360px',
            right: 'auto',
            // Hide pointer events when closed
            pointerEvents: isOpen ? 'auto' : 'none'
          }}
        >
        {/* Header - Unified Design */}
        <div className="px-4 pt-4 pb-1 border-b border-gray-100 w-full" style={{ boxSizing: 'border-box' }}>
          {/* Close Button */}
          <div className="flex justify-end mb-3">
            <button
              onClick={closeSidebar}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
              aria-label="Close sidebar"
            >
              <div className="w-4 h-4 flex items-center justify-center">
                <X className="w-4 h-4" strokeWidth={1.5} />
              </div>
            </button>
          </div>

          {/* Drag and Drop Upload Area */}
          <div className="px-4">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleUploadAreaClick}
              className={`relative cursor-pointer transition-all duration-200 ${
                isDragOver ? 'opacity-90' : ''
              } ${pendingFiles.length > 0 ? 'mb-0' : 'mb-4'}`}
            >
            <div
              className={`w-full flex flex-col items-center justify-center transition-all duration-200 relative ${
                isDragOver
                  ? 'opacity-90'
                  : ''
              } ${pendingFiles.length > 0 ? 'border-b border-gray-200' : ''}`}
              style={{ 
                backgroundColor: isDragOver ? '#F0F0F2' : '#F7F7F9',
                padding: '8px 16px',
                border: '2px dotted #D1D5DB',
                borderRadius: pendingFiles.length > 0 ? '8px 8px 0 0' : '8px'
              }}
            >
              {/* Document Icon */}
              <div className="flex items-center justify-center" style={{ width: '100%', overflow: 'visible' }}>
                <img 
                  src="/DocumentUpload2.png" 
                  alt="Upload files" 
                  className="object-contain"
                  style={{ 
                    width: '695px',
                    height: 'auto',
                    maxWidth: '285px',
                    borderRadius: '8px'
                  }}
                />
              </div>

              {/* Text Overlay on Image */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ padding: '8px 16px', transform: 'translateY(85px)' }}>
                <div className="flex flex-col items-center justify-center pointer-events-auto">
                  {/* Instructional Text */}
                  <p className="text-sm text-gray-600 text-center mb-1">
                    Drop files here or{' '}
                    <button
                      type="button"
                      className="text-gray-600 hover:text-gray-700 underline underline-offset-2 transition-colors"
                      style={{ textDecorationThickness: '0.5px', textUnderlineOffset: '2px' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUploadAreaClick();
                      }}
                    >
                      browse
                    </button>
                  </p>

                  {/* Supported Formats */}
                  <p className="text-xs text-gray-400 mt-2">PDF, Word, Excel, CSV</p>
                </div>
              </div>
            </div>

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

          {/* Pending Files Section */}
          {pendingFiles.length > 0 && (
            <div className="px-4 mb-4">
              <div>
                <div className="bg-gray-50 border border-gray-200 border-t-0 rounded-b-lg p-2 space-y-1">
                  <AnimatePresence mode="popLayout">
                    {pendingFiles.map((file, index) => {
                      // Create a stable key based on file properties
                      const fileKey = `${file.name}-${file.size}-${file.lastModified}`;
                      return (
                        <PendingFileItem
                          key={fileKey}
                          file={file}
                          index={index}
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
                  {/* Property Selector */}
                  <div className="relative flex-1 min-w-0">
                    <button
                      onClick={() => setShowPropertySelector(!showPropertySelector)}
                      className="w-full px-3 py-2 bg-white hover:bg-gray-50 border border-gray-300 text-gray-900 text-xs font-medium rounded transition-colors flex items-center justify-between gap-2"
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
                  </div>
                  
                  {/* Property Dropdown - Full Width */}
                  <AnimatePresence>
                    {showPropertySelector && (
                      <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-sm shadow-lg max-h-64 overflow-hidden"
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
                                      <img 
                                        src="/houseicon.png" 
                                        alt="Property" 
                                        className="w-3.5 h-3.5 object-contain flex-shrink-0"
                                      />
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
                  
                  {/* Upload Button */}
                  <button
                    onClick={handleUploadPendingFiles}
                    disabled={isLoading}
                    className={`px-4 py-2 text-xs font-medium rounded-none transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 flex-shrink-0 relative ${
                      pendingFiles.length > 0
                        ? 'border border-green-300 text-green-800'
                        : 'bg-white hover:bg-gray-50/50 border border-gray-300 text-gray-900'
                    }`}
                  >
                    {pendingFiles.length > 0 && (
                      <span 
                        className="absolute inset-0 bg-gray-50"
                        style={{ 
                          animation: 'openai-pulse 3s ease-in-out infinite',
                          zIndex: 0
                        }}
                      />
                    )}
                    <style>{`
                      @keyframes openai-pulse {
                        0%, 100% {
                          background-color: rgb(240, 253, 244);
                          opacity: 1;
                        }
                        50% {
                          background-color: rgb(220, 252, 231);
                          opacity: 0.8;
                        }
                      }
                    `}</style>
                    <span className="relative z-10 flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5" />
                      Upload
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Divider between upload area and file listing */}
          <div className="my-8 px-4">
            <div className="h-px bg-gray-200"></div>
          </div>

          {/* Search Bar and Actions Row Container */}
          <div className="w-full px-4" style={{ boxSizing: 'border-box' }}>
            {/* Search Bar */}
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-none text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-gray-300 transition-all"
              />
            </div>

            {/* Actions Row - Unified Style */}
            <div className="flex items-center gap-3 w-full" style={{ width: '100%', boxSizing: 'border-box' }}>
            {/* View Mode Toggle */}
            <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('global')}
                className={`text-[11px] font-medium rounded-none transition-all duration-150 ${
                  viewMode === 'global'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                style={{
                  padding: '4px 8px',
                  height: '24px',
                  minHeight: '24px'
                }}
              >
                All Files
              </button>
              <button
                onClick={() => setViewMode('property')}
                className={`text-[11px] font-medium rounded-none transition-all duration-150 ${
                  viewMode === 'property'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                style={{
                  padding: '4px 8px',
                  height: '24px',
                  minHeight: '24px'
                }}
              >
                By Property
              </button>
            </div>

            <div className="flex items-center gap-1.5 ml-auto">
              {/* Selection Mode Toggle Button */}
              <button
                onClick={() => {
                  setIsSelectionMode(!isSelectionMode);
                  if (isSelectionMode) {
                    clearSelection();
                  }
                }}
                className={`flex items-center justify-center gap-1.5 px-2 py-1 rounded-none transition-all duration-200 ${
                  isSelectionMode 
                    ? 'text-slate-600' 
                    : 'text-slate-600 hover:text-slate-700'
                }`}
                style={{
                  padding: '4px 8px',
                  height: '24px',
                  minHeight: '24px',
                  minWidth: '70px',
                  width: '70px',
                  backgroundColor: isSelectionMode ? '#F9FAFB' : '#FFFFFF',
                  border: isSelectionMode ? '1px solid rgba(203, 213, 225, 0.6)' : '1px solid rgba(203, 213, 225, 0.3)',
                  opacity: 1,
                  backdropFilter: 'none'
                }}
                onMouseEnter={(e) => {
                  if (isSelectionMode) {
                    e.currentTarget.style.backgroundColor = '#F3F4F6';
                  }
                }}
                onMouseLeave={(e) => {
                  if (isSelectionMode) {
                    e.currentTarget.style.backgroundColor = '#F9FAFB';
                  }
                }}
                title="Select documents"
              >
                <MousePointer2 className="w-3.5 h-3.5 text-slate-600" strokeWidth={1.5} />
                <span className="text-slate-600 text-[11px]">Select</span>
              </button>

              <div className="relative" ref={newMenuRef}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowNewMenu(!showNewMenu);
                  }}
                  className="flex items-center justify-center gap-1.5 px-2 py-1 border border-slate-200/60 hover:border-slate-300/80 rounded-none transition-all duration-200"
                  style={{
                    padding: '4px 8px',
                    height: '24px',
                    minHeight: '24px',
                    minWidth: '70px',
                    width: '70px',
                    backgroundColor: '#FFFFFF',
                    opacity: 1,
                    backdropFilter: 'none'
                  }}
                  title="Add"
                >
                  <Plus className="w-3.5 h-3.5 text-slate-600" strokeWidth={1.5} />
                  <span className="text-slate-600 text-[11px]">Add</span>
                </button>

              {/* New Menu Popup - Clean style */}
              <AnimatePresence>
                {showNewMenu && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 top-full mt-1.5 w-48 bg-white rounded-lg py-1 z-50"
                    style={{ boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Folder Option */}
                    <button
                      onClick={async () => {
                        setShowNewMenu(false);
                        await handleCreateFolder();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
                    >
                      <Folder className="w-4 h-4 text-gray-500" strokeWidth={1.75} />
                      <span className="text-[13px] font-medium text-gray-700">New folder</span>
                    </button>

                    <div className="h-px bg-gray-100 my-1" />

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
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
                    >
                      <Upload className="w-4 h-4 text-gray-500" strokeWidth={1.75} />
                      <span className="text-[13px] font-medium text-gray-700">Upload file</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
              </div>
            </div>
          </div>
          </div>
        </div>

        {/* Bulk Actions Bar - Show when items are selected and in selection mode */}
        {isSelectionMode && selectedItems.size > 0 && (
          <div className="px-4 py-1 border-b border-gray-100 w-full" style={{ backgroundColor: '#F1F1F1', boxSizing: 'border-box' }}>
            <div className="flex items-center gap-3 w-full" style={{ width: '100%', boxSizing: 'border-box' }}>
              <span className="text-xs font-medium text-gray-600 ml-3">
                {selectedItems.size} {selectedItems.size === 1 ? 'item' : 'items'} selected
              </span>
              <div className="flex items-center gap-1.5 ml-auto">
                <motion.button
                  onClick={handleBulkDelete}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="flex items-center justify-center gap-1.5 px-2 py-1 rounded-none font-medium text-slate-600 hover:text-slate-700 border border-slate-200/60 hover:border-slate-300/80 transition-all duration-200 flex-shrink-0"
                  style={{
                    padding: '4px 8px',
                    height: '24px',
                    minHeight: '24px',
                    minWidth: '70px',
                    width: '70px',
                    backgroundColor: '#FFFFFF',
                    opacity: 1,
                    backdropFilter: 'none'
                  }}
                  title="Delete selected"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-600" strokeWidth={1.5} />
                  <span className="text-slate-600 text-[11px]">Delete</span>
                </motion.button>
                <motion.button
                  onClick={clearSelection}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  className="flex items-center justify-center px-2 py-1 rounded-none font-medium text-slate-600 hover:text-slate-700 border border-slate-200/60 hover:border-slate-300/80 transition-all duration-200 flex-shrink-0"
                  style={{
                    padding: '4px 8px',
                    height: '24px',
                    minHeight: '24px',
                    minWidth: '70px',
                    width: '70px',
                    backgroundColor: '#FFFFFF',
                    opacity: 1,
                    backdropFilter: 'none'
                  }}
                  title="Cancel selection"
                >
                  <span className="text-slate-600 text-[11px]">Cancel</span>
                </motion.button>
              </div>
            </div>
          </div>
        )}

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

        {/* Content Area - Clean Background */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-500">Loading...</div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-red-500">{error}</div>
            </div>
          ) : filteredItems.folders.length === 0 && filteredItems.documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 px-4">
              <FolderOpen className="w-10 h-10 text-gray-300 mb-3" strokeWidth={1.5} />
              <p className="text-[13px] font-medium text-gray-500 mb-1">No documents</p>
              <p className="text-[12px] text-gray-400 text-center">Upload files or adjust your search</p>
            </div>
          ) : (
            <div className="px-4 py-0.5 space-y-0.5 w-full" style={{ boxSizing: 'border-box' }}>
              {/* Folders - Premium Container Design */}
              {filteredItems.folders.map((folder) => {
                const isSelected = selectedItems.has(folder.id);
                return (
                <div
                  key={folder.id}
                  onMouseEnter={() => setHoveredItemId(folder.id)}
                  onMouseLeave={() => setHoveredItemId(null)}
                  className={`flex items-center gap-2.5 py-2 w-full cursor-pointer group transition-all duration-200 rounded-md border ${
                    isSelectionMode 
                      ? (isSelected 
                          ? 'bg-gray-100/50 border-gray-300/60 hover:border-gray-400/80' 
                          : 'bg-white border-gray-200/60 hover:border-gray-300/80 hover:bg-gray-50/50')
                      : 'bg-white border-gray-200/60 hover:border-gray-300/80 hover:bg-gray-50/50'
                  }`}
                  style={{ paddingLeft: '0px', paddingRight: '0px' }}
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
                    <div className="flex-shrink-0 w-3.5">
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
                            width: '14px',
                            height: '14px',
                            borderRadius: '3px',
                            border: isSelected 
                              ? '1.5px solid #000000' 
                              : '1.5px solid #D1D5DB',
                            backgroundColor: isSelected ? '#000000' : 'transparent',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {isSelected && (
                            <motion.svg
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0, opacity: 0 }}
                              transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                              width="8"
                              height="8"
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
                        className="w-full px-2 py-1 text-xs border border-blue-500 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div className="text-xs font-normal text-gray-900 truncate" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '-0.01em' }}>
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

              {/* Files - Grouped by property in property view */}
              {viewMode === 'property' && groupedDocumentsByProperty && !currentFolderId ? (
                // Grouped by property sections
                groupedDocumentsByProperty.map(({ propertyId, propertyAddress, documents: propertyDocs }) => {
                  const isExpanded = expandedProperties.has(propertyId);
                  
                  // Skip rendering sections that don't have a valid property address
                  // (These are documents not associated with any property card)
                  if (propertyAddress === 'Unknown Property' || propertyAddress.startsWith('Property ')) {
                    return null;
                  }
                  
                  return (
                    <div key={propertyId} className="px-0 mb-0.5">
                      {/* Property Section Header - Premium Container Design */}
                      <div 
                        onClick={() => togglePropertyExpansion(propertyId)}
                        className={`px-4 py-2 cursor-pointer transition-all duration-200 rounded-md border flex items-center gap-2.5 w-full ${
                          isExpanded 
                            ? 'bg-gray-50 border-gray-200/60' 
                            : 'bg-white border-gray-200/60 hover:border-gray-300/80 hover:bg-gray-50/50'
                        }`}
                      >
                        <ChevronRight 
                          className={`w-3 h-3 text-gray-400 flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                          strokeWidth={1.75}
                        />
                        <img 
                          src="/houseicon.png" 
                          alt="Property" 
                          className="w-5 h-5 object-contain flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          {propertyAddress && 
                           !propertyAddress.startsWith('Property ') && 
                           propertyAddress !== 'Unknown Property' && (
                            <div className="text-xs font-normal text-gray-900 truncate" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '-0.01em' }}>
                              {propertyAddress}
                            </div>
                          )}
                        </div>
                        <span className="text-xs text-gray-500 flex-shrink-0 font-medium">
                          {propertyDocs.length}
                        </span>
                      </div>
                      {/* Documents in this property - Indented sub-items */}
                      {isExpanded && (
                        <div className="px-4 py-0.5 space-y-0.5">
                          {propertyDocs.map((doc) => {
                            const isLinked = isDocumentLinked(doc);
                            const isSelected = selectedItems.has(doc.id);
                            
                            return (
                              <div
                                key={doc.id}
                                draggable={!isSelectionMode && !editingItemId}
                                onDragStart={(e) => {
                                  if (!isSelectionMode && !editingItemId) {
                                    handleDragStart(e, doc);
                                  }
                                }}
                                onMouseEnter={() => setHoveredItemId(doc.id)}
                                onMouseLeave={() => setHoveredItemId(null)}
                                className={`flex items-center gap-2.5 py-2 cursor-pointer group transition-all duration-200 rounded-md border px-0 w-full ${
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
                                    toggleItemSelection(doc.id);
                                  } else {
                                    handleDocumentClick(doc);
                                  }
                                }}
                              >
                                {isSelectionMode && (
                                  <div className="flex-shrink-0 w-3.5">
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
                                          width: '14px',
                                          height: '14px',
                                          borderRadius: '3px',
                                          border: isSelected 
                                            ? '1.5px solid #000000' 
                                            : '1.5px solid #D1D5DB',
                                          backgroundColor: isSelected ? '#000000' : 'transparent',
                                          transition: 'all 0.15s ease',
                                        }}
                                      >
                                        {isSelected && (
                                          <motion.svg
                                            initial={{ scale: 0, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            exit={{ scale: 0, opacity: 0 }}
                                            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                                            width="8"
                                            height="8"
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
                                      className="w-full px-2 py-1 text-xs border border-blue-500 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
                                      autoFocus
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  ) : (
                                    <div className="text-xs font-normal text-gray-900 truncate" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '-0.01em' }}>
                                      {doc.original_filename}
                                    </div>
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
                                    <MoreVertical className="w-3 h-3 text-gray-400" strokeWidth={1.5} />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                // Flat list for global view or when inside a folder - Premium Design
                <div className="py-0.5 space-y-0.5 w-full" style={{ boxSizing: 'border-box' }}>
                  {filteredItems.documents.map((doc) => {
                  const isLinked = isDocumentLinked(doc);
                  const isSelected = selectedItems.has(doc.id);
                  
                  return (
                    <div
                      key={doc.id}
                      draggable={!isSelectionMode && !editingItemId}
                      onDragStart={(e) => {
                        if (!isSelectionMode && !editingItemId) {
                          handleDragStart(e, doc);
                        }
                      }}
                      onMouseEnter={() => setHoveredItemId(doc.id)}
                      onMouseLeave={() => setHoveredItemId(null)}
                      className={`flex items-center gap-2.5 px-0 py-2 w-full cursor-pointer group transition-all duration-200 rounded-md border ${
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
                          toggleItemSelection(doc.id);
                        } else {
                          handleDocumentClick(doc);
                        }
                      }}
                    >
                      {isSelectionMode && (
                        <div className="flex-shrink-0 w-3.5">
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
                                width: '14px',
                                height: '14px',
                                borderRadius: '3px',
                                border: isSelected 
                                  ? '1.5px solid #000000' 
                                  : '1.5px solid #D1D5DB',
                                backgroundColor: isSelected ? '#000000' : 'transparent',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              {isSelected && (
                                <motion.svg
                                  initial={{ scale: 0, opacity: 0 }}
                                  animate={{ scale: 1, opacity: 1 }}
                                  exit={{ scale: 0, opacity: 0 }}
                                  transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                                  width="8"
                                  height="8"
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
                            className="w-full px-2 py-1 text-xs border border-blue-500 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <div className="text-xs font-normal text-gray-900 truncate" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '-0.01em' }}>
                            {doc.original_filename}
                          </div>
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
                          <MoreVertical className="w-3 h-3 text-gray-400" strokeWidth={1.5} />
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

        {/* Context Menu - Clean style */}
        <AnimatePresence>
          {openContextMenuId && contextMenuPosition && (
            <motion.div
              ref={contextMenuRef}
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.12 }}
              className="fixed rounded-lg py-1 z-[10000] min-w-[140px]"
              style={{
                left: `${contextMenuPosition.x}px`,
                top: `${contextMenuPosition.y}px`,
                backgroundColor: '#2D2D2D',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
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
                      className="w-full px-3 py-1.5 text-left text-[13px] text-white/90 hover:bg-white/10 transition-colors"
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
                        className="w-full px-3 py-1.5 text-left text-[13px] text-white/90 hover:bg-white/10 transition-colors"
                      >
                        Move to folder
                      </button>
                    )}
                    <div className="h-px bg-white/10 my-1" />
                    <button
                      onClick={(e) => {
                        if (item) {
                          handleDeleteClick(openContextMenuId!, isFolder, e);
                        }
                      }}
                      className="w-full px-3 py-1.5 text-left text-[13px] text-white/90 hover:bg-white/10 transition-colors"
                    >
                      Delete
                    </button>
                  </>
                );
              })()}
            </motion.div>
          )}
        </AnimatePresence>
        
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
        
        {/* Delete Confirmation Pop-up - Simple pop-up style */}
        <AnimatePresence>
          {deleteConfirmDialog.isOpen && deleteConfirmDialog.position && (
            <motion.div
              ref={deleteConfirmRef}
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.12 }}
              className="absolute bg-white rounded-lg py-1 z-50"
              style={{ 
                left: `${deleteConfirmDialog.position.x + 30}px`,
                top: `${deleteConfirmDialog.position.y}px`,
                width: '200px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Warning message */}
              <div className="px-3 py-2 border-b border-gray-100">
                <p className="text-[13px] font-medium text-gray-900 mb-1">
                  Delete {deleteConfirmDialog.isFolder ? 'folder' : 'file'}?
                </p>
                <p className="text-[12px] text-gray-500 truncate">
                  "{deleteConfirmDialog.itemName}"
                </p>
                {deleteConfirmDialog.isFolder && (
                  <p className="text-[11px] text-gray-400 mt-1">
                    All contents will be deleted.
                  </p>
                )}
              </div>
              
              {/* Actions */}
              <button
                onClick={() => {
                  setDeleteConfirmDialog({ isOpen: false, itemId: null, isFolder: false, itemName: '', position: null });
                }}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
              >
                <span className="text-[13px] font-medium text-gray-700">Cancel</span>
              </button>
              
              <div className="h-px bg-gray-100 my-1" />
              
              <button
                onClick={handleDelete}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-red-50 transition-colors text-left"
              >
                <span className="text-[13px] font-medium text-red-600">Delete</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
};


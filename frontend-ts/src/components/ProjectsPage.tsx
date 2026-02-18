"use client";

/**
 * ProjectsPage - Displays user's projects
 * 
 * IMPORTANT BUSINESS LOGIC:
 * In Velora, "Projects" and "Properties" (property pins on the map) are the SAME concept.
 * A property pin represents a project. The terms are used interchangeably:
 * - UI/User-facing: "Projects" 
 * - Backend/Data model: "Properties" (from /api/properties)
 * 
 * This page fetches from the Properties API and displays them as Projects.
 * 
 * PERFORMANCE: Uses stale-while-revalidate caching for instant loading.
 * Cached data is shown immediately while fresh data is fetched in background.
 */

import * as React from "react";
import { FolderClosed, ChevronDown, ChevronUp, Trash2, Plus } from "lucide-react";
import { backendApi } from "@/services/backendApi";
import { ProjectGlassCard } from "./ProjectGlassCard";
import { RecentDocumentsSection } from "./RecentDocumentsSection";
import { preloadDocumentThumbnails, PRELOAD_THUMBNAIL_LIMIT } from "./RecentDocumentCard";
import { preloadDocumentCovers as preloadDocumentCoversUtil } from "@/utils/preloadDocumentCovers";

// Properties = Projects (same concept, different naming)
// Backend uses "Property", UI displays as "Project"
interface PropertyData {
  id: string;
  address?: string;
  formatted_address?: string;
  property_type?: string;
  document_count?: number;
  created_at?: string;
  updated_at?: string;
  primary_image_url?: string;
  latitude?: number;
  longitude?: number;
  // Property details for display
  bedrooms?: number;
  bathrooms?: number;
  size_sqft?: number;
  size_unit?: string;
  year_built?: number;
  description?: string;
  notes?: string;
  /** When set, PropertyDetailsPanel can show documents instantly without loading */
  propertyHub?: { documents: DocumentData[] };
}

// Document data extracted from property hubs
interface DocumentData {
  id: string;
  original_filename: string;
  created_at: string;
  file_type?: string;
  property_id?: string;
  cover_image_url?: string;
  first_page_image_url?: string;
  s3_path?: string;
  updated_at?: string;
}

// Type alias to make the equivalence explicit
type ProjectData = PropertyData;

// ============= CACHING SYSTEM FOR INSTANT LOADING =============
const CACHE_KEY = 'projectsPage_propertyHubsCache';
const CACHE_MAX_AGE = 5 * 60 * 1000; // 5 minutes - data stays fresh

interface CachedData {
  properties: PropertyData[];
  documents: DocumentData[];
  timestamp: number;
}

// In-memory cache for even faster access (survives component remounts)
let memoryCache: CachedData | null = null;

function getCachedData(): CachedData | null {
  // Check memory cache first (instant)
  if (memoryCache && Date.now() - memoryCache.timestamp < CACHE_MAX_AGE) {
    // Preload thumbnails immediately when returning from cache
    if (memoryCache.documents.length > 0) {
      preloadDocumentThumbnails(memoryCache.documents, PRELOAD_THUMBNAIL_LIMIT);
    }
    return memoryCache;
  }
  
  // Fall back to localStorage
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as CachedData;
      // Cache is valid even if stale - we'll refresh in background
      memoryCache = parsed; // Update memory cache
      // Preload thumbnails immediately when returning from localStorage cache
      if (parsed.documents.length > 0) {
        preloadDocumentThumbnails(parsed.documents, PRELOAD_THUMBNAIL_LIMIT);
      }
      return parsed;
    }
  } catch (e) {
    console.warn('[ProjectsPage] Failed to read cache:', e);
  }
  return null;
}

function setCachedData(properties: PropertyData[], documents: DocumentData[]): void {
  const data: CachedData = { properties, documents, timestamp: Date.now() };
  memoryCache = data;
  // Preload thumbnails when new data is cached
  if (documents.length > 0) {
    preloadDocumentThumbnails(documents, PRELOAD_THUMBNAIL_LIMIT);
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('[ProjectsPage] Failed to write cache:', e);
  }
}

// Helper to transform API response to our data format
function transformHubsToData(hubs: any[]): { properties: PropertyData[]; documents: DocumentData[] } {
  const allDocuments: DocumentData[] = [];
  const documentIdsSeen = new Set<string>();
  
  const properties: PropertyData[] = hubs.map((hub: any) => {
    const property = hub.property || hub;
    const propertyDetails = hub.property_details || {};
    const hubDocuments = hub.documents || [];
    const propertyId = property.id || hub.id;

    // Transform hub documents to DocumentData for this property (for instant load in PropertyDetailsPanel)
    const hubDocsFormatted: DocumentData[] = hubDocuments
      .filter((doc: any) => doc.id && doc.original_filename)
      .map((doc: any) => ({
        id: doc.id,
        original_filename: doc.original_filename,
        created_at: doc.created_at || doc.uploaded_at || new Date().toISOString(),
        file_type: doc.file_type || doc.mime_type,
        property_id: propertyId,
        cover_image_url: doc.cover_image_url || doc.thumbnail_url,
        first_page_image_url: doc.first_page_image_url,
        s3_path: doc.s3_path,
        updated_at: doc.updated_at || doc.last_updated || doc.created_at || doc.uploaded_at,
      }));

    // Collect documents from this hub (for merged allDocuments list)
    hubDocuments.forEach((doc: any) => {
      if (doc.id && doc.original_filename && !documentIdsSeen.has(doc.id)) {
        documentIdsSeen.add(doc.id);
        allDocuments.push({
          id: doc.id,
          original_filename: doc.original_filename,
          created_at: doc.created_at || doc.uploaded_at || new Date().toISOString(),
          file_type: doc.file_type || doc.mime_type,
          property_id: propertyId,
          cover_image_url: doc.cover_image_url || doc.thumbnail_url,
          first_page_image_url: doc.first_page_image_url,
          s3_path: doc.s3_path,
          updated_at: doc.updated_at || doc.last_updated || doc.created_at || doc.uploaded_at,
        });
      }
    });

    return {
      id: propertyId,
      address: property.formatted_address || property.normalized_address || property.address || '',
      formatted_address: property.formatted_address || property.normalized_address || '',
      property_type: propertyDetails.property_type || property.property_type,
      latitude: property.latitude,
      longitude: property.longitude,
      document_count: hubDocuments.length || hub.document_count || 0,
      created_at: property.created_at,
      updated_at: property.updated_at,
      primary_image_url: propertyDetails.primary_image_url || property.primary_image_url,
      bedrooms: propertyDetails.bedrooms,
      bathrooms: propertyDetails.bathrooms,
      size_sqft: propertyDetails.size_sqft || propertyDetails.square_footage,
      size_unit: propertyDetails.size_unit || 'sqft',
      year_built: propertyDetails.year_built,
      description: propertyDetails.description || propertyDetails.summary,
      notes: propertyDetails.notes,
      // Include property_details in propertyHub so PropertyDetailsPanel can display them (panel reads property.propertyHub.property_details)
      propertyHub: {
        documents: hubDocsFormatted,
        property_details: propertyDetails,
      },
    };
  });
  
  // Sort documents by most recently interacted
  const sortedDocs = allDocuments.sort((a, b) => {
    const aTime = a.updated_at ? new Date(a.updated_at).getTime() : new Date(a.created_at).getTime();
    const bTime = b.updated_at ? new Date(b.updated_at).getTime() : new Date(b.created_at).getTime();
    return bTime - aTime;
  });
  
  return { properties, documents: sortedDocs };
}

function extractHubsFromResponse(response: any): any[] {
  if (Array.isArray(response.data)) {
    return response.data;
  }
  if (response.data && typeof response.data === 'object') {
    if (Array.isArray((response.data as any).data)) return (response.data as any).data;
    if (Array.isArray((response.data as any).properties)) return (response.data as any).properties;
    if (Array.isArray((response.data as any).property_hubs)) return (response.data as any).property_hubs;
  }
  return [];
}

// Helper to transform all documents API response to our format
function transformAllDocumentsToData(allDocs: any[]): DocumentData[] {
  if (!Array.isArray(allDocs)) {
    console.warn('[ProjectsPage] transformAllDocumentsToData: allDocs is not an array:', allDocs);
    return [];
  }
  
  const transformed = allDocs.map((doc: any) => {
    // Handle both /api/documents and /api/files response formats
    const transformedDoc: DocumentData = {
      id: doc.id || doc.document_id || String(doc.id || doc.document_id),
      original_filename: doc.original_filename || doc.filename || doc.name || '',
      created_at: doc.created_at || doc.uploaded_at || doc.created || new Date().toISOString(),
      file_type: doc.file_type || doc.mime_type || doc.type,
      property_id: doc.property_id,
      cover_image_url: doc.cover_image_url || doc.thumbnail_url,
      first_page_image_url: doc.first_page_image_url,
      s3_path: doc.s3_path || doc.s3Path,
      updated_at: doc.updated_at || doc.last_updated || doc.modified || doc.created_at || doc.uploaded_at,
    };
    return transformedDoc;
  }).filter((doc: DocumentData) => {
    const isValid = doc.id && doc.original_filename;
    if (!isValid) {
      console.warn('[ProjectsPage] Filtered out invalid document:', doc);
    }
    return isValid;
  });
  
  console.log('[ProjectsPage] transformAllDocumentsToData: transformed', allDocs.length, 'to', transformed.length, 'valid documents');
  return transformed;
}

// Fixed number of files shown in the project section file bar (no scroll)
const FILES_BAR_COUNT = 8;

interface ProjectsPageProps {
  onCreateProject: () => void;
  sidebarWidth?: number;
  onPropertySelect?: (property: PropertyData) => void;
}

export const ProjectsPage: React.FC<ProjectsPageProps> = ({ onCreateProject, sidebarWidth = 0, onPropertySelect }) => {
  // Initialize with cached data immediately for instant display
  const cachedData = React.useMemo(() => getCachedData(), []);
  
  const [properties, setProperties] = React.useState<PropertyData[]>(cachedData?.properties || []);
  // Initialize allDocuments from cache so Files section shows instantly (same mechanism as projects)
  const [allDocuments, setAllDocuments] = React.useState<DocumentData[]>(cachedData?.documents || []); // Store all fetched documents
  const [documents, setDocuments] = React.useState<DocumentData[]>(cachedData?.documents || []); // Visible documents
  const [showAllProjects, setShowAllProjects] = React.useState(false);
  const [showAllFiles, setShowAllFiles] = React.useState(false);
  // Selection mode for delete: toggle with button, select cards, then delete selected
  const [isSelectionMode, setIsSelectionMode] = React.useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = React.useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = React.useState(false);
  // Only show loading if we have NO cached data
  const [isLoading, setIsLoading] = React.useState(!cachedData);
  // Show Files section immediately when we have cache (same as projects); otherwise after fetch completes
  const [documentsLoaded, setDocumentsLoaded] = React.useState(!!cachedData);
  const [error, setError] = React.useState<string | null>(null);
  const [, setCoversLoaded] = React.useState(0); // Trigger re-render when covers load

  // Preload document covers (images + PDF thumbnails) via shared util so cards render instantly
  const preloadDocumentCovers = React.useCallback((docs: DocumentData[]) => {
    preloadDocumentCoversUtil(docs as any, () => setCoversLoaded(v => v + 1));
  }, []);

  // Files bar shows first FILES_BAR_COUNT; cache for initial load
  React.useEffect(() => {
    if (allDocuments.length > 0) {
      const docsToShow = allDocuments.slice(0, FILES_BAR_COUNT);
      setDocuments(docsToShow);
      setCachedData(properties, docsToShow);
    }
  }, [allDocuments, properties]);

  // Fetch properties on mount - stale-while-revalidate pattern
  React.useEffect(() => {
    const fetchProperties = async () => {
      try {
        // If we have cached data, we're already displaying it - just fetch in background
        const hasCachedData = properties.length > 0;
        if (!hasCachedData) {
          setIsLoading(true);
        }
        
        console.log('[ProjectsPage] Fetching property hubs and all documents from API...');
        
        // Fetch both in parallel
        const [propertyHubsResponse, allDocumentsResponse] = await Promise.all([
          backendApi.getAllPropertyHubs(),
          backendApi.getDocuments(),
        ]);
        
        console.log('[ProjectsPage] Property hubs response:', propertyHubsResponse);
        console.log('[ProjectsPage] All documents response:', allDocumentsResponse);
        
        if (propertyHubsResponse.success && propertyHubsResponse.data) {
          const hubs = extractHubsFromResponse(propertyHubsResponse);
          console.log('[ProjectsPage] Extracted hubs:', hubs.length);
          const { properties: props, documents: propertyLinkedDocs } = transformHubsToData(hubs);
          console.log('[ProjectsPage] Property-linked documents:', propertyLinkedDocs.length, propertyLinkedDocs.map(d => d.original_filename));
          
          // Get all documents from the "all files" endpoint
          let allDocuments: DocumentData[] = [];
          if (allDocumentsResponse.success && allDocumentsResponse.data) {
            // /api/files returns { success: true, data: [...] } from server
            // fetchApi wraps it, so allDocumentsResponse.data = { success: true, data: [...] }
            // We need to extract the inner 'data' array
            let allDocsArray: any[] = [];
            
            if (Array.isArray(allDocumentsResponse.data)) {
              // Response is already an array (shouldn't happen with /api/files, but handle it)
              allDocsArray = allDocumentsResponse.data;
            } else if (allDocumentsResponse.data && typeof allDocumentsResponse.data === 'object') {
              // Response is wrapped: { success: true, data: [...] }
              if (Array.isArray((allDocumentsResponse.data as any).data)) {
                allDocsArray = (allDocumentsResponse.data as any).data;
              } else if (Array.isArray((allDocumentsResponse.data as any).documents)) {
                allDocsArray = (allDocumentsResponse.data as any).documents;
              } else {
                // Maybe the server returned the array directly in 'data'?
                console.warn('[ProjectsPage] Unexpected response structure:', allDocumentsResponse.data);
              }
            }
            
            console.log('[ProjectsPage] All documents response data type:', typeof allDocumentsResponse.data);
            console.log('[ProjectsPage] All documents response data:', allDocumentsResponse.data);
            console.log('[ProjectsPage] All documents array length:', allDocsArray.length);
            if (allDocsArray.length > 0) {
              console.log('[ProjectsPage] Sample document from API:', allDocsArray[0]);
            }
            
            allDocuments = transformAllDocumentsToData(allDocsArray);
            console.log('[ProjectsPage] Transformed all documents:', allDocuments.length, allDocuments.map(d => d.original_filename));
          } else {
            console.warn('[ProjectsPage] All documents response failed or empty:', allDocumentsResponse);
          }
          
          // Merge property-linked documents with all documents, deduplicating by ID
          const documentIdsSeen = new Set<string>(propertyLinkedDocs.map(d => d.id));
          const mergedDocuments = [...propertyLinkedDocs];
          console.log('[ProjectsPage] Before merge - property-linked:', propertyLinkedDocs.length, 'all documents:', allDocuments.length);
          
          // Add documents from "all files" that aren't already in property-linked set
          allDocuments.forEach(doc => {
            if (!documentIdsSeen.has(doc.id)) {
              documentIdsSeen.add(doc.id);
              mergedDocuments.push(doc);
            } else {
              console.log('[ProjectsPage] Skipping duplicate document:', doc.original_filename, doc.id);
            }
          });
          
          console.log('[ProjectsPage] After merge - total documents:', mergedDocuments.length);
          
          // Sort by most recently interacted (updated_at or created_at)
          const sortedDocs = mergedDocuments.sort((a, b) => {
            const aTime = a.updated_at ? new Date(a.updated_at).getTime() : new Date(a.created_at).getTime();
            const bTime = b.updated_at ? new Date(b.updated_at).getTime() : new Date(b.created_at).getTime();
            return bTime - aTime;
          });
          
          // Store all documents and limit visible ones
          setAllDocuments(sortedDocs);
          const docsToShow = sortedDocs.slice(0, FILES_BAR_COUNT);
          
          console.log('[ProjectsPage] Loaded:', props.length, 'properties,', mergedDocuments.length, 'total documents,', docsToShow.length, 'visible');
          console.log('[ProjectsPage] Visible document filenames:', docsToShow.map(d => d.original_filename));
          
          // Update state and cache
          setProperties(props);
          setDocuments(docsToShow);
          setCachedData(props, docsToShow);
          
          // Preload covers in background
          preloadDocumentCovers(docsToShow);
        } else if (!hasCachedData) {
          // Only clear if we don't have cached data
          setProperties([]);
          setDocuments([]);
        }
      } catch (err) {
        console.error('[ProjectsPage] Failed to fetch properties:', err);
        // Only show error if we have no cached data to display
        if (properties.length === 0) {
          setError(err instanceof Error ? err.message : 'Failed to load properties');
        }
      } finally {
        setIsLoading(false);
        setDocumentsLoaded(true); // Allow Files section to show (even if empty) once fetch has completed
      }
    };

    fetchProperties();
  }, []); // Only run on mount - documents state updated via effect when allDocuments changes

  const refreshProperties = async () => {
    try {
      const [propertyHubsResponse, allDocumentsResponse] = await Promise.all([
        backendApi.getAllPropertyHubs(),
        backendApi.getDocuments(),
      ]);
      
      if (propertyHubsResponse.success && propertyHubsResponse.data) {
        const hubs = extractHubsFromResponse(propertyHubsResponse);
        const { properties: props, documents: propertyLinkedDocs } = transformHubsToData(hubs);
        
        // Get all documents from the "all files" endpoint
        let allDocuments: DocumentData[] = [];
        if (allDocumentsResponse.success && allDocumentsResponse.data) {
          const allDocsArray = Array.isArray(allDocumentsResponse.data) 
            ? allDocumentsResponse.data 
            : [];
          allDocuments = transformAllDocumentsToData(allDocsArray);
        }
        
        // Merge and deduplicate
        const documentIdsSeen = new Set<string>(propertyLinkedDocs.map(d => d.id));
        const mergedDocuments = [...propertyLinkedDocs];
        
        allDocuments.forEach(doc => {
          if (!documentIdsSeen.has(doc.id)) {
            documentIdsSeen.add(doc.id);
            mergedDocuments.push(doc);
          }
        });
        
        // Sort by most recently interacted
        const sortedDocs = mergedDocuments.sort((a, b) => {
          const aTime = a.updated_at ? new Date(a.updated_at).getTime() : new Date(a.created_at).getTime();
          const bTime = b.updated_at ? new Date(b.updated_at).getTime() : new Date(b.created_at).getTime();
          return bTime - aTime;
        });
        
        // Store all documents and limit visible ones
        setAllDocuments(sortedDocs);
        const docsToShow = sortedDocs.slice(0, FILES_BAR_COUNT);
        
        setProperties(props);
        setDocuments(docsToShow);
        setCachedData(props, docsToShow);
      }
    } catch (err) {
      console.error('Failed to refresh properties:', err);
    }
  };

  // Toggle selection of a project (by id)
  const handleToggleSelect = React.useCallback((propertyId: string) => {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(propertyId)) next.delete(propertyId);
      else next.add(propertyId);
      return next;
    });
  }, []);

  // Delete selected projects and exit selection mode
  const handleDeleteSelected = React.useCallback(async () => {
    if (selectedProjectIds.size === 0) return;
    const msg = selectedProjectIds.size === 1
      ? 'Delete this project? This cannot be undone.'
      : `Delete ${selectedProjectIds.size} projects? This cannot be undone.`;
    if (!window.confirm(msg)) return;
    setIsDeleting(true);
    try {
      const ids = Array.from(selectedProjectIds);
      for (const id of ids) {
        const res = await backendApi.deleteProperty(id);
        if (!res.success) {
          console.error('[ProjectsPage] Failed to delete property:', id, res.error);
          setError(res.error || `Failed to delete project`);
        }
      }
      setSelectedProjectIds(new Set());
      setIsSelectionMode(false);
      await refreshProperties();
    } catch (err) {
      console.error('[ProjectsPage] Error deleting projects:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete projects');
    } finally {
      setIsDeleting(false);
    }
  }, [selectedProjectIds, refreshProperties]);

  // Handle document drop on a project card - links document to property
  const handleDocumentDrop = React.useCallback(async (documentId: string, propertyId: string) => {
    console.log('[ProjectsPage] Document dropped:', { documentId, propertyId });
    
    try {
      const response = await backendApi.linkDocumentToProperty(documentId, propertyId);
      
      if (response.success) {
        console.log('[ProjectsPage] Document linked successfully');
        
        // Update local document state to reflect the new property_id
        setDocuments(prevDocs => 
          prevDocs.map(doc => 
            doc.id === documentId ? { ...doc, property_id: propertyId } : doc
          )
        );
        setAllDocuments(prevDocs => 
          prevDocs.map(doc => 
            doc.id === documentId ? { ...doc, property_id: propertyId } : doc
          )
        );
        
        // Optionally refresh to get fresh data
        // await refreshProperties();
      } else {
        console.error('[ProjectsPage] Failed to link document:', response.error);
      }
    } catch (error) {
      console.error('[ProjectsPage] Error linking document:', error);
    }
  }, []);

  // Check if there are any properties
  const hasAnyProperties = properties && Array.isArray(properties) && properties.length > 0;
  
  // Debug logging
  console.log('[ProjectsPage] Render state:', { 
    isLoading, 
    error, 
    propertiesLength: properties?.length, 
    hasAnyProperties 
  });

  // Empty state - minimal, Claude/OpenAI-inspired design (fills parent so it adjusts to sidebar)
  const InitialEmptyState = () => (
    <div 
      className="absolute inset-0 flex flex-col items-center justify-center"
      style={{
        background: '#FCFCF9',
        pointerEvents: 'auto',
      }}
    >
      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-5">
        <FolderClosed className="w-8 h-8 text-gray-400" strokeWidth={1.5} />
      </div>
      <h3 className="text-base font-semibold text-gray-800 mb-1.5">No projects yet.</h3>
      <p style={{ fontSize: '13px', color: '#71717A', marginBottom: '20px' }}>
        No project? Let's change that. Create one now.
      </p>
      <button
        type="button"
        onClick={onCreateProject}
        className="px-3 py-1.5 bg-white text-gray-800 text-sm font-medium rounded-none transition-all duration-150 hover:bg-gray-100 hover:shadow-md active:bg-gray-200 active:shadow-sm"
        style={{
          border: '1px solid rgba(0, 0, 0, 0.15)',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
          cursor: 'pointer',
          pointerEvents: 'auto',
        }}
      >
        Create Project
      </button>
    </div>
  );

  // No loading spinner - instant snap loading
  // Content will populate as data arrives

  // Show error state (for real errors)
  if (error && !isLoading) {
    return (
      <div 
        className="w-full h-full flex flex-col items-center justify-center min-h-[60vh]"
        style={{ pointerEvents: 'auto' }}
      >
        <p className="text-red-500 mb-4">{error}</p>
        <button
          type="button"
          onClick={() => refreshProperties()}
          className="px-4 py-2 bg-gray-100 text-gray-900 rounded-lg hover:bg-gray-200 transition-colors"
          style={{ cursor: 'pointer', pointerEvents: 'auto' }}
        >
          Try Again
        </button>
      </div>
    );
  }

  // Show loading state when we have no data yet — avoids rendering main layout with
  // empty grid (0 height), which would push the Files section to the bottom and
  // then make it "click into place" when data loads.
  if (isLoading && !hasAnyProperties) {
    return (
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={{
          background: '#FCFCF9',
          pointerEvents: 'auto',
        }}
      >
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-5 animate-pulse">
          <FolderClosed className="w-8 h-8 text-gray-400" strokeWidth={1.5} />
        </div>
        <p style={{ fontSize: '13px', color: '#71717A' }}>Loading projects…</p>
      </div>
    );
  }

  // Show initial empty state when there are no properties at all (and not loading)
  if (!hasAnyProperties && !isLoading) {
    return (
      <div className="relative w-full h-full min-h-full">
        <InitialEmptyState />
      </div>
    );
  }

  // Show full page with cream background - fills parent tightly next to sidebar
  return (
    <div 
      className="relative w-full h-full min-h-0 overflow-y-auto"
      style={{
        background: '#FCFCF9',
        pointerEvents: 'auto',
      }}
    >
      {/* Top right: Select, View less/See All Files, Delete, Create Project */}
      <div
        className="absolute z-50 flex items-center gap-2"
        style={{
          top: '24px',
          right: '24px',
          pointerEvents: 'auto',
        }}
      >
        <button
          type="button"
          onClick={() => {
            setIsSelectionMode((prev) => !prev);
            if (isSelectionMode) setSelectedProjectIds(new Set());
          }}
          className="flex items-center gap-1 rounded-sm border border-transparent bg-black/[0.04] transition-all duration-150 hover:bg-[#d4d4d4] hover:shadow-md hover:border-gray-300 active:bg-[#cacaca] active:shadow-none"
          title={isSelectionMode ? 'Cancel selection' : 'Select projects to delete'}
          style={{
            padding: '5px 8px',
            height: '26px',
            minHeight: '26px',
            cursor: 'pointer',
            pointerEvents: 'auto',
          }}
        >
          <span className="text-[12px] font-normal text-[#666]" style={isSelectionMode ? { color: '#3B82F6' } : undefined}>Select</span>
        </button>
        {allDocuments.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAllFiles((prev) => !prev)}
            className="flex items-center gap-1 rounded-sm border border-transparent bg-black/[0.04] transition-all duration-150 hover:bg-[#d4d4d4] hover:shadow-md hover:border-gray-300 active:bg-[#cacaca] active:shadow-none"
            title={showAllFiles ? 'View less' : 'See all files'}
            style={{
              padding: '5px 8px',
              height: '26px',
              minHeight: '26px',
              cursor: 'pointer',
              pointerEvents: 'auto',
            }}
          >
            {showAllFiles ? (
              <>
                <ChevronUp className="w-3.5 h-3.5 text-[#666]" strokeWidth={1.75} />
                <span className="text-[12px] font-normal text-[#666]">View less</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5 text-[#666]" strokeWidth={1.75} />
                <span className="text-[12px] font-normal text-[#666]">See All Files</span>
              </>
            )}
          </button>
        )}
        {isSelectionMode && selectedProjectIds.size > 0 && (
          <button
            type="button"
            onClick={handleDeleteSelected}
            disabled={isDeleting}
            className="flex items-center gap-1 rounded-sm hover:bg-[#fef2f2] active:bg-[#fee2e2] transition-all duration-150 disabled:opacity-50"
            title="Delete selected projects"
            style={{
              padding: '5px 8px',
              height: '26px',
              minHeight: '26px',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              pointerEvents: 'auto',
            }}
          >
            <Trash2 className="w-3.5 h-3.5 text-red-600" strokeWidth={1.75} />
            <span className="text-[12px] font-normal text-red-600">Delete ({selectedProjectIds.size})</span>
          </button>
        )}
        <button
          type="button"
          onClick={onCreateProject}
          className="flex items-center gap-1 rounded-sm border border-transparent bg-black/[0.04] transition-all duration-150 hover:bg-[#d4d4d4] hover:shadow-md hover:border-gray-300 active:bg-[#cacaca] active:shadow-none"
          style={{
            padding: '5px 8px',
            height: '26px',
            minHeight: '26px',
            cursor: 'pointer',
            pointerEvents: 'auto',
          }}
        >
          <Plus className="w-3.5 h-3.5 text-[#666]" strokeWidth={1.75} />
          <span className="text-[12px] font-normal text-[#666]">Create Project</span>
        </button>
      </div>

      <div 
        className="w-full min-h-full flex flex-col box-border"
        style={{ 
          padding: '24px',
        }}
      >
        {/* Project Cards Section - hidden when "See All Files" is active */}
        {!showAllFiles && (
          <div style={{ marginTop: '24px', width: '100%', maxWidth: '100%', minWidth: 0 }}>
            <div 
              className="grid justify-start w-full"
              style={{ 
                gridTemplateColumns: 'repeat(6, 1fr)',
                gridAutoRows: '200px',
                gap: '28px 32px',
                maxWidth: '100%',
                maxHeight: showAllProjects ? '5000px' : '480px',
                minHeight: '200px',
                overflow: 'visible',
                minWidth: 0,
                pointerEvents: 'auto',
              }}
            >
              {properties.map(property => (
                <ProjectGlassCard 
                  key={property.id} 
                  property={property}
                  onDocumentDrop={handleDocumentDrop}
                  onClick={() => {
                    if (onPropertySelect) onPropertySelect(property);
                  }}
                  onMouseEnter={() => {
                    const docs = property.propertyHub?.documents;
                    if (docs?.length) preloadDocumentCovers(docs);
                  }}
                  selectionMode={isSelectionMode}
                  selected={selectedProjectIds.has(property.id)}
                  onToggleSelect={() => handleToggleSelect(property.id)}
                />
              ))}
            </div>
            {properties.length > 12 && (
              <button
                type="button"
                onClick={() => setShowAllProjects(prev => !prev)}
                className="mt-4 flex items-center gap-1 rounded-sm hover:bg-[#f0f0f0] active:bg-[#e8e8e8] transition-all duration-150"
                style={{
                  padding: '5px 8px',
                  height: '26px',
                  minHeight: '26px',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: 'rgba(0, 0, 0, 0.04)',
                  marginLeft: 0,
                  pointerEvents: 'auto',
                }}
              >
                {showAllProjects ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5 text-[#666]" strokeWidth={1.75} />
                    <span className="text-[12px] font-normal text-[#666]">Show less</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5 text-[#666]" strokeWidth={1.75} />
                    <span className="text-[12px] font-normal text-[#666]">See All Projects</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Flexible spacer - no growth when "See All Files" so files take all remaining space */}
        <div className={showAllFiles ? '' : 'flex-1'} style={{ minHeight: showAllFiles ? 0 : '80px', flex: showAllFiles ? 'none' : undefined }} />

        {/* Files area - only show once documents have loaded */}
        {documentsLoaded && (
          <div
            className={showAllFiles ? 'flex-1 flex flex-col min-h-0' : ''}
            style={{
              paddingBottom: showAllFiles ? 0 : '32px',
              marginLeft: 0,
              marginTop: showAllFiles ? 8 : 0,
              width: '100%',
              maxWidth: '100%',
              minWidth: 0,
              ...(showAllFiles && { overflow: 'auto' }),
            }}
          >
            {!showAllFiles && (
              <div className="flex items-center justify-between gap-2 mb-2" style={{ marginLeft: '0' }}>
                <span className="text-[12px] font-normal text-[#666]" style={{ opacity: allDocuments.length ? 1 : 0.6 }}>Files</span>
              </div>
            )}
            <RecentDocumentsSection
              documents={showAllFiles ? allDocuments : allDocuments.slice(0, FILES_BAR_COUNT)}
              compact
              scrollable={true}
              showAllMode={showAllFiles}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectsPage;

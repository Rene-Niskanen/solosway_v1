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
import { FolderOpen } from "lucide-react";
import { backendApi } from "@/services/backendApi";
import { ProjectGlassCard } from "./ProjectGlassCard";
import { RecentDocumentsSection } from "./RecentDocumentsSection";
import { preloadDocumentThumbnails } from "./RecentDocumentCard";

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
      preloadDocumentThumbnails(memoryCache.documents);
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
        preloadDocumentThumbnails(parsed.documents);
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
    preloadDocumentThumbnails(documents);
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
    
    // Collect documents from this hub
    hubDocuments.forEach((doc: any) => {
      if (doc.id && doc.original_filename && !documentIdsSeen.has(doc.id)) {
        documentIdsSeen.add(doc.id);
        allDocuments.push({
          id: doc.id,
          original_filename: doc.original_filename,
          created_at: doc.created_at || doc.uploaded_at || new Date().toISOString(),
          file_type: doc.file_type || doc.mime_type,
          property_id: property.id || hub.id,
          cover_image_url: doc.cover_image_url || doc.thumbnail_url,
          first_page_image_url: doc.first_page_image_url,
          s3_path: doc.s3_path,
          updated_at: doc.updated_at || doc.last_updated || doc.created_at || doc.uploaded_at,
        });
      }
    });
    
    return {
      id: property.id || hub.id,
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

// Calculate maximum visible documents based on viewport width
function calculateMaxVisibleDocuments(sidebarWidth: number): number {
  const cardWidth = 180;
  const gap = 20;
  const containerPadding = 48 * 2; // Both sides
  const marginLeft = 20;
  const availableWidth = window.innerWidth - sidebarWidth - containerPadding - marginLeft;
  const maxVisible = Math.floor(availableWidth / (cardWidth + gap));
  return Math.max(1, maxVisible); // At least show 1
}

interface ProjectsPageProps {
  onCreateProject: () => void;
  sidebarWidth?: number;
  onPropertySelect?: (property: PropertyData) => void;
}

export const ProjectsPage: React.FC<ProjectsPageProps> = ({ onCreateProject, sidebarWidth = 0, onPropertySelect }) => {
  // Initialize with cached data immediately for instant display
  const cachedData = React.useMemo(() => getCachedData(), []);
  
  const [properties, setProperties] = React.useState<PropertyData[]>(cachedData?.properties || []);
  const [allDocuments, setAllDocuments] = React.useState<DocumentData[]>([]); // Store all fetched documents
  const [documents, setDocuments] = React.useState<DocumentData[]>(cachedData?.documents || []); // Visible documents
  // Only show loading if we have NO cached data
  const [isLoading, setIsLoading] = React.useState(!cachedData);
  const [error, setError] = React.useState<string | null>(null);
  const [, setCoversLoaded] = React.useState(0); // Trigger re-render when covers load

  // Preload document covers (similar to PropertyDetailsPanel) - run in background, don't block
  const preloadDocumentCovers = React.useCallback((docs: DocumentData[]) => {
    if (!docs || docs.length === 0) return;
    
    // Initialize cache if it doesn't exist
    if (!(window as any).__preloadedDocumentCovers) {
      (window as any).__preloadedDocumentCovers = {};
    }
    
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
    
    // Process in background without blocking - use requestIdleCallback if available
    const processDoc = async (doc: DocumentData) => {
      // Skip if already cached
      if ((window as any).__preloadedDocumentCovers[doc.id]) return;
      
      const fileType = doc.file_type?.toLowerCase() || '';
      const fileName = doc.original_filename?.toLowerCase() || '';
      const isImage = fileType.includes('image') || /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName);
      
      // Only preload images for now (PDFs need more complex handling)
      if (!isImage) return;
      
      try {
        let downloadUrl: string;
        if (doc.s3_path) {
          downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(doc.s3_path)}`;
        } else {
          downloadUrl = `${backendUrl}/api/files/download?document_id=${doc.id}`;
        }
        
        const response = await fetch(downloadUrl, { credentials: 'include' });
        if (!response.ok) return;
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        (window as any).__preloadedDocumentCovers[doc.id] = {
          url: url,
          type: blob.type,
          timestamp: Date.now()
        };
        
        setCoversLoaded(v => v + 1);
      } catch (err) {
        // Silent fail - preloading is non-critical
      }
    };
    
    // Process docs in parallel batches without blocking UI
    docs.slice(0, 10).forEach(doc => {
      if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(() => processDoc(doc), { timeout: 5000 });
      } else {
        setTimeout(() => processDoc(doc), 100);
      }
    });
  }, []);

  // Calculate max visible documents (responsive to window resize)
  const [maxVisibleDocuments, setMaxVisibleDocuments] = React.useState(() => 
    calculateMaxVisibleDocuments(sidebarWidth)
  );

  // Update max visible on window resize
  React.useEffect(() => {
    const updateMaxVisible = () => {
      setMaxVisibleDocuments(calculateMaxVisibleDocuments(sidebarWidth));
    };
    
    window.addEventListener('resize', updateMaxVisible);
    updateMaxVisible(); // Initial calculation
    
    return () => window.removeEventListener('resize', updateMaxVisible);
  }, [sidebarWidth]);

  // Recalculate visible documents when maxVisibleDocuments changes
  React.useEffect(() => {
    if (allDocuments.length > 0) {
      const docsToShow = allDocuments.slice(0, maxVisibleDocuments);
      setDocuments(docsToShow);
      // Update cache with limited documents
      setCachedData(properties, docsToShow);
    }
  }, [maxVisibleDocuments, allDocuments, properties]);

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
          const docsToShow = sortedDocs.slice(0, maxVisibleDocuments);
          
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
      }
    };

    fetchProperties();
  }, []); // Only run on mount - maxVisibleDocuments updates will trigger re-render via state

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
        const docsToShow = sortedDocs.slice(0, maxVisibleDocuments);
        
        setProperties(props);
        setDocuments(docsToShow);
        setCachedData(props, docsToShow);
      }
    } catch (err) {
      console.error('Failed to refresh properties:', err);
    }
  };

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

  // Empty state - minimal, Claude/OpenAI-inspired design
  const InitialEmptyState = () => (
    <div 
      className="fixed flex flex-col items-center justify-center"
      style={{
        top: 0,
        left: sidebarWidth,
        right: 0,
        bottom: 0,
      }}
    >
      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-5">
        <FolderOpen className="w-8 h-8 text-gray-400" strokeWidth={1.5} />
      </div>
      <h3 className="text-base font-semibold text-gray-800 mb-1.5">No projects yet.</h3>
      <p style={{ fontSize: '13px', color: '#71717A', marginBottom: '20px' }}>
        No project? Let's change that. Create one now.
      </p>
      <button
        onClick={onCreateProject}
        className="px-3 py-1.5 bg-white text-gray-800 text-sm font-medium rounded-none transition-all duration-150 hover:bg-gray-50"
        style={{
          border: '1px solid rgba(0, 0, 0, 0.15)',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
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
        style={{
          paddingLeft: `${sidebarWidth}px`,
        }}
      >
        <p className="text-red-500 mb-4">{error}</p>
        <button
          onClick={() => refreshProperties()}
          className="px-4 py-2 bg-gray-100 text-gray-900 rounded-lg hover:bg-gray-200 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Show initial empty state when there are no properties at all (and not loading)
  if (!hasAnyProperties && !isLoading) {
    return <InitialEmptyState />;
  }

  // Show full page with gradient background - instant snap loading
  return (
    <div 
      className="fixed inset-0 overflow-y-auto"
      style={{
        left: sidebarWidth,
        background: 'linear-gradient(180deg, #C8C9CE 0%, #CEC4C5 50%, #A1AAB3 100%)',
      }}
    >
      {/* Create Project Button - Top Right (same style as empty state) */}
      <button
        onClick={onCreateProject}
        className="fixed z-50 px-3 py-1.5 bg-white text-gray-800 text-sm font-medium rounded-none transition-all duration-150 hover:bg-gray-50"
        style={{
          top: '24px',
          right: '24px',
          border: '1px solid rgba(0, 0, 0, 0.15)',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
        }}
      >
        Create Project
      </button>

      <div className="w-full max-w-7xl min-h-full flex flex-col" style={{ padding: '48px 40px' }}>
        {/* Project Cards Section - top portion, positioned with more left and top padding */}
        <div className="flex flex-wrap justify-start" style={{ gap: '44px', marginLeft: '48px', marginTop: '24px' }}>
          {properties.slice(0, 2).map(property => (
            <ProjectGlassCard 
              key={property.id} 
              property={property}
              onDocumentDrop={handleDocumentDrop}
              onClick={() => {
                console.log('🔥 ProjectGlassCard clicked:', property.id);
                console.log('🔥 onPropertySelect exists:', !!onPropertySelect);
                if (onPropertySelect) {
                  console.log('🔥 Calling onPropertySelect...');
                  onPropertySelect(property);
                  console.log('🔥 onPropertySelect called');
                } else {
                  console.error('❌ onPropertySelect is undefined!');
                }
              }}
            />
          ))}
        </div>
        
        {/* Flexible spacer to push documents toward bottom - ensures visual separation */}
        <div className="flex-1" style={{ minHeight: '150px' }} />
        
        {/* Files Docker - bottom portion, aligned right with project cards above */}
        <div style={{ paddingBottom: '48px', marginLeft: '48px', width: '100%', maxWidth: '100%' }}>
          <RecentDocumentsSection documents={documents} />
        </div>
      </div>
    </div>
  );
};

export default ProjectsPage;

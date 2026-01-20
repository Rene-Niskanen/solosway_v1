"use client";

import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Moon, Layers, Loader2 } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { mockPropertyHubData, transformPropertyHubForFrontend } from '../data/mockPropertyHubData';
import { useBackendApi } from './BackendApi';
import { backendApi as backendApiService } from '../services/backendApi';
import { PropertyDetailsPanel } from './PropertyDetailsPanel';
import { PropertyTitleCard } from './PropertyTitleCard';
import { DEFAULT_MAP_LOCATION_KEY } from './MainContent';
// import { openaiService, QueryAnalysis } from '../services/openai';

interface SquareMapProps {
  isVisible: boolean;
  searchQuery?: string;
  onLocationUpdate?: (location: { lat: number; lng: number; address: string }) => void;
  onSearch?: (query: string) => void;
  hasPerformedSearch?: boolean;
  isInChatMode?: boolean;
  containerStyle?: React.CSSProperties;
  isInteractive?: boolean; // Controls whether map responds to user interactions
  chatPanelWidth?: number; // Width of chat panel for centering calculations
  sidebarWidth?: number; // Width of sidebar for centering calculations
  onPropertyDetailsVisibilityChange?: (isOpen: boolean) => void; // Callback when PropertyDetailsPanel opens/closes
}

export interface SquareMapRef {
  updateLocation: (query: string) => Promise<void>;
  flyToLocation: (lat: number, lng: number, zoom?: number) => void;
  selectPropertyByAddress: (address: string, coordinates?: { lat: number; lng: number }, propertyId?: string, navigationOnly?: boolean) => void;
}

// Utility function to preload document covers
const preloadDocumentCoversForProperty = async (docs: any[]) => {
  if (!docs || docs.length === 0) return;
  
  // Initialize cache if it doesn't exist
  if (!(window as any).__preloadedDocumentCovers) {
    (window as any).__preloadedDocumentCovers = {};
  }
  
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
  
  // Prioritize first 6 documents (visible ones) - load them immediately
  const priorityDocs = docs.slice(0, 6);
  const remainingDocs = docs.slice(6);
  
  // Preload priority documents first with high priority
  const priorityPromises = priorityDocs.map(async (doc, index) => {
    const docId = doc.id;
    
    // Skip if already cached
    if ((window as any).__preloadedDocumentCovers[docId]) {
      return;
    }
    
    try {
      const fileType = doc.file_type || '';
      const fileName = doc.original_filename?.toLowerCase() || '';
      const isImage = fileType.includes('image') || fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i);
      const isPDF = fileType.includes('pdf') || fileName.endsWith('.pdf');
      
      // Only preload images and PDFs (they have visual covers)
      if (!isImage && !isPDF) {
        return;
      }
      
      let downloadUrl: string | null = null;
      if (doc.url || doc.download_url || doc.file_url || doc.s3_url) {
        downloadUrl = doc.url || doc.download_url || doc.file_url || doc.s3_url || null;
      } else if (doc.s3_path) {
        downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(doc.s3_path)}`;
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
  
  // Preload remaining documents in smaller batches
  if (remainingDocs.length > 0) {
    const BATCH_SIZE = 3;
    for (let i = 0; i < remainingDocs.length; i += BATCH_SIZE) {
      const batch = remainingDocs.slice(i, i + BATCH_SIZE);
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const batchPromises = batch.map(async (doc) => {
        const docId = doc.id;
        if ((window as any).__preloadedDocumentCovers[docId]) return;
        
        try {
          const fileType = doc.file_type || '';
          const fileName = doc.original_filename?.toLowerCase() || '';
          const isImage = fileType.includes('image') || fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i);
          const isPDF = fileType.includes('pdf') || fileName.endsWith('.pdf');
          
          if (!isImage && !isPDF) return;
          
          let downloadUrl: string | null = null;
          if (doc.url || doc.download_url || doc.file_url || doc.s3_url) {
            downloadUrl = doc.url || doc.download_url || doc.file_url || doc.s3_url || null;
          } else if (doc.s3_path) {
            downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(doc.s3_path)}`;
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
};

// Fetch documents and preload their covers
const fetchAndPreloadDocumentCovers = async (propertyId: string, backendApi: any) => {
  try {
    const response = await backendApi.getPropertyHubDocuments(propertyId);
    
    let documentsToUse = null;
    if (response && response.success && response.data) {
      if (response.data.documents && Array.isArray(response.data.documents)) {
        documentsToUse = response.data.documents;
      } else if (response.data.data && response.data.data.documents && Array.isArray(response.data.data.documents)) {
        documentsToUse = response.data.data.documents;
      } else if (Array.isArray(response.data)) {
        documentsToUse = response.data;
      }
    }
    
    if (documentsToUse && documentsToUse.length > 0) {
      // Store in preloaded files cache
      if (!(window as any).__preloadedPropertyFiles) {
        (window as any).__preloadedPropertyFiles = {};
      }
      (window as any).__preloadedPropertyFiles[propertyId] = documentsToUse;
      
      // Preload covers
      preloadDocumentCoversForProperty(documentsToUse);
    }
  } catch (error) {
    // Silently fail
  }
};

export const SquareMap = forwardRef<SquareMapRef, SquareMapProps>(({ 
  isVisible, 
  searchQuery,
  onLocationUpdate,
  onSearch,
  hasPerformedSearch = false,
  isInChatMode = false,
  containerStyle,
  isInteractive = true,
  chatPanelWidth = 0,
  sidebarWidth = 0,
  onPropertyDetailsVisibilityChange
}, ref) => {
  // Use refs to store current chat panel and sidebar widths so click handlers can access latest values
  const chatPanelWidthRef = useRef(chatPanelWidth);
  const sidebarWidthRef = useRef(sidebarWidth);
  
  // Update refs when props change
  useEffect(() => {
    chatPanelWidthRef.current = chatPanelWidth;
    sidebarWidthRef.current = sidebarWidth;
  }, [chatPanelWidth, sidebarWidth]);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const currentMarker = useRef<mapboxgl.Marker | null>(null);
  const defaultPreviewContainer = useRef<HTMLDivElement>(null);
  const lightPreviewContainer = useRef<HTMLDivElement>(null);
  const defaultPreviewMap = useRef<mapboxgl.Map | null>(null);
  const lightPreviewMap = useRef<mapboxgl.Map | null>(null);
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
  const backendApi = useBackendApi();
  // Store pending location change when map isn't visible
  const pendingLocationChange = useRef<{ coordinates: [number, number]; zoom: number } | null>(null);
  // Track last applied location to avoid unnecessary updates
  const lastAppliedLocation = useRef<{ coordinates: [number, number]; zoom: number } | null>(null);
  // Track last added properties to prevent duplicate additions
  const lastAddedPropertiesRef = useRef<string>('');
  // Store HTML property name markers
  const propertyMarkersRef = useRef<mapboxgl.Marker[]>([]);
  // Store the currently displayed property name marker
  const currentPropertyNameMarkerRef = useRef<mapboxgl.Marker | null>(null);
  // Store React root for PropertyTitleCard cleanup
  const currentPropertyTitleCardRootRef = useRef<any>(null);
  // Store zoom listener cleanup function for PropertyTitleCard scaling
  // Flag to prevent map click handler from deselecting when title card is clicked
  const titleCardClickedRef = useRef<boolean>(false);
  const propertyTitleCardZoomListenerRef = useRef<(() => void) | null>(null);
  // Store map click handler reference for deselection
  const mapClickHandlerRef = useRef<((e: any) => void) | null>(null);
  // Store the pin coordinates (user-set location) for the selected property
  // Property pin location = Final User-Selected Coordinates from Create Property Card
  // This is where the user placed/confirmed the pin, not document-extracted coordinates
  const selectedPropertyPinCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  // Track if we've already centered the map for this selection to prevent multiple flyTo calls
  const hasCenteredMapRef = useRef<{ lat: number; lng: number } | null>(null);
  // Track if we've just jumped to a property pin to prevent default location from overriding it
  const hasJumpedToPropertyPinRef = useRef<boolean>(false);
  
  // Helper function to get marker coordinates and store them
  // This stores the ACTUAL location of the green pin on the map (property pin location)
  // Cached property location is ALWAYS the property pin location, NEVER document-extracted coordinates
  const storeMarkerCoordinates = (marker: mapboxgl.Marker | null, propertyId?: string) => {
    if (marker) {
      try {
        const lngLat = marker.getLngLat();
        if (lngLat) {
          const coords = { lat: lngLat.lat, lng: lngLat.lng };
          selectedPropertyPinCoordsRef.current = coords;
          console.log('📍 Stored marker pin coordinates (green pin location):', coords);
          
          // Also store in localStorage so PropertyDetailsPanel can access them
          if (propertyId) {
            const markerCoordsKey = `markerPinCoords_${propertyId}`;
            localStorage.setItem(markerCoordsKey, JSON.stringify(coords));
            console.log('📍 Stored marker coordinates in localStorage for property:', propertyId, coords);
          }
        }
      } catch (e) {
        console.warn('Failed to get marker coordinates:', e);
      }
    }
  };
  // Helper function to update PropertyTitleCard marker scale based on zoom
  // Always scales with map zoom to maintain geographic size - smaller when zoomed out, larger when zoomed in
  const updateMarkerScale = (marker: mapboxgl.Marker | null, referenceZoom: number) => {
    if (!marker || !map.current) return;
    
    const currentZoom = map.current.getZoom();
    const markerElement = marker.getElement();
    if (!markerElement) {
      console.warn('PropertyTitleCard: Marker element not found for scaling');
      return;
    }
    
    // Get the scalable container (the inner div we created)
    const scalableContainer = (markerElement as any).scalableContainer;
    if (!scalableContainer) {
      console.warn('PropertyTitleCard: Scalable container not found');
      return;
    }
    
    // Always scale with zoom to maintain geographic size relative to map
    // At referenceZoom, scale is 1.0 (normal size)
    // When zoomed OUT (currentZoom < referenceZoom): scale < 1.0 (card gets smaller)
    // When zoomed IN (currentZoom > referenceZoom): scale > 1.0 (card gets larger)
    let scale = Math.pow(2, currentZoom - referenceZoom);
    
    // Clamp scale to reasonable bounds
    // Min: 0.05 (5% of original size) - allows card to become very small when zoomed out far
    // Max: 2.0 (200% of original size) - prevents card from becoming too large when zoomed in
    scale = Math.max(0.05, Math.min(2.0, scale));
    
    // Apply transform to the scalable container (inner div)
    scalableContainer.style.transform = `scale(${scale})`;
    
    // Debug logging removed to prevent console spam during zoom animations
    // Scale updates happen continuously during zoom, which is expected behavior
  };
  
  // Set up zoom listener for PropertyTitleCard scaling
  // Always scales with map zoom to maintain geographic size
  const setupMarkerZoomListener = (marker: mapboxgl.Marker) => {
    if (!map.current) {
      console.warn('PropertyTitleCard: Map not available for zoom listener setup');
      return;
    }
    
    // Clean up existing listener if any
    if (propertyTitleCardZoomListenerRef.current) {
      propertyTitleCardZoomListenerRef.current();
      propertyTitleCardZoomListenerRef.current = null;
    }
    
    // Use a moderate reference zoom (17.5) so card appears at a reasonable size at typical viewing zoom levels
    // This prevents the card from covering the property location while still being visible
    // At zoom 15: scale = 0.177 (17.7% - small but visible)
    // At zoom 17: scale = 0.707 (70.7% - good size)
    // At zoom 17.5: scale = 1.0 (100% - normal size)
    // At zoom 19: scale = 2.83 (283% - large when zoomed in close)
    const referenceZoom = 17.5;
    
    // Update scale immediately
    updateMarkerScale(marker, referenceZoom);
    
    // Set up zoom change listener - use 'zoom' event for smooth updates during zoom animations
    const zoomHandler = () => {
      updateMarkerScale(marker, referenceZoom);
    };
    
    // Also listen to 'zoomend' as a fallback to ensure scale is updated
    const zoomEndHandler = () => {
      updateMarkerScale(marker, referenceZoom);
    };
    
    // Listen to both 'zoom' (during animation) and 'zoomend' (after animation) events
    map.current.on('zoom', zoomHandler);
    map.current.on('zoomend', zoomEndHandler);
    
    // Store cleanup function
    propertyTitleCardZoomListenerRef.current = () => {
      if (map.current) {
        map.current.off('zoom', zoomHandler);
        map.current.off('zoomend', zoomEndHandler);
      }
    };
    
    console.log('PropertyTitleCard: Zoom listener set up');
  };
  
  // Store map click timeout for deselection
  const mapClickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Track if a property marker was just clicked (to prevent deselection)
  const propertyMarkerClickedRef = useRef<boolean>(false);
  // Store current properties array for click handler access
  const currentPropertiesRef = useRef<any[]>([]);
  // Store addPropertyMarkers function reference for use in useEffect
  const addPropertyMarkersRef = useRef<((properties: any[], shouldClearExisting?: boolean) => void) | null>(null);
  const propertyClickHandlerRef = useRef<((e: any) => void) | null>(null);
  
  // Debug: Log Mapbox token status
  React.useEffect(() => {
    console.log('🗺️ Mapbox Debug:', {
      hasToken: !!mapboxToken,
      tokenPrefix: mapboxToken ? mapboxToken.substring(0, 10) + '...' : 'MISSING',
      isVisible,
      hasContainer: !!mapContainer.current
    });
  }, [mapboxToken, isVisible]);
  
  // Property search states
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<any>(null);
  const [showPropertyCard, setShowPropertyCard] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [propertyMarkers, setPropertyMarkers] = useState<any[]>([]);
  const [selectedPropertyPosition, setSelectedPropertyPosition] = useState<{ x: number; y: number } | null>(null);
  // Default to the colored map theme on first load (user preference)
  const [isColorfulMap, setIsColorfulMap] = useState(true);
  const [isChangingStyle, setIsChangingStyle] = useState(false);
  const [defaultPreviewUrl, setDefaultPreviewUrl] = useState<string | null>(null);
  const [lightPreviewUrl, setLightPreviewUrl] = useState<string | null>(null);
  const [showPropertyDetailsPanel, setShowPropertyDetailsPanel] = useState(false);
  const [showPropertyTitleCard, setShowPropertyTitleCard] = useState(false);
  const [titleCardPropertyId, setTitleCardPropertyId] = useState<string | null>(null);
  const [isLargeCardMode, setIsLargeCardMode] = useState(false); // Track if panel should be displayed as large centered card

  // Notify parent when PropertyDetailsPanel visibility changes
  React.useEffect(() => {
    if (onPropertyDetailsVisibilityChange) {
      onPropertyDetailsVisibilityChange(showPropertyDetailsPanel);
    }
  }, [showPropertyDetailsPanel, onPropertyDetailsVisibilityChange]);

  // Close property card when navigating away from map view
  // BUT: Don't close if chat mode is active (user might be viewing property while in chat)
  React.useEffect(() => {
    if (!isVisible && !isInChatMode) {
      setShowPropertyDetailsPanel(false);
      setShowPropertyCard(false);
      setSelectedProperty(null);
    }
  }, [isVisible, isInChatMode]);

  // Ensure map container display matches isVisible prop
  React.useEffect(() => {
    if (mapContainer.current && map.current) {
      mapContainer.current.style.display = isVisible ? 'block' : 'none';
    }
  }, [isVisible]);

  // Track previous visibility to detect when map becomes visible
  const prevIsVisibleRef = React.useRef<boolean>(isVisible);
  
  // Clear selected property when opening map in default view (no pending selection)
  // This ensures that when clicking the map icon (not from a project selection),
  // any previously selected property is cleared
  React.useEffect(() => {
    // Only act when visibility changes from false to true
    const wasVisible = prevIsVisibleRef.current;
    const becameVisible = !wasVisible && isVisible;
    prevIsVisibleRef.current = isVisible;
    
    if (becameVisible && !isInChatMode) {
      console.log('🗺️ Map became visible - checking for instant display and pending selection');
      
      // Check for pending property selection
      
      // Check immediately for pending selection
      const pendingSelection = (window as any).__pendingPropertySelection;
      console.log('🗺️ Pending selection check:', pendingSelection ? 'Found' : 'None');
      
      // If there's NO pending selection, clear any previously selected property immediately
      // This happens when opening map in default view (not from a project selection)
      if (!pendingSelection) {
        console.log('🗺️ Opening map in default view - clearing previously selected property');
        
        // Clear state first
        setSelectedProperty(null);
        setShowPropertyDetailsPanel(false);
        setShowPropertyCard(false);
        
        // Clear any stale pending selection that might exist
        (window as any).__pendingPropertySelection = null;
        
        // Clear effects if map is ready (will be called by existing useEffect if map isn't ready yet)
        if (map.current) {
          clearSelectedPropertyEffects();
        }
      } else {
        console.log('🗺️ Pending selection exists - will select property:', pendingSelection.address);
      }
    }
  }, [isVisible, isInChatMode]);

  // NOTE: Recent projects are now only updated when user actually interacts:
  // - Files are uploaded/deleted via PropertyDetailsPanel
  // - Chat interactions happen (handled in MainContent/SideChatPanel)
  // This prevents recent projects from updating just by opening a property card

  // Listen for property pins updates (when new properties are created)
  // This ensures new pins appear immediately on the map when properties are created
  React.useEffect(() => {
    const handlePinsUpdate = (event: CustomEvent) => {
      const newPins = event.detail?.pins;
      if (newPins && Array.isArray(newPins) && newPins.length > 0) {
        console.log('🔄 Property pins updated - refreshing map markers:', newPins.length, 'pins');
        
        // Update in-memory cache
        (window as any).__preloadedProperties = newPins;
        
        // Update state to trigger map refresh
        // The state updates will trigger the existing map refresh logic
        setPropertyMarkers(newPins);
        setSearchResults(newPins);
        currentPropertiesRef.current = newPins;
        
        console.log('✅ Property pins cache updated - map will refresh with new pins');
      }
    };
    
    window.addEventListener('propertyPinsUpdated', handlePinsUpdate as EventListener);
    
    return () => {
      window.removeEventListener('propertyPinsUpdated', handlePinsUpdate as EventListener);
    };
  }, []);
  
  // Refresh map markers when propertyMarkers state changes (including when new pins are added)
  React.useEffect(() => {
    if (propertyMarkers.length > 0 && map.current && map.current.isStyleLoaded() && addPropertyMarkersRef.current) {
      // Small delay to ensure state has fully updated
      const timeoutId = setTimeout(() => {
        try {
          // Call addPropertyMarkers to refresh markers with updated pins
          addPropertyMarkersRef.current?.(propertyMarkers, true);
          console.log('✅ Map markers refreshed with updated property pins');
        } catch (error) {
          console.error('❌ Error refreshing map markers:', error);
        }
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
  }, [propertyMarkers.length]); // Only trigger when count changes (new pins added)

  // Helper function to truncate text
  const truncateText = (text: string, maxLength: number = 200) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  // Handler for property click to show property details panel
  const handlePropertyClick = (property: any) => {
    console.log('🏠 Property clicked:', {
      id: property.id,
      address: property.address,
      documentCount: property.documentCount,
      completenessScore: property.completenessScore,
      propertyHub: property.propertyHub
    });
    
    // Show the property details panel
    setShowPropertyDetailsPanel(true);
    
    // Log the property hub data for debugging
    if (property.propertyHub) {
      console.log('📄 Property Hub Data:', property.propertyHub);
      console.log('📄 Documents:', property.propertyHub.documents || []);
    }
  };

  // Debug selectedPropertyPosition changes
  useEffect(() => {
    // selectedPropertyPosition changed
  }, [selectedPropertyPosition]);


  // Property search functionality

  // Load properties from backend
  const loadProperties = async (retryCount = 0) => {
    if (!map.current) {
      if (retryCount < 5) {
        console.log(`🔄 Map not ready, retrying property load (attempt ${retryCount + 1}/5)...`);
        // Use shorter delay for faster loading (100ms instead of 200ms)
        setTimeout(() => loadProperties(retryCount + 1), 100);
        return;
      }
      console.warn('⚠️ Map not available after 5 attempts');
      return;
    }

    // Ensure map style is loaded before adding markers
    if (!map.current.isStyleLoaded()) {
      if (retryCount < 5) {
        console.log(`🔄 Map style not ready, retrying property load (attempt ${retryCount + 1}/5)...`);
        // Use shorter delay for faster loading (100ms instead of 200ms)
        setTimeout(() => loadProperties(retryCount + 1), 100);
        return;
      }
      console.warn('⚠️ Map style not ready after 5 attempts, proceeding anyway');
    }

    console.log('🗺️ Loading properties from backend...');
    
    // Check for preloaded properties first (Instagram-style preloading)
    // CRITICAL: Use preloaded pins exclusively - don't call getAllPropertyHubs if preloaded exists
    const preloadedProperties = (window as any).__preloadedProperties;
    if (preloadedProperties && Array.isArray(preloadedProperties) && preloadedProperties.length > 0) {
      console.log(`✅ Using ${preloadedProperties.length} preloaded properties (instant access! - NO backend call)`);
      
      // Validate that preloaded properties have coordinates
      const validPreloadedProperties = preloadedProperties.filter(p => 
        p.latitude != null && p.longitude != null && 
        typeof p.latitude === 'number' && typeof p.longitude === 'number' &&
        !isNaN(p.latitude) && !isNaN(p.longitude)
      );
      
      if (validPreloadedProperties.length === 0) {
        console.warn('⚠️ Preloaded properties exist but none have valid coordinates, falling back to getAllPropertyHubs');
        // Fall through to getAllPropertyHubs call below
      } else {
      // Set the search results and add markers immediately
        setSearchResults(validPreloadedProperties);
        setPropertyMarkers(validPreloadedProperties);
      
      // Prepare marker data immediately (don't wait for map)
        currentPropertiesRef.current = validPreloadedProperties;
      
      // Add markers with aggressive retry (faster rendering)
      const addMarkersWithRetry = (attempt = 0) => {
        if (!map.current) {
          if (attempt < 10) {
            // More aggressive retry - check every 50ms instead of 200ms
            setTimeout(() => addMarkersWithRetry(attempt + 1), 50);
            return;
          }
        }
        
        // Check if style is loaded, but don't wait too long
        if (!map.current.isStyleLoaded()) {
          if (attempt < 15) {
            setTimeout(() => addMarkersWithRetry(attempt + 1), 50);
            return;
          }
          // Proceed anyway if style takes too long
          console.warn('⚠️ Map style not ready, proceeding with marker addition anyway');
        }
        
        try {
          // Use requestAnimationFrame for smoother rendering
          requestAnimationFrame(() => {
              addPropertyMarkers(validPreloadedProperties, true);
              console.log(`✅ Successfully loaded and displayed ${validPreloadedProperties.length} preloaded properties`);
            
            // After properties are loaded, check if there's a pending property selection
            const pendingSelection = (window as any).__pendingPropertySelection;
            if (pendingSelection && pendingSelection.address) {
              console.log('📍 Preloaded properties ready, selecting pending property with pin location coordinates:', pendingSelection);
              (window as any).__pendingPropertySelection = null;
              // Pass the loaded properties directly to avoid state timing issues
              // Use property pin location coordinates (user-set) to center map on pin location
              requestAnimationFrame(() => {
                  selectPropertyByAddress(pendingSelection.address, pendingSelection.coordinates, pendingSelection.propertyId, false, 0, validPreloadedProperties);
              });
            }
          });
        } catch (error) {
          console.error('❌ Error adding markers:', error);
          if (attempt < 5) {
            setTimeout(() => addMarkersWithRetry(attempt + 1), 100);
          }
        }
      };
      
      // Start immediately
      addMarkersWithRetry();
      return; // Exit early - we used preloaded properties (NO SLOW getAllPropertyHubs call)
      }
    }
    
    // Only fetch from backend if NO preloaded properties exist OR they don't have coordinates
    // This should rarely happen if MainContent preloads pins correctly
    console.log('⚠️ No valid preloaded properties found, fetching from backend...');
    try {
      if (backendApi.status.isConnected) {
        console.log('🔗 Backend is connected, fetching property hubs...');
        let allPropertyHubs = await backendApi.getAllPropertyHubs();
        console.log('🔍 DEBUG - getAllPropertyHubs result:', allPropertyHubs);
        console.log('🔍 DEBUG - Is array?', Array.isArray(allPropertyHubs));
        console.log('🔍 DEBUG - Type:', typeof allPropertyHubs);
        console.log(`🗺️ Found ${allPropertyHubs?.length || 0} property hubs from backend`);
        
        // Handle undefined or non-array response
        if (!allPropertyHubs || !Array.isArray(allPropertyHubs)) {
          console.error('❌ Invalid property hubs response:', allPropertyHubs);
          allPropertyHubs = [];
        }
        
        // Transform property hub data to match expected format
        const transformedProperties = allPropertyHubs.map((hub: any) => {
          const property = hub.property || {};
          const propertyDetails = hub.property_details || {};
          const documents = hub.documents || [];
          
          const transformed = {
            id: property.id,
            address: property.formatted_address || property.normalized_address || '',
            postcode: '',
            property_type: propertyDetails.property_type || '',
            bedrooms: propertyDetails.number_bedrooms || 0,
            bathrooms: propertyDetails.number_bathrooms || 0,
            soldPrice: propertyDetails.sold_price || 0,
            rentPcm: propertyDetails.rent_pcm || 0,
            askingPrice: propertyDetails.asking_price || 0,
            price: propertyDetails.sold_price || propertyDetails.rent_pcm || propertyDetails.asking_price || 0,
            square_feet: propertyDetails.size_sqft || 0,
            days_on_market: propertyDetails.days_on_market || 0,
            latitude: property.latitude,
            longitude: property.longitude,
            summary: propertyDetails.notes || `${propertyDetails.property_type || 'Property'} in ${property.formatted_address || 'Unknown location'}`,
            features: propertyDetails.other_amenities || '',
            condition: propertyDetails.condition || 8,
            epc_rating: propertyDetails.epc_rating || '',
            tenure: propertyDetails.tenure || '',
            transaction_date: propertyDetails.last_transaction_date || '',
            similarity: 90,
            image: propertyDetails.primary_image_url || "/property-1.png",
          agent: {
            name: "John Bell",
            company: "harperjamesproperty36"
            },
            propertyHub: hub,
            documentCount: documents.length,
            completenessScore: hub.summary?.completeness_score || 0
          };
          
          // Debug: Log properties without coordinates
          if (!transformed.latitude || !transformed.longitude) {
            console.warn('⚠️ Property missing coordinates:', {
              id: transformed.id,
              address: transformed.address,
              latitude: transformed.latitude,
              longitude: transformed.longitude
            });
          }
          
          return transformed;
        });
        
        // Log how many properties have coordinates
        const propertiesWithCoords = transformedProperties.filter(p => 
          p.latitude != null && p.longitude != null && 
          typeof p.latitude === 'number' && typeof p.longitude === 'number' &&
          !isNaN(p.latitude) && !isNaN(p.longitude)
        );
        console.log(`📍 Properties with coordinates: ${propertiesWithCoords.length} / ${transformedProperties.length}`);
        
        // Set the search results and add markers
        setSearchResults(transformedProperties);
        setPropertyMarkers(transformedProperties);
        
        // Add markers with retry if map isn't ready
        const addMarkersWithRetry = (attempt = 0) => {
          if (!map.current || !map.current.isStyleLoaded()) {
            if (attempt < 5) {
              setTimeout(() => addMarkersWithRetry(attempt + 1), 200);
              return;
            }
          }
          try {
            addPropertyMarkers(transformedProperties, true);
            console.log(`✅ Successfully loaded and displayed ${transformedProperties.length} properties from backend`);
            
            // After properties are loaded, check if there's a pending property selection
            // This ensures we select the property as soon as it's available
            const pendingSelection = (window as any).__pendingPropertySelection;
            if (pendingSelection && pendingSelection.address) {
              console.log('📍 Properties loaded, selecting pending property with pin location coordinates:', pendingSelection.address, pendingSelection.coordinates);
              // Clear the pending selection immediately to prevent duplicate attempts
              (window as any).__pendingPropertySelection = null;
              // Pass the loaded properties directly to avoid state timing issues
              // Use a small delay to ensure state has updated
              // Use property pin location coordinates (user-set) to center map on pin location
              setTimeout(() => {
                selectPropertyByAddress(pendingSelection.address, pendingSelection.coordinates, pendingSelection.propertyId, false, 0, transformedProperties);
              }, 50);
            }
          } catch (error) {
            console.error('❌ Error adding markers:', error);
            // Retry once more
            if (attempt < 3) {
              setTimeout(() => addMarkersWithRetry(attempt + 1), 300);
            }
          }
        };
        
        addMarkersWithRetry();
      } else {
        console.log('⚠️ Backend not connected, no properties to display');
        setSearchResults([]);
        setPropertyMarkers([]);
      }
    } catch (error) {
      console.error('❌ Error loading properties:', error);
      setSearchResults([]);
      setPropertyMarkers([]);
    }
  };
  // Load comparable properties on map initialization

  const searchProperties = async (query: string) => {
    try {
      console.log('Searching properties for:', query);
      
      // Clear previous search results and markers first
      console.log('Clearing previous search results...');
      setSearchResults([]);
      setPropertyMarkers([]);
      setSelectedProperty(null);
      setShowPropertyCard(false);
      
      // Clear existing markers from map immediately and more thoroughly
      if (map.current) {
        console.log('Clearing map markers...');
        
        // Get all existing sources and layers
        const allSources = map.current.getStyle().sources;
        const allLayers = map.current.getStyle().layers;
        
        // Remove all property-related sources and layers (including hover layers)
        Object.keys(allSources).forEach(sourceId => {
          if (sourceId.startsWith('property') || sourceId.startsWith('outer') || sourceId.startsWith('hover')) {
            console.log(`Removing source: ${sourceId}`);
            if (map.current.getSource(sourceId)) {
              map.current.removeSource(sourceId);
            }
          }
        });
        
        // Remove all property-related layers (including hover layers)
        allLayers.forEach(layer => {
          if (layer.id.startsWith('property') || layer.id.startsWith('outer') || layer.id.startsWith('hover')) {
            console.log(`Removing layer: ${layer.id}`);
            if (map.current.getLayer(layer.id)) {
              map.current.removeLayer(layer.id);
            }
          }
        });
        
        // Also remove the main property layers
        const mainLayersToRemove = ['property-click-target', 'property-markers', 'property-outer'];
        mainLayersToRemove.forEach(layerId => {
          if (map.current.getLayer(layerId)) {
            console.log(`Removing main layer: ${layerId}`);
            map.current.removeLayer(layerId);
          }
        });
        
        // Remove main properties source if it exists
        if (map.current.getSource('properties')) {
          console.log('Removing main properties source');
          map.current.removeSource('properties');
        }
        
        // Force map to redraw to ensure markers are visually removed
        map.current.triggerRepaint();
      }
      
      // Force a longer delay to ensure clearing is complete before adding new markers
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Fetch property hubs from backend API
      console.log('🔍 Fetching property hubs from backend API...');
      let allPropertyHubs: any[] = await backendApi.getAllPropertyHubs();
      
      console.log('📦 Raw property hubs from backend:', allPropertyHubs);
      console.log('🏠 Property hubs array length:', allPropertyHubs.length);
      
      // Debug: Check for Park Street property specifically
      const parkStreetHub = allPropertyHubs.find(hub => 
        hub.property?.formatted_address && hub.property.formatted_address.includes('Park Street')
      );
      if (parkStreetHub) {
        console.log('🏠 Park Street property hub found:', {
          address: parkStreetHub.property?.formatted_address,
          sold_price: parkStreetHub.property_details?.sold_price,
          asking_price: parkStreetHub.property_details?.asking_price,
          rent_pcm: parkStreetHub.property_details?.rent_pcm,
          documentCount: parkStreetHub.documents?.length || 0,
          completenessScore: parkStreetHub.summary?.completeness_score || 0
        });
      } else {
        console.log('❌ Park Street property hub NOT found in backend response');
        console.log('Available addresses:', allPropertyHubs.map(hub => hub.property?.formatted_address).slice(0, 5));
      }
      
      // Ensure it's an array
      if (!Array.isArray(allPropertyHubs)) {
        console.error('❌ allPropertyHubs is not an array:', allPropertyHubs);
        allPropertyHubs = [];
      }
      
      // Transform property hub data to match expected format with flexible pricing
      const transformedProperties = allPropertyHubs.map((hub: any) => {
        const property = hub.property || {};
        const propertyDetails = hub.property_details || {};
        const documents = hub.documents || [];
        
        // Determine the best price to display and price type
        const soldPrice = propertyDetails.sold_price || 0;
        const askingPrice = propertyDetails.asking_price || 0;
        const rentPcm = propertyDetails.rent_pcm || 0;

        // 🔍 PHASE 1 DEBUG: Log raw property hub data for first few properties
        if (allPropertyHubs.indexOf(hub) < 3) {
          console.log(`🔍 PHASE 1 DEBUG - Property Hub ${allPropertyHubs.indexOf(hub) + 1}:`, {
            address: property.formatted_address,
            raw_sold_price: propertyDetails.sold_price,
            raw_rent_pcm: propertyDetails.rent_pcm,
            raw_asking_price: propertyDetails.asking_price,
            extracted_soldPrice: soldPrice,
            extracted_rentPcm: rentPcm,
            extracted_askingPrice: askingPrice,
            documentCount: documents.length,
            completenessScore: hub.summary?.completeness_score || 0,
            hub_keys: Object.keys(hub),
            property_keys: Object.keys(property),
            property_details_keys: Object.keys(propertyDetails)
          });
        }
        
        // Determine price type and value
        let displayPrice = 0;
        let priceType = 'sale';
        let priceLabel = 'Price';
        
        if (soldPrice > 0) {
          displayPrice = soldPrice;
          priceType = 'sale';
          priceLabel = 'Sold Price';
        } else if (askingPrice > 0) {
          displayPrice = askingPrice;
          priceType = 'sale';
          priceLabel = 'Asking Price';
        } else if (rentPcm > 0) {
          displayPrice = rentPcm;
          priceType = 'letting';
          priceLabel = 'Rent PCM';
        }
        
        // Determine if this is a letting comparable based on notes or rent data
        const isLettingComparable = rentPcm > 0 || 
          (propertyDetails.notes && propertyDetails.notes.toLowerCase().includes('letting')) ||
          (propertyDetails.notes && propertyDetails.notes.toLowerCase().includes('rent'));
        
        // Debug: Log price transformation for Park Street property
        if (property.formatted_address && property.formatted_address.includes('Park Street')) {
          console.log('💰 Park Street price transformation:', {
            original: {
              sold_price: propertyDetails.sold_price,
              asking_price: propertyDetails.asking_price,
              rent_pcm: propertyDetails.rent_pcm
            },
            calculated: {
              soldPrice,
              askingPrice,
              rentPcm,
              displayPrice,
              priceType,
              priceLabel
            }
          });
        }
        
        const transformedProperty = {
          id: property.id,
          address: property.formatted_address || property.normalized_address || '',
          postcode: '', // Extract from address if needed
          property_type: propertyDetails.property_type || '',
          bedrooms: propertyDetails.number_bedrooms || 0,
          bathrooms: propertyDetails.number_bathrooms || 0,
          price: displayPrice,
          priceType: priceType,
          priceLabel: priceLabel,
          soldPrice: soldPrice,
          askingPrice: askingPrice,
          rentPcm: rentPcm,
          isLettingComparable: isLettingComparable,
          square_feet: propertyDetails.size_sqft || 0,
          days_on_market: propertyDetails.days_on_market || 0,
          latitude: property.latitude,
          longitude: property.longitude,
          summary: propertyDetails.notes || `${propertyDetails.property_type || 'Property'} in ${property.formatted_address || 'Unknown location'}`,
          features: propertyDetails.other_amenities || '',
          condition: propertyDetails.condition || 8,
          epc_rating: propertyDetails.epc_rating || '',
          tenure: propertyDetails.tenure || '',
          transaction_date: propertyDetails.last_transaction_date || '',
          similarity: 90, // Default
          image: propertyDetails.primary_image_url || "/property-1.png",
          agent: {
            name: "John Bell",
            company: "harperjamesproperty36"
          },
          // New property hub specific fields
          propertyHub: hub,
          documentCount: documents.length,
          completenessScore: hub.summary?.completeness_score || 0
        };

        // 🔍 IMAGE DEBUG: Log image data for first few properties
        if (allPropertyHubs.indexOf(hub) < 3) {
          console.log(`🖼️ IMAGE DEBUG - Property Hub ${allPropertyHubs.indexOf(hub) + 1}:`, {
            address: transformedProperty.address,
            primary_image_url: propertyDetails.primary_image_url,
            final_image: transformedProperty.image,
            has_database_image: transformedProperty.image && !transformedProperty.image.includes('/property-1.png'),
            image_source: transformedProperty.image && transformedProperty.image.includes('/property-1.png') ? 'fallback' : 'database',
            documentCount: documents.length,
            completenessScore: hub.summary?.completeness_score || 0
          });
        }

        return transformedProperty;
      }).filter((prop: any) => prop.latitude && prop.longitude); // Only include geocoded properties
      
      console.log(`✅ Transformed ${transformedProperties.length} geocoded property hubs`);
      
      // Set the transformed properties as search results
      setSearchResults(transformedProperties);
      
      console.log(`🏠 Loaded ${transformedProperties.length} geocoded property hubs from Supabase`);
      
      // Debug: Check final Park Street property after transformation
      const finalParkStreetProp = transformedProperties.find(p => p.address && p.address.includes('Park Street'));
      if (finalParkStreetProp) {
        console.log('🏠 Final Park Street property hub after transformation:', {
          address: finalParkStreetProp.address,
          price: finalParkStreetProp.price,
          priceType: finalParkStreetProp.priceType,
          priceLabel: finalParkStreetProp.priceLabel,
          rentPcm: finalParkStreetProp.rentPcm,
          isLettingComparable: finalParkStreetProp.isLettingComparable,
          documentCount: finalParkStreetProp.documentCount,
          completenessScore: finalParkStreetProp.completenessScore
        });
      }
      
      // Use the properties directly from backend (no mock fallback)
      const propertiesToDisplay = transformedProperties;
      
      // If backend returns no properties, log it but don't use mock data
      if (propertiesToDisplay.length === 0) {
        console.warn('⚠️ No property hubs found in Supabase. Upload documents to see properties on map.');
      }
      
      const mockProperties = propertiesToDisplay; // Renamed for compatibility with existing code below
      
      // Skip the huge mock data array - removed for global search capability

      // Show ALL properties from backend (no complex filtering for now)
      console.log(`🗺️ Displaying ${mockProperties.length} properties from Supabase`);
      console.log('Properties:', mockProperties.map(p => ({ id: p.id, address: p.address })));
      
      // Use all properties (filtering disabled for now to show everything)
      setSearchResults(mockProperties);
      setPropertyMarkers(mockProperties);
      
      // Add markers to map (force clear existing)
      console.log(`📍 Adding ${mockProperties.length} markers to map...`);
      addPropertyMarkers(mockProperties, true);
      
      // Fit map to show all properties if we have results
      if (mockProperties.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        mockProperties.forEach(property => {
          bounds.extend([property.longitude, property.latitude]);
        });
        
        // Add minimal padding around the bounds for tighter field of view
        map.current.fitBounds(bounds, {
          padding: 50,
          maxZoom: 16
        });
      }
      
    } catch (error) {
      console.error('Error searching properties:', error);
    }
  };

  // Helper function to extract shortened property name from address
  const getPropertyName = (address: string): string | null => {
    if (!address) return null;
    
    // Try to extract a meaningful property name
    // Examples: "10 Park Drive, 8 Park Dr, London E14 9ZW, UK" -> "8 & 10 Park Drive"
    // "24 Rudthorpe Road" -> "24 Rudthorpe Road"
    
    // Split by comma to get parts
    const parts = address.split(',').map(p => p.trim());
    
    // If first part looks like a property address (contains numbers and street name)
    if (parts[0] && /^\d+/.test(parts[0])) {
      // Check if there's a second part that might be a variant (like "8 Park Dr")
      if (parts[1] && /^\d+/.test(parts[1])) {
        // Extract numbers from both parts
        const firstNum = parts[0].match(/^\d+/)?.[0];
        const secondNum = parts[1].match(/^\d+/)?.[0];
        const streetName = parts[0].replace(/^\d+\s*/, '').replace(/\s+\d+.*$/, '');
        
        if (firstNum && secondNum && streetName) {
          return `${secondNum} & ${firstNum} ${streetName}`;
        }
      }
      
      // Otherwise, just return the first part (e.g., "24 Rudthorpe Road")
      return parts[0];
    }
    
    return null;
  };

  // Add property markers to map using Mapbox's native symbol layers (most stable approach)
  const addPropertyMarkers = (properties: any[], shouldClearExisting: boolean = true) => {
    // Store function reference for use in useEffect
    addPropertyMarkersRef.current = addPropertyMarkers;
    
    if (!map.current) return;

    // Update the ref with current properties so click handler can access them
    currentPropertiesRef.current = properties;

    // Create a signature of the properties to detect if they've actually changed
    // Use faster comparison - only check IDs and count (not full JSON stringify)
    const propertiesSignature = properties.length + ':' + properties.slice(0, 10).map(p => p.id).join(',');
    
    // If properties haven't changed and source already exists, don't re-add
    if (!shouldClearExisting && propertiesSignature === lastAddedPropertiesRef.current) {
      console.log('📍 Properties unchanged, skipping marker re-addition');
      return;
    }
    
    lastAddedPropertiesRef.current = propertiesSignature;

    console.log(`addPropertyMarkers called with ${properties.length} properties, shouldClearExisting: ${shouldClearExisting}`);

    // Clear existing markers only if requested (not during style changes)
    if (shouldClearExisting) {
      console.log('Clearing existing markers in addPropertyMarkers...');
      
      // Clear current property name marker
      if (currentPropertyNameMarkerRef.current) {
        // Clean up zoom listener
        if (propertyTitleCardZoomListenerRef.current) {
          propertyTitleCardZoomListenerRef.current();
          propertyTitleCardZoomListenerRef.current = null;
        }
        currentPropertyNameMarkerRef.current.remove();
        currentPropertyNameMarkerRef.current = null;
      }
      
      // Get all existing sources and layers
      const allSources = map.current.getStyle().sources;
      const allLayers = map.current.getStyle().layers;
      
      // Remove all property-related sources and layers (including hover layers)
      Object.keys(allSources).forEach(sourceId => {
        if (sourceId.startsWith('property') || sourceId.startsWith('outer') || sourceId.startsWith('hover')) {
          console.log(`Removing source: ${sourceId}`);
          if (map.current.getSource(sourceId)) {
            map.current.removeSource(sourceId);
          }
        }
      });
      
      // Remove all property-related layers (including hover layers)
      allLayers.forEach(layer => {
        if (layer.id.startsWith('property') || layer.id.startsWith('outer') || layer.id.startsWith('hover')) {
          console.log(`Removing layer: ${layer.id}`);
          if (map.current.getLayer(layer.id)) {
            map.current.removeLayer(layer.id);
          }
        }
      });
      
      // Also remove the main property layers
      const mainLayersToRemove = ['property-click-target', 'property-markers', 'property-outer'];
      mainLayersToRemove.forEach(layerId => {
        if (map.current.getLayer(layerId)) {
          console.log(`Removing main layer: ${layerId}`);
          map.current.removeLayer(layerId);
        }
      });
      
      // Remove main properties source if it exists
      if (map.current.getSource('properties')) {
        console.log('Removing main properties source');
        map.current.removeSource('properties');
      }
    }

    // Add property data as a single unified GeoJSON source (more efficient)
    // Pre-validate and prepare features in one pass for faster rendering
    const validProperties = properties.filter(property => {
      // Fast validation - only check essential conditions
      return property.longitude != null && 
             property.latitude != null &&
             typeof property.longitude === 'number' &&
             typeof property.latitude === 'number' &&
             !isNaN(property.longitude) &&
             !isNaN(property.latitude);
    });
    
    console.log(`Creating unified source with ${validProperties.length} properties`);
    
    // Create GeoJSON features in one batch operation
    // Create empty GeoJSON if no valid properties (so we can add properties later)
    const geojson: GeoJSON.FeatureCollection = validProperties.length > 0 ? {
      type: 'FeatureCollection',
      features: validProperties.map(property => {
          // Use coordinates directly (already validated as numbers)
          const lng = property.longitude;
          const lat = property.latitude;
          
          // Extract property name for every property automatically
          const propertyName = getPropertyName(property.address);
          
          return {
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: [lng, lat] as [number, number] // Fixed: [longitude, latitude] for GeoJSON
            },
            properties: {
              id: property.id,
              address: property.address,
              propertyName: propertyName || property.address, // Store extracted property name
              price: property.price,
              bedrooms: property.bedrooms,
              bathrooms: property.bathrooms,
              squareFeet: property.squareFeet,
              type: property.type,
              condition: property.condition,
              features: property.features,
              summary: property.summary,
              image: property.image,
              agent: property.agent
            }
          };
        })
    } : {
      type: 'FeatureCollection',
      features: []
    };

    // Optimized: Check if source exists and update it instead of removing/re-adding
    // This is much faster - updating data is instant vs removing/re-adding
    const existingSource = map.current.getSource('properties') as mapboxgl.GeoJSONSource;
    if (existingSource) {
      // Fast path: Just update the data (much faster than remove/add)
      existingSource.setData(geojson);
      console.log('✅ Updated existing properties source (fast path)');
    } else {
      // Only add if source doesn't exist
      try {
        map.current.addSource('properties', {
          type: 'geojson',
          data: geojson
        });
        console.log('✅ Properties source added successfully');
      } catch (error) {
        console.error('❌ Error adding properties source:', error);
        return;
      }
    }

      // Add layers only if they don't exist (faster - no re-creation)
      // IMPORTANT: Layers must be added AFTER source is created/updated
      const layersToAdd = [
        {
          id: 'property-click-target',
          type: 'circle' as const,
          paint: {
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              10, 40,  // Much larger click area at low zoom
              15, 50,  // Larger click area at mid zoom
              20, 60   // Large click area at high zoom
            ],
            'circle-color': 'transparent',
            'circle-stroke-width': 0
          }
        },
        {
          id: 'property-outer',
          type: 'circle' as const,
          paint: {
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              10, 8,
              15, 12,
              20, 16
            ],
            'circle-color': 'rgba(0, 0, 0, 0.08)',
            'circle-stroke-width': 0
          }
        },
        {
          id: 'property-markers',
          type: 'circle' as const,
          paint: {
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              10, 6,
              15, 8,
              20, 10
            ],
            'circle-color': '#ffffff', // White default
            'circle-stroke-width': 2,
            'circle-stroke-color': '#000000', // Black border
            'circle-opacity': 1.0
          }
        }
      ];

      // Batch add layers (faster than individual checks)
      layersToAdd.forEach(layerConfig => {
        if (!map.current.getLayer(layerConfig.id)) {
          try {
          map.current.addLayer({
            id: layerConfig.id,
            type: layerConfig.type,
            source: 'properties',
            paint: layerConfig.paint as any // Type assertion for Mapbox paint properties
          });
            console.log(`✅ Added layer: ${layerConfig.id}`);
          } catch (error) {
            console.error(`❌ Error adding layer ${layerConfig.id}:`, error);
          }
        } else {
          console.log(`⚠️ Layer ${layerConfig.id} already exists, skipping`);
        }
      });
      
      // Verify source has data
      const source = map.current.getSource('properties') as mapboxgl.GeoJSONSource;
      if (source) {
        const sourceData = source._data as GeoJSON.FeatureCollection;
        const featureCount = sourceData?.features?.length || 0;
        console.log(`✅ Property marker layers ready. Source has ${featureCount} features.`);
      } else {
        console.error('❌ Properties source not found after layer creation!');
      }

    // Don't create HTML markers initially - they'll be shown when a property is clicked and zoomed in

    // Add click handler for the markers with individual property animation
    // Use component-level ref to access current properties (updated on each addPropertyMarkers call)
    // IMPORTANT: This handler must fire BEFORE the general map click handler
    // Remove existing handler first to prevent duplicate handlers
    if (propertyClickHandlerRef.current && map.current) {
      map.current.off('click', 'property-click-target', propertyClickHandlerRef.current);
    }
    
    // Create the click handler function
    const propertyClickHandler = (e: any) => {
      // CRITICAL: If title card is already visible for this property, skip pin click logic
      // This prevents re-creating the title card when clicking on it during navigation
      const clickedPropertyId = e.features?.[0]?.properties?.id;
      if (clickedPropertyId && showPropertyTitleCard && titleCardPropertyId === clickedPropertyId.toString()) {
        console.log('⏭️ Property pin clicked but title card already visible - skipping pin click handler');
        return; // Title card is already shown, don't recreate it
      }
      
      console.log('🎯 Property-click-target handler fired!', {
        features: e.features?.length,
        feature_properties: e.features[0]?.properties
      });
      
      // Stop event propagation to prevent general map click handler from firing
      e.originalEvent.stopPropagation();
      
      // Mark that a property marker was clicked to prevent deselection (safety measure)
      propertyMarkerClickedRef.current = true;
      // Reset flag after a short delay
      setTimeout(() => {
        propertyMarkerClickedRef.current = false;
      }, 100);
      
      // Cancel any pending map click timeout
      if (mapClickTimeoutRef.current) {
        clearTimeout(mapClickTimeoutRef.current);
        mapClickTimeoutRef.current = null;
      }
      
      const feature = e.features[0];
      
      if (!feature) {
        console.warn('⚠️ No feature found in property-click-target click event');
        return;
      }
      
      // Use properties from component-level ref (updated each time addPropertyMarkers is called)
      const currentProperties = currentPropertiesRef.current;
      
      // 🔍 PHASE 1 DEBUG: Debug property selection
      console.log('🔍 PHASE 1 DEBUG - Property Selection:', {
        feature_id: feature.properties.id,
        properties_array_length: currentProperties.length,
        properties_sample: currentProperties.slice(0, 2).map(p => ({ 
          id: p.id, 
          address: p.address, 
          soldPrice: p.soldPrice,
          rentPcm: p.rentPcm,
          askingPrice: p.askingPrice,
          has_price_data: !!(p.soldPrice || p.rentPcm || p.askingPrice)
        }))
      });
      
      const property = currentProperties.find(p => p.id === feature.properties.id);
      
      if (!property) {
        console.warn('⚠️ Property not found in currentProperties:', {
          feature_id: feature.properties.id,
          currentProperties_count: currentProperties.length,
          currentProperties_ids: currentProperties.map(p => p.id).slice(0, 5)
        });
        return;
      }
      
        console.log('📍 Marker clicked:', property.address);
        
        // PRELOAD: Start loading documents and covers in background (fire and forget)
        try {
          if (property.id) {
            backendApiService.preloadPropertyDocuments(String(property.id)).catch(() => {});
          }
        } catch (e) {
          // Ignore preload errors - shouldn't block pin click
        }
        
        // 🔍 PHASE 1 DEBUG: Show which array the property was found in
        const foundInProperties = currentProperties.some(p => p.id === feature.properties.id);
        console.log('🔍 PHASE 1 DEBUG - Property Source:', {
          found_in_properties: foundInProperties,
          property_source: 'currentProperties'
        });
        
        // 🔍 PHASE 1 DEBUG: Comprehensive selected property data analysis
        console.log('🔍 PHASE 1 DEBUG - Selected Property Data:', {
          address: property.address,
          soldPrice: property.soldPrice,
          rentPcm: property.rentPcm,
          askingPrice: property.askingPrice,
          isLettingComparable: property.isLettingComparable,
          price: property.price,
          priceType: property.priceType,
          priceLabel: property.priceLabel,
          raw_property_data: property
        });
        
        // 🔍 PHASE 1 DEBUG: Price validation checks
        console.log('🔍 PHASE 1 DEBUG - Price Validation:', {
          soldPrice_exists: property.soldPrice !== undefined,
          soldPrice_value: property.soldPrice,
          soldPrice_gt_zero: property.soldPrice > 0,
          rentPcm_exists: property.rentPcm !== undefined,
          rentPcm_value: property.rentPcm,
          rentPcm_gt_zero: property.rentPcm > 0,
          askingPrice_exists: property.askingPrice !== undefined,
          askingPrice_value: property.askingPrice,
          askingPrice_gt_zero: property.askingPrice > 0
        });
      
        // Clear any existing selected property effects first
        clearSelectedPropertyEffects();
        
        // Get property ID string for comparison
        const propertyIdStr = property.id?.toString() || null;
        
        // Check if title card is already visible for this property
        if (showPropertyTitleCard && titleCardPropertyId === propertyIdStr) {
          // Title card already visible for this property - clicking pin again deselects it
          console.log('📍 Pin clicked again - deselecting property');
          clearSelectedPropertyEffects();
          setShowPropertyTitleCard(false);
          setTitleCardPropertyId(null);
          setSelectedProperty(null);
          setShowPropertyCard(false);
          setShowPropertyDetailsPanel(false);
          
          // Remove property name marker
        if (currentPropertyNameMarkerRef.current) {
            // Clean up React root if it exists
            if (currentPropertyTitleCardRootRef.current) {
              try {
                currentPropertyTitleCardRootRef.current.unmount();
              } catch (e) {
                console.warn('Error unmounting PropertyTitleCard root:', e);
              }
              currentPropertyTitleCardRootRef.current = null;
            }
            // Clean up zoom listener
            if (propertyTitleCardZoomListenerRef.current) {
              propertyTitleCardZoomListenerRef.current();
              propertyTitleCardZoomListenerRef.current = null;
            }
          currentPropertyNameMarkerRef.current.remove();
          currentPropertyNameMarkerRef.current = null;
          }
          return;
        }
        
        // KEY LOGIC: If PropertyDetailsPanel is open for a different property, close it when clicking a new pin
        const currentSelectedPropertyId = selectedProperty?.id?.toString() || null;
        const isDifferentProperty = currentSelectedPropertyId && currentSelectedPropertyId !== propertyIdStr;
        
        if (isDifferentProperty && showPropertyDetailsPanel) {
          console.log('📍 Different property pin clicked - closing previous PropertyDetailsPanel');
          setShowPropertyDetailsPanel(false);
          setShowPropertyCard(false);
        }
        
        // Hide previous title card if different property
        if (titleCardPropertyId && titleCardPropertyId !== propertyIdStr) {
          setShowPropertyTitleCard(false);
          setTitleCardPropertyId(null);
        }
        
        // Remove any existing property name marker (always clean up before showing new one)
        // CRITICAL: This cleanup happens for ALL pin clicks, not just recent projects
        if (currentPropertyNameMarkerRef.current) {
          console.log('🧹 Cleaning up existing PropertyTitleCard marker before pin click');
          // Clean up React root if it exists
          if (currentPropertyTitleCardRootRef.current) {
            try {
              currentPropertyTitleCardRootRef.current.unmount();
            } catch (e) {
              console.warn('Error unmounting PropertyTitleCard root:', e);
            }
            currentPropertyTitleCardRootRef.current = null;
          }
          // Clean up zoom listener
          if (propertyTitleCardZoomListenerRef.current) {
            propertyTitleCardZoomListenerRef.current();
            propertyTitleCardZoomListenerRef.current = null;
          }
          // Remove the marker from the map
          try {
          currentPropertyNameMarkerRef.current.remove();
          } catch (e) {
            console.warn('Error removing marker:', e);
          }
          currentPropertyNameMarkerRef.current = null;
        }
        // Also clear title card state
        setShowPropertyTitleCard(false);
        setTitleCardPropertyId(null);
      
      // Show property title card (NEW: two-step click logic)
      // First click on pin shows title card, second click on card opens PropertyDetailsPanel
      if (property.longitude && property.latitude && map.current) {
        // Create outer container div (Mapbox marker wrapper)
            const markerElement = document.createElement('div');
        markerElement.className = 'property-title-card-marker';
            markerElement.style.cssText = `
              position: relative;
              display: flex;
              flex-direction: column;
              align-items: center;
          pointer-events: auto;
        `;
        
        // Create inner scalable container for the React component
        // This is what we'll scale with zoom
        const scalableContainer = document.createElement('div');
        scalableContainer.className = 'property-title-card-scalable';
        scalableContainer.style.cssText = `
                position: relative;
          transform-origin: bottom center;
          transition: none;
          pointer-events: auto; /* Only the card content captures clicks */
          user-select: text; /* Allow text selection */
          -webkit-user-select: text; /* Safari */
        `;
        markerElement.appendChild(scalableContainer);
        
        // Store reference to scalable container for zoom updates
        (markerElement as any).scalableContainer = scalableContainer;
        
        // Disable map dragging when hovering over the card to allow text selection
        // Attach to scalableContainer since it has pointer-events: auto
        scalableContainer.addEventListener('mouseenter', () => {
          if (map.current) {
            map.current.dragPan.disable();
          }
          
          // Preload document covers on hover for faster loading when clicked
          if (property?.id && backendApi) {
            const propertyId = property.id;
            const preloadedFiles = (window as any).__preloadedPropertyFiles?.[propertyId];
            if (preloadedFiles && Array.isArray(preloadedFiles) && preloadedFiles.length > 0) {
              preloadDocumentCoversForProperty(preloadedFiles);
            } else {
              fetchAndPreloadDocumentCovers(propertyId, backendApi);
            }
          }
        });
        
        scalableContainer.addEventListener('mouseleave', () => {
          if (map.current) {
            map.current.dragPan.enable();
          }
        });
        
        // Also prevent map drag on mousedown when selecting text
        scalableContainer.addEventListener('mousedown', (e) => {
          // Allow text selection - don't stop propagation
          // The dragPan.disable() from mouseenter should handle preventing map drag
        });
        
        // CRITICAL: Prevent map click events from firing when clicking on the marker
        // Stop propagation in bubble phase (not capture) so React onClick fires first
        markerElement.addEventListener('click', (e) => {
          e.stopPropagation();
          console.log('🛑 Marker element click - preventing map click handler');
        }, false); // Bubble phase - let React onClick fire first, then stop propagation to map
        
        // Also stop mousedown propagation to prevent map drag
        markerElement.addEventListener('mousedown', (e) => {
          e.stopPropagation();
        }, false);
        
        // ALSO add click handler to scalableContainer to catch clicks that might not bubble to markerElement
        // Stop propagation immediately - React's synthetic events will still fire
        scalableContainer.addEventListener('click', (e) => {
          e.stopPropagation();
          console.log('🛑 Scalable container click - preventing map click handler');
        }, false);
        
        scalableContainer.addEventListener('mousedown', (e) => {
          e.stopPropagation();
        }, false);
        
        // Handle card click - opens PropertyDetailsPanel above the title card
        const handleCardClick = () => {
          console.log('📍 Property title card clicked - opening PropertyDetailsPanel above title card');
          
          // Set flag to prevent map click handler from deselecting (backup)
          titleCardClickedRef.current = true;
          // Clear flag after a short delay to allow map click handler to check it
          setTimeout(() => {
            titleCardClickedRef.current = false;
          }, 200); // Increased timeout to ensure map handler checks it
          
          // Preload document covers immediately when title card is clicked
          if (property?.id && backendApi) {
            const propertyId = property.id;
            // Check if we already have preloaded files
            const preloadedFiles = (window as any).__preloadedPropertyFiles?.[propertyId];
            if (preloadedFiles && Array.isArray(preloadedFiles) && preloadedFiles.length > 0) {
              // Preload covers for existing documents
              preloadDocumentCoversForProperty(preloadedFiles);
            } else {
              // Fetch documents and preload covers
              fetchAndPreloadDocumentCovers(propertyId, backendApi);
            }
          }
          
          // Store pin coordinates
          if (property.latitude && property.longitude) {
            selectedPropertyPinCoordsRef.current = { lat: property.latitude, lng: property.longitude };
          }
          // Calculate position for PropertyDetailsPanel above the title card
          // The title card is positioned above the pin, so we position PropertyDetailsPanel above the title card
          if (map.current && property.longitude && property.latitude) {
            const point = map.current.project([property.longitude, property.latitude]);
            // Get map container position to convert to viewport coordinates
            const mapContainer = map.current.getContainer();
            const containerRect = mapContainer.getBoundingClientRect();
            // Position PropertyDetailsPanel using the SAME logic as PropertyTitleCard
            // PropertyTitleCard uses: anchor: 'bottom', offset: [0, -(pinRadius + gapAbovePin)]
            // This means the title card's bottom center is at: pin Y - (pinRadius + gapAbovePin)
            // Title card height is 360px, so its top is at: pin Y - (pinRadius + gapAbovePin) - 360
            // PropertyDetailsPanel should be positioned above the title card with a gap
            // Use the same anchor logic: bottom center of PropertyDetailsPanel should align with pin X (same as PropertyTitleCard)
            const titleCardHeight = 360;
            const pinRadius = 10;
            const gapAbovePin = 20; // Gap between pin and title card bottom (same as PropertyTitleCard)
            const titleCardBottomY = point.y - (pinRadius + gapAbovePin); // Where title card bottom is
            const titleCardTopY = titleCardBottomY - titleCardHeight; // Where title card top is
            const panelGap = 20; // Gap between PropertyDetailsPanel and title card
            // Position PropertyDetailsPanel so its bottom is above the title card top with a gap
            // The pin X position is where both cards should be centered (same as PropertyTitleCard anchor: 'bottom')
            setSelectedPropertyPosition({
              x: containerRect.left + point.x, // Pin X position (same as PropertyTitleCard - will be centered with translate(-50%))
              y: containerRect.top + titleCardTopY - panelGap // Position above title card with gap
            });
          }
          // Set selected property - this will trigger the useEffect to re-center if chat panel width changes
          setSelectedProperty(property);
          setShowPropertyCard(true);
          setShowPropertyDetailsPanel(true);
          setIsLargeCardMode(true); // Enable large card mode (positioned above title card)
          setIsExpanded(false);
          setShowFullDescription(false);
          // Keep title card visible (it should remain below PropertyDetailsPanel)
          
          // Also re-center immediately when title card is clicked (in case chat panel is open)
          if (map.current && property.longitude && property.latitude && chatPanelWidth > 0) {
            const propertyPinCoordinates: [number, number] = [property.longitude, property.latitude];
            const cardHeight = 360;
            const verticalOffset = (cardHeight / 2) - 40;
            
            // CRITICAL: Mapbox offset is relative to the map container, not the viewport
            const mapContainer = map.current.getContainer();
            const containerRect = mapContainer.getBoundingClientRect();
            const containerWidth = containerRect.width;
            const containerLeft = containerRect.left;
            
            const leftEdge = chatPanelWidth + sidebarWidth;
            const visibleWidth = containerWidth - (leftEdge - containerLeft);
            const visibleCenterX = leftEdge + (visibleWidth / 2);
            const containerCenterX = containerLeft + (containerWidth / 2);
            const horizontalOffset = (visibleCenterX - containerCenterX);
            
            console.log('📍 Title card clicked - re-centering with chat panel:', {
              chatPanelWidth,
              containerWidth,
              containerLeft,
              horizontalOffset,
              source: 'title-card-click'
            });
            
            map.current.flyTo({
              center: propertyPinCoordinates,
              zoom: map.current.getZoom(),
              duration: 300,
              offset: [horizontalOffset, verticalOffset],
              essential: true
            });
          }
        };
        
        // Render PropertyTitleCard component into scalable container
        try {
          const root = createRoot(scalableContainer);
          root.render(
            <PropertyTitleCard
              property={property}
              onCardClick={handleCardClick}
            />
          );
          
          // Store root reference for cleanup
          currentPropertyTitleCardRootRef.current = root;
        } catch (error) {
          console.error('Error rendering PropertyTitleCard:', error);
        }
        
        // No need for click listener - pointer-events handles it:
        // markerElement has pointer-events: none (doesn't block map clicks)
        // scalableContainer has pointer-events: auto (only card content captures clicks)
        // Map click handler will detect clicks outside the card and deselect
        
        // Calculate offset for positioning (PropertyTitleCard without green pin)
        // Position the card raised above the pin so it doesn't overlap
        const cardHeight = 360; // Approximate card height (image + details, no pin/pointer)
        const pinRadius = 10; // Approximate pin radius
        const gapAbovePin = 20; // Gap between pin and card bottom
        const verticalOffset = -(pinRadius + gapAbovePin); // Negative Y moves upward
            
        // Anchor at bottom center and raise card above the pin
            const marker = new mapboxgl.Marker({
              element: markerElement,
          anchor: 'bottom',
          offset: [0, verticalOffset] // Raise card above pin
            })
              .setLngLat([property.longitude, property.latitude])
              .addTo(map.current);
            
            // Store marker reference for cleanup
            currentPropertyNameMarkerRef.current = marker;
        
        // Set up zoom listener - card stays fixed size when zoomed in, scales down when zoomed out
        setupMarkerZoomListener(marker);
        
        // Update state to show title card
        setShowPropertyTitleCard(true);
        setTitleCardPropertyId(propertyIdStr);
        }
        
        // Smoothly fly to the property location, centering card and pin in the center of the visible map area
        const propertyCoordinates: [number, number] = [property.longitude, property.latitude];
        // Calculate offset to center the card and pin
        // Card is positioned above the pin, so offset down slightly to center both
        const cardHeight = 360; // Approximate card height
        const verticalOffset = (cardHeight / 2) - 40; // Offset down to center, then move up slightly
        
        // Calculate horizontal offset to center in the visible map area (between chat panel and screen edge)
        // CRITICAL: Mapbox offset is relative to the map container, not the viewport
        // Use refs to get current values (handler might have been created before chat panel opened)
        const currentChatPanelWidth = chatPanelWidthRef.current;
        const currentSidebarWidth = sidebarWidthRef.current;
        
        // Get the map container's actual dimensions and position
        const mapContainer = map.current.getContainer();
        const containerRect = mapContainer.getBoundingClientRect();
        const containerWidth = containerRect.width;
        const containerLeft = containerRect.left;
        
        // Calculate the center of the visible map area (accounting for chat panel and sidebar)
        const leftEdge = currentChatPanelWidth + currentSidebarWidth; // Left edge of visible map area (right edge of chat panel)
        const visibleWidth = containerWidth - (leftEdge - containerLeft); // Width of visible map area within container
        const visibleCenterX = leftEdge + (visibleWidth / 2); // Center of visible area in viewport coordinates
        const containerCenterX = containerLeft + (containerWidth / 2); // Center of map container in viewport coordinates
        
        // Calculate offset relative to map container center (Mapbox expects this)
        const horizontalOffset = (visibleCenterX - containerCenterX);
        
        console.log('📍 Property pin clicked - centering calculation:', {
          chatPanelWidth: currentChatPanelWidth,
          sidebarWidth: currentSidebarWidth,
          containerWidth,
          containerLeft,
          leftEdge,
          visibleWidth,
          visibleCenterX,
          containerCenterX,
          horizontalOffset,
          windowWidth: window.innerWidth,
          source: 'pin-click',
          usingRefs: true
        });
        
        // Store property pin coordinates for re-centering when chat panel width changes
        if (property.latitude && property.longitude) {
          selectedPropertyPinCoordsRef.current = { lat: property.latitude, lng: property.longitude };
        }
        
        // First, center the property (with correct offset for chat panel) at current zoom
        const currentZoom = map.current.getZoom();
        map.current.flyTo({
          center: propertyCoordinates,
          zoom: currentZoom, // Keep current zoom level for centering
          duration: 600, // Smooth centering animation
          essential: true,
          offset: [horizontalOffset, verticalOffset], // Center horizontally in visible map area
          easing: (t) => {
            // Smooth easing for centering
            return t < 0.5
              ? 2 * t * t
              : 1 - Math.pow(-2 * t + 2, 2) / 2;
          }
        });
        
        // Then, after centering completes, zoom in smoothly
        setTimeout(() => {
          if (map.current) {
            map.current.flyTo({
              center: propertyCoordinates,
              zoom: 17.5, // Zoom in to property
              duration: 1000, // Smooth zoom animation
              essential: true,
              offset: [horizontalOffset, verticalOffset], // Maintain offset during zoom
              easing: (t) => {
                // Smooth easing for zoom
                return t < 0.5
                  ? 2 * t * t
                  : 1 - Math.pow(-2 * t + 2, 2) / 2;
              }
            });
            
            // Open property details panel after zoom animation completes
            // Total animation time: 600ms (center) + 1000ms (zoom) = 1600ms
            // Wait 1700ms to ensure animation is fully complete
            setTimeout(() => {
              setShowPropertyDetailsPanel(true);
            }, 1700);
          }
        }, 650); // Start zoom after centering completes (600ms + 50ms buffer)
        
        console.log('✅ Property pin clicked - flyTo called with offset:', [horizontalOffset, verticalOffset]);
        
        // Make the base marker transparent (instead of hiding) so click target remains active
        // IMPORTANT: property-click-target layer is separate from property-markers and remains fully functional
        // The property-click-target layer is a map layer (not HTML), so it works even with HTML markers
        // Since PropertyTitleCard's green pin has pointer-events: none, clicks on it pass through to the map layer
        // This ensures clicks still work while only showing the PropertyTitleCard's green pin
        if (map.current.getLayer('property-markers')) {
          // Set selected property pin to green, others to white
          map.current.setPaintProperty('property-markers', 'circle-color', [
            'case',
            ['==', ['get', 'id'], property.id],
            '#D1D5DB', // Light grey for selected property
            '#ffffff' // White for others
          ]);
          // Keep selected property visible (green pin) and others visible too
          map.current.setPaintProperty('property-markers', 'circle-opacity', 1.0);
        }
        // Note: property-click-target layer remains active and clickable - it's not affected by marker opacity
        
        // Hide the outer ring for selected property
        if (map.current && map.current.getLayer('property-outer')) {
          map.current.setFilter('property-outer', [
            '!=',
            ['get', 'id'],
            property.id
          ]);
        }
        
        // Don't create individual marker layers - the unified HTML marker handles everything
        // The HTML marker already includes the green circle pin, so we don't need separate map layers
        
      // NEW: Two-step click logic - pin click only shows title card
      // PropertyDetailsPanel will open when title card is clicked (handled in handleCardClick)
      // Don't open PropertyDetailsPanel immediately here
        
        // Don't preload files when clicking a pin - let PropertyDetailsPanel load them lazily
        // This prevents blocking the property card from rendering quickly
        
        // Calculate position using map.project
        const geometry = feature.geometry as GeoJSON.Point;
        const coordinates: [number, number] = [geometry.coordinates[0], geometry.coordinates[1]];
        const point = map.current.project(coordinates);
        
        setSelectedPropertyPosition({
          x: point.x,
          y: point.y - 20
        });
    };
    
    // Store the handler reference and register it
    propertyClickHandlerRef.current = propertyClickHandler;
    map.current.on('click', 'property-click-target', propertyClickHandler);

    // Add map click handler to deselect property when clicking outside the PropertyTitleCard
    // IMPORTANT: This handler fires AFTER layer-specific handlers
    // Remove existing handler first to prevent duplicate handlers
    if (mapClickHandlerRef.current && map.current) {
      map.current.off('click', mapClickHandlerRef.current);
    }
    
    const mapClickHandler = (e: any) => {
      console.log('🗺️ General map click handler fired', {
        point: e.point,
        hasFeatures: e.features?.length > 0,
        showPropertyTitleCard,
        titleCardPropertyId,
        selectedProperty: !!selectedProperty
      });
      
      // First check if click is on a property marker - if so, don't deselect (property-click-target handler handles it)
      const features = map.current.queryRenderedFeatures(e.point, {
        layers: ['property-click-target', 'property-outer', 'property-markers']
      });
      
      // If click is on a property marker, don't deselect (the property-click-target handler will handle it)
      if (features.length > 0) {
        console.log('🗺️ Map click detected on property marker - skipping deselection', {
          featureCount: features.length,
          featureIds: features.map(f => f.properties?.id)
        });
        return;
      }
      
      // Also check if a property marker was just clicked (safety measure via ref)
      // But only skip if the flag was set very recently (within 50ms)
      if (propertyMarkerClickedRef.current) {
        console.log('🗺️ Property marker click flag set - skipping deselection');
        return;
      }
      
      // Check if title card was just clicked (prevents race condition)
      if (titleCardClickedRef.current) {
        console.log('🗺️ Title card click flag set - skipping deselection');
        return;
      }
      
      // Check if click is on the PropertyTitleCard element
      // Since markerElement has pointer-events: none, only clicks on the card content will reach here
      const clickedElement = e.originalEvent.target as HTMLElement;
      if (clickedElement) {
        // Check if click is on PropertyTitleCard card content (scalable container)
        const cardContent = clickedElement.closest('.property-title-card-scalable');
        if (cardContent) {
          // Click is on card content - don't deselect (card click handler will handle it)
          console.log('🗺️ Map click detected on PropertyTitleCard content - skipping deselection');
          return;
        }
        // Also check if click is on the marker element itself
        const markerElement = clickedElement.closest('.property-title-card-marker');
        if (markerElement) {
          // Click is on marker element - don't deselect
          console.log('🗺️ Map click detected on PropertyTitleCard marker - skipping deselection');
          return;
        }
      }
      
      // Click is on the map but not on a property marker or PropertyTitleCard - deselect PropertyTitleCard
      // Check if PropertyTitleCard marker exists (more reliable than checking state)
      if (currentPropertyNameMarkerRef.current) {
        // Don't deselect if PropertyDetailsPanel is open - user might be interacting with it
        if (showPropertyDetailsPanel) {
          console.log('🗺️ PropertyDetailsPanel is open - skipping deselection');
          return;
        }
        
        console.log('🗺️ Map clicked outside property title card - deselecting');
        
        // Clear the PropertyTitleCard and selected property
        clearSelectedPropertyEffects();
        setShowPropertyTitleCard(false);
        setTitleCardPropertyId(null);
        setSelectedProperty(null);
        setShowPropertyCard(false);
        setShowPropertyDetailsPanel(false);
        
        // Remove property name marker
        // Clean up React root if it exists
        if (currentPropertyTitleCardRootRef.current) {
          try {
            currentPropertyTitleCardRootRef.current.unmount();
          } catch (e) {
            console.warn('Error unmounting PropertyTitleCard root:', e);
          }
          currentPropertyTitleCardRootRef.current = null;
        }
        // Clean up zoom listener
        if (propertyTitleCardZoomListenerRef.current) {
          propertyTitleCardZoomListenerRef.current();
          propertyTitleCardZoomListenerRef.current = null;
        }
        currentPropertyNameMarkerRef.current.remove();
        currentPropertyNameMarkerRef.current = null;
      }
    };
    
    // Store handler reference and register it
    mapClickHandlerRef.current = mapClickHandler;
    map.current.on('click', mapClickHandler);

    // Add simple hover effects for property layers
    const propertyLayers = ['property-click-target', 'property-outer', 'property-markers'];
    
    propertyLayers.forEach(layerId => {
      map.current.on('mouseenter', layerId, () => {
        map.current.getCanvas().style.cursor = 'pointer';
      });

      map.current.on('mouseleave', layerId, () => {
        map.current.getCanvas().style.cursor = '';
      });
    });

    // Store empty array since we're using layers now
    setPropertyMarkers([]);
    
    console.log(`addPropertyMarkers completed. Added ${properties.length} markers to map.`);
  };


  // Helper function to clean up PropertyTitleCard marker completely
  const cleanupPropertyTitleCardMarker = () => {
    if (currentPropertyNameMarkerRef.current) {
      console.log('🧹 cleanupPropertyTitleCardMarker: Removing PropertyTitleCard marker');
      // Clean up React root if it exists
      if (currentPropertyTitleCardRootRef.current) {
        try {
          currentPropertyTitleCardRootRef.current.unmount();
        } catch (e) {
          console.warn('Error unmounting PropertyTitleCard root:', e);
        }
        currentPropertyTitleCardRootRef.current = null;
      }
      // Clean up zoom listener
      if (propertyTitleCardZoomListenerRef.current) {
        propertyTitleCardZoomListenerRef.current();
        propertyTitleCardZoomListenerRef.current = null;
      }
      // Remove the marker from the map
      try {
        currentPropertyNameMarkerRef.current.remove();
      } catch (e) {
        console.warn('Error removing PropertyTitleCard marker:', e);
      }
      currentPropertyNameMarkerRef.current = null;
    }
    // Clear title card state
    setShowPropertyTitleCard(false);
    setTitleCardPropertyId(null);
  };

  // Clear selected property effects
  const clearSelectedPropertyEffects = () => {
    // Remove property name marker if it exists
    if (currentPropertyNameMarkerRef.current) {
      // Clean up React root if it exists
      if (currentPropertyTitleCardRootRef.current) {
        try {
          currentPropertyTitleCardRootRef.current.unmount();
        } catch (e) {
          console.warn('Error unmounting PropertyTitleCard root:', e);
        }
        currentPropertyTitleCardRootRef.current = null;
      }
      // Clean up zoom listener
      if (propertyTitleCardZoomListenerRef.current) {
        propertyTitleCardZoomListenerRef.current();
        propertyTitleCardZoomListenerRef.current = null;
      }
      currentPropertyNameMarkerRef.current.remove();
      currentPropertyNameMarkerRef.current = null;
    }
    // Clear pin coordinates
    selectedPropertyPinCoordsRef.current = null;
    if (map.current) {
      // Restore base marker layers to show all properties (reset to white and fully visible)
      if (map.current.getLayer('property-markers')) {
        // Reset all pins to white (default color) and fully visible
        map.current.setPaintProperty('property-markers', 'circle-color', '#ffffff');
        map.current.setPaintProperty('property-markers', 'circle-opacity', 1.0);
        map.current.setFilter('property-markers', null);
      }
      if (map.current.getLayer('property-outer')) {
        map.current.setFilter('property-outer', null);
      }
      
      // Clear all possible property effect layers
      const allLayers = map.current.getStyle().layers;
        allLayers.forEach(layer => {
          if (layer.id.startsWith('property-') && layer.id !== 'property-markers' && layer.id !== 'property-outer' && layer.id !== 'property-click-target') {
            if (map.current.getLayer(layer.id)) {
              map.current.removeLayer(layer.id);
            }
          }
        });
      
      // Clear all possible property effect sources
      const allSources = Object.keys(map.current.getStyle().sources);
      allSources.forEach(sourceId => {
        if (sourceId.startsWith('property-') && sourceId !== 'properties') {
          if (map.current.getSource(sourceId)) {
            map.current.removeSource(sourceId);
          }
        }
      });
    }
  };

  // Clear effects when property card is closed (but not during programmatic selection)
  useEffect(() => {
    if (!showPropertyCard && !showPropertyDetailsPanel && selectedProperty) {
      clearSelectedPropertyEffects();
    }
  }, [showPropertyCard, showPropertyDetailsPanel, selectedProperty]);

  // Don't clear effects when searchResults change if we have a selected property
  // This prevents clearing the marker during transitions
  useEffect(() => {
    // Only clear if we don't have a selected property with an open panel
    // This prevents clearing during programmatic property selection
    if (!selectedProperty || (!showPropertyCard && !showPropertyDetailsPanel)) {
      // Only clear if nothing is selected - don't interfere with active selections
      if (!selectedProperty) {
        clearSelectedPropertyEffects();
      }
    }
  }, [searchResults]);

  // Removed: Property name marker creation - no longer needed

  // Handle click outside to deselect property (same pattern as dropdown menu)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Handle clicks when property is selected (either details panel is open OR just title is showing)
      if (!selectedProperty) return;

      const target = event.target as Node;
      const targetElement = target as Element;
      
      // SPECIFIC RULE: Only close property card if click is EXPLICITLY on map or property panel
      // Do NOT close for "anywhere outside" - be specific about what closes it
      
      // Check if click is on the property details panel - allow closing
      const propertyPanel = document.querySelector('[data-property-panel]');
      if (propertyPanel && propertyPanel.contains(target)) {
        return; // Click is on property panel itself - don't close
      }

      // Check if click is on the map canvas - allow closing
      const mapCanvas = map.current?.getCanvasContainer();
      if (mapCanvas && mapCanvas.contains(target)) {
        // Click is on the map - check if it's on a property marker layer
        if (map.current) {
          const mapContainer = map.current.getContainer();
          const mapRect = mapContainer.getBoundingClientRect();
          
          // Convert screen coordinates to map coordinates
          const mapPoint = [
            event.clientX - mapRect.left,
            event.clientY - mapRect.top
          ];
          
          // Check if click is on a property marker
          const features = map.current.queryRenderedFeatures(mapPoint as [number, number], {
            layers: ['property-click-target', 'property-markers', 'property-outer']
          });
          
          // If no property features were clicked, deselect (clicked on empty map area)
          if (features.length === 0) {
            clearSelectedPropertyEffects();
            setSelectedProperty(null);
            setShowPropertyCard(false);
            setShowPropertyDetailsPanel(false);
            
            // Remove property name marker
            if (currentPropertyNameMarkerRef.current) {
              // Clean up React root if it exists
              if (currentPropertyTitleCardRootRef.current) {
                try {
                  currentPropertyTitleCardRootRef.current.unmount();
                } catch (e) {
                  console.warn('Error unmounting PropertyTitleCard root:', e);
                }
                currentPropertyTitleCardRootRef.current = null;
              }
              // Clean up zoom listener
              if (propertyTitleCardZoomListenerRef.current) {
                propertyTitleCardZoomListenerRef.current();
                propertyTitleCardZoomListenerRef.current = null;
              }
              currentPropertyNameMarkerRef.current.remove();
              currentPropertyNameMarkerRef.current = null;
            }
          }
        }
        return;
      }

      // Click is NOT on map or property panel - KEEP PROPERTY CARD OPEN
      // Do NOT close for clicks anywhere else (chat, sidebar, etc.)
      return;
    };

    // Listen for clicks when property is selected (either details panel open OR just title showing)
    if (selectedProperty) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showPropertyDetailsPanel, selectedProperty, isInChatMode]);

  // Basic query processing (OpenAI temporarily disabled)
  const processQueryWithLLM = async (query: string): Promise<any> => {
    try {
      console.log('🧠 Basic Analysis starting for:', query);
      
      // Fallback to rule-based analysis
      const lowerQuery = query.toLowerCase().trim();
      
      // Postcode detection
      if (/^[a-z]{1,2}\d[a-z\d]?\s?\d[a-z]{2}$/i.test(query)) {
        return {
          processedQuery: query.toUpperCase(),
          searchType: 'postcode',
          confidence: 0.9,
          reasoning: 'Detected UK postcode format (fallback)',
          extractedLocation: query.toUpperCase(),
          searchIntent: 'postcode search'
        };
      }
      
      // Address detection
      if (/\d/.test(query)) {
        return {
          processedQuery: query,
          searchType: 'address',
          confidence: 0.8,
          reasoning: 'Contains numbers, likely an address (fallback)',
          extractedLocation: query,
          searchIntent: 'address search'
        };
      }
      
      // Bristol area detection - comprehensive list
      const areaKeywords = [
        'clifton', 'bishopston', 'redland', 'stokes croft', 'montpelier', 
        'st pauls', 'easton', 'bedminster', 'southville', 'windmill hill',
        'hotwells', 'kingsdown', 'cotham', 'redcliffe', 'temple meads',
        'st werburghs', 'st george', 'fishponds', 'brislington', 'knowle',
        'stockwood', 'hartcliffe', 'withywood', 'henbury', 'westbury',
        'filton', 'patchway', 'stapleton', 'shirehampton', 'avonmouth',
        'sea mills', 'stoke bishop', 'westbury park', 'henleaze', 'st andrews'
      ];
      
      const isKnownArea = areaKeywords.some(keyword => 
        lowerQuery.includes(keyword)
      );
      
      if (isKnownArea) {
        return {
          processedQuery: query,
          searchType: 'area',
          confidence: 0.9,
          reasoning: 'Recognized Bristol area (fallback)',
          extractedLocation: query,
          searchIntent: 'area search'
        };
      }
      
      // Landmark detection
      const landmarkKeywords = [
        'university', 'hospital', 'station', 'airport', 'park', 'bridge',
        'cathedral', 'museum', 'gallery', 'theatre', 'stadium'
      ];
      
      const isLandmark = landmarkKeywords.some(keyword => 
        lowerQuery.includes(keyword)
      );
      
      if (isLandmark) {
        return {
          processedQuery: query,
          searchType: 'landmark',
          confidence: 0.7,
          reasoning: 'Detected landmark keywords (fallback)',
          extractedLocation: query,
          searchIntent: 'landmark search'
        };
      }
      
      // Default ambiguous
      return {
        processedQuery: query,
        searchType: 'ambiguous',
        confidence: 0.3,
        reasoning: 'Query is ambiguous, needs clarification (fallback)',
        extractedLocation: query,
        searchIntent: 'location search'
      };
    } catch (error) {
      console.error('Query processing error:', error);
      return {
        processedQuery: query,
        searchType: 'ambiguous',
        confidence: 0.3,
        reasoning: 'Error in processing',
        extractedLocation: query,
        searchIntent: 'location search'
      };
    }
  };

  // Enhanced geocoding function with OpenAI intelligence
  const geocodeLocation = async (query: string): Promise<{ 
    lat: number; 
    lng: number; 
    address: string; 
    bbox?: number[];
    isArea: boolean;
    searchType: string;
    confidence: number;
  } | null> => {
    try {
      // Process query with OpenAI intelligence
      const llmResult = await processQueryWithLLM(query);
      console.log('🧠 OpenAI Analysis:', llmResult);
      
      // Determine search types based on OpenAI analysis
      let types = 'place,neighborhood,locality,district';
      if (llmResult.searchType === 'address') {
        types = 'address';
      } else if (llmResult.searchType === 'postcode') {
        types = 'postcode';
      } else if (llmResult.searchType === 'landmark') {
        types = 'poi';
      } else if (llmResult.searchType === 'area') {
        types = 'place,neighborhood,locality,district';
      }
      
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(llmResult.processedQuery)}.json?access_token=${mapboxToken}&limit=1&types=${types}`
      );
      const data = await response.json();
      
      if (data.features && data.features.length > 0) {
        const feature = data.features[0];
        const [lng, lat] = feature.center;
        const bbox = feature.bbox;
        
        console.log('📍 OpenAI-enhanced geocoding result:', {
          originalQuery: query,
          processedQuery: llmResult.processedQuery,
          searchType: llmResult.searchType,
          confidence: llmResult.confidence,
          reasoning: llmResult.reasoning,
          searchIntent: llmResult.searchIntent,
          address: feature.place_name,
          center: [lng, lat],
          bbox: bbox,
          isArea: llmResult.searchType === 'area'
        });
        
        return {
          lat,
          lng,
          address: feature.place_name,
          bbox: bbox,
          isArea: llmResult.searchType === 'area',
          searchType: llmResult.searchType,
          confidence: llmResult.confidence
        };
      }
      
      // If no results, return null to indicate no location found
      return null;
    } catch (error) {
      console.error('OpenAI-enhanced geocoding error:', error);
      return null;
    }
  };

  // Function to toggle map style between light and colorful
  const toggleMapStyle = () => {
    console.log('🎨 toggleMapStyle called', { isColorfulMap, isChangingStyle, hasMap: !!map.current });
    if (map.current && !isChangingStyle) {
      // Calculate the new state BEFORE updating to avoid stale state issues
      const willBeColorful = !isColorfulMap;
      console.log('🎨 Toggling map style', { from: isColorfulMap, to: willBeColorful });
      
      // Update state immediately with the calculated value - BEFORE setting isChangingStyle
      // This ensures the UI reflects the change immediately
      setIsColorfulMap(willBeColorful);
      setIsChangingStyle(true);
      
      // Store current view state before style change
      const currentCenter = map.current.getCenter();
      const currentZoom = map.current.getZoom();
      const currentPitch = map.current.getPitch();
      const currentBearing = map.current.getBearing();
      
      // Store current property markers to re-add them - use propertyMarkers state which contains all displayed properties
      const currentProperties = propertyMarkers.length > 0 ? propertyMarkers : searchResults;
      console.log('🎨 Storing properties for restoration:', { 
        propertyMarkersCount: propertyMarkers.length, 
        searchResultsCount: searchResults.length,
        currentPropertiesCount: currentProperties.length 
      });
      
      // Use a calmer colored map style (colored but less busy/overpowering).
      const newStyle = willBeColorful ? 'mapbox://styles/mapbox/outdoors-v12' : 'mapbox://styles/mapbox/light-v11';
      
      // Set the new style
      map.current.setStyle(newStyle);
      
      // Function to restore markers with retry logic
      const restoreMarkers = (retryCount = 0) => {
        if (!map.current) {
          console.warn('⚠️ Cannot restore markers - map not available');
          return;
        }
        
        // Check if map is ready and source can be added
        if (!map.current.isStyleLoaded()) {
          if (retryCount < 5) {
            console.log(`🔄 Map style not ready, retrying marker restoration (attempt ${retryCount + 1}/5)...`);
            setTimeout(() => restoreMarkers(retryCount + 1), 200);
            return;
          } else {
            console.warn('⚠️ Map style not ready after 5 attempts, proceeding anyway');
          }
        }
        
        // Re-add property markers if they exist
        if (currentProperties && currentProperties.length > 0) {
          console.log(`📍 Restoring ${currentProperties.length} property markers after style change`);
          try {
            // Force re-add markers by clearing the signature check
            lastAddedPropertiesRef.current = '';
            addPropertyMarkers(currentProperties, false);
            console.log('✅ Property markers restored successfully');
          } catch (error) {
            console.error('❌ Error restoring markers:', error);
            // Retry once more after a delay
            if (retryCount < 3) {
              setTimeout(() => restoreMarkers(retryCount + 1), 300);
            }
          }
        } else {
          console.log('📍 No properties to restore after style change');
        }
      };
      
      // Wait for style to load, then restore view and markers
      const styleDataHandler = () => {
        // Permanently hide all Mapbox branding elements
        const hideMapboxBranding = () => {
          // Hide attribution control
        const attributionElement = map.current.getContainer().querySelector('.mapboxgl-ctrl-attrib');
        if (attributionElement) {
          (attributionElement as HTMLElement).style.display = 'none';
        }
          // Hide Mapbox logo
          const logoElement = map.current.getContainer().querySelector('.mapboxgl-ctrl-logo');
          if (logoElement) {
            (logoElement as HTMLElement).style.display = 'none';
          }
          // Hide any other Mapbox control elements
          const mapboxControls = map.current.getContainer().querySelectorAll('[class*="mapboxgl-ctrl"]');
          mapboxControls.forEach((ctrl: Element) => {
            const htmlCtrl = ctrl as HTMLElement;
            if (htmlCtrl.classList.contains('mapboxgl-ctrl-attrib') || 
                htmlCtrl.classList.contains('mapboxgl-ctrl-logo')) {
              htmlCtrl.style.display = 'none';
            }
          });
        };
        
        // Hide branding immediately and with delays
        hideMapboxBranding();
        setTimeout(hideMapboxBranding, 100);
        setTimeout(hideMapboxBranding, 500);
        
        // Restore exact view state with smooth transition
        map.current.easeTo({
          center: currentCenter,
          zoom: currentZoom,
          pitch: currentPitch,
          bearing: currentBearing,
          duration: 300,
          essential: true
        });
        
        // Restore markers with retry logic - wait a bit longer to ensure style is fully loaded
        setTimeout(() => {
          restoreMarkers();
        }, 300);
        
        // Re-hide labels if we're switching to light style and haven't searched yet
        // Use the calculated value instead of state to avoid stale closure
        if (!willBeColorful && !hasPerformedSearch) {
          setTimeout(() => hideMapLabels(), 400);
        }
        
        // Reset loading state
        setTimeout(() => {
          console.log('🎨 Map style change complete, resetting isChangingStyle');
          setIsChangingStyle(false);
        }, 500);
      };
      
      // Fallback: if styledata doesn't fire within 3 seconds, reset the flag and try to restore markers anyway
      const fallbackTimeout = setTimeout(() => {
        console.warn('⚠️ Map style change timed out - attempting to restore markers anyway');
        restoreMarkers();
        setIsChangingStyle(false);
      }, 3000);
      
      // Track if markers have been restored to avoid duplicate restoration
      let markersRestored = false;
      
      const markAsRestored = () => {
        markersRestored = true;
      };
      
      // Set up the event listener - this will fire when the style loads
      map.current.once('styledata', () => {
        clearTimeout(fallbackTimeout);
        styleDataHandler();
        markAsRestored();
      });
      
      // Also listen for 'data' event as a backup - this fires when style data is fully loaded
      map.current.once('data', () => {
        console.log('🗺️ Map data event fired - style fully loaded');
        // Only restore if styledata hasn't already handled it and style is loaded
        if (!markersRestored && map.current && map.current.isStyleLoaded()) {
          setTimeout(() => {
            restoreMarkers();
            markAsRestored();
          }, 200);
        }
      });
    }
  };

  // Function to show labels after first search
  const showMapLabels = () => {
    if (map.current) {
      // Show all label layers
      const labelLayers = [
        'place-label', 'poi-label', 'road-label', 'waterway-label', 
        'natural-label', 'transit-label', 'airport-label', 'rail-label'
      ];
      
      labelLayers.forEach(layerId => {
        if (map.current.getLayer(layerId)) {
          map.current.setLayoutProperty(layerId, 'visibility', 'visible');
        }
      });
    }
  };

  // Function to hide labels initially
  const hideMapLabels = () => {
    if (map.current) {
      // Wait for style to load completely
      setTimeout(() => {
        if (map.current) {
          // Hide all label layers
          const labelLayers = [
            'place-label', 'poi-label', 'road-label', 'waterway-label', 
            'natural-label', 'transit-label', 'airport-label', 'rail-label',
            'place-city', 'place-town', 'place-village', 'place-hamlet',
            'place-neighbourhood', 'place-suburb', 'place-island',
            'poi', 'poi-scalerank2', 'poi-scalerank3', 'poi-scalerank4',
            'road-number', 'road-name', 'road-shield'
          ];
          
          labelLayers.forEach(layerId => {
            if (map.current.getLayer(layerId)) {
              map.current.setLayoutProperty(layerId, 'visibility', 'none');
            }
          });
        }
      }, 200);
    }
  };

  // Function to update map location with LLM-enhanced intelligence
  const updateLocation = async (query: string) => {
    if (!map.current || !query.trim()) return;
    
    // Show labels on first search
    if (!hasPerformedSearch) {
      showMapLabels();
      return;
    }
    
    const location = await geocodeLocation(query);
    if (location) {
      // Remove existing marker
      if (currentMarker.current) {
        currentMarker.current.remove();
      }
      
      // Trigger property search for property-related queries
      if (query.toLowerCase().includes('property') || 
          query.toLowerCase().includes('house') || 
          query.toLowerCase().includes('flat') ||
          query.toLowerCase().includes('bedroom') ||
          query.toLowerCase().includes('bed') ||
          query.toLowerCase().includes('comparable') ||
          query.toLowerCase().includes('similar') ||
          query.toLowerCase().includes('3 bed') ||
          query.toLowerCase().includes('2 bed') ||
          query.toLowerCase().includes('4 bed')) {
        await searchProperties(query);
        // Don't do geocoding for property searches - just show the properties
        return;
      }
      
      
      if (location.isArea) {
        // For areas: use fitBounds if available, otherwise center with appropriate zoom
        if (location.bbox && location.bbox.length === 4) {
          // Use bounding box to fit the entire area
          map.current.fitBounds([
            [location.bbox[0], location.bbox[1]], // Southwest corner
            [location.bbox[2], location.bbox[3]]  // Northeast corner
          ], {
            padding: 50, // Add padding around the area
            maxZoom: 15  // Don't zoom in too much for areas
          });
        } else {
          // Fallback: center on the area with appropriate zoom
          map.current.jumpTo({
            center: [location.lng, location.lat],
            zoom: 13
          });
        }
      } else {
        // For specific addresses/landmarks: show marker and zoom to precise location
        const markerElement = document.createElement('div');
        markerElement.className = 'property-comparable';
        
        // Different marker styles based on search type
        const markerLabel = location.searchType === 'landmark' ? 'Landmark' : 'Comp Located';
        const markerColor = location.searchType === 'landmark' ? '#3b82f6' : '#2d3748';
        
        markerElement.innerHTML = `
          <div style="
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
          ">
            <!-- Address Label -->
            <div style="
              background: ${markerColor};
              color: white;
              padding: 8px 12px;
              border-radius: 8px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3);
              margin-bottom: 8px;
              display: flex;
              align-items: center;
              gap: 8px;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              position: relative;
            ">
              <!-- Map Pin Icon -->
              <div style="
                width: 20px;
                height: 20px;
                background: white;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
              ">📍</div>
              <!-- Address Text -->
              <div>
                <div style="font-size: 10px; color: #a0aec0; margin-bottom: 2px;">${markerLabel}</div>
                <div style="font-size: 12px; font-weight: 600;">${location.address}</div>
                ${location.confidence < 0.7 ? `<div style="font-size: 10px; color: #fbbf24;">Confidence: ${Math.round(location.confidence * 100)}%</div>` : ''}
              </div>
              <!-- Pointer -->
              <div style="
                position: absolute;
                bottom: -6px;
                left: 50%;
                transform: translateX(-50%);
                width: 0;
                height: 0;
                border-left: 6px solid transparent;
                border-right: 6px solid transparent;
                border-top: 6px solid ${markerColor};
              "></div>
            </div>
            
            <!-- Location Indicator -->
            <div style="
              width: 20px;
              height: 20px;
              background: rgba(34, 197, 94, 0.2);
              border-radius: 50%;
              box-shadow: 0 0 0 1px rgba(255,255,255,0.8);
              position: relative;
            ">
              <div style="
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 6px;
                height: 6px;
                background: #22c55e;
                border-radius: 50%;
              "></div>
            </div>
          </div>
        `;
        
        // Set the marker position
        currentMarker.current = new mapboxgl.Marker({
          element: markerElement
        })
          .setLngLat([location.lng, location.lat])
          .addTo(map.current);
        
        // Fly to precise location for addresses/landmarks
        const zoomLevel = location.searchType === 'landmark' ? 16 : 18;
        map.current.jumpTo({
          center: [location.lng, location.lat],
          zoom: zoomLevel
        });
      }
      
      // Notify parent component with enhanced data
      onLocationUpdate?.(location);
    }
  };

  // Function to fly to specific coordinates (enhanced for areas and addresses)
  const flyToLocation = (lat: number, lng: number, zoom: number = 14, isArea: boolean = false) => {
    if (!map.current) return;
    
    // Remove existing marker (only the generic location marker, not property name markers)
    if (currentMarker.current) {
      currentMarker.current.remove();
      currentMarker.current = null;
    }
    
    // Center the map on the location
    map.current.jumpTo({
      center: [lng, lat],
      zoom: zoom
    });
  };

  // Track if current selection is navigation-only (just show title card, not full panel)
  const isNavigationOnlyRef = useRef<boolean>(false);

  // Expose methods to parent component
  // Method to select a property by address (same logic as clicking a pin)
  // navigationOnly: if true, only show title card, don't open full PropertyDetailsPanel
  const selectPropertyByAddress = async (address: string, coordinates?: { lat: number; lng: number }, propertyId?: string, navigationOnly = false, retryCount = 0, providedProperties?: any[]) => {
    // Track navigation mode in ref for use in nested callbacks
    if (retryCount === 0) {
      isNavigationOnlyRef.current = navigationOnly;
      console.log(`🧭 selectPropertyByAddress: navigationOnly=${navigationOnly}`);
    }
    // Clear any stale property selection on first attempt to prevent showing wrong card
    // Also reset map centering flag for new selection
    if (retryCount === 0) {
      // CRITICAL: Clean up any existing PropertyTitleCard marker from previous selections
      // This prevents old markers from appearing above the current pin
      if (currentPropertyNameMarkerRef.current) {
        console.log('🧹 Cleaning up existing PropertyTitleCard marker at start of selectPropertyByAddress');
        // Clean up React root if it exists
        if (currentPropertyTitleCardRootRef.current) {
          try {
            currentPropertyTitleCardRootRef.current.unmount();
          } catch (e) {
            console.warn('Error unmounting PropertyTitleCard root:', e);
          }
          currentPropertyTitleCardRootRef.current = null;
        }
        // Clean up zoom listener
        if (propertyTitleCardZoomListenerRef.current) {
          propertyTitleCardZoomListenerRef.current();
          propertyTitleCardZoomListenerRef.current = null;
        }
        // Remove the marker from the map
        try {
          currentPropertyNameMarkerRef.current.remove();
        } catch (e) {
          console.warn('Error removing marker at start of selectPropertyByAddress:', e);
        }
        currentPropertyNameMarkerRef.current = null;
      }
      // Clear title card state
      setShowPropertyTitleCard(false);
      setTitleCardPropertyId(null);
      
      setSelectedProperty(null);
      setShowPropertyCard(false);
      setShowPropertyDetailsPanel(false);
      hasCenteredMapRef.current = null; // Reset so map can center for this new selection
      hasJumpedToPropertyPinRef.current = false; // Reset flag to allow new navigation
    }
    
    // OPTIMIZATION: If we have cached data and propertyId, show card immediately even if map isn't ready
    // This ensures <1s response time when clicking recent project
    if (!map.current && propertyId) {
      // Check cache first - if we have cached data, show card immediately
      try {
        const cacheKey = `propertyCardCache_${propertyId}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const cacheData = JSON.parse(cached);
          const CACHE_MAX_AGE = 30 * 60 * 1000;
          const cacheAge = Date.now() - cacheData.timestamp;
          
          if (cacheAge < CACHE_MAX_AGE && cacheData.data) {
            // We have cached data - show card NOW, update map later
            console.log('🚀 INSTANT: Map not ready but showing card from cache immediately');
            const cachedProperty = cacheData.data;
            setSelectedProperty(cachedProperty);
            setShowPropertyCard(true);
            // Only show property details panel if not in navigation-only mode
            if (!isNavigationOnlyRef.current) {
            setShowPropertyDetailsPanel(true);
            }
            setIsExpanded(false);
            setShowFullDescription(false);
            
            // REMOVED: __pendingMapUpdate - no map centering
            
            // Retry map update with very short delays (10ms) for fastest response
            // Map centering will happen when map is ready, property card is already showing
            if (retryCount < 20) {
              setTimeout(() => selectPropertyByAddress(address, coordinates, propertyId, isNavigationOnlyRef.current, retryCount + 1, providedProperties), 10);
            }
            return;
          }
        }
      } catch (e) {
        // Continue with normal flow if cache check fails
      }
    }
    
    if (!map.current) {
      // Retry if map isn't ready yet - but with shorter delays
      // CRITICAL: Preserve coordinates through retries so map can center when ready
      if (retryCount < 10) {
        // Use shorter delay for faster response (50ms instead of 200ms)
        const retryDelay = Math.min(50 * (retryCount + 1), 200);
        console.log('⏳ Map not ready yet, retrying with coordinates preserved:', { coordinates, retryCount });
        setTimeout(() => selectPropertyByAddress(address, coordinates, propertyId, isNavigationOnlyRef.current, retryCount + 1, providedProperties), retryDelay);
      } else {
        // Map still not ready after retries - store for when map loads
        console.log('⏳ Map not ready after retries, storing pending selection with coordinates');
        (window as any).__pendingPropertySelection = { address, coordinates, propertyId };
      }
      return;
    }
    
    // Normalize the search address (extract key parts like "Highlands", "Berden", "CM23")
    const normalizeAddress = (addr: string) => {
      return addr.toLowerCase()
        .replace(/,/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };
    
    const normalizedSearch = normalizeAddress(address);
    
    // Find the property in searchResults OR propertyMarkers (properties loaded on map init)
    // CRITICAL: Check preloaded properties FIRST (fastest, already in memory)
    // Use providedProperties if available (for immediate selection after loading)
    // Remove duplicates by ID
    const preloadedProperties = (window as any).__preloadedProperties;
    const allPropertiesMap = new Map();
    // Priority: providedProperties > preloadedProperties > searchResults/propertyMarkers
    const propertiesToSearch = providedProperties || 
                               (preloadedProperties && Array.isArray(preloadedProperties) ? preloadedProperties : []) ||
                               [...searchResults, ...propertyMarkers];
    propertiesToSearch.forEach(p => {
      if (p && p.id && !allPropertiesMap.has(p.id)) {
        allPropertiesMap.set(p.id, p);
      }
    });
    const allProperties = Array.from(allPropertiesMap.values());
    
    // OPTIMIZATION: Check localStorage cache FIRST if we have propertyId (from recent project)
    // This allows instant card display without waiting for properties to load
    let finalProperty: any = null;
    let finalLat: number | null = null;
    let finalLng: number | null = null;
    
    if (propertyId) {
      try {
        const cacheKey = `propertyCardCache_${propertyId}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const cacheData = JSON.parse(cached);
          const CACHE_MAX_AGE = 30 * 60 * 1000; // 30 minutes
          const cacheAge = Date.now() - cacheData.timestamp;
          
          if (cacheAge < CACHE_MAX_AGE && cacheData.data) {
            // Use cached property data immediately - no need to wait for properties to load!
            console.log('✅ Using cached property data for INSTANT card display (from recent project)');
            finalProperty = cacheData.data;
            
            // PRELOAD: Start loading documents and covers immediately
            if (finalProperty.id) {
              backendApiService.preloadPropertyDocuments(String(finalProperty.id)).catch(() => {});
            }
            // ONLY use provided coordinates - never use property coordinates
            if (coordinates && coordinates.lat && coordinates.lng) {
              finalLat = coordinates.lat;
              finalLng = coordinates.lng;
            } else {
              // No coordinates provided - don't center map
              finalLat = null;
              finalLng = null;
            }
            
            // If we have cached data AND valid coordinates, skip property search entirely and show card immediately
            if (finalProperty && finalLat !== null && finalLng !== null) {
              // Proceed directly to showing the card - skip all retry logic
              console.log('🚀 Showing property card immediately from cache - no backend wait!');
              
              // Show card IMMEDIATELY - don't wait for map to be ready
              // This ensures <1s response time when clicking recent project
              // Store pin coordinates for marker positioning
              if (finalLat !== null && finalLng !== null) {
                selectedPropertyPinCoordsRef.current = { lat: finalLat, lng: finalLng };
              }
              // Store pin coordinates for marker positioning
              if (finalLat !== null && finalLng !== null) {
                selectedPropertyPinCoordsRef.current = { lat: finalLat, lng: finalLng };
              }
              setSelectedProperty(finalProperty);
              // Don't show card or panel yet - wait for flyTo animation to complete first
              setShowPropertyCard(false);
              setShowPropertyDetailsPanel(false);
              setShowPropertyTitleCard(false); // Don't show title card until after flyTo
              setIsExpanded(false);
              setShowFullDescription(false);
              
              // If map is ready, fly to location FIRST, then show card and panel
              if (map.current && finalLat !== null && finalLng !== null) {
                // Hide the base marker for this property
                if (map.current.getLayer('property-markers')) {
                  map.current.setFilter('property-markers', [
                    '!=',
                    ['get', 'id'],
                    finalProperty.id
                  ]);
                }
                
                // Hide the outer ring for this property
                if (map.current.getLayer('property-outer')) {
                  map.current.setFilter('property-outer', [
                    '!=',
                    ['get', 'id'],
                    finalProperty.id
                  ]);
                }
                
                // Calculate position for property details panel
                const point = map.current.project([finalLng, finalLat]);
                setSelectedPropertyPosition({
                  x: point.x,
                  y: point.y - 20
                });
                
                // Helper function to create title card marker (called AFTER flyTo completes)
                // This matches the normal pin click flow to ensure proper "default click state"
                // CRITICAL: Pass property as parameter to avoid using stale closure-captured finalProperty
                const createTitleCardMarker = (propertyToUse: any) => {
                  if (!map.current || !propertyToUse || finalLat === null || finalLng === null) return;
                
                // Always remove existing marker and create new PropertyTitleCard to avoid duplicates
                if (currentPropertyNameMarkerRef.current) {
                  // Clean up React root if it exists
                  if (currentPropertyTitleCardRootRef.current) {
                    try {
                      currentPropertyTitleCardRootRef.current.unmount();
                    } catch (e) {
                      console.warn('Error unmounting PropertyTitleCard root:', e);
                    }
                    currentPropertyTitleCardRootRef.current = null;
                  }
                  // Clean up zoom listener
                  if (propertyTitleCardZoomListenerRef.current) {
                    propertyTitleCardZoomListenerRef.current();
                    propertyTitleCardZoomListenerRef.current = null;
                  }
                  currentPropertyNameMarkerRef.current.remove();
                  currentPropertyNameMarkerRef.current = null;
                }
                
                  // Create new PropertyTitleCard marker (same as property pin click - full structure)
      const markerElement = document.createElement('div');
                  markerElement.className = 'property-title-card-marker';
                  markerElement.style.cssText = `
                    position: relative;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    pointer-events: auto;
                  `;
                  
                  // Create inner scalable container for the React component
                  // This is what we'll scale with zoom
                  const scalableContainer = document.createElement('div');
                  scalableContainer.className = 'property-title-card-scalable';
                  scalableContainer.style.cssText = `
                    position: relative;
                    transform-origin: bottom center;
                    transition: none;
                    pointer-events: auto; /* Only the card content captures clicks */
                    user-select: text; /* Allow text selection */
                    -webkit-user-select: text; /* Safari */
                  `;
                  markerElement.appendChild(scalableContainer);
                  
                  // Store reference to scalable container for zoom updates
                  (markerElement as any).scalableContainer = scalableContainer;
                  
                  // CRITICAL: Prevent map click events from firing when clicking on the marker
                  // Stop propagation in bubble phase (not capture) so React onClick fires first
                  markerElement.addEventListener('click', (e) => {
                    e.stopPropagation();
                    console.log('🛑 Marker element click (selectPropertyByAddress) - preventing map click handler');
                  }, false); // Bubble phase - let React onClick fire first, then stop propagation to map
                  
                  markerElement.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                  }, false);
                  
                  // ALSO add click handler to scalableContainer to catch clicks that might not bubble to markerElement
                  // Stop propagation immediately - React's synthetic events will still fire
                  scalableContainer.addEventListener('click', (e) => {
                    e.stopPropagation();
                    console.log('🛑 Scalable container click (selectPropertyByAddress) - preventing map click handler');
                  }, false);
                  
                  scalableContainer.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                  }, false);
                  
                  // Disable map dragging when hovering over the card to allow text selection
                  scalableContainer.addEventListener('mouseenter', () => {
                    if (map.current) {
                      map.current.dragPan.disable();
                    }
                    
                    // Preload document covers on hover for faster loading when clicked
                    if (propertyToUse?.id && backendApi) {
                      const propertyId = propertyToUse.id;
                      const preloadedFiles = (window as any).__preloadedPropertyFiles?.[propertyId];
                      if (preloadedFiles && Array.isArray(preloadedFiles) && preloadedFiles.length > 0) {
                        preloadDocumentCoversForProperty(preloadedFiles);
                      } else {
                        fetchAndPreloadDocumentCovers(propertyId, backendApi);
                      }
                    }
                  });
                  
                  scalableContainer.addEventListener('mouseleave', () => {
                    if (map.current) {
                      map.current.dragPan.enable();
                    }
                  });
                  
                  // Handle card click - opens PropertyDetailsPanel above the title card
                  const handleCardClick = () => {
                    console.log('📍 Property title card clicked (from selectPropertyByAddress) - opening PropertyDetailsPanel above title card');
                    
                    // Set flag to prevent map click handler from deselecting (backup)
                    titleCardClickedRef.current = true;
                    // Clear flag after a short delay to allow map click handler to check it
                    setTimeout(() => {
                      titleCardClickedRef.current = false;
                    }, 200); // Increased timeout to ensure map handler checks it
                    
                    if (propertyToUse) {
                      // Preload document covers immediately when title card is clicked
                      if (propertyToUse?.id && backendApi) {
                        const propertyId = propertyToUse.id;
                        // Check if we already have preloaded files
                        const preloadedFiles = (window as any).__preloadedPropertyFiles?.[propertyId];
                        if (preloadedFiles && Array.isArray(preloadedFiles) && preloadedFiles.length > 0) {
                          // Preload covers for existing documents
                          preloadDocumentCoversForProperty(preloadedFiles);
                        } else {
                          // Fetch documents and preload covers
                          fetchAndPreloadDocumentCovers(propertyId, backendApi);
                        }
                      }
                      
                      // Store pin coordinates
                      if (finalLat !== null && finalLng !== null) {
                        selectedPropertyPinCoordsRef.current = { lat: finalLat, lng: finalLng };
                      }
                      
                      // Calculate position for PropertyDetailsPanel above the title card
                      // The title card is positioned above the pin, so we position PropertyDetailsPanel above the title card
                      if (map.current && finalLng !== null && finalLat !== null) {
                        const point = map.current.project([finalLng, finalLat]);
                        // Get map container position to convert to viewport coordinates
                        const mapContainer = map.current.getContainer();
                        const containerRect = mapContainer.getBoundingClientRect();
                        // Position PropertyDetailsPanel using the SAME logic as PropertyTitleCard
                        const titleCardHeight = 360;
                        const pinRadius = 10;
                        const gapAbovePin = 20; // Gap between pin and title card bottom (same as PropertyTitleCard)
                        const titleCardBottomY = point.y - (pinRadius + gapAbovePin); // Where title card bottom is
                        const titleCardTopY = titleCardBottomY - titleCardHeight; // Where title card top is
                        const panelGap = 20; // Gap between PropertyDetailsPanel and title card
                        // Position PropertyDetailsPanel so its bottom is above the title card top with a gap
                        setSelectedPropertyPosition({
                          x: containerRect.left + point.x, // Pin X position (same as PropertyTitleCard - will be centered with translate(-50%))
                          y: containerRect.top + titleCardTopY - panelGap // Position above title card with gap
                        });
                      }
                      
                      // Set selected property - this will trigger the useEffect to re-center if chat panel width changes
                      setSelectedProperty(propertyToUse);
                      setShowPropertyCard(true);
                      // ALWAYS show property details panel when user CLICKS the title card
                      // (isNavigationOnlyRef only controls whether panel opens automatically during navigation,
                      // not whether it opens when user explicitly clicks)
                      setShowPropertyDetailsPanel(true);
                      setIsLargeCardMode(true); // Enable large card mode (positioned above title card)
                      setIsExpanded(false);
                      setShowFullDescription(false);
                      // Keep title card visible (it should remain below PropertyDetailsPanel)
                      
                      // Also re-center immediately when title card is clicked (in case chat panel is open)
                      if (map.current && finalLng !== null && finalLat !== null && chatPanelWidth > 0) {
                        const propertyPinCoordinates: [number, number] = [finalLng, finalLat];
                        const cardHeight = 360;
                        const verticalOffset = (cardHeight / 2) - 40;
                        
                        // CRITICAL: Mapbox offset is relative to the map container, not the viewport
                        const mapContainer = map.current.getContainer();
                        const containerRect = mapContainer.getBoundingClientRect();
                        const containerWidth = containerRect.width;
                        const containerLeft = containerRect.left;
                        
                        const leftEdge = chatPanelWidth + sidebarWidth;
                        const visibleWidth = containerWidth - (leftEdge - containerLeft);
                        const visibleCenterX = leftEdge + (visibleWidth / 2);
                        const containerCenterX = containerLeft + (containerWidth / 2);
                        const horizontalOffset = (visibleCenterX - containerCenterX);
                        
                        console.log('📍 Title card clicked (navigation) - re-centering with chat panel:', {
                          chatPanelWidth,
                          containerWidth,
                          containerLeft,
                          horizontalOffset,
                          source: 'title-card-click-navigation'
                        });
                        
                        map.current.flyTo({
                          center: propertyPinCoordinates,
                          zoom: map.current.getZoom(),
                          duration: 300,
                          offset: [horizontalOffset, verticalOffset],
                          essential: true
                        });
                      }
                    }
                  };
                  
                  // Render PropertyTitleCard component into scalable container (same as pin click)
                  try {
                    const root = createRoot(scalableContainer);
                  root.render(
                    <PropertyTitleCard
                      property={propertyToUse}
                      onCardClick={handleCardClick}
                    />
                  );
                  
                    // Store root reference for cleanup
                    currentPropertyTitleCardRootRef.current = root;
                  } catch (error) {
                    console.error('Error rendering PropertyTitleCard:', error);
                  }
                  
                  // Calculate offset for positioning (PropertyTitleCard without green pin)
                  // Position the card raised above the pin so it doesn't overlap
                  const cardHeight = 360; // Approximate card height (image + details, no pin/pointer)
                  const pinRadius = 10; // Approximate pin radius
                  const gapAbovePin = 20; // Gap between pin and card bottom
                  const verticalOffset = -(pinRadius + gapAbovePin); // Negative Y moves upward
                  
                  // Anchor at bottom center and raise card above the pin (same as pin click)
                  const marker = new mapboxgl.Marker({
                    element: markerElement,
                    anchor: 'bottom',
                    offset: [0, verticalOffset] // Raise card above pin
                  })
                    .setLngLat([finalLng, finalLat])
                    .addTo(map.current);
                  
                  // Store marker reference for cleanup
                  currentPropertyNameMarkerRef.current = marker;
                  storeMarkerCoordinates(marker, propertyToUse?.id);
                  
                  // Set up zoom listener - card stays fixed size when zoomed in, scales down when zoomed out
                  setupMarkerZoomListener(marker);
                  
                  // Update state to show title card (same as pin click)
                  setShowPropertyTitleCard(true);
                  setTitleCardPropertyId(propertyToUse?.id?.toString() || null);
                  
                  console.log('✅ Created title card marker with property:', propertyToUse?.address || propertyToUse?.formatted_address || propertyToUse?.id);
                };
                
                // CRITICAL: Fly to property pin location FIRST before showing any UI
                const propertyPinCoordinates: [number, number] = [finalLng, finalLat];
                const cardHeight = 360;
                const verticalOffset = (cardHeight / 2) - 40;
                
                // CRITICAL: Mapbox offset is relative to the map container, not the viewport
                const mapContainer = map.current.getContainer();
                const containerRect = mapContainer.getBoundingClientRect();
                const containerWidth = containerRect.width;
                const containerLeft = containerRect.left;
                
                // Use chatPanelWidthRef to get the CURRENT chat panel width (may have been updated by navigation action)
                const currentChatPanelWidth = chatPanelWidthRef.current;
                const leftEdge = currentChatPanelWidth + sidebarWidth;
                const visibleWidth = containerWidth - (leftEdge - containerLeft);
                const visibleCenterX = leftEdge + (visibleWidth / 2);
                const containerCenterX = containerLeft + (containerWidth / 2);
                // Calculate offset relative to map container center (Mapbox expects this)
                const horizontalOffset = (visibleCenterX - containerCenterX);
                
                console.log('📍 Recent project: Flying to property pin location:', { 
                  lat: finalLat, 
                  lng: finalLng, 
                  chatPanelWidth: currentChatPanelWidth, 
                  containerWidth,
                  containerLeft,
                  horizontalOffset 
                });
                
                // NOTE: Don't clean up marker yet - keep it visible until panel shows
                // Cleanup will happen after property details panel is shown
                
                // Stop any existing animations to prevent conflicts
                if (map.current.isMoving()) {
                  map.current.stop();
                }
                
                // Single smooth flyTo animation - combines center and zoom for decisive, smooth motion
                // This is much smoother than two separate animations which can feel un-decisive
                
                // Start panel animation immediately for very quick appearance
                // This creates a smooth, overlapping transition instead of a jarring switch
                const animationDuration = 1200;
                const panelStartDelay = 0; // Start panel immediately when flyTo begins (appear instantly)
                
                // Track if panel has been shown to prevent duplicate calls
                let panelShown = false;
                
                // Start panel fade-in during the last part of map animation for seamless transition
                // Make it behave exactly like clicking a property title card
                setTimeout(() => {
                  // Use requestAnimationFrame for smooth timing
                  requestAnimationFrame(async () => {
                    // CRITICAL: Mark panel as being shown IMMEDIATELY to prevent backup handler race condition
                    if (panelShown) {
                      console.log('⏭️ Panel already shown by another handler, skipping');
                      return;
                    }
                    panelShown = true; // Set flag immediately before async work
                    
                    // CRITICAL: Fetch full property hub data to ensure all details are available
                    // Cached data might be incomplete, so fetch fresh data like pin clicks do
                    let propertyToShow = finalProperty;
                    if (finalProperty?.id && backendApi) {
                      try {
                        console.log('📥 Fetching full property hub data for recent project:', finalProperty.id);
                        const propertyHubResponse = await backendApi.getPropertyHub(finalProperty.id);
                        if (propertyHubResponse && propertyHubResponse.success && propertyHubResponse.data) {
                          const hub = propertyHubResponse.data;
                          const property = hub.property || {};
                          const propertyDetails = hub.property_details || {};
                          
                          // Merge cached data with fresh hub data for complete property object
                          propertyToShow = {
                            ...finalProperty, // Keep cached data (coordinates, etc.)
                            ...property, // Add/override with fresh property data
                            propertyHub: hub, // Include full hub data
                            // Add property details fields
                            property_type: propertyDetails.property_type || finalProperty.property_type,
                            tenure: propertyDetails.tenure || finalProperty.tenure,
                            number_bedrooms: propertyDetails.number_bedrooms || finalProperty.bedrooms,
                            number_bathrooms: propertyDetails.number_bathrooms || finalProperty.bathrooms,
                            epc_rating: propertyDetails.epc_rating || finalProperty.epc_rating,
                            rent_pcm: propertyDetails.rent_pcm || finalProperty.rentPcm,
                            sold_price: propertyDetails.sold_price || finalProperty.soldPrice,
                            asking_price: propertyDetails.asking_price || finalProperty.askingPrice,
                            summary_text: propertyDetails.summary_text || finalProperty.summary,
                            bedrooms: propertyDetails.number_bedrooms || finalProperty.bedrooms,
                            bathrooms: propertyDetails.number_bathrooms || finalProperty.bathrooms,
                            document_count: hub.document_count || finalProperty.documentCount
                          };
                          console.log('✅ Loaded full property hub data for recent project');
                        }
                      } catch (error) {
                        console.warn('⚠️ Failed to fetch property hub, using cached data:', error);
                        // Continue with cached data if fetch fails
                      }
                    }
                    
                    // For navigation-only mode, show the title card (not the full panel)
                    // For normal mode, skip title card and go straight to property details panel
                    if (isNavigationOnlyRef.current) {
                      // Navigation mode: Show title card only
                      console.log('🧭 Navigation mode: Showing title card only');
                      
                      // Store pin coordinates
                      if (finalLat !== null && finalLng !== null) {
                        selectedPropertyPinCoordsRef.current = { lat: finalLat, lng: finalLng };
                      }
                      
                      // Set selected property
                      setSelectedProperty(propertyToShow);
                      setShowPropertyCard(true);
                      
                      // Create and show the title card marker - CRITICAL: pass propertyToShow, not stale finalProperty
                      createTitleCardMarker(propertyToShow);
                      
                      // panelShown already set at start of handler
                      console.log('✅ Navigation mode: Title card shown');
                    } else {
                      // Normal mode: Skip title card and go straight to property details panel
                    setShowPropertyTitleCard(false); // Ensure title card is not shown
                    setTitleCardPropertyId(null); // Clear any title card ID
                    
                    // Preload document covers immediately (same as title card click)
                    if (propertyToShow?.id && backendApi) {
                      const propertyId = propertyToShow.id;
                      // Check if we already have preloaded files
                      const preloadedFiles = (window as any).__preloadedPropertyFiles?.[propertyId];
                      if (preloadedFiles && Array.isArray(preloadedFiles) && preloadedFiles.length > 0) {
                        // Preload covers for existing documents
                        preloadDocumentCoversForProperty(preloadedFiles);
                      } else {
                        // Fetch documents and preload covers
                        fetchAndPreloadDocumentCovers(propertyId, backendApi);
                      }
                    }
                    
                    // Store pin coordinates (same as title card click)
                    if (finalLat !== null && finalLng !== null) {
                      selectedPropertyPinCoordsRef.current = { lat: finalLat, lng: finalLng };
                    }
                    
                    // Calculate position for PropertyDetailsPanel (centered on pin, no title card)
                    // Since we're skipping the title card, position panel centered on the pin
                    if (map.current && finalLng !== null && finalLat !== null) {
                      const point = map.current.project([finalLng, finalLat]);
                      const mapContainer = map.current.getContainer();
                      const containerRect = mapContainer.getBoundingClientRect();
                      // Center panel on pin (no title card offset needed)
                      setSelectedPropertyPosition({
                        x: containerRect.left + point.x,
                        y: containerRect.top + point.y
                      });
                    }
                    
                    // Set selected property and show panel (same as title card click)
                    setSelectedProperty(propertyToShow); // Use property with full hub data
                    setShowPropertyCard(true);
                    setShowPropertyDetailsPanel(true);
                    setIsLargeCardMode(true); // CRITICAL: Enable large card mode (same as title card click)
                    setIsExpanded(false);
                    setShowFullDescription(false);
                    
                    // CRITICAL: Now that panel is shown, clean up the PropertyTitleCard marker
                    // This ensures the marker stays visible during the animation, then disappears when panel appears
                    cleanupPropertyTitleCardMarker();
                    
                    // panelShown already set at start of handler
                    console.log('✅ Recent project: Starting panel animation (behaving like title card click)');
                    }
                  });
                }, panelStartDelay);
                
                // Also listen for animation completion as backup
                const handleMoveEnd = async () => {
                  if (map.current) {
                    // Remove the listener so it doesn't fire again
                    map.current.off('moveend', handleMoveEnd);
                    
                    // Ensure panel is shown (in case setTimeout didn't fire) - same as title card click
                    if (!panelShown) {
                      // CRITICAL: Mark panel as being shown IMMEDIATELY to prevent race condition with main handler
                      panelShown = true;
                      
                      // CRITICAL: Fetch full property hub data to ensure all details are available
                      let propertyToShow = finalProperty;
                      if (finalProperty?.id && backendApi) {
                        try {
                          console.log('📥 Fetching full property hub data for recent project (backup):', finalProperty.id);
                          const propertyHubResponse = await backendApi.getPropertyHub(finalProperty.id);
                          if (propertyHubResponse && propertyHubResponse.success && propertyHubResponse.data) {
                            const hub = propertyHubResponse.data;
                            const property = hub.property || {};
                            const propertyDetails = hub.property_details || {};
                            
                            // Merge cached data with fresh hub data for complete property object
                            propertyToShow = {
                              ...finalProperty, // Keep cached data (coordinates, etc.)
                              ...property, // Add/override with fresh property data
                              propertyHub: hub, // Include full hub data
                              // Add property details fields
                              property_type: propertyDetails.property_type || finalProperty.property_type,
                              tenure: propertyDetails.tenure || finalProperty.tenure,
                              number_bedrooms: propertyDetails.number_bedrooms || finalProperty.bedrooms,
                              number_bathrooms: propertyDetails.number_bathrooms || finalProperty.bathrooms,
                              epc_rating: propertyDetails.epc_rating || finalProperty.epc_rating,
                              rent_pcm: propertyDetails.rent_pcm || finalProperty.rentPcm,
                              sold_price: propertyDetails.sold_price || finalProperty.soldPrice,
                              asking_price: propertyDetails.asking_price || finalProperty.askingPrice,
                              summary_text: propertyDetails.summary_text || finalProperty.summary,
                              bedrooms: propertyDetails.number_bedrooms || finalProperty.bedrooms,
                              bathrooms: propertyDetails.number_bathrooms || finalProperty.bathrooms,
                              document_count: hub.document_count || finalProperty.documentCount
                            };
                            console.log('✅ Loaded full property hub data for recent project (backup)');
                          }
                        } catch (error) {
                          console.warn('⚠️ Failed to fetch property hub (backup), using cached data:', error);
                          // Continue with cached data if fetch fails
                        }
                      }
                      
                      // For navigation-only mode, show the title card (not the full panel)
                      // For normal mode, skip title card and go straight to property details panel
                      if (isNavigationOnlyRef.current) {
                        // Navigation mode: Show title card only
                        console.log('🧭 Navigation mode: Showing title card only (backup)');
                        
                        // Store pin coordinates
                        if (finalLat !== null && finalLng !== null) {
                          selectedPropertyPinCoordsRef.current = { lat: finalLat, lng: finalLng };
                        }
                        
                        // Set selected property
                        setSelectedProperty(propertyToShow);
                        setShowPropertyCard(true);
                        
                        // Create and show the title card marker - CRITICAL: pass propertyToShow, not stale finalProperty
                        createTitleCardMarker(propertyToShow);
                        
                        console.log('✅ Navigation mode: Title card shown (backup)');
                      } else {
                        // Normal mode: Skip title card and go straight to property details panel
                      setShowPropertyTitleCard(false); // Ensure title card is not shown
                      setTitleCardPropertyId(null); // Clear any title card ID
                      // Ensure no title card marker exists
                      if (currentPropertyNameMarkerRef.current) {
                        try {
                          if (currentPropertyTitleCardRootRef.current) {
                            currentPropertyTitleCardRootRef.current.unmount();
                            currentPropertyTitleCardRootRef.current = null;
                          }
                          currentPropertyNameMarkerRef.current.remove();
                          currentPropertyNameMarkerRef.current = null;
                        } catch (e) {
                          console.warn('Error cleaning up title card marker:', e);
                        }
                      }
                      
                      // Preload document covers
                      if (propertyToShow?.id && backendApi) {
                        const propertyId = propertyToShow.id;
                        const preloadedFiles = (window as any).__preloadedPropertyFiles?.[propertyId];
                        if (preloadedFiles && Array.isArray(preloadedFiles) && preloadedFiles.length > 0) {
                          preloadDocumentCoversForProperty(preloadedFiles);
                        } else {
                          fetchAndPreloadDocumentCovers(propertyId, backendApi);
                        }
                      }
                      
                      // Store pin coordinates
                      if (finalLat !== null && finalLng !== null) {
                        selectedPropertyPinCoordsRef.current = { lat: finalLat, lng: finalLng };
                      }
                      
                      // Calculate position for PropertyDetailsPanel (centered on pin, no title card)
                      // Since we're skipping the title card, position panel centered on the pin
                      if (map.current && finalLng !== null && finalLat !== null) {
                        const point = map.current.project([finalLng, finalLat]);
                        const mapContainer = map.current.getContainer();
                        const containerRect = mapContainer.getBoundingClientRect();
                        // Center panel on pin (no title card offset needed)
                        setSelectedPropertyPosition({
                          x: containerRect.left + point.x,
                          y: containerRect.top + point.y
                        });
                      }
                      
                      // Set states (same as title card click)
                      setSelectedProperty(propertyToShow); // Use property with full hub data
                      setShowPropertyCard(true);
                      setShowPropertyDetailsPanel(true);
                      setIsLargeCardMode(true); // CRITICAL: Enable large card mode
                      setIsExpanded(false);
                      setShowFullDescription(false);
                      
                      // CRITICAL: Now that panel is shown (backup path), clean up the PropertyTitleCard marker
                        // Only clean up if NOT in navigation mode (navigation mode keeps the title card)
                        if (!isNavigationOnlyRef.current) {
                      cleanupPropertyTitleCardMarker();
                        }
                      }
                      
                      // panelShown already set at start of handler
                      console.log('✅ Recent project: Animation complete (backup), showing property details panel');
                    }
                  }
                };
                
                // Listen for when the animation completes (backup)
                map.current.once('moveend', handleMoveEnd);
                
                // Start the smooth animation
                map.current.flyTo({
                  center: propertyPinCoordinates,
                  zoom: 17.5, // Zoom directly to target level
                  duration: animationDuration, // Single smooth animation duration
                  essential: true,
                  offset: [horizontalOffset, verticalOffset], // Center horizontally in visible area
                  easing: (t) => {
                    // Very smooth easing function - ease-in-out-cubic for buttery smooth animation
                    return t < 0.5
                      ? 4 * t * t * t
                      : 1 - Math.pow(-2 * t + 2, 3) / 2;
                  }
                });
                
                // Set flags to prevent duplicate zoom logic AND marker creation
                hasCenteredMapRef.current = { lat: finalLat, lng: finalLng };
                hasJumpedToPropertyPinRef.current = true;
                
                // CRITICAL: Mark that we're from recent projects to skip title card creation in main flow
                (window as any).__isRecentProjectSelection = true;
                
                // Return early to skip the main zoom logic and marker creation below
                return;
              } else {
                // Map not ready - set position from coordinates (will update when map loads)
                // Calculate center of visible area (between chat panel edge and screen edge)
                const leftEdge = chatPanelWidth + sidebarWidth;
                const visibleWidth = window.innerWidth - leftEdge;
                const centerX = leftEdge + (visibleWidth / 2);
                
                setSelectedPropertyPosition({
                  x: centerX,
                  y: window.innerHeight / 2
                });
                
                // Store for when map is ready - ensure we use provided coordinates if available
                // REMOVED: __pendingMapUpdate - no map centering
              }
              
              return; // Exit early - card is already displayed
            }
          } else {
            console.log('⚠️ Cache expired or invalid, will search loaded properties');
          }
        }
      } catch (e) {
        console.warn('Failed to read cached property data:', e);
      }
    }
    
    // Only search loaded properties if we don't have cached data
    if (!finalProperty) {
      console.log('🔍 Property search:', {
        providedProperties: providedProperties?.length || 0,
        preloadedProperties: preloadedProperties?.length || 0,
        propertyMarkers: propertyMarkers.length,
        searchResults: searchResults.length,
        totalProperties: allProperties.length
      });
    
    // First try to find by property ID if provided (more reliable)
    let property = null;
    if (propertyId) {
      property = allProperties.find(p => p.id === propertyId || p.id?.toString() === propertyId);
      if (property) {
        console.log('📍 Found property by ID:', propertyId);
      }
    }
    
    // If not found by ID, try by address
    if (!property) {
      property = allProperties.find(p => {
        if (!p.address) return false;
        const normalizedProperty = normalizeAddress(p.address);
        
        // Check if key parts match (Highlands, Berden, CM23)
        const searchParts = normalizedSearch.split(' ').filter(p => p.length > 2);
        const propertyParts = normalizedProperty.split(' ').filter(p => p.length > 2);
        
        // Check if all key search parts are in property address
        const allPartsMatch = searchParts.every(part => 
          propertyParts.some(propPart => propPart.includes(part) || part.includes(propPart))
        );
        
        // Also check simple contains match
        const containsMatch = normalizedProperty.includes(normalizedSearch) || 
                             normalizedSearch.includes(normalizedProperty);
        
        return allPartsMatch || containsMatch;
      });
    }
    
      // CRITICAL: Recent project coordinates = property pin location (user-set final selection from Create Property Card)
      // NEVER use property.latitude/longitude from backend as these may be document-extracted coordinates
      // The property pin location is where the user placed/confirmed the pin, not where documents say the property is
      // Property pin location is the user-set location (geocoding_status: 'manual') - the final coordinates selected when user clicked Create Property Card
      // ONLY use provided coordinates (property pin location) - never use property coordinates from backend
      if (coordinates && coordinates.lat && coordinates.lng) {
        finalLat = coordinates.lat;
        finalLng = coordinates.lng;
        console.log('✅ Using property pin location coordinates:', { lat: finalLat, lng: finalLng });
      } else {
        // No coordinates provided - don't center map
        console.log('⚠️ No property pin location coordinates provided');
        finalLat = null;
        finalLng = null;
      }
      
      if (property) {
        finalProperty = property;
      }
    }
    
    // CRITICAL: Jump directly to property pin location (just above the pin) - no animation, no default location logic
    // Only center once per selection to prevent multiple jumps
    // SKIP this if we already handled it in the cached data path (recent projects)
    if (finalLat !== null && finalLng !== null && map.current) {
      const currentCoords = { lat: finalLat, lng: finalLng };
      const hasCentered = hasCenteredMapRef.current && 
        hasCenteredMapRef.current.lat === currentCoords.lat && 
        hasCenteredMapRef.current.lng === currentCoords.lng;
      
      // If we already handled this in cached path (recent projects), skip main zoom logic
      const alreadyHandledInCachedPath = hasJumpedToPropertyPinRef.current && hasCentered;
      
      if (!hasCentered && !alreadyHandledInCachedPath) {
        console.log('📍 Jumping directly to property pin location (just above pin):', { lat: finalLat, lng: finalLng });
        hasCenteredMapRef.current = currentCoords;
        const propertyPinCoordinates: [number, number] = [finalLng, finalLat];
        
        // Jump directly to just above the pin - no animation, no transition (duration: 0 = instant)
        hasJumpedToPropertyPinRef.current = true; // Flag to prevent default location from overriding
        // Calculate offset to center the card and pin in visible area
        const cardHeight = 360; // Approximate card height
        const verticalOffset = (cardHeight / 2) - 40; // Offset down to center, then move up slightly
        // Calculate horizontal offset to center in visible area (between chat panel and screen edge)
        // CRITICAL: Mapbox offset is relative to the map container, not the viewport
        const mapContainer = map.current.getContainer();
        const containerRect = mapContainer.getBoundingClientRect();
        const containerWidth = containerRect.width;
        const containerLeft = containerRect.left;
        
        // Use chatPanelWidthRef to get the CURRENT chat panel width (may have been updated by navigation action)
        const currentChatPanelWidth = chatPanelWidthRef.current;
        const leftEdge = currentChatPanelWidth + sidebarWidth;
        const visibleWidth = containerWidth - (leftEdge - containerLeft);
        const visibleCenterX = leftEdge + (visibleWidth / 2);
        const containerCenterX = containerLeft + (containerWidth / 2);
        const horizontalOffset = (visibleCenterX - containerCenterX);
        
        console.log('📍 Property centering (instant jump):', {
          chatPanelWidth: currentChatPanelWidth,
          sidebarWidth,
          containerWidth,
          containerLeft,
          leftEdge,
          visibleWidth,
          visibleCenterX,
          containerCenterX,
          horizontalOffset
        });
        
        // First, center the property (with correct offset for chat panel) at current zoom
        const currentZoom = map.current.getZoom();
        map.current.flyTo({
          center: propertyPinCoordinates,
          zoom: currentZoom, // Keep current zoom level for centering
          duration: 600, // Smooth centering animation
          essential: true,
          offset: [horizontalOffset, verticalOffset], // Center horizontally in visible area
          easing: (t) => {
            // Smooth easing for centering
            return t < 0.5
              ? 2 * t * t
              : 1 - Math.pow(-2 * t + 2, 2) / 2;
          }
        });
        
        // Then, after centering completes, zoom in smoothly
        setTimeout(() => {
          if (map.current) {
            map.current.flyTo({
              center: propertyPinCoordinates,
              zoom: 17.5, // Zoom in to property
              duration: 1000, // Smooth zoom animation
              essential: true,
              offset: [horizontalOffset, verticalOffset], // Maintain offset during zoom
              easing: (t) => {
                // Smooth easing for zoom
                return t < 0.5
                  ? 2 * t * t
                  : 1 - Math.pow(-2 * t + 2, 2) / 2;
              }
            });
            
            // Open property details panel after zoom animation completes (only if not navigation-only mode)
            // Total animation time: 600ms (center) + 1000ms (zoom) = 1600ms
            // Wait 1700ms to ensure animation is fully complete
            if (!isNavigationOnlyRef.current) {
            setTimeout(() => {
              setShowPropertyDetailsPanel(true);
            }, 1700);
            }
          }
        }, 650); // Start zoom after centering completes (600ms + 50ms buffer)
        
        // Reset flag after both animations complete
        // This prevents re-centering from interfering with the initial animations
        setTimeout(() => {
          hasJumpedToPropertyPinRef.current = false;
        }, 1700); // Total animation time (600ms + 1000ms) + 100ms buffer
      }
    }
    
    // If we have a final destination, proceed with selection and single fly
    if (finalLat !== null && finalLng !== null) {
        
        // If property not found in loaded list, try to fetch it by ID
        if (!finalProperty && propertyId && coordinates) {
          // Try to fetch property by ID from backend
          try {
            console.log('🔍 Property not in loaded list, fetching by ID:', propertyId);
            const propertyHubResponse = await backendApi.getPropertyHub(propertyId);
            if (propertyHubResponse && propertyHubResponse.success && propertyHubResponse.data) {
              const hub = propertyHubResponse.data;
              const property = hub.property || {};
              const propertyDetails = hub.property_details || {};
              
              // Transform to match expected format
              finalProperty = {
                id: property.id,
                address: property.formatted_address || property.normalized_address || address,
                postcode: '',
                property_type: propertyDetails.property_type || '',
                bedrooms: propertyDetails.number_bedrooms || 0,
                bathrooms: propertyDetails.number_bathrooms || 0,
                soldPrice: propertyDetails.sold_price || 0,
                rentPcm: propertyDetails.rent_pcm || 0,
                askingPrice: propertyDetails.asking_price || 0,
                price: propertyDetails.sold_price || propertyDetails.rent_pcm || propertyDetails.asking_price || 0,
                square_feet: propertyDetails.size_sqft || 0,
                latitude: coordinates.lat,
                longitude: coordinates.lng,
                image: propertyDetails.primary_image_url || "/property-1.png",
                propertyHub: hub
              };
              
              console.log('✅ Fetched property by ID successfully');
            }
          } catch (error) {
            console.warn('⚠️ Failed to fetch property by ID:', error);
            // Continue to create minimal property if fetch fails
          }
        }
        
        // If still no property but we have coordinates, create minimal property object to show pin
        if (!finalProperty && coordinates && coordinates.lat && coordinates.lng) {
          console.log('📍 Creating minimal property object to show pin at coordinates');
          finalProperty = {
            id: propertyId || `temp-${Date.now()}`,
            address: address || 'Property',
            latitude: coordinates.lat,
            longitude: coordinates.lng,
            price: 0,
            bedrooms: 0,
            bathrooms: 0,
            square_feet: 0,
            image: "/property-1.png"
          };
        }
        
        // If we still don't have a property, retry or give up
        if (!finalProperty) {
          // Property not found yet - retry to find it before showing card
          const hasPreloadedProperties = preloadedProperties && preloadedProperties.length > 0;
          const hasPropertiesLoaded = allProperties.length > 0 || propertyMarkers.length > 0 || searchResults.length > 0;
          
          // OPTIMIZATION: If we have propertyId, only retry a few times (properties should load quickly)
          // If no propertyId, retry more times to wait for async loading
          const maxRetries = propertyId ? 5 : 20; // Slightly more retries for reliability
          if (retryCount < maxRetries) {
            // Only log if it's taking a while to avoid console spam
            if (retryCount === 0 || retryCount % 2 === 0) {
              console.log('⏳ Property not found yet, retrying...', {
                retryCount,
                maxRetries,
                propertyId,
                address,
                totalProperties: allProperties.length
              });
            }
            
            // Faster retries for snappier feel - start fast, stay fast
            const retryDelay = hasPropertiesLoaded 
              ? 50  // Very fast retry if properties are loaded
              : Math.min(30 * (retryCount + 1), 150); // Faster exponential backoff, max 150ms
            
            setTimeout(() => {
              selectPropertyByAddress(address, coordinates, propertyId, isNavigationOnlyRef.current, retryCount + 1, providedProperties);
            }, retryDelay);
            return; // Don't show card until property is found
          } else {
            // After retries, don't show card - user wants full data only
            console.log('❌ Property not found after retries - not showing card (full data required):', address);
            // Keep pending selection for when properties finish loading - CRITICAL: Preserve coordinates!
            (window as any).__pendingPropertySelection = { address, coordinates, propertyId };
            return; // Don't show card without full property data
          }
        }
      
      // Store pin coordinates for marker positioning
      if (finalLat !== null && finalLng !== null) {
        selectedPropertyPinCoordsRef.current = { lat: finalLat, lng: finalLng };
      }
      
      // IMPORTANT: If property wasn't in loaded list, add it to the map source so the pin shows
      // This MUST happen BEFORE we try to hide the base marker
      // This ensures the base green pin is visible even if property wasn't in initial load
      if (map.current && finalProperty && finalLat !== null && finalLng !== null) {
        let source = map.current.getSource('properties') as mapboxgl.GeoJSONSource;
        
        // Create source if it doesn't exist
        if (!source) {
          try {
            map.current.addSource('properties', {
              type: 'geojson',
              data: { type: 'FeatureCollection', features: [] }
            });
            source = map.current.getSource('properties') as mapboxgl.GeoJSONSource;
            console.log('✅ Created properties source for property pin');
            
            // Also ensure layers exist
            const layersToAdd = [
              {
                id: 'property-click-target',
                type: 'circle' as const,
                paint: {
                  'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 20, 15, 25, 20, 30],
                  'circle-color': 'transparent',
                  'circle-stroke-width': 0
                }
              },
              {
                id: 'property-outer',
                type: 'circle' as const,
                paint: {
                  'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 8, 15, 12, 20, 16],
                  'circle-color': 'rgba(0, 0, 0, 0.08)',
                  'circle-stroke-width': 0
                }
              },
              {
                id: 'property-markers',
                type: 'circle' as const,
                paint: {
                  'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 15, 8, 20, 10],
                  'circle-color': '#D1D5DB',
                  'circle-stroke-width': 2,
                  'circle-stroke-color': '#ffffff',
                  'circle-opacity': 1.0
                }
              }
            ];
            
            layersToAdd.forEach(layerConfig => {
              if (!map.current.getLayer(layerConfig.id)) {
                try {
                  map.current.addLayer({
                    id: layerConfig.id,
                    type: layerConfig.type,
                    source: 'properties',
                    paint: layerConfig.paint as any
                  });
                } catch (error) {
                  console.warn(`⚠️ Error adding layer ${layerConfig.id}:`, error);
                }
              }
            });
          } catch (error) {
            console.warn('⚠️ Error creating properties source:', error);
          }
        }
        
        // Add property to source if it's not already there
        if (source) {
          try {
            const currentData = source._data as GeoJSON.FeatureCollection;
            const existingFeature = currentData.features.find(
              (f: any) => f.properties.id === finalProperty.id || f.properties.id?.toString() === finalProperty.id?.toString()
            );
            
            if (!existingFeature) {
              // Property not in source - add it
              const getPropertyName = (addr: string) => {
                if (!addr) return '';
                const parts = addr.split(',');
                return parts[0]?.trim() || addr;
              };
              
              const propertyName = getPropertyName(finalProperty.address);
              const newFeature: GeoJSON.Feature = {
                type: 'Feature',
                geometry: {
                  type: 'Point',
                  coordinates: [finalLng, finalLat]
                },
                properties: {
                  id: finalProperty.id,
                  address: finalProperty.address,
                  propertyName: propertyName || finalProperty.address,
                  price: finalProperty.price || 0,
                  bedrooms: finalProperty.bedrooms || 0,
                  bathrooms: finalProperty.bathrooms || 0,
                  squareFeet: finalProperty.square_feet || 0,
                  type: finalProperty.type,
                  condition: finalProperty.condition,
                  features: finalProperty.features,
                  summary: finalProperty.summary,
                  image: finalProperty.image,
                  agent: finalProperty.agent
                }
              };
              
              const updatedFeatures = [...currentData.features, newFeature];
              source.setData({
                type: 'FeatureCollection',
                features: updatedFeatures
              });
              
              console.log('✅ Added property to map source so pin will show');
            }
          } catch (error) {
            console.warn('⚠️ Error adding property to map source:', error);
          }
          }
        }
      
      // Hide the base marker for this property by filtering it out (same as clicking a pin)
      // Do this AFTER adding to source so the filter works
      if (map.current.getLayer('property-markers')) {
        map.current.setFilter('property-markers', [
          '!=',
          ['get', 'id'],
          finalProperty.id
        ]);
      }
      
      // Also hide the outer ring for this property (same as clicking a pin)
      if (map.current.getLayer('property-outer')) {
        map.current.setFilter('property-outer', [
          '!=',
          ['get', 'id'],
          finalProperty.id
        ]);
      }
      
      // NEW: Two-step click logic - show title card instead of immediately opening PropertyDetailsPanel
      // PropertyDetailsPanel will open when title card is clicked
      // BUT: Skip title card for recent projects (they go straight to panel)
      const isRecentProject = (window as any).__isRecentProjectSelection;
      if (isRecentProject) {
        // Clear the flag
        (window as any).__isRecentProjectSelection = false;
        // Skip title card creation - recent projects handled in cached path
        console.log('⏭️ Skipping title card creation - recent project (handled in cached path)');
        return; // Exit early - don't create any markers
      }
      
      // Only log on first attempt to reduce console noise
      if (retryCount === 0) {
        console.log('✅ Showing property title card:', {
          id: finalProperty.id,
          address: finalProperty.address
        });
      }
      
      // Don't open PropertyDetailsPanel immediately - title card will handle it
      setSelectedProperty(finalProperty);
      
      // Don't preload files here - let PropertyDetailsPanel load them lazily when needed
      // This prevents blocking the property card from rendering quickly
      
      // Calculate position for property details panel
      const point = map.current.project([finalLng, finalLat]);
      setSelectedPropertyPosition({
        x: point.x,
        y: point.y - 20
      });
      
      // Update existing marker if it exists, or create new one
      // This prevents the flicker of removing and recreating
      const getPropertyName = (addr: string) => {
        if (!addr) return '';
        const parts = addr.split(',');
        return parts[0]?.trim() || addr;
      };
      
      const propertyName = getPropertyName(finalProperty.address);
      const displayText = finalProperty.address || propertyName;
      
      // If marker already exists, just update its position instead of removing/recreating
      if (currentPropertyNameMarkerRef.current && map.current) {
        // Update existing marker position - no flicker!
        currentPropertyNameMarkerRef.current.setLngLat([finalLng, finalLat]);
        // Store marker coordinates - this is where the pin is located
        storeMarkerCoordinates(currentPropertyNameMarkerRef.current, finalProperty?.id);
        console.log('📍 Updated existing property title card marker position');
      } else if (map.current) {
        // Only create new marker if one doesn't exist
        // Create outer container div (Mapbox marker wrapper)
        const markerElement = document.createElement('div');
        markerElement.className = 'property-title-card-marker';
        markerElement.style.cssText = `
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          pointer-events: none; /* Don't block map clicks - only card content will capture clicks */
        `;
        
        // Create inner scalable container for the React component
        // This is what we'll scale with zoom
        const scalableContainer = document.createElement('div');
        scalableContainer.className = 'property-title-card-scalable';
        scalableContainer.style.cssText = `
            position: relative;
          transform-origin: bottom center;
          transition: none;
          pointer-events: auto; /* Only the card content captures clicks */
          user-select: text; /* Allow text selection */
          -webkit-user-select: text; /* Safari */
        `;
        markerElement.appendChild(scalableContainer);
        
        // Store reference to scalable container for zoom updates
        (markerElement as any).scalableContainer = scalableContainer;
        
        // CRITICAL: Prevent map click events from firing when clicking on the marker
        // Stop propagation in bubble phase (not capture) so React onClick fires first
        markerElement.addEventListener('click', (e) => {
          e.stopPropagation();
          console.log('🛑 Marker element click (selectPropertyByAddress end) - preventing map click handler');
        }, false); // Bubble phase - let React onClick fire first, then stop propagation to map
        
        markerElement.addEventListener('mousedown', (e) => {
          e.stopPropagation();
        }, false);
        
        // ALSO add click handler to scalableContainer to catch clicks that might not bubble to markerElement
        // Stop propagation immediately - React's synthetic events will still fire
        scalableContainer.addEventListener('click', (e) => {
          e.stopPropagation();
          console.log('🛑 Scalable container click (selectPropertyByAddress end) - preventing map click handler');
        }, false);
        
        scalableContainer.addEventListener('mousedown', (e) => {
          e.stopPropagation();
        }, false);
        
        // Disable map dragging when hovering over the card to allow text selection
        // Attach to scalableContainer since it has pointer-events: auto
        scalableContainer.addEventListener('mouseenter', () => {
          if (map.current) {
            map.current.dragPan.disable();
          }
          
          // Preload document covers on hover for faster loading when clicked
          if (finalProperty?.id && backendApi) {
            const propertyId = finalProperty.id;
            const preloadedFiles = (window as any).__preloadedPropertyFiles?.[propertyId];
            if (preloadedFiles && Array.isArray(preloadedFiles) && preloadedFiles.length > 0) {
              preloadDocumentCoversForProperty(preloadedFiles);
            } else {
              fetchAndPreloadDocumentCovers(propertyId, backendApi);
            }
          }
        });
        
        scalableContainer.addEventListener('mouseleave', () => {
          if (map.current) {
            map.current.dragPan.enable();
          }
        });
        
        // Also prevent map drag on mousedown when selecting text
        scalableContainer.addEventListener('mousedown', (e) => {
          // Allow text selection - don't stop propagation
          // The dragPan.disable() from mouseenter should handle preventing map drag
        });
        
        // Handle card click - opens PropertyDetailsPanel above the title card
        const handleCardClick = () => {
          console.log('📍 Property title card clicked (from selectPropertyByAddress end) - opening PropertyDetailsPanel above title card');
          
          // Set flag to prevent map click handler from deselecting (backup)
          titleCardClickedRef.current = true;
          // Clear flag after a short delay to allow map click handler to check it
          setTimeout(() => {
            titleCardClickedRef.current = false;
          }, 200); // Increased timeout to ensure map handler checks it
          
          if (finalProperty) {
            // Preload document covers immediately when title card is clicked
            if (finalProperty?.id && backendApi) {
              const propertyId = finalProperty.id;
              // Check if we already have preloaded files
              const preloadedFiles = (window as any).__preloadedPropertyFiles?.[propertyId];
              if (preloadedFiles && Array.isArray(preloadedFiles) && preloadedFiles.length > 0) {
                // Preload covers for existing documents
                preloadDocumentCoversForProperty(preloadedFiles);
              } else {
                // Fetch documents and preload covers
                fetchAndPreloadDocumentCovers(propertyId, backendApi);
              }
            }
            
            // Store pin coordinates
            if (finalLat !== null && finalLng !== null) {
              selectedPropertyPinCoordsRef.current = { lat: finalLat, lng: finalLng };
            }
            
            // Calculate position for PropertyDetailsPanel above the title card
            // The title card is positioned above the pin, so we position PropertyDetailsPanel above the title card
            if (map.current && finalLng !== null && finalLat !== null) {
              const point = map.current.project([finalLng, finalLat]);
              // Get map container position to convert to viewport coordinates
              const mapContainer = map.current.getContainer();
              const containerRect = mapContainer.getBoundingClientRect();
              // Position PropertyDetailsPanel using the SAME logic as PropertyTitleCard
              const titleCardHeight = 360;
              const pinRadius = 10;
              const gapAbovePin = 20; // Gap between pin and title card bottom (same as PropertyTitleCard)
              const titleCardBottomY = point.y - (pinRadius + gapAbovePin); // Where title card bottom is
              const titleCardTopY = titleCardBottomY - titleCardHeight; // Where title card top is
              const panelGap = 20; // Gap between PropertyDetailsPanel and title card
              // Position PropertyDetailsPanel so its bottom is above the title card top with a gap
              setSelectedPropertyPosition({
                x: containerRect.left + point.x, // Pin X position (same as PropertyTitleCard - will be centered with translate(-50%))
                y: containerRect.top + titleCardTopY - panelGap // Position above title card with gap
              });
            }
            
            // Set selected property - this will trigger the useEffect to re-center if chat panel width changes
            setSelectedProperty(finalProperty);
            setShowPropertyCard(true);
            setShowPropertyDetailsPanel(true);
            setIsLargeCardMode(true); // Enable large card mode (positioned above title card)
            setIsExpanded(false);
            setShowFullDescription(false);
            // Keep title card visible (it should remain below PropertyDetailsPanel)
            
            // Also re-center immediately when title card is clicked (in case chat panel is open)
            if (map.current && finalLng !== null && finalLat !== null && chatPanelWidth > 0) {
              const propertyPinCoordinates: [number, number] = [finalLng, finalLat];
              const cardHeight = 360;
              const verticalOffset = (cardHeight / 2) - 40;
              
              // CRITICAL: Mapbox offset is relative to the map container, not the viewport
              const mapContainer = map.current.getContainer();
              const containerRect = mapContainer.getBoundingClientRect();
              const containerWidth = containerRect.width;
              const containerLeft = containerRect.left;
              
              const leftEdge = chatPanelWidth + sidebarWidth;
              const visibleWidth = containerWidth - (leftEdge - containerLeft);
              const visibleCenterX = leftEdge + (visibleWidth / 2);
              const containerCenterX = containerLeft + (containerWidth / 2);
              const horizontalOffset = (visibleCenterX - containerCenterX);
              
              console.log('📍 Title card clicked (navigation end) - re-centering with chat panel:', {
                chatPanelWidth,
                containerWidth,
                containerLeft,
                horizontalOffset,
                source: 'title-card-click-navigation-end'
              });
              
              map.current.flyTo({
                center: propertyPinCoordinates,
                zoom: map.current.getZoom(),
                duration: 300,
                offset: [horizontalOffset, verticalOffset],
                essential: true
              });
            }
          }
        };
        
        // Render PropertyTitleCard component into scalable container
        const root = createRoot(scalableContainer);
        root.render(
          <PropertyTitleCard
            property={finalProperty}
            onCardClick={handleCardClick}
          />
        );
        
        // No need for click listener - pointer-events handles it:
        // markerElement has pointer-events: none (doesn't block map clicks)
        // scalableContainer has pointer-events: auto (only card content captures clicks)
        // Map click handler will detect clicks outside the card and deselect
        
        // Calculate offset for positioning (PropertyTitleCard without green pin)
        // Position the card raised above the pin so it doesn't overlap
        const cardHeight = 360; // Approximate card height (image + details, no pin/pointer)
        const pinRadius = 10; // Approximate pin radius
        const gapAbovePin = 20; // Gap between pin and card bottom
        const verticalOffset = -(pinRadius + gapAbovePin); // Negative Y moves upward
        
        // Anchor at bottom center and raise card above the pin
        const marker = new mapboxgl.Marker({
          element: markerElement,
          anchor: 'bottom',
          offset: [0, verticalOffset] // Raise card above pin
        })
          .setLngLat([finalLng, finalLat])
          .addTo(map.current);
        
        currentPropertyNameMarkerRef.current = marker;
        storeMarkerCoordinates(marker, finalProperty?.id);
        
        // Set up zoom listener - card stays fixed size when zoomed in, scales down when zoomed out
        setupMarkerZoomListener(marker);
        
        // Make the base marker transparent (instead of hiding) so click target remains active
        // IMPORTANT: property-click-target layer is separate from property-markers and remains fully functional
        // The property-click-target layer is a map layer (not HTML), so it works even with HTML markers
        // Since PropertyTitleCard's green pin has pointer-events: none, clicks on it pass through to the map layer
        // This ensures clicks still work while only showing the PropertyTitleCard's green pin
        if (map.current.getLayer('property-markers')) {
          // Set selected property pin to green, others to white
          map.current.setPaintProperty('property-markers', 'circle-color', [
            'case',
            ['==', ['get', 'id'], finalProperty.id],
            '#D1D5DB', // Light grey for selected property
            '#ffffff' // White for others
          ]);
          // Keep selected property visible (green pin) and others visible too
          map.current.setPaintProperty('property-markers', 'circle-opacity', 1.0);
        }
        // Note: property-click-target layer remains active and clickable - it's not affected by marker opacity
        
        // Hide the outer ring for selected property
        if (map.current.getLayer('property-outer')) {
          map.current.setFilter('property-outer', [
            '!=',
            ['get', 'id'],
            finalProperty.id
          ]);
        }
        
        // Update state to show title card
        setShowPropertyTitleCard(true);
        setTitleCardPropertyId(finalProperty?.id?.toString() || null);
      }
      
      
      // Update property position immediately (no need to wait for animation)
      // Note: Map centering already happened above when coordinates were first available
      if (finalProperty && map.current) {
        const positionPoint = map.current.project([finalLng, finalLat]);
        setSelectedPropertyPosition({
          x: positionPoint.x,
          y: positionPoint.y - 20
        });
        
        // Ensure marker position is correct
        if (currentPropertyNameMarkerRef.current) {
          currentPropertyNameMarkerRef.current.setLngLat([finalLng, finalLat]);
          // Store marker coordinates - this is where the pin is located
          storeMarkerCoordinates(currentPropertyNameMarkerRef.current, finalProperty?.id);
        }
      }
    } else {
      // Property not found yet - retry if we haven't exceeded max retries
      if (retryCount < 30) {
        console.log(`⏳ Property not found yet, retrying... (${retryCount + 1}/30)`, {
          searchAddress: address,
          normalizedSearch,
          availableProperties: allProperties.length,
          sampleAddresses: allProperties.slice(0, 3).map(p => p.address)
        });
        setTimeout(() => selectPropertyByAddress(address, coordinates, propertyId, isNavigationOnlyRef.current, retryCount + 1, providedProperties), 400);
      } else {
        console.log('⚠️ Property not found in search results after retries:', address, {
          totalProperties: allProperties.length,
          allAddresses: allProperties.map(p => p.address)
        });
      }
    }
  };

  useImperativeHandle(ref, () => ({
    updateLocation,
    flyToLocation,
    selectPropertyByAddress
  }));

  // Initialize map early (even when not visible) to preload markers
  // This ensures pins appear instantly when map view is opened
  useEffect(() => {
    // Always initialize map if container exists (even when not visible)
    // We'll just hide it with CSS until it's needed
    if (!mapContainer.current) {
      return;
    }
    
    // If map already exists, don't reinitialize
    if (map.current) {
      // Always show map container when rendered (for background mode)
      if (mapContainer.current) {
        mapContainer.current.style.display = 'block';
      }
      return;
    }
    
    // Set Mapbox token
    mapboxgl.accessToken = mapboxToken;
    
    // Debug: Verify token is set
    console.log('🗺️ Initializing Mapbox with token:', mapboxToken ? 'Token present ✅' : '❌ NO TOKEN!');
    
    if (!mapboxToken) {
      console.error('❌ MAPBOX TOKEN IS MISSING! Check your .env file for VITE_MAPBOX_TOKEN');
      return;
    }
    
    try {
      console.log('🗺️ Creating Mapbox map instance...');
      
      // Get default map location from localStorage
      const getDefaultMapLocation = () => {
        if (typeof window !== 'undefined') {
          const saved = localStorage.getItem(DEFAULT_MAP_LOCATION_KEY);
          if (saved) {
            try {
              const parsed = JSON.parse(saved);
              if (parsed.coordinates && Array.isArray(parsed.coordinates) && parsed.coordinates.length === 2) {
                return {
                  center: parsed.coordinates as [number, number],
                  zoom: parsed.zoom || 9.5 // Use saved zoom or default to 9.5 (zoomed out)
                };
              }
            } catch {
              // If parsing fails, fall through to default
            }
          }
        }
        // Default to London (since most properties are there) - zoomed out
        return { center: [-0.1276, 51.5074] as [number, number], zoom: 9.5 };
      };
      
      const defaultLocation = getDefaultMapLocation();
      
      // Track the initial location
      lastAppliedLocation.current = {
        coordinates: defaultLocation.center,
        zoom: defaultLocation.zoom
      };
      
      // CRITICAL: Hide map container until map is initialized at default location
      // This prevents any flash of Mapbox's default location (usually [0, 0] or somewhere else)
      if (mapContainer.current) {
        mapContainer.current.style.display = 'none'; // Hide until properly initialized at default location
      }
      
      // CRITICAL: Initialize map with default location immediately to prevent any default Mapbox location from showing
      // This ensures the map always starts at the user's default location (or London fallback)
      // Suppress harmless Mapbox style expression warnings about null layer values
      // These warnings occur when Mapbox evaluates style expressions on features without layer properties
      // They're harmless and come from Mapbox's default style, not our code
      const originalConsoleWarn = console.warn;
      const suppressMapboxLayerWarnings = (...args: any[]) => {
        const message = args[0]?.toString() || '';
        // Filter out Mapbox expression evaluation warnings about null layer values
        // These are harmless warnings from Mapbox's default style expressions
        if (message.includes('Failed to evaluate expression') && 
            message.includes('["get","layer"]') &&
            (message.includes('evaluated to null') || message.includes('was expected to be of type number'))) {
          return; // Suppress this specific harmless warning
        }
        originalConsoleWarn.apply(console, args);
      };
      console.warn = suppressMapboxLayerWarnings;

      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        // Default to a calmer colored style rather than the grey/light style.
        style: isColorfulMap ? 'mapbox://styles/mapbox/outdoors-v12' : 'mapbox://styles/mapbox/light-v11',
        center: defaultLocation.center, // Start at default location immediately - no Mapbox default
        zoom: defaultLocation.zoom, // Start at default zoom immediately - no Mapbox default
        bearing: 15, // Slight rotation for better view
        pitch: 45, // 3D perspective angle
        interactive: isVisible && isInteractive, // Only interactive when visible and isInteractive is true
        // Removed maxBounds to allow worldwide navigation
        attributionControl: false // Hide the attribution control
      });
      
      // Keep the warning filter active - these warnings will continue to appear as the map renders features
      // We only suppress the specific harmless Mapbox layer warnings, all other warnings still show
      
      // OPTIMIZATION: Warm up backend connection immediately
      // This establishes TCP + TLS before user clicks any property
      backendApiService.warmConnection();
      
      // Ensure map is at default location immediately (in case Mapbox applies its own default first)
      // This prevents any flash of a different location
      map.current.once('style.load', () => {
        if (map.current) {
          // Force map to default location to override any Mapbox default
          map.current.jumpTo({
            center: defaultLocation.center,
            zoom: defaultLocation.zoom
          });
          
          // Now show the map container (it's properly initialized at default location)
          if (mapContainer.current) {
            mapContainer.current.style.display = isVisible ? 'block' : 'none';
          }
        }
      });
      
      // Also ensure map is shown when it loads (in case style.load fires before load event)
      map.current.once('load', () => {
        if (map.current && mapContainer.current) {
          // Double-check map is at default location
          const currentCenter = map.current.getCenter();
          const currentZoom = map.current.getZoom();
          const isAtDefault = 
            Math.abs(currentCenter.lng - defaultLocation.center[0]) < 0.001 &&
            Math.abs(currentCenter.lat - defaultLocation.center[1]) < 0.001 &&
            Math.abs(currentZoom - defaultLocation.zoom) < 0.1;
          
          if (!isAtDefault) {
            // Force to default location if not already there
            map.current.jumpTo({
              center: defaultLocation.center,
              zoom: defaultLocation.zoom
            });
          }
          
          // Show map container now that it's properly initialized at default location
          mapContainer.current.style.display = 'block';
        }
      });

      // Wait for map to load
      map.current.on('load', () => {
        console.log('✅ Map loaded successfully');
        
        // CRITICAL: Resize map on load to ensure proper sizing, especially for background mode
        // This fixes the issue where map doesn't display correctly on first dashboard load
        if (map.current) {
          requestAnimationFrame(() => {
            if (map.current) {
              map.current.resize();
            }
          });
        }
        
        loadProperties();
        
        // REMOVED: __pendingMapUpdate logic - no map centering on recent project click
        
        // Check for pending property selection (when map opens from recent project card)
        // CRITICAL: Use property pin location coordinates (user-set) if available
        const pendingSelection = (window as any).__pendingPropertySelection;
        if (pendingSelection && pendingSelection.address) {
          console.log('📍 Processing pending property selection with pin location coordinates:', pendingSelection);
          // OPTIMIZATION: Reduced delay from 300ms to 10ms for faster response
          // The retry logic will handle waiting for properties to load
          // Use property pin location coordinates (user-set) to center map on pin location
          setTimeout(() => {
            selectPropertyByAddress(pendingSelection.address, pendingSelection.coordinates, pendingSelection.propertyId, false, 0);
          }, 10);
        }
        
        // Enable or disable interaction controls based on isInteractive prop
        if (map.current) {
          if (isVisible && isInteractive) {
            map.current.scrollZoom.enable();
            map.current.boxZoom.enable();
            map.current.dragRotate.enable();
            map.current.dragPan.enable();
            map.current.keyboard.enable();
            map.current.doubleClickZoom.enable();
            map.current.touchZoomRotate.enable();
          } else {
            map.current.scrollZoom.disable();
            map.current.boxZoom.disable();
            map.current.dragRotate.disable();
            map.current.dragPan.disable();
            map.current.keyboard.disable();
            map.current.doubleClickZoom.disable();
            map.current.touchZoomRotate.disable();
          }
        }
        
        console.log('✅ Mapbox map loaded successfully!');
        // Permanently hide all Mapbox branding elements
        const hideMapboxBranding = () => {
        // Hide attribution control
        const attributionElement = map.current.getContainer().querySelector('.mapboxgl-ctrl-attrib');
        if (attributionElement) {
          (attributionElement as HTMLElement).style.display = 'none';
        }
          // Hide Mapbox logo
          const logoElement = map.current.getContainer().querySelector('.mapboxgl-ctrl-logo');
          if (logoElement) {
            (logoElement as HTMLElement).style.display = 'none';
          }
          // Hide any other Mapbox control elements
          const mapboxControls = map.current.getContainer().querySelectorAll('[class*="mapboxgl-ctrl"]');
          mapboxControls.forEach((ctrl: Element) => {
            const htmlCtrl = ctrl as HTMLElement;
            if (htmlCtrl.classList.contains('mapboxgl-ctrl-attrib') || 
                htmlCtrl.classList.contains('mapboxgl-ctrl-logo')) {
              htmlCtrl.style.display = 'none';
            }
          });
        };
        
        // Hide branding immediately
        hideMapboxBranding();
        
        // Also hide branding after a short delay to catch any late-loading elements
        setTimeout(hideMapboxBranding, 100);
        setTimeout(hideMapboxBranding, 500);
        
        // Use MutationObserver to watch for any dynamically added Mapbox branding
        const observer = new MutationObserver(() => {
          hideMapboxBranding();
        });
        
        // Observe the map container for any DOM changes
        if (map.current.getContainer()) {
          observer.observe(map.current.getContainer(), {
            childList: true,
            subtree: true
          });
        }
        
        // Store observer for cleanup
        (map.current as any)._mapboxBrandingObserver = observer;
        
        // Labels are visible by default with colorful style
        
        // Remove any existing markers first
        if (currentMarker.current) {
          currentMarker.current.remove();
          currentMarker.current = null;
        }

        // CRITICAL: Load and display ALL comparable properties IMMEDIATELY on map initialization
        // This happens as soon as map is created (even if hidden)
        // Property pins will be ready instantly when map becomes visible
        console.log('🗺️ IMMEDIATELY loading ALL comparable properties on map initialization (for instant pin rendering)...');
        // Use loadProperties to get all properties from backend - starts immediately
        loadProperties();
        
        // Navigation controls removed per user request
        
        // Update property card position when map moves
        map.current?.on('move', () => {
          if (selectedProperty && (showPropertyCard || showPropertyDetailsPanel)) {
            // Use map.project to get the current screen position of the selected property
            const coordinates: [number, number] = [selectedProperty.longitude, selectedProperty.latitude];
            const point = map.current.project(coordinates);
            
            setSelectedPropertyPosition({
              x: point.x,
              y: point.y - 20
            });
            
            // Ensure property name marker stays visible during map movement
            // Get coordinates directly from the marker - this is where the pin is located
            if (currentPropertyNameMarkerRef.current) {
              try {
                const lngLat = currentPropertyNameMarkerRef.current.getLngLat();
                if (lngLat) {
                  // Update stored coordinates from marker
                  selectedPropertyPinCoordsRef.current = { lat: lngLat.lat, lng: lngLat.lng };
                }
              } catch (e) {
                // If we can't get marker coordinates, use stored pin coordinates
                if (selectedPropertyPinCoordsRef.current) {
                  const pinCoords = selectedPropertyPinCoordsRef.current;
                  currentPropertyNameMarkerRef.current.setLngLat([pinCoords.lng, pinCoords.lat]);
                }
              }
            }
          }
        });
        
        console.log('✅ Square map ready for interaction');
      });
      
      // Add basic event listeners
      map.current.on('error', (e) => {
        console.error('❌ Mapbox Map Error:', e);
        console.error('Error details:', {
          message: e.error?.message,
          status: (e.error as any)?.status,
          url: (e.error as any)?.url
        });
      });

    } catch (error) {
      console.error('🗺️ Failed to create square map:', error);
    }

    // Don't cleanup on visibility change - keep map initialized
    // Cleanup only happens on component unmount (see separate useEffect below)
  }, []); // Run once on mount, not when isVisible changes

  // Initialize both preview maps for toggle button thumbnails
  useEffect(() => {
    if (!isVisible || !defaultPreviewContainer.current || !lightPreviewContainer.current || !mapboxToken) return;
    if (defaultPreviewMap.current && lightPreviewMap.current) return; // Already initialized

    // Small delay to ensure containers are rendered
    const timer = setTimeout(() => {
      mapboxgl.accessToken = mapboxToken;
      
      // Get current map center if available, otherwise use default
      const currentCenter = map.current?.getCenter();
      const center: [number, number] = currentCenter 
        ? [currentCenter.lng, currentCenter.lat]
        : [-0.1276, 51.5074];
      const previewZoom = 7; // Fixed zoom level for preview (very zoomed out to avoid city name labels)

      // Helper function to hide labels and capture preview
      const hideLabelsAndCapture = (mapInstance: mapboxgl.Map, setter: (url: string) => void) => {
        const style = mapInstance.getStyle();
        if (style && style.layers) {
          style.layers.forEach((layer) => {
            if (layer.type === 'symbol' || layer.id.includes('label') || layer.id.includes('place')) {
              mapInstance.setLayoutProperty(layer.id, 'visibility', 'none');
            }
          });
        }
        
        setTimeout(() => {
          const canvas = mapInstance.getCanvas();
          const imageUrl = canvas.toDataURL('image/png');
          setter(imageUrl);
        }, 200);
      };

      // Create Default (Outdoors) preview map
      defaultPreviewMap.current = new mapboxgl.Map({
        container: defaultPreviewContainer.current!,
        style: 'mapbox://styles/mapbox/outdoors-v12',
        center: center,
        zoom: previewZoom,
        attributionControl: false,
        interactive: false,
        preserveDrawingBuffer: true,
      });

      defaultPreviewMap.current.on('load', () => {
        if (defaultPreviewMap.current) {
          hideLabelsAndCapture(defaultPreviewMap.current, setDefaultPreviewUrl);
        }
      });

      // Create Light preview map
      lightPreviewMap.current = new mapboxgl.Map({
        container: lightPreviewContainer.current!,
        style: 'mapbox://styles/mapbox/light-v11',
        center: center,
        zoom: previewZoom,
        attributionControl: false,
        interactive: false,
        preserveDrawingBuffer: true,
      });

      lightPreviewMap.current.on('load', () => {
        if (lightPreviewMap.current) {
          hideLabelsAndCapture(lightPreviewMap.current, setLightPreviewUrl);
        }
      });

      // Update previews when main map moves
      if (map.current) {
        const syncPreviews = () => {
          if (defaultPreviewMap.current && lightPreviewMap.current && map.current) {
            const currentCenter = map.current.getCenter();
            const center: [number, number] = [currentCenter.lng, currentCenter.lat];
            
            defaultPreviewMap.current.setCenter(center);
            defaultPreviewMap.current.setZoom(7);
            lightPreviewMap.current.setCenter(center);
            lightPreviewMap.current.setZoom(7);
            
            setTimeout(() => {
              if (defaultPreviewMap.current) {
                const canvas = defaultPreviewMap.current.getCanvas();
                setDefaultPreviewUrl(canvas.toDataURL('image/png'));
              }
              if (lightPreviewMap.current) {
                const canvas = lightPreviewMap.current.getCanvas();
                setLightPreviewUrl(canvas.toDataURL('image/png'));
              }
            }, 300);
          }
        };

        map.current.on('moveend', syncPreviews);
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      if (defaultPreviewMap.current) {
        defaultPreviewMap.current.remove();
        defaultPreviewMap.current = null;
      }
      if (lightPreviewMap.current) {
        lightPreviewMap.current.remove();
        lightPreviewMap.current = null;
      }
    };
  }, [isVisible, mapboxToken]);
  
  // Update map visibility and interactivity when isVisible or isInteractive changes
  useEffect(() => {
    if (map.current && mapContainer.current) {
      // Always show map container when rendered (for background mode)
      mapContainer.current.style.display = 'block';
      
      // Always resize map when it's visible (even if not interactive) to ensure proper sizing
      // This fixes the issue where map doesn't display correctly on first dashboard load
      if (isVisible) {
        // OPTIMIZATION: Use requestAnimationFrame instead of setTimeout for immediate execution
        // This reduces delay from 100ms to <16ms (one frame)
        requestAnimationFrame(() => {
          if (map.current) {
            map.current.resize();
            
            // Enable/disable interactions based on isInteractive
            if (isInteractive) {
              // Re-enable interactions - ensure map is fully interactive
              if (map.current.getCanvas()) {
                map.current.getCanvas().style.pointerEvents = 'auto';
                map.current.getCanvas().style.cursor = 'grab';
              }
              // Explicitly enable all zoom and interaction controls
              map.current.scrollZoom.enable();
              map.current.boxZoom.enable();
              map.current.dragRotate.enable();
              map.current.dragPan.enable();
              map.current.keyboard.enable();
              map.current.doubleClickZoom.enable();
              map.current.touchZoomRotate.enable();
              // Force map to be interactive
              if ((map.current as any).interactive !== undefined) {
                (map.current as any).interactive = true;
              }
            } else {
              // Disable interactions when not interactive (background mode)
              if (map.current.getCanvas()) {
                map.current.getCanvas().style.pointerEvents = 'none';
                map.current.getCanvas().style.cursor = 'default';
              }
              // Explicitly disable all zoom and interaction controls
              map.current.scrollZoom.disable();
              map.current.boxZoom.disable();
              map.current.dragRotate.disable();
              map.current.dragPan.disable();
              map.current.keyboard.disable();
              map.current.doubleClickZoom.disable();
              map.current.touchZoomRotate.disable();
              // Force map to be non-interactive
              if ((map.current as any).interactive !== undefined) {
                (map.current as any).interactive = false;
              }
            }
          }
        });
      } else {
        // Map is not visible - disable interactions
        if (map.current.getCanvas()) {
          map.current.getCanvas().style.pointerEvents = 'none';
        }
        // Explicitly disable all zoom and interaction controls
        if (map.current) {
          map.current.scrollZoom.disable();
          map.current.boxZoom.disable();
          map.current.dragRotate.disable();
          map.current.dragPan.disable();
          map.current.keyboard.disable();
          map.current.doubleClickZoom.disable();
          map.current.touchZoomRotate.disable();
        }
      }
    }
  }, [isVisible, isInteractive]);

  // Track last re-center to prevent rapid successive calls that cause jitter
  const lastRecenteredRef = useRef<{ chatPanelWidth: number; timestamp: number } | null>(null);
  // Track previous chat panel width to detect transitions (opening/closing)
  const previousChatPanelWidthRef = useRef<number>(0);
  
  // Re-center property pin when chat panel width changes (e.g., when chat expands/collapses)
  // This ensures the property stays centered in the visible map area
  // Works for both selectedProperty (title card clicked) and showPropertyTitleCard (pin clicked)
  useEffect(() => {
    // Only re-center if we have coordinates and either a selected property OR a visible title card
    const hasSelectedProperty = !!selectedProperty;
    const hasVisibleTitleCard = showPropertyTitleCard && titleCardPropertyId;
    const hasCoordinates = !!selectedPropertyPinCoordsRef.current;
    
    if (!map.current || !isVisible || !hasCoordinates || (!hasSelectedProperty && !hasVisibleTitleCard)) {
      previousChatPanelWidthRef.current = chatPanelWidth; // Update ref even if we return early
      return;
    }
    
    // Detect transition: chat panel closing (was open, now closed)
    const wasOpen = previousChatPanelWidthRef.current > 0;
    const isNowClosed = chatPanelWidth === 0;
    const chatJustClosed = wasOpen && isNowClosed;
    
    // Re-center when chat panel opens OR closes (to center in visible area)
    const shouldRecenter = chatPanelWidth > 0 || chatJustClosed;
    
    if (!shouldRecenter) {
      previousChatPanelWidthRef.current = chatPanelWidth; // Update ref
      return;
    }
    
    // CRITICAL: Don't re-center if we just jumped to a property pin (initial zoom-in animation)
    // Wait for the initial animation to complete before re-centering
    if (hasJumpedToPropertyPinRef.current) {
      console.log('⏸️ Skipping re-center - initial property pin animation in progress');
      return;
    }
    
    // Prevent rapid successive re-centering calls (debounce)
    const now = Date.now();
    const lastRecentered = lastRecenteredRef.current;
    if (lastRecentered && 
        lastRecentered.chatPanelWidth === chatPanelWidth && 
        now - lastRecentered.timestamp < 500) {
      console.log('⏸️ Skipping re-center - too soon after last re-center (debounce)');
      return;
    }
    
    const coords = selectedPropertyPinCoordsRef.current;
    const propertyPinCoordinates: [number, number] = [coords.lng, coords.lat];
    
    // Calculate offset to center in visible area (between chat panel and screen edge)
    const cardHeight = 360; // Approximate card height
    const verticalOffset = (cardHeight / 2) - 40; // Offset down to center, then move up slightly
    
    // When chat is open, center in visible area. When chat closes, center in full viewport
    let horizontalOffset: number;
    if (chatPanelWidth > 0 && map.current) {
      // Chat is open - center in visible area (between chat panel and screen edge)
      // CRITICAL: Mapbox offset is relative to the map container, not the viewport
      const mapContainer = map.current.getContainer();
      const containerRect = mapContainer.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const containerLeft = containerRect.left;
      
      const leftEdge = chatPanelWidth + sidebarWidth;
      const visibleWidth = containerWidth - (leftEdge - containerLeft);
      const visibleCenterX = leftEdge + (visibleWidth / 2);
      const containerCenterX = containerLeft + (containerWidth / 2);
      horizontalOffset = (visibleCenterX - containerCenterX);
    } else {
      // Chat is closed - center in full viewport (no offset)
      horizontalOffset = 0;
    }
    
    console.log('📍 Re-centering property (chat panel width changed):', {
      chatPanelWidth,
      previousWidth: previousChatPanelWidthRef.current,
      chatJustClosed,
      sidebarWidth,
      horizontalOffset,
      hasSelectedProperty,
      hasVisibleTitleCard,
      titleCardPropertyId,
      containerWidth: map.current ? map.current.getContainer().getBoundingClientRect().width : 'N/A',
      containerLeft: map.current ? map.current.getContainer().getBoundingClientRect().left : 'N/A'
    });
    
    // Longer delay to ensure chat panel has finished animating and any ongoing animations have settled
    const timeoutId = setTimeout(() => {
      if (map.current && selectedPropertyPinCoordsRef.current) {
        // Double-check that we're not in the middle of an initial animation
        if (hasJumpedToPropertyPinRef.current) {
          console.log('⏸️ Skipping re-center - initial animation still in progress');
          previousChatPanelWidthRef.current = chatPanelWidth; // Update ref even if we skip
          return;
        }
        
        const currentCenter = map.current.getCenter();
        const currentZoom = map.current.getZoom();
        
        // Use essential: false so it doesn't interrupt other animations
        // Use a smooth, longer duration to prevent jitter
        map.current.flyTo({
          center: propertyPinCoordinates,
          zoom: currentZoom, // Keep current zoom level
          duration: 600, // Smooth duration to prevent jitter
          offset: [horizontalOffset, verticalOffset],
          essential: false, // Don't interrupt other animations
          easing: (t) => {
            // Very smooth easing function - ease-in-out-cubic for buttery smooth animation
            return t < 0.5
              ? 4 * t * t * t
              : 1 - Math.pow(-2 * t + 2, 3) / 2;
          }
        });
        
        // Update last re-center timestamp to prevent rapid successive calls
        lastRecenteredRef.current = { chatPanelWidth, timestamp: Date.now() };
        // Update previous chat panel width for next comparison
        previousChatPanelWidthRef.current = chatPanelWidth;
        
        console.log('✅ Re-centered property pin smoothly');
      } else {
        console.warn('⚠️ Could not re-center: map or coords not available');
        previousChatPanelWidthRef.current = chatPanelWidth; // Update ref even on error
      }
    }, 500); // Longer delay to let chat panel finish and any ongoing animations settle
    
    return () => clearTimeout(timeoutId);
  }, [chatPanelWidth, sidebarWidth, isVisible, selectedProperty, showPropertyTitleCard, titleCardPropertyId]);
  
  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      if (map.current) {
        // Disconnect the branding observer if it exists
        const observer = (map.current as any)._mapboxBrandingObserver;
        if (observer) {
          observer.disconnect();
        }
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  // Update location when searchQuery changes (only on explicit search)
  // DISABLED: Location search is disabled in map view to allow query registration without map updates
  // useEffect(() => {
  //   if (searchQuery && isVisible && map.current) {
  //     // Enhanced search triggered
  //     updateLocation(searchQuery);
  //   }
  // }, [searchQuery, isVisible]);

  // Store isVisible in a ref so event handler can access current value
  const isVisibleRef = useRef(isVisible);
  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  // Listen for default map location changes from settings (always active, not dependent on isVisible)
  useEffect(() => {
    const handleLocationChange = (event: CustomEvent) => {
      const locationData = event.detail;
      if (!locationData || !locationData.coordinates || !Array.isArray(locationData.coordinates) || locationData.coordinates.length !== 2) {
        console.log('🗺️ SquareMap: Invalid location data in event', locationData);
        return;
      }

      const newLocation = {
        coordinates: locationData.coordinates as [number, number],
        zoom: locationData.zoom || 9.5
      };

      // Use ref to get current isVisible value
      const currentIsVisible = isVisibleRef.current;

      console.log('🗺️ SquareMap: Received location change event', {
        newLocation,
        mapReady: !!map.current,
        isVisible: currentIsVisible,
        lastLocation: lastAppliedLocation.current
      });

      // Check if this is the same location we already applied
      const lastLocation = lastAppliedLocation.current;
      if (lastLocation && 
          lastLocation.coordinates[0] === newLocation.coordinates[0] &&
          lastLocation.coordinates[1] === newLocation.coordinates[1] &&
          lastLocation.zoom === newLocation.zoom) {
        console.log('🗺️ SquareMap: Location unchanged, skipping update');
        return;
      }

      // If map is ready and visible, apply immediately
      // BUT: Skip if we've just jumped to a property pin location (don't override property selection)
      if (map.current && currentIsVisible && !hasJumpedToPropertyPinRef.current) {
        console.log('🗺️ SquareMap: Default location changed, updating map view immediately', newLocation);
        lastAppliedLocation.current = newLocation;
        map.current.flyTo({
          center: newLocation.coordinates,
          zoom: newLocation.zoom,
          duration: 1000, // Smooth transition
          essential: true
        });
      } else if (hasJumpedToPropertyPinRef.current) {
        console.log('🗺️ SquareMap: Skipping default location change - just jumped to property pin');
      } else {
        // Store for later when map becomes visible
        console.log('🗺️ SquareMap: Map not ready or not visible, storing location change for later', {
          newLocation,
          mapReady: !!map.current,
          isVisible: currentIsVisible
        });
        pendingLocationChange.current = newLocation;
      }
    };

    // Add event listener for default map location changes (always active)
    window.addEventListener('defaultMapLocationChanged', handleLocationChange as EventListener);
    console.log('🗺️ SquareMap: Event listener attached for defaultMapLocationChanged');

    // Cleanup
    return () => {
      window.removeEventListener('defaultMapLocationChanged', handleLocationChange as EventListener);
      console.log('🗺️ SquareMap: Event listener removed for defaultMapLocationChanged');
    };
  }, []); // Empty deps - listener stays attached, uses refs to access current values

  // Check localStorage and apply pending location when map becomes visible
  // BUT: Skip if we've just jumped to a property pin location (don't override property selection)
  useEffect(() => {
    if (!isVisible || !map.current) {
      console.log('🗺️ SquareMap: Visibility check skipped', { isVisible, mapReady: !!map.current });
      return;
    }
    
    // Skip applying default location if we've just jumped to a property pin
    if (hasJumpedToPropertyPinRef.current) {
      console.log('🗺️ SquareMap: Skipping default location - just jumped to property pin');
      return;
    }

    console.log('🗺️ SquareMap: Map became visible, checking for location updates');

    // Small delay to ensure map is fully ready
    const timeoutId = setTimeout(() => {
      if (!map.current) {
        console.log('🗺️ SquareMap: Map no longer available after timeout');
        return;
      }

      // Function to apply location change
      const applyLocationChange = (location: { coordinates: [number, number]; zoom: number }, source: string) => {
        if (!map.current) return;

        // Check if this is different from current map center
        const currentCenter = map.current.getCenter();
        const currentZoom = map.current.getZoom();
        const coordDiff = Math.abs(currentCenter.lng - location.coordinates[0]) + Math.abs(currentCenter.lat - location.coordinates[1]);
        const zoomDiff = Math.abs(currentZoom - location.zoom);

        // Only update if location or zoom has changed significantly
        if (coordDiff > 0.001 || zoomDiff > 0.1) {
          console.log(`🗺️ SquareMap: Applying location change from ${source}`, {
            location,
            currentCenter: { lng: currentCenter.lng, lat: currentCenter.lat },
            currentZoom,
            coordDiff,
            zoomDiff
          });
          lastAppliedLocation.current = location;
          map.current.flyTo({
            center: location.coordinates,
            zoom: location.zoom,
            duration: 1000,
            essential: true
          });
        } else {
          console.log(`🗺️ SquareMap: Location already matches (from ${source}), skipping update`, {
            location,
            currentCenter: { lng: currentCenter.lng, lat: currentCenter.lat },
            currentZoom
          });
          lastAppliedLocation.current = location;
        }
      };

      // First, check for pending location change from event
      if (pendingLocationChange.current) {
        const pending = pendingLocationChange.current;
        pendingLocationChange.current = null;
        console.log('🗺️ SquareMap: Found pending location change, applying', pending);
        applyLocationChange(pending, 'pending event');
        return;
      }

      // Always check localStorage for the default location (in case event was missed)
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(DEFAULT_MAP_LOCATION_KEY);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (parsed.coordinates && Array.isArray(parsed.coordinates) && parsed.coordinates.length === 2) {
              const savedLocation = {
                coordinates: parsed.coordinates as [number, number],
                zoom: parsed.zoom || 9.5
              };

              // Check if this differs from last applied location OR from current map center
              const lastLocation = lastAppliedLocation.current;
              const currentCenter = map.current.getCenter();
              const currentZoom = map.current.getZoom();
              
              // Compare with both last applied AND current map position
              // Use more lenient comparison for coordinates (0.0001 degrees ≈ 11 meters)
              const coordDiffFromLast = lastLocation ? 
                  Math.abs(lastLocation.coordinates[0] - savedLocation.coordinates[0]) + 
                  Math.abs(lastLocation.coordinates[1] - savedLocation.coordinates[1]) : 999;
              const zoomDiffFromLast = lastLocation ? 
                  Math.abs(lastLocation.zoom - savedLocation.zoom) : 999;
              
              const coordDiffFromCurrent = Math.abs(currentCenter.lng - savedLocation.coordinates[0]) + 
                  Math.abs(currentCenter.lat - savedLocation.coordinates[1]);
              const zoomDiffFromCurrent = Math.abs(currentZoom - savedLocation.zoom);
              
              const differsFromLast = !lastLocation || coordDiffFromLast > 0.0001 || zoomDiffFromLast > 0.1;
              const differsFromCurrent = coordDiffFromCurrent > 0.0001 || zoomDiffFromCurrent > 0.1;

              console.log('🗺️ SquareMap: Comparing saved location with current state', {
                savedLocation,
                lastLocation,
                currentCenter: { lng: currentCenter.lng, lat: currentCenter.lat },
                currentZoom,
                coordDiffFromLast,
                zoomDiffFromLast,
                coordDiffFromCurrent,
                zoomDiffFromCurrent,
                differsFromLast,
                differsFromCurrent
              });

              if (differsFromLast || differsFromCurrent) {
                console.log('🗺️ SquareMap: Found location in localStorage that differs, applying', {
                  savedLocation,
                  lastLocation,
                  currentCenter: { lng: currentCenter.lng, lat: currentCenter.lat },
                  currentZoom,
                  differsFromLast,
                  differsFromCurrent
                });
                applyLocationChange(savedLocation, 'localStorage');
              } else {
                console.log('🗺️ SquareMap: Location in localStorage matches both last applied and current map, skipping', {
                  savedLocation,
                  lastLocation,
                  currentCenter: { lng: currentCenter.lng, lat: currentCenter.lat },
                  currentZoom
                });
              }
            }
          } catch (error) {
            console.error('🗺️ SquareMap: Error parsing saved location', error);
          }
        } else {
          console.log('🗺️ SquareMap: No saved location in localStorage');
        }
      }
    }, 200); // Slightly longer delay to ensure map is ready

    return () => clearTimeout(timeoutId);
  }, [isVisible]);

  return (
    <AnimatePresence>
      {/* Always render map container (hidden when not visible) for early initialization */}
      <motion.div
        key="square-map-container"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        style={{ 
          display: 'block',
          pointerEvents: isInteractive ? 'auto' : 'none',
          position: 'fixed',
          top: containerStyle?.top || 0,
          left: 0, // Always at left edge - map stays full width
          bottom: containerStyle?.bottom || 0,
          width: '100vw', // Always full width - never resizes, no animations
          height: containerStyle?.height || '100vh',
          zIndex: containerStyle?.zIndex !== undefined ? containerStyle.zIndex : (isInteractive ? 5 : 0), // Lower z-index than chat panels (30, 50)
          overflow: 'hidden', // Clip any content that extends beyond the container
          backgroundColor: containerStyle?.backgroundColor || '#f5f5f5', // Match map background
          // Spread containerStyle last to allow overrides, but exclude width/left/right/maxWidth/clipPath/transition to prevent conflicts
          ...(containerStyle ? Object.fromEntries(
            Object.entries(containerStyle).filter(([key]) => !['width', 'left', 'right', 'maxWidth', 'clipPath', 'transition'].includes(key))
          ) : {})
        }}
          className="fixed"
        >
          <div 
            ref={mapContainer} 
            className="w-full h-full"
            style={{
              width: '100%',
              height: '100%',
              position: 'relative',
              overflow: 'hidden', // Ensure map doesn't overflow container
              boxSizing: 'border-box', // Ensure padding/borders are included in width
              backgroundColor: '#f5f5f5', // Match parent background to prevent white gap
              background: '#f5f5f5' // Ensure background is set (some browsers need both)
            }}
          />
          
          {/* Hidden Preview Map Containers for Thumbnails */}
          <div
            ref={defaultPreviewContainer}
            style={{
              position: 'absolute',
              width: '64px',
              height: '64px',
              left: '-10000px',
              top: '-10000px',
              visibility: 'hidden',
              pointerEvents: 'none',
            }}
          />
          <div
            ref={lightPreviewContainer}
            style={{
              position: 'absolute',
              width: '64px',
              height: '64px',
              left: '-10000px',
              top: '-10000px',
              visibility: 'hidden',
              pointerEvents: 'none',
            }}
          />
          
          {/* Map Style Toggle Button - Google Maps Style */}
          <div
            className="absolute"
            style={{
              right: '20px',
              top: '20px',
              zIndex: 60,
            }}
          >
            <motion.button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                // Clicking toggles the map style
                toggleMapStyle();
              }}
              disabled={isChangingStyle}
              className="flex flex-col overflow-hidden transition-all duration-200"
              style={{
                width: '40px',
                height: '40px',
                backgroundColor: '#FFFFFF',
                border: 'none',
                borderRadius: '8px',
                boxShadow: '0 1px 4px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.04)',
                cursor: isChangingStyle ? 'not-allowed' : 'pointer',
                padding: 0,
                pointerEvents: 'auto',
              }}
              whileHover={!isChangingStyle ? {
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.16), 0 0 0 1px rgba(0, 0, 0, 0.06)',
              } : {}}
              title={isChangingStyle ? "Changing style..." : "Map type"}
            >
              {/* Map preview button */}
              <div
                className="w-full h-full relative"
                style={{ borderRadius: '8px', overflow: 'hidden' }}
              >
                {isChangingStyle ? (
                  <div className="w-full h-full flex items-center justify-center bg-gray-50">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    >
                      <Loader2 className="w-5 h-5 text-gray-500" />
                    </motion.div>
                  </div>
                ) : (isColorfulMap ? lightPreviewUrl : defaultPreviewUrl) ? (
                  <img
                    src={isColorfulMap ? lightPreviewUrl! : defaultPreviewUrl!}
                    alt="Map preview"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-100">
                    <Layers className="w-5 h-5 text-gray-400" strokeWidth={1.5} />
                  </div>
                )}
              </div>
            </motion.button>
          </div>
          
          
          {/* 
            OLD PROPERTY CARD - DISABLED
            ============================================
            The old property card logic and formatting has been extracted to:
            frontend-ts/src/components/PropertyCardDetailed.tsx
            
            This component is preserved for future use in another view.
            The component is currently disabled and not rendering.
            
            To re-enable in the future, import PropertyCardDetailed and use:
            <PropertyCardDetailed
              property={selectedProperty}
              isVisible={showPropertyCard && !showPropertyDetailsPanel}
              onClose={() => setShowPropertyCard(false)}
            />
          */}
          
          {/* Old Property Card - Commented out, logic moved to PropertyCardDetailed.tsx */}
          {false && showPropertyCard && !showPropertyDetailsPanel && selectedProperty && (
            <div>
              {/* This block is intentionally disabled - see PropertyCardDetailed.tsx for the preserved code */}
                      </div>
          )}
          
        </motion.div>
      
      {/* Property Details Panel */}
      {/* OPTIMIZATION: Show panel immediately when we have property, even if map isn't ready */}
      {/* This ensures <1s response time when clicking recent project with cached data */}
      {showPropertyDetailsPanel && selectedProperty && (
        <PropertyDetailsPanel
          key="property-details-panel"
          property={selectedProperty}
          isVisible={showPropertyDetailsPanel}
          isLargeCardMode={isLargeCardMode}
          pinPosition={selectedPropertyPosition} // Pass pin position for positioning above pin
          isInChatMode={isInChatMode} // Pass chat mode state
          chatPanelWidth={chatPanelWidth} // Pass chat panel width for expansion logic
          onClose={() => {
            setShowPropertyDetailsPanel(false);
            setShowPropertyCard(false); // Also close the old property card
            setIsLargeCardMode(false); // Reset large card mode
            setSelectedProperty(null); // Clear selected property
            clearSelectedPropertyEffects(); // Restore base markers
          }}
        />
      )}
    </AnimatePresence>
  );
});

SquareMap.displayName = 'SquareMap';


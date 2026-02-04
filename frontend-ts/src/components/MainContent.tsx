"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SearchBar } from './SearchBar';
import PropertyValuationUpload from './PropertyValuationUpload';
import Analytics from './Analytics';
import { CloudBackground } from './CloudBackground';
import FlowBackground from './FlowBackground';
import DotGrid from './DotGrid';
import { PropertyOutlineBackground } from './PropertyOutlineBackground';
import { Property3DBackground } from './Property3DBackground';
import { PropertyCyclingBackground } from './PropertyCyclingBackground';
import { SquareMap, SquareMapRef } from './SquareMap';
import Profile from './Profile';
import { FileManager } from './FileManager';
import { useSystem } from '@/contexts/SystemContext';
import { backendApi } from '@/services/backendApi';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogOverlay } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MapPin, Palette, Bell, Shield, Globe, Monitor, LibraryBig, Upload, BarChart3, Database, Settings, User, CloudUpload, Image, Map, Fullscreen, Minimize2, Plus, ArrowUp, Folder, Layers, Check, Focus, Contrast, Search, Loader2, ArrowRight, ArrowLeft } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { DocumentPreviewModal } from './DocumentPreviewModal';
import { FileAttachmentData } from './FileAttachment';
import { usePreview } from '../contexts/PreviewContext';
import { useChatStateStore, useActiveChatDocumentPreview } from '../contexts/ChatStateStore';
import { StandaloneExpandedCardView } from './StandaloneExpandedCardView';
import { AgentTaskOverlay } from './AgentTaskOverlay';
import { RecentProjectsSection } from './RecentProjectsSection';
import { NewPropertyPinWorkflow } from './NewPropertyPinWorkflow';
import { SideChatPanel, SideChatPanelRef } from './SideChatPanel';
import { FloatingChatBubble } from './FloatingChatBubble';
import { QuickStartBar } from './QuickStartBar';
import { FilingSidebarProvider, useFilingSidebar } from '../contexts/FilingSidebarContext';
import { useChatPanel } from '../contexts/ChatPanelContext';
import { FilingSidebar } from './FilingSidebar';
import { UploadProgressBar } from './UploadProgressBar';
import { ProjectsPage } from './ProjectsPage';
import { PropertyDetailsPanel } from './PropertyDetailsPanel';
import { useChatHistory } from './ChatHistoryContext';
import { useBrowserFullscreen } from '../contexts/BrowserFullscreenContext';

export const DEFAULT_MAP_LOCATION_KEY = 'defaultMapLocation';

// Helper function to calculate dynamic zoom based on area size
const calculateZoomFromBbox = (bbox: number[] | undefined, placeType: string[] | undefined): number => {
  if (!bbox || bbox.length !== 4) {
    // Default zoom if no bbox
    return 9.5;
  }

  // Calculate area size from bbox
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const lngDiff = maxLng - minLng;
  const latDiff = maxLat - minLat;
  const areaSize = lngDiff * latDiff;

  // Determine zoom based on place type and area size
  if (placeType?.includes('neighborhood') || placeType?.includes('locality')) {
    // Small areas (villages, neighborhoods) - zoom in more
    if (areaSize < 0.01) return 13; // Very small village
    if (areaSize < 0.05) return 12; // Small village
    return 11; // Medium village
  } else if (placeType?.includes('place')) {
    // Towns and cities - zoom based on size
    if (areaSize < 0.1) return 11; // Small town
    if (areaSize < 0.5) return 10; // Medium town
    if (areaSize < 2) return 9.5; // Large town / small city
    return 9; // City
  } else if (placeType?.includes('region') || placeType?.includes('district')) {
    // Large regions - zoom out
    return 8;
  }

  // Default based on area size
  if (areaSize < 0.01) return 13;
  if (areaSize < 0.1) return 11;
  if (areaSize < 1) return 9.5;
  return 8;
};

// Location Picker Modal Component
const LocationPickerModal: React.FC<{ 
  savedLocation: string;
  onLocationSaved: () => void;
  onCloseSidebar?: () => void;
  onRestoreSidebarState?: (shouldBeCollapsed: boolean) => void;
  getSidebarState?: () => boolean;
}> = ({ savedLocation, onLocationSaved, onCloseSidebar, onRestoreSidebarState, getSidebarState }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [isPreviewMode, setIsPreviewMode] = React.useState(false);
  // Store sidebar state before entering preview mode
  const sidebarStateBeforePreviewRef = React.useRef<boolean | null>(null);
  // Store sidebar state before opening the modal
  const sidebarStateBeforeModalRef = React.useRef<boolean | null>(null);
  const [locationInput, setLocationInput] = React.useState<string>('');
  // Initialize with empty values - will be loaded from localStorage when modal opens
  const [selectedCoordinates, setSelectedCoordinates] = React.useState<[number, number] | null>(null);
  const [selectedLocationName, setSelectedLocationName] = React.useState<string>('');
  const [selectedZoom, setSelectedZoom] = React.useState<number>(9.5);
  const [isGeocoding, setIsGeocoding] = React.useState(false);
  const [geocodeError, setGeocodeError] = React.useState<string>('');
  const [suggestions, setSuggestions] = React.useState<Array<{ place_name: string; center: [number, number] }>>([]);
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = React.useState(false);
  const isSelectingSuggestionRef = React.useRef<boolean>(false);
  
  const mapContainer = React.useRef<HTMLDivElement>(null);
  const previewMapContainer = React.useRef<HTMLDivElement>(null);
  const map = React.useRef<mapboxgl.Map | null>(null);
  const previewMap = React.useRef<mapboxgl.Map | null>(null);
  const marker = React.useRef<mapboxgl.Marker | null>(null);
  const previewMarker = React.useRef<mapboxgl.Marker | null>(null);
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
  const geocodeTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const askButtonCheckIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
  const previewAskButtonCheckIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
  // Track if coordinate change is from user interaction (map click) to prevent sync loop
  const isUserInteractionRef = React.useRef<boolean>(false);
  // Track if zoom was explicitly set by user (vs calculated by reverse geocoding)
  const isZoomUserSelectedRef = React.useRef<boolean>(false);
  // Track if map was just initialized to prevent immediate sync
  const isMapJustInitializedRef = React.useRef<boolean>(false);
  // Track when loading coordinates from localStorage to prevent sync during initial load
  const isLoadingFromStorageRef = React.useRef<boolean>(false);
  // Track if coordinates are being updated from map drag to prevent effect loop
  const isUpdatingFromDragRef = React.useRef<boolean>(false);
  // Track if map is in initial load phase - prevent any zoom/position changes during this
  const isInitialMapLoadRef = React.useRef<boolean>(true);

  // Track if location data is ready to prevent race conditions
  const [isLocationDataReady, setIsLocationDataReady] = React.useState(false);

  // Fetch autocomplete suggestions
  React.useEffect(() => {
    if (!locationInput.trim() || locationInput.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Don't fetch suggestions if we're in the middle of selecting one
    if (isSelectingSuggestionRef.current) {
      return;
    }

    const fetchSuggestions = async () => {
      setIsLoadingSuggestions(true);
      try {
        const geocodingUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(locationInput)}.json?access_token=${mapboxToken}&limit=5&autocomplete=true&country=gb&proximity=-0.1276,51.5074`;
        const response = await fetch(geocodingUrl);
        const data = await response.json();
        if (data.features && data.features.length > 0) {
          setSuggestions(data.features.map((feature: any) => ({
            place_name: feature.place_name,
            center: feature.center
          })));
          // Only show suggestions if we're not selecting one
          if (!isSelectingSuggestionRef.current) {
            setShowSuggestions(true);
          }
        } else {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      } catch (error) {
        console.error('Suggestions error:', error);
        setSuggestions([]);
      } finally {
        setIsLoadingSuggestions(false);
      }
    };

    // Debounce the search
    const timeoutId = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(timeoutId);
  }, [locationInput, mapboxToken]);

  // Handle suggestion selection
  const handleSuggestionSelect = (suggestion: { place_name: string; center: [number, number] }) => {
    isSelectingSuggestionRef.current = true;
    setLocationInput(suggestion.place_name);
    setShowSuggestions(false);
    
    const [lng, lat] = suggestion.center;
    const coords: [number, number] = [lng, lat];
    
    setSelectedCoordinates(coords);
    setSelectedLocationName(suggestion.place_name);
    
    // Geocode to get bbox and calculate zoom
    const geocodeForZoom = async () => {
      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(suggestion.place_name)}.json?access_token=${mapboxToken}&limit=1`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.features && data.features.length > 0) {
          const feature = data.features[0];
          const calculatedZoom = calculateZoomFromBbox(feature.bbox, feature.place_type);
          setSelectedZoom(calculatedZoom);
        }
      } catch (error) {
        console.error('Error geocoding for zoom:', error);
      } finally {
        isSelectingSuggestionRef.current = false;
      }
    };
    
    geocodeForZoom();
  };

  // Store and restore sidebar state when modal opens/closes
  React.useEffect(() => {
    if (isOpen) {
      // Store sidebar state when modal opens
      if (getSidebarState) {
        sidebarStateBeforeModalRef.current = getSidebarState();
      }
      // Close sidebar when modal opens
      onCloseSidebar?.();
    } else {
      // Restore sidebar state when modal closes
      if (onRestoreSidebarState && sidebarStateBeforeModalRef.current !== null) {
        onRestoreSidebarState(sidebarStateBeforeModalRef.current);
        sidebarStateBeforeModalRef.current = null;
      }
    }
  }, [isOpen, getSidebarState, onCloseSidebar, onRestoreSidebarState]);

  // Reload saved location when modal opens - simple: whatever was last saved
  React.useEffect(() => {
    if (isOpen) {
      setIsLocationDataReady(false);
      
      // Set flags to prevent sync effect and zoom updates during initial load
      isLoadingFromStorageRef.current = true;
      isInitialMapLoadRef.current = true;
      
      // Simple logic: Get the last saved location from localStorage
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(DEFAULT_MAP_LOCATION_KEY);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (parsed.coordinates && Array.isArray(parsed.coordinates) && parsed.coordinates.length === 2) {
              // Use exactly what was saved - no reverse geocoding, no defaults
              setLocationInput(parsed.name || '');
              setSelectedCoordinates(parsed.coordinates as [number, number]);
              setSelectedLocationName(parsed.name || '');
              setSelectedZoom(parsed.zoom || 9.5);
              setIsLocationDataReady(true);
              console.log('📍 LocationPicker: Loaded last saved location', {
                name: parsed.name,
                coordinates: parsed.coordinates,
                zoom: parsed.zoom
              });
              return;
            }
          } catch (error) {
            console.error('❌ LocationPicker: Error parsing saved location', error);
          }
        }
      }
      
      // Only use defaults if nothing was ever saved
      const defaultCoords: [number, number] = [-0.1276, 51.5074]; // London
      setLocationInput('London, UK');
      setSelectedCoordinates(defaultCoords);
      setSelectedLocationName('London, UK');
      setSelectedZoom(9.5);
      setIsLocationDataReady(true);
      console.log('📍 LocationPicker: No saved location found, using default (London)');
    } else {
      setIsLocationDataReady(false);
      // Reset flags when modal closes
      isLoadingFromStorageRef.current = false;
      isInitialMapLoadRef.current = true; // Reset for next open
    }
  }, [isOpen]);

  // Initialize map when modal opens and location is loaded
  React.useEffect(() => {
    // Clean up any existing map first
    if (map.current) {
      console.log('📍 LocationPicker: Cleaning up existing map');
      map.current.remove();
      map.current = null;
    }
    if (marker.current) {
      marker.current.remove();
      marker.current = null;
    }
    
    // Reset initialization and loading flags when cleaning up
    isMapJustInitializedRef.current = false;
    isLoadingFromStorageRef.current = false;

    if (!isOpen || !mapContainer.current) {
      console.log('📍 LocationPicker: Modal not open or container not ready', { isOpen, hasContainer: !!mapContainer.current });
      return;
    }

    // Wait for location data to be ready before initializing map
    if (!isLocationDataReady || !selectedCoordinates) {
      console.log('📍 LocationPicker: Waiting for location data to be loaded...', { isLocationDataReady, hasCoordinates: !!selectedCoordinates });
      return;
    }

    if (!mapboxToken) {
      console.error('❌ Mapbox token is missing!');
      return;
    }

    console.log('📍 LocationPicker: Initializing map...', {
      hasToken: !!mapboxToken,
      tokenPrefix: mapboxToken.substring(0, 10) + '...',
      containerSize: mapContainer.current ? {
        width: mapContainer.current.offsetWidth,
        height: mapContainer.current.offsetHeight
      } : 'no container'
    });

    mapboxgl.accessToken = mapboxToken;
    
    // Use the current state values (already loaded by the isOpen effect)
    // These will be the saved location if it exists, or defaults
    const initialCenter = selectedCoordinates;
    const initialZoom = selectedZoom;

    // Wait for dialog to be fully open and use requestAnimationFrame for smoother initialization
    const initMap = () => {
      if (!isOpen || !mapContainer.current) {
        console.error('❌ LocationPicker: Modal closed or container disappeared before map init', { isOpen, hasContainer: !!mapContainer.current });
        return;
      }

      // Use requestAnimationFrame to ensure DOM is ready and dialog animation is complete
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!isOpen || !mapContainer.current) return;

          // Double-check container has dimensions - retry if not ready
          const checkAndInit = () => {
            if (!isOpen || !mapContainer.current) return;

            if (mapContainer.current.offsetWidth === 0 || mapContainer.current.offsetHeight === 0) {
              console.warn('📍 LocationPicker: Container has no dimensions, retrying...', {
                width: mapContainer.current.offsetWidth,
                height: mapContainer.current.offsetHeight
              });
              // Use requestAnimationFrame for retry instead of setTimeout
              requestAnimationFrame(checkAndInit);
              return;
            }

        // Container is ready, proceed with initialization
        console.log('📍 LocationPicker: Creating map instance...', {
          center: initialCenter,
          zoom: initialZoom,
          container: mapContainer.current,
          containerSize: {
            width: mapContainer.current.offsetWidth,
            height: mapContainer.current.offsetHeight
          }
        });

        try {
          // Mark that map is being initialized to prevent sync effect from running
          isMapJustInitializedRef.current = true;
          
          map.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/light-v11',
            center: initialCenter,
            zoom: initialZoom,
            attributionControl: false,
            interactive: true,
            dragPan: true,
            scrollZoom: true,
            boxZoom: true,
            doubleClickZoom: true,
            // Performance optimizations
            antialias: false, // Disable antialiasing for better performance
            preserveDrawingBuffer: false, // Don't preserve drawing buffer unless needed
            fadeDuration: 0 // Disable fade animations for faster rendering
          });

          console.log('✅ LocationPicker: Map instance created', {
            center: initialCenter,
            zoom: initialZoom,
            interactive: map.current.getStyle() ? 'ready' : 'loading',
            hasContainer: !!mapContainer.current
          });

          // Store handlers for cleanup
          const handleMapLoad = () => {
            if (!map.current) return;

            console.log('✅ LocationPicker: Map loaded successfully');
            
            // Map is now loaded and initialized, allow sync effect to run after a delay
            // Keep the flag true longer to prevent any sync during initial render
            // The map is already at the correct position from constructor, so no sync needed
            setTimeout(() => {
              isMapJustInitializedRef.current = false;
              isLoadingFromStorageRef.current = false; // Clear loading flag after map is stable
              isInitialMapLoadRef.current = false; // Allow zoom/position updates after map is fully stable
              console.log('📍 LocationPicker: Map initialization complete, sync effect can now run');
            }, 2000); // 2 second delay to ensure map is fully stable and no sync happens on initial load

            // Resize map using requestAnimationFrame for smoother rendering
            requestAnimationFrame(() => {
              if (map.current) {
                map.current.resize();
              }
            });

            // Don't add marker - using dotted border frame instead
            // marker.current = new mapboxgl.Marker({ color: '#3b82f6' })
            //   .setLngLat(initial.center)
            //   .addTo(map.current);

            console.log('✅ LocationPicker: Map loaded (no marker - using dotted border frame)');

            // Hide Mapbox branding
            requestAnimationFrame(() => {
              if (map.current) {
                const container = map.current.getContainer();
                const attrib = container.querySelector('.mapboxgl-ctrl-attrib');
                const logo = container.querySelector('.mapboxgl-ctrl-logo');
                if (attrib) (attrib as HTMLElement).style.display = 'none';
                if (logo) (logo as HTMLElement).style.display = 'none';
              }
            });
          };

          const handleMapClick = (e: mapboxgl.MapMouseEvent) => {
            if (!map.current) return;
            
            const { lng, lat } = e.lngLat;
            const coords: [number, number] = [lng, lat];
            
            // Get the current zoom level from the map to match what the user sees
            const currentZoom = map.current.getZoom();
            
            // Mark this as user interaction to prevent sync effect from running
            isUserInteractionRef.current = true;
            // Mark zoom as user-selected so reverse geocoding doesn't overwrite it
            isZoomUserSelectedRef.current = true;
            setSelectedCoordinates(coords);
            setSelectedZoom(currentZoom);
            
            // Reset flags after state update
            setTimeout(() => {
              isUserInteractionRef.current = false;
            }, 100);
            
            // Reverse geocode to get location name (but it won't overwrite user-selected zoom)
            reverseGeocode(lng, lat);
            
            // Don't update marker - using dotted border frame instead
            // if (marker.current) {
            //   marker.current.setLngLat(coords);
            // }
          };

          // Handle map drag - update coordinates when user drags the map
          const handleMapMove = () => {
            if (!map.current) return;
            const center = map.current.getCenter();
            const newCoordinates: [number, number] = [center.lng, center.lat];
            setSelectedCoordinates(newCoordinates);
          };

          const handleMapMoveEnd = () => {
            if (!map.current) return;
            const center = map.current.getCenter();
            const currentZoom = map.current.getZoom();
            const newCoordinates: [number, number] = [center.lng, center.lat];
            
            console.log('📍 LocationPicker: Modal map drag ended, updating location', {
              coordinates: newCoordinates,
              zoom: currentZoom
            });
            
            // Mark zoom as user-selected
            isZoomUserSelectedRef.current = true;
            setSelectedZoom(currentZoom);
            setSelectedCoordinates(newCoordinates);
            // Reverse geocode to update location name
            reverseGeocode(center.lng, center.lat);
          };

          const handleMapError = (e: any) => {
            console.error('❌ Map error:', e);
          };

          const handleStyleLoad = () => {
            if (map.current) {
              console.log('✅ LocationPicker: Map style loaded');
              // Use requestAnimationFrame for smoother resize
              requestAnimationFrame(() => {
                if (map.current) {
                  map.current.resize();
                }
              });
            }
          };

          map.current.on('load', handleMapLoad);
          map.current.on('click', handleMapClick);
          map.current.on('move', handleMapMove);
          map.current.on('moveend', handleMapMoveEnd);
          map.current.on('error', handleMapError);
          map.current.on('style.load', handleStyleLoad);
        } catch (error) {
          console.error('❌ LocationPicker: Failed to create map:', error);
        }
          };

          checkAndInit();
        });
      });
    };

    // Wait for dialog animation to complete, then initialize
    // Use a shorter delay since we're using requestAnimationFrame for better timing
    const initTimeout = setTimeout(initMap, 150);

    return () => {
      clearTimeout(initTimeout);
      if (map.current) {
        // Remove map (this automatically removes all listeners)
        map.current.remove();
        map.current = null;
      }
      if (marker.current) {
        marker.current.remove();
        marker.current = null;
      }
    };
  }, [isOpen, mapboxToken, selectedCoordinates, selectedZoom, isLocationDataReady]);

  // Sync map with selected coordinates whenever they change
  // But skip sync if the change came from user interaction (map click), if map was just initialized, or if loading from storage
  React.useEffect(() => {
    if (!map.current || !isOpen) return;
    
    // Skip sync if loading from localStorage (prevents sync during initial load)
    if (isLoadingFromStorageRef.current) {
      console.log('📍 LocationPicker: Skipping sync - loading from localStorage');
      return;
    }
    
    // Skip sync if map was just initialized (prevents glitching between locations)
    if (isMapJustInitializedRef.current) {
      console.log('📍 LocationPicker: Skipping sync - map was just initialized');
      return;
    }
    
    // Skip sync during initial map load - map is already at correct position
    if (isInitialMapLoadRef.current) {
      console.log('📍 LocationPicker: Skipping sync - initial map load');
      return;
    }
    
    // Skip sync if this coordinate change came from user interaction
    if (isUserInteractionRef.current) {
      console.log('📍 LocationPicker: Skipping sync - coordinate change from user interaction');
      return;
    }
    
    // Don't sync if map is not loaded yet
    if (!map.current.loaded()) {
      // Wait for map to load before syncing
      const handleLoad = () => {
        if (map.current && map.current.loaded() && !isUserInteractionRef.current && !isMapJustInitializedRef.current && !isLoadingFromStorageRef.current) {
          syncMap();
        }
      };
      map.current.once('load', handleLoad);
      return () => {
        if (map.current) {
          map.current.off('load', handleLoad);
        }
      };
    }

    const syncMap = () => {
      if (!map.current || !map.current.loaded()) return;
      
      // Double-check we're not in a user interaction, just initialized, loading from storage, or initial load
      if (isUserInteractionRef.current || isMapJustInitializedRef.current || isLoadingFromStorageRef.current || isInitialMapLoadRef.current) {
        return;
      }

      try {
        // Check if map is already at the target location to avoid unnecessary movement
        const currentCenter = map.current.getCenter();
        const currentZoom = map.current.getZoom();
        const targetLng = selectedCoordinates[0];
        const targetLat = selectedCoordinates[1];
        const targetZoom = selectedZoom || 9.5;
        
        const distance = Math.sqrt(
          Math.pow(currentCenter.lng - targetLng, 2) + 
          Math.pow(currentCenter.lat - targetLat, 2)
        );
        const zoomDiff = Math.abs(currentZoom - targetZoom);
        
        // Only move if the location or zoom is significantly different
        if (distance > 0.001 || zoomDiff > 0.5) {
          // Use jumpTo instead of flyTo to avoid animation - instant positioning
          map.current.jumpTo({
            center: selectedCoordinates,
            zoom: targetZoom
          });
          console.log('✅ LocationPicker: Map synced with coordinates (instant)');
        } else {
          console.log('📍 LocationPicker: Map already at target location, skipping sync');
        }

        // Don't add marker - using dotted border frame instead
        // if (marker.current) {
        //   marker.current.setLngLat(selectedCoordinates);
        // } else {
        //   marker.current = new mapboxgl.Marker({ color: '#3b82f6' })
        //     .setLngLat(selectedCoordinates)
        //     .addTo(map.current);
        // }
      } catch (error) {
        console.error('❌ LocationPicker: Error syncing map:', error);
        // Retry after a delay only if not user interaction
        if (!isUserInteractionRef.current) {
          setTimeout(syncMap, 500);
        }
      }
    };

    syncMap();
  }, [selectedCoordinates, selectedZoom, isOpen]);

  const geocodeLocation = React.useCallback(async (query: string) => {
    if (!query) {
      console.log('📍 Geocode: Empty query');
      return;
    }

    console.log('📍 Geocode: Starting geocoding for:', query);
    setIsGeocoding(true);
    setGeocodeError('');

    try {
      if (!mapboxToken) {
        console.error('❌ Geocode: Mapbox token is missing!');
        setGeocodeError('Mapbox token is not configured');
        setIsGeocoding(false);
        return;
      }

      // For postcodes, try without type restrictions first, then fallback to specific types
      // Remove type restrictions to allow all location types including postcodes
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxToken}&limit=1`;
      console.log('📍 Geocode: Fetching from:', url.replace(mapboxToken, 'TOKEN_HIDDEN'));
      
      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Geocoding API error:', response.status, response.statusText, errorText);
        setGeocodeError(`Geocoding failed: ${response.status} ${response.statusText}`);
        setIsGeocoding(false);
        return;
      }

      const data = await response.json();

      console.log('📍 Geocode: Response received', {
        hasFeatures: !!(data.features && data.features.length > 0),
        featureCount: data.features?.length || 0,
        features: data.features
      });

      if (data.features && data.features.length > 0) {
        const feature = data.features[0];
        const [lng, lat] = feature.center;
        const coords: [number, number] = [lng, lat];
        const locationName = feature.place_name;
        
        console.log('✅ Geocode: Location found', {
          name: locationName,
          coordinates: coords,
          placeType: feature.place_type
        });
        
        // Calculate dynamic zoom based on area size
        const calculatedZoom = calculateZoomFromBbox(feature.bbox, feature.place_type);

        setSelectedCoordinates(coords);
        setSelectedLocationName(locationName);
        setSelectedZoom(calculatedZoom);

        // Update map when it's ready - with aggressive retry logic
        let retryCount = 0;
        const maxRetries = 10;
        
        const updateMap = () => {
          if (map.current) {
            // Ensure map is resized
            map.current.resize();
            
            try {
              if (map.current.loaded()) {
                // Map is loaded, update it
                map.current.flyTo({
                  center: coords,
                  zoom: calculatedZoom,
                  duration: 600
                });

                // Don't add marker - using dotted border frame instead
                // if (marker.current) {
                //   marker.current.setLngLat(coords);
                // } else {
                //   marker.current = new mapboxgl.Marker({ color: '#3b82f6' })
                //     .setLngLat(coords)
                //     .addTo(map.current);
                // }
                
                console.log('✅ Geocode: Map updated successfully');
              } else {
                // Map not loaded yet, wait for it
                console.log('📍 Geocode: Map not loaded, waiting for load event...');
                map.current.once('load', () => {
                  if (map.current) {
                    map.current.flyTo({
                      center: coords,
                      zoom: calculatedZoom,
                      duration: 600
                    });
                    // Don't add marker - using dotted border frame instead
                    // if (marker.current) {
                    //   marker.current.setLngLat(coords);
                    // } else {
                    //   marker.current = new mapboxgl.Marker({ color: '#3b82f6' })
                    //     .setLngLat(coords)
                    //     .addTo(map.current);
                    // }
                    console.log('✅ Geocode: Map updated after load event');
                  }
                });
              }
            } catch (error) {
              console.error('❌ Geocode: Error updating map:', error);
              // Retry if we haven't exceeded max retries
              if (retryCount < maxRetries) {
                retryCount++;
                setTimeout(updateMap, 300);
              }
            }
          } else {
            // Map not initialized yet, retry with exponential backoff
            if (retryCount < maxRetries) {
              retryCount++;
              const delay = Math.min(300 * retryCount, 2000); // Max 2 seconds
              console.log(`📍 Geocode: Map not ready (attempt ${retryCount}/${maxRetries}), retrying in ${delay}ms...`);
              setTimeout(updateMap, delay);
            } else {
              console.error('❌ Geocode: Map not available after max retries');
            }
          }
        };

        // Start the update process
        updateMap();
      } else {
        setGeocodeError('Location not found. Try a different search term.');
        console.log('❌ No features found for query:', query);
      }
    } catch (error: any) {
      console.error('❌ Geocoding error:', error);
      setGeocodeError(`Failed to find location: ${error.message || 'Network error'}`);
    } finally {
      setIsGeocoding(false);
    }
  }, [mapboxToken]);

  // Real-time geocoding as user types (very short debounce for immediate feedback)
  React.useEffect(() => {
    if (!isOpen || !locationInput.trim()) return;

    // Clear previous timeout
    if (geocodeTimeoutRef.current) {
      clearTimeout(geocodeTimeoutRef.current);
    }

    // Longer debounce (700ms) - prevents excessive map jumping while typing
    geocodeTimeoutRef.current = setTimeout(() => {
      geocodeLocation(locationInput.trim());
    }, 700);

    return () => {
      if (geocodeTimeoutRef.current) {
        clearTimeout(geocodeTimeoutRef.current);
      }
    };
  }, [locationInput, isOpen, geocodeLocation]);

  const reverseGeocode = async (lng: number, lat: number) => {
    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${mapboxToken}&limit=1`
      );

      if (response.ok) {
        const data = await response.json();
        if (data.features && data.features.length > 0) {
          const feature = data.features[0];
          const calculatedZoom = calculateZoomFromBbox(feature.bbox, feature.place_type);
          setSelectedLocationName(feature.place_name);
          setLocationInput(feature.place_name);
          
          // Don't update zoom during initial map load - map is already at correct position
          if (isInitialMapLoadRef.current) {
            console.log('📍 LocationPicker: Skipping zoom update during initial map load');
            return;
          }
          
          // Only update zoom if it wasn't explicitly set by user, or if the calculated zoom is significantly different
          // This prevents overwriting user's intended zoom level
          if (!isZoomUserSelectedRef.current) {
            setSelectedZoom(calculatedZoom);
            console.log('📍 LocationPicker: Reverse geocode updated zoom (not user-selected)', calculatedZoom);
          } else {
            const currentZoom = selectedZoom;
            const zoomDiff = Math.abs(currentZoom - calculatedZoom);
            // Only update if calculated zoom is significantly different (more than 2 levels)
            if (zoomDiff > 2) {
              setSelectedZoom(calculatedZoom);
              console.log('📍 LocationPicker: Reverse geocode updated zoom (significant difference)', {
                old: currentZoom,
                new: calculatedZoom,
                diff: zoomDiff
              });
            } else {
              console.log('📍 LocationPicker: Reverse geocode kept user-selected zoom', currentZoom);
            }
          }
        }
      }
    } catch (error) {
      console.error('Reverse geocoding failed:', error);
    }
  };

  const handleConfirm = () => {
    // IMPORTANT: Get coordinates BEFORE closing modal (which cleans up preview map)
    // Get the latest coordinates directly from the preview map if it exists (most accurate)
    // Otherwise fall back to state
    let finalCoordinates: [number, number];
    let finalZoom: number;

    // Capture coordinates from the map that's currently visible
    // Priority: preview map (if in preview mode) > modal map > state
    if (isPreviewMode && previewMap.current) {
      // Get the absolute latest position from the preview map
      const center = previewMap.current.getCenter();
      finalCoordinates = [center.lng, center.lat];
      finalZoom = previewMap.current.getZoom();
      console.log('📍 LocationPicker: Getting coordinates directly from preview map', {
        coordinates: finalCoordinates,
        zoom: finalZoom,
        isPreviewMode,
        hasPreviewMap: !!previewMap.current
      });
    } else if (map.current) {
      // Get coordinates from the modal map (the one in the dialog)
      const center = map.current.getCenter();
      finalCoordinates = [center.lng, center.lat];
      finalZoom = map.current.getZoom();
      console.log('📍 LocationPicker: Getting coordinates directly from modal map', {
        coordinates: finalCoordinates,
        zoom: finalZoom,
        isPreviewMode,
        hasModalMap: !!map.current
      });
    } else if (selectedCoordinates) {
      // Fallback to state if preview map doesn't exist
      finalCoordinates = selectedCoordinates;
      finalZoom = selectedZoom || 9.5;
      console.log('📍 LocationPicker: Using coordinates from state (preview map not available)', {
        coordinates: finalCoordinates,
        zoom: finalZoom,
        isPreviewMode,
        hasPreviewMap: !!previewMap.current,
        hasSelectedCoordinates: !!selectedCoordinates
      });
    } else {
      console.error('❌ LocationPicker: Cannot confirm - no coordinates available', {
        isPreviewMode,
        hasPreviewMap: !!previewMap.current,
        hasSelectedCoordinates: !!selectedCoordinates
      });
      return;
    }

    const finalName = selectedLocationName || locationInput || 'Unknown Location';

    // Save exactly what the user selected (including any drag adjustments)
    const locationData = {
      name: finalName,
      coordinates: finalCoordinates,
      zoom: finalZoom
    };

    console.log('📍 LocationPicker: Confirming and saving location', {
      coordinates: finalCoordinates,
      zoom: finalZoom,
      name: finalName,
      locationData
    });

    // Save and dispatch event BEFORE closing modal
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(DEFAULT_MAP_LOCATION_KEY, JSON.stringify(locationData));
        console.log('✅ LocationPicker: Location saved to localStorage', locationData);
        
        // Dispatch custom event to notify map component of location change
        // Use a small delay to ensure event listeners are ready
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('defaultMapLocationChanged', {
            detail: locationData
          }));
          console.log('✅ LocationPicker: Event dispatched to notify map component', locationData);
        }, 50);
      } catch (error) {
        console.error('❌ LocationPicker: Error saving location', error);
        return;
      }
    }

    // Close modal AFTER saving (this will clean up preview map)
    setIsOpen(false);
    setIsPreviewMode(false);
    onLocationSaved();
  };

  // Initialize preview mode map
  React.useEffect(() => {
    if (!isPreviewMode || !previewMapContainer.current || !selectedCoordinates) return;

    mapboxgl.accessToken = mapboxToken;

    previewMap.current = new mapboxgl.Map({
      container: previewMapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: selectedCoordinates,
      zoom: selectedZoom,
      attributionControl: false,
      interactive: true,
      dragPan: true,
      scrollZoom: true,
      boxZoom: true,
      doubleClickZoom: true
    });

    // Disable Mapbox "Ask" button that appears on touch devices
    const removeAskButton = () => {
      if (!previewMap.current) return;
      const container = previewMap.current.getContainer();
      if (container) {
        const askButton = container.querySelector('[data-testid="mapbox-gl-ask-button"]');
        if (askButton) {
          (askButton as HTMLElement).style.display = 'none';
          (askButton as HTMLElement).remove();
        }
        const controls = container.querySelectorAll('.mapboxgl-ctrl, button');
        controls.forEach((ctrl) => {
          const ctrlElement = ctrl as HTMLElement;
          if (ctrlElement.textContent?.includes('Ask') || 
              ctrlElement.getAttribute('data-testid')?.includes('ask') ||
              ctrlElement.getAttribute('aria-label')?.includes('Ask')) {
            ctrlElement.style.display = 'none';
            ctrlElement.remove();
          }
        });
      }
    };

    previewMap.current.on('load', removeAskButton);
    // Also check periodically and on touch events
    previewAskButtonCheckIntervalRef.current = setInterval(removeAskButton, 100);
    previewMap.current.on('touchstart', removeAskButton);
    previewMap.current.on('touchend', removeAskButton);

    // Update zoom and location when map moves - pin stays centered visually
    const handleMoveEnd = () => {
      if (previewMap.current) {
        isUpdatingFromDragRef.current = true;
        const currentZoom = previewMap.current.getZoom();
        // In preview mode, user is explicitly adjusting the view, so mark zoom as user-selected
        isZoomUserSelectedRef.current = true;
        const center = previewMap.current.getCenter();
        const newCoordinates: [number, number] = [center.lng, center.lat];
        
        console.log('📍 LocationPicker: Map drag ended, updating location', {
          coordinates: newCoordinates,
          zoom: currentZoom
        });
        
        setSelectedZoom(currentZoom);
        setSelectedCoordinates(newCoordinates);
        // Reverse geocode to update location name (won't overwrite user-selected zoom)
        reverseGeocode(center.lng, center.lat);
        // Reset flag after state updates complete (longer delay to prevent feedback loop)
        setTimeout(() => {
          isUpdatingFromDragRef.current = false;
        }, 200);
      }
    };

    // Don't update state on move - only on moveend to prevent glitchiness
    // The map will handle smooth dragging internally without state updates
    previewMap.current.on('moveend', handleMoveEnd);

    // Hide Mapbox branding
    const hideBranding = () => {
      if (previewMap.current) {
        const container = previewMap.current.getContainer();
        const attrib = container.querySelector('.mapboxgl-ctrl-attrib');
        const logo = container.querySelector('.mapboxgl-ctrl-logo');
        if (attrib) (attrib as HTMLElement).style.display = 'none';
        if (logo) (logo as HTMLElement).style.display = 'none';
      }
    };

    previewMap.current.on('load', hideBranding);
    setTimeout(hideBranding, 100);

    return () => {
      if (previewAskButtonCheckIntervalRef.current) {
        clearInterval(previewAskButtonCheckIntervalRef.current);
        previewAskButtonCheckIntervalRef.current = null;
      }
      if (previewMap.current) {
        previewMap.current.off('moveend', handleMoveEnd);
        previewMap.current.off('load', hideBranding);
        previewMap.current.off('touchstart', removeAskButton);
        previewMap.current.off('touchend', removeAskButton);
        previewMap.current.remove();
        previewMap.current = null;
      }
      if (previewMarker.current) {
        previewMarker.current.remove();
        previewMarker.current = null;
      }
    };
  }, [isPreviewMode, mapboxToken]); // Removed selectedCoordinates and selectedZoom to prevent recreation on drag

  // Update preview map center/zoom when coordinates change externally (not from dragging)
  React.useEffect(() => {
    if (!isPreviewMode || !previewMap.current || isUpdatingFromDragRef.current) return;
    
    // Only update if the map center is significantly different from selected coordinates
    const currentCenter = previewMap.current.getCenter();
    const coordDiff = Math.abs(currentCenter.lng - selectedCoordinates[0]) + Math.abs(currentCenter.lat - selectedCoordinates[1]);
    const zoomDiff = Math.abs(previewMap.current.getZoom() - selectedZoom);
    
    // Only update if there's a meaningful difference (prevents unnecessary updates)
    if (coordDiff > 0.0001 || zoomDiff > 0.1) {
      previewMap.current.jumpTo({
        center: selectedCoordinates,
        zoom: selectedZoom
      });
    }
  }, [isPreviewMode, selectedCoordinates, selectedZoom]);

  return (
    <>
      <motion.button
        onClick={() => {
          setIsOpen(true);
        }}
        className="w-full group relative bg-white border border-slate-200 rounded-none hover:border-slate-300 hover:shadow-sm transition-all duration-200 text-left"
        whileHover={{ scale: 1.001 }}
        whileTap={{ scale: 0.999 }}
      >
          <div className="flex items-start gap-3 px-5 py-4">
          {/* Minimal icon */}
          <div className="flex-shrink-0 pt-0.5">
            <MapPin className="w-5 h-5 text-slate-400 group-hover:text-slate-600 transition-colors" strokeWidth={1.5} />
          </div>
          
          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-slate-900 mb-1" style={{ fontSize: '13px' }}>
              Default Map Location
            </div>
            <div className="text-xs text-slate-500 mb-3">
              Choose where the map opens when you first view it
            </div>
            {savedLocation && (
              <div className="text-slate-600 font-normal" style={{ fontSize: '12px' }}>
                {savedLocation}
              </div>
            )}
          </div>
          
          {/* Subtle arrow */}
          <div className="flex-shrink-0 text-slate-300 group-hover:text-slate-400 transition-colors pt-0.5">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </motion.button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <style>{`
          [data-radix-dialog-overlay] {
            background-color: rgba(0, 0, 0, 0.2) !important;
          }
          [data-radix-dialog-content] {
            will-change: transform;
          }
          .mapboxgl-canvas {
            will-change: transform;
            transform: translateZ(0);
            image-rendering: -webkit-optimize-contrast;
          }
        `}</style>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0" style={{ borderRadius: 0 }}>
          <DialogHeader className="px-4 pt-4 pb-3 border-b" style={{ borderColor: '#E9E9EB' }}>
            <DialogTitle style={{ fontSize: '14px', fontWeight: 500, color: '#415C85', letterSpacing: '-0.01em' }}>Set Default Map Location</DialogTitle>
          </DialogHeader>

          <div className="px-4 py-4 space-y-4">
            {/* Location Input */}
            <div className="space-y-1.5 relative">
              <label style={{ fontSize: '13px', fontWeight: 500, color: '#63748A', letterSpacing: '-0.01em' }}>Search Location</label>
              <div className="relative">
                <div
                  className="flex items-center"
                  id="location-search-container"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    backgroundColor: '#FCFCFC',
                    border: '1px solid #E9E9EB',
                    borderRadius: '2px',
                    transition: 'border-color 150ms ease',
                  }}
                >
                  <Search className="w-4 h-4 text-gray-400 flex-shrink-0" strokeWidth={2} style={{ marginRight: '12px' }} />
                  <input
                    type="text"
                    value={locationInput}
                    onChange={(e) => {
                      setLocationInput(e.target.value);
                      setGeocodeError('');
                      if (!isSelectingSuggestionRef.current) {
                        setShowSuggestions(true);
                      }
                    }}
                    onFocus={(e) => {
                      const container = e.currentTarget.closest('#location-search-container') as HTMLElement;
                      if (container) {
                        container.style.borderColor = '#415C85';
                        container.style.boxShadow = '0 0 0 2px rgba(65, 92, 133, 0.1)';
                      }
                      if (suggestions.length > 0) {
                        setShowSuggestions(true);
                      }
                    }}
                    onBlur={(e) => {
                      const container = e.currentTarget.closest('#location-search-container') as HTMLElement;
                      if (container) {
                        container.style.borderColor = '#E9E9EB';
                        container.style.boxShadow = 'none';
                      }
                      // Delay hiding suggestions to allow click events
                      setTimeout(() => {
                        setShowSuggestions(false);
                      }, 200);
                    }}
                    placeholder="Search for a location..."
                    style={{
                      flex: 1,
                      fontSize: '14px',
                      fontWeight: 400,
                      color: '#63748A',
                      backgroundColor: 'transparent',
                      border: 'none',
                      outline: 'none',
                      letterSpacing: '-0.01em',
                      lineHeight: '1.4'
                    }}
                  />
                  {isLoadingSuggestions && (
                    <div className="flex-shrink-0 ml-2">
                      <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                    </div>
                  )}
                  {locationInput && !isLoadingSuggestions && (
                    <button
                      onClick={() => {
                        if (locationInput.trim()) {
                          geocodeLocation(locationInput);
                        }
                      }}
                      disabled={isGeocoding}
                      className="flex-shrink-0 disabled:opacity-50 ml-2"
                      style={{
                        padding: '0',
                        backgroundColor: 'transparent',
                        color: '#63748A',
                        borderRadius: '16px',
                        width: '36px',
                        height: '32px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background-color 150ms ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#f5f5f5';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      {isGeocoding ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" strokeWidth={2} />}
                    </button>
                  )}
                </div>

                {/* Suggestions Dropdown */}
                {showSuggestions && suggestions.length > 0 && (
                  <div 
                    className="absolute z-50"
                    style={{
                      top: '100%',
                      left: 0,
                      right: 0,
                      width: '100%',
                      background: '#FCFCFC',
                      border: '1px solid #E9E9EB',
                      borderTop: 'none',
                      borderRadius: '0 0 2px 2px',
                      boxShadow: 'none',
                      maxHeight: '400px',
                      overflowY: 'auto',
                      marginTop: '1px',
                    }}
                  >
                    {suggestions.map((suggestion, index) => (
                      <button
                        key={index}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleSuggestionSelect(suggestion);
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleSuggestionSelect(suggestion);
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
                        style={{
                          fontSize: '14px',
                          color: '#63748A',
                          lineHeight: '1.4',
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
                          <span>{suggestion.place_name}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {isGeocoding && (
                <p style={{ fontSize: '12px', color: '#6C7180', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
                  <span style={{ display: 'inline-block', width: '4px', height: '4px', backgroundColor: '#6C7180', borderRadius: '50%', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  Searching...
                </p>
              )}
              {geocodeError && (
                <p style={{ fontSize: '12px', color: '#DC2626', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
                  <span style={{ display: 'inline-block', width: '4px', height: '4px', backgroundColor: '#DC2626', borderRadius: '50%' }} />
                  {geocodeError}
                </p>
              )}
            </div>

            {/* Map Preview */}
            <div className="space-y-1.5">
              <label style={{ fontSize: '13px', fontWeight: 500, color: '#63748A', letterSpacing: '-0.01em' }}>Map Preview</label>
              <div 
                className="w-full h-96 overflow-hidden relative"
                style={{ 
                  minHeight: '384px', 
                  width: '100%',
                  border: '1px solid #E9E9EB',
                  borderRadius: '2px',
                  backgroundColor: '#F9F9F9'
                }}
              >
                {/* Map Container */}
                <div 
                  ref={mapContainer}
                  className="w-full h-full"
                  style={{ 
                    position: 'relative', 
                    zIndex: 1, 
                    pointerEvents: 'auto',
                    willChange: 'transform',
                    transform: 'translateZ(0)', // Force GPU acceleration
                    backfaceVisibility: 'hidden' // Optimize rendering
                  }}
                />
              </div>
            </div>

          </div>

          <DialogFooter style={{ padding: '12px 16px', borderTop: '1px solid #E9E9EB', backgroundColor: '#F9F9F9' }}>
            <div className="flex items-center justify-between w-full">
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  padding: '8px 12px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: '#63748A',
                  backgroundColor: '#F3F4F6',
                  border: '1px solid #E9E9EB',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  transition: 'background-color 150ms ease',
                  letterSpacing: '-0.01em'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#F0F6FF';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#F3F4F6';
                }}
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setIsOpen(false);
                    // Store sidebar state before closing
                    if (getSidebarState) {
                      sidebarStateBeforePreviewRef.current = getSidebarState();
                    }
                    // Close sidebar when entering preview mode
                    onCloseSidebar?.();
                    setIsPreviewMode(true);
                  }}
                  style={{
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontWeight: 500,
                    color: '#63748A',
                    backgroundColor: '#F3F4F6',
                    border: '1px solid #E9E9EB',
                    borderRadius: '2px',
                    cursor: 'pointer',
                    transition: 'background-color 150ms ease',
                    letterSpacing: '-0.01em'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#F0F6FF';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#F3F4F6';
                  }}
                >
                  Adjust Zoom & Preview
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={!selectedCoordinates}
                  style={{
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontWeight: 500,
                    color: '#FFFFFF',
                    backgroundColor: !selectedCoordinates ? '#F3F4F6' : '#415C85',
                    border: '1px solid #E9E9EB',
                    borderRadius: '2px',
                    cursor: !selectedCoordinates ? 'not-allowed' : 'pointer',
                    transition: 'background-color 150ms ease',
                    letterSpacing: '-0.01em',
                    minWidth: '140px',
                    opacity: !selectedCoordinates ? 0.5 : 1
                  }}
                  onMouseEnter={(e) => {
                    if (selectedCoordinates) {
                      e.currentTarget.style.backgroundColor = '#3A4F73';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedCoordinates) {
                      e.currentTarget.style.backgroundColor = '#415C85';
                    }
                  }}
                >
                  Confirm Location
                </button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Mode - Full Screen Map View */}
      <AnimatePresence>
        {isPreviewMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999]"
            style={{
              backgroundColor: '#F1F1F1', // Match main background color
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: '100vw',
              height: '100vh'
            }}
          >
            {/* Preview Mode Label */}
            <div className="absolute top-6 left-1/2 transform -translate-x-1/2 z-[10003] pointer-events-none">
              <div style={{
                backgroundColor: '#415C85',
                color: '#FFFFFF',
                padding: '6px 12px',
                borderRadius: '2px',
                fontSize: '11px',
                fontWeight: 500,
                letterSpacing: '-0.01em',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}>
                Preview Mode
              </div>
            </div>

            {/* Full Screen Map - positioned to cover top white area */}
            <div 
              ref={previewMapContainer}
              className="fixed inset-0"
              style={{
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: '100vw',
                height: '100vh',
                zIndex: 0
              }}
            />
            


            {/* Buttons - Positioned at bottom right */}
            <div 
              className="absolute z-[10001] flex gap-2"
              style={{
                bottom: '24px',
                right: '24px'
              }}
            >
              <button
                onClick={() => {
                  setIsPreviewMode(false);
                  // Restore sidebar state
                  if (onRestoreSidebarState && sidebarStateBeforePreviewRef.current !== null) {
                    onRestoreSidebarState(sidebarStateBeforePreviewRef.current);
                    sidebarStateBeforePreviewRef.current = null;
                  }
                }}
                style={{
                  padding: '8px 12px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: '#63748A',
                  backgroundColor: '#F3F4F6',
                  border: '1px solid #E9E9EB',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  transition: 'background-color 150ms ease',
                  letterSpacing: '-0.01em'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#F0F6FF';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#F3F4F6';
                }}
              >
                Back
              </button>
              <button
                onClick={() => {
                  handleConfirm();
                  // Restore sidebar state after confirming
                  if (onRestoreSidebarState && sidebarStateBeforePreviewRef.current !== null) {
                    onRestoreSidebarState(sidebarStateBeforePreviewRef.current);
                    sidebarStateBeforePreviewRef.current = null;
                  }
                }}
                style={{
                  padding: '8px 12px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: '#FFFFFF',
                  backgroundColor: '#415C85',
                  border: '1px solid #E9E9EB',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  transition: 'background-color 150ms ease',
                  letterSpacing: '-0.01em',
                  minWidth: '140px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#3A4F73';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#415C85';
                }}
              >
                Confirm Location
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

// Background Settings Component
const BackgroundSettings: React.FC = () => {
  const BACKGROUNDS = [
    { id: 'default-background', name: 'Default Background', image: '/Default Background.png' },
    { id: 'background1', name: 'Background 1', image: '/background1.png' },
    { id: 'background2', name: 'Background 2', image: '/background2.png' },
    { id: 'background3', name: 'Background 3', image: '/Background3.png' },
    { id: 'background4', name: 'Background 4', image: '/Background4.png' },
    { id: 'background5', name: 'Background 5', image: '/Background5.png' },
    { id: 'background6', name: 'Background 6', image: '/Background6.png' },
    { id: 'velora-grass', name: 'Velora Grass', image: '/VeloraGrassBackground.png' },
  ];

  const [selectedBackground, setSelectedBackground] = React.useState<string>('default-background');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Load saved background on mount - check for custom uploaded background first
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      // Check for custom uploaded background (stored as data URL)
      const customBg = localStorage.getItem('customUploadedBackground');
      if (customBg && customBg.startsWith('data:image')) {
        setSelectedBackground(customBg);
      } else {
        const saved = localStorage.getItem('dashboardBackground');
        if (saved) {
          setSelectedBackground(saved);
        } else {
          // Set default background if nothing is saved
          setSelectedBackground('default-background');
          localStorage.setItem('dashboardBackground', 'default-background');
        }
      }
    }
  }, []);

  const handleBackgroundSelect = (backgroundId: string) => {
    setSelectedBackground(backgroundId);
    if (typeof window !== 'undefined') {
      localStorage.setItem('dashboardBackground', backgroundId);
      // Clear custom uploaded background if selecting a preset
      if (!backgroundId.startsWith('data:image')) {
        localStorage.removeItem('customUploadedBackground');
      }
      // Trigger a custom event to notify DashboardLayout to update
      window.dispatchEvent(new CustomEvent('backgroundChanged', { detail: { backgroundId } }));
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const imageDataUrl = e.target?.result as string;
      // Store as custom uploaded background
      if (typeof window !== 'undefined') {
        localStorage.setItem('customUploadedBackground', imageDataUrl);
        // Set it as the current background immediately
        handleBackgroundSelect(imageDataUrl);
      }
    };
    reader.readAsDataURL(file);
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[15px] font-medium text-gray-900">Background</h3>
        <p className="text-[13px] text-gray-500 mt-1.5 font-normal">
          Choose your dashboard background.
        </p>
      </div>

      {/* Background Preview Cards - Similar to reference image but with white theme */}
      <div className="grid grid-cols-3 gap-4">
        {BACKGROUNDS.map((background) => {
          const isSelected = selectedBackground === background.id;
          return (
            <motion.button
              key={background.id}
              onClick={() => handleBackgroundSelect(background.id)}
              className={`relative rounded-none overflow-hidden border-2 transition-all ${
                isSelected
                  ? 'border-slate-900 shadow-lg ring-2 ring-slate-900 ring-offset-2'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
              style={{
                aspectRatio: '16/9',
                background: 'white',
              }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {/* Background Preview */}
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: `url(${background.image})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                }}
              />
              {/* Overlay for selected state - subtle white overlay */}
              {isSelected && (
                <div className="absolute inset-0 bg-white/5 border-2 border-slate-900 rounded-none" />
              )}
              {/* Checkmark indicator - white circle with checkmark */}
              {isSelected && (
                <div className="absolute top-2 right-2 w-6 h-6 bg-white rounded-full flex items-center justify-center shadow-md border border-slate-200">
                  <Check className="w-4 h-4 text-slate-900" strokeWidth={2.5} />
                </div>
              )}
            </motion.button>
          );
        })}
        {/* Add Background Button */}
        <motion.button
          onClick={() => fileInputRef.current?.click()}
          className="relative rounded-none overflow-hidden border-2 border-slate-200 hover:border-slate-300 transition-all flex items-center justify-center"
          style={{
            aspectRatio: '16/9',
            background: 'white',
          }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Plus className="w-8 h-8 text-slate-400" />
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
          />
        </motion.button>
      </div>
    </div>
  );
};

// Settings View Component with Sidebar Navigation
const SettingsView: React.FC<{ 
  onCloseSidebar?: () => void;
  onRestoreSidebarState?: (shouldBeCollapsed: boolean) => void;
  getSidebarState?: () => boolean;
}> = ({ onCloseSidebar, onRestoreSidebarState, getSidebarState }) => {
  const [activeCategory, setActiveCategory] = React.useState<string>('background');
  const [savedLocation, setSavedLocation] = React.useState<string>('');

  // Load saved location on mount
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(DEFAULT_MAP_LOCATION_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setSavedLocation(parsed.name || '');
        } catch {
          localStorage.removeItem(DEFAULT_MAP_LOCATION_KEY);
        }
      }
    }
  }, []);

  const handleLocationSaved = () => {
    // Reload saved location
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(DEFAULT_MAP_LOCATION_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setSavedLocation(parsed.name || '');
        } catch {}
      }
    }
  };

  const settingsCategories = [
    { id: 'background', label: 'Background', icon: Contrast },
    { id: 'map-settings', label: 'Map Settings', icon: Map },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'privacy', label: 'Privacy', icon: Shield },
    { id: 'language', label: 'Language & Region', icon: Globe },
    { id: 'display', label: 'Display', icon: Fullscreen },
  ];

  const renderSettingsContent = () => {
    switch (activeCategory) {
      case 'map-settings':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-[15px] font-medium text-gray-900">Map Settings</h3>
              <p className="text-[13px] text-gray-500 mt-1.5 font-normal">
                Configure your map preferences and default settings.
              </p>
            </div>
            
            <LocationPickerModal 
              savedLocation={savedLocation}
              onLocationSaved={handleLocationSaved}
              onCloseSidebar={onCloseSidebar}
              onRestoreSidebarState={onRestoreSidebarState}
              getSidebarState={getSidebarState}
            />
          </div>
        );
      case 'background':
        return <BackgroundSettings />;
      case 'database':
        // Database/Files section is now handled by FilingSidebar popout
        // Return empty div - the sidebar will be rendered globally
        return <div />;
      case 'privacy':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-[15px] font-medium text-gray-900">Privacy</h3>
              <p className="text-[13px] text-gray-500 mt-1.5 font-normal">
                Control your privacy and data settings.
              </p>
            </div>
            <div className="text-slate-500 text-sm">
              Privacy settings coming soon...
            </div>
          </div>
        );
      case 'language':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-[15px] font-medium text-gray-900">Language & Region</h3>
              <p className="text-[13px] text-gray-500 mt-1.5 font-normal">
                Set your language and regional preferences.
              </p>
            </div>
            <div className="text-slate-500 text-sm">
              Language settings coming soon...
            </div>
          </div>
        );
      case 'display':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-[15px] font-medium text-gray-900">Display</h3>
              <p className="text-[13px] text-gray-500 mt-1.5 font-normal">
                Adjust display and layout preferences.
              </p>
            </div>
            <div className="text-slate-500 text-sm">
              Display settings coming soon...
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-full h-full flex">
      {/* Settings Sidebar - Sleek Design */}
      <div className="w-64 border-r border-slate-100 bg-white/95 backdrop-blur-sm">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-[15px] font-medium text-gray-900">Settings</h2>
          <p className="text-[13px] text-gray-500 mt-1.5 font-normal">Manage your preferences</p>
        </div>
        <nav className="px-3 py-3 space-y-0.5">
          {settingsCategories.map((category) => {
            const Icon = category.icon;
            const isActive = activeCategory === category.id;
            return (
              <button
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                className={`w-full flex items-center gap-3 px-3 py-1.5 rounded transition-colors duration-75 group relative border ${
                  isActive 
                    ? 'bg-white text-gray-900 border-gray-300' 
                    : 'text-gray-600 hover:bg-white/60 hover:text-gray-900 border-transparent'
                }`}
                style={{
                  boxShadow: isActive ? '0 1px 2px rgba(0, 0, 0, 0.04)' : 'none',
                  transition: 'background-color 75ms, color 75ms, border-color 75ms',
                  boxSizing: 'border-box'
                }}
                aria-label={category.label}
              >
                <div className="relative">
                  <Icon
                    className="w-[18px] h-[18px] flex-shrink-0"
                    strokeWidth={1.75}
                  />
                </div>
                <span className="text-[13px] font-normal flex-1 text-left">
                  {category.label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Settings Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-8">
          <motion.div
            key={activeCategory}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
          >
            {renderSettingsContent()}
          </motion.div>
        </div>
      </div>
    </div>
  );
};

// Fullscreen Property View Component - manages its own chat width state for proper resize tracking
interface FullscreenPropertyViewProps {
  isVisible: boolean;
  property: any;
  isSidebarCollapsed?: boolean;
  isSidebarExpanded?: boolean;
  onClose: () => void;
  onMessagesUpdate?: (messages: any[]) => void;
  onNewChat?: () => void;
  onSidebarToggle?: () => void;
  onActiveChatChange?: (isActive: boolean) => void;
  onOpenChatHistory?: () => void;
}

const FullscreenPropertyView: React.FC<FullscreenPropertyViewProps> = ({
  isVisible,
  property,
  isSidebarCollapsed,
  isSidebarExpanded,
  onClose,
  onMessagesUpdate,
  onNewChat,
  onSidebarToggle,
  onActiveChatChange,
  onOpenChatHistory
}) => {
  // Track the dynamic chat panel width for proper resize behavior
  const [dynamicChatWidth, setDynamicChatWidth] = React.useState<number>(0);
  
  // Calculate sidebar width for positioning
  const TOGGLE_RAIL_WIDTH = 12;
  let fullscreenSidebarWidth = 0;
  if (isSidebarCollapsed) {
    fullscreenSidebarWidth = TOGGLE_RAIL_WIDTH;
  } else if (isSidebarExpanded) {
    fullscreenSidebarWidth = 320 + TOGGLE_RAIL_WIDTH;
  } else {
    fullscreenSidebarWidth = 224 + TOGGLE_RAIL_WIDTH;
  }
  
  // Calculate initial 50% width
  const initialChatWidth = React.useMemo(() => {
    const availableWidth = typeof window !== 'undefined' 
      ? window.innerWidth - fullscreenSidebarWidth 
      : 800;
    return availableWidth / 2;
  }, [fullscreenSidebarWidth]);
  
  // Use dynamic width if set, otherwise use initial 50%
  const effectiveChatWidth = dynamicChatWidth > 0 ? dynamicChatWidth : initialChatWidth;
  
  if (!isVisible || !property) return null;
  
  return (
    <>
      {/* Back button - positioned above everything */}
      <button
        onClick={onClose}
        className="fixed top-4 z-[10000] flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 transition-colors"
        style={{ left: fullscreenSidebarWidth + 16 }}
      >
        <ArrowLeft className="w-4 h-4 text-gray-600" strokeWidth={1.5} />
        <span className="text-sm text-gray-600">Back to Projects</span>
      </button>

      {/* Chat Panel - SideChatPanel handles its own positioning */}
      <SideChatPanel
        isVisible={true}
        query=""
        citationContext={null}
        isSidebarCollapsed={isSidebarCollapsed}
        sidebarWidth={fullscreenSidebarWidth}
        isFilingSidebarClosing={false}
        isSidebarCollapsing={false}
        restoreChatId={null}
        newAgentTrigger={0}
        isPropertyDetailsOpen={true}
        shouldExpand={true}
        isMapVisible={false}
        onQuerySubmit={(newQuery) => {
          console.log('Query from fullscreen property view:', newQuery);
        }}
        onMinimize={onClose}
        onMessagesUpdate={onMessagesUpdate}
        onMapToggle={onClose}
        onNewChat={onNewChat}
        onSidebarToggle={onSidebarToggle}
        onChatWidthChange={(width) => {
          // Update dynamic width when chat is resized
          setDynamicChatWidth(width);
        }}
        onActiveChatChange={onActiveChatChange}
        onOpenChatHistory={onOpenChatHistory}
      />

      {/* Property Details Panel - positioned after chat panel */}
      <PropertyDetailsPanel
        property={property}
        isVisible={true}
        onClose={onClose}
        isLargeCardMode={false}
        isInChatMode={true}
        chatPanelWidth={effectiveChatWidth}
        sidebarWidth={fullscreenSidebarWidth}
      />
    </>
  );
};

export interface MainContentProps {
  className?: string;
  currentView?: string;
  onChatModeChange?: (inChatMode: boolean, chatData?: any) => void;
  onChatHistoryCreate?: (chatData: any) => void;
  currentChatData?: {
    query: string;
    messages: any[];
    timestamp: Date;
    isFromHistory?: boolean;
  } | null;
  currentChatId?: string | null;
  isInChatMode?: boolean;
  resetTrigger?: number;
  onNavigate?: (view: string, options?: { showMap?: boolean }) => void;
  homeClicked?: boolean;
  onHomeResetComplete?: () => void;
  onCloseSidebar?: () => void;
  onRestoreSidebarState?: (shouldBeCollapsed: boolean) => void;
  getSidebarState?: () => boolean;
  isSidebarCollapsed?: boolean;
  isSidebarExpanded?: boolean;
  onSidebarToggle?: () => void;
  onMapVisibilityChange?: (isVisible: boolean) => void; // Callback to notify parent of map visibility changes
  onActiveChatChange?: (isActive: boolean) => void; // Callback when active chat state changes
  shouldRestoreActiveChat?: boolean; // Signal from sidebar to restore active chat
  shouldRestoreSelectedChat?: string | null; // Chat ID to restore immediately from agent sidebar
  onChatVisibilityChange?: (isVisible: boolean) => void; // Callback when chat panel visibility changes
  onOpenChatHistory?: () => void; // Callback to open chat history panel
  externalIsMapVisible?: boolean; // External control of map visibility (from parent)
  onNavigateToDashboard?: () => void; // Callback to navigate to dashboard (direct synchronous navigation)
  onNewChat?: (handler: () => void) => (() => void) | void; // Callback pattern: MainContent provides its handler, DashboardLayout returns its handler
}
export const MainContent = ({
  className,
  currentView = 'search',
  onChatModeChange,
  onChatHistoryCreate,
  currentChatData,
  currentChatId,
  isInChatMode: inChatMode = false,
  resetTrigger: parentResetTrigger,
  onNavigate,
  homeClicked = false,
  onHomeResetComplete,
  onCloseSidebar,
  onRestoreSidebarState,
  getSidebarState,
  isSidebarCollapsed = false,
  isSidebarExpanded = false,
  onSidebarToggle,
  onMapVisibilityChange,
  onActiveChatChange,
  shouldRestoreActiveChat = false,
  shouldRestoreSelectedChat = null,
  onChatVisibilityChange,
  onOpenChatHistory,
  externalIsMapVisible,
  onNavigateToDashboard,
  onNewChat: onNewChatFromParent
}: MainContentProps) => {
  const { addActivity } = useSystem();
  const { isOpen: isFilingSidebarOpen, width: filingSidebarWidth, isResizing: isFilingSidebarResizing, closeSidebar } = useFilingSidebar();
  const { isOpen: isChatHistoryPanelOpen, width: chatHistoryPanelWidth, isResizing: isChatHistoryPanelResizing, closePanel: closeChatPanel } = useChatPanel();
  const { getChatById } = useChatHistory();
  // Track previous states to detect closing transitions for instant updates
  const prevFilingSidebarOpenRef = React.useRef(isFilingSidebarOpen);
  const prevSidebarCollapsedRef = React.useRef(isSidebarCollapsed);
  const [isFilingSidebarClosing, setIsFilingSidebarClosing] = React.useState(false);
  const [isSidebarCollapsing, setIsSidebarCollapsing] = React.useState(false);
  
  // Track closing states for instant transition disable (no delays - update immediately)
  React.useEffect(() => {
    const wasOpen = prevFilingSidebarOpenRef.current;
    const isClosing = wasOpen && !isFilingSidebarOpen;
    setIsFilingSidebarClosing(isClosing);
    // Clear flag after one frame to allow transition disable during closing
    if (isClosing) {
      requestAnimationFrame(() => {
        setIsFilingSidebarClosing(false);
      });
    }
    prevFilingSidebarOpenRef.current = isFilingSidebarOpen;
  }, [isFilingSidebarOpen]);
  
  React.useEffect(() => {
    const wasExpanded = !prevSidebarCollapsedRef.current;
    const isCollapsing = wasExpanded && isSidebarCollapsed;
    setIsSidebarCollapsing(isCollapsing);
    // Clear flag after one frame to allow transition disable during collapsing
    if (isCollapsing) {
      requestAnimationFrame(() => {
        setIsSidebarCollapsing(false);
      });
    }
    prevSidebarCollapsedRef.current = isSidebarCollapsed;
  }, [isSidebarCollapsed]);
  const [chatQuery, setChatQuery] = React.useState<string>("");
  const [chatMessages, setChatMessages] = React.useState<any[]>([]);
  const [resetTrigger, setResetTrigger] = React.useState<number>(0);
  const [currentLocation, setCurrentLocation] = React.useState<string>("");
  // Internal map visibility for SearchBar Map button
  const [isMapVisibleFromSearchBar, setIsMapVisibleFromSearchBar] = React.useState<boolean>(false);
  // Track the previous view before entering map (for "back" button in SearchBar)
  const [previousViewBeforeMap, setPreviousViewBeforeMap] = React.useState<'dashboard' | 'chat'>('dashboard');
  // Final computed map visibility (will be computed from all sources)
  const [isMapVisible, setIsMapVisible] = React.useState<boolean>(false);
  // Ref to track map visibility synchronously for consistent render checks
  const isMapVisibleRef = React.useRef<boolean>(false);
  // Ref to track if we're explicitly hiding the map (prevents effect from overriding)
  const isExplicitlyHidingRef = React.useRef<boolean>(false);
  const [mapSearchQuery, setMapSearchQuery] = React.useState<string>("");
  const [hasPerformedSearch, setHasPerformedSearch] = React.useState<boolean>(false);
  
  // Keep ref in sync with state
  React.useEffect(() => {
    isMapVisibleRef.current = isMapVisible;
  }, [isMapVisible]);

  // Compute final map visibility from all sources
  React.useEffect(() => {
    // If we're explicitly hiding, don't override until externalIsMapVisible confirms
    if (isExplicitlyHidingRef.current && externalIsMapVisible === false) {
      // External state has confirmed the hide - clear the flag
      isExplicitlyHidingRef.current = false;
    }
    
    // Don't override if we're explicitly hiding and external hasn't confirmed yet
    if (isExplicitlyHidingRef.current && externalIsMapVisible !== false) {
      return;
    }
    
    const finalVisibility = (externalIsMapVisible ?? false) || isMapVisibleFromSearchBar;
    if (finalVisibility !== isMapVisible) {
      // Update ref immediately for synchronous access
      isMapVisibleRef.current = finalVisibility;
      setIsMapVisible(finalVisibility);
    }
  }, [externalIsMapVisible, isMapVisibleFromSearchBar, isMapVisible]);
  const [chatPanelWidth, setChatPanelWidth] = React.useState<number>(0); // Track chat panel width for property pin centering
  const [isPropertyDetailsOpen, setIsPropertyDetailsOpen] = React.useState<boolean>(false); // Track PropertyDetailsPanel visibility
  const [isChatBubbleVisible, setIsChatBubbleVisible] = React.useState<boolean>(false); // Track bubble visibility
  const [minimizedChatMessages, setMinimizedChatMessages] = React.useState<any[]>([]); // Store chat messages when minimized
  const [shouldExpandChat, setShouldExpandChat] = React.useState<boolean>(false); // Track if chat should be expanded (for Analyse mode)
  const [isQuickStartBarVisible, setIsQuickStartBarVisible] = React.useState<boolean>(false); // Track QuickStartBar visibility as island
  const [isRecentProjectsVisible, setIsRecentProjectsVisible] = React.useState<boolean>(false); // Track Recent Projects visibility
  // Fullscreen property view state (25/75 chat/property split from ProjectsPage)
  const [fullscreenPropertyView, setFullscreenPropertyView] = React.useState<boolean>(false);
  const [selectedPropertyFromProjects, setSelectedPropertyFromProjects] = React.useState<any>(null);
  const [hasActiveChat, setHasActiveChat] = React.useState<boolean>(false); // Track if there's an active chat query running
  
  // Browser Fullscreen API - shared state so all fullscreen buttons show "Exit" when active
  const { isBrowserFullscreen, toggleBrowserFullscreen } = useBrowserFullscreen();

  // Keyboard shortcut handler (Cmd/Ctrl + Shift + F) to toggle fullscreen
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + Shift + F to toggle fullscreen
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        const target = e.target as HTMLElement;
        
        // Check if we're in an editable element (input, textarea, or contenteditable)
        const isEditable = 
          target.tagName === 'INPUT' || 
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          (target.closest && target.closest('[contenteditable="true"]'));
        
        // Only prevent default if we're not in an editable element
        if (!isEditable) {
          e.preventDefault();
          e.stopPropagation();
          
          // Only toggle fullscreen when on dashboard view
          if ((currentView === 'search' || currentView === 'home') && !isMapVisible && !inChatMode) {
            toggleBrowserFullscreen();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [currentView, isMapVisible, inChatMode, toggleBrowserFullscreen]);
  
  // Track if we're transitioning from chat to disable animations
  const [isTransitioningFromChat, setIsTransitioningFromChat] = React.useState<boolean>(false);
  // Use a ref to track transition state synchronously (before React re-renders)
  const isTransitioningFromChatRef = React.useRef<boolean>(false);
  // Track if we're transitioning TO chat (to prevent dashboard flash)
  const isTransitioningToChatRef = React.useRef<boolean>(false);
  // Track when chat was opened to prevent premature closing
  const chatOpenedTimestampRef = React.useRef<number | null>(null);
  // Preserve chat state when navigating away so it can be restored when returning
  const preservedChatStateRef = React.useRef<{
    messages: any[];
    query: string;
    mapSearchQuery: string;
    hasPerformedSearch: boolean;
  } | null>(null);
  // Freeze layout state during transitions to prevent recalculation between renders
  const frozenLayoutStateRef = React.useRef<{
    shouldHideProjects: boolean;
    isVerySmall: boolean;
    isSidebarCollapsed: boolean;
    viewportSize: { width: number; height: number };
  } | null>(null);
  
  // Hide QuickStartBar when switching away from map view
  React.useEffect(() => {
    if (!isMapVisible && isQuickStartBarVisible) {
      setIsQuickStartBarVisible(false);
    }
  }, [isMapVisible, isQuickStartBarVisible]);
  
  // Store citation context for queries (hidden from user, passed to backend)
  const [citationContext, setCitationContext] = React.useState<any>(null);

  // PRE-BUILD: Listen for citation context preparation (when user clicks "Ask a question")
  // This prepares the context BEFORE the user types their query
  React.useEffect(() => {
    const handleCitationContextPrepare = (event: CustomEvent) => {
      const { citationContext: context } = event.detail;
      console.log('⚡ [CITATION] Pre-storing citation context (user clicked Ask):', context);
      setCitationContext(context);
    };
    
    // CLEANUP: Listen for citation context clear (when user backs out or closes without submitting)
    const handleCitationContextClear = () => {
      console.log('🧹 [CITATION] Clearing pre-stored citation context (user backed out)');
      setCitationContext(null);
    };
    
    window.addEventListener('citation-context-prepare', handleCitationContextPrepare as EventListener);
    window.addEventListener('citation-context-clear', handleCitationContextClear as EventListener);
    return () => {
      window.removeEventListener('citation-context-prepare', handleCitationContextPrepare as EventListener);
      window.removeEventListener('citation-context-clear', handleCitationContextClear as EventListener);
    };
  }, []);

  // Listen for citation query submissions
  React.useEffect(() => {
    const handleCitationQuerySubmit = (event: CustomEvent) => {
      const { query, citationContext: context, propertyId, documentIds } = event.detail;
      
      console.log('📝 [CITATION] Received citation query submit:', { 
        query, 
        citationContext: context, 
        propertyId, 
        documentIds 
      });
      
      // Use pre-stored context if available, otherwise use the one from the event
      // (context should already be set from citation-context-prepare event)
      if (!citationContext && context) {
        setCitationContext(context);
      }
      
      // Map visibility is controlled by external state or SearchBar toggle
      // The computed effect will ensure map is visible if needed
      setHasPerformedSearch(true);
      
      // If property details is open, expand chat
      if (isPropertyDetailsOpen) {
        setShouldExpandChat(true);
      }
      
      // Set the query - SideChatPanel will auto-submit it
      setMapSearchQuery(query);
      
      // Clear citation context after a short delay (once the query has been submitted)
      // This ensures subsequent manual queries don't reuse the citation context
      setTimeout(() => {
        setCitationContext(null);
      }, 2000); // 2 second delay - enough time for query to be submitted
    };
    
    window.addEventListener('citation-query-submit', handleCitationQuerySubmit as EventListener);
    return () => window.removeEventListener('citation-query-submit', handleCitationQuerySubmit as EventListener);
  }, [isMapVisible, isPropertyDetailsOpen, citationContext]);

  // Clear citation context when chat is closed or new chat starts
  React.useEffect(() => {
    if (!hasPerformedSearch) {
      setCitationContext(null);
    }
  }, [hasPerformedSearch]);
  
  // Track when chat closes to disable animations
  const prevHasPerformedSearchRef = React.useRef<boolean>(hasPerformedSearch);
  React.useEffect(() => {
    const wasInChat = prevHasPerformedSearchRef.current;
    prevHasPerformedSearchRef.current = hasPerformedSearch;
    
    // If we were in chat and now we're not, disable animations
    if (wasInChat && !hasPerformedSearch) {
      // Set flag immediately to disable animations (both state and ref for synchronous access)
      isTransitioningFromChatRef.current = true;
      setIsTransitioningFromChat(true);
      // Reset the flag after the longest animation duration (0.6s) plus a small buffer
      setTimeout(() => {
        isTransitioningFromChatRef.current = false;
        setIsTransitioningFromChat(false);
      }, 700); // 600ms animation + 100ms buffer
    }
  }, [hasPerformedSearch]);
  
  // Reset chat panel width when map view is closed or chat is hidden
  React.useEffect(() => {
    if (!isMapVisible || !hasPerformedSearch) {
      // Reset chat panel width when map is hidden or chat is closed
      setChatPanelWidth(0);
    }
  }, [isMapVisible, hasPerformedSearch]);

  // Hide bubble when chat panel is opened (hasPerformedSearch becomes true)
  React.useEffect(() => {
    if (hasPerformedSearch && isChatBubbleVisible) {
      console.log('💬 MainContent: Chat panel opened, hiding bubble');
      setIsChatBubbleVisible(false);
    }
  }, [hasPerformedSearch, isChatBubbleVisible]);

  // CRITICAL: FloatingChatBubble should never appear outside the map flow.
  // If we leave map view or navigate away from search/home, force-hide it.
  React.useEffect(() => {
    const isSearchOrHome = currentView === 'search' || currentView === 'home';
    if ((!isMapVisible || !isSearchOrHome) && isChatBubbleVisible) {
      setIsChatBubbleVisible(false);
      setMinimizedChatMessages([]);
    }
  }, [isMapVisible, currentView, isChatBubbleVisible]);

  // Reset shouldExpandChat flag after chat has been opened and expanded
  // CRITICAL: Only reset if chat was opened from dashboard/SideChatPanel, NOT from sidebar Chat button
  // When opening from sidebar, shouldExpandChat should stay true longer to ensure fullscreen mode is set
  React.useEffect(() => {
    // CRITICAL: Don't reset if we're currently opening chat from sidebar (shouldRestoreActiveChat is true)
    // This prevents the reset from interfering with sidebar chat opening
    if (shouldRestoreActiveChat) {
      return;
    }
    
    if (shouldExpandChat && hasPerformedSearch && isMapVisible) {
      // Chat is now open and map is visible, reset the flag after a delay to allow expansion
      // SideChatPanel will persist fullscreen mode even after shouldExpand becomes false
      const timer = setTimeout(() => {
        setShouldExpandChat(false);
      }, 600); // Increased from 500ms to 600ms to ensure fullscreen mode is fully set
      return () => clearTimeout(timer);
    }
  }, [shouldExpandChat, hasPerformedSearch, isMapVisible, shouldRestoreActiveChat]);
  
  // Calculate sidebar width for property pin centering
  // Sidebar widths: w-0 (collapsed) = 0px, w-56 (normal) = 224px, toggle rail w-3 = 12px
  const sidebarWidthValue = isSidebarCollapsed ? 12 : 236; // 0 + 12 = 12 when collapsed, 224 + 12 = 236 when normal
  
  const [pendingMapQuery, setPendingMapQuery] = React.useState<string>(""); // Store query when switching to map view
  const pendingMapQueryRef = React.useRef<string>(""); // Ref to store query synchronously for immediate access
  const [pendingDashboardQuery, setPendingDashboardQuery] = React.useState<string>(""); // Store query when switching from map to dashboard
  const pendingDashboardQueryRef = React.useRef<string>(""); // Ref to store query synchronously for immediate access
  // Store file attachments when switching views
  const [pendingMapAttachments, setPendingMapAttachments] = React.useState<FileAttachmentData[]>([]);
  const pendingMapAttachmentsRef = React.useRef<FileAttachmentData[]>([]);
  const [pendingDashboardAttachments, setPendingDashboardAttachments] = React.useState<FileAttachmentData[]>([]);
  const [isQuickStartPopupVisible, setIsQuickStartPopupVisible] = React.useState<boolean>(false);
  const pendingDashboardAttachmentsRef = React.useRef<FileAttachmentData[]>([]);
  // Store SideChatPanel attachments separately
  const [pendingSideChatAttachments, setPendingSideChatAttachments] = React.useState<FileAttachmentData[]>([]);
  const pendingSideChatAttachmentsRef = React.useRef<FileAttachmentData[]>([]);
  const sideChatPanelRef = React.useRef<SideChatPanelRef | null>(null);
  const [restoreChatId, setRestoreChatId] = React.useState<string | null>(null);
  const [newAgentTrigger, setNewAgentTrigger] = React.useState<number>(0); // Counter that increments when "New Agent" is clicked
  const [userData, setUserData] = React.useState<any>(null);
  const [showNewPropertyWorkflow, setShowNewPropertyWorkflow] = React.useState<boolean>(false);
  const [initialMapState, setInitialMapState] = React.useState<{ center: [number, number]; zoom: number } | null>(null);
  const mapRef = React.useRef<SquareMapRef>(null);
  
  // Track viewport size for responsive layout (like ChatGPT's minimum size)
  const [viewportSize, setViewportSize] = React.useState<{ width: number; height: number }>(() => {
    if (typeof window !== 'undefined') {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return { width: 1024, height: 768 };
  });
  
  const MIN_VIEWPORT_WIDTH = 400; // Minimum width threshold (similar to ChatGPT)
  const MIN_VIEWPORT_HEIGHT = 300; // Minimum height threshold
  const isVerySmall = viewportSize.width < MIN_VIEWPORT_WIDTH || viewportSize.height < MIN_VIEWPORT_HEIGHT;
  
  // Check if search bar needs space - if so, hide recent projects
  // Search bar needs minimum 350px width (reduced since placeholder is shorter: "Search for anything")
  // Plus vertical space for logo and search bar
  // Be VERY aggressive - hide projects if there's ANY risk of search bar being cut off
  const SEARCH_BAR_MIN_WIDTH = 350;
  const SEARCH_BAR_MIN_HEIGHT = 300; // Logo + search bar + spacing (increased for more safety)
  const SIDEBAR_WIDTH = 236; // Sidebar (w-56 = 224px) + toggle rail (w-3 = 12px)
  const CONTAINER_PADDING = 32; // Container padding on both sides
  const EXTRA_SAFETY_MARGIN = 100; // Extra safety margin to ensure search bar is never cut
  
  // Calculate available width more conservatively
  const availableWidthForSearch = viewportSize.width - SIDEBAR_WIDTH - CONTAINER_PADDING - EXTRA_SAFETY_MARGIN;
  
  // Hide projects if search bar would be cramped or cut off
  // Be VERY aggressive - hide projects much earlier to ensure search bar is never cut
  const shouldHideProjectsForSearchBar = 
    // Hide if available width is less than search bar minimum + large buffer
    availableWidthForSearch < SEARCH_BAR_MIN_WIDTH + 100 || 
    // Hide if viewport height is too small
    viewportSize.height < SEARCH_BAR_MIN_HEIGHT ||
    // Hide if viewport width is less than 900px (very aggressive - ensures search bar always has space)
    viewportSize.width < 900; // Hide projects on screens smaller than 900px to prioritize search
  
  // Track viewport size changes
  React.useEffect(() => {
    const handleResize = () => {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    };
    
    handleResize(); // Set initial size
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // Track if we automatically collapsed the sidebar (so we can restore it later)
  const autoCollapsedRef = React.useRef<boolean>(false);
  // Track when home transition just completed to prevent immediate layout shifts
  const homeTransitionJustCompletedRef = React.useRef<boolean>(false);
  
  // Automatically collapse sidebar when projects are hidden (to maximize space for search bar)
  // And automatically restore it when projects become visible again
  React.useEffect(() => {
    // Skip auto-collapse during transitions to prevent layout shifts
    // Also skip for a short period after home transition completes to prevent layout shift
    if (isTransitioningFromChatRef.current || isTransitioningFromChat || homeClicked || homeTransitionJustCompletedRef.current) {
      return;
    }
    
    if (shouldHideProjectsForSearchBar && !isSidebarCollapsed && onCloseSidebar) {
      // Collapse sidebar when we need to hide projects to save space
      onCloseSidebar();
      autoCollapsedRef.current = true; // Mark that we collapsed it
    } else if (!shouldHideProjectsForSearchBar && isSidebarCollapsed && autoCollapsedRef.current && onRestoreSidebarState) {
      // Restore sidebar when projects become visible again (only if we were the ones who collapsed it)
      onRestoreSidebarState(false); // false means expanded/not collapsed
      autoCollapsedRef.current = false; // Reset the flag
    } else if (!shouldHideProjectsForSearchBar) {
      // If projects are visible, reset the flag (user might have manually collapsed it)
      autoCollapsedRef.current = false;
    }
  }, [shouldHideProjectsForSearchBar, isSidebarCollapsed, onCloseSidebar, onRestoreSidebarState, isTransitioningFromChat, homeClicked]);
  
  // Use shared preview context
  const {
    previewFiles,
    activePreviewTabIndex,
    isPreviewOpen,
    setPreviewFiles,
    setActivePreviewTabIndex,
    setIsPreviewOpen,
    addPreviewFile,
    MAX_PREVIEW_TABS,
    expandedCardViewDoc: legacyExpandedCardViewDoc, // Legacy - will be removed
    closeExpandedCardView: legacyCloseExpandedCardView, // Legacy - will be removed
    isAgentTaskActive,
    agentTaskMessage,
    stopAgentTask,
    isMapNavigating,
    setIsChatPanelVisible,
    isChatPanelVisible,
    clearPendingExpandedCardView
  } = usePreview();
  
  // NEW: Use ChatStateStore for per-chat document preview isolation
  const { 
    activeChatId, 
    getActiveDocumentPreview, 
    closeDocumentForChat,
    setActiveChatId 
  } = useChatStateStore();
  
  // Get document preview from active chat's state (NEW per-chat isolation)
  const chatStateDocumentPreview = useActiveChatDocumentPreview();
  
  // Use ChatStateStore document preview if available, fall back to legacy PreviewContext during migration
  // Priority: ChatStateStore > PreviewContext (legacy)
  const expandedCardViewDoc = chatStateDocumentPreview || legacyExpandedCardViewDoc;
  
  // Close document for the active chat AND legacy state (both must be cleared)
  const closeExpandedCardView = React.useCallback(() => {
    if (activeChatId && chatStateDocumentPreview) {
      // Close in ChatStateStore (per-chat isolation)
      closeDocumentForChat(activeChatId);
    }
    // ALWAYS clear legacy state to ensure complete cleanup
    // (documents are opened in both states, so both must be cleared)
    legacyCloseExpandedCardView();
  }, [activeChatId, chatStateDocumentPreview, closeDocumentForChat, legacyCloseExpandedCardView]);
  
  // Sync chat panel visibility to PreviewContext for document preview gating
  // Document preview will only open when chat panel is visible; otherwise it queues silently
  // PreviewContext handles queuing expandedCardViewDoc when chat becomes hidden
  // CRITICAL: Use the same logic as SideChatPanel's isVisible prop to ensure consistency
  React.useEffect(() => {
    const chatPanelIsVisible = isMapVisible && hasPerformedSearch;
    console.log('📋 [MAIN_CONTENT] Updating chat panel visibility:', { 
      isMapVisible, 
      hasPerformedSearch, 
      chatPanelIsVisible,
      hasExpandedDoc: !!expandedCardViewDoc,
      expandedDocId: expandedCardViewDoc?.docId,
      activeChatId,
      usingChatStateStore: !!chatStateDocumentPreview
    });
    setIsChatPanelVisible(chatPanelIsVisible);
    // Also notify parent (DashboardLayout) so Sidebar can show active state
    onChatVisibilityChange?.(chatPanelIsVisible);
  }, [isMapVisible, hasPerformedSearch, setIsChatPanelVisible, onChatVisibilityChange, expandedCardViewDoc, activeChatId, chatStateDocumentPreview]);
  
  // Callback from SideChatPanel to track active chat state
  const handleActiveChatChange = React.useCallback((isActive: boolean) => {
    setHasActiveChat(isActive);
    // Propagate to parent (DashboardLayout) so Sidebar can show the active chat button
    onActiveChatChange?.(isActive);
  }, [onActiveChatChange]);
  
  // Handler for new chat - can be called from both SideChatPanel and ChatPanel
  const handleNewChatInternal = React.useCallback(() => {
    // Clear the query input for new query (UI state only)
    setMapSearchQuery("");
    
    // CRITICAL: Always clear restoreChatId to allow new chat creation
    // The running query will continue updating its history entry using its captured chatId
    // restoreChatId is only needed for restoring a chat when navigating back to it
    // When clicking "New Agent", we want a fresh chat, not a restored one
    setRestoreChatId(null);
    
    // Increment trigger to signal SideChatPanel to clear currentChatId
    setNewAgentTrigger(prev => prev + 1);
    
    // Keep hasPerformedSearch true so chat panel stays visible
    // This allows user to type and submit a new query while the other is running
    setHasPerformedSearch(true);
    
    console.log('🔄 MainContent: New agent requested - cleared restoreChatId and triggered newAgentTrigger');
  }, []);
  
  // Expose handler to parent via callback pattern
  // When MainContent mounts/updates, call onNewChatFromParent with our handler
  // DashboardLayout will store it and call it when handleNewChat is triggered
  React.useEffect(() => {
    if (onNewChatFromParent && typeof onNewChatFromParent === 'function') {
      // Call parent's callback with our handler
      // Parent will store it in a ref and call it when needed
      onNewChatFromParent(handleNewChatInternal);
    }
  }, [onNewChatFromParent, handleNewChatInternal]);
  
  // Effect to handle restore active chat signal from sidebar
  React.useEffect(() => {
    if (shouldRestoreActiveChat) {
      console.log('🔄 MainContent: Restoring active chat from sidebar signal - opening in fullscreen');
      // Mark that we're transitioning to chat (prevents dashboard flash and chat closing)
      // Set this IMMEDIATELY before any state updates to prevent render race conditions
      isTransitioningToChatRef.current = true;
      
      // CRITICAL: Ensure map is visible immediately for fullscreen chat
      // The computed effect should have already updated isMapVisible from externalIsMapVisible,
      // but we need to ensure it's true before setting shouldExpandChat
      // Update ref immediately for synchronous access
      if (externalIsMapVisible && !isMapVisible) {
        // External wants map visible but computed effect hasn't run yet - update immediately
        isMapVisibleRef.current = true;
        setIsMapVisible(true);
      }
      
      // CRITICAL: Set shouldExpandChat IMMEDIATELY (synchronously) to prevent flash
      // This ensures the chat panel renders at fullscreen width from the start
      setShouldExpandChat(true);
      // Track when chat was opened to prevent premature closing
      chatOpenedTimestampRef.current = Date.now();
      
      // RESTORE preserved chat state if it exists
      if (preservedChatStateRef.current) {
        console.log('🔄 MainContent: Restoring preserved chat state', {
          messagesCount: preservedChatStateRef.current.messages.length,
          query: preservedChatStateRef.current.mapSearchQuery,
          hasPerformedSearch: preservedChatStateRef.current.hasPerformedSearch
        });
        // Restore messages first
        setChatMessages(preservedChatStateRef.current.messages);
        setChatQuery(preservedChatStateRef.current.query);
        // Restore search state - this will make the panel visible
        setHasPerformedSearch(preservedChatStateRef.current.hasPerformedSearch);
        // Restore query immediately - SideChatPanel will handle it when visible
        setMapSearchQuery(preservedChatStateRef.current.mapSearchQuery);
        // Clear preserved state after restoring
        preservedChatStateRef.current = null;
      } else {
        // Show the chat panel (SideChatPanel becomes visible when hasPerformedSearch is true)
        setHasPerformedSearch(true);
      }
      
      // Clear the bubble since we're restoring the full chat
      setIsChatBubbleVisible(false);
      
      // Keep transition flag true longer to prevent chat closing effect from interfering
      // Use requestAnimationFrame to clear after render completes
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          isTransitioningToChatRef.current = false;
        });
      });
    }
  }, [shouldRestoreActiveChat, externalIsMapVisible, isMapVisible]);
  
  // Track last processed chat to prevent duplicate processing
  const lastProcessedRestoreChatRef = React.useRef<string | null>(null);
  
  // Effect to handle selected chat restoration from agent sidebar
  React.useEffect(() => {
    if (shouldRestoreSelectedChat && 
        shouldRestoreSelectedChat !== lastProcessedRestoreChatRef.current) {
      const chatId = shouldRestoreSelectedChat;
      console.log('🔄 MainContent: Restoring selected chat from agent sidebar - opening immediately', chatId);
      
      // Track that this chat has been processed
      lastProcessedRestoreChatRef.current = chatId;
      
      // Mark that we're transitioning to chat (prevents dashboard flash)
      isTransitioningToChatRef.current = true;
      
      // CRITICAL: Ensure map is visible immediately for fullscreen chat
      if (!isMapVisible) {
        isMapVisibleRef.current = true;
        setIsMapVisible(true);
      }
      
      // CRITICAL: Set shouldExpandChat IMMEDIATELY (synchronously) to prevent flash
      setShouldExpandChat(true);
      chatOpenedTimestampRef.current = Date.now();
      
      // Get chat from history
      const chat = getChatById?.(chatId);
      if (chat) {
        // Set restoreChatId immediately
        setRestoreChatId(chatId);
        
        // CRITICAL: Clear mapSearchQuery to prevent query prop from re-sending the previous chat's query
        // Without this, the query prop would contain the PREVIOUS chat's query text, which would
        // be sent to the RESTORED chat's backend session, causing query leakage between chats
        setMapSearchQuery("");
        
        // Show chat panel immediately
        setHasPerformedSearch(true);
        
        // If chat has a running query (status === 'loading'), preserve bot status
        // The SideChatPanel will restore the chat and handle the running state
      }
      
      // Clear signal after processing to prevent duplicate processing
      // Use setTimeout with 0 to clear after current execution completes
      setTimeout(() => {
        if (shouldRestoreSelectedChat === chatId) {
          // Only clear if it's still the same chat (prevents clearing if user clicked another chat)
          // The parent will clear it, but this is a safety net
        }
      }, 0);
      
      // Clear transition flag after render completes
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          isTransitioningToChatRef.current = false;
        });
      });
    }
  }, [shouldRestoreSelectedChat, isMapVisible, getChatById]);
  
  // Track previous externalIsMapVisible and shouldRestoreActiveChat to detect Map button clicks
  const prevExternalIsMapVisibleRef = React.useRef<boolean | undefined>(externalIsMapVisible);
  const prevShouldRestoreActiveChatRef = React.useRef<boolean>(shouldRestoreActiveChat);
  
  // Clear chat transition state and chat panel when map is explicitly opened
  React.useEffect(() => {
    // CRITICAL: Never close chat when shouldRestoreActiveChat is true (Chat button was just clicked)
    // OR when we're transitioning to chat (prevents race condition)
    // OR when chat is currently active (hasPerformedSearch is true) - map visibility change might be from chat opening
    // OR when a document is open (prevents chat from closing when document opens from agent action)
    if (shouldRestoreActiveChat || isTransitioningToChatRef.current || expandedCardViewDoc) {
      // Update refs but don't close chat
      prevExternalIsMapVisibleRef.current = externalIsMapVisible;
      prevShouldRestoreActiveChatRef.current = shouldRestoreActiveChat;
      return;
    }
    
    // CRITICAL: If chat was just opened (within last 700ms), don't close it
    // This prevents the chat closing effect from running when shouldRestoreActiveChat is cleared after 500ms
    const chatWasJustOpened = chatOpenedTimestampRef.current && (Date.now() - chatOpenedTimestampRef.current) < 700;
    if (chatWasJustOpened) {
      // Update refs but don't close chat - chat opening is still in progress
      prevExternalIsMapVisibleRef.current = externalIsMapVisible;
      prevShouldRestoreActiveChatRef.current = shouldRestoreActiveChat;
      return;
    }
    
    // Clear timestamp if chat opening period has passed
    if (chatOpenedTimestampRef.current && (Date.now() - chatOpenedTimestampRef.current) >= 700) {
      chatOpenedTimestampRef.current = null;
    }
    
    // Check if shouldRestoreActiveChat was just cleared (Map button clicked from chat)
    // This happens when Map button is clicked while in fullscreen chat mode
    // CRITICAL: Only close chat if:
    // 1. shouldRestoreActiveChat was true AND is now false (Map button was clicked)
    // 2. hasPerformedSearch is true (chat is currently open)
    // 3. We're not transitioning to chat
    // 4. externalIsMapVisible is true (map should be visible)
    // This ensures we only close when Map button was explicitly clicked from chat, not when chat was just opened
    const mapButtonClickedFromChat = 
      !shouldRestoreActiveChat && 
      prevShouldRestoreActiveChatRef.current && 
      hasPerformedSearch && 
      !isTransitioningToChatRef.current &&
      externalIsMapVisible;
    
    // Only close chat if Map button was explicitly clicked from chat, not if map became visible as part of chat opening
    if (mapButtonClickedFromChat) {
      // Use setTimeout to ensure chat opening effect completes first
      const timeoutId = setTimeout(() => {
        if (isTransitioningToChatRef.current) {
          // Chat is still opening, don't close it
          return;
        }
        
        console.log('🗺️ MainContent: Map button clicked from chat - closing chat panel', {
          mapButtonClickedFromChat,
          externalIsMapVisible,
          hasPerformedSearch,
          shouldRestoreActiveChat,
          prevShouldRestoreActiveChat: prevShouldRestoreActiveChatRef.current
        });
        
        if (hasPerformedSearch) {
          setHasPerformedSearch(false);
          setShouldExpandChat(false);
          // Clear chat query to reset chat state
          setMapSearchQuery("");
        }
      }, 200); // Increased delay to ensure chat opening effect completes
      
      return () => clearTimeout(timeoutId);
    }
    
    // Update refs for next comparison
    prevExternalIsMapVisibleRef.current = externalIsMapVisible;
    prevShouldRestoreActiveChatRef.current = shouldRestoreActiveChat;
  }, [externalIsMapVisible, hasPerformedSearch, shouldRestoreActiveChat, expandedCardViewDoc]);
  
  // Clear pending document preview when starting a new chat
  React.useEffect(() => {
    // When a new chat starts (no messages or explicit new chat), clear pending previews
    if (hasPerformedSearch && minimizedChatMessages.length === 0 && !mapSearchQuery) {
      clearPendingExpandedCardView();
    }
  }, [hasPerformedSearch, minimizedChatMessages.length, mapSearchQuery, clearPendingExpandedCardView]);
  
  // Use the prop value for chat mode
  const isInChatMode = inChatMode;
  
  // Close fullscreen chat and hide chat panel when navigating away from chat mode (e.g., clicking Map button)
  // This ensures that when clicking Map button from fullscreen chat, the chat closes and map becomes visible
  const prevIsInChatModeRef = React.useRef<boolean>(isInChatMode);
  React.useEffect(() => {
    const wasInChatMode = prevIsInChatModeRef.current;
    const justExitedChatMode = wasInChatMode && !isInChatMode;
    prevIsInChatModeRef.current = isInChatMode;
    
    // If we just exited chat mode (e.g., clicked Map button from fullscreen chat), close chat
    if (justExitedChatMode) {
      // Always close fullscreen chat when exiting chat mode
      if (shouldExpandChat) {
        setShouldExpandChat(false);
      }
      // Also clear hasPerformedSearch to hide the chat panel entirely when navigating to map
      // This ensures the chat panel doesn't stay visible when clicking Map button
      if (hasPerformedSearch && externalIsMapVisible) {
        setHasPerformedSearch(false);
      }
      // Close agent sidebar when leaving chat section
      closeChatPanel();
    }
  }, [isInChatMode, shouldExpandChat, hasPerformedSearch, externalIsMapVisible, closeChatPanel]);
  
  // Handle chat selection - always open in SideChatPanel (not old ChatInterface)
  // This ensures the new design is used when selecting chats from history
  React.useEffect(() => {
    // Skip if we're restoring via shouldRestoreSelectedChat (handled by separate effect)
    if (shouldRestoreSelectedChat) {
      return;
    }
    
    if (isInChatMode && currentChatData && currentChatId) {
      console.log('📋 MainContent: Chat selected, opening in SideChatPanel', {
        chatId: currentChatId,
        query: currentChatData.query,
        isMapVisible
      });
      
      // Set the map search query to the chat's preview/query
      setMapSearchQuery(currentChatData.query || '');
      setHasPerformedSearch(true);
      setRestoreChatId(currentChatId);
      
      // Always show map view to use SideChatPanel instead of old ChatInterface
      if (!isMapVisible) {
        setIsMapVisible(true);
      }
    }
  }, [isInChatMode, currentChatData, currentChatId, shouldRestoreSelectedChat]);

  // CRITICAL: Preload property pins IMMEDIATELY on mount (before anything else)
  // This ensures property pins are ready instantly when map loads
  // Uses lightweight /api/properties/pins endpoint (only id, address, lat, lng)
  // Caches pins in localStorage for instant access even after page refresh
  React.useEffect(() => {
    const preloadProperties = async () => {
      const CACHE_KEY = 'propertyPinsCache';
      const CACHE_MAX_AGE = 10 * 60 * 1000; // 10 minutes (pins change less frequently than card data)
      
      // Check localStorage cache first for instant pin rendering
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const cacheData = JSON.parse(cached);
          const cacheAge = Date.now() - cacheData.timestamp;
          
          if (cacheAge < CACHE_MAX_AGE && Array.isArray(cacheData.data) && cacheData.data.length > 0) {
            // Cache is fresh - use it immediately for instant rendering
            console.log('✅ Using cached property pins (age:', Math.round(cacheAge / 1000), 's, count:', cacheData.data.length, ')');
            (window as any).__preloadedProperties = cacheData.data;
            // Still fetch fresh data in background to ensure pins are up-to-date
          } else {
            console.log('⚠️ Pin cache expired or empty (age:', Math.round(cacheAge / 1000), 's), fetching fresh pins');
          }
        }
      } catch (e) {
        console.warn('Failed to read pin cache:', e);
      }
      
      try {
        console.log('🚀 Fetching property pins from backend...');
        // Use lightweight pins endpoint - only fetches id, address, lat, lng
        const pinsResponse = await backendApi.getPropertyPins();
          
          if (pinsResponse && pinsResponse.success && Array.isArray(pinsResponse.data)) {
            // Transform pin data to match expected format (minimal data for pins only)
            const transformedProperties = pinsResponse.data.map((pin: any) => {
              return {
                id: pin.id,
                address: pin.address || '',
                postcode: '',
                property_type: '',
                bedrooms: 0,
                bathrooms: 0,
                soldPrice: 0,
                rentPcm: 0,
                askingPrice: 0,
                price: 0,
                square_feet: 0,
                days_on_market: 0,
                latitude: pin.latitude,
                longitude: pin.longitude,
                summary: '',
                features: '',
                condition: 8,
                epc_rating: '',
                tenure: '',
                transaction_date: '',
                similarity: 90,
                image: "/property-1.png",
                agent: {
                  name: "John Bell",
                  company: "harperjamesproperty36"
                },
                documentCount: 0,
                completenessScore: 0
              };
            });
            
            // Store preloaded properties in memory for SquareMap to access
            (window as any).__preloadedProperties = transformedProperties;
            console.log(`✅ Preloaded ${transformedProperties.length} properties - ready for instant access`);
            
            // Store in localStorage cache for next page load
            try {
              localStorage.setItem(CACHE_KEY, JSON.stringify({
                data: transformedProperties,
                timestamp: Date.now()
              }));
              console.log('✅ Cached property pins in localStorage for instant access on next page load');
            } catch (e) {
              console.warn('Failed to cache pins:', e);
            }
          }
        } catch (error) {
          console.error('❌ Error preloading properties:', error);
          // If fetch fails but we have cached data, use that
          const cached = localStorage.getItem(CACHE_KEY);
          if (cached) {
            try {
              const cacheData = JSON.parse(cached);
              if (Array.isArray(cacheData.data) && cacheData.data.length > 0) {
                console.log('⚠️ Using stale cached pins due to fetch error');
                (window as any).__preloadedProperties = cacheData.data;
              }
            } catch (e) {
              console.warn('Failed to use stale cache:', e);
            }
          }
        }
      };
      
      preloadProperties();
    }, []);
    
    // OPTIMIZATION: Preload card summaries for recent projects on dashboard mount
    // OPTIMIZATION: Run in parallel with pin loading (2x faster)
    React.useEffect(() => {
      const preloadRecentCardSummaries = async () => {
        try {
          // Get last interacted property
          const saved = localStorage.getItem('lastInteractedProperty');
          if (saved) {
            const property = JSON.parse(saved);
            if (property && property.id) {
              const cacheKey = `propertyCardCache_${property.id}`;
              const cached = localStorage.getItem(cacheKey);
              const CACHE_MAX_AGE = 30 * 60 * 1000; // 30 minutes
              
              // Only preload if cache doesn't exist or is expired
              let shouldPreload = true;
              if (cached) {
                try {
                  const cacheData = JSON.parse(cached);
                  const cacheAge = Date.now() - cacheData.timestamp;
                  if (cacheAge < CACHE_MAX_AGE) {
                    shouldPreload = false; // Cache is fresh
                  }
                } catch (e) {
                  // Invalid cache, preload anyway
                }
              }
              
              if (shouldPreload) {
                // Preload in background (runs in parallel with pin loading)
                const response = await backendApi.getPropertyCardSummary(property.id, true);
                if (response.success && response.data) {
                  // Transform and cache
                  const transformedData = {
                    id: property.id,
                    address: response.data.address || property.address,
                    latitude: response.data.latitude || property.latitude,
                    longitude: response.data.longitude || property.longitude,
                    primary_image_url: response.data.primary_image_url,
                    image: response.data.primary_image_url || property.primary_image_url,
                    property_type: response.data.property_type,
                    tenure: response.data.tenure,
                    bedrooms: response.data.number_bedrooms || 0,
                    bathrooms: response.data.number_bathrooms || 0,
                    epc_rating: response.data.epc_rating,
                    documentCount: response.data.document_count || property.documentCount || 0,
                    rentPcm: response.data.rent_pcm || 0,
                    soldPrice: response.data.sold_price || 0,
                    askingPrice: response.data.asking_price || 0,
                    summary: response.data.summary_text,
                    notes: response.data.summary_text,
                    transaction_date: response.data.last_transaction_date,
                    yield_percentage: response.data.yield_percentage
                  };
                  
                  localStorage.setItem(cacheKey, JSON.stringify({
                    data: transformedData,
                    timestamp: Date.now(),
                    cacheVersion: (response as any).cache_version || 1
                  }));
                  console.log('✅ Preloaded card summary on dashboard mount:', property.address);
                } else if (response.error && response.error.includes('Property not found')) {
                  // Property no longer exists - clean up localStorage
                  localStorage.removeItem('lastInteractedProperty');
                  localStorage.removeItem(cacheKey);
                  // Silently handle - property was deleted or user lost access
                }
              }
            }
          }
        } catch (error) {
          console.warn('Failed to preload recent card summaries:', error);
        }
      };
      
      // OPTIMIZATION: Start immediately (runs in parallel with pin loading, no delay)
      preloadRecentCardSummaries();
    }, []);

  // Fetch user data on mount
  React.useEffect(() => {
    const fetchUserData = async () => {
      try {
        const authResult = await backendApi.checkAuth();
        if (authResult.success && authResult.data?.user) {
          setUserData(authResult.data.user);
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
      }
    };
    fetchUserData();
  }, []);

  const handleMapToggle = () => {
    // Toggle only SearchBar map visibility
    // If switching to map view, capture the current SearchBar value BEFORE state change
    if (!isMapVisibleFromSearchBar) {
      // Capture value synchronously before any state updates
      let currentQuery = '';
      
      if (searchBarRef.current?.getValue) {
        try {
          currentQuery = searchBarRef.current.getValue();
        } catch (error) {
          console.error('Error calling getValue on dashboard SearchBar ref:', error);
          // Fallback: try to get value from DOM
          try {
            const searchBarInput = document.querySelector('textarea[placeholder*="Search"], textarea[placeholder*="search"]') as HTMLTextAreaElement;
            if (searchBarInput) {
              currentQuery = searchBarInput.value || '';
            }
          } catch (domError) {
            console.error('Error getting value from DOM:', domError);
          }
        }
      } else {
        // Fallback: try to get value from DOM
        try {
          const searchBarInput = document.querySelector('textarea[placeholder*="Search"], textarea[placeholder*="search"]') as HTMLTextAreaElement;
          if (searchBarInput) {
            currentQuery = searchBarInput.value || '';
          }
        } catch (domError) {
          console.error('Error getting value from DOM:', domError);
        }
      }
      
      // Ensure hasPerformedSearch is false when entering map view (so SearchBar is visible)
      setHasPerformedSearch(false);
      
      // Also capture SideChatPanel attachments if it was visible (shouldn't be, but just in case)
      // This handles the case where user was in SideChatPanel and switches to dashboard, then back to map
      if (sideChatPanelRef.current?.getAttachments) {
        try {
          const sideChatAttachments = sideChatPanelRef.current.getAttachments();
          if (sideChatAttachments.length > 0) {
            // Store in SideChat attachments
            pendingSideChatAttachmentsRef.current = sideChatAttachments;
            setPendingSideChatAttachments(sideChatAttachments);
          }
        } catch (error) {
          console.error('Error capturing SideChatPanel attachments when switching to map:', error);
        }
      }
      
      // Capture file attachments from dashboard SearchBar
      // First check if we have stored attachments - if so, prefer those over captured (in case SearchBar hasn't restored yet)
      const existingStoredAttachments = pendingDashboardAttachmentsRef.current.length > 0 
        ? pendingDashboardAttachmentsRef.current 
        : pendingDashboardAttachments;
      
      let currentAttachments: FileAttachmentData[] = [];
      
      if (searchBarRef.current?.getAttachments) {
        try {
          const capturedAttachments = searchBarRef.current.getAttachments();
          
          // CRITICAL: Prioritize stored attachments if they exist, as they're more reliable
          // Only use captured if it's non-empty AND we don't have stored attachments
          // This prevents losing attachments due to timing issues with refs
          if (existingStoredAttachments.length > 0) {
            // We have stored attachments - use them (they're more reliable)
            currentAttachments = existingStoredAttachments;
          } else if (capturedAttachments.length > 0) {
            // No stored attachments, but captured has some - use captured
            currentAttachments = capturedAttachments;
          } else {
            // Both are empty
            currentAttachments = [];
          }
        } catch (error) {
          console.error('Error calling getAttachments on dashboard SearchBar ref:', error);
          // Fallback to stored attachments if capture fails
          if (existingStoredAttachments.length > 0) {
            currentAttachments = existingStoredAttachments;
          } else {
            currentAttachments = [];
          }
        }
      } else {
        // Fallback to stored attachments if ref not available
        if (existingStoredAttachments.length > 0) {
          currentAttachments = existingStoredAttachments;
        } else {
          currentAttachments = [];
        }
      }
      
      // CRITICAL: Also update pendingDashboardAttachments if we captured new attachments
      // This ensures they're preserved for when we switch back to dashboard
      if (currentAttachments.length > 0 && currentAttachments !== existingStoredAttachments) {
        pendingDashboardAttachmentsRef.current = currentAttachments;
        setPendingDashboardAttachments(currentAttachments);
      }
      
      // Set pending query and attachments, then toggle map visibility
      if (currentQuery && currentQuery.trim()) {
        // Store in ref immediately for synchronous access
        pendingMapQueryRef.current = currentQuery;
        // Also set state for React re-renders
        setPendingMapQuery(currentQuery);
      } else {
        // No query to preserve
        pendingMapQueryRef.current = "";
        setPendingMapQuery("");
      }
      
      // Store attachments - CRITICAL: Only store if we have attachments, otherwise preserve existing stored attachments
      // This prevents overwriting valid stored attachments with empty arrays
      if (currentAttachments.length > 0) {
        // Store in ref FIRST (synchronous) - this ensures map SearchBar can read it immediately
        pendingMapAttachmentsRef.current = currentAttachments;
        // Then update state (async) - this triggers re-renders
        setPendingMapAttachments(currentAttachments);
      } else {
        // Don't overwrite existing stored attachments with empty array
        const existingMapAttachments = pendingMapAttachmentsRef.current.length > 0 
          ? pendingMapAttachmentsRef.current 
          : pendingMapAttachments;
        if (existingMapAttachments.length === 0) {
          // Only clear if both are truly empty
          pendingMapAttachmentsRef.current = [];
          setPendingMapAttachments([]);
        }
      }
      
      // Track what view we're coming from (for "back" button in map view)
      // If chat is active (hasPerformedSearch or isInChatMode), we're coming from chat
      // Otherwise, we're coming from dashboard
      if (hasPerformedSearch || isInChatMode) {
        setPreviousViewBeforeMap('chat');
      } else {
        setPreviousViewBeforeMap('dashboard');
      }
      
      // Toggle SearchBar map visibility - the computed effect will update final isMapVisible
      setIsMapVisibleFromSearchBar(true);
    } else {
      // Switching back to dashboard - capture map view SearchBar value BEFORE state change
      let currentMapQuery = '';
      
      if (mapSearchBarRef.current?.getValue) {
        try {
          currentMapQuery = mapSearchBarRef.current.getValue();
        } catch (error) {
          console.error('Error calling getValue on map SearchBar ref:', error);
        }
      }
      
      // Capture file attachments from map SearchBar OR SideChatPanel
      // If SideChatPanel is visible (hasPerformedSearch is true), capture from SideChatPanel
      // Otherwise, capture from map SearchBar
      let currentMapAttachments: FileAttachmentData[] = [];
      
      if (hasPerformedSearch && sideChatPanelRef.current?.getAttachments) {
        // SideChatPanel is visible - capture from it
        const existingStoredSideChatAttachments = pendingSideChatAttachmentsRef.current.length > 0 
          ? pendingSideChatAttachmentsRef.current 
          : pendingSideChatAttachments;
        
        try {
          const capturedAttachments = sideChatPanelRef.current.getAttachments();
          
          // Use captured if non-empty, otherwise use stored if available
          if (capturedAttachments.length > 0) {
            currentMapAttachments = capturedAttachments;
          } else if (existingStoredSideChatAttachments.length > 0) {
            currentMapAttachments = existingStoredSideChatAttachments;
          } else {
            currentMapAttachments = [];
          }
        } catch (error) {
          console.error('Error calling getAttachments on SideChatPanel ref:', error);
          // Fallback to stored attachments if capture fails
          if (existingStoredSideChatAttachments.length > 0) {
            currentMapAttachments = existingStoredSideChatAttachments;
          }
        }
      } else if (mapSearchBarRef.current?.getAttachments) {
        // Map SearchBar is visible - capture from it
        const existingStoredMapAttachments = pendingMapAttachmentsRef.current.length > 0 
          ? pendingMapAttachmentsRef.current 
          : pendingMapAttachments;
        
        try {
          const capturedAttachments = mapSearchBarRef.current.getAttachments();
          
          // Use captured if non-empty, otherwise use stored if available
          if (capturedAttachments.length > 0) {
            currentMapAttachments = capturedAttachments;
          } else if (existingStoredMapAttachments.length > 0) {
            currentMapAttachments = existingStoredMapAttachments;
          } else {
            currentMapAttachments = [];
          }
        } catch (error) {
          console.error('Error calling getAttachments on map SearchBar ref:', error);
          // Fallback to stored attachments if capture fails
          if (existingStoredMapAttachments.length > 0) {
            currentMapAttachments = existingStoredMapAttachments;
          }
        }
      }
      
      // Store captured query for dashboard view
      if (currentMapQuery && currentMapQuery.trim()) {
        pendingDashboardQueryRef.current = currentMapQuery;
        setPendingDashboardQuery(currentMapQuery);
      } else {
        pendingDashboardQueryRef.current = "";
        setPendingDashboardQuery("");
      }
      
      // Store attachments for dashboard view - always store the best available
      // Always store what we have (even if empty) - the logic above ensures we have the best available
      pendingDashboardAttachmentsRef.current = currentMapAttachments;
      setPendingDashboardAttachments(currentMapAttachments);
      
      // Also store SideChatPanel attachments separately if they came from SideChatPanel
      if (hasPerformedSearch && currentMapAttachments.length > 0) {
        pendingSideChatAttachmentsRef.current = currentMapAttachments;
        setPendingSideChatAttachments(currentMapAttachments);
      }
      
      // Clear pending map query (but NOT attachments - preserve them for when switching back to map)
      pendingMapQueryRef.current = "";
      setPendingMapQuery("");
      // DO NOT clear pendingMapAttachmentsRef or pendingMapAttachments here
      // They should only be cleared when:
      // - A search is submitted (handleSearch)
      // - Entering chat mode
      // - Parent reset trigger fires
      // Toggle SearchBar map visibility - the computed effect will update final isMapVisible
      setIsMapVisibleFromSearchBar(false);
      // Reset hasPerformedSearch when leaving map view
      setHasPerformedSearch(false);
      // Notify parent to clear external map visibility
      onMapVisibilityChange?.(false);
      // CRITICAL: Set flag to prevent effect from overriding the hide
      // This ensures map hides on first click even if externalIsMapVisible hasn't updated yet
      isExplicitlyHidingRef.current = true;
      isMapVisibleRef.current = false;
      setIsMapVisible(false);
    }
  };

  // Memoize to prevent SearchBar re-renders on parent state changes
  const handleQueryStart = React.useCallback((query: string) => {
    // Track search activity but DON'T create chat history yet
    addActivity({
      action: `User initiated search: "${query}"`,
      documents: [],
      type: 'search',
      details: { searchTerm: query, timestamp: new Date().toISOString() }
    });
    
    // Don't create chat history until query is actually submitted
  }, [addActivity]);

  const handleLocationUpdate = (location: { lat: number; lng: number; address: string }) => {
    console.log('Location updated:', location);
    setCurrentLocation(location.address);
    
    // Track location activity
    addActivity({
      action: `Location selected: ${location.address}`,
      documents: [],
      type: 'search',
      details: { 
        latitude: location.lat,
        longitude: location.lng,
        address: location.address,
        searchType: 'location-based',
        timestamp: new Date().toISOString() 
      }
    });
  };

  const handleNavigate = (view: string, options?: { showMap?: boolean }) => {
    if (options?.showMap) {
      setIsMapVisible(true);
    }
    onNavigate?.(view, options);
  };

  const handleSearch = (query: string) => {
    // CRITICAL: Capture attachments from dashboard SearchBar BEFORE clearing
    let dashboardAttachments: FileAttachmentData[] = [];
    if (searchBarRef.current?.getAttachments) {
      try {
        const capturedAttachments = searchBarRef.current.getAttachments();
        // Also check stored attachments (more reliable)
        const storedAttachments = pendingDashboardAttachmentsRef.current.length > 0 
          ? pendingDashboardAttachmentsRef.current 
          : pendingDashboardAttachments;
        
        // Use captured if available, otherwise use stored
        dashboardAttachments = capturedAttachments.length > 0 
          ? capturedAttachments 
          : storedAttachments;
        
        console.log('📎 MainContent: Captured attachments from dashboard SearchBar:', dashboardAttachments.length);
      } catch (error) {
        console.error('Error capturing attachments from SearchBar:', error);
        // Fallback to stored attachments
        dashboardAttachments = pendingDashboardAttachmentsRef.current.length > 0 
          ? pendingDashboardAttachmentsRef.current 
          : pendingDashboardAttachments;
      }
    } else {
      // Fallback to stored attachments if ref not available
      dashboardAttachments = pendingDashboardAttachmentsRef.current.length > 0 
        ? pendingDashboardAttachmentsRef.current 
        : pendingDashboardAttachments;
    }
    
    // Store attachments for SideChatPanel BEFORE clearing
    // CRITICAL: Update both ref (for immediate access) and state (to trigger re-render)
    if (dashboardAttachments.length > 0) {
      pendingSideChatAttachmentsRef.current = dashboardAttachments;
      // Use flushSync to ensure state update happens before query is processed
      setPendingSideChatAttachments(dashboardAttachments);
      console.log('📎 MainContent: Stored attachments for SideChatPanel:', {
        count: dashboardAttachments.length,
        names: dashboardAttachments.map(a => a.name),
        hasExtractedText: dashboardAttachments.some(a => a.extractedText)
      });
    } else {
      // Clear attachments if none provided
      pendingSideChatAttachmentsRef.current = [];
      setPendingSideChatAttachments([]);
    }
    
    // Clear stored attachments when search is submitted (after capturing)
    pendingMapAttachmentsRef.current = [];
    setPendingMapAttachments([]);
    pendingDashboardAttachmentsRef.current = [];
    setPendingDashboardAttachments([]);
    
    // Clear preserved queries when search is submitted
    pendingMapQueryRef.current = "";
    setPendingMapQuery("");
    pendingDashboardQueryRef.current = "";
    setPendingDashboardQuery("");
    
    // Always update map search query
    setMapSearchQuery(query);
    
    // If map is visible and there are no attachments, only search on the map, don't enter chat
    // BUT if there are attachments, we need to show SideChatPanel to handle file choice
    if (isMapVisible && dashboardAttachments.length === 0) {
      console.log('Map search only - not entering chat mode');
      
      // Collapse sidebar on first query in map view for cleaner UI
      const isFirstQuery = !hasPerformedSearch;
      if (isFirstQuery && onCloseSidebar) {
        console.log('Collapsing sidebar for first map query');
        onCloseSidebar();
      }
      
      // Query from map chat bar - don't expand
      setShouldExpandChat(false);
      
      // Mark that user has performed a search in map mode
      setHasPerformedSearch(true);
      return;
    }
    
    // If map is visible but there are attachments, ensure SideChatPanel is shown
    if (isMapVisible && dashboardAttachments.length > 0) {
      console.log('Map visible with attachments - showing SideChatPanel for file choice', {
        attachmentCount: dashboardAttachments.length,
        storedInRef: pendingSideChatAttachmentsRef.current.length,
        storedInState: pendingSideChatAttachments.length
      });
      
      // Query from map chat bar - don't expand
      setShouldExpandChat(false);
      
      setHasPerformedSearch(true);
      // Attachments are already stored in pendingSideChatAttachmentsRef above
      // Query is already set via setMapSearchQuery above
      // SideChatPanel will receive both via props
      return;
    }
    
    // Dashboard view: Route query to SideChatPanel
    // Open map view and show SideChatPanel
    // CRITICAL: Set isMapVisibleFromSearchBar to true to ensure map stays visible
    // even if externalIsMapVisible becomes false (prevents chat from closing when document opens)
    setIsMapVisibleFromSearchBar(true);
    setIsMapVisible(true);
    setHasPerformedSearch(true);
    
    // Track when chat was opened to prevent premature closing
    chatOpenedTimestampRef.current = Date.now();
    
    // Query from dashboard - expand to fullscreen view
    setShouldExpandChat(true);
    
    // Collapse sidebar for cleaner UI when opening SideChatPanel
    if (onCloseSidebar) {
      onCloseSidebar();
    }
    
    // Don't enter normal chat mode - SideChatPanel handles the query
    return;

    // Normal chat search when map is not visible (now unused - all queries go to SideChatPanel)
    setChatQuery(query);
    setChatMessages([]); // Reset messages for new chat

    // Check if query contains location-related keywords
    const locationKeywords = ['near', 'in', 'around', 'at', 'properties in', 'houses in', 'homes in'];
    const isLocationQuery = locationKeywords.some(keyword => 
      query.toLowerCase().includes(keyword.toLowerCase())
    );

    // Track detailed search activity
    addActivity({
      action: `Advanced search initiated: "${query}" - Velora is analyzing relevant documents`,
      documents: [],
      type: 'search',
      details: { 
        searchQuery: query, 
        analysisType: 'comprehensive',
        isLocationBased: isLocationQuery,
        timestamp: new Date().toISOString() 
      }
    });

    // NOW create the chat history when query is actually submitted
    const chatData = {
      query,
      messages: [],
      timestamp: new Date()
    };
    
    // Create chat history first
    onChatHistoryCreate?.(chatData);
    
    // Then enter chat mode
    onChatModeChange?.(true, chatData);
  };
  const handleBackToSearch = () => {
    // Store current chat data before clearing for potential notification
    if (chatQuery || chatMessages.length > 0) {
      const chatDataToStore = {
        query: chatQuery,
        messages: chatMessages,
        timestamp: new Date()
      };
      // Pass the chat data one final time before exiting
      onChatModeChange?.(false, chatDataToStore);
    } else {
      onChatModeChange?.(false);
    }
    
    setChatQuery('');
    setChatMessages([]);
  };
  const handleChatMessagesUpdate = (messages: any[]) => {
    setChatMessages(messages);
    
    // Track chat interaction activity
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      addActivity({
        action: `Velora generated response for query: "${chatQuery}" - Analysis complete`,
        documents: [],
        type: 'analysis',
        details: { 
          messageCount: messages.length,
          responseType: lastMessage?.type || 'text',
          timestamp: new Date().toISOString()
        }
      });
    }
    
    // Update the chat data in parent component
    if (chatQuery) {
      const chatData = {
        query: chatQuery,
        messages,
        timestamp: new Date()
      };
      onChatModeChange?.(true, chatData);
    }
  };

  // Track previous view to detect actual navigation changes
  const prevViewRef = React.useRef<string>(currentView);

  // Handler to create project - captures current map state before opening workflow
  const handleCreateProject = React.useCallback(() => {
    // Capture current map state if map is visible and initialized
    if (isMapVisible && mapRef.current) {
      const mapState = mapRef.current.getMapState();
      if (mapState) {
        setInitialMapState(mapState);
      }
    }
    // Navigate away from projects page instantly (no animation) and show map
    // This ensures ProjectsPage disappears immediately when workflow opens
    setIsMapVisible(true);
    setIsMapVisibleFromSearchBar(true);
    onNavigate?.('search', { showMap: true });
    setShowNewPropertyWorkflow(true);
  }, [isMapVisible, onNavigate]);

  // Handler for property selection from ProjectsPage - opens fullscreen 25/75 split view
  const handleProjectPropertySelect = React.useCallback((property: any) => {
    console.log('📋 Opening fullscreen property view for:', property.id, property.address);
    console.log('📋 HANDLER CALLED - setting fullscreenPropertyView to true');
    
    // Set the selected property
    setSelectedPropertyFromProjects(property);
    
    // Enable fullscreen property view mode
    setFullscreenPropertyView(true);
    
    // Set property details as open (for proper chat panel sizing)
    setIsPropertyDetailsOpen(true);
    
    // DON'T set hasPerformedSearch - that's for the map chat panel, not fullscreen view
  }, []);

  // Handler to close fullscreen property view and return to projects page
  const handleCloseFullscreenPropertyView = React.useCallback(() => {
    console.log('📋 Closing fullscreen property view');
    setFullscreenPropertyView(false);
    setSelectedPropertyFromProjects(null);
    setIsPropertyDetailsOpen(false);
    setHasPerformedSearch(false);
  }, []);

  // Close project workflow when navigating away from projects view
  // BUT allow it to stay open when in map view (search view with map visible)
  React.useEffect(() => {
    if (currentView !== 'projects' && showNewPropertyWorkflow && !isMapVisible) {
      setShowNewPropertyWorkflow(false);
    }
  }, [currentView, showNewPropertyWorkflow, isMapVisible]);

  // Reset fullscreen property view when navigating to projects page without a selected project
  // This ensures the chat panel doesn't show when just viewing the projects list
  React.useEffect(() => {
    if (currentView === 'projects' && !selectedPropertyFromProjects) {
      setFullscreenPropertyView(false);
      setIsPropertyDetailsOpen(false);
    }
  }, [currentView, selectedPropertyFromProjects]);

  // Reset chat mode and map visibility when currentView changes (sidebar navigation)
  // IMPORTANT: This should ONLY trigger on actual navigation, NOT on sidebar toggle
  React.useEffect(() => {
    const prevView = prevViewRef.current;
    const isActualNavigation = prevView !== currentView;
    prevViewRef.current = currentView;
    
    // Track if we're transitioning from chat (hasPerformedSearch was true)
    const wasInChat = hasPerformedSearch;
    
    // Only reset if we're actually navigating to a different view
    // Don't reset if we're already on search view (e.g., just toggling sidebar)
    if (currentView !== 'search' && currentView !== 'home' && isActualNavigation) {
      // If we were in chat and navigating away, disable animations IMMEDIATELY
      if (wasInChat) {
        isTransitioningFromChatRef.current = true;
        setIsTransitioningFromChat(true);
        
        // PRESERVE chat state before clearing UI state
        // This allows queries to continue processing and state to be restored when returning
        if (chatMessages.length > 0 || mapSearchQuery) {
          preservedChatStateRef.current = {
            messages: [...chatMessages],
            query: chatQuery,
            mapSearchQuery: mapSearchQuery,
            hasPerformedSearch: hasPerformedSearch
          };
          console.log('💾 MainContent: Preserving chat state when navigating away', {
            messagesCount: chatMessages.length,
            query: mapSearchQuery,
            hasPerformedSearch
          });
        }
        
        // Reset chat UI state immediately to prevent layout shifts
        // But preserve the actual data in preservedChatStateRef
        setIsMapVisible(false);
        setMapSearchQuery("");
        setHasPerformedSearch(false);
        // Reset the flag after a shorter duration for faster transitions
        setTimeout(() => {
          isTransitioningFromChatRef.current = false;
          setIsTransitioningFromChat(false);
        }, 100);
      }
      // Don't clear chatQuery and chatMessages if we preserved state
      // Only clear if we're not preserving state (e.g., starting a completely new chat)
      // Note: preservedChatStateRef.current is set above if wasInChat is true
      if (!wasInChat) {
        setChatQuery("");
        setChatMessages([]);
      }
      
      // Close fullscreen property view when navigating away (always, regardless of chat state)
      if (fullscreenPropertyView) {
        setFullscreenPropertyView(false);
        setSelectedPropertyFromProjects(null);
        setIsPropertyDetailsOpen(false);
      }
      
      // If wasInChat is true, we've already preserved the state above, so don't clear
      // Let the parent handle chat mode changes
      onChatModeChange?.(false);
    }
    // When navigating to search view (via home button), hide the map
    // BUT: Only hide map if we're actually navigating FROM a different view
    // Don't hide map if we're already on search view (e.g., just toggling sidebar)
    // This prevents the map from being hidden when just toggling the sidebar
    // CRITICAL: NEVER reset map visibility when shouldRestoreActiveChat is true (chat button clicked)
    // CRITICAL: NEVER reset map visibility when externalIsMapVisible is true (map button clicked from sidebar)
    if ((currentView === 'search' || currentView === 'home') && isActualNavigation && prevView !== 'search' && prevView !== 'home' && !shouldRestoreActiveChat && !externalIsMapVisible) {
      // Only hide map if we're actually navigating FROM a different view TO search/home
      // This prevents hiding the map when just toggling sidebar on map view
      // BUT: Skip this if we're restoring active chat (chat button was clicked)
      const wasInChat = hasPerformedSearch;
      
      // CRITICAL: Set transition flag BEFORE any state changes to prevent animations
      if (wasInChat) {
        isTransitioningFromChatRef.current = true;
        setIsTransitioningFromChat(true);
        // Reset the flag after a shorter duration for faster transitions
        setTimeout(() => {
          isTransitioningFromChatRef.current = false;
          setIsTransitioningFromChat(false);
        }, 100);
      }
      
      // PRESERVE chat state before clearing UI state (same as above)
      if (hasPerformedSearch && (chatMessages.length > 0 || mapSearchQuery)) {
        preservedChatStateRef.current = {
          messages: [...chatMessages],
          query: chatQuery,
          mapSearchQuery: mapSearchQuery,
          hasPerformedSearch: hasPerformedSearch
        };
        console.log('💾 MainContent: Preserving chat state when navigating to home', {
          messagesCount: chatMessages.length,
          query: mapSearchQuery,
          hasPerformedSearch
        });
      }
      
      setIsMapVisible(false);
      setMapSearchQuery("");
      setHasPerformedSearch(false);
      
      // Close fullscreen property view when navigating to search/home (always, regardless of chat state)
      if (fullscreenPropertyView) {
        setFullscreenPropertyView(false);
        setSelectedPropertyFromProjects(null);
        setIsPropertyDetailsOpen(false);
      }
    }
  }, [currentView, onChatModeChange, hasPerformedSearch, shouldRestoreActiveChat, chatMessages, chatQuery, mapSearchQuery, externalIsMapVisible, fullscreenPropertyView]);

  // Track previous hasPerformedSearch to detect transitions
  const prevHasPerformedSearchForHomeRef = React.useRef<boolean>(hasPerformedSearch);
  
  // Special handling for home view - reset everything to default state
  React.useEffect(() => {
    if (homeClicked) {
      // CRITICAL: Don't reset if map is explicitly being opened from external control
      // This prevents the home reset from interfering when Map button is clicked
      if (externalIsMapVisible === true) {
        console.log('🏠 Home clicked but map is explicitly visible - skipping reset');
        return;
      }
      
      console.log('🏠 Home clicked - resetting map and state');
      // Check if we WERE in chat mode before the state change (hasPerformedSearch might already be false)
      const wasInChat = prevHasPerformedSearchForHomeRef.current;
      
      // CRITICAL: Set map visibility to false immediately and update ref synchronously
      // This prevents MainContent's stale isMapVisible(true) from propagating back to parent
      isMapVisibleRef.current = false;
      setIsMapVisible(false);
      // CRITICAL: Also reset isMapVisibleFromSearchBar - without this, the computed effect
      // will see externalIsMapVisible=false but isMapVisibleFromSearchBar=true and set
      // isMapVisible back to true, causing the map to stay visible instead of showing dashboard
      setIsMapVisibleFromSearchBar(false);
      
      // Freeze layout state BEFORE any state changes to prevent layout recalculation
      // This ensures layout calculations remain stable during the transition
      frozenLayoutStateRef.current = {
        shouldHideProjects: shouldHideProjectsForSearchBar,
        isVerySmall: isVerySmall,
        isSidebarCollapsed: isSidebarCollapsed,
        viewportSize: { width: viewportSize.width, height: viewportSize.height }
      };
      
      // Set transition flag BEFORE any state changes to prevent double render
      if (wasInChat) {
        isTransitioningFromChatRef.current = true;
        setIsTransitioningFromChat(true);
        setTimeout(() => {
          isTransitioningFromChatRef.current = false;
          setIsTransitioningFromChat(false);
          // Clear frozen layout state after transition completes (with extra buffer for CSS transitions)
          setTimeout(() => {
            frozenLayoutStateRef.current = null;
          }, 100); // Small delay to ensure CSS transitions complete
        }, 700);
      } else {
        // Even if not transitioning from chat, clear frozen state after a short delay
        setTimeout(() => {
          frozenLayoutStateRef.current = null;
        }, 400); // Longer delay to ensure layout is stable
      }
      
      setChatQuery("");
      setChatMessages([]);
      setCurrentLocation("");
      // Note: setIsMapVisible(false) is now set synchronously in DashboardLayout.handleViewChange
      setMapSearchQuery("");
      setHasPerformedSearch(false);
      onChatModeChange?.(false);
      // Close document preview when home is clicked
      closeExpandedCardView();
      
      // Mark that home transition just completed to prevent immediate layout shifts
      homeTransitionJustCompletedRef.current = true;
      // Clear the flag after a delay to allow auto-collapse effect to run normally
      // CRITICAL: Also delay onHomeResetComplete to ensure isMapVisible state update is committed
      // before homeClicked is reset. Otherwise, propagation effect runs with stale isMapVisible=true
      // and homeClicked=false, setting parent's isMapVisible back to true.
      setTimeout(() => {
        homeTransitionJustCompletedRef.current = false;
        onHomeResetComplete?.(); // Notify parent that reset is complete AFTER state is committed
      }, 100); // Short delay to ensure state is committed before homeClicked resets
      
      // Update ref for next time
      prevHasPerformedSearchForHomeRef.current = false;
    }
  }, [homeClicked, externalIsMapVisible, onChatModeChange, onHomeResetComplete, closeExpandedCardView, shouldHideProjectsForSearchBar, isVerySmall, isSidebarCollapsed]);
  
  // Update ref when hasPerformedSearch changes (outside of homeClicked effect)
  React.useEffect(() => {
    prevHasPerformedSearchForHomeRef.current = hasPerformedSearch;
  }, [hasPerformedSearch]);

  // Reset SearchBar when switching to chat mode or creating new chat
  React.useEffect(() => {
    if (isInChatMode && currentChatData?.query) {
      pendingMapQueryRef.current = "";
      setPendingMapQuery("");
      pendingDashboardQueryRef.current = "";
      setPendingDashboardQuery("");
      pendingMapAttachmentsRef.current = [];
      setPendingMapAttachments([]);
      pendingDashboardAttachmentsRef.current = [];
      setPendingDashboardAttachments([]);
      setResetTrigger(prev => prev + 1);
    }
  }, [isInChatMode, currentChatData]);

  // Reset from parent trigger (new chat created)
  React.useEffect(() => {
    if (parentResetTrigger !== undefined) {
      pendingMapQueryRef.current = "";
      setPendingMapQuery("");
      pendingDashboardQueryRef.current = "";
      setPendingDashboardQuery("");
      pendingMapAttachmentsRef.current = [];
      setPendingMapAttachments([]);
      pendingDashboardAttachmentsRef.current = [];
      setPendingDashboardAttachments([]);
      setResetTrigger(prev => prev + 1);
    }
  }, [parentResetTrigger]);

  // Track if we have a previous session to restore
  const [previousSessionQuery, setPreviousSessionQuery] = React.useState<string | null>(null);

  // Update previous session query when mapSearchQuery changes (and is not empty)
  React.useEffect(() => {
    if (mapSearchQuery) {
      setPreviousSessionQuery(mapSearchQuery);
    }
  }, [mapSearchQuery]);

  const renderViewContent = () => {
    switch (currentView) {
      case 'home':
      case 'search':
        // CRITICAL: When clicking chat button, shouldRestoreActiveChat is true OR we're in chat mode with map visible
        // OR we're transitioning to chat (prevents dashboard flash during state updates)
        // We should NEVER render dashboard in this case - always show fullscreen chat view
        // The map and SideChatPanel are rendered separately and will show when isMapVisible && hasPerformedSearch
        // This prevents any possibility of dashboard appearing when chat is clicked
        // BUT: If externalIsMapVisible is true (Map button clicked), always show map regardless of chat state
        if ((shouldRestoreActiveChat || isTransitioningToChatRef.current || (isInChatMode && isMapVisible)) && !externalIsMapVisible) {
          // Don't render dashboard - map/chat interface will be rendered instead
          return null;
        }
        // Use a single rendering path to prevent position shifts when transitioning
        // Conditionally wrap with motion.div or plain div, but always use same content structure
        // Use ref value for synchronous access to prevent render flicker
        const isTransitioning = isTransitioningFromChatRef.current || isTransitioningFromChat || homeClicked;
        const DashboardContent = () => (
          <div className="flex flex-col items-center flex-1 relative" style={{ 
            height: '100%', 
            minHeight: '100%',
            backgroundColor: 'transparent', // Ensure transparent to show background
            background: 'transparent', // Ensure transparent to show background
            justifyContent: 'flex-start', // Start from top, don't center everything
            transition: isTransitioning ? 'none' : undefined, // Disable all CSS transitions when transitioning
            WebkitTransition: isTransitioning ? 'none' : undefined,
            MozTransition: isTransitioning ? 'none' : undefined,
            msTransition: isTransitioning ? 'none' : undefined,
            OTransition: isTransitioning ? 'none' : undefined
          }}>
                {/* Interactive Dot Grid Background */}
                {/* No background needed here as it's handled globally */}
                
                {/* Centered Content Container - Responsive layout based on viewport size */}
                {/* When map is visible, don't render the container - search bar will be rendered separately */}
                {/* Use ref value during transitions for synchronous check, otherwise use state */}
                {(() => {
                  // During transitions, use ref for immediate value; otherwise use state
                  const mapVisible = isTransitioning ? isMapVisibleRef.current : isMapVisible;
                  // CRITICAL: Hide dashboard when map is visible OR when externalIsMapVisible is true (Map button clicked)
                  // Show dashboard when map is NOT visible AND externalIsMapVisible is false
                  const shouldHideDashboard = mapVisible || externalIsMapVisible;
                  return !shouldHideDashboard;
                })() ? (() => {
                  // Use frozen layout state during transitions to prevent recalculation
                  const frozenState = frozenLayoutStateRef.current;
                  const useFrozen = isTransitioning && frozenState !== null;
                  
                  // During transitions, use ref for immediate value; otherwise use state
                  const mapVisible = isTransitioning ? isMapVisibleRef.current : isMapVisible;
                  
                  // Check if search bar should be at bottom (same logic as below)
                  const VERY_SMALL_WIDTH_THRESHOLD = 600;
                  const VERY_SMALL_HEIGHT_THRESHOLD = 500;
                  
                  // Use frozen viewport size during transitions to prevent recalculation
                  const effectiveViewportSize = useFrozen ? frozenState.viewportSize : viewportSize;
                  
                  const isVerySmallViewport = effectiveViewportSize.width < VERY_SMALL_WIDTH_THRESHOLD || 
                                             effectiveViewportSize.height < VERY_SMALL_HEIGHT_THRESHOLD;
                  const shouldPositionAtBottom = isVerySmallViewport && !mapVisible;
                  
                  // Use frozen values during transitions, otherwise use current values
                  const effectiveIsVerySmall = useFrozen ? frozenState.isVerySmall : isVerySmall;
                  const effectiveShouldHideProjects = useFrozen ? frozenState.shouldHideProjects : shouldHideProjectsForSearchBar;
                  
                  // When small, center logo perfectly in middle of viewport
                  const shouldCenterLogo = (effectiveIsVerySmall || effectiveShouldHideProjects);
                  
                  // When only logo and search bar are visible, center logo in the space above search bar
                  // Calculate search bar height: fixed at bottom = 120px, in flow = ~80px
                  const searchBarHeight = shouldPositionAtBottom ? 120 : 80;
                  
                  // For normal dashboard view, center everything as a group
                  // Calculate available space: viewport height minus search bar space
                  const availableHeight = effectiveViewportSize.height - searchBarHeight;
                  
                  // When only logo and search bar are visible (projects hidden), center logo in the middle of available space
                  const isLogoOnlyView = effectiveShouldHideProjects && !effectiveIsVerySmall;
                  
                  // When very small (logo + search bar only), center logo in the gap between top and search bar
                  // The search bar is fixed at bottom (120px), so logo should be centered in remaining space
                  const isVerySmallLogoOnly = effectiveIsVerySmall && effectiveShouldHideProjects;
                  
                  // Calculate the space available for logo when only logo and search bar are visible
                  // This is the viewport height minus the search bar height (accounting for its position)
                  const logoContainerHeight = isVerySmallLogoOnly 
                    ? 'calc(100vh - 120px)' // Full viewport minus fixed search bar at bottom
                    : (isLogoOnlyView 
                      ? (shouldPositionAtBottom ? 'calc(100vh - 120px)' : `calc(100vh - ${searchBarHeight}px)`)
                      : (shouldCenterLogo ? (shouldPositionAtBottom ? 'calc(100vh - 120px)' : '100vh') : `${availableHeight}px`));
                  
                  return (
                    <div 
                      className="flex flex-col items-center w-full max-w-6xl mx-auto px-4" 
                      style={{ 
                        paddingLeft: 'clamp(1rem, 2vw, 1rem)', 
                        paddingRight: 'clamp(1rem, 2vw, 1rem)',
                        height: logoContainerHeight,
                        minHeight: logoContainerHeight,
                        paddingTop: '0',
                        paddingBottom: shouldPositionAtBottom ? '120px' : (isLogoOnlyView ? `${searchBarHeight}px` : '0'), // Reserve space for search bar when in flow and logo-only view
                        justifyContent: 'center', // Always center vertically - this centers the logo in the available space
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        position: 'relative',
                        transform: (!effectiveIsVerySmall && !effectiveShouldHideProjects) ? 'translateY(-20px)' : 'none', // Apply transform consistently - don't toggle based on transition state
                        zIndex: 2,
                        overflow: 'visible', // Ensure QuickStartBar is not clipped
                        transition: (isTransitioningFromChat || isTransitioningFromChatRef.current || homeClicked) ? 'none' : 'transform 0.3s ease-out', // Smooth transition for transform, but disable during navigation transitions
                        WebkitTransition: (isTransitioningFromChat || isTransitioningFromChatRef.current || homeClicked) ? 'none' : undefined,
                        MozTransition: (isTransitioningFromChat || isTransitioningFromChatRef.current || homeClicked) ? 'none' : undefined,
                        msTransition: (isTransitioningFromChat || isTransitioningFromChatRef.current || homeClicked) ? 'none' : undefined,
                        OTransition: (isTransitioningFromChat || isTransitioningFromChatRef.current || homeClicked) ? 'none' : undefined
                      }}
                    >
                {/* VELORA Branding Section */}
                      <div className="flex flex-col items-center" style={{ 
                        marginTop: '0',
                        marginBottom: (!effectiveIsVerySmall && !effectiveShouldHideProjects) ? 'clamp(2.5rem, 6vh, 4rem)' : '0', // Balanced spacing between logo and cards, use frozen values when transitioning
                        position: 'relative',
                        zIndex: 10 // Above background image
                      }}>
                        {/* VELORA Logo - Enlarged to match reference image proportions */}
                        <img 
                          src="/(DASH VELORA) Logo - NB.png" 
                    alt="VELORA" 
                          className="h-auto"
                          style={{ 
                            width: 'clamp(280px, 26vw, 420px)', // Slightly larger dashboard logo
                            minWidth: '280px', // Ensure it never gets smaller
                            maxWidth: '420px', // Can grow on larger screens
                            height: 'auto',
                            minHeight: '90px', // Slightly larger minimum height
                            maxHeight: '170px', // Slightly larger maximum height
                            marginBottom: (!effectiveIsVerySmall && !effectiveShouldHideProjects) ? 'clamp(2rem, 4vh, 3rem)' : '0', // Spacing between logo and search bar, use frozen values when transitioning
                            objectFit: 'contain' // Maintain aspect ratio
                          }}
                    onLoad={() => {
                      console.log('✅ VELORA logo loaded successfully');
                    }}
                    onError={(e) => {
                      console.error('❌ VELORA logo failed to load:', e.currentTarget.src);
                    }}
                  />
                </div>
                
                      
                      {/* Unified Search Bar - adapts based on context, always visible */}
                      {/* Ensure search bar is never cut off with overflow protection */}
                      {/* When map is visible, position search bar above map */}
                      {(() => {
                        // ChatGPT-style: Position search bar at bottom when viewport is very small
                        // This ensures the search bar and placeholder text are always visible
                        const VERY_SMALL_WIDTH_THRESHOLD = 600; // When to switch to bottom positioning
                        const VERY_SMALL_HEIGHT_THRESHOLD = 500; // When to switch to bottom positioning
                        
                        // Use frozen viewport size during transitions to prevent recalculation
                        const frozenState = frozenLayoutStateRef.current;
                        const useFrozen = isTransitioning && frozenState !== null;
                        const effectiveViewportSizeForSearch = useFrozen ? frozenState.viewportSize : viewportSize;
                        const effectiveSidebarCollapsed = useFrozen ? frozenState.isSidebarCollapsed : isSidebarCollapsed;
                        
                        const isVerySmallViewport = effectiveViewportSizeForSearch.width < VERY_SMALL_WIDTH_THRESHOLD || 
                                                   effectiveViewportSizeForSearch.height < VERY_SMALL_HEIGHT_THRESHOLD;
                        
                        // Calculate padding dynamically to ensure equal spacing and prevent cutoff
                        const MIN_PADDING = 16; // 1rem minimum padding
                        const MAX_PADDING = 32; // 2rem maximum padding
                        const SEARCH_BAR_MIN = 350; // Minimum search bar width for placeholder text (reduced since placeholder is shorter: "Search for anything")
                        
                        // Calculate actual sidebar width based on state (same as dashboard) - DO THIS FIRST
                        // Collapsed: 12px (toggle rail only)
                        // Normal: 236px (224px sidebar + 12px toggle rail)
                        // Expanded: 332px (320px sidebar + 12px toggle rail)
                        const TOGGLE_RAIL_WIDTH = 12;
                        const actualSidebarWidth = isSidebarCollapsed 
                          ? TOGGLE_RAIL_WIDTH 
                          : (isSidebarExpanded ? 320 + TOGGLE_RAIL_WIDTH : 224 + TOGGLE_RAIL_WIDTH);
                        
                        // Calculate available width (account for sidebar) - SAME AS DASHBOARD
                        const availableWidth = isMapVisible 
                          ? effectiveViewportSizeForSearch.width - (isSidebarCollapsed ? 0 : actualSidebarWidth)
                          : effectiveViewportSizeForSearch.width - (effectiveSidebarCollapsed ? 0 : SIDEBAR_WIDTH);
                        
                        // Calculate padding: ensure search bar fits with at least minimum padding
                        // If viewport is too small, use minimum padding
                        // Otherwise, use 4% of available width, capped at MAX_PADDING
                        let finalPadding;
                        if (availableWidth < SEARCH_BAR_MIN + (MIN_PADDING * 2)) {
                          // Very small viewport: use minimum padding, but ensure search bar can fit
                          // On extremely small screens, reduce padding even more
                          if (availableWidth < 350) {
                            finalPadding = 8; // Very minimal padding on extremely small screens
                          } else {
                            finalPadding = MIN_PADDING;
                          }
                        } else {
                          // Normal viewport: calculate padding as 4% of available width
                          finalPadding = Math.max(
                            MIN_PADDING,
                            Math.min(MAX_PADDING, Math.floor(availableWidth * 0.04))
                          );
                        }
                        
                        // Calculate actual search bar width: available width minus padding on both sides
                        const actualSearchBarWidth = availableWidth - (finalPadding * 2);
                        
                        // When very small, position at bottom like ChatGPT
                        const shouldPositionAtBottom = isVerySmallViewport && !isMapVisible;
                        
                        // For map view: Calculate center point of available space (same logic as dashboard padding)
                        // Center = sidebar right edge + (available width / 2)
                        // = actualSidebarWidth + (availableWidth / 2)
                        // = actualSidebarWidth + ((viewportWidth - actualSidebarWidth) / 2)
                        // = actualSidebarWidth + viewportWidth/2 - actualSidebarWidth/2
                        // = viewportWidth/2 + actualSidebarWidth/2
                        // = 50vw + actualSidebarWidth/2
                        const sidebarHalfWidth = actualSidebarWidth / 2;
                        const mapViewLeft = isMapVisible 
                          ? (isSidebarCollapsed 
                              ? '50%' 
                              : `calc(50vw + ${sidebarHalfWidth}px)`)
                          : (shouldPositionAtBottom ? '0' : 'auto');
                        
                        // Transform: translateX(-50%) centers the search bar at the left position
                        const mapViewTransform = isMapVisible ? 'translateX(-50%)' : 'none';
                        
                        // Debug logging to verify calculation
                        if (isMapVisible) {
                          console.log('🔍 Search bar positioning:', {
                            isSidebarCollapsed,
                            isSidebarExpanded,
                            actualSidebarWidth,
                            sidebarHalfWidth,
                            availableWidth,
                            viewportWidth: effectiveViewportSizeForSearch.width,
                            mapViewLeft,
                            transform: mapViewTransform,
                            calculatedCenter: `50vw + ${sidebarHalfWidth}px = ${effectiveViewportSizeForSearch.width / 2 + sidebarHalfWidth}px`
                          });
                        }
                        
                        // Determine if transition should be enabled
                        // Enable transition for sidebar state changes, but disable during chat transitions
                        // Component will automatically re-render when isSidebarCollapsed prop changes
                        const shouldEnableTransition = !(isTransitioningFromChat || isTransitioningFromChatRef.current || homeClicked);
                        const transitionValue = shouldEnableTransition 
                          ? (isMapVisible ? 'left 0.3s ease-out' : 'all 0.3s ease-out')
                          : 'none';
                        
                        return (
                          <div 
                            className={isMapVisible ? "" : "w-full flex justify-center items-center"} 
                            style={{ 
                              // Explicit display to override any className interference
                              display: (isMapVisible || showNewPropertyWorkflow) ? 'block' : 'flex',
                              alignItems: isMapVisible ? 'center' : 'center', // Center content vertically
                              marginTop: shouldPositionAtBottom ? 'auto' : (isVerySmall ? 'auto' : '0'),
                              marginBottom: shouldPositionAtBottom ? '0' : (isVerySmall ? 'auto' : '0'),
                              paddingLeft: isMapVisible ? '0' : `${finalPadding}px`, // Equal padding on left
                              paddingRight: isMapVisible ? '0' : `${finalPadding}px`, // Equal padding on right
                              paddingBottom: shouldPositionAtBottom ? '20px' : '0', // Bottom padding when fixed at bottom
                              paddingTop: shouldPositionAtBottom ? '16px' : '0', // Top padding when fixed at bottom (ChatGPT-style)
                              overflow: 'visible', // Ensure content is never clipped
                              position: isMapVisible ? 'fixed' : (shouldPositionAtBottom ? 'fixed' : 'relative'),
                              bottom: isMapVisible ? '24px' : (shouldPositionAtBottom ? '0' : 'auto'),
                              left: mapViewLeft,
                              transform: mapViewTransform,
                              zIndex: isMapVisible ? 50 : (shouldPositionAtBottom ? 100 : 10), // Higher z-index when fixed at bottom
                              width: isMapVisible ? 'clamp(400px, 85vw, 650px)' : '100%', // Full width in dashboard, constrained in map view
                              maxWidth: isMapVisible ? 'clamp(400px, 85vw, 650px)' : 'none', // No max width constraint in dashboard (handled by padding)
                              boxSizing: 'border-box', // Include padding in width calculation
                              backgroundColor: 'transparent', // Fully transparent - background shows through
                              background: 'transparent', // Fully transparent - background shows through
                              backdropFilter: 'none', // No backdrop filter to ensure full transparency
                              transition: transitionValue, // Smooth transitions for sidebar state changes, but disable during navigation
                              WebkitTransition: transitionValue,
                              MozTransition: transitionValue,
                              msTransition: transitionValue,
                              OTransition: transitionValue,
                              visibility: showNewPropertyWorkflow ? 'hidden' : 'visible' // Hide SearchBar when workflow is visible
                            }}>
                {!showNewPropertyWorkflow && <SearchBar 
                  ref={searchBarRefCallback}
                  onSearch={handleSearch} 
                  onQueryStart={handleQueryStart} 
                  onMapToggle={handleMapToggle}
                  onDashboardClick={onNavigateToDashboard}
                  resetTrigger={resetTrigger}
                  isMapVisible={isMapVisible}
                  isInChatMode={isInChatMode}
                  currentView={currentView}
                  hasPerformedSearch={hasPerformedSearch}
                  isSidebarCollapsed={isSidebarCollapsed}
                  onFileDrop={(file) => {
                    // This will be handled by SearchBar's handleFileUpload
                    // The prop is just for notification - SearchBar handles the file internally
                  }}
                  onAttachmentsChange={!isMapVisible ? (attachments) => {
                    // Proactively store dashboard attachments when they change
                    pendingDashboardAttachmentsRef.current = attachments;
                    setPendingDashboardAttachments(attachments);
                  } : undefined}
                  onPanelToggle={isMapVisible && !hasPerformedSearch ? () => {
                    if (previousSessionQuery) {
                      setMapSearchQuery(previousSessionQuery);
                      setHasPerformedSearch(true);
                      pendingMapQueryRef.current = ""; // Clear ref
                      setPendingMapQuery(""); // Clear pending query when opening panel
                      // This will show SideChatPanel (isVisible = isMapVisible && hasPerformedSearch)
                    }
                  } : undefined}
                  hasPreviousSession={isMapVisible && !hasPerformedSearch ? !!previousSessionQuery : false}
                  onQuickStartToggle={() => setIsQuickStartBarVisible(!isQuickStartBarVisible)}
                  isQuickStartBarVisible={isQuickStartBarVisible}
                  // REMOVED initialValue - using simple local state like SideChatPanel
                  // This prevents the typing reset issue completely
                  initialAttachedFiles={(() => {
                    // When in dashboard view (!isMapVisible), use dashboard attachments
                    // When in map view but not performed search, use map attachments
                    const attachments = !isMapVisible 
                      ? (pendingDashboardAttachmentsRef.current.length > 0 ? pendingDashboardAttachmentsRef.current : (pendingDashboardAttachments.length > 0 ? pendingDashboardAttachments : undefined))
                      : (isMapVisible && !hasPerformedSearch ? (pendingMapAttachmentsRef.current.length > 0 ? pendingMapAttachmentsRef.current : (pendingMapAttachments.length > 0 ? pendingMapAttachments : undefined)) : undefined);
                    return attachments;
                  })()}
                />}
                          </div>
                        );
                      })()}
                      
                      {/* Upload and Recent Projects Buttons - disabled for now */}
                      {false && !isMapVisible && !isInChatMode && (
                        <div className="w-full" style={{ 
                          marginTop: 'clamp(0.5rem, 1vh, 0.75rem)',
                          paddingTop: 'clamp(0.25rem, 0.5vh, 0.5rem)',
                          paddingLeft: 'clamp(16px, 4vw, 32px)',
                          paddingRight: 'clamp(16px, 4vw, 32px)',
                          position: 'relative',
                          zIndex: 100,
                          width: '100%',
                          maxWidth: 'clamp(400px, 85vw, 650px)',
                          marginLeft: 'auto',
                          marginRight: 'auto',
                          visibility: 'visible'
                        }}>
                          <div className="flex items-center justify-center gap-3">
                            {/* Recent Projects Button */}
                            <button
                              onClick={() => setIsRecentProjectsVisible(!isRecentProjectsVisible)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors focus:outline-none outline-none"
                              style={{
                                backgroundColor: '#FFFFFF',
                                color: '#374151',
                                border: '1px solid rgba(229, 231, 235, 0.6)',
                                fontSize: '12px',
                                fontWeight: 500,
                                cursor: 'pointer',
                                height: '32px',
                                transition: 'all 0.15s ease',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = '#F9FAFB';
                                e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.8)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = '#FFFFFF';
                                e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.6)';
                              }}
                            >
                              <Folder className="w-3.5 h-3.5" strokeWidth={1.5} />
                              <span>Recent Projects</span>
                            </button>
                          </div>
                          
                          {isRecentProjectsVisible && (
                            <motion.div
                              initial={{ opacity: 0, y: -10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              transition={{ duration: 0.2, ease: 'easeOut' }}
                              className="w-full"
                              style={{ 
                                marginTop: 'clamp(1rem, 2vh, 1.5rem)',
                                marginBottom: 'clamp(2rem, 5vh, 3rem)',
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                right: 0,
                                zIndex: 99,
                                width: '100%',
                                maxWidth: 'clamp(400px, 85vw, 650px)',
                                marginLeft: 'auto',
                                marginRight: 'auto',
                                paddingLeft: 'clamp(16px, 4vw, 32px)',
                                paddingRight: 'clamp(16px, 4vw, 32px)'
                              }}
                            >
                              <RecentProjectsSection 
                                onNewProjectClick={() => {
                                  closeSidebar();
                                  setShowNewPropertyWorkflow(true);
                                }}
                                onOpenProperty={(address, coordinates, propertyId) => {
                                  console.log('Project card clicked:', { address, coordinates, propertyId });
                                  let instantDisplay = false;
                                  if (propertyId) {
                                    try {
                                      const cacheKey = `propertyCardCache_${propertyId}`;
                                      const cached = localStorage.getItem(cacheKey);
                                      if (cached) {
                                        const cacheData = JSON.parse(cached);
                                        const CACHE_MAX_AGE = 30 * 60 * 1000;
                                        const cacheAge = Date.now() - cacheData.timestamp;
                                        
                                        if (cacheAge < CACHE_MAX_AGE && cacheData.data) {
                                          console.log('INSTANT: Using cached property data');
                                          instantDisplay = true;
                                          setIsMapVisible(true);
                                          (window as any).__pendingPropertySelection = { address, coordinates, propertyId };
                                          if (mapRef.current) {
                                            mapRef.current.selectPropertyByAddress(address, coordinates, propertyId);
                                          }
                                        }
                                      }
                                    } catch (e) {
                                      console.warn('Failed to check cache:', e);
                                    }
                                  }
                                  
                                  if (!instantDisplay) {
                                    setIsMapVisible(true);
                                    if (!propertyId) {
                                      setMapSearchQuery(address);
                                      setHasPerformedSearch(true);
                                    }
                                    (window as any).__pendingPropertySelection = { address, coordinates, propertyId };
                                    if (mapRef.current) {
                                      console.log('Selecting property immediately:', coordinates);
                                      mapRef.current.selectPropertyByAddress(address, coordinates, propertyId);
                                    } else {
                                      setTimeout(() => {
                                        if (mapRef.current) {
                                          console.log('Selecting property after map initialization:', coordinates);
                                          mapRef.current.selectPropertyByAddress(address, coordinates, propertyId);
                                        }
                                      }, 10);
                                    }
                                  }
                                }}
                              />
                            </motion.div>
                          )}
                        </div>
                      )}
                      
                      {/* QuickStartBar beside Search Bar - show when Link button is clicked */}
                      {!isMapVisible && !isInChatMode && isQuickStartBarVisible && (() => {
                        // Calculate padding to match search bar
                        const MIN_PADDING = 16;
                        const MAX_PADDING = 32;
                        const availableWidth = viewportSize.width - (isSidebarCollapsed ? 0 : SIDEBAR_WIDTH);
                        const quickStartPadding = availableWidth < 350 
                          ? 8 
                          : Math.max(
                              MIN_PADDING,
                              Math.min(MAX_PADDING, Math.floor(availableWidth * 0.04))
                            );
                        
                        return (
                          <motion.div
                            initial={{ opacity: 0, x: -20, scale: 0.95 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, x: -20, scale: 0.95 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            style={{
                              position: 'relative',
                              zIndex: 1000, // Higher z-index to ensure it's visible
                              width: '100%',
                              maxWidth: 'clamp(400px, 85vw, 650px)',
                              marginLeft: 'auto',
                              marginRight: 'auto',
                              marginTop: 'clamp(1rem, 2vh, 1.5rem)',
                              paddingLeft: `${quickStartPadding}px`,
                              paddingRight: `${quickStartPadding}px`,
                            }}
                          >
                            <QuickStartBar
                              onDocumentLinked={(propertyId, documentId) => {
                                console.log('Document linked:', { propertyId, documentId });
                                setIsQuickStartBarVisible(false);
                              }}
                              onPopupVisibilityChange={setIsQuickStartPopupVisible}
                            />
                          </motion.div>
                        );
                      })()}
                      
                    </div>
                  );
                })() : null}
                
                {/* MapChatBar and SideChatPanel are now rendered outside content container for proper visibility */}
                
                {/* Map is now rendered at top level for background mode */}
          </div>
        );
        
        // CRITICAL: Call the function directly instead of using <DashboardContent />
        // Using <DashboardContent /> (component syntax) with a function defined inside render
        // creates a new component type on every render, causing React to remount and lose state.
        // Calling DashboardContent() as a function just returns the JSX without this issue.
        return DashboardContent();
        
      case 'database':
        // Database/Files section is now handled by FilingSidebar popout
        // Return empty div - the sidebar will be rendered globally
        return <div />;
      case 'projects':
        return (
          <div className="w-full h-full overflow-auto">
            <ProjectsPage 
              onCreateProject={handleCreateProject}
              onPropertySelect={handleProjectPropertySelect}
              sidebarWidth={(() => {
                // Calculate sidebar width based on state (matching NewPropertyPinWorkflow logic)
                const TOGGLE_RAIL_WIDTH = 12; // w-3 = 12px
                let sidebarWidth = 0;
                
                if (isSidebarCollapsed) {
                  sidebarWidth = 0; // w-0 when collapsed
                } else if (isSidebarExpanded) {
                  sidebarWidth = 320; // w-80 = 320px when expanded
                } else {
                  // Normal state: w-56 = 224px (sidebar with labels)
                  sidebarWidth = 224;
                }
                
                return sidebarWidth + TOGGLE_RAIL_WIDTH;
              })()}
            />
          </div>
        );
      case 'profile':
        return <div className="w-full max-w-none">
            <Profile onNavigate={handleNavigate} />
          </div>;
      case 'analytics':
        return <div className="w-full max-w-none">
            <Analytics />
          </div>;
      case 'upload':
        return <div className="flex-1 h-full">
            <PropertyValuationUpload onUpload={file => console.log('File uploaded:', file.name)} onContinueWithReport={() => console.log('Continue with report clicked')} />
          </div>;
      case 'settings':
        return <SettingsView 
          onCloseSidebar={onCloseSidebar}
          onRestoreSidebarState={onRestoreSidebarState}
          getSidebarState={getSidebarState}
        />;
      default:
        return <div className="flex items-center justify-center flex-1 relative">
            {/* Interactive Dot Grid Background */}
            {/* No background needed here as it's handled globally */}
            
            
            {/* Unified Search Bar - adapts based on context */}
            {!showNewPropertyWorkflow && <SearchBar 
              ref={searchBarRefCallback}
              onSearch={handleSearch} 
              onQueryStart={handleQueryStart} 
              onMapToggle={handleMapToggle}
              onDashboardClick={onNavigateToDashboard}
              resetTrigger={resetTrigger}
              isMapVisible={isMapVisible}
              isInChatMode={isInChatMode}
              currentView={currentView}
              hasPerformedSearch={hasPerformedSearch}
              onFileDrop={(file) => {
                // This will be handled by SearchBar's handleFileUpload
                // The prop is just for notification - SearchBar handles the file internally
              }}
              onAttachmentsChange={!isMapVisible ? (attachments) => {
                // Proactively store dashboard attachments when they change
                pendingDashboardAttachmentsRef.current = attachments;
                setPendingDashboardAttachments(attachments);
              } : undefined}
              onQuickStartToggle={() => setIsQuickStartBarVisible(!isQuickStartBarVisible)}
              isQuickStartBarVisible={isQuickStartBarVisible}
              onPanelToggle={isMapVisible && !hasPerformedSearch ? () => {
                if (previousSessionQuery) {
                  setMapSearchQuery(previousSessionQuery);
                  setHasPerformedSearch(true);
                  pendingMapQueryRef.current = ""; // Clear ref
                  setPendingMapQuery(""); // Clear pending query when opening panel
                  // This will show SideChatPanel (isVisible = isMapVisible && hasPerformedSearch)
                }
              } : undefined}
              hasPreviousSession={isMapVisible && !hasPerformedSearch ? !!previousSessionQuery : false}
              // REMOVED initialValue - using simple local state like SideChatPanel
              initialAttachedFiles={(() => {
                // When in dashboard view (!isMapVisible), use dashboard attachments
                // When in map view but not performed search, use map attachments
                const attachments = !isMapVisible 
                  ? (pendingDashboardAttachmentsRef.current.length > 0 ? pendingDashboardAttachmentsRef.current : (pendingDashboardAttachments.length > 0 ? pendingDashboardAttachments : undefined))
                  : (isMapVisible && !hasPerformedSearch ? (pendingMapAttachmentsRef.current.length > 0 ? pendingMapAttachmentsRef.current : (pendingMapAttachments.length > 0 ? pendingMapAttachments : undefined)) : undefined);
                return attachments;
              })()}
            />}
          </div>;
    }
  };
  // Drag and drop state
  const [isDragging, setIsDragging] = React.useState(false);
  const [dragCounter, setDragCounter] = React.useState(0);
  const searchBarRef = React.useRef<{ handleFileDrop: (file: File) => void; getValue: () => string; getAttachments: () => FileAttachmentData[] } | null>(null);
  const mapSearchBarRef = React.useRef<{ handleFileDrop: (file: File) => void; getValue: () => string; getAttachments: () => FileAttachmentData[] } | null>(null);
  const pendingFileDropRef = React.useRef<File | null>(null);
  const [refsReady, setRefsReady] = React.useState(false);
  
  // Memoize ref callbacks to ensure they're stable across renders
  const searchBarRefCallback = React.useCallback((instance: { handleFileDrop: (file: File) => void; getValue: () => string; getAttachments: () => FileAttachmentData[] } | null) => {
    searchBarRef.current = instance;
    // Update state to trigger pending file processing
    setRefsReady(!!instance);
  }, []);
  
  const mapSearchBarRefCallback = React.useCallback((instance: { handleFileDrop: (file: File) => void; getValue: () => string; getAttachments: () => FileAttachmentData[] } | null) => {
    mapSearchBarRef.current = instance;
  }, []);

  // Global dragend and drop handlers to ensure dragging state is reset
  // This catches cases where drag ends outside the window, drop doesn't fire, or drop happens in FilingSidebar
  React.useEffect(() => {
    const handleGlobalDragEnd = () => {
      // Always reset dragging state when drag ends, regardless of current state
      setIsDragging(false);
      setDragCounter(0);
    };

    // Global drop handler - catches drops even if they're handled by FilingSidebar
    // This ensures the overlay disappears when a drop is registered anywhere
    const handleGlobalDrop = () => {
      // Always reset dragging state when drop occurs, regardless of where
      setIsDragging(false);
      setDragCounter(0);
    };

    // Also handle mouseup as a fallback (dragend might not fire in some cases)
    const handleMouseUp = () => {
      // Only reset if we're currently dragging
      if (isDragging) {
        setIsDragging(false);
        setDragCounter(0);
      }
    };

    // Use capture phase to catch events early, before stopPropagation can prevent them
    document.addEventListener('dragend', handleGlobalDragEnd, true);
    window.addEventListener('dragend', handleGlobalDragEnd, true);
    document.addEventListener('drop', handleGlobalDrop, true);
    window.addEventListener('drop', handleGlobalDrop, true);
    document.addEventListener('mouseup', handleMouseUp, true);
    window.addEventListener('mouseup', handleMouseUp, true);
    
    return () => {
      document.removeEventListener('dragend', handleGlobalDragEnd, true);
      window.removeEventListener('dragend', handleGlobalDragEnd, true);
      document.removeEventListener('drop', handleGlobalDrop, true);
      window.removeEventListener('drop', handleGlobalDrop, true);
      document.removeEventListener('mouseup', handleMouseUp, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
    };
  }, [isDragging]);
  
  // Additional safety: timeout fallback to reset dragging state if it gets stuck
  React.useEffect(() => {
    if (isDragging) {
      const timeout = setTimeout(() => {
        // If still dragging after 10 seconds, force reset (safety mechanism)
        setIsDragging(false);
        setDragCounter(0);
      }, 10000);
      
      return () => clearTimeout(timeout);
    }
  }, [isDragging]);
  
  // Reset dragging state when window loses focus or becomes hidden
  // This catches cases where drag ends when user switches tabs or windows
  React.useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && isDragging) {
        setIsDragging(false);
        setDragCounter(0);
      }
    };
    
    const handleBlur = () => {
      if (isDragging) {
        setIsDragging(false);
        setDragCounter(0);
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
    };
  }, [isDragging]);

  // Drag and drop handlers
  const handleDragEnter = React.useCallback((e: React.DragEvent) => {
    // Check if dragging over FilingSidebar - let it handle its own drag events
    const filingSidebar = (e.target as HTMLElement).closest('[data-filing-sidebar]');
    if (filingSidebar) {
      return; // Don't interfere with FilingSidebar's drag handling
    }
    
    // Check if dragging over SideChatPanel - let it handle its own drag events
    const sideChatPanel = (e.target as HTMLElement).closest('[data-side-chat-panel]');
    if (sideChatPanel) {
      return; // Don't interfere with SideChatPanel's drag handling
    }
    
    // Check if dragging over SearchBar - let it handle its own drag events
    // But we still want to track drag state for visual feedback
    const searchBar = (e.target as HTMLElement).closest('[data-search-bar]');
    if (searchBar) {
      // Still process to show visual feedback, but SearchBar will handle the actual drop
      const hasFiles = e.dataTransfer.types.includes('Files');
      const hasJsonData = e.dataTransfer.types.includes('application/json');
      if (hasFiles || hasJsonData) {
        e.preventDefault();
        setDragCounter(prev => {
          const newCount = prev + 1;
          if (newCount === 1) {
            setIsDragging(true);
          }
          return newCount;
        });
      }
      return; // Let SearchBar handle its own events
    }
    
    // Only process file drags (Files type) or FilingSidebar documents (application/json type)
    const hasFiles = e.dataTransfer.types.includes('Files');
    const hasJsonData = e.dataTransfer.types.includes('application/json');
    
    if (!hasFiles && !hasJsonData) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    setDragCounter(prev => {
      const newCount = prev + 1;
      // Set dragging to true on first enter
      if (newCount === 1) {
      setIsDragging(true);
    }
      return newCount;
    });
  }, []);

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    // Check if leaving from SideChatPanel - let it handle its own drag leave logic
    const sideChatPanel = (e.target as HTMLElement).closest('[data-side-chat-panel]');
    if (sideChatPanel) {
      return; // Don't interfere with SideChatPanel's drag handling
    }
    
    // Check if leaving from FilingSidebar - let it handle its own drag leave logic
    const filingSidebar = (e.target as HTMLElement).closest('[data-filing-sidebar]');
    if (filingSidebar) {
      return; // Don't interfere with FilingSidebar's drag handling
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    // Check if we're actually leaving the main container
    // by checking if the related target is outside
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    
    // Check if drag has left the viewport entirely (outside browser window)
    const isOutsideViewport = x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight;
    
    // Only decrement if we're actually leaving the container bounds
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom || isOutsideViewport) {
      setDragCounter(prev => {
        const newCount = Math.max(0, prev - 1);
        if (newCount === 0 || isOutsideViewport) {
          // If outside viewport, immediately reset
          setIsDragging(false);
          setDragCounter(0);
        } else if (newCount === 0) {
          setIsDragging(false);
        }
        return newCount;
      });
    }
  }, []);

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    // Check if dragging over FilingSidebar - allow events to propagate
    const filingSidebar = (e.target as HTMLElement).closest('[data-filing-sidebar]');
    if (filingSidebar) {
      // Don't stop propagation - let FilingSidebar handle it
      return;
    }
    
    // Check if dragging over SideChatPanel - allow events to propagate
    const sideChatPanel = (e.target as HTMLElement).closest('[data-side-chat-panel]');
    if (sideChatPanel) {
      // CRITICAL: Call preventDefault() to prevent browser default behavior
      // even when delegating to SideChatPanel, otherwise browser may interfere
      // This matches the pattern used for SearchBar
      const hasFiles = e.dataTransfer.types.includes('Files');
      const hasJsonData = e.dataTransfer.types.includes('application/json');
      if (hasFiles || hasJsonData) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setIsDragging(true);
      }
      // Don't call stopPropagation() here - let SideChatPanel's handler process it
      return; // Let SideChatPanel handle the actual drop
    }
    
    // Check if dragging over SearchBar - let it handle its own events
    const searchBar = (e.target as HTMLElement).closest('[data-search-bar]');
    if (searchBar) {
      // This is the SearchBar - let it handle the event
      // But we still want to show visual feedback on MainContent
      const hasFiles = e.dataTransfer.types.includes('Files');
      const hasJsonData = e.dataTransfer.types.includes('application/json');
      if (hasFiles || hasJsonData) {
        // CRITICAL: Call preventDefault() to prevent browser default behavior
        // even when delegating to SearchBar, otherwise browser may interfere
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setIsDragging(true);
      }
      // Don't call stopPropagation() here - let SearchBar's handler process it
      return; // Let SearchBar handle the actual drop
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    // Ensure dragging state is maintained while dragging over
    // Check for both Files type (regular file drags) and application/json (FilingSidebar documents)
    const hasFiles = e.dataTransfer.types.includes('Files');
    const hasJsonData = e.dataTransfer.types.includes('application/json');
    
    if (hasFiles || hasJsonData) {
      e.dataTransfer.dropEffect = 'copy';
      // Keep dragging state active while over the area
      setIsDragging(true);
    }
  }, []);

  const handleDrop = React.useCallback(async (e: React.DragEvent) => {
    // Always reset dragging state when drop occurs, regardless of where it's dropped
    setIsDragging(false);
    setDragCounter(0);
    
    // Check if drop is on FilingSidebar - let it handle the drop
    const filingSidebar = (e.target as HTMLElement).closest('[data-filing-sidebar]');
    if (filingSidebar) {
      return; // Let FilingSidebar handle the drop
    }
    
    // Check if drop is on property card - if so, let property card handle it
    const propertyPanel = (e.target as HTMLElement).closest('[data-property-panel]');
    if (propertyPanel) {
      return; // Let property card handle the drop
    }
    
    // Check if drop is on SearchBar - let it handle the drop
    const searchBar = (e.target as HTMLElement).closest('[data-search-bar]');
    if (searchBar) {
      // This is the SearchBar - let it handle the drop
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();

    // Check if this is a property document drag
    const propertyDocumentData = e.dataTransfer.getData('application/json');
    if (propertyDocumentData) {
      try {
        const docData = JSON.parse(propertyDocumentData);
        if (docData.type === 'property-document' && docData.downloadUrl) {
          console.log('📁 Property document dropped:', docData.filename);
          
          // Fetch the file from the backend
          const response = await fetch(docData.downloadUrl, {
            credentials: 'include'
          });
          
          if (response.ok) {
            const blob = await response.blob();
            const file = new File([blob], docData.filename, { type: docData.fileType || 'application/pdf' });
            
            console.log('✅ Property document fetched:', file.name, file.size, 'bytes');
            
            // Pass to search bar
            if (searchBarRef.current) {
              console.log('📤 Passing property document to SearchBar');
              try {
                searchBarRef.current.handleFileDrop(file);
                console.log('✅ Property document successfully passed to SearchBar');
              } catch (err) {
                console.error('❌ Error passing file to SearchBar:', err);
                // Fallback: store for later
                pendingFileDropRef.current = file;
                setHasPendingFile(true);
              }
            } else {
              console.log('📦 Storing property document for later (ref not ready)');
              pendingFileDropRef.current = file;
              setHasPendingFile(true); // Trigger the polling mechanism
            }
          } else {
            console.error('❌ Failed to fetch property document:', response.status, response.statusText);
          }
          return;
        }
      } catch (err) {
        console.error('Error parsing property document data:', err);
      }
    }

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      // Only handle the first file for now
      const file = files[0];
      console.log('📁 [MainContent] File dropped on empty space:', file.name, {
        size: file.size,
        type: file.type,
        currentView,
        hasSearchRef: !!searchBarRef.current,
        searchRefMethods: searchBarRef.current ? Object.keys(searchBarRef.current) : []
      });
      
      try {
        // Pass file to SearchBar via ref (preferred method)
        if (searchBarRef.current && searchBarRef.current.handleFileDrop) {
          console.log('📤 [MainContent] Passing file to SearchBar via ref');
          try {
            searchBarRef.current.handleFileDrop(file);
            console.log('✅ [MainContent] File successfully passed to SearchBar via ref');
            return; // Success - exit early
          } catch (refError) {
            console.error('❌ [MainContent] Error calling searchBarRef.handleFileDrop:', refError);
            // Fall through to fallback mechanisms
          }
        } else {
          console.warn('⚠️ [MainContent] SearchBar ref not available or missing handleFileDrop method', {
            refExists: !!searchBarRef.current,
            hasHandleFileDrop: searchBarRef.current?.handleFileDrop ? true : false
          });
        }
        
        // Fallback 1: Try to trigger file upload via the file input element
        console.log('🔄 [MainContent] Attempting fallback: direct file input approach');
        const fileInputs = document.querySelectorAll('input[type="file"]');
        let targetInput: HTMLInputElement | null = null;
        
        // Look for input in SearchBar using data attribute
        const searchBarForm = document.querySelector('[data-search-bar]');
        if (searchBarForm) {
          targetInput = searchBarForm.querySelector('input[type="file"]') as HTMLInputElement;
          console.log('🔍 [MainContent] Found SearchBar form, checking for file input:', !!targetInput);
        }
        
        // Fallback: Look for any form with file input
        if (!targetInput) {
          const forms = document.querySelectorAll('form');
          for (const form of forms) {
            const input = form.querySelector('input[type="file"]') as HTMLInputElement;
            if (input) {
              targetInput = input;
              console.log('🔍 [MainContent] Found file input in form');
              break;
            }
          }
        }
        
        // Last resort: use first available file input
        if (!targetInput && fileInputs.length > 0) {
          targetInput = fileInputs[0] as HTMLInputElement;
          console.log('🔍 [MainContent] Using first available file input as last resort');
        }
        
        if (targetInput) {
          console.log('📤 [MainContent] Found file input, triggering upload via DataTransfer');
          try {
            // Create a new FileList with the dropped file using DataTransfer
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            targetInput.files = dataTransfer.files;
            
            // Trigger change event to notify the component
            const changeEvent = new Event('change', { bubbles: true });
            targetInput.dispatchEvent(changeEvent);
            console.log('✅ [MainContent] File input change event dispatched');
            return; // Success - exit early
          } catch (inputError) {
            console.error('❌ [MainContent] Error triggering file input:', inputError);
            // Fall through to pending file mechanism
          }
        } else {
          console.warn('⚠️ [MainContent] No file input found in DOM');
        }
        
        // Fallback 2: Store as pending for later processing
        console.log('📦 [MainContent] Storing file as pending for later processing');
        pendingFileDropRef.current = file;
        setHasPendingFile(true);
        console.log('✅ [MainContent] File stored as pending, polling mechanism will process it');
        
      } catch (error) {
        console.error('❌ [MainContent] Unexpected error in handleDrop:', error);
        // Still try to store as pending as last resort
        pendingFileDropRef.current = file;
        setHasPendingFile(true);
      }
    } else {
      console.warn('⚠️ [MainContent] No files found in dataTransfer.files');
    }
  }, [currentView]);

  // Poll for refs to become available (fallback mechanism)
  const [hasPendingFile, setHasPendingFile] = React.useState(false);
  
  // Process pending file drop when refs become available
  React.useEffect(() => {
    if (pendingFileDropRef.current && searchBarRef.current) {
      const pendingFile = pendingFileDropRef.current;
      console.log('🔄 [MainContent] Processing pending file drop:', pendingFile.name, { 
        refsReady, 
        hasSearchRef: !!searchBarRef.current,
        hasHandleFileDrop: !!searchBarRef.current?.handleFileDrop,
        currentView
      });
      
      // Defensive check: ensure handleFileDrop method exists
      if (searchBarRef.current.handleFileDrop) {
        console.log('📤 [MainContent] Processing pending file in SearchBar');
        try {
          searchBarRef.current.handleFileDrop(pendingFile);
          pendingFileDropRef.current = null;
          setHasPendingFile(false);
          console.log('✅ [MainContent] Pending file successfully processed in SearchBar');
        } catch (err) {
          console.error('❌ [MainContent] Error processing pending file in SearchBar:', err);
          // Keep file as pending for retry
        }
      } else {
        console.warn('⚠️ [MainContent] SearchBar ref exists but handleFileDrop method is missing');
        // Keep file as pending - polling mechanism will retry
      }
    }
  }, [refsReady, currentView, hasPendingFile]);
  
  React.useEffect(() => {
    if (hasPendingFile && pendingFileDropRef.current) {
      const pendingFileName = pendingFileDropRef.current.name;
      console.log('🔄 [MainContent] Starting polling for pending file:', pendingFileName);
      
      let pollCount = 0;
      const maxPolls = 50; // 50 polls * 100ms = 5 seconds max
      
      const interval = setInterval(() => {
        pollCount++;
        const pendingFile = pendingFileDropRef.current;
        
        if (!pendingFile) {
          console.log('✅ [MainContent] Pending file cleared, stopping polling');
          setHasPendingFile(false);
          clearInterval(interval);
          return;
        }
        
        // Defensive check: verify ref exists and has the method
        if (searchBarRef.current && searchBarRef.current.handleFileDrop) {
          console.log(`📤 [MainContent] Processing pending file in SearchBar (poll attempt ${pollCount})`);
          try {
            searchBarRef.current.handleFileDrop(pendingFile);
            pendingFileDropRef.current = null;
            setHasPendingFile(false);
            clearInterval(interval);
            console.log('✅ [MainContent] Pending file successfully processed in SearchBar (polling)');
          } catch (err) {
            console.error(`❌ [MainContent] Error processing pending file in SearchBar (poll ${pollCount}):`, err);
            // Continue polling - might be a transient error
          }
        } else {
          // Only log every 10 polls to reduce console spam
          if (pollCount % 10 === 0) {
            console.log(`🔄 [MainContent] Polling for refs (attempt ${pollCount}):`, { 
              hasSearchRef: !!searchBarRef.current,
              hasHandleFileDrop: searchBarRef.current?.handleFileDrop ? true : false,
              currentView
            });
          }
        }
        
        // Stop polling after max attempts
        if (pollCount >= maxPolls) {
          console.warn(`⚠️ [MainContent] Pending file drop timed out after ${maxPolls} attempts (5 seconds):`, pendingFileName);
          clearInterval(interval);
          if (pendingFileDropRef.current) {
            pendingFileDropRef.current = null;
            setHasPendingFile(false);
          }
        }
      }, 100); // Check every 100ms
      
      return () => {
        clearInterval(interval);
      };
    }
  }, [hasPendingFile, currentView]);

  // Calculate left margin based on sidebar state
  // Sidebar is w-56 (224px) when normal, w-0 when collapsed
  const leftMargin = isSidebarCollapsed ? 'ml-0' : 'ml-56';
  
  return (
    <div 
    className={`flex-1 relative ${(currentView === 'search' || currentView === 'home') ? '' : 'bg-white'} ${leftMargin} ${className || ''}`} 
    style={{ 
      backgroundColor: (currentView === 'search' || currentView === 'home') ? 'transparent' : '#ffffff', 
      position: 'relative', 
      zIndex: 1,
      transition: 'none' // Instant transition to prevent gaps when sidebar opens/closes
    }}
    onDragEnter={handleDragEnter}
    onDragOver={handleDragOver}
    onDragLeave={handleDragLeave}
    onDrop={handleDrop}
  >
      {/* Global Upload Progress Bar */}
      <UploadProgressBar />
      
      {/* Background Map - Always rendered but only visible/interactive when map view is active */}
        {((currentView === 'search' || currentView === 'home') && (isMapVisible || externalIsMapVisible)) && (
        <div 
          className="fixed" 
          style={{ 
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            zIndex: (isMapVisible || externalIsMapVisible) ? 2 : -1, // Above content container when visible, below when hidden
            opacity: (isMapVisible || externalIsMapVisible) ? 1 : 0, // Hide visually when not in map view
            pointerEvents: 'none', // Disable pointer events on wrapper - let SquareMap handle it
            overflow: 'hidden', // Clip any overflow
            transition: (isTransitioningFromChat || isTransitioningFromChatRef.current || homeClicked) ? 'none' : 'opacity 0.2s ease-out', // Disable transition when transitioning from chat
            willChange: (isTransitioningFromChat || isTransitioningFromChatRef.current || homeClicked) ? 'auto' : 'opacity', // Prevent layout shifts
            backgroundColor: '#f5f5f5', // Match map background to prevent white gap
            background: '#f5f5f5' // Ensure background is set
          }}
        >
          <SquareMap
            ref={mapRef}
            isVisible={isMapVisible || externalIsMapVisible}
            isInteractive={isMapVisible || externalIsMapVisible}
            searchQuery={mapSearchQuery}
            hasPerformedSearch={hasPerformedSearch}
            isInChatMode={isInChatMode}
            onLocationUpdate={(location) => {
              setCurrentLocation(location.address);
            }}
            onPropertyDetailsVisibilityChange={(isOpen) => {
              setIsPropertyDetailsOpen(isOpen);
              if (isOpen && hasPerformedSearch) {
                // Chat is already open and property details is opening - expand chat for 50/50 split
                setShouldExpandChat(true);
              } else if (!isOpen) {
                // Reset shouldExpandChat when property details panel closes to prevent chat from expanding more
                setShouldExpandChat(false);
              }
            }}
            onCreateProject={handleCreateProject}
            containerStyle={{
              position: 'fixed',
              top: 0,
              left: 0, // Always at left edge - map stays full width
              width: '100vw', // Always full width - never resizes, no animations
              height: '100vh',
              zIndex: (isMapVisible || externalIsMapVisible) ? 2 : -1, // Above content container when visible, below when hidden
              pointerEvents: (isMapVisible || externalIsMapVisible) ? 'auto' : 'none', // Enable clicks when map is visible
              backgroundColor: '#f5f5f5', // Match map background
              background: '#f5f5f5' // Ensure background is set
            }}
            chatPanelWidth={chatPanelWidth}
            sidebarWidth={sidebarWidthValue}
          />
        </div>
      )}
      
      {/* Map navigation glow overlay - at root level for proper z-index stacking */}
      {isMapNavigating && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: chatPanelWidth + sidebarWidthValue, // Start after chat panel and sidebar
            right: 0,
            bottom: 0,
            pointerEvents: 'none',
            zIndex: 900, // Above map but below agent task overlay
            border: '4px solid rgba(217, 119, 8, 0.6)',
            boxShadow: 'inset 0 0 150px 60px rgba(217, 119, 8, 0.15), inset 0 0 80px 30px rgba(217, 119, 8, 0.2)',
            animation: 'mapGlowPulse 2s ease-in-out infinite',
            transition: 'left 0.2s ease-out' // Smooth transition when sidebar opens/closes
          }}
        />
      )}
      
      {/* Agent Task Overlay - Rendered at root level with high z-index to appear above chat */}
      {isAgentTaskActive && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, pointerEvents: 'none' }}>
          <AgentTaskOverlay
            message={agentTaskMessage}
            onStop={stopAgentTask}
          />
        </div>
      )}
      
      {/* Background based on current view - Hidden to show white background */}
      {/* Background components commented out to show white background */}
      
      {/* MapChatBar removed - using unified SearchBar instead */}
      
      {/* Search Bar for Map View - Rendered at top level to ensure visibility */}
      {isMapVisible && !hasPerformedSearch && (currentView === 'search' || currentView === 'home') && !showNewPropertyWorkflow && (() => {
        // Calculate actual sidebar width based on state (same as dashboard and first SearchBar)
        // Collapsed: 12px (toggle rail only)
        // Normal: 236px (224px sidebar + 12px toggle rail)
        // Expanded: 332px (320px sidebar + 12px toggle rail)
        const TOGGLE_RAIL_WIDTH = 12;
        const actualSidebarWidth = isSidebarCollapsed 
          ? TOGGLE_RAIL_WIDTH 
          : (isSidebarExpanded ? 320 + TOGGLE_RAIL_WIDTH : 224 + TOGGLE_RAIL_WIDTH);
        
        // Calculate center point of available space (same logic as dashboard and first SearchBar)
        // Center = sidebar right edge + (available width / 2)
        // = actualSidebarWidth + ((viewportWidth - actualSidebarWidth) / 2)
        // = viewportWidth/2 + actualSidebarWidth/2
        // = 50vw + actualSidebarWidth/2
        const sidebarHalfWidth = actualSidebarWidth / 2;
        const mapViewLeft = isSidebarCollapsed 
          ? '50%' 
          : `calc(50vw + ${sidebarHalfWidth}px)`;
        
        // Transform: translateX(-50%) centers the search bar at the left position
        const mapViewTransform = 'translateX(-50%)';
        
        // Determine if transition should be enabled (same logic as first SearchBar)
        const shouldEnableTransition = !(isTransitioningFromChat || isTransitioningFromChatRef.current || homeClicked);
        const transitionValue = shouldEnableTransition ? 'left 0.3s ease-out' : 'none';
        
        return (
          <div 
            ref={(el) => {
              if (el) {
                // Use requestAnimationFrame to check after layout
                requestAnimationFrame(() => {
                  const rect = el.getBoundingClientRect();
                  const computedStyle = window.getComputedStyle(el);
                  
                  // Check parent containers
                  let parent = el.parentElement;
                  const parentInfo: any[] = [];
                  let depth = 0;
                  while (parent && depth < 5) {
                    const parentStyle = window.getComputedStyle(parent);
                    parentInfo.push({
                      tagName: parent.tagName,
                      className: parent.className,
                      display: parentStyle.display,
                      visibility: parentStyle.visibility,
                      opacity: parentStyle.opacity,
                      position: parentStyle.position,
                      zIndex: parentStyle.zIndex,
                      overflow: parentStyle.overflow,
                      overflowX: parentStyle.overflowX,
                      overflowY: parentStyle.overflowY,
                      height: parentStyle.height,
                      width: parentStyle.width
                    });
                    parent = parent.parentElement;
                    depth++;
                  }
                  
                  // For fixed elements, offsetParent is null by design, so check visibility differently
                  const isActuallyVisible = computedStyle.display !== 'none' && 
                                          computedStyle.visibility !== 'hidden' && 
                                          computedStyle.opacity !== '0' &&
                                          rect.width > 0 && 
                                          rect.height > 0;
                  
                });
              }
            }}
            className="" 
            style={{ 
              position: 'fixed',
              bottom: '24px',
              left: mapViewLeft,
              transform: mapViewTransform,
              zIndex: 10000, // VERY HIGH z-index to ensure it's on top
              width: 'clamp(400px, 85vw, 650px)',
              maxWidth: 'clamp(400px, 85vw, 650px)',
              maxHeight: 'calc(100vh - 48px)', // Constrain to viewport: 24px bottom + 24px top padding
              boxSizing: 'border-box',
              pointerEvents: 'auto', // Ensure it's clickable
              // Remove flex from container - let SearchBar determine its own size
              display: 'block',
              // Add minHeight to prevent collapse before content renders
              minHeight: '60px',
              // Don't clip the SearchBar shadow
              overflow: 'visible',
              // Add transition for smooth movement when sidebar opens/closes
              transition: transitionValue,
              WebkitTransition: transitionValue,
              MozTransition: transitionValue,
              msTransition: transitionValue,
              OTransition: transitionValue
            }}>
          <SearchBar 
            ref={mapSearchBarRefCallback}
            onSearch={handleSearch} 
            onQueryStart={handleQueryStart} 
            onMapToggle={handleMapToggle}
            onDashboardClick={onNavigateToDashboard}
            resetTrigger={resetTrigger}
            isMapVisible={isMapVisible}
            isInChatMode={isInChatMode}
            currentView={currentView}
            hasPerformedSearch={hasPerformedSearch}
            isSidebarCollapsed={isSidebarCollapsed}
            onAttachmentsChange={isMapVisible && !hasPerformedSearch ? (attachments) => {
              // Proactively store map attachments when they change
              pendingMapAttachmentsRef.current = attachments;
              setPendingMapAttachments(attachments);
            } : undefined}
            onPanelToggle={() => {
              // Close sidebar when opening analyse mode
              onCloseSidebar?.();
              
              // If property details is open, open chat panel in expanded view
              if (isPropertyDetailsOpen) {
                // Open chat panel in expanded view - this will automatically expand property details
                setShouldExpandChat(true); // Set flag to expand chat
                if (previousSessionQuery) {
                  setMapSearchQuery(previousSessionQuery);
                  setHasPerformedSearch(true);
                  pendingMapQueryRef.current = ""; // Clear ref
                  setPendingMapQuery(""); // Clear pending query when opening panel
                } else {
                  // No previous session, but still open chat panel
                  setHasPerformedSearch(true);
                }
                // This will show SideChatPanel (isVisible = isMapVisible && hasPerformedSearch)
                // Property details will automatically expand when chatPanelWidth > 0
              } else {
                // Always open chat panel when button is clicked
                // First ensure map is visible (needed for SideChatPanel to show)
                if (!isMapVisible) {
                  setIsMapVisible(true);
                }
                
                // Set hasPerformedSearch to show the panel
                setHasPerformedSearch(true);
                
                // If there's a previous session query, use it
                if (previousSessionQuery) {
                  setMapSearchQuery(previousSessionQuery);
                  pendingMapQueryRef.current = ""; // Clear ref
                  setPendingMapQuery(""); // Clear pending query when opening panel
                } else {
                  // No previous session - open with empty query
                  setMapSearchQuery("");
                }
                // This will show SideChatPanel (isVisible = isMapVisible && hasPerformedSearch)
              }
            }}
            onQuickStartToggle={() => {
              setIsQuickStartBarVisible(!isQuickStartBarVisible);
            }}
            isQuickStartBarVisible={isQuickStartBarVisible}
            hasPreviousSession={!!previousSessionQuery}
            isPropertyDetailsOpen={isPropertyDetailsOpen}
            // REMOVED initialValue - using simple local state like SideChatPanel
            initialAttachedFiles={(() => {
              const attachments = pendingMapAttachmentsRef.current.length > 0 
                ? pendingMapAttachmentsRef.current 
                : (pendingMapAttachments.length > 0 ? pendingMapAttachments : undefined);
              return attachments;
            })()}
          />
          </div>
        );
      })()}

      {/* SideChatPanel - Always rendered to allow background processing */}
      <SideChatPanel
        ref={sideChatPanelRef}
        isVisible={(currentView === 'search' || currentView === 'home') && isMapVisible && hasPerformedSearch && !showNewPropertyWorkflow}
        query={mapSearchQuery}
        citationContext={citationContext}
        isSidebarCollapsed={isSidebarCollapsed}
        sidebarWidth={(() => {
          // Sidebar widths match Tailwind classes:
          // - w-0 when collapsed = 0px
          // - w-56 when normal = 224px (14rem)
          // Toggle rail is w-3 = 12px
          const SIDEBAR_NORMAL_WIDTH = 224; // w-56 = 14rem = 224px
          const TOGGLE_RAIL_WIDTH = 12; // w-3 = 12px
          
          // Update immediately when closing - no delays to prevent map showing through
          // Only include FilingSidebar width when it's actually open (not when closing)
          if (isFilingSidebarOpen) {
            // FilingSidebar starts at:
            // - 224px when sidebar not collapsed (covering toggle rail)
            // - 12px when sidebar collapsed (after toggle rail)
            const filingSidebarStart = isSidebarCollapsed ? TOGGLE_RAIL_WIDTH : SIDEBAR_NORMAL_WIDTH;
            return filingSidebarStart + filingSidebarWidth;
          } else {
            // FilingSidebar closed: use sidebar + toggle rail width
            // Update immediately - no transition delay
            const baseSidebarWidth = isSidebarCollapsed ? 0 : SIDEBAR_NORMAL_WIDTH;
            return baseSidebarWidth + TOGGLE_RAIL_WIDTH;
          }
        })()}
        isFilingSidebarClosing={isFilingSidebarClosing}
        isSidebarCollapsing={isSidebarCollapsing}
        restoreChatId={restoreChatId}
        newAgentTrigger={newAgentTrigger}
        initialAttachedFiles={
          pendingSideChatAttachmentsRef.current.length > 0 
            ? pendingSideChatAttachmentsRef.current 
            : (pendingSideChatAttachments.length > 0 ? pendingSideChatAttachments : undefined)
        }
        isPropertyDetailsOpen={isPropertyDetailsOpen}
        shouldExpand={shouldExpandChat}
        isMapVisible={isMapVisible}
        onQuickStartToggle={() => {
          setIsQuickStartBarVisible(!isQuickStartBarVisible);
        }}
        isQuickStartBarVisible={isQuickStartBarVisible}
        onQuerySubmit={(newQuery) => {
          // Handle new query from panel
          setMapSearchQuery(newQuery);
          // Keep hasPerformedSearch true
          // Query from within SideChatPanel - don't expand (keep current state or collapse)
          setShouldExpandChat(false);
        }}
        onMinimize={(chatMessages) => {
          // Disable animations when closing chat
          isTransitioningFromChatRef.current = true;
          setIsTransitioningFromChat(true);
          // Show bubble and hide full panel
          setMinimizedChatMessages(chatMessages);
          // Only show bubble in map flow (never on dashboard/other views)
          if (isMapVisible && (currentView === 'search' || currentView === 'home')) {
            setIsChatBubbleVisible(true);
          } else {
            setIsChatBubbleVisible(false);
          }
          setHasPerformedSearch(false);
          // Reset the flag after the longest animation duration
          setTimeout(() => {
            setIsTransitioningFromChat(false);
          }, 700);
          // This will hide SideChatPanel (isVisible = isMapVisible && hasPerformedSearch)
          // and show MapChatBar (isVisible = isMapVisible && !hasPerformedSearch)
        }}
        onMessagesUpdate={(chatMessages) => {
          // Update main chat messages to preserve state even when navigating away
          // This ensures queries can continue processing and update messages in the background
          setChatMessages(chatMessages);
          
          // Also update preserved state if we have it, so it stays current
          if (preservedChatStateRef.current) {
            preservedChatStateRef.current.messages = [...chatMessages];
          }
          
          // Update bubble messages in real-time when chat is minimized
          if (isChatBubbleVisible) {
            setMinimizedChatMessages(chatMessages);
          }
        }}
        onMapToggle={() => {
          // Disable animations when closing chat
          isTransitioningFromChatRef.current = true;
          setIsTransitioningFromChat(true);
          // Close panel and show MapChatBar by resetting hasPerformedSearch
          setMapSearchQuery("");
          setHasPerformedSearch(false);
          setRestoreChatId(null);
          setIsChatBubbleVisible(false);
          setMinimizedChatMessages([]);
          // Reset the flag after the longest animation duration
          setTimeout(() => {
            setIsTransitioningFromChat(false);
          }, 700);
          // This will hide SideChatPanel (isVisible = isMapVisible && hasPerformedSearch)
          // and show MapChatBar (isVisible = isMapVisible && !hasPerformedSearch)
        }}
        onNewChat={handleNewChatInternal}
        onSidebarToggle={onSidebarToggle}
        onChatWidthChange={(width) => {
          // Update chat panel width for map resizing
          setChatPanelWidth(width);
        }}
        onActiveChatChange={handleActiveChatChange}
        onOpenChatHistory={onOpenChatHistory}
        onOpenProperty={(address, coordinates, propertyId, navigationOnly = false) => {
          console.log('🏠 Property attachment clicked in SideChatPanel:', { address, coordinates, propertyId, navigationOnly });
          
          // Ensure map is visible
          if (!isMapVisible) {
            setIsMapVisible(true);
          }
          
          // Convert propertyId to string if needed
          const propertyIdStr = propertyId ? String(propertyId) : undefined;
          
          // Select property on map
          // Pass navigationOnly to control whether to show full panel or just title card
          if (mapRef.current && coordinates) {
            mapRef.current.selectPropertyByAddress(address || '', coordinates, propertyIdStr, navigationOnly);
          } else if (mapRef.current) {
            // Try to select even without coordinates
            mapRef.current.selectPropertyByAddress(address || '', undefined, propertyIdStr, navigationOnly);
          } else {
            // Map not ready - store for later
            (window as any).__pendingPropertySelection = { address, propertyId: propertyIdStr, navigationOnly };
            // Try again soon
            setTimeout(() => {
              if (mapRef.current) {
                if (coordinates) {
                  mapRef.current.selectPropertyByAddress(address || '', coordinates, propertyIdStr, navigationOnly);
                } else {
                  mapRef.current.selectPropertyByAddress(address || '', undefined, propertyIdStr, navigationOnly);
                }
              }
            }, 100);
          }
        }}
      />

      {/* Floating Chat Bubble - COMMENTED OUT FOR NOW */}
      {/* {isMapVisible && (currentView === 'search' || currentView === 'home') && isChatBubbleVisible && (
        <FloatingChatBubble
          chatMessages={minimizedChatMessages}
          onOpenChat={() => {
            // Restore full panel from bubble
            setIsChatBubbleVisible(false);
            setHasPerformedSearch(true);
            // Chat messages are already stored, panel will restore them
          }}
          onClose={() => {
            // Disable animations when closing chat bubble
            isTransitioningFromChatRef.current = true;
            setIsTransitioningFromChat(true);
            // Close bubble entirely
            setIsChatBubbleVisible(false);
            setMinimizedChatMessages([]);
            setHasPerformedSearch(false);
            // Reset the flag after the longest animation duration
            setTimeout(() => {
              setIsTransitioningFromChat(false);
            }, 700);
          }}
        />
      )} */}

      {/* QuickStartBar beside Search Bar - only show when chat panel is NOT open */}
      {isQuickStartBarVisible && !hasPerformedSearch && !isMapVisible && (
        <motion.div
          initial={{ opacity: 0, x: -20, scale: 0.95 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -20, scale: 0.95 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          style={{
            position: 'fixed',
            bottom: '80px', // Match search bar bottom position
            left: '50%',
            transform: 'translateX(calc(-50% + clamp(350px, 42.5vw, 650px) / 2 + 20px))', // Position to the right of search bar with spacing
            zIndex: 10001,
            width: 'fit-content',
            maxWidth: 'clamp(300px, 30vw, 400px)'
          }}
        >
            <QuickStartBar
              onDocumentLinked={(propertyId, documentId) => {
                console.log('Document linked:', { propertyId, documentId });
                // Optionally refresh recent projects or show success
                setIsQuickStartBarVisible(false); // Close after successful link
              }}
              onPopupVisibilityChange={setIsQuickStartPopupVisible}
            />
        </motion.div>
      )}

      {/* Content container - transparent to show map background */}
      <div className={`relative h-full flex flex-col ${
        isInChatMode 
          ? 'bg-white' 
          : currentView === 'upload' 
            ? 'bg-white' 
            : currentView === 'analytics'
              ? 'bg-white'
              : currentView === 'profile'
                ? 'bg-white'
                : currentView === 'notifications'
                  ? 'bg-white'
                  : (currentView === 'search' || currentView === 'home') ? '' : 'bg-white'
      } ${isInChatMode ? 'p-0' : currentView === 'upload' ? 'p-8' : currentView === 'analytics' ? 'p-4' : currentView === 'profile' ? 'p-0' : currentView === 'notifications' ? 'p-0 m-0' : 'p-8 lg:p-16'}`} style={{ 
        backgroundColor: (currentView === 'search' || currentView === 'home') ? 'transparent' : '#ffffff', 
        background: (currentView === 'search' || currentView === 'home') ? 'transparent' : undefined,
        pointerEvents: (isMapVisible || externalIsMapVisible) ? 'none' : 'auto', // Block pointer events when map is visible so clicks pass through to map
        zIndex: (isMapVisible || externalIsMapVisible) ? 0 : 1, // Below map when map is visible, above background when not
        transition: (isTransitioningFromChat || isTransitioningFromChatRef.current || homeClicked) ? 'none' : undefined, // Disable all transitions when transitioning from chat
        willChange: (isTransitioningFromChat || isTransitioningFromChatRef.current || homeClicked) ? 'auto' : undefined // Prevent layout shifts during transitions
      }}>
        {/* Browser Fullscreen Button - Top Right Corner of Dashboard */}
        {(currentView === 'search' || currentView === 'home') && !isMapVisible && !isInChatMode && (
          <div
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              zIndex: 100,
              pointerEvents: 'auto'
            }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                toggleBrowserFullscreen();
              }}
              className="flex items-center gap-2 rounded-md hover:bg-[#f5f5f5] active:bg-[#ebebeb] transition-all duration-150"
              title={isBrowserFullscreen ? "Exit fullscreen (⌘⇧F)" : "Fullscreen (⌘⇧F)"}
              type="button"
              style={{
                padding: '6px 10px 6px 8px',
                border: isBrowserFullscreen ? 'none' : '1px solid rgba(0, 0, 0, 0.1)',
                cursor: 'pointer',
                backgroundColor: isBrowserFullscreen ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.9)',
                boxShadow: isBrowserFullscreen ? 'none' : '0 1px 3px rgba(0, 0, 0, 0.06)'
              }}
            >
              {isBrowserFullscreen ? (
                <Minimize2 className="w-4 h-4 text-[#6B7280]" strokeWidth={2} />
              ) : (
                <Fullscreen className="w-4 h-4 text-[#6B7280]" strokeWidth={2} />
              )}
              <span className="text-[13px] font-medium text-[#374151] leading-none">
                {isBrowserFullscreen ? "Exit" : "Fullscreen"}
              </span>
              <span 
                className="text-[10px] text-[#9CA3AF] font-medium px-1.5 py-0.5 rounded bg-[#F3F4F6] leading-none"
                style={{
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  letterSpacing: '0.01em'
                }}
              >
                ⌘⇧F
              </span>
            </button>
          </div>
        )}
        
        <div className={`relative w-full ${
          isInChatMode 
            ? 'h-full w-full' 
            : currentView === 'upload' ? 'h-full' 
            : currentView === 'analytics' ? 'h-full overflow-hidden'
            : currentView === 'profile' ? 'h-full w-full'
            : currentView === 'notifications' ? 'h-full w-full'
            : 'max-w-5xl mx-auto'
        } flex-1 flex flex-col`}>
          {/* Always render without animation - the y: 20 animation causes "drop" effect */}
          <div className={`relative flex-1 flex flex-col overflow-visible`} style={{
            transition: 'none', // Disable all CSS transitions
            WebkitTransition: 'none',
            MozTransition: 'none',
            msTransition: 'none',
            OTransition: 'none'
          }}>{renderViewContent()}
          </div>
        </div>
      </div>
      
      {/* MapChatBar removed - using unified SearchBar instead */}
      
      {/* Standalone ExpandedCardView - for document preview */}
      {/* Renders when a document is open, regardless of chat panel visibility */}
      {/* For user-triggered opens (dashboard clicks), renders immediately */}
      {/* For agent-triggered opens (silently set), will show when document is set */}
      {/* StandaloneExpandedCardView handles positioning for both cases (chat open vs closed) */}
      {expandedCardViewDoc && (
        <StandaloneExpandedCardView
          docId={expandedCardViewDoc.docId}
          filename={expandedCardViewDoc.filename}
          highlight={expandedCardViewDoc.highlight}
          onClose={closeExpandedCardView}
          chatPanelWidth={chatPanelWidth}
          sidebarWidth={(() => {
            // Use EXACT same calculation as SideChatPanel's sidebarWidth prop
            // This ensures document preview aligns perfectly with chat panel's right edge
            const SIDEBAR_NORMAL_WIDTH = 224; // w-56 = 14rem = 224px
            const TOGGLE_RAIL_WIDTH = 12; // w-3 = 12px
            
            // Add FilingSidebar width when it's open OR when it's closing (during transition)
            if (isFilingSidebarOpen || isFilingSidebarClosing) {
              // FilingSidebar starts at:
              // - 224px when sidebar not collapsed (covering toggle rail)
              // - 12px when sidebar collapsed (after toggle rail)
              const filingSidebarStart = isSidebarCollapsed ? TOGGLE_RAIL_WIDTH : SIDEBAR_NORMAL_WIDTH;
              return filingSidebarStart + filingSidebarWidth;
            } else {
              // FilingSidebar closed: use sidebar + toggle rail width
              const baseSidebarWidth = isSidebarCollapsed ? 0 : SIDEBAR_NORMAL_WIDTH;
              return baseSidebarWidth + TOGGLE_RAIL_WIDTH;
            }
          })()}
          // Pass resize handlers from SideChatPanel for left-edge resize
          // Only enabled when chat panel is visible (side-by-side mode)
          // Use callback to access ref at call time, not render time
          onResizeStart={chatPanelWidth > 0 ? (e: React.MouseEvent) => {
            sideChatPanelRef.current?.handleResizeStart(e);
          } : undefined}
          isResizing={sideChatPanelRef.current?.isResizing ?? false}
        />
      )}
      
      {/* Shared Document Preview Modal - used by SearchBar, SideChatPanel, and PropertyFilesModal */}
      <DocumentPreviewModal
        files={previewFiles}
        activeTabIndex={activePreviewTabIndex}
        isOpen={isPreviewOpen}
        onClose={() => {
          setIsPreviewOpen(false);
          setPreviewFiles([]);
          setActivePreviewTabIndex(0);
        }}
        onTabChange={(index) => {
          setActivePreviewTabIndex(index);
        }}
        onTabClose={(index) => {
          setPreviewFiles(prev => {
            const newFiles = prev.filter((_, i) => i !== index);
            if (newFiles.length === 0) {
              setIsPreviewOpen(false);
              setActivePreviewTabIndex(0);
            } else {
              // Adjust active index if needed
              if (index < activePreviewTabIndex) {
                setActivePreviewTabIndex(activePreviewTabIndex - 1);
              } else if (index === activePreviewTabIndex && activePreviewTabIndex >= newFiles.length) {
                setActivePreviewTabIndex(newFiles.length - 1);
              }
            }
            return newFiles;
          });
        }}
        onTabReorder={(newOrder) => {
          setPreviewFiles(newOrder);
        }}
        onAddAttachment={() => {
          // Trigger file input click to add new attachment to preview
          const fileInput = document.createElement('input');
          fileInput.type = 'file';
          fileInput.accept = '*/*';
          fileInput.multiple = false;
          fileInput.onchange = (e) => {
            const target = e.target as HTMLInputElement;
            const file = target.files?.[0];
            if (file) {
              // Create FileAttachmentData from the file
              const fileData: FileAttachmentData = {
                id: `preview-${Date.now()}-${Math.random()}`,
                file: file,
                name: file.name,
                type: file.type,
                size: file.size
              };
              addPreviewFile(fileData);
            }
          };
          fileInput.click();
        }}
        isMapVisible={isMapVisible}
        isSidebarCollapsed={isSidebarCollapsed}
        chatPanelWidth={chatPanelWidth}
        sidebarWidth={(() => {
          // Use same pixel calculation as SideChatPanel for consistency
          const SIDEBAR_COLLAPSED_WIDTH = 0;
          const SIDEBAR_NORMAL_WIDTH = 224;
          const TOGGLE_RAIL_WIDTH = 12;
          const baseSidebarWidth = isSidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_NORMAL_WIDTH;
          // Include filing sidebar width when open
          if (isFilingSidebarOpen || isFilingSidebarClosing) {
            const filingSidebarStart = isSidebarCollapsed ? TOGGLE_RAIL_WIDTH : SIDEBAR_NORMAL_WIDTH;
            return filingSidebarStart + filingSidebarWidth;
          }
          return baseSidebarWidth + TOGGLE_RAIL_WIDTH;
        })()}
        filingSidebarWidth={filingSidebarWidth} // Pass separately for instant recalculation tracking
      />
      
      {/* New Property Pin Workflow */}
      <NewPropertyPinWorkflow
        isVisible={showNewPropertyWorkflow}
        sidebarWidth={(() => {
          // Calculate sidebar width based on state (matching DashboardLayout logic)
          const TOGGLE_RAIL_WIDTH = 12; // w-3 = 12px
          let sidebarWidth = 0;
          
          if (isSidebarCollapsed) {
            sidebarWidth = 0; // w-0 when collapsed
          } else if (isSidebarExpanded) {
            sidebarWidth = 320; // w-80 = 320px when expanded
          } else {
            // Normal state: w-56 = 224px (sidebar with labels)
            sidebarWidth = 224;
          }
          
          return sidebarWidth + TOGGLE_RAIL_WIDTH;
        })()}
        initialCenter={initialMapState?.center}
        initialZoom={initialMapState?.zoom}
        onClose={() => {
          setShowNewPropertyWorkflow(false);
          setInitialMapState(null); // Clear map state when workflow closes
        }}
        onPropertyCreated={(propertyId, propertyData) => {
          // Navigate to map view with new property selected
          setShowNewPropertyWorkflow(false);
          setIsMapVisible(true);
          
          // Set pending selection for map with full property data (including propertyHub with documents)
          const property = (propertyData as any).property || propertyData;
          (window as any).__pendingPropertySelection = {
            address: property.formatted_address || property.address,
            coordinates: { 
              lat: property.latitude, 
              lng: property.longitude 
            },
            propertyId: propertyId,
            propertyData: propertyData // Include full property data with propertyHub
          };
          
          // Select property immediately if map is ready
          if (mapRef.current && property.latitude && property.longitude) {
            mapRef.current.selectPropertyByAddress(
              property.formatted_address || property.address,
              { lat: property.latitude, lng: property.longitude },
              propertyId
            );
          }
        }}
      />
      
      {/* Back Button - Show when workflow IS visible */}
      {/* Rendered in MainContent to ensure it stays visible even if map is hidden */}
      {showNewPropertyWorkflow && (
        <div
          className="fixed"
          style={{
            right: '80px', // Same position as Create Project button (48px map toggle + 8px gap + 24px spacing)
            top: '20px',
            zIndex: 1000, // Much higher z-index to ensure it's above the workflow (which is z-50)
            pointerEvents: 'auto', // Ensure clicks are captured
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowNewPropertyWorkflow(false);
              setInitialMapState(null);
            }}
            className="flex items-center gap-1.5 rounded-none transition-all duration-200 group focus:outline-none outline-none"
            style={{
              padding: '4px 8px',
              height: '24px',
              minHeight: '24px',
              backgroundColor: '#FFFFFF',
              border: '1px solid rgba(82, 101, 128, 0.35)',
              borderRadius: '8px',
              boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.55), 0 1px 2px rgba(0, 0, 0, 0.08)',
              opacity: 1,
              backdropFilter: 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#F9FAFB';
              e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255, 255, 255, 0.55), 0 2px 4px rgba(0, 0, 0, 0.12)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#FFFFFF';
              e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255, 255, 255, 0.55), 0 1px 2px rgba(0, 0, 0, 0.08)';
            }}
            title="Back"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-700" strokeWidth={1.5} />
            <span className="text-slate-600 text-xs">
              Back
            </span>
          </button>
        </div>
      )}
      
      {/* FilingSidebar - Global popout sidebar for document management */}
      <FilingSidebar 
        sidebarWidth={(() => {
          // Sidebar widths match Tailwind classes:
          // - w-0 when collapsed = 0px
          // - w-56 when normal = 224px (14rem)
          // Toggle rail is w-3 = 12px
          const SIDEBAR_COLLAPSED_WIDTH = 0;
          const SIDEBAR_NORMAL_WIDTH = 224;
          const TOGGLE_RAIL_WIDTH = 12;
          
          if (isSidebarCollapsed) {
            // When collapsed: FilingSidebar starts after toggle rail only
            return SIDEBAR_COLLAPSED_WIDTH + TOGGLE_RAIL_WIDTH; // 0 + 12 = 12px
          } else {
            // When normal: FilingSidebar starts after sidebar (no extra toggle rail gap since it's visually part of sidebar)
            return SIDEBAR_NORMAL_WIDTH;
          }
        })()}
        isSmallSidebarMode={!isSidebarCollapsed}
      />

      {/* Fullscreen Property View - Chat + Property Details split */}
      <FullscreenPropertyView
        isVisible={fullscreenPropertyView && !!selectedPropertyFromProjects}
        property={selectedPropertyFromProjects}
        isSidebarCollapsed={isSidebarCollapsed}
        isSidebarExpanded={isSidebarExpanded}
        onClose={handleCloseFullscreenPropertyView}
        onMessagesUpdate={setChatMessages}
        onNewChat={handleNewChatInternal}
        onSidebarToggle={onSidebarToggle}
        onActiveChatChange={handleActiveChatChange}
        onOpenChatHistory={onOpenChatHistory}
      />
    </div>
  );
  };
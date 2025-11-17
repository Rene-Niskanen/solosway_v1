"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SearchBar } from './SearchBar';
import ChatInterface from './ChatInterface';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MapPin, Palette, Bell, Shield, Globe, Monitor, LayoutDashboard, Upload, BarChart3, Database, Settings, User, CloudUpload } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { DocumentPreviewModal } from './DocumentPreviewModal';
import { FileAttachmentData } from './FileAttachment';
import { usePreview } from '../contexts/PreviewContext';
import { RecentProjectsSection } from './RecentProjectsSection';

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
  const [locationInput, setLocationInput] = React.useState<string>('');
  // Initialize with empty values - will be loaded from localStorage when modal opens
  const [selectedCoordinates, setSelectedCoordinates] = React.useState<[number, number] | null>(null);
  const [selectedLocationName, setSelectedLocationName] = React.useState<string>('');
  const [selectedZoom, setSelectedZoom] = React.useState<number>(9.5);
  const [isGeocoding, setIsGeocoding] = React.useState(false);
  const [geocodeError, setGeocodeError] = React.useState<string>('');
  
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

  // Track if location data is ready to prevent race conditions
  const [isLocationDataReady, setIsLocationDataReady] = React.useState(false);

  // Reload saved location when modal opens - simple: whatever was last saved
  React.useEffect(() => {
    if (isOpen) {
      setIsLocationDataReady(false);
      
      // Set flag to prevent sync effect from running during initial load
      isLoadingFromStorageRef.current = true;
      
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
      // Reset flag when modal closes
      isLoadingFromStorageRef.current = false;
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

    // Wait for dialog animation to complete (200ms) plus buffer for rendering
    // Use a longer delay to account for Radix UI dialog animations
    const initTimeout = setTimeout(() => {
      if (!isOpen || !mapContainer.current) {
        console.error('❌ LocationPicker: Modal closed or container disappeared before map init', { isOpen, hasContainer: !!mapContainer.current });
        return;
      }

      // Double-check container has dimensions - retry if not ready
      const checkAndInit = () => {
        if (!isOpen || !mapContainer.current) return;

        if (mapContainer.current.offsetWidth === 0 || mapContainer.current.offsetHeight === 0) {
          console.warn('📍 LocationPicker: Container has no dimensions, retrying...', {
            width: mapContainer.current.offsetWidth,
            height: mapContainer.current.offsetHeight
          });
          // Retry after a short delay
          setTimeout(checkAndInit, 100);
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
            doubleClickZoom: true
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
            
            // Map is now loaded and initialized, allow sync effect to run after a short delay
            // This prevents the sync from running immediately and causing glitches
            setTimeout(() => {
              isMapJustInitializedRef.current = false;
              isLoadingFromStorageRef.current = false; // Clear loading flag after map is stable
              console.log('📍 LocationPicker: Map initialization complete, sync effect can now run');
            }, 1000); // 1 second delay to ensure map is stable

            // Resize map to ensure it renders correctly
            map.current.resize();

            // Don't add marker - using dotted border frame instead
            // marker.current = new mapboxgl.Marker({ color: '#3b82f6' })
            //   .setLngLat(initial.center)
            //   .addTo(map.current);

            console.log('✅ LocationPicker: Map loaded (no marker - using dotted border frame)');

            // Hide Mapbox branding
            const container = map.current.getContainer();
            const attrib = container.querySelector('.mapboxgl-ctrl-attrib');
            const logo = container.querySelector('.mapboxgl-ctrl-logo');
            if (attrib) (attrib as HTMLElement).style.display = 'none';
            if (logo) (logo as HTMLElement).style.display = 'none';

            // Force a repaint to ensure map is visible
            setTimeout(() => {
              if (map.current) {
                map.current.resize();
              }
            }, 100);
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
              map.current.resize();
            }
          };

          map.current.on('load', handleMapLoad);
          map.current.on('click', handleMapClick);
          map.current.on('move', handleMapMove);
          map.current.on('moveend', handleMapMoveEnd);
          map.current.on('error', handleMapError);
          map.current.on('style.load', handleStyleLoad);
      
          // Also try to resize after a short delay as fallback
          setTimeout(() => {
            if (map.current && !map.current.loaded()) {
              console.log('📍 LocationPicker: Map not loaded yet, will resize when ready');
            } else if (map.current) {
              map.current.resize();
            }
          }, 500);
        } catch (error) {
          console.error('❌ LocationPicker: Failed to create map:', error);
        }
      };

      checkAndInit();
    }, 300); // Increased delay to account for dialog animation (200ms) + buffer

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
      
      // Double-check we're not in a user interaction, just initialized, or loading from storage
      if (isUserInteractionRef.current || isMapJustInitializedRef.current || isLoadingFromStorageRef.current) {
        return;
      }

      try {
        // Check if map is already at the target location to avoid unnecessary flyTo
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
        
        // Only flyTo if the location or zoom is significantly different
        if (distance > 0.001 || zoomDiff > 0.5) {
          map.current.flyTo({
            center: selectedCoordinates,
            zoom: targetZoom,
            duration: 600
          });
          console.log('✅ LocationPicker: Map synced with coordinates');
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
        onClick={() => setIsOpen(true)}
        className="w-full group relative bg-white border border-slate-200 rounded-lg hover:border-slate-300 hover:shadow-sm transition-all duration-200 text-left"
        whileHover={{ scale: 1.001 }}
        whileTap={{ scale: 0.999 }}
      >
        <div className="flex items-start gap-4 px-5 py-4">
          {/* Minimal icon */}
          <div className="flex-shrink-0 pt-0.5">
            <MapPin className="w-5 h-5 text-slate-400 group-hover:text-slate-600 transition-colors" strokeWidth={1.5} />
          </div>
          
          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-slate-900 mb-1 text-sm">
              Default Map Location
            </div>
            <div className="text-xs text-slate-500 mb-3">
              Choose where the map opens when you first view it
            </div>
            {savedLocation && (
              <div className="text-sm text-slate-600 font-normal">
                {savedLocation}
              </div>
            )}
          </div>
          
          {/* Subtle arrow */}
          <div className="flex-shrink-0 text-slate-300 group-hover:text-slate-400 transition-colors pt-0.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </motion.button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0">
          <DialogHeader className="px-6 pt-6 pb-5 border-b border-slate-100">
            <DialogTitle className="text-xl font-semibold text-slate-900 tracking-tight">Set Default Map Location</DialogTitle>
          </DialogHeader>

          <div className="px-6 py-5 space-y-5">
            {/* Location Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Search Location</label>
              <input
                type="text"
                value={locationInput}
                onChange={(e) => {
                  setLocationInput(e.target.value);
                  setGeocodeError('');
                }}
                placeholder="Search for a location..."
                className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 text-slate-900 placeholder:text-slate-400 transition-all duration-200 bg-white"
              />
              {isGeocoding && (
                <p className="text-xs text-slate-500 flex items-center gap-1.5">
                  <span className="inline-block w-1 h-1 bg-slate-400 rounded-full animate-pulse" />
                  Searching...
                </p>
              )}
              {geocodeError && (
                <p className="text-xs text-red-600 flex items-center gap-1.5">
                  <span className="inline-block w-1 h-1 bg-red-500 rounded-full" />
                  {geocodeError}
                </p>
              )}
            </div>

            {/* Map Preview */}
            <div className="space-y-2.5">
              <label className="text-sm font-medium text-slate-700">Map Preview</label>
              <div 
                className="w-full h-96 rounded-xl border border-slate-200 overflow-hidden bg-slate-50 relative shadow-sm"
                style={{ minHeight: '384px', width: '100%' }}
              >
                {/* Map Container */}
                <div 
                  ref={mapContainer}
                  className="w-full h-full"
                  style={{ position: 'relative', zIndex: 1, pointerEvents: 'auto' }}
                />
                
                {/* Refined Border Frame Overlay */}
                <div 
                  className="absolute pointer-events-none z-10 border-2 border-slate-300/50 border-dashed rounded-lg" 
                  style={{
                    top: '24px',
                    left: '24px',
                    right: '24px',
                    bottom: '24px',
                  }}
                />
              </div>
            </div>

            {/* Selected Location Display - Simplified */}
            {selectedLocationName && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <div className="text-sm font-medium text-slate-900 leading-relaxed">{selectedLocationName}</div>
              </div>
            )}
          </div>

          <DialogFooter className="px-6 py-4 border-t border-slate-100 bg-slate-50/50">
            <div className="flex items-center justify-between w-full">
              <Button
                variant="outline"
                onClick={() => setIsOpen(false)}
                className="border-slate-200 text-slate-700 hover:bg-white hover:border-slate-300 font-medium"
              >
                Cancel
              </Button>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
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
                  className="border-slate-200 text-slate-700 hover:bg-white hover:border-slate-300 font-medium"
                >
                  Adjust Zoom & Preview
                </Button>
                <Button
                  onClick={handleConfirm}
                  disabled={!selectedCoordinates}
                  className="bg-slate-900 hover:bg-slate-800 text-white disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-sm min-w-[140px]"
                >
                  Confirm Location
                </Button>
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
              backgroundColor: '#f1f5f9', // slate-100 - ensure full coverage
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
              <div className="bg-slate-900 text-white px-4 py-2 rounded-full text-xs font-semibold tracking-wide shadow-lg backdrop-blur-sm bg-opacity-90">
                Preview Mode
              </div>
            </div>

            {/* Preview Mode Overlay Frame - with proper padding from screen edges */}
            <div 
              className="absolute pointer-events-none z-[10002] border-2 border-slate-400/70 border-dashed rounded-lg" 
              style={{
                top: '80px', // Padding below Preview Mode label
                left: '48px', // Increased padding from left edge (after collapsed sidebar)
                right: '48px', // Increased padding from right edge
                bottom: '80px', // Enough space above buttons to see the border
                boxShadow: '0 0 0 1px rgba(148, 163, 184, 0.2)'
              }}
            />

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
            


            {/* Buttons - Inside dotted lines, positioned appropriately */}
            <div 
              className="absolute z-[10001] flex gap-3"
              style={{
                bottom: '96px', // Positioned above the bottom border with spacing
                right: '64px' // Aligned with right border padding
              }}
            >
              <Button
                variant="outline"
                onClick={() => {
                  setIsPreviewMode(false);
                  // Restore sidebar state
                  if (onRestoreSidebarState && sidebarStateBeforePreviewRef.current !== null) {
                    onRestoreSidebarState(sidebarStateBeforePreviewRef.current);
                    sidebarStateBeforePreviewRef.current = null;
                  }
                }}
                className="px-4 py-2 h-auto bg-white hover:bg-slate-50 border-slate-200 text-slate-700 shadow-sm backdrop-blur-sm font-medium"
              >
                Back
              </Button>
              <Button
                onClick={() => {
                  handleConfirm();
                  // Restore sidebar state after confirming
                  if (onRestoreSidebarState && sidebarStateBeforePreviewRef.current !== null) {
                    onRestoreSidebarState(sidebarStateBeforePreviewRef.current);
                    sidebarStateBeforePreviewRef.current = null;
                  }
                }}
                className="px-4 py-2 h-auto bg-slate-900 hover:bg-slate-800 text-white shadow-sm font-medium min-w-[140px]"
              >
                Confirm Location
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

// Settings View Component with Sidebar Navigation
const SettingsView: React.FC<{ 
  onCloseSidebar?: () => void;
  onRestoreSidebarState?: (shouldBeCollapsed: boolean) => void;
  getSidebarState?: () => boolean;
}> = ({ onCloseSidebar, onRestoreSidebarState, getSidebarState }) => {
  const [activeCategory, setActiveCategory] = React.useState<string>('appearance');
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
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'map-settings', label: 'Map Settings', icon: MapPin },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'privacy', label: 'Privacy', icon: Shield },
    { id: 'language', label: 'Language & Region', icon: Globe },
    { id: 'display', label: 'Display', icon: Monitor },
  ];

  const renderSettingsContent = () => {
    switch (activeCategory) {
      case 'map-settings':
        return (
          <div className="space-y-6">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-slate-900 tracking-tight">Map Settings</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
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
      case 'appearance':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold text-slate-800 mb-2">Appearance</h3>
              <p className="text-sm text-slate-600">
                Customize the look and feel of Velora.
              </p>
            </div>
            <div className="text-slate-500 text-sm">
              Appearance settings coming soon...
            </div>
          </div>
        );
      case 'notifications':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold text-slate-800 mb-2">Notifications</h3>
              <p className="text-sm text-slate-600">
                Manage your notification preferences.
              </p>
            </div>
            <div className="text-slate-500 text-sm">
              Notification settings coming soon...
            </div>
          </div>
        );
      case 'privacy':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold text-slate-800 mb-2">Privacy</h3>
              <p className="text-sm text-slate-600">
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
              <h3 className="text-xl font-semibold text-slate-800 mb-2">Language & Region</h3>
              <p className="text-sm text-slate-600">
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
              <h3 className="text-xl font-semibold text-slate-800 mb-2">Display</h3>
              <p className="text-sm text-slate-600">
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
      {/* Settings Sidebar */}
      <div className="w-64 border-r border-slate-200 bg-white">
        <div className="p-6 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Settings</h2>
          <p className="text-sm text-slate-500 mt-1">Manage your preferences</p>
        </div>
        <nav className="p-4 space-y-1">
          {settingsCategories.map((category) => {
            const Icon = category.icon;
            const isActive = activeCategory === category.id;
            return (
              <motion.button
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Icon className="w-4 h-4" />
                <span>{category.label}</span>
              </motion.button>
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
  isSidebarCollapsed = false
}: MainContentProps) => {
  const { addActivity } = useSystem();
  const [chatQuery, setChatQuery] = React.useState<string>("");
  const [chatMessages, setChatMessages] = React.useState<any[]>([]);
  const [resetTrigger, setResetTrigger] = React.useState<number>(0);
  const [currentLocation, setCurrentLocation] = React.useState<string>("");
  const [isMapVisible, setIsMapVisible] = React.useState<boolean>(false);
  const [mapSearchQuery, setMapSearchQuery] = React.useState<string>("");
  const [hasPerformedSearch, setHasPerformedSearch] = React.useState<boolean>(false);
  const [userData, setUserData] = React.useState<any>(null);
  const mapRef = React.useRef<SquareMapRef>(null);
  
  // Use shared preview context
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
  
  // Use the prop value for chat mode
  const isInChatMode = inChatMode;

  // Preload properties on mount (Instagram-style preloading)
  // This ensures properties are ready when user clicks a project or starts a search
  React.useEffect(() => {
    const preloadProperties = async () => {
      try {
        console.log('🚀 Preloading properties on dashboard load...');
        // Try to fetch properties - if backend isn't ready, it will fail gracefully
        const allPropertyHubs = await backendApi.getAllPropertyHubs();
          
          if (allPropertyHubs && Array.isArray(allPropertyHubs)) {
            // Transform property hub data to match expected format
            const transformedProperties = allPropertyHubs.map((hub: any) => {
              const property = hub.property || {};
              const propertyDetails = hub.property_details || {};
              const documents = hub.documents || [];
              
              return {
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
            });
            
            // Store preloaded properties in a global variable for SquareMap to access
            (window as any).__preloadedProperties = transformedProperties;
            console.log(`✅ Preloaded ${transformedProperties.length} properties - ready for instant access`);
          }
        } catch (error) {
          console.error('❌ Error preloading properties:', error);
        }
      };
      
      preloadProperties();
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
    console.log('🗺️ MainContent handleMapToggle called!', { 
      currentState: isMapVisible,
      willChangeTo: !isMapVisible 
    });
    setIsMapVisible(prev => !prev);
  };

  const handleQueryStart = (query: string) => {
    console.log('MainContent: Query started with:', query);
    
    // Track search activity but DON'T create chat history yet
    addActivity({
      action: `User initiated search: "${query}"`,
      documents: [],
      type: 'search',
      details: { searchTerm: query, timestamp: new Date().toISOString() }
    });
    
    // Don't create chat history until query is actually submitted
  };

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
    console.log('MainContent: Search submitted with query:', query);
    
    // Always update map search query
    setMapSearchQuery(query);
    
    // If map is visible, only search on the map, don't enter chat
    if (isMapVisible) {
      console.log('Map search only - not entering chat mode');
      // Mark that user has performed a search in map mode
      setHasPerformedSearch(true);
      return;
    }
    
    // Normal chat search when map is not visible
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
  
  // Reset chat mode and map visibility when currentView changes (sidebar navigation)
  // IMPORTANT: This should ONLY trigger on actual navigation, NOT on sidebar toggle
  React.useEffect(() => {
    const prevView = prevViewRef.current;
    const isActualNavigation = prevView !== currentView;
    prevViewRef.current = currentView;
    
    // Only reset if we're actually navigating to a different view
    // Don't reset if we're already on search view (e.g., just toggling sidebar)
    if (currentView !== 'search' && currentView !== 'home') {
      setChatQuery("");
      setChatMessages([]);
      // Let the parent handle chat mode changes
      onChatModeChange?.(false);
    }
    // When navigating to search view (via home button), hide the map
    // BUT: Only hide map if we're actually navigating FROM a different view
    // Don't hide map if we're already on search view (e.g., just toggling sidebar)
    // This prevents the map from being hidden when just toggling the sidebar
    if (currentView === 'search' && isActualNavigation && prevView !== 'search') {
      // Only hide map if we're actually navigating FROM a different view TO search
      // This prevents hiding the map when just toggling sidebar on map view
      setIsMapVisible(false);
      setMapSearchQuery("");
      setHasPerformedSearch(false);
    }
  }, [currentView, onChatModeChange]);

  // Special handling for home view - reset everything to default state
  React.useEffect(() => {
    if (homeClicked) {
      console.log('🏠 Home clicked - resetting map and state');
      setChatQuery("");
      setChatMessages([]);
      setCurrentLocation("");
      setIsMapVisible(false); // Explicitly hide map when home is clicked
      setMapSearchQuery("");
      setHasPerformedSearch(false);
      onChatModeChange?.(false);
      onHomeResetComplete?.(); // Notify parent that reset is complete
    }
  }, [homeClicked, onChatModeChange, onHomeResetComplete]);

  // Reset SearchBar when switching to chat mode or creating new chat
  React.useEffect(() => {
    if (isInChatMode && currentChatData?.query) {
      setResetTrigger(prev => prev + 1);
    }
  }, [isInChatMode, currentChatData]);

  // Reset from parent trigger (new chat created)
  React.useEffect(() => {
    if (parentResetTrigger !== undefined) {
      setResetTrigger(prev => prev + 1);
    }
  }, [parentResetTrigger]);

  // Debug: Log ChatInterface ref when it changes
  React.useEffect(() => {
    const hasRef = !!chatInterfaceRef.current;
    console.log('🔍 ChatInterface ref status:', { 
      hasRef,
      currentChatId,
      isInChatMode,
      refValue: chatInterfaceRef.current
    });
    if (hasRef) {
      console.log('✅ ChatInterface ref is available!');
    } else {
      console.log('❌ ChatInterface ref is NOT available');
    }
  }, [currentChatId, isInChatMode]);

  // Debug: Log SearchBar ref when it changes
  React.useEffect(() => {
    const hasRef = !!searchBarRef.current;
    console.log('🔍 SearchBar ref status:', { 
      hasRef,
      currentView,
      isInChatMode,
      refValue: searchBarRef.current
    });
    if (hasRef) {
      console.log('✅ SearchBar ref is available!');
    } else {
      console.log('❌ SearchBar ref is NOT available');
    }
  }, [currentView, isInChatMode]);
  const renderViewContent = () => {
    switch (currentView) {
      case 'home':
      case 'search':
        return <AnimatePresence mode="wait">
            {isInChatMode ? <motion.div key="chat" initial={{
            opacity: 0
          }} animate={{
            opacity: 1
          }} exit={{
            opacity: 0
          }} transition={{
            duration: 0.3,
            ease: [0.23, 1, 0.32, 1]
          }} className="w-full h-full flex flex-col relative">
                {/* Interactive Dot Grid Background for chat mode */}
                {/* No background needed here as it's handled globally */}
                
                
                 {/* Chat Interface with elevated z-index */}
                <div className="relative z-10 w-full h-full" data-chat-container="true">
                  <div
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className="w-full h-full"
                    data-chat-wrapper="true"
                  >
                  <ChatInterface 
                      ref={chatInterfaceRefCallback}
                    key={`chat-${currentChatId || 'new'}`}
                    initialQuery={currentChatData?.query || ""} 
                    onBack={handleBackToSearch} 
                    onMessagesUpdate={handleChatMessagesUpdate}
                    loadedMessages={currentChatData?.messages}
                    isFromHistory={currentChatData?.isFromHistory}
                  />
                  </div>
                </div>
              </motion.div> : <motion.div key="search" initial={{
            opacity: 0
          }} animate={{
            opacity: 1
          }} exit={{
            opacity: 0
          }} transition={{
            duration: 0.3,
            ease: [0.23, 1, 0.32, 1]
          }} className="flex flex-col items-center justify-center flex-1 relative h-full">
                {/* Interactive Dot Grid Background */}
                {/* No background needed here as it's handled globally */}
                
                {/* Centered Content Container - Vertically and Horizontally Centered */}
                <div className="flex flex-col items-center justify-center w-full max-w-6xl mx-auto px-4">
                  {/* VELORA Branding Section */}
                  <div className="flex flex-col items-center mb-16">
                    {/* VELORA Logo */}
                    <img 
                      src="/VELORA%20LOGO%20%E2%80%93%201.png" 
                      alt="VELORA" 
                      className="max-w-[280px] h-auto mb-8"
                      style={{ maxHeight: '120px' }}
                      onLoad={() => {
                        console.log('✅ VELORA logo loaded successfully');
                      }}
                      onError={(e) => {
                        console.error('❌ VELORA logo failed to load:', e.currentTarget.src);
                      }}
                    />
                    
                    {/* Dynamic Welcome Message */}
                    {(() => {
                      const getUserName = () => {
                        if (userData?.first_name) {
                          return userData.first_name;
                        }
                        if (userData?.email) {
                          // Extract name from email (e.g., "user@example.com" → "user")
                          const emailPrefix = userData.email.split('@')[0];
                          // Capitalize first letter
                          return emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
                        }
                        return '';
                      };
                      const userName = getUserName();
                      return userName ? (
                        <p className="text-gray-400 text-base font-light mb-0 text-center tracking-wide leading-relaxed max-w-2xl px-4">
                          Welcome back <span className="font-normal text-gray-500">{userName}</span>, your workspace is synced and ready for your next move
                        </p>
                      ) : (
                        <p className="text-gray-400 text-base font-light mb-0 text-center tracking-wide leading-relaxed max-w-2xl px-4">
                          Welcome back, your workspace is synced and ready for your next move
                        </p>
                      );
                    })()}
                  </div>
                  
                  {/* Recent Projects Section */}
                  <div className="w-full mb-8">
                    <RecentProjectsSection 
                      onOpenProperty={(address, coordinates, propertyId) => {
                        console.log('🖱️ Project card clicked:', { address, coordinates, propertyId });
                        
                        // Open map mode
                        setIsMapVisible(true);
                        
                        // Skip address search when we have a propertyId to avoid geocoding conflicts
                        // The property will be found by ID instead, which is more reliable
                        if (!propertyId) {
                          setMapSearchQuery(address);
                          setHasPerformedSearch(true);
                        }
                        
                        // Store selection for when map is ready
                        (window as any).__pendingPropertySelection = { address, coordinates, propertyId };
                        
                        // Single attempt after map has time to initialize
                        // Use a single delay to ensure smooth transition
                        setTimeout(() => {
                          if (mapRef.current) {
                            console.log('✅ Selecting property after map initialization');
                            mapRef.current.selectPropertyByAddress(address, coordinates, propertyId);
                          }
                        }, 500);
                      }}
                    />
                  </div>
                  
                  {/* Unified Search Bar - adapts based on context */}
                  <div className="w-full flex justify-center items-center">
                    <SearchBar 
                      onSearch={handleSearch} 
                      onQueryStart={handleQueryStart} 
                      onMapToggle={handleMapToggle}
                      resetTrigger={resetTrigger}
                      isMapVisible={isMapVisible}
                      isInChatMode={isInChatMode}
                      currentView={currentView}
                      hasPerformedSearch={hasPerformedSearch}
                      isSidebarCollapsed={isSidebarCollapsed}
                    />
                  </div>
                </div>
                
                {/* Full Screen Map */}
                <SquareMap
                  ref={mapRef}
                  isVisible={isMapVisible}
                  searchQuery={mapSearchQuery}
                  hasPerformedSearch={hasPerformedSearch}
                  isInChatMode={isInChatMode}
                  onLocationUpdate={(location) => {
                    setCurrentLocation(location.address);
                  }}
                />
              </motion.div>}
          </AnimatePresence>;
      case 'notifications':
        return <div className="w-full h-full max-w-none m-0 p-0">
            <FileManager />
          </div>;
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
            <SearchBar 
              ref={searchBarRefCallback}
              onSearch={handleSearch} 
              onQueryStart={handleQueryStart} 
              onMapToggle={handleMapToggle}
              resetTrigger={resetTrigger}
              isMapVisible={isMapVisible}
              isInChatMode={isInChatMode}
              currentView={currentView}
              hasPerformedSearch={hasPerformedSearch}
              onFileDrop={(file) => {
                console.log('📎 MainContent: onFileDrop prop called for SearchBar with file:', file.name);
                // This will be handled by SearchBar's handleFileUpload
                // The prop is just for notification - SearchBar handles the file internally
              }}
            />
          </div>;
    }
  };
  // Drag and drop state
  const [isDragging, setIsDragging] = React.useState(false);
  const [dragCounter, setDragCounter] = React.useState(0);
  const searchBarRef = React.useRef<{ handleFileDrop: (file: File) => void } | null>(null);
  const chatInterfaceRef = React.useRef<{ handleFileDrop: (file: File) => void } | null>(null);
  const pendingFileDropRef = React.useRef<File | null>(null);
  const [refsReady, setRefsReady] = React.useState(false);
  
  // File drop handler - can be passed directly to components
  const handleFileDropToComponent = React.useCallback((file: File) => {
    console.log('📎 MainContent: handleFileDropToComponent called with file:', file.name);
    // This will be passed to SearchBar and ChatInterface as onFileDrop prop
    // They can use it directly instead of relying on refs
  }, []);
  
  // Memoize ref callbacks to ensure they're stable across renders
  const searchBarRefCallback = React.useCallback((instance: { handleFileDrop: (file: File) => void } | null) => {
    console.log('🔗 SearchBar ref callback called with:', instance);
    searchBarRef.current = instance;
    // Update state to trigger pending file processing
    setRefsReady(prev => {
      const newReady = !!instance || !!chatInterfaceRef.current;
      console.log('🔗 SearchBar ref ready state:', { instance: !!instance, chatRef: !!chatInterfaceRef.current, newReady });
      return newReady;
    });
  }, []);
  
  const chatInterfaceRefCallback = React.useCallback((instance: { handleFileDrop: (file: File) => void } | null) => {
    console.log('🔗 ChatInterface ref callback called with:', instance);
    chatInterfaceRef.current = instance;
    // Update state to trigger pending file processing
    setRefsReady(prev => {
      const newReady = !!instance || !!searchBarRef.current;
      console.log('🔗 ChatInterface ref ready state:', { instance: !!instance, searchRef: !!searchBarRef.current, newReady });
      return newReady;
    });
  }, []);

  // Drag and drop handlers
  const handleDragEnter = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Only process file drags
    if (!e.dataTransfer.types.includes('Files')) {
      return;
    }
    
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
    e.preventDefault();
    e.stopPropagation();
    
    // Check if we're actually leaving the main container
    // by checking if the related target is outside
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    
    // Only decrement if we're actually leaving the container bounds
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
    setDragCounter(prev => {
        const newCount = Math.max(0, prev - 1);
      if (newCount === 0) {
        setIsDragging(false);
      }
      return newCount;
    });
    }
  }, []);

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Ensure dragging state is maintained while dragging over
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
      // Keep dragging state active while over the area
      setIsDragging(true);
    }
  }, []);

  const handleDrop = React.useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setDragCounter(0);

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
            
            // Pass to chat or search bar - check mode first, then refs
            if (isInChatMode && chatInterfaceRef.current) {
              console.log('📤 Passing property document to ChatInterface');
              try {
                chatInterfaceRef.current.handleFileDrop(file);
                console.log('✅ Property document successfully passed to ChatInterface');
              } catch (err) {
                console.error('❌ Error passing file to ChatInterface:', err);
                // Fallback: store for later
                pendingFileDropRef.current = file;
                setHasPendingFile(true);
              }
            } else if (!isInChatMode && searchBarRef.current) {
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
              console.log('📦 Storing property document for later (refs not ready)', {
                isInChatMode,
                hasChatRef: !!chatInterfaceRef.current,
                hasSearchRef: !!searchBarRef.current
              });
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
      console.log('📁 File dropped:', file.name);
      console.log('📊 Drop context:', {
        isInChatMode,
        currentView,
        hasChatRef: !!chatInterfaceRef.current,
        hasSearchRef: !!searchBarRef.current,
        chatRefValue: chatInterfaceRef.current,
        searchRefValue: searchBarRef.current
      });
      
      // Try to pass file directly via refs first
      if (chatInterfaceRef.current) {
        console.log('📤 Passing file to ChatInterface (via ref)');
        chatInterfaceRef.current.handleFileDrop(file);
      } else if (searchBarRef.current) {
        console.log('📤 Passing file to SearchBar (via ref)');
        searchBarRef.current.handleFileDrop(file);
      } else {
        // Fallback: Try to trigger file upload via the file input element
        // This works by finding the hidden file input and programmatically triggering it
        console.warn('⚠️ No valid ref found, trying direct file input approach');
        console.warn('⚠️ Details:', {
          isInChatMode,
          currentView,
          hasChatRef: !!chatInterfaceRef.current,
          hasSearchRef: !!searchBarRef.current
        });
        
        // Find the file input in the currently visible component (SearchBar or ChatInterface)
        const fileInputs = document.querySelectorAll('input[type="file"]');
        let targetInput: HTMLInputElement | null = null;
        
        // Prefer the input in the active component
        if (isInChatMode) {
          // Look for input in ChatInterface
          const chatContainer = document.querySelector('[class*="ChatInterface"]') || 
                                document.querySelector('[class*="chat"]');
          if (chatContainer) {
            targetInput = chatContainer.querySelector('input[type="file"]') as HTMLInputElement;
          }
        } else {
          // Look for input in SearchBar
          const searchContainer = document.querySelector('[class*="SearchBar"]') ||
                                  document.querySelector('form');
          if (searchContainer) {
            targetInput = searchContainer.querySelector('input[type="file"]') as HTMLInputElement;
          }
        }
        
        // Fallback to first available file input
        if (!targetInput && fileInputs.length > 0) {
          targetInput = fileInputs[0] as HTMLInputElement;
        }
        
        if (targetInput) {
          console.log('📤 Found file input, triggering upload via DataTransfer');
          try {
            // Create a new FileList with the dropped file using DataTransfer
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            targetInput.files = dataTransfer.files;
            
            // Trigger change event to notify the component
            const changeEvent = new Event('change', { bubbles: true });
            targetInput.dispatchEvent(changeEvent);
            console.log('✅ File input change event dispatched');
          } catch (error) {
            console.error('❌ Error triggering file input:', error);
            // Store as pending if direct approach fails
            pendingFileDropRef.current = file;
            setHasPendingFile(true);
          }
        } else {
          console.warn('⚠️ No file input found, storing as pending');
          pendingFileDropRef.current = file;
          setHasPendingFile(true);
        }
      }
    }
  }, [currentView, isInChatMode]);

  // Poll for refs to become available (fallback mechanism)
  const [hasPendingFile, setHasPendingFile] = React.useState(false);
  
  // Process pending file drop when refs become available
  React.useEffect(() => {
    if (pendingFileDropRef.current && (chatInterfaceRef.current || searchBarRef.current)) {
      const pendingFile = pendingFileDropRef.current;
      console.log('🔄 Processing pending file drop:', pendingFile.name, { 
        refsReady, 
        hasChatRef: !!chatInterfaceRef.current, 
        hasSearchRef: !!searchBarRef.current,
        isInChatMode,
        currentView
      });
      
      // Check mode first, then appropriate ref
      if (isInChatMode && chatInterfaceRef.current) {
        console.log('📤 Processing pending file in ChatInterface');
        try {
          chatInterfaceRef.current.handleFileDrop(pendingFile);
          pendingFileDropRef.current = null;
          setHasPendingFile(false);
          console.log('✅ Pending file successfully processed in ChatInterface');
        } catch (err) {
          console.error('❌ Error processing pending file in ChatInterface:', err);
        }
      } else if (!isInChatMode && searchBarRef.current) {
        console.log('📤 Processing pending file in SearchBar');
        try {
          searchBarRef.current.handleFileDrop(pendingFile);
          pendingFileDropRef.current = null;
          setHasPendingFile(false);
          console.log('✅ Pending file successfully processed in SearchBar');
        } catch (err) {
          console.error('❌ Error processing pending file in SearchBar:', err);
        }
      } else if (chatInterfaceRef.current) {
        // Fallback: if chat ref is available, use it
        console.log('📤 Processing pending file in ChatInterface (fallback)');
        try {
          chatInterfaceRef.current.handleFileDrop(pendingFile);
          pendingFileDropRef.current = null;
          setHasPendingFile(false);
          console.log('✅ Pending file successfully processed in ChatInterface (fallback)');
        } catch (err) {
          console.error('❌ Error processing pending file in ChatInterface (fallback):', err);
        }
      } else if (searchBarRef.current) {
        // Fallback: if search ref is available, use it
        console.log('📤 Processing pending file in SearchBar (fallback)');
        try {
          searchBarRef.current.handleFileDrop(pendingFile);
          pendingFileDropRef.current = null;
          setHasPendingFile(false);
          console.log('✅ Pending file successfully processed in SearchBar (fallback)');
        } catch (err) {
          console.error('❌ Error processing pending file in SearchBar (fallback):', err);
        }
      }
    }
  }, [refsReady, isInChatMode, currentView, hasPendingFile]);
  
  React.useEffect(() => {
    if (hasPendingFile && pendingFileDropRef.current) {
      console.log('🔄 Starting polling for pending file:', pendingFileDropRef.current.name);
      
      const interval = setInterval(() => {
        const pendingFile = pendingFileDropRef.current;
        if (!pendingFile) {
          console.log('✅ Pending file cleared, stopping polling');
          setHasPendingFile(false);
          clearInterval(interval);
          return;
        }
        
        console.log('🔄 Polling for refs:', { 
          hasChatRef: !!chatInterfaceRef.current, 
          hasSearchRef: !!searchBarRef.current,
          isInChatMode,
          currentView
        });
        
        // Check mode first, then appropriate ref
        if (isInChatMode && chatInterfaceRef.current) {
          console.log('📤 Processing pending file in ChatInterface (via polling)');
          try {
            chatInterfaceRef.current.handleFileDrop(pendingFile);
            pendingFileDropRef.current = null;
            setHasPendingFile(false);
            clearInterval(interval);
            console.log('✅ Pending file successfully processed in ChatInterface');
          } catch (err) {
            console.error('❌ Error processing pending file in ChatInterface:', err);
          }
        } else if (!isInChatMode && searchBarRef.current) {
          console.log('📤 Processing pending file in SearchBar (via polling)');
          try {
            searchBarRef.current.handleFileDrop(pendingFile);
            pendingFileDropRef.current = null;
            setHasPendingFile(false);
            clearInterval(interval);
            console.log('✅ Pending file successfully processed in SearchBar');
          } catch (err) {
            console.error('❌ Error processing pending file in SearchBar:', err);
          }
        } else if (chatInterfaceRef.current) {
          // Fallback: if chat ref is available, use it
          console.log('📤 Processing pending file in ChatInterface (fallback)');
          try {
            chatInterfaceRef.current.handleFileDrop(pendingFile);
            pendingFileDropRef.current = null;
            setHasPendingFile(false);
            clearInterval(interval);
            console.log('✅ Pending file successfully processed in ChatInterface (fallback)');
          } catch (err) {
            console.error('❌ Error processing pending file in ChatInterface (fallback):', err);
          }
        } else if (searchBarRef.current) {
          // Fallback: if search ref is available, use it
          console.log('📤 Processing pending file in SearchBar (fallback)');
          try {
            searchBarRef.current.handleFileDrop(pendingFile);
            pendingFileDropRef.current = null;
            setHasPendingFile(false);
            clearInterval(interval);
            console.log('✅ Pending file successfully processed in SearchBar (fallback)');
          } catch (err) {
            console.error('❌ Error processing pending file in SearchBar (fallback):', err);
          }
        }
      }, 100); // Check every 100ms
      
      // Clear interval after 5 seconds to avoid infinite polling
      const timeout = setTimeout(() => {
        clearInterval(interval);
        if (pendingFileDropRef.current) {
          console.warn('⚠️ Pending file drop timed out after 5 seconds:', pendingFileDropRef.current.name);
          pendingFileDropRef.current = null;
          setHasPendingFile(false);
        }
      }, 5000);
      
      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    }
  }, [hasPendingFile, isInChatMode, currentView]);

  // Calculate left margin based on sidebar state
  // Sidebar is w-10 lg:w-14 (40px/56px) when expanded, w-2 (8px) when collapsed
  const leftMargin = isSidebarCollapsed ? 'ml-2' : 'ml-10 lg:ml-14';
  
  return <div 
    className={`flex-1 relative bg-white ${leftMargin} ${className || ''}`} 
    style={{ backgroundColor: '#ffffff', position: 'relative', zIndex: 1 }}
    onDragEnter={handleDragEnter}
    onDragOver={handleDragOver}
    onDragLeave={handleDragLeave}
    onDrop={handleDrop}
  >
      {/* Background based on current view - Hidden to show white background */}
      {/* Background components commented out to show white background */}
      
      {/* Content container - white background */}
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
                  : 'bg-white'
      } ${isInChatMode ? 'p-0' : currentView === 'upload' ? 'p-8' : currentView === 'analytics' ? 'p-4' : currentView === 'profile' ? 'p-0' : currentView === 'notifications' ? 'p-0 m-0' : 'p-8 lg:p-16'}`} style={{ backgroundColor: '#ffffff' }}>
        <div className={`relative w-full ${
          isInChatMode 
            ? 'h-full w-full' 
            : currentView === 'upload' ? 'h-full' 
            : currentView === 'analytics' ? 'h-full overflow-hidden'
            : currentView === 'profile' ? 'h-full w-full'
            : currentView === 'notifications' ? 'h-full w-full'
            : 'max-w-5xl mx-auto'
        } flex-1 flex flex-col`}>
          <motion.div initial={{
          opacity: 1,
          y: 20
        }} animate={{
          opacity: 1,
          y: 0
        }} transition={{
          duration: 0.6,
          ease: [0.23, 1, 0.32, 1],
          delay: 0.1
        }} className={`relative flex-1 flex flex-col overflow-visible`}>{renderViewContent()}
          </motion.div>
        </div>
      </div>
      
      {/* Search Bar positioning is now handled internally by the SearchBar component */}
      
      {/* Shared Document Preview Modal - used by SearchBar, ChatInterface, and PropertyFilesModal */}
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
      />
      
      {/* Drag and Drop Overlay - Full Screen */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-white"
            style={{ 
              pointerEvents: 'none',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: '100vw',
              height: '100vh'
            }}
          >
            {/* Large container for upload icon */}
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              className="relative"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {/* Upload Icon - CloudUpload from Lucide */}
              <div className="flex flex-col items-center justify-center">
                <motion.div
                  initial={{ y: -6, opacity: 0, scale: 0.9 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  exit={{ y: -6, opacity: 0, scale: 0.9 }}
                  transition={{ delay: 0.1, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
                  className="relative"
                >
                  <CloudUpload
                    size={72}
                    strokeWidth={2}
                    className="text-gray-500 drop-shadow-sm"
                  />
                </motion.div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>;
  };
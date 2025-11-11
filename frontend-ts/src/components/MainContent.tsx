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
import { MapPin, Palette, Bell, Shield, Globe, Monitor, LayoutDashboard, Upload, BarChart3, Database, Settings, User } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

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
}> = ({ savedLocation, onLocationSaved, onCloseSidebar }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [isPreviewMode, setIsPreviewMode] = React.useState(false);
  const [locationInput, setLocationInput] = React.useState<string>('');
  // Always initialize with a default location so map always shows
  const getDefaultCoordinates = (): [number, number] => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(DEFAULT_MAP_LOCATION_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.coordinates && Array.isArray(parsed.coordinates) && parsed.coordinates.length === 2) {
            return parsed.coordinates as [number, number];
          }
        } catch {}
      }
    }
    return [-0.1276, 51.5074] as [number, number]; // Default to London
  };
  const [selectedCoordinates, setSelectedCoordinates] = React.useState<[number, number]>(getDefaultCoordinates());
  const [selectedLocationName, setSelectedLocationName] = React.useState<string>('');
  const getDefaultZoom = (): number => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(DEFAULT_MAP_LOCATION_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.zoom && typeof parsed.zoom === 'number') {
            return parsed.zoom;
          }
        } catch {}
      }
    }
    return 9.5;
  };
  const [selectedZoom, setSelectedZoom] = React.useState<number>(getDefaultZoom());
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

  // Track if location data is ready to prevent race conditions
  const [isLocationDataReady, setIsLocationDataReady] = React.useState(false);

  // Reload saved location when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setIsLocationDataReady(false);
      // Get the latest saved location from localStorage
      const getSavedLocation = async () => {
        if (typeof window !== 'undefined') {
          const saved = localStorage.getItem(DEFAULT_MAP_LOCATION_KEY);
          if (saved) {
            try {
              const parsed = JSON.parse(saved);
              if (parsed.coordinates && Array.isArray(parsed.coordinates) && parsed.coordinates.length === 2) {
                let locationName = parsed.name || '';
                
                // If name is missing but coordinates exist, try reverse geocoding
                if (!locationName && parsed.coordinates) {
                  try {
                    const reverseGeocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${parsed.coordinates[0]},${parsed.coordinates[1]}.json?access_token=${mapboxToken}&limit=1`;
                    const response = await fetch(reverseGeocodeUrl);
                    if (response.ok) {
                      const data = await response.json();
                      if (data.features && data.features.length > 0) {
                        locationName = data.features[0].place_name;
                      }
                    }
                  } catch (error) {
                    console.warn('Reverse geocoding failed for saved location:', error);
                    // Fallback to coordinates if reverse geocoding fails
                    locationName = `${parsed.coordinates[1].toFixed(4)}, ${parsed.coordinates[0].toFixed(4)}`;
                  }
                }
                
                return {
                  coordinates: parsed.coordinates as [number, number],
                  zoom: parsed.zoom || 9.5,
                  name: locationName
                };
              }
            } catch {}
          }
        }
        return {
          coordinates: [-0.1276, 51.5074] as [number, number],
          zoom: 9.5,
          name: 'London, UK'
        };
      };

      getSavedLocation().then((saved) => {
        setLocationInput(saved.name);
        setSelectedCoordinates(saved.coordinates);
        setSelectedLocationName(saved.name);
        setSelectedZoom(saved.zoom);
        setIsLocationDataReady(true);
        console.log('📍 LocationPicker: Loaded saved location on modal open', saved);
      });
    } else {
      setIsLocationDataReady(false);
    }
  }, [isOpen, mapboxToken]);

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

    if (!isOpen || !mapContainer.current) {
      console.log('📍 LocationPicker: Modal not open or container not ready', { isOpen, hasContainer: !!mapContainer.current });
      return;
    }

    // Wait for location data to be ready before initializing map
    // This ensures we use the latest saved location and prevents race conditions
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
          map.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/light-v11',
            center: initialCenter,
            zoom: initialZoom,
            attributionControl: false
          });

          console.log('✅ LocationPicker: Map instance created');

          // Store handlers for cleanup
          const handleMapLoad = () => {
            if (!map.current) return;

            console.log('✅ LocationPicker: Map loaded successfully');

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
            const { lng, lat } = e.lngLat;
            const coords: [number, number] = [lng, lat];
            setSelectedCoordinates(coords);
            
            // Reverse geocode to get location name
            reverseGeocode(lng, lat);
            
            // Don't update marker - using dotted border frame instead
            // if (marker.current) {
            //   marker.current.setLngLat(coords);
            // }
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
  React.useEffect(() => {
    if (!map.current || !isOpen) return;
    
    // Don't sync if map is not loaded yet
    if (!map.current.loaded()) {
      // Wait for map to load before syncing
      const handleLoad = () => {
        if (map.current && map.current.loaded()) {
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

      try {
        map.current.flyTo({
          center: selectedCoordinates,
          zoom: selectedZoom || 9.5,
          duration: 600
        });

        // Don't add marker - using dotted border frame instead
        // if (marker.current) {
        //   marker.current.setLngLat(selectedCoordinates);
        // } else {
        //   marker.current = new mapboxgl.Marker({ color: '#3b82f6' })
        //     .setLngLat(selectedCoordinates)
        //     .addTo(map.current);
        // }
        console.log('✅ LocationPicker: Map synced with coordinates');
      } catch (error) {
        console.error('❌ LocationPicker: Error syncing map:', error);
        // Retry after a delay
        setTimeout(syncMap, 500);
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
          setSelectedZoom(calculatedZoom);
        }
      }
    } catch (error) {
      console.error('Reverse geocoding failed:', error);
    }
  };

  const handleConfirm = () => {
    if (!selectedCoordinates) return;

    const locationData = {
      name: selectedLocationName || locationInput,
      coordinates: selectedCoordinates,
      zoom: selectedZoom
    };

    if (typeof window !== 'undefined') {
      localStorage.setItem(DEFAULT_MAP_LOCATION_KEY, JSON.stringify(locationData));
    }

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
      attributionControl: false
    });

    // Update zoom and location when map moves - pin stays centered visually
    const handleMoveEnd = () => {
      if (previewMap.current) {
        const currentZoom = previewMap.current.getZoom();
        setSelectedZoom(currentZoom);
        // Get center of viewport (where the pin is visually)
        const center = previewMap.current.getCenter();
        setSelectedCoordinates([center.lng, center.lat]);
        // Reverse geocode to update location name
        reverseGeocode(center.lng, center.lat);
      }
    };

    // Also update on move (not just moveend) for smoother updates
    const handleMove = () => {
      if (previewMap.current) {
        const center = previewMap.current.getCenter();
        setSelectedCoordinates([center.lng, center.lat]);
      }
    };

    previewMap.current.on('moveend', handleMoveEnd);
    previewMap.current.on('move', handleMove);

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
      if (previewMap.current) {
        previewMap.current.off('moveend', handleMoveEnd);
        previewMap.current.off('move', handleMove);
        previewMap.current.off('load', hideBranding);
        previewMap.current.remove();
        previewMap.current = null;
      }
      if (previewMarker.current) {
        previewMarker.current.remove();
        previewMarker.current = null;
      }
    };
  }, [isPreviewMode, mapboxToken, selectedCoordinates, selectedZoom]);

  return (
    <>
      <motion.button
        onClick={() => setIsOpen(true)}
        className="w-full px-4 py-3 border-2 border-dashed border-slate-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors text-left bg-white"
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="font-medium text-slate-700 mb-1">Set Default Map Location</div>
            <div className="text-sm text-slate-500">
              {savedLocation || 'Click to set location'}
            </div>
          </div>
          <MapPin className="w-5 h-5 text-slate-400 ml-4" />
        </div>
      </motion.button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Set Default Map Location</DialogTitle>
            <DialogDescription>
              Search for a location or click on the map to set where the map opens by default.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
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
                placeholder="e.g., London, Bristol, Manchester..."
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-700"
              />
              {isGeocoding && (
                <p className="text-xs text-slate-500">Searching...</p>
              )}
              {geocodeError && (
                <p className="text-xs text-red-600">{geocodeError}</p>
              )}
            </div>

            {/* Map Preview */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Map Preview</label>
              <div 
                className="w-full h-96 rounded-lg border border-slate-300 overflow-hidden bg-slate-100 relative"
                style={{ minHeight: '384px', width: '100%' }}
              >
                {/* Map Container */}
                <div 
                  ref={mapContainer}
                  className="w-full h-full"
                  style={{ position: 'relative' }}
                />
                
                {/* Dotted Border Frame Overlay - similar to fullscreen preview */}
                <div 
                  className="absolute pointer-events-none z-10 border-4 border-blue-400 border-dashed rounded-lg shadow-2xl" 
                  style={{
                    top: '20px',
                    left: '20px',
                    right: '20px',
                    bottom: '20px',
                    boxShadow: '0 0 0 4px rgba(59, 130, 246, 0.1), 0 0 40px rgba(59, 130, 246, 0.2)'
                  }}
                />
              </div>
              <p className="text-xs text-slate-500">
                Click on the map to set the location, or search above to find a place.
              </p>
            </div>

            {/* Selected Location Display */}
            {selectedLocationName && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="text-sm font-medium text-blue-900 mb-1">Selected Location:</div>
                <div className="text-sm text-blue-700">{selectedLocationName}</div>
                {selectedCoordinates && (
                  <div className="text-xs text-blue-600 mt-1">
                    Coordinates: {selectedCoordinates[1].toFixed(4)}, {selectedCoordinates[0].toFixed(4)}
                  </div>
                )}
                {selectedZoom && (
                  <div className="text-xs text-blue-600 mt-1">
                    Zoom Level: {selectedZoom.toFixed(1)}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setIsOpen(false);
                // Close sidebar when entering preview mode
                onCloseSidebar?.();
                setIsPreviewMode(true);
              }}
              className="mr-2"
            >
              Adjust Zoom & Preview
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!selectedCoordinates}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Confirm Location
            </Button>
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
            {/* Preview Mode Overlay Frame - equal padding on all sides, accounting for sidebar */}
            <div 
              className="absolute pointer-events-none z-[10002] border-4 border-blue-400 border-dashed rounded-lg shadow-2xl" 
              style={{
                top: '80px', // Below top buttons and "Preview Mode" label (equal padding)
                left: '72px', // After sidebar (56px) + padding (16px) = 72px from left edge
                right: '72px', // Equal padding from right edge (matches left)
                bottom: '80px', // Equal padding on bottom (matches top)
                boxShadow: '0 0 0 4px rgba(59, 130, 246, 0.1), 0 0 40px rgba(59, 130, 246, 0.2)'
              }}
            />
            
            {/* Preview Mode Label */}
            <div className="absolute top-6 left-1/2 transform -translate-x-1/2 z-[10003] pointer-events-none">
              <div className="bg-blue-500 text-white px-4 py-2 rounded-full text-sm font-medium shadow-lg">
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
            


            {/* Buttons - Inside dotted lines, just above bottom */}
            <div 
              className="absolute z-[10001] flex space-x-2"
              style={{
                bottom: '100px', // Just above bottom border (80px border + 20px padding)
                right: '92px' // Inside right border (72px border + 20px padding)
              }}
            >
              <Button
                variant="outline"
                onClick={() => setIsPreviewMode(false)}
                className="text-sm px-3 py-1.5 h-auto bg-slate-50 hover:bg-slate-100 border-slate-300 text-slate-700 shadow-sm"
              >
                Back
              </Button>
              <Button
                onClick={handleConfirm}
                className="text-sm px-3 py-1.5 h-auto bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
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
const SettingsView: React.FC<{ onCloseSidebar?: () => void }> = ({ onCloseSidebar }) => {
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
    { id: 'map-location', label: 'Default Map Location', icon: MapPin },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'privacy', label: 'Privacy', icon: Shield },
    { id: 'language', label: 'Language & Region', icon: Globe },
    { id: 'display', label: 'Display', icon: Monitor },
  ];

  const renderSettingsContent = () => {
    switch (activeCategory) {
      case 'map-location':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold text-slate-800 mb-2">Default Map Location</h3>
              <p className="text-sm text-slate-600">
                Choose where the map opens when you first view it. You can search for a location or click on the map to set it.
              </p>
            </div>
            <LocationPickerModal 
              savedLocation={savedLocation}
              onLocationSaved={handleLocationSaved}
              onCloseSidebar={onCloseSidebar}
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
  onCloseSidebar
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
  
  // Use the prop value for chat mode
  const isInChatMode = inChatMode;

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
                <div className="relative z-10 w-full h-full">
                  <ChatInterface 
                    key={`chat-${currentChatId || 'new'}`}
                    initialQuery={currentChatData?.query || ""} 
                    onBack={handleBackToSearch} 
                    onMessagesUpdate={handleChatMessagesUpdate}
                    loadedMessages={currentChatData?.messages}
                    isFromHistory={currentChatData?.isFromHistory}
                  />
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
          }} className="flex flex-col items-center justify-start flex-1 relative pt-32">
                {/* Interactive Dot Grid Background */}
                {/* No background needed here as it's handled globally */}
                
                {/* VELORA Branding Section */}
                <div className="flex flex-col items-center mb-12">
                  {/* VELORA Logo */}
                  <img 
                    src="/VELORA (new) .png" 
                    alt="VELORA" 
                    className="max-w-[280px] h-auto mb-6"
                    style={{ maxHeight: '120px' }}
                    onLoad={() => {
                      console.log('✅ VELORA logo loaded successfully');
                    }}
                    onError={(e) => {
                      console.error('❌ VELORA logo failed to load:', e.currentTarget.src);
                      // Try URL-encoded version if direct path fails
                      const img = e.target as HTMLImageElement;
                      const currentSrc = img.src;
                      
                      // If direct path failed, try URL-encoded version
                      if (!currentSrc.includes('%20')) {
                        const encodedPath = '/VELORA%20(new)%20.png';
                        console.log(`🔄 Trying URL-encoded path: ${encodedPath}`);
                        img.src = encodedPath;
                      } else {
                        // If all attempts fail, hide the image
                        console.error('❌ VELORA logo failed to load with all attempts.');
                        img.style.display = 'none';
                      }
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
                      <p className="text-slate-500 text-sm mb-12 text-center">
                        Welcome back {userName}, your workspace is synced and ready for your next move
                      </p>
                    ) : (
                      <p className="text-slate-500 text-sm mb-12 text-center">
                        Welcome back, your workspace is synced and ready for your next move
                      </p>
                    );
                  })()}
                </div>
                
                {/* Unified Search Bar - adapts based on context */}
                <SearchBar 
                  onSearch={handleSearch} 
                  onQueryStart={handleQueryStart} 
                  onMapToggle={handleMapToggle}
                  resetTrigger={resetTrigger}
                  isMapVisible={isMapVisible}
                  isInChatMode={isInChatMode}
                  currentView={currentView}
                  hasPerformedSearch={hasPerformedSearch}
                />
                
                {/* Full Screen Map */}
                <SquareMap
                  ref={mapRef}
                  isVisible={isMapVisible}
                  searchQuery={mapSearchQuery}
                  hasPerformedSearch={hasPerformedSearch}
                  onLocationUpdate={(location) => {
                    setCurrentLocation(location.address);
                  }}
                />
              </motion.div>}
          </AnimatePresence>;
      case 'notifications':
        return <div className="w-full max-w-none">
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
        return <SettingsView onCloseSidebar={onCloseSidebar} />;
      default:
        return <div className="flex items-center justify-center flex-1 relative">
            {/* Interactive Dot Grid Background */}
            {/* No background needed here as it's handled globally */}
            
            
            {/* Unified Search Bar - adapts based on context */}
            <SearchBar 
              onSearch={handleSearch} 
              onQueryStart={handleQueryStart} 
              onMapToggle={handleMapToggle}
              resetTrigger={resetTrigger}
              isMapVisible={isMapVisible}
              isInChatMode={isInChatMode}
              currentView={currentView}
              hasPerformedSearch={hasPerformedSearch}
            />
          </div>;
    }
  };
  return <div className={`flex-1 relative bg-white ${className || ''}`} style={{ backgroundColor: '#ffffff', position: 'relative', zIndex: 1 }}>
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
      } ${isInChatMode ? 'p-0' : currentView === 'upload' ? 'p-8' : currentView === 'analytics' ? 'p-4' : currentView === 'profile' ? 'p-0' : currentView === 'notifications' ? 'p-0' : 'p-8 lg:p-16'}`} style={{ backgroundColor: '#ffffff' }}>
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
        }} className={`relative flex-1 flex flex-col overflow-hidden`}>{renderViewContent()}
          </motion.div>
        </div>
      </div>
      
      {/* Search Bar positioning is now handled internally by the SearchBar component */}
    </div>;
  };
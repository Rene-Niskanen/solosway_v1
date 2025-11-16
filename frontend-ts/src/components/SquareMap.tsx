"use client";

import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Moon } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { mockPropertyHubData, transformPropertyHubForFrontend } from '../data/mockPropertyHubData';
import { useBackendApi } from './BackendApi';
import { PropertyDetailsPanel } from './PropertyDetailsPanel';
import { DEFAULT_MAP_LOCATION_KEY } from './MainContent';
// import { openaiService, QueryAnalysis } from '../services/openai';

interface SquareMapProps {
  isVisible: boolean;
  searchQuery?: string;
  onLocationUpdate?: (location: { lat: number; lng: number; address: string }) => void;
  onSearch?: (query: string) => void;
  hasPerformedSearch?: boolean;
  isInChatMode?: boolean;
}

export interface SquareMapRef {
  updateLocation: (query: string) => Promise<void>;
  flyToLocation: (lat: number, lng: number, zoom?: number) => void;
  selectPropertyByAddress: (address: string, coordinates?: { lat: number; lng: number }, propertyId?: string) => void;
}

export const SquareMap = forwardRef<SquareMapRef, SquareMapProps>(({ 
  isVisible, 
  searchQuery,
  onLocationUpdate,
  onSearch,
  hasPerformedSearch = false,
  isInChatMode = false
}, ref) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const currentMarker = useRef<mapboxgl.Marker | null>(null);
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
  // Store map click timeout for deselection
  const mapClickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Store current properties array for click handler access
  const currentPropertiesRef = useRef<any[]>([]);
  
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
  // Initialize to false to match the actual initial map style (light-v11)
  const [isColorfulMap, setIsColorfulMap] = useState(false);
  const [isChangingStyle, setIsChangingStyle] = useState(false);
  const [showPropertyDetailsPanel, setShowPropertyDetailsPanel] = useState(false);

  // Close property card when navigating away from map view
  // BUT: Don't close if chat mode is active (user might be viewing property while in chat)
  React.useEffect(() => {
    if (!isVisible && !isInChatMode) {
      setShowPropertyDetailsPanel(false);
      setShowPropertyCard(false);
      setSelectedProperty(null);
    }
  }, [isVisible, isInChatMode]);

  // Track last interacted property - save to localStorage when a property is selected
  React.useEffect(() => {
    if (selectedProperty && selectedProperty.id && selectedProperty.address) {
      // Only save real properties (not temp ones created from coordinates)
      if (!selectedProperty.id.startsWith('temp-')) {
        const lastProperty = {
          id: selectedProperty.id,
          address: selectedProperty.address,
          latitude: selectedProperty.latitude,
          longitude: selectedProperty.longitude,
          primary_image_url: selectedProperty.primary_image_url || selectedProperty.image,
          documentCount: selectedProperty.documentCount || selectedProperty.document_count || 0,
          timestamp: new Date().toISOString()
        };
        localStorage.setItem('lastInteractedProperty', JSON.stringify(lastProperty));
        // Dispatch custom event to update RecentProjectsSection in the same tab
        window.dispatchEvent(new CustomEvent('lastPropertyUpdated'));
        console.log('💾 Saved last interacted property:', lastProperty.address);
      }
    }
  }, [selectedProperty]);

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
        setTimeout(() => loadProperties(retryCount + 1), 200);
        return;
      }
      console.warn('⚠️ Map not available after 5 attempts');
      return;
    }

    // Ensure map style is loaded before adding markers
    if (!map.current.isStyleLoaded()) {
      if (retryCount < 5) {
        console.log(`🔄 Map style not ready, retrying property load (attempt ${retryCount + 1}/5)...`);
        setTimeout(() => loadProperties(retryCount + 1), 200);
        return;
      }
      console.warn('⚠️ Map style not ready after 5 attempts, proceeding anyway');
    }

    console.log('🗺️ Loading properties from backend...');
    
    // Check for preloaded properties first (Instagram-style preloading)
    const preloadedProperties = (window as any).__preloadedProperties;
    if (preloadedProperties && Array.isArray(preloadedProperties) && preloadedProperties.length > 0) {
      console.log(`✅ Using ${preloadedProperties.length} preloaded properties (instant access!)`);
      
      // Set the search results and add markers immediately
      setSearchResults(preloadedProperties);
      setPropertyMarkers(preloadedProperties);
      
      // Prepare marker data immediately (don't wait for map)
      currentPropertiesRef.current = preloadedProperties;
      
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
            addPropertyMarkers(preloadedProperties, true);
            console.log(`✅ Successfully loaded and displayed ${preloadedProperties.length} preloaded properties`);
            
            // After properties are loaded, check if there's a pending property selection
            const pendingSelection = (window as any).__pendingPropertySelection;
            if (pendingSelection && pendingSelection.address) {
              console.log('📍 Preloaded properties ready, selecting pending property:', pendingSelection);
              (window as any).__pendingPropertySelection = null;
              // Pass the loaded properties directly to avoid state timing issues
              requestAnimationFrame(() => {
                selectPropertyByAddress(pendingSelection.address, pendingSelection.coordinates, pendingSelection.propertyId, 0, preloadedProperties);
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
      return; // Exit early - we used preloaded properties
    }
    
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
              console.log('📍 Properties loaded, selecting pending property:', pendingSelection);
              // Clear the pending selection immediately to prevent duplicate attempts
              (window as any).__pendingPropertySelection = null;
              // Pass the loaded properties directly to avoid state timing issues
              requestAnimationFrame(() => {
                selectPropertyByAddress(pendingSelection.address, pendingSelection.coordinates, pendingSelection.propertyId, 0, transformedProperties);
              });
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
    
    // Create GeoJSON features in one batch operation
    const geojson: GeoJSON.FeatureCollection = {
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
    };

    console.log(`Creating unified source with ${validProperties.length} properties`);

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
      const layersToAdd = [
        {
          id: 'property-click-target',
          type: 'circle' as const,
          paint: {
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              10, 20,
              15, 25,
              20, 30
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
              10, 4,
              15, 5,
              20, 6
            ],
            'circle-color': '#374151',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
            'circle-opacity': 0.9
          }
        }
      ];

      // Batch add layers (faster than individual checks)
      layersToAdd.forEach(layerConfig => {
        if (!map.current.getLayer(layerConfig.id)) {
          map.current.addLayer({
            id: layerConfig.id,
            type: layerConfig.type,
            source: 'properties',
            paint: layerConfig.paint as any // Type assertion for Mapbox paint properties
          });
        }
      });
      
      console.log('✅ Property marker layers ready');

    // Don't create HTML markers initially - they'll be shown when a property is clicked and zoomed in

    // Add click handler for the markers with individual property animation
    // Use component-level ref to access current properties (updated on each addPropertyMarkers call)
    map.current.on('click', 'property-click-target', (e) => {
      // Cancel any pending map click timeout
      if (mapClickTimeoutRef.current) {
        clearTimeout(mapClickTimeoutRef.current);
        mapClickTimeoutRef.current = null;
      }
      
      const feature = e.features[0];
      
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
      
      if (property) {
        console.log('📍 Marker clicked:', property.address);
        
        // 🔍 PHASE 1 DEBUG: Show which array the property was found in
        const foundInProperties = properties.some(p => p.id === feature.properties.id);
        console.log('🔍 PHASE 1 DEBUG - Property Source:', {
          found_in_properties: foundInProperties,
          property_source: 'properties'
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
        
        // Remove any existing property name marker
        if (currentPropertyNameMarkerRef.current) {
          currentPropertyNameMarkerRef.current.remove();
          currentPropertyNameMarkerRef.current = null;
        }
        
        // Show property name marker immediately when clicked
        // Use property name from feature properties if available, otherwise extract it
        const propertyName = feature.properties.propertyName || getPropertyName(property.address);
        
        // Create property name marker using Mapbox Marker (stays fixed to pin automatically)
        if (propertyName && property.longitude && property.latitude && map.current) {
            // Create marker element - one unified piece extending from the pin
            const markerElement = document.createElement('div');
            markerElement.className = 'property-name-marker';
            markerElement.style.cssText = `
              position: relative;
              display: flex;
              flex-direction: column;
              align-items: center;
              pointer-events: none;
            `;
            
            // Use the full address instead of just property name
            const displayText = property.address || propertyName;
            
            markerElement.innerHTML = `
              <div style="
                position: relative;
                display: flex;
                flex-direction: column;
                align-items: center;
              ">
                <!-- Callout box with pointer extending down -->
                <div style="
                  position: relative;
                  display: flex;
                  align-items: center;
                  background: white;
                  border-radius: 8px;
                  padding: 6px 10px;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  white-space: nowrap;
                  margin-bottom: 0;
                ">
                  <!-- Black circle with orange pin icon -->
                  <div style="
                    width: 20px;
                    height: 20px;
                    background: #1a1a1a;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-right: 8px;
                    flex-shrink: 0;
                  ">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#ff6b35"/>
                    </svg>
                  </div>
                  <!-- Address text -->
                  <span style="
                    font-size: 13px;
                    font-weight: 500;
                    color: #1a1a1a;
                    line-height: 1.2;
                  ">${displayText}</span>
                </div>
                <!-- Pointer extending down from callout to pin (one continuous piece) -->
                <div style="
                  position: relative;
                  width: 0;
                  height: 0;
                  border-left: 8px solid transparent;
                  border-right: 8px solid transparent;
                  border-top: 12px solid white;
                  margin-top: -1px;
                  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
                "></div>
                <!-- Green circle pin at the bottom (part of the same piece) -->
                <div style="
                  width: 16px;
                  height: 16px;
                  background: #10B981;
                  border-radius: 50%;
                  border: 2px solid white;
                  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                  margin-top: -6px;
                  position: relative;
                  z-index: 1;
                "></div>
              </div>
            `;
            
            // Position the marker so the green circle pin center aligns with the coordinates
            // This matches the unselected state where circle markers are centered at coordinates
            const pinSize = 16; // Green circle pin size (including border)
            const pointerHeight = 12; // Height of the pointer triangle
            const calloutHeight = 32; // Approximate callout box height
            const totalElementHeight = calloutHeight + pointerHeight + pinSize;
            
            // The green pin is at the bottom of the element
            // To center the green pin at coordinates, we need to offset upward
            // by half the element height minus half the pin size
            const greenPinCenterOffset = (totalElementHeight / 2) - (pinSize / 2);
            
            // Anchor at center and offset upward so green pin center is at coordinates
            const marker = new mapboxgl.Marker({
              element: markerElement,
              anchor: 'center',
              offset: [0, -greenPinCenterOffset] // Offset to center green pin at coordinates
            })
              .setLngLat([property.longitude, property.latitude])
              .addTo(map.current);
            
            // Store marker reference for cleanup
            currentPropertyNameMarkerRef.current = marker;
        }
        
        // Smoothly fly to the property location, centering it on screen with consistent zoom
        const propertyCoordinates: [number, number] = [property.longitude, property.latitude];
        map.current.flyTo({
          center: propertyCoordinates,
          zoom: 17.5, // Consistent zoom level matching reference image proximity
          duration: 2000, // 2 second smooth transition
          essential: true, // Ensure animation completes
          offset: [-80, 0], // Shift center slightly to the left (negative x = left)
          easing: (t) => {
            // Custom easing function for extremely smooth animation
            // Ease-in-out-cubic for smooth acceleration and deceleration
            return t < 0.5
              ? 4 * t * t * t
              : 1 - Math.pow(-2 * t + 2, 3) / 2;
          }
        });
        
        // Hide the base marker for this property by filtering it out
        if (map.current.getLayer('property-markers')) {
          map.current.setFilter('property-markers', [
            '!=',
            ['get', 'id'],
            property.id
          ]);
        }
        
        // Also hide the outer ring for this property
        if (map.current.getLayer('property-outer')) {
          map.current.setFilter('property-outer', [
            '!=',
            ['get', 'id'],
            property.id
          ]);
        }
        
        // Don't create individual marker layers - the unified HTML marker handles everything
        // The HTML marker already includes the green circle pin, so we don't need separate map layers
        
        // Update the selected property state
        console.log('✅ Setting selected property:', {
          id: property.id,
          address: property.address,
          hasPropertyHub: !!property.propertyHub,
          propertyKeys: Object.keys(property)
        });
        setSelectedProperty(property);
        setShowPropertyCard(true);
        setShowPropertyDetailsPanel(true); // Show the new PropertyDetailsPanel
        setIsExpanded(false); // Reset expanded state for new property
        setShowFullDescription(false); // Reset description state for new property
        
        // Preload property files immediately (Instagram-style preloading)
        if (property.id && !property.id.startsWith('temp-')) {
          const preloadFiles = async () => {
            try {
              // Check if files are already preloaded
              const preloadedFiles = (window as any).__preloadedPropertyFiles?.[property.id];
              if (preloadedFiles) {
                console.log('✅ Using preloaded files for property:', property.id);
                return;
              }
              
              console.log('🚀 Preloading files for property:', property.id);
              const response = await backendApi.getPropertyHubDocuments(property.id);
              
              if (response && response.documents) {
                // Store preloaded files in global variable
                if (!(window as any).__preloadedPropertyFiles) {
                  (window as any).__preloadedPropertyFiles = {};
                }
                (window as any).__preloadedPropertyFiles[property.id] = response.documents;
                console.log(`✅ Preloaded ${response.documents.length} files for property ${property.id}`);
              }
            } catch (error) {
              console.error('❌ Error preloading files:', error);
              // Don't throw - preloading failure shouldn't block property selection
            }
          };
          
          // Preload files immediately (don't await - let it happen in background)
          preloadFiles();
        }
        
        // Calculate position using map.project
        const geometry = feature.geometry as GeoJSON.Point;
        const coordinates: [number, number] = [geometry.coordinates[0], geometry.coordinates[1]];
        const point = map.current.project(coordinates);
        
        setSelectedPropertyPosition({
          x: point.x,
          y: point.y - 20
        });
      }
    });

    // Note: Click-off handling is done via document-level event listener (see useEffect below)

    // Add simple hover effects for property layers
    const propertyLayers = ['property-click-target', 'property-outer', 'property-markers'];
    
    propertyLayers.forEach(layerId => {
      map.current.on('mouseenter', layerId, (e) => {
        map.current.getCanvas().style.cursor = 'pointer';
      });

      map.current.on('mouseleave', layerId, (e) => {
        map.current.getCanvas().style.cursor = '';
      });
    });

    // Store empty array since we're using layers now
    setPropertyMarkers([]);
    
    console.log(`addPropertyMarkers completed. Added ${properties.length} markers to map.`);
  };


  // Clear selected property effects
  const clearSelectedPropertyEffects = () => {
    // Remove property name marker if it exists
    if (currentPropertyNameMarkerRef.current) {
      currentPropertyNameMarkerRef.current.remove();
      currentPropertyNameMarkerRef.current = null;
    }
    if (map.current) {
      // Restore base marker layers to show all properties (remove filters)
      if (map.current.getLayer('property-markers')) {
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

  // Ensure property name marker stays visible when property is selected
  useEffect(() => {
    if (selectedProperty && (showPropertyCard || showPropertyDetailsPanel) && map.current) {
      // Check if marker exists, if not recreate it
      if (!currentPropertyNameMarkerRef.current && selectedProperty.address && selectedProperty.latitude && selectedProperty.longitude) {
        console.log('🔄 Ensuring property name marker is visible');
        const getPropertyName = (addr: string) => {
          if (!addr) return '';
          const parts = addr.split(',');
          return parts[0]?.trim() || addr;
        };
        
        const propertyName = getPropertyName(selectedProperty.address);
        const displayText = selectedProperty.address || propertyName;
        
        if (displayText) {
          const markerElement = document.createElement('div');
          markerElement.className = 'property-name-marker';
          markerElement.style.cssText = `
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            pointer-events: none;
          `;
          
          markerElement.innerHTML = `
            <div style="
              position: relative;
              display: flex;
              flex-direction: column;
              align-items: center;
            ">
              <!-- Callout box with pointer extending down -->
              <div style="
                position: relative;
                display: flex;
                align-items: center;
                background: white;
                border-radius: 8px;
                padding: 6px 10px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                white-space: nowrap;
                margin-bottom: 0;
              ">
                <!-- Black circle with orange pin icon -->
                <div style="
                  width: 20px;
                  height: 20px;
                  background: #1a1a1a;
                  border-radius: 50%;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  margin-right: 8px;
                  flex-shrink: 0;
                ">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#ff6b35"/>
                  </svg>
                </div>
                <!-- Address text -->
                <span style="
                  font-size: 13px;
                  font-weight: 500;
                  color: #1a1a1a;
                  line-height: 1.2;
                ">${displayText}</span>
              </div>
              <!-- Pointer extending down from callout to pin -->
              <div style="
                position: relative;
                width: 0;
                height: 0;
                border-left: 8px solid transparent;
                border-right: 8px solid transparent;
                border-top: 12px solid white;
                margin-top: -1px;
                filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
              "></div>
              <!-- Green circle pin at the bottom -->
              <div style="
                width: 16px;
                height: 16px;
                background: #10B981;
                border-radius: 50%;
                border: 2px solid white;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                margin-top: -6px;
                position: relative;
                z-index: 1;
              "></div>
            </div>
          `;
          
          const pinSize = 16;
          const pointerHeight = 12;
          const calloutHeight = 32;
          const totalElementHeight = calloutHeight + pointerHeight + pinSize;
          const greenPinCenterOffset = (totalElementHeight / 2) - (pinSize / 2);
          
          const marker = new mapboxgl.Marker({
            element: markerElement,
            anchor: 'center',
            offset: [0, -greenPinCenterOffset]
          })
            .setLngLat([selectedProperty.longitude, selectedProperty.latitude])
            .addTo(map.current);
          
          currentPropertyNameMarkerRef.current = marker;
        }
      }
    }
  }, [selectedProperty, showPropertyCard, showPropertyDetailsPanel]);

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
      
      const newStyle = willBeColorful ? 'mapbox://styles/mapbox/streets-v12' : 'mapbox://styles/mapbox/light-v11';
      
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
    
    // Remove existing marker
    if (currentMarker.current) {
      currentMarker.current.remove();
    }
    
    if (!isArea) {
      // Add property comparable marker with label for specific addresses
      const markerElement = document.createElement('div');
      markerElement.className = 'property-comparable';
      markerElement.innerHTML = `
        <div style="
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
        ">
          <!-- Address Label -->
          <div style="
            background: #2d3748;
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
              <div style="font-size: 10px; color: #a0aec0; margin-bottom: 2px;">Comp Located</div>
              <div style="font-size: 12px; font-weight: 600;">Property Location</div>
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
              border-top: 6px solid #2d3748;
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
      
      currentMarker.current = new mapboxgl.Marker({
        element: markerElement
      })
        .setLngLat([lng, lat])
        .addTo(map.current);
    }
    
    // Center the map on the location
    map.current.jumpTo({
      center: [lng, lat],
      zoom: zoom
    });
  };

  // Expose methods to parent component
  // Method to select a property by address (same logic as clicking a pin)
  const selectPropertyByAddress = (address: string, coordinates?: { lat: number; lng: number }, propertyId?: string, retryCount = 0, providedProperties?: any[]) => {
    if (!map.current) {
      // Retry if map isn't ready yet
      if (retryCount < 10) {
        setTimeout(() => selectPropertyByAddress(address, coordinates, propertyId, retryCount + 1, providedProperties), 200);
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
    // Use providedProperties if available (for immediate selection after loading)
    // Remove duplicates by ID
    const allPropertiesMap = new Map();
    const propertiesToSearch = providedProperties || [...searchResults, ...propertyMarkers];
    propertiesToSearch.forEach(p => {
      if (p && p.id && !allPropertiesMap.has(p.id)) {
        allPropertiesMap.set(p.id, p);
      }
    });
    const allProperties = Array.from(allPropertiesMap.values());
    
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
    
    // Determine final destination coordinates - prefer property coordinates, fallback to provided coordinates
    let finalLat: number | null = null;
    let finalLng: number | null = null;
    let finalProperty: any = null;
    
    if (property && property.latitude && property.longitude) {
      finalLat = property.latitude;
      finalLng = property.longitude;
      finalProperty = property;
      console.log('📍 Found property by address:', property.address);
    } else if (coordinates && coordinates.lat && coordinates.lng) {
      finalLat = coordinates.lat;
      finalLng = coordinates.lng;
      console.log('📍 Using provided coordinates:', coordinates);
    }
    
      // If we have a final destination, proceed with selection and single fly
      if (finalLat !== null && finalLng !== null) {
        // If we have coordinates but no property yet, retry to find the property
        // This handles cases where properties are still loading
        if (!finalProperty) {
          // Check if properties have been loaded (propertyMarkers has items)
          // If properties are loaded but we still can't find it, reduce retries
          const hasPropertiesLoaded = propertyMarkers.length > 0;
          const maxRetries = hasPropertiesLoaded ? 3 : 20; // Fewer retries if properties are already loaded
          
          if (retryCount < maxRetries) {
            console.log('⚠️ Property not found yet, retrying...', {
              retryCount,
              maxRetries,
              propertyId,
              address,
              totalProperties: allProperties.length,
              hasPropertiesLoaded,
              hasCoordinates: !!(coordinates?.lat && coordinates?.lng)
            });
            // Use shorter delay if properties are already loaded
            const retryDelay = hasPropertiesLoaded ? 200 : 400;
            setTimeout(() => selectPropertyByAddress(address, coordinates, propertyId, retryCount + 1, providedProperties), retryDelay);
          } else {
            console.log('❌ Max retries reached, property not found');
            // Clear pending selection if we've exhausted retries
            if ((window as any).__pendingPropertySelection) {
              (window as any).__pendingPropertySelection = null;
            }
          }
          return;
        }
      
      // Hide the base marker for this property by filtering it out (same as clicking a pin)
      // Do this BEFORE setting the property state to prevent conflicts
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
      
      // Set the selected property and open details panel IMMEDIATELY
      // This ensures the card is visible throughout the transition
      console.log('✅ Setting selected property:', {
        id: finalProperty.id,
        address: finalProperty.address,
        hasPropertyHub: !!finalProperty.propertyHub
      });
      setSelectedProperty(finalProperty);
      setShowPropertyCard(true);
      setShowPropertyDetailsPanel(true);
      setIsExpanded(false);
      setShowFullDescription(false);
      
      // Preload property files immediately (Instagram-style preloading)
      // This ensures files are ready instantly when user clicks "View Files"
      if (finalProperty.id && !finalProperty.id.startsWith('temp-')) {
        const preloadFiles = async () => {
          try {
            // Check if files are already preloaded
            const preloadedFiles = (window as any).__preloadedPropertyFiles?.[finalProperty.id];
            if (preloadedFiles) {
              console.log('✅ Using preloaded files for property:', finalProperty.id);
              return;
            }
            
            console.log('🚀 Preloading files for property:', finalProperty.id);
            const response = await backendApi.getPropertyHubDocuments(finalProperty.id);
            
            if (response && response.documents) {
              // Store preloaded files in global variable
              if (!(window as any).__preloadedPropertyFiles) {
                (window as any).__preloadedPropertyFiles = {};
              }
              (window as any).__preloadedPropertyFiles[finalProperty.id] = response.documents;
              console.log(`✅ Preloaded ${response.documents.length} files for property ${finalProperty.id}`);
            }
          } catch (error) {
            console.error('❌ Error preloading files:', error);
            // Don't throw - preloading failure shouldn't block property selection
          }
        };
        
        // Preload files immediately (don't await - let it happen in background)
        preloadFiles();
      }
      
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
      if (currentPropertyNameMarkerRef.current && displayText && map.current) {
        // Update existing marker position - no flicker!
        currentPropertyNameMarkerRef.current.setLngLat([finalLng, finalLat]);
        console.log('📍 Updated existing property name marker position');
      } else if (displayText && map.current) {
        // Only create new marker if one doesn't exist
        const markerElement = document.createElement('div');
        markerElement.className = 'property-name-marker';
        markerElement.style.cssText = `
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          pointer-events: none;
        `;
        
        markerElement.innerHTML = `
          <div style="
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
          ">
            <!-- Callout box with pointer extending down -->
            <div style="
              position: relative;
              display: flex;
              align-items: center;
              background: white;
              border-radius: 8px;
              padding: 6px 10px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.15);
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              white-space: nowrap;
              margin-bottom: 0;
            ">
              <!-- Black circle with orange pin icon -->
              <div style="
                width: 20px;
                height: 20px;
                background: #1a1a1a;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                margin-right: 8px;
                flex-shrink: 0;
              ">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#ff6b35"/>
                </svg>
              </div>
              <!-- Address text -->
              <span style="
                font-size: 13px;
                font-weight: 500;
                color: #1a1a1a;
                line-height: 1.2;
              ">${displayText}</span>
            </div>
            <!-- Pointer extending down from callout to pin -->
            <div style="
              position: relative;
              width: 0;
              height: 0;
              border-left: 8px solid transparent;
              border-right: 8px solid transparent;
              border-top: 12px solid white;
              margin-top: -1px;
              filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
            "></div>
            <!-- Green circle pin at the bottom -->
            <div style="
              width: 16px;
              height: 16px;
              background: #10B981;
              border-radius: 50%;
              border: 2px solid white;
              box-shadow: 0 2px 4px rgba(0,0,0,0.2);
              margin-top: -6px;
              position: relative;
              z-index: 1;
            "></div>
          </div>
        `;
        
        const pinSize = 16;
        const pointerHeight = 12;
        const calloutHeight = 32;
        const totalElementHeight = calloutHeight + pointerHeight + pinSize;
        const greenPinCenterOffset = (totalElementHeight / 2) - (pinSize / 2);
        
        const marker = new mapboxgl.Marker({
          element: markerElement,
          anchor: 'center',
          offset: [0, -greenPinCenterOffset]
        })
          .setLngLat([finalLng, finalLat])
          .addTo(map.current);
        
        currentPropertyNameMarkerRef.current = marker;
      }
      
      // Use the EXACT same flyTo logic as clicking a property pin directly
      // This is the same code that runs when clicking a pin (lines 1002-1017)
      const propertyCoordinates: [number, number] = [finalLng, finalLat];
      map.current.flyTo({
        center: propertyCoordinates,
        zoom: 17.5, // Consistent zoom level matching reference image proximity
        duration: 2000, // 2 second smooth transition
        essential: true, // Ensure animation completes
        offset: [-80, 0], // Shift center slightly to the left (negative x = left)
        easing: (t) => {
          // Custom easing function for extremely smooth animation
          // Ease-in-out-cubic for smooth acceleration and deceleration
          return t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
        }
      });
      
      // Update property position after flyTo completes
      // Marker should already be visible and positioned correctly
      map.current.once('moveend', () => {
        if (finalProperty && map.current) {
          const point = map.current.project([finalLng, finalLat]);
          setSelectedPropertyPosition({
            x: point.x,
            y: point.y - 20
          });
          
          // Ensure marker position is correct after animation
          if (currentPropertyNameMarkerRef.current) {
            currentPropertyNameMarkerRef.current.setLngLat([finalLng, finalLat]);
          }
        }
      });
    } else {
      // Property not found yet - retry if we haven't exceeded max retries
      if (retryCount < 30) {
        console.log(`⏳ Property not found yet, retrying... (${retryCount + 1}/30)`, {
          searchAddress: address,
          normalizedSearch,
          availableProperties: allProperties.length,
          sampleAddresses: allProperties.slice(0, 3).map(p => p.address)
        });
        setTimeout(() => selectPropertyByAddress(address, coordinates, propertyId, retryCount + 1, providedProperties), 400);
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
      // Just update visibility
      if (mapContainer.current) {
        mapContainer.current.style.display = isVisible ? 'block' : 'none';
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
      
      // Create map with worldwide access (no bounds restriction)
      // Hide map initially if not visible (we'll show it when needed)
      if (mapContainer.current) {
        mapContainer.current.style.display = isVisible ? 'block' : 'none';
      }
      
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/light-v11', // Light style (no color) - default
        center: defaultLocation.center,
        zoom: defaultLocation.zoom,
        bearing: 15, // Slight rotation for better view
        pitch: 45, // 3D perspective angle
        interactive: isVisible, // Only interactive when visible
        // Removed maxBounds to allow worldwide navigation
        attributionControl: false // Hide the attribution control
      });

      // Wait for map to load
      map.current.on('load', () => {
        // Check for pending property selection (when map opens from recent project card)
        const pendingSelection = (window as any).__pendingPropertySelection;
        if (pendingSelection && pendingSelection.address) {
          console.log('📍 Processing pending property selection:', pendingSelection);
          // Make a single attempt after a short delay to let map initialize
          // The retry logic will handle waiting for properties to load
          setTimeout(() => {
            selectPropertyByAddress(pendingSelection.address, pendingSelection.coordinates, pendingSelection.propertyId, 0);
          }, 300);
        }
        
        // Ensure all interaction controls are enabled if map is visible
        if (isVisible && map.current) {
          map.current.scrollZoom.enable();
          map.current.boxZoom.enable();
          map.current.dragRotate.enable();
          map.current.dragPan.enable();
          map.current.keyboard.enable();
          map.current.doubleClickZoom.enable();
          map.current.touchZoomRotate.enable();
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

        // Load and display ALL comparable properties on map initialization
        // This happens immediately when map is created (even if hidden)
        // So pins are ready instantly when map becomes visible
        console.log('🗺️ Loading ALL comparable properties on map initialization...');
        // Use loadProperties to get all properties from backend
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
            // Update marker position if it exists
            if (currentPropertyNameMarkerRef.current && selectedProperty.latitude && selectedProperty.longitude) {
              currentPropertyNameMarkerRef.current.setLngLat([selectedProperty.longitude, selectedProperty.latitude]);
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
  
  // Update map visibility and interactivity when isVisible changes
  useEffect(() => {
    if (map.current && mapContainer.current) {
      // Show/hide map container
      mapContainer.current.style.display = isVisible ? 'block' : 'none';
      
      // Enable/disable map interactions
      if (isVisible) {
        // Resize map to ensure it renders correctly when shown
        setTimeout(() => {
          if (map.current) {
            map.current.resize();
            // Re-enable interactions
            map.current.getCanvas().style.pointerEvents = 'auto';
            // Explicitly enable all zoom and interaction controls
            map.current.scrollZoom.enable();
            map.current.boxZoom.enable();
            map.current.dragRotate.enable();
            map.current.dragPan.enable();
            map.current.keyboard.enable();
            map.current.doubleClickZoom.enable();
            map.current.touchZoomRotate.enable();
          }
        }, 100);
      } else {
        // Disable interactions when hidden
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
  }, [isVisible]);
  
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
  useEffect(() => {
    if (searchQuery && isVisible && map.current) {
      // Enhanced search triggered
      updateLocation(searchQuery);
    }
  }, [searchQuery, isVisible]);

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
      if (map.current && currentIsVisible) {
        console.log('🗺️ SquareMap: Default location changed, updating map view immediately', newLocation);
        lastAppliedLocation.current = newLocation;
        map.current.flyTo({
          center: newLocation.coordinates,
          zoom: newLocation.zoom,
          duration: 1000, // Smooth transition
          essential: true
        });
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
  useEffect(() => {
    if (!isVisible || !map.current) {
      console.log('🗺️ SquareMap: Visibility check skipped', { isVisible, mapReady: !!map.current });
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
        animate={{ opacity: isVisible ? 1 : 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        style={{ 
          display: isVisible ? 'block' : 'none',
          pointerEvents: isVisible ? 'auto' : 'none'
        }}
          className="fixed inset-0 z-10"
        >
          <div 
            ref={mapContainer} 
            className="w-full h-full"
            style={{
              width: '100vw',
              height: '100vh',
              position: 'fixed',
              top: 0,
              left: 0
            }}
          />
          
          {/* Map Style Toggle Button - positioned in top right corner */}
          <motion.button
            onClick={toggleMapStyle}
            disabled={isChangingStyle}
            className={`fixed top-5 z-50 w-9 h-9 backdrop-blur-sm rounded-full shadow-lg border border-white/20 flex items-center justify-center transition-all duration-200 ${
              isChangingStyle 
                ? 'bg-gray-100/90 cursor-not-allowed' 
                : 'bg-white/90 hover:bg-white hover:shadow-xl'
            }`}
            style={{
              right: '20px',
              top: '20px'
            }}
            whileHover={!isChangingStyle ? { 
              scale: 1.08, 
              y: -2,
              boxShadow: "0 20px 40px -12px rgba(0, 0, 0, 0.3)"
            } : {}}
            whileTap={!isChangingStyle ? { 
              scale: 0.92, 
              y: 1 
            } : {}}
            transition={{
              type: "spring",
              stiffness: 400,
              damping: 25,
              mass: 0.8
            }}
            title={isChangingStyle ? "Changing map style..." : (isColorfulMap ? "Switch to Light Map" : "Switch to Colorful Map")}
          >
            <motion.div
              animate={{ rotate: isColorfulMap ? 180 : 0 }}
              transition={{ 
                duration: 0.4, 
                ease: [0.4, 0.0, 0.2, 1]
              }}
              className="w-5 h-5 flex items-center justify-center"
            >
              {isChangingStyle ? (
                // Loading spinner
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-4 h-4"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 11-6.219-8.56"/>
                  </svg>
                </motion.div>
              ) : isColorfulMap ? (
                // Light mode icon (sun)
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5"/>
                  <line x1="12" y1="1" x2="12" y2="3"/>
                  <line x1="12" y1="21" x2="12" y2="23"/>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                  <line x1="1" y1="12" x2="3" y2="12"/>
                  <line x1="21" y1="12" x2="23" y2="12"/>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
              ) : (
                // Colorful mode icon (moon)
                <Moon className="w-5 h-5" strokeWidth={2} />
              )}
            </motion.div>
          </motion.button>
          
          
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
      {showPropertyDetailsPanel && (
        <PropertyDetailsPanel
          key="property-details-panel"
          property={selectedProperty}
          isVisible={showPropertyDetailsPanel}
          onClose={() => {
            setShowPropertyDetailsPanel(false);
            setShowPropertyCard(false); // Also close the old property card
            setSelectedProperty(null); // Clear selected property
            clearSelectedPropertyEffects(); // Restore base markers
          }}
        />
      )}
    </AnimatePresence>
  );
});

SquareMap.displayName = 'SquareMap';


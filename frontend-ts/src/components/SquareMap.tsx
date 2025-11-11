"use client";

import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { mockPropertyHubData, transformPropertyHubForFrontend } from '../data/mockPropertyHubData';
import { useBackendApi } from './BackendApi';
import { PropertyDetailsPanel } from './PropertyDetailsPanel';
// import { openaiService, QueryAnalysis } from '../services/openai';

interface SquareMapProps {
  isVisible: boolean;
  searchQuery?: string;
  onLocationUpdate?: (location: { lat: number; lng: number; address: string }) => void;
  onSearch?: (query: string) => void;
  hasPerformedSearch?: boolean;
}

export interface SquareMapRef {
  updateLocation: (query: string) => Promise<void>;
  flyToLocation: (lat: number, lng: number, zoom?: number) => void;
}

export const SquareMap = forwardRef<SquareMapRef, SquareMapProps>(({ 
  isVisible, 
  searchQuery,
  onLocationUpdate,
  onSearch,
  hasPerformedSearch = false
}, ref) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const currentMarker = useRef<mapboxgl.Marker | null>(null);
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
  const backendApi = useBackendApi();
  
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
  const [isColorfulMap, setIsColorfulMap] = useState(true);
  const [isChangingStyle, setIsChangingStyle] = useState(false);
  const [showPropertyDetailsPanel, setShowPropertyDetailsPanel] = useState(false);

  // Close property card when navigating away from map view
  React.useEffect(() => {
    if (!isVisible) {
      setShowPropertyDetailsPanel(false);
      setShowPropertyCard(false);
      setSelectedProperty(null);
    }
  }, [isVisible]);

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
  const loadProperties = async () => {
    if (!map.current) return;

    console.log('🗺️ Loading properties from backend...');
    
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
        addPropertyMarkers(transformedProperties, true);
        
        console.log(`✅ Successfully loaded ${transformedProperties.length} properties from backend`);
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

  // Add property markers to map using Mapbox's native symbol layers (most stable approach)
  const addPropertyMarkers = (properties: any[], shouldClearExisting: boolean = true) => {
    if (!map.current) return;

    console.log(`addPropertyMarkers called with ${properties.length} properties, shouldClearExisting: ${shouldClearExisting}`);

    // Clear existing markers only if requested (not during style changes)
    if (shouldClearExisting) {
      console.log('Clearing existing markers in addPropertyMarkers...');
      
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
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: properties.map(property => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [property.longitude, property.latitude]
        },
        properties: {
          id: property.id,
          address: property.address,
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
      }))
    };

    console.log(`Creating unified source with ${properties.length} properties`);

    // Add the source
    map.current.addSource('properties', {
      type: 'geojson',
      data: geojson
    });

      // Add large invisible click target for better interaction
      map.current.addLayer({
        id: 'property-click-target',
        type: 'circle',
        source: 'properties',
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
      });

      // Add subtle outer ring with pulse effect
      map.current.addLayer({
        id: 'property-outer',
        type: 'circle',
        source: 'properties',
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
      });

      // Add main property dot with responsive sizing and better visual feedback
      map.current.addLayer({
        id: 'property-markers',
        type: 'circle',
        source: 'properties',
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
      });

    // Add click handler for the markers with individual property animation
    map.current.on('click', 'property-click-target', (e) => {
      const feature = e.features[0];
      
      // 🔍 PHASE 1 DEBUG: Debug property selection
      console.log('🔍 PHASE 1 DEBUG - Property Selection:', {
        feature_id: feature.properties.id,
        properties_array_length: properties.length,
        properties_sample: properties.slice(0, 2).map(p => ({ 
          id: p.id, 
          address: p.address, 
          soldPrice: p.soldPrice,
          rentPcm: p.rentPcm,
          askingPrice: p.askingPrice,
          has_price_data: !!(p.soldPrice || p.rentPcm || p.askingPrice)
        }))
      });
      
      const property = properties.find(p => p.id === feature.properties.id);
      
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
        
        // Create individual marker layers for this specific property only
        const propertyId = `property-${property.id}`;
        const outerId = `property-outer-${property.id}`;
        
        // Add individual outer ring for this property
        map.current.addSource(outerId, {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              geometry: feature.geometry,
              properties: feature.properties
            }]
          }
        });
        
        map.current.addLayer({
          id: outerId,
          type: 'circle',
          source: outerId,
          paint: {
            'circle-radius': 16,
            'circle-color': 'rgba(16, 185, 129, 0.2)',
            'circle-stroke-width': 0
          }
        });
        
        // Add individual marker for this property with click animation
        map.current.addSource(propertyId, {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              geometry: feature.geometry,
              properties: feature.properties
            }]
          }
        });
        
        map.current.addLayer({
          id: propertyId,
          type: 'circle',
          source: propertyId,
          paint: {
            'circle-radius': 8,
            'circle-color': '#10B981',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
          }
        });
        
        // Add satisfying click animation for this specific property
        setTimeout(() => {
          if (map.current && map.current.getLayer(outerId)) {
            map.current.setPaintProperty(outerId, 'circle-radius', 20);
            map.current.setPaintProperty(outerId, 'circle-color', 'rgba(16, 185, 129, 0.4)');
          }
          if (map.current && map.current.getLayer(propertyId)) {
            map.current.setPaintProperty(propertyId, 'circle-radius', 10);
            map.current.setPaintProperty(propertyId, 'circle-stroke-width', 3);
          }
          
          // Reset after animation
          setTimeout(() => {
            if (map.current) {
              if (map.current.getLayer(outerId)) {
                map.current.setPaintProperty(outerId, 'circle-radius', 16);
                map.current.setPaintProperty(outerId, 'circle-color', 'rgba(16, 185, 129, 0.2)');
              }
              if (map.current.getLayer(propertyId)) {
                map.current.setPaintProperty(propertyId, 'circle-radius', 8);
                map.current.setPaintProperty(propertyId, 'circle-stroke-width', 2);
              }
            }
          }, 200);
        }, 50);
        
        // Update the selected property state
        setSelectedProperty(property);
        setShowPropertyCard(true);
        setShowPropertyDetailsPanel(true); // Show the new PropertyDetailsPanel
        setIsExpanded(false); // Reset expanded state for new property
        setShowFullDescription(false); // Reset description state for new property
        
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

  // Clear effects when property card is closed
  useEffect(() => {
    if (!showPropertyCard && selectedProperty) {
      clearSelectedPropertyEffects();
    }
  }, [showPropertyCard, selectedProperty]);

  // Clear effects when properties change
  useEffect(() => {
    clearSelectedPropertyEffects();
  }, [searchResults]);

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
    if (map.current && !isChangingStyle) {
      setIsChangingStyle(true);
      
      // Store current view state before style change
      const currentCenter = map.current.getCenter();
      const currentZoom = map.current.getZoom();
      const currentPitch = map.current.getPitch();
      const currentBearing = map.current.getBearing();
      
      // Store current property markers to re-add them
      const currentProperties = searchResults;
      
      const newStyle = isColorfulMap ? 'mapbox://styles/mapbox/light-v11' : 'mapbox://styles/mapbox/streets-v12';
      
      // Set the new style
      map.current.setStyle(newStyle);
      setIsColorfulMap(!isColorfulMap);
      
      // Wait for style to load, then restore view and markers
      map.current.once('styledata', () => {
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
        
        // Re-add property markers if they exist (don't clear existing ones during style change)
        if (currentProperties && currentProperties.length > 0) {
          setTimeout(() => {
            addPropertyMarkers(currentProperties, false);
          }, 100);
        }
        
        // Re-hide labels if we're switching to light style and haven't searched yet
        if (!isColorfulMap && !hasPerformedSearch) {
          setTimeout(() => hideMapLabels(), 200);
        }
        
        // Reset loading state
        setTimeout(() => {
          setIsChangingStyle(false);
        }, 400);
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
  useImperativeHandle(ref, () => ({
    updateLocation,
    flyToLocation
  }));

  useEffect(() => {
    if (!isVisible || !mapContainer.current) {
      if (map.current) {
        map.current.remove();
        map.current = null;
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
      // Create map with worldwide access (no bounds restriction)
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/light-v11', // Light style (no color) - default
        center: [-2.5879, 51.4545], // Start with Bristol center
        zoom: 10.5, // Initial zoom level
        bearing: 15, // Slight rotation for better view
        pitch: 45, // 3D perspective angle
        interactive: true,
        // Removed maxBounds to allow worldwide navigation
        attributionControl: false // Hide the attribution control
      });

      // Wait for map to load
      map.current.on('load', () => {
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
        console.log('🗺️ Loading ALL comparable properties on map initialization...');
        // Use loadProperties to get all properties from backend
        loadProperties();
        
        // Navigation controls removed per user request
        
        // Update property card position when map moves
        map.current?.on('move', () => {
          if (selectedProperty && showPropertyCard) {
            // Use map.project to get the current screen position of the selected property
            const coordinates: [number, number] = [selectedProperty.longitude, selectedProperty.latitude];
            const point = map.current.project(coordinates);
            
            setSelectedPropertyPosition({
              x: point.x,
              y: point.y - 20
            });
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

    // Cleanup
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
  }, [isVisible]);

  // Update location when searchQuery changes (only on explicit search)
  useEffect(() => {
    if (searchQuery && isVisible && map.current) {
      // Enhanced search triggered
      updateLocation(searchQuery);
    }
  }, [searchQuery, isVisible]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
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
                // Colorful mode icon (palette)
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
                  <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
                  <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
                  <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
                  <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
                </svg>
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
      )}
      
      {/* Property Details Panel */}
      <PropertyDetailsPanel
        property={selectedProperty}
        isVisible={showPropertyDetailsPanel}
        onClose={() => {
          setShowPropertyDetailsPanel(false);
          setShowPropertyCard(false); // Also close the old property card
          setSelectedProperty(null); // Clear selected property
          clearSelectedPropertyEffects(); // Restore base markers
        }}
      />
    </AnimatePresence>
  );
});

SquareMap.displayName = 'SquareMap';

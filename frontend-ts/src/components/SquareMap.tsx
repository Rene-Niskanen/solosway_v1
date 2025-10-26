"use client";

import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { mockPropertyData } from '../data/mockPropertyData';
import { useBackendApi } from './BackendApi';
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

  // Helper function to truncate text
  const truncateText = (text: string, maxLength: number = 200) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  // Debug selectedPropertyPosition changes
  useEffect(() => {
    // selectedPropertyPosition changed
  }, [selectedPropertyPosition]);


  // Property search functionality
  // Filter properties based on search query
  const filterPropertiesByQuery = (properties: any[], query: string) => {
    if (!query.trim()) return properties;
    
    const lowerQuery = query.toLowerCase();
    console.log('🔍 Filtering properties with query:', lowerQuery);
    
    // Extract bedroom count from query
    const bedroomMatch = lowerQuery.match(/(\d+)\s*bed/i);
    const requestedBedrooms = bedroomMatch ? parseInt(bedroomMatch[1]) : null;
    console.log('Requested bedrooms:', requestedBedrooms);
    
    // Extract bathroom count from query
    const bathroomMatch = lowerQuery.match(/(\d+)\s*bath/i);
    const requestedBathrooms = bathroomMatch ? parseInt(bathroomMatch[1]) : null;
    console.log('Requested bathrooms:', requestedBathrooms);
    
    // Extract location from query
    let queryLocation = null;
    let locationMatch = null;
    
    // Simple location matching
    const locationKeywords = {
      'clifton': ['clifton', 'clifton village', 'clifton down', 'clifton hill', 'clifton park'],
      'redland': ['redland', 'redland road', 'redland park'],
      'cotham': ['cotham', 'cotham hill', 'cotham road'],
      'bishopston': ['bishopston', 'bishopston road'],
      'filton': ['filton', 'filton avenue', 'filton road', 'filton high street'],
      'henleaze': ['henleaze', 'henleaze road'],
      'stoke bishop': ['stoke bishop', 'stoke bishop road'],
      'westbury park': ['westbury park', 'westbury hill'],
      'horfield': ['horfield', 'horfield road'],
      'ashley down': ['ashley down', 'ashley down road'],
      'hotwells': ['hotwells', 'hotwells road'],
      'easton': ['easton', 'easton road'],
      'bedminster': ['bedminster', 'bedminster down'],
      'montpelier': ['montpelier', 'montpelier hill'],
      'city centre': ['city centre', 'city center', 'centre', 'center', 'broadmead', 'redcliffe', 'temple meads']
    };
    
    // Check for location match
    for (const [location, keywords] of Object.entries(locationKeywords)) {
      const found = keywords.find(keyword => lowerQuery.includes(keyword));
      if (found) {
        queryLocation = location;
        locationMatch = found;
        console.log(`✅ Location match found: ${location} for query: "${lowerQuery}"`);
        break;
      }
    }
    
    console.log(`Final location: ${queryLocation}`);
    
    return properties.filter(property => {
      let matches = true;
      const reasons = [];
      
      // Check bedroom count
      if (requestedBedrooms && property.bedrooms !== requestedBedrooms) {
        matches = false;
        reasons.push(`bedroom count mismatch: ${property.bedrooms} vs ${requestedBedrooms}`);
      }
      
      // Check bathroom count
      if (requestedBathrooms && property.bathrooms !== requestedBathrooms) {
        matches = false;
        reasons.push(`bathroom count mismatch: ${property.bathrooms} vs ${requestedBathrooms}`);
      }
      
      // Check property type
      if (lowerQuery.includes('house') && property.property_type === 'Apartment') {
        matches = false;
        reasons.push('property type mismatch: apartment vs house');
      }
      if (lowerQuery.includes('apartment') && property.property_type !== 'Apartment') {
        matches = false;
        reasons.push('property type mismatch: not apartment');
      }
      if (lowerQuery.includes('flat') && property.property_type !== 'Apartment') {
        matches = false;
        reasons.push('property type mismatch: not apartment');
      }
      if (lowerQuery.includes('detached') && property.property_type !== 'Detached') {
        matches = false;
        reasons.push('property type mismatch: not detached');
      }
      if (lowerQuery.includes('semi') && property.property_type !== 'Semi-Detached') {
        matches = false;
        reasons.push('property type mismatch: not semi-detached');
      }
      if (lowerQuery.includes('terraced') && property.property_type !== 'Terraced') {
        matches = false;
        reasons.push('property type mismatch: not terraced');
      }
      
      // Comprehensive Bristol location matching system
      const bristolLocations = {
        // Major areas
        'clifton': ['clifton', 'clifton village', 'clifton down', 'clifton hill', 'clifton park', 'clifton gardens', 'clifton street', 'clifton avenue', 'clifton road', 'clifton village', 'clifton down road'],
        'redland': ['redland', 'redland road', 'redland park', 'redland hill'],
        'cotham': ['cotham', 'cotham hill', 'cotham brow', 'cotham road'],
        'bishopston': ['bishopston', 'bishopston road', 'gloucester road'],
        'filton': ['filton', 'filton avenue', 'filton road', 'filton hill', 'filton high street'],
        'henleaze': ['henleaze', 'henleaze road', 'henleaze gardens'],
        'stoke bishop': ['stoke bishop', 'stoke bishop road', 'stoke bishop lane'],
        'westbury park': ['westbury park', 'westbury hill', 'westbury park road'],
        'horfield': ['horfield', 'horfield road', 'horfield common'],
        'ashley down': ['ashley down', 'ashley down road', 'ashley hill'],
        'hotwells': ['hotwells', 'hotwells road'],
        'easton': ['easton', 'easton road'],
        'bedminster': ['bedminster', 'bedminster down', 'bedminster parade'],
        'montpelier': ['montpelier', 'montpelier hill'],
        'harbourside': ['harbourside', 'harbour side'],
        
        // City centre areas
        'city centre': ['city centre', 'city center', 'centre', 'center', 'broadmead', 'redcliffe', 'temple meads', 'old city', 'temple quarter'],
        'broadmead': ['broadmead', 'broadmead shopping'],
        'redcliffe': ['redcliffe', 'redcliffe way', 'redcliffe hill'],
        'temple meads': ['temple meads', 'temple quarter'],
        'old city': ['old city', 'bristol cathedral'],
        
        // Streets and specific locations
        'whiteladies road': ['whiteladies road', 'whiteladies'],
        'gloucester road': ['gloucester road', 'gloucester'],
        'park street': ['park street'],
        'queen square': ['queen square'],
        'college green': ['college green'],
        'corn street': ['corn street'],
        'wine street': ['wine street'],
        'high street': ['high street'],
        'union street': ['union street'],
        'broad street': ['broad street'],
        'king street': ['king street'],
        'welsh back': ['welsh back'],
        'floating harbour': ['floating harbour', 'harbour'],
        'ss great britain': ['ss great britain', 'great britain'],
        'bristol cathedral': ['bristol cathedral', 'cathedral'],
        'cabot tower': ['cabot tower', 'brandon hill'],
        'clifton suspension bridge': ['clifton suspension bridge', 'suspension bridge'],
        'bristol zoo': ['bristol zoo', 'zoo'],
        'ashton court': ['ashton court'],
        'leigh woods': ['leigh woods'],
        'bristol university': ['bristol university', 'university of bristol', 'university'],
        'uwe': ['uwe', 'university of the west of england'],
        'temple meads station': ['temple meads station', 'bristol temple meads'],
        'bristol airport': ['bristol airport', 'airport'],
        'bristol harbour': ['bristol harbour', 'harbour'],
        'bristol docks': ['bristol docks', 'docks'],
        'spike island': ['spike island'],
        'm shed': ['m shed', 'mshed'],
        'bristol museum': ['bristol museum', 'museum'],
        'bristol aquarium': ['bristol aquarium', 'aquarium'],
        'bristol hippodrome': ['bristol hippodrome', 'hippodrome'],
        'colston hall': ['colston hall'],
        'bristol old vic': ['bristol old vic', 'old vic'],
        'watershed': ['watershed'],
        'arnolfini': ['arnolfini'],
        'bristol bridge': ['bristol bridge'],
        'prince street bridge': ['prince street bridge'],
        'perry road': ['perry road'],
        'st michaels hill': ['st michaels hill'],
        'st pauls': ['st pauls'],
        'st werburghs': ['st werburghs'],
        'st george': ['st george'],
        'fishponds': ['fishponds'],
        'kingswood': ['kingswood'],
        'downend': ['downend'],
        'mangotsfield': ['mangotsfield'],
        'staple hill': ['staple hill'],
        'brislington': ['brislington'],
        'hanham': ['hanham'],
        'keynsham': ['keynsham'],
        'bath road': ['bath road'],
        'wells road': ['wells road'],
        'church road': ['church road'],
        'north street': ['north street'],
        'east street': ['east street'],
        'west street': ['west street'],
        'south street': ['south street']
      };
      
      // Extract location from query
      let queryLocation = null;
      let locationMatch = null;
      
      // Check for direct location matches
      console.log(`Checking for location matches in query: "${lowerQuery}"`);
      for (const [location, variations] of Object.entries(bristolLocations)) {
        console.log(`Checking location: ${location} with variations:`, variations);
        const found = variations.find(variation => {
          const includes = lowerQuery.includes(variation);
          console.log(`  Checking variation "${variation}": ${includes}`);
          return includes;
        });
        if (found) {
          queryLocation = location;
          locationMatch = found;
          console.log(`✅ Location match found: ${location} for query: "${lowerQuery}"`);
          break;
        }
      }
      
      // Check for typos in location names (fuzzy matching) - DISABLED for now to show all properties
      // This was too aggressive and filtered out everything
      if (false && !queryLocation) {
        const locationNames = Object.keys(bristolLocations);
        for (const locationName of locationNames) {
          // Check if query contains a close match to location name (only check if query contains location name, not vice versa)
          if (lowerQuery.includes(locationName.substring(0, 4))) {
            queryLocation = locationName;
            locationMatch = locationName;
            console.log(`Fuzzy location match found: ${locationName} for query: "${lowerQuery}"`);
            break;
          }
        }
      }
      
      // Handle "in [location]" pattern (e.g., "2 beds in filton")
      if (!queryLocation) {
        const inLocationMatch = lowerQuery.match(/(?:in|at|near|around)\s+([a-z\s]+)/);
        if (inLocationMatch) {
          const specifiedLocation = inLocationMatch[1].trim();
          for (const [location, variations] of Object.entries(bristolLocations)) {
            const found = variations.find(variation => 
              variation.includes(specifiedLocation) || specifiedLocation.includes(variation)
            );
            if (found) {
              queryLocation = location;
              locationMatch = found;
              break;
            }
          }
        }
      }
      
      // Apply location filtering if a location was specified
      if (queryLocation) {
        console.log(`🔍 Applying location filter for: ${queryLocation}`);
        const locationVariations = bristolLocations[queryLocation];
        const isInLocation = locationVariations.some(variation => 
          property.address.toLowerCase().includes(variation)
        );
        
        console.log(`Checking property ${property.id} (${property.address}) against location ${queryLocation}:`, {
          locationVariations,
          isInLocation,
          propertyAddress: property.address.toLowerCase(),
          queryLocation,
          locationMatch
        });
        
        if (!isInLocation) {
          matches = false;
          reasons.push(`location mismatch: property in ${property.address} but query wants ${locationMatch || queryLocation}`);
        }
      } else {
        console.log(`⚠️ No location specified in query: "${lowerQuery}" - showing all properties`);
      }
      
      // Check features
      if (lowerQuery.includes('garden') && !property.features.toLowerCase().includes('garden')) {
        matches = false;
        reasons.push('missing garden feature');
      }
      if (lowerQuery.includes('parking') && !property.features.toLowerCase().includes('parking')) {
        matches = false;
        reasons.push('missing parking feature');
      }
      if (lowerQuery.includes('garage') && !property.features.toLowerCase().includes('garage')) {
        matches = false;
        reasons.push('missing garage feature');
      }
      if (lowerQuery.includes('balcony') && !property.features.toLowerCase().includes('balcony')) {
        matches = false;
        reasons.push('missing balcony feature');
      }
      if (lowerQuery.includes('period') && !property.features.toLowerCase().includes('period')) {
        matches = false;
        reasons.push('missing period features');
      }
      if (lowerQuery.includes('modern') && !property.features.toLowerCase().includes('modern')) {
        matches = false;
        reasons.push('missing modern features');
      }
      
      // Debug logging for filtered out properties
      if (!matches && reasons.length > 0) {
        console.log(`❌ Property ${property.id} (${property.address}) filtered out:`, reasons.join(', '));
      } else if (matches) {
        console.log(`✅ Property ${property.id} (${property.address}) matches query`);
      }
      
      return matches;
    });
  };

  // Helper function to get all 75 mock properties (embedded in component for now)
  const getAllLocalProperties = () => {
    // This returns the full 75 properties dataset from the searchProperties function
    // When backend is connected, this will be replaced by backend data
    
    // Note: These are the same 75 properties used in searchProperties()
    // In a production app, these would come from your backend database
    
    // For now, return the searchProperties mock data
    // This ensures we show all 75 properties on map load
    return mockPropertyData; // This will show 15 properties until we extract all 75
  };

  // Load comparable properties on map initialization
  const loadComparableProperties = async () => {
    if (!map.current) return;

    console.log('🗺️ Loading comparable properties...');
    
    try {
      // Try to get properties from backend first
      if (backendApi.status.isConnected) {
        console.log('🔗 Backend is connected, fetching all properties...');
        let allProperties = await backendApi.getProperties(); // Gets all properties with no query
        console.log(`🗺️ Found ${allProperties.length} raw properties from backend`);
        
        // Transform backend data to match expected format
        const transformedProperties = allProperties.map((prop: any) => ({
          id: prop.id,
          address: prop.property_address || '',
          postcode: '', // Not in backend data
          property_type: prop.property_type || '',
          bedrooms: prop.number_bedrooms || 0,
          bathrooms: prop.number_bathrooms || 0,
          // ✅ PRESERVE ALL PRICE FIELDS FROM BACKEND
          soldPrice: prop.sold_price || 0,
          rentPcm: prop.rent_pcm || 0,
          askingPrice: prop.asking_price || 0,
          price: prop.sold_price || prop.rent_pcm || prop.asking_price || 0, // Fallback for display
          square_feet: prop.size_sqft || 0,
          days_on_market: prop.days_on_market || 0,
          latitude: prop.latitude,
          longitude: prop.longitude,
          summary: prop.notes || `${prop.property_type || 'Property'} in ${prop.property_address || 'Unknown location'}`,
          features: prop.other_amenities || '',
          condition: prop.condition || 8, // Use backend condition if available
          epc_rating: prop.epc_rating || '',
          tenure: prop.tenure || '',
          transaction_date: prop.transaction_date || '',
          similarity: 90, // Default
          image: prop.primary_image_url || (prop.property_images && prop.property_images.length > 0 ? prop.property_images[0].url : null) || "/property-1.png",
          agent: {
            name: "John Bell",
            company: "harperjamesproperty36"
          }
        })).filter((prop: any) => prop.latitude && prop.longitude); // Only include geocoded properties
        
        console.log(`✅ Transformed ${transformedProperties.length} geocoded properties`);
        
        // 🔍 IMAGE DEBUG: Log image data for first few properties
        if (transformedProperties.length > 0) {
          console.log('🖼️ IMAGE DEBUG - Sample Properties with Image Data:', 
            transformedProperties.slice(0, 3).map(p => ({
              address: p.address,
              primary_image_url: p.image,
              has_database_image: p.image && !p.image.includes('/property-1.png'),
              image_source: p.image && p.image.includes('/property-1.png') ? 'fallback' : 'database'
            }))
          );
          
          // 🔍 RAW DATABASE DEBUG: Check what image data is coming from database
          console.log('🔍 RAW DATABASE IMAGE DEBUG - First 3 properties from backend:', 
            allProperties.slice(0, 3).map(prop => ({
              address: prop.property_address,
              primary_image_url: prop.primary_image_url,
              property_images: prop.property_images,
              image_count: prop.image_count,
              has_primary: !!prop.primary_image_url,
              has_images_array: !!(prop.property_images && prop.property_images.length > 0)
            }))
          );
        }
        
        // 🔍 PHASE 1 DEBUG: Log sample transformed properties with price data
        if (transformedProperties.length > 0) {
          console.log('🔍 PHASE 1 DEBUG - Sample Transformed Properties:', 
            transformedProperties.slice(0, 3).map(p => ({
              address: p.address,
              soldPrice: p.soldPrice,
              rentPcm: p.rentPcm,
              askingPrice: p.askingPrice,
              price: p.price,
              has_any_price: !!(p.soldPrice || p.rentPcm || p.askingPrice)
            }))
          );
        }
        
        // Set the search results and add markers
        setSearchResults(transformedProperties);
        setPropertyMarkers(transformedProperties);
        addPropertyMarkers(transformedProperties, true);
        
        console.log('✅ Backend properties loaded and displayed on map');
        return;
      }
      
      // If backend not connected, use local dataset
      console.log('🔄 Backend not connected, using local dataset...');
      
      const allProperties = getAllLocalProperties();
      
      console.log(`🗺️ Found ${allProperties.length} properties from local database`);
      
      // Set the search results and add markers
      setSearchResults(allProperties);
      setPropertyMarkers(allProperties);
      
      // Add markers to map
      console.log(`🗺️ Adding ${allProperties.length} comparable properties to map...`);
      addPropertyMarkers(allProperties, true);
      
      console.log('✅ Local properties loaded and displayed');
    } catch (error) {
      console.error('❌ Error loading properties:', error);
      
      // Final fallback to mock data
      console.log('🔄 Using minimal fallback mock data...');
      const fallbackProperties = getAllLocalProperties();
      setSearchResults(fallbackProperties);
      setPropertyMarkers(fallbackProperties);
      addPropertyMarkers(fallbackProperties, true);
    }
  };

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
      
      // Fetch properties from backend API
      console.log('🔍 Fetching properties from backend API...');
      let allProperties: any[] = await backendApi.getProperties();
      
      console.log('📦 Raw properties from backend:', allProperties);
      console.log('🏠 Properties array length:', allProperties.length);
      
      // Debug: Check for Park Street property specifically
      const parkStreetProp = allProperties.find(p => p.property_address && p.property_address.includes('Park Street'));
      if (parkStreetProp) {
        console.log('🏠 Park Street property found:', {
          address: parkStreetProp.property_address,
          sold_price: parkStreetProp.sold_price,
          asking_price: parkStreetProp.asking_price,
          rent_pcm: parkStreetProp.rent_pcm,
          allKeys: Object.keys(parkStreetProp)
        });
      } else {
        console.log('❌ Park Street property NOT found in backend response');
        console.log('Available addresses:', allProperties.map(p => p.property_address).slice(0, 5));
      }
      
      // Ensure it's an array
      if (!Array.isArray(allProperties)) {
        console.error('❌ allProperties is not an array:', allProperties);
        allProperties = [];
      }
      
      // Transform backend data to match expected format with flexible pricing
      allProperties = allProperties.map((prop: any) => {
        // Determine the best price to display and price type
        const soldPrice = prop.sold_price || 0;
        const askingPrice = prop.asking_price || 0;
        const rentPcm = prop.rent_pcm || 0;

        // 🔍 PHASE 1 DEBUG: Log raw backend data for first few properties
        if (allProperties.indexOf(prop) < 3) {
          console.log(`🔍 PHASE 1 DEBUG - Property ${allProperties.indexOf(prop) + 1}:`, {
            address: prop.property_address,
            raw_sold_price: prop.sold_price,
            raw_rent_pcm: prop.rent_pcm,
            raw_asking_price: prop.asking_price,
            extracted_soldPrice: soldPrice,
            extracted_rentPcm: rentPcm,
            extracted_askingPrice: askingPrice,
            prop_keys: Object.keys(prop),
            prop_type: typeof prop,
            full_prop_object: prop
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
          (prop.notes && prop.notes.toLowerCase().includes('letting')) ||
          (prop.notes && prop.notes.toLowerCase().includes('rent'));
        
        // Debug: Log price transformation for Park Street property
        if (prop.property_address && prop.property_address.includes('Park Street')) {
          console.log('💰 Park Street price transformation:', {
            original: {
              sold_price: prop.sold_price,
              asking_price: prop.asking_price,
              rent_pcm: prop.rent_pcm
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
        
        // Debug log for Park Street
        if (prop.property_address && prop.property_address.includes('Park Street')) {
          console.log('🔍 Park Street raw data:', {
            sold_price: prop.sold_price,
            asking_price: prop.asking_price,
            rent_pcm: prop.rent_pcm
          });
        }
        
        const transformedProperty = {
          id: prop.id,
          address: prop.property_address || '',
          postcode: '', // Not in backend data
          property_type: prop.property_type || '',
          bedrooms: prop.number_bedrooms || 0,
          bathrooms: prop.number_bathrooms || 0,
          price: displayPrice,
          priceType: priceType,
          priceLabel: priceLabel,
          soldPrice: soldPrice,
          askingPrice: askingPrice,
          rentPcm: rentPcm,
          isLettingComparable: isLettingComparable,
          square_feet: prop.size_sqft || 0,
          days_on_market: prop.days_on_market || 0,
          latitude: prop.latitude,
          longitude: prop.longitude,
          summary: prop.notes || `${prop.property_type || 'Property'} in ${prop.property_address || 'Unknown location'}`,
          features: prop.other_amenities || '',
          condition: 8, // Default
          similarity: 90, // Default
          image: prop.primary_image_url || (prop.property_images && prop.property_images.length > 0 ? prop.property_images[0].url : null) || "/property-1.png",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        };

        // 🔍 IMAGE DEBUG: Log image data for first few properties
        if (allProperties.indexOf(prop) < 3) {
          console.log(`🖼️ IMAGE DEBUG - Property ${allProperties.indexOf(prop) + 1}:`, {
            address: transformedProperty.address,
            primary_image_url: prop.primary_image_url,
            property_images: prop.property_images,
            image_count: prop.image_count,
            final_image: transformedProperty.image,
            has_database_image: transformedProperty.image && !transformedProperty.image.includes('/property-1.png'),
            image_source: transformedProperty.image && transformedProperty.image.includes('/property-1.png') ? 'fallback' : 'database'
          });
          
          // 🔍 RAW DATABASE DEBUG: Check what image data is coming from database
          console.log(`🔍 RAW DATABASE IMAGE DEBUG - Property ${allProperties.indexOf(prop) + 1} from backend:`, {
            address: prop.property_address,
            primary_image_url: prop.primary_image_url,
            property_images: prop.property_images,
            image_count: prop.image_count,
            has_primary: !!prop.primary_image_url,
            has_images_array: !!(prop.property_images && prop.property_images.length > 0),
            all_keys: Object.keys(prop).filter(key => key.includes('image') || key.includes('Image'))
          });
        }

        // 🔍 PHASE 1 DEBUG: Log final transformed property for first few
        if (allProperties.indexOf(prop) < 3) {
          console.log(`🔍 PHASE 1 DEBUG - Transformed Property ${allProperties.indexOf(prop) + 1}:`, {
            address: transformedProperty.address,
            soldPrice: transformedProperty.soldPrice,
            rentPcm: transformedProperty.rentPcm,
            askingPrice: transformedProperty.askingPrice,
            displayPrice: transformedProperty.price,
            priceType: transformedProperty.priceType
          });
        }

        return transformedProperty;
      }).filter((prop: any) => prop.latitude && prop.longitude); // Only include geocoded properties
      
      console.log(`🏠 Loaded ${allProperties.length} geocoded properties from Supabase`);
      
      // Debug: Check final Park Street property after transformation
      const finalParkStreetProp = allProperties.find(p => p.address && p.address.includes('Park Street'));
      if (finalParkStreetProp) {
        console.log('🏠 Final Park Street property after transformation:', {
          address: finalParkStreetProp.address,
          price: finalParkStreetProp.price,
          priceType: finalParkStreetProp.priceType,
          priceLabel: finalParkStreetProp.priceLabel,
          rentPcm: finalParkStreetProp.rentPcm,
          isLettingComparable: finalParkStreetProp.isLettingComparable
        });
      }
      
      // Use the properties directly from backend (no mock fallback)
      const propertiesToDisplay = allProperties;
      
      // If backend returns no properties, log it but don't use mock data
      if (propertiesToDisplay.length === 0) {
        console.warn('⚠️ No properties found in Supabase. Upload documents to see properties on map.');
      }
      
      // REMOVED: 1,656 lines of hardcoded mock data
      // Now using real data from Supabase
      
      const mockProperties = propertiesToDisplay; // Renamed for compatibility with existing code below
      
      // Skip the huge mock data array - commented out for reference
      const _oldMockProperties = [
        {
          id: 1,
          address: "24 Runthorpe Road, Clifton, Bristol",
          postcode: "BS8 2AB",
          property_type: "Semi-Detached",
          bedrooms: 3,
          bathrooms: 2,
          price: 450000,
          square_feet: 1200,
          days_on_market: 45,
          latitude: 51.4600,
          longitude: -2.6100,
          summary: "Beautiful 3-bedroom semi-detached house in Clifton",
          features: "Garden, Parking, Modern Kitchen",
          condition: 8,
          similarity: 95,
          image: "/property-1.png",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 2,
          address: "15 Clifton Park, Clifton, Bristol",
          postcode: "BS8 3CD",
          property_type: "Detached",
          bedrooms: 3,
          bathrooms: 2,
          price: 550000,
          square_feet: 1400,
          days_on_market: 23,
          latitude: 51.4610,
          longitude: -2.6120,
          summary: "Stunning 3-bedroom detached house with garden",
          features: "Large Garden, Garage, En-suite",
          condition: 9,
          similarity: 92,
          image: "https://images.unsplash.com/photo-1600607687644-c7171b42498b?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 3,
          address: "8 Clifton Road, Clifton, Bristol",
          postcode: "BS8 4EF",
          property_type: "Terraced",
          bedrooms: 3,
          bathrooms: 1,
          price: 380000,
          square_feet: 1100,
          days_on_market: 67,
          latitude: 51.4625,
          longitude: -2.6129,
          summary: "Charming 3-bedroom terraced house",
          features: "Period Features, Close to Station",
          condition: 7,
          similarity: 88,
          image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 4,
          address: "42 Clifton Hill, Clifton, Bristol",
          postcode: "BS8 4JX",
          property_type: "Semi-Detached",
          bedrooms: 2,
          bathrooms: 1,
          price: 320000,
          square_feet: 850,
          days_on_market: 34,
          latitude: 51.4685,
          longitude: -2.6149,
          summary: "Modern 2-bedroom semi-detached house",
          features: "Off-street Parking, Garden, Modern Bathroom",
          condition: 8,
          similarity: 90,
          image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 5,
          address: "17 Clifton Village, Clifton, Bristol",
          postcode: "BS8 4AB",
          property_type: "Terraced",
          bedrooms: 3,
          bathrooms: 1,
          price: 360000,
          square_feet: 1050,
          days_on_market: 56,
          latitude: 51.4705,
          longitude: -2.6179,
          summary: "Victorian 3-bedroom terraced house",
          features: "Period Features, High Ceilings, Garden",
          condition: 6,
          similarity: 85,
          image: "https://images.unsplash.com/photo-1600566753190-17f63ba4f6fd?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 6,
          address: "9 Clifton Gardens, Clifton, Bristol",
          postcode: "BS8 4EF",
          property_type: "Semi-Detached",
          bedrooms: 3,
          bathrooms: 2,
          price: 480000,
          square_feet: 1300,
          days_on_market: 28,
          latitude: 51.4725,
          longitude: -2.6209,
          summary: "Contemporary 3-bedroom semi-detached house",
          features: "Open Plan Living, Garden, Parking",
          condition: 9,
          similarity: 93,
          image: "https://images.unsplash.com/photo-1600566753086-5f6b2b2b2b2b?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        // Add more diverse properties for testing
        {
          id: 7,
          address: "12 Harbourside, Bristol",
          postcode: "BS1 5AB",
          property_type: "Apartment",
          bedrooms: 2,
          bathrooms: 2,
          price: 380000,
          square_feet: 1100,
          days_on_market: 23,
          latitude: 51.4500,
          longitude: -2.6000,
          summary: "Modern 2-bedroom apartment with harbour views",
          features: "Harbour Views, Balcony, Underground Parking",
          condition: 9,
          similarity: 89,
          image: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
          agent: {
            name: "Lisa Chen",
            company: "harbourhomes"
          }
        },
        {
          id: 8,
          address: "25 Harbourside, Bristol",
          postcode: "BS1 5CD",
          property_type: "Apartment",
          bedrooms: 3,
          bathrooms: 2,
          price: 520000,
          square_feet: 1400,
          days_on_market: 15,
          latitude: 51.4510,
          longitude: -2.6010,
          summary: "Luxury 3-bedroom apartment with panoramic harbour views",
          features: "Panoramic Harbour Views, Private Balcony, Concierge",
          condition: 10,
          similarity: 96,
          image: "https://images.unsplash.com/photo-1600607687644-c7171b42498b?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
          agent: {
            name: "Michael Brown",
            company: "harbourhomes"
          }
        },
        {
          id: 9,
          address: "8 Redland Road, Redland, Bristol",
          postcode: "BS6 6AB",
          property_type: "Semi-Detached",
          bedrooms: 4,
          bathrooms: 2,
          price: 650000,
          square_feet: 1600,
          days_on_market: 8,
          latitude: 51.4700,
          longitude: -2.5800,
          summary: "Spacious 4-bedroom semi-detached family home",
          features: "Garden, Parking, Period Features, Modern Kitchen",
          condition: 9,
          similarity: 92,
          image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
          agent: {
            name: "David Thompson",
            company: "redlandproperties"
          }
        },
        {
          id: 10,
          address: "15 Montpelier Hill, Montpelier, Bristol",
          postcode: "BS6 5EF",
          property_type: "Terraced",
          bedrooms: 2,
          bathrooms: 1,
          price: 320000,
          square_feet: 900,
          days_on_market: 45,
          latitude: 51.4720,
          longitude: -2.5820,
          summary: "Charming 2-bedroom Victorian terraced house",
          features: "Period Features, High Ceilings, Garden",
          condition: 7,
          similarity: 85,
          image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
          agent: {
            name: "Sarah Wilson",
            company: "montpelierestates"
          }
        },
        {
          id: 11,
          address: "22 Bedminster Parade, Bedminster, Bristol",
          postcode: "BS3 4GH",
          property_type: "Detached",
          bedrooms: 3,
          bathrooms: 3,
          price: 480000,
          square_feet: 1300,
          days_on_market: 30,
          latitude: 51.4400,
          longitude: -2.5900,
          summary: "Modern 3-bedroom detached house with en-suite",
          features: "En-suite, Garage, Garden, Modern Kitchen",
          condition: 8,
          similarity: 88,
          image: "https://images.unsplash.com/photo-1600607687644-c7171b42498b?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
          agent: {
            name: "James Roberts",
            company: "bedminsterhomes"
          }
        },
        {
          id: 12,
          address: "7 Stokes Croft, Stokes Croft, Bristol",
          postcode: "BS1 3IJ",
          property_type: "Apartment",
          bedrooms: 1,
          bathrooms: 1,
          price: 280000,
          square_feet: 600,
          days_on_market: 20,
          latitude: 51.4630,
          longitude: -2.5900,
          summary: "Stylish 1-bedroom apartment in vibrant area",
          features: "Modern Design, Balcony, Lift Access",
          condition: 8,
          similarity: 82,
          image: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
          agent: {
            name: "Emma Davis",
            company: "stokescroftproperties"
          }
        },
        {
          id: 13,
          address: "33 Easton Way, Easton, Bristol",
          postcode: "BS5 6KL",
          property_type: "Terraced",
          bedrooms: 4,
          bathrooms: 2,
          price: 420000,
          square_feet: 1500,
          days_on_market: 35,
          latitude: 51.4600,
          longitude: -2.5700,
          summary: "Victorian 4-bedroom terraced house with character",
          features: "Period Features, Garden, Parking, High Ceilings",
          condition: 7,
          similarity: 87,
          image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
          agent: {
            name: "Tom Anderson",
            company: "eastonhomes"
          }
        },
        {
          id: 14,
          address: "18 Hotwells Road, Hotwells, Bristol",
          postcode: "BS8 4MN",
          property_type: "Semi-Detached",
          bedrooms: 3,
          bathrooms: 1,
          price: 390000,
          square_feet: 1200,
          days_on_market: 25,
          latitude: 51.4480,
          longitude: -2.5950,
          summary: "3-bedroom semi-detached house near harbour",
          features: "Harbour Views, Garden, Period Features",
          condition: 8,
          similarity: 86,
          image: "https://images.unsplash.com/photo-1600607687644-c7171b42498b?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
          agent: {
            name: "Rachel Green",
            company: "hotwellsproperties"
          }
        },
        {
          id: 15,
          address: "5 Cotham Hill, Cotham, Bristol",
          postcode: "BS6 6OP",
          property_type: "Detached",
          bedrooms: 5,
          bathrooms: 4,
          price: 850000,
          square_feet: 2000,
          days_on_market: 10,
          latitude: 51.4750,
          longitude: -2.5780,
          summary: "Luxury 5-bedroom detached house with multiple bathrooms",
          features: "Multiple Bathrooms, Large Garden, Garage, Study, En-suite",
          condition: 10,
          similarity: 95,
          image: "https://images.unsplash.com/photo-1600566753086-5f6b2b2b2b2b?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
          agent: {
            name: "Mark Johnson",
            company: "cothamestates"
          }
        },
        // Additional properties for testing
        {
          id: 16,
          address: "12 Whiteladies Road, Clifton, Bristol",
          postcode: "BS8 2BS",
          property_type: "Apartment",
          bedrooms: 2,
          bathrooms: 2,
          price: 350000,
          square_feet: 800,
          days_on_market: 23,
          latitude: 51.4660,
          longitude: -2.6120,
          summary: "Modern 2-bedroom apartment with balcony",
          features: "Balcony, Parking, Modern Kitchen, En-suite",
          condition: 9,
          similarity: 88,
          image: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "cliftonapartments"
          }
        },
        {
          id: 17,
          address: "8 Royal York Crescent, Clifton, Bristol",
          postcode: "BS8 4EF",
          property_type: "Terraced",
          bedrooms: 4,
          bathrooms: 2,
          price: 650000,
          square_feet: 1800,
          days_on_market: 12,
          latitude: 51.4635,
          longitude: -2.6085,
          summary: "Stunning 4-bedroom period terraced house",
          features: "Period Features, Garden, Parking, Study",
          condition: 9,
          similarity: 92,
          image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 18,
          address: "25 Clifton Hill, Clifton, Bristol",
          postcode: "BS8 1JX",
          property_type: "Semi-Detached",
          bedrooms: 2,
          bathrooms: 1,
          price: 380000,
          square_feet: 900,
          days_on_market: 45,
          latitude: 51.4660,
          longitude: -2.6110,
          summary: "Charming 2-bedroom semi-detached house",
          features: "Garden, Parking, Period Features",
          condition: 7,
          similarity: 85,
          image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 19,
          address: "3 Clifton Down, Clifton, Bristol",
          postcode: "BS8 3AB",
          property_type: "Detached",
          bedrooms: 5,
          bathrooms: 4,
          price: 950000,
          square_feet: 2500,
          days_on_market: 8,
          latitude: 51.4620,
          longitude: -2.6070,
          summary: "Luxury 5-bedroom detached house with views",
          features: "Harbour Views, Garden, Garage, Study, En-suite",
          condition: 10,
          similarity: 96,
          image: "https://images.unsplash.com/photo-1600607687644-c7171b42498b?w=400&h=300&fit=crop",
          agent: {
            name: "Mark Johnson",
            company: "cothamestates"
          }
        },
        {
          id: 20,
          address: "15 Clifton Village, Clifton, Bristol",
          postcode: "BS8 4KL",
          property_type: "Terraced",
          bedrooms: 3,
          bathrooms: 2,
          price: 520000,
          square_feet: 1400,
          days_on_market: 34,
          latitude: 51.4655,
          longitude: -2.6090,
          summary: "Elegant 3-bedroom terraced house",
          features: "Garden, Parking, Period Features, Modern Kitchen",
          condition: 8,
          similarity: 89,
          image: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 21,
          address: "7 Clifton Gardens, Clifton, Bristol",
          postcode: "BS8 4CD",
          property_type: "Detached",
          bedrooms: 4,
          bathrooms: 3,
          price: 780000,
          square_feet: 2000,
          days_on_market: 19,
          latitude: 51.4615,
          longitude: -2.6060,
          summary: "Spacious 4-bedroom detached house",
          features: "Large Garden, Garage, En-suite, Study",
          condition: 9,
          similarity: 94,
          image: "https://images.unsplash.com/photo-1600566753086-5f6b2b2b2b2b?w=400&h=300&fit=crop",
          agent: {
            name: "Mark Johnson",
            company: "cothamestates"
          }
        },
        {
          id: 22,
          address: "42 Clifton Street, Clifton, Bristol",
          postcode: "BS8 4EF",
          property_type: "Terraced",
          bedrooms: 2,
          bathrooms: 1,
          price: 320000,
          square_feet: 750,
          days_on_market: 67,
          latitude: 51.4630,
          longitude: -2.6100,
          summary: "Cozy 2-bedroom terraced house",
          features: "Period Features, Garden",
          condition: 6,
          similarity: 82,
          image: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 23,
          address: "18 Clifton Avenue, Clifton, Bristol",
          postcode: "BS8 4GH",
          property_type: "Semi-Detached",
          bedrooms: 3,
          bathrooms: 2,
          price: 480000,
          square_feet: 1300,
          days_on_market: 28,
          latitude: 51.4670,
          longitude: -2.6130,
          summary: "Modern 3-bedroom semi-detached house",
          features: "Parking, Garden, Modern Kitchen, En-suite",
          condition: 8,
          similarity: 91,
          image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 24,
          address: "31 Clifton Hill, Clifton, Bristol",
          postcode: "BS8 4IJ",
          property_type: "Terraced",
          bedrooms: 4,
          bathrooms: 2,
          price: 580000,
          square_feet: 1600,
          days_on_market: 41,
          latitude: 51.4665,
          longitude: -2.6115,
          summary: "Victorian 4-bedroom terraced house",
          features: "Period Features, Garden, Parking, Study",
          condition: 8,
          similarity: 87,
          image: "https://images.unsplash.com/photo-1600607687644-c7171b42498b?w=400&h=300&fit=crop",
          agent: {
            name: "Mark Johnson",
            company: "cothamestates"
          }
        },
        {
          id: 25,
          address: "9 Clifton Park, Clifton, Bristol",
          postcode: "BS8 3CD",
          property_type: "Detached",
          bedrooms: 3,
          bathrooms: 2,
          price: 620000,
          square_feet: 1500,
          days_on_market: 15,
          latitude: 51.4665,
          longitude: -2.6079,
          summary: "Contemporary 3-bedroom detached house",
          features: "Large Garden, Garage, Modern Kitchen, En-suite",
          condition: 9,
          similarity: 93,
          image: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 26,
          address: "14 Whiteladies Road, Clifton, Bristol",
          postcode: "BS8 2BT",
          property_type: "Apartment",
          bedrooms: 1,
          bathrooms: 1,
          price: 280000,
          square_feet: 600,
          days_on_market: 52,
          latitude: 51.4665,
          longitude: -2.6125,
          summary: "Compact 1-bedroom apartment",
          features: "Modern Kitchen, Parking, Balcony",
          condition: 7,
          similarity: 78,
          image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "cliftonapartments"
          }
        },
        {
          id: 27,
          address: "22 Clifton Road, Clifton, Bristol",
          postcode: "BS8 4EF",
          property_type: "Semi-Detached",
          bedrooms: 2,
          bathrooms: 1,
          price: 360000,
          square_feet: 850,
          days_on_market: 38,
          latitude: 51.4625,
          longitude: -2.6119,
          summary: "Charming 2-bedroom semi-detached house",
          features: "Garden, Parking, Period Features",
          condition: 7,
          similarity: 84,
          image: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 28,
          address: "6 Clifton Village, Clifton, Bristol",
          postcode: "BS8 4AB",
          property_type: "Terraced",
          bedrooms: 5,
          bathrooms: 3,
          price: 750000,
          square_feet: 2200,
          days_on_market: 6,
          latitude: 51.4655,
          longitude: -2.6095,
          summary: "Grand 5-bedroom period terraced house",
          features: "Period Features, Large Garden, Study, En-suite",
          condition: 9,
          similarity: 95,
          image: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=400&h=300&fit=crop",
          agent: {
            name: "Mark Johnson",
            company: "cothamestates"
          }
        },
        {
          id: 29,
          address: "33 Clifton Hill, Clifton, Bristol",
          postcode: "BS8 4JX",
          property_type: "Semi-Detached",
          bedrooms: 3,
          bathrooms: 2,
          price: 440000,
          square_feet: 1200,
          days_on_market: 29,
          latitude: 51.4685,
          longitude: -2.6149,
          summary: "Well-presented 3-bedroom semi-detached house",
          features: "Off-street Parking, Garden, Modern Bathroom",
          condition: 8,
          similarity: 90,
          image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 30,
          address: "11 Clifton Gardens, Clifton, Bristol",
          postcode: "BS8 4CD",
          property_type: "Detached",
          bedrooms: 4,
          bathrooms: 3,
          price: 720000,
          square_feet: 1900,
          days_on_market: 22,
          latitude: 51.4615,
          longitude: -2.6060,
          summary: "Elegant 4-bedroom detached house",
          features: "Garden, Garage, En-suite, Study, Modern Kitchen",
          condition: 9,
          similarity: 92,
          image: "https://images.unsplash.com/photo-1600566753086-5f6b2b2b2b2b?w=400&h=300&fit=crop",
          agent: {
            name: "Mark Johnson",
            company: "cothamestates"
          }
        },
        // Additional properties spread across Bristol - Clifton to Filton area
        {
          id: 31,
          address: "45 Whiteladies Road, Clifton, Bristol",
          postcode: "BS8 2BU",
          property_type: "Apartment",
          bedrooms: 3,
          bathrooms: 2,
          price: 420000,
          square_feet: 1000,
          days_on_market: 18,
          latitude: 51.4670,
          longitude: -2.6130,
          summary: "Spacious 3-bedroom apartment with city views",
          features: "City Views, Balcony, Parking, Modern Kitchen",
          condition: 8,
          similarity: 89,
          image: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "cliftonapartments"
          }
        },
        {
          id: 32,
          address: "12 Cotham Hill, Cotham, Bristol",
          postcode: "BS6 6OQ",
          property_type: "Terraced",
          bedrooms: 3,
          bathrooms: 1,
          price: 380000,
          square_feet: 1100,
          days_on_market: 42,
          latitude: 51.4610,
          longitude: -2.6010,
          summary: "Victorian 3-bedroom terraced house near university",
          features: "Period Features, Garden, Close to University",
          condition: 7,
          similarity: 85,
          image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop",
          agent: {
            name: "Mark Johnson",
            company: "cothamestates"
          }
        },
        {
          id: 33,
          address: "8 Redland Road, Redland, Bristol",
          postcode: "BS6 6QP",
          property_type: "Semi-Detached",
          bedrooms: 4,
          bathrooms: 2,
          price: 520000,
          square_feet: 1500,
          days_on_market: 25,
          latitude: 51.4630,
          longitude: -2.6030,
          summary: "Elegant 4-bedroom semi-detached house in Redland",
          features: "Garden, Parking, Period Features, Study",
          condition: 8,
          similarity: 91,
          image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 34,
          address: "25 Gloucester Road, Bishopston, Bristol",
          postcode: "BS7 8AB",
          property_type: "Terraced",
          bedrooms: 2,
          bathrooms: 1,
          price: 320000,
          square_feet: 800,
          days_on_market: 55,
          latitude: 51.4650,
          longitude: -2.6050,
          summary: "Charming 2-bedroom terraced house on Gloucester Road",
          features: "Period Features, Garden, High Street Location",
          condition: 6,
          similarity: 82,
          image: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 35,
          address: "15 Ashley Down Road, Ashley Down, Bristol",
          postcode: "BS7 9CD",
          property_type: "Detached",
          bedrooms: 3,
          bathrooms: 2,
          price: 480000,
          square_feet: 1300,
          days_on_market: 32,
          latitude: 51.4680,
          longitude: -2.6080,
          summary: "Modern 3-bedroom detached house in Ashley Down",
          features: "Large Garden, Garage, Modern Kitchen, En-suite",
          condition: 8,
          similarity: 88,
          image: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=400&h=300&fit=crop",
          agent: {
            name: "Mark Johnson",
            company: "cothamestates"
          }
        },
        {
          id: 36,
          address: "7 Filton Avenue, Filton, Bristol",
          postcode: "BS7 0EF",
          property_type: "Semi-Detached",
          bedrooms: 3,
          bathrooms: 1,
          price: 350000,
          square_feet: 1000,
          days_on_market: 28,
          latitude: 51.4800,
          longitude: -2.5800,
          summary: "Well-maintained 3-bedroom semi-detached house in Filton",
          features: "Garden, Parking, Close to Airport",
          condition: 7,
          similarity: 84,
          image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "filtonproperties"
          }
        },
        {
          id: 37,
          address: "22 Horfield Common, Horfield, Bristol",
          postcode: "BS7 8GH",
          property_type: "Terraced",
          bedrooms: 4,
          bathrooms: 2,
          price: 450000,
          square_feet: 1400,
          days_on_market: 19,
          latitude: 51.4800,
          longitude: -2.5800,
          summary: "Victorian 4-bedroom terraced house near common",
          features: "Period Features, Garden, Parking, Study",
          condition: 8,
          similarity: 87,
          image: "https://images.unsplash.com/photo-1600607687644-c7171b42498b?w=400&h=300&fit=crop",
          agent: {
            name: "Mark Johnson",
            company: "cothamestates"
          }
        },
        {
          id: 38,
          address: "3 Stoke Bishop Road, Stoke Bishop, Bristol",
          postcode: "BS9 1IJ",
          property_type: "Detached",
          bedrooms: 5,
          bathrooms: 3,
          price: 850000,
          square_feet: 2200,
          days_on_market: 12,
          latitude: 51.4750,
          longitude: -2.6150,
          summary: "Luxury 5-bedroom detached house in Stoke Bishop",
          features: "Large Garden, Garage, Study, En-suite, Views",
          condition: 9,
          similarity: 94,
          image: "https://images.unsplash.com/photo-1600566753086-5f6b2b2b2b2b?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 39,
          address: "18 Henleaze Road, Henleaze, Bristol",
          postcode: "BS9 4KL",
          property_type: "Semi-Detached",
          bedrooms: 3,
          bathrooms: 2,
          price: 420000,
          square_feet: 1200,
          days_on_market: 35,
          latitude: 51.4780,
          longitude: -2.6180,
          summary: "Family 3-bedroom semi-detached house in Henleaze",
          features: "Garden, Parking, Modern Kitchen, Close to Schools",
          condition: 8,
          similarity: 86,
          image: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "henleazeproperties"
          }
        },
        {
          id: 40,
          address: "5 Westbury Park, Westbury Park, Bristol",
          postcode: "BS6 7MN",
          property_type: "Terraced",
          bedrooms: 2,
          bathrooms: 1,
          price: 380000,
          square_feet: 900,
          days_on_market: 48,
          latitude: 51.4800,
          longitude: -2.6200,
          summary: "Charming 2-bedroom terraced house in Westbury Park",
          features: "Period Features, Garden, Village Location",
          condition: 7,
          similarity: 83,
          image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 41,
          address: "12 Filton High Street, Filton, Bristol",
          postcode: "BS7 0OP",
          property_type: "Apartment",
          bedrooms: 2,
          bathrooms: 2,
          price: 280000,
          square_feet: 700,
          days_on_market: 62,
          latitude: 51.4800,
          longitude: -2.5800,
          summary: "Modern 2-bedroom apartment in Filton town center",
          features: "Modern Kitchen, Parking, Close to Shops",
          condition: 7,
          similarity: 79,
          image: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "filtonproperties"
          }
        },
        {
          id: 42,
          address: "27 Clifton Down, Clifton, Bristol",
          postcode: "BS8 3QR",
          property_type: "Detached",
          bedrooms: 4,
          bathrooms: 3,
          price: 720000,
          square_feet: 1800,
          days_on_market: 16,
          latitude: 51.4600,
          longitude: -2.6050,
          summary: "Elegant 4-bedroom detached house with harbour views",
          features: "Harbour Views, Garden, Garage, Study, En-suite",
          condition: 9,
          similarity: 93,
          image: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=400&h=300&fit=crop",
          agent: {
            name: "Mark Johnson",
            company: "cothamestates"
          }
        },
        {
          id: 43,
          address: "9 Redland Park, Redland, Bristol",
          postcode: "BS6 6ST",
          property_type: "Semi-Detached",
          bedrooms: 3,
          bathrooms: 2,
          price: 460000,
          square_feet: 1250,
          days_on_market: 24,
          latitude: 51.4640,
          longitude: -2.6040,
          summary: "Victorian 3-bedroom semi-detached house in Redland",
          features: "Period Features, Garden, Parking, Modern Kitchen",
          condition: 8,
          similarity: 89,
          image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 44,
          address: "14 Bishopston Road, Bishopston, Bristol",
          postcode: "BS7 8UV",
          property_type: "Terraced",
          bedrooms: 2,
          bathrooms: 1,
          price: 340000,
          square_feet: 850,
          days_on_market: 41,
          latitude: 51.4660,
          longitude: -2.6060,
          summary: "Character 2-bedroom terraced house in Bishopston",
          features: "Period Features, Garden, High Street Location",
          condition: 7,
          similarity: 81,
          image: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 45,
          address: "6 Filton Road, Filton, Bristol",
          postcode: "BS7 0WX",
          property_type: "Detached",
          bedrooms: 4,
          bathrooms: 2,
          price: 520000,
          square_feet: 1600,
          days_on_market: 22,
          latitude: 51.4800,
          longitude: -2.5800,
          summary: "Spacious 4-bedroom detached house in Filton",
          features: "Large Garden, Garage, Modern Kitchen, Study",
          condition: 8,
          similarity: 87,
          image: "https://images.unsplash.com/photo-1600566753086-5f6b2b2b2b2b?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "filtonproperties"
          }
        },
        {
          id: 46,
          address: "21 Cotham Brow, Cotham, Bristol",
          postcode: "BS6 6YZ",
          property_type: "Terraced",
          bedrooms: 3,
          bathrooms: 1,
          price: 400000,
          square_feet: 1100,
          days_on_market: 38,
          latitude: 51.4620,
          longitude: -2.6020,
          summary: "Victorian 3-bedroom terraced house in Cotham",
          features: "Period Features, Garden, Close to University",
          condition: 7,
          similarity: 84,
          image: "https://images.unsplash.com/photo-1600607687644-c7171b42498b?w=400&h=300&fit=crop",
          agent: {
            name: "Mark Johnson",
            company: "cothamestates"
          }
        },
        {
          id: 47,
          address: "33 Ashley Hill, Ashley Down, Bristol",
          postcode: "BS7 9AB",
          property_type: "Semi-Detached",
          bedrooms: 2,
          bathrooms: 1,
          price: 360000,
          square_feet: 950,
          days_on_market: 45,
          latitude: 51.4690,
          longitude: -2.6090,
          summary: "Well-presented 2-bedroom semi-detached house",
          features: "Garden, Parking, Modern Kitchen",
          condition: 7,
          similarity: 82,
          image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 48,
          address: "17 Filton Hill, Filton, Bristol",
          postcode: "BS7 0CD",
          property_type: "Terraced",
          bedrooms: 4,
          bathrooms: 2,
          price: 420000,
          square_feet: 1300,
          days_on_market: 31,
          latitude: 51.4800,
          longitude: -2.5800,
          summary: "Victorian 4-bedroom terraced house in Filton",
          features: "Period Features, Garden, Parking, Study",
          condition: 8,
          similarity: 86,
          image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "filtonproperties"
          }
        },
        {
          id: 49,
          address: "11 Stoke Bishop Lane, Stoke Bishop, Bristol",
          postcode: "BS9 2EF",
          property_type: "Detached",
          bedrooms: 3,
          bathrooms: 2,
          price: 580000,
          square_feet: 1400,
          days_on_market: 14,
          latitude: 51.4770,
          longitude: -2.6170,
          summary: "Modern 3-bedroom detached house in Stoke Bishop",
          features: "Garden, Garage, Modern Kitchen, En-suite",
          condition: 8,
          similarity: 90,
          image: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 50,
          address: "29 Henleaze Gardens, Henleaze, Bristol",
          postcode: "BS9 5GH",
          property_type: "Semi-Detached",
          bedrooms: 4,
          bathrooms: 2,
          price: 480000,
          square_feet: 1350,
          days_on_market: 27,
          latitude: 51.4790,
          longitude: -2.6190,
          summary: "Family 4-bedroom semi-detached house in Henleaze",
          features: "Garden, Parking, Study, Close to Schools",
          condition: 8,
          similarity: 88,
          image: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "henleazeproperties"
          }
        },
        {
          id: 51,
          address: "4 Westbury Hill, Westbury Park, Bristol",
          postcode: "BS6 7IJ",
          property_type: "Terraced",
          bedrooms: 3,
          bathrooms: 1,
          price: 420000,
          square_feet: 1000,
          days_on_market: 33,
          latitude: 51.4810,
          longitude: -2.6210,
          summary: "Victorian 3-bedroom terraced house in Westbury Park",
          features: "Period Features, Garden, Village Location",
          condition: 7,
          similarity: 85,
          image: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 52,
          address: "8 Filton Avenue, Filton, Bristol",
          postcode: "BS7 0KL",
          property_type: "Apartment",
          bedrooms: 1,
          bathrooms: 1,
          price: 220000,
          square_feet: 550,
          days_on_market: 58,
          latitude: 51.4800,
          longitude: -2.5800,
          summary: "Compact 1-bedroom apartment in Filton",
          features: "Modern Kitchen, Parking, Close to Airport",
          condition: 6,
          similarity: 76,
          image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "filtonproperties"
          }
        },
        {
          id: 53,
          address: "15 Horfield Road, Horfield, Bristol",
          postcode: "BS7 8MN",
          property_type: "Semi-Detached",
          bedrooms: 3,
          bathrooms: 2,
          price: 400000,
          square_feet: 1150,
          days_on_market: 29,
          latitude: 51.4810,
          longitude: -2.5810,
          summary: "Victorian 3-bedroom semi-detached house in Horfield",
          features: "Period Features, Garden, Parking, Modern Kitchen",
          condition: 7,
          similarity: 83,
          image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop",
          agent: {
            name: "Mark Johnson",
            company: "cothamestates"
          }
        },
        {
          id: 54,
          address: "23 Stoke Bishop Road, Stoke Bishop, Bristol",
          postcode: "BS9 3OP",
          property_type: "Detached",
          bedrooms: 5,
          bathrooms: 3,
          price: 780000,
          square_feet: 2000,
          days_on_market: 8,
          latitude: 51.4740,
          longitude: -2.6140,
          summary: "Luxury 5-bedroom detached house in Stoke Bishop",
          features: "Large Garden, Garage, Study, En-suite, Views",
          condition: 9,
          similarity: 95,
          image: "https://images.unsplash.com/photo-1600566753086-5f6b2b2b2b2b?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 55,
          address: "7 Henleaze Road, Henleaze, Bristol",
          postcode: "BS9 4QR",
          property_type: "Terraced",
          bedrooms: 2,
          bathrooms: 1,
          price: 350000,
          square_feet: 800,
          days_on_market: 42,
          latitude: 51.4800,
          longitude: -2.6200,
          summary: "Charming 2-bedroom terraced house in Henleaze",
          features: "Period Features, Garden, Close to Schools",
          condition: 7,
          similarity: 80,
          image: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "henleazeproperties"
          }
        },
        {
          id: 56,
          address: "19 Westbury Park Road, Westbury Park, Bristol",
          postcode: "BS6 8ST",
          property_type: "Semi-Detached",
          bedrooms: 4,
          bathrooms: 2,
          price: 520000,
          square_feet: 1450,
          days_on_market: 21,
          latitude: 51.4820,
          longitude: -2.6220,
          summary: "Victorian 4-bedroom semi-detached house in Westbury Park",
          features: "Period Features, Garden, Parking, Study",
          condition: 8,
          similarity: 89,
          image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 57,
          address: "31 Filton High Street, Filton, Bristol",
          postcode: "BS7 0UV",
          property_type: "Terraced",
          bedrooms: 3,
          bathrooms: 1,
          price: 320000,
          square_feet: 900,
          days_on_market: 47,
          latitude: 51.4800,
          longitude: -2.5800,
          summary: "Victorian 3-bedroom terraced house in Filton town center",
          features: "Period Features, Garden, High Street Location",
          condition: 6,
          similarity: 78,
          image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "filtonproperties"
          }
        },
        {
          id: 58,
          address: "13 Clifton Down Road, Clifton, Bristol",
          postcode: "BS8 3WX",
          property_type: "Detached",
          bedrooms: 3,
          bathrooms: 2,
          price: 650000,
          square_feet: 1600,
          days_on_market: 11,
          latitude: 51.4590,
          longitude: -2.6020,
          summary: "Contemporary 3-bedroom detached house with views",
          features: "Harbour Views, Garden, Garage, Modern Kitchen",
          condition: 9,
          similarity: 92,
          image: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=400&h=300&fit=crop",
          agent: {
            name: "Mark Johnson",
            company: "cothamestates"
          }
        },
        {
          id: 59,
          address: "25 Redland Road, Redland, Bristol",
          postcode: "BS6 6YZ",
          property_type: "Terraced",
          bedrooms: 4,
          bathrooms: 2,
          price: 480000,
          square_feet: 1300,
          days_on_market: 26,
          latitude: 51.4650,
          longitude: -2.6050,
          summary: "Victorian 4-bedroom terraced house in Redland",
          features: "Period Features, Garden, Parking, Study",
          condition: 8,
          similarity: 87,
          image: "https://images.unsplash.com/photo-1600607687644-c7171b42498b?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        {
          id: 60,
          address: "5 Bishopston Road, Bishopston, Bristol",
          postcode: "BS7 8AB",
          property_type: "Semi-Detached",
          bedrooms: 2,
          bathrooms: 1,
          price: 340000,
          square_feet: 850,
          days_on_market: 39,
          latitude: 51.4670,
          longitude: -2.6070,
          summary: "Character 2-bedroom semi-detached house in Bishopston",
          features: "Period Features, Garden, High Street Location",
          condition: 7,
          similarity: 81,
          image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&h=300&fit=crop",
          agent: {
            name: "Jerome Bell",
            company: "harperjamesproperty36"
          }
        },
        // City centre properties
        {
          id: 61,
          address: "15 Broadmead, Bristol City Centre, Bristol",
          postcode: "BS1 3HA",
          property_type: "Apartment",
          bedrooms: 2,
          bathrooms: 2,
          price: 450000,
          square_feet: 900,
          days_on_market: 12,
          latitude: 51.4560,
          longitude: -2.5880,
          summary: "Modern 2-bedroom apartment in Broadmead city centre",
          features: "City Views, Modern Kitchen, Parking, Close to Shops",
          condition: 9,
          similarity: 95,
          image: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "citycentreproperties"
          }
        },
        {
          id: 62,
          address: "8 Redcliffe Way, Redcliffe, Bristol",
          postcode: "BS1 6NL",
          property_type: "Terraced",
          bedrooms: 2,
          bathrooms: 1,
          price: 380000,
          square_feet: 800,
          days_on_market: 18,
          latitude: 51.4500,
          longitude: -2.5900,
          summary: "Period 2-bedroom terraced house in Redcliffe",
          features: "Period Features, Harbour Views, Close to Temple Meads",
          condition: 7,
          similarity: 88,
          image: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=400&h=300&fit=crop",
          agent: {
            name: "Mark Johnson",
            company: "citycentreproperties"
          }
        },
        {
          id: 63,
          address: "22 Temple Meads, Bristol City Centre, Bristol",
          postcode: "BS1 6QF",
          property_type: "Apartment",
          bedrooms: 2,
          bathrooms: 2,
          price: 420000,
          square_feet: 850,
          days_on_market: 8,
          latitude: 51.4490,
          longitude: -2.5850,
          summary: "Contemporary 2-bedroom apartment near Temple Meads",
          features: "Station Views, Modern Kitchen, Parking, Close to Transport",
          condition: 8,
          similarity: 92,
          image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "citycentreproperties"
          }
        },
        {
          id: 64,
          address: "5 Old City, Bristol City Centre, Bristol",
          postcode: "BS1 4BB",
          property_type: "Terraced",
          bedrooms: 2,
          bathrooms: 1,
          price: 360000,
          square_feet: 750,
          days_on_market: 25,
          latitude: 51.4540,
          longitude: -2.5920,
          summary: "Historic 2-bedroom terraced house in Old City",
          features: "Period Features, City Centre Location, Close to Cathedral",
          condition: 6,
          similarity: 85,
          image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop",
          agent: {
            name: "Mark Johnson",
            company: "citycentreproperties"
          }
        },
        {
          id: 65,
          address: "12 Harbourside, Bristol City Centre, Bristol",
          postcode: "BS1 5DB",
          property_type: "Apartment",
          bedrooms: 2,
          bathrooms: 2,
          price: 480000,
          square_feet: 950,
          days_on_market: 6,
          latitude: 51.4510,
          longitude: -2.5950,
          summary: "Luxury 2-bedroom apartment in Harbourside",
          features: "Harbour Views, Modern Kitchen, Parking, Close to Waterfront",
          condition: 9,
          similarity: 96,
          image: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "citycentreproperties"
          }
        },
        // Additional Bristol locations for comprehensive testing
        {
          id: 66,
          address: "25 Whiteladies Road, Clifton, Bristol",
          postcode: "BS8 2PD",
          property_type: "Terraced",
          bedrooms: 3,
          bathrooms: 2,
          price: 650000,
          square_feet: 1200,
          days_on_market: 14,
          latitude: 51.4600,
          longitude: -2.6100,
          summary: "Victorian 3-bedroom terraced house on Whiteladies Road",
          features: "Period Features, High Street Location, Garden",
          condition: 8,
          similarity: 89,
          image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop",
          agent: {
            name: "Emma Thompson",
            company: "cliftonproperties"
          }
        },
        {
          id: 67,
          address: "8 Gloucester Road, Bishopston, Bristol",
          postcode: "BS7 8AA",
          property_type: "Semi-Detached",
          bedrooms: 4,
          bathrooms: 2,
          price: 520000,
          square_feet: 1400,
          days_on_market: 21,
          latitude: 51.4700,
          longitude: -2.6000,
          summary: "Spacious 4-bedroom semi-detached house on Gloucester Road",
          features: "Period Features, Large Garden, Off-Street Parking",
          condition: 7,
          similarity: 85,
          image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&h=300&fit=crop",
          agent: {
            name: "James Mitchell",
            company: "bishopstonproperties"
          }
        },
        {
          id: 68,
          address: "15 Park Street, Bristol City Centre, Bristol",
          postcode: "BS1 5NG",
          property_type: "Apartment",
          bedrooms: 2,
          bathrooms: 1,
          price: 420000,
          square_feet: 800,
          days_on_market: 9,
          latitude: 51.4540,
          longitude: -2.6000,
          summary: "Modern 2-bedroom apartment on Park Street",
          features: "City Views, Modern Kitchen, Close to University",
          condition: 8,
          similarity: 92,
          image: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "citycentreproperties"
          }
        },
        {
          id: 69,
          address: "3 Queen Square, Bristol City Centre, Bristol",
          postcode: "BS1 4LH",
          property_type: "Terraced",
          bedrooms: 3,
          bathrooms: 2,
          price: 580000,
          square_feet: 1100,
          days_on_market: 16,
          latitude: 51.4520,
          longitude: -2.5950,
          summary: "Georgian 3-bedroom terraced house on Queen Square",
          features: "Period Features, Square Views, Close to Harbour",
          condition: 9,
          similarity: 94,
          image: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=400&h=300&fit=crop",
          agent: {
            name: "Mark Johnson",
            company: "citycentreproperties"
          }
        },
        {
          id: 70,
          address: "12 College Green, Bristol City Centre, Bristol",
          postcode: "BS1 5TR",
          property_type: "Apartment",
          bedrooms: 1,
          bathrooms: 1,
          price: 320000,
          square_feet: 600,
          days_on_market: 12,
          latitude: 51.4530,
          longitude: -2.5980,
          summary: "Compact 1-bedroom apartment on College Green",
          features: "Cathedral Views, Modern Kitchen, Close to Cathedral",
          condition: 7,
          similarity: 88,
          image: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "citycentreproperties"
          }
        },
        {
          id: 71,
          address: "7 Corn Street, Bristol City Centre, Bristol",
          postcode: "BS1 1JQ",
          property_type: "Terraced",
          bedrooms: 2,
          bathrooms: 1,
          price: 380000,
          square_feet: 750,
          days_on_market: 18,
          latitude: 51.4550,
          longitude: -2.5920,
          summary: "Historic 2-bedroom terraced house on Corn Street",
          features: "Period Features, City Centre Location, Close to Market",
          condition: 6,
          similarity: 82,
          image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop",
          agent: {
            name: "Mark Johnson",
            company: "citycentreproperties"
          }
        },
        {
          id: 72,
          address: "22 Union Street, Bristol City Centre, Bristol",
          postcode: "BS1 2DX",
          property_type: "Apartment",
          bedrooms: 3,
          bathrooms: 2,
          price: 450000,
          square_feet: 900,
          days_on_market: 11,
          latitude: 51.4540,
          longitude: -2.5900,
          summary: "Modern 3-bedroom apartment on Union Street",
          features: "City Views, Modern Kitchen, Close to Shopping",
          condition: 8,
          similarity: 90,
          image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "citycentreproperties"
          }
        },
        {
          id: 73,
          address: "5 King Street, Bristol City Centre, Bristol",
          postcode: "BS1 4EF",
          property_type: "Terraced",
          bedrooms: 2,
          bathrooms: 1,
          price: 360000,
          square_feet: 700,
          days_on_market: 22,
          latitude: 51.4510,
          longitude: -2.5930,
          summary: "Character 2-bedroom terraced house on King Street",
          features: "Period Features, Close to Theatre, Historic Area",
          condition: 7,
          similarity: 85,
          image: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=400&h=300&fit=crop",
          agent: {
            name: "Mark Johnson",
            company: "citycentreproperties"
          }
        },
        {
          id: 74,
          address: "18 Welsh Back, Bristol City Centre, Bristol",
          postcode: "BS1 4SB",
          property_type: "Apartment",
          bedrooms: 2,
          bathrooms: 2,
          price: 440000,
          square_feet: 850,
          days_on_market: 7,
          latitude: 51.4500,
          longitude: -2.5940,
          summary: "Contemporary 2-bedroom apartment on Welsh Back",
          features: "Harbour Views, Modern Kitchen, Close to Waterfront",
          condition: 9,
          similarity: 93,
          image: "https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=400&h=300&fit=crop",
          agent: {
            name: "Sarah Wilson",
            company: "citycentreproperties"
          }
        },
        {
          id: 75,
          address: "30 Perry Road, St Pauls, Bristol",
          postcode: "BS2 8NA",
          property_type: "Terraced",
          bedrooms: 3,
          bathrooms: 1,
          price: 320000,
          square_feet: 900,
          days_on_market: 25,
          latitude: 51.4600,
          longitude: -2.5800,
          summary: "Victorian 3-bedroom terraced house on Perry Road",
          features: "Period Features, Garden, Close to City Centre",
          condition: 6,
          similarity: 78,
          image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop",
          agent: {
            name: "James Mitchell",
            company: "stpaulproperties"
          }
        }
      ];

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
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(llmResult.processedQuery)}.json?access_token=${mapboxToken}&limit=1&proximity=-2.5879,51.4545&country=GB&bbox=-2.8,51.3,-2.4,51.6&types=${types}`
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
      
      // If no results, return default location
      return {
        lat: 51.4545, // Default to Bristol center
        lng: -2.5879,
        address: 'No results found',
        isArea: true,
        searchType: llmResult.searchType,
        confidence: 0
      };
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
        // Hide attribution control with CSS
        const attributionElement = map.current.getContainer().querySelector('.mapboxgl-ctrl-attrib');
        if (attributionElement) {
          (attributionElement as HTMLElement).style.display = 'none';
        }
        
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
        style: 'mapbox://styles/mapbox/streets-v12', // Colorful style with full details
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
        // Hide attribution control
        const attributionElement = map.current.getContainer().querySelector('.mapboxgl-ctrl-attrib');
        if (attributionElement) {
          (attributionElement as HTMLElement).style.display = 'none';
        }
        
        // Labels are visible by default with colorful style
        
        // Remove any existing markers first
        if (currentMarker.current) {
          currentMarker.current.remove();
          currentMarker.current = null;
        }

        // Load and display ALL comparable properties on map initialization
        console.log('🗺️ Loading ALL comparable properties on map initialization...');
        // Use loadComparableProperties to get all properties from backend
        loadComparableProperties();
        
        // Add navigation controls
        map.current?.addControl(new mapboxgl.NavigationControl());
        map.current?.addControl(new mapboxgl.FullscreenControl());
        
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
          
          {/* Map Style Toggle Button - positioned next to search bar */}
          <motion.button
            onClick={toggleMapStyle}
            disabled={isChangingStyle}
            className={`fixed bottom-5 z-50 w-10 h-10 backdrop-blur-sm rounded-full shadow-lg border border-white/20 flex items-center justify-center transition-all duration-200 ${
              isChangingStyle 
                ? 'bg-gray-100/90 cursor-not-allowed' 
                : 'bg-white/90 hover:bg-white hover:shadow-xl'
            }`}
            style={{
              right: '20px',
              bottom: '20px'
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
          
          
          
          {/* Property Card - Clean Design */}
          {showPropertyCard && selectedProperty && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute z-30"
              style={{
                position: 'fixed',
                right: '40px',
                top: '80px', // Position from top to ensure visibility
                zIndex: 9999,
                transform: 'translateX(0)'
              }}
            >
              <div 
                className="overflow-hidden w-80 flex flex-col"
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(20px)',
                  borderRadius: '12px',
                  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), inset 0 0 0 1px rgba(255, 255, 255, 0.2)',
                  WebkitBackdropFilter: 'blur(20px)'
                }}
              >
                {/* Property Image with Glassmorphism Effect */}
                <div 
                  className="p-3"
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)'
                  }}
                >
                  <div className="relative overflow-hidden rounded-md">
                    <img 
                      src={selectedProperty.image} 
                      alt={selectedProperty.address}
                      className="w-full h-48 object-cover"
                      onLoad={() => console.log('✅ Image loaded successfully:', selectedProperty.image)}
                      onError={(e) => {
                        console.log('❌ Image failed to load:', selectedProperty.image);
                        const fallbackImages = [
                          'https://via.placeholder.com/400x300/4F46E5/FFFFFF?text=Property+Photo',
                          'https://via.placeholder.com/400x300/059669/FFFFFF?text=House+Image',
                          'https://via.placeholder.com/400x300/DC2626/FFFFFF?text=Property+View'
                        ];
                        const randomFallback = fallbackImages[Math.floor(Math.random() * fallbackImages.length)];
                        e.currentTarget.src = randomFallback;
                      }}
                    />
                    <div className="absolute top-2 right-2">
                      <button
                        onClick={() => setShowPropertyCard(false)}
                        className="w-6 h-6 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-white transition-all duration-200 shadow-sm"
                      >
                        <span className="text-gray-600 text-xs font-medium">×</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Property Details - Scrollable Content */}
                <div 
                  className="flex-1 overflow-y-auto px-4 pb-4 space-y-3 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent"
                  style={{ 
                    maxHeight: isExpanded ? 'calc(80vh - 300px)' : '400px' 
                  }}
                >
                  {/* Address */}
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 leading-tight">
                      {selectedProperty.address}
                    </h3>
                    {/* Comparable Type Indicator */}
                    <div className="mt-1">
                      {selectedProperty.isLettingComparable ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          Letting Comparable
                        </span>
                      ) : selectedProperty.priceType === 'sale' ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Sale Comparable
                        </span>
                      ) : null
                    }
                    </div>
                  </div>

                  {/* Key Stats */}
                  <div className="flex items-center space-x-3 text-sm text-gray-600">
                    <span className="flex items-center">
                      <span className="font-medium">{selectedProperty.bedrooms}</span>
                      <span className="ml-1">Bed</span>
                    </span>
                    <span className="flex items-center">
                      <span className="font-medium">{selectedProperty.bathrooms}</span>
                      <span className="ml-1">Bath</span>
                    </span>
                    <span className="flex items-center">
                      <span className="font-medium">{selectedProperty.square_feet?.toLocaleString()}</span>
                      <span className="ml-1">sqft</span>
                    </span>
                    <span className="flex items-center">
                      <span className="font-medium">EPC C</span>
                    </span>
                  </div>

                  {/* Property Type */}
                  <div className="text-sm text-gray-600">
                    {selectedProperty.property_type}
                  </div>

                  {/* Agent Profile */}
                  <div className="pt-2">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center">
                        <span className="text-white text-xs font-medium">
                          {selectedProperty.agent?.name?.split(' ').map((n: string) => n[0]).join('') || 'JB'}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {selectedProperty.agent?.name || 'Jerome Bell'}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          @{selectedProperty.agent?.company || 'harperjamesproperty36'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="pt-2">
                    <div className="text-xl font-bold text-gray-900">
                      {(() => {
                        // 🔍 PHASE 1 DEBUG: Enhanced price display logic debugging
                        console.log('🔍 PHASE 1 DEBUG - Price Display Logic:', {
                          selectedProperty_soldPrice: selectedProperty.soldPrice,
                          selectedProperty_rentPcm: selectedProperty.rentPcm,
                          selectedProperty_askingPrice: selectedProperty.askingPrice,
                          soldPrice_check: selectedProperty.soldPrice > 0,
                          rentPcm_check: selectedProperty.rentPcm > 0,
                          askingPrice_check: selectedProperty.askingPrice > 0,
                          address: selectedProperty.address
                        });

                        if (selectedProperty.soldPrice > 0) {
                          console.log('🔍 DEBUG: Using soldPrice for display');
                          return `£${selectedProperty.soldPrice?.toLocaleString()}`;
                        } else if (selectedProperty.rentPcm > 0) {
                          console.log('🔍 DEBUG: Using rentPcm for display');
                          return `£${selectedProperty.rentPcm?.toLocaleString()} pcm`;
                        } else if (selectedProperty.askingPrice > 0) {
                          console.log('🔍 DEBUG: Using askingPrice for display');
                          return `£${selectedProperty.askingPrice?.toLocaleString()}`;
                        } else {
                          console.log('🔍 DEBUG: No price data found, showing "Price on request"');
                          return 'Price on request';
                        }
                      })()}
                    </div>
                    <div className="text-sm text-gray-500">
                      {selectedProperty.priceLabel || 'Price'}
                    </div>
                    {/* Show annual rent equivalent for letting comparables */}
                    {selectedProperty.isLettingComparable && selectedProperty.rentPcm > 0 && (
                      <div className="text-xs text-blue-600 mt-1">
                        £{(selectedProperty.rentPcm * 12).toLocaleString()} pa
                      </div>
                    )}
                  </div>

                  {/* Features */}
                  <div className="pt-2">
                    <div className="text-sm font-medium text-gray-900 mb-1">Features</div>
                    <div className="text-sm text-gray-600">
                      {truncateText(selectedProperty.features || 'Open Plan Living, Garden, Parking', 120)}
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="pt-2">
                    <div className="text-sm text-gray-600 leading-relaxed">
                      {(() => {
                        const summary = selectedProperty.summary || 'Contemporary 3-bedroom semi-detached house';
                        const isLong = summary.length > 200;
                        
                        if (!isLong || showFullDescription) {
                          return summary;
                        }
                        
                        return (
                          <>
                            {truncateText(summary, 200)}
                            <button
                              onClick={() => setShowFullDescription(true)}
                              className="text-blue-600 hover:text-blue-800 font-medium ml-1"
                            >
                              Read more
                            </button>
                          </>
                        );
                      })()}
                    </div>
                    {showFullDescription && (() => {
                      const summary = selectedProperty.summary || 'Contemporary 3-bedroom semi-detached house';
                      return summary.length > 200 ? (
                        <button
                          onClick={() => setShowFullDescription(false)}
                          className="text-blue-600 hover:text-blue-800 font-medium text-sm mt-1"
                        >
                          Show less
                        </button>
                      ) : null;
                    })()}
                  </div>

                  {/* Expanded Content - Only show when expanded */}
                  {isExpanded && (
                    <>
                      {/* Additional Details */}
                      <div className="pt-2">
                        <div className="text-sm font-medium text-gray-900 mb-1">Additional Details</div>
                        <div className="text-sm text-gray-600 space-y-1">
                          <div>Days on Market: {selectedProperty.days_on_market || 'N/A'}</div>
                          <div>Condition: {selectedProperty.condition || 'N/A'}/10</div>
                          <div>EPC Rating: {selectedProperty.epc_rating || 'N/A'}</div>
                          <div>Tenure: {selectedProperty.tenure || 'N/A'}</div>
                          {selectedProperty.transaction_date && (
                            <div>Transaction Date: {selectedProperty.transaction_date}</div>
                          )}
                        </div>
                      </div>

                      {/* Price History */}
                      {(selectedProperty.soldPrice > 0 || selectedProperty.askingPrice > 0) && (
                        <div className="pt-2">
                          <div className="text-sm font-medium text-gray-900 mb-1">Price History</div>
                          <div className="text-sm text-gray-600 space-y-1">
                            {selectedProperty.soldPrice > 0 && (
                              <div>Sold Price: £{selectedProperty.soldPrice.toLocaleString()}</div>
                            )}
                            {selectedProperty.askingPrice > 0 && (
                              <div>Asking Price: £{selectedProperty.askingPrice.toLocaleString()}</div>
                            )}
                            {selectedProperty.rentPcm > 0 && (
                              <div>Rent PCM: £{selectedProperty.rentPcm.toLocaleString()}</div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Location Details */}
                      <div className="pt-2">
                        <div className="text-sm font-medium text-gray-900 mb-1">Location</div>
                        <div className="text-sm text-gray-600">
                          <div>Latitude: {selectedProperty.latitude?.toFixed(6)}</div>
                          <div>Longitude: {selectedProperty.longitude?.toFixed(6)}</div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Scroll Indicator - Only show when expanded and there's scrollable content */}
                  {isExpanded && (
                    <div className="flex justify-center py-2">
                      <div className="text-xs text-gray-400 flex items-center">
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                        Scroll for more details
                      </div>
                    </div>
                  )}
                </div>

                {/* Action Buttons - Always visible at bottom */}
                <div className="px-4 pb-4 bg-white/10 backdrop-blur-sm border-t border-white/20">
                  <div className="flex space-x-3 pt-4">
                    <button
                      onClick={() => setShowPropertyCard(false)}
                      className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors duration-200"
                    >
                      Close
                    </button>
                    <button 
                      onClick={() => setIsExpanded(!isExpanded)}
                      className="flex-1 px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-md hover:bg-gray-900 transition-colors duration-200"
                    >
                      {isExpanded ? 'Show Less' : 'View More'}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
          
          {/* Map Style Toggle Button */}
          <motion.button
            onClick={toggleMapStyle}
            disabled={isChangingStyle}
            className={`fixed bottom-4 right-4 z-50 w-12 h-12 backdrop-blur-sm rounded-full shadow-lg border border-white/20 flex items-center justify-center transition-all duration-200 ${
              isChangingStyle 
                ? 'bg-gray-100/90 cursor-not-allowed' 
                : 'bg-white/90 hover:bg-white hover:shadow-xl'
            }`}
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
              className="w-6 h-6 flex items-center justify-center"
            >
              {isChangingStyle ? (
                // Loading spinner
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-5 h-5"
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
          
        </motion.div>
      )}
    </AnimatePresence>
  );
});

SquareMap.displayName = 'SquareMap';

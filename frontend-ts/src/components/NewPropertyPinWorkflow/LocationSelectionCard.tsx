"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin, Search } from "lucide-react";

interface LocationSelectionCardProps {
  selectedLocation: {
    lat: number;
    lng: number;
    address: string;
  } | null;
  onLocationSelect: (location: { lat: number; lng: number; address: string }) => void;
  onExtractedAddress?: (address: string) => void; // For auto-flying to extracted addresses
}

export const LocationSelectionCard: React.FC<LocationSelectionCardProps> = ({
  selectedLocation,
  onLocationSelect,
  onExtractedAddress
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const marker = useRef<mapboxgl.Marker | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || '';

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || !mapboxToken || map.current) return;

    mapboxgl.accessToken = mapboxToken;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-0.1276, 51.5074], // Default to London
      zoom: 12,
      attributionControl: false
    });

    map.current.on('load', () => {
      console.log('Location selection map loaded');
      // Resize map to ensure it fits the container with rounded corners
      if (map.current) {
        map.current.resize();
      }
    });

    // Handle map click
    map.current.on('click', async (e) => {
      const { lng, lat } = e.lngLat;
      
      // Reverse geocode to get address
      try {
        const geocodingUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${mapboxToken}`;
        const response = await fetch(geocodingUrl);
        const data = await response.json();
        
        const address = data.features?.[0]?.place_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        
        onLocationSelect({ lat, lng, address });
      } catch (error) {
        console.error('Geocoding error:', error);
        onLocationSelect({ lat, lng, address: `${lat.toFixed(6)}, ${lng.toFixed(6)}` });
      }
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [mapboxToken, onLocationSelect]);

  // Update marker when location changes
  useEffect(() => {
    if (!map.current || !selectedLocation) return;

    // Remove existing marker
    if (marker.current) {
      marker.current.remove();
    }

    // Clean address by removing broad location details
    const cleanAddress = (address: string): string => {
      if (!address) return '';
      
      // Split by comma to handle structured addresses
      const parts = address.split(',').map(part => part.trim());
      
      // Terms to remove (case-insensitive)
      const broadTerms = [
        'london',
        'united kingdom',
        'uk',
        'england',
        'great britain',
        'gb'
      ];
      
      // Filter out parts that match broad terms
      const cleanedParts = parts.filter(part => {
        const lowerPart = part.toLowerCase().trim();
        // Check if the part is exactly a broad term or contains only a broad term
        return !broadTerms.some(term => {
          const normalizedPart = lowerPart.replace(/[^\w\s]/g, '').trim();
          return normalizedPart === term || normalizedPart === `${term},` || normalizedPart === `,${term}`;
        });
      });
      
      // Join back and clean up
      let cleaned = cleanedParts.join(', ').trim();
      
      // Additional cleanup: remove any remaining instances of broad terms
      broadTerms.forEach(term => {
        // Remove with various patterns
        const patterns = [
          new RegExp(`,\\s*${term}\\s*,?`, 'gi'),
          new RegExp(`^${term}\\s*,?\\s*`, 'gi'),
          new RegExp(`,\\s*${term}\\s*$`, 'gi'),
          new RegExp(`\\s+${term}\\s*,?`, 'gi')
        ];
        patterns.forEach(pattern => {
          cleaned = cleaned.replace(pattern, '');
        });
      });
      
      // Final cleanup: remove double commas, trailing/leading commas, extra spaces
      cleaned = cleaned
        .replace(/,\s*,+/g, ',')  // Multiple commas
        .replace(/^,\s*/, '')     // Leading comma
        .replace(/,\s*$/, '')     // Trailing comma
        .replace(/\s+/g, ' ')     // Multiple spaces
        .trim();
      
      return cleaned || address; // Fallback to original if everything was removed
    };

    const displayAddress = cleanAddress(selectedLocation.address);

    // Create property name marker with callout (matching SquareMap design)
    const markerElement = document.createElement('div');
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
          <!-- Black circle with green pin icon -->
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
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#D1D5DB"/>
            </svg>
          </div>
          <!-- Address text -->
          <span style="
            font-size: 13px;
            font-weight: 500;
            color: #1a1a1a;
            line-height: 1.2;
          ">${displayAddress}</span>
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
          background: #D1D5DB;
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
    
    marker.current = new mapboxgl.Marker({
      element: markerElement,
      anchor: 'center',
      offset: [0, -greenPinCenterOffset]
    })
      .setLngLat([selectedLocation.lng, selectedLocation.lat])
      .addTo(map.current);

    // Center map on selected location
    map.current.flyTo({
      center: [selectedLocation.lng, selectedLocation.lat],
      zoom: 15,
      duration: 1000
    });
  }, [selectedLocation]);

  // Handle address search
  const handleSearch = async () => {
    if (!searchQuery.trim() || !map.current) return;

    setIsSearching(true);
    try {
      const geocodingUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${mapboxToken}&limit=1`;
      const response = await fetch(geocodingUrl);
      const data = await response.json();

      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        const address = data.features[0].place_name;

        onLocationSelect({ lat, lng, address });

        // Fly to location
        map.current.flyTo({
          center: [lng, lat],
          zoom: 15,
          duration: 1000
        });
      }
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setIsSearching(false);
    }
  };

  // Handle extracted address (from file extraction)
  useEffect(() => {
    if (onExtractedAddress && selectedLocation?.address) {
      // This will be called when address is extracted from files
      // The parent component will handle the extraction and call onLocationSelect
    }
  }, [onExtractedAddress, selectedLocation]);

  return (
    <div 
      className="relative w-full h-full"
      style={{
        padding: 0,
        overflow: 'hidden'
      }}
    >
      {/* Map Container - Infinity Pool Style (Fills All Edges, Sharp Corners) */}
      <div 
        className="absolute inset-0 w-full h-full"
        style={{
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          overflow: 'hidden'
        }}
      >
        <div 
          ref={mapContainer} 
          className="w-full h-full"
          style={{
            borderRadius: 0
          }}
        />
        {!mapboxToken && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
            <p className="text-gray-500" style={{ fontSize: '14px', fontWeight: 400 }}>Mapbox token not configured</p>
          </div>
        )}
      </div>

      {/* Search Bar - Floating Island (Bottom Center, Glassmorphism) */}
      <div 
        className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-20"
      >
        <div className="relative">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 z-10" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search for address..."
            className="pl-10 pr-20 py-2.5 bg-white/20 backdrop-blur-xl border border-white/20 rounded-full focus:outline-none focus:ring-1 focus:ring-white/30 transition-all duration-200 shadow-lg hover:shadow-xl text-gray-800 placeholder-gray-600"
            style={{
              fontSize: '14px',
              fontWeight: 400,
              width: '320px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.05)'
            }}
          />
          <button
            onClick={handleSearch}
            disabled={isSearching || !searchQuery.trim()}
            className="absolute right-1.5 top-1/2 transform -translate-y-1/2 px-4 py-1.5 bg-gray-900 text-white rounded-full hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-md"
            style={{
              fontSize: '12px',
              fontWeight: 500
            }}
          >
            {isSearching ? '...' : 'Search'}
          </button>
        </div>
      </div>

    </div>
  );
};


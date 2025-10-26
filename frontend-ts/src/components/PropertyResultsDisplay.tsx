"use client";

import * as React from "react";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Scan, MapPin } from "lucide-react";
import { MapPopup } from './MapPopup';
import { SquareMap } from './SquareMap';
import { PropertyImages } from './PropertyImages';

// Import property images
import property1 from "@/assets/property-1.jpg";
import property2 from "@/assets/property-2.jpg";
import property3 from "@/assets/property-3.jpg";
import property4 from "@/assets/property-4.jpg";

export interface PropertyData {
  id: number;
  address: string;
  postcode: string;
  property_type: string;
  bedrooms: number;
  bathrooms: number;
  price: number;
  square_feet: number;
  days_on_market: number;
  latitude: number;
  longitude: number;
  summary: string;
  features: string;
  condition: number;
  similarity: number;
  image: string;
  // Property images from backend
  property_images?: Array<{
    url: string;
    filename: string;
    extracted_at: string;
    image_index: number;
    size_bytes: number;
  }>;
  image_count?: number;
  primary_image_url?: string;
  has_images?: boolean;
  total_images?: number;
  agent: {
    name: string;
    company: string;
  };
}

export interface PropertyResultsDisplayProps {
  properties: PropertyData[];
  className?: string;
  onMapButtonClick?: () => void;
}

// Using properties passed as props instead of hardcoded data
export default function PropertyResultsDisplay({
  properties = [],
  className,
  onMapButtonClick
}: PropertyResultsDisplayProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeScan, setActiveScan] = useState(false);
  const [activeLocation, setActiveLocation] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [showComparablesMap, setShowComparablesMap] = useState(false);

  // Debug logging
  console.log('PropertyResultsDisplay received properties:', properties);
  console.log('Current property:', properties[currentIndex]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const hasScrolled = useRef(false);
  const scrollTimeout = useRef<NodeJS.Timeout | null>(null);

  const nextProperty = () => {
    setCurrentIndex(prev => (prev + 1) % properties.length);
  };

  const prevProperty = () => {
    setCurrentIndex(prev => (prev - 1 + properties.length) % properties.length);
  };

  const goToProperty = (index: number) => {
    setCurrentIndex(index);
  };

  // Convert property data to format expected by SquareMap
  const convertPropertiesToMapFormat = (properties: PropertyData[]) => {
    return properties.map((property, index) => ({
      id: property.id,
      address: property.address,
      price: property.price,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      squareFeet: property.square_feet,
      latitude: 51.4545 + (index * 0.01), // Mock coordinates around Bristol
      longitude: -2.5879 + (index * 0.01),
      type: 'House',
      condition: 'Good',
      features: ['Garden', 'Parking'],
      summary: `Beautiful ${property.bedrooms} bedroom property in ${property.address}`,
      image: property.image,
      agent: 'Velora Properties'
    }));
  };

  // Navigation button controls and scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseEnter = () => {
      setIsHovering(true);
    };

    const handleMouseLeave = () => {
      setIsHovering(false);
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      
      // Block all scroll events if we've already processed one
      if (hasScrolled.current) return;
      
      // Set flag immediately to block further scrolls
      hasScrolled.current = true;
      
      // Process scroll direction
      if (e.deltaY > 0) {
        setCurrentIndex(prev => (prev + 1) % properties.length);
      } else if (e.deltaY < 0) {
        setCurrentIndex(prev => (prev - 1 + properties.length) % properties.length);
      }
      
      // Reset after much longer delay to guarantee one property per gesture
      setTimeout(() => {
        hasScrolled.current = false;
      }, 800); // Increased to 800ms for absolute control
    };

    // Add event listeners
    container.addEventListener('mouseenter', handleMouseEnter);
    container.addEventListener('mouseleave', handleMouseLeave);
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      if (scrollTimeout.current) {
        clearTimeout(scrollTimeout.current);
      }
      container.removeEventListener('mouseenter', handleMouseEnter);
      container.removeEventListener('mouseleave', handleMouseLeave);
      container.removeEventListener('wheel', handleWheel);
    };
  }, [properties.length]);

  const currentProperty = properties[currentIndex];

  // Don't render if no properties available
  if (!properties || properties.length === 0 || !currentProperty) {
    return null;
  }

  return (
    <div ref={containerRef} className={`w-full max-w-2xl ${className || ''}`}>
      {/* Header */}
      <div className="mb-6">
        <h3 className="text-base font-semibold text-slate-800 mb-1">
          Property Comparables
        </h3>
        <p className="text-sm text-slate-600">
          Here are the most suitable comps I found for your search
        </p>
        <p className="text-xs text-slate-500 mt-2">
          💡 Use scroll wheel, dots, or arrow buttons to navigate between properties
        </p>
      </div>

      {/* Main Property Card */}
      <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all duration-200 ${
        isHovering ? 'ring-2 ring-blue-200 shadow-md' : ''
      }`}>
        {/* Property Image */}
        <div className="relative h-48 bg-gradient-to-br from-slate-100 to-slate-200 overflow-hidden">
          {currentProperty.image ? (
            <img 
              src={currentProperty.image}
              alt={currentProperty.address}
              className="w-full h-full object-cover"
              onError={(e) => {
                console.log('Image failed to load:', currentProperty.image);
                // Try a fallback image
                e.currentTarget.src = 'https://via.placeholder.com/400x300/94a3b8/ffffff?text=Property+Image';
              }}
              onLoad={() => {
                console.log('Image loaded successfully:', currentProperty.image);
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
              <div className="text-slate-400 text-sm">No image available</div>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent" />
          
          {/* Address Badge */}
          <div className="absolute top-4 left-4">
            <div className="bg-white/95 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow-sm">
              <h4 className="text-sm font-semibold text-slate-800">
                {currentProperty.address}
              </h4>
            </div>
          </div>

          {/* Property Indicator - Top Right */}
          <div className="absolute top-4 right-4">            
            <div className="flex items-center bg-white/95 backdrop-blur-sm rounded-lg p-2 shadow-sm">              
              <div className="flex items-center space-x-1">
                {properties.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => goToProperty(index)}
                    className={`w-1.5 h-1.5 rounded-full transition-all ${
                      index === currentIndex 
                        ? 'bg-slate-800 w-4' 
                        : 'bg-slate-300 hover:bg-slate-400'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Property Details */}
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="text-2xl font-bold text-slate-900">
              £{currentProperty.price.toLocaleString()}
            </div>
            
            {/* Action Buttons - Integrated into details section */}
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setActiveScan(!activeScan)}
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                  activeScan 
                    ? 'bg-emerald-500 text-white shadow-sm' 
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <Scan className="w-4 h-4" strokeWidth={2} />
              </button>
              
              <button
                onClick={onMapButtonClick || (() => setShowComparablesMap(true))}
                className="w-10 h-10 rounded-xl flex items-center justify-center bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
              >
                <MapPin className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="text-center">
              <div className="text-xl font-semibold text-slate-800">{currentProperty.bedrooms}</div>
              <div className="text-slate-600">Bedrooms</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-semibold text-slate-800">{currentProperty.bathrooms}</div>
              <div className="text-slate-600">Bathrooms</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-semibold text-slate-800">{currentProperty.square_feet.toLocaleString()}</div>
              <div className="text-slate-600">Square Feet</div>
            </div>
          </div>

          {/* Property Images Section */}
          {(currentProperty.has_images || currentProperty.image_count > 0) && (
            <div className="mt-6">
              <PropertyImages
                images={currentProperty.property_images || []}
                primaryImageUrl={currentProperty.primary_image_url}
                imageCount={currentProperty.image_count || 0}
                propertyAddress={currentProperty.address}
              />
            </div>
          )}

          {/* Property Counter & Navigation */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <button
                onClick={prevProperty}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
                disabled={currentIndex === 0}
              >
                <ChevronLeft className="w-4 h-4 text-slate-600" />
              </button>
              
              <div className="text-center text-sm text-slate-500">
                Property {currentIndex + 1} of {properties.length}
              </div>
              
              <button
                onClick={nextProperty}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
                disabled={currentIndex === properties.length - 1}
              >
                <ChevronRight className="w-4 h-4 text-slate-600" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Comparables Map */}
      <AnimatePresence>
        {showComparablesMap && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowComparablesMap(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="absolute inset-4 bg-white rounded-2xl overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-slate-200">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Property Comparables Map</h2>
                  <p className="text-slate-600 mt-1">Showing {properties.length} comparable properties</p>
                </div>
                <button
                  onClick={() => setShowComparablesMap(false)}
                  className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
                >
                  <ChevronLeft className="w-5 h-5 text-slate-600" />
                </button>
              </div>
              
              {/* Map Container */}
              <div className="h-[calc(100%-80px)]">
                <SquareMap
                  isVisible={true}
                  searchQuery=""
                  onLocationUpdate={() => {}}
                  onSearch={() => {}}
                  hasPerformedSearch={true}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Single Property Map Popup (kept for individual property view) */}
      <MapPopup 
        isOpen={isMapOpen}
        onClose={() => setIsMapOpen(false)}
        propertyAddress={currentProperty?.address}
      />
    </div>
  );
}
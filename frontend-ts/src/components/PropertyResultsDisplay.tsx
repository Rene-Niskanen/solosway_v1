"use client";

import * as React from "react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { SquareMap } from './SquareMap';
import { PropertyCard } from './PropertyCard';

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
  onPropertyUpload?: (property: PropertyData) => void;
  onPropertyViewFiles?: (property: PropertyData) => void;
}

// Using properties passed as props instead of hardcoded data
export default function PropertyResultsDisplay({
  properties = [],
  className,
  onMapButtonClick,
  onPropertyUpload,
  onPropertyViewFiles
}: PropertyResultsDisplayProps) {
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [showComparablesMap, setShowComparablesMap] = useState(false);

  // Don't render if no properties available
  if (!properties || properties.length === 0) {
    return null;
  }

  console.log('PropertyResultsDisplay: Rendering grid with', properties.length, 'properties');

  return (
    <div className={`w-full ${className || ''}`}>
      {/* Header */}
      <div className="mb-6">
        <h3 className="text-base font-semibold text-slate-800 mb-1">
          Property Comparables
        </h3>
        <p className="text-sm text-slate-600">
          Here are the most suitable comps I found for your search
        </p>
      </div>

      {/* Property Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
        {properties.map((property) => {
          console.log('Rendering PropertyCard for:', property.address);
          return (
            <PropertyCard
              key={property.id}
              property={property}
              onUpload={onPropertyUpload}
              onViewFiles={onPropertyViewFiles}
            />
          );
        })}
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

    </div>
  );
}
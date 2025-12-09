"use client";

import React from 'react';
import { motion } from 'framer-motion';

interface PropertyCardDetailedProps {
  property: any;
  isVisible: boolean;
  onClose: () => void;
}

/**
 * PropertyCardDetailed Component
 * 
 * This component contains the formatting and logic from the old property card
 * that was previously displayed in SquareMap. It's preserved here for future use
 * in another view of the property card.
 * 
 * NOTE: This component is currently disabled and not in use. It's stored here
 * for reference and future implementation.
 */
export const PropertyCardDetailed: React.FC<PropertyCardDetailedProps> = ({
  property,
  isVisible,
  onClose
}) => {
  // Component is disabled - return null for now
  if (!isVisible || !property) return null;

  // All the original logic and formatting is preserved below for future use

  // Price formatting logic
  const getPriceDisplay = () => {
    if (property.soldPrice > 0) {
      return `£${property.soldPrice?.toLocaleString()}`;
    } else if (property.askingPrice > 0) {
      return `£${property.askingPrice?.toLocaleString()}`;
    } else if (property.rentPcm > 0) {
      return `£${property.rentPcm?.toLocaleString()}/month`;
    } else {
      return 'Price on request';
    }
  };

  // Image error handling with fallbacks
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    console.log('❌ Image failed to load:', property.image);
    const fallbackImages = [
      'https://via.placeholder.com/400x300/4F46E5/FFFFFF?text=Property+Photo',
      'https://via.placeholder.com/400x300/059669/FFFFFF?text=House+Image',
      'https://via.placeholder.com/400x300/DC2626/FFFFFF?text=Property+View'
    ];
    const randomFallback = fallbackImages[Math.floor(Math.random() * fallbackImages.length)];
    e.currentTarget.src = randomFallback;
  };

  // Description/summary text logic
  const getDescription = () => {
    return property.notes || property.summary || property.description || 'No description available';
  };

  // Document count logic
  const getDocumentCount = () => {
    return property.documentCount || 0;
  };

  // Document filename formatting
  const formatDocumentName = (filename: string) => {
    return filename?.split('_').join(' ') || 'Document';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.95 }}
      className="absolute z-30"
      style={{
        position: 'fixed',
        right: '40px',
        top: '80px',
        zIndex: 9999,
        transform: 'translateX(0)'
      }}
    >
      <div 
        className="overflow-hidden w-[800px] flex flex-col h-[80vh]"
        style={{
          background: 'rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(20px)',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), inset 0 0 0 1px rgba(255, 255, 255, 0.2)',
          WebkitBackdropFilter: 'blur(20px)'
        }}
      >
        {/* Top Section: Image (1/3) + Info (2/3) - Takes top 1/3 of card */}
        <div className="flex p-4 space-x-4 h-1/3">
          {/* Property Image - Left Side - 1/3 width */}
          <div className="flex-shrink-0 w-1/3">
            <div className="relative overflow-hidden rounded-lg h-full">
              <img 
                src={property.image} 
                alt={property.address}
                className="w-full h-full object-cover object-center"
                onLoad={() => console.log('✅ Image loaded successfully:', property.image)}
                onError={handleImageError}
              />
              <div className="absolute top-2 right-2">
                <button
                  onClick={onClose}
                  className="w-6 h-6 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-white transition-all duration-200 shadow-sm"
                >
                  <span className="text-gray-600 text-xs font-medium">×</span>
                </button>
              </div>
            </div>
          </div>

          {/* Property Information - Right Side - 2/3 width */}
          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
            {/* Address */}
            <h3 className="text-lg font-semibold text-gray-900 leading-tight mb-2">
              {property.address}
            </h3>

            {/* Key Stats */}
            <div className="flex items-center space-x-4 text-sm text-gray-600 mb-3">
              <span className="flex items-center">
                <span className="font-medium">{property.bedrooms}</span>
                <span className="ml-1">Bed</span>
              </span>
              <span className="flex items-center">
                <span className="font-medium">{property.bathrooms}</span>
                <span className="ml-1">Bath</span>
              </span>
              <span className="flex items-center">
                <span className="font-medium">{property.square_feet?.toLocaleString()}</span>
                <span className="ml-1">sqft</span>
              </span>
              <span className="flex items-center">
                <span className="font-medium">EPC {property.epc_rating || 'C'}</span>
              </span>
              <span className="flex items-center">
                <span className="font-medium">| {property.property_type || 'Property'}</span>
              </span>
            </div>

            {/* Price */}
            <div className="mb-3">
              <div className="text-xl font-bold text-gray-900">
                {getPriceDisplay()}
              </div>
            </div>

            {/* Features */}
            {property.features && (
              <div className="text-sm text-gray-600">
                <span className="font-medium">Features: </span>
                {property.features}
              </div>
            )}
          </div>
        </div>

        {/* Description Section - Between Image and Documents */}
        <div className="px-4 py-3 border-t border-white/20">
          <div className="text-sm text-gray-600 leading-relaxed">
            {getDescription()}
          </div>
        </div>

        {/* Documents Section - Takes bottom 2/3 of card */}
        <div className="px-4 pb-4 flex-1 min-h-0">
          <div className="space-y-3 h-full">
            <div className="text-lg font-semibold text-gray-900">
              Documents ({getDocumentCount()})
            </div>
            
            {/* Documents Grid - Horizontal Layout */}
            <div className="flex gap-3 overflow-x-auto pb-2 h-full">
              {/* Upload Document Button - First Item */}
              <div className="flex-shrink-0 w-20 h-20 bg-white/30 backdrop-blur-sm rounded-lg border-2 border-dashed border-gray-400 hover:border-blue-500 hover:bg-white/40 transition-all duration-200 cursor-pointer flex flex-col items-center justify-center group">
                <svg className="w-6 h-6 text-gray-500 group-hover:text-blue-500 transition-colors duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-xs text-gray-500 group-hover:text-blue-500 transition-colors duration-200 mt-1 text-center leading-tight">
                  Upload Document
                </span>
              </div>

              {/* Actual Documents */}
              {property.propertyHub?.documents && property.propertyHub.documents.length > 0 ? (
                property.propertyHub.documents.map((doc: any, index: number) => (
                  <div key={`doc-${doc.id || doc.original_filename || 'unknown'}-${index}`} className="flex-shrink-0 w-20 h-20 bg-white/20 backdrop-blur-sm rounded-lg border border-white/30 hover:bg-white/30 transition-all duration-200 cursor-pointer flex flex-col items-center justify-center group relative">
                    {/* Document Icon */}
                    <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center mb-1">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>

                    {/* Document Title */}
                    <div className="text-xs text-gray-700 text-center leading-tight px-1 truncate w-full">
                      {formatDocumentName(doc.original_filename)}
                    </div>
                    
                    {/* Document Type Badge */}
                    <div className="absolute top-1 right-1 w-3 h-3 bg-blue-500 rounded-full flex items-center justify-center">
                      <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex-shrink-0 w-20 h-20 bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 flex flex-col items-center justify-center text-gray-400">
                  <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-xs text-center">No docs</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};


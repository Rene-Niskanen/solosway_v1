"use client";

import * as React from "react";
import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { MapPin, Home, Ruler, DollarSign, Bed, Bath, Sofa, Car, Upload, FileText } from "lucide-react";
import { PropertyData } from './PropertyResultsDisplay';
import { PropertyFilesModal } from './PropertyFilesModal';

interface PropertyCardProps {
  property: PropertyData;
  onUpload?: (property: PropertyData) => void;
  onViewFiles?: (property: PropertyData) => void;
}

export const PropertyCard: React.FC<PropertyCardProps> = ({
  property,
  onUpload,
  onViewFiles
}) => {
  const [isFilesModalOpen, setIsFilesModalOpen] = useState(false);
  const [modalPosition, setModalPosition] = useState<{ top: number; left: number } | undefined>();
  const [isFilesLoading, setIsFilesLoading] = useState(false);
  const [hasFilesFetched, setHasFilesFetched] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const viewFilesButtonRef = useRef<HTMLButtonElement>(null);
  // Format price
  const formatPrice = (price: number) => {
    if (price >= 1000000) {
      return `$ ${(price / 1000000).toFixed(2)}M`;
    } else if (price >= 1000) {
      return `$ ${(price / 1000).toFixed(0)}K`;
    }
    return `$ ${price.toLocaleString()}`;
  };

  // Format square feet to square meters
  const formatSize = (squareFeet: number) => {
    const squareMeters = Math.round(squareFeet * 0.092903);
    return `${squareMeters}m²`;
  };

  // Get location from address (extract city/state/country)
  const getLocation = () => {
    const addressParts = property.address.split(',');
    if (addressParts.length > 1) {
      return addressParts[addressParts.length - 1].trim();
    }
    return property.postcode || 'Location';
  };

  // Get shortened property name (same logic as PropertyDetailsPanel)
  const getPropertyName = (address: string): string => {
    if (!address) return 'Unknown Address';
    
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
    
    return address;
  };

  // Expandable summary state
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  // Get summary text
  const summaryText = property.summary || 'Beautiful property in a great location.';
  const maxLength = 120; // Approximate characters for 3 lines
  const isLong = summaryText.length > maxLength;

  // Check if text is actually truncated
  useEffect(() => {
    if (summaryRef.current && !isSummaryExpanded) {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        if (summaryRef.current) {
          const isTextTruncated = summaryRef.current.scrollHeight > summaryRef.current.clientHeight;
          setIsTruncated(isTextTruncated || isLong);
        }
      });
    } else {
      setIsTruncated(false);
    }
  }, [property.summary, isSummaryExpanded, isLong]);

  // Get property ID - check multiple possible fields
  const propertyId = (property as any).property_id || (property as any).id?.toString() || property.id?.toString();

  // Render expandable summary
  const renderSummary = () => {
    if (!summaryText) return null;
    
    if (!isLong) {
      return (
        <p className="text-sm text-gray-600 leading-relaxed">
          {summaryText}
        </p>
      );
    }
    
    if (isSummaryExpanded) {
      return (
        <div>
          <p
            ref={summaryRef}
            className="text-sm text-gray-600 leading-relaxed"
          >
            {summaryText}
          </p>
          <button
            onClick={() => setIsSummaryExpanded(false)}
            className="text-slate-600 hover:text-slate-700 underline mt-1 text-sm font-medium cursor-pointer"
            type="button"
          >
            View less
          </button>
        </div>
      );
    }
    
    // Find a good break point (prefer word boundary)
    const truncated = summaryText.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    const breakPoint = lastSpace > maxLength * 0.8 ? lastSpace : maxLength;
    const displayText = summaryText.substring(0, breakPoint).trim();
    
    return (
      <div>
        <p ref={summaryRef} className="text-sm text-gray-600 leading-relaxed">
          {displayText}
        </p>
        <button
          onClick={() => setIsSummaryExpanded(true)}
          className="text-slate-600 hover:text-slate-700 underline mt-1 text-sm font-medium cursor-pointer"
          type="button"
        >
          View more
        </button>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow duration-200">
      {/* Container 1: Image, Title, Summary, View buttons */}
      <div style={{ contain: 'layout style' }}>
        {/* Property Image - Infinity Pool Style (no border, extends to edges) */}
        <div className="relative w-full h-56 overflow-hidden">
          {property.image || property.primary_image_url ? (
            <img 
              src={property.image || property.primary_image_url}
              alt={property.address}
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.src = 'https://via.placeholder.com/400x300/94a3b8/ffffff?text=Property+Image';
              }}
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
              <div className="text-slate-400 text-sm">No image available</div>
            </div>
          )}
        </div>

        {/* Title and Summary Section */}
        <div className="p-4 pb-6">
          {/* Title */}
          <h3 className="text-lg font-semibold text-gray-900 mb-2 line-clamp-1">
            {getPropertyName(property.address || 'Unknown Address')}
          </h3>

          {/* Description - Expandable */}
          <div>
            {renderSummary()}
          </div>
        </div>
      </div>

      {/* Container 2: Icons, Property Info, Action Buttons (completely independent) */}
      <div className="px-6 py-5 pt-0" style={{ position: 'relative', transform: 'translateZ(0)', contain: 'layout style paint', isolation: 'isolate', marginTop: '0.5rem' }}>
          {/* Property Details Icons - Horizontal Rows */}
          <div className="space-y-3 mb-6">
          {/* Row 1: Location, Type, Size */}
          <div className="flex items-center gap-6 flex-wrap">
            {/* Location */}
            <div className="flex items-center text-xs text-gray-600">
              <MapPin className="w-4 h-4 mr-2 text-gray-500 flex-shrink-0" />
              <span className="truncate">{getLocation()}</span>
            </div>

            {/* Type */}
            <div className="flex items-center text-xs text-gray-600">
              <Home className="w-4 h-4 mr-2 text-gray-500 flex-shrink-0" />
              <span>{property.property_type || 'Piso'}</span>
            </div>

            {/* Size */}
            <div className="flex items-center text-xs text-gray-600">
              <Ruler className="w-4 h-4 mr-2 text-gray-500 flex-shrink-0" />
              <span>{formatSize(property.square_feet)}</span>
            </div>
          </div>

          {/* Row 2: Price */}
          <div className="flex items-center gap-6 flex-wrap">
            {/* Price */}
            <div className="flex items-center text-xs text-gray-600">
              <DollarSign className="w-4 h-4 mr-2 text-gray-500 flex-shrink-0" />
              <span>{formatPrice(property.price)}</span>
            </div>
          </div>

          {/* Row 3: Bedrooms & Bathrooms - Only show if values exist and > 0 */}
          {(property.bedrooms > 0 || property.bathrooms > 0) && (
            <div className="flex items-center gap-6 text-xs text-gray-600">
              {property.bedrooms > 0 && (
                <div className="flex items-center">
                  <Bed className="w-4 h-4 mr-2 text-gray-500 flex-shrink-0" />
                  <span>{property.bedrooms}</span>
                </div>
              )}
              {property.bathrooms > 0 && (
                <div className="flex items-center">
                  <Bath className="w-4 h-4 mr-2 text-gray-500 flex-shrink-0" />
                  <span>{property.bathrooms}</span>
                </div>
              )}
            </div>
          )}

          {/* Row 4: Living Rooms & Parking - Only show if values exist and > 0 */}
          {((property as any).living_rooms > 0 || (property as any).parking > 0) && (
            <div className="flex items-center gap-6 text-xs text-gray-600">
              {(property as any).living_rooms > 0 && (
                <div className="flex items-center">
                  <Sofa className="w-4 h-4 mr-2 text-gray-500 flex-shrink-0" />
                  <span>{(property as any).living_rooms}</span>
                </div>
              )}
              {(property as any).parking > 0 && (
                <div className="flex items-center">
                  <Car className="w-4 h-4 mr-2 text-gray-500 flex-shrink-0" />
                  <span>{(property as any).parking}</span>
                </div>
              )}
            </div>
          )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 mb-6">
          <button
            ref={viewFilesButtonRef}
            onClick={(e) => {
              if (isFilesModalOpen) {
                // Close the modal if it's already open
                setIsFilesModalOpen(false);
              } else {
                // Calculate position above the card using viewport coordinates
                // Use requestAnimationFrame to ensure DOM is ready
                requestAnimationFrame(() => {
                  if (cardRef.current) {
                    const cardRect = cardRef.current.getBoundingClientRect();
                    // Position modal above the card, centered horizontally
                    // Ensure modal doesn't go off-screen
                    const modalWidth = 420; // Modal width (matches property card width)
                    const viewportWidth = window.innerWidth;
                    const leftPosition = Math.max(
                      modalWidth / 2 + 10, // Minimum left position (10px padding)
                      Math.min(
                        cardRect.left + (cardRect.width / 2), // Center of card
                        viewportWidth - (modalWidth / 2) - 10 // Maximum right position
                      )
                    );
                    
                    setModalPosition({
                      top: cardRect.top, // Top of the card
                      left: leftPosition // Center of the card horizontally (constrained to viewport)
                    });
                    setIsFilesModalOpen(true);
                  }
                });
                onViewFiles?.(property);
              }
            }}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100/80 backdrop-blur-sm border border-gray-300/50 rounded-md hover:bg-gray-200/90 transition-colors duration-100 shadow-sm"
          >
            <div className="flex items-center justify-center gap-1.5">
              <FileText className="w-4 h-4" />
              <span>{isFilesModalOpen && hasFilesFetched ? 'Close Database' : 'View Files'}</span>
            </div>
          </button>
          
          <button
            onClick={() => onUpload?.(property)}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100/80 backdrop-blur-sm border border-gray-300/50 rounded-md hover:bg-gray-200/90 transition-colors duration-100 shadow-sm"
          >
            <div className="flex items-center justify-center gap-1.5">
              <Upload className="w-4 h-4" />
              <span>Upload</span>
            </div>
          </button>
          </div>
      </div>

      {/* Property Files Modal */}
      {propertyId && (
        <PropertyFilesModal
          key={`files-modal-${propertyId}`}
          propertyId={propertyId}
          propertyAddress={property.address}
          isOpen={isFilesModalOpen}
          onClose={() => {
            setIsFilesModalOpen(false);
            setHasFilesFetched(false);
          }}
          position={modalPosition}
          onLoadingStateChange={(isLoading, hasFetched) => {
            setIsFilesLoading(isLoading);
            setHasFilesFetched(hasFetched);
          }}
          isMapVisible={false}
          isSidebarCollapsed={false}
        />
      )}
    </div>
  );
};


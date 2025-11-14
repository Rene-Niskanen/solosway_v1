"use client";

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { File, CloudUpload, X, Upload, FileText, MapPin, Home, Ruler, DollarSign, Bed, Bath, Sofa, Car } from 'lucide-react';
import { useBackendApi } from './BackendApi';

interface PropertyDetailsPanelProps {
  property: any;
  isVisible: boolean;
  onClose: () => void;
}

interface Document {
  id: string;
  original_filename: string;
  classification_type: string;
  classification_confidence: number;
  created_at: string;
  status: string;
  parsed_text?: string;
  extracted_json?: string;
}

export const PropertyDetailsPanel: React.FC<PropertyDetailsPanelProps> = ({
  property,
  isVisible,
  onClose
}) => {
  const backendApi = useBackendApi();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const summaryRef = useRef<HTMLParagraphElement>(null);

  // Load documents when property changes
  useEffect(() => {
    if (property && property.id) {
      // First, check if documents are already available in propertyHub
      if (property.propertyHub?.documents && property.propertyHub.documents.length > 0) {
        setDocuments(property.propertyHub.documents);
        setLoading(false);
      } else {
        loadPropertyDocuments();
      }
    }
  }, [property]);

  const loadPropertyDocuments = async () => {
    if (!property?.id) return;
    
    setLoading(true);
    setError(null);
    
    try {
      console.log('📄 Loading documents for property:', property.id);
      const response = await backendApi.getPropertyHubDocuments(property.id);
      
      if (response && response.documents) {
        setDocuments(response.documents);
        console.log('📄 Loaded documents:', response.documents);
      } else {
        // Fallback to propertyHub documents if API returns nothing
        if (property.propertyHub?.documents && property.propertyHub.documents.length > 0) {
          setDocuments(property.propertyHub.documents);
          console.log('📄 Using propertyHub documents as fallback:', property.propertyHub.documents);
        } else {
          setDocuments([]);
          console.log('📄 No documents found for property');
        }
      }
    } catch (err) {
      console.error('❌ Error loading documents:', err);
      setError('Failed to load documents');
      // Fallback to propertyHub documents on error
      if (property.propertyHub?.documents && property.propertyHub.documents.length > 0) {
        setDocuments(property.propertyHub.documents);
      } else {
        setDocuments([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return 'Unknown date';
    }
  };

  const formatLettingDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const month = date.toLocaleDateString('en-GB', { month: 'short' });
      const year = date.getFullYear();
      return `${month} ${year}`;
    } catch {
      return 'Unknown';
    }
  };

  // Calculate yield percentage if we have rent and price
  const calculateYield = () => {
    if (property.rentPcm && (property.soldPrice || property.askingPrice)) {
      const annualRent = property.rentPcm * 12;
      const price = property.soldPrice || property.askingPrice;
      if (price > 0) {
        return ((annualRent / price) * 100).toFixed(1);
      }
    }
    return null;
  };

  // Get primary price to display
  const getPrimaryPrice = () => {
    if (property.soldPrice > 0) {
      return `£${property.soldPrice.toLocaleString()}`;
    } else if (property.askingPrice > 0) {
      return `£${property.askingPrice.toLocaleString()}`;
    } else if (property.rentPcm > 0) {
      return `£${property.rentPcm.toLocaleString()}/month`;
    }
    return 'Price on request';
  };

  // Get property image
  const getPropertyImage = () => {
    return property.image || 
           property.primary_image_url || 
           property.propertyHub?.property_details?.primary_image_url ||
           '/property-1.png';
  };

  // Get shortened property name (same logic as SquareMap)
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

  // Get letting info
  const getLettingInfo = () => {
    if (property.transaction_date && property.rentPcm > 0) {
      const date = formatLettingDate(property.transaction_date);
      return `Let (AST ${date})`;
    }
    return null;
  };

  // Get summary text
  const summaryText = property.summary || property.propertyHub?.property_details?.notes || property.notes;
  const maxLength = 120; // Approximate characters for 3 lines
  const isLong = summaryText ? summaryText.length > maxLength : false;

  // Check if text is actually truncated
  useEffect(() => {
    if (summaryRef.current && !isSummaryExpanded && summaryText) {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        if (summaryRef.current) {
          const isTextTruncated = summaryRef.current.scrollHeight > summaryRef.current.clientHeight;
          // Character length check as fallback
          if (!isTextTruncated && isLong) {
            // Text might still be truncated, keep expanded state false
          }
        }
      });
    }
  }, [summaryText, isSummaryExpanded, isLong]);

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
        <p ref={summaryRef} className="text-sm text-gray-600 leading-relaxed line-clamp-3">
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

  if (!isVisible || !property) return null;

  const yieldPercentage = calculateYield();
  const lettingInfo = getLettingInfo();

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed bottom-5 right-4 w-[420px] max-h-[calc(100vh-2rem)] z-[100] flex flex-col"
        data-property-panel
      >
        {/* Card Container - Modern White Card */}
        <motion.div 
          className="bg-white rounded-xl shadow-xl flex flex-col overflow-hidden flex-1 border border-gray-100"
          layout={false}
        >
          {/* Scrollable Content Container */}
          <div className="flex-1 overflow-y-auto">
            {/* Container 1: Image, Title, Summary, View buttons */}
            <div style={{ contain: 'layout style' }}>
              {/* Property Image Section - Infinity Pool Style (no border) */}
              <div className="relative w-full overflow-hidden rounded-t-xl" style={{ aspectRatio: '16/10' }}>
                <img
                  src={getPropertyImage()}
                  alt={property.address || 'Property'}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const img = e.target as HTMLImageElement;
                    img.src = '/property-1.png';
                  }}
                />
                
                {/* Close Button - Top Right */}
                <button
                  onClick={onClose}
                  className="absolute top-3 right-3 w-7 h-7 bg-white/95 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-white transition-colors shadow-md z-10"
                >
                  <X className="w-3 h-3 text-gray-700" strokeWidth={2.5} />
                </button>
              </div>

              {/* Title and Summary Section */}
              <div className="p-4 pb-6">
                {/* Title - Moved below image */}
                <h2 className="text-lg font-semibold text-gray-900 leading-tight mb-2">
                  {getPropertyName(property.address || 'Unknown Address')}
                </h2>

                {/* Property Summary/Description - Expandable */}
                <div>
                  {renderSummary()}
                </div>
              </div>
            </div>

            {/* Container 2: Icons, Property Info, Action Buttons (completely independent) */}
            <div className="px-6 py-5 pt-0" style={{ position: 'relative', transform: 'translateZ(0)', contain: 'layout style paint', isolation: 'isolate', marginTop: '0.5rem' }}>
                {/* Action Buttons */}
                <div className="flex gap-2 mb-6">
                <button
                  onClick={() => {
                    // TODO: Wire up view files functionality
                    console.log('View Files clicked');
                  }}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100/80 backdrop-blur-sm border border-gray-300/50 rounded-md hover:bg-gray-200/90 transition-colors duration-100 shadow-sm"
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <FileText className="w-4 h-4" />
                    <span>View Files</span>
                  </div>
                </button>
                
                <button
                  onClick={() => {
                    // TODO: Wire up document upload functionality
                    console.log('Upload clicked');
                  }}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100/80 backdrop-blur-sm border border-gray-300/50 rounded-md hover:bg-gray-200/90 transition-colors duration-100 shadow-sm"
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <Upload className="w-4 h-4" />
                    <span>Upload</span>
                  </div>
                </button>
                </div>

                {/* Property Details with Icons - Horizontal Rows */}
                <div className="space-y-3 mb-2">
                {/* Row 1: Document Count, Square Footage, EPC Rating */}
                <div className="flex items-center gap-6 flex-wrap">
                  {/* Document Count */}
                  <div className="flex items-center text-xs text-gray-600">
                    <File className="w-4 h-4 mr-2 text-gray-500 flex-shrink-0" />
                    <span>
                      {loading ? (
                        'Loading...'
                      ) : (
                        (() => {
                          let docCount = 0;
                          if (documents.length > 0) {
                            docCount = documents.length;
                          } else if (property.propertyHub?.documents?.length) {
                            docCount = property.propertyHub.documents.length;
                          } else if (property.documentCount) {
                            docCount = property.documentCount;
                          }
                          return `${docCount} Document${docCount !== 1 ? 's' : ''}`;
                        })()
                      )}
                    </span>
                  </div>

                  {/* Square Footage */}
                  {property.square_feet && (
                    <div className="flex items-center text-xs text-gray-600">
                      <Ruler className="w-4 h-4 mr-2 text-gray-500 flex-shrink-0" />
                      <span>{property.square_feet.toLocaleString()} sqft</span>
                    </div>
                  )}

                  {/* EPC Rating */}
                  {property.epc_rating && (
                    <div className="flex items-center text-xs text-gray-600">
                      <File className="w-4 h-4 mr-2 text-gray-500 flex-shrink-0" />
                      <span>EPC: {property.epc_rating} Rating</span>
                    </div>
                  )}
                </div>

                {/* Row 2: Price, Property Type, Tenure */}
                <div className="flex items-center gap-6 flex-wrap">
                  {/* Price */}
                  <div className="flex items-center text-xs text-gray-600">
                    <DollarSign className="w-4 h-4 mr-2 text-gray-500 flex-shrink-0" />
                    <span>{getPrimaryPrice()}</span>
                  </div>

                  {/* Property Type */}
                  <div className="flex items-center text-xs text-gray-600">
                    <Home className="w-4 h-4 mr-2 text-gray-500 flex-shrink-0" />
                    <span>{property.property_type || 'Dwellinghouse'}</span>
                  </div>

                  {/* Tenure */}
                  {property.tenure && (
                    <div className="flex items-center text-xs text-gray-600">
                      <File className="w-4 h-4 mr-2 text-gray-500 flex-shrink-0" />
                      <span>{property.tenure}</span>
                    </div>
                  )}
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
                </div>

                {/* Additional Info (Rent, Yield, Letting) - Full Width if Present */}
                {(property.rentPcm > 0 || lettingInfo) && (
                  <div className="pt-4 mt-4 border-t border-gray-100 space-y-2">
                    {property.rentPcm > 0 && (
                      <div className="text-sm text-gray-700">
                        <span className="font-medium">Rent:</span> £{property.rentPcm.toLocaleString()} pcm
                        {yieldPercentage && (
                          <span className="text-gray-500 ml-2">({yieldPercentage}% yield)</span>
                        )}
                      </div>
                    )}
                    {lettingInfo && (
                      <div className="text-sm text-gray-700">
                        <span className="font-medium">Letting:</span> {lettingInfo}
                      </div>
                    )}
                  </div>
                )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

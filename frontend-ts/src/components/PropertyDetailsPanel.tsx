"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { File, CloudUpload, X } from 'lucide-react';
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
        <div className="bg-white rounded-xl shadow-xl flex flex-col overflow-hidden flex-1 border border-gray-100">
          {/* Scrollable Content Container */}
          <div className="flex-1 overflow-y-auto">
            {/* Header - Address Bar */}
            <div className="bg-white border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-medium text-gray-900 leading-tight truncate">
                {getPropertyName(property.address || 'Unknown Address')}
              </h2>
            </div>

            {/* Property Image Section - Large Prominent Image */}
            <div className="relative w-full" style={{ aspectRatio: '16/10' }}>
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
                className="absolute top-3 right-3 w-8 h-8 bg-white/95 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-white transition-colors shadow-md z-10"
              >
                <X className="w-4 h-4 text-gray-700" strokeWidth={2.5} />
              </button>
            </div>

            {/* Content Section */}
            <div className="p-4 space-y-4">
              {/* Add File Button and View Toggle Buttons */}
              <div className="flex items-center gap-2">
                {/* Add File Button - Modern Green-Grey Style */}
                <button
                  onClick={() => {
                    // TODO: Wire up document upload functionality
                    console.log('Add Document clicked');
                  }}
                  className="flex-1 py-3 px-4 rounded-lg font-medium transition-all text-sm flex items-center justify-center gap-2 bg-[#E8F5E9] hover:bg-[#C8E6C9] text-gray-700 border border-[#C5E1C6] shadow-sm hover:shadow-md"
                >
                  <CloudUpload className="w-4 h-4" strokeWidth={2} />
                  <span>Add File</span>
                </button>

                {/* Property Card (3) Button */}
                <button
                  onClick={() => {
                    // TODO: Wire up card size toggle functionality
                    console.log('Property Card (3) clicked');
                  }}
                  className="w-12 h-12 rounded-lg flex items-center justify-center transition-all hover:bg-gray-50 border border-gray-200"
                >
                  <img 
                    src="/Property Card (3) Button.png" 
                    alt="Property Card View 3" 
                    className="w-full h-full object-contain p-1"
                    onError={(e) => {
                      console.error('Failed to load Property Card (3) Button image');
                    }}
                  />
                </button>

                {/* Property Card (2) Button */}
                <button
                  onClick={() => {
                    // TODO: Wire up card size toggle functionality
                    console.log('Property Card (2) clicked');
                  }}
                  className="w-12 h-12 rounded-lg flex items-center justify-center transition-all hover:bg-gray-50 border border-gray-200"
                >
                  <img 
                    src="/Property card (2) Button.png" 
                    alt="Property Card View 2" 
                    className="w-full h-full object-contain p-1"
                    onError={(e) => {
                      console.error('Failed to load Property Card (2) Button image');
                    }}
                  />
                </button>
              </div>

              {/* Property Details Grid - Modern Two Column Layout */}
              <div className="grid grid-cols-2 gap-3">
                {/* Left Column */}
                <div className="space-y-3">
                  {/* Document Count */}
                  <div className="flex items-center gap-2 text-sm">
                    <File className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <span className="text-gray-700">
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
                    <div className="text-sm text-gray-700">
                      {property.square_feet.toLocaleString()} sqft
                    </div>
                  )}

                  {/* EPC Rating */}
                  {property.epc_rating && (
                    <div className="text-sm text-gray-700">
                      EPC: {property.epc_rating} Rating
                    </div>
                  )}
                </div>

                {/* Right Column */}
                <div className="space-y-3">
                  {/* Price */}
                  <div className="text-sm text-gray-700 font-medium">
                    {getPrimaryPrice()}
                  </div>

                  {/* Property Type */}
                  <div className="text-sm text-gray-700">
                    {property.property_type || property.bedrooms ? (
                      <>
                        {property.bedrooms ? `${property.bedrooms} Bed` : ''}
                        {property.bedrooms && property.property_type ? ' · ' : ''}
                        {property.property_type || 'Dwellinghouse'}
                      </>
                    ) : (
                      'Dwellinghouse'
                    )}
                  </div>

                  {/* Tenure */}
                  {property.tenure && (
                    <div className="text-sm text-gray-700">
                      {property.tenure}
                    </div>
                  )}
                </div>
              </div>

              {/* Additional Info (Rent, Yield, Letting) - Full Width if Present */}
              {(property.rentPcm > 0 || lettingInfo) && (
                <div className="pt-2 border-t border-gray-100 space-y-2">
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
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

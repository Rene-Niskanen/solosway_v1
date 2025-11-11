"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { File, CloudUpload } from 'lucide-react';
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
      >
        {/* Address Overlay - Floating Island Above Card */}
        <div className="relative mb-3 flex justify-center z-10">
          <div className="bg-white/95 backdrop-blur-sm rounded-lg px-4 py-2 shadow-lg max-w-[90%]">
            <h2 className="text-sm font-semibold text-gray-900 leading-tight text-center truncate">
              {property.address || 'Unknown Address'}
            </h2>
          </div>
        </div>

        {/* Card Container */}
        <div className="bg-white rounded-lg shadow-2xl flex flex-col overflow-hidden flex-1"
          style={{
            background: 'rgba(255, 255, 255, 0.98)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)'
          }}
        >
          {/* Scrollable Content Container */}
          <div className="flex-1 overflow-y-auto">
            {/* Property Image Section */}
            <div className="relative w-full" style={{ aspectRatio: '3/2' }}>
              <img
                src={getPropertyImage()}
                alt={property.address || 'Property'}
                className="w-full h-full object-cover"
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  img.src = '/property-1.png';
                }}
              />
              {/* Close Button Overlay */}
              <button
                onClick={onClose}
                className="absolute top-2 right-2 w-8 h-8 bg-gray-200/90 rounded-full flex items-center justify-center hover:bg-gray-300/90 transition-colors shadow-sm"
              >
                <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

          {/* Content Section */}
          <div className="p-4 space-y-3">

            {/* Add Document Button and View Toggle Buttons */}
            <div className="flex items-center gap-2">
              {/* Add Document Button */}
              <button
                onClick={() => {
                  // TODO: Wire up document upload functionality
                  console.log('Add Document clicked');
                }}
                className="flex-1 py-2.5 px-4 rounded-md font-medium transition-colors text-sm border flex items-center justify-center gap-3"
                style={{
                  backgroundColor: '#F5F9F5',
                  color: '#5C5C5C',
                  borderColor: '#C9C2C2'
                }}
              >
                <CloudUpload className="w-4 h-4" />
                <span>Add File</span>
              </button>

              {/* Property Card (3) Button */}
              <button
                onClick={() => {
                  // TODO: Wire up card size toggle functionality
                  console.log('Property Card (3) clicked');
                }}
                className="w-12 h-[42px] rounded-md flex items-center justify-center transition-colors bg-transparent"
              >
                <img 
                  src="/Property Card (3) Button.png" 
                  alt="Property Card View 3" 
                  className="w-full h-full object-contain"
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
                className="w-12 h-[42px] rounded-md flex items-center justify-center transition-colors bg-transparent"
              >
                <img 
                  src="/Property card (2) Button.png" 
                  alt="Property Card View 2" 
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    console.error('Failed to load Property Card (2) Button image');
                  }}
                />
              </button>
            </div>

            {/* Property Details Grid (2 columns) - All items in rounded pills */}
            <div className="grid grid-cols-2 gap-2 text-sm pt-2">
              {/* Row 1: Document Count (Left) | Price (Right) */}
              <div className="px-3 py-2 rounded-full bg-white flex items-center gap-2">
                {loading ? (
                  <span className="text-gray-600">Loading...</span>
                ) : (
                  <>
                    <File className="w-4 h-4 text-gray-700 flex-shrink-0" />
                    <span className="text-gray-700">
                      {(() => {
                        let docCount = 0;
                        if (documents.length > 0) {
                          docCount = documents.length;
                        } else if (property.propertyHub?.documents?.length) {
                          docCount = property.propertyHub.documents.length;
                        } else if (property.documentCount) {
                          docCount = property.documentCount;
                        }
                        return `${docCount} Document${docCount !== 1 ? 's' : ''}`;
                      })()}
                    </span>
                  </>
                )}
              </div>

              <div className="px-3 py-2 rounded-full bg-white text-gray-700">
                {getPrimaryPrice()}
              </div>

              {/* Row 2: Square Footage (Left) | Bed/Type (Right) */}
              {property.square_feet && (
                <div className="px-3 py-2 rounded-full bg-white">
                  <span className="text-gray-700">{property.square_feet.toLocaleString()} sqft</span>
                </div>
              )}

              <div className="px-3 py-2 rounded-full bg-white">
                <span className="text-gray-700">
                  {property.bedrooms ? `${property.bedrooms} Bed` : ''}
                  {property.bedrooms && property.property_type ? ' · ' : ''}
                  {property.property_type || ''}
                </span>
              </div>

              {/* Row 3: EPC Rating (Left) | Tenure (Right) */}
              {property.epc_rating && (
                <div className="px-3 py-2 rounded-full bg-white">
                  <span className="text-gray-700">EPC: {property.epc_rating} Rating</span>
                </div>
              )}

              {property.tenure && (
                <div className="px-3 py-2 rounded-full bg-white">
                  <span className="text-gray-700">{property.tenure}</span>
                </div>
              )}

              {/* Row 4: Rent Info (Left) | Letting Info (Right) */}
              {property.rentPcm > 0 && (
                <div className="px-3 py-2 rounded-full bg-white">
                  <span className="text-gray-700">
                    £{property.rentPcm.toLocaleString()} pcm
                    {yieldPercentage && ` · ${yieldPercentage}%`}
                  </span>
                </div>
              )}

              {lettingInfo && (
                <div className="px-3 py-2 rounded-full bg-white">
                  <span className="text-gray-700">{lettingInfo}</span>
                </div>
              )}
            </div>
          </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

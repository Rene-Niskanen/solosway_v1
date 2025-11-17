"use client";

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { File, CloudUpload, X, Upload, FileText, MapPin, Home, Ruler, DollarSign, Bed, Bath, Sofa, Car } from 'lucide-react';
import { useBackendApi } from './BackendApi';
import { PropertyFilesModal } from './PropertyFilesModal';

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
  const [isFilesModalOpen, setIsFilesModalOpen] = useState(false);
  
  // Sync ref with state
  React.useEffect(() => {
    isFilesModalOpenRef.current = isFilesModalOpen;
  }, [isFilesModalOpen]);
  const [modalPosition, setModalPosition] = useState<{ top: number; left: number } | undefined>();
  const [isFilesLoading, setIsFilesLoading] = useState(false);
  const [hasFilesFetched, setHasFilesFetched] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const viewFilesButtonRef = useRef<HTMLButtonElement>(null);
  const isClosingRef = useRef(false); // Track if we're in the process of closing
  const isFilesModalOpenRef = useRef(false); // Track modal state in ref to avoid race conditions

  // Load documents when property changes
  useEffect(() => {
    if (property && property.id) {
      console.log('📄 PropertyDetailsPanel: Property changed, loading documents for:', property.id);
      
      // First, check for preloaded files (Instagram-style preloading)
      const preloadedFiles = (window as any).__preloadedPropertyFiles?.[property.id];
      if (preloadedFiles && Array.isArray(preloadedFiles) && preloadedFiles.length > 0) {
        console.log('✅ Using preloaded files for property:', property.id, 'Count:', preloadedFiles.length);
        setDocuments(preloadedFiles);
        setLoading(false);
        return;
      }
      
      // Second, check if documents are already available in propertyHub
      if (property.propertyHub?.documents && property.propertyHub.documents.length > 0) {
        console.log('✅ Using propertyHub documents:', property.id, 'Count:', property.propertyHub.documents.length);
        setDocuments(property.propertyHub.documents);
        setLoading(false);
        // Also store in preloaded files for future use
        if (!(window as any).__preloadedPropertyFiles) {
          (window as any).__preloadedPropertyFiles = {};
        }
        (window as any).__preloadedPropertyFiles[property.id] = property.propertyHub.documents;
      } else {
        // Load documents in background (no loading state)
        console.log('📄 No preloaded files found, loading documents for property:', property.id);
        loadPropertyDocuments();
      }
    } else {
      console.log('⚠️ PropertyDetailsPanel: No property or property.id');
      setDocuments([]);
    }
  }, [property]);

  const loadPropertyDocuments = async () => {
    if (!property?.id) {
      console.log('⚠️ loadPropertyDocuments: No property or property.id');
      return;
    }
    
    // Don't show loading state - load silently in background
    setError(null);
    
    try {
      console.log('📄 Loading documents for property:', property.id);
      const response = await backendApi.getPropertyHubDocuments(property.id);
      console.log('📄 API response:', response);
      console.log('📄 API response type:', typeof response, 'Is array:', Array.isArray(response));
      
      // API returns { success: true, data: { documents: [...] } }
      // BackendApi.tsx returns response.data, so response is { documents: [...] }
      let documentsToUse = null;
      
      if (response && response.documents && Array.isArray(response.documents)) {
        documentsToUse = response.documents;
        console.log('✅ Found documents in response.documents:', documentsToUse.length);
      } else if (response && Array.isArray(response)) {
        // Handle case where API returns array directly
        documentsToUse = response;
        console.log('✅ Found documents as array:', documentsToUse.length);
      } else if (response && response.data && response.data.documents && Array.isArray(response.data.documents)) {
        // Handle case where response still has data wrapper
        documentsToUse = response.data.documents;
        console.log('✅ Found documents in response.data.documents:', documentsToUse.length);
      }
      
      if (documentsToUse && documentsToUse.length > 0) {
        console.log('✅ Loaded documents:', documentsToUse.length, 'documents');
        setDocuments(documentsToUse);
        // Store in preloaded files for future use
        if (!(window as any).__preloadedPropertyFiles) {
          (window as any).__preloadedPropertyFiles = {};
        }
        (window as any).__preloadedPropertyFiles[property.id] = documentsToUse;
        console.log('✅ Stored documents in preloaded cache for property:', property.id);
      } else {
        // Fallback to propertyHub documents if API returns nothing
        if (property.propertyHub?.documents && property.propertyHub.documents.length > 0) {
          console.log('📄 Using propertyHub documents as fallback:', property.propertyHub.documents.length);
          setDocuments(property.propertyHub.documents);
        } else {
          console.log('⚠️ No documents found for property:', property.id);
          setDocuments([]);
        }
      }
    } catch (err) {
      console.error('❌ Error loading documents:', err);
      setError('Failed to load documents');
      // Fallback to propertyHub documents on error
      if (property.propertyHub?.documents && property.propertyHub.documents.length > 0) {
        console.log('📄 Using propertyHub documents as error fallback');
        setDocuments(property.propertyHub.documents);
      } else {
        setDocuments([]);
      }
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

  if (!isVisible) return null;
  
  // Debug logging for blank screen issue
  if (!property) {
    console.error('❌ PropertyDetailsPanel: property is null/undefined', {
      isVisible,
      property,
      propertyId: property?.id
    });
    return null;
  }
  
  console.log('✅ PropertyDetailsPanel rendering with property:', {
    id: property.id,
    address: property.address,
    hasPropertyHub: !!property.propertyHub
  });

  const yieldPercentage = calculateYield();
  const lettingInfo = getLettingInfo();

  // Get property ID
  const propertyId = property?.id?.toString() || property?.property_id?.toString();

  return (
    <>
      <AnimatePresence>
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-5 right-4 w-[420px] max-h-[calc(100vh-2rem)] z-[100] flex flex-col"
          style={{ backgroundColor: 'transparent' }}
          data-property-panel
        >
        {/* Card Container - Modern White Card - Matching database white */}
        <motion.div 
          className="bg-white rounded-lg shadow-2xl flex flex-col overflow-hidden flex-1 border border-gray-200"
          style={{ 
            backgroundColor: '#ffffff',
            filter: 'none', // Remove any filters that might affect brightness
            opacity: 1, // Ensure full opacity
          }}
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
              <div className="px-5 pt-5 pb-4">
                {/* Title - Moved below image */}
                <h2 className="text-lg font-semibold text-gray-900 leading-tight mb-3">
                  {getPropertyName(property.address || 'Unknown Address')}
                </h2>

                {/* Property Summary/Description - Expandable */}
                <div>
                  {renderSummary()}
                </div>
              </div>
            </div>

            {/* Container 2: Icons, Property Info, Action Buttons (completely independent) */}
            <div className="px-5 pb-5" style={{ position: 'relative', transform: 'translateZ(0)', contain: 'layout style paint', isolation: 'isolate' }}>
                {/* Action Buttons - Sharp outline on hover */}
                <div className="flex gap-2.5 mb-5">
                <button
                  ref={viewFilesButtonRef}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Access native event for stopImmediatePropagation
                    if (e.nativeEvent && 'stopImmediatePropagation' in e.nativeEvent) {
                      (e.nativeEvent as any).stopImmediatePropagation();
                    }
                    
                    // Prevent reopening if we're in the process of closing
                    if (isClosingRef.current) {
                      return;
                    }
                    
                    // Use ref to check state to avoid race conditions
                    const currentModalState = isFilesModalOpenRef.current;
                    
                    if (currentModalState) {
                      // Close the modal if it's already open - just hide it, don't reset fetch state
                      console.log('🔴 Closing files modal, isFilesModalOpen:', currentModalState);
                      isClosingRef.current = true;
                      setIsFilesModalOpen(false);
                      console.log('🔴 Set isFilesModalOpen to false');
                      // Reset closing flag after a brief delay
                      setTimeout(() => {
                        isClosingRef.current = false;
                      }, 200);
                      // Don't reset hasFilesFetched - keep it true so we don't show loading animation again
                      return; // Early return to prevent any other logic from running
                    } else {
                      // Check if files are preloaded before opening modal
                      const propertyId = property?.id;
                      if (!propertyId) return;
                      
                      // First check for preloaded files
                      const preloadedFiles = (window as any).__preloadedPropertyFiles?.[propertyId];
                      if (preloadedFiles && Array.isArray(preloadedFiles) && preloadedFiles.length > 0) {
                        // Files are ready - open modal immediately
                        requestAnimationFrame(() => {
                          if (panelRef.current && !isClosingRef.current) {
                            const panelRect = panelRef.current.getBoundingClientRect();
                            const modalWidth = 420;
                            const viewportWidth = window.innerWidth;
                            const leftPosition = Math.max(
                              modalWidth / 2 + 10,
                              Math.min(
                                panelRect.left + (panelRect.width / 2),
                                viewportWidth - (modalWidth / 2) - 10
                              )
                            );
                            
                            setModalPosition({
                              top: panelRect.top,
                              left: leftPosition
                            });
                            setIsFilesModalOpen(true);
                          }
                        });
                      } else {
                        // Files not preloaded - load them first, then open modal
                        console.log('📄 Files not preloaded, loading documents for property:', propertyId);
                        const loadAndOpen = async () => {
                          try {
                            const response = await backendApi.getPropertyHubDocuments(propertyId);
                            console.log('📄 View Files - API response:', response);
                            
                            let documentsToUse = null;
                            if (response && response.documents && Array.isArray(response.documents)) {
                              documentsToUse = response.documents;
                            } else if (Array.isArray(response)) {
                              documentsToUse = response;
                            }
                            
                            if (documentsToUse && documentsToUse.length > 0) {
                              // Store in preloaded files
                              if (!(window as any).__preloadedPropertyFiles) {
                                (window as any).__preloadedPropertyFiles = {};
                              }
                              (window as any).__preloadedPropertyFiles[propertyId] = documentsToUse;
                              console.log('✅ Loaded and stored documents:', documentsToUse.length, 'files');
                              
                              // Now open modal with files ready
                              requestAnimationFrame(() => {
                                if (panelRef.current && !isClosingRef.current) {
                                  const panelRect = panelRef.current.getBoundingClientRect();
                                  const modalWidth = 420;
                                  const viewportWidth = window.innerWidth;
                                  const leftPosition = Math.max(
                                    modalWidth / 2 + 10,
                                    Math.min(
                                      panelRect.left + (panelRect.width / 2),
                                      viewportWidth - (modalWidth / 2) - 10
                                    )
                                  );
                                  
                                  setModalPosition({
                                    top: panelRect.top,
                                    left: leftPosition
                                  });
                                  setIsFilesModalOpen(true);
                                  console.log('✅ Modal opened after loading documents');
                                }
                              });
                            } else {
                              console.log('⚠️ No documents found for property:', propertyId);
                              // If no documents found, don't open modal at all
                            }
                          } catch (error) {
                            console.error('❌ Error loading files before opening modal:', error);
                            // Don't open modal if there's an error or no documents
                          }
                        };
                        
                        loadAndOpen();
                      }
                    }
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-all duration-150 rounded-lg flex-shrink-0 relative flex-1 justify-center border border-transparent hover:border-gray-300 hover:bg-gray-100/50"
                  style={{
                    minWidth: 'fit-content',
                    maxWidth: 'none',
                    width: 'auto',
                    flexBasis: 'auto',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    boxSizing: 'border-box',
                    display: 'inline-flex',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    touchAction: 'none',
                  }}
                >
                  <FileText className="w-4 h-4 text-gray-600" />
                  <span className="text-sm font-medium text-gray-700" style={{ fontSize: '13px', fontWeight: 500, lineHeight: '1.2' }}>
                    {isFilesModalOpen && hasFilesFetched ? 'Close Files' : 'View Files'}
                  </span>
                </button>
                
                <button
                  onClick={() => {
                    // TODO: Wire up document upload functionality
                    console.log('Upload clicked');
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-all duration-150 rounded-lg flex-shrink-0 relative flex-1 justify-center border border-transparent hover:border-gray-300 hover:bg-gray-100/50"
                  style={{
                    minWidth: 'fit-content',
                    maxWidth: 'none',
                    width: 'auto',
                    flexBasis: 'auto',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    boxSizing: 'border-box',
                    display: 'inline-flex',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    touchAction: 'none',
                  }}
                >
                  <Upload className="w-4 h-4 text-gray-600" />
                  <span className="text-sm font-medium text-gray-700" style={{ fontSize: '13px', fontWeight: 500, lineHeight: '1.2' }}>
                    Upload
                  </span>
                </button>
                </div>

                {/* Property Details with Icons - Horizontal Rows */}
                <div className="space-y-3.5">
                {/* Row 1: Document Count, Square Footage, EPC Rating */}
                <div className="flex items-center gap-7 flex-wrap">
                  {/* Document Count */}
                  <div className="flex items-center text-xs text-gray-600">
                    <File className="w-4 h-4 mr-2.5 text-gray-500 flex-shrink-0" />
                    <span>
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
                  </div>

                  {/* Square Footage */}
                  {property.square_feet && (
                    <div className="flex items-center text-xs text-gray-600">
                      <Ruler className="w-4 h-4 mr-2.5 text-gray-500 flex-shrink-0" />
                      <span>{property.square_feet.toLocaleString()} sqft</span>
                    </div>
                  )}

                  {/* EPC Rating */}
                  {property.epc_rating && (
                    <div className="flex items-center text-xs text-gray-600">
                      <File className="w-4 h-4 mr-2.5 text-gray-500 flex-shrink-0" />
                      <span>EPC: {property.epc_rating} Rating</span>
                    </div>
                  )}
                </div>

                {/* Row 2: Price, Property Type, Tenure */}
                <div className="flex items-center gap-7 flex-wrap">
                  {/* Price */}
                  <div className="flex items-center text-xs text-gray-600">
                    <DollarSign className="w-4 h-4 mr-2.5 text-gray-500 flex-shrink-0" />
                    <span>{getPrimaryPrice()}</span>
                  </div>

                  {/* Property Type */}
                  <div className="flex items-center text-xs text-gray-600">
                    <Home className="w-4 h-4 mr-2.5 text-gray-500 flex-shrink-0" />
                    <span>{property.property_type || 'Dwellinghouse'}</span>
                  </div>

                  {/* Tenure */}
                  {property.tenure && (
                    <div className="flex items-center text-xs text-gray-600">
                      <File className="w-4 h-4 mr-2.5 text-gray-500 flex-shrink-0" />
                      <span>{property.tenure}</span>
                    </div>
                  )}
                </div>

                {/* Row 3: Bedrooms & Bathrooms - Only show if values exist and > 0 */}
                {(property.bedrooms > 0 || property.bathrooms > 0) && (
                  <div className="flex items-center gap-7 text-xs text-gray-600">
                    {property.bedrooms > 0 && (
                      <div className="flex items-center">
                        <Bed className="w-4 h-4 mr-2.5 text-gray-500 flex-shrink-0" />
                        <span>{property.bedrooms}</span>
                      </div>
                    )}
                    {property.bathrooms > 0 && (
                      <div className="flex items-center">
                        <Bath className="w-4 h-4 mr-2.5 text-gray-500 flex-shrink-0" />
                        <span>{property.bathrooms}</span>
                      </div>
                    )}
                  </div>
                )}
                </div>

                {/* Additional Info (Rent, Yield, Letting) - Full Width if Present */}
                {(property.rentPcm > 0 || lettingInfo) && (
                  <div className="pt-5 mt-5 border-t border-gray-100 space-y-2.5">
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
      
      {/* Property Files Modal - Outside AnimatePresence to avoid key conflicts */}
        {propertyId && (
          <PropertyFilesModal
            key={`files-modal-${propertyId}`}
            propertyId={propertyId}
            propertyAddress={property?.formatted_address || property?.address}
            isOpen={isFilesModalOpen}
            onClose={() => {
              console.log('🔴 PropertyFilesModal onClose called');
              setIsFilesModalOpen(false);
              // Don't reset hasFilesFetched - keep it true so we don't show loading animation again when reopening
            }}
            position={modalPosition}
            onLoadingStateChange={(isLoading, hasFetched) => {
              setIsFilesLoading(isLoading);
              setHasFilesFetched(hasFetched);
            }}
            isMapVisible={true}
            isSidebarCollapsed={false}
          />
        )}
    </>
  );
};

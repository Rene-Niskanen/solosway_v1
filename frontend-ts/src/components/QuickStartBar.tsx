"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SendToBack, Upload, GitPullRequestArrow, X, Home, FileText, Check } from "lucide-react";
import { backendApi } from "@/services/backendApi";

interface PropertyData {
  id: string | number;
  address: string;
  property_type?: string;
  custom_name?: string;
  image?: string;
  primary_image_url?: string;
  [key: string]: any;
}

interface QuickStartBarProps {
  onDocumentLinked?: (propertyId: string, documentId: string) => void;
  onPopupVisibilityChange?: (isVisible: boolean) => void;
  className?: string;
}

// Property Image Thumbnail Component
const PropertyImageThumbnail: React.FC<{ property: PropertyData }> = ({ property }) => {
  const [imageError, setImageError] = React.useState(false);
  const imageUrl = property.image || property.primary_image_url;

  return (
    <div style={{
      width: '40px',
      height: '40px',
      borderRadius: '4px',
      overflow: 'hidden',
      backgroundColor: '#f3f4f6',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      border: '1px solid rgba(0, 0, 0, 0.08)'
    }}>
      {imageUrl && !imageError ? (
        <img
          src={imageUrl}
          alt={property.custom_name || property.address}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block'
          }}
          onError={() => setImageError(true)}
        />
      ) : (
        <div style={{
          width: '100%',
          height: '100%',
          backgroundColor: '#10b981',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <Home className="w-5 h-5 text-white" strokeWidth={2.5} />
        </div>
      )}
    </div>
  );
};

export const QuickStartBar: React.FC<QuickStartBarProps> = ({
  onDocumentLinked,
  onPopupVisibilityChange,
  className
}) => {
  const [searchQuery, setSearchQuery] = React.useState<string>("");
  const [searchResults, setSearchResults] = React.useState<PropertyData[]>([]);
  const [selectedProperty, setSelectedProperty] = React.useState<PropertyData | null>(null);
  const [uploadedFile, setUploadedFile] = React.useState<File | null>(null);
  const [isUploading, setIsUploading] = React.useState<boolean>(false);
  const [showResultsPopup, setShowResultsPopup] = React.useState<boolean>(false);
  const [isDragOver, setIsDragOver] = React.useState<boolean>(false);
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState<string | null>(null);
  const [notification, setNotification] = React.useState<{ type: 'success' | 'failed' } | null>(null);

  // Notify parent when popup visibility changes
  React.useEffect(() => {
    onPopupVisibilityChange?.(showResultsPopup);
  }, [showResultsPopup, onPopupVisibilityChange]);
  
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const resultsPopupRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const debounceTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  // Real-time property search (very short debounce for responsiveness)
  React.useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Only search if no property is selected and query is at least 1 character
    if (!selectedProperty && searchQuery.trim().length >= 1) {
      debounceTimerRef.current = setTimeout(async () => {
        try {
          const response = await backendApi.searchPropertyHubs(searchQuery, {});
          
          // The backend returns { success: true, data: [...], metadata: {...} }
          // But fetchApi wraps it, so we get { success: true, data: { success: true, data: [...], metadata: {...} } }
          let results: any[] = [];
          
          if (response.success && response.data) {
            const data = response.data as any;
            // Check if response.data is already an array (direct data)
            if (Array.isArray(data)) {
              results = data;
            }
            // Check if response.data has a nested structure with data property
            else if (data && typeof data === 'object' && data.data && Array.isArray(data.data)) {
              results = data.data;
            }
            // Check if response.data has success and data (nested response)
            else if (data && typeof data === 'object' && data.success && Array.isArray(data.data)) {
              results = data.data;
            }
          }
          
          if (results.length > 0) {
            // Sort results by relevance (exact matches first, then by position of match in address)
            const queryLower = searchQuery.toLowerCase().trim();
            const sortedResults = results
              .map((hub: any) => {
                const property = hub.property || hub;
                const propertyDetails = hub.property_details || {};
                
                const address = (property.formatted_address || property.normalized_address || property.address || '').toLowerCase();
                const customName = (property.custom_name || '').toLowerCase();
                
                // Calculate relevance score
                let score = 0;
                if (customName.startsWith(queryLower)) score += 100;
                else if (customName.includes(queryLower)) score += 50;
                if (address.startsWith(queryLower)) score += 80;
                else if (address.includes(queryLower)) {
                  const index = address.indexOf(queryLower);
                  score += Math.max(0, 60 - index); // Earlier matches score higher
                }
                
                return {
                  id: property.id || hub.id,
                  address: property.formatted_address || property.normalized_address || property.address || 'Unknown Address',
                  property_type: propertyDetails.property_type || property.property_type,
                  custom_name: property.custom_name,
                  image: property.image,
                  primary_image_url: property.primary_image_url,
                  ...property,
                  ...propertyDetails,
                  _relevanceScore: score
                };
              })
              .sort((a, b) => (b._relevanceScore || 0) - (a._relevanceScore || 0))
              .slice(0, 10); // Limit to 10 results
            
            setSearchResults(sortedResults);
            setShowResultsPopup(true);
          } else {
            setSearchResults([]);
            setShowResultsPopup(false);
          }
        } catch (error) {
          console.error('Error searching properties:', error);
          setSearchResults([]);
          setShowResultsPopup(false);
        }
      }, 100); // Very short debounce for real-time feel
    } else if (!selectedProperty && searchQuery.trim().length === 0) {
      setSearchResults([]);
      setShowResultsPopup(false);
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery, selectedProperty]);

  // Close popup when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        resultsPopupRef.current &&
        !resultsPopupRef.current.contains(event.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target as Node)
      ) {
        setShowResultsPopup(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Handle property selection
  const handlePropertySelect = (property: PropertyData) => {
    setSelectedProperty(property);
    setSearchQuery("");
    setSearchResults([]);
    setShowResultsPopup(false);
  };

  // Handle property removal
  const handlePropertyRemove = () => {
    setSelectedProperty(null);
    setSearchQuery("");
  };

  // Handle file selection
  const handleFileSelect = (file: File) => {
    // Validate file type
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.some(type => file.type === type || file.name.toLowerCase().endsWith('.pdf') || file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.doc'))) {
      setNotification({ type: 'failed' });
      setTimeout(() => setNotification(null), 2000);
      return;
    }

    // Validate file size (16MB max)
    const maxSize = 16 * 1024 * 1024; // 16MB
    if (file.size > maxSize) {
      setNotification({ type: 'failed' });
      setTimeout(() => setNotification(null), 2000);
      return;
    }

    setUploadedFile(file);
  };

  // Handle file input change
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle drag and drop
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  // Handle save/upload and link
  const handleSave = async () => {
    if (!selectedProperty) {
      setNotification({ type: 'failed' });
      setTimeout(() => setNotification(null), 2000);
      return;
    }

    if (!uploadedFile) {
      setNotification({ type: 'failed' });
      setTimeout(() => setNotification(null), 2000);
      return;
    }

    setIsUploading(true);

    try {
      // Get property ID - ensure it's a string
      const propertyId = typeof selectedProperty.id === 'number' 
        ? selectedProperty.id.toString() 
        : selectedProperty.id;
      
      // Upload document with property_id in metadata (backend will auto-link)
      // This matches how property card uploads work
      const uploadResponse = await backendApi.uploadPropertyDocumentViaProxy(
        uploadedFile,
        {
          property_id: propertyId,
          property_address: selectedProperty.address,
          property_latitude: selectedProperty.latitude,
          property_longitude: selectedProperty.longitude
        }
      );
      
      if (!uploadResponse.success) {
        throw new Error(uploadResponse.error || 'Upload failed');
      }

      // Get document ID from response (handle different response formats)
      // Backend returns: { success: true, document_id: "..." }
      // backendApi.fetchApi wraps it, so check response.data.document_id or response.data.data.document_id
      const documentId = uploadResponse.data?.document_id || 
                        uploadResponse.data?.id || 
                        (uploadResponse.data?.data as any)?.document_id ||
                        (uploadResponse as any).document_id;

      if (!documentId) {
        throw new Error('Document ID not found in response');
      }

      // Success! Document is already linked by backend
      setNotification({ type: 'success' });
      // Auto-hide after 2 seconds
      setTimeout(() => setNotification(null), 2000);

      // Callback
      if (onDocumentLinked) {
        onDocumentLinked(propertyId, documentId);
      }

      // Reset form
      setSelectedProperty(null);
      setUploadedFile(null);
      setSearchQuery("");
      setSearchResults([]);

    } catch (error) {
      console.error('Error uploading and linking document:', error);
      // Try to get more detailed error message from response
      let errorMessage = 'Failed to upload and link document.';
      if (error instanceof Error) {
        errorMessage = error.message;
        // Check if there's a response with error details
        if ((error as any).response) {
          const responseError = (error as any).response;
          if (responseError.error) {
            errorMessage = responseError.error;
          }
          if (responseError.details) {
            errorMessage += ` (${responseError.details})`;
          }
        }
      }
      setNotification({ type: 'failed' });
      // Auto-hide after 2.5 seconds
      setTimeout(() => setNotification(null), 2500);
    } finally {
      setIsUploading(false);
    }
  };

  // Format address for display
  const formatAddress = (address: string): string => {
    const parts = address.split(',');
    const shortAddress = parts[0] || address;
    if (shortAddress.length > 30) {
      return shortAddress.substring(0, 27) + '...';
    }
    return shortAddress;
  };

  // Format file name
  const formatFileName = (name: string): string => {
    if (name.length > 30) {
      const extension = name.split('.').pop();
      const nameWithoutExt = name.substring(0, name.lastIndexOf('.'));
      return `${nameWithoutExt.substring(0, 27)}...${extension ? '.' + extension : ''}`;
    }
    return name;
  };

  // Get file type label
  const getFileTypeLabel = (type: string): string => {
    if (type.includes('pdf')) return 'PDF';
    if (type.includes('word') || type.includes('document')) return 'DOC';
    if (type.includes('image')) return 'IMG';
    return 'FILE';
  };

  const isPDF = uploadedFile?.type === 'application/pdf';
  const isDOCX = uploadedFile?.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                 uploadedFile?.type === 'application/msword' ||
                 (uploadedFile?.name && (uploadedFile.name.toLowerCase().endsWith('.docx') || uploadedFile.name.toLowerCase().endsWith('.doc')));
  const isImage = uploadedFile?.type.startsWith('image/');

  // Create and cleanup image preview URL
  React.useEffect(() => {
    if (uploadedFile && isImage) {
      const url = URL.createObjectURL(uploadedFile);
      setImagePreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setImagePreviewUrl(null);
    }
  }, [uploadedFile, isImage]);

  return (
    <>
      <style>{`
        .quick-start-search-input::placeholder {
          color: rgba(107, 114, 128, 0.7);
        }
        .quick-start-search-input::-webkit-input-placeholder {
          color: rgba(107, 114, 128, 0.7);
        }
        .quick-start-search-input::-moz-placeholder {
          color: rgba(107, 114, 128, 0.7);
        }
        .quick-start-search-input:-ms-input-placeholder {
          color: rgba(107, 114, 128, 0.7);
        }
      `}</style>
      <div
        className={`relative ${className || ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{
          marginTop: 'clamp(0.5rem, 2vh, 1rem)',
          marginBottom: 'clamp(2rem, 5vh, 4rem)',
          width: '100%',
          display: 'flex',
          justifyContent: 'center'
        }}
      >
      {/* Main Pill Container */}
      <motion.div
        animate={{
          width: notification ? 'auto' : (selectedProperty || uploadedFile ? 'auto' : 'fit-content'),
          minWidth: notification ? 'auto' : (selectedProperty || uploadedFile ? 'auto' : '400px')
        }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
        style={{
          background: 'rgba(255, 255, 255, 0.35)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.05)',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          maxWidth: '90%',
          border: isDragOver ? '2px dashed #3b82f6' : '1px solid rgba(255, 255, 255, 0.25)',
          transition: 'all 0.2s ease'
        }}
      >
        {/* Notification - appears alone in the bar when present */}
        <AnimatePresence>
          {notification ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '5px 10px',
                borderRadius: '8px',
                backgroundColor: notification.type === 'success' ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${notification.type === 'success' ? '#86efac' : '#fca5a5'}`,
                flexShrink: 0
              }}
            >
              {notification.type === 'success' ? (
                <>
                  <div style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    border: '2px solid #22c55e',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    backgroundColor: '#22c55e'
                  }}>
                    <Check className="w-3.5 h-3.5" style={{ color: 'white', strokeWidth: 2.5 }} />
                  </div>
                  <span style={{
                    color: '#22c55e',
                    fontSize: '11px',
                    fontWeight: 600,
                    lineHeight: '14px'
                  }}>
                    Document Linked
                  </span>
                </>
              ) : (
                <>
                  <div style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    border: '2px solid #ef4444',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    backgroundColor: '#ef4444'
                  }}>
                    <X className="w-3.5 h-3.5" style={{ color: 'white', strokeWidth: 2.5 }} />
                  </div>
                  <span style={{
                    color: '#ef4444',
                    fontSize: '11px',
                    fontWeight: 600,
                    lineHeight: '14px'
                  }}>
                    Failed
                  </span>
                </>
              )}
            </motion.div>
          ) : (
            <>
              {/* Property Selection Area */}
              {selectedProperty ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="relative bg-white border border-gray-200 shadow-sm cursor-pointer hover:border-gray-300 hover:shadow-md transition-all duration-100 flex-shrink-0"
                  style={{ 
                    width: 'auto',
                    height: 'auto',
                    borderRadius: '8px',
                    padding: '5px 10px'
                  }}
                >
                  <div className="flex items-center gap-2" style={{ width: 'auto', flexShrink: 0 }}>
                    {/* Property Icon */}
                    <div className="bg-green-500 rounded flex items-center justify-center flex-shrink-0" style={{ width: '22px', height: '22px' }}>
                      <Home className="text-white" style={{ width: '14px', height: '14px' }} strokeWidth={2} />
                    </div>
                    
                    {/* Property Info */}
                    <div className="flex flex-col" style={{ width: 'auto', flexShrink: 0 }}>
                      <span className="font-medium text-black truncate" style={{ whiteSpace: 'nowrap', fontSize: '11px', lineHeight: '14px' }}>
                        {selectedProperty.custom_name || formatAddress(selectedProperty.address)}
                      </span>
                      <span className="text-gray-500 font-normal" style={{ fontSize: '9px', lineHeight: '12px' }}>
                        {selectedProperty.property_type || 'Property'}
                      </span>
                    </div>
                    
                    {/* Remove Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePropertyRemove();
                      }}
                      className="rounded-full bg-black flex items-center justify-center flex-shrink-0 hover:bg-gray-800 transition-colors ml-2"
                      style={{ width: '16px', height: '16px' }}
                      title="Remove property"
                    >
                      <X className="text-white" style={{ width: '11px', height: '11px' }} strokeWidth={2.5} />
                    </button>
                  </div>
                </motion.div>
              ) : (
                <div className="relative flex-1" style={{ minWidth: '200px', maxWidth: '400px', position: 'relative' }}>
                  <div className="relative" style={{ position: 'relative' }}>
                    <SendToBack className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" style={{ zIndex: 1 }} />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onFocus={() => {
                        if (searchResults.length > 0) {
                          setShowResultsPopup(true);
                        }
                      }}
                      placeholder="Find property to link documents"
                      className="quick-start-search-input"
                      style={{
                        width: '100%',
                        padding: '6px 12px 6px 42px',
                        border: '1px solid rgba(0, 0, 0, 0.1)',
                        borderRadius: '6px',
                        fontSize: '14px',
                        outline: 'none',
                        transition: 'border-color 0.2s',
                        position: 'relative',
                        zIndex: 1,
                        background: 'transparent',
                        color: '#1F2937'
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setShowResultsPopup(false);
                        }
                      }}
                      onBlur={(e) => {
                        // Don't close popup immediately on blur - wait a bit to allow clicks on popup items
                        setTimeout(() => {
                          // Check if the related target (what's being focused) is not inside the popup
                          if (resultsPopupRef.current && !resultsPopupRef.current.contains(document.activeElement)) {
                            setShowResultsPopup(false);
                          }
                        }, 200);
                      }}
                    />
                  </div>

                  {/* Search Results Popup - positioned ABOVE the search bar */}
                  <AnimatePresence mode="wait">
                    {showResultsPopup && searchResults.length > 0 && (
                      <motion.div
                        ref={resultsPopupRef}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ duration: 0.2 }}
                        style={{
                          position: 'absolute',
                          bottom: 'calc(100% + 16px)',
                          left: 0,
                          right: 0,
                          background: 'rgba(255, 255, 255, 0.35)',
                          backdropFilter: 'blur(40px)',
                          WebkitBackdropFilter: 'blur(40px)',
                          borderRadius: '6px',
                          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.25)',
                          maxHeight: '240px',
                          overflowY: 'auto',
                          zIndex: 10000,
                          marginBottom: '0',
                          width: '100%',
                          minWidth: '200px'
                        }}
                      >
                        {searchResults.map((property) => (
                          <div
                            key={property.id}
                            onClick={() => handlePropertySelect(property)}
                            style={{
                              padding: '8px 14px',
                              cursor: 'pointer',
                              borderBottom: '1px solid rgba(0, 0, 0, 0.05)',
                              backgroundColor: selectedProperty?.id === property.id ? 'rgba(243, 244, 246, 0.6)' : 'transparent',
                              transition: 'background-color 0.15s',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px'
                            }}
                            onMouseEnter={(e) => {
                              if (selectedProperty?.id !== property.id) {
                                e.currentTarget.style.backgroundColor = 'rgba(249, 250, 251, 0.6)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (selectedProperty?.id !== property.id) {
                                e.currentTarget.style.backgroundColor = 'transparent';
                              }
                            }}
                          >
                            {/* Property Image Thumbnail */}
                            <PropertyImageThumbnail property={property} />
                            
                            {/* Property Info */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ 
                                fontWeight: 500, 
                                fontSize: '14px', 
                                color: '#111827', 
                                marginBottom: '2px',
                                lineHeight: '1.4',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}>
                                {property.custom_name || property.address}
                              </div>
                              {property.property_type && (
                                <div style={{ 
                                  fontSize: '11px', 
                                  color: '#6b7280',
                                  lineHeight: '1.3',
                                  fontWeight: 300
                                }}>
                                  {property.property_type}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Separator - only show if property or file is selected and no notification */}
              {(selectedProperty || uploadedFile) && !notification && (
                <div style={{ width: '1px', height: '24px', background: 'rgba(0, 0, 0, 0.1)' }} />
              )}

              {/* Document Selection Area */}
              {uploadedFile && !notification ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="relative bg-white border border-gray-200 shadow-sm cursor-pointer hover:border-gray-300 hover:shadow-md transition-all duration-100 flex-shrink-0"
                  style={{ 
                    width: 'auto',
                    height: 'auto',
                    borderRadius: '8px',
                    padding: '5px 10px'
                  }}
                >
                  <div className="flex items-center gap-2" style={{ width: 'auto', flexShrink: 0 }}>
                    {/* File Icon or Image Preview */}
                    {isImage && imagePreviewUrl ? (
                      <div className="rounded overflow-hidden flex-shrink-0 border border-gray-200" style={{ 
                        width: '22px',
                        height: '22px',
                        minWidth: '22px',
                        minHeight: '22px'
                      }}>
                        <img
                          src={imagePreviewUrl}
                          alt={uploadedFile.name}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            display: 'block'
                          }}
                        />
                      </div>
                    ) : (
                      <div className={`rounded flex items-center justify-center flex-shrink-0`} style={{
                        width: '22px',
                        height: '22px',
                        backgroundColor: isPDF ? '#ef4444' : isDOCX ? '#3b82f6' : '#6b7280'
                      }}>
                        <FileText className="text-white" style={{ width: '14px', height: '14px' }} strokeWidth={2} />
                      </div>
                    )}
                    
                    {/* File Info */}
                    <div className="flex flex-col" style={{ width: 'auto', flexShrink: 0 }}>
                      <span className="font-medium text-black truncate" style={{ whiteSpace: 'nowrap', fontSize: '11px', lineHeight: '14px' }}>
                        {formatFileName(uploadedFile.name)}
                      </span>
                      <span className="text-gray-500 font-normal" style={{ fontSize: '9px', lineHeight: '12px' }}>
                        {getFileTypeLabel(uploadedFile.type)}
                      </span>
                    </div>
                    
                    {/* Remove Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setUploadedFile(null);
                      }}
                      className="rounded-full bg-black flex items-center justify-center flex-shrink-0 hover:bg-gray-800 transition-colors ml-2"
                      style={{ width: '16px', height: '16px' }}
                      title="Remove file"
                    >
                      <X className="text-white" style={{ width: '11px', height: '11px' }} strokeWidth={2.5} />
                    </button>
                  </div>
                </motion.div>
              ) : !notification ? (
                <>
                  {/* Icons Group */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* Upload Button */}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '32px',
                        height: '32px',
                        border: '1px solid rgba(0, 0, 0, 0.1)',
                        borderRadius: '6px',
                        background: 'transparent',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        color: '#374151'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#f3f4f6';
                        e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.2)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.1)';
                      }}
                      title="Upload document"
                    >
                      <Upload className="w-4 h-4" />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx,.doc,image/*"
                      onChange={handleFileInputChange}
                      style={{ display: 'none' }}
                    />
                  </div>
                </>
              ) : null}

              {/* Save Button */}
              {(selectedProperty || uploadedFile) && !notification && (
                <>
                  <div style={{ width: '1px', height: '24px', background: 'rgba(0, 0, 0, 0.1)' }} />
            <button
              onClick={handleSave}
              disabled={isUploading || !selectedProperty || !uploadedFile}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 10px',
                border: '1px solid rgba(0, 0, 0, 0.1)',
                borderRadius: '6px',
                background: (isUploading || !selectedProperty || !uploadedFile) ? '#f3f4f6' : '#F5C085',
                cursor: (isUploading || !selectedProperty || !uploadedFile) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                color: (isUploading || !selectedProperty || !uploadedFile) ? '#9ca3af' : '#111827',
                fontSize: '12px',
                fontWeight: 500
              }}
              onMouseEnter={(e) => {
                if (!isUploading && selectedProperty && uploadedFile) {
                  e.currentTarget.style.backgroundColor = '#F1B367';
                  e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.2)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isUploading && selectedProperty && uploadedFile) {
                  e.currentTarget.style.backgroundColor = '#F5C085';
                  e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.1)';
                }
              }}
            >
              {isUploading ? (
                <>
                  <div className="animate-spin rounded-full h-3 w-3 border-2 border-gray-400 border-t-transparent" />
                  <span>Uploading...</span>
                </>
              ) : (
                <>
                  <span>Link Document</span>
                  <GitPullRequestArrow className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </>
        )}
            </>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
    </>
  );
};

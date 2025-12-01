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
  isInChatPanel?: boolean; // Whether this is being used in the chat panel (for space-saving adjustments)
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
  className,
  isInChatPanel = false
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
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mainContainerRef = React.useRef<HTMLDivElement>(null);
  
  // Dynamic truncation lengths based on available space
  const [maxAddressLength, setMaxAddressLength] = React.useState<number>(isInChatPanel ? 8 : 30);
  const [maxFileNameLength, setMaxFileNameLength] = React.useState<number>(isInChatPanel ? 8 : 30);

  // Real-time property search (very short debounce for responsiveness)
  React.useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Only search if no property is selected and query is at least 1 character
    if (!selectedProperty && searchQuery.trim().length >= 1) {
      // Instant search for first character, minimal debounce for subsequent characters
      const debounceTime = searchQuery.trim().length === 1 ? 0 : 50;
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
      }, debounceTime); // Instant for first character, minimal debounce for subsequent
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

  // Measure container and adjust truncation lengths dynamically
  const prevLengthsRef = React.useRef({ address: 0, fileName: 0 });
  const resizeTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  
  React.useLayoutEffect(() => {
    if (!isInChatPanel || !containerRef.current || !mainContainerRef.current) {
      // Reset to defaults if not in chat panel or refs not available
      setMaxAddressLength(isInChatPanel ? 8 : 30);
      setMaxFileNameLength(isInChatPanel ? 8 : 30);
      return;
    }

    const updateTruncationLengths = () => {
      // Get the parent container width (the one with width constraint from SideChatPanel)
      const parentElement = containerRef.current?.parentElement;
      const parentWidth = parentElement?.clientWidth || 0;
      
      // Only proceed if parent has a valid width
      if (!parentWidth || parentWidth === 0) {
        return;
      }
      
      // Get current content width
      const currentWidth = mainContainerRef.current?.scrollWidth || mainContainerRef.current?.clientWidth || 0;
      
      // Calculate available space (parent width minus current content width)
      // Add some padding to account for gaps and separators
      const padding = 40; // Account for gaps, separators, and button
      const availableSpace = parentWidth - currentWidth - padding;
      
      // Base lengths (minimum - very short)
      const baseAddressLength = 5;
      const baseFileNameLength = 5;
      
      // Maximum lengths (when there's plenty of space)
      const maxAddressLengthLimit = 30;
      const maxFileNameLengthLimit = 30;
      
      // Calculate new lengths
      let newAddressLength: number;
      let newFileNameLength: number;
      
      if (availableSpace > 200) {
        // Plenty of space - use longer names
        newAddressLength = maxAddressLengthLimit;
        newFileNameLength = maxFileNameLengthLimit;
      } else if (availableSpace > 100) {
        // Moderate space - use medium names
        const scale = (availableSpace - 100) / 100; // 0 to 1
        newAddressLength = Math.round(baseAddressLength + (maxAddressLengthLimit - baseAddressLength) * scale);
        newFileNameLength = Math.round(baseFileNameLength + (maxFileNameLengthLimit - baseFileNameLength) * scale);
      } else if (availableSpace > 30) {
        // Limited space - use short names
        const scale = (availableSpace - 30) / 70; // 0 to 1
        newAddressLength = Math.round(baseAddressLength + 8 * scale);
        newFileNameLength = Math.round(baseFileNameLength + 8 * scale);
      } else {
        // Very limited space - use minimum names
        newAddressLength = baseAddressLength;
        newFileNameLength = baseFileNameLength;
      }
      
      // Only update state if values actually changed to prevent infinite loops
      if (newAddressLength !== prevLengthsRef.current.address || 
          newFileNameLength !== prevLengthsRef.current.fileName) {
        prevLengthsRef.current.address = newAddressLength;
        prevLengthsRef.current.fileName = newFileNameLength;
        setMaxAddressLength(newAddressLength);
        setMaxFileNameLength(newFileNameLength);
      }
    };

    // Clear any pending timeouts
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }

    // Initial measurement with a delay to ensure DOM is ready
    resizeTimeoutRef.current = setTimeout(updateTruncationLengths, 50);

    // Use ResizeObserver to watch ONLY the parent element (not the container itself to avoid feedback loop)
    const resizeObserver = new ResizeObserver((entries) => {
      // Clear any pending updates
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      
      // Debounce resize updates to prevent spam
      resizeTimeoutRef.current = setTimeout(() => {
        updateTruncationLengths();
      }, 150); // Increased debounce time
    });

    // Only observe the parent element, NOT the container itself
    if (containerRef.current.parentElement) {
      resizeObserver.observe(containerRef.current.parentElement);
    }

    return () => {
      resizeObserver.disconnect();
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, [isInChatPanel, selectedProperty, uploadedFile, notification]);

  // Format address for display (dynamic length based on available space)
  const formatAddress = (address: string): string => {
    const parts = address.split(',');
    const shortAddress = parts[0] || address;
    if (shortAddress.length > maxAddressLength) {
      const truncatedLength = Math.max(3, maxAddressLength - 3); // Leave room for "..."
      return shortAddress.substring(0, truncatedLength) + '...';
    }
    return shortAddress;
  };

  // Format file name (dynamic length based on available space)
  const formatFileName = (name: string): string => {
    if (name.length > maxFileNameLength) {
      const extension = name.split('.').pop();
      const nameWithoutExt = name.substring(0, name.lastIndexOf('.'));
      const truncatedLength = Math.max(3, maxFileNameLength - (extension ? extension.length + 4 : 3)); // Leave room for "...ext"
      return `${nameWithoutExt.substring(0, truncatedLength)}...${extension ? '.' + extension : ''}`;
    }
    return name;
  };
  
  // Format custom name (dynamic length based on available space)
  const formatCustomName = (name: string): string => {
    if (name.length > maxAddressLength) {
      const truncatedLength = Math.max(3, maxAddressLength - 3);
      return name.substring(0, truncatedLength) + '...';
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
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
      <div
        ref={containerRef}
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
          justifyContent: isInChatPanel ? 'flex-end' : 'center',
          // Only apply transform when nothing is selected (search bar state)
          // When items are selected, the wrapper transform in SideChatPanel handles positioning
          transform: (isInChatPanel && !selectedProperty && !uploadedFile && !notification) 
            ? 'translateX(18%)' 
            : 'none'
        }}
      >
      {/* Main Pill Container - only show background when something is selected */}
      <div
        ref={mainContainerRef}
        style={{
          background: (selectedProperty || uploadedFile || notification) ? 'white' : 'transparent',
          borderRadius: (selectedProperty || uploadedFile || notification) ? '12px' : '0',
          boxShadow: (selectedProperty || uploadedFile || notification) ? '0 8px 32px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.05)' : 'none',
          padding: (selectedProperty || uploadedFile || notification) ? '8px 6px' : '0',
          display: 'inline-flex',
          alignItems: 'center',
          gap: (selectedProperty || uploadedFile || notification) ? (isInChatPanel ? '8px' : '10px') : '8px',
          maxWidth: (selectedProperty || uploadedFile || notification) 
            ? (isInChatPanel ? '100%' : 'none') 
            : '90%',
          width: 'fit-content',
          minWidth: (selectedProperty || uploadedFile || notification) 
            ? '0' 
            : '400px',
          border: (selectedProperty || uploadedFile || notification) 
            ? (isDragOver ? '2px dashed #3b82f6' : '1px solid rgba(0, 0, 0, 0.1)')
            : 'none',
          transition: 'none',
          position: 'relative',
          overflow: (selectedProperty || uploadedFile || notification) && !showResultsPopup ? 'hidden' : 'visible',
          flexWrap: 'nowrap', // Always keep on one line
          boxSizing: 'border-box'
        }}
      >
        {/* Notification - appears alone in the bar when present */}
        {notification ? (
          <div
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
            </div>
          ) : (
            <>
              {/* Property Selection Area */}
              {selectedProperty ? (
                <div
                  className="relative bg-white border border-gray-200 shadow-sm cursor-pointer hover:border-gray-300 hover:shadow-md"
                  style={{ 
                    width: 'fit-content',
                    height: 'auto',
                    borderRadius: '8px',
                    padding: isInChatPanel ? '5px 8px' : '5px 10px', // Less padding in chat panel
                    flexShrink: 0,
                    minWidth: 'auto',
                    maxWidth: isInChatPanel ? '90%' : 'none', // Limit width in chat panel
                    overflow: 'visible',
                    transition: 'none'
                  }}
                >
                  <div className="flex items-center gap-2" style={{ width: '100%', minWidth: 0 }}>
                    {/* Property Icon */}
                    <div className="bg-green-500 rounded flex items-center justify-center flex-shrink-0" style={{ width: isInChatPanel ? '18px' : '22px', height: isInChatPanel ? '18px' : '22px' }}>
                      <Home className="text-white" style={{ width: isInChatPanel ? '12px' : '14px', height: isInChatPanel ? '12px' : '14px' }} strokeWidth={2} />
                    </div>
                    
                    {/* Property Info */}
                    <div className="flex flex-col" style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
                      <span className="font-medium text-black truncate" style={{ whiteSpace: 'nowrap', fontSize: '11px', lineHeight: '14px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {selectedProperty.custom_name 
                          ? formatCustomName(selectedProperty.custom_name)
                          : formatAddress(selectedProperty.address)}
                      </span>
                      <span className="text-gray-500 font-normal truncate" style={{ fontSize: '9px', lineHeight: '12px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                      className="rounded-full bg-black flex items-center justify-center flex-shrink-0 hover:bg-gray-800 transition-colors"
                      style={{ width: '16px', height: '16px', marginLeft: '8px', flexShrink: 0 }}
                      title="Remove property"
                    >
                      <X className="text-white" style={{ width: '11px', height: '11px' }} strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="relative flex-1" style={{ 
                  minWidth: isInChatPanel ? '120px' : '200px', 
                  maxWidth: isInChatPanel ? '250px' : '400px', 
                  position: 'relative', 
                  overflow: 'visible' 
                }}>
                  <div className="relative" style={{ position: 'relative', width: '100%', overflow: 'visible' }}>
                    <SendToBack className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" style={{ zIndex: 1 }} />
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
                        padding: isInChatPanel ? '6px 10px 6px 10px' : '6px 12px 6px 12px',
                        border: '1px solid rgba(0, 0, 0, 0.1)',
                        borderRadius: '6px',
                        fontSize: isInChatPanel ? '13px' : '14px',
                        outline: 'none',
                        transition: 'border-color 0.2s',
                        position: 'relative',
                        zIndex: 1,
                        background: 'white',
                        color: '#1F2937',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
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
                    
                    {/* Search Results Popup - positioned ABOVE the input field, centered horizontally */}
                    {showResultsPopup && searchResults.length > 0 && (
                      <div
                        ref={resultsPopupRef}
                        style={{
                            position: 'absolute',
                            bottom: 'calc(100% + 8px)',
                            left: 0,
                            right: 0,
                            background: 'white',
                            borderRadius: '8px',
                            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.08)',
                            maxHeight: '280px',
                            overflowY: 'auto',
                            zIndex: 10000,
                            width: '100%'
                          }}
                        >
                          {searchResults.map((property, index) => (
                            <div
                              key={property.id}
                              onClick={() => handlePropertySelect(property)}
                              style={{
                                padding: '10px 14px',
                                cursor: 'pointer',
                                borderBottom: index < searchResults.length - 1 ? '1px solid rgba(0, 0, 0, 0.06)' : 'none',
                                backgroundColor: selectedProperty?.id === property.id ? '#f0f9ff' : 'transparent',
                                transition: 'background-color 0.1s ease',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px'
                              }}
                              onMouseEnter={(e) => {
                                if (selectedProperty?.id !== property.id) {
                                  e.currentTarget.style.backgroundColor = '#f9fafb';
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
                                  marginBottom: '3px',
                                  lineHeight: '1.4',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}>
                                  {property.custom_name || property.address}
                                </div>
                                {property.property_type && (
                                  <div style={{ 
                                    fontSize: '12px', 
                                    color: '#6b7280',
                                    lineHeight: '1.4',
                                    fontWeight: 400
                                  }}>
                                    {property.property_type}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Separator - only show if property is selected AND file is not selected (to separate from upload button) */}
              {selectedProperty && !uploadedFile && !notification && (
                <div style={{ width: '1px', height: '24px', background: 'rgba(0, 0, 0, 0.1)', flexShrink: 0 }} />
              )}

              {/* Document Selection Area */}
              {uploadedFile && !notification ? (
                <div
                  className="relative bg-white border border-gray-200 shadow-sm cursor-pointer hover:border-gray-300 hover:shadow-md"
                  style={{ 
                    width: 'fit-content',
                    height: 'auto',
                    borderRadius: '8px',
                    padding: isInChatPanel ? '5px 8px' : '5px 10px', // Less padding in chat panel
                    flexShrink: 0,
                    minWidth: 'auto',
                    maxWidth: isInChatPanel ? '40%' : 'none', // Limit width in chat panel
                    overflow: 'visible',
                    transition: 'none'
                  }}
                >
                  <div className="flex items-center gap-2" style={{ width: '100%', minWidth: 0 }}>
                    {/* File Icon or Image Preview */}
                    {isImage && imagePreviewUrl ? (
                      <div className="rounded overflow-hidden flex-shrink-0 border border-gray-200" style={{ 
                        width: isInChatPanel ? '18px' : '22px',
                        height: isInChatPanel ? '18px' : '22px',
                        minWidth: isInChatPanel ? '18px' : '22px',
                        minHeight: isInChatPanel ? '18px' : '22px'
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
                        width: isInChatPanel ? '18px' : '22px',
                        height: isInChatPanel ? '18px' : '22px',
                        backgroundColor: isPDF ? '#ef4444' : isDOCX ? '#3b82f6' : '#6b7280'
                      }}>
                        <FileText className="text-white" style={{ width: isInChatPanel ? '12px' : '14px', height: isInChatPanel ? '12px' : '14px' }} strokeWidth={2} />
                      </div>
                    )}
                    
                    {/* File Info */}
                    <div className="flex flex-col" style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
                      <span className="font-medium text-black truncate" style={{ whiteSpace: 'nowrap', fontSize: '11px', lineHeight: '14px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {formatFileName(uploadedFile.name)}
                      </span>
                      <span className="text-gray-500 font-normal truncate" style={{ fontSize: '9px', lineHeight: '12px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                      className="rounded-full bg-black flex items-center justify-center flex-shrink-0 hover:bg-gray-800 transition-colors"
                      style={{ width: '16px', height: '16px', marginLeft: '8px', flexShrink: 0 }}
                      title="Remove file"
                    >
                      <X className="text-white" style={{ width: '11px', height: '11px' }} strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
              ) : !notification ? (
                <>
                  {/* Icons Group */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: isInChatPanel ? '6px' : '8px' }}>
                    {/* Upload Button */}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: isInChatPanel ? '28px' : '32px',
                        height: isInChatPanel ? '28px' : '32px',
                        border: '1px solid rgba(0, 0, 0, 0.1)',
                        borderRadius: '6px',
                        background: 'white',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        color: '#374151',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#f3f4f6';
                        e.currentTarget.style.borderColor = 'rgba(0, 0, 0, 0.2)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'white';
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

              {/* Save Button - show when property is selected (disabled if no file) */}
              {selectedProperty && !notification && (
                <>
                  <div style={{ width: '1px', height: '24px', background: 'rgba(0, 0, 0, 0.1)', flexShrink: 0 }} />
            <button
              onClick={handleSave}
              disabled={isUploading || !selectedProperty || !uploadedFile}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
                border: '1px solid rgba(0, 0, 0, 0.1)',
                borderRadius: '6px',
                background: (isUploading || !selectedProperty || !uploadedFile) ? '#f3f4f6' : '#F5C085',
                cursor: (isUploading || !selectedProperty || !uploadedFile) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                color: (isUploading || !selectedProperty || !uploadedFile) ? '#9ca3af' : '#111827',
                fontSize: '11px',
                fontWeight: 500,
                flexShrink: 0,
                whiteSpace: 'nowrap'
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
                <div 
                  className="rounded-full h-3 w-3 border-2 border-gray-400 border-t-transparent"
                  style={{
                    animation: 'spin 0.6s linear infinite'
                  }}
                />
              ) : (
                <>
                  {!isInChatPanel && <span style={{ whiteSpace: 'nowrap' }}>Link Document</span>}
                  <GitPullRequestArrow className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </>
        )}
            </>
          )}
      </div>
    </div>
    </>
  );
};

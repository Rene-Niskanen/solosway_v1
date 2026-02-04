"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SendToBack, Upload, GitPullRequestArrow, X, Home, FileText, Check, Plus } from "lucide-react";
import { backendApi } from "@/services/backendApi";

interface PropertyData {
  id: string | number;
  address: string;
  property_type?: string;
  custom_name?: string;
  image?: string;
  primary_image_url?: string;
  property_images?: Array<{ url: string; [key: string]: any }>;
  property_details?: {
    primary_image_url?: string;
    property_images?: Array<{ url: string; [key: string]: any }>;
    [key: string]: any;
  };
  [key: string]: any;
}

interface QuickStartBarProps {
  onDocumentLinked?: (propertyId: string, documentId: string) => void;
  onPopupVisibilityChange?: (isVisible: boolean) => void;
  className?: string;
  isInChatPanel?: boolean; // Whether this is being used in the chat panel (for space-saving adjustments)
  chatInputRef?: React.RefObject<HTMLElement | null>; // Reference to chat input (textarea, input, or contenteditable div) to detect focus
}

// Property Image Thumbnail Component
const PropertyImageThumbnail: React.FC<{ property: PropertyData }> = ({ property }) => {
  const [imageError, setImageError] = React.useState(false);
  // Check multiple possible locations for the image URL
  const imageUrl = property.image || 
                   property.primary_image_url || 
                   (property.property_images && property.property_images.length > 0 ? property.property_images[0].url : null) ||
                   (property as any).property_details?.primary_image_url ||
                   ((property as any).property_details?.property_images && (property as any).property_details.property_images.length > 0 
                     ? (property as any).property_details.property_images[0].url : null);

  return (
    <div style={{
      width: '32px',
      height: '32px',
      borderRadius: '8px',
      overflow: 'hidden',
      backgroundColor: '#F3F4F6',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      border: '1px solid rgba(229, 231, 235, 0.5)'
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
          background: 'linear-gradient(135deg, #E5E7EB 0%, #D1D5DB 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <Home className="w-4 h-4" style={{ color: '#6B7280' }} strokeWidth={2} />
        </div>
      )}
    </div>
  );
};

export const QuickStartBar: React.FC<QuickStartBarProps> = ({
  onDocumentLinked,
  onPopupVisibilityChange,
  className,
  isInChatPanel = false,
  chatInputRef
}) => {
  const [searchQuery, setSearchQuery] = React.useState<string>("");
  const [searchResults, setSearchResults] = React.useState<PropertyData[]>([]);
  const [selectedProperty, setSelectedProperty] = React.useState<PropertyData | null>(null);
  const [uploadedFiles, setUploadedFiles] = React.useState<File[]>([]);
  const [isUploading, setIsUploading] = React.useState<boolean>(false);
  const [showResultsPopup, setShowResultsPopup] = React.useState<boolean>(false);
  const [isDragOver, setIsDragOver] = React.useState<boolean>(false);
  const [imagePreviewUrls, setImagePreviewUrls] = React.useState<Map<string, string>>(new Map());
  const [notification, setNotification] = React.useState<{ type: 'success' } | null>(null);
  const [showFilesDropdown, setShowFilesDropdown] = React.useState<boolean>(false);
  const [isSearchInputFocused, setIsSearchInputFocused] = React.useState<boolean>(false);
  
  // Reset search state when component unmounts or becomes hidden (to prevent stale searches)
  // This ensures that when QuickStartBar is closed, we don't have lingering search state
  React.useEffect(() => {
    return () => {
      // Cleanup: reset search state when component unmounts
      setSearchQuery("");
      setSearchResults([]);
      setShowResultsPopup(false);
      setIsSearchInputFocused(false);
    };
  }, []);

  // Notify parent when popup visibility changes
  React.useEffect(() => {
    onPopupVisibilityChange?.(showResultsPopup);
  }, [showResultsPopup, onPopupVisibilityChange]);

  // Close popup when search input loses focus (user clicks away or starts typing elsewhere)
  React.useEffect(() => {
    if (!isSearchInputFocused && showResultsPopup) {
      // Small delay to allow click events on popup items to register
      const timer = setTimeout(() => {
        if (!isSearchInputFocused) {
          setShowResultsPopup(false);
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isSearchInputFocused, showResultsPopup]);

  // Close popup when chat input is focused or when user starts typing in chat
  React.useEffect(() => {
    if (!chatInputRef?.current || !isInChatPanel) return;

    const chatInput = chatInputRef.current;
    
    const handleChatFocus = () => {
      // Close popup immediately when chat input is focused
      if (showResultsPopup) {
        setShowResultsPopup(false);
      }
    };

    const handleChatInput = () => {
      // Close popup when user types in chat input
      if (showResultsPopup && document.activeElement === chatInput) {
        setShowResultsPopup(false);
      }
    };

    chatInput.addEventListener('focus', handleChatFocus);
    chatInput.addEventListener('input', handleChatInput);
    chatInput.addEventListener('keydown', handleChatInput);

    return () => {
      chatInput.removeEventListener('focus', handleChatFocus);
      chatInput.removeEventListener('input', handleChatInput);
      chatInput.removeEventListener('keydown', handleChatInput);
    };
  }, [chatInputRef, isInChatPanel, showResultsPopup]);
  
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const resultsPopupRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const debounceTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mainContainerRef = React.useRef<HTMLDivElement>(null);
  const filesDropdownRef = React.useRef<HTMLDivElement>(null);
  
  // Dynamic truncation lengths based on available space
  const [maxAddressLength, setMaxAddressLength] = React.useState<number>(isInChatPanel ? 8 : 30);
  const [maxFileNameLength, setMaxFileNameLength] = React.useState<number>(isInChatPanel ? 8 : 30);

  // Real-time property search (very short debounce for responsiveness)
  // Only search when the search input is actually focused to prevent triggering from chat input
  React.useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Only search if:
    // 1. No property is selected
    // 2. Query is at least 1 character
    // 3. The search input is actually focused (user is typing in QuickStartBar, not chat)
    if (!selectedProperty && searchQuery.trim().length >= 1 && isSearchInputFocused) {
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
                
                // Extract image URL from multiple possible locations
                const primaryImageUrl = propertyDetails.primary_image_url || 
                                      property.primary_image_url || 
                                      property.image ||
                                      (propertyDetails.property_images && propertyDetails.property_images.length > 0 
                                        ? propertyDetails.property_images[0].url : null) ||
                                      (property.property_images && property.property_images.length > 0 
                                        ? property.property_images[0].url : null);
                
                return {
                  id: property.id || hub.id,
                  address: property.formatted_address || property.normalized_address || property.address || 'Unknown Address',
                  property_type: propertyDetails.property_type || property.property_type,
                  custom_name: property.custom_name,
                  image: primaryImageUrl,
                  primary_image_url: primaryImageUrl,
                  property_images: propertyDetails.property_images || property.property_images || [],
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
  }, [searchQuery, selectedProperty, isSearchInputFocused]);

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
      
      // Close files dropdown when clicking outside
      // Don't close if clicking on the file input or its trigger
      const target = event.target as HTMLElement;
      if (
        filesDropdownRef.current &&
        !filesDropdownRef.current.contains(target as Node) &&
        !target?.closest('[data-files-dropdown-trigger]') &&
        !target?.closest('[data-add-files-button]') &&
        fileInputRef.current &&
        target !== fileInputRef.current &&
        !fileInputRef.current.contains(target as Node)
      ) {
        setShowFilesDropdown(false);
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
    setIsSearchInputFocused(false);
  };

  // Handle property removal
  const handlePropertyRemove = () => {
    setSelectedProperty(null);
    setSearchQuery("");
  };

  // Handle file selection (adds to array)
  const handleFileSelect = (file: File) => {
    // Validate file type
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.some(type => file.type === type || file.name.toLowerCase().endsWith('.pdf') || file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.doc'))) {
      window.dispatchEvent(new CustomEvent('upload-error', { 
        detail: { fileName: file.name, error: 'Invalid file type. Please upload PDF, DOC, DOCX, or image files.' } 
      }));
      return;
    }

    // Validate file size (16MB max)
    const maxSize = 16 * 1024 * 1024; // 16MB
    if (file.size > maxSize) {
      window.dispatchEvent(new CustomEvent('upload-error', { 
        detail: { fileName: file.name, error: 'File size exceeds 16MB limit.' } 
      }));
      return;
    }

    // Check if file already exists (by name)
    setUploadedFiles(prev => {
      if (prev.some(f => f.name === file.name && f.size === file.size)) {
        return prev; // File already exists
      }
      return [...prev, file];
    });
  };

  // Handle file input change (multiple files)
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      handleFileSelect(file);
    });
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

    const files = Array.from(e.dataTransfer.files || []);
    files.forEach(file => {
      handleFileSelect(file);
    });
  };

  // Handle save/upload and link (multiple files)
  const handleSave = async () => {
    if (!selectedProperty) {
      window.dispatchEvent(new CustomEvent('upload-error', { 
        detail: { fileName: '', error: 'Please select a property before uploading.' } 
      }));
      return;
    }

    if (uploadedFiles.length === 0) {
      window.dispatchEvent(new CustomEvent('upload-error', { 
        detail: { fileName: '', error: 'Please select at least one file to upload.' } 
      }));
      return;
    }

    setIsUploading(true);

    try {
      // Get property ID - ensure it's a string
      const propertyId = typeof selectedProperty.id === 'number' 
        ? selectedProperty.id.toString() 
        : selectedProperty.id;
      
      // Upload all files
      const uploadPromises = uploadedFiles.map(file => 
        backendApi.uploadPropertyDocumentViaProxy(
          file,
          {
            property_id: propertyId,
            property_address: selectedProperty.address,
            property_latitude: selectedProperty.latitude,
            property_longitude: selectedProperty.longitude
          }
        )
      );

      const uploadResponses = await Promise.all(uploadPromises);
      
      // Check if all uploads succeeded
      const failedUploads = uploadResponses.filter(response => !response.success);
      if (failedUploads.length > 0) {
        // Dispatch error events for each failed upload
        failedUploads.forEach((failedResponse, index) => {
          const file = uploadedFiles[index];
          const errorMessage = failedResponse.error || 'Upload failed';
          window.dispatchEvent(new CustomEvent('upload-error', { 
            detail: { fileName: file.name, error: errorMessage } 
          }));
        });
        throw new Error(failedUploads[0].error || 'One or more uploads failed');
      }

      // Get document IDs from responses
      const documentIds = uploadResponses.map(response => {
        const documentId = response.data?.document_id || 
                          response.data?.id || 
                          (response.data?.data as any)?.document_id ||
                          (response as any).document_id;
        return documentId;
      }).filter(Boolean);

      if (documentIds.length === 0) {
        throw new Error('No document IDs found in responses');
      }

      // Success! Documents are already linked by backend
      setNotification({ type: 'success' });
      // Auto-hide after 2 seconds
      setTimeout(() => setNotification(null), 2000);

      // Callback for each document
      if (onDocumentLinked) {
        documentIds.forEach(documentId => {
          onDocumentLinked(propertyId, documentId);
        });
      }

      // Reset form
      setSelectedProperty(null);
      setUploadedFiles([]);
      setSearchQuery("");
      setSearchResults([]);

    } catch (error) {
      console.error('Error uploading and linking documents:', error);
      // Try to get more detailed error message from response
      let errorMessage = 'Failed to upload and link documents.';
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
      // Dispatch error event for each file that failed
      uploadedFiles.forEach(file => {
        window.dispatchEvent(new CustomEvent('upload-error', { 
          detail: { fileName: file.name, error: errorMessage } 
        }));
      });
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
  }, [isInChatPanel, selectedProperty, uploadedFiles, notification]);

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

  // Helper functions to check file types
  const isPDF = (file: File) => file.type === 'application/pdf';
  const isDOCX = (file: File) => file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                 file.type === 'application/msword' ||
                 (file.name && (file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.doc')));
  const isImage = (file: File) => file.type.startsWith('image/');

  // Create and cleanup image preview URLs
  React.useEffect(() => {
    const newUrls = new Map<string, string>();
    
    uploadedFiles.forEach(file => {
      if (isImage(file)) {
        const url = URL.createObjectURL(file);
        newUrls.set(file.name, url);
      }
    });
    
    setImagePreviewUrls(newUrls);
    
    return () => {
      // Cleanup old URLs
      newUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [uploadedFiles]);

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
          transform: (isInChatPanel && !selectedProperty && uploadedFiles.length === 0 && !notification) 
            ? 'translateX(18%)' 
            : 'none'
        }}
      >
      {/* Main Pill Container - only show background when something is selected */}
      <div
        ref={mainContainerRef}
        style={{
          background: (selectedProperty || uploadedFiles.length > 0 || notification) ? '#FFFFFF' : 'transparent',
          borderRadius: (selectedProperty || uploadedFiles.length > 0 || notification) ? '12px' : '0',
          boxShadow: (selectedProperty || uploadedFiles.length > 0 || notification) ? '0 2px 8px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)' : 'none',
          padding: (selectedProperty || uploadedFiles.length > 0 || notification) ? '8px 6px' : '0',
          display: 'inline-flex',
          alignItems: 'center',
          gap: (selectedProperty || uploadedFiles.length > 0 || notification) ? (isInChatPanel ? '8px' : '10px') : '8px',
          maxWidth: (selectedProperty || uploadedFiles.length > 0 || notification) 
            ? (isInChatPanel ? '100%' : 'none') 
            : '90%',
          width: 'fit-content',
          minWidth: (selectedProperty || uploadedFiles.length > 0 || notification) 
            ? '0' 
            : '400px',
          border: (selectedProperty || uploadedFiles.length > 0 || notification) 
            ? (isDragOver ? '2px dashed #3b82f6' : '1px solid rgba(229, 231, 235, 0.6)')
            : 'none',
          transition: 'none',
          position: 'relative',
          overflow: (selectedProperty || uploadedFiles.length > 0 || notification) && !showResultsPopup ? 'hidden' : 'visible',
          flexWrap: 'nowrap', // Always keep on one line
          boxSizing: 'border-box'
        }}
      >
        {/* Notification - appears alone in the bar when present (success only) */}
        {notification ? (
          <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '5px 10px',
                borderRadius: '8px',
                backgroundColor: '#f0fdf4',
                border: '1px solid #86efac',
                flexShrink: 0
              }}
            >
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
            </div>
          ) : (
            <>
              {/* Property Selection Area */}
              {selectedProperty ? (
                <div
                  className="relative bg-white cursor-pointer"
                  style={{ 
                    width: 'fit-content',
                    height: '32px',
                    borderRadius: '12px',
                    border: '1px solid rgba(229, 231, 235, 0.6)',
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                    padding: '6px 12px',
                    flexShrink: 0,
                    minWidth: 'auto',
                    maxWidth: isInChatPanel ? '90%' : 'none',
                    overflow: 'visible',
                    transition: 'border-color 0.15s ease',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.8)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.6)';
                  }}
                >
                  <div className="flex items-center" style={{ width: '100%', minWidth: 0, gap: '6px' }}>
                    {/* Property Icon */}
                    <div className="bg-green-500 rounded flex items-center justify-center flex-shrink-0" style={{ width: '20px', height: '20px' }}>
                      <Home className="text-white" style={{ width: '12px', height: '12px' }} strokeWidth={2} />
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
                      className="rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                      style={{ 
                        width: '16px', 
                        height: '16px', 
                        marginLeft: '8px', 
                        flexShrink: 0,
                        background: 'rgba(0, 0, 0, 0.05)',
                        border: '1px solid rgba(0, 0, 0, 0.1)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(0, 0, 0, 0.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(0, 0, 0, 0.05)';
                      }}
                      title="Remove property"
                    >
                      <X className="text-gray-700" style={{ width: '11px', height: '11px' }} strokeWidth={2.5} />
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
                      onFocus={(e) => {
                        setIsSearchInputFocused(true);
                        if (searchResults.length > 0) {
                          setShowResultsPopup(true);
                        }
                        // Enhanced focus state (without blue glow)
                        e.currentTarget.style.borderColor = 'rgba(156, 163, 175, 0.9)';
                        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)';
                      }}
                      onBlur={(e) => {
                        setIsSearchInputFocused(false);
                        e.currentTarget.style.borderColor = 'rgba(209, 213, 219, 0.8)';
                        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05)';
                      }}
                      placeholder="Find property to link documents"
                      className="quick-start-search-input"
                      style={{
                        width: '100%',
                        padding: isInChatPanel ? '6px 10px 6px 10px' : '6px 12px 6px 12px',
                        background: '#FFFFFF',
                        border: '1px solid rgba(209, 213, 219, 0.8)',
                        borderRadius: '12px',
                        fontSize: isInChatPanel ? '13px' : '14px',
                        outline: 'none',
                        transition: 'all 0.15s ease',
                        position: 'relative',
                        zIndex: 1,
                        color: '#1F2937',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05), 0 0 0 0 rgba(59, 130, 246, 0)'
                      }}
                      onMouseEnter={(e) => {
                        if (document.activeElement !== e.currentTarget) {
                          e.currentTarget.style.borderColor = 'rgba(156, 163, 175, 0.9)';
                          e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.08), 0 0 0 0 rgba(59, 130, 246, 0)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        // Keep focus styles if focused; otherwise revert to default state.
                        if (document.activeElement === e.currentTarget) return;
                        e.currentTarget.style.borderColor = 'rgba(209, 213, 219, 0.8)';
                        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05), 0 0 0 0 rgba(59, 130, 246, 0)';
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setShowResultsPopup(false);
                        }
                      }}
                      onBlurCapture={() => {
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
                            background: '#FFFFFF',
                            borderRadius: '12px',
                            border: '1px solid rgba(229, 231, 235, 0.6)',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)',
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
                                padding: '8px 12px',
                                cursor: 'pointer',
                                borderBottom: index < searchResults.length - 1 ? '1px solid rgba(229, 231, 235, 0.3)' : 'none',
                                backgroundColor: selectedProperty?.id === property.id ? '#F0F9FF' : 'transparent',
                                transition: 'background-color 0.15s ease',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px'
                              }}
                              onMouseEnter={(e) => {
                                if (selectedProperty?.id !== property.id) {
                                  e.currentTarget.style.backgroundColor = '#F9FAFB';
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
                                  fontSize: '13px', 
                                  color: '#111827', 
                                  marginBottom: '2px',
                                  lineHeight: '1.3',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}>
                                  {property.custom_name || property.address}
                                </div>
                                {property.property_type && (
                                  <div style={{ 
                                    fontSize: '11px', 
                                    color: '#9CA3AF',
                                    lineHeight: '1.3',
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
              {selectedProperty && uploadedFiles.length === 0 && !notification && (
                <div style={{ width: '1px', height: '32px', background: 'rgba(229, 231, 235, 0.4)', flexShrink: 0 }} />
              )}

              {/* Document Selection Area */}
              {uploadedFiles.length > 0 && !notification ? (
                <div
                  className="relative"
                  style={{ 
                    flexShrink: 0,
                    minWidth: 'auto',
                    maxWidth: isInChatPanel ? '40%' : 'none',
                  }}
                >
                  {/* Single file display or dropdown trigger */}
                  {uploadedFiles.length === 1 ? (
                    <div
                      className="relative bg-white cursor-pointer"
                      style={{ 
                        width: 'fit-content',
                        height: '32px',
                        borderRadius: '12px',
                        border: '1px solid rgba(229, 231, 235, 0.6)',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                        padding: '6px 12px',
                        overflow: 'visible',
                        transition: 'border-color 0.15s ease',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.8)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.6)';
                      }}
                    >
                      <div className="flex items-center" style={{ width: '100%', minWidth: 0, gap: '6px' }}>
                        {/* File Icon or Image Preview */}
                        {isImage(uploadedFiles[0]) && imagePreviewUrls.get(uploadedFiles[0].name) ? (
                          <div className="rounded overflow-hidden flex-shrink-0 border border-gray-200" style={{ 
                            width: '20px',
                            height: '20px',
                            minWidth: '20px',
                            minHeight: '20px'
                          }}>
                            <img
                              src={imagePreviewUrls.get(uploadedFiles[0].name)!}
                              alt={uploadedFiles[0].name}
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
                            width: '20px',
                            height: '20px',
                            backgroundColor: isPDF(uploadedFiles[0]) ? '#ef4444' : isDOCX(uploadedFiles[0]) ? '#3b82f6' : '#6b7280'
                          }}>
                            <FileText className="text-white" style={{ width: '12px', height: '12px' }} strokeWidth={2} />
                          </div>
                        )}
                        
                        {/* File Info */}
                        <div className="flex flex-col" style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
                          <span className="font-medium text-black truncate" style={{ whiteSpace: 'nowrap', fontSize: '11px', lineHeight: '14px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {formatFileName(uploadedFiles[0].name)}
                          </span>
                          <span className="text-gray-500 font-normal truncate" style={{ fontSize: '9px', lineHeight: '12px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {getFileTypeLabel(uploadedFiles[0].type)}
                          </span>
                        </div>
                        
                        {/* Remove Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setUploadedFiles([]);
                          }}
                          className="rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                          style={{ 
                            width: '16px', 
                            height: '16px', 
                            marginLeft: '8px', 
                            flexShrink: 0,
                            background: 'rgba(0, 0, 0, 0.05)',
                            border: '1px solid rgba(0, 0, 0, 0.1)'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.1)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(0, 0, 0, 0.05)';
                          }}
                          title="Remove file"
                        >
                          <X className="text-gray-700" style={{ width: '11px', height: '11px' }} strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Multiple files - show count and dropdown */}
                      <div
                        className="relative bg-white cursor-pointer"
                        data-files-dropdown-trigger
                        onClick={() => setShowFilesDropdown(!showFilesDropdown)}
                        style={{ 
                          width: 'fit-content',
                          height: '32px',
                          borderRadius: '12px',
                          border: '1px solid rgba(229, 231, 235, 0.6)',
                          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                          padding: '6px 12px',
                          overflow: 'visible',
                          transition: 'border-color 0.15s ease',
                          display: 'flex',
                          alignItems: 'center',
                          minWidth: '80px'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.8)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.6)';
                        }}
                      >
                        <div className="flex items-center" style={{ width: '100%', minWidth: 0, gap: '6px' }}>
                          <div className="flex items-center justify-center flex-shrink-0" style={{
                            width: '20px',
                            height: '20px',
                            backgroundColor: '#6b7280',
                            borderRadius: '4px'
                          }}>
                            <FileText className="text-white" style={{ width: '12px', height: '12px' }} strokeWidth={2} />
                          </div>
                          
                          {/* File Count */}
                          <span className="font-medium text-black" style={{ fontSize: '11px', lineHeight: '14px', whiteSpace: 'nowrap' }}>
                            {uploadedFiles.length} file{uploadedFiles.length > 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>

                      {/* Dropdown */}
                      {showFilesDropdown && (
                        <>
                          <style>{`
                            .files-dropdown-scrollbar::-webkit-scrollbar {
                              display: none;
                              width: 0;
                            }
                            .files-dropdown-scrollbar {
                              -ms-overflow-style: none;
                              scrollbar-width: none;
                            }
                          `}</style>
                          <div
                            ref={filesDropdownRef}
                            className="absolute bg-white files-dropdown-scrollbar"
                            style={{
                              bottom: '100%',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              marginBottom: '16px',
                              borderRadius: '12px',
                              border: '1px solid rgba(229, 231, 235, 0.6)',
                              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)',
                              maxHeight: '200px',
                              overflowY: 'auto',
                              overflowX: 'hidden',
                              zIndex: 1000,
                              minWidth: '250px',
                              maxWidth: '400px',
                              scrollbarWidth: 'none',
                              msOverflowStyle: 'none'
                            }}
                          >
                          {/* Add More Files Button - at the top */}
                          <div
                            data-add-files-button
                            className="flex items-center gap-2"
                            style={{
                              padding: '8px 12px',
                              borderBottom: '1px solid rgba(229, 231, 235, 0.3)',
                              transition: 'background-color 0.15s ease',
                              cursor: 'pointer',
                              position: 'sticky',
                              top: 0,
                              backgroundColor: '#FFFFFF',
                              zIndex: 1
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              // Small delay to ensure event propagation is complete
                              requestAnimationFrame(() => {
                                if (fileInputRef.current) {
                                  fileInputRef.current.click();
                                }
                              });
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = '#F9FAFB';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = '#FFFFFF';
                            }}
                          >
                            <div className="rounded flex items-center justify-center flex-shrink-0" style={{
                              width: '20px',
                              height: '20px',
                              backgroundColor: '#ECECEC',
                              border: '1px solid rgba(229, 231, 235, 0.6)'
                            }}>
                              <Plus className="text-gray-700" style={{ width: '12px', height: '12px' }} strokeWidth={2.5} />
                            </div>
                            
                            {/* Add Files Text */}
                            <div className="flex flex-col" style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
                              <span className="font-medium text-black" style={{ fontSize: '13px', lineHeight: '16px' }}>
                                Add files
                              </span>
                            </div>
                          </div>
                          
                          {uploadedFiles.map((file, index) => (
                            <div
                              key={`${file.name}-${file.size}-${index}`}
                              className="flex items-center gap-2"
                              style={{
                                padding: '8px 12px',
                                borderBottom: index < uploadedFiles.length - 1 ? '1px solid rgba(229, 231, 235, 0.3)' : 'none',
                                transition: 'background-color 0.15s ease',
                                cursor: 'default'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = '#F9FAFB';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                              }}
                            >
                              {/* File Icon or Image Preview */}
                              {isImage(file) && imagePreviewUrls.get(file.name) ? (
                                <div className="rounded overflow-hidden flex-shrink-0 border border-gray-200" style={{ 
                                  width: '20px',
                                  height: '20px',
                                  minWidth: '20px',
                                  minHeight: '20px'
                                }}>
                                  <img
                                    src={imagePreviewUrls.get(file.name)!}
                                    alt={file.name}
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
                                  width: '20px',
                                  height: '20px',
                                  backgroundColor: isPDF(file) ? '#ef4444' : isDOCX(file) ? '#3b82f6' : '#6b7280'
                                }}>
                                  <FileText className="text-white" style={{ width: '12px', height: '12px' }} strokeWidth={2} />
                                </div>
                              )}
                              
                              {/* File Info */}
                              <div className="flex flex-col" style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
                                <span className="font-medium text-black truncate" style={{ whiteSpace: 'nowrap', fontSize: '13px', lineHeight: '16px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {file.name}
                                </span>
                                <span className="text-gray-500 font-normal truncate" style={{ fontSize: '11px', lineHeight: '14px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {getFileTypeLabel(file.type)}
                                </span>
                              </div>
                              
                              {/* Remove Button */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setUploadedFiles(prev => prev.filter((f, i) => i !== index));
                                  if (uploadedFiles.length === 2) {
                                    setShowFilesDropdown(false);
                                  }
                                }}
                                className="rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                                style={{ 
                                  width: '16px', 
                                  height: '16px', 
                                  marginLeft: '8px', 
                                  flexShrink: 0,
                                  background: 'rgba(0, 0, 0, 0.05)',
                                  border: '1px solid rgba(0, 0, 0, 0.1)'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'rgba(0, 0, 0, 0.1)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'rgba(0, 0, 0, 0.05)';
                                }}
                                title="Remove file"
                              >
                                <X className="text-gray-700" style={{ width: '11px', height: '11px' }} strokeWidth={2.5} />
                              </button>
                            </div>
                          ))}
                          </div>
                        </>
                      )}
                    </>
                  )}
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
                        width: '32px',
                        height: '32px',
                        background: '#FFFFFF',
                        border: '1px solid rgba(229, 231, 235, 0.6)',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        color: '#374151',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.8)';
                        e.currentTarget.style.backgroundColor = '#F9FAFB';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.6)';
                        e.currentTarget.style.backgroundColor = '#FFFFFF';
                      }}
                      title="Upload document"
                    >
                      <Upload className="w-4 h-4" />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx,.doc,image/*"
                      multiple
                      onChange={handleFileInputChange}
                      style={{ display: 'none' }}
                    />
                  </div>
                </>
              ) : null}

              {/* Save Button - show when property is selected (disabled if no file) */}
              {selectedProperty && !notification && (
                <>
                  <div style={{ width: '1px', height: '32px', background: 'rgba(229, 231, 235, 0.4)', flexShrink: 0 }} />
            <button
              onClick={handleSave}
              disabled={isUploading || !selectedProperty || uploadedFiles.length === 0}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                height: '32px',
                padding: '6px 12px',
                border: '1px solid rgba(229, 231, 235, 0.6)',
                borderRadius: '12px',
                background: (isUploading || !selectedProperty || uploadedFiles.length === 0) ? '#F3F4F6' : '#F5C085',
                cursor: (isUploading || !selectedProperty || uploadedFiles.length === 0) ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
                color: (isUploading || !selectedProperty || uploadedFiles.length === 0) ? '#9ca3af' : '#111827',
                fontSize: '11px',
                fontWeight: 500,
                flexShrink: 0,
                whiteSpace: 'nowrap',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)'
              }}
              onMouseEnter={(e) => {
                if (!isUploading && selectedProperty && uploadedFiles.length > 0) {
                  e.currentTarget.style.backgroundColor = '#F1B367';
                  e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.8)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isUploading && selectedProperty && uploadedFiles.length > 0) {
                  e.currentTarget.style.backgroundColor = '#F5C085';
                  e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.6)';
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
                  <GitPullRequestArrow className="w-3.5 h-3.5" />
                  {!isInChatPanel && <span className="text-xs font-medium" style={{ whiteSpace: 'nowrap' }}>Link</span>}
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

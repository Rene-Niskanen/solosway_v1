"use client";

import * as React from "react";
import { useState, useCallback, useEffect } from "react";
import { X } from "lucide-react";
import { FileUploadCard } from "./FileUploadCard";
import { LocationSelectionCard } from "./LocationSelectionCard";
import { backendApi } from "@/services/backendApi";
import { motion, AnimatePresence } from "framer-motion";

interface UploadedFile {
  id: string;
  file: File;
  documentId?: string;
  uploadProgress: number;
  uploadStatus: 'uploading' | 'complete' | 'error';
  extractedAddress?: string;
}

interface NewPropertyPinWorkflowProps {
  isVisible: boolean;
  onClose: () => void;
  onPropertyCreated?: (propertyId: string, propertyData: any) => void;
}

export const NewPropertyPinWorkflow: React.FC<NewPropertyPinWorkflowProps> = ({
  isVisible,
  onClose,
  onPropertyCreated
}) => {
  const [propertyTitle, setPropertyTitle] = useState<string>('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploading, setUploading] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<{
    lat: number;
    lng: number;
    address: string;
  } | null>(null);
  const [extractedAddresses, setExtractedAddresses] = useState<string[]>([]);
  const [mostFrequentAddress, setMostFrequentAddress] = useState<string | null>(null);
  const [showAddressConfirmation, setShowAddressConfirmation] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);

  // Calculate most frequent address when extracted addresses change
  useEffect(() => {
    if (extractedAddresses.length > 0) {
      // Count frequency of each address
      const addressCounts: Record<string, number> = {};
      extractedAddresses.forEach(addr => {
        addressCounts[addr] = (addressCounts[addr] || 0) + 1;
      });

      // Find most frequent
      let maxCount = 0;
      let mostFrequent = '';
      Object.entries(addressCounts).forEach(([addr, count]) => {
        if (count > maxCount) {
          maxCount = count;
          mostFrequent = addr;
        }
      });

      setMostFrequentAddress(mostFrequent);
      setShowAddressConfirmation(true);
    }
  }, [extractedAddresses]);

  // Handle file upload (immediate)
  const handleFileUpload = useCallback(async (file: File) => {
    const fileId = `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setUploading(true);

    // Update progress tracking
    setUploadProgress(prev => ({ ...prev, [fileId]: 0 }));

    try {
      // Upload without property_id (temporary upload)
      // Send empty metadata object instead of property_id: null to avoid string "null" issues
      const response = await backendApi.uploadPropertyDocumentViaProxy(
        file,
        {}, // Empty metadata when no property_id (don't send null)
        (percent) => {
          setUploadProgress(prev => ({ ...prev, [fileId]: percent }));
        }
      );

      if (response.success) {
        // Handle both response formats: {success: true, document_id: ...} and {success: true, data: {document_id: ...}}
        const documentId = (response.data as any)?.document_id || (response as any).document_id;
        
        if (!documentId) {
          throw new Error('No document_id in response');
        }
        
        // Update file with documentId
        setUploadedFiles(prev => prev.map(f => 
          f.id === fileId ? { ...f, documentId, uploadStatus: 'complete', uploadProgress: 100 } : f
        ));

        // Trigger address extraction (async, non-blocking)
        extractAddressFromDocument(documentId, fileId);
      } else {
        throw new Error(response.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploadedFiles(prev => prev.map(f => 
        f.id === fileId ? { ...f, uploadStatus: 'error' } : f
      ));
      setError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, []);

  // Extract address from document
  const extractAddressFromDocument = async (documentId: string, fileId: string) => {
    try {
      const response = await backendApi.extractAddressFromDocument(documentId);
      if (response.success && response.data) {
        const address = response.data as string;
        
        // Update file with extracted address
        setUploadedFiles(prev => prev.map(f => 
          f.id === fileId ? { ...f, extractedAddress: address } : f
        ));

        // Add to extracted addresses array
        setExtractedAddresses(prev => [...prev, address]);
      }
    } catch (error) {
      console.error('Address extraction error:', error);
      // Don't show error to user - extraction is optional
    }
  };

  // Handle file remove
  const handleFileRemove = useCallback((fileId: string) => {
    const file = uploadedFiles.find(f => f.id === fileId);
    
    // If file was uploaded, delete it from backend
    if (file?.documentId) {
      backendApi.deleteDocument(file.documentId).catch(err => {
        console.error('Failed to delete document:', err);
      });
    }

    // Remove from state
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
    
    // Remove from extracted addresses if it had one
    if (file?.extractedAddress) {
      setExtractedAddresses(prev => prev.filter(addr => addr !== file.extractedAddress));
    }
  }, [uploadedFiles]);

  // Handle address confirmation
  const handleAddressConfirm = useCallback(async () => {
    if (!mostFrequentAddress) return;

    try {
      // Geocode address to get coordinates
      const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
      const geocodingUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(mostFrequentAddress)}.json?access_token=${mapboxToken}&limit=1`;
      const response = await fetch(geocodingUrl);
      const data = await response.json();

      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        const address = data.features[0].place_name;

        setSelectedLocation({ lat, lng, address });
        setShowAddressConfirmation(false);
      }
    } catch (error) {
      console.error('Geocoding error:', error);
      setError('Failed to geocode address');
    }
  }, [mostFrequentAddress]);

  const handleAddressReject = useCallback(() => {
    setShowAddressConfirmation(false);
    // User can manually select location
  }, []);

  // Handle location select
  // CRITICAL: selectedLocation represents the user-set pin location - this is the ONLY source of truth for property location
  // It is the final coordinates selected when user clicks Create Property Card, NOT the extracted address from documents
  // Property pin location = Final User-Selected Coordinates from Create Property Card
  const handleLocationSelect = useCallback((location: { lat: number; lng: number; address: string }) => {
    setSelectedLocation(location);
    // Dismiss address confirmation if user manually selects
    if (showAddressConfirmation) {
      setShowAddressConfirmation(false);
    }
  }, [showAddressConfirmation]);

  // Handle property creation
  const handleCreateProperty = useCallback(async () => {
    // Validate
    if (!propertyTitle.trim()) {
      setError('Please enter a property title');
      return;
    }

    if (uploadedFiles.length === 0) {
      setError('Please upload at least one file');
      return;
    }

    if (!selectedLocation) {
      setError('Please select a location');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      // Create property
      const createResponse = await backendApi.createProperty(
        selectedLocation.address,
        { lat: selectedLocation.lat, lng: selectedLocation.lng }
      );

      if (!createResponse.success || !createResponse.data) {
        throw new Error(createResponse.error || 'Failed to create property');
      }

      const newPropertyId = (createResponse.data as any).property_id;
      setPropertyId(newPropertyId);

      // Link all uploaded files to property
      const linkPromises = uploadedFiles
        .filter(f => f.documentId)
        .map(file => 
          backendApi.linkDocumentToProperty(file.documentId!, newPropertyId)
        );

      await Promise.all(linkPromises);

      // Call success callback with title
      if (onPropertyCreated) {
        onPropertyCreated(newPropertyId, { 
          ...createResponse.data, 
          title: propertyTitle,
          property_title: propertyTitle
        });
      }

      // Close workflow
      onClose();
    } catch (error) {
      console.error('Property creation error:', error);
      setError(error instanceof Error ? error.message : 'Failed to create property');
    } finally {
      setIsCreating(false);
    }
  }, [propertyTitle, uploadedFiles, selectedLocation, onPropertyCreated, onClose]);

  // Handle cancel/close
  const handleCancel = useCallback(async () => {
    // If property was created, don't delete files
    if (propertyId) {
      onClose();
      return;
    }

    // Delete all uploaded files
    const deletePromises = uploadedFiles
      .filter(f => f.documentId)
      .map(file => backendApi.deleteDocument(file.documentId!));

    try {
      await Promise.all(deletePromises);
    } catch (error) {
      console.error('Failed to delete some files:', error);
    }

    // Clear state and close
    setPropertyTitle('');
    setUploadedFiles([]);
    setSelectedLocation(null);
    setExtractedAddresses([]);
    setMostFrequentAddress(null);
    setShowAddressConfirmation(false);
    setError(null);
    onClose();
  }, [uploadedFiles, propertyId, onClose]);

  const canCreate = uploadedFiles.length > 0 && selectedLocation !== null && propertyTitle.trim().length > 0 && !isCreating;

  // Prevent default drag and drop behavior when modal is visible
  React.useEffect(() => {
    if (!isVisible) return;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    // Add event listeners to document to catch all drag events
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);

    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragleave', handleDragLeave);
    };
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <AnimatePresence>
      {isVisible && (
        <>
          {/* Backdrop - Same as preview modal */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleCancel}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
          />
          
          {/* Main Content - Centered Card */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none flex-col gap-4"
          >
                  {/* Main Content - Single Container with Two Panels */}
                  <div 
                    className="bg-white flex flex-col overflow-hidden pointer-events-auto relative"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: '75%',
                      maxWidth: '1100px',
                      height: '75vh',
                      maxHeight: '700px',
                      borderRadius: '0',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
                    }}
                  >
                    {/* Floating Close Button */}
                    <button
                      onClick={handleCancel}
                      className="absolute top-4 right-4 z-50 p-2 rounded-full bg-white/80 backdrop-blur-sm hover:bg-white transition-all duration-200 shadow-sm"
                      style={{ color: '#374151' }}
                    >
                      <X className="w-4 h-4" />
                    </button>

                    {/* Content Area - Two Panels (Full Height) */}
                    <div className="flex flex-1 h-full overflow-hidden">
                      {/* Left Panel - File Upload (35% width) */}
                      <div 
                        className="flex flex-col items-center justify-center relative"
                        style={{
                          width: '35%',
                          flexShrink: 0,
                          borderRight: 'none',
                          height: '100%',
                          backgroundColor: '#212121'
                        }}
                      >
                        {/* Title Overlay */}
                        <div className="absolute top-6 left-0 right-0 text-center z-10 pointer-events-none px-4">
                           <h1 className="text-base truncate" style={{ fontWeight: 600, color: '#FFFFFF' }}>Create New Property Card</h1>
                        </div>

                        {/* Property Title Input */}
                        <div className="absolute top-16 left-0 right-0 z-10 px-6 pointer-events-auto">
                          <div className="mb-4">
                            <label 
                              className="block mb-2 text-sm"
                              style={{ color: '#9CA3AF', fontWeight: 500 }}
                            >
                              Property Title
                            </label>
                            <input
                              type="text"
                              value={propertyTitle}
                              onChange={(e) => setPropertyTitle(e.target.value)}
                              placeholder="e.g., Main Street Property, Investment Property A"
                              className="w-full px-4 py-2.5 text-sm"
                              style={{
                                backgroundColor: '#2A2A2A',
                                border: '1px solid #404040',
                                color: '#FFFFFF',
                                borderRadius: '0',
                                outline: 'none'
                              }}
                              onFocus={(e) => {
                                e.target.style.borderColor = '#3B82F6';
                              }}
                              onBlur={(e) => {
                                e.target.style.borderColor = '#404040';
                              }}
                            />
                            <p 
                              className="mt-1.5 text-xs"
                              style={{ color: '#6B7280' }}
                            >
                              Give your property a name to easily identify it later
                            </p>
                          </div>
                        </div>

                        {/* Instructions - Positioned to avoid overlap with file upload area */}
                        <div className="absolute top-44 left-0 right-0 z-10 px-6 pointer-events-none" style={{ maxWidth: '100%' }}>
                          <div className="mb-4">
                            <p 
                              className="text-sm mb-2"
                              style={{ color: '#9CA3AF', fontWeight: 500 }}
                            >
                              Step 1: Upload Files
                            </p>
                            <p 
                              className="text-xs leading-relaxed"
                              style={{ color: '#6B7280', marginBottom: '20px' }}
                            >
                              Drag and drop property documents, photos, or reports here. 
                              You can upload PDFs, images, and other property-related files.
                            </p>
                          </div>
                          <div style={{ marginTop: '24px' }}>
                            <p 
                              className="text-sm mb-2"
                              style={{ color: '#9CA3AF', fontWeight: 500 }}
                            >
                              Step 2: Select Location
                            </p>
                            <p 
                              className="text-xs leading-relaxed"
                              style={{ color: '#6B7280' }}
                            >
                              Click on the map to the right to set the property location, 
                              or search for an address using the search bar.
                            </p>
                          </div>
                        </div>

                        {/* FileUploadCard - Positioned well below instructions with ample spacing */}
                        <div className="absolute inset-0 flex items-center justify-center" style={{ paddingTop: '420px', zIndex: 1, pointerEvents: 'auto' }}>
                          <FileUploadCard
                            files={uploadedFiles}
                            onFilesChange={setUploadedFiles}
                            uploading={uploading}
                            uploadProgress={uploadProgress}
                            onFileUpload={handleFileUpload}
                            onFileRemove={handleFileRemove}
                          />
                        </div>
                      </div>

                      {/* Right Panel - Map (65% width) - Infinity Pool */}
                      <div 
                        className="relative flex-1"
                        style={{
                          width: '65%',
                          overflow: 'hidden',
                          height: '100%'
                        }}
                      >
                        <LocationSelectionCard
                          selectedLocation={selectedLocation}
                          onLocationSelect={handleLocationSelect}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Create Button - Below Card */}
                  <div className="pointer-events-auto mt-6 flex flex-col items-center">
                    <button
                      onClick={handleCreateProperty}
                      disabled={!canCreate}
                      className="px-8 py-3 bg-white text-gray-900 rounded-full hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-xl border-2 border-gray-300 text-center min-w-[200px]"
                      style={{
                        fontSize: '14px',
                        fontWeight: 500,
                        letterSpacing: '0.5px'
                      }}
                    >
                      {isCreating ? 'Creating...' : 'Create Property'}
                    </button>
                    {error && (
                      <div className="text-red-600 text-center mt-2 bg-white/90 backdrop-blur px-3 py-1.5 rounded-lg text-xs shadow-md">{error}</div>
                    )}
                  </div>
          </motion.div>

          {/* Address Confirmation Modal */}
          {showAddressConfirmation && mostFrequentAddress && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-white max-w-md w-full mx-4"
                style={{
                  borderRadius: '24px',
                  padding: '32px',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.12)'
                }}
              >
                <h3 className="text-gray-800 mb-2" style={{ fontSize: '20px', fontWeight: 600 }}>
                  Address Found in Files
                </h3>
                <p className="text-gray-600 mb-6" style={{ fontSize: '14px', fontWeight: 400 }}>
                  This address was found in your uploaded files:
                </p>
                <div 
                  className="rounded-lg p-4 mb-6"
                  style={{
                    backgroundColor: '#F9FAFB',
                    border: '1px solid #E5E7EB'
                  }}
                >
                  <p className="text-gray-800" style={{ fontSize: '15px', fontWeight: 500 }}>{mostFrequentAddress}</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleAddressReject}
                    className="flex-1 px-4 py-2.5 rounded-lg text-gray-700 transition-all duration-200"
                    style={{
                      border: '1px solid #D1D5DB',
                      fontSize: '14px',
                      fontWeight: 500
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#F9FAFB';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    Choose Different Location
                  </button>
                  <button
                    onClick={handleAddressConfirm}
                    className="flex-1 px-4 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-black transition-all duration-200 shadow-sm"
                    style={{
                      fontSize: '14px',
                      fontWeight: 500
                    }}
                  >
                    Use This Address
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </>
      )}
    </AnimatePresence>
  );
};


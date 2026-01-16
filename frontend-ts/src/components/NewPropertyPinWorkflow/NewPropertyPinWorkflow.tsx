"use client";

import * as React from "react";
import { useState, useCallback, useEffect, useRef } from "react";
import { X, MapPin, Upload, FileText, Check, ArrowRight, Loader2 } from "lucide-react";
import { backendApi } from "@/services/backendApi";
import { motion, AnimatePresence } from "framer-motion";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import * as pdfjs from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface UploadedFile {
  id: string;
  file: File;
  documentId?: string;
  uploadProgress: number;
  uploadStatus: 'uploading' | 'complete' | 'error';
  extractedAddress?: string;
  thumbnailUrl?: string; // For PDF/document previews
}

interface NewPropertyPinWorkflowProps {
  isVisible: boolean;
  onClose: () => void;
  onPropertyCreated?: (propertyId: string, propertyData: any) => void;
  sidebarWidth?: number; // Width of the sidebar (including toggle rail) in pixels
}

export const NewPropertyPinWorkflow: React.FC<NewPropertyPinWorkflowProps> = ({
  isVisible,
  onClose,
  onPropertyCreated,
  sidebarWidth = 0
}) => {
  // State
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const [propertyTitle, setPropertyTitle] = useState<string>('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<{
    lat: number;
    lng: number;
    address: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(true);
  const [displayedPlaceholder, setDisplayedPlaceholder] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);

  // Animated placeholder names
  const placeholderNames = [
    '42 Victoria Street',
    'Riverside Development',
    'The Shard Project',
    'Kings Cross Site',
    'Battersea Power Station',
    'Canary Wharf Tower',
  ];

  // Refs
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const marker = useRef<mapboxgl.Marker | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || '';

  // Reset state when closed
  useEffect(() => {
    if (!isVisible) {
      setCurrentStep(1);
      setPropertyTitle('');
      setUploadedFiles([]);
      setSelectedLocation(null);
      setSearchQuery('');
      setError(null);
    }
  }, [isVisible]);

  // Animated placeholder typing effect
  useEffect(() => {
    if (!isVisible || propertyTitle || isInputFocused) return;
    
    const currentName = placeholderNames[placeholderIndex];
    let charIndex = 0;
    let timeout: NodeJS.Timeout;
    
    if (isTyping) {
      // Typing animation
      const typeChar = () => {
        if (charIndex <= currentName.length) {
          setDisplayedPlaceholder(currentName.slice(0, charIndex));
          charIndex++;
          timeout = setTimeout(typeChar, 50 + Math.random() * 30);
        } else {
          // Pause at end, then start erasing
          timeout = setTimeout(() => setIsTyping(false), 2000);
        }
      };
      typeChar();
    } else {
      // Erasing animation
      let eraseIndex = currentName.length;
      const eraseChar = () => {
        if (eraseIndex >= 0) {
          setDisplayedPlaceholder(currentName.slice(0, eraseIndex));
          eraseIndex--;
          timeout = setTimeout(eraseChar, 30);
        } else {
          // Move to next name
          setPlaceholderIndex((prev) => (prev + 1) % placeholderNames.length);
          setIsTyping(true);
        }
      };
      eraseChar();
    }
    
    return () => clearTimeout(timeout);
  }, [isVisible, placeholderIndex, isTyping, propertyTitle, isInputFocused]);

  // Initialize map when step 2 is active
  useEffect(() => {
    if (!isVisible || currentStep !== 2 || !mapContainer.current || !mapboxToken) return;
    
    // Small delay to ensure container is rendered
    const timer = setTimeout(() => {
      if (map.current) return;
      
      mapboxgl.accessToken = mapboxToken;
      map.current = new mapboxgl.Map({
        container: mapContainer.current!,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [-0.1276, 51.5074],
        zoom: 11,
        attributionControl: false
      });

      map.current.on('load', () => {
        map.current?.resize();
      });

      map.current.on('click', async (e) => {
        const { lng, lat } = e.lngLat;
        try {
          const geocodingUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${mapboxToken}`;
          const response = await fetch(geocodingUrl);
          const data = await response.json();
          const address = data.features?.[0]?.place_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
          setSelectedLocation({ lat, lng, address: cleanAddress(address) });
        } catch (error) {
          setSelectedLocation({ lat, lng, address: `${lat.toFixed(6)}, ${lng.toFixed(6)}` });
        }
      });
    }, 100);

    return () => {
      clearTimeout(timer);
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [isVisible, currentStep, mapboxToken]);

  // Update marker when location changes
  useEffect(() => {
    if (!map.current || !selectedLocation) return;

    if (marker.current) {
      marker.current.remove();
    }

    const markerElement = document.createElement('div');
    markerElement.innerHTML = `
      <div style="
        width: 14px;
        height: 14px;
        background: #18181B;
        border-radius: 50%;
        border: 2px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      "></div>
    `;

    marker.current = new mapboxgl.Marker({
      element: markerElement,
      anchor: 'center'
    })
      .setLngLat([selectedLocation.lng, selectedLocation.lat])
      .addTo(map.current);

    map.current.flyTo({
      center: [selectedLocation.lng, selectedLocation.lat],
      zoom: 15,
      duration: 800
    });
  }, [selectedLocation]);

  // Clean address helper
  const cleanAddress = (address: string): string => {
    if (!address) return '';
    const parts = address.split(',').map(part => part.trim());
    const broadTerms = ['london', 'united kingdom', 'uk', 'england', 'great britain', 'gb'];
    const cleanedParts = parts.filter(part => {
      const lowerPart = part.toLowerCase().trim();
      return !broadTerms.some(term => lowerPart === term);
    });
    return cleanedParts.slice(0, 3).join(', ').trim() || address;
  };

  // Generate PDF thumbnail
  const generatePdfThumbnail = async (file: File): Promise<string | null> => {
    try {
      console.log('Generating thumbnail for PDF:', file.name);
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) {
        console.warn('Could not get canvas context');
        return null;
      }
      
      // Get page dimensions
      const viewport = page.getViewport({ scale: 1.0 });
      const pageWidth = viewport.width;
      const pageHeight = viewport.height;
      
      // Calculate scale to fit within reasonable thumbnail size while maintaining aspect ratio
      // Target max dimensions for thumbnail
      const maxWidth = 400;
      const maxHeight = 600;
      const scaleX = maxWidth / pageWidth;
      const scaleY = maxHeight / pageHeight;
      const scale = Math.min(scaleX, scaleY, 2.0); // Cap at 2.0 for quality
      
      const scaledViewport = page.getViewport({ scale });
      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;
      
      // Render with white background
      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);
      
      await page.render({
        canvasContext: context,
        viewport: scaledViewport,
      } as any).promise;
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      console.log('Thumbnail generated successfully, dimensions:', canvas.width, 'x', canvas.height);
      return dataUrl;
    } catch (error) {
      console.error('Failed to generate PDF thumbnail:', error);
      return null;
    }
  };

  // File handling
  const handleFileAdd = useCallback(async (file: File) => {
    const fileId = `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newFile: UploadedFile = {
      id: fileId,
      file,
      uploadProgress: 0,
      uploadStatus: 'uploading'
    };

    setUploadedFiles(prev => [...prev, newFile]);
    setUploading(true);

    // Generate thumbnail immediately for PDFs (before upload completes)
    const isPDF = file.type === 'application/pdf' || 
                 file.type === 'application/x-pdf' ||
                 file.name.toLowerCase().endsWith('.pdf');
    
    if (isPDF) {
      try {
        const thumbnailUrl = await generatePdfThumbnail(file);
        if (thumbnailUrl) {
          console.log('PDF thumbnail generated:', file.name);
          // Update state with thumbnail immediately
          setUploadedFiles(prev => prev.map(f =>
            f.id === fileId ? { ...f, thumbnailUrl } : f
          ));
        }
      } catch (error) {
        console.warn('Failed to generate PDF thumbnail for', file.name, error);
      }
    }

    try {
      // Upload without property_id (temporary upload)
      // Documents will be processed later when linked to the created property
      // Use silent: true to suppress global progress notification
      const response = await backendApi.uploadPropertyDocumentViaProxy(
        file,
        {
          skip_processing: 'true',  // Don't process yet - will process after property creation
          project_upload: 'true',   // Mark as project upload
          silent: true              // Don't show global progress notification
        },
        (percent) => {
          setUploadedFiles(prev => prev.map(f =>
            f.id === fileId ? { ...f, uploadProgress: percent } : f
          ));
        }
      );

      if (response.success) {
        const documentId = (response.data as any)?.document_id || (response as any).document_id;
        
        setUploadedFiles(prev => prev.map(f =>
          f.id === fileId ? { 
            ...f, 
            documentId, 
            uploadStatus: 'complete', 
            uploadProgress: 100
          } : f
        ));
      } else {
        throw new Error(response.error || 'Upload failed');
      }
    } catch (error) {
      setUploadedFiles(prev => prev.map(f =>
        f.id === fileId ? { ...f, uploadStatus: 'error' } : f
      ));
    } finally {
      setUploading(false);
    }
  }, []);

  const handleFileRemove = useCallback((fileId: string) => {
    const file = uploadedFiles.find(f => f.id === fileId);
    if (file?.documentId) {
      backendApi.deleteDocument(file.documentId).catch(console.error);
    }
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
  }, [uploadedFiles]);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    for (const file of droppedFiles) {
      await handleFileAdd(file);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    for (const file of selectedFiles) {
      await handleFileAdd(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Search handling
  const handleSearch = async () => {
    if (!searchQuery.trim() || !map.current) return;
    setIsSearching(true);
    try {
      const geocodingUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${mapboxToken}&limit=1`;
      const response = await fetch(geocodingUrl);
      const data = await response.json();
      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        const address = data.features[0].place_name;
        setSelectedLocation({ lat, lng, address: cleanAddress(address) });
      }
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setIsSearching(false);
    }
  };

  // Create property
  const handleCreate = useCallback(async () => {
    if (!selectedLocation) {
      setError('Please select a location');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const createResponse = await backendApi.createProperty(
        selectedLocation.address,
        { lat: selectedLocation.lat, lng: selectedLocation.lng }
      );

      if (!createResponse.success || !createResponse.data) {
        throw new Error(createResponse.error || 'Failed to create property');
      }

      const newPropertyId = (createResponse.data as any).property_id;

      // Link uploaded files
      const linkPromises = uploadedFiles
        .filter(f => f.documentId)
        .map(file => backendApi.linkDocumentToProperty(file.documentId!, newPropertyId));
      await Promise.all(linkPromises);

      if (onPropertyCreated) {
        onPropertyCreated(newPropertyId, {
          ...createResponse.data,
          title: propertyTitle,
          property_title: propertyTitle
        });
      }

      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create property');
    } finally {
      setIsCreating(false);
    }
  }, [selectedLocation, uploadedFiles, propertyTitle, onPropertyCreated, onClose]);

  // Cancel handling
  const handleCancel = useCallback(async () => {
    const deletePromises = uploadedFiles
      .filter(f => f.documentId)
      .map(file => backendApi.deleteDocument(file.documentId!));
    try {
      await Promise.all(deletePromises);
    } catch (error) {
      console.error('Failed to delete files:', error);
    }
    onClose();
  }, [uploadedFiles, onClose]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Allow proceeding if files are attached (even if still uploading or some failed)
  // Files can continue uploading in the background
  const canProceedToStep2 = uploadedFiles.length > 0;
  const canCreate = selectedLocation !== null && !isCreating;

  if (!isVisible) return null;

  // Calculate left offset and width based on sidebar
  const leftOffset = sidebarWidth;
  const contentWidth = `calc(100vw - ${leftOffset}px)`;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed z-50"
        style={{ 
          left: `${leftOffset}px`,
          top: 0,
          right: 0,
          bottom: 0,
          width: contentWidth,
          backgroundColor: '#FAFAFA' 
        }}
      >
        {/* Header - minimal */}
        <div 
          className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between"
          style={{
            padding: '20px 32px',
            backgroundColor: 'transparent',
          }}
        >
          {/* Step indicator - minimal dots */}
          <div className="flex items-center gap-3">
            <div 
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: currentStep >= 1 ? '#1a1a1a' : '#d4d4d4',
                transition: 'background-color 0.2s ease',
              }}
            />
            <div 
                style={{
                  width: '24px',
                height: '1px',
                backgroundColor: currentStep >= 2 ? '#1a1a1a' : '#e5e5e5',
                transition: 'background-color 0.2s ease',
              }}
            />
            <div 
                style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: currentStep >= 2 ? '#1a1a1a' : '#d4d4d4',
                transition: 'background-color 0.2s ease',
              }}
            />
          </div>

          <button
            onClick={handleCancel}
            className="flex items-center justify-center transition-all"
            style={{ 
              width: '32px', 
              height: '32px', 
              borderRadius: '8px',
              backgroundColor: 'transparent',
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.05)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <X className="w-4 h-4 text-neutral-500" strokeWidth={1.5} />
          </button>
        </div>

        {/* Content */}
        <div className="absolute inset-0" style={{ top: '65px' }}>
          {/* Step 1: File Upload */}
          {currentStep === 1 && (
            <div className="w-full h-full flex flex-col items-center justify-center px-8" style={{ paddingTop: '0', paddingBottom: '0' }}>
              <div className="w-full max-w-md" style={{ marginTop: '-40px' }}>
                {/* Project name input */}
                <div style={{ marginBottom: '24px' }}>
                  <div className="relative">
                  <input
                    type="text"
                    value={propertyTitle}
                    onChange={(e) => setPropertyTitle(e.target.value)}
                      onFocus={() => setIsInputFocused(true)}
                      onBlur={() => setIsInputFocused(false)}
                      className="w-full bg-transparent border-0 border-b transition-colors focus:outline-none"
                    style={{
                        padding: '12px 0',
                        fontSize: '18px',
                        fontWeight: 400,
                        color: '#1a1a1a',
                        borderBottomWidth: '1px',
                        borderBottomColor: isInputFocused ? '#a1a1a1' : '#e5e5e5',
                        letterSpacing: '-0.01em',
                      }}
                    />
                    {!propertyTitle && !isInputFocused && (
                      <div 
                        className="absolute inset-0 pointer-events-none flex items-center"
                        style={{ padding: '12px 0' }}
                      >
                        <span style={{ fontSize: '18px', color: '#a1a1a1', fontWeight: 400, letterSpacing: '-0.01em' }}>
                          {displayedPlaceholder}
                        </span>
                      </div>
                    )}
                  </div>
                  <p style={{ fontSize: '12px', color: '#a1a1a1', marginTop: '8px', fontWeight: 400, letterSpacing: '-0.01em' }}>
                    Project name
                  </p>
                </div>

                {/* Files section - flat design */}
                <div style={{ marginBottom: '32px' }}>
                  <p style={{ fontSize: '12px', color: '#a1a1a1', marginBottom: '12px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Attachments
                  </p>
                  
                  {/* Drop zone - minimal */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                    className="cursor-pointer transition-all"
                    style={{
                      padding: '32px 24px',
                      borderRadius: '12px',
                      backgroundColor: isDragOver ? '#f5f5f5' : '#fafafa',
                      border: '1px solid #e5e5e5',
                    }}
                  >
                    <div className="flex flex-col items-center">
                      <Upload className="w-5 h-5 text-neutral-500 mb-3" strokeWidth={1.5} />
                      <p style={{ fontSize: '14px', color: '#a1a1a1', marginBottom: '4px', fontWeight: 400, letterSpacing: '-0.01em' }}>
                        Drop files here or <span style={{ color: '#a1a1a1', fontWeight: 500 }}>browse</span>
                      </p>
                      <p style={{ fontSize: '12px', color: '#a3a3a3', fontWeight: 400, letterSpacing: '-0.01em' }}>
                        PDF, images, documents
                      </p>
                    </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </div>

                  {/* File List - Document-shaped cards */}
                {uploadedFiles.length > 0 && (
                    <div className="flex flex-wrap gap-3 mt-4">
                    {uploadedFiles.map((uploadedFile) => (
                      <div
                        key={uploadedFile.id}
                          className="relative group"
                          style={{
                            width: '140px',
                            aspectRatio: '8.5/11', // US Letter document ratio
                            borderRadius: '6px',
                            overflow: 'hidden',
                            backgroundColor: 'white',
                            border: '1px solid #e5e5e5',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                            transition: 'all 0.2s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)';
                            e.currentTarget.style.borderColor = '#d4d4d4';
                            e.currentTarget.style.transform = 'translateY(-2px)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)';
                            e.currentTarget.style.borderColor = '#e5e5e5';
                            e.currentTarget.style.transform = 'translateY(0)';
                          }}
                        >
                          {/* Document preview area */}
                          <div style={{ 
                            width: '100%', 
                            height: 'calc(100% - 28px)', 
                            position: 'relative', 
                            backgroundColor: '#f5f5f5',
                            overflow: 'hidden',
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'center',
                          }}>
                            {uploadedFile.file.type.startsWith('image/') ? (
                              <img
                                src={URL.createObjectURL(uploadedFile.file)}
                                alt={uploadedFile.file.name}
                                className="w-full h-full object-cover"
                              />
                            ) : uploadedFile.thumbnailUrl ? (
                              // PDF/document thumbnail - show full document preview (like DocumentPreviewCard)
                              <img
                                src={uploadedFile.thumbnailUrl}
                                alt={uploadedFile.file.name}
                                style={{ 
                                  width: '100%',
                                  height: '100%',
                                  objectFit: 'cover',
                                  objectPosition: 'top center',
                                  display: 'block',
                                  backgroundColor: 'white',
                                }}
                                onError={(e) => {
                                  console.warn('Failed to load thumbnail for', uploadedFile.file.name);
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                            ) : (
                              // Fallback for documents without thumbnail yet
                              <div className="w-full h-full flex flex-col items-center justify-center" style={{ backgroundColor: '#f7f7f7' }}>
                                <div 
                                  className="flex items-center justify-center"
                                  style={{
                                    width: '32px',
                                    height: '40px',
                                    backgroundColor: 'white',
                                    borderRadius: '2px',
                                    border: '1px solid #e5e5e5',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                                  }}
                                >
                                  <FileText className="w-4 h-4" style={{ color: '#a1a1a1' }} strokeWidth={1.5} />
                                </div>
                              </div>
                            )}
                            
                            {/* Remove button */}
                            <button
                              onClick={(e) => { e.stopPropagation(); handleFileRemove(uploadedFile.id); }}
                              className="absolute top-1.5 right-1.5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              style={{
                                width: '18px',
                                height: '18px',
                                borderRadius: '4px',
                                backgroundColor: 'rgba(0,0,0,0.7)',
                                backdropFilter: 'blur(8px)',
                              }}
                            >
                              <X className="w-2.5 h-2.5 text-white" strokeWidth={2.5} />
                            </button>

                            {/* Upload progress */}
                            {uploadedFile.uploadStatus === 'uploading' && (
                              <div 
                                className="absolute inset-0 flex items-center justify-center"
                                style={{ backgroundColor: 'rgba(255,255,255,0.95)' }}
                              >
                                <motion.div
                                  animate={{ rotate: 360 }}
                                  transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                                  style={{
                                    width: '18px',
                                    height: '18px',
                                    border: '2px solid #e5e5e5',
                                    borderTopColor: '#525252',
                                    borderRadius: '50%',
                                  }}
                                />
                              </div>
                            )}
                          </div>
                          
                          {/* Filename footer */}
                          <div style={{ 
                            height: '28px',
                            padding: '5px 6px',
                            backgroundColor: 'white',
                            borderTop: '1px solid #f5f5f5',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}>
                            <p 
                              className="truncate text-center w-full" 
                              style={{ 
                                fontSize: '10px', 
                                color: '#525252', 
                                fontWeight: 500, 
                                letterSpacing: '-0.01em',
                                lineHeight: '1.3',
                              }}
                            >
                              {uploadedFile.file.name.length > 14 
                                ? uploadedFile.file.name.substring(0, 14) + '...' 
                                : uploadedFile.file.name}
                            </p>
                          </div>
                      </div>
                    ))}
                  </div>
                )}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between" style={{ alignItems: 'center' }}>
                  <button
                    onClick={() => setCurrentStep(2)}
                    className="transition-colors flex items-center"
                    style={{ 
                      fontSize: '13px', 
                      color: '#a1a1a1',
                      fontWeight: 400,
                      letterSpacing: '-0.01em',
                      padding: '6px 0',
                      height: '28px',
                      lineHeight: '1',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.color = '#525252'}
                    onMouseLeave={(e) => e.currentTarget.style.color = '#a1a1a1'}
                  >
                    Skip this step
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(2)}
                    disabled={!canProceedToStep2}
                    className="flex items-center gap-2 transition-all focus:outline-none disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: canProceedToStep2 ? '#1a1a1a' : '#e5e5e5',
                      color: canProceedToStep2 ? '#ffffff' : '#a1a1a1',
                      borderRadius: '9999px',
                      padding: '6px 12px',
                      fontSize: '13px',
                      fontWeight: 500,
                      letterSpacing: '-0.01em',
                      height: '28px',
                      lineHeight: '1',
                    }}
                    onMouseEnter={(e) => {
                      if (!canProceedToStep2) return;
                      e.currentTarget.style.backgroundColor = '#404040';
                    }}
                    onMouseLeave={(e) => {
                      if (!canProceedToStep2) return;
                      e.currentTarget.style.backgroundColor = '#1a1a1a';
                    }}
                  >
                    <span>Continue</span>
                    <ArrowRight className="w-4 h-4" strokeWidth={2} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Location Selection */}
          {currentStep === 2 && (
            <div className="w-full h-full relative">
              {/* Map */}
              <div ref={mapContainer} className="absolute inset-0" />
              
              {!mapboxToken && (
                <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: '#f5f5f5' }}>
                  <p style={{ fontSize: '14px', color: '#a1a1a1' }}>Map not configured</p>
                </div>
              )}

              {/* Bottom panel - floating card */}
              <div 
                className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-30"
                style={{
                  width: '100%',
                  maxWidth: '400px',
                  padding: '0 24px',
                }}
              >
                <div 
                  style={{ 
                    backgroundColor: 'white',
                    borderRadius: '16px',
                    padding: '20px',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)',
                  }}
                >
                  {/* Search */}
                  <div className="relative mb-4">
                    <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4" style={{ color: '#a1a1a1' }} />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                      placeholder="Search address..."
                      className="w-full transition-colors focus:outline-none"
                      style={{
                        padding: '12px 12px 12px 36px',
                        fontSize: '14px',
                        borderRadius: '10px',
                        backgroundColor: '#f5f5f5',
                        border: '1px solid transparent',
                        color: '#1a1a1a',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.backgroundColor = '#ffffff';
                        e.currentTarget.style.border = '1px solid #e5e5e5';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.backgroundColor = '#f5f5f5';
                        e.currentTarget.style.border = '1px solid transparent';
                      }}
                    />
                    {searchQuery && (
                      <button
                        onClick={handleSearch}
                        disabled={isSearching}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 transition-all disabled:opacity-50"
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#1a1a1a',
                          color: 'white',
                          fontSize: '12px',
                          fontWeight: 500,
                          borderRadius: '6px',
                        }}
                      >
                        {isSearching ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Search'}
                      </button>
                    )}
                  </div>

                  {/* Selected location */}
                  {selectedLocation && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mb-4"
                      style={{
                        padding: '12px',
                        backgroundColor: '#f5f5f5',
                        borderRadius: '10px',
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div 
                          className="flex items-center justify-center flex-shrink-0"
                          style={{
                            width: '28px',
                            height: '28px',
                            backgroundColor: '#1a1a1a',
                            borderRadius: '8px',
                          }}
                        >
                          <Check className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p style={{ fontSize: '13px', fontWeight: 500, color: '#1a1a1a', lineHeight: 1.4 }}>
                            {selectedLocation.address}
                          </p>
                          <p style={{ fontSize: '11px', color: '#a1a1a1', marginTop: '2px' }}>
                            {selectedLocation.lat.toFixed(5)}, {selectedLocation.lng.toFixed(5)}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* Helper text */}
                  {!selectedLocation && (
                    <p className="text-center mb-4" style={{ fontSize: '13px', color: '#a1a1a1' }}>
                      Click on the map to place a pin
                    </p>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => setCurrentStep(1)}
                      className="transition-all"
                      style={{
                        padding: '10px 20px',
                        fontSize: '13px',
                        fontWeight: 500,
                        borderRadius: '9999px',
                        color: '#525252',
                        backgroundColor: '#f5f5f5',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#ebebeb'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                    >
                      Back
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={!canCreate}
                      className="flex-1 flex items-center justify-center gap-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{
                        padding: '10px 20px',
                        fontSize: '13px',
                        fontWeight: 500,
                        borderRadius: '9999px',
                        backgroundColor: canCreate ? '#1a1a1a' : '#e5e5e5',
                        color: canCreate ? 'white' : '#a1a1a1',
                      }}
                      onMouseEnter={(e) => {
                        if (!canCreate) return;
                        e.currentTarget.style.backgroundColor = '#404040';
                      }}
                      onMouseLeave={(e) => {
                        if (!canCreate) return;
                        e.currentTarget.style.backgroundColor = '#1a1a1a';
                      }}
                    >
                      {isCreating ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <span>Create project</span>
                          <ArrowRight className="w-4 h-4" strokeWidth={2} />
                        </>
                      )}
                    </button>
                  </div>

                  {/* Error */}
                  {error && (
                    <p className="mt-3 text-center" style={{ fontSize: '13px', color: '#ef4444' }}>{error}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

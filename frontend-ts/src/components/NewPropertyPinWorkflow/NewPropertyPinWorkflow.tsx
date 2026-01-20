"use client";

import * as React from "react";
import { useState, useCallback, useEffect, useRef } from "react";
import { X, MapPin, Upload, FileText, Check, ArrowRight, Loader2, Search, Moon, Layers, UserPlus } from "lucide-react";
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
  const [propertyTitle, setPropertyTitle] = useState<string>('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
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
  const [suggestions, setSuggestions] = useState<Array<{ place_name: string; center: [number, number] }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [isColorfulMap, setIsColorfulMap] = useState(false);
  const [isChangingStyle, setIsChangingStyle] = useState(false);
  const [defaultPreviewUrl, setDefaultPreviewUrl] = useState<string | null>(null);
  const [lightPreviewUrl, setLightPreviewUrl] = useState<string | null>(null);
  const [teamMemberEmails, setTeamMemberEmails] = useState<string[]>([]);
  const [teamMemberEmailInput, setTeamMemberEmailInput] = useState<string>('');
  const defaultPreviewMap = useRef<mapboxgl.Map | null>(null);
  const lightPreviewMap = useRef<mapboxgl.Map | null>(null);
  const defaultPreviewContainer = useRef<HTMLDivElement>(null);
  const lightPreviewContainer = useRef<HTMLDivElement>(null);

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
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const previewMapContainer = useRef<HTMLDivElement>(null);
  const previewMap = useRef<mapboxgl.Map | null>(null);
  const isSelectingSuggestionRef = useRef<boolean>(false);
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || '';

  // Reset state when closed
  useEffect(() => {
    if (!isVisible) {
      setPropertyTitle('');
      setUploadedFiles([]);
      setSelectedLocation(null);
      setSearchQuery('');
      setError(null);
      setSuggestions([]);
      setShowSuggestions(false);
      setTeamMemberEmails([]);
      setTeamMemberEmailInput('');
      setIsSuccess(false);
    }
  }, [isVisible]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showSuggestions && searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    if (showSuggestions) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSuggestions]);

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

  // Initialize map when visible
  useEffect(() => {
    if (!isVisible || !mapContainer.current || !mapboxToken) return;
    
    // Small delay to ensure container is rendered
    const timer = setTimeout(() => {
      if (map.current) return;
      
      mapboxgl.accessToken = mapboxToken;
      map.current = new mapboxgl.Map({
        container: mapContainer.current!,
        style: isColorfulMap ? 'mapbox://styles/mapbox/outdoors-v12' : 'mapbox://styles/mapbox/light-v11',
        center: [-0.1276, 51.5074],
        zoom: 11,
        attributionControl: false
      });

      map.current.on('load', () => {
        map.current?.resize();
      });

      // Resize map when container size changes (important for 50% width layout)
      let resizeObserver: ResizeObserver | null = null;
      if (mapContainer.current) {
        resizeObserver = new ResizeObserver(() => {
          if (map.current) {
            map.current.resize();
          }
        });
        resizeObserver.observe(mapContainer.current);
        // Store observer for cleanup
        (mapContainer.current as any).__resizeObserver = resizeObserver;
      }

      map.current.on('click', async (e) => {
        const { lng, lat } = e.lngLat;
        try {
          const geocodingUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${mapboxToken}&country=gb`;
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
      if (mapContainer.current && (mapContainer.current as any).__resizeObserver) {
        (mapContainer.current as any).__resizeObserver.disconnect();
        delete (mapContainer.current as any).__resizeObserver;
      }
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [isVisible, mapboxToken]);

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
      zoom: 18,
      duration: 800
    });
  }, [selectedLocation]);

  // Initialize both preview maps for button and popup thumbnails
  useEffect(() => {
    if (!isVisible || !defaultPreviewContainer.current || !lightPreviewContainer.current || !mapboxToken) return;
    if (defaultPreviewMap.current && lightPreviewMap.current) return; // Already initialized

    // Small delay to ensure containers are rendered
    const timer = setTimeout(() => {
      mapboxgl.accessToken = mapboxToken;
      
      // Get current map center if available, otherwise use default
      const currentCenter = map.current?.getCenter();
      const center: [number, number] = currentCenter 
        ? [currentCenter.lng, currentCenter.lat]
        : [-0.1276, 51.5074];
      const previewZoom = 7; // Fixed zoom level for preview (very zoomed out to avoid city name labels)

      // Helper function to hide labels and capture preview
      const hideLabelsAndCapture = (mapInstance: mapboxgl.Map, setter: (url: string) => void) => {
        const style = mapInstance.getStyle();
        if (style && style.layers) {
          style.layers.forEach((layer) => {
            if (layer.type === 'symbol' || layer.id.includes('label') || layer.id.includes('place')) {
              mapInstance.setLayoutProperty(layer.id, 'visibility', 'none');
            }
          });
        }
        
        setTimeout(() => {
          const canvas = mapInstance.getCanvas();
          const imageUrl = canvas.toDataURL('image/png');
          setter(imageUrl);
        }, 200);
      };

      // Create Default (Outdoors) preview map
      defaultPreviewMap.current = new mapboxgl.Map({
        container: defaultPreviewContainer.current!,
        style: 'mapbox://styles/mapbox/outdoors-v12',
        center: center,
        zoom: previewZoom,
        attributionControl: false,
        interactive: false,
        preserveDrawingBuffer: true,
      });

      defaultPreviewMap.current.on('load', () => {
        if (defaultPreviewMap.current) {
          hideLabelsAndCapture(defaultPreviewMap.current, setDefaultPreviewUrl);
        }
      });

      // Create Light preview map
      lightPreviewMap.current = new mapboxgl.Map({
        container: lightPreviewContainer.current!,
        style: 'mapbox://styles/mapbox/light-v11',
        center: center,
        zoom: previewZoom,
        attributionControl: false,
        interactive: false,
        preserveDrawingBuffer: true,
      });

      lightPreviewMap.current.on('load', () => {
        if (lightPreviewMap.current) {
          hideLabelsAndCapture(lightPreviewMap.current, setLightPreviewUrl);
        }
      });

      // Update previews when main map moves
      if (map.current) {
        const syncPreviews = () => {
          if (defaultPreviewMap.current && lightPreviewMap.current && map.current) {
            const currentCenter = map.current.getCenter();
            const center: [number, number] = [currentCenter.lng, currentCenter.lat];
            
            defaultPreviewMap.current.setCenter(center);
            defaultPreviewMap.current.setZoom(7);
            lightPreviewMap.current.setCenter(center);
            lightPreviewMap.current.setZoom(7);
            
            setTimeout(() => {
              if (defaultPreviewMap.current) {
                const canvas = defaultPreviewMap.current.getCanvas();
                setDefaultPreviewUrl(canvas.toDataURL('image/png'));
              }
              if (lightPreviewMap.current) {
                const canvas = lightPreviewMap.current.getCanvas();
                setLightPreviewUrl(canvas.toDataURL('image/png'));
              }
            }, 300);
          }
        };

        map.current.on('moveend', syncPreviews);
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      if (defaultPreviewMap.current) {
        defaultPreviewMap.current.remove();
        defaultPreviewMap.current = null;
      }
      if (lightPreviewMap.current) {
        lightPreviewMap.current.remove();
        lightPreviewMap.current = null;
      }
    };
  }, [isVisible, mapboxToken]);


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

  // Function to toggle map style between light and colorful
  const toggleMapStyle = useCallback(() => {
    if (map.current && !isChangingStyle) {
      const willBeColorful = !isColorfulMap;
      setIsColorfulMap(willBeColorful);
      setIsChangingStyle(true);
      
      // Store current view state before style change
      const currentCenter = map.current.getCenter();
      const currentZoom = map.current.getZoom();
      
      // Set the new style
      const newStyle = willBeColorful ? 'mapbox://styles/mapbox/outdoors-v12' : 'mapbox://styles/mapbox/light-v11';
      map.current.setStyle(newStyle);
      
      // Restore view state after style loads
      map.current.once('style.load', () => {
        if (map.current) {
          map.current.setCenter(currentCenter);
          map.current.setZoom(currentZoom);
          
          // Restore marker if exists
          if (selectedLocation && marker.current) {
            marker.current.setLngLat([selectedLocation.lng, selectedLocation.lat]);
          }
          
          setIsChangingStyle(false);
        }
      });
    }
  }, [isColorfulMap, isChangingStyle, selectedLocation]);

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

  // Fetch autocomplete suggestions
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Don't fetch suggestions if we're in the middle of selecting one
    if (isSelectingSuggestionRef.current) {
      return;
    }

    const fetchSuggestions = async () => {
      setIsLoadingSuggestions(true);
      try {
        const geocodingUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${mapboxToken}&limit=5&autocomplete=true&country=gb&proximity=-0.1276,51.5074`;
        const response = await fetch(geocodingUrl);
        const data = await response.json();
        if (data.features && data.features.length > 0) {
          setSuggestions(data.features.map((feature: any) => ({
            place_name: feature.place_name,
            center: feature.center
          })));
          // Only show suggestions if we're not selecting one
          if (!isSelectingSuggestionRef.current) {
            setShowSuggestions(true);
          }
        } else {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      } catch (error) {
        console.error('Suggestions error:', error);
        setSuggestions([]);
      } finally {
        setIsLoadingSuggestions(false);
      }
    };

    // Debounce the search
    const timeoutId = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, mapboxToken]);

  // Handle suggestion selection
  const handleSuggestionSelect = (suggestion: { place_name: string; center: [number, number] }) => {
    const [lng, lat] = suggestion.center;
    // Set flag to prevent onChange and useEffect from showing suggestions
    isSelectingSuggestionRef.current = true;
    // Clear suggestions and hide dropdown immediately
    setSuggestions([]);
    setShowSuggestions(false);
    setSelectedLocation({ lat, lng, address: cleanAddress(suggestion.place_name) });
    
    // Blur the input to remove focus and ensure suggestions stay hidden
    if (searchInputRef.current) {
      searchInputRef.current.blur();
    }
    
    // Update search query - the flag will prevent useEffect from showing suggestions
    setSearchQuery(suggestion.place_name);
    
    // Reset flag after enough time for all state updates to complete
    setTimeout(() => {
      isSelectingSuggestionRef.current = false;
    }, 500);
    
    // Fly to location with higher zoom for better property detail
    if (map.current) {
      map.current.flyTo({
        center: [lng, lat],
        zoom: 18,
        duration: 800
      });
    }
  };

  // Search handling
  const handleSearch = async () => {
    if (!searchQuery.trim() || !map.current) return;
    setIsSearching(true);
    setShowSuggestions(false);
    try {
      const geocodingUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${mapboxToken}&limit=1&country=gb&proximity=-0.1276,51.5074`;
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

      // Add team member access
      if (teamMemberEmails.length > 0) {
        const accessPromises = teamMemberEmails.map(async (email) => {
          try {
            await backendApi.addPropertyAccess(newPropertyId, email, 'viewer');
          } catch (error) {
            console.error(`Failed to add access for ${email}:`, error);
            // Continue even if some emails fail
          }
        });
        await Promise.all(accessPromises);
      }

      // Show success animation first
      setIsCreating(false);
      setIsSuccess(true);

      // Wait for animation to complete before closing
      setTimeout(() => {
        if (onPropertyCreated) {
          onPropertyCreated(newPropertyId, {
            ...createResponse.data,
            title: propertyTitle,
            property_title: propertyTitle
          });
        }
        onClose();
      }, 1200); // Animation duration + slight pause

    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create property');
      setIsCreating(false);
    }
  }, [selectedLocation, uploadedFiles, propertyTitle, teamMemberEmails, onPropertyCreated, onClose]);

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

  // Handle address removal
  const handleAddressRemove = useCallback(() => {
    setSelectedLocation(null);
    setSearchQuery('');
  }, []);

  // Handle team member addition
  const handleAddTeamMember = useCallback(() => {
    const email = teamMemberEmailInput.trim().toLowerCase();
    if (email && !teamMemberEmails.includes(email)) {
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(email)) {
        setTeamMemberEmails(prev => [...prev, email]);
        setTeamMemberEmailInput('');
      }
    }
  }, [teamMemberEmailInput, teamMemberEmails]);

  // Handle team member removal
  const handleRemoveTeamMember = useCallback((email: string) => {
    setTeamMemberEmails(prev => prev.filter(e => e !== email));
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

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
          backgroundColor: '#F1F1F1' 
        }}
      >
        {/* Content */}
        <div className="absolute inset-0" style={{ top: 0 }}>
          {/* Close Button - Top Right Corner */}
          <button
            onClick={handleCancel}
            className="absolute transition-all duration-200 flex items-center justify-center z-50"
            style={{
              top: '20px',
              right: '20px',
              width: '36px',
              height: '36px',
              borderRadius: '0',
              backgroundColor: '#FFFFFF',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
              border: 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#F7F7F8';
              e.currentTarget.style.transform = 'scale(1.05)';
              e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#FFFFFF';
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.04)';
            }}
          >
            <X className="w-4 h-4 text-[#6B6B6B]" strokeWidth={2} />
          </button>
          
          {/* Location Selection - Two Column Layout */}
          <div className="w-full h-full flex" style={{ backgroundColor: '#F1F1F1' }}>
              {/* Left Column: Map with Overlay Search Bar */}
              <div className="relative" style={{ width: '68%', height: '100%' }}>
                {/* Map Container */}
                <div ref={mapContainer} className="absolute inset-0" style={{ width: '100%', height: '100%' }}>
                  {!mapboxToken && (
                    <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: '#f5f5f5' }}>
                      <p style={{ fontSize: '14px', color: '#a1a1a1' }}>Map not configured</p>
                    </div>
                  )}
                  
                  {/* Hidden Preview Map Containers for Thumbnails */}
                  <div
                    ref={previewMapContainer}
                    style={{
                      position: 'absolute',
                      width: '64px',
                      height: '64px',
                      left: '-10000px',
                      top: '-10000px',
                      visibility: 'hidden',
                      pointerEvents: 'none',
                    }}
                  />
                  <div
                    ref={defaultPreviewContainer}
                    style={{
                      position: 'absolute',
                      width: '64px',
                      height: '64px',
                      left: '-10000px',
                      top: '-10000px',
                      visibility: 'hidden',
                      pointerEvents: 'none',
                    }}
                  />
                  <div
                    ref={lightPreviewContainer}
                    style={{
                      position: 'absolute',
                      width: '64px',
                      height: '64px',
                      left: '-10000px',
                      top: '-10000px',
                      visibility: 'hidden',
                      pointerEvents: 'none',
                    }}
                  />
                  
                  {/* Map Style Toggle Button - Google Maps Style */}
                  <div
                    className="absolute"
                    style={{
                      right: '20px',
                      top: '20px',
                      zIndex: 60,
                    }}
                  >
                    <motion.button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // Clicking toggles the map style
                        toggleMapStyle();
                      }}
                      disabled={isChangingStyle}
                      className="flex flex-col overflow-hidden transition-all duration-200"
                      style={{
                        width: '40px',
                        height: '40px',
                        backgroundColor: '#FFFFFF',
                        border: 'none',
                        borderRadius: '8px',
                        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.04)',
                        cursor: isChangingStyle ? 'not-allowed' : 'pointer',
                        padding: 0,
                        pointerEvents: 'auto',
                      }}
                      whileHover={!isChangingStyle ? {
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.16), 0 0 0 1px rgba(0, 0, 0, 0.06)',
                      } : {}}
                      title={isChangingStyle ? "Changing style..." : "Map type"}
                    >
                      {/* Map preview button */}
                      <div
                        className="w-full h-full relative"
                        style={{ borderRadius: '8px', overflow: 'hidden' }}
                      >
                        {isChangingStyle ? (
                          <div className="w-full h-full flex items-center justify-center bg-gray-50">
                            <motion.div
                              animate={{ rotate: 360 }}
                              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            >
                              <Loader2 className="w-5 h-5 text-gray-500" />
                            </motion.div>
                          </div>
                        ) : (isColorfulMap ? lightPreviewUrl : defaultPreviewUrl) ? (
                          <img
                            src={isColorfulMap ? lightPreviewUrl! : defaultPreviewUrl!}
                            alt="Map preview"
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-100">
                            <Layers className="w-5 h-5 text-gray-400" strokeWidth={1.5} />
                          </div>
                        )}
                      </div>
                    </motion.button>
                  </div>
                </div>
                
                {/* Search Bar - Top Left Corner (Google Maps Style) */}
                <div 
                  className="absolute"
                  style={{ 
                    top: '16px',
                    left: '32px',
                    zIndex: 50,
                    pointerEvents: 'none',
                    width: 'clamp(300px, 40vw, 500px)',
                  }}
                >
                  {/* Search Bar Container - Completely Independent, Fixed Size */}
                  <div 
                    ref={searchContainerRef}
                    className="relative"
                    style={{
                      width: '100%',
                      pointerEvents: 'auto',
                      // Fixed height to prevent any movement
                      height: '48px',
                      minHeight: '48px',
                      maxHeight: '48px',
                    }}
                  >
                    {/* Search Bar - Fixed, Never Moves */}
                    <div 
                      className="relative flex items-center"
                      style={{
                        background: '#FFFFFF',
                        border: '1px solid rgba(82, 101, 128, 0.35)',
                        // Add a subtle divider line when suggestions are visible
                        borderBottom: showSuggestions && suggestions.length > 0 
                          ? '1px solid rgba(229, 229, 229, 1)' // Subtle divider line
                          : undefined,
                        // Remove bottom shadow when suggestions are visible
                        boxShadow: showSuggestions && suggestions.length > 0
                          ? '0 0 0 rgba(0, 0, 0, 0)' // No shadow when suggestions visible
                          : '0 2px 8px rgba(0, 0, 0, 0.15), 0 1px 2px rgba(0, 0, 0, 0.1)',
                        borderRadius: showSuggestions && suggestions.length > 0 ? '24px 24px 0 0' : '24px',
                        padding: '12px 16px',
                        width: '100%',
                        height: '100%',
                        boxSizing: 'border-box',
                        zIndex: 52,
                        // Prevent any transitions or animations that could cause movement
                        transition: 'none',
                        transform: 'translateZ(0)', // Force GPU acceleration, prevent reflows
                        willChange: 'auto',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        isolation: 'isolate', // Create new stacking context
                      }}
                    >
                      <Search className="w-4 h-4 text-gray-400 flex-shrink-0" strokeWidth={2} style={{ marginRight: '12px' }} />
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          // Only show suggestions if we're not in the middle of selecting one
                          if (!isSelectingSuggestionRef.current) {
                            setShowSuggestions(true);
                          }
                        }}
                        onFocus={() => {
                          setIsInputFocused(true);
                          if (suggestions.length > 0) {
                            setShowSuggestions(true);
                          }
                        }}
                        onBlur={() => {
                          setIsInputFocused(false);
                          // Hide suggestions immediately on blur (no delay needed since we handle clicks with onMouseDown)
                          setShowSuggestions(false);
                        }}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleSearch();
                          }
                        }}
                        placeholder="Search address..."
                        className="flex-1 bg-transparent focus:outline-none text-sm font-normal text-gray-900 placeholder:text-gray-500"
                        style={{
                          padding: '0',
                          fontSize: '14px',
                          lineHeight: '20px',
                          color: '#1a1a1a',
                          border: 'none',
                          outline: 'none',
                          minWidth: '0',
                          // Completely prevent any transitions or animations
                          transition: 'none',
                          animation: 'none',
                          transform: 'translateZ(0)', // Force GPU layer, prevent reflows
                          willChange: 'auto',
                          position: 'relative',
                          top: 0,
                          left: 0,
                          margin: 0,
                          verticalAlign: 'baseline',
                        }}
                      />
                      {isLoadingSuggestions && (
                        <div className="flex-shrink-0 ml-2">
                          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                        </div>
                      )}
                      {searchQuery && !isLoadingSuggestions && (
                        <button
                          onClick={handleSearch}
                          disabled={isSearching}
                          className="flex-shrink-0 disabled:opacity-50 ml-2"
                          style={{
                            padding: '6px',
                            backgroundColor: 'transparent',
                            color: '#1a1a1a',
                            borderRadius: '50%',
                            width: '32px',
                            height: '32px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'none', // Remove transition
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = '#f5f5f5';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }}
                        >
                          {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" strokeWidth={2} />}
                        </button>
                      )}
                    </div>

                    {/* Suggestions Dropdown - Positioned to Touch Search Bar */}
                    {showSuggestions && suggestions.length > 0 && (
                      <div 
                        className="absolute"
                        style={{
                          top: '48px', // Position at exact height of search bar container
                          left: 0,
                          right: 0,
                          width: '100%',
                          background: '#FFFFFF',
                          backgroundColor: '#FFFFFF', // Ensure solid white, no transparency
                          border: '1px solid rgba(82, 101, 128, 0.35)',
                          borderTop: 'none',
                          borderRadius: '0 0 24px 24px',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15), 0 2px 4px rgba(0, 0, 0, 0.1)',
                          maxHeight: '400px',
                          overflowY: 'auto',
                          zIndex: 51,
                          pointerEvents: 'auto',
                          marginTop: 0, // No gap - directly touching
                          // Remove any gradient/backdrop effects
                          backdropFilter: 'none',
                          WebkitBackdropFilter: 'none',
                          opacity: 1, // Ensure full opacity
                        }}
                      >
                      {suggestions.map((suggestion, index) => (
                        <button
                          key={index}
                          onMouseDown={(e) => {
                            e.preventDefault(); // Prevent input blur from firing
                            e.stopPropagation(); // Stop event propagation
                            handleSuggestionSelect(suggestion);
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleSuggestionSelect(suggestion);
                          }}
                          className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
                          style={{
                            fontSize: '14px',
                            color: '#1a1a1a',
                            lineHeight: '1.4',
                          }}
                        >
                          <div className="flex items-start gap-3">
                            <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
                            <span>{suggestion.place_name}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                </div>
              </div>

              {/* Right Column: Address + Project Name + Attachments */}
              <div 
                className="flex flex-col custom-scrollbar relative" 
                style={{ 
                  width: '32%', 
                  height: '100%', 
                  backgroundColor: '#F1F1F1',
                  overflowY: 'auto',
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgba(0, 0, 0, 0.2) transparent',
                  padding: '12px',
                }}
              >
                <style>{`
                  .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                  }
                  .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                  }
                  .custom-scrollbar::-webkit-scrollbar-thumb {
                    background-color: rgba(0, 0, 0, 0.2);
                    border-radius: 3px;
                  }
                  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background-color: rgba(0, 0, 0, 0.3);
                  }
                `}</style>
                  {/* Success Overlay Animation */}
                  <AnimatePresence>
                    {isSuccess && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 flex flex-col items-center justify-center z-10"
                        style={{ 
                          backgroundColor: 'rgba(241, 241, 241, 0.98)',
                          borderRadius: '0',
                        }}
                      >
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ 
                            type: 'spring', 
                            damping: 15, 
                            stiffness: 300,
                            delay: 0.1 
                          }}
                          style={{
                            width: '80px',
                            height: '80px',
                            borderRadius: '50%',
                            backgroundColor: 'rgba(16, 163, 127, 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ 
                              type: 'spring', 
                              damping: 12, 
                              stiffness: 400,
                              delay: 0.2 
                            }}
                          >
                            <Check className="w-10 h-10 text-[#10A37F]" strokeWidth={2.5} />
                          </motion.div>
                        </motion.div>
                        <motion.p
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.35 }}
                          style={{ 
                            fontSize: '18px', 
                            fontWeight: 600, 
                            color: '#1A1A1A', 
                            marginTop: '20px',
                            letterSpacing: '-0.02em',
                          }}
                        >
                          Project created!
                        </motion.p>
                        <motion.p
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.45 }}
                          style={{ 
                            fontSize: '14px', 
                            color: '#6B6B6B', 
                            marginTop: '8px',
                          }}
                        >
                          Taking you there now...
                        </motion.p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Address Display as Removable Pill */}
                  {selectedLocation && (
                    <div style={{ marginBottom: '16px' }}>
                      <div
                        className="inline-flex items-center gap-2 relative transition-all duration-200"
                        style={{
                          padding: '8px 14px',
                          backgroundColor: '#F7F7F8',
                          border: 'none',
                          borderRadius: '0',
                          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                          fontSize: '12px',
                          color: '#1a1a1a',
                          lineHeight: '1.4',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'translateY(-1px)';
                          e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.08)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05)';
                        }}
                      >
                        <MapPin className="w-4 h-4 text-[#10A37F] flex-shrink-0" strokeWidth={1.5} />
                        <span style={{ maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {selectedLocation.address}
                        </span>
                        <button
                          onClick={handleAddressRemove}
                          className="flex items-center justify-center flex-shrink-0 ml-1 transition-all duration-150"
                          style={{
                            width: '18px',
                            height: '18px',
                            borderRadius: '50%',
                            backgroundColor: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                            marginLeft: '4px',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                            const icon = e.currentTarget.querySelector('svg');
                            if (icon) icon.style.color = '#EF4444';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            const icon = e.currentTarget.querySelector('svg');
                            if (icon) icon.style.color = '#9CA3AF';
                          }}
                        >
                          <X className="w-3 h-3 text-[#9CA3AF] transition-colors duration-150" strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Project name input */}
                  <div style={{ marginBottom: '16px' }}>
                    <p style={{ fontSize: '12px', color: '#1A1A1A', marginBottom: '8px', fontWeight: 600, letterSpacing: '-0.02em' }}>
                      Project name
                    </p>
                    <div className="relative">
                      <input
                        type="text"
                        value={propertyTitle}
                        onChange={(e) => setPropertyTitle(e.target.value)}
                        onFocus={(e) => {
                          setIsInputFocused(true);
                          e.currentTarget.style.borderColor = '#10A37F';
                          e.currentTarget.style.boxShadow = '0 0 0 2px rgba(16, 163, 127, 0.15)';
                        }}
                        onBlur={(e) => {
                          setIsInputFocused(false);
                          e.currentTarget.style.borderColor = '#E9E9EB';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                        onMouseEnter={(e) => {
                          if (document.activeElement !== e.currentTarget) {
                            e.currentTarget.style.borderColor = '#D1D1D1';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (document.activeElement !== e.currentTarget) {
                            e.currentTarget.style.borderColor = '#E9E9EB';
                          }
                        }}
                        className="w-full transition-all duration-150 focus:outline-none"
                        style={{
                          padding: '8px 10px',
                          fontSize: '12px',
                          fontWeight: 400,
                          color: '#1a1a1a',
                          backgroundColor: '#ffffff',
                          border: '1px solid #E9E9EB',
                          borderRadius: '0',
                          letterSpacing: '-0.01em',
                        }}
                        placeholder={!isInputFocused ? displayedPlaceholder : ''}
                      />
                      <style>{`
                        input::placeholder {
                          color: #6B6B6B;
                        }
                      `}</style>
                    </div>
                  </div>

                  {/* Files section */}
                  <div style={{ marginBottom: '16px' }}>
                    <p style={{ fontSize: '12px', color: '#1A1A1A', marginBottom: '8px', fontWeight: 600, letterSpacing: '-0.02em' }}>
                      Attachments
                    </p>
                    
                    {/* Upload input field style */}
                    <div
                      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                      onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className="cursor-pointer transition-all duration-200 relative"
                      style={{
                        padding: '16px 12px',
                        borderRadius: '0',
                        backgroundColor: isDragOver ? 'rgba(16, 163, 127, 0.04)' : '#F9F9F9',
                        border: isDragOver ? '2px dashed #10A37F' : '2px dashed #E9E9EB',
                        boxShadow: isDragOver ? '0 0 0 4px rgba(16, 163, 127, 0.08)' : 'none',
                        marginBottom: uploadedFiles.length > 0 ? '12px' : '0',
                        minHeight: '120px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      onMouseEnter={(e) => {
                        if (!isDragOver) {
                          e.currentTarget.style.borderColor = '#10A37F';
                          e.currentTarget.style.backgroundColor = 'rgba(16, 163, 127, 0.04)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isDragOver) {
                          e.currentTarget.style.borderColor = '#E9E9EB';
                          e.currentTarget.style.backgroundColor = '#F9F9F9';
                        }
                      }}
                    >
                      <div className="flex flex-col items-center" style={{ gap: '10px' }}>
                        <Upload className="w-6 h-6 text-[#9CA3AF] flex-shrink-0" strokeWidth={1.5} />
                        <span style={{ fontSize: '12px', color: '#6B6B6B', fontWeight: 400, letterSpacing: '-0.01em' }}>
                          Drop files here or <span style={{ color: '#10A37F', fontWeight: 500 }}>browse</span>
                        </span>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                    </div>

                    {/* File List - Pill-based display */}
                    {uploadedFiles.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {uploadedFiles.map((uploadedFile) => {
                          const isImage = uploadedFile.file.type.startsWith('image/');
                          const isPDF = uploadedFile.file.type === 'application/pdf' || 
                                      uploadedFile.file.type === 'application/x-pdf' ||
                                      uploadedFile.file.name.toLowerCase().endsWith('.pdf');
                          
                          return (
                            <div
                              key={uploadedFile.id}
                              className="inline-flex items-center gap-2 relative transition-all duration-200"
                              style={{
                                padding: '8px 14px',
                                height: '36px',
                                backgroundColor: '#F7F7F8',
                                border: 'none',
                                borderRadius: '0',
                                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                                fontSize: '12px',
                                color: '#1a1a1a',
                                lineHeight: '1.4',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-1px)';
                                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.08)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.04)';
                              }}
                            >
                              {/* File icon/thumbnail */}
                              <div className="flex-shrink-0" style={{ width: '18px', height: '18px' }}>
                                {isImage && uploadedFile.file.type.startsWith('image/') ? (
                                  <img
                                    src={URL.createObjectURL(uploadedFile.file)}
                                    alt={uploadedFile.file.name}
                                    style={{
                                      width: '18px',
                                      height: '18px',
                                      objectFit: 'cover',
                                      borderRadius: '4px',
                                    }}
                                  />
                                ) : uploadedFile.thumbnailUrl ? (
                                  <img
                                    src={uploadedFile.thumbnailUrl}
                                    alt={uploadedFile.file.name}
                                    style={{
                                      width: '18px',
                                      height: '18px',
                                      objectFit: 'cover',
                                      borderRadius: '4px',
                                    }}
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                    }}
                                  />
                                ) : (
                                  <FileText className="w-4 h-4 text-[#6B6B6B]" strokeWidth={1.5} />
                                )}
                              </div>
                              
                              {/* Filename */}
                              <span 
                                style={{ 
                                  maxWidth: '150px', 
                                  overflow: 'hidden', 
                                  textOverflow: 'ellipsis', 
                                  whiteSpace: 'nowrap' 
                                }}
                              >
                                {uploadedFile.file.name}
                              </span>
                              
                              {/* Upload progress indicator */}
                              {uploadedFile.uploadStatus === 'uploading' && (
                                <div className="flex-shrink-0">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#10A37F]" />
                                </div>
                              )}
                              
                              {/* Remove button */}
                              <button
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  handleFileRemove(uploadedFile.id); 
                                }}
                                className="flex items-center justify-center flex-shrink-0 ml-1 transition-all duration-150"
                                style={{
                                  width: '18px',
                                  height: '18px',
                                  borderRadius: '50%',
                                  backgroundColor: 'transparent',
                                  border: 'none',
                                  cursor: 'pointer',
                                  padding: 0,
                                  marginLeft: '4px',
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                                  const icon = e.currentTarget.querySelector('svg');
                                  if (icon) icon.style.color = '#EF4444';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = 'transparent';
                                  const icon = e.currentTarget.querySelector('svg');
                                  if (icon) icon.style.color = '#9CA3AF';
                                }}
                              >
                                <X className="w-3 h-3 text-[#9CA3AF] transition-colors duration-150" strokeWidth={2.5} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Team members section */}
                  <div style={{ marginBottom: '16px' }}>
                    <p style={{ fontSize: '12px', color: '#1A1A1A', marginBottom: '8px', fontWeight: 600, letterSpacing: '-0.02em' }}>
                      Team members
                    </p>
                    
                    {/* Email input with Add button */}
                    <div className="flex gap-2" style={{ marginBottom: teamMemberEmails.length > 0 ? '12px' : '0' }}>
                      <input
                        type="email"
                        value={teamMemberEmailInput}
                        onChange={(e) => setTeamMemberEmailInput(e.target.value)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddTeamMember();
                          }
                        }}
                        placeholder="Enter email address"
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = '#10A37F';
                          e.currentTarget.style.boxShadow = '0 0 0 2px rgba(16, 163, 127, 0.15)';
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = '#E9E9EB';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                        onMouseEnter={(e) => {
                          if (document.activeElement !== e.currentTarget) {
                            e.currentTarget.style.borderColor = '#D1D1D1';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (document.activeElement !== e.currentTarget) {
                            e.currentTarget.style.borderColor = '#E9E9EB';
                          }
                        }}
                        className="flex-1 transition-all duration-150 focus:outline-none"
                        style={{
                          padding: '8px 10px',
                          fontSize: '12px',
                          fontWeight: 400,
                          color: '#1a1a1a',
                          backgroundColor: '#ffffff',
                          border: '1px solid #E9E9EB',
                          borderRadius: '0',
                          letterSpacing: '-0.01em',
                        }}
                      />
                      <button
                        onClick={handleAddTeamMember}
                        disabled={!teamMemberEmailInput.trim()}
                        className="px-3 py-2 text-xs font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                          backgroundColor: '#F7F7F8',
                          color: '#1A1A1A',
                          border: '1px solid #E9E9EB',
                          borderRadius: '0',
                        }}
                        onMouseEnter={(e) => {
                          if (teamMemberEmailInput.trim()) {
                            e.currentTarget.style.backgroundColor = '#EFEFEF';
                            e.currentTarget.style.transform = 'translateY(-1px)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = '#F7F7F8';
                          e.currentTarget.style.transform = 'translateY(0)';
                        }}
                      >
                        Add
                      </button>
                    </div>

                    {/* Team member pills */}
                    {teamMemberEmails.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {teamMemberEmails.map((email) => (
                          <div
                            key={email}
                            className="inline-flex items-center gap-2 relative transition-all duration-200"
                            style={{
                              padding: '8px 14px',
                              height: '36px',
                              backgroundColor: '#F7F7F8',
                              border: 'none',
                              borderRadius: '0',
                              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                              fontSize: '12px',
                              color: '#1a1a1a',
                              lineHeight: '1.4',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.transform = 'translateY(-1px)';
                              e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.08)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = 'translateY(0)';
                              e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.04)';
                            }}
                          >
                            <UserPlus className="w-4 h-4 text-[#10A37F] flex-shrink-0" strokeWidth={1.5} />
                            <span style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {email}
                            </span>
                            <button
                              onClick={() => handleRemoveTeamMember(email)}
                              className="flex items-center justify-center flex-shrink-0 ml-1 transition-all duration-150"
                              style={{
                                width: '18px',
                                height: '18px',
                                borderRadius: '50%',
                                backgroundColor: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 0,
                                marginLeft: '4px',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                                const icon = e.currentTarget.querySelector('svg');
                                if (icon) icon.style.color = '#EF4444';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                const icon = e.currentTarget.querySelector('svg');
                                if (icon) icon.style.color = '#9CA3AF';
                              }}
                            >
                              <X className="w-3 h-3 text-[#9CA3AF] transition-colors duration-150" strokeWidth={2.5} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-3 items-center" style={{ marginTop: 'auto', paddingTop: '16px' }}>
                    <button
                      onClick={handleCreate}
                      disabled={!canCreate || isCreating}
                      className="flex-1 flex items-center justify-center gap-2 text-white font-medium transition-all duration-200 disabled:cursor-not-allowed"
                      style={{
                        padding: '10px 16px',
                        fontSize: '12px',
                        borderRadius: '0',
                        backgroundColor: canCreate && !isCreating ? '#10A37F' : '#E5E5E5',
                        color: canCreate && !isCreating ? '#FFFFFF' : '#9CA3AF',
                        boxShadow: canCreate && !isCreating ? '0 1px 2px rgba(0, 0, 0, 0.04)' : 'none',
                        border: 'none',
                      }}
                      onMouseEnter={(e) => {
                        if (!canCreate || isCreating) return;
                        e.currentTarget.style.backgroundColor = '#1AB98A';
                        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.08)';
                        e.currentTarget.style.transform = 'translateY(-1px)';
                      }}
                      onMouseLeave={(e) => {
                        if (!canCreate || isCreating) return;
                        e.currentTarget.style.backgroundColor = '#10A37F';
                        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.04)';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }}
                    >
                      {isCreating ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <span>Create project</span>
                          <ArrowRight className="w-4 h-4" strokeWidth={2} style={{ marginLeft: '8px' }} />
                        </>
                      )}
                    </button>
                  </div>

                  {/* Error */}
                  {error && (
                    <div 
                      className="mt-4 transition-colors duration-150"
                      style={{ 
                        fontSize: '12px', 
                        color: '#DC2626',
                        backgroundColor: '#FEF2F2',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        borderRadius: '0',
                        padding: '8px 10px',
                      }}
                    >
                      {error}
                    </div>
                  )}
              </div>
            </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

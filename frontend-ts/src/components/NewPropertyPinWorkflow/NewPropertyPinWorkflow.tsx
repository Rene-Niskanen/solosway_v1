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

interface TeamMember {
  email: string;
  accessLevel: 'viewer' | 'editor';
}

interface NewPropertyPinWorkflowProps {
  isVisible: boolean;
  onClose: () => void;
  onPropertyCreated?: (propertyId: string, propertyData: any) => void;
  sidebarWidth?: number; // Width of the sidebar (including toggle rail) in pixels
  initialCenter?: [number, number]; // Initial map center [lng, lat]
  initialZoom?: number; // Initial map zoom level
}

export const NewPropertyPinWorkflow: React.FC<NewPropertyPinWorkflowProps> = ({
  isVisible,
  onClose,
  onPropertyCreated,
  sidebarWidth = 0,
  initialCenter,
  initialZoom
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
  const [spinSpeed, setSpinSpeed] = useState(1); // Animation duration in seconds (lower = faster)
  const [showSpinner, setShowSpinner] = useState(false);
  const [isColorfulMap, setIsColorfulMap] = useState(false);
  const [isChangingStyle, setIsChangingStyle] = useState(false);
  const [defaultPreviewUrl, setDefaultPreviewUrl] = useState<string | null>(null);
  const [lightPreviewUrl, setLightPreviewUrl] = useState<string | null>(null);
  const [teamMemberEmails, setTeamMemberEmails] = useState<TeamMember[]>([]);
  const [teamMemberEmailInput, setTeamMemberEmailInput] = useState<string>('');
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const [popupScale, setPopupScale] = useState<number>(1);
  const defaultPreviewMap = useRef<mapboxgl.Map | null>(null);
  const lightPreviewMap = useRef<mapboxgl.Map | null>(null);
  const defaultPreviewContainer = useRef<HTMLDivElement>(null);
  const lightPreviewContainer = useRef<HTMLDivElement>(null);
  const popupElementRef = useRef<HTMLDivElement | null>(null);
  const popupZoomListenerRef = useRef<(() => void) | null>(null);
  const referenceZoomRef = useRef<number | null>(null);

  // Animated placeholder names - diverse UK locations
  const placeholderNames = [
    '42 Victoria Street',
    'Riverside Development',
    'The Shard Project',
    'Kings Cross Site',
    'Battersea Power Station',
    'Canary Wharf Tower',
    'Bristol Harbour Development',
    'Clifton Heights',
    'Temple Quarter',
    'Bristol City Centre',
    'Manchester Northern Quarter',
    'Birmingham Bullring',
    'Leeds City Square',
    'Edinburgh Old Town',
    'Glasgow Merchant City',
    'Cardiff Bay',
    'Liverpool Waterfront',
    'Newcastle Quayside',
    'Cambridge Science Park',
    'Oxford High Street',
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
      setPopupScale(1); // Reset scale to default
      setShowSpinner(false);
      setSpinSpeed(1);
      referenceZoomRef.current = null;
      
      // Clean up zoom listener when popup closes
      if (popupZoomListenerRef.current) {
        popupZoomListenerRef.current();
        popupZoomListenerRef.current = null;
      }
      popupElementRef.current = null;
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
        center: initialCenter || [-0.1276, 51.5074],
        zoom: initialZoom || 11,
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
  }, [isVisible, mapboxToken, initialCenter, initialZoom]);

  // Helper function to update popup scale based on zoom (same logic as PropertyTitleCard)
  const updatePopupScale = useCallback((referenceZoom: number) => {
    if (!map.current) return;
    
    const currentZoom = map.current.getZoom();
    
    // Same scaling formula as PropertyTitleCard
    // At referenceZoom, scale is 1.0 (normal size)
    // When zoomed OUT (currentZoom < referenceZoom): scale < 1.0 (popup gets smaller)
    // When zoomed IN (currentZoom > referenceZoom): scale > 1.0 (popup gets larger)
    let scale = Math.pow(2, currentZoom - referenceZoom);
    
    // Clamp scale to reasonable bounds (same as PropertyTitleCard)
    // Min: 0.05 (5% of original size) - allows popup to become very small when zoomed out far
    // Max: 2.0 (200% of original size) - prevents popup from becoming too large when zoomed in
    scale = Math.max(0.05, Math.min(2.0, scale));
    
    // Update state so framer-motion can apply the transform
    setPopupScale(scale);
  }, []);

  // Update marker when location changes
  useEffect(() => {
    if (!map.current || !selectedLocation) {
      setPopupPosition(null);
      return;
    }

    if (marker.current) {
      marker.current.remove();
    }

    const markerElement = document.createElement('div');
    markerElement.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      filter: drop-shadow(0 2px 8px rgba(0,0,0,0.3));
    `;
    markerElement.innerHTML = `
      <svg width="26" height="30" viewBox="0 0 26 30" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block;">
        <!-- White interior -->
        <path
          d="
            M3.5 12.5
            L13 5.5
            L22.5 12.5
            V26
            H3.5
            V12.5
            Z
          "
          fill="white"
        />
        <!-- Black outline -->
        <path
          d="
            M3.5 12.5
            L13 5.5
            L22.5 12.5
            V26
            H3.5
            V12.5
            Z
          "
          stroke="black"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
      </svg>
    `;

    marker.current = new mapboxgl.Marker({
      element: markerElement,
      anchor: 'center'
    })
      .setLngLat([selectedLocation.lng, selectedLocation.lat])
      .addTo(map.current);

    // Position pin lower on screen to make room for popup above
    // Offset center north (higher lat) so pin appears lower on screen relative to viewport center
    // At zoom 18, ~0.0001 degrees ≈ 11 meters ≈ 150-200 pixels
    // Moderate offset to position pin lower in viewport so popup has more space at top when many files
    const baseLatOffset = 0.00045; // ~50 meters north - positions pin slightly lower to give more space for popup
    
    const referenceZoom = 18;
    map.current.flyTo({
      center: [selectedLocation.lng, selectedLocation.lat + baseLatOffset],
      zoom: referenceZoom,
      duration: 800
    });

    // Set reference zoom for scaling and initialize scale
    referenceZoomRef.current = referenceZoom;
    updatePopupScale(referenceZoom);

    // Clean up existing zoom listener if any
    if (popupZoomListenerRef.current) {
      popupZoomListenerRef.current();
      popupZoomListenerRef.current = null;
    }

    // Set up zoom event listeners for popup scaling
    const zoomHandler = () => {
      if (referenceZoomRef.current !== null) {
        updatePopupScale(referenceZoomRef.current);
      }
    };

    const zoomEndHandler = () => {
      if (referenceZoomRef.current !== null) {
        updatePopupScale(referenceZoomRef.current);
      }
    };

    // Listen to both 'zoom' (during animation) and 'zoomend' (after animation) events
    map.current.on('zoom', zoomHandler);
    map.current.on('zoomend', zoomEndHandler);

    // Store cleanup function
    popupZoomListenerRef.current = () => {
      if (map.current) {
        map.current.off('zoom', zoomHandler);
        map.current.off('zoomend', zoomEndHandler);
      }
    };

    // Cleanup function for this effect
    return () => {
      if (popupZoomListenerRef.current) {
        popupZoomListenerRef.current();
        popupZoomListenerRef.current = null;
      }
    };
  }, [selectedLocation, updatePopupScale]);

  // Calculate pop-up position above pin
  useEffect(() => {
    if (!map.current || !selectedLocation) {
      setPopupPosition(null);
      return;
    }

    const updatePopupPosition = () => {
      if (!map.current || !selectedLocation) return;
      
      const point = map.current.project([selectedLocation.lng, selectedLocation.lat]);
      const containerRect = map.current.getContainer().getBoundingClientRect();
      
      // Use estimated width for positioning (will be adjusted based on actual content)
      // The popup uses fit-content, so we estimate based on content
      const estimatedPopupWidth = uploadedFiles.length > 0 ? 280 : 250;
      const spacing = 30; // Pin radius (10px) + gap above pin (20px) = 30px above pin center (matches PropertyTitleCard)
      
      // Calculate base position (centered above pin)
      const pinX = containerRect.left + point.x;
      const pinY = containerRect.top + point.y;
      let x = pinX;
      let y = pinY - spacing; // Popup bottom edge position (before transform)
      
      // Constrain horizontal position to keep popup on screen
      // Use estimated width for initial positioning, actual element will be measured
      const minX = estimatedPopupWidth / 2; // Left edge constraint
      const maxX = window.innerWidth - (estimatedPopupWidth / 2); // Right edge constraint
      x = Math.max(minX, Math.min(maxX, x));
      
      // If popup element exists, use its actual width for more accurate positioning
      if (popupElementRef.current) {
        const actualWidth = popupElementRef.current.offsetWidth;
        if (actualWidth > 0) {
          const actualMinX = actualWidth / 2;
          const actualMaxX = window.innerWidth - (actualWidth / 2);
          x = Math.max(actualMinX, Math.min(actualMaxX, x));
        }
      }
      
      // Constrain vertical position to keep popup on screen
      // Popup uses transform: translate(-50%, -100%), so bottom edge ends up at y
      // Minimum: popup bottom edge at top of viewport (y >= spacing)
      // Maximum: popup bottom edge at pin position (y <= pinY to stay above pin)
      const minY = spacing; // Don't go above viewport top
      const maxY = pinY; // Don't go below pin center
      y = Math.max(minY, Math.min(maxY, y));
      
      setPopupPosition({
        x,
        y
      });
    };

    // Initial position calculation
    updatePopupPosition();
    
    // Update position when map moves or zooms
    map.current.on('moveend', updatePopupPosition);
    map.current.on('zoomend', updatePopupPosition);
    map.current.on('move', updatePopupPosition);
    
    // Update position when window is resized to keep popup on screen
    const handleResize = () => {
      updatePopupPosition();
    };
    window.addEventListener('resize', handleResize);
    
    return () => {
      if (map.current) {
        map.current.off('moveend', updatePopupPosition);
        map.current.off('zoomend', updatePopupPosition);
        map.current.off('move', updatePopupPosition);
      }
      window.removeEventListener('resize', handleResize);
    };
  }, [selectedLocation, uploadedFiles.length]);

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
    
    // Only allow file upload if address is selected
    if (!selectedLocation) {
      return;
    }
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    // Upload all files simultaneously
    await Promise.allSettled(droppedFiles.map(file => handleFileAdd(file)));
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // Only allow file upload if address is selected
    if (!selectedLocation) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    
    const selectedFiles = Array.from(e.target.files || []);
    // Upload all files simultaneously
    await Promise.allSettled(selectedFiles.map(file => handleFileAdd(file)));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // When documents from this flow reach 'completed', notify sidebar/settings to refresh usage count
  const completedDocIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const docIds = uploadedFiles.filter(f => f.documentId && f.uploadStatus === 'complete').map(f => f.documentId!);
    if (docIds.length === 0) return;
    const interval = setInterval(async () => {
      for (const id of docIds) {
        if (completedDocIdsRef.current.has(id)) continue;
        try {
          const res = await backendApi.getDocumentStatus(id);
          const inner = res?.data && typeof res.data === 'object' && 'data' in res.data
            ? (res.data as { data: { status?: string } }).data
            : (res?.data as { status?: string } | undefined);
          if (inner?.status === 'completed') {
            completedDocIdsRef.current.add(id);
            window.dispatchEvent(new CustomEvent('usageShouldRefresh'));
          }
        } catch (_) {}
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [uploadedFiles]);

  // Update spin speed and visibility as suggestions arrive
  useEffect(() => {
    if (isLoadingSuggestions) {
      // Start at normal speed when loading begins
      setSpinSpeed(1);
      setShowSpinner(true);
    } else if (suggestions.length > 0) {
      // Speed up as suggestions arrive - more suggestions = faster spin
      // Speed ranges from 0.25s (very fast) to 0.6s (faster than normal)
      const speed = Math.max(0.25, 0.6 - (suggestions.length * 0.07));
      setSpinSpeed(speed);
      setShowSpinner(true);
      // Keep spinner visible briefly after suggestions arrive for interactive feel
      const timer = setTimeout(() => {
        setShowSpinner(false);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      // Reset when no suggestions
      setSpinSpeed(1);
      setShowSpinner(false);
    }
  }, [isLoadingSuggestions, suggestions.length]);

  // Fetch autocomplete suggestions
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      setSpinSpeed(1);
      setShowSpinner(false);
      return;
    }

    // Don't fetch suggestions if we're in the middle of selecting one
    if (isSelectingSuggestionRef.current) {
      return;
    }

    const fetchSuggestions = async () => {
      setIsLoadingSuggestions(true);
      setSpinSpeed(1); // Start at normal speed
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
    // Offset center north to position pin lower on screen
    if (map.current) {
      const baseLatOffset = 0.00045; // ~50 meters north - positions pin slightly lower to give more space for popup
      map.current.flyTo({
        center: [lng, lat + baseLatOffset],
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

  // Clear search input
  const handleClear = useCallback(() => {
    setSearchQuery('');
    setSuggestions([]);
    setShowSuggestions(false);
    setShowSpinner(false);
    setSpinSpeed(1);
    // Focus the input after clearing
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  // Create property
  const handleCreate = useCallback(async () => {
    if (!selectedLocation) {
      setError('Please select a location');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      // Step 1: Fetch current user to get name for client_name
      const authResult = await backendApi.checkAuth();
      if (!authResult.success || !authResult.data?.user) {
        throw new Error('Failed to get user information');
      }

      const user = authResult.data.user;
      // Extract user's name: prefer first_name + last_name, fallback to email prefix
      let clientName = 'User';
      if (user.first_name) {
        clientName = user.first_name + (user.last_name ? ` ${user.last_name}` : '');
      } else if (user.email) {
        const emailPrefix = user.email.split('@')[0];
        clientName = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
      }

      // Step 2: Create Project record first
      const projectResponse = await backendApi.createProject({
        title: propertyTitle,
        client_name: clientName,
        status: 'active'
      });

      if (!projectResponse.success || !projectResponse.data) {
        throw new Error(projectResponse.error || 'Failed to create project');
      }

      const newProjectId = projectResponse.data.id;

      // Step 3: Create Property with project name as formatted_address
      const createResponse = await backendApi.createProperty(
        selectedLocation.address,
        { lat: selectedLocation.lat, lng: selectedLocation.lng },
        propertyTitle  // Use project name as formatted_address
      );

      if (!createResponse.success || !createResponse.data) {
        throw new Error(createResponse.error || 'Failed to create property');
      }

      const newPropertyId = (createResponse.data as any).property_id;

      // Step 4: Transform uploaded files into document format for instant display
      // This allows documents to render immediately while processing happens in background
      const instantDocuments = uploadedFiles
        .filter(f => f.documentId)
        .map(file => ({
          id: file.documentId!,
          original_filename: file.file.name,
          classification_type: 'OTHER_DOCUMENTS', // Default classification
          classification_confidence: 0.5,
          created_at: new Date().toISOString(),
          status: 'uploaded', // Will be updated to 'processing' then 'completed'
          parsed_text: undefined,
          extracted_json: undefined,
          thumbnail_url: file.thumbnailUrl, // Include thumbnail if available
          // Add processing indicator
          is_processing: true,
          processing_status: 'queued'
        }));

      // Step 4.5: Link uploaded files to property (happens in parallel)
      const linkPromises = uploadedFiles
        .filter(f => f.documentId)
        .map(file => backendApi.linkDocumentToProperty(file.documentId!, newPropertyId));
      await Promise.all(linkPromises);

      // Step 4.6: Fetch updated property hub data to include linked documents
      // Wait a brief moment for relationships to be created in database
      await new Promise(resolve => setTimeout(resolve, 500));
      
      let propertyHubData = null;
      try {
        const hubResponse = await backendApi.getPropertyHub(newPropertyId);
        if (hubResponse.success && hubResponse.data) {
          propertyHubData = hubResponse.data;
          console.log(`✅ Fetched property hub with ${propertyHubData.documents?.length || 0} documents`);
          
          // Merge instant documents with fetched documents (avoid duplicates)
          const existingDocIds = new Set((propertyHubData.documents || []).map((d: any) => d.id));
          const newDocs = instantDocuments.filter(doc => !existingDocIds.has(doc.id));
          if (newDocs.length > 0) {
            propertyHubData.documents = [...(propertyHubData.documents || []), ...newDocs];
            console.log(`✅ Added ${newDocs.length} instant documents to property hub`);
          }
        } else {
          // If fetch fails, use instant documents only
          propertyHubData = {
            documents: instantDocuments,
            property: createResponse.data?.property || {},
            property_details: {}
          };
          console.log(`✅ Using instant documents only (${instantDocuments.length} documents)`);
        }
      } catch (error) {
        console.warn('⚠️ Failed to fetch property hub data, using instant documents:', error);
        // Use instant documents as fallback
        propertyHubData = {
          documents: instantDocuments,
          property: createResponse.data?.property || {},
          property_details: {}
        };
      }

      // Step 5: Add team member access to property (existing logic)
      if (teamMemberEmails.length > 0) {
        const propertyAccessPromises = teamMemberEmails.map(async (member) => {
          try {
            await backendApi.addPropertyAccess(newPropertyId, member.email, member.accessLevel);
          } catch (error) {
            console.error(`Failed to add property access for ${member.email}:`, error);
            // Continue even if some emails fail
          }
        });
        await Promise.all(propertyAccessPromises);

        // Step 6: Add team member access to project (new)
        const projectAccessPromises = teamMemberEmails.map(async (member) => {
          try {
            await backendApi.addProjectAccess(newProjectId, member.email, member.accessLevel);
          } catch (error) {
            console.error(`Failed to add project access for ${member.email}:`, error);
            // Continue even if some emails fail
          }
        });
        await Promise.all(projectAccessPromises);
      }

      // Show success animation first
      setIsCreating(false);
      setIsSuccess(true);

      // Step 7: Cache documents for instant rendering in PropertyDetailsPanel
      if (propertyHubData?.documents && propertyHubData.documents.length > 0) {
        if (!(window as any).__preloadedPropertyFiles) {
          (window as any).__preloadedPropertyFiles = {};
        }
        (window as any).__preloadedPropertyFiles[newPropertyId] = propertyHubData.documents;
        console.log(`✅ Cached ${propertyHubData.documents.length} documents for instant rendering`);
      }

      // Wait for animation to complete before closing
      setTimeout(() => {
        if (onPropertyCreated) {
          // Include property hub data with documents if available
          const propertyData: any = {
            ...createResponse.data,
            project_id: newProjectId,
            project_title: propertyTitle,
            title: propertyTitle,
            property_title: propertyTitle
          };
          
          // Add property hub data if we fetched it
          if (propertyHubData) {
            propertyData.propertyHub = propertyHubData;
            // Also set document count for immediate display
            propertyData.documentCount = propertyHubData.documents?.length || 0;
            propertyData.document_count = propertyHubData.documents?.length || 0;
          }
          
          onPropertyCreated(newPropertyId, propertyData);
        }
        onClose();
      }, 1200); // Animation duration + slight pause

    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create project and property');
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
    if (email && !teamMemberEmails.some(member => member.email === email)) {
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(email)) {
        setTeamMemberEmails(prev => [...prev, { email, accessLevel: 'viewer' }]);
        setTeamMemberEmailInput('');
      }
    }
  }, [teamMemberEmailInput, teamMemberEmails]);

  // Handle team member removal
  const handleRemoveTeamMember = useCallback((email: string) => {
    setTeamMemberEmails(prev => prev.filter(member => member.email !== email));
  }, []);

  // Handle access level change
  const handleAccessLevelChange = useCallback((email: string, accessLevel: 'viewer' | 'editor') => {
    setTeamMemberEmails(prev => prev.map(member => 
      member.email === email ? { ...member, accessLevel } : member
    ));
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const canCreate = selectedLocation !== null && uploadedFiles.length > 0 && propertyTitle.trim().length > 0 && !isCreating;

  if (!isVisible) return null;

  // Calculate left offset and width based on sidebar
  const leftOffset = sidebarWidth;
  const contentWidth = `calc(100vw - ${leftOffset}px)`;

  return (
    <>
      <style>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        /* Remove blue outline from map container and canvas */
        .mapboxgl-canvas,
        .mapboxgl-canvas-container,
        .mapboxgl-map {
          outline: none !important;
          border: none !important;
        }
        .mapboxgl-canvas:focus,
        .mapboxgl-canvas-container:focus,
        .mapboxgl-map:focus {
          outline: none !important;
          border: none !important;
        }
        /* Style select dropdown options */
        select option {
          padding-left: 12px !important;
          padding-right: 8px !important;
        }
      `}</style>
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
          {/* Location Selection - Full Width Map */}
          <div className="w-full h-full relative" style={{ backgroundColor: '#F1F1F1', outline: 'none', border: 'none' }}>
              {/* Map Container - Full Width */}
              <div className="relative" style={{ width: '100%', height: '100%', outline: 'none', border: 'none' }}>
                {/* Map Container */}
                <div ref={mapContainer} className="absolute inset-0" style={{ width: '100%', height: '100%', outline: 'none', border: 'none' }}>
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
                  {/* Only show button when at least one preview is ready */}
                  {(defaultPreviewUrl || lightPreviewUrl) && (
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
                          width: '48px',
                          height: '48px',
                          backgroundColor: '#FFFFFF',
                          border: '1px solid rgba(82, 101, 128, 0.35)',
                          borderRadius: '6px',
                          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.55), 0 1px 2px rgba(0, 0, 0, 0.08)',
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
                          style={{ borderRadius: '6px', overflow: 'hidden' }}
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
                  )}
                </div>
                
                {/* Search Bar - Top Left Corner (Google Maps Style) */}
                <div 
                  className="absolute"
                  style={{ 
                    top: '24px',
                    left: '48px',
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
                        background: '#FCFCFC',
                        border: '1px solid rgba(82, 101, 128, 0.35)',
                        // Add a subtle divider line when suggestions are visible
                        borderBottom: showSuggestions && suggestions.length > 0 
                          ? '1px solid rgba(229, 229, 229, 1)' // Subtle divider line
                          : undefined,
                        // Remove bottom shadow when suggestions are visible
                        boxShadow: showSuggestions && suggestions.length > 0
                          ? '0 0 0 rgba(0, 0, 0, 0)' // No shadow when suggestions visible
                          : '0 2px 8px rgba(0, 0, 0, 0.15), 0 1px 2px rgba(0, 0, 0, 0.1)',
                        borderRadius: showSuggestions && suggestions.length > 0 ? '6px 6px 0 0' : '6px',
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
                      {showSpinner && (
                        <div className="flex-shrink-0 ml-2">
                          <Loader2 
                            className="w-4 h-4 text-gray-400" 
                            style={{
                              animation: `spin ${spinSpeed}s linear infinite`,
                            }}
                          />
                        </div>
                      )}
                      {searchQuery && !showSpinner && (
                        <button
                          onClick={handleClear}
                          className="flex-shrink-0 ml-2"
                          style={{
                            padding: '4px',
                            backgroundColor: 'transparent',
                            color: '#6B6B6B',
                            borderRadius: '50%',
                            width: '24px',
                            height: '24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'none',
                            border: 'none',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = '#f5f5f5';
                            e.currentTarget.style.color = '#1a1a1a';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                            e.currentTarget.style.color = '#6B6B6B';
                          }}
                          title="Clear search"
                        >
                          <X className="w-3.5 h-3.5" strokeWidth={2} />
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
                          background: '#FCFCFC',
                          backgroundColor: '#FCFCFC', // Ensure solid color, no transparency
                          border: '1px solid rgba(82, 101, 128, 0.35)',
                          borderTop: 'none',
                          borderRadius: '0 0 6px 6px',
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
                            fontSize: '13px',
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

              {/* Pop-up Above Pin - Only shows when address is selected */}
              {selectedLocation && popupPosition && (
                <AnimatePresence>
                  <div
                    className="fixed z-[100]"
                    style={{
                      left: `${popupPosition.x}px`,
                      top: `${popupPosition.y}px`, // Position already calculated with spacing (30px) in updatePopupPosition
                      transform: 'translate(-50%, -100%)',
                      pointerEvents: 'none'
                    }}
                  >
                    <motion.div
                      ref={popupElementRef}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0, scale: popupScale }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ scale: { duration: 0 } }}
                      className="bg-white shadow-lg"
                      style={{
                        width: 'fit-content',
                        minWidth: uploadedFiles.length > 0 ? '280px' : '200px',
                        maxWidth: uploadedFiles.length > 0 ? '350px' : '280px',
                        padding: uploadedFiles.length > 0 ? '20px' : '10px',
                        pointerEvents: 'auto',
                        transformOrigin: 'center bottom',
                        backgroundColor: '#FFFFFF',
                        borderRadius: uploadedFiles.length > 0 ? '8px' : '16px'
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                    {/* Success Overlay Animation */}
                    <AnimatePresence>
                      {isSuccess && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-white rounded-lg"
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

                    {/* Files section - Always visible when pin is placed */}
                    <div style={{ marginBottom: uploadedFiles.length > 0 ? '16px' : '0' }}>
                      {/* Drag and Drop Upload Area - Matching FilingSidebar design */}
                      <div
                        onDragOver={(e) => { 
                          e.preventDefault(); 
                          setIsDragOver(true); 
                        }}
                        onDragLeave={(e) => { 
                          e.preventDefault(); 
                          setIsDragOver(false); 
                        }}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`relative cursor-pointer transition-all duration-200 ${
                          isDragOver ? 'opacity-90' : ''
                        } ${uploadedFiles.length > 0 ? 'mb-0' : 'mb-0'}`}
                      >
                        <div
                          className={`w-full flex flex-col items-center justify-center transition-all duration-200 relative ${
                            isDragOver ? 'opacity-90' : ''
                          } ${uploadedFiles.length > 0 ? 'bg-white p-4' : ''}`}
                          style={{ 
                            backgroundColor: uploadedFiles.length > 0 ? '#F7F7F9' : 'transparent',
                            padding: uploadedFiles.length > 0 ? '8px 16px 4px 16px' : '0',
                            borderRadius: uploadedFiles.length > 0 ? '8px 8px 0 0' : '0',
                            border: uploadedFiles.length > 0 ? '1px solid #E5E7EB' : 'none',
                            borderBottom: uploadedFiles.length > 0 ? 'none' : 'none'
                          }}
                        >
                          {/* Document Icon - Matching FilingSidebar */}
                          <div className={`flex items-center justify-center ${uploadedFiles.length > 0 ? 'mb-2' : ''}`} style={{ width: '100%', overflow: 'visible' }}>
                            <img 
                              src="/DocumentUpload2.png" 
                              alt="Upload files" 
                              className="object-contain"
                              style={{ 
                                width: uploadedFiles.length > 0 ? '180px' : '556px',
                                height: 'auto',
                                maxWidth: uploadedFiles.length > 0 ? '180px' : '228px',
                                borderRadius: '8px',
                                border: 'none',
                                boxShadow: 'none'
                              }}
                            />
                          </div>

                          {/* Text Overlay on Image - Only when no files uploaded */}
                          {uploadedFiles.length === 0 && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ padding: '8px 16px', transform: 'translateY(75px)' }}>
                              <div className="flex flex-col items-center justify-center pointer-events-auto">
                                {/* Instructional Text */}
                                <p className="text-sm text-gray-600 text-center mb-0.5">
                                  Drop files here or{' '}
                                  <button
                                    type="button"
                                    className="text-gray-600 hover:text-gray-700 underline underline-offset-2 transition-colors"
                                    style={{ textDecorationThickness: '0.5px', textUnderlineOffset: '2px' }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      fileInputRef.current?.click();
                                    }}
                                  >
                                    browse
                                  </button>
                                </p>

                                {/* Supported Formats */}
                                <p className="text-xs text-gray-400 mt-0.5">PDF, Word, Excel, CSV</p>
                              </div>
                            </div>
                          )}

                          {/* Text Overlay on Image - When files are uploaded */}
                          {uploadedFiles.length > 0 && (
                            <div className="absolute inset-0 flex flex-col items-center justify-end pointer-events-none" style={{ padding: '8px 16px 4px 16px', transform: 'translateY(-25px)' }}>
                              <div className="flex flex-col items-center justify-center pointer-events-auto">
                                <p className="text-sm text-gray-600 text-center mb-0.5">
                                  Drop files here or{' '}
                                  <button
                                    type="button"
                                    className="text-gray-600 hover:text-gray-700 underline underline-offset-2 transition-colors"
                                    style={{ textDecorationThickness: '0.5px', textUnderlineOffset: '2px' }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      fileInputRef.current?.click();
                                    }}
                                  >
                                    browse
                                  </button>
                                </p>
                                <p className="text-xs text-gray-400 mt-0">PDF, Word, Excel, CSV</p>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Hidden File Input */}
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept=".xlsx,.xls,.csv,.pdf,.doc,.docx"
                          onChange={handleFileSelect}
                          className="hidden"
                        />
                      </div>

                      {/* Files List - Vertical layout matching FilingSidebar */}
                      {uploadedFiles.length > 0 && (
                        <div className="mb-4">
                          <style>{`
                            .file-list-scrollable::-webkit-scrollbar {
                              display: none; /* Chrome, Safari, Opera */
                            }
                            .file-list-scrollable {
                              scrollbar-width: none; /* Firefox */
                              -ms-overflow-style: none; /* IE and Edge */
                            }
                          `}</style>
                          <div 
                            className="file-list-scrollable bg-gray-50 border border-gray-200 border-t-0 rounded-b-lg p-2 space-y-1"
                            style={{
                              maxHeight: uploadedFiles.length > 4 ? '200px' : 'none',
                              overflowY: uploadedFiles.length > 4 ? 'auto' : 'visible',
                              overflowX: 'hidden'
                            }}
                          >
                            {uploadedFiles.map((uploadedFile, index) => {
                                // Get file icon based on extension
                                const getFileIcon = () => {
                                  const filename = uploadedFile.file.name.toLowerCase();
                                  if (filename.endsWith('.pdf')) {
                                    return <img src="/PDF.png" alt="PDF" className="w-4 h-4 object-contain" />;
                                  } else if (filename.endsWith('.doc') || filename.endsWith('.docx')) {
                                    return <FileText className="w-4 h-4 text-blue-600" />;
                                  } else if (filename.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
                                    return <FileText className="w-4 h-4 text-green-600" />;
                                  }
                                  return <FileText className="w-4 h-4 text-gray-600" />;
                                };
                                
                                return (
                                  <motion.div
                                    key={uploadedFile.id}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0, transition: { duration: 0 } }}
                                    transition={{ 
                                      duration: 0.4,
                                      delay: index * 0.04,
                                      ease: [0.25, 0.46, 0.45, 0.94]
                                    }}
                                    className="flex items-center gap-2.5 px-3 py-2 bg-white border border-gray-200/60 hover:border-gray-300/80 rounded-lg transition-all duration-200 group"
                                  >
                                    <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                                      {getFileIcon()}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-xs font-normal text-gray-900 truncate" style={{ fontFamily: 'system-ui, -apple-system, sans-serif', letterSpacing: '-0.01em' }}>
                                        {uploadedFile.file.name}
                                      </div>
                                    </div>
                                    {/* Upload progress indicator */}
                                    {uploadedFile.uploadStatus === 'uploading' && (
                                      <div className="flex-shrink-0">
                                        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                                      </div>
                                    )}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleFileRemove(uploadedFile.id);
                                      }}
                                      className="p-0.5 hover:bg-gray-100 rounded flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-150"
                                      title="Remove file"
                                    >
                                      <X className="w-3 h-3 text-gray-400" strokeWidth={1.5} />
                                    </button>
                                  </motion.div>
                                );
                              })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Property name input - Only show after files are selected */}
                    {uploadedFiles.length > 0 && (
                      <div style={{ marginBottom: '12px' }}>
                        <label className="block mb-1.5" style={{ fontSize: '13px', color: '#63748A', fontWeight: 500, letterSpacing: '-0.01em' }}>
                          Project name
                        </label>
                        <div className="relative">
                          <input
                            type="text"
                            value={propertyTitle}
                            onChange={(e) => setPropertyTitle(e.target.value)}
                            onFocus={(e) => {
                              setIsInputFocused(true);
                              e.currentTarget.style.borderColor = '#415C85';
                              e.currentTarget.style.boxShadow = '0 0 0 2px rgba(65, 92, 133, 0.1)';
                            }}
                            onBlur={(e) => {
                              setIsInputFocused(false);
                              e.currentTarget.style.borderColor = '#E9E9EB';
                              e.currentTarget.style.boxShadow = 'none';
                            }}
                            className="w-full transition-all duration-150 focus:outline-none"
                            style={{
                              padding: '8px 10px',
                              fontSize: '14px',
                              fontWeight: 400,
                              color: '#63748A',
                              backgroundColor: '#ffffff',
                              border: '1px solid #E9E9EB',
                              borderRadius: '2px',
                              letterSpacing: '-0.01em',
                              lineHeight: '1.4',
                            }}
                            placeholder={!isInputFocused ? displayedPlaceholder : ''}
                          />
                          <style>{`
                            input::placeholder {
                              color: #6C7180;
                              font-weight: 400;
                            }
                          `}</style>
                        </div>
                      </div>
                    )}

                    {/* Team members section - Only show after files are added */}
                    {uploadedFiles.length > 0 && (
                      <div style={{ marginBottom: '12px' }}>
                        <label className="block mb-1.5" style={{ fontSize: '13px', color: '#63748A', fontWeight: 500, letterSpacing: '-0.01em' }}>
                          Team members
                        </label>
                        
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
                              e.currentTarget.style.borderColor = '#415C85';
                              e.currentTarget.style.boxShadow = '0 0 0 2px rgba(65, 92, 133, 0.1)';
                            }}
                            onBlur={(e) => {
                              e.currentTarget.style.borderColor = '#E9E9EB';
                              e.currentTarget.style.boxShadow = 'none';
                            }}
                            className="flex-1 transition-all duration-150 focus:outline-none"
                            style={{
                              padding: '8px 10px',
                              fontSize: '14px',
                              fontWeight: 400,
                              color: '#63748A',
                              backgroundColor: '#ffffff',
                              border: '1px solid #E9E9EB',
                              borderRadius: '4px',
                              letterSpacing: '-0.01em',
                              lineHeight: '1.4',
                            }}
                          />
                          <button
                            onClick={handleAddTeamMember}
                            disabled={!teamMemberEmailInput.trim()}
                            className="px-4 py-2 bg-[#F3F4F6] hover:bg-[#F0F6FF] text-[#415C85] text-sm font-medium transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#F3F4F6]"
                            style={{ borderRadius: '4px' }}
                          >
                            Add
                          </button>
                        </div>

                        {/* Team member pills */}
                        {teamMemberEmails.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {teamMemberEmails.map((member) => (
                              <div
                                key={member.email}
                                className="inline-flex items-center gap-1.5 px-2 py-1 bg-[#F9F9F9] hover:bg-[#F3F4F6] border border-[#E9E9EB] transition-colors duration-150 group"
                                style={{
                                  fontSize: '13px',
                                  color: '#63748A',
                                  lineHeight: '1.4',
                                  borderRadius: '4px',
                                }}
                              >
                                <UserPlus className="w-3 h-3 text-[#6C7180] flex-shrink-0" strokeWidth={1.5} />
                                <span 
                                  style={{ 
                                    maxWidth: '150px', 
                                    overflow: 'hidden', 
                                    textOverflow: 'ellipsis', 
                                    whiteSpace: 'nowrap',
                                    fontWeight: 400
                                  }}
                                >
                                  {member.email}
                                </span>
                                <select
                                  value={member.accessLevel}
                                  onChange={(e) => handleAccessLevelChange(member.email, e.target.value as 'viewer' | 'editor')}
                                  onClick={(e) => e.stopPropagation()}
                                  onFocus={(e) => e.target.style.outline = 'none'}
                                  onBlur={(e) => e.target.style.outline = 'none'}
                                  className="flex-shrink-0 text-xs bg-white border border-[#E9E9EB] rounded py-0.5 text-[#63748A] transition-colors duration-150"
                                  style={{
                                    fontSize: '11px',
                                    minWidth: '70px',
                                    paddingLeft: '6px',
                                    paddingRight: '20px',
                                    cursor: 'pointer',
                                    outline: 'none',
                                    boxShadow: 'none',
                                  }}
                                >
                                  <option value="viewer" style={{ paddingLeft: '8px', paddingRight: '8px' }}>Viewer</option>
                                  <option value="editor" style={{ paddingLeft: '8px', paddingRight: '4px' }}>Editor</option>
                                </select>
                                <button
                                  onClick={() => handleRemoveTeamMember(member.email)}
                                  className="flex items-center justify-center flex-shrink-0 ml-1 p-0.5 hover:bg-[#F3F4F6] transition-colors duration-150 opacity-0 group-hover:opacity-100"
                                  style={{ borderRadius: '2px' }}
                                  title="Remove"
                                >
                                  <X className="w-2.5 h-2.5 text-[#6C7180]" strokeWidth={2} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action buttons - Only show after project is named */}
                    {uploadedFiles.length > 0 && propertyTitle.trim() && (
                      <div className="flex gap-3 items-center" style={{ marginTop: 'auto', paddingTop: '16px' }}>
                        <button
                          onClick={handleCreate}
                          disabled={!canCreate || isCreating}
                          className={`flex-1 flex items-center justify-center gap-2 text-sm font-normal rounded transition-colors disabled:cursor-not-allowed ${
                            canCreate && !isCreating 
                              ? 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300' 
                              : 'bg-gray-50 text-gray-400 border border-gray-200'
                          }`}
                          style={{
                            padding: '10px 16px',
                            boxShadow: 'none',
                          }}
                        >
                          {isCreating ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <span>Create project</span>
                              <ArrowRight className="w-4 h-4" strokeWidth={2} style={{ marginLeft: '6px' }} />
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {/* Error */}
                    {error && (
                      <div 
                        className="mt-4 transition-colors duration-150"
                        style={{ 
                          fontSize: '12px', 
                          color: '#DC2626',
                          backgroundColor: '#FEF2F2',
                          border: '1px solid rgba(239, 68, 68, 0.2)',
                          borderRadius: '4px',
                          padding: '8px 10px',
                        }}
                      >
                        {error}
                      </div>
                    )}
                    </motion.div>
                  </div>
                </AnimatePresence>
              )}
            </div>
        </div>
      </motion.div>
    </AnimatePresence>
    </>
  );
};

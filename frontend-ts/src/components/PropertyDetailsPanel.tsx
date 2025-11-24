"use client";

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { File, X, Upload, FileText, MapPin, Home, Ruler, DollarSign, Bed, Bath, Sofa, Car, Star, Image as ImageIcon, Globe, Trash2 } from 'lucide-react';
import { useBackendApi } from './BackendApi';
import { backendApi } from '../services/backendApi';
import { usePreview } from '../contexts/PreviewContext';
import { FileAttachmentData } from './FileAttachment';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { usePropertySelection } from '../contexts/PropertySelectionContext';
import { PropertyData } from './PropertyResultsDisplay';

interface PropertyDetailsPanelProps {
  property: any;
  isVisible: boolean;
  onClose: () => void;
  onPropertySelect?: (property: PropertyData) => void;
}

interface Document {
  id: string;
  original_filename: string;
  classification_type: string;
  classification_confidence: number;
  created_at: string;
  updated_at?: string;
  status: string;
  parsed_text?: string;
  extracted_json?: string;
}

export const PropertyDetailsPanel: React.FC<PropertyDetailsPanelProps> = ({
  property,
  isVisible,
  onClose,
  onPropertySelect
}) => {
  const backendApiContext = useBackendApi();
  const { isSelectionModeActive, addPropertyAttachment, propertyAttachments } = usePropertySelection();
  
  // Check if this property is already selected
  const currentPropertyId = property?.id?.toString() || property?.property_id?.toString();
  const isPropertySelected = propertyAttachments.some(
    p => (p.propertyId?.toString() || p.propertyId) === currentPropertyId?.toString()
  );
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const [isFilesModalOpen, setIsFilesModalOpen] = useState(false);
  const [filesSearchQuery, setFilesSearchQuery] = useState<string>(''); // Search query for filtering documents
  const [selectedCardIndex, setSelectedCardIndex] = useState<number | null>(null); // Track which card is expanded
  const [hoveredCardIndex, setHoveredCardIndex] = useState<number | null>(null); // Track hover state for wave effect
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadProgressRef = useRef<number>(0); // Track progress to prevent backward jumps
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showContributorsPopup, setShowContributorsPopup] = useState(false);
  const contributorsPopupRef = useRef<HTMLDivElement>(null);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 });
  const [contributors, setContributors] = useState<Array<{ name: string; image?: string; initials: string; role: string; date?: string }>>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isDraggingToDelete, setIsDraggingToDelete] = useState(false);
  const [draggedDocumentId, setDraggedDocumentId] = useState<string | null>(null);
  // Store original pin coordinates (user-set location) - don't let backend data override them
  const originalPinCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  
  // Helper function to save property to recent projects (only when user actually interacts)
  const saveToRecentProjects = React.useCallback((propertyToSave: any) => {
    if (!propertyToSave || !propertyToSave.id || !propertyToSave.address) {
      return;
    }
    
    // Only save real properties (not temp ones)
    if (propertyToSave.id.startsWith('temp-')) {
      return;
    }
    
    // Calculate document count using the same logic as PropertyDetailsPanel display
    // Priority: 1. documents.length, 2. propertyHub?.documents?.length, 3. documentCount/document_count
    let docCount = 0;
    if (documents.length > 0) {
      docCount = documents.length;
    } else if (propertyToSave.propertyHub?.documents?.length) {
      docCount = propertyToSave.propertyHub.documents.length;
    } else if (propertyToSave.documentCount) {
      docCount = propertyToSave.documentCount;
    } else if (propertyToSave.document_count) {
      docCount = propertyToSave.document_count;
    }
    
    // CRITICAL: Save property pin location (user-set final coordinates from Create Property Card), not document-extracted coordinates
    // This is where the user placed/confirmed the pin. Only use coordinates if geocoding_status === 'manual'
    const geocodingStatus = propertyToSave.geocoding_status;
    const isPinLocation = geocodingStatus === 'manual';
    const pinLatitude = isPinLocation ? (propertyToSave.latitude || originalPinCoordsRef.current?.lat) : originalPinCoordsRef.current?.lat;
    const pinLongitude = isPinLocation ? (propertyToSave.longitude || originalPinCoordsRef.current?.lng) : originalPinCoordsRef.current?.lng;
    
    const lastProperty = {
      id: propertyToSave.id,
      address: propertyToSave.address,
      latitude: pinLatitude, // Property pin location (user-set), not document-extracted coordinates
      longitude: pinLongitude, // Property pin location (user-set), not document-extracted coordinates
      primary_image_url: propertyToSave.primary_image_url || propertyToSave.image,
      documentCount: docCount,
      timestamp: new Date().toISOString()
    };
    
    localStorage.setItem('lastInteractedProperty', JSON.stringify(lastProperty));
    // Dispatch custom event to update RecentProjectsSection in the same tab
    window.dispatchEvent(new CustomEvent('lastPropertyUpdated'));
    console.log('💾 Saved property to recent projects after interaction:', lastProperty.address, `(${docCount} docs)`);
  }, [documents.length]);
  
  // State for cached property card data
  // OPTIMIZATION: Initialize from cache synchronously on mount for instant display
  const [cachedPropertyData, setCachedPropertyData] = useState<any>(() => {
    // Synchronously check cache when component initializes - no useEffect delay
    if (property && property.id) {
      try {
        const cacheKey = `propertyCardCache_${property.id}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const cacheData = JSON.parse(cached);
          const CACHE_MAX_AGE = 30 * 60 * 1000; // 30 minutes
          const cacheAge = Date.now() - cacheData.timestamp;
          
          if (cacheAge < CACHE_MAX_AGE && cacheData.data) {
            console.log('✅ INSTANT: PropertyDetailsPanel initialized with cached data (synchronous)');
            return cacheData.data;
          }
        }
      } catch (e) {
        console.warn('Failed to read cache on init:', e);
      }
    }
    return null;
  });
  const [isLoadingCardData, setIsLoadingCardData] = useState(false);
  
  // Use cached property data if available, otherwise use property prop
  // This must be declared after cachedPropertyData state
  const displayProperty = cachedPropertyData || property;
  
  // Fetch current user data - non-blocking
  useEffect(() => {
    const fetchCurrentUser = async () => {
      try {
        const authResult = await backendApi.checkAuth();
        if (authResult.success && authResult.data?.user) {
          setCurrentUser(authResult.data.user);
        }
      } catch (error) {
        console.error('Error fetching current user:', error);
      }
    };
    fetchCurrentUser();
  }, []);
  
  // Use shared preview context
  const { addPreviewFile, setIsPreviewOpen, setPreviewFiles, setActivePreviewTabIndex } = usePreview();
  
  // Track viewport size for responsive sizing
  const [viewportSize, setViewportSize] = useState(() => {
    if (typeof window !== 'undefined') {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return { width: 1024, height: 768 };
  });
  
  useEffect(() => {
    const handleResize = () => {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  
  // Calculate search bar height - approximately 80-100px including padding
  // Search bar is positioned at bottom: 20px, so we need to account for that plus its height
  const SEARCH_BAR_HEIGHT = 80; // Approximate height of search bar
  const SEARCH_BAR_BOTTOM_PADDING = 20; // Bottom padding from MainContent
  const SEARCH_BAR_TOTAL_SPACE = SEARCH_BAR_HEIGHT + SEARCH_BAR_BOTTOM_PADDING + 20; // Extra 20px for spacing
  
  // Calculate yield and letting info early for height calculation
  const calculateYield = () => {
    if (displayProperty.rentPcm && (displayProperty.soldPrice || displayProperty.askingPrice)) {
      const annualRent = displayProperty.rentPcm * 12;
      const price = displayProperty.soldPrice || displayProperty.askingPrice;
      if (price > 0) {
        return ((annualRent / price) * 100).toFixed(1);
      }
    }
    return null;
  };
  
  const formatLettingDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      const month = date.toLocaleDateString('en-GB', { month: 'short' });
      const year = date.getFullYear();
      return `${month} ${year}`;
    } catch {
      return 'Unknown';
    }
  };
  
  const getLettingInfo = () => {
    if (displayProperty.transaction_date && displayProperty.rentPcm > 0) {
      const date = formatLettingDate(displayProperty.transaction_date);
      return `Let (AST ${date})`;
    }
    return null;
  };
  
  const yieldPercentage = calculateYield();
  const lettingInfo = getLettingInfo();
  
  // Calculate responsive panel dimensions
  const panelWidth = Math.min(420, Math.max(280, viewportSize.width * 0.35)); // 35% of viewport, min 280px, max 420px
  const panelMaxHeight = Math.max(400, viewportSize.height - SEARCH_BAR_TOTAL_SPACE - 20); // Account for search bar + spacing, min 400px
  
  // Calculate default height for collapsed state (when "View more" is not clicked)
  // This should fit all content without scrolling: image, title, collapsed summary (3 lines), property details, rental info, buttons
  // More accurate calculation:
  const imageHeight = panelWidth * (10 / 16); // 16:10 aspect ratio
  const titleHeight = 24 + 12; // Title (text-lg) + margin-bottom (mb-3)
  const collapsedSummaryHeight = 60; // Approximately 3 lines of text (line-clamp-3) + "View more" button
  const titleSummaryPadding = 20 + 16; // px-5 pt-5 pb-4 = 20px top, 16px bottom
  const propertyDetailsHeight = 120; // Property details section with icons (3 rows typically)
  const propertyDetailsPadding = 14; // space-y-3.5 = 14px between rows
  const rentalInfoHeight = displayProperty.rentPcm > 0 || lettingInfo ? 60 : 0; // Rental section if present
  const rentalInfoPadding = 20 + 20; // pt-5 mt-5 mb-5 = 20px top, 20px bottom
  const buttonsHeight = 48 + 16; // Buttons (py-1.5 = 12px) + padding (pt-3 pb-4 = 12px + 16px)
  const borderHeight = 1; // Border above buttons
  
  // Calculate total collapsed height
  const collapsedContentHeight = imageHeight + 
                                 titleSummaryPadding + 
                                 titleHeight + 
                                 collapsedSummaryHeight + 
                                 propertyDetailsPadding + 
                                 propertyDetailsHeight + 
                                 (rentalInfoHeight > 0 ? rentalInfoPadding + rentalInfoHeight : 0) + 
                                 borderHeight + 
                                 buttonsHeight;
  
  // Use the calculated collapsed height, but ensure it's reasonable (not too small, not exceeding max)
  const panelHeight = Math.max(450, Math.min(collapsedContentHeight, panelMaxHeight)); // Minimum 450px to ensure everything fits
  
  const panelBottom = SEARCH_BAR_TOTAL_SPACE; // Position at bottom, above search bar
  const panelRight = Math.max(8, Math.min(16, viewportSize.width * 0.02)); // Responsive right padding: 0.5-1rem based on viewport
  
  // Sync ref with state
  React.useEffect(() => {
    isFilesModalOpenRef.current = isFilesModalOpen;
  }, [isFilesModalOpen]);
  const [hasFilesFetched, setHasFilesFetched] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const viewFilesButtonRef = useRef<HTMLButtonElement>(null);
  const isClosingRef = useRef(false); // Track if we're in the process of closing
  const isFilesModalOpenRef = useRef(false); // Track modal state in ref to avoid race conditions

  // Load property card summary from cache or fetch from backend
  useEffect(() => {
    if (property && property.id) {
      const propertyId = property.id;
      const cacheKey = `propertyCardCache_${propertyId}`;
      
      // IMPORTANT: Store original pin coordinates BEFORE backend fetch might override them
      // These are the user-set pin location, not property data coordinates
      // Reset and store new coordinates when property changes
      if (property.latitude && property.longitude) {
        originalPinCoordsRef.current = { lat: property.latitude, lng: property.longitude };
        console.log('📍 Stored original pin coordinates for property:', propertyId, originalPinCoordsRef.current);
      } else {
        // Clear if no coordinates available
        originalPinCoordsRef.current = null;
      }
      
      // OPTIMIZATION: If we already have cached data from synchronous init, skip cache check
      // Only check cache if we don't have it yet (property changed)
      let hasValidCache = !!cachedPropertyData;
      
      if (!hasValidCache) {
        // Check cache if we don't have it from init
        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            const cacheData = JSON.parse(cached);
            const cacheAge = Date.now() - cacheData.timestamp;
            const CACHE_MAX_AGE = 30 * 60 * 1000; // OPTIMIZATION: Increased from 5 to 30 minutes
            
            if (cacheAge < CACHE_MAX_AGE) {
              // Cache is fresh - use it immediately for instant rendering
              console.log('✅ Using cached property card data (age:', Math.round(cacheAge / 1000), 's)');
              setCachedPropertyData(cacheData.data);
              hasValidCache = true;
              // Don't set loading state - data is already available
            } else {
              console.log('⚠️ Cache expired (age:', Math.round(cacheAge / 1000), 's), fetching fresh data');
            }
          }
        } catch (e) {
          console.warn('Failed to read cache:', e);
        }
      } else {
        console.log('✅ Already have cached data from synchronous init - skipping cache check');
      }
      
      // OPTIMIZATION: Only set loading state if we don't have cached data
      // Fetch fresh card summary data in background (use cache by default on backend)
      // If we have valid cache, still fetch in background to update it, but don't show loading
      if (!hasValidCache) {
        setIsLoadingCardData(true);
      }
      
      // Fetch in background - if it fails, we still have cached data (if available)
      backendApi.getPropertyCardSummary(propertyId, true) // OPTIMIZATION: Use cache by default
        .then((response) => {
          if (response.success && response.data) {
            // Transform card summary data to match property object format
            // CRITICAL: Cached property location is ALWAYS the property pin location (user-set), NEVER document-extracted coordinates
            // Only use coordinates if they represent user-set pin location (geocoding_status: 'manual')
            // These are the final coordinates selected when user clicked Create Property Card, NOT document-extracted coordinates
            const geocodingStatus = response.data.geocoding_status || property.geocoding_status;
            const isPinLocation = geocodingStatus === 'manual';
            
            // Use pin coordinates (user-set) if available, otherwise fall back only if geocoding_status is 'manual'
            const pinCoords = originalPinCoordsRef.current || 
              (isPinLocation && property.latitude && property.longitude ? { lat: property.latitude, lng: property.longitude } : null);
            
            const transformedData = {
              ...property, // Keep existing property data
              address: response.data.address || property.address,
              // Use pin location coordinates (user-set) only, never document-extracted coordinates
              latitude: pinCoords ? pinCoords.lat : (isPinLocation ? (response.data.latitude || property.latitude) : null),
              longitude: pinCoords ? pinCoords.lng : (isPinLocation ? (response.data.longitude || property.longitude) : null),
              geocoding_status: geocodingStatus, // Store geocoding_status to identify pin locations
              primary_image_url: response.data.primary_image_url,
              image: response.data.primary_image_url || property.image,
              property_type: response.data.property_type || property.property_type,
              tenure: response.data.tenure || property.tenure,
              bedrooms: response.data.number_bedrooms || property.bedrooms || 0,
              bathrooms: response.data.number_bathrooms || property.bathrooms || 0,
              epc_rating: response.data.epc_rating || property.epc_rating,
              documentCount: response.data.document_count || property.documentCount || 0,
              rentPcm: response.data.rent_pcm || property.rentPcm || 0,
              soldPrice: response.data.sold_price || property.soldPrice || 0,
              askingPrice: response.data.asking_price || property.askingPrice || 0,
              summary: response.data.summary_text || property.summary,
              notes: response.data.summary_text || property.notes,
              transaction_date: response.data.last_transaction_date || property.transaction_date,
              yield_percentage: response.data.yield_percentage || property.yield_percentage
            };
            
            // Update cached property data
            setCachedPropertyData(transformedData);
            
            // Store in localStorage cache
            try {
              localStorage.setItem(cacheKey, JSON.stringify({
                data: transformedData,
                timestamp: Date.now(),
                cacheVersion: (response as any).cache_version || 1
              }));
              console.log('✅ Stored property card data in cache');
            } catch (e) {
              console.warn('Failed to store cache:', e);
            }
          }
        })
        .catch((error) => {
          // OPTIMIZATION: If fetch fails but we have cached data, that's okay
          // Only log error if we don't have cached data to fall back on
          if (!hasValidCache) {
            console.error('Error fetching property card summary (no cache available):', error);
      } else {
            console.warn('Error fetching property card summary (using cached data):', error);
          }
        })
        .finally(() => {
          setIsLoadingCardData(false);
        });
    }
  }, [property?.id]);

  // CRITICAL: Do NOT load documents when property card opens
  // Documents should ONLY be loaded when user clicks "View Files" button
  // This ensures property card renders instantly without waiting for file API calls
  useEffect(() => {
    if (property && property.id) {
      // Always start with empty documents - files will load ONLY when "View Files" is clicked
      console.log('📄 PropertyDetailsPanel: Property changed, NOT loading files. Files will load when "View Files" is clicked:', property.id);
      setDocuments([]);
      setHasFilesFetched(false);
      setLoading(false);
    } else {
      console.log('⚠️ PropertyDetailsPanel: No property or property.id');
      setDocuments([]);
    }
  }, [property]);

  // Don't preload document blobs when property card opens - this slows down rendering
  // Blobs will be loaded on-demand when user actually previews a document
  // This significantly improves property card load time

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
      
      // Backend returns: { success: true, data: { documents: [...] } }
      // backendApi.fetchApi wraps it: { success: true, data: { success: true, data: { documents: [...] } } }
      // So we need to check response.data.data.documents
      let documentsToUse = null;
      
      // OPTIMIZATION: New lightweight endpoint returns { success: true, data: { documents: [...], document_count: N } }
      if (response && response.success && response.data) {
        // Check for new lightweight endpoint format: response.data.documents
        if (response.data.documents && Array.isArray(response.data.documents)) {
          documentsToUse = response.data.documents;
          console.log('✅ Found documents in response.data.documents (lightweight endpoint):', documentsToUse.length);
        }
        // Check for nested structure: response.data.data.documents (legacy)
        else if (response.data.data && response.data.data.documents && Array.isArray(response.data.data.documents)) {
          documentsToUse = response.data.data.documents;
          console.log('✅ Found documents in response.data.data.documents (legacy):', documentsToUse.length);
        } 
        // Check if response.data is an array (legacy)
        else if (Array.isArray(response.data)) {
          documentsToUse = response.data;
          console.log('✅ Found documents as array in response.data (legacy):', documentsToUse.length);
        }
      } else if (response && (response as any).documents && Array.isArray((response as any).documents)) {
        // Fallback: handle unwrapped format
        documentsToUse = (response as any).documents;
        console.log('✅ Found documents in response.documents (fallback):', documentsToUse.length);
      } else if (Array.isArray(response)) {
        // Fallback: handle direct array
        documentsToUse = response;
        console.log('✅ Found documents as direct array (fallback):', documentsToUse.length);
      }
      
      if (documentsToUse && documentsToUse.length > 0) {
        console.log('✅ Loaded documents:', documentsToUse.length, 'documents');
        setDocuments(documentsToUse);
        setHasFilesFetched(true);
        // Store in preloaded files for future use
        if (!(window as any).__preloadedPropertyFiles) {
          (window as any).__preloadedPropertyFiles = {};
        }
        (window as any).__preloadedPropertyFiles[property.id] = documentsToUse;
        console.log('✅ Stored documents in preloaded cache for property:', property.id);
        
        // Update recent projects with accurate document count (documents.length takes priority)
        if (property) {
          saveToRecentProjects({
            ...property,
            propertyHub: {
              ...property.propertyHub,
              documents: documentsToUse
            }
          });
        }
      } else {
        // Fallback to propertyHub documents if API returns nothing
        if (property.propertyHub?.documents && property.propertyHub.documents.length > 0) {
          console.log('📄 Using propertyHub documents as fallback:', property.propertyHub.documents.length);
          setDocuments(property.propertyHub.documents);
          setHasFilesFetched(true);
          
          // Update recent projects (propertyHub.documents takes priority when documents.length is 0)
          if (property) {
            saveToRecentProjects({
              ...property,
              propertyHub: {
                ...property.propertyHub,
                documents: property.propertyHub.documents
              }
            });
          }
        } else {
          console.log('⚠️ No documents found for property:', property.id);
          setDocuments([]);
          setHasFilesFetched(false);
          
          // Update recent projects with 0 documents
          if (property) {
            saveToRecentProjects({
              ...property,
              propertyHub: {
                ...property.propertyHub,
                documents: []
              }
            });
          }
        }
      }
    } catch (err) {
      console.error('❌ Error loading documents:', err);
      setError('Failed to load documents');
      // Fallback to propertyHub documents on error
      if (property.propertyHub?.documents && property.propertyHub.documents.length > 0) {
        console.log('📄 Using propertyHub documents as error fallback');
        setDocuments(property.propertyHub.documents);
        
        // Update recent projects (propertyHub.documents takes priority when documents.length is 0)
        if (property) {
          saveToRecentProjects({
            ...property,
            propertyHub: {
              ...property.propertyHub,
              documents: property.propertyHub.documents
            }
          });
        }
      } else {
        setDocuments([]);
        
        // Update recent projects with 0 documents
        if (property) {
          saveToRecentProjects({
            ...property,
            propertyHub: {
              ...property.propertyHub,
              documents: []
            }
          });
        }
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

  // Get primary price to display
  const getPrimaryPrice = () => {
    if (displayProperty.soldPrice > 0) {
      return `£${displayProperty.soldPrice.toLocaleString()}`;
    } else if (displayProperty.askingPrice > 0) {
      return `£${displayProperty.askingPrice.toLocaleString()}`;
    } else if (displayProperty.rentPcm > 0) {
      return `£${displayProperty.rentPcm.toLocaleString()}/month`;
    }
    return 'Price on request';
  };

  // Get property image
  const getPropertyImage = () => {
    return displayProperty.image || 
           displayProperty.primary_image_url || 
           displayProperty.propertyHub?.property_details?.primary_image_url ||
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

  // Get summary text
  const summaryText = displayProperty.summary || displayProperty.propertyHub?.property_details?.notes || displayProperty.notes;
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

  // Get property ID
  const propertyId = property?.id?.toString() || property?.property_id?.toString();
  
  // Helper functions for file handling (from PropertyFilesModal)
  const getFileTypeLabel = (type?: string, filename?: string): string => {
    if (!type && !filename) return 'FILE';
    const fileType = type?.toLowerCase() || '';
    const fileName = filename?.toLowerCase() || '';
    
    if (fileType.includes('pdf') || fileName.endsWith('.pdf')) return 'PDF';
    if (fileType.includes('word') || fileType.includes('document') || fileName.endsWith('.doc') || fileName.endsWith('.docx')) return 'DOC';
    if (fileType.includes('excel') || fileType.includes('spreadsheet') || fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) return 'XLS';
    if (fileType.startsWith('image/') || fileName.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) return 'IMG';
    if (fileType.includes('text') || fileName.endsWith('.txt')) return 'TXT';
    return 'FILE';
  };

  const formatFileName = (name: string): string => {
    // Truncate long file names
    if (name.length > 30) {
      const extension = name.split('.').pop();
      const nameWithoutExt = name.substring(0, name.lastIndexOf('.'));
      return `${nameWithoutExt.substring(0, 27)}...${extension ? '.' + extension : ''}`;
    }
    return name;
  };

  const handleDocumentClick = async (document: Document) => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
      
      // Try multiple download URL patterns
      let downloadUrl: string | null = null;
      
      // First, try if document has a direct URL
      if ((document as any).url || (document as any).download_url || (document as any).file_url || (document as any).s3_url) {
        downloadUrl = (document as any).url || (document as any).download_url || (document as any).file_url || (document as any).s3_url || null;
      } 
      // Try S3 path if available
      else if ((document as any).s3_path) {
        downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent((document as any).s3_path)}`;
      }
      // Fallback to document ID
      else {
        const docId = document.id;
        if (docId) {
          downloadUrl = `${backendUrl}/api/files/download?document_id=${docId}`;
        }
      }
      
      if (!downloadUrl) {
        throw new Error('No download URL available');
      }
      
      console.log('📄 Opening document:', document.original_filename, 'from URL:', downloadUrl);
      
      // Fetch the file
      const response = await fetch(downloadUrl, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }
      
      const blob = await response.blob();
      // Create a File object from the blob
      // @ts-ignore - File constructor is available in modern browsers
      const file = new File([blob], document.original_filename, { 
        type: (document as any).file_type || blob.type || 'application/pdf'
      });
      
      // Convert to FileAttachmentData format for DocumentPreviewModal
      const fileData: FileAttachmentData = {
        id: document.id,
        file: file,
        name: document.original_filename,
        type: (document as any).file_type || blob.type || 'application/pdf',
        size: (document as any).file_size || blob.size
      };
      
      // Use shared preview context to add file
      addPreviewFile(fileData);
    } catch (err) {
      console.error('❌ Error opening document:', err);
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
      const response = await fetch(`${backendUrl}/api/document/${documentId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to delete document: ${response.status}`);
      }

      // Remove from local state
      setDocuments(prev => {
        const updated = prev.filter(doc => doc.id !== documentId);
        
        // Save to recent projects after successful file deletion (user interaction)
        if (property) {
          saveToRecentProjects({
            ...property,
            documentCount: updated.length
          });
        }
        
        return updated;
      });
      
      // If the deleted document was selected, close the preview
      if (selectedCardIndex !== null && filteredDocuments[selectedCardIndex]?.id === documentId) {
        setSelectedCardIndex(null);
      }
    } catch (err: any) {
      console.error('Error deleting document:', err);
      alert(`Failed to delete document: ${err.message}`);
    }
  };

  const handleDocumentDragStart = (e: React.DragEvent, document: Document) => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
    
    // Set dragged document ID for deletion and show delete zone
    setDraggedDocumentId(document.id);
    setIsDraggingToDelete(true);
    
    // Try multiple download URL patterns
    let downloadUrl: string | null = null;
    
    if ((document as any).url || (document as any).download_url || (document as any).file_url || (document as any).s3_url) {
      downloadUrl = (document as any).url || (document as any).download_url || (document as any).file_url || (document as any).s3_url || null;
    } else if ((document as any).s3_path) {
      downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent((document as any).s3_path)}`;
    } else {
      downloadUrl = `${backendUrl}/api/files/download?document_id=${document.id}`;
    }
    
    // Allow both copy (for chat) and move (for delete)
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', document.original_filename);
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'property-document',
      documentId: document.id,
      filename: document.original_filename,
      fileType: (document as any).file_type || 'application/pdf',
      downloadUrl: downloadUrl
    }));
    
    (e.target as HTMLElement).style.opacity = '0.5';
  };

  const handleDocumentDragEnd = (e: React.DragEvent) => {
    (e.target as HTMLElement).style.opacity = '1';
    setIsDraggingToDelete(false);
    setDraggedDocumentId(null);
  };

  const handleDeleteZoneDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setIsDraggingToDelete(true);
  };

  const handleDeleteZoneDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingToDelete(false);
  };

  const handleDeleteZoneDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingToDelete(false);
    
    if (draggedDocumentId) {
      handleDeleteDocument(draggedDocumentId);
      setDraggedDocumentId(null);
    }
  };
  
  // Filter documents based on search query and sort by created_at (newest first for top of stack)
  const filteredDocuments = documents
    .filter(doc => {
      if (!filesSearchQuery.trim()) return true;
      const query = filesSearchQuery.toLowerCase();
      return doc.original_filename.toLowerCase().includes(query);
    })
    .sort((a, b) => {
      // Sort by created_at descending (newest first) so new files appear at top of stack
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateB - dateA;
    });

  // File upload handler
  const handleFileUpload = async (file: File) => {
    // CRITICAL: Capture property at the start to ensure we use the correct property_id
    // This prevents leakage to other properties if property changes during upload
    const currentProperty = property;
    if (!currentProperty?.id) {
      setUploadError('No property selected');
      return;
    }

    // Remember if modal was open before upload - use ref to avoid stale closure
    const wasModalOpen = isFilesModalOpenRef.current;

    // Open files modal when upload starts so user can see the file appear
    setIsFilesModalOpen(true);
    isFilesModalOpenRef.current = true;

    setUploading(true);
    setUploadError(null);
    // Reset progress to 0 and ensure it starts from 0
    setUploadProgress(0);
    uploadProgressRef.current = 0;
    console.log('🚀 Starting upload for property:', currentProperty.id, currentProperty.address);

    try {
      // CRITICAL: Always use currentProperty (captured at start) to prevent property leakage
      // Send property data so backend can create property if it doesn't exist
      const response = await backendApi.uploadPropertyDocumentViaProxy(
        file, 
        { 
          property_id: currentProperty.id,
          property_address: currentProperty.address,
          property_latitude: currentProperty.latitude,
          property_longitude: currentProperty.longitude
        },
        (percent) => {
          // Update progress in real-time - only increase, never decrease
          const currentProgress = uploadProgressRef.current;
          // Allow updates if progress increased OR if we're starting from 0
          if (percent > currentProgress || (percent === 0 && currentProgress === 0)) {
            console.log('📈 Progress callback called with:', percent, '(previous:', currentProgress, ')');
            uploadProgressRef.current = percent;
            setUploadProgress(percent);
          } else {
            console.log('📈 Progress callback ignored (would decrease or duplicate):', percent, '(current:', currentProgress, ')');
          }
        }
      );
      
      if (response.success) {
        // Get current progress from ref (most up-to-date value)
        const currentProgress = uploadProgressRef.current;
        // Upload is complete, but file hasn't appeared yet
        // Progress should be at 90% (capped during upload)
        // We'll set it to 95% to show we're processing, then 100% when file appears
        if (currentProgress < 95) {
          console.log('📊 Upload complete, setting progress to 95% (was:', currentProgress, ', waiting for file to appear)');
          uploadProgressRef.current = 95;
          setUploadProgress(95);
        } else {
          console.log('📊 Upload complete, keeping progress at:', currentProgress, '(waiting for file to appear)');
        }
        
        // CRITICAL: Reload documents for the property we uploaded to (use captured currentProperty)
        const propertyId = currentProperty.id;
        try {
          const response = await backendApi.getPropertyHubDocuments(propertyId);
          let documentsToUse = null;
          
          // Backend returns: { success: true, data: { documents: [...] } }
          // backendApi.fetchApi wraps it: { success: true, data: { success: true, data: { documents: [...] } } }
          // So we need to check response.data.data.documents
          if (response && response.success && response.data) {
            // Check for nested structure: response.data.data.documents
            if (response.data.data && response.data.data.documents && Array.isArray(response.data.data.documents)) {
              documentsToUse = response.data.data.documents;
            } 
            // Check for direct documents in response.data
            else if (response.data.documents && Array.isArray(response.data.documents)) {
              documentsToUse = response.data.documents;
            } 
            // Check if response.data is an array
            else if (Array.isArray(response.data)) {
              documentsToUse = response.data;
            }
          } else if (response && (response as any).documents && Array.isArray((response as any).documents)) {
            // Fallback: handle unwrapped format
            documentsToUse = (response as any).documents;
          } else if (Array.isArray(response)) {
            // Fallback: handle direct array
            documentsToUse = response;
          }
          
          if (documentsToUse && documentsToUse.length > 0) {
            // Store in preloaded files
            if (!(window as any).__preloadedPropertyFiles) {
              (window as any).__preloadedPropertyFiles = {};
            }
            (window as any).__preloadedPropertyFiles[propertyId] = documentsToUse;
            
            // Update documents state - this is when file appears in UI
            // Use a small delay to ensure React has rendered the file before setting to 100%
            setDocuments(documentsToUse);
            setHasFilesFetched(true);
            setUploadError(null);
            
            // Save to recent projects after successful file upload (user interaction)
            // Use currentProperty (captured at start) to ensure correct property
            if (currentProperty) {
              saveToRecentProjects({
                ...currentProperty,
                documentCount: documentsToUse.length
              });
            }
            
            // Invalidate property pins cache - new properties might have been created
            // This ensures new pins appear immediately on the map
            try {
              const pinsCacheKey = 'propertyPinsCache';
              localStorage.removeItem(pinsCacheKey);
              console.log('✅ Invalidated property pins cache after file upload (new property may have been created)');
              
              // Refetch pins in background to update the map
              backendApi.getPropertyPins()
                .then((pinsResponse) => {
                  if (pinsResponse && pinsResponse.success && Array.isArray(pinsResponse.data)) {
                    const transformedProperties = pinsResponse.data.map((pin: any) => {
                      return {
                        id: pin.id,
                        address: pin.address || '',
                        postcode: '',
                        property_type: '',
                        bedrooms: 0,
                        bathrooms: 0,
                        soldPrice: 0,
                        rentPcm: 0,
                        askingPrice: 0,
                        price: 0,
                        square_feet: 0,
                        days_on_market: 0,
                        latitude: pin.latitude,
                        longitude: pin.longitude,
                        summary: '',
                        features: '',
                        condition: 8,
                        epc_rating: '',
                        tenure: '',
                        transaction_date: '',
                        similarity: 90,
                        image: "/property-1.png",
                        agent: {
                          name: "John Bell",
                          company: "harperjamesproperty36"
                        },
                        documentCount: 0,
                        completenessScore: 0
                      };
                    });
                    
                    // Update in-memory cache
                    (window as any).__preloadedProperties = transformedProperties;
                    
                    // Update localStorage cache
                    localStorage.setItem(pinsCacheKey, JSON.stringify({
                      data: transformedProperties,
                      timestamp: Date.now()
                    }));
                    
                    console.log(`✅ Refreshed property pins cache (${transformedProperties.length} pins) - new properties will appear on map`);
                    
                    // Trigger map refresh if SquareMap is listening
                    window.dispatchEvent(new CustomEvent('propertyPinsUpdated', { 
                      detail: { pins: transformedProperties } 
                    }));
                  }
                })
                .catch((error) => {
                  console.warn('Failed to refresh pins cache after upload:', error);
                });
            } catch (e) {
              console.warn('Failed to invalidate pins cache:', e);
            }
            
            // Invalidate property card cache so it refreshes with new document count
            const cacheKey = `propertyCardCache_${propertyId}`;
            try {
              localStorage.removeItem(cacheKey);
              console.log('✅ Invalidated property card cache after file upload');
              
              // Fetch fresh card summary to update cache
              backendApi.getPropertyCardSummary(propertyId, false)
                .then((response) => {
                  if (response.success && response.data) {
                    // Transform and update cache
                    const transformedData = {
                      ...property,
                      ...response.data,
                      address: response.data.address || property.address,
                      bedrooms: response.data.number_bedrooms || property.bedrooms || 0,
                      bathrooms: response.data.number_bathrooms || property.bathrooms || 0,
                      documentCount: response.data.document_count || documentsToUse.length,
                      rentPcm: response.data.rent_pcm || property.rentPcm || 0,
                      soldPrice: response.data.sold_price || property.soldPrice || 0,
                      askingPrice: response.data.asking_price || property.askingPrice || 0,
                    };
                    setCachedPropertyData(transformedData);
                    localStorage.setItem(cacheKey, JSON.stringify({
                      data: transformedData,
                      timestamp: Date.now(),
                      cacheVersion: (response as any).cache_version || 1
                    }));
                  }
                })
                .catch((error) => {
                  console.warn('Failed to refresh cache after upload:', error);
                });
            } catch (e) {
              console.warn('Failed to invalidate cache:', e);
            }
            
            // Wait for React to render the file, then set progress to 100%
            // Use requestAnimationFrame to ensure DOM has updated
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                // Double RAF ensures React has finished rendering
                const finalProgress = uploadProgressRef.current;
                if (finalProgress < 100) {
                  console.log('📊 File rendered in UI, setting progress to 100% (was:', finalProgress, ')');
                  uploadProgressRef.current = 100;
                  setUploadProgress(100);
                } else {
                  console.log('📊 File rendered in UI, progress already at:', finalProgress);
                }
                
                // Keep modal open (we opened it at the start of upload)
              setIsFilesModalOpen(true);
                isFilesModalOpenRef.current = true;
                
                // Wait a moment to show 100%, then reset
                setTimeout(() => {
                  setUploading(false);
                  setUploadProgress(0);
                  uploadProgressRef.current = 0;
                }, 300);
              });
            });
          } else {
            // No documents found, but upload succeeded
            // Set to 100% since upload completed (even if file not found)
            const currentProgress = uploadProgressRef.current;
            if (currentProgress < 100) {
              uploadProgressRef.current = 100;
              setUploadProgress(100);
            }
            setTimeout(() => {
              setUploading(false);
              setUploadProgress(0);
              uploadProgressRef.current = 0;
            }, 300);
          }
        } catch (error) {
          console.error('Error reloading documents:', error);
          setUploadError('Upload successful but failed to reload file list');
          // Set to 100% since upload completed (even if reload failed)
          const currentProgress = uploadProgressRef.current;
          if (currentProgress < 100) {
            uploadProgressRef.current = 100;
            setUploadProgress(100);
          }
          setTimeout(() => {
            setUploading(false);
            setUploadProgress(0);
            uploadProgressRef.current = 0;
          }, 300);
        }
      } else {
        setUploadError(response.error || 'Upload failed');
        const currentProgress = uploadProgressRef.current;
        if (currentProgress < 100) {
          uploadProgressRef.current = 100;
          setUploadProgress(100);
        }
        setTimeout(() => {
          setUploading(false);
          setUploadProgress(0);
          uploadProgressRef.current = 0;
        }, 300);
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
      const currentProgress = uploadProgressRef.current;
      if (currentProgress < 100) {
        uploadProgressRef.current = 100;
        setUploadProgress(100);
      }
      setTimeout(() => {
      setUploading(false);
        setUploadProgress(0);
        uploadProgressRef.current = 0;
      }, 300);
    }
  };

  // File input change handler
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      Array.from(files).forEach(file => {
        handleFileUpload(file);
      });
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };


  // Expanded Card View Component - shows document preview within container
  const ExpandedCardView: React.FC<{
    selectedDoc: Document | undefined;
    onClose: () => void;
    onDocumentClick: (doc: Document) => void;
  }> = ({ selectedDoc, onClose, onDocumentClick }) => {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [blobType, setBlobType] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [imageError, setImageError] = useState(false);
    const createdBlobUrlRef = useRef<string | null>(null); // Track if we created this blob URL
    const isLoadingRef = useRef(false); // Prevent race conditions
    const currentDocIdRef = useRef<string | null>(null); // Track current document ID
    
    useEffect(() => {
      if (!selectedDoc) {
        setPreviewUrl(null);
        setBlobType(null);
        setLoading(false);
        setError(null);
        setImageError(false);
        createdBlobUrlRef.current = null;
        isLoadingRef.current = false;
        currentDocIdRef.current = null;
        return;
      }
      
      // If this is the same document we're already showing, don't reload
      if (currentDocIdRef.current === selectedDoc.id && previewUrl) {
        setLoading(false);
        return;
      }
      
      // Prevent multiple simultaneous loads
      if (isLoadingRef.current) {
        return;
      }
      
      // Update current doc ID
      currentDocIdRef.current = selectedDoc.id;
      
      const loadPreview = async () => {
        try {
          isLoadingRef.current = true;
          setLoading(true);
          setError(null);
          setImageError(false);
          
          // First, check for preloaded blob URL (Instagram-style preloading)
          const preloadedBlob = (window as any).__preloadedDocumentBlobs?.[selectedDoc.id];
          if (preloadedBlob && preloadedBlob.url) {
            console.log('✅ Using preloaded blob for document:', selectedDoc.id);
            setPreviewUrl(preloadedBlob.url);
            setBlobType(preloadedBlob.type);
            setLoading(false);
            isLoadingRef.current = false;
            createdBlobUrlRef.current = null; // We didn't create this one
            return;
          }
          
          // If not preloaded, fetch it now
          const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
          let downloadUrl: string | null = null;
          
          if ((selectedDoc as any).url || (selectedDoc as any).download_url || (selectedDoc as any).file_url || (selectedDoc as any).s3_url) {
            downloadUrl = (selectedDoc as any).url || (selectedDoc as any).download_url || (selectedDoc as any).file_url || (selectedDoc as any).s3_url || null;
          } else if ((selectedDoc as any).s3_path) {
            downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent((selectedDoc as any).s3_path)}`;
          } else {
            downloadUrl = `${backendUrl}/api/files/download?document_id=${selectedDoc.id}`;
          }
          
          if (!downloadUrl) {
            throw new Error('No download URL available');
          }
          
          const response = await fetch(downloadUrl, {
            credentials: 'include'
          });
          
          if (!response.ok) {
            throw new Error(`Failed to load: ${response.status}`);
          }
          
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          createdBlobUrlRef.current = url; // Track that we created this URL
          
          // Cache it for future use
          if (!(window as any).__preloadedDocumentBlobs) {
            (window as any).__preloadedDocumentBlobs = {};
          }
          (window as any).__preloadedDocumentBlobs[selectedDoc.id] = {
            url: url,
            type: blob.type,
            timestamp: Date.now()
          };
          
          setPreviewUrl(url);
          setBlobType(blob.type);
          setLoading(false);
          isLoadingRef.current = false;
        } catch (err: any) {
          console.error('Error loading preview:', err);
          setError(err.message || 'Failed to load preview');
          setLoading(false);
          isLoadingRef.current = false;
          createdBlobUrlRef.current = null;
        }
      };
      
      loadPreview();
      
      return () => {
        // Don't cleanup here - let the cleanup effect handle it
      };
    }, [selectedDoc]);
    
    // Cleanup preview URL when component unmounts or doc changes
    // Only revoke URLs that we created and aren't in the cache
    useEffect(() => {
      const currentCreatedUrl = createdBlobUrlRef.current;
      const currentDocId = selectedDoc?.id;
      
      return () => {
        // Only revoke if we created this blob URL AND it's not in the cache
        if (currentCreatedUrl && currentDocId) {
          const cachedBlob = (window as any).__preloadedDocumentBlobs?.[currentDocId];
          // Only revoke if it's not in cache (meaning it was a one-time use)
          if (!cachedBlob || cachedBlob.url !== currentCreatedUrl) {
            try {
              URL.revokeObjectURL(currentCreatedUrl);
            } catch (e) {
              // URL might already be revoked, ignore
            }
          }
        }
        createdBlobUrlRef.current = null;
      };
    }, [selectedDoc?.id]);
    
    if (!selectedDoc) return null;
    
    const fileType = (selectedDoc as any).file_type || '';
    const fileName = selectedDoc.original_filename.toLowerCase();
    
    // More robust image detection - check file_type, blob type, and filename
    const isPDF = fileType.includes('pdf') || fileName.endsWith('.pdf') || blobType?.includes('pdf');
    const isImage = 
      fileType.includes('image') || 
      blobType?.startsWith('image/') ||
      fileName.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff)$/i) ||
      fileName.includes('screenshot');
    
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={`expanded-${selectedDoc.id}`}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.3 }}
          className="absolute inset-0 bg-white flex flex-col"
          style={{ borderRadius: '0.5rem' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              onClose();
            }
          }}
        >
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 z-50 p-1.5 hover:bg-gray-100 rounded transition-colors"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
          
          {/* Preview Content Area */}
          <div className="flex-1 overflow-auto bg-white" style={{ minHeight: 0 }}>
            {loading && (
              <div className="flex items-center justify-center h-full">
                <div className="text-sm text-gray-500">Loading preview...</div>
            </div>
            )}
            {error && (
              <div className="flex items-center justify-center h-full">
                <div className="text-sm text-red-500">{error}</div>
              </div>
            )}
            {previewUrl && !loading && !error && (
              <div className="w-full h-full flex items-center justify-center p-4">
                {isPDF ? (
                  <iframe
                    src={previewUrl}
                    className="w-full h-full border-0"
                    style={{ minHeight: '400px' }}
                    title={selectedDoc.original_filename}
                  />
                ) : isImage ? (
                  <img
                    src={previewUrl}
                    alt={selectedDoc.original_filename}
                    className="max-w-full max-h-full object-contain"
                    style={{ maxHeight: '100%' }}
                    onError={(e) => {
                      console.error('Image failed to load:', selectedDoc.original_filename);
                      setImageError(true);
                    }}
                    onLoad={() => {
                      setImageError(false);
                    }}
                  />
                ) : imageError ? (
                  <div className="flex flex-col items-center justify-center h-full">
                    <FileText className="w-16 h-16 text-gray-400 mb-4" />
                    <p className="text-sm text-gray-500 mb-2">{selectedDoc.original_filename}</p>
                    <p className="text-xs text-red-500 mb-4">Failed to load image</p>
                    <button
                      onClick={() => onDocumentClick(selectedDoc)}
                      className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors text-sm"
                    >
                      Open in Preview
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full">
                    <FileText className="w-16 h-16 text-gray-400 mb-4" />
                    <p className="text-sm text-gray-500 mb-2">{selectedDoc.original_filename}</p>
                    <button
                      onClick={() => onDocumentClick(selectedDoc)}
                      className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors text-sm"
                    >
                      Open in Preview
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    );
  };

  return (
    <>
      <AnimatePresence>
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 0 }}
          transition={{ duration: 0.1 }}
          className="fixed z-[100] flex flex-col"
          style={{ 
            backgroundColor: 'transparent',
            width: `${panelWidth}px`,
            maxWidth: '420px',
            minWidth: '280px',
            maxHeight: `${panelMaxHeight}px`,
            bottom: `${panelBottom}px`,
            right: `${panelRight}px`,
            cursor: isSelectionModeActive ? 'pointer' : 'default'
          }}
          data-property-panel
          onClick={(e) => {
            if (isSelectionModeActive && property) {
              // Check if click is on a button - if so, prevent selection
              const target = e.target as HTMLElement;
              if (target.closest('button') || target.closest('a')) {
                return; // Don't select if clicking a button
              }
              
              e.stopPropagation();
              if (onPropertySelect) {
                onPropertySelect(property as PropertyData);
              } else {
                addPropertyAttachment(property as PropertyData);
              }
            }
          }}
        >
        {/* Card Container - Modern White Card - Matching database white */}
        <motion.div 
          className={`bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden border relative ${
            isPropertySelected 
              ? 'border-green-500 border-2' 
              : isSelectionModeActive 
                ? 'border-blue-500 border-2' 
                : 'border-gray-200'
          }`}
          style={{ 
            backgroundColor: '#ffffff',
            filter: 'none', // Remove any filters that might affect brightness
            opacity: 1, // Ensure full opacity
            height: `${panelHeight}px`, // Fixed height - default collapsed size, don't grow with content
            maxHeight: `${panelMaxHeight}px`, // Ensure it never exceeds max height
            borderColor: isPropertySelected
              ? '#22c55e'
              : isSelectionModeActive 
                ? '#3b82f6' 
                : '#e5e7eb',
            borderWidth: (isSelectionModeActive || isPropertySelected) ? '2px' : '1px',
            borderStyle: 'solid',
            pointerEvents: isSelectionModeActive ? 'auto' : 'auto',
          }}
          layout={false}
        >
          
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInputChange}
          />
          {/* Scrollable Content Container */}
          <div className="flex-1 relative flex flex-col" style={{ minHeight: 0, overflow: 'hidden' }}>
            {/* Files Overlay - White background covering property information */}
            <AnimatePresence>
              {isFilesModalOpen && hasFilesFetched && documents.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 bg-white z-50 flex flex-col"
                  style={{ borderRadius: '0.5rem', overflow: 'hidden' }}
                  onDragOver={(e) => {
                    if (draggedDocumentId) {
                      e.preventDefault();
                    }
                  }}
                >
                  {/* Files Header */}
                  <div className="px-4 pt-3 pb-2 border-b border-gray-200 flex-shrink-0">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-gray-900">Property Files</h3>
                      <button
                        onClick={() => setIsFilesModalOpen(false)}
                        className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                      >
                        <X className="w-4 h-4 text-gray-400" />
                      </button>
                    </div>
                    {/* Search bar */}
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Search documents..."
                        value={filesSearchQuery}
                        onChange={(e) => setFilesSearchQuery(e.target.value)}
                        className="w-full h-7 px-2.5 pr-8 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-300 focus:border-gray-300 bg-white placeholder:text-gray-400"
                      />
                      {filesSearchQuery && (
                        <button
                          onClick={() => setFilesSearchQuery('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 rounded transition-colors"
                        >
                          <X className="w-3 h-3 text-gray-400" />
                        </button>
                      )}
                      {!filesSearchQuery && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                          <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Delete Zone - Appears when dragging */}
                  {typeof document !== 'undefined' && createPortal(
                    <AnimatePresence>
                      {isDraggingToDelete && draggedDocumentId && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          className="fixed bottom-6 right-6 z-[200] bg-red-500 rounded-full p-4 shadow-2xl cursor-pointer"
                          onDragOver={handleDeleteZoneDragOver}
                          onDragLeave={handleDeleteZoneDragLeave}
                          onDrop={handleDeleteZoneDrop}
                          style={{ pointerEvents: 'auto' }}
                          whileHover={{ scale: 1.1 }}
                          transition={{ duration: 0.2 }}
                        >
                          <Trash2 className="w-8 h-8 text-white" />
                        </motion.div>
                      )}
                    </AnimatePresence>,
                    document.body
                  )}
                  
                  {/* Filing Cabinet Cards - Scrollable */}
                  <div className="flex-1 px-4 py-3 overflow-y-auto" style={{ position: 'relative', minHeight: 0 }}>
                    {filteredDocuments.length === 0 ? (
                      <div className="flex items-center justify-center" style={{ minHeight: '200px' }}>
                        <div className="text-sm text-gray-500">No documents match your search</div>
                      </div>
                    ) : selectedCardIndex !== null ? (
                      <ExpandedCardView
                        selectedDoc={filteredDocuments[selectedCardIndex]}
                        onClose={() => setSelectedCardIndex(null)}
                        onDocumentClick={handleDocumentClick}
                      />
                    ) : (
                      // Filing Cabinet Stacked Cards View - Clean Implementation
                      <div 
                        className="relative w-full"
                        style={{ 
                          minHeight: '400px',
                          // Calculate height to fit all cards: top padding + (number of cards * spacing) + bottom padding
                          // Ensure enough space so top file is always visible
                          height: `${Math.max(400, 150 + (filteredDocuments.length * 42) + 60)}px`,
                          paddingTop: '150px', // Top padding so top file has space above it
                          paddingBottom: '60px', // Bottom padding for better spacing
                          position: 'relative',
                          perspective: '500px',
                          perspectiveOrigin: 'center bottom'
                        }}
                      >
                        {/* SVG definitions for rounded trapezoid clip-paths */}
                        <svg width="0" height="0" style={{ position: 'absolute' }}>
                          <defs>
                            {filteredDocuments.map((doc) => (
                              <clipPath key={doc.id} id={`roundedTrapezoid-${doc.id}`} clipPathUnits="objectBoundingBox">
                                {/* Rounded trapezoid: narrower at top (2% to 98%), wider at bottom (5% to 95%), with 3% corner radius */}
                                <path d="M 0.02,0.03 
                                        Q 0.02,0 0.05,0 
                                        L 0.95,0 
                                        Q 0.98,0 0.98,0.03 
                                        L 0.95,0.97 
                                        Q 0.95,1 0.92,1 
                                        L 0.08,1 
                                        Q 0.05,1 0.05,0.97 
                                        Z" />
                              </clipPath>
                            ))}
                          </defs>
                        </svg>
                        {filteredDocuments.map((doc, index) => {
                          const fileType = (doc as any).file_type || '';
                          const fileName = doc.original_filename.toLowerCase();
                          const isPDF = fileType.includes('pdf');
                          const isDOC = fileType.includes('word') || fileType.includes('document') || 
                                        fileName.endsWith('.docx') || fileName.endsWith('.doc');
                          // Match tabs/chat logic: only check file_type.includes('image')
                          // Screenshots that don't have 'image' in file_type will fall through to grey Globe icon
                          const isImage = fileType.includes('image');
                          
                          // Stack cards from bottom - newest on top
                          // Position from bottom, ensuring files move down as more are added
                          const reverseIndex = filteredDocuments.length - 1 - index;
                          // Start from bottom padding (60px), and stack upward
                          // As more files are added, all files move down because the container height increases
                          const bottomPosition = 60 + (reverseIndex * 42);
                          const zIndex = index + 1;
                          const isHovered = hoveredCardIndex === index;
                          
                          return (
                            <motion.div
                              key={doc.id}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ 
                                duration: 0.3,
                                delay: index * 0.05
                              }}
                              onMouseEnter={() => setHoveredCardIndex(index)}
                              onMouseLeave={() => setHoveredCardIndex(null)}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                // If clicking the same card that's already selected, don't do anything
                                if (selectedCardIndex === index) {
                                  return;
                                }
                                setSelectedCardIndex(index);
                              }}
                              className="absolute cursor-pointer"
                              style={{
                                left: '4%',
                                width: '92%',
                                height: '140px',
                                minHeight: '140px',
                                bottom: `${bottomPosition}px`,
                                zIndex: zIndex,
                                boxSizing: 'border-box',
                                transform: `rotateX(-12deg) ${isHovered ? 'translateY(-8px)' : ''}`,
                                transformOrigin: 'center bottom',
                                transition: 'transform 0.2s ease, filter 0.2s ease',
                                filter: isHovered 
                                  ? 'drop-shadow(0 8px 16px rgba(0,0,0,0.15))' 
                                  : 'drop-shadow(0 4px 12px rgba(0,0,0,0.12))'
                              }}
                            >
                              {/* Inner card with content - drop shadow instead of outline */}
                              <div
                                className="w-full h-full"
                                draggable
                                onDragStart={(e) => handleDocumentDragStart(e, doc)}
                                onDragEnd={handleDocumentDragEnd}
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  overflow: 'hidden',
                                  width: '100%',
                                  height: '100%',
                                  clipPath: `url(#roundedTrapezoid-${doc.id})`,
                                  WebkitClipPath: `url(#roundedTrapezoid-${doc.id})`,
                                  boxSizing: 'border-box',
                                  backgroundColor: isHovered ? '#FFFEEC' : '#ffffff',
                                  transition: 'background-color 0.2s ease'
                                }}
                              >
                              {/* Title and File Type Section - Combined */}
                              <div 
                                className="pl-6 pr-6 pt-4 pb-3 border-b border-gray-200 flex items-center gap-2 flex-shrink-0"
                                style={{
                                  transform: 'translateZ(0)',
                                  WebkitFontSmoothing: 'antialiased',
                                  MozOsxFontSmoothing: 'grayscale',
                                  textRendering: 'optimizeLegibility',
                                  isolation: 'isolate'
                                }}
                              >
                                <div className={`w-4 h-4 flex-shrink-0 ${isPDF ? 'bg-red-500' : isDOC ? 'bg-blue-600' : isImage ? 'bg-gray-500' : 'bg-gray-500'} rounded flex items-center justify-center`}>
                                  {(() => {
                                    const iconStyle = { width: '10px', height: '10px', minWidth: '10px', minHeight: '10px', maxWidth: '10px', maxHeight: '10px', flexShrink: 0, color: 'white' };
                                    if (isPDF) {
                                      return <FileText className="text-white" style={iconStyle} strokeWidth={2} />;
                                    }
                                    if (isImage) {
                                      return <ImageIcon className="text-white" style={iconStyle} strokeWidth={2} />;
                                    }
                                    if (isDOC) {
                                      return <FileText className="text-white" style={iconStyle} strokeWidth={2} />;
                                    }
                                    return <Globe className="text-white" style={iconStyle} strokeWidth={2} />;
                                  })()}
                                </div>
                                <h4 
                                  className="text-sm font-medium truncate flex-1" 
                                  style={{ 
                                    fontSize: '12px',
                                    fontWeight: isHovered ? 600 : 500,
                                    color: isHovered ? '#000000' : '#1f2937',
                                    transition: 'color 0.2s ease, font-weight 0.2s ease',
                                    WebkitFontSmoothing: 'antialiased',
                                    MozOsxFontSmoothing: 'grayscale',
                                    textRendering: 'optimizeLegibility',
                                    transform: 'translateZ(0)',
                                    willChange: 'auto'
                                  }}
                                >
                                  {formatFileName(doc.original_filename)}
                                </h4>
                                <span 
                                  className="text-gray-500 flex-shrink-0" 
                                  style={{ 
                                    fontSize: '10px',
                                    lineHeight: '1.2',
                                    WebkitFontSmoothing: 'antialiased',
                                    MozOsxFontSmoothing: 'grayscale',
                                    textRendering: 'optimizeLegibility',
                                    transform: 'translateZ(0)',
                                    willChange: 'auto'
                                  }}
                                >
                                  {getFileTypeLabel((doc as any).file_type, doc.original_filename)}
                                </span>
                              </div>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            
            {/* Container 1: Image with Overlay */}
            <div style={{ contain: 'layout style', height: `${Math.round(panelHeight * 0.7)}px`, minHeight: '280px' }}>
              {/* Property Image Section - Full width, ~70% of card height, no top rounded corners */}
              <div className="relative w-full h-full overflow-hidden">
                <img
                  src={getPropertyImage()}
                        alt={displayProperty.address || 'Property'}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const img = e.target as HTMLImageElement;
                    img.src = '/property-1.png';
                  }}
                />
                
                {/* Top Gradient Blur Overlay - For Profile Picture and Close Button */}
                <div 
                  className="absolute top-0 left-0 right-0 z-20 pointer-events-none"
                  style={{
                    height: '15%',
                    minHeight: '80px',
                    background: 'linear-gradient(to bottom, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.92) 15%, rgba(255, 255, 255, 0.85) 30%, rgba(255, 255, 255, 0.7) 50%, rgba(255, 255, 255, 0.45) 70%, rgba(255, 255, 255, 0.25) 85%, rgba(255, 255, 255, 0.1) 95%, transparent 100%)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    maskImage: 'linear-gradient(to bottom, black 0%, black 70%, rgba(0, 0, 0, 0.8) 85%, rgba(0, 0, 0, 0.4) 95%, transparent 100%)',
                    WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 70%, rgba(0, 0, 0, 0.8) 85%, rgba(0, 0, 0, 0.4) 95%, transparent 100%)',
                  }}
                />
                
                {/* Profile Picture - Top Left */}
                {(() => {
                  // Get user name for profile picture
                  const userName = property.agent_name || property.owner_name || property.uploaded_by || 'Agent';
                  const userInitials = userName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
                  
                  // Try to get profile image from various sources
                  const profileImage = property.user_avatar || 
                                     property.profile_image || 
                                     property.agent_avatar ||
                                     property.propertyHub?.uploaded_by_user?.profile_image ||
                                     property.propertyHub?.uploaded_by_user?.avatar_url ||
                                     null;
                  
                  // Get contributors list from documents (people who uploaded/deleted files)
                  // This will be called on hover to get fresh data
                  
                  return (
                    <div 
                      className="absolute top-4 left-5 z-[100]" 
                      ref={contributorsPopupRef}
                      onMouseEnter={(e) => {
                        if (contributorsPopupRef.current) {
                          const rect = contributorsPopupRef.current.getBoundingClientRect();
                          setPopupPosition({
                            top: rect.top - 10, // Position above the avatar
                            left: rect.left
                          });
                        }
                        
                        // Get contributors from documents on hover
                        const getContributors = () => {
                          const contributorsList: Array<{ name: string; image?: string; initials: string; role: string; date?: string }> = [];
                          const contributorMap = new Map<string, { name: string; image?: string; initials: string; latestDate: Date }>();
                          
                          // Helper to format date
                          const formatDate = (dateString?: string) => {
                            if (!dateString) return null;
                            const date = new Date(dateString);
                            const now = new Date();
                            const diffTime = Math.abs(now.getTime() - date.getTime());
                            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                            if (diffDays === 0) return 'Today';
                            if (diffDays === 1) return '1 day ago';
                            if (diffDays < 7) return `${diffDays} days ago`;
                            if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
                            if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
                            return `${Math.floor(diffDays / 365)} years ago`;
                          };
                          
                          // Get contributors from documents
                          if (documents && documents.length > 0) {
                            documents.forEach((doc: any) => {
                              // Check for uploaded_by_user information in various formats
                              const uploadedBy = doc.uploaded_by_user || doc.uploader || doc.user;
                              let docUserName = uploadedBy?.name || uploadedBy?.full_name || uploadedBy?.username || 
                                              uploadedBy?.first_name || 
                                              doc.uploaded_by_name || doc.created_by_name || null;
                              
                              // If we have first_name and last_name, combine them
                              if (!docUserName && uploadedBy?.first_name) {
                                docUserName = uploadedBy.first_name + (uploadedBy.last_name ? ` ${uploadedBy.last_name}` : '');
                              }
                              
                              // If still no name but we have email, use email prefix
                              if (!docUserName && (uploadedBy?.email || doc.uploaded_by_email)) {
                                const email = uploadedBy?.email || doc.uploaded_by_email;
                                const emailPrefix = email.split('@')[0];
                                docUserName = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
                              }
                              
                              const docUserId = uploadedBy?.id || doc.uploaded_by_user_id || doc.uploaded_by_id;
                              const docUserEmail = uploadedBy?.email || doc.uploaded_by_email;
                              
                              // If still no name, try to use current user if document matches
                              if (!docUserName && currentUser) {
                                if (docUserId === currentUser.id || docUserEmail === currentUser.email) {
                                  docUserName = currentUser.first_name 
                                    ? `${currentUser.first_name}${currentUser.last_name ? ` ${currentUser.last_name}` : ''}`
                                    : (currentUser.email ? currentUser.email.split('@')[0].charAt(0).toUpperCase() + currentUser.email.split('@')[0].slice(1) : 'User');
                                }
                              }
                              
                              const userImage = uploadedBy?.profile_image || uploadedBy?.avatar_url || 
                                               doc.uploaded_by_avatar || doc.created_by_avatar ||
                                               (currentUser && (docUserId === currentUser.id || docUserEmail === currentUser.email) 
                                                 ? (currentUser.profile_image || currentUser.avatar_url) : null);
                              const userId = docUserId || docUserName;
                              
                              if (docUserName) {
                                // Use the most recent date: updated_at (for modifications/deletions) or created_at (for uploads)
                                const updatedDate = doc.updated_at ? new Date(doc.updated_at) : null;
                                const createdDate = doc.created_at ? new Date(doc.created_at) : null;
                                // Use the most recent date available
                                const docDate = updatedDate && createdDate 
                                  ? (updatedDate > createdDate ? updatedDate : createdDate)
                                  : (updatedDate || createdDate || new Date());
                                
                                const existing = contributorMap.get(userId);
                                
                                // Always update if this document is more recent
                                if (!existing || docDate > existing.latestDate) {
                                  contributorMap.set(userId, {
                                    name: docUserName,
                                    image: userImage,
                                    initials: docUserName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2),
                                    latestDate: docDate
                                  });
                                }
                              }
                            });
                          }
                          
                          // Also add current user if they exist and have uploaded documents
                          if (currentUser && documents && documents.length > 0) {
                            const currentUserName = currentUser.first_name 
                              ? `${currentUser.first_name}${currentUser.last_name ? ` ${currentUser.last_name}` : ''}`
                              : (currentUser.email ? currentUser.email.split('@')[0].charAt(0).toUpperCase() + currentUser.email.split('@')[0].slice(1) : 'User');
                            const currentUserImage = currentUser.profile_image || currentUser.avatar_url;
                            const currentUserId = currentUser.id || currentUser.email || currentUserName;
                            
                            // Check if current user has uploaded any documents
                            const userHasDocuments = documents.some((doc: any) => {
                              const docUserId = doc.uploaded_by_user?.id || doc.uploaded_by_user_id || 
                                               doc.uploader?.id || doc.user?.id;
                              return docUserId === currentUser.id || 
                                     doc.uploaded_by_email === currentUser.email ||
                                     (doc.uploaded_by_user?.email === currentUser.email);
                            });
                            
                            if (userHasDocuments) {
                              // Find the most recent document by current user
                              const userDocs = documents.filter((doc: any) => {
                                const docUserId = doc.uploaded_by_user?.id || doc.uploaded_by_user_id || 
                                                 doc.uploader?.id || doc.user?.id;
                                return docUserId === currentUser.id || 
                                       doc.uploaded_by_email === currentUser.email ||
                                       (doc.uploaded_by_user?.email === currentUser.email);
                              });
                              
                              if (userDocs.length > 0) {
                                const latestDoc = userDocs.reduce((latest: any, doc: any) => {
                                  const latestUpdated = latest.updated_at ? new Date(latest.updated_at) : null;
                                  const latestCreated = latest.created_at ? new Date(latest.created_at) : null;
                                  const latestDate = latestUpdated && latestCreated 
                                    ? (latestUpdated > latestCreated ? latestUpdated : latestCreated)
                                    : (latestUpdated || latestCreated || new Date(0));
                                  
                                  const docUpdated = doc.updated_at ? new Date(doc.updated_at) : null;
                                  const docCreated = doc.created_at ? new Date(doc.created_at) : null;
                                  const docDate = docUpdated && docCreated 
                                    ? (docUpdated > docCreated ? docUpdated : docCreated)
                                    : (docUpdated || docCreated || new Date(0));
                                  
                                  return docDate > latestDate ? doc : latest;
                                });
                                
                                const docUpdated = latestDoc.updated_at ? new Date(latestDoc.updated_at) : null;
                                const docCreated = latestDoc.created_at ? new Date(latestDoc.created_at) : null;
                                const docDate = docUpdated && docCreated 
                                  ? (docUpdated > docCreated ? docUpdated : docCreated)
                                  : (docUpdated || docCreated || new Date());
                                
                                const existing = contributorMap.get(currentUserId);
                                
                                if (!existing || docDate > existing.latestDate) {
                                  contributorMap.set(currentUserId, {
                                    name: currentUserName,
                                    image: currentUserImage,
                                    initials: currentUserName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2),
                                    latestDate: docDate
                                  });
                                }
                              }
                            }
                          }
                          
                          // Convert map to array with both formatted date and raw date for sorting
                          const contributorsWithDates: Array<{ name: string; image?: string; initials: string; role: string; date?: string; rawDate: Date }> = [];
                          contributorMap.forEach((contributor, userId) => {
                            contributorsWithDates.push({
                              name: contributor.name,
                              image: contributor.image,
                              initials: contributor.initials,
                              role: 'Contributor',
                              date: formatDate(contributor.latestDate.toISOString()),
                              rawDate: contributor.latestDate // Store raw date for proper sorting
                            });
                          });
                          
                          // Sort by raw date (most recent first) - use actual Date objects, not formatted strings
                          contributorsWithDates.sort((a, b) => {
                            return b.rawDate.getTime() - a.rawDate.getTime(); // Most recent first
                          });
                          
                          // Remove rawDate before returning (clean up)
                          contributorsWithDates.forEach(item => {
                            contributorsList.push({
                              name: item.name,
                              image: item.image,
                              initials: item.initials,
                              role: item.role,
                              date: item.date
                            });
                          });
                          
                          // If no document contributors, show default
                          if (contributorsList.length === 0) {
                            return [{
                              name: userName,
                              image: profileImage,
                              initials: userInitials,
                              role: 'Contributor',
                              date: formatDate(property.created_at || property.propertyHub?.created_at)
                            }];
                          }
                          
                          return contributorsList;
                        };
                        
                        const contributorsList = getContributors();
                        console.log('📊 Contributors list:', contributorsList);
                        console.log('📄 Documents count:', documents?.length);
                        console.log('📅 Current user:', currentUser);
                        setContributors(contributorsList);
                        setShowContributorsPopup(true);
                      }}
                      onMouseLeave={() => setShowContributorsPopup(false)}
                    >
                      <div className="cursor-pointer">
                        <Avatar className="w-8 h-8 ring-2 ring-white shadow-lg">
                        <AvatarImage 
                          src={profileImage || "/default profile icon.png"} 
                          alt={userName}
                          className="object-cover"
                        />
                          <AvatarFallback className="bg-gradient-to-br from-blue-400 to-purple-500 text-white text-xs font-semibold">
                          {userInitials}
                        </AvatarFallback>
                      </Avatar>
                      </div>
                    </div>
                  );
                })()}
                
                {/* Close Button - Top Right */}
                <button
                  onClick={onClose}
                  className="absolute top-3 right-3 p-1.5 hover:bg-gray-100 rounded transition-colors z-30"
                >
                  <X className="w-4 h-4 text-gray-600" />
                </button>

                {/* Property Name Overlay - Bottom of Image */}
                <div 
                  className="absolute bottom-0 left-0 right-0 px-4 py-6 z-30"
                  style={{
                    height: '25%',
                    minHeight: '100px',
                    background: 'linear-gradient(to top, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.92) 15%, rgba(255, 255, 255, 0.85) 30%, rgba(255, 255, 255, 0.7) 50%, rgba(255, 255, 255, 0.45) 70%, rgba(255, 255, 255, 0.25) 85%, rgba(255, 255, 255, 0.1) 95%, transparent 100%)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    maskImage: 'linear-gradient(to top, black 0%, black 70%, rgba(0, 0, 0, 0.8) 85%, rgba(0, 0, 0, 0.4) 95%, transparent 100%)',
                    WebkitMaskImage: 'linear-gradient(to top, black 0%, black 70%, rgba(0, 0, 0, 0.8) 85%, rgba(0, 0, 0, 0.4) 95%, transparent 100%)',
                    display: 'flex',
                    alignItems: 'flex-end',
                    paddingBottom: '1rem',
                  }}
                >
                  <div className="text-gray-700 font-medium" style={{ fontSize: '16px', fontWeight: 500, letterSpacing: '-0.01em', lineHeight: '1.4', textShadow: '0 2px 4px rgba(255, 255, 255, 0.5)', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                        {getPropertyName(displayProperty.address || 'Unknown Address')}
                      </div>
                      </div>
                    </div>

            </div>

            {/* Container 2: Additional Info and Action Buttons (below image) */}
            <div className="pb-0" style={{ position: 'relative', transform: 'translateZ(0)', contain: 'layout style paint', isolation: 'isolate' }}>
                {/* Secondary Property Details Section */}
                {(() => {
                  // Calculate document count
                  let docCount = 0;
                  if (documents.length > 0) {
                    docCount = documents.length;
                  } else if (displayProperty.propertyHub?.documents?.length) {
                    docCount = displayProperty.propertyHub.documents.length;
                  } else if (displayProperty.documentCount) {
                    docCount = displayProperty.documentCount;
                  }
                  
                  // Get property details with fallbacks
                  const epcRating = displayProperty.epc_rating || displayProperty.propertyHub?.property_details?.epc_rating;
                  const propertyType = displayProperty.property_type || displayProperty.propertyHub?.property_details?.property_type;
                  const tenure = displayProperty.tenure || displayProperty.propertyHub?.property_details?.tenure;
                  const bedrooms = displayProperty.bedrooms || displayProperty.propertyHub?.property_details?.number_bedrooms || 0;
                  const bathrooms = displayProperty.bathrooms || displayProperty.propertyHub?.property_details?.number_bathrooms || 0;
                  
                  const hasSecondaryInfo = docCount > 0 || 
                                          epcRating || 
                                          propertyType || 
                                          tenure || 
                                          bedrooms > 0 || 
                                          bathrooms > 0;
                  
                  return hasSecondaryInfo ? (
                    <div className="border-t border-gray-100 px-5 pt-4 pb-4">
                      <div className="flex flex-wrap items-center gap-4">
                        {/* Document Count */}
                        {docCount > 0 && (
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-gray-500" strokeWidth={2} />
                            <span className="text-xs text-gray-600">{docCount} Docs</span>
                          </div>
                        )}
                        
                        {/* EPC Rating */}
                        {epcRating && (
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-gray-500" strokeWidth={2} />
                            <span className="text-xs text-gray-600">EPC {epcRating}</span>
                          </div>
                        )}
                        
                        {/* Property Type */}
                        {propertyType && (
                          <div className="flex items-center gap-2">
                            <Home className="w-4 h-4 text-gray-500" strokeWidth={2} />
                            <span className="text-xs text-gray-600">{propertyType}</span>
                          </div>
                        )}
                        
                        {/* Tenure */}
                        {tenure && (
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-gray-500" strokeWidth={2} />
                            <span className="text-xs text-gray-600">{tenure}</span>
                          </div>
                        )}
                        
                        {/* Bedrooms */}
                        {bedrooms > 0 && (
                          <div className="flex items-center gap-2">
                            <Bed className="w-4 h-4 text-gray-500" strokeWidth={2} />
                            <span className="text-xs text-gray-600">{bedrooms} Bed</span>
                          </div>
                        )}
                        
                        {/* Bathrooms */}
                        {bathrooms > 0 && (
                          <div className="flex items-center gap-2">
                            <Bath className="w-4 h-4 text-gray-500" strokeWidth={2} />
                            <span className="text-xs text-gray-600">{bathrooms} Bath</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null;
                })()}

                {/* Property Summary/Description Section */}
                {summaryText && (
                  <div className="border-t border-gray-100 px-5 pt-4 pb-4">
                    {renderSummary()}
                  </div>
                )}

                {/* Additional Info (Rent, Yield, Letting) - Full Width if Present */}
                {(displayProperty.rentPcm > 0 || lettingInfo) && (
                  <div className="border-t border-gray-100 px-5" style={{ 
                    paddingTop: '20px', 
                    paddingBottom: '20px',
                    marginBottom: '0px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center'
                  }}>
                    {displayProperty.rentPcm > 0 && (
                      <div className="text-sm text-gray-700 text-center" style={{ margin: '0' }}>
                        <span className="font-medium">Rent:</span> £{displayProperty.rentPcm.toLocaleString()} pcm
                        {yieldPercentage && (
                          <span className="text-gray-500 ml-2">({yieldPercentage}% yield)</span>
                        )}
                      </div>
                    )}
                    {lettingInfo && (
                      <div className="text-sm text-gray-700 text-center" style={{ margin: '0' }}>
                        <span className="font-medium">Letting:</span> {lettingInfo}
                      </div>
                    )}
                  </div>
                )}
            </div>
          </div>
          
          {/* Upload Error Display */}
          {uploadError && (
            <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-red-700 text-sm">
              {uploadError}
            </div>
          )}
          
          {/* Action Buttons - Outside scrollable container, always visible at bottom */}
          <div className="border-t border-gray-200 flex-shrink-0 flex gap-2.5" style={{ 
            borderTopWidth: '1px', 
            borderTopColor: '#e5e7eb', 
            width: '100%', 
            paddingTop: '16px', 
            paddingBottom: '16px',
            paddingLeft: '16px',
            paddingRight: '16px',
            marginTop: '0px',
            marginBottom: '0px'
          }}>
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
                      
                      // Close any open preview modal and reset preview state
                      setIsPreviewOpen(false);
                      setPreviewFiles([]);
                      setActivePreviewTabIndex(0);
                      
              setIsFilesModalOpen(false);
                      console.log('🔴 Set isFilesModalOpen to false');
                      // Reset closing flag after a brief delay
                      setTimeout(() => {
                        isClosingRef.current = false;
                      }, 200);
                      // Don't reset hasFilesFetched - keep it true so we don't show loading animation again
                      return; // Early return to prevent any other logic from running
                    } else {
                      // Collapse the summary when opening files modal
                      setIsSummaryExpanded(false);
                      
                      // Ensure preview is closed when opening files modal
                      setIsPreviewOpen(false);
                      setPreviewFiles([]);
                      setActivePreviewTabIndex(0);
                      
                      // Check if files are preloaded before opening modal
                      const propertyId = property?.id;
                      if (!propertyId) return;
                      
                      // First check for preloaded files
                      const preloadedFiles = (window as any).__preloadedPropertyFiles?.[propertyId];
                      if (preloadedFiles && Array.isArray(preloadedFiles) && preloadedFiles.length > 0) {
                        // Files are ready - open overlay immediately
                        setDocuments(preloadedFiles);
                        setHasFilesFetched(true);
                        setIsFilesModalOpen(true);
                      } else {
                        // Files not preloaded - load them first, then open overlay
                        console.log('📄 Files not preloaded, loading documents for property:', propertyId);
                        const loadAndOpen = async () => {
                          try {
                            const response = await backendApi.getPropertyHubDocuments(propertyId);
                            console.log('📄 View Files - API response:', response);
                            
                            let documentsToUse = null;
                            // Backend returns: { success: true, data: { documents: [...] } }
                            // backendApi.fetchApi wraps it: { success: true, data: { success: true, data: { documents: [...] } } }
                            // So we need to check response.data.data.documents
                            if (response && response.success && response.data) {
                              // Check for nested structure: response.data.data.documents
                              if (response.data.data && response.data.data.documents && Array.isArray(response.data.data.documents)) {
                                documentsToUse = response.data.data.documents;
                                console.log('✅ Found documents in response.data.data.documents:', documentsToUse.length);
                              } 
                              // Check for direct documents in response.data
                              else if (response.data.documents && Array.isArray(response.data.documents)) {
                                documentsToUse = response.data.documents;
                                console.log('✅ Found documents in response.data.documents:', documentsToUse.length);
                              } 
                              // Check if response.data is an array
                              else if (Array.isArray(response.data)) {
                                documentsToUse = response.data;
                                console.log('✅ Found documents as array in response.data:', documentsToUse.length);
                              }
                            } else if (response && (response as any).documents && Array.isArray((response as any).documents)) {
                              // Fallback: handle unwrapped format
                              documentsToUse = (response as any).documents;
                              console.log('✅ Found documents in response.documents (fallback):', documentsToUse.length);
                            } else if (Array.isArray(response)) {
                              // Fallback: handle direct array
                              documentsToUse = response;
                              console.log('✅ Found documents as direct array (fallback):', documentsToUse.length);
                            }
                            
                            if (documentsToUse && documentsToUse.length > 0) {
                              // Store in preloaded files
                              if (!(window as any).__preloadedPropertyFiles) {
                                (window as any).__preloadedPropertyFiles = {};
                              }
                              (window as any).__preloadedPropertyFiles[propertyId] = documentsToUse;
                              console.log('✅ Loaded and stored documents:', documentsToUse.length, 'files');
                              
                              // Set documents and open overlay
                              setDocuments(documentsToUse);
                              setHasFilesFetched(true);
                          setIsFilesModalOpen(true);
                              console.log('✅ Files overlay opened after loading documents');
                            } else {
                              console.log('⚠️ No documents found for property:', propertyId);
                            }
                          } catch (error) {
                            console.error('❌ Error loading files before opening overlay:', error);
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
                  <span className="text-sm font-medium text-gray-700" style={{ fontSize: '13px', fontWeight: 500, lineHeight: '1.2', minWidth: '80px', textAlign: 'center' }}>
                    {isFilesModalOpen && hasFilesFetched ? 'Close Files' : 'View Files'}
                  </span>
                </button>
                
                <button
                  onClick={() => {
                    fileInputRef.current?.click();
                  }}
                  disabled={uploading}
                  className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-all duration-150 rounded-lg flex-shrink-0 relative flex-1 justify-center border border-transparent hover:border-gray-300 hover:bg-gray-100/50 disabled:cursor-not-allowed overflow-hidden ${uploading ? '' : 'disabled:opacity-50'}`}
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
                    position: 'relative',
                  }}
                >
                  {/* Progress Bar - Overlay (Frogress-inspired) */}
                  {uploading && (() => {
                    const progressPercent = Math.max(0, Math.min(100, uploadProgress));
                    return (
                      <div
                        className="absolute inset-0"
                        style={{
                          borderRadius: '0.5rem',
                          overflow: 'hidden',
                          pointerEvents: 'none',
                          zIndex: 5,
                          padding: '6px', // Padding to make progress bar thinner
                        }}
                      >
                        {/* Track - Light gray background with rounded corners */}
                        <div
                          className="absolute inset-0"
                          style={{
                            backgroundColor: '#e5e7eb',
                            borderRadius: '9999px',
                            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.1)',
                          }}
                        />
                        {/* Fill - Gradient progress bar with coherent border rounding */}
                        <div
                          className="absolute"
                          style={{
                            left: '6px',
                            top: '6px',
                            bottom: '6px',
                            right: progressPercent >= 100 ? '6px' : 'auto',
                            width: progressPercent === 0 
                              ? '0px' 
                              : progressPercent >= 100
                              ? 'calc(100% - 12px)'
                              : `calc(${progressPercent}% - ${(12 * progressPercent) / 100}px)`,
                            // Natural gradient: pink to light pink
                            background: 'linear-gradient(90deg, #fce7f3 0%, #f9d4e8 50%, #f5c1dd 100%)',
                            borderRadius: '9999px',
                            // Smooth transition for gradual progress
                            transition: 'width 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
                            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05), 0 1px 1px rgba(0,0,0,0.05)',
                            // Ensure border radius is coherent (not shrunk with width)
                            minWidth: progressPercent > 0 ? '2px' : '0px',
                          }}
                        />
                      </div>
                    );
                  })()}
                  {/* Button Content - Hidden when uploading, shown when not */}
                  {!uploading && (
                    <div className="relative z-20 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-gray-600" />
                  <span className="text-sm font-medium text-gray-700" style={{ fontSize: '13px', fontWeight: 500, lineHeight: '1.2' }}>
                    Upload
                  </span>
                    </div>
                  )}
                </button>
          </div>
        </motion.div>
        </motion.div>
      </AnimatePresence>
      
      {/* Contributors Popup - Rendered via Portal */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showContributorsPopup && contributors && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="fixed bg-white rounded-lg shadow-xl border border-gray-200 p-2 min-w-[180px] max-w-[200px] z-[1000]"
              style={{
                top: `${popupPosition.top}px`,
                left: `${popupPosition.left}px`,
                transform: 'translateY(-100%)',
                marginBottom: '8px'
              }}
              onMouseEnter={() => setShowContributorsPopup(true)}
              onMouseLeave={() => setShowContributorsPopup(false)}
            >
              <div className="space-y-1.5">
                {contributors.map((contributor, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    <Avatar className="w-7 h-7 flex-shrink-0 ring-1 ring-white">
                      <AvatarImage 
                        src={contributor.image || "/default profile icon.png"} 
                        alt={contributor.name}
                        className="object-cover"
                      />
                      <AvatarFallback className="bg-gradient-to-br from-blue-400 to-purple-500 text-white text-[10px] font-semibold">
                        {contributor.initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-800 font-medium truncate">
                          {contributor.name}
                        </span>
                        <span className="text-[10px] text-gray-500 font-normal">
                          {contributor.role}
                        </span>
                      </div>
                      {contributor.date && (
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {contributor.date}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
};


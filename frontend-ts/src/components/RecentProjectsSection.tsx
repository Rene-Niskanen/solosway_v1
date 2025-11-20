"use client";

import * as React from "react";
import { RecentProjectCard, LastFile } from "./RecentProjectCard";

interface ProjectData {
  type: 'new' | 'existing';
  projectType?: string;
  propertyAddress?: string;
  propertyId?: string; // Property ID for opening the property
  propertyCoordinates?: { lat: number; lng: number }; // Property coordinates for map navigation
  lastFile?: LastFile;
  documentCount?: number;
  lastOpened?: string;
  userAvatar?: string;
}

interface RecentProjectsSectionProps {
  onOpenProperty?: (propertyAddress: string, coordinates?: { lat: number; lng: number }, propertyId?: string) => void;
  onNewProjectClick?: () => void;
}

// Helper to format time ago
const getTimeAgo = (timestamp: string): string => {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
  if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
  if (diffDays < 7) return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
  return then.toLocaleDateString();
};

export const RecentProjectsSection: React.FC<RecentProjectsSectionProps> = ({
  onOpenProperty,
  onNewProjectClick
}) => {
  // Get the last interacted property from localStorage
  const [lastProperty, setLastProperty] = React.useState<any>(null);
  
  // Track viewport dimensions for responsive card display
  const [viewportWidth, setViewportWidth] = React.useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1024
  );
  const [viewportHeight, setViewportHeight] = React.useState<number>(
    typeof window !== 'undefined' ? window.innerHeight : 768
  );
  
  // Card dimensions constants - responsive based on viewport
  const getCardWidth = () => {
    if (typeof window === 'undefined') return 240;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Use the smaller dimension to ensure cards fit
    const minDimension = Math.min(vw, vh);
    // Scale between 140px (very small) and 240px (normal) - bigger for better readability while keeping text neat
    return Math.max(140, Math.min(240, minDimension * 0.18));
  };
  
  const CARD_WIDTH = React.useMemo(() => getCardWidth(), [viewportWidth, viewportHeight]);
  const CARD_GAP = React.useMemo(() => Math.max(6, CARD_WIDTH * 0.05), [CARD_WIDTH]); // 5% of card width, min 6px
  const CONTAINER_PADDING = 32; // Total horizontal padding (px-4 = 1rem = 16px on each side)
  const CONTAINER_MAX_WIDTH = 1024; // max-w-4xl = 1024px

  // Track viewport dimension changes
  React.useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };

    // Set initial dimensions
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  React.useEffect(() => {
    // Load last property from localStorage
    const loadLastProperty = () => {
      try {
        const saved = localStorage.getItem('lastInteractedProperty');
        if (saved) {
          const property = JSON.parse(saved);
          setLastProperty(property);
          
          // OPTIMIZATION: Preload card summary for recent project
          // This ensures card data is ready before user clicks
          if (property && property.id) {
            const cacheKey = `propertyCardCache_${property.id}`;
            const cached = localStorage.getItem(cacheKey);
            const CACHE_MAX_AGE = 30 * 60 * 1000; // 30 minutes
            
            // Only preload if cache doesn't exist or is expired
            let shouldPreload = true;
            if (cached) {
              try {
                const cacheData = JSON.parse(cached);
                const cacheAge = Date.now() - cacheData.timestamp;
                if (cacheAge < CACHE_MAX_AGE) {
                  shouldPreload = false; // Cache is fresh, no need to preload
                }
              } catch (e) {
                // Invalid cache, preload anyway
              }
            }
            
            if (shouldPreload) {
              // Preload in background - don't block UI
              import('../services/backendApi').then(({ backendApi }) => {
                backendApi.getPropertyCardSummary(property.id, true)
                  .then((response) => {
                    if (response.success && response.data) {
                      // Transform and cache the data
                      const transformedData = {
                        id: property.id,
                        address: response.data.address || property.address,
                        latitude: response.data.latitude || property.latitude,
                        longitude: response.data.longitude || property.longitude,
                        primary_image_url: response.data.primary_image_url,
                        image: response.data.primary_image_url || property.primary_image_url,
                        property_type: response.data.property_type,
                        tenure: response.data.tenure,
                        bedrooms: response.data.number_bedrooms || 0,
                        bathrooms: response.data.number_bathrooms || 0,
                        epc_rating: response.data.epc_rating,
                        documentCount: response.data.document_count || property.documentCount || 0,
                        rentPcm: response.data.rent_pcm || 0,
                        soldPrice: response.data.sold_price || 0,
                        askingPrice: response.data.asking_price || 0,
                        summary: response.data.summary_text,
                        notes: response.data.summary_text,
                        transaction_date: response.data.last_transaction_date,
                        yield_percentage: response.data.yield_percentage
                      };
                      
                      localStorage.setItem(cacheKey, JSON.stringify({
                        data: transformedData,
                        timestamp: Date.now(),
                        cacheVersion: (response as any).cache_version || 1
                      }));
                      console.log('✅ Preloaded card summary for recent project:', property.address);
                    }
                  })
                  .catch((error) => {
                    console.warn('Failed to preload card summary:', error);
                  });
              });
            }
          }
        }
      } catch (error) {
        console.error('Error loading last property:', error);
      }
    };

    loadLastProperty();

    // Listen for storage changes (when property is saved from another tab/component)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'lastInteractedProperty') {
        loadLastProperty();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    // Also listen for custom event in case it's from the same tab
    const handlePropertyUpdate = () => {
      loadLastProperty();
    };
    window.addEventListener('lastPropertyUpdated', handlePropertyUpdate);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('lastPropertyUpdated', handlePropertyUpdate);
    };
  }, []);

  // Build projects array - always show "New Project" first, then last property if it exists
  const projects = React.useMemo(() => {
    const allProjects: ProjectData[] = [
      {
        type: 'new'
      }
    ];

    // Add last property if it exists
    if (lastProperty && lastProperty.address) {
      allProjects.push({
        type: 'existing',
        projectType: 'Property', // Simple default
        propertyAddress: lastProperty.address,
        propertyId: lastProperty.id,
        propertyCoordinates: lastProperty.latitude && lastProperty.longitude 
          ? { lat: lastProperty.latitude, lng: lastProperty.longitude }
          : undefined,
        documentCount: lastProperty.documentCount || 0,
        lastOpened: lastProperty.timestamp ? getTimeAgo(lastProperty.timestamp) : 'Recently',
        lastFile: lastProperty.primary_image_url ? {
          type: 'image',
          thumbnail: lastProperty.primary_image_url
        } : undefined
      });
    }

    // Fill remaining slots with blank placeholder cards (up to 4 total cards)
    while (allProjects.length < 4) {
      allProjects.push({
        type: 'existing' // Use existing type but mark as blank
      });
    }

    return allProjects;
  }, [lastProperty]);

  // Calculate how many cards can fit in the available space with proper padding
  const maxVisibleCards = React.useMemo(() => {
    // Calculate available width more conservatively
    // Account for sidebar (if visible), container padding, and extra safety margin
    const SIDEBAR_WIDTH = 64; // Approximate sidebar width
    const containerPadding = Math.max(8, Math.min(16, viewportWidth * 0.02)); // Approximate clamp(0.5rem, 2vw, 1rem)
    
    // More conservative calculation: subtract sidebar, container padding, and extra safety margin
    const availableWidth = viewportWidth - SIDEBAR_WIDTH - CONTAINER_PADDING - 40; // Extra 40px safety margin
    const containerWidth = Math.min(availableWidth, CONTAINER_MAX_WIDTH);
    
    // Minimum right padding required - much more aggressive to hide cards earlier
    // This ensures cards don't get cut off at the edge
    const MIN_RIGHT_PADDING = containerPadding + 40; // Increased to 40px buffer to hide cards much earlier
    
    // Ensure we have at least enough space for one card (with padding on both sides)
    if (containerWidth < CARD_WIDTH + MIN_RIGHT_PADDING + containerPadding) {
      return 0; // Don't show any cards if there's not enough space for even one with padding
    }
    
    // Calculate how many cards fit with proper right padding
    // Formula: n cards need n * cardWidth + (n-1) * gap + rightPadding
    // We need: containerWidth >= n * cardWidth + (n-1) * gap + MIN_RIGHT_PADDING
    const availableForCards = containerWidth - MIN_RIGHT_PADDING;
    let maxCards = Math.floor((availableForCards + CARD_GAP) / (CARD_WIDTH + CARD_GAP));
    
    // Verify that the calculated number of cards actually fits with padding
    // Iterate backwards to find the maximum number that fits
    // Use a much larger safety buffer (40px) to hide cards much earlier before they get cut off
    for (let count = maxCards; count >= 0; count--) {
      if (count === 0) {
        maxCards = 0;
        break;
      }
      
      // Calculate total width needed for 'count' cards
      const totalWidthNeeded = count * CARD_WIDTH + (count - 1) * CARD_GAP;
      
      // Check if it fits with proper right padding (with much larger buffer for safety)
      // Increased buffer to 40px to hide cards much earlier - ensures no cutoff
      if (totalWidthNeeded + MIN_RIGHT_PADDING <= containerWidth) {
        maxCards = count;
        break;
      }
    }
    
    // Ensure at least 1 card can be shown (if space allows), and at most 4
    return Math.max(0, Math.min(maxCards, 4));
  }, [viewportWidth, viewportHeight, CARD_WIDTH, CARD_GAP]);

  // Filter projects to show only what fits, prioritizing:
  // 1. "New Project" card (always first)
  // 2. Actual property cards
  // 3. Blank placeholder cards (hide these first)
  const visibleProjects = React.useMemo(() => {
    // Separate cards by type
    const newProjectCard = projects.find(p => p.type === 'new');
    const propertyCards = projects.filter(p => p.type === 'existing' && p.propertyAddress);
    const blankCards = projects.filter(p => p.type === 'existing' && !p.propertyAddress);
    
    // Build visible array in priority order
    const visible: ProjectData[] = [];
    
    // Always include "New Project" if it fits
    if (newProjectCard && visible.length < maxVisibleCards) {
      visible.push(newProjectCard);
    }
    
    // Add property cards until we reach the limit
    for (const card of propertyCards) {
      if (visible.length < maxVisibleCards) {
        visible.push(card);
      }
    }
    
    // Add blank cards only if there's still space
    for (const card of blankCards) {
      if (visible.length < maxVisibleCards) {
        visible.push(card);
      }
    }
    
    return visible;
  }, [projects, maxVisibleCards]);

  const handleProjectClick = (propertyAddress?: string, coordinates?: { lat: number; lng: number }, propertyId?: string) => {
    if (!propertyAddress || !onOpenProperty) return;
    onOpenProperty(propertyAddress, coordinates, propertyId);
  };

  return (
    <div className="w-full flex justify-center" style={{ 
      paddingLeft: 'clamp(0.5rem, 2vw, 1rem)', 
      paddingRight: 'clamp(0.5rem, 2vw, 1rem)',
      marginBottom: 'clamp(1rem, 6vh, 3rem)'
    }}>
      <div className="w-full" style={{ maxWidth: 'clamp(320px, 90vw, 1024px)' }}>
        <div className="flex flex-nowrap justify-center overflow-hidden" style={{ gap: `${CARD_GAP}px` }}>
          {visibleProjects.map((project, index) => {
            // Check if this is a blank placeholder card
            const isBlank = project.type === 'existing' && !project.propertyAddress;
            
            return (
              <div
                key={index}
                onClick={project.type === 'new'
                  ? () => onNewProjectClick?.()
                  : project.type === 'existing' && project.propertyAddress
                  ? () => handleProjectClick(project.propertyAddress, project.propertyCoordinates, project.propertyId)
                  : undefined}
                className={`flex-shrink-0 ${(project.type === 'new' || (project.type === 'existing' && project.propertyAddress)) ? 'cursor-pointer' : ''}`}
                style={{ 
                  minWidth: `${CARD_WIDTH}px`, 
                  width: `${CARD_WIDTH}px`,
                  maxWidth: `${CARD_WIDTH}px`,
                  minHeight: `${CARD_WIDTH * 1.28}px`,
                  height: 'auto',
                  flexShrink: 0,
                  alignSelf: 'flex-start'
                }}
              >
                <RecentProjectCard
                  type={isBlank ? 'blank' : project.type}
                  projectType={project.projectType}
                  propertyAddress={project.propertyAddress}
                  lastFile={project.lastFile}
                  documentCount={project.documentCount}
                  lastOpened={project.lastOpened}
                  userAvatar={project.userAvatar}
                  cardWidth={CARD_WIDTH}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};


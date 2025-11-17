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
  onOpenProperty
}) => {
  // Get the last interacted property from localStorage
  const [lastProperty, setLastProperty] = React.useState<any>(null);

  React.useEffect(() => {
    // Load last property from localStorage
    const loadLastProperty = () => {
      try {
        const saved = localStorage.getItem('lastInteractedProperty');
        if (saved) {
          const property = JSON.parse(saved);
          setLastProperty(property);
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
  const projects: ProjectData[] = [
    {
      type: 'new'
    }
  ];

  // Add last property if it exists
  if (lastProperty && lastProperty.address) {
    projects.push({
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
  while (projects.length < 4) {
    projects.push({
      type: 'existing' // Use existing type but mark as blank
    });
  }

  const handleProjectClick = (propertyAddress?: string, coordinates?: { lat: number; lng: number }, propertyId?: string) => {
    if (!propertyAddress || !onOpenProperty) return;
    onOpenProperty(propertyAddress, coordinates, propertyId);
  };

  return (
    <div className="w-full flex justify-center px-4 mb-12">
      <div className="w-full max-w-4xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {projects.map((project, index) => {
            // Check if this is a blank placeholder card
            const isBlank = project.type === 'existing' && !project.propertyAddress;
            
            return (
              <div
                key={index}
                onClick={project.type === 'existing' && project.propertyAddress
                  ? () => handleProjectClick(project.propertyAddress, project.propertyCoordinates, project.propertyId)
                  : undefined}
                className={project.type === 'existing' && project.propertyAddress ? 'cursor-pointer' : ''}
              >
                <RecentProjectCard
                  type={isBlank ? 'blank' : project.type}
                  projectType={project.projectType}
                  propertyAddress={project.propertyAddress}
                  lastFile={project.lastFile}
                  documentCount={project.documentCount}
                  lastOpened={project.lastOpened}
                  userAvatar={project.userAvatar}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};


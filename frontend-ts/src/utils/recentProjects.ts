/**
 * Utility functions for managing recent projects in localStorage
 */

export interface RecentProperty {
  id: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  primary_image_url?: string;
  documentCount: number;
  timestamp: string;
}

/**
 * Save a property to recent projects
 * Keeps the 3 most recent properties, sorted by timestamp (newest first)
 */
export function saveToRecentProjects(propertyToSave: any, documentCount?: number): void {
  if (!propertyToSave || !propertyToSave.id || !propertyToSave.address) {
    return;
  }
  
  // Only save real properties (not temp ones)
  if (propertyToSave.id.startsWith('temp-')) {
    return;
  }
  
  // Calculate document count - use provided count, or try to get from property
  let docCount = documentCount ?? 0;
  if (docCount === 0) {
    if (propertyToSave.propertyHub?.documents?.length) {
      docCount = propertyToSave.propertyHub.documents.length;
    } else if (propertyToSave.documentCount) {
      docCount = propertyToSave.documentCount;
    } else if (propertyToSave.document_count) {
      docCount = propertyToSave.document_count;
    }
  }
  
  // CRITICAL: Save property pin location (user-set final coordinates from Create Property Card), not document-extracted coordinates
  // This is where the user placed/confirmed the pin. 
  // If coordinates are explicitly provided (e.g., from PropertyDetailsPanel with originalPinCoordsRef), use those
  // Otherwise, only use coordinates if geocoding_status === 'manual' (indicating user-set pin location)
  const geocodingStatus = propertyToSave.geocoding_status;
  const isPinLocation = geocodingStatus === 'manual';
  // Prefer explicitly provided coordinates (from PropertyDetailsPanel), otherwise use property coordinates if pin location
  const pinLatitude = propertyToSave.latitude !== undefined 
    ? propertyToSave.latitude 
    : (isPinLocation ? propertyToSave.latitude : null);
  const pinLongitude = propertyToSave.longitude !== undefined 
    ? propertyToSave.longitude 
    : (isPinLocation ? propertyToSave.longitude : null);
  
  const propertyToAdd: RecentProperty = {
    id: propertyToSave.id,
    address: propertyToSave.address,
    latitude: pinLatitude, // Property pin location (user-set), not document-extracted coordinates
    longitude: pinLongitude, // Property pin location (user-set), not document-extracted coordinates
    primary_image_url: propertyToSave.primary_image_url || propertyToSave.image,
    documentCount: docCount,
    timestamp: new Date().toISOString()
  };
  
  // Load existing recent properties array
  let recentProperties: RecentProperty[] = [];
  try {
    const saved = localStorage.getItem('recentProperties');
    if (saved) {
      recentProperties = JSON.parse(saved);
    }
  } catch (error) {
    console.error('Error loading recent projects:', error);
  }
  
  // Remove this property if it already exists (to avoid duplicates)
  // This ensures multiple properties appear side by side, not replacing each other
  recentProperties = recentProperties.filter(p => p.id !== propertyToAdd.id);
  
  // Add the new property at the beginning (most recent first)
  // Properties are ordered by most recent upload timestamp - newest uploads appear first
  // When uploading to the same property again, it moves to first position and other properties shift right
  recentProperties.unshift(propertyToAdd);
  
  // Keep only the 3 most recent properties
  // This maintains up to 3 different properties side by side in the recent projects section
  recentProperties = recentProperties.slice(0, 3);
  
  // Save back to localStorage
  localStorage.setItem('recentProperties', JSON.stringify(recentProperties));
  
  // Also update lastInteractedProperty for backward compatibility
  localStorage.setItem('lastInteractedProperty', JSON.stringify(propertyToAdd));
  
  // Dispatch custom event to update RecentProjectsSection in the same tab
  window.dispatchEvent(new CustomEvent('lastPropertyUpdated'));
  console.log('💾 Saved property to recent projects:', propertyToAdd.address, `(${docCount} docs)`, `(${recentProperties.length} total recent)`);
}


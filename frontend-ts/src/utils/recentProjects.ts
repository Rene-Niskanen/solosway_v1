/**
 * Utility functions for managing recent projects in localStorage
 * Maintains an array of up to 3 most recent properties
 */

export interface RecentProperty {
  id: string;
  address: string;
  latitude?: number;
  longitude?: number;
  primary_image_url?: string;
  documentCount: number;
  timestamp: string;
}

const RECENT_PROPERTIES_KEY = 'recentProperties';
const MAX_RECENT_PROPERTIES = 3;

/**
 * Save a property to recent projects
 * Maintains an array of up to 3 unique properties, ordered by most recent first
 */
export const saveToRecentProjects = (propertyToSave: RecentProperty): void => {
  if (!propertyToSave || !propertyToSave.id || !propertyToSave.address) {
    return;
  }

  // Only save real properties (not temp ones)
  if (propertyToSave.id.startsWith('temp-')) {
    return;
  }

  try {
    // Load existing recent properties
    const existing = localStorage.getItem(RECENT_PROPERTIES_KEY);
    let recentProperties: RecentProperty[] = existing ? JSON.parse(existing) : [];

    // Normalize address for comparison (lowercase, trim whitespace)
    const normalizeAddress = (addr: string) => addr.toLowerCase().trim();
    const newAddressNormalized = normalizeAddress(propertyToSave.address);

    // Filter out the property if it already exists (by ID OR by normalized address)
    // This prevents duplicates when the same property has different IDs
    recentProperties = recentProperties.filter(
      p => p.id !== propertyToSave.id && normalizeAddress(p.address) !== newAddressNormalized
    );

    // Add the new property to the beginning (most recent first)
    recentProperties.unshift(propertyToSave);

    // Keep only the most recent 3 properties
    recentProperties = recentProperties.slice(0, MAX_RECENT_PROPERTIES);

    // Save back to localStorage
    localStorage.setItem(RECENT_PROPERTIES_KEY, JSON.stringify(recentProperties));

    // Also update lastInteractedProperty for backward compatibility
    localStorage.setItem('lastInteractedProperty', JSON.stringify(propertyToSave));

    // Dispatch custom event to update RecentProjectsSection
    window.dispatchEvent(new CustomEvent('lastPropertyUpdated'));

    console.log('💾 Saved property to recent projects:', propertyToSave.address, `(${propertyToSave.documentCount} docs)`, `[${recentProperties.length} total]`);
  } catch (error) {
    console.error('Error saving to recent projects:', error);
  }
};

/**
 * Load recent properties from localStorage
 * Returns an array of up to 3 most recent properties, deduplicated by address
 */
export const loadRecentProperties = (): RecentProperty[] => {
  try {
    const saved = localStorage.getItem(RECENT_PROPERTIES_KEY);
    if (saved) {
      const properties = JSON.parse(saved);
      // Ensure it's an array and filter out invalid entries
      if (Array.isArray(properties)) {
        const validProperties = properties.filter(p => p && p.id && p.address);
        
        // Deduplicate by normalized address (keep most recent for each address)
        const normalizeAddress = (addr: string) => addr.toLowerCase().trim();
        const seenAddresses = new Map<string, RecentProperty>();
        
        // Process in forward order - when we see a duplicate address, keep the one with the more recent timestamp
        for (const prop of validProperties) {
          const normalizedAddr = normalizeAddress(prop.address);
          
          // If we haven't seen this address, add it
          if (!seenAddresses.has(normalizedAddr)) {
            seenAddresses.set(normalizedAddr, prop);
          } else {
            const existing = seenAddresses.get(normalizedAddr)!;
            // Compare timestamps - keep the more recent one
            // If timestamp is missing/invalid, prefer the one that appears earlier in the array (more recent)
            const existingTime = existing.timestamp ? new Date(existing.timestamp).getTime() : 0;
            const currentTime = prop.timestamp ? new Date(prop.timestamp).getTime() : 0;
            
            // If both have valid timestamps, keep the more recent
            // If one is missing, prefer the one with a timestamp
            // If both are missing, keep the existing one (first seen, which is more recent in the array)
            if (currentTime > 0 && (currentTime > existingTime || existingTime === 0)) {
              seenAddresses.set(normalizedAddr, prop);
            }
          }
        }
        
        // Convert back to array, sorted by timestamp (most recent first)
        const deduplicated = Array.from(seenAddresses.values())
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, MAX_RECENT_PROPERTIES);
        
        // If we removed duplicates, save the cleaned version back to localStorage
        if (deduplicated.length !== validProperties.length) {
          localStorage.setItem(RECENT_PROPERTIES_KEY, JSON.stringify(deduplicated));
          console.log(`🧹 Cleaned up ${validProperties.length - deduplicated.length} duplicate property(ies) from recent projects`);
        }
        
        return deduplicated;
      }
    }

    // Fallback: Try to migrate from old lastInteractedProperty format
    const lastProperty = localStorage.getItem('lastInteractedProperty');
    if (lastProperty) {
      try {
        const property = JSON.parse(lastProperty);
        if (property && property.id && property.address) {
          // Migrate to new array format
          const migrated = [property];
          localStorage.setItem(RECENT_PROPERTIES_KEY, JSON.stringify(migrated));
          return migrated;
        }
      } catch (e) {
        console.warn('Failed to migrate lastInteractedProperty:', e);
      }
    }

    return [];
  } catch (error) {
    console.error('Error loading recent properties:', error);
    return [];
  }
};

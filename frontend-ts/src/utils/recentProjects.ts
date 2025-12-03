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

    // Filter out the property if it already exists (by ID)
    recentProperties = recentProperties.filter(p => p.id !== propertyToSave.id);

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
 * Returns an array of up to 3 most recent properties
 */
export const loadRecentProperties = (): RecentProperty[] => {
  try {
    const saved = localStorage.getItem(RECENT_PROPERTIES_KEY);
    if (saved) {
      const properties = JSON.parse(saved);
      // Ensure it's an array and filter out invalid entries
      if (Array.isArray(properties)) {
        return properties.filter(p => p && p.id && p.address);
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

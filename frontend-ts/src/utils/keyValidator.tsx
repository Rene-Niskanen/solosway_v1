/**
 * Key Validator - Intercepts React.createElement to catch empty keys
 * This is a nuclear option to catch ANY empty keys before they reach React
 */

import React from 'react';

// Store original createElement
const originalCreateElement = React.createElement;

// Override React.createElement to validate keys
(React as any).createElement = function(type: any, props: any, ...children: any[]) {
  // Check if this element has a key prop
  if (props && 'key' in props) {
    const key = props.key;
    
    // Check for empty keys - ONLY for AnimatePresence children (motion.div, div, etc.)
    // Skip icon elements (path, rect, etc.) as they're from third-party libraries
    const isIconElement = typeof type === 'string' && (type === 'path' || type === 'rect' || type === 'circle' || type === 'g');
    
    if (!isIconElement) {
      if (key === null || key === undefined || key === '' || (typeof key === 'string' && key.trim().length === 0)) {
        console.error('❌ NUCLEAR: Empty key detected in React.createElement!', {
          type: typeof type === 'string' ? type : type?.name || 'Unknown',
          props,
          key,
          stack: new Error().stack
        });
        
        // Generate emergency key
        props.key = `emergency-key-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      }
    }
    
    // Check for duplicate keys in the same render (if we can detect it)
    // Skip for icon elements to reduce noise
    if (!isIconElement && typeof key === 'string' && key.length > 0) {
      // Use a per-render cache that resets each frame
      if (!(window as any).__reactKeyCache) {
        (window as any).__reactKeyCache = new Set();
        // Clear cache on next frame to prevent false positives across renders
        requestAnimationFrame(() => {
          (window as any).__reactKeyCache = new Set();
        });
      }
      const keyCache = (window as any).__reactKeyCache;
      
      // Only check for duplicates if key doesn't already have -dup- suffix (to avoid recursive dup-dup-dup)
      if (!key.includes('-dup-') && keyCache.has(key)) {
        console.error('❌ NUCLEAR: Duplicate key detected!', {
          type: typeof type === 'string' ? type : type?.name || 'Unknown',
          key,
          props
        });
        // Make it unique with performance.now() for microsecond precision + random
        props.key = `${key}-dup-${performance.now()}-${Math.random().toString(36).substring(2, 9)}`;
      }
      // Add the final key (which may have been modified) to cache
      keyCache.add(props.key);
    }
  }
  
  // Call original createElement
  return originalCreateElement.apply(React, [type, props, ...children] as any);
};


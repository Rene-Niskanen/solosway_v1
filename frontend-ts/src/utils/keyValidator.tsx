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
    // Skip icon/SVG primitive elements (path, line, rect, etc.) as they're from third-party icon libraries
    const svgPrimitives = ['path', 'rect', 'circle', 'g', 'line', 'polygon', 'polyline', 'ellipse', 'defs', 'use'];
    const isIconElement = typeof type === 'string' && svgPrimitives.includes(type);
    
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
      const win = window as any;
      
      // Use a per-render cache that resets each frame
      if (!win.__reactKeyCache) {
        win.__reactKeyCache = new Map();
        // Clear cache on next frame to prevent false positives across renders
        requestAnimationFrame(() => {
          win.__reactKeyCache = new Map();
        });
      }
      const keyCacheMap: Map<string, Set<string>> = win.__reactKeyCache;
      
      const typeName = typeof type === 'string' ? type : type?.displayName || type?.name || 'Unknown';
      if (!keyCacheMap.has(typeName)) {
        keyCacheMap.set(typeName, new Set());
      }
      const typeKeyCache = keyCacheMap.get(typeName)!;
      
      // Only check for duplicates if key doesn't already have -dup- suffix (to avoid recursive dup-dup-dup)
      if (!key.includes('-dup-') && typeKeyCache.has(key)) {
        console.error('❌ NUCLEAR: Duplicate key detected!', {
          type: typeName,
          key,
          props
        });
        // Make it unique with performance.now() for microsecond precision + random
        props.key = `${key}-dup-${performance.now()}-${Math.random().toString(36).substring(2, 9)}`;
      }
      // Add the final key (which may have been modified) to cache for this component type
      typeKeyCache.add(props.key);
    }
  }
  
  // Call original createElement
  return originalCreateElement.apply(React, [type, props, ...children] as any);
};


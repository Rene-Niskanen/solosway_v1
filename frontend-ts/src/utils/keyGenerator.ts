/**
 * Centralized Key Generation Utility
 * 
 * This utility ensures all React keys are STABLE and unique across the entire application.
 * Keys are based on stable identifiers (component name, ID, index) and do NOT change
 * between renders, which is critical for React's reconciliation algorithm.
 * 
 * IMPORTANT: Keys must be stable - the same item must have the same key across renders.
 * We only use timestamps/random values in emergency fallbacks when no stable identifier exists.
 */

/**
 * Generate a stable, unique key for React components
 * 
 * Keys are based on stable identifiers only - no timestamps or random values in normal flow.
 * This ensures React can properly track component identity across renders.
 * 
 * @param componentName - Name of the component (e.g., 'SideChatPanel', 'ReasoningSteps')
 * @param identifier - Primary identifier (ID, index, etc.) - MUST be stable across renders
 * @param additionalData - Optional additional data to include in key (must also be stable)
 * @returns A stable, unique, non-empty string key
 */
export function generateUniqueKey(
  componentName: string,
  identifier: string | number | undefined | null,
  additionalData?: string | number | undefined | null
): string {
  // Normalize component name
  const normalizedComponent = componentName || 'Unknown';
  
  // Handle identifier - convert to string and ensure it's not empty
  let normalizedId: string;
  if (identifier === null || identifier === undefined) {
    // If no identifier provided, we need to use emergency fallback
    // This should be rare - most components should have an ID or index
    const emergencyKey = `key-emergency-${normalizedComponent}-${performance.now()}-${Math.random().toString(36).substring(2, 15)}`;
    console.warn('⚠️ No identifier provided to generateUniqueKey, using emergency fallback:', {
      componentName,
      additionalData,
      emergencyKey
    });
    return emergencyKey;
  } else if (typeof identifier === 'number') {
    normalizedId = String(identifier);
  } else if (typeof identifier === 'string') {
    const trimmed = identifier.trim();
    normalizedId = trimmed.length > 0 ? trimmed : 'empty-id';
  } else {
    normalizedId = String(identifier);
  }
  
  // Handle additional data
  let additionalStr = '';
  if (additionalData !== null && additionalData !== undefined) {
    if (typeof additionalData === 'string') {
      additionalStr = additionalData.trim().length > 0 ? `-${additionalData.trim()}` : '';
    } else {
      additionalStr = `-${additionalData}`;
    }
  }
  
  // Construct key using ONLY stable identifiers: component-id-additional
  // NO timestamps, NO random values - this ensures keys are stable across renders
  const key = `${normalizedComponent}-${normalizedId}${additionalStr}`;
  
  // Final validation - this should never fail, but we check anyway
  if (!key || typeof key !== 'string' || key.trim().length === 0 || key === '') {
    // Emergency fallback - use performance.now() for absolute uniqueness
    // This should only happen if all identifiers are empty strings
    const emergencyKey = `key-emergency-${normalizedComponent}-${performance.now()}-${Math.random().toString(36).substring(2, 15)}`;
    console.error('❌ CRITICAL: Key generator produced empty key!', { 
      componentName, 
      identifier, 
      additionalData,
      emergencyKey 
    });
    return emergencyKey;
  }
  
  return key;
}

/**
 * Generate a key for list items (messages, steps, etc.)
 * Uses index as primary identifier to ensure order-based uniqueness
 * 
 * @param componentName - Name of the component
 * @param index - Array index (always required for list items)
 * @param itemId - Optional item ID if available
 * @param additionalData - Optional additional data
 * @returns A guaranteed unique key
 */
export function generateListKey(
  componentName: string,
  index: number,
  itemId?: string | number | undefined | null,
  additionalData?: string | number | undefined | null
): string {
  // Always use index as primary identifier for list items
  // This ensures uniqueness even if itemId is missing or duplicate
  // CRITICAL: Treat empty strings as missing - they cause empty keys
  let finalId: string;
  
  if (itemId === null || itemId === undefined) {
    // No ID provided - use index
    finalId = `idx-${index}`;
  } else if (typeof itemId === 'string') {
    // String ID - check if it's empty after trimming
    const trimmed = itemId.trim();
    finalId = trimmed.length > 0 ? trimmed : `idx-${index}`;
  } else if (typeof itemId === 'number') {
    // Number ID - convert to string
    finalId = String(itemId);
  } else {
    // Other type - convert to string, but fallback to index if empty
    const strId = String(itemId);
    finalId = strId.length > 0 ? strId : `idx-${index}`;
  }
  
  // Final safety check - ensure finalId is never empty
  if (!finalId || finalId.length === 0) {
    finalId = `idx-${index}`;
  }
  
  return generateUniqueKey(componentName, `${index}-${finalId}`, additionalData);
}

/**
 * Generate a key for conditional renders
 * Ensures uniqueness even when condition changes
 * 
 * @param componentName - Name of the component
 * @param baseIdentifier - Base identifier
 * @param condition - Condition state (e.g., 'loading', 'complete', 'visible', 'hidden')
 * @returns A guaranteed unique key
 */
export function generateConditionalKey(
  componentName: string,
  baseIdentifier: string | number,
  condition: string | boolean
): string {
  const conditionStr = typeof condition === 'boolean' 
    ? (condition ? 'true' : 'false')
    : String(condition);
  
  return generateUniqueKey(componentName, baseIdentifier, conditionStr);
}

/**
 * Generate a key for AnimatePresence children
 * Ensures each child has a unique key even if data is duplicate
 * 
 * @param componentName - Name of the component
 * @param index - Index in the array
 * @param itemId - Optional item ID
 * @param itemType - Type of item (e.g., 'message', 'step', 'attachment')
 * @returns A guaranteed unique key
 */
export function generateAnimatePresenceKey(
  componentName: string,
  index: number,
  itemId?: string | number | undefined | null,
  itemType?: string
): string {
  // CRITICAL: Ensure index is always a valid number
  if (typeof index !== 'number' || isNaN(index) || index < 0) {
    console.error('❌ FATAL: Invalid index passed to generateAnimatePresenceKey!', { componentName, index, itemId, itemType });
    // Use a fallback index of 0 - this is stable, not random
    index = 0;
  }
  
  const typeStr = itemType ? `-${itemType}` : '';
  const key = generateListKey(componentName, index, itemId, typeStr);
  
  // Final validation - this should NEVER be empty
  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    // Emergency fallback - only use timestamp/random here as last resort
    const emergencyKey = `emergency-ap-key-${componentName}-${index}-${performance.now()}-${Math.random().toString(36).substring(2, 15)}`;
    console.error('❌ FATAL: generateAnimatePresenceKey produced empty key!', {
      componentName,
      index,
      itemId,
      itemType,
      emergencyKey
    });
    return emergencyKey;
  }
  
  return key;
}


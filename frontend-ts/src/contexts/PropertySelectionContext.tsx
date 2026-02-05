"use client";

import * as React from "react";
import { PropertyAttachmentData } from '../components/PropertyAttachment';
import { PropertyData } from '../components/PropertyResultsDisplay';

interface PropertySelectionContextType {
  isSelectionModeActive: boolean;
  toggleSelectionMode: () => void;
  setSelectionModeActive: (active: boolean) => void;
  // Property attachment handlers
  addPropertyAttachment: (property: PropertyData) => void;
  removePropertyAttachment: (id: string) => void;
  propertyAttachments: PropertyAttachmentData[];
  clearPropertyAttachments: () => void;
}

const PropertySelectionContext = React.createContext<PropertySelectionContextType | undefined>(undefined);

const MAX_PROPERTY_ATTACHMENTS = 4;

export const PropertySelectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isSelectionModeActive, setIsSelectionModeActive] = React.useState<boolean>(false);
  const [propertyAttachments, setPropertyAttachments] = React.useState<PropertyAttachmentData[]>([]);

  const toggleSelectionMode = React.useCallback(() => {
    setIsSelectionModeActive(prev => !prev);
  }, []);

  const setSelectionModeActive = React.useCallback((active: boolean) => {
    setIsSelectionModeActive(active);
  }, []);

  const addPropertyAttachment = React.useCallback((property: PropertyData) => {
    // Check if property is already attached
    const propertyId = property.id?.toString() || property.id;
    const isAlreadyAttached = propertyAttachments.some(
      p => (p.propertyId?.toString() || p.propertyId) === propertyId?.toString()
    );

    if (isAlreadyAttached) {
      return; // Already attached, don't add again
    }

    // Check if we've reached the maximum
    if (propertyAttachments.length >= MAX_PROPERTY_ATTACHMENTS) {
      return; // Max reached
    }

    const address = property.formatted_address || property.normalized_address || property.address || 'Unknown Address';
    const propertyAttachment: PropertyAttachmentData = {
      id: `property-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      propertyId: property.id,
      address,
      imageUrl: property.image || property.primary_image_url || '',
      property: property
    };

    console.log('✅ PropertySelectionContext: Adding property attachment:', propertyAttachment);
    setPropertyAttachments(prev => {
      const updated = [...prev, propertyAttachment];
      console.log('📋 PropertySelectionContext: Updated property attachments:', updated);
      return updated;
    });
  }, [propertyAttachments]);

  const removePropertyAttachment = React.useCallback((id: string) => {
    setPropertyAttachments(prev => prev.filter(p => p.id !== id));
  }, []);

  const clearPropertyAttachments = React.useCallback(() => {
    setPropertyAttachments([]);
  }, []);

  const value = React.useMemo(() => ({
    isSelectionModeActive,
    toggleSelectionMode,
    setSelectionModeActive,
    addPropertyAttachment,
    removePropertyAttachment,
    propertyAttachments,
    clearPropertyAttachments
  }), [isSelectionModeActive, toggleSelectionMode, setSelectionModeActive, addPropertyAttachment, removePropertyAttachment, propertyAttachments, clearPropertyAttachments]);

  return (
    <PropertySelectionContext.Provider value={value}>
      {children}
    </PropertySelectionContext.Provider>
  );
};

export const usePropertySelection = (): PropertySelectionContextType => {
  const context = React.useContext(PropertySelectionContext);
  if (context === undefined) {
    throw new Error('usePropertySelection must be used within a PropertySelectionProvider');
  }
  return context;
};


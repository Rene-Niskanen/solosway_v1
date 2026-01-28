"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface FilingSidebarContextType {
  isOpen: boolean;
  viewMode: 'global' | 'property';
  selectedPropertyId: string | null;
  searchQuery: string;
  selectedItems: Set<string>;
  width: number; // Current width of FilingSidebar (default 320px, can be resized)
  isResizing: boolean; // Whether FilingSidebar is currently being resized
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  setViewMode: (mode: 'global' | 'property') => void;
  setSelectedProperty: (propertyId: string | null) => void;
  setSearchQuery: (query: string) => void;
  toggleItemSelection: (itemId: string) => void;
  clearSelection: () => void;
  selectAll: (itemIds: string[]) => void;
  setWidth: (width: number) => void;
  setIsResizing: (isResizing: boolean) => void;
}

const FilingSidebarContext = createContext<FilingSidebarContextType | undefined>(undefined);

export const FilingSidebarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [viewMode, setViewModeState] = useState<'global' | 'property'>('global');
  const [selectedPropertyId, setSelectedPropertyIdState] = useState<string | null>(null);
  const [searchQuery, setSearchQueryState] = useState<string>('');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [width, setWidthState] = useState<number>(360); // Default width: 360px
  const [isResizing, setIsResizingState] = useState<boolean>(false);

  const openSidebar = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeSidebar = useCallback(() => {
    setIsOpen(false);
    // Clear selection when closing
    setSelectedItems(new Set());
  }, []);

  const toggleSidebar = useCallback(() => {
    setIsOpen(prev => {
      if (!prev) {
        return true;
      } else {
        // Clear selection when closing
        setSelectedItems(new Set());
        return false;
      }
    });
  }, []);

  const setViewMode = useCallback((mode: 'global' | 'property') => {
    setViewModeState(mode);
    // Clear property selection when switching to global view
    if (mode === 'global') {
      setSelectedPropertyIdState(null);
    }
  }, []);

  const setSelectedProperty = useCallback((propertyId: string | null) => {
    setSelectedPropertyIdState(propertyId);
    // Switch to property view when a property is selected
    if (propertyId) {
      setViewModeState('property');
    }
  }, []);

  const setSearchQuery = useCallback((query: string) => {
    setSearchQueryState(query);
  }, []);

  const toggleItemSelection = useCallback((itemId: string) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedItems(new Set());
  }, []);

  const selectAll = useCallback((itemIds: string[]) => {
    setSelectedItems(new Set(itemIds));
  }, []);

  const setWidth = useCallback((newWidth: number) => {
    setWidthState(newWidth);
  }, []);

  const setIsResizing = useCallback((resizing: boolean) => {
    setIsResizingState(resizing);
  }, []);

  // Keyboard shortcut handler (Cmd/Ctrl + F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + F to toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        // Only prevent default if we're not in an input/textarea
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          toggleSidebar();
        }
      }
      // Escape to close sidebar
      if (e.key === 'Escape' && isOpen) {
        const target = e.target as HTMLElement;
        // Only close if not in an input/textarea (let those handle Escape normally)
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          closeSidebar();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, toggleSidebar, closeSidebar]);

  const value: FilingSidebarContextType = {
    isOpen,
    viewMode,
    selectedPropertyId,
    searchQuery,
    selectedItems,
    width,
    isResizing,
    openSidebar,
    closeSidebar,
    toggleSidebar,
    setViewMode,
    setSelectedProperty,
    setSearchQuery,
    toggleItemSelection,
    clearSelection,
    selectAll,
    setWidth,
    setIsResizing,
  };

  return (
    <FilingSidebarContext.Provider value={value}>
      {children}
    </FilingSidebarContext.Provider>
  );
};

export const useFilingSidebar = (): FilingSidebarContextType => {
  const context = useContext(FilingSidebarContext);
  if (context === undefined) {
    throw new Error('useFilingSidebar must be used within a FilingSidebarProvider');
  }
  return context;
};


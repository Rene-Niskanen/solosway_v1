"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface DocumentSelectionContextType {
  selectedDocumentIds: Set<string>;
  isDocumentSelectionMode: boolean;
  toggleDocumentSelection: (documentId: string) => void;
  clearSelectedDocuments: () => void;
  setDocumentSelectionMode: (enabled: boolean) => void;
  toggleDocumentSelectionMode: () => void;
}

const DocumentSelectionContext = createContext<DocumentSelectionContextType | undefined>(undefined);

export const DocumentSelectionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(new Set());
  const [isDocumentSelectionMode, setIsDocumentSelectionMode] = useState(false);

  const toggleDocumentSelection = useCallback((documentId: string) => {
    setSelectedDocumentIds(prev => {
      const newSet = new Set(prev);
      const wasSelected = newSet.has(documentId);
      if (wasSelected) {
        newSet.delete(documentId);
        console.log('📄 DocumentSelectionContext: Removed document', documentId, 'from selection. New set:', Array.from(newSet));
      } else {
        newSet.add(documentId);
        console.log('📄 DocumentSelectionContext: Added document', documentId, 'to selection. New set:', Array.from(newSet));
      }
      return newSet;
    });
  }, []);

  const clearSelectedDocuments = useCallback(() => {
    setSelectedDocumentIds(new Set());
  }, []);

  const setDocumentSelectionMode = useCallback((enabled: boolean) => {
    setIsDocumentSelectionMode(enabled);
    // Don't clear selection when exiting selection mode - keep selections for query filtering
  }, []);

  const toggleDocumentSelectionMode = useCallback(() => {
    setIsDocumentSelectionMode(prev => !prev);
    // Don't clear selection when toggling - keep selections for query filtering
  }, []);

  return (
    <DocumentSelectionContext.Provider
      value={{
        selectedDocumentIds,
        isDocumentSelectionMode,
        toggleDocumentSelection,
        clearSelectedDocuments,
        setDocumentSelectionMode,
        toggleDocumentSelectionMode,
      }}
    >
      {children}
    </DocumentSelectionContext.Provider>
  );
};

export const useDocumentSelection = () => {
  const context = useContext(DocumentSelectionContext);
  if (context === undefined) {
    throw new Error('useDocumentSelection must be used within a DocumentSelectionProvider');
  }
  return context;
};


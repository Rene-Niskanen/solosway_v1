"use client";

import * as React from "react";
import { FileAttachmentData } from "../components/FileAttachment";

interface PreviewContextType {
  previewFiles: FileAttachmentData[];
  activePreviewTabIndex: number;
  isPreviewOpen: boolean;
  setPreviewFiles: React.Dispatch<React.SetStateAction<FileAttachmentData[]>>;
  setActivePreviewTabIndex: React.Dispatch<React.SetStateAction<number>>;
  setIsPreviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  addPreviewFile: (file: FileAttachmentData) => void;
  MAX_PREVIEW_TABS: number;
}

const PreviewContext = React.createContext<PreviewContextType | undefined>(undefined);

export const PreviewProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const MAX_PREVIEW_TABS = 4;
  const [previewFiles, setPreviewFiles] = React.useState<FileAttachmentData[]>([]);
  const [activePreviewTabIndex, setActivePreviewTabIndex] = React.useState(0);
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(false);

  const addPreviewFile = React.useCallback((file: FileAttachmentData) => {
    setPreviewFiles(prev => {
      // Check if file is already in preview tabs
      const existingTabIndex = prev.findIndex(f => f.id === file.id);
      
      if (existingTabIndex !== -1) {
        // File is already open - refresh the File object to ensure it's valid
        // This fixes the issue where re-selecting the same document fails because the File object is stale
        const updatedFiles = [...prev];
        updatedFiles[existingTabIndex] = file; // Update with fresh File object
        setActivePreviewTabIndex(existingTabIndex);
        setIsPreviewOpen(true);
        return updatedFiles;
      } else {
        // Add new tab (limit to MAX_PREVIEW_TABS)
        if (prev.length >= MAX_PREVIEW_TABS) {
          // Remove oldest tab (first one) and add new one
          setActivePreviewTabIndex(MAX_PREVIEW_TABS - 1);
          setIsPreviewOpen(true);
          return [...prev.slice(1), file];
        } else {
          // Add new tab
          setActivePreviewTabIndex(prev.length);
          setIsPreviewOpen(true);
          return [...prev, file];
        }
      }
    });
  }, []);

  const value = React.useMemo(() => ({
    previewFiles,
    activePreviewTabIndex,
    isPreviewOpen,
    setPreviewFiles,
    setActivePreviewTabIndex,
    setIsPreviewOpen,
    addPreviewFile,
    MAX_PREVIEW_TABS
  }), [previewFiles, activePreviewTabIndex, isPreviewOpen, addPreviewFile]);

  return (
    <PreviewContext.Provider value={value}>
      {children}
    </PreviewContext.Provider>
  );
};

export const usePreview = () => {
  const context = React.useContext(PreviewContext);
  if (context === undefined) {
    throw new Error('usePreview must be used within a PreviewProvider');
  }
  return context;
};


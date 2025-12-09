"use client";

import * as React from "react";
import { FileAttachmentData } from "../components/FileAttachment";

// Highlight metadata for citation-based document viewing
export interface CitationChunkMetadata {
  chunk_index?: number;
  page_number?: number;
  content?: string;
  bbox?: {
    left: number;
    top: number;
    width: number;
    height: number;
    page?: number;
  };
}

export interface CitationHighlight {
  fileId: string;  // Match file.id in previewFiles array
  bbox: {
    left: number;
    top: number;
    width: number;
    height: number;
    page: number;
  };
  chunks?: CitationChunkMetadata[];
}

interface PreviewContextType {
  previewFiles: FileAttachmentData[];
  activePreviewTabIndex: number;
  isPreviewOpen: boolean;
  setPreviewFiles: React.Dispatch<React.SetStateAction<FileAttachmentData[]>>;
  setActivePreviewTabIndex: React.Dispatch<React.SetStateAction<number>>;
  setIsPreviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  addPreviewFile: (file: FileAttachmentData, highlight?: CitationHighlight) => void;
  highlightCitation: CitationHighlight | null;
  setHighlightCitation: React.Dispatch<React.SetStateAction<CitationHighlight | null>>;
  clearHighlightCitation: () => void;
  MAX_PREVIEW_TABS: number;
}

const PreviewContext = React.createContext<PreviewContextType | undefined>(undefined);

export const PreviewProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const MAX_PREVIEW_TABS = 4;
  const [previewFiles, setPreviewFiles] = React.useState<FileAttachmentData[]>([]);
  const [activePreviewTabIndex, setActivePreviewTabIndex] = React.useState(0);
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(false);
  const [highlightCitation, setHighlightCitation] = React.useState<CitationHighlight | null>(null);

  const clearHighlightCitation = React.useCallback(() => {
    setHighlightCitation(null);
  }, []);

  const addPreviewFile = React.useCallback((file: FileAttachmentData, highlight?: CitationHighlight) => {
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
        
        // Set highlight if provided
        if (highlight) {
          console.log('🖼️ [PreviewContext] Applying highlight to existing tab:', {
            fileId: file.id,
            bbox: highlight.bbox,
            chunks: highlight.chunks?.length
          });
          setHighlightCitation({
            ...highlight,
            fileId: file.id
          });
        }
        
        return updatedFiles;
      } else {
        // Add new tab (limit to MAX_PREVIEW_TABS)
        let newFiles: FileAttachmentData[];
        let newActiveIndex: number;
        
        if (prev.length >= MAX_PREVIEW_TABS) {
          // Remove oldest tab (first one) and add new one
          newActiveIndex = MAX_PREVIEW_TABS - 1;
          newFiles = [...prev.slice(1), file];
        } else {
          // Add new tab
          newActiveIndex = prev.length;
          newFiles = [...prev, file];
        }
        
        setActivePreviewTabIndex(newActiveIndex);
        setIsPreviewOpen(true);
        
        // Set highlight if provided
        if (highlight) {
          console.log('🖼️ [PreviewContext] Applying highlight to new tab:', {
            fileId: file.id,
            bbox: highlight.bbox,
            chunks: highlight.chunks?.length
          });
          setHighlightCitation({
            ...highlight,
            fileId: file.id
          });
        }
        
        return newFiles;
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
    highlightCitation,
    setHighlightCitation,
    clearHighlightCitation,
    MAX_PREVIEW_TABS
  }), [previewFiles, activePreviewTabIndex, isPreviewOpen, addPreviewFile, highlightCitation, clearHighlightCitation]);

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


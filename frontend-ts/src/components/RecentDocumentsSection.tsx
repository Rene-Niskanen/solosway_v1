"use client";

/**
 * RecentDocumentsSection - Displays recent documents across all projects
 * 
 * NOTE: Documents are linked to Properties (which = Projects in Velora).
 * Accepts documents as a prop from ProjectsPage (extracted from property hubs).
 */

import * as React from "react";
import { RecentDocumentCard, preloadDocumentThumbnails } from "./RecentDocumentCard";
import { usePreview } from "../contexts/PreviewContext";

interface DocumentData {
  id: string;
  original_filename: string;
  created_at: string;
  file_type?: string;
  property_id?: string;
  cover_image_url?: string;
  first_page_image_url?: string;
  s3_path?: string;
  updated_at?: string;
}

interface RecentDocumentsSectionProps {
  documents?: DocumentData[];
}

export const RecentDocumentsSection: React.FC<RecentDocumentsSectionProps> = ({ documents = [] }) => {
  const { openExpandedCardView } = usePreview();
  
  // Preload all thumbnails immediately when documents change (before render)
  React.useEffect(() => {
    if (documents.length > 0) {
      preloadDocumentThumbnails(documents);
    }
  }, [documents]);
  
  // Handle document click - open the document preview
  // openExpandedCardView now directly sets the document for user-triggered opens
  // The preview renders independently of chat panel visibility
  const handleDocumentClick = React.useCallback((doc: DocumentData) => {
    openExpandedCardView(doc.id, doc.original_filename);
  }, [openExpandedCardView]);
  
  // If no documents provided, don't show section
  if (!documents || documents.length === 0) {
    return null;
  }

  return (
    <>
      {/* Custom scrollbar styling for webkit browsers */}
      <style>{`
        .recent-docs-scroll::-webkit-scrollbar {
          height: 6px;
        }
        .recent-docs-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .recent-docs-scroll::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 3px;
        }
        .recent-docs-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.3);
        }
      `}</style>
      <div 
        className="recent-docs-scroll flex overflow-x-auto"
        style={{ 
          gap: '60px',
          paddingBottom: '8px',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(0, 0, 0, 0.2) transparent',
          width: '100%',
          minWidth: '100%',
        }}
      >
        {documents.map(doc => (
          <div key={doc.id} style={{ flexShrink: 0, width: '180px' }}>
            <RecentDocumentCard 
              document={doc}
              onClick={() => handleDocumentClick(doc)}
            />
          </div>
        ))}
      </div>
    </>
  );
};

export default RecentDocumentsSection;

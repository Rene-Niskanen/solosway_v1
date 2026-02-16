"use client";

/**
 * RecentDocumentsSection - Displays recent documents across all projects
 * 
 * NOTE: Documents are linked to Properties (which = Projects in Velora).
 * Accepts documents as a prop from ProjectsPage (extracted from property hubs).
 */

import * as React from "react";
import { RecentDocumentCard, preloadDocumentThumbnails, PRELOAD_THUMBNAIL_LIMIT } from "./RecentDocumentCard";
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
  /** When true, use smaller card size and gap (e.g. for projects page) */
  compact?: boolean;
  /** When false, hide overflow so the bar does not scroll (e.g. fixed 7-file bar) */
  scrollable?: boolean;
  /** When true, show all documents in a wrapping grid at the top (See All Files mode) */
  showAllMode?: boolean;
}

const CARD_WIDTH_COMPACT = 128;
const CARD_GAP = 14;
/** Spacing when showing all files grid - enough so cards don’t touch each other or edges */
const ALL_FILES_GRID_GAP = 28;
const ALL_FILES_GRID_PADDING = 16;

export const RecentDocumentsSection: React.FC<RecentDocumentsSectionProps> = ({
  documents = [],
  compact = false,
  scrollable = true,
  showAllMode = false,
}) => {
  const { openExpandedCardView } = usePreview();

  // Preload only first N thumbnails; rest load when cards scroll into view
  React.useEffect(() => {
    if (documents.length > 0) {
      preloadDocumentThumbnails(documents, PRELOAD_THUMBNAIL_LIMIT);
    }
  }, [documents]);

  const handleDocumentClick = React.useCallback((doc: DocumentData) => {
    openExpandedCardView(doc.id, doc.original_filename);
  }, [openExpandedCardView]);

  if (!documents || documents.length === 0) {
    return null;
  }

  const cardWidth = compact ? CARD_WIDTH_COMPACT : 180;
  const gap = compact ? CARD_GAP : 60;

  // See All Files: wrapping grid so all files are visible (page scrolls)
  if (showAllMode) {
    return (
      <div
        className="flex flex-wrap"
        style={{
          gap: ALL_FILES_GRID_GAP,
          padding: ALL_FILES_GRID_PADDING,
          paddingBottom: ALL_FILES_GRID_PADDING + 8,
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box',
          pointerEvents: 'auto',
        }}
      >
        {documents.map(doc => (
          <div key={doc.id} style={{ flexShrink: 0, width: cardWidth }}>
            <RecentDocumentCard
              document={doc}
              onClick={() => handleDocumentClick(doc)}
              compact={compact}
            />
          </div>
        ))}
      </div>
    );
  }

  // Files bar: fixed row, no horizontal scroll when scrollable is false
  return (
    <>
      {scrollable && (
        <style>{`
          .recent-docs-scroll::-webkit-scrollbar { height: 6px; }
          .recent-docs-scroll::-webkit-scrollbar-track { background: transparent; }
          .recent-docs-scroll::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.2); border-radius: 3px; }
          .recent-docs-scroll::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.3); }
        `}</style>
      )}
      <div
        className={scrollable ? 'recent-docs-scroll flex overflow-x-auto' : 'flex'}
        style={{
          gap,
          paddingBottom: compact ? 4 : 8,
          ...(scrollable && {
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255, 255, 255, 0.25) transparent',
          }),
          width: '100%',
          minWidth: '100%',
          pointerEvents: 'auto',
          overflowX: scrollable ? 'auto' : 'hidden',
        }}
      >
        {documents.map(doc => (
          <div key={doc.id} style={{ flexShrink: 0, width: cardWidth }}>
            <RecentDocumentCard
              document={doc}
              onClick={() => handleDocumentClick(doc)}
              compact={compact}
            />
          </div>
        ))}
      </div>
    </>
  );
};

export default RecentDocumentsSection;

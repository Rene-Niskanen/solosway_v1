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
import { useFilingSidebar } from "../contexts/FilingSidebarContext";

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
  /** When true (e.g. on Projects page), use no left padding in showAllMode so content aligns with sibling sections */
  alignLeftWithContainer?: boolean;
  /** Called when a file is clicked – collapse main sidebar to small (icons-only) state */
  onCollapseSidebarToSmall?: () => void;
}

const CARD_WIDTH_COMPACT = 128;
const CARD_GAP = 20;
const REGULAR_CARD_GAP = 28;
const ALL_FILES_GRID_GAP = 24;
const ALL_FILES_GRID_PADDING = 6;

export const RecentDocumentsSection: React.FC<RecentDocumentsSectionProps> = ({
  documents = [],
  compact = false,
  scrollable = true,
  showAllMode = false,
  alignLeftWithContainer = false,
  onCollapseSidebarToSmall,
}) => {
  const { openExpandedCardView } = usePreview();
  const { closeSidebar: closeFilingSidebar } = useFilingSidebar();

  // Preload only first N thumbnails; rest load when cards scroll into view
  React.useEffect(() => {
    if (documents.length > 0) {
      preloadDocumentThumbnails(documents, PRELOAD_THUMBNAIL_LIMIT);
    }
  }, [documents]);

  const handleDocumentClick = React.useCallback((doc: DocumentData) => {
    onCollapseSidebarToSmall?.(); // Collapse main sidebar to small (icons-only) when opening a file from projects
    closeFilingSidebar(); // Collapse FilingSidebar if open
    openExpandedCardView(doc.id, doc.original_filename);
  }, [onCollapseSidebarToSmall, closeFilingSidebar, openExpandedCardView]);

  if (!documents || documents.length === 0) {
    return null;
  }

  const cardWidth = compact ? CARD_WIDTH_COMPACT : 180;
  const gap = compact ? CARD_GAP : REGULAR_CARD_GAP;

  // See All Files: wrapping grid so all files are visible (page scrolls)
  if (showAllMode) {
    return (
      <div
        className="flex flex-wrap"
        style={{
          gap: ALL_FILES_GRID_GAP,
          padding: ALL_FILES_GRID_PADDING,
          paddingBottom: ALL_FILES_GRID_PADDING + 18,
          ...(alignLeftWithContainer && { paddingLeft: 0 }),
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box',
          pointerEvents: 'auto',
          alignItems: 'flex-start',
        }}
      >
        {documents.map((doc, index) => (
          <div key={doc.id} style={{ flexShrink: 0, width: cardWidth }}>
            <RecentDocumentCard
              document={doc}
              onClick={() => handleDocumentClick(doc)}
              compact={compact}
              priority={index < 2}
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
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          paddingTop: 2,
          paddingBottom: compact ? 6 : 10,
          paddingLeft: 0,
          paddingRight: scrollable ? 8 : 0,
          ...(scrollable && {
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(255, 255, 255, 0.25) transparent',
            maskImage: 'linear-gradient(to right, transparent 0, black 16px, black calc(100% - 20px), transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to right, transparent 0, black 16px, black calc(100% - 20px), transparent 100%)',
          }),
          width: '100%',
          minWidth: '100%',
          pointerEvents: 'auto',
          overflowX: scrollable ? 'auto' : 'hidden',
        }}
      >
        {documents.map((doc, index) => (
          <div key={doc.id} style={{ flexShrink: 0, width: cardWidth }}>
            <RecentDocumentCard
              document={doc}
              onClick={() => handleDocumentClick(doc)}
              compact={compact}
              priority={index < 2}
            />
          </div>
        ))}
      </div>
    </>
  );
};

export default RecentDocumentsSection;

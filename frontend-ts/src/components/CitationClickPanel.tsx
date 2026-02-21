"use client";

import * as React from "react";
import { ChevronDown, FileSearchCorner, Loader2, MessageCircle, Save } from "lucide-react";

/** Debug payload from backend: why this bbox was chosen (for citation mapping diagnosis). */
export interface CitationDebugInfo {
  short_id?: string;
  citation_number?: number;
  cited_text_for_bbox?: string;
  distinctive_values?: string[];
  chosen_bbox?: { left?: number; top?: number; width?: number; height?: number; page?: number } | null;
  block_id?: string | null;
  block_index?: number | null;
  block_type?: string | null;
  block_content_preview?: string | null;
  match_score?: number | null;
  source?: "block" | "chunk";
  num_blocks_considered?: number;
}

export interface CitationClickPanelData {
  doc_id: string;
  original_filename?: string | null;
  page?: number;
  page_number?: number;
  bbox?: { left: number; top: number; width: number; height: number; page?: number };
  block_content?: string;
  cited_text?: string;
  classification_type?: string;
  debug?: CitationDebugInfo | null;
}

export interface CachedPageImage {
  pageImage: string;
  imageWidth: number;
  imageHeight: number;
}

/** Result of computeCitationPreviewTransform for use in CitationPagePreviewContent. */
export interface CitationPreviewTransform {
  safeZoom: number;
  safeTranslateX: number;
  safeTranslateY: number;
  finalBboxLeft: number;
  finalBboxTop: number;
  finalBboxWidth: number;
  finalBboxHeight: number;
}

/**
 * Compute zoom/translate and bbox overlay position so the citation bbox is centered and visible.
 * Bbox is in normalized 0–1 coordinates. Safe to call with any container dimensions.
 */
export function computeCitationPreviewTransform(
  bbox: { left: number; top: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number
): CitationPreviewTransform {
  // Use actual container dimensions so the bbox is fully visible (no clipping at bottom/edges)
  const previewWidth = containerWidth;
  const previewHeight = containerHeight;

  const originalBboxWidth = bbox.width * imageWidth;
  const originalBboxHeight = bbox.height * imageHeight;
  const originalBboxLeft = bbox.left * imageWidth;
  const originalBboxTop = bbox.top * imageHeight;
  const centerX = originalBboxLeft + originalBboxWidth / 2;
  const centerY = originalBboxTop + originalBboxHeight / 2;

  const logoHeight = 0.02 * imageHeight;
  const minBboxHeightPx = logoHeight;
  const baseBboxHeight = Math.max(originalBboxHeight, minBboxHeightPx);
  const bboxPadding = 4;
  const finalBboxWidth = originalBboxWidth + bboxPadding * 2;
  const finalBboxHeight = baseBboxHeight === minBboxHeightPx ? minBboxHeightPx : baseBboxHeight + bboxPadding * 2;
  const bboxLeft = Math.max(0, centerX - finalBboxWidth / 2);
  const bboxTop = Math.max(0, centerY - finalBboxHeight / 2);
  const constrainedLeft = Math.min(bboxLeft, imageWidth - finalBboxWidth);
  const constrainedTop = Math.min(bboxTop, imageHeight - finalBboxHeight);
  const finalBboxLeft = Math.max(0, constrainedLeft);
  const finalBboxTop = Math.max(0, constrainedTop);

  // Center the bbox in the viewport with even padding on all sides (tighter = more zoomed-in)
  const previewPadding = 8;
  const availableWidth = previewWidth - previewPadding * 2;
  const availableHeight = previewHeight - previewPadding * 2;
  // Uniform padding around bbox in image pixels so zoom fits bbox + padding (smaller = zoomed in closer)
  const uniformBboxPaddingPx = Math.min(imageWidth, imageHeight) * 0.012;
  const contentWidth = Math.max(originalBboxWidth + uniformBboxPaddingPx * 2, 1);
  const contentHeight = Math.max(originalBboxHeight + uniformBboxPaddingPx * 2, 1);
  const zoomForWidth = availableWidth / contentWidth;
  const zoomForHeight = availableHeight / contentHeight;
  const rawZoom = Math.min(zoomForWidth, zoomForHeight);
  const zoom = Math.min(1.2, rawZoom);

  // Place bbox center at viewport center for even padding
  const idealTranslateX = previewWidth / 2 - centerX * zoom;
  const idealTranslateY = previewHeight / 2 - centerY * zoom;
  // Clamp so we don't show area outside the image
  const minTranslateX = previewWidth - imageWidth * zoom;
  const maxTranslateX = 0;
  const minTranslateY = previewHeight - imageHeight * zoom;
  const maxTranslateY = 0;
  const translateX = Math.max(minTranslateX, Math.min(maxTranslateX, idealTranslateX));
  const translateY = Math.max(minTranslateY, Math.min(maxTranslateY, idealTranslateY));

  return {
    safeZoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
    safeTranslateX: Number.isFinite(translateX) ? translateX : 0,
    safeTranslateY: Number.isFinite(translateY) ? translateY : 0,
    finalBboxLeft,
    finalBboxTop,
    finalBboxWidth,
    finalBboxHeight,
  };
}

/** Presentational preview: scroll container + image + optional bbox overlay. Use with computeCitationPreviewTransform. */
export const CitationPagePreviewContent: React.FC<{
  cachedPageImage: CachedPageImage;
  transform: CitationPreviewTransform;
  showBbox: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** When true, prevents scroll/pan so the preview is fixed (e.g. in citation callouts). */
  disableScroll?: boolean;
}> = ({ cachedPageImage, transform, showBbox, className, style, disableScroll }) => (
  <div
    className={className ?? "citation-panel-preview-scroll"}
    style={{
      position: "absolute",
      left: "50%",
      top: "50%",
      width: "100%",
      height: "100%",
      transform: "translate(-50%, -50%)",
      overflow: disableScroll ? "hidden" : "auto",
      scrollbarWidth: "none",
      msOverflowStyle: "none",
      ...(disableScroll
        ? { touchAction: "none", overscrollBehavior: "none" as const }
        : {}),
      ...style,
    }}
  >
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: `translate(${transform.safeTranslateX}px, ${transform.safeTranslateY}px) scale(${transform.safeZoom})`,
        transformOrigin: "0 0",
        width: `${cachedPageImage.imageWidth}px`,
        height: `${cachedPageImage.imageHeight}px`,
      }}
    >
      <img
        src={cachedPageImage.pageImage}
        alt="Document preview"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: `${cachedPageImage.imageWidth}px`,
          height: `${cachedPageImage.imageHeight}px`,
          pointerEvents: "none",
        }}
      />
      {showBbox && (
        <div
          style={{
            position: "absolute",
            left: `${transform.finalBboxLeft}px`,
            top: `${transform.finalBboxTop}px`,
            width: `${Math.min(cachedPageImage.imageWidth, transform.finalBboxWidth)}px`,
            height: `${Math.min(cachedPageImage.imageHeight, transform.finalBboxHeight)}px`,
            backgroundColor: "rgba(188, 212, 235, 0.4)",
            borderRadius: "2px",
            border: "none",
            pointerEvents: "none",
            zIndex: 10,
          }}
        />
      )}
    </div>
  </div>
);

const PANEL_WIDTH = 400;
const PANEL_MAX_HEIGHT_VH = 75;
const GAP = 12;
const VIEWPORT_MARGIN = 8;
const ESTIMATED_PANEL_HEIGHT = 460;

/**
 * Position panel near the clicked citation with a consistent GAP above or below.
 * Prefers opening upward; opens below when there isn’t enough room above.
 * Keeps the panel entirely to the right or left of the citation so it never covers
 * the cited text or the citation marker.
 */
function clampPanelPosition(
  anchorRect: DOMRect,
  panelWidth: number,
  panelHeight: number
): { left: number; top?: number; bottom?: number; openAbove: boolean } {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  // Horizontal: align panel with anchor (left edge), then clamp to viewport so it never overlaps
  let left = anchorRect.left;
  if (left + panelWidth > vw - VIEWPORT_MARGIN) {
    left = vw - panelWidth - VIEWPORT_MARGIN;
  }
  if (left < VIEWPORT_MARGIN) {
    left = VIEWPORT_MARGIN;
  }

  // Prefer below: panel top = citation bottom + GAP so the panel never covers the cited text or markers
  const topIfBelow = anchorRect.bottom + GAP;
  const fitsBelow = topIfBelow + panelHeight <= vh - VIEWPORT_MARGIN;

  if (fitsBelow) {
    let top = topIfBelow;
    if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;
    return { left, top, openAbove: false };
  }

  // Consider opening above only if the full panel fits entirely above the anchor (no overlap)
  const panelBottomIfAbove = anchorRect.top - GAP;
  const panelTopIfAbove = panelBottomIfAbove - panelHeight;
  const fitsAboveWithoutOverlap = panelTopIfAbove >= VIEWPORT_MARGIN;

  if (fitsAboveWithoutOverlap) {
    const bottom = vh - panelBottomIfAbove;
    return { left, bottom, openAbove: true };
  }

  // Not enough room above without overlapping: open below and clamp to viewport
  let top = anchorRect.bottom + GAP;
  if (top + panelHeight > vh - VIEWPORT_MARGIN) {
    top = vh - panelHeight - VIEWPORT_MARGIN;
  }
  if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;
  return { left, top, openAbove: false };
}

export interface CitationClickPanelProps {
  citationData: CitationClickPanelData;
  anchorRect: DOMRect;
  cachedPageImage: CachedPageImage | null;
  onViewInDocument: () => void;
  onAskFollowUp: () => void;
  onSaveCitation?: () => void;
  onClose: () => void;
  /** When true, show View document + Ask follow up (and Save if provided) in the panel overlay. Use for the click-on-citation popup; leave false for inline callouts. */
  showFullActions?: boolean;
  /** When provided, show this in the cited-text container (same text as the run highlighted in the message for this citation). */
  messageCitedExcerpt?: string;
}

export const CitationClickPanel: React.FC<CitationClickPanelProps> = ({
  citationData,
  anchorRect,
  cachedPageImage,
  onViewInDocument,
  onAskFollowUp,
  onSaveCitation,
  onClose,
  showFullActions = false,
  messageCitedExcerpt: messageCitedExcerptProp,
}) => {
  const maxHeightPx = typeof window !== "undefined" ? (window.innerHeight * PANEL_MAX_HEIGHT_VH) / 100 : 500;
  const position = clampPanelPosition(anchorRect, PANEL_WIDTH, Math.min(ESTIMATED_PANEL_HEIGHT, maxHeightPx));
  const { left, top, bottom, openAbove } = position;

  const filename = citationData.original_filename || "Document";
  const pageNum = citationData.page ?? citationData.bbox?.page ?? citationData.page_number ?? 1;
  const docTypeLabel = citationData.classification_type
    ? citationData.classification_type.replace(/_/g, " ")
    : "PDF Document";
  const displayDocType = docTypeLabel === "Document" ? "PDF Document" : docTypeLabel;

  const previewContainerRef = React.useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = React.useState({ width: PANEL_WIDTH, height: 280 });
  const [debugExpanded, setDebugExpanded] = React.useState(false);
  const [isPreviewHovered, setIsPreviewHovered] = React.useState(false);
  const debug = citationData.debug;

  React.useLayoutEffect(() => {
    const el = previewContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setPreviewSize({ width: el.offsetWidth, height: el.offsetHeight });
    });
    ro.observe(el);
    setPreviewSize({ width: el.offsetWidth, height: el.offsetHeight });
    return () => ro.disconnect();
  }, []);

  const bbox = citationData.bbox;
  const hasBbox = bbox && typeof bbox.left === "number" && typeof bbox.top === "number" && typeof bbox.width === "number" && typeof bbox.height === "number";

  const previewWidth = Math.max(previewSize.width, 280);
  const previewHeight = Math.max(previewSize.height, 200);

  const transform = React.useMemo(() => {
    if (!cachedPageImage || !hasBbox || !bbox) {
      return {
        safeZoom: 1 as number,
        safeTranslateX: 0,
        safeTranslateY: 0,
        finalBboxLeft: 0,
        finalBboxTop: 0,
        finalBboxWidth: 0,
        finalBboxHeight: 0,
      };
    }
    return computeCitationPreviewTransform(
      bbox,
      cachedPageImage.imageWidth,
      cachedPageImage.imageHeight,
      previewWidth,
      previewHeight
    );
  }, [cachedPageImage, hasBbox, bbox, previewWidth, previewHeight]);

  return (
    <>
      <style>{`
        .citation-panel-preview-scroll::-webkit-scrollbar { display: none; }
      `}</style>
    <div
      role="dialog"
      aria-label="Citation preview"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: `${left}px`,
        ...(openAbove && bottom !== undefined ? { bottom: `${bottom}px` } : { top: `${top}px` }),
        width: `${PANEL_WIDTH}px`,
        minHeight: 420,
        maxHeight: `${PANEL_MAX_HEIGHT_VH}vh`,
        backgroundColor: "#FFFFFF",
        borderRadius: "10px",
        border: "1px solid rgba(0,0,0,0.08)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 10055,
      }}
    >
      {/* Header: same layout and styling as citation callout in SideChatPanel (icon + filename + Page N on one row) */}
      <div
        style={{
          flexShrink: 0,
          padding: "8px 16px 6px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid #f0f0f0",
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            backgroundColor: "#FFFFFF",
            border: "1px solid rgba(0,0,0,0.08)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            overflow: "hidden",
          }}
        >
          <img
            src="/PDF.png"
            alt="PDF"
            style={{ width: 14, height: 14, objectFit: "contain" }}
          />
        </div>
        <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap" }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: "11px",
              color: "#1f2937",
              lineHeight: 1.25,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {filename}
          </div>
          <div
            style={{
              fontSize: "11px",
              color: "#6b7280",
              lineHeight: 1.25,
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            {displayDocType} · Page {pageNum}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close citation"
          style={{
            flexShrink: 0,
            width: 26,
            height: 26,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            borderRadius: "6px",
            background: "transparent",
            color: "#6b7280",
            fontSize: "16px",
            lineHeight: 1,
            cursor: "pointer",
            marginRight: -4,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#f3f4f6";
            e.currentTarget.style.color = "#374151";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "#6b7280";
          }}
        >
          <ChevronDown size={16} strokeWidth={2} />
        </button>
      </div>

      {/* Citation debug: why this bbox was chosen (for diagnosing wrong highlights) */}
      {debug && (
        <div style={{ flexShrink: 0, borderBottom: "1px solid #f0f0f0" }}>
          <button
            type="button"
            onClick={() => setDebugExpanded((e) => !e)}
            style={{
              width: "100%",
              padding: "8px 16px",
              textAlign: "left",
              fontSize: "11px",
              fontWeight: 600,
              color: "#6b7280",
              background: "#f9fafb",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            Citation debug (bbox choice)
            <span style={{ fontSize: "10px", color: "#9ca3af" }}>{debugExpanded ? "▼" : "▶"}</span>
          </button>
          {debugExpanded && (
            <pre
              style={{
                margin: 0,
                padding: "12px 16px 14px",
                fontSize: "10px",
                lineHeight: 1.45,
                color: "#374151",
                background: "#f3f4f6",
                overflow: "auto",
                maxHeight: 220,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "ui-monospace, monospace",
                borderTop: "1px solid #e5e7eb",
              }}
            >
              {[
                `short_id: ${debug.short_id ?? "—"}`,
                `citation_number: ${debug.citation_number ?? "—"}`,
                `source: ${debug.source ?? "—"} (block = one block chosen, chunk = fallback)`,
                `block_id: ${debug.block_id ?? "—"}`,
                `block_index: ${debug.block_index ?? "—"}`,
                `block_type: ${debug.block_type ?? "—"}`,
                `match_score: ${debug.match_score ?? "—"}`,
                `num_blocks_considered: ${debug.num_blocks_considered ?? "—"}`,
                "",
                "cited_text_for_bbox (exact sentence used for matching):",
                (debug.cited_text_for_bbox ?? "—").slice(0, 500) + ((debug.cited_text_for_bbox?.length ?? 0) > 500 ? "…" : ""),
                "",
                "distinctive_values extracted:",
                (debug.distinctive_values?.length ? debug.distinctive_values.join(", ") : "—"),
                "",
                "chosen_bbox:",
                debug.chosen_bbox ? JSON.stringify(debug.chosen_bbox, null, 2) : "—",
                "",
                "block_content_preview (selected block text):",
                (debug.block_content_preview ?? "—").slice(0, 400) + ((debug.block_content_preview?.length ?? 0) > 400 ? "…" : ""),
              ].join("\n")}
            </pre>
          )}
        </div>
      )}

      {/* Content: scrollable with hidden scrollbar; buttons overlay on top of document; Ask follow up shows on hover */}
      <div
        ref={previewContainerRef}
        onMouseEnter={() => setIsPreviewHovered(true)}
        onMouseLeave={() => setIsPreviewHovered(false)}
        style={{
          width: "100%",
          flex: "1 1 0%",
          minHeight: 280,
          position: "relative",
          overflow: "hidden",
          backgroundColor: "#f9fafb",
        }}
      >
        {/* Citation render area - scrollable, scrollbar hidden via class */}
        {cachedPageImage ? (
          <CitationPagePreviewContent
            cachedPageImage={cachedPageImage}
            transform={transform}
            showBbox={!!hasBbox}
            className="citation-panel-preview-scroll"
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#f3f4f6",
            }}
          >
            {(() => {
              const name = (citationData.original_filename || "").toLowerCase();
              const isWordDoc = name.endsWith(".docx") || name.endsWith(".doc");
              if (isWordDoc) {
                return (
                  <div style={{ color: "#6b7280", fontSize: "13px", textAlign: "center", padding: 16 }}>
                    Preview not available for Word documents. Use &quot;View in document&quot; to open the file.
                  </div>
                );
              }
              return (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#6b7280", fontSize: "13px" }}>
                  <Loader2 className="w-6 h-6 animate-spin" strokeWidth={2} />
                  <span>Loading preview…</span>
                </div>
              );
            })()}
          </div>
        )}

        {/* Buttons overlay: same container/button design as citation bar above chat (View, Accept, Next citation) */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "10px 16px 12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
            background: "linear-gradient(to top, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.5) 35%, transparent 55%)",
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          <div
            className="flex items-center justify-center gap-2 flex-shrink-0"
            style={{ gap: "8.8px", flexWrap: "wrap", pointerEvents: "auto" }}
          >
            {showFullActions && (
              <button
                type="button"
                title="View"
                onClick={onViewInDocument}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4.4,
                  padding: "3.3px 6.6px",
                  fontSize: "12px",
                  lineHeight: 1,
                  fontWeight: 600,
                  color: "#374151",
                  backgroundColor: "#ffffff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 5.5,
                  cursor: "pointer",
                  transition: "background-color 0.15s ease, box-shadow 0.15s ease",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                  outline: "none",
                  minHeight: 26,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#f3f4f6"; }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.backgroundColor = "#ffffff";
                  el.style.boxShadow = "0 1px 2px rgba(0,0,0,0.08)";
                }}
                onFocus={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 2px rgba(0,0,0,0.08), 0 0 0 2px #fff"; }}
                onBlur={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 2px rgba(0,0,0,0.08)"; }}
              >
                <FileSearchCorner style={{ width: 14, height: 14 }} strokeWidth={2} stroke="currentColor" />
                View
              </button>
            )}
            {(showFullActions || isPreviewHovered) && (
              <button
                type="button"
                title="Ask Follow Up"
                onClick={onAskFollowUp}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4.4,
                  padding: "3.3px 6.6px",
                  fontSize: "12px",
                  lineHeight: 1,
                  fontWeight: 500,
                  color: "#374151",
                  backgroundColor: "#ffffff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 5.5,
                  cursor: "pointer",
                  transition: "background-color 0.15s ease, box-shadow 0.15s ease",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                  outline: "none",
                  minHeight: 26,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#f3f4f6"; }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.backgroundColor = "#ffffff";
                  el.style.boxShadow = "0 1px 2px rgba(0,0,0,0.08)";
                }}
                onFocus={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 2px rgba(0,0,0,0.08), 0 0 0 2px #fff"; }}
                onBlur={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 2px rgba(0,0,0,0.08)"; }}
              >
                <MessageCircle style={{ width: 14, height: 14 }} strokeWidth={2} stroke="currentColor" />
                Ask Follow Up
              </button>
            )}
            {onSaveCitation && (showFullActions || isPreviewHovered) && (
              <button
                type="button"
                title="Save"
                onClick={onSaveCitation}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4.4,
                  padding: "3.3px 6.6px",
                  fontSize: "12px",
                  lineHeight: 1,
                  fontWeight: 500,
                  color: "#374151",
                  backgroundColor: "#ffffff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 5.5,
                  cursor: "pointer",
                  transition: "background-color 0.15s ease, box-shadow 0.15s ease",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                  outline: "none",
                  minHeight: 26,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#f3f4f6"; }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.backgroundColor = "#ffffff";
                  el.style.boxShadow = "0 1px 2px rgba(0,0,0,0.08)";
                }}
                onFocus={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 2px rgba(0,0,0,0.08), 0 0 0 2px #fff"; }}
                onBlur={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 2px rgba(0,0,0,0.08)"; }}
              >
                <Save size={14} strokeWidth={2} stroke="currentColor" />
                Save
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
};

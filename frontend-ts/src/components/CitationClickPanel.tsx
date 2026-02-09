"use client";

import * as React from "react";
import { FileSearchCorner, MessageCircle } from "lucide-react";
import veloraLogo from "/Velora Logo.jpg";

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

const PANEL_WIDTH = 400;
const PANEL_MAX_HEIGHT_VH = 75;
const GAP = 12;
const VIEWPORT_MARGIN = 8;
const ESTIMATED_PANEL_HEIGHT = 460;

/**
 * Position panel near the clicked citation with a consistent GAP above or below.
 * Prefers opening upward; opens below when there isn’t enough room above.
 */
function clampPanelPosition(
  anchorRect: DOMRect,
  panelWidth: number,
  panelHeight: number
): { left: number; top: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  // Align panel's left edge with citation's left edge (bottom-left of panel near citation)
  let left = anchorRect.left;
  if (left + panelWidth > vw - VIEWPORT_MARGIN) {
    left = vw - panelWidth - VIEWPORT_MARGIN;
  }
  if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;

  // Prefer above: panel bottom = citation top - GAP (same gap as below)
  let top = anchorRect.top - GAP - panelHeight;
  let openAbove = top >= VIEWPORT_MARGIN;

  if (!openAbove) {
    // Not enough room above: open below with same GAP (panel top = citation bottom + GAP)
    top = anchorRect.bottom + GAP;
  }

  // Viewport clamp: keep panel on screen. If we're above and clamping would push the panel down
  // (increasing the gap), switch to below so the gap stays GAP.
  if (top + panelHeight > vh - VIEWPORT_MARGIN) {
    if (openAbove) {
      top = anchorRect.bottom + GAP;
      if (top + panelHeight > vh - VIEWPORT_MARGIN) {
        top = vh - panelHeight - VIEWPORT_MARGIN;
      }
    } else {
      top = vh - panelHeight - VIEWPORT_MARGIN;
    }
  }
  if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;

  return { left, top };
}

export interface CitationClickPanelProps {
  citationData: CitationClickPanelData;
  anchorRect: DOMRect;
  cachedPageImage: CachedPageImage | null;
  onViewInDocument: () => void;
  onAskFollowUp: () => void;
  onClose: () => void;
}

export const CitationClickPanel: React.FC<CitationClickPanelProps> = ({
  citationData,
  anchorRect,
  cachedPageImage,
  onViewInDocument,
  onAskFollowUp,
  onClose,
}) => {
  const maxHeightPx = typeof window !== "undefined" ? (window.innerHeight * PANEL_MAX_HEIGHT_VH) / 100 : 500;
  const { left, top } = clampPanelPosition(anchorRect, PANEL_WIDTH, Math.min(ESTIMATED_PANEL_HEIGHT, maxHeightPx));

  const filename = citationData.original_filename || "Document";
  const pageNum = citationData.page ?? citationData.bbox?.page ?? citationData.page_number ?? 1;
  const docTypeLabel = citationData.classification_type
    ? citationData.classification_type.replace(/_/g, " ")
    : "PDF Document";
  const displayDocType = docTypeLabel === "Document" ? "PDF Document" : docTypeLabel;

  const previewContainerRef = React.useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = React.useState({ width: PANEL_WIDTH, height: 280 });
  const [debugExpanded, setDebugExpanded] = React.useState(false);
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

  // Match hover preview fixed dimensions so zoom/translate math is identical (hover uses previewWidth=280, previewHeight=200)
  const previewWidth = Math.max(previewSize.width, 280);
  const previewHeight = Math.max(previewSize.height, 200);

  // === IDENTICAL to citation hover preview: BBOX positioning, logo, zoom/translate (same as StandaloneExpandedCardView) ===
  let zoom = 1;
  let translateX = 0;
  let translateY = 0;
  let finalBboxLeft = 0;
  let finalBboxTop = 0;
  let finalBboxWidth = 0;
  let finalBboxHeight = 0;
  let logoLeft = 0;
  let logoTop = 0;
  let logoWidth = 0;
  let logoHeight = 0;

  if (cachedPageImage && hasBbox) {
    const imageWidth = cachedPageImage.imageWidth;
    const imageHeight = cachedPageImage.imageHeight;

    // BBOX in image pixels (same as hover preview)
    const originalBboxWidth = bbox.width * imageWidth;
    const originalBboxHeight = bbox.height * imageHeight;
    const originalBboxLeft = bbox.left * imageWidth;
    const originalBboxTop = bbox.top * imageHeight;
    const centerX = originalBboxLeft + originalBboxWidth / 2;
    const centerY = originalBboxTop + originalBboxHeight / 2;

    logoHeight = 0.02 * imageHeight;
    logoWidth = logoHeight;
    const minBboxHeightPx = logoHeight;
    const baseBboxHeight = Math.max(originalBboxHeight, minBboxHeightPx);
    const bboxPadding = 4;
    finalBboxWidth = originalBboxWidth + bboxPadding * 2;
    finalBboxHeight = baseBboxHeight === minBboxHeightPx ? minBboxHeightPx : baseBboxHeight + bboxPadding * 2;
    const bboxLeft = Math.max(0, centerX - finalBboxWidth / 2);
    const bboxTop = Math.max(0, centerY - finalBboxHeight / 2);
    const constrainedLeft = Math.min(bboxLeft, imageWidth - finalBboxWidth);
    const constrainedTop = Math.min(bboxTop, imageHeight - finalBboxHeight);
    finalBboxLeft = Math.max(0, constrainedLeft);
    finalBboxTop = Math.max(0, constrainedTop);
    logoLeft = finalBboxLeft - logoWidth + 2;
    logoTop = finalBboxTop;

    // Zoom/crop - identical to hover preview
    const previewPadding = 15;
    const availableWidth = previewWidth - previewPadding * 2;
    const availableHeight = previewHeight - previewPadding * 2;
    const combinedLeft = logoLeft;
    const combinedRight = finalBboxLeft + finalBboxWidth;
    const combinedWidth = combinedRight - combinedLeft;
    const combinedCenterX = (combinedLeft + combinedRight) / 2;
    const combinedCenterY = finalBboxTop + finalBboxHeight / 2;
    const zoomForWidth = combinedWidth > 0 ? availableWidth / combinedWidth : 0.7;
    const zoomForHeight = finalBboxHeight > 0 ? availableHeight / finalBboxHeight : 0.7;
    const rawZoom = Math.min(zoomForWidth, zoomForHeight);
    zoom = Math.min(0.7, rawZoom);

    const idealTranslateX = previewWidth / 2 - combinedCenterX * zoom;
    const idealTranslateY = previewHeight / 2 - combinedCenterY * zoom;
    const viewMargin = 10;
    const scaledBboxLeft = combinedLeft * zoom;
    const scaledBboxRight = combinedRight * zoom;
    const scaledBboxTop = finalBboxTop * zoom;
    const scaledBboxBottom = (finalBboxTop + finalBboxHeight) * zoom;
    const minTranslateX = viewMargin - scaledBboxLeft;
    const maxTranslateX = previewWidth - viewMargin - scaledBboxRight;
    const minTranslateY = viewMargin - scaledBboxTop;
    const maxTranslateY = previewHeight - viewMargin - scaledBboxBottom;
    translateX = minTranslateX > maxTranslateX ? (minTranslateX + maxTranslateX) / 2 : Math.max(minTranslateX, Math.min(maxTranslateX, idealTranslateX));
    translateY = minTranslateY > maxTranslateY ? (minTranslateY + maxTranslateY) / 2 : Math.max(minTranslateY, Math.min(maxTranslateY, idealTranslateY));
  }

  // Ensure valid numbers so the transform never hides the image (guard against NaN/Infinity from edge cases)
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const safeTranslateX = Number.isFinite(translateX) ? translateX : 0;
  const safeTranslateY = Number.isFinite(translateY) ? translateY : 0;

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
        top: `${top}px`,
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
      {/* Header */}
      <div
        style={{
          flexShrink: 0,
          padding: "14px 16px 10px",
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
          borderBottom: "1px solid #f0f0f0",
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "8px",
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
            style={{ width: 18, height: 18, objectFit: "contain" }}
          />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: "13px",
              color: "#1f2937",
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {filename}
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "#9ca3af",
              marginTop: "2px",
            }}
          >
            {displayDocType} · Page {pageNum}
          </div>
        </div>
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

      {/* Content: scrollable with hidden scrollbar; buttons overlay on top of document */}
      <div
        ref={previewContainerRef}
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
          <div
            className="citation-panel-preview-scroll"
            style={{
              position: "absolute",
              inset: 0,
              overflow: "auto",
              scrollbarWidth: "none",
              msOverflowStyle: "none",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                transform: `translate(${safeTranslateX}px, ${safeTranslateY}px) scale(${safeZoom})`,
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
              {hasBbox && (
                <>
                  <img
                    src={veloraLogo}
                    alt="Velora"
                    style={{
                      position: "absolute",
                      left: `${logoLeft}px`,
                      top: `${logoTop}px`,
                      width: `${logoWidth}px`,
                      height: `${logoHeight}px`,
                      objectFit: "contain",
                      pointerEvents: "none",
                      zIndex: 11,
                      userSelect: "none",
                      border: "2px solid rgba(255, 193, 7, 0.9)",
                      borderRadius: "2px",
                      backgroundColor: "white",
                      boxSizing: "border-box",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: `${finalBboxLeft}px`,
                      top: `${finalBboxTop}px`,
                      width: `${Math.min(cachedPageImage.imageWidth, finalBboxWidth)}px`,
                      height: `${Math.min(cachedPageImage.imageHeight, finalBboxHeight)}px`,
                      backgroundColor: "rgba(255, 235, 59, 0.4)",
                      border: "2px solid rgba(255, 193, 7, 0.9)",
                      borderRadius: "2px",
                      pointerEvents: "none",
                      zIndex: 10,
                      boxShadow: "0 2px 8px rgba(255, 193, 7, 0.3)",
                    }}
                  />
                </>
              )}
            </div>
          </div>
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
            <div style={{ color: "#6b7280", fontSize: "13px" }}>Loading preview…</div>
          </div>
        )}

        {/* Buttons overlay - on top of document area, no solid white strip */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "10px 16px 12px",
            display: "flex",
            justifyContent: "space-between",
            gap: "10px",
            background: "linear-gradient(to top, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.5) 50%, transparent 100%)",
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          <button
            type="button"
            onClick={onAskFollowUp}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "5px",
              padding: "6px 12px",
              fontSize: "12px",
              fontWeight: 400,
              color: "#374151",
              backgroundColor: "rgba(255, 255, 255, 0.95)",
              border: "1px solid #d1d5db",
              borderRadius: "20px",
              cursor: "pointer",
              transition: "background-color 0.15s ease",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              pointerEvents: "auto",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#f9fafb"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255, 255, 255, 0.95)"; }}
          >
            <MessageCircle style={{ width: 14, height: 14 }} strokeWidth={2} />
            Ask follow up
          </button>
          <button
            type="button"
            onClick={onViewInDocument}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "5px",
              padding: "6px 12px",
              fontSize: "12px",
              fontWeight: 400,
              color: "#374151",
              backgroundColor: "rgba(255, 255, 255, 0.95)",
              border: "1px solid #d1d5db",
              borderRadius: "20px",
              cursor: "pointer",
              transition: "background-color 0.15s ease",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
              pointerEvents: "auto",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#f9fafb"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255, 255, 255, 0.95)"; }}
          >
            <FileSearchCorner size={14} />
            View in document
          </button>
        </div>
      </div>
    </div>
    </>
  );
};

"use client";

import * as React from "react";
import { MousePointerClick, X } from "lucide-react";

export type AtMentionChipType = "property" | "document" | "citation_snippet";

export interface AtMentionChipProps {
  type: AtMentionChipType;
  label: string;
  onRemove?: () => void;
  /** Tooltip text (e.g. "Click to view ...") */
  title?: string;
  /** Optional click handler for preview (e.g. open property) */
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

/** Property/document chip: light blue. Citation snippet chip: orange highlight (distinct from file/property). */
const CHIP_BG = "#D6E7FF";
const CITATION_CHIP_BG = "#F7F1E5";
const CHIP_TEXT = "#3B3B3B";
const CHIP_ICON_SIZE = 12;       /* 14 * 0.85 */
const CHIP_PADDING = "1.5px 4px"; /* vertical room for descenders; 4px horizontal to reduce gap next to text */
const CHIP_RADIUS = 3;           /* 4 * 0.85 */
const CHIP_GAP = 4;              /* 5 * 0.85 */
const CHIP_FONT_SIZE = "12px";    /* 14px * 0.85 */
const CHIP_MAX_WIDTH = "221px";  /* 260px * 0.85 */
/** Vertical offset (px) for chip vs line text: negative = up, positive = down */
const CHIP_OFFSET_Y = -3;

export function AtMentionChip({
  type,
  label,
  onRemove,
  title,
  onClick,
  className,
  style,
}: AtMentionChipProps) {
  const [isHovered, setIsHovered] = React.useState(false);
  const showRemove = isHovered && onRemove;

  const handleChipClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    onClick?.();
  };

  const Icon = (
    <MousePointerClick
      size={CHIP_ICON_SIZE}
      style={{ color: CHIP_TEXT, flexShrink: 0 }}
      strokeWidth={2}
    />
  );

  return (
    <span
      className={className}
      role={onClick ? "button" : undefined}
      title={title}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick ? handleChipClick : undefined}
      onMouseDown={onClick ? (e) => e.stopPropagation() : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        verticalAlign: "middle",
        marginTop: CHIP_OFFSET_Y ? `${CHIP_OFFSET_Y}px` : undefined,
        gap: CHIP_GAP,
        padding: CHIP_PADDING,
        borderRadius: CHIP_RADIUS,
        backgroundColor: type === "citation_snippet" ? CITATION_CHIP_BG : CHIP_BG,
        border: "none",
        fontSize: CHIP_FONT_SIZE,
        fontWeight: 400,
        color: CHIP_TEXT,
        lineHeight: 1,
        maxWidth: CHIP_MAX_WIDTH,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    >
      {showRemove ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove?.();
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            margin: 0,
            border: "none",
            background: "none",
            cursor: "pointer",
            color: CHIP_TEXT,
            flexShrink: 0,
          }}
          aria-label="Remove"
        >
          <X size={CHIP_ICON_SIZE} strokeWidth={2} />
        </button>
      ) : (
        Icon
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.35, minHeight: "1.35em" }}>
        {label}
      </span>
    </span>
  );
}

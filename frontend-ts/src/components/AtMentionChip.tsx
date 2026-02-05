"use client";

import * as React from "react";
import { MapPin, MousePointerClick, X } from "lucide-react";

export type AtMentionChipType = "property" | "document";

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

/** Selected chip: light blue #D6E7FF, dark text #3B3B3B; compact proportions, width unchanged. */
const CHIP_BG = "#D6E7FF";
const CHIP_TEXT = "#3B3B3B";
const CHIP_ICON_SIZE = 14;
const CHIP_PADDING = "2px 7px";
const CHIP_RADIUS = 4;
const CHIP_GAP = 5;
const CHIP_FONT_SIZE = "14px";
const CHIP_MAX_WIDTH = "260px";

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

  const Icon =
    type === "property" ? (
      <MapPin
        size={CHIP_ICON_SIZE}
        style={{ color: CHIP_TEXT, flexShrink: 0 }}
        strokeWidth={2}
      />
    ) : (
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
        gap: CHIP_GAP,
        padding: CHIP_PADDING,
        borderRadius: CHIP_RADIUS,
        backgroundColor: CHIP_BG,
        border: "none",
        fontSize: CHIP_FONT_SIZE,
        fontWeight: 400,
        color: CHIP_TEXT,
        lineHeight: 1.2,
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
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </span>
    </span>
  );
}

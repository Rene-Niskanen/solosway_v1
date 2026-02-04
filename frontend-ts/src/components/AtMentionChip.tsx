"use client";

import * as React from "react";
import { FileText, MapPin } from "lucide-react";

export type AtMentionChipType = "property" | "document";

export interface AtMentionChipProps {
  type: AtMentionChipType;
  label: string;
  onRemove?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

/** Cursor-style light blue pill chip for selected file or property (pixel-perfect). */
const CHIP_BG = "#F0F8FF";
const CHIP_TEXT = "#333333";
const CHIP_ICON_SIZE = 14;
const CHIP_PADDING = "6px 10px";
const CHIP_RADIUS = 14;
const CHIP_GAP = 8;
const CHIP_FONT_SIZE = "14px";

export function AtMentionChip({
  type,
  label,
  onRemove,
  className,
  style,
}: AtMentionChipProps) {
  const Icon =
    type === "property" ? (
      <MapPin
        size={CHIP_ICON_SIZE}
        style={{ color: CHIP_TEXT, flexShrink: 0 }}
        strokeWidth={2}
      />
    ) : (
      <FileText
        size={CHIP_ICON_SIZE}
        style={{ color: CHIP_TEXT, flexShrink: 0 }}
        strokeWidth={2}
      />
    );

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: CHIP_GAP,
        padding: CHIP_PADDING,
        borderRadius: CHIP_RADIUS,
        backgroundColor: CHIP_BG,
        border: "none",
        fontSize: CHIP_FONT_SIZE,
        fontWeight: 500,
        color: CHIP_TEXT,
        lineHeight: 1.3,
        maxWidth: "200px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {Icon}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </span>
    </span>
  );
}

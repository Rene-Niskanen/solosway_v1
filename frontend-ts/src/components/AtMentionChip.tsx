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

/** Cursor-style blue pill chip for selected file or property in the chat/search bar. */
const CHIP_BG = "#2563eb";
const CHIP_TEXT = "#ffffff";

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
        size={14}
        style={{ color: CHIP_TEXT, flexShrink: 0 }}
        strokeWidth={2}
      />
    ) : (
      <FileText
        size={14}
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
        gap: "6px",
        padding: "4px 8px",
        borderRadius: "9999px",
        backgroundColor: CHIP_BG,
        border: "1px solid rgba(37, 99, 235, 0.9)",
        fontSize: "12px",
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

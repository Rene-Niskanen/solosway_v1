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

/** Blue minimal pill chip for selected file or property in the chat/search bar. */
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
        style={{ color: "#5b6b7a", flexShrink: 0 }}
        strokeWidth={2}
      />
    ) : (
      <FileText
        size={14}
        style={{ color: "#5b6b7a", flexShrink: 0 }}
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
        backgroundColor: "#e0e8f7",
        border: "1px solid rgba(184, 204, 224, 0.8)",
        fontSize: "12px",
        fontWeight: 500,
        color: "#111827",
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

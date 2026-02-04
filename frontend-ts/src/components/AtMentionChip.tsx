"use client";

import * as React from "react";
import { MapPin, FileText, X } from "lucide-react";

export interface AtMentionChipProps {
  kind: "property" | "document";
  label: string;
  onRemove?: () => void;
}

export const AtMentionChip: React.FC<AtMentionChipProps> = ({
  kind,
  label,
  onRemove,
}) => {
  const Icon = kind === "property" ? MapPin : FileText;

  return (
    <span
      contentEditable={false}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        backgroundColor: "#E0EDFF",
        border: "1px solid #B3D4FF",
        borderRadius: "6px",
        padding: "3px 6px",
        fontSize: "13px",
        lineHeight: "1.2",
        color: "#1A56DB",
        userSelect: "none",
        verticalAlign: "middle",
        maxWidth: "180px",
      }}
    >
      <Icon style={{ width: "12px", height: "12px", flexShrink: 0 }} strokeWidth={2} />
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "none",
            border: "none",
            padding: "0",
            marginLeft: "2px",
            cursor: "pointer",
            color: "#1A56DB",
            opacity: 0.7,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "1";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "0.7";
          }}
        >
          <X style={{ width: "12px", height: "12px" }} strokeWidth={2} />
        </button>
      )}
    </span>
  );
};

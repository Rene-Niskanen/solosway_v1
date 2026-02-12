"use client";

import * as React from "react";
import { Scissors, FileText, X } from "lucide-react";

export interface CitationSaveMenuBarProps {
  onChoose: () => void;
  onCopy: () => void;
  onCancel?: () => void;
  /** When true, compact style for placement next to citation in document view */
  compact?: boolean;
  /** Optional inline style for the container (e.g. position next to bbox) */
  style?: React.CSSProperties;
}

export const CitationSaveMenuBar: React.FC<CitationSaveMenuBarProps> = ({
  onChoose,
  onCopy,
  onCancel,
  compact = false,
  style: styleOverride,
}) => {
  const iconSize = compact ? 14 : 16;
  const padding = compact ? "6px" : "8px";
  const gap = compact ? 2 : 4;

  const containerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap,
    padding: compact ? "4px 4px" : "6px 6px",
    backgroundColor: "rgba(245, 246, 248, 0.98)",
    border: "1px solid rgba(226, 232, 240, 0.9)",
    borderRadius: compact ? 8 : 10,
    boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
    pointerEvents: "auto",
    ...styleOverride,
  };

  const buttonStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding,
    border: "none",
    background: "none",
    cursor: "pointer",
    color: "#374151",
    borderRadius: 6,
    transition: "background-color 0.15s ease",
  };

  return (
    <div
      role="toolbar"
      aria-label="Save citation options"
      style={containerStyle}
    >
      <button
        type="button"
        onClick={onCopy}
        title="Copy citation as image"
        aria-label="Copy citation as image"
        style={buttonStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "#f1f5f9";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        <FileText size={iconSize} strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={onChoose}
        title="Choose region to capture"
        aria-label="Choose region to capture"
        style={buttonStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "#f1f5f9";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        <Scissors size={iconSize} strokeWidth={2} />
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          title="Cancel"
          aria-label="Cancel"
          style={{
            ...buttonStyle,
            marginLeft: 2,
            color: "#64748b",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "#f1f5f9";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          <X size={iconSize} strokeWidth={2} />
        </button>
      )}
    </div>
  );
};

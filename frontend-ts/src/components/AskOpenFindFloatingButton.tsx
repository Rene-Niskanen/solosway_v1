"use client";

import React from "react";

export interface AskOpenFindFloatingButtonProps {
  position: { x: number; y: number };
  selectedText: string;
  onAsk: () => void;
  onCheckSource?: () => void;
  hasSource?: boolean;
  onDismiss?: () => void;
}

/** Floating popup that appears above text selection in chat responses: "Add to follow-up" and "Check Source". */
export const AskOpenFindFloatingButton: React.FC<AskOpenFindFloatingButtonProps> = ({
  position,
  selectedText,
  onAsk,
  onCheckSource,
  hasSource = false,
}) => {
  const handleAddToFollowUp = React.useCallback(() => {
    onAsk();
  }, [onAsk]);

  const handleCheckSource = React.useCallback(() => {
    if (hasSource && onCheckSource) {
      onCheckSource();
    }
  }, [hasSource, onCheckSource]);

  return (
    <div
      role="group"
      aria-label={`Actions for selection: ${selectedText.slice(0, 50)}${selectedText.length > 50 ? "…" : ""}`}
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        background: "#F2F2EF",
        borderRadius: 6,
        padding: 0,
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.06)",
        zIndex: 10050,
      }}
    >
      <button
        type="button"
        onClick={handleAddToFollowUp}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "5px 10px",
          border: "none",
          borderTopLeftRadius: 6,
          borderBottomLeftRadius: 6,
          background: "transparent",
          color: "#141413",
          fontSize: 12,
          fontFamily: "inherit",
          cursor: "pointer",
          transition: "background-color 0.15s ease",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "rgba(0, 0, 0, 0.04)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        }}
      >
        Add to follow-up
      </button>
      <div
        style={{
          width: 1,
          background: "rgba(0, 0, 0, 0.08)",
          flexShrink: 0,
        }}
      />
      <button
        type="button"
        onClick={handleCheckSource}
        disabled={!hasSource || !onCheckSource}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "5px 10px",
          border: "none",
          borderTopRightRadius: 6,
          borderBottomRightRadius: 6,
          background: "transparent",
          color: hasSource ? "#141413" : "rgba(0, 0, 0, 0.4)",
          fontSize: 12,
          fontFamily: "inherit",
          cursor: hasSource && onCheckSource ? "pointer" : "default",
          transition: "background-color 0.15s ease",
        }}
        onMouseEnter={(e) => {
          if (hasSource && onCheckSource) {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(0, 0, 0, 0.04)";
          }
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        }}
      >
        Check Source
      </button>
    </div>
  );
};

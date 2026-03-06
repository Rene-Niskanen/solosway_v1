"use client";

import React from "react";
import { Quote } from "lucide-react";

export interface AskVeloraFloatingButtonProps {
  position: { x: number; y: number };
  selectedText: string;
  onAsk: () => void;
  onDismiss?: () => void;
}

/** Floating "Ask Velora" button that appears above text selection in chat responses. */
export const AskVeloraFloatingButton: React.FC<AskVeloraFloatingButtonProps> = ({
  position,
  selectedText,
  onAsk,
}) => {
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  const handleClick = React.useCallback(() => {
    onAsk();
    // Leave selection intact so the highlight stays until the user clicks elsewhere
  }, [onAsk]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleClick}
      className="flex items-center gap-2 rounded-[10px] px-3 py-2 text-[14px] text-[#1a1a1a] transition-colors hover:bg-black/[0.03] focus:outline-none focus:ring-2 focus:ring-black/10"
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        background: "#ffffff",
        border: "1px solid rgba(0, 0, 0, 0.08)",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
        zIndex: 10050,
      }}
      aria-label={`Ask Velora about: ${selectedText.slice(0, 50)}${selectedText.length > 50 ? "…" : ""}`}
    >
      <Quote style={{ width: 16, height: 16, flexShrink: 0 }} strokeWidth={2} />
      <span>Ask Velora</span>
    </button>
  );
};

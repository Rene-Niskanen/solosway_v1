"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";

export interface PropertyPillChipProps {
  label: string;
  onRemove?: () => void;
  title?: string;
  /** Document count shown under the label (same style as FileAttachment type label) */
  documentCount?: number;
}

const MAX_LABEL_LEN = 35;

function formatLabel(label: string): string {
  if (label.length <= MAX_LABEL_LEN) return label;
  return `${label.substring(0, MAX_LABEL_LEN - 3)}...`;
}

/** Chat-style chip matching FileAttachment variant="chat" – light container, colored icon, hover-to-remove */
const CHAT_BUBBLE_RADIUS = 10;

export function PropertyPillChip({ label, onRemove, title, documentCount }: PropertyPillChipProps) {
  const [isHovered, setIsHovered] = React.useState(false);
  const chatBubbleBg = "#F2F2EF";
  const chatTextColor = "#374151";
  const chatTextMuted = "#6B7280";
  const chatRemoveBtn = { background: "rgba(0,0,0,0.06)", color: "#374151" };

  return (
    <motion.span
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.1, ease: "easeOut" }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={title ?? label}
      style={{
        backgroundColor: chatBubbleBg,
        borderRadius: CHAT_BUBBLE_RADIUS,
        padding: "12px 14px",
        display: "inline-flex",
        flexDirection: "column",
        gap: "8px",
        cursor: "default",
        flexShrink: 0,
        position: "relative",
        alignItems: "flex-start",
        width: "auto",
      }}
    >
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 20,
            height: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            border: "none",
            ...chatRemoveBtn,
            cursor: "pointer",
            zIndex: 10,
            opacity: isHovered ? 1 : 0,
            transition: "opacity 0.15s ease",
            pointerEvents: isHovered ? "auto" : "none",
          }}
          title="Remove"
        >
          <X className="w-3 h-3" strokeWidth={2.5} />
        </button>
      )}
      <span
        style={{
          fontSize: "11px",
          color: chatTextColor,
          fontWeight: 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: "100%",
          paddingRight: 28,
        }}
      >
        {formatLabel(label)}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <div
          className="relative overflow-hidden flex items-center justify-center flex-shrink-0"
          style={{
            width: "32px",
            height: "28px",
          }}
        >
          <img
            src="/projectsfolder.png"
            alt=""
            className="w-full h-full object-contain pointer-events-none"
            style={{ display: "block" }}
            draggable={false}
          />
        </div>
        {documentCount != null && (
          <span style={{ fontSize: "11px", color: chatTextMuted }}>
            {documentCount === 1 ? "1 doc" : `${documentCount} docs`}
          </span>
        )}
      </div>
    </motion.span>
  );
}

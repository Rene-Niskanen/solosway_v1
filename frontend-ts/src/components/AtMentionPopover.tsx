"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { MapPin, FileText } from "lucide-react";

export type AtMentionItemType = "property" | "document";

export interface AtMentionItem {
  type: AtMentionItemType;
  id: string;
  primaryLabel: string;
  payload?: unknown;
}

export interface AtMentionPopoverProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  query: string;
  placement?: "above" | "below";
  items: AtMentionItem[];
  selectedIndex: number;
  onSelect: (item: AtMentionItem) => void;
  onSelectedIndexChange: (index: number) => void;
  onClose: () => void;
}

export function AtMentionPopover({
  open,
  anchorRef,
  query,
  placement = "below",
  items,
  selectedIndex,
  onSelect,
  onSelectedIndexChange,
  onClose,
}: AtMentionPopoverProps) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState({ top: 0, left: 0 });

  React.useEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPosition({
      left: rect.left,
      top: placement === "below" ? rect.bottom + 4 : rect.top - 4,
    });
  }, [open, placement, anchorRef, query]);

  React.useEffect(() => {
    if (!open || selectedIndex < 0) return;
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, selectedIndex]);

  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        onSelectedIndexChange(Math.min(selectedIndex + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        onSelectedIndexChange(Math.max(selectedIndex - 1, 0));
      } else if (e.key === "Enter" && items[selectedIndex]) {
        e.preventDefault();
        onSelect(items[selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, selectedIndex, items, onSelect, onSelectedIndexChange, onClose]);

  if (!open) return null;

  const content = (
    <div
      ref={listRef}
      style={{
        position: "fixed",
        top: placement === "below" ? position.top : undefined,
        bottom: placement === "above" ? `calc(100vh - ${position.top}px)` : undefined,
        left: position.left,
        zIndex: 10000,
        backgroundColor: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: "8px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        maxHeight: "200px",
        overflowY: "auto",
        minWidth: "200px",
        maxWidth: "300px",
        padding: "4px 0",
      }}
    >
      {items.length === 0 ? (
        <div
          style={{
            padding: "8px 12px",
            fontSize: "13px",
            color: "#6B7280",
          }}
        >
          No files or properties
        </div>
      ) : (
        items.map((item, idx) => {
          const Icon = item.type === "property" ? MapPin : FileText;
          const isSelected = idx === selectedIndex;
          return (
            <div
              key={`${item.type}-${item.id}`}
              data-index={idx}
              onClick={() => onSelect(item)}
              onMouseEnter={() => onSelectedIndexChange(idx)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 12px",
                cursor: "pointer",
                backgroundColor: isSelected ? "#F3F4F6" : "transparent",
                fontSize: "13px",
                color: "#374151",
              }}
            >
              <Icon
                style={{
                  width: "14px",
                  height: "14px",
                  flexShrink: 0,
                  color: item.type === "property" ? "#10B981" : "#6366F1",
                }}
                strokeWidth={2}
              />
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.primaryLabel}
              </span>
            </div>
          );
        })
      )}
    </div>
  );

  return createPortal(content, document.body);
}

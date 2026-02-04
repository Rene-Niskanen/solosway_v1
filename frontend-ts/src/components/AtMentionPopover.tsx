"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { FileText, MapPin, Home } from "lucide-react";

export type AtMentionItemType = "property" | "document";

export interface AtMentionItem {
  type: AtMentionItemType;
  id: string;
  primaryLabel: string;
  secondaryLabel: string;
  payload?: unknown;
}

export interface AtMentionPopoverProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  query: string;
  placement: "above" | "below";
  items: AtMentionItem[];
  selectedIndex: number;
  onSelect: (item: AtMentionItem) => void;
  onSelectedIndexChange: (index: number) => void;
  onClose: () => void;
}

const POPOVER_MAX_HEIGHT = 280;
const ROW_PADDING = "6px 10px";
const PRIMARY_FONT_SIZE = "12px";
const SECONDARY_FONT_SIZE = "11px";
const SECONDARY_COLOR = "#9CA3AF";
const HOVER_BG = "#F9FAFB";
const GAP = 8;

export function AtMentionPopover({
  open,
  anchorRef,
  placement,
  items,
  selectedIndex,
  onSelect,
  onSelectedIndexChange,
  onClose,
}: AtMentionPopoverProps) {
  const popoverRef = React.useRef<HTMLDivElement>(null);

  // Keyboard: ArrowUp, ArrowDown, Enter, Escape
  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        onSelectedIndexChange(Math.min(selectedIndex + 1, items.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        onSelectedIndexChange(Math.max(selectedIndex - 1, 0));
        return;
      }
      if (e.key === "Enter" && items[selectedIndex]) {
        e.preventDefault();
        onSelect(items[selectedIndex]);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, items, selectedIndex, onSelect, onSelectedIndexChange, onClose]);

  // Click outside to close
  React.useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        anchorRef.current?.contains(target)
      )
        return;
      onClose();
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open, anchorRef, onClose]);

  if (!open || !anchorRef.current) return null;

  const rect = anchorRef.current.getBoundingClientRect();
  const style: React.CSSProperties = {
    position: "fixed",
    left: rect.left,
    width: Math.max(rect.width, 200),
    maxHeight: POPOVER_MAX_HEIGHT,
    background: "#FFFFFF",
    border: "1px solid rgba(229, 231, 235, 0.8)",
    borderRadius: "10px",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)",
    overflowY: "auto",
    zIndex: 10000,
  };
  if (placement === "above") {
    style.bottom = window.innerHeight - rect.top + GAP;
  } else {
    style.top = rect.bottom + GAP;
  }

  const list = (
    <div ref={popoverRef} style={style} role="listbox">
      {items.length === 0 ? (
        <div
          style={{
            padding: ROW_PADDING,
            fontSize: SECONDARY_FONT_SIZE,
            color: SECONDARY_COLOR,
          }}
        >
          Type to search files and property pins
        </div>
      ) : (
        items.map((item, index) => {
          const isSelected = index === selectedIndex;
          const Icon =
            item.type === "property" ? (
              <MapPin
                size={16}
                style={{ color: "#6B7280", flexShrink: 0 }}
                strokeWidth={2}
              />
            ) : (
              <FileText
                size={16}
                style={{ color: "#6B7280", flexShrink: 0 }}
                strokeWidth={2}
              />
            );
          return (
            <div
              key={`${item.type}-${item.id}-${index}`}
              role="option"
              aria-selected={isSelected}
              onClick={() => onSelect(item)}
              onMouseEnter={() => onSelectedIndexChange(index)}
              style={{
                padding: ROW_PADDING,
                cursor: "pointer",
                backgroundColor: isSelected ? HOVER_BG : "transparent",
                borderBottom:
                  index < items.length - 1
                    ? "1px solid rgba(229, 231, 235, 0.3)"
                    : "none",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                transition: "background-color 0.15s ease",
              }}
            >
              {Icon}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    fontSize: PRIMARY_FONT_SIZE,
                    color: "#111827",
                    lineHeight: 1.4,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.primaryLabel}
                </div>
                {item.secondaryLabel ? (
                  <div
                    style={{
                      fontSize: SECONDARY_FONT_SIZE,
                      color: SECONDARY_COLOR,
                      lineHeight: 1.4,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.secondaryLabel}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  return createPortal(list, document.body);
}

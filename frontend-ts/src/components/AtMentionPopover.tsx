"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { FileText, MapPin } from "lucide-react";

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

const POPOVER_MAX_HEIGHT = 180;
const POPOVER_MAX_WIDTH = 280;
const GAP = 5;
const CONTAINER_RADIUS = 7;
const ROW_PADDING = "5px 11px";
const FOCUSED_ROW_BG = "#F0F0F0";
const PRIMARY_COLOR = "#333333";
const PRIMARY_FONT_SIZE = "12px";
const SECONDARY_COLOR = "#999999";
const SECONDARY_FONT_SIZE = "10px";
const ICON_COLOR = "#333333";
const ICON_SIZE = 13;
const ROW_GAP = 5;

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

  if (!open) return null;

  // Fallback rect when ref not yet set (e.g. first paint) so popover still shows
  const fallbackTop = window.innerHeight - 120;
  const fallbackLeft = window.innerWidth / 2 - 200;
  const fallbackWidth = 400;
  const fallbackHeight = 40;
  const rect = anchorRef.current?.getBoundingClientRect() ?? {
    left: fallbackLeft,
    top: fallbackTop,
    width: fallbackWidth,
    height: fallbackHeight,
    bottom: fallbackTop + fallbackHeight,
    right: fallbackLeft + fallbackWidth,
    x: fallbackLeft,
    y: fallbackTop,
    toJSON: () => ({}),
  };
  const style: React.CSSProperties = {
    position: "fixed",
    left: rect.left,
    width: Math.min(Math.max(rect.width, 200), POPOVER_MAX_WIDTH),
    maxHeight: POPOVER_MAX_HEIGHT,
    background: "#FFFFFF",
    border: "none",
    borderRadius: CONTAINER_RADIUS,
    boxShadow: "0 2px 12px rgba(0, 0, 0, 0.08)",
    overflow: "hidden",
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
            borderTopLeftRadius: CONTAINER_RADIUS,
            borderTopRightRadius: CONTAINER_RADIUS,
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
                size={ICON_SIZE}
                style={{ color: ICON_COLOR, flexShrink: 0 }}
                strokeWidth={2}
              />
            ) : (
              <FileText
                size={ICON_SIZE}
                style={{ color: ICON_COLOR, flexShrink: 0 }}
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
                backgroundColor: isSelected ? FOCUSED_ROW_BG : "transparent",
                display: "flex",
                alignItems: "center",
                gap: ROW_GAP,
                transition: "background-color 0.15s ease",
                ...(index === 0
                  ? { borderTopLeftRadius: CONTAINER_RADIUS, borderTopRightRadius: CONTAINER_RADIUS }
                  : {}),
              }}
            >
              {Icon}
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontWeight: 500,
                  fontSize: PRIMARY_FONT_SIZE,
                  color: PRIMARY_COLOR,
                  lineHeight: 1.4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.primaryLabel}
              </span>
              {item.secondaryLabel ? (
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: SECONDARY_FONT_SIZE,
                    color: SECONDARY_COLOR,
                    lineHeight: 1.4,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "120px",
                  }}
                >
                  {item.secondaryLabel}
                </span>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );

  return createPortal(list, document.body);
}

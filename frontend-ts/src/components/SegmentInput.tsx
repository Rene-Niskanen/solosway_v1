"use client";

import * as React from "react";
import type { Segment, TextSegment, ChipSegment } from "@/types/segmentInput";
import { isTextSegment, isChipSegment } from "@/types/segmentInput";
import { AtMentionChip } from "./AtMentionChip";

export interface SegmentInputProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  segments: Segment[];
  cursor: { segmentIndex: number; offset: number };
  onSegmentsChange?: (segments: Segment[]) => void;
  onCursorChange?: (segmentIndex: number, offset: number) => void;
  onInsertText?: (char: string) => void;
  onBackspace?: () => void;
  onDelete?: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onRemovePropertyChip?: (id: string) => void;
  onRemoveDocumentChip?: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  "data-testid"?: string;
}

export const SegmentInput = React.forwardRef<HTMLDivElement, SegmentInputProps>(function SegmentInput(
  {
    segments,
    cursor,
    onCursorChange,
    onInsertText,
    onBackspace,
    onDelete,
    onMoveLeft,
    onMoveRight,
    onRemovePropertyChip,
    onRemoveDocumentChip,
    placeholder = "",
    disabled = false,
    className,
    style,
    ...rest
  },
  ref
) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(ref, () => containerRef.current!);
  const mergedRef = (el: HTMLDivElement | null) => {
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
  };
  const segmentRefs = React.useRef<(HTMLSpanElement | null)[]>([]);

  React.useLayoutEffect(() => {
    const sel = window.getSelection();
    const container = containerRef.current;
    if (!sel || !container || !container.contains(sel.anchorNode)) return;
    const idx = cursor.segmentIndex;
    const seg = segments[idx];
    if (!seg) return;
    const el = segmentRefs.current[idx];
    if (!el) return;
    if (isTextSegment(seg)) {
      const textNode = el.firstChild;
      if (textNode) {
        const offset = Math.min(cursor.offset, seg.value.length);
        const range = document.createRange();
        range.setStart(textNode, offset);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } else {
      const range = document.createRange();
      range.setStartBefore(el);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, [cursor, segments]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      onBackspace?.();
    } else if (e.key === "Delete") {
      e.preventDefault();
      onDelete?.();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      onMoveLeft?.();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onMoveRight?.();
    } else if (e.key === "Enter") {
      if (!e.shiftKey) {
        e.preventDefault();
        onInsertText?.("\n");
      }
    }
    rest.onKeyDown?.(e);
  };

  const handleBeforeInput = (e: React.FormEvent<HTMLDivElement> & { data?: string }) => {
    if (disabled) return;
    e.preventDefault();
    const data = (e as any).data;
    if (typeof data === "string" && data.length > 0) {
      onInsertText?.(data);
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const offset = range.startOffset;

    for (let i = 0; i < segmentRefs.current.length; i++) {
      const el = segmentRefs.current[i];
      if (!el) continue;
      if (el.contains(node)) {
        const seg = segments[i];
        if (isTextSegment(seg)) {
          onCursorChange?.(i, Math.min(offset, seg.value.length));
        } else {
          onCursorChange?.(i, 0);
        }
        return;
      }
    }
  };

  const showPlaceholder =
    segments.length === 1 &&
    isTextSegment(segments[0]) &&
    segments[0].value === "";

  return (
    <div
      ref={mergedRef}
      contentEditable={!disabled}
      suppressContentEditableWarning
      onKeyDown={handleKeyDown}
      onBeforeInput={handleBeforeInput}
      onClick={handleClick}
      className={className}
      style={{
        outline: "none",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        minHeight: "24px",
        ...style,
        color: showPlaceholder ? "#9CA3AF" : style?.color,
      }}
      data-testid={rest["data-testid"]}
      {...rest}
    >
      {showPlaceholder ? (
        <span
          ref={(el) => {
            segmentRefs.current[0] = el;
          }}
          style={{ color: "#9CA3AF" }}
        >
          {placeholder}
        </span>
      ) : (
        segments.map((seg, idx) => {
          if (isTextSegment(seg)) {
            return (
              <span
                key={idx}
                ref={(el) => {
                  segmentRefs.current[idx] = el;
                }}
              >
                {seg.value}
              </span>
            );
          } else {
            return (
              <AtMentionChip
                key={`chip-${seg.id}-${idx}`}
                kind={seg.kind}
                label={seg.label}
                onRemove={() => {
                  if (seg.kind === "property") {
                    onRemovePropertyChip?.(seg.id);
                  } else {
                    onRemoveDocumentChip?.(seg.id);
                  }
                }}
              />
            );
          }
        })
      )}
    </div>
  );
});

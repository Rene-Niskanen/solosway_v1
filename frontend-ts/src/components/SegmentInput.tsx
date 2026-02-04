"use client";

import * as React from "react";
import type { Segment, TextSegment, ChipSegment } from "@/types/segmentInput";
import { isTextSegment, isChipSegment } from "@/types/segmentInput";
import { AtMentionChip } from "./AtMentionChip";

export interface SegmentInputProps {
  segments: Segment[];
  cursor: { segmentIndex: number; offset: number };
  onSegmentsChange?: (segments: Segment[]) => void;
  onCursorChange?: (segmentIndex: number, offset: number) => void;
  onInsertText?: (char: string) => void;
  onBackspace?: () => void;
  onDelete?: () => void;
  onDeleteSelection?: (startPlainOffset: number, endPlainOffset: number) => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onRemovePropertyChip?: (id: string) => void;
  onRemoveDocumentChip?: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  "data-testid"?: string;
}

export const SegmentInput = React.forwardRef<HTMLDivElement, SegmentInputProps>(function SegmentInput({
  segments,
  cursor,
  onCursorChange,
  onInsertText,
  onBackspace,
  onDelete,
  onDeleteSelection,
  onMoveLeft,
  onMoveRight,
  onRemovePropertyChip,
  onRemoveDocumentChip,
  placeholder = "",
  disabled = false,
  className,
  style,
  onKeyDown: externalOnKeyDown,
}, ref) {
  const internalRef = React.useRef<HTMLDivElement>(null);
  const containerRef = ref || internalRef;
  const segmentRefs = React.useRef<(HTMLSpanElement | null)[]>([]);

  function segmentOffsetToPlain(segmentIndex: number, segmentOffset: number, segs: Segment[]): number {
    let plain = 0;
    for (let i = 0; i < segmentIndex; i++) {
      const s = segs[i];
      if (isTextSegment(s)) plain += s.value.length;
    }
    const segAt = segs[segmentIndex];
    if (segAt && isTextSegment(segAt)) {
      plain += Math.min(segmentOffset, segAt.value.length);
    }
    return plain;
  }

  function nodeToSegmentOffset(
    node: Node | null,
    offset: number,
    refs: (HTMLSpanElement | null)[],
    segs: Segment[]
  ): { segmentIndex: number; segmentOffset: number } | null {
    if (!node) return null;
    for (let i = 0; i < refs.length; i++) {
      const span = refs[i];
      if (!span) continue;
      const seg = segs[i];
      if (isTextSegment(seg)) {
        const textNode = span.firstChild;
        if (textNode && node === textNode) {
          return { segmentIndex: i, segmentOffset: Math.min(offset, seg.value.length) };
        }
        if (node === span) {
          const segOffset = offset === 0 ? 0 : seg.value.length;
          return { segmentIndex: i, segmentOffset: segOffset };
        }
      }
      if (isChipSegment(seg)) {
        if (span === node || span.contains(node)) {
          const segOffset = offset === 0 ? 0 : 1;
          return { segmentIndex: i, segmentOffset: segOffset };
        }
      }
    }
    return null;
  }

  // Restore selection after segments/cursor change
  React.useLayoutEffect(() => {
    const sel = window.getSelection();
    const container = typeof containerRef === 'function' ? null : containerRef?.current;
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
  }, [segments, cursor]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (e.key === "Backspace" || e.key === "Delete") {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          if (!range.collapsed) {
            const container = typeof containerRef === "function" ? null : containerRef?.current;
            if (container?.contains(range.startContainer) && container.contains(range.endContainer)) {
              const startPos = nodeToSegmentOffset(range.startContainer, range.startOffset, segmentRefs.current, segments);
              const endPos = nodeToSegmentOffset(range.endContainer, range.endOffset, segmentRefs.current, segments);
              if (startPos != null && endPos != null && onDeleteSelection) {
                const startPlain = segmentOffsetToPlain(startPos.segmentIndex, startPos.segmentOffset, segments);
                const endPlain = segmentOffsetToPlain(endPos.segmentIndex, endPos.segmentOffset, segments);
                e.preventDefault();
                onDeleteSelection(Math.min(startPlain, endPlain), Math.max(startPlain, endPlain));
                return;
              }
            }
          }
        }
        if (e.key === "Backspace") {
          e.preventDefault();
          onBackspace?.();
          return;
        }
        e.preventDefault();
        onDelete?.();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onMoveLeft?.();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        onMoveRight?.();
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === " ") {
          setSpellCheckAfterSpace(true);
        } else {
          setSpellCheckAfterSpace(false);
        }
        e.preventDefault();
        onInsertText?.(e.key);
      }
      // Call external onKeyDown handler if provided
      externalOnKeyDown?.(e);
    },
    [
      disabled,
      onBackspace,
      onDelete,
      onDeleteSelection,
      onMoveLeft,
      onMoveRight,
      onInsertText,
      externalOnKeyDown,
      segments,
    ]
  );

  const handleClick = React.useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const container = typeof containerRef === 'function' ? null : containerRef?.current;
      if (!container || !container.contains(range.startContainer)) return;
      for (let i = 0; i < segmentRefs.current.length; i++) {
        const el = segmentRefs.current[i];
        if (!el) continue;
        const seg = segments[i];
        if (isTextSegment(seg)) {
          const textNode = el.firstChild;
          if (textNode && (textNode === range.startContainer || el.contains(range.startContainer))) {
            const offset = range.startContainer === textNode
              ? range.startOffset
              : seg.value.length;
            onCursorChange?.(i, Math.min(offset, seg.value.length));
            return;
          }
        } else {
          if (el.contains(range.startContainer) || el === range.startContainer) {
            onCursorChange?.(i, 0);
            return;
          }
        }
      }
    },
    [disabled, segments, onCursorChange]
  );

  const isEmpty =
    segments.length === 0 ||
    (segments.length === 1 && isTextSegment(segments[0]) && segments[0].value === "");
  const showPlaceholder = isEmpty && placeholder;

  const [isFocused, setIsFocused] = React.useState(false);
  const [spellCheckAfterSpace, setSpellCheckAfterSpace] = React.useState(false);
  const spellCheck = !isFocused || spellCheckAfterSpace;

  return (
    <div
      ref={ref || internalRef}
      contentEditable={!disabled}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline
      tabIndex={0}
      className={className}
      style={{
        outline: "none",
        minHeight: "22px",
        fontSize: "14px",
        lineHeight: "22px",
        padding: "0",
        wordWrap: "break-word",
        whiteSpace: "pre-wrap",
        ...style,
      }}
      spellCheck={spellCheck}
      onFocus={() => {
        setIsFocused(true);
        setSpellCheckAfterSpace(false);
      }}
      onBlur={() => setIsFocused(false)}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
    >
      {segments.map((seg, i) => {
        if (isTextSegment(seg)) {
          const isOnlyEmpty = segments.length === 1 && seg.value === "";
          return (
            <span
              key={`t-${i}`}
              ref={(el) => {
                segmentRefs.current[i] = el;
              }}
              data-segment-index={i}
              style={isOnlyEmpty && showPlaceholder ? { color: "#8E8E8E" } : undefined}
            >
              {isOnlyEmpty && showPlaceholder ? placeholder : seg.value}
            </span>
          );
        }
        if (isChipSegment(seg)) {
          return (
            <span
              key={`c-${i}`}
              ref={(el) => {
                segmentRefs.current[i] = el;
              }}
              data-segment-index={i}
              contentEditable={false}
              style={{ display: "inline-flex", verticalAlign: "middle" }}
            >
              <AtMentionChip
                type={seg.kind}
                label={seg.label}
                onRemove={
                  seg.kind === "property"
                    ? () => onRemovePropertyChip?.(seg.id)
                    : () => onRemoveDocumentChip?.(seg.id)
                }
              />
            </span>
          );
        }
        return null;
      })}
    </div>
  );
});

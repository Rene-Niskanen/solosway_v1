"use client";

import * as React from "react";
import type { Segment, TextSegment, ChipSegment } from "@/types/segmentInput";
import { isTextSegment, isChipSegment } from "@/types/segmentInput";
import { AtMentionChip } from "./AtMentionChip";

export interface SegmentInputHandle {
  getRectForPlainOffset: (plainOffset: number) => DOMRect | null;
  focus: () => void;
  getBoundingClientRect: () => DOMRect;
  /** Whether the input's root element contains the given node (for click-outside). */
  contains: (node: Node) => boolean;
  /** Root DOM element of the input (for focus checks). */
  getRootElement: () => HTMLElement | null;
}

export interface SegmentInputProps {
  segments: Segment[];
  cursor: { segmentIndex: number; offset: number };
  onSegmentsChange?: (segments: Segment[]) => void;
  onCursorChange?: (segmentIndex: number, offset: number) => void;
  onInsertText?: (char: string) => void;
  onBackspace?: () => void;
  onDelete?: () => void;
  onDeleteSelection?: (startPlainOffset: number, endPlainOffset: number) => void;
  onDeleteSegmentRange?: (
    startSegmentIndex: number,
    startOffset: number,
    endSegmentIndex: number,
    endOffset: number
  ) => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onRemovePropertyChip?: (id: string) => void;
  onRemoveDocumentChip?: (id: string) => void;
  removeChipAtSegmentIndex?: (index: number) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  "data-testid"?: string;
  /** Ref to receive restoreSelection (call after focus so caret appears in the right place) */
  restoreSelectionRef?: React.MutableRefObject<(() => void) | null>;
  /** Optional bottom padding for the scroll wrapper (only when maxHeight is used). Set e.g. "14px" for side-panel chat so long messages don't sit right above the buttons; omit for dashboard/map chat. */
  scrollWrapperPaddingBottom?: string;
  /** Optional font size for placeholder text only (e.g. "18.2px" for 30% larger). Does not affect typed input fontSize. */
  placeholderFontSize?: string;
}

export const SegmentInput = React.forwardRef<SegmentInputHandle, SegmentInputProps>(function SegmentInput({
  segments,
  cursor,
  onCursorChange,
  onInsertText,
  onBackspace,
  onDelete,
  onDeleteSelection,
  onDeleteSegmentRange,
  onMoveLeft,
  onMoveRight,
  onRemovePropertyChip,
  onRemoveDocumentChip,
  removeChipAtSegmentIndex,
  placeholder = "",
  disabled = false,
  className,
  style,
  onKeyDown: externalOnKeyDown,
  restoreSelectionRef,
  scrollWrapperPaddingBottom,
  placeholderFontSize,
}, ref) {
  const internalRef = React.useRef<HTMLDivElement>(null);
  const scrollWrapperRef = React.useRef<HTMLDivElement>(null);
  const containerRef = internalRef;
  const segmentRefs = React.useRef<(HTMLSpanElement | null)[]>([]);

  const getRectForPlainOffset = React.useCallback((plainOffset: number): DOMRect | null => {
    const el = internalRef.current;
    if (!el) return null;
    let acc = 0;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (isTextSegment(s)) {
        const len = s.value.length;
        if (acc + len >= plainOffset) {
          const segOffset = Math.min(plainOffset - acc, len);
          const span = segmentRefs.current[i];
          if (!span?.firstChild) return null;
          const textNode = span.firstChild;
          const range = document.createRange();
          range.setStart(textNode, segOffset);
          range.collapse(true);
          return range.getBoundingClientRect();
        }
        acc += len;
      } else {
        if (acc + 1 > plainOffset) {
          const span = segmentRefs.current[i];
          return span?.getBoundingClientRect() ?? null;
        }
        acc += 1;
      }
    }
    return null;
  }, [segments]);

  React.useImperativeHandle(ref, () => ({
    getRectForPlainOffset,
    focus: () => internalRef.current?.focus(),
    getBoundingClientRect: () => internalRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0),
    contains: (node: Node) => internalRef.current?.contains(node) ?? false,
    getRootElement: () => internalRef.current,
  }), [getRectForPlainOffset]);

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

  const restoreSelectionToCursor = React.useCallback(() => {
    const sel = window.getSelection();
    const container = typeof containerRef === 'function' ? null : containerRef?.current;
    if (!sel || !container) return;
    const idx = cursor.segmentIndex;
    const seg = segments[idx];
    if (!seg) return;
    const el = segmentRefs.current[idx];
    if (!el) return;
    if (isTextSegment(seg)) {
      const textNode = el.firstChild;
      const offset = Math.min(cursor.offset, seg.value.length);
      if (textNode) {
        const range = document.createRange();
        range.setStart(textNode, offset);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } else if (idx > 0) {
        const prevEl = segmentRefs.current[idx - 1];
        if (prevEl) {
          const range = document.createRange();
          range.setStartAfter(prevEl);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } else {
        // Empty first segment (e.g. when showing placeholder overlay): place caret at start of span
        const range = document.createRange();
        range.setStart(el, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } else {
      const range = document.createRange();
      if (cursor.offset >= 1) {
        range.setStartAfter(el);
        range.collapse(true);
      } else {
        range.setStartBefore(el);
        range.collapse(true);
      }
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, [cursor, segments]);

  React.useEffect(() => {
    if (restoreSelectionRef) restoreSelectionRef.current = restoreSelectionToCursor;
    return () => {
      if (restoreSelectionRef) restoreSelectionRef.current = null;
    };
  }, [restoreSelectionRef, restoreSelectionToCursor]);

  // Restore selection after segments/cursor change so caret is correct (matches old behavior from d41a1a5d).
  // When input is empty, skip so we don't trigger scroll-into-view on every re-render (placeholder glitch).
  // Empty case: selection is restored in onFocus and in the layout effect when isFocused (effect lives below).
  const isInputEmpty = segments.length === 0 || (segments.length === 1 && isTextSegment(segments[0]) && segments[0].value === "");
  React.useLayoutEffect(() => {
    if (isInputEmpty) return;
    restoreSelectionToCursor();
  }, [segments, cursor, restoreSelectionToCursor, isInputEmpty]);

  // Keep the caret in view when typing: scroll the scroll wrapper so the cursor stays visible.
  // Skip when input is empty (single empty segment) so we don't scroll the placeholder on unrelated re-renders.
  const hasContent = segments.length > 1 || (segments.length === 1 && isTextSegment(segments[0]) && segments[0].value.length > 0);
  React.useLayoutEffect(() => {
    if (!hasContent || !scrollWrapperRef.current || !internalRef.current) return;
    const raf = requestAnimationFrame(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const node = range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : range.startContainer as Element;
      if (node && internalRef.current?.contains(node)) {
        node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [segments, cursor, hasContent]);

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
              if (startPos != null && endPos != null) {
                e.preventDefault();
                if (onDeleteSegmentRange) {
                  onDeleteSegmentRange(
                    startPos.segmentIndex,
                    startPos.segmentOffset,
                    endPos.segmentIndex,
                    endPos.segmentOffset
                  );
                  return;
                }
                if (onDeleteSelection) {
                  const startPlain = segmentOffsetToPlain(startPos.segmentIndex, startPos.segmentOffset, segments);
                  const endPlain = segmentOffsetToPlain(endPos.segmentIndex, endPos.segmentOffset, segments);
                  onDeleteSelection(Math.min(startPlain, endPlain), Math.max(startPlain, endPlain));
                  return;
                }
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
      onDeleteSegmentRange,
      onMoveLeft,
      onMoveRight,
      onInsertText,
      externalOnKeyDown,
      segments,
    ]
  );

  const emptyForPlaceholder =
    segments.length === 0 ||
    (segments.length === 1 && isTextSegment(segments[0]) && segments[0].value === "");

  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      if (emptyForPlaceholder && placeholder) {
        // Prevent browser from placing caret at click position; we'll set it to start in click handler
        e.preventDefault();
        internalRef.current?.focus();
      }
    },
    [disabled, emptyForPlaceholder, placeholder]
  );

  const handleClick = React.useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      if (emptyForPlaceholder && placeholder) {
        // Always put caret before placeholder; never let it land where user clicked in pre-text
        const sel = window.getSelection();
        const container = typeof containerRef === 'function' ? null : containerRef?.current;
        if (sel && container) {
          const el = segmentRefs.current[0];
          if (el) {
            const textNode = el.firstChild;
            const range = document.createRange();
            if (textNode) {
              range.setStart(textNode, 0);
            } else {
              range.setStart(el, 0);
            }
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            onCursorChange?.(0, 0);
            return;
          }
        }
      }
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
    [disabled, segments, emptyForPlaceholder, placeholder, onCursorChange]
  );

  const isEmpty =
    segments.length === 0 ||
    (segments.length === 1 && isTextSegment(segments[0]) && segments[0].value === "");
  const [isFocused, setIsFocused] = React.useState(false);
  // Single container for placeholder: always use overlay when empty so there's no shift between overlay and in-span
  const showPlaceholderOverlay = isEmpty && !!placeholder;
  const showPlaceholderInSpan = false;
  const [spellCheckAfterSpace, setSpellCheckAfterSpace] = React.useState(false);
  const spellCheck = !isFocused || spellCheckAfterSpace;

  // contentEditable ignores maxHeight/overflow in many browsers; use a scroll wrapper so the wrapper scrolls.
  // When style.height is set, lock the wrapper to that height (height + minHeight + maxHeight) so it never grows and content scrolls inside.
  const scrollWrapperStyle = style?.maxHeight != null ? {
    ...(style?.height != null
      ? {
          height: style.height,
          minHeight: style.height,
          maxHeight: style.height,
          flexShrink: 0,
        }
      : { maxHeight: style.maxHeight }),
    overflowY: style.overflowY ?? "auto",
    overflowX: style.overflowX ?? "hidden",
    width: style.width ?? "100%",
    position: "relative" as const,
    WebkitOverflowScrolling: "touch" as const,
    scrollbarWidth: "thin" as const,
    scrollbarColor: "rgba(0,0,0,0.08) transparent",
    scrollbarGutter: "stable" as const,
    ...(scrollWrapperPaddingBottom != null && { paddingBottom: scrollWrapperPaddingBottom }),
  } : undefined;
  const editableStyle: React.CSSProperties | undefined = scrollWrapperStyle
    ? (() => {
        const s = style ?? {};
        const { maxHeight, overflowY, overflowX, height, ...rest } = s;
        return { ...rest, width: rest.width ?? "100%" };
      })()
    : style;

  // Single source of truth for spacing so overlay and contentEditable never drift (avoids placeholder glitch)
  const effectiveFontSize = placeholderFontSize ?? style?.fontSize ?? "14px";
  const effectiveLineHeight = style?.lineHeight ?? (placeholderFontSize ? "28px" : "22px");
  const placeholderLeftInsetPx = 18;
  const effectivePadding: React.CSSProperties = {
    padding: style?.padding ?? 0,
    ...(style?.paddingLeft != null && {
      paddingLeft: `${(typeof style.paddingLeft === "number" ? style.paddingLeft : parseFloat(String(style.paddingLeft)) || 0) + placeholderLeftInsetPx}px`,
    }),
    ...(style?.paddingLeft == null && { paddingLeft: `${placeholderLeftInsetPx}px` }),
    ...(style?.paddingRight != null && { paddingRight: style.paddingRight }),
    ...(style?.paddingTop != null && { paddingTop: style.paddingTop }),
    ...(style?.paddingBottom != null && { paddingBottom: style.paddingBottom }),
    // Only add default extra top padding when parent didn't pass paddingTop, so parent can control spacing and overlay/editable stay in sync
    ...(placeholderFontSize != null && style?.paddingTop == null && { paddingTop: "8px" }),
  };

  // Placeholder overlay: no extra left padding; effectivePadding already insets content so placeholder and typed text align.
  const overlayStyle: React.CSSProperties = {
    position: "absolute" as const,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    padding: 0,
    fontSize: effectiveFontSize,
    lineHeight: effectiveLineHeight,
    color: "#BABABA",
    pointerEvents: "none" as const,
    whiteSpace: "pre-wrap" as const,
    wordWrap: "break-word" as const,
  };

  // When focusing while empty, restore selection so the caret (blinking line) appears immediately.
  const handleFocus = React.useCallback(() => {
    setIsFocused(true);
    setSpellCheckAfterSpace(false);
    if (isEmpty) {
      requestAnimationFrame(() => restoreSelectionToCursor());
    }
  }, [isEmpty, restoreSelectionToCursor]);

  // When empty and we become focused, run restoreSelectionToCursor so the caret shows (old d41a1a5d behavior).
  // Effect runs after focus so segmentRefs are mounted; dependency on isFocused ensures it runs when panel auto-focuses.
  React.useLayoutEffect(() => {
    if (!isEmpty || !isFocused) return;
    restoreSelectionToCursor();
  }, [isEmpty, isFocused, restoreSelectionToCursor]);

  const rootStyle: React.CSSProperties =
    style?.height != null && scrollWrapperStyle != null
      ? { position: "relative", height: style.height, minHeight: style.height, flexShrink: 0, ...(style?.width != null ? { width: style.width } : {}) }
      : { position: "relative", ...(style?.width != null ? { width: style.width } : {}) };

  return (
    <div style={rootStyle}>
      {scrollWrapperStyle ? (
        <>
          <style>{`.segment-input-scroll::-webkit-scrollbar { width: 6px; }
.segment-input-scroll::-webkit-scrollbar-track { background: transparent; }
.segment-input-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.08); border-radius: 3px; }
.segment-input-scroll::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.12); }`}</style>
        <div ref={scrollWrapperRef} className="segment-input-scroll" style={scrollWrapperStyle}>
          <div
            ref={internalRef}
            contentEditable={!disabled}
            suppressContentEditableWarning
            role="textbox"
            aria-multiline
            tabIndex={0}
            className={className ? `focus:outline-none focus:ring-0 ${className}` : "focus:outline-none focus:ring-0"}
            style={{
              position: "relative",
              outline: "none",
              minHeight: "22px",
              wordWrap: "break-word",
              whiteSpace: "pre-wrap",
              WebkitTapHighlightColor: "transparent",
              ...editableStyle,
              fontSize: effectiveFontSize,
              lineHeight: effectiveLineHeight,
              ...effectivePadding,
            }}
            spellCheck={spellCheck}
            onFocus={handleFocus}
            onBlur={() => setIsFocused(false)}
            onMouseDown={handleMouseDown}
            onKeyDown={handleKeyDown}
            onClick={handleClick}
            onPaste={(e) => {
              e.preventDefault();
              const text = e.clipboardData.getData("text/plain");
              if (text && onInsertText) {
                const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
                onInsertText(normalized);
              }
            }}
          >
            {showPlaceholderOverlay && (
              <div aria-hidden contentEditable={false} suppressContentEditableWarning style={overlayStyle}>
                {placeholder}
              </div>
            )}
        {segments.map((seg, i) => {
        if (isTextSegment(seg)) {
          const isOnlyEmpty = segments.length === 1 && seg.value === "";
          const showPlaceholderHere = isOnlyEmpty && showPlaceholderInSpan;
          return (
            <span
              key={`t-${i}`}
              ref={(el) => {
                segmentRefs.current[i] = el;
              }}
              data-segment-index={i}
              style={
                isOnlyEmpty && showPlaceholderOverlay
                  ? { display: "inline-block", minWidth: "100%", color: "rgba(186,186,186,0.01)" }
                  : showPlaceholderHere
                    ? {
                        display: "inline-block",
                        minWidth: "100%",
                        color: "#BABABA",
                        ...(placeholderFontSize != null && { fontSize: effectiveFontSize }),
                      }
                    : undefined
              }
            >
              {(isOnlyEmpty && showPlaceholderOverlay) || showPlaceholderHere ? placeholder : seg.value}
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
                  removeChipAtSegmentIndex
                    ? () => removeChipAtSegmentIndex(i)
                    : seg.kind === "citation_snippet"
                      ? undefined
                      : seg.kind === "property"
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
        </div>
        </>
      ) : (
      <div
        ref={internalRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        tabIndex={0}
        className={className ? `focus:outline-none focus:ring-0 ${className}` : "focus:outline-none focus:ring-0"}
        style={{
          position: "relative",
          outline: "none",
          minHeight: "22px",
          wordWrap: "break-word",
          whiteSpace: "pre-wrap",
          WebkitTapHighlightColor: "transparent",
          ...style,
          fontSize: effectiveFontSize,
          lineHeight: effectiveLineHeight,
          ...effectivePadding,
        }}
        spellCheck={spellCheck}
        onFocus={handleFocus}
        onBlur={() => setIsFocused(false)}
        onMouseDown={handleMouseDown}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          if (text && onInsertText) {
            const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
            onInsertText(normalized);
          }
        }}
      >
        {showPlaceholderOverlay && (
          <div aria-hidden contentEditable={false} suppressContentEditableWarning style={overlayStyle}>
            {placeholder}
          </div>
        )}
        {segments.map((seg, i) => {
        if (isTextSegment(seg)) {
          const isOnlyEmpty = segments.length === 1 && seg.value === "";
          const showPlaceholderHere = isOnlyEmpty && showPlaceholderInSpan;
          return (
            <span
              key={`t-${i}`}
              ref={(el) => {
                segmentRefs.current[i] = el;
              }}
              data-segment-index={i}
              style={
                isOnlyEmpty && showPlaceholderOverlay
                  ? { display: "inline-block", minWidth: "100%", color: "rgba(186,186,186,0.01)" }
                  : showPlaceholderHere
                    ? {
                        display: "inline-block",
                        minWidth: "100%",
                        color: "#BABABA",
                        ...(placeholderFontSize != null && { fontSize: effectiveFontSize }),
                      }
                    : undefined
              }
            >
              {(isOnlyEmpty && showPlaceholderOverlay) || showPlaceholderHere ? placeholder : seg.value}
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
                  removeChipAtSegmentIndex
                    ? () => removeChipAtSegmentIndex(i)
                    : seg.kind === "citation_snippet"
                      ? undefined
                      : seg.kind === "property"
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
      )}
    </div>
  );
});

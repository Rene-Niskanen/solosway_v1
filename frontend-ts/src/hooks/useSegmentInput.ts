"use client";

import * as React from "react";
import type {
  Segment,
  TextSegment,
  ChipSegment,
  CursorPosition,
} from "@/types/segmentInput";
import {
  isTextSegment,
  isChipSegment,
  segmentsToPlainText,
  getChipSegments,
} from "@/types/segmentInput";

export interface UseSegmentInputOptions {
  initialSegments: Segment[];
  onInsertPropertyChip?: (payload: unknown) => void;
  onRemovePropertyChip?: (id: string) => void;
  onInsertDocumentChip?: (id: string, label: string) => void;
  onRemoveDocumentChip?: (id: string) => void;
}

export interface UseSegmentInputReturn {
  segments: Segment[];
  setSegments: React.Dispatch<React.SetStateAction<Segment[]>>;
  cursor: CursorPosition;
  setCursor: React.Dispatch<React.SetStateAction<CursorPosition>>;
  insertTextAtCursor: (char: string) => void;
  insertChipAtCursor: (chip: ChipSegment, options?: { trailingSpace?: boolean }) => void;
  backspace: () => void;
  deleteForward: () => void;
  moveCursorLeft: () => void;
  moveCursorRight: () => void;
  getPlainText: () => string;
  getChipSegmentsList: () => ChipSegment[];
  getCursorOffset: () => number;
  setCursorToOffset: (offset: number) => void;
  removeRange: (start: number, end: number) => void;
  getSegmentOffsetFromPlain: (plainOffset: number) => { segmentIndex: number; offset: number } | null;
  removeSegmentRange: (
    startSegmentIndex: number,
    startOffset: number,
    endSegmentIndex: number,
    endOffset: number
  ) => void;
  removeChipAtIndex: (index: number) => void;
}

function clampCursor(segments: Segment[], cursor: CursorPosition): CursorPosition {
  let segIdx = Math.max(0, Math.min(cursor.segmentIndex, segments.length - 1));
  if (segments.length === 0) return { segmentIndex: 0, offset: 0 };
  const seg = segments[segIdx];
  const maxOffset = isTextSegment(seg) ? seg.value.length : 1;
  const offset = Math.max(0, Math.min(cursor.offset, maxOffset));
  return { segmentIndex: segIdx, offset };
}

export function useSegmentInput(
  options: UseSegmentInputOptions
): UseSegmentInputReturn {
  const {
    initialSegments,
    onInsertPropertyChip,
    onRemovePropertyChip,
    onInsertDocumentChip,
    onRemoveDocumentChip,
  } = options;

  const [segments, setSegments] = React.useState<Segment[]>(initialSegments);
  const [cursor, setCursorState] = React.useState<CursorPosition>({
    segmentIndex: 0,
    offset: 0,
  });

  const setCursor = React.useCallback(
    (updater: React.SetStateAction<CursorPosition>) => {
      setCursorState((prev) => {
        const next =
          typeof updater === "function" ? updater(prev) : updater;
        return clampCursor(segments, next);
      });
    },
    [segments]
  );

  // Keep cursor in bounds when segments change
  React.useEffect(() => {
    setCursorState((prev) => clampCursor(segments, prev));
  }, [segments]);

  const insertTextAtCursor = React.useCallback(
    (char: string) => {
      if (!char) return;
      setSegments((prev) => {
        const { segmentIndex, offset } = clampCursor(prev, cursor);
        const seg = prev[segmentIndex];
        if (!seg || !isTextSegment(seg)) {
          const newText: TextSegment = { type: "text", value: char };
          const before = prev.slice(0, segmentIndex + 1);
          const after = prev.slice(segmentIndex + 1);
          return [...before, newText, ...after];
        }
        const newValue =
          seg.value.slice(0, offset) + char + seg.value.slice(offset);
        const newSeg: TextSegment = { type: "text", value: newValue };
        const next = [...prev];
        next[segmentIndex] = newSeg;
        return next;
      });
      setCursorState((prev) => {
        const { segmentIndex, offset } = prev;
        const seg = segments[segmentIndex];
        if (seg && isTextSegment(seg)) {
          return { segmentIndex, offset: offset + char.length };
        }
        return { segmentIndex: segmentIndex + 1, offset: 1 };
      });
    },
    [cursor, segments]
  );

  const insertChipAtCursor = React.useCallback(
    (chip: ChipSegment, options?: { trailingSpace?: boolean }) => {
      if (chip.kind === "property" && chip.payload) {
        onInsertPropertyChip?.(chip.payload);
      } else if (chip.kind === "document") {
        onInsertDocumentChip?.(chip.id, chip.label);
      }
      const trailingSpace = options?.trailingSpace ?? false;
      setSegments((prev) => {
        const { segmentIndex, offset } = clampCursor(prev, cursor);
        const before = prev.slice(0, segmentIndex);
        const after = prev.slice(segmentIndex);
        const current = prev[segmentIndex];
        let mid: Segment[] = [];
        if (current && isTextSegment(current) && (offset > 0 || offset < current.value.length)) {
          const left: TextSegment =
            offset > 0
              ? { type: "text", value: current.value.slice(0, offset) }
              : { type: "text", value: "" };
          const right: TextSegment =
            offset < current.value.length
              ? { type: "text", value: current.value.slice(offset) }
              : { type: "text", value: "" };
          if (left.value) mid.push(left);
          mid.push(chip);
          if (right.value) mid.push(right);
        } else {
          mid = [chip];
        }
        if (trailingSpace) mid.push({ type: "text", value: " " });
        return [...before, ...mid, ...after.slice(1)];
      });
      setCursorState(() => {
        const { segmentIndex, offset } = clampCursor(segments, cursor);
        const current = segments[segmentIndex];
        let added = 1; // chip
        if (current && isTextSegment(current) && (offset > 0 || offset < current.value.length)) {
          const left = offset > 0 ? 1 : 0;
          const right = offset < current.value.length ? 1 : 0;
          added = left + 1 + right;
        }
        if (trailingSpace) added += 1;
        return { segmentIndex: segmentIndex + added - 1, offset: trailingSpace ? 1 : 0 };
      });
    },
    [cursor, onInsertPropertyChip, onInsertDocumentChip]
  );

  const backspace = React.useCallback(() => {
    setSegments((prev) => {
      const { segmentIndex, offset } = clampCursor(prev, cursor);
      const seg = prev[segmentIndex];
      if (segmentIndex === 0 && offset === 0) return prev;
      if (seg && isChipSegment(seg) && offset === 1) {
        if (seg.kind === "property") onRemovePropertyChip?.(seg.id);
        else onRemoveDocumentChip?.(seg.id);
        const next = prev.slice(0, segmentIndex).concat(prev.slice(segmentIndex + 1));
        return next;
      }
      if (seg && isTextSegment(seg) && offset > 0) {
        const newValue = seg.value.slice(0, offset - 1) + seg.value.slice(offset);
        const newSeg: TextSegment = { type: "text", value: newValue };
        const next = [...prev];
        next[segmentIndex] = newSeg;
        return next;
      }
      if (seg && isTextSegment(seg) && offset === 0 && segmentIndex > 0) {
        const prevSeg = prev[segmentIndex - 1];
        if (isChipSegment(prevSeg)) {
          if (prevSeg.kind === "property") onRemovePropertyChip?.(prevSeg.id);
          else onRemoveDocumentChip?.(prevSeg.id);
          return prev.slice(0, segmentIndex - 1).concat(prev.slice(segmentIndex));
        }
        if (isTextSegment(prevSeg)) {
          const merged: TextSegment = {
            type: "text",
            value: prevSeg.value + seg.value,
          };
          return prev
            .slice(0, segmentIndex - 1)
            .concat([merged], prev.slice(segmentIndex + 1));
        }
      }
      return prev;
    });
    setCursorState((prev) => {
      const { segmentIndex, offset } = prev;
      const seg = segments[segmentIndex];
      if (seg && isChipSegment(seg) && offset === 1) {
        return { segmentIndex: Math.max(0, segmentIndex - 1), offset: 0 };
      }
      if (seg && isTextSegment(seg) && offset > 0) {
        return { segmentIndex, offset: offset - 1 };
      }
      if (seg && isTextSegment(seg) && offset === 0 && segmentIndex > 0) {
        const prevSeg = segments[segmentIndex - 1];
        if (isTextSegment(prevSeg)) {
          return { segmentIndex: segmentIndex - 1, offset: prevSeg.value.length };
        }
        return { segmentIndex: segmentIndex - 1, offset: 0 };
      }
      return prev;
    });
  }, [cursor, segments, onRemovePropertyChip, onRemoveDocumentChip]);

  const deleteForward = React.useCallback(() => {
    setSegments((prev) => {
      const { segmentIndex, offset } = clampCursor(prev, cursor);
      const seg = prev[segmentIndex];
      if (seg && isChipSegment(seg) && offset === 0) {
        if (seg.kind === "property") onRemovePropertyChip?.(seg.id);
        else onRemoveDocumentChip?.(seg.id);
        return prev.slice(0, segmentIndex).concat(prev.slice(segmentIndex + 1));
      }
      if (seg && isTextSegment(seg) && offset < seg.value.length) {
        const newValue = seg.value.slice(0, offset) + seg.value.slice(offset + 1);
        const next = [...prev];
        next[segmentIndex] = { type: "text", value: newValue };
        return next;
      }
      if (seg && isTextSegment(seg) && offset === seg.value.length && segmentIndex + 1 < prev.length) {
        const nextSeg = prev[segmentIndex + 1];
        if (isTextSegment(nextSeg)) {
          const merged: TextSegment = {
            type: "text",
            value: seg.value + nextSeg.value,
          };
          return prev
            .slice(0, segmentIndex)
            .concat([merged], prev.slice(segmentIndex + 2));
        }
      }
      return prev;
    });
    setCursorState((prev) => clampCursor(segments, prev));
  }, [cursor, segments, onRemovePropertyChip, onRemoveDocumentChip]);

  const moveCursorLeft = React.useCallback(() => {
    setCursorState((prev) => {
      const { segmentIndex, offset } = prev;
      if (segmentIndex === 0 && offset === 0) return prev;
      const seg = segments[segmentIndex];
      if (seg && isTextSegment(seg) && offset > 0) {
        return { segmentIndex, offset: offset - 1 };
      }
      if (seg && isChipSegment(seg) && offset === 1) {
        return { segmentIndex, offset: 0 };
      }
      if (offset === 0 && segmentIndex > 0) {
        const prevSeg = segments[segmentIndex - 1];
        if (isTextSegment(prevSeg)) {
          return { segmentIndex: segmentIndex - 1, offset: prevSeg.value.length };
        }
        return { segmentIndex: segmentIndex - 1, offset: 0 };
      }
      return prev;
    });
  }, [segments]);

  const moveCursorRight = React.useCallback(() => {
    setCursorState((prev) => {
      const { segmentIndex, offset } = prev;
      if (segmentIndex >= segments.length - 1) {
        const last = segments[segments.length - 1];
        if (isTextSegment(last) && offset === last.value.length) return prev;
        if (isChipSegment(last) && offset === 1) return prev;
      }
      const seg = segments[segmentIndex];
      if (seg && isTextSegment(seg) && offset < seg.value.length) {
        return { segmentIndex, offset: offset + 1 };
      }
      if (seg && isChipSegment(seg) && offset === 0) {
        return { segmentIndex, offset: 1 };
      }
      if (segmentIndex + 1 < segments.length) {
        return { segmentIndex: segmentIndex + 1, offset: 0 };
      }
      return prev;
    });
  }, [segments]);

  const getPlainText = React.useCallback(() => {
    return segmentsToPlainText(segments);
  }, [segments]);

  const getChipSegmentsList = React.useCallback(() => {
    return getChipSegments(segments);
  }, [segments]);

  // Convert plain text offset to segment index + offset (for segment-based range removal)
  const getSegmentOffsetFromPlain = React.useCallback(
    (plainOffset: number): { segmentIndex: number; offset: number } | null => {
      let offset = 0;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (isTextSegment(seg)) {
          if (offset + seg.value.length >= plainOffset) {
            return { segmentIndex: i, offset: plainOffset - offset };
          }
          offset += seg.value.length;
        }
      }
      const lastIdx = segments.length - 1;
      if (lastIdx >= 0) {
        const last = segments[lastIdx];
        const off = isTextSegment(last) ? last.value.length : 0;
        return { segmentIndex: lastIdx, offset: off };
      }
      return null;
    },
    [segments]
  );

  // Get cursor position as plain text offset
  const getCursorOffset = React.useCallback(() => {
    let offset = 0;
    for (let i = 0; i < cursor.segmentIndex; i++) {
      const seg = segments[i];
      if (isTextSegment(seg)) {
        offset += seg.value.length;
      }
      // Chips don't contribute to plain text offset
    }
    const currentSeg = segments[cursor.segmentIndex];
    if (currentSeg && isTextSegment(currentSeg)) {
      offset += cursor.offset;
    }
    return offset;
  }, [segments, cursor]);

  // Set cursor position based on plain text offset
  const setCursorToOffset = React.useCallback((targetOffset: number) => {
    let offset = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (isTextSegment(seg)) {
        if (offset + seg.value.length >= targetOffset) {
          setCursorState({ segmentIndex: i, offset: targetOffset - offset });
          return;
        }
        offset += seg.value.length;
      }
      // Skip chips for offset calculation
    }
    // If we reach here, set cursor to end
    const lastIdx = segments.length - 1;
    const lastSeg = segments[lastIdx];
    if (lastSeg && isTextSegment(lastSeg)) {
      setCursorState({ segmentIndex: lastIdx, offset: lastSeg.value.length });
    } else {
      setCursorState({ segmentIndex: lastIdx, offset: 0 });
    }
  }, [segments]);

  // Remove text from start to end offset (plain text offsets)
  const removeRange = React.useCallback((start: number, end: number) => {
    setSegments((prev) => {
      const plainText = segmentsToPlainText(prev);
      const newText = plainText.slice(0, start) + plainText.slice(end);
      // Preserve chips and rebuild text segments
      const chips = getChipSegments(prev);
      const result: Segment[] = [];
      if (newText) {
        result.push({ type: "text", value: newText });
      }
      chips.forEach((chip) => result.push(chip));
      return result.length > 0 ? result : [{ type: "text", value: "" }];
    });
    setCursorState({ segmentIndex: 0, offset: start });
  }, []);

  // Remove range by segment indices (e.g. when user selects chip + text and hits Backspace). Removes chips in range and calls onRemove*.
  const removeSegmentRange = React.useCallback(
    (
      startSegmentIndex: number,
      startOffset: number,
      endSegmentIndex: number,
      endOffset: number
    ) => {
      let sSeg = startSegmentIndex;
      let sOff = startOffset;
      let eSeg = endSegmentIndex;
      let eOff = endOffset;
      if (sSeg > eSeg || (sSeg === eSeg && sOff > eOff)) {
        [sSeg, sOff, eSeg, eOff] = [eSeg, eOff, sSeg, sOff];
      }
      const removedChips: ChipSegment[] = [];
      let newCursorSeg = 0;
      let newCursorOff = 0;
      setSegments((prev) => {
        const result: Segment[] = [];
        for (let i = 0; i < prev.length; i++) {
          const seg = prev[i];
          if (i < sSeg) {
            result.push(seg);
          } else if (i > eSeg) {
            result.push(seg);
          } else if (i === sSeg && i === eSeg) {
            if (isTextSegment(seg)) {
              const val = seg.value.slice(0, sOff) + seg.value.slice(eOff);
              if (val) {
                result.push({ type: "text", value: val });
                newCursorSeg = result.length - 1;
                newCursorOff = sOff;
              }
            } else {
              if (isChipSegment(seg)) removedChips.push(seg);
            }
          } else if (i === sSeg) {
            if (isTextSegment(seg)) {
              const val = seg.value.slice(0, sOff);
              if (val) {
                result.push({ type: "text", value: val });
                newCursorSeg = result.length - 1;
                newCursorOff = sOff;
              }
            } else {
              if (isChipSegment(seg)) removedChips.push(seg);
            }
          } else if (i === eSeg) {
            if (isTextSegment(seg)) {
              const val = seg.value.slice(eOff);
              if (val) result.push({ type: "text", value: val });
            } else {
              if (isChipSegment(seg)) removedChips.push(seg);
            }
          } else {
            if (isChipSegment(seg)) removedChips.push(seg);
          }
        }
        return result.length > 0 ? result : [{ type: "text", value: "" }];
      });
      removedChips.forEach((seg) => {
        if (seg.kind === "property") onRemovePropertyChip?.(seg.id);
        else onRemoveDocumentChip?.(seg.id);
      });
      setCursorState({ segmentIndex: newCursorSeg, offset: newCursorOff });
    },
    [onRemovePropertyChip, onRemoveDocumentChip]
  );

  // Remove chip at segment index (e.g. when user clicks X on chip). Syncs external state via onRemove*.
  const removeChipAtIndex = React.useCallback(
    (index: number) => {
      const seg = segments[index];
      if (!seg || !isChipSegment(seg)) return;
      if (seg.kind === "property") onRemovePropertyChip?.(seg.id);
      else onRemoveDocumentChip?.(seg.id);
      setSegments((prev) => {
        const s = prev[index];
        if (!s || !isChipSegment(s)) return prev;
        const next = prev.slice(0, index).concat(prev.slice(index + 1));
        return next.length > 0 ? next : [{ type: "text", value: "" }];
      });
      setCursorState((prev) => {
        if (prev.segmentIndex > index) {
          return { segmentIndex: prev.segmentIndex - 1, offset: prev.offset };
        }
        if (prev.segmentIndex === index) {
          const newIdx = Math.max(0, index - 1);
          const newSeg = segments[newIdx];
          const offset = newSeg && isTextSegment(newSeg) ? newSeg.value.length : 0;
          return { segmentIndex: newIdx, offset };
        }
        return prev;
      });
    },
    [onRemovePropertyChip, onRemoveDocumentChip, segments]
  );

  return {
    segments,
    setSegments,
    cursor,
    setCursor,
    insertTextAtCursor,
    insertChipAtCursor,
    backspace,
    deleteForward,
    moveCursorLeft,
    moveCursorRight,
    getPlainText,
    getChipSegmentsList,
    getCursorOffset,
    setCursorToOffset,
    removeRange,
    getSegmentOffsetFromPlain,
    removeSegmentRange,
    removeChipAtIndex,
  };
}

/** Build initial segments from plain text and existing chips (chips appended at end). */
export function buildInitialSegments(
  plainText: string,
  propertyChips: Array<{ id: string; label: string; payload?: unknown }>,
  documentChips: Array<{ id: string; label: string }>
): Segment[] {
  const segs: Segment[] = [];
  if (plainText) {
    segs.push({ type: "text", value: plainText });
  }
  propertyChips.forEach((c) => {
    segs.push({
      type: "chip",
      kind: "property",
      id: c.id,
      label: c.label,
      payload: c.payload,
    });
  });
  documentChips.forEach((c) => {
    segs.push({
      type: "chip",
      kind: "document",
      id: c.id,
      label: c.label,
    });
  });
  return segs.length > 0 ? segs : [{ type: "text", value: "" }];
}

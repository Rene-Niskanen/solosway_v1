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
  onRemovePropertyChip?: (id: string) => void;
  onRemoveDocumentChip?: (id: string) => void;
}

export interface UseSegmentInputReturn {
  segments: Segment[];
  setSegments: React.Dispatch<React.SetStateAction<Segment[]>>;
  cursor: CursorPosition;
  setCursor: React.Dispatch<React.SetStateAction<CursorPosition>>;
  insertTextAtCursor: (char: string) => void;
  insertChipAtCursor: (chip: ChipSegment) => void;
  backspace: () => void;
  deleteForward: () => void;
  moveCursorLeft: () => void;
  moveCursorRight: () => void;
  removeRange: (start: number, end: number) => void;
  setCursorToOffset: (offset: number) => void;
  getPlainText: () => string;
  getChipSegmentsList: () => ChipSegment[];
  getCursorOffset: () => number;
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
    onRemovePropertyChip,
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

  React.useEffect(() => {
    setCursorState((prev) => clampCursor(segments, prev));
  }, [segments]);

  const insertTextAtCursor = React.useCallback(
    (char: string) => {
      setSegments((prev) => {
        const segs = [...prev];
        const { segmentIndex, offset } = clampCursor(segs, cursor);
        const seg = segs[segmentIndex];

        if (!seg) {
          // Empty segments array - create first text segment
          return [{ type: "text", value: char }];
        }

        if (isTextSegment(seg)) {
          const newValue =
            seg.value.slice(0, offset) + char + seg.value.slice(offset);
          segs[segmentIndex] = { ...seg, value: newValue };
          setCursorState({ segmentIndex, offset: offset + char.length });
        } else {
          // Chip segment - insert text segment after
          const newTextSeg: TextSegment = { type: "text", value: char };
          segs.splice(segmentIndex + 1, 0, newTextSeg);
          setCursorState({ segmentIndex: segmentIndex + 1, offset: char.length });
        }

        return segs;
      });
    },
    [cursor]
  );

  const insertChipAtCursor = React.useCallback(
    (chip: ChipSegment) => {
      setSegments((prev) => {
        const segs = [...prev];
        const { segmentIndex, offset } = clampCursor(segs, cursor);
        const seg = segs[segmentIndex];

        if (!seg) {
          return [chip, { type: "text", value: "" }];
        }

        if (isTextSegment(seg)) {
          const before = seg.value.slice(0, offset);
          const after = seg.value.slice(offset);
          const newSegs: Segment[] = [];
          if (before) newSegs.push({ type: "text", value: before });
          newSegs.push(chip);
          newSegs.push({ type: "text", value: after });
          segs.splice(segmentIndex, 1, ...newSegs);
          const chipIdx = segmentIndex + (before ? 1 : 0);
          setCursorState({ segmentIndex: chipIdx + 1, offset: 0 });
        } else {
          segs.splice(segmentIndex + 1, 0, chip, { type: "text", value: "" });
          setCursorState({ segmentIndex: segmentIndex + 2, offset: 0 });
        }

        return segs;
      });
    },
    [cursor]
  );

  const backspace = React.useCallback(() => {
    setSegments((prev) => {
      const segs = [...prev];
      const { segmentIndex, offset } = clampCursor(segs, cursor);
      const seg = segs[segmentIndex];

      if (!seg) return segs;

      if (isTextSegment(seg)) {
        if (offset > 0) {
          const newValue = seg.value.slice(0, offset - 1) + seg.value.slice(offset);
          segs[segmentIndex] = { ...seg, value: newValue };
          setCursorState({ segmentIndex, offset: offset - 1 });
        } else if (segmentIndex > 0) {
          const prevSeg = segs[segmentIndex - 1];
          if (isChipSegment(prevSeg)) {
            if (prevSeg.kind === "property") {
              onRemovePropertyChip?.(prevSeg.id);
            } else {
              onRemoveDocumentChip?.(prevSeg.id);
            }
            segs.splice(segmentIndex - 1, 1);
            setCursorState({ segmentIndex: segmentIndex - 1, offset: 0 });
          } else {
            // Merge with previous text segment
            const merged = prevSeg.value + seg.value;
            segs[segmentIndex - 1] = { type: "text", value: merged };
            segs.splice(segmentIndex, 1);
            setCursorState({ segmentIndex: segmentIndex - 1, offset: prevSeg.value.length });
          }
        }
      } else {
        // Cursor is on a chip - remove it
        if (isChipSegment(seg)) {
          if (seg.kind === "property") {
            onRemovePropertyChip?.(seg.id);
          } else {
            onRemoveDocumentChip?.(seg.id);
          }
        }
        segs.splice(segmentIndex, 1);
        if (segs.length === 0) {
          segs.push({ type: "text", value: "" });
        }
        setCursorState({ segmentIndex: Math.max(0, segmentIndex - 1), offset: 0 });
      }

      return segs;
    });
  }, [cursor, onRemovePropertyChip, onRemoveDocumentChip]);

  const deleteForward = React.useCallback(() => {
    setSegments((prev) => {
      const segs = [...prev];
      const { segmentIndex, offset } = clampCursor(segs, cursor);
      const seg = segs[segmentIndex];

      if (!seg) return segs;

      if (isTextSegment(seg)) {
        if (offset < seg.value.length) {
          const newValue = seg.value.slice(0, offset) + seg.value.slice(offset + 1);
          segs[segmentIndex] = { ...seg, value: newValue };
        } else if (segmentIndex < segs.length - 1) {
          const nextSeg = segs[segmentIndex + 1];
          if (isChipSegment(nextSeg)) {
            if (nextSeg.kind === "property") {
              onRemovePropertyChip?.(nextSeg.id);
            } else {
              onRemoveDocumentChip?.(nextSeg.id);
            }
            segs.splice(segmentIndex + 1, 1);
          } else {
            // Merge with next text segment
            const merged = seg.value + nextSeg.value;
            segs[segmentIndex] = { type: "text", value: merged };
            segs.splice(segmentIndex + 1, 1);
          }
        }
      } else {
        // Cursor is on a chip - remove it
        if (isChipSegment(seg)) {
          if (seg.kind === "property") {
            onRemovePropertyChip?.(seg.id);
          } else {
            onRemoveDocumentChip?.(seg.id);
          }
        }
        segs.splice(segmentIndex, 1);
        if (segs.length === 0) {
          segs.push({ type: "text", value: "" });
        }
      }

      return segs;
    });
  }, [cursor, onRemovePropertyChip, onRemoveDocumentChip]);

  const moveCursorLeft = React.useCallback(() => {
    setCursorState((prev) => {
      const { segmentIndex, offset } = prev;
      if (offset > 0) {
        return { segmentIndex, offset: offset - 1 };
      } else if (segmentIndex > 0) {
        const prevSeg = segments[segmentIndex - 1];
        const newOffset = isTextSegment(prevSeg) ? prevSeg.value.length : 0;
        return { segmentIndex: segmentIndex - 1, offset: newOffset };
      }
      return prev;
    });
  }, [segments]);

  const moveCursorRight = React.useCallback(() => {
    setCursorState((prev) => {
      const { segmentIndex, offset } = prev;
      const seg = segments[segmentIndex];
      if (!seg) return prev;

      const maxOffset = isTextSegment(seg) ? seg.value.length : 1;
      if (offset < maxOffset) {
        return { segmentIndex, offset: offset + 1 };
      } else if (segmentIndex < segments.length - 1) {
        return { segmentIndex: segmentIndex + 1, offset: 0 };
      }
      return prev;
    });
  }, [segments]);

  const removeRange = React.useCallback(
    (start: number, end: number) => {
      setSegments((prev) => {
        let segs = [...prev];
        const plainText = segmentsToPlainText(segs);
        const before = plainText.slice(0, start);
        const after = plainText.slice(end);
        // Simple approach: rebuild with just text
        const newText = before + after;
        segs = [{ type: "text", value: newText }];
        setCursorState({ segmentIndex: 0, offset: start });
        return segs;
      });
    },
    []
  );

  const setCursorToOffset = React.useCallback(
    (offset: number) => {
      let remaining = offset;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const len = isTextSegment(seg) ? seg.value.length : 1;
        if (remaining <= len) {
          setCursorState({ segmentIndex: i, offset: remaining });
          return;
        }
        remaining -= len;
      }
      // Past end - set to end of last segment
      if (segments.length > 0) {
        const lastIdx = segments.length - 1;
        const lastSeg = segments[lastIdx];
        const lastLen = isTextSegment(lastSeg) ? lastSeg.value.length : 1;
        setCursorState({ segmentIndex: lastIdx, offset: lastLen });
      }
    },
    [segments]
  );

  const getPlainText = React.useCallback(() => {
    return segmentsToPlainText(segments);
  }, [segments]);

  const getChipSegmentsList = React.useCallback(() => {
    return getChipSegments(segments);
  }, [segments]);

  const getCursorOffset = React.useCallback(() => {
    let offset = 0;
    for (let i = 0; i < cursor.segmentIndex && i < segments.length; i++) {
      const seg = segments[i];
      offset += isTextSegment(seg) ? seg.value.length : 1;
    }
    offset += cursor.offset;
    return offset;
  }, [segments, cursor]);

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
    removeRange,
    setCursorToOffset,
    getPlainText,
    getChipSegmentsList,
    getCursorOffset,
  };
}

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

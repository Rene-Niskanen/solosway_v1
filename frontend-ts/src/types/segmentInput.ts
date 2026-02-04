/**
 * Segment-based input model for inline text + chips (Cursor-style).
 */

export type SegmentKind = "property" | "document";

export interface TextSegment {
  type: "text";
  value: string;
}

export interface ChipSegment {
  type: "chip";
  kind: SegmentKind;
  id: string;
  label: string;
  /** For property: full property payload for context/attachment. For document: optional. */
  payload?: unknown;
}

export type Segment = TextSegment | ChipSegment;

export interface CursorPosition {
  segmentIndex: number;
  offset: number;
}

export function isTextSegment(s: Segment): s is TextSegment {
  return s.type === "text";
}

export function isChipSegment(s: Segment): s is ChipSegment {
  return s.type === "chip";
}

/** Plain text only (no chip labels), for submission or display. */
export function segmentsToPlainText(segments: Segment[]): string {
  return segments
    .filter(isTextSegment)
    .map((s) => s.value)
    .join("");
}

/** All chip segments for attachments. */
export function getChipSegments(segments: Segment[]): ChipSegment[] {
  return segments.filter(isChipSegment);
}

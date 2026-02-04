export interface TextSegment {
  type: "text";
  value: string;
}

export interface ChipSegment {
  type: "chip";
  kind: "property" | "document";
  id: string;
  label: string;
  payload?: unknown;
}

export type Segment = TextSegment | ChipSegment;

export interface CursorPosition {
  segmentIndex: number;
  offset: number;
}

export function isTextSegment(seg: Segment): seg is TextSegment {
  return seg.type === "text";
}

export function isChipSegment(seg: Segment): seg is ChipSegment {
  return seg.type === "chip";
}

export function segmentsToPlainText(segments: Segment[]): string {
  return segments
    .map((seg) => (isTextSegment(seg) ? seg.value : ""))
    .join("");
}

export function getChipSegments(segments: Segment[]): ChipSegment[] {
  return segments.filter(isChipSegment);
}

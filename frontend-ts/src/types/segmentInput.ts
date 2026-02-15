/**
 * Segment-based input model for inline text + chips (Cursor-style).
 */

import type { PropertyAttachmentData } from '../components/PropertyAttachment';

export type SegmentKind = "property" | "document" | "citation_snippet";

/** Citation payload shape for citation_snippet chips (stored in payload.citationData). */
export interface CitationBboxShape {
  document_id?: string;
  doc_id?: string;
  page_number?: number;
  page?: number;
  bbox?: { left: number; top: number; width: number; height: number; page?: number };
  original_filename?: string;
  block_id?: string;
  cited_text?: string;
  block_content?: string;
  source_message_text?: string;
}

/** Ordered content for query bubble (exact chip + text order as in input). Shared by SearchBar, MapChatBar, MainContent, SideChatPanel. */
export type QueryContentSegment =
  | { type: 'text'; value: string }
  | { type: 'property'; attachment: PropertyAttachmentData }
  | { type: 'document'; id: string; name: string }
  | { type: 'citation_snippet'; snippet: string; citationData?: CitationBboxShape };

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

export function isTextSegment(s: Segment | undefined): s is TextSegment {
  return s != null && s.type === "text";
}

export function isChipSegment(s: Segment | undefined): s is ChipSegment {
  return s != null && s.type === "chip";
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

/**
 * Build a single query string from segments so the model sees the full sentence with chip labels in place.
 * E.g. "what is the value of " + [highlands chip] → "what is the value of highlands".
 * Use this whenever you send a query that was built from segment input (dashboard or panel).
 */
export function segmentsToLinkedQuery(segments: Segment[]): string {
  return segments
    .map((s) => (isTextSegment(s) ? s.value : isChipSegment(s) ? s.label : ''))
    .join('')
    .trim();
}

/**
 * Same as segmentsToLinkedQuery but for QueryContentSegment[] (from SearchBar/MapChatBar).
 * Links text and property/document labels in order so the sentence context is clear.
 */
export function contentSegmentsToLinkedQuery(segments: QueryContentSegment[]): string {
  return segments
    .map((seg) => {
      if (seg.type === 'text') return seg.value;
      if (seg.type === 'property') {
        const att = seg.attachment;
        return (
          att?.address ??
          (att?.property as { formatted_address?: string })?.formatted_address ??
          (att?.property as { normalized_address?: string })?.normalized_address ??
          (att?.property as { address?: string })?.address ??
          'the property'
        );
      }
      if (seg.type === 'document') return seg.name ?? '';
      if (seg.type === 'citation_snippet') return seg.snippet ?? '';
      return '';
    })
    .join('')
    .trim();
}

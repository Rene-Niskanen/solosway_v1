import React, { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { SEARCHING_CAROUSEL_TYPES } from '../constants/documentTypes';

const CIRCLE_SIZE_PX = 20;
const OVERLAP_PX = 10;
const VISIBLE_COUNT = 3; // Only show 3 icons at a time; rotate by replacing, no slide
const CONTAINER_WIDTH_PX = CIRCLE_SIZE_PX + OVERLAP_PX * (VISIBLE_COUNT - 1);
const CYCLE_INTERVAL_MS = 480;
const FAST_CYCLE_INTERVAL_MS = 360;

export type SourceType = 'pdf' | 'docx';

/** All document types from backend (e.g. { pdf: 50, docx: 1, txt: 2 }) */
export type SourceCountByType = Record<string, number>;

/** Doc preview from exploring step (files we're going to read) */
export type DocPreviewForCarousel = { original_filename?: string | null; classification_type?: string | null };

interface SearchingSourcesCarouselProps {
  sourceTypes?: SourceType[];
  sourceCountByType?: SourceCountByType;
  docPreviews?: DocPreviewForCarousel[];
  isActive?: boolean;
  sourceCount?: number;
}

function CircleIcon({ type }: { type: string }) {
  if (type === 'pdf') {
    return (
      <img
        src="/PDF.png"
        alt=""
        aria-hidden
        style={{ width: 14, height: 14, objectFit: 'contain' }}
      />
    );
  }
  if (type === 'docx') {
    return (
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: '#2563EB',
          lineHeight: 1,
          fontFamily: 'system-ui, sans-serif',
        }}
        aria-hidden
      >
        W
      </span>
    );
  }
  // Only show supported types; unknown extensions fall back to PDF (no random letters like "V")
  return (
    <img
      src="/PDF.png"
      alt=""
      aria-hidden
      style={{ width: 14, height: 14, objectFit: 'contain' }}
    />
  );
}

function typeFromFilename(filename: string | null | undefined): string {
  if (!filename || !filename.includes('.')) return 'pdf';
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return ext === 'docx' ? 'docx' : ext === 'pdf' ? 'pdf' : ext || 'pdf';
}

/** Map raw type to an allowed carousel type only (no random letters like "V"). */
function toAllowedType(rawType: string, allowed: readonly string[]): string {
  if (allowed.includes(rawType)) return rawType;
  return allowed[0] ?? 'pdf';
}

/** Ordered list of doc types from exploring step; only types we're allowed to show (e.g. PDF only). */
function typesListFromDocPreviews(
  docPreviews: DocPreviewForCarousel[],
  allowedTypes: readonly string[]
): string[] {
  return docPreviews.map((d) =>
    toAllowedType(typeFromFilename(d.original_filename ?? undefined), allowedTypes)
  );
}

export function SearchingSourcesCarousel({
  sourceTypes = SEARCHING_CAROUSEL_TYPES,
  sourceCountByType,
  docPreviews,
  isActive = true,
  sourceCount,
}: SearchingSourcesCarouselProps) {
  const allowedTypes = useMemo(
    () => (sourceTypes?.length ? sourceTypes : SEARCHING_CAROUSEL_TYPES),
    [sourceTypes]
  );

  // Ordered list of files we're going to read (from file sidebar or exploring step).
  // Ensure at least 9 items so the step interval visibly rotates; repeat short lists.
  const typesList = useMemo(() => {
    let list: string[];
    if (docPreviews && docPreviews.length > 0) {
      list = typesListFromDocPreviews(docPreviews, allowedTypes);
      // Repeat so we have enough slots for visible rotation (otherwise 1–3 docs look static)
      while (list.length < 9) list = list.concat(list);
      if (list.length > 30) list = list.slice(0, 30);
    } else {
      const n = Math.min(Math.max(sourceCount ?? 0, 9), 30);
      list = [];
      for (let i = 0; i < n; i++) list.push(allowedTypes[i % allowedTypes.length]);
      if (list.length === 0) list = [...allowedTypes, ...allowedTypes, ...allowedTypes];
    }
    return list;
  }, [docPreviews, allowedTypes, sourceCount]);

  const [step, setStep] = useState(0);
  const L = typesList.length;

  // Exactly 3 items: no slide, so the one that "leaves" is hidden (removed), not moved — never looks like 4.
  const stripList = useMemo(() => {
    if (L === 0) return [];
    return [0, 1, 2].map((i) => typesList[(step + i) % L]);
  }, [typesList, step, L]);

  useEffect(() => {
    if (!isActive || L === 0) return;
    const interval =
      (sourceCount != null && sourceCount > 5) ? FAST_CYCLE_INTERVAL_MS : CYCLE_INTERVAL_MS;
    const id = setInterval(() => setStep((s) => (s + 1) % L), interval);
    return () => clearInterval(id);
  }, [isActive, L, sourceCount]);

  useEffect(() => {
    setStep(0);
  }, [typesList]);

  return (
    <span
      role="img"
      aria-label="Searching through documents"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        width: CONTAINER_WIDTH_PX,
        height: CIRCLE_SIZE_PX,
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <motion.span
        key={step}
        initial={{ opacity: 0.85 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        {stripList.map((type, i) => (
          <span
            key={`strip-${step}-${i}`}
            style={{
              width: CIRCLE_SIZE_PX,
              height: CIRCLE_SIZE_PX,
              minWidth: CIRCLE_SIZE_PX,
              borderRadius: '50%',
              border: '1px solid #FCFCF9',
              background: '#FAFAFA',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: i === 0 ? 0 : -OVERLAP_PX,
              position: 'relative',
              zIndex: i,
            }}
          >
            <CircleIcon type={type} />
          </span>
        ))}
      </motion.span>
    </span>
  );
}

export default SearchingSourcesCarousel;

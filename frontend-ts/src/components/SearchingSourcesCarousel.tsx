import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SEARCHING_CAROUSEL_TYPES } from '../constants/documentTypes';

const CIRCLE_SIZE_PX = 20;
const OVERLAP_PX = 11; // stacked but not too tight
const VISIBLE_COUNT = 3;
// Extra space so enter animation and rightmost icon are never clipped
const CONTAINER_EXTRA_RIGHT_PX = 18;
const CONTAINER_WIDTH_PX = CIRCLE_SIZE_PX + OVERLAP_PX * (VISIBLE_COUNT - 1) + CONTAINER_EXTRA_RIGHT_PX;
const CYCLE_INTERVAL_MS = 520;
const FAST_CYCLE_INTERVAL_MS = 420;
const STACK_DURATION_S = 0.4;
const EASE_SMOOTH = [0.33, 0.84, 0.5, 0.99] as const;

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

  // Exactly 3 items in the stack; step advances so back disappears and new stacks on
  const stripList = useMemo(() => {
    if (L === 0) return [];
    return [0, 1, 2].map((i) => ({ type: typesList[(step + i) % L], key: step + i }));
  }, [typesList, step, L]);

  useEffect(() => {
    if (!isActive || L === 0) return;
    const interval =
      (sourceCount != null && sourceCount > 5) ? FAST_CYCLE_INTERVAL_MS : CYCLE_INTERVAL_MS;
    const id = setInterval(() => setStep((s) => s + 1), interval);
    return () => clearInterval(id);
  }, [isActive, L, sourceCount]);

  useEffect(() => {
    setStep(0);
  }, [typesList]);

  const transition = {
    duration: STACK_DURATION_S,
    ease: EASE_SMOOTH,
  };

  return (
    <span
      role="img"
      aria-label="Searching through documents"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        width: CONTAINER_WIDTH_PX,
        minWidth: CONTAINER_WIDTH_PX,
        height: CIRCLE_SIZE_PX,
        flexShrink: 0,
        overflow: 'visible',
        position: 'relative',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', position: 'relative', overflow: 'visible' }}>
        <AnimatePresence initial={false} mode="sync">
          {stripList.map(({ type, key: itemKey }, i) => (
            <motion.span
              key={itemKey}
              layout
              initial={i === 2 ? { opacity: 0, scale: 0.92, x: 1 } : false}
              animate={{
                opacity: 1,
                scale: 1,
                x: 0,
              }}
              exit={{ opacity: 0, transition: { duration: 0 } }}
              transition={transition}
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
          </motion.span>
        ))}
        </AnimatePresence>
      </span>
    </span>
  );
}

export default SearchingSourcesCarousel;

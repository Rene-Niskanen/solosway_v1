"use client";

import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Check, Circle, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/** Backend pipeline_progress history entry (from getDocumentStatus) */
export interface PipelineHistoryEntry {
  step_name: string;
  step_status: string;
  step_message?: string;
  step_metadata?: Record<string, unknown>;
  duration_seconds?: number;
  started_at?: string;
  completed_at?: string;
}

/** Backend pipeline_progress shape (from getDocumentStatus) */
export interface PipelineProgressData {
  pipeline_type?: 'full' | 'minimal';
  steps?: string[];
  history?: PipelineHistoryEntry[];
  current_step?: string;
}

export const PIPELINE_STAGE_LABELS = [
  'Classify',
  'Extract',
  'Normalize',
  'Link',
  'Index',
] as const;

/** Backend step names that map to each UI stage index (0–4) */
const STAGE_STEP_NAMES: string[][] = [
  ['classification'],
  ['extraction', 'minimal_extraction'],
  ['normalization'],
  ['linking'],
  ['vectorization'],
];

export type PipelineStageState = {
  completedStages: number; // 0-5
  currentStageIndex: number | null; // 0-4 = spinner on that row; null = all done
};

/**
 * Maps backend pipeline_progress (and doc status) to the 5 UI stages.
 * Full pipeline: classification → extraction → normalization → linking → vectorization.
 * Minimal pipeline: classification → minimal_extraction (stages 2-5 show complete when doc completed).
 */
export function mapPipelineProgressToStages(
  pipelineProgress: PipelineProgressData | null | undefined,
  docStatus?: string
): PipelineStageState {
  const completed = (pipelineProgress?.history ?? [])
    .filter((h) => (h.step_status || '').toLowerCase() === 'completed')
    .map((h) => h.step_name.toLowerCase());

  const has = (name: string) => completed.some((c) => c.includes(name) || name.includes(c));

  // Document already finished: show all 5 stages complete
  if (docStatus === 'completed' || docStatus === 'failed') {
    return {
      completedStages: 5,
      currentStageIndex: null,
    };
  }

  const steps = pipelineProgress?.steps ?? [];
  const isMinimal = pipelineProgress?.pipeline_type === 'minimal' || steps.length <= 2;

  if (isMinimal) {
    const stage1Done = has('classification');
    const stage2Done = has('minimal_extraction');
    const completedStages = (stage1Done ? 1 : 0) + (stage2Done ? 1 : 0);
    let currentStageIndex: number | null = null;
    if (!stage1Done) currentStageIndex = 0;
    else if (!stage2Done) currentStageIndex = 1;
    else currentStageIndex = 2; // show spinner on 3rd until doc completes
    return { completedStages, currentStageIndex };
  }

  // Full pipeline: 1:1 mapping
  const stage0Done = has('classification');
  const stage1Done = has('extraction');
  const stage2Done = has('normalization');
  const stage3Done = has('linking');
  const stage4Done = has('vectorization');
  const completedStages =
    (stage0Done ? 1 : 0) +
    (stage1Done ? 1 : 0) +
    (stage2Done ? 1 : 0) +
    (stage3Done ? 1 : 0) +
    (stage4Done ? 1 : 0);
  let currentStageIndex: number | null = null;
  if (!stage0Done) currentStageIndex = 0;
  else if (!stage1Done) currentStageIndex = 1;
  else if (!stage2Done) currentStageIndex = 2;
  else if (!stage3Done) currentStageIndex = 3;
  else if (!stage4Done) currentStageIndex = 4;

  return { completedStages, currentStageIndex };
}

function matchStage(stepName: string, stageIndex: number): boolean {
  const names = STAGE_STEP_NAMES[stageIndex];
  if (!names) return false;
  const lower = stepName.toLowerCase();
  return names.some((n) => lower.includes(n) || n.includes(lower));
}

/** Find the history entry that corresponds to a given UI stage (last completed/failed for that step). */
export function getHistoryEntryForStage(
  history: PipelineHistoryEntry[] | undefined,
  stageIndex: number
): PipelineHistoryEntry | undefined {
  if (!history?.length) return undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (matchStage(h.step_name, stageIndex)) return h;
  }
  return undefined;
}

/** One-line summary for a stage from step_message or step_metadata (for display in list). */
export function getStageSummary(
  history: PipelineHistoryEntry[] | undefined,
  stageIndex: number,
  maxLen: number = 36
): string {
  const entry = getHistoryEntryForStage(history, stageIndex);
  if (!entry) return '';
  const msg = entry.step_message?.trim();
  if (msg) {
    return msg.length <= maxLen ? msg : msg.slice(0, maxLen - 1) + '…';
  }
  const meta = entry.step_metadata;
  if (meta && typeof meta === 'object') {
    const parts: string[] = [];
    if (typeof meta.chunk_count === 'number') parts.push(`${meta.chunk_count} chunks`);
    if (typeof meta.text_length === 'number') parts.push(`${meta.text_length.toLocaleString()} chars`);
    if (typeof meta.confidence === 'number') parts.push(`${(meta.confidence * 100).toFixed(0)}%`);
    if (typeof meta.classification_type === 'string') parts.push(meta.classification_type);
    if (parts.length) return parts.join(' · ');
  }
  if (typeof entry.duration_seconds === 'number') {
    return `${entry.duration_seconds}s`;
  }
  return '';
}

/** Number of failed steps in history. */
export function getFailedStepCount(history: PipelineHistoryEntry[] | undefined): number {
  if (!history) return 0;
  return history.filter((h) => (h.step_status || '').toLowerCase() === 'failed').length;
}

/** Indices of UI stages that have a failed history entry. */
export function getFailedStageIndices(history: PipelineHistoryEntry[] | undefined): number[] {
  if (!history) return [];
  const failed = new Set<number>();
  history.forEach((h) => {
    if ((h.step_status || '').toLowerCase() !== 'failed') return;
    for (let i = 0; i < STAGE_STEP_NAMES.length; i++) {
      if (matchStage(h.step_name, i)) failed.add(i);
    }
  });
  return Array.from(failed);
}

/** Total duration in seconds from first started_at to last completed_at, or sum of duration_seconds. */
export function getTotalDurationSeconds(history: PipelineHistoryEntry[] | undefined): number | null {
  if (!history?.length) return null;
  const withStart = history.filter((h) => h.started_at);
  const withEnd = history.filter((h) => h.completed_at);
  if (withStart.length && withEnd.length) {
    const first = withStart[0].started_at!;
    const last = withEnd[withEnd.length - 1].completed_at!;
    const s = new Date(first).getTime();
    const e = new Date(last).getTime();
    if (!isNaN(s) && !isNaN(e) && e >= s) return Math.round((e - s) / 1000);
  }
  const sum = history.reduce((acc, h) => acc + (h.duration_seconds ?? 0), 0);
  return sum > 0 ? sum : null;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

const CARD_WIDTH = 280;
const CARD_MIN_HEIGHT = 220;

// ---- Shared detail component props ----

export interface PipelineStagesDetailProps {
  variant: 'hover' | 'modal';
  completedStages: number;
  currentStageIndex: number | null;
  isComplete: boolean;
  documentName?: string;
  pipelineProgress?: PipelineProgressData | null;
  /** Only for modal: show loading spinner in body */
  isLoading?: boolean;
  /** Only for modal: close button callback */
  onClose?: () => void;
  /** Hover variant: mouse handlers so card stays open when hovering the card */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Optional className for the root (e.g. for modal wrapper) */
  className?: string;
  /** Inline styles for root (modal uses fixed dimensions; hover uses positioned wrapper) */
  style?: React.CSSProperties;
}

export const PipelineStagesDetail: React.FC<PipelineStagesDetailProps> = ({
  variant,
  completedStages,
  currentStageIndex,
  isComplete,
  documentName,
  pipelineProgress,
  isLoading = false,
  onClose,
  onMouseEnter,
  onMouseLeave,
  className,
  style: styleProp,
}) => {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const history = pipelineProgress?.history ?? [];
  const failedCount = getFailedStepCount(history);
  const failedIndices = getFailedStageIndices(history);
  const totalSeconds = getTotalDurationSeconds(history);
  const isMinimal = pipelineProgress?.pipeline_type === 'minimal';

  const toggleExpanded = useCallback((index: number) => {
    setExpandedIndex((prev) => (prev === index ? null : index));
  }, []);

  // Title: contextual
  const title =
    isLoading ? 'Loading…' : isComplete
      ? documentName ? `Ready: ${documentName}` : 'Document ready'
      : documentName ? `Processing ${documentName}…` : 'Processing…';
  const shortTitle = isLoading ? 'Loading…' : isComplete ? 'Ready' : 'Processing…';

  const progressFraction = completedStages / 5;
  const currentStepLabel =
    currentStageIndex != null ? PIPELINE_STAGE_LABELS[currentStageIndex] : null;

  const rootStyle: React.CSSProperties = {
    backgroundColor: 'white',
    border: '1px solid rgba(0,0,0,0.06)',
    borderRadius: variant === 'modal' ? 16 : 16,
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    overflow: 'hidden',
    minHeight: variant === 'modal' ? 220 : CARD_MIN_HEIGHT,
    width: variant === 'modal' ? 320 : CARD_WIDTH,
    maxHeight: variant === 'modal' ? '85vh' : undefined,
    display: 'flex',
    flexDirection: 'column',
    ...styleProp,
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={className}
        style={rootStyle}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        role="status"
        aria-live="polite"
        aria-label={`Pipeline status: ${shortTitle}. Step ${completedStages} of 5 complete.`}
      >
        {/* Header: title + progress on first row, filename on second row so bar never overlaps name */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            padding: '12px 16px',
            backgroundColor: '#F9FAFB',
            borderBottom: '1px solid #E5E7EB',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#111827', letterSpacing: '-0.01em', flex: 1, minWidth: 0 }}>
              {variant === 'hover' ? shortTitle : title.length > 45 ? shortTitle : title}
            </span>
            {!isLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <div
                  role="progressbar"
                  aria-valuenow={completedStages}
                  aria-valuemin={0}
                  aria-valuemax={5}
                  aria-label={`Step ${completedStages} of 5 complete`}
                  style={{
                    width: 76,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: '#E5E7EB',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${progressFraction * 100}%`,
                      height: '100%',
                      backgroundColor: '#3B82F6',
                      borderRadius: 2,
                      transition: 'width 0.2s ease',
                    }}
                  />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', minWidth: 24 }}>
                  {completedStages}/5
                </span>
              </div>
            )}
          </div>
          {variant === 'hover' && documentName && (
            <div
              style={{
                fontSize: 12,
                fontWeight: 400,
                color: '#6B7280',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
              title={documentName}
            >
              {documentName}
            </div>
          )}
          {!isLoading && currentStepLabel && (
            <span style={{ fontSize: 11, color: '#6B7280' }}>
              Step {currentStageIndex! + 1} of 5: {currentStepLabel}
            </span>
          )}
          {isMinimal && !isLoading && (
            <span style={{ fontSize: 11, color: '#6B7280' }}>Minimal pipeline</span>
          )}
        </div>

        {/* Error strip */}
        {failedCount > 0 && !isLoading && (
          <div
            style={{
              padding: '8px 16px',
              backgroundColor: '#FEF2F2',
              borderBottom: '1px solid #FECACA',
              fontSize: 12,
              color: '#B91C1C',
              fontWeight: 500,
            }}
          >
            {failedCount} step{failedCount !== 1 ? 's' : ''} failed
          </div>
        )}

        {/* Body: stages list */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
            padding: variant === 'modal' ? '12px 16px' : '12px 16px',
            flex: 1,
            minHeight: 0,
            overflowY: variant === 'modal' ? 'auto' : 'hidden',
          }}
        >
          {isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
              <Loader2 style={{ width: 32, height: 32, color: '#9CA3AF' }} className="animate-spin" />
            </div>
          ) : (
            PIPELINE_STAGE_LABELS.map((label, index) => {
              const isDone = index < completedStages;
              const isActive = currentStageIndex === index;
              const isFailed = failedIndices.includes(index);
              const isPending = !isDone && !isActive && !isFailed;
              const entry = getHistoryEntryForStage(history, index);
              const summary = getStageSummary(history, index);
              const isExpanded = variant === 'modal' && expandedIndex === index;

              const row = (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    ...(isActive ? { margin: '0 4px', padding: '6px 12px', borderRadius: 6, backgroundColor: '#F9FAFB' } : {}),
                  }}
                >
                  <div style={{ flexShrink: 0, width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isFailed ? (
                      <AlertCircle style={{ width: 16, height: 16, color: '#DC2626' }} aria-label="Failed" />
                    ) : isDone ? (
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          backgroundColor: '#22c55e',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Check style={{ width: 8, height: 8, color: 'white', strokeWidth: 2 }} />
                      </div>
                    ) : isActive ? (
                      <Loader2 style={{ width: 18, height: 18, color: '#6B7280' }} className="animate-spin" />
                    ) : (
                      <Circle style={{ width: 16, height: 16, color: '#D1D5DB', strokeWidth: 2 }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 400,
                        color: isPending ? '#9CA3AF' : isFailed ? '#B91C1C' : '#111827',
                      }}
                    >
                      {label}
                    </span>
                    {summary && (
                      <div
                        style={{
                          fontSize: 11,
                          color: '#6B7280',
                          marginTop: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {summary}
                      </div>
                    )}
                    {isFailed && entry?.step_message && variant === 'hover' && (
                      <div style={{ fontSize: 11, color: '#B91C1C', marginTop: 2 }}>{entry.step_message}</div>
                    )}
                  </div>
                  {variant === 'modal' && (summary || entry) && (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(index)}
                      style={{
                        padding: 4,
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        color: '#6B7280',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? 'Hide details' : 'Show details'}
                    >
                      {isExpanded ? (
                        <ChevronDown style={{ width: 16, height: 16 }} />
                      ) : (
                        <ChevronRight style={{ width: 16, height: 16 }} />
                      )}
                    </button>
                  )}
                </div>
              );

              const wrappedRow =
                variant === 'hover' && (summary || (isFailed && entry?.step_message)) ? (
                  <Tooltip key={index}>
                    <TooltipTrigger asChild>
                      <div style={{ cursor: 'default' }}>{row}</div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      {entry?.step_message && <p className="mb-1">{entry.step_message}</p>}
                      {entry?.duration_seconds != null && (
                        <p className="text-muted-foreground text-xs">Duration: {entry.duration_seconds}s</p>
                      )}
                      {entry?.step_metadata && Object.keys(entry.step_metadata).length > 0 && (
                        <pre className="text-xs mt-1 overflow-auto max-h-24">
                          {JSON.stringify(entry.step_metadata, null, 1)}
                        </pre>
                      )}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <React.Fragment key={index}>{row}</React.Fragment>
                );

              return (
                <div key={index}>
                  {variant === 'hover' ? wrappedRow : row}
                  {variant === 'modal' && isExpanded && entry && (
                    <div
                      style={{
                        marginLeft: 26,
                        marginBottom: 8,
                        padding: 10,
                        backgroundColor: '#F9FAFB',
                        borderRadius: 8,
                        fontSize: 12,
                        color: '#374151',
                        border: '1px solid #E5E7EB',
                      }}
                    >
                      {entry.step_message && (
                        <p style={{ marginBottom: 6 }}>{entry.step_message}</p>
                      )}
                      {entry.duration_seconds != null && (
                        <p style={{ marginBottom: 4 }}>Duration: {entry.duration_seconds}s</p>
                      )}
                      {entry.step_metadata && Object.keys(entry.step_metadata).length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ fontWeight: 600, fontSize: 11, color: '#6B7280' }}>Details</span>
                          <ul style={{ marginTop: 4, paddingLeft: 16 }}>
                            {Object.entries(entry.step_metadata).map(([k, v]) => (
                              <li key={k}>
                                {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer (modal only) */}
        {variant === 'modal' && (
          <div
            style={{
              padding: '12px 16px',
              borderTop: '1px solid #E5E7EB',
              backgroundColor: '#F9FAFB',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {totalSeconds != null && isComplete && (
              <span style={{ fontSize: 12, color: '#6B7280' }}>
                Completed in {formatDuration(totalSeconds)}
              </span>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: '#E5E7EB',
                  color: '#111827',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
                onKeyDown={(e) => e.key === 'Escape' && onClose()}
              >
                Close
              </button>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};

// ---- Hover preview wrapper (positioned portal) ----

export interface PipelineStagesHoverPreviewProps {
  position: { x: number; y: number };
  containerBounds?: { left: number; right: number };
  /** Minimum top (viewport Y) so the card never overlaps the upload zone or other fixed UI */
  minTop?: number;
  completedStages: number;
  currentStageIndex: number | null;
  isComplete: boolean;
  documentName?: string;
  pipelineProgress?: PipelineProgressData | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export const PipelineStagesHoverPreview: React.FC<PipelineStagesHoverPreviewProps> = ({
  position,
  containerBounds,
  minTop,
  completedStages,
  currentStageIndex,
  isComplete,
  documentName,
  pipelineProgress,
  onMouseEnter,
  onMouseLeave,
}) => {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
  const minLeft = containerBounds?.left ?? 10;
  const maxRight = containerBounds?.right ?? viewportWidth - 10;
  const showAbove = position.y > CARD_MIN_HEIGHT + 20;
  let topPosition = showAbove ? position.y - CARD_MIN_HEIGHT - 10 : position.y + 30;
  // Never overlap the upload zone or other fixed UI at the top
  if (minTop != null && topPosition < minTop) topPosition = minTop;
  // Keep card on screen at bottom
  const maxTop = viewportHeight - CARD_MIN_HEIGHT - 20;
  if (topPosition > maxTop) topPosition = maxTop;
  let leftPosition = position.x - CARD_WIDTH / 2;
  if (leftPosition < minLeft) leftPosition = minLeft;
  if (leftPosition + CARD_WIDTH > maxRight) leftPosition = maxRight - CARD_WIDTH;
  if (leftPosition < minLeft) leftPosition = minLeft;

  const card = (
    <div
      style={{
        position: 'fixed',
        left: `${leftPosition}px`,
        top: `${topPosition}px`,
        zIndex: 99999,
        pointerEvents: 'auto',
      }}
    >
      <PipelineStagesDetail
        variant="hover"
        completedStages={completedStages}
        currentStageIndex={currentStageIndex}
        isComplete={isComplete}
        documentName={documentName}
        pipelineProgress={pipelineProgress}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(card, document.body) : null;
};

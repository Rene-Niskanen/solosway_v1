"use client";

import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
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

const CARD_WIDTH = 160;
const CARD_MIN_HEIGHT = 100;

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
  const [collapsed, setCollapsed] = useState(false);
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

  const currentStepLabel =
    currentStageIndex != null ? PIPELINE_STAGE_LABELS[currentStageIndex] : null;

  const rootStyle: React.CSSProperties = {
    backgroundColor: 'white',
    border: '1px solid rgba(0,0,0,0.04)',
    borderRadius: 8,
    boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
    overflow: 'hidden',
    minHeight: variant === 'modal' ? 120 : CARD_MIN_HEIGHT,
    width: variant === 'modal' ? 200 : CARD_WIDTH,
    maxHeight: variant === 'modal' ? '85vh' : undefined,
    display: 'flex',
    flexDirection: 'column',
    ...styleProp,
  };

  return (
    <TooltipProvider delayDuration={300}>
      <style dangerouslySetInnerHTML={{ __html: '@keyframes pipeline-spinner { to { transform: rotate(360deg); } }' }} />
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
            gap: 3,
            padding: '5px 8px',
            backgroundColor: '#F9FAFB',
            borderBottom: '1px solid #E5E7EB',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              style={{
                padding: 0,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: '#6B7280',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Expand stages' : 'Collapse stages'}
            >
              <span style={{ fontSize: 9, lineHeight: 1, color: 'inherit' }} aria-hidden>
                {collapsed ? '▾' : '▴'}
              </span>
            </button>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#4A4A4A', letterSpacing: '-0.01em', flex: 1, minWidth: 0 }}>
              {variant === 'hover' ? shortTitle : title.length > 45 ? shortTitle : title}
            </span>
            {!isLoading && (
              <div
                role="progressbar"
                aria-valuenow={completedStages}
                aria-valuemin={0}
                aria-valuemax={5}
                aria-label={`Step ${completedStages} of 5 complete`}
                style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}
              >
                <div style={{ display: 'flex', gap: 1, width: 40, height: 4 }}>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      style={{
                        flex: 1,
                        height: '100%',
                        borderRadius: 0,
                        backgroundColor: i < completedStages ? '#4CAF50' : '#E0E0E0',
                        transition: 'background-color 0.2s ease',
                      }}
                    />
                  ))}
                </div>
                <span style={{ fontSize: 10, fontWeight: 500, minWidth: 16 }}>
                  <span style={{ color: '#4CAF50' }}>{completedStages}</span>
                  <span style={{ color: '#A0A0A0' }}>/5</span>
                </span>
              </div>
            )}
          </div>
          {variant === 'hover' && documentName && (
            <div
              style={{
                fontSize: 9,
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
            <span style={{ fontSize: 9, color: '#9CA3AF' }}>
              Step {currentStageIndex! + 1} of 5: {currentStepLabel}
            </span>
          )}
          {isMinimal && !isLoading && (
            <span style={{ fontSize: 9, color: '#9CA3AF' }}>Minimal pipeline</span>
          )}
        </div>

        {!collapsed && (
          <>
            {/* Error strip */}
            {failedCount > 0 && !isLoading && (
              <div
                style={{
                  padding: '3px 8px',
                  backgroundColor: '#FEF2F2',
                  borderBottom: '1px solid #FECACA',
                  fontSize: 9,
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
                gap: 3,
                padding: '5px 8px',
                flex: 1,
                minHeight: 0,
                overflowY: variant === 'modal' ? 'auto' : 'hidden',
              }}
            >
              {isLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 10 }}>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      border: '1.5px solid #E5E7EB',
                      borderTopColor: '#9CA3AF',
                      borderRadius: '50%',
                      animation: 'pipeline-spinner 0.7s linear infinite',
                    }}
                  />
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

              const stepNumber = index + 1;
              const showRightChevron = !isDone && (variant === 'modal' ? (summary || entry) : true);
              const row = (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <div style={{ flexShrink: 0, width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isFailed ? (
                      <span style={{ fontSize: 9, color: '#DC2626', fontWeight: 700 }} aria-label="Failed">!</span>
                    ) : isDone ? (
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          backgroundColor: '#4CAF50',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          fontSize: 9,
                          fontWeight: 700,
                        }}
                      >
                        ✓
                      </div>
                    ) : isActive ? (
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          backgroundColor: '#000000',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          fontSize: 8,
                          fontWeight: 700,
                        }}
                      >
                        {stepNumber}
                      </div>
                    ) : (
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          backgroundColor: '#E0E0E0',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#6B7280',
                          fontSize: 8,
                          fontWeight: 700,
                        }}
                      >
                        {stepNumber}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: isActive ? 600 : 400,
                        color: isPending ? '#6B7280' : isFailed ? '#B91C1C' : '#4A4A4A',
                      }}
                    >
                      {label}
                    </span>
                    {summary && (
                      <div
                        style={{
                          fontSize: 9,
                          color: '#6B7280',
                          marginTop: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {summary}
                      </div>
                    )}
                    {isFailed && entry?.step_message && variant === 'hover' && (
                      <div style={{ fontSize: 9, color: '#B91C1C', marginTop: 0 }}>{entry.step_message}</div>
                    )}
                  </div>
                  {variant === 'modal' && (summary || entry) ? (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(index)}
                      style={{
                        padding: 0,
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        color: isActive ? '#4A4A4A' : '#6B7280',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginLeft: 'auto',
                        fontSize: 9,
                      }}
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? 'Hide details' : 'Show details'}
                    >
                      {isExpanded ? '▾' : '›'}
                    </button>
                  ) : showRightChevron ? (
                    <span
                      style={{
                        fontSize: 9,
                        color: isActive ? '#4A4A4A' : '#9CA3AF',
                        flexShrink: 0,
                        marginLeft: 'auto',
                      }}
                    >
                      ›
                    </span>
                  ) : null}
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
                        marginLeft: 16,
                        marginBottom: 4,
                        padding: 6,
                        backgroundColor: '#F9FAFB',
                        borderRadius: 4,
                        fontSize: 9,
                        color: '#374151',
                        border: '1px solid #E5E7EB',
                      }}
                    >
                      {entry.step_message && (
                        <p style={{ marginBottom: 4, fontSize: 10 }}>{entry.step_message}</p>
                      )}
                      {entry.duration_seconds != null && (
                        <p style={{ marginBottom: 3, fontSize: 10 }}>Duration: {entry.duration_seconds}s</p>
                      )}
                      {entry.step_metadata && Object.keys(entry.step_metadata).length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          <span style={{ fontWeight: 600, fontSize: 10, color: '#6B7280' }}>Details</span>
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
          </>
        )}

        {/* Footer (modal only) */}
        {variant === 'modal' && (
          <div
            style={{
              padding: '5px 8px',
              borderTop: '1px solid #E5E7EB',
              backgroundColor: '#F9FAFB',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}
          >
            {totalSeconds != null && isComplete && (
              <span style={{ fontSize: 9, color: '#6B7280' }}>
                Completed in {formatDuration(totalSeconds)}
              </span>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                style={{
                  width: '100%',
                  padding: '5px 8px',
                  borderRadius: 4,
                  border: 'none',
                  backgroundColor: '#E5E7EB',
                  color: '#111827',
                  fontSize: 11,
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
  const gap = 28;
  // Estimated full card height (header + 5 stages) so we don't overlap the cursor
  const estimatedCardHeight = 180;
  // Prefer card above cursor so it doesn't cover the cursor; only show below when not enough space above
  const spaceAbove = minTop != null ? position.y - minTop : position.y - 20;
  const showAbove = spaceAbove >= estimatedCardHeight + gap;
  let topPosition = showAbove
    ? position.y - estimatedCardHeight - gap  // card bottom well above cursor
    : position.y + gap;                        // card top below cursor (cursor stays above card)
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
        zIndex: 100003, // Above DashboardLayout toggle rail (100002)
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

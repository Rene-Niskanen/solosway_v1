"use client";

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ScanText, Check, AlertCircle, X, RotateCcw, ArrowRight } from 'lucide-react';
import type { AgentTask, AgentTaskDocMeta } from '../contexts/AgentOrchestrationContext';

interface AgentTaskCardProps {
  task: AgentTask;
  onInjectResult: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  index: number;
}

function DocTypeIcon({ type }: { type: string }) {
  if (type === 'pdf') {
    return (
      <img src="/pdfnew.png" alt="" aria-hidden style={{ width: 13, height: 13, objectFit: 'contain' }} />
    );
  }
  return (
    <span style={{ fontSize: 9, fontWeight: 700, color: '#2563EB', lineHeight: 1, fontFamily: "'DM Sans', system-ui, sans-serif" }} aria-hidden>
      W
    </span>
  );
}

function DocTypeIcons({ docs }: { docs: AgentTaskDocMeta[] }) {
  const displayed = docs.slice(0, 4);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 6 }}>
      {displayed.map((doc, i) => (
        <span
          key={doc.doc_id}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginLeft: i > 0 ? 4 : 0,
          }}
        >
          <DocTypeIcon type={doc.type} />
        </span>
      ))}
    </span>
  );
}

/** Render text with **bold** and *italic* as React nodes. Handles malformed **text* (single trailing asterisk). */
function renderTextWithFormatting(text: string): React.ReactNode {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  let keyIdx = 0;
  const boldSplit = text.split(/\*\*([^*]*)\*?\*?/g);
  for (let i = 0; i < boldSplit.length; i++) {
    if (i % 2 === 1) {
      parts.push(<strong key={`b-${keyIdx++}`} style={{ fontWeight: 700 }}>{boldSplit[i]}</strong>);
    } else if (boldSplit[i]) {
      const bit = String(boldSplit[i]);
      const italicSplit = bit.split(/\*([^*]*)\*/g);
      for (let j = 0; j < italicSplit.length; j++) {
        if (j % 2 === 1) {
          parts.push(<em key={`e-${keyIdx++}`} style={{ fontStyle: 'italic' }}>{italicSplit[j]}</em>);
        } else if (italicSplit[j]) {
          parts.push(<React.Fragment key={`t-${keyIdx++}`}>{italicSplit[j]}</React.Fragment>);
        }
      }
    }
  }
  return parts.length > 0 ? <>{parts}</> : text;
}

function DocCountChip({ count }: { count: number }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px 2px 6px', borderRadius: 12, backgroundColor: '#F3F4F6',
      border: '1px solid #E5E7EB', fontSize: 11, fontWeight: 500, color: '#4B5563',
      marginLeft: 6, lineHeight: '18px',
    }}>
      <img src="/pdfnew.png" alt="" style={{ width: 11, height: 11, objectFit: 'contain' }} />
      {count} document{count !== 1 ? 's' : ''}
    </span>
  );
}

export const AgentTaskCard: React.FC<AgentTaskCardProps> = ({ task, onInjectResult, onCancel, onRetry, index }) => {
  const [isHovered, setIsHovered] = React.useState(false);

  const isInFlight = task.status === 'searching' || task.status === 'analysing';

  return (
    <motion.div
      layout
      role={task.status === 'complete' ? 'button' : undefined}
      tabIndex={task.status === 'complete' ? -1 : undefined}
      onMouseDown={task.status === 'complete' ? (e) => e.preventDefault() : undefined}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1], delay: index * 0.06 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 8,
        padding: task.status === 'complete' ? '8px 10px' : `6px ${isInFlight ? 40 : 10}px 6px 10px`,
        borderRadius: task.status === 'complete' ? 6 : 10,
        backgroundColor: task.status === 'error' ? '#FEF2F2' : '#FFFFFF',
        border: task.status === 'error' ? '1px solid #FECACA' : task.status === 'complete' ? '1px solid transparent' : '1px solid #E5E7EB',
        boxShadow: task.status === 'complete' ? 'none' : '0 1px 3px rgba(0,0,0,0.04)',
        cursor: task.status === 'complete' ? 'pointer' : 'default',
        transition: 'border-color 0.06s ease-out, box-shadow 0.06s ease-out, background-color 0.06s ease-out',
        ...(task.status === 'complete' && isHovered ? { backgroundColor: 'rgba(22, 163, 74, 0.12)', borderColor: 'transparent', boxShadow: 'none' } : {}),
        overflow: 'hidden',
        minWidth: 200,
      }}
      onClick={task.status === 'complete' ? () => onInjectResult(task.id) : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, gap: 8 }}>
      <AnimatePresence mode="wait">
        {task.status === 'searching' && (
          <motion.div
            key="searching"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}
          >
            <ScanText style={{ width: 15, height: 15, color: '#6B7280', flexShrink: 0 }} />
            <span className="searching-shimmer-active" style={{ fontSize: 13, fontWeight: 500, color: '#374151', whiteSpace: 'nowrap', flexShrink: 0 }}>
              Searching
            </span>
            <DocTypeIcons docs={task.documentMeta} />
            {task.query?.trim() && (
              <span
                style={{
                  fontSize: 11,
                  color: '#9CA3AF',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {task.query.trim()}
              </span>
            )}
          </motion.div>
        )}

        {task.status === 'analysing' && (
          <motion.div
            key="analysing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}
          >
            <ScanText style={{ width: 15, height: 15, color: '#6B7280', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: '#374151', whiteSpace: 'nowrap', flexShrink: 0 }}>
              Analysing
            </span>
            <DocCountChip count={task.documentIds.length} />
            {task.query?.trim() && (
              <span
                style={{
                  fontSize: 11,
                  color: '#9CA3AF',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {task.query.trim()}
              </span>
            )}
          </motion.div>
        )}

        {task.status === 'complete' && (
          <motion.div
            key="complete"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}
          >
            <Check style={{ width: 14, height: 14, color: '#16A34A', flexShrink: 0 }} strokeWidth={2.5} />
            <span style={{
              fontSize: 12.5, fontWeight: 500, color: '#374151',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
            }}>
              {(() => {
                const t = task.resultText.slice(0, 80).replace(/\[\d+\]/g, '').trim();
                return t ? renderTextWithFormatting(t) : 'Answer ready';
              })()}
            </span>
            <ArrowRight style={{ width: 13, height: 13, color: '#9CA3AF', flexShrink: 0 }} />
          </motion.div>
        )}

        {task.status === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}
          >
            <AlertCircle style={{ width: 14, height: 14, color: '#DC2626', flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, fontWeight: 500, color: '#991B1B', whiteSpace: 'nowrap' }}>
              Failed
            </span>
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => { e.stopPropagation(); onRetry(task.id); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '2px 8px', borderRadius: 6, border: '1px solid #FECACA',
                backgroundColor: 'white', fontSize: 11, fontWeight: 500, color: '#DC2626',
                cursor: 'pointer', marginLeft: 'auto',
              }}
            >
              <RotateCcw style={{ width: 10, height: 10 }} />
              Retry
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {isInFlight && isHovered && (
        <motion.button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => { e.stopPropagation(); onCancel(task.id); }}
          style={{
            marginLeft: 'auto',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 18, height: 18, borderRadius: '50%',
            backgroundColor: 'rgba(0,0,0,0.06)', border: 'none', cursor: 'pointer',
            padding: 0, flexShrink: 0,
          }}
          title="Cancel"
        >
          <X style={{ width: 10, height: 10, color: '#6B7280', flexShrink: 0 }} strokeWidth={2.5} />
        </motion.button>
      )}
      </div>

      <style>{`
        .searching-shimmer-active {
          background: linear-gradient(90deg, #374151 0%, #9CA3AF 50%, #374151 100%);
          background-size: 200% 100%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer-agent-task 1.8s ease-in-out infinite;
        }
        @keyframes shimmer-agent-task {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </motion.div>
  );
};

export default AgentTaskCard;

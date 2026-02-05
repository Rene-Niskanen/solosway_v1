import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Sparkles, X } from 'lucide-react';

// Types for summarization context (document QA outputs)
export interface SummarizationContextBlock {
  content: string;           // Document QA output from stage 3
  doc_type: string;          // "Valuation Report", "Inspection Report", etc.
  filename: string;
  address?: string;
  page_info: string;
  retrieval_method: string;
  similarity_score: number;
  doc_index: number;         // 1-indexed
  total_docs: number;
}

interface SummarizationContextViewerProps {
  blocks: SummarizationContextBlock[];
  isAnimating?: boolean;
  estimatedDurationMs?: number;  // From backend timing signal
  onClose?: () => void;
}

interface LineWithMetadata {
  text: string;
  blockIndex: number;
  block?: SummarizationContextBlock;
  lineIndexInBlock: number;
}

const MAX_VISIBLE_LINES = 15; // Number of lines to keep visible

/**
 * SummarizationContextViewer - Shows what the LLM sees during summarization
 * 
 * Displays document QA outputs that get combined into the final answer:
 * - Document headers: "DOC 1/2 | Valuation Report | Highlands | VECTOR 94%"
 * - Purple/violet theme to differentiate from reading stage
 * - Adaptive animation speed based on actual LLM processing time
 */
export const SummarizationContextViewer: React.FC<SummarizationContextViewerProps> = ({
  blocks,
  isAnimating = false,
  estimatedDurationMs,
  onClose
}) => {
  const [currentLine, setCurrentLine] = useState(0);
  const [visibleLineWindow, setVisibleLineWindow] = useState<number[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const lineIndexRef = useRef(0);

  // Split blocks into lines while preserving metadata
  const allLines = useMemo(() => {
    const lines: LineWithMetadata[] = [];
    blocks.forEach((block, blockIdx) => {
      const blockLines = block.content.split('\n');
      blockLines.forEach((lineText, lineIdxInBlock) => {
        lines.push({
          text: lineText,
          blockIndex: blockIdx,
          block: block,
          lineIndexInBlock: lineIdxInBlock
        });
      });
    });
    return lines;
  }, [blocks]);

  // Calculate adaptive animation speed
  const msPerLine = useMemo(() => {
    const totalLines = allLines.length;
    if (totalLines === 0) return 40;
    
    // Use estimated duration if available, otherwise default to 2 seconds
    const targetDurationMs = estimatedDurationMs || 2000;
    
    // Calculate ms per line, with bounds for readability
    const calculated = targetDurationMs / totalLines;
    return Math.max(20, Math.min(100, calculated)); // Min 20ms, max 100ms per line
  }, [allLines.length, estimatedDurationMs]);

  // Animate line reveal with sliding window
  useEffect(() => {
    if (!isAnimating) {
      // Show last MAX_VISIBLE_LINES at end (no animation)
      const startIdx = Math.max(0, allLines.length - MAX_VISIBLE_LINES);
      setVisibleLineWindow(Array.from({ length: Math.min(MAX_VISIBLE_LINES, allLines.length) }, (_, i) => startIdx + i));
      setCurrentLine(-1);
      return;
    }

    // Reset on animation start
    lineIndexRef.current = 0;
    setVisibleLineWindow([]);
    setCurrentLine(0);

    const interval = setInterval(() => {
      const idx = lineIndexRef.current;
      
      if (idx >= allLines.length) {
        clearInterval(interval);
        return;
      }

      lineIndexRef.current = idx + 1;

      setVisibleLineWindow(prev => {
        if (prev.includes(idx)) return prev;
        
        const newWindow = [...prev, idx];
        if (newWindow.length > MAX_VISIBLE_LINES) {
          return newWindow.slice(-MAX_VISIBLE_LINES);
        }
        return newWindow;
      });

      setCurrentLine(idx);
    }, msPerLine);

    return () => clearInterval(interval);
  }, [isAnimating, allLines.length, msPerLine]);

  // Auto-scroll to bottom as new lines are added
  useEffect(() => {
    if (contentRef.current && isAnimating) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [visibleLineWindow.length, isAnimating]);

  // Don't render if no content
  if (!blocks || blocks.length === 0 || allLines.length === 0) {
    return null;
  }

  return (
    <div className="summarization-context-viewer">
      {/* Inline styles for animations - violet/purple theme */}
      <style>{`
        .summarization-context-viewer {
          border: 1px solid #DDD6FE;
          border-radius: 8px;
          overflow: hidden;
          background: #FAFAFF;
          margin-top: 8px;
          max-width: 100%;
        }

        .summarization-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: linear-gradient(90deg, #EDE9FE 0%, #F5F3FF 100%);
          border-bottom: 1px solid #DDD6FE;
          font-size: 12px;
          color: #6B7280;
        }

        .summarization-title {
          flex: 1;
          font-weight: 500;
          color: #5B21B6;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .doc-count-badge {
          font-size: 10px;
          padding: 2px 8px;
          background: #DDD6FE;
          color: #7C3AED;
          border-radius: 10px;
          font-weight: 600;
        }

        .summarization-close {
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
          color: #A78BFA;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .summarization-close:hover {
          background: #DDD6FE;
          color: #7C3AED;
        }

        .summarization-content {
          height: 280px;
          overflow-y: auto;
          font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
          font-size: 11px;
          line-height: 1.5;
          scroll-behavior: smooth;
        }

        .summarization-content::-webkit-scrollbar {
          display: none;
        }
        .summarization-content {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }

        /* Document header styling - violet theme */
        .doc-header {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
          padding: 8px 12px;
          background: linear-gradient(90deg, #EDE9FE 0%, #F5F3FF 100%);
          border-top: 1px solid #DDD6FE;
          border-bottom: 1px solid #DDD6FE;
          font-size: 10px;
          font-weight: 600;
          margin-top: 4px;
          animation: docSlideIn 0.15s ease-out forwards;
        }

        .doc-header:first-child {
          margin-top: 0;
          border-top: none;
        }

        .doc-label {
          color: #7C3AED;
          font-weight: 700;
        }

        .doc-type {
          color: #5B21B6;
          font-weight: 600;
        }

        .doc-address {
          color: #6B7280;
          font-weight: 500;
        }

        .doc-method {
          background: #DDD6FE;
          color: #7C3AED;
          padding: 2px 6px;
          border-radius: 3px;
          text-transform: uppercase;
        }

        .doc-score {
          color: #059669;
          font-weight: 700;
        }

        .doc-pages {
          color: #9CA3AF;
          font-size: 9px;
        }

        .summarization-line {
          display: flex;
          padding: 0 12px;
          min-height: 18px;
          animation: lineSlideIn 0.1s ease-out forwards;
          will-change: transform, opacity;
          backface-visibility: hidden;
        }

        .line-number {
          width: 28px;
          flex-shrink: 0;
          color: #A78BFA;
          text-align: right;
          padding-right: 10px;
          user-select: none;
          border-right: 1px solid #DDD6FE;
          margin-right: 10px;
        }

        .line-text {
          flex: 1;
          color: #374151;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .summarization-line.scanning {
          background: linear-gradient(90deg, 
            rgba(124, 58, 237, 0.08) 0%, 
            rgba(124, 58, 237, 0.15) 50%, 
            rgba(124, 58, 237, 0.08) 100%
          );
          animation: lineSlideIn 0.1s ease-out forwards, scanPulseViolet 0.8s ease-in-out infinite;
        }

        @keyframes scanPulseViolet {
          0%, 100% { 
            background: linear-gradient(90deg, 
              rgba(124, 58, 237, 0.05) 0%, 
              rgba(124, 58, 237, 0.12) 50%, 
              rgba(124, 58, 237, 0.05) 100%
            );
          }
          50% { 
            background: linear-gradient(90deg, 
              rgba(124, 58, 237, 0.1) 0%, 
              rgba(124, 58, 237, 0.2) 50%, 
              rgba(124, 58, 237, 0.1) 100%
            );
          }
        }

        @keyframes lineSlideIn {
          from {
            opacity: 0;
            transform: translateY(-2px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes docSlideIn {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>

      {/* Header */}
      <div className="summarization-header">
        <Sparkles size={14} color="#7C3AED" />
        <span className="summarization-title">Planning next moves</span>
        <span className="doc-count-badge">
          {blocks.length} doc{blocks.length !== 1 ? 's' : ''}
        </span>
        {onClose && (
          <button onClick={onClose} className="summarization-close">
            <X size={12} />
          </button>
        )}
      </div>

      {/* Content with document headers and line numbers */}
      <div className="summarization-content" ref={contentRef}>
        {visibleLineWindow.map((lineIdx, displayIdx) => {
          const line = allLines[lineIdx];
          const isScanning = lineIdx === currentLine && isAnimating;
          const isFirstLineOfBlock = line.lineIndexInBlock === 0;
          const block = line.block;
          
          return (
            <React.Fragment key={`line-${lineIdx}`}>
              {/* Document header at start of each block */}
              {isFirstLineOfBlock && block && (
                <div className="doc-header">
                  <span className="doc-label">
                    DOC {block.doc_index}/{block.total_docs}
                  </span>
                  <span className="doc-type">{block.doc_type}</span>
                  {block.address && (
                    <span className="doc-address">{block.address}</span>
                  )}
                  <span className="doc-method">
                    {(block.retrieval_method || 'UNKNOWN').toUpperCase()}
                  </span>
                  <span className="doc-score">
                    {Math.round((block.similarity_score || 0) * 100)}%
                  </span>
                  <span className="doc-pages">{block.page_info}</span>
                </div>
              )}
              <div className={`summarization-line ${isScanning ? 'scanning' : ''}`}>
                <span className="line-number">{displayIdx + 1}</span>
                <span className="line-text">{line.text || ' '}</span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default SummarizationContextViewer;

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, ChevronDown, ChevronUp } from 'lucide-react';

// Types
interface LLMContextBlock {
  content: string;
  page: number;
  type: string;
  retrieval_method?: string;  // "bm25", "vector", "hybrid", "structured_query", etc.
  similarity_score?: number;   // 0.0 to 1.0
  chunk_index?: number;
  chunk_number?: number;      // 1-indexed position (1, 2, 3...)
  total_chunks?: number;      // Total chunk count
}

interface LLMContextViewerProps {
  blocks: LLMContextBlock[];
  filename: string;
  isAnimating?: boolean;
  onClose?: () => void;
  collapsed?: boolean; // Show collapsed version (header only with last few lines)
}

interface LineWithMetadata {
  text: string;
  page: number;
  blockIndex: number;
  block?: LLMContextBlock;
  lineIndexInBlock: number;
  absoluteLineNumber: number;  // Continuous line number across all chunks
}

const LINE_HEIGHT = 18; // px per line
const MAX_VISIBLE_LINES = 15; // Number of lines to keep visible

/**
 * LLMContextViewer - Cursor-style file reading UI with scrolling animation
 * 
 * Displays document text being sent to the LLM with:
 * - Header bar showing filename (Cursor-style colored header)
 * - Continuous line numbers across all chunks
 * - Scrolling animation: lines move up as new ones enter from bottom
 * - Fixed height container that never grows
 * - White container with colored header matching Cursor's aesthetic
 */
export const LLMContextViewer: React.FC<LLMContextViewerProps> = ({
  blocks,
  filename,
  isAnimating = false,
  onClose,
  collapsed = false
}) => {
  const [currentLine, setCurrentLine] = useState(0);
  const [visibleLineWindow, setVisibleLineWindow] = useState<number[]>([]);
  const [isExpanded, setIsExpanded] = useState(false); // For collapsed mode expand/collapse
  const contentRef = useRef<HTMLDivElement>(null);

  // Split blocks into lines while preserving metadata and calculating absolute line numbers
  const allLines = useMemo(() => {
    const lines: LineWithMetadata[] = [];
    let cumulativeLineCount = 0;
    
    blocks.forEach((block, blockIdx) => {
      const blockLines = block.content.split('\n');
      blockLines.forEach((lineText, lineIdxInBlock) => {
        const absoluteLineNumber = cumulativeLineCount + lineIdxInBlock + 1;
        lines.push({
          text: lineText,
          page: block.page,
          blockIndex: blockIdx,
          block: block,  // Preserve full block for metadata access
          lineIndexInBlock: lineIdxInBlock,
          absoluteLineNumber: absoluteLineNumber
        });
      });
      cumulativeLineCount += blockLines.length;  // Accumulate for next chunk
    });
    return lines;
  }, [blocks]);

  // Track line index with ref to avoid closure issues
  const lineIndexRef = useRef(0);

  // Animate line reveal with sliding window - ADAPTIVE SPEED based on content size
  useEffect(() => {
    if (!isAnimating) {
      // Show last MAX_VISIBLE_LINES at end (no animation)
      const startIdx = Math.max(0, allLines.length - MAX_VISIBLE_LINES);
      setVisibleLineWindow(Array.from({ length: Math.min(MAX_VISIBLE_LINES, allLines.length) }, (_, i) => startIdx + i));
      setCurrentLine(-1); // No scanning highlight
      return;
    }

    // Reset on animation start
    lineIndexRef.current = 0;
    setVisibleLineWindow([]);
    setCurrentLine(0);

    // ADAPTIVE SPEED: Calculate interval based on content size
    // Target: 2-4 seconds total animation time regardless of content size
    const totalLines = allLines.length;
    let msPerLine: number;
    
    if (totalLines <= 50) {
      // Small content: 40ms per line (~2 seconds max)
      msPerLine = 40;
    } else if (totalLines <= 200) {
      // Medium content: Scale to finish in ~3 seconds
      msPerLine = Math.max(15, 3000 / totalLines);
    } else {
      // Large content: Cap at 4 seconds total, minimum 8ms per line
      msPerLine = Math.max(8, 4000 / totalLines);
    }

    const interval = setInterval(() => {
      const idx = lineIndexRef.current;
      
      if (idx >= allLines.length) {
        clearInterval(interval);
        return;
      }

      // Increment FIRST to prevent re-adding same index
      lineIndexRef.current = idx + 1;

      setVisibleLineWindow(prev => {
        // Prevent duplicates - check if this index is already in window
        if (prev.includes(idx)) return prev;
        
        const newWindow = [...prev, idx];
        // Keep only last MAX_VISIBLE_LINES (sliding window)
        if (newWindow.length > MAX_VISIBLE_LINES) {
          return newWindow.slice(-MAX_VISIBLE_LINES);
        }
        return newWindow;
      });

      setCurrentLine(idx);
    }, msPerLine);

    return () => clearInterval(interval);
  }, [isAnimating, allLines.length]);

  // Auto-scroll to bottom as new lines are added
  useEffect(() => {
    if (contentRef.current && isAnimating) {
      // Scroll to bottom to show newest line
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [visibleLineWindow.length, isAnimating]);

  // Don't render if no content
  if (!blocks || blocks.length === 0 || allLines.length === 0) {
    return null;
  }

  // Collapsed mode: show header with expandable content
  if (collapsed) {
    const lastLines = allLines.slice(-3); // Show last 3 lines when collapsed
    const totalLines = allLines.length;
    
    return (
      <div className="llm-context-viewer llm-context-viewer-collapsed">
        <style>{`
          .llm-context-viewer-collapsed {
            border: 1px solid #E5E7EB;
            border-radius: 8px;
            overflow: hidden;
            background: transparent;
            margin-top: 4px;
            max-width: 100%;
          }

          .llm-context-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: transparent;
            border-bottom: 1px solid #E5E7EB;
            font-size: 12px;
            color: #374151;
          }

          .llm-context-filename {
            flex: 1;
            font-weight: 500;
            color: #374151;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .llm-context-expand-button {
            background: none;
            border: none;
            cursor: pointer;
            padding: 2px;
            color: #9CA3AF;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s ease;
          }

          .llm-context-expand-button:hover {
            background: #E5E7EB;
            color: #374151;
          }

          .llm-context-close {
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px;
            color: #9CA3AF;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .llm-context-close:hover {
            background: #E5E7EB;
            color: #374151;
          }

          .llm-context-collapsed-preview {
            padding: 8px 12px;
            font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
            font-size: 11px;
            line-height: 1.5;
            color: #6B7280;
            background: transparent;
            max-height: 60px;
            overflow: hidden;
            transition: max-height 0.3s ease;
          }

          .llm-context-expanded-content {
            padding: 0;
            font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
            font-size: 11px;
            line-height: 1.5;
            background: transparent;
            max-height: 400px;
            overflow-y: auto;
            overflow-x: hidden;
            transition: max-height 0.3s ease;
          }

          .llm-context-expanded-content::-webkit-scrollbar {
            width: 6px;
          }

          .llm-context-expanded-content::-webkit-scrollbar-track {
            background: #F9FAFB;
          }

          .llm-context-expanded-content::-webkit-scrollbar-thumb {
            background: #D1D5DB;
            border-radius: 3px;
          }

          .llm-context-expanded-content::-webkit-scrollbar-thumb:hover {
            background: #9CA3AF;
          }

          .llm-context-collapsed-line {
            display: flex;
            gap: 10px;
            margin-bottom: 2px;
          }

          .llm-context-collapsed-line:last-child {
            margin-bottom: 0;
          }

          .collapsed-line-number {
            color: #9CA3AF;
            min-width: 36px;
            text-align: right;
            flex-shrink: 0;
          }

          .collapsed-line-text {
            flex: 1;
            color: #6B7280;
            white-space: pre-wrap;
            word-break: break-word;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .llm-context-expanded-line {
            display: flex;
            padding: 0 12px;
            min-height: 18px;
          }

          .llm-context-expanded-line.chunk-even {
            background: transparent;
          }

          .llm-context-expanded-line.chunk-odd {
            background: rgba(0, 0, 0, 0.02);
          }

          .expanded-line-number {
            width: 36px;
            flex-shrink: 0;
            color: #9CA3AF;
            text-align: right;
            padding-right: 10px;
            user-select: none;
            border-right: 1px solid #E5E7EB;
            margin-right: 10px;
          }

          .expanded-line-text {
            flex: 1;
            color: #374151;
            white-space: pre-wrap;
            word-break: break-word;
          }

        `}</style>
        
        {/* Header */}
        <div className="llm-context-header">
          <img src="/PDF.png" alt="PDF" style={{ width: '14px', height: '14px', flexShrink: 0 }} />
          <span className="llm-context-filename">{filename}</span>
          <button 
            onClick={() => setIsExpanded(!isExpanded)} 
            className="llm-context-expand-button"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {onClose && (
            <button onClick={onClose} className="llm-context-close">
              <X size={12} />
            </button>
          )}
        </div>
        
        {/* Collapsed preview - last few lines */}
        {!isExpanded && (
          <div className="llm-context-collapsed-preview">
            {lastLines.map((line, idx) => (
              <div key={`collapsed-line-${line.absoluteLineNumber}`} className="llm-context-collapsed-line">
                <span className="collapsed-line-number">{line.absoluteLineNumber}</span>
                <span className="collapsed-line-text">{line.text || ' '}</span>
              </div>
            ))}
            {totalLines > 3 && (
              <div style={{ 
                fontSize: '10px', 
                color: '#9CA3AF', 
                marginTop: '4px',
                fontStyle: 'italic'
              }}>
                ... {totalLines - 3} more lines
              </div>
            )}
          </div>
        )}
        
        {/* Expanded content - full scrollable view */}
        {isExpanded && (
          <div className="llm-context-expanded-content">
            {allLines.map((line, idx) => {
              const chunkClass = line.blockIndex % 2 === 0 ? 'chunk-even' : 'chunk-odd';
              
              return (
                <div key={`expanded-line-${line.absoluteLineNumber}`} className={`llm-context-expanded-line ${chunkClass}`}>
                  <span className="expanded-line-number">{line.absoluteLineNumber}</span>
                  <span className="expanded-line-text">{line.text || ' '}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="llm-context-viewer">
      {/* Inline styles for animations */}
      <style>{`
        .llm-context-viewer {
          border: 1px solid #E5E7EB;
          border-radius: 8px;
          overflow: hidden;
          background: transparent;
          margin-top: 4px;
          max-width: 100%;
        }

        .llm-context-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: transparent;
          border-bottom: 1px solid #E5E7EB;
          font-size: 12px;
          color: #374151;
        }

        .llm-context-filename {
          flex: 1;
          font-weight: 500;
          color: #374151;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }


        .llm-context-close {
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
          color: #9CA3AF;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .llm-context-close:hover {
          background: #E5E7EB;
          color: #374151;
        }

        .llm-context-content {
          height: 150px; /* Compact fixed height - Cursor style */
          overflow-y: auto;
          font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
          font-size: 11px;
          line-height: 1.5;
          scroll-behavior: smooth;
        }

        /* Hide scrollbar but keep scrolling functionality */
        .llm-context-content::-webkit-scrollbar {
          display: none;
        }
        .llm-context-content {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }


        /* Chunk separator - visual divider between different chunks */
        .chunk-separator {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 12px;
          background: linear-gradient(90deg, #F9FAFB 0%, #F3F4F6 50%, #F9FAFB 100%);
          border-top: 1px solid #E5E7EB;
          border-bottom: 1px solid #E5E7EB;
          font-size: 9px;
          color: #6B7280;
          font-weight: 500;
          margin-top: 2px;
          animation: chunkSlideIn 0.15s ease-out forwards;
        }

        .chunk-separator:first-child {
          margin-top: 0;
          border-top: none;
        }

        .chunk-label {
          color: #3B82F6;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .chunk-page {
          color: #9CA3AF;
        }

        .chunk-method {
          background: #E5E7EB;
          color: #6B7280;
          padding: 1px 5px;
          border-radius: 3px;
          font-size: 8px;
          text-transform: uppercase;
        }

        .llm-context-line {
          display: flex;
          padding: 0 12px;
          min-height: 18px;
          animation: lineSlideIn 0.1s ease-out forwards;
          will-change: transform, opacity;
          backface-visibility: hidden;
        }

        /* Alternating chunk backgrounds for visual distinction */
        .llm-context-line.chunk-even {
          background: transparent;
        }

        .llm-context-line.chunk-odd {
          background: rgba(0, 0, 0, 0.02);
        }

        .line-number {
          width: 36px;
          flex-shrink: 0;
          color: #9CA3AF;
          text-align: right;
          padding-right: 10px;
          user-select: none;
          border-right: 1px solid #E5E7EB;
          margin-right: 10px;
        }

        .line-text {
          flex: 1;
          color: #374151;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .llm-context-line.scanning {
          background: linear-gradient(90deg, 
            rgba(59, 130, 246, 0.08) 0%, 
            rgba(59, 130, 246, 0.15) 50%, 
            rgba(59, 130, 246, 0.08) 100%
          ) !important;
          animation: lineSlideIn 0.1s ease-out forwards, scanPulse 0.8s ease-in-out infinite;
        }

        @keyframes scanPulse {
          0%, 100% { 
            background: linear-gradient(90deg, 
              rgba(59, 130, 246, 0.05) 0%, 
              rgba(59, 130, 246, 0.12) 50%, 
              rgba(59, 130, 246, 0.05) 100%
            );
          }
          50% { 
            background: linear-gradient(90deg, 
              rgba(59, 130, 246, 0.1) 0%, 
              rgba(59, 130, 246, 0.2) 50%, 
              rgba(59, 130, 246, 0.1) 100%
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

        @keyframes chunkSlideIn {
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
      <div className="llm-context-header">
        <img src="/PDF.png" alt="PDF" style={{ width: '14px', height: '14px', flexShrink: 0 }} />
        <span className="llm-context-filename">{filename}</span>
        {onClose && (
          <button onClick={onClose} className="llm-context-close">
            <X size={12} />
          </button>
        )}
      </div>

      {/* Content with line numbers - scrolling animation */}
      <div className="llm-context-content" ref={contentRef}>
        {visibleLineWindow.map((lineIdx, displayIdx) => {
          const line = allLines[lineIdx];
          const isScanning = lineIdx === currentLine && isAnimating;
          const isFirstLineOfChunk = line.lineIndexInBlock === 0;
          const block = line.block;
          const chunkClass = line.blockIndex % 2 === 0 ? 'chunk-even' : 'chunk-odd';
          
          return (
            <React.Fragment key={`line-${lineIdx}`}>
              {/* Chunk separator at start of each new chunk */}
              {isFirstLineOfChunk && block && (
                <div className="chunk-separator">
                  <span className="chunk-label">
                    Chunk {line.blockIndex + 1}{block.total_chunks ? `/${block.total_chunks}` : ''}
                  </span>
                  <span className="chunk-page">Page {block.page}</span>
                  {block.retrieval_method && (
                    <span className="chunk-method">{block.retrieval_method}</span>
                  )}
                </div>
              )}
              <div className={`llm-context-line ${chunkClass} ${isScanning ? 'scanning' : ''}`}>
                <span className="line-number">{line.absoluteLineNumber}</span>
                <span className="line-text">{line.text || ' '}</span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default LLMContextViewer;

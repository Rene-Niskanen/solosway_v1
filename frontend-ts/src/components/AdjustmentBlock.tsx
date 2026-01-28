import React, { useState } from 'react';
import { FileText, ChevronDown, ChevronUp } from 'lucide-react';

export interface AdjustmentBlockData {
  id: string;
  sectionName: string;
  linesAdded: number;
  linesRemoved: number;
  removedLines: string[];
  addedLines: string[];
  scrollTargetId: string;
}

interface AdjustmentBlockProps {
  adjustment: AdjustmentBlockData;
  defaultExpanded?: boolean;
  onScrollToChange?: (targetId: string) => void;
}

/**
 * AdjustmentBlock - LLMContextViewer-style collapsible diff viewer
 * 
 * Features:
 * - Matches LLMContextViewer header pattern (llm-context-header)
 * - Collapsible with chevron toggle
 * - +/- prefixed diff lines with color backgrounds
 * - Compact monospace content
 */
export const AdjustmentBlock: React.FC<AdjustmentBlockProps> = ({
  adjustment,
  defaultExpanded = true,
  onScrollToChange,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const { sectionName, linesAdded, linesRemoved, removedLines, addedLines, scrollTargetId } = adjustment;

  const handleToggle = () => {
    setIsExpanded(!isExpanded);
  };

  const handleHeaderClick = () => {
    if (onScrollToChange) {
      onScrollToChange(scrollTargetId);
    }
  };

  return (
    <div
      style={{
        border: '1px solid #E5E7EB',
        borderRadius: '8px',
        overflow: 'hidden',
        marginBottom: '8px',
        background: 'transparent',
      }}
    >
      {/* Header - matches .llm-context-header styling */}
      <div
        onClick={handleHeaderClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          background: 'transparent',
          borderBottom: isExpanded ? '1px solid #E5E7EB' : 'none',
          fontSize: '12px',
          color: '#374151',
          cursor: onScrollToChange ? 'pointer' : 'default',
        }}
      >
        <FileText style={{ 
          width: '14px', 
          height: '14px', 
          color: '#9CA3AF',
          flexShrink: 0,
        }} />
        <span style={{ 
          flex: 1,
          fontWeight: 500, 
          color: '#374151',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {sectionName}
        </span>
        
        {/* Stats */}
        <div style={{ 
          display: 'flex', 
          gap: '6px', 
          fontSize: '12px',
          fontWeight: 500,
          flexShrink: 0,
        }}>
          {linesAdded > 0 && (
            <span style={{ color: '#16A34A' }}>+{linesAdded}</span>
          )}
          {linesRemoved > 0 && (
            <span style={{ color: '#DC2626' }}>-{linesRemoved}</span>
          )}
        </div>
        
        {/* Expand/collapse toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleToggle();
          }}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px',
            color: '#9CA3AF',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Content - collapsible diff lines */}
      {isExpanded && (
        <div style={{ 
          fontFamily: "'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace",
          fontSize: '11px',
          lineHeight: 1.5,
          maxHeight: '200px',
          overflowY: 'auto',
        }}>
          {/* Removed lines - red background */}
          {removedLines.map((line, index) => (
            <div
              key={`removed-${index}`}
              style={{
                display: 'flex',
                backgroundColor: '#FEE2E2',
                minHeight: '18px',
              }}
            >
              <span
                style={{
                  width: '36px',
                  flexShrink: 0,
                  textAlign: 'center',
                  color: '#9CA3AF',
                  paddingRight: '8px',
                  userSelect: 'none',
                }}
              >
                -
              </span>
              <span
                style={{
                  flex: 1,
                  color: '#374151',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  paddingRight: '12px',
                }}
              >
                {line || ' '}
              </span>
            </div>
          ))}
          
          {/* Added lines - green background */}
          {addedLines.map((line, index) => (
            <div
              key={`added-${index}`}
              style={{
                display: 'flex',
                backgroundColor: '#DCFCE7',
                minHeight: '18px',
              }}
            >
              <span
                style={{
                  width: '36px',
                  flexShrink: 0,
                  textAlign: 'center',
                  color: '#9CA3AF',
                  paddingRight: '8px',
                  userSelect: 'none',
                }}
              >
                +
              </span>
              <span
                style={{
                  flex: 1,
                  color: '#374151',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  paddingRight: '12px',
                }}
              >
                {line || ' '}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdjustmentBlock;

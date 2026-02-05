import React, { useRef, useMemo, useEffect, useState } from 'react';
import { FileText, ChevronLeft, Check, X, Loader2, Undo2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { diffLines } from 'diff';
import { AdjustmentBlock, AdjustmentBlockData } from './AdjustmentBlock';
import { PLAN_STYLES } from './planStyles';

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  lineId?: string;
  lineNumber: number;
}

interface DiffResult {
  lines: DiffLine[];
  stats: { linesAdded: number; linesRemoved: number };
}

function computeLineDiff(oldPlan: string, newPlan: string): DiffResult {
  const changes = diffLines(oldPlan, newPlan);
  const lines: DiffLine[] = [];
  let linesAdded = 0;
  let linesRemoved = 0;
  let lineCounter = 0;
  let displayLineNum = 0;
  
  for (const change of changes) {
    const contentLines = change.value.split('\n');
    
    for (let i = 0; i < contentLines.length; i++) {
      const content = contentLines[i];
      if (content === '' && i === contentLines.length - 1 && contentLines.length > 1) {
        continue;
      }
      
      lineCounter++;
      displayLineNum++;
      const lineId = `diff-line-${lineCounter}`;
      
      if (change.added) {
        lines.push({ type: 'added', content, lineId, lineNumber: displayLineNum });
        linesAdded++;
      } else if (change.removed) {
        lines.push({ type: 'removed', content, lineId, lineNumber: displayLineNum });
        linesRemoved++;
      } else {
        lines.push({ type: 'unchanged', content, lineId, lineNumber: displayLineNum });
      }
    }
  }
  
  return { lines, stats: { linesAdded, linesRemoved } };
}

function extractAdjustments(lines: DiffLine[]): AdjustmentBlockData[] {
  const adjustments: AdjustmentBlockData[] = [];
  let currentSection = 'Changes';
  let adjustmentId = 0;
  
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type === 'unchanged' && lines[i].content.startsWith('##')) {
      currentSection = lines[i].content.replace(/^#+\s*/, '');
    }
    
    if (lines[i].type !== 'unchanged') {
      const removedLines: string[] = [];
      const addedLines: string[] = [];
      const startLineId = lines[i].lineId || '';
      
      while (i < lines.length && lines[i].type !== 'unchanged') {
        if (lines[i].type === 'removed') {
          removedLines.push(lines[i].content);
        } else if (lines[i].type === 'added') {
          addedLines.push(lines[i].content);
        }
        i++;
      }
      
      if (removedLines.length > 0 || addedLines.length > 0) {
        adjustmentId++;
        let sectionName = currentSection;
        
        if (removedLines.length > 0 && addedLines.length > 0) {
          sectionName = `Updated ${currentSection}`;
        } else if (addedLines.length > 0) {
          sectionName = `Added to ${currentSection}`;
        } else {
          sectionName = `Removed from ${currentSection}`;
        }
        
        adjustments.push({
          id: `adjustment-${adjustmentId}`,
          sectionName,
          linesAdded: addedLines.length,
          linesRemoved: removedLines.length,
          removedLines,
          addedLines,
          scrollTargetId: startLineId,
        });
      }
    } else {
      i++;
    }
  }
  
  return adjustments;
}

interface ExpandedPlanViewerProps {
  planContent: string;
  previousPlanContent?: string;
  isUpdateMode?: boolean;
  isStreaming?: boolean;
  onCollapse: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  onBuild?: () => void;
  buildStatus?: 'ready' | 'building' | 'built' | 'streaming';
  planName?: string;
  adjustmentQuery?: string;
  /** Called when user approves an added line or accepts a removed line staying removed */
  onLineApprove?: (lineId: string, lineContent: string, type: 'added' | 'removed') => void;
  /** Called when user undoes an added line (remove it) or undoes a removed line (restore it) */
  onLineUndo?: (lineId: string, lineContent: string, type: 'added' | 'removed') => void;
}

/**
 * ExpandedPlanViewer - Full plan display with Cursor-style diff view
 * 
 * Features:
 * - Line numbers in gutter
 * - +/- indicators for diff
 * - Compact tab-style header
 * - Icon-only action buttons with tooltips
 */
export const ExpandedPlanViewer: React.FC<ExpandedPlanViewerProps> = ({
  planContent,
  previousPlanContent,
  isUpdateMode = false,
  isStreaming = false,
  onCollapse,
  onAccept,
  onReject,
  onBuild,
  buildStatus = 'ready',
  planName = 'research_plan',
  adjustmentQuery,
  onLineApprove,
  onLineUndo,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [highlightedLineId, setHighlightedLineId] = useState<string | null>(null);
  const [hoveredLineId, setHoveredLineId] = useState<string | null>(null);
  
  const { diffLines: computedDiffLines, diffStats, adjustments } = useMemo(() => {
    if (isUpdateMode && previousPlanContent) {
      const result = computeLineDiff(previousPlanContent, planContent);
      const adjustments = extractAdjustments(result.lines);
      return { 
        diffLines: result.lines, 
        diffStats: result.stats,
        adjustments 
      };
    }
    return { diffLines: [], diffStats: { linesAdded: 0, linesRemoved: 0 }, adjustments: [] };
  }, [planContent, previousPlanContent, isUpdateMode]);

  const scrollToLine = (lineId: string) => {
    const element = document.getElementById(lineId);
    if (element && contentRef.current) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedLineId(lineId);
      
      setTimeout(() => {
        setHighlightedLineId(null);
      }, 2000);
    }
  };

  useEffect(() => {
    if (contentRef.current && isStreaming) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [planContent, isStreaming]);

  // Only show diff view when we have meaningful new content to compare
  // During streaming, don't show everything as "removed" until new content arrives
  const hasSubstantialNewContent = planContent.length > 100 || !isStreaming;
  const showDiffView = isUpdateMode && previousPlanContent && computedDiffLines.length > 0 && hasSubstantialNewContent;

  // Keyboard shortcut: ⌘↵ (Cmd/Ctrl + Enter) to approve changes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!showDiffView || isStreaming || !onAccept) return;
      const isMod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const isEditable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable || (target.closest && target.closest('[contenteditable="true"]'));
      if (isEditable) return;
      if (isMod && e.key === 'Enter') {
        e.preventDefault();
        onAccept();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showDiffView, isStreaming, onAccept]);

  // Get line background and gutter colors
  const getLineStyles = (line: DiffLine) => {
    const isHighlighted = highlightedLineId === line.lineId;
    
    if (isHighlighted) {
      return {
        bg: '#FEF3C7',
        gutterBg: '#FDE68A',
        gutterText: PLAN_STYLES.colors.amber,
      };
    }
    
    switch (line.type) {
      case 'added':
        return {
          bg: PLAN_STYLES.colors.added,
          gutterBg: PLAN_STYLES.colors.addedBorder,
          gutterText: PLAN_STYLES.colors.addedGutter,
        };
      case 'removed':
        return {
          bg: PLAN_STYLES.colors.removed,
          gutterBg: PLAN_STYLES.colors.removedBorder,
          gutterText: PLAN_STYLES.colors.removedGutter,
        };
      default:
        return {
          bg: 'transparent',
          gutterBg: 'transparent',
          gutterText: PLAN_STYLES.colors.textSubtle,
        };
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#FFFFFF',
        borderRadius: '10px',
        border: '1px solid rgba(0, 0, 0, 0.08)',
        boxShadow: '0 2px 12px rgba(0, 0, 0, 0.06)',
        overflow: 'hidden',
        transition: 'border-color 0.1s ease, box-shadow 0.1s ease',
      }}
    >
      {/* Header Bar - Compact tab style (Cursor-inspired minimal design) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          backgroundColor: PLAN_STYLES.colors.bgHover,
          borderBottom: `1px solid ${PLAN_STYLES.colors.border}`,
          borderTopLeftRadius: '10px',
          borderTopRightRadius: '10px',
          minHeight: '36px',
          flexShrink: 0,
        }}
      >
        {/* Left: Collapse + filename */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={onCollapse}
            title="Collapse panel"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '18px',
              height: '18px',
              borderRadius: '3px',
              border: 'none',
              backgroundColor: 'transparent',
              cursor: 'pointer',
              color: PLAN_STYLES.colors.textSubtle,
              transition: PLAN_STYLES.transitions.fast,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.05)';
              e.currentTarget.style.color = PLAN_STYLES.colors.textMuted;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = PLAN_STYLES.colors.textSubtle;
            }}
          >
            <ChevronLeft style={{ width: '14px', height: '14px' }} />
          </button>
          
          <FileText style={{ width: '13px', height: '13px', color: PLAN_STYLES.colors.textSubtle, marginLeft: '2px' }} />
          <span style={{ 
            fontSize: '12px', 
            color: PLAN_STYLES.colors.textMuted, 
            fontWeight: 500,
            letterSpacing: '-0.01em',
          }}>
            {planName}.plan.md
          </span>
          
          {/* Diff stats badge - more subtle */}
          {showDiffView && (
            <div style={{ 
              display: 'flex', 
              gap: '4px', 
              marginLeft: '6px', 
              fontSize: '10px', 
              fontWeight: 500,
              fontFamily: PLAN_STYLES.fonts.mono,
              opacity: 0.8,
            }}>
              <span style={{ color: PLAN_STYLES.colors.addedText }}>+{diffStats.linesAdded}</span>
              <span style={{ color: PLAN_STYLES.colors.removedText }}>-{diffStats.linesRemoved}</span>
            </div>
          )}
        </div>
        
        {/* Right: Action buttons - Cursor-style minimal, compact */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {showDiffView ? (
            <>
              {/* Undo File - text-style button, minimal */}
              <button
                onClick={onReject}
                disabled={isStreaming}
                title="Undo changes"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: 500,
                  fontFamily: PLAN_STYLES.fonts.ui,
                  cursor: isStreaming ? 'default' : 'pointer',
                  backgroundColor: 'transparent',
                  color: '#6B7280',
                  opacity: isStreaming ? 0.5 : 1,
                  transition: PLAN_STYLES.transitions.fast,
                }}
                onMouseEnter={(e) => {
                  if (!isStreaming) {
                    e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.05)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                Undo File
              </button>
              
              {/* Keep File - subtle primary action with shortcut */}
              <button
                onClick={onAccept}
                disabled={isStreaming}
                title="Keep changes (⌘↵)"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '2px 8px',
                  borderRadius: '3px',
                  border: `1px solid rgba(34, 197, 94, 0.3)`,
                  fontSize: '11px',
                  fontWeight: 500,
                  fontFamily: PLAN_STYLES.fonts.ui,
                  cursor: isStreaming ? 'default' : 'pointer',
                  backgroundColor: 'rgba(34, 197, 94, 0.08)',
                  color: '#15803d',
                  opacity: isStreaming ? 0.5 : 1,
                  transition: PLAN_STYLES.transitions.fast,
                }}
                onMouseEnter={(e) => {
                  if (!isStreaming) {
                    e.currentTarget.style.backgroundColor = 'rgba(34, 197, 94, 0.15)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(34, 197, 94, 0.08)';
                }}
              >
                Keep File
                <span style={{ 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: '0px', 
                  opacity: 0.7,
                  fontSize: '10px',
                  marginLeft: '2px',
                }}>
                  ⌘↵
                </span>
              </button>
            </>
          ) : (
            onBuild && (
              <button
                onClick={onBuild}
                disabled={buildStatus !== 'ready'}
                title={buildStatus === 'ready' ? 'Execute plan (⌘↵)' : buildStatus}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '3px 10px',
                  borderRadius: PLAN_STYLES.radii.sm,
                  border: 'none',
                  fontSize: PLAN_STYLES.sizes.fontSm,
                  fontWeight: 500,
                  cursor: buildStatus !== 'ready' ? 'default' : 'pointer',
                  backgroundColor: buildStatus === 'built' 
                    ? PLAN_STYLES.colors.green 
                    : buildStatus === 'ready' 
                    ? '#F2DEB7' 
                    : PLAN_STYLES.colors.bgMuted,
                  color: buildStatus === 'ready' 
                    ? '#5C4A2A' 
                    : buildStatus === 'built' 
                    ? '#FFFFFF' 
                    : PLAN_STYLES.colors.textMuted,
                  opacity: buildStatus !== 'ready' && buildStatus !== 'built' ? 0.6 : 1,
                  transition: PLAN_STYLES.transitions.fast,
                }}
              >
                {buildStatus === 'building' && (
                  <Loader2 style={{ width: '12px', height: '12px', animation: 'spin 1s linear infinite' }} />
                )}
                {buildStatus === 'built' && <Check style={{ width: '12px', height: '12px' }} />}
                <span>{buildStatus === 'ready' ? 'Execute' : buildStatus === 'building' ? 'Building...' : 'Built'}</span>
                {buildStatus === 'ready' && (
                  <span style={{ marginLeft: '4px' }}>⌘<span style={{ position: 'relative', top: '2px' }}>↵</span></span>
                )}
              </button>
            )
          )}
        </div>
      </div>
      
      {/* Content Area - generous padding for readability */}
      <div
        ref={contentRef}
        className="expanded-plan-content-area"
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          backgroundColor: '#FFFFFF',
        }}
      >
        {/* Diff View with line numbers and gutter - Cursor-style with ample padding */}
        {showDiffView ? (
          <div style={{ 
            fontFamily: PLAN_STYLES.fonts.mono, 
            fontSize: '12px', 
            padding: '20px 0',
            lineHeight: '1.6',
          }}>
            {computedDiffLines.map((line, index) => {
              const styles = getLineStyles(line);
              const gutterSymbol = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
              const isChanged = line.type === 'added' || line.type === 'removed';
              const showLineButtons = isChanged && (onLineApprove || onLineUndo) && hoveredLineId === line.lineId && !isStreaming;
              
              return (
                <div
                  key={index}
                  id={line.lineId}
                  onMouseEnter={() => isChanged && (onLineApprove || onLineUndo) && setHoveredLineId(line.lineId ?? null)}
                  onMouseLeave={() => setHoveredLineId(null)}
                  style={{
                    display: 'flex',
                    minHeight: '22px',
                    backgroundColor: styles.bg,
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  {/* Line number - wider gutter for breathing room */}
                  <div
                    style={{
                      width: '52px',
                      flexShrink: 0,
                      textAlign: 'right',
                      paddingRight: '12px',
                      color: PLAN_STYLES.colors.textSubtle,
                      fontSize: '11px',
                      lineHeight: '22px',
                      userSelect: 'none',
                      backgroundColor: styles.gutterBg,
                      opacity: line.type === 'unchanged' ? 0.6 : 0.9,
                    }}
                  >
                    {line.lineNumber}
                  </div>
                  
                  {/* Gutter indicator - +/- symbol */}
                  <div
                    style={{
                      width: '20px',
                      flexShrink: 0,
                      textAlign: 'center',
                      color: styles.gutterText,
                      fontSize: '12px',
                      lineHeight: '22px',
                      fontWeight: 600,
                      userSelect: 'none',
                      backgroundColor: styles.gutterBg,
                    }}
                  >
                    {gutterSymbol}
                  </div>
                  
                  {/* Content + per-line action buttons - generous horizontal padding */}
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        paddingLeft: '20px',
                        paddingRight: showLineButtons ? '12px' : '32px',
                        lineHeight: '22px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        color: line.type === 'removed' 
                          ? PLAN_STYLES.colors.removedText 
                          : line.type === 'added'
                          ? PLAN_STYLES.colors.addedText
                          : PLAN_STYLES.colors.textSecondary,
                        letterSpacing: '-0.01em',
                      }}
                    >
                      {line.content || '\u00A0'}
                    </div>
                    {showLineButtons && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0, marginRight: '8px' }}>
                        {line.type === 'removed' && onLineUndo && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onLineUndo(line.lineId!, line.content, 'removed');
                            }}
                            title="Undo (restore this line)"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '18px',
                              height: '18px',
                              borderRadius: '3px',
                              border: 'none',
                              backgroundColor: 'rgba(0,0,0,0.06)',
                              color: PLAN_STYLES.colors.textMuted,
                              cursor: 'pointer',
                              transition: PLAN_STYLES.transitions.fast,
                            }}
                          >
                            <Undo2 style={{ width: '11px', height: '11px' }} />
                          </button>
                        )}
                        {line.type === 'added' && onLineApprove && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onLineApprove(line.lineId!, line.content, 'added');
                            }}
                            title="Approve this line"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '18px',
                              height: '18px',
                              borderRadius: '3px',
                              border: 'none',
                              backgroundColor: 'rgba(34, 197, 94, 0.15)',
                              color: '#15803d',
                              cursor: 'pointer',
                              transition: PLAN_STYLES.transitions.fast,
                            }}
                          >
                            <Check style={{ width: '11px', height: '11px' }} />
                          </button>
                        )}
                        {line.type === 'added' && onLineUndo && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onLineUndo(line.lineId!, line.content, 'added');
                            }}
                            title="Undo (remove this line)"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '18px',
                              height: '18px',
                              borderRadius: '3px',
                              border: 'none',
                              backgroundColor: 'rgba(0,0,0,0.06)',
                              color: PLAN_STYLES.colors.textMuted,
                              cursor: 'pointer',
                              transition: PLAN_STYLES.transitions.fast,
                            }}
                          >
                            <Undo2 style={{ width: '11px', height: '11px' }} />
                          </button>
                        )}
                        {line.type === 'removed' && onLineApprove && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onLineApprove(line.lineId!, line.content, 'removed');
                            }}
                            title="Approve (keep removed)"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '18px',
                              height: '18px',
                              borderRadius: '3px',
                              border: 'none',
                              backgroundColor: 'rgba(34, 197, 94, 0.15)',
                              color: '#15803d',
                              cursor: 'pointer',
                              transition: PLAN_STYLES.transitions.fast,
                            }}
                          >
                            <Check style={{ width: '11px', height: '11px' }} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Normal markdown view - generous padding for readability */
          <div style={{ padding: '24px 32px' }} className="expanded-plan-markdown-content">
            <ReactMarkdown
              components={{
                h1: ({ children }) => (
                  <h1 style={{ 
                    fontSize: '18px', 
                    fontWeight: 600, 
                    color: PLAN_STYLES.colors.text,
                    marginBottom: '10px',
                    marginTop: '0',
                    fontFamily: PLAN_STYLES.fonts.ui,
                  }}>
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 style={{ 
                    fontSize: '15px', 
                    fontWeight: 600, 
                    color: PLAN_STYLES.colors.textSecondary,
                    marginBottom: '8px',
                    marginTop: '18px',
                    fontFamily: PLAN_STYLES.fonts.ui,
                  }}>
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 style={{ 
                    fontSize: PLAN_STYLES.sizes.fontMd, 
                    fontWeight: 600, 
                    color: PLAN_STYLES.colors.textSecondary,
                    marginBottom: '6px',
                    marginTop: '14px',
                    fontFamily: PLAN_STYLES.fonts.ui,
                  }}>
                    {children}
                  </h3>
                ),
                p: ({ children }) => (
                  <p style={{ 
                    fontSize: PLAN_STYLES.sizes.fontMd, 
                    color: PLAN_STYLES.colors.textMuted,
                    lineHeight: 1.6,
                    marginBottom: '8px',
                    fontFamily: PLAN_STYLES.fonts.ui,
                  }}>
                    {children}
                  </p>
                ),
                ul: ({ children }) => (
                  <ul style={{ 
                    fontSize: PLAN_STYLES.sizes.fontMd, 
                    color: PLAN_STYLES.colors.textMuted,
                    lineHeight: 1.6,
                    marginBottom: '8px',
                    paddingLeft: '20px',
                    fontFamily: PLAN_STYLES.fonts.ui,
                  }}>
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol style={{ 
                    fontSize: PLAN_STYLES.sizes.fontMd, 
                    color: PLAN_STYLES.colors.textMuted,
                    lineHeight: 1.6,
                    marginBottom: '8px',
                    paddingLeft: '20px',
                    fontFamily: PLAN_STYLES.fonts.ui,
                  }}>
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li style={{ marginBottom: '4px' }}>
                    {children}
                  </li>
                ),
                code: ({ children, className }) => {
                  const isInline = !className;
                  if (isInline) {
                    return (
                      <code style={{
                        backgroundColor: PLAN_STYLES.colors.bgMuted,
                        padding: '1px 4px',
                        borderRadius: '3px',
                        fontSize: PLAN_STYLES.sizes.fontSm,
                        fontFamily: PLAN_STYLES.fonts.mono,
                        color: PLAN_STYLES.colors.removedText,
                      }}>
                        {children}
                      </code>
                    );
                  }
                  return (
                    <code style={{
                      display: 'block',
                      backgroundColor: PLAN_STYLES.colors.bgMuted,
                      padding: '12px',
                      borderRadius: PLAN_STYLES.radii.sm,
                      fontSize: PLAN_STYLES.sizes.fontSm,
                      fontFamily: PLAN_STYLES.fonts.mono,
                      overflowX: 'auto',
                      marginBottom: '8px',
                    }}>
                      {children}
                    </code>
                  );
                },
                strong: ({ children }) => (
                  <strong style={{ fontWeight: 600, color: PLAN_STYLES.colors.text }}>
                    {children}
                  </strong>
                ),
              }}
            >
              {/* Show previous content during early streaming, then current content */}
              {isStreaming && planContent.length < 100 && previousPlanContent ? previousPlanContent : planContent}
            </ReactMarkdown>
          </div>
        )}
        
      </div>
      
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        .expanded-plan-markdown-content > *:first-child {
          margin-top: 0;
        }
        
        .expanded-plan-markdown-content > *:last-child {
          margin-bottom: 0;
        }
        
        /* Hide scrollbar while keeping scroll functionality */
        .expanded-plan-content-area {
          scrollbar-width: none; /* Firefox */
          -ms-overflow-style: none; /* IE and Edge */
        }
        
        .expanded-plan-content-area::-webkit-scrollbar {
          display: none; /* Chrome, Safari, Opera */
        }
      `}</style>
    </div>
  );
};

export default ExpandedPlanViewer;

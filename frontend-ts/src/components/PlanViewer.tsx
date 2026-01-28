import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FileText, Check, Loader2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ModelSelector } from './ModelSelector';
import { PLAN_STYLES } from './planStyles';

// Re-export types for external use
export type { AdjustmentBlockData } from './AdjustmentBlock';
export type { ReasoningStep } from './PlanReasoningSteps';

export type PlanBuildStatus = 'streaming' | 'ready' | 'building' | 'built' | 'error';

interface PlanViewerProps {
  planContent: string;
  isStreaming: boolean;
  onBuild: () => void;
  onCancel?: () => void;
  onViewPlan?: () => void;  // Opens/closes expanded plan panel
  buildStatus: PlanBuildStatus;
  planName?: string;
  errorMessage?: string;
  isPlanExpanded?: boolean;  // Whether the expanded plan panel is currently open
}

/**
 * PlanViewer - Cursor-style document viewer for streaming research plans
 * 
 * Displays the LLM's research plan with:
 * - Tab-style header with filename
 * - Streaming markdown content with typing animation
 * - Build button to execute the plan
 * - Status states: streaming, ready, building, built
 */
export const PlanViewer: React.FC<PlanViewerProps> = ({
  planContent,
  isStreaming,
  onBuild,
  onCancel,
  onViewPlan,
  buildStatus,
  planName = 'research_plan',
  errorMessage,
  isPlanExpanded = false,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [displayedContent, setDisplayedContent] = useState('');
  const [showCursor, setShowCursor] = useState(true);
  
  // Typing animation effect
  useEffect(() => {
    setDisplayedContent(planContent);
  }, [planContent, isStreaming]);
  
  // Blinking cursor animation
  useEffect(() => {
    if (!isStreaming) {
      setShowCursor(false);
      return;
    }
    
    const interval = setInterval(() => {
      setShowCursor(prev => !prev);
    }, 530);
    
    return () => clearInterval(interval);
  }, [isStreaming]);
  
  // Auto-scroll to bottom during streaming
  useEffect(() => {
    if (contentRef.current && isStreaming) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [displayedContent, isStreaming]);
  
  // Derive button state
  const buttonLabel = useMemo(() => {
    switch (buildStatus) {
      case 'streaming':
        return 'Planning...';
      case 'ready':
        return 'Execute';
      case 'building':
        return 'Building...';
      case 'built':
        return 'Built';
      case 'error':
        return 'Retry';
      default:
        return 'Execute';
    }
  }, [buildStatus]);
  
  // Handle keyboard shortcut (Cmd+Enter to build)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && buildStatus === 'ready') {
        e.preventDefault();
        onBuild();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [buildStatus, onBuild]);

  // Button colors based on status
  const getButtonStyles = () => {
    const base = {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '3px 10px',
      borderRadius: PLAN_STYLES.radii.sm,
      fontSize: PLAN_STYLES.sizes.fontSm,
      fontWeight: 500,
      cursor: 'pointer',
      transition: PLAN_STYLES.transitions.fast,
    };

    switch (buildStatus) {
      case 'ready':
        return {
          ...base,
          backgroundColor: '#F2DEB7',
          border: 'none',
          color: '#5C4A2A',
        };
      case 'streaming':
      case 'building':
        return {
          ...base,
          backgroundColor: PLAN_STYLES.colors.bgMuted,
          border: `1px solid ${PLAN_STYLES.colors.border}`,
          color: PLAN_STYLES.colors.textMuted,
          cursor: 'default',
        };
      case 'built':
        return {
          ...base,
          backgroundColor: PLAN_STYLES.colors.green,
          border: 'none',
          color: '#FFFFFF',
        };
      case 'error':
        return {
          ...base,
          backgroundColor: PLAN_STYLES.colors.error,
          border: 'none',
          color: '#FFFFFF',
        };
      default:
        return base;
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: PLAN_STYLES.colors.bg,
        borderRadius: PLAN_STYLES.radii.lg,
        border: `1px solid ${PLAN_STYLES.colors.border}`,
        overflow: 'hidden',
        maxHeight: '520px',
        boxShadow: PLAN_STYLES.shadows.sm,
      }}
    >
      {/* Header Bar - Tab style */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          backgroundColor: '#FAFAFA',
          borderBottom: `1px solid ${PLAN_STYLES.colors.border}`,
          minHeight: '36px',
        }}
      >
        {/* Left: Close button + file icon + filename */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {onCancel && (
            <button
              onClick={onCancel}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '18px',
                height: '18px',
                borderRadius: PLAN_STYLES.radii.sm,
                border: 'none',
                backgroundColor: 'transparent',
                cursor: 'pointer',
                color: PLAN_STYLES.colors.textSubtle,
                transition: PLAN_STYLES.transitions.fast,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = PLAN_STYLES.colors.bgMuted;
                e.currentTarget.style.color = PLAN_STYLES.colors.textMuted;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = PLAN_STYLES.colors.textSubtle;
              }}
            >
              <X style={{ width: '12px', height: '12px' }} />
            </button>
          )}
          <FileText style={{ width: '14px', height: '14px', color: PLAN_STYLES.colors.textMuted }} />
          <span style={{ 
            fontSize: PLAN_STYLES.sizes.fontBase, 
            color: PLAN_STYLES.colors.textSecondary, 
            fontWeight: 500,
            fontFamily: PLAN_STYLES.fonts.ui,
          }}>
            {planName}.plan.md
          </span>
        </div>
        
        {/* Right: Model selector + Build button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ModelSelector />
          
          {/* Build Button */}
          <button
            onClick={buildStatus === 'ready' || buildStatus === 'error' ? onBuild : undefined}
            disabled={buildStatus !== 'ready' && buildStatus !== 'error'}
            style={getButtonStyles() as React.CSSProperties}
          >
            {(buildStatus === 'streaming' || buildStatus === 'building') && (
              <Loader2 style={{ width: '12px', height: '12px', animation: 'spin 1s linear infinite' }} />
            )}
            {buildStatus === 'built' && (
              <Check style={{ width: '12px', height: '12px' }} />
            )}
            <span>{buttonLabel}</span>
            {buildStatus === 'ready' && (
              <span style={{ marginLeft: '4px' }}>
                ⌘<span style={{ position: 'relative', top: '2px' }}>↵</span>
              </span>
            )}
          </button>
        </div>
      </div>
      
      {/* Content Area - Editor style */}
      <div
        ref={contentRef}
        style={{
          flex: 1,
          padding: '16px 24px',
          overflowY: 'auto',
          backgroundColor: '#FFFFFF',
          minHeight: '180px',
          maxHeight: '360px',
        }}
      >
        {displayedContent ? (
          <div style={{ position: 'relative' }}>
            <div className="plan-markdown-content">
              <ReactMarkdown
                components={{
                  h1: ({ children }) => (
                    <h1 style={{ 
                      fontSize: PLAN_STYLES.sizes.fontLg, 
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
                      fontSize: PLAN_STYLES.sizes.fontMd, 
                      fontWeight: 600, 
                      color: PLAN_STYLES.colors.textSecondary,
                      marginBottom: '6px',
                      marginTop: '14px',
                      fontFamily: PLAN_STYLES.fonts.ui,
                    }}>
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 style={{ 
                      fontSize: PLAN_STYLES.sizes.fontBase, 
                      fontWeight: 600, 
                      color: PLAN_STYLES.colors.textSecondary,
                      marginBottom: '4px',
                      marginTop: '10px',
                      fontFamily: PLAN_STYLES.fonts.ui,
                    }}>
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => (
                    <p style={{ 
                      fontSize: PLAN_STYLES.sizes.fontBase, 
                      color: PLAN_STYLES.colors.textMuted,
                      lineHeight: 1.55,
                      marginBottom: '6px',
                      fontFamily: PLAN_STYLES.fonts.ui,
                    }}>
                      {children}
                    </p>
                  ),
                  ul: ({ children }) => (
                    <ul style={{ 
                      fontSize: PLAN_STYLES.sizes.fontBase, 
                      color: PLAN_STYLES.colors.textMuted,
                      lineHeight: 1.55,
                      marginBottom: '6px',
                      paddingLeft: '18px',
                      fontFamily: PLAN_STYLES.fonts.ui,
                    }}>
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol style={{ 
                      fontSize: PLAN_STYLES.sizes.fontBase, 
                      color: PLAN_STYLES.colors.textMuted,
                      lineHeight: 1.55,
                      marginBottom: '6px',
                      paddingLeft: '18px',
                      fontFamily: PLAN_STYLES.fonts.ui,
                    }}>
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => (
                    <li style={{ marginBottom: '3px' }}>
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
                        padding: '10px',
                        borderRadius: PLAN_STYLES.radii.sm,
                        fontSize: PLAN_STYLES.sizes.fontSm,
                        fontFamily: PLAN_STYLES.fonts.mono,
                        overflowX: 'auto',
                        marginBottom: '6px',
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
                {displayedContent}
              </ReactMarkdown>
            </div>
            
            {/* Thin blinking cursor during streaming */}
            {isStreaming && showCursor && (
              <span
                style={{
                  display: 'inline-block',
                  width: '1.5px',
                  height: '14px',
                  backgroundColor: PLAN_STYLES.colors.accent,
                  marginLeft: '1px',
                  verticalAlign: 'text-bottom',
                  animation: 'blink 1s step-end infinite',
                }}
              />
            )}
          </div>
        ) : (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            height: '100%',
            minHeight: '120px',
            color: PLAN_STYLES.colors.textSubtle,
            fontSize: PLAN_STYLES.sizes.fontBase,
          }}>
            {isStreaming ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Loader2 style={{ width: '14px', height: '14px', animation: 'spin 1s linear infinite' }} />
                <span>Generating plan...</span>
              </div>
            ) : (
              <span>No plan content</span>
            )}
          </div>
        )}
        
        {/* Error message */}
        {buildStatus === 'error' && errorMessage && (
          <div style={{
            marginTop: '10px',
            padding: '10px',
            backgroundColor: PLAN_STYLES.colors.removed,
            borderRadius: PLAN_STYLES.radii.sm,
            border: `1px solid ${PLAN_STYLES.colors.removedBorder}`,
            color: PLAN_STYLES.colors.removedText,
            fontSize: PLAN_STYLES.sizes.fontSm,
          }}>
            {errorMessage}
          </div>
        )}
        
      </div>
      
      {/* View Plan footer - always visible at bottom */}
      {onViewPlan && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 16px',
            borderTop: `1px solid ${PLAN_STYLES.colors.border}`,
            backgroundColor: '#FFFFFF',
          }}
        >
          <button
            onClick={onViewPlan}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              margin: 0,
              fontSize: PLAN_STYLES.sizes.fontSm,
              color: PLAN_STYLES.colors.textMuted,
              cursor: 'pointer',
              fontWeight: 400,
              textDecoration: 'none',
              transition: PLAN_STYLES.transitions.fast,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = PLAN_STYLES.colors.textSecondary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = PLAN_STYLES.colors.textMuted;
            }}
          >
            {isPlanExpanded ? 'Close Plan' : 'View Plan'}
          </button>
          
          {buildStatus === 'built' && (
            <span style={{ 
              fontSize: PLAN_STYLES.sizes.fontSm, 
              color: PLAN_STYLES.colors.green, 
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
            }}>
              <Check style={{ width: '12px', height: '12px' }} />
              Built
            </span>
          )}
        </div>
      )}
      
      {/* CSS animations */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        @keyframes blink {
          50% { opacity: 0; }
        }
        
        .plan-markdown-content > *:first-child {
          margin-top: 0;
        }
        
        .plan-markdown-content > *:last-child {
          margin-bottom: 0;
        }
      `}</style>
    </div>
  );
};

export default PlanViewer;

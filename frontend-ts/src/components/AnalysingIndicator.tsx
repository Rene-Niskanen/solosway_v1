/**
 * AnalysingIndicator Component
 * 
 * Shows "thinking..." while the LLM is processing.
 * - Appears before planning/reasoning steps
 * - Disappears when reasoning steps appear
 * - Reappears when reasoning steps complete (before answer)
 * - Disappears when answer text starts streaming
 */

import React, { useState, useEffect, useRef } from 'react';

interface AnalysingIndicatorProps {
  isLoading: boolean;
  hasExecutionEvents: boolean;
  hasText: boolean;
  executionEventsCount?: number; // Track event count to detect when events stabilize
}

export const AnalysingIndicator: React.FC<AnalysingIndicatorProps> = ({
  isLoading,
  hasExecutionEvents,
  hasText,
  executionEventsCount = 0
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [eventsStable, setEventsStable] = useState(false);
  const lastEventCountRef = useRef(0);
  const stableTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Reset when loading starts (new query)
  useEffect(() => {
    if (isLoading && !hasExecutionEvents && !hasText) {
      // New query starting - reset tracking
      setEventsStable(false);
      lastEventCountRef.current = 0;
      if (stableTimeoutRef.current) {
        clearTimeout(stableTimeoutRef.current);
        stableTimeoutRef.current = null;
      }
    }
  }, [isLoading, hasExecutionEvents, hasText]);

  // Track when events stabilize (no new events for 500ms)
  useEffect(() => {
    if (!isLoading || hasText) {
      setEventsStable(false);
      if (stableTimeoutRef.current) {
        clearTimeout(stableTimeoutRef.current);
        stableTimeoutRef.current = null;
      }
      return;
    }

    if (hasExecutionEvents && executionEventsCount > lastEventCountRef.current) {
      // New events arrived - events are not stable
      setEventsStable(false);
      lastEventCountRef.current = executionEventsCount;
      
      // Clear existing timeout
      if (stableTimeoutRef.current) {
        clearTimeout(stableTimeoutRef.current);
      }
      
      // Set new timeout to mark events as stable after 500ms of no new events
      stableTimeoutRef.current = setTimeout(() => {
        setEventsStable(true);
      }, 500);
    } else if (hasExecutionEvents && executionEventsCount === lastEventCountRef.current && executionEventsCount > 0) {
      // Events haven't changed - check if they're stable
      if (!stableTimeoutRef.current) {
        stableTimeoutRef.current = setTimeout(() => {
          setEventsStable(true);
        }, 500);
      }
    } else if (!hasExecutionEvents) {
      // No events yet - not stable (still waiting for first events)
      setEventsStable(false);
    }

    return () => {
      if (stableTimeoutRef.current) {
        clearTimeout(stableTimeoutRef.current);
      }
    };
  }, [isLoading, hasExecutionEvents, hasText, executionEventsCount]);

  // Show "Analysing..." when:
  // 1. Loading and no text yet (final answer hasn't started)
  // IMPORTANT: Only hide when final answer text starts streaming
  const shouldShow = isLoading && !hasText;

  if (!shouldShow) {
    return null;
  }

  return (
    <div
      style={{
        marginBottom: '8px',
        fontSize: '12px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span 
            className="analysing-shimmer"
            style={{ 
              color: '#666',
              fontSize: '12px'
            }}
          >
            Analysing...
          </span>
        </div>
        <span style={{ 
          fontSize: '11px', 
          color: '#888',
          marginLeft: '8px'
        }}>
          {isExpanded ? '▼' : '▶'}
        </span>
      </div>
      
      {isExpanded && (
        <div style={{ 
          marginTop: '8px', 
          paddingTop: '8px',
          borderTop: '1px solid #e9ecef',
          color: '#666',
          fontSize: '11px',
          fontStyle: 'italic'
        }}>
          Planning next moves...
        </div>
      )}
      
      <style>{`
        @keyframes analysing-shimmer {
          0% { 
            opacity: 0.6;
          }
          50% { 
            opacity: 1;
          }
          100% { 
            opacity: 0.6;
          }
        }
        
        .analysing-shimmer {
          animation: analysing-shimmer 1.4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};


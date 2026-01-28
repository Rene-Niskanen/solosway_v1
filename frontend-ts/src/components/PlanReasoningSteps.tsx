import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';

export interface ReasoningStep {
  icon: 'planning' | 'applying' | 'complete' | 'loading';
  message: string;
  detail?: string;
  isActive?: boolean;
}

interface PlanReasoningStepsProps {
  steps: ReasoningStep[];
  isAnimating?: boolean;
}

/**
 * PlanReasoningSteps - Cursor-style reasoning steps display
 * 
 * Matches ReasoningSteps.tsx shimmer styling:
 * - No header or border
 * - Inline spinner for active states
 * - planning-shimmer-full CSS for flowing gradient text
 * - Compact 2px gap between steps
 */
export const PlanReasoningSteps: React.FC<PlanReasoningStepsProps> = ({
  steps,
  isAnimating = false,
}) => {
  const [visibleSteps, setVisibleSteps] = useState<number>(0);

  useEffect(() => {
    if (isAnimating && steps.length > 0) {
      setVisibleSteps(1);
      
      const timers: NodeJS.Timeout[] = [];
      
      for (let i = 1; i < steps.length; i++) {
        const timer = setTimeout(() => {
          setVisibleSteps(i + 1);
        }, i * 350);
        timers.push(timer);
      }
      
      return () => {
        timers.forEach(clearTimeout);
      };
    } else {
      setVisibleSteps(steps.length);
    }
  }, [steps, isAnimating]);

  if (steps.length === 0) return null;

  return (
    <div
      style={{
        padding: '6px 10px',
        paddingLeft: '0',
        marginLeft: '4px',
        marginTop: '8px',
      }}
    >
      {/* Steps with compact 2px gap - no header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {steps.slice(0, visibleSteps).map((step, index) => {
          const isLastVisible = index === visibleSteps - 1;
          
          // Determine completion state first - complete icon overrides everything
          const isComplete = step.icon === 'complete';
          // Only show spinner if NOT complete AND (isActive OR planning+animating+lastVisible)
          const showSpinner = !isComplete && (step.isActive || (step.icon === 'planning' && isAnimating && isLastVisible));
          
          return (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '6px',
                fontSize: '12px',
                padding: '2px 0',
                lineHeight: 1.4,
                opacity: isLastVisible && isAnimating ? 0 : 1,
                transform: isLastVisible && isAnimating ? 'translateY(2px)' : 'translateY(0)',
                animation: isLastVisible && isAnimating ? 'fadeSlideIn 0.15s ease forwards' : 'none',
              }}
            >
              {/* Icon: spinner when active (but not complete), check when complete */}
              {showSpinner ? (
                <div 
                  className="reasoning-loading-spinner"
                  style={{
                    width: '10px',
                    height: '10px',
                    border: '1.5px solid #D1D5DB',
                    borderTop: '1.5px solid #4B5563',
                    borderRadius: '50%',
                    flexShrink: 0,
                    marginTop: '3px',
                    boxSizing: 'border-box',
                  }}
                />
              ) : isComplete ? (
                <Check style={{ 
                  width: '14px', 
                  height: '14px', 
                  color: '#9CA3AF', 
                  flexShrink: 0,
                  marginTop: '1px',
                }} />
              ) : (
                <div 
                  style={{
                    width: '10px',
                    height: '10px',
                    border: '1.5px solid #D1D5DB',
                    borderRadius: '50%',
                    flexShrink: 0,
                    marginTop: '3px',
                    boxSizing: 'border-box',
                  }}
                />
              )}
              
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Message with shimmer when active (but not complete) */}
                {showSpinner ? (
                  <span className="planning-shimmer-full">{step.message}</span>
                ) : (
                  <span style={{ color: '#9CA3AF', fontWeight: 500 }}>{step.message}</span>
                )}
                
                {/* Detail text */}
                {step.detail && (
                  <div
                    style={{
                      fontSize: '11px',
                      color: '#6B7280',
                      marginTop: '2px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {step.detail}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      
      {/* CSS for shimmer animations - matching ReasoningSteps.tsx */}
      <style>{`
        @keyframes fadeSlideIn {
          from {
            opacity: 0;
            transform: translateY(2px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        .reasoning-loading-spinner {
          animation: spin 0.5s linear infinite;
        }
        
        .planning-shimmer-full {
          background: linear-gradient(90deg, #6B7280 0%, #9CA3AF 25%, #D1D5DB 50%, #9CA3AF 75%, #6B7280 100%);
          background-size: 300% 100%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer-full 0.8s ease-in-out infinite;
          font-weight: 500;
        }
        
        @keyframes shimmer-full {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>
    </div>
  );
};

export default PlanReasoningSteps;

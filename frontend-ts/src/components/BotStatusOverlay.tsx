import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface BotStatusOverlayProps {
  isActive: boolean;
  activityMessage: string;
  isPaused: boolean;
  onPauseToggle: () => void;
}

// Animated Eye Icon with sparkles - orange theme
const AnimatedEyeIcon: React.FC<{ isPaused: boolean }> = ({ isPaused }) => {
  return (
    <div style={{ position: 'relative', width: '14px', height: '14px' }}>
      <style>
        {`
          @keyframes bot-eye-blink {
            0%, 90%, 100% { transform: scaleY(1); }
            95% { transform: scaleY(0.1); }
          }
          @keyframes bot-sparkle-rotate {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          @keyframes bot-sparkle-pulse {
            0%, 100% { opacity: 0.4; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.3); }
          }
          .bot-eye-icon-orange {
            animation: ${isPaused ? 'none' : 'bot-eye-blink 3s ease-in-out infinite'};
          }
          .bot-sparkle-container-orange {
            animation: ${isPaused ? 'none' : 'bot-sparkle-rotate 4s linear infinite'};
          }
          .bot-sparkle-orange {
            animation: ${isPaused ? 'none' : 'bot-sparkle-pulse 1.5s ease-in-out infinite'};
          }
        `}
      </style>
      
      {/* Sparkles rotating around the eye */}
      <div 
        className="bot-sparkle-container-orange"
        style={{ 
          position: 'absolute', 
          inset: '-2px',
          pointerEvents: 'none'
        }}
      >
        {[0, 90, 180, 270].map((angle, i) => (
          <div
            key={i}
            className="bot-sparkle-orange"
            style={{
              position: 'absolute',
              width: '2px',
              height: '2px',
              backgroundColor: '#F59E0B',
              borderRadius: '50%',
              top: '50%',
              left: '50%',
              transform: `rotate(${angle}deg) translateY(-9px)`,
              animationDelay: `${i * 0.4}s`
            }}
          />
        ))}
      </div>
      
      {/* Eye Icon */}
      <svg 
        className="bot-eye-icon-orange"
        width="14" 
        height="14" 
        viewBox="0 0 24 24" 
        fill="none" 
        style={{ 
          transformOrigin: 'center',
          color: '#D97706'
        }}
      >
        <path 
          d="M2 12C2 12 5 5 12 5C19 5 22 12 22 12C22 12 19 19 12 19C5 19 2 12 2 12Z" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          fill="rgba(251, 191, 36, 0.2)"
        />
        <circle cx="12" cy="12" r="3" fill="currentColor" />
        <circle cx="13" cy="11" r="1" fill="white" opacity="0.8" />
      </svg>
    </div>
  );
};

export const BotStatusOverlay: React.FC<BotStatusOverlayProps> = ({
  isActive,
  activityMessage,
  isPaused,
  onPauseToggle
}) => {
  // UI temporarily disabled - remove this early return to re-enable
  return null;
  
  // eslint-disable-next-line no-unreachable
  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 5 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          style={{
            position: 'absolute',
            bottom: '100%', // Position directly above the chat bar
            left: '0',
            right: '0',
            marginBottom: '-8px', // Small overlap to create connected look
            zIndex: 0, // Behind the chat bar which has zIndex: 2
            pointerEvents: 'none',
          }}
        >
          {/* Content bar that sits above chat bar */}
          <div
            style={{
              width: '100%',
              background: 'rgba(252, 220, 180, 0.56)', // Lighter orange with 44% transparency
              border: '1px solid rgba(252, 220, 180, 0.7)',
              borderBottom: 'none', // No bottom border since chat bar covers it
              borderRadius: '12px 12px 0 0', // Only round top corners
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 12px',
              paddingBottom: '12px', // Extra padding at bottom (hidden behind chat bar)
              pointerEvents: 'auto',
            }}
          >
            {/* Left side: Icon + Message */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AnimatedEyeIcon isPaused={isPaused} />
              <style>
                {`
                  @keyframes bot-text-glow {
                    0%, 100% { opacity: 0.65; }
                    50% { opacity: 1; }
                  }
                  .bot-running-text {
                    animation: ${isPaused ? 'none' : 'bot-text-glow 1.3s ease-in-out infinite'};
                  }
                `}
              </style>
              <span
                className="bot-running-text"
                style={{
                  color: '#B45309',
                  fontSize: '11px',
                  fontWeight: 500,
                }}
              >
                Running...
              </span>
            </div>

            {/* Right side: Pause/Resume button */}
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPauseToggle();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                padding: '2px 6px',
                backgroundColor: 'transparent',
                border: 'none',
                borderRadius: '4px',
                color: '#B45309',
                fontSize: '10px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(252, 220, 180, 0.7)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {isPaused ? (
                <>
                  {/* Play icon */}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                  Resume
                </>
              ) : (
                <>
                  {/* Pause icon */}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                  Pause
                </>
              )}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default BotStatusOverlay;

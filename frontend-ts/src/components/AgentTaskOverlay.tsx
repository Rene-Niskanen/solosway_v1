import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface AgentTaskOverlayProps {
  message: string;
  onStop: () => void;
}

export const AgentTaskOverlay: React.FC<AgentTaskOverlayProps> = ({ message, onStop }) => {
  const [isStopHovered, setIsStopHovered] = useState(false);
  const [isStopPressed, setIsStopPressed] = useState(false);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 100,
          overflow: 'hidden',
        }}
      >
        {/* Subtle ambient glow */}
        <motion.div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse at center, transparent 30%, rgba(217, 119, 8, 0.12) 100%)',
          }}
          animate={{
            opacity: [0.1, 0.15, 0.1],
          }}
          transition={{
            duration: 2.5,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />

        {/* Floating control bar */}
        <motion.div
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 16, opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
          style={{
            position: 'absolute',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            pointerEvents: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              padding: '10px 14px 10px 14px',
              backgroundColor: 'rgba(255, 255, 255, 0.98)',
              borderRadius: '16px',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.08), 0 8px 24px rgba(0, 0, 0, 0.06)',
              border: '1px solid rgba(0, 0, 0, 0.06)',
              backdropFilter: 'blur(12px)',
            }}
          >
            {/* Velora Agent branding */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {/* Velora Icon - larger */}
              <img 
                src="/velora-dash-logo.png" 
                alt="Velora" 
                style={{
                  width: '26px',
                  height: '26px',
                  objectFit: 'contain',
                }}
              />
              <span style={{ 
                color: '#18181B', 
                fontWeight: 600, 
                fontSize: '14px', 
                whiteSpace: 'nowrap',
                letterSpacing: '-0.01em',
              }}>
                Velora Agent
              </span>
            </div>

            {/* Divider */}
            <div style={{ width: '1px', height: '22px', backgroundColor: 'rgba(0, 0, 0, 0.08)' }} />

            {/* Task message */}
            <span style={{ 
              color: '#71717A', 
              fontSize: '13px', 
              whiteSpace: 'nowrap',
              fontWeight: 450,
            }}>
              {message || 'Working...'}
            </span>

            {/* Premium Stop button */}
            <motion.button
              onClick={onStop}
              onMouseEnter={() => setIsStopHovered(true)}
              onMouseLeave={() => { setIsStopHovered(false); setIsStopPressed(false); }}
              onMouseDown={() => setIsStopPressed(true)}
              onMouseUp={() => setIsStopPressed(false)}
              animate={{
                scale: isStopPressed ? 0.96 : 1,
                backgroundColor: isStopHovered ? '#DC2626' : '#EF4444',
              }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '7px 14px 7px 12px',
                background: '#EF4444',
                border: 'none',
                borderRadius: '10px',
                color: 'white',
                fontWeight: 500,
                fontSize: '13px',
                cursor: 'pointer',
                boxShadow: isStopHovered 
                  ? '0 2px 8px rgba(239, 68, 68, 0.35)' 
                  : '0 1px 3px rgba(239, 68, 68, 0.2)',
                transition: 'box-shadow 0.2s ease',
              }}
            >
              {/* Stop icon - refined square */}
              <svg 
                width="10" 
                height="10" 
                viewBox="0 0 10 10" 
                fill="white"
              >
                <rect x="0" y="0" width="10" height="10" rx="2" />
              </svg>
              <span style={{ letterSpacing: '0.01em' }}>Stop</span>
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default AgentTaskOverlay;

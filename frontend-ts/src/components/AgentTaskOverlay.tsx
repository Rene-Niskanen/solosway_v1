import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Square } from 'lucide-react';

interface AgentTaskOverlayProps {
  message: string;
  onStop: () => void;
}

export const AgentTaskOverlay: React.FC<AgentTaskOverlayProps> = ({ message, onStop }) => {
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
        {/* Pulsing orange overlay - radial gradient from center */}
        <motion.div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse at center, transparent 20%, rgba(217, 119, 8, 0.15) 100%)',
          }}
          animate={{
            opacity: [0.12, 0.18, 0.12],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />

        {/* Floating control bar at bottom center */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 20, opacity: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
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
              gap: '12px',
              padding: '8px 12px 8px 16px',
              backgroundColor: '#1F2937',
              borderRadius: '9999px',
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2)',
            }}
          >
            {/* Velora Agent branding */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Infinity icon as Velora logo placeholder */}
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '4px',
                  background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.74-8z" />
                </svg>
              </div>
              <span style={{ color: 'white', fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap' }}>
                Velora Agent
              </span>
            </div>

            {/* Divider */}
            <div style={{ width: '1px', height: '20px', backgroundColor: 'rgba(255, 255, 255, 0.2)' }} />

            {/* Task message */}
            <span style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '13px', whiteSpace: 'nowrap' }}>
              {message || 'Working...'}
            </span>

            {/* Stop button */}
            <button
              onClick={onStop}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                backgroundColor: '#EF4444',
                border: 'none',
                borderRadius: '6px',
                color: 'white',
                fontWeight: 500,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#DC2626';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#EF4444';
              }}
            >
              <Square size={12} fill="white" />
              Stop
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default AgentTaskOverlay;

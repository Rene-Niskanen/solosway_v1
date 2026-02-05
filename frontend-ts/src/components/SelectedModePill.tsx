import * as React from 'react';
import { X } from 'lucide-react';

interface WebSearchPillProps {
  onDismiss: () => void;
  className?: string;
}

export const WebSearchPill: React.FC<WebSearchPillProps> = ({ onDismiss, className }) => {
  return (
    <button
      type="button"
      onClick={onDismiss}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-colors hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300 ${className || ''}`}
      style={{
        backgroundColor: '#E5E7EB', // Light grey
        color: '#1F2937', // Dark grey text for contrast
        border: 'none',
        fontSize: '13px',
        fontWeight: 500,
        height: '24px',
        minHeight: '24px',
        cursor: 'pointer',
      }}
      aria-label="Web search mode - click to disable"
      title="Web search enabled - click to disable"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="#1F2937" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" stroke="#1F2937" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2 12h20" stroke="#1F2937" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <span>Web search</span>
      <X className="w-3 h-3 ml-0.5" strokeWidth={2} style={{ color: '#1F2937' }} />
    </button>
  );
};

export default WebSearchPill;

"use client";

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, FileText, X, ArrowUp } from 'lucide-react';

interface CitationActionMenuProps {
  citation: {
    fileId: string;
    bbox: { left: number; top: number; width: number; height: number; page: number };
    block_content?: string;
    doc_id?: string;
    original_filename?: string;
    block_id?: string; // Block ID for focused citation retrieval
  };
  position: { x: number; y: number };
  onClose: () => void;
  onAskMore: (citation: CitationActionMenuProps['citation']) => void;
  onAddToWriting: (citation: CitationActionMenuProps['citation']) => void;
  propertyId?: string; // Optional property ID for query context
}

export const CitationActionMenu: React.FC<CitationActionMenuProps> = ({
  citation,
  position,
  onClose,
  onAskMore,
  onAddToWriting,
  propertyId
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showChatInput, setShowChatInput] = useState(false);
  const [queryText, setQueryText] = useState('');

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Auto-focus input when chat mode opens
  useEffect(() => {
    if (showChatInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showChatInput]);

  // Auto-resize textarea as user types
  useEffect(() => {
    if (inputRef.current) {
      // Reset height to auto to get the correct scrollHeight
      inputRef.current.style.height = 'auto';
      // Set height to scrollHeight, capped at max height
      const newHeight = Math.min(inputRef.current.scrollHeight, 120);
      inputRef.current.style.height = `${Math.max(newHeight, 40)}px`;
    }
  }, [queryText]);

  // Track if context was prepared (to know if we need to clear it on close)
  const [contextPrepared, setContextPrepared] = useState(false);
  const querySubmittedRef = useRef(false);

  // Pre-build citation context immediately (ready before user types query)
  const citationContext = useMemo(() => ({
    document_id: citation.doc_id || citation.fileId,
    page_number: citation.bbox?.page || 0,
    bbox: {
      left: citation.bbox?.left || 0,
      top: citation.bbox?.top || 0,
      width: citation.bbox?.width || 0,
      height: citation.bbox?.height || 0
    },
    cited_text: citation.block_content || '',
    original_filename: citation.original_filename || '',
    block_id: citation.block_id || '' // Block ID for focused citation retrieval
  }), [citation]);

  // Clear prepared context (when user backs out or closes without submitting)
  const clearPreparedContext = () => {
    if (contextPrepared && !querySubmittedRef.current) {
      const clearEvent = new CustomEvent('citation-context-clear', {});
      window.dispatchEvent(clearEvent);
      console.log('🧹 [CITATION] Cleared prepared citation context (user backed out)');
    }
    setContextPrepared(false);
  };

  // Cleanup on unmount: clear context if prepared but not submitted
  useEffect(() => {
    return () => {
      if (contextPrepared && !querySubmittedRef.current) {
        const clearEvent = new CustomEvent('citation-context-clear', {});
        window.dispatchEvent(clearEvent);
        console.log('🧹 [CITATION] Cleared prepared citation context (menu closed)');
      }
    };
  }, [contextPrepared]);

  const handleAskMore = () => {
    // Show chat input bar (empty - user will type their query)
    setShowChatInput(true);
    setQueryText(''); // Start with empty input
    
    // PRE-BUILD: Dispatch citation context immediately so MainContent can prepare
    // This makes the context ready by the time user finishes typing their query
    const prepareEvent = new CustomEvent('citation-context-prepare', {
      detail: {
        citationContext,
        propertyId,
        documentIds: citation.doc_id ? [citation.doc_id] : undefined
      }
    });
    window.dispatchEvent(prepareEvent);
    setContextPrepared(true);
    console.log('⚡ [CITATION] Pre-built citation context on Ask button click:', citationContext);
  };

  const handleAddToWriting = () => {
    onAddToWriting(citation);
    onClose();
  };

  const handleSubmitQuery = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedQuery = queryText.trim();
    if (!trimmedQuery) return;

    // Mark as submitted so cleanup doesn't clear the context
    querySubmittedRef.current = true;

    // Dispatch event to submit query (context already pre-built)
    const event = new CustomEvent('citation-query-submit', {
      detail: {
        query: trimmedQuery, // User's typed query (visible)
        citationContext, // Structured citation metadata (already prepared)
        propertyId,
        documentIds: citation.doc_id ? [citation.doc_id] : undefined
      }
    });
    window.dispatchEvent(event);

    // Close menu after submitting
    onClose();
  };

  const handleBackToMenu = () => {
    // Clear the prepared context since user is going back
    clearPreparedContext();
    setShowChatInput(false);
    setQueryText('');
  };

  return (
    <AnimatePresence>
      <motion.div
        ref={menuRef}
        initial={{ opacity: 0, scale: 0.98, y: 4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 4 }}
        transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          transform: 'translateX(-50%)', // Center horizontally on click position
          zIndex: 1000,
          minWidth: showChatInput ? '340px' : '180px',
          maxWidth: showChatInput ? '400px' : '180px',
          // Solid background for chat mode, simpler for menu mode
          background: 'white',
          border: showChatInput ? '1px solid rgba(82, 101, 128, 0.25)' : '1px solid #e5e7eb',
          boxShadow: showChatInput 
            ? '0 4px 24px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.6)'
            : '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          borderRadius: showChatInput ? '12px' : '8px',
          overflow: 'hidden'
        }}
      >
        {!showChatInput ? (
          // Menu mode - original compact design
          <>
            <div className="p-1.5">
              <button
                onClick={handleAskMore}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                <span className="flex-1 text-left">Ask a question</span>
              </button>
              
              <button
                onClick={handleAddToWriting}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
              >
                <FileText className="w-3.5 h-3.5 text-green-600" />
                <span className="flex-1 text-left">Save citation</span>
              </button>
            </div>
            
            <div className="border-t border-gray-100">
              <button
                onClick={onClose}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                <span>Close</span>
              </button>
            </div>
          </>
        ) : (
          // Chat input mode - matching SearchBar style
          <form onSubmit={handleSubmitQuery} style={{ padding: '12px' }}>
            <div className="relative flex flex-col" style={{ gap: '10px' }}>
              {/* Textarea container */}
              <div className="relative flex items-end" style={{ gap: '8px' }}>
                <textarea
                  ref={inputRef}
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmitQuery(e);
                    }
                  }}
                  placeholder="Ask about this citation..."
                  style={{
                    flex: 1,
                    resize: 'none',
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    fontSize: '14px',
                    fontWeight: 400,
                    color: '#1F2937',
                    lineHeight: '1.5',
                    minHeight: '40px',
                    maxHeight: '120px',
                    padding: '0',
                    fontFamily: 'inherit'
                  }}
                />
              </div>
              
              {/* Bottom row: close button and send button */}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleBackToMenu}
                  className="flex items-center gap-1.5 transition-colors"
                  style={{
                    padding: '6px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 500,
                    color: '#6B7280',
                    background: 'transparent'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 0, 0, 0.04)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <X className="w-3 h-3" strokeWidth={2} />
                  <span>Cancel</span>
                </button>
                
                <motion.button
                  type="submit"
                  disabled={!queryText.trim()}
                  className="flex items-center justify-center relative focus:outline-none outline-none"
                  style={{
                    width: '36px',
                    height: '36px',
                    minWidth: '36px',
                    minHeight: '36px',
                    maxWidth: '36px',
                    maxHeight: '36px',
                    borderRadius: '50%',
                    border: 'none',
                    flexShrink: 0,
                    alignSelf: 'center',
                    cursor: queryText.trim() ? 'pointer' : 'not-allowed'
                  }}
                  animate={{
                    backgroundColor: queryText.trim() ? '#4A4A4A' : '#F3F4F6',
                    opacity: queryText.trim() ? 1 : 0.6
                  }}
                  whileHover={queryText.trim() ? { scale: 1.05 } : {}}
                  whileTap={queryText.trim() ? { scale: 0.95 } : {}}
                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  title="Send"
                  tabIndex={0}
                >
                  <ArrowUp 
                    className="w-5 h-5" 
                    strokeWidth={2.5} 
                    style={{ color: queryText.trim() ? '#ffffff' : '#4B5563' }} 
                  />
                </motion.button>
              </div>
            </div>
          </form>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, Paperclip, Mic, LayoutDashboard, PanelRightOpen, SquareDashedMousePointer, Scan, Fullscreen, AudioLines } from "lucide-react";
import { PropertyAttachment } from './PropertyAttachment';
import { usePropertySelection } from '../contexts/PropertySelectionContext';

interface MapChatBarProps {
  onQuerySubmit?: (query: string) => void;
  onMapToggle?: () => void;
  onPanelToggle?: () => void;
  placeholder?: string;
  width?: string; // Custom width for the container
  hasPreviousSession?: boolean; // If true, show the panel open button
  initialValue?: string; // Initial query value when switching from SearchBar
}

export const MapChatBar: React.FC<MapChatBarProps> = ({
  onQuerySubmit,
  onMapToggle,
  onPanelToggle,
  placeholder = "Ask anything...",
  width = 'clamp(450px, 90vw, 700px)', // Match SearchBar width for consistency
  hasPreviousSession = false,
  initialValue = ""
}) => {
  const [inputValue, setInputValue] = React.useState<string>(initialValue);
  const [isSubmitted, setIsSubmitted] = React.useState<boolean>(false);
  const [isFocused, setIsFocused] = React.useState<boolean>(false);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const initialScrollHeightRef = React.useRef<number | null>(null);
  const isDeletingRef = React.useRef(false);
  
  // Use property selection context
  const { 
    isSelectionModeActive, 
    toggleSelectionMode, 
    setSelectionModeActive,
    propertyAttachments, 
    removePropertyAttachment,
    clearPropertyAttachments 
  } = usePropertySelection();
  
  // Initialize textarea height on mount
  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      const initialHeight = inputRef.current.scrollHeight;
      initialScrollHeightRef.current = initialHeight;
      inputRef.current.style.height = `${initialHeight}px`;
    }
  }, []);
  
  // Update input value when initialValue prop changes (e.g., when switching from SearchBar)
  React.useEffect(() => {
    // Only update if initialValue is provided and different from current value
    // This handles both initial mount and prop updates
    if (initialValue !== undefined && initialValue !== inputValue) {
      console.log('📝 MapChatBar: Setting initial value from prop:', initialValue);
      setInputValue(initialValue);
      // Resize textarea after setting value
      if (inputRef.current) {
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
          if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            const scrollHeight = inputRef.current.scrollHeight;
            const maxHeight = 150;
            const newHeight = Math.min(scrollHeight, maxHeight);
            inputRef.current.style.height = `${newHeight}px`;
            inputRef.current.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
            inputRef.current.style.minHeight = '28px';
          }
        });
      }
    }
  }, [initialValue]); // Only depend on initialValue, not inputValue to avoid loops

  // Handle textarea change with auto-resize logic
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    
    setInputValue(value);
    
    // Always stay in multi-line layout, just adjust height
    if (inputRef.current) {
      // Set height to auto first to get accurate scrollHeight
      inputRef.current.style.height = 'auto';
      const scrollHeight = inputRef.current.scrollHeight;
      const maxHeight = 150; // Larger max height for map view
      const newHeight = Math.min(scrollHeight, maxHeight);
      
      // Use requestAnimationFrame to batch the height update and prevent layout shift
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.style.height = `${newHeight}px`;
          inputRef.current.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
          inputRef.current.style.minHeight = '28px';
        }
      });
      
      if (!isDeletingRef.current && cursorPos !== null) {
        inputRef.current.setSelectionRange(cursorPos, cursorPos);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitted = inputValue.trim();
    if ((submitted || propertyAttachments.length > 0) && !isSubmitted && onQuerySubmit) {
      setIsSubmitted(true);
      onQuerySubmit(submitted);
      setInputValue("");
      // Don't clear property attachments here - let SideChatPanel read them first
      // SideChatPanel will clear them after initializing with them
      // Turn off selection mode after submission
      if (propertyAttachments.length > 0) {
        setSelectionModeActive(false);
      }
      setIsSubmitted(false);
      
      // Reset textarea
      if (inputRef.current) {
        const initialHeight = initialScrollHeightRef.current ?? 28;
        inputRef.current.style.height = `${initialHeight}px`;
        inputRef.current.style.overflowY = '';
        inputRef.current.style.overflow = '';
      }
    }
  };

  return (
    <div className="w-full flex justify-center items-center" style={{ 
      position: 'fixed',
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 50,
      width: width,
      maxWidth: width,
      boxSizing: 'border-box'
    }}>
      <form onSubmit={handleSubmit} className="relative" style={{ overflow: 'visible', height: 'auto', width: '100%' }}>
        {/* Toggle Panel Button - Floating to the right of the chat bar */}
        {hasPreviousSession && onPanelToggle && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            style={{
              position: 'absolute',
              left: '-50px', // Position outside the chat bar to the left
              bottom: '0',
              height: '100%',
              display: 'flex',
              alignItems: 'flex-end', // Align with bottom of chat bar
              paddingBottom: '6px',
              zIndex: 51
            }}
          >
            <button
              type="button"
              onClick={onPanelToggle}
              className="flex items-center justify-center bg-white rounded-lg shadow-md border border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all duration-200"
              style={{
                width: '40px',
                height: '40px'
              }}
              title="Open chat history"
            >
              <PanelRightOpen className="w-5 h-5" />
            </button>
          </motion.div>
        )}

        <div 
          className={`relative flex flex-col ${isSubmitted ? 'opacity-75' : ''}`}
          style={{
            background: '#ffffff',
            border: '1px solid #E5E7EB',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
            paddingTop: '16px', // Larger padding for map view
            paddingBottom: '16px',
            paddingRight: '16px',
            paddingLeft: '16px',
            overflow: 'visible',
            width: '100%',
            minWidth: '0',
            height: 'auto',
            minHeight: 'fit-content',
            boxSizing: 'border-box',
            borderRadius: '12px'
          }}
        >
          {/* Input row */}
          <div 
            className="relative flex flex-col w-full" 
            style={{ 
              height: 'auto', 
              minHeight: '28px',
              width: '100%',
              minWidth: '0'
            }}
          >
            {/* Property Attachments Display - Above textarea */}
            {propertyAttachments.length > 0 && (
              <div 
                style={{ 
                  height: 'auto', 
                  marginBottom: '12px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                  width: '100%'
                }}
              >
                {propertyAttachments.map((property) => (
                  <PropertyAttachment
                    key={property.id}
                    attachment={property}
                    onRemove={removePropertyAttachment}
                  />
                ))}
              </div>
            )}

            {/* Textarea area - always above */}
            <div 
              className="flex items-start w-full"
              style={{ 
                minHeight: '28px',
                height: 'auto', // Ensure height is auto to prevent layout shifts
                width: '100%',
                marginBottom: inputValue.trim().length > 0 ? '16px' : '12px' // More space when there's text to prevent icons from being too close
              }}
            >
              <div className="flex-1 relative flex items-start w-full" style={{ 
                overflow: 'visible', 
                minHeight: '28px',
                width: '100%',
                minWidth: '0',
                paddingRight: '0px' // Ensure no extra padding on right side
              }}>
                <textarea 
                  ref={inputRef}
                  value={inputValue}
                  onChange={handleTextareaChange}
                  onFocus={() => setIsFocused(true)} 
                  onBlur={() => setIsFocused(false)} 
                  onKeyDown={e => { 
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                    if (e.key === 'Backspace' || e.key === 'Delete') {
                      isDeletingRef.current = true;
                      setTimeout(() => {
                        isDeletingRef.current = false;
                      }, 200);
                    }
                  }} 
                  placeholder={placeholder}
                  className="w-full bg-transparent focus:outline-none text-base font-normal text-gray-900 placeholder:text-gray-500 resize-none [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200/50 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:hover:bg-gray-300/70"
                  style={{
                    height: '28px', // Fixed initial height to prevent layout shift when typing starts
                    minHeight: '28px',
                    maxHeight: '150px',
                    fontSize: '16px',
                    lineHeight: '22px',
                    paddingTop: '0px',
                    paddingBottom: '0px',
                    paddingRight: '8px', // Match left padding
                    paddingLeft: '8px',
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(229, 231, 235, 0.5) transparent',
                    overflow: 'hidden',
                    overflowY: 'auto',
                    wordWrap: 'break-word',
                    transition: 'height 0.15s ease-out, overflow 0.15s ease-out', // Smooth transition for height changes
                    resize: 'none',
                    width: '100%',
                    minWidth: '0',
                    boxSizing: 'border-box' // Ensure padding is included in height calculation
                  }}
                  autoComplete="off"
                  disabled={isSubmitted}
                  rows={1}
                />
              </div>
            </div>
            
            {/* Bottom row: Icons (Left) and Send Button (Right) */}
            <div 
              className="relative flex items-center justify-between w-full"
              style={{
                width: '100%',
                minWidth: '0'
              }}
            >
              {/* Left Icons: Dashboard */}
              <div className="flex items-center space-x-4">
                <button
                  type="button"
                  onClick={onMapToggle}
                  className="p-1 text-gray-400 hover:text-gray-600 transition-colors ml-1"
                  title="Back to search mode"
                >
                  <LayoutDashboard className="w-5 h-5" strokeWidth={1.5} />
                </button>
              </div>

              {/* Right Icons: Card Selection, Attachment, Mic, Send */}
              <div className="flex items-center space-x-4">
                <button
                  type="button"
                  onClick={toggleSelectionMode}
                  className={`p-1 transition-colors ${
                    propertyAttachments.length > 0
                      ? 'text-green-500 hover:text-green-600 bg-green-50 rounded'
                      : isSelectionModeActive 
                        ? 'text-blue-600 hover:text-blue-700 bg-blue-50 rounded' 
                        : 'text-gray-900 hover:text-gray-700'
                  }`}
                  title={
                    propertyAttachments.length > 0
                      ? `${propertyAttachments.length} property${propertyAttachments.length > 1 ? 'ies' : ''} selected`
                      : isSelectionModeActive 
                        ? "Property selection mode active - Click property cards to add them" 
                        : "Select property cards"
                  }
                >
                  {propertyAttachments.length > 0 ? (
                    <Fullscreen className="w-5 h-5" strokeWidth={1.5} />
                  ) : isSelectionModeActive ? (
                    <Scan className="w-5 h-5" strokeWidth={1.5} />
                  ) : (
                    <SquareDashedMousePointer className="w-5 h-5" strokeWidth={1.5} />
                  )}
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-full text-gray-900 transition-colors focus:outline-none outline-none"
                  style={{
                    backgroundColor: '#FFFFFF',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                    transition: 'background-color 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#F5F5F5';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#FFFFFF';
                  }}
                >
                  <Paperclip className="w-3.5 h-3.5" strokeWidth={1.5} />
                  <span className="text-xs font-medium">Attach</span>
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-full text-gray-900 transition-colors focus:outline-none outline-none"
                  style={{
                    backgroundColor: '#ECECEC',
                    transition: 'background-color 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#E0E0E0';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#ECECEC';
                  }}
                >
                  <AudioLines className="w-3.5 h-3.5" strokeWidth={1.5} />
                  <span className="text-xs font-medium">Voice</span>
                </button>
                
                {/* Send button */}
                <AnimatePresence>
                  {(inputValue.trim() || propertyAttachments.length > 0) && (
                    <motion.button 
                      key="send-button"
                      type="submit" 
                      onClick={handleSubmit} 
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1, backgroundColor: '#415C85' }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className={`flex items-center justify-center relative focus:outline-none outline-none ${!isSubmitted ? '' : 'cursor-not-allowed'}`}
                      style={{
                        width: '32px',
                        height: '32px',
                        minWidth: '32px',
                        minHeight: '32px',
                        borderRadius: '50%'
                      }}
                      disabled={isSubmitted}
                      whileHover={!isSubmitted ? { 
                        scale: 1.05
                      } : {}}
                      whileTap={!isSubmitted ? { 
                        scale: 0.95
                      } : {}}
                    >
                      <motion.div
                        key="arrow-up"
                        initial={{ opacity: 1 }}
                        animate={{ opacity: 1 }}
                        className="absolute inset-0 flex items-center justify-center"
                        style={{ pointerEvents: 'none' }}
                      >
                        <ArrowUp className="w-4 h-4" strokeWidth={2.5} style={{ color: '#ffffff' }} />
                      </motion.div>
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};


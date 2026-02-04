"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, Paperclip, LibraryBig, PanelRightOpen, AudioLines, Globe } from "lucide-react";
import { PropertyAttachment } from './PropertyAttachment';
import { usePropertySelection } from '../contexts/PropertySelectionContext';
import { ModeSelector } from './ModeSelector';
import { ModelSelector } from './ModelSelector';
import { WebSearchPill } from './SelectedModePill';

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
  width = 'min(100%, 640px)', // Match SideChatPanel width for consistency
  hasPreviousSession = false,
  initialValue = ""
}) => {
  const [inputValue, setInputValue] = React.useState<string>(initialValue);
  const [isSubmitted, setIsSubmitted] = React.useState<boolean>(false);
  const [isFocused, setIsFocused] = React.useState<boolean>(false);
  const [isWebSearchEnabled, setIsWebSearchEnabled] = React.useState<boolean>(false);
  const [isCompact, setIsCompact] = React.useState<boolean>(false);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const initialScrollHeightRef = React.useRef<number | null>(null);
  const isDeletingRef = React.useRef(false);
  const formRef = React.useRef<HTMLFormElement>(null);
  
  // Use property selection context
  const { 
    setSelectionModeActive,
    propertyAttachments, 
    removePropertyAttachment,
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

  // Track form width for responsive model selector
  React.useEffect(() => {
    if (!formRef.current) return;

    const updateCompact = () => {
      if (formRef.current) {
        const formWidth = formRef.current.offsetWidth;
        // Show compact mode (star icon only) when form width is <= 425px (same threshold as SideChatPanel)
        // This matches the logic in SideChatPanel where compact mode triggers at minimum width
        setIsCompact(formWidth <= 425);
      }
    };

    // Initial check
    updateCompact();

    // Use ResizeObserver to track width changes
    const resizeObserver = new ResizeObserver(updateCompact);
    resizeObserver.observe(formRef.current);

    return () => {
      resizeObserver.disconnect();
    };
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
            const maxHeight = 140; // Match SideChatPanel
            const newHeight = Math.min(scrollHeight, maxHeight);
            inputRef.current.style.height = `${newHeight}px`;
            inputRef.current.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
            inputRef.current.style.minHeight = '24px'; // Match SideChatPanel
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
      const maxHeight = 140; // Match SideChatPanel maxHeight
      const newHeight = Math.min(scrollHeight, maxHeight);
      
      // Use requestAnimationFrame to batch the height update and prevent layout shift
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.style.height = `${newHeight}px`;
          inputRef.current.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
          inputRef.current.style.minHeight = '24px'; // Match SideChatPanel
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
        const initialHeight = initialScrollHeightRef.current ?? 24; // Match SideChatPanel
        inputRef.current.style.height = `${initialHeight}px`;
        inputRef.current.style.overflowY = '';
        inputRef.current.style.overflow = '';
      }
    }
  };

  return (
    <div 
      className="w-full flex justify-center items-center" 
      style={{ 
        position: 'fixed',
        bottom: '48px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        width: 'min(100%, 640px)', // Match SideChatPanel width
        maxWidth: '640px',
        paddingLeft: '32px',
        paddingRight: '32px',
        boxSizing: 'border-box'
      }}
    >
      <form ref={formRef} onSubmit={handleSubmit} className="relative" style={{ overflow: 'visible', height: 'auto', width: '100%' }}>
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
            background: '#FFFFFF',
            border: '1px solid #B8BCC4', // Match SideChatPanel border
            boxShadow: 'none', // No shadow like SideChatPanel
            position: 'relative',
            paddingTop: '8px', // Match SideChatPanel padding
            paddingBottom: '8px',
            paddingRight: '12px',
            paddingLeft: '12px',
            overflow: 'visible',
            width: '100%',
            minWidth: '300px',
            height: 'auto',
            minHeight: '48px', // Match SideChatPanel minHeight
            boxSizing: 'border-box',
            borderRadius: '8px', // Match SideChatPanel sharper corners
            transition: 'background-color 0.2s ease-in-out, border-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
            zIndex: 2
          }}
        >
          {/* Input row */}
          <div 
            className="relative flex flex-col w-full" 
            style={{ 
              height: 'auto', 
              minHeight: '24px',
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
                minHeight: '24px', // Match SideChatPanel
                height: 'auto',
                width: '100%',
                marginTop: '4px', // Match SideChatPanel
                marginBottom: '12px', // Fixed margin like SideChatPanel
                flexShrink: 0
              }}
            >
              <div className="flex-1 relative flex items-start w-full" style={{ 
                overflow: 'visible', 
                minHeight: '24px',
                width: '100%',
                minWidth: '0',
                paddingRight: '0px'
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
                  className="w-full bg-transparent focus:outline-none font-normal text-gray-900 resize-none [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200/50 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:hover:bg-gray-300/70 [&::placeholder]:text-[#8E8E8E]"
                  style={{
                    height: '24px', // Match SideChatPanel
                    minHeight: '24px',
                    maxHeight: '140px', // Match SideChatPanel
                    fontSize: '14px',
                    lineHeight: '20px',
                    paddingTop: '0px',
                    paddingBottom: '4px',
                    paddingRight: '12px',
                    paddingLeft: '6px',
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(229, 231, 235, 0.5) transparent',
                    overflow: 'hidden',
                    overflowY: 'auto',
                    wordWrap: 'break-word',
                    transition: 'none', // No transition like SideChatPanel
                    resize: 'none',
                    width: '100%',
                    minWidth: '0',
                    color: inputValue ? '#0D0D0D' : undefined, // Match SideChatPanel
                    boxSizing: 'border-box'
                  }}
                  autoComplete="off"
                  disabled={isSubmitted}
                  rows={1}
                />
              </div>
            </div>
            
            {/* Bottom row: Mode/Model selectors (Left) and Action buttons (Right) */}
            <div 
              className="relative flex items-center justify-between w-full"
              style={{
                width: '100%',
                minWidth: '0',
                minHeight: '32px' // Match SideChatPanel
              }}
            >
              {/* Left group: Mode selector and Model selector */}
              <div className="flex items-center gap-1">
                {/* Mode Selector Dropdown */}
                <ModeSelector compact={isCompact} />
                
                {/* Model Selector Dropdown */}
                <ModelSelector compact={isCompact} />
              </div>

              {/* Right group: Web search, Dashboard, Attach, Voice, Send */}
              <motion.div 
                className="flex items-center gap-1.5 flex-shrink-0" 
                style={{ marginRight: '4px' }}
                layout
                transition={{ 
                  layout: { duration: 0.12, ease: [0.16, 1, 0.3, 1] },
                  default: { duration: 0.18, ease: [0.16, 1, 0.3, 1] }
                }}
              >
                {/* Web Search Toggle */}
                {isWebSearchEnabled ? (
                  <WebSearchPill 
                    onDismiss={() => setIsWebSearchEnabled(false)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsWebSearchEnabled(true)}
                    className="flex items-center justify-center rounded-full text-gray-600 hover:text-gray-700 transition-colors focus:outline-none outline-none"
                    style={{
                      backgroundColor: '#FFFFFF',
                      border: '1px solid rgba(229, 231, 235, 0.6)',
                      borderRadius: '12px',
                      transition: 'background-color 0.2s ease',
                      width: '28px',
                      height: '24px',
                      minHeight: '24px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#F5F5F5';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#FFFFFF';
                    }}
                    title="Enable web search"
                  >
                    <Globe className="w-3.5 h-3.5" strokeWidth={2} />
                  </button>
                )}
                
                {/* Dashboard Toggle Button */}
                <button 
                  type="button" 
                  onClick={onMapToggle}
                  className="flex items-center gap-1.5 px-2 py-1 text-gray-900 focus:outline-none outline-none"
                  style={{
                    backgroundColor: '#FCFCF9',
                    border: '1px solid rgba(229, 231, 235, 0.6)',
                    borderRadius: '12px',
                    transition: 'background-color 0.15s ease',
                    height: '24px',
                    minHeight: '24px',
                    paddingLeft: '8px',
                    paddingRight: '8px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#F5F5F5';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#FCFCF9';
                  }}
                  title="Back to dashboard"
                  aria-label="Dashboard"
                >
                  <LibraryBig className="w-3.5 h-3.5" strokeWidth={1.5} />
                  <span className="text-xs font-medium">Dashboard</span>
                </button>
                
                {/* Attach Button */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-2 py-1 rounded-full text-gray-900 focus:outline-none outline-none"
                    style={{
                      backgroundColor: '#FCFCF9',
                      border: '1px solid rgba(229, 231, 235, 0.6)',
                      transition: 'background-color 0.15s ease, border-color 0.15s ease',
                      willChange: 'background-color, border-color',
                      padding: '4px 8px',
                      height: '24px',
                      minHeight: '24px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#F5F5F5';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#FCFCF9';
                    }}
                    title="Attach file"
                  >
                    <Paperclip className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span className="text-xs font-medium">Attach</span>
                  </button>
                </div>
                
                {/* Voice Button */}
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-gray-900 focus:outline-none outline-none"
                  style={{
                    backgroundColor: '#ECECEC',
                    transition: 'background-color 0.15s ease',
                    willChange: 'background-color',
                    height: '22px',
                    minHeight: '22px',
                    fontSize: '12px',
                    marginLeft: '4px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#E0E0E0';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#ECECEC';
                  }}
                  title="Voice input"
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
                      animate={{ opacity: 1, scale: 1, backgroundColor: '#4A4A4A' }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className={`flex items-center justify-center relative focus:outline-none outline-none ${!isSubmitted ? '' : 'cursor-not-allowed'}`}
                      style={{
                        width: '24px',
                        height: '24px',
                        minWidth: '24px',
                        minHeight: '24px',
                        borderRadius: '50%',
                        flexShrink: 0
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
              </motion.div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};


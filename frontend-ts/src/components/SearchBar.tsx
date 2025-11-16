"use client";

import * as React from "react";
import { useState, useRef, useEffect, useLayoutEffect, useImperativeHandle, forwardRef, useCallback } from "react";
import { flushSync } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Map, ArrowUp, LayoutDashboard, Mic } from "lucide-react";
import { ImageUploadButton } from './ImageUploadButton';
import { FileAttachment, FileAttachmentData } from './FileAttachment';
import { toast } from "@/hooks/use-toast";
import { usePreview } from '../contexts/PreviewContext';

export interface SearchBarProps {
  className?: string;
  onSearch?: (query: string) => void;
  onQueryStart?: (query: string) => void;
  onMapToggle?: () => void;
  resetTrigger?: number;
  // Context-aware props
  isMapVisible?: boolean;
  isInChatMode?: boolean;
  currentView?: string;
  hasPerformedSearch?: boolean;
  isSidebarCollapsed?: boolean;
  // File drop prop
  onFileDrop?: (file: File) => void;
}

export const SearchBar = forwardRef<{ handleFileDrop: (file: File) => void }, SearchBarProps>(({
  className,
  onSearch,
  onQueryStart,
  onMapToggle,
  resetTrigger,
  isMapVisible = false,
  isInChatMode = false,
  currentView = 'search',
  hasPerformedSearch = false,
  isSidebarCollapsed = false,
  onFileDrop
}, ref) => {
  console.log('🎯 SearchBar component rendering/mounting');
  const [searchValue, setSearchValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [hasStartedTyping, setHasStartedTyping] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<FileAttachmentData[]>([]);
  const MAX_FILES = 4;
  const [isMultiLine, setIsMultiLine] = useState(false);
  
  // Use shared preview context
  const {
    previewFiles,
    activePreviewTabIndex,
    isPreviewOpen,
    setPreviewFiles,
    setActivePreviewTabIndex,
    setIsPreviewOpen,
    addPreviewFile,
    MAX_PREVIEW_TABS
  } = usePreview();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const queryStartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const multiLineTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initialScrollHeightRef = useRef<number | null>(null);
  const isDeletingRef = useRef(false);
  
  // Determine if we should use rounded corners (when there's content or attachment)
  const hasContent = searchValue.trim().length > 0 || attachedFiles.length > 0;

  // Context-aware configuration
  const getContextConfig = () => {
    if (isMapVisible) {
      return {
        placeholder: "Search for properties...",
        showMapToggle: true, // Always show map toggle
        showMic: true, // Show paperclip icon in map view too
        position: "bottom", // Always bottom when map is visible
        glassmorphism: true,
        maxWidth: '100vw', // Full width for map mode
        greenGlow: true, // Add green glow for map mode
        isSquare: true // Square corners for map mode
      };
    } else if (isInChatMode) {
      return {
        placeholder: "Ask anything...",
        showMapToggle: true,
        showMic: true,
        position: "center", // Always center
        glassmorphism: false,
        maxWidth: '600px', // Narrower for chat mode
        greenGlow: false,
        isSquare: false // Keep rounded for chat mode
      };
    } else {
      // Dashboard view - square corners
      return {
        placeholder: "What can I help you find today?",
        showMapToggle: true,
        showMic: true,
        position: "center", // Always center
        glassmorphism: false,
        maxWidth: '700px', // Slightly wider for dashboard view
        greenGlow: false,
        isSquare: true // Square corners for dashboard view
      };
    }
  };

  const contextConfig = getContextConfig();
  
  // Auto-focus on any keypress for search bar - but only when hovered
  useEffect(() => {
    if (!isHovered) return; // Only add listener when search bar is hovered
    
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Don't interfere with form inputs, buttons, or modifier keys
      if (e.target instanceof HTMLInputElement || 
          e.target instanceof HTMLTextAreaElement || 
          e.target instanceof HTMLButtonElement ||
          e.ctrlKey || e.metaKey || e.altKey || 
          e.key === 'Tab' || e.key === 'Escape') {
        return;
      }
      
      // Focus the search input
      if (inputRef.current) {
        inputRef.current.focus();
      }
    };
    
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isHovered]);

  // Reset when resetTrigger changes
  useEffect(() => {
    if (resetTrigger !== undefined) {
      setSearchValue('');
      setIsSubmitted(false);
      setHasStartedTyping(false);
      setIsFocused(false);
      setAttachedFiles([]);
      setIsMultiLine(false);
      // Clear any pending query start calls
      if (queryStartTimeoutRef.current) {
        clearTimeout(queryStartTimeoutRef.current);
        queryStartTimeoutRef.current = null;
      }
      // Clear multi-line timeout
      if (multiLineTimeoutRef.current) {
        clearTimeout(multiLineTimeoutRef.current);
        multiLineTimeoutRef.current = null;
      }
    }
  }, [resetTrigger]);
  
  // Close preview modal when leaving map view
  // This ensures preview doesn't persist when switching to dashboard/home
  const prevIsMapVisibleRef = useRef(isMapVisible);
  useEffect(() => {
    const prevIsMapVisible = prevIsMapVisibleRef.current;
    const hasViewChanged = prevIsMapVisible !== isMapVisible;
    prevIsMapVisibleRef.current = isMapVisible;
    
    // Only close preview when leaving map view (going from map to dashboard)
    // Don't close when entering map view or if preview isn't open
    if (hasViewChanged && prevIsMapVisible === true && !isMapVisible && isPreviewOpen) {
      // Use a small timeout to allow view transition to start smoothly
      const timeoutId = setTimeout(() => {
        setIsPreviewOpen(false);
        setPreviewFiles([]);
        setActivePreviewTabIndex(0);
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
  }, [isMapVisible, isPreviewOpen]);
  
  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (queryStartTimeoutRef.current) {
        clearTimeout(queryStartTimeoutRef.current);
      }
      if (multiLineTimeoutRef.current) {
        clearTimeout(multiLineTimeoutRef.current);
      }
    };
  }, []);

  // Auto-focus on mount and reset height
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.style.height = 'auto';
      const initialHeight = inputRef.current.scrollHeight;
      initialScrollHeightRef.current = initialHeight; // Store initial height for accurate reset
      inputRef.current.style.height = `${initialHeight}px`;
    }
  }, []);

  // Complete reset function - returns to initial opening state
  // Only resets state - DOM reset is handled by useEffect after React updates
  const resetToInitialState = useCallback(() => {
    // Reset all state immediately and synchronously
    setIsMultiLine(false);
    setIsSubmitted(false);
    setHasStartedTyping(false);
      setAttachedFiles([]);
    
    // Clear any pending timeouts
    if (queryStartTimeoutRef.current) {
      clearTimeout(queryStartTimeoutRef.current);
      queryStartTimeoutRef.current = null;
    }
    if (multiLineTimeoutRef.current) {
      clearTimeout(multiLineTimeoutRef.current);
      multiLineTimeoutRef.current = null;
    }
    // Note: DOM reset is handled by useEffect that watches isMultiLine and searchValue
  }, []);

  // Helper function to reset textarea to initial state
  const resetTextareaToInitial = useCallback(() => {
    if (!inputRef.current) return;
    
    // Check if this is the single-line textarea (not hidden)
    const parent = inputRef.current.parentElement;
    if (parent && parent.classList.contains('hidden')) return;
    
    // Completely reset ALL dynamic styles to get clean slate
    inputRef.current.style.height = 'auto';
    inputRef.current.style.overflowY = '';
    inputRef.current.style.overflow = '';
    inputRef.current.style.paddingTop = '';
    inputRef.current.style.paddingBottom = '';
    inputRef.current.style.marginTop = '';
    inputRef.current.style.marginBottom = '';
    inputRef.current.style.verticalAlign = '';
    inputRef.current.style.transform = '';
    inputRef.current.style.transition = '';
    inputRef.current.style.maxHeight = '';
    inputRef.current.style.minHeight = '';
    
    // Force layout recalculation to ensure browser processes style removal
    void inputRef.current.offsetHeight;
    void inputRef.current.scrollHeight;
    
    // Get natural height after clearing styles
    const naturalHeight = inputRef.current.scrollHeight;
    
    // Always use initial height if available (this is the source of truth)
    // If initial height is not set, use natural height as fallback
    const targetHeight = initialScrollHeightRef.current ?? naturalHeight;
    inputRef.current.style.height = `${targetHeight}px`;
    
    // Set overflow for single-line mode
    inputRef.current.style.overflowY = 'visible';
    inputRef.current.style.overflow = 'visible';
    
    // Verify the height matches initial (with 1px tolerance for rounding)
    if (initialScrollHeightRef.current) {
      const actualHeight = parseFloat(inputRef.current.style.height) || inputRef.current.scrollHeight;
      const diff = Math.abs(actualHeight - initialScrollHeightRef.current);
      if (diff > 1) {
        // Force to initial height if there's a mismatch
      inputRef.current.style.height = 'auto';
        void inputRef.current.offsetHeight;
        inputRef.current.style.height = `${initialScrollHeightRef.current}px`;
      }
    }
  }, []);

  // Shared onChange handler for text organization logic
  // This ensures both textareas (single-line and multi-line) use the same logic
  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    // Preserve cursor position before state update
    const cursorPos = e.target.selectionStart;
    
    setSearchValue(value);
    
    // If value is empty, reverse all changes back to initial state
    // BUT keep the attachment - only clear it if user explicitly removes it
    if (!value.trim()) {
      // Reverse state changes
      setIsMultiLine(false);
      setIsSubmitted(false);
      setHasStartedTyping(false);
      // Don't clear attachment here - let user remove it explicitly
      // setAttachedFile(null);
      
      // Clear timeouts
      if (queryStartTimeoutRef.current) {
        clearTimeout(queryStartTimeoutRef.current);
        queryStartTimeoutRef.current = null;
      }
      
      // Wait for React to switch to single-line textarea, then reset it
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (inputRef.current && !inputRef.current.closest('.hidden')) {
            // Reverse DOM changes: undo what we did when entering multi-line
            const initialHeight = initialScrollHeightRef.current ?? 28.1;
            inputRef.current.style.height = `${initialHeight}px`;
            inputRef.current.style.overflowY = '';
            inputRef.current.style.overflow = '';
            
            // Restore cursor position after reset
            if (cursorPos !== null) {
              inputRef.current.setSelectionRange(cursorPos, cursorPos);
            }
          }
        });
      });
      return;
    }
    
    // Simple character-count based logic
    const charCount = value.trim().length;
    const multiLineCharThreshold = 40; // Switch to multi-line at 40 characters
    const singleLineCharThreshold = 35; // Switch back to single-line at 35 characters (hysteresis)
    
    // Determine if we should be in multi-line mode
    let shouldBeMultiLine = false;
    if (isMultiLine) {
      // Already in multi-line: only exit if character count is below single-line threshold
      shouldBeMultiLine = charCount >= singleLineCharThreshold;
    } else {
      // Not in multi-line: only enter if character count reaches multi-line threshold
      shouldBeMultiLine = charCount >= multiLineCharThreshold;
    }
    
    // Text organization logic
    if (shouldBeMultiLine && !isMultiLine) {
      // Entering multi-line: set state first
      setIsMultiLine(true);
      // Then adjust height and restore cursor after React switches to multi-line textarea
      // Use requestAnimationFrame to ensure smooth transition
      requestAnimationFrame(() => {
        if (inputRef.current) {
          // Adjust height - let CSS transition handle the animation
          inputRef.current.style.height = 'auto';
          const scrollHeight = inputRef.current.scrollHeight;
          const maxHeight = 350;
          const newHeight = Math.min(scrollHeight, maxHeight);
          inputRef.current.style.height = `${newHeight}px`;
          // Always allow scrolling when content exceeds maxHeight
          inputRef.current.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
          // Ensure the textarea doesn't collapse
          inputRef.current.style.minHeight = '28.1px';
          
          // Restore cursor position to end (where user was typing)
          if (cursorPos !== null) {
            const targetPos = Math.min(cursorPos, value.length);
            inputRef.current.setSelectionRange(targetPos, targetPos);
            inputRef.current.focus();
          }
        }
      });
    } else if (inputRef.current) {
      if (!shouldBeMultiLine && isMultiLine) {
        // Exiting multi-line: return to opening state
        // Preserve cursor position and focus state before transition
        const savedCursorPos = cursorPos;
        const wasFocused = document.activeElement === inputRef.current;
        
        // Mark that we're in a deletion operation
        isDeletingRef.current = true;
        
        // Use flushSync to make state update synchronous and prevent keydown interruption
        flushSync(() => {
          setIsMultiLine(false);
        });
        
        // Immediately restore focus and cursor synchronously after state update
        // Use the ref directly - no need to query DOM
        if (inputRef.current) {
          // Return to initial height (like on mount) - let CSS transition handle the animation
          const initialHeight = initialScrollHeightRef.current ?? 28.1;
          // Use requestAnimationFrame to ensure transition applies smoothly
          requestAnimationFrame(() => {
            if (inputRef.current) {
              inputRef.current.style.height = `${initialHeight}px`;
              // Remove overflow styles (back to CSS defaults)
              inputRef.current.style.overflowY = '';
              inputRef.current.style.overflow = '';
            }
          });
          
          // Immediately restore focus and cursor to continue deletion - no delays
          if (wasFocused) {
            inputRef.current.focus();
          }
          if (savedCursorPos !== null) {
            const targetPos = Math.min(savedCursorPos, value.length);
            inputRef.current.setSelectionRange(targetPos, targetPos);
          }
        }
        
        // Reset deletion flag after a brief moment
        setTimeout(() => {
          isDeletingRef.current = false;
        }, 50); // Reduced from 100ms
      } else if (shouldBeMultiLine && isMultiLine) {
        // Already in multi-line: update height as text grows
        // Use direct synchronous update for better performance during deletion
        if (inputRef.current) {
          inputRef.current.style.height = 'auto';
          const scrollHeight = inputRef.current.scrollHeight;
          const maxHeight = 350;
          const newHeight = Math.min(scrollHeight, maxHeight);
          inputRef.current.style.height = `${newHeight}px`;
          // Always allow scrolling when content exceeds maxHeight
          inputRef.current.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
          // Ensure the textarea doesn't collapse
          inputRef.current.style.minHeight = '28.1px';
        }
      }
      
      // Only restore cursor position if not in deletion mode (to avoid delays)
      if (!isDeletingRef.current && inputRef.current && cursorPos !== null) {
        inputRef.current.setSelectionRange(cursorPos, cursorPos);
      }
    }
    
    if (value.trim() && !hasStartedTyping) {
      setHasStartedTyping(true);
    } else if (!value.trim()) {
      setHasStartedTyping(false);
    }
    
    if (queryStartTimeoutRef.current) {
      clearTimeout(queryStartTimeoutRef.current);
    }
    
    if (value.trim()) {
      queryStartTimeoutRef.current = setTimeout(() => {
        onQueryStart?.(value.trim());
      }, 50);
    }
  }, [isMultiLine, hasStartedTyping, resetToInitialState, resetTextareaToInitial, onQueryStart]);


  // Maintain focus during multi-line transition to allow continuous typing/deleting
  useLayoutEffect(() => {
    // Find the visible textarea (not hidden)
    const allTextareas = document.querySelectorAll('textarea[key="textarea-single-instance"]');
    let visibleTextarea: HTMLTextAreaElement | null = null;
    
    for (const textarea of allTextareas) {
      if (!textarea.closest('.hidden')) {
        visibleTextarea = textarea as HTMLTextAreaElement;
        break;
      }
    }
    
    // Fallback to inputRef
    if (!visibleTextarea && inputRef.current && !inputRef.current.closest('.hidden')) {
      visibleTextarea = inputRef.current;
    }
    
    if (visibleTextarea && (isFocused || isDeletingRef.current)) {
      // Use useLayoutEffect for immediate focus restoration (runs synchronously after DOM updates)
      if (document.activeElement !== visibleTextarea) {
        visibleTextarea.focus();
        // Preserve cursor position
        const cursorPos = visibleTextarea.selectionStart;
        if (cursorPos !== null) {
          visibleTextarea.setSelectionRange(cursorPos, cursorPos);
        }
      }
    }
  }, [isMultiLine, isFocused]);

  const handleFileUpload = useCallback((file: File) => {
    console.log('📎 SearchBar: handleFileUpload called with file:', file.name);
    
    // Check if we've reached the maximum number of files
    if (attachedFiles.length >= MAX_FILES) {
      console.warn(`⚠️ Maximum of ${MAX_FILES} files allowed`);
      toast({
        description: `Maximum of ${MAX_FILES} files allowed. Please remove a file before adding another.`,
        duration: 3000,
      });
      return;
    }
    
    const fileData: FileAttachmentData = {
      id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      name: file.name,
      type: file.type,
      size: file.size
    };
    
    // Preload blob URL immediately (Instagram-style preloading)
    // This ensures instant preview when user clicks the attachment
    const preloadBlobUrl = () => {
      try {
        console.log('🚀 Preloading blob URL for attachment:', file.name);
        const blobUrl = URL.createObjectURL(file);
        
        // Store preloaded blob URL in global cache
        if (!(window as any).__preloadedAttachmentBlobs) {
          (window as any).__preloadedAttachmentBlobs = {};
        }
        (window as any).__preloadedAttachmentBlobs[fileData.id] = blobUrl;
        
        console.log(`✅ Preloaded blob URL for attachment ${fileData.id}`);
      } catch (error) {
        console.error('❌ Error preloading blob URL:', error);
        // Don't throw - preloading failure shouldn't block file attachment
      }
    };
    
    // Preload immediately (don't await - let it happen in background)
    preloadBlobUrl();
    
    setAttachedFiles(prev => [...prev, fileData]);
    console.log('✅ SearchBar: File attached:', fileData, `(${attachedFiles.length + 1}/${MAX_FILES})`);
    // Also call onFileDrop prop if provided (for drag-and-drop from parent)
    onFileDrop?.(file);
  }, [onFileDrop, attachedFiles.length]);

  // Expose handleFileDrop via ref for drag-and-drop
  useImperativeHandle(ref, () => {
    console.log('🔗 SearchBar: useImperativeHandle called, exposing handleFileDrop');
    const exposed = {
    handleFileDrop: handleFileUpload
    };
    console.log('🔗 SearchBar: Exposed object:', exposed);
    return exposed;
  }, [handleFileUpload]);

  // Verify ref is set after mount
  useEffect(() => {
    if (ref && typeof ref !== 'function') {
      console.log('✅ SearchBar: Ref is available after mount:', !!ref.current);
    }
  }, [ref]);

  const handleRemoveFile = (id: string) => {
    // Clean up preloaded blob URL when file is removed
    const preloadedBlobUrl = (window as any).__preloadedAttachmentBlobs?.[id];
    if (preloadedBlobUrl) {
      try {
        URL.revokeObjectURL(preloadedBlobUrl);
        delete (window as any).__preloadedAttachmentBlobs[id];
        console.log('🧹 Cleaned up preloaded blob URL for attachment:', id);
      } catch (error) {
        console.error('Error cleaning up blob URL:', error);
      }
    }
    
    setAttachedFiles(prev => prev.filter(file => file.id !== id));
    // Remove from preview tabs if it was open
    setPreviewFiles(prev => {
      const newFiles = prev.filter(f => f.id !== id);
      if (newFiles.length === 0) {
        setIsPreviewOpen(false);
        setActivePreviewTabIndex(0);
      } else if (activePreviewTabIndex >= newFiles.length) {
        setActivePreviewTabIndex(newFiles.length - 1);
      }
      return newFiles;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitted = searchValue.trim();
    if ((submitted || attachedFiles.length > 0) && !isSubmitted) {
      setIsSubmitted(true);
      
      // TODO: Include file in search when backend is ready
      onSearch?.(submitted);
      
      // Reset the search bar state after submission
      setTimeout(() => {
        setSearchValue('');
        setIsSubmitted(false);
        setHasStartedTyping(false);
        setAttachedFiles([]);
      }, 100);
    }
  };
  
  return (
    <motion.div 
      className={`${className || ''} ${
        contextConfig.position === "bottom" 
          ? "fixed bottom-5 left-1/2 transform -translate-x-1/2 z-40" 
          : "w-full flex justify-center px-6"
      }`}
      style={{
        ...(contextConfig.position !== "bottom" && { 
          height: 'auto', 
          minHeight: 'fit-content',
          alignItems: 'center',
          paddingTop: '0',
          paddingBottom: '0'
        }),
        overflow: 'visible'
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="w-full mx-auto" style={{ 
        maxWidth: contextConfig.maxWidth, 
        minWidth: isMapVisible ? '700px' : '400px' 
      }}>
        <form onSubmit={handleSubmit} className="relative" style={{ overflow: 'visible', height: 'auto', width: '100%' }}>
            <motion.div 
            layout
            className={`relative flex flex-col ${isSubmitted ? 'opacity-75' : ''}`}
              style={{
                background: '#ffffff',
                border: '1px solid #E5E7EB',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
              paddingTop: isMultiLine ? '16px' : '14px',
              paddingBottom: isMultiLine ? '12px' : '14px',
              paddingRight: '24px',
              willChange: 'border-radius, padding-left, padding-top, padding-bottom, height',
              overflow: 'visible',
              width: '100%',
              height: 'auto',
              minHeight: 'fit-content',
              borderRadius: hasContent
                ? '12px' // ChatGPT-style rounded corners when there's content or attachment
                : contextConfig.isSquare 
                  ? '8px' // Square corners for dashboard view
                  : '9999px' // Fully rounded for map/chat view when no content
            }}
            animate={{
              paddingLeft: attachedFiles.length > 0 ? '24px' : '36px',
              paddingTop: isMultiLine ? '16px' : '14px',
              paddingBottom: isMultiLine ? '12px' : '14px',
              borderRadius: hasContent
                ? '12px' // ChatGPT-style rounded corners when there's content or attachment
                : contextConfig.isSquare 
                  ? '8px' // Square corners for dashboard view
                  : '9999px', // Fully rounded for map/chat view when no content
              height: 'auto'
            }}
            transition={{ 
              paddingLeft: {
                duration: (!searchValue.trim() && attachedFiles.length > 0) ? 0 : 0.3, // Instant when text deleted with attachment
                ease: [0.4, 0, 0.2, 1]
              },
              paddingTop: {
                duration: (!searchValue.trim() && !isMultiLine) || (!searchValue.trim() && attachedFiles.length > 0) ? 0 : 0.2, // Instant when resetting or when text deleted with attachment
                ease: [0.4, 0, 0.2, 1]
              },
              paddingBottom: {
                duration: (!searchValue.trim() && !isMultiLine) || (!searchValue.trim() && attachedFiles.length > 0) ? 0 : 0.2, // Instant when resetting or when text deleted with attachment
                ease: [0.4, 0, 0.2, 1]
              },
              borderRadius: {
                duration: (!searchValue.trim() && attachedFiles.length > 0) ? 0 : 0.25, // Instant when text deleted with attachment
                ease: [0.4, 0, 0.2, 1]
              },
              layout: {
                duration: (!searchValue.trim() && attachedFiles.length > 0) ? 0 : 0.3, // Instant when text deleted with attachment
                ease: [0.4, 0, 0.2, 1]
              }
            }}
          >
            {/* File Attachments Display - Inside search bar container, top-left */}
            <AnimatePresence mode="wait">
              {attachedFiles.length > 0 && (
                <motion.div 
                  initial={false}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ 
                    duration: 0.1,
                    ease: "easeOut"
                  }}
                  style={{ height: 'auto' }}
                  className="mb-4 flex flex-wrap gap-2 justify-start"
                  layout={false}
                >
                  {attachedFiles.map((file) => (
                  <FileAttachment
                      key={file.id}
                      attachment={file}
                    onRemove={handleRemoveFile}
                    onPreview={(file) => {
                      // Use shared preview context to add file (will add to existing preview if open)
                      addPreviewFile(file);
                    }}
                  />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
            
            {/* Input row - ONE textarea that changes position based on multi-line state */}
            <motion.div 
              className={`relative flex ${isMultiLine ? 'flex-col' : 'items-end'} w-full`} 
              style={{ height: 'auto', minHeight: '28.1px' }}
              layout
              transition={{ 
                duration: !searchValue.trim() ? 0 : 0.2, 
                ease: [0.4, 0, 0.2, 1] 
              }}
            >
              {/* Top row for multi-line: textarea spans full width */}
              {isMultiLine && (
                <motion.div 
                  className="flex items-start w-full mb-2"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                  style={{ minHeight: '28.1px' }}
                >
                  <div className="flex-1 relative flex items-start" style={{ overflow: 'visible', minHeight: '28.1px' }}>
                    {/* ONE textarea - always rendered, never recreated, never unmounted */}
                    <motion.textarea 
                      key="textarea-single-instance"
                      layout={false}
                      ref={inputRef}
                      value={searchValue}
                      onChange={handleTextareaChange}
                      onFocus={() => setIsFocused(true)} 
                      onBlur={() => setIsFocused(false)} 
                      onKeyDown={e => { 
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSubmit(e);
                        }
                        // Track if delete/backspace is being held
                        if (e.key === 'Backspace' || e.key === 'Delete') {
                          isDeletingRef.current = true;
                          setTimeout(() => {
                            isDeletingRef.current = false;
                          }, 200);
                        }
                      }} 
                      placeholder={contextConfig.placeholder}
                      className="w-full bg-transparent focus:outline-none text-base font-normal text-gray-900 placeholder:text-gray-500 resize-none [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200/50 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:hover:bg-gray-300/70 transition-all duration-200 ease-out"
                      style={{
                        minHeight: '28.1px',
                        maxHeight: '350px',
                        fontSize: '16px',
                        lineHeight: '22px',
                        paddingTop: '0px',
                        paddingBottom: '0px',
                        paddingRight: '24px',
                        scrollbarWidth: 'thin',
                        scrollbarColor: 'rgba(229, 231, 235, 0.5) transparent',
                        overflow: 'hidden',
                        overflowY: 'auto',
                        wordWrap: 'break-word',
                        transition: !searchValue.trim() ? 'none' : 'height 0.2s ease-out, overflow 0.2s ease-out',
                        resize: 'none'
                      }}
                      autoComplete="off"
                      disabled={isSubmitted}
                      rows={1}
                    />
                  </div>
                </motion.div>
              )}
              
              {/* Single-line or bottom row: map icon, text, and icons */}
              <motion.div 
                className={`relative flex ${isMultiLine ? 'items-end justify-end space-x-3 w-full' : 'items-end w-full'}`}
                layout
                transition={{ 
                  duration: !searchValue.trim() ? 0 : 0.2, 
                  ease: [0.4, 0, 0.2, 1] 
                }}
              >
                {/* Map Toggle Button */}
              {contextConfig.showMapToggle && (
                <motion.button 
                  type="button" 
                  onClick={(e) => {
                    console.log('🗺️ Map button clicked!', { 
                      hasOnMapToggle: !!onMapToggle,
                      currentVisibility: isMapVisible 
                    });
                    onMapToggle?.();
                  }}
                    className={`flex-shrink-0 ${isMultiLine ? '' : 'mr-6'} flex items-center justify-center w-7 h-7 transition-colors duration-200 focus:outline-none outline-none ${
                    isMapVisible 
                        ? 'text-slate-500 hover:text-blue-500'
                        : 'text-slate-500 hover:text-green-500'
                    } self-end`}
                    initial={{ y: -2.3 }}
                    animate={{ y: -2.3 }}
                  title={isMapVisible ? "Back to search mode" : "Go to map mode"}
                  whileHover={{ 
                    scale: 1.05,
                      rotate: 2,
                      y: -2.3
                  }}
                  whileTap={{ 
                    scale: 0.95,
                      rotate: -2,
                      y: -2.3
                  }}
                  transition={{
                    duration: !searchValue.trim() ? 0 : 0.15,
                    ease: "easeOut"
                  }}
                >
                    {isMapVisible ? (
                      <LayoutDashboard className="w-[21px] h-[21px]" strokeWidth={1.5} />
                    ) : (
                      <Map className="w-[21px] h-[21px]" strokeWidth={1.5} />
                    )}
                </motion.button>
              )}
              
                {/* ONE textarea for single-line layout - SAME INSTANCE as above, React reuses it via key */}
                {!isMultiLine && (
                  <div className="flex-1 relative flex items-end" style={{ overflow: 'visible' }}>
                    <motion.textarea 
                      key="textarea-single-instance"
                      layout={false}
                  ref={inputRef}
                  value={searchValue} 
                      onChange={handleTextareaChange}
                  onFocus={() => setIsFocused(true)} 
                  onBlur={() => setIsFocused(false)} 
                    onKeyDown={e => { 
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit(e);
                      }
                        // Track if delete/backspace is being held
                        if (e.key === 'Backspace' || e.key === 'Delete') {
                          isDeletingRef.current = true;
                          setTimeout(() => {
                            isDeletingRef.current = false;
                          }, 200);
                      }
                    }} 
                  placeholder={contextConfig.placeholder}
                      className="w-full bg-transparent focus:outline-none text-base font-normal text-gray-900 placeholder:text-gray-500 resize-none [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200/50 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:hover:bg-gray-300/70 transition-all duration-200 ease-out"
                    style={{
                      minHeight: '28.1px',
                      maxHeight: '350px',
                      fontSize: '16px',
                      lineHeight: '22px',
                      paddingTop: '0px',
                      paddingBottom: '0px',
                      paddingRight: '16px',
                      scrollbarWidth: 'thin',
                      scrollbarColor: '#D1D5DB transparent',
                      overflow: 'visible',
                      overflowY: 'visible',
                        verticalAlign: 'bottom',
                        transition: 'height 0.2s ease-out, overflow 0.2s ease-out'
                    }}
                  autoComplete="off" 
                  disabled={isSubmitted}
                    rows={1}
                />
              </div>
                )}
              
                <div className={`flex items-end space-x-3 ${isMultiLine ? '' : 'ml-4'} self-end`}>
                {contextConfig.showMic && (
                  <ImageUploadButton
                    onImageUpload={(query) => {
                      setSearchValue(query);
                      onSearch?.(query);
                    }}
                      onFileUpload={handleFileUpload}
                    size="md"
                  />
                )}
                  
                  {contextConfig.showMic && (
                    <motion.button
                      type="button"
                      onClick={() => {}}
                      className="flex items-center justify-center w-7 h-7 text-black hover:text-gray-700 transition-colors focus:outline-none outline-none"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <Mic className="w-5 h-5" strokeWidth={1.5} />
                    </motion.button>
                  )}
                
                <motion.button 
                  type="submit" 
                  onClick={handleSubmit} 
                  className={`flex items-center justify-center relative focus:outline-none outline-none ${!isSubmitted ? '' : 'cursor-not-allowed'}`}
                  style={{
                    width: '32px',
                    height: '32px',
                    minWidth: '32px',
                    minHeight: '32px',
                    borderRadius: '50%'
                  }}
                  animate={{
                      backgroundColor: (searchValue.trim() || attachedFiles.length > 0) ? '#415C85' : 'transparent'
                  }}
                    disabled={isSubmitted || (!searchValue.trim() && attachedFiles.length === 0)}
                    whileHover={(!isSubmitted && (searchValue.trim() || attachedFiles.length > 0)) ? { 
                    scale: 1.05
                  } : {}}
                    whileTap={(!isSubmitted && (searchValue.trim() || attachedFiles.length > 0)) ? { 
                    scale: 0.95
                  } : {}}
                  transition={{
                    duration: !searchValue.trim() ? 0 : 0.2,
                    ease: [0.16, 1, 0.3, 1]
                  }}
                >
                  <motion.div
                    key="chevron-right"
                    initial={{ opacity: 1 }}
                      animate={{ opacity: (searchValue.trim() || attachedFiles.length > 0) ? 0 : 1 }}
                    transition={{
                      duration: !searchValue.trim() ? 0 : 0.2,
                      ease: [0.16, 1, 0.3, 1]
                    }}
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ pointerEvents: 'none' }}
                  >
                    <ChevronRight className="w-6 h-6" strokeWidth={1.5} style={{ color: '#6B7280' }} />
                  </motion.div>
                  <motion.div
                    key="arrow-up"
                    initial={{ opacity: 0 }}
                      animate={{ opacity: (searchValue.trim() || attachedFiles.length > 0) ? 1 : 0 }}
                    transition={{
                      duration: !searchValue.trim() ? 0 : 0.2,
                      ease: [0.16, 1, 0.3, 1]
                    }}
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ pointerEvents: 'none' }}
                  >
                    <ArrowUp className="w-4 h-4" strokeWidth={2.5} style={{ color: '#ffffff' }} />
                  </motion.div>
                </motion.button>
                </div>
              </motion.div>
            </motion.div>
            </motion.div>
          </form>
      </div>
      {/* Document Preview Modal is now rendered at MainContent level using shared context */}
    </motion.div>
  );
});
"use client";

import * as React from "react";
import { useState, useRef, useEffect, useLayoutEffect, useImperativeHandle, forwardRef, useCallback } from "react";
import { flushSync } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Map, ArrowUp, LayoutDashboard, Mic, PanelRightOpen, SquareDashedMousePointer, Scan, Fullscreen, X, Brain, MoveDiagonal, Workflow } from "lucide-react";
import { ImageUploadButton } from './ImageUploadButton';
import { FileAttachment, FileAttachmentData } from './FileAttachment';
import { PropertyAttachment } from './PropertyAttachment';
import { toast } from "@/hooks/use-toast";
import { usePreview } from '../contexts/PreviewContext';
import { usePropertySelection } from '../contexts/PropertySelectionContext';
import { useDocumentSelection } from '../contexts/DocumentSelectionContext';

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
  // MapChatBar functionality
  onPanelToggle?: () => void;
  hasPreviousSession?: boolean;
  isPropertyDetailsOpen?: boolean;
  initialValue?: string; // undefined means no initial value, empty string means clear
  initialAttachedFiles?: FileAttachmentData[]; // Preserve file attachments when switching views
  onAttachmentsChange?: (attachments: FileAttachmentData[]) => void; // Callback when attachments change
  onQuickStartToggle?: () => void; // Callback to toggle QuickStartBar
  isQuickStartBarVisible?: boolean; // Whether QuickStartBar is currently visible
}

export const SearchBar = forwardRef<{ handleFileDrop: (file: File) => void; getValue: () => string; getAttachments: () => FileAttachmentData[] }, SearchBarProps>(({
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
  onFileDrop,
  onPanelToggle,
  hasPreviousSession = false,
  isPropertyDetailsOpen = false,
  initialValue,
  initialAttachedFiles,
  onAttachmentsChange,
  onQuickStartToggle,
  isQuickStartBarVisible = false
}, ref) => {
  console.log('🎯 SearchBar component rendering/mounting', {
    initialValue,
    isMapVisible,
    currentView
  });
  // Track if we're restoring a value (to set cursor position)
  const isRestoringValueRef = useRef(false);
  // Track if we've initialized attachments from prop to avoid resetting on remounts
  // Reset this on unmount to allow re-initialization on remount
  const hasInitializedAttachmentsRef = useRef(false);
  
  // Reset initialization flag when component unmounts or when initialAttachedFiles becomes undefined
  useEffect(() => {
    return () => {
      // Reset on unmount to allow fresh initialization on next mount
      hasInitializedAttachmentsRef.current = false;
    };
  }, []);
  // Initialize searchValue from initialValue prop if provided
  // Use a ref to track the last initialValue to prevent unnecessary resets
  const lastInitialValueRef = useRef<string | undefined>(initialValue);
  const [searchValue, setSearchValue] = useState(() => {
    const initial = initialValue !== undefined ? initialValue : '';
    lastInitialValueRef.current = initialValue;
    // If we have an initial value, mark that we're restoring
    if (initialValue !== undefined && initialValue !== '') {
      isRestoringValueRef.current = true;
    }
    return initial;
  });
  
  // Update lastInitialValueRef when initialValue changes
  useEffect(() => {
    if (initialValue !== lastInitialValueRef.current) {
      lastInitialValueRef.current = initialValue;
    }
  }, [initialValue]);
  const [isFocused, setIsFocused] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [hasStartedTyping, setHasStartedTyping] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  // Initialize attachedFiles from initialAttachedFiles prop if provided
  const [attachedFiles, setAttachedFiles] = useState<FileAttachmentData[]>(() => {
    const initial = initialAttachedFiles || [];
    if (initialAttachedFiles !== undefined && initialAttachedFiles.length > 0) {
      hasInitializedAttachmentsRef.current = true;
    }
    return initial;
  });
  
  // Ref to store attachments for synchronous access (always up-to-date)
  const attachedFilesRef = useRef<FileAttachmentData[]>(attachedFiles);
  
  // Keep ref in sync with state and notify parent of changes
  useEffect(() => {
    attachedFilesRef.current = attachedFiles;
    // Notify parent component when attachments change (for proactive storage)
    if (onAttachmentsChange) {
      onAttachmentsChange(attachedFiles);
    }
  }, [attachedFiles, onAttachmentsChange]);
  const MAX_FILES = 4;
  // Default to multi-line mode in dashboard view (like MapChatBar), always multi-line in map view
  const [isMultiLine, setIsMultiLine] = useState(() => !isMapVisible && !isInChatMode);
  
  // Update multi-line mode when context changes
  useEffect(() => {
    if (!isMapVisible && !isInChatMode) {
      // Dashboard view: always multi-line
      setIsMultiLine(true);
    } else if (isMapVisible) {
      // Map view: always multi-line (like MapChatBar)
      setIsMultiLine(true);
    } else {
      // Chat view: start in single-line, switch to multi-line based on content
      setIsMultiLine(false);
    }
  }, [isMapVisible, isInChatMode]);
  
  // Set cursor to end when searchValue is set from initialValue on mount or when restored
  useEffect(() => {
    if (isRestoringValueRef.current && searchValue && inputRef.current) {
      const textLength = searchValue.length;
      // Use setTimeout to ensure React has finished rendering
      const timeoutId = setTimeout(() => {
        if (inputRef.current && inputRef.current.value === searchValue) {
          // Set cursor to end
          inputRef.current.setSelectionRange(textLength, textLength);
          // Don't auto-focus, let user click if they want
          isRestoringValueRef.current = false;
        }
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [searchValue]);

  // Track previous initialAttachedFiles to detect prop changes
  const prevInitialAttachedFilesRef = useRef<FileAttachmentData[] | undefined>(initialAttachedFiles);
  
  // Update attachedFiles when initialAttachedFiles prop changes (e.g., when switching views)
  // Use useLayoutEffect for immediate restoration before render
  useLayoutEffect(() => {
    const prevInitial = prevInitialAttachedFilesRef.current;
    prevInitialAttachedFilesRef.current = initialAttachedFiles;
    
    if (initialAttachedFiles !== undefined) {
      // Compare by IDs instead of JSON.stringify (File objects can't be stringified)
      const currentIds = attachedFiles.map(f => f.id).sort().join(',');
      const newIds = initialAttachedFiles.map(f => f.id).sort().join(',');
      const isDifferent = currentIds !== newIds || attachedFiles.length !== initialAttachedFiles.length;
      const propChanged = prevInitial !== initialAttachedFiles;
      
      // Always restore if:
      // 1. We haven't initialized yet, OR
      // 2. The attachments are different, OR
      // 3. Current attachments are empty but we have initialAttachedFiles (CRITICAL: always restore if empty), OR
      // 4. The prop changed (component remounted with new prop), OR
      // 5. We have initialAttachedFiles but current is empty (CRITICAL for restoration)
      const shouldRestore = !hasInitializedAttachmentsRef.current || 
                           isDifferent || 
                           (attachedFiles.length === 0 && initialAttachedFiles.length > 0) ||
                           (propChanged && initialAttachedFiles.length > 0) ||
                           (initialAttachedFiles.length > 0 && attachedFiles.length === 0);
      
      if (shouldRestore) {
        setAttachedFiles(initialAttachedFiles);
        attachedFilesRef.current = initialAttachedFiles; // Update ref immediately
        hasInitializedAttachmentsRef.current = true;
      }
    } else if (initialAttachedFiles === undefined) {
      // If initialAttachedFiles is explicitly undefined, preserve existing attachments
      // This prevents clearing on remounts when switching views
    }
  }, [initialAttachedFiles]);

  // Update searchValue when initialValue prop changes (e.g., when switching from dashboard to map view)
  const prevInitialValueRef = useRef<string | undefined>(initialValue);
  useEffect(() => {
    const prevInitialValue = prevInitialValueRef.current;
    prevInitialValueRef.current = initialValue;
    
    // Handle both undefined (no initial value) and empty string (clear value)
    // If we have an initialValue and it's different from current, update
    // This is important for remounts - useState only initializes on first mount
    if (initialValue !== undefined) {
      const shouldUpdate = initialValue !== searchValue;
      if (shouldUpdate) {
        // Mark that we're restoring a value
        isRestoringValueRef.current = true;
        setSearchValue(initialValue);
        lastInitialValueRef.current = initialValue;
        // Resize textarea after setting value
        if (inputRef.current) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (inputRef.current) {
                inputRef.current.style.height = 'auto';
                const scrollHeight = inputRef.current.scrollHeight;
                const maxHeight = 350;
                const newHeight = Math.min(scrollHeight, maxHeight);
                inputRef.current.style.height = `${newHeight}px`;
                inputRef.current.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
                inputRef.current.style.minHeight = '28.1px';
              }
            });
          });
        }
      }
    }
  }, [initialValue, isMapVisible, currentView]);
  
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
  
  // Use property selection context
  const { 
    isSelectionModeActive, 
    toggleSelectionMode, 
    setSelectionModeActive,
    propertyAttachments, 
    removePropertyAttachment,
    clearPropertyAttachments 
  } = usePropertySelection();
  
  // Use document selection context (for document selection like SideChatPanel)
  const {
    selectedDocumentIds,
    isDocumentSelectionMode,
    toggleDocumentSelectionMode,
    clearSelectedDocuments,
    setDocumentSelectionMode
  } = useDocumentSelection();
  
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const queryStartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const multiLineTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initialScrollHeightRef = useRef<number | null>(null);
  const isDeletingRef = useRef(false);
  
  // Track viewport size to adjust font size and padding on very small screens
  const [viewportWidth, setViewportWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth;
    }
    return 1024;
  });
  
  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // Determine if we should use rounded corners (when there's content or attachment)
  const hasContent = searchValue.trim().length > 0 || attachedFiles.length > 0 || propertyAttachments.length > 0;
  
  // Adjust font size and padding on very small screens to ensure placeholder text fits
  // Use a more aggressive threshold to catch smaller screens
  const isVerySmallScreen = viewportWidth < 600;
  // Further reduce font size on extremely small screens to ensure placeholder text fits
  const isExtremelySmall = viewportWidth < 400;
  const fontSize = isExtremelySmall ? '12px' : (isVerySmallScreen ? '13px' : 'clamp(14px, 2vw, 16px)');
  const lineHeight = isExtremelySmall ? '16px' : (isVerySmallScreen ? '18px' : 'clamp(20px, 2.75vw, 22px)');
  const paddingLeft = isExtremelySmall
    ? (attachedFiles.length > 0 ? '8px' : '12px')
    : (isVerySmallScreen 
      ? (attachedFiles.length > 0 ? '10px' : '14px')
      : (attachedFiles.length > 0 ? 'clamp(12px, 3vw, 24px)' : 'clamp(18px, 4vw, 36px)'));
  const paddingRight = isExtremelySmall ? '8px' : (isVerySmallScreen ? '10px' : 'clamp(12px, 3vw, 24px)');

  // Context-aware configuration
  const getContextConfig = () => {
    // Determine placeholder based on document selection
    const getPlaceholder = () => {
      if (selectedDocumentIds.size > 0) {
        return `Searching in ${selectedDocumentIds.size} selected document${selectedDocumentIds.size > 1 ? 's' : ''}...`;
      }
      
      if (isMapVisible) {
        return "Search for properties";
      } else if (isInChatMode) {
        return "Ask anything...";
      } else {
        return "Search for anything";
      }
    };
    
    if (isMapVisible) {
      return {
        placeholder: getPlaceholder(),
        showMapToggle: true, // Always show map toggle
        showMic: true, // Show paperclip icon in map view too
        position: "bottom", // Always bottom when map is visible
        glassmorphism: true,
        maxWidth: 'clamp(450px, 90vw, 700px)', // Same width as dashboard for consistency, min 450px to ensure full placeholder text is always visible
        greenGlow: true, // Add green glow for map mode
        isSquare: true // Square corners for map mode
      };
    } else if (isInChatMode) {
      return {
        placeholder: getPlaceholder(),
        showMapToggle: true,
        showMic: true,
        position: "center", // Always center
        glassmorphism: false,
        maxWidth: 'clamp(350px, 90vw, 600px)', // Responsive: min 350px to ensure full placeholder text is visible, max 600px
        greenGlow: false,
        isSquare: false // Keep rounded for chat mode
      };
    } else {
      // Dashboard view - square corners
      // On very small screens, use a more flexible width to ensure placeholder text fits
      const flexibleMaxWidth = isVerySmallScreen 
        ? 'min(100%, calc(100vw - 32px))' // On very small screens, use almost full width minus minimal padding
        : 'clamp(350px, 90vw, 700px)'; // Normal screens: min 350px (reduced since placeholder is shorter), max 700px
      
      return {
        placeholder: getPlaceholder(),
        showMapToggle: true,
        showMic: true,
        position: "center", // Always center
        glassmorphism: false,
        maxWidth: flexibleMaxWidth,
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
  // But preserve value if we have an initialValue that should be preserved
  const prevResetTriggerRef = useRef<number | undefined>(resetTrigger);
  useEffect(() => {
    if (resetTrigger !== undefined && resetTrigger !== prevResetTriggerRef.current) {
      prevResetTriggerRef.current = resetTrigger;
      
      // Only clear if we don't have an initialValue to preserve
      // This prevents clearing when switching views
      if (initialValue === undefined || initialValue === '') {
        setSearchValue('');
        setIsSubmitted(false);
        setHasStartedTyping(false);
        setIsFocused(false);
        // Only clear attachments if we don't have initialAttachedFiles to preserve
        if (initialAttachedFiles === undefined || initialAttachedFiles.length === 0) {
          setAttachedFiles([]);
          attachedFilesRef.current = []; // Update ref immediately
        } else {
          setAttachedFiles(initialAttachedFiles);
          attachedFilesRef.current = initialAttachedFiles; // Update ref immediately
        }
      } else {
        setSearchValue(initialValue);
        // Also preserve attachments if initialAttachedFiles is provided
        if (initialAttachedFiles !== undefined && initialAttachedFiles.length > 0) {
          setAttachedFiles(initialAttachedFiles);
          attachedFilesRef.current = initialAttachedFiles; // Update ref immediately
        }
      }
      
      // Preserve multi-line mode in dashboard view
      if (!isMapVisible && !isInChatMode) {
        setIsMultiLine(true);
      } else {
        setIsMultiLine(false);
      }
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
  }, [resetTrigger, initialValue, isMapVisible, isInChatMode]);
  
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
    // Preserve multi-line mode in dashboard view
    if (!isMapVisible && !isInChatMode) {
      setIsMultiLine(true);
    } else {
      setIsMultiLine(false);
    }
    setIsSubmitted(false);
    setHasStartedTyping(false);
    setAttachedFiles([]);
    attachedFilesRef.current = []; // Update ref immediately
    
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
  }, [isMapVisible, isInChatMode]);

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
    // Clear restore flag when user types
    isRestoringValueRef.current = false;
    const value = e.target.value;
    // Preserve cursor position before state update
    const cursorPos = e.target.selectionStart;
    
    setSearchValue(value);
    
    // If value is empty, reverse all changes back to initial state
    // BUT keep the attachment - only clear it if user explicitly removes it
    if (!value.trim()) {
      // Reverse state changes
      // Preserve multi-line mode in dashboard view
      if (!isMapVisible && !isInChatMode) {
        setIsMultiLine(true);
      } else {
        setIsMultiLine(false);
      }
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
    
    // Dashboard view: always multi-line (like MapChatBar)
    // Map/Chat view: use character-count based logic
    let shouldBeMultiLine = false;
    if (!isMapVisible && !isInChatMode) {
      // Dashboard view: always multi-line
      shouldBeMultiLine = true;
    } else {
      // Map/Chat view: character-count based logic
      const charCount = value.trim().length;
      const multiLineCharThreshold = 40; // Switch to multi-line at 40 characters
      const singleLineCharThreshold = 35; // Switch back to single-line at 35 characters (hysteresis)
      
      if (isMultiLine) {
        // Already in multi-line: only exit if character count is below single-line threshold
        shouldBeMultiLine = charCount >= singleLineCharThreshold;
      } else {
        // Not in multi-line: only enter if character count reaches multi-line threshold
        shouldBeMultiLine = charCount >= multiLineCharThreshold;
      }
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
        // Preserve multi-line mode in dashboard view
        flushSync(() => {
          if (!isMapVisible && !isInChatMode) {
            setIsMultiLine(true);
          } else {
            setIsMultiLine(false);
          }
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
    
    setAttachedFiles(prev => {
      const updated = [...prev, fileData];
      attachedFilesRef.current = updated; // Update ref immediately
      // CRITICAL: Notify parent immediately when file is added (before state update completes)
      if (onAttachmentsChange) {
        onAttachmentsChange(updated);
      }
      return updated;
    });
    console.log('✅ SearchBar: File attached:', fileData, `(${attachedFiles.length + 1}/${MAX_FILES})`);
    // Also call onFileDrop prop if provided (for drag-and-drop from parent)
    onFileDrop?.(file);
  }, [onFileDrop, attachedFiles.length]);

  // Expose handleFileDrop via ref for drag-and-drop
  useImperativeHandle(ref, () => {
    return {
      handleFileDrop: handleFileUpload,
      getValue: () => {
        // Try to get value from input element first (most up-to-date), fallback to state
        const inputValue = inputRef.current?.value || '';
        const stateValue = searchValue || '';
        return inputValue || stateValue;
      },
      getAttachments: () => {
        // Read from ref for synchronous access to current attachments
        return attachedFilesRef.current;
      }
    };
  }, [handleFileUpload, searchValue, attachedFiles]);

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
    
    setAttachedFiles(prev => {
      const updated = prev.filter(file => file.id !== id);
      attachedFilesRef.current = updated; // Update ref immediately
      // CRITICAL: Notify parent immediately when file is removed (before state update completes)
      if (onAttachmentsChange) {
        onAttachmentsChange(updated);
      }
      return updated;
    });
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
    if ((submitted || attachedFiles.length > 0 || propertyAttachments.length > 0) && !isSubmitted) {
      setIsSubmitted(true);
      
      // TODO: Include file in search when backend is ready
      onSearch?.(submitted);
      
      // Don't clear property attachments here - let SideChatPanel read them first
      // SideChatPanel will clear them after initializing with them
      // Turn off selection mode after submission if property attachments exist
      if (propertyAttachments.length > 0) {
        setSelectionModeActive(false);
      }
      
      // Reset the search bar state after submission (but preserve property attachments)
      setTimeout(() => {
        setSearchValue('');
        setIsSubmitted(false);
        setHasStartedTyping(false);
        setAttachedFiles([]);
        attachedFilesRef.current = []; // Update ref immediately
        // Reset textarea
        if (inputRef.current) {
          const initialHeight = initialScrollHeightRef.current ?? 28.1;
          inputRef.current.style.height = `${initialHeight}px`;
          inputRef.current.style.overflowY = '';
          inputRef.current.style.overflow = '';
        }
      }, 100);
    }
  };
  
  return (
    <div 
      className={`${className || ''} ${
        contextConfig.position === "bottom" && !isMapVisible
          ? "fixed bottom-5 left-1/2 transform -translate-x-1/2 z-40" 
          : isMapVisible 
            ? "w-full" // No padding in map view - parent container handles positioning
            : "w-full flex justify-center px-6"
      }`}
      style={{
        ...(contextConfig.position !== "bottom" && !isMapVisible && { 
          height: 'auto', 
          minHeight: 'fit-content',
          alignItems: 'center',
          paddingTop: '0',
          paddingBottom: '0'
        }),
        // When in map view, don't add fixed positioning - let parent container handle it
        ...(isMapVisible && {
          position: 'relative',
          zIndex: 'auto',
          width: '100%',
          display: 'block',
          padding: '0' // Remove any padding in map view
        }),
        overflow: 'visible'
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className={isMapVisible ? "w-full" : "w-full mx-auto"} style={{ 
        maxWidth: isMapVisible 
          ? '100%' // In map view, use 100% width - parent container handles max width
          : (isVerySmallScreen && !isMapVisible 
            ? `min(${contextConfig.maxWidth}, calc(100vw - 32px))` // On very small screens, ensure it fits viewport
            : contextConfig.maxWidth),
        minWidth: '0', // Allow flexibility on very small screens - parent container handles spacing
        width: '100%', // Always 100% width - let parent container handle constraints
        boxSizing: 'border-box' // Ensure padding is included in width calculation
      }}>
        <form onSubmit={handleSubmit} className="relative" style={{ overflow: 'visible', height: 'auto', width: '100%' }}>
            <div 
            className={`relative flex flex-col ${isSubmitted ? 'opacity-75' : ''}`}
              style={{
                background: '#ffffff',
                border: '1px solid #E5E7EB',
                boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
                paddingTop: '12px',
                paddingBottom: '12px',
                paddingRight: '12px',
                paddingLeft: '12px',
                overflow: 'visible',
                width: '100%',
                minWidth: '0',
                height: 'auto',
                minHeight: 'fit-content',
                boxSizing: 'border-box',
                borderRadius: '12px' // Always 12px rounded corners
              }}
            >
            {/* Property Attachments Display - Above textarea (like MapChatBar) */}
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
                {propertyAttachments.map((property, idx) => {
                  const propertyKey = (property.id && String(property.id).length > 0) 
                    ? String(property.id) 
                    : `property-${idx}-${Math.random().toString(36).substr(2, 9)}`;
                  return (
                    <PropertyAttachment
                      key={propertyKey}
                      attachment={property}
                      onRemove={removePropertyAttachment}
                    />
                  );
                })}
              </div>
            )}
            
            {/* File Attachments Display - Inside search bar container, top-left */}
            {attachedFiles.length > 0 && (
                <div 
                  style={{ height: 'auto' }}
                  className="mb-4 flex flex-wrap gap-2 justify-start"
                >
                  {attachedFiles.map((file, idx) => {
                  const fileKey = (file.id && String(file.id).length > 0) 
                    ? String(file.id) 
                    : `file-${idx}-${Math.random().toString(36).substr(2, 9)}`;
                  return (
                  <FileAttachment
                      key={fileKey}
                      attachment={file}
                    onRemove={handleRemoveFile}
                    onPreview={(file) => {
                      // Use shared preview context to add file (will add to existing preview if open)
                      addPreviewFile(file);
                    }}
                  />
                  );
                })}
                </div>
              )}
            
            {/* Input row - Always show icons at bottom */}
            <div 
              className="relative flex flex-col w-full" 
              style={{ 
                height: 'auto', 
                minHeight: '24px',
                width: '100%',
                minWidth: '0' // Prevent width constraints
              }}
            >
              {/* Textarea always above icons */}
              <div 
                className="flex items-start w-full"
                style={{ 
                  minHeight: '24px',
                  width: '100%',
                  marginTop: '4px', // Additional padding above textarea
                  marginBottom: '12px' // Space between text and icons
                }}
              >
                  <div className="flex-1 relative flex items-start w-full" style={{ 
                    overflow: 'visible', 
                    minHeight: '24px',
                    width: '100%',
                    minWidth: '0'
                  }}>
                    {/* Textarea - always rendered */}
                    <textarea 
                      key="textarea-single-instance"
                      ref={inputRef}
                      value={searchValue}
                      onChange={handleTextareaChange}
                      onFocus={(e) => {
                        setIsFocused(true);
                        // If we have a restored value and cursor is at start, move it to end
                        if (isRestoringValueRef.current && searchValue && e.target.selectionStart === 0 && e.target.value.length > 0) {
                          const textLength = e.target.value.length;
                          e.target.setSelectionRange(textLength, textLength);
                          isRestoringValueRef.current = false;
                        }
                      }} 
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
                      className="w-full bg-transparent focus:outline-none text-sm font-normal text-gray-900 placeholder:text-gray-500 resize-none [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200/50 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:hover:bg-gray-300/70"
                      style={{
                        minHeight: '24px',
                        maxHeight: '350px',
                        fontSize: '14px',
                        lineHeight: '20px',
                        paddingTop: '0px',
                        paddingBottom: '0px',
                        paddingRight: '0px',
                        paddingLeft: '8px',
                        scrollbarWidth: 'thin',
                        scrollbarColor: 'rgba(229, 231, 235, 0.5) transparent',
                        overflow: 'hidden',
                        overflowY: 'auto',
                        wordWrap: 'break-word',
                        transition: 'none',
                        resize: 'none',
                        width: '100%',
                        minWidth: '0'
                      }}
                      autoComplete="off"
                      disabled={isSubmitted}
                      rows={1}
                    />
                  </div>
                </div>
              
              {/* Icons row - Panel toggle, Map toggle on left, other icons on right */}
              <div 
                className="relative flex items-center justify-between w-full"
                style={{
                  width: '100%',
                  minWidth: '0',
                  flexShrink: 0 // Prevent shrinking
                }}
              >
                {/* Left group: Panel toggle and Map toggle */}
                <div className="flex items-center flex-shrink-0">
                  {/* Panel Toggle Button (show when property details is open OR when in map view with previous session) */}
                  {((isPropertyDetailsOpen && onPanelToggle) || (isMapVisible && hasPreviousSession && onPanelToggle)) && (
                    isPropertyDetailsOpen ? (
                    <button
                      type="button"
                      onClick={onPanelToggle}
                        className="flex items-center justify-center focus:outline-none outline-none"
                      style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '4px 8px',
                          backgroundColor: '#ffffff',
                          color: '#111827',
                          border: '1px solid rgba(229, 231, 235, 0.8)',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 500,
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                          whiteSpace: 'nowrap',
                          marginLeft: '4px'
                        }}
                        title="Open analyse mode"
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#f9fafb';
                          e.currentTarget.style.borderColor = 'rgba(209, 213, 219, 0.8)';
                          e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.08)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = '#ffffff';
                          e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.8)';
                          e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05)';
                        }}
                    >
                        <Brain className="w-3.5 h-3.5" strokeWidth={2} />
                        <span>Analyse</span>
                    </button>
                    ) : (
                      <button
                        type="button"
                        onClick={onPanelToggle}
                        className="flex items-center justify-center p-1.5 border rounded-md transition-all duration-200 group border-slate-200/60 hover:border-slate-300/80 bg-white/70 hover:bg-slate-50/80 focus:outline-none outline-none"
                        style={{
                          marginLeft: '4px'
                        }}
                        title="Expand chat"
                      >
                        <MoveDiagonal className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-700 transition-colors" strokeWidth={1.5} />
                      </button>
                    )
                  )}
                  
                  {/* Map Toggle Button - Aligned with text start */}
                  {contextConfig.showMapToggle && (
                    <button 
                      type="button" 
                      onClick={(e) => {
                        console.log('🗺️ Map button clicked!', { 
                          hasOnMapToggle: !!onMapToggle,
                          currentVisibility: isMapVisible 
                        });
                        onMapToggle?.();
                      }}
                      className="flex items-center justify-center focus:outline-none outline-none"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '4px 8px',
                        backgroundColor: '#ffffff',
                        color: '#111827',
                        border: '1px solid rgba(229, 231, 235, 0.8)',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                        whiteSpace: 'nowrap',
                        marginLeft: hasPreviousSession && isMapVisible ? '8px' : '4px'
                      }}
                      title={isMapVisible ? "Back to search mode" : "Go to map mode"}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#f9fafb';
                        e.currentTarget.style.borderColor = 'rgba(209, 213, 219, 0.8)';
                        e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.08)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '#ffffff';
                        e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.8)';
                        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05)';
                      }}
                    >
                        {isMapVisible ? (
                          <LayoutDashboard className="w-3.5 h-3.5" strokeWidth={2} />
                        ) : (
                          <Map className="w-3.5 h-3.5" strokeWidth={2} />
                        )}
                    </button>
                  )}
                </div>
              
                {/* Other icons - on the right */}
                <div className="flex items-center space-x-3 flex-shrink-0" style={{ 
                  minWidth: '0',
                  flexShrink: 0
                }}>
                {/* Document Selection Toggle Button (works like SideChatPanel) */}
                <div className="relative flex items-center">
                  <button
                    type="button"
                      onClick={() => {
                        console.log('🔘 SearchBar: Document selection button clicked, current mode:', isDocumentSelectionMode);
                        toggleDocumentSelectionMode();
                        console.log('🔘 SearchBar: After toggle, new mode should be:', !isDocumentSelectionMode);
                      }}
                      className={`p-1 transition-colors relative ${
                        selectedDocumentIds.size > 0
                        ? 'text-green-500 hover:text-green-600 bg-green-50 rounded'
                          : isDocumentSelectionMode
                          ? 'text-blue-600 hover:text-blue-700 bg-blue-50 rounded' 
                          : 'text-slate-600 hover:text-green-500'
                    }`}
                    title={
                        selectedDocumentIds.size > 0
                          ? `${selectedDocumentIds.size} document${selectedDocumentIds.size > 1 ? 's' : ''} selected - Queries will search only these documents. Click to ${isDocumentSelectionMode ? 'exit' : 'enter'} selection mode.`
                          : isDocumentSelectionMode
                            ? "Document selection mode active - Click document cards to select"
                            : "Select documents to search within"
                    }
                  >
                      {selectedDocumentIds.size > 0 ? (
                        <Scan className="w-5 h-5" strokeWidth={1.5} />
                      ) : isDocumentSelectionMode ? (
                      <Scan className="w-5 h-5" strokeWidth={1.5} />
                    ) : (
                      <SquareDashedMousePointer className="w-5 h-5" strokeWidth={1.5} />
                    )}
                      {selectedDocumentIds.size > 0 && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 text-white text-[10px] font-semibold rounded-full flex items-center justify-center">
                          {selectedDocumentIds.size}
                        </span>
                      )}
                    </button>
                    {selectedDocumentIds.size > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          clearSelectedDocuments();
                          setDocumentSelectionMode(false); // Exit selection mode and return to default state
                        }}
                        className="ml-1 p-0.5 text-gray-400 hover:text-red-500 transition-colors"
                        title="Clear document selection"
                      >
                        <X className="w-3.5 h-3.5" strokeWidth={2} />
                  </button>
                )}
                  </div>
                
                {onQuickStartToggle && (
                  <button
                    type="button"
                    onClick={onQuickStartToggle}
                    className={`flex items-center justify-center w-7 h-7 transition-colors focus:outline-none outline-none ${
                      isQuickStartBarVisible 
                        ? 'text-green-500 bg-green-50 rounded' 
                        : 'text-slate-600 hover:text-green-500'
                    }`}
                    title="Link document to property"
                  >
                    <Workflow className="w-5 h-5" strokeWidth={1.5} />
                  </button>
                )}
                
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
                    <button
                      type="button"
                      onClick={() => {}}
                      className="flex items-center justify-center w-7 h-7 text-slate-600 hover:text-green-500 transition-colors focus:outline-none outline-none"
                    >
                      <Mic className="w-5 h-5" strokeWidth={1.5} />
                    </button>
                  )}
                
                <button 
                  type="submit" 
                  onClick={handleSubmit} 
                  className={`flex items-center justify-center relative focus:outline-none outline-none ${!isSubmitted ? '' : 'cursor-not-allowed'}`}
                  style={{
                    width: '32px',
                    height: '32px',
                    minWidth: '32px',
                    minHeight: '32px',
                    borderRadius: '50%',
                    backgroundColor: (searchValue.trim() || attachedFiles.length > 0 || propertyAttachments.length > 0) ? '#415C85' : (isMapVisible ? '#F3F4F6' : 'transparent')
                  }}
                    disabled={isSubmitted || (!searchValue.trim() && attachedFiles.length === 0 && propertyAttachments.length === 0)}
                >
                  {(searchValue.trim() || attachedFiles.length > 0 || propertyAttachments.length > 0) ? (
                    <ArrowUp className="w-4 h-4" strokeWidth={2.5} style={{ color: '#ffffff' }} />
                  ) : (
                    <ChevronRight className="w-6 h-6" strokeWidth={1.5} style={{ color: '#6B7280' }} />
                  )}
                </button>
                </div>
              </div>
            </div>
            </div>
          </form>
      </div>
      {/* Document Preview Modal is now rendered at MainContent level using shared context */}
    </div>
  );
});
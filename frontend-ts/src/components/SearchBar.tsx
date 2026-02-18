"use client";

import * as React from "react";
import { useState, useRef, useEffect, useLayoutEffect, useImperativeHandle, forwardRef, useCallback, useMemo } from "react";
import { flushSync } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Map, ArrowUp, LibraryBig, Mic, PanelRightOpen, SquareDashedMousePointer, Scan, Fullscreen, X, Brain, MoveDiagonal, MapPinHouse, MessageCircle, Upload, AudioLines, Globe } from "lucide-react";
import { ImageUploadButton } from './ImageUploadButton';
import { FileAttachment, FileAttachmentData } from './FileAttachment';
import { toast } from "@/hooks/use-toast";
import { usePreview } from '../contexts/PreviewContext';
import { usePropertySelection } from '../contexts/PropertySelectionContext';
import { useDocumentSelection } from '../contexts/DocumentSelectionContext';
import { backendApi } from '../services/backendApi';
import { QuickStartBar } from './QuickStartBar';
import { ModeSelector } from './ModeSelector';
import { ModelSelector } from './ModelSelector';
import { ChatBarAttachDropdown } from './ChatBarAttachDropdown';
import { WebSearchPill } from './SelectedModePill';
import { AtMentionPopover, type AtMentionItem } from './AtMentionPopover';
import { SegmentInput, type SegmentInputHandle } from './SegmentInput';
import { getFilteredAtMentionItems, preloadAtMentionCache } from '@/services/atMentionCache';
import { useSegmentInput, buildInitialSegments } from '@/hooks/useSegmentInput';
import { isTextSegment, isChipSegment, type QueryContentSegment } from '@/types/segmentInput';
import { INPUT_BAR_SPACE_BELOW_DASHBOARD } from '@/utils/inputBarPosition';

export interface SearchBarProps {
  className?: string;
  onSearch?: (query: string, options?: { contentSegments?: QueryContentSegment[] }) => void;
  onQueryStart?: (query: string) => void;
  onMapToggle?: () => void;
  onDashboardClick?: () => void;
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
  onDashboardClick,
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
  // Track if we're restoring a value (to set cursor position)
  const isRestoringValueRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const [isDragOver, setIsDragOver] = useState(false);
  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(false);
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

  const prevInitialValueRef = useRef<string | undefined>(initialValue);
  
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
    addPropertyAttachment,
    removePropertyAttachment,
    clearPropertyAttachments 
  } = usePropertySelection();
  
  // Use document selection context (for document selection like SideChatPanel)
  const {
    selectedDocumentIds,
    isDocumentSelectionMode,
    toggleDocumentSelectionMode,
    toggleDocumentSelection,
    clearSelectedDocuments,
    setDocumentSelectionMode
  } = useDocumentSelection();

  const [atMentionDocumentChips, setAtMentionDocumentChips] = useState<Array<{ id: string; label: string }>>([]);
  const [atMentionOpen, setAtMentionOpen] = useState(false);
  const [atQuery, setAtQuery] = useState('');
  const [atAnchorIndex, setAtAnchorIndex] = useState(-1);
  const [atAnchorRect, setAtAnchorRect] = useState<{ left: number; top: number; bottom: number; height: number } | null>(null);
  const [atItems, setAtItems] = useState<AtMentionItem[]>([]);
  const [atSelectedIndex, setAtSelectedIndex] = useState(0);
  const [atPlacement] = useState<'above' | 'below'>('above'); // Always above so dropdown doesn't cover chat bar

  const initialSegments = useMemo(
    () =>
      buildInitialSegments(
        searchValue,
        propertyAttachments.map((a) => ({ id: a.id, label: a.address, payload: a.property })),
        atMentionDocumentChips
      ),
    []
  );
  const segmentInput = useSegmentInput({
    initialSegments,
    onRemovePropertyChip: removePropertyAttachment,
    onRemoveDocumentChip: (id) => {
      toggleDocumentSelection(id);
      setAtMentionDocumentChips((prev) => prev.filter((d) => d.id !== id));
    },
  });

  useEffect(() => {
    setSearchValue(segmentInput.getPlainText());
  }, [segmentInput.segments]);

  useEffect(() => {
    const plain = segmentInput.getPlainText();
    const cursorOffset = segmentInput.getCursorOffset();
    const lastAt = plain.slice(0, cursorOffset).lastIndexOf("@");
    const queryAfterAt = lastAt >= 0 ? plain.slice(lastAt + 1, cursorOffset) : "";
    // Close popover when user types a space after "@"
    if (lastAt >= 0 && !queryAfterAt.includes(" ")) {
      setAtMentionOpen(true);
      setAtQuery(queryAfterAt);
      setAtAnchorIndex(lastAt);
    } else {
      setAtMentionOpen(false);
      setAtQuery("");
      setAtAnchorIndex(-1);
    }
  }, [segmentInput.segments, segmentInput.cursor]);

  useEffect(() => {
    if (!atMentionOpen) {
      setAtItems([]);
      return;
    }
    setAtItems(getFilteredAtMentionItems(atQuery));
    preloadAtMentionCache().then(() => {
      setAtItems(getFilteredAtMentionItems(atQuery));
    });
  }, [atMentionOpen, atQuery]);

  // Position @ popover at the "@" character (defer rect read so segment refs are ready)
  useEffect(() => {
    if (!atMentionOpen || atAnchorIndex < 0) {
      setAtAnchorRect(null);
      return;
    }
    let cancelled = false;
    const readRect = () => {
      if (cancelled) return;
      const rect = inputRef.current?.getRectForPlainOffset(atAnchorIndex);
      if (rect) {
        setAtAnchorRect({ left: rect.left, top: rect.top, bottom: rect.bottom, height: rect.height });
      } else {
        requestAnimationFrame(() => {
          if (cancelled) return;
          const retryRect = inputRef.current?.getRectForPlainOffset(atAnchorIndex);
          if (retryRect) {
            setAtAnchorRect({ left: retryRect.left, top: retryRect.top, bottom: retryRect.bottom, height: retryRect.height });
          } else {
            setAtAnchorRect(null);
          }
        });
      }
    };
    requestAnimationFrame(readRect);
    return () => { cancelled = true; };
  }, [atMentionOpen, atAnchorIndex, segmentInput.segments]);

  const handleAtSelect = useCallback((item: AtMentionItem) => {
    const startPlain = Math.max(0, atAnchorIndex);
    const endPlain = segmentInput.getCursorOffset();
    const startPos = segmentInput.getSegmentOffsetFromPlain(startPlain);
    const endPos = segmentInput.getSegmentOffsetFromPlain(endPlain);
    if (startPos != null && endPos != null) {
      segmentInput.removeSegmentRange(
        startPos.segmentIndex,
        startPos.offset,
        endPos.segmentIndex,
        endPos.offset
      );
    } else {
      segmentInput.removeRange(startPlain, endPlain);
    }
    setAtMentionOpen(false);
    if (item.type === "property") {
      const property = item.payload as { id: string; address: string; [key: string]: unknown };
      addPropertyAttachment(property as any);
      segmentInput.insertChipAtCursor(
        {
          type: "chip",
          kind: "property",
          id: property.id,
          label: property.address || item.primaryLabel,
          payload: property,
        },
        { trailingSpace: true }
      );
    } else {
      toggleDocumentSelection(item.id);
      setAtMentionDocumentChips((prev) => [...prev, { id: item.id, label: item.primaryLabel }]);
      segmentInput.insertChipAtCursor(
        {
          type: "chip",
          kind: "document",
          id: item.id,
          label: item.primaryLabel,
        },
        { trailingSpace: true }
      );
    }
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      requestAnimationFrame(() => restoreSelectionRef.current?.());
    });
  }, [atAnchorIndex, addPropertyAttachment, toggleDocumentSelection, segmentInput]);

  // Update searchValue/segments when initialValue prop changes (e.g., when switching from dashboard to map view)
  useEffect(() => {
    prevInitialValueRef.current = initialValue;
    if (initialValue !== undefined && initialValue !== segmentInput.getPlainText()) {
      isRestoringValueRef.current = true;
      setSearchValue(initialValue);
      lastInitialValueRef.current = initialValue;
      segmentInput.setSegments(
        buildInitialSegments(
          initialValue,
          propertyAttachments.map((a) => ({ id: a.id, label: a.address, payload: a.property })),
          atMentionDocumentChips
        )
      );
    }
  }, [initialValue, isMapVisible, currentView]);

  // Set cursor to end when searchValue is set from initialValue on mount or when restored
  useEffect(() => {
    if (isRestoringValueRef.current && searchValue) {
      segmentInput.setCursorToOffset(searchValue.length);
      isRestoringValueRef.current = false;
    }
  }, [searchValue, segmentInput]);
  
  const inputRef = useRef<SegmentInputHandle | null>(null);
  const restoreSelectionRef = useRef<(() => void) | null>(null);
  const queryStartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const multiLineTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initialScrollHeightRef = useRef<number | null>(null);
  const isDeletingRef = useRef(false);
  
  // QuickStartBar positioning refs and state (for map view)
  const searchFormRef = useRef<HTMLFormElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const atMentionAnchorRef = useRef<HTMLDivElement>(null); // Input row ref so popover sits directly under input
  const quickStartBarWrapperRef = useRef<HTMLDivElement>(null);
  const [quickStartBarBottom, setQuickStartBarBottom] = useState<string>('calc(100% + 12px)');
  
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
  const hasContent = searchValue.trim().length > 0 || attachedFiles.length > 0 || propertyAttachments.length > 0 || atMentionDocumentChips.length > 0;
  const isDashboardView = !isMapVisible && !isInChatMode;
  
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
      if (isMapVisible) {
        return "Search for properties";
      } else if (isInChatMode) {
        return "Search anything, type @ to add context";
      } else {
        return "Search anything, type @ to add context";
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
      // Dashboard view - square corners; no Map button on dashboard
      // On very small screens, use a more flexible width to ensure placeholder text fits
      const flexibleMaxWidth = isVerySmallScreen 
        ? 'min(100%, calc(100vw - 32px))' // On very small screens, use almost full width minus minimal padding
        : 'clamp(350px, 90vw, 700px)'; // Normal screens: min 350px (reduced since placeholder is shorter), max 700px
      
      return {
        placeholder: getPlaceholder(),
        showMapToggle: false,
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
        segmentInput.setSegments([{ type: "text", value: "" }]);
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
        segmentInput.setSegments(buildInitialSegments(initialValue, propertyAttachments.map((a) => ({ id: a.id, label: a.address, payload: a.property })), atMentionDocumentChips));
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

  // Auto-focus on mount and set initial height
  // SegmentInput manages its own layout; no textarea height init needed
  useLayoutEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus?.();
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

  // SegmentInput manages its own state; no textarea DOM reset needed
  const resetTextareaToInitial = useCallback(() => {}, []);

  // SegmentInput handles input; this is unused (kept for any legacy refs)
  const handleTextareaChange = useCallback((_e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = segmentInput.getPlainText();
    const cursorPos = (_e.target as HTMLTextAreaElement).selectionStart;
    setSearchValue(value);
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
          const el = inputRef.current?.getRootElement();
          if (el && !el.closest('.hidden')) {
            // Reverse DOM changes: undo what we did when entering multi-line
            const initialHeight = initialScrollHeightRef.current ?? 28.1;
            el.style.height = `${initialHeight}px`;
            el.style.overflowY = '';
            el.style.overflow = '';
            
            // Restore cursor position after reset (SegmentInput is contenteditable; setSelectionRange is no-op on div)
            if (cursorPos !== null && 'setSelectionRange' in (el as any)) {
              (el as any).setSelectionRange(cursorPos, cursorPos);
            }
          }
        });
      });
      return;
    }
    
    // Dashboard view: always multi-line (like MapChatBar)
    // Map view: always multi-line (like MapChatBar) and NEVER collapse back to single-line.
    // Chat view: switch to multi-line ONLY when the content actually wraps (or contains a newline).
    // This prevents the "jump" caused by a character-count threshold toggling multi-line too early.
    let shouldBeMultiLine = false;
    if (isMapVisible) {
      shouldBeMultiLine = true;
    } else if (!isMapVisible && !isInChatMode) {
      shouldBeMultiLine = true;
    } else {
      const el = _e.target;
      const baseHeight = initialScrollHeightRef.current ?? 28.1;
      const hasExplicitNewline = value.includes('\n');
      // scrollHeight increases as soon as content wraps, even if the visible height is still 1 line.
      const hasWrapped = el.scrollHeight > baseHeight + 1; // +1px tolerance for rounding
      
      if (isMultiLine) {
        // Stay multiline until content is back to a single line (no wrap + no newline).
        shouldBeMultiLine = hasExplicitNewline || hasWrapped;
      } else {
        // Enter multiline only when we actually need more than one line.
        shouldBeMultiLine = hasExplicitNewline || hasWrapped;
      }
    }
    
    // Text organization logic
    if (shouldBeMultiLine && !isMultiLine) {
      // Entering multi-line: set state first
      setIsMultiLine(true);
      // Then adjust height and restore cursor after React switches to multi-line textarea
      // Use requestAnimationFrame to ensure smooth transition
      requestAnimationFrame(() => {
        const el = inputRef.current?.getRootElement();
        if (el) {
          // Adjust height - let CSS transition handle the animation
          el.style.height = 'auto';
          const scrollHeight = el.scrollHeight;
          // Calculate viewport-aware maxHeight to prevent overflow
          // Constrain to viewport height minus safe margins (container padding, icons, spacing)
          const maxHeight = isDashboardView
            ? 160
            : Math.min(350, typeof window !== 'undefined' ? window.innerHeight - 200 : 350);
          const newHeight = Math.min(scrollHeight, maxHeight);
          el.style.height = `${newHeight}px`;
          // Always allow scrolling when content exceeds maxHeight
          el.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
          // Ensure the textarea doesn't collapse
          el.style.minHeight = '28px';
          
          // Restore cursor position to end (where user was typing)
          if (cursorPos !== null && 'setSelectionRange' in (el as any)) {
            const targetPos = Math.min(cursorPos, value.length);
            (el as any).setSelectionRange(targetPos, targetPos);
            inputRef.current?.focus();
          }
        }
      });
    } else if (inputRef.current) {
      if (!shouldBeMultiLine && isMultiLine) {
        // Exiting multi-line: return to opening state
        // Preserve cursor position and focus state before transition
        const savedCursorPos = cursorPos;
        const rootEl = inputRef.current.getRootElement();
        const wasFocused = rootEl ? document.activeElement === rootEl : false;
        
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
          const el = inputRef.current.getRootElement();
          // Return to initial height (like on mount) - let CSS transition handle the animation
          const initialHeight = initialScrollHeightRef.current ?? 28.1;
          // Use requestAnimationFrame to ensure transition applies smoothly
          requestAnimationFrame(() => {
            if (el) {
              el.style.height = `${initialHeight}px`;
              // Remove overflow styles (back to CSS defaults)
              el.style.overflowY = '';
              el.style.overflow = '';
            }
          });
          
          // Immediately restore focus and cursor to continue deletion - no delays
          if (wasFocused) {
            inputRef.current.focus();
          }
          if (el && savedCursorPos !== null && 'setSelectionRange' in (el as any)) {
            const targetPos = Math.min(savedCursorPos, value.length);
            (el as any).setSelectionRange(targetPos, targetPos);
          }
        }
        
        // Reset deletion flag after a brief moment
        setTimeout(() => {
          isDeletingRef.current = false;
        }, 50); // Reduced from 100ms
      } else if (shouldBeMultiLine && isMultiLine) {
        // Already in multi-line: update height as text grows
        // OPTIMIZED: Only recalculate when content grows to avoid unnecessary reflows
        const el = inputRef.current?.getRootElement();
        if (el) {
          const currentHeight = parseFloat(el.style.height) || 28;
          const scrollHeight = el.scrollHeight;
          
          // Calculate viewport-aware maxHeight to prevent overflow
          // Constrain to viewport height minus safe margins (container padding, icons, spacing)
          const maxHeight = isDashboardView
            ? 160
            : Math.min(350, typeof window !== 'undefined' ? window.innerHeight - 260 : 350);
          
          // Only update height if content has grown OR if we need to shrink (deletion)
          // This avoids the expensive height:auto -> measure -> set pattern
          if (scrollHeight > currentHeight || (isDeletingRef.current && scrollHeight < currentHeight)) {
            const newHeight = Math.min(scrollHeight, maxHeight);
            el.style.height = `${newHeight}px`;
          }
          
          // Always allow scrolling when content exceeds maxHeight
          el.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
          // Ensure the textarea doesn't collapse
          el.style.minHeight = '28px';
        }
      }
      
      // Only restore cursor position if not in deletion mode (to avoid delays)
      const elForCursor = inputRef.current?.getRootElement();
      if (!isDeletingRef.current && elForCursor && cursorPos !== null && 'setSelectionRange' in (elForCursor as any)) {
        (elForCursor as any).setSelectionRange(cursorPos, cursorPos);
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


  // Maintain focus during multi-line transition (SegmentInput div - no setSelectionRange)
  useLayoutEffect(() => {
    const el = inputRef.current?.getRootElement();
    if (el && !el.closest('.hidden') && (isFocused || isDeletingRef.current)) {
      if (document.activeElement !== el) {
        inputRef.current?.focus();
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
    
    const fileId = `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Check if file type supports quick extraction
    const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isDOCX = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                   file.type === 'application/msword' ||
                   file.name.toLowerCase().endsWith('.docx') || 
                   file.name.toLowerCase().endsWith('.doc');
    const isTXT = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
    const supportsExtraction = isPDF || isDOCX || isTXT;
    
    const fileData: FileAttachmentData = {
      id: fileId,
      file,
      name: file.name,
      type: file.type,
      size: file.size,
      // Set initial extraction status for supported file types
      extractionStatus: supportsExtraction ? 'pending' : undefined
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
        (window as any).__preloadedAttachmentBlobs[fileId] = blobUrl;
        
        console.log(`✅ Preloaded blob URL for attachment ${fileId}`);
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
      return updated;
    });
    // Notify parent after state update (useEffect will also handle this, but this ensures immediate notification)
    queueMicrotask(() => {
      if (onAttachmentsChange) {
        onAttachmentsChange(attachedFilesRef.current);
      }
    });
    console.log('✅ SearchBar: File attached:', fileData, `(${attachedFiles.length + 1}/${MAX_FILES})`);
    
    // Trigger quick text extraction for supported file types
    if (supportsExtraction) {
      console.log('🔍 Starting quick extraction for:', file.name);
      
      // Update status to extracting
      setAttachedFiles(prev => prev.map(f => 
        f.id === fileId ? { ...f, extractionStatus: 'extracting' as const } : f
      ));
      
      // Call backend extraction API
      backendApi.quickExtractText(file, true)
        .then(result => {
          if (result.success) {
            console.log(`✅ Quick extraction complete for ${file.name}: ${result.pageCount} pages, ${result.charCount} chars`);
            setAttachedFiles(prev => prev.map(f => 
              f.id === fileId 
                ? { 
                    ...f, 
                    extractionStatus: 'complete' as const,
                    extractedText: result.text,
                    pageTexts: result.pageTexts,
                    pageCount: result.pageCount,
                    tempFileId: result.tempFileId
                  } 
                : f
            ));
            // Update ref and notify parent
            queueMicrotask(() => {
              if (onAttachmentsChange) {
                onAttachmentsChange(attachedFilesRef.current);
              }
            });
          } else {
            console.error(`❌ Quick extraction failed for ${file.name}:`, result.error);
            setAttachedFiles(prev => prev.map(f => 
              f.id === fileId 
                ? { 
                    ...f, 
                    extractionStatus: 'error' as const,
                    extractionError: result.error
                  } 
                : f
            ));
          }
        })
        .catch(error => {
          console.error(`❌ Quick extraction error for ${file.name}:`, error);
          setAttachedFiles(prev => prev.map(f => 
            f.id === fileId 
              ? { 
                  ...f, 
                  extractionStatus: 'error' as const,
                  extractionError: error instanceof Error ? error.message : 'Unknown error'
                } 
              : f
          ));
        });
    }
    // Also call onFileDrop prop if provided (for drag-and-drop from parent)
    onFileDrop?.(file);
  }, [onFileDrop, attachedFiles.length]);

  // Expose handleFileDrop via ref for drag-and-drop
  useImperativeHandle(ref, () => {
    return {
      handleFileDrop: handleFileUpload,
      getValue: () => segmentInput.getPlainText(),
      getAttachments: () => {
        // Read from ref for synchronous access to current attachments
        return attachedFilesRef.current;
      }
    };
  }, [handleFileUpload, segmentInput, attachedFiles]);

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
      return updated;
    });
    // Notify parent after state update
    queueMicrotask(() => {
      if (onAttachmentsChange) {
        onAttachmentsChange(attachedFilesRef.current);
      }
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

  // Handle drop from FilingSidebar
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    try {
      // Check if this is a document from FilingSidebar (use text/plain for Chrome/cross-browser)
      let jsonData = e.dataTransfer.getData('application/json');
      if (!jsonData) jsonData = e.dataTransfer.getData('text/plain');
      if (jsonData) {
        let data: { type?: string; documentId?: string; filename?: string; fileType?: string; s3Path?: string };
        try {
          data = JSON.parse(jsonData);
        } catch {
          data = {};
        }
        if (data.type === 'filing-sidebar-document') {
          if (attachedFiles.length >= MAX_FILES) {
            toast({
              description: `Maximum of ${MAX_FILES} files allowed. Please remove a file before adding another.`,
              duration: 3000,
            });
            return;
          }
          console.log('📥 SearchBar: Dropped document from FilingSidebar:', data.filename);
          
          // Create optimistic attachment immediately with placeholder file
          const attachmentId = `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const placeholderFile = new File([], data.filename, {
            type: data.fileType || 'application/pdf',
          });
          
          const optimisticFileData: FileAttachmentData = {
            id: attachmentId,
            file: placeholderFile,
            name: data.filename,
            type: data.fileType || 'application/pdf',
            size: 0, // Will be updated when file is fetched
          };
          
          // Add attachment immediately for instant feedback
          setAttachedFiles(prev => {
            const updated = [...prev, optimisticFileData];
            attachedFilesRef.current = updated;
            return updated;
          });
          // Notify parent after state update
          queueMicrotask(() => {
            if (onAttachmentsChange) {
              onAttachmentsChange(attachedFilesRef.current);
            }
          });
          
          // Fetch the actual file in the background
          (async () => {
            try {
              const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';
              let downloadUrl: string;
              
              if (data.s3Path) {
                downloadUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(data.s3Path)}`;
              } else {
                downloadUrl = `${backendUrl}/api/files/download?document_id=${data.documentId}`;
              }
              
              const response = await fetch(downloadUrl, { credentials: 'include' });
              if (!response.ok) {
                throw new Error('Failed to fetch document');
              }
              
              const blob = await response.blob();
              const actualFile = new File([blob], data.filename, {
                type: data.fileType || blob.type || 'application/pdf',
              });
              
              // Update the attachment with the actual file
              setAttachedFiles(prev => {
                const updated = prev.map(att => 
                  att.id === attachmentId 
                    ? { ...att, file: actualFile, size: actualFile.size }
                    : att
                );
                attachedFilesRef.current = updated;
                return updated;
              });
              // Notify parent after state update
              queueMicrotask(() => {
                if (onAttachmentsChange) {
                  onAttachmentsChange(attachedFilesRef.current);
                }
              });
              
              // Preload blob URL for preview
              try {
                const blobUrl = URL.createObjectURL(actualFile);
                if (!(window as any).__preloadedAttachmentBlobs) {
                  (window as any).__preloadedAttachmentBlobs = {};
                }
                (window as any).__preloadedAttachmentBlobs[attachmentId] = blobUrl;
              } catch (preloadError) {
                console.error('Error preloading blob URL:', preloadError);
              }
              
              console.log('✅ SearchBar: Document fetched and updated:', actualFile.name);
            } catch (error) {
              console.error('❌ SearchBar: Error fetching document:', error);
              // Remove the optimistic attachment on error
              setAttachedFiles(prev => {
                const updated = prev.filter(att => att.id !== attachmentId);
                attachedFilesRef.current = updated;
                return updated;
              });
              // Notify parent after state update
              queueMicrotask(() => {
                if (onAttachmentsChange) {
                  onAttachmentsChange(attachedFilesRef.current);
                }
              });
              toast({
                description: 'Failed to load document. Please try again.',
                duration: 3000,
              });
            }
          })();
          
          return;
        }
      }
      
      // Fallback: check for regular file drops
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        files.forEach(file => handleFileUpload(file));
      }
    } catch (error) {
      console.error('❌ SearchBar: Error handling drop:', error);
      toast({
        description: 'Failed to add document. Please try again.',
        duration: 3000,
      });
    }
  }, [handleFileUpload, onAttachmentsChange]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const types = e.dataTransfer.types;
    const hasFilingSidebarDocument = types.includes('application/json') || types.includes('text/plain');
    const hasFiles = types.includes('Files');
    if (hasFilingSidebarDocument || hasFiles) {
      e.dataTransfer.dropEffect = 'copy';
      flushSync(() => setIsDragOver(true));
    } else {
      e.dataTransfer.dropEffect = 'none';
      flushSync(() => setIsDragOver(false));
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear drag state if we're actually leaving the drop zone
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!e.currentTarget.contains(relatedTarget)) {
      setIsDragOver(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitted = segmentInput.getPlainText().trim();
    if ((submitted || attachedFiles.length > 0 || propertyAttachments.length > 0 || atMentionDocumentChips.length > 0) && !isSubmitted) {
      setIsSubmitted(true);
      // Build contentSegments from current segments BEFORE clearing (exact order for query bubble)
      const contentSegments: QueryContentSegment[] = [];
      for (const seg of segmentInput.segments) {
        if (isTextSegment(seg)) {
          if (seg.value) contentSegments.push({ type: 'text', value: seg.value });
        } else if (isChipSegment(seg)) {
          if (seg.kind === 'property') {
            const attachment = propertyAttachments.find(
              (a) => String(a.propertyId) === String(seg.id) || (a.property as any)?.id == seg.id
            );
            if (attachment) {
              contentSegments.push({ type: 'property', attachment });
            } else {
              const p = (seg.payload as any) || {};
              const addr = p.formatted_address || p.normalized_address || p.address || 'Unknown Address';
              contentSegments.push({
                type: 'property',
                attachment: { id: seg.id, propertyId: seg.id, address: addr, imageUrl: '', property: p }
              });
            }
          } else {
            const name = atMentionDocumentChips.find((c) => c.id === seg.id)?.label ?? seg.label ?? seg.id;
            contentSegments.push({ type: 'document', id: seg.id, name });
          }
        }
      }
      onSearch?.(submitted, contentSegments.length > 0 ? { contentSegments } : undefined);
      if (propertyAttachments.length > 0) {
        setSelectionModeActive(false);
      }
      setTimeout(() => {
        setSearchValue('');
        segmentInput.setSegments([{ type: "text", value: "" }]);
        setIsSubmitted(false);
        setHasStartedTyping(false);
        setAttachedFiles([]);
        attachedFilesRef.current = [];
      }, 100);
    }
  };
  
  // Calculate QuickStartBar position dynamically based on search bar position (for map view)
  useLayoutEffect(() => {
    if (!isMapVisible || !isQuickStartBarVisible || !searchFormRef.current || !searchContainerRef.current || !quickStartBarWrapperRef.current) {
      return;
    }

    const calculatePosition = () => {
      const searchForm = searchFormRef.current;
      const container = searchContainerRef.current;
      const quickStartWrapper = quickStartBarWrapperRef.current;
      
      if (!searchForm || !container || !quickStartWrapper) {
        return;
      }

      // Get the form's inner div (the white search bar container with the actual width)
      const formInnerDiv = searchForm.querySelector('div') as HTMLElement;
      if (!formInnerDiv) {
        return;
      }

      // Get positions - use offsetTop for more reliable relative positioning
      const containerHeight = container.offsetHeight;
      const formTopRelative = formInnerDiv.offsetTop;
      
      // Calculate spacing (negative value to bring QuickStartBar down closer to search bar)
      // Less negative = more gap between QuickStartBar and search bar
      const spacing = -35;
      
      // Position QuickStartBar above the form with spacing
      // bottom = container height - (form top relative to container) + spacing
      const bottomPosition = containerHeight - formTopRelative + spacing;
      
      // Set the bottom position
      setQuickStartBarBottom(`${bottomPosition}px`);
      
      // QuickStartBar is now centered, so we just need to set maxWidth to match search bar
      quickStartWrapper.style.width = 'fit-content';
      // QuickStartBar should match search bar width for alignment
      quickStartWrapper.style.maxWidth = '680px'; // Match content wrapper maxWidth
    };

    // Initial calculation with a small delay to ensure DOM is ready
    const timeoutId = setTimeout(calculatePosition, 0);

    // Use ResizeObserver to recalculate when dimensions change
    const resizeObserver = new ResizeObserver(() => {
      // Debounce resize updates
      setTimeout(calculatePosition, 10);
    });

    // Observe the container, form, and form's inner div
    if (searchContainerRef.current) {
      resizeObserver.observe(searchContainerRef.current);
    }
    if (searchFormRef.current) {
      resizeObserver.observe(searchFormRef.current);
      const formInnerDiv = searchFormRef.current.querySelector('div');
      if (formInnerDiv) {
        resizeObserver.observe(formInnerDiv);
      }
    }

    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, [isMapVisible, isQuickStartBarVisible]); // Recalculate when visibility or map view changes
  
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
        ...(contextConfig.position === "bottom" && !isMapVisible && { 
          bottom: `${INPUT_BAR_SPACE_BELOW_DASHBOARD}px`,
          // Constrain height to stay within viewport when fixed at bottom
          maxHeight: `calc(100vh - ${INPUT_BAR_SPACE_BELOW_DASHBOARD + 16}px)`, // Viewport minus space below and padding
          overflowY: 'auto', // Allow scrolling if content exceeds max height
          overflowX: 'visible'
        }),
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
        overflow: contextConfig.position === "bottom" && !isMapVisible ? 'auto' : 'visible'
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div 
        ref={searchContainerRef}
        className={isMapVisible ? "w-full" : "w-full mx-auto"} 
        style={{ 
          // Match SideChatPanel positioning when dashboard: same width constraint and min width as panel chat bar wrapper
          ...(isMapVisible
            ? { maxWidth: '100%', minWidth: '0', width: '100%' }
            : {
                width: 'min(100%, 640px)',
                minWidth: '200px',
                maxWidth: '640px',
              }),
          boxSizing: 'border-box',
          position: 'relative',
        }}
      >
        {/* QuickStartBar - appears above search bar in map view when button is clicked */}
        {isMapVisible && isQuickStartBarVisible && (
          <div
            ref={quickStartBarWrapperRef}
            style={{
              position: 'absolute',
              bottom: quickStartBarBottom, // Dynamically calculated position
              left: '50%',
              transform: 'translateX(-50%)', // Center the QuickStartBar
              zIndex: 10000,
              width: 'fit-content', // Let content determine width naturally
              maxWidth: '680px', // Fixed maxWidth to match search bar - QuickStartBar should align with search bar
              display: 'flex',
              justifyContent: 'center'
            }}
          >
            <QuickStartBar
              onDocumentLinked={(propertyId, documentId) => {
                console.log('Document linked:', { propertyId, documentId });
                // Optionally close QuickStartBar after successful link
                if (onQuickStartToggle) {
                  onQuickStartToggle();
                }
              }}
              onPopupVisibilityChange={() => {}}
              isInChatPanel={false}
            />
          </div>
        )}
        {/* Wrapper with expanded hit area so drag-over registers when cursor is near the bar */}
        <div
          className="relative"
          style={{ margin: '-10px' }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
        <form 
          ref={searchFormRef}
          onSubmit={handleSubmit} 
          className="relative"
          data-search-bar="true"
          style={{ overflow: 'visible', height: 'auto', width: '100%' }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
            <div 
            className={`relative flex flex-col ${isSubmitted ? 'opacity-75' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
                style={{
                  background: isDragOver ? 'rgba(59, 130, 246, 0.1)' : '#ffffff',
                  border: isDragOver ? '2px dashed rgba(59, 130, 246, 0.75)' : '1px solid #E0E0E0',
                  boxShadow: isDragOver 
                    ? '0 0 0 1px rgba(59, 130, 246, 0.25)' 
                    : '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)',
                  position: 'relative',
                  paddingTop: '16px',
                  paddingBottom: '12px',
                  paddingRight: '16px',
                  paddingLeft: '16px',
                  overflow: 'visible',
                  width: '100%',
                  height: 'auto',
                  minHeight: 'fit-content',
                  boxSizing: 'border-box',
                  borderRadius: '28px',
                  transition: isDragOver ? 'background-color 0.08s ease-out, border-color 0.08s ease-out, box-shadow 0.08s ease-out' : 'background-color 0.2s ease-in-out, border-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
                }}
            >
            {/* Input row - same as SideChatPanel (56px when no files so bar height 128 fits input + button row, no cutoff) */}
            <div 
              className="relative flex flex-col w-full" 
              style={{ 
                height: 'auto',
                minHeight: '28px',
                width: '100%',
                minWidth: '0',
                gap: '2px',
                flexShrink: 0,
                overflow: 'visible',
              }}
            >
            <AnimatePresence mode="wait">
              {attachedFiles.length > 0 && (
                <motion.div 
                  key="file-attachments-search"
                  initial={false}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.1, ease: "easeOut" }}
                  style={{ maxHeight: '52px', overflowY: 'auto', marginBottom: '12px', flexShrink: 0 }}
                  className="flex flex-wrap gap-2 justify-start"
                  layout={false}
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
                </motion.div>
              )}
            </AnimatePresence>
            
            {/* SegmentInput row - same as SideChatPanel (48px height, marginBottom 6px) */}
              <div
                className="flex items-start w-full"
                style={{ height: 'auto', minHeight: '28px', width: '100%', marginBottom: '6px', flexShrink: 0 }}
              >
                <div
                  ref={atMentionAnchorRef}
                  className="flex-1 relative flex items-start w-full"
                  style={{ overflow: 'visible', height: 'auto', minHeight: '28px', width: '100%', minWidth: '0', flexShrink: 0 }}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  onClick={(e) => e.stopPropagation()}
                >
                  {(segmentInput.getPlainText().trim() !== '' || propertyAttachments.length > 0 || atMentionDocumentChips.length > 0 || attachedFiles.length > 0) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        segmentInput.setSegments([{ type: "text", value: "" }]);
                        setAtMentionDocumentChips([]);
                        clearPropertyAttachments();
                        setAttachedFiles([]);
                        inputRef.current?.focus();
                      }}
                      className="absolute right-2 top-[11px] -translate-y-1/2 flex items-center justify-center w-6 h-6 text-gray-400 hover:text-gray-600 transition-colors z-10"
                      title="Clear query"
                      aria-label="Clear query"
                    >
                      <X className="w-5 h-5" strokeWidth={2} />
                    </button>
                  )}
                  <SegmentInput
                    ref={inputRef}
                    segments={segmentInput.segments}
                    cursor={segmentInput.cursor}
                    onCursorChange={(segmentIndex, offset) => segmentInput.setCursor({ segmentIndex, offset })}
                    onInsertText={(char) => {
                      if (char === '\n') {
                        handleSubmit(null as any);
                        return;
                      }
                      segmentInput.insertTextAtCursor(char);
                    }}
                    onBackspace={segmentInput.backspace}
                    onDelete={segmentInput.deleteForward}
                    onDeleteSegmentRange={segmentInput.removeSegmentRange}
                    onMoveLeft={segmentInput.moveCursorLeft}
                    onMoveRight={segmentInput.moveCursorRight}
                    onRemovePropertyChip={removePropertyAttachment}
                    onRemoveDocumentChip={(id) => {
                      toggleDocumentSelection(id);
                      setAtMentionDocumentChips((prev) => prev.filter((d) => d.id !== id));
                    }}
                    removeChipAtSegmentIndex={segmentInput.removeChipAtIndex}
                    restoreSelectionRef={restoreSelectionRef}
                    placeholder={contextConfig.placeholder}
                    placeholderFontSize="16.38px"
                    disabled={isSubmitted}
                    style={{
                      width: '100%',
                      height: '36px',
                      minHeight: '28px',
                      maxHeight: contextConfig.position === "bottom" && !isMapVisible ? 'calc(100vh - 200px)' : isMapVisible ? '120px' : isDashboardView ? '160px' : '350px',
                      overflowY: 'auto',
                      overflowX: 'hidden',
                      lineHeight: '20px',
                      paddingTop: '12px',
                      paddingBottom: '4px',
                      paddingRight: '36px',
                      paddingLeft: '14px',
                      color: segmentInput.getPlainText() ? '#333333' : undefined,
                      boxSizing: 'border-box',
                    }}
                    scrollWrapperPaddingBottom={isMapVisible ? undefined : '14px'}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit(e);
                      }
                      if (e.key === 'Backspace' || e.key === 'Delete') {
                        isDeletingRef.current = true;
                        setTimeout(() => { isDeletingRef.current = false; }, 200);
                      }
                    }}
                  />
              </div>
              <AtMentionPopover
                open={atMentionOpen}
                anchorRef={atMentionAnchorRef}
                anchorRect={atAnchorRect}
                query={atQuery}
                placement={atPlacement}
                items={atItems}
                selectedIndex={atSelectedIndex}
                onSelect={handleAtSelect}
                onSelectedIndexChange={setAtSelectedIndex}
                onClose={() => {
                  setAtMentionOpen(false);
                  setAtItems([]);
                }}
              />
            </div>
            </div>
            {/* Button row - same as SideChatPanel (direct child of bar, bar padding applies) */}
            {(() => {
                const isVeryNarrow = false; // dashboard search bar: match SideChatPanel structure; set true for narrow layout if needed
                return (
                  <div
                    className={`relative flex w-full ${isVeryNarrow ? 'flex-col gap-2' : 'items-center justify-between'}`}
                    style={{
                      width: '100%',
                      minWidth: '0',
                      height: isVeryNarrow ? 'auto' : '36px',
                      minHeight: isVeryNarrow ? 'auto' : '36px',
                      flexShrink: 0,
                      overflow: 'hidden', // Prevent visual overflow while measuring
                      marginTop: '-4px',
                    }}
                  >
                    {/* Left: Plus (Attach), Mode selector, Model selector - same as SideChatPanel */}
                    <div className={`flex items-center gap-1 ${isVeryNarrow ? 'justify-start' : ''}`} style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>
                  {contextConfig.showMic && (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          files.forEach(file => handleFileUpload(file));
                          if (fileInputRef.current) {
                            fileInputRef.current.value = '';
                          }
                        }}
                        className="hidden"
                        accept="image/*,.pdf,.doc,.docx"
                      />
                      <ChatBarAttachDropdown
                        onAttachClick={() => fileInputRef.current?.click()}
                        toolsItems={onMapToggle != null ? [
                          {
                            id: 'web-search',
                            icon: Globe,
                            label: 'Search the web',
                            onClick: () => setIsWebSearchEnabled((prev) => !prev),
                          },
                          {
                            id: 'map',
                            icon: isMapVisible ? LibraryBig : MapPinHouse,
                            label: isMapVisible ? 'Back to search' : 'Go to map',
                            onClick: () => onMapToggle?.(),
                          },
                          ...(isMapVisible && onPanelToggle ? [{
                            id: 'chat',
                            icon: MessageCircle,
                            label: 'Chat',
                            onClick: () => onPanelToggle(),
                          }] : []),
                        ] : []}
                      />
                    </>
                  )}
                      {/* Mode Selector Dropdown - show labels on dashboard (same as Tools/Attach/Voice) */}
                      <ModeSelector compact={true} className="mr-2" />
                      {/* Model Selector Dropdown - icon only in chat bar */}
                      <ModelSelector compact={true} />
                      
                      {/* Panel Toggle Button - In map view, Chat is in Tools dropdown; otherwise show "Expand chat" or "Analyse" */}
                      {onPanelToggle && !isMapVisible && (
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
                          transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
                          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                          whiteSpace: 'nowrap',
                          marginLeft: hasPreviousSession && isMapVisible ? '8px' : '4px',
                          animation: 'none',
                          height: '24px',
                          minHeight: '24px'
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
                        <Brain className="w-5 h-5" strokeWidth={2} style={{ animation: 'none' }} />
                        <span style={{ animation: 'none' }}>Analyse</span>
                    </button>
                    ) : (
                      <button
                        type="button"
                        onClick={onPanelToggle}
                        className="flex items-center gap-1.5 px-2 py-1 text-gray-900 transition-colors focus:outline-none outline-none"
                        style={{
                          backgroundColor: '#F5F5F5',
                          border: '1px solid rgba(229, 231, 235, 0.5)',
                          borderRadius: '9999px',
                          transition: 'background-color 0.2s ease',
                          marginLeft: hasPreviousSession && isMapVisible ? '8px' : '4px',
                          height: '24px',
                          minHeight: '24px'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#EBEBEB';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = '#F5F5F5';
                        }}
                        title="Expand chat"
                      >
                        <MessageCircle className="w-5 h-5" strokeWidth={1.5} />
                        <span className="text-xs font-medium">Chat</span>
                      </button>
                    )
                      )}
                    </div>

                    {/* Right Icons - same as SideChatPanel */}
                    <div className={`flex items-center gap-1.5 flex-shrink-0 ${isVeryNarrow ? 'flex-wrap justify-end' : ''}`} style={{ marginRight: '4px' }}>
                {/* Document Selection Toggle Button - Only show when property details panel is open */}
                {isPropertyDetailsOpen && (
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
                            <X className="w-5 h-5" strokeWidth={2} />
                          </button>
                        )}
                      </div>
                    )}
                
                      {/* WebSearchPill when on, Voice, Send */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                  {onMapToggle != null && isWebSearchEnabled && (
                    <WebSearchPill onDismiss={() => setIsWebSearchEnabled(false)} />
                  )}
                  {contextConfig.showMic && (
                    <button
                      type="button"
                      onClick={() => {}}
                      className="flex items-center justify-center text-gray-900 transition-colors focus:outline-none outline-none"
                      style={{
                        backgroundColor: '#F3F3F3',
                        transition: 'background-color 0.2s ease',
                        width: '32px',
                        height: '32px',
                        minWidth: '32px',
                        minHeight: '32px',
                        padding: '6px',
                        borderRadius: '50%'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#EBEBEB';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '#F3F3F3';
                      }}
                    >
                      <AudioLines className="w-5 h-5" strokeWidth={1.5} />
                    </button>
                  )}
                
                <AnimatePresence>
                  {(searchValue.trim() || attachedFiles.length > 0 || propertyAttachments.length > 0) && (
                    <motion.button 
                      key="send-button"
                      type="submit" 
                      onClick={handleSubmit} 
                      initial={{ opacity: 1, scale: 1 }}
                      animate={{ opacity: 1, scale: 1, backgroundColor: '#4A4A4A' }}
                      exit={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0 }}
                      className={`flex items-center justify-center relative focus:outline-none outline-none ${!isSubmitted ? '' : 'cursor-not-allowed'}`}
                      style={{
                        width: '36px',
                        height: '36px',
                        minWidth: '36px',
                        minHeight: '36px',
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
                        <ArrowUp className="w-6 h-6" strokeWidth={2.5} style={{ color: '#ffffff' }} />
                      </motion.div>
                    </motion.button>
                  )}
                </AnimatePresence>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
        </form>
        </div>
      </div>
      {/* Document Preview Modal is now rendered at MainContent level using shared context */}
    </div>
  );
});
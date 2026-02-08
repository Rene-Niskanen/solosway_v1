"use client";

import * as React from "react";
import { useMemo } from "react";
import { createPortal, flushSync } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { generateAnimatePresenceKey, generateConditionalKey, generateUniqueKey } from '../utils/keyGenerator';
import { ChevronRight, ChevronDown, ChevronUp, ArrowUp, Paperclip, Mic, Map, X, SquareDashedMousePointer, Scan, Fullscreen, Plus, PanelLeftOpen, PanelRightClose, PictureInPicture2, Trash2, CreditCard, MoveDiagonal, Square, FileText, Image as ImageIcon, File as FileIcon, FileCheck, Minimize, Minimize2, Workflow, Home, FolderOpen, Brain, AudioLines, MessageCircleDashed, Copy, Search, Lock, Pencil, Check, Highlighter, SlidersHorizontal, BookOpen } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { FileAttachment, FileAttachmentData } from './FileAttachment';
import { PropertyAttachmentData } from './PropertyAttachment';
import { AtMentionChip } from './AtMentionChip';
import { toast } from "@/hooks/use-toast";
import { usePreview, type CitationHighlight } from '../contexts/PreviewContext';
import { useChatStateStore, useActiveChatDocumentPreview } from '../contexts/ChatStateStore';
import { usePropertySelection } from '../contexts/PropertySelectionContext';
import { useDocumentSelection } from '../contexts/DocumentSelectionContext';
import { useFilingSidebar } from '../contexts/FilingSidebarContext';
import { useChatPanel } from '../contexts/ChatPanelContext';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import veloraLogo from '/Velora Logo.jpg';
import citationIcon from '/citation.png';
import agentIcon from '/agent.png';

// Configure PDF.js worker globally (same as other components)
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;
import { PropertyData } from './PropertyResultsDisplay';
import { useChatHistory } from './ChatHistoryContext';
import { backendApi } from '../services/backendApi';
import { QuickStartBar } from './QuickStartBar';
import { ReasoningSteps, ReasoningStep } from './ReasoningSteps';
import { ResponseModeChoice } from './FileChoiceStep';
import { ModeSelector } from './ModeSelector';
import { ModelSelector } from './ModelSelector';
import { useMode } from '../contexts/ModeContext';
import { useModel } from '../contexts/ModelContext';
import { useBrowserFullscreen } from '../contexts/BrowserFullscreenContext';
import { BotStatusOverlay } from './BotStatusOverlay';
import { WebSearchPill } from './SelectedModePill';
import { PlanViewer, PlanBuildStatus } from './PlanViewer';
import { ExpandedPlanViewer } from './ExpandedPlanViewer';
import { AdjustmentBlock, AdjustmentBlockData } from './AdjustmentBlock';
import { PlanReasoningSteps, ReasoningStep as PlanReasoningStep } from './PlanReasoningSteps';
import { diffLines } from 'diff';
import { AtMentionPopover } from './AtMentionPopover';
import type { AtMentionItem } from './AtMentionPopover';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { getFilteredAtMentionItems, preloadAtMentionCache } from '@/services/atMentionCache';
import { SegmentInput, type SegmentInputHandle } from './SegmentInput';
import { useSegmentInput, buildInitialSegments } from '@/hooks/useSegmentInput';
import { isTextSegment, isChipSegment, contentSegmentsToLinkedQuery, segmentsToLinkedQuery, type QueryContentSegment, type ChipSegment } from '@/types/segmentInput';
import { CitationClickPanel } from './CitationClickPanel';

/** Strip HTML/SVG tags from query string so submitted text never includes e.g. <svg /> from icons. */
function stripHtmlFromQuery(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// ============================================================================
// CHAT PANEL WIDTH CONSTANTS
// Single source of truth for all width values used in chat panel calculations
// ============================================================================
export const CHAT_PANEL_WIDTH = {
  /** Default collapsed width (px) */
  COLLAPSED: 382.5,
  /** Expanded width as viewport percentage */
  EXPANDED_VW: 42.5,
  /** Minimum width during navigation tasks (px) */
  NAV_MIN: 380,
  /** Minimum width for document preview when open (px) - matches chat collapsed width */
  DOC_PREVIEW_MIN: 380,
} as const;

/** Rotating titles for new-chat empty state (ChatGPT-style); one shown per session */
const EMPTY_CHAT_TITLE_MESSAGES = [
  'What are you working on?',
  'What can I help you with today?',
  'What would you like to accomplish?',
] as const;

// ============================================================================
// UNIFIED WIDTH CALCULATION
// Single function used by both useEffect (parent notification) and inline styles
// ============================================================================
interface WidthCalculationParams {
  draggedWidth: number | null;
  isExpanded: boolean;
  isFullscreenMode: boolean;
  isDocumentPreviewOpen: boolean;
  isPropertyDetailsOpen: boolean;
  sidebarWidth: number;
  chatPanelWidth: number;
  isChatPanelOpen: boolean;
  shouldExpand?: boolean;
  isManualFullscreen?: boolean;
}

interface WidthCalculationResult {
  /** Width as a number (in pixels) - used for parent notification */
  widthPx: number;
  /** Width as CSS string - used for inline styles */
  widthCss: string;
}

/**
 * Unified width calculation for the chat panel.
 * Returns both pixel value (for parent notification) and CSS string (for inline styles).
 * 
 * Priority order:
 * 1. draggedWidth - user has manually resized
 * 2. fullscreen mode (no document preview) - full available width
 * 3. document preview or property details open - 50% split
 * 4. expanded mode - 42.5vw
 * 5. collapsed - 382.5px (capped to available space)
 */
export function calculateChatPanelWidth(params: WidthCalculationParams): WidthCalculationResult {
  const {
    draggedWidth,
    isExpanded,
    isFullscreenMode,
    isDocumentPreviewOpen,
    isPropertyDetailsOpen,
    sidebarWidth,
    chatPanelWidth,
    isChatPanelOpen,
    shouldExpand = false,
    isManualFullscreen = false,
  } = params;

  const chatPanelOffset = isChatPanelOpen ? chatPanelWidth : 0;
  const availableWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) - sidebarWidth - chatPanelOffset;
  const shouldUse50Percent = isDocumentPreviewOpen || isPropertyDetailsOpen;

  // PRIORITY 1: User has manually resized the panel
  if (draggedWidth !== null) {
    return {
      widthPx: draggedWidth,
      widthCss: `${draggedWidth}px`,
    };
  }

  // PRIORITY 2: Fullscreen mode (from dashboard or explicit) - but NOT when document preview is open
  // Unless user manually requested fullscreen (overrides document preview)
  if ((shouldExpand || isFullscreenMode) && (!shouldUse50Percent || isManualFullscreen)) {
    return {
      widthPx: availableWidth,
      widthCss: `calc(100vw - ${sidebarWidth}px - ${chatPanelOffset}px)`,
    };
  }

  // PRIORITY 3: Document preview or property details is open - 50% split
  // Use viewport minus sidebar only (do NOT subtract chatPanelWidth) to avoid feedback loop:
  // otherwise we'd set width = (viewport - sidebar - chatWidth)/2, report it, then recalc with
  // the new chatWidth and get a different value, causing glitchy re-renders when at or below 50/50.
  if (isExpanded && shouldUse50Percent) {
    const availableForSplit = (typeof window !== 'undefined' ? window.innerWidth : 1920) - sidebarWidth;
    const halfWidth = availableForSplit / 2;
    return {
      widthPx: halfWidth,
      widthCss: `calc((100vw - ${sidebarWidth}px) / 2)`,
    };
  }

  // PRIORITY 4: Expanded mode (no document preview) - 42.5vw
  if (isExpanded) {
    const expandedWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) * (CHAT_PANEL_WIDTH.EXPANDED_VW / 100) - chatPanelOffset;
    if (chatPanelOffset > 0) {
      return {
        widthPx: expandedWidth,
        widthCss: `calc(${CHAT_PANEL_WIDTH.EXPANDED_VW}vw - ${chatPanelOffset}px)`,
      };
    }
    return {
      widthPx: expandedWidth,
      widthCss: `${CHAT_PANEL_WIDTH.EXPANDED_VW}vw`,
    };
  }

  // PRIORITY 5: Collapsed - fixed width capped to available space
  const collapsedWidth = Math.min(CHAT_PANEL_WIDTH.COLLAPSED, availableWidth);
  if (chatPanelOffset > 0) {
    return {
      widthPx: collapsedWidth,
      widthCss: `min(${CHAT_PANEL_WIDTH.COLLAPSED}px, calc(100vw - ${sidebarWidth}px - ${chatPanelOffset}px))`,
    };
  }
  return {
    widthPx: collapsedWidth,
    widthCss: `${CHAT_PANEL_WIDTH.COLLAPSED}px`,
  };
}

// ChatGPT-style thinking dot animation
const ThinkingDot: React.FC = () => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '8px 0' }}>
      <style>
        {`
          @keyframes thinking-bounce {
            0%, 100% {
              transform: scale(1);
              opacity: 0.7;
            }
            50% {
              transform: scale(1.3);
              opacity: 1;
            }
          }
          .thinking-dot {
            width: 8px;
            height: 8px;
            background-color: #111827;
            border-radius: 50%;
            animation: thinking-bounce 1.2s ease-in-out infinite;
          }
        `}
      </style>
      <div className="thinking-dot" />
    </div>
  );
};

// Streaming response text - shows rendered markdown with smooth line-by-line reveal
// Tracks animated messages to prevent re-animation on re-renders
const animatedMessagesSet = new Set<string>();

// Helper function to complete incomplete markdown so ReactMarkdown can render formatted output
// This makes streaming text render in its final formatted form word-by-word, like ChatGPT
// The goal is to ensure ReactMarkdown can always parse and render formatted output, never raw markdown
// IMPORTANT: This function should produce consistent output - if text is already complete,
// it should return the same result whether streaming or not, to prevent re-renders
const completeIncompleteMarkdown = (text: string, isStreaming: boolean): string => {
  if (!text) return text;
  
  // Always process the text to ensure it's parseable by ReactMarkdown
  // This ensures consistent rendering whether streaming or not
  // When not streaming, the text should already be complete, but we still check for edge cases
  // CRITICAL: For complete text (not streaming), return as-is to prevent adding temporary markers
  // that would cause a re-render when streaming completes
  let completed = text;
  
  // During streaming, complete markdown syntax so ReactMarkdown can parse and render formatted output
  // This ensures we see formatted text progressively, not raw markdown that "clicks into place"
  // Only add temporary closing markers during streaming - when not streaming, assume text is complete
  const shouldAddTemporaryMarkers = isStreaming;
  
  // Process from the end backwards to handle the most recent incomplete syntax first
  
  // 1. Check for incomplete code blocks (```)
  // Only add temporary markers during streaming
  if (shouldAddTemporaryMarkers) {
    const codeBlockMatches = completed.match(/```/g);
    if (codeBlockMatches && codeBlockMatches.length % 2 === 1) {
      // Odd number of ``` means incomplete code block - close it
      const lastCodeBlockIndex = completed.lastIndexOf('```');
      const textAfterCodeBlock = completed.substring(lastCodeBlockIndex + 3);
      // If there's text after the last ``` but no closing ```, it's incomplete
      if (textAfterCodeBlock && !textAfterCodeBlock.includes('```')) {
        // Check if we're in the middle of a code block (not just starting one)
        const beforeCodeBlock = completed.substring(0, lastCodeBlockIndex);
        const hasContentBefore = beforeCodeBlock.trim().length > 0;
        if (hasContentBefore) {
          completed += '\n```';
        }
      }
    }
  }
  
  // 2. Check for incomplete inline code (`)
  // Only check if not part of a code block, and only during streaming
  if (shouldAddTemporaryMarkers) {
    const codeBlockPattern = /```[\s\S]*?```/g;
    const withoutCodeBlocks = completed.replace(codeBlockPattern, '');
    const inlineCodeMatches = withoutCodeBlocks.match(/`/g);
    if (inlineCodeMatches && inlineCodeMatches.length % 2 === 1) {
      // Odd number of ` means incomplete inline code - close it
      // Find the last backtick that's not part of a code block
      let lastBacktickIndex = -1;
      for (let i = completed.length - 1; i >= 0; i--) {
        if (completed[i] === '`') {
          // Check if it's part of a code block
          const before = completed.substring(0, i);
          const after = completed.substring(i + 1);
          const codeBlocksBefore = (before.match(/```/g) || []).length;
          if (codeBlocksBefore % 2 === 0) {
            // Not inside a code block
            lastBacktickIndex = i;
            break;
          }
        }
      }
      if (lastBacktickIndex !== -1) {
        const textAfterBacktick = completed.substring(lastBacktickIndex + 1);
        if (textAfterBacktick && !textAfterBacktick.includes('`')) {
          completed = completed.substring(0, lastBacktickIndex + 1) + '`' + completed.substring(lastBacktickIndex + 1);
        }
      }
    }
  }
  
  // 3. Check for incomplete bold markers (**)
  // Only add temporary markers during streaming
  if (shouldAddTemporaryMarkers) {
    const boldMatches = completed.match(/\*\*/g);
    if (boldMatches && boldMatches.length % 2 === 1) {
      // Odd number of ** means incomplete bold - close it temporarily so ReactMarkdown can render it
      const lastBoldIndex = completed.lastIndexOf('**');
      const textAfterLastBold = completed.substring(lastBoldIndex + 2);
      // If there's text after the last ** but no closing **, it's incomplete
      if (textAfterLastBold && !textAfterLastBold.includes('**')) {
        completed += '**';
      }
    }
  }
  
  // 4. Check for incomplete italic markers (*) - only if not part of bold
  // Only add temporary markers during streaming
  if (shouldAddTemporaryMarkers) {
    // Find single asterisks that aren't part of **
    let lastItalicIndex = -1;
    for (let i = completed.length - 1; i >= 0; i--) {
      if (completed[i] === '*') {
        // Check if it's part of ** (bold)
        if (i > 0 && completed[i - 1] === '*') {
          // This is part of **, skip it
          i--; // Skip the other * too
          continue;
        }
        if (i < completed.length - 1 && completed[i + 1] === '*') {
          // This is part of **, skip it
          continue;
        }
        // This is a single *, check if it's incomplete
        lastItalicIndex = i;
        break;
      }
    }
    if (lastItalicIndex !== -1) {
      // Count single asterisks before this one (excluding **)
      let singleAsteriskCount = 0;
      for (let i = 0; i < lastItalicIndex; i++) {
        if (completed[i] === '*') {
          // Check if it's part of **
          if (i > 0 && completed[i - 1] === '*') continue;
          if (i < completed.length - 1 && completed[i + 1] === '*') continue;
          singleAsteriskCount++;
        }
      }
      // If odd number, we need to close it
      if (singleAsteriskCount % 2 === 0) {
        // Even number before, so this opening one is incomplete
        const textAfterItalic = completed.substring(lastItalicIndex + 1);
        if (textAfterItalic && !textAfterItalic.includes('*')) {
          completed += '*';
        }
      }
    }
  }
  
  // 5. Check for incomplete links [text](url
  // Only add temporary markers during streaming
  if (shouldAddTemporaryMarkers) {
    const linkPattern = /\[([^\]]*)\]\(([^)]*)$/;
    const incompleteLinkMatch = completed.match(linkPattern);
    if (incompleteLinkMatch) {
      // Close the link with empty URL or placeholder
      completed = completed.replace(linkPattern, '[$1]()');
    }
  }
  
  // 6. Ensure headings are parseable by ReactMarkdown
  // Always check this (not just during streaming) to ensure proper parsing
  const lines = completed.split('\n');
  let needsNewline = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const headingMatch = line.match(/^(##+)\s+(.+)$/);
    if (headingMatch) {
      // If this heading is at the end or followed by incomplete content, ensure it has a newline
      if (i === lines.length - 1 && !completed.endsWith('\n')) {
        needsNewline = true;
      }
      break; // Only check the last heading
    }
  }
  if (needsNewline) {
    completed += '\n';
  }
  
  // 7. Handle incomplete lists - if we're in the middle of a list item, ensure proper formatting
  const lastLine = lines[lines.length - 1];
  const isListItem = /^[\s]*[-*+]\s+/.test(lastLine) || /^[\s]*\d+\.\s+/.test(lastLine);
  if (isListItem && !completed.endsWith('\n') && lines.length > 1) {
    // If we're in a list item and it's not complete, ensure it's properly formatted
    // This prevents raw markdown from showing
  }
  
  return completed;
};

// Helper to check if text has incomplete markdown that needs completion
// Returns true if there are unclosed bold (**), italic (*), code blocks (```), or inline code (`)
const hasIncompleteMarkdown = (text: string): boolean => {
  if (!text) return false;
  
  // Check for incomplete code blocks (```)
  const codeBlockMatches = text.match(/```/g);
  if (codeBlockMatches && codeBlockMatches.length % 2 === 1) {
    return true;
  }
  
  // Check for incomplete inline code (`) - excluding those in code blocks
  const codeBlockPattern = /```[\s\S]*?```/g;
  const withoutCodeBlocks = text.replace(codeBlockPattern, '');
  const inlineCodeMatches = withoutCodeBlocks.match(/`/g);
  if (inlineCodeMatches && inlineCodeMatches.length % 2 === 1) {
    return true;
  }
  
  // Check for incomplete bold markers (**)
  const boldMatches = text.match(/\*\*/g);
  if (boldMatches && boldMatches.length % 2 === 1) {
    return true;
  }
  
  // Check for incomplete italic markers (*) - excluding those that are part of **
  let singleAsteriskCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '*') {
      // Check if it's part of ** (bold)
      if (i > 0 && text[i - 1] === '*') continue;
      if (i < text.length - 1 && text[i + 1] === '*') continue;
      singleAsteriskCount++;
    }
  }
  if (singleAsteriskCount % 2 === 1) {
    return true;
  }
  
  // Check for incomplete links [text](url
  const incompleteLinkMatch = text.match(/\[([^\]]*)\]\(([^)]*)$/);
  if (incompleteLinkMatch) {
    return true;
  }
  
  return false;
};

// Extract complete markdown blocks from combined buffer
// Returns: { completeBlocks: string[], remainingBuffer: string }
// Pre-completes markdown in each block before returning
const extractMarkdownBlocks = (combined: string): { completeBlocks: string[], remainingBuffer: string } => {
  if (!combined.trim()) {
    return { completeBlocks: [], remainingBuffer: '' };
  }
  
  const lines = combined.split('\n');
  const completeBlocks: string[] = [];
  let remainingBuffer = '';
  let currentBlock = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLastLine = i === lines.length - 1;
    
    // Add line to current block
    currentBlock += (currentBlock ? '\n' : '') + line;
    
    // CRITICAL: Check if line ends at a word boundary
    // Streaming tokens can arrive mid-word (e.g., "## Key C" then "oncepts")
    // Only emit if line ends with whitespace, punctuation, or is blank
    const endsAtWordBoundary = /[\s.!?;:,)\]}>]$/.test(line) || line.trim() === '';
    
    // Check if this completes a block
    const isHeading = line.match(/^##+\s+.+$/);
    const endsWithPunctuation = line.match(/[.!?;:]\s*$/);
    const isBlankLine = line.trim() === '';
    const isLongEnough = line.trim().length > 50 && line.match(/\s/);
    
    // Determine if we should try to emit this block
    // CRITICAL: Only emit if at word boundary to prevent mid-word splits
    const shouldTryEmit = endsAtWordBoundary && (!isLastLine || isHeading || endsWithPunctuation || isBlankLine || isLongEnough);
    
    if (shouldTryEmit) {
      // Check if current block has incomplete markdown
      if (hasIncompleteMarkdown(currentBlock)) {
        // Keep accumulating - don't emit yet
        continue;
      }
      
      // Block is markdown-complete - pre-complete it and emit
      // Use completeIncompleteMarkdown to ensure it's properly formatted
      const completedBlock = completeIncompleteMarkdown(currentBlock + '\n', true);
      completeBlocks.push(completedBlock);
      currentBlock = '';
    }
  }
  
  // Whatever remains goes back to buffer
  if (currentBlock) {
    remainingBuffer = currentBlock;
  }
  
  return { completeBlocks, remainingBuffer };
};

// Main-answer tags for Google-style highlight (LLM wraps direct answer; frontend strips and highlights)
const MAIN_ANSWER_START = '<<<MAIN>>>';
const MAIN_ANSWER_END = '<<<END_MAIN>>>';

export function parseMainAnswerTags(text: string): { before: string; main: string | null; after: string } | { main: null; fullStrippedText: string } {
  const startIdx = text.indexOf(MAIN_ANSWER_START);
  const endIdx = text.indexOf(MAIN_ANSWER_END);
  if (startIdx === -1 && endIdx === -1) {
    return { main: null, fullStrippedText: text };
  }
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // Malformed: strip tags from display and show as one block
    const stripped = text.split(MAIN_ANSWER_START).join('').split(MAIN_ANSWER_END).join('');
    return { main: null, fullStrippedText: stripped };
  }
  const before = text.slice(0, startIdx).trimEnd();
  const main = text.slice(startIdx + MAIN_ANSWER_START.length, endIdx).trim();
  const after = text.slice(endIdx + MAIN_ANSWER_END.length).trimStart();
  return { before, main, after };
}

export const MainAnswerHighlight: React.FC<{
  children: React.ReactNode;
  /** When true (streaming), no highlight yet. When false, highlight shows (swoop or instant). */
  isStreaming?: boolean;
  /** When true, run the swoop animation. When false, show blue at full size instantly (e.g. when restoring after orange chip removed). */
  runSwoop?: boolean;
}> = ({ children, isStreaming = false, runSwoop = true }) => {
  const runSwoopAnim = !isStreaming && runSwoop;
  return (
    <span className={`main-answer-highlight${runSwoopAnim ? ' main-answer-highlight-swoop' : ''}${!isStreaming && !runSwoop ? ' main-answer-highlight-instant' : ''}`}>
      <style>{`
        .main-answer-highlight {
          display: inline;
          margin: 0;
          padding: 0;
          border-radius: 4px;
          font-weight: 800;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
          background: linear-gradient(90deg, rgba(220, 228, 238, 0.85) 0%, rgba(220, 228, 238, 0.85) 100%);
          background-repeat: no-repeat;
          background-size: 0% 100%;
        }
        .main-answer-highlight.main-answer-highlight-instant {
          background-size: 100% 100%;
        }
        .main-answer-highlight.main-answer-highlight-swoop {
          animation: main-answer-highlight-swoop 1.1s cubic-bezier(0.22, 1, 0.36, 1) 0.6s forwards;
        }
        @keyframes main-answer-highlight-swoop {
          to {
            background-size: 100% 100%;
          }
        }
        .main-answer-highlight p {
          margin: 0;
          display: inline;
        }
      `}</style>
      {children}
    </span>
  );
};

// Orange swoop highlight for cited text when user has added a citation-snippet chip (follow-up question)
const OrangeCitationSwoopHighlight: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="orange-citation-swoop">
    <style>{`
      .orange-citation-swoop {
        display: inline;
        margin: 0;
        padding: 0;
        border-radius: 4px;
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
        background: linear-gradient(90deg, #F5EBD9 0%, #F5EBD9 100%);
        background-repeat: no-repeat;
        background-size: 0% 100%;
        animation: orange-citation-swoop 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.2s forwards;
      }
      @keyframes orange-citation-swoop {
        to {
          background-size: 100% 100%;
        }
      }
      .orange-citation-swoop p {
        margin: 0;
        display: inline;
      }
    `}</style>
    {children}
  </span>
);

const StreamingResponseText: React.FC<{
  text: string;
  isStreaming: boolean;
  citations?: Record<string, any>;
  handleCitationClick: (citationData: any, anchorRect?: DOMRect, citationNumber?: string) => void;
  renderTextWithCitations: (text: string, citations: any, handleClick: any, seen: Set<string>) => React.ReactNode;
  onTextUpdate?: () => void;
  messageId?: string; // Unique ID for this message to track animation state
  skipHighlight?: boolean; // When true (e.g. error messages), do not apply main-answer highlight
  showCitations?: boolean; // When false, strip citation markers from text
  orangeCitationNumbers?: Set<string>; // Citation numbers (e.g. "0","1") to highlight in orange (cited text when chip is in input)
  selectedCitationNumber?: string; // When citation click panel is open, the citation number that was clicked
  selectedCitationMessageId?: string; // When citation click panel is open, the message id that owns that citation
}> = ({ text, isStreaming, citations, handleCitationClick, renderTextWithCitations, onTextUpdate, messageId, skipHighlight, showCitations = true, orangeCitationNumbers, selectedCitationNumber, selectedCitationMessageId }) => {
  const [shouldAnimate, setShouldAnimate] = React.useState(false);
  const hasAnimatedRef = React.useRef(false);
  const hasSwoopedBlueRef = React.useRef(false);
  const runBlueSwoop = !skipHighlight && !isStreaming && !hasSwoopedBlueRef.current;
  if (!skipHighlight) hasSwoopedBlueRef.current = true;

  if (!text) {
    return null;
  }
  
  // Text is already pre-completed at the streaming layer (extractMarkdownBlocks)
  // No need for runtime markdown completion - text is always valid markdown
  // Filter out unwanted phrases about opening documents
  const filteredText = React.useMemo(() => {
    let cleaned = text;
    // Remove phrases about opening documents (case-insensitive)
    const unwantedPhrases = [
      /i will now open the document to show you the source\.?/gi,
      /i will now open the document\.?/gi,
      /i'll open the document\.?/gi,
      /let me open the document\.?/gi,
      /i'm going to open the document\.?/gi,
      /i am going to open the document\.?/gi,
      /opening the (?:citation|document) (?:view|panel)\.?/gi,
      /i will (?:now )?(?:show|display) (?:you )?(?:the )?(?:source|document)\.?/gi,
      /to provide you with the source\.?/gi,
    ];
    unwantedPhrases.forEach(pattern => {
      cleaned = cleaned.replace(pattern, '').trim();
    });
    return cleaned;
  }, [text]);
  
  // Use a stable key - ReactMarkdown will automatically re-render when content changes
  // Changing the key causes expensive remounts which create delays, especially at the end
  // ReactMarkdown's internal diffing handles content updates efficiently
  const markdownKey = `markdown-${messageId}`;
  
  // Memoize the processed text to prevent unnecessary re-processing
  const processedText = React.useMemo(() => {
    return filteredText;
  }, [filteredText]);

  // Helper to ensure balanced bold markers for display (avoid leaking **)
  const ensureBalancedBoldForDisplay = (text: string): string => {
    const count = (text.match(/\*\*/g) || []).length;
    if (count % 2 !== 0) {
      // Odd number of ** - strip trailing ** if present, otherwise append one
      if (text.trimEnd().endsWith('**')) {
        return text.trimEnd().slice(0, -2);
      }
      return text + '**';
    }
    return text;
  };

  // Insert paragraph breaks before bold section labels (e.g. **Flood Zone 2:**, **Surface Water Flooding:**)
  // so multi-section answers render with visual separation instead of one long paragraph
  const ensureParagraphBreaksBeforeBoldSections = (text: string): string => {
    return text.replace(/(\.\s*|\s-\s)\s*\*\*([^*]+):\*\*/g, '$1\n\n**$2:**');
  };

  // Parse <<<MAIN>>>...<<<END_MAIN>>> (LLM wraps the direct answer); replace with placeholders so we highlight each segment
  // Match 1–3 closing > so malformed tags (<<<END_MAIN>, <<<END_MAIN>>, <<<END_MAIN>>>) are stripped
  const mainTagEndRe = /<<<END_MAIN\s*>+/;
  const { mainSegments, textWithTagsStripped } = React.useMemo(() => {
    const segments: string[] = [];
    let text = processedText.replace(/<<<MAIN>>>(.*?)<<<END_MAIN\s*>+/gs, (_match: string, content: string) => {
      segments.push(content.trim());
      return `%%MAIN_${segments.length - 1}%%`;
    });
    // Strip any remaining raw MAIN/END_MAIN tags that didn't match (malformed)
    text = text.replace(/<<<MAIN>>>/g, '').replace(mainTagEndRe, '');
    return { mainSegments: segments, textWithTagsStripped: text };
  }, [processedText]);

  // Process citations on the full text BEFORE ReactMarkdown splits it
  // This ensures citations are matched even if ReactMarkdown splits text across elements
  // When showCitations is false, strip citation markers instead of rendering them
  const processCitationsBeforeMarkdown = (text: string): string => {
    if (!showCitations) {
      // Strip citation markers: [1], [2], and superscript ¹ ² etc.
      let stripped = text.replace(/\[(\d+)\]/g, '').replace(/[¹²³⁴⁵⁶⁷⁸⁹]+(?:\d+)?/g, '');
      // Clean up double spaces or space before punctuation left by removal
      stripped = stripped.replace(/\s+\./g, '.').replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ');
      return stripped;
    }
    if (!citations || Object.keys(citations).length === 0) {
      return text;
    }
    
    // Map superscript characters to numbers
    const superscriptMap: Record<string, string> = {
      '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5',
      '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9'
    };
    
    const superscriptPattern = /[¹²³⁴⁵⁶⁷⁸⁹]+(?:\d+)?/g;
    const bracketPattern = /\[(\d+)\]/g;
    
    let processedText = text;
    
    // Process superscript citations
    processedText = processedText.replace(superscriptPattern, (match) => {
      let numStr = '';
      for (const char of match) {
        numStr += superscriptMap[char] || (/\d/.test(char) ? char : '');
      }
      const citData = citations[numStr];
      if (citData) {
        return `%%CITATION_SUPERSCRIPT_${numStr}%%`;
      }
      // Always use placeholder for consistent rendering (no visual shift when streaming ends)
      return `%%CITATION_PENDING_${numStr}%%`;
    });
    
    // Clean up periods that follow citations (both bracket and superscript)
    // Remove periods immediately after bracket citations: [1]. -> [1]
    processedText = processedText.replace(/\[(\d+)\]\.(?=\s|$)/g, '[$1]');
    // Remove periods immediately after superscript citations: ¹. -> ¹
    processedText = processedText.replace(/([¹²³⁴⁵⁶⁷⁸⁹]+(?:\d+)?)\.(?=\s|$)/g, '$1');
    
    // Process bracket citations
    processedText = processedText.replace(bracketPattern, (match, num) => {
      const citData = citations[num];
      if (citData) {
        return `%%CITATION_BRACKET_${num}%%`;
      }
      // Always use placeholder for consistent rendering (no visual shift when streaming ends)
      return `%%CITATION_PENDING_${num}%%`;
    });
    
    return processedText;
  };
  
  // Process citations before markdown parsing (and insert paragraph breaks before bold section labels)
  const textWithCitationPlaceholders = React.useMemo(() => {
    const withBold = ensureBalancedBoldForDisplay(textWithTagsStripped);
    const withSections = ensureParagraphBreaksBeforeBoldSections(withBold);
    return processCitationsBeforeMarkdown(withSections);
  }, [textWithTagsStripped, citations, showCitations]);
  
  // Helper to render citation placeholders (no deduplication - show all citations)
  const isCitationSelected = (num: string) =>
    selectedCitationNumber != null && selectedCitationMessageId != null && selectedCitationMessageId === messageId && selectedCitationNumber === num;

  const renderCitationPlaceholder = (placeholder: string, key: string): React.ReactNode => {
    const superscriptMatch = placeholder.match(/^%%CITATION_SUPERSCRIPT_(\d+)%%$/);
    const bracketMatch = placeholder.match(/^%%CITATION_BRACKET_(\d+)%%$/);
    const pendingSuperscriptMatch = placeholder.match(/^%%CITATION_PENDING_(\d+)%%$/);
    const pendingBracketMatch = placeholder.match(/^%%CITATION_PENDING_(\d+)%%$/);
    
    // Handle pending citations - check if data is now available
    if (pendingSuperscriptMatch || pendingBracketMatch) {
      const num = pendingSuperscriptMatch?.[1] || pendingBracketMatch?.[1];
      if (num) {
        const citData = citations?.[num];
        if (citData) {
          // Citation data now available - render as link
          return <CitationLink key={key} citationNumber={num} citationData={citData} onClick={handleCitationClick} isSelected={isCitationSelected(num)} />;
        }
        // Still pending - show as plain number during streaming
        return isStreaming ? <span key={key} style={{ opacity: 0.5 }}>[{num}]</span> : <span key={key}>[{num}]</span>;
      }
    }
    
    if (superscriptMatch) {
      const num = superscriptMatch[1];
      const citData = citations?.[num];
      if (citData) {
        return <CitationLink key={key} citationNumber={num} citationData={citData} onClick={handleCitationClick} isSelected={isCitationSelected(num)} />;
      }
    } else if (bracketMatch) {
      const num = bracketMatch[1];
      const citData = citations?.[num];
      if (citData) {
        return <CitationLink key={key} citationNumber={num} citationData={citData} onClick={handleCitationClick} isSelected={isCitationSelected(num)} />;
      }
    }
    // No citation data found - return placeholder as text (shouldn't happen)
    return placeholder;
  };
  
  // Helper to render plain text (no pattern-based highlighting – highlighting is LLM-driven via <<<MAIN>>> tags only)
  const renderTextSegment = (text: string): React.ReactNode[] => {
    return [<React.Fragment key="text-segment">{text}</React.Fragment>];
  };

  const citationPlaceholderRe = /(%%CITATION_(?:SUPERSCRIPT|BRACKET|PENDING)_\d+%%)/g;
  const citationNumFromPlaceholder = (placeholder: string): string | null => {
    const m = placeholder.match(/^%%CITATION_(?:SUPERSCRIPT|BRACKET|PENDING)_(\d+)%%$/);
    return m ? m[1]! : null;
  };

  // Turn a single string segment into React nodes (MAIN placeholder split + render)
  const renderStringSegment = (part: string, keyPrefix: string): React.ReactNode[] => {
    const mainPlaceholderRe = /%%MAIN_(\d+)%%/g;
    const mainParts = part.split(mainPlaceholderRe);
    const nodesToAdd: React.ReactNode[] = [];
    for (let i = 0; i < mainParts.length; i++) {
      const segment = mainParts[i];
      if (i % 2 === 1) {
        const n = parseInt(segment, 10);
        if (n >= 0 && n < mainSegments.length) {
          nodesToAdd.push(
            skipHighlight ? (
              <React.Fragment key={`${keyPrefix}-main-${n}`}>{mainSegments[n]}</React.Fragment>
            ) : (
              <MainAnswerHighlight key={`${keyPrefix}-main-${n}`} isStreaming={isStreaming} runSwoop={runBlueSwoop}>
                {mainSegments[n]}
              </MainAnswerHighlight>
            )
          );
        }
      } else if (segment) {
        nodesToAdd.push(...renderTextSegment(segment).map((node, wrapIdx) =>
          React.isValidElement(node)
            ? React.cloneElement(node, { key: `${keyPrefix}-text-${i}-${wrapIdx}` })
            : <React.Fragment key={`${keyPrefix}-text-${i}-${wrapIdx}`}>{node}</React.Fragment>
        ));
      }
    }
    return nodesToAdd.length > 0 ? nodesToAdd : [<React.Fragment key={keyPrefix}>{part}</React.Fragment>];
  };

  // Flatten children into a list of segments (strings split by citation placeholder, elements as-is)
  // so we can treat the full run before each citation as "cited text" for orange highlight
  const flattenSegments = (nodes: React.ReactNode): (string | React.ReactElement)[] => {
    const out: (string | React.ReactElement)[] = [];
    React.Children.forEach(nodes, (child) => {
      if (typeof child === 'string') {
        child.split(citationPlaceholderRe).forEach((part) => out.push(part));
      } else if (React.isValidElement(child)) {
        out.push(child);
      }
    });
    return out;
  };

  // Process flattened segments: wrap the run before each citation in orange when that citation is in orangeCitationNumbers
  const processFlattenedWithCitations = (segments: (string | React.ReactElement)[], keyPrefix: string): React.ReactNode[] => {
    const result: React.ReactNode[] = [];
    let pending: (string | React.ReactElement)[] = [];
    let segIndex = 0;
    const flushPending = (wrapOrange: boolean, citKey: string) => {
      if (pending.length === 0) return;
      const content: React.ReactNode[] = [];
      pending.forEach((seg, i) => {
        if (typeof seg === 'string') {
          if (seg.startsWith('%%CITATION_')) return;
          content.push(...renderStringSegment(seg, `${keyPrefix}-p${segIndex}-${i}`));
        } else {
          const childChildren = (seg.props as any)?.children;
          const processed = childChildren !== undefined
            ? processChildrenWithCitations(childChildren)
            : (seg.props as any)?.children;
          content.push(React.cloneElement(seg, { key: `${keyPrefix}-el${segIndex}-${i}`, children: processed } as any));
        }
      });
      if (wrapOrange) {
        result.push(<OrangeCitationSwoopHighlight key={`${keyPrefix}-orange-${segIndex}-${citKey}`}>{content}</OrangeCitationSwoopHighlight>);
      } else {
        result.push(...content);
      }
      pending = [];
      segIndex += 1;
    };
    segments.forEach((seg, i) => {
      if (typeof seg === 'string' && seg.startsWith('%%CITATION_')) {
        const num = citationNumFromPlaceholder(seg);
        flushPending(num != null && (orangeCitationNumbers?.has(num) ?? false), seg);
        const citationNode = renderCitationPlaceholder(seg, `${keyPrefix}-cit-${i}-${seg}`);
        if (citationNode != null) result.push(<React.Fragment key={`${keyPrefix}-cit-${i}`}>{citationNode}</React.Fragment>);
      } else {
        pending.push(seg);
      }
    });
    flushPending(false, 'end');
    return result;
  };

  // Helper to process children and replace citation placeholders + MAIN answer placeholders
  const processChildrenWithCitations = (nodes: React.ReactNode): React.ReactNode => {
    return React.Children.map(nodes, child => {
      if (typeof child === 'string') {
        const parts = child.split(citationPlaceholderRe);
        const result: React.ReactNode[] = [];
        parts.forEach((part, idx) => {
          if (part.startsWith('%%CITATION_')) {
            const citationNode = renderCitationPlaceholder(part, `cit-${idx}-${part}`);
            if (citationNode !== null) {
              result.push(<React.Fragment key={`cit-${idx}-${part}`}>{citationNode}</React.Fragment>);
            }
          } else if (part) {
            const nextPart = parts[idx + 1];
            const nextCitNum = nextPart && citationNumFromPlaceholder(nextPart);
            const wrapOrange = nextCitNum != null && (orangeCitationNumbers?.has(nextCitNum) ?? false);
            const content = renderStringSegment(part, `text-${idx}`);
            if (wrapOrange) {
              result.push(<OrangeCitationSwoopHighlight key={`orange-${idx}`}>{content}</OrangeCitationSwoopHighlight>);
            } else {
              result.push(...content);
            }
          }
        });
        return result.length > 0 ? result : null;
      }
      if (React.isValidElement(child)) {
        const childChildren = (child.props as any)?.children;
        if (childChildren !== undefined) {
          return React.cloneElement(child, { ...child.props, children: processChildrenWithCitations(childChildren) } as any);
        }
      }
      return child;
    });
  };

  // Same as processChildrenWithCitations but flattens first so orange covers full cited run (e.g. "text **bold** " before citation)
  const processChildrenWithCitationsFlattened = (nodes: React.ReactNode, keyPrefix: string): React.ReactNode => {
    const segments = flattenSegments(nodes);
    return processFlattenedWithCitations(segments, keyPrefix);
  };

  // Markdown components for full-block rendering (no main-answer highlight)
  const markdownComponents = {
    p: ({ children }: { children?: React.ReactNode }) => {
      return <p style={{ 
        margin: 0, 
        marginBottom: '10px', 
        textAlign: 'left',
        wordWrap: 'break-word',
        overflowWrap: 'break-word',
        wordBreak: 'break-word'
      }}>{processChildrenWithCitationsFlattened(children ?? null, 'p')}</p>;
    },
    h1: ({ children }: { children?: React.ReactNode }) => {
      return <h1 style={{ 
        fontSize: '18px', 
        fontWeight: 600, 
        margin: '14px 0 10px 0', 
        color: '#111827',
        wordWrap: 'break-word',
        overflowWrap: 'break-word',
        wordBreak: 'break-word'
      }}>{processChildrenWithCitationsFlattened(children ?? null, 'h1')}</h1>;
    },
    h2: () => null, 
    h3: () => null,
    ul: ({ children }: { children?: React.ReactNode }) => <ul style={{ 
      margin: '10px 0', 
      paddingLeft: 0, 
      listStylePosition: 'inside',
      wordWrap: 'break-word',
      overflowWrap: 'break-word',
      wordBreak: 'break-word'
    }}>{children}</ul>,
    ol: ({ children }: { children?: React.ReactNode }) => <ol style={{ 
      margin: '10px 0', 
      paddingLeft: 0, 
      listStylePosition: 'inside',
      wordWrap: 'break-word',
      overflowWrap: 'break-word',
      wordBreak: 'break-word'
    }}>{children}</ol>,
    li: ({ children }: { children?: React.ReactNode }) => {
      return <li style={{ 
        marginBottom: '6px',
        wordWrap: 'break-word',
        overflowWrap: 'break-word',
        wordBreak: 'break-word'
      }}>{processChildrenWithCitationsFlattened(children ?? null, 'li')}</li>;
    },
    strong: ({ children }: { children?: React.ReactNode }) => {
      const boldContent = (
        <strong style={{ 
          fontWeight: 600,
          wordWrap: 'break-word',
          overflowWrap: 'break-word',
          wordBreak: 'break-word'
        }}>{processChildrenWithCitations(children)}</strong>
      );
      if (skipHighlight) return boldContent;
      return <MainAnswerHighlight isStreaming={isStreaming} runSwoop={runBlueSwoop}>{boldContent}</MainAnswerHighlight>;
    },
    em: ({ children }: { children?: React.ReactNode }) => {
      return <em style={{ 
        fontStyle: 'italic',
        wordWrap: 'break-word',
        overflowWrap: 'break-word',
        wordBreak: 'break-word'
      }}>{processChildrenWithCitations(children)}</em>;
    },
    code: ({ children }: { children?: React.ReactNode }) => <code style={{ 
      backgroundColor: '#f3f4f6', 
      padding: '2px 5px', 
      borderRadius: '4px', 
      fontSize: '14px', 
      fontFamily: 'monospace',
      wordWrap: 'break-word',
      overflowWrap: 'break-word',
      wordBreak: 'break-word'
    }}>{children}</code>,
    blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote style={{ 
      borderLeft: '3px solid #d1d5db', 
      paddingLeft: '12px', 
      margin: '8px 0', 
      color: '#6b7280',
      wordWrap: 'break-word',
      overflowWrap: 'break-word',
      wordBreak: 'break-word'
    }}>{children}</blockquote>,
    hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '16px 0' }} />,
  };

  return (
    <>
      <style>{`
        .streaming-response-text p:last-child {
          margin-bottom: 0 !important;
        }
      `}</style>
      <div
        className="streaming-response-text"
        style={{
          color: '#374151',
          fontSize: '14px',
          lineHeight: '20px',
          margin: 0,
          padding: '4px 0',
          textAlign: 'left', 
          fontFamily: 'Inter, system-ui, sans-serif', 
          fontWeight: 400,
          position: 'relative',
          minHeight: '1px',
          contain: 'layout style',
          wordWrap: 'break-word',
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
          maxWidth: '100%',
          overflow: 'visible',
          boxSizing: 'border-box'
        }}
      >
        <ReactMarkdown key={markdownKey} skipHtml={true} components={markdownComponents}>{textWithCitationPlaceholders}</ReactMarkdown>
      </div>
    </>
  );
};

// Memoize so highlight/text only re-renders when content changes, not when chat title, reasoning toggle, etc. change
function streamingResponseTextAreEqual(
  prev: React.ComponentProps<typeof StreamingResponseText>,
  next: React.ComponentProps<typeof StreamingResponseText>
): boolean {
  return (
    prev.text === next.text &&
    prev.isStreaming === next.isStreaming &&
    prev.messageId === next.messageId &&
    prev.skipHighlight === next.skipHighlight &&
    prev.showCitations === next.showCitations &&
    prev.citations === next.citations &&
    prev.orangeCitationNumbers === next.orangeCitationNumbers &&
    prev.selectedCitationNumber === next.selectedCitationNumber &&
    prev.selectedCitationMessageId === next.selectedCitationMessageId
  );
}
const StreamingResponseTextMemo = React.memo(StreamingResponseText, streamingResponseTextAreEqual);

// Component for displaying property thumbnail in search results
const PropertyImageThumbnail: React.FC<{ property: PropertyData }> = ({ property }) => {
  const [imageError, setImageError] = React.useState(false);
  // Check multiple possible locations for the image URL
  const imageUrl = property.image || 
                   property.primary_image_url || 
                   (property.property_images && property.property_images.length > 0 ? property.property_images[0].url : null) ||
                   (property as any).property_details?.primary_image_url ||
                   ((property as any).property_details?.property_images && (property as any).property_details.property_images.length > 0 
                     ? (property as any).property_details.property_images[0].url : null);

  return (
    <div style={{
      width: '32px',
      height: '32px',
      borderRadius: '8px',
      overflow: 'hidden',
      backgroundColor: '#F3F4F6',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      border: '1px solid rgba(229, 231, 235, 0.5)'
    }}>
      {imageUrl && !imageError ? (
        <img
          src={imageUrl}
          alt={(property as any).custom_name || property.address}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block'
          }}
          onError={() => setImageError(true)}
        />
      ) : (
        <div style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, #E5E7EB 0%, #D1D5DB 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <Home className="w-4 h-4" style={{ color: '#6B7280' }} strokeWidth={2} />
        </div>
      )}
    </div>
  );
};

// Citation link component - renders clickable citation buttons [1], [2], etc.
interface CitationChunkData {
  doc_id?: string;
  content?: string;
  chunk_index?: number;
  page_number?: number;
  match_reason?: string;
  bbox?: {
    left: number;
    top: number;
    width: number;
    height: number;
    page?: number;
  };
  vector_id?: string;
  similarity?: number;
}

interface CitationDataType {
  doc_id: string;
  page: number;  // Primary field for page number
  bbox: {
    left: number;
    top: number;
    width: number;
    height: number;
    page?: number;  // Optional page in bbox (for compatibility)
  };
  method?: string;  // Citation method (e.g., 'block-id-lookup')
  block_id?: string;  // Block ID from Phase 1 citation extraction (for debugging)
  // Legacy fields (optional for backward compatibility)
  original_filename?: string | null;
  property_address?: string;
  page_range?: string;
  classification_type?: string;
  chunk_index?: number;
  page_number?: number;  // Deprecated, use 'page' instead
  source_chunks_metadata?: CitationChunkData[];
  candidate_chunks_metadata?: CitationChunkData[];
  matched_chunk_metadata?: CitationChunkData;
  chunk_metadata?: CitationChunkData;
  match_reason?: string;
  block_content?: string;
  cited_text?: string;
}

interface CitationData {
  doc_id: string;
  original_filename?: string | null;
  page?: number;
  page_number?: number;
  block_id?: string; // Block ID for focused citation retrieval
  bbox?: {
    left: number;
    top: number;
    width: number;
    height: number;
    page?: number;
  };
  block_content?: string;
  cited_text?: string;
  classification_type?: string;
  matched_chunk_metadata?: CitationChunkData;
  source_chunks_metadata?: CitationChunkData[];
  candidate_chunks_metadata?: CitationChunkData[];
  chunk_metadata?: CitationChunkData;
}

const CitationLink: React.FC<{
  citationNumber: string;
  citationData: CitationDataType;
  onClick: (data: CitationDataType, anchorRect?: DOMRect, citationNumber?: string) => void;
  isSelected?: boolean;
}> = ({ citationNumber, citationData, onClick, isSelected }) => {
  const [showPreview, setShowPreview] = React.useState(false);
  const [hoverPosition, setHoverPosition] = React.useState({ x: 0, y: 0 });
  const [containerBounds, setContainerBounds] = React.useState<{ left: number; right: number } | undefined>(undefined);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const hoverTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const leaveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  
  // Build display name with fallbacks
  const displayName = citationData.original_filename || 
    (citationData.classification_type ? citationData.classification_type.replace(/_/g, ' ') : 'Document');
  
  // Check if citation has valid bbox data for preview
  // Must be normalized (0-1 range) and not a fallback/full-page bbox
  const hasValidBbox = React.useMemo(() => {
    const bbox = citationData.bbox;
    if (!bbox) {
      console.log('🔍 [CitationLink] No bbox for citation', citationNumber);
      return false;
    }
    
    const { left, top, width, height } = bbox;
    
    // Check if values exist and are numbers
    if (
      typeof left !== 'number' || 
      typeof top !== 'number' ||
      typeof width !== 'number' || 
      typeof height !== 'number'
    ) {
      console.log('🔍 [CitationLink] Invalid bbox types for citation', citationNumber, bbox);
      return false;
    }
    
    // Check if values are in 0-1 range (normalized)
    if (
      left < 0 || left > 1 ||
      top < 0 || top > 1 ||
      width <= 0 || width > 1 ||
      height <= 0 || height > 1
    ) {
      console.warn('⚠️ [CitationLink] Bbox values out of 0-1 range for citation', citationNumber, bbox);
      return false;
    }
    
    // Check if it's a fallback bbox (covers entire page or >90% of page)
    const area = width * height;
    if (
      (left === 0 && top === 0 && width === 1 && height === 1) ||
      area > 0.9
    ) {
      console.warn('⚠️ [CitationLink] Rejecting fallback/full-page bbox for citation', citationNumber, { area, bbox });
      return false;
    }
    
    console.log('✅ [CitationLink] Valid bbox for citation', citationNumber, { 
      bbox, 
      area: (area * 100).toFixed(1) + '%' 
    });
    return true;
  }, [citationData.bbox, citationNumber]);
  
  // Preload high-res preview on mount (not on hover) for instant display
  React.useEffect(() => {
    if (hasValidBbox && citationData.doc_id) {
      const pageNumber = citationData.page || citationData.bbox?.page || 1;
      // Trigger preload in background - don't await
      preloadHoverPreview(citationData.doc_id, pageNumber);
    }
  }, [citationData.doc_id, citationData.page, citationData.bbox?.page, hasValidBbox]);
  
  // Cleanup timeouts on unmount
  React.useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current);
    };
  }, []);
  
  // Close preview on scroll (anywhere in the document)
  React.useEffect(() => {
    if (!showPreview) return;
    
    const handleScroll = () => {
      setShowPreview(false);
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
    };
    
    // Listen for scroll on window and capture phase to catch all scroll events
    window.addEventListener('scroll', handleScroll, true);
    
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [showPreview]);
  
  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Clear any pending leave timeout
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    
    // Only show preview if we have valid bbox data
    if (!hasValidBbox) return;
    
    // Get button position for preview placement
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverPosition({
      x: rect.left + rect.width / 2,
      y: rect.top
    });
    
    // Find the chat container to constrain preview position
    // Look for the chat panel container by traversing up the DOM
    let element: HTMLElement | null = e.currentTarget;
    let chatContainer: HTMLElement | null = null;
    while (element) {
      // Look for chat panel container - it typically has overflow-y: auto or scroll
      // and is the main scrollable area for messages
      const style = window.getComputedStyle(element);
      if (
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        element.offsetHeight > 200 // Reasonable size for chat container
      ) {
        chatContainer = element;
        break;
      }
      element = element.parentElement;
    }
    
    if (chatContainer) {
      const containerRect = chatContainer.getBoundingClientRect();
      // Add small padding from container edges
      setContainerBounds({
        left: containerRect.left + 8,
        right: containerRect.right - 8
      });
    } else {
      setContainerBounds(undefined);
    }
    
    // Show preview after longer delay (requires deliberate hover)
    hoverTimeoutRef.current = setTimeout(() => {
      setShowPreview(true);
    }, 450);
  };
  
  const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Clear any pending hover timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    
    // Hide preview after small delay (allows moving to preview)
    leaveTimeoutRef.current = setTimeout(() => {
      setShowPreview(false);
    }, 100);
  };
  
  const handlePreviewMouseEnter = () => {
    // Cancel the leave timeout if user moves to preview
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
  };
  
  const handlePreviewMouseLeave = () => {
    // Hide preview when leaving the preview box
    setShowPreview(false);
  };
  
  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // Hide preview on click
          setShowPreview(false);
          if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
          const rect = e.currentTarget.getBoundingClientRect();
          onClick(citationData, rect, citationNumber);
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: '3px',
          marginRight: '2px',
          minWidth: '19px',
          height: '19px',
          padding: '0 6px',
          fontSize: '11px',
          fontWeight: 600,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          color: isSelected ? '#1E40AF' : '#5D5D5D',
          backgroundColor: isSelected ? '#DBEAFE' : '#FFFFFF',
          borderRadius: '6px',
          border: isSelected ? '1px solid #3B82F6' : '1px solid #E5E7EB',
          cursor: 'pointer',
          verticalAlign: 'middle',
          position: 'relative',
          top: '-1px',
          lineHeight: 1,
          transition: 'all 0.15s ease-in-out'
        }}
        onMouseEnter={(e) => {
          if (!isSelected) {
            e.currentTarget.style.backgroundColor = '#F3F4F6';
            e.currentTarget.style.color = '#374151';
            e.currentTarget.style.transform = 'scale(1.05)';
          }
          handleMouseEnter(e);
        }}
        onMouseLeave={(e) => {
          if (!isSelected) {
            e.currentTarget.style.backgroundColor = '#FFFFFF';
            e.currentTarget.style.color = '#5D5D5D';
            e.currentTarget.style.transform = 'scale(1)';
          } else {
            e.currentTarget.style.backgroundColor = '#DBEAFE';
            e.currentTarget.style.color = '#1E40AF';
          }
          handleMouseLeave(e);
        }}
        aria-label={`Citation ${citationNumber} - ${displayName}`}
      >
        {citationNumber}
      </button>
      {showPreview && hasValidBbox && (
        <CitationHoverPreview
          citationData={citationData}
          position={hoverPosition}
          containerBounds={containerBounds}
          onMouseEnter={handlePreviewMouseEnter}
          onMouseLeave={handlePreviewMouseLeave}
        />
      )}
    </>
  );
};

// Helper function to truncate query text to 2 lines with ellipsis
const truncateQueryText = (
  text: string,
  maxLines: number = 2,
  maxWidthPercent: number = 80,
  containerWidth?: number
): { truncatedText: string; isTruncated: boolean } => {
  if (!text) return { truncatedText: '', isTruncated: false };
  
  // Use a temporary element to measure text
  const measureElement = document.createElement('div');
  measureElement.style.position = 'absolute';
  measureElement.style.visibility = 'hidden';
  measureElement.style.height = 'auto';
  measureElement.style.width = containerWidth 
    ? `${containerWidth * (maxWidthPercent / 100)}px`
    : `${maxWidthPercent}%`;
  measureElement.style.fontSize = '14px';
  measureElement.style.lineHeight = '20px';
  measureElement.style.fontFamily = 'system-ui, -apple-system, sans-serif';
  measureElement.style.whiteSpace = 'pre-wrap';
  measureElement.style.wordWrap = 'break-word';
  document.body.appendChild(measureElement);
  
  // Calculate max height for 2 lines
  const lineHeight = 20;
  const maxHeight = lineHeight * maxLines;
  
  // Try full text first
  measureElement.textContent = text;
  const fullHeight = measureElement.offsetHeight;
  
  if (fullHeight <= maxHeight) {
    document.body.removeChild(measureElement);
    return { truncatedText: text, isTruncated: false };
  }
  
  // Binary search for the right truncation point
  let left = 0;
  let right = text.length;
  let bestMatch = text;
  
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    const testText = text.substring(0, mid) + '...';
    measureElement.textContent = testText;
    
    if (measureElement.offsetHeight <= maxHeight) {
      bestMatch = testText;
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  
  document.body.removeChild(measureElement);
  return { truncatedText: bestMatch, isTruncated: true };
};

// Helper function to render text with clickable citation links
// Supports both superscript (¹, ², ³) and bracket ([1], [2]) formats
const renderTextWithCitations = (
  text: string, 
  citations: Record<string, CitationDataType> | undefined,
  onCitationClick: (data: CitationDataType) => void,
  seenCitationNums?: Set<string>
): React.ReactNode => {
  if (!citations || Object.keys(citations).length === 0) {
    return text;
  }
  
  // Map superscript characters to numbers
  const superscriptMap: Record<string, string> = {
    '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5',
    '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9'
  };
  
  // Pattern for superscript: ¹, ², ³, etc. (including multi-digit like ¹⁰)
  const superscriptPattern = /[¹²³⁴⁵⁶⁷⁸⁹]+(?:\d+)?/g;
  // Pattern for bracket: [1], [2], etc. (for backward compatibility)
  const bracketPattern = /\[(\d+)\]/g;
  
  // Replace superscript with placeholders
  let processedText = text;
  interface CitationPlaceholder {
    num: string;
    data: CitationDataType;
    original: string;
  }
  const citationPlaceholders: Record<string, CitationPlaceholder> = {};
  let placeholderIndex = 0;
  // De-dupe citations across the whole response message render (not per text node).
  // If no shared set is provided, fall back to per-call behavior.
  const seen = seenCitationNums ?? new Set<string>();
  
  // Process superscript citations
  processedText = processedText.replace(superscriptPattern, (match) => {
    // Convert superscript to number
    let numStr = '';
    for (const char of match) {
      numStr += superscriptMap[char] || (/\d/.test(char) ? char : '');
    }
    const citData = citations[numStr];
    if (citData) {
      if (seen.has(numStr)) {
        return ''; // Remove duplicate marker
      }
      const placeholder = `%%CITATION_SUPERSCRIPT_${placeholderIndex}%%`;
      citationPlaceholders[placeholder] = { num: numStr, data: citData, original: match };
      placeholderIndex++;
      seen.add(numStr);
      console.log(`🔗 [CITATION] Matched superscript ${match} (${numStr}) with citation data:`, citData);
      return placeholder;
    } else {
      console.log(`⚠️ [CITATION] Superscript ${match} (${numStr}) found in text but no citation data available. Available keys:`, Object.keys(citations));
    }
    return match; // Keep original if no citation found
  });
  
  // Clean up periods that follow citations (both bracket and superscript)
  // Remove periods immediately after bracket citations: [1]. -> [1]
  processedText = processedText.replace(/\[(\d+)\]\.(?=\s|$)/g, '[$1]');
  // Remove periods immediately after superscript citations: ¹. -> ¹
  processedText = processedText.replace(/([¹²³⁴⁵⁶⁷⁸⁹]+(?:\d+)?)\.(?=\s|$)/g, '$1');
  
  // Process bracket citations
  processedText = processedText.replace(bracketPattern, (match, num) => {
    const citData = citations[num];
    if (citData) {
      if (seen.has(num)) {
        return ''; // Remove duplicate marker
      }
      const placeholder = `%%CITATION_BRACKET_${placeholderIndex}%%`;
      citationPlaceholders[placeholder] = { num, data: citData, original: match };
      placeholderIndex++;
      seen.add(num);
      
      // #region agent log
      try {
        const contextStart = Math.max(0, processedText.indexOf(match) - 50);
        const contextEnd = Math.min(processedText.length, processedText.indexOf(match) + match.length + 50);
        const context = text.substring(contextStart, contextEnd);
        // DEBUG ONLY: Local ingest for dev tracing. Disabled unless explicitly enabled.
        if (import.meta.env.VITE_LOCAL_DEBUG_INGEST === '1') fetch('http://127.0.0.1:7243/ingest/1d8b42de-af74-4269-8506-255a4dc9510b', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'debug-session',
            runId: 'run1',
            hypothesisId: 'D',
            location: 'SideChatPanel.tsx:491',
            message: 'Frontend matching citation to text',
            data: {
              citation_number: num,
              citation_marker: match,
              context_around_citation: context,
              citation_data: {
                block_id: citData.block_id || 'UNKNOWN',
                cited_text: (citData as any).cited_text || '',
                bbox: citData.bbox,
                page: citData.page || citData.bbox?.page || 'UNKNOWN',
                doc_id: citData.doc_id?.substring(0, 8) || 'UNKNOWN'
              }
            },
            timestamp: Date.now()
          })
        }).catch(() => {});
      } catch {}
      // #endregion
      
      return placeholder;
    } else {
      console.log(`⚠️ [CITATION] Bracket ${match} (${num}) found in text but no citation data available. Available keys:`, Object.keys(citations));
    }
    return match; // Keep original if no citation found
  });
  
  // Split by placeholders and render
  const parts = processedText.split(/(%%CITATION_(?:SUPERSCRIPT|BRACKET)_\d+%%)/g);
  
  return parts.map((part, idx) => {
    const placeholder = citationPlaceholders[part];
    if (placeholder) {
      return (
        <CitationLink 
          key={`cit-${idx}-${placeholder.num}`} 
          citationNumber={placeholder.num} 
          citationData={placeholder.data} 
          onClick={onCitationClick} 
        />
      );
    }
    return <span key={`text-${idx}`}>{part}</span>;
  });
};

// Component for displaying property attachment in query bubble
const QueryPropertyAttachment: React.FC<{ 
  attachment: PropertyAttachmentData;
  onOpenProperty?: (attachment: PropertyAttachmentData) => void;
}> = ({ attachment, onOpenProperty }) => {
  const imageUrl = attachment.imageUrl || attachment.property.image || attachment.property.primary_image_url;
  
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('🖱️ QueryPropertyAttachment clicked:', attachment);
    console.log('🔍 onOpenProperty callback exists:', !!onOpenProperty);
    if (onOpenProperty) {
      console.log('✅ Calling onOpenProperty callback with attachment:', attachment);
      try {
        onOpenProperty(attachment);
        console.log('✅ onOpenProperty callback executed successfully');
      } catch (error) {
        console.error('❌ Error calling onOpenProperty:', error);
      }
    } else {
      console.warn('⚠️ onOpenProperty callback not provided');
    }
  };
  
  if (imageUrl) {
    return (
      <div
        onClick={handleClick}
        onMouseDown={(e) => {
          // Ensure click works even if there are other handlers
          e.stopPropagation();
        }}
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '4px',
          overflow: 'hidden',
          backgroundColor: '#F3F4F6',
          border: '1px solid #E5E7EB',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          cursor: 'pointer',
          transition: 'opacity 0.2s ease',
          position: 'relative',
          zIndex: 10,
          pointerEvents: 'auto'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '0.8';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '1';
        }}
        title={`Click to view ${attachment.address}`}
      >
        <img
          src={imageUrl}
          alt={attachment.address}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            pointerEvents: 'none' // Allow clicks to pass through to parent div
          }}
          onError={(e) => {
            e.currentTarget.src = 'https://via.placeholder.com/40x40/94a3b8/ffffff?text=Property';
          }}
        />
      </div>
    );
  }
  
  // For properties without images, show property icon
  return (
    <div
      onClick={handleClick}
      onMouseDown={(e) => {
        // Ensure click works even if there are other handlers
        e.stopPropagation();
      }}
      style={{
        width: '40px',
        height: '40px',
        borderRadius: '4px',
        backgroundColor: '#F3F4F6',
        border: '1px solid #E5E7EB',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        cursor: 'pointer',
        transition: 'opacity 0.2s ease',
        position: 'relative',
        zIndex: 10,
        pointerEvents: 'auto'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = '0.8';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = '1';
      }}
      title={`Click to view ${attachment.address}`}
    >
      <span style={{ fontSize: '20px', pointerEvents: 'none' }}>🏠</span>
    </div>
  );
};

// Component for displaying attachment in query bubble
const QueryAttachment: React.FC<{ attachment: FileAttachmentData }> = ({ attachment }) => {
  const isImage = attachment.type.startsWith('image/');
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const { addPreviewFile } = usePreview();
  
  // Create blob URL for images
  React.useEffect(() => {
    if (isImage && attachment.file) {
      // Check for preloaded blob URL first
      const preloadedBlob = (window as any).__preloadedAttachmentBlobs?.[attachment.id];
      if (preloadedBlob) {
        setImageUrl(preloadedBlob);
      } else {
        const url = URL.createObjectURL(attachment.file);
        setImageUrl(url);
        return () => {
          URL.revokeObjectURL(url);
        };
      }
    }
  }, [isImage, attachment.id, attachment.file]);
  
  const handleImageClick = () => {
    if (attachment.file) {
      // Ensure the File object is still valid by creating a fresh attachment object
      // This prevents issues when reopening previews after closing
      const freshAttachment: FileAttachmentData = {
        ...attachment,
        file: attachment.file // Ensure we're using the current file reference
      };
      addPreviewFile(freshAttachment);
    }
  };
  
  if (isImage && imageUrl) {
    return (
      <div
        onClick={handleImageClick}
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '6px',
          overflow: 'hidden',
          backgroundColor: '#F3F4F6',
          border: '1px solid #E5E7EB',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          cursor: 'pointer',
          transition: 'opacity 0.2s ease'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '0.8';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '1';
        }}
        title={`Click to preview ${attachment.name}`}
      >
        <img
          src={imageUrl}
          alt={attachment.name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block'
          }}
        />
      </div>
    );
  }
  
  // For non-image files, show file name with icon
  return (
    <div
      style={{
        fontSize: '13px',
        color: '#6B7280',
        backgroundColor: '#F3F4F6',
        padding: '3px 8px',
        borderRadius: '5px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px'
      }}
    >
      <span>📎</span>
      <span>{attachment.name}</span>
    </div>
  );
};

// True 3D Globe component using CSS 3D transforms
const Globe3D: React.FC = () => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const rotationRef = React.useRef({ x: 0, y: 0 });
  const animationFrameRef = React.useRef<number>();
  const lastTimeRef = React.useRef<number>(performance.now());

  React.useEffect(() => {
    const animate = (currentTime: number) => {
      const deltaTime = currentTime - lastTimeRef.current;
      lastTimeRef.current = currentTime;
      
      // Smooth rotation based on time delta for consistent speed
      rotationRef.current.y += (deltaTime / 16) * 0.5; // ~30 degrees per second
      rotationRef.current.x += (deltaTime / 16) * 0.25; // ~15 degrees per second
      
      if (containerRef.current) {
        containerRef.current.style.transform = 
          `rotateX(${rotationRef.current.x}deg) rotateY(${rotationRef.current.y}deg)`;
      }
      
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const radius = 5;
  const rings = 16; // Reduced for better performance while maintaining solid appearance

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        marginTop: '-5px',
        marginLeft: '-5px',
        width: '10px',
        height: '10px',
        transformStyle: 'preserve-3d',
        willChange: 'transform',
        zIndex: 1
      }}
    >
      {/* Create solid sphere using multiple filled rings in 3D space */}
      {Array.from({ length: rings }).map((_, ringIndex) => {
        const phi = (Math.PI * ringIndex) / (rings - 1); // Latitude angle (0 to π)
        const ringRadius = Math.abs(Math.sin(phi)) * radius;
        const z = Math.cos(phi) * radius; // Z position in 3D space
        
        return (
          <div
            key={`ring-${ringIndex}`}
            style={{
              position: 'absolute',
              width: `${ringRadius * 2}px`,
              height: `${ringRadius * 2}px`,
              top: '50%',
              left: '50%',
              marginTop: `${-ringRadius}px`,
              marginLeft: `${-ringRadius}px`,
              borderRadius: '50%',
              backgroundColor: 'rgba(229, 231, 235, 0.75)', // Slightly more opaque for better blending
              border: 'none',
              transform: `translateZ(${z}px)`,
              transformStyle: 'preserve-3d',
              backfaceVisibility: 'visible',
              WebkitBackfaceVisibility: 'visible',
              willChange: 'transform'
            }}
          />
        );
      })}
    </div>
  );
};

// Global cache for preloaded BBOX preview images (low-res, 200px for thumbnails)
interface BboxPreviewCacheEntry {
  pageImage: string;
  thumbnailHeight: number;
  timestamp: number;
}
const bboxPreviewCache = new globalThis.Map<string, BboxPreviewCacheEntry>();

// High-resolution cache for hover preview (600px for better quality when zoomed)
interface HoverPreviewCacheEntry {
  pageImage: string;
  imageWidth: number;   // Exact pixel width of rendered image
  imageHeight: number;  // Exact pixel height of rendered image
  timestamp: number;
}
const hoverPreviewCache = new globalThis.Map<string, HoverPreviewCacheEntry>();

// Track in-progress preloads with promises so multiple callers can await the same load
const hoverPreviewLoadingPromises = new globalThis.Map<string, Promise<HoverPreviewCacheEntry | null>>();

// Preload high-resolution hover preview for a citation
const preloadHoverPreview = (docId: string, pageNumber: number): Promise<HoverPreviewCacheEntry | null> => {
  const cacheKey = `hover-${docId}-${pageNumber}`;
  
  // Return cached if available
  if (hoverPreviewCache.has(cacheKey)) {
    return Promise.resolve(hoverPreviewCache.get(cacheKey)!);
  }
  
  // If already loading, return the existing promise so caller can await it
  if (hoverPreviewLoadingPromises.has(cacheKey)) {
    return hoverPreviewLoadingPromises.get(cacheKey)!;
  }
  
  // Start new load
  const loadPromise = (async (): Promise<HoverPreviewCacheEntry | null> => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
      const downloadUrl = `${backendUrl}/api/files/download?document_id=${docId}`;
      
      const response = await fetch(downloadUrl, { credentials: 'include' });
      if (!response.ok) {
        console.warn(`[Hover Preview] Failed to download: ${response.status}`);
        return null;
      }
      
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      
      // Load PDF
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      
      // Render page at high resolution (600px width)
      const page = await pdf.getPage(pageNumber || 1);
      const viewport = page.getViewport({ scale: 1.0 });
      
      const targetWidth = 1200; // High resolution for crisp text when zoomed
      const scale = targetWidth / viewport.width;
      const scaledViewport = page.getViewport({ scale });
      
      // Create canvas for rendering
      const canvas = document.createElement('canvas');
      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;
      
      const context = canvas.getContext('2d');
      if (!context) {
        return null;
      }
      
      await page.render({
        canvasContext: context,
        viewport: scaledViewport,
        canvas: canvas
      }).promise;
      
      // Convert canvas to high-quality image
      const imageUrl = canvas.toDataURL('image/png');
      
      // Cache with actual dimensions
      const entry: HoverPreviewCacheEntry = {
        pageImage: imageUrl,
        imageWidth: scaledViewport.width,
        imageHeight: scaledViewport.height,
        timestamp: Date.now()
      };
      
      hoverPreviewCache.set(cacheKey, entry);
      console.log(`✅ [Hover Preview] Cached: ${cacheKey} (${entry.imageWidth}x${entry.imageHeight})`);
      return entry;
    } catch (error) {
      console.warn(`[Hover Preview] Failed to preload:`, error);
      return null;
    } finally {
      // Clean up the loading promise after completion
      hoverPreviewLoadingPromises.delete(cacheKey);
    }
  })();
  
  // Store the promise so other callers can await it
  hoverPreviewLoadingPromises.set(cacheKey, loadPromise);
  
  return loadPromise;
};

// Preload BBOX preview when citation context is prepared
const preloadBboxPreview = async (citationContext: {
  document_id: string;
  page_number: number;
  bbox: { left: number; top: number; width: number; height: number };
}): Promise<void> => {
  const cacheKey = `${citationContext.document_id}-${citationContext.page_number}`;
  
  // Skip if already cached
  if (bboxPreviewCache.has(cacheKey)) {
    return;
  }
  
  try {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
    const downloadUrl = `${backendUrl}/api/files/download?document_id=${citationContext.document_id}`;
    
    const response = await fetch(downloadUrl, { credentials: 'include' });
    if (!response.ok) {
      console.warn(`[BBOX Preview] Failed to preload: ${response.status}`);
      return;
    }
    
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    
    // Load PDF
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer }).promise;
    const pdf = await loadingTask;
    
    // Render page to canvas
    const page = await pdf.getPage(citationContext.page_number || 1);
    const viewport = page.getViewport({ scale: 1.0 });
    
    const thumbnailWidth = 200;
    const scale = thumbnailWidth / viewport.width;
    const scaledViewport = page.getViewport({ scale });
    
    // Create temporary canvas for rendering
    const canvas = document.createElement('canvas');
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    
    const context = canvas.getContext('2d');
    if (!context) return;
    
    await page.render({
      canvasContext: context,
      viewport: scaledViewport,
      canvas: canvas
    }).promise;
    
    // Convert canvas to image
    const imageUrl = canvas.toDataURL('image/png');
    
    // Cache the result
    bboxPreviewCache.set(cacheKey, {
      pageImage: imageUrl,
      thumbnailHeight: scaledViewport.height,
      timestamp: Date.now()
    });
    
    console.log(`✅ [BBOX Preview] Preloaded and cached: ${cacheKey}`);
  } catch (error) {
    console.warn(`[BBOX Preview] Failed to preload:`, error);
  }
};

// Clear BBOX preview cache (called when user cancels)
const clearBboxPreviewCache = (citationContext?: {
  document_id: string;
  page_number: number;
}) => {
  if (citationContext) {
    const cacheKey = `${citationContext.document_id}-${citationContext.page_number}`;
    bboxPreviewCache.delete(cacheKey);
    console.log(`🧹 [BBOX Preview] Cleared cache: ${cacheKey}`);
  } else {
    // Clear all if no specific context provided
    bboxPreviewCache.clear();
    console.log(`🧹 [BBOX Preview] Cleared all cache`);
  }
};

// Citation BBOX Preview Component - shows thumbnail of document page with BBOX highlight
interface CitationBboxPreviewProps {
  citationBboxData: {
    document_id: string;
    page_number: number;
    bbox: { left: number; top: number; width: number; height: number };
    original_filename?: string;
    block_id?: string;
  };
  onClick: () => void;
}

// Segment height as fraction of page (1/4 = 0.25)
const CITATION_PREVIEW_SEGMENT_FRACTION = 0.25;
// Higher scale for sharper segment render (2x)
const CITATION_PREVIEW_RENDER_SCALE = 2;
// Display width of the segment preview (matches reference: compact strip)
const CITATION_PREVIEW_DISPLAY_WIDTH = 420;

const CitationBboxPreview: React.FC<CitationBboxPreviewProps> = ({ citationBboxData, onClick }) => {
  const [segmentImage, setSegmentImage] = React.useState<string | null>(null);
  const [segmentDimensions, setSegmentDimensions] = React.useState<{ width: number; height: number }>({ width: CITATION_PREVIEW_DISPLAY_WIDTH, height: 99 });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [bboxInSegment, setBboxInSegment] = React.useState<{ left: number; top: number; width: number; height: number } | null>(null);

  // Load page, render only a 1/4 segment centered on citation, at higher quality (no full-page cache for this path)
  React.useEffect(() => {
    const bbox = citationBboxData.bbox;

    const loadDocument = async () => {
      try {
        setLoading(true);
        const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
        const downloadUrl = `${backendUrl}/api/files/download?document_id=${citationBboxData.document_id}`;
        const response = await fetch(downloadUrl, { credentials: 'include' });
        if (!response.ok) throw new Error(`Failed to download: ${response.status}`);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(citationBboxData.page_number || 1);
        const viewport = page.getViewport({ scale: 1.0 });
        const scale = CITATION_PREVIEW_RENDER_SCALE * (CITATION_PREVIEW_DISPLAY_WIDTH / viewport.width);
        const scaledViewport = page.getViewport({ scale });
        const fullCanvas = document.createElement('canvas');
        fullCanvas.width = scaledViewport.width;
        fullCanvas.height = scaledViewport.height;
        const context = fullCanvas.getContext('2d');
        if (!context) return;
        await page.render({
          canvasContext: context,
          viewport: scaledViewport,
          canvas: fullCanvas
        }).promise;

        const pw = scaledViewport.width;
        const ph = scaledViewport.height;

        // Segment: 1/4 of page height centered on citation bbox (normalized 0-1)
        const segH = CITATION_PREVIEW_SEGMENT_FRACTION;
        const centerY = bbox.top + bbox.height / 2;
        const segTop = Math.max(0, Math.min(1 - segH, centerY - segH / 2));
        const segPxTop = segTop * ph;
        const segPxHeight = Math.round(segH * ph);

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = pw;
        cropCanvas.height = segPxHeight;
        const ctx = cropCanvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(fullCanvas, 0, segPxTop, pw, segPxHeight, 0, 0, pw, segPxHeight);
        const segmentUrl = cropCanvas.toDataURL('image/png');

        setSegmentImage(segmentUrl);
        setSegmentDimensions({ width: pw, height: segPxHeight });

        // Bbox in segment-relative pixels (for overlay)
        setBboxInSegment({
          left: bbox.left * pw,
          top: ((bbox.top - segTop) / segH) * segPxHeight,
          width: bbox.width * pw,
          height: (bbox.height / segH) * segPxHeight
        });
        setLoading(false);
      } catch (err) {
        console.error('Failed to load document for BBOX preview:', err);
        setError(err instanceof Error ? err.message : 'Failed to load document');
        setLoading(false);
      }
    };

    if (citationBboxData.document_id) {
      loadDocument();
    } else {
      setError('No document ID provided');
      setLoading(false);
    }
  }, [citationBboxData.document_id, citationBboxData.page_number, citationBboxData.bbox?.top, citationBboxData.bbox?.height]);

  const segmentDisplayHeight = segmentDimensions.width > 0
    ? (CITATION_PREVIEW_DISPLAY_WIDTH / segmentDimensions.width) * segmentDimensions.height
    : 99;
  const placeholderStyle: React.CSSProperties = {
    width: `${CITATION_PREVIEW_DISPLAY_WIDTH}px`,
    height: `${segmentDisplayHeight}px`,
    backgroundColor: '#f3f4f6',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    border: '1px solid #e5e7eb'
  };

  if (error) {
    return (
      <div style={placeholderStyle} onClick={onClick}>
        <div style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', padding: '10px' }}>
          Preview unavailable
        </div>
      </div>
    );
  }

  if (loading || !segmentImage) {
    return (
      <div style={placeholderStyle} onClick={onClick}>
        <div style={{ color: '#9ca3af', fontSize: '14px' }}>Loading...</div>
      </div>
    );
  }

  // Segment image is at segmentDimensions; we display it at CITATION_PREVIEW_DISPLAY_WIDTH wide.
  // Overlay in % of container so it scales exactly with the image (same aspect ratio).
  const box = bboxInSegment!;
  const leftPct = (box.left / segmentDimensions.width) * 100;
  const topPct = (box.top / segmentDimensions.height) * 100;
  const widthPct = (box.width / segmentDimensions.width) * 100;
  const heightPct = (box.height / segmentDimensions.height) * 100;

  return (
    <div
      style={{
        position: 'relative',
        width: `${CITATION_PREVIEW_DISPLAY_WIDTH}px`,
        height: `${segmentDisplayHeight}px`,
        borderRadius: '6px',
        overflow: 'hidden',
        cursor: 'pointer',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        border: '1px solid #e5e7eb'
      }}
      onClick={onClick}
    >
      <img
        src={segmentImage}
        alt="Document excerpt"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'fill',
          objectPosition: '0 0',
          display: 'block',
          verticalAlign: 'top'
        }}
      />
      {/* Citation highlight overlay (orange-yellow bar over cited text) */}
      <div
        style={{
          position: 'absolute',
          left: `${leftPct}%`,
          top: `${topPct}%`,
          width: `${widthPct}%`,
          height: `${heightPct}%`,
          backgroundColor: 'rgba(255, 235, 59, 0.45)',
          border: '1px solid rgba(255, 193, 7, 0.85)',
          borderRadius: '2px',
          pointerEvents: 'none',
          zIndex: 10
        }}
      />
    </div>
  );
};

// Citation Hover Preview Component - shows zoomed preview of BBOX on hover
// Uses the same BBOX positioning logic as StandaloneExpandedCardView for consistency
interface CitationHoverPreviewProps {
  citationData: CitationDataType;
  position: { x: number; y: number };
  containerBounds?: { left: number; right: number }; // Optional container bounds for constraining preview position
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const CitationHoverPreview: React.FC<CitationHoverPreviewProps> = ({ 
  citationData, 
  position,
  containerBounds,
  onMouseEnter,
  onMouseLeave 
}) => {
  const [pageImage, setPageImage] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [imageDimensions, setImageDimensions] = React.useState({ width: 600, height: 848 }); // Default A4
  
  // Fixed preview container dimensions
  const previewWidth = 280;
  const previewHeight = 200;
  
  // Get page number from citation data
  const pageNumber = citationData.page || citationData.bbox?.page || 1;
  
  // Check high-res cache first, then load if not cached
  React.useEffect(() => {
    const cacheKey = `hover-${citationData.doc_id}-${pageNumber}`;
    const cached = hoverPreviewCache.get(cacheKey);
    
    if (cached) {
      setPageImage(cached.pageImage);
      setImageDimensions({ width: cached.imageWidth, height: cached.imageHeight });
      setLoading(false);
      return;
    }
    
    // Not in cache - trigger high-res preload
    const loadPreview = async () => {
      try {
        const entry = await preloadHoverPreview(citationData.doc_id, pageNumber);
        
        if (entry) {
          setPageImage(entry.pageImage);
          setImageDimensions({ width: entry.imageWidth, height: entry.imageHeight });
        }
        setLoading(false);
      } catch (error) {
        console.warn('[Hover Preview] Failed to load:', error);
        setLoading(false);
      }
    };
    
    loadPreview();
  }, [citationData.doc_id, pageNumber]);
  
  // Calculate viewport position (flip if near edges)
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
  
  // Use container bounds if provided, otherwise fall back to viewport with small margin
  const minLeftBound = containerBounds?.left ?? 10;
  const maxRightBound = containerBounds?.right ?? (viewportWidth - 10);
  
  // Position above by default, flip below if near top
  const showAbove = position.y > previewHeight + 20;
  const topPosition = showAbove ? position.y - previewHeight - 10 : position.y + 30;
  
  // Horizontal centering with container-aware edge detection
  let leftPosition = position.x - previewWidth / 2;
  // Constrain to container bounds (or viewport if no container)
  if (leftPosition < minLeftBound) leftPosition = minLeftBound;
  if (leftPosition + previewWidth > maxRightBound) {
    leftPosition = maxRightBound - previewWidth;
  }
  // Final safety check - ensure left position doesn't go negative
  if (leftPosition < minLeftBound) leftPosition = minLeftBound;
  
  // === BBOX POSITIONING - IDENTICAL TO StandaloneExpandedCardView ===
  const bbox = citationData.bbox;
  const imageWidth = imageDimensions.width;
  const imageHeight = imageDimensions.height;
  
  // BBOX in image pixels (simple normalized-to-pixel conversion - same as StandaloneExpandedCardView)
  const originalBboxWidth = bbox.width * imageWidth;
  const originalBboxHeight = bbox.height * imageHeight;
  const originalBboxLeft = bbox.left * imageWidth;
  const originalBboxTop = bbox.top * imageHeight;
  
  // Calculate center of original BBOX (same as StandaloneExpandedCardView)
  const centerX = originalBboxLeft + originalBboxWidth / 2;
  const centerY = originalBboxTop + originalBboxHeight / 2;
  
  // Logo sizing (same logic as StandaloneExpandedCardView - 2% of page height)
  const logoHeight = 0.02 * imageHeight;
  const logoWidth = logoHeight;
  
  // Calculate minimum BBOX height to match logo (same as StandaloneExpandedCardView)
  const minBboxHeightPx = logoHeight;
  const baseBboxHeight = Math.max(originalBboxHeight, minBboxHeightPx);
  
  // Calculate final dimensions with padding (same as StandaloneExpandedCardView)
  const bboxPadding = 4;
  const finalBboxWidth = originalBboxWidth + bboxPadding * 2;
  const finalBboxHeight = baseBboxHeight === minBboxHeightPx 
    ? minBboxHeightPx 
    : baseBboxHeight + bboxPadding * 2;
  
  // Center the BBOX around the original text (same as StandaloneExpandedCardView)
  const bboxLeft = Math.max(0, centerX - finalBboxWidth / 2);
  const bboxTop = Math.max(0, centerY - finalBboxHeight / 2);
  
  // Constrain to page bounds (same as StandaloneExpandedCardView)
  const constrainedLeft = Math.min(bboxLeft, imageWidth - finalBboxWidth);
  const constrainedTop = Math.min(bboxTop, imageHeight - finalBboxHeight);
  const finalBboxLeft = Math.max(0, constrainedLeft);
  const finalBboxTop = Math.max(0, constrainedTop);
  
  // Position logo: top-right corner aligns with BBOX's top-left corner (same as StandaloneExpandedCardView)
  const logoLeft = finalBboxLeft - logoWidth + 2;
  const logoTop = finalBboxTop;
  
  // === ZOOM/CROP FOR HOVER PREVIEW ===
  // Calculate zoom to fit BBOX in preview (with padding around it)
  const previewPadding = 15;
  const availableWidth = previewWidth - (previewPadding * 2);
  const availableHeight = previewHeight - (previewPadding * 2);
  
  // Combined area includes logo + BBOX
  const combinedLeft = logoLeft;
  const combinedRight = finalBboxLeft + finalBboxWidth;
  const combinedWidth = combinedRight - combinedLeft;
  const combinedCenterX = (combinedLeft + combinedRight) / 2;
  const combinedCenterY = finalBboxTop + finalBboxHeight / 2;
  
  // Zoom to fit the combined area (logo + BBOX)
  const zoomForWidth = availableWidth / combinedWidth;
  const zoomForHeight = availableHeight / finalBboxHeight;
  
  // Use smaller zoom to ensure BBOX fits both dimensions
  // Max 0.7x to keep citations at a reasonable size - prevents excessive zoom on small BBOXes
  // This ensures smaller citations show more surrounding context instead of zooming in too close
  const rawZoom = Math.min(zoomForWidth, zoomForHeight);
  const zoom = Math.min(0.7, rawZoom);
  
  // Scaled dimensions
  const scaledImageWidth = imageWidth * zoom;
  const scaledImageHeight = imageHeight * zoom;
  const scaledCombinedWidth = combinedWidth * zoom;
  const scaledCombinedHeight = finalBboxHeight * zoom;
  
  // Calculate translation to center BBOX in preview
  const idealTranslateX = (previewWidth / 2) - (combinedCenterX * zoom);
  const idealTranslateY = (previewHeight / 2) - (combinedCenterY * zoom);
  
  // Calculate bounds for translation to keep BBOX visible
  // The scaled BBOX should fit within the preview
  const scaledBboxLeft = combinedLeft * zoom;
  const scaledBboxRight = combinedRight * zoom;
  const scaledBboxTop = finalBboxTop * zoom;
  const scaledBboxBottom = (finalBboxTop + finalBboxHeight) * zoom;
  
  // Ensure BBOX stays within preview bounds (with some margin)
  const viewMargin = 10;
  
  // Translation bounds to keep BBOX visible:
  // - Lower bound: BBOX left/top should be at least viewMargin from preview edge
  // - Upper bound: BBOX right/bottom should be at most (previewSize - viewMargin) from preview edge
  
  // X bounds: translateX + scaledBboxLeft >= viewMargin (min), translateX + scaledBboxRight <= previewWidth - viewMargin (max)
  const minTranslateX = viewMargin - scaledBboxLeft;
  const maxTranslateX = (previewWidth - viewMargin) - scaledBboxRight;
  
  // Y bounds: same logic
  const minTranslateY = viewMargin - scaledBboxTop;
  const maxTranslateY = (previewHeight - viewMargin) - scaledBboxBottom;
  
  // Clamp translation to keep BBOX in view, preferring ideal (centered) position
  // If min > max (BBOX larger than available space), use the average to center it
  const translateX = minTranslateX > maxTranslateX 
    ? (minTranslateX + maxTranslateX) / 2 
    : Math.max(minTranslateX, Math.min(maxTranslateX, idealTranslateX));
  const translateY = minTranslateY > maxTranslateY 
    ? (minTranslateY + maxTranslateY) / 2 
    : Math.max(minTranslateY, Math.min(maxTranslateY, idealTranslateY));
  
  const previewContent = (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'fixed',
        left: `${leftPosition}px`,
        top: `${topPosition}px`,
        width: `${previewWidth}px`,
        height: `${previewHeight}px`,
        backgroundColor: 'white',
        border: '1px solid rgba(0, 0, 0, 0.1)',
        borderRadius: '16px',
        boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.04), 0 2px 4px rgba(0, 0, 0, 0.04), 0 8px 16px rgba(0, 0, 0, 0.08), 0 16px 32px rgba(0, 0, 0, 0.04)',
        overflow: 'hidden',
        zIndex: 99999,
        pointerEvents: 'auto'
      }}
    >
      {loading ? (
        <div style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f9fafb'
        }}>
          <div style={{ color: '#9ca3af', fontSize: '13px' }}>Loading...</div>
        </div>
      ) : pageImage ? (
        <div style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden'
        }}>
          {/* 
            Image + BBOX wrapper - uses CSS transform for zoom/positioning
            This keeps BBOX positioning identical to StandaloneExpandedCardView
          */}
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `translate(${translateX}px, ${translateY}px) scale(${zoom})`,
            transformOrigin: '0 0',
            width: `${imageWidth}px`,
            height: `${imageHeight}px`
          }}>
            {/* Page image at natural size */}
            <img
              src={pageImage}
              alt="Document preview"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: `${imageWidth}px`,
                height: `${imageHeight}px`,
                pointerEvents: 'none'
              }}
            />
            {/* Velora logo - positioned exactly like StandaloneExpandedCardView */}
            <img
              src={veloraLogo}
              alt="Velora"
              style={{
                position: 'absolute',
                left: `${logoLeft}px`,
                top: `${logoTop}px`,
                width: `${logoWidth}px`,
                height: `${logoHeight}px`,
                objectFit: 'contain',
                pointerEvents: 'none',
                zIndex: 11,
                userSelect: 'none',
                border: '2px solid rgba(255, 193, 7, 0.9)',
                borderRadius: '2px',
                backgroundColor: 'white',
                boxSizing: 'border-box'
              }}
            />
            {/* BBOX highlight - positioned exactly like StandaloneExpandedCardView */}
            <div
              style={{
                position: 'absolute',
                left: `${finalBboxLeft}px`,
                top: `${finalBboxTop}px`,
                width: `${Math.min(imageWidth, finalBboxWidth)}px`,
                height: `${Math.min(imageHeight, finalBboxHeight)}px`,
                backgroundColor: 'rgba(255, 235, 59, 0.4)',
                border: '2px solid rgba(255, 193, 7, 0.9)',
                borderRadius: '2px',
                pointerEvents: 'none',
                zIndex: 10,
                boxShadow: '0 2px 8px rgba(255, 193, 7, 0.3)'
              }}
            />
          </div>
        </div>
      ) : (
        <div style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f9fafb'
        }}>
          <div style={{ color: '#9ca3af', fontSize: '13px' }}>Preview unavailable</div>
        </div>
      )}
      {/* Quote icon overlay in top-right corner */}
      <div
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          width: '36px',
          height: '36px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100000,
          pointerEvents: 'none'
        }}
      >
        {/* White backdrop with blurred edges */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            maskImage: 'radial-gradient(circle, black 50%, transparent 80%)',
            WebkitMaskImage: 'radial-gradient(circle, black 50%, transparent 80%)',
            maskSize: 'cover',
            WebkitMaskSize: 'cover',
            maskPosition: 'center',
            WebkitMaskPosition: 'center',
            borderRadius: '8px'
          }}
        />
        {/* Quote icon */}
        <img
          src={citationIcon}
          alt="Citation"
          style={{
            position: 'relative',
            width: '24px',
            height: '24px',
            objectFit: 'contain',
            userSelect: 'none',
            pointerEvents: 'none',
            zIndex: 1
          }}
        />
      </div>
    </div>
  );
  
  // Render via portal to escape overflow containers
  return createPortal(previewContent, document.body);
};

interface SideChatPanelProps {
  isVisible: boolean;
  query: string;
  citationContext?: { // Structured citation metadata (hidden from user, passed to LLM)
    document_id: string;
    page_number: number;
    bbox: { left: number; top: number; width: number; height: number };
    cited_text: string;
    original_filename: string;
  } | null;
  sidebarWidth?: number; // Width of the sidebar to offset the panel
  isSidebarCollapsed?: boolean; // Main navigation sidebar collapsed state (true when "closed" / icon-only)
  isFilingSidebarClosing?: boolean; // Whether FilingSidebar is currently closing (for instant updates)
  isSidebarCollapsing?: boolean; // Whether main sidebar is currently collapsing (for instant updates)
  onQuerySubmit?: (query: string) => void; // Callback for submitting new queries from panel
  onMapToggle?: () => void; // Callback for toggling map view
  onMinimize?: (chatMessages: Array<{ id: string; type: 'query' | 'response'; text: string; attachments?: FileAttachmentData[]; propertyAttachments?: any[]; selectedDocumentIds?: string[]; selectedDocumentNames?: string[]; isLoading?: boolean }>) => void; // Callback for minimizing to bubble with chat messages
  onMessagesUpdate?: (chatMessages: Array<{ id: string; type: 'query' | 'response'; text: string; attachments?: FileAttachmentData[]; propertyAttachments?: any[]; selectedDocumentIds?: string[]; selectedDocumentNames?: string[]; isLoading?: boolean }>) => void; // Callback for real-time message updates
  restoreChatId?: string | null; // Chat ID to restore from history
  newAgentTrigger?: number; // Counter that increments when "New Agent" is clicked from ChatPanel
  onNewChat?: () => void; // Callback when new chat is clicked (to clear query in parent)
  onSidebarToggle?: () => void; // Callback for toggling sidebar
  onOpenProperty?: (address: string | null, coordinates?: { lat: number; lng: number } | null, propertyId?: string | number, navigationOnly?: boolean) => void; // Callback for opening property card
  initialAttachedFiles?: FileAttachmentData[]; // Initial file attachments to restore
  onChatWidthChange?: (width: number) => void; // Callback when chat panel width changes (for map resizing)
  isPropertyDetailsOpen?: boolean; // Whether PropertyDetailsPanel is currently open
  shouldExpand?: boolean; // Whether chat should be expanded (for Analyse mode)
  onQuickStartToggle?: () => void; // Callback to toggle QuickStartBar
  isQuickStartBarVisible?: boolean; // Whether QuickStartBar is currently visible
  isMapVisible?: boolean; // Whether map is currently visible (side-by-side with chat)
  onActiveChatChange?: (isActive: boolean) => void; // Callback when active chat state changes (loading query)
  onOpenChatHistory?: () => void; // Callback to open chat history panel
  /** Exact segment order for query bubble when query comes from SearchBar/MapChatBar (dashboard/map submit). */
  initialContentSegments?: QueryContentSegment[];
  /** Ref set by MainContent on search submit so panel can use segments before state propagates. */
  pendingSearchContentSegmentsRef?: React.MutableRefObject<QueryContentSegment[] | undefined>;
}

export interface SideChatPanelRef {
  getAttachments: () => FileAttachmentData[];
  handleResizeStart: (e: React.MouseEvent) => void;
  isResizing: boolean;
}

// Utility function for computing adjustments from diff (extracted for incremental diff)
function extractAdjustmentsFromDiff(previousPlan: string, currentPlan: string): AdjustmentBlockData[] {
  const changes = diffLines(previousPlan, currentPlan);
  const lines: Array<{ type: 'added' | 'removed' | 'unchanged'; content: string }> = [];
  
  for (const change of changes) {
    const contentLines = change.value.split('\n');
    for (let i = 0; i < contentLines.length; i++) {
      const content = contentLines[i];
      if (content === '' && i === contentLines.length - 1 && contentLines.length > 1) continue;
      
      if (change.added) {
        lines.push({ type: 'added', content });
      } else if (change.removed) {
        lines.push({ type: 'removed', content });
      } else {
        lines.push({ type: 'unchanged', content });
      }
    }
  }
  
  const adjustments: AdjustmentBlockData[] = [];
  let currentSection = 'Changes';
  let adjustmentId = 0;
  let i = 0;
  
  while (i < lines.length) {
    if (lines[i].type === 'unchanged' && lines[i].content.startsWith('##')) {
      currentSection = lines[i].content.replace(/^#+\s*/, '');
    }
    
    if (lines[i].type !== 'unchanged') {
      const removedLines: string[] = [];
      const addedLines: string[] = [];
      
      while (i < lines.length && lines[i].type !== 'unchanged') {
        if (lines[i].type === 'removed') removedLines.push(lines[i].content);
        else if (lines[i].type === 'added') addedLines.push(lines[i].content);
        i++;
      }
      
      if (removedLines.length > 0 || addedLines.length > 0) {
        adjustmentId++;
        let sectionName = currentSection;
        if (removedLines.length > 0 && addedLines.length > 0) sectionName = `Updated ${currentSection}`;
        else if (addedLines.length > 0) sectionName = `Added to ${currentSection}`;
        else sectionName = `Removed from ${currentSection}`;
        
        adjustments.push({
          id: `adjustment-${adjustmentId}`,
          sectionName,
          linesAdded: addedLines.length,
          linesRemoved: removedLines.length,
          removedLines,
          addedLines,
          scrollTargetId: `diff-line-${adjustmentId}`,
        });
      }
    } else {
      i++;
    }
  }
  
  return adjustments;
}

// Utility to check if a new section header has appeared (indicates section completion)
function isSectionComplete(planContent: string, previousContent: string): boolean {
  const prevSections = (previousContent.match(/^###\s+.+$/gm) || []).length;
  const currSections = (planContent.match(/^###\s+.+$/gm) || []).length;
  return currSections > prevSections;
}

export const SideChatPanel = React.forwardRef<SideChatPanelRef, SideChatPanelProps>(({
  isVisible,
  query,
  citationContext,
  sidebarWidth = 56, // Default to desktop sidebar width (lg:w-14 = 56px)
  isSidebarCollapsed = false,
  isFilingSidebarClosing = false, // Default to false
  isSidebarCollapsing = false, // Default to false
  onQuerySubmit,
  onMapToggle,
  onMinimize,
  onMessagesUpdate,
  restoreChatId,
  newAgentTrigger,
  onNewChat,
  onSidebarToggle,
  onOpenProperty,
  initialAttachedFiles,
  onChatWidthChange,
  isPropertyDetailsOpen = false, // Default to false
  shouldExpand = false, // Default to false
  onQuickStartToggle,
  isQuickStartBarVisible = false, // Default to false
  isMapVisible = false, // Default to false
  onActiveChatChange,
  onOpenChatHistory,
  initialContentSegments,
  pendingSearchContentSegmentsRef
}, ref) => {
  // Main navigation state:
  // - collapsed: icon-only sidebar (treat as "closed" for the purposes of showing open controls)
  // - open: full sidebar visible
  const isMainSidebarOpen = !isSidebarCollapsed;
  
  // Track previous sidebar collapsed state to detect collapse immediately for instant updates
  const prevSidebarCollapsedRef = React.useRef(isSidebarCollapsed);
  const [isSidebarJustCollapsed, setIsSidebarJustCollapsed] = React.useState(false);
  
  React.useEffect(() => {
    const wasExpanded = !prevSidebarCollapsedRef.current;
    const justCollapsed = wasExpanded && isSidebarCollapsed;
    setIsSidebarJustCollapsed(justCollapsed);
    // Clear flag after one frame
    if (justCollapsed) {
      requestAnimationFrame(() => {
        setIsSidebarJustCollapsed(false);
      });
    }
    prevSidebarCollapsedRef.current = isSidebarCollapsed;
  }, [isSidebarCollapsed]);

  // Use shared preview context (moved early to ensure expandedCardViewDoc is available)
  const {
    addPreviewFile,
    preloadFile,
    previewFiles,
    getCachedPdfDocument,
    preloadPdfPage,
    setHighlightCitation,
    openExpandedCardView: legacyOpenExpandedCardView, // Legacy - will be removed
    closeExpandedCardView: legacyCloseExpandedCardView, // Legacy - will be removed
    expandedCardViewDoc: legacyExpandedCardViewDoc, // Legacy - will be removed
    setIsAgentOpening,
    setAgentTaskActive,
    stopAgentTask,
    setMapNavigating,
    setIsChatPanelVisible // CRITICAL: Update chat panel visibility directly from SideChatPanel
  } = usePreview();
  
  // NEW: Use ChatStateStore for per-chat document preview isolation
  const {
    activeChatId: storeActiveChatId,
    setActiveChatId: setStoreActiveChatId,
    getChatState,
    initializeChatState,
    openDocumentForChat,
    closeDocumentForChat,
    setMessagesForChat,
    updateMessageInChat,
    startStreamingForChat,
    appendStreamingText: storeAppendStreamingText,
    setStreamingText: storeSetStreamingText,
    addReasoningStep: storeAddReasoningStep,
    updateCitations: storeUpdateCitations,
    completeStreaming: storeCompleteStreaming,
    isChatActive: storeIsChatActive,
    activeChatIdRef: storeActiveChatIdRef
  } = useChatStateStore();
  
  // ChatPanel (agent sidebar) integration - declared early for use in width calculations
  const { isOpen: isChatPanelOpen, width: chatPanelWidth, isResizing: isChatPanelResizing, togglePanel: toggleChatPanel, closePanel: closeChatPanel, triggerGlow } = useChatPanel();
  
  // Track ChatPanel (agent sidebar) open/close to disable transitions for instant updates
  const prevChatPanelOpenRef = React.useRef(isChatPanelOpen);
  const [isChatPanelJustToggled, setIsChatPanelJustToggled] = React.useState(false);
  
  // Citation click panel: show compact preview next to citation instead of opening 50/50 immediately
  const [citationClickPanel, setCitationClickPanel] = React.useState<{
    citationData: CitationData;
    anchorRect: DOMRect;
    sourceMessageText?: string;
    messageId?: string;
    citationNumber?: string;
  } | null>(null);
  // Ref so citation click handler always sees current state (StreamingResponseTextMemo doesn't re-render when callback changes)
  const isDocumentPreviewOpenRef = React.useRef(false);
  // When panel opens and hover cache is empty, we preload and store here so the panel can show the image
  const [citationPanelLoadedImage, setCitationPanelLoadedImage] = React.useState<{
    pageImage: string;
    imageWidth: number;
    imageHeight: number;
  } | null>(null);

  // When citation panel opens: clear stale image, then use cache or preload so preview shows
  const citationPanelKeyRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!citationClickPanel) {
      setCitationPanelLoadedImage(null);
      citationPanelKeyRef.current = null;
      return;
    }
    const data = citationClickPanel.citationData as CitationData & { document_id?: string };
    const docId = data.document_id ?? data.doc_id;
    const pageNum = data.page ?? data.bbox?.page ?? data.page_number ?? 1;
    if (!docId) {
      citationPanelKeyRef.current = null;
      return;
    }
    const panelKey = `${docId}-${pageNum}`;
    citationPanelKeyRef.current = panelKey;
    setCitationPanelLoadedImage(null); // reset so we don't show a previous citation's image

    const cacheKey = `hover-${docId}-${pageNum}`;
    if (hoverPreviewCache.has(cacheKey)) {
      const entry = hoverPreviewCache.get(cacheKey)!;
      setCitationPanelLoadedImage({ pageImage: entry.pageImage, imageWidth: entry.imageWidth, imageHeight: entry.imageHeight });
      return;
    }
    let cancelled = false;
    preloadHoverPreview(docId, pageNum).then((entry) => {
      if (cancelled) return;
      if (citationPanelKeyRef.current !== panelKey) return; // panel changed
      if (entry) {
        setCitationPanelLoadedImage({ pageImage: entry.pageImage, imageWidth: entry.imageWidth, imageHeight: entry.imageHeight });
      }
    });
    return () => { cancelled = true; };
  }, [citationClickPanel]);

  React.useEffect(() => {
    const justToggled = prevChatPanelOpenRef.current !== isChatPanelOpen;
    setIsChatPanelJustToggled(justToggled);
    // Clear flag after one frame to allow instant update
    if (justToggled) {
      requestAnimationFrame(() => {
        setIsChatPanelJustToggled(false);
      });
    }
    prevChatPanelOpenRef.current = isChatPanelOpen;
  }, [isChatPanelOpen]);
  
  // Browser Fullscreen API - shared state so all fullscreen buttons show "Exit" when active
  const { isBrowserFullscreen, toggleBrowserFullscreen } = useBrowserFullscreen();
  
  // Clear locked width when agent sidebar opens/closes during 50/50 mode (document preview open)
  // This allows the dynamic calculation to account for the agent sidebar width
  // Check both isPropertyDetailsOpen AND legacyExpandedCardViewDoc since document preview
  // can be open independently of property details panel
  React.useEffect(() => {
    const isDocPreviewOpen = isPropertyDetailsOpen || !!legacyExpandedCardViewDoc;
    if (isDocPreviewOpen && lockedWidthRef.current) {
      // When in 50/50 mode and agent sidebar state changes, clear locked width
      // so the dynamic calculation (which accounts for chatPanelOffset) takes effect
      lockedWidthRef.current = null;
    }
  }, [isChatPanelOpen, chatPanelWidth, isPropertyDetailsOpen, legacyExpandedCardViewDoc]);
  
  // REF: Track current chat ID for document operations (defined later, used in callbacks)
  // This is a forward declaration pattern - the actual ref is defined after state declarations
  const currentChatIdForDocRef = React.useRef<string | null>(null);
  
  // CRITICAL: Sync SideChatPanel's actual visibility to PreviewContext
  // This ensures document preview knows when chat is actually visible (not just calculated)
  React.useEffect(() => {
    console.log('📋 [SIDE_CHAT_PANEL] Visibility changed:', { isVisible });
    setIsChatPanelVisible(isVisible);
  }, [isVisible, setIsChatPanelVisible]);

  // Helper function to clean text of CHUNK markers and EVIDENCE_FEEDBACK tags
  // This prevents artifacts from showing during streaming
  const cleanResponseText = (text: string): string => {
    if (!text) return text;
    
    let cleaned = text;
    
    // First, remove complete EVIDENCE_FEEDBACK tags (including content between tags)
    const feedbackStartIdx = cleaned.indexOf('<EVIDENCE_FEEDBACK>');
    if (feedbackStartIdx !== -1) {
      const feedbackEndIdx = cleaned.indexOf('</EVIDENCE_FEEDBACK>', feedbackStartIdx);
      if (feedbackEndIdx !== -1) {
        // Remove the entire tag and its content
        cleaned = cleaned.substring(0, feedbackStartIdx) + cleaned.substring(feedbackEndIdx + '</EVIDENCE_FEEDBACK>'.length);
      } else {
        // No end tag found, remove from start tag onwards
        cleaned = cleaned.substring(0, feedbackStartIdx);
      }
    }
    
    // Remove partial EVIDENCE_FEEDBACK tags that might appear during streaming
    // Match incomplete tags at the end of the string (e.g., "<EVIDENCE_FEEDBACK" or "<EVIDENCE_FEEDBACK>")
    cleaned = cleaned.replace(/<EVIDENCE_FEEDBACK[^>]*$/g, '');
    
    // Remove complete [CHUNK:X] markers (including with PAGE:Y)
    // Pattern matches: [CHUNK:0], [CHUNK:1], [CHUNK:123], [CHUNK:0:PAGE:1], etc.
    cleaned = cleaned.replace(/\[CHUNK:\d+(?::PAGE:\d+)?\]/g, '');
    
    // Remove BLOCK_CITE_ID references (e.g., "(BLOCK_CITE_ID_136)", "BLOCK_CITE_ID_136", "[BLOCK_CITE_ID_136]")
    // Pattern matches: (BLOCK_CITE_ID_123), BLOCK_CITE_ID_123, [BLOCK_CITE_ID_123], or any variation
    cleaned = cleaned.replace(/\s*[\[\(]?BLOCK_CITE_ID_\d+[\]\)]?\s*/g, ' ');
    
    // Strip internal MAIN tags so they never appear in the UI (allow 1–3 closing > for malformed LLM output)
    cleaned = cleaned.replace(/<<<MAIN>>>/g, '');
    cleaned = cleaned.replace(/<<<END_MAIN\s*>+/g, '');
    
    // Remove partial CHUNK markers that might appear during streaming
    // These appear at the end of the string as tokens arrive incrementally
    // Match patterns like: "[CHUNK:", "[CHUNK:1", "[CHUNK:12", "[CHUNK:1:", "[CHUNK:1:PAGE:1", etc.
    // Only match if it's at the end of the string (incomplete marker)
    cleaned = cleaned.replace(/\[CHUNK:\d*(?::PAGE?:\d*)?$/g, '');
    
    // Remove tool call syntax that LLM sometimes outputs as plain text
    // Pattern: superscript number + space + cite_source(...)
    // Examples: "¹ cite_source(...)", "² cite_source(...)", etc.
    // Handle both single-line and multi-line tool calls (using 's' flag for dotall)
    cleaned = cleaned.replace(/[¹²³⁴⁵⁶⁷⁸⁹]+\s+cite_source\([^)]*\)/gs, '');
    // Remove any standalone cite_source calls (without superscript prefix)
    // This handles cases where the LLM outputs tool syntax without the citation number
    cleaned = cleaned.replace(/cite_source\([^)]*\)/gs, '');
    
    // Remove duplicate citation reference lists at the end
    // Pattern: Numbered list of citations like:
    // "¹ The property is currently..."
    // "² Prior to this..."
    // This happens when LLM adds a reference list after the main text
    // Match: newline(s) + superscript + space + text + (newline + superscript + space + text)* + end
    cleaned = cleaned.replace(/\n\n[¹²³⁴⁵⁶⁷⁸⁹]\s+[^\n]+(?:\n[¹²³⁴⁵⁶⁷⁸⁹]\s+[^\n]+)*\s*$/g, '');
    // Also handle single newline case
    cleaned = cleaned.replace(/\n[¹²³⁴⁵⁶⁷⁸⁹]\s+[^\n]+(?:\n[¹²³⁴⁵⁶⁷⁸⁹]\s+[^\n]+)*\s*$/g, '');
    
    return cleaned.trim();
  };

  const [inputValue, setInputValue] = React.useState<string>("");
  const [isSubmitted, setIsSubmitted] = React.useState<boolean>(false);
  const [isFocused, setIsFocused] = React.useState<boolean>(false);
  const [hoveredQueryId, setHoveredQueryId] = React.useState<string | null>(null);
  const [copiedQueryId, setCopiedQueryId] = React.useState<string | null>(null);
  const [isHoveringName, setIsHoveringName] = React.useState<boolean>(false);
  const [isNearEditButton, setIsNearEditButton] = React.useState<boolean>(false);
  const editButtonRef = React.useRef<HTMLButtonElement>(null);

  // Copy query text to clipboard
  const handleCopyQuery = async (queryText: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(queryText);
      setCopiedQueryId(messageId);
      setTimeout(() => setCopiedQueryId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  // Bot status overlay state
  const [isBotActive, setIsBotActive] = React.useState<boolean>(false);
  const [botActivityMessage, setBotActivityMessage] = React.useState<string>('Running...');
  const [isBotPaused, setIsBotPaused] = React.useState<boolean>(false);
  const isBotPausedRef = React.useRef<boolean>(false); // Ref for pause state (accessible in closures)
  const isOpeningDocumentRef = React.useRef<boolean>(false); // Track when document is being opened
  const resumeProcessingRef = React.useRef<(() => void) | null>(null); // Function to resume processing when unpaused
  
  // Property search state
  const [propertySearchQuery, setPropertySearchQuery] = React.useState<string>("");
  const [propertySearchResults, setPropertySearchResults] = React.useState<PropertyData[]>([]);
  const [showPropertySearchPopup, setShowPropertySearchPopup] = React.useState<boolean>(false);
  
  // Web search state
  const [isWebSearchEnabled, setIsWebSearchEnabled] = React.useState<boolean>(false);
  const propertySearchPopupRef = React.useRef<HTMLDivElement>(null);
  const propertySearchDebounceRef = React.useRef<NodeJS.Timeout | null>(null);
  
  // @ mention popover state (files + properties)
  const [atMentionOpen, setAtMentionOpen] = React.useState<boolean>(false);
  const [atQuery, setAtQuery] = React.useState<string>('');
  const [atAnchorIndex, setAtAnchorIndex] = React.useState<number>(-1);
  const [atItems, setAtItems] = React.useState<AtMentionItem[]>([]);
  const [atSelectedIndex, setAtSelectedIndex] = React.useState<number>(0);
  const [atMentionDocumentChips, setAtMentionDocumentChips] = React.useState<Array<{ id: string; label: string }>>([]);
  const [atAnchorRect, setAtAnchorRect] = React.useState<{ left: number; top: number; bottom: number; height: number } | null>(null);
  
  React.useEffect(() => {
    if (!atMentionOpen) {
      setAtItems([]);
      return;
    }
    setAtItems(getFilteredAtMentionItems(atQuery));
    preloadAtMentionCache().then(() => {
      setAtItems(getFilteredAtMentionItems(atQuery));
    });
  }, [atMentionOpen, atQuery]);
  
  // QuickStartBar positioning refs and state
  const chatFormRef = React.useRef<HTMLFormElement>(null);
  const quickStartBarWrapperRef = React.useRef<HTMLDivElement>(null);
  const chatInputContainerRef = React.useRef<HTMLDivElement>(null);
  const [quickStartBarBottom, setQuickStartBarBottom] = React.useState<string>('calc(75% - 16px)');
  const [quickStartBarTransform, setQuickStartBarTransform] = React.useState<string>('translateX(-50%)');
  
  // Property search logic - detect when user types property-related queries
  React.useEffect(() => {
    if (propertySearchDebounceRef.current) {
      clearTimeout(propertySearchDebounceRef.current);
    }

    // Extract property search query from input (look for @property or location keywords)
    const extractPropertyQuery = (text: string): string | null => {
      // Check for @property pattern
      const atPropertyMatch = text.match(/@property\s+(.+)/i);
      if (atPropertyMatch) {
        return atPropertyMatch[1].trim();
      }
      
      // Check if text ends with location-like patterns (could be property search)
      // Only search if text is at least 2 characters and looks like a location/property query
      const trimmed = text.trim();
      if (trimmed.length >= 2) {
        // Check for common property/location keywords
        const propertyKeywords = ['property', 'house', 'home', 'address', 'location', 'in', 'at', 'near'];
        const hasPropertyKeyword = propertyKeywords.some(keyword => 
          trimmed.toLowerCase().includes(keyword.toLowerCase())
        );
        
        // If it contains property keywords or looks like an address, treat as property search
        if (hasPropertyKeyword || /^[A-Za-z0-9\s,.-]+$/.test(trimmed)) {
          return trimmed;
        }
      }
      
      return null;
    };

    const query = extractPropertyQuery(inputValue);
    
    if (query && query.length >= 1) {
      const debounceTime = query.length === 1 ? 0 : 50;
      propertySearchDebounceRef.current = setTimeout(async () => {
        try {
          const response = await backendApi.searchPropertyHubs(query, {});
          
          let results: any[] = [];
          
          if (response.success && response.data) {
            const data = response.data as any;
            if (Array.isArray(data)) {
              results = data;
            } else if (data && typeof data === 'object' && data.data && Array.isArray(data.data)) {
              results = data.data;
            } else if (data && typeof data === 'object' && data.success && Array.isArray(data.data)) {
              results = data.data;
            }
          }
          
          if (results.length > 0) {
            const queryLower = query.toLowerCase().trim();
            const sortedResults = results
              .map((hub: any) => {
                const property = hub.property || hub;
                const propertyDetails = hub.property_details || {};
                
                const address = (property.formatted_address || property.normalized_address || property.address || '').toLowerCase();
                const customName = (property.custom_name || '').toLowerCase();
                
                let score = 0;
                if (customName && customName.startsWith(queryLower)) score += 100;
                else if (customName && customName.includes(queryLower)) score += 50;
                if (address.startsWith(queryLower)) score += 80;
                else if (address.includes(queryLower)) {
                  const index = address.indexOf(queryLower);
                  score += Math.max(0, 60 - index);
                }
                
                return {
                  id: property.id || hub.id,
                  address: property.formatted_address || property.normalized_address || property.address || 'Unknown Address',
                  property_type: propertyDetails.property_type || property.property_type,
                  custom_name: property.custom_name,
                  image: property.image,
                  primary_image_url: property.primary_image_url,
                  ...property,
                  ...propertyDetails,
                  _relevanceScore: score
                };
              })
              .sort((a, b) => (b._relevanceScore || 0) - (a._relevanceScore || 0))
              .slice(0, 10);
            
            setPropertySearchResults(sortedResults);
            setShowPropertySearchPopup(true);
            setPropertySearchQuery(query);
          } else {
            setPropertySearchResults([]);
            setShowPropertySearchPopup(false);
          }
        } catch (error) {
          console.error('Error searching properties:', error);
          setPropertySearchResults([]);
          setShowPropertySearchPopup(false);
        }
      }, debounceTime);
    } else {
      setPropertySearchResults([]);
      setShowPropertySearchPopup(false);
      setPropertySearchQuery("");
    }

    return () => {
      if (propertySearchDebounceRef.current) {
        clearTimeout(propertySearchDebounceRef.current);
      }
    };
  }, [inputValue]);

  // Close popup when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        propertySearchPopupRef.current &&
        !propertySearchPopupRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowPropertySearchPopup(false);
      }
    };

    if (showPropertySearchPopup) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showPropertySearchPopup]);

  // Preload BBOX preview when citation context is prepared (user clicks "Ask a question")
  React.useEffect(() => {
    const handleCitationContextPrepare = (event: CustomEvent) => {
      const { citationContext } = event.detail;
      if (citationContext && citationContext.document_id) {
        console.log('⚡ [BBOX Preview] Preloading citation preview:', citationContext);
        preloadBboxPreview(citationContext).catch(err => {
          console.warn('[BBOX Preview] Preload failed:', err);
        });
      }
    };
    
    const handleCitationContextClear = () => {
      // Clear cache when user cancels
      console.log('🧹 [BBOX Preview] Clearing cache (user cancelled)');
      clearBboxPreviewCache();
    };
    
    window.addEventListener('citation-context-prepare', handleCitationContextPrepare as EventListener);
    window.addEventListener('citation-context-clear', handleCitationContextClear as EventListener);
    
    return () => {
      window.removeEventListener('citation-context-prepare', handleCitationContextPrepare as EventListener);
      window.removeEventListener('citation-context-clear', handleCitationContextClear as EventListener);
    };
  }, []);

  // Handle property selection - will be defined after usePropertySelection hook
  
  // Always start in multi-line mode for the requested layout (textarea above icons)
  const [isMultiLine, setIsMultiLine] = React.useState<boolean>(true);
  // State for expanded chat view (half screen)
  const [isExpanded, setIsExpanded] = React.useState<boolean>(false);
  // Track if we're in fullscreen mode from dashboard (persists even after shouldExpand resets)
  const isFullscreenFromDashboardRef = React.useRef<boolean>(false);
  // Track if user manually requested fullscreen (should not be cleared by useEffect)
  const isManualFullscreenRef = React.useRef<boolean>(false);
  const [isFullscreenMode, setIsFullscreenMode] = React.useState<boolean>(false);
  // Track fullscreen state when chat is closed so we can restore it when reopened
  const wasFullscreenWhenClosedRef = React.useRef<boolean>(false);
  // Track if this is the first time the panel is becoming visible (to disable animation on first open)
  const [isFirstOpen, setIsFirstOpen] = React.useState<boolean>(true);
  // Track actual rendered width of the panel for responsive design
  const [actualPanelWidth, setActualPanelWidth] = React.useState<number>(CHAT_PANEL_WIDTH.COLLAPSED);
  // Track actual input container width for button responsive design
  const [inputContainerWidth, setInputContainerWidth] = React.useState<number>(CHAT_PANEL_WIDTH.COLLAPSED);
  // Track if we just entered fullscreen to disable transition
  const [justEnteredFullscreen, setJustEnteredFullscreen] = React.useState<boolean>(false);
  // State for drag over feedback
  const [isDragOver, setIsDragOver] = React.useState<boolean>(false);
  // Ref to track drag state to prevent false clears when moving between child elements
  const isDragOverRef = React.useRef<boolean>(false);
  // Track locked width to prevent expansion when property details panel closes
  const lockedWidthRef = React.useRef<string | null>(null);
  // Track if agent is performing a navigation task (prevents fullscreen re-expansion)
  const isNavigatingTaskRef = React.useRef<boolean>(false);
  // Track custom dragged width for resizing
  const [draggedWidth, setDraggedWidth] = React.useState<number | null>(null);
  const [isResizing, setIsResizing] = React.useState<boolean>(false);
  // Track if this is the first citation clicked in the current chat session
  const isFirstCitationRef = React.useRef<boolean>(true);
  
  // Track button row collapse level for responsive overflow handling
  // 0 = all labels shown, 1 = some collapsed, 2 = all icons only, 3 = hide some buttons
  const [buttonCollapseLevel, setButtonCollapseLevel] = React.useState<number>(0);
  const buttonRowRef = React.useRef<HTMLDivElement>(null);
  const emptyButtonRowRef = React.useRef<HTMLDivElement>(null);
  
  // CRITICAL: When chat becomes visible with a document already open (silent background opening),
  // trigger 50/50 split so document appears immediately with correct layout
  // This handles the case where agent action opened document while chat was hidden
  // NOTE: Uses legacyExpandedCardViewDoc because wrapped version is defined later in code
  const prevChatVisibleForDocRef = React.useRef<boolean>(isVisible);
  React.useEffect(() => {
    const chatJustBecameVisible = !prevChatVisibleForDocRef.current && isVisible;
    prevChatVisibleForDocRef.current = isVisible;
    
    if (chatJustBecameVisible && legacyExpandedCardViewDoc) {
      // Chat just became visible and document is already open (was opened silently in background)
      // Trigger 50/50 split so document appears with correct layout
      console.log('📂 [SIDE_CHAT_PANEL] Chat visible with silently-opened document - triggering 50/50 split:', {
        docId: legacyExpandedCardViewDoc.docId,
        filename: legacyExpandedCardViewDoc.filename,
        hasHighlight: !!legacyExpandedCardViewDoc.highlight
      });
      setIsExpanded(true);
      setDraggedWidth(null); // Clear any dragged width so unified width calculation takes effect
      // NOTE: Don't set lockedWidthRef - the unified calculateChatPanelWidth will use 50% split
      // because legacyExpandedCardViewDoc is already open
      
      // Width notification will happen via useEffect when isExpanded/expandedCardViewDoc changes
      
      // Mark that we've seen a citation (so subsequent citations don't trigger this again)
      isFirstCitationRef.current = false;
    }
  }, [isVisible, legacyExpandedCardViewDoc, onChatWidthChange, setIsExpanded]);
  
  // Use refs to store resize state for performance (avoid re-renders during drag)
  const resizeStateRef = React.useRef<{
    startPos: { x: number };
    startWidth: number;
    hasStartedDragging: boolean; // Track if user has actually started dragging
  } | null>(null);
  const rafIdRef = React.useRef<number | null>(null);
  const panelElementRef = React.useRef<HTMLElement | null>(null);
  
  // State for reasoning trace toggle - persisted to localStorage
  const [showReasoningTrace, setShowReasoningTrace] = React.useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('showReasoningTrace');
      if (saved === null) return true; // Default ON
      const parsed = JSON.parse(saved);
      return parsed === true; // Ensure it's exactly boolean true
    } catch {
      return true; // Default ON if parsing fails
    }
  });
  
  // Persist reasoning trace toggle to localStorage when changed
  React.useEffect(() => {
    localStorage.setItem('showReasoningTrace', JSON.stringify(showReasoningTrace));
  }, [showReasoningTrace]);

  // State for blue highlight toggle - persisted to localStorage
  const [showHighlight, setShowHighlight] = React.useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('showHighlight');
      if (saved === null) return true; // Default ON
      const parsed = JSON.parse(saved);
      return parsed === true;
    } catch {
      return true;
    }
  });
  React.useEffect(() => {
    localStorage.setItem('showHighlight', JSON.stringify(showHighlight));
  }, [showHighlight]);

  // State for citations toggle - persisted to localStorage
  const [showCitations, setShowCitations] = React.useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('showCitations');
      if (saved === null) return true; // Default ON
      const parsed = JSON.parse(saved);
      return parsed === true;
    } catch {
      return true;
    }
  });
  React.useEffect(() => {
    localStorage.setItem('showCitations', JSON.stringify(showCitations));
  }, [showCitations]);

  // Response popover: hover open/close with delay
  const [displayOptionsOpen, setDisplayOptionsOpen] = React.useState(false);
  const displayOptionsOpenTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayOptionsCloseTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const HOVER_OPEN_DELAY_MS = 150;
  const HOVER_CLOSE_DELAY_MS = 200;

  const clearDisplayOptionsOpenTimeout = () => {
    if (displayOptionsOpenTimeoutRef.current !== null) {
      clearTimeout(displayOptionsOpenTimeoutRef.current);
      displayOptionsOpenTimeoutRef.current = null;
    }
  };
  const clearDisplayOptionsCloseTimeout = () => {
    if (displayOptionsCloseTimeoutRef.current !== null) {
      clearTimeout(displayOptionsCloseTimeoutRef.current);
      displayOptionsCloseTimeoutRef.current = null;
    }
  };

  React.useEffect(() => {
    return () => {
      clearDisplayOptionsOpenTimeout();
      clearDisplayOptionsCloseTimeout();
    };
  }, []);

  const handleDisplayOptionsTriggerEnter = () => {
    clearDisplayOptionsCloseTimeout();
    displayOptionsOpenTimeoutRef.current = setTimeout(() => setDisplayOptionsOpen(true), HOVER_OPEN_DELAY_MS);
  };
  const handleDisplayOptionsTriggerLeave = () => {
    clearDisplayOptionsOpenTimeout();
    displayOptionsCloseTimeoutRef.current = setTimeout(() => setDisplayOptionsOpen(false), HOVER_CLOSE_DELAY_MS);
  };
  const handleDisplayOptionsContentEnter = () => {
    clearDisplayOptionsCloseTimeout();
  };
  const handleDisplayOptionsContentLeave = () => {
    displayOptionsCloseTimeoutRef.current = setTimeout(() => setDisplayOptionsOpen(false), HOVER_CLOSE_DELAY_MS);
  };

  // View options popover (Sidebar, Files, New chat, Fullscreen): same hover open/close pattern
  const [viewOptionsOpen, setViewOptionsOpen] = React.useState(false);
  const viewOptionsOpenTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewOptionsCloseTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearViewOptionsOpenTimeout = () => {
    if (viewOptionsOpenTimeoutRef.current != null) {
      clearTimeout(viewOptionsOpenTimeoutRef.current);
      viewOptionsOpenTimeoutRef.current = null;
    }
  };
  const clearViewOptionsCloseTimeout = () => {
    if (viewOptionsCloseTimeoutRef.current != null) {
      clearTimeout(viewOptionsCloseTimeoutRef.current);
      viewOptionsCloseTimeoutRef.current = null;
    }
  };
  React.useEffect(() => {
    return () => {
      clearViewOptionsOpenTimeout();
      clearViewOptionsCloseTimeout();
    };
  }, []);
  const handleViewOptionsTriggerEnter = () => {
    clearViewOptionsCloseTimeout();
    viewOptionsOpenTimeoutRef.current = setTimeout(() => setViewOptionsOpen(true), HOVER_OPEN_DELAY_MS);
  };
  const handleViewOptionsTriggerLeave = () => {
    clearViewOptionsOpenTimeout();
    viewOptionsCloseTimeoutRef.current = setTimeout(() => setViewOptionsOpen(false), HOVER_CLOSE_DELAY_MS);
  };
  const handleViewOptionsContentEnter = () => { clearViewOptionsCloseTimeout(); };
  const handleViewOptionsContentLeave = () => {
    viewOptionsCloseTimeoutRef.current = setTimeout(() => setViewOptionsOpen(false), HOVER_CLOSE_DELAY_MS);
  };

  // Sync expanded state with shouldExpand prop
  React.useEffect(() => {
    console.log('🔄 SideChatPanel: shouldExpand changed', { shouldExpand, isExpanded, isFullscreenMode, isPropertyDetailsOpen, isNavigatingTask: isNavigatingTaskRef.current });
    
    // CRITICAL: Don't re-expand to fullscreen if we're in the middle of a navigation task
    // Navigation tasks shrink the chat to 380px and should NOT be overridden
    // Exception: when property details is open, we must expand to keep split view aligned
    if (isNavigatingTaskRef.current && !isPropertyDetailsOpen) {
      console.log('🚫 Skipping fullscreen expansion - navigation task in progress');
      return;
    }
    
    if (shouldExpand) {
      // shouldExpand is true - expand the chat
      if (!isExpanded) {
      setIsExpanded(true);
      }
      
      // Only set fullscreen mode when shouldExpand is true AND property details is NOT open
      // When property details is open, use 50/50 split width (not fullscreen)
      if (!isPropertyDetailsOpen) {
        // Set fullscreen mode (from dashboard query) - do this immediately
        if (!isFullscreenMode) {
          console.log('✅ Setting fullscreen mode from dashboard');
          isFullscreenFromDashboardRef.current = true;
          setIsFullscreenMode(true);
          // Clear dragged width so fullscreen width calculation takes effect
          setDraggedWidth(null);
          // Mark that we just entered fullscreen to disable transition
          setJustEnteredFullscreen(true);
          // Reset the flag after a brief delay to ensure smooth transition
          setTimeout(() => {
            setJustEnteredFullscreen(false);
          }, 50); // Reduced from 100ms for faster transition
        }
      } else {
        // Property details is open - use 50/50 split width (not fullscreen)
        // Clear fullscreen mode if it was set (but not if user manually requested fullscreen)
        if (isFullscreenMode && !isManualFullscreenRef.current) {
          console.log('📐 Property details open - clearing fullscreen mode, using 50/50 split');
          setIsFullscreenMode(false);
          isFullscreenFromDashboardRef.current = false;
        }
        // Clear locked width so dynamic 50/50 calculation takes effect (unless user manually requested fullscreen)
        if (!isManualFullscreenRef.current) {
          lockedWidthRef.current = null;
          // Clear dragged width so dynamic width takes effect
          setDraggedWidth(null);
        }
      }
    }
    // DON'T reset fullscreen mode when shouldExpand becomes false
    // The fullscreen mode should persist until user manually collapses or new query from map
    // We only reset it in the collapse handler below
  }, [shouldExpand, isExpanded, isPropertyDetailsOpen, isFullscreenMode]);
  
  // Reset fullscreen flag when user manually collapses
  React.useEffect(() => {
    if (!isExpanded && isFullscreenFromDashboardRef.current) {
      // User manually collapsed, reset the flags
      isFullscreenFromDashboardRef.current = false;
      setIsFullscreenMode(false);
      isManualFullscreenRef.current = false; // Clear manual fullscreen flag
      wasFullscreenBeforeCitationRef.current = false; // Also reset citation flag when manually collapsing
    }
  }, [isExpanded]);
  
  // Save fullscreen state when chat closes, restore when it reopens
  const prevIsVisibleRef = React.useRef<boolean>(isVisible);
  React.useEffect(() => {
    const wasVisible = prevIsVisibleRef.current;
    prevIsVisibleRef.current = isVisible;
    
    if (wasVisible && !isVisible) {
      // Chat is closing - save fullscreen state
      wasFullscreenWhenClosedRef.current = isFullscreenMode || isManualFullscreenRef.current || isFullscreenFromDashboardRef.current;
      console.log('💾 Chat closing - saving fullscreen state:', wasFullscreenWhenClosedRef.current);
    } else if (!wasVisible && isVisible) {
      // Chat is opening - track first open to disable animation on initial render
      if (isFirstOpen) {
        // This is the first open - disable transitions
        setIsFirstOpen(false);
      }
      
      // CRITICAL: If opening with shouldExpand, set fullscreen immediately to prevent flash
      if (shouldExpand && !isPropertyDetailsOpen) {
        console.log('🔄 Chat opening with shouldExpand - setting fullscreen immediately');
        setIsFullscreenMode(true);
        isFullscreenFromDashboardRef.current = true;
        setIsExpanded(true);
        setDraggedWidth(null); // Clear any dragged width so fullscreen width takes effect
        lockedWidthRef.current = null;
        // Disable transition for instant fullscreen - set immediately
        setJustEnteredFullscreen(true);
        // Clear after render completes
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setJustEnteredFullscreen(false);
          });
        });
      } else if (wasFullscreenWhenClosedRef.current && !shouldExpand) {
        // Chat is opening - restore fullscreen state if we were in fullscreen before
        console.log('🔄 Chat opening - restoring fullscreen state');
        setIsFullscreenMode(true);
        isFullscreenFromDashboardRef.current = true;
        setIsExpanded(true);
        setDraggedWidth(null); // Clear any dragged width so fullscreen width takes effect
        lockedWidthRef.current = null;
        // Disable transition for instant fullscreen
        setJustEnteredFullscreen(true);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setJustEnteredFullscreen(false);
          });
        });
      }
      
    }
  }, [isVisible, isFullscreenMode, shouldExpand, isPropertyDetailsOpen]);
  
  // Calculate QuickStartBar position dynamically based on chat bar position
  React.useLayoutEffect(() => {
    if (!isQuickStartBarVisible || !chatFormRef.current || !chatInputContainerRef.current || !quickStartBarWrapperRef.current) {
      // Reset to default position when not visible
      if (!isQuickStartBarVisible) {
        setQuickStartBarBottom('calc(100% + 12px)');
      }
      return;
    }

    const calculatePosition = () => {
      const chatForm = chatFormRef.current;
      const container = chatInputContainerRef.current;
      const quickStartWrapper = quickStartBarWrapperRef.current;
      
      if (!chatForm || !container || !quickStartWrapper) {
        // Fallback position if refs aren't ready
        setQuickStartBarBottom('calc(100% + 12px)');
        return;
      }

      // Get the form's inner div (the white chat bar container with the actual width)
      const formInnerDiv = chatForm.querySelector('div') as HTMLElement;
      if (!formInnerDiv) {
        // Fallback position if form structure isn't ready
        setQuickStartBarBottom('calc(100% + 12px)');
        return;
      }

      // Get positions - use offsetTop for more reliable relative positioning
      const containerHeight = container.offsetHeight;
      const formTopRelative = formInnerDiv.offsetTop;
      
      // Calculate spacing (negative value to bring QuickStartBar down closer to chat bar)
      const spacing = -55;
      
      // Position QuickStartBar above the form with spacing
      // bottom = container height - (form top relative to container) + spacing
      const bottomPosition = containerHeight - formTopRelative + spacing;
      
      // Ensure position is reasonable (not negative or too large)
      const safeBottomPosition = Math.max(12, Math.min(bottomPosition, containerHeight + 100));
      
      // Set the bottom position
      setQuickStartBarBottom(`${safeBottomPosition}px`);
      
      // QuickStartBar is now centered, so we just need to set maxWidth to match chat bar
        quickStartWrapper.style.width = 'fit-content';
      // In fullscreen mode, allow wider QuickStartBar, otherwise use 768px
      // QuickStartBar should match chat bar width (640px) for alignment
      quickStartWrapper.style.maxWidth = '680px'; // Match content wrapper maxWidth
      setQuickStartBarTransform('translateX(-50%)'); // Always center
      
      // Ensure visibility
      quickStartWrapper.style.visibility = 'visible';
      quickStartWrapper.style.opacity = '1';
    };

    // Initial calculation with a small delay to ensure DOM is ready
    const timeoutId = setTimeout(calculatePosition, 50);

    // Use ResizeObserver to recalculate when dimensions change
    const resizeObserver = new ResizeObserver(() => {
      // Debounce resize updates
      setTimeout(calculatePosition, 10);
    });

    // Observe the container, form, and form's inner div
    if (chatInputContainerRef.current) {
      resizeObserver.observe(chatInputContainerRef.current);
    }
    if (chatFormRef.current) {
      resizeObserver.observe(chatFormRef.current);
      const formInnerDiv = chatFormRef.current.querySelector('div');
      if (formInnerDiv) {
        resizeObserver.observe(formInnerDiv);
      }
    }

    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
    };
  }, [isQuickStartBarVisible, isExpanded]); // Recalculate when visibility or expanded state changes
  
  // Clear locked width when property details panel opens in expanded chat (use dynamic 50/50 calculation)
  React.useEffect(() => {
    if (isExpanded && isPropertyDetailsOpen) {
      lockedWidthRef.current = null;
    }
  }, [isExpanded, isPropertyDetailsOpen]);
  
  // Handle resize functionality - similar to PDF preview modal
  // Track if we were in fullscreen when resize started (to handle exit on actual drag)
  const wasFullscreenOnResizeStartRef = React.useRef(false);
  const hasExitedFullscreenDuringResizeRef = React.useRef(false);
  
  // Store current values in refs for stable handleResizeStart callback
  const resizeFullscreenModeRef = React.useRef(isFullscreenMode);
  const resizePropertyDetailsOpenRef = React.useRef(isPropertyDetailsOpen);
  const resizeDraggedWidthRef = React.useRef(draggedWidth);
  const resizeIsExpandedRef = React.useRef(isExpanded);
  const resizeSidebarWidthRef = React.useRef(sidebarWidth);
  const resizeDocPreviewRef = React.useRef(legacyExpandedCardViewDoc);
  
  // Keep refs in sync with state
  React.useEffect(() => {
    resizeFullscreenModeRef.current = isFullscreenMode;
    resizePropertyDetailsOpenRef.current = isPropertyDetailsOpen;
    resizeDraggedWidthRef.current = draggedWidth;
    resizeIsExpandedRef.current = isExpanded;
    resizeSidebarWidthRef.current = sidebarWidth;
    resizeDocPreviewRef.current = legacyExpandedCardViewDoc;
  });
  
  const handleResizeStart = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Use panelRef directly instead of searching from event target
    // This allows the function to be called from external components (like StandaloneExpandedCardView)
    const panelElement = panelRef.current || e.currentTarget.closest('[class*="fixed"]') as HTMLElement;
    if (!panelElement) return;
    
    panelElementRef.current = panelElement;
    const rect = panelElement.getBoundingClientRect();
    
    // Get the actual current width from the DOM element
    const actualCurrentWidth = rect.width;
    
    // Check if we're in fullscreen mode (use refs for latest values)
    const isInFullscreen = resizeFullscreenModeRef.current && !resizePropertyDetailsOpenRef.current;
    wasFullscreenOnResizeStartRef.current = isInFullscreen;
    hasExitedFullscreenDuringResizeRef.current = false;
    
    // If in fullscreen, immediately exit and set width to cursor position
    if (isInFullscreen) {
      setIsFullscreenMode(false);
      isFullscreenFromDashboardRef.current = false;
      hasExitedFullscreenDuringResizeRef.current = true;
      
      // Calculate width based on cursor position (where user touched the handle)
      const availableWidth = window.innerWidth - resizeSidebarWidthRef.current;
      const cursorDistanceFromLeft = e.clientX - resizeSidebarWidthRef.current;
      // Clamp to min/max bounds
      // If document preview is open, cap max width to leave room for it
      // Must account for: left gap (12px) + min doc preview width (380px) + right gap (12px) = 404px
      const isDocPreviewOpen = !!resizeDocPreviewRef.current;
      const minWidth = CHAT_PANEL_WIDTH.COLLAPSED;
      const docPreviewTotalSpace = CHAT_PANEL_WIDTH.DOC_PREVIEW_MIN + 24; // min width + gaps
      const maxWidth = isDocPreviewOpen 
        ? availableWidth - docPreviewTotalSpace 
        : availableWidth;
      const targetWidth = Math.min(Math.max(cursorDistanceFromLeft, minWidth), maxWidth);
      
      // Apply the width immediately based on cursor position
      panelElement.style.width = `${targetWidth}px`;
      setDraggedWidth(targetWidth);
      if (onChatWidthChange) {
        onChatWidthChange(targetWidth);
      }
      
      // Set starting width to cursor position for resize calculations
      // But don't start tracking drag until user actually moves mouse
      resizeStateRef.current = {
        startPos: { x: e.clientX },
        startWidth: targetWidth,
        hasStartedDragging: false // Track if user has actually started dragging
      };
    } else {
      // Not in fullscreen - use current width
      let currentWidth: number;
      
      if (resizeDraggedWidthRef.current !== null) {
        currentWidth = resizeDraggedWidthRef.current;
      } else if (actualCurrentWidth > 0) {
        currentWidth = actualCurrentWidth;
      } else {
        // 50% of available width (after sidebar) when property details is open
        currentWidth = resizeIsExpandedRef.current 
          ? (resizePropertyDetailsOpenRef.current ? (window.innerWidth - resizeSidebarWidthRef.current) / 2 : window.innerWidth * (CHAT_PANEL_WIDTH.EXPANDED_VW / 100))
          : CHAT_PANEL_WIDTH.COLLAPSED;
      }
      
      resizeStateRef.current = {
        startPos: { x: e.clientX },
        startWidth: currentWidth,
        hasStartedDragging: true // Already have a width, can start tracking immediately
      };
    }
    
    setIsResizing(true);
  }, [onChatWidthChange]);

  // Handle resize mouse move and cleanup - using useEffect like PDF preview modal
  // ULTRA SMOOTH: Directly manipulates both chat panel AND document preview DOM for zero-lag sync
  React.useEffect(() => {
    if (!isResizing || !resizeStateRef.current || !panelElementRef.current) {
      return;
    }

    const minWidth = CHAT_PANEL_WIDTH.COLLAPSED;
    // Allow dragging to the edge of the screen (only account for sidebar width)
    // BUT if document preview is open, cap max width to leave room for document preview
    // Must account for: left gap (12px) + min doc preview width (380px) + right gap (12px) = 404px
    const isDocPreviewOpen = !!legacyExpandedCardViewDoc;
    const baseMaxWidth = window.innerWidth - sidebarWidth;
    const docPreviewTotalSpace = CHAT_PANEL_WIDTH.DOC_PREVIEW_MIN + 24; // min width + gaps (12px left + 12px right)
    const maxWidth = isDocPreviewOpen 
      ? baseMaxWidth - docPreviewTotalSpace 
      : baseMaxWidth;

    // Find the document preview element for direct DOM manipulation
    // This ensures both panels resize together with zero lag
    const documentPreviewElement = document.querySelector('[data-document-preview="true"]') as HTMLElement | null;
    
    // Get sidebar and agent sidebar widths from document preview's data attributes
    const getDocPreviewSidebarWidth = () => {
      if (!documentPreviewElement) return sidebarWidth;
      return parseInt(documentPreviewElement.dataset.sidebarWidth || '0', 10) || sidebarWidth;
    };
    const getDocPreviewAgentSidebarWidth = () => {
      if (!documentPreviewElement) return 0;
      return parseInt(documentPreviewElement.dataset.agentSidebarWidth || '0', 10);
    };

    // ULTRA SMOOTH: Set up document preview for resize (disable transitions, enable GPU acceleration)
    if (documentPreviewElement) {
      documentPreviewElement.style.transition = 'none';
      documentPreviewElement.style.willChange = 'width';
    }

    const handleMouseMove = (e: MouseEvent) => {
      // Cancel any pending RAF
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }

      // Use requestAnimationFrame for smooth updates
      rafIdRef.current = requestAnimationFrame(() => {
        if (!panelElementRef.current || !resizeStateRef.current) return;

        const deltaX = e.clientX - resizeStateRef.current.startPos.x;
        
        // If we exited fullscreen and haven't started dragging yet, check if user has moved enough
        if (hasExitedFullscreenDuringResizeRef.current && !resizeStateRef.current.hasStartedDragging) {
          // Only start tracking drag after user moves mouse at least 5px
          // This prevents accidental movement when just touching the handle
          if (Math.abs(deltaX) < 5) {
            return; // Don't update width until user actually starts dragging
          }
          // User has started dragging - mark it and reset start position to current mouse position
          // startWidth is already set to cursor position in handleResizeStart, keep it
          resizeStateRef.current.hasStartedDragging = true;
          resizeStateRef.current.startPos.x = e.clientX;
          return; // This frame just marks dragging as started, next frame will update width
        }
        
        // Calculate new width based on delta
        // NOTE: Handle is on RIGHT edge - edge follows cursor exactly
        // Dragging right (positive delta) = wider, dragging left (negative delta) = narrower
        const newWidth = Math.min(Math.max(resizeStateRef.current.startWidth + deltaX, minWidth), maxWidth);
        
        // ULTRA SMOOTH: Direct DOM manipulation for chat panel
        // Document preview uses left/right positioning and will auto-resize via React props
        // Round width to prevent sub-pixel rendering gaps
        const roundedWidth = Math.round(newWidth);
        
        if (panelElementRef.current) {
          panelElementRef.current.style.width = `${roundedWidth}px`;
        }
        
        // Update document preview's left AND width directly for zero-lag sync
        // CORRECT LAYOUT: Sidebar (left) | Chat Panel (left) | Document Preview (RIGHT)
        // Document preview left = sidebarWidth + chatPanelWidth + gap
        if (documentPreviewElement && isDocPreviewOpen) {
          const docSidebarWidth = getDocPreviewSidebarWidth();
          const docAgentSidebarWidth = getDocPreviewAgentSidebarWidth();
          
          // Calculate the natural left position
          const naturalDocLeft = docSidebarWidth + roundedWidth + 11;
          
          // Calculate the maximum left position that still allows minimum doc preview width
          // maxLeft + minDocWidth + rightGap = viewport - agentSidebar
          const maxDocLeft = window.innerWidth - docAgentSidebarWidth - 12 - CHAT_PANEL_WIDTH.DOC_PREVIEW_MIN;
          
          // Cap left position to ensure document preview never gets pushed off screen
          const docLeft = Math.min(naturalDocLeft, maxDocLeft);
          
          // Calculate width based on capped left position
          const availableDocWidth = window.innerWidth - docLeft - docAgentSidebarWidth - 12;
          
          // Enforce minimum doc width (should always be satisfied now, but keep as safety)
          const finalWidth = Math.max(availableDocWidth, CHAT_PANEL_WIDTH.DOC_PREVIEW_MIN);
          
          documentPreviewElement.style.left = `${docLeft}px`;
          documentPreviewElement.style.width = `${Math.round(finalWidth)}px`;
        }
        
        // Update state (React will batch these updates)
        // Use rounded width for consistency with DOM manipulation
        setDraggedWidth(roundedWidth);
        if (onChatWidthChange) {
          onChatWidthChange(roundedWidth);
        }
      });
    };

    const handleMouseUp = () => {
      // Cancel any pending RAF
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      // Get the final chat panel width from the DOM to calculate matching document preview position
      if (documentPreviewElement && panelElementRef.current) {
        const finalChatWidth = panelElementRef.current.getBoundingClientRect().width;
        const docSidebarWidth = getDocPreviewSidebarWidth();
        const docAgentSidebarWidth = getDocPreviewAgentSidebarWidth();
        
        // Calculate natural final position
        const naturalDocLeft = docSidebarWidth + Math.round(finalChatWidth) + 12;
        
        // Cap left position to ensure document stays on screen with minimum width
        const maxDocLeft = window.innerWidth - docAgentSidebarWidth - 12 - CHAT_PANEL_WIDTH.DOC_PREVIEW_MIN;
        const finalDocLeft = Math.min(naturalDocLeft, maxDocLeft);
        
        // Calculate width based on capped left position
        const finalDocWidth = window.innerWidth - finalDocLeft - docAgentSidebarWidth - 12;
        const clampedWidth = Math.max(finalDocWidth, CHAT_PANEL_WIDTH.DOC_PREVIEW_MIN);
        
        // Set final values - DO NOT clear them
        // Keep inline styles until React state has fully propagated
        // They will be cleared when a new resize starts
        documentPreviewElement.style.left = `${finalDocLeft}px`;
        documentPreviewElement.style.width = `${Math.round(clampedWidth)}px`;
        documentPreviewElement.style.transition = '';
        documentPreviewElement.style.willChange = 'auto';
      }

      // Delay setting isResizing to false to allow chatPanelWidth state to propagate
      // This prevents React from overwriting DOM styles with stale values
      setTimeout(() => {
        setIsResizing(false);
      }, 50);
      
      resizeStateRef.current = null;
      panelElementRef.current = null;
      wasFullscreenOnResizeStartRef.current = false;
      hasExitedFullscreenDuringResizeRef.current = false;
      
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    // Use passive listeners for better performance
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseup', handleMouseUp, { passive: true });
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    return () => {
      // Cleanup
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      
      // ULTRA SMOOTH: Reset document preview styles on cleanup
      if (documentPreviewElement) {
        documentPreviewElement.style.transition = '';
        documentPreviewElement.style.willChange = 'auto';
      }
    };
  }, [isResizing, sidebarWidth, onChatWidthChange, legacyExpandedCardViewDoc]);
  
  // Get document preview from ChatStateStore using the proper hook
  // This hook subscribes to chatStates changes, ensuring re-render when document closes
  const chatStateDocumentPreview = useActiveChatDocumentPreview();
  
  // Use ChatStateStore document preview if available, fall back to legacy PreviewContext
  const expandedCardViewDoc = chatStateDocumentPreview || legacyExpandedCardViewDoc;

  // Keep ref in sync so handleUserCitationClick (passed to memoized StreamingResponseText) always sees current state
  React.useEffect(() => {
    isDocumentPreviewOpenRef.current = !!expandedCardViewDoc;
  }, [expandedCardViewDoc]);

  // Whether chat panel is in "large" width (>= 600px) for View area minimise/expand
  const isChatLarge = React.useMemo(() => {
    const isDocumentPreviewOpen = isPropertyDetailsOpen || !!expandedCardViewDoc;
    const { widthPx } = calculateChatPanelWidth({
      draggedWidth,
      isExpanded,
      isFullscreenMode,
      isDocumentPreviewOpen,
      isPropertyDetailsOpen,
      sidebarWidth,
      chatPanelWidth,
      isChatPanelOpen,
      isManualFullscreen: isManualFullscreenRef.current,
    });
    return widthPx >= 600;
  }, [draggedWidth, isExpanded, isFullscreenMode, isPropertyDetailsOpen, expandedCardViewDoc, sidebarWidth, chatPanelWidth, isChatPanelOpen]);

  // Standalone Minimise shows for 10s after Expand; standalone Expand shows for 10s after Minimise
  const [hasUserExpandedFromView, setHasUserExpandedFromView] = React.useState(false);
  const [hasUserMinimisedFromView, setHasUserMinimisedFromView] = React.useState(false);
  const minimiseExpandTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const MINIMISE_EXPAND_BUTTON_VISIBLE_MS = 10_000;

  React.useEffect(() => {
    return () => {
      if (minimiseExpandTimeoutRef.current) clearTimeout(minimiseExpandTimeoutRef.current);
    };
  }, []);

  const handleMinimiseChat = React.useCallback(() => {
    if (minimiseExpandTimeoutRef.current) {
      clearTimeout(minimiseExpandTimeoutRef.current);
      minimiseExpandTimeoutRef.current = null;
    }
    setHasUserExpandedFromView(false);
    setHasUserMinimisedFromView(true); // Show standalone Expand for 10s
    if (isFullscreenMode) {
      setIsFullscreenMode(false);
      isFullscreenFromDashboardRef.current = false;
      isManualFullscreenRef.current = false;
    }
    setDraggedWidth(CHAT_PANEL_WIDTH.COLLAPSED);
    setIsExpanded(false);
    lockedWidthRef.current = null;
    if (onChatWidthChange) onChatWidthChange(CHAT_PANEL_WIDTH.COLLAPSED);
    minimiseExpandTimeoutRef.current = setTimeout(() => {
      minimiseExpandTimeoutRef.current = null;
      setHasUserMinimisedFromView(false); // Hide standalone Expand after 10s
    }, MINIMISE_EXPAND_BUTTON_VISIBLE_MS);
  }, [isFullscreenMode, onChatWidthChange]);

  const handleExpandChat = React.useCallback(() => {
    if (minimiseExpandTimeoutRef.current) {
      clearTimeout(minimiseExpandTimeoutRef.current);
      minimiseExpandTimeoutRef.current = null;
    }
    setHasUserMinimisedFromView(false);
    setHasUserExpandedFromView(true); // Show standalone Minimise for 10s
    setIsExpanded(true);
    setIsFullscreenMode(true);
    isFullscreenFromDashboardRef.current = true;
    isManualFullscreenRef.current = true;
    setJustEnteredFullscreen(true);
    setDraggedWidth(null);
    lockedWidthRef.current = null;
    const chatPanelOffset = isChatPanelOpen ? chatPanelWidth : 0;
    const newWidth = window.innerWidth - sidebarWidth - chatPanelOffset;
    if (onChatWidthChange) onChatWidthChange(newWidth);
    setTimeout(() => setJustEnteredFullscreen(false), 100);
    minimiseExpandTimeoutRef.current = setTimeout(() => {
      minimiseExpandTimeoutRef.current = null;
      setHasUserExpandedFromView(false); // Hide standalone Minimise after 10s
    }, MINIMISE_EXPAND_BUTTON_VISIBLE_MS);
  }, [isChatPanelOpen, chatPanelWidth, sidebarWidth, onChatWidthChange]);

  // Calculate and notify parent of chat panel width changes
  // Uses unified calculateChatPanelWidth for consistent width calculation
  React.useEffect(() => {
    if (onChatWidthChange && isVisible) {
      const isDocumentPreviewOpen = !!expandedCardViewDoc;
      
      const { widthPx } = calculateChatPanelWidth({
        draggedWidth,
        isExpanded,
        isFullscreenMode,
        isDocumentPreviewOpen,
        isPropertyDetailsOpen,
        sidebarWidth,
        chatPanelWidth,
        isChatPanelOpen,
        isManualFullscreen: isManualFullscreenRef.current,
      });
      
      onChatWidthChange(widthPx);
    } else if (onChatWidthChange && !isVisible) {
      // Chat is hidden, notify parent that width is 0
      onChatWidthChange(0);
    }
  }, [isExpanded, isVisible, isPropertyDetailsOpen, draggedWidth, onChatWidthChange, isFullscreenMode, sidebarWidth, isChatPanelOpen, chatPanelWidth, expandedCardViewDoc]);

  // When document preview opens (e.g. from "Analyse with AI"), force chat to move aside: exit fullscreen
  // so the 50/50 split is used. Without this, chat can stay full width if it entered fullscreen before
  // the document was set (same tick / effect order).
  const prevExpandedCardViewDocRef = React.useRef<typeof expandedCardViewDoc>(null);
  React.useEffect(() => {
    const docJustOpened = expandedCardViewDoc && !prevExpandedCardViewDocRef.current;
    prevExpandedCardViewDocRef.current = expandedCardViewDoc;
    if (docJustOpened && isFullscreenMode && isFullscreenFromDashboardRef.current && !isManualFullscreenRef.current) {
      setIsFullscreenMode(false);
      isFullscreenFromDashboardRef.current = false;
      setDraggedWidth(null);
    }
  }, [expandedCardViewDoc, isFullscreenMode]);

  // Don't reset dragged width when collapsing - allow custom width to persist
  // User can resize in both expanded and collapsed states
  const hasInitializedAttachmentsRef = React.useRef(false);
  const attachedFilesRef = React.useRef<FileAttachmentData[]>([]);
  const abortControllerRef = React.useRef<AbortController | null>(null); // For cancelling streaming queries
  const [attachedFiles, setAttachedFiles] = React.useState<FileAttachmentData[]>(() => {
    const initial = initialAttachedFiles || [];
    if (initialAttachedFiles !== undefined && initialAttachedFiles.length > 0) {
      hasInitializedAttachmentsRef.current = true;
    }
    attachedFilesRef.current = initial;
    return initial;
  });
  
  // Update attachedFilesRef whenever attachedFiles state changes
  React.useEffect(() => {
    attachedFilesRef.current = attachedFiles;
  }, [attachedFiles]);

  // Function to stop streaming query
  const handleStopQuery = React.useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      
      // Clear resume processing ref when query is stopped
      resumeProcessingRef.current = null;
      
      // Mark the current loading message as stopped (preserve reasoning steps)
      setChatMessages(prev => {
        const updated = prev.map(msg => 
          msg.isLoading 
            ? { ...msg, isLoading: false, reasoningSteps: msg.reasoningSteps || [] }
            : msg
        );
        persistedChatMessagesRef.current = updated;
        return updated;
      });
    }
  }, []);

  // Function to handle pause/resume toggle
  const handlePauseToggle = React.useCallback(() => {
    const newPausedState = !isBotPaused;
    setIsBotPaused(newPausedState);
    isBotPausedRef.current = newPausedState;
    
    if (!newPausedState) {
      // Resuming - trigger processing of any buffered tokens
      if (resumeProcessingRef.current) {
        resumeProcessingRef.current();
      }
    }
  }, [isBotPaused]);
  
  // Expose methods via ref for parent components
  React.useImperativeHandle(ref, () => ({
    getAttachments: () => {
      return attachedFilesRef.current;
    },
    handleResizeStart,
    isResizing
  }), [handleResizeStart, isResizing]);
  
  // Restore attachments when initialAttachedFiles prop changes
  const prevInitialAttachedFilesRef = React.useRef<FileAttachmentData[] | undefined>(initialAttachedFiles);
  React.useLayoutEffect(() => {
    const prevInitial = prevInitialAttachedFilesRef.current;
    prevInitialAttachedFilesRef.current = initialAttachedFiles;
    
    if (initialAttachedFiles !== undefined) {
      const currentIds = attachedFiles.map(f => f.id).sort().join(',');
      const newIds = initialAttachedFiles.map(f => f.id).sort().join(',');
      const isDifferent = currentIds !== newIds || attachedFiles.length !== initialAttachedFiles.length;
      const propChanged = prevInitial !== initialAttachedFiles;
      
      const shouldRestore = !hasInitializedAttachmentsRef.current || 
                           isDifferent || 
                           (attachedFiles.length === 0 && initialAttachedFiles.length > 0) ||
                           (propChanged && initialAttachedFiles.length > 0);
      
      if (shouldRestore) {
        setAttachedFiles(initialAttachedFiles);
        attachedFilesRef.current = initialAttachedFiles;
        hasInitializedAttachmentsRef.current = true;
      }
    }
  }, [initialAttachedFiles, attachedFiles]);
  const [isDraggingFile, setIsDraggingFile] = React.useState(false);
  const [isOverBin, setIsOverBin] = React.useState(false);
  const [draggedFileId, setDraggedFileId] = React.useState<string | null>(null);
  
  // Use document selection context
  const {
    selectedDocumentIds,
    isDocumentSelectionMode,
    toggleDocumentSelection,
    toggleDocumentSelectionMode,
    clearSelectedDocuments,
    setDocumentSelectionMode
  } = useDocumentSelection();
  // Ref so async query callback sees latest selection (avoids stale closure when documentIds is undefined)
  const selectedDocumentIdsRef = React.useRef(selectedDocumentIds);
  selectedDocumentIdsRef.current = selectedDocumentIds;
  
  // Filing sidebar integration
  const { toggleSidebar: toggleFilingSidebar, isOpen: isFilingSidebarOpen, isResizing: isFilingSidebarResizing, width: filingSidebarWidth } = useFilingSidebar();
  // Note: useChatPanel hook is declared earlier in the component for use in width calculations
  
  // Agent mode (reader vs agent vs plan)
  const { mode: agentMode, isAgentMode, isPlanMode } = useMode();
  
  // Model selection (gpt-4o-mini, gpt-4o, claude-sonnet, claude-opus)
  const { model: selectedModel } = useModel();
  
  // Plan mode state - for Cursor-style plan viewer
  const [planContent, setPlanContent] = React.useState<string>('');
  const [planId, setPlanId] = React.useState<string | null>(null);
  const [planBuildStatus, setPlanBuildStatus] = React.useState<PlanBuildStatus>('ready');
  const [planQueryText, setPlanQueryText] = React.useState<string>('');
  const [showPlanViewer, setShowPlanViewer] = React.useState<boolean>(false);
  const isPlanModeRef = React.useRef(isPlanMode);
  
  // Plan generation reasoning steps (shown before/during plan generation)
  const [planGenerationReasoningSteps, setPlanGenerationReasoningSteps] = React.useState<PlanReasoningStep[]>([]);
  
  // Expanded plan panel state - for View Plan button
  const [isPlanPanelExpanded, setIsPlanPanelExpanded] = React.useState<boolean>(false);
  const [previousPlanContent, setPreviousPlanContent] = React.useState<string>('');
  const [isUpdatingPlan, setIsUpdatingPlan] = React.useState<boolean>(false);
  const [adjustmentQuery, setAdjustmentQuery] = React.useState<string>('');
  const [visibleAdjustmentCount, setVisibleAdjustmentCount] = React.useState<number>(0);
  const [isAdjustmentsExpanded, setIsAdjustmentsExpanded] = React.useState<boolean>(false);
  
  // Incremental diff state for real-time adjustment detection during streaming
  const [incrementalAdjustments, setIncrementalAdjustments] = React.useState<AdjustmentBlockData[]>([]);
  const lastDiffCheckRef = React.useRef<{ content: string; timestamp: number; chunkCount: number }>({
    content: '',
    timestamp: Date.now(),
    chunkCount: 0
  });
  const seenAdjustmentIdsRef = React.useRef<Set<string>>(new Set());
  
  // Ref to track current agent mode (avoids closure issues in streaming callbacks)
  const isAgentModeRef = React.useRef(isAgentMode);
  
  // Ref to track current model selection (avoids closure issues in streaming callbacks)
  const selectedModelRef = React.useRef(selectedModel);
  React.useEffect(() => {
    isAgentModeRef.current = isAgentMode;
    isPlanModeRef.current = isPlanMode;
    selectedModelRef.current = selectedModel;
    // Hide bot overlay when switching from agent mode to reader mode
    if (!isAgentMode) {
      setIsBotActive(false);
    }
    // NOTE: Plan state is intentionally NOT cleared when switching modes
    // The plan should remain visible so users can reference it while in other modes
  }, [isAgentMode, isPlanMode, selectedModel]);
  
  // Ref to track current fullscreen mode (avoids closure issues in streaming callbacks)
  const isFullscreenModeRef = React.useRef(isFullscreenMode);
  React.useEffect(() => {
    isFullscreenModeRef.current = isFullscreenMode;
  }, [isFullscreenMode]);
  
  
  // Store queries with their attachments
  interface SubmittedQuery {
    text: string;
    attachments: FileAttachmentData[];
  }
  
  // Store messages (both queries and responses)
  interface ReasoningStep {
    step: string;
    action_type: 'planning' | 'exploring' | 'searching' | 'reading' | 'analysing' | 'summarising' | 'thinking' | 'complete' | 'context' | 'executing' | 'opening' | 'navigating' | 'highlighting' | 'opening_map' | 'selecting_pin';
    message: string;
    count?: number;
    target?: string;
    line_range?: string;
    details: any;
    timestamp: number;
    fromCitationClick?: boolean; // Flag to indicate step was added from citation click (show in all modes)
  }

  interface CitationData {
    doc_id: string;
    page: number;  // Primary field for page number
    bbox: {
      left: number;
      top: number;
      width: number;
      height: number;
      page?: number;  // Optional page in bbox (for compatibility)
    };
    block_id?: string; // Block ID for focused citation retrieval
    // Legacy fields (optional for backward compatibility)
    original_filename?: string | null;
    property_address?: string;
    page_range?: string;
    classification_type?: string;
    chunk_index?: number;
    page_number?: number;  // Deprecated, use 'page' instead
    source_chunks_metadata?: CitationChunkData[];
    candidate_chunks_metadata?: CitationChunkData[];
    matched_chunk_metadata?: CitationChunkData;
    chunk_metadata?: CitationChunkData;
    match_reason?: string;
  }

  interface ChatMessage {
    id: string;
    type: 'query' | 'response';
    text: string;
    attachments?: FileAttachmentData[];
    propertyAttachments?: PropertyAttachmentData[];
    selectedDocumentIds?: string[]; // Document IDs selected when query was sent
    selectedDocumentNames?: string[]; // Document names for display
    isLoading?: boolean;
    reasoningSteps?: ReasoningStep[]; // Reasoning steps for this message
    citations?: Record<string, CitationData>; // NEW: Citations with bbox metadata
    fromCitation?: boolean; // NEW: Flag to indicate if query came from citation action
    citationBboxData?: {
      document_id: string;
      page_number: number;
      bbox: { left: number; top: number; width: number; height: number };
      original_filename?: string;
      block_id?: string;
    };
    /** Ordered segments for query display (chips + text in input order) */
    contentSegments?: QueryContentSegment[];
  }
  
  const [submittedQueries, setSubmittedQueries] = React.useState<SubmittedQuery[]>([]);
  const [chatMessages, setChatMessages] = React.useState<ChatMessage[]>([]);
  // True when we're on the empty "new chat" view (no messages yet) - hide Files, New chat, reasoning toggle in header (Agents button always shown in top right)
  const isNewChatSection = chatMessages.length === 0;
  // CRITICAL: Ref to track current chatMessages for streaming callbacks (avoids stale closure issues)
  const chatMessagesRef = React.useRef<ChatMessage[]>([]);
  // Keep ref in sync with state
  React.useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);
  // Preload citation previews when messages have citations (so pop-up loads fast on first click)
  React.useEffect(() => {
    const messages = chatMessages || [];
    for (const msg of messages) {
      if (!msg.citations || typeof msg.citations !== 'object') continue;
      for (const cit of Object.values(msg.citations) as any[]) {
        const cDocId = cit?.doc_id ?? cit?.document_id;
        const pageNum = cit?.page ?? cit?.page_number ?? cit?.bbox?.page;
        if (cDocId && pageNum) {
          preloadHoverPreview(cDocId, pageNum).catch(() => {});
        }
      }
    }
  }, [chatMessages]);
  // Persistent sessionId for conversation continuity (reused across all messages in this chat session)
  const [sessionId] = React.useState<string>(() => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  
  // Chat title state management
  const [currentChatId, setCurrentChatId] = React.useState<string | null>(null);
  const [chatTitle, setChatTitle] = React.useState<string>('');
  const [isEditingTitle, setIsEditingTitle] = React.useState<boolean>(false);
  const [editingTitleValue, setEditingTitleValue] = React.useState<string>('');
  const [isTitleStreaming, setIsTitleStreaming] = React.useState<boolean>(false);
  const [streamedTitle, setStreamedTitle] = React.useState<string>('');
  const titleStreamIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
  
  // File choice flow state - tracks pending file choice when attachments have extracted text
  const pendingFileChoiceRef = React.useRef<{
    queryText: string;
    loadingResponseId: string;
    attachmentsToUse: FileAttachmentData[];
    propertyAttachments: PropertyAttachmentData[];
    selectedDocIds: string[];
    selectedDocNames: string[];
    citationContext: any;
    resolve: (choice: ResponseModeChoice) => void;
  } | null>(null);
  
  // Helper: Check if attachments have extracted text and need file choice
  const hasExtractedAttachments = React.useCallback((files: FileAttachmentData[]) => {
    return files.some(f => f.extractedText && f.extractedText.length > 0);
  }, []);
  
  // Helper: Build attachment context for backend from extracted files
  const buildAttachmentContext = React.useCallback((files: FileAttachmentData[]) => {
    const filesWithText = files.filter(f => f.extractedText && f.extractedText.length > 0);
    if (filesWithText.length === 0) return null;
    
    return {
      texts: filesWithText.map(f => f.extractedText || ''),
      pageTexts: filesWithText.map(f => f.pageTexts || []),
      filenames: filesWithText.map(f => f.name),
      tempFileIds: filesWithText.map(f => f.tempFileId || '')
    };
  }, []);
  
  // Helper: Handle file choice callback - resolves the pending promise
  const handleFileChoiceSelection = React.useCallback((choice: ResponseModeChoice) => {
    console.log('📁 File choice selected:', choice);
    if (pendingFileChoiceRef.current?.resolve) {
      pendingFileChoiceRef.current.resolve(choice);
    }
  }, []);
  
  // Helper: Show file choice step and wait for selection
  const showFileChoiceAndWait = React.useCallback((
    loadingResponseId: string,
    attachmentsToUse: FileAttachmentData[]
  ): Promise<ResponseModeChoice> => {
    return new Promise((resolve) => {
      // Store the resolve function for later
      const existing = pendingFileChoiceRef.current;
      pendingFileChoiceRef.current = {
        queryText: existing?.queryText || '',
        loadingResponseId,
        attachmentsToUse,
        propertyAttachments: existing?.propertyAttachments || [],
        selectedDocIds: existing?.selectedDocIds || [],
        selectedDocNames: existing?.selectedDocNames || [],
        citationContext: existing?.citationContext || null,
        resolve
      };
      
      // Add file_choice reasoning step to the loading message
      // Using double assertion due to TypeScript cache - 'file_choice' is valid in ReasoningStep interface
      const fileChoiceStep = {
        step: 'file_choice',
        action_type: 'file_choice',
        message: 'How would you like me to respond?',
        details: {
          attachedFiles: attachmentsToUse,
          onFileChoice: handleFileChoiceSelection
        },
        timestamp: Date.now()
      } as unknown as ReasoningStep;
      
      setChatMessages(prev => prev.map(msg => 
        msg.id === loadingResponseId 
          ? { ...msg, reasoningSteps: [fileChoiceStep] }
          : msg
      ));
    });
  }, [handleFileChoiceSelection]);
  
  // Persist chat messages across panel open/close
  const persistedChatMessagesRef = React.useRef<ChatMessage[]>([]);
  
  // ========== LEGACY BUFFERING SYSTEM ==========
  // NOTE: This buffering system is being replaced by ChatStateStore.
  // ChatStateStore provides true per-chat isolation without complex buffering.
  // Document previews are now stored per-chat in ChatStateStore.
  // This legacy code remains for streaming callback compatibility and will be
  // removed once streaming callbacks are fully migrated to ChatStateStore.
  // ================================================
  interface BufferedChatState {
    messages: ChatMessage[];           // Latest message state
    accumulatedText: string;           // Streaming text buffer
    reasoningSteps: ReasoningStep[];    // Reasoning steps
    citations: Record<string, CitationData>; // Citations
    status: 'loading' | 'completed';    // Current status
    lastUpdate: number;                 // Timestamp of last update
    isLoading: boolean;                 // Whether response is still streaming
    // Query lifecycle state (for exact restoration)
    documentPreview?: {                 // LEGACY: Now handled by ChatStateStore
      docId: string;
      filename: string;
      highlight?: {
        fileId: string;
        bbox: any;                      // Contains { left, top, width, height, page }
        doc_id: string;
        block_id?: string;
        block_content?: string;
        original_filename: string;
      };
    };
    activeAgentAction?: {               // Agent action in progress (if any)
      action: string;                   // e.g., 'open_document', 'navigate_to_property'
      params: any;
      timestamp: number;
    };
    lastReasoningStep?: ReasoningStep;  // Last reasoning step (to show current activity)
    documentPreviewCaptured?: boolean;  // Whether document preview state was explicitly captured (to distinguish "no doc open" from "never saved")
  }
  
  // LEGACY: Track which chat is currently active (being viewed)
  // Now handled by ChatStateStore.activeChatId
  const activeChatIdRef = React.useRef<string | null>(null);
  
  // LEGACY: Track which chat owns the current document preview
  // No longer needed - ChatStateStore provides per-chat document preview isolation
  const documentPreviewOwnerRef = React.useRef<string | null>(null);
  
  // Buffer updates for inactive chats
  const bufferedChatUpdatesRef = React.useRef<Record<string, BufferedChatState>>({});
  
  // Helper: Check if a specific chat is currently active (being viewed)
  // CRITICAL: Use activeChatIdRef as primary source of truth for multiple concurrent chats
  // This ensures correct routing of streaming updates when multiple chats are running
  const isChatActive = React.useCallback((chatId: string | null, visible: boolean): boolean => {
    if (!visible || !chatId) return false;
    // Primary: Check activeChatIdRef (most reliable for concurrent chats)
    if (chatId === activeChatIdRef.current) return true;
    // Secondary: Check currentChatId (for normal query scenario)
    if (chatId === currentChatId) return true;
    return false;
  }, [currentChatId]);
  
  // Unified helper: Check if a query's chat is currently active
  // This provides consistent chatIsActive logic across all streaming callbacks
  // Use this for all streaming callback checks to prevent leakage between chats
  // 
  // CRITICAL FIX: The primary check is activeChatIdRef.current which is set synchronously
  // when a query starts and cleared when switching chats. This prevents callbacks from
  // old chats from updating the UI after the user has switched to a new chat.
  const isChatActiveForQuery = React.useCallback((
    queryChatId: string | null,
    savedChatId: string | null
  ): boolean => {
    if (!queryChatId) return false;
    
    // CRITICAL: activeChatIdRef is the ONLY source of truth for the active chat
    // This is set synchronously when:
    // 1. A query starts (set to queryChatId)
    // 2. A new agent is requested (set to null)
    // 3. A chat is restored (set to restoreChatId)
    // 
    // If the callback's queryChatId doesn't match activeChatIdRef, the chat is inactive
    // and updates should be buffered, NOT displayed in the UI
    if (queryChatId === activeChatIdRef.current) return true;
    
    // REMOVED: The following checks caused leakage between chats:
    // - savedChatId && queryChatId === savedChatId - ALWAYS true for originating chat!
    // - isVisible && queryChatId === currentChatIdRef.current - stale after new agent
    // - restoreChatId === queryChatId - handled by activeChatIdRef already
    
    return false;
  }, []);
  
  // Helper: Update active chat when chat becomes visible or switches
  const updateActiveChat = React.useCallback((chatId: string | null, visible: boolean) => {
    if (visible && chatId) {
      activeChatIdRef.current = chatId;
    } else if (!visible) {
      activeChatIdRef.current = null;
    }
  }, []);
  
  // Helper: Get or create buffered state for a chat
  const getBufferedState = React.useCallback((chatId: string): BufferedChatState => {
    if (!bufferedChatUpdatesRef.current[chatId]) {
      bufferedChatUpdatesRef.current[chatId] = {
        messages: [],
        accumulatedText: '',
        reasoningSteps: [],
        citations: {},
        status: 'loading',
        lastUpdate: Date.now(),
        isLoading: true
      };
    }
    return bufferedChatUpdatesRef.current[chatId];
  }, []);
  
  // CRITICAL: Restore document preview when chat becomes visible and has buffered document preview
  // This handles the case where user left a chat with document preview open and returns to it
  // NOTE: Uses legacy functions because wrapped versions are defined later in code
  // NOTE: Document preview restoration is now handled by ChatStateStore
  // MainContent reads from useActiveChatDocumentPreview() which returns the active chat's preview
  // No manual restoration needed - switching activeChatId automatically shows the correct preview
  
  // Reset first citation flag when chat messages are cleared (new chat session)
  React.useEffect(() => {
    if (chatMessages.length === 0) {
      isFirstCitationRef.current = true;
      console.log('🔄 [CITATION] Chat messages cleared - resetting first citation flag');
    }
  }, [chatMessages.length]);
  
  // Report active chat state to parent (for sidebar "Active Chat" button)
  // Chat is "active" when there's a loading message (query in progress)
  React.useEffect(() => {
    const hasLoadingMessage = chatMessages.some(msg => msg.isLoading);
    onActiveChatChange?.(hasLoadingMessage);
  }, [chatMessages, onActiveChatChange]);
  
  // Track previous message count for first chat glow detection
  const prevGlowMessageCountRef = React.useRef(0);
  
  // Trigger gold glow animation only when creating the FIRST chat (messages go from 0 to having content)
  React.useEffect(() => {
    const messageCount = chatMessages.length;
    
    // Trigger glow only when this is the first chat (was 0 messages, now has messages)
    if (prevGlowMessageCountRef.current === 0 && messageCount > 0) {
      triggerGlow();
    }
    
    prevGlowMessageCountRef.current = messageCount;
  }, [chatMessages.length, triggerGlow]);
  
  // Track message IDs that existed when panel was last opened (for animation control)
  const restoredMessageIdsRef = React.useRef<Set<string>>(new Set());
  const MAX_FILES = 4;

  // Sync messages to bubble in real-time
  React.useEffect(() => {
    if (onMessagesUpdate && chatMessages.length > 0) {
      onMessagesUpdate(chatMessages);
    }
  }, [chatMessages, onMessagesUpdate]);
  
  // Track which query is currently processing (for reasoning steps)
  const currentQueryIdRef = React.useRef<string | null>(null);
  
  // Use property selection context
  const { 
    isSelectionModeActive, 
    toggleSelectionMode, 
    setSelectionModeActive,
    propertyAttachments, 
    removePropertyAttachment,
    clearPropertyAttachments,
    addPropertyAttachment
  } = usePropertySelection();

  const initialSegments = React.useMemo(
    () =>
      buildInitialSegments(
        '',
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

  React.useEffect(() => {
    setInputValue(segmentInput.getPlainText());
  }, [segmentInput.segments]);

  React.useEffect(() => {
    const plain = segmentInput.getPlainText();
    const cursorOffset = segmentInput.getCursorOffset();
    const lastAt = plain.slice(0, cursorOffset).lastIndexOf('@');
    const queryAfterAt = lastAt >= 0 ? plain.slice(lastAt + 1, cursorOffset) : '';
    // Close popover when user types a space after "@" (e.g. "what is the value of @ ")
    if (lastAt >= 0 && !queryAfterAt.includes(' ')) {
      setAtMentionOpen(true);
      setAtQuery(queryAfterAt);
      setAtAnchorIndex(lastAt);
      setAtSelectedIndex(0);
    } else {
      setAtMentionOpen(false);
      setAtQuery('');
      setAtAnchorIndex(-1);
    }
  }, [segmentInput.segments, segmentInput.cursor]);

  // Position @ popover at the "@" character (recompute when open/cursor/segments change).
  // Defer rect read to next frame so SegmentInput's segment refs are set and layout is complete.
  React.useLayoutEffect(() => {
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
        // Retry once on next frame in case segment refs weren't ready
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

  // Handle property selection
  const handlePropertySelect = React.useCallback((property: PropertyData) => {
    addPropertyAttachment(property);
    setShowPropertySearchPopup(false);
    setPropertySearchResults([]);
    setPropertySearchQuery("");
    const newInput = segmentInput.getPlainText().replace(/@property\s+/i, '').trim();
    setInputValue(newInput);
    segmentInput.setSegments(
      buildInitialSegments(newInput, propertyAttachments.map((a) => ({ id: a.id, label: a.address, payload: a.property })), atMentionDocumentChips)
    );
  }, [addPropertyAttachment, segmentInput, propertyAttachments, atMentionDocumentChips]);
  
  // Use chat history context
  const { addChatToHistory, getChatById, updateChatTitle, updateChatStatus, updateChatDescription, updateChatInHistory, chatHistory, saveChatState } = useChatHistory();
  
  // Update chat status to 'completed' when all messages finish loading
  React.useEffect(() => {
    const hasLoadingMessage = chatMessages.some(msg => msg.isLoading);
    const currentChat = currentChatId ? getChatById(currentChatId) : null;
    
    // If there are no loading messages and the chat status is still 'loading', update it to 'completed'
    if (!hasLoadingMessage && currentChat && currentChat.status === 'loading' && currentChatId) {
      console.log('✅ SideChatPanel: Auto-updating chat status to completed (no loading messages):', currentChatId);
      updateChatStatus(currentChatId, 'completed');
    }
  }, [chatMessages, currentChatId, getChatById, updateChatStatus]);
  
  // Track when new agent was requested to prevent restore interference
  const newAgentRequestedRef = React.useRef<boolean>(false);
  
  // Track when we're restoring a chat to prevent query processing during restore
  const isRestoringChatRef = React.useRef<boolean>(false);
  
  // Track last restored chat to prevent duplicate restorations
  const lastRestoredChatIdRef = React.useRef<string | null>(null);
  
  // Track currentChatId in a ref to avoid stale closures in effects
  const currentChatIdRef = React.useRef<string | null>(currentChatId);
  React.useEffect(() => {
    currentChatIdRef.current = currentChatId;
    // Also update the doc ref for document operations
    currentChatIdForDocRef.current = currentChatId;
  }, [currentChatId]);
  
  // ========== CHAT STATE STORE INTEGRATION ==========
  // Wrapper: Open document with per-chat isolation (writes to ChatStateStore)
  // Also calls legacy openExpandedCardView during migration for backward compatibility
  const openExpandedCardView = React.useCallback((
    docId: string, 
    filename: string, 
    highlight?: CitationHighlight, 
    isAgentTriggered?: boolean
  ) => {
    const chatId = currentChatIdRef.current;
    if (chatId) {
      // Write to ChatStateStore (per-chat isolation)
      openDocumentForChat(chatId, { docId, filename, highlight });
    }
    // Also call legacy for backward compatibility during migration
    legacyOpenExpandedCardView(docId, filename, highlight, isAgentTriggered);
  }, [openDocumentForChat, legacyOpenExpandedCardView]);
  
  // Wrapper: Close document with per-chat isolation
  const closeExpandedCardView = React.useCallback(() => {
    const chatId = currentChatIdRef.current;
    if (chatId) {
      closeDocumentForChat(chatId);
    }
    legacyCloseExpandedCardView();
  }, [closeDocumentForChat, legacyCloseExpandedCardView]);
  
  // CRITICAL: Sync currentChatId to ChatStateStore's activeChatId
  // This ensures the store knows which chat is currently active
  React.useEffect(() => {
    const chatId = currentChatId || null;
    if (chatId !== storeActiveChatId) {
      setStoreActiveChatId(chatId);
    }
  }, [currentChatId, storeActiveChatId, setStoreActiveChatId]);
  
  // Initialize chat state in ChatStateStore when currentChatId changes
  React.useEffect(() => {
    if (currentChatId) {
      initializeChatState(currentChatId);
    }
  }, [currentChatId, initializeChatState]);
  // ========== END CHAT STATE STORE INTEGRATION ==========

  // New chat handler (used by View dropdown)
  const handleNewChatClick = React.useCallback(() => {
    if (chatMessages.length > 0) {
      const firstQuery = chatMessages.find(m => m.type === 'query');
      const preview = firstQuery?.text || 'New chat';
      const savedChatId = addChatToHistory({
        title: chatTitle || '',
        timestamp: new Date().toISOString(),
        preview,
        messages: chatMessages.map(m => ({
          role: m.type === 'query' ? 'user' : 'assistant',
          content: m.text || '',
          attachments: m.attachments || [],
          propertyAttachments: m.propertyAttachments || [],
          citations: m.citations || {}
        }))
      });
      if (currentChatId && savedChatId !== currentChatId && chatTitle) {
        updateChatTitle(savedChatId, chatTitle);
      }
    }
    const hasLoadingMessage = chatMessages.some(msg => msg.isLoading);
    const existingChat = currentChatId ? getChatById(currentChatId) : null;
    const hasRunningQueryInHistory = existingChat?.status === 'loading';
    const hasRunningQuery = hasLoadingMessage || hasRunningQueryInHistory;
    if (hasRunningQuery) {
      const currentMessages = chatMessagesRef.current;
      if (currentChatId && currentMessages.length > 0) {
        updateChatInHistory(currentChatId, currentMessages.map(msg => ({
          role: msg.type === 'query' ? 'user' : 'assistant',
          content: msg.text || '',
          attachments: msg.attachments || [],
          propertyAttachments: msg.propertyAttachments || [],
          citations: msg.citations || {}
        })));
        const bufferedState = getBufferedState(currentChatId);
        bufferedState.messages = [...currentMessages];
        bufferedState.status = currentMessages.some(msg => msg.isLoading) ? 'loading' : 'completed';
        bufferedState.isLoading = currentMessages.some(msg => msg.isLoading);
        const loadingMsg = currentMessages.find(msg => msg.isLoading);
        if (loadingMsg?.text) bufferedState.accumulatedText = loadingMsg.text;
        if (loadingMsg?.reasoningSteps?.length) {
          bufferedState.reasoningSteps = [...loadingMsg.reasoningSteps];
          const lastStep = loadingMsg.reasoningSteps[loadingMsg.reasoningSteps.length - 1];
          if (lastStep) bufferedState.lastReasoningStep = lastStep;
        }
        bufferedState.lastUpdate = Date.now();
        if (expandedCardViewDoc) {
          bufferedState.documentPreview = {
            docId: expandedCardViewDoc.docId,
            filename: expandedCardViewDoc.filename,
            highlight: expandedCardViewDoc.highlight ? {
              fileId: expandedCardViewDoc.highlight.fileId,
              bbox: expandedCardViewDoc.highlight.bbox,
              doc_id: expandedCardViewDoc.highlight.doc_id,
              block_id: expandedCardViewDoc.highlight.block_id || '',
              block_content: expandedCardViewDoc.highlight.block_content,
              original_filename: expandedCardViewDoc.highlight.original_filename
            } : undefined
          };
        }
      }
      clearInputAndChips();
      setAttachedFiles([]);
      attachedFilesRef.current = [];
      clearPropertyAttachments();
      setSelectionModeActive(false);
      setIsSubmitted(false);
      setIsFocused(false);
      setChatTitle('');
      setIsTitleStreaming(false);
      setStreamedTitle('');
      setIsEditingTitle(false);
      setEditingTitleValue('');
      persistedChatMessagesRef.current = [];
      restoredMessageIdsRef.current = new Set();
      isFirstCitationRef.current = true;
      setChatMessages([]);
      setSubmittedQueries([]);
      setCurrentChatId(null);
      currentChatIdRef.current = null;
      activeChatIdRef.current = null;
      if (expandedCardViewDoc) {
        closeExpandedCardView();
        documentPreviewOwnerRef.current = null;
      }
      if (onNewChat) onNewChat();
    } else {
      if (currentChatId) {
        const bufferedState = getBufferedState(currentChatId);
        const currentMessages = chatMessagesRef.current;
        if (currentMessages.length > 0) {
          bufferedState.messages = [...currentMessages];
          bufferedState.status = 'completed';
          bufferedState.isLoading = false;
          bufferedState.lastUpdate = Date.now();
        }
        if (expandedCardViewDoc) {
          bufferedState.documentPreview = {
            docId: expandedCardViewDoc.docId,
            filename: expandedCardViewDoc.filename,
            highlight: expandedCardViewDoc.highlight ? {
              fileId: expandedCardViewDoc.highlight.fileId,
              bbox: expandedCardViewDoc.highlight.bbox,
              doc_id: expandedCardViewDoc.highlight.doc_id,
              block_id: expandedCardViewDoc.highlight.block_id || '',
              block_content: expandedCardViewDoc.highlight.block_content,
              original_filename: expandedCardViewDoc.highlight.original_filename
            } : undefined
          };
        }
      }
      setChatMessages([]);
      setSubmittedQueries([]);
      persistedChatMessagesRef.current = [];
      restoredMessageIdsRef.current = new Set();
      clearInputAndChips();
      setAttachedFiles([]);
      clearPropertyAttachments();
      setSelectionModeActive(false);
      setIsSubmitted(false);
      setIsFocused(false);
      isFirstCitationRef.current = true;
      setCurrentChatId(null);
      currentChatIdRef.current = null;
      activeChatIdRef.current = null;
      setChatTitle('');
      setIsTitleStreaming(false);
      setStreamedTitle('');
      setIsEditingTitle(false);
      setEditingTitleValue('');
      if (expandedCardViewDoc) {
        closeExpandedCardView();
        documentPreviewOwnerRef.current = null;
      }
      if (onNewChat) onNewChat();
    }
  }, [chatMessages, currentChatId, chatTitle, addChatToHistory, updateChatTitle, getChatById, updateChatInHistory, getBufferedState, closeExpandedCardView, clearPropertyAttachments, onNewChat, expandedCardViewDoc]);

  // Track last processed newAgentTrigger to prevent infinite loops
  const lastProcessedTriggerRef = React.useRef<number>(0);
  
  // CRITICAL: When newAgentTrigger changes (increments), clear currentChatId to allow new chat creation
  // This happens when "New Agent" is clicked from ChatPanel
  React.useEffect(() => {
    // CRITICAL: Only process if trigger has actually changed and is greater than last processed
    // This prevents infinite loops when state updates trigger re-renders
    if (newAgentTrigger && newAgentTrigger > 0 && newAgentTrigger > lastProcessedTriggerRef.current) {
      console.log('🆕 SideChatPanel: New agent requested (trigger:', newAgentTrigger, ') - clearing state immediately');
      
      // Mark this trigger as processed immediately to prevent re-processing
      lastProcessedTriggerRef.current = newAgentTrigger;
      
      // CRITICAL: Before clearing state, capture current query lifecycle state
      // Use ref to get latest value without adding to dependency array
      const currentChatIdValue = currentChatIdRef.current;
      if (currentChatIdValue) {
        const bufferedState = getBufferedState(currentChatIdValue);
        
        // Capture document preview state if document is open
        const expandedDoc = expandedCardViewDoc;
        // FIX: Use chatMessagesRef.current to get the latest messages (avoid stale closure)
        const currentMessages = chatMessagesRef.current;
        
        // FIX: Save current messages to buffer BEFORE clearing state
        // This ensures streaming callbacks for this chat will have the messages to work with
        if (currentMessages.length > 0) {
          bufferedState.messages = [...currentMessages];
          bufferedState.status = currentMessages.some(msg => msg.isLoading) ? 'loading' : 'completed';
          bufferedState.isLoading = currentMessages.some(msg => msg.isLoading);
          
          // Save accumulated text from loading message
          const loadingMsg = currentMessages.find(msg => msg.isLoading);
          if (loadingMsg && loadingMsg.text) {
            bufferedState.accumulatedText = loadingMsg.text;
          }
          
          // Save citations
          currentMessages.forEach(msg => {
            if (msg.citations && Object.keys(msg.citations).length > 0) {
              bufferedState.citations = { ...bufferedState.citations, ...msg.citations };
            }
          });
          
          console.log('💾 SideChatPanel: Buffered messages before new agent:', {
            chatId: currentChatIdValue,
            messageCount: currentMessages.length,
            isLoading: bufferedState.isLoading
          });
        }
        
        if (expandedDoc) {
          bufferedState.documentPreview = {
            docId: expandedDoc.docId,
            filename: expandedDoc.filename,
            highlight: expandedDoc.highlight ? {
              fileId: expandedDoc.highlight.fileId,
              bbox: expandedDoc.highlight.bbox, // bbox already contains page
              doc_id: expandedDoc.highlight.doc_id,
              block_id: expandedDoc.highlight.block_id || '',
              block_content: expandedDoc.highlight.block_content,
              original_filename: expandedDoc.highlight.original_filename
            } : undefined
          };
          console.log('💾 SideChatPanel: Buffered document preview before new agent:', bufferedState.documentPreview);
        }
        
        // Capture last reasoning step from current messages
        const lastMessage = currentMessages[currentMessages.length - 1];
        if (lastMessage?.reasoningSteps && lastMessage.reasoningSteps.length > 0) {
          bufferedState.lastReasoningStep = lastMessage.reasoningSteps[lastMessage.reasoningSteps.length - 1];
        }
        
        bufferedState.lastUpdate = Date.now();
        
        // Mark chat as inactive
        activeChatIdRef.current = null;
        console.log('💾 SideChatPanel: Captured query lifecycle state before new agent - chat will buffer updates');
      }
      
      // Set flag to prevent restore from interfering
      newAgentRequestedRef.current = true;
      
      // CRITICAL: Clear currentChatId FIRST, synchronously
      setCurrentChatId(null);
      currentChatIdRef.current = null; // Also update ref synchronously to avoid stale closure issues
      
      // Clear all other state immediately
      setChatTitle('');
      setChatMessages([]);
      // FIX: Also clear chatMessagesRef synchronously to avoid stale values
      chatMessagesRef.current = [];
      setSubmittedQueries([]);
      
      const wasFocused = inputRef.current && document.activeElement === inputRef.current.getRootElement();
      clearInputAndChips();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (wasFocused && inputRef.current) {
            Promise.resolve().then(() => {
              inputRef.current?.focus();
              restoreSelectionRef.current?.();
            });
          }
        });
      });
      
      setAttachedFiles([]);
      attachedFilesRef.current = [];
      clearPropertyAttachments();
      setIsSubmitted(false);
      
      // Clear persisted messages ref
      persistedChatMessagesRef.current = [];
      restoredMessageIdsRef.current = new Set();
      
      // CRITICAL: Clear bot status overlay state for new chat
      setIsBotActive(false);
      setBotActivityMessage('Running...');
      setIsBotPaused(false);
      isBotPausedRef.current = false;
      
      // Close ONLY the legacy document preview (not ChatStateStore)
      // The previous chat's document preview is preserved in ChatStateStore
      // The new chat will have no document preview until one is opened
      // We only close legacy so the UI doesn't show the old document while new chat starts
      legacyCloseExpandedCardView();
      
      // Reset flag after a delay to prevent restoration from interfering
      // Note: This flag will be cleared early if user starts typing (in handleTextareaChange)
      // This is just a safety net in case user doesn't type immediately
      setTimeout(() => {
        newAgentRequestedRef.current = false;
      }, 500);
    }
  }, [newAgentTrigger, clearPropertyAttachments, getBufferedState]); // CRITICAL: Removed currentChatId, expandedCardViewDoc, chatMessages to prevent infinite loop
  
  // CRITICAL: When restoreChatId is cleared (set to null), clear currentChatId to allow new chat creation
  // This is a fallback for when restoreChatId changes from a value to null
  // Track previous restoreChatId to detect when it changes from a value to null
  const prevRestoreChatIdRef = React.useRef<string | null | undefined>(restoreChatId);
  React.useEffect(() => {
    const prevRestoreChatId = prevRestoreChatIdRef.current;
    
    // CRITICAL: Skip if new agent was just requested (handled by newAgentTrigger effect)
    if (newAgentRequestedRef.current) {
      prevRestoreChatIdRef.current = restoreChatId;
      return;
    }
    
    // Update ref AFTER checking conditions to prevent infinite loops
    prevRestoreChatIdRef.current = restoreChatId;
    
    // If restoreChatId was set but is now null (cleared), clear currentChatId to allow new chat
    // This indicates "New Agent" was clicked from ChatPanel
    // CRITICAL: Only run if we actually have a currentChatId to clear (prevents re-running after clearing)
    // Use ref to get latest value without adding to dependency array (prevents infinite loop)
    if (prevRestoreChatId && !restoreChatId && currentChatIdRef.current) {
      console.log('🆕 SideChatPanel: restoreChatId cleared (was:', prevRestoreChatId, ') - clearing currentChatId for new chat');
      setCurrentChatId(null);
      setChatTitle('');
      setChatMessages([]);
      setSubmittedQueries([]);
      
      const wasFocused = inputRef.current && document.activeElement === inputRef.current.getRootElement();
      clearInputAndChips();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (wasFocused && inputRef.current) {
            Promise.resolve().then(() => {
              inputRef.current?.focus();
              restoreSelectionRef.current?.();
            });
          }
        });
      });
      
      setAttachedFiles([]);
      attachedFilesRef.current = [];
      clearPropertyAttachments();
      setIsSubmitted(false);
      
      // CRITICAL: Clear bot status overlay state for new chat
      setIsBotActive(false);
      setBotActivityMessage('Running...');
      setIsBotPaused(false);
      isBotPausedRef.current = false;
    }
  }, [restoreChatId, clearPropertyAttachments]); // CRITICAL: Removed currentChatId from deps to prevent infinite loop
  
  // NOTE: Document preview restoration for restoreChatId is now handled by ChatStateStore
  // When activeChatId changes, MainContent automatically shows that chat's document preview
  
  // CRITICAL: Track active chat and handle visibility changes
  // Update activeChatIdRef when chat becomes visible/invisible or when currentChatId changes
  React.useEffect(() => {
    updateActiveChat(currentChatId, isVisible);
  }, [currentChatId, isVisible, updateActiveChat]);
  
  // CRITICAL: Save chat state when navigating away or when chat becomes invisible
  // This ensures granular state is preserved for restoration
  // Note: prevIsVisibleRef already exists above for fullscreen state, so we track chatId separately
  const prevCurrentChatIdForStateRef = React.useRef<string | null>(currentChatId);
  React.useEffect(() => {
    // Save state when:
    // 1. Chat becomes invisible (navigating away)
    // 2. currentChatId changes (switching chats)
    const wasVisible = prevIsVisibleRef.current;
    const prevChatId = prevCurrentChatIdForStateRef.current;
    
    // Update refs
    prevIsVisibleRef.current = isVisible;
    prevCurrentChatIdForStateRef.current = currentChatId;
    
    // When chat becomes invisible or switches, capture document preview state
    if (prevChatId && (wasVisible && !isVisible || (prevChatId !== currentChatId))) {
      const bufferedState = getBufferedState(prevChatId);
      
      // Capture document preview state if document is open
      if (expandedCardViewDoc) {
        bufferedState.documentPreview = {
          docId: expandedCardViewDoc.docId,
          filename: expandedCardViewDoc.filename,
          highlight: expandedCardViewDoc.highlight ? {
            fileId: expandedCardViewDoc.highlight.fileId,
            bbox: expandedCardViewDoc.highlight.bbox, // bbox already contains page
            doc_id: expandedCardViewDoc.highlight.doc_id,
            block_id: expandedCardViewDoc.highlight.block_id || '',
            block_content: expandedCardViewDoc.highlight.block_content,
            original_filename: expandedCardViewDoc.highlight.original_filename
          } : undefined
        };
        console.log('💾 SideChatPanel: Buffered document preview - chat became inactive:', bufferedState.documentPreview);
      }
      
      // Capture last reasoning step
      const lastMessage = chatMessages[chatMessages.length - 1];
      if (lastMessage?.reasoningSteps && lastMessage.reasoningSteps.length > 0) {
        bufferedState.lastReasoningStep = lastMessage.reasoningSteps[lastMessage.reasoningSteps.length - 1];
      }
    }
    
    // Save state if chat was visible and now invisible, or if chatId changed
    if (wasVisible && !isVisible && prevChatId && (inputValue.trim() || attachedFiles.length > 0 || propertyAttachments.length > 0 || submittedQueries.length > 0)) {
      console.log('💾 SideChatPanel: Saving chat state - chat became invisible:', {
        chatId: prevChatId,
        inputValue: inputValue,
        attachedFiles: attachedFiles.length,
        propertyAttachments: propertyAttachments.length
      });
      saveChatState(prevChatId, {
        inputValue: inputValue,
        attachedFiles: [...attachedFiles],
        propertyAttachments: [...propertyAttachments],
        submittedQueries: [...submittedQueries] as any[]
      });
    } else if (prevChatId && prevChatId !== currentChatId && (inputValue.trim() || attachedFiles.length > 0 || propertyAttachments.length > 0 || submittedQueries.length > 0)) {
      // Chat ID changed (switching chats) - save previous chat state
      console.log('💾 SideChatPanel: Saving chat state - switching chats:', {
        fromChatId: prevChatId,
        toChatId: currentChatId,
        inputValue: inputValue,
        attachedFiles: attachedFiles.length,
        propertyAttachments: propertyAttachments.length
      });
      saveChatState(prevChatId, {
        inputValue: inputValue,
        attachedFiles: [...attachedFiles],
        propertyAttachments: [...propertyAttachments],
        submittedQueries: [...submittedQueries] as any[]
      });
    }
  }, [isVisible, currentChatId, inputValue, attachedFiles, propertyAttachments, submittedQueries, saveChatState, expandedCardViewDoc, chatMessages, getBufferedState]);
  
  // Track abort controllers per chat ID for cleanup
  const abortControllersRef = React.useRef<Record<string, AbortController>>({});
  
  // Cleanup: Abort queries when chat is deleted from history
  React.useEffect(() => {
    // Get list of chat IDs that still exist in history
    const existingChatIds = new Set(chatHistory.map(chat => chat.id));
    
    // Find chat IDs that have abort controllers but no longer exist in history
    const deletedChatIds: string[] = [];
    Object.entries(abortControllersRef.current).forEach(([chatId, controller]) => {
      if (!existingChatIds.has(chatId)) {
        deletedChatIds.push(chatId);
      }
    });
    
    // Abort queries for deleted chats and clean up
    deletedChatIds.forEach(chatId => {
      const controller = abortControllersRef.current[chatId];
      if (controller) {
        console.log('🧹 SideChatPanel: Aborting query for deleted chat:', chatId);
        controller.abort();
        delete abortControllersRef.current[chatId];
      }
    });
  }, [chatHistory]);
  
  // Helper: Extract description from query (file changes, context, etc.)
  const extractDescription = React.useCallback((query: string): string => {
    if (!query || !query.trim()) return '';
    
    // Look for file patterns (e.g., "Edited ChatPanel.tsx", "Checking if...")
    const filePattern = /(?:edited|editing|checking|updated|modified|changed)\s+([a-zA-Z0-9_\-./]+\.(tsx?|jsx?|py|md|json|css|html|sql))/i;
    const fileMatch = query.match(filePattern);
    if (fileMatch) {
      return `Edited ${fileMatch[1]}`;
    }
    
    // Look for "Checking if..." or similar patterns
    const checkingPattern = /(checking|looking|searching|finding|analyzing|reviewing).*?[.!?]/i;
    const checkingMatch = query.match(checkingPattern);
    if (checkingMatch) {
      return checkingMatch[0].substring(0, 60).trim();
    }
    
    // Use first 50-60 characters of query if no specific pattern found
    return query.substring(0, 60).trim();
  }, []);
  
  // Helper: Clean query by removing filler words, question marks, and verbose phrases
  // Preserves location indicators (of, in, for) that might be part of location patterns
  const cleanQuery = React.useCallback((query: string): string => {
    if (!query || !query.trim()) {
      return '';
    }
    
    let cleaned = query.trim();
    
    // Remove question marks
    cleaned = cleaned.replace(/\?/g, '');
    
    // Remove verbose phrases
    const verbosePhrases = [
      /assessment\s+of/gi,
      /information\s+about/gi,
      /details\s+on/gi,
      /details\s+about/gi,
      /tell\s+me\s+about/gi,
      /show\s+me\s+the/gi,
      /show\s+me/gi,
      /please\s+show/gi,
      /can\s+you\s+show/gi,
      /could\s+you\s+show/gi,
      /what\s+is\s+the/gi,
      /what\s+are\s+the/gi,
      /what\s+is/gi,
      /what\s+are/gi,
    ];
    
    for (const phrase of verbosePhrases) {
      cleaned = cleaned.replace(phrase, '');
    }
    
    // Remove common filler words, but preserve location indicators when they might be part of patterns
    // Don't remove "of", "in", "for" as they're important for location extraction
    const fillerWords = ['please', 'show', 'me', 'tell', 'get', 'find', 'what', 'is', 'are', 'can', 'could', 'would', 'should', 'will', 'this', 'that', 'these', 'those', 'the', 'a', 'an', 'to', 'and', 'or', 'about', 'with', 'from'];
    const words = cleaned.split(/\s+/);
    const filteredWords = words.filter(w => {
      const lower = w.toLowerCase().replace(/[^\w]/g, '');
      return lower.length > 0 && !fillerWords.includes(lower);
    });
    
    cleaned = filteredWords.join(' ');
    
    // Remove dates (simple pattern - can be enhanced)
    cleaned = cleaned.replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, '');
    cleaned = cleaned.replace(/\b\d{4}\b/g, ''); // Remove standalone years
    
    // Normalize whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    return cleaned;
  }, []);
  
  // Helper: Extract property subject from attachments
  const extractPropertySubject = React.useCallback((propertyAttachments?: PropertyAttachmentData[]): string | null => {
    if (!propertyAttachments || propertyAttachments.length === 0) {
      return null;
    }
    
    const firstProperty = propertyAttachments[0].property as any;
    if (firstProperty?.address) {
      const address = firstProperty.address;
      const addressParts = address.split(',').map((p: string) => p.trim());
      if (addressParts.length > 0) {
        // Return first meaningful part (usually street address)
        let subject = addressParts[0];
        if (subject.length > 50) {
          subject = subject.substring(0, 47) + '...';
        }
        return subject;
      }
    }
    
    return null;
  }, []);
  
  // Helper: Extract main topic/subject from query (ChatGPT-style)
  // Works on original query to preserve location indicators
  const extractMainTopic = React.useCallback((query: string): string | null => {
    if (!query || !query.trim()) {
      return null;
    }
    
    const queryText = query.trim();
    const queryLower = queryText.toLowerCase();
    
    // 1. Check for property addresses in query text (highest priority)
    const propertyAddressPatterns = [
      /\d+\s+[\w\s]+(?:road|street|avenue|close|drive|lane|way|hill|park|gardens?|village|place|crescent|grove|terrace|gardens)/i,
      /[\w\s]+(?:road|street|avenue|close|drive|lane|way|hill|park|gardens?|village|place|crescent|grove|terrace),\s*[\w\s]+/i,
    ];
    
    for (const pattern of propertyAddressPatterns) {
      const match = queryText.match(pattern);
      if (match) {
        let address = match[0].trim();
        if (address.length > 50) {
          address = address.substring(0, 47) + '...';
        }
        return address;
      }
    }
    
    // 2. Check for known location patterns (Bristol areas, cities, postcodes)
    const locationPatterns = [
      /bristol,?\s*(?:city\s*centre|centre|center)/i,
      /bristol,?\s*(?:city|town)/i,
      /(?:city\s*centre|centre|center),?\s*bristol/i,
      /clifton,?\s*bristol/i,
      /harbourside,?\s*bristol/i,
      /redland,?\s*bristol/i,
      /montpelier,?\s*bristol/i,
      /bedminster,?\s*bristol/i,
      /stokes\s*croft,?\s*bristol/i,
      /easton,?\s*bristol/i,
      /hotwells,?\s*bristol/i,
      /cotham,?\s*bristol/i,
      /clifton/i,
      /harbourside/i,
      /redland/i,
      /montpelier/i,
      /bedminster/i,
      /stokes\s*croft/i,
      /easton/i,
      /hotwells/i,
      /cotham/i,
      /bristol/i,
      /bs\d+\s*\d*[a-z]{2}/i, // UK postcode
    ];
    
    for (const pattern of locationPatterns) {
      const match = queryText.match(pattern);
      if (match) {
        let location = match[0].trim();
        
        // Fix capitalization for common patterns
        if (location.toLowerCase().includes('bristol, city centre') || 
            location.toLowerCase().includes('city centre, bristol') ||
            location.toLowerCase().includes('bristol, city')) {
          return 'Bristol, City Centre';
        }
        
        // Capitalize first letter of each word
        location = location.split(/\s+/).map(word => 
          word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');
        
        return location;
      }
    }
    
    // 3. Extract location from "of [location]" pattern (very common, e.g., "value of highlands")
    // This works with lowercase locations
    const ofPattern = /\bof\s+([a-z]+(?:\s+[a-z]+)?)\b/i;
    const ofMatch = queryText.match(ofPattern);
    if (ofMatch && ofMatch[1]) {
      const location = ofMatch[1].trim();
      // Capitalize first letter of each word
      const capitalized = location.split(/\s+/).map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join(' ');
      return capitalized;
    }
    
    // 4. Extract location from "in [location]" pattern
    const inPattern = /\bin\s+([a-z]+(?:\s+[a-z]+)?)\b/i;
    const inMatch = queryText.match(inPattern);
    if (inMatch && inMatch[1]) {
      const location = inMatch[1].trim();
      const capitalized = location.split(/\s+/).map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join(' ');
      return capitalized;
    }
    
    // 5. Extract capitalized proper nouns (places, names) - but exclude metric words
    const metricWords = new Set(['risk', 'flooding', 'flood', 'water', 'surface', 'value', 'price', 'valuation', 'market', 'bedroom', 'bathroom', 'room', 'size', 'area', 'condition', 'valuer', 'surveyor', 'inspector', 'author', 'sale', 'offer', 'listing', 'transaction', 'comparable', 'comp', 'analysis', 'report', 'assessment', 'hazard']);
    const commonWords = new Set(['the', 'a', 'an', 'of', 'in', 'for', 'to', 'and', 'or', 'about', 'with', 'from', 'this', 'that', 'these', 'those', 'please', 'show', 'me', 'tell', 'get', 'find', 'what', 'is', 'are', 'can', 'could', 'would', 'should', 'will']);
    const words = queryText.split(/\s+/);
    const keyWords = words.filter(w => {
      const cleanWord = w.replace(/[^\w]/g, '');
      return cleanWord.length > 2 && 
             cleanWord[0] === cleanWord[0].toUpperCase() && 
             !commonWords.has(cleanWord.toLowerCase()) &&
             !metricWords.has(cleanWord.toLowerCase()) &&
             /^[a-zA-Z]+$/.test(cleanWord);
    });
    
    if (keyWords.length > 0) {
      // Take first meaningful capitalized word(s) - max 2 words for topic
      const topic = keyWords.slice(0, 2).join(' ');
      return topic.length > 50 ? topic.substring(0, 47) + '...' : topic;
    }
    
    // 6. Extract location from end of query (common pattern: "...of [location]")
    const endLocationPattern = /\bof\s+([a-z]+(?:\s+[a-z]+)?)\s*$/i;
    const endMatch = queryText.match(endLocationPattern);
    if (endMatch && endMatch[1]) {
      const location = endMatch[1].trim();
      const capitalized = location.split(/\s+/).map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join(' ');
      return capitalized;
    }
    
    return null;
  }, []);
  
  // Helper: Extract question type - what the user is asking about (ChatGPT-style)
  const extractQuestionType = React.useCallback((query: string): string | null => {
    if (!query || !query.trim()) {
      return null;
    }
    
    const queryLower = query.toLowerCase();
    
    // 1. Risk-related: Extract full phrase before "risk" (e.g., "surface flooding risk" → "Surface Flooding Risk")
    const riskMatch = queryLower.match(/\b(\w+(?:\s+\w+){0,3})\s+risk\b/);
    if (riskMatch && riskMatch[1]) {
      const riskType = riskMatch[1].split(/\s+/).map((word: string) => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join(' ');
      return `${riskType} Risk`;
    }
    
    // Check for standalone "risk"
    if (/\brisk\b/.test(queryLower)) {
      return 'Risk';
    }
    
    // 2. Value-related: Prioritize "market value" over just "value"
    if (/market\s+value/.test(queryLower)) {
      return 'Market Value';
    }
    if (/\bvaluation\b/.test(queryLower)) {
      return 'Valuation';
    }
    if (/\bvalue\b/.test(queryLower)) {
      return 'Value';
    }
    if (/\bprice\b/.test(queryLower)) {
      return 'Price';
    }
    if (/\bworth\b/.test(queryLower)) {
      return 'Worth';
    }
    
    // 3. Property attributes
    if (/\bbedroom(s)?\b/.test(queryLower)) {
      return 'Bedrooms';
    }
    if (/\bbathroom(s)?\b/.test(queryLower)) {
      return 'Bathrooms';
    }
    if (/\broom(s)?\b/.test(queryLower)) {
      return 'Rooms';
    }
    if (/(size|area|square\s+feet|sqft|sq\s+ft)/.test(queryLower)) {
      return 'Size';
    }
    if (/\bcondition\b/.test(queryLower)) {
      return 'Condition';
    }
    
    // 4. Professional info
    if (/\bvaluer\b/.test(queryLower)) {
      return 'Valuer';
    }
    if (/\bsurveyor\b/.test(queryLower)) {
      return 'Surveyor';
    }
    if (/\binspector\b/.test(queryLower)) {
      return 'Inspector';
    }
    if (/\bauthor\b/.test(queryLower)) {
      return 'Author';
    }
    
    // 5. Transaction info
    if (/\bsale\b/.test(queryLower)) {
      return 'Sale';
    }
    if (/\boffer\b/.test(queryLower)) {
      return 'Offer';
    }
    if (/\blisting\b/.test(queryLower)) {
      return 'Listing';
    }
    if (/\btransaction\b/.test(queryLower)) {
      return 'Transaction';
    }
    
    // 6. Other metrics
    if (/\bcomparables?\b/.test(queryLower)) {
      return 'Comparables';
    }
    if (/\bcomps\b/.test(queryLower)) {
      return 'Comparables';
    }
    if (/\banalysis\b/.test(queryLower)) {
      return 'Analysis';
    }
    if (/\breport\b/.test(queryLower)) {
      return 'Report';
    }
    if (/\bassessment\b/.test(queryLower)) {
      return 'Assessment';
    }
    if (/\bhazard\b/.test(queryLower)) {
      return 'Hazard';
    }
    
    return null;
  }, []);
  
  // ChatGPT-style chat title generation: natural, topic-first approach
  const generateSmartChatTitle = React.useCallback((query: string, propertyAttachments?: PropertyAttachmentData[], attachments?: FileAttachmentData[]): string => {
    if (!query || !query.trim()) {
      return 'New chat';
    }
    
    // 1. Check property attachments first (highest priority for topic)
    const propertyTopic = extractPropertySubject(propertyAttachments);
    if (propertyTopic) {
      const questionType = extractQuestionType(query);
      if (questionType) {
        // Natural formatting: "Topic QuestionType" (e.g., "123 Main Street Market Value")
        return `${propertyTopic} ${questionType}`;
      }
      return propertyTopic;
    }
    
    // 2. Extract main topic from original query (preserves location indicators)
    const topic = extractMainTopic(query);
    const questionType = extractQuestionType(query);
    
    // 3. Format title naturally (ChatGPT-style)
    // Priority: Topic is more important than question type
    if (topic && questionType) {
      // Combine naturally: "Highlands Value", "Bristol Bedrooms"
      return `${topic} ${questionType}`;
    }
    if (topic) {
      // If we have a clear topic, use it (ChatGPT often just uses the topic)
      return topic;
    }
    if (questionType) {
      // If no topic but clear question type, use it
      return questionType;
    }
    
    // 4. Fallback: Check for document names in attachments
    if (attachments && attachments.length > 0) {
      const firstDoc = attachments[0];
      if (firstDoc.name) {
        const docName = firstDoc.name.replace(/\.[^/.]+$/, '');
        if (docName.length > 0) {
          return docName.length > 50 ? docName.substring(0, 47) + '...' : docName;
        }
      }
    }
    
    // 5. Fallback: Intelligent truncation at word boundaries
    const queryText = query.trim();
    if (queryText.length > 50) {
      const truncated = queryText.substring(0, 47);
      const lastSpace = truncated.lastIndexOf(' ');
      if (lastSpace > 20) {
        return truncated.substring(0, lastSpace) + '...';
      }
      return truncated + '...';
    }
    
    return queryText;
  }, [extractPropertySubject, extractMainTopic, extractQuestionType]);
  
  // Streaming typing effect for title
  const streamTitle = React.useCallback((title: string) => {
    // Clear any existing interval
    if (titleStreamIntervalRef.current) {
      clearInterval(titleStreamIntervalRef.current);
      titleStreamIntervalRef.current = null;
    }
    
    setIsTitleStreaming(true);
    setStreamedTitle('');
    let index = 0;
    
    titleStreamIntervalRef.current = setInterval(() => {
      if (index < title.length) {
        setStreamedTitle(title.substring(0, index + 1));
        index++;
      } else {
        if (titleStreamIntervalRef.current) {
          clearInterval(titleStreamIntervalRef.current);
          titleStreamIntervalRef.current = null;
        }
        setIsTitleStreaming(false);
        setChatTitle(title);
        setStreamedTitle('');
      }
    }, 40) as unknown as NodeJS.Timeout; // 40ms per character
  }, []);
  
  // Cleanup streaming interval on unmount
  React.useEffect(() => {
    return () => {
      if (titleStreamIntervalRef.current) {
        clearInterval(titleStreamIntervalRef.current);
        titleStreamIntervalRef.current = null;
      }
    };
  }, []);
  
  // Edit title handlers
  const handleToggleEdit = React.useCallback(() => {
    setIsEditingTitle(true);
    setEditingTitleValue(chatTitle || 'New chat');
  }, [chatTitle]);
  
  const handleSaveTitle = React.useCallback(() => {
    const trimmedTitle = editingTitleValue.trim();
    if (trimmedTitle && trimmedTitle !== chatTitle) {
      const finalTitle = trimmedTitle || chatTitle || 'New chat';
      setChatTitle(finalTitle);
      
      // Update in chat history if currentChatId exists
      if (currentChatId) {
        updateChatTitle(currentChatId, finalTitle);
      }
    }
    setIsEditingTitle(false);
    setEditingTitleValue('');
  }, [editingTitleValue, chatTitle, currentChatId, updateChatTitle]);
  
  const handleCancelEdit = React.useCallback(() => {
    setIsEditingTitle(false);
    setEditingTitleValue('');
  }, []);
  
  // Track the last processed query from props to avoid duplicates
  const lastProcessedQueryRef = React.useRef<string>('');
  
  // CRITICAL: Track if a query is currently being processed to prevent duplicate API calls
  // This prevents race conditions between the two useEffects that both watch query/isVisible
  const isProcessingQueryRef = React.useRef<boolean>(false);
  
  // Track which queries have been processed for each chat to prevent re-processing on chat return
  // Key: chatId, Value: query string that was processed
  const processedQueriesPerChatRef = React.useRef<Record<string, string>>({});
  
  // Process query prop from SearchBar (when in map view)
  React.useEffect(() => {
    // Only process if:
    // 1. Query is provided and not empty
    // 2. Query is different from last processed query
    // 3. Query hasn't already been added to chat messages
    // 4. We're not already processing a query
    // 5. We're not currently restoring a chat AND switching to a different chat
    //    (allow query processing if restoreChatId matches currentChatId - same chat, no switch needed)
    // NOTE: Removed isVisible check - queries should process in background even when panel is hidden
    // This allows queries to continue processing when user navigates away
    // CRITICAL: Only block if genuinely switching to a different chat
    // Allow query processing to continue for the active chat even during restoration
    const isActuallySwitchingChats = isRestoringChatRef.current && 
      restoreChatId && 
      restoreChatId !== currentChatId &&
      restoreChatId !== currentChatIdRef.current; // Also check ref to handle async state updates
    
    // CRITICAL: When restoring a chat, don't process any query from the prop
    // The restored chat's messages are loaded from history, not from a new query
    // This prevents query leakage where the previous chat's query gets sent to the restored chat's session
    const isRestoringDifferentChat = restoreChatId && restoreChatId !== currentChatId;
    
    // CRITICAL: Check if this query was already processed for the target chat
    // This prevents re-processing when returning to a chat that already has this query completed
    const chatIdForQuery = currentChatId || restoreChatId;
    const alreadyProcessedForThisChat = chatIdForQuery && 
      processedQueriesPerChatRef.current[chatIdForQuery] === query?.trim();
    
    if (alreadyProcessedForThisChat) {
      // Silently skip - this is expected behavior when returning to a chat
      // Only log in dev mode to reduce console noise
      if (import.meta.env.DEV) {
        console.log('⏭️ SideChatPanel: Skipping query - already processed for this chat:', {
          query: query?.substring(0, 50),
          chatId: chatIdForQuery
        });
      }
    }
    
    if (isRestoringDifferentChat) {
      console.log('⏭️ SideChatPanel: Skipping query - restoring a different chat:', {
        query: query?.substring(0, 50),
        restoreChatId,
        currentChatId
      });
    }
    
    if (query && query.trim() && query !== lastProcessedQueryRef.current && !isProcessingQueryRef.current && !isActuallySwitchingChats && !alreadyProcessedForThisChat && !isRestoringDifferentChat) {
      const queryText = query.trim();
      
      // PLAN MODE: Intercept query and show plan viewer instead of normal flow
      if (isPlanModeRef.current) {
        // CRITICAL: Capture current plan content BEFORE clearing it
        const currentPlanContent = planContent;
        const isFollowUpQuery = showPlanViewer && currentPlanContent.length > 0;
        
        // Mark as processed to prevent re-processing
        lastProcessedQueryRef.current = queryText;
        isProcessingQueryRef.current = true;
        
        // If this is a follow-up (updating existing plan), set up update state
        if (isFollowUpQuery) {
          setPreviousPlanContent(currentPlanContent);
          setIsUpdatingPlan(true);  // Set IMMEDIATELY for instant reasoning steps
          setAdjustmentQuery(queryText);  // Set IMMEDIATELY
          // Reset incremental diff state
          setIncrementalAdjustments([]);
          seenAdjustmentIdsRef.current.clear();
          lastDiffCheckRef.current = { content: '', timestamp: Date.now(), chunkCount: 0 };
        } else {
          setPreviousPlanContent('');
          setIsUpdatingPlan(false);
          setAdjustmentQuery('');
        }
        
        // Store query text for later use
        setPlanQueryText(queryText);
        setPlanBuildStatus('streaming');
        // Only clear content and hide viewer for NEW queries, not follow-ups
        if (!isFollowUpQuery) {
          setPlanContent(''); // Only clear for new queries
          setShowPlanViewer(false); // Only hide for new queries
        }
        setPlanGenerationReasoningSteps([]); // Clear previous reasoning steps
        
        // Only add query to chat messages for NEW queries (not follow-ups)
        // Follow-up queries are rendered below the plan viewer using adjustmentQuery
        if (!isFollowUpQuery) {
          const queryMessageId = `query-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const queryMessage: ChatMessage = {
            id: queryMessageId,
            type: 'query',
            text: queryText
          };
          setChatMessages(prev => [...prev, queryMessage]);
        }
        
        // Call API with planMode=true
        (async () => {
          let accumulatedPlan = '';
          try {
            await backendApi.queryDocumentsStreamFetch(
              queryText,
              undefined,
              [],
              sessionId,
              () => {}, // onToken - not used for plan mode
              () => {
                // onComplete - plan streaming done via onPlanComplete
                isProcessingQueryRef.current = false;
              },
              (error) => {
                console.error('📋 [PLAN_MODE] Error:', error);
                setPlanBuildStatus('error');
                isProcessingQueryRef.current = false;
              },
              undefined, // onStatus
              undefined, // abortSignal
              undefined, // documentIds
              (step: { step: string; message: string; details: any; action_type?: string }) => {
                // Handle reasoning steps during plan generation
                console.log('📋 [PLAN_MODE] Reasoning step during generation:', step);
                
                // Don't show "complete" steps - the plan viewer will appear instead
                if (step.action_type === 'complete') {
                  return;
                }
                
                const newStep: PlanReasoningStep = {
                  icon: step.action_type === 'planning' ? 'planning' : 'loading',
                  message: step.message,
                  detail: step.details?.query || undefined,
                  isActive: true
                };
                
                setPlanGenerationReasoningSteps(prev => [...prev, newStep]);
              }, // onReasoningStep
              undefined, // onReasoningContext
              undefined, // onCitation
              undefined, // onExecutionEvent
              undefined, // citationContext
              undefined, // responseMode
              undefined, // attachmentContext
              undefined, // onAgentAction
              false, // isAgentMode
              selectedModel, // model
              undefined, // onThinkingChunk
              undefined, // onThinkingComplete
              // Plan mode callbacks
              (chunk: string) => {
                accumulatedPlan += chunk;
                setPlanContent(accumulatedPlan);
                
                // Incremental diff logic (only for follow-up/update queries)
                if (isFollowUpQuery && currentPlanContent) {
                  const check = lastDiffCheckRef.current;
                  check.chunkCount++;
                  const timeSinceLastCheck = Date.now() - check.timestamp;
                  const contentGrowth = accumulatedPlan.length - check.content.length;
                  
                  const shouldCheck = 
                    isSectionComplete(accumulatedPlan, check.content) ||
                    contentGrowth > 500 ||
                    check.chunkCount >= 10 ||
                    timeSinceLastCheck > 2000;
                  
                  if (shouldCheck && check.content !== accumulatedPlan) {
                    const allAdjustments = extractAdjustmentsFromDiff(currentPlanContent, accumulatedPlan);
                    const newAdjustments = allAdjustments.filter(adj => !seenAdjustmentIdsRef.current.has(adj.id));
                    
                    if (newAdjustments.length > 0) {
                      newAdjustments.forEach(adj => seenAdjustmentIdsRef.current.add(adj.id));
                      setIncrementalAdjustments(allAdjustments);
                      setVisibleAdjustmentCount(allAdjustments.length);
                    }
                    
                    check.content = accumulatedPlan;
                    check.timestamp = Date.now();
                    check.chunkCount = 0;
                  }
                }
              },
              (planIdReceived: string, fullPlan: string, isUpdate?: boolean) => {
                console.log('📋 [PLAN_MODE] Plan complete:', { planId: planIdReceived, planLength: fullPlan.length, isUpdate });
                setPlanId(planIdReceived);
                setPlanContent(fullPlan);
                setPlanBuildStatus('ready');
                isProcessingQueryRef.current = false;
                
                // Clear reasoning steps and show plan viewer now that plan is ready
                setPlanGenerationReasoningSteps([]);
                setShowPlanViewer(true);
                
                // Final diff to ensure all adjustments captured
                if (isUpdate && currentPlanContent) {
                  const finalAdjustments = extractAdjustmentsFromDiff(currentPlanContent, fullPlan);
                  setIncrementalAdjustments(finalAdjustments);
                  // Don't reset visibleAdjustmentCount here - let staggered reveal handle it
                }
                
                // Track if this was an update (keep for backwards compat, but isUpdatingPlan already set)
                if (isUpdate) {
                  setIsUpdatingPlan(true);
                  setAdjustmentQuery(queryText);
                }
              },
              true, // planMode
              isFollowUpQuery ? currentPlanContent : undefined // existingPlan for updates - use captured value
            );
          } catch (error) {
            console.error('📋 [PLAN_MODE] Failed to generate plan:', error);
            setPlanBuildStatus('error');
            isProcessingQueryRef.current = false;
          }
        })();
        
        return; // Don't continue with normal flow
      }
      
      // Check if this query is already in chat messages
      const isAlreadyAdded = chatMessages.some(msg => 
        msg.type === 'query' && msg.text === queryText
      );
      
      if (!isAlreadyAdded) {
        // FIRST: Show bot status overlay immediately (before any processing) - ONLY in agent mode
        if (isAgentMode) {
          console.log('🤖 [BOT_STATUS] Activating bot status overlay (from query prop)');
          setIsBotActive(true);
          setBotActivityMessage('Running...');
          setIsBotPaused(false);
          isBotPausedRef.current = false; // Reset pause ref
        }
        
        // Reset navigation task flag on new query - allows fullscreen expansion for fresh queries
        isNavigatingTaskRef.current = false;
        
        // Mark this query as being processed
        lastProcessedQueryRef.current = queryText;
        isProcessingQueryRef.current = true;
        
        // Get selected document IDs (use ref so we see latest selection at send time)
        const currentSelectionForMessage = selectedDocumentIdsRef.current;
        const selectedDocIds = (currentSelectionForMessage?.size ?? 0) > 0 
          ? Array.from(currentSelectionForMessage) 
          : undefined;
        
        // Try to get document names from property attachments if available
        let selectedDocNames: string[] | undefined = undefined;
        if (selectedDocIds && selectedDocIds.length > 0 && propertyAttachments.length > 0) {
          // Get documents from the first property attachment
          const property = propertyAttachments[0].property as any;
          if (property?.propertyHub?.documents) {
            selectedDocNames = selectedDocIds
              .map(docId => {
                const doc = property.propertyHub.documents.find((d: any) => d.id === docId);
                return doc?.original_filename;
              })
              .filter((name): name is string => !!name);
          }
        }
        
        // Check if this is a new chat session
        // CRITICAL: Use refs for more reliable detection (avoids stale closure issues)
        // This prevents query leakage between agents when switching quickly
        // Priority: Check ref first (updated synchronously), then state as fallback
        const currentChatIdValue = currentChatIdRef.current ?? currentChatId;
        const currentMessagesLength = chatMessagesRef.current.length || chatMessages.length;
        const isNewChatSession = !currentChatIdValue || currentMessagesLength === 0;
        
        let chatSessionId = sessionId; // Default to component sessionId, will be overridden if new chat
        let savedChatId: string | undefined; // Declare at higher scope for status update
        
        if (isNewChatSession) {
          // Generate chat ID and title for new chat
          const newChatId = `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          setCurrentChatId(newChatId);
          currentChatIdRef.current = newChatId; // Update ref synchronously for streaming callbacks
          
          // Generate smart title from first query
          const generatedTitle = generateSmartChatTitle(
            queryText,
            propertyAttachments,
            attachedFiles.length > 0 ? attachedFiles : initialAttachedFiles
          );
          
          // Extract description from query
          const description = extractDescription(queryText || '');
          
          // Create chat history entry with unique sessionId
          // CRITICAL: Generate unique sessionId tied to chat ID for backend isolation
          const chatHistorySessionId = `session_${newChatId}_${Date.now()}`;
          chatSessionId = chatHistorySessionId; // Use chat's sessionId for this query
          
          savedChatId = addChatToHistory({
            title: generatedTitle,
            timestamp: new Date().toISOString(),
            preview: queryText || '',
            messages: [],
            status: 'completed', // Create with 'completed' status, update to 'loading' when query actually starts
            sessionId: chatHistorySessionId, // Unique sessionId per agent
            description: description // Secondary detail line
          });
          
          // CRITICAL: Update currentChatId to match the actual ID from addChatToHistory
          // This fixes the bug where currentChatId was set to newChatId but addChatToHistory
          // generates a different ID internally. Without this, updateChatInHistory calls
          // would fail to find the chat when switching agents.
          setCurrentChatId(savedChatId);
          currentChatIdRef.current = savedChatId; // Update ref synchronously for streaming callbacks
          
          // Record this query as processed for this chat to prevent re-processing on chat return
          processedQueriesPerChatRef.current[savedChatId] = queryText;
          
          console.log('✅ SideChatPanel: Created new chat history entry (query prop path):', {
            chatId: savedChatId,
            sessionId: chatHistorySessionId,
            status: 'completed',
            description
          });
          
          // Stream the title with typing effect
          streamTitle(generatedTitle);
        } else if (currentChatId) {
          // For existing chat, get sessionId from chat history
          const existingChat = getChatById(currentChatId);
          if (existingChat?.sessionId) {
            chatSessionId = existingChat.sessionId;
            console.log('🔄 SideChatPanel: Using existing chat sessionId (query prop path):', chatSessionId);
          }
          // Update status to loading for existing chat
          updateChatStatus(currentChatId, 'loading');
        }
        
        // Add query message to chat (similar to handleSubmit)
        // CRITICAL: Use performance.now() + random to ensure uniqueness
        const queryId = `query-${performance.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Use attachments from state, but fallback to initialAttachedFiles if state is empty
        // This handles the case where query arrives before attachments are synced to state
        // Also check the ref for the most up-to-date attachments
        // CRITICAL: Sync initialAttachedFiles to state if they exist and state is empty
        if (initialAttachedFiles && initialAttachedFiles.length > 0 && attachedFiles.length === 0) {
          console.log('📎 SideChatPanel: Syncing initialAttachedFiles to state before processing query');
          setAttachedFiles(initialAttachedFiles);
          attachedFilesRef.current = initialAttachedFiles;
        }
        
        const attachmentsFromRef = attachedFilesRef.current;
        let attachmentsToUse = attachmentsFromRef.length > 0 
          ? attachmentsFromRef 
          : (attachedFiles.length > 0 
            ? attachedFiles 
            : (initialAttachedFiles || []));
        
        // If we have initialAttachedFiles but they're not in state yet, force sync immediately
        if (initialAttachedFiles && initialAttachedFiles.length > 0 && attachmentsToUse.length === 0) {
          console.warn('⚠️ SideChatPanel: initialAttachedFiles exist but not synced yet, force-syncing...');
          // Force sync immediately
          setAttachedFiles(initialAttachedFiles);
          attachedFilesRef.current = initialAttachedFiles;
          // Use the synced attachments
          attachmentsToUse = initialAttachedFiles;
          console.log('📎 SideChatPanel: Force-synced attachments:', attachmentsToUse.length);
        }
        
        console.log('📎 SideChatPanel: Using attachments for query:', {
          fromRef: attachmentsFromRef.length,
          fromState: attachedFiles.length,
          fromInitial: initialAttachedFiles?.length || 0,
          final: attachmentsToUse.length,
          attachmentNames: attachmentsToUse.map(a => a.name),
          initialAttachedFilesDetails: initialAttachedFiles?.map(a => ({ 
            name: a.name, 
            hasExtracted: !!a.extractedText,
            extractedLength: a.extractedText?.length || 0
          })) || [],
          attachmentsToUseDetails: attachmentsToUse.map(a => ({
            name: a.name,
            hasExtracted: !!a.extractedText,
            extractedLength: a.extractedText?.length || 0
          }))
        });
        
        // CRITICAL: Create a deep copy of attachments to ensure they persist in the message
        // This is especially important when attachments come from initialAttachedFiles prop
        const attachmentsForMessage = attachmentsToUse.map(att => ({
          ...att,
          file: att.file, // Preserve file reference
          extractedText: att.extractedText, // Preserve extracted text
          pageTexts: att.pageTexts, // Preserve page texts
          tempFileId: att.tempFileId // Preserve temp file ID
        }));
        
        // Use ref fallback so we have segments even if state hasn't propagated yet (dashboard search with property chip)
        const effectiveSegmentsForMessage = (initialContentSegments?.length ? initialContentSegments : (pendingSearchContentSegmentsRef?.current ?? [])) as QueryContentSegment[];
        
        const newQueryMessage: ChatMessage = {
          id: queryId,
          type: 'query',
          text: queryText,
          attachments: attachmentsForMessage, // Use the deep copy
          propertyAttachments: [...propertyAttachments],
          selectedDocumentIds: selectedDocIds,
          selectedDocumentNames: selectedDocNames,
          contentSegments: effectiveSegmentsForMessage.length > 0 ? effectiveSegmentsForMessage : undefined, // Exact order from SearchBar/MapChatBar (ref fallback)
          fromCitation: !!citationContext, // Mark if query came from citation
          citationBboxData: citationContext ? {
            document_id: citationContext.document_id,
            page_number: citationContext.page_number,
            bbox: citationContext.bbox,
            original_filename: citationContext.original_filename,
            block_id: (citationContext as any).block_id || undefined || undefined
          } : undefined
        };
        
        console.log('💬 SideChatPanel: Creating query message with attachments:', {
          messageId: queryId,
          attachmentCount: attachmentsForMessage.length,
          attachments: attachmentsForMessage.map(a => ({
            name: a.name,
            hasExtracted: !!a.extractedText,
            extractedLength: a.extractedText?.length || 0
          }))
        });
        
        setChatMessages(prev => {
          const updated = [...prev, newQueryMessage];
          persistedChatMessagesRef.current = updated;
          return updated;
        });
        
        // Add loading response message
        // CRITICAL: Use performance.now() + random to ensure uniqueness even if called multiple times rapidly
        const loadingResponseId = `response-loading-${performance.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const loadingMessage: ChatMessage = {
          id: loadingResponseId,
          type: 'response',
          text: '',
          isLoading: true,
          reasoningSteps: [], // Initialize empty array for reasoning steps
          citations: {} // Initialize empty object for citations
        };
        setChatMessages(prev => {
          const updated = [...prev, loadingMessage];
          persistedChatMessagesRef.current = updated;
          return updated;
        });
        
        // Call LLM API to query documents (same logic as handleSubmit)
        (async () => {
          try {
            // Use same segments as message (effectiveSegmentsForMessage includes ref fallback)
            const effectiveSegments = effectiveSegmentsForMessage;
            // Derive propertyId: from propertyAttachments first, then from effectiveSegments (SearchBar/Map path)
            let propertyId: string | undefined;
            if (propertyAttachments.length > 0) {
              propertyId = String(propertyAttachments[0].propertyId);
            } else if (effectiveSegments.length > 0) {
              const firstPropertySeg = effectiveSegments.find((s): s is QueryContentSegment & { type: 'property' } => s.type === 'property');
              const att = firstPropertySeg?.attachment;
              if (att) {
                const raw = att.propertyId ?? (att as any).property?.id ?? att.id;
                propertyId = raw != null ? String(raw) : undefined;
              } else {
                propertyId = undefined;
              }
            } else {
              propertyId = undefined;
            }
            
            const messageHistory = chatMessages
              .filter(msg => (msg.type === 'query' || msg.type === 'response') && msg.text)
              .map(msg => ({
                role: msg.type === 'query' ? 'user' : 'assistant',
                content: msg.text || ''
              }));
            
            // Merge document IDs: use ref so async callback sees latest selection (avoids documentIds: undefined)
            const currentSelection = selectedDocumentIdsRef.current;
            const fromSelection = (currentSelection?.size ?? 0) > 0 ? Array.from(currentSelection) : [];
            const docChipIdsFromSegments = effectiveSegments
              .filter((s): s is QueryContentSegment & { type: 'document' } => s.type === 'document')
              .map((s) => s.id)
              .filter(Boolean);
            const mergedDocIds = [...new Set([...fromSelection, ...docChipIdsFromSegments].filter(Boolean))];
            let documentIdsArray: string[] | undefined = mergedDocIds.length > 0 ? mergedDocIds : undefined;
            if (!documentIdsArray?.length && propertyAttachments.length > 0) {
              const firstProperty = propertyAttachments[0].property as any;
              const docs = firstProperty?.propertyHub?.documents;
              if (docs && Array.isArray(docs)) {
                documentIdsArray = docs.map((d: any) => String(d.id ?? d.document_id ?? d)).filter(Boolean);
              }
            }
            // When query came from SearchBar/Map (effectiveSegments), propertyAttachments may be empty; use segment's attachment
            if (!documentIdsArray?.length && effectiveSegments.length > 0) {
              const firstPropertySeg = effectiveSegments.find((s): s is QueryContentSegment & { type: 'property' } => s.type === 'property');
              const firstProperty = firstPropertySeg?.attachment?.property as any;
              const docs = firstProperty?.propertyHub?.documents;
              if (docs && Array.isArray(docs)) {
                documentIdsArray = docs.map((d: any) => String(d.id ?? d.document_id ?? d)).filter(Boolean);
              }
            }
            
            console.log('📤 SideChatPanel (query-prop): scope for backend', {
              effectiveSegmentsLength: effectiveSegments.length,
              propertyId: propertyId ?? undefined,
              documentIdsArray: documentIdsArray ?? undefined,
              hasPropertySegment: effectiveSegments.some(s => s.type === 'property')
            });
            
            // Link query text and chips into one sentence so the model sees context (e.g. "what is the value of highlands").
            const rawQueryWithChip =
              effectiveSegments.length > 0
                ? (contentSegmentsToLinkedQuery(effectiveSegments) || queryText)
                : queryText;
            const queryWithChipContext = stripHtmlFromQuery(rawQueryWithChip);

            // Check if attachments have extracted text - show file choice step if so
            let responseMode: 'fast' | 'detailed' | 'full' | undefined;
            let attachmentContext: { texts: string[]; pageTexts: string[][]; filenames: string[]; tempFileIds: string[] } | null = null;
            
            // CRITICAL: Use attachmentsToUse which should have extractedText from initialAttachedFiles
            console.log('🔍 Checking for extracted attachments:', {
              attachmentCount: attachmentsToUse.length,
              attachments: attachmentsToUse.map(a => ({
                name: a.name,
                hasExtractedText: !!a.extractedText,
                extractedLength: a.extractedText?.length || 0,
                hasPageTexts: !!(a.pageTexts && a.pageTexts.length > 0)
              }))
            });
            
            if (hasExtractedAttachments(attachmentsToUse)) {
              console.log('📁 Attachments have extracted text - showing file choice step');
              
              // Wait for user to select response mode
              const userChoice = await showFileChoiceAndWait(loadingResponseId, attachmentsToUse);
              console.log('📁 User selected response mode:', userChoice);
              
              // Map 'project' choice to 'full' for backend (project = full + property linking)
              responseMode = userChoice === 'project' ? 'full' : userChoice;
              
              // Build attachment context for backend
              attachmentContext = buildAttachmentContext(attachmentsToUse);
              console.log('📦 Built attachment context:', {
                hasContext: !!attachmentContext,
                textCount: attachmentContext?.texts.length || 0,
                filenameCount: attachmentContext?.filenames.length || 0,
                filenames: attachmentContext?.filenames || []
              });
              
              // Clear the file choice step and add "Processing with..." step
              const processingStep: ReasoningStep = {
                step: 'processing_attachments',
                action_type: 'analysing',
                message: userChoice === 'fast' 
                  ? 'Generating fast response...' 
                  : userChoice === 'detailed'
                    ? 'Analysing documents for detailed citations...'
                    : 'Processing and adding to project...',
                details: {},
                timestamp: Date.now()
              };
              
              setChatMessages(prev => prev.map(msg => 
                msg.id === loadingResponseId 
                  ? { ...msg, reasoningSteps: [processingStep] }
                  : msg
              ));
            } else {
              // Only warn if there ARE attachments but no extracted text
              // If there are no attachments at all, this is normal (regular query)
              if (attachmentsToUse.length > 0) {
                console.warn('⚠️ No extracted text found in attachments:', {
                  attachmentCount: attachmentsToUse.length,
                  attachments: attachmentsToUse.map(a => ({
                    name: a.name,
                    hasExtractedText: !!a.extractedText,
                    extractionStatus: a.extractionStatus
                  }))
                });
              }
              // If no attachments, silently continue (normal query flow)
            }
            
            // Create abort controller for query prop path
            const queryPropAbortController = new AbortController();
            if (currentChatId) {
              abortControllersRef.current[currentChatId] = queryPropAbortController;
            }
            // Also set in old ref for backward compatibility
            abortControllerRef.current = queryPropAbortController;
            
            let accumulatedText = '';
            let tokenBuffer = ''; // Buffer for tokens before displaying
            let displayedText = ''; // Text currently displayed to user (complete markdown blocks only)
            let pendingBuffer = ''; // Buffer for incomplete markdown blocks
            const blockQueue: string[] = []; // Queue of complete markdown blocks to display
            let isProcessingQueue = false;
            const accumulatedCitations: Record<string, CitationDataType> = {};
            const preloadingDocs = new Set<string>(); // Track documents currently being preloaded to avoid duplicates
            
            // Extract complete markdown blocks from buffer using shared helper
            // Pre-completes markdown so text is always valid when stored in state
            const extractCompleteBlocks = () => {
              const combined = pendingBuffer + tokenBuffer;
              const { completeBlocks, remainingBuffer } = extractMarkdownBlocks(combined);
              
              // Add complete blocks to queue (already pre-completed by helper)
              if (completeBlocks.length > 0) {
                blockQueue.push(...completeBlocks);
                // Start processing queue if not already processing
                if (!isProcessingQueue) {
                  processBlockQueue();
                }
              }
              
              // Update buffers
              pendingBuffer = remainingBuffer;
              tokenBuffer = '';
            };
            
            // Process block queue with gradual display (streaming effect)
            const processBlockQueue = () => {
              if (isProcessingQueue || blockQueue.length === 0) return;
              
              // Don't process if paused
              if (isBotPausedRef.current) {
                return;
              }
              
              isProcessingQueue = true;
              
              const processNext = () => {
                // Check if paused - if so, stop processing
                if (isBotPausedRef.current) {
                  isProcessingQueue = false;
                  return;
                }
                
                // CRITICAL: Check if this chat is still active before updating UI
                // This prevents leakage when user switches to a new chat mid-stream
                const stillActive = isChatActiveForQuery(queryChatId, savedChatId);
                if (!stillActive) {
                  console.log('⚠️ [BLOCK_QUEUE] Chat no longer active, stopping block processing:', {
                    queryChatId,
                    activeChatId: activeChatIdRef.current
                  });
                  isProcessingQueue = false;
                  // Buffer the accumulated text for this chat
                  if (queryChatId) {
                    const bufferedState = getBufferedState(queryChatId);
                    bufferedState.accumulatedText = displayedText;
                    bufferedState.lastUpdate = Date.now();
                  }
                  return;
                }
                
                if (blockQueue.length === 0) {
                  isProcessingQueue = false;
                  // Check if we have more blocks to extract
                  if (tokenBuffer.trim() || pendingBuffer.trim()) {
                    extractCompleteBlocks();
                    if (blockQueue.length > 0 && !isBotPausedRef.current) {
                      processBlockQueue();
                    }
                  }
                  return;
                }
                
                // Get next block from queue
                const block = blockQueue.shift();
                if (block) {
                  // Add block to displayed text
                  displayedText += block;
                  
                  // Clean the text (remove EVIDENCE_FEEDBACK tags, etc.) but don't complete markdown here
                  // Let StreamingResponseText component handle markdown completion based on isStreaming state
                  // This ensures consistent behavior across all queries
                  const cleanedText = cleanResponseText(displayedText);
                  
                  // CRITICAL: Set isLoading to false as soon as text appears to stop animations immediately
                  // This ensures spinning animations stop when response text starts displaying
                  setChatMessages(prev => prev.map(msg => {
                    if (msg.id === loadingResponseId) {
                      // If this is the first time we're adding text, set isLoading to false
                      const wasLoading = msg.isLoading;
                      const hasTextNow = cleanedText.trim().length > 0;
                      
                      if (wasLoading && hasTextNow) {
                        console.log('✅ SideChatPanel: Response text appeared, setting isLoading to false (query prop path):', {
                          loadingResponseId,
                          textLength: cleanedText.length,
                          textPreview: cleanedText.substring(0, 100)
                        });
                        
                        // Update chat status to completed when text first appears
                        if (currentChatId) {
                          updateChatStatus(currentChatId, 'completed');
                        }
                      }
                      
                      return { ...msg, text: cleanedText, isLoading: false };
                    }
                    return msg;
                  }));
                  
                  // Determine delay based on block type and size
                  // Headings: slightly longer delay
                  // Regular blocks: shorter delay for smooth streaming
                  const isHeading = block.match(/^##+\s+/);
                  const blockSize = block.length;
                  const delay = isHeading ? 60 : Math.min(40, Math.max(20, blockSize / 3)); // 20-40ms, longer for headings
                  
                  setTimeout(processNext, delay);
                } else {
                  isProcessingQueue = false;
                }
              };
              
              processNext();
            };
            
            // Process tokens and extract complete blocks
            const processTokensWithDelay = () => {
              // Don't process if paused
              if (isBotPausedRef.current) {
                return;
              }
              
              // Extract complete blocks from current buffer
              extractCompleteBlocks();
              
              // If we have blocks in queue and not processing, start processing (only if not paused)
              if (blockQueue.length > 0 && !isProcessingQueue && !isBotPausedRef.current) {
                processBlockQueue();
              }
            };
            
            // Store resume function so it can be called when unpaused
            resumeProcessingRef.current = processTokensWithDelay;
            
            // Helper function to preload a document by doc_id - fires immediately, no delays
            const preloadDocumentById = (docId: string, filename?: string) => {
              // Skip if already cached or currently preloading
              const isCached = previewFiles.some(f => f.id === docId);
              const isPreloading = preloadingDocs.has(docId);
              
              if (isCached || isPreloading) {
                return; // Already handled
              }
              
              // Mark as preloading immediately
              preloadingDocs.add(docId);
              
              // Start download immediately (fire and forget, no setTimeout delay)
              (async () => {
                try {
                  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
                  const downloadUrl = `${backendUrl}/api/files/download?document_id=${docId}`;
                  
                  
                  const response = await fetch(downloadUrl, {
                    credentials: 'include'
                  });
                  
                  if (!response.ok) {
                    console.warn('⚠️ [PRELOAD] Failed to download document:', response.status);
                    preloadingDocs.delete(docId);
                    return;
                  }
                  
                  const blob = await response.blob();
                  const fileType = blob.type || 'application/pdf';
                  const fileSize = blob.size;
                  
                  // Create File object from blob
                  const file = new File(
                    [blob], 
                    filename || 'document.pdf', 
                    { type: fileType }
                  );
                  
                  // Convert to FileAttachmentData format
                  const fileData: FileAttachmentData = {
                    id: docId,
                    file: file,
                    name: filename || 'document.pdf',
                    type: fileType,
                    size: fileSize
                  };
                  
                  // Preload into cache (silent, doesn't open preview)
                  preloadFile(fileData);
                  
                  // Remove from preloading set after successful cache
                  preloadingDocs.delete(docId);
                  
                } catch (error) {
                  console.warn('⚠️ [PRELOAD] Error preloading document:', error);
                  preloadingDocs.delete(docId);
                }
              })(); // Execute immediately, no delay
            };
            
            // Log what we're sending to the backend
            console.log('📤 SideChatPanel: Sending query to backend with:', {
              query: queryWithChipContext,
              propertyId,
              messageHistoryLength: messageHistory.length,
              responseMode,
              hasAttachmentContext: !!attachmentContext,
              attachmentContextDetails: attachmentContext ? {
                textCount: attachmentContext.texts.length,
                filenameCount: attachmentContext.filenames.length,
                filenames: attachmentContext.filenames,
                totalTextLength: attachmentContext.texts.reduce((sum, t) => sum + t.length, 0)
              } : null
            });
            
            // CRITICAL: Use chat's sessionId (not component sessionId) for backend isolation
            // Create abort controller for this query (query prop path - file attachments)
            const queryPropFileAbortController = new AbortController();
            
            // CRITICAL: Capture queryChatId at query start (not when callbacks fire)
            // Use savedChatId for new chats, otherwise use ref (more reliable than state)
            const queryChatId = savedChatId || currentChatIdRef.current || currentChatId;
            
            // CRITICAL: Set activeChatIdRef IMMEDIATELY when query starts (before any streaming callbacks)
            // This ensures streaming updates route to the correct chat
            if (queryChatId && isVisible) {
              activeChatIdRef.current = queryChatId;
            }
            
            if (queryChatId) {
              abortControllersRef.current[queryChatId] = queryPropFileAbortController;
            }
            
            // Update chat status to 'loading' right before query starts
            if (queryChatId) {
              updateChatStatus(queryChatId, 'loading');
            }
            
            // Initialize buffered state for this chat if it doesn't exist
            if (queryChatId) {
              getBufferedState(queryChatId);
              // CRITICAL: activeChatIdRef is already set above, but log for debugging
              if (isVisible) {
                console.log('✅ SideChatPanel: Set activeChatIdRef for query:', {
                  queryChatId,
                  savedChatId,
                  currentChatId,
                  isVisible
                });
              }
            }
            
            await backendApi.queryDocumentsStreamFetch(
              queryWithChipContext,
              propertyId,
              messageHistory,
              chatSessionId, // Use chat's sessionId (not component sessionId) for backend isolation
              // onToken: Buffer tokens until we have complete markdown blocks, then display formatted
              (token: string) => {
                accumulatedText += token;
                tokenBuffer += token;
                
                // Check if chat is active before updating UI
                // CRITICAL: For new chats, currentChatId might not be updated yet (async state)
                // So we check activeChatIdRef which is set synchronously, or savedChatId for new chats
                // Also allow updates if we're restoring the same chat that's processing
                // Use unified helper for consistent chat active check
                const chatIsActive = isChatActiveForQuery(queryChatId, savedChatId);
                
                // Only process tokens if not paused and chat is active
                if (!isBotPausedRef.current && chatIsActive) {
                  // Process tokens to find complete markdown blocks
                  // This allows ReactMarkdown to render formatted output progressively
                  processTokensWithDelay();
                } else if (!chatIsActive && queryChatId) {
                  // Chat is inactive - buffer the update
                  const bufferedState = getBufferedState(queryChatId);
                  bufferedState.accumulatedText = accumulatedText;
                  bufferedState.lastUpdate = Date.now();
                }
                // If paused, tokens are still accumulated in tokenBuffer but not processed
                // When resumed, processTokensWithDelay() will be called to process buffered tokens
                
                // Always update history periodically
                // CRITICAL: Use chatMessagesRef.current to avoid stale closure issues
                if (queryChatId && accumulatedText.length % 100 === 0) {
                  const currentMessages = chatMessagesRef.current;
                  const historyMessages = currentMessages.map(msg => ({
                    role: msg.type === 'query' ? 'user' : 'assistant',
                    content: msg.text || '',
                    attachments: msg.attachments || [],
                    propertyAttachments: msg.propertyAttachments || [],
                    citations: msg.citations || {},
                    isLoading: msg.isLoading,
                    reasoningSteps: msg.reasoningSteps || []
                  }));
                  updateChatInHistory(queryChatId, historyMessages);
                  console.log('📝 [HISTORY_SAVE] Periodic update:', { chatId: queryChatId, messageCount: historyMessages.length, textLength: accumulatedText.length });
                }
              },
              // onComplete: Final response received - flush buffer and complete animation
              (data: any) => {
                // Check if chat is active
                // CRITICAL: For new chats, currentChatId might not be updated yet (async state)
                // Use unified helper for consistent chat active check
                const chatIsActive = isChatActiveForQuery(queryChatId, savedChatId);
                
                console.log('✅ SideChatPanel: onComplete received:', { 
                  hasData: !!data, 
                  hasSummary: !!data?.summary, 
                  summaryLength: data?.summary?.length || 0,
                  summaryPreview: data?.summary?.substring(0, 100) || 'N/A',
                  displayedTextLength: displayedText.length,
                  displayedTextPreview: displayedText.substring(0, 100) || 'N/A',
                  accumulatedTextLength: accumulatedText.length,
                  accumulatedTextPreview: accumulatedText.substring(0, 100) || 'N/A',
                  tokenBufferLength: tokenBuffer.length,
                  pendingBufferLength: pendingBuffer.length,
                  dataKeys: data ? Object.keys(data) : [],
                  fullData: data, // Include full data for debugging
                  chatIsActive,
                  queryChatId
                });
                
                // Extract any remaining complete blocks
                extractCompleteBlocks();
                
                // Flush any remaining incomplete buffer - add to displayed text
                // NOTE: Don't update message text here - let finalizeText() use data.summary as source of truth
                // This prevents displayedText from overriding the properly formatted final response
                if (tokenBuffer.trim() || pendingBuffer.trim()) {
                  displayedText += pendingBuffer + tokenBuffer;
                  pendingBuffer = '';
                  tokenBuffer = '';
                  // Don't update message text here - finalizeText() will handle it with data.summary
                }
                
                // Wait for queue to finish processing, then set final text
                const finalizeText = () => {
                // Use displayedText as source of truth - it was pre-completed during streaming
                // This ensures text doesn't change when streaming completes (prevents "click" effect)
                // Fallback to data.summary only if displayedText is empty
                  // CRITICAL: Ensure we always have text to display
                  const rawText = displayedText || data?.summary || accumulatedText || "";
                  const finalText = rawText.trim() 
                    ? cleanResponseText(rawText) 
                    : (data?.summary?.trim() || "I couldn't find any documents matching your query. Please try rephrasing or check if documents are available.");
                  
                  // Log if text is empty to help debug
                  if (!finalText || finalText.trim().length === 0) {
                    console.error('❌ SideChatPanel: finalText is empty!', {
                      displayedTextLength: displayedText.length,
                      dataSummaryLength: data?.summary?.length || 0,
                      accumulatedTextLength: accumulatedText.length,
                      rawTextLength: rawText.length,
                      finalTextLength: finalText.length
                    });
                  }
                  
                  // Use citations from complete event, fallback to accumulated citations
                  // Ensure all citation keys are strings (backend may send mixed types)
                  const normalizeCitations = (cits: any): Record<string, CitationDataType> => {
                    if (!cits || typeof cits !== 'object') return {};
                    const normalized: Record<string, CitationDataType> = {};
                    for (const [key, value] of Object.entries(cits)) {
                      normalized[String(key)] = value as CitationDataType;
                    }
                    return normalized;
                  };
                  
                  const finalCitations = normalizeCitations(data.citations || accumulatedCitations || {});
                  
                  console.log('✅ SideChatPanel: finalizeText called:', {
                    finalTextLength: finalText.length,
                    finalTextPreview: finalText.substring(0, 200) || 'N/A',
                    usedDisplayedText: !!displayedText,
                    usedDataSummary: !displayedText && !!data?.summary,
                    usedAccumulatedText: !displayedText && !data?.summary && !!accumulatedText,
                    citationsCount: Object.keys(finalCitations).length,
                    loadingResponseId: loadingResponseId,
                    chatIsActive
                  });
                  
                  if (chatIsActive) {
                    // Hide bot status overlay when streaming completes
                    // BUT keep it visible in agent mode if navigation task or document opening is in progress
                    if (!isAgentModeRef.current || (!isNavigatingTaskRef.current && !isOpeningDocumentRef.current)) {
                      setIsBotActive(false);
                    }
                    
                    // Clear resume processing ref when query completes
                    resumeProcessingRef.current = null;
                    
                    // Set the complete formatted text
                    setChatMessages(prev => {
                      const existingMessage = prev.find(msg => msg.id === loadingResponseId);
                      console.log('✅ SideChatPanel: setChatMessages - before update:', {
                        prevCount: prev.length,
                        existingMessageId: existingMessage?.id,
                        existingMessageText: existingMessage?.text?.substring(0, 50) || 'N/A',
                        loadingResponseId: loadingResponseId,
                        allMessageIds: prev.map(m => m.id),
                        finalTextLength: finalText.length,
                        finalTextPreview: finalText.substring(0, 100)
                      });
                      
                      // CRITICAL: If message not found, create it (shouldn't happen but safety check)
                      if (!existingMessage) {
                        console.warn('⚠️ SideChatPanel: Loading message not found, creating new response message');
                        const newResponseMessage: ChatMessage = {
                          id: loadingResponseId,
                          type: 'response',
                          text: finalText || 'Response received',
                          isLoading: false,
                          reasoningSteps: [],
                          citations: finalCitations
                        };
                        const updated = [...prev, newResponseMessage];
                        persistedChatMessagesRef.current = updated;
                        console.log('✅ SideChatPanel: Created new response message:', {
                          id: newResponseMessage.id,
                          textLength: newResponseMessage.text.length,
                          textPreview: newResponseMessage.text.substring(0, 100)
                        });
                        return updated;
                      }
                      
                      const responseMessage: ChatMessage = {
                        id: loadingResponseId,
                        type: 'response',
                        text: finalText || 'Response received', // Ensure text is never empty
                        isLoading: false,
                        reasoningSteps: existingMessage?.reasoningSteps || [], // Preserve reasoning steps
                        citations: finalCitations // Use final citations (normalized to string keys)
                      };
                      
                      const updated = prev.map(msg => 
                        msg.id === loadingResponseId 
                          ? responseMessage
                          : msg
                      );
                      
                      // Verify the update worked
                      const updatedMessage = updated.find(msg => msg.id === loadingResponseId);
                      if (!updatedMessage || updatedMessage.text !== responseMessage.text) {
                        console.error('❌ SideChatPanel: Message update failed!', {
                          found: !!updatedMessage,
                          textMatch: updatedMessage?.text === responseMessage.text,
                          expectedText: responseMessage.text.substring(0, 50),
                          actualText: updatedMessage?.text?.substring(0, 50)
                        });
                      }
                      
                      console.log('✅ SideChatPanel: setChatMessages - after update:', {
                        updatedCount: updated.length,
                        responseMessageId: responseMessage.id,
                        responseMessageText: responseMessage.text.substring(0, 100),
                        responseMessageIsLoading: responseMessage.isLoading,
                        foundInUpdated: updatedMessage?.text?.substring(0, 50) || 'NOT FOUND',
                        verified: updatedMessage?.text === responseMessage.text
                      });
                      
                      persistedChatMessagesRef.current = updated;
                      return updated;
                    });
                  } else if (queryChatId) {
                    // Chat is inactive - buffer the complete message
                    const bufferedState = getBufferedState(queryChatId);
                    const existingMessage = bufferedState.messages.find(msg => msg.id === loadingResponseId) || 
                      chatMessages.find(msg => msg.id === loadingResponseId);
                    
                    const responseMessage: ChatMessage = {
                      id: loadingResponseId,
                      type: 'response',
                      text: finalText || 'Response received',
                      isLoading: false,
                      reasoningSteps: existingMessage?.reasoningSteps || [],
                      citations: finalCitations
                    };
                    
                    // Update buffered messages
                    const updatedMessages = bufferedState.messages.map(msg => 
                      msg.id === loadingResponseId ? responseMessage : msg
                    );
                    if (!updatedMessages.find(msg => msg.id === loadingResponseId)) {
                      updatedMessages.push(responseMessage);
                    }
                    
                    bufferedState.messages = updatedMessages;
                    bufferedState.accumulatedText = accumulatedText;
                    bufferedState.status = 'completed';
                    bufferedState.isLoading = false;
                    bufferedState.citations = finalCitations;
                    bufferedState.lastUpdate = Date.now();
                    
                    console.log('💾 SideChatPanel: Buffered complete message for inactive chat (query prop):', queryChatId);
                  }
                
                // Get the most up-to-date reasoning steps for history
                // For active chats, always use the current chatMessages state (most up-to-date)
                // For inactive chats, use buffered state
                let latestReasoningStepsForHistory: ReasoningStep[] = [];
                if (chatIsActive) {
                  // Active chat - use current UI state (most reliable)
                  const activeMessageForHistory = chatMessages.find(msg => msg.id === loadingResponseId);
                  latestReasoningStepsForHistory = activeMessageForHistory?.reasoningSteps || [];
                } else if (queryChatId) {
                  // Inactive chat - use buffered state
                  const bufferedStateForHistory = getBufferedState(queryChatId);
                  const bufferedMessageForHistory = bufferedStateForHistory.messages.find(msg => msg.id === loadingResponseId);
                  if (bufferedMessageForHistory?.reasoningSteps && bufferedMessageForHistory.reasoningSteps.length > 0) {
                    latestReasoningStepsForHistory = bufferedMessageForHistory.reasoningSteps;
                  } else if (bufferedStateForHistory.reasoningSteps.length > 0) {
                    latestReasoningStepsForHistory = bufferedStateForHistory.reasoningSteps;
                  } else {
                    // Fallback to current chatMessages (might have some steps)
                    const activeMessageForHistory = chatMessages.find(msg => msg.id === loadingResponseId);
                    latestReasoningStepsForHistory = activeMessageForHistory?.reasoningSteps || [];
                  }
                } else {
                  // No queryChatId - use current state
                  // CRITICAL: Use chatMessagesRef.current to avoid stale closure issues
                  const activeMessageForHistory = chatMessagesRef.current.find(msg => msg.id === loadingResponseId);
                  latestReasoningStepsForHistory = activeMessageForHistory?.reasoningSteps || [];
                }
                
                // Always update chat history and status
                // CRITICAL: Use chatMessagesRef.current to avoid stale closure issues
                if (queryChatId) {
                  const currentMessages = chatMessagesRef.current;
                  const finalMessages = chatIsActive ? currentMessages.map(msg => 
                    msg.id === loadingResponseId 
                      ? {
                          role: 'assistant' as 'user' | 'assistant',
                          content: finalText,
                          citations: finalCitations,
                          reasoningSteps: latestReasoningStepsForHistory.length > 0 ? latestReasoningStepsForHistory : (msg.reasoningSteps || []),
                          isLoading: false
                        }
                      : {
                          role: (msg.type === 'query' ? 'user' : 'assistant') as 'user' | 'assistant',
                          content: msg.text || '',
                          attachments: msg.attachments || [],
                          propertyAttachments: msg.propertyAttachments || [],
                          citations: msg.citations || {},
                          reasoningSteps: msg.reasoningSteps || [],
                          isLoading: msg.isLoading
                        }
                  ) : (getBufferedState(queryChatId).messages.map(msg => {
                    const role = msg.type === 'query' ? 'user' : 'assistant';
                    const msgReasoningSteps = msg.id === loadingResponseId 
                      ? (latestReasoningStepsForHistory.length > 0 ? latestReasoningStepsForHistory : (msg.reasoningSteps || []))
                      : (msg.reasoningSteps || []);
                    return {
                      role: role as 'user' | 'assistant',
                      content: msg.text || '',
                      attachments: msg.attachments || [],
                      propertyAttachments: msg.propertyAttachments || [],
                      citations: msg.citations || {},
                      reasoningSteps: msgReasoningSteps,
                      isLoading: msg.isLoading
                    };
                  }));
                  
                  updateChatInHistory(queryChatId, finalMessages);
                  updateChatStatus(queryChatId, 'completed');
                  
                  // Clean up abort controller
                  delete abortControllersRef.current[queryChatId];
                  console.log('✅ [HISTORY_SAVE] Final save on complete (query path):', { chatId: queryChatId, messageCount: finalMessages.length, hasContent: finalMessages.some(m => m.content && m.content.trim().length > 0) });
                }
              };
                
                // Wait for queue to finish processing (max 3 seconds), then finalize
                const maxWait = 2000;
                const checkInterval = 100;
                let waited = 0;
                const checkQueue = setInterval(() => {
                  waited += checkInterval;
                  if (!isProcessingQueue && blockQueue.length === 0 && !tokenBuffer.trim() && !pendingBuffer.trim()) {
                    clearInterval(checkQueue);
                    finalizeText();
                  } else if (waited >= maxWait) {
                    clearInterval(checkQueue);
                    finalizeText();
                  }
                }, checkInterval);
              },
              // onError: Handle errors
              (error: string) => {
              // Categorize error types for better handling
              const isNetworkError = error.includes('ERR_INCOMPLETE_CHUNKED_ENCODING') || 
                                    error.includes('Connection interrupted') ||
                                    error.includes('Failed to fetch') ||
                                    error.includes('network error');
              
              // Log network errors as warnings (less severe), others as errors
              if (isNetworkError) {
                console.warn('⚠️ SideChatPanel: Network error during streaming:', error);
              } else {
                console.error('❌ SideChatPanel: Streaming error:', error);
              }
              
              // Use unified helper for consistent chat active check
              const chatIsActive = isChatActiveForQuery(queryChatId, savedChatId);
                
                // Always update chat status to 'completed' even on error
                if (queryChatId) {
                  updateChatStatus(queryChatId, 'completed');
                  // Clean up abort controller
                  delete abortControllersRef.current[queryChatId];
                }
                
                // Check if this is an attachment without query error
                // Note: documentIdsArray is defined in the parent scope
                const hasAttachments = attachedFiles.length > 0 || (documentIdsArray && documentIdsArray.length > 0);
                const isQueryRequiredError = error.includes('Query is required') || 
                                           error.includes('HTTP 400') || 
                                           error.includes('BAD REQUEST');
                const isEmptyQuery = !queryText || queryText.trim() === '';
                
                let errorText: string;
                if (hasAttachments && (isQueryRequiredError || isEmptyQuery)) {
                  // Show helpful prompt for attachments without query
                  errorText = `I see you've attached a file, but I need a question to help you with it. Please tell me what you'd like to know about the document.`;
                } else if (isNetworkError) {
                  // Show user-friendly message for network errors
                  errorText = 'Connection was interrupted. Please try again.';
                } else {
                  // Show generic error for other cases
                  errorText = error || 'Sorry, I encountered an error processing your query.';
                }
                
                if (chatIsActive) {
                  // Hide bot status overlay on error (only if active)
                  setIsBotActive(false);
                  
                  // Clear resume processing ref on error
                  resumeProcessingRef.current = null;
                  
                  setChatMessages(prev => {
                    const existingMessage = prev.find(msg => msg.id === loadingResponseId);
                    const errorMessage: ChatMessage = {
                      id: loadingResponseId,
                      type: 'response',
                      text: errorText,
                      isLoading: false,
                      reasoningSteps: existingMessage?.reasoningSteps || [] // Preserve reasoning steps
                    };
                    
                    const updated = prev.map(msg => 
                      msg.id === loadingResponseId 
                        ? errorMessage
                        : msg
                    );
                    persistedChatMessagesRef.current = updated;
                    return updated;
                  });
                } else if (queryChatId) {
                  // Chat is inactive - buffer error message
                  const bufferedState = getBufferedState(queryChatId);
                  const existingMessage = bufferedState.messages.find(msg => msg.id === loadingResponseId) || 
                    chatMessages.find(msg => msg.id === loadingResponseId);
                  
                  const errorMessage: ChatMessage = {
                    id: loadingResponseId,
                    type: 'response',
                    text: errorText,
                    isLoading: false,
                    reasoningSteps: existingMessage?.reasoningSteps || []
                  };
                  
                  const updatedMessages = bufferedState.messages.map(msg => 
                    msg.id === loadingResponseId ? errorMessage : msg
                  );
                  if (!updatedMessages.find(msg => msg.id === loadingResponseId)) {
                    updatedMessages.push(errorMessage);
                  }
                  bufferedState.messages = updatedMessages;
                  bufferedState.status = 'completed';
                  bufferedState.isLoading = false;
                  bufferedState.lastUpdate = Date.now();
                }
              },
              undefined, // onStatus (optional)
              queryPropFileAbortController.signal, // abortSignal - pass abort signal for cleanup
              documentIdsArray, // documentIds
              // onReasoningStep: Handle reasoning step events
              (step: { step: string; action_type?: string; message: string; count?: number; details: any }) => {
                // Use unified helper for consistent chat active check
                const chatIsActive = isChatActiveForQuery(queryChatId, savedChatId);
                
                // PRELOAD: Extract document IDs from reasoning steps and preload IMMEDIATELY (always, background operation)
                // This happens BEFORE citations arrive, making documents ready instantly
                // Priority: doc_previews (earliest, from found_documents step) > doc_metadata > documents array
                if (step.details) {
                  // PRIORITY 1: doc_previews (from found_documents/exploring steps - earliest available)
                  // This is sent as soon as documents are retrieved, before processing
                  if (step.details.doc_previews && Array.isArray(step.details.doc_previews)) {
                    step.details.doc_previews.forEach((doc: any) => {
                      if (doc.doc_id) {
                        // Preload immediately (fire and forget, no delays)
                        preloadDocumentById(doc.doc_id, doc.original_filename || doc.filename);
                      }
                    });
                  }
                  
                  // PRIORITY 2: doc_metadata (from reading steps - happens after found_documents)
                  if (step.details.doc_metadata && step.details.doc_metadata.doc_id) {
                    const docId = step.details.doc_metadata.doc_id;
                    const filename = step.details.doc_metadata.original_filename || step.details.doc_metadata.filename;
                    preloadDocumentById(docId, filename);
                  }
                  
                  // PRIORITY 3: documents array (alternative format, fallback)
                  if (step.details.documents && Array.isArray(step.details.documents)) {
                    step.details.documents.forEach((doc: any) => {
                      if (doc.doc_id || doc.id) {
                        preloadDocumentById(doc.doc_id || doc.id, doc.original_filename || doc.filename);
                      }
                    });
                  }
                }
                
                const newStep: ReasoningStep = {
                  step: step.step,
                  action_type: (step.action_type as ReasoningStep['action_type']) || 'analysing',
                  message: step.message,
                  count: step.count,
                  details: step.details,
                  timestamp: Date.now()
                };
                
                if (chatIsActive) {
                  setChatMessages(prev => {
                    const updated = prev.map(msg => {
                      if (msg.id === loadingResponseId) {
                        const existingSteps = msg.reasoningSteps || [];
                        // Use step + message as unique key to allow different messages for same step type
                        // Also dedupe by timestamp proximity (within 500ms) to prevent duplicate emissions
                        const stepKey = `${step.step}:${step.message}`;
                        const now = Date.now();
                        const incomingDocId = step.action_type === 'reading'
                          ? (step.details?.doc_metadata?.doc_id ?? (step.details as any)?.doc_id)
                          : undefined;
                        const isDuplicate = existingSteps.some(s => {
                          if (incomingDocId && step.action_type === 'reading') {
                            const existingDocId = s.details?.doc_metadata?.doc_id ?? (s.details as any)?.doc_id;
                            if (s.action_type === 'reading' && existingDocId === incomingDocId) return true;
                          }
                          return `${s.step}:${s.message}` === stepKey && (now - s.timestamp) < 500;
                        });
                        
                        // Skip if duplicate (same step+message recently, or reading step for same doc)
                        if (isDuplicate) {
                          return msg;
                        }
                        
                        // Add new step
                        return { ...msg, reasoningSteps: [...existingSteps, newStep] };
                      }
                      return msg;
                    });
                    persistedChatMessagesRef.current = updated;
                    return updated;
                  });
                } else if (queryChatId) {
                  // Chat is inactive - buffer reasoning step (with same reading+doc_id dedupe)
                  const bufferedState = getBufferedState(queryChatId);
                  const existingBuffered = bufferedState.reasoningSteps || [];
                  const stepKey = `${step.step}:${step.message}`;
                  const now = Date.now();
                  const incomingDocId = step.action_type === 'reading'
                    ? (step.details?.doc_metadata?.doc_id ?? (step.details as any)?.doc_id)
                    : undefined;
                  const bufferedDuplicate = existingBuffered.some(s => {
                    if (incomingDocId && step.action_type === 'reading') {
                      const existingDocId = s.details?.doc_metadata?.doc_id ?? (s.details as any)?.doc_id;
                      if (s.action_type === 'reading' && existingDocId === incomingDocId) return true;
                    }
                    return `${s.step}:${s.message}` === stepKey && (now - s.timestamp) < 500;
                  });
                  if (!bufferedDuplicate) {
                    bufferedState.reasoningSteps.push(newStep);
                    bufferedState.lastReasoningStep = newStep;
                    bufferedState.lastUpdate = Date.now();
                    const existingMessage = bufferedState.messages.find(msg => msg.id === loadingResponseId) || 
                      chatMessages.find(msg => msg.id === loadingResponseId);
                    if (existingMessage) {
                      const existingSteps = existingMessage.reasoningSteps || [];
                      const isDup = existingSteps.some(s => {
                        if (incomingDocId && step.action_type === 'reading') {
                          const existingDocId = s.details?.doc_metadata?.doc_id ?? (s.details as any)?.doc_id;
                          if (s.action_type === 'reading' && existingDocId === incomingDocId) return true;
                        }
                        return `${s.step}:${s.message}` === stepKey && (now - s.timestamp) < 500;
                      });
                      if (!isDup) {
                        const updatedMessage = { ...existingMessage, reasoningSteps: [...existingSteps, newStep] };
                        const updatedMessages = bufferedState.messages.map(msg => 
                          msg.id === loadingResponseId ? updatedMessage : msg
                        );
                        if (!updatedMessages.find(msg => msg.id === loadingResponseId)) {
                          updatedMessages.push(updatedMessage);
                        }
                        bufferedState.messages = updatedMessages;
                      }
                    }
                  }
                }
                
                // Always update history (reasoning steps are part of messages)
                // CRITICAL: Use chatMessagesRef.current to avoid stale closure issues
                if (queryChatId) {
                  const currentMessages = chatMessagesRef.current;
                  const historyMessages = (chatIsActive ? currentMessages : (getBufferedState(queryChatId).messages)).map(msg => ({
                    role: msg.type === 'query' ? 'user' : 'assistant',
                    content: msg.text || '',
                    attachments: msg.attachments || [],
                    propertyAttachments: msg.propertyAttachments || [],
                    citations: msg.citations || {},
                    reasoningSteps: msg.reasoningSteps || [],
                    isLoading: msg.isLoading
                  }));
                  updateChatInHistory(queryChatId, historyMessages);
                }
              },
              // onReasoningContext: Handle LLM-generated contextual narration
              (context: { message: string; moment: string }) => {
                console.log('🟢 SideChatPanel: Received reasoning context:', context);
                
                // Use unified helper for consistent chat active check
                const chatIsActive = isChatActiveForQuery(queryChatId, savedChatId);
                
                const contextStep: ReasoningStep = {
                  step: `context_${context.moment}`,
                  action_type: 'context',
                  message: context.message,
                  details: { moment: context.moment },
                  timestamp: Date.now()
                };
                
                if (chatIsActive) {
                  setChatMessages(prev => {
                    const updated = prev.map(msg => {
                      if (msg.id === loadingResponseId) {
                        const existingSteps = msg.reasoningSteps || [];
                        return { ...msg, reasoningSteps: [...existingSteps, contextStep] };
                      }
                      return msg;
                    });
                    persistedChatMessagesRef.current = updated;
                    return updated;
                  });
                } else if (queryChatId) {
                  // Chat is inactive - buffer reasoning context
                  const bufferedState = getBufferedState(queryChatId);
                  bufferedState.reasoningSteps.push(contextStep);
                  bufferedState.lastReasoningStep = contextStep;
                  bufferedState.lastUpdate = Date.now();
                  
                  // Update buffered messages
                  const existingMessage = bufferedState.messages.find(msg => msg.id === loadingResponseId) || 
                    chatMessages.find(msg => msg.id === loadingResponseId);
                  
                  if (existingMessage) {
                    const existingSteps = existingMessage.reasoningSteps || [];
                    const updatedMessage = { ...existingMessage, reasoningSteps: [...existingSteps, contextStep] };
                    const updatedMessages = bufferedState.messages.map(msg => 
                      msg.id === loadingResponseId ? updatedMessage : msg
                    );
                    if (!updatedMessages.find(msg => msg.id === loadingResponseId)) {
                      updatedMessages.push(updatedMessage);
                    }
                    bufferedState.messages = updatedMessages;
                  }
                }
              },
              // onCitation: Handle citation events during streaming
              (citation: { citation_number: string | number; data: any }) => {
                // Convert citation_number to string (backend may send as int)
                const citationNumStr = String(citation.citation_number);
                
                // Accumulate citation with all fields from backend
                // CRITICAL: Ensure bbox structure matches CitationDataType interface
                const citationBbox = citation.data.bbox;
                let normalizedBbox: { left: number; top: number; width: number; height: number; page?: number } | null = null;
                
                if (citationBbox && typeof citationBbox === 'object') {
                  // Validate bbox has required fields
                  if (typeof citationBbox.left === 'number' && 
                      typeof citationBbox.top === 'number' && 
                      typeof citationBbox.width === 'number' && 
                      typeof citationBbox.height === 'number') {
                    normalizedBbox = {
                      left: citationBbox.left,
                      top: citationBbox.top,
                      width: citationBbox.width,
                      height: citationBbox.height,
                      page: citationBbox.page ?? citation.data.page ?? citation.data.page_number
                    };
                  } else {
                    console.warn('⚠️ [CITATION] Invalid bbox structure in citation data:', citationBbox);
                  }
                }
                
                // Ensure bbox always has required fields (even if invalid)
                const finalBbox = normalizedBbox || { 
                  left: 0, 
                  top: 0, 
                  width: 0, 
                  height: 0 
                };
                
                const docId = citation.data.doc_id ?? citation.data.document_id;
                const pageNum = citation.data.page ?? citation.data.page_number ?? 0;
                accumulatedCitations[citationNumStr] = {
                  doc_id: docId,
                  page: pageNum,
                  bbox: finalBbox, // Use normalized bbox or default empty bbox
                  method: citation.data.method, // Include method field
                  block_id: citation.data.block_id, // Include block_id for debugging and validation
                  original_filename: citation.data.original_filename, // Include filename for preloading
                  cited_text: citation.data.cited_text
                };
                // Preload citation preview so pop-up loads fast when user clicks
                if (docId && pageNum) {
                  preloadHoverPreview(docId, pageNum).catch(() => {});
                }
                // Always accumulate citations in buffer (for inactive chats)
                if (queryChatId) {
                  const bufferedState = getBufferedState(queryChatId);
                  bufferedState.citations[citationNumStr] = accumulatedCitations[citationNumStr];
                  bufferedState.lastUpdate = Date.now();
                }
                
                // PRELOAD: Start downloading document in background when citation received (always, background operation)
                // This ensures documents are ready when user clicks citation (instant BBOX highlight)
                // Note: Documents may already be preloaded from reasoning steps, but this is a fallback
                if (docId) {
                  // Use the shared preload function (handles deduplication)
                  preloadDocumentById(docId, citation.data.original_filename);
                          
                          // OPTIMIZATION: Aggressively pre-render citation pages immediately
                          // Since probability of clicking citations is extremely high, start pre-rendering ASAP
                          if (citation.data.page && preloadPdfPage && getCachedPdfDocument) {
                            // Start pre-rendering immediately - don't wait
                            (async () => {
                              try {
                                // Try to get PDF immediately (might be cached from previous load)
                                let pdf = getCachedPdfDocument(docId);
                                
                                if (!pdf) {
                                  // PDF not loaded yet - wait for it to load, but start checking immediately
                                  // Poll more aggressively for faster response
                                  const maxAttempts = 20; // Check for up to 2 seconds (20 * 100ms)
                                  let attempts = 0;
                                  
                                  while (!pdf && attempts < maxAttempts) {
                                    await new Promise(resolve => setTimeout(resolve, 100));
                                    pdf = getCachedPdfDocument(docId);
                                    attempts++;
                                  }
                                }
                                
                                if (pdf) {
                                  // PDF is ready - pre-render the page immediately
                                  await preloadPdfPage(docId, citation.data.page, pdf, 1.0);
                                } else {
                                  console.warn('⚠️ [PRELOAD] PDF not available after waiting, will retry when document opens');
                                }
                              } catch (error) {
                                console.warn('⚠️ [PRELOAD] Failed to pre-render page:', error);
                              }
                            })(); // Fire and forget - don't block
                  }
                }
                
                // Update message with citations in real-time (only if chat is active)
                // Use unified helper for consistent chat active check
                const chatIsActive = isChatActiveForQuery(queryChatId, savedChatId);
                if (chatIsActive) {
                  // Merge with previous citations to avoid overwriting when multiple citations arrive quickly
                  setChatMessages(prev => {
                    return prev.map(msg => 
                      msg.id === loadingResponseId
                        ? {
                            ...msg,
                            citations: { ...(msg.citations || {}), ...accumulatedCitations }
                          }
                        : msg
                    );
                  });
                }
              },
              undefined, // onExecutionEvent
              citationContext || undefined, // citationContext (from citation click)
              responseMode, // responseMode (from file choice)
              attachmentContext, // attachmentContext (extracted text from files)
              // AGENT-NATIVE: Handle agent actions (open document, highlight, navigate, save)
              (action: { action: string; params: any }) => {
                console.log('🎯 [AGENT_ACTION] Received action:', action);
                
                // Use unified helper for consistent chat active check
                const chatIsActive = isChatActiveForQuery(queryChatId, savedChatId);
                // STRICT: Verify this query's chat is the currently active one (prevents race conditions)
                const isCorrectChat = queryChatId === activeChatIdRef.current;
                
                // Skip agent actions in reader mode - just show citations without auto-opening
                // Use ref to get current mode value (avoids closure issues)
                if (!isAgentModeRef.current) {
                  console.log('📖 [READER_MODE] Skipping agent action - reader mode active');
                  return;
                }
                
                console.log('✅ [AGENT_MODE] Executing agent action:', action.action, { chatIsActive, isCorrectChat, queryChatId, activeChat: activeChatIdRef.current });
                
                // Buffer agent action for inactive chats OR if chat ownership mismatch
                if ((!chatIsActive || !isCorrectChat) && queryChatId) {
                  const bufferedState = getBufferedState(queryChatId);
                  bufferedState.activeAgentAction = {
                    action: action.action,
                    params: action.params,
                    timestamp: Date.now()
                  };
                  bufferedState.lastUpdate = Date.now();
                  console.log('💾 SideChatPanel: Buffered agent action for inactive chat (query prop):', action.action);
                }
                
                switch (action.action) {
                  case 'open_document':
                    // SKIP opening document if we're navigating to a property
                    // Navigation queries should not open documents - they should just navigate
                    if (isNavigatingTaskRef.current) {
                      console.log('⏭️ [AGENT_ACTION] Skipping open_document - navigation in progress');
                      break;
                    }
                    
                    // Open document viewer with the specified document
                    // handleCitationClick already handles opening and highlighting
                    // bbox is now included in open_document action (no separate highlight_bbox)
                    console.log('📂 [AGENT_ACTION] Opening document:', action.params.doc_id, 'page:', action.params.page, 'bbox:', action.params.bbox);
                    if (action.params.doc_id) {
                      if (chatIsActive && isCorrectChat) {
                        // AGENT GLOW: Activate glowing border effect before opening
                        setIsAgentOpening(true);
                        // Keep bot overlay visible during document opening
                        isOpeningDocumentRef.current = true;
                        setBotActivityMessage('Opening document...');
                        
                        // Use the citation data from the backend action directly
                        const citationData = {
                          doc_id: action.params.doc_id,
                          page: action.params.page || 1,
                          original_filename: action.params.filename || '',
                          bbox: action.params.bbox || undefined
                        };
                        
                        handleCitationClick(citationData as any, true); // fromAgentAction=true (backend emits reasoning step)
                      } else if (queryChatId) {
                        // Chat is inactive - store document preview in ChatStateStore
                        // This allows the document to be pre-opened when user returns to this chat
                        // Ensure page is inside bbox for consistent CitationHighlight structure
                        const bboxWithPage = action.params.bbox ? {
                          ...action.params.bbox,
                          page: action.params.bbox.page || action.params.page || 1
                        } : undefined;
                        const docPreview = {
                          docId: action.params.doc_id,
                          filename: action.params.filename || '',
                          highlight: bboxWithPage ? {
                            fileId: action.params.doc_id,
                            bbox: bboxWithPage,
                            doc_id: action.params.doc_id,
                            block_id: action.params.block_id || '',
                            block_content: action.params.block_content || '',
                            original_filename: action.params.filename || ''
                          } : undefined
                        };
                        // Store in ChatStateStore (will be displayed when user switches to this chat)
                        openDocumentForChat(queryChatId, docPreview);
                        console.log('💾 SideChatPanel: Stored document preview in ChatStateStore for inactive chat:', { chatId: queryChatId, docPreview });
                      }
                    }
                    break;
                    
                  case 'highlight_bbox':
                    // Legacy: highlight_bbox is now combined into open_document
                    // This case is kept for backwards compatibility
                    console.log('⚠️ [AGENT_ACTION] Legacy highlight_bbox received - should use open_document with bbox instead');
                    break;
                    
                  case 'navigate_to_property':
                    if (chatIsActive && isCorrectChat) {
                      // Navigate to property details panel
                      // CRITICAL: Close document preview immediately when navigating to property
                      // This prevents old content from remaining visible during navigation
                      console.log('🧭 [AGENT_ACTION] navigate_to_property received - closing preview and navigating');
                      // Set navigation flag to prevent fullscreen restoration
                      isNavigatingTaskRef.current = true;
                      wasFullscreenBeforeCitationRef.current = false;
                      // IMMEDIATELY close any open document preview to clear old content
                      closeExpandedCardView();
                      documentPreviewOwnerRef.current = null;
                      // Update bot status to show navigation activity
                      setBotActivityMessage('Navigating...');
                      if (action.params.property_id && onOpenProperty) {
                        onOpenProperty(null, null, action.params.property_id);
                      }
                    }
                    // If inactive, action is already buffered above
                    break;
                  
                  case 'show_map_view':
                    // Open the map view - SEQUENCED FLOW:
                    // Step 1: IMMEDIATELY close any open document preview and prevent fullscreen restoration
                    // Step 2: Wait for "Sure thing!" to appear (delay to let response stream)
                    // Step 3: Shrink chat panel (map is already visible behind fullscreen chat)
                    // NOTE: Do NOT call onMapToggle() - that hides the chat!
                    console.log('🗺️ [AGENT_ACTION] show_map_view received - queuing for sequenced execution:', action.params);
                    
                    // CRITICAL: Reset fullscreen restoration flag BEFORE closing document preview
                    // This prevents the useEffect from restoring fullscreen when expandedCardViewDoc becomes null
                    wasFullscreenBeforeCitationRef.current = false;
                    isFullscreenFromDashboardRef.current = false;
                    
                    // Mark as navigation task IMMEDIATELY to prevent any fullscreen re-expansion
                    isNavigatingTaskRef.current = true;
                    
                    // Update bot status to show navigation activity
                    setBotActivityMessage('Navigating...');
                    
                    // Close any open document preview (now it won't trigger fullscreen restoration)
                    closeExpandedCardView();
                    
                    // Exit fullscreen mode IMMEDIATELY (don't wait for setTimeout)
                    setIsFullscreenMode(false);
                    
                    // Delay to let "Sure thing!" response appear first, then shrink chat
                    setTimeout(() => {
                      console.log('🗺️ [AGENT_ACTION] show_map_view - Step 2: Shrinking chat panel to reveal map');
                      // Shrink chat panel - map will be visible behind it
                      const navMinWidth = CHAT_PANEL_WIDTH.NAV_MIN;
                      setDraggedWidth(navMinWidth);
                      lockedWidthRef.current = null;
                      if (onChatWidthChange) {
                        onChatWidthChange(navMinWidth);
                      }
                      // Map is already rendered behind the chat - shrinking reveals it
                      // Do NOT call onMapToggle() as that hides the chat panel
                    }, 600); // Wait 600ms for "Sure thing!" to appear
                    break;
                  
                  case 'select_property_pin':
                    // Select a property pin on the map - SEQUENCED FLOW:
                    // Step 1: IMMEDIATELY close document preview and prevent fullscreen restoration
                    // Step 2: Wait for "Navigating to property now..." and reasoning step to appear
                    // Step 3: Activate overlay
                    // Step 4: Navigate to pin
                    // Step 5: Click pin and stop overlay
                    console.log('📍 [AGENT_ACTION] select_property_pin received - queuing for sequenced execution:', action.params);
                    
                    // CRITICAL: Reset fullscreen restoration flags IMMEDIATELY
                    // This prevents the useEffect from restoring fullscreen when expandedCardViewDoc becomes null
                    wasFullscreenBeforeCitationRef.current = false;
                    isFullscreenFromDashboardRef.current = false;
                    
                    // Mark as navigation task IMMEDIATELY to prevent any fullscreen re-expansion
                    isNavigatingTaskRef.current = true;
                    
                    // Close any open document preview IMMEDIATELY (now it won't trigger fullscreen restoration)
                    closeExpandedCardView();
                    
                    // Exit fullscreen mode IMMEDIATELY
                    setIsFullscreenMode(false);
                    
                    // Delay to let "Navigating to property now..." and reasoning step appear
                    setTimeout(() => {
                      console.log('📍 [AGENT_ACTION] select_property_pin - Step 2: Activating overlay');
                      // Activate agent task overlay
                      setAgentTaskActive(true, 'Navigating to property...');
                      setMapNavigating(true); // Enable map glow effect
                      // Ensure chat is shrunk (in case show_map_view didn't fire)
                      const pinNavMinWidth = CHAT_PANEL_WIDTH.NAV_MIN;
                      setDraggedWidth(pinNavMinWidth);
                      lockedWidthRef.current = null;
                      if (onChatWidthChange) {
                        onChatWidthChange(pinNavMinWidth);
                      }
                      
                      // Step 3: Navigate to pin after overlay is visible
                      setTimeout(() => {
                        console.log('📍 [AGENT_ACTION] select_property_pin - Step 3: Navigating to pin');
                        if (action.params.property_id && onOpenProperty) {
                          const coords = action.params.latitude && action.params.longitude 
                            ? { lat: action.params.latitude, lng: action.params.longitude }
                            : undefined;
                          // Pass navigationOnly=true to just show title card, not full panel
                          onOpenProperty(action.params.address || null, coords || null, action.params.property_id, true);
                          
                          // Step 4: Deactivate overlay after pin is clicked
                          setTimeout(() => {
                            console.log('📍 [AGENT_ACTION] select_property_pin - Step 4: Stopping overlay');
                            setAgentTaskActive(false);
                            setMapNavigating(false);
                            setIsBotActive(false); // Hide bot status overlay when navigation completes
                            // NOTE: Don't reset isNavigatingTaskRef here - it prevents fullscreen re-expansion
                            // Will be reset when next query starts
                          }, 1000);
                        }
                      }, 500);
                    }, 800); // Wait 800ms for reasoning step to appear
                    break;
                  
                  case 'search_property_result':
                    // Property search completed - store result for subsequent actions
                    console.log('🔍 [AGENT_ACTION] search_property_result received:', action.params);
                    // Store in window for subsequent actions to use
                    (window as any).__lastPropertySearchResult = action.params;
                    break;
                    
                  case 'save_to_writing':
                    // Save citation to curated writing collection
                    if (action.params.citation) {
                      const curatedKey = 'curated_writing_citations';
                      const existing = JSON.parse(localStorage.getItem(curatedKey) || '[]');
                      const newEntry = {
                        id: `citation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        citation: action.params.citation,
                        addedAt: new Date().toISOString(),
                        documentName: action.params.citation.original_filename || 'Unknown document',
                        content: action.params.citation.block_content || action.params.note || ''
                      };
                      existing.push(newEntry);
                      localStorage.setItem(curatedKey, JSON.stringify(existing));
                      console.log('📚 [AGENT_ACTION] Saved citation to writing:', newEntry);
                      
                      // Dispatch event for UI updates
                      window.dispatchEvent(new CustomEvent('citation-added-to-writing', {
                        detail: newEntry
                      }));
                    }
                    break;
                  
                  case 'prepare_document':
                    // EARLY DOCUMENT PREPARATION: Download and cache document BEFORE answer is generated
                    // This happens WHILE the LLM is still generating the answer, so the document
                    // will be fully cached and ready for INSTANT display when open_document action comes
                    console.log('📥 [AGENT_ACTION] prepare_document - pre-loading document:', action.params.doc_id);
                    if (action.params.doc_id) {
                      const docId = action.params.doc_id;
                      const filename = action.params.filename || 'document.pdf';
                      
                      // Check if already cached - skip if so
                      const alreadyCached = (window as any).__preloadedDocumentBlobs?.[docId];
                      if (alreadyCached) {
                        console.log('✅ [EARLY_PREP] Document already cached, skipping:', docId.substring(0, 8) + '...');
                        break;
                      }
                      
                      // Actually download the document in background (not just HEAD request!)
                      (async () => {
                        try {
                          const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
                          const downloadUrl = `${backendUrl}/api/files/download?document_id=${docId}`;
                          
                          console.log('📥 [EARLY_PREP] Starting background download:', docId.substring(0, 8) + '...');
                          const response = await fetch(downloadUrl, { credentials: 'include' });
                          
                          if (!response.ok) {
                            console.warn('⚠️ [EARLY_PREP] Failed to download:', response.status);
                            return;
                          }
                          
                          const blob = await response.blob();
                          const url = URL.createObjectURL(blob);
                          
                          // Cache the blob URL for instant use when open_document comes
                          if (!(window as any).__preloadedDocumentBlobs) {
                            (window as any).__preloadedDocumentBlobs = {};
                          }
                          (window as any).__preloadedDocumentBlobs[docId] = {
                            url,
                            type: blob.type || 'application/pdf',
                            filename,
                            timestamp: Date.now()
                          };
                          
                          // Also preload into PreviewContext for StandaloneExpandedCardView
                          const file = new File([blob], filename, { type: blob.type || 'application/pdf' });
                          const fileData: FileAttachmentData = {
                            id: docId,
                            file,
                            name: filename,
                            type: blob.type || 'application/pdf',
                            size: blob.size
                          };
                          preloadFile(fileData);
                          
                          console.log('✅ [EARLY_PREP] Document fully cached and ready:', docId.substring(0, 8) + '...', blob.size, 'bytes');
                        } catch (e) {
                          console.warn('⚠️ [EARLY_PREP] Background download failed:', e);
                          // Ignore errors - this is just optimization
                        }
                      })();
                    }
                    break;
                    
                  default:
                    console.warn('Unknown agent action:', action.action);
                }
              },
              isAgentModeRef.current, // Pass agent mode to backend for tool-based actions
              selectedModelRef.current, // Pass selected model to backend
              // onThinkingChunk: Stream Claude's extended thinking in real-time
              (chunk: string) => {
                setChatMessages(prev => prev.map(msg => {
                  if (msg.id === loadingResponseId) {
                    // Find the thinking step and update its content
                    const updatedSteps = (msg.reasoningSteps || []).map(step => {
                      if (step.action_type === 'thinking') {
                        return {
                          ...step,
                          details: {
                            ...step.details,
                            thinking_content: (step.details?.thinking_content || '') + chunk
                          }
                        };
                      }
                      return step;
                    });
                    return { ...msg, reasoningSteps: updatedSteps };
                  }
                  return msg;
                }));
              },
              // onThinkingComplete: Finalize thinking content
              (fullThinking: string) => {
                console.log('🧠 Extended thinking complete:', fullThinking.length, 'chars');
              }
            );
          } catch (error: any) {
            isProcessingQueryRef.current = false;
            if (error.name === 'AbortError') {
              console.log('Query aborted');
              return;
            }
            console.error('Error querying documents:', error);
            setChatMessages(prev => {
              const updated = prev.map(msg => 
                msg.id === loadingResponseId
                  ? { ...msg, text: 'Sorry, I encountered an error processing your query.', isLoading: false, reasoningSteps: msg.reasoningSteps || [] }
                  : msg
              );
              persistedChatMessagesRef.current = updated;
              return updated;
            });
          }
          // Reset processing flag when query completes
          isProcessingQueryRef.current = false;
        })();
      }
    }
  }, [query, initialContentSegments, isVisible, chatMessages, attachedFiles, initialAttachedFiles, propertyAttachments, selectedDocumentIds, hasExtractedAttachments, showFileChoiceAndWait, buildAttachmentContext, pendingSearchContentSegmentsRef]);
  
  const inputRef = React.useRef<SegmentInputHandle | null>(null);
  const atMentionAnchorRef = React.useRef<HTMLDivElement>(null);
  const restoreSelectionRef = React.useRef<(() => void) | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const contentAreaRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  
  // Track actual rendered width of panel for responsive design
  React.useEffect(() => {
    if (!panelRef.current) return;
    
    const updateWidth = () => {
      if (panelRef.current) {
        const width = panelRef.current.getBoundingClientRect().width;
        setActualPanelWidth(width);
      }
    };
    
    // Initial measurement
    updateWidth();
    
    // Observe width changes
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(panelRef.current);
    
    return () => {
      resizeObserver.disconnect();
    };
  }, [isVisible]);

  // Track actual input container width for button responsive design
  React.useEffect(() => {
    if (!chatInputContainerRef.current) return;
    
    const updateInputWidth = () => {
      if (chatInputContainerRef.current) {
        const width = chatInputContainerRef.current.getBoundingClientRect().width;
        setInputContainerWidth(width);
      }
    };
    
    // Initial measurement
    updateInputWidth();
    
    // Observe width changes
    const resizeObserver = new ResizeObserver(updateInputWidth);
    resizeObserver.observe(chatInputContainerRef.current);
    
    return () => {
      resizeObserver.disconnect();
    };
  }, [isVisible]);
  
  // Detect button row overflow and set collapse level
  // This measures actual content vs container width and progressively collapses buttons
  // Uses parent container width (actualPanelWidth) as the primary constraint
  React.useEffect(() => {
    const calculateCollapseLevel = () => {
      // Use actualPanelWidth as the primary constraint, accounting for padding
      // Empty state: 32px padding on each side (64px total), or 12px each side (24px) when narrow
      // Chat state: form has 32px padding + chat bar has 12px padding = 44px each side (88px total)
      
      // Calculate effective button row width based on panel width and padding
      const isNarrowPanel = actualPanelWidth < 320;
      const effectiveWidth = isNarrowPanel 
        ? actualPanelWidth - 36 // 12px padding + 6px margins
        : actualPanelWidth - 88; // 32px form padding + 12px bar padding each side
      
      // Calculate required width for different collapse levels based on actual button widths:
      // Level 0 (all labels): ModeSelector(~100) + Model(~100) + gap + Web(28) + Map(55) + Attach(70) + Voice(65) + gaps ≈ 450px
      // Level 1 (Map/Attach/Voice icons): ModeSelector(100) + Model(100) + Web(28) + Map(30) + Attach(26) + Voice(30) + gaps ≈ 350px
      // Level 2 (all icons): ModeSelector(40) + Model(40) + Web(28) + Map(30) + Attach(26) + Voice(30) + gaps ≈ 220px
      // Level 3 (hide Voice): ModeSelector(40) + Model(40) + Web(28) + Map(30) + Attach(26) + gaps ≈ 180px
      
      // Use effective button row width for thresholds
      if (effectiveWidth < 200) {
        setButtonCollapseLevel(3); // Hide Voice, very compact
      } else if (effectiveWidth < 280) {
        setButtonCollapseLevel(2); // All buttons icon-only including Model/Mode
      } else if (effectiveWidth < 380) {
        setButtonCollapseLevel(1); // Map, Attach, Voice icons only
      } else {
        setButtonCollapseLevel(0); // All labels shown
      }
    };
    
    // Initial calculation
    calculateCollapseLevel();
    
    // Also re-calculate on resize observer for any ref that exists
    const resizeObserver = new ResizeObserver(() => {
      // Use requestAnimationFrame for smooth updates
      requestAnimationFrame(calculateCollapseLevel);
    });
    
    // Observe both button rows if they exist
    if (buttonRowRef.current) {
      resizeObserver.observe(buttonRowRef.current);
    }
    if (emptyButtonRowRef.current) {
      resizeObserver.observe(emptyButtonRowRef.current);
    }
    
    return () => {
      resizeObserver.disconnect();
    };
  }, [isVisible, actualPanelWidth, inputContainerWidth, draggedWidth]);
  
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const initialScrollHeightRef = React.useRef<number | null>(null);
  const isDeletingRef = React.useRef(false);
  const autoScrollEnabledRef = React.useRef(true);
  const lastScrollHeightRef = React.useRef(0);
  
  // Track previous loading state to detect when response completes
  const prevLoadingRef = React.useRef(false);
  
  // Auto-scroll to bottom - uses scrollIntoView for reliable positioning
  const scrollToBottom = React.useCallback(() => {
    const contentArea = contentAreaRef.current;
    const messagesEnd = messagesEndRef.current;
    if (!contentArea || !autoScrollEnabledRef.current) return;
    
    // Use scrollIntoView on the anchor element for reliable positioning
    // This ensures the bottom content is visible above the chat bar
    if (messagesEnd) {
      messagesEnd.scrollIntoView({ behavior: 'instant', block: 'end' });
    } else {
      // Fallback to direct scrollTop
      contentArea.scrollTop = contentArea.scrollHeight;
    }
  }, []);
  
  // Detect manual scroll to disable auto-scroll temporarily
  React.useEffect(() => {
    const contentArea = contentAreaRef.current;
    if (!contentArea) return;
    
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = contentArea;
      // User is "near bottom" if within 200px of the bottom
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 200;
      autoScrollEnabledRef.current = isNearBottom;
    };
    
    contentArea.addEventListener('scroll', handleScroll, { passive: true });
    return () => contentArea.removeEventListener('scroll', handleScroll);
  }, []);
  
  // Main scroll effect - handles all scroll scenarios
  const hasLoadingMessage = chatMessages.some(msg => msg.isLoading);
  const latestMessageText = chatMessages[chatMessages.length - 1]?.text || '';
  
  // Track message count to detect new queries
  const prevMessageCountRef = React.useRef(chatMessages.length);
  
  React.useEffect(() => {
    const messageCountIncreased = chatMessages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = chatMessages.length;
    
    // Enable auto-scroll when a NEW query is sent (message count increases)
    if (messageCountIncreased && hasLoadingMessage) {
      const lastMsg = chatMessages[chatMessages.length - 1];
      if (lastMsg?.isLoading && !lastMsg?.text) {
        // New query just sent, enable auto-scroll
        autoScrollEnabledRef.current = true;
        // Scroll to show the new query
        requestAnimationFrame(() => {
          scrollToBottom();
        });
      }
    }
    
    // When loading completes, do a final scroll (if auto-scroll is enabled)
    if (prevLoadingRef.current && !hasLoadingMessage) {
      // Response just finished - ensure it's visible only if user hasn't scrolled away
      setTimeout(() => {
        if (autoScrollEnabledRef.current) {
          scrollToBottom();
        }
      }, 50);
    }
    
    prevLoadingRef.current = hasLoadingMessage;
  }, [chatMessages, hasLoadingMessage, scrollToBottom]);
  
  // Scroll when content height changes during loading (not on a timer)
  // This respects manual scroll - only scrolls if user is already at bottom
  React.useEffect(() => {
    if (!hasLoadingMessage) return;
    
    const contentArea = contentAreaRef.current;
    if (!contentArea) return;
    
    // Track content height changes
    let lastHeight = contentArea.scrollHeight;
    
    const checkForGrowth = () => {
      if (!autoScrollEnabledRef.current) return;
      
      const currentHeight = contentArea.scrollHeight;
      // Only scroll if content actually grew
      if (currentHeight > lastHeight) {
        lastHeight = currentHeight;
        // Use scrollIntoView for reliable positioning above chat bar
        const messagesEnd = messagesEndRef.current;
        if (messagesEnd) {
          messagesEnd.scrollIntoView({ behavior: 'instant', block: 'end' });
        } else {
          contentArea.scrollTop = currentHeight;
        }
      }
    };
    
    // Check less frequently and only when content grows
    const intervalId = setInterval(checkForGrowth, 150);
    
    return () => clearInterval(intervalId);
  }, [hasLoadingMessage]);
  
  // Scroll to bottom when chat panel becomes visible and has messages
  const prevIsVisibleForScrollRef = React.useRef<boolean>(isVisible);
  React.useEffect(() => {
    const chatJustBecameVisible = !prevIsVisibleForScrollRef.current && isVisible;
    prevIsVisibleForScrollRef.current = isVisible;
    
    // When chat opens and has messages, scroll to bottom (most recent response)
    if (chatJustBecameVisible && chatMessages.length > 0) {
      requestAnimationFrame(() => {
        setTimeout(() => {
          autoScrollEnabledRef.current = true; // Enable auto-scroll when opening
          scrollToBottom();
        }, 100);
      });
    }
  }, [isVisible, chatMessages.length, scrollToBottom]);
  
  // Track if we were in fullscreen mode before opening a citation
  // This allows us to restore fullscreen when the document preview closes
  const wasFullscreenBeforeCitationRef = React.useRef<boolean>(false);

  // Track if we're restoring fullscreen from citation (to enable smooth transition)
  const [isRestoringFullscreen, setIsRestoringFullscreen] = React.useState<boolean>(false);
  
  // Restore fullscreen mode when document preview closes (if we were in fullscreen before)
  React.useEffect(() => {
    // When expandedCardViewDoc becomes null (document preview closed)
    // Check if we were in fullscreen before - this flag is set when clicking a citation in fullscreen mode
    // CRITICAL: Skip restoration if we're navigating (agent navigation closes preview but shouldn't restore fullscreen)
    if (!expandedCardViewDoc && wasFullscreenBeforeCitationRef.current && !isNavigatingTaskRef.current) {
      console.log('🔄 [CITATION] Document preview closed - restoring fullscreen mode instantly (snap, no animation)');
      
      // Use justEnteredFullscreen to disable transition (same as initial fullscreen entry)
      setJustEnteredFullscreen(true);
      setIsRestoringFullscreen(true);
      
      // Restore fullscreen mode immediately (no delay to prevent seeing map)
      setIsFullscreenMode(true);
      isFullscreenFromDashboardRef.current = true;
      setDraggedWidth(null); // Clear any dragged width so fullscreen width takes effect
      lockedWidthRef.current = null; // Clear locked width
      // DON'T reset wasFullscreenBeforeCitationRef - keep it true so subsequent citations also restore fullscreen
      // It will be reset when user manually exits fullscreen or when switching away from dashboard mode
      
      // Notify parent of width change immediately
      if (onChatWidthChange) {
        const fullWidth = window.innerWidth - sidebarWidth;
        onChatWidthChange(fullWidth);
      }
      
      // Reset flags after a very brief moment (same timing as dashboard opening)
      setTimeout(() => {
        setJustEnteredFullscreen(false);
        setIsRestoringFullscreen(false);
      }, 100); // Same timing as dashboard opening (100ms)
    }
  }, [expandedCardViewDoc, onChatWidthChange, sidebarWidth]);

  // Hide bot overlay when document finishes opening (after agent action)
  React.useEffect(() => {
    // When document preview opens (expandedCardViewDoc becomes truthy)
    // AND we were waiting for document to open (isOpeningDocumentRef is true)
    // Hide the bot status overlay after a brief moment
    if (expandedCardViewDoc && isOpeningDocumentRef.current) {
      console.log('📂 [BOT_STATUS] Document opened - hiding bot overlay');
      // Small delay to let the document fully render
      setTimeout(() => {
        isOpeningDocumentRef.current = false;
        setIsBotActive(false);
      }, 500);
    }
  }, [expandedCardViewDoc]);


  // Open citation in 50/50 document view (extracted for use from "View in document" and agent-triggered opens)
  const openCitationInDocumentView = React.useCallback(async (citationData: CitationData, fromAgentAction: boolean = false) => {
    try {
      const docId = citationData.doc_id;
      if (!docId) {
        toast({ title: "Error", description: "Document ID not found in citation", variant: "destructive" });
        return;
      }
      if (isAgentModeRef.current && !fromAgentAction) {
        setChatMessages(prev => {
          let targetMsgIndex = -1;
          let fallbackLoadingIndex = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            const msg = prev[i];
            if (msg.reasoningSteps && msg.reasoningSteps.length > 0) {
              if (!msg.isLoading) { targetMsgIndex = i; break; }
              else if (fallbackLoadingIndex === -1) fallbackLoadingIndex = i;
            }
          }
          if (targetMsgIndex === -1) targetMsgIndex = fallbackLoadingIndex;
          if (targetMsgIndex === -1) return prev;
          const hasCombinedStep = prev[targetMsgIndex].reasoningSteps?.some(s =>
            s.action_type === 'opening' && (s.step === 'agent_opening_citation' || s.step === 'agent_open_document'));
          if (hasCombinedStep) return prev;
          const newStep: ReasoningStep = {
            step: 'agent_opening_citation',
            action_type: 'opening',
            message: 'Opening citation view & Highlighting content',
            timestamp: Number.MAX_SAFE_INTEGER,
            fromCitationClick: true,
            details: { doc_id: docId, filename: citationData.original_filename || 'document.pdf' }
          };
          const updated = prev.map((msg, idx) =>
            idx !== targetMsgIndex ? msg : { ...msg, reasoningSteps: [...(msg.reasoningSteps || []), newStep] }
          );
          persistedChatMessagesRef.current = updated;
          return updated;
        });
      }
      const validateBbox = (bbox: any): boolean => {
        if (!bbox || typeof bbox !== 'object') return false;
        const { left, top, width, height } = bbox;
        if (typeof left !== 'number' || left < 0 || left > 1 || typeof top !== 'number' || top < 0 || top > 1 ||
            typeof width !== 'number' || width <= 0 || width > 1 || typeof height !== 'number' || height <= 0 || height > 1)
          return false;
        const area = width * height;
        if ((left === 0 && top === 0 && width === 1 && height === 1) || area > 0.9) return false;
        return true;
      };
      let highlightData: CitationHighlight | undefined;
      if (citationData.bbox && typeof citationData.bbox.left === 'number' && typeof citationData.bbox.top === 'number' &&
          typeof citationData.bbox.width === 'number' && typeof citationData.bbox.height === 'number' && validateBbox(citationData.bbox)) {
        const highlightPage = citationData.bbox.page || citationData.page || citationData.page_number || 1;
        highlightData = {
          fileId: docId,
          bbox: { left: citationData.bbox.left, top: citationData.bbox.top, width: citationData.bbox.width, height: citationData.bbox.height, page: highlightPage },
          doc_id: docId,
          block_id: citationData.block_id || '',
          block_content: (citationData as any).cited_text || (citationData as any).block_content || '',
          original_filename: citationData.original_filename || ''
        };
      }
      if (!highlightData) {
        const hasValidBbox = (chunk?: CitationChunkData | null): chunk is CitationChunkData & { bbox: NonNullable<CitationChunkData['bbox']> } =>
          !!(chunk && chunk.bbox && typeof chunk.bbox.left === 'number' && typeof chunk.bbox.top === 'number' && typeof chunk.bbox.width === 'number' && typeof chunk.bbox.height === 'number');
        const candidateChunks = citationData.candidate_chunks_metadata?.length ? [...citationData.candidate_chunks_metadata] : [];
        const sourceChunks = citationData.source_chunks_metadata?.length ? [...citationData.source_chunks_metadata] : [];
        const priorityList: Array<{ chunk?: CitationChunkData; reason: string }> = [
          { chunk: citationData.matched_chunk_metadata, reason: 'matched_chunk_metadata' },
          { chunk: citationData.chunk_metadata, reason: 'chunk_metadata' },
          { chunk: candidateChunks.find((chunk) => hasValidBbox(chunk)), reason: 'candidate_chunks_metadata' },
          { chunk: sourceChunks.find((chunk) => hasValidBbox(chunk)), reason: 'source_chunks_metadata' },
        ];
        const highlightSource = priorityList.find((entry) => hasValidBbox(entry.chunk));
        const highlightChunk = highlightSource?.chunk;
        if (highlightChunk?.bbox && validateBbox(highlightChunk.bbox)) {
          const highlightPage = highlightChunk.bbox.page || highlightChunk.page_number || citationData.page || citationData.page_number || 1;
          highlightData = {
            fileId: docId,
            bbox: { left: highlightChunk.bbox.left, top: highlightChunk.bbox.top, width: highlightChunk.bbox.width, height: highlightChunk.bbox.height, page: highlightPage }
          };
        }
      }
      const currentFullscreenMode = isFullscreenModeRef.current;
      const isDocumentPreviewAlreadyOpen = !!expandedCardViewDoc;
      if (currentFullscreenMode || wasFullscreenBeforeCitationRef.current) {
        wasFullscreenBeforeCitationRef.current = true;
        setIsExpanded(true);
        setIsFullscreenMode(false);
        if (!isDocumentPreviewAlreadyOpen) setDraggedWidth(null);
      } else if (isFirstCitationRef.current) {
        wasFullscreenBeforeCitationRef.current = false;
        setIsExpanded(true);
        if (!isDocumentPreviewAlreadyOpen) setDraggedWidth(null);
        isFirstCitationRef.current = false;
      } else {
        wasFullscreenBeforeCitationRef.current = false;
      }
      openExpandedCardView(docId, citationData.original_filename || 'document.pdf', highlightData || undefined, fromAgentAction);
      documentPreviewOwnerRef.current = currentChatIdRef.current || currentChatId;
    } catch (error: any) {
      console.error('❌ Error opening citation document:', error);
      toast({ title: "Error", description: error.message || "Failed to open document", variant: "destructive" });
    }
  }, [openExpandedCardView, toast, expandedCardViewDoc]);

  // Agent-triggered citation open: open 50/50 directly. User clicks on citation numbers open the small panel instead.
  const handleCitationClick = React.useCallback((citationData: CitationData, fromAgentAction: boolean = false) => {
    openCitationInDocumentView(citationData, fromAgentAction);
  }, [openCitationInDocumentView]);

  // User clicked a citation in message text: if document preview is already open, navigate to citation there; otherwise show compact panel
  const handleUserCitationClick = React.useCallback((data: CitationDataType, anchorRect?: DOMRect, sourceMessageText?: string, messageId?: string, citationNumber?: string) => {
    if (isDocumentPreviewOpenRef.current) {
      // Document preview already open: go straight to this citation in the document view (no panel)
      openCitationInDocumentView(data as CitationData, false);
      return;
    }
    if (anchorRect != null) {
      setCitationClickPanel({ citationData: data as CitationData, anchorRect, sourceMessageText, messageId, citationNumber });
    }
  }, [openCitationInDocumentView]);

  // Close citation panel on scroll (messages area), window resize, or Escape
  React.useEffect(() => {
    if (!citationClickPanel) return;
    const contentArea = contentAreaRef.current;
    const onScroll = () => setCitationClickPanel(null);
    const onResize = () => setCitationClickPanel(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCitationClickPanel(null);
    };
    contentArea?.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      contentArea?.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [citationClickPanel]);
  
  // Add custom scrollbar styling and animations for WebKit browsers (Chrome, Safari, Edge)
  React.useEffect(() => {
    const style = document.createElement('style');
    style.id = 'sidechat-scrollbar-style';
    style.textContent = `
      .sidechat-scroll::-webkit-scrollbar {
        width: 6px;
      }
      .sidechat-scroll::-webkit-scrollbar-track {
        background: transparent;
      }
      .sidechat-scroll::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.001);
        border-radius: 3px;
      }
      .sidechat-scroll::-webkit-scrollbar-thumb:hover {
        background: rgba(0, 0, 0, 0.004);
      }
      @keyframes pulse {
        0%, 100% {
          opacity: 0.4;
        }
        50% {
          opacity: 1;
        }
      }
      @keyframes rotateRing {
        0% {
          transform: rotateX(45deg) rotateY(-45deg) rotateZ(0deg);
        }
        50% {
          transform: rotateX(45deg) rotateY(-45deg) rotateZ(180deg);
        }
        100% {
          transform: rotateX(45deg) rotateY(-45deg) rotateZ(360deg);
        }
      }
      @keyframes rotateAtom {
        from {
          transform: rotateY(0deg);
        }
        to {
          transform: rotateY(360deg);
        }
      }
      @keyframes rotateGlobe {
        from {
          transform: rotateX(0deg) rotateY(0deg);
        }
        to {
          transform: rotateX(360deg) rotateY(360deg);
        }
      }
      
      /* Gold clockwise wave glow animation for Agents Sidebar button */
      @keyframes goldClockwiseGlow {
        0% {
          box-shadow: inset 0 -2px 8px rgba(212, 175, 55, 0.8),
                      0 0 12px rgba(255, 215, 0, 0.6);
          border-color: rgba(212, 175, 55, 0.9);
        }
        12.5% {
          box-shadow: inset 2px -2px 8px rgba(212, 175, 55, 0.7),
                      3px 0 12px rgba(255, 215, 0, 0.5);
          border-color: rgba(212, 175, 55, 0.85);
        }
        25% {
          box-shadow: inset 2px 0 8px rgba(212, 175, 55, 0.7),
                      3px 2px 12px rgba(255, 215, 0, 0.5);
          border-color: rgba(212, 175, 55, 0.8);
        }
        37.5% {
          box-shadow: inset 2px 2px 8px rgba(212, 175, 55, 0.6),
                      0 3px 12px rgba(255, 215, 0, 0.4);
          border-color: rgba(212, 175, 55, 0.7);
        }
        50% {
          box-shadow: inset 0 2px 8px rgba(212, 175, 55, 0.5),
                      -3px 2px 12px rgba(255, 215, 0, 0.3);
          border-color: rgba(212, 175, 55, 0.6);
        }
        62.5% {
          box-shadow: inset -2px 2px 8px rgba(212, 175, 55, 0.4),
                      -3px 0 10px rgba(255, 215, 0, 0.2);
          border-color: rgba(212, 175, 55, 0.5);
        }
        75% {
          box-shadow: inset -2px 0 6px rgba(212, 175, 55, 0.3),
                      -2px -2px 8px rgba(255, 215, 0, 0.15);
          border-color: rgba(212, 175, 55, 0.4);
        }
        87.5% {
          box-shadow: inset -1px -1px 4px rgba(212, 175, 55, 0.15),
                      0 -2px 6px rgba(255, 215, 0, 0.1);
          border-color: rgba(203, 213, 225, 0.7);
        }
        100% {
          box-shadow: none;
          border-color: rgba(203, 213, 225, 0.7);
        }
      }
      
      .agent-sidebar-gold-glow {
        animation: goldClockwiseGlow 0.8s ease-out forwards !important;
      }
      
      .agent-sidebar-gold-glow span {
        animation: goldTextPulse 0.6s ease-out forwards;
      }
      
      .agent-sidebar-gold-glow svg {
        animation: goldIconPulse 0.6s ease-out forwards;
      }
      
      @keyframes goldTextPulse {
        0% {
          color: rgba(180, 145, 45, 1);
          text-shadow: 0 0 6px rgba(255, 215, 0, 0.5);
        }
        50% {
          color: rgba(180, 145, 45, 0.7);
          text-shadow: 0 0 3px rgba(255, 215, 0, 0.25);
        }
        100% {
          color: inherit;
          text-shadow: none;
        }
      }
      
      @keyframes goldIconPulse {
        0% {
          color: rgba(180, 145, 45, 1);
          filter: drop-shadow(0 0 4px rgba(255, 215, 0, 0.6));
        }
        50% {
          color: rgba(180, 145, 45, 0.7);
          filter: drop-shadow(0 0 2px rgba(255, 215, 0, 0.3));
        }
        100% {
          color: inherit;
          filter: none;
        }
      }
    `;
    if (!document.getElementById('sidechat-scrollbar-style')) {
      document.head.appendChild(style);
    }
    return () => {
      const existingStyle = document.getElementById('sidechat-scrollbar-style');
      if (existingStyle && !document.querySelector('.sidechat-scroll')) {
        existingStyle.remove();
      }
    };
  }, []);

  // Generate mock AI response based on query

  // Restore persisted messages when panel becomes visible
  React.useEffect(() => {
    if (isVisible) {
      // Skip restore if new agent was just requested
      if (newAgentRequestedRef.current) {
        console.log('🔄 SideChatPanel: Skipping restore - new agent was just requested');
        return;
      }
      
      // Track previous restoreChatId to detect changes
      const prevRestoreChatId = prevRestoreChatIdRef.current;
      prevRestoreChatIdRef.current = restoreChatId;
      
      // If restoreChatId changed and is different from currentChatId, switch chats
      // Enhanced: Add check to ensure we're not in the middle of a new agent request
      // CRITICAL: Only restore if we're actually switching to a different chat
      // If restoreChatId === currentChatId, the chat is already active - skip restoration
      // Also prevent duplicate restorations by checking lastRestoredChatIdRef
      // FIX: Allow re-restoration if current chat has no messages (previous restoration failed/partial)
      const currentMessagesEmpty = chatMessagesRef.current.length === 0;
      const shouldAllowReRestore = currentMessagesEmpty && restoreChatId === lastRestoredChatIdRef.current;
      if (restoreChatId && 
          restoreChatId !== currentChatId && 
          (restoreChatId !== lastRestoredChatIdRef.current || shouldAllowReRestore) && 
          !newAgentRequestedRef.current) {
        const chatToRestore = getChatById(restoreChatId);
        console.log('🔄 [RESTORE_INIT] Switching chats:', {
          from: currentChatId,
          to: restoreChatId,
          prevRestore: prevRestoreChatId,
          isVisible,
          chatStatus: chatToRestore?.status,
          historyMessageCount: chatToRestore?.messages?.length || 0,
          preview: chatToRestore?.preview?.substring(0, 50) || 'none',
          allowReRestore: shouldAllowReRestore,
          currentMessagesEmpty: currentMessagesEmpty
        });
        
        // CRITICAL: Save current chat's streaming state to buffer before clearing UI
        // This prevents interrupting ongoing queries when switching chats
        // FIX: Use chatMessagesRef.current to get latest messages (avoid stale closure)
        if (currentChatId && currentChatId !== restoreChatId) {
          const currentBufferedState = getBufferedState(currentChatId);
          const currentMessages = chatMessagesRef.current;
          
          // Save current messages (preserve streaming state)
          currentBufferedState.messages = [...currentMessages];
          
          // Save accumulated text from last loading message if it exists
          const lastLoadingMessage = currentMessages.find(msg => msg.isLoading);
          if (lastLoadingMessage && lastLoadingMessage.text) {
            currentBufferedState.accumulatedText = lastLoadingMessage.text;
          }
          
          // Save reasoning steps from messages
          const allReasoningSteps: ReasoningStep[] = [];
          currentMessages.forEach(msg => {
            if (msg.reasoningSteps && msg.reasoningSteps.length > 0) {
              allReasoningSteps.push(...msg.reasoningSteps);
            }
          });
          if (allReasoningSteps.length > 0) {
            currentBufferedState.reasoningSteps = allReasoningSteps;
            currentBufferedState.lastReasoningStep = allReasoningSteps[allReasoningSteps.length - 1];
          }
          
          // Save citations from messages
          currentMessages.forEach(msg => {
            if (msg.citations && Object.keys(msg.citations).length > 0) {
              currentBufferedState.citations = { ...currentBufferedState.citations, ...msg.citations };
            }
          });
          
          // Preserve loading state
          const hasLoadingMessage = currentMessages.some(msg => msg.isLoading);
          currentBufferedState.isLoading = hasLoadingMessage;
          currentBufferedState.status = hasLoadingMessage ? 'loading' : 'completed';
          currentBufferedState.lastUpdate = Date.now();
          
          // CRITICAL: Save document preview state if document is open AND this chat owns it
          // This ensures each chat has its own document preview isolated (ownership check prevents cross-contamination)
          if (expandedCardViewDoc && documentPreviewOwnerRef.current === currentChatId) {
            currentBufferedState.documentPreview = {
              docId: expandedCardViewDoc.docId,
              filename: expandedCardViewDoc.filename,
              highlight: expandedCardViewDoc.highlight ? {
                fileId: expandedCardViewDoc.highlight.fileId,
                bbox: expandedCardViewDoc.highlight.bbox,
                doc_id: expandedCardViewDoc.highlight.doc_id,
                block_id: expandedCardViewDoc.highlight.block_id || '',
                block_content: expandedCardViewDoc.highlight.block_content || '',
                original_filename: expandedCardViewDoc.highlight.original_filename || ''
              } : undefined
            };
            console.log('💾 Saved document preview with ownership match:', {
              chatId: currentChatId,
              owner: documentPreviewOwnerRef.current
            });
          } else {
            // Explicitly clear document preview in buffer if no document is open or this chat doesn't own it
            currentBufferedState.documentPreview = undefined;
            if (expandedCardViewDoc && documentPreviewOwnerRef.current !== currentChatId) {
              console.log('⚠️ Skipping document preview save - ownership mismatch:', {
                chatId: currentChatId,
                owner: documentPreviewOwnerRef.current
              });
            }
          }
          // Mark that we've captured the document preview state for this chat (even if empty)
          currentBufferedState.documentPreviewCaptured = true;
          
          console.log('💾 SideChatPanel: Saved current chat streaming state to buffer:', {
            chatId: currentChatId,
            messagesCount: currentMessages.length,
            accumulatedTextLength: currentBufferedState.accumulatedText.length,
            reasoningStepsCount: allReasoningSteps.length,
            isLoading: hasLoadingMessage,
            hasDocumentPreview: !!expandedCardViewDoc
          });
          
          // NOTE: Document preview is NOT closed here anymore
          // ChatStateStore maintains per-chat document previews, so switching chats
          // will automatically show the new chat's document preview (or none if that chat has none)
        }
        
        // CRITICAL: Save current chat state before switching (granular restoration)
        if (currentChatId && (inputValue.trim() || attachedFiles.length > 0 || propertyAttachments.length > 0 || submittedQueries.length > 0)) {
          console.log('💾 SideChatPanel: Saving current chat state before switching:', {
            chatId: currentChatId,
            inputValue: inputValue,
            attachedFiles: attachedFiles.length,
            propertyAttachments: propertyAttachments.length,
            submittedQueries: submittedQueries.length
          });
          saveChatState(currentChatId, {
            inputValue: inputValue,
            attachedFiles: [...attachedFiles],
            propertyAttachments: [...propertyAttachments],
            submittedQueries: [...submittedQueries] as any[]
          });
        }
        
        // CRITICAL: Set activeChatIdRef IMMEDIATELY before clearing state
        // This ensures streaming callbacks route to the correct chat
        activeChatIdRef.current = restoreChatId;
        updateActiveChat(restoreChatId, isVisible);
        
        // Mark that we're restoring to prevent query processing during restore
        // CRITICAL: Only set this flag when actually switching chats
        isRestoringChatRef.current = true;
        
        // CRITICAL: Clear currentChatId FIRST to allow restore
        setCurrentChatId(null);
        
        // Clear all UI state synchronously
        setChatMessages([]);
        setSubmittedQueries([]);
        setChatTitle('');
        clearInputAndChips();
        setAttachedFiles([]);
        attachedFilesRef.current = [];
        clearPropertyAttachments();
        setIsSubmitted(false);
        
        // Then immediately restore the new chat
        const chat = getChatById(restoreChatId);
        if (chat && chat.messages) {
          // Check for buffered updates for this chat
          const bufferedState = bufferedChatUpdatesRef.current[restoreChatId];
          
          // Restore will proceed - flag is already set above
          // Check if the restored chat has a running query
          const hasLoadingMessages = chat.messages.some((msg: any) => msg.isLoading === true);
          const hasRunningStatus = chat.status === 'loading';
          const isBufferedLoading = bufferedState?.isLoading === true;
          
          // If chat has a running query (from history or buffer), show bot status overlay
          if (hasLoadingMessages || hasRunningStatus || isBufferedLoading) {
            setIsBotActive(true);
            // Use buffered last reasoning step message if available
            const botMessage = bufferedState?.lastReasoningStep?.message || 'Running...';
            setBotActivityMessage(botMessage);
            setIsBotPaused(false);
            isBotPausedRef.current = false;
          } else {
            // Only clear bot status overlay if the new chat doesn't have a running query
            setIsBotActive(false);
            setBotActivityMessage('Running...');
            setIsBotPaused(false);
            isBotPausedRef.current = false;
          }
          
          // Set current chat ID and load title from history
          setCurrentChatId(restoreChatId);
          currentChatIdRef.current = restoreChatId; // Update ref synchronously for document preview operations
          if (chat.title) {
            setChatTitle(chat.title);
            // No streaming for restored chats - display immediately
            setIsTitleStreaming(false);
            setStreamedTitle('');
          }
          
          // Convert history messages to ChatMessage format
          // CRITICAL: Use index in map to ensure unique IDs even if Date.now() is the same
          let restoredMessages: ChatMessage[] = chat.messages.map((msg: any, idx: number) => {
            // Use index + timestamp + random to guarantee uniqueness
            const uniqueId = `restored-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 9)}`;
            
            // Preserve isLoading state from history
            // If chat is running and this is the last assistant message, it should be loading
            const isLastMessage = idx === chat.messages.length - 1;
            const isAssistantMessage = msg.role === 'assistant' || msg.type === 'response';
            const shouldBeLoading = msg.isLoading === true || 
              (isLastMessage && chat.status === 'loading' && isAssistantMessage && (!msg.content || msg.content.trim().length === 0));
            
            return {
              id: uniqueId,
              type: msg.role === 'user' ? 'query' : 'response',
              text: msg.content || '',
              attachments: msg.attachments || [],
              propertyAttachments: msg.propertyAttachments || [],
              selectedDocumentIds: msg.selectedDocumentIds,
              selectedDocumentNames: msg.selectedDocumentNames,
              contentSegments: msg.contentSegments, // Preserve chip+text order for query bubbles
              citations: msg.citations || {}, // Restore citations for clickable buttons
              reasoningSteps: msg.reasoningSteps || [], // Restore reasoning steps
              isLoading: shouldBeLoading // Preserve running state
            };
          });
          
          // FIX: Fallback restoration - if messages are empty but preview exists, create minimal query message
          // This handles cases where messages weren't saved properly (backend failure, stale closure, etc.)
          if (restoredMessages.length === 0 && chat.preview && chat.preview.trim()) {
            console.log('⚠️ SideChatPanel: Messages empty but preview exists, creating fallback query message:', chat.preview);
            const fallbackQueryId = `fallback-query-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            restoredMessages = [{
              id: fallbackQueryId,
              type: 'query',
              text: chat.preview.trim(),
              attachments: [],
              propertyAttachments: [],
              citations: {},
              reasoningSteps: [],
              isLoading: false
            }];
            
            // Also update the chat in history with this minimal message so future restores work
            updateChatInHistory(restoreChatId, [{
              role: 'user' as const,
              content: chat.preview.trim(),
              attachments: [],
              propertyAttachments: [],
              citations: {},
              reasoningSteps: [],
              isLoading: false
            }]);
          }
          
          // CRITICAL: Merge buffered updates if they exist (buffered is more recent)
          if (bufferedState && bufferedState.messages.length > 0) {
            console.log('🔄 SideChatPanel: Merging buffered updates with history:', {
              historyMessages: restoredMessages.length,
              bufferedMessages: bufferedState.messages.length,
              status: bufferedState.status,
              isLoading: bufferedState.isLoading
            });
            
            // Use buffered messages (they're more recent)
            restoredMessages = bufferedState.messages.map((msg, idx) => ({
              ...msg,
              // Ensure unique IDs
              id: msg.id || `buffered-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 9)}`
            }));
            
            // Apply buffered citations
            if (bufferedState.citations && Object.keys(bufferedState.citations).length > 0) {
              // Merge citations into the last response message
              const lastResponse = restoredMessages.filter(m => m.type === 'response').pop();
              if (lastResponse) {
                lastResponse.citations = { ...lastResponse.citations, ...bufferedState.citations };
              }
            }
            
            // CRITICAL: Merge buffered accumulated text into the last loading message if it exists
            if (bufferedState.accumulatedText) {
              const lastLoadingMessage = restoredMessages.find(msg => msg.isLoading);
              if (lastLoadingMessage) {
                lastLoadingMessage.text = bufferedState.accumulatedText;
                console.log('🔄 SideChatPanel: Applied buffered accumulated text to loading message:', {
                  textLength: bufferedState.accumulatedText.length,
                  messageId: lastLoadingMessage.id
                });
              }
            }
          }
          
          // CRITICAL: Apply buffered reasoning steps to bot overlay immediately (even if no buffered messages)
          if (bufferedState?.lastReasoningStep) {
            setBotActivityMessage(bufferedState.lastReasoningStep.message);
            console.log('🔄 SideChatPanel: Applied buffered reasoning step to bot overlay:', bufferedState.lastReasoningStep.message);
          }
          
          // CRITICAL: Merge buffered reasoning steps into the loading message
          // This handles the case where reasoning steps were captured but the message wasn't updated
          // (e.g., due to timing issues or ID mismatches during background execution)
          if (bufferedState?.reasoningSteps && bufferedState.reasoningSteps.length > 0) {
            const loadingMessage = restoredMessages.find(msg => msg.isLoading);
            const lastResponseMessage = restoredMessages.filter(m => m.type === 'response').pop();
            const targetMessage = loadingMessage || lastResponseMessage;
            
            if (targetMessage) {
              const existingSteps = targetMessage.reasoningSteps || [];
              const existingStepKeys = new Set(existingSteps.map(s => `${s.step}:${s.message}`));
              
              // Add any buffered steps that aren't already in the message
              const newSteps = bufferedState.reasoningSteps.filter(s => 
                !existingStepKeys.has(`${s.step}:${s.message}`)
              );
              
              if (newSteps.length > 0) {
                targetMessage.reasoningSteps = [...existingSteps, ...newSteps];
                console.log('🔄 SideChatPanel: Merged buffered reasoning steps into message:', {
                  existingCount: existingSteps.length,
                  addedCount: newSteps.length,
                  totalCount: targetMessage.reasoningSteps.length
                });
              }
            }
          }
          
          setChatMessages(restoredMessages);
          persistedChatMessagesRef.current = restoredMessages;
          restoredMessageIdsRef.current = new Set(restoredMessages.map(m => m.id));
          
          console.log('✅ [RESTORE_COMPLETE] Messages restored:', {
            chatId: restoreChatId,
            messageCount: restoredMessages.length,
            messageTypes: restoredMessages.map(m => m.type),
            hasContent: restoredMessages.some(m => m.text && m.text.trim().length > 0)
          });
          
          // Scroll to bottom (most recent response) when chat is restored
          // Use requestAnimationFrame to ensure DOM has updated
          requestAnimationFrame(() => {
            setTimeout(() => {
              autoScrollEnabledRef.current = true; // Enable auto-scroll for restored chat
              scrollToBottom();
            }, 50);
          });
          
          // NOTE: Document preview restoration is now handled by ChatStateStore
          // When activeChatId changes to restoreChatId, MainContent automatically shows that chat's document preview
          // No manual restoration needed here
          
          // CRITICAL: Restore agent action state if buffered
          if (bufferedState?.activeAgentAction) {
            const action = bufferedState.activeAgentAction;
            // Check if action is still relevant (within last 30 seconds)
            const actionAge = Date.now() - action.timestamp;
            if (actionAge < 30000) {
              console.log('🔄 SideChatPanel: Restoring agent action state:', action.action);
              // Update bot overlay message to reflect the action
              if (action.action === 'open_document') {
                setBotActivityMessage('Opening document...');
              } else if (action.action === 'navigate_to_property' || action.action === 'select_property_pin') {
                setBotActivityMessage('Navigating...');
              }
            }
          }
          
          // CRITICAL: Restore granular state (input, attachments, etc.) if saved
          if (chat.savedState) {
            console.log('🔄 SideChatPanel: Restoring granular state for chat:', restoreChatId, chat.savedState);
            if (chat.savedState.inputValue !== undefined) {
              const restored = chat.savedState.inputValue;
              setInputValue(restored);
              segmentInput.setSegments(
                buildInitialSegments(
                  restored,
                  propertyAttachments.map((a) => ({ id: a.id, label: a.address, payload: a.property })),
                  atMentionDocumentChips
                )
              );
            }
            if (chat.savedState.attachedFiles && chat.savedState.attachedFiles.length > 0) {
              setAttachedFiles([...chat.savedState.attachedFiles]);
              attachedFilesRef.current = [...chat.savedState.attachedFiles];
            }
            if (chat.savedState.propertyAttachments && chat.savedState.propertyAttachments.length > 0) {
              // Clear existing property attachments first, then restore saved ones
              clearPropertyAttachments();
              chat.savedState.propertyAttachments.forEach((prop: any) => {
                addPropertyAttachment(prop);
              });
            }
            if (chat.savedState.submittedQueries && chat.savedState.submittedQueries.length > 0) {
              setSubmittedQueries([...chat.savedState.submittedQueries] as SubmittedQuery[]);
            }
          }
          
          // CRITICAL: Clear restore flag IMMEDIATELY after messages are restored
          // This allows query processing to resume for this chat
          isRestoringChatRef.current = false;
          
          // Track that this chat has been restored to prevent duplicate restorations
          lastRestoredChatIdRef.current = restoreChatId;
          
          // CRITICAL: If chat is running but has no loading message, add one to show the running state
          if (chat.status === 'loading') {
            const hasLoadingMessage = restoredMessages.some(msg => msg.isLoading === true);
            const lastMessage = restoredMessages[restoredMessages.length - 1];
            
            if (!hasLoadingMessage && lastMessage && lastMessage.type === 'query') {
              // Chat is running but no loading message - add one
              const loadingMessage: ChatMessage = {
                id: `loading-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                type: 'response',
                text: '',
                isLoading: true
              };
              const messagesWithLoading = [...restoredMessages, loadingMessage];
              setChatMessages(messagesWithLoading);
              persistedChatMessagesRef.current = messagesWithLoading;
              restoredMessageIdsRef.current = new Set(messagesWithLoading.map(m => m.id));
              console.log('🔄 SideChatPanel: Added loading message for running chat:', restoreChatId);
              
              // Scroll to bottom after adding loading message
              requestAnimationFrame(() => {
                setTimeout(() => {
                  autoScrollEnabledRef.current = true;
                  scrollToBottom();
                }, 50);
              });
            } else if (!hasLoadingMessage) {
              // Chat status is 'loading' but no loading message and last message is not a query
              // This might be a stale status - check if we should update it
              const hasCompletedResponses = restoredMessages.some((msg: ChatMessage) => 
                msg.type === 'response' && 
                msg.text && 
                msg.text.trim().length > 0
              );
              if (hasCompletedResponses) {
                console.log('🔄 SideChatPanel: Restored chat has loading status but no loading messages and has completed responses, updating to completed:', restoreChatId);
                updateChatStatus(restoreChatId, 'completed');
              }
            }
          }
          
          // NOTE: Document preview restoration is now handled ONLY via bufferedState.documentPreview
          // We no longer auto-open documents from citations to ensure proper per-chat isolation
          // This prevents document preview leakage between chats
        } else {
          // Chat not found or has no messages - clear restore flag
          console.warn('🔄 SideChatPanel: Chat not found or has no messages, clearing restore flag:', restoreChatId);
          isRestoringChatRef.current = false;
        }
        
        return;
      }
      
      // If we have persisted messages, restore them (no animation)
      // BUT only if we're not starting a fresh chat (check if query is empty and no persisted messages)
      if (persistedChatMessagesRef.current.length > 0 && (!query || !query.trim())) {
        const persistedMessages = persistedChatMessagesRef.current;
        setChatMessages(persistedMessages);
        // Track which messages were restored so they don't animate
        restoredMessageIdsRef.current = new Set(persistedMessages.map(m => m.id));
        
        // Scroll to bottom (most recent response) when persisted messages are restored
        requestAnimationFrame(() => {
          setTimeout(() => {
            autoScrollEnabledRef.current = true; // Enable auto-scroll for restored chat
            scrollToBottom();
          }, 50);
        });
        
        // CRITICAL: Only auto-open document from citations when this chat does NOT already have
        // a document preview (e.g. in ChatStateStore from a previous visit). Re-entering a chat
        // already restores the preview from the store; opening again causes duplicate opens/spamming.
        const existingDocForChat = currentChatId ? getChatState(currentChatId)?.documentPreview : null;
        if (existingDocForChat) {
          // Chat already has a document preview (re-entered); skip auto-open to prevent spamming
          return;
        }
        
        // Automatically open document preview if persisted messages have citations
        // Find the last response message with citations and open the first citation's document
        for (let i = persistedMessages.length - 1; i >= 0; i--) {
          const msg = persistedMessages[i];
          if (msg.type === 'response' && msg.citations && Object.keys(msg.citations).length > 0) {
            // Found a response with citations - get the first citation
            const firstCitationKey = Object.keys(msg.citations)[0];
            const citationData = msg.citations[firstCitationKey];
            
            if (citationData && citationData.doc_id) {
              console.log('📂 [RESTORE] Auto-opening document preview from persisted messages citation:', {
                docId: citationData.doc_id,
                filename: citationData.original_filename,
                hasBbox: !!citationData.bbox
              });
              
              // Automatically open the document preview (as if agent-triggered)
              // Use a small delay to ensure chat panel visibility is set correctly first
              setTimeout(() => {
                const page = citationData.page || citationData.page_number || citationData.bbox?.page || 1;
                const highlightData = citationData.bbox ? {
                  fileId: citationData.doc_id,
                  bbox: {
                    ...citationData.bbox,
                    page: page
                  },
                  page: page,
                  doc_id: citationData.doc_id,
                  block_content: (citationData as any).block_content || (citationData as any).cited_text || '',
                  original_filename: citationData.original_filename
                } : undefined;
                
                // Open as agent-triggered so it bypasses chat visibility check
                openExpandedCardView(
                  citationData.doc_id,
                  citationData.original_filename || 'document.pdf',
                  highlightData,
                  true // isAgentTriggered = true
                );
              }, 100); // Small delay to ensure state is ready
              
              // Only open the first citation found (most recent response)
              break;
            }
          }
        }
        
        return;
      }
      
      // If persisted messages exist but we have a new query, clear them (new chat scenario)
      // BUT only if we don't already have chat messages (to avoid clearing messages with property attachments)
      if (persistedChatMessagesRef.current.length > 0 && query && query.trim() && chatMessages.length === 0) {
        persistedChatMessagesRef.current = [];
        restoredMessageIdsRef.current = new Set();
      }
      
      // If query is empty and we have no persisted messages, ensure panel is empty
      // BUT only if we don't already have chat messages (to avoid clearing messages with property attachments)
      if ((!query || !query.trim()) && persistedChatMessagesRef.current.length === 0 && chatMessages.length === 0) {
        setChatMessages([]);
        return;
      }
      
      // Don't re-initialize if we already have messages (to preserve property attachments)
      if (chatMessages.length > 0) {
        return;
      }
      
      // Initialize with new query if provided
      // CRITICAL: This useEffect should ONLY initialize the panel UI, NOT process queries
      // Query processing is handled by the first useEffect (line 2939)
      // Only initialize if query is provided but NOT being processed by first useEffect
      if (query && query.trim()) {
        const queryText = query.trim();
        
        // CRITICAL: Don't process queries here - the first useEffect handles query processing
        // This useEffect should only handle UI initialization when panel becomes visible
        // Skip entirely if query is being processed or already processed
        if (isProcessingQueryRef.current || queryText === lastProcessedQueryRef.current) {
          console.log('⏳ SideChatPanel: Query processing handled by first useEffect, skipping initialization');
          return;
        }
        
        const isAlreadyInMessages = chatMessages.some(msg => 
          msg.type === 'query' && msg.text === queryText
        );
        
        if (isAlreadyInMessages) {
          console.log('⏳ SideChatPanel: Query already in messages, skipping initialization');
          return;
        }
        
        // If we reach here, the first useEffect hasn't processed the query yet
        // This should not happen in normal flow, but if it does, let the first useEffect handle it
        // Don't process here to avoid duplicate API calls
        console.log('⏳ SideChatPanel: Query will be processed by first useEffect, skipping duplicate processing');
        return;
        
        // FIRST: Show bot status overlay immediately (before any processing) - ONLY in agent mode
        if (isAgentMode) {
          console.log('🤖 [BOT_STATUS] Activating bot status overlay (from initial query)');
          setIsBotActive(true);
          setBotActivityMessage('Running...');
          setIsBotPaused(false);
          isBotPausedRef.current = false; // Reset pause ref
        }
        
        // CRITICAL: Use performance.now() + random to ensure uniqueness
        const queryId = `query-${performance.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Include property attachments from context if they exist
        // Create a deep copy to ensure they persist even if context is cleared
        const initialPropertyAttachments = propertyAttachments.length > 0 
          ? propertyAttachments.map(p => ({ ...p, property: { ...p.property } }))
          : undefined;
        
        console.log('📥 SideChatPanel: Initializing with query:', {
          text: queryText,
          propertyAttachments: initialPropertyAttachments?.length || 0,
          propertyAttachmentsData: initialPropertyAttachments
        });
        
        // Get selected document IDs if selection mode was used
        const initialSelectedDocIds = selectedDocumentIds.size > 0 
          ? Array.from(selectedDocumentIds) 
          : undefined;
        
        // Try to get document names from property attachments if available
        let initialSelectedDocNames: string[] | undefined = undefined;
        if (initialSelectedDocIds && initialSelectedDocIds.length > 0 && initialPropertyAttachments && initialPropertyAttachments.length > 0) {
          // Get documents from the first property attachment
          const property = initialPropertyAttachments[0].property as any;
          if (property?.propertyHub?.documents) {
            initialSelectedDocNames = initialSelectedDocIds
              .map(docId => {
                const doc = property.propertyHub.documents.find((d: any) => d.id === docId);
                return doc?.original_filename;
              })
              .filter((name): name is string => !!name);
          }
        }
        
        // Add query message
        const initialMessage: ChatMessage = {
          id: queryId,
          type: 'query',
          text: queryText,
          attachments: [],
          propertyAttachments: initialPropertyAttachments,
          selectedDocumentIds: initialSelectedDocIds,
          selectedDocumentNames: initialSelectedDocNames,
          fromCitation: !!citationContext, // Mark if query came from citation
          citationBboxData: citationContext ? {
            document_id: citationContext.document_id,
            page_number: citationContext.page_number,
            bbox: citationContext.bbox,
            original_filename: citationContext.original_filename,
            block_id: (citationContext as any).block_id || undefined || undefined
          } : undefined
        };
        
        setChatMessages([initialMessage]);
        persistedChatMessagesRef.current = [initialMessage];
        // Track this message so it doesn't animate on restore
        restoredMessageIdsRef.current = new Set([initialMessage.id]);
        
        // Clear property attachments after they've been included in the initial message
        // This ensures they're available when the panel initializes, but cleared after
        // BUT only clear if this is a new initialization, not if we're restoring or have existing messages
        if (initialPropertyAttachments && initialPropertyAttachments.length > 0 && chatMessages.length === 0) {
          setTimeout(() => {
            clearPropertyAttachments();
            // Turn off selection mode after clearing attachments
            setSelectionModeActive(false);
          }, 200); // Small delay to ensure the message is rendered
        }
        
        // Add loading response message
        // CRITICAL: Use performance.now() + random to ensure uniqueness even if called multiple times rapidly
        const loadingResponseId = `response-loading-${performance.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const loadingMessage: ChatMessage = {
          id: loadingResponseId,
          type: 'response',
          text: '',
          isLoading: true,
          reasoningSteps: [], // Initialize empty array for reasoning steps
          citations: {} // Initialize empty object for citations
        };
        setChatMessages(prev => {
          const updated = [...prev, loadingMessage];
          persistedChatMessagesRef.current = updated;
          return updated;
        });
        
        // Call LLM API for initial query
        (async () => {
          try {
            // Extract property_id from property attachments (first one if multiple)
            const propertyId = initialPropertyAttachments && initialPropertyAttachments.length > 0
              ? String(initialPropertyAttachments[0].propertyId)
              : undefined;
            
            console.log('📤 SideChatPanel: Calling LLM API for initial query:', {
              query: queryText,
              propertyId,
              messageHistoryLength: 0
            });
            
            // Use streaming API with block-based formatting like ChatGPT
            let accumulatedText = '';
            let tokenBuffer = ''; // Buffer for tokens before displaying
            let displayedText = ''; // Text currently displayed to user (complete markdown blocks only)
            let pendingBuffer = ''; // Buffer for incomplete markdown blocks
            const blockQueue: string[] = []; // Queue of complete markdown blocks to display
            let isProcessingQueue = false;
            
            // Extract complete markdown blocks from buffer using shared helper
            // Pre-completes markdown so text is always valid when stored in state
            const extractCompleteBlocks = () => {
              const combined = pendingBuffer + tokenBuffer;
              const { completeBlocks, remainingBuffer } = extractMarkdownBlocks(combined);
              
              // Add complete blocks to queue (already pre-completed by helper)
              if (completeBlocks.length > 0) {
                blockQueue.push(...completeBlocks);
                // Start processing queue if not already processing
                if (!isProcessingQueue) {
                  processBlockQueue();
                }
              }
              
              // Update buffers
              pendingBuffer = remainingBuffer;
              tokenBuffer = '';
            };
            
            // Process block queue with gradual display (streaming effect)
            const processBlockQueue = () => {
              if (isProcessingQueue || blockQueue.length === 0) return;
              
              // Don't process if paused
              if (isBotPausedRef.current) {
                return;
              }
              
              isProcessingQueue = true;
              
              const processNext = () => {
                // Check if paused - if so, stop processing
                if (isBotPausedRef.current) {
                  isProcessingQueue = false;
                  return;
                }
                
                // CRITICAL: Check if this chat is still active before updating UI
                // For initial query path, currentChatId might be set by now - check activeChatIdRef
                // If activeChatIdRef is set to something else, we've switched chats
                const initialChatId = currentChatIdRef.current || currentChatId;
                const stillActive = !initialChatId || initialChatId === activeChatIdRef.current;
                if (!stillActive) {
                  console.log('⚠️ [INITIAL_BLOCK_QUEUE] Chat no longer active, stopping block processing:', {
                    initialChatId,
                    activeChatId: activeChatIdRef.current
                  });
                  isProcessingQueue = false;
                  return;
                }
                
                if (blockQueue.length === 0) {
                  isProcessingQueue = false;
                  // Check if we have more blocks to extract
                  if (tokenBuffer.trim() || pendingBuffer.trim()) {
                    extractCompleteBlocks();
                    if (blockQueue.length > 0 && !isBotPausedRef.current) {
                      processBlockQueue();
                    }
                  }
                  return;
                }
                
                // Get next block from queue
                const block = blockQueue.shift();
                if (block) {
                  // Add block to displayed text
                  displayedText += block;
                  
                  // Clean the text (remove EVIDENCE_FEEDBACK tags, etc.) but don't complete markdown here
                  // Let StreamingResponseText component handle markdown completion based on isStreaming state
                  // This ensures consistent behavior across all queries
                  const cleanedText = cleanResponseText(displayedText);
                  
                  // CRITICAL: Set isLoading to false as soon as text appears to stop animations immediately
                  // This ensures spinning animations stop when response text starts displaying
                  setChatMessages(prev => prev.map(msg => {
                    if (msg.id === loadingResponseId) {
                      // If this is the first time we're adding text, set isLoading to false
                      const wasLoading = msg.isLoading;
                      const hasTextNow = cleanedText.trim().length > 0;
                      
                      if (wasLoading && hasTextNow) {
                        console.log('✅ SideChatPanel: Response text appeared, setting isLoading to false (initial query):', {
                          loadingResponseId,
                          textLength: cleanedText.length,
                          textPreview: cleanedText.substring(0, 100)
                        });
                        
                        // Update chat status to completed when text first appears
                        if (currentChatId) {
                          updateChatStatus(currentChatId, 'completed');
                        }
                      }
                      
                      return { ...msg, text: cleanedText, isLoading: false };
                    }
                    return msg;
                  }));
                  
                  // Determine delay based on block type and size
                  // Headings: slightly longer delay
                  // Regular blocks: shorter delay for smooth streaming
                  const isHeading = block.match(/^##+\s+/);
                  const blockSize = block.length;
                  const delay = isHeading ? 60 : Math.min(40, Math.max(20, blockSize / 3)); // 20-40ms, longer for headings
                  
                  setTimeout(processNext, delay);
                } else {
                  isProcessingQueue = false;
                }
              };
              
              processNext();
            };
            
            // Process tokens and extract complete blocks
            const processTokensWithDelay = () => {
              // Extract complete blocks from current buffer
              extractCompleteBlocks();
              
              // If we have blocks in queue and not processing, start processing
              if (blockQueue.length > 0 && !isProcessingQueue) {
                processBlockQueue();
              }
            };
            
            // Create AbortController for initial query (query prop - no chat history yet)
            const initialQueryAbortController = new AbortController();
            // Note: This path doesn't have currentChatId yet, so we use old ref
            abortControllerRef.current = initialQueryAbortController;
            
            // Convert selected document IDs to array for initial query
            const initialDocumentIds = selectedDocumentIds.size > 0 
              ? Array.from(selectedDocumentIds) 
              : undefined;
            
            if (initialDocumentIds && initialDocumentIds.length > 0) {
              console.log(`📄 SideChatPanel: Query with ${initialDocumentIds.length} document filter(s)`);
            }
            
            // Track accumulated citations for real-time updates
            const accumulatedCitations: Record<string, CitationDataType> = {};
            
            await backendApi.queryDocumentsStreamFetch(
              queryText,
              propertyId,
              [], // No message history for initial query
              sessionId,
              // onToken: Buffer tokens until we have complete markdown blocks, then display formatted
              (token: string) => {
                accumulatedText += token;
                tokenBuffer += token;
                
                // Process tokens to find complete markdown blocks
                // This allows ReactMarkdown to render formatted output progressively
                processTokensWithDelay();
              },
              // onComplete: Final response received - flush buffer and complete animation
              (data: any) => {
                // Extract any remaining complete blocks
                extractCompleteBlocks();
                
                // Flush any remaining incomplete buffer - add to displayed text
                if (tokenBuffer.trim() || pendingBuffer.trim()) {
                  displayedText += pendingBuffer + tokenBuffer;
                  pendingBuffer = '';
                  tokenBuffer = '';
                  
                  // Clean the text but don't complete markdown here
                  // StreamingResponseText will handle completion based on isStreaming state
                  const cleanedText = cleanResponseText(displayedText);
                  
                  // Update with final text
                  setChatMessages(prev => prev.map(msg => 
                    msg.id === loadingResponseId 
                      ? { ...msg, text: cleanedText }
                      : msg
                  ));
                }
                
                // Wait for queue to finish processing, then set final text
                const finalizeText = () => {
                  // Citation context is cleared by parent (MainContent) after query
                // Use displayedText as source of truth - it was pre-completed during streaming
                // This ensures text doesn't change when streaming completes (prevents "click" effect)
                // Fallback to data.summary only if displayedText is empty
                  const finalText = cleanResponseText(displayedText || data.summary || accumulatedText || "I found some information for you.");
                  
                  // Merge accumulated citations with any from backend complete message
                  const mergedCitations = { ...accumulatedCitations, ...(data.citations || {}) };
                
                console.log('✅ SideChatPanel: LLM streaming complete for initial query:', {
                  summary: finalText.substring(0, 100),
                  documentsFound: data.relevant_documents?.length || 0,
                    citations: Object.keys(mergedCitations).length
                });
                
                // Hide bot status overlay when streaming completes
                // BUT keep it visible in agent mode if navigation task or document opening is in progress
                if (!isAgentModeRef.current || (!isNavigatingTaskRef.current && !isOpeningDocumentRef.current)) {
                  setIsBotActive(false);
                }
                
                // Clear resume processing ref when query completes
                resumeProcessingRef.current = null;
                
                  // Set the complete formatted text
                setChatMessages(prev => {
                  const existingMessage = prev.find(msg => msg.id === loadingResponseId);
                const responseMessage: ChatMessage = {
                  id: loadingResponseId,
                  type: 'response',
                  text: finalText,
                    isLoading: false,
                    reasoningSteps: existingMessage?.reasoningSteps || [], // Preserve reasoning steps
                      citations: mergedCitations // Merged citations applied once
                };
                
                  const updated = prev.map(msg => 
                    msg.id === loadingResponseId 
                      ? responseMessage
                      : msg
                  );
                  persistedChatMessagesRef.current = updated;
                  return updated;
                });
                };
                
                // Wait for queue to finish processing (max 2 seconds), then finalize
                const maxWait = 2000;
                const checkInterval = 100;
                let waited = 0;
                const checkQueue = setInterval(() => {
                  waited += checkInterval;
                  if (!isProcessingQueue && blockQueue.length === 0 && !tokenBuffer.trim() && !pendingBuffer.trim()) {
                    clearInterval(checkQueue);
                    finalizeText();
                  } else if (waited >= maxWait) {
                    clearInterval(checkQueue);
                    finalizeText();
                  }
                }, checkInterval);
              },
              // onError: Handle errors
              (error: string) => {
                // Categorize error types for better handling
                const isNetworkError = error.includes('ERR_INCOMPLETE_CHUNKED_ENCODING') || 
                                      error.includes('Connection interrupted') ||
                                      error.includes('Failed to fetch') ||
                                      error.includes('network error');
                
                // Log network errors as warnings (less severe), others as errors
                if (isNetworkError) {
                  console.warn('⚠️ SideChatPanel: Network error during streaming (initial query):', error);
                } else {
                  console.error('❌ SideChatPanel: Streaming error for initial query:', error);
                }
                
                // Update chat status to 'completed' even on error
                if (currentChatId) {
                  updateChatStatus(currentChatId, 'completed');
                  // Clean up abort controller
                  delete abortControllersRef.current[currentChatId];
                }
                
                // Hide bot status overlay on error
                setIsBotActive(false);
                
                const errorText = isNetworkError 
                  ? 'Connection was interrupted. Please try again.'
                  : `Sorry, I encountered an error while processing your query. Please try again or contact support if the issue persists. Error: ${error}`;
                
                setChatMessages(prev => {
                  const existingMessage = prev.find(msg => msg.id === loadingResponseId);
                const errorMessage: ChatMessage = {
                  id: loadingResponseId,
                  type: 'response',
                  text: errorText,
                    isLoading: false,
                    reasoningSteps: existingMessage?.reasoningSteps || [] // Preserve reasoning steps
                };
                
                  const updated = prev.map(msg => 
                    msg.id === loadingResponseId 
                      ? errorMessage
                      : msg
                  );
                  persistedChatMessagesRef.current = updated;
                  return updated;
                });
                
                toast({
                  description: 'Failed to get AI response. Please try again.',
                  duration: 5000,
                  variant: 'destructive',
                });
              },
              // onStatus: Show status messages
              (message: string) => {
                console.log('📊 SideChatPanel: Status:', message);
                // Update bot status overlay with current activity
                setBotActivityMessage(message);
              },
              // abortSignal: Pass abort signal for cancellation
              initialQueryAbortController.signal,
              // documentIds: Pass selected document IDs to filter search
              initialDocumentIds,
              // onReasoningStep: Handle reasoning step events
              (step: { step: string; action_type?: string; message: string; count?: number; details: any }) => {
                
                setChatMessages(prev => {
                  const updated = prev.map(msg => {
                    if (msg.id === loadingResponseId) {
                      const existingSteps = msg.reasoningSteps || [];
                      const stepKey = `${step.step}:${step.message}`;
                      const now = Date.now();
                      const existingIndex = existingSteps.findIndex(s => 
                        `${s.step}:${s.message}` === stepKey && (now - s.timestamp) < 500
                      );
                      
                      if (existingIndex >= 0) {
                        return msg;
                      }
                      
                      const newStep: ReasoningStep = {
                        step: step.step,
                        action_type: (step.action_type as ReasoningStep['action_type']) || 'analysing',
                        message: step.message,
                        count: step.count,
                        details: step.details,
                        timestamp: now
                      };
                      
                      return { ...msg, reasoningSteps: [...existingSteps, newStep] };
                    }
                    return msg;
                  });
                  persistedChatMessagesRef.current = updated;
                  return updated;
                });
              },
              // onReasoningContext: Handle LLM-generated contextual narration
              (context: { message: string; moment: string }) => {
                console.log('🟢 SideChatPanel: Received reasoning context:', context);
                
                setChatMessages(prev => {
                  const updated = prev.map(msg => {
                    if (msg.id === loadingResponseId) {
                      const existingSteps = msg.reasoningSteps || [];
                      const contextStep: ReasoningStep = {
                        step: `context_${context.moment}`,
                        action_type: 'context',
                        message: context.message,
                        details: { moment: context.moment },
                        timestamp: Date.now()
                      };
                      return { ...msg, reasoningSteps: [...existingSteps, contextStep] };
                    }
                    return msg;
                  });
                  persistedChatMessagesRef.current = updated;
                  return updated;
                });
              },
              // onCitation: Accumulate citations locally (NO state updates to avoid re-render storm)
              // Preloading happens via reasoning steps, so we just accumulate here
              (citation: { citation_number: string | number; data: any }) => {
                const citationNumStr = String(citation.citation_number);
                
                // Normalize bbox
                const citationBbox = citation.data.bbox;
                let normalizedBbox: { left: number; top: number; width: number; height: number; page?: number } | null = null;
                
                if (citationBbox && typeof citationBbox === 'object') {
                  if (typeof citationBbox.left === 'number' && 
                      typeof citationBbox.top === 'number' && 
                      typeof citationBbox.width === 'number' && 
                      typeof citationBbox.height === 'number') {
                    normalizedBbox = {
                      left: citationBbox.left,
                      top: citationBbox.top,
                      width: citationBbox.width,
                      height: citationBbox.height,
                      page: citationBbox.page ?? citation.data.page ?? citation.data.page_number
                    };
                  }
                }
                
                const finalBbox = normalizedBbox || { left: 0, top: 0, width: 0, height: 0 };
                const docId = citation.data.doc_id ?? citation.data.document_id;
                const pageNum = citation.data.page ?? citation.data.page_number ?? 0;
                // Accumulate citation locally - will be applied in onComplete
                accumulatedCitations[citationNumStr] = {
                  doc_id: docId,
                  page: pageNum,
                  bbox: finalBbox,
                  method: citation.data.method,
                  block_id: citation.data.block_id,
                  original_filename: citation.data.original_filename,
                  cited_text: citation.data.cited_text
                };
                // Preload citation preview so pop-up loads fast when user clicks
                if (docId && pageNum) {
                  preloadHoverPreview(docId, pageNum).catch(() => {});
                }
              },
              undefined, // onExecutionEvent
              // citationContext: Pass structured citation metadata (hidden from user, for LLM)
              citationContext || undefined,
              undefined, // responseMode
              undefined, // attachmentContext
              // AGENT-NATIVE: Handle agent actions
              (action: { action: string; params: any }) => {
                console.log('🎯 [AGENT_ACTION] Received action (initial query):', action);
                
                // Skip agent actions in reader mode - just show citations without auto-opening
                // Use ref to get current mode value (avoids closure issues)
                if (!isAgentModeRef.current) {
                  console.log('📖 [READER_MODE] Skipping agent action (initial) - reader mode active');
                  return;
                }
                
                console.log('✅ [AGENT_MODE] Executing agent action (initial):', action.action);
                
                switch (action.action) {
                  case 'open_document':
                    console.log('📂 [AGENT_ACTION] Opening document (initial):', action.params.doc_id, 'page:', action.params.page, 'bbox:', action.params.bbox);
                    if (action.params.doc_id) {
                      // AGENT GLOW: Activate glowing border effect before opening
                      setIsAgentOpening(true);
                      // Keep bot overlay visible during document opening
                      isOpeningDocumentRef.current = true;
                      setBotActivityMessage('Opening document...');
                      
                      // Use the citation data from the backend action directly
                      const citationData = {
                        doc_id: action.params.doc_id,
                        page: action.params.page || 1,
                        original_filename: action.params.filename || '',
                        bbox: action.params.bbox || undefined
                      };
                      
                      handleCitationClick(citationData as any, true); // fromAgentAction=true (backend emits reasoning step)
                      // NOTE: handleCitationClick calls openExpandedCardView which stores in ChatStateStore
                    }
                    break;
                  case 'highlight_bbox':
                    // Legacy: highlight_bbox is now combined into open_document
                    console.log('⚠️ [AGENT_ACTION] Legacy highlight_bbox received (initial)');
                    break;
                  case 'navigate_to_property':
                    // CRITICAL: Close document preview immediately when navigating to property
                    // This prevents old content from remaining visible during navigation
                    console.log('🧭 [AGENT_ACTION] navigate_to_property received (initial) - closing preview and navigating');
                    // Set navigation flag to prevent fullscreen restoration
                    isNavigatingTaskRef.current = true;
                    wasFullscreenBeforeCitationRef.current = false;
                    // IMMEDIATELY close any open document preview to clear old content
                    closeExpandedCardView();
                    // Update bot status to show navigation activity
                    setBotActivityMessage('Navigating...');
                    if (action.params.property_id && onOpenProperty) {
                      onOpenProperty(null, null, action.params.property_id);
                    }
                    break;
                  case 'show_map_view':
                    // SEQUENCED FLOW for initial load
                    // NOTE: Do NOT call onMapToggle() - that hides the chat!
                    console.log('🗺️ [AGENT_ACTION] show_map_view received (initial) - queuing:', action.params);
                    // CRITICAL: Reset fullscreen restoration flags IMMEDIATELY
                    wasFullscreenBeforeCitationRef.current = false;
                    isFullscreenFromDashboardRef.current = false;
                    isNavigatingTaskRef.current = true;
                    // Update bot status to show navigation activity
                    setBotActivityMessage('Navigating...');
                    // Close any open document preview (won't trigger fullscreen restoration now)
                    closeExpandedCardView();
                    // Exit fullscreen mode IMMEDIATELY
                    setIsFullscreenMode(false);
                    setTimeout(() => {
                      const navMinWidth = CHAT_PANEL_WIDTH.NAV_MIN;
                      setDraggedWidth(navMinWidth);
                      lockedWidthRef.current = null;
                      if (onChatWidthChange) {
                        onChatWidthChange(navMinWidth);
                      }
                      // Map is already rendered behind the chat - shrinking reveals it
                    }, 600);
                    break;
                  case 'select_property_pin':
                    // SEQUENCED FLOW for initial load
                    console.log('📍 [AGENT_ACTION] select_property_pin received (initial) - queuing:', action.params);
                    // CRITICAL: Reset fullscreen restoration flags IMMEDIATELY
                    wasFullscreenBeforeCitationRef.current = false;
                    isFullscreenFromDashboardRef.current = false;
                    isNavigatingTaskRef.current = true;
                    // Close any open document preview (won't trigger fullscreen restoration now)
                    closeExpandedCardView();
                    // Exit fullscreen mode IMMEDIATELY
                    setIsFullscreenMode(false);
                    setTimeout(() => {
                      setAgentTaskActive(true, 'Navigating to property...');
                      setMapNavigating(true);
                      const pinNavMinWidth = CHAT_PANEL_WIDTH.NAV_MIN;
                      setDraggedWidth(pinNavMinWidth);
                      lockedWidthRef.current = null;
                      if (onChatWidthChange) {
                        onChatWidthChange(pinNavMinWidth);
                      }
                      setTimeout(() => {
                        if (action.params.property_id && onOpenProperty) {
                          const coords = action.params.latitude && action.params.longitude 
                            ? { lat: action.params.latitude, lng: action.params.longitude }
                            : undefined;
                          onOpenProperty(action.params.address || null, coords || null, action.params.property_id, true);
                          setTimeout(() => {
                            setAgentTaskActive(false);
                            setMapNavigating(false);
                            setIsBotActive(false); // Hide bot status overlay when navigation completes
                            // NOTE: Don't reset isNavigatingTaskRef here - it prevents fullscreen re-expansion
                            // Will be reset when next query starts
                          }, 1000);
                        }
                      }, 500);
                    }, 800);
                    break;
                  case 'search_property_result':
                    console.log('🔍 [AGENT_ACTION] search_property_result received (initial):', action.params);
                    (window as any).__lastPropertySearchResult = action.params;
                    break;
                  case 'save_to_writing':
                    if (action.params.citation) {
                      const curatedKey = 'curated_writing_citations';
                      const existing = JSON.parse(localStorage.getItem(curatedKey) || '[]');
                      const newEntry = {
                        id: `citation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        citation: action.params.citation,
                        addedAt: new Date().toISOString(),
                        documentName: action.params.citation.original_filename || 'Unknown document',
                        content: action.params.citation.block_content || action.params.note || ''
                      };
                      existing.push(newEntry);
                      localStorage.setItem(curatedKey, JSON.stringify(existing));
                      window.dispatchEvent(new CustomEvent('citation-added-to-writing', { detail: newEntry }));
                    }
                    break;
                }
              },
              isAgentModeRef.current, // Pass agent mode to backend for tool-based actions
              selectedModelRef.current, // Pass selected model to backend
              // onThinkingChunk: Stream Claude's extended thinking in real-time
              (chunk: string) => {
                setChatMessages(prev => prev.map(msg => {
                  if (msg.id === loadingResponseId) {
                    const updatedSteps = (msg.reasoningSteps || []).map(step => {
                      if (step.action_type === 'thinking') {
                        return {
                          ...step,
                          details: {
                            ...step.details,
                            thinking_content: (step.details?.thinking_content || '') + chunk
                          }
                        };
                      }
                      return step;
                    });
                    return { ...msg, reasoningSteps: updatedSteps };
                  }
                  return msg;
                }));
              },
              // onThinkingComplete: Finalize thinking content
              (fullThinking: string) => {
                console.log('🧠 Extended thinking complete:', fullThinking.length, 'chars');
              }
            );
            
            // Clear abort controller and processing flag on completion
            abortControllerRef.current = null;
            isProcessingQueryRef.current = false;
          } catch (error) {
            abortControllerRef.current = null;
            isProcessingQueryRef.current = false;
            // Hide bot status overlay on error
            setIsBotActive(false);
            // Don't log error if it was aborted
            if (error instanceof Error && error.message !== 'Request aborted') {
              console.error('❌ SideChatPanel: Error calling LLM API for initial query:', error);
            }
            
            // Show error message instead of mock response
            setChatMessages(prev => {
              const existingMessage = prev.find(msg => msg.id === loadingResponseId);
            const errorMessage: ChatMessage = {
              id: `response-${Date.now()}`,
              type: 'response',
              text: `Sorry, I encountered an error while processing your query. Please try again or contact support if the issue persists. Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                isLoading: false,
                reasoningSteps: existingMessage?.reasoningSteps || [] // Preserve reasoning steps
            };
            
              const updated = prev.map(msg => 
                msg.id === loadingResponseId 
                  ? errorMessage
                  : msg
              );
              persistedChatMessagesRef.current = updated;
              return updated;
            });
            
            // Show error toast
            toast({
              description: 'Failed to get AI response. Please try again.',
              duration: 5000,
              variant: 'destructive',
            });
          }
        })();
      }
    }
  }, [isVisible, query, restoreChatId, getChatById, currentChatId, clearPropertyAttachments, updateChatStatus, openExpandedCardView, getChatState]);



  // Update @ mention popover state from current value and cursor position
  const handleAtSelect = React.useCallback(
    (item: AtMentionItem) => {
      const startPlain = Math.max(0, atAnchorIndex);
      const endPlain = segmentInput.getCursorOffset();
      const startPos = segmentInput.getSegmentOffsetFromPlain(startPlain);
      const endPos = segmentInput.getSegmentOffsetFromPlain(endPlain);
      if (startPos != null && endPos != null) {
        segmentInput.removeSegmentRange(startPos.segmentIndex, startPos.offset, endPos.segmentIndex, endPos.offset);
      } else {
        segmentInput.removeRange(startPlain, endPlain);
      }
      setAtMentionOpen(false);
      setAtItems([]);
      if (item.type === 'property' && item.payload) {
        addPropertyAttachment(item.payload as unknown as Parameters<typeof addPropertyAttachment>[0]);
        segmentInput.insertChipAtCursor(
          {
            type: 'chip',
            kind: 'property',
            id: (item.payload as { id: string }).id,
            label: (item.payload as { address?: string }).address || item.primaryLabel,
            payload: item.payload,
          },
          { trailingSpace: true }
        );
      } else {
        toggleDocumentSelection(item.id);
        setAtMentionDocumentChips((prev) => [...prev, { id: item.id, label: item.primaryLabel }]);
        segmentInput.insertChipAtCursor(
          { type: 'chip', kind: 'document', id: item.id, label: item.primaryLabel },
          { trailingSpace: true }
        );
      }
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        requestAnimationFrame(() => restoreSelectionRef.current?.());
      });
    },
    [atAnchorIndex, addPropertyAttachment, toggleDocumentSelection, segmentInput]
  );

  const handleFileUpload = React.useCallback((file: File) => {
    console.log('📎 SideChatPanel: handleFileUpload called with file:', file.name);
    
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
      }
    };
    
    // Preload immediately
    preloadBlobUrl();
    
    setAttachedFiles(prev => {
      const updated = [...prev, fileData];
      attachedFilesRef.current = updated; // Update ref immediately
      return updated;
    });
    console.log('✅ SideChatPanel: File attached:', fileData, `(${attachedFiles.length + 1}/${MAX_FILES})`);
    
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
  }, [attachedFiles.length]);

  // Handle drop from FilingSidebar
  const handleDrop = React.useCallback(async (e: React.DragEvent) => {
    console.log('📥 SideChatPanel: handleDrop called', {
      types: Array.from(e.dataTransfer.types),
      files: e.dataTransfer.files.length,
      target: (e.target as HTMLElement)?.tagName,
      currentTarget: (e.currentTarget as HTMLElement)?.tagName
    });
    
    e.preventDefault();
    e.stopPropagation();
    isDragOverRef.current = false;
    setIsDragOver(false);
    
    try {
      // Check if this is a document from FilingSidebar
      const jsonData = e.dataTransfer.getData('application/json');
      if (jsonData) {
        const data = JSON.parse(jsonData);
        if (data.type === 'filing-sidebar-document') {
          console.log('📥 SideChatPanel: Dropped document from FilingSidebar:', data.filename);
          
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
          
          // Fetch the actual file in the background
          (async () => {
            try {
              const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
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
              
              console.log('✅ SideChatPanel: Document fetched and updated:', actualFile.name);
            } catch (error) {
              console.error('❌ SideChatPanel: Error fetching document:', error);
              // Remove the optimistic attachment on error
              setAttachedFiles(prev => {
                const updated = prev.filter(att => att.id !== attachmentId);
                attachedFilesRef.current = updated;
                return updated;
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
      console.error('❌ SideChatPanel: Error handling drop:', error);
      toast({
        description: 'Failed to add document. Please try again.',
        duration: 3000,
      });
    }
  }, [handleFileUpload]);

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Stop propagation like SearchBar
    
    // Check if this is a document from FilingSidebar (has application/json type) or regular files
    const hasFilingSidebarDocument = e.dataTransfer.types.includes('application/json');
    const hasFiles = e.dataTransfer.types.includes('Files');
    
    console.log('🔄 SideChatPanel: handleDragOver called', { 
      hasFilingSidebarDocument, 
      hasFiles, 
      types: Array.from(e.dataTransfer.types),
      target: (e.target as HTMLElement)?.tagName,
      currentTarget: (e.currentTarget as HTMLElement)?.tagName
    });
    
    if (hasFilingSidebarDocument || hasFiles) {
      e.dataTransfer.dropEffect = 'move';
      isDragOverRef.current = true;
      setIsDragOver(true);
      console.log('✅ SideChatPanel: Setting isDragOver to true');
    } else {
      e.dataTransfer.dropEffect = 'none';
      isDragOverRef.current = false;
      setIsDragOver(false);
      console.log('❌ SideChatPanel: No valid drag types, setting isDragOver to false');
    }
  }, []);

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    // Only clear drag state if we're actually leaving the drop zone
    // Use simple relatedTarget check like SearchBar
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!e.currentTarget.contains(relatedTarget)) {
      isDragOverRef.current = false;
      setIsDragOver(false);
    }
  }, []);

  // Handle opening document selection mode
  const handleOpenDocumentSelection = React.useCallback(() => {
    toggleDocumentSelectionMode();
  }, [toggleDocumentSelectionMode]);

  const handleRemoveFile = React.useCallback((fileId: string) => {
    setAttachedFiles(prev => {
      const updated = prev.filter(f => f.id !== fileId);
      attachedFilesRef.current = updated; // Update ref immediately
      return updated;
    });
    
    // Clean up blob URL if it exists
    if ((window as any).__preloadedAttachmentBlobs?.[fileId]) {
      URL.revokeObjectURL((window as any).__preloadedAttachmentBlobs[fileId]);
      delete (window as any).__preloadedAttachmentBlobs[fileId];
    }
  }, []);


  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const clearInputAndChips = React.useCallback(() => {
    setInputValue('');
    segmentInput.setSegments([{ type: 'text', value: '' }]);
    setAtMentionDocumentChips([]);
  }, [segmentInput]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitted = segmentInput.getPlainText().trim();
    
    // PLAN MODE: Intercept and show plan viewer instead of normal flow
    if (isPlanModeRef.current && submitted) {
      // CRITICAL: Capture current plan content BEFORE clearing it
      const currentPlanContent = planContent;
      const isFollowUpQuery = showPlanViewer && currentPlanContent.length > 0;
      
      // If this is a follow-up (updating existing plan), set up update state
      if (isFollowUpQuery) {
        setPreviousPlanContent(currentPlanContent);
        setIsUpdatingPlan(true);  // Set IMMEDIATELY for instant reasoning steps
        setAdjustmentQuery(submitted);  // Set IMMEDIATELY
        // Reset incremental diff state
        setIncrementalAdjustments([]);
        seenAdjustmentIdsRef.current.clear();
        lastDiffCheckRef.current = { content: '', timestamp: Date.now(), chunkCount: 0 };
      } else {
        setPreviousPlanContent('');
        setIsUpdatingPlan(false);
        setAdjustmentQuery('');
      }
      
      // Store query text for later use
      setPlanQueryText(submitted);
      setPlanBuildStatus('streaming');
      // Only clear content and hide viewer for NEW queries, not follow-ups
      if (!isFollowUpQuery) {
        setPlanContent(''); // Only clear for new queries
        setShowPlanViewer(false); // Only hide for new queries
      }
      setPlanGenerationReasoningSteps([]); // Clear previous reasoning steps
      
      // Only add query to chat messages for NEW queries (not follow-ups)
      // Follow-up queries are rendered below the plan viewer using adjustmentQuery
      if (!isFollowUpQuery) {
        const queryMessageId = `query-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const queryMessage: ChatMessage = {
          id: queryMessageId,
          type: 'query',
          text: submitted
        };
        setChatMessages(prev => [...prev, queryMessage]);
      }
      
      clearInputAndChips();
      
      // Call API with planMode=true
      (async () => {
        let accumulatedPlan = '';
        try {
          await backendApi.queryDocumentsStreamFetch(
            submitted,
            undefined,
            [],
            sessionId,
            () => {}, // onToken - not used for plan mode
            () => {}, // onComplete - not used for plan mode
            (error) => {
              console.error('📋 [PLAN_MODE] Error:', error);
              setPlanBuildStatus('error');
            },
            undefined, // onStatus
            undefined, // abortSignal
            undefined, // documentIds
            undefined, // onReasoningStep
            undefined, // onReasoningContext
            undefined, // onCitation
            undefined, // onExecutionEvent
            undefined, // citationContext
            undefined, // responseMode
            undefined, // attachmentContext
            undefined, // onAgentAction
            false, // isAgentMode
            selectedModel, // model
            undefined, // onThinkingChunk
            undefined, // onThinkingComplete
            // Plan mode callbacks
            (chunk: string) => {
              accumulatedPlan += chunk;
              setPlanContent(accumulatedPlan);
              
              // Incremental diff logic (only for follow-up/update queries)
              if (isFollowUpQuery && currentPlanContent) {
                const check = lastDiffCheckRef.current;
                check.chunkCount++;
                const timeSinceLastCheck = Date.now() - check.timestamp;
                const contentGrowth = accumulatedPlan.length - check.content.length;
                
                const shouldCheck = 
                  isSectionComplete(accumulatedPlan, check.content) ||
                  contentGrowth > 500 ||
                  check.chunkCount >= 10 ||
                  timeSinceLastCheck > 2000;
                
                if (shouldCheck && check.content !== accumulatedPlan) {
                  const allAdjustments = extractAdjustmentsFromDiff(currentPlanContent, accumulatedPlan);
                  const newAdjustments = allAdjustments.filter(adj => !seenAdjustmentIdsRef.current.has(adj.id));
                  
                  if (newAdjustments.length > 0) {
                    newAdjustments.forEach(adj => seenAdjustmentIdsRef.current.add(adj.id));
                    setIncrementalAdjustments(allAdjustments);
                    setVisibleAdjustmentCount(allAdjustments.length);
                  }
                  
                  check.content = accumulatedPlan;
                  check.timestamp = Date.now();
                  check.chunkCount = 0;
                }
              }
            },
            (planIdReceived: string, fullPlan: string, isUpdate?: boolean) => {
              console.log('📋 [PLAN_MODE] Plan complete:', { planId: planIdReceived, planLength: fullPlan.length, isUpdate });
              setPlanId(planIdReceived);
              setPlanContent(fullPlan);
              setPlanBuildStatus('ready');
              
              // Clear reasoning steps and show plan viewer now that plan is ready
              setPlanGenerationReasoningSteps([]);
              setShowPlanViewer(true);
              
              // Final diff to ensure all adjustments captured
              if (isUpdate && currentPlanContent) {
                const finalAdjustments = extractAdjustmentsFromDiff(currentPlanContent, fullPlan);
                setIncrementalAdjustments(finalAdjustments);
                // Don't reset visibleAdjustmentCount here - let staggered reveal handle it
              }
              
              // Track if this was an update (keep for backwards compat, but isUpdatingPlan already set)
              if (isUpdate) {
                setIsUpdatingPlan(true);
                setAdjustmentQuery(submitted);
              }
            },
            true, // planMode
            isFollowUpQuery ? currentPlanContent : undefined // existingPlan for updates - use captured value
          );
        } catch (error) {
          console.error('📋 [PLAN_MODE] Failed to generate plan:', error);
          setPlanBuildStatus('error');
        }
      })();
      
      return; // Don't continue with normal flow
    }
    
    // FIRST: Show bot status overlay immediately (before any processing) - ONLY in agent mode
    if (isAgentMode) {
      console.log('🤖 [BOT_STATUS] Activating bot status overlay');
      setIsBotActive(true);
      setBotActivityMessage('Running...');
      setIsBotPaused(false);
      isBotPausedRef.current = false; // Reset pause ref
    }
    
    // Reset navigation task flag on new query - allows fullscreen expansion for fresh queries
    isNavigatingTaskRef.current = false;
    
    // CRITICAL: Sync initialAttachedFiles to state if they exist and state is empty
    // This ensures attachments from SearchBar are included when submitting via input field
    if (initialAttachedFiles && initialAttachedFiles.length > 0 && attachedFiles.length === 0) {
      console.log('📎 SideChatPanel: Syncing initialAttachedFiles to state in handleSubmit');
      setAttachedFiles(initialAttachedFiles);
      attachedFilesRef.current = initialAttachedFiles;
    }
    
    if ((submitted || attachedFiles.length > 0 || propertyAttachments.length > 0) && !isSubmitted && onQuerySubmit) {
      setIsSubmitted(true);
      
      // Create a copy of attachments to store with the query
      // Use ref for most up-to-date attachments, fallback to state, then initial
      const attachmentsFromRef = attachedFilesRef.current;
      const attachmentsToStore = attachmentsFromRef.length > 0 
        ? [...attachmentsFromRef]
        : (attachedFiles.length > 0 
          ? [...attachedFiles]
          : (initialAttachedFiles ? [...initialAttachedFiles] : []));
      
      console.log('📎 SideChatPanel: handleSubmit using attachments:', {
        fromRef: attachmentsFromRef.length,
        fromState: attachedFiles.length,
        fromInitial: initialAttachedFiles?.length || 0,
        final: attachmentsToStore.length,
        attachmentNames: attachmentsToStore.map(a => a.name)
      });
      const propertiesToStore = [...propertyAttachments];
      
      // Add query with attachments to the submitted queries list (for backward compatibility)
      setSubmittedQueries(prev => [...prev, { 
        text: submitted || '', 
        attachments: attachmentsToStore 
      }]);
      
      // Get selected document IDs (use ref so we see latest selection at send time)
      const currentSel = selectedDocumentIdsRef.current;
      const selectedDocIds = (currentSel?.size ?? 0) > 0 
        ? Array.from(currentSel) 
        : undefined;
      
      // Get document names: from property when available, otherwise from atMentionDocumentChips (chip labels)
      let selectedDocNames: string[] | undefined = undefined;
      if (selectedDocIds && selectedDocIds.length > 0) {
        if (propertiesToStore.length > 0) {
          const property = propertiesToStore[0].property as any;
          if (property?.propertyHub?.documents) {
            const fromProperty = selectedDocIds
              .map(docId => {
                const doc = property.propertyHub.documents.find((d: any) => d.id === docId);
                return doc?.original_filename;
              })
              .filter((name): name is string => !!name);
            if (fromProperty.length === selectedDocIds.length) selectedDocNames = fromProperty;
          }
        }
        if (!selectedDocNames && atMentionDocumentChips.length > 0) {
          selectedDocNames = selectedDocIds
            .map(docId => atMentionDocumentChips.find(c => c.id === docId)?.label ?? docId);
        }
      }
      
      // Citation context: from prop or from first citation_snippet chip (Ask follow up)
      const effectiveCitationContext = citationContext ?? (() => {
        const first = segmentInput.segments.find((s) => isChipSegment(s) && s.kind === 'citation_snippet');
        if (!first || !isChipSegment(first)) return undefined;
        const p = first.payload as { citationData?: any; sourceMessageText?: string };
        const c = p?.citationData;
        if (!c) return undefined;
        return {
          document_id: c.document_id ?? c.doc_id ?? '',
          page_number: c.page ?? c.page_number ?? c.bbox?.page ?? 1,
          bbox: c.bbox ?? { left: 0, top: 0, width: 0, height: 0 },
          original_filename: c.original_filename ?? '',
          cited_text: first.label || c.cited_text || c.block_content || '',
          block_id: c.block_id,
          source_message_text: p?.sourceMessageText,
        };
      })();
      
      // Build ordered content segments so the bubble shows chips + text in the same order as the input
      const contentSegments: QueryContentSegment[] = [];
      for (const seg of segmentInput.segments) {
        if (isTextSegment(seg)) {
          if (seg.value) contentSegments.push({ type: 'text', value: seg.value });
        } else if (isChipSegment(seg)) {
          if (seg.kind === 'property') {
            const attachment = propertiesToStore.find(
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
          } else if (seg.kind === 'citation_snippet') {
            contentSegments.push({
              type: 'citation_snippet',
              snippet: seg.label,
              citationData: (seg.payload as any)?.citationData,
            });
          } else {
            const name = atMentionDocumentChips.find((c) => c.id === seg.id)?.label ?? seg.label ?? seg.id;
            contentSegments.push({ type: 'document', id: seg.id, name });
          }
        }
      }
      
      // Add query message to chat
      const queryId = `query-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newQueryMessage: ChatMessage = {
        id: queryId,
        type: 'query' as const,
        text: submitted || '',
        attachments: attachmentsToStore,
        propertyAttachments: propertiesToStore, // Always include, even if empty array
        selectedDocumentIds: selectedDocIds,
        selectedDocumentNames: selectedDocNames,
        contentSegments: contentSegments.length > 0 ? contentSegments : undefined,
        fromCitation: !!effectiveCitationContext, // Mark if query came from citation (prop or citation_snippet chip)
        citationBboxData: effectiveCitationContext ? {
          document_id: effectiveCitationContext.document_id,
          page_number: effectiveCitationContext.page_number,
          bbox: effectiveCitationContext.bbox,
          original_filename: effectiveCitationContext.original_filename,
          block_id: (effectiveCitationContext as any).block_id || undefined
        } : undefined
      };
      
      console.log('💬 SideChatPanel: Adding query message:', newQueryMessage);
      console.log('🔍 SideChatPanel: Property attachments in message:', newQueryMessage.propertyAttachments);
      
      // Reset first citation flag if this is a new chat session
      // CRITICAL: Use refs for more reliable detection (avoids stale closure issues)
      // This prevents query leakage between agents when switching quickly
      // Priority: Check ref first (updated synchronously), then state as fallback
      const currentChatIdValue = currentChatIdRef.current ?? currentChatId;
      const currentMessagesLength = chatMessagesRef.current.length || chatMessages.length;
      const isNewChatSession = !currentChatIdValue || currentMessagesLength === 0;
      
      let chatSessionId = sessionId; // Default to component sessionId, will be overridden if new chat
      let savedChatId: string | undefined; // Declare at higher scope for status update
      
      if (isNewChatSession) {
        isFirstCitationRef.current = true;
        console.log('🔄 [CITATION] New chat session detected - resetting first citation flag');
        
        // Generate chat ID and title for new chat
        const newChatId = `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        setCurrentChatId(newChatId);
        currentChatIdRef.current = newChatId; // Update ref synchronously for streaming callbacks
        
        // Generate smart title from first query
        const generatedTitle = generateSmartChatTitle(
          submitted || '',
          propertiesToStore,
          attachmentsToStore
        );
        
        // Extract description from query
        const description = extractDescription(submitted || '');
        
        // Create chat history entry with unique sessionId
        // CRITICAL: Generate unique sessionId tied to chat ID for backend isolation
        const chatHistorySessionId = `session_${newChatId}_${Date.now()}`;
        chatSessionId = chatHistorySessionId; // Use chat's sessionId for this query
        
        savedChatId = addChatToHistory({
          title: generatedTitle,
          timestamp: new Date().toISOString(),
          preview: submitted || '',
          messages: [],
          status: 'completed', // Create with 'completed' status, update to 'loading' when query actually starts
          sessionId: chatHistorySessionId, // Unique sessionId per agent
          description: description // Secondary detail line
        });
        
        // CRITICAL: Update currentChatId to match the actual ID from addChatToHistory
        // This fixes the bug where currentChatId was set to newChatId but addChatToHistory
        // generates a different ID internally. Without this, updateChatInHistory calls
        // would fail to find the chat when switching agents.
        setCurrentChatId(savedChatId);
        currentChatIdRef.current = savedChatId; // Update ref synchronously for streaming callbacks
        
        // Record this query as processed for this chat to prevent re-processing on chat return
        processedQueriesPerChatRef.current[savedChatId] = submitted || '';
        
        console.log('✅ SideChatPanel: Created new chat history entry:', {
          chatId: savedChatId,
          sessionId: chatHistorySessionId,
          status: 'completed',
          description
        });
        
        // Stream the title with typing effect
        streamTitle(generatedTitle);
      } else if (currentChatId) {
        // For existing chat, get sessionId from chat history
        const existingChat = getChatById(currentChatId);
        if (existingChat?.sessionId) {
          chatSessionId = existingChat.sessionId;
          console.log('🔄 SideChatPanel: Using existing chat sessionId:', chatSessionId);
        }
        // Update status to loading for existing chat
        updateChatStatus(currentChatId, 'loading');
      }
      
      setChatMessages(prev => {
        const updated = [...prev, newQueryMessage];
        persistedChatMessagesRef.current = updated;
        console.log('📋 SideChatPanel: Updated chatMessages:', updated);
        return updated;
      });
      
      // Add loading response message
        // CRITICAL: Use performance.now() + random to ensure uniqueness even if called multiple times rapidly
        const loadingResponseId = `response-loading-${performance.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const loadingMessage: ChatMessage = {
        id: loadingResponseId,
        type: 'response',
        text: '',
        isLoading: true,
        reasoningSteps: [] // Initialize empty array for reasoning steps
      };
      setChatMessages(prev => {
        const updated = [...prev, loadingMessage];
        persistedChatMessagesRef.current = updated;
        return updated;
      });
      
      // Initialize reasoning steps tracking for this query
      currentQueryIdRef.current = loadingResponseId;
      
      // Call LLM API to query documents
      (async () => {
        try {
          // Extract property_id from property attachments (first one if multiple)
          const propertyId = propertiesToStore.length > 0 
            ? String(propertiesToStore[0].propertyId) 
            : undefined;
          
          // Build message history from previous messages (excluding the current one)
          const messageHistory = chatMessages
            .filter(msg => (msg.type === 'query' || msg.type === 'response') && msg.text)
            .map(msg => ({
              role: msg.type === 'query' ? 'user' : 'assistant',
              content: msg.text || ''
            }));
          
          console.log('📤 SideChatPanel: Calling LLM API with:', {
            query: submitted,
            propertyId,
            messageHistoryLength: messageHistory.length
          });
          
          // Use streaming API with block-based formatting like ChatGPT
          let accumulatedText = '';
          let tokenBuffer = ''; // Buffer for tokens before displaying
          let displayedText = ''; // Text currently displayed to user (complete markdown blocks only)
          let pendingBuffer = ''; // Buffer for incomplete markdown blocks
          const blockQueue: string[] = []; // Queue of complete markdown blocks to display
          let isProcessingQueue = false;
          
          // Extract complete markdown blocks from buffer using shared helper
          // Pre-completes markdown so text is always valid when stored in state
          const extractCompleteBlocks = () => {
            const combined = pendingBuffer + tokenBuffer;
            const { completeBlocks, remainingBuffer } = extractMarkdownBlocks(combined);
            
            // Add complete blocks to queue (already pre-completed by helper)
            if (completeBlocks.length > 0) {
              blockQueue.push(...completeBlocks);
              // Start processing queue if not already processing
              if (!isProcessingQueue) {
                processBlockQueue();
              }
            }
            
            // Update buffers
            pendingBuffer = remainingBuffer;
            tokenBuffer = '';
          };
          
          // Process block queue with gradual display (streaming effect)
          const processBlockQueue = () => {
            if (isProcessingQueue || blockQueue.length === 0) return;
            
            isProcessingQueue = true;
            
            const processNext = () => {
              // CRITICAL: Check if this chat is still active before updating UI
              // This prevents leakage when user switches to a new chat mid-stream
              const stillActive = isChatActiveForQuery(queryChatId, savedChatId);
              if (!stillActive) {
                console.log('⚠️ [FOLLOW_UP_BLOCK_QUEUE] Chat no longer active, stopping block processing:', {
                  queryChatId,
                  activeChatId: activeChatIdRef.current
                });
                isProcessingQueue = false;
                // Buffer the accumulated text for this chat
                if (queryChatId) {
                  const bufferedState = getBufferedState(queryChatId);
                  bufferedState.accumulatedText = displayedText;
                  bufferedState.lastUpdate = Date.now();
                }
                return;
              }
              
              if (blockQueue.length === 0) {
                isProcessingQueue = false;
                // Check if we have more blocks to extract
                if (tokenBuffer.trim() || pendingBuffer.trim()) {
                  extractCompleteBlocks();
                  if (blockQueue.length > 0) {
                    processBlockQueue();
                  }
                }
                return;
              }
              
              // Get next block from queue
              const block = blockQueue.shift();
              if (block) {
                // Add block to displayed text
                displayedText += block;
                
                // Clean the text (remove EVIDENCE_FEEDBACK tags, etc.) but don't complete markdown here
                // Let StreamingResponseText component handle markdown completion based on isStreaming state
                // This ensures consistent behavior across all queries
                const cleanedText = cleanResponseText(displayedText);
                
                // CRITICAL: Set isLoading to false as soon as text appears to stop animations immediately
                // This ensures spinning animations stop when response text starts displaying
                setChatMessages(prev => prev.map(msg => {
                  if (msg.id === loadingResponseId) {
                    // If this is the first time we're adding text, set isLoading to false
                    const wasLoading = msg.isLoading;
                    const hasTextNow = cleanedText.trim().length > 0;
                    
                    if (wasLoading && hasTextNow) {
                      console.log('✅ SideChatPanel: Response text appeared, setting isLoading to false (follow-up query path 2):', {
                        loadingResponseId,
                        textLength: cleanedText.length,
                        textPreview: cleanedText.substring(0, 100)
                      });
                      
                      // Update chat status to completed when text first appears
                      if (queryChatId) {
                        updateChatStatus(queryChatId, 'completed');
                      }
                    }
                    
                    return { ...msg, text: cleanedText, isLoading: false };
                  }
                  return msg;
                }));
                
                // Determine delay based on block type and size
                // Headings: slightly longer delay
                // Regular blocks: shorter delay for smooth streaming
                const isHeading = block.match(/^##+\s+/);
                const blockSize = block.length;
                const delay = isHeading ? 60 : Math.min(40, Math.max(20, blockSize / 3)); // 20-40ms, longer for headings
                
                setTimeout(processNext, delay);
              } else {
                isProcessingQueue = false;
              }
            };
            
            processNext();
          };
          
          // Process tokens and extract complete blocks
          const processTokensWithDelay = () => {
            // Extract complete blocks from current buffer
            extractCompleteBlocks();
            
            // If we have blocks in queue and not processing, start processing
            if (blockQueue.length > 0 && !isProcessingQueue) {
              processBlockQueue();
            }
          };
          
          // Track accumulated citations for real-time updates
          const accumulatedCitations: Record<string, CitationDataType> = {};
          
          // Create AbortController for this query (handleSubmit path)
          const handleSubmitAbortController = new AbortController();
          if (currentChatId) {
            abortControllersRef.current[currentChatId] = handleSubmitAbortController;
          }
          // Also set in old ref for backward compatibility
          abortControllerRef.current = handleSubmitAbortController;
          
          // Merge document IDs: use ref so we see latest selection at send time
          const currentSelectionHandle = selectedDocumentIdsRef.current;
          const fromSelection = (currentSelectionHandle?.size ?? 0) > 0 ? Array.from(currentSelectionHandle) : [];
          const docChipIdsFromSegments = segmentInput.segments
            .filter((seg): seg is ChipSegment => isChipSegment(seg) && seg.kind === 'document')
            .map((seg) => seg.id)
            .filter(Boolean);
          const mergedDocIds = [...new Set([...fromSelection, ...docChipIdsFromSegments].filter(Boolean))];
          let documentIdsArray: string[] | undefined = mergedDocIds.length > 0 ? mergedDocIds : undefined;
          if (!documentIdsArray?.length && propertiesToStore.length > 0) {
            const firstProperty = propertiesToStore[0].property as any;
            const docs = firstProperty?.propertyHub?.documents;
            if (docs && Array.isArray(docs)) {
              documentIdsArray = docs.map((d: any) => String(d.id ?? d.document_id ?? d)).filter(Boolean);
            }
          }
          
          // Check if attachments have extracted text - show file choice step if so
          let responseMode: 'fast' | 'detailed' | 'full' | undefined;
          let attachmentContext: { texts: string[]; pageTexts: string[][]; filenames: string[]; tempFileIds: string[] } | null = null;
          
          if (hasExtractedAttachments(attachmentsToStore)) {
            console.log('📁 Attachments have extracted text - showing file choice step');
            
            // Wait for user to select response mode
            const userChoice = await showFileChoiceAndWait(loadingResponseId, attachmentsToStore);
            console.log('📁 User selected response mode:', userChoice);
            
            // Map 'project' choice to 'full' for backend (project = full + property linking)
            responseMode = userChoice === 'project' ? 'full' : userChoice;
            
            // Build attachment context for backend
            attachmentContext = buildAttachmentContext(attachmentsToStore);
            
            // Clear the file choice step and add "Processing with..." step
            const processingStep: ReasoningStep = {
              step: 'processing_attachments',
              action_type: 'analysing',
              message: userChoice === 'fast' 
                ? 'Generating fast response...' 
                : userChoice === 'detailed'
                  ? 'Analyzing documents for detailed citations...'
                  : 'Processing and adding to project...',
              details: {},
              timestamp: Date.now()
            };
            
            setChatMessages(prev => prev.map(msg => 
              msg.id === loadingResponseId 
                ? { ...msg, reasoningSteps: [processingStep] }
                : msg
            ));
          }
          
          // Store these values for use in error handler
          const hasAttachmentsForError = attachedFiles.length > 0 || (documentIdsArray && documentIdsArray.length > 0);
          // Link segments so the model sees full sentence with chip context (same rule as query-prop path)
          const rawQuery =
            (segmentInput.segments.length > 0 ? segmentsToLinkedQuery(segmentInput.segments).trim() || submitted : submitted) || '';
          const submittedQuery = stripHtmlFromQuery(rawQuery);
          
          // Track documents currently being preloaded to avoid duplicates
          const preloadingDocs = new Set<string>();
          
          // Helper function to preload a document by doc_id - fires immediately, no delays
          const preloadDocumentById = (docId: string, filename?: string) => {
            // Skip if already cached or currently preloading
            const isCached = previewFiles.some(f => f.id === docId);
            const isPreloading = preloadingDocs.has(docId);
            
            if (isCached || isPreloading) {
              return; // Already handled
            }
            
            // Mark as preloading immediately
            preloadingDocs.add(docId);
            
            // Start download immediately (fire and forget, no setTimeout delay)
            (async () => {
              try {
                const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
                const downloadUrl = `${backendUrl}/api/files/download?document_id=${docId}`;
                
                
                const response = await fetch(downloadUrl, {
                  credentials: 'include'
                });
                
                if (!response.ok) {
                  console.warn('⚠️ [PRELOAD] Failed to download document:', response.status);
                  preloadingDocs.delete(docId);
                  return;
                }
                
                const blob = await response.blob();
                const fileType = blob.type || 'application/pdf';
                
                // Create File object from blob
                const file = new File(
                  [blob], 
                  filename || 'document.pdf', 
                  { type: fileType }
                );
                
                // Preload file to cache WITHOUT opening preview modal
                preloadFile({
                  id: docId,
                  file,
                  name: filename || 'document.pdf',
                  type: fileType,
                  size: blob.size
                });
                
              } catch (err) {
                console.warn('⚠️ [PRELOAD] Error preloading document:', err);
                preloadingDocs.delete(docId);
              }
            })();
          };
          
          // CRITICAL: Use chat's sessionId (not component sessionId) for backend isolation
          // Create abort controller for this query (handleSubmit path - no file attachments)
          const handleSubmitNoFileAbortController = new AbortController();
          
          // CRITICAL: Capture queryChatId at query start (not when callbacks fire)
          // This ensures we use the correct chatId even if user switches chats during query
          // Use savedChatId for new chats, otherwise use ref (more reliable than state)
          const queryChatId = savedChatId || currentChatIdRef.current || currentChatId;
          
          // CRITICAL: Set activeChatIdRef IMMEDIATELY when query starts (before any streaming callbacks)
          // This ensures streaming updates route to the correct chat
          if (queryChatId && isVisible) {
            activeChatIdRef.current = queryChatId;
          }
          
          if (queryChatId) {
            abortControllersRef.current[queryChatId] = handleSubmitNoFileAbortController;
          }
          
          // Update chat status to 'loading' right before query starts
          if (queryChatId) {
            updateChatStatus(queryChatId, 'loading');
          }
          
          // Initialize buffered state for this chat if it doesn't exist
          if (queryChatId) {
            getBufferedState(queryChatId);
            // CRITICAL: activeChatIdRef is already set above, but log for debugging
            if (isVisible) {
              console.log('✅ SideChatPanel: Set activeChatIdRef for handleSubmit query:', {
                queryChatId,
                savedChatId,
                currentChatId,
                isVisible
              });
            }
          }
          
          await backendApi.queryDocumentsStreamFetch(
            submittedQuery,
            propertyId,
            messageHistory,
            chatSessionId, // Use chat's sessionId (not component sessionId) for backend isolation
            // onToken: Buffer tokens until we have complete markdown blocks, then display formatted
            (token: string) => {
              accumulatedText += token;
              tokenBuffer += token;
              
              // Use unified helper for consistent chat active check
              const chatIsActive = isChatActiveForQuery(queryChatId, savedChatId);
              
              if (chatIsActive) {
                // Process tokens to find complete markdown blocks
                // This allows ReactMarkdown to render formatted output progressively
                processTokensWithDelay();
              } else if (queryChatId) {
                // Chat is inactive - buffer the update
                const bufferedState = getBufferedState(queryChatId);
                bufferedState.accumulatedText = accumulatedText;
                bufferedState.lastUpdate = Date.now();
                
                // Update buffered messages with current state
                // We'll update the full message state periodically or on complete
              }
              
              // Always update persistedChatMessagesRef for history
              // Update history periodically (every ~100 tokens or every 2-3 seconds)
              // CRITICAL: Use chatMessagesRef.current to avoid stale closure issues
              if (queryChatId && accumulatedText.length % 100 === 0) {
                const currentMessages = chatMessagesRef.current;
                const historyMessages = currentMessages.map(msg => ({
                  role: msg.type === 'query' ? 'user' : 'assistant',
                  content: msg.text || '',
                  attachments: msg.attachments || [],
                  propertyAttachments: msg.propertyAttachments || [],
                  citations: msg.citations || {},
                  isLoading: msg.isLoading,
                  reasoningSteps: msg.reasoningSteps || []
                }));
                updateChatInHistory(queryChatId, historyMessages);
              }
            },
            // onComplete: Final response received - flush buffer and complete animation
            (data: any) => {
              // Use unified helper for consistent chat active check
              const chatIsActive = isChatActiveForQuery(queryChatId, savedChatId);
              
              // Extract any remaining complete blocks
              extractCompleteBlocks();
              
              // Flush any remaining incomplete buffer - add to displayed text
              if (tokenBuffer.trim() || pendingBuffer.trim()) {
                displayedText += pendingBuffer + tokenBuffer;
                pendingBuffer = '';
                tokenBuffer = '';
                
                // Clean the text but don't complete markdown here
                // StreamingResponseText will handle completion based on isStreaming state
                const cleanedText = cleanResponseText(displayedText);
                
                if (chatIsActive) {
                  // Update with final text (only if active)
                  setChatMessages(prev => prev.map(msg => 
                    msg.id === loadingResponseId 
                      ? { ...msg, text: cleanedText }
                      : msg
                  ));
                }
              }
              
              // Wait for queue to finish processing, then set final text
              const finalizeText = () => {
              // Use displayedText as source of truth - it was pre-completed during streaming
              // This ensures text doesn't change when streaming completes (prevents "click" effect)
              // Fallback to data.summary only if displayedText is empty
                const finalText = cleanResponseText(displayedText || data.summary || accumulatedText || "I found some information for you.");
              
                // Merge accumulated citations with any from backend complete message
                const mergedCitations = { ...accumulatedCitations, ...(data.citations || {}) };
              
              console.log('✅ SideChatPanel: LLM streaming complete:', {
                summary: finalText.substring(0, 100),
                documentsFound: data.relevant_documents?.length || 0,
                  citationCount: Object.keys(mergedCitations).length,
                  citationKeys: Object.keys(mergedCitations),
                  chatIsActive,
                  queryChatId
                });
                
                // Get the most up-to-date reasoning steps
                // For active chats, always use the current chatMessages state (most up-to-date)
                // For inactive chats, use buffered state
                let latestReasoningSteps: ReasoningStep[] = [];
                if (chatIsActive) {
                  // Active chat - use current UI state (most reliable)
                  const activeMessage = chatMessages.find(msg => msg.id === loadingResponseId);
                  latestReasoningSteps = activeMessage?.reasoningSteps || [];
                } else if (queryChatId) {
                  // Inactive chat - use buffered state
                  const bufferedState = getBufferedState(queryChatId);
                  const bufferedMessage = bufferedState.messages.find(msg => msg.id === loadingResponseId);
                  if (bufferedMessage?.reasoningSteps && bufferedMessage.reasoningSteps.length > 0) {
                    latestReasoningSteps = bufferedMessage.reasoningSteps;
                  } else if (bufferedState.reasoningSteps.length > 0) {
                    latestReasoningSteps = bufferedState.reasoningSteps;
                  } else {
                    // Fallback to current chatMessages (might have some steps)
                    const activeMessage = chatMessages.find(msg => msg.id === loadingResponseId);
                    latestReasoningSteps = activeMessage?.reasoningSteps || [];
                  }
                } else {
                  // No queryChatId - use current state
                  const activeMessage = chatMessages.find(msg => msg.id === loadingResponseId);
                  latestReasoningSteps = activeMessage?.reasoningSteps || [];
                }
                
                if (chatIsActive) {
                  // Hide bot status overlay when streaming completes
                  // BUT keep it visible in agent mode if navigation task is in progress
                  if (!isAgentModeRef.current || !isNavigatingTaskRef.current) {
                    setIsBotActive(false);
                  }
                  
                  // Set the complete formatted text
                  setChatMessages(prev => {
                    const existingMessage = prev.find(msg => msg.id === loadingResponseId);
                    const responseMessage: ChatMessage = {
                      id: loadingResponseId,
                      type: 'response',
                      text: finalText,
                      isLoading: false,
                      reasoningSteps: latestReasoningSteps.length > 0 ? latestReasoningSteps : (existingMessage?.reasoningSteps || []), // Preserve reasoning steps
                      citations: mergedCitations // Merged citations applied once
                    };
                    
                    const updated = prev.map(msg => 
                      msg.id === loadingResponseId 
                        ? responseMessage
                        : msg
                    );
                    persistedChatMessagesRef.current = updated;
                    return updated;
                  });
                } else if (queryChatId) {
                  // Chat is inactive - buffer the complete message
                  const bufferedState = getBufferedState(queryChatId);
                  const existingMessage = bufferedState.messages.find(msg => msg.id === loadingResponseId) || 
                    chatMessages.find(msg => msg.id === loadingResponseId);
                  
                  const responseMessage: ChatMessage = {
                    id: loadingResponseId,
                    type: 'response',
                    text: finalText,
                    isLoading: false,
                    reasoningSteps: latestReasoningSteps.length > 0 ? latestReasoningSteps : (existingMessage?.reasoningSteps || []),
                    citations: mergedCitations
                  };
                  
                  // Update buffered messages
                  const updatedMessages = bufferedState.messages.map(msg => 
                    msg.id === loadingResponseId ? responseMessage : msg
                  );
                  if (!updatedMessages.find(msg => msg.id === loadingResponseId)) {
                    updatedMessages.push(responseMessage);
                  }
                  
                  bufferedState.messages = updatedMessages;
                  bufferedState.accumulatedText = accumulatedText;
                  bufferedState.status = 'completed';
                  bufferedState.isLoading = false;
                  bufferedState.citations = mergedCitations;
                  bufferedState.lastUpdate = Date.now();
                  
                  console.log('💾 SideChatPanel: Buffered complete message for inactive chat:', queryChatId);
                }
              
                // Always update chat history and status
                // CRITICAL: Use chatMessagesRef.current to avoid stale closure issues
                if (queryChatId) {
                  // Use latest reasoning steps (from either active state or buffered state)
                  const currentMessages = chatMessagesRef.current;
                  const finalMessages = chatIsActive ? currentMessages.map(msg => 
                    msg.id === loadingResponseId 
                      ? {
                          role: 'assistant' as 'user' | 'assistant',
                          content: finalText,
                          citations: mergedCitations,
                          reasoningSteps: latestReasoningSteps.length > 0 ? latestReasoningSteps : (msg.reasoningSteps || []),
                          isLoading: false
                        }
                      : {
                          role: (msg.type === 'query' ? 'user' : 'assistant') as 'user' | 'assistant',
                          content: msg.text || '',
                          attachments: msg.attachments || [],
                          propertyAttachments: msg.propertyAttachments || [],
                          citations: msg.citations || {},
                          reasoningSteps: msg.reasoningSteps || [],
                          isLoading: msg.isLoading
                        }
                  ) : (queryChatId ? getBufferedState(queryChatId).messages.map(msg => {
                    const role = msg.type === 'query' ? 'user' : 'assistant';
                    const msgReasoningSteps = msg.id === loadingResponseId 
                      ? (latestReasoningSteps.length > 0 ? latestReasoningSteps : (msg.reasoningSteps || []))
                      : (msg.reasoningSteps || []);
                    return {
                      role: role as 'user' | 'assistant',
                      content: msg.text || '',
                      attachments: msg.attachments || [],
                      propertyAttachments: msg.propertyAttachments || [],
                      citations: msg.citations || {},
                      reasoningSteps: msgReasoningSteps,
                      isLoading: msg.isLoading
                    };
                  }) : []);
                  
                  updateChatInHistory(queryChatId, finalMessages);
                  updateChatStatus(queryChatId, 'completed');
                  
                  // Clean up abort controller
                  delete abortControllersRef.current[queryChatId];
                  console.log('✅ [HISTORY_SAVE] Final save on complete (submit path):', { chatId: queryChatId, messageCount: finalMessages.length, hasContent: finalMessages.some(m => m.content && m.content.trim().length > 0) });
                }
              
                // Keep reasoning steps in the message - don't clear them
                currentQueryIdRef.current = null;
              };
              
              // Wait for queue to finish processing (max 2 seconds), then finalize
              const maxWait = 2000;
              const checkInterval = 100;
              let waited = 0;
              const checkQueue = setInterval(() => {
                waited += checkInterval;
                if (!isProcessingQueue && blockQueue.length === 0 && !tokenBuffer.trim() && !pendingBuffer.trim()) {
                  clearInterval(checkQueue);
                  finalizeText();
                } else if (waited >= maxWait) {
                  clearInterval(checkQueue);
                  finalizeText();
                }
              }, checkInterval);
            },
            // onError: Handle errors
            (error: string) => {
              // Categorize error types for better handling
              const isNetworkError = error.includes('ERR_INCOMPLETE_CHUNKED_ENCODING') || 
                                    error.includes('Connection interrupted') ||
                                    error.includes('Failed to fetch') ||
                                    error.includes('network error');
              
              // Log network errors as warnings (less severe), others as errors
              if (isNetworkError) {
                console.warn('⚠️ SideChatPanel: Network error during streaming:', error);
              } else {
                console.error('❌ SideChatPanel: Streaming error:', error);
              }
              
              // Use unified helper for consistent chat active check
              const chatIsActive = isChatActiveForQuery(queryChatId, savedChatId);
              
              // Always update chat status to 'completed' even on error
              if (queryChatId) {
                updateChatStatus(queryChatId, 'completed');
                // Clean up abort controller
                delete abortControllersRef.current[queryChatId];
              }
              
              // Check if this is an attachment without query error
              const isQueryRequiredError = error.includes('Query is required') || 
                                         error.includes('HTTP 400') || 
                                         error.includes('BAD REQUEST');
              const isEmptyQuery = !submittedQuery || submittedQuery.trim() === '';
              
              let errorText: string;
              if (hasAttachmentsForError && (isQueryRequiredError || isEmptyQuery)) {
                // Show helpful prompt for attachments without query
                errorText = `I see you've attached a file, but I need a question to help you with it. Please tell me what you'd like to know about the document.`;
              } else if (isNetworkError) {
                // Show user-friendly message for network errors
                errorText = 'Connection was interrupted. Please try again.';
              } else {
                // Show generic error for other cases
                errorText = `Sorry, I encountered an error while processing your query. Please try again or contact support if the issue persists. Error: ${error}`;
              }
              
              if (chatIsActive) {
                // Hide bot status overlay on error (only if active)
                setIsBotActive(false);
                
                setChatMessages(prev => {
                  const existingMessage = prev.find(msg => msg.id === loadingResponseId);
                  const errorMessage: ChatMessage = {
                    id: loadingResponseId,
                    type: 'response',
                    text: errorText,
                    isLoading: false,
                    reasoningSteps: existingMessage?.reasoningSteps || [] // Preserve reasoning steps
                  };
                  
                  const updated = prev.map(msg => 
                    msg.id === loadingResponseId 
                      ? errorMessage
                      : msg
                  );
                  persistedChatMessagesRef.current = updated;
                  return updated;
                });
                
                if (!(hasAttachmentsForError && (isQueryRequiredError || isEmptyQuery))) {
                  // Only show toast for non-attachment errors
                  toast({
                    description: 'Failed to get AI response. Please try again.',
                    duration: 5000,
                    variant: 'destructive',
                  });
                }
              } else if (queryChatId) {
                // Chat is inactive - buffer error message
                const bufferedState = getBufferedState(queryChatId);
                const existingMessage = bufferedState.messages.find(msg => msg.id === loadingResponseId) || 
                  chatMessages.find(msg => msg.id === loadingResponseId);
                
                const errorMessage: ChatMessage = {
                  id: loadingResponseId,
                  type: 'response',
                  text: errorText,
                  isLoading: false,
                  reasoningSteps: existingMessage?.reasoningSteps || []
                };
                
                const updatedMessages = bufferedState.messages.map(msg => 
                  msg.id === loadingResponseId ? errorMessage : msg
                );
                if (!updatedMessages.find(msg => msg.id === loadingResponseId)) {
                  updatedMessages.push(errorMessage);
                }
                bufferedState.messages = updatedMessages;
                bufferedState.status = 'completed';
                bufferedState.isLoading = false;
                bufferedState.lastUpdate = Date.now();
              }
            },
            // onStatus: Show status messages
            (message: string) => {
              console.log('📊 SideChatPanel: Status:', message);
              // Update bot status overlay with current activity
              setBotActivityMessage(message);
            },
            // abortSignal: Pass abort signal for cancellation
            handleSubmitNoFileAbortController.signal,
            // documentIds: Pass selected document IDs to filter search
            documentIdsArray,
            // onReasoningStep: Handle reasoning step events
            (step: { step: string; action_type?: string; message: string; count?: number; details: any }) => {
              console.log('🟡 SideChatPanel: Received reasoning step:', step);
              
              // Use unified helper for consistent chat active check
              const chatIsActive = isChatActiveForQuery(queryChatId, savedChatId);
              
              // FILTER: Skip "Opening citation view" reasoning step during navigation
              // Navigation queries should not show document opening steps
              if (isNavigatingTaskRef.current && 
                  (step.step === 'agent_open_document' || 
                   step.message?.toLowerCase().includes('opening citation view') ||
                   step.message?.toLowerCase().includes('highlighting content'))) {
                console.log('⏭️ [REASONING_STEP] Skipping document opening step - navigation in progress');
                return; // Don't add this reasoning step to the UI
              }
              
              // PRELOAD: Extract document IDs from reasoning steps and preload IMMEDIATELY (always, background operation)
              if (step.details) {
                if (step.details.doc_previews && Array.isArray(step.details.doc_previews)) {
                  step.details.doc_previews.forEach((doc: any) => {
                    if (doc.doc_id) {
                      preloadDocumentById(doc.doc_id, doc.original_filename || doc.filename);
                    }
                  });
                }
                if (step.details.doc_metadata && step.details.doc_metadata.doc_id) {
                  const docId = step.details.doc_metadata.doc_id;
                  const filename = step.details.doc_metadata.original_filename || step.details.doc_metadata.filename;
                  preloadDocumentById(docId, filename);
                }
                if (step.details.documents && Array.isArray(step.details.documents)) {
                  step.details.documents.forEach((doc: any) => {
                    if (doc.doc_id || doc.id) {
                      preloadDocumentById(doc.doc_id || doc.id, doc.original_filename || doc.filename);
                    }
                  });
                }
              }
              
              const newStep: ReasoningStep = {
                step: step.step,
                action_type: (step.action_type as ReasoningStep['action_type']) || 'analysing',
                message: step.message,
                count: step.count,
                details: step.details,
                timestamp: Date.now()
              };
              
              if (chatIsActive) {
                // Update reasoning steps in UI
                setChatMessages(prev => {
                  const updated = prev.map(msg => {
                    if (msg.id === loadingResponseId) {
                      const existingSteps = msg.reasoningSteps || [];
                      const stepKey = `${step.step}:${step.message}`;
                      const now = Date.now();
                      const incomingDocId = step.action_type === 'reading'
                        ? (step.details?.doc_metadata?.doc_id ?? (step.details as any)?.doc_id)
                        : undefined;
                      const isDuplicate = existingSteps.some(s => {
                        if (incomingDocId && step.action_type === 'reading') {
                          const existingDocId = s.details?.doc_metadata?.doc_id ?? (s.details as any)?.doc_id;
                          if (s.action_type === 'reading' && existingDocId === incomingDocId) return true;
                        }
                        return `${s.step}:${s.message}` === stepKey && (now - s.timestamp) < 500;
                      });
                      
                      if (isDuplicate) {
                        return msg;
                      }
                      
                      return { ...msg, reasoningSteps: [...existingSteps, newStep] };
                    }
                    return msg;
                  });
                  persistedChatMessagesRef.current = updated;
                  return updated;
                });
              } else if (queryChatId) {
                // Chat is inactive - buffer reasoning step
                const bufferedState = getBufferedState(queryChatId);
                const existingBuffered = bufferedState.reasoningSteps || [];
                const stepKey = `${step.step}:${step.message}`;
                const now = Date.now();
                const incomingDocId = step.action_type === 'reading'
                  ? (step.details?.doc_metadata?.doc_id ?? (step.details as any)?.doc_id)
                  : undefined;
                const bufferedDuplicate = existingBuffered.some(s => {
                  if (incomingDocId && step.action_type === 'reading') {
                    const existingDocId = s.details?.doc_metadata?.doc_id ?? (s.details as any)?.doc_id;
                    if (s.action_type === 'reading' && existingDocId === incomingDocId) return true;
                  }
                  return `${s.step}:${s.message}` === stepKey && (now - s.timestamp) < 500;
                });
                if (!bufferedDuplicate) {
                  bufferedState.reasoningSteps.push(newStep);
                  bufferedState.lastReasoningStep = newStep;
                  bufferedState.lastUpdate = Date.now();
                  const existingMessage = bufferedState.messages.find(msg => msg.id === loadingResponseId) || 
                    chatMessages.find(msg => msg.id === loadingResponseId);
                  if (existingMessage) {
                    const existingSteps = existingMessage.reasoningSteps || [];
                    const isDup = existingSteps.some(s => {
                      if (incomingDocId && step.action_type === 'reading') {
                        const existingDocId = s.details?.doc_metadata?.doc_id ?? (s.details as any)?.doc_id;
                        if (s.action_type === 'reading' && existingDocId === incomingDocId) return true;
                      }
                      return `${s.step}:${s.message}` === stepKey && (now - s.timestamp) < 500;
                    });
                    if (!isDup) {
                      const updatedMessage = { ...existingMessage, reasoningSteps: [...existingSteps, newStep] };
                      const updatedMessages = bufferedState.messages.map(msg => 
                        msg.id === loadingResponseId ? updatedMessage : msg
                      );
                      if (!updatedMessages.find(msg => msg.id === loadingResponseId)) {
                        updatedMessages.push(updatedMessage);
                      }
                      bufferedState.messages = updatedMessages;
                    }
                  }
                }
              }
              
              // Always update history (reasoning steps are part of messages)
              if (queryChatId) {
                const historyMessages = (chatIsActive ? chatMessages : (getBufferedState(queryChatId).messages)).map(msg => ({
                  role: msg.type === 'query' ? 'user' : 'assistant',
                  content: msg.text || '',
                  attachments: msg.attachments || [],
                  propertyAttachments: msg.propertyAttachments || [],
                  citations: msg.citations || {},
                  reasoningSteps: msg.reasoningSteps || [],
                  isLoading: msg.isLoading
                }));
                updateChatInHistory(queryChatId, historyMessages);
              }
            },
            // onReasoningContext: Handle LLM-generated contextual narration
            (context: { message: string; moment: string }) => {
              console.log('🟢 SideChatPanel: Received reasoning context:', context);
              
              // Use unified helper for consistent chat active check
              const chatIsActive = isChatActiveForQuery(queryChatId, savedChatId);
              
              const contextStep: ReasoningStep = {
                step: `context_${context.moment}`,
                action_type: 'context',
                message: context.message,
                details: { moment: context.moment },
                timestamp: Date.now()
              };
              
              if (chatIsActive) {
                setChatMessages(prev => {
                  const updated = prev.map(msg => {
                    if (msg.id === loadingResponseId) {
                      const existingSteps = msg.reasoningSteps || [];
                      return { ...msg, reasoningSteps: [...existingSteps, contextStep] };
                    }
                    return msg;
                  });
                  persistedChatMessagesRef.current = updated;
                  return updated;
                });
              } else if (queryChatId) {
                // Chat is inactive - buffer reasoning context
                const bufferedState = getBufferedState(queryChatId);
                bufferedState.reasoningSteps.push(contextStep);
                bufferedState.lastReasoningStep = contextStep;
                bufferedState.lastUpdate = Date.now();
                
                // Update buffered messages
                const existingMessage = bufferedState.messages.find(msg => msg.id === loadingResponseId) || 
                  chatMessages.find(msg => msg.id === loadingResponseId);
                
                if (existingMessage) {
                  const existingSteps = existingMessage.reasoningSteps || [];
                  const updatedMessage = { ...existingMessage, reasoningSteps: [...existingSteps, contextStep] };
                  const updatedMessages = bufferedState.messages.map(msg => 
                    msg.id === loadingResponseId ? updatedMessage : msg
                  );
                  if (!updatedMessages.find(msg => msg.id === loadingResponseId)) {
                    updatedMessages.push(updatedMessage);
                  }
                  bufferedState.messages = updatedMessages;
                }
              }
            },
            // onCitation: Accumulate citations locally (NO state updates to avoid re-render storm)
            (citation: { citation_number: string | number; data: any }) => {
              const citationNumStr = String(citation.citation_number);
              
              // Normalize bbox
              const citationBbox = citation.data.bbox;
              let normalizedBbox: { left: number; top: number; width: number; height: number; page?: number } | null = null;
              
              if (citationBbox && typeof citationBbox === 'object') {
                if (typeof citationBbox.left === 'number' && 
                    typeof citationBbox.top === 'number' && 
                    typeof citationBbox.width === 'number' && 
                    typeof citationBbox.height === 'number') {
                  normalizedBbox = {
                    left: citationBbox.left,
                    top: citationBbox.top,
                    width: citationBbox.width,
                    height: citationBbox.height,
                    page: citationBbox.page ?? citation.data.page ?? citation.data.page_number
                  };
                }
              }
              
              const finalBbox = normalizedBbox || { left: 0, top: 0, width: 0, height: 0 };
              
              // Accumulate citation locally - will be applied in onComplete
              accumulatedCitations[citationNumStr] = {
                doc_id: citation.data.doc_id,
                page: citation.data.page || citation.data.page_number || 0,
                bbox: finalBbox,
                method: citation.data.method,
                block_id: citation.data.block_id,
                original_filename: citation.data.original_filename
              };
              
              // Always accumulate citations in buffer (for inactive chats)
              if (queryChatId) {
                const bufferedState = getBufferedState(queryChatId);
                bufferedState.citations[citationNumStr] = accumulatedCitations[citationNumStr];
                bufferedState.lastUpdate = Date.now();
              }
              
              // Preload document in background (no state update, always happens)
              const docId = citation.data.doc_id;
              if (docId) {
                preloadDocumentById(docId, citation.data.original_filename);
              }
            },
            undefined, // onExecutionEvent
            // citationContext: from prop or from citation_snippet chip (Ask follow up)
            effectiveCitationContext || undefined,
            responseMode, // responseMode (from file choice)
            attachmentContext, // attachmentContext (extracted text from files)
            // AGENT-NATIVE: Handle agent actions
            (action: { action: string; params: any }) => {
              console.log('🎯 [AGENT_ACTION] Received action (follow-up):', action);
              
              // Use unified helper for consistent chat active check
              const chatIsActive = isChatActiveForQuery(queryChatId, savedChatId);
              // STRICT: Verify this query's chat is the currently active one (prevents race conditions)
              const isCorrectChat = queryChatId === activeChatIdRef.current;

              // Skip agent actions in reader mode - just show citations without auto-opening
              // Use ref to get current mode value (avoids closure issues)
              if (!isAgentModeRef.current) {
                console.log('📖 [READER_MODE] Skipping agent action (follow-up) - reader mode active');
                return;
              }
              
              console.log('✅ [AGENT_MODE] Executing agent action (follow-up):', action.action, { chatIsActive, isCorrectChat, queryChatId, activeChat: activeChatIdRef.current });
              
              // Buffer agent action for inactive chats OR if chat ownership mismatch
              if ((!chatIsActive || !isCorrectChat) && queryChatId) {
                const bufferedState = getBufferedState(queryChatId);
                bufferedState.activeAgentAction = {
                  action: action.action,
                  params: action.params,
                  timestamp: Date.now()
                };
                bufferedState.lastUpdate = Date.now();
                console.log('💾 SideChatPanel: Buffered agent action for inactive chat:', action.action);
              }
              
              switch (action.action) {
                case 'open_document':
                  // SKIP opening document if we're navigating to a property
                  // Navigation queries should not open documents - they should just navigate
                  if (isNavigatingTaskRef.current) {
                    console.log('⏭️ [AGENT_ACTION] Skipping open_document - navigation in progress');
                    break;
                  }
                  
                  console.log('📂 [AGENT_ACTION] Opening document (follow-up):', action.params.doc_id, 'page:', action.params.page, 'bbox:', action.params.bbox);
                  if (action.params.doc_id) {
                    if (chatIsActive && isCorrectChat) {
                      // AGENT GLOW: Activate glowing border effect before opening
                      setIsAgentOpening(true);
                      // Keep bot overlay visible during document opening
                      isOpeningDocumentRef.current = true;
                      setBotActivityMessage('Opening document...');
                      
                      // Use the citation data from the backend action directly
                      const citationData = {
                        doc_id: action.params.doc_id,
                        page: action.params.page || 1,
                        original_filename: action.params.filename || '',
                        bbox: action.params.bbox || undefined
                      };
                      
                      handleCitationClick(citationData as any, true); // fromAgentAction=true (backend emits reasoning step)
                    } else if (queryChatId) {
                      // Chat is inactive - store document preview in ChatStateStore
                      // This allows the document to be pre-opened when user returns to this chat
                      // Ensure page is inside bbox for consistent CitationHighlight structure
                      const bboxWithPage = action.params.bbox ? {
                        ...action.params.bbox,
                        page: action.params.bbox.page || action.params.page || 1
                      } : undefined;
                      const docPreview = {
                        docId: action.params.doc_id,
                        filename: action.params.filename || '',
                        highlight: bboxWithPage ? {
                          fileId: action.params.doc_id,
                          bbox: bboxWithPage,
                          doc_id: action.params.doc_id,
                          block_id: action.params.block_id || '',
                          block_content: action.params.block_content || '',
                          original_filename: action.params.filename || ''
                        } : undefined
                      };
                      // Store in ChatStateStore (will be displayed when user switches to this chat)
                      openDocumentForChat(queryChatId, docPreview);
                      console.log('💾 SideChatPanel: Stored document preview in ChatStateStore for inactive chat (follow-up):', { chatId: queryChatId, docPreview });
                    }
                  }
                  break;
                case 'highlight_bbox':
                  // Legacy: highlight_bbox is now combined into open_document
                  console.log('⚠️ [AGENT_ACTION] Legacy highlight_bbox received (follow-up)');
                  break;
                case 'navigate_to_property':
                  if (chatIsActive && isCorrectChat) {
                    // CRITICAL: Close document preview immediately when navigating to property
                    // This prevents old content (like EPC rating) from remaining visible
                    console.log('🧭 [AGENT_ACTION] navigate_to_property received (follow-up) - closing preview and navigating');
                    // Set navigation flag to prevent fullscreen restoration
                    isNavigatingTaskRef.current = true;
                    wasFullscreenBeforeCitationRef.current = false;
                    // IMMEDIATELY close any open document preview to clear old content
                    closeExpandedCardView();
                    documentPreviewOwnerRef.current = null;
                    // Update bot status to show navigation activity
                    setBotActivityMessage('Navigating...');
                    if (action.params.property_id && onOpenProperty) {
                      onOpenProperty(null, null, action.params.property_id);
                    }
                  }
                  // If inactive, action is already buffered above
                  break;
                case 'show_map_view':
                  if (chatIsActive && isCorrectChat) {
                    // SEQUENCED FLOW for follow-up
                    // NOTE: Do NOT call onMapToggle() - that hides the chat!
                    console.log('🗺️ [AGENT_ACTION] show_map_view received (follow-up) - queuing:', action.params);
                    // CRITICAL: Set navigation flag BEFORE closing preview to prevent fullscreen restoration
                    isNavigatingTaskRef.current = true;
                    wasFullscreenBeforeCitationRef.current = false;
                    // Update bot status to show navigation activity
                    setBotActivityMessage('Navigating...');
                    // IMMEDIATELY close any open document preview
                    closeExpandedCardView();
                    setTimeout(() => {
                      const navMinWidth = CHAT_PANEL_WIDTH.NAV_MIN;
                      setIsFullscreenMode(false);
                      setDraggedWidth(navMinWidth);
                      lockedWidthRef.current = null;
                      if (onChatWidthChange) {
                        onChatWidthChange(navMinWidth);
                      }
                      // Map is already rendered behind the chat - shrinking reveals it
                    }, 600);
                  }
                  // If inactive, action is already buffered above
                  break;
                case 'select_property_pin':
                  if (chatIsActive) {
                    // SEQUENCED FLOW for follow-up
                    console.log('📍 [AGENT_ACTION] select_property_pin received (follow-up) - queuing:', action.params);
                    // CRITICAL: Set navigation flag IMMEDIATELY to prevent fullscreen restoration
                    isNavigatingTaskRef.current = true;
                    wasFullscreenBeforeCitationRef.current = false;
                    closeExpandedCardView();
                    setTimeout(() => {
                      setAgentTaskActive(true, 'Navigating to property...');
                      setMapNavigating(true);
                      const pinNavMinWidth = CHAT_PANEL_WIDTH.NAV_MIN;
                      setIsFullscreenMode(false);
                      setDraggedWidth(pinNavMinWidth);
                      lockedWidthRef.current = null;
                      if (onChatWidthChange) {
                        onChatWidthChange(pinNavMinWidth);
                      }
                      setTimeout(() => {
                        if (action.params.property_id && onOpenProperty) {
                          const coords = action.params.latitude && action.params.longitude 
                            ? { lat: action.params.latitude, lng: action.params.longitude }
                            : undefined;
                          onOpenProperty(action.params.address || null, coords || null, action.params.property_id, true);
                          setTimeout(() => {
                            setAgentTaskActive(false);
                            setMapNavigating(false);
                            setIsBotActive(false); // Hide bot status overlay when navigation completes
                            // NOTE: Don't reset isNavigatingTaskRef here - it prevents fullscreen re-expansion
                            // Will be reset when next query starts
                          }, 1000);
                        }
                      }, 500);
                    }, 800);
                  }
                  // If inactive, action is already buffered above
                  break;
                case 'search_property_result':
                  console.log('🔍 [AGENT_ACTION] search_property_result received (follow-up):', action.params);
                  (window as any).__lastPropertySearchResult = action.params;
                  break;
                case 'save_to_writing':
                  if (action.params.citation) {
                    const curatedKey = 'curated_writing_citations';
                    const existing = JSON.parse(localStorage.getItem(curatedKey) || '[]');
                    const newEntry = {
                      id: `citation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                      citation: action.params.citation,
                      addedAt: new Date().toISOString(),
                      documentName: action.params.citation.original_filename || 'Unknown document',
                      content: action.params.citation.block_content || action.params.note || ''
                    };
                    existing.push(newEntry);
                    localStorage.setItem(curatedKey, JSON.stringify(existing));
                    window.dispatchEvent(new CustomEvent('citation-added-to-writing', { detail: newEntry }));
                  }
                  break;
              }
            },
            isAgentModeRef.current, // Pass agent mode to backend for tool-based actions
            selectedModelRef.current, // Pass selected model to backend
            // onThinkingChunk: Stream Claude's extended thinking in real-time
            (chunk: string) => {
              setChatMessages(prev => prev.map(msg => {
                if (msg.id === loadingResponseId) {
                  const updatedSteps = (msg.reasoningSteps || []).map(step => {
                    if (step.action_type === 'thinking') {
                      return {
                        ...step,
                        details: {
                          ...step.details,
                          thinking_content: (step.details?.thinking_content || '') + chunk
                        }
                      };
                    }
                    return step;
                  });
                  return { ...msg, reasoningSteps: updatedSteps };
                }
                return msg;
              }));
            },
            // onThinkingComplete: Finalize thinking content
            (fullThinking: string) => {
              console.log('🧠 Extended thinking complete:', fullThinking.length, 'chars');
            }
          );
          
          // Clear abort controller and processing flag on completion
          abortControllerRef.current = null;
          isProcessingQueryRef.current = false;
        } catch (error) {
          abortControllerRef.current = null;
          isProcessingQueryRef.current = false;
          // Hide bot status overlay on error
          setIsBotActive(false);
          // Don't log error if it was aborted
          if (error instanceof Error && error.message !== 'Request aborted') {
            console.error('❌ SideChatPanel: Error calling LLM API:', error);
          }
          
          // Check if this is an attachment without query error
          // Note: documentIdsArray is defined in the try block above, but we need to check selectedDocumentIds here
          const hasAttachments = attachedFiles.length > 0 || selectedDocumentIds.size > 0;
          const errorMessage = error instanceof Error ? error.message : String(error);
          const isQueryRequiredError = errorMessage.includes('Query is required') || 
                                      errorMessage.includes('HTTP 400') || 
                                      errorMessage.includes('BAD REQUEST');
          const isEmptyQuery = !submitted || submitted.trim() === '';
          
          let errorText: string;
          if (hasAttachments && (isQueryRequiredError || isEmptyQuery)) {
            // Show helpful prompt for attachments without query
            errorText = `I see you've attached a file, but I need a question to help you with it. Please tell me what you'd like to know about the document.`;
          } else {
            // Show generic error for other cases
            errorText = `Sorry, I encountered an error while processing your query. Please try again or contact support if the issue persists. Error: ${errorMessage}`;
          }
          
          // Show error message instead of mock response
          setChatMessages(prev => {
            const existingMessage = prev.find(msg => msg.id === loadingResponseId);
          const errorMessageObj: ChatMessage = {
            id: `response-${Date.now()}`,
            type: 'response',
            text: errorText,
              isLoading: false,
              reasoningSteps: existingMessage?.reasoningSteps || [] // Preserve reasoning steps
          };
          
            const updated = prev.map(msg => 
              msg.id === loadingResponseId 
                ? errorMessageObj
                : msg
            );
            persistedChatMessagesRef.current = updated;
            return updated;
          });
          
          if (!(hasAttachments && (isQueryRequiredError || isEmptyQuery))) {
            // Only show toast for non-attachment errors
            toast({
              description: 'Failed to get AI response. Please try again.',
              duration: 5000,
              variant: 'destructive',
            });
          }
        }
      })();
      
      onQuerySubmit(submitted);
      clearInputAndChips();
      setAttachedFiles([]);
      if (selectedDocumentIds.size > 0) {
        clearSelectedDocuments();
        setDocumentSelectionMode(false);
      }
      clearPropertyAttachments();
      setSelectionModeActive(false);
      setIsSubmitted(false);
    }
  };
  
  const hasContent = inputValue.trim().length > 0;
  
  // Compute adjustments from plan diff for the PlanViewer
  const planAdjustments = React.useMemo<AdjustmentBlockData[]>(() => {
    if (!isUpdatingPlan || !previousPlanContent || !planContent) return [];
    
    const changes = diffLines(previousPlanContent, planContent);
    const adjustments: AdjustmentBlockData[] = [];
    let currentSection = 'Changes';
    let adjustmentId = 0;
    
    interface DiffLine {
      type: 'added' | 'removed' | 'unchanged';
      content: string;
    }
    
    const lines: DiffLine[] = [];
    for (const change of changes) {
      const contentLines = change.value.split('\n');
      for (let i = 0; i < contentLines.length; i++) {
        const content = contentLines[i];
        if (content === '' && i === contentLines.length - 1 && contentLines.length > 1) continue;
        
        if (change.added) {
          lines.push({ type: 'added', content });
        } else if (change.removed) {
          lines.push({ type: 'removed', content });
        } else {
          lines.push({ type: 'unchanged', content });
        }
      }
    }
    
    let i = 0;
    while (i < lines.length) {
      if (lines[i].type === 'unchanged' && lines[i].content.startsWith('##')) {
        currentSection = lines[i].content.replace(/^#+\s*/, '');
      }
      
      if (lines[i].type !== 'unchanged') {
        const removedLines: string[] = [];
        const addedLines: string[] = [];
        
        while (i < lines.length && lines[i].type !== 'unchanged') {
          if (lines[i].type === 'removed') {
            removedLines.push(lines[i].content);
          } else if (lines[i].type === 'added') {
            addedLines.push(lines[i].content);
          }
          i++;
        }
        
        if (removedLines.length > 0 || addedLines.length > 0) {
          adjustmentId++;
          let sectionName = currentSection;
          
          if (removedLines.length > 0 && addedLines.length > 0) {
            sectionName = `Updated ${currentSection}`;
          } else if (addedLines.length > 0) {
            sectionName = `Added to ${currentSection}`;
          } else {
            sectionName = `Removed from ${currentSection}`;
          }
          
          adjustments.push({
            id: `adjustment-${adjustmentId}`,
            sectionName,
            linesAdded: addedLines.length,
            linesRemoved: removedLines.length,
            removedLines,
            addedLines,
            scrollTargetId: `diff-line-${adjustmentId}`,
          });
        }
      } else {
        i++;
      }
    }
    
    return adjustments;
  }, [isUpdatingPlan, previousPlanContent, planContent]);
  
  // Use incremental adjustments during streaming, final planAdjustments after complete
  const displayedAdjustments = React.useMemo(() => {
    if (planBuildStatus === 'streaming' && incrementalAdjustments.length > 0) {
      return incrementalAdjustments;
    }
    return planAdjustments;
  }, [planBuildStatus, incrementalAdjustments, planAdjustments]);
  
  // Generate reasoning steps for plan update mode (external to PlanViewer)
  const planReasoningSteps = React.useMemo<PlanReasoningStep[]>(() => {
    if (!isUpdatingPlan || !adjustmentQuery) return [];
    
    const isStreaming = planBuildStatus === 'streaming';
    const steps: PlanReasoningStep[] = [
      {
        icon: isStreaming ? 'planning' : 'complete',
        message: 'Planning next moves...',
        detail: `Received: "${adjustmentQuery}"`,
        isActive: isStreaming,
      },
    ];
    
    // Show "Applying X adjustments" step when we have adjustments (during streaming or after)
    if (displayedAdjustments.length > 0) {
      steps.push({
        icon: isStreaming ? 'applying' : 'complete',
        message: `Applying ${displayedAdjustments.length} adjustments to plan...`,
        isActive: isStreaming,
      });
      
      if (!isStreaming && visibleAdjustmentCount >= displayedAdjustments.length) {
        steps.push({
          icon: 'complete',
          message: `${displayedAdjustments.length} adjustments applied`,
        });
      }
    }
    
    return steps;
  }, [isUpdatingPlan, adjustmentQuery, displayedAdjustments.length, planBuildStatus, visibleAdjustmentCount]);
  
  // Staggered reveal of adjustments (external to PlanViewer)
  React.useEffect(() => {
    const isStreaming = planBuildStatus === 'streaming';
    
    // During streaming, visibleAdjustmentCount is managed by incremental diff
    if (isStreaming) {
      return; // Don't reset - incremental diff handles this
    }
    
    if (!isUpdatingPlan || displayedAdjustments.length === 0) {
      setVisibleAdjustmentCount(0);
      return;
    }
    
    // Staggered reveal after streaming completes
    setVisibleAdjustmentCount(0);
    
    const timers: NodeJS.Timeout[] = [];
    for (let i = 0; i < displayedAdjustments.length; i++) {
      const timer = setTimeout(() => {
        setVisibleAdjustmentCount(i + 1);
      }, i * 350);
      timers.push(timer);
    }
    
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [planBuildStatus, isUpdatingPlan, displayedAdjustments.length]);
  
  // Track if chat is empty for centered "New Agent" layout
  // IMPORTANT: Force messages layout when showPlanViewer is true, even if no chat messages
  // This ensures the PlanViewer is visible when generating a research plan
  const isEmptyChat = chatMessages.length === 0 && !showPlanViewer;

  // One random title per empty-state session (stable while isEmptyChat is true)
  const emptyStateTitleMessage = useMemo(
    () =>
      isEmptyChat
        ? EMPTY_CHAT_TITLE_MESSAGES[Math.floor(Math.random() * EMPTY_CHAT_TITLE_MESSAGES.length)]
        : '',
    [isEmptyChat]
  );

  // Which citations should show orange highlight in response text (when user added citation_snippet chip from that message/citation)
  // Use globalThis.Map/Set because Map is imported from lucide-react (icon) and would shadow the built-in.
  // Stabilize so we don't re-create the map on every keystroke: only update when the set of citation chips actually changes.
  const prevOrangeCitationRef = React.useRef<{ key: string; map: globalThis.Map<string, Set<string>> }>({ key: '', map: new globalThis.Map() });
  const orangeCitationNumbersByMessage = React.useMemo(() => {
    const pairs: string[] = [];
    for (const seg of segmentInput.segments) {
      if (!isChipSegment(seg) || seg.kind !== 'citation_snippet') continue;
      const p = seg.payload as { messageId?: string; citationNumber?: string };
      if (p?.messageId != null && p?.citationNumber != null)
        pairs.push(`${p.messageId}:${p.citationNumber}`);
    }
    const key = pairs.sort().join(',');
    if (prevOrangeCitationRef.current.key === key)
      return prevOrangeCitationRef.current.map;
    const m = new globalThis.Map<string, Set<string>>();
    for (const pair of pairs) {
      const [messageId, citationNumber] = pair.split(':');
      if (messageId && citationNumber) {
        if (!m.has(messageId)) m.set(messageId, new globalThis.Set());
        m.get(messageId)!.add(citationNumber);
      }
    }
    prevOrangeCitationRef.current = { key, map: m };
    return m;
  }, [segmentInput.segments]);

  // CRITICAL: This useMemo MUST be at top level (not inside JSX) to follow React's Rules of Hooks
  // This fixes "Rendered more hooks than during the previous render" error
  const renderedMessages = useMemo(() => {
    const validMessages = (Array.isArray(chatMessages) ? chatMessages : [])
      .map((message, idx) => ({ message, idx }))
      .filter(({ message }) => message && typeof message === 'object');
    
    if (validMessages.length === 0) return [];
    
    // Only the latest assistant message gets the blue highlight; previous responses do not
    const lastAssistant = [...validMessages].reverse().find(({ message }) => message.type !== 'query' && message.text);
    const latestAssistantMessageKey = lastAssistant
      ? (lastAssistant.message.id || `msg-${lastAssistant.idx}`)
      : null;
    
    return validMessages.map(({ message, idx }) => {
      const finalKey = message.id || `msg-${idx}`;
      const isRestored = message.id && restoredMessageIdsRef.current.has(message.id);
      const isLatestAssistantMessage = latestAssistantMessageKey !== null && finalKey === latestAssistantMessageKey;
      
      if (message.type === 'query') {
        // Truncate query text if from citation
        const containerWidth = contentAreaRef.current?.clientWidth || 600;
        const { truncatedText, isTruncated } = message.fromCitation && message.text
          ? truncateQueryText(message.text, 2, 80, containerWidth)
          : { truncatedText: message.text || '', isTruncated: false };
        
        // Handler to open citation when clicking preview or truncated text
        const handleCitationPreviewClick = () => {
          if (message.citationBboxData) {
            const citationData: CitationData = {
              doc_id: message.citationBboxData.document_id,
              original_filename: message.citationBboxData.original_filename || undefined,
              page: message.citationBboxData.page_number,
              page_number: message.citationBboxData.page_number,
              block_id: message.citationBboxData.block_id || undefined,
              bbox: {
                left: message.citationBboxData.bbox.left,
                top: message.citationBboxData.bbox.top,
                width: message.citationBboxData.bbox.width,
                height: message.citationBboxData.bbox.height,
                page: message.citationBboxData.page_number
              }
            };
            handleCitationClick(citationData);
          }
        };
        
        return (
          <div key={finalKey} style={{
            alignSelf: 'flex-end', maxWidth: '85%', width: 'fit-content',
            minWidth: 0, // Allow shrinking to prevent overflow
            marginTop: '8px', marginLeft: 'auto', marginRight: '0',
            display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end',
            boxSizing: 'border-box'
          }}>
            {/* BBOX Preview for citation queries */}
            {message.fromCitation && message.citationBboxData && (
              <div style={{ marginBottom: '10px', maxWidth: '100%' }}>
                <CitationBboxPreview 
                  citationBboxData={message.citationBboxData}
                  onClick={handleCitationPreviewClick}
                />
              </div>
            )}
            <div style={{ backgroundColor: '#FFFFFF', borderRadius: '8px', padding: '4px 6px 4px 10px', border: '1px solid #e5e7eb', boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)', width: 'fit-content', maxWidth: '100%', wordWrap: 'break-word', overflowWrap: 'break-word', display: 'block', boxSizing: 'border-box' }}>
              {message.attachments?.length > 0 && (
                <div style={{ marginBottom: (message.text || message.propertyAttachments?.length > 0) ? '8px' : '0', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {message.attachments.map((attachment, i) => (
                    <QueryAttachment key={attachment.id || attachment.name || `att-${i}`} attachment={attachment} />
                  ))}
                </div>
              )}
              <div style={{ display: 'block', lineHeight: '22px', fontSize: '14px', width: 'fit-content', maxWidth: '100%', padding: 0, margin: 0 }}>
                {message.contentSegments && message.contentSegments.length > 0
                  ? message.contentSegments.map((seg, idx) => {
                      if (seg.type === 'text') {
                        const { truncatedText: segText, isTruncated: segTruncated } = seg.value
                          ? truncateQueryText(seg.value, 2, 80, containerWidth)
                          : { truncatedText: '', isTruncated: false };
                        if (!segText) return null;
                        return (
                          <span
                            key={`t-${idx}`}
                            style={{
                              color: '#0D0D0D',
                              fontSize: '14px',
                              lineHeight: '22px',
                              margin: 0,
                              padding: 0,
                              marginRight: '6px',
                              textAlign: 'left',
                              fontFamily: 'system-ui, -apple-system, sans-serif',
                              display: 'inline',
                              cursor: segTruncated ? 'pointer' : 'default',
                              wordWrap: 'break-word',
                              overflowWrap: 'break-word',
                              textDecoration: segTruncated ? 'underline' : 'none',
                              textDecorationStyle: segTruncated ? ('dotted' as const) : undefined,
                              textUnderlineOffset: '3px'
                            }}
                            onClick={segTruncated ? handleCitationPreviewClick : undefined}
                            title={segTruncated ? 'Click to view citation' : undefined}
                            onMouseEnter={() => setHoveredQueryId(finalKey)}
                            onMouseLeave={() => setHoveredQueryId(null)}
                          >
                            <ReactMarkdown components={{
                              p: ({ children }) => <p style={{ margin: 0, padding: 0, display: 'inline', wordWrap: 'break-word', overflowWrap: 'break-word' }}>{children}</p>,
                              h1: ({ children }) => <h1 style={{ fontSize: '18px', fontWeight: 600, margin: '14px 0 10px 0', display: 'block' }}>{children}</h1>,
                              h2: () => null, h3: ({ children }) => <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '10px 0 6px 0' }}>{children}</h3>,
                              ul: ({ children }) => <ul style={{ margin: '10px 0', paddingLeft: '22px' }}>{children}</ul>,
                              ol: ({ children }) => <ol style={{ margin: '10px 0', paddingLeft: '22px' }}>{children}</ol>,
                              li: ({ children }) => <li style={{ marginBottom: '6px' }}>{children}</li>,
                              strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
                              em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
                              code: ({ children }) => <code style={{ backgroundColor: '#f3f4f6', padding: '2px 5px', borderRadius: '4px', fontSize: '14px', fontFamily: 'monospace' }}>{children}</code>,
                              blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid #d1d5db', paddingLeft: '14px', margin: '10px 0', color: '#6b7280' }}>{children}</blockquote>,
                              hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '18px 0' }} />,
                            }}>{segText}</ReactMarkdown>
                          </span>
                        );
                      }
                      if (seg.type === 'property') {
                        const prop = seg.attachment;
                        const part = (prop.address || '').split(',')[0] || prop.address || '';
                        const label = part.length > 30 ? part.slice(0, 27) + '...' : part;
                        return (
                          <span key={`p-${idx}-${prop.id}`} style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: '6px' }}>
                            <AtMentionChip
                              type="property"
                              label={label}
                              title={`Click to view ${prop.address}`}
                              onClick={onOpenProperty ? () => onOpenProperty(prop.address, prop.property?.latitude != null && prop.property?.longitude != null ? { lat: prop.property.latitude, lng: prop.property.longitude } : undefined, prop.property?.id ?? prop.propertyId) : undefined}
                            />
                          </span>
                        );
                      }
                      if (seg.type === 'citation_snippet') {
                        const snippetLabel = seg.snippet.length > 50 ? seg.snippet.slice(0, 47) + '...' : seg.snippet;
                        return (
                          <span key={`cit-${idx}`} style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: '6px' }}>
                            <AtMentionChip type="citation_snippet" label={snippetLabel} />
                          </span>
                        );
                      }
                      if (seg.type === 'document') {
                        const label = seg.name.length > 30 ? seg.name.slice(0, 27) + '...' : seg.name;
                        return (
                          <span key={`d-${idx}-${seg.id}`} style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: '6px' }}>
                            <AtMentionChip type="document" label={label} />
                          </span>
                        );
                      }
                      return null;
                    })
                  : (
                    <>
                      {message.propertyAttachments?.map((prop, i) => {
                        const part = (prop.address || '').split(',')[0] || prop.address || '';
                        const label = part.length > 30 ? part.slice(0, 27) + '...' : part;
                        return (
                          <span key={prop.id ?? prop.property?.id ?? prop.address ?? `prop-${i}`} style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: '6px' }}>
                            <AtMentionChip
                              type="property"
                              label={label}
                              title={`Click to view ${prop.address}`}
                              onClick={onOpenProperty ? () => onOpenProperty(prop.address, prop.property?.latitude != null && prop.property?.longitude != null ? { lat: prop.property.latitude, lng: prop.property.longitude } : undefined, prop.property?.id ?? prop.propertyId) : undefined}
                            />
                          </span>
                        );
                      })}
                      {message.selectedDocumentIds?.map((docId, i) => {
                        const name = message.selectedDocumentNames?.[i] ?? docId;
                        const label = name.length > 30 ? name.slice(0, 27) + '...' : name;
                        return (
                          <span key={docId} style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: '6px' }}>
                            <AtMentionChip type="document" label={label} />
                          </span>
                        );
                      })}
                      {message.text ? (
                        <span
                          style={{
                            color: '#0D0D0D',
                            fontSize: '14px',
                            lineHeight: '22px',
                            margin: 0,
                            padding: 0,
                            marginRight: '6px',
                            textAlign: 'left',
                            fontFamily: 'system-ui, -apple-system, sans-serif',
                            display: 'inline',
                            cursor: isTruncated ? 'pointer' : 'default',
                            wordWrap: 'break-word',
                            overflowWrap: 'break-word',
                            textDecoration: isTruncated ? 'underline' : 'none',
                            textDecorationStyle: isTruncated ? ('dotted' as const) : undefined,
                            textUnderlineOffset: '3px'
                          }}
                          onClick={isTruncated ? handleCitationPreviewClick : undefined}
                          title={isTruncated ? 'Click to view citation' : undefined}
                          onMouseEnter={() => setHoveredQueryId(finalKey)}
                          onMouseLeave={() => setHoveredQueryId(null)}
                        >
                          <ReactMarkdown components={{
                            p: ({ children }) => <p style={{ margin: 0, padding: 0, display: 'inline', wordWrap: 'break-word', overflowWrap: 'break-word' }}>{children}</p>,
                            h1: ({ children }) => <h1 style={{ fontSize: '18px', fontWeight: 600, margin: '14px 0 10px 0', display: 'block' }}>{children}</h1>,
                            h2: () => null, h3: ({ children }) => <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '10px 0 6px 0' }}>{children}</h3>,
                            ul: ({ children }) => <ul style={{ margin: '10px 0', paddingLeft: '22px' }}>{children}</ul>,
                            ol: ({ children }) => <ol style={{ margin: '10px 0', paddingLeft: '22px' }}>{children}</ol>,
                            li: ({ children }) => <li style={{ marginBottom: '6px' }}>{children}</li>,
                            strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
                            em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
                            code: ({ children }) => <code style={{ backgroundColor: '#f3f4f6', padding: '2px 5px', borderRadius: '4px', fontSize: '14px', fontFamily: 'monospace' }}>{children}</code>,
                            blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid #d1d5db', paddingLeft: '14px', margin: '10px 0', color: '#6b7280' }}>{children}</blockquote>,
                            hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '18px 0' }} />,
                          }}>{truncatedText}</ReactMarkdown>
                        </span>
                      ) : null}
                    </>
                  )}
              </div>
            </div>
            {/* Copy icon below bubble - ChatGPT style */}
            {hoveredQueryId === finalKey && message.text && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyQuery(message.text || '', finalKey);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '2px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: copiedQueryId === finalKey ? '#10B981' : '#9CA3AF',
                  marginTop: '2px'
                }}
                onMouseEnter={(e) => {
                  if (copiedQueryId !== finalKey) {
                    e.currentTarget.style.color = '#6B7280';
                  }
                }}
                onMouseLeave={(e) => {
                  if (copiedQueryId !== finalKey) {
                    e.currentTarget.style.color = '#9CA3AF';
                  }
                }}
                title={copiedQueryId === finalKey ? 'Copied!' : 'Copy'}
              >
                {copiedQueryId === finalKey ? (
                  <Check size={14} />
                ) : (
                  <Copy size={14} />
                )}
              </motion.button>
            )}
          </div>
        );
      }
      
      // Response message
      return (
        <div key={finalKey} style={{ 
          width: '100%', 
          padding: '0', 
          margin: '0', 
          marginTop: '8px', 
          wordWrap: 'break-word',
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
          position: 'relative',
          contain: 'layout style',
          maxWidth: '100%', // Ensure it doesn't exceed container
          boxSizing: 'border-box' // Include padding in width
          // Padding is handled by parent content wrapper (32px left/right)
        }}>
          <div style={{ 
            position: 'relative',
            minHeight: '1px' // Prevent collapse
          }}>
          {/* Reasoning Steps - show when loading, or after response if toggle is enabled */}
          {message.reasoningSteps && message.reasoningSteps.length > 0 && (message.isLoading || showReasoningTrace) && (
            <ReasoningSteps key={`reasoning-${finalKey}`} steps={message.reasoningSteps} isLoading={message.isLoading} hasResponseText={!!message.text} isAgentMode={isAgentMode} skipAnimations={!!isRestored} />
          )}
            {/* Show bouncing dot only after ALL reading is complete - right before response text arrives */}
            {message.isLoading && !message.text && 
             message.reasoningSteps?.some(step => step.action_type === 'reading') &&
             message.reasoningSteps?.filter(step => step.action_type === 'reading').every(step => step.details?.status === 'read') && (
              <ThinkingDot />
            )}
          </div>
          {/* Show streaming text as it arrives - inline with typing effect */}
          {/* Show text as soon as it exists - allow streaming to display immediately */}
          {message.text && (
            <div style={{
              position: 'relative',
              minHeight: '1px', // Prevent collapse
              contain: 'layout style' // Prevent layout shifts (removed 'paint' to prevent text clipping)
            }}>
              <StreamingResponseTextMemo
                text={message.text}
                isStreaming={message.isLoading || false} // Allow streaming to continue
                citations={message.citations}
                handleCitationClick={(data: CitationDataType, anchorRect?: DOMRect, citationNumber?: string) => handleUserCitationClick(data, anchorRect, message.text, finalKey, citationNumber)}
                renderTextWithCitations={renderTextWithCitations}
                onTextUpdate={scrollToBottom}
                messageId={finalKey}
                skipHighlight={!isLatestAssistantMessage || !showHighlight || (orangeCitationNumbersByMessage.get(message.id ?? finalKey)?.size ?? 0) > 0}
                showCitations={showCitations}
                orangeCitationNumbers={orangeCitationNumbersByMessage.get(message.id ?? finalKey)}
                selectedCitationNumber={citationClickPanel?.citationNumber}
                selectedCitationMessageId={citationClickPanel?.messageId}
              />
            </div>
          )}
        </div>
      );
    }).filter(Boolean);
  }, [chatMessages, showReasoningTrace, showHighlight, showCitations, restoredMessageIdsRef, handleUserCitationClick, onOpenProperty, scrollToBottom, expandedCardViewDoc, propertyAttachments, orangeCitationNumbersByMessage, citationClickPanel]);

  return (
    <>
      {/* Dark overlay when citation panel is open - rendered inside panel so chat bar can sit above it (z-index) */}
      {citationClickPanel && (() => {
        const data = citationClickPanel.citationData as CitationData & { document_id?: string };
        const docId = data.document_id ?? data.doc_id;
        const pageNum = data.page ?? data.bbox?.page ?? data.page_number ?? 1;
        const cacheKey = docId ? `hover-${docId}-${pageNum}` : '';
        const cachedPreview = cacheKey ? (hoverPreviewCache.get(cacheKey) ?? null) : null;
        const fromCache = cachedPreview
          ? { pageImage: cachedPreview.pageImage, imageWidth: cachedPreview.imageWidth, imageHeight: cachedPreview.imageHeight }
          : null;
        const cachedPageImage = fromCache ?? citationPanelLoadedImage;
        return createPortal(
          <CitationClickPanel
            citationData={citationClickPanel.citationData}
            anchorRect={citationClickPanel.anchorRect}
            cachedPageImage={cachedPageImage}
            onViewInDocument={() => {
              openCitationInDocumentView(citationClickPanel.citationData, false);
              setCitationClickPanel(null);
            }}
            onAskFollowUp={() => {
              const citationData = citationClickPanel.citationData as CitationData & { document_id?: string; block_id?: string; cited_text?: string; block_content?: string };
              const raw = (citationData.cited_text || citationData.block_content || 'this citation').trim().slice(0, 200);
              // Strip markdown so chip label doesn't show ** or __ etc.
              const snippet = raw.replace(/\*\*/g, '').replace(/__/g, '');
              const id = `cite-${citationData.doc_id ?? (citationData as any).document_id ?? 'doc'}-${citationData.page ?? citationData.page_number ?? citationData.bbox?.page ?? 0}-${Date.now()}`;
              const sourceMessageText = citationClickPanel.sourceMessageText != null ? citationClickPanel.sourceMessageText.slice(-2000) : undefined;
              segmentInput.insertChipAtCursor(
                {
                  type: 'chip',
                  kind: 'citation_snippet',
                  id,
                  label: snippet,
                  payload: {
                    citationData: { ...citationData, block_id: citationData.block_id, cited_text: snippet },
                    sourceMessageText,
                    messageId: citationClickPanel.messageId,
                    citationNumber: citationClickPanel.citationNumber,
                  },
                },
                { trailingSpace: true }
              );
              setCitationClickPanel(null);
              requestAnimationFrame(() => {
                inputRef.current?.focus();
                requestAnimationFrame(() => restoreSelectionRef.current?.());
              });
            }}
            onClose={() => setCitationClickPanel(null)}
          />,
          document.body
        );
      })()}
    <AnimatePresence mode="wait">
      {isVisible && (
        <motion.div
          key="side-chat-panel"
          ref={panelRef}
          data-side-chat-panel-root="true"
          initial={false} // No animation - instant appearance always
          animate={{ 
            opacity: 1
          }}
          exit={{ opacity: 0, transition: { duration: 0 } }} // No slide animation on exit - instant disappear
          transition={{ duration: 0 }} // No animation - instant appearance
          layout={false} // Disable layout animation
          onClick={(e) => e.stopPropagation()} // Prevent clicks from closing agent sidebar
          className={`fixed top-0 bottom-0 ${citationClickPanel ? 'z-[10051]' : 'z-[10001]'}`}
          style={{
            left: (() => {
              // Always use sidebarWidth prop which MainContent calculates correctly
              // MainContent accounts for FilingSidebar width when open/closing, and base sidebar when closed
              // This ensures instant updates with no gaps during open/close transitions
              return `${sidebarWidth}px`;
            })(), // Always positioned using sidebarWidth from MainContent - updates instantly
            width: (() => {
              // Use unified width calculation for consistent behavior
              // This ensures the same width logic is used for both parent notification and DOM rendering
              const isDocumentPreviewOpen = isPropertyDetailsOpen || !!expandedCardViewDoc;
              
              const { widthCss } = calculateChatPanelWidth({
                draggedWidth,
                isExpanded,
                isFullscreenMode,
                isDocumentPreviewOpen,
                isPropertyDetailsOpen,
                sidebarWidth,
                chatPanelWidth,
                isChatPanelOpen,
                shouldExpand,
                isManualFullscreen: isManualFullscreenRef.current,
              });
              
              return widthCss;
            })(),
            backgroundColor: '#FCFCF9',
            boxShadow: 'none',
            // Disable ALL transitions instantly when FilingSidebar/sidebar closes or resizes to prevent map showing through
            // Track previous sidebar state to detect collapse immediately
            // Use local tracking (isSidebarJustCollapsed) for immediate detection, plus props for MainContent tracking
            // This ensures chat panel adjusts immediately with no animation delay
            // Also disable transitions when ChatPanel (agent sidebar) opens/closes for instant width adjustment
            transition: (isResizing || isFilingSidebarResizing || isChatPanelResizing || isChatPanelJustToggled || isFilingSidebarClosing || isSidebarCollapsing || isSidebarJustCollapsed || !isFilingSidebarOpen || justEnteredFullscreen || shouldExpand || isRestoringFullscreen || (isFullscreenMode && !isRestoringFullscreen) || isFirstOpen) ? 'none' : 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
            transitionProperty: (isResizing || isFilingSidebarResizing || isChatPanelResizing || isChatPanelJustToggled || isFilingSidebarClosing || isSidebarCollapsing || isSidebarJustCollapsed || !isFilingSidebarOpen || isFirstOpen) ? 'none' : 'width', // Disable ALL transitions (including left) when resizing, closing, ChatPanel toggle, or first opening
            willChange: (isResizing || isFilingSidebarResizing || isChatPanelResizing || isChatPanelJustToggled || isFilingSidebarClosing || isSidebarCollapsing || isSidebarJustCollapsed) ? 'left, width' : 'width', // Optimize for instant changes when closing or ChatPanel toggle
            backfaceVisibility: 'hidden', // Prevent flickering
            transform: 'translateZ(0)' // Force GPU acceleration
          }}
        >
          {/* Dark overlay when citation panel open - fullscreen of chat view, behind chat bar so chat bar stays interactive */}
          {citationClickPanel && (
            <div
              onClick={() => setCitationClickPanel(null)}
              style={{
                position: 'absolute',
                inset: 0,
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0, 0, 0, 0.04)',
                zIndex: 10050,
                pointerEvents: 'auto',
              }}
            />
          )}
          {/* Drag handle for resizing from right edge - extends full height above all content */}
          {/* Only show when property details panel is open OR when document preview is NOT open */}
          {/* When document preview is open, the document's left edge handles resize instead */}
          {(isPropertyDetailsOpen || !expandedCardViewDoc) && (
            <div
              onMouseDown={handleResizeStart}
              className="group"
              style={{
                position: 'absolute',
                right: -6, // Extend into document preview area for easier grabbing
                top: 0,
                bottom: 0,
                width: '12px', // Wider grab area for easier interaction
                cursor: 'ew-resize',
                zIndex: 10010,
                backgroundColor: 'transparent',
                pointerEvents: 'auto',
                display: 'flex',
                justifyContent: 'center', // Center the visual indicator
                alignItems: 'center',
              }}
            >
              {/* Border line - only visible when property details panel is open */}
              <div
                className={`transition-all duration-100 ${isPropertyDetailsOpen ? 'group-hover:bg-blue-500 group-active:bg-blue-600' : ''}`}
                style={{
                  width: isResizing ? '3px' : (isPropertyDetailsOpen ? '1px' : '0px'),
                  height: '100%',
                  backgroundColor: isResizing ? 'rgb(59, 130, 246)' : (isPropertyDetailsOpen ? 'rgba(203, 213, 225, 1)' : 'transparent'),
                  borderRadius: '1px',
                  transition: 'width 100ms ease-out, background-color 100ms ease-out',
                }}
              />
            </div>
          )}
          
          {/* Panel content container - with optional expanded plan panel on left */}
          <div 
            style={{
              display: 'flex',
              width: '100%',
              height: '100%',
              position: 'relative',
            }}
          >
            {/* Expanded Plan Panel - LEFT side when View Plan is clicked */}
            {isPlanPanelExpanded && showPlanViewer && (
              <div
                style={{
                  width: '55%',
                  minWidth: '400px',
                  maxWidth: '600px',
                  height: '100%',
                  flexShrink: 0,
                  padding: '20px',
                  backgroundColor: '#FCFCF9',
                  overflow: 'hidden',
                  transition: 'width 0.3s ease',
                }}
              >
                <ExpandedPlanViewer
                  planContent={planContent}
                  previousPlanContent={previousPlanContent}
                  isUpdateMode={isUpdatingPlan}
                  isStreaming={planBuildStatus === 'streaming'}
                  onCollapse={() => setIsPlanPanelExpanded(false)}
                  onAccept={() => {
                    // Accept the updated plan
                    setPreviousPlanContent('');
                    setIsUpdatingPlan(false);
                    setAdjustmentQuery('');
                  }}
                  onReject={() => {
                    // Reject - restore previous plan
                    if (previousPlanContent) {
                      setPlanContent(previousPlanContent);
                    }
                    setPreviousPlanContent('');
                    setIsUpdatingPlan(false);
                    setAdjustmentQuery('');
                  }}
                  onLineUndo={(_lineId, lineContent, type) => {
                    if (type === 'added') {
                      const lines = planContent.split('\n');
                      const idx = lines.findIndex((l) => l === lineContent);
                      if (idx !== -1) {
                        lines.splice(idx, 1);
                        setPlanContent(lines.join('\n'));
                      }
                    } else {
                      setPlanContent((prev) => (prev.trimEnd() ? `${prev}\n${lineContent}` : `${prev}${lineContent}`));
                    }
                  }}
                  onBuild={async () => {
                    // Same build logic as PlanViewer
                    if (planId && planQueryText) {
                      setPlanBuildStatus('building');
                      setShowPlanViewer(false);
                      setIsPlanPanelExpanded(false);
                      
                      // Query message already added when entering plan mode - no need to add again
                      
                      const responseMessageId = `response-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                      let accumulatedResponse = '';
                      const reasoningStepsForBuild: ReasoningStep[] = [];
                      
                      const responseMessage: ChatMessage = {
                        id: responseMessageId,
                        type: 'response',
                        text: '',
                        isLoading: true,
                        reasoningSteps: []
                      };
                      setChatMessages(prev => [...prev, responseMessage]);
                      
                      try {
                        await backendApi.buildPlan(
                          planId,
                          sessionId,
                          planQueryText,
                          (token: string) => {
                            accumulatedResponse += token;
                            setChatMessages(prev => prev.map(msg => 
                              msg.id === responseMessageId 
                                ? { ...msg, text: accumulatedResponse }
                                : msg
                            ));
                          },
                          (data: any) => {
                            console.log('📋 [EXPANDED_PLAN_BUILD] Complete:', data);
                            // Mark all reasoning steps as complete (safety net)
                            const completedSteps = reasoningStepsForBuild.map(step => ({
                              ...step,
                              details: {
                                ...step.details,
                                status: step.details?.status === 'running' ? 'complete' : step.details?.status
                              }
                            }));
                            
                            // Convert citations array from backend to Record format for frontend
                            let citationsRecord: Record<string, any> = {};
                            if (data?.citations && Array.isArray(data.citations)) {
                              data.citations.forEach((citation: any) => {
                                const citationNum = String(citation.citation_number);
                                citationsRecord[citationNum] = {
                                  doc_id: citation.doc_id,
                                  page: citation.page_number || 1,
                                  page_number: citation.page_number || 1,
                                  bbox: citation.bbox || {},
                                  block_id: citation.block_id
                                };
                              });
                              console.log('📋 [EXPANDED_PLAN_BUILD] Converted citations:', citationsRecord);
                            }
                            
                            setChatMessages(prev => prev.map(msg => 
                              msg.id === responseMessageId 
                                ? { 
                                    ...msg, 
                                    text: data?.summary || accumulatedResponse,
                                    isLoading: false,
                                    reasoningSteps: completedSteps,
                                    citations: Object.keys(citationsRecord).length > 0 ? citationsRecord : undefined
                                  }
                                : msg
                            ));
                            setPlanBuildStatus('built');
                            setPlanContent('');
                            setPlanId(null);
                            setPlanQueryText('');
                          },
                          (error: string) => {
                            console.error('📋 [EXPANDED_PLAN_BUILD] Error:', error);
                            setChatMessages(prev => prev.map(msg => 
                              msg.id === responseMessageId 
                                ? { ...msg, text: `Error: ${error}`, isLoading: false }
                                : msg
                            ));
                            setPlanBuildStatus('error');
                          },
                          (step) => {
                            console.log('📋 [EXPANDED_PLAN_BUILD] Reasoning step:', step);
                            const typedStep = step as ReasoningStep;
                            const toolName = typedStep.details?.tool_name;
                            const status = typedStep.details?.status;
                            
                            // If this is a "complete" status for an existing "running" step, update it instead of adding
                            if (toolName && status === 'complete') {
                              const existingIndex = reasoningStepsForBuild.findIndex(
                                s => s.details?.tool_name === toolName && s.details?.status === 'running'
                              );
                              if (existingIndex !== -1) {
                                // Update the existing step with complete status
                                reasoningStepsForBuild[existingIndex] = typedStep;
                              } else {
                                // No running step found, add as new
                                reasoningStepsForBuild.push(typedStep);
                              }
                            } else {
                              // Running step or other - add to array
                              reasoningStepsForBuild.push(typedStep);
                            }
                            
                            setChatMessages(prev => prev.map(msg => 
                              msg.id === responseMessageId 
                                ? { ...msg, reasoningSteps: [...reasoningStepsForBuild] }
                                : msg
                            ));
                          }
                        );
                      } catch (error) {
                        console.error('Failed to build plan:', error);
                        setPlanBuildStatus('error');
                        setChatMessages(prev => prev.map(msg => 
                          msg.id === responseMessageId 
                            ? { ...msg, text: `Error: ${error}`, isLoading: false }
                            : msg
                        ));
                      }
                    }
                  }}
                  buildStatus={planBuildStatus === 'streaming' ? 'streaming' : planBuildStatus === 'building' ? 'building' : planBuildStatus === 'built' ? 'built' : 'ready'}
                  planName={planQueryText ? `research_${planQueryText.slice(0, 20).replace(/\s+/g, '_')}` : 'research_plan'}
                  adjustmentQuery={adjustmentQuery}
                />
              </div>
            )}
            
            {/* Main chat content */}
            <div 
              className="h-full flex flex-col"
              style={{
                // Hide content briefly when opening in fullscreen to prevent flash
                // But don't hide when property details is open (50/50 split mode)
                opacity: (shouldExpand && !isFullscreenMode && !isPropertyDetailsOpen) ? 0 : 1,
                transition: (shouldExpand && !isFullscreenMode && !isPropertyDetailsOpen) ? 'none' : 'opacity 0.05s ease-in, width 0.3s ease',
                visibility: (shouldExpand && !isFullscreenMode && !isPropertyDetailsOpen) ? 'hidden' : 'visible',
                position: 'relative',
                backgroundColor: '#FCFCF9', // Ensure solid background to prevent leaks
                overflow: 'hidden', // Prevent content from leaking during transitions
                width: isPlanPanelExpanded && showPlanViewer ? '45%' : '100%',
                minWidth: isPlanPanelExpanded && showPlanViewer ? '350px' : undefined,
                height: '100%',
                flex: 1,
              }}
            >
            {/* Header - Fixed at top */}
            <div 
              className="pr-4 pl-6" 
              style={{ 
                backgroundColor: '#FCFCF9', 
                position: 'sticky', 
                top: 0, 
                zIndex: 10002,
                flexShrink: 0,
                pointerEvents: 'auto',
                paddingTop: '15px',
                paddingBottom: '19px'
              }}
            >
              <div 
                className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 group"
                onMouseMove={(e) => {
                  if (editButtonRef.current && actualPanelWidth >= 940) {
                    const buttonRect = editButtonRef.current.getBoundingClientRect();
                    const mouseX = e.clientX;
                    const mouseY = e.clientY;
                    
                    // Calculate distance from cursor to button center
                    const buttonCenterX = buttonRect.left + buttonRect.width / 2;
                    const buttonCenterY = buttonRect.top + buttonRect.height / 2;
                    const distance = Math.sqrt(
                      Math.pow(mouseX - buttonCenterX, 2) + Math.pow(mouseY - buttonCenterY, 2)
                    );
                    
                    // Show button when cursor is within 60px
                    setIsNearEditButton(distance < 60);
                  }
                }}
                onMouseLeave={() => {
                  setIsNearEditButton(false);
                }}
              >
                <div className="flex items-center space-x-2 min-w-0">
                  {/* View dropdown: Sidebar, Files, New chat, Fullscreen. When Sidebar/Files/Expand are active, Close/Exit appears beside the dropdown; fullscreen is exit-only inside the dropdown. */}
                  {isMainSidebarOpen && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (onSidebarToggle) onSidebarToggle();
                      }}
                      className={`flex items-center ${actualPanelWidth >= 750 ? 'gap-1' : 'justify-center'} rounded-sm hover:bg-[#f0f0f0] active:bg-[#e8e8e8] transition-all duration-150`}
                      title="Close sidebar"
                      type="button"
                      style={{
                        padding: actualPanelWidth >= 750 ? '5px 8px' : '5px',
                        height: '26px',
                        minHeight: '26px',
                        border: 'none',
                        position: 'relative',
                        zIndex: 10001,
                        pointerEvents: 'auto',
                        cursor: 'pointer',
                        backgroundColor: 'rgba(0, 0, 0, 0.04)'
                      }}
                    >
                      <PanelRightClose className="w-3.5 h-3.5 text-[#666] scale-x-[-1]" strokeWidth={1.75} />
                      {actualPanelWidth >= 750 && (
                        <span className="text-[12px] font-normal text-[#666]">Close</span>
                      )}
                    </button>
                  )}
                  {!isNewChatSection && isFilingSidebarOpen && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        toggleFilingSidebar();
                      }}
                      className={`flex items-center ${actualPanelWidth >= 750 ? 'gap-1' : 'justify-center'} rounded-sm hover:bg-[#f0f0f0] active:bg-[#e8e8e8] transition-all duration-150`}
                      title="Close Files"
                      type="button"
                      style={{
                        padding: actualPanelWidth >= 750 ? '5px 8px' : '5px',
                        height: '26px',
                        minHeight: '26px',
                        border: 'none',
                        position: 'relative',
                        zIndex: 10001,
                        pointerEvents: 'auto',
                        cursor: 'pointer',
                        backgroundColor: 'rgba(0, 0, 0, 0.04)'
                      }}
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-[#666]" strokeWidth={1.75} />
                      {actualPanelWidth >= 750 && (
                        <span className="text-[12px] font-normal text-[#666]">Close</span>
                      )}
                    </button>
                  )}
                  {/* Exit fullscreen: not shown outside dropdown in chat – use View → Fullscreen/Exit */}
                  {isChatLarge && hasUserExpandedFromView && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        handleMinimiseChat();
                      }}
                      className={`flex items-center ${actualPanelWidth >= 750 ? 'gap-1' : 'justify-center'} rounded-sm hover:bg-[#f0f0f0] active:bg-[#e8e8e8] transition-all duration-150`}
                      title="Minimise chat"
                      type="button"
                      style={{
                        padding: actualPanelWidth >= 750 ? '5px 8px' : '5px',
                        height: '26px',
                        minHeight: '26px',
                        border: 'none',
                        position: 'relative',
                        zIndex: 10001,
                        pointerEvents: 'auto',
                        cursor: 'pointer',
                        backgroundColor: 'rgba(0, 0, 0, 0.04)'
                      }}
                    >
                      <Minimize2 className="w-3.5 h-3.5 text-[#666]" strokeWidth={1.75} />
                      {actualPanelWidth >= 750 && (
                        <span className="text-[12px] font-normal text-[#666]">Minimise</span>
                      )}
                    </button>
                  )}
                  {!isChatLarge && hasUserMinimisedFromView && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        handleExpandChat();
                      }}
                      className={`flex items-center ${actualPanelWidth >= 750 ? 'gap-1' : 'justify-center'} rounded-sm hover:bg-[#f0f0f0] active:bg-[#e8e8e8] transition-all duration-150`}
                      title="Expand chat"
                      type="button"
                      style={{
                        padding: actualPanelWidth >= 750 ? '5px 8px' : '5px',
                        height: '26px',
                        minHeight: '26px',
                        border: 'none',
                        position: 'relative',
                        zIndex: 10001,
                        pointerEvents: 'auto',
                        cursor: 'pointer',
                        backgroundColor: 'rgba(0, 0, 0, 0.04)'
                      }}
                    >
                      <MoveDiagonal className="w-3.5 h-3.5 text-[#666]" strokeWidth={1.75} />
                      {actualPanelWidth >= 750 && (
                        <span className="text-[12px] font-normal text-[#666]">Expand</span>
                      )}
                    </button>
                  )}
                  <Popover open={viewOptionsOpen} onOpenChange={setViewOptionsOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-haspopup="true"
                        aria-expanded={viewOptionsOpen}
                        title="View – sidebar, files, new chat, fullscreen"
                        className="flex items-center rounded-sm hover:bg-[#f0f0f0] transition-all duration-150 cursor-pointer border-none bg-transparent"
                        style={{
                          padding: actualPanelWidth < 750 ? '5px' : '5px 8px',
                          height: '26px',
                          minHeight: '26px',
                        }}
                        onMouseEnter={handleViewOptionsTriggerEnter}
                        onMouseLeave={handleViewOptionsTriggerLeave}
                        onClick={(e) => {
                          e.stopPropagation();
                          setViewOptionsOpen((prev) => !prev);
                        }}
                      >
                        <PictureInPicture2 className="w-3.5 h-3.5 text-[#666] flex-shrink-0" strokeWidth={1.75} />
                        {actualPanelWidth >= 750 && (
                          <span className="text-[12px] font-normal text-[#666] ml-2">View</span>
                        )}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      side="bottom"
                      sideOffset={4}
                      onMouseEnter={handleViewOptionsContentEnter}
                      onMouseLeave={handleViewOptionsContentLeave}
                      className="min-w-[200px] w-auto rounded-lg border border-gray-200 bg-white p-3 shadow-md"
                      onOpenAutoFocus={(e) => e.preventDefault()}
                    >
                      <div className="flex flex-col gap-1">
                        {!isMainSidebarOpen && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setViewOptionsOpen(false);
                              if (onSidebarToggle) onSidebarToggle();
                            }}
                            className="flex items-center gap-2 w-full rounded-sm px-2 py-2 text-left hover:bg-[#f5f5f5] text-[12px] text-[#374151]"
                          >
                            <PanelLeftOpen className="w-3.5 h-3.5 text-[#666] flex-shrink-0" strokeWidth={1.75} />
                            Sidebar
                          </button>
                        )}
                        {!isNewChatSection && !isFilingSidebarOpen && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setViewOptionsOpen(false);
                              toggleFilingSidebar();
                            }}
                            className="flex items-center gap-2 w-full rounded-sm px-2 py-2 text-left hover:bg-[#f5f5f5] text-[12px] text-[#374151]"
                          >
                            <FolderOpen className="w-3.5 h-3.5 text-[#666] flex-shrink-0" strokeWidth={1.75} />
                            Files
                          </button>
                        )}
                        {isFullscreenMode ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setViewOptionsOpen(false);
                              handleMinimiseChat();
                            }}
                            className="flex items-center gap-2 w-full rounded-sm px-2 py-2 text-left hover:bg-[#f5f5f5] text-[12px] text-[#374151]"
                          >
                            <Minimize2 className="w-3.5 h-3.5 text-[#666] flex-shrink-0" strokeWidth={1.75} />
                            Minimise
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setViewOptionsOpen(false);
                              handleExpandChat();
                            }}
                            className="flex items-center gap-2 w-full rounded-sm px-2 py-2 text-left hover:bg-[#f5f5f5] text-[12px] text-[#374151]"
                          >
                            <MoveDiagonal className="w-3.5 h-3.5 text-[#666] flex-shrink-0" strokeWidth={1.75} />
                            Expand
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            // Call fullscreen first so it runs in the same user gesture (browser requirement)
                            void toggleBrowserFullscreen();
                            setViewOptionsOpen(false);
                          }}
                          className="flex items-center gap-2 w-full rounded-sm px-2 py-2 text-left hover:bg-[#f5f5f5] text-[12px] text-[#374151]"
                        >
                          {isBrowserFullscreen ? (
                            <Minimize className="w-3.5 h-3.5 text-[#666] flex-shrink-0" strokeWidth={1.75} />
                          ) : (
                            <Fullscreen className="w-3.5 h-3.5 text-[#666] flex-shrink-0" strokeWidth={1.75} />
                          )}
                          {isBrowserFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                        </button>
                        {!isNewChatSection && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setViewOptionsOpen(false);
                              handleNewChatClick();
                            }}
                            className="flex items-center gap-2 w-full rounded-sm px-2 py-2 text-left hover:bg-[#f5f5f5] text-[12px] text-[#374151]"
                          >
                            <Plus className="w-3.5 h-3.5 text-[#666] flex-shrink-0" strokeWidth={1.75} />
                            New chat
                          </button>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                
                {/* Center - Chat Title (hidden on new chat section). Grid keeps title centered regardless of left/right content width. */}
                <div className="flex items-center justify-center px-4 min-w-0">
                  {!isNewChatSection && (actualPanelWidth >= 900 ? (
                    <div className="flex items-center gap-2 max-w-md">
                      {/* Padlock icon (subtle, light gray) - shown by default, hidden when editing */}
                      {!isEditingTitle && (
                        <Lock 
                          className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" 
                          style={{ pointerEvents: 'none' }}
                        />
                      )}
                      
                      {/* Title display/input */}
                      {isEditingTitle ? (
                        <input
                          type="text"
                          value={editingTitleValue}
                          onChange={(e) => setEditingTitleValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleSaveTitle();
                            }
                            if (e.key === 'Escape') {
                              handleCancelEdit();
                            }
                          }}
                          onBlur={handleSaveTitle}
                          className="text-sm font-normal text-gray-900 bg-transparent border-none outline-none text-center flex-1 min-w-0"
                          style={{ width: '100%' }}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span 
                          className="text-sm font-normal text-slate-600 truncate text-center cursor-pointer hover:text-slate-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleEdit();
                          }}
                          onMouseEnter={(e) => {
                            e.stopPropagation();
                            setIsHoveringName(true);
                          }}
                          onMouseLeave={(e) => {
                            e.stopPropagation();
                            setIsHoveringName(false);
                          }}
                          title="Click to edit chat name"
                          style={{ 
                            display: 'inline-block',
                            padding: '0',
                            margin: '0'
                          }}
                        >
                          {isTitleStreaming ? streamedTitle : (chatTitle || 'New chat')}
                        </span>
                      )}
                      
                      {/* Edit toggle (pencil icon) - hidden when width is small */}
                      {actualPanelWidth >= 940 && (
                        <button
                          ref={editButtonRef}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleEdit();
                          }}
                          className={`${isNearEditButton ? 'opacity-100' : 'opacity-0'} p-1 rounded hover:bg-gray-100 transition-opacity flex-shrink-0`}
                          title="Edit chat name"
                          type="button"
                        >
                          <Pencil className="w-3.5 h-3.5 text-gray-400" />
                        </button>
                      )}
                    </div>
                  ) : isEditingTitle ? (
                    <div className="flex items-center gap-2 max-w-md">
                      <input
                        type="text"
                        value={editingTitleValue}
                        onChange={(e) => setEditingTitleValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleSaveTitle();
                          }
                          if (e.key === 'Escape') {
                            handleCancelEdit();
                          }
                        }}
                        onBlur={handleSaveTitle}
                        className="text-sm font-normal text-gray-900 bg-transparent border-none outline-none text-center flex-1 min-w-0"
                        style={{ width: '100%' }}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  ) : null)}
                </div>
                
                <div className="flex items-center space-x-2 min-w-0 justify-end">
                  {/* Agents Sidebar Button – shown on opening screen and when chat has messages */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      if (isChatPanelOpen) {
                        // Only close when open - use closePanel instead of toggle
                        closeChatPanel();
                      } else {
                        // Open when closed
                        toggleChatPanel();
                      }
                    }}
                    className={`flex items-center ${actualPanelWidth >= 750 ? 'gap-1' : 'justify-center'} rounded-sm border-none cursor-pointer transition-all duration-150 ${isChatPanelOpen ? 'bg-black/[0.04]' : 'bg-transparent'} hover:bg-[#f0f0f0] active:bg-[#e8e8e8]`}
                    title={isChatPanelOpen ? "Close Agent Sidebar" : "Agents Sidebar"}
                    type="button"
                    style={{
                      padding: actualPanelWidth < 750 ? '5px' : '5px 8px',
                      height: '26px',
                      minHeight: '26px',
                    }}
                  >
                    {isChatPanelOpen ? (
                      <PanelRightClose
                        className="w-3.5 h-3.5 text-[#666] scale-x-[-1]"
                        strokeWidth={1.75}
                      />
                    ) : (
                      <img src={agentIcon} alt="Agents" className="w-5 h-5" aria-hidden />
                    )}
                    {actualPanelWidth >= 750 && (
                      <span className={`font-normal text-[#666] ${isChatPanelOpen ? 'text-[12px]' : 'text-[14px]'}`}>
                        {isChatPanelOpen ? "Close" : "Agents"}
                      </span>
                    )}
                  </button>
                  
                  {/* Response (reasoning trace + answer highlight) – hover popover */}
                  {!isNewChatSection && (
                  <Popover open={displayOptionsOpen} onOpenChange={setDisplayOptionsOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-haspopup="true"
                        aria-expanded={displayOptionsOpen}
                        title="Response – reasoning trace, answer highlight, and citations"
                        className="flex items-center rounded-sm hover:bg-[#f0f0f0] transition-all duration-150 cursor-pointer border-none bg-transparent"
                        style={{
                          padding: actualPanelWidth < 750 ? '5px' : '5px 8px',
                          height: '26px',
                          minHeight: '26px',
                        }}
                        onMouseEnter={handleDisplayOptionsTriggerEnter}
                        onMouseLeave={handleDisplayOptionsTriggerLeave}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDisplayOptionsOpen((prev) => !prev);
                        }}
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5 text-[#666] flex-shrink-0" strokeWidth={1.75} />
                        {actualPanelWidth >= 750 && (
                          <span className="text-[12px] font-normal text-[#666] ml-1.5">Response</span>
                        )}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      side="bottom"
                      sideOffset={4}
                      onMouseEnter={handleDisplayOptionsContentEnter}
                      onMouseLeave={handleDisplayOptionsContentLeave}
                      className="min-w-[200px] w-auto rounded-lg border border-gray-200 bg-white p-3 shadow-md"
                      onOpenAutoFocus={(e) => e.preventDefault()}
                    >
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <Brain className="w-3.5 h-3.5 text-[#666] flex-shrink-0" strokeWidth={1.75} />
                            <span className="text-[12px] text-[#374151]">Reasoning trace</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              flushSync(() => setShowReasoningTrace((prev) => !prev));
                            }}
                            className={`relative w-7 h-4 flex-shrink-0 rounded-full transition-colors ${
                              showReasoningTrace ? 'bg-[#1f2937]' : 'bg-[#d1d5db]'
                            }`}
                          >
                            <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${
                              showReasoningTrace ? 'translate-x-3' : 'translate-x-0'
                            }`} />
                          </button>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <Highlighter className="w-3.5 h-3.5 text-[#666] flex-shrink-0" strokeWidth={1.75} />
                            <span className="text-[12px] text-[#374151]">Answer highlight</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowHighlight(!showHighlight);
                            }}
                            className={`relative w-7 h-4 flex-shrink-0 rounded-full transition-colors ${
                              showHighlight ? 'bg-[#1f2937]' : 'bg-[#d1d5db]'
                            }`}
                          >
                            <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${
                              showHighlight ? 'translate-x-3' : 'translate-x-0'
                            }`} />
                          </button>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <BookOpen className="w-3.5 h-3.5 text-[#666] flex-shrink-0" strokeWidth={1.75} />
                            <span className="text-[12px] text-[#374151]">Citations</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowCitations(!showCitations);
                            }}
                            className={`relative w-7 h-4 flex-shrink-0 rounded-full transition-colors ${
                              showCitations ? 'bg-[#1f2937]' : 'bg-[#d1d5db]'
                            }`}
                          >
                            <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${
                              showCitations ? 'translate-x-3' : 'translate-x-0'
                            }`} />
                          </button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                  )}
                  
                  <button
                    onClick={() => {
                      // CRITICAL: Save chat state before closing (granular restoration)
                      if (currentChatId && (inputValue.trim() || attachedFiles.length > 0 || propertyAttachments.length > 0 || submittedQueries.length > 0)) {
                        console.log('💾 SideChatPanel: Saving chat state before closing:', {
                          chatId: currentChatId,
                          inputValue: inputValue,
                          attachedFiles: attachedFiles.length,
                          propertyAttachments: propertyAttachments.length
                        });
                        saveChatState(currentChatId, {
                          inputValue: inputValue,
                          attachedFiles: [...attachedFiles],
                          propertyAttachments: [...propertyAttachments],
                          submittedQueries: [...submittedQueries] as any[]
                        });
                      }
                      
                      // CRITICAL: Save document preview state to buffer before closing
                      // This ensures the document preview is restored when returning to this chat
                      if (currentChatId && expandedCardViewDoc) {
                        const bufferedState = getBufferedState(currentChatId);
                        bufferedState.documentPreview = {
                          docId: expandedCardViewDoc.docId,
                          filename: expandedCardViewDoc.filename,
                          highlight: expandedCardViewDoc.highlight ? {
                            fileId: expandedCardViewDoc.highlight.fileId,
                            bbox: expandedCardViewDoc.highlight.bbox, // bbox already contains page
                            doc_id: expandedCardViewDoc.highlight.doc_id,
                            block_id: expandedCardViewDoc.highlight.block_id || '',
                            block_content: expandedCardViewDoc.highlight.block_content,
                            original_filename: expandedCardViewDoc.highlight.original_filename
                          } : undefined
                        };
                        console.log('💾 SideChatPanel: Saved document preview to buffer before closing:', bufferedState.documentPreview);
                      }
                      
                      // CRITICAL: Use onMinimize when there are messages to preserve chat data for return-to-chat
                      // This matches the behavior of the regular chat interface
                      if (onMinimize && chatMessages.length > 0) {
                        closeExpandedCardView(); // Close document preview (Reference agent) when closing chat
                        onMinimize(chatMessages);
                      } else if (onMapToggle) {
                        closeExpandedCardView(); // Close document preview (Reference agent) when closing chat
                        onMapToggle();
                      }
                    }}
                    className="rounded-sm hover:bg-[#f0f0f0] active:bg-[#e8e8e8] transition-all duration-150"
                    title="Close chat"
                    style={{
                      padding: '5px',
                      height: '26px',
                      minHeight: '26px',
                      marginLeft: '8px',
                      ...(isPropertyDetailsOpen ? { marginRight: '8px' } : {}),
                      position: 'relative',
                      zIndex: 10001,
                      pointerEvents: 'auto',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <X className="w-4 h-4 text-[#666]" strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            </div>
            
            {/* Conditional layout: Centered empty state OR normal messages + bottom input */}
            {/* Single child with key so AnimatePresence mode="wait" never sees multiple children */}
            <AnimatePresence mode="wait">
            <motion.div
              key={isEmptyChat ? 'empty-chat-layout' : 'messages-layout'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', width: '100%' }}
            >
            {isEmptyChat ? (
              /* Empty chat state - Centered expanded chat bar (like Cursor's new chat) */
              <div
                key="empty-chat-layout-inner"
                ref={contentAreaRef}
                onClick={(e) => e.stopPropagation()}
                className="flex-1"
                style={{
                  backgroundColor: '#FCFCF9',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-start',
                  alignItems: 'center',
                  // Reduce padding for narrow panels
                  padding: actualPanelWidth < 320 ? '0 12px' : '0 32px',
                  paddingTop: '26vh', // Y position of new-chat bar (increase to move down, decrease to move up)
                  minWidth: '200px', // Allow narrower layouts
                  position: 'relative',
                  overflowX: 'hidden'
                }}
              >
                {/* Title above chat bar - slightly less bold */}
                {emptyStateTitleMessage ? (
                  <h1
                    className="w-full text-center text-[#111]"
                    style={{
                      fontWeight: 400,
                      fontSize: 'clamp(1.125rem, 3vw, 1.375rem)',
                      lineHeight: 1.3,
                      marginBottom: '56px',
                    }}
                  >
                    {emptyStateTitleMessage}
                  </h1>
                ) : null}
                {/* Expanded Chat Input Container */}
                <div style={{ 
                  width: '100%', 
                  maxWidth: '640px',
                  position: 'relative'
                }}>
                  {/* QuickStartBar for empty state */}
                  {isQuickStartBarVisible && (
                    <div
                      ref={quickStartBarWrapperRef}
                      style={{
                        position: 'absolute',
                        bottom: 'calc(100% + 12px)',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 10000,
                        width: 'fit-content',
                        maxWidth: '680px',
                        display: 'flex',
                        justifyContent: 'center',
                        pointerEvents: 'auto',
                        visibility: 'visible'
                      }}
                    >
                      <QuickStartBar
                        onDocumentLinked={(propertyId, documentId) => {
                          console.log('Document linked:', { propertyId, documentId });
                          if (onQuickStartToggle) {
                            onQuickStartToggle();
                          }
                        }}
                        onPopupVisibilityChange={() => {}}
                        isInChatPanel={true}
                        chatInputRef={inputRef}
                      />
                    </div>
                  )}
                  
                  <form 
                    ref={chatFormRef}
                    onSubmit={handleSubmit} 
                    className="relative"
                    data-side-chat-panel="true"
                    onClick={(e) => e.stopPropagation()}
                    style={{ 
                      overflow: 'visible', 
                      height: 'auto', 
                      width: '100%',
                      pointerEvents: 'auto'
                    }}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    {/* Expanded chat bar for empty state */}
                    <div 
                      className={`relative flex flex-col ${isSubmitted ? 'opacity-75' : ''}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        background: isDragOver ? '#F0F9FF' : 'rgba(255, 255, 255, 0.72)',
                        backdropFilter: isDragOver ? 'none' : 'blur(16px) saturate(160%)',
                        WebkitBackdropFilter: isDragOver ? 'none' : 'blur(16px) saturate(160%)',
                        border: isDragOver ? '2px dashed rgb(36, 41, 50)' : '1px solid #E0E0E0',
                        boxShadow: isDragOver ? '0 4px 12px 0 rgba(59, 130, 246, 0.15), 0 2px 4px 0 rgba(59, 130, 246, 0.10)' : '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)',
                        position: 'relative',
                        paddingTop: '12px',
                        paddingBottom: '12px',
                        paddingRight: '12px',
                        paddingLeft: '12px',
                        overflow: 'hidden',
                        width: '100%',
                        height: 'auto',
                        minHeight: '160px', // Taller for empty state
                        boxSizing: 'border-box',
                        borderRadius: '8px',
                        transition: 'background-color 0.2s ease-in-out, border-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
                      }}
                    >
                      {/* File Attachments Display */}
                      <AnimatePresence mode="wait">
                        {attachedFiles.length > 0 && (
                          <motion.div 
                            key="file-attachments-empty"
                            initial={false}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.1, ease: "easeOut" }}
                            style={{ height: 'auto', marginBottom: '12px' }}
                            className="flex flex-wrap gap-2 justify-start"
                            layout={false}
                          >
                            {attachedFiles.map((file, attachmentIdx) => (
                              <FileAttachment
                                key={generateAnimatePresenceKey(
                                  'FileAttachment',
                                  attachmentIdx,
                                  file.id || file.name,
                                  'file'
                                )}
                                attachment={file}
                                onRemove={handleRemoveFile}
                                onPreview={(file) => {
                                  addPreviewFile(file);
                                }}
                                onDragStart={(fileId) => {
                                  setIsDraggingFile(true);
                                  setDraggedFileId(fileId);
                                }}
                                onDragEnd={() => {
                                  setIsDraggingFile(false);
                                  setDraggedFileId(null);
                                  setIsOverBin(false);
                                }}
                              />
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                      
                      {/* SegmentInput + @ context - chips only inline (no row above, matches SearchBar) */}
                      <div
                        ref={atMentionAnchorRef}
                        className="flex items-start w-full"
                        style={{ minHeight: '100px', height: 'auto', width: '100%', marginBottom: '16px', flexShrink: 0 }}
                      >
                        <div
                          className="flex-1 relative flex items-start w-full"
                          style={{ overflow: 'visible', minHeight: '100px', width: '100%', minWidth: '0' }}
                          onFocus={() => setIsFocused(true)}
                          onBlur={() => setIsFocused(false)}
                          onClick={(e) => e.stopPropagation()}
                        >
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
                              if (newAgentRequestedRef.current) newAgentRequestedRef.current = false;
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
                            placeholder="Ask anything..."
                            disabled={isSubmitted}
                            style={{
                              width: '100%',
                              minHeight: '100px',
                              maxHeight: '120px',
                              lineHeight: '22px',
                              paddingTop: '0px',
                              paddingBottom: '4px',
                              paddingRight: '12px',
                              paddingLeft: '6px',
                              color: segmentInput.getPlainText() ? '#333333' : undefined,
                              boxSizing: 'border-box',
                            }}
                            onKeyDown={(e) => {
                              if (atMentionOpen && e.key === 'Enter') return;
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
                          placement="above"
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
                      
                      {/* Mode buttons row - for empty state */}
                      {/* Responsive layout - uses buttonCollapseLevel for overflow-based progressive collapse */}
                      {(() => {
                        const isVeryNarrowEmpty = buttonCollapseLevel >= 3 || actualPanelWidth < 320;
                        // Use buttonCollapseLevel for responsive button sizing
                        // Level 0: all labels shown
                        // Level 1: Map, Attach, Voice show icons only
                        // Level 2: All buttons icon-only including Model
                        // Level 3: Hide Voice button, very narrow layout
                        const showMapIconOnly = buttonCollapseLevel >= 1;
                        const showAttachIconOnly = buttonCollapseLevel >= 1;
                        const showModelIconOnly = buttonCollapseLevel >= 2;
                        const showVoiceIconOnly = buttonCollapseLevel >= 1;
                        const hideVoice = buttonCollapseLevel >= 3;
                        return (
                          <div
                            ref={emptyButtonRowRef}
                            className={`relative flex w-full ${isVeryNarrowEmpty ? 'flex-col gap-2' : 'items-center justify-between'}`}
                            style={{
                              width: '100%',
                              minWidth: '0',
                              minHeight: isVeryNarrowEmpty ? 'auto' : '24px',
                              overflow: 'hidden' // Prevent visual overflow while measuring
                            }}
                          >
                            {/* Left side: Mode Selector + Model Selector */}
                            <div className="flex items-center gap-1" style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>
                              <ModeSelector compact={isVeryNarrowEmpty || buttonCollapseLevel >= 2} />
                              {/* Hide model selector when very narrow */}
                              {!isVeryNarrowEmpty && <ModelSelector compact={showModelIconOnly} />}
                            </div>

                            {/* Right side: Web Search, Map, Link, Attach, Voice, Send */}
                            <div className={`flex items-center gap-1.5 ${isVeryNarrowEmpty ? 'flex-wrap justify-end' : ''}`} style={{ flexShrink: 0 }}>
                              <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                onChange={handleFileSelect}
                                className="hidden"
                                accept="image/*,.pdf,.doc,.docx"
                              />
                              
                              {/* Web Search Toggle - hide at high collapse levels */}
                              {buttonCollapseLevel < 3 && (
                                isWebSearchEnabled ? (
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
                                      height: '26px',
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
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                      <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                      <path d="M2 12h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  </button>
                                )
                              )}
                              
                              {/* Map button - first to collapse to icon */}
                              {onMapToggle && (
                                <button
                                  type="button"
                                  onClick={onMapToggle}
                                  className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-gray-900 focus:outline-none outline-none"
                                  style={{
                                    backgroundColor: '#FFFFFF',
                                    border: '1px solid rgba(229, 231, 235, 0.6)',
                                    transition: 'background-color 0.15s ease',
                                    height: '22px',
                                    minHeight: '22px',
                                    fontSize: '12px',
                                    padding: showMapIconOnly ? '4px 8px' : undefined
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = '#F5F5F5';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = '#FFFFFF';
                                  }}
                                  title="Go to map"
                                >
                                  <Map className="w-3.5 h-3.5" strokeWidth={1.5} />
                                  {!showMapIconOnly && <span className="text-xs font-medium">Map</span>}
                                </button>
                              )}
                              
                              {/* Attach button - second to collapse to icon */}
                              <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="flex items-center gap-1.5 px-2 py-1 text-gray-900 focus:outline-none outline-none"
                                style={{
                                  backgroundColor: '#FFFFFF',
                                  border: '1px solid rgba(229, 231, 235, 0.6)',
                                  borderRadius: '12px',
                                  transition: 'background-color 0.15s ease',
                                  height: '26px',
                                  minHeight: '26px',
                                  paddingLeft: showAttachIconOnly ? '6px' : '8px',
                                  paddingRight: showAttachIconOnly ? '6px' : '8px'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = '#F5F5F5';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = '#FFFFFF';
                                }}
                                title="Attach file"
                              >
                                <Paperclip className="w-3.5 h-3.5" strokeWidth={1.5} />
                                {!showAttachIconOnly && <span className="text-xs font-medium">Attach</span>}
                              </button>
                              
                              {/* Voice button - third to collapse to icon, then hide at high collapse level */}
                              {!hideVoice && (
                                <button
                                  type="button"
                                  className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-gray-900 focus:outline-none outline-none"
                                  style={{
                                    backgroundColor: '#ECECEC',
                                    transition: 'background-color 0.15s ease',
                                    height: '22px',
                                    minHeight: '22px',
                                    fontSize: '12px',
                                    padding: showVoiceIconOnly ? '4px 8px' : undefined
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
                                  {!showVoiceIconOnly && <span className="text-xs font-medium">Voice</span>}
                                </button>
                              )}
                              
                              {/* Send button */}
                          <AnimatePresence mode="wait">
                            {(inputValue.trim() || attachedFiles.length > 0 || propertyAttachments.length > 0) && (
                              <motion.button 
                                key="send-button-empty"
                                type="submit" 
                                onClick={handleSubmit} 
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1, backgroundColor: '#4A4A4A' }}
                                exit={{ opacity: 0, scale: 0.8 }}
                                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
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
                                whileHover={!isSubmitted ? { scale: 1.05 } : {}}
                                whileTap={!isSubmitted ? { scale: 0.95 } : {}}
                              >
                                <motion.div
                                  key="arrow-up-empty"
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
                        );
                      })()}
                    </div>
                  </form>
                </div>
              </div>
            ) : (
              /* Normal chat state - Messages + bottom input */
              <div
                key="messages-layout-inner"
                className="flex-1 flex flex-col"
                style={{ position: 'relative', minWidth: 0, width: '100%', minHeight: 0, overflow: 'visible' }}
              >
                {/* Content area wrapper - position:relative so blur overlay covers only messages, not chat bar */}
                <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <div 
                  ref={contentAreaRef}
                  onClick={(e) => e.stopPropagation()} // Prevent clicks from closing agent sidebar
                  className="flex-1 overflow-y-auto sidechat-scroll" 
                  style={{ 
                    backgroundColor: '#FCFCF9',
                    padding: '16px 0', // Simplified padding - content will be centered
                    // Inset the scroll container slightly so the scrollbar isn't flush against the panel edge
                    marginRight: '6px',
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(0, 0, 0, 0.02) transparent',
                    minWidth: 0, // Allow shrinking at narrow widths - content wrapper handles responsive layout
                    flexShrink: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center', // Center content wrapper horizontally
                    position: 'relative', // For BotStatusOverlay positioning
                    overflowX: 'hidden' // Prevent horizontal overflow leaks
                  }}
                >
                  {/* Centered content wrapper - ChatGPT-like centered layout */}
                  <div style={{ 
                    width: '100%', 
                    maxWidth: '680px', // Match chat bar max width (640px inner + 40px padding = 680px)
                    paddingLeft: actualPanelWidth < 320 ? '12px' : '32px',
                    paddingRight: actualPanelWidth < 320 ? '12px' : '32px',
                    margin: '0 auto' // Center the content wrapper
                  }}>
                  <div className="flex flex-col" style={{ minHeight: '100%', gap: '16px', width: '100%' }}>
                    <AnimatePresence>
                      {renderedMessages}
                    </AnimatePresence>
                    
                    {/* Plan Generation Reasoning Steps - show only the latest step during streaming */}
                    {planGenerationReasoningSteps.length > 0 && planBuildStatus === 'streaming' && !showPlanViewer && (
                      <div style={{ marginTop: '16px', marginBottom: '8px' }}>
                        <PlanReasoningSteps 
                          steps={[planGenerationReasoningSteps[planGenerationReasoningSteps.length - 1]]}
                          isAnimating={true}
                        />
                      </div>
                    )}
                    
                    {/* Plan Viewer - show when in Plan mode and plan is ready */}
                    {showPlanViewer && (
                      <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                        <PlanViewer
                          planContent={planContent}
                          isStreaming={planBuildStatus === 'streaming'}
                          onBuild={async () => {
                            if (planId && planQueryText) {
                              setPlanBuildStatus('building');
                              
                              // Hide plan viewer and switch to chat view with streaming response
                              setShowPlanViewer(false);
                              
                              // Query message already added when entering plan mode - no need to add again
                              
                              // Create response message that will be updated with streaming content
                              const responseMessageId = `response-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                              let accumulatedResponse = '';
                              const reasoningStepsForBuild: ReasoningStep[] = [];
                              
                              // Add initial response message
                              const responseMessage: ChatMessage = {
                                id: responseMessageId,
                                type: 'response',
                                text: '',
                                isLoading: true,
                                reasoningSteps: []
                              };
                              setChatMessages(prev => [...prev, responseMessage]);
                              
                              try {
                                await backendApi.buildPlan(
                                  planId,
                                  sessionId,
                                  planQueryText,
                                  // onToken - update streaming response
                                  (token: string) => {
                                    accumulatedResponse += token;
                                    setChatMessages(prev => prev.map(msg => 
                                      msg.id === responseMessageId 
                                        ? { ...msg, text: accumulatedResponse }
                                        : msg
                                    ));
                                  },
                                  // onComplete - finalize the response
                                  (data: any) => {
                                    console.log('📋 [PLAN_BUILD] Complete:', data);
                                    // Mark all reasoning steps as complete (safety net)
                                    const completedSteps = reasoningStepsForBuild.map(step => ({
                                      ...step,
                                      details: {
                                        ...step.details,
                                        status: step.details?.status === 'running' ? 'complete' : step.details?.status
                                      }
                                    }));
                                    
                                    // Convert citations array from backend to Record format for frontend
                                    let citationsRecord: Record<string, any> = {};
                                    if (data?.citations && Array.isArray(data.citations)) {
                                      data.citations.forEach((citation: any) => {
                                        const citationNum = String(citation.citation_number);
                                        citationsRecord[citationNum] = {
                                          doc_id: citation.doc_id,
                                          page: citation.page_number || 1,
                                          page_number: citation.page_number || 1,
                                          bbox: citation.bbox || {},
                                          block_id: citation.block_id
                                        };
                                      });
                                      console.log('📋 [PLAN_BUILD] Converted citations:', citationsRecord);
                                    }
                                    
                                    setChatMessages(prev => prev.map(msg => 
                                      msg.id === responseMessageId 
                                        ? { 
                                            ...msg, 
                                            text: data?.summary || accumulatedResponse,
                                            isLoading: false,
                                            reasoningSteps: completedSteps,
                                            citations: Object.keys(citationsRecord).length > 0 ? citationsRecord : undefined
                                          }
                                        : msg
                                    ));
                                    setPlanBuildStatus('built');
                                    setPlanContent('');
                                    setPlanId(null);
                                    setPlanQueryText('');
                                  },
                                  // onError
                                  (error: string) => {
                                    console.error('📋 [PLAN_BUILD] Error:', error);
                                    setChatMessages(prev => prev.map(msg => 
                                      msg.id === responseMessageId 
                                        ? { ...msg, text: `Error: ${error}`, isLoading: false }
                                        : msg
                                    ));
                                    setPlanBuildStatus('error');
                                  },
                                  // onReasoningStep - update existing steps instead of adding duplicates
                                  (step) => {
                                    console.log('📋 [PLAN_BUILD] Reasoning step:', step);
                                    const typedStep = step as ReasoningStep;
                                    const toolName = typedStep.details?.tool_name;
                                    const status = typedStep.details?.status;
                                    
                                    // If this is a "complete" status for an existing "running" step, update it instead of adding
                                    if (toolName && status === 'complete') {
                                      const existingIndex = reasoningStepsForBuild.findIndex(
                                        s => s.details?.tool_name === toolName && s.details?.status === 'running'
                                      );
                                      if (existingIndex !== -1) {
                                        // Update the existing step with complete status
                                        reasoningStepsForBuild[existingIndex] = typedStep;
                                      } else {
                                        // No running step found, add as new
                                        reasoningStepsForBuild.push(typedStep);
                                      }
                                    } else {
                                      // Running step or other - add to array
                                      reasoningStepsForBuild.push(typedStep);
                                    }
                                    
                                    setChatMessages(prev => prev.map(msg => 
                                      msg.id === responseMessageId 
                                        ? { ...msg, reasoningSteps: [...reasoningStepsForBuild] }
                                        : msg
                                    ));
                                  }
                                );
                              } catch (error) {
                                console.error('Failed to build plan:', error);
                                setPlanBuildStatus('error');
                                setChatMessages(prev => prev.map(msg => 
                                  msg.id === responseMessageId 
                                    ? { ...msg, text: `Error: ${error}`, isLoading: false }
                                    : msg
                                ));
                              }
                            }
                          }}
                          onCancel={() => {
                            setShowPlanViewer(false);
                            setPlanContent('');
                            setPlanId(null);
                            setPlanBuildStatus('ready');
                          }}
                          buildStatus={planBuildStatus}
                          planName={planQueryText ? `research_${planQueryText.slice(0, 20).replace(/\s+/g, '_')}` : 'research_plan'}
                          onViewPlan={() => setIsPlanPanelExpanded(prev => !prev)}
                          isPlanExpanded={isPlanPanelExpanded}
                        />
                        
                        {/* Follow-up query - displayed below plan viewer when updating, using same style as query messages */}
                        {isUpdatingPlan && adjustmentQuery && (
                          <div style={{
                            alignSelf: 'flex-end', 
                            maxWidth: '85%', 
                            width: 'fit-content',
                            marginTop: '16px', 
                            marginLeft: 'auto', 
                            marginRight: '0',
                          }}>
                            <div style={{ 
                              backgroundColor: '#FFFFFF', 
                              borderRadius: '8px', 
                              padding: '4px 10px', 
                              border: '1px solid #e5e7eb', 
                              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                            }}>
                              <div style={{
                                color: '#0D0D0D',
                                fontSize: '14px',
                                lineHeight: '20px',
                              }}>
                                {adjustmentQuery}
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Reasoning steps - OUTSIDE plan card, matching ReasoningSteps style */}
                        {isUpdatingPlan && planReasoningSteps.length > 0 && (
                          <PlanReasoningSteps 
                            steps={planReasoningSteps} 
                            isAnimating={planBuildStatus === 'streaming'}
                          />
                        )}
                        
                        {/* Adjustments container - single collapsible block with all changes */}
                        {isUpdatingPlan && displayedAdjustments.length > 0 && visibleAdjustmentCount > 0 && (
                          <div 
                            style={{ 
                              marginTop: '8px',
                              border: '1px solid #E5E7EB',
                              borderRadius: '8px',
                              overflow: 'hidden',
                              background: 'transparent',
                            }}
                          >
                            {/* Header - summary of all changes */}
                            <div
                              onClick={() => setIsAdjustmentsExpanded(!isAdjustmentsExpanded)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '8px 12px',
                                background: 'transparent',
                                borderBottom: isAdjustmentsExpanded ? '1px solid #E5E7EB' : 'none',
                                fontSize: '12px',
                                color: '#374151',
                                cursor: 'pointer',
                              }}
                            >
                              <FileText style={{ 
                                width: '14px', 
                                height: '14px', 
                                color: '#9CA3AF',
                                flexShrink: 0,
                              }} />
                              <span style={{ 
                                flex: 1,
                                fontWeight: 500, 
                              }}>
                                {displayedAdjustments.length} {displayedAdjustments.length === 1 ? 'Change' : 'Changes'}
                              </span>
                              <span style={{ 
                                fontSize: '11px',
                                color: '#22C55E',
                                fontFamily: 'ui-monospace, monospace',
                              }}>
                                +{displayedAdjustments.reduce((sum, a) => sum + a.linesAdded, 0)}
                              </span>
                              <span style={{ 
                                fontSize: '11px',
                                color: '#EF4444',
                                fontFamily: 'ui-monospace, monospace',
                              }}>
                                -{displayedAdjustments.reduce((sum, a) => sum + a.linesRemoved, 0)}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setIsAdjustmentsExpanded(!isAdjustmentsExpanded);
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: '20px',
                                  height: '20px',
                                  borderRadius: '4px',
                                  border: 'none',
                                  background: 'transparent',
                                  color: '#9CA3AF',
                                  cursor: 'pointer',
                                  padding: 0,
                                }}
                              >
                                {isAdjustmentsExpanded ? (
                                  <ChevronUp style={{ width: '14px', height: '14px' }} />
                                ) : (
                                  <ChevronDown style={{ width: '14px', height: '14px' }} />
                                )}
                              </button>
                            </div>
                            
                            {/* Expanded view - show individual adjustment blocks */}
                            {isAdjustmentsExpanded && (
                              <div style={{ padding: '8px' }}>
                                {displayedAdjustments.slice(0, visibleAdjustmentCount).map((adjustment, index) => (
                                  <div
                                    key={adjustment.id}
                                    style={{
                                      opacity: index < visibleAdjustmentCount ? 1 : 0,
                                      transform: index < visibleAdjustmentCount ? 'translateY(0)' : 'translateY(-6px)',
                                      transition: 'opacity 0.3s ease, transform 0.3s ease',
                                    }}
                                  >
                                    <AdjustmentBlock
                                      adjustment={adjustment}
                                      onScrollToChange={() => setIsPlanPanelExpanded(true)}
                                      defaultExpanded={false}
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Scroll anchor - ensures bottom of response is visible above chat bar */}
                    {/* Extra padding ensures content isn't hidden behind chat input when scrolled to bottom */}
                    <div ref={messagesEndRef} style={{ height: '120px', minHeight: '120px', flexShrink: 0 }} />
                    </div>
                  </div>
                </div>
                </div>
            
                {/* Chat Input at Bottom - Condensed SearchBar design (only for non-empty chat). When citation panel open, transparent so overlay shows; only inner chat bar sits above overlay. */}
                <div 
                  ref={chatInputContainerRef}
              onClick={(e) => e.stopPropagation()} // Prevent clicks from closing agent sidebar
              style={{ 
                backgroundColor: citationClickPanel ? 'transparent' : '#FCFCF9', 
                paddingTop: '16px', 
                paddingBottom: '48px', 
                paddingLeft: '0', // Remove left padding - centering handled by form
                paddingRight: '0', // Remove right padding - centering handled by form
                position: 'relative', 
                overflow: 'visible', // Allow BotStatusOverlay to extend above
                minWidth: '200px', // Allow narrower chat input container
                flexShrink: 0, // Prevent flex shrinking
                display: 'flex',
                justifyContent: 'center', // Center the form
                width: '100%',
                zIndex: citationClickPanel ? 10051 : 5, // Above overlay when citation panel open; container bg transparent so overlay shows, only inner chat bar is opaque
                pointerEvents: 'auto' // Ensure container can receive drag events
              }}
                >
                  {/* QuickStartBar - appears above chat bar when Workflow button is clicked */}
                  {isQuickStartBarVisible && (
                    <div
                  ref={quickStartBarWrapperRef}
                      style={{
                        position: 'absolute',
                    bottom: quickStartBarBottom, // Dynamically calculated position
                    left: '50%',
                    transform: 'translateX(-50%)', // Center the QuickStartBar
                        zIndex: 10000,
                    width: 'fit-content', // Let content determine width naturally
                    maxWidth: '680px', // Fixed maxWidth to match chat bar - QuickStartBar should align with chat bar
                    display: 'flex',
                    justifyContent: 'center',
                    pointerEvents: 'auto', // Ensure it's clickable
                    visibility: 'visible' // Ensure it's visible
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
                        isInChatPanel={true}
                        chatInputRef={inputRef}
                      />
                    </div>
                  )}
              <form 
                ref={chatFormRef}
                onSubmit={handleSubmit} 
                className="relative" 
                data-side-chat-panel="true"
                onClick={(e) => e.stopPropagation()} // Prevent clicks from closing agent sidebar
                style={{ 
                  overflow: 'visible', 
                  height: 'auto', 
                  width: '100%', 
                  display: 'flex', 
                  justifyContent: 'center', 
                  alignItems: 'center',
                  position: 'relative',
                  // Match content wrapper padding to align chatbar with text display
                  // Reduce padding when panel is narrow
                  paddingLeft: actualPanelWidth < 320 ? '12px' : '32px',
                  paddingRight: actualPanelWidth < 320 ? '12px' : '32px',
                  pointerEvents: 'auto' // Ensure form can receive drag events
                }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {/* Wrapper for chat bar + overlay - no z-index so overlay shows through; only inner chat bar is above overlay */}
                <div 
                  onClick={(e) => e.stopPropagation()} // Prevent clicks from closing agent sidebar
                  style={{ 
                    position: 'relative', 
                    width: 'min(100%, 640px)', 
                    minWidth: '200px', // Allow narrower wrapper
                    pointerEvents: 'auto', // Ensure wrapper can receive drag events
                  }}
                >
                  {/* Bot Status Overlay - sits BEHIND the chat bar */}
                  <BotStatusOverlay
                    isActive={isBotActive}
                    activityMessage={botActivityMessage}
                    isPaused={isBotPaused}
                    onPauseToggle={handlePauseToggle}
                  />
                  {/* Chat bar - ONLY element above citation overlay (z 10051); form/container stay behind overlay */}
                  <div 
                    className={`relative flex flex-col ${isSubmitted ? 'opacity-75' : ''}`}
                    onClick={(e) => e.stopPropagation()} // Prevent clicks from closing agent sidebar
                    style={{
                      background: isDragOver ? '#F0F9FF' : '#ffffff',
                      backdropFilter: isDragOver ? 'none' : 'blur(16px) saturate(160%)',
                      WebkitBackdropFilter: isDragOver ? 'none' : 'blur(16px) saturate(160%)',
                      border: isDragOver ? '2px dashed rgb(36, 41, 50)' : '1px solid #E0E0E0',
                      boxShadow: isDragOver 
                        ? '0 4px 12px 0 rgba(59, 130, 246, 0.15), 0 2px 4px 0 rgba(59, 130, 246, 0.10)' 
                        : '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)',
                      position: 'relative',
                      paddingTop: '12px',
                      paddingBottom: '12px',
                      paddingRight: '12px',
                      paddingLeft: '12px',
                      overflow: 'hidden',
                      width: '100%',
                      height: 'auto',
                      minHeight: '48px',
                      boxSizing: 'border-box',
                      borderRadius: '8px',
                      transition: 'background-color 0.2s ease-in-out, border-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
                      zIndex: citationClickPanel ? 10051 : 2, // Above citation overlay (10050) when open; above bot overlay otherwise
                    }}
                  >
                  {/* Input row - match SearchBar: gap for spacing to icons */}
                  <div 
                    className="relative flex flex-col w-full" 
                    style={{ 
                      height: 'auto', 
                      minHeight: '24px',
                      width: '100%',
                      minWidth: '0',
                      gap: '12px'
                    }}
                  >
                    {/* File Attachments Display - Above textarea */}
                    <AnimatePresence mode="wait">
                      {attachedFiles.length > 0 && (
                        <motion.div 
                          key="file-attachments"
                          initial={false}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ 
                            duration: 0.1,
                            ease: "easeOut"
                          }}
                          style={{ height: 'auto', marginBottom: '12px' }}
                          className="flex flex-wrap gap-2 justify-start"
                          layout={false}
                        >
                          {attachedFiles.map((file, attachmentIdx) => (
                            <FileAttachment
                              key={generateAnimatePresenceKey(
                                'FileAttachment',
                                attachmentIdx,
                                file.id || file.name,
                                'file'
                              )}
                              attachment={file}
                              onRemove={handleRemoveFile}
                              onPreview={(file) => {
                                // Use shared preview context to add file
                                addPreviewFile(file);
                              }}
                              onDragStart={(fileId) => {
                                setIsDraggingFile(true);
                                setDraggedFileId(fileId);
                              }}
                              onDragEnd={() => {
                                setIsDraggingFile(false);
                                setDraggedFileId(null);
                                setIsOverBin(false);
                              }}
                            />
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                    
                    {/* SegmentInput + @ context - chips only inline (no row above, matches SearchBar) */}
                    <div
                      className="flex items-start w-full"
                      style={{ minHeight: '24px', height: 'auto', width: '100%', marginTop: '0px', marginBottom: '0px', flexShrink: 0 }}
                    >
                      <div
                        ref={atMentionAnchorRef}
                        className="flex-1 relative flex items-start w-full"
                        style={{ overflow: 'visible', minHeight: '28px', width: '100%', minWidth: '0', alignSelf: 'flex-start' }}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => setIsFocused(false)}
                        onClick={(e) => e.stopPropagation()}
                      >
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
                            if (newAgentRequestedRef.current) newAgentRequestedRef.current = false;
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
                          placeholder="Ask anything..."
                          disabled={isSubmitted}
                          style={{
                            width: '100%',
                            minHeight: '28px',
                            maxHeight: '220px',
                            lineHeight: '20px',
                            paddingTop: '0px',
                            paddingBottom: '4px',
                            paddingRight: '12px',
                            paddingLeft: '6px',
                            color: segmentInput.getPlainText() ? '#333333' : undefined,
                            boxSizing: 'border-box',
                          }}
                          onKeyDown={(e) => {
                            if (atMentionOpen && e.key === 'Enter') return;
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
                        
                        {/* Property Search Results Popup - positioned ABOVE the input */}
                        {showPropertySearchPopup && propertySearchResults.length > 0 && (
                          <div
                            ref={propertySearchPopupRef}
                            style={{
                              position: 'absolute',
                              bottom: 'calc(100% + 8px)',
                              left: 0,
                              right: 0,
                              background: '#FFFFFF',
                              borderRadius: '12px',
                              border: '1px solid rgba(229, 231, 235, 0.6)',
                              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)',
                              maxHeight: '280px',
                              overflowY: 'auto',
                              zIndex: 10000,
                              width: '100%'
                            }}
                          >
                            {propertySearchResults.map((property, index) => {
                              const primaryId = property.id;
                              const primaryKey = typeof primaryId === 'number' ? primaryId.toString() : primaryId;
                              return (
                              <div
                                key={
                                  primaryKey && primaryKey.length > 0
                                    ? `search-result-${primaryKey}`
                                    : property.address && property.address.length > 0
                                      ? `search-result-${property.address}-${index}`
                                      : `search-result-${index}`
                                }
                                onClick={() => handlePropertySelect(property)}
                                style={{
                                  padding: '8px 12px',
                                  cursor: 'pointer',
                                  borderBottom: index < propertySearchResults.length - 1 ? '1px solid rgba(229, 231, 235, 0.3)' : 'none',
                                  backgroundColor: 'transparent',
                                  transition: 'background-color 0.15s ease',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '10px'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = '#F9FAFB';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = 'transparent';
                                }}
                              >
                                {/* Property Image Thumbnail */}
                                <PropertyImageThumbnail property={property} />
                                
                                {/* Property Info */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ 
                                    fontWeight: 500, 
                                    fontSize: '14px', 
                                    color: '#111827', 
                                    marginBottom: '3px',
                                    lineHeight: '1.4',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                  }}>
                                    {property.address}
                                  </div>
                                  {property.property_type && (
                                    <div style={{ 
                                      fontSize: '12px', 
                                      color: '#9CA3AF',
                                      lineHeight: '1.4',
                                      fontWeight: 400
                                    }}>
                                      {property.property_type}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                            })}
                          </div>
                        )}
                        <AtMentionPopover
                          open={atMentionOpen}
                          anchorRef={atMentionAnchorRef}
                          anchorRect={atAnchorRect}
                          query={atQuery}
                          placement="above"
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
                    
                    {/* Bottom row: Icons (Left) and Send Button (Right) */}
                    {/* Progressive collapse with priority: Map > Attach > Voice */}
                    {/* Uses buttonCollapseLevel for overflow-based responsive sizing */}
                    {(() => {
                      const isVeryNarrow = buttonCollapseLevel >= 3;
                      // Use buttonCollapseLevel for responsive button sizing
                      // Level 0: all labels shown
                      // Level 1: Map, Attach, Voice show icons only
                      // Level 2: All buttons icon-only including Model
                      // Level 3: Hide Voice button, very narrow layout
                      const showMapIconOnly = buttonCollapseLevel >= 1;
                      const showAttachIconOnly = buttonCollapseLevel >= 1;
                      const showModelIconOnly = buttonCollapseLevel >= 2;
                      const showVoiceIconOnly = buttonCollapseLevel >= 1;
                      const hideVoice = buttonCollapseLevel >= 3;
                      
                      return (
                        <div
                          ref={buttonRowRef}
                          className={`relative flex w-full ${isVeryNarrow ? 'flex-col gap-2' : 'items-center justify-between'}`}
                          style={{
                            width: '100%',
                            minWidth: '0',
                            minHeight: isVeryNarrow ? 'auto' : '32px',
                            overflow: 'hidden' // Prevent visual overflow while measuring
                          }}
                        >
                          {/* Left Icons: Mode Selector and Model Selector */}
                          <div className={`flex items-center gap-1 ${isVeryNarrow ? 'justify-start' : ''}`} style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>
                            {/* Mode Selector Dropdown */}
                            {/* - Fullscreen: normal size text (no props)
                                - Expanded split (wider): small text (small={true})
                                - Smallest width (collapsed or close): icon only (compact={true}) */}
                            {(() => {
                              // Calculate current width for mode selector logic
                              const currentWidth = draggedWidth !== null 
                                ? draggedWidth 
                                : (isFullscreenMode 
                                  ? window.innerWidth 
                                  : window.innerWidth * (CHAT_PANEL_WIDTH.EXPANDED_VW / 100)); // Default expanded width
                              
                              // Show icon only when at minimum width (collapsed) or very close to it, or when very narrow
                              const isAtMinWidth = currentWidth <= 425 || isVeryNarrow || buttonCollapseLevel >= 2; // Small buffer above collapsed min
                              const isCompact = !isFullscreenMode && isAtMinWidth;
                              const isSmall = !isFullscreenMode && !isAtMinWidth;
                              // Make Agent mode button larger on opening render for map (when query is empty and no messages)
                              const isOpeningRender = (!query || query.trim() === '') && chatMessages.length === 0 && isMapVisible;
                              
                              return (
                                <>
                                  <ModeSelector 
                                    compact={isCompact}
                                    small={isSmall}
                                    large={isOpeningRender}
                                  />
                                  {/* Hide model selector when very narrow to save space */}
                                  {!isVeryNarrow && <ModelSelector compact={showModelIconOnly} />}
                                </>
                              );
                            })()}
                          </div>

                          {/* Right Icons: Web Search, Map, Link, Attach, Voice, Send */}
                          {/* NOTE: Removed layout prop to prevent button movement glitch when panel resizes (e.g., clicking citations) */}
                      <div 
                        className={`flex items-center gap-1.5 flex-shrink-0 ${isVeryNarrow ? 'flex-wrap justify-end' : ''}`}
                        style={{ marginRight: '4px' }}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          onChange={handleFileSelect}
                          className="hidden"
                          accept="image/*,.pdf,.doc,.docx"
                        />
                        
                        {/* Web Search Toggle - hide at high collapse levels */}
                        {buttonCollapseLevel < 3 && (
                          isWebSearchEnabled ? (
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
                                height: '26px',
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
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M2 12h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          )
                        )}
                        
                        {/* Map button - first to collapse to icon */}
                        {onMapToggle && (
                          <button
                            type="button"
                            onClick={() => {
                              // Save document preview state before closing if needed
                              if (currentChatId && expandedCardViewDoc) {
                                const bufferedState = getBufferedState(currentChatId);
                                bufferedState.documentPreview = {
                                  docId: expandedCardViewDoc.docId,
                                  filename: expandedCardViewDoc.filename,
                                  highlight: expandedCardViewDoc.highlight ? {
                                    fileId: expandedCardViewDoc.highlight.fileId,
                                    bbox: expandedCardViewDoc.highlight.bbox,
                                    doc_id: expandedCardViewDoc.highlight.doc_id,
                                    block_id: expandedCardViewDoc.highlight.block_id || '',
                                    block_content: expandedCardViewDoc.highlight.block_content,
                                    original_filename: expandedCardViewDoc.highlight.original_filename
                                  } : undefined
                                };
                              }
                              
                              if (onMinimize && chatMessages.length > 0) {
                                if (expandedCardViewDoc) closeExpandedCardView();
                                onMinimize(chatMessages);
                              } else {
                                if (expandedCardViewDoc) closeExpandedCardView();
                                onMapToggle();
                              }
                            }}
                            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-gray-900 focus:outline-none outline-none"
                            style={{
                              backgroundColor: '#FFFFFF',
                              border: '1px solid rgba(229, 231, 235, 0.6)',
                              transition: 'background-color 0.15s ease',
                              height: '22px',
                              minHeight: '22px',
                              fontSize: '12px',
                              padding: showMapIconOnly ? '4px 8px' : undefined
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = '#F5F5F5';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = '#FFFFFF';
                            }}
                            title="Go to map"
                          >
                            <Map className="w-3.5 h-3.5" strokeWidth={1.5} />
                            {!showMapIconOnly && <span className="text-xs font-medium">Map</span>}
                          </button>
                        )}
                        
                        {/* Document Selection Button - Only show when property details panel is open */}
                        {isPropertyDetailsOpen && (
                          <div className="relative flex items-center">
                            <button
                              type="button"
                              onClick={handleOpenDocumentSelection}
                              className={`p-1 transition-colors relative ${
                                selectedDocumentIds.size > 0
                                  ? 'text-green-500 hover:text-green-600 bg-green-50 rounded'
                                  : isDocumentSelectionMode
                                    ? 'text-blue-600 hover:text-blue-700 bg-blue-50 rounded'
                                    : 'text-gray-900 hover:text-gray-700'
                              }`}
                              style={{
                                border: selectedDocumentIds.size > 0
                                  ? '1px solid rgba(16, 185, 129, 0.4)'
                                  : isDocumentSelectionMode
                                    ? '1px solid rgba(37, 99, 235, 0.4)'
                                    : '1px solid rgba(156, 163, 175, 0.6)'
                              }}
                              title={
                                selectedDocumentIds.size > 0
                                  ? `${selectedDocumentIds.size} document${selectedDocumentIds.size > 1 ? 's' : ''} selected - Queries will search only these documents. Click to ${isDocumentSelectionMode ? 'exit' : 'enter'} selection mode.`
                                  : isDocumentSelectionMode
                                    ? "Document selection mode active - Click document cards to select"
                                    : "Select documents to search within"
                              }
                            >
                              {selectedDocumentIds.size > 0 ? (
                                <Scan className="w-3.5 h-3.5" strokeWidth={1.5} />
                              ) : isDocumentSelectionMode ? (
                                <Scan className="w-3.5 h-3.5" strokeWidth={1.5} />
                              ) : (
                                <SquareDashedMousePointer className="w-3.5 h-3.5" strokeWidth={1.5} />
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
                          )}
                        {/* Link and Attach buttons - use progressive collapse thresholds from outer scope */}
                        <div className="flex items-center gap-1">
                          {/* Link button - commented out for now
                          {onQuickStartToggle && (
                            <button
                              type="button"
                              onClick={onQuickStartToggle}
                              className="flex items-center gap-1.5 px-2 py-1 rounded-full text-gray-900 focus:outline-none outline-none"
                              style={{
                                backgroundColor: isQuickStartBarVisible ? '#ECFDF5' : '#FCFCF9',
                                border: isQuickStartBarVisible ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(229, 231, 235, 0.6)',
                                transition: 'background-color 0.15s ease, border-color 0.15s ease',
                                willChange: 'background-color, border-color',
                                padding: showAttachIconOnly ? '4px 6px' : '4px 8px',
                                height: '26px',
                                minHeight: '24px'
                              }}
                              onMouseEnter={(e) => {
                                if (!isQuickStartBarVisible) {
                                  e.currentTarget.style.backgroundColor = '#F5F5F5';
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (!isQuickStartBarVisible) {
                                  e.currentTarget.style.backgroundColor = '#FCFCF9';
                                }
                              }}
                              title="Link document to property"
                            >
                              <Workflow className={`w-3.5 h-3.5 ${isQuickStartBarVisible ? 'text-green-500' : ''}`} strokeWidth={1.5} />
                              {!showAttachIconOnly && (
                              <span className="text-xs font-medium">Link</span>
                              )}
                            </button>
                          )}
                          */}
                          {/* Attach button - second to collapse to icon */}
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-1.5 px-2 py-1 rounded-full text-gray-900 focus:outline-none outline-none"
                            style={{
                              backgroundColor: '#FCFCF9',
                              border: '1px solid rgba(229, 231, 235, 0.6)',
                              transition: 'background-color 0.15s ease, border-color 0.15s ease',
                              willChange: 'background-color, border-color',
                              padding: showAttachIconOnly ? '4px 6px' : '4px 8px',
                              height: '26px',
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
                            {!showAttachIconOnly && <span className="text-xs font-medium">Attach</span>}
                          </button>
                        </div>
                        {/* Voice button - third to collapse to icon, then hide */}
                        {!hideVoice && (
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
                              padding: showVoiceIconOnly ? '4px 8px' : undefined
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
                            {!showVoiceIconOnly && <span className="text-xs font-medium">Voice</span>}
                          </button>
                        )}
                        
                        {/* Send button or Stop button (when streaming) */}
                        <AnimatePresence mode="wait">
                          {(() => {
                            const isStreaming = chatMessages.some(msg => msg.isLoading);
                            const hasContent = inputValue.trim() || attachedFiles.length > 0 || propertyAttachments.length > 0;
                            
                            if (isStreaming) {
                              // Show stop button when streaming - same size as send button to prevent layout shifts
                              return (
                                <motion.button 
                                  key="stop-button"
                                  type="button" 
                                  onClick={handleStopQuery} 
                                  initial={{ opacity: 1, scale: 1, backgroundColor: '#6E6E6E' }}
                                  animate={{ opacity: 1, scale: 1, backgroundColor: '#6E6E6E' }}
                                  exit={{ opacity: 0 }}
                                  transition={{ duration: 0 }}
                                  layout={false}
                                  className="flex items-center justify-center relative focus:outline-none outline-none"
                                  style={{
                                    width: '22px',
                                    height: '22px',
                                    minWidth: '22px',
                                    minHeight: '22px',
                                    maxWidth: '22px',
                                    maxHeight: '22px',
                                    borderRadius: '50%',
                                    border: 'none',
                                    backgroundColor: '#6E6E6E',
                                    flexShrink: 0,
                                    alignSelf: 'center'
                                  }}
                                  whileTap={{
                                    scale: 0.95
                                  }}
                                  title="Stop generating"
                                >
                                  <svg 
                                    className="w-2.5 h-2.5" 
                                    viewBox="0 0 10 10" 
                                    fill="none" 
                                    xmlns="http://www.w3.org/2000/svg"
                                  >
                                    <rect 
                                      x="1" 
                                      y="1" 
                                      width="8" 
                                      height="8" 
                                      rx="1.5" 
                                      fill="#FFFFFF"
                                    />
                                  </svg>
                                </motion.button>
                              );
                            }
                            
                            // Show normal send button when not streaming and has content
                            if (hasContent) {
                              return (
                                <motion.button 
                                  key="send-button"
                                  type="submit" 
                                  onClick={handleSubmit} 
                                  initial={{ opacity: 1, scale: 1, backgroundColor: '#4A4A4A' }}
                                  animate={{ opacity: 1, scale: 1, backgroundColor: '#4A4A4A' }}
                                  exit={{ opacity: 0 }}
                                  transition={{ duration: 0 }}
                                  layout={false}
                                  className={`flex items-center justify-center relative focus:outline-none outline-none ${!isSubmitted ? '' : 'cursor-not-allowed'}`}
                                  style={{
                                    width: '22px',
                                    height: '22px',
                                    minWidth: '22px',
                                    minHeight: '22px',
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
                              );
                            }
                            
                            return null;
                          })()}
                        </AnimatePresence>
                      </div>
                    </div>
                      );
                    })()}
                  </div>
                  </div>
                </div>
              </form>
                </div>
              </div>
            )}
            </motion.div>
            </AnimatePresence>
          </div>
          </div>
        </motion.div>
      )}
      
      {/* Vertical Divider - Between chat panel and property details panel */}
      {isVisible && isPropertyDetailsOpen && (
        <div
          style={{
            position: 'fixed',
            left: `${sidebarWidth + actualPanelWidth}px`,
            top: '0',
            bottom: '0',
            width: '1px',
            height: '100vh',
            backgroundColor: '#E5E7EB',
            zIndex: 40,
            pointerEvents: 'none' // Don't interfere with interactions
          }}
        />
      )}
      
      {/* Delete Bin Icon - Bottom Right Corner */}
      <AnimatePresence key="delete-bin-presence">
        {isDraggingFile && (
          <motion.div
            key="delete-bin"
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ 
              opacity: 1, 
              scale: isOverBin ? 1.15 : 1, 
              y: 0,
              backgroundColor: isOverBin ? 'rgba(239, 68, 68, 0.3)' : 'rgba(239, 68, 68, 0.1)',
              borderColor: isOverBin ? 'rgba(239, 68, 68, 0.8)' : 'rgba(239, 68, 68, 0.3)',
            }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            onDragOver={(e) => {
              // Only handle file drags - check if we have a dragged file ID
              if (!draggedFileId || !isDraggingFile) {
                return;
              }
              
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              setIsOverBin(true);
            }}
            onDragEnter={(e) => {
              // Only handle file drags - check if we have a dragged file ID
              if (!draggedFileId || !isDraggingFile) {
                return;
              }
              
              e.preventDefault();
              e.stopPropagation();
              setIsOverBin(true);
            }}
            onDragLeave={(e) => {
              // Check if we're actually leaving the bin (not just entering a child element)
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX;
              const y = e.clientY;
              
              if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                e.preventDefault();
                e.stopPropagation();
                setIsOverBin(false);
              }
            }}
            onDrop={(e) => {
              // Only handle file drags - use the stored file ID
              if (!draggedFileId || !isDraggingFile) {
                setIsDraggingFile(false);
                setIsOverBin(false);
                setDraggedFileId(null);
                return;
              }
              
              e.preventDefault();
              e.stopPropagation();
              handleRemoveFile(draggedFileId);
              setIsDraggingFile(false);
              setIsOverBin(false);
              setDraggedFileId(null);
            }}
            style={{
              position: 'fixed',
              bottom: '24px',
              right: '24px',
              width: '56px',
              height: '56px',
              borderRadius: '12px',
              border: '2px solid',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: isOverBin ? 'grabbing' : 'grab',
              zIndex: 1000,
              boxShadow: isOverBin ? '0 8px 24px rgba(239, 68, 68, 0.4)' : '0 4px 12px rgba(0, 0, 0, 0.15)'
            }}
            title={isOverBin ? "Release to delete file" : "Drop file here to delete"}
          >
            <motion.div
              animate={{
                scale: isOverBin ? 1.2 : 1,
                rotate: isOverBin ? 10 : 0,
              }}
              transition={{ duration: 0.2 }}
            >
              <Trash2 
                className="w-6 h-6" 
                style={{ 
                  color: isOverBin ? '#dc2626' : '#ef4444',
                  transition: 'color 0.2s ease'
                }} 
                strokeWidth={isOverBin ? 2.5 : 2} 
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatePresence>
    </>
  );
});



"use client";

import * as React from "react";
import { useMemo } from "react";
import { createPortal, flushSync } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { generateAnimatePresenceKey, generateConditionalKey, generateUniqueKey } from '../utils/keyGenerator';
import { ChevronRight, ArrowUp, Paperclip, Mic, Map, X, SquareDashedMousePointer, Scan, Fullscreen, Plus, PanelLeftOpen, PanelRightClose, Trash2, CreditCard, MoveDiagonal, Square, FileText, Image as ImageIcon, File as FileIcon, FileCheck, Minimize, Minimize2, Workflow, Home, FolderOpen, TextCursorInput, Footprints, Earth, MapPinHouse, AudioLines, MessageCircleDashed, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { FileAttachment, FileAttachmentData } from './FileAttachment';
import { PropertyAttachment, PropertyAttachmentData } from './PropertyAttachment';
import { toast } from "@/hooks/use-toast";
import { usePreview, type CitationHighlight } from '../contexts/PreviewContext';
import { usePropertySelection } from '../contexts/PropertySelectionContext';
import { useDocumentSelection } from '../contexts/DocumentSelectionContext';
import { useFilingSidebar } from '../contexts/FilingSidebarContext';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import veloraLogo from '/Velora Logo.jpg';

// Configure PDF.js worker globally (same as other components)
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;
import { PropertyData } from './PropertyResultsDisplay';
import { useChatHistory } from './ChatHistoryContext';
import { backendApi } from '../services/backendApi';
import { QuickStartBar } from './QuickStartBar';
import { ReasoningSteps, ReasoningStep } from './ReasoningSteps';
import { ResponseModeChoice } from './FileChoiceStep';
import { ModeSelector } from './ModeSelector';
import { useMode } from '../contexts/ModeContext';
import { BotStatusOverlay } from './BotStatusOverlay';

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

const StreamingResponseText: React.FC<{
  text: string;
  isStreaming: boolean;
  citations?: Record<string, any>;
  handleCitationClick: (citationData: any) => void;
  renderTextWithCitations: (text: string, citations: any, handleClick: any, seen: Set<string>) => React.ReactNode;
  onTextUpdate?: () => void;
  messageId?: string; // Unique ID for this message to track animation state
}> = ({ text, isStreaming, citations, handleCitationClick, renderTextWithCitations, onTextUpdate, messageId }) => {
  const [shouldAnimate, setShouldAnimate] = React.useState(false);
  const hasAnimatedRef = React.useRef(false);
  
  if (!text) {
    return null;
  }
  
  // Text is already pre-completed at the streaming layer (extractMarkdownBlocks)
  // No need for runtime markdown completion - text is always valid markdown
  const displayText = text;
  
  // Use a stable key - ReactMarkdown will automatically re-render when content changes
  // Changing the key causes expensive remounts which create delays, especially at the end
  // ReactMarkdown's internal diffing handles content updates efficiently
  const markdownKey = `markdown-${messageId}`;
  
  // Memoize the processed text to prevent unnecessary re-processing
  const processedText = React.useMemo(() => {
    return displayText;
  }, [displayText]);
  
  // Process citations on the full text BEFORE ReactMarkdown splits it
  // This ensures citations are matched even if ReactMarkdown splits text across elements
  const processCitationsBeforeMarkdown = (text: string): string => {
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
    
    // Clean up periods that follow citations
    processedText = processedText.replace(/\[(\d+)\]\.\s*(?=\n|$)/g, '[$1]\n');
    processedText = processedText.replace(/\[(\d+)\]\.\s*$/gm, '[$1]');
    
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
  
  // Process citations before markdown parsing - use memoized processedText for consistency
  // Citations are always converted to placeholders for consistent rendering
  const textWithCitationPlaceholders = React.useMemo(() => {
    return processCitationsBeforeMarkdown(processedText);
  }, [processedText, citations]);
  
  // Helper to render citation placeholders (no deduplication - show all citations)
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
          return <CitationLink key={key} citationNumber={num} citationData={citData} onClick={handleCitationClick} />;
        }
        // Still pending - show as plain number during streaming
        return isStreaming ? <span key={key} style={{ opacity: 0.5 }}>[{num}]</span> : <span key={key}>[{num}]</span>;
      }
    }
    
    if (superscriptMatch) {
      const num = superscriptMatch[1];
      const citData = citations?.[num];
      if (citData) {
        return <CitationLink key={key} citationNumber={num} citationData={citData} onClick={handleCitationClick} />;
      }
    } else if (bracketMatch) {
      const num = bracketMatch[1];
      const citData = citations?.[num];
      if (citData) {
        return <CitationLink key={key} citationNumber={num} citationData={citData} onClick={handleCitationClick} />;
      }
    }
    // No citation data found - return placeholder as text (shouldn't happen)
    return placeholder;
  };
  
  // Helper to process children and replace citation placeholders
  const processChildrenWithCitations = (nodes: React.ReactNode): React.ReactNode => {
    return React.Children.map(nodes, child => {
      if (typeof child === 'string') {
        // Split by citation placeholders (including pending ones) and render
        const parts = child.split(/(%%CITATION_(?:SUPERSCRIPT|BRACKET|PENDING)_\d+%%)/g);
        const result: React.ReactNode[] = [];
        parts.forEach((part, idx) => {
          if (part.startsWith('%%CITATION_')) {
            // Render all citations (including pending) via renderCitationPlaceholder
            // This ensures consistent rendering during and after streaming
            const citationNode = renderCitationPlaceholder(part, `cit-${idx}-${part}`);
            if (citationNode !== null) {
              result.push(<React.Fragment key={`cit-${idx}-${part}`}>{citationNode}</React.Fragment>);
            }
          } else if (part) {
            result.push(<React.Fragment key={`text-${idx}`}>{part}</React.Fragment>);
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

  return (
    <div
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
        minHeight: '1px', // Prevent collapse
        contain: 'layout style paint', // Prevent layout shifts
        wordWrap: 'break-word',
        overflowWrap: 'break-word',
        wordBreak: 'break-word'
      }}
    >
      <ReactMarkdown 
        key={markdownKey}
        skipHtml={true}
        components={{
          p: ({ children }) => {
            return <p style={{ 
              margin: 0, 
              marginBottom: '10px', 
              textAlign: 'left',
              wordWrap: 'break-word',
              overflowWrap: 'break-word',
              wordBreak: 'break-word'
            }}>{processChildrenWithCitations(children)}</p>;
          },
          h1: ({ children }) => {
            return <h1 style={{ 
              fontSize: '18px', 
              fontWeight: 600, 
              margin: '14px 0 10px 0', 
              color: '#111827',
              wordWrap: 'break-word',
              overflowWrap: 'break-word',
              wordBreak: 'break-word'
            }}>{processChildrenWithCitations(children)}</h1>;
          },
          h2: () => null, 
          h3: () => null,
          ul: ({ children }) => <ul style={{ 
            margin: '10px 0', 
            paddingLeft: 0, 
            listStylePosition: 'inside',
            wordWrap: 'break-word',
            overflowWrap: 'break-word',
            wordBreak: 'break-word'
          }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ 
            margin: '10px 0', 
            paddingLeft: 0, 
            listStylePosition: 'inside',
            wordWrap: 'break-word',
            overflowWrap: 'break-word',
            wordBreak: 'break-word'
          }}>{children}</ol>,
          li: ({ children }) => {
            return <li style={{ 
              marginBottom: '6px',
              wordWrap: 'break-word',
              overflowWrap: 'break-word',
              wordBreak: 'break-word'
            }}>{processChildrenWithCitations(children)}</li>;
          },
          strong: ({ children }) => {
            return <strong style={{ 
              fontWeight: 600,
              wordWrap: 'break-word',
              overflowWrap: 'break-word',
              wordBreak: 'break-word'
            }}>{processChildrenWithCitations(children)}</strong>;
          },
          em: ({ children }) => {
            return <em style={{ 
              fontStyle: 'italic',
              wordWrap: 'break-word',
              overflowWrap: 'break-word',
              wordBreak: 'break-word'
            }}>{processChildrenWithCitations(children)}</em>;
          },
          code: ({ children }) => <code style={{ 
            backgroundColor: '#f3f4f6', 
            padding: '2px 5px', 
            borderRadius: '4px', 
            fontSize: '14px', 
            fontFamily: 'monospace',
            wordWrap: 'break-word',
            overflowWrap: 'break-word',
            wordBreak: 'break-word'
          }}>{children}</code>,
          blockquote: ({ children }) => <blockquote style={{ 
            borderLeft: '3px solid #d1d5db', 
            paddingLeft: '12px', 
            margin: '8px 0', 
            color: '#6b7280',
            wordWrap: 'break-word',
            overflowWrap: 'break-word',
            wordBreak: 'break-word'
          }}>{children}</blockquote>,
          hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '16px 0' }} />,
        }}
      >
        {textWithCitationPlaceholders}
      </ReactMarkdown>
    </div>
  );
};

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
  matched_chunk_metadata?: CitationChunkData;
  source_chunks_metadata?: CitationChunkData[];
  candidate_chunks_metadata?: CitationChunkData[];
  chunk_metadata?: CitationChunkData;
}

const CitationLink: React.FC<{
  citationNumber: string;
  citationData: CitationDataType;
  onClick: (data: CitationDataType) => void;
}> = ({ citationNumber, citationData, onClick }) => {
  // Build display name with fallbacks
  const displayName = citationData.original_filename || 
    (citationData.classification_type ? citationData.classification_type.replace(/_/g, ' ') : 'Document');
  
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(citationData);
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: '4px',
        marginRight: '2px',
        minWidth: '20px',
        height: '20px',
        padding: '0 5px',
        fontSize: '12px',
        fontWeight: 500,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        color: '#6B7280',
        backgroundColor: '#F3F4F6',
        borderRadius: '4px',
        border: 'none',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        verticalAlign: 'baseline',
        position: 'relative',
        top: '0',
        lineHeight: 1,
        letterSpacing: '0',
        boxShadow: 'none',
        transform: 'scale(1)',
        flexShrink: 0
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = '#E5E7EB';
        e.currentTarget.style.color = '#374151';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = '#F3F4F6';
        e.currentTarget.style.color = '#6B7280';
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.backgroundColor = '#D1D5DB';
        e.currentTarget.style.transform = 'scale(0.98)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.backgroundColor = '#E5E7EB';
        e.currentTarget.style.transform = 'scale(1)';
      }}
      title={`Source: ${displayName}`}
      aria-label={`Citation ${citationNumber} - ${displayName}`}
    >
      {citationNumber}
    </button>
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
  
  // First, clean up periods that follow citations (e.g., "[1]." becomes "[1]")
  // This handles the case where LLM adds periods after standalone citation lines
  processedText = processedText.replace(/\[(\d+)\]\.\s*(?=\n|$)/g, '[$1]\n');
  processedText = processedText.replace(/\[(\d+)\]\.\s*$/gm, '[$1]');
  
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

// Global cache for preloaded BBOX preview images
interface BboxPreviewCacheEntry {
  pageImage: string;
  thumbnailHeight: number;
  timestamp: number;
}
const bboxPreviewCache = new globalThis.Map<string, BboxPreviewCacheEntry>();

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

const CitationBboxPreview: React.FC<CitationBboxPreviewProps> = ({ citationBboxData, onClick }) => {
  const [pageImage, setPageImage] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const thumbnailWidth = 200; // Fixed width for thumbnail
  const [thumbnailHeight, setThumbnailHeight] = React.useState<number>(thumbnailWidth * 1.414);

  // Check cache first, then load if not cached
  React.useEffect(() => {
    const cacheKey = `${citationBboxData.document_id}-${citationBboxData.page_number}`;
    const cached = bboxPreviewCache.get(cacheKey);
    
    if (cached) {
      // Use cached image immediately
      setPageImage(cached.pageImage);
      setThumbnailHeight(cached.thumbnailHeight);
      setLoading(false);
      return;
    }
    
    // Not in cache - load it now
    const loadDocument = async () => {
      try {
        setLoading(true);
        const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
        const downloadUrl = `${backendUrl}/api/files/download?document_id=${citationBboxData.document_id}`;
        
        const response = await fetch(downloadUrl, { credentials: 'include' });
        if (!response.ok) throw new Error(`Failed to download: ${response.status}`);
        
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        
        // Load PDF
        const loadingTask = pdfjs.getDocument({ data: arrayBuffer }).promise;
        const pdf = await loadingTask;
        
        // Render page to canvas
        const page = await pdf.getPage(citationBboxData.page_number || 1);
        const viewport = page.getViewport({ scale: 1.0 });
        
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
        
        setPageImage(imageUrl);
        setThumbnailHeight(scaledViewport.height);
        setLoading(false);
      } catch (error) {
        console.error('Failed to load document for BBOX preview:', error);
        setError(error instanceof Error ? error.message : 'Failed to load document');
        setLoading(false);
      }
    };

    if (citationBboxData.document_id) {
      loadDocument();
    } else {
      setError('No document ID provided');
      setLoading(false);
    }
  }, [citationBboxData.document_id, citationBboxData.page_number, thumbnailWidth]);

  if (error) {
    return (
      <div 
        style={{
          width: `${thumbnailWidth}px`,
          height: `${thumbnailWidth * 1.414}px`, // A4 aspect ratio
          backgroundColor: '#f3f4f6',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          border: '1px solid #e5e7eb'
        }}
        onClick={onClick}
      >
        <div style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', padding: '10px' }}>
          Preview unavailable
        </div>
      </div>
    );
  }

  if (loading || !pageImage) {
    return (
      <div 
        style={{
          width: `${thumbnailWidth}px`,
          height: `${thumbnailWidth * 1.414}px`, // A4 aspect ratio
          backgroundColor: '#f3f4f6',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          border: '1px solid #e5e7eb'
        }}
        onClick={onClick}
      >
        <div style={{ color: '#9ca3af', fontSize: '14px' }}>Loading...</div>
      </div>
    );
  }

  // Calculate BBOX position and size in thumbnail
  const bbox = citationBboxData.bbox;
  
  // Logo size (same as in full preview)
  const logoHeight = 0.02 * thumbnailHeight - 1;
  const logoWidth = logoHeight;
  
  // Calculate BBOX dimensions with centered padding
  const padding = 4; // Equal padding on all sides
  const originalBboxWidth = bbox.width * thumbnailWidth;
  const originalBboxHeight = bbox.height * thumbnailHeight;
  const originalBboxLeft = bbox.left * thumbnailWidth;
  const originalBboxTop = bbox.top * thumbnailHeight;
  
  // Calculate center of original BBOX
  const centerX = originalBboxLeft + originalBboxWidth / 2;
  const centerY = originalBboxTop + originalBboxHeight / 2;
  
  // Calculate minimum BBOX height to match logo height (prevents staggered appearance)
  const minBboxHeightPx = logoHeight; // Minimum height = logo height (exact match)
  const baseBboxHeight = Math.max(originalBboxHeight, minBboxHeightPx);
  
  // Calculate final dimensions with equal padding
  // If at minimum height, don't add padding to keep it exactly at logo height
  const finalBboxWidth = originalBboxWidth + padding * 2;
  const finalBboxHeight = baseBboxHeight === minBboxHeightPx 
    ? minBboxHeightPx // Exactly logo height when at minimum (no padding)
    : baseBboxHeight + padding * 2; // Add padding only when BBOX is naturally larger
  
  // Center the BBOX around the original text
  const bboxLeft = Math.max(0, centerX - finalBboxWidth / 2);
  const bboxTop = Math.max(0, centerY - finalBboxHeight / 2);
  
  // Ensure BBOX doesn't go outside page bounds
  const constrainedLeft = Math.min(bboxLeft, thumbnailWidth - finalBboxWidth);
  const constrainedTop = Math.min(bboxTop, thumbnailHeight - finalBboxHeight);
  const finalBboxLeft = Math.max(0, constrainedLeft);
  const finalBboxTop = Math.max(0, constrainedTop);
  
  // Position logo: Logo's top-right corner aligns with BBOX's top-left corner
  // Logo's right border edge overlaps with BBOX's left border edge
  const logoLeft = finalBboxLeft - logoWidth + 2; // Move 2px right so borders overlap
  const logoTop = finalBboxTop; // Logo's top = BBOX's top (perfectly aligned)

  return (
    <div
      style={{
        position: 'relative',
        width: `${thumbnailWidth}px`,
        height: `${thumbnailHeight}px`,
        borderRadius: '4px',
        overflow: 'hidden',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        border: '1px solid #e5e7eb'
      }}
      onClick={onClick}
    >
      <img
        src={pageImage}
        alt="Document preview"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block'
        }}
      />
      {/* BBOX Highlight */}
      <div
        style={{
          position: 'absolute',
          left: `${finalBboxLeft}px`,
          top: `${finalBboxTop}px`,
          width: `${Math.min(thumbnailWidth, finalBboxWidth)}px`,
          height: `${Math.min(thumbnailHeight, finalBboxHeight)}px`,
          backgroundColor: 'rgba(255, 235, 59, 0.4)',
          border: '2px solid rgba(255, 193, 7, 0.9)',
          borderRadius: '2px',
          pointerEvents: 'none',
          zIndex: 10
        }}
      />
      {/* Velora Logo */}
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
    </div>
  );
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
  onQuerySubmit?: (query: string) => void; // Callback for submitting new queries from panel
  onMapToggle?: () => void; // Callback for toggling map view
  onMinimize?: (chatMessages: Array<{ id: string; type: 'query' | 'response'; text: string; attachments?: FileAttachmentData[]; propertyAttachments?: any[]; selectedDocumentIds?: string[]; selectedDocumentNames?: string[]; isLoading?: boolean }>) => void; // Callback for minimizing to bubble with chat messages
  onMessagesUpdate?: (chatMessages: Array<{ id: string; type: 'query' | 'response'; text: string; attachments?: FileAttachmentData[]; propertyAttachments?: any[]; selectedDocumentIds?: string[]; selectedDocumentNames?: string[]; isLoading?: boolean }>) => void; // Callback for real-time message updates
  restoreChatId?: string | null; // Chat ID to restore from history
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
}

export interface SideChatPanelRef {
  getAttachments: () => FileAttachmentData[];
}

export const SideChatPanel = React.forwardRef<SideChatPanelRef, SideChatPanelProps>(({
  isVisible,
  query,
  citationContext,
  sidebarWidth = 56, // Default to desktop sidebar width (lg:w-14 = 56px)
  isSidebarCollapsed = false,
  onQuerySubmit,
  onMapToggle,
  onMinimize,
  onMessagesUpdate,
  restoreChatId,
  onNewChat,
  onSidebarToggle,
  onOpenProperty,
  initialAttachedFiles,
  onChatWidthChange,
  isPropertyDetailsOpen = false, // Default to false
  shouldExpand = false, // Default to false
  onQuickStartToggle,
  isQuickStartBarVisible = false, // Default to false
  isMapVisible = false // Default to false
}, ref) => {
  // Main navigation state:
  // - collapsed: icon-only sidebar (treat as "closed" for the purposes of showing open controls)
  // - open: full sidebar visible
  const isMainSidebarOpen = !isSidebarCollapsed;

  // Use shared preview context (moved early to ensure expandedCardViewDoc is available)
  const {
    addPreviewFile,
    preloadFile,
    previewFiles,
    getCachedPdfDocument,
    preloadPdfPage,
    setHighlightCitation,
    openExpandedCardView,
    closeExpandedCardView,
    expandedCardViewDoc, // Track when document preview is open/closed
    setIsAgentOpening,
    setAgentTaskActive,
    stopAgentTask,
    setMapNavigating
  } = usePreview();

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
    
    // Remove BLOCK_CITE_ID references (e.g., "(BLOCK_CITE_ID_136)" or "BLOCK_CITE_ID_136")
    // Pattern matches: (BLOCK_CITE_ID_123), BLOCK_CITE_ID_123, or any variation
    cleaned = cleaned.replace(/\s*\(?BLOCK_CITE_ID_\d+\)?\s*/g, ' ');
    
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
  const propertySearchPopupRef = React.useRef<HTMLDivElement>(null);
  const propertySearchDebounceRef = React.useRef<NodeJS.Timeout | null>(null);
  
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
  // Track actual rendered width of the panel for responsive design
  const [actualPanelWidth, setActualPanelWidth] = React.useState<number>(450);
  // Track actual input container width for button responsive design
  const [inputContainerWidth, setInputContainerWidth] = React.useState<number>(450);
  // Track if we just entered fullscreen to disable transition
  const [justEnteredFullscreen, setJustEnteredFullscreen] = React.useState<boolean>(false);
  // State for drag over feedback
  const [isDragOver, setIsDragOver] = React.useState<boolean>(false);
  // Track locked width to prevent expansion when property details panel closes
  const lockedWidthRef = React.useRef<string | null>(null);
  // Track if agent is performing a navigation task (prevents fullscreen re-expansion)
  const isNavigatingTaskRef = React.useRef<boolean>(false);
  // Track custom dragged width for resizing
  const [draggedWidth, setDraggedWidth] = React.useState<number | null>(null);
  const [isResizing, setIsResizing] = React.useState<boolean>(false);
  // Track if this is the first citation clicked in the current chat session
  const isFirstCitationRef = React.useRef<boolean>(true);
  
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
  
  // Sync expanded state with shouldExpand prop
  React.useEffect(() => {
    console.log('🔄 SideChatPanel: shouldExpand changed', { shouldExpand, isExpanded, isFullscreenMode, isPropertyDetailsOpen, isNavigatingTask: isNavigatingTaskRef.current });
    
    // CRITICAL: Don't re-expand to fullscreen if we're in the middle of a navigation task
    // Navigation tasks shrink the chat to 380px and should NOT be overridden
    if (isNavigatingTaskRef.current) {
      console.log('🚫 Skipping fullscreen expansion - navigation task in progress');
      return;
    }
    
    if (shouldExpand) {
      // shouldExpand is true - expand the chat
      if (!isExpanded) {
      setIsExpanded(true);
      }
      
      // Only set fullscreen mode when shouldExpand is true AND property details is NOT open
      // When property details is open, use normal 35vw width (not fullscreen)
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
        // Property details is open - use normal 35vw width (not fullscreen)
        // Clear fullscreen mode if it was set (but not if user manually requested fullscreen)
        if (isFullscreenMode && !isManualFullscreenRef.current) {
          console.log('📐 Property details open - clearing fullscreen mode, using 35vw');
          setIsFullscreenMode(false);
          isFullscreenFromDashboardRef.current = false;
        }
        // Lock the width to 35vw for analyse mode (unless user manually requested fullscreen)
        if (!isManualFullscreenRef.current) {
          lockedWidthRef.current = '35vw';
          // Clear dragged width so locked width takes effect
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
      // Chat is opening - restore fullscreen state if we were in fullscreen before
      if (wasFullscreenWhenClosedRef.current && !shouldExpand) {
        console.log('🔄 Chat opening - restoring fullscreen state');
        setIsFullscreenMode(true);
        isFullscreenFromDashboardRef.current = true;
        setIsExpanded(true);
        setDraggedWidth(null); // Clear any dragged width so fullscreen width takes effect
        lockedWidthRef.current = null;
        // Disable transition for instant fullscreen
        setJustEnteredFullscreen(true);
        setTimeout(() => {
          setJustEnteredFullscreen(false);
        }, 50);
      }
    }
  }, [isVisible, isFullscreenMode, shouldExpand]);
  
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
  
  // Lock width when property details panel opens in expanded chat
  React.useEffect(() => {
    if (isExpanded && isPropertyDetailsOpen) {
      lockedWidthRef.current = '35vw';
    }
  }, [isExpanded, isPropertyDetailsOpen]);
  
  // Handle resize functionality - similar to PDF preview modal
  // Track if we were in fullscreen when resize started (to handle exit on actual drag)
  const wasFullscreenOnResizeStartRef = React.useRef(false);
  const hasExitedFullscreenDuringResizeRef = React.useRef(false);
  
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const panelElement = e.currentTarget.closest('[class*="fixed"]') as HTMLElement;
    if (!panelElement) return;
    
    panelElementRef.current = panelElement;
    const rect = panelElement.getBoundingClientRect();
    
    // Get the actual current width from the DOM element
    const actualCurrentWidth = rect.width;
    
    // Check if we're in fullscreen mode
    const isInFullscreen = isFullscreenMode && !isPropertyDetailsOpen;
    wasFullscreenOnResizeStartRef.current = isInFullscreen;
    hasExitedFullscreenDuringResizeRef.current = false;
    
    // If in fullscreen, immediately exit and set width to cursor position
    if (isInFullscreen) {
      setIsFullscreenMode(false);
      isFullscreenFromDashboardRef.current = false;
      hasExitedFullscreenDuringResizeRef.current = true;
      
      // Calculate width based on cursor position (where user touched the handle)
      const availableWidth = window.innerWidth - sidebarWidth;
      const cursorDistanceFromLeft = e.clientX - sidebarWidth;
      // Clamp to min/max bounds
      const minWidth = 450;
      const maxWidth = availableWidth;
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
      
      if (draggedWidth !== null) {
        currentWidth = draggedWidth;
      } else if (actualCurrentWidth > 0) {
        currentWidth = actualCurrentWidth;
      } else {
        currentWidth = isExpanded 
          ? (isPropertyDetailsOpen ? window.innerWidth * 0.35 : window.innerWidth * 0.5)
          : 450;
      }
      
      resizeStateRef.current = {
        startPos: { x: e.clientX },
        startWidth: currentWidth,
        hasStartedDragging: true // Already have a width, can start tracking immediately
      };
    }
    
    setIsResizing(true);
  };

  // Handle resize mouse move and cleanup - using useEffect like PDF preview modal
  React.useEffect(() => {
    if (!isResizing || !resizeStateRef.current || !panelElementRef.current) {
      return;
    }

    const minWidth = 450;
    // Allow dragging to the edge of the screen (only account for sidebar width)
    const maxWidth = window.innerWidth - sidebarWidth;

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
        // NOTE: Handle is on RIGHT edge, so dragging left (negative delta) = narrower, right (positive) = wider
        const newWidth = Math.min(Math.max(resizeStateRef.current.startWidth + deltaX, minWidth), maxWidth);
        
        // Direct DOM manipulation for immediate visual feedback
        if (panelElementRef.current) {
          panelElementRef.current.style.width = `${newWidth}px`;
        }
        
        // Update state
        setDraggedWidth(newWidth);
        if (onChatWidthChange) {
          onChatWidthChange(newWidth);
        }
      });
    };

    const handleMouseUp = () => {
      // Cancel any pending RAF
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      setIsResizing(false);
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
    };
  }, [isResizing, sidebarWidth, onChatWidthChange]);
  
  // Calculate and notify parent of chat panel width changes
  React.useEffect(() => {
    if (onChatWidthChange && isVisible) {
      // Use dragged width if set, otherwise use locked width or calculate based on current state
      let chatWidth: number;
      if (draggedWidth !== null) {
        chatWidth = draggedWidth;
      } else if (isExpanded) {
        if (isFullscreenMode) {
          // Fullscreen from dashboard: span full width minus sidebar
          chatWidth = window.innerWidth - sidebarWidth;
        } else if (lockedWidthRef.current) {
          // Use locked width (convert vw to pixels)
          const vwValue = parseFloat(lockedWidthRef.current);
          chatWidth = window.innerWidth * (vwValue / 100);
        } else {
          // Normal calculation
          chatWidth = isPropertyDetailsOpen ? window.innerWidth * 0.35 : window.innerWidth * 0.5;
        }
      } else {
        chatWidth = 450; // Fixed 450px when collapsed
      }
      onChatWidthChange(chatWidth);
    } else if (onChatWidthChange && !isVisible) {
      // Chat is hidden, notify parent that width is 0
      onChatWidthChange(0);
    }
  }, [isExpanded, isVisible, isPropertyDetailsOpen, draggedWidth, onChatWidthChange, isFullscreenMode, sidebarWidth]);
  
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
  
  // Expose getAttachments method via ref
  React.useImperativeHandle(ref, () => ({
    getAttachments: () => {
      return attachedFilesRef.current;
    }
  }), []);
  
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
    toggleDocumentSelectionMode,
    clearSelectedDocuments,
    setDocumentSelectionMode
  } = useDocumentSelection();
  
  // Filing sidebar integration
  const { toggleSidebar: toggleFilingSidebar, isOpen: isFilingSidebarOpen } = useFilingSidebar();
  
  // Agent mode (reader vs agent)
  const { mode: agentMode, isAgentMode } = useMode();
  
  // Ref to track current agent mode (avoids closure issues in streaming callbacks)
  const isAgentModeRef = React.useRef(isAgentMode);
  React.useEffect(() => {
    isAgentModeRef.current = isAgentMode;
    // Hide bot overlay when switching from agent mode to reader mode
    if (!isAgentMode) {
      setIsBotActive(false);
    }
  }, [isAgentMode]);
  
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
    action_type: 'planning' | 'exploring' | 'searching' | 'reading' | 'analysing' | 'summarising' | 'complete' | 'context' | 'executing' | 'opening' | 'navigating' | 'highlighting' | 'opening_map' | 'selecting_pin';
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
  }
  
  const [submittedQueries, setSubmittedQueries] = React.useState<SubmittedQuery[]>([]);
  const [chatMessages, setChatMessages] = React.useState<ChatMessage[]>([]);
  // Persistent sessionId for conversation continuity (reused across all messages in this chat session)
  const [sessionId] = React.useState<string>(() => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  
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
  
  // Reset first citation flag when chat messages are cleared (new chat session)
  React.useEffect(() => {
    if (chatMessages.length === 0) {
      isFirstCitationRef.current = true;
      console.log('🔄 [CITATION] Chat messages cleared - resetting first citation flag');
    }
  }, [chatMessages.length]);
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
  
  // Handle property selection
  const handlePropertySelect = React.useCallback((property: PropertyData) => {
    // Use the property selection context to add the property attachment
    addPropertyAttachment(property);
    
    // Close popup and clear search
    setShowPropertySearchPopup(false);
    setPropertySearchResults([]);
    setPropertySearchQuery("");
    
    // Remove the @property prefix from input if present
    const newInput = inputValue.replace(/@property\s+/i, '').trim();
    setInputValue(newInput);
  }, [inputValue, addPropertyAttachment]);
  
  // Use chat history context
  const { addChatToHistory, getChatById } = useChatHistory();
  
  // Track the last processed query from props to avoid duplicates
  const lastProcessedQueryRef = React.useRef<string>('');
  
  // CRITICAL: Track if a query is currently being processed to prevent duplicate API calls
  // This prevents race conditions between the two useEffects that both watch query/isVisible
  const isProcessingQueryRef = React.useRef<boolean>(false);
  
  // Process query prop from SearchBar (when in map view)
  React.useEffect(() => {
    // Only process if:
    // 1. Query is provided and not empty
    // 2. Query is different from last processed query
    // 3. Panel is visible
    // 4. Query hasn't already been added to chat messages
    // 5. We're not already processing a query
    if (query && query.trim() && query !== lastProcessedQueryRef.current && isVisible && !isProcessingQueryRef.current) {
      const queryText = query.trim();
      
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
        // Mark as processing to prevent duplicate API calls from other useEffects
        isProcessingQueryRef.current = true;
        lastProcessedQueryRef.current = queryText;
        
        // Get selected document IDs if selection mode was used
        const selectedDocIds = selectedDocumentIds.size > 0 
          ? Array.from(selectedDocumentIds) 
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
        
        const newQueryMessage: ChatMessage = {
          id: queryId,
          type: 'query',
          text: queryText,
          attachments: attachmentsForMessage, // Use the deep copy
          propertyAttachments: [...propertyAttachments],
          selectedDocumentIds: selectedDocIds,
          selectedDocumentNames: selectedDocNames,
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
            const propertyId = propertyAttachments.length > 0 
              ? String(propertyAttachments[0].propertyId) 
              : undefined;
            
            const messageHistory = chatMessages
              .filter(msg => (msg.type === 'query' || msg.type === 'response') && msg.text)
              .map(msg => ({
                role: msg.type === 'query' ? 'user' : 'assistant',
                content: msg.text || ''
              }));
            
            const documentIdsArray = selectedDocumentIds.size > 0 
              ? Array.from(selectedDocumentIds) 
              : undefined;
            
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
            
            const abortController = new AbortController();
            abortControllerRef.current = abortController;
            
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
                  
                  // Update state with markdown blocks - StreamingResponseText will complete and render formatted output
                  setChatMessages(prev => prev.map(msg => 
                    msg.id === loadingResponseId 
                      ? { ...msg, text: cleanedText }
                      : msg
                  ));
                  
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
              query: queryText,
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
            
            await backendApi.queryDocumentsStreamFetch(
              queryText,
              propertyId,
              messageHistory,
              sessionId,
              // onToken: Buffer tokens until we have complete markdown blocks, then display formatted
              (token: string) => {
                accumulatedText += token;
                tokenBuffer += token;
                
                // Only process tokens if not paused
                if (!isBotPausedRef.current) {
                  // Process tokens to find complete markdown blocks
                  // This allows ReactMarkdown to render formatted output progressively
                  processTokensWithDelay();
                }
                // If paused, tokens are still accumulated in tokenBuffer but not processed
                // When resumed, processTokensWithDelay() will be called to process buffered tokens
              },
              // onComplete: Final response received - flush buffer and complete animation
              (data: any) => {
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
                  const finalText = cleanResponseText(displayedText || data.summary || accumulatedText || "I found some information for you.");
                
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
                    citations: finalCitations // Use final citations (normalized to string keys)
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
                console.error('❌ SideChatPanel: Streaming error:', error);
                
                // Hide bot status overlay on error
                setIsBotActive(false);
                
                // Clear resume processing ref on error
                resumeProcessingRef.current = null;
                
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
                } else {
                  // Show generic error for other cases
                  errorText = error || 'Sorry, I encountered an error processing your query.';
                }
                
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
              },
              undefined, // onStatus (optional)
              abortController.signal, // abortSignal
              documentIdsArray, // documentIds
              // onReasoningStep: Handle reasoning step events
              (step: { step: string; action_type?: string; message: string; count?: number; details: any }) => {
                
                // PRELOAD: Extract document IDs from reasoning steps and preload IMMEDIATELY
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
                
                setChatMessages(prev => {
                  const updated = prev.map(msg => {
                    if (msg.id === loadingResponseId) {
                      const existingSteps = msg.reasoningSteps || [];
                      // Use step + message as unique key to allow different messages for same step type
                      // Also dedupe by timestamp proximity (within 500ms) to prevent duplicate emissions
                      const stepKey = `${step.step}:${step.message}`;
                      const now = Date.now();
                      const existingIndex = existingSteps.findIndex(s => 
                        `${s.step}:${s.message}` === stepKey && (now - s.timestamp) < 500
                      );
                      
                      // Skip if this exact step was added very recently (deduplication)
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
                      
                      // Add new step
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
                
                accumulatedCitations[citationNumStr] = {
                  doc_id: citation.data.doc_id,
                  page: citation.data.page || citation.data.page_number || 0,
                  bbox: finalBbox, // Use normalized bbox or default empty bbox
                  method: citation.data.method, // Include method field
                  block_id: citation.data.block_id, // Include block_id for debugging and validation
                  original_filename: citation.data.original_filename // Include filename for preloading
                };
                
                // PRELOAD: Start downloading document in background when citation received
                // This ensures documents are ready when user clicks citation (instant BBOX highlight)
                // Note: Documents may already be preloaded from reasoning steps, but this is a fallback
                const docId = citation.data.doc_id;
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
                
                // Update message with citations in real-time
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
              },
              citationContext || undefined, // citationContext (from citation click)
              responseMode, // responseMode (from file choice)
              attachmentContext, // attachmentContext (extracted text from files)
              // AGENT-NATIVE: Handle agent actions (open document, highlight, navigate, save)
              (action: { action: string; params: any }) => {
                console.log('🎯 [AGENT_ACTION] Received action:', action);
                
                // Skip agent actions in reader mode - just show citations without auto-opening
                // Use ref to get current mode value (avoids closure issues)
                if (!isAgentModeRef.current) {
                  console.log('📖 [READER_MODE] Skipping agent action - reader mode active');
                  return;
                }
                
                console.log('✅ [AGENT_MODE] Executing agent action:', action.action);
                
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
                    }
                    break;
                    
                  case 'highlight_bbox':
                    // Legacy: highlight_bbox is now combined into open_document
                    // This case is kept for backwards compatibility
                    console.log('⚠️ [AGENT_ACTION] Legacy highlight_bbox received - should use open_document with bbox instead');
                    break;
                    
                  case 'navigate_to_property':
                    // Navigate to property details panel
                    if (action.params.property_id && onOpenProperty) {
                      onOpenProperty(null, null, action.params.property_id);
                    }
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
                      const navMinWidth = 380;
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
                      const pinNavMinWidth = 380;
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
                    // EARLY DOCUMENT PREPARATION: Start loading document before answer is generated
                    // This happens WHILE the LLM is still generating the answer, so the document
                    // will be cached and ready when open_document action comes
                    console.log('📥 [AGENT_ACTION] prepare_document - pre-loading document:', action.params.doc_id);
                    if (action.params.doc_id && backendApi) {
                      // Pre-cache the document by fetching its metadata
                      // This warms up the cache so open_document is faster
                      (async () => {
                        try {
                          // Pre-fetch document info to warm cache
                          const docId = action.params.doc_id;
                          const downloadUrl = action.params.download_url || `/api/files/download?document_id=${docId}`;
                          
                          // Start fetching the document in background (this warms the browser cache)
                          fetch(downloadUrl, { 
                            method: 'HEAD',  // Just check if accessible, don't download full file yet
                            credentials: 'include'
                          }).then(() => {
                            console.log('✅ [EARLY_PREP] Document URL validated:', docId.substring(0, 8) + '...');
                          }).catch(() => {
                            // Ignore errors - this is just pre-warming
                          });
                          
                          // Store doc_id for immediate use when open_document comes
                          (window as any).__preparedDocumentId = docId;
                          (window as any).__preparedDocumentFilename = action.params.filename;
                          console.log('✅ [EARLY_PREP] Document prepared for fast opening:', docId.substring(0, 8) + '...');
                        } catch (e) {
                          // Ignore errors - this is just optimization
                        }
                      })();
                    }
                    break;
                    
                  default:
                    console.warn('Unknown agent action:', action.action);
                }
              },
              isAgentModeRef.current // Pass agent mode to backend for tool-based actions
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
  }, [query, isVisible, chatMessages, attachedFiles, initialAttachedFiles, propertyAttachments, selectedDocumentIds, hasExtractedAttachments, showFileChoiceAndWait, buildAttachmentContext]);
  
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
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
      // Use flushSync to ensure state updates happen synchronously before render (like dashboard opening)
      flushSync(() => {
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
      });
      
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


  // Phase 1: Handle citation click - fetch document and open in viewer
  // fromAgentAction: true when called from agent_action handler (backend already emits reasoning step)
  const handleCitationClick = React.useCallback(async (citationData: CitationData, fromAgentAction: boolean = false) => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
      
      console.groupCollapsed('📚 [CITATION] handleCitationClick');
      console.log('Raw citation payload:', citationData);
      console.log('Matched chunk metadata:', citationData.matched_chunk_metadata);
      console.log('fromAgentAction:', fromAgentAction);
      console.groupEnd();

      const docId = citationData.doc_id;
      
      if (!docId) {
        console.error('❌ Citation missing doc_id:', citationData);
        toast({
          title: "Error",
          description: "Document ID not found in citation",
          variant: "destructive",
        });
        return;
      }

      console.log('📎 Opening document from citation:', citationData.original_filename, 'doc_id:', docId);
      console.log('📎 Citation data received:', JSON.stringify(citationData, null, 2));
      console.log('📎 source_chunks_metadata:', citationData.source_chunks_metadata);

      // AGENT-NATIVE: Add "Opening citation view" and "Highlighting content" reasoning steps when citation is clicked (only in Agent mode)
      // This provides instant visual feedback before any async work starts
      // Only add to the LAST message with reasoning steps (prefer completed, but allow loading if no completed found)
      // SKIP when called from agent action - backend already emits the reasoning step
      if (isAgentModeRef.current && !fromAgentAction) {
        setChatMessages(prev => {
          // Find the index of the LAST message with reasoning steps
          // Prefer completed messages, but fall back to loading message if that's all we have
          let targetMsgIndex = -1;
          let fallbackLoadingIndex = -1;
          
          for (let i = prev.length - 1; i >= 0; i--) {
            const msg = prev[i];
            if (msg.reasoningSteps && msg.reasoningSteps.length > 0) {
              if (!msg.isLoading) {
                // Found a completed message with reasoning steps - use this
                targetMsgIndex = i;
                break;
              } else if (fallbackLoadingIndex === -1) {
                // Track the first loading message with reasoning steps as fallback
                fallbackLoadingIndex = i;
              }
            }
          }
          
          // Use completed message if found, otherwise fall back to loading message
          if (targetMsgIndex === -1) {
            targetMsgIndex = fallbackLoadingIndex;
          }
          
          if (targetMsgIndex === -1) {
            return prev; // No message with reasoning steps found
          }
          
          const updated = prev.map((msg, idx) => {
            // Only modify the target message
            if (idx !== targetMsgIndex) {
              return msg;
            }
            
            // Check if steps already exist (avoid duplicates)
            // Check for either frontend-added step OR backend-emitted step
            const hasCombinedStep = msg.reasoningSteps?.some(s => 
              s.action_type === 'opening' && 
              (s.step === 'agent_opening_citation' || s.step === 'agent_open_document')
            );
            
            // Add single combined step for opening and highlighting
            // Skip if backend already added it (from agent action)
            if (!hasCombinedStep) {
              const newStep: ReasoningStep = {
                step: 'agent_opening_citation',
                action_type: 'opening',
                message: 'Opening citation view & Highlighting content',
                timestamp: Number.MAX_SAFE_INTEGER,
                fromCitationClick: true,
                details: {
                  doc_id: docId,
                  filename: citationData.original_filename || 'document.pdf'
                }
              };
            
              return {
                ...msg,
                reasoningSteps: [...(msg.reasoningSteps || []), newStep]
              };
            }
            return msg;
          });
          persistedChatMessagesRef.current = updated;
          return updated;
        });
      }

      // Check if document is already loaded in preview context (performance optimization)
      const existingFile = previewFiles.find(f => f.id === docId);
      let file: File;
      let fileType: string;
      let fileSize: number;
      
      if (existingFile && existingFile.file) {
        // Reuse existing file - no need to download again
        console.log('✅ [CITATION] Document already loaded, reusing existing file');
        file = existingFile.file;
        fileType = existingFile.type || 'application/pdf';
        fileSize = existingFile.size || 0;
      } else {
        // Download document only if not already loaded
        console.log('📥 [CITATION] Downloading document (not in cache)');
        const downloadUrl = `${backendUrl}/api/files/download?document_id=${docId}`;
        
        const response = await fetch(downloadUrl, {
          credentials: 'include'
        });

        if (!response.ok) {
          throw new Error(`Failed to download document: ${response.status} ${response.statusText}`);
        }

        const blob = await response.blob();
        
        // Determine file type from blob or citation data
        fileType = blob.type || 'application/pdf';
        fileSize = blob.size;
        
        // Create File object from blob
        file = new File([blob], citationData.original_filename || 'document.pdf', {
          type: fileType
        });
      }

      // Convert to FileAttachmentData format for PreviewContext cache
      const fileData: FileAttachmentData = {
        id: docId, // Use doc_id as the file ID
        file: file,
        name: citationData.original_filename || 'document.pdf',
        type: fileType,
        size: fileSize
      };

      // Ensure the ExpandedCardView can open instantly without a second download.
      // (StandaloneExpandedCardView now reuses PreviewContext cache when available.)
      preloadFile(fileData);

      // NEW: Validate bbox before using it
      const validateBbox = (bbox: any): boolean => {
        if (!bbox || typeof bbox !== 'object') return false;
        
        const { left, top, width, height } = bbox;
        
        // Check if values are valid (0-1 range for normalized coordinates)
        if (
          typeof left !== 'number' || left < 0 || left > 1 ||
          typeof top !== 'number' || top < 0 || top > 1 ||
          typeof width !== 'number' || width <= 0 || width > 1 ||
          typeof height !== 'number' || height <= 0 || height > 1
        ) {
          console.warn('⚠️ [CITATION] Invalid bbox values:', bbox);
          return false;
        }
        
        // Check if bbox is invalid fallback (covers entire page or is at origin with full size)
        const area = width * height;
        const isFallbackBbox = (
          (left === 0 && top === 0 && width === 1 && height === 1) ||  // Full page fallback
          area > 0.9  // More than 90% of page (likely fallback)
        );
        
        if (isFallbackBbox) {
          console.warn('⚠️ [CITATION] Rejecting fallback bbox (covers entire page):', { area, bbox });
          return false;  // Reject invalid fallback bboxes
        }
        
        // Warn if bbox is large but not full page
        if (area > 0.5) {
          console.warn('⚠️ [CITATION] Bbox area large (may be imprecise):', { area, bbox });
        }
        
        return true;
      };

      // Use new minimal citation structure: citationData.bbox and citationData.page
      // Fallback to legacy fields for backward compatibility
      let highlightData: CitationHighlight | undefined;

      // Priority: Use new structure (citationData.bbox) > legacy structure (source_chunks_metadata)
      if (citationData.bbox && 
          typeof citationData.bbox.left === 'number' && 
          typeof citationData.bbox.top === 'number' && 
          typeof citationData.bbox.width === 'number' && 
          typeof citationData.bbox.height === 'number') {
        
        // Validate bbox before using it
        if (!validateBbox(citationData.bbox)) {
          console.warn('⚠️ [CITATION] Invalid bbox in new structure, falling back to legacy structure or no highlight');
          // Will fall through to legacy structure check below
        } else {
          // New minimal structure - use bbox directly
          const highlightPage = citationData.bbox.page || citationData.page || citationData.page_number || 1;
          
          highlightData = {
            fileId: docId, // CRITICAL: Must match fileData.id below
            bbox: {
              left: citationData.bbox.left,
              top: citationData.bbox.top,
              width: citationData.bbox.width,
              height: citationData.bbox.height,
              page: highlightPage
            },
            // Include full citation metadata for CitationActionMenu
            doc_id: docId,
            block_id: citationData.block_id || '',
            block_content: (citationData as any).cited_text || (citationData as any).block_content || '',
            original_filename: citationData.original_filename || ''
          };

          console.log('🎯 [CITATION] Using new minimal citation structure', {
            fileId: docId,
            page: highlightPage,
            bbox: citationData.bbox,
            fileDataId: fileData.id, // Verify they match
            block_id: highlightData.block_id
          });
        }
      }
      
      // If new structure didn't work, try legacy structure
      if (!highlightData) {
        // Fallback to legacy structure for backward compatibility
        const hasValidBbox = (chunk?: CitationChunkData | null): chunk is CitationChunkData & { bbox: NonNullable<CitationChunkData['bbox']> } =>
          !!(chunk && chunk.bbox && typeof chunk.bbox.left === 'number' && typeof chunk.bbox.top === 'number' && typeof chunk.bbox.width === 'number' && typeof chunk.bbox.height === 'number');

        const candidateChunks = citationData.candidate_chunks_metadata?.length
          ? [...citationData.candidate_chunks_metadata]
          : [];
        const sourceChunks = citationData.source_chunks_metadata?.length
          ? [...citationData.source_chunks_metadata]
          : [];

        const priorityList: Array<{ chunk?: CitationChunkData; reason: string }> = [
          { chunk: citationData.matched_chunk_metadata, reason: 'matched_chunk_metadata' },
          { chunk: citationData.chunk_metadata, reason: 'chunk_metadata' },
          { chunk: candidateChunks.find((chunk) => hasValidBbox(chunk)), reason: 'candidate_chunks_metadata' },
          { chunk: sourceChunks.find((chunk) => hasValidBbox(chunk)), reason: 'source_chunks_metadata' },
        ];

        const highlightSource = priorityList.find((entry) => hasValidBbox(entry.chunk));
        const highlightChunk = highlightSource?.chunk;

        if (highlightChunk && highlightChunk.bbox) {
          // Validate legacy bbox before using it
          if (!validateBbox(highlightChunk.bbox)) {
            console.warn('⚠️ [CITATION] Invalid bbox in legacy structure, falling back to no highlight');
          } else {
            const highlightPage = highlightChunk.bbox.page || highlightChunk.page_number || citationData.page || citationData.page_number || 1;
            
            highlightData = {
              fileId: docId, // CRITICAL: Must match fileData.id below
              bbox: {
                left: highlightChunk.bbox.left,
                top: highlightChunk.bbox.top,
                width: highlightChunk.bbox.width,
                height: highlightChunk.bbox.height,
                page: highlightPage
              }
            };

            console.log('🎯 [CITATION] Using legacy citation structure', {
              fileId: docId,
              reason: highlightSource?.reason,
              page: highlightPage,
              bbox: highlightChunk.bbox,
              fileDataId: fileData.id // Verify they match
            });
          }
        } else {
          console.warn('⚠️ [CITATION] Unable to determine highlight from citation data. Falling back to no highlight.');
        }
      }

      console.log('📚 [CITATION] Highlight payload prepared for preview:', {
        highlightData,
        fileDataId: fileData.id,
        highlightFileId: highlightData?.fileId,
        fileIdsMatch: highlightData ? fileData.id === highlightData.fileId : 'no highlight'
      });
      
      // Always switch from fullscreen to 50% width when clicking a citation
      // This creates a 50/50 split with the document preview
      // Check if we're in fullscreen mode OR if we were in fullscreen before (for subsequent citations)
      // Use ref to get current fullscreen state (avoids stale closure issues in streaming callbacks)
      const currentFullscreenMode = isFullscreenModeRef.current;
      console.log('🔍 [CITATION] Fullscreen mode check:', { currentFullscreenMode, wasFullscreenBefore: wasFullscreenBeforeCitationRef.current });
      
      if (currentFullscreenMode || wasFullscreenBeforeCitationRef.current) {
        console.log('🎯 [CITATION] Citation clicked in fullscreen mode - switching to 50% width for 50/50 split');
        // Track that we were in fullscreen mode so we can restore it when document preview closes
        // Keep this true for all subsequent citations
        wasFullscreenBeforeCitationRef.current = true;
        setIsExpanded(true);
        // Clear fullscreen mode to allow 50/50 split with document preview
        setIsFullscreenMode(false);
        // Don't reset isFullscreenFromDashboardRef here - we'll restore it when closing
        setDraggedWidth(null); // Clear any dragged width so 50vw takes effect
        lockedWidthRef.current = '50vw';
        
        // Notify parent of width change
        if (onChatWidthChange) {
          const newWidth = window.innerWidth * 0.5;
          onChatWidthChange(newWidth);
        }
      } else if (isFirstCitationRef.current) {
        // If not in fullscreen, we weren't in fullscreen before
        wasFullscreenBeforeCitationRef.current = false;
        // If not in fullscreen but first citation, still expand to 50% if collapsed
        console.log('🎯 [CITATION] First citation clicked - expanding chat panel to 50% width for 50/50 split');
        setIsExpanded(true);
        setDraggedWidth(null); // Clear any dragged width so 50vw takes effect
        lockedWidthRef.current = '50vw';
        isFirstCitationRef.current = false; // Mark that we've seen a citation
        
        // Notify parent of width change
        if (onChatWidthChange) {
          const newWidth = window.innerWidth * 0.5;
          onChatWidthChange(newWidth);
        }
      } else {
        // If not in fullscreen and not first citation, we weren't in fullscreen before
        wasFullscreenBeforeCitationRef.current = false;
      }

      // Always open in standalone ExpandedCardView (preferred layout)
      // Even without highlight data, use StandaloneExpandedCardView instead of DocumentPreviewModal
      console.log('📚 [CITATION] Opening in standalone ExpandedCardView:', {
        docId: docId,
        filename: citationData.original_filename,
        hasHighlight: !!highlightData,
        highlight: highlightData
      });
      openExpandedCardView(docId, citationData.original_filename || 'document.pdf', highlightData || undefined);
      
      console.log('✅ Document opened in viewer:', {
        filename: citationData.original_filename,
        docId: docId,
        fileId: fileData.id,
        hasHighlight: !!highlightData,
        highlightPage: highlightData?.bbox?.page,
        highlightBbox: highlightData?.bbox
      });
    } catch (error: any) {
      console.error('❌ Error opening citation document:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to open document",
        variant: "destructive",
      });
    }
  }, [previewFiles, preloadFile, openExpandedCardView, toast, isFullscreenMode, onChatWidthChange]);
  
  // Initialize textarea height on mount
  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      const initialHeight = inputRef.current.scrollHeight;
      initialScrollHeightRef.current = initialHeight;
      inputRef.current.style.height = `${initialHeight}px`;
    }
  }, []);

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
      // If restoreChatId is provided, restore that chat from history
      if (restoreChatId) {
        const chat = getChatById(restoreChatId);
        if (chat && chat.messages) {
          // Convert history messages to ChatMessage format
          // CRITICAL: Use index in map to ensure unique IDs even if Date.now() is the same
          const restoredMessages: ChatMessage[] = chat.messages.map((msg: any, idx: number) => {
            // Use index + timestamp + random to guarantee uniqueness
            const uniqueId = `restored-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 9)}`;
            return {
              id: uniqueId,
              type: msg.role === 'user' ? 'query' : 'response',
              text: msg.content || '',
              attachments: msg.attachments || [],
              propertyAttachments: msg.propertyAttachments || [],
              citations: msg.citations || {}, // Restore citations for clickable buttons
              isLoading: false
            };
          });
          
          setChatMessages(restoredMessages);
          persistedChatMessagesRef.current = restoredMessages;
          restoredMessageIdsRef.current = new Set(restoredMessages.map(m => m.id));
          return;
        }
      }
      
      // If we have persisted messages, restore them (no animation)
      // BUT only if we're not starting a fresh chat (check if query is empty and no persisted messages)
      if (persistedChatMessagesRef.current.length > 0 && (!query || !query.trim())) {
        setChatMessages(persistedChatMessagesRef.current);
        // Track which messages were restored so they don't animate
        restoredMessageIdsRef.current = new Set(persistedChatMessagesRef.current.map(m => m.id));
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
      if (query && query.trim()) {
        const queryText = query.trim();
        
        // CRITICAL: Don't process if:
        // 1. Another useEffect is already processing this query
        // 2. This query was already processed (check lastProcessedQueryRef)
        // 3. Query is already in chat messages
        if (isProcessingQueryRef.current) {
          console.log('⏳ SideChatPanel: Query already being processed by another useEffect, skipping');
          return;
        }
        
        if (queryText === lastProcessedQueryRef.current) {
          console.log('⏳ SideChatPanel: Query already processed in first useEffect, skipping');
          return;
        }
        
        const isAlreadyInMessages = chatMessages.some(msg => 
          msg.type === 'query' && msg.text === queryText
        );
        
        if (isAlreadyInMessages) {
          console.log('⏳ SideChatPanel: Query already in messages, skipping');
          return;
        }
        
        // Mark as processing to prevent duplicate API calls
        isProcessingQueryRef.current = true;
        lastProcessedQueryRef.current = queryText;
        
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
                  
                  // Update state with markdown blocks - StreamingResponseText will complete and render formatted output
                  setChatMessages(prev => prev.map(msg => 
                    msg.id === loadingResponseId 
                      ? { ...msg, text: cleanedText }
                      : msg
                  ));
                  
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
            
            // Create AbortController for this query
            const abortController = new AbortController();
            abortControllerRef.current = abortController;
            
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
                console.error('❌ SideChatPanel: Streaming error for initial query:', error);
                
                // Hide bot status overlay on error
                setIsBotActive(false);
                
                setChatMessages(prev => {
                  const existingMessage = prev.find(msg => msg.id === loadingResponseId);
                const errorMessage: ChatMessage = {
                  id: loadingResponseId,
                  type: 'response',
                  text: `Sorry, I encountered an error while processing your query. Please try again or contact support if the issue persists. Error: ${error}`,
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
              abortController.signal,
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
                
                // Accumulate citation locally - will be applied in onComplete
                accumulatedCitations[citationNumStr] = {
                  doc_id: citation.data.doc_id,
                  page: citation.data.page || citation.data.page_number || 0,
                  bbox: finalBbox,
                  method: citation.data.method,
                  block_id: citation.data.block_id,
                  original_filename: citation.data.original_filename
                };
              },
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
                    }
                    break;
                  case 'highlight_bbox':
                    // Legacy: highlight_bbox is now combined into open_document
                    console.log('⚠️ [AGENT_ACTION] Legacy highlight_bbox received (initial)');
                    break;
                  case 'navigate_to_property':
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
                      const navMinWidth = 380;
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
                      const pinNavMinWidth = 380;
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
              isAgentModeRef.current // Pass agent mode to backend for tool-based actions
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
  }, [isVisible, query, restoreChatId, getChatById]);



  // Handle textarea change with auto-resize logic
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    
    setInputValue(value);
    
    // Always stay in multi-line layout, just adjust height
    if (inputRef.current) {
      // Store current height before measurement to maintain it during transition
      const currentHeight = inputRef.current.offsetHeight;
      
      // Temporarily set height to auto to measure scrollHeight
      // Use a single synchronous operation to minimize layout shift
      const previousHeight = inputRef.current.style.height;
      inputRef.current.style.height = 'auto';
      const scrollHeight = inputRef.current.scrollHeight;
      const maxHeight = 120;
      const newHeight = Math.max(24, Math.min(scrollHeight, maxHeight)); // Ensure minimum 24px
      
      // Set new height immediately - this happens in the same frame
      // Disable transition temporarily to prevent expansion animation
      inputRef.current.style.transition = 'none';
      inputRef.current.style.height = `${newHeight}px`;
      inputRef.current.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
      inputRef.current.style.minHeight = '24px';
      
      // If height didn't change, restore previous style to prevent any reflow
      if (Math.abs(newHeight - currentHeight) < 1) {
        inputRef.current.style.height = previousHeight || '24px';
      }
      
      // Re-enable transition after a brief delay (only for visual polish, not for initial expansion)
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.style.transition = '';
        }
      });
      
      if (!isDeletingRef.current && cursorPos !== null) {
        inputRef.current.setSelectionRange(cursorPos, cursorPos);
      }
    }
  };

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
    e.preventDefault();
    e.stopPropagation();
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
    e.stopPropagation();
    
    // Check if this is a document from FilingSidebar (has application/json type) or regular files
    const hasFilingSidebarDocument = e.dataTransfer.types.includes('application/json');
    const hasFiles = e.dataTransfer.types.includes('Files');
    
    if (hasFilingSidebarDocument || hasFiles) {
      e.dataTransfer.dropEffect = 'move';
      setIsDragOver(true);
    } else {
      e.dataTransfer.dropEffect = 'none';
      setIsDragOver(false);
    }
  }, []);

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    // Only clear drag state if we're actually leaving the drop zone
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!e.currentTarget.contains(relatedTarget)) {
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitted = inputValue.trim();
    
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
      
      // Get selected document IDs and names if selection mode was used
      const selectedDocIds = selectedDocumentIds.size > 0 
        ? Array.from(selectedDocumentIds) 
        : undefined;
      
      // Try to get document names from property attachments if available
      let selectedDocNames: string[] | undefined = undefined;
      if (selectedDocIds && selectedDocIds.length > 0 && propertiesToStore.length > 0) {
        // Get documents from the first property attachment
        const property = propertiesToStore[0].property as any;
        if (property?.propertyHub?.documents) {
          selectedDocNames = selectedDocIds
            .map(docId => {
              const doc = property.propertyHub.documents.find((d: any) => d.id === docId);
              return doc?.original_filename;
            })
            .filter((name): name is string => !!name);
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
        fromCitation: !!citationContext, // Mark if query came from citation
        citationBboxData: citationContext ? {
          document_id: citationContext.document_id,
          page_number: citationContext.page_number,
          bbox: citationContext.bbox,
          original_filename: citationContext.original_filename,
          block_id: (citationContext as any).block_id || undefined
        } : undefined
      };
      
      console.log('💬 SideChatPanel: Adding query message:', newQueryMessage);
      console.log('🔍 SideChatPanel: Property attachments in message:', newQueryMessage.propertyAttachments);
      
      // Reset first citation flag if this is a new chat session (no previous messages)
      const isNewChatSession = chatMessages.length === 0;
      if (isNewChatSession) {
        isFirstCitationRef.current = true;
        console.log('🔄 [CITATION] New chat session detected - resetting first citation flag');
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
                
                // Update state with markdown blocks - StreamingResponseText will complete and render formatted output
                setChatMessages(prev => prev.map(msg => 
                  msg.id === loadingResponseId 
                    ? { ...msg, text: cleanedText }
                    : msg
                ));
                
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
          
          // Create AbortController for this query
          const abortController = new AbortController();
          abortControllerRef.current = abortController;
          
          // Convert selected document IDs to array
          const documentIdsArray = selectedDocumentIds.size > 0 
            ? Array.from(selectedDocumentIds) 
            : undefined;
          
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
          const submittedQuery = submitted || '';
          
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
          
          await backendApi.queryDocumentsStreamFetch(
            submittedQuery,
            propertyId,
            messageHistory,
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
                  citationKeys: Object.keys(mergedCitations)
                });
                
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
              console.error('❌ SideChatPanel: Streaming error:', error);
              
              // Hide bot status overlay on error
              setIsBotActive(false);
              
              // Check if this is an attachment without query error
              const isQueryRequiredError = error.includes('Query is required') || 
                                         error.includes('HTTP 400') || 
                                         error.includes('BAD REQUEST');
              const isEmptyQuery = !submittedQuery || submittedQuery.trim() === '';
              
              let errorText: string;
              if (hasAttachmentsForError && (isQueryRequiredError || isEmptyQuery)) {
                // Show helpful prompt for attachments without query
                errorText = `I see you've attached a file, but I need a question to help you with it. Please tell me what you'd like to know about the document.`;
              } else {
                // Show generic error for other cases
                errorText = `Sorry, I encountered an error while processing your query. Please try again or contact support if the issue persists. Error: ${error}`;
              }
              
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
            },
            // onStatus: Show status messages
            (message: string) => {
              console.log('📊 SideChatPanel: Status:', message);
              // Update bot status overlay with current activity
              setBotActivityMessage(message);
            },
            // abortSignal: Pass abort signal for cancellation
            abortController.signal,
            // documentIds: Pass selected document IDs to filter search
            documentIdsArray,
            // onReasoningStep: Handle reasoning step events
            (step: { step: string; action_type?: string; message: string; count?: number; details: any }) => {
              console.log('🟡 SideChatPanel: Received reasoning step:', step);
              
              // FILTER: Skip "Opening citation view" reasoning step during navigation
              // Navigation queries should not show document opening steps
              if (isNavigatingTaskRef.current && 
                  (step.step === 'agent_open_document' || 
                   step.message?.toLowerCase().includes('opening citation view') ||
                   step.message?.toLowerCase().includes('highlighting content'))) {
                console.log('⏭️ [REASONING_STEP] Skipping document opening step - navigation in progress');
                return; // Don't add this reasoning step to the UI
              }
              
              // PRELOAD: Extract document IDs from reasoning steps and preload IMMEDIATELY
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
              
              // Preload document in background (no state update)
              const docId = citation.data.doc_id;
              if (docId) {
                preloadDocumentById(docId, citation.data.original_filename);
              }
            },
            // citationContext: Pass structured citation metadata (hidden from user, for LLM)
            // ALWAYS pass citationContext when available - it contains document_id, page_number, block_id
            // for fast-path retrieval when user clicks on a citation
            citationContext || undefined,
            responseMode, // responseMode (from file choice)
            attachmentContext, // attachmentContext (extracted text from files)
            // AGENT-NATIVE: Handle agent actions
            (action: { action: string; params: any }) => {
              console.log('🎯 [AGENT_ACTION] Received action (follow-up):', action);
              
              // Skip agent actions in reader mode - just show citations without auto-opening
              // Use ref to get current mode value (avoids closure issues)
              if (!isAgentModeRef.current) {
                console.log('📖 [READER_MODE] Skipping agent action (follow-up) - reader mode active');
                return;
              }
              
              console.log('✅ [AGENT_MODE] Executing agent action (follow-up):', action.action);
              
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
                  }
                  break;
                case 'highlight_bbox':
                  // Legacy: highlight_bbox is now combined into open_document
                  console.log('⚠️ [AGENT_ACTION] Legacy highlight_bbox received (follow-up)');
                  break;
                case 'navigate_to_property':
                  if (action.params.property_id && onOpenProperty) {
                    onOpenProperty(null, null, action.params.property_id);
                  }
                  break;
                case 'show_map_view':
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
                    const navMinWidth = 380;
                    setIsFullscreenMode(false);
                    setDraggedWidth(navMinWidth);
                    lockedWidthRef.current = null;
                    if (onChatWidthChange) {
                      onChatWidthChange(navMinWidth);
                    }
                    // Map is already rendered behind the chat - shrinking reveals it
                  }, 600);
                  break;
                case 'select_property_pin':
                  // SEQUENCED FLOW for follow-up
                  console.log('📍 [AGENT_ACTION] select_property_pin received (follow-up) - queuing:', action.params);
                  // CRITICAL: Set navigation flag IMMEDIATELY to prevent fullscreen restoration
                  isNavigatingTaskRef.current = true;
                  wasFullscreenBeforeCitationRef.current = false;
                  closeExpandedCardView();
                  setTimeout(() => {
                    setAgentTaskActive(true, 'Navigating to property...');
                    setMapNavigating(true);
                    const pinNavMinWidth = 380;
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
            isAgentModeRef.current // Pass agent mode to backend for tool-based actions
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
      
      // Submit the query text (attachments can be handled separately if needed)
      onQuerySubmit(submitted);
      setInputValue("");
      setAttachedFiles([]); // Clear attachments after submit
      
      // Clear document selection after query is submitted
      if (selectedDocumentIds.size > 0) {
        clearSelectedDocuments();
        setDocumentSelectionMode(false); // Exit selection mode
      }
      
      // Clear property attachments after they've been stored in the message
      // Use a small delay to ensure the message is fully rendered first
      if (propertiesToStore.length > 0) {
        setTimeout(() => {
          clearPropertyAttachments();
          setSelectionModeActive(false);
        }, 100); // Small delay to ensure message is rendered
      }
      setIsSubmitted(false);
      // Don't switch setIsMultiLine(false) - stay in multi-line layout
      
      // Reset textarea
      if (inputRef.current) {
        const initialHeight = initialScrollHeightRef.current ?? 24;
        inputRef.current.style.height = `${initialHeight}px`;
        inputRef.current.style.overflowY = '';
        inputRef.current.style.overflow = '';
      }
    }
  };
  
  const hasContent = inputValue.trim().length > 0;
  
  // CRITICAL: This useMemo MUST be at top level (not inside JSX) to follow React's Rules of Hooks
  // This fixes "Rendered more hooks than during the previous render" error
  const renderedMessages = useMemo(() => {
    const validMessages = (Array.isArray(chatMessages) ? chatMessages : [])
      .map((message, idx) => ({ message, idx }))
      .filter(({ message }) => message && typeof message === 'object');
    
    if (validMessages.length === 0) return [];
    
    return validMessages.map(({ message, idx }) => {
      const finalKey = message.id || `msg-${idx}`;
      const isRestored = message.id && restoredMessageIdsRef.current.has(message.id);
      
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
            {message.selectedDocumentIds?.length > 0 && (() => {
              // Get the first selected document from property attachments
              // First try from message, then from current context
              let selectedDoc: any = null;
              let propertySource: any = null;
              
              // Try message property attachments first
              if (message.propertyAttachments && message.propertyAttachments.length > 0) {
                propertySource = message.propertyAttachments[0].property as any;
                if (propertySource?.propertyHub?.documents && message.selectedDocumentIds.length > 0) {
                  selectedDoc = propertySource.propertyHub.documents.find((d: any) => d.id === message.selectedDocumentIds[0]);
                }
              }
              
              // If not found in message, try current context property attachments
              if (!selectedDoc && propertyAttachments && propertyAttachments.length > 0) {
                propertySource = propertyAttachments[0].property as any;
                if (propertySource?.propertyHub?.documents && message.selectedDocumentIds.length > 0) {
                  selectedDoc = propertySource.propertyHub.documents.find((d: any) => d.id === message.selectedDocumentIds[0]);
                }
              }
              
              // If still not found, try to get from preloaded files cache
              if (!selectedDoc && propertySource?.id) {
                const preloadedFiles = (window as any).__preloadedPropertyFiles?.[propertySource.id];
                if (preloadedFiles && Array.isArray(preloadedFiles) && message.selectedDocumentIds.length > 0) {
                  selectedDoc = preloadedFiles.find((d: any) => d.id === message.selectedDocumentIds[0]);
                }
              }
              
              if (!selectedDoc) {
                // Fallback to text display if document not found
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 10px', backgroundColor: 'transparent', borderRadius: '6px', fontSize: '13px', color: '#6B7280', marginBottom: '3px' }}>
                    <FileCheck size={14} style={{ flexShrink: 0, color: '#9CA3AF' }} />
                    <span style={{ fontWeight: 400 }}>
                      {message.selectedDocumentIds.length === 1 && message.selectedDocumentNames?.length > 0
                        ? message.selectedDocumentNames[0]
                        : `${message.selectedDocumentIds.length} document${message.selectedDocumentIds.length === 1 ? '' : 's'} selected`}
                    </span>
                  </div>
                );
              }
              
              // Get document cover URL
              const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
              const getDownloadUrl = (doc: any) => {
                if (doc.url || doc.download_url || doc.file_url || doc.s3_url) {
                  return doc.url || doc.download_url || doc.file_url || doc.s3_url;
                } else if (doc.s3_path) {
                  return `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(doc.s3_path)}`;
                } else {
                  return `${backendUrl}/api/files/download?document_id=${doc.id}`;
                }
              };
              
              const coverUrl = getDownloadUrl(selectedDoc);
              const cachedCover = (window as any).__preloadedDocumentCovers?.[selectedDoc.id];
              const fileType = (selectedDoc as any).file_type || '';
              const fileName = selectedDoc.original_filename.toLowerCase();
              const isImage = fileType.includes('image') || fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i);
              const isPDF = fileType.includes('pdf') || fileName.endsWith('.pdf');
              const isDOC = fileType.includes('word') || fileName.match(/\.(docx?|doc)$/i);
              const hasDocxPreview = cachedCover?.isDocx && cachedCover?.url;
              
              return (
                <div style={{ 
                  width: '120px', 
                  height: '160px', 
                  borderRadius: '8px', 
                  overflow: 'hidden',
                  border: '1px solid rgba(229, 231, 235, 0.6)',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                  marginBottom: '2px',
                  position: 'relative',
                  backgroundColor: '#f9fafb'
                }}>
                  {isImage ? (
                    <img 
                      src={coverUrl} 
                      className="w-full h-full object-cover"
                      alt={selectedDoc.original_filename}
                      loading="lazy"
                      style={{ pointerEvents: 'none' }}
                    />
                  ) : isPDF ? (
                    <div className="w-full h-full relative bg-gray-50">
                      <iframe
                        src={`${coverUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                        className="w-full h-[150%] -mt-[2%] border-none opacity-90 pointer-events-none scale-100 origin-top relative z-[1] bg-white"
                        title="preview"
                        loading="lazy"
                        scrolling="no"
                        style={{ contain: 'layout style paint' }}
                      />
                      <div className="absolute inset-0 bg-transparent z-10" />
                    </div>
                  ) : isDOC && hasDocxPreview ? (
                    <div className="w-full h-full relative bg-white overflow-hidden" style={{ contain: 'layout style paint' }}>
                      <iframe
                        src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(cachedCover.url)}&action=embedview&wdStartOn=1`}
                        className="w-full h-full border-none"
                        title="preview"
                        loading="lazy"
                        style={{ contain: 'layout style paint' }}
                      />
                    </div>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gray-50">
                      <FileText className="w-8 h-8 text-gray-300" />
                    </div>
                  )}
                </div>
              );
            })()}
            {/* BBOX Preview for citation queries */}
            {message.fromCitation && message.citationBboxData && (
              <div style={{ marginBottom: '8px' }}>
                <CitationBboxPreview 
                  citationBboxData={message.citationBboxData}
                  onClick={handleCitationPreviewClick}
                />
              </div>
            )}
            <div style={{ backgroundColor: '#F5F5F5', borderRadius: '8px', padding: '4px 10px', border: 'none', boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)', width: '100%', wordWrap: 'break-word', overflowWrap: 'break-word', display: 'block', maxWidth: '100%', boxSizing: 'border-box' }}>
              {message.attachments?.length > 0 && (
                <div style={{ marginBottom: (message.text || message.propertyAttachments?.length > 0) ? '8px' : '0', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {message.attachments.map((attachment, i) => (
                    <QueryAttachment key={attachment.id || attachment.name || `att-${i}`} attachment={attachment} />
                  ))}
                </div>
              )}
              {message.propertyAttachments?.length > 0 && (
                <div style={{ marginBottom: message.text ? '8px' : '0', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {message.propertyAttachments.map((prop, i) => (
                    <QueryPropertyAttachment 
                      key={prop.id ?? prop.property?.id ?? prop.address ?? `prop-${i}`}
                      attachment={prop}
                      onOpenProperty={(att) => onOpenProperty?.(att.address, att.property?.latitude && att.property?.longitude ? { lat: att.property.latitude, lng: att.property.longitude } : undefined, att.property?.id || att.propertyId)}
                    />
                  ))}
                </div>
              )}
              {message.text && (
                <div
                  style={{
                    color: '#0D0D0D',
                    fontSize: '14px',
                    lineHeight: '20px',
                    margin: 0,
                    padding: 0,
                    textAlign: 'left', 
                    fontFamily: 'system-ui, -apple-system, sans-serif', 
                    width: '100%', 
                    maxWidth: '100%', 
                    boxSizing: 'border-box', 
                    display: 'flex', 
                    alignItems: 'flex-start', 
                    gap: '8px',
                    cursor: isTruncated ? 'pointer' : 'default',
                    wordWrap: 'break-word',
                    overflowWrap: 'break-word',
                    minWidth: 0, // Allow flex item to shrink
                    position: 'relative'
                  }}
                  onClick={isTruncated ? handleCitationPreviewClick : undefined}
                  title={isTruncated ? 'Click to view citation' : undefined}
                  onMouseEnter={() => setHoveredQueryId(finalKey)}
                  onMouseLeave={() => setHoveredQueryId(null)}
                >
                  {message.fromCitation && (
                    <TextCursorInput size={16} style={{ flexShrink: 0, color: '#6B7280', marginTop: '3px' }} />
                  )}
                  <div style={{ 
                    textDecoration: isTruncated ? 'underline' : 'none',
                    textDecorationStyle: isTruncated ? ('dotted' as const) : undefined,
                    textUnderlineOffset: '3px',
                    flex: 1,
                    minWidth: 0, // Allow flex item to shrink and wrap
                    wordWrap: 'break-word',
                    overflowWrap: 'break-word',
                    position: 'relative',
                    display: 'inline-block'
                  }}>
                  <ReactMarkdown components={{
                    p: ({ children }) => <p style={{ margin: 0, padding: 0, display: 'block', wordWrap: 'break-word', overflowWrap: 'break-word' }}>{children}</p>,
                    h1: ({ children }) => <h1 style={{ fontSize: '18px', fontWeight: 600, margin: '14px 0 10px 0' }}>{children}</h1>,
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
                  </div>
                  {/* Hover Copy Button - positioned inline next to text */}
                  {hoveredQueryId === finalKey && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.15 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyQuery(message.text || '', finalKey);
                      }}
                      style={{
                        marginLeft: '8px',
                        backgroundColor: '#374151',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '4px 8px',
                        fontSize: '12px',
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                        fontWeight: 400,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        whiteSpace: 'nowrap',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12)',
                        flexShrink: 0,
                        alignSelf: 'flex-start',
                        marginTop: '2px'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#4B5563';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '#374151';
                      }}
                    >
                      {copiedQueryId === finalKey ? (
                        <span>Copied</span>
                      ) : (
                        <>
                          <Copy size={12} style={{ flexShrink: 0 }} />
                          <span>Copy</span>
                        </>
                      )}
                    </motion.button>
                  )}
                </div>
              )}
            </div>
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
          position: 'relative',
          contain: 'layout style'
          // Padding is handled by parent content wrapper (32px left/right)
        }}>
          <div style={{ 
            position: 'relative',
            minHeight: '1px' // Prevent collapse
          }}>
          {message.reasoningSteps?.length > 0 && (showReasoningTrace || message.isLoading) && (
            <ReasoningSteps key={`reasoning-${finalKey}`} steps={message.reasoningSteps} isLoading={message.isLoading} hasResponseText={!!message.text} isAgentMode={isAgentMode} />
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
              contain: 'layout style paint' // Prevent layout shifts
            }}>
              <StreamingResponseText
                text={message.text}
                isStreaming={message.isLoading || false} // Allow streaming to continue
                citations={message.citations}
                handleCitationClick={handleCitationClick}
                renderTextWithCitations={renderTextWithCitations}
                onTextUpdate={scrollToBottom}
                messageId={finalKey}
              />
            </div>
          )}
        </div>
      );
    }).filter(Boolean);
  }, [chatMessages, showReasoningTrace, restoredMessageIdsRef, handleCitationClick, onOpenProperty, scrollToBottom, expandedCardViewDoc, propertyAttachments]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="side-chat-panel"
          ref={panelRef}
          initial={shouldExpand ? { opacity: 0 } : { x: -400, opacity: 0 }} // No slide animation if opening in fullscreen
          animate={{ 
            x: 0, 
            opacity: 1
          }}
          exit={{ x: -400, opacity: 0 }}
          transition={shouldExpand ? { duration: 0 } : { 
            duration: 0.2,
            ease: [0.4, 0, 0.2, 1]
          }} // Instant if opening in fullscreen
          layout={!shouldExpand} // Disable layout animation when opening in fullscreen
          className="fixed top-0 bottom-0 z-30"
          style={{
            left: `${sidebarWidth}px`, // Always positioned after sidebar
            width: (() => {
              // PRIORITY 1: If draggedWidth is set (e.g., during navigation), use it
              // This takes precedence over fullscreen to allow navigation tasks to shrink the chat
              if (draggedWidth !== null) {
                return `${draggedWidth}px`;
              }
              // PRIORITY 2: If opening in fullscreen mode (shouldExpand from dashboard), start at fullscreen width immediately
              // Check shouldExpand directly (don't wait for isFullscreenMode to be set) to prevent initial 450px flash
              if (shouldExpand && !isPropertyDetailsOpen) {
                return `calc(100vw - ${sidebarWidth}px)`;
              }
              if (isExpanded) {
                // Use fullscreen width if fullscreen mode is enabled AND (property details is closed OR user manually requested fullscreen)
                if (isFullscreenMode && (!isPropertyDetailsOpen || isManualFullscreenRef.current)) {
                  return `calc(100vw - ${sidebarWidth}px)`;
                }
                return lockedWidthRef.current || (isPropertyDetailsOpen ? '35vw' : '50vw');
              }
              return '450px';
            })(),
            backgroundColor: '#FCFCF9',
            boxShadow: 'none',
            transition: (isResizing || justEnteredFullscreen || shouldExpand || isRestoringFullscreen || (isFullscreenMode && !isRestoringFullscreen)) ? 'none' : 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)', // Disable transition while resizing, entering fullscreen initially, restoring from citation, or when in fullscreen mode
            willChange: 'width', // Optimize for smooth width changes
            backfaceVisibility: 'hidden', // Prevent flickering
            transform: 'translateZ(0)' // Force GPU acceleration
          }}
        >
          {/* Drag handle for resizing from right edge - available in both expanded and collapsed states */}
          <div
            onMouseDown={handleResizeStart}
            style={{
              position: 'absolute',
              right: '-2px', // Extend slightly beyond the edge for easier grabbing
              top: 0,
              bottom: 0,
              width: '12px', // Wider handle for better visibility and easier grabbing
              cursor: 'ew-resize',
              zIndex: 10000, // Higher than PropertyDetailsPanel (9999) to ensure line is always visible
              backgroundColor: 'transparent', // No background color
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'auto', // Ensure it captures mouse events
            }}
          >
            {/* Faint line to distinguish the boundary between chat and property details panel */}
            <div
              style={{
                width: '1px',
                height: '100%',
                backgroundColor: 'rgba(156, 163, 175, 0.3)', // Faint gray line - more visible than before
                position: 'relative',
                zIndex: 10000, // Ensure line is above property details panel
              }}
            />
          </div>
          
          {/* Panel content will go here */}
          <div 
            className="h-full flex flex-col"
            style={{
              // Hide content briefly when opening in fullscreen to prevent flash
              opacity: (shouldExpand && !isFullscreenMode) ? 0 : 1,
              transition: (shouldExpand && !isFullscreenMode) ? 'none' : 'opacity 0.05s ease-in',
              visibility: (shouldExpand && !isFullscreenMode) ? 'hidden' : 'visible',
              position: 'relative',
              backgroundColor: '#FCFCF9', // Ensure solid background to prevent leaks
              overflow: 'hidden', // Prevent content from leaking during transitions
              width: '100%',
              height: '100%'
            }}
          >
            {/* Header */}
            <div className="py-4 pr-4 pl-6 relative" style={{ backgroundColor: '#FCFCF9', borderBottom: 'none', position: 'relative', zIndex: 10 }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={onSidebarToggle}
                    className={`flex items-center ${inputContainerWidth >= 450 ? 'gap-1.5 px-2 py-1 rounded-full' : 'justify-center w-8 h-8 rounded-md'} text-slate-600 hover:text-slate-700 border border-slate-200/60 hover:border-slate-300/80 bg-white/70 hover:bg-slate-50/80 transition-all duration-200`}
                    title={isMainSidebarOpen ? "Close sidebar" : "Open sidebar"}
                    type="button"
                    style={{
                      padding: inputContainerWidth < 450 ? '4px' : '4px 8px',
                      height: '24px',
                      minHeight: '24px'
                    }}
                  >
                    {isMainSidebarOpen ? (
                      <PanelRightClose
                        className="w-3.5 h-3.5 scale-x-[-1]"
                        strokeWidth={1.5}
                      />
                    ) : (
                      <PanelLeftOpen className="w-3.5 h-3.5" strokeWidth={1.5} />
                    )}
                    {inputContainerWidth >= 450 && (
                      <span className="text-xs font-medium">
                        {isMainSidebarOpen ? "Close" : "Sidebar"}
                      </span>
                    )}
                  </button>

                  {/* Hide the Files sidebar icon when the main sidebar is open (the control exists there). */}
                  {!isMainSidebarOpen && (
                  <AnimatePresence mode="wait">
                      <motion.button
                        key="folder-icon"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                        onClick={toggleFilingSidebar}
                        className={`flex items-center ${inputContainerWidth >= 450 ? 'gap-1.5 px-2 py-1 rounded-full' : 'justify-center w-8 h-8 rounded-md'} text-slate-600 hover:text-slate-700 border border-slate-200/60 hover:border-slate-300/80 bg-white/70 hover:bg-slate-50/80 transition-colors duration-200`}
                        title="Toggle Files sidebar"
                        type="button"
                        style={{
                          padding: inputContainerWidth < 450 ? '4px' : '4px 8px',
                          height: '24px',
                          minHeight: '24px'
                        }}
                      >
                        <FolderOpen className="w-3.5 h-3.5" strokeWidth={1.5} />
                        {inputContainerWidth >= 450 && (
                          <span className="text-xs font-medium">Files</span>
                        )}
                      </motion.button>
                  </AnimatePresence>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <motion.button
                    onClick={() => {
                      // Save current chat to history if there are messages
                      if (chatMessages.length > 0) {
                        const firstQuery = chatMessages.find(m => m.type === 'query');
                        const preview = firstQuery?.text || 'New chat';
                        addChatToHistory({
                          title: '',
                          timestamp: new Date().toISOString(),
                          preview,
                          messages: chatMessages.map(m => ({
                            role: m.type === 'query' ? 'user' : 'assistant',
                            content: m.text || '',
                            attachments: m.attachments || [],
                            propertyAttachments: m.propertyAttachments || [],
                            citations: m.citations || {} // Include citations for clickable buttons
                          }))
                        });
                      }
                      
                      // Completely clear ALL state for new chat
                      setChatMessages([]);
                      setSubmittedQueries([]);
                      persistedChatMessagesRef.current = [];
                      restoredMessageIdsRef.current = new Set();
                      setInputValue("");
                      setAttachedFiles([]);
                      clearPropertyAttachments();
                      setSelectionModeActive(false);
                      setIsSubmitted(false);
                      setIsFocused(false);
                      // Reset first citation flag for new chat session
                      isFirstCitationRef.current = true;
                      
                      // Reset textarea if it exists
                      if (inputRef.current) {
                        inputRef.current.value = "";
                        inputRef.current.style.height = 'auto';
                      }
                      
                      // Notify parent to clear query prop
                      if (onNewChat) {
                        onNewChat();
                      }
                    }}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    className="flex items-center space-x-1.5 px-2 py-1 border border-slate-200/60 hover:border-slate-300/80 bg-white/70 hover:bg-slate-50/80 rounded-md transition-all duration-200 group"
                    title="New chat"
                  >
                    <Plus className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-700" strokeWidth={1.5} />
                    <span className="text-slate-600 text-xs">
                      New chat
                    </span>
                  </motion.button>
                  
                  {/* Reasoning trace toggle */}
                  <div 
                    className="flex items-center space-x-1.5 px-2 py-1 border border-slate-200/60 bg-white/70 rounded-md"
                    title={showReasoningTrace ? "Reasoning trace will stay visible after response" : "Reasoning trace will hide after response"}
                  >
                    <Footprints className="w-4 h-4 text-slate-600" strokeWidth={1.5} />
                    <button
                      type="button"
                      onClick={() => setShowReasoningTrace(!showReasoningTrace)}
                      className={`relative w-7 h-4 rounded-full transition-colors ${
                        showReasoningTrace ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${
                        showReasoningTrace ? 'translate-x-3' : 'translate-x-0'
                      }`} />
                    </button>
                  </div>
                  
                  <button
                    type="button"
                    onClick={() => {
                      // Get current width in pixels (same logic as drag resizing uses)
                      let currentWidth: number;
                      if (draggedWidth !== null) {
                        currentWidth = draggedWidth;
                      } else if (isExpanded && isFullscreenMode) {
                        // Fullscreen mode from dashboard
                        currentWidth = window.innerWidth - sidebarWidth;
                      } else if (lockedWidthRef.current) {
                        // Convert vw to pixels if locked width is set
                        const vwValue = parseFloat(lockedWidthRef.current);
                        currentWidth = window.innerWidth * (vwValue / 100);
                      } else if (isExpanded) {
                        currentWidth = isPropertyDetailsOpen 
                          ? window.innerWidth * 0.35 
                          : window.innerWidth * 0.5;
                      } else {
                        currentWidth = 450;
                      }
                      
                      // Define threshold: if width is >= 600px, consider it "large" and make it smaller
                      // Otherwise, make it larger (fullscreen)
                      const SMALL_SIZE = 450; // Minimum/collapsed size
                      const THRESHOLD = 600; // Threshold between small and large
                      
                      let newWidth: number;
                      let newExpandedState: boolean;
                      
                      if (currentWidth >= THRESHOLD) {
                        // Currently large - make it smaller
                        newWidth = SMALL_SIZE;
                        newExpandedState = false;
                        // Reset fullscreen mode when collapsing
                        if (isFullscreenMode) {
                          setIsFullscreenMode(false);
                          isFullscreenFromDashboardRef.current = false;
                          isManualFullscreenRef.current = false; // Clear manual fullscreen flag
                        }
                        setDraggedWidth(newWidth);
                      } else {
                        // Currently small - make it fullscreen
                        newExpandedState = true;
                        // Set fullscreen mode (user manually requested)
                        setIsFullscreenMode(true);
                        isFullscreenFromDashboardRef.current = true;
                        isManualFullscreenRef.current = true; // Mark as manual fullscreen request
                        setJustEnteredFullscreen(true);
                        // Clear dragged width so fullscreen width calculation takes effect
                        setDraggedWidth(null);
                        // Calculate fullscreen width for notification
                        newWidth = window.innerWidth - sidebarWidth;
                        // Reset the flag after a short delay
                        setTimeout(() => {
                          setJustEnteredFullscreen(false);
                        }, 100);
                      }
                      
                      setIsExpanded(newExpandedState);
                      lockedWidthRef.current = null; // Clear locked width
                      
                      // Notify parent of width change
                      if (onChatWidthChange) {
                        onChatWidthChange(newWidth);
                      }
                    }}
                    className="flex items-center justify-center p-1.5 border rounded-md transition-all duration-200 group border-slate-200/60 hover:border-slate-300/80 bg-white/70 hover:bg-slate-50/80 focus:outline-none outline-none"
                    style={{
                      marginLeft: '4px'
                    }}
                    title={(() => {
                      // Calculate current width using same logic as onClick
                      let currentWidth: number;
                      if (draggedWidth !== null) {
                        currentWidth = draggedWidth;
                      } else if (isExpanded && isFullscreenMode) {
                        // Fullscreen mode from dashboard
                        currentWidth = window.innerWidth - sidebarWidth;
                      } else if (lockedWidthRef.current) {
                        const vwValue = parseFloat(lockedWidthRef.current);
                        currentWidth = window.innerWidth * (vwValue / 100);
                      } else if (isExpanded) {
                        currentWidth = isPropertyDetailsOpen 
                          ? window.innerWidth * 0.35 
                          : window.innerWidth * 0.5;
                      } else {
                        currentWidth = 450;
                      }
                      return currentWidth >= 600 ? "Make chat smaller" : "Make chat larger";
                    })()}
                  >
                    {(() => {
                      // Calculate current width using same logic as onClick
                      let currentWidth: number;
                      if (draggedWidth !== null) {
                        currentWidth = draggedWidth;
                      } else if (isExpanded && isFullscreenMode) {
                        // Fullscreen mode from dashboard
                        currentWidth = window.innerWidth - sidebarWidth;
                      } else if (lockedWidthRef.current) {
                        const vwValue = parseFloat(lockedWidthRef.current);
                        currentWidth = window.innerWidth * (vwValue / 100);
                      } else if (isExpanded) {
                        currentWidth = isPropertyDetailsOpen 
                          ? window.innerWidth * 0.35 
                          : window.innerWidth * 0.5;
                      } else {
                        currentWidth = 450;
                      }
                      return currentWidth >= 600 ? (
                      <Minimize2 className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-700 transition-colors" strokeWidth={1.5} />
                    ) : (
                      <MoveDiagonal className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-700 transition-colors" strokeWidth={1.5} />
                      );
                    })()}
                  </button>
                  <button
                    onClick={() => {
                      onMapToggle();
                      closeExpandedCardView(); // Close document preview (Reference agent) when closing chat
                    }}
                    className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-full transition-all"
                    title="Close chat"
                    style={isPropertyDetailsOpen ? { marginRight: '8px' } : undefined}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
            
            {/* Content area - Query bubbles (ChatGPT-like scrollable area) */}
            <div 
              ref={contentAreaRef}
              className="flex-1 overflow-y-auto sidechat-scroll" 
              style={{ 
                backgroundColor: '#FCFCF9',
                padding: '16px 0', // Simplified padding - content will be centered
                // Inset the scroll container slightly so the scrollbar isn't flush against the panel edge
                marginRight: '6px',
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(0, 0, 0, 0.02) transparent',
                minWidth: '300px', // Prevent squishing of content area
                flexShrink: 1, // Allow shrinking but with minWidth constraint
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
                paddingLeft: '32px',
                paddingRight: '32px',
                margin: '0 auto' // Center the content wrapper
              }}>
              <div className="flex flex-col" style={{ minHeight: '100%', gap: '16px', width: '100%' }}>
                <AnimatePresence>
                  {renderedMessages}
                </AnimatePresence>
                {/* Scroll anchor - ensures bottom of response is visible above chat bar */}
                {/* Extra padding ensures content isn't hidden behind chat input when scrolled to bottom */}
                <div ref={messagesEndRef} style={{ height: '120px', minHeight: '120px', flexShrink: 0 }} />
                </div>
              </div>
            </div>
            
            
            {/* Chat Input at Bottom - Condensed SearchBar design */}
            <div 
              ref={chatInputContainerRef}
              style={{ 
                backgroundColor: '#FCFCF9', 
                paddingTop: '16px', 
                paddingBottom: '24px', 
                paddingLeft: '0', // Remove left padding - centering handled by form
                paddingRight: '0', // Remove right padding - centering handled by form
                position: 'relative', 
                overflow: 'visible', // Allow BotStatusOverlay to extend above
                minWidth: '300px', // Prevent squishing of chat input container
                flexShrink: 0, // Prevent flex shrinking
                display: 'flex',
                justifyContent: 'center', // Center the form
                width: '100%',
                zIndex: 5 // Ensure input area is above content area
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
                style={{ 
                  overflow: 'visible', 
                  height: 'auto', 
                  width: '100%', 
                  display: 'flex', 
                  justifyContent: 'center', 
                  alignItems: 'center',
                  position: 'relative',
                  // Match content wrapper padding to align chatbar with text display
                  paddingLeft: '32px',
                  paddingRight: '32px'
                }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {/* Wrapper for chat bar + overlay to enable proper z-index stacking */}
                <div style={{ position: 'relative', width: 'min(100%, 640px)', minWidth: '300px' }}>
                  {/* Bot Status Overlay - sits BEHIND the chat bar */}
                  <BotStatusOverlay
                    isActive={isBotActive}
                    activityMessage={botActivityMessage}
                    isPaused={isBotPaused}
                    onPauseToggle={handlePauseToggle}
                  />
                  {/* Chat bar - sits ON TOP of the overlay */}
                  <div 
                    className={`relative flex flex-col ${isSubmitted ? 'opacity-75' : ''}`}
                    style={{
                      background: isDragOver ? '#F5F5F5' : '#ffffff',
                      border: isDragOver ? '2px dashed #4B5563' : '1px solid #E5E7EB',
                      boxShadow: isDragOver 
                        ? '0 4px 12px 0 rgba(75, 85, 99, 0.15), 0 2px 4px 0 rgba(75, 85, 99, 0.1)' 
                        : '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
                      position: 'relative',
                      paddingTop: '8px', // Default padding top
                      paddingBottom: '8px', // Default padding bottom
                      paddingRight: '12px',
                      paddingLeft: '12px',
                      overflow: 'visible',
                      width: '100%',
                      height: 'auto',
                      minHeight: '48px', // Fixed minimum height to prevent expansion when typing starts
                      boxSizing: 'border-box',
                      borderRadius: '12px', // Original rounded square corners
                      transition: 'background-color 0.2s ease-in-out, border-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
                      zIndex: 1, // Above the bot status overlay
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
                      
                      {/* Property Attachments Display - Must be motion.div for AnimatePresence */}
                      {propertyAttachments.length > 0 && (
                        <motion.div 
                          key={generateUniqueKey('PropertyAttachmentsContainer', 'main', propertyAttachments.length)}
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
                          {propertyAttachments.map((property, propertyIdx) => {
                            const primaryId = property.id ?? property.property?.id;
                            const primaryKey = typeof primaryId === 'number' ? primaryId.toString() : primaryId;
                            return (
                            <PropertyAttachment
                              key={generateAnimatePresenceKey(
                                'PropertyAttachment',
                                propertyIdx,
                                primaryKey || property.address,
                                'property'
                              )}
                              attachment={property}
                              onRemove={removePropertyAttachment}
                            />
                          );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                    
                    {/* Textarea area - always above */}
                    <div 
                      className="flex items-start w-full"
                      style={{ 
                        minHeight: '24px', // Minimum height matches textarea minHeight
                        height: 'auto', // Allow growth but maintain minimum
                        width: '100%',
                        marginTop: '4px', // Additional padding above textarea
                        marginBottom: '12px', // Fixed margin - don't change when typing
                        flexShrink: 0 // Prevent shrinking
                      }}
                    >
                      <div className="flex-1 relative flex items-start w-full" style={{ 
                        overflow: 'visible', 
                        minHeight: '24px',
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
                          placeholder={selectedDocumentIds.size > 0 
                            ? `Searching in ${selectedDocumentIds.size} selected document${selectedDocumentIds.size > 1 ? 's' : ''}...`
                            : "Ask anything..."}
                          className="w-full bg-transparent focus:outline-none font-normal text-gray-900 resize-none [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200/50 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:hover:bg-gray-300/70 [&::placeholder]:text-[#8E8E8E]"
                          style={{
                            height: '24px', // Fixed initial height to prevent layout shift when typing starts
                            minHeight: '24px',
                            maxHeight: '140px',
                            fontSize: '14px',
                            lineHeight: '20px',
                            paddingTop: '0px',
                            paddingBottom: '0px',
                            paddingRight: '8px',
                            paddingLeft: '8px',
                            scrollbarWidth: 'thin',
                            scrollbarColor: 'rgba(229, 231, 235, 0.5) transparent',
                            overflow: 'hidden',
                            overflowY: 'auto',
                            wordWrap: 'break-word',
                            transition: 'none', // Remove transition to prevent expansion animation
                            resize: 'none',
                            width: '100%',
                            minWidth: '0',
                            color: inputValue ? '#0D0D0D' : undefined,
                            boxSizing: 'border-box' // Ensure padding is included in height calculation
                          }}
                          autoComplete="off"
                          disabled={isSubmitted}
                          rows={1}
                        />
                        
                        {/* Property Search Results Popup - positioned ABOVE the textarea */}
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
                      </div>
                    </div>
                    
                    {/* Bottom row: Icons (Left) and Send Button (Right) */}
                    <div
                      className="relative flex items-center justify-between w-full"
                      style={{
                        width: '100%',
                        minWidth: '0',
                        minHeight: '32px'
                      }}
                    >
                      {/* Left Icons: Mode Selector and Minimize Chat Button */}
                      <div className="flex items-center space-x-2">
                        {/* Mode Selector Dropdown */}
                        {/* - Fullscreen: normal size text (no props)
                            - 50/50 split (wider): small text (small={true})
                            - Smallest width (450px or close): icon only (compact={true}) */}
                        {(() => {
                          // Calculate current width for mode selector logic
                          const currentWidth = draggedWidth !== null 
                            ? draggedWidth 
                            : (isFullscreenMode 
                              ? window.innerWidth 
                              : window.innerWidth * 0.5); // Default 50vw in split view
                          
                          // Show icon only when at minimum width (450px) or very close to it
                          const isAtMinWidth = currentWidth <= 500; // Small buffer above 450px min
                          const isCompact = !isFullscreenMode && isAtMinWidth;
                          const isSmall = !isFullscreenMode && !isAtMinWidth;
                          
                          return (
                            <ModeSelector 
                              compact={isCompact}
                              small={isSmall}
                            />
                          );
                        })()}
                        
                        {(() => {
                          // Determine button state:
                          // - If map is visible (side-by-side): Show "Close chat" with MessageCircleDashed
                          // - If fullscreen OR property details OR document preview: Show "Map" with MapPinHouse
                          const showMapButton = isFullscreenMode || isPropertyDetailsOpen || !!expandedCardViewDoc;
                          const showCloseChat = isMapVisible && !showMapButton;
                          // For "Close chat", only show text when chat is big enough to avoid squishing (higher threshold)
                          // For "Map" button, show text when chat is big OR when in fullscreen/property details/document preview
                          // IMPORTANT: When draggedWidth is set, use it as the source of truth (not isExpanded)
                          const actualWidth = draggedWidth !== null ? draggedWidth : (isExpanded ? 600 : 380);
                          const isChatBig = actualWidth > 450;
                          // Much higher threshold for "Close chat" to prevent text from appearing when chat is small (380px)
                          // Only show text when chat is significantly wider than the small size
                          const isChatBigEnoughForCloseChat = actualWidth > 600; // Increased from 550 to 600 to prevent stretching
                          const showText = showCloseChat 
                            ? isChatBigEnoughForCloseChat  // Only show "Close chat" text when chat is big enough
                            : (isChatBig || showMapButton); // Show "Map" text when chat is big OR when showing map button
                          
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                if (showCloseChat && onMinimize && chatMessages.length > 0) {
                                  // Close chat when map is visible
                                  onMinimize(chatMessages);
                                } else if (showMapButton && onMapToggle) {
                                  // Go to map when in fullscreen or property details is open
                                  // Close document preview if it's open
                                  if (expandedCardViewDoc) {
                                    closeExpandedCardView();
                                  }
                                  onMapToggle();
                                } else if (onMinimize && chatMessages.length > 0) {
                                  onMinimize(chatMessages);
                                } else if (onMapToggle) {
                                  // Close document preview if it's open
                                  if (expandedCardViewDoc) {
                                    closeExpandedCardView();
                                  }
                                  onMapToggle();
                                }
                              }}
                              className={`flex items-center flex-shrink-0 ${showText ? 'gap-1.5 px-2 py-1 rounded-full' : 'justify-center p-1.5 border rounded-md'} transition-all duration-200 group focus:outline-none outline-none ${showText ? 'text-gray-900' : 'border-slate-200/50 hover:border-slate-300/70 bg-white/85 hover:bg-white/90 text-slate-600'}`}
                              style={{
                                marginLeft: '4px',
                                ...(showText ? {
                                  backgroundColor: '#FFFFFF',
                                  border: '1px solid rgba(229, 231, 235, 0.6)',
                                  transition: 'background-color 0.2s ease',
                                  height: '24px',
                                  minHeight: '24px',
                                  maxWidth: 'fit-content' // Prevent button from stretching
                                } : {
                                  height: '24px',
                                  minHeight: '24px',
                                  width: '24px' // Fixed width when no text
                                })
                              }}
                              onMouseEnter={(e) => {
                                if (showText) {
                                  e.currentTarget.style.backgroundColor = '#F5F5F5';
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (showText) {
                                  e.currentTarget.style.backgroundColor = '#FFFFFF';
                                }
                              }}
                              title={showCloseChat ? "Close chat" : "Go to map"}
                            >
                              {showCloseChat ? (
                                <MessageCircleDashed className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-700 transition-colors" strokeWidth={2} />
                              ) : (
                                <MapPinHouse className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-700 transition-colors" strokeWidth={2} />
                              )}
                              {showText && (
                                <span className="text-xs font-medium whitespace-nowrap">
                                  {showCloseChat ? 'Close chat' : 'Map'}
                                </span>
                              )}
                            </button>
                          );
                        })()}
                      </div>

                      {/* Right Icons: Attachment, Mic, Send */}
                      <motion.div 
                        className="flex items-center space-x-3 flex-shrink-0" 
                        style={{ marginRight: '4px' }}
                        layout
                        transition={{ 
                          layout: { duration: 0.12, ease: [0.16, 1, 0.3, 1] }, // Quicker return animation when send button disappears
                          default: { duration: 0.18, ease: [0.16, 1, 0.3, 1] } // Normal for other transitions
                        }}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          onChange={handleFileSelect}
                          className="hidden"
                          accept="image/*,.pdf,.doc,.docx"
                        />
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
                              title={
                                selectedDocumentIds.size > 0
                                  ? `${selectedDocumentIds.size} document${selectedDocumentIds.size > 1 ? 's' : ''} selected - Queries will search only these documents. Click to ${isDocumentSelectionMode ? 'exit' : 'enter'} selection mode.`
                                  : isDocumentSelectionMode
                                    ? "Document selection mode active - Click document cards to select"
                                    : "Select documents to search within"
                              }
                            >
                              {selectedDocumentIds.size > 0 ? (
                                <Scan className="w-[18px] h-[18px]" strokeWidth={1.5} />
                              ) : isDocumentSelectionMode ? (
                                <Scan className="w-[18px] h-[18px]" strokeWidth={1.5} />
                              ) : (
                                <SquareDashedMousePointer className="w-[18px] h-[18px]" strokeWidth={1.5} />
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
                        {/* Link and Attach buttons grouped together with smaller gap */}
                        {/* Shrink to icons when property details panel is open and chat is small */}
                        {(() => {
                          // Show only icons when property details is open AND chat is small (not expanded or narrow)
                          const showIconOnly = isPropertyDetailsOpen && (!isExpanded || inputContainerWidth < 450);
                          return (
                            <>
                              <div className="flex items-center gap-1.5">
                                {onQuickStartToggle && (
                                  <button
                                    type="button"
                                    onClick={onQuickStartToggle}
                                    className="flex items-center gap-1.5 px-2 py-1 rounded-full text-gray-900 transition-colors focus:outline-none outline-none"
                                    style={{
                                      backgroundColor: isQuickStartBarVisible ? '#ECFDF5' : '#FFFFFF',
                                      border: isQuickStartBarVisible ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(229, 231, 235, 0.6)',
                                      transition: 'background-color 0.2s ease, border-color 0.2s ease',
                                      padding: showIconOnly ? '4px 6px' : (inputContainerWidth < 450 ? '4px 6px' : '4px 8px'),
                                      height: '24px',
                                      minHeight: '24px'
                                    }}
                                    onMouseEnter={(e) => {
                                      if (!isQuickStartBarVisible) {
                                        e.currentTarget.style.backgroundColor = '#F5F5F5';
                                      }
                                    }}
                                    onMouseLeave={(e) => {
                                      if (!isQuickStartBarVisible) {
                                        e.currentTarget.style.backgroundColor = '#FFFFFF';
                                      }
                                    }}
                                    title="Link document to property"
                                  >
                                    <Workflow className={`w-3.5 h-3.5 ${isQuickStartBarVisible ? 'text-green-500' : ''}`} strokeWidth={1.5} />
                                    {!showIconOnly && inputContainerWidth >= 450 && (
                                    <span className="text-xs font-medium">Link</span>
                                    )}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => fileInputRef.current?.click()}
                                  className="flex items-center gap-1.5 px-2 py-1 rounded-full text-gray-900 transition-colors focus:outline-none outline-none"
                                  style={{
                                    backgroundColor: '#FFFFFF',
                                    border: '1px solid rgba(229, 231, 235, 0.6)',
                                    transition: 'background-color 0.2s ease',
                                    padding: showIconOnly ? '4px 6px' : (inputContainerWidth < 450 ? '4px 6px' : '4px 8px'),
                                    height: '24px',
                                    minHeight: '24px'
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
                                  {!showIconOnly && inputContainerWidth >= 450 && (
                                  <span className="text-xs font-medium">Attach</span>
                                  )}
                                </button>
                              </div>
                              <button
                                type="button"
                                className="flex items-center gap-1.5 px-2 py-1 rounded-full text-gray-900 transition-colors focus:outline-none outline-none"
                                style={{
                                  backgroundColor: '#ECECEC',
                                  transition: 'background-color 0.2s ease',
                                  padding: showIconOnly ? '4px 6px' : (inputContainerWidth < 450 ? '4px 6px' : '4px 8px'),
                                  height: '24px',
                                  minHeight: '24px'
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
                                {!showIconOnly && inputContainerWidth >= 450 && (
                                <span className="text-xs font-medium">Voice</span>
                                )}
                              </button>
                            </>
                          );
                        })()}
                        
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
                                  initial={{ opacity: 0, scale: 0.85, x: 8 }}
                                  animate={{ opacity: 1, scale: 1, x: 0 }}
                                  exit={{ opacity: 0, scale: 0.85, x: 8 }}
                                  transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }} // Quicker exit
                                  className="flex items-center justify-center relative focus:outline-none outline-none"
                                  style={{
                                    width: '28px',
                                    height: '28px',
                                    minWidth: '28px',
                                    minHeight: '28px',
                                    borderRadius: '50%',
                                    border: '1px solid #D1D5DB',
                                    backgroundColor: '#FFFFFF',
                                    flexShrink: 0
                                  }}
                                  whileHover={{ 
                                    scale: 1.05,
                                    backgroundColor: '#F3F4F6',
                                    borderColor: '#9CA3AF'
                                  }}
                                  whileTap={{ 
                                    scale: 0.95
                                  }}
                                  title="Stop generating"
                                >
                                  <Square className="w-2.5 h-2.5" strokeWidth={2} style={{ color: '#000000', fill: '#000000' }} />
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
                                  initial={{ opacity: 0, scale: 0.85, x: 8 }}
                                  animate={{ opacity: 1, scale: 1, x: 0, backgroundColor: '#415C85' }}
                                  exit={{ 
                                    opacity: 0, 
                                    scale: 0.85, 
                                    x: 8,
                                    transition: { duration: 0.12, ease: [0.16, 1, 0.3, 1] } // Quicker exit
                                  }}
                                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                                  className={`flex items-center justify-center relative focus:outline-none outline-none ${!isSubmitted ? '' : 'cursor-not-allowed'}`}
                                  style={{
                                    width: '32px',
                                    height: '32px',
                                    minWidth: '32px',
                                    minHeight: '32px',
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
                      </motion.div>
                    </div>
                  </div>
                  </div>
                </div>
              </form>
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
  );
});



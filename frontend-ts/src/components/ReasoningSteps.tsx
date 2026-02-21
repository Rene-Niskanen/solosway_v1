import React, { useMemo, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { StackedDocumentPreviews } from './DocumentPreviewCard';
import { LLMContextViewer } from './LLMContextViewer';
import { generateAnimatePresenceKey, generateUniqueKey } from '../utils/keyGenerator';
import { ScanText, BookOpenCheck, FileQuestion, Play, FolderOpen, MapPin, Highlighter, Infinity } from 'lucide-react';
import { FileChoiceStep, ResponseModeChoice } from './FileChoiceStep';
import { FileAttachmentData } from './FileAttachment';
import { ThinkingBlock, isTrivialThinkingContent } from './ThinkingBlock';
import { SearchingSourcesCarousel } from './SearchingSourcesCarousel';
import { SEARCHING_CAROUSEL_TYPES } from '../constants/documentTypes';
import { useModel } from '../contexts/ModelContext';
import { useFilingSidebar } from '../contexts/FilingSidebarContext';
import * as pdfjs from 'pdfjs-dist';

// Import worker for PDF.js (same as DocumentPreviewCard)
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set worker source for PDF thumbnail generation during preload
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Types for reasoning steps
export interface ReasoningStep {
  step: string;
  action_type: 'planning' | 'exploring' | 'searching' | 'reading' | 'analysing' | 'summarising' | 'thinking' | 'complete' | 'context' | 'file_choice' | 'executing' | 'opening' | 'navigating' | 'highlighting' | 'opening_map' | 'selecting_pin';
  message: string;
  count?: number;
  target?: string;
  line_range?: string;
  fromCitationClick?: boolean; // Flag to indicate step was added from citation click (show in all modes)
  details?: {
    doc_id?: string;
    document_index?: number;
    filename?: string;
    doc_metadata?: {
      doc_id: string;
      original_filename?: string | null; // Can be null
      classification_type: string;
      page_range?: string;
      page_numbers?: number[];
      s3_path?: string;
      download_url?: string;
    };
    doc_previews?: Array<{
      doc_id: string;
      original_filename?: string | null; // Can be null
      classification_type: string;
      page_range?: string;
      page_numbers?: number[];
      s3_path?: string;
      download_url?: string;
    }>;
    // File choice step specific fields
    attachedFiles?: FileAttachmentData[];
    onFileChoice?: (choice: ResponseModeChoice) => void;
    // LLM context blocks for visualization (Cursor-style reading UI)
    llm_context?: Array<{
      content: string;
      page: number;
      type: string;
      retrieval_method?: string;  // "bm25", "vector", "hybrid", "structured_query", etc.
      similarity_score?: number;   // 0.0 to 1.0
      chunk_index?: number;
      chunk_number?: number;       // 1-indexed position (1, 2, 3...)
      total_chunks?: number;       // Total chunk count
    }>;
    // Thinking step content (streamed from LLM reasoning)
    thinking_content?: string;
    // RESEARCH AGENT: Tool call details (Cursor-style agentic steps)
    tool_name?: string;           // "search_documents", "read_document", etc.
    tool_input?: Record<string, any>;   // Tool input parameters
    tool_output?: Record<string, any>;  // Tool output/results
    status?: 'running' | 'complete' | 'error' | 'read' | 'reading';  // Execution status (includes legacy reading statuses)
    // Searching step: optional source types for carousel (PDF/Word icons)
    source_types?: ('pdf' | 'docx')[];
    source_count?: number;
    [key: string]: any;
  };
  timestamp?: number;
  context?: string; // LLM-generated contextual narration
}

/**
 * Render PDF first page as thumbnail image (for preloading)
 */
const renderPdfThumbnailForPreload = async (arrayBuffer: ArrayBuffer): Promise<string | null> => {
  try {
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return null;
    
    const viewport = page.getViewport({ scale: 0.5 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    await page.render({
      canvasContext: context,
      viewport: viewport,
      canvas: canvas
    } as any).promise;
    
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch (error) {
    console.warn('Failed to render PDF thumbnail during preload:', error);
    return null;
  }
};

/**
 * Preload document covers during "Planning Next Moves" phase
 * This fetches and caches document previews (including PDF thumbnails) 
 * so they appear instantly when rendered
 */
const preloadDocumentCover = async (doc: {
  doc_id: string;
  s3_path?: string;
  download_url?: string;
  original_filename?: string | null;
  classification_type?: string;
}): Promise<void> => {
  if (!doc.doc_id) return;
  
  // Skip if already cached (check for complete cache with thumbnailUrl for PDFs)
  const existingCache = (window as any).__preloadedDocumentCovers?.[doc.doc_id];
  
  // Determine file type - use original_filename first, then classification_type as fallback
  const filenameLower = doc.original_filename?.toLowerCase() || '';
  const classType = doc.classification_type?.toLowerCase() || '';
  const isPDF = filenameLower.endsWith('.pdf') || 
                classType.includes('valuation') || 
                classType.includes('report') ||
                classType.includes('pdf');
  const isImage = filenameLower.match(/\.(jpg|jpeg|png|gif|webp)$/i);
  
  if (existingCache) {
    // If it's a PDF, make sure we have the thumbnail already
    if (!isPDF || existingCache.thumbnailUrl) {
      return; // Already fully cached
    }
  }
  
  // Build display name for logging
  const displayName = doc.original_filename || 
    (doc.classification_type ? doc.classification_type.replace(/_/g, ' ') : doc.doc_id);
  
  try {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';
    let fetchUrl: string;
    
    // Prioritize s3_path for faster downloads (direct S3 access)
    if (doc.s3_path) {
      fetchUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(doc.s3_path)}`;
    } else if (doc.download_url) {
      fetchUrl = doc.download_url.startsWith('http') ? doc.download_url : `${backendUrl}${doc.download_url}`;
    } else {
      fetchUrl = `${backendUrl}/api/files/download?document_id=${doc.doc_id}`;
    }
    
    const response = await fetch(fetchUrl, {
      credentials: 'include'
    });
    
    if (!response.ok) {
      console.warn(`⚠️ [Preload] Failed to fetch ${displayName}: ${response.status}`);
      return;
    }
    
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    
    // Initialize cache if needed
    if (!(window as any).__preloadedDocumentCovers) {
      (window as any).__preloadedDocumentCovers = {};
    }
    
    let displayUrlForDecode: string | null = null;
    if (isPDF) {
      // For PDFs, generate the thumbnail NOW so it's ready when the card renders
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const thumbnailUrl = await renderPdfThumbnailForPreload(arrayBuffer);
        
        if (thumbnailUrl) {
          (window as any).__preloadedDocumentCovers[doc.doc_id] = {
            url: url,
            thumbnailUrl: thumbnailUrl, // This is the key - pre-generated thumbnail!
            type: blob.type,
            timestamp: Date.now()
          };
          displayUrlForDecode = thumbnailUrl;
        } else {
          // Fallback - at least cache the URL
          (window as any).__preloadedDocumentCovers[doc.doc_id] = {
            url: url,
            type: blob.type,
            timestamp: Date.now()
          };
        }
      } catch (pdfError) {
        console.warn(`⚠️ [Preload] PDF thumbnail generation failed for ${displayName}:`, pdfError);
        (window as any).__preloadedDocumentCovers[doc.doc_id] = {
          url: url,
          type: blob.type,
          timestamp: Date.now()
        };
      }
    } else if (isImage) {
      // For images, the blob URL is enough
      (window as any).__preloadedDocumentCovers[doc.doc_id] = {
        url: url,
        type: blob.type,
        timestamp: Date.now()
      };
      displayUrlForDecode = url;
    } else {
      // For other files, just cache the URL
      (window as any).__preloadedDocumentCovers[doc.doc_id] = {
        url: url,
        type: blob.type,
        timestamp: Date.now()
      };
    }
    // Pre-decode image so the moment the card opens the browser can paint the thumbnail instantly
    if (displayUrlForDecode) {
      const img = new window.Image();
      img.src = displayUrlForDecode;
      img.decode().catch(() => {});
    }
    // Notify cards so they can show thumbnail immediately instead of waiting for next render
    window.dispatchEvent(new CustomEvent('documentCoverReady', { detail: { doc_id: doc.doc_id } }));
  } catch (error) {
    console.warn(`❌ [Preload] Failed: ${displayName}`, error);
    // Silently fail - preview will load on demand
  }
};

interface DocumentMetadata {
  doc_id: string;
  original_filename?: string | null; // Can be null when backend doesn't have filename
  classification_type: string;
  page_range?: string;
  page_numbers?: number[];
  s3_path?: string;
  download_url?: string;
}

interface ReasoningStepsProps {
  steps: ReasoningStep[];
  isLoading?: boolean;
  onDocumentClick?: (metadata: DocumentMetadata) => void;
  hasResponseText?: boolean; // Stop animations when response text has started
  isAgentMode?: boolean; // Show agent-specific steps only in Agent mode
  skipAnimations?: boolean; // Skip animations when restoring a chat (instant display)
  /** When true, collapse to max 2 steps (first searching + first "No relevant") for display */
  isNoResultsResponse?: boolean;
  /** When true, steps are shown under the thought dropdown after completion - use faint font for "Analysing X documents:" and document names */
  thoughtCompleted?: boolean;
  /** When true (e.g. expanded Thought dropdown), show all reasoning steps including Searching, Generating response, etc. */
  showAllStepsInTrace?: boolean;
  /** Shown as the current step without adding to the list (replaced when next step arrives). Enables "Thinking" in parallel. */
  transientStep?: { message: string };
}

// True 3D Globe component using CSS 3D transforms (scaled for reasoning steps) - Blue version
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

  const radius = 3.5; // Scaled down for reasoning steps
  const rings = 12; // Reduced for better performance

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        marginTop: '-3.5px',
        marginLeft: '-3.5px',
        width: '7px',
        height: '7px',
        transformStyle: 'preserve-3d',
        willChange: 'transform',
        zIndex: 1
      }}
    >
      {/* Create solid sphere using multiple filled rings in 3D space - Blue color */}
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
              backgroundColor: 'rgba(59, 130, 246, 0.75)', // Blue color instead of gray
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

// Reading step - always shows "Reading" animation briefly before "Read" for natural feel
// Backend emits reading steps when documents are actually processed
// We show a brief "Reading" animation (100ms) then transition to "Read" - this happens 100% of the time
const READING_ANIMATION_DURATION = 100; // Brief animation to show "Reading" state (always happens) - reduced for faster appearance

/**
 * Two-tone scheme: light grey for action labels, dark grey for details.
 * FAINT_COLOR when collapsed under thought dropdown (completed).
 */
const ACTION_COLOR = '#9CA3AF';   // Light grey for "Searching", "Reading", "Read"
const DETAIL_COLOR = '#374151';   // Dark grey for details: filenames, document card
const FAINT_COLOR = '#9CA3AF';    // Faint when under thought dropdown and completed
const ReadingStepWithTransition: React.FC<{
  filename: string;
  docMetadata: any;
  llmContext?: Array<{ content: string; page: number; type: string }>; // LLM context blocks for visualization
  isLoading?: boolean;
  readingIndex: number; // Which reading step this is (0, 1, 2...)
  onDocumentClick?: (metadata: DocumentMetadata) => void;
  showPreview?: boolean; // Whether to show the preview card (first time only)
  isLastReadingStep?: boolean; // Is this the last reading step?
  hasNextStep?: boolean; // Is there a step after this reading step?
  keepAnimating?: boolean; // Keep the green animation going until planning indicator appears
  hasResponseText?: boolean; // Stop all animations when response text appears
  hasSummarisingStep?: boolean; // Close viewer when summarising step appears
  hasPreparingResponseStep?: boolean; // Stop animation and show Read when "Summarising content" step is shown
  thoughtCompleted?: boolean; // When true, use faint font colour (under thought dropdown, completed)
}> = ({ filename, docMetadata, llmContext, readingIndex, isLoading, onDocumentClick, showPreview = true, isLastReadingStep = false, hasNextStep = false, keepAnimating = false, hasResponseText = false, hasSummarisingStep = false, hasPreparingResponseStep = false, thoughtCompleted = false }) => {
  const [phase, setPhase] = useState<'reading' | 'read'>('reading');
  const [showReadAnimation, setShowReadAnimation] = useState(false); // Track if "Read" should show animation
  
  // Calculate line range from llmContext for Cursor-style "Read [filename] L1-[totalLines]" format
  const lineRange = useMemo(() => {
    if (!llmContext || llmContext.length === 0) return '';
    let totalLines = 0;
    llmContext.forEach(block => {
      totalLines += block.content.split('\n').length;
    });
    return totalLines > 0 ? `L1-${totalLines}` : '';
  }, [llmContext]);
  
  // ALWAYS show "Reading" animation first, then transition to "Read"
  // Check step details.status to see if backend has marked it as "read"
  // This happens 100% of the time for natural feel
  // If keepAnimating is true, stay in reading phase with animation
  // BUT: Don't block response - if response text has started, immediately transition to "read" and stop ALL animations
  // Also transition when summarising step appears - reading viewers close first, then summarising viewer opens
  useEffect(() => {
    // If response text has appeared, immediately stop all animations and show "read"
    if (hasResponseText) {
      setPhase('read');
      setShowReadAnimation(false);
      return;
    }
    
    // If summarising step has appeared, close the reading viewer so summarising can show its viewer
    if (hasSummarisingStep) {
      setPhase('read');
      setShowReadAnimation(false);
      return;
    }
    
    // When "Summarising content" reasoning step is shown, stop animation and show Read
    if (hasPreparingResponseStep) {
      setPhase('read');
      setShowReadAnimation(false);
      return;
    }
    
    // Check if step details indicate it's already been read
    const stepStatus = docMetadata?.status || (onDocumentClick ? undefined : 'reading');
    
    // If backend says it's read, immediately show "read" (don't wait for animation)
    if (stepStatus === 'read') {
      setPhase('read');
      setShowReadAnimation(false); // Skip animation to not delay response
      return;
    }
    
    // If we should keep animating AND it's not marked as read, stay in "reading" phase
    if (keepAnimating) {
      setPhase('reading');
      setShowReadAnimation(false);
      return;
    }
    
    // Start in "reading" phase briefly, then quickly transition to "read"
    setPhase('reading');
    setShowReadAnimation(false);
    
    // Transition to "read" very quickly (reduced delay to not block response)
    const readTimer = setTimeout(() => {
      setPhase('read');
      setShowReadAnimation(false); // Skip animation to not delay response
    }, Math.min(READING_ANIMATION_DURATION, 50)); // Use shorter delay, max 50ms
    
    return () => {
      if (readTimer) clearTimeout(readTimer);
    };
  }, [docMetadata, onDocumentClick, keepAnimating, hasResponseText, hasSummarisingStep, hasPreparingResponseStep]); // Re-run if docMetadata changes (backend updates status) or response text appears or summarising/preparing response starts
  
  const actionStyle: React.CSSProperties = {
    color: thoughtCompleted ? FAINT_COLOR : ACTION_COLOR,
    fontWeight: 500
  };
  const detailStyle: React.CSSProperties = {
    color: thoughtCompleted ? FAINT_COLOR : DETAIL_COLOR,
    fontWeight: 500
  };

  // ALWAYS show "Reading" animation, then transition to "Read"
  // This happens 100% of the time for natural feel
  return (
    <motion.div 
      key={generateUniqueKey('ReadingStepWithTransition', readingIndex, docMetadata?.doc_id || filename)}
                initial={{ opacity: 0, y: 2, scale: 0.98 }}
                animate={hasResponseText ? { opacity: 1, y: 0, scale: 1 } : { opacity: 1, y: 0, scale: 1 }}
                transition={hasResponseText ? { duration: 0 } : { duration: 0.15, ease: [0.16, 1, 0.3, 1] }} // Instant when response text appears, otherwise faster animation
      style={{ marginBottom: '0' }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        {/* No icon before label - show "Analysing" then document bubble only */}
        {phase === 'reading' ? (
          <span className="reading-reveal-text" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {keepAnimating && !hasResponseText ? (
              <span className="planning-shimmer-full">Analysing</span>
            ) : (
              <span style={actionStyle}>Analysing</span>
            )}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: docMetadata && onDocumentClick ? 'pointer' : 'default',
                borderRadius: 6,
                padding: '2px 2px 2px 0',
                margin: '-2px 0',
              }}
              onClick={() => docMetadata && onDocumentClick?.(docMetadata)}
              role={docMetadata && onDocumentClick ? 'button' : undefined}
            >
              {phase === 'reading' && !hasResponseText ? (
                <span
                  className="reading-filename-border-glow"
                  style={{
                    position: 'relative',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '11px',
                    fontWeight: 500,
                    letterSpacing: '-0.01em',
                    lineHeight: 1.4,
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: '1px solid rgba(0, 0, 0, 0.08)',
                    backgroundColor: '#ffffff',
                    zIndex: 1,
                    isolation: 'isolate',
                  }}
                >
                  {/* Inset moving line – inside the container border (Option A) */}
                  <span
                    className="reading-border-ring"
                    style={{
                      position: 'absolute',
                      inset: 1,
                      width: 'calc(100% - 2px)',
                      height: 'calc(100% - 2px)',
                      borderRadius: 5,
                      overflow: 'hidden',
                      pointerEvents: 'none',
                      zIndex: 0,
                    }}
                    aria-hidden
                  >
                    <span
                      className="reading-border-segment"
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        width: '200%',
                        height: '200%',
                        marginLeft: '-100%',
                        marginTop: '-100%',
                        transformOrigin: 'center center',
                        background: `conic-gradient(from 0deg, rgba(34, 197, 94, 0.85) 0deg, rgba(34, 197, 94, 0.85) 28deg, transparent 28deg)`,
                      }}
                    />
                    <span
                      className="reading-border-ring-inner"
                      style={{
                        position: 'absolute',
                        inset: 2.5,
                        borderRadius: 2.5,
                        background: 'var(--reading-border-inner-bg, #ffffff)',
                      }}
                    />
                  </span>
                  <span
                    style={{
                      position: 'relative',
                      zIndex: 1,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <img
                      src="/PDF.png"
                      alt="PDF"
                      style={{ width: '14px', height: '14px', flexShrink: 0, display: 'block', verticalAlign: 'middle' }}
                    />
                    {filename}
                  </span>
                </span>
              ) : (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '11px',
                    fontWeight: 500,
                    letterSpacing: '-0.01em',
                    lineHeight: 1.4,
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: '1px solid rgba(0, 0, 0, 0.08)',
                    backgroundColor: '#ffffff',
                    ...detailStyle,
                  }}
                >
                  <img src="/PDF.png" alt="PDF" style={{ width: '14px', height: '14px', flexShrink: 0 }} />
                  {filename}
                </span>
              )}
            </span>
          </span>
        ) : (
          // Cursor-style: "Read [filename] L1-[totalLines]" — icon + action label light, filename dark
          <>
            <BookOpenCheck style={{ width: '14px', height: '14px', color: thoughtCompleted ? FAINT_COLOR : ACTION_COLOR, flexShrink: 0 }} />
            <span style={{ color: thoughtCompleted ? FAINT_COLOR : ACTION_COLOR, fontWeight: 500 }}>
              Read <span style={detailStyle}>{filename}</span>{lineRange ? ` ${lineRange}` : ''}
            </span>
          </>
        )}
      </span>
      
      {/* LLM Context Viewer - show during reading phase with line-by-line animation */}
      <AnimatePresence mode="sync">
        {llmContext && llmContext.length > 0 && phase === 'reading' && (
          <motion.div
            key="reading-viewer"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{ marginTop: 4, marginLeft: 0 }}
          >
            <LLMContextViewer
              blocks={llmContext}
              filename={filename}
              isAnimating={keepAnimating && !hasResponseText}
            />
          </motion.div>
        )}
        {/* Collapsed LLM Context Viewer - show when read phase (terminal output in closed state) */}
        {llmContext && llmContext.length > 0 && phase === 'read' && (
          <motion.div
            key="read-viewer-collapsed"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{ marginTop: 4, marginLeft: 0 }}
          >
            <LLMContextViewer
              blocks={llmContext}
              filename={filename}
              isAnimating={false}
              collapsed={true}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// Planning indicator - text only with faint pulse (no icon)
const PlanningIndicator: React.FC = () => (
  <div
    style={{
      fontSize: '12px',
      padding: '2px 0',
      display: 'inline-flex',
      alignItems: 'flex-start',
      gap: '6px'
    }}
  >
    <span className="planning-shimmer-full">Planning next moves</span>
  </div>
);

// Individual step renderer based on action type
// Now accepts allSteps and stepIndex to determine if reading steps exist
const StepRenderer: React.FC<{ 
  step: ReasoningStep; 
  allSteps: ReasoningStep[]; 
  stepIndex: number;
  isLoading?: boolean;
  readingStepIndex?: number; // Index among reading steps only (0, 1, 2...)
  isLastReadingStep?: boolean; // Is this the last reading step? (still active)
  totalReadingSteps?: number; // Total number of reading steps
  onDocumentClick?: (metadata: DocumentMetadata) => void;
  shownDocumentsRef?: React.MutableRefObject<Set<string>>; // Track which documents have been shown
  allReadingComplete?: boolean; // All reading steps have completed
  hasResponseText?: boolean; // Stop animations when response text has started
  model?: 'gpt-4o-mini' | 'gpt-4o' | 'claude-sonnet' | 'claude-opus';
  thoughtCompleted?: boolean; // When true, use faint font for "Analysing X documents:" and document names
  /** When provided, show document names below "Analysing N documents:" with reading animation */
  documentsDropdown?: { stepKey: string; readingSteps: ReasoningStep[]; isOpen: boolean; onOpenChange: (open: boolean) => void };
}> = ({ step, allSteps, stepIndex, isLoading, readingStepIndex = 0, isLastReadingStep = false, totalReadingSteps = 0, onDocumentClick, shownDocumentsRef, allReadingComplete = false, hasResponseText = false, model = 'gpt-4o-mini', thoughtCompleted = false, documentsDropdown }) => {
  const { sidebarDocuments } = useFilingSidebar();
  const actionColor = thoughtCompleted ? FAINT_COLOR : ACTION_COLOR;
  const detailColor = thoughtCompleted ? FAINT_COLOR : DETAIL_COLOR;
  const actionStyle: React.CSSProperties = {
    color: actionColor,
    fontWeight: 500,
    fontSize: '13.1px'
  };

  const targetStyle: React.CSSProperties = {
    color: detailColor,
    fontWeight: 500
  };

  const highlightStyle: React.CSSProperties = {
    color: detailColor,
    fontWeight: 500
  };

  const docNameStyle: React.CSSProperties = {
    color: detailColor,
    fontWeight: 500
  };

  // PERFORMANCE OPTIMIZATION: Reduced animation delay for faster UI
  // REAL-TIME: No animation delays - show steps immediately when received
  const revealDelay = 0;
  
  // RESEARCH AGENT: Check if this is a tool call step from the research agent
  // Tool call steps have tool_name in details and show input/output
  const isToolCallStep = step.details?.tool_name;
  const toolStatus = step.details?.status; // 'running' | 'complete' | 'error'
  
  // Render tool call step in Cursor-style format
  if (isToolCallStep) {
    const toolName = step.details?.tool_name;
    const toolInput = step.details?.tool_input;
    const toolOutput = step.details?.tool_output;
    const isRunning = toolStatus === 'running';
    const isError = toolStatus === 'error';
    
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
          {isRunning && (
            <div style={{ width: '14px', height: '14px', flexShrink: 0, marginTop: '2px' }}>
              <div className="reasoning-loading-spinner" style={{
                width: '14px',
                height: '14px',
                border: '2px solid #e5e7eb',
                borderTopColor: '#6b7280',
                borderRadius: '50%'
              }} />
            </div>
          )}
          <span style={{ color: isError ? '#ef4444' : detailColor, fontWeight: 500 }}>
            {step.message}
          </span>
        </div>
        
        {/* Show tool input/output for search results in compact format */}
        {toolName === 'search_documents' && toolOutput?.documents && (
          <div style={{ paddingLeft: '20px', fontSize: '11px', color: detailColor }}>
            {toolOutput.documents.slice(0, 3).map((doc: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ color: detailColor }}>•</span>
                <span style={{ color: detailColor }}>{doc.filename || doc.classification_type || 'Document'}</span>
                {doc.relevance_score && (
                  <span style={{ color: detailColor, fontSize: '10px' }}>
                    ({Math.round(doc.relevance_score * 100)}%)
                  </span>
                )}
              </div>
            ))}
            {toolOutput.documents.length > 3 && (
              <div style={{ color: detailColor, fontStyle: 'italic' }}>
                +{toolOutput.documents.length - 3} more
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Component for "Analysing X documents:" or legacy "Found X documents:" (no animation). Use single ":" (avoid "::" if prefix already has colon).
  const FoundDocumentsText: React.FC<{ prefix: string; actionStyle: React.CSSProperties; detailColor?: string }> = ({ prefix, actionStyle, detailColor: detailColorProp }) => {
    const color = detailColorProp ?? detailColor;
    const analysingMatch = prefix.match(/^(Analysing)\s+(.+)$/);
    const foundMatch = prefix.match(/^(Found)\s+(.+)$/);
    const ensureSingleColon = (s: string) => (s.trimEnd().endsWith(':') ? s.trimEnd() : `${s.trimEnd()}:`);

    if (analysingMatch) {
      return (
        <span>
          <span style={actionStyle}>{analysingMatch[1]}</span>
          <span style={{ color, fontWeight: 500 }}> {ensureSingleColon(analysingMatch[2])}</span>
        </span>
      );
    }
    if (foundMatch) {
      return (
        <span>
          <span style={actionStyle}>{foundMatch[1]}</span>
          <span style={{ color, fontWeight: 500 }}> {ensureSingleColon(foundMatch[2])}</span>
        </span>
      );
    }
    return (
      <span style={actionStyle}>{ensureSingleColon(prefix)}</span>
    );
  };

  switch (step.action_type) {
    case 'planning':
      // Only "Planning next moves" (planning_next_moves) is allowed through the filter for normal queries
      if (step.step === 'planning_next_moves') {
        // Stop shimmering when the next reasoning step has been inserted
        const hasStepAfterPlanning = stepIndex < allSteps.length - 1;
        const isPlanningActive = isLoading && !hasResponseText && !hasStepAfterPlanning;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'flex-start' }}>
            {isPlanningActive ? (
              <span className="ranking-shimmer-active">Planning next moves</span>
            ) : (
              <span style={actionStyle}>Planning next moves</span>
            )}
          </span>
        );
      }
      return <span style={{ display: 'none' }} aria-hidden />;

    case 'exploring':
      // "Analysing 1 document:" or "Analysing 15 sections:" (or legacy "Found ...") - text only, no document cards here.
      // Document preview cards appear only under the "Reading [filename]" step.
      // Use same colour for whole phrase (no different colour for the number).
      const isSectionsStep = step.message.toLowerCase().includes('section');
      const isNoResultsStep = step.message.toLowerCase().includes('no relevant');
      const foundActionColor = thoughtCompleted ? FAINT_COLOR : ACTION_COLOR;
      const foundActionStyle = { color: foundActionColor, fontWeight: 500 as const };
      const foundDetailColor = foundActionColor;

      const colonIndex = step.message.indexOf(': ');
      let prefix = step.message;
      if (colonIndex > -1) {
        prefix = step.message.substring(0, colonIndex);
      }

      // Only show "Analysing X documents" step when more than one document
      const isAnalysingOneDocument = /^Analysing\s+1\s+document\s*:?$/i.test(prefix.trim());
      if (isAnalysingOneDocument) {
        return <span style={{ display: 'none' }} aria-hidden />;
      }

      const nextStepExploring = stepIndex < allSteps.length - 1 ? allSteps[stepIndex + 1] : null;
      // Shimmer while still loading and no response: active if next step is exploring OR reading (documents still being analysed)
      const isExploringActive =
        isLoading &&
        !hasResponseText &&
        (!nextStepExploring || nextStepExploring.action_type === 'exploring' || nextStepExploring.action_type === 'reading');
      const isAnalysingPrefix = /^Analysing\s+/i.test(prefix);
      const ensureColon = (s: string) => (s.trimEnd().endsWith(':') ? s.trimEnd() : `${s.trimEnd()}:`);
      const showDocsInline = documentsDropdown && documentsDropdown.readingSteps.length > 0;
      const docCount = showDocsInline ? documentsDropdown!.readingSteps.length : 0;
      const anyStillReading = showDocsInline && documentsDropdown!.readingSteps.some((s) => s.details?.status !== 'read');
      const firstReadingStep = showDocsInline ? documentsDropdown!.readingSteps[0] : null;
      // When we have the bubble, main heading is just "Analysing:"; bubble shows "N documents"
      const headingText = showDocsInline ? 'Analysing' : prefix;
      const bubbleLabel = docCount === 1 ? '1 document' : `${docCount} documents`;
      const showBubbleGlow = showDocsInline && isExploringActive && anyStillReading;
      const firstMeta = firstReadingStep?.details?.doc_metadata;
      const bubbleClickable = firstMeta && onDocumentClick;

      return (
        <div>
          <div className="found-reveal-text" style={{ display: 'flex', alignItems: 'center', gap: '6px', position: 'relative', zIndex: 1, flexWrap: 'wrap' }}>
            {isAnalysingPrefix && isExploringActive ? (
              <span className="ranking-shimmer-active">{showDocsInline ? 'Analysing' : ensureColon(headingText)}</span>
            ) : showDocsInline && headingText === 'Analysing' ? (
              <span style={foundActionStyle}>Analysing</span>
            ) : (
              <FoundDocumentsText prefix={headingText} actionStyle={foundActionStyle} detailColor={foundDetailColor} />
            )}
            {showDocsInline && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              {showBubbleGlow ? (
                <span
                  className="reading-filename-border-glow"
                  style={{
                    position: 'relative',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '11px',
                    fontWeight: 500,
                    letterSpacing: '-0.01em',
                    lineHeight: 1.4,
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: '1px solid rgba(0, 0, 0, 0.08)',
                    backgroundColor: '#ffffff',
                    zIndex: 1,
                    isolation: 'isolate',
                    cursor: bubbleClickable ? 'pointer' : 'default',
                  }}
                  onClick={() => bubbleClickable && onDocumentClick?.(firstMeta)}
                  role={bubbleClickable ? 'button' : undefined}
                >
                  <span
                    className="reading-border-ring"
                    style={{
                      position: 'absolute',
                      inset: 1,
                      width: 'calc(100% - 2px)',
                      height: 'calc(100% - 2px)',
                      borderRadius: 5,
                      overflow: 'hidden',
                      pointerEvents: 'none',
                      zIndex: 0,
                    }}
                    aria-hidden
                  >
                    <span
                      className="reading-border-segment"
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        width: '200%',
                        height: '200%',
                        marginLeft: '-100%',
                        marginTop: '-100%',
                        transformOrigin: 'center center',
                        background: `conic-gradient(from 0deg, rgba(34, 197, 94, 0.85) 0deg, rgba(34, 197, 94, 0.85) 28deg, transparent 28deg)`,
                      }}
                    />
                    <span
                      className="reading-border-ring-inner"
                      style={{
                        position: 'absolute',
                        inset: 2.5,
                        borderRadius: 2.5,
                        background: 'var(--reading-border-inner-bg, #ffffff)',
                      }}
                    />
                  </span>
                  <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <img src="/PDF.png" alt="PDF" style={{ width: '14px', height: '14px', flexShrink: 0, display: 'block', verticalAlign: 'middle' }} />
                    {bubbleLabel}
                  </span>
                </span>
              ) : (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '11px',
                    fontWeight: 500,
                    letterSpacing: '-0.01em',
                    lineHeight: 1.4,
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: '1px solid rgba(0, 0, 0, 0.08)',
                    backgroundColor: '#ffffff',
                    color: foundDetailColor,
                    cursor: bubbleClickable ? 'pointer' : 'default',
                  }}
                  onClick={() => bubbleClickable && onDocumentClick?.(firstMeta)}
                  role={bubbleClickable ? 'button' : undefined}
                >
                  <img src="/PDF.png" alt="PDF" style={{ width: '14px', height: '14px', flexShrink: 0 }} />
                  {bubbleLabel}
                </span>
              )}
            </span>
            )}
          </div>
          {!isSectionsStep && !isNoResultsStep && !showDocsInline && !(step.details?.doc_previews?.length) ? (
            <div style={{ marginTop: '2px', paddingLeft: '0', color: foundDetailColor, fontStyle: 'italic', fontSize: '12px' }}>
              (document details not available)
            </div>
          ) : null}
        </div>
      );
    
    case 'searching': {
      // Show "Searching" with files rotating from the file sidebar (or exploring step fallback); once reading steps appear, this step is hidden
      const nextStep = stepIndex < allSteps.length - 1 ? allSteps[stepIndex + 1] : null;
      const isSearchingActive = isLoading && !hasResponseText && (!nextStep || nextStep.action_type === 'searching');
      const sourceCountByType = step.details?.source_count_by_type as { pdf?: number; docx?: number } | undefined;
      const sourceTypes = (step.details?.source_types ?? []).filter((t): t is 'pdf' | 'docx' =>
        SEARCHING_CAROUSEL_TYPES.includes(t)
      );
      const exploringStep = allSteps.find((s) => s.action_type === 'exploring');
      const exploringPreviews = (exploringStep?.details?.doc_previews ?? []) as Array<{ original_filename?: string | null; classification_type?: string | null }>;
      // Prefer file sidebar list so carousel rotates through whatever is in the sidebar
      const docPreviews = sidebarDocuments.length > 0
        ? sidebarDocuments.map((d) => ({ original_filename: d.original_filename ?? undefined }))
        : exploringPreviews;

      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          {isSearchingActive ? (
            <span className="searching-shimmer-active">Searching</span>
          ) : (
            <span style={actionStyle}>Searching</span>
          )}
          <SearchingSourcesCarousel
            sourceTypes={sourceTypes.length > 0 ? sourceTypes : undefined}
            sourceCountByType={sourceCountByType}
            docPreviews={docPreviews.length > 0 ? docPreviews : undefined}
            isActive={isSearchingActive}
            sourceCount={step.details?.source_count}
          />
        </span>
      );
    }
    
    case 'reading':
      // Each reading step transitions from "Reading" -> "Read" 
      // Backend emits "reading" step when processing starts, then "read" step when complete
      // Frontend shows animation and updates when "read" step is received
      const docMetadataRaw = step.details?.doc_metadata;
      // Fallback: agent path may send doc_previews without doc_metadata; use first doc_preview for preview
      const firstDocPreview = step.details?.doc_previews?.[0];
      const docMetadata = docMetadataRaw?.doc_id
        ? docMetadataRaw
        : firstDocPreview
          ? {
              doc_id: firstDocPreview.doc_id,
              original_filename: firstDocPreview.original_filename ?? null,
              classification_type: firstDocPreview.classification_type ?? 'Document',
              download_url: firstDocPreview.download_url,
            }
          : undefined;
      const stepStatus = step.details?.status; // 'reading' or 'read' from backend
      
      // Build filename from multiple sources - include step.message so @-tagged docs show actual name (not "Document")
      const fromMessage = (step.message || '').replace(/^Read\s+/i, '').trim();
      const isGenericSentence = /^(Reading|Searching|Analysing|Using|selected documents)/i.test(fromMessage);
      const nameFromMessage = fromMessage && fromMessage !== 'Document' && !isGenericSentence ? fromMessage : '';
      const rawFilename = step.details?.filename || docMetadata?.original_filename || nameFromMessage || '';
      const classificationLabel = docMetadata?.classification_type 
        ? docMetadata.classification_type.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
        : '';
      const displayFilename = rawFilename || classificationLabel || 'Document';
      const truncatedFilename = displayFilename.length > 35 ? displayFilename.substring(0, 32) + '...' : displayFilename;
      
      // Check if this is the first time we're showing this document in this query
      // Only require doc_id to show preview - filename can use fallbacks
      const docId = docMetadata?.doc_id;
      const hasValidMetadata = docMetadata && docId; // Only require doc_id, not original_filename
      
      // Determine if we should show the preview card
      // Instead of using a ref (which gets mutated on re-render), check if any PREVIOUS
      // reading step in the array has the same doc_id. This is stable across re-renders.
      let shouldShowPreview = false;
      if (hasValidMetadata) {
        // Find all reading steps BEFORE this one that have the same doc_id
        const previousReadingStepsWithSameDoc = allSteps
          .slice(0, stepIndex) // Only steps before current
          .filter(s => s.action_type === 'reading' && (s.details?.doc_metadata?.doc_id || s.details?.doc_previews?.[0]?.doc_id) === docId);
        
        // Show preview only if this is the FIRST reading step for this document
        shouldShowPreview = previousReadingStepsWithSameDoc.length === 0;
      }
      // Only warn when we have no doc_id from either doc_metadata or doc_previews
      if (!hasValidMetadata && !firstDocPreview?.doc_id) {
        console.warn('⚠️ [ReasoningSteps] Cannot show preview - missing doc_id:', {
          hasDocMetadata: !!docMetadataRaw,
          hasDocId: !!docId,
          stepDetails: step.details,
          fullStep: step
        });
      }
      
      // Pass step status to component so it knows if backend has completed
      const docMetadataWithStatus = docMetadata ? { ...docMetadata, status: stepStatus } : docMetadata;
      
      // Check if there's a step after this reading step
      const hasNextStepAfterReading = stepIndex < allSteps.length - 1;
      
      // Check if a summarising step has appeared - if so, close reading viewers
      const hasSummarisingStep = allSteps.some(s => s.action_type === 'summarising');
      // Check if "Summarising content" (analysing) step has appeared - stop reading animation and show Read
      const hasPreparingResponseStep = allSteps.some(s =>
        s.action_type === 'analysing' && /^(Summarising content|Formulating answer|Preparing answer|Preparing response|Generating response)/i.test((s.message || '').trim())
      );
      
      // Keep the green animation going on ALL reading steps until response is complete
      // Not just the last one - all documents should animate while loading
      // Stop animating immediately when response text has started (don't block response)
      // Also stop when summarising or preparing response step appears - reading viewers should close first
      const shouldKeepAnimating = isLoading && !hasResponseText && !allReadingComplete && !hasSummarisingStep && !hasPreparingResponseStep;
      
      // If response text has started OR summarising/preparing response has started, don't keep animating - show read immediately
      const finalKeepAnimating = (hasResponseText || hasSummarisingStep || hasPreparingResponseStep) ? false : shouldKeepAnimating;
      
      // Extract LLM context blocks for visualization
      const llmContext = step.details?.llm_context;
      
      return (
        <ReadingStepWithTransition 
          filename={truncatedFilename}
          docMetadata={docMetadataWithStatus}
          llmContext={llmContext}
          isLoading={isLoading}
          readingIndex={readingStepIndex}
          onDocumentClick={onDocumentClick}
          showPreview={shouldShowPreview}
          isLastReadingStep={isLastReadingStep}
          hasNextStep={hasNextStepAfterReading}
          keepAnimating={finalKeepAnimating}
          hasResponseText={hasResponseText}
          hasSummarisingStep={hasSummarisingStep}
          hasPreparingResponseStep={hasPreparingResponseStep}
          thoughtCompleted={thoughtCompleted}
        />
      );
    
    case 'analysing':
      // "Analysing" - text only (no icon). "Summarising content" is only shown when we actually start streaming.
      const nextStepAfterAnalyzing = stepIndex < allSteps.length - 1 ? allSteps[stepIndex + 1] : null;
      const isPreparingResponseMessage = /^(Summarising content|Formulating answer|Preparing answer|Preparing response|Generating response)$/i.test((step.message || '').trim());
      const isRankingActive = !isPreparingResponseMessage && isLoading && !hasResponseText && (!nextStepAfterAnalyzing || nextStepAfterAnalyzing.action_type === 'analysing');
      const isGeneratingResponseActive =
        (step.message || '').trim() === 'Generating response' &&
        isLoading &&
        !hasResponseText &&
        (!nextStepAfterAnalyzing || nextStepAfterAnalyzing.action_type === 'analysing');
      
      // Transform message: show "Analysing" for the analysing step; keep "Summarising content" / "Thinking" / "Generating response" etc. as-is
      let fixedMessage = step.message || 'Analysing';
      if (/^(Summarising content|Formulating answer|Preparing answer|Preparing response|Generating response)$/i.test((fixedMessage || '').trim())) {
        fixedMessage = (fixedMessage || '').trim() === 'Generating response' ? 'Generating response' : 'Summarising content';
      } else if ((fixedMessage || '').trim() === 'Thinking') {
        fixedMessage = 'Thinking';
      } else if (!/^(Summarising content|Formulating answer|Preparing answer|Preparing response)/i.test(fixedMessage.trim())) {
        fixedMessage = 'Analysing';
      }
      const showShimmer = isRankingActive || isGeneratingResponseActive;
      return (
        <span style={{ display: 'inline-flex', alignItems: 'flex-start' }}>
          {showShimmer ? (
            <span className="ranking-shimmer-active">{fixedMessage}</span>
          ) : (
            <span style={actionStyle}>{fixedMessage}</span>
          )}
        </span>
      );
    
    case 'summarising':
      // During streaming: "Planning next moves" 
      // After completion: "Summarising content"
      const nextStepAfterSummarizing = stepIndex < allSteps.length - 1 ? allSteps[stepIndex + 1] : null;
      const isSummarizingActive = isLoading && !hasResponseText && (!nextStepAfterSummarizing || nextStepAfterSummarizing.action_type === 'summarising');
      
      return (
        <span style={{ display: 'inline-flex', alignItems: 'flex-start' }}>
          {isSummarizingActive ? (
            <span className="ranking-shimmer-active">Planning next moves</span>
          ) : (
            <span style={actionStyle}>Summarised content</span>
          )}
        </span>
      );
    
    case 'thinking':
      // Cursor-style collapsible thinking block with streaming animation
      const isThinkingStreaming = isLoading && !hasResponseText;
      
      // Extract search term from the searching step to prioritize relevant key facts
      const searchingStep = allSteps.find(s => s.action_type === 'searching');
      const searchTermMatch = searchingStep?.message?.match(/Searching for\s+(.+)/i)
        ?? searchingStep?.message?.match(/Finding\s+(.+)/i)
        ?? searchingStep?.message?.match(/Preparing\s+(.+)/i)
        ?? searchingStep?.message?.match(/Locating\s+(.+)/i);
      const extractedSearchTerm = searchTermMatch ? searchTermMatch[1].trim() : undefined;
      
      return (
        <ThinkingBlock
          content={step.details?.thinking_content || ''}
          isStreaming={isThinkingStreaming}
          startTime={step.timestamp}
          model={model}
          searchTerm={extractedSearchTerm}
        />
      );
    
    case 'complete':
      return (
        <span style={{ color: actionColor, fontWeight: 500 }}>
          ✓ {step.message}
        </span>
      );
    
    case 'context':
      // LLM-generated contextual narration - styled as normal response text (not small italic)
      // Skip rendering if message is empty - return invisible placeholder instead of null
      // Note: The key here doesn't matter since this span is inside a motion.div with its own key
      // Context steps are filtered out by filteredSteps, so this case should rarely be reached
      if (!step.message || !step.message.trim()) {
        return <span style={{ display: 'none' }} aria-hidden />;
      }
      return (
        <div style={{
          color: detailColor,
          fontWeight: 500,
          fontSize: '12px',
          lineHeight: '1.5',
          marginTop: '0',
          marginBottom: '0',
          paddingLeft: '0'
        }}>
          {step.message}
        </div>
      );
    
    case 'file_choice':
      // File choice step - renders FileChoiceStep component
      // Used when user attaches files to chat and needs to select response mode
      const attachedFiles = step.details?.attachedFiles || [];
      const onFileChoice = step.details?.onFileChoice;
      
      return (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
          <FileQuestion style={{ width: '14px', height: '14px', color: actionColor, flexShrink: 0, marginTop: '2px' }} />
          <div style={{ flex: 1 }}>
            <FileChoiceStep
              attachedFiles={attachedFiles}
              onChoice={(choice) => onFileChoice?.(choice)}
              isVisible={true}
              isDisabled={!isLoading}
            />
          </div>
        </div>
      );
    
    case 'executing':
      // Agent is performing a UI action - show with Play icon
      // Animation active while loading and no response text yet
      const isExecutingActive = isLoading && !hasResponseText;
      return (
        <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: '6px' }}>
          <Play style={{ width: '14px', height: '14px', color: actionColor, flexShrink: 0, marginTop: '2px' }} />
          {isExecutingActive ? (
            <span className="ranking-shimmer-active">{step.message || 'Executing action'}</span>
          ) : (
            <span style={actionStyle}>{step.message || 'Executing action'}</span>
          )}
        </span>
      );
    
    case 'opening':
      // Agent is opening a document/view - refined pill design with Infinity icon
      const isOpeningActive = isLoading && !hasResponseText;
      return (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 10px 4px 8px',
          borderRadius: '6px',
          border: '1px solid rgba(0, 0, 0, 0.08)',
          backgroundColor: 'transparent',
          marginLeft: '-2px', // Align with vertical line
          position: 'relative',
          zIndex: 2, // Above the vertical line
        }}>
          <Infinity style={{ 
            width: '16px', 
            height: '16px', 
            color: actionColor, 
            flexShrink: 0,
            strokeWidth: 2.5 
          }} />
          {isOpeningActive ? (
            <span className="agent-opening-shimmer-active" style={{ fontSize: '13px', fontWeight: 500 }}>{step.message || 'Opening citation view'}</span>
          ) : (
            <span style={{ color: detailColor, fontWeight: 500, fontSize: '13px' }}>{step.message || 'Opening citation view'}</span>
          )}
        </span>
      );
    
    case 'highlighting':
      // Agent is highlighting content in a document - refined pill design with Infinity icon
      const isHighlightingActive = isLoading && !hasResponseText;
      return (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 10px 4px 8px',
          borderRadius: '6px',
          border: '1px solid rgba(0, 0, 0, 0.08)',
          backgroundColor: 'transparent',
          marginLeft: '-2px', // Align with vertical line
          position: 'relative',
          zIndex: 2, // Above the vertical line
        }}>
          <Infinity style={{ 
            width: '16px', 
            height: '16px', 
            color: actionColor, 
            flexShrink: 0,
            strokeWidth: 2.5 
          }} />
          {isHighlightingActive ? (
            <span className="agent-opening-shimmer-active" style={{ fontSize: '13px', fontWeight: 500 }}>{step.message || 'Highlighting content'}</span>
          ) : (
            <span style={{ color: detailColor, fontWeight: 500, fontSize: '13px' }}>{step.message || 'Highlighting content'}</span>
          )}
        </span>
      );
    
    case 'navigating':
      // Agent is navigating to a property/location - orange agentic container with Infinity icon
      const isNavigatingActive = isLoading && !hasResponseText;
      return (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '3px 8px 3px 6px',
          borderRadius: '6px',
          border: '1px solid rgba(251, 191, 36, 0.4)',
          backgroundColor: 'rgba(251, 191, 36, 0.08)',
          marginLeft: '-2px',
          position: 'relative',
          zIndex: 2,
        }}>
          <Infinity style={{ 
            width: '14px', 
            height: '14px', 
            color: '#F59E0B', 
            flexShrink: 0,
            strokeWidth: 2.5 
          }} />
          {isNavigatingActive ? (
            <span className="agent-opening-shimmer-active" style={{ fontSize: '12px' }}>{step.message || 'Navigating to property'}</span>
          ) : (
            <span style={{ color: '#D97706', fontWeight: 500, fontSize: '12px' }}>{step.message || 'Navigating to property'}</span>
          )}
        </span>
      );
    
    case 'opening_map':
      // Agent is opening the map view - orange agentic container with Infinity icon
      const isOpeningMapActive = isLoading && !hasResponseText;
      return (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '3px 8px 3px 6px',
          borderRadius: '6px',
          border: '1px solid rgba(251, 191, 36, 0.4)',
          backgroundColor: 'rgba(251, 191, 36, 0.08)',
          marginLeft: '-2px',
          position: 'relative',
          zIndex: 2,
        }}>
          <Infinity style={{ 
            width: '14px', 
            height: '14px', 
            color: '#F59E0B', 
            flexShrink: 0,
            strokeWidth: 2.5 
          }} />
          {isOpeningMapActive ? (
            <span className="agent-opening-shimmer-active" style={{ fontSize: '12px' }}>{step.message || 'Opening map view'}</span>
          ) : (
            <span style={{ color: '#D97706', fontWeight: 500, fontSize: '12px' }}>{step.message || 'Opening map view'}</span>
          )}
        </span>
      );
    
    case 'selecting_pin':
      // Agent is selecting a property pin - orange agentic container with Infinity icon
      const isSelectingPinActive = isLoading && !hasResponseText;
      return (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '3px 8px 3px 6px',
          borderRadius: '6px',
          border: '1px solid rgba(251, 191, 36, 0.4)',
          backgroundColor: 'rgba(251, 191, 36, 0.08)',
          marginLeft: '-2px',
          position: 'relative',
          zIndex: 2,
        }}>
          <Infinity style={{ 
            width: '14px', 
            height: '14px', 
            color: '#F59E0B', 
            flexShrink: 0,
            strokeWidth: 2.5 
          }} />
          {isSelectingPinActive ? (
            <span className="agent-opening-shimmer-active" style={{ fontSize: '12px' }}>{step.message || 'Selecting property pin'}</span>
          ) : (
            <span style={{ color: '#D97706', fontWeight: 500, fontSize: '12px' }}>{step.message || 'Selecting property pin'}</span>
          )}
        </span>
      );
    
    default:
      // Fallback to message - display as-is
      return <span style={highlightStyle}>{step.message}</span>;
  }
};

/**
 * ReasoningSteps Component
 * 
 * Cursor-style compact stacked list of reasoning steps.
 * Always visible (no dropdown), subtle design, fits seamlessly into chat UI.
 */
export const ReasoningSteps: React.FC<ReasoningStepsProps> = ({ steps, isLoading, onDocumentClick, hasResponseText = false, isAgentMode = true, skipAnimations = false, isNoResultsResponse = false, thoughtCompleted = false, showAllStepsInTrace = false, transientStep }) => {
  // Get current model from context
  const { model } = useModel();
  
  // Track which documents we've already started preloading
  const preloadedDocsRef = useRef<Set<string>>(new Set());
  
  // Track which documents have been shown in reasoning steps (for first-time preview display)
  // Reset when a new query starts (isLoading changes from false to true)
  const shownDocumentsRef = useRef<Set<string>>(new Set());
  const previousLoadingRef = useRef<boolean>(isLoading);
  
  
  // Reset shown documents when a new query starts
  useEffect(() => {
    // If we transition from not loading to loading, it's a new query - reset the tracking
    if (!previousLoadingRef.current && isLoading) {
      shownDocumentsRef.current.clear();
    }
    previousLoadingRef.current = isLoading;
  }, [isLoading]);
  
  // Track when all reading steps have completed
  const [allReadingComplete, setAllReadingComplete] = useState(false);
  
  // Track if we just transitioned from loading to not loading (for stacking animation)
  const wasLoadingRef = useRef(isLoading);
  const [shouldAnimateStack, setShouldAnimateStack] = useState(false);
  
  // REAL-TIME: Transition immediately when loading completes (no artificial delays)
  // Detect transition from loading to not loading
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading) {
      // Start stack animation immediately
      setShouldAnimateStack(true);
      // Reset stack animation after it completes
      const resetTimer = setTimeout(() => {
        setShouldAnimateStack(false);
      }, 300); // Just enough time for stack animation to complete
      return () => {
        clearTimeout(resetTimer);
      };
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading]);
  
  // Filter out "Summarising content" steps (planning action type) and context messages
  // Keep the initial "Planning next moves" step for normal queries so it is not replaced by "Summarising content"
  // Also deduplicate steps to prevent rendering the same step twice
  // In Reader mode, also filter out agent-specific steps (executing, opening, navigating)
  const filteredSteps = useMemo(() => {
    const seen = new Set<string>();
    const result: ReasoningStep[] = [];
    
    steps.forEach((step, originalIdx) => {
      // Skip planning steps except the initial "Planning next moves" (step === 'planning_next_moves')
      if (step.action_type === 'planning' && step.step !== 'planning_next_moves') return;
      
      // Skip context messages entirely - they're redundant with the actual response
      if (step.action_type === 'context') return;
      
      // Skip agent-specific steps in Reader mode (only show in Agent mode)
      if (!isAgentMode && (step.action_type === 'executing' || step.action_type === 'opening' || step.action_type === 'navigating' || step.action_type === 'highlighting' || step.action_type === 'opening_map' || step.action_type === 'selecting_pin')) {
        return;
      }
      
      // Only show "Opening citation view" / "Highlighting content" when the agent did it autonomously.
      // Hide when the step was added from a manual citation click (fromCitationClick === true).
      if ((step.action_type === 'opening' || step.action_type === 'highlighting') && step.fromCitationClick === true) {
        return;
      }
      
      // Deduplicate: Create a unique key for this step.
      // For 'searching': normalize message so "Preparing the value of highlands?" and "Preparing value of highlands" collapse to one.
      // For 'reading': include doc_id so multiple reads of different docs show; for 'exploring' use message + timestamp/index.
      const searchingKey = step.action_type === 'searching' && step.message
        ? step.action_type + '-' + (step.message as string)
            .replace(/\?\.?\s*$/i, '')
            .replace(/^(Finding|Preparing|Searching for|Locating)\s+the\s+/i, '$1 ')
            .trim()
        : '';
      const stepKey = step.action_type === 'reading' && step.details?.doc_metadata?.doc_id
        ? `${step.action_type}-${step.details.doc_metadata.doc_id}-${step.timestamp || originalIdx}`
        : step.action_type === 'searching'
          ? (searchingKey || `${step.action_type}-${step.message}`)
          : step.action_type === 'exploring'
            ? `${step.action_type}-${step.message}-${step.timestamp || originalIdx}`
            : `${step.action_type}-${step.message}-${step.timestamp || originalIdx}`;
      
      // Skip if we've already seen this exact step
      if (seen.has(stepKey)) {
        console.warn('⚠️ Duplicate step filtered out:', { 
          stepKey, 
          action_type: step.action_type, 
          doc_id: step.details?.doc_metadata?.doc_id,
          originalIdx,
          timestamp: step.timestamp
        });
        return;
      }
      
      seen.add(stepKey);
      result.push(step);
    });
    
    // Sort by timestamp to ensure correct order
    // "Planning next moves" placeholder always first when present (avoids appearing at bottom then jumping to top)
    // Searching steps always appear before exploring (Found documents)
    // Steps WITHOUT timestamps come first; steps WITH timestamps sorted ascending
    const isPlanningPlaceholder = (s: ReasoningStep) =>
      s.step === 'planning_next_moves' || (s.action_type === 'summarising' && s.message === 'Planning next moves');
    result.sort((a, b) => {
      const aIsPlanning = isPlanningPlaceholder(a);
      const bIsPlanning = isPlanningPlaceholder(b);
      if (aIsPlanning && !bIsPlanning) return -1;
      if (!aIsPlanning && bIsPlanning) return 1;
      if (a.action_type === 'searching' && b.action_type === 'exploring') return -1;
      if (a.action_type === 'exploring' && b.action_type === 'searching') return 1;
      if (a.timestamp && b.timestamp) {
        return a.timestamp - b.timestamp;  // Both have timestamps - sort ascending
      }
      if (a.timestamp) return 1;   // a has timestamp, b doesn't - a comes AFTER b
      if (b.timestamp) return -1;  // b has timestamp, a doesn't - b comes AFTER a
      return 0;  // Neither has timestamp - maintain original order
    });

    // Show thinking step after reading: place any 'thinking' steps immediately after the last 'reading' step
    // so the UI order is: ...reading docs... → thinking → ...analysing/summarising...
    const thinkingSteps = result.filter(s => s.action_type === 'thinking');
    if (thinkingSteps.length > 0) {
      const rest = result.filter(s => s.action_type !== 'thinking');
      const lastReadingIdx = rest.reduce((acc, s, i) => (s.action_type === 'reading' ? i : acc), -1);
      if (lastReadingIdx >= 0) {
        const before = rest.slice(0, lastReadingIdx + 1);
        const after = rest.slice(lastReadingIdx + 1);
        return [...before, ...thinkingSteps, ...after];
      }
    }
    return result;
  }, [steps]);

  const isPlanningPlaceholder = (s: ReasoningStep) =>
    s.step === 'planning_next_moves' || (s.action_type === 'summarising' && s.message === 'Planning next moves');

  // Remove "Planning next moves" as soon as the very next reasoning step appears (searching, exploring, reading, analysing, etc.).
  // When the only reasoning is "Planning next moves" + a thinking step with trivial content, hide both (simple response).
  const stepsToRender = useMemo(() => {
    if (!filteredSteps || filteredSteps.length === 0) return filteredSteps;
    const hasAnyOtherStep = filteredSteps.some(s => !isPlanningPlaceholder(s));
    let list = filteredSteps;
    if (hasAnyOtherStep) {
      list = filteredSteps.filter(s => !isPlanningPlaceholder(s));
    }
    // Simple response: hide planning and/or thought when the only reasoning is "Planning next moves"
    // (After the block above, list may only contain the thinking step — we still need to hide it if trivial)
    const hasTrivialThinking = list.some(
      s => s.action_type === 'thinking' && isTrivialThinkingContent(s.details?.thinking_content || '')
    );
    const onlyTrivialReasoning = list.every(s =>
      isPlanningPlaceholder(s) ||
      (s.action_type === 'thinking' && isTrivialThinkingContent(s.details?.thinking_content || '')) ||
      s.action_type === 'complete' ||
      s.action_type === 'context'
    );
    if (hasTrivialThinking && onlyTrivialReasoning) {
      list = list.filter(s =>
        !isPlanningPlaceholder(s) &&
        !(s.action_type === 'thinking' && isTrivialThinkingContent(s.details?.thinking_content || ''))
      );
    }
    // When no-results response and still many steps: collapse to first searching + first "No relevant"
    if (isNoResultsResponse && list.length > 2) {
      const firstSearching = list.find(s => s.action_type === 'searching');
      const firstNoRelevant = list.find(s => /No relevant/i.test(s.message || ''));
      const collapsed = [firstSearching, firstNoRelevant].filter((s): s is ReasoningStep => !!s);
      return collapsed.length > 0 ? collapsed : list.slice(0, 2);
    }
    // Hide "Searching" once we have reading steps: show only Found + Read... (searching step disappears, reading steps appear)
    // When showAllStepsInTrace (e.g. expanded Thought dropdown), keep all steps including Searching
    if (!showAllStepsInTrace && list.some(s => s.action_type === 'reading')) {
      list = list.filter(s => s.action_type !== 'searching');
    }
    // UX: When thought is completed (collapsed trace), also hide searching so we show Found + reading list only
    if (thoughtCompleted && !showAllStepsInTrace) {
      list = list.filter(s => s.action_type !== 'searching');
    }
    // Only show "Analysing X documents" exploring step when more than one document (in live view; show all in full trace)
    if (!showAllStepsInTrace) {
      const isAnalysingOneDocumentStep = (s: ReasoningStep) => {
        if (s.action_type !== 'exploring') return false;
        const msg = s.message || '';
        const colonIdx = msg.indexOf(': ');
        const prefix = colonIdx > -1 ? msg.substring(0, colonIdx) : msg;
        return /^Analysing\s+1\s+document\s*:?$/i.test(prefix.trim());
      };
      list = list.filter(s => !isAnalysingOneDocumentStep(s));
    }

    // When we already show "Analysing N documents:" (exploring) with Reading sub-steps, hide the redundant
    // "Analyzing documents" step (from query_vector_documents: "Analysing N documents for your question")
    const hasAnalysingDocsExploring = list.some(
      (s) => s.action_type === 'exploring' && /^Analysing\s+\d+\s+documents?\s*:?/i.test((s.message || '').trim())
    );
    if (hasAnalysingDocsExploring) {
      list = list.filter((s) => {
        if (s.action_type !== 'analysing') return true;
        const msg = (s.message || '').trim();
        // Remove generic "Analysing N documents for your question" when we already have "Analysing N documents:" header
        if (/^Analysing\s+\d+\s+documents?\s+for\s+your\s+question$/i.test(msg)) return false;
        if (/^Analysing\s+\d+\s+documents?$/i.test(msg)) return false;
        return true;
      });
    }

    // When we have reading steps, hide the standalone "Analysing" step that would appear below (label is on each reading line)
    // Keep only "Summarising content" / "Formulating answer" / "Preparing answer" / "Preparing response"
    const isPreparingResponseMessage = (m: string) => /^(Summarising content|Formulating answer|Preparing answer|Preparing response|Generating response)/i.test(m.trim());
    if (list.some(s => s.action_type === 'reading')) {
      list = list.filter((s) => {
        if (s.action_type !== 'analysing') return true;
        const msg = (s.message || '').trim();
        if (isPreparingResponseMessage(msg)) return true;
        if (msg === 'Thinking') return true; // Keep "Thinking" step that replaces Analysing block
        return false; // hide all other analysing steps (Analysing, Analysing N documents, etc.)
      });
    }

    // When we have a "Thinking" step that replaces the Analysing + documents block (after chunk retrieval),
    // remove the exploring step (if present) and its reading steps so only "Thinking" is shown.
    // When showAllStepsInTrace, keep all steps (Analysing, Reading, Thinking, Generating response) in sequence.
    if (!showAllStepsInTrace) {
      const thinkingReplacesIdx = list.findIndex(
        (s) => s.step === 'thinking_after_chunks' || (s.details as any)?.replaces_analysing === true
      );
      if (thinkingReplacesIdx >= 0) {
        let endBlock = thinkingReplacesIdx - 1;
        while (endBlock >= 0 && list[endBlock].action_type === 'reading') endBlock--;
        const isAnalysingDocsExploring = (s: ReasoningStep) =>
          s.action_type === 'exploring' && /^Analysing\s+\d+\s+documents?\s*:?/i.test((s.message || '').trim());
        const removeFrom = endBlock >= 0 && isAnalysingDocsExploring(list[endBlock]) ? endBlock : endBlock + 1;
        if (removeFrom <= thinkingReplacesIdx - 1) {
          list = [...list.slice(0, removeFrom), list[thinkingReplacesIdx], ...list.slice(thinkingReplacesIdx + 1)];
        }
      }
    }

    // When "Generating response" is present, it replaces "Thinking" (show only one - the current phase)
    // When showAllStepsInTrace, show both Thinking and Generating response in sequence
    const hasGeneratingResponse = list.some(
      (s) => s.step === 'generating_response' || (s.message || '').trim() === 'Generating response'
    );
    if (hasGeneratingResponse && !showAllStepsInTrace) {
      list = list.filter(
        (s) =>
          s.step !== 'thinking_after_chunks' &&
          (s.details as any)?.replaces_analysing !== true &&
          ((s.message || '').trim() !== 'Thinking' || s.action_type !== 'analysing')
      );
    }

    // Hide "Generating response" once response is streaming (prompt was sent; step disappears when first token arrives)
    // When showAllStepsInTrace (expanded Thought dropdown), keep it so the full trace is visible
    if (hasResponseText && !showAllStepsInTrace) {
      list = list.filter(
        (s) => s.step !== 'generating_response' && (s.message || '').trim() !== 'Generating response'
      );
    }

    return list;
  }, [filteredSteps, isNoResultsResponse, thoughtCompleted, hasResponseText, showAllStepsInTrace]);

  // When transientStep is set (e.g. "Thinking"), show it as the current step without adding to stored steps (parallel, not sequential)
  const stepsForDisplay = useMemo(() => {
    if (!stepsToRender) return stepsToRender;
    if (transientStep && isLoading) {
      const synthetic: ReasoningStep = {
        step: 'thinking',
        action_type: 'analysing', // same style as "Summarising content" (simple label, not ThinkingBlock)
        message: transientStep.message,
        details: {},
        timestamp: Date.now()
      };
      return [...stepsToRender, synthetic];
    }
    return stepsToRender;
  }, [stepsToRender, transientStep, isLoading]);

  // Preload document covers IMMEDIATELY when documents are found (optimized for instant thumbnail loading)
  // Runs whenever steps change (during and after loading) so thumbnails are ready the moment the card opens
  useEffect(() => {
    // Find exploring steps with doc_previews (these contain documents we'll show)
    const exploringSteps = steps.filter(s => s.action_type === 'exploring');
    const docPreviews = exploringSteps.flatMap(s => s.details?.doc_previews || []);
    
    // Also preload from reading steps that might come later
    const readingSteps = steps.filter(s => s.action_type === 'reading');
    const readingDocs = readingSteps
      .map(s => s.details?.doc_metadata)
      .filter((meta): meta is NonNullable<typeof meta> => !!meta);
    
    // Combine all documents to preload
    const allDocs = [...docPreviews, ...readingDocs];
    
    // Preload each document IMMEDIATELY in parallel (only if not already started)
    // Use Promise.all for parallel loading to maximize speed
    const preloadPromises: Promise<void>[] = [];
    allDocs.forEach(doc => {
      if (doc.doc_id && !preloadedDocsRef.current.has(doc.doc_id)) {
        preloadedDocsRef.current.add(doc.doc_id);
        // Start preloading immediately - don't await, let them run in parallel
        preloadPromises.push(
          preloadDocumentCover(doc).catch(err => {
            // Silently fail - preview will load on demand
            console.warn(`Failed to preload document ${doc.doc_id}:`, err);
          })
        );
      }
    });
  }, [steps, isLoading, isAgentMode]);
  
  // Count total reading steps and track indices
  const totalReadingSteps = filteredSteps.filter(s => s.action_type === 'reading').length;
  let readingStepCounter = 0;
  
  // Track when all reading steps are complete (all documents read)
  // Reading is complete when:
  // 1. We have reading steps
  // 2. All reading steps have status 'read' (completed)
  // 3. OR when loading finishes and we had reading steps
  useEffect(() => {
    if (totalReadingSteps === 0) {
      setAllReadingComplete(false);
      return;
    }
    
    // Check if all reading steps are marked as 'read' (completed)
    const readingSteps = filteredSteps.filter(s => s.action_type === 'reading');
    const allRead = readingSteps.length > 0 && 
                    readingSteps.every(step => step.details?.status === 'read');
    
    // Also consider complete if loading finished and we have reading steps
    const isComplete = allRead || (!isLoading && totalReadingSteps > 0);
    
    setAllReadingComplete(isComplete);
  }, [isLoading, totalReadingSteps, filteredSteps]);
  
  // Pre-compute animated steps array using useMemo to avoid IIFE issues (uses stepsForDisplay for display)
  const animatedSteps = useMemo(() => {
    if (!isLoading || !stepsForDisplay || stepsForDisplay.length === 0) {
      return [];
    }
    
    let readingCounter = 0;
    let hasSeenReading = false;
    let lastStepWasExploring = false;
    let previousStepDelay = 0;
    
    return stepsForDisplay
      .filter((step) => step != null && step !== undefined)
      .map((step, idx) => {
        let currentReadingIndex = 0;
        let isLastReadingStep = false;
        
        // Check if previous step was exploring/found_documents
        const prevStep = idx > 0 ? stepsForDisplay[idx - 1] : null;
        const isAfterExploring = prevStep && (prevStep.action_type === 'exploring' || prevStep.action_type === 'searching');
        
        if (step.action_type === 'reading') {
          currentReadingIndex = readingCounter;
          isLastReadingStep = (readingCounter === totalReadingSteps - 1);
          readingCounter++;
          hasSeenReading = true;
        }
        
        // Track if this is an exploring step for next iteration
        if (step.action_type === 'exploring' || step.action_type === 'searching') {
          lastStepWasExploring = true;
        } else {
          lastStepWasExploring = false;
        }
        
        const stepId = step.details?.doc_metadata?.doc_id 
          || step.details?.filename 
          || step.timestamp 
          || idx;
        
        const finalStepKey = generateAnimatePresenceKey(
          'ReasoningStep',
          idx,
          stepId,
          step.action_type || 'unknown'
        );
        
        // Sequential flow: each step appears after the previous one completes
        // Fast stagger for responsive feel
        let stepDelay = idx * 0.08; // 80ms stagger - quick sequential reveal
        if (step.action_type === 'reading') {
          // If reading step comes right after exploring/found_documents, make it appear almost instantly
          if (isAfterExploring) {
            // Appear immediately after the previous step (exploring) with just a tiny delay for smoothness
            stepDelay = previousStepDelay + 0.01; // 10ms after previous step appears
          } else {
            stepDelay = idx * 0.05; // Fast for reading steps (50ms) - appear quickly after document found
          }
        } else if (hasSeenReading) {
          stepDelay = idx * 0.10; // Faster for steps after reading (100ms)
        }
        
        // Store this step's delay for the next iteration
        previousStepDelay = stepDelay;
        
        return {
          step,
          stepKey: finalStepKey,
          delay: stepDelay,
          readingIndex: currentReadingIndex,
          isLastReadingStep,
          stepIndex: idx
        };
      });
  }, [stepsForDisplay, isLoading, totalReadingSteps]);

  type DisplayItem =
    | { kind: 'single'; step: ReasoningStep; stepIndex: number }
    | { kind: 'group'; exploringStep: ReasoningStep; readingSteps: ReasoningStep[]; exploringStepIndex: number };

  const displayItems = useMemo((): DisplayItem[] => {
    if (!stepsForDisplay || stepsForDisplay.length === 0) return [];
    const items: DisplayItem[] = [];
    let i = 0;
    while (i < stepsForDisplay.length) {
      const step = stepsForDisplay[i];
      if (step.action_type === 'exploring' && step.message) {
        const colonIdx = step.message.indexOf(': ');
        const prefix = colonIdx > -1 ? step.message.substring(0, colonIdx) : step.message;
        const analysingMatch = prefix.trim().match(/^Analysing\s+(\d+)\s+documents?\s*:?$/i);
        const n = analysingMatch ? parseInt(analysingMatch[1], 10) : 0;
        if (n > 1) {
          const readingSteps: ReasoningStep[] = [];
          let j = i + 1;
          while (j < stepsForDisplay.length && stepsForDisplay[j].action_type === 'reading') {
            readingSteps.push(stepsForDisplay[j]);
            j++;
          }
          if (readingSteps.length > 0) {
            items.push({ kind: 'group', exploringStep: step, readingSteps, exploringStepIndex: i });
            i = j;
            continue;
          }
        }
      }
      items.push({ kind: 'single', step, stepIndex: i });
      i++;
    }
    return items;
  }, [stepsForDisplay]);

  const [documentsDropdownStepKey, setDocumentsDropdownStepKey] = useState<string | null>(null);
  
  // Single planning step: use same layout as "no steps" so "Planning next moves" doesn't jump when backend sends the step
  const onlyPlanningStep =
    isLoading &&
    animatedSteps.length === 1 &&
    (animatedSteps[0].step.step === 'planning_next_moves' ||
      (animatedSteps[0].step.action_type === 'summarising' && animatedSteps[0].step.message === 'Planning next moves'));
  
  // Don't render if no steps (or when only step is planning - keep same layout to avoid jump)
  if (!filteredSteps || filteredSteps.length === 0 || onlyPlanningStep) {
    // Show planning indicator when loading but no steps yet, or when the only step is "Planning next moves"
    // Using one consistent block avoids: appear in one place → then move up when the planning step arrives
    if (isLoading) {
      return (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
          style={{
            marginBottom: '6px',
            padding: '6px 10px 6px 0',
            marginLeft: '4px',
            backgroundColor: 'transparent',
            borderRadius: '8px',
            border: 'none',
            position: 'relative',
            contain: 'layout style',
            minHeight: '20px'
          }}
        >
          <PlanningIndicator />
          
          {/* CSS for shimmer animations */}
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
            
            .reasoning-loading-spinner {
              animation: spin 0.5s linear infinite;
            }
            
            .planning-shimmer-full {
              background: linear-gradient(90deg, #6B7280 0%, #9CA3AF 25%, #D1D5DB 50%, #9CA3AF 75%, #6B7280 100%);
              background-size: 300% 100%;
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
              animation: shimmer-full 0.8s ease-in-out infinite;
              font-weight: 500;
            }
            
            .reading-step-reveal {
              opacity: 0;
              animation: reveal-step 0.3s ease-out forwards;
            }
            
            .reading-shimmer-sequential {
              color: #374151;
              font-weight: 500;
              animation: reading-shimmer 0.5s ease-in-out 1;
              animation-fill-mode: forwards;
            }
            
            /* Active reading - OpenAI/Claude-style sophisticated blue-gray flow animation */
            .reading-shimmer-active {
              font-weight: 500;
              background: linear-gradient(
                90deg, 
                #475569 0%,      /* slate-600 - deep base */
                #64748B 20%,     /* slate-500 - medium */
                #94A3B8 35%,     /* slate-400 - light */
                #CBD5E1 50%,     /* slate-300 - peak */
                #94A3B8 65%,     /* slate-400 - light */
                #64748B 80%,     /* slate-500 - medium */
                #475569 100%     /* slate-600 - deep base */
              );
              background-size: 350% 100%;
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
              animation: reading-glow 0.8s ease infinite;
              filter: drop-shadow(0 0 1px rgba(100, 116, 139, 0.2));
            }
            
            /* Reading document container – inset moving line (inside border) */
            .reading-border-ring {
              border-radius: 5px;
            }
            .reading-border-segment {
              animation: reading-border-rotate 1.2s linear infinite;
            }
            .reading-border-ring-inner {
              border-radius: 2.5px;
            }
            @keyframes reading-border-rotate {
              to { transform: rotate(360deg); }
            }
            
            /* Searching - flowing gradient animation (cyan/blue) */
            .searching-shimmer-active {
              font-weight: 500;
              background: linear-gradient(
                90deg, 
                #0891B2 0%,      /* cyan-600 - deep base */
                #06B6D4 15%,     /* cyan-500 */
                #22D3EE 35%,     /* cyan-400 - main accent */
                #67E8F9 50%,     /* cyan-300 - peak highlight */
                #22D3EE 65%,     /* cyan-400 */
                #06B6D4 85%,     /* cyan-500 */
                #0891B2 100%     /* cyan-600 - deep base */
              );
              background-size: 200% 100%;
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
              animation: searching-glow 0.9s cubic-bezier(0.4, 0, 0.2, 1) infinite;
            }
            
            @keyframes searching-glow {
              0% { 
                background-position: 100% 0;
                filter: brightness(1);
              }
              50% {
                filter: brightness(1.1);
              }
              100% { 
                background-position: -100% 0;
                filter: brightness(1);
              }
            }
            
            /* Ranking - flowing gradient animation (same as planning) */
            .ranking-shimmer-active {
              font-weight: 500;
              background: linear-gradient(90deg, #6B7280 0%, #9CA3AF 25%, #D1D5DB 50%, #9CA3AF 75%, #6B7280 100%);
              background-size: 300% 100%;
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
              animation: shimmer-full 0.8s ease-in-out infinite;
            }
            
            /* Agent opening/highlighting - orange flowing gradient animation */
            .agent-opening-shimmer-active {
              font-weight: 500;
              background: linear-gradient(
                90deg, 
                #D97706 0%,
                #F59E0B 20%,
                #F4C085 40%,
                #FBBF24 50%,
                #F4C085 60%,
                #F59E0B 80%,
                #D97706 100%
              );
              background-size: 300% 100%;
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
              animation: agent-shimmer 0.8s ease-in-out infinite;
            }
            
            @keyframes agent-shimmer {
              0% { background-position: 100% 0; }
              100% { background-position: -100% 0; }
            }
            
            @keyframes reading-glow {
              0% { 
                background-position: 150% 0;
                filter: brightness(1);
              }
              50% {
                filter: brightness(1.08);
              }
              100% { 
                background-position: -150% 0;
                filter: brightness(1);
              }
            }
            
            @keyframes shimmer-full {
              0% { background-position: 100% 0; }
              100% { background-position: -100% 0; }
            }
            
            /* Override for searching shimmer to use faster animation */
            .searching-shimmer-active {
              animation: shimmer-full 0.8s ease-in-out infinite !important;
            }
            
            @keyframes reveal-step {
              0% {
                opacity: 0;
                transform: translateX(-8px);
              }
              100% {
                opacity: 1;
                transform: translateX(0);
              }
            }
            
            @keyframes reading-shimmer {
              0% {
                background: linear-gradient(90deg, #475569 0%, #64748B 15%, #94A3B8 35%, #CBD5E1 50%, #94A3B8 65%, #64748B 85%, #475569 100%);
                background-size: 200% 100%;
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                background-position: 100% 0;
              }
              50% {
                background: linear-gradient(90deg, #475569 0%, #64748B 15%, #94A3B8 35%, #CBD5E1 50%, #94A3B8 65%, #64748B 85%, #475569 100%);
                background-size: 200% 100%;
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                background-position: -100% 0;
              }
              100% {
                background: none;
                -webkit-background-clip: unset;
                -webkit-text-fill-color: #374151;
                background-clip: unset;
                color: #374151;
              }
            }
          `}</style>
        </motion.div>
      );
    }
    return null;
  }

  // Determine if we should show planning indicator
  // 1. Show initially when loading but no steps yet (handled in early return above)
  // 2. Hide when first step appears
  // 3. Show again after all reading steps complete, before response
  // 4. Never show the bottom block if "Planning next moves" is already in the steps list (placeholder or summarising step)
  //    — avoids duplicate appearing at bottom then at top
  const hasSteps = animatedSteps.length > 0;
  const hasPlanningInList = filteredSteps.some(
    s => s.step === 'planning_next_moves' || (s.action_type === 'summarising' && s.message === 'Planning next moves')
  );
  const shouldShowPlanningAfterReading = isLoading && hasSteps && allReadingComplete && totalReadingSteps > 0 && !hasPlanningInList;
  
  // Check if planning indicator should animate (only if it's the current active step)
  const isPlanningActive = shouldShowPlanningAfterReading;
  
  return (
    <div style={{
      marginBottom: '6px',
      padding: '6px 10px 6px 0', // No shorthand/longhand mix to avoid React style warning
      marginLeft: '4px', // Align slightly right of query bubbles' left starting position
      backgroundColor: 'transparent',
      borderRadius: '8px',
      border: 'none',
      position: 'relative',
      contain: 'layout style',
      minHeight: '1px' // Prevent collapse
    }}>
      {/* Steps stacked vertically - always visible */}
      {isLoading && animatedSteps.length > 0 ? (
        <AnimatePresence mode="wait">
          {displayItems.map((displayItem, displayIdx) => {
            const isLastDisplayItem = displayIdx === displayItems.length - 1;
            const marginBottom = isLastDisplayItem ? '0' : '1px';

            if (displayItem.kind === 'group') {
              const anim = animatedSteps[displayItem.exploringStepIndex];
              const groupKey = anim.stepKey + '-group';
              return (
                <motion.div
                  key={groupKey}
                  initial={skipAnimations ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 2, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  transition={(hasResponseText || skipAnimations) ? { duration: 0 } : { duration: 0.08, delay: anim.delay, ease: [0.16, 1, 0.3, 1] }}
                  style={{
                    fontSize: '13.1px',
                    color: DETAIL_COLOR,
                    padding: '0',
                    lineHeight: 1.35,
                    overflow: 'visible',
                    position: 'relative',
                    marginBottom,
                    contain: 'layout style',
                  }}
                >
                  <StepRenderer
                    step={displayItem.exploringStep}
                    allSteps={stepsForDisplay}
                    stepIndex={displayItem.exploringStepIndex}
                    isLoading={isLoading}
                    readingStepIndex={0}
                    hasResponseText={hasResponseText}
                    isLastReadingStep={false}
                    totalReadingSteps={displayItem.readingSteps.length}
                    onDocumentClick={onDocumentClick}
                    shownDocumentsRef={shownDocumentsRef}
                    allReadingComplete={allReadingComplete}
                    model={model}
                    thoughtCompleted={thoughtCompleted}
                    documentsDropdown={{
                      stepKey: anim.stepKey,
                      readingSteps: displayItem.readingSteps,
                      isOpen: documentsDropdownStepKey === anim.stepKey,
                      onOpenChange: (open) => setDocumentsDropdownStepKey(open ? anim.stepKey : null),
                    }}
                  />
                </motion.div>
              );
            }

            const anim = animatedSteps[displayItem.stepIndex];
            const { step, stepKey: finalStepKey, delay: stepDelay, readingIndex: currentReadingIndex, isLastReadingStep, stepIndex: idx } = anim;

            return (
              <motion.div
                key={finalStepKey}
                initial={skipAnimations ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 2, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                transition={(hasResponseText || skipAnimations) ? { duration: 0 } : { duration: 0.08, delay: stepDelay, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  fontSize: '13.1px',
                  color: DETAIL_COLOR,
                  padding: '0',
                  lineHeight: 1.35,
                  overflow: 'visible',
                  position: 'relative',
                  marginBottom,
                  contain: 'layout style',
                }}
              >
                <StepRenderer
                  step={step}
                  allSteps={stepsForDisplay}
                  stepIndex={idx}
                  isLoading={isLoading}
                  readingStepIndex={currentReadingIndex}
                  hasResponseText={hasResponseText}
                  isLastReadingStep={isLastReadingStep}
                  totalReadingSteps={totalReadingSteps}
                  onDocumentClick={onDocumentClick}
                  shownDocumentsRef={shownDocumentsRef}
                  allReadingComplete={allReadingComplete}
                  model={model}
                  thoughtCompleted={thoughtCompleted}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      ) : (
        // When not loading (trace mode), render display items (groups exploring + reading into dropdown)
        <div key="reasoning-steps-static">
          {displayItems.map((displayItem, displayIdx) => {
            const isLastDisplayItem = displayIdx === displayItems.length - 1;
            const marginBottom = isLastDisplayItem ? '0' : '1px';

            if (displayItem.kind === 'group') {
              const groupKey = generateAnimatePresenceKey('ReasoningStep', displayItem.exploringStepIndex, displayItem.exploringStep.details?.doc_previews?.length ?? 0, 'exploring-group');
              return (
                <div
                  key={groupKey}
                  style={{
                    fontSize: '13.1px',
                    color: DETAIL_COLOR,
                    padding: '0',
                    lineHeight: 1.35,
                    position: 'relative',
                    marginBottom,
                  }}
                >
                  <StepRenderer
                    step={displayItem.exploringStep}
                    allSteps={stepsForDisplay}
                    stepIndex={displayItem.exploringStepIndex}
                    isLoading={isLoading}
                    readingStepIndex={0}
                    hasResponseText={hasResponseText}
                    isLastReadingStep={false}
                    totalReadingSteps={displayItem.readingSteps.length}
                    onDocumentClick={onDocumentClick}
                    shownDocumentsRef={shownDocumentsRef}
                    allReadingComplete={allReadingComplete}
                    model={model}
                    thoughtCompleted={thoughtCompleted}
                    documentsDropdown={{
                      stepKey: groupKey,
                      readingSteps: displayItem.readingSteps,
                      isOpen: documentsDropdownStepKey === groupKey,
                      onOpenChange: (open) => setDocumentsDropdownStepKey(open ? groupKey : null),
                    }}
                  />
                </div>
              );
            }

            const step = displayItem.step;
            const idx = displayItem.stepIndex;
            const stepId = step.details?.doc_metadata?.doc_id || step.details?.filename || step.timestamp || idx;
            const finalStepKey = generateAnimatePresenceKey('ReasoningStep', idx, stepId, step.action_type || 'unknown');
            const isReadingStep = step.action_type === 'reading';
            const readingStepIndex = isReadingStep ? stepsForDisplay.slice(0, idx).filter(s => s.action_type === 'reading').length : 0;
            const allReadingSteps = stepsForDisplay.filter(s => s.action_type === 'reading');
            const isLastReadingStep = isReadingStep && readingStepIndex === allReadingSteps.length - 1;

            return (
              <div
                key={finalStepKey}
                style={{
                  fontSize: '13.1px',
                  color: DETAIL_COLOR,
                  padding: '0',
                  lineHeight: 1.35,
                  position: 'relative',
                  marginBottom,
                }}
              >
                <StepRenderer
                  step={step}
                  allSteps={stepsForDisplay}
                  stepIndex={idx}
                  isLoading={isLoading}
                  readingStepIndex={readingStepIndex}
                  hasResponseText={hasResponseText}
                  isLastReadingStep={isLastReadingStep}
                  totalReadingSteps={allReadingSteps.length}
                  onDocumentClick={onDocumentClick}
                  shownDocumentsRef={shownDocumentsRef}
                  allReadingComplete={allReadingComplete}
                  model={model}
                  thoughtCompleted={thoughtCompleted}
                />
              </div>
            );
          })}
        </div>
      )}
      
      {/* Show planning indicator after reading steps complete, before response (at the bottom) */}
      {shouldShowPlanningAfterReading && (
        <AnimatePresence>
          <motion.div
            key="planning-indicator-after-reading"
            initial={{ opacity: 0, y: 2, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            style={{ marginTop: '8px' }}
          >
            {isPlanningActive ? (
              <PlanningIndicator />
            ) : (
              <div style={{ fontSize: '13.1px', color: ACTION_COLOR, fontWeight: 500 }}>
                Planning next moves
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}
      
      {/* CSS for shimmer animations - sequential reveal and green flash for reading */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        .reasoning-loading-spinner {
          animation: spin 0.5s linear infinite;
        }
        
        .planning-shimmer-full {
          background: linear-gradient(90deg, #6B7280 0%, #9CA3AF 25%, #D1D5DB 50%, #9CA3AF 75%, #6B7280 100%);
          background-size: 300% 100%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer-full 0.8s ease-in-out infinite;
          font-weight: 500;
        }
        
        @keyframes preparing-response-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
        .preparing-response-icon-pulse {
          animation: preparing-response-pulse 1.2s ease-in-out infinite;
        }
        
        /* Searching - flowing gradient animation (same as planning) */
        .searching-shimmer-active {
          font-weight: 500;
          background: linear-gradient(90deg, #6B7280 0%, #9CA3AF 25%, #D1D5DB 50%, #9CA3AF 75%, #6B7280 100%);
          background-size: 300% 100%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer-full 0.8s ease-in-out infinite;
        }
        
        /* Ranking - flowing gradient animation (same as planning) */
        .ranking-shimmer-active {
          font-weight: 500;
          background: linear-gradient(90deg, #6B7280 0%, #9CA3AF 25%, #D1D5DB 50%, #9CA3AF 75%, #6B7280 100%);
          background-size: 300% 100%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer-full 0.8s ease-in-out infinite;
        }
        
        /* Agent opening/highlighting - orange flowing gradient animation */
        .agent-opening-shimmer-active {
          font-weight: 500;
          background: linear-gradient(
            90deg, 
            #D97706 0%,      /* amber-600 - darker orange */
            #F59E0B 20%,     /* amber-500 - medium orange */
            #F4C085 40%,     /* agent orange - main */
            #FBBF24 50%,     /* amber-400 - peak highlight */
            #F4C085 60%,     /* agent orange - main */
            #F59E0B 80%,     /* amber-500 - medium orange */
            #D97706 100%     /* amber-600 - darker orange */
          );
          background-size: 300% 100%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: agent-shimmer 0.8s ease-in-out infinite;
        }
        
        @keyframes agent-shimmer {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
        
        .reading-step-reveal {
          opacity: 0;
          animation: reveal-step 0.3s ease-out forwards;
        }
        
        .reading-shimmer-sequential {
          color: #374151;
          font-weight: 500;
          animation: reading-shimmer 0.5s ease-in-out 1;
          animation-fill-mode: forwards;
        }
        
            /* Active reading - OpenAI/Claude-style sophisticated blue-gray flow animation */
            .reading-shimmer-active {
              font-weight: 500;
              background: linear-gradient(
                90deg, 
                #475569 0%,      /* slate-600 - deep base */
                #64748B 20%,     /* slate-500 - medium */
                #94A3B8 35%,     /* slate-400 - light */
                #CBD5E1 50%,     /* slate-300 - peak */
                #94A3B8 65%,     /* slate-400 - light */
                #64748B 80%,     /* slate-500 - medium */
                #475569 100%     /* slate-600 - deep base */
              );
              background-size: 350% 100%;
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
              animation: reading-glow 0.8s ease infinite;
              filter: drop-shadow(0 0 1px rgba(100, 116, 139, 0.2));
            }
            
            /* Reading document container – inset moving line (inside border) */
            .reading-border-ring {
              border-radius: 5px;
            }
            .reading-border-segment {
              animation: reading-border-rotate 1.2s linear infinite;
            }
            .reading-border-ring-inner {
              border-radius: 2.5px;
            }
            @keyframes reading-border-rotate {
              to { transform: rotate(360deg); }
            }
            
            @keyframes rotateAtom {
              from {
                transform: rotateY(0deg);
              }
              to {
                transform: rotateY(360deg);
              }
            }
            
            /* Searching - flowing gradient animation (same as planning) */
            .searching-shimmer-active {
              font-weight: 500;
              background: linear-gradient(90deg, #6B7280 0%, #9CA3AF 25%, #D1D5DB 50%, #9CA3AF 75%, #6B7280 100%);
              background-size: 300% 100%;
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
              animation: shimmer-full 0.8s ease-in-out infinite;
            }
            
            /* Ranking - flowing gradient animation (same as planning) */
            .ranking-shimmer-active {
              font-weight: 500;
              background: linear-gradient(90deg, #6B7280 0%, #9CA3AF 25%, #D1D5DB 50%, #9CA3AF 75%, #6B7280 100%);
              background-size: 300% 100%;
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
              animation: shimmer-full 0.8s ease-in-out infinite;
            }
            
            @keyframes reading-glow {
              0% { 
                background-position: 150% 0;
                filter: brightness(1);
              }
              50% {
                filter: brightness(1.08);
              }
              100% { 
                background-position: -150% 0;
                filter: brightness(1);
              }
            }
        
        @keyframes shimmer-full {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
        
        @keyframes reveal-step {
          0% {
            opacity: 0;
            transform: translateX(-8px);
          }
          100% {
            opacity: 1;
            transform: translateX(0);
          }
        }
        
        @keyframes reading-shimmer {
          0% {
            background: linear-gradient(90deg, #475569 0%, #64748B 15%, #94A3B8 35%, #CBD5E1 50%, #94A3B8 65%, #64748B 85%, #475569 100%);
            background-size: 200% 100%;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            background-position: 100% 0;
          }
          50% {
            background: linear-gradient(90deg, #475569 0%, #64748B 15%, #94A3B8 35%, #CBD5E1 50%, #94A3B8 65%, #64748B 85%, #475569 100%);
            background-size: 200% 100%;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            background-position: -100% 0;
          }
          100% {
            background: none;
            -webkit-background-clip: unset;
            -webkit-text-fill-color: #374151;
            background-clip: unset;
            color: #374151;
          }
        }
        
        /* Smooth reveal animation for reading section only - progressively reveals text from left to right with soft fade */
        /* Isolated animation - no conflicts with other animations */
        .reading-reveal-text {
          position: relative;
          display: inline-block;
          overflow: visible; /* allow glow (box-shadow) on filename pill to render */
        }
        
        .reading-reveal-text::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: inherit;
          /* Gradient: mostly black (hides text) with very wide, gradual blur transition zone */
          /* Very wide transition (60% to 100%) creates soft fade with no definitive boundary */
          /* Much larger mask-size creates smoother, more gradual transition across text */
          mask-image: linear-gradient(90deg, black 0%, black 60%, transparent 100%);
          -webkit-mask-image: linear-gradient(90deg, black 0%, black 60%, transparent 100%);
          mask-size: 500% 100%;
          -webkit-mask-size: 500% 100%;
          mask-repeat: no-repeat;
          -webkit-mask-repeat: no-repeat;
          mask-position: 0% 0;
          -webkit-mask-position: 0% 0;
          animation: reading-reveal-text 0.8s ease-in-out infinite;
          pointer-events: none;
          z-index: 1;
        }
        
        @keyframes reading-reveal-text {
          0% {
            mask-position: 0% 0;
            -webkit-mask-position: 0% 0;
          }
          100% {
            /* Move mask to fully reveal text (accounting for 500% mask-size) */
            mask-position: -400% 0;
            -webkit-mask-position: -400% 0;
          }
        }
        
        /* Smooth blur reveal animation for "Analysing X documents:" - reveals icon and text together from left to right */
        .found-reveal-text {
          position: relative;
          display: inline-flex;
          align-items: flex-start;
          overflow: hidden;
        }
        
        .found-reveal-text::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: inherit;
          /* Gradient: mostly black (hides content) with wide, gradual blur transition zone */
          mask-image: linear-gradient(90deg, black 0%, black 60%, transparent 100%);
          -webkit-mask-image: linear-gradient(90deg, black 0%, black 60%, transparent 100%);
          mask-size: 500% 100%;
          -webkit-mask-size: 500% 100%;
          mask-repeat: no-repeat;
          -webkit-mask-repeat: no-repeat;
          mask-position: 0% 0;
          -webkit-mask-position: 0% 0;
          animation: found-reveal-text 0.8s ease-out forwards;
          pointer-events: none;
          z-index: 1;
        }
        
        @keyframes found-reveal-text {
          0% {
            mask-position: 0% 0;
            -webkit-mask-position: 0% 0;
          }
          100% {
            /* Move mask to fully reveal content (accounting for 500% mask-size) */
            mask-position: -400% 0;
            -webkit-mask-position: -400% 0;
          }
        }
        
      `}</style>
    </div>
  );
};

export default ReasoningSteps;

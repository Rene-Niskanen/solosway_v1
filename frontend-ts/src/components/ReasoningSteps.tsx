import React, { useMemo, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DocumentPreviewCard, StackedDocumentPreviews } from './DocumentPreviewCard';
import { generateAnimatePresenceKey, generateUniqueKey } from '../utils/keyGenerator';
import * as pdfjs from 'pdfjs-dist';

// Import worker for PDF.js (same as DocumentPreviewCard)
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set worker source for PDF thumbnail generation during preload
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Types for reasoning steps
export interface ReasoningStep {
  step: string;
  action_type: 'planning' | 'exploring' | 'searching' | 'reading' | 'analyzing' | 'complete' | 'context';
  message: string;
  count?: number;
  target?: string;
  line_range?: string;
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
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
    let fetchUrl: string;
    
    // Prioritize s3_path for faster downloads (direct S3 access)
    if (doc.s3_path) {
      fetchUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(doc.s3_path)}`;
    } else if (doc.download_url) {
      fetchUrl = doc.download_url.startsWith('http') ? doc.download_url : `${backendUrl}${doc.download_url}`;
    } else {
      fetchUrl = `${backendUrl}/api/files/download?document_id=${doc.doc_id}`;
    }
    
    console.log(`🔄 [Preload] Starting: ${displayName}`);
    
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
          console.log(`✅ [Preload] PDF thumbnail ready: ${displayName}`);
        } else {
          // Fallback - at least cache the URL
          (window as any).__preloadedDocumentCovers[doc.doc_id] = {
            url: url,
            type: blob.type,
            timestamp: Date.now()
          };
          console.log(`⚠️ [Preload] PDF cached (no thumbnail): ${displayName}`);
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
      console.log(`✅ [Preload] Image ready: ${displayName}`);
    } else {
      // For other files, just cache the URL
      (window as any).__preloadedDocumentCovers[doc.doc_id] = {
        url: url,
        type: blob.type,
        timestamp: Date.now()
      };
      console.log(`✅ [Preload] Document cached: ${displayName}`);
    }
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
}

// Reading step - always shows "Reading" animation briefly before "Read" for natural feel
// Backend emits reading steps when documents are actually processed
// We show a brief "Reading" animation (300ms) then transition to "Read" - this happens 100% of the time
const READING_ANIMATION_DURATION = 300; // Brief animation to show "Reading" state (always happens)

/**
 * Monochromatic color scheme - actions in lighter shade, details in darker shade
 * Actions (like "Searching", "Found", "Ranking") are light gray
 * Details (like "for value", "1 documents:", "results") are darker gray
 */
const ACTION_COLOR = '#9CA3AF'; // Light gray for main actions (the circled parts)
const DETAIL_COLOR = '#374151'; // Dark gray for details and other text
const LIGHT_DETAIL_COLOR = '#6B7280'; // Medium gray for secondary details

const ReadingStepWithTransition: React.FC<{
  filename: string;
  docMetadata: any;
  isLoading?: boolean;
  readingIndex: number; // Which reading step this is (0, 1, 2...)
  onDocumentClick?: (metadata: DocumentMetadata) => void;
  isTransitioning?: boolean; // New prop to indicate transition phase
  showPreview?: boolean; // Whether to show the preview card (first time only)
  isLastReadingStep?: boolean; // Is this the last reading step?
  hasNextStep?: boolean; // Is there a step after this reading step?
}> = ({ filename, docMetadata, readingIndex, isLoading, onDocumentClick, isTransitioning = false, showPreview = true, isLastReadingStep = false, hasNextStep = false }) => {
  // Debug: Log preview state
  React.useEffect(() => {
    if (docMetadata) {
      console.log('🔍 [ReadingStepWithTransition] Preview state:', {
        showPreview,
        hasDocMetadata: !!docMetadata,
        hasOriginalFilename: !!docMetadata.original_filename,
        filename,
        docId: docMetadata.doc_id
      });
    }
  }, [showPreview, docMetadata, filename]);
  
  const [phase, setPhase] = useState<'reading' | 'read'>('reading');
  const [showReadAnimation, setShowReadAnimation] = useState(false); // Track if "Read" should show animation
  
  // ALWAYS show "Reading" animation first, then transition to "Read"
  // Check step details.status to see if backend has marked it as "read"
  // This happens 100% of the time for natural feel
  useEffect(() => {
    // Check if step details indicate it's already been read
    const stepStatus = docMetadata?.status || (onDocumentClick ? undefined : 'reading');
    
    let readTimer: NodeJS.Timeout | null = null;
    let animationTimer: NodeJS.Timeout | null = null;
    
    if (stepStatus === 'read') {
      // Backend has completed processing - show "Read" with animation
      setPhase('read');
      setShowReadAnimation(true); // Show animation when "Read" first appears
      
      // Remove animation after it completes (500ms to match shimmer duration)
      animationTimer = setTimeout(() => {
        setShowReadAnimation(false);
      }, 500);
    } else {
      // Start in "reading" phase and show animation
      setPhase('reading');
      setShowReadAnimation(false);
      
      // After brief animation, transition to "read" (unless backend updates it first)
      readTimer = setTimeout(() => {
        setPhase('read');
        setShowReadAnimation(true); // Show animation when transitioning to "Read"
        
        // Remove animation after it completes
        animationTimer = setTimeout(() => {
          setShowReadAnimation(false);
        }, 500);
      }, READING_ANIMATION_DURATION);
    }
    
    return () => {
      if (readTimer) clearTimeout(readTimer);
      if (animationTimer) clearTimeout(animationTimer);
    };
  }, [docMetadata, onDocumentClick]); // Re-run if docMetadata changes (backend updates status)
  
  const actionStyle: React.CSSProperties = {
    color: ACTION_COLOR,
    fontWeight: 500
  };

  // ALWAYS show "Reading" animation, then transition to "Read"
  // This happens 100% of the time for natural feel
  return (
    <motion.div 
      key={generateUniqueKey('ReadingStepWithTransition', readingIndex, docMetadata?.doc_id || filename)}
      initial={{ opacity: 0, y: 2, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      style={{ marginBottom: '4px' }}
    >
      <span>
        {phase === 'reading' ? (
          <span>
            {/* "Reading" with green flow animation (only if still active - no next step yet) */}
            {isLastReadingStep && isLoading && !hasNextStep ? (
              <>
                <span className="reading-shimmer-active">Reading{' '}</span>
                <span className="reading-shimmer-active">{filename}</span>
              </>
            ) : (
              <>
                <span style={actionStyle}>Reading{' '}</span>
                <span style={{ color: DETAIL_COLOR }}>{filename}</span>
              </>
            )}
          </span>
        ) : (
          <span>
            {/* "Read" with flow animation when it first appears */}
            {showReadAnimation ? (
              <>
                <span className="reading-shimmer-active">Read</span>
                <span className="reading-shimmer-active"> {filename}</span>
              </>
            ) : (
              <>
                {/* "Read" in light gray (action) */}
                <span style={actionStyle}>Read</span>
                {/* filename in dark gray (detail) */}
                <span style={{ color: DETAIL_COLOR }}> {filename}</span>
              </>
            )}
          </span>
        )}
      </span>
      {/* Preview card appears immediately with "Reading" text */}
      {showPreview && docMetadata && docMetadata.doc_id && (
        <motion.div
          animate={isTransitioning ? {
            height: 0,
            opacity: 0,
            scale: 0.9,
            marginTop: 0,
            marginBottom: 0
          } : {
            height: 'auto',
            opacity: 1,
            scale: 1
          }}
          transition={{
            duration: 0.3,
            ease: [0.25, 0.1, 0.25, 1]
          }}
          style={{
            overflow: 'hidden'
          }}
        >
          <DocumentPreviewCard 
            key={generateUniqueKey('DocumentPreviewCard', docMetadata.doc_id || readingIndex, phase)}
            metadata={docMetadata} 
            onClick={onDocumentClick ? () => onDocumentClick(docMetadata) : undefined}
          />
        </motion.div>
      )}
    </motion.div>
  );
};

// Planning indicator with subtle shimmer animation covering full text
const PlanningIndicator: React.FC = () => (
  <div 
    style={{
      fontSize: '12px',
      padding: '2px 0',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }}
  >
    {/* Loading spinner circle */}
    <div 
      className="reasoning-loading-spinner"
      style={{
        width: '14px',
        height: '14px',
        border: '2px solid #D1D5DB',
        borderTop: '2px solid #4B5563',
        borderRadius: '50%',
        flexShrink: 0,
        display: 'inline-block',
        boxSizing: 'border-box'
      }}
    />
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
  isTransitioning?: boolean; // Indicates transition from loading to stacked view
  shownDocumentsRef?: React.MutableRefObject<Set<string>>; // Track which documents have been shown
}> = ({ step, allSteps, stepIndex, isLoading, readingStepIndex = 0, isLastReadingStep = false, totalReadingSteps = 0, onDocumentClick, isTransitioning = false, shownDocumentsRef }) => {
  const actionStyle: React.CSSProperties = {
    color: ACTION_COLOR, // Light gray for main actions (the circled parts)
    fontWeight: 500
  };

  const targetStyle: React.CSSProperties = {
    color: DETAIL_COLOR // Dark gray for targets/details
  };

  const highlightStyle: React.CSSProperties = {
    color: DETAIL_COLOR, // Dark gray for highlights
    fontWeight: 400
  };

  // Style for document names - dark gray for details
  const docNameStyle: React.CSSProperties = {
    color: DETAIL_COLOR,
    fontWeight: 400
  };

  // PERFORMANCE OPTIMIZATION: Reduced animation delay for faster UI
  // REAL-TIME: No animation delays - show steps immediately when received
  const revealDelay = 0;

  switch (step.action_type) {
    case 'planning':
      // Skip "Preparing response" - planning steps are filtered out by filteredSteps
      // This case should never be reached, but if it is, return invisible placeholder
      // Note: The key here doesn't matter since this span is inside a motion.div with its own key
      return <span style={{ display: 'none' }} aria-hidden />;
    
    case 'exploring':
      // "Found 3 documents: name1, name2, ..."
      // Show document names as bullet points below
      // Note: Document previews are NOT shown here - only shown during reading steps
      
      // Use the same filename logic as DocumentPreviewCard:
      // original_filename -> classification_type label -> "Document"
      const getDisplayFilename = (doc: any): string => {
        const originalFilename = doc?.original_filename;
        const classificationType = doc?.classification_type || '';
        const classificationLabel = classificationType 
          ? classificationType.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
          : '';
        return originalFilename || classificationLabel || 'Document';
      };
      
      // Get document names from doc_previews (preferred) or document_names array
      let docNames: string[] = [];
      const docPreviews = step.details?.doc_previews || [];
      
      if (docPreviews.length > 0) {
        // Use doc_previews with same logic as DocumentPreviewCard
        docNames = docPreviews.map(doc => getDisplayFilename(doc));
      } else {
        // Fallback to document_names array
        docNames = step.details?.document_names || [];
        
        // If still empty, try parsing from message
        if (docNames.length === 0) {
          const colonIndex = step.message.indexOf(': ');
          if (colonIndex > -1) {
            const namesStr = step.message.substring(colonIndex + 2);
            docNames = namesStr.split(', ').filter(name => name.trim().length > 0);
          }
        }
      }
      
      // Parse the message to extract prefix
      // Format: "Found X documents: name1, name2, name3"
      const colonIndex = step.message.indexOf(': ');
      let prefix = step.message;
      if (colonIndex > -1) {
        prefix = step.message.substring(0, colonIndex);
      }
      
      // Split "Found X documents:" - "Found" is action (light), rest is detail (dark)
      const foundMatch = prefix.match(/^(Found)\s+(.+)$/);
      
      return (
        <div>
          {foundMatch ? (
            <>
              {/* "Found" in light gray (action) */}
              <span style={actionStyle}>{foundMatch[1]}</span>
              {/* " X documents:" in dark gray (detail) */}
              <span style={{ color: DETAIL_COLOR }}> {foundMatch[2]}:</span>
            </>
          ) : (
            <span style={actionStyle}>{prefix}:</span>
          )}
          {/* Document names as bullet points below - styled like DocumentPreviewCard */}
          {docNames.length > 0 ? (
            <ul style={{ 
              margin: '4px 0 0 0', 
              paddingLeft: '16px',
              listStyleType: 'disc'
            }}>
              {docNames.map((name, i) => (
                <li key={`doc-name-${name}-${i}`} style={{ 
                  fontSize: '12px',
                  fontWeight: 500,
                  color: '#888888',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  letterSpacing: '-0.01em',
                  lineHeight: '1.4',
                  marginBottom: '2px'
                }}>
                  {name}
                </li>
              ))}
            </ul>
          ) : (
            // If no document names found, show a placeholder
            <div style={{ 
              marginTop: '4px',
              color: DETAIL_COLOR,
              fontStyle: 'italic',
              fontSize: '11px'
            }}>
              (document names not available)
            </div>
          )}
        </div>
      );
    
    case 'searching':
      // Entire "Searching for value" (or whatever the message is) gets flowing gradient animation
      // Animation stops when next step (exploring/analyzing/reading) appears
      const nextStep = stepIndex < allSteps.length - 1 ? allSteps[stepIndex + 1] : null;
      const isSearchingActive = !nextStep || nextStep.action_type === 'searching';
      
      return (
        <span>
              {isSearchingActive ? (
              <span className="searching-shimmer-active">{step.message}</span>
            ) : (
              <span style={actionStyle}>{step.message}</span>
          )}
        </span>
      );
    
    case 'reading':
      // Each reading step transitions from "Reading" -> "Read" 
      // Backend emits "reading" step when processing starts, then "read" step when complete
      // Frontend shows animation and updates when "read" step is received
      const docMetadata = step.details?.doc_metadata;
      const stepStatus = step.details?.status; // 'reading' or 'read' from backend
      
      // Build filename from multiple sources - original_filename, classification_type, or fallback
      const rawFilename = step.details?.filename || docMetadata?.original_filename || '';
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
          .filter(s => s.action_type === 'reading' && s.details?.doc_metadata?.doc_id === docId);
        
        // Show preview only if this is the FIRST reading step for this document
        shouldShowPreview = previousReadingStepsWithSameDoc.length === 0;
        
        if (shouldShowPreview) {
          console.log('✅ [ReasoningSteps] Will show preview card for:', displayFilename, 'docId:', docId, 'status:', stepStatus);
        } else {
          console.log('⏭️ [ReasoningSteps] Skipping preview (shown in earlier step):', displayFilename, 'docId:', docId);
        }
      } else {
        console.warn('⚠️ [ReasoningSteps] Cannot show preview - missing doc_id:', {
          hasDocMetadata: !!docMetadata,
          hasDocId: !!docId,
          stepDetails: step.details,
          fullStep: step
        });
      }
      
      // Pass step status to component so it knows if backend has completed
      const docMetadataWithStatus = docMetadata ? { ...docMetadata, status: stepStatus } : docMetadata;
      
      // Check if there's a step after this reading step
      const hasNextStepAfterReading = stepIndex < allSteps.length - 1;
      
      return (
        <ReadingStepWithTransition 
          filename={truncatedFilename}
          docMetadata={docMetadataWithStatus}
          isLoading={isLoading}
          readingIndex={readingStepIndex}
          onDocumentClick={onDocumentClick}
          isTransitioning={isTransitioning}
          showPreview={shouldShowPreview}
          isLastReadingStep={isLastReadingStep}
          hasNextStep={hasNextStepAfterReading}
        />
      );
    
    case 'analyzing':
      // "Ranking results" - entire text with flowing gradient animation (only if this is the current active step)
      // Animation stops when next step (reading) appears
      const nextStepAfterAnalyzing = stepIndex < allSteps.length - 1 ? allSteps[stepIndex + 1] : null;
      const isRankingActive = !nextStepAfterAnalyzing || nextStepAfterAnalyzing.action_type === 'analyzing';
      
      return (
        <span>
          {/* Entire "Ranking results" text with flowing gradient animation (only if active) */}
          {isRankingActive ? (
            <span className="ranking-shimmer-active">{step.message || 'Analyzing'}</span>
          ) : (
            <span style={actionStyle}>{step.message || 'Analyzing'}</span>
          )}
        </span>
      );
    
    case 'complete':
      return (
        <span style={{ color: ACTION_COLOR }}>
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
          color: DETAIL_COLOR,
          fontSize: '13px',
          lineHeight: '1.5',
          marginTop: '0',
          marginBottom: '0',
          paddingLeft: '0'
        }}>
          {step.message}
        </div>
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
export const ReasoningSteps: React.FC<ReasoningStepsProps> = ({ steps, isLoading, onDocumentClick }) => {
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
      console.log('🔄 [ReasoningSteps] New query started, resetting shown documents tracking');
    }
    previousLoadingRef.current = isLoading;
  }, [isLoading]);
  
  // Track when all reading steps have completed
  const [allReadingComplete, setAllReadingComplete] = useState(false);
  
  // Track if we just transitioned from loading to not loading (for stacking animation)
  const wasLoadingRef = useRef(isLoading);
  const [shouldAnimateStack, setShouldAnimateStack] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  
  // REAL-TIME: Transition immediately when loading completes (no artificial delays)
  // Detect transition from loading to not loading
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading) {
      // Just finished loading - start transition immediately
      setIsTransitioning(true);
      // Minimal delay for smooth visual transition (100ms)
      const stackTimer = setTimeout(() => {
        setShouldAnimateStack(true);
        setIsTransitioning(false);
      }, 100); // Minimal delay for smooth transition
      // Reset quickly after animation
      const resetTimer = setTimeout(() => {
        setShouldAnimateStack(false);
      }, 400); // Fast reset
      return () => {
        clearTimeout(stackTimer);
        clearTimeout(resetTimer);
      };
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading]);
  
  // Filter out "Preparing response" steps (planning action type) and context messages
  // Also deduplicate steps to prevent rendering the same step twice
  const filteredSteps = useMemo(() => {
    const seen = new Set<string>();
    const result: ReasoningStep[] = [];
    
    steps.forEach((step, originalIdx) => {
      // Skip planning steps
      if (step.action_type === 'planning') return;
      
      // Skip context messages entirely - they're redundant with the actual response
      if (step.action_type === 'context') return;
      
      // Deduplicate: Create a unique key for this step based on action_type, message, doc_id, and original index
      // CRITICAL: Include originalIdx to ensure uniqueness even if all other fields are identical
      const stepKey = step.action_type === 'reading' && step.details?.doc_metadata?.doc_id
        ? `${step.action_type}-${step.details.doc_metadata.doc_id}-${step.timestamp || originalIdx}`
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
    
    // Log if we filtered out any duplicates
    if (result.length < steps.length) {
      console.log(`🔍 Filtered ${steps.length - result.length} duplicate steps from ${steps.length} total steps`);
    }
    
    return result;
  }, [steps]);
  
  // Preload document covers IMMEDIATELY when documents are found (optimized for instant thumbnail loading)
  // This runs as soon as we receive 'exploring' steps with doc_previews - don't wait for component re-render
  useEffect(() => {
    if (!isLoading) return;
    
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
    
    // Log preloading start for debugging
    if (preloadPromises.length > 0) {
      console.log(`🚀 [ReasoningSteps] Starting parallel preload for ${preloadPromises.length} documents`);
    }
  }, [steps, isLoading]);
  
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
  
  // Pre-compute animated steps array using useMemo to avoid IIFE issues
  const animatedSteps = useMemo(() => {
    if (!isLoading || !filteredSteps || filteredSteps.length === 0) {
      return [];
    }
    
    let readingCounter = 0;
    let hasSeenReading = false;
    
    return filteredSteps
      .filter((step) => step != null && step !== undefined)
      .map((step, idx) => {
        let currentReadingIndex = 0;
        let isLastReadingStep = false;
        
        if (step.action_type === 'reading') {
          currentReadingIndex = readingCounter;
          isLastReadingStep = (readingCounter === totalReadingSteps - 1);
          readingCounter++;
          hasSeenReading = true;
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
        // More pronounced sequential reveal for better flow
        let stepDelay = idx * 0.15; // 150ms stagger - each step waits for previous to appear
        if (step.action_type === 'reading') {
          stepDelay = idx * 0.12; // Slightly faster for reading steps (120ms)
        } else if (hasSeenReading) {
          stepDelay = idx * 0.10; // Faster for steps after reading (100ms)
        }
        
        return {
          step,
          stepKey: finalStepKey,
          delay: stepDelay,
          readingIndex: currentReadingIndex,
          isLastReadingStep,
          stepIndex: idx
        };
      });
  }, [filteredSteps, isLoading, totalReadingSteps]);
  
  // Don't render if no steps
  if (!filteredSteps || filteredSteps.length === 0) {
    // Show planning indicator when loading but no steps yet
    // This will stop shimmering when first step appears (handled by component unmounting)
    if (isLoading) {
      return (
        <div style={{
          marginBottom: '8px',
          padding: '8px 12px',
          backgroundColor: '#F9FAFB',
          borderRadius: '8px',
          border: '1px solid #E5E7EB'
        }}>
          <PlanningIndicator />
          
          {/* CSS for shimmer animations */}
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
            
            .reasoning-loading-spinner {
              animation: spin 0.8s linear infinite;
            }
            
            .planning-shimmer-full {
              background: linear-gradient(90deg, #6B7280 0%, #9CA3AF 25%, #D1D5DB 50%, #9CA3AF 75%, #6B7280 100%);
              background-size: 300% 100%;
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
              animation: shimmer-full 1.2s ease-in-out infinite;
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
            
            /* Active reading - green flow animation for "Reading" and document name */
            .reading-shimmer-active {
              font-weight: 500;
              background: linear-gradient(
                90deg, 
                #047857 0%,      /* emerald-700 - deep base */
                #059669 15%,     /* emerald-600 */
                #10B981 35%,     /* emerald-500 - main accent */
                #34D399 50%,     /* emerald-400 - peak highlight */
                #10B981 65%,     /* emerald-500 */
                #059669 85%,     /* emerald-600 */
                #047857 100%     /* emerald-700 - deep base */
              );
              background-size: 200% 100%;
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
              animation: reading-glow 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
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
              animation: searching-glow 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
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
              animation: shimmer-full 2s ease-in-out infinite;
            }
            
            @keyframes reading-glow {
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
                background: linear-gradient(90deg, #047857 0%, #059669 15%, #10B981 35%, #34D399 50%, #10B981 65%, #059669 85%, #047857 100%);
                background-size: 200% 100%;
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                background-position: 100% 0;
              }
              50% {
                background: linear-gradient(90deg, #047857 0%, #059669 15%, #10B981 35%, #34D399 50%, #10B981 65%, #059669 85%, #047857 100%);
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
        </div>
      );
    }
    return null;
  }

  // Determine if we should show planning indicator
  // 1. Show initially when loading but no steps yet (handled in early return above)
  // 2. Hide when first step appears
  // 3. Show again after all reading steps complete, before response
  const hasSteps = animatedSteps.length > 0;
  const shouldShowPlanningAfterReading = isLoading && hasSteps && allReadingComplete && totalReadingSteps > 0;
  
  // Check if planning indicator should animate (only if it's the current active step)
  const isPlanningActive = shouldShowPlanningAfterReading;
  
  return (
    <div style={{
      marginBottom: '8px',
      padding: '8px 12px',
      backgroundColor: '#F9FAFB',
      borderRadius: '8px',
      border: '1px solid #E5E7EB'
    }}>
      {/* Steps stacked vertically - always visible */}
      {isLoading && animatedSteps.length > 0 ? (
        <AnimatePresence mode="popLayout">
          {animatedSteps.map(({ step, stepKey: finalStepKey, delay: stepDelay, readingIndex: currentReadingIndex, isLastReadingStep, stepIndex: idx }) => {
            // Check if this is a reading step with a preview card
            const isReadingStep = step.action_type === 'reading';
            const hasPreview = isReadingStep && step.details?.doc_metadata?.doc_id;
            
            return (
              <motion.div
                key={finalStepKey}
                initial={{ opacity: 0, y: 2, scale: 0.98 }}
                animate={{ 
                  opacity: 1, 
                  y: 0,
                  scale: 1,
                  // Add collapse animation for reading steps during transition
                  ...(isTransitioning && hasPreview ? {
                    height: 'auto',
                    scale: 0.95
                  } : {})
                }}
                exit={{ 
                  opacity: 0, 
                  y: -2,
                  scale: 0.98,
                  // Collapse preview cards when exiting
                  ...(isReadingStep && hasPreview ? {
                    height: 0,
                    scale: 0.9,
                    marginBottom: 0
                  } : {})
                }}
                transition={{ 
                  duration: isTransitioning && hasPreview ? 0.4 : 0.3,
                  delay: isTransitioning ? 0 : stepDelay,
                  ease: isTransitioning && hasPreview 
                    ? [0.34, 1.56, 0.64, 1] // Bouncy collapse
                    : [0.16, 1, 0.3, 1] // Smooth ease-out (Cursor-style)
                }}
                style={{
                  fontSize: '12px',
                  color: DETAIL_COLOR, // Dark gray for container (details will be darker)
                  padding: '2px 0',
                  lineHeight: 1.5,
                  overflow: isTransitioning && hasPreview ? 'hidden' : 'visible'
                }}
              >
              <StepRenderer 
                step={step} 
                allSteps={filteredSteps} 
                stepIndex={idx} 
                isLoading={isLoading}
                readingStepIndex={currentReadingIndex}
                isLastReadingStep={isLastReadingStep}
                totalReadingSteps={totalReadingSteps}
                onDocumentClick={onDocumentClick}
                isTransitioning={isTransitioning}
                shownDocumentsRef={shownDocumentsRef}
              />
              </motion.div>
            );
          })}
        </AnimatePresence>
      ) : (
        // When not loading (trace mode), render static divs without AnimatePresence
        // Use StackedDocumentPreviews for reading steps to save vertical space
        <div key="reasoning-steps-static">
          {(() => {
            // Separate reading steps from other steps for stacked rendering
            const readingSteps = filteredSteps.filter(s => s.action_type === 'reading');
            const otherSteps = filteredSteps.filter(s => s.action_type !== 'reading');
            
            // Collect document metadata from reading steps for stacked preview
            // Only require doc_id - original_filename can be null (we'll use classification_type as fallback)
            const readingDocuments = readingSteps
              .map(step => step.details?.doc_metadata)
              .filter((doc): doc is NonNullable<typeof doc> => doc != null && !!doc.doc_id);
            
            return (
              <>
                {/* Render non-reading steps first */}
                {otherSteps.map((step, idx) => {
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
                  
                  return (
                    <div
                      key={finalStepKey}
                      style={{
                        fontSize: '12px',
                        color: DETAIL_COLOR, // Dark gray for container (details will be darker)
                        padding: '2px 0',
                        lineHeight: 1.5
                      }}
                    >
                      <StepRenderer 
                        step={step} 
                        allSteps={filteredSteps} 
                        stepIndex={idx} 
                        isLoading={isLoading}
                        readingStepIndex={0}
                        isLastReadingStep={false}
                        totalReadingSteps={totalReadingSteps}
                        onDocumentClick={onDocumentClick}
                        isTransitioning={false}
                        shownDocumentsRef={shownDocumentsRef}
                      />
                    </div>
                  );
                })}
                
                {/* Render reading steps with stacked document previews */}
                {readingSteps.length > 0 && (
                  <div style={{ marginTop: '4px' }}>
                    {/* Show "Read X documents" summary */}
                    <div style={{
                      fontSize: '12px',
                      color: DETAIL_COLOR, // Dark gray for container text
                      fontWeight: 500,
                      marginBottom: '4px'
                    }}>
                      <span style={{ color: ACTION_COLOR }}>Read</span> {readingSteps.length} document{readingSteps.length > 1 ? 's' : ''}
                    </div>
                    
                    {/* Stacked document previews */}
                    {readingDocuments.length > 0 && (
                      <StackedDocumentPreviews 
                        documents={readingDocuments}
                        onDocumentClick={onDocumentClick}
                        isAnimating={shouldAnimateStack}
                      />
                    )}
                  </div>
                )}
              </>
            );
          })()}
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
              <div style={{ fontSize: '12px', color: ACTION_COLOR, fontWeight: 500 }}>
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
          animation: spin 0.8s linear infinite;
        }
        
        .planning-shimmer-full {
          background: linear-gradient(90deg, #6B7280 0%, #9CA3AF 25%, #D1D5DB 50%, #9CA3AF 75%, #6B7280 100%);
          background-size: 300% 100%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer-full 2s ease-in-out infinite;
          font-weight: 500;
        }
        
        /* Searching - flowing gradient animation (same as planning) */
        .searching-shimmer-active {
          font-weight: 500;
          background: linear-gradient(90deg, #6B7280 0%, #9CA3AF 25%, #D1D5DB 50%, #9CA3AF 75%, #6B7280 100%);
          background-size: 300% 100%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer-full 2s ease-in-out infinite;
        }
        
        /* Ranking - flowing gradient animation (same as planning) */
        .ranking-shimmer-active {
          font-weight: 500;
          background: linear-gradient(90deg, #6B7280 0%, #9CA3AF 25%, #D1D5DB 50%, #9CA3AF 75%, #6B7280 100%);
          background-size: 300% 100%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer-full 2s ease-in-out infinite;
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
        
            /* Active reading - green flow animation for "Reading" and document name */
            .reading-shimmer-active {
              font-weight: 500;
              background: linear-gradient(
                90deg, 
                #047857 0%,      /* emerald-700 - deep base */
                #059669 15%,     /* emerald-600 */
                #10B981 35%,     /* emerald-500 - main accent */
                #34D399 50%,     /* emerald-400 - peak highlight */
                #10B981 65%,     /* emerald-500 */
                #059669 85%,     /* emerald-600 */
                #047857 100%     /* emerald-700 - deep base */
              );
              background-size: 200% 100%;
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
              animation: reading-glow 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
            }
            
            /* Searching - flowing gradient animation (same as planning) */
            .searching-shimmer-active {
              font-weight: 500;
              background: linear-gradient(90deg, #6B7280 0%, #9CA3AF 25%, #D1D5DB 50%, #9CA3AF 75%, #6B7280 100%);
              background-size: 300% 100%;
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
              animation: shimmer-full 2s ease-in-out infinite;
            }
            
            /* Ranking - flowing gradient animation (same as planning) */
            .ranking-shimmer-active {
              font-weight: 500;
              background: linear-gradient(90deg, #6B7280 0%, #9CA3AF 25%, #D1D5DB 50%, #9CA3AF 75%, #6B7280 100%);
              background-size: 300% 100%;
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
              animation: shimmer-full 2s ease-in-out infinite;
            }
            
            @keyframes reading-glow {
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
            background: linear-gradient(90deg, #047857 0%, #059669 15%, #10B981 35%, #34D399 50%, #10B981 65%, #059669 85%, #047857 100%);
            background-size: 200% 100%;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            background-position: 100% 0;
          }
          50% {
            background: linear-gradient(90deg, #047857 0%, #059669 15%, #10B981 35%, #34D399 50%, #10B981 65%, #059669 85%, #047857 100%);
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
    </div>
  );
};

export default ReasoningSteps;

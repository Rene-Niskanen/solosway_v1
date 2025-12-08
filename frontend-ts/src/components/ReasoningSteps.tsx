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
}) => {
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
    
    if (doc.download_url) {
      fetchUrl = doc.download_url.startsWith('http') ? doc.download_url : `${backendUrl}${doc.download_url}`;
    } else if (doc.s3_path) {
      fetchUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(doc.s3_path)}`;
    } else {
      fetchUrl = `${backendUrl}/api/files/download?document_id=${doc.doc_id}`;
    }
    
    console.log(`🔄 Preloading document: ${displayName}`);
    
    const response = await fetch(fetchUrl, {
      credentials: 'include'
    });
    
    if (!response.ok) return;
    
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
          console.log(`✅ Preloaded PDF with thumbnail: ${displayName}`);
        } else {
          // Fallback - at least cache the URL
          (window as any).__preloadedDocumentCovers[doc.doc_id] = {
            url: url,
            type: blob.type,
            timestamp: Date.now()
          };
          console.log(`⚠️ Preloaded PDF (no thumbnail): ${displayName}`);
        }
      } catch (pdfError) {
        console.warn('Failed to generate PDF thumbnail during preload:', pdfError);
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
      console.log(`✅ Preloaded image: ${displayName}`);
    } else {
      // For other files, just cache the URL
      (window as any).__preloadedDocumentCovers[doc.doc_id] = {
        url: url,
        type: blob.type,
        timestamp: Date.now()
      };
      console.log(`✅ Preloaded document: ${displayName}`);
    }
  } catch (error) {
    console.warn(`Failed to preload document: ${displayName}`, error);
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

// Reading step that transitions from "Reading" -> "Read" after a delay
// "Reading" text and preview card appear TOGETHER
// Preview card REMAINS visible after reading completes
const READING_DURATION = 2500; // How long each document is actively "read" (ms)
const READING_GAP = 400; // Gap between documents for smooth flow

const ReadingStepWithTransition: React.FC<{
  filename: string;
  docMetadata: any;
  isLoading?: boolean;
  readingIndex: number; // Which reading step this is (0, 1, 2...)
  onDocumentClick?: (metadata: DocumentMetadata) => void;
  isTransitioning?: boolean; // New prop to indicate transition phase
  showPreview?: boolean; // Whether to show the preview card (first time only)
}> = ({ filename, docMetadata, readingIndex, isLoading, onDocumentClick, isTransitioning = false, showPreview = true }) => {
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
  const [phase, setPhase] = useState<'waiting' | 'reading' | 'read'>('waiting');
  
  useEffect(() => {
    // If not loading anymore (response complete), skip animations and show final state
    if (!isLoading) {
      setPhase('read');
      return;
    }
    
    // Calculate delay based on reading index - each step waits for previous ones
    const startDelay = readingIndex * (READING_DURATION + READING_GAP);
    
    // "Reading" text and preview appear TOGETHER
    const startTimer = setTimeout(() => {
      setPhase('reading');
    }, startDelay);
    
    // Transition to "Read" after READING_DURATION (preview stays visible)
    const readTimer = setTimeout(() => {
      setPhase('read');
    }, startDelay + READING_DURATION);
    
    return () => {
      clearTimeout(startTimer);
      clearTimeout(readTimer);
    };
  }, [readingIndex, isLoading]);
  
  const actionStyle: React.CSSProperties = {
    color: '#374151',
    fontWeight: 500
  };
  
  // During waiting phase while loading, render an invisible placeholder
  // to avoid returning null inside AnimatePresence children
  // Note: The key here doesn't matter since this span is inside a motion.div with its own key
  if (phase === 'waiting' && isLoading) {
    return <span style={{ display: 'none' }} aria-hidden />;
  }
  
  // If not loading, show static (no animation)
  if (!isLoading) {
    return (
      <div style={{ marginBottom: '4px' }}>
        <span style={actionStyle}>
          Read {filename}
        </span>
        {showPreview && docMetadata && docMetadata.doc_id && (
          <DocumentPreviewCard 
            key={generateUniqueKey('DocumentPreviewCard', docMetadata.doc_id || readingIndex, 'static')}
            metadata={docMetadata} 
            onClick={onDocumentClick ? () => onDocumentClick(docMetadata) : undefined}
          />
        )}
      </div>
    );
  }
  
  return (
    <motion.div 
      key={generateUniqueKey('ReadingStepWithTransition', readingIndex, docMetadata?.doc_id || filename)}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      style={{ marginBottom: '4px' }}
    >
      <span>
        {phase === 'reading' ? (
          <span className="reading-shimmer-active">
            Reading {filename}
          </span>
        ) : (
          <span style={actionStyle}>
            Read {filename}
          </span>
        )}
      </span>
      {/* Preview card appears with "Reading" text and stays visible - only on first appearance */}
      {/* Add collapse animation when transitioning */}
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
            duration: 0.4,
            ease: [0.34, 1.56, 0.64, 1], // Bouncy collapse
            delay: readingIndex * 0.05 // Stagger the collapse
          }}
          style={{
            overflow: 'hidden'
          }}
        >
          <DocumentPreviewCard 
            key={generateUniqueKey('DocumentPreviewCard', docMetadata.doc_id || readingIndex, 'reading')}
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
      alignItems: 'center'
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
  isTransitioning?: boolean; // Indicates transition from loading to stacked view
  shownDocumentsRef?: React.MutableRefObject<Set<string>>; // Track which documents have been shown
}> = ({ step, allSteps, stepIndex, isLoading, readingStepIndex = 0, isLastReadingStep = false, totalReadingSteps = 0, onDocumentClick, isTransitioning = false, shownDocumentsRef }) => {
  const actionStyle: React.CSSProperties = {
    color: '#374151',
    fontWeight: 500
  };

  const targetStyle: React.CSSProperties = {
    color: '#6B7280'
  };

  const highlightStyle: React.CSSProperties = {
    color: '#4B5563',
    fontWeight: 400
  };

  // Style for document names - light grey
  const docNameStyle: React.CSSProperties = {
    color: '#9CA3AF',
    fontWeight: 400
  };

  // Animation delay for sequential reveal (0.8s per reading step)
  const revealDelay = readingStepIndex * 0.8;

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
      
      // Parse the message to extract document names
      // Format: "Found X documents: name1, name2, name3"
      const colonIndex = step.message.indexOf(': ');
      let prefix = step.message;
      let docNames: string[] = [];
      
      if (colonIndex > -1) {
        prefix = step.message.substring(0, colonIndex);
        const namesStr = step.message.substring(colonIndex + 2);
        docNames = namesStr.split(', ');
      }
      
      return (
        <div>
          {/* Render prefix text */}
          <span style={actionStyle}>{prefix}:</span>
          {/* Document names as bullet points below */}
          {docNames.length > 0 && (
            <ul style={{ 
              margin: '4px 0 0 0', 
              paddingLeft: '16px',
              listStyleType: 'disc'
            }}>
              {docNames.map((name, i) => (
                <li key={`doc-name-${name}-${i}`} style={{ 
                  ...docNameStyle,
                  marginBottom: '2px',
                  lineHeight: '1.4'
                }}>
                  {name}
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    
    case 'searching':
      // "Searching for price in Highlands documents" - display full message
      return (
        <span>
          <span style={actionStyle}>{step.message}</span>
        </span>
      );
    
    case 'reading':
      // Each reading step transitions from "Reading" -> "Read" after a delay
      // This is handled by the ReadingStepWithTransition component
      const docMetadata = step.details?.doc_metadata;
      
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
          console.log('✅ [ReasoningSteps] Will show preview card for:', displayFilename, 'docId:', docId);
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
      
      return (
        <ReadingStepWithTransition 
          filename={truncatedFilename}
          docMetadata={docMetadata}
          isLoading={isLoading}
          readingIndex={readingStepIndex}
          onDocumentClick={onDocumentClick}
          isTransitioning={isTransitioning}
          showPreview={shouldShowPreview}
        />
      );
    
    case 'analyzing':
      // "Ranking results" or similar
      return (
        <span>
          <span style={actionStyle}>{step.message || 'Analyzing'}</span>
        </span>
      );
    
    case 'complete':
      return (
        <span style={{ color: '#15803D' }}>
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
          color: '#374151',
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
  
  // Detect transition from loading to not loading
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading) {
      // Just finished loading - start transition
      setIsTransitioning(true);
      // After preview cards collapse, trigger stacking animation
      const stackTimer = setTimeout(() => {
        setShouldAnimateStack(true);
        setIsTransitioning(false);
      }, 400); // Wait for collapse animation to complete
      // Reset after all animations complete
      const resetTimer = setTimeout(() => {
        setShouldAnimateStack(false);
      }, 1400);
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
  
  // Preload document covers during "Planning Next Moves" (when isLoading)
  // This runs as soon as we receive 'exploring' steps with doc_previews
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
    
    // Preload each document (only if not already started)
    allDocs.forEach(doc => {
      if (doc.doc_id && !preloadedDocsRef.current.has(doc.doc_id)) {
        preloadedDocsRef.current.add(doc.doc_id);
        preloadDocumentCover(doc);
      }
    });
  }, [steps, isLoading]);
  
  // Count total reading steps and track indices for sequential animation
  const totalReadingSteps = filteredSteps.filter(s => s.action_type === 'reading').length;
  let readingStepCounter = 0;
  
  // Calculate total time for all reading steps to complete
  const totalReadingTimeMs = totalReadingSteps * (READING_DURATION + READING_GAP);
  
  // Track when all reading steps are complete - set timer when loading starts
  useEffect(() => {
    if (!isLoading || totalReadingSteps === 0) {
      setAllReadingComplete(true);
      return;
    }
    
    // Reset when starting a new query
    setAllReadingComplete(false);
    
    // Set timer for when all reading will be complete
    const timer = setTimeout(() => {
      setAllReadingComplete(true);
    }, totalReadingTimeMs);
    
    return () => clearTimeout(timer);
  }, [isLoading, totalReadingSteps, totalReadingTimeMs]);
  
  // Pre-compute animated steps array using useMemo to avoid IIFE issues
  const animatedSteps = useMemo(() => {
    if (!isLoading || !filteredSteps || filteredSteps.length === 0) {
      return [];
    }
    
    let readingCounter = 0;
    let hasSeenReading = false;
    const totalReadingTime = totalReadingSteps * (READING_DURATION + READING_GAP);
    
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
        
        let stepDelay = 0;
        if (step.action_type === 'reading') {
          stepDelay = 0;
        } else if (hasSeenReading) {
          stepDelay = (totalReadingTime / 1000) + 0.3;
        } else {
          stepDelay = idx * 0.03;
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
            .planning-shimmer-full {
              background: linear-gradient(90deg, #6B7280 0%, #9CA3AF 25%, #D1D5DB 50%, #9CA3AF 75%, #6B7280 100%);
              background-size: 300% 100%;
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
              animation: shimmer-full 2s ease-in-out infinite;
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
            
            /* Active reading - sleek Cursor-style emerald wave animation */
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
                initial={{ opacity: 0, x: -8 }}
                animate={{ 
                  opacity: 1, 
                  x: 0,
                  // Add collapse animation for reading steps during transition
                  ...(isTransitioning && hasPreview ? {
                    height: 'auto',
                    scale: 0.95
                  } : {})
                }}
                exit={{ 
                  opacity: 0, 
                  x: -8,
                  // Collapse preview cards when exiting
                  ...(isReadingStep && hasPreview ? {
                    height: 0,
                    scale: 0.9,
                    marginBottom: 0
                  } : {})
                }}
                transition={{ 
                  duration: isTransitioning && hasPreview ? 0.4 : 0.2,
                  delay: isTransitioning ? 0 : stepDelay,
                  ease: isTransitioning && hasPreview 
                    ? [0.34, 1.56, 0.64, 1] // Bouncy collapse
                    : [0.25, 0.1, 0.25, 1]
                }}
                style={{
                  fontSize: '12px',
                  color: '#6B7280',
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
                        color: '#6B7280',
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
                      color: '#374151',
                      fontWeight: 500,
                      marginBottom: '4px'
                    }}>
                      Read {readingSteps.length} document{readingSteps.length > 1 ? 's' : ''}
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
      
      {/* Show planning indicator only AFTER all reading steps are complete */}
      {isLoading && filteredSteps.length > 0 && allReadingComplete && (
        <motion.div
          key={generateUniqueKey('PlanningIndicator', 'after-reading', filteredSteps.length)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          style={{ padding: '0', marginTop: '4px' }}
        >
          <PlanningIndicator />
        </motion.div>
      )}
      
      {/* CSS for shimmer animations - sequential reveal and green flash for reading */}
      <style>{`
        .planning-shimmer-full {
          background: linear-gradient(90deg, #6B7280 0%, #9CA3AF 25%, #D1D5DB 50%, #9CA3AF 75%, #6B7280 100%);
          background-size: 300% 100%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer-full 2s ease-in-out infinite;
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
        
        /* Active reading - sleek Cursor-style emerald wave animation */
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

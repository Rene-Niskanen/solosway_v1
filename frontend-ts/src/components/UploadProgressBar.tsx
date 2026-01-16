import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileUp, Check, X, Loader2, Brain, Layers, Database, FileSearch, ChevronDown, ChevronUp, Clock, FileText, Trash2, Save } from 'lucide-react';
import { backendApi } from '../services/backendApi';

interface ProcessingStep {
  name: string;
  status: 'pending' | 'started' | 'completed' | 'failed';
  message?: string;
  metadata?: {
    chunk_count?: number;
    processing_time?: number;
    reducto_job_id?: string;
    [key: string]: any;
  };
}

interface UploadState {
  isUploading: boolean;
  progress: number;
  fileName: string;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  error?: string;
  documentId?: string;
  propertyId?: string; // Track property ID for canceling linking
  processingSteps?: ProcessingStep[];
  currentStep?: string;
  chunkCount?: number;
  processingTime?: number;
  startTime?: number;
  reductoJobId?: string;
}

interface DocumentQueueItem {
  fileName: string;
  documentId?: string;
  propertyId?: string;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  progress: number;
  startTime?: number;
  error?: string;
}

/**
 * Global upload progress bar with real-time extraction status
 * Shows upload progress, timer, and detailed extraction pipeline status
 */
export const UploadProgressBar: React.FC = () => {
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [documentQueue, setDocumentQueue] = useState<DocumentQueueItem[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true); // Auto-expand by default
  const [showQueueDropdown, setShowQueueDropdown] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pollErrorCountRef = useRef<number>(0);
  const queueDropdownRef = useRef<HTMLDivElement>(null);
  const MAX_POLL_ERRORS = 5;

  // Timer effect - updates every second
  useEffect(() => {
    if (uploadState && uploadState.startTime) {
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - uploadState.startTime!) / 1000);
        setElapsedTime(elapsed);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setElapsedTime(0);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [uploadState?.startTime]);

  // Format elapsed time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Poll for document processing status
  const pollDocumentStatus = async (documentId: string, fileName: string) => {
    try {
      const response = await backendApi.getDocumentStatus(documentId);
      
      // Reset error count on successful response
      if (response.success) {
        pollErrorCountRef.current = 0;
      }
      
      if (response.success && response.data) {
        const data = response.data as { 
          status?: string; 
          pipeline_progress?: { 
            history?: Array<{
              step_name: string;
              step_status: string;
              step_message?: string;
              step_metadata?: Record<string, any>;
            }>;
            current_step?: string;
          } 
        };
        const { status, pipeline_progress } = data;
        
        // Map backend history to our steps format
        const steps: ProcessingStep[] = [];
        let reductoJobId: string | undefined;
        if (pipeline_progress?.history) {
          for (const historyItem of pipeline_progress.history) {
            steps.push({
              name: historyItem.step_name,
              status: historyItem.step_status?.toLowerCase() as ProcessingStep['status'],
              message: historyItem.step_message,
              metadata: historyItem.step_metadata
            });
            
            // Extract Reducto job ID if available
            if (historyItem.step_metadata?.reducto_job_id) {
              reductoJobId = historyItem.step_metadata.reducto_job_id;
            }
          }
        }
        
        // Extract chunk count from metadata
        let chunkCount = 0;
        let processingTime = 0;
        for (const step of steps) {
          if (step.metadata?.chunk_count) {
            chunkCount = step.metadata.chunk_count;
          }
          if (step.metadata?.processing_time_seconds) {
            processingTime = step.metadata.processing_time_seconds;
          }
        }
        
        // Determine current step name with better formatting
        let currentStep = pipeline_progress?.current_step || status;
        
        // Map status to user-friendly messages
        if (status === 'uploaded' || status === 'processing') {
          // Check if we have active steps
          const activeStep = steps.find(s => s.status === 'started');
          if (activeStep) {
            currentStep = getStepDisplayName(activeStep.name);
          } else if (steps.length > 0) {
            // Check last completed step to infer what's next
            const lastCompleted = steps.filter(s => s.status === 'completed').pop();
            if (lastCompleted) {
              currentStep = getNextStepDisplayName(lastCompleted.name);
            } else {
              currentStep = 'Initializing extraction...';
            }
          } else {
            currentStep = 'Starting extraction pipeline...';
          }
        }
        
        // Check if processing is complete
        const isComplete = status === 'processed' || status === 'completed';
        const isFailed = status === 'failed';
        
        // Update queue
        setDocumentQueue(prev => prev.map(doc => 
          doc.documentId === documentId 
            ? { 
                ...doc, 
                status: isComplete ? 'complete' : isFailed ? 'error' : 'processing',
                progress: isComplete ? 100 : doc.progress
              }
            : doc
        ));
        
        setUploadState(prev => prev ? {
          ...prev,
          status: isComplete ? 'complete' : isFailed ? 'error' : 'processing',
          processingSteps: steps,
          currentStep: currentStep,
          chunkCount: chunkCount || prev.chunkCount,
          processingTime: processingTime || prev.processingTime,
          error: isFailed ? 'Processing failed' : prev.error,
          reductoJobId: reductoJobId || prev.reductoJobId
        } : null);
        
        // Stop polling if complete or failed
        if (isComplete || isFailed) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          
          // Stop timer
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          
          // Auto-hide after delay and remove from queue
          setTimeout(() => {
            setIsVisible(false);
            setTimeout(() => {
              setUploadState(null);
              // Remove completed/error documents from queue after a delay
              setDocumentQueue(prev => prev.filter(doc => doc.documentId !== documentId));
            }, 300);
          }, isComplete ? 5000 : 8000);
        }
      }
    } catch (error) {
      pollErrorCountRef.current++;
      console.error(`Failed to poll document status (attempt ${pollErrorCountRef.current}/${MAX_POLL_ERRORS}):`, error);
      
      // Stop polling after too many errors
      if (pollErrorCountRef.current >= MAX_POLL_ERRORS) {
        console.warn('Max poll errors reached, stopping status polling');
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        
        // Show as complete anyway - document was uploaded successfully
        setUploadState(prev => prev ? {
          ...prev,
          status: 'complete',
          currentStep: 'Processing in background'
        } : null);
        
        // Auto-hide after delay and remove from queue
        setTimeout(() => {
          setIsVisible(false);
          setTimeout(() => {
            setUploadState(null);
            // Remove from queue
            setDocumentQueue(prev => prev.filter(doc => doc.documentId !== documentId));
          }, 300);
        }, 4000);
      }
    }
  };

  // Helper to get user-friendly step names
  const getStepDisplayName = (stepName: string): string => {
    const name = stepName.toLowerCase();
    if (name.includes('classif')) return 'Classifying document type...';
    if (name.includes('parse') || name.includes('reducto')) return 'Parsing document with Reducto...';
    if (name.includes('extract')) return 'Extracting content...';
    if (name.includes('chunk')) return 'Generating document chunks...';
    if (name.includes('embed') || name.includes('vector')) return 'Generating embeddings...';
    if (name.includes('normalize')) return 'Normalizing data...';
    if (name.includes('link')) return 'Linking to properties...';
    return stepName.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
  };

  const getNextStepDisplayName = (lastStep: string): string => {
    const name = lastStep.toLowerCase();
    if (name.includes('classif')) return 'Starting extraction...';
    if (name.includes('parse') || name.includes('reducto')) return 'Extracting chunks...';
    if (name.includes('extract')) return 'Generating embeddings...';
    if (name.includes('chunk')) return 'Vectorizing content...';
    return 'Processing...';
  };

  // Start polling when we have a document ID
  const startPolling = (documentId: string, fileName: string) => {
    // Clear any existing polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }
    
    // Reset error count
    pollErrorCountRef.current = 0;
    
    // Poll immediately
    pollDocumentStatus(documentId, fileName);
    
    // Then poll every 2 seconds
    pollingRef.current = setInterval(() => {
      pollDocumentStatus(documentId, fileName);
    }, 2000);
  };

  // Close queue dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        queueDropdownRef.current &&
        !queueDropdownRef.current.contains(event.target as Node)
      ) {
        setShowQueueDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const handleUploadStart = (e: CustomEvent<{ fileName: string; propertyId?: string }>) => {
      console.log(`📊 [UploadProgressBar] Upload start event received:`, e.detail.fileName);
      const newDoc: DocumentQueueItem = {
        fileName: e.detail.fileName,
        propertyId: e.detail.propertyId,
        status: 'uploading',
        progress: 0,
        startTime: Date.now()
      };
      
      setDocumentQueue(prev => [...prev, newDoc]);
      setUploadState({
        isUploading: true,
        progress: 0,
        fileName: e.detail.fileName,
        status: 'uploading',
        propertyId: e.detail.propertyId,
        startTime: Date.now()
      });
      setIsVisible(true);
      setIsExpanded(true);
      setElapsedTime(0);
    };

    const handleUploadProgress = (e: CustomEvent<{ progress: number; fileName: string }>) => {
      // Update queue
      setDocumentQueue(prev => prev.map(doc => 
        doc.fileName === e.detail.fileName 
          ? { ...doc, progress: e.detail.progress, status: e.detail.progress >= 90 ? 'processing' : 'uploading' }
          : doc
      ));
      
      setUploadState(prev => {
        if (!prev) return null;
        const newProgress = e.detail.progress;
        return {
          ...prev,
          progress: newProgress,
          status: newProgress >= 90 ? 'processing' : 'uploading'
        };
      });
    };

    const handleUploadComplete = (e: CustomEvent<{ fileName: string; documentId?: string; propertyId?: string }>) => {
      const { fileName, documentId, propertyId } = e.detail;
      
      console.log(`📊 [UploadProgressBar] Upload complete event received:`, { fileName, documentId, propertyId });
      
      // Update queue
      setDocumentQueue(prev => prev.map(doc => 
        doc.fileName === fileName 
          ? { ...doc, documentId, propertyId, status: 'processing', progress: 100 }
          : doc
      ));
      
      setUploadState(prev => prev ? {
        ...prev,
        progress: 100,
        status: 'processing',
        isUploading: false,
        documentId: documentId,
        propertyId: propertyId,
        currentStep: 'Starting extraction pipeline...'
      } : null);
      
      // Auto-expand to show processing details
      setIsExpanded(true);
      
      // Start polling for processing status if we have a document ID
      if (documentId) {
        console.log(`🔄 [UploadProgressBar] Starting status polling for document: ${documentId}`);
        startPolling(documentId, fileName);
      } else {
        // No document ID - just show complete after a delay
        setTimeout(() => {
          setUploadState(prev => prev ? { ...prev, status: 'complete' } : null);
          setTimeout(() => {
            setIsVisible(false);
            setTimeout(() => setUploadState(null), 300);
          }, 3000);
        }, 1000);
      }
    };

    const handleUploadError = (e: CustomEvent<{ fileName: string; error: string }>) => {
      const { fileName, error } = e.detail;
      
      // Prevent duplicate errors for the same file
      setDocumentQueue(prev => {
        // Check if this file already has an error
        const existingError = prev.find(doc => doc.fileName === fileName && doc.status === 'error');
        if (existingError) {
          return prev; // Don't add duplicate error
        }
        
        // Update queue - either update existing doc or add new one
        const existingDoc = prev.find(doc => doc.fileName === fileName);
        if (existingDoc) {
          return prev.map(doc => 
            doc.fileName === fileName 
              ? { ...doc, status: 'error', error: error }
              : doc
          );
        } else {
          // Add new error entry if file not in queue
          return [...prev, {
            fileName: fileName || 'Unknown file',
            status: 'error',
            progress: 0,
            error: error
          }];
        }
      });
      
      // Stop polling and timer if this is the current upload
      const isCurrentUpload = uploadState?.fileName === fileName || (!fileName && uploadState);
      if (isCurrentUpload) {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        
        // Update current upload state to error (don't auto-dismiss)
        setUploadState(prev => prev ? {
          ...prev,
          status: 'error',
          error: error,
          isUploading: false
        } : {
          // If no current state, create one for display
          isUploading: false,
          progress: 0,
          fileName: fileName || 'Upload failed',
          status: 'error',
          error: error
        });
        
        setIsVisible(true);
      }
    };

    window.addEventListener('upload-start', handleUploadStart as EventListener);
    window.addEventListener('upload-progress', handleUploadProgress as EventListener);
    window.addEventListener('upload-complete', handleUploadComplete as EventListener);
    window.addEventListener('upload-error', handleUploadError as EventListener);

    return () => {
      window.removeEventListener('upload-start', handleUploadStart as EventListener);
      window.removeEventListener('upload-progress', handleUploadProgress as EventListener);
      window.removeEventListener('upload-complete', handleUploadComplete as EventListener);
      window.removeEventListener('upload-error', handleUploadError as EventListener);
      
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const handleDismiss = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsVisible(false);
    setTimeout(() => setUploadState(null), 300);
  };

  const handleCancelLinking = async (documentId: string, fileName: string) => {
    if (!documentId) return;
    
    try {
      // Unlink document from property by setting property_id to null
      // This would require a backend endpoint, for now we'll just update local state
      setDocumentQueue(prev => prev.filter(doc => doc.documentId !== documentId));
      
      if (uploadState?.documentId === documentId) {
        setUploadState(prev => prev ? {
          ...prev,
          status: 'complete',
          currentStep: 'Linking canceled'
        } : null);
      }
      
      // Stop polling for this document
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      
      console.log(`🚫 [UploadProgressBar] Canceled linking for document: ${documentId}`);
    } catch (error) {
      console.error('Error canceling linking:', error);
    }
  };

  const handleStoreWithoutExtraction = async (documentId: string, fileName: string) => {
    if (!documentId) return;
    
    try {
      // Store document without full extraction
      // This would require a backend endpoint to stop processing
      setDocumentQueue(prev => prev.map(doc => 
        doc.documentId === documentId 
          ? { ...doc, status: 'complete' }
          : doc
      ));
      
      if (uploadState?.documentId === documentId) {
        setUploadState(prev => prev ? {
          ...prev,
          status: 'complete',
          currentStep: 'Stored without extraction'
        } : null);
      }
      
      // Stop polling for this document
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      
      console.log(`💾 [UploadProgressBar] Stored document without extraction: ${documentId}`);
    } catch (error) {
      console.error('Error storing without extraction:', error);
    }
  };

  const truncateFileName = (name: string, maxLength: number = 30) => {
    if (name.length <= maxLength) return name;
    const ext = name.split('.').pop() || '';
    const nameWithoutExt = name.slice(0, name.length - ext.length - 1);
    const truncatedName = nameWithoutExt.slice(0, maxLength - ext.length - 4) + '...';
    return `${truncatedName}.${ext}`;
  };

  const isDuplicateError = (error: string): boolean => {
    if (!error) return false;
    const lowerError = error.toLowerCase();
    return lowerError.includes('already exists') || 
           lowerError.includes('duplicate') || 
           lowerError.includes('file with the same name');
  };

  const formatErrorMessage = (error: string): string => {
    if (!error) return 'Upload failed';
    if (isDuplicateError(error)) {
      return 'A document with this name already exists';
    }
    return error;
  };

  const getStatusText = () => {
    if (!uploadState) return '';
    switch (uploadState.status) {
      case 'uploading':
        return `Uploading ${Math.round(uploadState.progress)}%`;
      case 'processing':
        return uploadState.currentStep || 'Processing...';
      case 'complete':
        if (uploadState.chunkCount) {
          return `Complete · ${uploadState.chunkCount} chunks`;
        }
        return 'Complete';
      case 'error':
        return uploadState.error || 'Failed';
      default:
        return '';
    }
  };

  const getProgressColor = () => {
    if (!uploadState) return '#3B82F6';
    switch (uploadState.status) {
      case 'uploading': return '#3B82F6';
      case 'processing': return '#8B5CF6';
      case 'complete': return '#10B981';
      case 'error': return '#EF4444';
      default: return '#3B82F6';
    }
  };

  const getIcon = () => {
    if (!uploadState) return null;
    switch (uploadState.status) {
      case 'uploading':
        return <FileUp className="w-4 h-4" strokeWidth={1.5} />;
      case 'processing':
        return <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />;
      case 'complete':
        return <Check className="w-4 h-4" strokeWidth={2} />;
      case 'error':
        return <X className="w-4 h-4" strokeWidth={2} />;
      default:
        return <FileUp className="w-4 h-4" strokeWidth={1.5} />;
    }
  };

  const getStepIcon = (stepName: string) => {
    const name = stepName.toLowerCase();
    if (name.includes('classif')) return <FileSearch className="w-3.5 h-3.5" />;
    if (name.includes('extract')) return <Brain className="w-3.5 h-3.5" />;
    if (name.includes('chunk') || name.includes('parse')) return <Layers className="w-3.5 h-3.5" />;
    if (name.includes('embed') || name.includes('vector')) return <Database className="w-3.5 h-3.5" />;
    return <Loader2 className="w-3.5 h-3.5" />;
  };

  const getStepStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#10B981';
      case 'started': return '#8B5CF6';
      case 'failed': return '#EF4444';
      default: return '#9CA3AF';
    }
  };

  const formatStepName = (name: string) => {
    return name
      .replace(/_/g, ' ')
      .replace(/^\w/, c => c.toUpperCase())
      .replace(/fast pipeline/i, 'Fast Pipeline')
      .replace(/classification/i, 'Classification')
      .replace(/extraction/i, 'Extraction')
      .replace(/vectorization/i, 'Vectorization')
      .replace(/reducto/i, 'Reducto Parsing');
  };

  return (
    <AnimatePresence>
      {isVisible && uploadState && (
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -20, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          style={{
            position: 'fixed',
            top: '20px',
            left: '50%',
            right: 'auto',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            width: 'auto',
            maxWidth: '380px',
            minWidth: '320px',
            margin: '0 auto',
            padding: 0,
            boxSizing: 'border-box',
            display: 'block',
          }}
        >
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '16px',
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.08), 0 1px 4px rgba(0, 0, 0, 0.04)',
              overflow: 'hidden',
              border: '1px solid rgba(229, 231, 235, 0.6)',
              margin: 0,
              padding: 0,
              boxSizing: 'border-box',
            }}
          >
            {/* Main Content */}
            <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              {/* Icon */}
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  background: `${getProgressColor()}0F`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: getProgressColor(),
                  flexShrink: 0,
                  border: `1px solid ${getProgressColor()}20`,
                }}
              >
                {getIcon()}
              </div>

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 500,
                    color: '#111827',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginBottom: '2px',
                    lineHeight: '18px',
                  }}
                >
                  {truncateFileName(uploadState.fileName, 30)}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: uploadState.status === 'error' ? '#EF4444' : '#6B7280',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                    lineHeight: '16px',
                  }}
                  title={uploadState.status === 'error' && uploadState.error ? uploadState.error : undefined}
                >
                  <span style={{ fontWeight: 400 }}>
                    {uploadState.status === 'error' && uploadState.error 
                      ? (() => {
                          const formattedError = formatErrorMessage(uploadState.error);
                          return formattedError.length > 40 ? formattedError.substring(0, 40) + '...' : formattedError;
                        })()
                      : getStatusText()}
                  </span>
                  {/* Timer */}
                  {(uploadState.status === 'uploading' || uploadState.status === 'processing') && (
                    <span style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '4px',
                      color: '#9CA3AF',
                      fontSize: '11px',
                      fontWeight: 400,
                    }}>
                      <Clock className="w-3 h-3" strokeWidth={1.5} />
                      {formatTime(elapsedTime)}
                    </span>
                  )}
                  {uploadState.status === 'complete' && uploadState.processingTime && (
                    <span style={{ color: '#9CA3AF', fontSize: '11px', fontWeight: 400 }}>
                      · {uploadState.processingTime.toFixed(1)}s
                    </span>
                  )}
                </div>
              </div>

              {/* Queue Dropdown Button */}
              {documentQueue.length > 1 && (
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => setShowQueueDropdown(!showQueueDropdown)}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '6px',
                      border: '1px solid rgba(229, 231, 235, 0.6)',
                      background: showQueueDropdown ? '#F9FAFB' : '#FFFFFF',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#6B7280',
                      flexShrink: 0,
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#F9FAFB';
                      e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.8)';
                    }}
                    onMouseLeave={(e) => {
                      if (!showQueueDropdown) {
                        e.currentTarget.style.background = '#FFFFFF';
                        e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.6)';
                      }
                    }}
                    title={`${documentQueue.length} documents in queue`}
                  >
                    <FileText className="w-3.5 h-3.5" strokeWidth={1.5} />
                  </button>

                  {/* Queue Dropdown - positioned at top of screen */}
                  {showQueueDropdown && (
                    <div
                      ref={queueDropdownRef}
                      style={{
                        position: 'fixed',
                        top: '60px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: '320px',
                        maxHeight: '300px',
                        background: '#FFFFFF',
                        borderRadius: '12px',
                        border: '1px solid rgba(229, 231, 235, 0.6)',
                        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.08), 0 1px 4px rgba(0, 0, 0, 0.04)',
                        overflow: 'hidden',
                        zIndex: 10000,
                      }}
                    >
                      <div style={{ padding: '6px', maxHeight: '300px', overflowY: 'auto' }}>
                        {documentQueue.map((doc, index) => (
                          <div
                            key={index}
                            style={{
                              padding: '10px 12px',
                              borderRadius: '8px',
                              marginBottom: index < documentQueue.length - 1 ? '2px' : 0,
                              background: doc.documentId === uploadState?.documentId ? '#F9FAFB' : 'transparent',
                              border: doc.documentId === uploadState?.documentId ? '1px solid rgba(229, 231, 235, 0.6)' : '1px solid transparent',
                              transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={(e) => {
                              if (doc.documentId !== uploadState?.documentId) {
                                e.currentTarget.style.background = '#FAFAFA';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (doc.documentId !== uploadState?.documentId) {
                                e.currentTarget.style.background = 'transparent';
                              }
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={{
                                width: '20px',
                                height: '20px',
                                borderRadius: '6px',
                                background: doc.status === 'complete' ? '#10B9810F' : doc.status === 'error' ? '#EF44440F' : doc.status === 'processing' ? '#8B5CF60F' : '#3B82F60F',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: doc.status === 'complete' ? '#10B981' : doc.status === 'error' ? '#EF4444' : doc.status === 'processing' ? '#8B5CF6' : '#3B82F6',
                                flexShrink: 0,
                              }}>
                                {doc.status === 'complete' ? <Check className="w-3 h-3" strokeWidth={2} /> :
                                 doc.status === 'error' ? <X className="w-3 h-3" strokeWidth={2} /> :
                                 doc.status === 'processing' ? <Loader2 className="w-3 h-3 animate-spin" strokeWidth={1.5} /> :
                                 <FileUp className="w-3 h-3" strokeWidth={1.5} />}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                  fontSize: '12px',
                                  fontWeight: 500,
                                  color: '#111827',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  marginBottom: '2px',
                                  lineHeight: '16px',
                                }}>
                                  {truncateFileName(doc.fileName, 28)}
                                </div>
                                <div style={{
                                  fontSize: '11px',
                                  color: doc.status === 'error' ? '#EF4444' : '#6B7280',
                                  lineHeight: '14px',
                                }}
                                title={doc.status === 'error' && doc.error ? doc.error : undefined}
                                >
                                  {doc.status === 'uploading' ? `Uploading ${Math.round(doc.progress)}%` :
                                   doc.status === 'processing' ? 'Processing...' :
                                   doc.status === 'complete' ? 'Complete' :
                                   doc.status === 'error' ? (() => {
                                     if (!doc.error) return 'Error';
                                     const formattedError = formatErrorMessage(doc.error);
                                     return formattedError.length > 30 ? formattedError.substring(0, 30) + '...' : formattedError;
                                   })() :
                                   'Unknown'}
                                </div>
                              </div>
                            </div>
                            
                            {/* Action buttons */}
                            {doc.documentId && doc.status === 'processing' && (
                              <div style={{ display: 'flex', gap: '6px', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(229, 231, 235, 0.6)' }}>
                                <button
                                  onClick={() => handleCancelLinking(doc.documentId!, doc.fileName)}
                                  style={{
                                    flex: 1,
                                    padding: '5px 8px',
                                    borderRadius: '6px',
                                    border: '1px solid rgba(229, 231, 235, 0.6)',
                                    background: '#FFFFFF',
                                    color: '#6B7280',
                                    fontSize: '10px',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '4px',
                                    transition: 'all 0.15s ease',
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = '#F9FAFB';
                                    e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.8)';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = '#FFFFFF';
                                    e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.6)';
                                  }}
                                >
                                  <Trash2 className="w-3 h-3" strokeWidth={1.5} />
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleStoreWithoutExtraction(doc.documentId!, doc.fileName)}
                                  style={{
                                    flex: 1,
                                    padding: '5px 8px',
                                    borderRadius: '6px',
                                    border: '1px solid rgba(229, 231, 235, 0.6)',
                                    background: '#FFFFFF',
                                    color: '#6B7280',
                                    fontSize: '10px',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '4px',
                                    transition: 'all 0.15s ease',
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = '#F9FAFB';
                                    e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.8)';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = '#FFFFFF';
                                    e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.6)';
                                  }}
                                >
                                  <Save className="w-3 h-3" strokeWidth={1.5} />
                                  Store
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Expand/Collapse button (only during processing) */}
              {uploadState.status === 'processing' && uploadState.processingSteps && uploadState.processingSteps.length > 0 && (
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    border: '1px solid rgba(229, 231, 235, 0.6)',
                    background: '#FFFFFF',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#6B7280',
                    flexShrink: 0,
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#F9FAFB';
                    e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.8)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#FFFFFF';
                    e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.6)';
                  }}
                >
                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" strokeWidth={1.5} /> : <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.5} />}
                </button>
              )}

              {/* Dismiss button */}
              {(uploadState.status === 'complete' || uploadState.status === 'error') && (
                <button
                  onClick={handleDismiss}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    border: '1px solid rgba(229, 231, 235, 0.6)',
                    background: '#FFFFFF',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#9CA3AF',
                    flexShrink: 0,
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#F9FAFB';
                    e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.8)';
                    e.currentTarget.style.color = '#6B7280';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#FFFFFF';
                    e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.6)';
                    e.currentTarget.style.color = '#9CA3AF';
                  }}
                >
                  <X className="w-3.5 h-3.5" strokeWidth={1.5} />
                </button>
              )}
            </div>

            {/* Progress bar */}
            <div
              style={{
                height: '2px',
                background: '#F3F4F6',
                overflow: 'hidden',
              }}
            >
              <motion.div
                initial={{ width: 0 }}
                animate={{ 
                  width: uploadState.status === 'processing' || uploadState.status === 'complete' 
                    ? '100%' 
                    : `${uploadState.progress}%`,
                }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                style={{
                  height: '100%',
                  background: getProgressColor(),
                  position: 'relative',
                }}
              >
                {uploadState.status === 'processing' && (
                  <motion.div
                    animate={{ x: ['-100%', '100%'] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)',
                    }}
                  />
                )}
              </motion.div>
            </div>

            {/* Expanded Processing Steps */}
            <AnimatePresence>
              {isExpanded && uploadState.processingSteps && uploadState.processingSteps.length > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div
                    style={{
                      padding: '12px 16px',
                      borderTop: '1px solid rgba(229, 231, 235, 0.6)',
                      background: '#FAFAFA',
                    }}
                  >
                    <div style={{ fontSize: '10px', fontWeight: 500, color: '#9CA3AF', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Extraction Pipeline
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {uploadState.processingSteps.map((step, index) => (
                        <div
                          key={index}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                          }}
                        >
                          {/* Step icon */}
                          <div
                            style={{
                              width: '24px',
                              height: '24px',
                              borderRadius: '6px',
                              background: `${getStepStatusColor(step.status)}0F`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: getStepStatusColor(step.status),
                              flexShrink: 0,
                              border: `1px solid ${getStepStatusColor(step.status)}20`,
                            }}
                          >
                            {step.status === 'started' ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : step.status === 'completed' ? (
                              <Check className="w-3.5 h-3.5" />
                            ) : step.status === 'failed' ? (
                              <X className="w-3.5 h-3.5" />
                            ) : (
                              getStepIcon(step.name)
                            )}
                          </div>

                          {/* Step info */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: '12px',
                                fontWeight: 400,
                                color: step.status === 'completed' ? '#10B981' : step.status === 'started' ? '#111827' : '#9CA3AF',
                                lineHeight: '16px',
                              }}
                            >
                              {formatStepName(step.name)}
                            </div>
                            {step.message && (
                              <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '2px', lineHeight: '14px' }}>
                                {step.message}
                              </div>
                            )}
                            {step.metadata?.chunk_count && (
                              <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '2px' }}>
                                {step.metadata.chunk_count} chunks generated
                              </div>
                            )}
                            {step.metadata?.reducto_job_id && (
                              <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '2px', fontFamily: 'monospace' }}>
                                Job: {step.metadata.reducto_job_id.slice(0, 8)}...
                              </div>
                            )}
                            {step.metadata?.processing_time_seconds && (
                              <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '2px' }}>
                                {step.metadata.processing_time_seconds.toFixed(1)}s
                              </div>
                            )}
                          </div>

                          {/* Status indicator */}
                          <div
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: getStepStatusColor(step.status),
                              flexShrink: 0,
                            }}
                          />
                        </div>
                      ))}
                    </div>

                    {/* Summary stats */}
                    {(uploadState.chunkCount || uploadState.processingTime || uploadState.reductoJobId) && (
                      <div
                        style={{
                          marginTop: '12px',
                          paddingTop: '10px',
                          borderTop: '1px solid #E5E7EB',
                          display: 'flex',
                          gap: '16px',
                          fontSize: '11px',
                          flexWrap: 'wrap',
                        }}
                      >
                        {uploadState.chunkCount && (
                          <div style={{ color: '#6B7280' }}>
                            <span style={{ fontWeight: 600, color: '#1F2937' }}>{uploadState.chunkCount}</span> chunks
                          </div>
                        )}
                        {uploadState.processingTime && (
                          <div style={{ color: '#6B7280' }}>
                            <span style={{ fontWeight: 600, color: '#1F2937' }}>{uploadState.processingTime.toFixed(1)}s</span> total
                          </div>
                        )}
                        {uploadState.reductoJobId && (
                          <div style={{ color: '#9CA3AF', fontFamily: 'monospace', fontSize: '10px' }}>
                            Reducto: {uploadState.reductoJobId.slice(0, 8)}...
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// Helper functions to dispatch upload events from anywhere in the app
export const uploadEvents = {
  start: (fileName: string) => {
    window.dispatchEvent(new CustomEvent('upload-start', { detail: { fileName } }));
  },
  progress: (progress: number, fileName: string) => {
    window.dispatchEvent(new CustomEvent('upload-progress', { detail: { progress, fileName } }));
  },
  complete: (fileName: string, documentId?: string) => {
    window.dispatchEvent(new CustomEvent('upload-complete', { detail: { fileName, documentId } }));
  },
  error: (fileName: string, error: string) => {
    window.dispatchEvent(new CustomEvent('upload-error', { detail: { fileName, error } }));
  },
};

export default UploadProgressBar;

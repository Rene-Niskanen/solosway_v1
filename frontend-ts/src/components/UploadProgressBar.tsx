import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileUp, Check, X, Loader2, Brain, Layers, Database, FileSearch, ChevronDown, ChevronUp, Clock } from 'lucide-react';
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
  processingSteps?: ProcessingStep[];
  currentStep?: string;
  chunkCount?: number;
  processingTime?: number;
  startTime?: number;
  reductoJobId?: string;
}

/**
 * Global upload progress bar with real-time extraction status
 * Shows upload progress, timer, and detailed extraction pipeline status
 */
export const UploadProgressBar: React.FC = () => {
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true); // Auto-expand by default
  const [elapsedTime, setElapsedTime] = useState(0);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pollErrorCountRef = useRef<number>(0);
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
          
          // Auto-hide after delay
          setTimeout(() => {
            setIsVisible(false);
            setTimeout(() => setUploadState(null), 300);
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
        
        // Auto-hide after delay
        setTimeout(() => {
          setIsVisible(false);
          setTimeout(() => setUploadState(null), 300);
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

  useEffect(() => {
    const handleUploadStart = (e: CustomEvent<{ fileName: string }>) => {
      console.log(`📊 [UploadProgressBar] Upload start event received:`, e.detail.fileName);
      setUploadState({
        isUploading: true,
        progress: 0,
        fileName: e.detail.fileName,
        status: 'uploading',
        startTime: Date.now()
      });
      setIsVisible(true);
      setIsExpanded(true);
      setElapsedTime(0);
    };

    const handleUploadProgress = (e: CustomEvent<{ progress: number; fileName: string }>) => {
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

    const handleUploadComplete = (e: CustomEvent<{ fileName: string; documentId?: string }>) => {
      const { fileName, documentId } = e.detail;
      
      console.log(`📊 [UploadProgressBar] Upload complete event received:`, { fileName, documentId });
      
      setUploadState(prev => prev ? {
        ...prev,
        progress: 100,
        status: 'processing',
        isUploading: false,
        documentId: documentId,
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
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      
      setUploadState(prev => prev ? {
        ...prev,
        status: 'error',
        error: e.detail.error,
        isUploading: false
      } : null);
      
      setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => setUploadState(null), 300);
      }, 5000);
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

  const truncateFileName = (name: string, maxLength: number = 30) => {
    if (name.length <= maxLength) return name;
    const ext = name.split('.').pop() || '';
    const nameWithoutExt = name.slice(0, name.length - ext.length - 1);
    const truncatedName = nameWithoutExt.slice(0, maxLength - ext.length - 4) + '...';
    return `${truncatedName}.${ext}`;
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
        return <FileUp className="w-4 h-4" />;
      case 'processing':
        return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'complete':
        return <Check className="w-4 h-4" />;
      case 'error':
        return <X className="w-4 h-4" />;
      default:
        return <FileUp className="w-4 h-4" />;
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
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          style={{
            position: 'fixed',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            width: 'auto',
            maxWidth: '480px',
            minWidth: '320px',
          }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '14px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)',
              overflow: 'hidden',
              border: '1px solid rgba(0,0,0,0.06)',
            }}
          >
            {/* Main Content */}
            <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              {/* Icon */}
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: `${getProgressColor()}15`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: getProgressColor(),
                  flexShrink: 0,
                }}
              >
                {getIcon()}
              </div>

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#1F2937',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginBottom: '2px',
                  }}
                >
                  {truncateFileName(uploadState.fileName)}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: uploadState.status === 'error' ? '#EF4444' : '#6B7280',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span>{getStatusText()}</span>
                  {/* Timer */}
                  {(uploadState.status === 'uploading' || uploadState.status === 'processing') && (
                    <span style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '4px',
                      color: '#9CA3AF',
                      fontSize: '11px',
                      fontWeight: 500,
                    }}>
                      <Clock className="w-3 h-3" />
                      {formatTime(elapsedTime)}
                    </span>
                  )}
                  {uploadState.status === 'complete' && uploadState.processingTime && (
                    <span style={{ color: '#9CA3AF', fontSize: '11px' }}>
                      · {uploadState.processingTime.toFixed(1)}s
                    </span>
                  )}
                </div>
              </div>

              {/* Expand/Collapse button (only during processing) */}
              {uploadState.status === 'processing' && uploadState.processingSteps && uploadState.processingSteps.length > 0 && (
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#F3F4F6',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#6B7280',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#E5E7EB';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#F3F4F6';
                  }}
                >
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
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
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#9CA3AF',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#F3F4F6';
                    e.currentTarget.style.color = '#6B7280';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = '#9CA3AF';
                  }}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Progress bar */}
            <div
              style={{
                height: '3px',
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
                      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
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
                      borderTop: '1px solid #F3F4F6',
                      background: '#FAFAFA',
                    }}
                  >
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#9CA3AF', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
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
                              background: `${getStepStatusColor(step.status)}15`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: getStepStatusColor(step.status),
                              flexShrink: 0,
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
                                fontWeight: 500,
                                color: step.status === 'completed' ? '#10B981' : step.status === 'started' ? '#1F2937' : '#9CA3AF',
                              }}
                            >
                              {formatStepName(step.name)}
                            </div>
                            {step.message && (
                              <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '2px' }}>
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

import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';

interface ProgressData {
  progress: number;
  stage: string;
  message: string;
  complete: boolean;
  error: string | null;
}

interface ReprocessProgressMonitorProps {
  documentId: string | null;
  isActive: boolean;
  onComplete?: (success: boolean) => void;
  onClose?: () => void;
}

const stageLabels: Record<string, string> = {
  init: 'Initializing',
  fetch: 'Fetching Document',
  download: 'Downloading',
  parsing: 'Parsing with Reducto',
  parsed: 'Parsing Complete',
  cleanup: 'Cleaning Up',
  embedding: 'Generating Embeddings',
  updating: 'Updating Vectors',
  complete: 'Complete',
  error: 'Error',
  waiting: 'Waiting',
  timeout: 'Timeout',
};

export const ReprocessProgressMonitor: React.FC<ReprocessProgressMonitorProps> = ({
  documentId,
  isActive,
  onComplete,
  onClose,
}) => {
  const [progress, setProgress] = useState<ProgressData>({
    progress: 0,
    stage: 'waiting',
    message: 'Waiting to start...',
    complete: false,
    error: null,
  });
  const eventSourceRef = useRef<EventSource | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!isActive || !documentId) {
      // Close any existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setIsConnected(false);
      }
      return;
    }

    // Create SSE connection
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';
    const url = `${backendUrl}/api/documents/${documentId}/reprocess/progress`;
    
    console.log('🔄 Connecting to SSE progress stream:', url);
    
    const eventSource = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('✅ SSE connection established');
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ProgressData;
        console.log('📊 Progress update:', data);
        setProgress(data);

        // If complete, close connection and notify
        if (data.complete) {
          eventSource.close();
          eventSourceRef.current = null;
          setIsConnected(false);
          onComplete?.(data.error === null);
        }
      } catch (e) {
        console.error('Error parsing SSE data:', e);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      setIsConnected(false);
      // Don't close - EventSource auto-reconnects
    };

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setIsConnected(false);
      }
    };
  }, [isActive, documentId, onComplete]);

  if (!isActive) return null;

  const getProgressColor = () => {
    if (progress.error) return 'bg-red-500';
    if (progress.complete) return 'bg-green-500';
    return 'bg-blue-500';
  };

  const getIcon = () => {
    if (progress.error) return <XCircle className="w-5 h-5 text-red-500" />;
    if (progress.complete) return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        className="fixed bottom-6 right-6 z-50"
      >
        <div 
          className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
          style={{ width: '320px' }}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-gray-500" />
              <span className="font-medium text-sm text-gray-700 dark:text-gray-200">
                Reprocessing Document
              </span>
            </div>
            {progress.complete && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs"
              >
                Close
              </button>
            )}
          </div>

          {/* Progress content */}
          <div className="px-4 py-4">
            {/* Stage indicator */}
            <div className="flex items-center gap-2 mb-3">
              {getIcon()}
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                {stageLabels[progress.stage] || progress.stage}
              </span>
            </div>

            {/* Progress bar */}
            <div className="relative h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-2">
              <motion.div
                className={`absolute inset-y-0 left-0 ${getProgressColor()} rounded-full`}
                initial={{ width: 0 }}
                animate={{ width: `${progress.progress}%` }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
              />
            </div>

            {/* Progress percentage and message */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                {progress.message}
              </span>
              <span className="text-xs font-mono text-gray-600 dark:text-gray-300">
                {progress.progress}%
              </span>
            </div>

            {/* Error message */}
            {progress.error && (
              <div className="mt-3 p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <p className="text-xs text-red-600 dark:text-red-400">
                  {progress.error}
                </p>
              </div>
            )}

            {/* Success message */}
            {progress.complete && !progress.error && (
              <div className="mt-3 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <p className="text-xs text-green-600 dark:text-green-400">
                  ✅ Document reprocessed successfully!
                </p>
              </div>
            )}
          </div>

          {/* Connection status */}
          <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-yellow-500'}`} />
              <span className="text-[10px] text-gray-400">
                {isConnected ? 'Live updates' : 'Connecting...'}
              </span>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ReprocessProgressMonitor;


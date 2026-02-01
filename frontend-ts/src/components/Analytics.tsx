"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { FileText, RefreshCw, CheckCircle, Clock } from "lucide-react";
import { backendApi } from "@/services/backendApi";
import { format } from "date-fns";

// ============================================================================
// TYPES
// ============================================================================

interface ProcessingHistoryStep {
  id: string;
  step_name: string;
  step_status: 'started' | 'completed' | 'failed';
  started_at: string;
  completed_at?: string;
  duration_seconds?: number;
}

interface QueueDocument {
  id: string;
  original_filename: string;
  status: string;
  created_at: string;
  file_type?: string;
}

interface ProcessingQueueItem {
  document: QueueDocument;
  processing_history: ProcessingHistoryStep[];
}

interface Stage {
  name: string;
  status: 'completed' | 'in_progress' | 'pending';
  timestamp?: string;
}

interface AnalyticsProps {
  className?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatElapsedTime(startTime: string): string {
  const start = new Date(startTime);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - start.getTime()) / 1000);
  
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatTimestamp(dateString: string): string {
  const date = new Date(dateString);
  return format(date, "MMM d, yyyy · h:mma").toLowerCase();
}

function mapHistoryToStages(history: ProcessingHistoryStep[], docStatus: string): Stage[] {
  const stageDefinitions = [
    { key: 'queued', name: 'Stage 1: Queued' },
    { key: 'extraction', name: 'Stage 2: Parsing' },
    { key: 'classification', name: 'Stage 3: Classifying' },
    { key: 'vector_storage', name: 'Stage 4: Embedding' },
    { key: 'complete', name: 'Stage 5: Complete' },
  ];
  
  const historyMap = new Map<string, ProcessingHistoryStep>();
  for (const step of history) {
    const key = step.step_name === 'minimal_extraction' ? 'extraction' : step.step_name;
    if (!historyMap.has(key) || step.started_at > historyMap.get(key)!.started_at) {
      historyMap.set(key, step);
    }
  }
  
  // Always mark queued as completed if document exists
  const stages: Stage[] = [{
    name: 'Stage 1: Queued',
    status: 'completed',
    timestamp: history[0]?.started_at ? formatTimestamp(history[0].started_at) : undefined
  }];
  
  let foundInProgress = false;
  
  for (let i = 1; i < stageDefinitions.length; i++) {
    const def = stageDefinitions[i];
    const step = historyMap.get(def.key);
    
    if (def.key === 'complete') {
      stages.push({
        name: def.name,
        status: docStatus === 'completed' ? 'completed' : 'pending',
        timestamp: docStatus === 'completed' ? formatTimestamp(new Date().toISOString()) : undefined
      });
    } else if (step) {
      const isCompleted = step.step_status === 'completed';
      const isInProgress = step.step_status === 'started' && !isCompleted;
      
      stages.push({
        name: def.name,
        status: isCompleted ? 'completed' : isInProgress ? 'in_progress' : 'pending',
        timestamp: step.started_at ? formatTimestamp(step.started_at) : undefined
      });
      
      if (isInProgress) foundInProgress = true;
    } else {
      stages.push({
        name: def.name,
        status: foundInProgress ? 'pending' : 'pending'
      });
    }
  }
  
  return stages;
}

// ============================================================================
// COMPONENTS
// ============================================================================

function ActivityTimeline({ stages }: { stages: Stage[] }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-4">
        Activity
      </p>
      <div className="relative">
        {/* Vertical connecting line */}
        <div className="absolute left-[5px] top-3 bottom-3 w-px bg-gray-200" />
        
        <div className="space-y-4">
          {stages.map((stage) => (
            <div key={stage.name} className="relative pl-6">
              {/* Status dot */}
              <div className={`absolute left-0 top-1 w-2.5 h-2.5 rounded-full ${
                stage.status === 'completed' ? 'bg-gray-400' :
                stage.status === 'in_progress' ? 'bg-blue-500 animate-pulse' :
                'bg-gray-200 border border-gray-300'
              }`} />
              
              {/* Stage content */}
              <p className={`text-sm ${
                stage.status === 'pending' ? 'text-gray-400' : 'font-medium text-gray-900'
              }`}>
                {stage.name}
              </p>
              <p className="text-xs text-gray-400">
                {stage.timestamp || (stage.status === 'in_progress' ? 'In progress...' : 'Pending')}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DocumentQueueCard({ item }: { item: ProcessingQueueItem }) {
  const { document, processing_history } = item;
  const elapsedTime = formatElapsedTime(document.created_at);
  const stages = mapHistoryToStages(processing_history, document.status);
  
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-6">
      {/* Document Header */}
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
        <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
          <FileText className="w-4 h-4 text-red-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {document.original_filename}
          </p>
          <p className="text-xs text-gray-400 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Processing for {elapsedTime}
          </p>
        </div>
      </div>
      
      {/* Activity Timeline */}
      <ActivityTimeline stages={stages} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
        <CheckCircle className="w-8 h-8 text-gray-400" />
      </div>
      <p className="text-sm font-medium text-gray-900">All caught up</p>
      <p className="text-xs text-gray-400 mt-1">No documents are currently processing</p>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function Analytics({ className }: AnalyticsProps) {
  const [queueItems, setQueueItems] = useState<ProcessingQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchQueue = useCallback(async (showSpinner = false) => {
    if (showSpinner) setIsRefreshing(true);
    try {
      const response = await backendApi.getProcessingQueue();
      console.log('Processing queue response:', response);
      if (response.success && response.data) {
        // Handle nested data structure: response.data might be { success, data: [...] } or just [...]
        const items = Array.isArray(response.data) 
          ? response.data 
          : (response.data.data && Array.isArray(response.data.data) 
              ? response.data.data 
              : []);
        setQueueItems(items);
      }
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Error fetching processing queue:', error);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Initial fetch and polling every 3 seconds
  useEffect(() => {
    fetchQueue();
    const interval = setInterval(() => fetchQueue(false), 3000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#f8f9fa]">
        <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className={`w-full h-full bg-[#f8f9fa] overflow-y-auto ${className || ''}`}>
      <div className="max-w-2xl mx-auto p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Processing Queue</h1>
            <p className="text-xs text-gray-400 mt-1">
              Last updated {format(lastRefresh, 'h:mm:ss a')}
            </p>
          </div>
          <button
            onClick={() => fetchQueue(true)}
            disabled={isRefreshing}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
        
        {/* Queue Items or Empty State */}
        {queueItems.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-4">
            {queueItems.map(item => (
              <DocumentQueueCard key={item.document.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

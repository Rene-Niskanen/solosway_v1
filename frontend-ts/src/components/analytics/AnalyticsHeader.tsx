import React from 'react';
import { motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AnalyticsHeaderProps {
  viewMode: 'overview' | 'documents' | 'activity';
  setViewMode: (mode: 'overview' | 'documents' | 'activity') => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export default function AnalyticsHeader({ 
  viewMode, 
  setViewMode, 
  onRefresh, 
  isRefreshing 
}: AnalyticsHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-between flex-shrink-0"
    >
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent mb-2">
          Analytics Dashboard
        </h1>
        <p className="text-slate-600">Monitor your data usage and system activity</p>
      </div>
      
      <div className="flex items-center space-x-4">
        <Button
          onClick={onRefresh}
          disabled={isRefreshing}
          size="sm"
          variant="outline"
          className="flex items-center gap-2 hover:bg-slate-50 border-slate-200"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
        
        <div className="flex items-center space-x-1 bg-white rounded-xl border border-slate-200 p-1 shadow-sm">
          {(['overview', 'documents', 'activity'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                viewMode === mode
                  ? 'bg-slate-900 text-white shadow-md transform scale-[1.02]'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Activity, 
  BarChart3, 
  TrendingUp, 
  Building, 
  Search, 
  FileText, 
  Trash2, 
  Clock 
} from 'lucide-react';

interface ActivityItem {
  id: string;
  action: string;
  documents: any[];
  timestamp: Date;
  type: string;
  details?: any;
}

interface ActivityFeedProps {
  activities: ActivityItem[];
}

export default function ActivityFeed({ activities }: ActivityFeedProps) {
  const getActivityIcon = (type: string) => {
    const iconMap = {
      analysis: BarChart3,
      comparison: TrendingUp,
      valuation: Building,
      search: Search,
      upload: FileText,
      deletion: Trash2,
    };
    
    const IconComponent = iconMap[type as keyof typeof iconMap] || Activity;
    return <IconComponent className="w-5 h-5" />;
  };

  const getActivityColor = (type: string) => {
    const colorMap = {
      analysis: 'from-blue-500 to-indigo-600',
      comparison: 'from-purple-500 to-pink-600',
      valuation: 'from-emerald-500 to-green-600',
      search: 'from-amber-500 to-orange-600',
      upload: 'from-cyan-500 to-blue-600',
      deletion: 'from-red-500 to-rose-600',
    };
    
    return colorMap[type as keyof typeof colorMap] || 'from-slate-500 to-slate-600';
  };

  const formatTimestamp = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return `${Math.floor(diffMins / 1440)}d ago`;
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300">
      <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
        <div className="flex items-center space-x-4">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center shadow-md">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Real-time System Activity</h2>
            <p className="text-sm text-slate-600">Recent system operations and processes</p>
          </div>
        </div>
      </div>
      
      <div className="p-6">
        <div className="space-y-4 max-h-80 overflow-y-auto">
          <AnimatePresence>
            {activities.map((activity, index) => (
              <motion.div
                key={activity.id}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                transition={{ delay: index * 0.1, duration: 0.4 }}
                className="group flex items-start space-x-4 p-4 bg-gradient-to-r from-slate-50 to-white rounded-xl border border-slate-100 hover:shadow-md hover:border-slate-200 transition-all duration-300"
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-md group-hover:shadow-lg group-hover:scale-105 transition-all duration-300 bg-gradient-to-br ${getActivityColor(activity.type)}`}>
                  <div className="text-white">
                    {getActivityIcon(activity.type)}
                  </div>
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className="text-slate-900 font-medium text-base leading-relaxed group-hover:text-slate-800 transition-colors">
                    {activity.action}
                  </p>
                  
                  <div className="flex items-center space-x-4 mt-3">
                    <div className="flex items-center space-x-2 text-sm text-slate-500">
                      <Clock className="w-4 h-4" />
                      <span className="font-medium">{formatTimestamp(activity.timestamp)}</span>
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-slate-500">
                      <FileText className="w-4 h-4" />
                      <span>
                        {activity.documents.length} document{activity.documents.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>

                  {/* Activity type badge */}
                  <div className="mt-2">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                      {activity.type}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center">
                  <motion.div 
                    className="w-3 h-3 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full shadow-sm"
                    animate={{ 
                      scale: [1, 1.2, 1],
                      opacity: [0.8, 1, 0.8]
                    }}
                    transition={{ 
                      duration: 2,
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                  />
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          
          {activities.length === 0 && (
            <div className="text-center py-12">
              <Activity className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500 font-medium">No recent activity</p>
              <p className="text-sm text-slate-400 mt-1">System activities will appear here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
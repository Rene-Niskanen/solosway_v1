import React from 'react';
import { motion } from 'framer-motion';
import { Database, Activity, TrendingUp, BarChart3 } from 'lucide-react';

interface OverviewCardsProps {
  totalDocuments: number;
  totalStorage: string;
  processingCount: number;
  activitiesCount: number;
}

export default function OverviewCards({ 
  totalDocuments, 
  totalStorage, 
  processingCount, 
  activitiesCount 
}: OverviewCardsProps) {
  const cards = [
    {
      title: 'Total Documents',
      subtitle: 'Files in system',
      value: totalDocuments,
      detail: `Total storage: ${totalStorage}`,
      icon: Database,
      gradient: 'from-blue-500 to-indigo-600',
      bgGradient: 'from-blue-50 to-indigo-50',
      delay: 0
    },
    {
      title: 'Active Processes',
      subtitle: 'Currently running',
      value: processingCount,
      detail: 'Processing documents',
      icon: Activity,
      gradient: 'from-emerald-500 to-green-600',
      bgGradient: 'from-emerald-50 to-green-50',
      delay: 0.1
    },
    {
      title: 'System Actions',
      subtitle: 'Recent activity',
      value: activitiesCount,
      detail: 'In the last hour',
      icon: TrendingUp,
      gradient: 'from-purple-500 to-pink-600',
      bgGradient: 'from-purple-50 to-pink-50',
      delay: 0.2
    }
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="grid grid-cols-1 md:grid-cols-3 gap-6"
    >
      {cards.map((card, index) => (
        <motion.div
          key={card.title}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: card.delay, duration: 0.5 }}
          className="group relative bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
        >
          <div className={`absolute inset-0 bg-gradient-to-br ${card.bgGradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
          
          <div className="relative p-6">
            <div className="flex items-center space-x-4 mb-6">
              <div className={`w-12 h-12 bg-gradient-to-br ${card.gradient} rounded-xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                <card.icon className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 group-hover:text-slate-800 transition-colors">
                  {card.title}
                </h3>
                <p className="text-xs text-slate-500">{card.subtitle}</p>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="text-4xl font-bold text-slate-900 group-hover:text-slate-800 transition-colors">
                {card.value}
              </div>
              <p className="text-sm text-slate-500 group-hover:text-slate-600 transition-colors">
                {card.detail}
              </p>
            </div>

            {/* Decorative element */}
            <div className={`absolute -bottom-2 -right-2 w-20 h-20 bg-gradient-to-br ${card.gradient} rounded-full opacity-5 group-hover:opacity-10 transition-opacity duration-300`} />
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}
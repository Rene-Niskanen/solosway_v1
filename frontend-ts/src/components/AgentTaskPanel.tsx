"use client";

import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { AgentTaskCard } from './AgentTaskCard';
import type { AgentTask } from '../contexts/AgentOrchestrationContext';

interface AgentTaskPanelProps {
  tasks: AgentTask[];
  onInjectResult: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onRetry: (taskId: string) => void;
}

export const AgentTaskPanel: React.FC<AgentTaskPanelProps> = ({
  tasks,
  onInjectResult,
  onCancel,
  onRetry,
}) => {
  if (tasks.length === 0) return null;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: '4px 0', marginTop: 4,
    }}>
      <AnimatePresence>
        {tasks.map((task, i) => (
          <AgentTaskCard
            key={task.id}
            task={task}
            onInjectResult={onInjectResult}
            onCancel={onCancel}
            onRetry={onRetry}
            index={i}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default AgentTaskPanel;

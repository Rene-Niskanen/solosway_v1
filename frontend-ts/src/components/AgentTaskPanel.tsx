"use client";

import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { AgentTaskCard } from './AgentTaskCard';
import type { AgentTask, AgentTaskCitation } from '../contexts/AgentOrchestrationContext';

interface AgentTaskPanelProps {
  tasks: AgentTask[];
  onInjectResult: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  /** When true, lay out task cards in a row (e.g. beside the Sources button in the feedback bar). */
  inline?: boolean;
  /** Same citation mapping as normal responses: renders CitationLink pills for [1], [2] etc. */
  renderCitation?: (citationNumber: string, citationData: AgentTaskCitation, key: string) => React.ReactNode;
}

export const AgentTaskPanel: React.FC<AgentTaskPanelProps> = ({
  tasks,
  onInjectResult,
  onCancel,
  onRetry,
  inline = false,
  renderCitation,
}) => {
  if (tasks.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      flexDirection: inline ? 'row' : 'column',
      alignItems: inline ? 'center' : undefined,
      gap: inline ? 8 : 6,
      padding: inline ? '0' : '4px 0',
      marginTop: inline ? 0 : 4,
      flexShrink: inline ? 0 : undefined,
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
            renderCitation={renderCitation}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default AgentTaskPanel;

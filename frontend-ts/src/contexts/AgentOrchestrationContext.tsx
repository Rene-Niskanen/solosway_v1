"use client";

import React, { createContext, useContext, useReducer, useCallback, useRef, useEffect } from 'react';
import { backendApi } from '../services/backendApi';
import type { ReasoningStep } from '../components/ReasoningSteps';

export interface AgentTaskDocMeta {
  filename: string;
  type: 'pdf' | 'docx';
  doc_id: string;
}

export interface AgentTaskCitation {
  doc_id: string;
  page: number;
  bbox: { left: number; top: number; width: number; height: number; page?: number };
  block_id?: string;
  original_filename?: string | null;
  cited_text?: string;
}

export interface AgentTask {
  id: string;
  query: string;
  documentIds: string[];
  documentMeta: AgentTaskDocMeta[];
  status: 'searching' | 'analysing' | 'complete' | 'error';
  statusMessage: string;
  resultText: string;
  citations: Record<string, AgentTaskCitation>;
  reasoningSteps: ReasoningStep[];
  error?: string;
  createdAt: number;
  completedAt?: number;
  sessionId: string;
  parentChatId: string;
}

const MAX_CONCURRENT_TASKS = 5;

type TaskAction =
  | { type: 'ADD_TASK'; task: AgentTask }
  | { type: 'UPDATE_STATUS'; taskId: string; status: AgentTask['status']; statusMessage?: string }
  | { type: 'APPEND_TOKEN'; taskId: string; token: string }
  | { type: 'ADD_CITATION'; taskId: string; citationNumber: string; data: AgentTaskCitation }
  | { type: 'ADD_REASONING_STEP'; taskId: string; step: ReasoningStep }
  | { type: 'COMPLETE_TASK'; taskId: string; resultText: string; citations: Record<string, AgentTaskCitation> }
  | { type: 'FAIL_TASK'; taskId: string; error: string }
  | { type: 'REMOVE_TASK'; taskId: string }
  | { type: 'CLEAR_COMPLETED' };

function tasksReducer(state: AgentTask[], action: TaskAction): AgentTask[] {
  switch (action.type) {
    case 'ADD_TASK':
      return [...state, action.task];
    case 'UPDATE_STATUS':
      return state.map(t =>
        t.id === action.taskId
          ? { ...t, status: action.status, statusMessage: action.statusMessage ?? t.statusMessage }
          : t
      );
    case 'APPEND_TOKEN':
      return state.map(t =>
        t.id === action.taskId ? { ...t, resultText: t.resultText + action.token } : t
      );
    case 'ADD_CITATION':
      return state.map(t =>
        t.id === action.taskId
          ? { ...t, citations: { ...t.citations, [action.citationNumber]: action.data } }
          : t
      );
    case 'ADD_REASONING_STEP':
      return state.map(t =>
        t.id === action.taskId
          ? { ...t, reasoningSteps: [...t.reasoningSteps, action.step] }
          : t
      );
    case 'COMPLETE_TASK':
      return state.map(t =>
        t.id === action.taskId
          ? { ...t, status: 'complete', resultText: action.resultText, citations: action.citations, completedAt: Date.now() }
          : t
      );
    case 'FAIL_TASK':
      return state.map(t =>
        t.id === action.taskId ? { ...t, status: 'error', error: action.error } : t
      );
    case 'REMOVE_TASK':
      return state.filter(t => t.id !== action.taskId);
    case 'CLEAR_COMPLETED':
      return state.filter(t => t.status !== 'complete');
    default:
      return state;
  }
}

interface AgentOrchestrationContextType {
  tasks: AgentTask[];
  activeTaskCount: number;
  dispatchTask: (params: {
    query: string;
    documentIds: string[];
    documentMeta: AgentTaskDocMeta[];
    sessionId: string;
    parentChatId: string;
    webSearch?: boolean;
  }) => string | null;
  cancelTask: (taskId: string) => void;
  retryTask: (taskId: string) => void;
  removeTask: (taskId: string) => void;
  clearCompletedTasks: () => void;
  injectResultToChat: (taskId: string) => void;
  getTasksForChat: (chatId: string) => AgentTask[];
}

const AgentOrchestrationContext = createContext<AgentOrchestrationContextType | undefined>(undefined);

export const AgentOrchestrationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tasks, dispatch] = useReducer(tasksReducer, []);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const taskParamsRef = useRef<Map<string, { query: string; documentIds: string[]; documentMeta: AgentTaskDocMeta[]; sessionId: string; parentChatId: string; webSearch?: boolean }>>(new Map());

  const activeTaskCount = tasks.filter(t => t.status === 'searching' || t.status === 'analysing').length;

  const startStream = useCallback((taskId: string, query: string, documentIds: string[], sessionId: string, abortController: AbortController, webSearch?: boolean) => {
    const accumulatedText = { current: '' };
    const accumulatedCitations: Record<string, AgentTaskCitation> = {};

    backendApi.dispatchAgentTask(
      query,
      documentIds,
      sessionId,
      {
        onStatus: (message: string) => {
          const isAnalysing = message.toLowerCase().includes('analys');
          dispatch({
            type: 'UPDATE_STATUS',
            taskId,
            status: isAnalysing ? 'analysing' : 'searching',
            statusMessage: message,
          });
        },
        onReasoningStep: (step: any) => {
          const reasoningStep: ReasoningStep = {
            step: step.step,
            action_type: step.action_type || 'analysing',
            message: step.message,
            count: step.count,
            details: step.details || {},
          };
          dispatch({ type: 'ADD_REASONING_STEP', taskId, step: reasoningStep });

          if (step.action_type === 'analysing') {
            dispatch({ type: 'UPDATE_STATUS', taskId, status: 'analysing', statusMessage: step.message });
          }
        },
        onToken: (token: string) => {
          accumulatedText.current += token;
          dispatch({ type: 'APPEND_TOKEN', taskId, token });
        },
        onCitation: (citation: { citation_number: string; data: any }) => {
          const citData: AgentTaskCitation = {
            doc_id: citation.data.doc_id || '',
            page: citation.data.page_number ?? citation.data.page ?? 0,
            bbox: citation.data.bbox || { left: 0, top: 0, width: 0, height: 0 },
            block_id: citation.data.block_id,
            original_filename: citation.data.original_filename,
            cited_text: citation.data.cited_text,
          };
          accumulatedCitations[String(citation.citation_number)] = citData;
          dispatch({ type: 'ADD_CITATION', taskId, citationNumber: String(citation.citation_number), data: citData });
        },
        onComplete: (data: { summary: string; citations: any[] }) => {
          const finalText = data.summary || accumulatedText.current;
          dispatch({ type: 'COMPLETE_TASK', taskId, resultText: finalText, citations: accumulatedCitations });
          abortControllersRef.current.delete(taskId);
        },
        onError: (error: string) => {
          dispatch({ type: 'FAIL_TASK', taskId, error });
          abortControllersRef.current.delete(taskId);
        },
      },
      abortController.signal,
      webSearch,
    ).catch((err) => {
      if (err?.name !== 'AbortError') {
        dispatch({ type: 'FAIL_TASK', taskId, error: err?.message || 'Stream failed' });
      }
      abortControllersRef.current.delete(taskId);
    });
  }, []);

  const dispatchTask = useCallback((params: {
    query: string;
    documentIds: string[];
    documentMeta: AgentTaskDocMeta[];
    sessionId: string;
    parentChatId: string;
    webSearch?: boolean;
  }): string | null => {
    if (activeTaskCount >= MAX_CONCURRENT_TASKS) {
      return null;
    }

    const taskId = `agent-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const abortController = new AbortController();
    abortControllersRef.current.set(taskId, abortController);
    taskParamsRef.current.set(taskId, params);

    const newTask: AgentTask = {
      id: taskId,
      query: params.query,
      documentIds: params.documentIds,
      documentMeta: params.documentMeta,
      status: 'searching',
      statusMessage: `Searching ${params.documentIds.length} document${params.documentIds.length !== 1 ? 's' : ''}...`,
      resultText: '',
      citations: {},
      reasoningSteps: [],
      createdAt: Date.now(),
      sessionId: params.sessionId,
      parentChatId: params.parentChatId,
    };

    dispatch({ type: 'ADD_TASK', task: newTask });
    startStream(taskId, params.query, params.documentIds, params.sessionId, abortController, params.webSearch);
    return taskId;
  }, [activeTaskCount, startStream]);

  const cancelTask = useCallback((taskId: string) => {
    const controller = abortControllersRef.current.get(taskId);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(taskId);
    }
    dispatch({ type: 'REMOVE_TASK', taskId });
    taskParamsRef.current.delete(taskId);
  }, []);

  const retryTask = useCallback((taskId: string) => {
    const params = taskParamsRef.current.get(taskId);
    if (!params) return;

    dispatch({ type: 'REMOVE_TASK', taskId });
    abortControllersRef.current.delete(taskId);
    taskParamsRef.current.delete(taskId);

    const newTaskId = `agent-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const abortController = new AbortController();
    abortControllersRef.current.set(newTaskId, abortController);
    taskParamsRef.current.set(newTaskId, params);

    const newTask: AgentTask = {
      id: newTaskId,
      query: params.query,
      documentIds: params.documentIds,
      documentMeta: params.documentMeta,
      status: 'searching',
      statusMessage: `Searching ${params.documentIds.length} document${params.documentIds.length !== 1 ? 's' : ''}...`,
      resultText: '',
      citations: {},
      reasoningSteps: [],
      createdAt: Date.now(),
      sessionId: params.sessionId,
      parentChatId: params.parentChatId,
    };

    dispatch({ type: 'ADD_TASK', task: newTask });
    startStream(newTaskId, params.query, params.documentIds, params.sessionId, abortController, params.webSearch);
  }, [startStream]);

  const removeTask = useCallback((taskId: string) => {
    const controller = abortControllersRef.current.get(taskId);
    if (controller) controller.abort();
    abortControllersRef.current.delete(taskId);
    taskParamsRef.current.delete(taskId);
    dispatch({ type: 'REMOVE_TASK', taskId });
  }, []);

  const clearCompletedTasks = useCallback(() => {
    dispatch({ type: 'CLEAR_COMPLETED' });
  }, []);

  const injectResultToChat = useCallback((taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status !== 'complete') return;

    window.dispatchEvent(new CustomEvent('agent-task-result-inject', {
      detail: {
        taskId: task.id,
        query: task.query,
        resultText: task.resultText,
        citations: task.citations,
        documentMeta: task.documentMeta,
        parentChatId: task.parentChatId,
      },
    }));

    dispatch({ type: 'REMOVE_TASK', taskId });
  }, [tasks]);

  const getTasksForChat = useCallback((chatId: string) => {
    return tasks.filter(t => t.parentChatId === chatId);
  }, [tasks]);

  // Abort all in-flight tasks on provider unmount (page navigation)
  useEffect(() => {
    return () => {
      abortControllersRef.current.forEach((controller) => { controller.abort(); });
      abortControllersRef.current.clear();
    };
  }, []);

  const value: AgentOrchestrationContextType = {
    tasks,
    activeTaskCount,
    dispatchTask,
    cancelTask,
    retryTask,
    removeTask,
    clearCompletedTasks,
    injectResultToChat,
    getTasksForChat,
  };

  return (
    <AgentOrchestrationContext.Provider value={value}>
      {children}
    </AgentOrchestrationContext.Provider>
  );
};

export const useAgentOrchestration = (): AgentOrchestrationContextType => {
  const context = useContext(AgentOrchestrationContext);
  if (context === undefined) {
    throw new Error('useAgentOrchestration must be used within an AgentOrchestrationProvider');
  }
  return context;
};

import * as React from 'react';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type LLMModel = 'gpt-4o-mini' | 'gpt-4o' | 'claude-sonnet' | 'claude-opus';

interface ModelContextValue {
  model: LLMModel;
  setModel: (model: LLMModel) => void;
  modelDisplayName: string;
}

const ModelContext = createContext<ModelContextValue | undefined>(undefined);

const MODEL_STORAGE_KEY = 'velora-llm-model';

const MODEL_DISPLAY_NAMES: Record<LLMModel, string> = {
  'gpt-4o-mini': 'GPT-4o mini',
  'gpt-4o': 'GPT-4o',
  'claude-sonnet': 'Claude Sonnet 4',
  'claude-opus': 'Claude Opus 4',
};

export function ModelProvider({ children }: { children: React.ReactNode }) {
  // Initialize from localStorage, default to 'gpt-4o-mini'
  const [model, setModelState] = useState<LLMModel>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(MODEL_STORAGE_KEY);
      if (stored && Object.keys(MODEL_DISPLAY_NAMES).includes(stored)) {
        return stored as LLMModel;
      }
    }
    return 'gpt-4o-mini';
  });

  // Persist to localStorage when model changes
  useEffect(() => {
    localStorage.setItem(MODEL_STORAGE_KEY, model);
  }, [model]);

  const setModel = useCallback((newModel: LLMModel) => {
    setModelState(newModel);
  }, []);

  const value: ModelContextValue = {
    model,
    setModel,
    modelDisplayName: MODEL_DISPLAY_NAMES[model] || model,
  };

  return (
    <ModelContext.Provider value={value}>
      {children}
    </ModelContext.Provider>
  );
}

export function useModel(): ModelContextValue {
  const context = useContext(ModelContext);
  if (context === undefined) {
    throw new Error('useModel must be used within a ModelProvider');
  }
  return context;
}

export { ModelContext };

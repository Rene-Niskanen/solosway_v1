import * as React from 'react';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type AgentMode = 'reader' | 'agent' | 'plan';

interface ModeContextValue {
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;
  isAgentMode: boolean;
  isReaderMode: boolean;
  isPlanMode: boolean;
}

const ModeContext = createContext<ModeContextValue | undefined>(undefined);

const MODE_STORAGE_KEY = 'velora-agent-mode';

export function ModeProvider({ children }: { children: React.ReactNode }) {
  // Initialize from localStorage, default to 'agent'
  const [mode, setModeState] = useState<AgentMode>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(MODE_STORAGE_KEY);
      if (stored === 'reader' || stored === 'agent' || stored === 'plan') {
        return stored;
      }
    }
    return 'agent';
  });

  // Persist to localStorage when mode changes
  useEffect(() => {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [mode]);

  const setMode = useCallback((newMode: AgentMode) => {
    setModeState(newMode);
  }, []);

  const value: ModeContextValue = {
    mode,
    setMode,
    isAgentMode: mode === 'agent',
    isReaderMode: mode === 'reader',
    isPlanMode: mode === 'plan',
  };

  return (
    <ModeContext.Provider value={value}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode(): ModeContextValue {
  const context = useContext(ModeContext);
  if (context === undefined) {
    throw new Error('useMode must be used within a ModeProvider');
  }
  return context;
}

export { ModeContext };

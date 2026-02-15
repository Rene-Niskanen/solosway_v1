"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface ChatPanelContextType {
  isOpen: boolean;
  width: number; // Current width of ChatPanel (default 320px, can be resized)
  isResizing: boolean; // Whether ChatPanel is currently being resized
  showGlow: boolean; // Gold glow animation for first chat creation
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  setWidth: (width: number) => void;
  setIsResizing: (isResizing: boolean) => void;
  triggerGlow: () => void; // Trigger the gold glow animation
}

const ChatPanelContext = createContext<ChatPanelContextType | undefined>(undefined);

export const ChatPanelProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [width, setWidthState] = useState<number>(320); // Default width: 320px (w-80)
  const [isResizing, setIsResizingState] = useState<boolean>(false);
  const [showGlow, setShowGlow] = useState<boolean>(false);

  const openPanel = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setIsOpen(false);
  }, []);

  const togglePanel = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  const setWidth = useCallback((newWidth: number) => {
    setWidthState(newWidth);
  }, []);

  const setIsResizing = useCallback((resizing: boolean) => {
    setIsResizingState(resizing);
  }, []);

  const triggerGlow = useCallback(() => {
    // Gold glow animation disabled
  }, []);

  // No keyboard shortcuts - panel can only be closed via the close button

  const value: ChatPanelContextType = {
    isOpen,
    width,
    isResizing,
    showGlow,
    openPanel,
    closePanel,
    togglePanel,
    setWidth,
    setIsResizing,
    triggerGlow,
  };

  return (
    <ChatPanelContext.Provider value={value}>
      {children}
    </ChatPanelContext.Provider>
  );
};

export const useChatPanel = (): ChatPanelContextType => {
  const context = useContext(ChatPanelContext);
  if (context === undefined) {
    throw new Error('useChatPanel must be used within a ChatPanelProvider');
  }
  return context;
};

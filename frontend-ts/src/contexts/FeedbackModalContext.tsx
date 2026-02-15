"use client";

import React, { createContext, useContext, useState, useCallback } from 'react';

interface FeedbackModalContextType {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  messageId: string | null;
  conversationSnippet: string;
  /** Open the share-feedback modal with optional message context (e.g. from response bar). */
  openFeedback: (messageId: string | null, conversationSnippet: string) => void;
}

const FeedbackModalContext = createContext<FeedbackModalContextType | undefined>(undefined);

export const FeedbackModalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpenState] = useState<boolean>(false);
  const [messageId, setMessageId] = useState<string | null>(null);
  const [conversationSnippet, setConversationSnippet] = useState<string>('');

  const setIsOpen = useCallback((open: boolean) => {
    setIsOpenState(open);
    if (!open) {
      setMessageId(null);
      setConversationSnippet('');
    }
  }, []);

  const openFeedback = useCallback((msgId: string | null, snippet: string) => {
    setMessageId(msgId);
    setConversationSnippet(snippet);
    setIsOpenState(true);
  }, []);

  const value: FeedbackModalContextType = {
    isOpen,
    setIsOpen,
    messageId,
    conversationSnippet,
    openFeedback,
  };

  return (
    <FeedbackModalContext.Provider value={value}>
      {children}
    </FeedbackModalContext.Provider>
  );
};

export function useFeedbackModal(): FeedbackModalContextType {
  const context = useContext(FeedbackModalContext);
  if (context === undefined) {
    return {
      isOpen: false,
      setIsOpen: () => {},
      messageId: null,
      conversationSnippet: '',
      openFeedback: () => {},
    };
  }
  return context;
}

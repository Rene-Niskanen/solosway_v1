"use client";

import * as React from "react";
export interface ChatHistoryEntry {
  id: string;
  title: string;
  timestamp: string;
  preview: string;
  messages: any[];
  archived?: boolean;
  status?: 'loading' | 'completed'; // Track query status
  sessionId?: string; // Backend session ID (thread_id) for isolation
  description?: string; // Secondary detail line (file changes/context)
  // Granular state for restoration
  savedState?: {
    inputValue?: string; // Current input value
    attachedFiles?: any[]; // File attachments
    propertyAttachments?: any[]; // Property attachments
    submittedQueries?: any[]; // Submitted queries list (can be SubmittedQuery[] or string[])
  };
}
interface ChatHistoryContextType {
  chatHistory: ChatHistoryEntry[];
  addChatToHistory: (chat: Omit<ChatHistoryEntry, 'id'>) => string;
  updateChatInHistory: (chatId: string, messages: any[]) => void;
  removeChatFromHistory: (chatId: string) => void;
  clearAllChats: () => void;
  updateChatTitle: (chatId: string, newTitle: string) => void;
  archiveChat: (chatId: string) => void;
  unarchiveChat: (chatId: string) => void;
  getChatById: (chatId: string) => ChatHistoryEntry | undefined;
  formatTimestamp: (date: Date) => string;
  updateChatStatus: (chatId: string, status: 'loading' | 'completed') => void;
  updateChatDescription: (chatId: string, description: string) => void;
  saveChatState: (chatId: string, state: { inputValue?: string; attachedFiles?: any[]; propertyAttachments?: any[]; submittedQueries?: any[] }) => void;
}
const ChatHistoryContext = React.createContext<ChatHistoryContextType | undefined>(undefined);

// Helper function to get chat history from localStorage
const getStoredChatHistory = (): ChatHistoryEntry[] => {
  try {
    const stored = localStorage.getItem('chatHistory');
    const chatHistory = stored ? JSON.parse(stored) : [];
    
    // Remove duplicates based on preview text and timestamp
    const uniqueChats = chatHistory.reduce((acc: ChatHistoryEntry[], current: ChatHistoryEntry) => {
      const existingIndex = acc.findIndex(chat => 
        chat.preview === current.preview && 
        Math.abs(new Date(chat.timestamp).getTime() - new Date(current.timestamp).getTime()) < 1000
      );
      
      if (existingIndex === -1) {
        acc.push(current);
      } else {
        // Keep the more recent one
        if (new Date(current.timestamp) > new Date(acc[existingIndex].timestamp)) {
          acc[existingIndex] = current;
        }
      }
      
      return acc;
    }, []);
    
    // CRITICAL: Reset any 'loading' statuses to 'completed' when loading from storage
    // Chats cannot actually be running after a page refresh/restart
    // This prevents stale 'loading' states from persisting in the UI
    const sanitizedChats = uniqueChats.map(chat => {
      if (chat.status === 'loading') {
        console.log('🔄 ChatHistoryContext: Resetting stale loading status to completed:', chat.id);
        return {
          ...chat,
          status: 'completed' as const
        };
      }
      return chat;
    });
    
    return sanitizedChats;
  } catch (error) {
    console.error('Error loading chat history from localStorage:', error);
    return [];
  }
};

// Helper function to save chat history to localStorage
const saveChatHistory = (chatHistory: ChatHistoryEntry[]) => {
  try {
    localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
  } catch (error) {
    console.error('Error saving chat history to localStorage:', error);
  }
};

// Helper function to extract location/address from query
const extractLocationFromQuery = (query: string): string => {
  if (!query) return 'New conversation';
  
  const queryLower = query.toLowerCase();
  
  // More specific location patterns that capture area details
  const locationPatterns = [
    // Bristol with specific areas
    /bristol,?\s*(?:city\s*centre|centre|center)/i,
    /bristol,?\s*(?:city|town)/i,
    /(?:city\s*centre|centre|center),?\s*bristol/i,
    
    // Specific Bristol areas with potential additional details
    /clifton,?\s*bristol/i,
    /harbourside,?\s*bristol/i,
    /redland,?\s*bristol/i,
    /montpelier,?\s*bristol/i,
    /bedminster,?\s*bristol/i,
    /stokes\s*croft,?\s*bristol/i,
    /easton,?\s*bristol/i,
    /hotwells,?\s*bristol/i,
    /cotham,?\s*bristol/i,
    
    // Just Bristol areas
    /clifton/i,
    /harbourside/i,
    /redland/i,
    /montpelier/i,
    /bedminster/i,
    /stokes\s*croft/i,
    /easton/i,
    /hotwells/i,
    /cotham/i,
    
    // Bristol alone (fallback)
    /bristol/i,
    
    // Address patterns (numbers + street names)
    /\d+\s+\w+\s+(?:road|street|avenue|close|drive|lane|way|hill|park|gardens?|village)/i,
    
    // Postcode patterns (UK)
    /bs\d+\s*\d*[a-z]{2}/i,
  ];
  
  // Check for location patterns
  for (const pattern of locationPatterns) {
    const match = query.match(pattern);
    if (match) {
      // Clean up the match (remove extra spaces, fix capitalization)
      let location = match[0].trim();
      
      // Fix capitalization for common patterns
      if (location.toLowerCase().includes('bristol, city centre')) {
        return 'Bristol, City Centre';
      } else if (location.toLowerCase().includes('city centre, bristol')) {
        return 'Bristol, City Centre';
      } else if (location.toLowerCase().includes('bristol, city')) {
        return 'Bristol, City Centre';
      }
      
      // Capitalize first letter of each word
      location = location.split(/\s+/).map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join(' ');
      
      return location;
    }
  }
  
  // If no specific location found, return truncated query
  if (query.length > 30) {
    return query.substring(0, 30) + '...';
  }
  
  return query;
};

// Helper function to generate a chat title from messages
const generateChatTitle = (messages: any[], query?: string): string => {
  if (!messages || messages.length === 0) {
    // If no messages but we have a query, extract location
    if (query && query.trim()) {
      return extractLocationFromQuery(query);
    }
    return 'New conversation';
  }
  
  // Find the first user message - check for both 'role' and 'type' properties
  const firstUserMessage = messages.find(msg => msg.role === 'user' || msg.type === 'user');
  if (firstUserMessage) {
    const content = firstUserMessage.content || firstUserMessage.text || '';
    return extractLocationFromQuery(content);
  }
  
  return 'New conversation';
};

// Helper function to format timestamp (matching reference format: "Now", "1m", "6m", etc.)
const formatTimestamp = (date: Date): string => {
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  const diffInHours = Math.floor(diffInMinutes / 60);
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInMinutes < 1) {
    return "Now";
  } else if (diffInMinutes < 60) {
    return `${diffInMinutes}m`;
  } else if (diffInHours < 24) {
    return `${diffInHours}h`;
  } else if (diffInDays < 7) {
    return `${diffInDays}d`;
  } else {
    return date.toLocaleDateString();
  }
};
export function ChatHistoryProvider({
  children
}: {
  children: React.ReactNode;
}) {
  const [chatHistory, setChatHistory] = React.useState<ChatHistoryEntry[]>(() => getStoredChatHistory());

  // CRITICAL: On mount, reset any stale 'loading' statuses and save to localStorage
  // This ensures chats loaded from storage with 'loading' status are reset to 'completed'
  // since they can't actually be running after a page refresh
  React.useEffect(() => {
    const hasStaleLoadingStatus = chatHistory.some(chat => chat.status === 'loading');
    if (hasStaleLoadingStatus) {
      console.log('🔄 ChatHistoryProvider: Resetting stale loading statuses on mount');
      const sanitizedChats = chatHistory.map(chat => {
        if (chat.status === 'loading') {
          return {
            ...chat,
            status: 'completed' as const
          };
        }
        return chat;
      });
      setChatHistory(sanitizedChats);
      // Save immediately to localStorage
      saveChatHistory(sanitizedChats);
    }
  }, []); // Only run on mount

  // Save to localStorage whenever chatHistory changes
  React.useEffect(() => {
    saveChatHistory(chatHistory);
  }, [chatHistory]);

  const addChatToHistory = React.useCallback((chat: Omit<ChatHistoryEntry, 'id'>) => {
    const chatId = `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    // Generate unique sessionId if not provided: session_${chatId}_${Date.now()}
    const sessionId = chat.sessionId || `session_${chatId}_${Date.now()}`;
    const newChat: ChatHistoryEntry = {
      ...chat,
      id: chatId,
      title: chat.title || generateChatTitle(chat.messages, chat.preview),
      sessionId: sessionId,
      status: chat.status || 'loading', // Default to 'loading' when first query is sent
    };
    setChatHistory(prev => [newChat, ...prev]);
    return newChat.id; // Return the ID for tracking
  }, []);

  const updateChatInHistory = React.useCallback((chatId: string, messages: any[]) => {
    setChatHistory(prev => prev.map(chat => 
      chat.id === chatId 
        ? { 
            ...chat,
            messages,
            title: chat.title || generateChatTitle(messages, chat.preview),
            timestamp: new Date().toISOString(),
            // Preserve sessionId and description when updating
            sessionId: chat.sessionId,
            description: chat.description
          }
        : chat
    ));
  }, []);

  const removeChatFromHistory = React.useCallback((chatId: string) => {
    setChatHistory(prev => prev.filter(chat => chat.id !== chatId));
  }, []);

  const clearAllChats = React.useCallback(() => {
    setChatHistory([]);
  }, []);

  const updateChatTitle = React.useCallback((chatId: string, newTitle: string) => {
    setChatHistory(prev => prev.map(chat => 
      chat.id === chatId 
        ? { ...chat, title: newTitle.trim() || chat.title }
        : chat
    ));
  }, []);

  const archiveChat = React.useCallback((chatId: string) => {
    setChatHistory(prev => prev.map(chat => 
      chat.id === chatId 
        ? { ...chat, archived: true }
        : chat
    ));
  }, []);

  const unarchiveChat = React.useCallback((chatId: string) => {
    setChatHistory(prev => prev.map(chat => 
      chat.id === chatId 
        ? { ...chat, archived: false }
        : chat
    ));
  }, []);

  const getChatById = React.useCallback((chatId: string) => {
    return chatHistory.find(chat => chat.id === chatId);
  }, [chatHistory]);

  const updateChatStatus = React.useCallback((chatId: string, status: 'loading' | 'completed') => {
    setChatHistory(prev => prev.map(chat => 
      chat.id === chatId 
        ? { ...chat, status }
        : chat
    ));
  }, []);

  const updateChatDescription = React.useCallback((chatId: string, description: string) => {
    setChatHistory(prev => prev.map(chat => 
      chat.id === chatId 
        ? { ...chat, description: description.trim() || chat.description }
        : chat
    ));
  }, []);

  const saveChatState = React.useCallback((chatId: string, state: { inputValue?: string; attachedFiles?: any[]; propertyAttachments?: any[]; submittedQueries?: any[] }) => {
    setChatHistory(prev => prev.map(chat => 
      chat.id === chatId 
        ? { 
            ...chat, 
            savedState: {
              ...chat.savedState,
              ...state
            }
          }
        : chat
    ));
  }, []);

  const value = React.useMemo(() => ({
    chatHistory,
    addChatToHistory,
    updateChatInHistory,
    removeChatFromHistory,
    clearAllChats,
    updateChatTitle,
    archiveChat,
    unarchiveChat,
    getChatById,
    formatTimestamp,
    updateChatStatus,
    updateChatDescription,
    saveChatState
  }), [chatHistory, addChatToHistory, updateChatInHistory, removeChatFromHistory, clearAllChats, updateChatTitle, archiveChat, unarchiveChat, getChatById, updateChatStatus, updateChatDescription, saveChatState]);

  return <ChatHistoryContext.Provider value={value}>
      {children}
    </ChatHistoryContext.Provider>;
}

export function useChatHistory() {
  const context = React.useContext(ChatHistoryContext);
  if (context === undefined) {
    throw new Error('useChatHistory must be used within a ChatHistoryProvider');
  }
  return context;
}
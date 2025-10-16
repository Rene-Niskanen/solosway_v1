"use client";

import * as React from "react";
export interface ChatHistoryEntry {
  id: string;
  title: string;
  timestamp: string;
  preview: string;
  messages: any[];
  archived?: boolean;
}
interface ChatHistoryContextType {
  chatHistory: ChatHistoryEntry[];
  addChatToHistory: (chat: Omit<ChatHistoryEntry, 'id'>) => string;
  updateChatInHistory: (chatId: string, messages: any[]) => void;
  removeChatFromHistory: (chatId: string) => void;
  updateChatTitle: (chatId: string, newTitle: string) => void;
  archiveChat: (chatId: string) => void;
  unarchiveChat: (chatId: string) => void;
  getChatById: (chatId: string) => ChatHistoryEntry | undefined;
  formatTimestamp: (date: Date) => string;
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
    
    return uniqueChats;
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

// Helper function to format timestamp
const formatTimestamp = (date: Date): string => {
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  const diffInHours = Math.floor(diffInMinutes / 60);
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInMinutes < 1) {
    return "Just now";
  } else if (diffInMinutes < 60) {
    return `${diffInMinutes} minute${diffInMinutes === 1 ? '' : 's'} ago`;
  } else if (diffInHours < 24) {
    return `${diffInHours} hour${diffInHours === 1 ? '' : 's'} ago`;
  } else if (diffInDays < 7) {
    return `${diffInDays} day${diffInDays === 1 ? '' : 's'} ago`;
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

  // Save to localStorage whenever chatHistory changes
  React.useEffect(() => {
    saveChatHistory(chatHistory);
  }, [chatHistory]);

  const addChatToHistory = React.useCallback((chat: Omit<ChatHistoryEntry, 'id'>) => {
    const newChat: ChatHistoryEntry = {
      ...chat,
      id: `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: chat.title || generateChatTitle(chat.messages, chat.preview)
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
            timestamp: new Date().toISOString()
          }
        : chat
    ));
  }, []);

  const removeChatFromHistory = React.useCallback((chatId: string) => {
    setChatHistory(prev => prev.filter(chat => chat.id !== chatId));
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

  const value = React.useMemo(() => ({
    chatHistory,
    addChatToHistory,
    updateChatInHistory,
    removeChatFromHistory,
    updateChatTitle,
    archiveChat,
    unarchiveChat,
    getChatById,
    formatTimestamp
  }), [chatHistory, addChatToHistory, updateChatInHistory, removeChatFromHistory, updateChatTitle, archiveChat, unarchiveChat, getChatById]);

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
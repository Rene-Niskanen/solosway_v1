"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, Clock, Trash2, Plus, Undo2, Sparkles, MoreVertical, Edit, Archive, Folder, ArchiveRestore, Search, Loader, CircleCheck, X } from "lucide-react";
import { useChatHistory } from "./ChatHistoryContext";
import { useChatPanel } from "../contexts/ChatPanelContext";

export interface ChatPanelProps {
  onChatSelect?: (chatId: string) => void;
  onNewChat?: () => void;
  className?: string;
  showChatHistory?: boolean;
  sidebarWidth?: number; // Width of the Sidebar to exclude from backdrop
  selectedChatId?: string | null; // Currently selected chat ID for highlighting
}

export const ChatPanel = ({
  onChatSelect,
  onNewChat,
  className,
  showChatHistory = false,
  sidebarWidth = 224, // Default to 224px (normal sidebar width)
  selectedChatId = null // Currently selected chat ID
}: ChatPanelProps) => {
  const { isOpen, width, closePanel, showGlow } = useChatPanel();
  console.log('ChatPanel rendering with isOpen:', isOpen, 'showChatHistory:', showChatHistory);
  
  const {
    chatHistory,
    removeChatFromHistory,
    updateChatTitle,
    archiveChat,
    unarchiveChat,
    formatTimestamp
  } = useChatHistory();
  
  const [hoveredChat, setHoveredChat] = React.useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = React.useState<string | null>(null);
  const [editingChatId, setEditingChatId] = React.useState<string | null>(null);
  const [editingTitle, setEditingTitle] = React.useState<string>('');
  const [showArchived, setShowArchived] = React.useState<boolean>(false);
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [pendingDeletion, setPendingDeletion] = React.useState<{
    chatId: string;
    chat: any;
    timeoutId: NodeJS.Timeout;
  } | null>(null);
  const handleChatClick = (chatId: string) => {
    if (editingChatId === chatId) return;
    onChatSelect?.(chatId);
  };

  const handleMenuToggle = (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    setOpenMenuId(openMenuId === chatId ? null : chatId);
  };

  const handleRename = (e: React.MouseEvent, chatId: string, currentTitle: string) => {
    e.stopPropagation();
    setEditingChatId(chatId);
    setEditingTitle(currentTitle);
    setOpenMenuId(null);
  };

  const handleSaveRename = (chatId: string) => {
    if (editingTitle.trim()) {
      updateChatTitle(chatId, editingTitle.trim());
    }
    setEditingChatId(null);
    setEditingTitle('');
  };

  const handleCancelRename = () => {
    setEditingChatId(null);
    setEditingTitle('');
  };

  const handleArchiveChat = (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    setOpenMenuId(null);
    
    archiveChat(chatId);
  };

  const handleUnarchiveChat = (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    setOpenMenuId(null);
    
    unarchiveChat(chatId);
  };

  // Filter chats based on archived status
  const activeChats = chatHistory.filter(chat => !chat.archived);
  const archivedChats = chatHistory.filter(chat => chat.archived);
  const baseChats = showArchived ? archivedChats : activeChats;
  
  // Filter by search query
  const displayedChats = searchQuery.trim()
    ? baseChats.filter(chat => 
        chat.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : baseChats;
  const handleDeleteChat = (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    setOpenMenuId(null);
    
    // Delete chat immediately
    // Note: Abort controller cleanup is handled in SideChatPanel when chat is deleted
    removeChatFromHistory(chatId);
  };
  
  const handleNewChat = (e?: React.MouseEvent) => {
    // Stop event propagation to prevent backdrop from closing the panel
    if (e) {
      e.stopPropagation();
    }
    console.log('Create new chat');
    onNewChat?.();
    // CRITICAL: Do NOT close the panel - keep it open so user can create multiple agents
    // Don't call closePanel or onToggle here
  };
  React.useEffect(() => {
    // Close menu when clicking outside
    const handleClickOutside = () => setOpenMenuId(null);
    if (openMenuId) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openMenuId]);

  // Panel ref for internal use
  const panelRef = React.useRef<HTMLDivElement>(null);
  
  return (
    <>
      {/* Gold glow animation styles */}
      <style>{`
        @keyframes goldClockwiseGlow {
          0% {
            box-shadow: inset 0 -2px 8px rgba(212, 175, 55, 0.8),
                        0 0 12px rgba(255, 215, 0, 0.6);
            border-color: rgba(212, 175, 55, 0.9);
          }
          12.5% {
            box-shadow: inset 2px -2px 8px rgba(212, 175, 55, 0.7),
                        3px 0 12px rgba(255, 215, 0, 0.5);
            border-color: rgba(212, 175, 55, 0.85);
          }
          25% {
            box-shadow: inset 2px 0 8px rgba(212, 175, 55, 0.7),
                        3px 2px 12px rgba(255, 215, 0, 0.5);
            border-color: rgba(212, 175, 55, 0.8);
          }
          37.5% {
            box-shadow: inset 2px 2px 8px rgba(212, 175, 55, 0.6),
                        0 3px 12px rgba(255, 215, 0, 0.4);
            border-color: rgba(212, 175, 55, 0.7);
          }
          50% {
            box-shadow: inset 0 2px 8px rgba(212, 175, 55, 0.5),
                        -3px 2px 12px rgba(255, 215, 0, 0.3);
            border-color: rgba(212, 175, 55, 0.6);
          }
          62.5% {
            box-shadow: inset -2px 2px 8px rgba(212, 175, 55, 0.4),
                        -3px 0 10px rgba(255, 215, 0, 0.2);
            border-color: rgba(212, 175, 55, 0.5);
          }
          75% {
            box-shadow: inset -2px 0 6px rgba(212, 175, 55, 0.3),
                        -2px -2px 8px rgba(255, 215, 0, 0.15);
            border-color: rgba(212, 175, 55, 0.4);
          }
          87.5% {
            box-shadow: inset -1px -1px 4px rgba(212, 175, 55, 0.15),
                        0 -2px 6px rgba(255, 215, 0, 0.1);
            border-color: rgba(226, 232, 240, 0.6);
          }
          100% {
            box-shadow: none;
            border-color: rgba(226, 232, 240, 0.6);
          }
        }
        
        .agent-sidebar-gold-glow {
          animation: goldClockwiseGlow 0.8s ease-out forwards !important;
        }
      `}</style>
      {/* No backdrop - panel can only be closed via the close button */}
      <div
        ref={panelRef}
        data-chat-panel="true"
        className={`fixed top-0 h-full flex flex-col z-[10000]${showGlow ? ' agent-sidebar-gold-glow' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          // Close any open menu when clicking on the panel (but not inside menu)
          if (openMenuId) setOpenMenuId(null);
        }}
        style={{
          background: '#F8F8F8',
          right: isOpen ? '0px' : '-1000px', // Move off-screen when closed
          width: isOpen ? `${width}px` : '320px', // Keep width when closed to prevent layout shift
          transition: 'right 0s ease-out, width 0s ease-out',
          willChange: 'right, width',
          transform: 'translateZ(0)', // Force GPU acceleration
          borderLeft: '1px solid rgba(226, 232, 240, 0.6)',
        }}
      >
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={false} // No mount animation - instant appearance
              animate={{
                opacity: 1,
                scale: 1
              }} 
              exit={{
                opacity: 0
              }} 
              transition={{
                duration: 0
              }} 
              className={`h-full w-full flex flex-col ${className || ''}`}
              style={{ backgroundColor: '#F8F8F8' }}
            >
            {/* Header */}
            <div className="px-4 pt-4 pb-2 border-b border-slate-200/40">
              {archivedChats.length > 0 && (
                <div className="flex items-center justify-end mb-3">
                  <motion.button
                    onClick={() => setShowArchived(!showArchived)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={`p-1.5 text-xs rounded-md transition-all duration-200 ${
                      showArchived 
                        ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' 
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {showArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                  </motion.button>
                </div>
              )}
              
              {/* Search Input - Full Width */}
              <div className="relative mb-3">
                <input
                  type="text"
                  placeholder="Search Agents..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-3 pr-9 py-2 text-xs border border-slate-200/60 hover:border-slate-300/80 rounded-md transition-all duration-200 focus:outline-none focus:border-slate-300 placeholder:text-[#BEBEBE]"
                  style={{ backgroundColor: '#F2F2F2', color: '#BEBEBE', opacity: 1, backdropFilter: 'none' }}
                />
                {/* Close Button - Inline with Search Input */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closePanel();
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-slate-200/50 active:bg-slate-200/70 transition-all duration-150 z-10 flex items-center justify-center"
                  title="Close Agent Sidebar"
                  type="button"
                >
                  <X className="w-4 h-4 text-[#BEBEBE] hover:text-slate-500" strokeWidth={1.5} />
                </button>
              </div>
              
              {/* New Agent Button - Full Width */}
              <motion.button 
                onClick={(e) => {
                  e.stopPropagation(); // Prevent backdrop from closing panel
                  handleNewChat(e);
                }} 
                whileHover={{ scale: 1.01 }} 
                whileTap={{ scale: 0.99 }} 
                className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-slate-300/70 hover:border-slate-400/80 rounded-md transition-all duration-200 group"
                style={{ backgroundColor: '#FCFCF9', opacity: 1, backdropFilter: 'none' }}
              >
                <Plus className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-slate-600 text-xs font-medium">
                  New Agent
                </span>
              </motion.button>
            </div>

            {/* Chat List */}
            {showChatHistory && (
              <div className="flex-1 overflow-y-auto px-2 pt-1 pb-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300/50 hover:scrollbar-thumb-slate-400/70 bg-[#FCFCFC]">
                {/* Agents Heading */}
                {displayedChats.length > 0 && (
                  <div className="px-2 pt-3 pb-1 mb-1">
                    <h2 className="text-[11px] font-medium text-gray-400">Agents</h2>
                  </div>
                )}
                <AnimatePresence mode="popLayout">
                  {displayedChats
                    .filter(chat => chat) // Filter out any null/undefined chats
                    .map((chat, idx) => {
                    // Ensure key is never empty
                    const chatKey = (chat.id && typeof chat.id === 'string' && chat.id.trim().length > 0)
                      ? chat.id
                      : `chat-item-${idx}`;
                      
                    const isEditing = editingChatId === chat.id;
                    return (
                      <motion.div 
                        key={chatKey}
                        layout 
                        initial={{
                          opacity: 0,
                          x: -20,
                          scale: 1
                        }} 
                        animate={{
                          opacity: 1,
                          x: 0,
                          scale: 1
                        }} 
                        exit={{
                          opacity: 0,
                          x: -20,
                          scale: 0.95,
                          height: 0,
                          marginBottom: 0,
                          paddingTop: 0,
                          paddingBottom: 0
                        }} 
                        transition={{
                          duration: 0.2,
                          delay: 0.02,
                          ease: [0.23, 1, 0.32, 1]
                        }} 
                        onClick={() => handleChatClick(chat.id)} 
                        className={`group relative px-2 py-2 rounded-md cursor-pointer mb-0.5 w-full ${
                          selectedChatId === chat.id 
                            ? 'bg-slate-200/60' 
                            : ''
                        }`}
                        onMouseEnter={() => setHoveredChat(chat.id)}
                        onMouseLeave={() => setHoveredChat(null)}
                      >
                        {/* Hover overlay - shown on hover when not selected */}
                        {hoveredChat === chat.id && selectedChatId !== chat.id && (
                          <div className="absolute inset-0 bg-slate-100/20 rounded-sm pointer-events-none" style={{ mixBlendMode: 'normal' }} />
                        )}
                        {isEditing ? (
                          <div className="flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              value={editingTitle}
                              onChange={(e) => setEditingTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveRename(chat.id);
                                if (e.key === 'Escape') handleCancelRename();
                              }}
                              onBlur={() => handleSaveRename(chat.id)}
                              className="flex-1 px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:border-indigo-500"
                              autoFocus
                            />
                          </div>
                        ) : (
                          <div className="flex items-center justify-between w-full gap-3">
                            <div className="flex items-center gap-2.5 flex-1 min-w-0">
                              {/* Title and Description */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2.5 text-[11px] font-medium truncate transition-colors duration-200 text-slate-700 group-hover:text-slate-900">
                                  {/* Status Icon - Inline with title */}
                                  {/* CRITICAL: Only show loading if we're CERTAIN the chat is actually running */}
                                  {/* Conservative approach: If chat has completed messages (responses), it's not loading */}
                                  <AnimatePresence mode="wait">
                                    {(() => {
                                      // Determine if chat is actually loading
                                      // Conservative check: Only show loading if status is 'loading' AND chat has no completed responses
                                      const messages = chat.messages || [];
                                      const hasResponses = messages.some((m: any) => 
                                        (m.role === 'assistant' || m.type === 'response') && 
                                        m.content && 
                                        m.content.trim().length > 0
                                      );
                                      
                                      // A chat is only "loading" if:
                                      // 1. Status is 'loading' AND
                                      // 2. Chat has no completed responses yet (either no messages or only queries)
                                      // If chat has responses, it's completed (even if status says loading - stale status)
                                      const isActuallyLoading = chat.status === 'loading' && !hasResponses;
                                      
                                      return isActuallyLoading ? (
                                        <motion.div
                                          key="loading"
                                          initial={{ opacity: 0, scale: 0.8 }}
                                          animate={{ opacity: 1, scale: 1 }}
                                          exit={{ opacity: 0, scale: 0.8 }}
                                          transition={{ duration: 0.2 }}
                                        >
                                          <Loader className="w-3 h-3 text-slate-500 animate-spin flex-shrink-0" />
                                        </motion.div>
                                      ) : (
                                        <motion.div
                                          key="completed"
                                          initial={{ opacity: 0, scale: 0.8 }}
                                          animate={{ opacity: 1, scale: 1 }}
                                          exit={{ opacity: 0, scale: 0.8 }}
                                          transition={{ duration: 0.2 }}
                                        >
                                          <CircleCheck className="w-3 h-3 text-slate-500 flex-shrink-0" />
                                        </motion.div>
                                      );
                                    })()}
                                  </AnimatePresence>
                                  <span className="truncate">{chat.title}</span>
                                </div>
                                {chat.description && (
                                  <div className="text-[9px] text-slate-500 truncate mt-0.5 ml-[18px]">
                                    {chat.description}
                                  </div>
                                )}
                              </div>
                            </div>
                            
                            {/* Timestamp and Menu - swap on hover */}
                            <div className="flex items-center flex-shrink-0 relative">
                              {/* Timestamp - visible by default, hidden on hover */}
                              <span className="text-[9px] text-slate-400 whitespace-nowrap group-hover:opacity-0 transition-opacity duration-150">
                                {formatTimestamp(new Date(chat.timestamp))}
                              </span>
                            
                              {/* Three dots - hidden by default, shown on hover (positioned over timestamp) */}
                              <div className="absolute right-0 top-1/2 -translate-y-1/2">
                                <button
                                  onClick={(e) => handleMenuToggle(e, chat.id)}
                                  className="opacity-0 group-hover:opacity-100 p-1 rounded-md transition-all duration-150 transform hover:scale-110 active:scale-95"
                                >
                                  <MoreVertical className="w-4 h-4 text-slate-400 transition-all duration-150" />
                                </button>
                                
                              {openMenuId === chat.id && (
                                <motion.div
                                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                  animate={{ opacity: 1, scale: 1, y: 0 }}
                                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                  transition={{ duration: 0.12 }}
                                  className="absolute right-[-8px] top-8 w-28 rounded-md p-1 z-[9999]"
                                  style={{ 
                                    backgroundColor: '#FFFFFF',
                                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.06)',
                                    isolation: 'isolate'
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    onClick={(e) => handleRename(e, chat.id, chat.title)}
                                    className="w-full px-2 py-1 text-left text-[11px] text-gray-800 hover:bg-[#007AFF] hover:text-white rounded transition-colors"
                                  >
                                    Rename
                                  </button>
                                  <button
                                    onClick={(e) => chat.archived ? handleUnarchiveChat(e, chat.id) : handleArchiveChat(e, chat.id)}
                                    className="w-full px-2 py-1 text-left text-[11px] text-gray-800 hover:bg-[#007AFF] hover:text-white rounded transition-colors"
                                  >
                                    {chat.archived ? 'Unarchive' : 'Archive'}
                                  </button>
                                  <div className="h-px bg-gray-200 my-1 mx-1" />
                                  <button
                                    onClick={(e) => handleDeleteChat(e, chat.id)}
                                    className="w-full px-2 py-1 text-left text-[11px] text-gray-800 hover:bg-[#007AFF] hover:text-white rounded transition-colors"
                                  >
                                    Delete
                                  </button>
                                </motion.div>
                              )}
                              </div>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}

            {/* Empty State when no chat history should be shown */}
            {!showChatHistory && (
              <div className="flex-1 flex items-center justify-center p-8">
                <motion.div 
                  initial={{
                    opacity: 0,
                    y: 20,
                    scale: 0.95
                  }} 
                  animate={{
                    opacity: 1,
                    y: 0,
                    scale: 1
                  }} 
                  transition={{
                    duration: 0.6,
                    ease: [0.23, 1, 0.32, 1]
                  }} 
                  className="text-center max-w-xs"
                >
                  <motion.div 
                    className="w-20 h-20 bg-gradient-to-br from-slate-50 to-slate-100 rounded-3xl flex items-center justify-center mx-auto mb-6 border-2 border-slate-200/40" 
                  >
                    <MessageSquare className="w-8 h-8 text-slate-500" strokeWidth={1.5} />
                  </motion.div>
                  <h3 className="text-slate-800 font-semibold text-xl mb-3 tracking-tight">
                    <span>Start a Conversation</span>
                  </h3>
                  <p className="text-slate-500 text-sm leading-relaxed font-medium">
                    <span>Search for something to begin an intelligent conversation with AI</span>
                  </p>
                </motion.div>
              </div>
            )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
};
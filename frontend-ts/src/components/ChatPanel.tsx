"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, Plus, MoreVertical, Archive, ArchiveRestore, X, Trash2, Loader2, CircleCheck, SlidersHorizontal } from "lucide-react";
import { useChatHistory } from "./ChatHistoryContext";
import { useChatPanel } from "../contexts/ChatPanelContext";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

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
    clearAllChats,
    updateChatTitle,
    archiveChat,
    unarchiveChat,
    formatTimestamp
  } = useChatHistory();
  
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
  const [showClearConfirm, setShowClearConfirm] = React.useState<boolean>(false);
  const [optionsMenuOpen, setOptionsMenuOpen] = React.useState<boolean>(false);
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
          width: isOpen ? `${width}px` : '320px',
          transition: 'right 0s ease-out, width 0s ease-out',
          willChange: 'right, width',
          transform: 'translateZ(0)', // Force GPU acceleration
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
              style={{ background: 'transparent' }}
            >
            {/* Header */}
            <div className="px-4 py-3 bg-[#F2F2EE]">
              {archivedChats.length > 0 && (
                <div className="flex items-center justify-end mb-3">
                  <motion.button
                    onClick={() => setShowArchived(!showArchived)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={`p-1.5 text-xs rounded-md transition-colors duration-75 ease-out ${
                      showArchived 
                        ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' 
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {showArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                  </motion.button>
                </div>
              )}
              
              {/* Search Input - Minimal Design */}
              <div className="relative mb-3">
                <input
                  type="text"
                  placeholder="Search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-2 pr-14 py-1.5 text-[11px] bg-transparent border-none focus:outline-none placeholder:text-[#A0A0A0]"
                  style={{ color: '#6B7280' }}
                />
                {/* Options (sliders) + Close - Inline with Search Input */}
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 z-10">
                  <Popover open={optionsMenuOpen} onOpenChange={setOptionsMenuOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1 rounded-full hover:bg-slate-200/50 active:bg-slate-200/70 transition-colors duration-75 ease-out flex items-center justify-center"
                        title="Options"
                        aria-haspopup="true"
                        aria-expanded={optionsMenuOpen}
                      >
                        <SlidersHorizontal className="w-4 h-4 text-[#A0A0A0] hover:text-slate-500" strokeWidth={1.5} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      side="bottom"
                      sideOffset={4}
                      className="min-w-[180px] w-auto rounded-lg border border-gray-200 bg-white p-2 shadow-md"
                      onOpenAutoFocus={(e) => e.preventDefault()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex flex-col gap-0.5">
                        {showChatHistory && baseChats.length > 0 ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOptionsMenuOpen(false);
                              setShowClearConfirm(true);
                            }}
                            className="flex items-center gap-2 w-full rounded-sm px-2 py-2 text-left hover:bg-[#f5f5f5] text-[12px] text-[#374151] transition-colors duration-75 ease-out"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-[#666] flex-shrink-0" strokeWidth={1.5} />
                            Clear all chats
                          </button>
                        ) : (
                          <span className="px-2 py-2 text-[12px] text-[#9CA3AF]">No chats to clear</span>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closePanel();
                    }}
                    className="p-1 rounded-full hover:bg-slate-200/50 active:bg-slate-200/70 transition-colors duration-75 ease-out flex items-center justify-center"
                    title="Close Agent Sidebar"
                    type="button"
                  >
                    <X className="w-4 h-4 text-[#A0A0A0] hover:text-slate-500" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
              
              {/* New Agent Button - Full Width */}
              <motion.button 
                onClick={(e) => {
                  e.stopPropagation(); // Prevent backdrop from closing panel
                  handleNewChat(e);
                }} 
                whileHover={{ scale: 1.01 }} 
                whileTap={{ scale: 0.99 }} 
                className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-slate-300/70 hover:border-slate-400/80 rounded-md transition-[border-color,background-color] duration-75 ease-out group"
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
              <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 pt-2 pb-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300/50 hover:scrollbar-thumb-slate-400/70 bg-[#F2F2EE]">
                {/* Agents Heading */}
                {displayedChats.length > 0 && (
                  <div className="px-0 pt-2 pb-0.5 mb-0.5">
                    <h2 className="text-[10px] font-medium text-gray-400 pl-3">Agents</h2>
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
                          opacity: 1,
                          x: 0,
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
                          duration: 0,
                          delay: 0,
                          ease: [0.23, 1, 0.32, 1]
                        }} 
                        onClick={() => handleChatClick(chat.id)} 
                        className={`group relative px-2.5 py-1.5 rounded-md cursor-pointer w-full mb-0.5 transition-[background-color] duration-75 ease-out ${
                          selectedChatId === chat.id 
                            ? 'bg-white' 
                            : openMenuId ? '' : 'hover:bg-[#E0E0DC]'
                        }`}
                      >
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
                          <div className="flex flex-col w-full relative">
                            {/* Title row */}
                            <div className="flex items-center gap-1.5 text-[12px] font-normal text-slate-800 truncate pr-5">
                              {chat.status === 'loading' && (
                                <Loader2 className="w-3 h-3 text-slate-500 animate-spin flex-shrink-0" />
                              )}
                              {chat.status === 'completed' && (
                                <CircleCheck className="w-3 h-3 text-slate-500 flex-shrink-0" aria-hidden />
                              )}
                              <span className="truncate">{chat.title}</span>
                            </div>
                            
                            {/* Timestamp below title */}
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {formatTimestamp(new Date(chat.timestamp))}
                            </div>
                            
                            {/* Three dots menu - positioned top right */}
                            <div className="absolute right-0 top-0">
                              <button
                                onClick={(e) => handleMenuToggle(e, chat.id)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded transition-[opacity,transform] duration-75 ease-out transform hover:scale-110 active:scale-95"
                              >
                                <MoreVertical className="w-3.5 h-3.5 text-slate-400 transition-colors duration-75 ease-out" />
                              </button>
                              
                              {openMenuId === chat.id && (
                                <motion.div
                                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                  animate={{ opacity: 1, scale: 1, y: 0 }}
                                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                  transition={{ duration: 0.12 }}
                                  className="absolute right-0 top-8 w-28 rounded-md p-1 z-[9999]"
                                  style={{ 
                                    backgroundColor: '#FFFFFF',
                                    isolation: 'isolate'
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    onClick={(e) => handleRename(e, chat.id, chat.title)}
                                    className="w-full px-2 py-1 text-left text-[11px] text-gray-800 hover:bg-[#007AFF] hover:text-white rounded transition-colors duration-75 ease-out"
                                  >
                                    Rename
                                  </button>
                                  <button
                                    onClick={(e) => chat.archived ? handleUnarchiveChat(e, chat.id) : handleArchiveChat(e, chat.id)}
                                    className="w-full px-2 py-1 text-left text-[11px] text-gray-800 hover:bg-[#007AFF] hover:text-white rounded transition-colors duration-75 ease-out"
                                  >
                                    {chat.archived ? 'Unarchive' : 'Archive'}
                                  </button>
                                  <div className="h-px bg-gray-200 my-1 mx-1" />
                                  <button
                                    onClick={(e) => handleDeleteChat(e, chat.id)}
                                    className="w-full px-2 py-1.5 text-center text-[11px] font-medium text-white bg-[#4285F4] hover:bg-[#3367D6] rounded transition-colors duration-75 ease-out"
                                  >
                                    Delete
                                  </button>
                                </motion.div>
                              )}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}

            {/* Clear all chats - bottom of panel when chat history is shown */}
            {showChatHistory && baseChats.length > 0 && (
              <div className="px-4 py-3 border-t border-slate-200/40 flex-shrink-0 relative bg-[#F2F2EE]">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowClearConfirm(true);
                  }}
                  className="w-full py-2 text-[11px] font-medium text-slate-700 bg-white hover:bg-[#FAFAF9] rounded-md transition-colors duration-75 ease-out flex items-center justify-center gap-1.5 border border-slate-200/80"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  Clear all chats
                </button>
                
                {/* Confirmation popup */}
                <AnimatePresence>
                  {showClearConfirm && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      transition={{ duration: 0.15 }}
                      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 w-[200px] bg-white rounded-md shadow-lg border border-slate-200/80"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="text-[11px] text-slate-800 mb-2 text-center leading-tight">
                        Delete all {baseChats.length} chat{baseChats.length !== 1 ? 's' : ''}?
                      </p>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            clearAllChats();
                            onNewChat?.();
                            setShowClearConfirm(false);
                          }}
                          className="flex-1 py-1 text-[11px] font-medium text-white bg-slate-700 hover:bg-slate-800 rounded border border-slate-600/80 transition-colors duration-75 ease-out"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowClearConfirm(false);
                          }}
                          className="flex-1 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200/60 rounded border border-slate-200/80 transition-colors duration-75 ease-out"
                        >
                          Cancel
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Empty State when no chat history should be shown */}
            {!showChatHistory && (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center max-w-xs">
                  <div className="w-20 h-20 bg-gradient-to-br from-slate-50 to-slate-100 rounded-3xl flex items-center justify-center mx-auto mb-6 border-2 border-slate-200/40">
                    <MessageSquare className="w-8 h-8 text-slate-500" strokeWidth={1.5} />
                  </div>
                  <h3 className="text-slate-800 font-semibold text-xl mb-3 tracking-tight">
                    <span>Start a Conversation</span>
                  </h3>
                  <p className="text-slate-500 text-sm leading-relaxed font-medium">
                    <span>Search for something to begin an intelligent conversation with AI</span>
                  </p>
                </div>
              </div>
            )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
};
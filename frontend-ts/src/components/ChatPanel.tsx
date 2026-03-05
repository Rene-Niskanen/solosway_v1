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
  const { isOpen, width, closePanel, setWidth, setIsResizing, isResizing } = useChatPanel();
  const closePanelRef = React.useRef(closePanel);
  closePanelRef.current = closePanel;
  console.log('ChatPanel rendering with isOpen:', isOpen, 'showChatHistory:', showChatHistory);

  // Agent sidebar resize bounds (must match ChatPanelContext setWidth clamp): smaller and only slightly bigger than default (320)
  const AGENT_SIDEBAR_MIN = 260;
  const AGENT_SIDEBAR_MAX = 400;

  const panelRef = React.useRef<HTMLDivElement>(null);
  const resizeStateRef = React.useRef<{ startX: number; startWidth: number } | null>(null);

  const handleResizeStart = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const currentWidth = Math.min(AGENT_SIDEBAR_MAX, Math.max(AGENT_SIDEBAR_MIN, width));
      resizeStateRef.current = { startX: e.clientX, startWidth: currentWidth };
      setIsResizing(true);
    },
    [width, setIsResizing]
  );

  React.useEffect(() => {
    if (!isResizing || !resizeStateRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeStateRef.current) return;
      const { startX, startWidth } = resizeStateRef.current;
      // Panel is on the right: dragging left edge right = narrower (negative deltaX => wider)
      const deltaX = e.clientX - startX;
      const newWidth = Math.min(AGENT_SIDEBAR_MAX, Math.max(AGENT_SIDEBAR_MIN, startWidth - deltaX));
      setWidth(newWidth);
    };

    const handleMouseUp = (e: MouseEvent) => {
      const startX = resizeStateRef.current?.startX;
      const moved = startX != null && Math.abs(e.clientX - startX) >= 5;
      resizeStateRef.current = null;
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (!moved) closePanelRef.current();
    };

    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, setWidth, setIsResizing]);
  
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

  // Filter chats based on archived status; hide property-scoped chats (they restore when re-opening the project)
  const activeChats = chatHistory.filter(chat => !chat.archived && !chat.id.startsWith('property-'));
  const archivedChats = chatHistory.filter(chat => chat.archived && !chat.id.startsWith('property-'));
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

  /** Combined toggle + resize rail on the left edge: click to close, drag to resize. Must match MainContent AGENT_TOGGLE_RAIL_WIDTH. */
  const AGENT_SIDEBAR_RAIL_WIDTH = 12;
  const totalSidebarWidth = width + AGENT_SIDEBAR_RAIL_WIDTH;
  
  return (
    <>
      {/* No backdrop - panel can only be closed via the close button */}
      <div
        ref={panelRef}
        data-chat-panel="true"
        className="fixed top-0 h-full flex flex-row z-[10001]"
        onClick={(e) => {
          e.stopPropagation();
          // Close any open menu when clicking on the panel (but not inside menu)
          if (openMenuId) setOpenMenuId(null);
        }}
        style={{
          background: '#FFFFFF',
          right: isOpen ? '0px' : '-1000px', // Move off-screen when closed
          width: isOpen ? `${totalSidebarWidth}px` : '332px',
          transition: 'right 0s ease-out, width 0s ease-out',
          willChange: 'right, width',
          transform: 'translateZ(0)', // Force GPU acceleration
        }}
      >
        {/* Combined toggle + resize rail: click to close, drag to resize */}
        {isOpen && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Close agent sidebar or drag to resize"
            data-view-dropdown-ignore
            onMouseDown={handleResizeStart}
            onKeyDown={(e) => e.key === 'Enter' && closePanel()}
            className="relative shrink-0 h-full flex items-center justify-center cursor-ew-resize group"
            style={{
              width: AGENT_SIDEBAR_RAIL_WIDTH,
              background: '#FFFFFF',
              borderLeft: '1px solid rgba(0,0,0,0.08)',
              pointerEvents: 'auto',
              WebkitTapHighlightColor: 'transparent',
            }}
            title="Drag to resize or click to close"
          >
            <div
              className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'rgba(0, 0, 0, 0.06)' }}
            />
          </div>
        )}
        <div
          className="h-full flex flex-col min-w-0"
          style={{ width: isOpen ? `${width}px` : '320px', minWidth: isOpen ? width : 320, flex: 1 }}
          onClick={(e) => e.stopPropagation()}
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
              className={`h-full w-full flex flex-col relative ${className || ''}`}
              style={{ background: 'transparent' }}
            >
            {/* Header – top padding matches SideChatPanel view bar (18px) so search row and New Agent align with Close/Response/X */}
            <div
              className="px-4 flex flex-col"
              style={{
                backgroundColor: '#FFFFFF',
                paddingTop: 18,
                paddingBottom: 19,
              }}
            >
              {archivedChats.length > 0 && (
                <div className="flex items-center justify-end mb-2">
                  <motion.button
                    onClick={() => setShowArchived(!showArchived)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={`p-1.5 text-xs rounded-md transition-colors duration-75 ease-out ${
                      showArchived 
                        ? 'bg-amber-500/30 text-amber-800 hover:bg-amber-500/40' 
                        : 'bg-black/8 text-[#374151] hover:bg-black/12'
                    }`}
                  >
                    {showArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                  </motion.button>
                </div>
              )}
              {/* Search Input - 32px height to align with Response button in main chat header */}
              <div className="relative flex items-center mt-1" style={{ minHeight: 32, height: 32 }}>
                <input
                  type="text"
                  placeholder="Search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-full pl-2 pr-14 py-0 text-[15px] font-normal bg-transparent border-none focus:outline-none placeholder:text-[15px] placeholder:text-[#9CA3AF] placeholder:font-normal"
                  style={{ color: '#374151', caretColor: '#374151', height: 32, minHeight: 32 }}
                />
                {/* Options (sliders) + Close - Inline with Search Input */}
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 z-10">
                  <Popover open={optionsMenuOpen} onOpenChange={setOptionsMenuOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1 rounded-full hover:bg-black/8 active:bg-black/12 transition-colors duration-75 ease-out flex items-center justify-center"
                        title="Options"
                        aria-haspopup="true"
                        aria-expanded={optionsMenuOpen}
                      >
                        <SlidersHorizontal className="w-5 h-5 text-[#6B7280] hover:text-[#374151]" strokeWidth={1.75} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      side="bottom"
                      sideOffset={4}
                      className="z-[10001] min-w-[200px] w-auto rounded-lg border border-gray-200 bg-white p-3 shadow-md"
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
                            className="flex items-center gap-1.5 w-full rounded-sm px-1.5 py-1 text-left hover:bg-[#f5f5f5] text-[12px] text-[#374151] transition-colors duration-75 ease-out"
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
                    className="rounded-full hover:bg-black/8 active:bg-black/12 transition-colors duration-75 ease-out flex items-center justify-center flex-shrink-0"
                    style={{ width: 32, height: 32, minWidth: 32, minHeight: 32 }}
                    title="Close Agent Sidebar"
                    type="button"
                  >
                    <X className="w-5 h-5 text-[#6B7280] hover:text-[#374151]" strokeWidth={1.75} />
                  </button>
                </div>
              </div>

              {/* Spacer so content below sits lower; keeps search row visually aligned with Response button */}
              <div className="h-3 shrink-0" aria-hidden />

              {/* New Agent Button - Full Width */}
              <motion.button 
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleNewChat(e);
                }} 
                whileHover={{ scale: 1.01 }} 
                whileTap={{ scale: 0.99 }} 
                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 border border-gray-300/80 hover:border-gray-400 rounded transition-[border-color,background-color] duration-75 ease-out group"
                style={{ backgroundColor: '#FFFFFF', opacity: 1, backdropFilter: 'none' }}
              >
                <Plus className="w-3 h-3 text-[#141413]" />
                <span className="text-[11px] font-medium text-[#141413]">
                  New Agent
                </span>
              </motion.button>
            </div>

            {/* Chat List - sticky with panel: flex-1 + minHeight 0 so it fills and scrolls inside the sidebar */}
            {showChatHistory && (
              <div
                className="flex-1 overflow-y-auto overflow-x-hidden px-3 pt-2 pb-3 scrollbar-thin scrollbar-track-transparent min-h-0"
                style={{ backgroundColor: '#FFFFFF', scrollbarColor: 'rgba(0,0,0,0.2) transparent' }}
              >
                {/* Agents Heading */}
                {displayedChats.length > 0 && (
                  <div className="px-0 pt-2 pb-0.5 mb-0.5">
                    <h2 className="text-[12px] font-medium pl-2" style={{ color: '#6B7280' }}>Agents</h2>
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
                            ? '' 
                            : openMenuId ? '' : 'hover:bg-black/[0.06]'
                        }`}
                        style={selectedChatId === chat.id ? { backgroundColor: '#E8E8E5' } : undefined}
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
                            <div className="flex items-center gap-1.5 text-[12px] font-normal truncate pr-5" style={{ color: '#374151' }}>
                              {chat.status === 'loading' && (
                                <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" style={{ color: '#6B7280' }} />
                              )}
                              {chat.status === 'completed' && (
                                <CircleCheck className="w-3 h-3 flex-shrink-0" style={{ color: '#6B7280' }} aria-hidden />
                              )}
                              <span
                                className="text-[12px] font-normal truncate cursor-pointer flex-1 min-w-0 hover:opacity-90"
                                style={{ color: '#374151', display: 'inline-block', padding: 0, margin: 0 }}
                                title="Click to edit chat name"
                              >
                                {chat.title || 'New chat'}
                              </span>
                            </div>
                            
                            {/* Timestamp below title */}
                            <div className="text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>
                              {formatTimestamp(new Date(chat.timestamp))}
                            </div>
                            
                            {/* Three dots menu - positioned top right */}
                            <div className="absolute right-0 top-0">
                              <button
                                onClick={(e) => handleMenuToggle(e, chat.id)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded transition-[opacity,transform] duration-75 ease-out transform hover:scale-110 active:scale-95"
                              >
                                <MoreVertical className="w-3.5 h-3.5 transition-colors duration-75 ease-out" style={{ color: '#9CA3AF' }} />
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
                                    className="w-full px-2 py-1 text-left text-[11px] text-gray-800 hover:bg-[#007AFF] hover:text-white rounded transition-colors duration-75 ease-out"
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

            {/* Clear-all confirmation overlay (shown when triggered from Options dropdown) */}
            <AnimatePresence>
              {showClearConfirm && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="absolute inset-0 z-10 flex items-center justify-center bg-black/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowClearConfirm(false);
                  }}
                >
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    transition={{ duration: 0.15 }}
                    className="px-3 py-2 w-[200px] bg-white rounded-md shadow-lg border border-slate-200/80"
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
                </motion.div>
              )}
            </AnimatePresence>

            {/* Empty State when no chat history should be shown - sticky with panel */}
            {!showChatHistory && (
              <div className="flex-1 min-h-0 flex items-center justify-center p-8" style={{ backgroundColor: '#FFFFFF' }}>
                <div className="text-center max-w-xs">
                  <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6 border-2 border-black/10" style={{ background: 'linear-gradient(to bottom right, rgba(0,0,0,0.04), rgba(0,0,0,0.02))' }}>
                    <MessageSquare className="w-8 h-8" style={{ color: '#9CA3AF' }} strokeWidth={1.5} />
                  </div>
                  <h3 className="font-semibold text-xl mb-3 tracking-tight" style={{ color: '#374151' }}>
                    <span>Start a Conversation</span>
                  </h3>
                  <p className="text-sm leading-relaxed font-medium" style={{ color: '#6B7280' }}>
                    <span>Search for something to begin an intelligent conversation with AI</span>
                  </p>
                </div>
              </div>
            )}
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </div>
    </>
  );
};
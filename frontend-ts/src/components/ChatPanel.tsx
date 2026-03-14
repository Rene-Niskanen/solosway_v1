"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, Plus, MoreVertical, Archive, X, Trash2, Loader2, MessageCircleCheck, ChevronDown, ChevronUp } from "lucide-react";
import { useChatHistory } from "./ChatHistoryContext";
import { useChatPanel } from "../contexts/ChatPanelContext";
import { useTheme } from "next-themes";
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
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light' && resolvedTheme !== undefined;
  const panelBg = isDark ? 'hsl(var(--muted))' : '#FFFFFF';
  const popoverClass = isDark ? 'border-border bg-background' : 'border-gray-200 bg-white';
  const closePanelRef = React.useRef(closePanel);
  closePanelRef.current = closePanel;
  console.log('ChatPanel rendering with isOpen:', isOpen, 'showChatHistory:', showChatHistory);

  // Agent sidebar resize bounds (must match ChatPanelContext setWidth clamp)
  const AGENT_SIDEBAR_MIN = 240;
  const AGENT_SIDEBAR_MAX = 360;

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
  const [agentsExpanded, setAgentsExpanded] = React.useState<boolean>(true);
  const [archivedExpanded, setArchivedExpanded] = React.useState<boolean>(true);
  const INITIAL_CHAT_LIMIT = 10;
  const MORE_CHUNK_SIZE = 5;
  const [agentsVisibleCount, setAgentsVisibleCount] = React.useState(INITIAL_CHAT_LIMIT);
  const [archivedVisibleCount, setArchivedVisibleCount] = React.useState(INITIAL_CHAT_LIMIT);
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

  const now = Date.now();
  const ms1d = 24 * 60 * 60 * 1000;
  const ms7d = 7 * 24 * 60 * 60 * 1000;
  const ms30d = 30 * 24 * 60 * 60 * 1000;

  type MilestoneBucket = { label: string; chats: typeof chatHistory };
  const bucketByMilestones = (chats: typeof chatHistory): MilestoneBucket[] => {
    const recent: typeof chatHistory = [];
    const prev7d: typeof chatHistory = [];
    const prev30d: typeof chatHistory = [];
    const older: typeof chatHistory = [];
    for (const c of chats) {
      const t = new Date(c.timestamp).getTime();
      const age = now - t;
      if (age < ms1d) recent.push(c);
      else if (age < ms7d) prev7d.push(c);
      else if (age < ms30d) prev30d.push(c);
      else older.push(c);
    }
    const buckets: MilestoneBucket[] = [];
    if (recent.length) buckets.push({ label: '', chats: recent });
    if (prev7d.length) buckets.push({ label: 'Previous 7 days', chats: prev7d });
    if (prev30d.length) buckets.push({ label: 'Previous 30 days', chats: prev30d });
    if (older.length) buckets.push({ label: 'Older', chats: older });
    return buckets;
  };

  const limitBuckets = (buckets: MilestoneBucket[], limit: number): MilestoneBucket[] => {
    let count = 0;
    const out: MilestoneBucket[] = [];
    for (const b of buckets) {
      if (count >= limit) break;
      const take = Math.min(b.chats.length, limit - count);
      if (take > 0) out.push({ label: b.label, chats: b.chats.slice(0, take) });
      count += take;
    }
    return out;
  };

  // Filter chats based on archived status; hide property-scoped chats (they restore when re-opening the project)
  const activeChats = chatHistory.filter(chat => !chat.archived && !chat.id.startsWith('property-'));
  const archivedChats = chatHistory.filter(chat => chat.archived && !chat.id.startsWith('property-'));
  
  // Filter by search query for each section
  const searchLower = searchQuery.trim().toLowerCase();
  const displayedAgentChats = searchLower
    ? activeChats.filter(chat => chat.title.toLowerCase().includes(searchLower))
    : activeChats;
  const displayedArchivedChats = searchLower
    ? archivedChats.filter(chat => chat.title.toLowerCase().includes(searchLower))
    : archivedChats;

  const hasMoreAgents = !searchLower && displayedAgentChats.length > INITIAL_CHAT_LIMIT;
  const hasMoreArchived = !searchLower && displayedArchivedChats.length > INITIAL_CHAT_LIMIT;

  const agentBuckets = searchLower
    ? [{ label: '', chats: displayedAgentChats }]
    : limitBuckets(
        agentsVisibleCount > INITIAL_CHAT_LIMIT ? bucketByMilestones(displayedAgentChats) : [{ label: '', chats: displayedAgentChats }],
        agentsVisibleCount
      );
  const archivedBuckets = searchLower
    ? [{ label: '', chats: displayedArchivedChats }]
    : limitBuckets(
        archivedVisibleCount > INITIAL_CHAT_LIMIT ? bucketByMilestones(displayedArchivedChats) : [{ label: '', chats: displayedArchivedChats }],
        archivedVisibleCount
      );

  const baseChats = [...activeChats, ...archivedChats];
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
          background: panelBg,
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
              background: panelBg,
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
                backgroundColor: panelBg,
                paddingTop: 18,
                paddingBottom: 19,
              }}
            >
              {/* Search Input - 32px height to align with Response button in main chat header */}
              <div className="relative flex items-center mt-1" style={{ minHeight: 32, height: 32 }}>
                <input
                  type="text"
                  placeholder="Search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`w-full h-full pl-1.5 pr-14 py-0 text-[15px] font-light bg-transparent border-none focus:outline-none placeholder:text-[15px] placeholder:font-light ${isDark ? 'placeholder:text-slate-400' : 'placeholder:text-[#9CA3AF]'}`}
                  style={{ color: isDark ? 'hsl(var(--foreground))' : '#374151', caretColor: isDark ? 'hsl(var(--foreground))' : '#374151', height: 32, minHeight: 32 }}
                />
                {/* Options (sliders) + Close - Inline with Search Input */}
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 z-10">
                  <Popover open={optionsMenuOpen} onOpenChange={(open) => { setOptionsMenuOpen(open); if (!open) setShowClearConfirm(false); }}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className={`rounded-full transition-colors duration-75 ease-out flex items-center justify-center flex-shrink-0 ${isDark ? 'hover:bg-white/10 active:bg-white/15' : 'hover:bg-black/8 active:bg-black/12'}`}
                        style={{ width: 26, height: 26, minWidth: 26, minHeight: 26 }}
                        title="Clear all chats"
                        aria-haspopup="true"
                        aria-expanded={optionsMenuOpen}
                      >
                        <Trash2 className={`w-4 h-4 ${!isDark ? 'text-[#6B7280] hover:text-[#374151]' : ''}`} style={isDark ? { color: 'rgb(220, 220, 220)' } : undefined} strokeWidth={1.25} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      side="bottom"
                      sideOffset={4}
                      className={`z-[10001] min-w-[200px] w-auto rounded-lg border p-2 shadow-md ${popoverClass}`}
                      onOpenAutoFocus={(e) => e.preventDefault()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex flex-col gap-0.5">
                        {showClearConfirm ? (
                          <>
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
                                  setOptionsMenuOpen(false);
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
                          </>
                        ) : showChatHistory && baseChats.length > 0 ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowClearConfirm(true);
                            }}
                            className="flex items-center gap-1 w-full rounded-sm px-1.5 py-0.5 text-left hover:bg-[#f5f5f5] text-[11px] text-[#374151] transition-colors duration-75 ease-out min-h-0"
                          >
                            <Trash2 className="w-4 h-4 text-[#666] flex-shrink-0" strokeWidth={1.25} />
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
                    className={`rounded-full transition-colors duration-75 ease-out flex items-center justify-center flex-shrink-0 ${isDark ? 'hover:bg-white/10 active:bg-white/15' : 'hover:bg-black/8 active:bg-black/12'}`}
                    style={{ width: 26, height: 26, minWidth: 26, minHeight: 26 }}
                    title="Close Agent Sidebar"
                    type="button"
                  >
                    <X className={`w-4 h-4 ${!isDark ? 'text-[#6B7280] hover:text-[#374151]' : ''}`} style={isDark ? { color: 'rgb(220, 220, 220)' } : undefined} strokeWidth={1.75} />
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
                className={`w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 border rounded-md transition-[border-color,background-color] duration-75 ease-out group ${isDark ? 'border-slate-500/60 hover:border-slate-400' : 'border-gray-300/80 hover:border-gray-400'}`}
                style={{ backgroundColor: panelBg, opacity: 1, backdropFilter: 'none' }}
              >
                <Plus className={`w-3.5 h-3.5 ${!isDark ? 'text-slate-500' : ''}`} style={isDark ? { color: 'rgb(220, 220, 220)' } : undefined} />
                <span className={`text-[13px] font-medium ${!isDark ? 'text-slate-500' : ''}`} style={isDark ? { color: 'rgb(220, 220, 220)' } : undefined}>
                  New Agent
                </span>
              </motion.button>
            </div>

            {/* Chat List - sticky with panel: flex-1 + minHeight 0 so it fills and scrolls inside the sidebar */}
            {showChatHistory && (
              <div
                className="flex-1 overflow-y-auto overflow-x-hidden pl-0 pr-1.5 pt-2 pb-3 scrollbar-thin scrollbar-track-transparent min-h-0"
                style={{ backgroundColor: panelBg, scrollbarColor: 'rgba(0,0,0,0.2) transparent' }}
              >
                {/* Agents section - collapsible */}
                <div className="px-0 pt-2 pb-0">
                  <button
                    type="button"
                    onClick={() => setAgentsExpanded(!agentsExpanded)}
                    className="group flex items-center gap-1 w-full py-1 pl-3 pr-2 rounded-md text-left"
                  >
                    <h2 className="text-[12px] font-medium" style={{ color: '#ADADAD' }}>Agents</h2>
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-75 flex-shrink-0" style={{ color: '#ADADAD' }}>
                      {agentsExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" strokeWidth={2} />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" strokeWidth={2} />
                      )}
                    </span>
                  </button>
                  {agentsExpanded && (
                    <div className="mt-0.5">
                      <AnimatePresence mode="popLayout">
                        {agentBuckets.map((bucket, bucketIdx) => (
                          <React.Fragment key={bucket.label || `agents-bucket-${bucketIdx}`}>
                            {bucket.label ? (
                              <div className="py-1.5 pl-2.5 mt-1 first:mt-0 text-[11px] font-medium" style={{ color: '#9CA3AF' }}>
                                {bucket.label}
                              </div>
                            ) : null}
                            {bucket.chats.filter(Boolean).map((chat, idx) => {
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
                        className={`group relative px-0.5 py-2 rounded cursor-pointer w-full mb-0.5 transition-[background-color] duration-75 ease-out ${
                          selectedChatId === chat.id 
                            ? '' 
                            : openMenuId ? '' : (isDark ? 'hover:bg-white/5' : 'hover:bg-[#F5F5F5]')
                        }`}
                        style={selectedChatId === chat.id ? { backgroundColor: isDark ? 'hsl(var(--muted))' : '#EBEBEB' } : undefined}
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
                            {/* Title row with timestamp on right */}
                            <div className="flex items-center gap-1.5 pl-2.5 text-[12px] font-normal truncate pr-5" style={isDark ? { color: 'rgb(220, 220, 220)' } : { color: selectedChatId === chat.id ? '#374151' : '#767676' }}>
                              {chat.status === 'loading' && (
                                <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" style={isDark ? { color: 'rgb(220, 220, 220)' } : { color: selectedChatId === chat.id ? '#6B7280' : '#767676' }} />
                              )}
                              {chat.status === 'completed' && (
                                <MessageCircleCheck className="w-3 h-3 flex-shrink-0" style={isDark ? { color: 'rgb(220, 220, 220)' } : { color: selectedChatId === chat.id ? '#6B7280' : '#767676' }} aria-hidden />
                              )}
                              <span
                                className="text-[12px] font-normal truncate cursor-pointer flex-1 min-w-0 hover:opacity-90"
                                style={isDark ? { color: 'rgb(220, 220, 220)', display: 'inline-block', padding: 0, margin: 0 } : { color: selectedChatId === chat.id ? '#374151' : '#767676', display: 'inline-block', padding: 0, margin: 0 }}
                                title="Click to edit chat name"
                              >
                                {chat.title || 'New chat'}
                              </span>
                              <span className="text-[10px] flex-shrink-0 opacity-100 group-hover:opacity-0 transition-opacity duration-75" style={isDark ? { color: 'rgb(220, 220, 220)' } : { color: selectedChatId === chat.id ? '#9CA3AF' : '#767676' }}>
                                {formatTimestamp(new Date(chat.timestamp))}
                              </span>
                            </div>
                            
                            {/* Three dots menu - positioned top right */}
                            <div className="absolute right-0 top-0">
                              <button
                                onClick={(e) => handleMenuToggle(e, chat.id)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded transition-[opacity,transform] duration-75 ease-out transform hover:scale-110 active:scale-95"
                              >
                                <MoreVertical className="w-3.5 h-3.5 transition-colors duration-75 ease-out" style={isDark ? { color: 'rgb(220, 220, 220)' } : { color: selectedChatId === chat.id ? '#9CA3AF' : '#767676' }} />
                              </button>
                              
                              {openMenuId === chat.id && (
                                <motion.div
                                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                  animate={{ opacity: 1, scale: 1, y: 0 }}
                                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                  transition={{ duration: 0.12 }}
                                  className="absolute right-0 top-8 w-28 rounded-lg p-1 z-[9999] border border-gray-200 shadow-lg"
                                  style={{
                                    backgroundColor: '#FFFFFF',
                                    isolation: 'isolate'
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    onClick={(e) => handleRename(e, chat.id, chat.title)}
                                    className="w-full px-2 py-1 text-left text-[11px] text-gray-800 hover:bg-gray-100 rounded transition-colors duration-75 ease-out"
                                  >
                                    Rename
                                  </button>
                                  <button
                                    onClick={(e) => chat.archived ? handleUnarchiveChat(e, chat.id) : handleArchiveChat(e, chat.id)}
                                    className="w-full px-2 py-1 text-left text-[11px] text-gray-800 hover:bg-gray-100 rounded transition-colors duration-75 ease-out"
                                  >
                                    {chat.archived ? 'Unarchive' : 'Archive'}
                                  </button>
                                  <div className="h-px bg-gray-200 my-1 mx-1" />
                                  <button
                                    onClick={(e) => handleDeleteChat(e, chat.id)}
                                    className="w-full px-2 py-1 text-left text-[11px] text-red-600 hover:bg-red-50 rounded transition-colors duration-75 ease-out"
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
                          </React.Fragment>
                        ))}
                      </AnimatePresence>
                      {hasMoreAgents && (
                        <button
                          type="button"
                          onClick={() =>
                            agentsVisibleCount >= displayedAgentChats.length
                              ? setAgentsVisibleCount(INITIAL_CHAT_LIMIT)
                              : setAgentsVisibleCount((prev) => Math.min(prev + MORE_CHUNK_SIZE, displayedAgentChats.length))
                          }
                          className="flex items-center gap-1 py-1.5 pl-2.5 text-[12px] rounded-md w-full text-left hover:opacity-80 transition-opacity"
                          style={{ color: '#9CA3AF' }}
                        >
                          <span>⋯</span>
                          <span>{agentsVisibleCount >= displayedAgentChats.length ? 'Recent only' : 'More'}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Archived section - collapsible (always visible below Agents) */}
                <div className="px-0 pt-3 pb-0">
                    <button
                      type="button"
                      onClick={() => setArchivedExpanded(!archivedExpanded)}
                      className="group flex items-center gap-1 w-full py-1 pl-3 pr-2 rounded-md text-left"
                    >
                      <h2 className="text-[12px] font-medium" style={{ color: '#ADADAD' }}>Archived</h2>
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-75 flex-shrink-0" style={{ color: '#ADADAD' }}>
                        {archivedExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" strokeWidth={2} />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" strokeWidth={2} />
                        )}
                      </span>
                    </button>
                    {archivedExpanded && (
                      <div className="mt-0.5">
                        <AnimatePresence mode="popLayout">
                          {archivedBuckets.map((bucket, bucketIdx) => (
                            <React.Fragment key={bucket.label || `archived-bucket-${bucketIdx}`}>
                              {bucket.label ? (
                                <div className="py-1.5 pl-2.5 mt-1 first:mt-0 text-[11px] font-medium" style={{ color: '#9CA3AF' }}>
                                  {bucket.label}
                                </div>
                              ) : null}
                              {bucket.chats.filter(Boolean).map((chat, idx) => {
                    const chatKey = (chat.id && typeof chat.id === 'string' && chat.id.trim().length > 0)
                      ? chat.id
                      : `chat-item-archived-${idx}`;
                    const isEditing = editingChatId === chat.id;
                    return (
                      <motion.div
                        key={chatKey}
                        layout
                        initial={{ opacity: 1, x: 0, scale: 1 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: -20, scale: 0.95, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
                        transition={{ duration: 0, delay: 0, ease: [0.23, 1, 0.32, 1] }}
                        onClick={() => handleChatClick(chat.id)}
                        className={`group relative px-0.5 py-2 rounded cursor-pointer w-full mb-0.5 transition-[background-color] duration-75 ease-out ${
                          selectedChatId === chat.id ? '' : openMenuId ? '' : (isDark ? 'hover:bg-white/5' : 'hover:bg-[#F5F5F5]')
                        }`}
                        style={selectedChatId === chat.id ? { backgroundColor: isDark ? 'hsl(var(--muted))' : '#EBEBEB' } : undefined}
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
                            <div className="flex items-center gap-1.5 pl-2.5 text-[12px] font-normal truncate pr-5" style={isDark ? { color: 'rgb(220, 220, 220)' } : { color: selectedChatId === chat.id ? '#374151' : '#767676' }}>
                              <Archive className="w-3 h-3 flex-shrink-0" style={isDark ? { color: 'rgb(156, 163, 175)' } : { color: selectedChatId === chat.id ? '#9CA3AF' : '#767676' }} />
                              <span
                                className="text-[12px] font-normal truncate cursor-pointer flex-1 min-w-0 hover:opacity-90"
                                style={isDark ? { color: 'rgb(220, 220, 220)', display: 'inline-block', padding: 0, margin: 0 } : { color: selectedChatId === chat.id ? '#374151' : '#767676', display: 'inline-block', padding: 0, margin: 0 }}
                                title="Click to edit chat name"
                              >
                                {chat.title || 'New chat'}
                              </span>
                              <span className="text-[10px] flex-shrink-0 opacity-100 group-hover:opacity-0 transition-opacity duration-75" style={isDark ? { color: 'rgb(220, 220, 220)' } : { color: selectedChatId === chat.id ? '#9CA3AF' : '#767676' }}>
                                {formatTimestamp(new Date(chat.timestamp))}
                              </span>
                            </div>
                            <div className="absolute right-0 top-0">
                              <button
                                onClick={(e) => handleMenuToggle(e, chat.id)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded transition-[opacity,transform] duration-75 ease-out transform hover:scale-110 active:scale-95"
                              >
                                <MoreVertical className="w-3.5 h-3.5 transition-colors duration-75 ease-out" style={isDark ? { color: 'rgb(220, 220, 220)' } : { color: selectedChatId === chat.id ? '#9CA3AF' : '#767676' }} />
                              </button>
                              {openMenuId === chat.id && (
                                <motion.div
                                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                  animate={{ opacity: 1, scale: 1, y: 0 }}
                                  exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                  transition={{ duration: 0.12 }}
                                  className="absolute right-0 top-8 w-28 rounded-lg p-1 z-[9999] border border-gray-200 shadow-lg"
                                  style={{ backgroundColor: '#FFFFFF', isolation: 'isolate' }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button onClick={(e) => handleRename(e, chat.id, chat.title)} className="w-full px-2 py-1 text-left text-[11px] text-gray-800 hover:bg-gray-100 rounded transition-colors duration-75 ease-out">Rename</button>
                                  <button onClick={(e) => handleUnarchiveChat(e, chat.id)} className="w-full px-2 py-1 text-left text-[11px] text-gray-800 hover:bg-gray-100 rounded transition-colors duration-75 ease-out">Unarchive</button>
                                  <div className="h-px bg-gray-200 my-1 mx-1" />
                                  <button onClick={(e) => handleDeleteChat(e, chat.id)} className="w-full px-2 py-1 text-left text-[11px] text-red-600 hover:bg-red-50 rounded transition-colors duration-75 ease-out">Delete</button>
                                </motion.div>
                              )}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                              })}
                            </React.Fragment>
                          ))}
                        </AnimatePresence>
                        {hasMoreArchived && (
                          <button
                            type="button"
                            onClick={() =>
                              archivedVisibleCount >= displayedArchivedChats.length
                                ? setArchivedVisibleCount(INITIAL_CHAT_LIMIT)
                                : setArchivedVisibleCount((prev) => Math.min(prev + MORE_CHUNK_SIZE, displayedArchivedChats.length))
                            }
                            className="flex items-center gap-1 py-1.5 pl-2.5 text-[12px] rounded-md w-full text-left hover:opacity-80 transition-opacity"
                            style={{ color: '#9CA3AF' }}
                          >
                            <span>⋯</span>
                            <span>{archivedVisibleCount >= displayedArchivedChats.length ? 'Recent only' : 'More'}</span>
                          </button>
                        )}
                      </div>
                    )}
                </div>
              </div>
            )}

            {/* Empty State when no chat history should be shown - sticky with panel */}
            {!showChatHistory && (
              <div className="flex-1 min-h-0 flex items-center justify-center p-8" style={{ backgroundColor: panelBg }}>
                <div className="text-center max-w-xs">
                  <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6 border-2 ${isDark ? 'border-white/10' : 'border-black/10'}`} style={isDark ? { background: 'linear-gradient(to bottom right, rgba(255,255,255,0.06), rgba(255,255,255,0.02))' } : { background: 'linear-gradient(to bottom right, rgba(0,0,0,0.04), rgba(0,0,0,0.02))' }}>
                    <MessageSquare className="w-8 h-8" style={isDark ? { color: 'rgb(220, 220, 220)' } : { color: '#9CA3AF' }} strokeWidth={1.5} />
                  </div>
                  <h3 className="font-semibold text-xl mb-3 tracking-tight" style={isDark ? { color: 'rgb(220, 220, 220)' } : { color: '#374151' }}>
                    <span>Start a Conversation</span>
                  </h3>
                  <p className="text-sm leading-relaxed font-medium" style={isDark ? { color: 'rgb(220, 220, 220)' } : { color: '#6B7280' }}>
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
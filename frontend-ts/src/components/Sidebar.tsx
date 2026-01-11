"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { BarChart3, Home, MessageSquareDot, LayoutDashboard, List, ListEnd, TextAlignJustify, Plus, MoreVertical, Edit, Archive, Trash2, ArchiveRestore, FolderOpen, DraftingCompass } from "lucide-react";
import { ProfileDropdown } from "./ProfileDropdown";
import { useChatHistory } from "./ChatHistoryContext";
import { useFilingSidebar } from "../contexts/FilingSidebarContext";

const sidebarItems = [{
  icon: List,
  id: 'list',
  label: 'List'
}, {
  icon: Home,
  id: 'home',
  label: 'Dashboard'
}, {
  icon: BarChart3,
  id: 'analytics',
  label: 'Analytics'
}, {
  icon: FolderOpen,
  id: 'database',
  label: 'Files'
}] as any[];

export interface SidebarProps {
  className?: string;
  onItemClick?: (itemId: string) => void;
  onChatToggle?: () => void;
  isChatPanelOpen?: boolean;
  activeItem?: string;
  isCollapsed?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  onExpand?: () => void;
  onNavigate?: (view: string) => void;
  onSignOut?: () => void;
  onChatSelect?: (chatId: string) => void;
  onNewChat?: () => void;
  isMapVisible?: boolean; // Whether map view is currently visible
}

export const Sidebar = ({
  className,
  onItemClick,
  onChatToggle,
  isChatPanelOpen = false,
  activeItem = 'home',
  isCollapsed = false,
  isExpanded = false,
  onToggle,
  onExpand,
  onNavigate,
  onSignOut,
  onChatSelect,
  onNewChat,
  isMapVisible = false
}: SidebarProps) => {
  const [mousePosition, setMousePosition] = React.useState({ x: 0, y: 0 });
  const [showToggleButton, setShowToggleButton] = React.useState(false);
  const [isTopIconHovered, setIsTopIconHovered] = React.useState(false);
  
  // Chat history state
  const {
    chatHistory,
    removeChatFromHistory,
    updateChatTitle,
    archiveChat,
    unarchiveChat
  } = useChatHistory();
  
  const [hoveredChat, setHoveredChat] = React.useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = React.useState<string | null>(null);
  const [editingChatId, setEditingChatId] = React.useState<string | null>(null);
  const [editingTitle, setEditingTitle] = React.useState<string>('');
  const [showArchived, setShowArchived] = React.useState<boolean>(false);
  
  // Filing sidebar integration
  const { toggleSidebar: toggleFilingSidebar, isOpen: isFilingSidebarOpen } = useFilingSidebar();

  // Close menu when clicking outside
  React.useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null);
    if (openMenuId) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openMenuId]);
  
  // Mouse proximity detection
  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
      
      // Calculate distance from left edge (where toggle button is)
      const distanceFromLeft = e.clientX;
      const distanceFromCenter = Math.abs(e.clientY - window.innerHeight / 2);
      
      // Show button if mouse is within 100px of left edge and reasonable vertical range
      const shouldShow = distanceFromLeft < 100 && distanceFromCenter < 200;
      setShowToggleButton(shouldShow);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // NOTE: We'll render a full-height thin rail as the toggle so users can click anywhere on the side

  const handleItemClick = (itemId: string) => {
    onItemClick?.(itemId);
  };

  // Chat history handlers
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

  const handleDeleteChat = (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    setOpenMenuId(null);
    removeChatFromHistory(chatId);
  };

  // Filter chats based on archived status
  const activeChats = chatHistory.filter(chat => !chat.archived);
  const archivedChats = chatHistory.filter(chat => chat.archived);
  const displayedChats = showArchived ? archivedChats : activeChats;
  
  // Determine if chat history should be shown
  const showChatHistoryInSidebar = isExpanded && isChatPanelOpen;

  // Calculate sidebar width based on state
  const getSidebarWidth = () => {
    if (isCollapsed) return 'w-2';
    if (isExpanded) return 'w-80'; // 320px (matches ChatPanel width)
    return 'w-10 lg:w-14';
  };

  // Calculate sidebar background color
  const getSidebarBackground = () => {
    if (isCollapsed) return 'rgba(254, 253, 252, 0)'; // Almost white with transparency when collapsed
    return 'rgba(254, 253, 252, 1)'; // #FEFDFC - very light, almost white
  };

  return <>
    <div 
      className={`${getSidebarWidth()} flex flex-col ${isExpanded ? 'items-stretch' : 'items-center'} py-6 fixed left-0 top-0 h-full ${className?.includes('z-[150]') ? 'z-[150]' : 'z-[300]'} ${className || ''}`} 
      style={{ 
        background: getSidebarBackground(),
        backgroundColor: getSidebarBackground(),
        transition: 'width 0.2s ease-out, background-color 0.2s ease-out'
      }}
    >
      {!isCollapsed && (
        <>
      {/* Top Section: Chat History and Close List buttons (when expanded) */}
      <div className={isExpanded ? 'px-5 mb-6' : 'mb-6'}>
        {isExpanded ? (
          <div className="flex items-center gap-2">
      {/* Chat Toggle Button */}
            <button 
              onMouseEnter={() => setIsTopIconHovered(true)}
              onMouseLeave={() => setIsTopIconHovered(false)}
              onClick={onChatToggle} 
              className={`flex-1 px-4 h-11 lg:h-13 flex items-center gap-2 rounded-lg group cursor-pointer transition-colors duration-150 ${isChatPanelOpen ? 'bg-white border border-gray-200 shadow-sm' : 'hover:bg-gray-100'}`}
              aria-label="Toggle Chat History"
            >
              <div className="flex-shrink-0">
                {!isTopIconHovered ? (
                  <img
                    src="/velora-dash-logo.png"
                    alt="VELORA"
                    className="w-7 h-7 lg:w-8 lg:h-8 object-contain drop-shadow-sm flex-shrink-0 opacity-45 transition-opacity duration-150"
                  />
                ) : (
                  <MessageSquareDot className="w-4 h-4 lg:w-5 lg:h-5 drop-shadow-sm flex-shrink-0 -translate-y-[5px]" strokeWidth={1.8} style={{ color: isChatPanelOpen ? '#22c55e' : '#8B8B8B' }} />
                )}
              </div>
              <span className={`text-xs font-medium ${isChatPanelOpen ? 'text-gray-900' : 'text-gray-700'}`}>
                Chat History
              </span>
            </button>
            
            {/* Close List Button - Icon only */}
            <button 
              onClick={() => {
                // Close expanded sidebar
                onExpand?.();
                // If chat history is open, also close it
                if (isChatPanelOpen) {
                  onChatToggle?.();
                }
              }}
              className="w-11 h-11 lg:w-13 lg:h-13 flex items-center justify-center rounded-lg group cursor-pointer transition-colors duration-150 hover:bg-gray-100"
              aria-label="Close List"
            >
              <ListEnd className="w-4 h-4 lg:w-5 lg:h-5 drop-shadow-sm flex-shrink-0 -translate-y-[3px]" strokeWidth={1.8} style={{ color: '#8B8B8B' }} />
            </button>
          </div>
        ) : (
          /* Chat Toggle Button (collapsed/normal mode) */
          <button 
        onMouseEnter={() => setIsTopIconHovered(true)}
        onMouseLeave={() => setIsTopIconHovered(false)}
        onClick={onChatToggle} 
            className="w-11 h-11 lg:w-13 lg:h-13 flex items-center justify-center relative group cursor-pointer transition-colors duration-150"
        aria-label="Toggle Chat History"
      >
            <div className="absolute inset-0 flex items-center justify-center">
          {!isTopIconHovered ? (
                <img
              src="/velora-dash-logo.png"
              alt="VELORA"
                  className="w-5 h-5 lg:w-6 lg:h-6 object-contain drop-shadow-sm flex-shrink-0 opacity-45 transition-opacity duration-150"
            />
          ) : (
                <MessageSquareDot className="w-4 h-4 lg:w-5 lg:h-5 drop-shadow-sm flex-shrink-0 -translate-y-[5px]" strokeWidth={1.8} style={{ color: isChatPanelOpen ? '#22c55e' : '#8B8B8B' }} />
              )}
            </div>
          </button>
        )}
      </div>

      {/* Chat History Section - Only shown when expanded and chat panel is open */}
      {showChatHistoryInSidebar && (
        <div className="flex flex-col flex-1 min-h-0 max-h-[calc(100vh-400px)] px-5 mb-4">
          {/* Chat History Header */}
          <div className="flex items-center justify-between mb-2">
            <motion.button 
              onClick={onNewChat} 
              className="flex items-center space-x-1.5 px-2.5 py-1.5 border border-slate-200/60 hover:border-slate-300/80 bg-white/70 hover:bg-slate-50/80 rounded-md transition-all duration-200 group"
            >
              <Plus className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-700" strokeWidth={1.5} />
              <span className="text-slate-700 group-hover:text-slate-800 font-medium text-xs">
                New chat
              </span>
            </motion.button>
            
            {archivedChats.length > 0 && (
              <motion.button
                onClick={() => setShowArchived(!showArchived)}
                className={`p-1.5 text-xs rounded-md transition-all duration-200 ${
                  showArchived 
                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' 
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {showArchived ? <ArchiveRestore className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
              </motion.button>
            )}
          </div>

          {/* Chat History List - Constrained height */}
          <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300/50 hover:scrollbar-thumb-slate-400/70">
            {displayedChats.length === 0 ? (
              <div className="flex items-center justify-center h-full py-8">
                <p className="text-slate-400 text-xs text-center">
                  {showArchived ? 'No archived conversations' : 'No conversations yet'}
                </p>
              </div>
            ) : (
              <>
                {displayedChats.map((chat) => {
                const isEditing = editingChatId === chat.id;
                return (
                  <div 
                    key={`chat-${chat.id}`}
                    onClick={() => handleChatClick(chat.id)} 
                    onMouseEnter={() => setHoveredChat(chat.id)}
                    onMouseLeave={() => setHoveredChat(null)}
                    className="group relative px-3 py-2 rounded-md transition-all duration-200 cursor-pointer mb-0.5 hover:bg-blue-50/30"
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
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-normal truncate pr-2 transition-colors duration-200 text-slate-600 group-hover:text-slate-800 group-hover:font-medium">
                          {chat.title}
                        </span>
                        
                        <div className="relative">
                          <button
                            onClick={(e) => handleMenuToggle(e, chat.id)}
                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md transition-all duration-50 transform hover:scale-125 active:scale-95"
                          >
                            <MoreVertical className="w-3.5 h-3.5 text-slate-400 transition-all duration-50" />
                          </button>
                          
                          {openMenuId === chat.id && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.9, y: -12 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.9, y: -12 }}
                              transition={{ duration: 0.08, ease: [0.16, 1, 0.3, 1] }}
                              className="absolute right-[-8px] top-10 w-48 bg-white/95 backdrop-blur-xl rounded-xl shadow-2xl border border-slate-200/60 py-2 z-50"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={(e) => handleRename(e, chat.id, chat.title)}
                                className="w-full flex items-center px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors duration-[25ms] group/item"
                              >
                                <Edit className="w-3.5 h-3.5 mr-2.5 text-slate-500 group-hover/item:text-slate-700 transition-colors duration-[25ms]" />
                                <span className="font-medium">Rename</span>
                              </button>
                              <button
                                onClick={(e) => chat.archived ? handleUnarchiveChat(e, chat.id) : handleArchiveChat(e, chat.id)}
                                className="w-full flex items-center px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors duration-[25ms] group/item"
                              >
                                {chat.archived ? (
                                  <ArchiveRestore className="w-3.5 h-3.5 mr-2.5 text-slate-500 group-hover/item:text-slate-700 transition-colors duration-[25ms]" />
                                ) : (
                                  <Archive className="w-3.5 h-3.5 mr-2.5 text-slate-500 group-hover/item:text-slate-700 transition-colors duration-[25ms]" />
                                )}
                                <span className="font-medium">
                                  {chat.archived ? 'Unarchive' : 'Archive'}
                                </span>
                              </button>
                              <div className="h-px bg-slate-200 mx-2 my-1" />
                              <button
                                onClick={(e) => handleDeleteChat(e, chat.id)}
                                className="w-full flex items-center px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition-colors duration-[25ms] group/item"
                              >
                                <Trash2 className="w-3.5 h-3.5 mr-2.5 text-red-500 group-hover/item:text-red-600 transition-colors duration-[25ms]" />
                                <span className="font-medium">Delete</span>
                              </button>
            </motion.div>
          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              </>
            )}
          </div>

          {/* Chat History Footer */}
          <div className="pt-2 border-t border-slate-200/60 mt-2">
            <p className="text-slate-400 text-xs text-center font-medium">
              {showArchived 
                ? `${archivedChats.length} archived conversations` 
                : `${activeChats.length} active conversations`
              }
              {!showArchived && archivedChats.length > 0 && ` • ${archivedChats.length} archived`}
            </p>
          </div>
        </div>
      )}

      {/* Navigation Items - Shown in middle when chat history is NOT visible, or at bottom when it is */}
      <div className={`flex flex-col ${isExpanded ? 'space-y-1' : 'space-y-2'} ${showChatHistoryInSidebar ? 'mt-auto' : 'flex-1'} ${isExpanded ? 'items-stretch px-5' : 'items-center'}`}>
        {sidebarItems.filter(item => !(item.id === 'list' && isExpanded)).map((item, index) => {
        // Dashboard icon is active only when on search view (not map view)
        // Database icon is active when FilingSidebar is open
        const isActive = item.id === 'home' 
          ? (activeItem === 'search' && !isMapVisible)
          : item.id === 'database'
          ? isFilingSidebarOpen
          : activeItem === item.id;
        // Always use LayoutDashboard for home icon
        // Use ListEnd icon when expanded and item is 'list', TextAlignJustify when not expanded, otherwise use the item's icon
        const Icon = item.id === 'home' 
          ? LayoutDashboard 
          : (item.id === 'list' && isExpanded) 
            ? ListEnd 
            : (item.id === 'list' && !isExpanded)
              ? TextAlignJustify
              : item.icon;
        
        // Special handling for List icon - it should only expand sidebar, not navigate
        // Special handling for database icon - it should open FilingSidebar, not navigate
        const handleListClick = () => {
          if (item.id === 'list') {
            // Only toggle expansion, don't navigate
            onExpand?.();
          } else if (item.id === 'database') {
            // Toggle FilingSidebar instead of navigating
            toggleFilingSidebar();
          } else if (item.id === 'home') {
            handleItemClick('home');
          } else {
            handleItemClick(item.id);
          }
        };

        // Label for list item changes when expanded
        const displayLabel = (item.id === 'list' && isExpanded) ? 'Close List' : item.label;

        // Use DraftingCompass for analytics icon
        const AnalyticsIcon = item.id === 'analytics' ? DraftingCompass : Icon;

        return <button 
          key={item.id} 
          onClick={handleListClick}
          className={`${isExpanded ? 'w-full px-4 h-11 lg:h-13 flex items-center gap-2 rounded-lg' : 'w-11 h-11 lg:w-13 lg:h-13 flex items-center justify-center'} group transition-colors duration-150 ${isActive && isExpanded ? 'bg-white border border-gray-200 shadow-sm' : isExpanded ? 'hover:bg-gray-100' : ''}`}
          aria-label={displayLabel} 
        >
              {/* Icon */}
          <AnalyticsIcon 
            className={`w-4 h-4 lg:w-5 lg:h-5 drop-shadow-sm flex-shrink-0 -translate-y-[3px]`} 
            strokeWidth={1.8} 
            style={{ color: isActive ? '#22c55e' : '#8B8B8B' }} 
          />
          {/* Label - only show when expanded */}
          {isExpanded && (
            <span className={`text-xs font-medium ${isActive ? 'text-gray-900' : 'text-gray-700'}`}>
              {displayLabel}
            </span>
          )}
        </button>;
      })}
      
      </div>

      {/* Profile Icon - Bottom of Sidebar */}
      <div className={`mt-auto mb-6 ${isExpanded ? 'w-full px-5' : ''}`}>
        <ProfileDropdown 
          onNavigate={onNavigate}
          onSignOut={onSignOut}
        />
      </div>
        </>
      )}
    </div>

    {/* Sidebar Toggle Rail - full height thin clickable area */}
    {/* IMPORTANT: This button should ONLY toggle sidebar, NEVER navigate */}
    <button
      type="button"
      onClick={(e) => {
        // Stop event from bubbling to parent elements (which might have navigation handlers)
        e.stopPropagation();
        // CRITICAL: Only call onToggle (which is handleSidebarToggle)
        // NEVER call onItemClick or handleItemClick
        // This should ONLY toggle sidebar state, NEVER navigate
        console.log('🔘 Toggle rail clicked - ONLY toggling sidebar, NOT navigating');
        onToggle?.();
      }}
      aria-label={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
      className={`fixed inset-y-0 w-3
        shadow-lg
        hover:shadow-xl
        ${isCollapsed ? 'left-0' : isExpanded ? 'left-80' : isChatPanelOpen ? '' : 'left-10 lg:left-14'}`}
      style={{ 
        WebkitTapHighlightColor: 'transparent',
        zIndex: 9999,
        // Position toggle rail exactly at the edge of the sidebar (no gap)
        // Sidebar is w-10 (40px) on mobile, lg:w-14 (56px) on desktop, w-60 (240px) when expanded
        ...(isChatPanelOpen && !isCollapsed && !isExpanded ? { left: '376px' } : {}),
        // Make toggle rail white (or transparent when chat panel is open in small sidebar mode to remove grey line)
        backgroundColor: (isChatPanelOpen && !isCollapsed && !isExpanded) ? 'transparent' : '#FFFFFF',
        // Add faint borders on left and right sides for visibility against white background
        borderLeft: '1px solid rgba(229, 231, 235, 0.6)',
        borderRight: '1px solid rgba(229, 231, 235, 0.6)',
        pointerEvents: 'auto',
        transition: 'left 0.2s ease-out, background-color 0.2s ease-out, box-shadow 0.2s ease-out, border-color 0.2s ease-out'
      }}
    >
      {/* Glassmorphism arrow indicator - should point left when expanded, right when collapsed */}
      <div
        className={`absolute top-1/2 left-1/2 w-3 h-3 flex items-center justify-center`}
        style={{ 
          transform: `translate(-50%, -50%) rotate(${isCollapsed ? 0 : 180}deg)`,
          transition: 'transform 0.2s ease-out'
        }}
      >
        <div className={`w-0 h-0 border-l-[8px] border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent drop-shadow-sm`} style={{ borderLeftColor: '#D3D3D3' }} />
      </div>
    </button>
  </>;
};
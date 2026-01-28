"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  FolderOpen, 
  MessageSquare, 
  ListEnd, 
  PanelLeftClose,
  Plus,
  MoreHorizontal,
  Edit,
  Archive,
  Trash2,
  ArchiveRestore,
  LibraryBig,
  Activity,
  ChevronDown,
  Settings,
  LogOut,
  MessageCircle,
  User,
  Layers,
  Map
} from "lucide-react";
import { useChatHistory } from "./ChatHistoryContext";
import { useFilingSidebar } from "../contexts/FilingSidebarContext";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { backendApi } from "@/services/backendApi";

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
  isMapVisible?: boolean;
  onCreateProject?: () => void;
  hasActiveChat?: boolean; // Whether there's an active chat query running
  onRestoreActiveChat?: () => void; // Callback to restore/re-engage with active chat
  isChatVisible?: boolean; // Whether the chat panel is currently visible
  onMapToggle?: () => void; // Callback to toggle/open map view
}

type NavItem = {
  id: string;
  label: string;
  icon: React.ComponentType<any>;
  badge?: string;
  action?: 'navigate' | 'expand' | 'toggleFiling' | 'openChat' | 'openMap';
};

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
  isMapVisible = false,
  onCreateProject,
  hasActiveChat = false,
  onRestoreActiveChat,
  isChatVisible = false,
  onMapToggle
}: SidebarProps) => {
  const [hoveredChat, setHoveredChat] = React.useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = React.useState<string | null>(null);
  const [editingChatId, setEditingChatId] = React.useState<string | null>(null);
  const [editingTitle, setEditingTitle] = React.useState<string>('');
  const [showArchived, setShowArchived] = React.useState<boolean>(false);
  const [isBrandDropdownOpen, setIsBrandDropdownOpen] = React.useState<boolean>(false);
  const [userData, setUserData] = React.useState<any>(null);
  const brandButtonRef = React.useRef<HTMLButtonElement>(null);
  const brandDropdownRef = React.useRef<HTMLDivElement>(null);

  // Chat history state
  const {
    chatHistory,
    removeChatFromHistory,
    updateChatTitle,
    archiveChat,
    unarchiveChat
  } = useChatHistory();

  // Filing sidebar integration
  const { toggleSidebar: toggleFilingSidebar, closeSidebar: closeFilingSidebar, isOpen: isFilingSidebarOpen } = useFilingSidebar();

  // Fetch user data on mount
  React.useEffect(() => {
    const fetchUserData = async () => {
      try {
        const authResult = await backendApi.checkAuth();
        if (authResult.success && authResult.data?.user) {
          console.log('User data from API:', authResult.data.user);
          console.log('Role field:', authResult.data.user.role);
          setUserData(authResult.data.user);
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
      }
    };
    fetchUserData();
  }, []);

  // Debug: Log when userData changes
  React.useEffect(() => {
    if (userData) {
      console.log('userData state updated:', userData);
      console.log('userData.role:', userData.role);
    }
  }, [userData]);

  // Close brand dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        brandDropdownRef.current && 
        !brandDropdownRef.current.contains(event.target as Node) &&
        brandButtonRef.current &&
        !brandButtonRef.current.contains(event.target as Node)
      ) {
        setIsBrandDropdownOpen(false);
      }
    };

    if (isBrandDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isBrandDropdownOpen]);

  // Close menu when clicking outside
  React.useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null);
    if (openMenuId) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openMenuId]);

  // Generate user display info - use useMemo to recalculate when userData changes
  const userName = React.useMemo(() => {
    // Use role/profile ID if available (e.g., "Admin")
    if (userData?.role) {
      // Capitalize the first letter (e.g., "admin" -> "Admin")
      const role = String(userData.role);
      console.log('Using role for userName:', role);
      return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
    }
    if (userData?.first_name) {
      return userData.first_name + (userData.last_name ? ` ${userData.last_name}` : '');
    }
    if (userData?.email) {
      const emailPrefix = userData.email.split('@')[0];
      return emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
    }
    return "User";
  }, [userData]);

  const userHandle = React.useMemo(() => {
    if (userData?.email) {
      const emailPrefix = userData.email.split('@')[0];
      return `@${emailPrefix}`;
    }
    return "@user";
  }, [userData]);

  // Primary navigation items
  const primaryNav: NavItem[] = [
    { id: 'home', label: 'Dashboard', icon: LibraryBig, action: 'navigate' },
    { id: 'projects', label: 'Projects', icon: Layers, action: 'navigate' },
    { id: 'map', label: 'Map', icon: Map, action: 'openMap' },
    { id: 'database', label: 'Files', icon: FolderOpen, action: 'toggleFiling' },
    { id: 'chat', label: 'Chat', icon: MessageCircle, action: 'openChat' },
    { id: 'analytics', label: 'Analytics', icon: Activity, action: 'navigate' },
  ];

  // Secondary navigation items
  const secondaryNav: NavItem[] = [
    { id: 'settings', label: 'Settings', icon: Settings, action: 'navigate' },
  ];

  const handleItemClick = React.useCallback((itemId: string) => {
    onItemClick?.(itemId);
  }, [onItemClick]);

  const handleNavClick = React.useCallback((item: NavItem) => {
    // Close filing sidebar when clicking any navigation item except Files
    if (item.action !== 'toggleFiling' && isFilingSidebarOpen) {
      closeFilingSidebar();
    }
    
    if (item.action === 'expand') {
      onExpand?.();
    } else if (item.action === 'toggleFiling') {
      toggleFilingSidebar();
    } else if (item.action === 'openChat') {
      // CRITICAL: Chat button should ONLY open fullscreen chat, never route to dashboard
      // Always call onRestoreActiveChat - this ensures fullscreen chat view, never dashboard
      if (onRestoreActiveChat) {
        onRestoreActiveChat();
      } else {
        console.warn('onRestoreActiveChat not available - chat button cannot open chat');
      }
      // Explicitly return to prevent any fallback navigation
      return;
    } else if (item.action === 'openMap') {
      // Open map view
      if (onMapToggle) {
        onMapToggle();
      } else {
        console.warn('onMapToggle not available - map button cannot open map');
      }
      return;
    } else if (item.id === 'home') {
      handleItemClick('home');
    } else if (item.id === 'settings') {
      onNavigate?.('settings');
    } else {
      handleItemClick(item.id);
    }
  }, [isFilingSidebarOpen, closeFilingSidebar, onExpand, toggleFilingSidebar, onRestoreActiveChat, onMapToggle, onNavigate, handleItemClick]);

  const isItemActive = (item: NavItem) => {
    // Mutually exclusive selection: Filing sidebar takes priority, then chat, then check activeItem
    if (isFilingSidebarOpen) {
      return item.action === 'toggleFiling';
    }
    // Chat is active when chat panel is visible
    if (item.action === 'openChat') {
      return isChatVisible;
    }
    // Map is active ONLY when in search/map view AND map is visible AND chat is NOT visible
    // Just having isMapVisible true (background state) shouldn't make Map active
    if (item.action === 'openMap') {
      return activeItem === 'search' && isMapVisible && !isChatVisible;
    }
    // Dashboard is active when in search view without map visible
    if (item.id === 'home') {
      return activeItem === 'search' && !isMapVisible && !isChatVisible;
    }
    // For all other navigation items (projects, analytics, etc.),
    // check activeItem directly - don't exclude based on isMapVisible
    // since the map might be rendered in the background
    return activeItem === item.id && !isChatVisible;
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

  // Render a nav item with icon and label
  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = isItemActive(item);
    const isChat = item.action === 'openChat';
    const showChatIndicator = isChat && hasActiveChat;
    const isSettings = item.id === 'settings';

    return (
      <button
        key={item.id}
        onClick={() => handleNavClick(item)}
        className={`w-full flex items-center gap-3 px-3 py-1.5 rounded group relative border ${
          active && !isSettings
            ? 'bg-white text-gray-900 border-gray-300' 
            : active && isSettings
            ? 'text-gray-900 border-transparent'
            : 'text-gray-600 hover:bg-white/60 hover:text-gray-900 border-transparent active:bg-white active:text-gray-900'
        }`}
        style={{
          boxShadow: active && !isSettings ? '0 1px 2px rgba(0, 0, 0, 0.04)' : 'none',
          transition: 'none',
          boxSizing: 'border-box',
          willChange: 'background-color, color, border-color',
          transform: 'translateZ(0)',
          WebkitTapHighlightColor: 'transparent'
        }}
        aria-label={item.label}
      >
        <div className="relative">
          <Icon
            className="w-[18px] h-[18px] flex-shrink-0"
            strokeWidth={1.75}
          />
          {/* Pulsing indicator for active chat query */}
          {showChatIndicator && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
          )}
        </div>
        <span className="text-[13px] font-normal flex-1 text-left">
          {item.label}
        </span>
        {item.badge && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-50 text-emerald-600">
            {item.badge}
          </span>
        )}
      </button>
    );
  };

  // Calculate actual width values
  const getSidebarWidthValue = () => {
    if (isCollapsed) return 0;
    if (isExpanded) return 320;
    return 224; // w-56 = 224px
  };

  const sidebarWidthValue = getSidebarWidthValue();

  // Hide sidebar when collapsed
  // When map is visible, sidebar should be hidden (collapsed), but user can toggle it open
  const shouldHideSidebar = isCollapsed;

  return (
    <>
      {/* Always render to prevent gaps - just position off-screen when closed */}
      <div
        className={`flex flex-col fixed top-0 h-full ${className?.includes('z-[150]') ? 'z-[150]' : 'z-[1000]'} ${className || ''}`}
        style={{
          // Match sidebar grey background for seamless look - always solid
          background: '#F1F1F1',
          // When collapsed OR (map visible AND collapsed), move off-screen to the left
          // When open (even in map view if user toggled it), position at left: 0
          left: shouldHideSidebar ? '-1000px' : '0px',
          width: isCollapsed ? `${sidebarWidthValue}px` : `${sidebarWidthValue}px`, // Keep width when closed to prevent layout shift
          // Instant transitions to prevent map showing through gaps (same as FilingSidebar)
          transition: 'left 0s ease-out, width 0s ease-out',
          willChange: 'left, width', // Optimize for performance
          // Force GPU acceleration for smoother rendering
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          // Ensure background extends fully to prevent any gaps
          boxShadow: 'none',
          borderRight: 'none',
          // Ensure full height coverage - use 100vh to cover entire viewport
          minHeight: '100vh',
          height: '100vh',
          // Extend slightly to the right to ensure no gap with FilingSidebar
          marginRight: '0',
          paddingRight: '0',
          // Ensure sidebar covers from top to bottom with no gaps
          top: '0',
          bottom: '0',
          // Higher z-index to ensure it's above map
          zIndex: className?.includes('z-[150]') ? 150 : 1000,
          // Extend slightly beyond to ensure full coverage
          minWidth: `${sidebarWidthValue}px`,
          right: 'auto',
          // Hide pointer events when sidebar should be hidden
          pointerEvents: shouldHideSidebar ? 'none' : 'auto',
          overflow: 'hidden'
        }}
      >
        {!shouldHideSidebar && (
          <div className="flex flex-col h-full pt-4 pb-3">
            {/* User Profile Block - OpenAI style integrated dropdown */}
            <div className="px-3 mb-1">
              <div className="relative">
                <button
                  ref={brandButtonRef}
                  onClick={() => setIsBrandDropdownOpen(!isBrandDropdownOpen)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors duration-75 text-left ${
                    isBrandDropdownOpen 
                      ? 'bg-white' 
                      : 'hover:bg-white/60'
                  }`}
                  style={{
                    boxShadow: isBrandDropdownOpen ? '0 1px 2px rgba(0, 0, 0, 0.04)' : 'none',
                    transition: 'background-color 75ms'
                  }}
                  aria-label="Account menu"
                >
                  <Avatar className="h-8 w-8 flex-shrink-0 border border-gray-300/50">
                    <AvatarImage 
                      src={userData?.profile_image || userData?.avatar_url || "/default profile icon.png"} 
                      alt={userName}
                      className="object-cover"
                    />
                    <AvatarFallback className="bg-white">
                      <img 
                        src="/default profile icon.png" 
                        alt="Default profile" 
                        className="w-full h-full object-cover rounded-full"
                      />
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-normal text-gray-900 leading-tight">{userName}</p>
                    <p className="text-[11px] font-normal text-gray-500 leading-tight">{userData?.email || userHandle}</p>
                  </div>
                  <ChevronDown 
                    className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-200 ${
                      isBrandDropdownOpen ? 'rotate-180' : ''
                    }`} 
                    strokeWidth={1.5} 
                  />
                </button>

                {/* Integrated Dropdown Menu - OpenAI style */}
                <AnimatePresence>
                  {isBrandDropdownOpen && (
                    <motion.div
                      ref={brandDropdownRef}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="mt-1 bg-white border border-gray-200/60 shadow-sm">
                        {/* Menu Items */}
                        <div className="py-0.5">
                          {/* Profile */}
                          <button
                            onClick={() => {
                              setIsBrandDropdownOpen(false);
                              onNavigate?.('profile');
                            }}
                            className="w-full px-2 py-1.5 flex items-center gap-2 hover:bg-gray-50 transition-colors text-left group"
                          >
                            <User className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-900 transition-colors" strokeWidth={1.75} />
                            <span className="text-[12px] text-gray-900 font-normal">Profile</span>
                          </button>

                          {/* Divider */}
                          <div className="border-t border-gray-200/60 my-0.5" />

                          {/* Sign Out */}
                          <button
                            onClick={() => {
                              setIsBrandDropdownOpen(false);
                              onSignOut?.();
                            }}
                            className="w-full px-2 py-1.5 flex items-center gap-2 hover:bg-gray-50 transition-colors text-left group"
                          >
                            <LogOut className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-900 transition-colors" strokeWidth={1.75} />
                            <span className="text-[12px] text-gray-900 font-normal">Sign out</span>
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Quick Actions Label */}
            <div className="px-4 mt-4 mb-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">Quick actions</span>
                <span className="text-[10px] text-gray-400 font-normal px-1.5 py-0.5 rounded bg-white/80">⌘E</span>
              </div>
            </div>

            {/* Primary Navigation */}
            <div className="px-3 space-y-0.5">
              {primaryNav.map(renderNavItem)}
            </div>

            {/* Divider */}
            <div className="mx-4 my-4 h-px bg-gray-200/80" />

            {/* Spacer */}
            <div className="flex-1" />

            {/* Divider before secondary */}
            <div className="mx-4 mb-3 h-px bg-gray-200/80" />

            {/* Secondary Navigation */}
            <div className="px-3 space-y-0.5">
              {secondaryNav.map(renderNavItem)}
            </div>
          </div>
        )}

        {/* Expanded Sidebar Content (Chat History) - OpenAI/Claude style */}
        {isExpanded && !shouldHideSidebar && (
          <div className="absolute inset-0 flex flex-col" style={{ background: '#F1F1F1' }}>
            {/* Header with New Chat button */}
            <div className="px-3 pt-4 pb-2">
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => {
                    // CRITICAL: This button should ONLY close the expanded sidebar view
                    // It should NEVER affect the agent sidebar (chat panel) - they are independent
                    onExpand?.();
                  }}
                  className="p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-white/60 transition-colors"
                  aria-label="Close"
                >
                  <ListEnd className="w-4 h-4" strokeWidth={1.75} />
                </button>
              </div>
              
              {/* New Chat Button - prominent like OpenAI */}
              <button
                onClick={onNewChat}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-white hover:bg-gray-50 rounded-lg transition-colors border border-gray-200/60"
                style={{ boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)' }}
              >
                <Plus className="w-4 h-4 text-gray-600" strokeWidth={2} />
                <span className="text-gray-800 font-normal text-[13px]">New chat</span>
              </button>
            </div>

            {/* Chat List - scrollable */}
            <div className="flex-1 overflow-y-auto px-3">
              {/* Archive Toggle - subtle */}
              {archivedChats.length > 0 && (
                <div className="flex items-center justify-between py-2 mb-1">
                  <span className="text-[11px] text-gray-400 uppercase tracking-wider font-normal">
                    {showArchived ? 'Archived' : 'Recent'}
                  </span>
                  <button
                    onClick={() => setShowArchived(!showArchived)}
                    className={`p-1 rounded transition-colors ${
                      showArchived
                        ? 'text-amber-600 hover:bg-amber-50'
                        : 'text-gray-400 hover:text-gray-600 hover:bg-white/60'
                    }`}
                  >
                    {showArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )}

              {/* Chat List */}
              {displayedChats.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <MessageSquare className="w-8 h-8 text-gray-300 mb-3" strokeWidth={1.5} />
                  <p className="text-gray-400 text-[13px] text-center">
                    {showArchived ? 'No archived chats' : 'Start a new conversation'}
                  </p>
                </div>
              ) : (
                <div className="space-y-0.5 pb-3">
                  {displayedChats.map((chat) => {
                    const isEditing = editingChatId === chat.id;
                    return (
                      <div
                        key={`chat-${chat.id}`}
                        onClick={() => handleChatClick(chat.id)}
                        onMouseEnter={() => setHoveredChat(chat.id)}
                        onMouseLeave={() => setHoveredChat(null)}
                        className="group relative px-3 py-2.5 rounded-lg transition-colors cursor-pointer hover:bg-white/70"
                      >
                        {isEditing ? (
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRename(chat.id);
                              if (e.key === 'Escape') handleCancelRename();
                            }}
                            onBlur={() => handleSaveRename(chat.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full px-2 py-1 text-[13px] bg-white border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-300"
                            autoFocus
                          />
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] text-gray-700 truncate flex-1 group-hover:text-gray-900">
                              {chat.title}
                            </span>
                            <button
                              onClick={(e) => handleMenuToggle(e, chat.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-100 transition-all flex-shrink-0"
                            >
                              <MoreHorizontal className="w-4 h-4 text-gray-400" />
                            </button>
                          </div>
                        )}

                        {/* Context Menu */}
                        {openMenuId === chat.id && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: -4 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -4 }}
                            transition={{ duration: 0.12 }}
                            className="absolute right-0 top-full mt-1 w-36 rounded-lg py-1 z-[9999]"
                            style={{ 
                              backgroundColor: '#2D2D2D',
                              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                              isolation: 'isolate'
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={(e) => handleRename(e, chat.id, chat.title)}
                              className="w-full px-3 py-1.5 text-left text-[13px] text-white/90 hover:bg-white/10 transition-colors"
                            >
                              Rename
                            </button>
                            <button
                              onClick={(e) => chat.archived ? handleUnarchiveChat(e, chat.id) : handleArchiveChat(e, chat.id)}
                              className="w-full px-3 py-1.5 text-left text-[13px] text-white/90 hover:bg-white/10 transition-colors"
                            >
                              {chat.archived ? 'Unarchive' : 'Archive'}
                            </button>
                            <div className="h-px bg-white/10 my-1" />
                            <button
                              onClick={(e) => handleDeleteChat(e, chat.id)}
                              className="w-full px-3 py-1.5 text-left text-[13px] text-white/90 hover:bg-white/10 transition-colors"
                            >
                              Delete
                            </button>
                          </motion.div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      {/* Sidebar Toggle Rail - seamless with sidebar and adjacent panels */}
      {/* Always show toggle rail, even in map view */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        aria-label={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        className="fixed inset-y-0 w-3 group"
        style={{
          WebkitTapHighlightColor: 'transparent',
          zIndex: 100003, // Higher than dropdown backdrop (100001) and dropdown (100002) to ensure it's always clickable
          // When sidebar is collapsed, position at left: 0
          // Otherwise, position at the right edge of the sidebar
          left: isCollapsed ? '0px' : (isExpanded ? '320px' : '224px'),
          // Match sidebar background for seamless look
          background: '#F1F1F1',
          pointerEvents: 'auto',
          transition: 'left 0s ease-out' // Instant transition to prevent gaps
        }}
      >
        {/* Subtle hover indicator */}
        <div 
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: 'rgba(0, 0, 0, 0.04)' }}
        />
        {/* Arrow indicator - only show on hover */}
        <div
          className="absolute top-1/2 left-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            transform: `translate(-50%, -50%) rotate(${isCollapsed ? 0 : 180}deg)`,
            transition: 'transform 0.2s ease-out, opacity 0.15s ease-out'
          }}
        >
          <div 
            className="w-0 h-0 border-l-[5px] border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent" 
            style={{ borderLeftColor: '#9CA3AF' }} 
          />
        </div>
      </button>
    </>
  );
};

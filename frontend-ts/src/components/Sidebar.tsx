"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { 
  FolderClosed,
  Files,
  MessageSquare, 
  ListEnd, 
  PanelLeftClose,
  MoreHorizontal,
  Edit,
  Archive,
  Trash2,
  ArchiveRestore,
  LibraryBig,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Settings,
  LogOut,
  MessageCircle,
  MessagesSquare,
  Plus,
  Search,
  Upload,
  HelpCircle,
  Info,
  CircleArrowUp,
  Monitor,
  Sun,
  Moon,
  Palette,
  Check
} from "lucide-react";
import { useTheme } from "next-themes";
import OrbitProgress from "react-loading-indicators/OrbitProgress";
import { useChatHistory } from "./ChatHistoryContext";
import { useFilingSidebar } from "../contexts/FilingSidebarContext";
import { useFeedbackModal } from "../contexts/FeedbackModalContext";
import { usePlanModal } from "../contexts/PlanModalContext";
import { useUsage } from "../contexts/UsageContext";
import { useAuthUser } from "../contexts/AuthContext";
import { backendApi } from "@/services/backendApi";
import { getPlanBadgeInfo } from "@/config/billing";
import { getProfilePictureSrc } from "@/utils/profilePicture";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

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
  onNavigate?: (view: string, options?: { openCategory?: string }) => void;
  onSignOut?: () => void;
  onChatSelect?: (chatId: string) => void;
  onNewChat?: () => void;
  isMapVisible?: boolean;
  onCreateProject?: () => void;
  hasActiveChat?: boolean; // Whether there's an active chat query running
  onRestoreActiveChat?: () => void; // Callback to open fullscreen chat with map (New chat button)
  onOpenChatsView?: () => void; // Callback to open new-chat UI (centered, welcome message, no map)
  isChatVisible?: boolean; // Whether the chat panel is currently visible
  onMapToggle?: () => void; // Callback to toggle/open map view
  onOpenSearch?: () => void; // Callback to open Search modal (command palette)
  onUploadFile?: () => void; // Callback to trigger file selection for extraction pipeline
  isSearchOpen?: boolean; // When true, hide the toggle rail so it never appears while searching
  isIconsOnly?: boolean; // When true, sidebar shows only icons (narrow width)
  onIconsOnlyToggle?: () => void; // Toggle between full sidebar and icons-only
}

export const SIDEBAR_ICONS_ONLY_WIDTH = 56;

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
  onOpenChatsView,
  isChatVisible = false,
  onMapToggle,
  onOpenSearch,
  onUploadFile,
  isSearchOpen = false,
  isIconsOnly = false,
  onIconsOnlyToggle
}: SidebarProps) => {
  const [hoveredChat, setHoveredChat] = React.useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = React.useState<string | null>(null);
  const [editingChatId, setEditingChatId] = React.useState<string | null>(null);
  const [editingTitle, setEditingTitle] = React.useState<string>('');
  const [showArchived, setShowArchived] = React.useState<boolean>(false);
  const [isBrandDropdownOpen, setIsBrandDropdownOpen] = React.useState<boolean>(false);
  const [isThemeSubmenuOpen, setIsThemeSubmenuOpen] = React.useState<boolean>(false);
  const [profilePicCacheBust, setProfilePicCacheBust] = React.useState<number | null>(null);
  const { openPlanModal } = usePlanModal();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light' && resolvedTheme !== undefined;
  const { usage: usageData, loading: usageLoading, error: usageError } = useUsage();
  const brandButtonRef = React.useRef<HTMLButtonElement>(null);
  const brandButtonRefExpanded = React.useRef<HTMLButtonElement>(null);
  const brandDropdownRef = React.useRef<HTMLDivElement>(null);
  const themeButtonRef = React.useRef<HTMLButtonElement>(null);
  const themeSubmenuRef = React.useRef<HTMLDivElement>(null);
  const [iconsOnlyDropdownPosition, setIconsOnlyDropdownPosition] = React.useState<{ top: number; left: number } | null>(null);
  const [themeSubmenuPosition, setThemeSubmenuPosition] = React.useState<{ top: number; left: number } | null>(null);
  const { isOpen: isFeedbackModalOpen } = useFeedbackModal();
  const contextUser = useAuthUser();
  // Seed from AuthContext so role/name is correct on first paint (no "User" → "Admin" flash)
  const [userData, setUserData] = React.useState<any>(contextUser ?? null);
  React.useEffect(() => {
    if (contextUser) setUserData(contextUser);
  }, [contextUser]);

  // When icons-only and dropdown open, position popup with fixed so it appears above the strip but fully in view (to the right of the narrow strip so nothing is clipped)
  React.useLayoutEffect(() => {
    if (!isIconsOnly || !isBrandDropdownOpen || isExpanded) {
      setIconsOnlyDropdownPosition(null);
      return;
    }
    const el = brandButtonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Position dropdown to the right of the icons-only strip (56px) so it's never clipped by sidebar overflow/edge
    setIconsOnlyDropdownPosition({ top: rect.top, left: SIDEBAR_ICONS_ONLY_WIDTH });
  }, [isIconsOnly, isBrandDropdownOpen, isExpanded]);

  // When Theme submenu open, position it to the right of the Theme button (portal so it isn't clipped by sidebar overflow)
  React.useLayoutEffect(() => {
    if (!isThemeSubmenuOpen || !isBrandDropdownOpen) {
      setThemeSubmenuPosition(null);
      return;
    }
    const el = themeButtonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setThemeSubmenuPosition({ top: rect.top, left: rect.right + 4 });
  }, [isThemeSubmenuOpen, isBrandDropdownOpen]);

  // Chat history state
  const {
    chatHistory,
    removeChatFromHistory,
    updateChatTitle,
    archiveChat,
    unarchiveChat
  } = useChatHistory();

  // Filing sidebar integration
  const { toggleSidebar: toggleFilingSidebar, closeSidebar: closeFilingSidebar, isOpen: isFilingSidebarOpen, isFilesUploading } = useFilingSidebar();

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

  // Sync profile picture when updated from Profile page (and bust cache so new image shows)
  React.useEffect(() => {
    const handler = (e: CustomEvent<{ profileImageUrl?: string; avatarUrl?: string; removed?: boolean; cacheBust: number }>) => {
      const { detail } = e;
      setProfilePicCacheBust(detail.cacheBust);
      if (detail.removed) {
        setUserData((prev) => prev ? { ...prev, profile_image: undefined, avatar_url: undefined, profile_picture_url: undefined } : null);
      } else if (detail.profileImageUrl) {
        setUserData((prev) => prev ? { ...prev, profile_image: detail.profileImageUrl, avatar_url: detail.avatarUrl ?? detail.profileImageUrl, profile_picture_url: detail.profileImageUrl } : null);
      }
    };
    window.addEventListener('profilePictureUpdated', handler as EventListener);
    return () => window.removeEventListener('profilePictureUpdated', handler as EventListener);
  }, []);

  // Debug: Log when userData changes
  React.useEffect(() => {
    if (userData) {
      console.log('userData state updated:', userData);
      console.log('userData.role:', userData.role);
    }
  }, [userData]);

  // Close brand dropdown when clicking outside (main or expanded strip)
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const inDropdown = brandDropdownRef.current?.contains(target);
      const inMainStrip = brandButtonRef.current?.contains(target);
      const inExpandedStrip = brandButtonRefExpanded.current?.contains(target);
      const inThemeSubmenu = themeSubmenuRef.current?.contains(target);
      const inThemeButton = themeButtonRef.current?.contains(target);
      if (isBrandDropdownOpen && !inDropdown && !inMainStrip && !inExpandedStrip && !inThemeSubmenu && !inThemeButton) {
        setIsBrandDropdownOpen(false);
        setIsThemeSubmenuOpen(false);
      }
    };

    if (isBrandDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isBrandDropdownOpen]);

  // Close theme submenu when brand dropdown closes
  React.useEffect(() => {
    if (!isBrandDropdownOpen) setIsThemeSubmenuOpen(false);
  }, [isBrandDropdownOpen]);

  // Close menu when clicking outside
  React.useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null);
    if (openMenuId) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openMenuId]);

  // Generate user display info - prefer profile name (first_name / last_name), then email prefix, then role
  const userName = React.useMemo(() => {
    const first = (userData?.first_name || '').trim();
    const last = (userData?.last_name || '').trim();
    if (first || last) {
      return `${first} ${last}`.trim();
    }
    if (userData?.email) {
      const emailPrefix = userData.email.split('@')[0];
      return emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
    }
    if (userData?.role) {
      const role = String(userData.role);
      return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
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

  const userInitials = React.useMemo(() => {
    const parts = userName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }
    return userName.charAt(0).toUpperCase() || 'U';
  }, [userName]);

  const avatarImageSrc = React.useMemo(() => {
    const base = userData?.profile_image || userData?.avatar_url || userData?.profile_picture_url;
    return getProfilePictureSrc(base, profilePicCacheBust);
  }, [userData?.profile_image, userData?.avatar_url, userData?.profile_picture_url, profilePicCacheBust]);

  const planBadgeInfo = React.useMemo(
    () => getPlanBadgeInfo(usageData?.plan),
    [usageData?.plan]
  );

  // Primary navigation items
  const primaryNav: NavItem[] = [
    { id: 'home', label: 'Dashboard', icon: LibraryBig, action: 'navigate' },
    { id: 'database', label: 'Files', icon: Files, action: 'toggleFiling' },
    { id: 'projects', label: 'Projects', icon: FolderClosed, action: 'navigate' },
    { id: 'chat', label: 'Chats', icon: MessagesSquare, action: 'openChat' },
  ];

  // Settings removed from sidebar; reachable only via account pop-up (bottom strip) → Settings
  const secondaryNav: NavItem[] = [];

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
      // When in map section: go to full-screen new chat (same as "New chat" button).
      // When not in map: open new-chat UI (centered, "What are you working on?", no map).
      // Tools → Chat on the map bar stays as-is (onPanelToggle), handled in MapChatBar.
      const isInMapSection = activeItem === 'search' && isMapVisible;
      if (isInMapSection && (onRestoreActiveChat || onNewChat)) {
        onRestoreActiveChat?.();
        onNewChat?.();
      } else if (onOpenChatsView) {
        onOpenChatsView();
      } else {
        onChatToggle?.();
      }
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
  }, [isFilingSidebarOpen, closeFilingSidebar, onExpand, toggleFilingSidebar, onOpenChatsView, onChatToggle, onRestoreActiveChat, onNewChat, onMapToggle, onNavigate, handleItemClick, activeItem, isMapVisible]);

  const isItemActive = (item: NavItem) => {
    // While Search modal is open, only Search is highlighted — no section (Dashboard, Projects, etc.)
    if (isSearchOpen) {
      return false;
    }
    // Mutually exclusive selection: Filing sidebar takes priority, then chat, then check activeItem
    if (isFilingSidebarOpen) {
      return item.action === 'toggleFiling';
    }
    // Chats = new-chat UI: active when that view is visible (centered welcome)
    if (item.action === 'openChat') {
      return isChatVisible;
    }
    // Map is active ONLY when in search/map view AND map is visible AND chat is NOT visible
    // Just having isMapVisible true (background state) shouldn't make Map active
    if (item.action === 'openMap') {
      return activeItem === 'search' && isMapVisible && !isChatVisible;
    }
    // Dashboard is active when we're on the dashboard view (main content with search bar). Dashboard is not "Search" — Search is the modal only.
    if (item.id === 'home') {
      return activeItem === 'search' && !isMapVisible && !isChatVisible;
    }
    // For all other navigation items (projects, etc.),
    // check activeItem directly - don't exclude based on isMapVisible
    // since the map might be rendered in the background
    return activeItem === item.id && !isChatVisible;
  };

  // Search button is highlighted only when the Search modal (command palette) is open — not when on the dashboard
  const isSearchButtonActive = isSearchOpen;

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

  // Filter chats based on archived status; hide property-scoped chats (they restore when re-opening the project)
  const activeChats = chatHistory.filter(chat => !chat.archived && !chat.id.startsWith('property-'));
  const archivedChats = chatHistory.filter(chat => chat.archived && !chat.id.startsWith('property-'));
  const displayedChats = showArchived ? archivedChats : activeChats;

  // Determine if chat history should be shown
  const showChatHistoryInSidebar = isExpanded && isChatPanelOpen;

  // Render a nav item with icon and label (or icon only when isIconsOnly)
  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = isItemActive(item);
    const isChat = item.action === 'openChat';
    const isFiles = item.action === 'toggleFiling';
    const showChatIndicator = isChat && hasActiveChat;
    const showFilesUploadingIndicator = isFiles && isFilesUploading;

    if (isIconsOnly) {
      return (
        <button
          key={item.id}
          onClick={() => handleNavClick(item)}
            className={`w-10 flex items-center justify-center p-2 rounded border ${
              active
                ? isDark ? 'bg-card text-sidebar-foreground border-border' : 'bg-white text-[#141413] border-gray-300'
                : isDark ? 'text-sidebar-foreground hover:bg-card/80 border-transparent active:bg-card active:text-sidebar-foreground' : 'text-[#141413] hover:bg-white/60 border-transparent active:bg-white/60'
          }`}
          style={{
            boxShadow: active ? '0 1px 2px rgba(0, 0, 0, 0.04)' : 'none',
            transition: 'none',
            boxSizing: 'border-box',
            WebkitTapHighlightColor: 'transparent'
          }}
          aria-label={item.label}
        >
          <div className="relative">
            <span className="relative z-10 block">
              <Icon className="w-5 h-5 flex-shrink-0 text-inherit" strokeWidth={1.25} />
            </span>
            {showChatIndicator && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
            )}
            {showFilesUploadingIndicator && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center z-0" aria-hidden title="Uploading">
                <OrbitProgress color="#f59e0b" size="small" dense text="" textColor="" speedPlus={1} style={{ fontSize: '2px' }} />
              </span>
            )}
          </div>
        </button>
      );
    }

    return (
      <button
        key={item.id}
        onClick={() => handleNavClick(item)}
        className={`w-full flex items-center gap-3 px-3 py-1.5 rounded group relative border ${
          active
            ? isDark ? 'bg-card text-sidebar-foreground border-border' : 'bg-white text-[#141413] border-gray-200/80'
            : isDark ? 'text-sidebar-foreground hover:bg-card/80 border-transparent active:bg-card active:text-sidebar-foreground' : 'text-[#141413] hover:bg-white/60 border-transparent active:bg-white/60'
        }`}
        style={{
          boxShadow: active ? '0 1px 1px rgba(0, 0, 0, 0.03)' : 'none',
          transition: 'none',
          boxSizing: 'border-box',
          willChange: 'background-color, color, border-color',
          transform: 'translateZ(0)',
          WebkitTapHighlightColor: 'transparent'
        }}
        aria-label={item.label}
      >
        <div className="relative">
          <span className="relative z-10 block">
            <Icon
              className="w-5 h-5 flex-shrink-0 text-inherit"
              strokeWidth={1.25}
            />
          </span>
          {showChatIndicator && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
          )}
          {showFilesUploadingIndicator && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center z-0" aria-hidden title="Uploading">
              <OrbitProgress color="#f59e0b" size="small" dense text="" textColor="" speedPlus={1} style={{ fontSize: '2px' }} />
            </span>
          )}
        </div>
        <span className="text-[14px] font-normal flex-1 text-left text-inherit">
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
    if (isIconsOnly) return SIDEBAR_ICONS_ONLY_WIDTH;
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
          // Light: before-dark style (#F2F2EF); Dark: muted
          background: isDark ? 'hsl(var(--muted))' : '#F2F2EF',
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
          // Ensure background extends fully to prevent any gaps (1px same-color border prevents dashboard background leakage at seam)
          // Hide border on Settings so no white line shows between sidebar and Settings content (MainContent overlaps 1px there)
          boxShadow: 'none',
          borderRight: activeItem === 'settings' ? 'none' : isDark ? '1px solid hsl(var(--border))' : '1px solid #F2F2EF',
          // Ensure full height coverage - use 100vh to cover entire viewport
          minHeight: '100vh',
          height: '100vh',
          // Extend slightly to the right to ensure no gap with FilingSidebar
          marginRight: '0',
          paddingRight: '0',
          // Ensure sidebar covers from top to bottom with no gaps
          top: '0',
          bottom: '0',
          // When map is visible, MainContent uses z-index 10000 (so chat bar stays clickable).
          // Sidebar must be above that so the map doesn't paint on top of the sidebar.
          // When agent sidebar (chat panel) is open, backdrop is 9999 – keep sidebar above it so nav clicks register in one click.
          // When brand dropdown (profile menu) is open, use very high z-index so it appears above ChatPanel (10001).
          zIndex: className?.includes('z-[150]') ? 150 : isBrandDropdownOpen ? 99999 : (isMapVisible ? 10001 : (isChatPanelOpen ? 10000 : 1000)),
          // Extend slightly beyond to ensure full coverage
          minWidth: `${sidebarWidthValue}px`,
          right: 'auto',
          // Hide pointer events when sidebar should be hidden
          pointerEvents: shouldHideSidebar ? 'none' : 'auto',
          overflow: 'hidden'
        }}
      >
        {!shouldHideSidebar && (
          <div className="flex flex-col h-full min-h-0 pb-3 pt-12">
            {/* OpenFind logo - white variant for sidebar; hidden when icons-only */}
            {!isIconsOnly && (
              <div className="relative flex-shrink-0" style={{ height: 52 }}>
                <div className="absolute left-0 right-0 flex items-center px-3" style={{ top: -26, marginLeft: 14 }}>
                  <img
                    src={isDark ? '/OpenFind-white.png' : '/OpenFind(1).png'}
                    alt="OpenFind"
                    className="h-6 object-contain object-left"
                    style={{ width: 'auto', maxWidth: '240px', filter: isDark ? undefined : 'invert(1) brightness(0.2)', opacity: isDark ? 1 : 0.8 }}
                  />
                </div>
              </div>
            )}
            {/* Top-right (expanded) / same column as icons (icons-only): Show only icons / Expand sidebar toggle */}
            {onIconsOnlyToggle && (
              <div className={`absolute top-1.5 pt-3 z-10 ${isIconsOnly ? 'left-0 right-0 flex justify-center pl-[14px] pr-0' : 'right-0 flex items-center justify-end pr-2'}`}>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onIconsOnlyToggle(); }}
                  className={`rounded border border-transparent transition-colors flex items-center justify-center shrink-0 p-1.5 ${isDark ? 'text-sidebar-foreground hover:bg-card/80 active:bg-card' : 'text-[#141413] hover:bg-white/60 active:bg-white/60'}`}
                  aria-label={isIconsOnly ? 'Expand sidebar' : 'Show only icons'}
                  title={isIconsOnly ? 'Expand sidebar' : 'Show only icons'}
                >
                  <img src="/sidebar.png" alt="" className="h-6 w-6 object-contain -mt-0.5" style={{ filter: isDark ? 'brightness(0) invert(0.77)' : undefined }} />
                </button>
              </div>
            )}

            {/* New chat + Search — same spacing in both modes; icons-only shifted right to center in sidebar+rail */}
            <div className={isIconsOnly ? 'flex flex-col items-center pl-[14px] pr-0 space-y-px mt-12 mb-5' : 'px-3 mt-6 space-y-px mb-5'}>
              <button
                onClick={() => {
                  onRestoreActiveChat?.();
                  onNewChat?.();
                }}
                className={`flex items-center rounded border border-transparent transition-colors ${isDark ? 'text-sidebar-foreground hover:bg-muted active:bg-card' : 'text-[#141413] hover:bg-white/60 active:bg-white/60'} ${isIconsOnly ? 'justify-center p-2 w-10 mt-6' : 'w-full gap-3 pl-2 pr-3 py-1.5'}`}
                aria-label="New chat"
              >
                <span className={`h-6 w-6 flex-shrink-0 rounded-full flex items-center justify-center ${isDark ? 'border border-white/10' : 'bg-gray-200/80 border border-gray-300'}`} style={isDark ? { backgroundColor: 'hsl(220, 22%, 26%)' } : undefined}>
                  <Plus className="h-3.5 w-3.5 text-inherit" strokeWidth={2.5} />
                </span>
                {!isIconsOnly && <span className="text-[14px] font-normal flex-1 text-left text-inherit" style={{ marginLeft: '-2px' }}>New chat</span>}
              </button>
              {onOpenSearch && (
                <button
                  onClick={onOpenSearch}
                  className={`w-full flex items-center rounded border transition-colors ${
                    isSearchButtonActive
                      ? isDark ? 'bg-card text-card-foreground border-border' : 'bg-white text-[#141413] border-gray-300'
                      : isDark ? 'border-transparent text-sidebar-foreground hover:bg-muted active:bg-card' : 'border-transparent text-[#141413] hover:bg-white/60 active:bg-white/60'
                  } ${isIconsOnly ? 'justify-center p-2 w-10' : 'gap-3 px-3 py-1.5 w-full'}`}
                  style={{
                    boxShadow: isSearchButtonActive ? '0 1px 2px rgba(0, 0, 0, 0.04)' : 'none',
                  }}
                  aria-label="Search"
                >
                  <Search className="h-5 w-5 flex-shrink-0 text-inherit" strokeWidth={1.5} />
                  {!isIconsOnly && <span className="text-[14px] font-normal text-left text-inherit">Search</span>}
                </button>
              )}
              {onUploadFile && (
                <button
                  onClick={onUploadFile}
                  className={`flex items-center rounded border border-transparent transition-colors ${isDark ? 'text-sidebar-foreground hover:bg-muted active:bg-card' : 'text-[#141413] hover:bg-white/60 active:bg-white/60'} ${isIconsOnly ? 'justify-center p-2 w-10' : 'w-full gap-3 px-3 py-1.5'}`}
                  aria-label="Upload files"
                >
                  <Upload className="h-5 w-5 flex-shrink-0 text-inherit" strokeWidth={1.5} />
                  {!isIconsOnly && <span className="text-[14px] font-normal text-left text-inherit">Upload</span>}
                </button>
              )}
            </div>

            {/* Primary Navigation; icons-only: narrow column shifted right to center in sidebar+rail */}
            <div className={isIconsOnly ? 'flex flex-col items-center pl-[14px] pr-0 space-y-px' : 'px-3 space-y-px'}>
              {primaryNav.map(renderNavItem)}
            </div>

            {/* Scrollable middle: spacer — profile stays visible at bottom; usage bar moved to FilingSidebar */}
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
              <div className="flex-1 min-h-0" />
            </div>

            {/* Profile strip at bottom — line on top only; icons-only: symmetric padding so 36px avatar fits in 56px sidebar */}
            <div className={`relative flex-shrink-0 min-h-[64px] border-0 border-t pt-4 pb-2 ${isDark ? 'border-border' : 'border-gray-200'} ${isIconsOnly ? 'flex justify-center pl-[10px] pr-[10px]' : 'pl-5 pr-3'}`}>
              {/* Icons-only: render dropdown in portal so it isn't clipped by sidebar transform/overflow */}
              {isIconsOnly && isBrandDropdownOpen && iconsOnlyDropdownPosition && typeof document !== 'undefined' &&
                createPortal(
                  <motion.div
                    ref={brandDropdownRef}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                    className={`rounded-md pt-3 pb-1.5 ${isDark ? 'bg-popover' : 'bg-white'}`}
                    style={{
                      position: 'fixed',
                      left: iconsOnlyDropdownPosition.left,
                      top: iconsOnlyDropdownPosition.top,
                      transform: 'translateY(-100%)',
                      marginTop: -4,
                      width: 280,
                      minWidth: 280,
                      maxWidth: 280,
                      boxShadow: '0 4px 16px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.03)',
                      zIndex: 100002,
                    }}
                  >
                    <div className="px-3 pb-2">
                      <p className={`text-[13px] font-normal truncate ${isDark ? 'text-muted-foreground' : 'text-gray-500'}`}>{userData?.email || userHandle}</p>
                    </div>
                    <div className="px-1">
                      <button
                        onClick={() => {
                          closeFilingSidebar();
                          setIsBrandDropdownOpen(false);
                          onNavigate?.('settings');
                        }}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded text-popover-foreground hover:bg-muted transition-colors text-left"
                      >
                        <Settings className="h-5 w-5 flex-shrink-0" strokeWidth={1.25} />
                        <span className="text-[13px] font-normal">Settings</span>
                      </button>
                      <button
                        onClick={() => setIsBrandDropdownOpen(false)}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded text-popover-foreground hover:bg-muted transition-colors text-left"
                      >
                        <HelpCircle className="h-5 w-5 flex-shrink-0" strokeWidth={1.25} />
                        <span className="text-[13px] font-normal">Get help</span>
                      </button>
                      <div className="relative">
                        <button
                          ref={themeButtonRef}
                          onClick={() => setIsThemeSubmenuOpen(!isThemeSubmenuOpen)}
                          className="w-full flex items-center gap-3 px-2 py-2 rounded text-popover-foreground hover:bg-muted transition-colors text-left"
                        >
                          <Monitor className="h-5 w-5 flex-shrink-0" strokeWidth={1.25} />
                          <span className="text-[13px] font-normal flex-1">Theme</span>
                          <ChevronRight className="h-4 w-4 flex-shrink-0" strokeWidth={1.5} />
                        </button>
                      </div>
                      <div className="border-t border-border my-1" />
                      <button
                        onClick={() => {
                          setIsBrandDropdownOpen(false);
                          openPlanModal(usageData?.plan ?? "professional", usageData?.billing_cycle_end);
                        }}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded text-popover-foreground hover:bg-muted transition-colors text-left"
                      >
                        <CircleArrowUp className="h-5 w-5 flex-shrink-0" strokeWidth={1.25} />
                        <span className="text-[13px] font-normal">Upgrade plan</span>
                      </button>
                      <button
                        onClick={() => setIsBrandDropdownOpen(false)}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded text-popover-foreground hover:bg-muted transition-colors text-left"
                      >
                        <Info className="h-5 w-5 flex-shrink-0" strokeWidth={1.25} />
                        <span className="text-[13px] font-normal flex-1">Learn more</span>
                        <ChevronRight className="h-5 w-5 flex-shrink-0 text-muted-foreground" strokeWidth={1.5} />
                      </button>
                      <div className="border-t border-border my-1" />
                      <button
                        onClick={() => {
                          setIsBrandDropdownOpen(false);
                          onSignOut?.();
                        }}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded text-popover-foreground hover:bg-muted transition-colors text-left"
                      >
                        <LogOut className="h-5 w-5 flex-shrink-0" strokeWidth={1.25} />
                        <span className="text-[13px] font-normal">Log out</span>
                      </button>
                    </div>
                  </motion.div>,
                  document.body
                )}
              <AnimatePresence>
                {!isExpanded && isBrandDropdownOpen && (!isIconsOnly || !iconsOnlyDropdownPosition) && (
                  <motion.div
                    ref={brandDropdownRef}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                    className={`rounded-md z-[10002] pt-3 pb-1.5 absolute bottom-full mb-3 ${isDark ? 'bg-popover' : 'bg-white'} ${isIconsOnly ? 'left-2 right-2' : 'left-3 right-3'}`}
                    style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.03)' }}
                  >
                    <div className="px-3 pb-2">
                      <p className={`text-[13px] font-normal truncate ${isDark ? 'text-muted-foreground' : 'text-gray-500'}`}>{userData?.email || userHandle}</p>
                    </div>
                    <div className="px-1">
                      <button
                        onClick={() => {
                          closeFilingSidebar();
                          setIsBrandDropdownOpen(false);
                          onNavigate?.('settings');
                        }}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded text-popover-foreground hover:bg-muted transition-colors text-left"
                      >
                        <Settings className="h-5 w-5 flex-shrink-0" strokeWidth={1.25} />
                        <span className="text-[13px] font-normal">Settings</span>
                      </button>
                      <button
                        onClick={() => setIsBrandDropdownOpen(false)}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded text-popover-foreground hover:bg-muted transition-colors text-left"
                      >
                        <HelpCircle className="h-5 w-5 flex-shrink-0" strokeWidth={1.25} />
                        <span className="text-[13px] font-normal">Get help</span>
                      </button>
                      <div className="relative">
                        <button
                          ref={themeButtonRef}
                          onClick={() => setIsThemeSubmenuOpen(!isThemeSubmenuOpen)}
                          className="w-full flex items-center gap-3 px-2 py-2 rounded text-popover-foreground hover:bg-muted transition-colors text-left"
                        >
                          <Monitor className="h-5 w-5 flex-shrink-0" strokeWidth={1.25} />
                          <span className="text-[13px] font-normal flex-1">Theme</span>
                          <ChevronRight className="h-4 w-4 flex-shrink-0" strokeWidth={1.5} />
                        </button>
                      </div>
                      <div className="border-t border-border my-1" />
                      <button
                        onClick={() => {
                          setIsBrandDropdownOpen(false);
                          openPlanModal(usageData?.plan ?? "professional", usageData?.billing_cycle_end);
                        }}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded text-popover-foreground hover:bg-muted transition-colors text-left"
                      >
                        <CircleArrowUp className="h-5 w-5 flex-shrink-0" strokeWidth={1.25} />
                        <span className="text-[13px] font-normal">Upgrade plan</span>
                      </button>
                      <button
                        onClick={() => setIsBrandDropdownOpen(false)}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded text-popover-foreground hover:bg-muted transition-colors text-left"
                      >
                        <Info className="h-5 w-5 flex-shrink-0" strokeWidth={1.25} />
                        <span className="text-[13px] font-normal flex-1">Learn more</span>
                        <ChevronRight className="h-5 w-5 flex-shrink-0 text-muted-foreground" strokeWidth={1.5} />
                      </button>
                      <div className="border-t border-border my-1" />
                      <button
                        onClick={() => {
                          setIsBrandDropdownOpen(false);
                          onSignOut?.();
                        }}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded text-popover-foreground hover:bg-muted transition-colors text-left"
                      >
                        <LogOut className="h-5 w-5 flex-shrink-0" strokeWidth={1.25} />
                        <span className="text-[13px] font-normal">Log out</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className={`flex items-center gap-0.5 w-full ${isIconsOnly ? 'justify-center' : ''}`}>
                <button
                  ref={brandButtonRef}
                  onClick={() => {
                    if (isIconsOnly) {
                      // Expand to full sidebar first, then show the pop-up after layout settles
                      onIconsOnlyToggle?.();
                      window.setTimeout(() => setIsBrandDropdownOpen(true), 180);
                    } else {
                      setIsBrandDropdownOpen(!isBrandDropdownOpen);
                    }
                  }}
                  className={`flex items-center rounded transition-colors duration-75 text-left min-w-0 ${
                    isIconsOnly ? 'p-1' : 'gap-3 flex-1 py-0.5'
                  }`}
                  aria-label="Account menu"
                >
                  <Avatar className="h-9 w-9 flex-shrink-0">
                    <AvatarImage src={avatarImageSrc} alt={userName} className="object-cover" />
                    <AvatarFallback className="bg-gray-700 text-white text-xs font-medium">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                  {!isIconsOnly && (
                    <div className="min-w-0 flex-1 text-left flex flex-col gap-1 pl-1">
                      <p className={`text-[13px] font-semibold truncate leading-tight ${isDark ? 'text-muted-foreground' : 'text-gray-600'}`}>{userName}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none w-fit -ml-1 ${isDark ? 'bg-card' : 'bg-white'}`}
                        style={{ color: isDark ? planBadgeInfo.badgeColorDark : planBadgeInfo.badgeColor }}
                      >
                        {planBadgeInfo.badgeText} plan
                      </span>
                    </div>
                  )}
                </button>
                {!isIconsOnly && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsBrandDropdownOpen((prev) => !prev);
                    }}
                    className={`p-1 rounded transition-colors ${isDark ? 'text-muted-foreground hover:text-foreground' : 'text-muted-foreground hover:text-[#141413]'}`}
                    aria-label="Account menu"
                  >
                    <ChevronsUpDown className="w-4 h-4" strokeWidth={1.5} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Expanded Sidebar Content (Chat History) - not shown when icons-only */}
        {isExpanded && !shouldHideSidebar && !isIconsOnly && (
          <div className={`absolute inset-0 flex flex-col ${isDark ? 'bg-muted' : 'bg-[#F2F2EF]'}`}>
            {/* Header with New Chat button */}
            <div className="px-3 pt-4 pb-2">
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => {
                    // CRITICAL: This button should ONLY close the expanded sidebar view
                    // It should NEVER affect the agent sidebar (chat panel) - they are independent
                    onExpand?.();
                  }}
                  className="p-1.5 rounded-md text-foreground hover:bg-muted transition-colors"
                  aria-label="Close"
                >
                  <ListEnd className="w-3.5 h-3.5 text-foreground" strokeWidth={1.25} />
                </button>
              </div>
              
              {/* New chat + Search — same spacing as nav (space-y-px) */}
              <div className="space-y-px mb-4">
                <button
                  onClick={onNewChat}
                  className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-lg transition-colors border ${isDark ? 'bg-card hover:bg-muted border-border text-sidebar-foreground' : 'bg-white hover:bg-gray-50 border-gray-200/60 text-[#141413]'}`}
                  style={{ boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)' }}
                >
                  <span className={`h-6 w-6 flex-shrink-0 rounded-full flex items-center justify-center ${isDark ? 'border border-white/10' : 'bg-gray-200/80 border border-gray-300'}`} style={isDark ? { backgroundColor: 'hsl(220, 22%, 26%)' } : undefined}>
                    <Plus className="h-3.5 w-3.5 text-inherit" strokeWidth={2.5} />
                  </span>
                  <span className="text-inherit font-normal text-[14px] flex-1 text-left" style={{ marginLeft: '-2px' }}>New chat</span>
                </button>
                {onOpenSearch && (
                  <button
                    onClick={onOpenSearch}
                    className={`w-full flex items-center gap-3 px-3 py-1.5 rounded border transition-colors ${
                      isSearchButtonActive
                        ? isDark ? 'bg-card text-card-foreground border-border' : 'bg-white text-[#141413] border-gray-200/80'
                        : isDark ? 'border-transparent text-sidebar-foreground hover:bg-muted active:bg-card' : 'border-transparent text-[#141413] hover:bg-white/60 active:bg-white/60'
                    }`}
                    style={{
                      boxShadow: isSearchButtonActive ? '0 1px 2px rgba(0, 0, 0, 0.04)' : 'none',
                    }}
                    aria-label="Search"
                  >
                    <Search className="h-5 w-5 flex-shrink-0 text-inherit" strokeWidth={1.5} />
                    <span className="text-[14px] font-normal text-left text-inherit">Search</span>
                  </button>
                )}
                {onUploadFile && (
                  <button
                    onClick={onUploadFile}
                    className={`w-full flex items-center gap-3 px-3 py-1.5 rounded border border-transparent transition-colors ${isDark ? 'text-sidebar-foreground hover:bg-muted active:bg-card' : 'text-[#141413] hover:bg-white/60 active:bg-white/60'}`}
                    aria-label="Upload files"
                  >
                    <Upload className="h-5 w-5 flex-shrink-0 text-inherit" strokeWidth={1.5} />
                    <span className="text-[14px] font-normal text-left text-inherit">Upload</span>
                  </button>
                )}
              </div>
            </div>

            {/* Chat List - scrollable */}
            <div className="flex-1 overflow-y-auto px-3">
              {/* Archive Toggle - subtle */}
              {archivedChats.length > 0 && (
                <div className="flex items-center justify-between py-2 mb-1">
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-normal">
                    {showArchived ? 'Archived' : 'Recent'}
                  </span>
                  <button
                    onClick={() => setShowArchived(!showArchived)}
                    className={`p-1 rounded transition-colors ${
                      showArchived
                        ? 'text-amber-600 hover:bg-amber-50'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    {showArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )}

              {/* Chat List */}
              {displayedChats.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <MessageSquare className="w-6 h-6 text-muted-foreground mb-3" strokeWidth={1.5} />
                  <p className="text-muted-foreground text-[14px] text-center">
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
                        className="group relative px-3 py-2.5 rounded-lg transition-colors cursor-pointer hover:bg-muted"
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
                            className="w-full px-2 py-1 text-[14px] bg-card border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                            autoFocus
                          />
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[14px] text-foreground truncate flex-1">
                              {chat.title}
                            </span>
                            <button
                              onClick={(e) => handleMenuToggle(e, chat.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted transition-all flex-shrink-0"
                            >
                              <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
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
                              className="w-full px-3 py-1.5 text-left text-[14px] text-popover-foreground hover:bg-muted transition-colors"
                            >
                              Rename
                            </button>
                            <button
                              onClick={(e) => chat.archived ? handleUnarchiveChat(e, chat.id) : handleArchiveChat(e, chat.id)}
                              className="w-full px-3 py-1.5 text-left text-[14px] text-popover-foreground hover:bg-muted transition-colors"
                            >
                              {chat.archived ? 'Unarchive' : 'Archive'}
                            </button>
                            <div className="h-px bg-border my-1" />
                            <button
                              onClick={(e) => handleDeleteChat(e, chat.id)}
                              className="w-full px-3 py-1.5 text-left text-[14px] text-popover-foreground hover:bg-muted transition-colors"
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

            {/* Profile strip at bottom — line on top only */}
            <div className="relative flex-shrink-0 min-h-[64px] border-0 border-t border-border pl-5 pr-3 pt-4 pb-2">
              <AnimatePresence>
                {isExpanded && isBrandDropdownOpen && (
                  <motion.div
                    ref={brandDropdownRef}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                    className={`absolute bottom-full left-3 right-3 mb-3 rounded-md z-[10002] pt-3 pb-1.5 ${isDark ? 'bg-popover' : 'bg-white'}`}
                    style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.03)' }}
                  >
                    <div className="px-3 pb-2">
                      <p className={`text-[13px] font-normal truncate ${isDark ? 'text-muted-foreground' : 'text-gray-500'}`}>{userData?.email || userHandle}</p>
                    </div>
                    <div className="px-1">
                      <button
                        onClick={() => {
                          closeFilingSidebar();
                          setIsBrandDropdownOpen(false);
                          onNavigate?.('settings');
                        }}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded text-popover-foreground hover:bg-muted transition-colors text-left"
                      >
                        <Settings className="h-5 w-5 flex-shrink-0" strokeWidth={1.25} />
                        <span className="text-[13px] font-normal">Settings</span>
                      </button>
                      <button
                        onClick={() => setIsBrandDropdownOpen(false)}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded text-popover-foreground hover:bg-muted transition-colors text-left"
                      >
                        <HelpCircle className="h-5 w-5 flex-shrink-0" strokeWidth={1.25} />
                        <span className="text-[13px] font-normal">Get help</span>
                      </button>
                      <div className="relative">
                        <button
                          ref={themeButtonRef}
                          onClick={() => setIsThemeSubmenuOpen(!isThemeSubmenuOpen)}
                          className="w-full flex items-center gap-3 px-2 py-2 rounded text-popover-foreground hover:bg-muted transition-colors text-left"
                        >
                          <Monitor className="h-5 w-5 flex-shrink-0" strokeWidth={1.25} />
                          <span className="text-[13px] font-normal flex-1">Theme</span>
                          <ChevronRight className="h-4 w-4 flex-shrink-0" strokeWidth={1.5} />
                        </button>
                      </div>
                      <div className="border-t border-border my-1" />
                      <button
                        onClick={() => {
                          setIsBrandDropdownOpen(false);
                          openPlanModal(usageData?.plan ?? "professional", usageData?.billing_cycle_end);
                        }}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded text-popover-foreground hover:bg-muted transition-colors text-left"
                      >
                        <CircleArrowUp className="h-5 w-5 flex-shrink-0" strokeWidth={1.25} />
                        <span className="text-[13px] font-normal">Upgrade plan</span>
                      </button>
                      <button
                        onClick={() => setIsBrandDropdownOpen(false)}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded text-popover-foreground hover:bg-muted transition-colors text-left"
                      >
                        <Info className="h-5 w-5 flex-shrink-0" strokeWidth={1.25} />
                        <span className="text-[13px] font-normal flex-1">Learn more</span>
                        <ChevronRight className="h-5 w-5 flex-shrink-0 text-muted-foreground" strokeWidth={1.5} />
                      </button>
                      <div className="border-t border-border my-1" />
                      <button
                        onClick={() => {
                          setIsBrandDropdownOpen(false);
                          onSignOut?.();
                        }}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded text-popover-foreground hover:bg-muted transition-colors text-left"
                      >
                        <LogOut className="h-5 w-5 flex-shrink-0" strokeWidth={1.25} />
                        <span className="text-[13px] font-normal">Log out</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="flex items-center gap-0.5 w-full">
                <button
                  ref={brandButtonRefExpanded}
                  onClick={() => setIsBrandDropdownOpen(!isBrandDropdownOpen)}
                  className="flex items-center gap-3 flex-1 min-w-0 py-0.5 rounded transition-colors duration-75 text-left"
                  aria-label="Account menu"
                >
                  <Avatar className="h-9 w-9 flex-shrink-0">
                    <AvatarImage src={avatarImageSrc} alt={userName} className="object-cover" />
                    <AvatarFallback className="bg-gray-700 text-white text-xs font-medium">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 text-left flex flex-col gap-1 pl-1">
                    <p className="text-[13px] font-semibold text-muted-foreground truncate leading-tight">{userName}</p>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none bg-card w-fit -ml-1"
                      style={{ color: isDark ? planBadgeInfo.badgeColorDark : planBadgeInfo.badgeColor }}
                    >
                      {planBadgeInfo.badgeText} plan
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsBrandDropdownOpen((prev) => !prev);
                  }}
                  className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Account menu"
                >
                  <ChevronsUpDown className="w-4 h-4" strokeWidth={1.5} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar Toggle Rail - seamless with sidebar and adjacent panels */}
      {/* Hidden only when Share feedback modal is open (search modal does not hide the rail) */}
      <button
        type="button"
        data-view-dropdown-ignore
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
          left: isCollapsed ? '0px' : `${sidebarWidthValue}px`,
          // Match sidebar background: light #F2F2EF, dark hsl(var(--muted))
          background: isDark ? 'hsl(var(--muted))' : '#F2F2EF',
          pointerEvents: isFeedbackModalOpen ? 'none' : 'auto',
          visibility: isFeedbackModalOpen ? 'hidden' : 'visible',
          transition: 'left 0s ease-out' // Instant transition to prevent gaps
        }}
      >
        {/* Subtle hover indicator - match light sidebar (#F2F2EF) or dark muted */}
        <div 
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: isDark ? 'hsl(var(--muted))' : '#F2F2EF' }}
        />
      </button>
      {/* Theme submenu — portaled so it isn't clipped by sidebar overflow */}
      {isThemeSubmenuOpen && themeSubmenuPosition && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={themeSubmenuRef}
            className="rounded-md bg-popover border border-border shadow-lg py-1 min-w-[120px]"
            style={{
              position: 'fixed',
              top: themeSubmenuPosition.top,
              left: themeSubmenuPosition.left,
              zIndex: 100004,
              boxShadow: '0 4px 16px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.03)',
            }}
          >
            <button onClick={() => { setTheme('light'); setIsThemeSubmenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-popover-foreground hover:bg-muted text-left">
              {theme === 'light' && <Check className="h-3.5 w-3.5 text-primary" />}
              {theme !== 'light' && <span className="w-3.5" />}
              <Sun className="h-3.5 w-3.5" /> Light
            </button>
            <button onClick={() => { setTheme('dark'); setIsThemeSubmenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-popover-foreground hover:bg-muted text-left">
              {theme === 'dark' && <Check className="h-3.5 w-3.5 text-primary" />}
              {theme !== 'dark' && <span className="w-3.5" />}
              <Moon className="h-3.5 w-3.5" /> Dark
            </button>
            <button onClick={() => { setTheme('dark-blue'); setIsThemeSubmenuOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-popover-foreground hover:bg-muted text-left">
              {theme === 'dark-blue' && <Check className="h-3.5 w-3.5 text-primary" />}
              {theme !== 'dark-blue' && <span className="w-3.5" />}
              <Palette className="h-3.5 w-3.5" /> Dark Blue
            </button>
          </div>,
          document.body
        )}
    </>
  );
};

"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Sidebar } from './Sidebar';
import { MainContent } from './MainContent';
import { ChatPanel } from './ChatPanel';
import { SearchBar } from './SearchBar';
import { ChatHistoryProvider, useChatHistory } from './ChatHistoryContext';
import { ChatReturnNotification } from './ChatReturnNotification';
import { ProfileDropdown } from './ProfileDropdown';
import { backendApi } from '@/services/backendApi';
import { FilingSidebarProvider } from '../contexts/FilingSidebarContext';

export interface DashboardLayoutProps {
  className?: string;
}

const DashboardLayoutContent = ({
  className
}: DashboardLayoutProps) => {
  const navigate = useNavigate();
  const [selectedBackground, setSelectedBackground] = React.useState<string>('background5');

  // Load saved background on mount - check for custom uploaded background first
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      // Check for custom uploaded background (stored as data URL) - this is the default
      const customBg = localStorage.getItem('customUploadedBackground');
      if (customBg && customBg.startsWith('data:image')) {
        setSelectedBackground(customBg);
      } else {
        const saved = localStorage.getItem('dashboardBackground');
        if (saved) {
          setSelectedBackground(saved);
        }
      }
    }
  }, []);

  // Listen for background changes
  React.useEffect(() => {
    const handleBackgroundChange = (event: CustomEvent) => {
      setSelectedBackground(event.detail.backgroundId);
    };

    window.addEventListener('backgroundChanged', handleBackgroundChange as EventListener);
    return () => {
      window.removeEventListener('backgroundChanged', handleBackgroundChange as EventListener);
    };
  }, []);

  // Get background image URL based on selected background
  const getBackgroundImage = () => {
    // Check if it's a custom uploaded background (data URL)
    if (selectedBackground.startsWith('data:image')) {
      return selectedBackground;
    }

    const backgroundMap: { [key: string]: string } = {
      'background1': '/background1.png',
      'background2': '/background2.png',
      'background3': '/Background3.png',
      'background4': '/Background4.png',
      'background5': '/Background5.png',
      'background6': '/Background6.png',
      'velora-grass': '/VeloraGrassBackground.png',
    };
    return backgroundMap[selectedBackground] || '/Background5.png';
  };

  const [currentView, setCurrentView] = React.useState<string>('search');
  const [isChatPanelOpen, setIsChatPanelOpen] = React.useState<boolean>(false);
  const [isInChatMode, setIsInChatMode] = React.useState<boolean>(false);
  const [currentChatData, setCurrentChatData] = React.useState<any>(null);
  const [currentChatId, setCurrentChatId] = React.useState<string | null>(null);
  const currentChatIdRef = React.useRef<string | null>(null);
  const [hasPerformedSearch, setHasPerformedSearch] = React.useState(false);
  const [showChatNotification, setShowChatNotification] = React.useState(false);
  const [previousChatData, setPreviousChatData] = React.useState<any>(null);
  const [resetTrigger, setResetTrigger] = React.useState<number>(0);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState<boolean>(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = React.useState<boolean>(false);
  const [wasChatPanelOpenBeforeCollapse, setWasChatPanelOpenBeforeCollapse] = React.useState<boolean>(false);
  const [homeClicked, setHomeClicked] = React.useState<boolean>(false);
  const [isMapVisible, setIsMapVisible] = React.useState<boolean>(false);
  const { addChatToHistory, updateChatInHistory, getChatById } = useChatHistory();

  const handleViewChange = (viewId: string) => {
    // Show notification only if we're currently in chat mode and navigating away from it
    if (isInChatMode && previousChatData && (viewId !== 'search' && viewId !== 'home')) {
      setShowChatNotification(true);
    }
    
    // Always close chat panel when navigating to a different view, except upload
    if (viewId !== 'upload') {
      setIsChatPanelOpen(false);
    }
    
    // Special handling for home - reset everything to default state
    if (viewId === 'home') {
      setCurrentChatData(null);
      setCurrentChatId(null);
      currentChatIdRef.current = null;
      setPreviousChatData(null);
      setHasPerformedSearch(false);
      setResetTrigger(prev => prev + 1); // Trigger reset in SearchBar
      setHomeClicked(true); // Flag that home was clicked
      // Set view to search since home displays the search interface
      setCurrentView('search');
      return; // Exit early to prevent setting currentView again
    }
    
    
    // Always exit chat mode when navigating to a different view
    setCurrentView(viewId);
    setIsInChatMode(false);
    setCurrentChatData(null);
    
    // Force sidebar to be visible when entering upload view
    if (viewId === 'upload') {
      setIsSidebarCollapsed(false);
    }
  };

  const handleChatHistoryCreate = React.useCallback((chatData: any) => {
    // Create chat history only if none exists yet for this session
    if (chatData && chatData.query && !currentChatId && !currentChatIdRef.current) {
      setPreviousChatData(chatData);
      const newChatId = addChatToHistory({
        title: '',
        timestamp: new Date().toISOString(),
        preview: chatData.query,
        messages: chatData.messages || []
      });
      setCurrentChatId(newChatId);
      currentChatIdRef.current = newChatId;
    }
  }, [addChatToHistory, setPreviousChatData, currentChatId]);

  const handleChatModeChange = (inChatMode: boolean, chatData?: any) => {
    if (inChatMode) {
      setIsInChatMode(true);
      // Always auto-collapse sidebar when entering chat mode, regardless of view
      setIsSidebarCollapsed(true);
      // Close chat panel when entering chat mode
      setIsChatPanelOpen(false);
      if (chatData) {
        setCurrentChatData(chatData);
        setHasPerformedSearch(true);

        // If we don't have a chat yet, create it immediately (ChatGPT style)
        if (!currentChatIdRef.current) {
          const firstUserMessage = chatData.messages?.find((m: any) => m.role === 'user' || m.type === 'user');
          const preview = chatData.query || firstUserMessage?.content || firstUserMessage?.text || '';
          const newId = addChatToHistory({
            title: '',
            timestamp: new Date().toISOString(),
            preview,
            messages: chatData.messages || []
          });
          setCurrentChatId(newId);
          currentChatIdRef.current = newId;
          // Set previousChatData with chatId included
          setPreviousChatData({ ...chatData, chatId: newId });
        } else if (chatData.messages && chatData.messages.length > 0) {
          // Update existing chat with new messages
          updateChatInHistory(currentChatIdRef.current as string, chatData.messages);
        }
      }
    } else {
      // Exiting chat mode
      if (chatData) {
        // Only set previousChatData if we don't already have one (preserve original chat data)
        if (!previousChatData) {
          setPreviousChatData({ ...chatData, chatId: currentChatIdRef.current });
        }
      }
      
      // Show notification if we have chat data to store
      if (chatData && (chatData.query || chatData.messages?.length > 0)) {
        setShowChatNotification(true);
      }
      
      setIsInChatMode(false);
      setCurrentChatData(null);
    }
  };

  const handleChatPanelToggle = React.useCallback(() => {
    console.log('Toggling chat panel. Current state:', { isChatPanelOpen, hasPerformedSearch });
    setIsChatPanelOpen(prev => !prev);
  }, [isChatPanelOpen, hasPerformedSearch]);

  const handleChatSelect = React.useCallback((chatId: string) => {
    console.log('Selecting chat:', chatId);
    const chat = getChatById(chatId);
    if (chat) {
      setCurrentChatId(chatId);
      setCurrentChatData({
        query: chat.preview,
        messages: chat.messages
      });
      setIsInChatMode(true);
      setCurrentView('search');
      setIsChatPanelOpen(false);
      // Don't auto-collapse sidebar in upload view
      if (currentView !== 'upload') {
        setIsSidebarCollapsed(true); // Auto-collapse sidebar when entering chat
      }
    }
  }, [getChatById, currentView]);


  const handleSidebarToggle = React.useCallback(() => {
    // CRITICAL: This function should ONLY toggle sidebar state
    // It should NEVER call handleViewChange, setCurrentView, or trigger navigation
    // This is called by the toggle rail, NOT by navigation buttons
    
    console.log('🔘 handleSidebarToggle called - ONLY toggling sidebar, NOT navigating');
    
    // Allow toggle functionality in all views, including upload
    setIsSidebarCollapsed(prev => {
      const newCollapsed = !prev;
      
      if (newCollapsed) {
        // Collapsing sidebar - remember chat panel state and reset expanded state
        setWasChatPanelOpenBeforeCollapse(isChatPanelOpen);
        setIsSidebarExpanded(false); // Reset expanded state when collapsing
        // Close chat panel when collapsing
        setIsChatPanelOpen(false);
      } else {
        // Expanding sidebar - restore chat panel state
        setIsChatPanelOpen(wasChatPanelOpenBeforeCollapse);
      }
      
      return newCollapsed;
    });
    
    // EXPLICITLY DO NOT CALL:
    // - handleViewChange
    // - setCurrentView
    // - setHomeClicked
    // - Any navigation logic
  }, [isChatPanelOpen, wasChatPanelOpenBeforeCollapse]);

  const handleSidebarExpand = React.useCallback(() => {
    // Toggle expanded state (only works when sidebar is not collapsed)
    if (!isSidebarCollapsed) {
      setIsSidebarExpanded(prev => !prev);
    }
  }, [isSidebarCollapsed]);

  const handleNewChat = React.useCallback(() => {
    setCurrentChatId(null);
    currentChatIdRef.current = null;
    setCurrentChatData(null);
    setPreviousChatData(null); // Clear previous chat data when starting new chat
    setHasPerformedSearch(false);
    setIsInChatMode(true);
    setCurrentView('search');
    setIsChatPanelOpen(false);
    // Trigger reset in SearchBar
    setResetTrigger(prev => prev + 1);
    // Do NOT create chat history yet; wait for first submitted query
  }, [handleChatModeChange]);

  const handleReturnToChat = React.useCallback(() => {
    if (previousChatData) {
      setCurrentChatData(previousChatData);
      setIsInChatMode(true);
      setCurrentView('search');
      setShowChatNotification(false);
      // Restore the currentChatId if it was stored in previousChatData
      if (previousChatData.chatId) {
        setCurrentChatId(previousChatData.chatId);
        currentChatIdRef.current = previousChatData.chatId;
      }
    }
  }, [previousChatData]);

  const handleDismissNotification = React.useCallback(() => {
    setShowChatNotification(false);
    // Don't clear previousChatData - keep it for future returns
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }} 
      animate={{ opacity: 1, scale: 1 }} 
      transition={{ duration: 0.8, ease: [0.23, 1, 0.32, 1] }} 
      className={`flex h-screen w-full overflow-hidden relative border-l border-r border-t border-b border-[#e9edf1] ${className || ''}`}
      style={{ backgroundColor: 'transparent' }}
    >
      {/* Dashboard Background Image - Behind everything except search bar, logo, and recent projects */}
      {/* Hide when map view is active */}
      {!isMapVisible && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            // Use both 100vh and 100% to ensure full coverage across all browsers
            minHeight: '100vh',
            minWidth: '100vw',
            backgroundImage: `url(${getBackgroundImage()})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            // Removed backgroundAttachment: 'fixed' to prevent rendering issues and cut-off
            filter: 'blur(8px)', // Sharper, more pronounced blur effect
            WebkitFilter: 'blur(8px)', // Safari support
            zIndex: 0, // Base layer - everything else should be above
            pointerEvents: 'none', // Don't block interactions
            // Ensure background extends fully and renders properly
            transform: 'translateZ(0)', // Force hardware acceleration
            willChange: 'transform', // Optimize for performance
            // Ensure background covers entire viewport including any potential overflow
            margin: 0,
            padding: 0,
            boxSizing: 'border-box',
            // Ensure background always fills the viewport, even on resize
            overflow: 'hidden'
          }}
        />
      )}
      {/* Chat Return Notification */}
      <ChatReturnNotification
        isVisible={showChatNotification}
        chatData={previousChatData}
        onReturnToChat={handleReturnToChat}
        onDismiss={handleDismissNotification}
      />
      
      {/* Chat Panel - Only show when sidebar is NOT expanded (chat history shown in sidebar when expanded) */}
      {!isSidebarExpanded && (
      <ChatPanel 
        isOpen={isChatPanelOpen} 
        onToggle={handleChatPanelToggle} 
        onChatSelect={handleChatSelect} 
        onNewChat={handleNewChat}
        showChatHistory={true}
          isSmallSidebarMode={!isSidebarCollapsed && !isSidebarExpanded}
          sidebarWidth={(() => {
            // Calculate sidebar width based on state
            // In small sidebar mode, position chat panel directly against sidebar (no toggle rail gap) to remove grey line
            const TOGGLE_RAIL_WIDTH = 12; // w-3 = 12px
            let sidebarWidth = 0;
            
            if (isSidebarCollapsed) {
              sidebarWidth = 8; // w-2 = 8px
            } else if (isSidebarExpanded) {
              sidebarWidth = 320; // w-80 = 320px
            } else {
              // Normal state (small sidebar): position directly against sidebar to eliminate grey line
              if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
                sidebarWidth = 56; // lg:w-14 - no toggle rail gap
              } else {
                sidebarWidth = 40; // w-10 - no toggle rail gap
              }
            }
            
            // Only add toggle rail width when NOT in small sidebar mode
            if (isSidebarCollapsed || isSidebarExpanded) {
              return sidebarWidth + TOGGLE_RAIL_WIDTH;
            }
            return sidebarWidth;
          })()}
        />
      )}
      
      {/* Sidebar - with higher z-index when map is visible */}
      <Sidebar 
        onItemClick={handleViewChange} 
        onChatToggle={handleChatPanelToggle} 
        isChatPanelOpen={isChatPanelOpen} 
        activeItem={currentView}
        isCollapsed={isSidebarCollapsed}
        isExpanded={isSidebarExpanded}
        onToggle={handleSidebarToggle}
        onExpand={handleSidebarExpand}
        onNavigate={handleViewChange}
        onChatSelect={handleChatSelect}
        onNewChat={handleNewChat}
        isMapVisible={isMapVisible}
        onSignOut={async () => {
          try {
            const result = await backendApi.logout();
            if (result.success) {
              // Clear any local storage if needed
              localStorage.clear();
              // Redirect to login page
              navigate('/auth');
            } else {
              console.error('Logout failed:', result.error);
              // Still redirect even if logout API call fails
              navigate('/auth');
            }
          } catch (error) {
            console.error('Logout error:', error);
            // Still redirect on error
            navigate('/auth');
          }
        }}
      />
      
      {/* Main Content - with higher z-index when map is visible */}
      <MainContent 
        currentView={currentView} 
        onChatModeChange={handleChatModeChange}
        onChatHistoryCreate={handleChatHistoryCreate}
        currentChatData={currentChatData}
        currentChatId={currentChatId}
        isInChatMode={isInChatMode}
        resetTrigger={resetTrigger}
        onNavigate={handleViewChange}
        homeClicked={homeClicked}
        onHomeResetComplete={() => setHomeClicked(false)}
        onCloseSidebar={() => setIsSidebarCollapsed(true)}
        onRestoreSidebarState={(shouldBeCollapsed: boolean) => setIsSidebarCollapsed(shouldBeCollapsed)}
        getSidebarState={() => isSidebarCollapsed}
        isSidebarCollapsed={isSidebarCollapsed}
        onSidebarToggle={handleSidebarToggle}
        onMapVisibilityChange={setIsMapVisible}
      />
    </motion.div>
  );
};

export const DashboardLayout = (props: DashboardLayoutProps) => {
  return (
    <ChatHistoryProvider>
      <FilingSidebarProvider>
      <DashboardLayoutContent {...props} />
      </FilingSidebarProvider>
    </ChatHistoryProvider>
  );
};
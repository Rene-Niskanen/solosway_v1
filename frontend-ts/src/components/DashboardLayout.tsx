"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Sidebar } from './Sidebar';
import { MainContent } from './MainContent';
import { ChatPanel } from './ChatPanel';
import { SearchBar } from './SearchBar';
import { ChatHistoryProvider, useChatHistory } from './ChatHistoryContext';
import { ChatReturnNotification } from './ChatReturnNotification';
import { ProfileDropdown } from './ProfileDropdown';

export interface DashboardLayoutProps {
  className?: string;
}

const DashboardLayoutContent = ({
  className
}: DashboardLayoutProps) => {
  // Override body background when Dashboard component mounts
  React.useEffect(() => {
    const originalBodyStyle = document.body.style.background;
    const originalBodyBackgroundImage = document.body.style.backgroundImage;
    const originalBodyBackgroundColor = document.body.style.backgroundColor;
    const originalBodyAttachment = document.body.style.backgroundAttachment;
    const originalBodyClass = document.body.className;
    
    // Set body to white background and remove gradient
    document.body.style.background = '#ffffff';
    document.body.style.backgroundImage = 'none';
    document.body.style.backgroundColor = '#ffffff';
    document.body.style.backgroundAttachment = 'scroll'; // Override fixed attachment
    
    // Also override html element
    const htmlElement = document.documentElement;
    const originalHtmlBackground = htmlElement.style.background;
    const originalHtmlBackgroundColor = htmlElement.style.backgroundColor;
    htmlElement.style.background = '#ffffff';
    htmlElement.style.backgroundColor = '#ffffff';
    
    return () => {
      // Restore original body background when component unmounts
      document.body.style.background = originalBodyStyle;
      document.body.style.backgroundImage = originalBodyBackgroundImage;
      document.body.style.backgroundColor = originalBodyBackgroundColor;
      document.body.style.backgroundAttachment = originalBodyAttachment;
      document.body.className = originalBodyClass;
      htmlElement.style.background = originalHtmlBackground;
      htmlElement.style.backgroundColor = originalHtmlBackgroundColor;
    };
  }, []);

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
  const [wasChatPanelOpenBeforeCollapse, setWasChatPanelOpenBeforeCollapse] = React.useState<boolean>(false);
  const [homeClicked, setHomeClicked] = React.useState<boolean>(false);
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
        // Collapsing sidebar - remember chat panel state
        setWasChatPanelOpenBeforeCollapse(isChatPanelOpen);
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
      className={`flex h-screen w-full overflow-hidden relative bg-white border-l border-r border-t border-b border-[#e9edf1] ${className || ''}`}
      style={{ backgroundColor: '#ffffff' }}
    >
      {/* Chat Return Notification */}
      <ChatReturnNotification
        isVisible={showChatNotification}
        chatData={previousChatData}
        onReturnToChat={handleReturnToChat}
        onDismiss={handleDismissNotification}
      />
      
      {/* Chat Panel */}
      <ChatPanel 
        isOpen={isChatPanelOpen} 
        onToggle={handleChatPanelToggle} 
        onChatSelect={handleChatSelect} 
        onNewChat={handleNewChat}
        showChatHistory={true}
      />
      
      {/* Sidebar - with higher z-index when map is visible */}
      <Sidebar 
        onItemClick={handleViewChange} 
        onChatToggle={handleChatPanelToggle} 
        isChatPanelOpen={isChatPanelOpen} 
        activeItem={currentView}
        isCollapsed={isSidebarCollapsed}
        onToggle={handleSidebarToggle}
        onNavigate={handleViewChange}
        onSignOut={() => {
          // Handle sign out
          console.log('Sign out clicked');
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
      />
    </motion.div>
  );
};

export const DashboardLayout = (props: DashboardLayoutProps) => {
  return (
    <ChatHistoryProvider>
      <DashboardLayoutContent {...props} />
    </ChatHistoryProvider>
  );
};
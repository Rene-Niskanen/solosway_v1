"use client";

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Sidebar } from './Sidebar';
import { MainContent } from './MainContent';
import { ChatPanel } from './ChatPanel';
import { SearchBar } from './SearchBar';
import { ChatHistoryProvider, useChatHistory } from './ChatHistoryContext';
import { ChatReturnNotification } from './ChatReturnNotification';
import { ProfileDropdown } from './ProfileDropdown';
import { backendApi } from '@/services/backendApi';
import { FilingSidebarProvider, useFilingSidebar } from '../contexts/FilingSidebarContext';
import { ChatPanelProvider, useChatPanel } from '../contexts/ChatPanelContext';
import { ProjectsProvider } from '../contexts/ProjectsContext';
import { BrowserFullscreenProvider } from '../contexts/BrowserFullscreenContext';

export interface DashboardLayoutProps {
  className?: string;
}

const DashboardLayoutContent = ({
  className
}: DashboardLayoutProps) => {
  const navigate = useNavigate();
  const { closeSidebar: closeFilingSidebar } = useFilingSidebar();
  const { togglePanel: toggleChatPanel, closePanel: closeChatPanel, isOpen: isChatPanelOpen } = useChatPanel();
  const [selectedBackground, setSelectedBackground] = React.useState<string>('default-background');

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
        } else {
          // Set default background if nothing is saved
          setSelectedBackground('default-background');
          localStorage.setItem('dashboardBackground', 'default-background');
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
  // Returns null for default-background (which uses solid color instead)
  const getBackgroundImage = () => {
    // Check if it's a custom uploaded background (data URL)
    if (selectedBackground.startsWith('data:image')) {
      return selectedBackground;
    }

    // Default background uses solid color, not an image
    if (selectedBackground === 'default-background') {
      return null;
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
    return backgroundMap[selectedBackground] || null;
  };

  const [currentView, setCurrentView] = React.useState<string>('search');
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
  // Separate states for each button source to prevent conflicts
  const [isMapVisibleFromSidebar, setIsMapVisibleFromSidebar] = React.useState<boolean>(false);
  const [isMapVisibleFromChat, setIsMapVisibleFromChat] = React.useState<boolean>(false);
  // Computed final map visibility - map is visible if any source wants it visible
  const isMapVisible = isMapVisibleFromSidebar || isMapVisibleFromChat;
  const [hasActiveChat, setHasActiveChat] = React.useState<boolean>(false); // Track if there's an active chat query running
  const [shouldRestoreActiveChat, setShouldRestoreActiveChat] = React.useState<boolean>(false); // Signal to restore active chat
  const [shouldRestoreSelectedChat, setShouldRestoreSelectedChat] = React.useState<string | null>(null); // Signal to restore selected chat from agent sidebar
  const [isChatVisible, setIsChatVisible] = React.useState<boolean>(false); // Track if chat panel is visible
  const { addChatToHistory, updateChatInHistory, getChatById, updateChatStatus } = useChatHistory();

  const handleViewChange = (viewId: string) => {
    // Show notification only if we're currently in chat mode and navigating away from it
    if (isInChatMode && previousChatData && (viewId !== 'search' && viewId !== 'home')) {
      setShowChatNotification(true);
    }
    
    // Close agent sidebar when navigating to different sections
    if (viewId !== currentView) {
      closeChatPanel();
    }
    
    if (viewId !== 'upload') {
      setIsChatVisible(false); // Also clear chat visibility state
    }
    
    // Special handling for home - reset everything to default state and close all panels
    if (viewId === 'home') {
      // Clear all map visibility states
      setIsMapVisibleFromSidebar(false);
      setIsMapVisibleFromChat(false);
      
      setCurrentChatData(null);
      setCurrentChatId(null);
      currentChatIdRef.current = null;
      setPreviousChatData(null);
      setHasPerformedSearch(false);
      setResetTrigger(prev => prev + 1); // Trigger reset in SearchBar
      setHomeClicked(true); // Flag that home was clicked
      // Close agent sidebar when navigating to home
      closeChatPanel();
      setIsChatVisible(false); // Clear chat visibility state
      closeFilingSidebar(); // Close filing sidebar
      // Set view to search since home displays the search interface
      setCurrentView('search');
      return; // Exit early to prevent setting currentView again
    }
    
    
    // Always exit chat mode when navigating to a different view
    setCurrentView(viewId);
    setIsInChatMode(false);
    setCurrentChatData(null);
    
    // Hide map when navigating to views that don't show the map
    // Map should only be visible when explicitly opened via Map button or in search view
    // Views like 'projects', 'analytics', 'settings', etc. should hide the map
    if (viewId !== 'search') {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/1d8b42de-af74-4269-8506-255a4dc9510b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'DashboardLayout.tsx:150',message:'Non-search view - clearing sidebar map visibility',data:{viewId,isMapVisibleFromSidebar},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      setIsMapVisibleFromSidebar(false);
      // Don't clear chat map visibility - chat might still be active
    }
    
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
      // Don't close chat panel - user must use close button
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
    toggleChatPanel();
  }, [isChatPanelOpen, hasPerformedSearch, toggleChatPanel]);

  const handleChatSelect = React.useCallback((chatId: string) => {
    console.log('Selecting chat:', chatId);
    const chat = getChatById(chatId);
    if (chat) {
      // CRITICAL: Only update status if we're CERTAIN it's completed
      // Don't update if there's a loading message or if the last message is empty (still streaming)
      // This prevents marking running chats as completed when switching between them
      if (chat.status === 'loading' && chat.messages && Array.isArray(chat.messages)) {
        const hasLoadingMessage = chat.messages.some((m: any) => m.isLoading === true);
        const hasCompletedResponses = chat.messages.some((m: any) => 
          (m.role === 'assistant' || m.type === 'response') && 
          m.content && 
          m.content.trim().length > 0
        );
        const lastMessage = chat.messages[chat.messages.length - 1];
        const lastMessageIsEmpty = lastMessage && 
          (lastMessage.role === 'assistant' || lastMessage.type === 'response') &&
          (!lastMessage.content || lastMessage.content.trim().length === 0);
        
        // Only mark as completed if:
        // 1. No loading messages AND
        // 2. Has completed responses AND  
        // 3. Last message is not empty (not still streaming)
        if (!hasLoadingMessage && hasCompletedResponses && !lastMessageIsEmpty) {
          console.log('🔄 DashboardLayout: Updating stale loading status to completed when selecting chat:', chatId);
          updateChatStatus(chatId, 'completed');
        } else if (hasLoadingMessage || lastMessageIsEmpty) {
          console.log('🔄 DashboardLayout: Chat is still running, preserving loading status:', chatId, {
            hasLoadingMessage,
            lastMessageIsEmpty,
            hasCompletedResponses
          });
        }
      }
      
      // CRITICAL: Use immediate restoration pattern (similar to handleRestoreActiveChat)
      // Set these FIRST to prevent dashboard from showing
      setCurrentChatId(chatId);
      const chatData = {
        query: chat.preview,
        messages: chat.messages,
        chatId: chatId // Include chatId for restoration
      };
      setCurrentChatData(chatData);
      // CRITICAL: Set previousChatData so return-to-chat notification works when closing chat
      // This matches the behavior of the regular chat interface
      setPreviousChatData(chatData);
      setIsInChatMode(true);
      setCurrentView('search');
      
      // CRITICAL: Signal MainContent to restore immediately with fullscreen
      // Use a new signal similar to shouldRestoreActiveChat but for specific chat selection
      setShouldRestoreSelectedChat(chatId);
      
      // Clear signal after MainContent processes it
      setTimeout(() => setShouldRestoreSelectedChat(null), 500);
      
      // CRITICAL: Do NOT close chat panel - keep agent sidebar open when selecting a chat
      // closeChatPanel(); // REMOVED - allows viewing chat history while sidebar stays open
      // Don't auto-collapse sidebar in upload view
      if (currentView !== 'upload') {
        setIsSidebarCollapsed(true); // Auto-collapse sidebar when entering chat
      }
    }
  }, [getChatById, currentView, closeChatPanel, updateChatStatus]);


  const handleSidebarToggle = React.useCallback(() => {
    // CRITICAL: This function should ONLY toggle sidebar state
    // It should NEVER call handleViewChange, setCurrentView, or trigger navigation
    // This is called by the toggle rail, NOT by navigation buttons
    // IMPORTANT: This should NOT affect the agents sidebar (chat panel) - they are independent
    
    console.log('🔘 handleSidebarToggle called - ONLY toggling sidebar, NOT navigating');
    
    // Allow toggle functionality in all views, including upload
    setIsSidebarCollapsed(prev => {
      const newCollapsed = !prev;
      
      if (newCollapsed) {
        // Collapsing sidebar - reset expanded state
        setIsSidebarExpanded(false); // Reset expanded state when collapsing
        // DO NOT close chat panel - sidebar and agents sidebar are independent
      } else {
        // Expanding sidebar - no action needed, chat panel state is independent
      }
      
      return newCollapsed;
    });
    
    // EXPLICITLY DO NOT CALL:
    // - handleViewChange
    // - setCurrentView
    // - setHomeClicked
    // - closeChatPanel (sidebar and agents sidebar are independent)
    // - Any navigation logic
  }, []);

  const handleSidebarExpand = React.useCallback(() => {
    // Toggle expanded state (only works when sidebar is not collapsed)
    if (!isSidebarCollapsed) {
      setIsSidebarExpanded(prev => !prev);
    }
  }, [isSidebarCollapsed]);

  // Keyboard shortcut handler (Cmd/Ctrl + E) to toggle sidebar open/closed
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + E to toggle sidebar open/closed (not expand)
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        const target = e.target as HTMLElement;
        
        // Check if we're in an editable element (input, textarea, or contenteditable)
        const isEditable = 
          target.tagName === 'INPUT' || 
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          (target.closest && target.closest('[contenteditable="true"]'));
        
        // Only prevent default if we're not in an editable element
        if (!isEditable) {
          e.preventDefault();
          e.stopPropagation();
          
          // Toggle sidebar open/closed, but ensure it opens in normal (non-expanded) state
          if (isSidebarCollapsed) {
          // Opening sidebar - ensure it's not expanded
          setIsSidebarCollapsed(false);
          setIsSidebarExpanded(false);
          // Don't close chat panel - user must use close button
        } else {
          // Closing sidebar - collapse it
          setIsSidebarCollapsed(true);
          setIsSidebarExpanded(false);
          setWasChatPanelOpenBeforeCollapse(isChatPanelOpen);
          // Don't close chat panel - user must use close button
        }
        }
      }
    };

    // Use capture phase to ensure we catch the event early
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isSidebarCollapsed, isChatPanelOpen, closeChatPanel, toggleChatPanel]);

  // Ref to store MainContent's handler so we can call it
  const mainContentNewChatHandlerRef = React.useRef<(() => void) | null>(null);
  
  const handleNewChat = React.useCallback(() => {
    // Check if current chat has a running query
    const currentChat = currentChatId ? getChatById(currentChatId) : null;
    const hasRunningQuery = currentChat?.status === 'loading';
    
    if (hasRunningQuery) {
      // Running query exists - preserve chat ID in history
      // SideChatPanel will handle saving state and clearing UI
      // Don't clear currentChatId here - let SideChatPanel handle it
      // This allows the running query to continue updating its history entry
      console.log('🔄 DashboardLayout: New agent requested while query running:', {
        chatId: currentChatId,
        status: currentChat?.status
      });
      
      // CRITICAL: Keep hasPerformedSearch true so chat panel stays visible
      // This allows user to type and submit a new query while the other is running
      // Explicitly set to true to ensure panel is visible for new query input
      if (!hasPerformedSearch) {
        setHasPerformedSearch(true);
      }
    } else {
      // No running query - clear chat context as before
      setCurrentChatId(null);
      currentChatIdRef.current = null;
      // Only hide chat UI if there's no running query
      setHasPerformedSearch(false);
    }
    
    // Always clear UI state (query input, chat data)
    setCurrentChatData(null);
    setPreviousChatData(null);
    setIsInChatMode(true); // Stay in chat mode
    
    // Only change view if we're not already on search/home (to avoid unnecessary navigation)
    if (currentView !== 'search' && currentView !== 'home') {
      setCurrentView('search');
    }
    
    // CRITICAL: Do NOT close chat panel - sidebar should stay open to allow creating multiple agents
    // closeChatPanel(); // REMOVED - allows multiple agents to be created
    
    // Trigger reset in SearchBar
    setResetTrigger(prev => prev + 1);
    
    // CRITICAL: Also trigger MainContent's handler to clear SideChatPanel UI
    // This ensures the chat input is cleared and ready for a new query
    if (mainContentNewChatHandlerRef.current) {
      console.log('🔄 DashboardLayout: Calling MainContent onNewChat handler');
      mainContentNewChatHandlerRef.current();
    }
    
    // Do NOT create chat history yet; wait for first submitted query
  }, [handleChatModeChange, currentView, currentChatId, getChatById, hasPerformedSearch]);

  // Handler to restore active chat from sidebar (re-engage with running chat)
  const handleRestoreActiveChat = React.useCallback(() => {
    console.log('🔄 DashboardLayout: Opening chat', { hasActiveChat, currentView });
    
    // CRITICAL: Always set these FIRST to prevent dashboard from showing
    // Set the signal immediately BEFORE any other state changes
    setShouldRestoreActiveChat(true);
    // Set chat map visibility - chat needs map visible
    setIsMapVisibleFromChat(true);
    // Set chat mode immediately (MUST be set before view change)
    setIsInChatMode(true);
    // MainContent will set hasPerformedSearch to true when it receives shouldRestoreActiveChat
    
    // CRITICAL: Always ensure we're on search view to show chat (never dashboard)
    // Even if already on search/home, explicitly set it to ensure proper state
    setCurrentView('search');
    
    if (hasActiveChat) {
      // There's an active chat - restore it
      console.log('🔄 DashboardLayout: Restoring active chat');
      // Clear the signal after MainContent has processed it (increased timeout to ensure state updates complete)
      // MainContent sets isTransitioningToChatRef which prevents dashboard flash during transition
      setTimeout(() => setShouldRestoreActiveChat(false), 500);
    } else {
      // No active chat - create a new one
      console.log('🔄 DashboardLayout: Creating new chat');
      // Clear the signal after MainContent has processed it (increased timeout to ensure state updates complete)
      // MainContent sets isTransitioningToChatRef which prevents dashboard flash during transition
      setTimeout(() => setShouldRestoreActiveChat(false), 500);
      // Also reset chat state for a fresh start
      setCurrentChatId(null);
      currentChatIdRef.current = null;
      setCurrentChatData(null);
      setPreviousChatData(null);
      setResetTrigger(prev => prev + 1); // Trigger reset in SearchBar
    }
  }, [hasActiveChat, currentView]);
  
  // Callback from MainContent when active chat state changes
  const handleActiveChatChange = React.useCallback((isActive: boolean) => {
    setHasActiveChat(isActive);
  }, []);
  
  // Callback from MainContent when chat panel visibility changes
  const handleChatVisibilityChange = React.useCallback((isVisible: boolean) => {
    setIsChatVisible(isVisible);
  }, []);

  // Callback from MainContent when map visibility changes (e.g., when Dashboard button is clicked)
  const handleMapVisibilityChange = React.useCallback((isVisible: boolean) => {
    if (!isVisible) {
      // User clicked Dashboard button - clear both map visibility sources
      setIsMapVisibleFromSidebar(false);
      setIsMapVisibleFromChat(false);
    }
  }, []);

  // Callback to navigate to dashboard - directly triggers same logic as handleViewChange('home')
  // This ensures SearchBar Dashboard button works synchronously like Sidebar Dashboard button
  const handleNavigateToDashboard = React.useCallback(() => {
    // Clear all map visibility states
    setIsMapVisibleFromSidebar(false);
    setIsMapVisibleFromChat(false);
    
    setCurrentChatData(null);
    setCurrentChatId(null);
    currentChatIdRef.current = null;
    setPreviousChatData(null);
    setHasPerformedSearch(false);
    setResetTrigger(prev => prev + 1); // Trigger reset in SearchBar
    setHomeClicked(true); // Flag that home was clicked
    // Close agent sidebar when navigating to dashboard
    closeChatPanel();
    setIsChatVisible(false); // Clear chat visibility state
    closeFilingSidebar(); // Close filing sidebar
    // Set view to search since home displays the search interface
    setCurrentView('search');
  }, [closeFilingSidebar, closeChatPanel]);

  // Handler to open map view from sidebar
  const handleMapToggle = React.useCallback(() => {
    console.log('🗺️ DashboardLayout: Opening map view from sidebar');
    // CRITICAL: Clear homeClicked flag first to prevent MainContent from resetting map
    // This ensures that if homeClicked was set from a previous action, it won't interfere
    setHomeClicked(false);
    // CRITICAL: Exit chat mode FIRST to close fullscreen chat before setting map visibility
    // This ensures that when map becomes visible, the fullscreen chat is already closed
    setIsInChatMode(false);
    // CRITICAL: Clear chat restoration flag to prevent MainContent from blocking map render
    setShouldRestoreActiveChat(false);
    // CRITICAL: Set map visibility BEFORE changing view to prevent view change effect from clearing it
    // The view change effect checks externalIsMapVisible, so we must set it first
    // Always set to true - the effect in MainContent will close fullscreen chat when isInChatMode becomes false
    setIsMapVisibleFromSidebar(true);
    // Clear chat map visibility when sidebar map button is clicked
    setIsMapVisibleFromChat(false);
    // CRITICAL: Set view to search AFTER map visibility is set
    // This ensures that when the view change effect runs, externalIsMapVisible is already true
    // If already in search view, this is a no-op, but ensures consistency
    setCurrentView('search');
    // Clear chat state (already exited chat mode above)
    setCurrentChatData(null);
    // Clear previous chat data to prevent any restoration attempts
    setPreviousChatData(null);
    // Close agent sidebar when navigating to map
    closeChatPanel();
    setIsChatVisible(false);
  }, [isMapVisibleFromSidebar, isMapVisibleFromChat, closeChatPanel]);

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
    <div 
      className={`flex h-screen w-full overflow-hidden relative border-l border-r border-t border-b border-[#e9edf1] ${className || ''}`}
      style={{ backgroundColor: 'transparent', boxShadow: 'none' }}
    >
      {/* Dashboard Background - Behind everything except search bar, logo, and recent projects */}
      {/* Hide when map view is active */}
      {!isMapVisible && (() => {
        const backgroundImage = getBackgroundImage();
        const isDefaultBackground = selectedBackground === 'default-background' || !backgroundImage;
        
        return (
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
              // Use solid color for default background, image for others
              backgroundColor: isDefaultBackground ? '#FCFCF9' : undefined,
              backgroundImage: backgroundImage ? `url(${backgroundImage})` : undefined,
              backgroundSize: backgroundImage ? 'cover' : undefined,
              backgroundPosition: backgroundImage ? 'center' : undefined,
              backgroundRepeat: backgroundImage ? 'no-repeat' : undefined,
              // Only apply blur to image backgrounds, not solid colors
              filter: backgroundImage ? 'blur(8px)' : undefined,
              WebkitFilter: backgroundImage ? 'blur(8px)' : undefined,
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
        );
      })()}
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
          onChatSelect={handleChatSelect} 
          onNewChat={handleNewChat}
          showChatHistory={true}
          sidebarWidth={isSidebarCollapsed ? 0 : 224} // 0px when collapsed, 224px when normal
          selectedChatId={currentChatId}
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
        hasActiveChat={hasActiveChat}
        onRestoreActiveChat={handleRestoreActiveChat}
        isChatVisible={isChatVisible}
        onMapToggle={handleMapToggle}
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
        onNewChat={(handler) => {
          // MainContent calls this with its handleNewChatInternal
          // Store it so we can call it from handleNewChat
          if (handler && typeof handler === 'function') {
            mainContentNewChatHandlerRef.current = handler;
          }
        }}
        onNavigate={handleViewChange}
        homeClicked={homeClicked}
        onHomeResetComplete={() => setHomeClicked(false)}
        onCloseSidebar={() => setIsSidebarCollapsed(true)}
        onRestoreSidebarState={(shouldBeCollapsed: boolean) => setIsSidebarCollapsed(shouldBeCollapsed)}
        getSidebarState={() => isSidebarCollapsed}
        isSidebarCollapsed={isSidebarCollapsed}
        isSidebarExpanded={isSidebarExpanded}
        onSidebarToggle={handleSidebarToggle}
        onActiveChatChange={handleActiveChatChange}
        shouldRestoreActiveChat={shouldRestoreActiveChat}
        shouldRestoreSelectedChat={shouldRestoreSelectedChat}
        onChatVisibilityChange={handleChatVisibilityChange}
        onOpenChatHistory={handleChatPanelToggle}
        onMapVisibilityChange={handleMapVisibilityChange}
        onNavigateToDashboard={handleNavigateToDashboard}
        externalIsMapVisible={isMapVisible}
      />
    </div>
  );
};

export const DashboardLayout = (props: DashboardLayoutProps) => {
  return (
    <ChatHistoryProvider>
      <FilingSidebarProvider>
        <ChatPanelProvider>
          <ProjectsProvider>
            <BrowserFullscreenProvider>
              <DashboardLayoutContent {...props} />
            </BrowserFullscreenProvider>
          </ProjectsProvider>
        </ChatPanelProvider>
      </FilingSidebarProvider>
    </ChatHistoryProvider>
  );
};
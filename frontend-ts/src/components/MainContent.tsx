"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SearchBar } from './SearchBar';
import ChatInterface from './ChatInterface';
import PropertyValuationUpload from './PropertyValuationUpload';
import Analytics from './Analytics';
import { CloudBackground } from './CloudBackground';
import FlowBackground from './FlowBackground';
import DotGrid from './DotGrid';
import { PropertyOutlineBackground } from './PropertyOutlineBackground';
import { Property3DBackground } from './Property3DBackground';
import { PropertyCyclingBackground } from './PropertyCyclingBackground';
import { SquareMap, SquareMapRef } from './SquareMap';
import Profile from './Profile';
import { FileManager } from './FileManager';
import { useSystem } from '@/contexts/SystemContext';
import { backendApi } from '@/services/backendApi';

// Map location configuration
const MAP_LOCATIONS = {
  london: {
    name: 'London',
    coordinates: [-0.1276, 51.5074] as [number, number],
    zoom: 10.5
  },
  bristol: {
    name: 'Bristol',
    coordinates: [-2.5879, 51.4545] as [number, number],
    zoom: 10.5
  }
};

const DEFAULT_MAP_LOCATION_KEY = 'defaultMapLocation';

// Map Location Selector Component
const MapLocationSelector: React.FC = () => {
  const [selectedLocation, setSelectedLocation] = React.useState<string>(() => {
    // Load from localStorage or default to London
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(DEFAULT_MAP_LOCATION_KEY);
      return saved || 'london';
    }
    return 'london';
  });

  const handleLocationChange = (location: string) => {
    setSelectedLocation(location);
    if (typeof window !== 'undefined') {
      localStorage.setItem(DEFAULT_MAP_LOCATION_KEY, location);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(MAP_LOCATIONS).map(([key, location]) => (
          <motion.button
            key={key}
            onClick={() => handleLocationChange(key)}
            className={`p-4 rounded-lg border-2 transition-all ${
              selectedLocation === key
                ? 'border-blue-500 bg-blue-50'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="text-left">
              <div className={`font-semibold mb-1 ${
                selectedLocation === key ? 'text-blue-700' : 'text-slate-700'
              }`}>
                {location.name}
              </div>
              <div className="text-xs text-slate-500">
                {location.coordinates[1].toFixed(4)}, {location.coordinates[0].toFixed(4)}
              </div>
            </div>
            {selectedLocation === key && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="mt-2 text-blue-600 text-sm font-medium"
              >
                ✓ Selected
              </motion.div>
            )}
          </motion.button>
        ))}
      </div>
      <p className="text-xs text-slate-500 mt-2">
        Your selection will be applied the next time you open the map.
      </p>
    </div>
  );
};
export interface MainContentProps {
  className?: string;
  currentView?: string;
  onChatModeChange?: (inChatMode: boolean, chatData?: any) => void;
  onChatHistoryCreate?: (chatData: any) => void;
  currentChatData?: {
    query: string;
    messages: any[];
    timestamp: Date;
    isFromHistory?: boolean;
  } | null;
  currentChatId?: string | null;
  isInChatMode?: boolean;
  resetTrigger?: number;
  onNavigate?: (view: string, options?: { showMap?: boolean }) => void;
  homeClicked?: boolean;
  onHomeResetComplete?: () => void;
}
export const MainContent = ({
  className,
  currentView = 'search',
  onChatModeChange,
  onChatHistoryCreate,
  currentChatData,
  currentChatId,
  isInChatMode: inChatMode = false,
  resetTrigger: parentResetTrigger,
  onNavigate,
  homeClicked = false,
  onHomeResetComplete
}: MainContentProps) => {
  const { addActivity } = useSystem();
  const [chatQuery, setChatQuery] = React.useState<string>("");
  const [chatMessages, setChatMessages] = React.useState<any[]>([]);
  const [resetTrigger, setResetTrigger] = React.useState<number>(0);
  const [currentLocation, setCurrentLocation] = React.useState<string>("");
  const [isMapVisible, setIsMapVisible] = React.useState<boolean>(false);
  const [mapSearchQuery, setMapSearchQuery] = React.useState<string>("");
  const [hasPerformedSearch, setHasPerformedSearch] = React.useState<boolean>(false);
  const [userData, setUserData] = React.useState<any>(null);
  const mapRef = React.useRef<SquareMapRef>(null);
  
  // Use the prop value for chat mode
  const isInChatMode = inChatMode;

  // Fetch user data on mount
  React.useEffect(() => {
    const fetchUserData = async () => {
      try {
        const authResult = await backendApi.checkAuth();
        if (authResult.success && authResult.data?.user) {
          setUserData(authResult.data.user);
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
      }
    };
    fetchUserData();
  }, []);

  const handleMapToggle = () => {
    console.log('🗺️ MainContent handleMapToggle called!', { 
      currentState: isMapVisible,
      willChangeTo: !isMapVisible 
    });
    setIsMapVisible(prev => !prev);
  };

  const handleQueryStart = (query: string) => {
    console.log('MainContent: Query started with:', query);
    
    // Track search activity but DON'T create chat history yet
    addActivity({
      action: `User initiated search: "${query}"`,
      documents: [],
      type: 'search',
      details: { searchTerm: query, timestamp: new Date().toISOString() }
    });
    
    // Don't create chat history until query is actually submitted
  };

  const handleLocationUpdate = (location: { lat: number; lng: number; address: string }) => {
    console.log('Location updated:', location);
    setCurrentLocation(location.address);
    
    // Track location activity
    addActivity({
      action: `Location selected: ${location.address}`,
      documents: [],
      type: 'search',
      details: { 
        latitude: location.lat,
        longitude: location.lng,
        address: location.address,
        searchType: 'location-based',
        timestamp: new Date().toISOString() 
      }
    });
  };

  const handleNavigate = (view: string, options?: { showMap?: boolean }) => {
    if (options?.showMap) {
      setIsMapVisible(true);
    }
    onNavigate?.(view, options);
  };

  const handleSearch = (query: string) => {
    console.log('MainContent: Search submitted with query:', query);
    
    // Always update map search query
    setMapSearchQuery(query);
    
    // If map is visible, only search on the map, don't enter chat
    if (isMapVisible) {
      console.log('Map search only - not entering chat mode');
      // Mark that user has performed a search in map mode
      setHasPerformedSearch(true);
      return;
    }
    
    // Normal chat search when map is not visible
    setChatQuery(query);
    setChatMessages([]); // Reset messages for new chat

    // Check if query contains location-related keywords
    const locationKeywords = ['near', 'in', 'around', 'at', 'properties in', 'houses in', 'homes in'];
    const isLocationQuery = locationKeywords.some(keyword => 
      query.toLowerCase().includes(keyword.toLowerCase())
    );

    // Track detailed search activity
    addActivity({
      action: `Advanced search initiated: "${query}" - Velora is analyzing relevant documents`,
      documents: [],
      type: 'search',
      details: { 
        searchQuery: query, 
        analysisType: 'comprehensive',
        isLocationBased: isLocationQuery,
        timestamp: new Date().toISOString() 
      }
    });

    // NOW create the chat history when query is actually submitted
    const chatData = {
      query,
      messages: [],
      timestamp: new Date()
    };
    
    // Create chat history first
    onChatHistoryCreate?.(chatData);
    
    // Then enter chat mode
    onChatModeChange?.(true, chatData);
  };
  const handleBackToSearch = () => {
    // Store current chat data before clearing for potential notification
    if (chatQuery || chatMessages.length > 0) {
      const chatDataToStore = {
        query: chatQuery,
        messages: chatMessages,
        timestamp: new Date()
      };
      // Pass the chat data one final time before exiting
      onChatModeChange?.(false, chatDataToStore);
    } else {
      onChatModeChange?.(false);
    }
    
    setChatQuery('');
    setChatMessages([]);
  };
  const handleChatMessagesUpdate = (messages: any[]) => {
    setChatMessages(messages);
    
    // Track chat interaction activity
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      addActivity({
        action: `Velora generated response for query: "${chatQuery}" - Analysis complete`,
        documents: [],
        type: 'analysis',
        details: { 
          messageCount: messages.length,
          responseType: lastMessage?.type || 'text',
          timestamp: new Date().toISOString()
        }
      });
    }
    
    // Update the chat data in parent component
    if (chatQuery) {
      const chatData = {
        query: chatQuery,
        messages,
        timestamp: new Date()
      };
      onChatModeChange?.(true, chatData);
    }
  };

  // Track previous view to detect actual navigation changes
  const prevViewRef = React.useRef<string>(currentView);
  
  // Reset chat mode and map visibility when currentView changes (sidebar navigation)
  // IMPORTANT: This should ONLY trigger on actual navigation, NOT on sidebar toggle
  React.useEffect(() => {
    const prevView = prevViewRef.current;
    const isActualNavigation = prevView !== currentView;
    prevViewRef.current = currentView;
    
    // Only reset if we're actually navigating to a different view
    // Don't reset if we're already on search view (e.g., just toggling sidebar)
    if (currentView !== 'search' && currentView !== 'home') {
      setChatQuery("");
      setChatMessages([]);
      // Let the parent handle chat mode changes
      onChatModeChange?.(false);
    }
    // When navigating to search view (via home button), hide the map
    // BUT: Only hide map if we're actually navigating FROM a different view
    // Don't hide map if we're already on search view (e.g., just toggling sidebar)
    // This prevents the map from being hidden when just toggling the sidebar
    if (currentView === 'search' && isActualNavigation && prevView !== 'search') {
      // Only hide map if we're actually navigating FROM a different view TO search
      // This prevents hiding the map when just toggling sidebar on map view
      setIsMapVisible(false);
      setMapSearchQuery("");
      setHasPerformedSearch(false);
    }
  }, [currentView, onChatModeChange]);

  // Special handling for home view - reset everything to default state
  React.useEffect(() => {
    if (homeClicked) {
      console.log('🏠 Home clicked - resetting map and state');
      setChatQuery("");
      setChatMessages([]);
      setCurrentLocation("");
      setIsMapVisible(false); // Explicitly hide map when home is clicked
      setMapSearchQuery("");
      setHasPerformedSearch(false);
      onChatModeChange?.(false);
      onHomeResetComplete?.(); // Notify parent that reset is complete
    }
  }, [homeClicked, onChatModeChange, onHomeResetComplete]);

  // Reset SearchBar when switching to chat mode or creating new chat
  React.useEffect(() => {
    if (isInChatMode && currentChatData?.query) {
      setResetTrigger(prev => prev + 1);
    }
  }, [isInChatMode, currentChatData]);

  // Reset from parent trigger (new chat created)
  React.useEffect(() => {
    if (parentResetTrigger !== undefined) {
      setResetTrigger(prev => prev + 1);
    }
  }, [parentResetTrigger]);
  const renderViewContent = () => {
    switch (currentView) {
      case 'home':
      case 'search':
        return <AnimatePresence mode="wait">
            {isInChatMode ? <motion.div key="chat" initial={{
            opacity: 0
          }} animate={{
            opacity: 1
          }} exit={{
            opacity: 0
          }} transition={{
            duration: 0.3,
            ease: [0.23, 1, 0.32, 1]
          }} className="w-full h-full flex flex-col relative">
                {/* Interactive Dot Grid Background for chat mode */}
                {/* No background needed here as it's handled globally */}
                
                
                 {/* Chat Interface with elevated z-index */}
                <div className="relative z-10 w-full h-full">
                  <ChatInterface 
                    key={`chat-${currentChatId || 'new'}`}
                    initialQuery={currentChatData?.query || ""} 
                    onBack={handleBackToSearch} 
                    onMessagesUpdate={handleChatMessagesUpdate}
                    loadedMessages={currentChatData?.messages}
                    isFromHistory={currentChatData?.isFromHistory}
                  />
                </div>
              </motion.div> : <motion.div key="search" initial={{
            opacity: 0
          }} animate={{
            opacity: 1
          }} exit={{
            opacity: 0
          }} transition={{
            duration: 0.3,
            ease: [0.23, 1, 0.32, 1]
          }} className="flex flex-col items-center justify-start flex-1 relative pt-32">
                {/* Interactive Dot Grid Background */}
                {/* No background needed here as it's handled globally */}
                
                {/* VELORA Branding Section */}
                <div className="flex flex-col items-center mb-12">
                  {/* VELORA Logo */}
                  <img 
                    src="/VELORA (new) .png" 
                    alt="VELORA" 
                    className="max-w-[280px] h-auto mb-6"
                    style={{ maxHeight: '120px' }}
                    onLoad={() => {
                      console.log('✅ VELORA logo loaded successfully');
                    }}
                    onError={(e) => {
                      console.error('❌ VELORA logo failed to load:', e.currentTarget.src);
                      // Try URL-encoded version if direct path fails
                      const img = e.target as HTMLImageElement;
                      const currentSrc = img.src;
                      
                      // If direct path failed, try URL-encoded version
                      if (!currentSrc.includes('%20')) {
                        const encodedPath = '/VELORA%20(new)%20.png';
                        console.log(`🔄 Trying URL-encoded path: ${encodedPath}`);
                        img.src = encodedPath;
                      } else {
                        // If all attempts fail, hide the image
                        console.error('❌ VELORA logo failed to load with all attempts.');
                        img.style.display = 'none';
                      }
                    }}
                  />
                  
                  {/* Dynamic Welcome Message */}
                  {(() => {
                    const getUserName = () => {
                      if (userData?.first_name) {
                        return userData.first_name;
                      }
                      if (userData?.email) {
                        // Extract name from email (e.g., "user@example.com" → "user")
                        const emailPrefix = userData.email.split('@')[0];
                        // Capitalize first letter
                        return emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
                      }
                      return '';
                    };
                    const userName = getUserName();
                    return userName ? (
                      <p className="text-slate-500 text-sm mb-12 text-center">
                        Welcome back {userName}, your workspace is synced and ready for your next move
                      </p>
                    ) : (
                      <p className="text-slate-500 text-sm mb-12 text-center">
                        Welcome back, your workspace is synced and ready for your next move
                      </p>
                    );
                  })()}
                </div>
                
                {/* Unified Search Bar - adapts based on context */}
                <SearchBar 
                  onSearch={handleSearch} 
                  onQueryStart={handleQueryStart} 
                  onMapToggle={handleMapToggle}
                  resetTrigger={resetTrigger}
                  isMapVisible={isMapVisible}
                  isInChatMode={isInChatMode}
                  currentView={currentView}
                  hasPerformedSearch={hasPerformedSearch}
                />
                
                {/* Full Screen Map */}
                <SquareMap
                  ref={mapRef}
                  isVisible={isMapVisible}
                  searchQuery={mapSearchQuery}
                  hasPerformedSearch={hasPerformedSearch}
                  onLocationUpdate={(location) => {
                    setCurrentLocation(location.address);
                  }}
                />
              </motion.div>}
          </AnimatePresence>;
      case 'notifications':
        return <div className="w-full max-w-none">
            <FileManager />
          </div>;
      case 'profile':
        return <div className="w-full max-w-none">
            <Profile onNavigate={handleNavigate} />
          </div>;
      case 'analytics':
        return <div className="w-full max-w-none">
            <Analytics />
          </div>;
      case 'upload':
        return <div className="flex-1 h-full">
            <PropertyValuationUpload onUpload={file => console.log('File uploaded:', file.name)} onContinueWithReport={() => console.log('Continue with report clicked')} />
          </div>;
      case 'settings':
        return <div className="w-full h-full flex items-center justify-center px-6">
            <motion.div 
              initial={{
                opacity: 0,
                y: 20
              }} 
              animate={{
                opacity: 1,
                y: 0
              }} 
              transition={{
                duration: 0.6,
                ease: [0.23, 1, 0.32, 1]
              }} 
              className="bg-white/90 backdrop-blur-xl rounded-3xl p-8 border-2 border-slate-200/60 shadow-[0_8px_32px_rgba(0,0,0,0.08)] max-w-2xl w-full"
            >
              <div className="w-16 h-16 bg-gradient-to-br from-slate-50 to-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-6 border-2 border-slate-200/60">
                <span className="text-2xl">⚙️</span>
              </div>
              <h2 className="text-2xl font-semibold text-slate-800 mb-2 tracking-tight text-center">
                Settings
              </h2>
              <p className="text-slate-600 leading-relaxed font-medium text-center mb-8">
                Customize your experience and configure your preferences.
              </p>
              
              {/* Map Location Settings */}
              <div className="space-y-4">
                <div className="border border-slate-200 rounded-xl p-6 bg-white/50">
                  <h3 className="text-lg font-semibold text-slate-800 mb-2 flex items-center gap-2">
                    <span>🗺️</span>
                    Default Map Location
                  </h3>
                  <p className="text-sm text-slate-600 mb-4">
                    Choose where the map opens when you first view it.
                  </p>
                  <MapLocationSelector />
                </div>
              </div>
            </motion.div>
          </div>;
      default:
        return <div className="flex items-center justify-center flex-1 relative">
            {/* Interactive Dot Grid Background */}
            {/* No background needed here as it's handled globally */}
            
            
            {/* Unified Search Bar - adapts based on context */}
            <SearchBar 
              onSearch={handleSearch} 
              onQueryStart={handleQueryStart} 
              onMapToggle={handleMapToggle}
              resetTrigger={resetTrigger}
              isMapVisible={isMapVisible}
              isInChatMode={isInChatMode}
              currentView={currentView}
              hasPerformedSearch={hasPerformedSearch}
            />
          </div>;
    }
  };
  return <div className={`flex-1 relative bg-white ${className || ''}`} style={{ backgroundColor: '#ffffff', position: 'relative', zIndex: 1 }}>
      {/* Background based on current view - Hidden to show white background */}
      {/* Background components commented out to show white background */}
      
      {/* Content container - white background */}
      <div className={`relative h-full flex flex-col ${
        isInChatMode 
          ? 'bg-white' 
          : currentView === 'upload' 
            ? 'bg-white' 
            : currentView === 'analytics'
              ? 'bg-white'
              : currentView === 'profile'
                ? 'bg-white'
                : currentView === 'notifications'
                  ? 'bg-white'
                  : 'bg-white'
      } ${isInChatMode ? 'p-0' : currentView === 'upload' ? 'p-8' : currentView === 'analytics' ? 'p-4' : currentView === 'profile' ? 'p-0' : currentView === 'notifications' ? 'p-0' : 'p-8 lg:p-16'}`} style={{ backgroundColor: '#ffffff' }}>
        <div className={`relative w-full ${
          isInChatMode 
            ? 'h-full w-full' 
            : currentView === 'upload' ? 'h-full' 
            : currentView === 'analytics' ? 'h-full overflow-hidden'
            : currentView === 'profile' ? 'h-full w-full'
            : currentView === 'notifications' ? 'h-full w-full'
            : 'max-w-5xl mx-auto'
        } flex-1 flex flex-col`}>
          <motion.div initial={{
          opacity: 1,
          y: 20
        }} animate={{
          opacity: 1,
          y: 0
        }} transition={{
          duration: 0.6,
          ease: [0.23, 1, 0.32, 1],
          delay: 0.1
        }} className={`relative flex-1 flex flex-col overflow-hidden`}>{renderViewContent()}
          </motion.div>
        </div>
      </div>
      
      {/* Search Bar positioning is now handled internally by the SearchBar component */}
    </div>;
  };
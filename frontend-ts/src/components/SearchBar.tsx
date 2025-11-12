"use client";

import * as React from "react";
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Map, ArrowUp, LayoutDashboard } from "lucide-react";
import { ImageUploadButton } from './ImageUploadButton';

export interface SearchBarProps {
  className?: string;
  onSearch?: (query: string) => void;
  onQueryStart?: (query: string) => void;
  onMapToggle?: () => void;
  resetTrigger?: number;
  // Context-aware props
  isMapVisible?: boolean;
  isInChatMode?: boolean;
  currentView?: string;
  hasPerformedSearch?: boolean;
}

export const SearchBar = ({
  className,
  onSearch,
  onQueryStart,
  onMapToggle,
  resetTrigger,
  isMapVisible = false,
  isInChatMode = false,
  currentView = 'search',
  hasPerformedSearch = false
}: SearchBarProps) => {
  const [searchValue, setSearchValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [hasStartedTyping, setHasStartedTyping] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryStartTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Context-aware configuration
  const getContextConfig = () => {
    if (isMapVisible) {
      return {
        placeholder: "Search for properties...",
        showMapToggle: true, // Always show map toggle
        showMic: true, // Show paperclip icon in map view too
        position: "bottom", // Always bottom when map is visible
        glassmorphism: true,
        maxWidth: '100vw', // Full width for map mode
        greenGlow: true, // Add green glow for map mode
        isSquare: false // Keep rounded for map mode
      };
    } else if (isInChatMode) {
      return {
        placeholder: "Ask anything...",
        showMapToggle: true,
        showMic: true,
        position: "center", // Always center
        glassmorphism: false,
        maxWidth: '600px', // Narrower for chat mode
        greenGlow: false,
        isSquare: false // Keep rounded for chat mode
      };
    } else {
      // Dashboard view - square corners
      return {
        placeholder: "What can I help you find today?",
        showMapToggle: true,
        showMic: true,
        position: "center", // Always center
        glassmorphism: false,
        maxWidth: '600px', // Narrower for opening search page
        greenGlow: false,
        isSquare: true // Square corners for dashboard view
      };
    }
  };

  const contextConfig = getContextConfig();
  
  // Auto-focus on any keypress for search bar - but only when hovered
  useEffect(() => {
    if (!isHovered) return; // Only add listener when search bar is hovered
    
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Don't interfere with form inputs, buttons, or modifier keys
      if (e.target instanceof HTMLInputElement || 
          e.target instanceof HTMLTextAreaElement || 
          e.target instanceof HTMLButtonElement ||
          e.ctrlKey || e.metaKey || e.altKey || 
          e.key === 'Tab' || e.key === 'Escape') {
        return;
      }
      
      // Focus the search input
      if (inputRef.current) {
        inputRef.current.focus();
      }
    };
    
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isHovered]);

  // Reset when resetTrigger changes
  useEffect(() => {
    if (resetTrigger !== undefined) {
      setSearchValue('');
      setIsSubmitted(false);
      setHasStartedTyping(false);
      setIsFocused(false);
      // Clear any pending query start calls
      if (queryStartTimeoutRef.current) {
        clearTimeout(queryStartTimeoutRef.current);
        queryStartTimeoutRef.current = null;
      }
    }
  }, [resetTrigger]);
  
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (queryStartTimeoutRef.current) {
        clearTimeout(queryStartTimeoutRef.current);
      }
    };
  }, []);

  // Auto-focus on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitted = searchValue.trim();
    if (submitted && !isSubmitted) {
      setIsSubmitted(true);
      
      onSearch?.(submitted);
      
      // Reset the search bar state after submission
      setTimeout(() => {
        setSearchValue('');
        setIsSubmitted(false);
        setHasStartedTyping(false);
      }, 100);
    }
  };
  
  return (
    <motion.div 
      className={`${className || ''} ${
        contextConfig.position === "bottom" 
          ? "fixed bottom-5 left-1/2 transform -translate-x-1/2 z-40" 
          : "w-full h-full flex items-center justify-center px-6"
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="w-full mx-auto" style={{ 
        maxWidth: contextConfig.maxWidth, 
        minWidth: isMapVisible ? '600px' : '400px' 
      }}>
        <div className="relative">
          <form onSubmit={handleSubmit} className="relative">
            <motion.div 
              className={`relative flex items-center px-6 py-2 ${isSubmitted ? 'opacity-75' : ''} ${contextConfig.isSquare ? 'rounded-lg' : 'rounded-full'}`}
              style={{
                background: '#ffffff',
                borderRadius: contextConfig.isSquare ? '8px' : '9999px',
                border: '1px solid #E5E7EB',
                boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
              }}
            >
              {/* Map Toggle Button - always show */}
              {contextConfig.showMapToggle && (
                <motion.button 
                  type="button" 
                  onClick={(e) => {
                    console.log('🗺️ Map button clicked!', { 
                      hasOnMapToggle: !!onMapToggle,
                      currentVisibility: isMapVisible 
                    });
                    onMapToggle?.();
                  }}
                  className={`flex-shrink-0 mr-4 transition-colors duration-200 ${
                    isMapVisible 
                      ? 'text-slate-500 hover:text-blue-500' // In map mode - blue hover for "back to search"
                      : 'text-slate-500 hover:text-green-500' // In normal mode - green hover for "go to map"
                  }`}
                  title={isMapVisible ? "Back to search mode" : "Go to map mode"}
                  whileHover={{ 
                    scale: 1.05,
                    rotate: 2
                  }}
                  whileTap={{ 
                    scale: 0.95,
                    rotate: -2
                  }}
                  transition={{
                    duration: 0.15,
                    ease: "easeOut"
                  }}
                >
                    {isMapVisible ? (
                      <LayoutDashboard className="w-5 h-5" strokeWidth={1.5} />
                    ) : (
                      <Map className="w-5 h-5" strokeWidth={1.5} />
                    )}
                </motion.button>
              )}
              
              <div className="flex-1 relative">
                <motion.input 
                  ref={inputRef}
                  type="text" 
                  value={searchValue} 
                  onChange={e => {
                    const value = e.target.value;
                    // Update state immediately for instant visual feedback
                    setSearchValue(value);
                    
                    // Track typing state
                    if (value.trim() && !hasStartedTyping) {
                      setHasStartedTyping(true);
                    } else if (!value.trim()) {
                      setHasStartedTyping(false);
                    }
                    
                    // Clear previous timeout
                    if (queryStartTimeoutRef.current) {
                      clearTimeout(queryStartTimeoutRef.current);
                    }
                    
                    // Call onQueryStart with very short debounce (50ms) for real-time responsiveness
                    if (value.trim()) {
                      queryStartTimeoutRef.current = setTimeout(() => {
                        onQueryStart?.(value.trim());
                      }, 50);
                    }
                  }}
                  onFocus={() => setIsFocused(true)} 
                  onBlur={() => setIsFocused(false)} 
                  onKeyDown={e => { if (e.key === 'Enter') handleSubmit(e); }} 
                  placeholder={contextConfig.placeholder}
                  className="w-full bg-transparent focus:outline-none text-lg font-normal text-slate-700 placeholder:text-slate-400"
                  autoComplete="off" 
                  disabled={isSubmitted}
                />
              </div>
              
              <div className="flex items-center space-x-3 ml-4">
                {/* Image Upload Button - only show when not in map mode */}
                {contextConfig.showMic && (
                  <ImageUploadButton
                    onImageUpload={(query) => {
                      setSearchValue(query);
                      onSearch?.(query);
                    }}
                    size="md"
                  />
                )}
                
                <motion.button 
                  type="submit" 
                  onClick={handleSubmit} 
                  className={`flex items-center justify-center relative ${!isSubmitted ? '' : 'cursor-not-allowed'}`}
                  style={{
                    width: '32px',
                    height: '32px',
                    minWidth: '32px',
                    minHeight: '32px',
                    borderRadius: '50%'
                  }}
                  animate={{
                    backgroundColor: searchValue.trim() ? '#415C85' : 'transparent'
                  }}
                  disabled={isSubmitted}
                  whileHover={!isSubmitted && searchValue.trim() ? { 
                    scale: 1.05
                  } : {}}
                  whileTap={!isSubmitted && searchValue.trim() ? { 
                    scale: 0.95
                  } : {}}
                  transition={{
                    duration: 0.2,
                    ease: [0.16, 1, 0.3, 1]
                  }}
                >
                  <motion.div
                    key="chevron-right"
                    initial={{ opacity: 1 }}
                    animate={{ opacity: searchValue.trim() ? 0 : 1 }}
                    transition={{
                      duration: 0.2,
                      ease: [0.16, 1, 0.3, 1]
                    }}
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ pointerEvents: 'none' }}
                  >
                    <ChevronRight className="w-6 h-6" strokeWidth={1.5} style={{ color: '#6B7280' }} />
                  </motion.div>
                  <motion.div
                    key="arrow-up"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: searchValue.trim() ? 1 : 0 }}
                    transition={{
                      duration: 0.2,
                      ease: [0.16, 1, 0.3, 1]
                    }}
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ pointerEvents: 'none' }}
                  >
                    <ArrowUp className="w-4 h-4" strokeWidth={2.5} style={{ color: '#ffffff' }} />
                  </motion.div>
                </motion.button>
              </div>
            </motion.div>
          </form>
          
        </div>
      </div>
    </motion.div>
  );
};
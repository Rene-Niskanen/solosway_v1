"use client";

import * as React from "react";
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Map } from "lucide-react";
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

  // Context-aware configuration
  const getContextConfig = () => {
    if (isMapVisible) {
      return {
        placeholder: "Search for properties...",
        showMapToggle: true, // Always show map toggle
        showMic: false,
        position: "bottom", // Always bottom when map is visible
        glassmorphism: true,
        maxWidth: '100vw', // Full width for map mode
        greenGlow: true // Add green glow for map mode
      };
    } else if (isInChatMode) {
      return {
        placeholder: "Ask anything...",
        showMapToggle: true,
        showMic: true,
        position: "center", // Always center
        glassmorphism: false,
        maxWidth: '600px', // Narrower for chat mode
        greenGlow: false
      };
    } else {
      return {
        placeholder: "What can I help you find today?",
        showMapToggle: true,
        showMic: true,
        position: "center", // Always center
        glassmorphism: false,
        maxWidth: '600px', // Narrower for opening search page
        greenGlow: false
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
    }
  }, [resetTrigger]);

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
              className={`relative flex items-center rounded-full px-6 py-2 transition-all duration-300 ease-out ${isSubmitted ? 'opacity-75' : ''}`}
              style={{
                background: isFocused 
                  ? 'rgba(255, 255, 255, 0.15)' 
                  : 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(20px)',
                borderRadius: '9999px',
                WebkitBackdropFilter: 'blur(20px)'
              }}
              animate={{
                scale: isFocused ? 1.005 : 1,
                boxShadow: isFocused 
                  ? contextConfig.greenGlow 
                    ? '0 12px 40px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 0 0 2px rgba(16, 185, 129, 0.6), 0 0 24px rgba(16, 185, 129, 0.25), 0 0 48px rgba(16, 185, 129, 0.12)'
                    : '0 20px 60px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 0 0 2px rgba(59, 130, 246, 0.5), 0 0 24px rgba(59, 130, 246, 0.2), 0 0 48px rgba(59, 130, 246, 0.1)'
                  : contextConfig.greenGlow 
                    ? '0 8px 32px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 0 0 1px rgba(16, 185, 129, 0.3), 0 0 16px rgba(16, 185, 129, 0.15), 0 0 32px rgba(16, 185, 129, 0.08)'
                    : '0 25px 50px -12px rgba(0, 0, 0, 0.25), inset 0 0 0 1px rgba(255, 255, 255, 0.2)'
              }}
              transition={{
                duration: 0.2,
                ease: "easeOut"
              }}
              whileHover={{
                scale: 1.003,
                boxShadow: contextConfig.greenGlow 
                  ? '0 10px 36px rgba(0, 0, 0, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 0 0 1.5px rgba(16, 185, 129, 0.5), 0 0 20px rgba(16, 185, 129, 0.2), 0 0 40px rgba(16, 185, 129, 0.1)'
                  : '0 30px 60px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 0 0 1.5px rgba(59, 130, 246, 0.4), 0 0 20px rgba(59, 130, 246, 0.15), 0 0 40px rgba(59, 130, 246, 0.08)'
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
                    <Map className="w-6 h-6" strokeWidth={1.5} />
                </motion.button>
              )}
              
              <div className="flex-1 relative">
                <motion.input 
                  ref={inputRef}
                  type="text" 
                  value={searchValue} 
                  onChange={e => {
                    const value = e.target.value;
                    setSearchValue(value);
                    if (value.trim() && !hasStartedTyping) {
                      setHasStartedTyping(true);
                      onQueryStart?.(value.trim());
                    }
                  }}
                  onFocus={() => setIsFocused(true)} 
                  onBlur={() => setIsFocused(false)} 
                  onKeyDown={e => { if (e.key === 'Enter') handleSubmit(e); }} 
                  placeholder={contextConfig.placeholder}
                  className="w-full bg-transparent focus:outline-none text-lg font-normal text-slate-700 placeholder:text-slate-400"
                  autoComplete="off" 
                  disabled={isSubmitted}
                  animate={{
                    scale: isFocused ? 1.01 : 1
                  }}
                  transition={{
                    duration: 0.15,
                    ease: "easeOut"
                  }}
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
                  className={`w-8 h-8 flex items-center justify-center transition-all duration-200 ${!isSubmitted ? 'text-slate-600 hover:text-green-500' : 'text-slate-400 cursor-not-allowed'}`} 
                  disabled={isSubmitted}
                  whileHover={!isSubmitted ? { 
                    scale: 1.08,
                    x: 1
                  } : {}}
                  whileTap={!isSubmitted ? { 
                    scale: 0.9,
                    x: -1
                  } : {}}
                  transition={{
                    duration: 0.15,
                    ease: "easeOut"
                  }}
                >
                  <ChevronRight className="w-6 h-6" strokeWidth={1.5} />
                </motion.button>
              </div>
            </motion.div>
          </form>
          
        </div>
      </div>
    </motion.div>
  );
};
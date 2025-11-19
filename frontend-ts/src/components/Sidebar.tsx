"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Database, BarChart3, Home, MessageSquareDot, LayoutDashboard } from "lucide-react";
import { ProfileDropdown } from "./ProfileDropdown";

const sidebarItems = [{
  icon: Home,
  id: 'home',
  label: 'Home'
}, {
  icon: BarChart3,
  id: 'analytics',
  label: 'Analytics'
}, {
  icon: Database,
  id: 'notifications',
  label: 'Files'
}] as any[];

export interface SidebarProps {
  className?: string;
  onItemClick?: (itemId: string) => void;
  onChatToggle?: () => void;
  isChatPanelOpen?: boolean;
  activeItem?: string;
  isCollapsed?: boolean;
  onToggle?: () => void;
  onNavigate?: (view: string) => void;
  onSignOut?: () => void;
}

export const Sidebar = ({
  className,
  onItemClick,
  onChatToggle,
  isChatPanelOpen = false,
  activeItem = 'home',
  isCollapsed = false,
  onToggle,
  onNavigate,
  onSignOut
}: SidebarProps) => {
  const [mousePosition, setMousePosition] = React.useState({ x: 0, y: 0 });
  const [showToggleButton, setShowToggleButton] = React.useState(false);
  const [isTopIconHovered, setIsTopIconHovered] = React.useState(false);
  
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
  return <>
    <motion.div 
      initial={{
        opacity: 0,
        x: -8
      }} 
      animate={{
        opacity: 1,
        x: isCollapsed ? -40 : 0
      }} 
      exit={{
        opacity: 0,
        x: -8
      }} 
      transition={{
        duration: 0.2,
        ease: [0.4, 0, 0.2, 1],
        layout: {
          duration: 0.25,
          ease: [0.4, 0, 0.2, 1]
        }
      }}
      layout
      className={`${isCollapsed ? 'w-2' : 'w-10 lg:w-14'} flex flex-col items-center py-6 fixed left-0 top-0 h-full ${className?.includes('z-[150]') ? 'z-[150]' : 'z-[300]'} bg-white ${className || ''}`} 
      style={{ 
        background: isCollapsed ? 'rgba(255, 255, 255, 0)' : 'rgba(255, 255, 255, 1)', 
        backgroundColor: isCollapsed ? 'rgba(255, 255, 255, 0)' : 'rgba(255, 255, 255, 1)',
        transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
      }}
    >
      {!isCollapsed && (
        <>
      {/* Chat Toggle Button */}
      <motion.button 
        initial={{
          opacity: 0,
          scale: 0.95
        }} 
        animate={{
          opacity: 1,
          scale: 1
        }} 
        transition={{
          duration: 0.2,
          ease: [0.4, 0, 0.2, 1],
          delay: 0.02
        }} 
        whileHover={{
          scale: 1.02,
          transition: {
            duration: 0.15,
            ease: [0.4, 0, 0.2, 1]
          }
        }} 
        whileTap={{
          scale: 0.98,
          transition: {
            duration: 0.1,
            ease: [0.4, 0, 0.2, 1]
          }
        }} 
        onMouseEnter={() => setIsTopIconHovered(true)}
        onMouseLeave={() => setIsTopIconHovered(false)}
        onClick={onChatToggle} 
        className="w-11 h-11 lg:w-13 lg:h-13 flex items-center justify-center mb-6 group cursor-pointer"
        style={{ transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }}
        aria-label="Toggle Chat History"
      >
        <AnimatePresence mode="wait">
          {!isTopIconHovered ? (
            <motion.img
              key="logo"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 0.45, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
              src="/velora-dash-logo.png"
              alt="VELORA"
              className="w-6 h-6 lg:w-8 lg:h-8 object-contain drop-shadow-sm"
            />
          ) : (
            <motion.div
              key="icon"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            >
              <MessageSquareDot className="w-4 h-4 lg:w-5 lg:h-5 drop-shadow-sm" strokeWidth={1.8} style={{ color: '#8B8B8B', transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Navigation Items */}
      <div className="flex flex-col space-y-4 flex-1">
        {sidebarItems.map((item, index) => {
        // Home icon is active when on search/dashboard view
        const isActive = item.id === 'home' ? activeItem === 'search' : activeItem === item.id;
        // Always use LayoutDashboard for home icon
        const Icon = item.id === 'home' ? LayoutDashboard : item.icon;
        return <motion.button key={item.id} initial={{
          opacity: 0,
          scale: 0.95
        }} animate={{
          opacity: 1,
          scale: 1
        }} transition={{
          duration: 0.2,
          ease: [0.4, 0, 0.2, 1],
          delay: index * 0.02 + 0.04
        }} whileHover={{
          scale: 1.02,
          transition: {
            duration: 0.15,
            ease: [0.4, 0, 0.2, 1]
          }
        }} whileTap={{
          scale: 0.98,
          transition: {
            duration: 0.1,
            ease: [0.4, 0, 0.2, 1]
          }
        }} onClick={() => {
          // Home button navigates to search/dashboard view
          if (item.id === 'home') {
            handleItemClick('home'); // Call 'home' so DashboardLayout can properly handle map reset
          } else {
            handleItemClick(item.id);
          }
        }} className="w-11 h-11 lg:w-13 lg:h-13 flex items-center justify-center group" aria-label={item.label} style={{ transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }}>
              {/* Icon */}
              <Icon className={`w-4 h-4 lg:w-5 lg:h-5 drop-shadow-sm ${isActive ? 'text-sidebar-active scale-105' : 'hover:scale-102'}`} strokeWidth={1.8} style={{ color: isActive ? undefined : '#8B8B8B', transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }} />
            </motion.button>;
      })}
      
      </div>

      {/* Profile Icon - Bottom of Sidebar */}
      <div className="mt-auto mb-6">
        <ProfileDropdown 
          onNavigate={onNavigate}
          onSignOut={onSignOut}
        />
      </div>
        </>
      )}
    </motion.div>

    {/* Sidebar Toggle Rail - full height thin clickable area */}
    {/* IMPORTANT: This button should ONLY toggle sidebar, NEVER navigate */}
    <motion.button
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
        ${isCollapsed ? 'left-0' : isChatPanelOpen ? '' : 'left-10 lg:left-14'}`}
      style={{ 
        WebkitTapHighlightColor: 'transparent',
        zIndex: 9999,
        // Position toggle rail exactly at the edge of the sidebar (no gap)
        // Sidebar is w-10 (40px) on mobile, lg:w-14 (56px) on desktop
        // Using Tailwind classes: left-10 (2.5rem = 40px) and lg:left-14 (3.5rem = 56px)
        ...(isChatPanelOpen && !isCollapsed ? { left: '376px' } : {}),
        backgroundColor: '#E9E9EB',
        pointerEvents: 'auto',
        transition: 'left 0.25s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
      }}
      animate={{
        x: 0
      }}
      transition={{
        duration: 0.25,
        ease: [0.4, 0, 0.2, 1]
      }}
    >
      {/* Glassmorphism arrow indicator - should point left when expanded, right when collapsed */}
      <motion.div
        className={`absolute top-1/2 left-1/2 w-3 h-3 flex items-center justify-center`}
        animate={{
          rotate: isCollapsed ? 0 : 180
        }}
        transition={{
          duration: 0.25,
          ease: [0.4, 0, 0.2, 1]
        }}
        style={{ 
          transform: 'translate(-50%, -50%)'
        }}
      >
        <div className={`w-0 h-0 border-l-[8px] border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent drop-shadow-sm`} style={{ borderLeftColor: '#8B8B8B' }} />
      </motion.div>
    </motion.button>
  </>;
};
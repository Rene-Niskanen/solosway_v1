"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { LogOut, User, ArrowRight, ChevronRight, Settings, MessageCircle } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { backendApi } from "@/services/backendApi";

interface ProfileDropdownProps {
  onNavigate?: (view: string) => void;
  onSignOut?: () => void;
}

export const ProfileDropdown: React.FC<ProfileDropdownProps> = ({ 
  onNavigate,
  onSignOut 
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [userData, setUserData] = React.useState<any>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const [dropdownPosition, setDropdownPosition] = React.useState({ left: 0, bottom: 0 });

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

  // Calculate dropdown position based on button position
  const updateDropdownPosition = React.useCallback(() => {
    if (buttonRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect();
      // Position dropdown to the right of the button (left-16 = 4rem = 64px from sidebar edge)
      // Bottom position: distance from bottom of viewport (bottom-6 = 1.5rem = 24px)
      // Move left by 2px to hide the sidebar border line
      const bottom = window.innerHeight - buttonRect.bottom + 24; // 24px = bottom-6
      setDropdownPosition({
        left: buttonRect.left + buttonRect.width + 14, // 14px offset (16px - 2px to hide border)
        bottom: bottom
      });
    }
  }, []);

  React.useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();
      
      // Update position on window resize or scroll
      window.addEventListener('resize', updateDropdownPosition);
      window.addEventListener('scroll', updateDropdownPosition, true);
      
      return () => {
        window.removeEventListener('resize', updateDropdownPosition);
        window.removeEventListener('scroll', updateDropdownPosition, true);
      };
    }
  }, [isOpen, updateDropdownPosition]);

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current && 
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Generate user display info
  const getUserName = () => {
    if (userData?.first_name) {
      return userData.first_name + (userData.last_name ? ` ${userData.last_name}` : '');
    }
    if (userData?.email) {
      const emailPrefix = userData.email.split('@')[0];
      return emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
    }
    return "User";
  };

  const getUserHandle = () => {
    if (userData?.email) {
      const emailPrefix = userData.email.split('@')[0];
      return `@${emailPrefix}`;
    }
    return "@user";
  };

  const userName = getUserName();
  const userHandle = getUserHandle();

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Profile Icon Button - ChatGPT style */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="relative w-8 h-8 rounded-full overflow-hidden transition-all duration-300 ease-out group cursor-pointer hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border border-gray-300/50"
        aria-label="Profile menu"
      >
        <Avatar className="w-full h-full">
          <AvatarImage 
            src={userData?.profile_image || userData?.avatar_url || "/default profile icon.png"} 
            alt={userName}
            className="object-cover"
          />
          <AvatarFallback className="bg-white">
            <img 
              src="/default profile icon.png" 
              alt="Default profile" 
              className="w-full h-full object-cover"
            />
          </AvatarFallback>
        </Avatar>
      </button>

      {/* Dropdown Menu - Portaled to document.body */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {isOpen && (
            <>
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100001]"
                onClick={() => setIsOpen(false)}
              />

              {/* Dropdown Content - ChatGPT simple design */}
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="fixed w-64 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-[100002]"
                style={{ 
                  zIndex: 100002,
                  left: `${dropdownPosition.left}px`,
                  bottom: `${dropdownPosition.bottom}px`
                }}
              >
              {/* User Email - Simple top section */}
              <div className="px-4 py-3 border-b border-gray-200">
                <div className="flex items-center gap-3">
                  <Avatar className="w-6 h-6 flex-shrink-0 border border-gray-300/50">
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
                  <span className="text-sm text-gray-700 truncate">
                    {userData?.email || userHandle}
                  </span>
                </div>
              </div>

              {/* Menu Items - Simple list */}
              <div className="py-1">
                {/* Velora Account */}
                <button
                  onClick={() => {
                    setIsOpen(false);
                    onNavigate?.('profile');
                  }}
                  className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="w-5 h-5 rounded-full bg-white border border-gray-200 flex items-center justify-center flex-shrink-0 p-0.5">
                    <img 
                      src="/velora-dash-logo.png" 
                      alt="Velora" 
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <span className="text-sm text-gray-900">Velora Account</span>
                </button>

                {/* Settings */}
                <button
                  onClick={() => {
                    setIsOpen(false);
                    onNavigate?.('settings');
                  }}
                  className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <Settings className="w-5 h-5 text-gray-600" />
                  <span className="text-sm text-gray-900">Settings</span>
                </button>

                {/* Send Feedback */}
                <button
                  onClick={() => {
                    setIsOpen(false);
                    // Handle send feedback action
                    console.log('Send feedback clicked');
                  }}
                  className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <MessageCircle className="w-5 h-5 text-gray-600" />
                  <span className="text-sm text-gray-900">Send feedback</span>
                </button>

                {/* Divider */}
                <div className="border-t border-gray-200 my-1" />

                {/* Sign Out */}
                <button
                  onClick={() => {
                    setIsOpen(false);
                    onSignOut?.();
                  }}
                  className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                >
                  <LogOut className="w-5 h-5 text-gray-600" />
                  <span className="text-sm text-gray-900">Sign out</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>,
      document.body
      )}
    </div>
  );
};


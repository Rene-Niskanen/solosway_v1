"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MessageCircle } from "lucide-react";

export interface ChatReturnNotificationProps {
  isVisible: boolean;
  chatData: {
    query?: string;
    messages: any[];
    timestamp?: Date;
  } | null;
  onReturnToChat: () => void;
  onDismiss: () => void;
}

export const ChatReturnNotification = ({
  isVisible,
  chatData,
  onReturnToChat,
  onDismiss
}: ChatReturnNotificationProps) => {
  if (!chatData) return null;

  const getPreviewText = () => {
    if (chatData.query) return chatData.query;
    if (chatData.messages.length > 0) {
      const firstUserMessage = chatData.messages.find(msg => msg.role === 'user');
      return firstUserMessage?.content || 'Chat conversation';
    }
    return 'Chat conversation';
  };

  const truncateText = (text: string, maxLength: number = 30) => {
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, x: -100, y: -20 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, x: -100, y: -20 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="fixed top-16 left-20 z-50 sm:top-4 sm:left-20"
        >
          <div className="bg-white/95 backdrop-blur-sm border border-slate-200/60 rounded-lg shadow-lg px-4 py-2 flex items-center space-x-3 min-w-60 max-w-80">
            <MessageCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
            
            <button
              onClick={onReturnToChat}
              className="flex-1 text-left hover:bg-slate-50/50 rounded-md px-2 py-1 transition-colors flex items-center space-x-2"
            >
              <div>
                <span className="text-xs text-slate-500 font-medium">Return to chat</span>
                <div className="text-sm text-slate-800 font-medium">
                  {truncateText(getPreviewText(), 25)}
                </div>
              </div>
            </button>
            
            <button
              onClick={onDismiss}
              className="text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md hover:bg-slate-100/50"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
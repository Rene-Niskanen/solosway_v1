"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";

interface MapQueryResultsPanelProps {
  isVisible: boolean;
  query: string;
  sidebarWidth?: number; // Width of the sidebar to offset the panel
}

export const MapQueryResultsPanel: React.FC<MapQueryResultsPanelProps> = ({
  isVisible,
  query,
  sidebarWidth = 56 // Default to desktop sidebar width (lg:w-14 = 56px)
}) => {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ x: -400, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -400, opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="fixed top-0 bottom-0 z-30 bg-white"
          style={{
            left: `${sidebarWidth}px`, // Position after sidebar
            width: '320px',
            boxShadow: '2px 0 8px rgba(0, 0, 0, 0.1)'
          }}
        >
          {/* Panel content will go here */}
          <div className="h-full flex flex-col">
            {/* Header placeholder */}
            <div className="p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">Query Results</h2>
              <p className="text-sm text-gray-500 mt-1">{query}</p>
            </div>
            
            {/* Content area - blank for now */}
            <div className="flex-1 p-4">
              {/* Results will be displayed here */}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};


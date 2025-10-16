"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Image as ImageIcon } from "lucide-react";

export interface ImageUploadButtonProps {
  onImageUpload?: (searchQuery: string) => void;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const ImageUploadButton = ({
  onImageUpload,
  className = "",
  size = 'md'
}: ImageUploadButtonProps) => {
  const [isImageModalOpen, setIsImageModalOpen] = React.useState(false);

  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-8 h-8', 
    lg: 'w-8 h-8'
  };

  const iconSizes = {
    sm: 'w-5 h-5',
    md: 'w-5 h-5',
    lg: 'w-5 h-5'
  };

  const handleImageProcessed = (searchQuery: string) => {
    if (onImageUpload) {
      onImageUpload(searchQuery);
    }
    setIsImageModalOpen(false);
  };

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setIsImageModalOpen(true)}
        className={`flex items-center justify-center transition-all duration-200 text-slate-600 hover:text-green-500 ${sizeClasses[size]} ${className}`}
        whileHover={{ 
          scale: 1.08,
          x: 1
        }}
        whileTap={{ 
          scale: 0.9,
          x: -1
        }}
        title="Upload property screenshot"
      >
        <ImageIcon className={iconSizes[size]} strokeWidth={1.5} />
      </motion.button>

      {/* Import and render ImageUploadFeature when needed */}
      {isImageModalOpen && (
        <div>
          {/* Dynamic import to avoid affecting bundle if not used */}
          {React.createElement(
            React.lazy(() => import('./ImageUploadFeature')),
            {
              isVisible: true,
              onImageProcessed: handleImageProcessed,
              onClose: () => setIsImageModalOpen(false)
            }
          )}
        </div>
      )}
    </>
  );
};

export default ImageUploadButton;

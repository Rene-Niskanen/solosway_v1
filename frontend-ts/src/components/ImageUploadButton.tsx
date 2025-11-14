"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Paperclip } from "lucide-react";

export interface ImageUploadButtonProps {
  onImageUpload?: (searchQuery: string) => void;
  onFileUpload?: (file: File) => void;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const ImageUploadButton = ({
  onImageUpload,
  onFileUpload,
  className = "",
  size = 'md'
}: ImageUploadButtonProps) => {
  const [isImageModalOpen, setIsImageModalOpen] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const sizeClasses = {
    sm: 'w-7 h-7',
    md: 'w-7 h-7', 
    lg: 'w-7 h-7'
  };

  const iconSizes = {
    sm: 'w-[18px] h-[18px]',
    md: 'w-[18px] h-[18px]',
    lg: 'w-[18px] h-[18px]'
  };

  const handleImageProcessed = (searchQuery: string) => {
    if (onImageUpload) {
      onImageUpload(searchQuery);
    }
    setIsImageModalOpen(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onFileUpload) {
      onFileUpload(file);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleButtonClick = () => {
    // If onFileUpload is provided, use file input; otherwise use image modal
    if (onFileUpload) {
      fileInputRef.current?.click();
    } else {
      setIsImageModalOpen(true);
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="*/*"
        onChange={handleFileSelect}
        className="hidden"
      />
      <motion.button
        type="button"
        onClick={handleButtonClick}
        className={`flex items-center justify-center transition-all duration-200 text-black hover:text-gray-700 ${sizeClasses[size]} ${className}`}
        whileHover={{ 
          scale: 1.08,
          x: 1
        }}
        whileTap={{ 
          scale: 0.9,
          x: -1
        }}
        title={onFileUpload ? "Upload file" : "Upload property screenshot"}
      >
        <Paperclip className={iconSizes[size]} strokeWidth={1.5} />
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

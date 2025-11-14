"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { FileText, X } from "lucide-react";

export interface FileAttachmentData {
  id: string;
  file: File;
  name: string;
  type: string;
  size: number;
}

export interface FileAttachmentProps {
  attachment: FileAttachmentData;
  onRemove: (id: string) => void;
  onPreview?: (attachment: FileAttachmentData) => void;
}

export const FileAttachment: React.FC<FileAttachmentProps> = ({
  attachment,
  onRemove,
  onPreview
}) => {
  const getFileTypeLabel = (type: string): string => {
    if (type.includes('pdf')) return 'PDF';
    if (type.includes('word') || type.includes('document')) return 'DOC';
    if (type.includes('excel') || type.includes('spreadsheet')) return 'XLS';
    if (type.includes('image')) return 'IMG';
    if (type.includes('text')) return 'TXT';
    return 'FILE';
  };

  const formatFileName = (name: string): string => {
    // Truncate long file names
    if (name.length > 30) {
      const extension = name.split('.').pop();
      const nameWithoutExt = name.substring(0, name.lastIndexOf('.'));
      return `${nameWithoutExt.substring(0, 27)}...${extension ? '.' + extension : ''}`;
    }
    return name;
  };

  const handleFileClick = (e: React.MouseEvent) => {
    // Don't open file if clicking the remove button
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }

    // If onPreview is provided, use it (for preview modal)
    if (onPreview) {
      onPreview(attachment);
      return;
    }

    // Fallback: Create a blob URL from the file
    const blobUrl = URL.createObjectURL(attachment.file);
    
    // For images and PDFs, open in a new tab
    if (attachment.type.startsWith('image/') || attachment.type === 'application/pdf') {
      window.open(blobUrl, '_blank');
    } else {
      // For other files, create a download link
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = attachment.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    // Clean up the blob URL after a delay
    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
    }, 100);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.1, ease: "easeOut" }}
      className="relative bg-white rounded-lg border border-gray-200 px-2.5 py-2 shadow-sm cursor-pointer hover:border-gray-300 hover:shadow-md transition-all duration-100"
      style={{ 
        maxWidth: 'fit-content',
        display: 'inline-block'
      }}
      layout={false}
      onClick={handleFileClick}
      title={`Click to open ${attachment.name}`}
    >
      <div className="flex items-center gap-2">
        {/* File Icon - Red square with white document outline */}
        <div className="w-6 h-6 bg-red-500 rounded flex items-center justify-center flex-shrink-0">
          <FileText className="w-4 h-4 text-white" strokeWidth={2} />
        </div>
        
        {/* File Info */}
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-medium text-black truncate">
            {formatFileName(attachment.name)}
          </span>
          <span className="text-[10px] text-gray-500 font-normal">
            {getFileTypeLabel(attachment.type)}
          </span>
        </div>
        
        {/* Remove Button - Black circular X */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(attachment.id);
          }}
          className="w-4 h-4 rounded-full bg-black flex items-center justify-center flex-shrink-0 hover:bg-gray-800 transition-colors ml-2"
          title="Remove file"
        >
          <X className="w-2.5 h-2.5 text-white" strokeWidth={2.5} />
        </button>
      </div>
    </motion.div>
  );
};


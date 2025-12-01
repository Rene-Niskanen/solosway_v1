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
  onDragStart?: (fileId: string) => void;
  onDragEnd?: () => void;
}

export const FileAttachment: React.FC<FileAttachmentProps> = ({
  attachment,
  onRemove,
  onPreview,
  onDragStart,
  onDragEnd
}) => {
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState<string | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const imageDragRef = React.useRef<HTMLDivElement>(null);
  const fileDragRef = React.useRef<HTMLDivElement>(null);
  const isImage = attachment.type.startsWith('image/');
  const isPDF = attachment.type === 'application/pdf';
  const isDOCX = attachment.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                 attachment.type === 'application/msword' ||
                 (attachment.name && (attachment.name.toLowerCase().endsWith('.docx') || attachment.name.toLowerCase().endsWith('.doc')));

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('fileId', attachment.id);
    // Set a type to distinguish from property card drags
    e.dataTransfer.setData('dragType', 'file');
    e.stopPropagation(); // Prevent event from bubbling to property card handlers
    setIsDragging(true);
    // Add a visual indicator that dragging has started
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
    // Notify parent that dragging has started
    if (onDragStart) {
      onDragStart(attachment.id);
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setIsDragging(false);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
    // Notify parent that dragging has ended
    if (onDragEnd) {
      onDragEnd();
    }
  };

  // Create preview URL for images
  React.useEffect(() => {
    if (isImage) {
      const url = URL.createObjectURL(attachment.file);
      setImagePreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    }
  }, [attachment.file, isImage]);

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

  // Attach native drag event handlers for image preview
  React.useEffect(() => {
    const element = imageDragRef.current;
    if (!element || !isImage || !imagePreviewUrl) return;

    const handleNativeDragStart = (e: DragEvent) => {
      handleDragStart(e as unknown as React.DragEvent);
    };

    const handleNativeDragEnd = (e: DragEvent) => {
      handleDragEnd(e as unknown as React.DragEvent);
    };

    element.addEventListener('dragstart', handleNativeDragStart);
    element.addEventListener('dragend', handleNativeDragEnd);

    return () => {
      element.removeEventListener('dragstart', handleNativeDragStart);
      element.removeEventListener('dragend', handleNativeDragEnd);
    };
  }, [isImage, imagePreviewUrl, handleDragStart, handleDragEnd]);

  // Attach native drag event handlers for file attachment
  React.useEffect(() => {
    const element = fileDragRef.current;
    if (!element || isImage) return;

    const handleNativeDragStart = (e: DragEvent) => {
      handleDragStart(e as unknown as React.DragEvent);
    };

    const handleNativeDragEnd = (e: DragEvent) => {
      handleDragEnd(e as unknown as React.DragEvent);
    };

    element.addEventListener('dragstart', handleNativeDragStart);
    element.addEventListener('dragend', handleNativeDragEnd);

    return () => {
      element.removeEventListener('dragstart', handleNativeDragStart);
      element.removeEventListener('dragend', handleNativeDragEnd);
    };
  }, [isImage, handleDragStart, handleDragEnd]);

  // For images, show a small rectangular preview
  if (isImage && imagePreviewUrl) {
    return (
      <motion.div
        ref={imageDragRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1, ease: "easeOut" }}
        className="relative bg-white rounded-lg border border-gray-200 shadow-sm cursor-pointer hover:border-gray-300 hover:shadow-md transition-all duration-100 overflow-hidden"
        style={{ 
          width: '120px',
          height: '80px',
          display: 'inline-block',
          flexShrink: 0,
          padding: 0,
          margin: 0,
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
        layout={false}
        draggable
        onClick={handleFileClick}
        title={`Drag to delete or click to open ${attachment.name}`}
      >
        {/* Image Preview */}
        <img
          src={imagePreviewUrl}
          alt={attachment.name}
          className="w-full h-full object-cover"
          style={{
            display: 'block',
            padding: 0,
            margin: 0,
            width: '100%',
            height: '100%',
          }}
        />
        
        {/* Remove Button - Bottom right corner */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(attachment.id);
          }}
          className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center flex-shrink-0 hover:bg-black transition-colors"
          title="Remove file"
        >
          <X className="w-3 h-3 text-white" strokeWidth={2.5} />
        </button>
      </motion.div>
    );
  }

  // For non-image files, show the original file attachment UI
  return (
    <motion.div
      ref={fileDragRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.1, ease: "easeOut" }}
      className="relative bg-white rounded-lg border border-gray-200 px-2.5 py-2 shadow-sm cursor-pointer hover:border-gray-300 hover:shadow-md transition-all duration-100"
      style={{ 
        width: 'auto',
        height: 'auto',
        maxWidth: 'none',
        minWidth: 'auto',
        display: 'inline-block',
        flexShrink: 0,
        flexGrow: 0,
        alignSelf: 'flex-start',
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      layout={false}
      draggable
      onClick={handleFileClick}
      title={`Drag to delete or click to open ${attachment.name}`}
    >
      <div className="flex items-center gap-2" style={{ width: 'auto', flexShrink: 0 }}>
        {/* File Icon - Red for PDF, Blue for DOCX, Gray for others */}
        <div className={`w-6 h-6 ${isPDF ? 'bg-red-500' : isDOCX ? 'bg-blue-500' : 'bg-gray-500'} rounded flex items-center justify-center flex-shrink-0`}>
          <FileText className="w-4 h-4 text-white" strokeWidth={2} />
        </div>
        
        {/* File Info */}
        <div className="flex flex-col" style={{ width: 'auto', flexShrink: 0 }}>
          <span className="text-xs font-medium text-black truncate" style={{ whiteSpace: 'nowrap' }}>
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


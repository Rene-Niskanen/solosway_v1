"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { FileText, X, Loader2, Check, AlertCircle } from "lucide-react";

export interface FileAttachmentData {
  id: string;
  file: File;
  name: string;
  type: string;
  size: number;
  // Quick extraction fields (for chat attachments)
  extractedText?: string;
  pageTexts?: string[];
  pageCount?: number;
  tempFileId?: string;
  extractionStatus?: 'pending' | 'extracting' | 'complete' | 'error';
  extractionError?: string;
}

export interface FileAttachmentProps {
  attachment: FileAttachmentData;
  onRemove: (id: string) => void;
  onPreview?: (attachment: FileAttachmentData) => void;
  onDragStart?: (fileId: string) => void;
  onDragEnd?: () => void;
  /** Slightly smaller UI for use inside query bubbles (no remove/drag). */
  compact?: boolean;
  /** Chat-style dark bubble with document ID, red/colored icon, and type label. */
  variant?: 'default' | 'chat';
}

export const FileAttachment: React.FC<FileAttachmentProps> = ({
  attachment,
  onRemove,
  onPreview,
  onDragStart,
  onDragEnd,
  compact = false,
  variant = 'default'
}) => {
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState<string | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isChatHovered, setIsChatHovered] = React.useState(false);
  const imageDragRef = React.useRef<HTMLDivElement>(null);
  const fileDragRef = React.useRef<HTMLDivElement>(null);
  const isImage = attachment.type.startsWith('image/');
  const isPDF = attachment.type === 'application/pdf';
  const isDOCX = attachment.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                 attachment.type === 'application/msword' ||
                 (attachment.name && (attachment.name.toLowerCase().endsWith('.docx') || attachment.name.toLowerCase().endsWith('.doc')));
  const isExcel = attachment.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                  attachment.type === 'application/vnd.ms-excel' ||
                  (attachment.name && (attachment.name.toLowerCase().endsWith('.xlsx') || attachment.name.toLowerCase().endsWith('.xls')));
  const isPowerPoint = attachment.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
                       attachment.type === 'application/vnd.ms-powerpoint' ||
                       (attachment.name && (attachment.name.toLowerCase().endsWith('.pptx') || attachment.name.toLowerCase().endsWith('.ppt')));

  const handleDragStart = (e: React.DragEvent) => {
    // Don't start drag when clicking the remove button
    if ((e.target as HTMLElement).closest('button[title="Remove file"]')) {
      e.preventDefault();
      return;
    }
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
    if (type.includes('presentation') || type.includes('powerpoint')) return 'PPT';
    if (type.includes('image')) return 'IMG';
    if (type.includes('text')) return 'TXT';
    return 'FILE';
  };

  /** Chat variant top row: show filename (without extension for cleaner display) */
  const getChatDisplayName = (): string => {
    const name = attachment.name?.trim();
    if (!name) return '';
    // Strip common extensions for cleaner display
    const ext = name.split('.').pop()?.toLowerCase();
    if (ext && ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      const base = name.substring(0, name.lastIndexOf('.'));
      return base || name;
    }
    return name;
  };

  /** Chat variant: icon bg color and label for file type */
  const getChatIconStyle = (): { bg: string; label: string } => {
    if (isPDF) return { bg: '#DC2626', label: 'PDF' };
    if (isDOCX) return { bg: '#2B579A', label: 'DOC' };
    if (isExcel) return { bg: '#217346', label: 'XLS' };
    if (isPowerPoint) return { bg: '#D24726', label: 'PPT' };
    if (isImage) return { bg: '#6B7280', label: 'IMG' };
    if (attachment.type.includes('text')) return { bg: '#6B7280', label: 'TXT' };
    return { bg: '#6B7280', label: 'FILE' };
  };

  const CHAT_BUBBLE_BG = '#4D4D4F';
  const CHAT_BUBBLE_RADIUS = 10;
  const CHAT_ICON_SIZE = 18;

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

    if (!attachment.file) return;

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

  // Chat variant: dark grey bubble with document ID and type label
  if (variant === 'chat') {
    const displayName = getChatDisplayName();
    const { bg: iconBg, label: iconLabel } = getChatIconStyle();
    const typeLabel = getFileTypeLabel(attachment.type);
    const sourceLabel = typeLabel;

    const chatBubbleBase = {
      backgroundColor: CHAT_BUBBLE_BG,
      borderRadius: CHAT_BUBBLE_RADIUS,
      padding: '12px 14px',
      display: 'inline-flex',
      flexDirection: 'column' as const,
      gap: '8px',
      cursor: 'pointer',
      flexShrink: 0,
      transition: 'opacity 0.2s ease',
    };

    if (isImage && imagePreviewUrl) {
      return (
        <motion.div
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1, ease: "easeOut" }}
          onClick={handleFileClick}
          onMouseEnter={() => setIsChatHovered(true)}
          onMouseLeave={() => setIsChatHovered(false)}
          style={{
            ...chatBubbleBase,
            position: 'relative',
            overflow: 'hidden',
            width: 62,
            minWidth: 62,
            alignItems: 'center',
          }}
          title={`Click to preview ${attachment.name}`}
        >
          {!compact && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRemove(attachment.id);
              }}
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                width: 20,
                height: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                border: 'none',
                background: 'rgba(0,0,0,0.3)',
                color: '#fff',
                cursor: 'pointer',
                zIndex: 10,
                opacity: isChatHovered ? 1 : 0,
                transition: 'opacity 0.15s ease',
                pointerEvents: isChatHovered ? 'auto' : 'none',
              }}
              title="Remove file"
            >
              <X className="w-3 h-3" strokeWidth={2.5} />
            </button>
          )}
          {displayName && (
            <span style={{ fontSize: '11px', color: '#fff', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
              {displayName}
            </span>
          )}
          <div style={{ width: 40, height: 40, borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
            <img
              src={imagePreviewUrl}
              alt={attachment.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>
          <span style={{ fontSize: '11px', color: '#fff', opacity: 0.9 }}>
            {sourceLabel}
          </span>
        </motion.div>
      );
    }

    if (isImage && !imagePreviewUrl) {
      return (
        <motion.div
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1, ease: "easeOut" }}
          onMouseEnter={() => setIsChatHovered(true)}
          onMouseLeave={() => setIsChatHovered(false)}
          style={{
            ...chatBubbleBase,
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 80,
            minHeight: 56,
            position: 'relative',
          }}
        >
          {!compact && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRemove(attachment.id);
              }}
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                width: 20,
                height: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                border: 'none',
                background: 'rgba(0,0,0,0.3)',
                color: '#fff',
                cursor: 'pointer',
                zIndex: 10,
                opacity: isChatHovered ? 1 : 0,
                transition: 'opacity 0.15s ease',
                pointerEvents: isChatHovered ? 'auto' : 'none',
              }}
              title="Remove file"
            >
              <X className="w-3 h-3" strokeWidth={2.5} />
            </button>
          )}
          {displayName && (
            <span style={{ fontSize: '11px', color: '#fff', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
              {displayName}
            </span>
          )}
          <div
            style={{
              width: CHAT_ICON_SIZE,
              height: CHAT_ICON_SIZE,
              borderRadius: 4,
              backgroundColor: iconBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: '9px', color: '#fff', fontWeight: 600 }}>
              {iconLabel}
            </span>
          </div>
          <span style={{ fontSize: '11px', color: '#fff', opacity: 0.9 }}>
            {sourceLabel}
          </span>
        </motion.div>
      );
    }

    // Non-image files: doc ID + red/colored square + type label
    return (
      <motion.div
        initial={false}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1, ease: "easeOut" }}
        onClick={handleFileClick}
        onMouseEnter={() => setIsChatHovered(true)}
        onMouseLeave={() => setIsChatHovered(false)}
        style={{
          ...chatBubbleBase,
          alignItems: 'flex-start',
          width: 'auto',
          position: 'relative',
        }}
        title={`Click to preview ${attachment.name}`}
      >
        {!compact && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemove(attachment.id);
            }}
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(0,0,0,0.3)',
              color: '#fff',
              cursor: 'pointer',
              zIndex: 10,
              opacity: isChatHovered ? 1 : 0,
              transition: 'opacity 0.15s ease',
              pointerEvents: isChatHovered ? 'auto' : 'none',
            }}
            title="Remove file"
          >
            <X className="w-3 h-3" strokeWidth={2.5} />
          </button>
        )}
        {displayName && (
          <span style={{ fontSize: '11px', color: '#fff', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
            {displayName}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div
            style={{
              width: CHAT_ICON_SIZE,
              height: CHAT_ICON_SIZE,
              borderRadius: 4,
              backgroundColor: iconBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: '9px', color: '#fff', fontWeight: 600 }}>
              {iconLabel}
            </span>
          </div>
          <span style={{ fontSize: '12px', color: '#fff', opacity: 0.95 }}>
            {sourceLabel}
          </span>
        </div>
      </motion.div>
    );
  }

  // For images, show a small rectangular preview (default variant)
  if (isImage && imagePreviewUrl) {
    return (
      <motion.div
        ref={compact ? undefined : imageDragRef}
        initial={false}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1, ease: "easeOut" }}
        className="relative bg-white rounded-md border border-gray-200 shadow-sm cursor-pointer hover:border-gray-300 hover:shadow-md transition-all duration-100 overflow-hidden"
        style={{ 
          width: compact ? '62px' : '120px',
          height: compact ? '62px' : '80px',
          display: 'inline-block',
          flexShrink: 0,
          padding: 0,
          margin: 0,
          cursor: compact ? 'pointer' : (isDragging ? 'grabbing' : 'grab'),
        }}
        layout={false}
        draggable={!compact}
        onClick={handleFileClick}
        title={compact ? `Click to preview ${attachment.name}` : `Drag to delete or click to open ${attachment.name}`}
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
        {/* Remove Button - Bottom right corner (hidden in compact) */}
        {!compact && (
          <button
            type="button"
            draggable={false}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemove(attachment.id);
            }}
            className="absolute bottom-1 right-1 w-6 h-6 flex items-center justify-center flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer z-10"
            title="Remove file"
            style={{ touchAction: 'manipulation' }}
          >
            <X className="w-4 h-4" strokeWidth={2.5} style={{ pointerEvents: 'none' }} />
          </button>
        )}
      </motion.div>
    );
  }

  // For non-image files, show the original file attachment UI
  const iconSize = compact ? 'w-5 h-5' : 'w-6 h-6';
  const fileTextSize = compact ? 'w-3 h-3' : 'w-4 h-4';
  const nameClass = compact ? 'text-[11px] font-medium text-black truncate' : 'text-xs font-medium text-black truncate';
  const typeClass = compact ? 'text-[9px] text-gray-500 font-normal' : 'text-[10px] text-gray-500 font-normal';
  const paddingClass = compact ? 'px-1.5 py-1' : 'px-2 py-1.5';
  const gapClass = compact ? 'gap-1.5' : 'gap-2';

  return (
    <motion.div
      ref={compact ? undefined : fileDragRef}
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.1, ease: "easeOut" }}
      className={`relative bg-white rounded-md border border-gray-200 ${paddingClass} cursor-pointer hover:border-gray-300 transition-all duration-100`}
      style={{ 
        width: 'auto',
        height: 'auto',
        maxWidth: 'none',
        minWidth: 'auto',
        display: 'inline-block',
        flexShrink: 0,
        flexGrow: 0,
        alignSelf: 'flex-start',
        cursor: compact ? 'pointer' : (isDragging ? 'grabbing' : 'grab'),
        position: 'relative',
        zIndex: 1,
        isolation: 'isolate',
      }}
      layout={false}
      draggable={!compact}
      onClick={handleFileClick}
      title={compact ? `Click to preview ${attachment.name}` : `Drag to delete or click to open ${attachment.name}`}
    >
      <div className={`flex items-center ${gapClass}`} style={{ width: 'auto', flexShrink: 0 }}>
        {/* File Icon - PDF, Word, Excel, PowerPoint images; Gray FileText for others */}
        {isPDF ? (
          <img src="/PDF(1).png" alt="PDF" className={`${iconSize} rounded object-contain flex-shrink-0`} />
        ) : isDOCX ? (
          <img src="/word.png" alt="Word" className={`${compact ? 'w-6 h-6' : 'w-7 h-7'} rounded object-contain flex-shrink-0`} />
        ) : isExcel ? (
          <img src="/excel.png" alt="Excel" className={`${compact ? 'w-6 h-6' : 'w-7 h-7'} rounded object-contain flex-shrink-0`} />
        ) : isPowerPoint ? (
          <img src="/powerpoint.png" alt="PowerPoint" className={`${compact ? 'w-6 h-6' : 'w-7 h-7'} rounded object-contain flex-shrink-0`} />
        ) : (
          <div className={`${iconSize} bg-gray-500 rounded flex items-center justify-center flex-shrink-0`}>
            <FileText className={`${fileTextSize} text-white`} strokeWidth={2} />
          </div>
        )}
        
        {/* File Info */}
        <div className="flex flex-col" style={{ width: 'auto', flexShrink: 0 }}>
          <span className={`${nameClass}`} style={{ whiteSpace: 'nowrap' }}>
            {formatFileName(attachment.name)}
          </span>
          {/* In query bubble (compact), hide type label and extraction tick for cleaner look */}
          {!compact && (
            <div className="flex items-center gap-1">
              <span className={typeClass}>
                {getFileTypeLabel(attachment.type)}
              </span>
              {/* Extraction status: spinner when extracting, tick when complete, alert when error */}
              {attachment.extractionStatus === 'extracting' && (
                <Loader2 className="w-2.5 h-2.5 text-blue-500 animate-spin" />
              )}
              {attachment.extractionStatus === 'complete' && (
                <Check className="w-3.5 h-3.5 text-green-500 flex-shrink-0" strokeWidth={3} aria-label="Ready" />
              )}
              {attachment.extractionStatus === 'error' && (
                <AlertCircle className="w-2.5 h-2.5 text-red-500" />
              )}
            </div>
          )}
        </div>
        
        {/* Remove Button - X only (hidden in compact) */}
        {!compact && (
          <button
            type="button"
            draggable={false}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemove(attachment.id);
            }}
            className="w-6 h-6 flex items-center justify-center flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors ml-2 cursor-pointer flex-shrink-0"
            title="Remove file"
            style={{ touchAction: 'manipulation' }}
          >
            <X className="w-4 h-4" strokeWidth={2.5} style={{ pointerEvents: 'none' }} />
          </button>
        )}
      </div>
    </motion.div>
  );
};


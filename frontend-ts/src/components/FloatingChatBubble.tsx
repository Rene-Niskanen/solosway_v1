"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { FileAttachmentData } from './FileAttachment';
import { PropertyAttachmentData } from './PropertyAttachment';
import { AtMentionChip } from './AtMentionChip';
import { usePreview } from '../contexts/PreviewContext';
import { ReasoningSteps, ReasoningStep } from './ReasoningSteps';
import type { QueryContentSegment } from '@/types/segmentInput';

interface CitationDataType {
  doc_id: string;
  original_filename?: string | null;
  page?: number;
  page_number?: number;
  block_id?: string;
  bbox?: {
    left: number;
    top: number;
    width: number;
    height: number;
    page?: number;
  };
  classification_type?: string;
  [key: string]: any;
}

interface ChatMessage {
  id: string;
  type: 'query' | 'response';
  text: string;
  attachments?: FileAttachmentData[];
  propertyAttachments?: PropertyAttachmentData[];
  selectedDocumentIds?: string[];
  selectedDocumentNames?: string[];
  contentSegments?: QueryContentSegment[];
  isLoading?: boolean;
  reasoningSteps?: ReasoningStep[];
  citations?: Record<string, CitationDataType>;
}

interface FloatingChatBubbleProps {
  chatMessages: ChatMessage[];
  onOpenChat: () => void;
  onClose: () => void;
}

// CitationLink component (scaled down version)
const CitationLink: React.FC<{
  citationNumber: string;
  citationData: CitationDataType;
  onClick: (data: CitationDataType) => void;
}> = ({ citationNumber, citationData, onClick }) => {
  const displayName = citationData.original_filename || 
    (citationData.classification_type ? citationData.classification_type.replace(/_/g, ' ') : 'Document');
  
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(citationData);
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: '2px',
        marginRight: '1px',
        minWidth: '14px',
        height: '14px',
        padding: '0 3px',
        fontSize: '9px',
        fontWeight: 500,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        color: '#6B7280',
        backgroundColor: '#F3F4F6',
        borderRadius: '2px',
        border: 'none',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        verticalAlign: 'baseline',
        lineHeight: 1,
        flexShrink: 0
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = '#E5E7EB';
        e.currentTarget.style.color = '#374151';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = '#F3F4F6';
        e.currentTarget.style.color = '#6B7280';
      }}
    >
      {citationNumber}
    </button>
  );
};

// Component for displaying attachment in query bubble (same as SideChatPanel)
const QueryAttachment: React.FC<{ attachment: FileAttachmentData }> = ({ attachment }) => {
  const isImage = attachment.type.startsWith('image/');
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const { addPreviewFile } = usePreview();
  
  React.useEffect(() => {
    if (isImage && attachment.file) {
      const preloadedBlob = (window as any).__preloadedAttachmentBlobs?.[attachment.id];
      if (preloadedBlob) {
        setImageUrl(preloadedBlob);
      } else {
        const url = URL.createObjectURL(attachment.file);
        setImageUrl(url);
        return () => {
          URL.revokeObjectURL(url);
        };
      }
    }
  }, [isImage, attachment.id, attachment.file]);
  
  const handleImageClick = () => {
    if (attachment.file) {
      const freshAttachment: FileAttachmentData = {
        ...attachment,
        file: attachment.file
      };
      addPreviewFile(freshAttachment);
    }
  };
  
  if (isImage && imageUrl) {
    return (
      <div
        onClick={handleImageClick}
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '4px',
          overflow: 'hidden',
          backgroundColor: '#F3F4F6',
          border: '1px solid #E5E7EB',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          cursor: 'pointer',
          transition: 'opacity 0.2s ease'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '0.8';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '1';
        }}
        title={`Click to preview ${attachment.name}`}
      >
        <img
          src={imageUrl}
          alt={attachment.name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block'
          }}
        />
      </div>
    );
  }
  
  return (
    <div
      style={{
        fontSize: '9px',
        color: '#6B7280',
        backgroundColor: '#F3F4F6',
        padding: '2px 4px',
        borderRadius: '3px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px'
      }}
    >
      <span>📎</span>
      <span>{attachment.name}</span>
    </div>
  );
};

// Component for displaying property attachment in query bubble (same as SideChatPanel)
const QueryPropertyAttachment: React.FC<{ attachment: PropertyAttachmentData }> = ({ attachment }) => {
  const imageUrl = attachment.imageUrl || attachment.property.image || attachment.property.primary_image_url;
  
  if (imageUrl) {
    return (
      <div
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '3px',
          overflow: 'hidden',
          backgroundColor: '#F3F4F6',
          border: '1px solid #E5E7EB',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          cursor: 'pointer',
          transition: 'opacity 0.2s ease',
          position: 'relative',
          zIndex: 10,
          pointerEvents: 'auto'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '0.8';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '1';
        }}
        title={`Click to view ${attachment.address}`}
      >
        <img
          src={imageUrl}
          alt={attachment.address}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            pointerEvents: 'none'
          }}
          onError={(e) => {
            e.currentTarget.src = 'https://via.placeholder.com/40x40/94a3b8/ffffff?text=Property';
          }}
        />
      </div>
    );
  }
  
  return (
    <div
      style={{
        width: '32px',
        height: '32px',
        borderRadius: '3px',
        backgroundColor: '#F3F4F6',
        border: '1px solid #E5E7EB',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        cursor: 'pointer',
        transition: 'opacity 0.2s ease',
        position: 'relative',
        zIndex: 10,
        pointerEvents: 'auto'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = '0.8';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = '1';
      }}
      title={`Click to view ${attachment.address}`}
    >
      <span style={{ fontSize: '16px', pointerEvents: 'none' }}>🏠</span>
    </div>
  );
};

export const FloatingChatBubble: React.FC<FloatingChatBubbleProps> = ({
  chatMessages,
  onOpenChat,
  onClose
}) => {
  // Ref for messages container to enable auto-scroll
  const messagesContainerRef = React.useRef<HTMLDivElement>(null);
  const { openExpandedCardView } = usePreview();
  
  // State for gold glow animation
  const [showGoldGlow, setShowGoldGlow] = React.useState(false);
  const hasAnimatedRef = React.useRef(false);
  
  // Check if bubble should be visible: only when query sent, user left, and response is loading
  const shouldShowBubble = React.useMemo(() => {
    // Check if there's at least one query message
    const hasQuery = chatMessages.some(msg => msg.type === 'query');
    // Check if there's a loading response
    const hasLoadingResponse = chatMessages.some(msg => msg.type === 'response' && msg.isLoading);
    // Only show if query exists and response is loading
    return hasQuery && hasLoadingResponse;
  }, [chatMessages]);
  
  // Trigger gold glow animation when bubble becomes visible
  React.useEffect(() => {
    if (shouldShowBubble && !hasAnimatedRef.current) {
      hasAnimatedRef.current = true;
      setShowGoldGlow(true);
      // Remove glow after animation completes (800ms)
      const timer = setTimeout(() => {
        setShowGoldGlow(false);
      }, 800);
      return () => clearTimeout(timer);
    } else if (!shouldShowBubble) {
      // Reset animation flag when bubble hides so it can animate again next time
      hasAnimatedRef.current = false;
    }
  }, [shouldShowBubble]);
  
  // Helper function to render text with clickable citation links (scaled down version)
  const renderTextWithCitations = React.useCallback((
    text: string, 
    citations: Record<string, CitationDataType> | undefined,
    onCitationClick: (data: CitationDataType) => void,
    seenCitationNums?: Set<string>
  ): React.ReactNode => {
    if (!citations || Object.keys(citations).length === 0) {
      return text;
    }
    
    const superscriptMap: Record<string, string> = {
      '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5',
      '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9'
    };
    
    const superscriptPattern = /[¹²³⁴⁵⁶⁷⁸⁹]+(?:\d+)?/g;
    const bracketPattern = /\[(\d+)\]/g;
    
    let processedText = text;
    interface CitationPlaceholder {
      num: string;
      data: CitationDataType;
      original: string;
    }
    const citationPlaceholders: Record<string, CitationPlaceholder> = {};
    let placeholderIndex = 0;
    const seen = seenCitationNums ?? new Set<string>();
    
    processedText = processedText.replace(superscriptPattern, (match) => {
      let numStr = '';
      for (const char of match) {
        numStr += superscriptMap[char] || (/\d/.test(char) ? char : '');
      }
      const citData = citations[numStr];
      if (citData) {
        if (seen.has(numStr)) {
          return '';
        }
        const placeholder = `__CITATION_SUPERSCRIPT_${placeholderIndex}__`;
        citationPlaceholders[placeholder] = { num: numStr, data: citData, original: match };
        placeholderIndex++;
        seen.add(numStr);
        return placeholder;
      }
      return match;
    });
    
    processedText = processedText.replace(/\[(\d+)\]\.\s*(?=\n|$)/g, '[$1]\n');
    processedText = processedText.replace(/\[(\d+)\]\.\s*$/gm, '[$1]');
    
    processedText = processedText.replace(bracketPattern, (match, num) => {
      const citData = citations[num];
      if (citData) {
        if (seen.has(num)) {
          return '';
        }
        const placeholder = `__CITATION_BRACKET_${placeholderIndex}__`;
        citationPlaceholders[placeholder] = { num, data: citData, original: match };
        placeholderIndex++;
        seen.add(num);
        return placeholder;
      }
      return match;
    });
    
    const parts = processedText.split(/(__CITATION_(?:SUPERSCRIPT|BRACKET)_\d+__)/g);
    
    return parts.map((part, idx) => {
      const placeholder = citationPlaceholders[part];
      if (placeholder) {
        return (
          <CitationLink 
            key={`cit-${idx}-${placeholder.num}`} 
            citationNumber={placeholder.num} 
            citationData={placeholder.data} 
            onClick={onCitationClick} 
          />
        );
      }
      return <span key={`text-${idx}`}>{part}</span>;
    });
  }, []);
  
  // Handle citation click
  const handleCitationClick = React.useCallback((citationData: CitationDataType) => {
    if (citationData.doc_id) {
      const page = citationData.page || citationData.page_number || citationData.bbox?.page || 1;
      const highlightData = citationData.bbox ? {
        fileId: citationData.doc_id,
        bbox: {
          ...citationData.bbox,
          page: page
        },
        page: page
      } : undefined;
      openExpandedCardView(
        citationData.doc_id,
        citationData.original_filename || 'document.pdf',
        highlightData
      );
    }
  }, [openExpandedCardView]);
  
  // Get latest messages (queries and responses) - show last 3-5 pairs in correct order
  const getLatestMessages = () => {
    // Get last 6 messages to ensure we have query-response pairs
    const recent = chatMessages.slice(-6);
    // Group queries with their responses and ensure queries come first
    const grouped: ChatMessage[] = [];
    for (let i = 0; i < recent.length; i++) {
      const message = recent[i];
      if (message.type === 'query') {
        // Add query first
        grouped.push(message);
        // Then add its response if it exists and is next
        if (i + 1 < recent.length && recent[i + 1].type === 'response') {
          grouped.push(recent[i + 1]);
          i++; // Skip the response since we've added it
        }
      } else if (message.type === 'response' && grouped.length === 0) {
        // If first message is a response (shouldn't happen, but handle it)
        grouped.push(message);
      }
    }
    // Return last 3-4 pairs (most recent at the end, but queries before responses)
    return grouped.slice(-4);
  };

  const latestMessages = getLatestMessages();
  
  // Auto-scroll to bottom when messages change
  React.useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [latestMessages, chatMessages]);

  // Don't render if bubble shouldn't be visible
  if (!shouldShowBubble) {
    return null;
  }
  
  return (
    <>
      <style>{`
        /* Hide scrollbar for FloatingChatBubble */
        .floating-chat-bubble-messages::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.8, y: -20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.8, y: -20 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        style={{
          position: 'fixed',
          top: '20px',
          left: '20px',
          width: '260px',
          height: '280px',
          backgroundColor: 'rgba(255, 255, 255, 0.7)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: '10px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.05)',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid rgba(255, 255, 255, 0.3)'
        }}
      >
        {/* Header with close button */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '6px 10px 6px 24px', // Increased left padding slightly more for better alignment
            borderBottom: '1px solid rgba(229, 231, 235, 0.3)',
            flexShrink: 0,
            backgroundColor: 'rgba(255, 255, 255, 0.2)'
          }}
        >
          <h3
            style={{
              fontSize: '11px',
              fontWeight: 500,
              color: '#6B7280',
              margin: 0,
              letterSpacing: '0.01em'
            }}
          >
            Recent Queries
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '4px',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(243, 244, 246, 0.5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            title="Close"
          >
            <X className="w-3 h-3 text-gray-600" />
          </button>
        </div>

        {/* Messages list - render exactly like SideChatPanel */}
        <div
          ref={messagesContainerRef}
          className="floating-chat-bubble-messages"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px', // Smaller gap for compact bubble
            scrollbarWidth: 'none', // Hide scrollbar for Firefox
            msOverflowStyle: 'none', // Hide scrollbar for IE and Edge
          }}
        >
          {latestMessages.length === 0 ? (
            <div
              style={{
                fontSize: '9px',
                color: '#6B7280',
                textAlign: 'center',
                padding: '12px 0'
              }}
            >
              No queries yet
            </div>
          ) : (
            latestMessages.map((message, index) => {
              // Check if previous message was a query (to add spacing between query-response pairs)
              const prevMessage = index > 0 ? latestMessages[index - 1] : null;
              const isNewPair = prevMessage && prevMessage.type === 'response' && message.type === 'query';
              
              return message.type === 'query' ? (
                // Query message container - aligned with response text
                <div
                  key={message.id}
                  style={{
                    width: '100%',
                    marginTop: isNewPair ? '8px' : '8px',
                    marginLeft: '0',
                    marginBottom: '0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    paddingLeft: '12px', // Match response text padding
                    paddingRight: '12px',
                    boxSizing: 'border-box'
                  }}
                >
                  {/* Query bubble - aligned with response text */}
                  <div
                    style={{
                      backgroundColor: '#F5F5F5',
                      borderRadius: '8px',
                      paddingTop: '4px',
                      paddingBottom: '4px',
                      paddingLeft: '8px',
                      paddingRight: '8px',
                      border: '1px solid rgba(0, 0, 0, 0.08)',
                      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                      width: 'fit-content',
                      maxWidth: '100%',
                      wordWrap: 'break-word',
                      display: 'inline-block',
                      boxSizing: 'border-box',
                      marginLeft: '0' // Ensure bubble starts at container's left edge (which has 12px padding)
                    }}
                  >
                    {/* Display file attachments if any */}
                    {message.attachments && message.attachments.length > 0 && (
                      <div style={{ marginBottom: (message.text || (message.propertyAttachments && message.propertyAttachments.length > 0)) ? '8px' : '0', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {message.attachments.map((attachment) => (
                          <QueryAttachment key={attachment.id} attachment={attachment} />
                        ))}
                      </div>
                    )}
                    
                    {/* Chips + query text in input order (contentSegments) or fallback to chips then text */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', width: '100%' }}>
                      {message.contentSegments && message.contentSegments.length > 0
                        ? message.contentSegments.map((seg, idx) => {
                            if (seg.type === 'text') {
                              if (!seg.value) return null;
                              return (
                                <span
                                  key={`t-${idx}`}
                                  style={{
                                    color: '#0D0D0D',
                                    fontSize: '11px',
                                    lineHeight: '13px',
                                    margin: 0,
                                    padding: 0,
                                    textAlign: 'left',
                                    fontFamily: 'system-ui, -apple-system, sans-serif',
                                    flex: '1 1 auto',
                                    minWidth: 0,
                                    wordWrap: 'break-word',
                                    overflowWrap: 'break-word'
                                  }}
                                >
                                  <ReactMarkdown
                                    components={{
                                      p: ({ children }) => <p style={{ margin: 0, padding: 0, display: 'block' }}>{children}</p>,
                                      h1: ({ children }) => <h1 style={{ fontSize: '12px', fontWeight: 600, margin: '8px 0 6px 0' }}>{children}</h1>,
                                      h2: () => null,
                                      h3: ({ children }) => <h3 style={{ fontSize: '11px', fontWeight: 600, margin: '6px 0 3px 0' }}>{children}</h3>,
                                      ul: ({ children }) => <ul style={{ margin: '6px 0', paddingLeft: '16px' }}>{children}</ul>,
                                      ol: ({ children }) => <ol style={{ margin: '6px 0', paddingLeft: '16px' }}>{children}</ol>,
                                      li: ({ children }) => <li style={{ marginBottom: '3px' }}>{children}</li>,
                                      strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
                                      em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
                                      code: ({ children }) => <code style={{ backgroundColor: '#f3f4f6', padding: '1px 3px', borderRadius: '2px', fontSize: '10px', fontFamily: 'monospace' }}>{children}</code>,
                                      blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid #d1d5db', paddingLeft: '12px', margin: '8px 0', color: '#6b7280' }}>{children}</blockquote>,
                                      hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '16px 0' }} />,
                                      table: ({ children }) => (
                                        <div style={{ overflowX: 'auto', margin: '12px 0' }}>
                                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>{children}</table>
                                        </div>
                                      ),
                                      thead: ({ children }) => <thead style={{ backgroundColor: '#f9fafb' }}>{children}</thead>,
                                      tbody: ({ children }) => <tbody>{children}</tbody>,
                                      tr: ({ children }) => <tr style={{ borderBottom: '1px solid #e5e7eb' }}>{children}</tr>,
                                      th: ({ children }) => <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#111827', borderBottom: '2px solid #d1d5db' }}>{children}</th>,
                                      td: ({ children }) => <td style={{ padding: '8px 12px', textAlign: 'left', color: '#374151' }}>{children}</td>,
                                    }}
                                  >
                                    {seg.value}
                                  </ReactMarkdown>
                                </span>
                              );
                            }
                            if (seg.type === 'property') {
                              const prop = seg.attachment;
                              const part = (prop.address || '').split(',')[0] || prop.address || '';
                              const label = part.length > 30 ? part.slice(0, 27) + '...' : part;
                              return (
                                <AtMentionChip
                                  key={`p-${idx}-${prop.id}`}
                                  type="property"
                                  label={label}
                                  title={`Click to view ${prop.address}`}
                                />
                              );
                            }
                            const label = seg.name.length > 30 ? seg.name.slice(0, 27) + '...' : seg.name;
                            return (
                              <AtMentionChip key={`d-${idx}-${seg.id}`} type="document" label={label} />
                            );
                          })
                        : (
                          <>
                            {message.propertyAttachments?.map((prop, i) => {
                              const part = (prop.address || '').split(',')[0] || prop.address || '';
                              const label = part.length > 30 ? part.slice(0, 27) + '...' : part;
                              return (
                                <AtMentionChip
                                  key={prop.id ?? prop.property?.id ?? prop.address ?? `prop-${i}`}
                                  type="property"
                                  label={label}
                                  title={`Click to view ${prop.address}`}
                                />
                              );
                            })}
                            {message.selectedDocumentIds?.map((docId, i) => {
                              const name = message.selectedDocumentNames?.[i] ?? docId;
                              const label = name.length > 30 ? name.slice(0, 27) + '...' : name;
                              return (
                                <AtMentionChip key={docId} type="document" label={label} />
                              );
                            })}
                            {message.text ? (
                              <span style={{
                                color: '#0D0D0D',
                                fontSize: '11px',
                                lineHeight: '13px',
                                margin: 0,
                                padding: 0,
                                textAlign: 'left',
                                fontFamily: 'system-ui, -apple-system, sans-serif',
                                width: '100%',
                                boxSizing: 'border-box',
                                display: 'block',
                                flex: '1 1 auto',
                                minWidth: 0
                              }}>
                                <ReactMarkdown
                                  components={{
                                    p: ({ children }) => <p style={{ margin: 0, padding: 0, display: 'block' }}>{children}</p>,
                                    h1: ({ children }) => <h1 style={{ fontSize: '12px', fontWeight: 600, margin: '8px 0 6px 0' }}>{children}</h1>,
                                    h2: () => null,
                                    h3: ({ children }) => <h3 style={{ fontSize: '11px', fontWeight: 600, margin: '6px 0 3px 0' }}>{children}</h3>,
                                    ul: ({ children }) => <ul style={{ margin: '6px 0', paddingLeft: '16px' }}>{children}</ul>,
                                    ol: ({ children }) => <ol style={{ margin: '6px 0', paddingLeft: '16px' }}>{children}</ol>,
                                    li: ({ children }) => <li style={{ marginBottom: '3px' }}>{children}</li>,
                                    strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
                                    em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
                                    code: ({ children }) => <code style={{ backgroundColor: '#f3f4f6', padding: '1px 3px', borderRadius: '2px', fontSize: '10px', fontFamily: 'monospace' }}>{children}</code>,
                                    blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid #d1d5db', paddingLeft: '12px', margin: '8px 0', color: '#6b7280' }}>{children}</blockquote>,
                                    hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '16px 0' }} />,
                                    table: ({ children }) => (
                                      <div style={{ overflowX: 'auto', margin: '12px 0' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>{children}</table>
                                      </div>
                                    ),
                                    thead: ({ children }) => <thead style={{ backgroundColor: '#f9fafb' }}>{children}</thead>,
                                    tbody: ({ children }) => <tbody>{children}</tbody>,
                                    tr: ({ children }) => <tr style={{ borderBottom: '1px solid #e5e7eb' }}>{children}</tr>,
                                    th: ({ children }) => <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#111827', borderBottom: '2px solid #d1d5db' }}>{children}</th>,
                                    td: ({ children }) => <td style={{ padding: '8px 12px', textAlign: 'left', color: '#374151' }}>{children}</td>,
                                  }}
                                >
                                  {message.text}
                                </ReactMarkdown>
                              </span>
                            ) : null}
                          </>
                        )}
                    </div>
                  </div>
                </div>
              ) : (
                // Response message - same styling as SideChatPanel (scaled down)
                <div
                  key={message.id}
                  style={{
                    width: '100%',
                    padding: '0',
                    margin: '0',
                    marginTop: '6px',
                    marginBottom: '0',
                    wordWrap: 'break-word',
                    position: 'relative',
                    contain: 'layout style'
                  }}
                >
                  <div style={{ 
                    position: 'relative',
                    minHeight: '1px'
                  }}>
                    {/* Reasoning Steps - scaled down version */}
                    {message.reasoningSteps && message.reasoningSteps.length > 0 && (message.isLoading || message.text) && (
                      <div style={{ transform: 'scale(0.85)', transformOrigin: 'top left', marginBottom: '4px' }}>
                        <ReasoningSteps 
                          key={`reasoning-${message.id}`} 
                          steps={message.reasoningSteps} 
                          isLoading={message.isLoading} 
                          onDocumentClick={() => {}} 
                          hasResponseText={!!message.text} 
                        />
                      </div>
                    )}
                    
                    
                    {/* Display response text with citations - rendered markdown */}
                    {message.text && (
                      <div style={{
                        color: '#374151',
                        fontSize: '10px',
                        lineHeight: '14px',
                        margin: 0,
                        padding: '2px 10px',
                        textAlign: 'left',
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                        fontWeight: 400
                      }}>
                        <ReactMarkdown
                          skipHtml={true}
                          components={{
                            p: ({ children }) => {
                              const citationSeen = new Set<string>();
                              const processChildren = (nodes: React.ReactNode): React.ReactNode => {
                                return React.Children.map(nodes, child => {
                                  if (typeof child === 'string' && message.citations) {
                                    return renderTextWithCitations(child, message.citations, handleCitationClick, citationSeen);
                                  }
                                  if (React.isValidElement(child)) {
                                    const childChildren = (child.props as any)?.children;
                                    if (childChildren !== undefined) {
                                      return React.cloneElement(child, { ...child.props, children: processChildren(childChildren) } as any);
                                    }
                                  }
                                  return child;
                                });
                              };
                              return <p style={{ margin: 0, marginBottom: '4px', textAlign: 'left' }}>{processChildren(children)}</p>;
                            },
                            h1: ({ children }) => <h1 style={{ fontSize: '11px', fontWeight: 600, margin: '6px 0 4px 0', color: '#111827', textAlign: 'left' }}>{children}</h1>,
                            h2: () => null,
                            h3: ({ children }) => <h3 style={{ fontSize: '10px', fontWeight: 600, margin: '4px 0 2px 0', textAlign: 'left' }}>{children}</h3>,
                            ul: ({ children }) => <ul style={{ margin: '4px 0', paddingLeft: '14px', textAlign: 'left' }}>{children}</ul>,
                            ol: ({ children }) => <ol style={{ margin: '4px 0', paddingLeft: '14px', textAlign: 'left' }}>{children}</ol>,
                            li: ({ children }) => <li style={{ marginBottom: '2px', textAlign: 'left' }}>{children}</li>,
                            strong: ({ children }) => {
                              const citationSeen = new Set<string>();
                              const processChildren = (nodes: React.ReactNode): React.ReactNode => {
                                return React.Children.map(nodes, child => {
                                  if (typeof child === 'string' && message.citations) {
                                    return renderTextWithCitations(child, message.citations, handleCitationClick, citationSeen);
                                  }
                                  if (React.isValidElement(child)) {
                                    const childChildren = (child.props as any)?.children;
                                    if (childChildren !== undefined) {
                                      return React.cloneElement(child, { ...child.props, children: processChildren(childChildren) } as any);
                                    }
                                  }
                                  return child;
                                });
                              };
                              return <strong style={{ fontWeight: 600, textAlign: 'left' }}>{processChildren(children)}</strong>;
                            },
                            em: ({ children }) => {
                              const citationSeen = new Set<string>();
                              const processChildren = (nodes: React.ReactNode): React.ReactNode => {
                                return React.Children.map(nodes, child => {
                                  if (typeof child === 'string' && message.citations) {
                                    return renderTextWithCitations(child, message.citations, handleCitationClick, citationSeen);
                                  }
                                  if (React.isValidElement(child)) {
                                    const childChildren = (child.props as any)?.children;
                                    if (childChildren !== undefined) {
                                      return React.cloneElement(child, { ...child.props, children: processChildren(childChildren) } as any);
                                    }
                                  }
                                  return child;
                                });
                              };
                              return <em style={{ fontStyle: 'italic', textAlign: 'left' }}>{processChildren(children)}</em>;
                            },
                            code: ({ children }) => <code style={{ backgroundColor: '#f3f4f6', padding: '1px 2px', borderRadius: '2px', fontSize: '9px', fontFamily: 'monospace', textAlign: 'left' }}>{children}</code>,
                            blockquote: ({ children }) => <blockquote style={{ borderLeft: '2px solid #d1d5db', paddingLeft: '10px', margin: '4px 0', color: '#6b7280', textAlign: 'left' }}>{children}</blockquote>,
                            hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '8px 0' }} />,
                          }}
                        >
                          {message.text}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Open chat button */}
        <div
          style={{
            padding: '8px 12px',
            borderTop: '1px solid rgba(229, 231, 235, 0.2)',
            flexShrink: 0,
            backgroundColor: 'rgba(255, 255, 255, 0.2)'
          }}
        >
          <button
            onClick={onOpenChat}
            style={{
              width: '100%',
              padding: '8px 16px',
              backgroundColor: '#ffffff',
              color: '#111827',
              border: '1px solid rgba(229, 231, 235, 0.8)',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f9fafb';
              e.currentTarget.style.borderColor = 'rgba(209, 213, 219, 0.8)';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.12)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#ffffff';
              e.currentTarget.style.borderColor = 'rgba(229, 231, 235, 0.8)';
              e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.1)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.12)';
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
            <span>Open chat</span>
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
    </>
  );
};

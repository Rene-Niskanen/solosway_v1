"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, FileCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { FileAttachmentData } from './FileAttachment';
import { PropertyAttachmentData } from './PropertyAttachment';
import { usePreview } from '../contexts/PreviewContext';

// True 3D Globe component using CSS 3D transforms (scaled for bubble)
const Globe3D: React.FC = () => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const rotationRef = React.useRef({ x: 0, y: 0 });
  const animationFrameRef = React.useRef<number>();
  const lastTimeRef = React.useRef<number>(performance.now());

  React.useEffect(() => {
    const animate = (currentTime: number) => {
      const deltaTime = currentTime - lastTimeRef.current;
      lastTimeRef.current = currentTime;
      
      // Smooth rotation based on time delta for consistent speed
      rotationRef.current.y += (deltaTime / 16) * 0.5; // ~30 degrees per second
      rotationRef.current.x += (deltaTime / 16) * 0.25; // ~15 degrees per second
      
      if (containerRef.current) {
        containerRef.current.style.transform = 
          `rotateX(${rotationRef.current.x}deg) rotateY(${rotationRef.current.y}deg)`;
      }
      
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const radius = 3.5; // Scaled down from 5 for smaller bubble
  const rings = 12; // Reduced for better performance

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        marginTop: '-3.5px',
        marginLeft: '-3.5px',
        width: '7px',
        height: '7px',
        transformStyle: 'preserve-3d',
        willChange: 'transform',
        zIndex: 1
      }}
    >
      {/* Create solid sphere using multiple filled rings in 3D space */}
      {Array.from({ length: rings }).map((_, ringIndex) => {
        const phi = (Math.PI * ringIndex) / (rings - 1); // Latitude angle (0 to π)
        const ringRadius = Math.abs(Math.sin(phi)) * radius;
        const z = Math.cos(phi) * radius; // Z position in 3D space
        
        return (
          <div
            key={`ring-${ringIndex}`}
            style={{
              position: 'absolute',
              width: `${ringRadius * 2}px`,
              height: `${ringRadius * 2}px`,
              top: '50%',
              left: '50%',
              marginTop: `${-ringRadius}px`,
              marginLeft: `${-ringRadius}px`,
              borderRadius: '50%',
              backgroundColor: 'rgba(229, 231, 235, 0.75)',
              border: 'none',
              transform: `translateZ(${z}px)`,
              transformStyle: 'preserve-3d',
              backfaceVisibility: 'visible',
              WebkitBackfaceVisibility: 'visible',
              willChange: 'transform'
            }}
          />
        );
      })}
    </div>
  );
};

interface ChatMessage {
  id: string;
  type: 'query' | 'response';
  text: string;
  attachments?: FileAttachmentData[];
  propertyAttachments?: PropertyAttachmentData[];
  selectedDocumentIds?: string[];
  selectedDocumentNames?: string[];
  isLoading?: boolean;
}

interface FloatingChatBubbleProps {
  chatMessages: ChatMessage[];
  onOpenChat: () => void;
  onClose: () => void;
}

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

  return (
    <>
      <style>{`
        @keyframes rotateRing {
          0% {
            transform: rotateX(45deg) rotateY(-45deg) rotateZ(0deg);
          }
          50% {
            transform: rotateX(45deg) rotateY(-45deg) rotateZ(180deg);
          }
          100% {
            transform: rotateX(45deg) rotateY(-45deg) rotateZ(360deg);
          }
        }
        @keyframes rotateAtom {
          from {
            transform: rotateY(0deg);
          }
          to {
            transform: rotateY(360deg);
          }
        }
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
          width: '300px',
          height: '300px',
          backgroundColor: 'rgba(255, 255, 255, 0.7)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: '12px',
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
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '13px', // Scaled from 16px (SideChatPanel) relative to 11px/13px font ratio
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
                  {/* Display selected documents indicator above bubble */}
                  {message.selectedDocumentIds && message.selectedDocumentIds.length > 0 && (
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '6px',
                      padding: '4px 8px',
                      backgroundColor: 'transparent',
                      borderRadius: '6px',
                      fontSize: '11px',
                      color: '#6B7280',
                      marginBottom: '2px'
                    }}>
                      <FileCheck size={12} style={{ flexShrink: 0, color: '#9CA3AF' }} />
                      <span style={{ fontWeight: 400 }}>
                        {message.selectedDocumentIds.length === 1 && message.selectedDocumentNames && message.selectedDocumentNames.length > 0
                          ? message.selectedDocumentNames[0]
                          : `${message.selectedDocumentIds.length} ${message.selectedDocumentIds.length === 1 ? 'document' : 'documents'} selected`}
                      </span>
                    </div>
                  )}
                  
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
                    
                    {/* Display property attachments if any */}
                    {message.propertyAttachments && message.propertyAttachments.length > 0 && (
                      <div style={{ marginBottom: message.text ? '8px' : '0', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {message.propertyAttachments.map((property) => (
                          <QueryPropertyAttachment key={property.id} attachment={property} />
                        ))}
                      </div>
                    )}
                    
                    {/* Display query text - same as SideChatPanel */}
                    {message.text && (
                      <div style={{
                        color: '#0D0D0D',
                        fontSize: '11px',
                        lineHeight: '13px', // Tighter line height to reduce vertical space
                        margin: 0,
                        padding: 0,
                        textAlign: 'left',
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                        width: '100%',
                        boxSizing: 'border-box',
                        display: 'block' // Changed from inline to block for better spacing control
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
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                // Response message - same styling as SideChatPanel
                <div
                  key={message.id}
                  style={{
                    width: '100%',
                    padding: '0',
                    margin: '0',
                    marginTop: '8px',
                    marginBottom: '0',
                    wordWrap: 'break-word'
                  }}
                >
                  {/* Display loading state for responses - Globe with rotating ring (atom-like) */}
                  {message.isLoading && (
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'flex-start',
                      padding: '3px 0',
                      position: 'relative',
                      width: '20px', // Scaled from 28px
                      height: '20px', // Scaled from 28px
                      perspective: '110px', // Scaled from 150px
                      perspectiveOrigin: 'center center',
                      overflow: 'visible',
                      marginLeft: '12px' // Align with query bubbles and response text padding
                    }}>
                      {/* Atom container - rotates globe and ring together */}
                      <div style={{
                        position: 'absolute',
                        width: '20px',
                        height: '20px',
                        top: '50%',
                        left: '50%',
                        marginTop: '-10px',
                        marginLeft: '-10px',
                        animation: 'rotateAtom 0.65s linear infinite',
                        transformOrigin: 'center center',
                        transformStyle: 'preserve-3d',
                        overflow: 'visible'
                      }}>
                        {/* Tilted ring - diagonal spiral */}
                        <div style={{
                          position: 'absolute',
                          width: '11px', // Scaled from 16px
                          height: '11px', // Scaled from 16px
                          top: '50%',
                          left: '50%',
                          marginTop: '-5.5px',
                          marginLeft: '-5.5px',
                          borderRadius: '50%',
                          border: '1px solid rgba(212, 175, 55, 0.5)',
                          borderTopColor: 'rgba(212, 175, 55, 0.9)',
                          borderRightColor: 'rgba(212, 175, 55, 0.7)',
                          boxShadow: '0 0 4px rgba(212, 175, 55, 0.4), 0 0 2px rgba(212, 175, 55, 0.2)',
                          animation: 'rotateRing 1.5s linear infinite',
                          transformOrigin: 'center center',
                          transformStyle: 'preserve-3d',
                          willChange: 'transform',
                          backfaceVisibility: 'visible',
                          WebkitBackfaceVisibility: 'visible'
                        }} />
                        {/* Central globe - True 3D sphere using canvas */}
                        <Globe3D />
                      </div>
                    </div>
                  )}
                  
                  {/* Display response text - rendered markdown */}
                  {message.text && (
                    <div style={{
                      color: '#374151',
                      fontSize: '11px',
                      lineHeight: '16px', // Scaled from 19px (13px font) to 16px (11px font)
                      margin: 0,
                      padding: '3px 12px',
                      textAlign: 'left',
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      fontWeight: 400
                    }}>
                        <ReactMarkdown
                          components={{
                            p: ({ children }) => <p style={{ margin: 0, marginBottom: '6px', textAlign: 'left', paddingLeft: 0, paddingRight: 0, textIndent: 0 }}>{children}</p>,
                          h1: ({ children }) => <h1 style={{ fontSize: '12px', fontWeight: 600, margin: '8px 0 6px 0', color: '#111827', textAlign: 'left' }}>{children}</h1>,
                          h2: () => null,
                          h3: () => null,
                          ul: ({ children }) => <ul style={{ margin: '6px 0', paddingLeft: '0', listStylePosition: 'inside', textAlign: 'left' }}>{children}</ul>,
                          ol: ({ children }) => <ol style={{ margin: '6px 0', paddingLeft: '0', listStylePosition: 'inside', textAlign: 'left' }}>{children}</ol>,
                          li: ({ children }) => <li style={{ marginBottom: '3px', textAlign: 'left' }}>{children}</li>,
                          strong: ({ children }) => <strong style={{ fontWeight: 600, textAlign: 'left' }}>{children}</strong>,
                          em: ({ children }) => <em style={{ fontStyle: 'italic', textAlign: 'left' }}>{children}</em>,
                          code: ({ children }) => <code style={{ backgroundColor: '#f3f4f6', padding: '1px 3px', borderRadius: '2px', fontSize: '10px', fontFamily: 'monospace', textAlign: 'left' }}>{children}</code>,
                          blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid #d1d5db', paddingLeft: '12px', margin: '8px 0', color: '#6b7280', textAlign: 'left' }}>{children}</blockquote>,
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
                    </div>
                  )}
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

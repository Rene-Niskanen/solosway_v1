"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ArrowUp, Paperclip, Mic, Map, X, SquareDashedMousePointer, Scan, Fullscreen, Plus, PanelLeft, Trash2, CreditCard, MoveDiagonal, Square, FileText, Image as ImageIcon, File as FileIcon, FileCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { FileAttachment, FileAttachmentData } from './FileAttachment';
import { PropertyAttachment, PropertyAttachmentData } from './PropertyAttachment';
import { toast } from "@/hooks/use-toast";
import { usePreview } from '../contexts/PreviewContext';
import { usePropertySelection } from '../contexts/PropertySelectionContext';
import { useDocumentSelection } from '../contexts/DocumentSelectionContext';
import { PropertyData } from './PropertyResultsDisplay';
import { useChatHistory } from './ChatHistoryContext';
import { backendApi } from '../services/backendApi';

// Component for displaying property attachment in query bubble
const QueryPropertyAttachment: React.FC<{ 
  attachment: PropertyAttachmentData;
  onOpenProperty?: (attachment: PropertyAttachmentData) => void;
}> = ({ attachment, onOpenProperty }) => {
  const imageUrl = attachment.imageUrl || attachment.property.image || attachment.property.primary_image_url;
  
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('🖱️ QueryPropertyAttachment clicked:', attachment);
    console.log('🔍 onOpenProperty callback exists:', !!onOpenProperty);
    if (onOpenProperty) {
      console.log('✅ Calling onOpenProperty callback with attachment:', attachment);
      try {
        onOpenProperty(attachment);
        console.log('✅ onOpenProperty callback executed successfully');
      } catch (error) {
        console.error('❌ Error calling onOpenProperty:', error);
      }
    } else {
      console.warn('⚠️ onOpenProperty callback not provided');
    }
  };
  
  if (imageUrl) {
    return (
      <div
        onClick={handleClick}
        onMouseDown={(e) => {
          // Ensure click works even if there are other handlers
          e.stopPropagation();
        }}
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
            pointerEvents: 'none' // Allow clicks to pass through to parent div
          }}
          onError={(e) => {
            e.currentTarget.src = 'https://via.placeholder.com/40x40/94a3b8/ffffff?text=Property';
          }}
        />
      </div>
    );
  }
  
  // For properties without images, show property icon
  return (
    <div
      onClick={handleClick}
      onMouseDown={(e) => {
        // Ensure click works even if there are other handlers
        e.stopPropagation();
      }}
      style={{
        width: '40px',
        height: '40px',
        borderRadius: '4px',
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
      <span style={{ fontSize: '20px', pointerEvents: 'none' }}>🏠</span>
    </div>
  );
};

// Component for displaying attachment in query bubble
const QueryAttachment: React.FC<{ attachment: FileAttachmentData }> = ({ attachment }) => {
  const isImage = attachment.type.startsWith('image/');
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const { addPreviewFile } = usePreview();
  
  // Create blob URL for images
  React.useEffect(() => {
    if (isImage && attachment.file) {
      // Check for preloaded blob URL first
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
      // Ensure the File object is still valid by creating a fresh attachment object
      // This prevents issues when reopening previews after closing
      const freshAttachment: FileAttachmentData = {
        ...attachment,
        file: attachment.file // Ensure we're using the current file reference
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
  
  // For non-image files, show file name with icon
  return (
    <div
      style={{
        fontSize: '11px',
        color: '#6B7280',
        backgroundColor: '#F3F4F6',
        padding: '2px 6px',
        borderRadius: '4px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px'
      }}
    >
      <span>📎</span>
      <span>{attachment.name}</span>
    </div>
  );
};

// True 3D Globe component using CSS 3D transforms
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

  const radius = 5;
  const rings = 16; // Reduced for better performance while maintaining solid appearance

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        marginTop: '-5px',
        marginLeft: '-5px',
        width: '10px',
        height: '10px',
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
              backgroundColor: 'rgba(229, 231, 235, 0.75)', // Slightly more opaque for better blending
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

interface SideChatPanelProps {
  isVisible: boolean;
  query: string;
  sidebarWidth?: number; // Width of the sidebar to offset the panel
  onQuerySubmit?: (query: string) => void; // Callback for submitting new queries from panel
  onMapToggle?: () => void; // Callback for toggling map view
  restoreChatId?: string | null; // Chat ID to restore from history
  onNewChat?: () => void; // Callback when new chat is clicked (to clear query in parent)
  onSidebarToggle?: () => void; // Callback for toggling sidebar
  onOpenProperty?: (address: string, coordinates?: { lat: number; lng: number }, propertyId?: string | number) => void; // Callback for opening property card
  initialAttachedFiles?: FileAttachmentData[]; // Initial file attachments to restore
  onChatWidthChange?: (width: number) => void; // Callback when chat panel width changes (for map resizing)
  isPropertyDetailsOpen?: boolean; // Whether PropertyDetailsPanel is currently open
}

export interface SideChatPanelRef {
  getAttachments: () => FileAttachmentData[];
}

export const SideChatPanel = React.forwardRef<SideChatPanelRef, SideChatPanelProps>(({
  isVisible,
  query,
  sidebarWidth = 56, // Default to desktop sidebar width (lg:w-14 = 56px)
  onQuerySubmit,
  onMapToggle,
  restoreChatId,
  onNewChat,
  onSidebarToggle,
  onOpenProperty,
  initialAttachedFiles,
  onChatWidthChange,
  isPropertyDetailsOpen = false // Default to false
}, ref) => {
  const [inputValue, setInputValue] = React.useState<string>("");
  const [isSubmitted, setIsSubmitted] = React.useState<boolean>(false);
  const [isFocused, setIsFocused] = React.useState<boolean>(false);
  // Always start in multi-line mode for the requested layout (textarea above icons)
  const [isMultiLine, setIsMultiLine] = React.useState<boolean>(true);
  // State for expanded chat view (half screen)
  const [isExpanded, setIsExpanded] = React.useState<boolean>(false);
  
  // Calculate and notify parent of chat panel width changes
  React.useEffect(() => {
    if (onChatWidthChange && isVisible) {
      // When PropertyDetailsPanel is open, use narrower width (35vw instead of 50vw when expanded)
      const chatWidth = isExpanded 
        ? (isPropertyDetailsOpen ? window.innerWidth * 0.35 : window.innerWidth * 0.5)
        : 450; // Fixed 450px when collapsed
      onChatWidthChange(chatWidth);
    } else if (onChatWidthChange && !isVisible) {
      // Chat is hidden, notify parent that width is 0
      onChatWidthChange(0);
    }
  }, [isExpanded, isVisible, isPropertyDetailsOpen, onChatWidthChange]);
  const hasInitializedAttachmentsRef = React.useRef(false);
  const attachedFilesRef = React.useRef<FileAttachmentData[]>([]);
  const abortControllerRef = React.useRef<AbortController | null>(null); // For cancelling streaming queries
  const [attachedFiles, setAttachedFiles] = React.useState<FileAttachmentData[]>(() => {
    const initial = initialAttachedFiles || [];
    if (initialAttachedFiles !== undefined && initialAttachedFiles.length > 0) {
      hasInitializedAttachmentsRef.current = true;
    }
    attachedFilesRef.current = initial;
    return initial;
  });
  
  // Update attachedFilesRef whenever attachedFiles state changes
  React.useEffect(() => {
    attachedFilesRef.current = attachedFiles;
  }, [attachedFiles]);

  // Function to stop streaming query
  const handleStopQuery = React.useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      
      // Mark the current loading message as stopped
      setChatMessages(prev => {
        const updated = prev.map(msg => 
          msg.isLoading 
            ? { ...msg, isLoading: false }
            : msg
        );
        persistedChatMessagesRef.current = updated;
        return updated;
      });
    }
  }, []);
  
  // Expose getAttachments method via ref
  React.useImperativeHandle(ref, () => ({
    getAttachments: () => {
      return attachedFilesRef.current;
    }
  }), []);
  
  // Restore attachments when initialAttachedFiles prop changes
  const prevInitialAttachedFilesRef = React.useRef<FileAttachmentData[] | undefined>(initialAttachedFiles);
  React.useLayoutEffect(() => {
    const prevInitial = prevInitialAttachedFilesRef.current;
    prevInitialAttachedFilesRef.current = initialAttachedFiles;
    
    if (initialAttachedFiles !== undefined) {
      const currentIds = attachedFiles.map(f => f.id).sort().join(',');
      const newIds = initialAttachedFiles.map(f => f.id).sort().join(',');
      const isDifferent = currentIds !== newIds || attachedFiles.length !== initialAttachedFiles.length;
      const propChanged = prevInitial !== initialAttachedFiles;
      
      const shouldRestore = !hasInitializedAttachmentsRef.current || 
                           isDifferent || 
                           (attachedFiles.length === 0 && initialAttachedFiles.length > 0) ||
                           (propChanged && initialAttachedFiles.length > 0);
      
      if (shouldRestore) {
        setAttachedFiles(initialAttachedFiles);
        attachedFilesRef.current = initialAttachedFiles;
        hasInitializedAttachmentsRef.current = true;
      }
    }
  }, [initialAttachedFiles, attachedFiles]);
  const [isDraggingFile, setIsDraggingFile] = React.useState(false);
  const [isOverBin, setIsOverBin] = React.useState(false);
  const [draggedFileId, setDraggedFileId] = React.useState<string | null>(null);
  
  // Use document selection context
  const {
    selectedDocumentIds,
    isDocumentSelectionMode,
    toggleDocumentSelectionMode,
    clearSelectedDocuments,
    setDocumentSelectionMode
  } = useDocumentSelection();
  
  // Store queries with their attachments
  interface SubmittedQuery {
    text: string;
    attachments: FileAttachmentData[];
  }
  
  // Store messages (both queries and responses)
  interface ReasoningStep {
    step: string;
    message: string;
    details: any;
    timestamp: number;
  }

  interface CitationData {
    doc_id: string;
    original_filename: string;
    property_address: string;
    page_range: string;
    classification_type: string;
    source_chunks_metadata: Array<{
      content: string;
      chunk_index: number;
      page_number?: number;
      bbox?: {
        left: number;
        top: number;
        width: number;
        height: number;
        page: number;
      };
      vector_id?: string;
      similarity?: number;
    }>;
  }

  interface ChatMessage {
    id: string;
    type: 'query' | 'response';
    text: string;
    attachments?: FileAttachmentData[];
    propertyAttachments?: PropertyAttachmentData[];
    selectedDocumentIds?: string[]; // Document IDs selected when query was sent
    selectedDocumentNames?: string[]; // Document names for display
    isLoading?: boolean;
    reasoningSteps?: ReasoningStep[]; // Reasoning steps for this message
    citations?: Record<string, CitationData>; // NEW: Citations with bbox metadata
  }
  
  const [submittedQueries, setSubmittedQueries] = React.useState<SubmittedQuery[]>([]);
  const [chatMessages, setChatMessages] = React.useState<ChatMessage[]>([]);
  // Persist chat messages across panel open/close
  const persistedChatMessagesRef = React.useRef<ChatMessage[]>([]);
  // Track message IDs that existed when panel was last opened (for animation control)
  const restoredMessageIdsRef = React.useRef<Set<string>>(new Set());
  const MAX_FILES = 4;

  // NEW: Function to parse citations from text and replace with styled components
  const parseCitations = (text: string, citations?: Record<string, CitationData>): React.ReactNode[] => {
    if (!citations || Object.keys(citations).length === 0) {
      return [text];
    }

    // Pattern to match [1], [2], etc.
    const citationPattern = /\[(\d+)\]/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = citationPattern.exec(text)) !== null) {
      // Add text before citation
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }

      const citationNum = match[1];
      const citationData = citations[citationNum];

      // Render citation as styled component
      parts.push(
        <span
          key={`citation-${match.index}-${citationNum}`}
          style={{
            display: 'inline-block',
            backgroundColor: '#E5E7EB', // Light grey
            color: '#6B7280', // Dark grey text
            borderRadius: '4px',
            padding: '2px 6px',
            fontSize: '11px',
            fontWeight: 500,
            lineHeight: '1.2',
            marginLeft: '2px',
            marginRight: '2px',
            verticalAlign: 'baseline',
            cursor: citationData ? 'pointer' : 'default',
            transition: 'background-color 0.2s',
          }}
          onMouseEnter={(e) => {
            if (citationData) {
              e.currentTarget.style.backgroundColor = '#D1D5DB';
            }
          }}
          onMouseLeave={(e) => {
            if (citationData) {
              e.currentTarget.style.backgroundColor = '#E5E7EB';
            }
          }}
          onClick={(e) => {
            if (citationData) {
              e.stopPropagation();
              console.log('📎 Citation clicked:', citationNum, citationData);
              // Phase 1: Open document in viewer
              handleCitationClick(citationData);
            }
          }}
          title={citationData ? `${citationData.original_filename} - ${citationData.property_address}` : undefined}
        >
          {citationNum}
        </span>
      );

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? parts : [text];
  };
  
  // Track which reasoning blocks are expanded (message ID -> boolean)
  const [expandedReasoningBlocks, setExpandedReasoningBlocks] = React.useState<Record<string, boolean>>({});
  const currentQueryIdRef = React.useRef<string | null>(null); // Track which query is currently processing
  
  // Use property selection context
  const { 
    isSelectionModeActive, 
    toggleSelectionMode, 
    setSelectionModeActive,
    propertyAttachments, 
    removePropertyAttachment,
    clearPropertyAttachments 
  } = usePropertySelection();
  
  // Use chat history context
  const { addChatToHistory, getChatById } = useChatHistory();
  
  // Track the last processed query from props to avoid duplicates
  const lastProcessedQueryRef = React.useRef<string>('');
  
  // Process query prop from SearchBar (when in map view)
  React.useEffect(() => {
    // Only process if:
    // 1. Query is provided and not empty
    // 2. Query is different from last processed query
    // 3. Panel is visible
    // 4. Query hasn't already been added to chat messages
    if (query && query.trim() && query !== lastProcessedQueryRef.current && isVisible) {
      const queryText = query.trim();
      
      // Check if this query is already in chat messages
      const isAlreadyAdded = chatMessages.some(msg => 
        msg.type === 'query' && msg.text === queryText
      );
      
      if (!isAlreadyAdded) {
        console.log('📥 SideChatPanel: Processing query from SearchBar:', queryText);
        lastProcessedQueryRef.current = queryText;
        
        // Get selected document IDs if selection mode was used
        const selectedDocIds = selectedDocumentIds.size > 0 
          ? Array.from(selectedDocumentIds) 
          : undefined;
        
        // Try to get document names from property attachments if available
        let selectedDocNames: string[] | undefined = undefined;
        if (selectedDocIds && selectedDocIds.length > 0 && propertyAttachments.length > 0) {
          // Get documents from the first property attachment
          const property = propertyAttachments[0].property as any;
          if (property?.propertyHub?.documents) {
            selectedDocNames = selectedDocIds
              .map(docId => {
                const doc = property.propertyHub.documents.find((d: any) => d.id === docId);
                return doc?.original_filename;
              })
              .filter((name): name is string => !!name);
          }
        }
        
        // Add query message to chat (similar to handleSubmit)
        const queryId = `query-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const newQueryMessage: ChatMessage = {
          id: queryId,
          type: 'query',
          text: queryText,
          attachments: [...attachedFiles],
          propertyAttachments: [...propertyAttachments],
          selectedDocumentIds: selectedDocIds,
          selectedDocumentNames: selectedDocNames
        };
        
        setChatMessages(prev => {
          const updated = [...prev, newQueryMessage];
          persistedChatMessagesRef.current = updated;
          return updated;
        });
        
        // Add loading response message
        const loadingResponseId = `response-loading-${Date.now()}`;
        const loadingMessage: ChatMessage = {
          id: loadingResponseId,
          type: 'response',
          text: '',
          isLoading: true,
          reasoningSteps: [], // Initialize empty array for reasoning steps
          citations: {} // Initialize empty object for citations
        };
        setChatMessages(prev => {
          const updated = [...prev, loadingMessage];
          persistedChatMessagesRef.current = updated;
          return updated;
        });
        
        // Call LLM API to query documents (same logic as handleSubmit)
        (async () => {
          try {
            const propertyId = propertyAttachments.length > 0 
              ? String(propertyAttachments[0].propertyId) 
              : undefined;
            
            const messageHistory = chatMessages
              .filter(msg => (msg.type === 'query' || msg.type === 'response') && msg.text)
              .map(msg => ({
                role: msg.type === 'query' ? 'user' : 'assistant',
                content: msg.text || ''
              }));
            
            const documentIdsArray = selectedDocumentIds.size > 0 
              ? Array.from(selectedDocumentIds) 
              : undefined;
            
            const abortController = new AbortController();
            abortControllerRef.current = abortController;
            
            let accumulatedText = '';
            
            await backendApi.queryDocumentsStreamFetch(
              queryText,
              propertyId,
              messageHistory,
              `session_${Date.now()}`,
              // onToken: Stream each token as it arrives
              (token: string) => {
                accumulatedText += token;
                const responseMessage: ChatMessage = {
                  id: loadingResponseId,
                  type: 'response',
                  text: accumulatedText,
                  isLoading: true  // Still loading while streaming
                };
                
                setChatMessages(prev => {
                  const updated = prev.map(msg => 
                    msg.id === loadingResponseId 
                      ? responseMessage
                      : msg
                  );
                  persistedChatMessagesRef.current = updated;
                  return updated;
                });
              },
              // onComplete: Final response received
              (data: any) => {
                const finalText = data.summary || accumulatedText || "I found some information for you.";
                
                const responseMessage: ChatMessage = {
                  id: loadingResponseId,
                  type: 'response',
                  text: finalText,
                  isLoading: false,
                  citations: data.citations || {} // NEW: Store citations
                };
                
                setChatMessages(prev => {
                  const updated = prev.map(msg => 
                    msg.id === loadingResponseId 
                      ? responseMessage
                      : msg
                  );
                  persistedChatMessagesRef.current = updated;
                  return updated;
                });
              },
              // onError: Handle errors
              (error: string) => {
                console.error('❌ SideChatPanel: Streaming error:', error);
                
                const errorMessage: ChatMessage = {
                  id: loadingResponseId,
                  type: 'response',
                  text: error || 'Sorry, I encountered an error processing your query.',
                  isLoading: false
                };
                
                setChatMessages(prev => {
                  const updated = prev.map(msg => 
                    msg.id === loadingResponseId 
                      ? errorMessage
                      : msg
                  );
                  persistedChatMessagesRef.current = updated;
                  return updated;
                });
              },
              undefined, // onStatus (optional)
              abortController.signal, // abortSignal
              documentIdsArray, // documentIds
              // onReasoningStep: Handle reasoning step events
              (step: { step: string; message: string; details: any }) => {
                console.log('🟡 SideChatPanel: Received reasoning step:', step);
                
                setChatMessages(prev => {
                  const updated = prev.map(msg => {
                    if (msg.id === loadingResponseId) {
                      const existingSteps = msg.reasoningSteps || [];
                      const existingIndex = existingSteps.findIndex(s => s.step === step.step);
                      const newStep: ReasoningStep = {
                        ...step,
                        timestamp: Date.now()
                      };
                      
                      if (existingIndex >= 0) {
                        // Update existing step
                        const updatedSteps = [...existingSteps];
                        updatedSteps[existingIndex] = newStep;
                        return { ...msg, reasoningSteps: updatedSteps };
                      } else {
                        // Add new step - keep reasoning block expanded while adding steps
                        setExpandedReasoningBlocks(prev => ({
                          ...prev,
                          [loadingResponseId]: true
                        }));
                        return { ...msg, reasoningSteps: [...existingSteps, newStep] };
                      }
                    }
                    return msg;
                  });
                  persistedChatMessagesRef.current = updated;
                  return updated;
                });
              }
            );
          } catch (error: any) {
            if (error.name === 'AbortError') {
              console.log('Query aborted');
              return;
            }
            console.error('Error querying documents:', error);
            setChatMessages(prev => {
              const updated = prev.map(msg => 
                msg.id === loadingResponseId
                  ? { ...msg, text: 'Sorry, I encountered an error processing your query.', isLoading: false }
                  : msg
              );
              persistedChatMessagesRef.current = updated;
              return updated;
            });
          }
        })();
      }
    }
  }, [query, isVisible, chatMessages, attachedFiles, propertyAttachments, selectedDocumentIds]);
  
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const contentAreaRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const initialScrollHeightRef = React.useRef<number | null>(null);
  const isDeletingRef = React.useRef(false);
  
  // Use shared preview context
  const {
    addPreviewFile
  } = usePreview();

  // Phase 1: Handle citation click - fetch document and open in viewer
  const handleCitationClick = React.useCallback(async (citationData: CitationData) => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
      const docId = citationData.doc_id;
      
      if (!docId) {
        console.error('❌ Citation missing doc_id:', citationData);
        toast({
          title: "Error",
          description: "Document ID not found in citation",
          variant: "destructive",
        });
        return;
      }

      console.log('📎 Opening document from citation:', citationData.original_filename, 'doc_id:', docId);

      // Fetch document using document_id
      const downloadUrl = `${backendUrl}/api/files/download?document_id=${docId}`;
      
      const response = await fetch(downloadUrl, {
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`Failed to download document: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      
      // Determine file type from blob or citation data
      const fileType = blob.type || 'application/pdf';
      
      // Create File object from blob
      const file = new File([blob], citationData.original_filename || 'document.pdf', {
        type: fileType
      });

      // Convert to FileAttachmentData format for DocumentPreviewModal
      const fileData: FileAttachmentData = {
        id: docId, // Use doc_id as the file ID
        file: file,
        name: citationData.original_filename || 'document.pdf',
        type: fileType,
        size: blob.size
      };

      // Extract highlight metadata from citation (first chunk with bbox)
      let highlightData: { bbox: { left: number; top: number; width: number; height: number; page: number }; fileId: string } | undefined;
      
      if (citationData.source_chunks_metadata && citationData.source_chunks_metadata.length > 0) {
        // Find first chunk with valid bbox
        const chunkWithBbox = citationData.source_chunks_metadata.find(
          (chunk) => chunk.bbox && chunk.bbox.page && chunk.bbox.left !== undefined
        );
        
        if (chunkWithBbox && chunkWithBbox.bbox) {
          highlightData = {
            fileId: docId,
            bbox: {
              left: chunkWithBbox.bbox.left,
              top: chunkWithBbox.bbox.top,
              width: chunkWithBbox.bbox.width,
              height: chunkWithBbox.bbox.height,
              page: chunkWithBbox.bbox.page || chunkWithBbox.page_number || 1
            }
          };
          console.log('📎 Highlight data extracted:', highlightData);
        }
      }

      // Open document in preview modal with highlight
      addPreviewFile(fileData, highlightData);
      
      console.log('✅ Document opened in viewer:', citationData.original_filename, highlightData ? 'with highlight' : 'without highlight');
    } catch (error: any) {
      console.error('❌ Error opening citation document:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to open document",
        variant: "destructive",
      });
    }
  }, [addPreviewFile, toast]);

  // Initialize textarea height on mount
  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      const initialHeight = inputRef.current.scrollHeight;
      initialScrollHeightRef.current = initialHeight;
      inputRef.current.style.height = `${initialHeight}px`;
    }
  }, []);

  // Add custom scrollbar styling and animations for WebKit browsers (Chrome, Safari, Edge)
  React.useEffect(() => {
    const style = document.createElement('style');
    style.id = 'sidechat-scrollbar-style';
    style.textContent = `
      .sidechat-scroll::-webkit-scrollbar {
        width: 6px;
      }
      .sidechat-scroll::-webkit-scrollbar-track {
        background: transparent;
      }
      .sidechat-scroll::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.1);
        border-radius: 3px;
      }
      .sidechat-scroll::-webkit-scrollbar-thumb:hover {
        background: rgba(0, 0, 0, 0.15);
      }
      @keyframes pulse {
        0%, 100% {
          opacity: 0.4;
        }
        50% {
          opacity: 1;
        }
      }
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
      @keyframes rotateGlobe {
        from {
          transform: rotateX(0deg) rotateY(0deg);
        }
        to {
          transform: rotateX(360deg) rotateY(360deg);
        }
      }
    `;
    if (!document.getElementById('sidechat-scrollbar-style')) {
      document.head.appendChild(style);
    }
    return () => {
      const existingStyle = document.getElementById('sidechat-scrollbar-style');
      if (existingStyle && !document.querySelector('.sidechat-scroll')) {
        existingStyle.remove();
      }
    };
  }, []);

  // Generate mock AI response based on query

  // Restore persisted messages when panel becomes visible
  React.useEffect(() => {
    if (isVisible) {
      // If restoreChatId is provided, restore that chat from history
      if (restoreChatId) {
        const chat = getChatById(restoreChatId);
        if (chat && chat.messages) {
          // Convert history messages to ChatMessage format
          const restoredMessages: ChatMessage[] = chat.messages.map((msg: any) => ({
            id: `restored-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: msg.role === 'user' ? 'query' : 'response',
            text: msg.content || '',
            attachments: msg.attachments || [],
            propertyAttachments: msg.propertyAttachments || [],
            isLoading: false
          }));
          
          setChatMessages(restoredMessages);
          persistedChatMessagesRef.current = restoredMessages;
          restoredMessageIdsRef.current = new Set(restoredMessages.map(m => m.id));
          return;
        }
      }
      
      // If we have persisted messages, restore them (no animation)
      // BUT only if we're not starting a fresh chat (check if query is empty and no persisted messages)
      if (persistedChatMessagesRef.current.length > 0 && (!query || !query.trim())) {
        setChatMessages(persistedChatMessagesRef.current);
        // Track which messages were restored so they don't animate
        restoredMessageIdsRef.current = new Set(persistedChatMessagesRef.current.map(m => m.id));
        return;
      }
      
      // If persisted messages exist but we have a new query, clear them (new chat scenario)
      // BUT only if we don't already have chat messages (to avoid clearing messages with property attachments)
      if (persistedChatMessagesRef.current.length > 0 && query && query.trim() && chatMessages.length === 0) {
        persistedChatMessagesRef.current = [];
        restoredMessageIdsRef.current = new Set();
      }
      
      // If query is empty and we have no persisted messages, ensure panel is empty
      // BUT only if we don't already have chat messages (to avoid clearing messages with property attachments)
      if ((!query || !query.trim()) && persistedChatMessagesRef.current.length === 0 && chatMessages.length === 0) {
        setChatMessages([]);
        return;
      }
      
      // Don't re-initialize if we already have messages (to preserve property attachments)
      if (chatMessages.length > 0) {
        return;
      }
      
      // Initialize with new query if provided
      if (query && query.trim()) {
        const queryText = query.trim();
        const queryId = `query-${Date.now()}`;
        
        // Include property attachments from context if they exist
        // Create a deep copy to ensure they persist even if context is cleared
        const initialPropertyAttachments = propertyAttachments.length > 0 
          ? propertyAttachments.map(p => ({ ...p, property: { ...p.property } }))
          : undefined;
        
        console.log('📥 SideChatPanel: Initializing with query:', {
          text: queryText,
          propertyAttachments: initialPropertyAttachments?.length || 0,
          propertyAttachmentsData: initialPropertyAttachments
        });
        
        // Get selected document IDs if selection mode was used
        const initialSelectedDocIds = selectedDocumentIds.size > 0 
          ? Array.from(selectedDocumentIds) 
          : undefined;
        
        // Try to get document names from property attachments if available
        let initialSelectedDocNames: string[] | undefined = undefined;
        if (initialSelectedDocIds && initialSelectedDocIds.length > 0 && initialPropertyAttachments && initialPropertyAttachments.length > 0) {
          // Get documents from the first property attachment
          const property = initialPropertyAttachments[0].property as any;
          if (property?.propertyHub?.documents) {
            initialSelectedDocNames = initialSelectedDocIds
              .map(docId => {
                const doc = property.propertyHub.documents.find((d: any) => d.id === docId);
                return doc?.original_filename;
              })
              .filter((name): name is string => !!name);
          }
        }
        
        // Add query message
        const initialMessage: ChatMessage = {
          id: queryId,
          type: 'query',
          text: queryText,
          attachments: [],
          propertyAttachments: initialPropertyAttachments,
          selectedDocumentIds: initialSelectedDocIds,
          selectedDocumentNames: initialSelectedDocNames
        };
        
        setChatMessages([initialMessage]);
        persistedChatMessagesRef.current = [initialMessage];
        // Track this message so it doesn't animate on restore
        restoredMessageIdsRef.current = new Set([initialMessage.id]);
        
        // Clear property attachments after they've been included in the initial message
        // This ensures they're available when the panel initializes, but cleared after
        // BUT only clear if this is a new initialization, not if we're restoring or have existing messages
        if (initialPropertyAttachments && initialPropertyAttachments.length > 0 && chatMessages.length === 0) {
          setTimeout(() => {
            clearPropertyAttachments();
            // Turn off selection mode after clearing attachments
            setSelectionModeActive(false);
          }, 200); // Small delay to ensure the message is rendered
        }
        
        // Add loading response message
        const loadingResponseId = `response-loading-${Date.now()}`;
        const loadingMessage: ChatMessage = {
          id: loadingResponseId,
          type: 'response',
          text: '',
          isLoading: true,
          reasoningSteps: [], // Initialize empty array for reasoning steps
          citations: {} // Initialize empty object for citations
        };
        setChatMessages(prev => {
          const updated = [...prev, loadingMessage];
          persistedChatMessagesRef.current = updated;
          return updated;
        });
        
        // Call LLM API for initial query
        (async () => {
          try {
            // Extract property_id from property attachments (first one if multiple)
            const propertyId = initialPropertyAttachments && initialPropertyAttachments.length > 0
              ? String(initialPropertyAttachments[0].propertyId)
              : undefined;
            
            console.log('📤 SideChatPanel: Calling LLM API for initial query:', {
              query: queryText,
              propertyId,
              messageHistoryLength: 0
            });
            
            // Use streaming API for real-time token-by-token updates
            let accumulatedText = '';
            
            // Create AbortController for this query
            const abortController = new AbortController();
            abortControllerRef.current = abortController;
            
            // Convert selected document IDs to array for initial query
            const initialDocumentIds = selectedDocumentIds.size > 0 
              ? Array.from(selectedDocumentIds) 
              : undefined;
            
            if (initialDocumentIds && initialDocumentIds.length > 0) {
              console.log(`📄 SideChatPanel: Query with ${initialDocumentIds.length} document filter(s)`);
            }
            
            await backendApi.queryDocumentsStreamFetch(
              queryText,
              propertyId,
              [], // No message history for initial query
              `session_${Date.now()}`,
              // onToken: Stream each token as it arrives
              (token: string) => {
                accumulatedText += token;
                const responseMessage: ChatMessage = {
                  id: loadingResponseId,
                  type: 'response',
                  text: accumulatedText,
                  isLoading: true  // Still loading while streaming
                };
                
                setChatMessages(prev => {
                  const updated = prev.map(msg => 
                    msg.id === loadingResponseId 
                      ? responseMessage
                      : msg
                  );
                  persistedChatMessagesRef.current = updated;
                  return updated;
                });
              },
              // onComplete: Final response received
              (data: any) => {
                const finalText = data.summary || accumulatedText || "I found some information for you.";
                
                console.log('✅ SideChatPanel: LLM streaming complete for initial query:', {
                  summary: finalText.substring(0, 100),
                  documentsFound: data.relevant_documents?.length || 0,
                  citations: data.citations ? Object.keys(data.citations).length : 0
                });
                
                const responseMessage: ChatMessage = {
                  id: loadingResponseId,
                  type: 'response',
                  text: finalText,
                  isLoading: false,
                  citations: data.citations || {} // NEW: Store citations
                };
                
                setChatMessages(prev => {
                  const updated = prev.map(msg => 
                    msg.id === loadingResponseId 
                      ? responseMessage
                      : msg
                  );
                  persistedChatMessagesRef.current = updated;
                  return updated;
                });
              },
              // onError: Handle errors
              (error: string) => {
                console.error('❌ SideChatPanel: Streaming error for initial query:', error);
                
                const errorMessage: ChatMessage = {
                  id: loadingResponseId,
                  type: 'response',
                  text: `Sorry, I encountered an error while processing your query. Please try again or contact support if the issue persists. Error: ${error}`,
                  isLoading: false
                };
                
                setChatMessages(prev => {
                  const updated = prev.map(msg => 
                    msg.id === loadingResponseId 
                      ? errorMessage
                      : msg
                  );
                  persistedChatMessagesRef.current = updated;
                  return updated;
                });
                
                toast({
                  description: 'Failed to get AI response. Please try again.',
                  duration: 5000,
                  variant: 'destructive',
                });
              },
              // onStatus: Show status messages
              (message: string) => {
                console.log('📊 SideChatPanel: Status:', message);
              },
              // abortSignal: Pass abort signal for cancellation
              abortController.signal,
              // documentIds: Pass selected document IDs to filter search
              initialDocumentIds,
              // onReasoningStep: Handle reasoning step events
              (step: { step: string; message: string; details: any }) => {
                console.log('🟡 SideChatPanel: Received reasoning step:', step);
                
                setChatMessages(prev => {
                  const updated = prev.map(msg => {
                    if (msg.id === loadingResponseId) {
                      const existingSteps = msg.reasoningSteps || [];
                      const existingIndex = existingSteps.findIndex(s => s.step === step.step);
                      const newStep: ReasoningStep = {
                        ...step,
                        timestamp: Date.now()
                      };
                      
                      if (existingIndex >= 0) {
                        // Update existing step
                        const updatedSteps = [...existingSteps];
                        updatedSteps[existingIndex] = newStep;
                        return { ...msg, reasoningSteps: updatedSteps };
                      } else {
                        // Add new step - keep reasoning block expanded while adding steps
                        setExpandedReasoningBlocks(prev => ({
                          ...prev,
                          [loadingResponseId]: true
                        }));
                        return { ...msg, reasoningSteps: [...existingSteps, newStep] };
                      }
                    }
                    return msg;
                  });
                  persistedChatMessagesRef.current = updated;
                  return updated;
                });
              }
            );
            
            // Clear abort controller on completion
            abortControllerRef.current = null;
          } catch (error) {
            abortControllerRef.current = null;
            // Don't log error if it was aborted
            if (error instanceof Error && error.message !== 'Request aborted') {
              console.error('❌ SideChatPanel: Error calling LLM API for initial query:', error);
            }
            
            // Show error message instead of mock response
            const errorMessage: ChatMessage = {
              id: `response-${Date.now()}`,
              type: 'response',
              text: `Sorry, I encountered an error while processing your query. Please try again or contact support if the issue persists. Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              isLoading: false
            };
            
            setChatMessages(prev => {
              const updated = prev.map(msg => 
                msg.id === loadingResponseId 
                  ? errorMessage
                  : msg
              );
              persistedChatMessagesRef.current = updated;
              return updated;
            });
            
            // Show error toast
            toast({
              description: 'Failed to get AI response. Please try again.',
              duration: 5000,
              variant: 'destructive',
            });
          }
        })();
      }
    }
  }, [isVisible, query, restoreChatId, getChatById]);

  // Auto-scroll to bottom when new messages are added (ChatGPT-like behavior)
  React.useEffect(() => {
    if (contentAreaRef.current && chatMessages.length > 0) {
      // Small delay to ensure DOM has updated
      setTimeout(() => {
        if (contentAreaRef.current) {
          contentAreaRef.current.scrollTop = contentAreaRef.current.scrollHeight;
        }
      }, 100);
    }
  }, [chatMessages]);


  // Handle textarea change with auto-resize logic
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    
    setInputValue(value);
    
    // Always stay in multi-line layout, just adjust height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      const scrollHeight = inputRef.current.scrollHeight;
      const maxHeight = 120;
      const newHeight = Math.min(scrollHeight, maxHeight);
      inputRef.current.style.height = `${newHeight}px`;
      inputRef.current.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
      inputRef.current.style.minHeight = '24px';
      
      if (!isDeletingRef.current && cursorPos !== null) {
        inputRef.current.setSelectionRange(cursorPos, cursorPos);
      }
    }
  };

  const handleFileUpload = React.useCallback((file: File) => {
    console.log('📎 SideChatPanel: handleFileUpload called with file:', file.name);
    
    // Check if we've reached the maximum number of files
    if (attachedFiles.length >= MAX_FILES) {
      console.warn(`⚠️ Maximum of ${MAX_FILES} files allowed`);
      toast({
        description: `Maximum of ${MAX_FILES} files allowed. Please remove a file before adding another.`,
        duration: 3000,
      });
      return;
    }
    
    const fileData: FileAttachmentData = {
      id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      name: file.name,
      type: file.type,
      size: file.size
    };
    
    // Preload blob URL immediately (Instagram-style preloading)
    const preloadBlobUrl = () => {
      try {
        console.log('🚀 Preloading blob URL for attachment:', file.name);
        const blobUrl = URL.createObjectURL(file);
        
        // Store preloaded blob URL in global cache
        if (!(window as any).__preloadedAttachmentBlobs) {
          (window as any).__preloadedAttachmentBlobs = {};
        }
        (window as any).__preloadedAttachmentBlobs[fileData.id] = blobUrl;
        
        console.log(`✅ Preloaded blob URL for attachment ${fileData.id}`);
      } catch (error) {
        console.error('❌ Error preloading blob URL:', error);
      }
    };
    
    // Preload immediately
    preloadBlobUrl();
    
    setAttachedFiles(prev => {
      const updated = [...prev, fileData];
      attachedFilesRef.current = updated; // Update ref immediately
      return updated;
    });
    console.log('✅ SideChatPanel: File attached:', fileData, `(${attachedFiles.length + 1}/${MAX_FILES})`);
  }, [attachedFiles.length]);

  // Handle opening document selection mode
  const handleOpenDocumentSelection = React.useCallback(() => {
    toggleDocumentSelectionMode();
  }, [toggleDocumentSelectionMode]);

  const handleRemoveFile = React.useCallback((fileId: string) => {
    setAttachedFiles(prev => {
      const updated = prev.filter(f => f.id !== fileId);
      attachedFilesRef.current = updated; // Update ref immediately
      return updated;
    });
    
    // Clean up blob URL if it exists
    if ((window as any).__preloadedAttachmentBlobs?.[fileId]) {
      URL.revokeObjectURL((window as any).__preloadedAttachmentBlobs[fileId]);
      delete (window as any).__preloadedAttachmentBlobs[fileId];
    }
  }, []);


  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitted = inputValue.trim();
    if ((submitted || attachedFiles.length > 0 || propertyAttachments.length > 0) && !isSubmitted && onQuerySubmit) {
      setIsSubmitted(true);
      
      // Create a copy of attachments to store with the query
      const attachmentsToStore = [...attachedFiles];
      const propertiesToStore = [...propertyAttachments];
      
      console.log('📤 SideChatPanel: Submitting query with:', {
        text: submitted,
        fileAttachments: attachmentsToStore.length,
        propertyAttachments: propertiesToStore.length,
        propertyAttachmentsData: propertiesToStore
      });
      
      // Add query with attachments to the submitted queries list (for backward compatibility)
      setSubmittedQueries(prev => [...prev, { 
        text: submitted || '', 
        attachments: attachmentsToStore 
      }]);
      
      // Get selected document IDs and names if selection mode was used
      const selectedDocIds = selectedDocumentIds.size > 0 
        ? Array.from(selectedDocumentIds) 
        : undefined;
      
      // Try to get document names from property attachments if available
      let selectedDocNames: string[] | undefined = undefined;
      if (selectedDocIds && selectedDocIds.length > 0 && propertiesToStore.length > 0) {
        // Get documents from the first property attachment
        const property = propertiesToStore[0].property as any;
        if (property?.propertyHub?.documents) {
          selectedDocNames = selectedDocIds
            .map(docId => {
              const doc = property.propertyHub.documents.find((d: any) => d.id === docId);
              return doc?.original_filename;
            })
            .filter((name): name is string => !!name);
        }
      }
      
      // Add query message to chat
      const queryId = `query-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newQueryMessage = {
        id: queryId,
        type: 'query' as const,
        text: submitted || '',
        attachments: attachmentsToStore,
        propertyAttachments: propertiesToStore, // Always include, even if empty array
        selectedDocumentIds: selectedDocIds,
        selectedDocumentNames: selectedDocNames
      };
      
      console.log('💬 SideChatPanel: Adding query message:', newQueryMessage);
      console.log('🔍 SideChatPanel: Property attachments in message:', newQueryMessage.propertyAttachments);
      
      setChatMessages(prev => {
        const updated = [...prev, newQueryMessage];
        persistedChatMessagesRef.current = updated;
        console.log('📋 SideChatPanel: Updated chatMessages:', updated);
        return updated;
      });
      
      // Add loading response message
      const loadingResponseId = `response-loading-${Date.now()}`;
      const loadingMessage: ChatMessage = {
        id: loadingResponseId,
        type: 'response',
        text: '',
        isLoading: true,
        reasoningSteps: [] // Initialize empty array for reasoning steps
      };
      setChatMessages(prev => {
        const updated = [...prev, loadingMessage];
        persistedChatMessagesRef.current = updated;
        return updated;
      });
      
      // Initialize reasoning steps tracking for this query
      currentQueryIdRef.current = loadingResponseId;
      // Expand reasoning block by default for new queries
      setExpandedReasoningBlocks(prev => ({
        ...prev,
        [loadingResponseId]: true
      }));
      
      // Call LLM API to query documents
      (async () => {
        try {
          // Extract property_id from property attachments (first one if multiple)
          const propertyId = propertiesToStore.length > 0 
            ? String(propertiesToStore[0].propertyId) 
            : undefined;
          
          // Build message history from previous messages (excluding the current one)
          const messageHistory = chatMessages
            .filter(msg => (msg.type === 'query' || msg.type === 'response') && msg.text)
            .map(msg => ({
              role: msg.type === 'query' ? 'user' : 'assistant',
              content: msg.text || ''
            }));
          
          console.log('📤 SideChatPanel: Calling LLM API with:', {
            query: submitted,
            propertyId,
            messageHistoryLength: messageHistory.length
          });
          
          // Use streaming API for real-time token-by-token updates
          let accumulatedText = '';
          
          // Create AbortController for this query
          const abortController = new AbortController();
          abortControllerRef.current = abortController;
          
          // Convert selected document IDs to array
          const documentIdsArray = selectedDocumentIds.size > 0 
            ? Array.from(selectedDocumentIds) 
            : undefined;
          
          if (documentIdsArray && documentIdsArray.length > 0) {
            console.log(`📄 SideChatPanel: Query with ${documentIdsArray.length} document filter(s)`);
          }
          
          await backendApi.queryDocumentsStreamFetch(
            submitted || '',
            propertyId,
            messageHistory,
            `session_${Date.now()}`,
            // onToken: Stream each token as it arrives
            (token: string) => {
              accumulatedText += token;
              setChatMessages(prev => {
                const existingMessage = prev.find(msg => msg.id === loadingResponseId);
                const responseMessage: ChatMessage = {
                  id: loadingResponseId,
                  type: 'response',
                  text: accumulatedText,
                  isLoading: true,  // Still loading while streaming
                  reasoningSteps: existingMessage?.reasoningSteps || [] // Preserve reasoning steps
                };
                
                const updated = prev.map(msg => 
                  msg.id === loadingResponseId 
                    ? responseMessage
                    : msg
                );
                persistedChatMessagesRef.current = updated;
                return updated;
              });
            },
            // onComplete: Final response received
            (data: any) => {
              const finalText = data.summary || accumulatedText || "I found some information for you.";
              
              console.log('✅ SideChatPanel: LLM streaming complete:', {
                summary: finalText.substring(0, 100),
                documentsFound: data.relevant_documents?.length || 0,
                citations: data.citations ? Object.keys(data.citations).length : 0
              });
              
              setChatMessages(prev => {
                const existingMessage = prev.find(msg => msg.id === loadingResponseId);
                const responseMessage: ChatMessage = {
                  id: loadingResponseId,
                  type: 'response',
                  text: finalText,
                  isLoading: false,
                  reasoningSteps: existingMessage?.reasoningSteps || [], // Preserve reasoning steps
                  citations: data.citations || {} // NEW: Store citations with bbox metadata
                };
                
                const updated = prev.map(msg => 
                  msg.id === loadingResponseId 
                    ? responseMessage
                    : msg
                );
                persistedChatMessagesRef.current = updated;
                return updated;
              });
              
              // Keep reasoning steps in the message - don't clear them
              currentQueryIdRef.current = null;
            },
            // onError: Handle errors
            (error: string) => {
              console.error('❌ SideChatPanel: Streaming error:', error);
              
              setChatMessages(prev => {
                const existingMessage = prev.find(msg => msg.id === loadingResponseId);
                const errorMessage: ChatMessage = {
                  id: loadingResponseId,
                  type: 'response',
                  text: `Sorry, I encountered an error while processing your query. Please try again or contact support if the issue persists. Error: ${error}`,
                  isLoading: false,
                  reasoningSteps: existingMessage?.reasoningSteps || [] // Preserve reasoning steps
                };
                
                const updated = prev.map(msg => 
                  msg.id === loadingResponseId 
                    ? errorMessage
                    : msg
                );
                persistedChatMessagesRef.current = updated;
                return updated;
              });
              
              toast({
                description: 'Failed to get AI response. Please try again.',
                duration: 5000,
                variant: 'destructive',
              });
            },
            // onStatus: Show status messages
            (message: string) => {
              console.log('📊 SideChatPanel: Status:', message);
              // Optionally show status in UI
            },
            // abortSignal: Pass abort signal for cancellation
            abortController.signal,
            // documentIds: Pass selected document IDs to filter search
            documentIdsArray,
            // onReasoningStep: Handle reasoning step events
            (step: { step: string; message: string; details: any }) => {
              console.log('🟡 SideChatPanel: Received reasoning step:', step);
              console.log('🟡 SideChatPanel: Looking for message with ID:', loadingResponseId);
              
              // Store reasoning steps in the message itself
              setChatMessages(prev => {
                console.log('🟡 SideChatPanel: Current messages:', prev.map(m => ({ id: m.id, hasReasoning: !!m.reasoningSteps })));
                
                const updated = prev.map(msg => {
                  if (msg.id === loadingResponseId) {
                    console.log('🟡 SideChatPanel: Found matching message, updating reasoning steps');
                    const existingSteps = msg.reasoningSteps || [];
                    const existingIndex = existingSteps.findIndex(s => s.step === step.step);
                    const newStep: ReasoningStep = {
                      ...step,
                      timestamp: Date.now()
                    };
                    
                    if (existingIndex >= 0) {
                      // Update existing step
                      const updatedSteps = [...existingSteps];
                      updatedSteps[existingIndex] = newStep;
                      console.log('🟡 SideChatPanel: Updated existing reasoning step:', step.step);
                      return { ...msg, reasoningSteps: updatedSteps };
                    } else {
                      // Add new step - keep reasoning block expanded while adding steps
                      setExpandedReasoningBlocks(prev => ({
                        ...prev,
                        [loadingResponseId]: true
                      }));
                      console.log('🟡 SideChatPanel: Added new reasoning step:', step.step, 'Total steps:', existingSteps.length + 1);
                      return { ...msg, reasoningSteps: [...existingSteps, newStep] };
                    }
                  }
                  return msg;
                });
                
                console.log('🟡 SideChatPanel: Updated messages with reasoning steps');
                return updated;
              });
            }
          );
          
          // Clear abort controller on completion
          abortControllerRef.current = null;
        } catch (error) {
          abortControllerRef.current = null;
          // Don't log error if it was aborted
          if (error instanceof Error && error.message !== 'Request aborted') {
            console.error('❌ SideChatPanel: Error calling LLM API:', error);
          }
          
          // Show error message instead of mock response
          const errorMessage: ChatMessage = {
            id: `response-${Date.now()}`,
            type: 'response',
            text: `Sorry, I encountered an error while processing your query. Please try again or contact support if the issue persists. Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            isLoading: false
          };
          
          setChatMessages(prev => {
            const updated = prev.map(msg => 
              msg.id === loadingResponseId 
                ? errorMessage
                : msg
            );
            persistedChatMessagesRef.current = updated;
            return updated;
          });
          
          // Show error toast
          toast({
            description: 'Failed to get AI response. Please try again.',
            duration: 5000,
            variant: 'destructive',
          });
        }
      })();
      
      // Submit the query text (attachments can be handled separately if needed)
      onQuerySubmit(submitted);
      setInputValue("");
      setAttachedFiles([]); // Clear attachments after submit
      
      // Clear property attachments after they've been stored in the message
      // Use a small delay to ensure the message is fully rendered first
      if (propertiesToStore.length > 0) {
        setTimeout(() => {
          clearPropertyAttachments();
          setSelectionModeActive(false);
        }, 100); // Small delay to ensure message is rendered
      }
      setIsSubmitted(false);
      // Don't switch setIsMultiLine(false) - stay in multi-line layout
      
      // Reset textarea
      if (inputRef.current) {
        const initialHeight = initialScrollHeightRef.current ?? 24;
        inputRef.current.style.height = `${initialHeight}px`;
        inputRef.current.style.overflowY = '';
        inputRef.current.style.overflow = '';
      }
    }
  };
  
  const hasContent = inputValue.trim().length > 0;
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="side-chat-panel"
          ref={panelRef}
          initial={{ x: -400, opacity: 0 }}
          animate={{ 
            x: 0, 
            opacity: 1
          }}
          exit={{ x: -400, opacity: 0 }}
          transition={{ 
            duration: 0.2,
            ease: [0.4, 0, 0.2, 1]
          }}
          layout
          className="fixed top-0 bottom-0 z-30"
          style={{
            left: `${sidebarWidth}px`, // Always positioned after sidebar
            width: isExpanded 
              ? (isPropertyDetailsOpen ? '35vw' : '50vw') // Narrower when PropertyDetailsPanel is open
              : '450px', // Fixed width when collapsed
            backgroundColor: '#F9F9F9',
            boxShadow: isExpanded ? '2px 0 16px rgba(0, 0, 0, 0.15)' : '2px 0 8px rgba(0, 0, 0, 0.1)',
            transition: 'width 0.35s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.35s cubic-bezier(0.4, 0, 0.2, 1)', // Smooth transition matching map clip-path animation
            willChange: 'width', // Optimize for smooth width changes
            backfaceVisibility: 'hidden', // Prevent flickering
            transform: 'translateZ(0)' // Force GPU acceleration
          }}
        >
          {/* Panel content will go here */}
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 relative" style={{ backgroundColor: '#F9F9F9' }}>
              <div className="flex items-center justify-between">
                <button
                  onClick={onSidebarToggle}
                  className="w-11 h-11 lg:w-13 lg:h-13 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-all duration-200"
                  title="Toggle sidebar"
                  type="button"
                >
                  <PanelLeft className="w-5 h-5 lg:w-5 lg:h-5" strokeWidth={1.5} />
                </button>
                <div className="flex items-center space-x-2">
                  <motion.button
                    onClick={() => {
                      // Save current chat to history if there are messages
                      if (chatMessages.length > 0) {
                        const firstQuery = chatMessages.find(m => m.type === 'query');
                        const preview = firstQuery?.text || 'New chat';
                        addChatToHistory({
                          title: '',
                          timestamp: new Date().toISOString(),
                          preview,
                          messages: chatMessages.map(m => ({
                            role: m.type === 'query' ? 'user' : 'assistant',
                            content: m.text || '',
                            attachments: m.attachments || [],
                            propertyAttachments: m.propertyAttachments || []
                          }))
                        });
                      }
                      
                      // Completely clear ALL state for new chat
                      setChatMessages([]);
                      setSubmittedQueries([]);
                      persistedChatMessagesRef.current = [];
                      restoredMessageIdsRef.current = new Set();
                      setInputValue("");
                      setAttachedFiles([]);
                      clearPropertyAttachments();
                      setSelectionModeActive(false);
                      setIsSubmitted(false);
                      setIsFocused(false);
                      
                      // Reset textarea if it exists
                      if (inputRef.current) {
                        inputRef.current.value = "";
                        inputRef.current.style.height = 'auto';
                      }
                      
                      // Notify parent to clear query prop
                      if (onNewChat) {
                        onNewChat();
                      }
                    }}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    className="flex items-center space-x-1.5 px-2.5 py-1.5 border border-slate-200/60 hover:border-slate-300/80 bg-white/70 hover:bg-slate-50/80 rounded-md transition-all duration-200 group"
                    title="New chat"
                  >
                    <Plus className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-700" strokeWidth={1.5} />
                    <span className="text-slate-700 group-hover:text-slate-800 font-medium text-xs">
                      New chat
                    </span>
                  </motion.button>
                  <motion.button
                    onClick={() => {
                      setIsExpanded(!isExpanded);
                    }}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    className={`flex items-center justify-center p-1.5 border rounded-md transition-all duration-200 group ${
                      isExpanded 
                        ? 'border-slate-300/80 bg-slate-100/80 hover:bg-slate-150/80' 
                        : 'border-slate-200/60 hover:border-slate-300/80 bg-white/70 hover:bg-slate-50/80'
                    }`}
                    title={isExpanded ? "Collapse chat" : "Expand chat"}
                  >
                    <MoveDiagonal className={`w-3.5 h-3.5 group-hover:text-slate-700 transition-colors ${
                      isExpanded ? 'text-slate-700' : 'text-slate-600'
                    }`} strokeWidth={1.5} />
                  </motion.button>
                  <button
                    onClick={onMapToggle}
                    className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-full transition-all"
                    title="Close chat"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
            
            {/* Content area - Query bubbles (ChatGPT-like scrollable area) */}
            <div 
              ref={contentAreaRef}
              className="flex-1 overflow-y-auto sidechat-scroll" 
              style={{ 
                backgroundColor: '#F9F9F9',
                padding: '16px 20px 16px 12px', // Reduced left padding to move container right
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(0, 0, 0, 0.1) transparent'
              }}
            >
              <div className="flex flex-col" style={{ minHeight: '100%', gap: '16px' }}>
                <AnimatePresence>
                  {chatMessages.map((message) => {
                    // Check if this is a restored message (existed when panel was opened)
                    // For restored messages, don't animate - they should appear instantly
                    const isRestored = restoredMessageIdsRef.current.has(message.id);
                    const shouldAnimate = !isRestored;
                    
                    return message.type === 'query' ? (
                      // Query message container - ChatGPT style with attachments above
                      <div
                        key={message.id}
                        style={{
                          alignSelf: 'flex-start',
                          maxWidth: '85%',
                          width: 'fit-content',
                          marginTop: '8px',
                          marginLeft: '12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px'
                        }}
                      >
                        {/* Display selected documents indicator above bubble (ChatGPT style) */}
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
                        
                        {/* Query bubble */}
                        <div
                          style={{
                            backgroundColor: '#E6E6E6', // User-requested color
                            borderRadius: '12px',
                            padding: '5px 12px', // Adjusted padding for smaller font size
                            boxShadow: 'none', // Removed drop shadow
                            width: 'fit-content', // Fit container tightly around content
                            wordWrap: 'break-word',
                            display: 'inline-block' // Ensure container fits content
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
                          {message.propertyAttachments && message.propertyAttachments.length > 0 ? (
                              <div style={{ marginBottom: message.text ? '8px' : '0', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {message.propertyAttachments.map((property) => (
                                    <QueryPropertyAttachment 
                                      key={property.id} 
                                      attachment={property}
                                      onOpenProperty={(attachment) => {
                                        console.log('🔍 QueryPropertyAttachment onOpenProperty called:', attachment);
                                        if (onOpenProperty) {
                                          const property = attachment.property;
                                          console.log('📋 Property data:', property);
                                          const coordinates = property.latitude && property.longitude
                                            ? { lat: property.latitude, lng: property.longitude }
                                            : undefined;
                                          const propertyId = property.id || attachment.propertyId;
                                          console.log('📍 Coordinates:', coordinates, 'PropertyId:', propertyId);
                                          onOpenProperty(attachment.address, coordinates, propertyId);
                                        } else {
                                          console.warn('⚠️ SideChatPanel onOpenProperty prop not provided');
                                        }
                                      }}
                                    />
                                  ))}
                              </div>
                            ) : null}
                          
                          {/* Display query text */}
                          {message.text && (
                            <div style={{
                              color: '#0D0D0D',
                              fontSize: '13px',
                              lineHeight: '19px',
                              margin: 0,
                              padding: 0,
                              textAlign: 'left',
                              fontFamily: 'system-ui, -apple-system, sans-serif',
                              width: '100%',
                              boxSizing: 'border-box'
                            }}>
                              <ReactMarkdown
                              components={{
                                p: ({ children }) => <p style={{ margin: 0, padding: 0 }}>{children}</p>,
                                h1: ({ children }) => <h1 style={{ fontSize: '16px', fontWeight: 600, margin: '12px 0 8px 0' }}>{children}</h1>,
                                h2: () => null, // Remove h2 titles from query responses
                                h3: ({ children }) => <h3 style={{ fontSize: '14px', fontWeight: 600, margin: '8px 0 4px 0' }}>{children}</h3>,
                                ul: ({ children }) => <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>{children}</ul>,
                                ol: ({ children }) => <ol style={{ margin: '8px 0', paddingLeft: '20px' }}>{children}</ol>,
                                li: ({ children }) => <li style={{ marginBottom: '4px' }}>{children}</li>,
                                strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
                                em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
                                code: ({ children }) => <code style={{ backgroundColor: '#f3f4f6', padding: '2px 4px', borderRadius: '3px', fontSize: '12px', fontFamily: 'monospace' }}>{children}</code>,
                                blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid #d1d5db', paddingLeft: '12px', margin: '8px 0', color: '#6b7280' }}>{children}</blockquote>,
                                hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '16px 0' }} />,
                                table: ({ children }) => (
                                  <div style={{ overflowX: 'auto', margin: '12px 0' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                      {children}
                                    </table>
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
                      // Response message - full width, no bubble (Cursor AI style)
                      <div
                        key={message.id}
                        style={{
                          width: '100%',
                          padding: '0',
                          margin: '0',
                          marginTop: '8px',
                          paddingLeft: '20px', // Matches query bubble left padding
                          paddingRight: '20px', // Matches query bubble right padding
                          wordWrap: 'break-word'
                        }}
                      >
                        {/* Display reasoning steps in expandable block (persists after completion) */}
                        {message.reasoningSteps && message.reasoningSteps.length > 0 && (
                          <div style={{
                            marginBottom: '12px',
                            padding: '8px 12px',
                            backgroundColor: '#F3F4F6',
                            borderRadius: '8px',
                            border: '1px solid #E5E7EB',
                            cursor: 'pointer'
                          }}
                          onClick={() => {
                            setExpandedReasoningBlocks(prev => ({
                              ...prev,
                              [message.id]: !prev[message.id]
                            }));
                          }}
                          >
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: '11px',
                              fontWeight: 500,
                              color: '#6B7280',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                              userSelect: 'none'
                            }}>
                              <span>Velora Reasoning ({message.reasoningSteps.length} steps)</span>
                              <span style={{
                                fontSize: '14px',
                                transition: 'transform 0.2s',
                                transform: expandedReasoningBlocks[message.id] ? 'rotate(180deg)' : 'rotate(0deg)'
                              }}>
                                ▼
                              </span>
                            </div>
                            {expandedReasoningBlocks[message.id] && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2 }}
                                style={{
                                  marginTop: '8px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '4px',
                                  overflow: 'hidden'
                                }}
                              >
                                {message.reasoningSteps.map((step, idx) => (
                                  <motion.div
                                    key={`${step.step}-${idx}`}
                                    initial={{ opacity: 0, x: -8 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.2, delay: idx * 0.05 }}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '8px',
                                      fontSize: '12px',
                                      color: '#374151',
                                      padding: '4px 0'
                                    }}
                                  >
                                    <div style={{
                                      width: '6px',
                                      height: '6px',
                                      borderRadius: '50%',
                                      backgroundColor: '#3B82F6',
                                      flexShrink: 0
                                    }} />
                                    <span style={{ fontStyle: 'italic' }}>{step.message}</span>
                                  </motion.div>
                                ))}
                              </motion.div>
                            )}
                          </div>
                        )}
                        
                        {/* Display loading state for responses - Globe with rotating ring (atom-like) */}
                        {message.isLoading && (
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            padding: '4px 0',
                            position: 'relative',
                            width: '28px',
                            height: '28px',
                            perspective: '150px',
                            perspectiveOrigin: 'center center',
                            overflow: 'visible'
                          }}>
                            {/* Atom container - rotates globe and ring together */}
                            <div style={{
                              position: 'absolute',
                              width: '28px',
                              height: '28px',
                              top: '50%',
                              left: '50%',
                              marginTop: '-14px',
                              marginLeft: '-14px',
                              animation: 'rotateAtom 0.65s linear infinite',
                              transformOrigin: 'center center',
                              transformStyle: 'preserve-3d',
                              overflow: 'visible'
                            }}>
                              {/* Tilted ring - diagonal spiral */}
                              <div style={{
                                position: 'absolute',
                                width: '16px',
                                height: '16px',
                                top: '50%',
                                left: '50%',
                                marginTop: '-8px',
                                marginLeft: '-8px',
                                borderRadius: '50%',
                                border: '1px solid rgba(212, 175, 55, 0.5)',
                                borderTopColor: 'rgba(212, 175, 55, 0.9)',
                                borderRightColor: 'rgba(212, 175, 55, 0.7)',
                                boxShadow: '0 0 6px rgba(212, 175, 55, 0.4), 0 0 3px rgba(212, 175, 55, 0.2)',
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
                        
                        {/* Display response text - rendered markdown with citations */}
                        {message.text && (() => {
                          // NEW: Custom component to render citations
                          const CitationComponent: React.FC<{ citationNum: string }> = ({ citationNum }) => {
                            const citationData = message.citations?.[citationNum];
                            return (
                              <span
                                style={{
                                  display: 'inline-block',
                                  backgroundColor: '#E5E7EB', // Light grey background
                                  color: '#374151', // Darker text color for better visibility
                                  borderRadius: '4px',
                                  padding: '2px 6px',
                                  fontSize: '11px',
                                  fontWeight: 500,
                                  lineHeight: '1.2',
                                  marginLeft: '2px',
                                  marginRight: '2px',
                                  verticalAlign: 'baseline',
                                  cursor: citationData ? 'pointer' : 'default',
                                  transition: 'background-color 0.2s',
                                }}
                                onMouseEnter={(e) => {
                                  if (citationData) {
                                    e.currentTarget.style.backgroundColor = '#D1D5DB';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (citationData) {
                                    e.currentTarget.style.backgroundColor = '#E5E7EB';
                                  }
                                }}
                                onClick={(e) => {
                                  if (citationData) {
                                    e.stopPropagation();
                                    console.log('📎 Citation clicked:', citationNum, citationData);
                                    // Phase 1: Open document in viewer
                                    handleCitationClick(citationData);
                                  }
                                }}
                                title={citationData ? `${citationData.original_filename} - ${citationData.property_address}` : undefined}
                              >
                                {citationNum}
                              </span>
                            );
                          };

                          // Parse text into parts (text segments and citations)
                          // Also deduplicate consecutive or nearby identical citations
                          const citationPattern = /\[(\d+)\]/g;
                          const parts: Array<{ type: 'text' | 'citation'; content: string; citationNum?: string }> = [];
                          let lastIndex = 0;
                          let match;
                          const citationMatches: Array<{ index: number; num: string; fullMatch: string }> = [];
                          
                          // First, collect all citation matches
                          while ((match = citationPattern.exec(message.text)) !== null) {
                            citationMatches.push({
                              index: match.index,
                              num: match[1],
                              fullMatch: match[0]
                            });
                          }
                          
                          // Deduplicate citations that appear too close together (within 50 characters or same sentence)
                          const deduplicatedCitations = citationMatches.filter((citation, idx) => {
                            if (idx === 0) return true; // Always keep first
                            
                            const prevCitation = citationMatches[idx - 1];
                            const distance = citation.index - (prevCitation.index + prevCitation.fullMatch.length);
                            
                            // Keep citation if:
                            // 1. It's a different citation number, OR
                            // 2. It's the same citation but far enough apart (>50 chars) and separated by sentence boundary
                            if (citation.num !== prevCitation.num) {
                              return true; // Different citation, keep it
                            }
                            
                            // Same citation - only keep if far apart (>50 chars) or sentence boundary
                            const textBetween = message.text.substring(
                              prevCitation.index + prevCitation.fullMatch.length,
                              citation.index
                            );
                            
                            // Check if there's a sentence boundary (period, exclamation, question mark)
                            const hasSentenceBoundary = /[.!?]\s/.test(textBetween);
                            
                            // Keep if distance > 50 chars OR has sentence boundary
                            return distance > 50 || hasSentenceBoundary;
                          });
                          
                          // Build parts array with deduplicated citations
                          for (let i = 0; i < deduplicatedCitations.length; i++) {
                            const citation = deduplicatedCitations[i];
                            
                            // Add text before citation
                            if (citation.index > lastIndex) {
                              parts.push({
                                type: 'text',
                                content: message.text.substring(lastIndex, citation.index)
                              });
                            }
                            
                            // Add citation
                            parts.push({
                              type: 'citation',
                              content: citation.fullMatch,
                              citationNum: citation.num
                            });
                            
                            lastIndex = citation.index + citation.fullMatch.length;
                          }
                          
                          // Add remaining text
                          if (lastIndex < message.text.length) {
                            parts.push({
                              type: 'text',
                              content: message.text.substring(lastIndex)
                            });
                          }

                          // If no citations found, render normally
                          if (parts.length === 1 && parts[0].type === 'text') {
                            return (
                              <div style={{
                                color: '#374151',
                                fontSize: '13px',
                                lineHeight: '19px',
                                margin: 0,
                                padding: '4px 0',
                                paddingLeft: 0,
                                paddingRight: 0,
                                textAlign: 'left',
                                fontFamily: 'system-ui, -apple-system, sans-serif',
                                fontWeight: 400,
                                textIndent: 0
                              }}>
                                <ReactMarkdown
                                  components={{
                                    p: ({ children }) => <p style={{ margin: 0, marginBottom: '8px', textAlign: 'left', paddingLeft: 0, paddingRight: 0, textIndent: 0 }}>{children}</p>,
                                    h1: ({ children }) => <h1 style={{ fontSize: '16px', fontWeight: 600, margin: '12px 0 8px 0', color: '#111827', textAlign: 'left', paddingLeft: 0 }}>{children}</h1>,
                                    h2: () => null, // Remove h2 titles from query responses
                                    h3: () => null, // Remove h3 titles from query responses
                                    ul: ({ children }) => <ul style={{ margin: '8px 0', paddingLeft: 0, listStylePosition: 'inside', textAlign: 'left' }}>{children}</ul>,
                                    ol: ({ children }) => <ol style={{ margin: '8px 0', paddingLeft: 0, listStylePosition: 'inside', textAlign: 'left' }}>{children}</ol>,
                                    li: ({ children }) => <li style={{ marginBottom: '4px', textAlign: 'left', paddingLeft: 0, textIndent: 0 }}>{children}</li>,
                                    strong: ({ children }) => <strong style={{ fontWeight: 600, textAlign: 'left' }}>{children}</strong>,
                                    em: ({ children }) => <em style={{ fontStyle: 'italic', textAlign: 'left' }}>{children}</em>,
                                    code: ({ children }) => <code style={{ backgroundColor: '#f3f4f6', padding: '2px 4px', borderRadius: '3px', fontSize: '12px', fontFamily: 'monospace', textAlign: 'left' }}>{children}</code>,
                                    blockquote: ({ children }) => <blockquote style={{ borderLeft: '3px solid #d1d5db', paddingLeft: '12px', margin: '8px 0', color: '#6b7280', textAlign: 'left' }}>{children}</blockquote>,
                                    hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '16px 0' }} />,
                                    table: ({ children }) => (
                                      <div style={{ overflowX: 'auto', margin: '12px 0' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                          {children}
                                        </table>
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
                            );
                          }

                          // Render with citations - split text and render markdown for each segment
                          return (
                            <div style={{
                              color: '#374151',
                              fontSize: '13px',
                              lineHeight: '19px',
                              margin: 0,
                              padding: '4px 0',
                              paddingLeft: 0,
                              paddingRight: 0,
                              textAlign: 'left',
                              fontFamily: 'system-ui, -apple-system, sans-serif',
                              fontWeight: 400,
                              textIndent: 0
                            }}>
                              {parts.map((part, idx) => {
                                if (part.type === 'citation') {
                                  return <CitationComponent key={`citation-${idx}-${part.citationNum}`} citationNum={part.citationNum!} />;
                                } else {
                                  // Render text segment with ReactMarkdown
                                  return (
                                    <ReactMarkdown
                                      key={`text-${idx}`}
                                      components={{
                                        p: ({ children }) => <span style={{ display: 'inline' }}>{children}</span>,
                                        strong: ({ children }) => <strong>{children}</strong>,
                                        em: ({ children }) => <em>{children}</em>,
                                        code: ({ children }) => <code style={{ backgroundColor: '#f3f4f6', padding: '2px 4px', borderRadius: '3px', fontSize: '12px', fontFamily: 'monospace' }}>{children}</code>,
                                      }}
                                    >
                                      {part.content}
                                    </ReactMarkdown>
                                  );
                                }
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </div>
            
            {/* Chat Input at Bottom - Condensed SearchBar design */}
            <div style={{ backgroundColor: '#F9F9F9', paddingTop: '16px', paddingBottom: '34px', paddingLeft: '36px', paddingRight: '36px' }}>
              <form onSubmit={handleSubmit} className="relative" style={{ overflow: 'visible', height: 'auto', width: '100%' }}>
                <div 
                  className={`relative flex flex-col ${isSubmitted ? 'opacity-75' : ''}`}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #E5E7EB',
                    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
                    paddingTop: '12px', // More padding top
                    paddingBottom: '12px', // More padding bottom
                    paddingRight: '12px',
                    paddingLeft: '12px',
                    overflow: 'visible',
                    width: '100%',
                    minWidth: '0',
                    height: 'auto',
                    minHeight: 'fit-content',
                    boxSizing: 'border-box',
                    borderRadius: '12px' // Always use rounded square corners
                  }}
                >
                  {/* Input row */}
                  <div 
                    className="relative flex flex-col w-full" 
                    style={{ 
                      height: 'auto', 
                      minHeight: '24px',
                      width: '100%',
                      minWidth: '0'
                    }}
                  >
                    {/* File Attachments Display - Above textarea */}
                    <AnimatePresence mode="wait">
                      {attachedFiles.length > 0 && (
                        <motion.div 
                          initial={false}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ 
                            duration: 0.1,
                            ease: "easeOut"
                          }}
                          style={{ height: 'auto', marginBottom: '12px' }}
                          className="flex flex-wrap gap-2 justify-start"
                          layout={false}
                        >
                          {attachedFiles.map((file) => (
                            <FileAttachment
                              key={file.id}
                              attachment={file}
                              onRemove={handleRemoveFile}
                              onPreview={(file) => {
                                // Use shared preview context to add file
                                addPreviewFile(file);
                              }}
                              onDragStart={(fileId) => {
                                setIsDraggingFile(true);
                                setDraggedFileId(fileId);
                              }}
                              onDragEnd={() => {
                                setIsDraggingFile(false);
                                setDraggedFileId(null);
                                setIsOverBin(false);
                              }}
                            />
                          ))}
                        </motion.div>
                      )}
                      
                      {/* Property Attachments Display */}
                      {propertyAttachments.length > 0 && (
                        <div 
                          style={{ height: 'auto', marginBottom: '12px' }}
                          className="flex flex-wrap gap-2 justify-start"
                        >
                          {propertyAttachments.map((property) => (
                            <PropertyAttachment
                              key={property.id}
                              attachment={property}
                              onRemove={removePropertyAttachment}
                            />
                          ))}
                        </div>
                      )}
                    </AnimatePresence>
                    
                    {/* Textarea area - always above */}
                    <div 
                      className="flex items-start w-full"
                      style={{ 
                        minHeight: '24px',
                        width: '100%',
                        marginTop: '4px', // Additional padding above textarea
                        marginBottom: '12px' // Space between text and icons
                      }}
                    >
                      <div className="flex-1 relative flex items-start w-full" style={{ 
                        overflow: 'visible', 
                        minHeight: '24px',
                        width: '100%',
                        minWidth: '0'
                      }}>
                        <textarea 
                          ref={inputRef}
                          value={inputValue}
                          onChange={handleTextareaChange}
                          onFocus={() => setIsFocused(true)} 
                          onBlur={() => setIsFocused(false)} 
                          onKeyDown={e => { 
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSubmit(e);
                            }
                            if (e.key === 'Backspace' || e.key === 'Delete') {
                              isDeletingRef.current = true;
                              setTimeout(() => {
                                isDeletingRef.current = false;
                              }, 200);
                            }
                          }} 
                          placeholder={selectedDocumentIds.size > 0 
                            ? `Searching in ${selectedDocumentIds.size} selected document${selectedDocumentIds.size > 1 ? 's' : ''}...`
                            : "Ask anything..."}
                          className="w-full bg-transparent focus:outline-none text-sm font-normal text-gray-900 placeholder:text-gray-500 resize-none [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200/50 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:hover:bg-gray-300/70 transition-all duration-200 ease-out"
                          style={{
                            minHeight: '24px',
                            maxHeight: '120px',
                            fontSize: '14px',
                            lineHeight: '20px',
                            paddingTop: '0px',
                            paddingBottom: '0px',
                            paddingRight: '0px',
                            paddingLeft: '8px',
                            scrollbarWidth: 'thin',
                            scrollbarColor: 'rgba(229, 231, 235, 0.5) transparent',
                            overflow: 'hidden',
                            overflowY: 'auto',
                            wordWrap: 'break-word',
                            transition: !inputValue.trim() ? 'none' : 'height 0.2s ease-out, overflow 0.2s ease-out',
                            resize: 'none',
                            width: '100%',
                            minWidth: '0'
                          }}
                          autoComplete="off"
                          disabled={isSubmitted}
                          rows={1}
                        />
                      </div>
                    </div>
                    
                    {/* Bottom row: Icons (Left) and Send Button (Right) */}
                    <div
                      className="relative flex items-center justify-between w-full"
                      style={{
                        width: '100%',
                        minWidth: '0',
                        minHeight: '32px'
                      }}
                    >
                      {/* Left Icons: Dashboard */}
                      <div className="flex items-center space-x-3">
                        <button
                          type="button"
                          onClick={onMapToggle}
                          className="p-1 text-slate-600 hover:text-green-500 transition-colors ml-1"
                          title="Back to search mode"
                        >
                          <CreditCard className="w-5 h-5" strokeWidth={1.5} style={{ transform: 'rotate(180deg)' }} />
                        </button>
                      </div>

                      {/* Right Icons: Attachment, Mic, Send */}
                      <div className="flex items-center space-x-3">
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          onChange={handleFileSelect}
                          className="hidden"
                          accept="image/*,.pdf,.doc,.docx"
                        />
                        <div className="relative flex items-center">
                          <button
                            type="button"
                            onClick={handleOpenDocumentSelection}
                            className={`p-1 transition-colors relative ${
                              selectedDocumentIds.size > 0
                                ? 'text-green-500 hover:text-green-600 bg-green-50 rounded'
                                : isDocumentSelectionMode
                                  ? 'text-blue-600 hover:text-blue-700 bg-blue-50 rounded'
                                  : 'text-slate-600 hover:text-green-500'
                            }`}
                            title={
                              selectedDocumentIds.size > 0
                                ? `${selectedDocumentIds.size} document${selectedDocumentIds.size > 1 ? 's' : ''} selected - Queries will search only these documents. Click to ${isDocumentSelectionMode ? 'exit' : 'enter'} selection mode.`
                                : isDocumentSelectionMode
                                  ? "Document selection mode active - Click document cards to select"
                                  : "Select documents to search within"
                            }
                          >
                            {selectedDocumentIds.size > 0 ? (
                              <Scan className="w-5 h-5" strokeWidth={1.5} />
                            ) : isDocumentSelectionMode ? (
                              <Scan className="w-5 h-5" strokeWidth={1.5} />
                            ) : (
                              <SquareDashedMousePointer className="w-5 h-5" strokeWidth={1.5} />
                            )}
                            {selectedDocumentIds.size > 0 && (
                              <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 text-white text-[10px] font-semibold rounded-full flex items-center justify-center">
                                {selectedDocumentIds.size}
                              </span>
                            )}
                          </button>
                          {selectedDocumentIds.size > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                clearSelectedDocuments();
                                setDocumentSelectionMode(false); // Exit selection mode and return to default state
                              }}
                              className="ml-1 p-0.5 text-gray-400 hover:text-red-500 transition-colors"
                              title="Clear document selection"
                            >
                              <X className="w-3.5 h-3.5" strokeWidth={2} />
                            </button>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="p-1 text-slate-600 hover:text-green-500 transition-colors"
                          title="Attach file"
                        >
                          <Paperclip className="w-5 h-5" strokeWidth={1.5} />
                        </button>
                        <button
                          type="button"
                          className="p-1 text-slate-600 hover:text-green-500 transition-colors"
                        >
                          <Mic className="w-5 h-5" strokeWidth={1.5} />
                        </button>
                        
                        {/* Send button or Stop button (when streaming) */}
                        {(() => {
                          const isStreaming = chatMessages.some(msg => msg.isLoading);
                          
                          if (isStreaming) {
                            // Show stop button when streaming - same size as send button to prevent layout shifts
                            return (
                              <motion.button 
                                type="button" 
                                onClick={handleStopQuery} 
                                className="flex items-center justify-center relative focus:outline-none outline-none"
                                style={{
                                  width: '32px',
                                  height: '32px',
                                  minWidth: '32px',
                                  minHeight: '32px',
                                  borderRadius: '50%',
                                  border: '1px solid #D1D5DB',
                                  backgroundColor: '#FFFFFF',
                                  flexShrink: 0
                                }}
                                whileHover={{ 
                                  scale: 1.05,
                                  backgroundColor: '#F3F4F6',
                                  borderColor: '#9CA3AF'
                                }}
                                whileTap={{ 
                                  scale: 0.95
                                }}
                                transition={{
                                  duration: 0.2,
                                  ease: [0.16, 1, 0.3, 1]
                                }}
                                title="Stop generating"
                              >
                                <Square className="w-3 h-3" strokeWidth={2} style={{ color: '#000000', fill: '#000000' }} />
                              </motion.button>
                            );
                          }
                          
                          // Show normal send button when not streaming
                          return (
                            <motion.button 
                              type="submit" 
                              onClick={handleSubmit} 
                              className={`flex items-center justify-center relative focus:outline-none outline-none ${!isSubmitted ? '' : 'cursor-not-allowed'}`}
                              style={{
                                width: '32px',
                                height: '32px',
                                minWidth: '32px',
                                minHeight: '32px',
                                borderRadius: '50%',
                                flexShrink: 0
                              }}
                              animate={{
                                backgroundColor: (inputValue.trim() || attachedFiles.length > 0 || propertyAttachments.length > 0) ? '#415C85' : '#F3F4F6'
                              }}
                              disabled={isSubmitted || (!inputValue.trim() && attachedFiles.length === 0 && propertyAttachments.length === 0)}
                              whileHover={(!isSubmitted && (inputValue.trim() || attachedFiles.length > 0 || propertyAttachments.length > 0)) ? { 
                                scale: 1.05
                              } : {}}
                              whileTap={(!isSubmitted && (inputValue.trim() || attachedFiles.length > 0 || propertyAttachments.length > 0)) ? { 
                                scale: 0.95
                              } : {}}
                              transition={{
                                duration: (!inputValue.trim() && attachedFiles.length === 0 && propertyAttachments.length === 0) ? 0 : 0.2,
                                ease: [0.16, 1, 0.3, 1]
                              }}
                            >
                              <motion.div
                                key="arrow-up"
                                initial={{ opacity: 1 }}
                                animate={{ opacity: 1 }}
                                transition={{
                                  duration: (!inputValue.trim() && attachedFiles.length === 0 && propertyAttachments.length === 0) ? 0 : 0.2,
                                  ease: [0.16, 1, 0.3, 1]
                                }}
                                className="absolute inset-0 flex items-center justify-center"
                                style={{ pointerEvents: 'none' }}
                              >
                                <ArrowUp className="w-4 h-4" strokeWidth={2.5} style={{ color: (inputValue.trim() || attachedFiles.length > 0 || propertyAttachments.length > 0) ? '#ffffff' : '#4B5563' }} />
                              </motion.div>
                            </motion.button>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </motion.div>
      )}
      
      {/* Delete Bin Icon - Bottom Right Corner */}
      <AnimatePresence>
        {isDraggingFile && (
          <motion.div
            key="delete-bin"
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ 
              opacity: 1, 
              scale: isOverBin ? 1.15 : 1, 
              y: 0,
              backgroundColor: isOverBin ? 'rgba(239, 68, 68, 0.3)' : 'rgba(239, 68, 68, 0.1)',
              borderColor: isOverBin ? 'rgba(239, 68, 68, 0.8)' : 'rgba(239, 68, 68, 0.3)',
            }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            onDragOver={(e) => {
              // Only handle file drags - check if we have a dragged file ID
              if (!draggedFileId || !isDraggingFile) {
                return;
              }
              
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              setIsOverBin(true);
            }}
            onDragEnter={(e) => {
              // Only handle file drags - check if we have a dragged file ID
              if (!draggedFileId || !isDraggingFile) {
                return;
              }
              
              e.preventDefault();
              e.stopPropagation();
              setIsOverBin(true);
            }}
            onDragLeave={(e) => {
              // Check if we're actually leaving the bin (not just entering a child element)
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX;
              const y = e.clientY;
              
              if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                e.preventDefault();
                e.stopPropagation();
                setIsOverBin(false);
              }
            }}
            onDrop={(e) => {
              // Only handle file drags - use the stored file ID
              if (!draggedFileId || !isDraggingFile) {
                setIsDraggingFile(false);
                setIsOverBin(false);
                setDraggedFileId(null);
                return;
              }
              
              e.preventDefault();
              e.stopPropagation();
              handleRemoveFile(draggedFileId);
              setIsDraggingFile(false);
              setIsOverBin(false);
              setDraggedFileId(null);
            }}
            style={{
              position: 'fixed',
              bottom: '24px',
              right: '24px',
              width: '56px',
              height: '56px',
              borderRadius: '12px',
              border: '2px solid',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: isOverBin ? 'grabbing' : 'grab',
              zIndex: 1000,
              boxShadow: isOverBin ? '0 8px 24px rgba(239, 68, 68, 0.4)' : '0 4px 12px rgba(0, 0, 0, 0.15)'
            }}
            title={isOverBin ? "Release to delete file" : "Drop file here to delete"}
          >
            <motion.div
              animate={{
                scale: isOverBin ? 1.2 : 1,
                rotate: isOverBin ? 10 : 0,
              }}
              transition={{ duration: 0.2 }}
            >
              <Trash2 
                className="w-6 h-6" 
                style={{ 
                  color: isOverBin ? '#dc2626' : '#ef4444',
                  transition: 'color 0.2s ease'
                }} 
                strokeWidth={isOverBin ? 2.5 : 2} 
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatePresence>
  );
});


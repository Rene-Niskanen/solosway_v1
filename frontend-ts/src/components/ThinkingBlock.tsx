import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ChevronRight } from 'lucide-react';

// One-time CSS injection (no re-injection on renders)
let stylesInjected = false;
const injectStyles = () => {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .thinking-block { margin-top: 2px; margin-bottom: 2px; }
    .thinking-header {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      user-select: none;
      color: #9CA3AF;
      font-size: 12px;
      font-weight: 500;
      padding: 2px 0;
    }
    .thinking-header:hover { color: #6B7280; }
    .thinking-chevron {
      transition: transform 0.2s ease;
      flex-shrink: 0;
      width: 12px;
      height: 12px;
    }
    .thinking-chevron.expanded { transform: rotate(90deg); }
    .thinking-label-streaming {
      font-weight: 500;
      background: linear-gradient(90deg, #9CA3AF 0%, #D1D5DB 50%, #9CA3AF 100%);
      background-size: 200% 100%;
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      animation: thinking-shimmer 1.5s ease-in-out infinite;
    }
    .thinking-content-wrapper {
      overflow: hidden;
      transition: max-height 0.2s ease-out, opacity 0.2s ease-out;
      will-change: max-height;
    }
    .thinking-content-wrapper.collapsed {
      max-height: 0;
      opacity: 0;
    }
    .thinking-content-wrapper.expanded {
      max-height: 500px;
      opacity: 1;
    }
    .thinking-content {
      margin-left: 16px;
      margin-top: 4px;
      color: #B0B7C3;
      font-size: 12px;
      font-style: italic;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 500px;
      overflow-y: auto;
    }
    .thinking-content::-webkit-scrollbar { width: 4px; }
    .thinking-content::-webkit-scrollbar-thumb { background: #E5E7EB; border-radius: 2px; }
    .thinking-new-text { animation: thinking-fade-in 0.15s ease-out forwards; }
    @keyframes thinking-fade-in { from { opacity: 0.4; } to { opacity: 1; } }
    @keyframes thinking-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
  `;
  document.head.appendChild(style);
};

/** Shared trivial-phrase list and check so ReasoningSteps can hide planning + thought when content is only this */
const TRIVIAL_PHRASES = [
  'planning next moves',
  'planning next steps',
  'thinking',
  'processing',
  'analyzing',
  'analysing',
  'considering options',
  'planning response',
  'formulating response',
  'preparing response',
];

export function isTrivialThinkingContent(content: string): boolean {
  if (!content || !content.trim()) return false;
  let normalized = content
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?\s]+$/, '');
  if (normalized.startsWith('- ')) normalized = normalized.slice(2).trim();
  return TRIVIAL_PHRASES.some((phrase) => normalized === phrase);
}

interface ThinkingBlockProps {
  content: string;
  isStreaming: boolean;
  startTime?: number;
  model?: 'gpt-4o-mini' | 'gpt-4o' | 'claude-sonnet' | 'claude-opus';
  searchTerm?: string; // User's search term to prioritize relevant key facts
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  content,
  isStreaming,
  startTime,
  model = 'gpt-4o-mini',
  searchTerm
}) => {
  // Inject styles once
  useEffect(() => { injectStyles(); }, []);
  
  const [isExpanded, setIsExpanded] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const hasAutoCollapsedRef = useRef(false);
  const userHasToggledRef = useRef(false);
  const prevContentLengthRef = useRef(0);
  const streamingStartTimeRef = useRef<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  
  // Check if using Claude model
  const isClaudeModel = model === 'claude-sonnet' || model === 'claude-opus';
  
  // Process content: remove bullet points for non-Claude models and extract key facts
  const processedContent = useMemo(() => {
    if (!content) return '';
    
    let processed = content;
    
    // Remove bullet points for non-Claude models
    if (!isClaudeModel) {
      // Remove leading "- " or "-" from lines
      processed = processed
        .split('\n')
        .map(line => {
          // Remove leading "- " or "-" but preserve indentation
          const trimmed = line.trimStart();
          if (trimmed.startsWith('- ')) {
            return line.replace(/^\s*-\s+/, '');
          } else if (trimmed.startsWith('-') && trimmed.length > 1 && trimmed[1] !== '-') {
            return line.replace(/^\s*-\s*/, '');
          }
          return line;
        })
        .join('\n')
        .trim();
    }
    
    return processed;
  }, [content, isClaudeModel]);
  
  // Extract key facts/figures from content (numbers, dates, amounts, etc.)
  // Prioritize facts that match the user's search term
  const keyFacts = useMemo(() => {
    if (!processedContent) return [];
    
    const facts: { text: string; relevanceScore: number }[] = [];
    const fullText = processedContent;
    const searchTermLower = searchTerm?.toLowerCase() || '';
    
    // Look for patterns with numbers, currency, dates, or key terms
    const factPatterns = [
      {
        pattern: /(?:Market Value|Value|Valuation|Rent|Price|Cost|Amount|Market Rent|90-Day Value|180-Day Value)[:\s]+[£$€]?[\d,]+(?:\.\d+)?(?:\s*(?:per|month|year|day|week|pcm|pcm))?/gi,
        contextBefore: 40,
        contextAfter: 60
      },
      {
        pattern: /[£$€][\d,]+(?:\.\d+)?/g,
        contextBefore: 30,
        contextAfter: 50
      },
      {
        pattern: /\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/gi,
        contextBefore: 20,
        contextAfter: 30
      },
      {
        pattern: /\d{4}-\d{2}-\d{2}/g,
        contextBefore: 20,
        contextAfter: 30
      },
      {
        pattern: /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\s*(?:per|month|year|day|week|pcm)/gi,
        contextBefore: 25,
        contextAfter: 40
      },
    ];
    
    factPatterns.forEach(({ pattern, contextBefore, contextAfter }) => {
      const matches = [...fullText.matchAll(pattern)];
      matches.forEach(match => {
        if (match.index !== undefined) {
          let start = Math.max(0, match.index - contextBefore);
          let end = Math.min(fullText.length, match.index + match[0].length + contextAfter);
          
          // Find word boundaries to avoid cutting words in half
          // Move start backward to nearest word boundary (space, punctuation, or start of string)
          while (start > 0 && /\w/.test(fullText[start - 1])) {
            start--;
          }
          
          // Move end forward to nearest word boundary (space, punctuation, or end of string)
          while (end < fullText.length && /\w/.test(fullText[end])) {
            end++;
          }
          
          let snippet = fullText.substring(start, end).trim();
          
          // Clean up snippet - remove leading/trailing punctuation only
          snippet = snippet.replace(/^[^\w\s]+/, '').replace(/[^\w\s]+$/, '');
          
          // Only add if it's meaningful (at least 10 chars and contains the fact)
          if (snippet.length >= 10 && !facts.some(f => f.text.includes(match[0]) || match[0].includes(f.text))) {
            // Calculate relevance score based on search term match
            const snippetLower = snippet.toLowerCase();
            let relevanceScore = 0;
            
            if (searchTermLower) {
              // High score if snippet contains the search term
              if (snippetLower.includes(searchTermLower)) {
                relevanceScore = 100;
              }
              // Medium score for partial matches or related terms
              else if (searchTermLower === 'value' && (snippetLower.includes('value') || snippetLower.includes('valuation') || snippetLower.includes('market value'))) {
                relevanceScore = 90;
              }
              else if (searchTermLower === 'rent' && (snippetLower.includes('rent') || snippetLower.includes('market rent') || snippetLower.includes('pcm') || snippetLower.includes('per month'))) {
                relevanceScore = 90;
              }
              else if (searchTermLower === 'price' && (snippetLower.includes('price') || snippetLower.includes('cost') || snippetLower.includes('amount'))) {
                relevanceScore = 90;
              }
              // Negative score for explicitly non-matching terms
              else if (searchTermLower === 'value' && (snippetLower.includes('rent') || snippetLower.includes('pcm') || snippetLower.includes('per month'))) {
                relevanceScore = -50; // Penalize rent when looking for value
              }
              else if (searchTermLower === 'rent' && snippetLower.includes('value') && !snippetLower.includes('rent')) {
                relevanceScore = -50; // Penalize value when looking for rent
              }
            }
            
            facts.push({ text: snippet, relevanceScore });
          }
        }
      });
    });
    
    // Remove duplicates, sort by relevance (then by length), and take top 5
    const seenTexts = new Set<string>();
    const uniqueFacts = facts
      .filter(f => {
        if (seenTexts.has(f.text)) return false;
        seenTexts.add(f.text);
        return true;
      })
      .sort((a, b) => {
        // Sort by relevance first, then by length
        if (b.relevanceScore !== a.relevanceScore) {
          return b.relevanceScore - a.relevanceScore;
        }
        return b.text.length - a.text.length;
      })
      .slice(0, 5) // Show up to 5 facts
      .map(f => f.text);
    
    return uniqueFacts;
  }, [processedContent, searchTerm]);
  
  // Early return - no processing if empty
  const hasContent = processedContent.length > 0;
  
  // Memoized content splitting (cheap string ops, but avoid on every render)
  // Track processed content length for streaming animation
  const { oldContent, newContent } = useMemo(() => {
    const prevProcessedLen = prevContentLengthRef.current;
    return {
      oldContent: processedContent.slice(0, prevProcessedLen),
      newContent: processedContent.slice(prevProcessedLen)
    };
  }, [processedContent]);
  
  // Update prev length after render (sync, no state) - track processed content length
  useEffect(() => {
    prevContentLengthRef.current = processedContent.length;
  }, [processedContent]);
  
  // Track user scroll position to respect manual scrolling
  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl || !isExpanded) return;
    
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = contentEl;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 50; // 50px threshold
      userScrolledUpRef.current = !isNearBottom;
    };
    
    contentEl.addEventListener('scroll', handleScroll);
    return () => contentEl.removeEventListener('scroll', handleScroll);
  }, [isExpanded]);
  
  // Auto-scroll to bottom when new content streams in
  useEffect(() => {
    if (!isStreaming || !isExpanded || !contentRef.current) return;
    
    // Only auto-scroll if user hasn't manually scrolled up
    if (userScrolledUpRef.current) return;
    
    const contentEl = contentRef.current;
    // Use requestAnimationFrame to ensure DOM has updated
    requestAnimationFrame(() => {
      contentEl.scrollTop = contentEl.scrollHeight;
    });
  }, [content, isStreaming, isExpanded]);
  
  // Combined auto-expand/collapse logic
  useEffect(() => {
    if (userHasToggledRef.current) return; // User took control
    
    if (isStreaming && hasContent) {
      setIsExpanded(true);
      hasAutoCollapsedRef.current = false;
      // Reset scroll tracking when streaming starts
      userScrolledUpRef.current = false;
    } else if (!isStreaming && hasContent && !hasAutoCollapsedRef.current) {
      const timer = setTimeout(() => {
        setIsExpanded(false);
        hasAutoCollapsedRef.current = true;
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, hasContent]);
  
  // Simple timer: track from start of streaming to end
  useEffect(() => {
    if (isStreaming) {
      // Start tracking when streaming begins
      if (streamingStartTimeRef.current === null) {
        streamingStartTimeRef.current = Date.now();
      }
      
      // Update elapsed time every second while streaming
      const updateElapsed = () => {
        if (streamingStartTimeRef.current !== null) {
          const elapsed = Math.floor((Date.now() - streamingStartTimeRef.current) / 1000);
          setElapsedSeconds(elapsed);
        }
      };
      
      updateElapsed();
      const interval = setInterval(updateElapsed, 1000);
      return () => clearInterval(interval);
    } else {
      // When streaming stops, calculate final elapsed time
      if (streamingStartTimeRef.current !== null) {
        const finalElapsed = Math.floor((Date.now() - streamingStartTimeRef.current) / 1000);
        setElapsedSeconds(finalElapsed);
        // Keep the start time so we can show the final duration
      }
    }
  }, [isStreaming]);
  
  // Stable toggle handler (no re-creation)
  const handleToggle = useCallback(() => {
    setIsExpanded(prev => !prev);
    userHasToggledRef.current = true;
  }, []);
  
  // Don't render if no content and not streaming
  if (!hasContent && !isStreaming) {
    return null;
  }
  
  // Don't render if the thinking content is just a trivial/generic phrase (streaming or not)
  if (isTrivialThinkingContent(processedContent)) {
    return null;
  }
  
  return (
    <div className="thinking-block">
      {/* Header - always visible */}
      <div className="thinking-header" onClick={handleToggle}>
        {hasContent && (
          <ChevronRight className={`thinking-chevron ${isExpanded ? 'expanded' : ''}`} />
        )}
        {isStreaming ? (
          <span className="thinking-label-streaming">Thinking...</span>
        ) : (
          <span>Thought {elapsedSeconds}s</span>
        )}
      </div>
      
      {/* Content - CSS-only collapse (no framer-motion overhead) */}
      {hasContent && (
        <div className={`thinking-content-wrapper ${isExpanded ? 'expanded' : 'collapsed'}`}>
          <div className="thinking-content" ref={contentRef}>
            {/* Show key facts prominently if available and not streaming */}
            {!isStreaming && keyFacts.length > 0 && (
              <div style={{
                marginBottom: '8px',
                padding: '6px 8px',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderRadius: '4px',
                borderLeft: '2px solid rgba(59, 130, 246, 0.3)',
                wordWrap: 'break-word',
                overflowWrap: 'break-word',
                whiteSpace: 'normal',
                overflow: 'visible',
                maxWidth: '100%',
                boxSizing: 'border-box'
              }}>
                <div style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#3B82F6',
                  marginBottom: '4px'
                }}>
                  Key Facts:
                </div>
                {keyFacts.map((fact, idx) => (
                  <div key={idx} style={{
                    fontSize: '11px',
                    color: '#1E40AF',
                    marginTop: '2px',
                    lineHeight: '1.4',
                    wordWrap: 'break-word',
                    overflowWrap: 'break-word',
                    whiteSpace: 'normal',
                    overflow: 'visible'
                  }}>
                    • {fact}
                  </div>
                ))}
              </div>
            )}
            <span>{oldContent}</span>
            {newContent && <span className="thinking-new-text">{newContent}</span>}
          </div>
        </div>
      )}
    </div>
  );
};

export default ThinkingBlock;

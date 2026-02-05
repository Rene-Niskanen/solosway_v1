/**
 * ExecutionTrace Component
 * 
 * Clean, minimal execution trace showing what the LLM is doing.
 * No emojis, collapsible, smaller font than main answer.
 */

import React, { useMemo, useState, useEffect } from 'react';
import { SearchCheck, TextSearch, WandSparkles, Sparkle, FileText, BookOpenCheck, ChevronDown, ChevronUp } from 'lucide-react';

export interface ExecutionEvent {
  type: "read" | "search" | "grep" | "tool" | "retrieve_docs" | "retrieve_chunks" | "query_db" | "api_call" | "phase";
  description: string;
  metadata?: Record<string, any>;
  timestamp: number;
  event_id: string;
  parent_event_id?: string;
}

interface ExecutionTraceProps {
  events: ExecutionEvent[];
  isLoading: boolean;
  hasText?: boolean; // Whether answer text has been generated
}

export const ExecutionTrace: React.FC<ExecutionTraceProps> = ({ events, isLoading, hasText = false }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  // Auto-collapse when answer is generated
  useEffect(() => {
    if (hasText && !isLoading) {
      setIsCollapsed(true);
    }
  }, [hasText, isLoading]);

  // Filter out events we don't want to show
  const filteredEvents = useMemo(() => {
    return events.filter(event => {
      const desc = event.description.toLowerCase();
      // Filter out "step X/Y complete" messages
      if (desc.includes('step') && (desc.includes('complete') || desc.includes('continuing'))) {
        return false;
      }
      // Filter out evaluation status messages that aren't user-relevant
      if (desc.includes('evaluation:') || desc.includes('evaluating results')) {
        return false;
      }
      // Filter out "Answer generated" - user can see the answer
      if (desc.includes('answer') && (desc.includes('generated') || desc.includes('complete'))) {
        return false;
      }
      // Filter out "Analysing" events - these are redundant
      if (desc === 'analysing' || desc === 'analyzing') {
        return false;
      }
      return true;
    });
  }, [events]);

  // Parse description to extract action word and rest
  const parseDescription = (description: string, event?: ExecutionEvent): { action: string; rest: string } => {
    // Handle reasoning events (Cursor-style user-facing events)
    if (event?.metadata?.reasoning) {
      // Reasoning events come as "Label" or "Label (detail)"
      const reasoningMatch = description.match(/^(.+?)(?:\s*\((.+?)\))?$/);
      if (reasoningMatch) {
        const label = reasoningMatch[1];
        const detail = reasoningMatch[2];
        
        // Extract action word from label (first word)
        const words = label.split(' ');
        const firstWord = words[0];
        const rest = words.slice(1).join(' ') + (detail ? ` (${detail})` : '');
        
        return { 
          action: firstWord.charAt(0).toUpperCase() + firstWord.slice(1), 
          rest: rest || '' 
        };
      }
    }
    
    // Handle "Plan ..." or "Plan: ..." format (strip colon if present)
    if (description.startsWith('Plan: ')) {
      return { action: 'Plan', rest: description.substring(6) };
    }
    if (description.startsWith('Plan:')) {
      return { action: 'Plan', rest: description.substring(5).trim() };
    }
    if (description.startsWith('Plan ')) {
      return { action: 'Plan', rest: description.substring(5) };
    }
    
    // Handle "Found X documents for '...'"
    const foundDocsMatch = description.match(/^Found (\d+) documents? for '(.+)'$/i);
    if (foundDocsMatch) {
      return { action: 'Found', rest: `${foundDocsMatch[1]} document${foundDocsMatch[1] === '1' ? '' : 's'} for '${foundDocsMatch[2]}'` };
    }
    
    // Handle "Found X documents" (without query - legacy format)
    if (description.match(/^Found \d+ documents?$/i)) {
      return { action: 'Found', rest: description.substring(5) };
    }
    
    // Handle "Found X sections from X document(s) for '...'"
    const sectionMatch = description.match(/^Found (\d+) sections? from (\d+) documents? for '(.+)'$/i);
    if (sectionMatch) {
      return { action: 'Found', rest: `${sectionMatch[1]} section${sectionMatch[1] === '1' ? '' : 's'} from ${sectionMatch[2]} document${sectionMatch[2] === '1' ? '' : 's'} for '${sectionMatch[3]}'` };
    }
    
    // Handle "Searched X document(s) for '...' (related to: '...')" (for retrieve_chunks with user query context)
    const searchedDocsWithContextMatch = description.match(/^Searched (\d+) documents? for '(.+?)' \(related to: '(.+?)'\)$/i);
    if (searchedDocsWithContextMatch) {
      return { action: 'Searched', rest: `${searchedDocsWithContextMatch[1]} document${searchedDocsWithContextMatch[1] === '1' ? '' : 's'} for '${searchedDocsWithContextMatch[2]}' (related to: '${searchedDocsWithContextMatch[3]}')` };
    }
    
    // Handle "Searched X document(s) for '...'" (for retrieve_chunks without context)
    const searchedDocsMatch = description.match(/^Searched (\d+) documents? for '(.+)'$/i);
    if (searchedDocsMatch) {
      return { action: 'Searched', rest: `${searchedDocsMatch[1]} document${searchedDocsMatch[1] === '1' ? '' : 's'} for '${searchedDocsMatch[2]}'` };
    }
    
    // Handle "Searched '...'" (for retrieve_docs)
    if (description.startsWith("Searched '")) {
      const query = description.substring("Searched '".length);
      return { action: 'Searched', rest: query };
    }
    
    // Handle "Retrieved chunks from X document(s) for '...'"
    const retrievedMatch = description.match(/^Retrieved chunks? from (\d+) documents? for '(.+)'$/i);
    if (retrievedMatch) {
      return { action: 'Retrieved', rest: `chunks from ${retrievedMatch[1]} document${retrievedMatch[1] === '1' ? '' : 's'} for '${retrievedMatch[2]}'` };
    }
    
    // Handle "Analysing"
    if (description.toLowerCase() === 'analysing') {
      return { action: 'Analysing', rest: '...' };
    }
    
    // Default: try to extract first word
    const words = description.split(' ');
    if (words.length > 1) {
      const firstWord = words[0];
      const rest = words.slice(1).join(' ');
      return { action: firstWord.charAt(0).toUpperCase() + firstWord.slice(1), rest };
    }
    
    return { action: description, rest: '' };
  };

  // Build event tree (parent -> children)
  const eventTree = useMemo(() => {
    const eventMap = new Map<string, ExecutionEvent>();
    const rootEvents: ExecutionEvent[] = [];
    const childrenMap = new Map<string, ExecutionEvent[]>();
    
    // First pass: build map and find roots
    filteredEvents.forEach(event => {
      eventMap.set(event.event_id, event);
      if (!event.parent_event_id) {
        rootEvents.push(event);
      } else {
        if (!childrenMap.has(event.parent_event_id)) {
          childrenMap.set(event.parent_event_id, []);
        }
        childrenMap.get(event.parent_event_id)!.push(event);
      }
    });
    
    // Sort roots by timestamp
    rootEvents.sort((a, b) => a.timestamp - b.timestamp);
    
    // Sort children by timestamp
    childrenMap.forEach((children) => {
      children.sort((a, b) => a.timestamp - b.timestamp);
    });
    
    return { eventMap, rootEvents, childrenMap };
  }, [filteredEvents]);
  
  // Get icon for event type (matching ReasoningSteps style)
  const getIconForEvent = (event: ExecutionEvent, action: string) => {
    const ACTION_COLOR = '#9CA3AF'; // Light gray for icons (matching ReasoningSteps)
    
    if (action === 'Plan') {
      return <Sparkle style={{ width: '14px', height: '14px', color: ACTION_COLOR, flexShrink: 0, marginTop: '2px' }} />;
    }
    if (action === 'Searched' || (action === 'Found' && event.type === 'retrieve_docs')) {
      return <SearchCheck style={{ width: '14px', height: '14px', color: ACTION_COLOR, flexShrink: 0, marginTop: '2px' }} />;
    }
    if (action === 'Found' && event.type === 'retrieve_chunks') {
      return <TextSearch style={{ width: '14px', height: '14px', color: ACTION_COLOR, flexShrink: 0, marginTop: '2px' }} />;
    }
    if (action === 'Retrieved') {
      return <TextSearch style={{ width: '14px', height: '14px', color: ACTION_COLOR, flexShrink: 0, marginTop: '2px' }} />;
    }
    if (action === 'Analysing') {
      return <WandSparkles style={{ width: '14px', height: '14px', color: ACTION_COLOR, flexShrink: 0, marginTop: '2px' }} />;
    }
    // Default icon
    return <FileText style={{ width: '14px', height: '14px', color: ACTION_COLOR, flexShrink: 0, marginTop: '2px' }} />;
  };

  // Render event with children (recursive)
  const renderEvent = (event: ExecutionEvent, depth: number = 0): React.ReactNode => {
    const children = eventTree.childrenMap.get(event.event_id) || [];
    const { action, rest } = parseDescription(event.description, event);
    
    // Skip rendering if it's a child event that's redundant (e.g., "Found X documents" after "Searched")
    // We'll only show the main action, not the post-events
    if (event.parent_event_id && (action === 'Found' || action === 'Retrieved')) {
      // Only show if it's not redundant with parent
      const parent = eventTree.eventMap.get(event.parent_event_id);
      if (parent && parent.type === event.type) {
        // Merge into parent description or skip
        return null;
      }
    }
    
    return (
      <div
        key={event.event_id}
        style={{
          marginBottom: '3px',
          fontSize: '12px',
          lineHeight: '1.5',
          color: '#666',
        }}
      >
        <div style={{ display: 'inline-flex', alignItems: 'flex-start', gap: '6px' }}>
          {getIconForEvent(event, action)}
          <div>
            <strong style={{ fontWeight: 600, color: '#333' }}>{action}</strong>
            {rest && <span> {rest}</span>}
          </div>
        </div>
        {children.length > 0 && (
          <div style={{ marginTop: '2px', marginLeft: '20px' }}>
            {children.map(child => renderEvent(child, depth + 1)).filter(Boolean)}
          </div>
        )}
      </div>
    );
  };
  
  // Generate summary for collapsed state (like "Explored 1 file 1 search")
  const summary = useMemo(() => {
    let fileCount = 0;
    let searchCount = 0;
    
    filteredEvents.forEach(event => {
      const { action } = parseDescription(event.description, event);
      
      // Count document retrievals (files) - handle both reasoning events and legacy format
      if (action === 'Found' && (event.type === 'retrieve_docs' || event.metadata?.reasoning)) {
        const match = event.description.match(/Found (\d+) (?:relevant )?documents?/i);
        if (match) {
          fileCount += parseInt(match[1]);
        } else if (action === 'Found') {
          fileCount += 1;
        }
      }
      
      // Count searches (only "Searched" or "Checked" events, not "Found")
      if (action === 'Searched' || action === 'Checked' || action === 'Reviewed') {
        searchCount += 1;
      }
    });
    
    // Build summary string
    const parts: string[] = [];
    if (fileCount > 0) {
      parts.push(`${fileCount} file${fileCount === 1 ? '' : 's'}`);
    }
    if (searchCount > 0) {
      parts.push(`${searchCount} search${searchCount === 1 ? '' : 'es'}`);
    }
    
    if (parts.length === 0) {
      return 'Explored';
    }
    
    return `Explored ${parts.join(' ')}`;
  }, [filteredEvents]);
  
  // Don't show anything if no events
  if (filteredEvents.length === 0) {
    return null;
  }
  
  return (
    <div
      style={{
        marginBottom: '8px',
        fontSize: '12px',
      }}
    >
      {/* Header with collapse/expand button - always visible, stays in fixed position */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <span style={{ 
          fontSize: '11px', 
          color: '#888',
          fontWeight: 500,
          textTransform: 'none',
          letterSpacing: '0'
        }}>
          {summary}
        </span>
        {isCollapsed ? (
          <ChevronDown size={12} style={{ color: '#888', strokeWidth: 1.5 }} />
        ) : (
          <ChevronUp size={12} style={{ color: '#888', strokeWidth: 1.5 }} />
        )}
      </div>
      
      {/* When expanded: show reasoning steps below header (pushes only content below downward) */}
      {!isCollapsed && (
        <div style={{ marginTop: '6px' }}>
          {eventTree.rootEvents.length > 0 ? (
            eventTree.rootEvents.map(event => renderEvent(event, 0)).filter(Boolean)
          ) : (
            <div style={{ color: '#666', fontStyle: 'italic' }}>
              Preparing...
            </div>
          )}
        </div>
      )}
    </div>
  );
};

"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, LibraryBig, PanelRightOpen, AudioLines, Globe, X } from "lucide-react";
import { usePropertySelection } from '../contexts/PropertySelectionContext';
import { useDocumentSelection } from '../contexts/DocumentSelectionContext';
import { ModeSelector } from './ModeSelector';
import { ModelSelector } from './ModelSelector';
import { ChatBarAttachDropdown } from './ChatBarAttachDropdown';
import { WebSearchPill } from './SelectedModePill';
import { SegmentInput, type SegmentInputHandle } from './SegmentInput';
import { AtMentionPopover, type AtMentionItem } from './AtMentionPopover';
import { getFilteredAtMentionItems, preloadAtMentionCache } from '@/services/atMentionCache';
import { useSegmentInput, buildInitialSegments } from '@/hooks/useSegmentInput';
import { isTextSegment, isChipSegment, type QueryContentSegment } from '@/types/segmentInput';
import { INPUT_BAR_SPACE_BELOW_MAP_LARGE, getInputBarFixedContainerStyles, CHAT_INPUT_MAX_HEIGHT_PX } from '@/utils/inputBarPosition';

interface MapChatBarProps {
  onQuerySubmit?: (query: string, options?: { contentSegments?: QueryContentSegment[] }) => void;
  onMapToggle?: () => void;
  onPanelToggle?: () => void;
  placeholder?: string;
  width?: string; // Custom width for the container
  hasPreviousSession?: boolean; // If true, show the panel open button
  initialValue?: string; // Initial query value when switching from SearchBar
}

export const MapChatBar: React.FC<MapChatBarProps> = ({
  onQuerySubmit,
  onMapToggle,
  onPanelToggle,
  placeholder = "Ask anything...",
  width = 'min(100%, 640px)', // Match SideChatPanel width for consistency
  hasPreviousSession = false,
  initialValue = ""
}) => {
  const [isSubmitted, setIsSubmitted] = React.useState<boolean>(false);
  const [showBarGlow, setShowBarGlow] = React.useState<boolean>(false);
  const chatBarGlowTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const CHAT_BAR_GLOW_DURATION_MS = 1900; // Pulse 1.5s + hold, then hide; 0.2s transition to finish before next interaction
  const startChatBarGlow = React.useCallback(() => {
    setShowBarGlow(true);
    if (chatBarGlowTimeoutRef.current) clearTimeout(chatBarGlowTimeoutRef.current);
    chatBarGlowTimeoutRef.current = setTimeout(() => {
      setShowBarGlow(false);
      chatBarGlowTimeoutRef.current = null;
    }, CHAT_BAR_GLOW_DURATION_MS);
  }, []);
  const [isFocused, setIsFocused] = React.useState<boolean>(false);
  const [isWebSearchEnabled, setIsWebSearchEnabled] = React.useState<boolean>(false);
  const [isCompact, setIsCompact] = React.useState<boolean>(false);
  const [atMentionDocumentChips, setAtMentionDocumentChips] = React.useState<Array<{ id: string; label: string }>>([]);
  const [atMentionOpen, setAtMentionOpen] = React.useState(false);
  const [atQuery, setAtQuery] = React.useState('');
  const [atAnchorIndex, setAtAnchorIndex] = React.useState(-1);
  const [atAnchorRect, setAtAnchorRect] = React.useState<{ left: number; top: number; bottom: number; height: number } | null>(null);
  const [atItems, setAtItems] = React.useState<AtMentionItem[]>([]);
  const [atSelectedIndex, setAtSelectedIndex] = React.useState(0);
  const inputRef = React.useRef<SegmentInputHandle | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const atMentionAnchorRef = React.useRef<HTMLDivElement>(null);
  const restoreSelectionRef = React.useRef<(() => void) | null>(null);
  const isDeletingRef = React.useRef(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  const { setSelectionModeActive, propertyAttachments, removePropertyAttachment, addPropertyAttachment, clearPropertyAttachments } = usePropertySelection();
  const { toggleDocumentSelection } = useDocumentSelection();

  const initialSegments = React.useMemo(
    () =>
      buildInitialSegments(
        initialValue ?? '',
        propertyAttachments.map((a) => ({ id: a.id, label: a.address, payload: a.property })),
        atMentionDocumentChips
      ),
    []
  );
  const segmentInput = useSegmentInput({
    initialSegments,
    onRemovePropertyChip: removePropertyAttachment,
    onRemoveDocumentChip: (id) => {
      toggleDocumentSelection(id);
      setAtMentionDocumentChips((prev) => prev.filter((d) => d.id !== id));
    },
  });

  React.useEffect(() => {
    if (initialValue !== undefined && segmentInput.getPlainText() !== initialValue) {
      segmentInput.setSegments(
        buildInitialSegments(
          initialValue,
          propertyAttachments.map((a) => ({ id: a.id, label: a.address, payload: a.property })),
          atMentionDocumentChips
        )
      );
    }
  }, [initialValue]);

  // Ensure chat bar glow keyframes exist (MapChatBar can be visible without SideChatPanel mounted)
  React.useEffect(() => {
    if (typeof document === 'undefined' || document.getElementById('map-chat-bar-glow-style')) return;
    const style = document.createElement('style');
    style.id = 'map-chat-bar-glow-style';
    style.textContent = `
      @keyframes chatBarGlowRotate {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes chatBarGlowPulse {
        0% { opacity: 0.35; }
        40% { opacity: 1; }
        100% { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
    return () => {
      const el = document.getElementById('map-chat-bar-glow-style');
      if (el) el.remove();
    };
  }, []);

  React.useEffect(() => {
    const plain = segmentInput.getPlainText();
    const cursorOffset = segmentInput.getCursorOffset();
    const lastAt = plain.slice(0, cursorOffset).lastIndexOf('@');
    const queryAfterAt = lastAt >= 0 ? plain.slice(lastAt + 1, cursorOffset) : '';
    // Close popover when user types a space after "@"
    if (lastAt >= 0 && !queryAfterAt.includes(' ')) {
      setAtMentionOpen(true);
      setAtQuery(queryAfterAt);
      setAtAnchorIndex(lastAt);
    } else {
      setAtMentionOpen(false);
      setAtQuery('');
      setAtAnchorIndex(-1);
    }
  }, [segmentInput.segments, segmentInput.cursor]);

  React.useEffect(() => {
    if (!atMentionOpen) {
      setAtItems([]);
      return;
    }
    setAtItems(getFilteredAtMentionItems(atQuery));
    preloadAtMentionCache().then(() => setAtItems(getFilteredAtMentionItems(atQuery)));
  }, [atMentionOpen, atQuery]);

  // Position @ popover at the "@" character (defer rect read so segment refs are ready)
  React.useEffect(() => {
    if (!atMentionOpen || atAnchorIndex < 0) {
      setAtAnchorRect(null);
      return;
    }
    let cancelled = false;
    const readRect = () => {
      if (cancelled) return;
      const rect = inputRef.current?.getRectForPlainOffset(atAnchorIndex);
      if (rect) {
        setAtAnchorRect({ left: rect.left, top: rect.top, bottom: rect.bottom, height: rect.height });
      } else {
        requestAnimationFrame(() => {
          if (cancelled) return;
          const retryRect = inputRef.current?.getRectForPlainOffset(atAnchorIndex);
          if (retryRect) {
            setAtAnchorRect({ left: retryRect.left, top: retryRect.top, bottom: retryRect.bottom, height: retryRect.height });
          } else {
            setAtAnchorRect(null);
          }
        });
      }
    };
    requestAnimationFrame(readRect);
    return () => { cancelled = true; };
  }, [atMentionOpen, atAnchorIndex, segmentInput.segments]);

  const handleAtSelect = React.useCallback(
    (item: AtMentionItem) => {
      const startPlain = Math.max(0, atAnchorIndex);
      const endPlain = segmentInput.getCursorOffset();
      const startPos = segmentInput.getSegmentOffsetFromPlain(startPlain);
      const endPos = segmentInput.getSegmentOffsetFromPlain(endPlain);
      if (startPos != null && endPos != null) {
        segmentInput.removeSegmentRange(startPos.segmentIndex, startPos.offset, endPos.segmentIndex, endPos.offset);
      } else {
        segmentInput.removeRange(startPlain, endPlain);
      }
      setAtMentionOpen(false);
      if (item.type === 'property') {
        const property = item.payload as { id: string; address: string; [key: string]: unknown };
        addPropertyAttachment(property as unknown as Parameters<typeof addPropertyAttachment>[0]);
        segmentInput.insertChipAtCursor(
          { type: 'chip', kind: 'property', id: property.id, label: property.address || item.primaryLabel, payload: property },
          { trailingSpace: true }
        );
      } else {
        toggleDocumentSelection(item.id);
        setAtMentionDocumentChips((prev) => [...prev, { id: item.id, label: item.primaryLabel }]);
        segmentInput.insertChipAtCursor(
          { type: 'chip', kind: 'document', id: item.id, label: item.primaryLabel },
          { trailingSpace: true }
        );
      }
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        requestAnimationFrame(() => restoreSelectionRef.current?.());
      });
    },
    [atAnchorIndex, addPropertyAttachment, toggleDocumentSelection, segmentInput]
  );

  // Track form width for responsive model selector
  React.useEffect(() => {
    if (!formRef.current) return;

    const updateCompact = () => {
      if (formRef.current) {
        const formWidth = formRef.current.offsetWidth;
        // Show compact mode (star icon only) when form width is <= 425px (same threshold as SideChatPanel)
        // This matches the logic in SideChatPanel where compact mode triggers at minimum width
        setIsCompact(formWidth <= 425);
      }
    };

    // Initial check
    updateCompact();

    // Use ResizeObserver to track width changes
    const resizeObserver = new ResizeObserver(updateCompact);
    resizeObserver.observe(formRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitted = segmentInput.getPlainText().trim();
    if ((submitted || propertyAttachments.length > 0 || atMentionDocumentChips.length > 0) && !isSubmitted && onQuerySubmit) {
      setIsSubmitted(true);
      const contentSegments: QueryContentSegment[] = [];
      for (const seg of segmentInput.segments) {
        if (isTextSegment(seg)) {
          if (seg.value) contentSegments.push({ type: 'text', value: seg.value });
        } else if (isChipSegment(seg)) {
          if (seg.kind === 'property') {
            const attachment = propertyAttachments.find(
              (a) => String(a.propertyId) === String(seg.id) || (a.property as any)?.id == seg.id
            );
            if (attachment) {
              contentSegments.push({ type: 'property', attachment });
            } else {
              const p = (seg.payload as any) || {};
              const addr = p.formatted_address || p.normalized_address || p.address || 'Unknown Address';
              contentSegments.push({
                type: 'property',
                attachment: { id: seg.id, propertyId: seg.id, address: addr, imageUrl: '', property: p }
              });
            }
          } else {
            const name = atMentionDocumentChips.find((c) => c.id === seg.id)?.label ?? seg.label ?? seg.id;
            contentSegments.push({ type: 'document', id: seg.id, name });
          }
        }
      }
      startChatBarGlow();
      onQuerySubmit(submitted, contentSegments.length > 0 ? { contentSegments } : undefined);
      segmentInput.setSegments([{ type: 'text', value: '' }]);
      setAtMentionDocumentChips([]);
      if (propertyAttachments.length > 0) {
        setSelectionModeActive(false);
      }
      setIsSubmitted(false);
    }
  };

  return (
    <div 
      className="w-full flex justify-center items-center" 
      style={{ 
        ...getInputBarFixedContainerStyles(INPUT_BAR_SPACE_BELOW_MAP_LARGE, { zIndex: 50 }),
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        paddingLeft: '32px',
        paddingRight: '32px',
      }}
    >
      <form ref={formRef} onSubmit={handleSubmit} className="relative" style={{ overflow: 'visible', height: 'auto', width: '100%' }}>
        {/* Toggle Panel Button - Floating to the right of the chat bar */}
        {hasPreviousSession && onPanelToggle && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            style={{
              position: 'absolute',
              left: '-50px', // Position outside the chat bar to the left
              bottom: '0',
              height: '100%',
              display: 'flex',
              alignItems: 'flex-end', // Align with bottom of chat bar
              paddingBottom: '6px',
              zIndex: 51
            }}
          >
            <button
              type="button"
              onClick={onPanelToggle}
              className="flex items-center justify-center bg-white rounded-lg shadow-md border border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all duration-200"
              style={{
                width: '40px',
                height: '40px'
              }}
              title="Open chat history"
            >
              <PanelRightOpen className="w-5 h-5" />
            </button>
          </motion.div>
        )}

        {/* Glow wrapper: soft pulse effect around chat bar */}
        <div
          style={{
            position: 'relative',
            padding: showBarGlow ? 2 : 0,
            borderRadius: '28px',
            overflow: 'hidden',
            width: '100%',
            boxSizing: 'border-box',
            transition: 'padding 0.2s ease-out',
          }}
        >
          {showBarGlow && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '28px',
                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.5), rgba(34, 197, 94, 0.45))',
                animation: 'chatBarGlowPulse 1.5s ease-in-out forwards',
                pointerEvents: 'none',
                filter: 'blur(2px)',
              }}
            />
          )}
        <div 
          className={`relative flex flex-col ${isSubmitted ? 'opacity-75' : ''}`}
          style={{
            background: '#FFFFFF',
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: showBarGlow ? 'transparent' : '#B8BCC4',
            boxShadow: 'none', // No shadow like SideChatPanel
            position: 'relative',
            paddingTop: '16px',
            paddingBottom: '24px',
            paddingRight: '16px',
            paddingLeft: '16px',
            overflow: 'hidden',
            width: '100%',
            minWidth: '300px',
            height: '132px',
            minHeight: '132px',
            boxSizing: 'border-box',
            borderRadius: showBarGlow ? '26px' : '28px',
            transition: 'background-color 0.2s ease-in-out, border-color 0.28s ease-out, box-shadow 0.2s ease-in-out, border-radius 0.2s ease-out',
            zIndex: 2
          }}
        >
          {/* Input row - fixed height so bar never moves when typing */}
          <div 
            className="relative flex flex-col w-full" 
            style={{ 
              height: '92px',
              minHeight: '92px',
              width: '100%',
              minWidth: '0',
              gap: '2px',
              flexShrink: 0,
              overflow: 'hidden',
            }}
          >
            {/* SegmentInput + @ context - chips only inline (no row above, matches SearchBar) */}
            <div
              ref={atMentionAnchorRef}
              className="flex items-start w-full"
              style={{
                height: '48px',
                minHeight: '48px',
                width: '100%',
                marginBottom: '6px',
                flexShrink: 0,
              }}
            >
              <div
                className="flex-1 relative flex items-start w-full"
                style={{ overflow: 'visible', height: '36px', minHeight: '36px', width: '100%', minWidth: '0', flexShrink: 0 }}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
              >
                {(segmentInput.getPlainText().trim() !== '' || propertyAttachments.length > 0 || atMentionDocumentChips.length > 0) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      segmentInput.setSegments([{ type: 'text', value: '' }]);
                      setAtMentionDocumentChips([]);
                      clearPropertyAttachments();
                      inputRef.current?.focus();
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 text-gray-400 hover:text-gray-600 transition-colors z-10"
                    title="Clear query"
                    aria-label="Clear query"
                  >
                    <X className="w-3.5 h-3.5" strokeWidth={2} />
                  </button>
                )}
                <SegmentInput
                  ref={inputRef}
                  segments={segmentInput.segments}
                  cursor={segmentInput.cursor}
                  onCursorChange={(segmentIndex, offset) => segmentInput.setCursor({ segmentIndex, offset })}
                  onInsertText={(char) => {
                    if (char === '\n') {
                      handleSubmit(null as any);
                      return;
                    }
                    segmentInput.insertTextAtCursor(char);
                  }}
                  onBackspace={segmentInput.backspace}
                  onDelete={segmentInput.deleteForward}
                  onDeleteSegmentRange={segmentInput.removeSegmentRange}
                  onMoveLeft={segmentInput.moveCursorLeft}
                  onMoveRight={segmentInput.moveCursorRight}
                  onRemovePropertyChip={removePropertyAttachment}
                  onRemoveDocumentChip={(id) => {
                    toggleDocumentSelection(id);
                    setAtMentionDocumentChips((prev) => prev.filter((d) => d.id !== id));
                  }}
                  removeChipAtSegmentIndex={segmentInput.removeChipAtIndex}
                  restoreSelectionRef={restoreSelectionRef}
                  placeholder={placeholder}
                  placeholderFontSize="16.38px"
                  disabled={isSubmitted}
                  style={{
                    width: '100%',
                    minHeight: '28px',
                    maxHeight: `${CHAT_INPUT_MAX_HEIGHT_PX}px`,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    lineHeight: '20px',
                    paddingTop: '12px',
                    paddingBottom: '4px',
                    paddingRight: (segmentInput.getPlainText().trim() !== '' || propertyAttachments.length > 0 || atMentionDocumentChips.length > 0) ? '30px' : '12px',
                    paddingLeft: '14px',
                    color: segmentInput.getPlainText() ? '#0D0D0D' : undefined,
                    boxSizing: 'border-box',
                  }}
                  onKeyDown={(e) => {
                    if (atMentionOpen && e.key === 'Enter') return;
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                    if (e.key === 'Backspace' || e.key === 'Delete') {
                      isDeletingRef.current = true;
                      setTimeout(() => { isDeletingRef.current = false; }, 200);
                    }
                  }}
                />
              </div>
              <AtMentionPopover
                open={atMentionOpen}
                anchorRef={atMentionAnchorRef}
                anchorRect={atAnchorRect}
                query={atQuery}
                placement="above"
                items={atItems}
                selectedIndex={atSelectedIndex}
                onSelect={handleAtSelect}
                onSelectedIndexChange={setAtSelectedIndex}
                onClose={() => {
                  setAtMentionOpen(false);
                  setAtItems([]);
                }}
              />
            </div>
            
            {/* Bottom row: Plus (Left) only; Right: Mode, Model, Voice, WebSearchPill, Send */}
            <div 
              className="relative flex items-center justify-between w-full"
              style={{
                width: '100%',
                minWidth: '0',
                height: '36px',
                minHeight: '36px',
                flexShrink: 0,
              }}
            >
              {/* Left: Plus (Attach dropdown) only */}
              <div className="flex items-center gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={(e) => {
                    // File handling can be wired by parent if needed
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="hidden"
                  accept="image/*,.pdf,.doc,.docx"
                />
                <ChatBarAttachDropdown
                onAttachClick={() => fileInputRef.current?.click()}
                toolsItems={[
                  {
                    id: 'web-search',
                    icon: Globe,
                    label: 'Search the web',
                    onClick: () => setIsWebSearchEnabled((prev) => !prev),
                  },
                  {
                    id: 'dashboard',
                    icon: LibraryBig,
                    label: 'Dashboard',
                    onClick: () => onMapToggle?.(),
                  },
                  ...(onPanelToggle ? [{
                    id: 'chat',
                    icon: PanelRightOpen,
                    label: 'Chat',
                    onClick: () => onPanelToggle(),
                  }] : []),
                ]}
              />
              </div>

              {/* Right: Mode, Model, Voice, WebSearchPill, Send */}
              <motion.div 
                className="flex items-center gap-1.5 flex-shrink-0" 
                style={{ marginRight: '4px' }}
                layout
                transition={{ 
                  layout: { duration: 0.12, ease: [0.16, 1, 0.3, 1] },
                  default: { duration: 0.18, ease: [0.16, 1, 0.3, 1] }
                }}
              >
                <ModeSelector compact={true} className="mr-2" />
                <ModelSelector compact={true} />
                <button
                  type="button"
                  className="flex items-center justify-center text-gray-900 focus:outline-none outline-none"
                  style={{
                    backgroundColor: 'transparent',
                    height: '22px',
                    minHeight: '22px',
                    padding: '0 2px',
                    marginLeft: '-4px'
                  }}
                  title="Voice input"
                >
                  <AudioLines className="w-3.5 h-3.5 text-gray-900" strokeWidth={1.5} />
                </button>
                {isWebSearchEnabled && (
                  <WebSearchPill onDismiss={() => setIsWebSearchEnabled(false)} />
                )}
                
                {/* Send button */}
                <AnimatePresence>
                  {(segmentInput.getPlainText().trim() || propertyAttachments.length > 0 || atMentionDocumentChips.length > 0) && (
                    <motion.button 
                      key="send-button"
                      type="submit" 
                      onClick={handleSubmit} 
                      initial={{ opacity: 1, scale: 1 }}
                      animate={{ opacity: 1, scale: 1, backgroundColor: '#4A4A4A' }}
                      exit={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0 }}
                      className={`flex items-center justify-center relative focus:outline-none outline-none ${!isSubmitted ? '' : 'cursor-not-allowed'}`}
                      style={{
                        width: '30px',
                        height: '30px',
                        minWidth: '30px',
                        minHeight: '30px',
                        maxWidth: '30px',
                        maxHeight: '30px',
                        borderRadius: '50%',
                        border: 'none',
                        flexShrink: 0,
                        alignSelf: 'center'
                      }}
                      disabled={isSubmitted}
                      title="Send"
                      tabIndex={0}
                      whileHover={!isSubmitted ? { 
                        scale: 1.05
                      } : {}}
                      whileTap={!isSubmitted ? { 
                        scale: 0.95
                      } : {}}
                    >
                      <motion.div
                        key="arrow-up"
                        initial={{ opacity: 1 }}
                        animate={{ opacity: 1 }}
                        className="absolute inset-0 flex items-center justify-center"
                        style={{ pointerEvents: 'none' }}
                      >
                        <ArrowUp className="w-5 h-5" strokeWidth={2.5} style={{ color: '#ffffff' }} />
                      </motion.div>
                    </motion.button>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>
          </div>
        </div>
        </div>
      </form>
    </div>
  );
};


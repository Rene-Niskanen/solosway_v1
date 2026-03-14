"use client";

/**
 * Unified ChatBar UI – shared by dashboard (SearchBar) and chat (SideChatPanel).
 * Same structure, styles, and components; different submit logic and context-specific buttons.
 */

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, CloudUpload, Globe, AudioLines, X, FileText, type LucideIcon } from "lucide-react";
import { FileAttachment } from "./FileAttachment";
import { PropertyPillChip } from "./PropertyPillChip";
import { ChatBarAttachDropdown } from "./ChatBarAttachDropdown";
import type { ChatBarToolsDropdownItem } from "./ChatBarToolsDropdown";
import { ModelSelector } from "./ModelSelector";
import { WebSearchPill } from "./SelectedModePill";
import { SegmentInput, type SegmentInputHandle } from "./SegmentInput";
import { AtMentionPopover, type AtMentionItem } from "./AtMentionPopover";
import {
  CHAT_BAR_DESIGN,
  getChatBarInnerStyle,
  getChatBarDragOverlayStyle,
  getChatBarAttachmentsRowStyle,
  getChatBarSegmentInputRowStyle,
  getChatBarButtonRowStyle,
  getChatBarSegmentInputStyle,
  CHAT_INPUT_MAX_HEIGHT_PX,
} from "@/utils/inputBarPosition";
import type { FileAttachmentData } from "./FileAttachment";
import type { PropertyAttachmentData } from "./PropertyAttachment";

export type ChatBarVariant = "dashboard" | "chat";

export interface ChatBarToolsItem {
  id: string;
  icon: LucideIcon;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  badge?: string;
}

export interface ChatBarDocumentChip {
  id: string;
  name: string;
  fullName?: string;
}

export interface ChatBarProps {
  variant: ChatBarVariant;
  /** Use smaller height/width for dashboard SearchBar */
  compact?: boolean;
  isEmptyState?: boolean;
  /** Submit handler – dashboard triggers search, chat sends message */
  onSubmit: (e: React.FormEvent) => void;
  isSubmitted: boolean;

  /** Segment input state (from useSegmentInput) */
  segmentInput: {
    segments: any[];
    cursor: any;
    getPlainText: () => string;
    setSegments: (s: any[]) => void;
    setCursor: (c: any | ((prev: any) => any)) => void;
    insertTextAtCursor: (char: string) => void;
    backspace: () => void;
    deleteForward: () => void;
    removeSegmentRange: (s1: number, o1: number, s2: number, o2: number) => void;
    moveCursorLeft: () => void;
    moveCursorRight: () => void;
    removeChipAtIndex: (idx: number) => void;
    removeRange: (start: number, end: number) => void;
    getSegmentOffsetFromPlain: (n: number) => { segmentIndex: number; offset: number } | null;
    getCursorOffset: () => number;
    insertChipAtCursor: (chip: any, opts?: { trailingSpace?: boolean }) => void;
    getRectForPlainOffset?: (n: number) => DOMRect | null;
  };

  /** Attachments */
  attachedFiles: FileAttachmentData[];
  propertyAttachments: PropertyAttachmentData[];
  selectedDocumentsWithNames?: ChatBarDocumentChip[];
  onRemoveFile: (id: string) => void;
  onRemoveProperty: (id: string) => void;
  onToggleDocumentSelection?: (id: string) => void;
  onClearInput?: () => void;

  /** At-mention popover */
  atMentionOpen: boolean;
  atMentionAnchorRef: React.RefObject<HTMLDivElement | null>;
  atAnchorRect: { left: number; top: number; bottom: number; height: number } | null;
  atQuery: string;
  atItems: AtMentionItem[];
  atSelectedIndex: number;
  onAtSelect: (item: AtMentionItem) => void;
  onAtSelectedIndexChange: (n: number) => void;
  onAtClose: () => void;

  /** Input */
  placeholder: string;
  leadingPill?: React.ReactNode;

  /** Ref */
  inputRef: React.RefObject<SegmentInputHandle | null>;
  restoreSelectionRef: React.RefObject<(() => void) | null>;

  /** Drag & drop */
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;

  /** File input */
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAttachClick: () => void;
  onChooseDocumentsClick?: () => void;

  /** Web search */
  isWebSearchEnabled: boolean;
  onWebSearchToggle: () => void;

  /** Tools (e.g. Web search in dropdown) */
  toolsItems?: ChatBarToolsItem[];

  /** Dashboard-only: Map, Dashboard, Analyse, Document selection */
  onMapToggle?: () => void;
  onDashboardClick?: () => void;
  onPanelToggle?: () => void;
  isMapVisible?: boolean;
  hasPerformedSearch?: boolean;
  isPropertyDetailsOpen?: boolean;
  hasPreviousSession?: boolean;
  selectedDocumentIds?: Set<string>;
  isDocumentSelectionMode?: boolean;
  onToggleDocumentSelectionMode?: () => void;
  onOpenDocumentSelection?: () => void;
  onClearSelectedDocuments?: () => void;

  /** Button row collapse (responsive) */
  buttonCollapseLevel?: number;

  /** Preview handler for files */
  onFilePreview?: (file: FileAttachmentData) => void;

  /** Data attribute for form */
  dataAttribute?: string;

  /** Optional ref forwarded to the form element */
  formRef?: React.Ref<HTMLFormElement | null>;

  /** Optional ref for the inner drop zone (for document-level drag detection) */
  dropZoneRef?: React.RefObject<HTMLDivElement | null>;

  /** Optional extra right-side buttons (e.g. Map, Dashboard, Analyse for dashboard) - rendered before WebSearchPill */
  renderExtraRightButtons?: () => React.ReactNode;
}

export function ChatBar({
  variant,
  compact = false,
  isEmptyState = true,
  onSubmit,
  isSubmitted,
  segmentInput,
  attachedFiles,
  propertyAttachments,
  selectedDocumentsWithNames = [],
  onRemoveFile,
  onRemoveProperty,
  onToggleDocumentSelection,
  onClearInput,
  atMentionOpen,
  atMentionAnchorRef,
  atAnchorRect,
  atQuery,
  atItems,
  atSelectedIndex,
  onAtSelect,
  onAtSelectedIndexChange,
  onAtClose,
  placeholder,
  leadingPill,
  inputRef,
  restoreSelectionRef,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  fileInputRef,
  onFileSelect,
  onAttachClick,
  onChooseDocumentsClick,
  isWebSearchEnabled,
  onWebSearchToggle,
  toolsItems = [],
  onMapToggle,
  onDashboardClick,
  onPanelToggle,
  isMapVisible = false,
  hasPerformedSearch = false,
  isPropertyDetailsOpen = false,
  hasPreviousSession = false,
  selectedDocumentIds = new Set(),
  isDocumentSelectionMode = false,
  onToggleDocumentSelectionMode,
  onOpenDocumentSelection,
  onClearSelectedDocuments,
  buttonCollapseLevel = 0,
  onFilePreview,
  dataAttribute = "data-chat-bar",
  formRef,
  dropZoneRef,
  renderExtraRightButtons,
}: ChatBarProps) {
  const hasContent =
    segmentInput.getPlainText().trim() !== "" ||
    attachedFiles.length > 0 ||
    propertyAttachments.length > 0 ||
    selectedDocumentsWithNames.length > 0 ||
    selectedDocumentIds.size > 0;

  const showClearButton =
    hasContent ||
    (variant === "chat" && attachedFiles.length > 0);

  const isVeryNarrow = buttonCollapseLevel >= 3;
  const showAttachIconOnly = buttonCollapseLevel >= 1;
  const showModelIconOnly = buttonCollapseLevel >= 2;
  const hideVoice = buttonCollapseLevel >= 3;

  const baseToolsItems: ChatBarToolsDropdownItem[] = [
    {
      id: "web-search",
      icon: Globe,
      label: "Web search",
      onClick: () => onWebSearchToggle(),
    },
    ...(toolsItems.filter((t) => t.id !== "web-search") as ChatBarToolsDropdownItem[]),
  ];

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="relative"
      {...{ [dataAttribute]: "true" }}
      onClick={(e) => e.stopPropagation()}
      style={{
        overflow: "visible",
        height: "auto",
        width: "100%",
        pointerEvents: "auto",
        margin: "-10px",
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        ref={dropZoneRef}
        className={`relative flex flex-col ${isSubmitted && !isDragOver ? "opacity-75" : ""}`}
        onClick={(e) => e.stopPropagation()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={getChatBarInnerStyle(isDragOver, { compact })}
      >
        {isDragOver ? (
          <div style={getChatBarDragOverlayStyle()}>
            <CloudUpload className="text-gray-400" size={36} strokeWidth={2} />
          </div>
        ) : (
          <>
            {/* Attachments row */}
            <AnimatePresence mode="wait">
              {(attachedFiles.length > 0 ||
                propertyAttachments.length > 0 ||
                selectedDocumentsWithNames.length > 0) && (
                <motion.div
                  key="attachments"
                  initial={false}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.1, ease: "easeOut" }}
                  style={getChatBarAttachmentsRowStyle({ compact })}
                  className="flex flex-wrap gap-2 justify-start"
                >
                  {attachedFiles.map((file) => (
                    <FileAttachment
                      key={file.id}
                      attachment={file}
                      onRemove={onRemoveFile}
                      onPreview={onFilePreview || (() => {})}
                      onDragStart={() => {}}
                      onDragEnd={() => {}}
                      variant="chat"
                    />
                  ))}
                  {propertyAttachments.map((a) => (
                    <PropertyPillChip
                      key={a.id}
                      label={a.address}
                      title={a.address}
                      documentCount={
                        (a.property as { documentCount?: number; document_count?: number })?.documentCount ??
                        (a.property as { document_count?: number })?.document_count
                      }
                      onRemove={() => onRemoveProperty(a.id)}
                    />
                  ))}
                  {selectedDocumentsWithNames.map((d) => (
                    <span
                      key={d.id}
                      className="relative bg-white rounded-lg border border-gray-200 px-2.5 py-2 cursor-default hover:border-gray-300 transition-all duration-100 inline-flex items-center gap-2 flex-shrink-0"
                      title={d.fullName ?? d.name}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                        <FileText className="w-3 h-3 text-gray-500" strokeWidth={2} />
                      </span>
                      <span
                        className="text-xs font-medium text-black truncate"
                        style={{ whiteSpace: "nowrap", maxWidth: "200px" }}
                      >
                        {d.name}
                      </span>
                      {onToggleDocumentSelection && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onToggleDocumentSelection(d.id);
                          }}
                          className="w-6 h-6 flex items-center justify-center flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors ml-2"
                          title="Remove from selection"
                        >
                          <X className="w-3 h-3" strokeWidth={2.5} />
                        </button>
                      )}
                    </span>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* SegmentInput row */}
            <div
              className="flex items-start w-full"
              style={getChatBarSegmentInputRowStyle({ compact })}
            >
              <div
                ref={atMentionAnchorRef}
                className="flex-1 relative flex items-start w-full"
                style={{
                  overflow: "visible",
                  height: "auto",
                  minHeight: compact ? '92px' : CHAT_BAR_DESIGN.SEGMENT_INPUT_ROW.MIN_HEIGHT,
                  width: "100%",
                  minWidth: "0",
                  flexShrink: 0,
                  paddingRight: showClearButton ? "56px" : 0,
                }}
                onFocus={() => {}}
                onBlur={() => {}}
                onClick={(e) => e.stopPropagation()}
              >
                {showClearButton && onClearInput && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onClearInput();
                      inputRef.current?.focus?.();
                    }}
                    className="absolute right-2 top-[11px] -translate-y-1/2 flex items-center justify-center w-6 h-6 text-gray-400 hover:text-gray-600 transition-colors z-10"
                    title="Clear"
                    aria-label="Clear"
                  >
                    <X className="w-5 h-5" strokeWidth={1.25} />
                  </button>
                )}
                <SegmentInput
                  ref={inputRef}
                  segments={segmentInput.segments}
                  cursor={segmentInput.cursor}
                  onCursorChange={(segmentIndex, offset) =>
                    segmentInput.setCursor({ segmentIndex, offset })
                  }
                  onInsertText={(char) => {
                    if (char === "\n") {
                      onSubmit(null as any);
                      return;
                    }
                    segmentInput.insertTextAtCursor(char);
                  }}
                  onBackspace={segmentInput.backspace}
                  onDelete={segmentInput.deleteForward}
                  onDeleteSegmentRange={segmentInput.removeSegmentRange}
                  onMoveLeft={segmentInput.moveCursorLeft}
                  onMoveRight={segmentInput.moveCursorRight}
                  onRemovePropertyChip={onRemoveProperty}
                  onRemoveDocumentChip={(id) => {
                    onToggleDocumentSelection?.(id);
                  }}
                  removeChipAtSegmentIndex={segmentInput.removeChipAtIndex}
                  restoreSelectionRef={restoreSelectionRef}
                  placeholder={placeholder}
                  placeholderFontSize="16.38px"
                  leadingPill={leadingPill}
                  disabled={isSubmitted}
                  style={{
                    ...getChatBarSegmentInputStyle({ compact }),
                    maxHeight: `${CHAT_INPUT_MAX_HEIGHT_PX}px`,
                    color: segmentInput.getPlainText() ? "#333333" : undefined,
                  }}
                  scrollWrapperPaddingBottom="14px"
                  onKeyDown={(e) => {
                    if (atMentionOpen && e.key === "Enter") return;
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      onSubmit(e as any);
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
                onSelect={onAtSelect}
                onSelectedIndexChange={onAtSelectedIndexChange}
                onClose={onAtClose}
              />
            </div>

            {/* Button row */}
            <div
              className={`relative flex w-full ${isVeryNarrow ? "flex-col gap-2" : "items-center justify-between"}`}
              style={{
                ...getChatBarButtonRowStyle(isEmptyState ?? true, isVeryNarrow, { compact }),
                overflow: "visible",
              }}
            >
              {/* Left: Attach dropdown */}
              <div
                className={`flex items-center gap-0.5 ${isVeryNarrow ? "justify-start" : ""}`}
                style={{ flexShrink: 1, minWidth: 0, overflow: "visible" }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={onFileSelect}
                  className="hidden"
                  accept="image/*,.pdf,.doc,.docx,.xlsx,.xls,.pptx,.ppt"
                />
                <ChatBarAttachDropdown
                  onAttachClick={onAttachClick}
                  onChooseDocumentsClick={onChooseDocumentsClick}
                  compact={showAttachIconOnly}
                  toolsItems={baseToolsItems}
                />
              </div>

              {/* Right: Model, Voice, WebSearchPill, Context buttons, Send */}
              <div
                className={`flex items-center gap-1.5 flex-shrink-0 ${isVeryNarrow ? "flex-wrap justify-end" : ""}`}
                style={{ marginRight: variant === "chat" ? "4px" : "0" }}
              >
                {!isVeryNarrow && <ModelSelector compact={true} />}
                {!hideVoice && (
                  <button
                    type="button"
                    onClick={() => {}}
                    className="flex items-center gap-1.5 text-gray-600 transition-colors focus:outline-none outline-none hover:bg-black/[0.05]"
                    style={{
                      backgroundColor: "transparent",
                      padding: "6px 10px 6px 4px",
                      borderRadius: "8px",
                      border: "none",
                    }}
                    title="Voice input"
                  >
                    <AudioLines className="w-4 h-4" strokeWidth={1.5} />
                  </button>
                )}

                {renderExtraRightButtons?.()}

                {isWebSearchEnabled && (
                  <WebSearchPill onDismiss={() => onWebSearchToggle()} />
                )}

                <AnimatePresence>
                  {hasContent && (
                    <motion.button
                      key="send-button"
                      type="submit"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={onSubmit}
                      initial={{ opacity: 1, scale: 1, backgroundColor: "#18181b" }}
                      animate={{ opacity: 1, scale: 1, backgroundColor: "#18181b" }}
                      exit={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0 }}
                      className={`flex items-center justify-center relative focus:outline-none outline-none ${!isSubmitted ? "" : "cursor-not-allowed"}`}
                      style={{
                        width: "30px",
                        height: "30px",
                        minWidth: "30px",
                        minHeight: "30px",
                        maxWidth: "30px",
                        maxHeight: "30px",
                        borderRadius: "50%",
                        border: "none",
                        flexShrink: 0,
                        alignSelf: "center",
                        position: "relative",
                        zIndex: 10,
                      }}
                      disabled={isSubmitted}
                      title="Send"
                      tabIndex={0}
                    >
                      <ArrowUp
                        className="w-4 h-4"
                        strokeWidth={2.5}
                        style={{ color: "#ffffff" }}
                      />
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </>
        )}
      </div>
    </form>
  );
}

"use client";

import * as React from "react";
import { Plus, MoreHorizontal, Loader2, CircleCheck, PanelRight } from "lucide-react";
import type { ChatHistoryEntry } from "./ChatHistoryContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const MAX_TITLE_LENGTH = 22;

function isEmptyNewChat(c: ChatHistoryEntry): boolean {
  return (!c.title || c.title === "New chat") && (!c.messages || c.messages.length === 0);
}

function dedupeEmptyNewChats(chats: ChatHistoryEntry[], selectedChatId: string | null): ChatHistoryEntry[] {
  const emptyOnes = chats.filter(isEmptyNewChat);
  if (emptyOnes.length <= 1) return chats;
  const keepId = selectedChatId && emptyOnes.some((e) => e.id === selectedChatId)
    ? selectedChatId
    : emptyOnes[0].id;
  return chats.filter((c) => {
    if (!isEmptyNewChat(c)) return true;
    return c.id === keepId;
  });
}

function truncateTitle(title: string): string {
  if (!title || title.length <= MAX_TITLE_LENGTH) return title || "New chat";
  return title.slice(0, MAX_TITLE_LENGTH - 2) + "…";
}

export interface ChatTabsBarProps {
  chats: ChatHistoryEntry[];
  selectedChatId: string | null;
  onChatSelect: (chatId: string) => void;
  onNewChat: () => void;
  onOpenAgents?: () => void;
  onUpdateChatTitle?: (chatId: string, newTitle: string) => void;
  onArchiveChat?: (chatId: string) => void;
  onUnarchiveChat?: (chatId: string) => void;
  onRemoveChat?: (chatId: string) => void;
  /** When true, bar spans full width (e.g. at top when agent sidebar closed). When false, centered with left margin for header layout. */
  fullWidth?: boolean;
}

export const ChatTabsBar: React.FC<ChatTabsBarProps> = ({
  chats,
  selectedChatId,
  onChatSelect,
  onNewChat,
  onOpenAgents,
  onUpdateChatTitle,
  onArchiveChat,
  onUnarchiveChat,
  onRemoveChat,
  fullWidth = false,
}) => {
  const [editingChatId, setEditingChatId] = React.useState<string | null>(null);
  const [editingTitle, setEditingTitle] = React.useState("");
  const editInputRef = React.useRef<HTMLInputElement>(null);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const prevChatsLengthRef = React.useRef(chats.length);

  // Auto-scroll to the right (most recent chats) only when NEW chats are added,
  // NOT when selection changes. This prevents jitter when switching between tabs.
  React.useLayoutEffect(() => {
    const chatsAdded = chats.length > prevChatsLengthRef.current;
    prevChatsLengthRef.current = chats.length;

    if (chatsAdded) {
      const el = scrollContainerRef.current;
      if (el) {
        const scrollToEnd = () => {
          el.scrollLeft = el.scrollWidth - el.clientWidth;
        };
        scrollToEnd();
        requestAnimationFrame(scrollToEnd);
      }
    }
  }, [chats]);

  React.useEffect(() => {
    if (editingChatId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingChatId]);

  const handleStartEdit = (e: React.MouseEvent, chatId: string, currentTitle: string) => {
    e.stopPropagation();
    setEditingChatId(chatId);
    setEditingTitle(currentTitle || "New chat");
  };

  const handleSaveEdit = (chatId: string) => {
    if (editingTitle.trim() && onUpdateChatTitle) {
      onUpdateChatTitle(chatId, editingTitle.trim());
    }
    setEditingChatId(null);
    setEditingTitle("");
  };

  const handleKeyDown = (e: React.KeyboardEvent, chatId: string) => {
    if (e.key === "Enter") {
      handleSaveEdit(chatId);
    }
    if (e.key === "Escape") {
      setEditingChatId(null);
      setEditingTitle("");
    }
  };

  return (
    <div
      data-chat-tabs-bar
      className={`flex items-center gap-1 min-h-[23px] w-full ${fullWidth ? 'justify-between' : 'justify-center mx-auto'}`}
      style={{ marginTop: 6 }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Chat tabs - scrollable */}
      <div
        ref={scrollContainerRef}
        className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {dedupeEmptyNewChats(chats, selectedChatId).map((chat) => {
          const isSelected = selectedChatId === chat.id;
          const isEditing = editingChatId === chat.id;

          return (
            <div
              key={chat.id}
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                if (!isEditing && onChatSelect) onChatSelect(chat.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (!isEditing) onChatSelect(chat.id);
                }
              }}
              className={`
                flex items-center gap-1 cursor-pointer flex-shrink-0 px-1.5 py-0.5
                transition-all duration-75 ease-out group
                ${isSelected
                  ? "bg-[#E5E7EB] border-none rounded-[3px]"
                  : "bg-transparent border-none hover:opacity-80"
                }
              `}
              style={{ minHeight: 23, maxWidth: 112 }}
            >
              {chat.status === "loading" && (
                <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0 text-[#6B7280]" strokeWidth={1.5} />
              )}
              {chat.status === "completed" && (
                <CircleCheck className="w-3.5 h-3.5 flex-shrink-0 text-[#6B7280]" strokeWidth={1.5} aria-hidden />
              )}
              {isEditing ? (
                <input
                  ref={editInputRef}
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onBlur={() => handleSaveEdit(chat.id)}
                  onKeyDown={(e) => handleKeyDown(e, chat.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 max-w-[130px] text-[12.5px] font-normal bg-transparent border-none focus:outline-none focus:ring-0"
                  style={{ color: "#374151" }}
                />
              ) : (
                <div className="flex-1 min-w-0 overflow-hidden flex items-center">
                  <span
                    className={`text-[12.5px] font-normal block whitespace-nowrap overflow-hidden ${isSelected ? "truncate" : ""}`}
                    style={{
                      color: "#374151",
                      ...(!isSelected && (chat.title || "New chat").length > 16 && {
                        maskImage: "linear-gradient(to right, black 75%, transparent 100%)",
                        WebkitMaskImage: "linear-gradient(to right, black 75%, transparent 100%)",
                      }),
                    }}
                    title={chat.title || "New chat"}
                  >
                    {isSelected ? truncateTitle(chat.title || "New chat") : (chat.title || "New chat")}
                  </span>
                </div>
              )}
              {/* Per-tab ellipsis menu */}
              {(onUpdateChatTitle || onArchiveChat || onUnarchiveChat || onRemoveChat) && !isEditing && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      className="p-0.5 rounded flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Chat options"
                    >
                      <MoreHorizontal className="w-4 h-4 text-[#6B7280]" strokeWidth={1.5} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" sideOffset={4} className="min-w-[88px] p-0.5 rounded-[1px]">
                    {onUpdateChatTitle && (
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleStartEdit(e as unknown as React.MouseEvent, chat.id, chat.title || "New chat"); }} className="py-0.5 px-1.5 min-h-0 text-[14px] font-light focus:bg-gray-100 focus:text-inherit data-[highlighted]:bg-gray-100 data-[highlighted]:text-inherit">
                        Rename
                      </DropdownMenuItem>
                    )}
                    {onArchiveChat && onUnarchiveChat && (
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); chat.archived ? onUnarchiveChat(chat.id) : onArchiveChat(chat.id); }} className="py-0.5 px-1.5 min-h-0 text-[14px] font-light focus:bg-gray-100 focus:text-inherit data-[highlighted]:bg-gray-100 data-[highlighted]:text-inherit">
                        {chat.archived ? "Unarchive" : "Archive"}
                      </DropdownMenuItem>
                    )}
                    {onRemoveChat && (
                      <DropdownMenuItem
                        onClick={(e) => { e.stopPropagation(); onRemoveChat(chat.id); }}
                        className="text-red-600 focus:text-red-600 focus:bg-gray-100 data-[highlighted]:bg-gray-100 data-[highlighted]:text-red-600 py-0.5 px-1.5 min-h-0 text-[14px] font-light rounded-none"
                      >
                        Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
      </div>

      {/* Right icons */}
      <div className="flex items-center gap-0.5 flex-shrink-0 ml-auto pl-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onNewChat(); }}
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors"
          title="New chat"
          aria-label="New chat"
        >
          <Plus className="w-4 h-4 text-[#6B7280]" strokeWidth={1.5} />
        </button>
        {onOpenAgents && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenAgents(); }}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors"
            title="Agents Sidebar"
            aria-label="Open agents"
          >
            <PanelRight className="w-4 h-4 text-[#6B7280]" strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
};

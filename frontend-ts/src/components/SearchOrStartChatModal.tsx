"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  MessageSquare,
  Files,
  Upload,
  CornerDownLeft,
  ChevronRight,
  ChevronLeft,
  Search,
} from "lucide-react";
import { useChatHistory } from "./ChatHistoryContext";
import { cn } from "@/lib/utils";
import { backendApi } from "@/services/backendApi";

export type SearchModalItem =
  | { type: "new-chat"; id: string; label: string }
  | { type: "new-chat-query"; id: string; label: string; query: string }
  | { type: "recent-chat"; id: string; chatId: string; label: string; meta?: string }
  | { type: "action"; id: string; action: "projects" | "files" | "upload"; label: string }
  | { type: "file"; id: string; fileId: string; label: string };

export interface SearchOrStartChatModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewChat: () => void;
  onNewChatWithQuery?: (query: string) => void;
  onChatSelect: (chatId: string) => void;
  onNavigate: (view: string) => void;
  onOpenFiles: () => void;
  onUploadFile?: () => void;
  onOpenFile?: (fileId: string, filename?: string) => void;
  onProjectSelect?: (projectId: string) => void;
}

const RECENTS_MAX = 5;
const FILES_MAX = 5;
const QUERY_MATCH_UPLOAD = /upload/i;
const QUERY_MATCH_PROJECT = /project|projects|p\b/i;
const QUERY_MATCH_FILE = /file|files/i;

function formatRecentMeta(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays > 30) return "Past month";
  if (diffDays >= 7) return `${Math.floor(diffDays / 7)}w`;
  if (diffDays >= 1) return `${diffDays}d`;
  const diffHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
  if (diffHours >= 1) return `${diffHours}h`;
  const diffMins = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
  if (diffMins >= 1) return `${diffMins}m`;
  return "Now";
}

export function SearchOrStartChatModal({
  open,
  onOpenChange,
  onNewChat,
  onNewChatWithQuery,
  onChatSelect,
  onNavigate,
  onOpenFiles,
  onUploadFile,
  onOpenFile,
  onProjectSelect,
}: SearchOrStartChatModalProps) {
  const { chatHistory } = useChatHistory();
  const [query, setQuery] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [chatsAndProjectsOnly, setChatsAndProjectsOnly] = React.useState(false);
  const [showFilesView, setShowFilesView] = React.useState(false);
  const [showProjectsView, setShowProjectsView] = React.useState(false);
  const [projects, setProjects] = React.useState<{ id: string; label: string; imageUrl?: string }[]>([]);
  const [documents, setDocuments] = React.useState<{ id: string; original_filename?: string; filename?: string; name?: string }[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    backendApi.getAllDocuments().then((res) => {
      if (cancelled || !res?.success) return;
      const data = res.data;
      const list = Array.isArray(data)
        ? data
        : data?.data && Array.isArray(data.data)
          ? data.data
          : data?.documents && Array.isArray(data.documents)
            ? data.documents
            : data?.data?.documents && Array.isArray(data.data.documents)
              ? data.data.documents
              : [];
      setDocuments(list);
    });
    return () => { cancelled = true; };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    backendApi.getAllPropertyHubs().then((res) => {
      if (cancelled || !res?.success) return;
      const raw = res.data;
      const hubs = Array.isArray(raw)
        ? raw
        : raw && typeof raw === "object"
          ? (raw as any).data ?? (raw as any).property_hubs ?? (raw as any).properties ?? []
          : [];
      const list = (Array.isArray(hubs) ? hubs : []).map((hub: any) => {
        const property = hub.property || hub;
        const details = hub.property_details || {};
        const id = property?.id || hub.id;
        const label =
          property?.formatted_address || property?.normalized_address || property?.address || "Project";
        const imageUrl =
          details.primary_image_url || property?.primary_image_url;
        return { id, label, imageUrl };
      });
      setProjects(list);
    });
    return () => { cancelled = true; };
  }, [open]);

  const activeChats = React.useMemo(() => {
    return chatHistory
      .filter((c) => !c.archived && !c.id.startsWith("property-"))
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
  }, [chatHistory]);

  const filteredRecents = React.useMemo(() => {
    if (!query.trim()) return activeChats.slice(0, RECENTS_MAX);
    const q = query.trim().toLowerCase();
    return activeChats
      .filter(
        (c) =>
          (c.title || "").toLowerCase().includes(q) ||
          (c.preview || "").toLowerCase().includes(q)
      )
      .slice(0, RECENTS_MAX);
  }, [activeChats, query]);

  const filteredFiles = React.useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    return documents
      .filter((d) => {
        const name = d.original_filename || d.filename || d.name || "";
        return name.toLowerCase().includes(q);
      })
      .slice(0, FILES_MAX);
  }, [documents, query]);

  // When in files view: show all documents, or filter by search query (no limit)
  const filesViewList = React.useMemo(() => {
    if (!query.trim()) return documents;
    const q = query.trim().toLowerCase();
    return documents.filter((d) => {
      const name = d.original_filename || d.filename || d.name || "";
      return name.toLowerCase().includes(q);
    });
  }, [documents, query]);

  // When in projects view: show all projects, or filter by search query
  const projectsViewList = React.useMemo(() => {
    if (!query.trim()) return projects;
    const q = query.trim().toLowerCase();
    return projects.filter((p) => p.label.toLowerCase().includes(q));
  }, [projects, query]);

  const flatList = React.useMemo((): SearchModalItem[] => {
    const list: SearchModalItem[] = [];
    const q = query.trim().toLowerCase();
    const chatsOnly = chatsAndProjectsOnly;

    if (q === "") {
      list.push({ type: "new-chat", id: "new-chat", label: "New chat" });
      filteredRecents.forEach((c) => {
        list.push({
          type: "recent-chat",
          id: `recent-${c.id}`,
          chatId: c.id,
          label: c.title || "New chat",
          meta: formatRecentMeta(c.timestamp),
        });
      });
      if (!chatsOnly) {
        list.push({ type: "action", id: "action-projects", action: "projects", label: "Projects" });
        list.push({ type: "action", id: "action-files", action: "files", label: "Files" });
        if (onUploadFile) {
          list.push({ type: "action", id: "action-upload", action: "upload", label: "Upload file" });
        }
      } else {
        list.push({ type: "action", id: "action-projects", action: "projects", label: "Projects" });
      }
    } else {
      list.push({
        type: "new-chat-query",
        id: "new-chat-query",
        label: `New chat "${query.trim()}"`,
        query: query.trim(),
      });
      if (!chatsOnly) {
        if (QUERY_MATCH_UPLOAD.test(query) && onUploadFile) {
          list.push({ type: "action", id: "action-upload", action: "upload", label: "Upload file" });
        }
        if (QUERY_MATCH_FILE.test(query)) {
          list.push({ type: "action", id: "action-files", action: "files", label: "Files" });
        }
      }
      if (QUERY_MATCH_PROJECT.test(query) || chatsOnly) {
        list.push({ type: "action", id: "action-projects", action: "projects", label: "Projects" });
      }
      filteredRecents.forEach((c) => {
        list.push({
          type: "recent-chat",
          id: `recent-${c.id}`,
          chatId: c.id,
          label: c.title || "New chat",
          meta: formatRecentMeta(c.timestamp),
        });
      });
      if (!chatsOnly) {
        filteredFiles.forEach((d) => {
          const label = d.original_filename || d.filename || d.name || "Document";
          list.push({ type: "file", id: `file-${d.id}`, fileId: d.id, label });
        });
      }
    }
    return list;
  }, [query, filteredRecents, filteredFiles, onUploadFile, chatsAndProjectsOnly]);

  const clampedIndex = Math.min(Math.max(0, selectedIndex), Math.max(0, flatList.length - 1));

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setSelectedIndex(0);
      setChatsAndProjectsOnly(false);
      setShowFilesView(false);
      setShowProjectsView(false);
    }
  }, [open]);

  React.useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    const selected = el.querySelector("[data-selected]");
    selected?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [clampedIndex, flatList.length]);

  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, flatList.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      const isInputFocused = document.activeElement === inputRef.current;
      if (e.key === "Enter") {
        if (isInputFocused) {
          e.preventDefault();
          if (query.trim()) {
            onNewChatWithQuery?.(query.trim()) ?? onNewChat();
          } else {
            onNewChat();
          }
          onOpenChange(false);
        } else {
          e.preventDefault();
          const item = flatList[clampedIndex];
          if (item) {
            handleSelectItem(item);
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, query, flatList, clampedIndex, onOpenChange, onNewChat, onNewChatWithQuery, onChatSelect, onNavigate, onOpenFiles, onUploadFile, onOpenFile]);

  function handleSelectItem(item: SearchModalItem) {
    switch (item.type) {
      case "new-chat":
        onNewChat();
        break;
      case "new-chat-query":
        onNewChatWithQuery?.(item.query) ?? onNewChat();
        break;
      case "recent-chat":
        onChatSelect(item.chatId);
        break;
      case "action":
        if (item.action === "projects") {
          setShowProjectsView(true);
          setSelectedIndex(0);
          return;
        }
        if (item.action === "files") {
          setShowFilesView(true);
          setSelectedIndex(0);
          return; // keep modal open, show files inside
        }
        if (item.action === "upload") onUploadFile?.();
        break;
      case "file":
        onOpenFile?.(item.fileId, item.label);
        break;
    }
    onOpenChange(false);
  }

  const handleSubmitClick = () => {
    if (query.trim()) {
      onNewChatWithQuery?.(query.trim()) ?? onNewChat();
    } else {
      onNewChat();
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="p-0 gap-0 overflow-hidden border-0 bg-white shadow-xl max-h-[70vh] min-w-0 max-w-[840px] w-[min(840px,calc(100vw-32px))] rounded-xl flex flex-col !z-[100100]"
        style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}
        overlayClassName="bg-black/10 !z-[100100]"
        onPointerDownOutside={() => onOpenChange(false)}
        onEscapeKeyDown={() => onOpenChange(false)}
      >
        {/* Search bar — pr-12 leaves space for the dialog's close (X) button */}
        <div
          className="flex shrink-0 items-center gap-3 px-4 pr-12 py-6 rounded-t-xl"
          style={{ backgroundColor: "#F5F5F5" }}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center text-neutral-400" aria-hidden>
            <Search className="h-7 w-7" strokeWidth={2} />
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={showProjectsView ? "Search projects" : showFilesView ? "Search files" : chatsAndProjectsOnly ? "Search chats and projects" : "Search or start a chat"}
            className="flex-1 min-w-0 h-full bg-transparent text-sm pl-0 text-neutral-600 placeholder:text-neutral-400 placeholder:font-normal font-medium outline-none"
            aria-label="Search or start a chat"
          />
        </div>

        {/* Scrollable list — flex-1 min-h-0 so it fills remaining space and scrolls */}
        <div
          ref={listRef}
          className="flex-1 min-h-0 overflow-y-auto py-4 px-4 scroll-smooth [-webkit-overflow-scrolling:touch]"
        >
          {showProjectsView ? (
            <>
              <button
                type="button"
                onClick={() => setShowProjectsView(false)}
                className="flex items-center gap-2 px-4 py-2 mb-2 text-[13px] text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg w-fit text-left"
              >
                <ChevronLeft className="h-4 w-4 shrink-0" />
                Back
              </button>
              <p className="px-4 pt-1 pb-2 text-[11px] text-gray-500 font-medium">
                Projects
              </p>
              {projectsViewList.length === 0 ? (
                <div className="py-6 flex flex-col items-center justify-center text-center">
                  {query.trim() ? (
                    <>
                      <img src="/noresults.png" alt="" className="w-28 h-28 object-contain mb-3 opacity-90" />
                      <p className="text-sm text-gray-500">No projects match your search</p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-500">No projects yet</p>
                  )}
                </div>
              ) : (
                projectsViewList.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors hover:bg-gray-100"
                    onClick={() => {
                      onProjectSelect?.(p.id);
                      onOpenChange(false);
                    }}
                  >
                    {p.imageUrl ? (
                      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded overflow-hidden bg-gray-100">
                        <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                      </span>
                    ) : (
                      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                        <img
                          src="/projectsfolder.png"
                          alt=""
                          className="w-full h-full object-contain pointer-events-none"
                          style={{ display: 'block' }}
                          draggable={false}
                        />
                      </span>
                    )}
                    <span className="flex-1 min-w-0 text-[13px] font-normal text-gray-900 truncate">
                      {p.label}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                  </button>
                ))
              )}
            </>
          ) : showFilesView ? (
            <>
              <button
                type="button"
                onClick={() => setShowFilesView(false)}
                className="flex items-center gap-2 px-4 py-2 mb-2 text-[13px] text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg w-fit text-left"
              >
                <ChevronLeft className="h-4 w-4 shrink-0" />
                Back
              </button>
              <p className="px-4 pt-1 pb-2 text-[11px] text-gray-500 font-medium">
                Files
              </p>
              {filesViewList.length === 0 ? (
                <div className="py-6 text-center text-sm text-gray-500">
                  {query.trim() ? "No files match your search" : "No files yet"}
                </div>
              ) : (
                filesViewList.map((d) => {
                  const label = d.original_filename || d.filename || d.name || "Document";
                  return (
                    <button
                      key={d.id}
                      type="button"
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors hover:bg-gray-100"
                      onClick={() => {
                        const label = d.original_filename || d.filename || d.name || "Document";
                        onOpenFile?.(d.id, label);
                        onOpenChange(false);
                      }}
                    >
                      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center text-gray-600">
                        <img src="/PDF.png" alt="PDF" className="h-[22px] w-[22px] object-contain" />
                      </span>
                      <span className="flex-1 min-w-0 text-[13px] font-normal text-gray-900 truncate">
                        {label}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                    </button>
                  );
                })
              )}
            </>
          ) : flatList.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-500">
              No results
            </div>
          ) : (
            flatList.map((item, index) => {
              const isFirstRecent =
                item.type === "recent-chat" &&
                !flatList.slice(0, index).some((i) => i.type === "recent-chat");
              const isFirstAction =
                item.type === "action" &&
                !flatList.slice(0, index).some((i) => i.type === "action");
              const isFirstFile =
                item.type === "file" &&
                !flatList.slice(0, index).some((i) => i.type === "file");
              const isSelected = index === clampedIndex;
              const isNewChat =
                item.type === "new-chat" || item.type === "new-chat-query";
              return (
                <React.Fragment key={item.id}>
                  {isFirstRecent && (
                    <div className="px-4 pt-3 pb-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="flex items-center gap-0.5 text-[11px] text-gray-500 font-medium hover:text-gray-700 focus:outline-none"
                        aria-label={chatsAndProjectsOnly ? "Show all" : "Filter to chats and projects"}
                        onClick={() => setChatsAndProjectsOnly((v) => !v)}
                      >
                        {chatsAndProjectsOnly ? "Across all files" : "Recents"}
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      </button>
                    </div>
                  )}
                  {isFirstAction && (
                    <p className="px-4 pt-3 pb-2 text-[11px] text-gray-500 font-medium">
                      Actions &gt;
                    </p>
                  )}
                  {isFirstFile && (
                    <p className="px-4 pt-3 pb-2 text-[11px] text-gray-500 font-medium">
                      Files &gt;
                    </p>
                  )}
                <button
                  key={item.id}
                  type="button"
                  data-selected={isSelected ? true : undefined}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors",
                    isSelected || (isNewChat && index === 0)
                  ? "bg-[#F5F5F5]"
                  : "hover:bg-gray-100"
                  )}
                  style={
                    isNewChat && index === 0
                      ? { backgroundColor: "#F5F5F5" }
                      : isSelected
                      ? { backgroundColor: "#F5F5F5" }
                      : undefined
                  }
                  onClick={() => handleSelectItem(item)}
                >
                  {item.type === "new-chat" && (
                    <>
                      <img src="/newchat1.png" alt="" className="h-[22px] w-[22px] flex-shrink-0 object-contain" />
                      <span className="flex-1 min-w-0 text-[13px] font-normal text-gray-900 truncate">
                        {item.label}
                      </span>
                      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center text-gray-500">
                        <CornerDownLeft className="h-4 w-4" />
                      </span>
                    </>
                  )}
                  {item.type === "new-chat-query" && (
                    <>
                      <img src="/newchat1.png" alt="" className="h-[22px] w-[22px] flex-shrink-0 object-contain" />
                      <span className="flex-1 min-w-0 text-[13px] font-normal text-gray-900 truncate">
                        {item.label}
                      </span>
                      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center text-gray-500">
                        <CornerDownLeft className="h-4 w-4" />
                      </span>
                    </>
                  )}
                  {item.type === "recent-chat" && (
                    <>
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-gray-600">
                        <MessageSquare className="h-4 w-4" strokeWidth={1.5} />
                      </span>
                      <span className="flex-1 min-w-0 text-[13px] font-normal text-gray-900 truncate">
                        {item.label}
                      </span>
                      {item.meta && (
                        <span className="text-[11px] text-gray-500 shrink-0">
                          {item.meta}
                        </span>
                      )}
                    </>
                  )}
                  {item.type === "action" && (
                    <>
                      {item.action === "projects" && (
                        <span className="h-[22px] w-[22px] shrink-0 block">
                          <img
                            src="/projectsfolder.png"
                            alt=""
                            className="w-full h-full object-contain pointer-events-none"
                            style={{ display: 'block' }}
                            draggable={false}
                          />
                        </span>
                      )}
                      {item.action === "files" && (
                        <Files className="h-[22px] w-[22px] shrink-0 text-gray-600" strokeWidth={1.5} />
                      )}
                      {item.action === "upload" && (
                        <Upload className="h-[22px] w-[22px] shrink-0 text-gray-600" strokeWidth={1.5} />
                      )}
                      <span className="flex-1 min-w-0 text-[13px] font-normal text-gray-900">
                        {item.label}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                    </>
                  )}
                  {item.type === "file" && (
                    <>
                      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center text-gray-600">
                        <img src="/PDF.png" alt="PDF" className="h-[22px] w-[22px] object-contain" />
                      </span>
                      <span className="flex-1 min-w-0 text-[13px] font-normal text-gray-900 truncate">
                        {item.label}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                    </>
                  )}
                </button>
                </React.Fragment>
              );
            })
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
}

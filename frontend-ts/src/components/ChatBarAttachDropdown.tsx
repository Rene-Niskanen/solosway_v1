"use client";

import * as React from "react";
import { Plus, CloudUpload, FolderOpen, FileSearch } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatBarToolsDropdownItem } from "./ChatBarToolsDropdown";

export interface ChatBarAttachDropdownProps {
  onAttachClick: () => void;
  /** Optional: when provided, adds "Choose files" to open document selection mode (for selecting docs from project) */
  onChooseDocumentsClick?: () => void;
  /** Optional tools items (e.g. Search the web, Map) to show below Attach in the same menu */
  toolsItems?: ChatBarToolsDropdownItem[];
  /** @deprecated Trigger is always icon-only now */
  compact?: boolean;
  className?: string;
}

export function ChatBarAttachDropdown({
  onAttachClick,
  onChooseDocumentsClick,
  toolsItems = [],
  className,
}: ChatBarAttachDropdownProps) {
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`flex items-center justify-center transition-colors focus:outline-none outline-none rounded-full border border-gray-300/40 hover:bg-white/5 hover:border-gray-300/60 ${className || ""}`}
          style={{
            width: "32px",
            height: "32px",
            minWidth: "32px",
            minHeight: "32px",
            marginLeft: 0,
            marginRight: "4px",
            position: "relative",
            zIndex: 10,
          }}
          aria-label="Files and sources"
        >
          <Plus className="w-4 h-4 flex-shrink-0 text-gray-600" strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={5}
        className="p-0.5 z-[10002] min-w-[10rem]"
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid rgba(229, 231, 235, 0.8)",
          borderRadius: "10px",
          boxShadow: "0 3px 10px rgba(0, 0, 0, 0.1)",
          minWidth: "168px",
          zIndex: 10002,
        }}
      >
        <DropdownMenuItem
          onClick={() => onAttachClick()}
          onMouseEnter={() => setHoveredId("attach")}
          onMouseLeave={() => setHoveredId(null)}
          className="flex items-center gap-2 cursor-pointer rounded-[6px] px-2 py-1"
          style={{
            backgroundColor: hoveredId === "attach" ? "rgba(0, 0, 0, 0.05)" : "transparent",
            color: "#4b5563",
            fontSize: "13px",
            fontWeight: 400,
          }}
        >
          <CloudUpload className="w-[18px] h-[18px] flex-shrink-0 text-gray-600" strokeWidth={1.5} />
          <span className="flex-1">Upload files</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            // Defer so dropdown closes first - prevents Radix from blocking the modal
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('openSearchModal', { detail: { initialView: 'projects' } }));
            }, 0);
          }}
          onMouseEnter={() => setHoveredId("choose-project")}
          onMouseLeave={() => setHoveredId(null)}
          className="flex items-center gap-2 cursor-pointer rounded-[6px] px-2 py-1"
          style={{
            backgroundColor: hoveredId === "choose-project" ? "rgba(0, 0, 0, 0.05)" : "transparent",
            color: "#4b5563",
            fontSize: "13px",
            fontWeight: 400,
          }}
        >
          <FolderOpen className="w-[18px] h-[18px] flex-shrink-0 text-gray-600" strokeWidth={1.5} />
          <span className="flex-1">Choose project</span>
        </DropdownMenuItem>
        {onChooseDocumentsClick != null && (
          <DropdownMenuItem
            onSelect={() => {
              // Defer so dropdown closes first - prevents Radix from blocking the pop-up
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent('openSearchModal', { detail: { initialView: 'files' } }));
              }, 0);
            }}
            onMouseEnter={() => setHoveredId("choose-documents")}
            onMouseLeave={() => setHoveredId(null)}
            className="flex items-center gap-2 cursor-pointer rounded-[6px] px-2 py-1"
            style={{
              backgroundColor: hoveredId === "choose-documents" ? "rgba(0, 0, 0, 0.05)" : "transparent",
              color: "#4b5563",
              fontSize: "13px",
              fontWeight: 400,
            }}
          >
            <FileSearch className="w-[18px] h-[18px] flex-shrink-0 text-gray-600" strokeWidth={1.5} />
            <span className="flex-1">Choose files</span>
          </DropdownMenuItem>
        )}
        {toolsItems.length > 0 && (
          <>
            {toolsItems.map((item) => {
              const Icon = item.icon;
              const isHovered = hoveredId === item.id;
              return (
                <DropdownMenuItem
                  key={item.id}
                  onClick={(e) => item.onClick(e as unknown as React.MouseEvent)}
                  onMouseEnter={() => setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className="flex items-center gap-2 cursor-pointer rounded-[6px] px-2 py-1"
                  style={{
                    backgroundColor: isHovered ? "rgba(0, 0, 0, 0.05)" : "transparent",
                    color: "#4b5563",
                    fontSize: "13px",
                    fontWeight: 400,
                  }}
                >
                  <Icon className="w-[18px] h-[18px] flex-shrink-0 text-gray-600" strokeWidth={1.5} />
                  <span className="flex-1">{item.label}</span>
                  {item.badge != null && (
                    <span className="text-gray-500" style={{ fontSize: "10px" }}>{item.badge}</span>
                  )}
                </DropdownMenuItem>
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

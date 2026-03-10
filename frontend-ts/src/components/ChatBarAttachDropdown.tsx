"use client";

import * as React from "react";
import { Plus, CloudUpload } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatBarToolsDropdownItem } from "./ChatBarToolsDropdown";

export interface ChatBarAttachDropdownProps {
  onAttachClick: () => void;
  /** Optional tools items (e.g. Search the web, Map) to show below Attach in the same menu */
  toolsItems?: ChatBarToolsDropdownItem[];
  /** When true, show only the + icon (no "Files and sources" label) for narrow chat bars */
  compact?: boolean;
  className?: string;
}

export function ChatBarAttachDropdown({
  onAttachClick,
  toolsItems = [],
  compact = false,
  className,
}: ChatBarAttachDropdownProps) {
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`flex items-center justify-center gap-1.5 text-gray-700 transition-colors focus:outline-none outline-none rounded-md bg-black/[0.01] hover:bg-black/[0.05] ${className || ""}`}
          style={{
            border: "none",
            height: "26px",
            minHeight: "26px",
            paddingLeft: compact ? "4px" : "6px",
            paddingRight: compact ? "4px" : "6px",
            marginLeft: 0,
            marginRight: "4px",
            borderRadius: "6px",
            fontWeight: 400,
            fontSize: "14px",
          }}
        >
          <Plus className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />
          {!compact && <span className="whitespace-nowrap">Files and sources</span>}
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

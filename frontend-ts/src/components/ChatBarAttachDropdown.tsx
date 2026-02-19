"use client";

import * as React from "react";
import { Plus, Paperclip } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatBarToolsDropdownItem } from "./ChatBarToolsDropdown";

export interface ChatBarAttachDropdownProps {
  onAttachClick: () => void;
  /** Optional tools items (e.g. Search the web, Map) to show below Attach in the same menu */
  toolsItems?: ChatBarToolsDropdownItem[];
  className?: string;
}

export function ChatBarAttachDropdown({
  onAttachClick,
  toolsItems = [],
  className,
}: ChatBarAttachDropdownProps) {
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`flex items-center justify-center text-gray-900 transition-colors focus:outline-none outline-none rounded-full ${className || ""}`}
          style={{
            backgroundColor: "transparent",
            border: "none",
            height: "32px",
            minHeight: "32px",
            width: "32px",
            minWidth: "32px",
            padding: 0,
            marginRight: "12px",
            marginLeft: 0,
            borderRadius: "50%",
          }}
          title="Attach"
        >
          <Plus className="w-[22px] h-[22px]" strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={5}
        className="p-0.5 z-[10002]"
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid rgba(229, 231, 235, 0.8)",
          borderRadius: "8px",
          boxShadow: "0 3px 10px rgba(0, 0, 0, 0.1)",
          minWidth: "132px",
          zIndex: 10002,
        }}
      >
        <DropdownMenuItem
          onClick={() => onAttachClick()}
          onMouseEnter={() => setHoveredId("attach")}
          onMouseLeave={() => setHoveredId(null)}
          className="flex items-center gap-1 cursor-pointer rounded-[4px] px-1.5 py-1"
          style={{
            backgroundColor: hoveredId === "attach" ? "rgba(0, 0, 0, 0.05)" : "transparent",
            color: "#1f2937",
            fontSize: "10px",
            fontWeight: 400,
          }}
        >
          <Paperclip className="w-4 h-4 flex-shrink-0 text-gray-900" strokeWidth={1.5} />
          <span className="flex-1">Attach</span>
        </DropdownMenuItem>
        {toolsItems.length > 0 && (
          <>
            <DropdownMenuSeparator className="mx-1" />
            {toolsItems.map((item) => {
              const Icon = item.icon;
              const isHovered = hoveredId === item.id;
              return (
                <DropdownMenuItem
                  key={item.id}
                  onClick={() => item.onClick()}
                  onMouseEnter={() => setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className="flex items-center gap-1 cursor-pointer rounded-[4px] px-1.5 py-1"
                  style={{
                    backgroundColor: isHovered ? "rgba(0, 0, 0, 0.05)" : "transparent",
                    color: "#1f2937",
                    fontSize: "10px",
                    fontWeight: 400,
                  }}
                >
                  <Icon className="w-4 h-4 flex-shrink-0 text-gray-900" strokeWidth={1.5} />
                  <span className="flex-1">{item.label}</span>
                  {item.badge != null && (
                    <span className="text-gray-500" style={{ fontSize: "8px" }}>{item.badge}</span>
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

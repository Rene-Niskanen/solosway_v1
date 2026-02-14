"use client";

import * as React from "react";
import { Bolt, type LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ChatBarToolsDropdownItem {
  id: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  badge?: string;
}

export interface ChatBarToolsDropdownProps {
  items: ChatBarToolsDropdownItem[];
  compact?: boolean;
  className?: string;
}

export function ChatBarToolsDropdown({
  items,
  compact = false,
  className,
}: ChatBarToolsDropdownProps) {
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`flex items-center gap-1.5 text-gray-900 transition-colors focus:outline-none outline-none ${className || ""}`}
          style={{
            backgroundColor: "#FFFFFF",
            border: "1px solid rgba(229, 231, 235, 0.6)",
            borderRadius: "12px",
            transition: "background-color 0.2s ease, border-color 0.2s ease",
            height: "24px",
            minHeight: "24px",
            paddingLeft: compact ? "6px" : "8px",
            paddingRight: compact ? "6px" : "8px",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "#F5F5F5";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "#FFFFFF";
          }}
          title="Tools"
        >
          <Bolt className="w-3.5 h-3.5" strokeWidth={2} />
          {!compact && <span className="text-xs font-medium">Tools</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={6}
        className="p-1"
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid rgba(229, 231, 235, 0.8)",
          borderRadius: "12px",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
          minWidth: "180px",
        }}
      >
        {items.map((item) => {
          const Icon = item.icon;
          const isHovered = hoveredId === item.id;
          return (
            <DropdownMenuItem
              key={item.id}
              onClick={() => item.onClick()}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
              className="flex items-center gap-2 cursor-pointer rounded-md px-2 py-2"
              style={{
                backgroundColor: isHovered ? "rgba(0, 0, 0, 0.05)" : "transparent",
                color: "#1f2937",
                fontSize: "13px",
                fontWeight: 400,
              }}
            >
              <Icon className="w-4 h-4 flex-shrink-0" strokeWidth={2} style={{ color: "#6b7280" }} />
              <span className="flex-1">{item.label}</span>
              {item.badge != null && (
                <span
                  className="text-xs text-gray-500"
                  style={{ fontSize: "11px" }}
                >
                  {item.badge}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

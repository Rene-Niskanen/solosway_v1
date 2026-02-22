"use client";

import * as React from "react";
import { X } from "lucide-react";

export interface PropertyPillChipProps {
  label: string;
  onRemove?: () => void;
  title?: string;
  /** Document count shown under the label (same style as FileAttachment type label) */
  documentCount?: number;
}

const MAX_LABEL_LEN = 30;

function formatLabel(label: string): string {
  if (label.length <= MAX_LABEL_LEN) return label;
  return `${label.substring(0, 27)}...`;
}

export function PropertyPillChip({ label, onRemove, title, documentCount }: PropertyPillChipProps) {
  return (
    <span
      className="relative bg-white rounded-lg border border-gray-200 px-2.5 py-2 cursor-default hover:border-gray-300 transition-all duration-100"
      style={{
        width: "auto",
        height: "auto",
        maxWidth: "none",
        minWidth: "auto",
        display: "inline-flex",
        flexShrink: 0,
        flexGrow: 0,
        alignItems: "center",
        verticalAlign: "middle",
      }}
      title={title ?? label}
    >
      <div className="flex items-center gap-2" style={{ width: "auto", flexShrink: 0 }}>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center">
          <img
            src="/projectsfolder.png"
            alt=""
            className="w-full h-full object-contain pointer-events-none"
            style={{ display: "block" }}
            draggable={false}
          />
        </span>
        <div className="flex flex-col" style={{ width: "auto", flexShrink: 0 }}>
          <span className="text-xs font-medium text-black truncate" style={{ whiteSpace: "nowrap", maxWidth: "200px" }}>
            {formatLabel(label)}
          </span>
          {documentCount != null && (
            <span className="text-[10px] text-gray-500 font-normal">
              {documentCount === 1 ? "1 doc" : `${documentCount} docs`}
            </span>
          )}
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }}
            className="w-6 h-6 flex items-center justify-center flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors ml-2"
            title="Remove"
          >
            <X className="w-4 h-4" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </span>
  );
}

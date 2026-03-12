"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog";
import { ChevronRight, X } from "lucide-react";
import { backendApi } from "@/services/backendApi";

export interface ChooseProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectProject: (project: { id: string; label: string; imageUrl?: string; documentCount?: number }) => void;
  /**
   * When set, horizontal position matches the search bar.
   * - useViewportCenter: true on dashboard (search bar in flow) → modal at viewport center (50%).
   * - useViewportCenter: false when search bar is fixed (map or small viewport) → modal at content-area center (50vw + sidebar/2 when sidebar open).
   */
  alignWithSearchBar?: { sidebarWidth: number; isSidebarCollapsed: boolean; useViewportCenter?: boolean };
  /** When set (e.g. from SearchBar "Choose project" button), modal is centered over this rect and positioned above it. */
  anchorRect?: { left: number; top: number; width: number; height: number } | null;
  /** When set (e.g. on dashboard), portal the modal into this element so it appears in the dashboard area. */
  portalContainer?: HTMLElement | null;
}

export function ChooseProjectModal({
  open,
  onOpenChange,
  onSelectProject,
  alignWithSearchBar,
  anchorRect,
  portalContainer,
}: ChooseProjectModalProps) {
  const [query, setQuery] = React.useState("");
  const [projects, setProjects] = React.useState<{ id: string; label: string; imageUrl?: string; documentCount?: number }[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // When modal opens: show cached list immediately (from dashboard preload), then fetch to refresh
  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    const cached = backendApi.getCachedPropertyHubsList();
    if (cached !== null) {
      setProjects(cached);
      setIsLoading(false);
    } else {
      setProjects([]);
      setIsLoading(true);
    }
    let cancelled = false;
    backendApi.getAllPropertyHubs().then((res) => {
      if (cancelled) return;
      setIsLoading(false);
      if (!res?.success) return;
      const raw = res.data;
      const hubs = Array.isArray(raw)
        ? raw
        : raw && typeof raw === "object"
          ? (raw as any).data ?? (raw as any).property_hubs ?? (raw as any).properties ?? []
          : [];
      const list = (Array.isArray(hubs) ? hubs : []).map((hub: any) => {
        const property = hub.property || hub;
        const details = hub.property_details || {};
        const id = property?.id ?? hub.id;
        const label =
          property?.formatted_address || property?.normalized_address || property?.address || "Project";
        const imageUrl = details.primary_image_url || property?.primary_image_url;
        const documentCount =
          hub.summary?.document_count ??
          hub.document_count ??
          hub.documentCount ??
          (Array.isArray(hub.documents) ? hub.documents.length : undefined);
        return { id: String(id), label, imageUrl, documentCount };
      });
      setProjects(list);
    });
    return () => { cancelled = true; };
  }, [open]);

  React.useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  const projectsViewList = React.useMemo(() => {
    if (!query.trim()) return projects;
    const q = query.trim().toLowerCase();
    return projects.filter((p) => p.label.toLowerCase().includes(q));
  }, [projects, query]);

  const handleSelect = (p: { id: string; label: string; imageUrl?: string }) => {
    onSelectProject(p);
    onOpenChange(false);
  };

  // When anchorRect is set (search bar view): center modal both horizontally and vertically over the search bar so it doesn't appear too high.
  // When no anchorRect (chat bar / bottom of screen): keep default bottom positioning.
  const anchorStyle =
    anchorRect && typeof window !== "undefined"
      ? {
          left: anchorRect.left + anchorRect.width / 2,
          top: anchorRect.top + anchorRect.height / 2,
          transform: "translate(-50%, -50%)",
        }
      : undefined;

  // Dashboard: viewport center (50%). Map/small viewport (fixed bar): content-area center when sidebar open.
  const useOffset =
    !anchorStyle &&
    alignWithSearchBar &&
    !alignWithSearchBar.useViewportCenter &&
    !alignWithSearchBar.isSidebarCollapsed &&
    alignWithSearchBar.sidebarWidth > 0;
  const leftStyle = useOffset
    ? { left: `calc(50vw + ${alignWithSearchBar!.sidebarWidth / 2}px)` }
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={portalContainer ?? undefined}
        hideClose
        className={`p-0 gap-0 overflow-hidden border-0 bg-white shadow-xl max-h-[50vh] min-w-0 max-w-[840px] w-[min(840px,calc(100vw-32px))] rounded-xl flex flex-col !z-[100100] !top-auto !translate-y-0 ${anchorStyle ? "" : "translate-x-[-50%]"} ${anchorStyle ? "" : "bottom-[100px]"} ${anchorStyle ? "" : leftStyle ? "" : "left-[50%]"}`}
        style={{
          boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
          ...(anchorStyle ?? leftStyle),
        }}
        overlayClassName="bg-transparent !z-[100100]"
        onPointerDownOutside={() => onOpenChange(false)}
        onEscapeKeyDown={() => onOpenChange(false)}
      >
        <div
          className="flex shrink-0 items-center gap-3 pl-10 pr-4 py-4 rounded-t-xl"
          style={{ backgroundColor: "#F5F5F5" }}
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects"
            className="flex-1 min-w-0 h-full bg-transparent text-sm pl-0 text-neutral-600 placeholder:text-neutral-400 placeholder:font-normal font-medium outline-none"
            aria-label="Search projects"
          />
          <DialogClose asChild>
            <button
              type="button"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-500 opacity-70 hover:opacity-100 transition-opacity"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        </div>
        <div className="h-[calc(50vh-5rem)] overflow-y-auto py-4 px-4 scroll-smooth [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-black/10 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-black/15" style={{ scrollbarColor: 'rgba(0,0,0,0.1) transparent' }}>
          <p className="px-4 pt-1 pb-2 text-[11px] text-gray-500 font-medium">Projects</p>
          {projectsViewList.length === 0 ? (
            <div className="py-6 flex flex-col items-center justify-center text-center">
              {query.trim() ? (
                <>
                  <img src="/noresults.png" alt="" className="w-28 h-28 object-contain mb-3 opacity-90" />
                  <p className="text-sm text-gray-500">No projects match your search</p>
                </>
              ) : isLoading ? (
                <p className="text-sm text-gray-500">Loading projects…</p>
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
                onClick={() => handleSelect(p)}
              >
                {p.imageUrl ? (
                  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded overflow-hidden bg-gray-100">
                    <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                  </span>
                ) : (
                  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                    <img
                      src="/projectsfolder.png"
                      alt=""
                      className="w-full h-full object-contain pointer-events-none"
                      style={{ display: "block" }}
                      draggable={false}
                    />
                  </span>
                )}
                <span className="flex-1 min-w-0 text-[13px] font-normal text-gray-900 truncate">{p.label}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

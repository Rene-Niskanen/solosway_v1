"use client";

import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChevronRight } from "lucide-react";
import { backendApi } from "@/services/backendApi";

export interface ChooseProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectProject: (project: { id: string; label: string; imageUrl?: string; documentCount?: number }) => void;
}

export function ChooseProjectModal({
  open,
  onOpenChange,
  onSelectProject,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="p-0 gap-0 overflow-hidden border-0 bg-white shadow-xl max-h-[70vh] min-w-0 max-w-[840px] w-[min(840px,calc(100vw-32px))] rounded-xl flex flex-col !z-[100100]"
        style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}
        overlayClassName="bg-black/10 !z-[100100]"
        onPointerDownOutside={() => onOpenChange(false)}
        onEscapeKeyDown={() => onOpenChange(false)}
      >
        <div
          className="flex shrink-0 items-center gap-3 pl-10 pr-12 py-6 rounded-t-xl"
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
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto py-4 px-4 scroll-smooth [-webkit-overflow-scrolling:touch]">
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
                  <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded overflow-hidden bg-gray-100">
                    <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                  </span>
                ) : (
                  <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
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

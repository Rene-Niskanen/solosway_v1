"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { useFilingSidebar } from "../contexts/FilingSidebarContext";

const ACCEPTED_EXTENSIONS = [".pdf", ".doc", ".docx", ".xlsx", ".xls", ".csv"];
const isAcceptedFile = (file: File) => {
  const name = (file.name || "").toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
};

export function UploadOverlay() {
  const {
    uploadOverlayOpen,
    setUploadOverlayOpen,
    setInitialPendingFiles,
    openSidebar,
  } = useFilingSidebar();
  const [isDragOver, setIsDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (relatedTarget == null || !e.currentTarget.contains(relatedTarget)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(isAcceptedFile);
    if (files.length === 0) return;
    setInitialPendingFiles(files);
    setUploadOverlayOpen(false);
    openSidebar();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(isAcceptedFile);
    if (files.length === 0) return;
    setInitialPendingFiles(files);
    setUploadOverlayOpen(false);
    openSidebar();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAreaClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <Dialog open={uploadOverlayOpen} onOpenChange={setUploadOverlayOpen}>
      <DialogContent
        className="p-0 gap-0 overflow-hidden border-0 bg-white shadow-xl max-w-[min(560px,calc(100vw-32px))] w-full rounded-xl flex flex-col !z-[100110]"
        style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}
        overlayClassName="bg-black/20 !z-[100110]"
        onPointerDownOutside={() => setUploadOverlayOpen(false)}
        onEscapeKeyDown={() => setUploadOverlayOpen(false)}
      >
        <div className="flex shrink-0 items-center pl-6 pt-5 pr-4 pb-3">
          <h2 className="text-sm font-medium text-[#635A4F]">Upload file</h2>
        </div>

        <div className="p-6">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleAreaClick}
            className={`relative cursor-pointer select-none transition-all duration-150 ease-out w-full overflow-hidden rounded-lg
              hover:bg-gray-50/40 active:scale-[0.99] active:opacity-95 active:bg-gray-100/50
              ${isDragOver ? "opacity-90 scale-[1.01]" : ""}`}
            style={{
              border: "2px dotted #D1D5DB",
              borderRadius: "8px",
            }}
          >
            <img
              src="/fileuploaduse.png"
              alt="Secure file uploads"
              className="block w-full h-auto pointer-events-none rounded-lg"
              style={{
                width: "100%",
                height: "auto",
                display: "block",
                transform: "scale(1.12) translateY(-8px)",
                transformOrigin: "center top",
              }}
            />

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".xlsx,.xls,.csv,.pdf,.doc,.docx"
              onChange={handleFileInputChange}
              className="hidden"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

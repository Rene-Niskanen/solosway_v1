"use client";

/**
 * CreateProjectModal - Pop-up to create a new project from the Projects section
 * Lets user name the project and drop files; creates property (with default UK coords) and links documents.
 */

import * as React from "react";
import { useState, useCallback, useRef } from "react";
import { X, File, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { backendApi } from "@/services/backendApi";

// Default UK coordinates (London) - backend requires lat/lng for property creation
const DEFAULT_COORDS = { lat: 51.5074, lng: -0.1278 };

/** Renders image file as thumbnail; revokes object URL on unmount */
const ImageThumbnail: React.FC<{ file: File; className?: string }> = ({ file, className }) => {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    const objUrl = URL.createObjectURL(file);
    setUrl(objUrl);
    return () => URL.revokeObjectURL(objUrl);
  }, [file]);
  if (!url) return <File className="w-6 h-6 text-gray-500 flex-shrink-0" />; // fallback while loading
  return <img src={url} alt="" className={className} />;
};

interface PendingFile {
  id: string;
  file: File;
}

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the new property ID when project is created. Use to refresh list and optionally open the project. */
  onProjectCreated?: (propertyId: string) => void;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  onClose,
  onProjectCreated,
}) => {
  const [projectName, setProjectName] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  /** During Create: upload progress 0–100 by file id */
  const [creatingProgress, setCreatingProgress] = useState<Record<string, number>>({});
  /** During Create: document IDs after upload */
  const [creatingDocumentIds, setCreatingDocumentIds] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = useCallback(() => {
    setProjectName("");
    setPendingFiles([]);
    setIsCreating(false);
    setError(null);
    setIsDragOver(false);
    setCreatingProgress({});
    setCreatingDocumentIds({});
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  /** Add file to pending list only — no upload until Create is clicked */
  const handleFileAdd = useCallback((file: File) => {
    const fileId = `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setPendingFiles((prev) => [...prev, { id: fileId, file }]);
  }, []);

  const handleFileRemove = useCallback((fileId: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const droppedFiles = Array.from(e.dataTransfer.files);
      droppedFiles.forEach((file) => handleFileAdd(file));
    },
    [handleFileAdd]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(e.target.files || []);
      selectedFiles.forEach((file) => handleFileAdd(file));
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleFileAdd]
  );

  const handleCreate = useCallback(async () => {
    const trimmedName = projectName.trim();
    if (!trimmedName) {
      setError("Please enter a project name");
      return;
    }

    setIsCreating(true);
    setError(null);
    setCreatingProgress({});
    setCreatingDocumentIds({});

    try {
      // 1. Create property (backend requires lat/lng - use default UK coords)
      const createResponse = await backendApi.createProperty(
        trimmedName,
        DEFAULT_COORDS,
        trimmedName
      );

      if (!createResponse.success || !createResponse.data) {
        throw new Error(createResponse.error || "Failed to create project");
      }

      const newPropertyId = (createResponse.data as any).property_id;

      // 2. Upload pending files (only when Create is pressed)
      const docIds: string[] = [];
      for (const pf of pendingFiles) {
        setCreatingProgress((prev) => ({ ...prev, [pf.id]: 0 }));
        const response = await backendApi.uploadPropertyDocumentViaProxy(
          pf.file,
          {
            skip_processing: "true",
            project_upload: "true",
            silent: true,
          },
          (percent) => {
            setCreatingProgress((prev) => ({ ...prev, [pf.id]: percent }));
          }
        );
        if (response.success) {
          const documentId = (response.data as any)?.document_id || (response as any).document_id;
          if (documentId) {
            docIds.push(documentId);
            setCreatingDocumentIds((prev) => ({ ...prev, [pf.id]: documentId }));
          }
        }
        setCreatingProgress((prev) => ({ ...prev, [pf.id]: 100 }));
      }

      // 3. Link uploaded documents to the property
      if (docIds.length > 0) {
        await Promise.all(
          docIds.map((documentId) =>
            backendApi.linkDocumentToProperty(documentId, newPropertyId)
          )
        );
      }

      handleClose();
      onProjectCreated?.(newPropertyId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setIsCreating(false);
      setCreatingProgress({});
      setCreatingDocumentIds({});
    }
  }, [projectName, pendingFiles, onProjectCreated, handleClose]);

  const iconClass = "w-6 h-6 object-contain flex-shrink-0";

  const getFileIcon = (file: File) => {
    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();

    // Images: show thumbnail
    if (type.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(name)) {
      return (
        <ImageThumbnail file={file} className="w-8 h-8 object-cover rounded flex-shrink-0" />
      );
    }
    // PDF
    if (type.includes("pdf") || name.endsWith(".pdf")) {
      return <img src="/PDF(1).png" alt="PDF" className={iconClass} />;
    }
    // PowerPoint — check before Word (both contain "document" in MIME)
    if (
      type.includes("presentation") ||
      type.includes("powerpoint") ||
      name.endsWith(".pptx") ||
      name.endsWith(".ppt")
    ) {
      return <img src="/powerpoint.png" alt="PowerPoint" className={iconClass} />;
    }
    // Excel / spreadsheet (xlsx, xls, csv)
    if (
      type.includes("sheet") ||
      type.includes("excel") ||
      type.includes("csv") ||
      /\.(xlsx|xls|csv)$/i.test(name)
    ) {
      return <img src="/excel.png" alt="Excel" className={iconClass} />;
    }
    // Word (doc, docx)
    if (
      type.includes("word") ||
      type.includes("wordprocessing") ||
      name.endsWith(".doc") ||
      name.endsWith(".docx")
    ) {
      return <img src="/word.png" alt="Word" className={iconClass} />;
    }
    return <File className="w-6 h-6 text-gray-500 flex-shrink-0" />;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden" hideClose={false} overlayClassName="bg-transparent">
        <div className="flex flex-col">
          <div className="px-6 py-5 border-b border-gray-200 bg-white">
            <DialogHeader>
              <DialogTitle className="text-lg font-medium text-gray-900">
                Create Project
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-gray-500 mt-1">
              Name your project and add documents to get started
            </p>
          </div>

          <div className="p-6 space-y-5">
            {/* Project name input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Project name
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g. Riverside Development"
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-0 focus:border-gray-200"
                disabled={isCreating}
              />
            </div>

            {/* File drop zone */}
            <div>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragOver(false);
                }}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative cursor-pointer select-none transition-all duration-150 ease-out w-full overflow-hidden rounded-lg max-w-[360px] mx-auto
                  hover:bg-gray-50/40 active:scale-[0.99] active:opacity-95 active:bg-gray-100/50
                  ${isDragOver ? "opacity-90" : ""}`}
                style={{ borderRadius: "8px" }}
              >
                <div className="relative flex items-center justify-center w-full py-2 pointer-events-none rounded-lg overflow-hidden">
                  <img
                    src="/fileupload3.png"
                    alt="Add documents"
                    className="block w-full h-auto"
                    style={{ width: '100%', maxHeight: 320, objectFit: 'contain' }}
                  />
                  {/* Overlay to hide "file" and "+" text on the upload graphic (top portion only) */}
                  <div
                    className="absolute top-0 left-0 right-0 pointer-events-none rounded-t-lg"
                    style={{ height: '25%', backgroundColor: '#FFFFFF' }}
                    aria-hidden
                  />
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
            </div>

            {/* File list — pending until Create is pressed */}
            {pendingFiles.length > 0 && (
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {pendingFiles.map((pf) => (
                  <div
                    key={pf.id}
                    className="flex items-center gap-2 py-2 px-3 rounded-lg bg-gray-50 border border-gray-100"
                  >
                    {getFileIcon(pf.file)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {pf.file.name}
                      </p>
                      {isCreating && (
                        <div className="w-full h-1.5 bg-gray-200 rounded-full mt-1 overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all"
                            style={{ width: `${creatingProgress[pf.id] ?? 0}%` }}
                          />
                        </div>
                      )}
                    </div>
                    {!isCreating && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFileRemove(pf.id);
                        }}
                        className="p-1 rounded text-gray-500"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
                disabled={isCreating}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={isCreating || !projectName.trim()}
                className="flex-1 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  "Create"
                )}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateProjectModal;

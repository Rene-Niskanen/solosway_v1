"use client";

/**
 * CreateProjectModal - Pop-up to create a new project from the Projects section
 * Lets user name the project and drop files; creates property (with default UK coords) and links documents.
 */

import * as React from "react";
import { useState, useCallback, useRef } from "react";
import { Upload, X, FileText, Image as ImageIcon, File, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { backendApi } from "@/services/backendApi";

// Default UK coordinates (London) - backend requires lat/lng for property creation
const DEFAULT_COORDS = { lat: 51.5074, lng: -0.1278 };

interface UploadedFile {
  id: string;
  file: File;
  documentId?: string;
  uploadProgress: number;
  uploadStatus: "uploading" | "complete" | "error";
}

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated?: (propertyId: string) => void;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  onClose,
  onProjectCreated,
}) => {
  const [projectName, setProjectName] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = useCallback(() => {
    setProjectName("");
    setUploadedFiles([]);
    setIsCreating(false);
    setError(null);
    setIsDragOver(false);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const handleFileAdd = useCallback(async (file: File) => {
    const fileId = `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newFile: UploadedFile = {
      id: fileId,
      file,
      uploadProgress: 0,
      uploadStatus: "uploading",
    };
    setUploadedFiles((prev) => [...prev, newFile]);

    try {
      const response = await backendApi.uploadPropertyDocumentViaProxy(
        file,
        {
          skip_processing: "true",
          project_upload: "true",
          silent: true,
        },
        (percent) => {
          setUploadedFiles((prev) =>
            prev.map((f) => (f.id === fileId ? { ...f, uploadProgress: percent } : f))
          );
        }
      );

      if (response.success) {
        const documentId = (response.data as any)?.document_id || (response as any).document_id;
        setUploadedFiles((prev) =>
          prev.map((f) =>
            f.id === fileId
              ? { ...f, documentId, uploadStatus: "complete", uploadProgress: 100 }
              : f
          )
        );
      } else {
        throw new Error(response.error || "Upload failed");
      }
    } catch (err) {
      setUploadedFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, uploadStatus: "error" } : f))
      );
    }
  }, []);

  const handleFileRemove = useCallback((fileId: string) => {
    const file = uploadedFiles.find((f) => f.id === fileId);
    if (file?.documentId) {
      backendApi.deleteDocument(file.documentId).catch(console.error);
    }
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, [uploadedFiles]);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const droppedFiles = Array.from(e.dataTransfer.files);
      await Promise.allSettled(droppedFiles.map((file) => handleFileAdd(file)));
    },
    [handleFileAdd]
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(e.target.files || []);
      await Promise.allSettled(selectedFiles.map((file) => handleFileAdd(file)));
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

      // 2. Link uploaded documents to the property
      const filesWithDocs = uploadedFiles.filter((f) => f.documentId);
      if (filesWithDocs.length > 0) {
        await Promise.all(
          filesWithDocs.map((f) =>
            backendApi.linkDocumentToProperty(f.documentId!, newPropertyId)
          )
        );
      }

      handleClose();
      onProjectCreated?.(newPropertyId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setIsCreating(false);
    }
  }, [projectName, uploadedFiles, onProjectCreated, handleClose]);

  const getFileIcon = (file: File) => {
    if (file.type.startsWith("image/")) return <ImageIcon className="w-4 h-4 text-blue-500" />;
    if (file.type.includes("pdf")) return <FileText className="w-4 h-4 text-red-500" />;
    return <File className="w-4 h-4 text-gray-500" />;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden" hideClose={false}>
        <div className="flex flex-col">
          <div className="px-6 py-5 border-b border-gray-200 bg-white">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold text-gray-900">
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
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-400"
                disabled={isCreating}
              />
            </div>

            {/* File drop zone */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Documents
              </label>
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
                className={`
                  flex flex-col items-center justify-center min-h-[140px] rounded-xl border-2 border-dashed cursor-pointer transition-colors
                  ${isDragOver ? "border-blue-400 bg-blue-50/50" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/50"}
                `}
              >
                <Upload
                  className={`w-8 h-8 mb-2 ${isDragOver ? "text-blue-500" : "text-gray-400"}`}
                  strokeWidth={1.5}
                />
                <span
                  className={`text-sm font-medium ${isDragOver ? "text-blue-600" : "text-gray-500"}`}
                >
                  Drop files here or click to upload
                </span>
                <span className="text-xs text-gray-400 mt-0.5">
                  PDFs, images, and more
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
            </div>

            {/* File list */}
            {uploadedFiles.length > 0 && (
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {uploadedFiles.map((uf) => (
                  <div
                    key={uf.id}
                    className="flex items-center gap-2 py-2 px-3 rounded-lg bg-gray-50 border border-gray-100"
                  >
                    {getFileIcon(uf.file)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {uf.file.name}
                      </p>
                      {uf.uploadStatus === "uploading" && (
                        <div className="w-full h-1.5 bg-gray-200 rounded-full mt-1 overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all"
                            style={{ width: `${uf.uploadProgress}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFileRemove(uf.id);
                      }}
                      className="p-1 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-700"
                    >
                      <X className="w-4 h-4" />
                    </button>
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

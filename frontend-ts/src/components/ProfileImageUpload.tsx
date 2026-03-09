"use client";

import * as React from "react";
import { Upload, Loader2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { validateImageFile, validateImageDimensions } from "@/utils/profileValidation";

interface ProfileImageUploadProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (file: File) => Promise<void>;
  onRemove?: () => Promise<void>;
  currentImageUrl?: string;
  title?: string;
  aspectRatio?: number; // For profile picture: 1, for logo: can be different
}

export const ProfileImageUpload: React.FC<ProfileImageUploadProps> = ({
  isOpen,
  onClose,
  onSave,
  onRemove,
  currentImageUrl,
  title = "Change profile picture",
  aspectRatio = 1,
}) => {
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!isOpen) {
      // Reset state when modal closes
      setSelectedFile(null);
      setPreviewUrl(null);
      setError(null);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    }
  }, [isOpen]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    // Validate file
    const validation = validateImageFile(file);
    if (!validation.isValid) {
      setError(validation.error || 'Invalid image file');
      return;
    }

    // Validate dimensions for profile picture
    if (aspectRatio === 1) {
      try {
        const dimValidation = await validateImageDimensions(file, 200, 200);
        if (!dimValidation.isValid) {
          setError(dimValidation.error || 'Image dimensions too small');
          return;
        }
      } catch (err) {
        setError('Failed to validate image dimensions');
        return;
      }
    }

    setSelectedFile(file);

    // Create preview
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  const handleSave = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setError(null);

    try {
      await onSave(selectedFile);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload image');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = async () => {
    if (!onRemove) return;

    setIsUploading(true);
    setError(null);

    try {
      await onRemove();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove image');
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancel = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setError(null);
    onClose();
  };

  const imageToShow = previewUrl || currentImageUrl;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent
        className="rounded-xl border border-[#E9E9EB] p-4 bg-white max-w-[500px] shadow-xl"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {/* Header */}
        <div className="border-b border-[#E9E9EB] pb-3 mb-4">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-semibold text-[#415C85] m-0">
              {title}
            </h2>
          </div>
        </div>

        {/* Content */}
        <div className="mb-4">
          {/* Image Preview */}
          {imageToShow && (
            <div
              className="w-full border border-[#E9E9EB] rounded-lg mb-4 flex items-center justify-center bg-[#F9F9F9] overflow-hidden"
              style={{ aspectRatio }}
            >
              <img
                src={imageToShow}
                alt="Preview"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                }}
              />
            </div>
          )}

          {/* File Input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />

          {/* Upload Button */}
          {!selectedFile && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2.5 px-4 border border-[#E9E9EB] rounded-lg bg-[#F3F4F6] text-[#415C85] text-xs font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors hover:bg-[#E5E7EB] active:bg-[#D1D5DB]"
            >
              <Upload className="w-4 h-4" />
              <span>Choose image</span>
            </button>
          )}

          {/* Error Message */}
          {error && (
            <div className="text-[10px] text-red-600 mt-2 py-2 px-3 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#E9E9EB] pt-3 flex justify-end gap-2">
          {onRemove && currentImageUrl && !selectedFile && (
            <button
              onClick={handleRemove}
              disabled={isUploading}
              className="h-8 px-4 bg-transparent text-red-600 border border-[#E9E9EB] rounded-lg text-[11px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors hover:bg-red-50 active:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Remove</span>
            </button>
          )}
          <button
            onClick={handleCancel}
            disabled={isUploading}
            className="h-8 px-4 bg-transparent text-[#63748A] border border-[#E9E9EB] rounded-lg text-[11px] font-medium cursor-pointer transition-colors hover:bg-gray-100 active:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          {selectedFile && (
            <button
              onClick={handleSave}
              disabled={isUploading}
              className={`h-8 px-4 text-white border-none rounded-lg text-[11px] font-medium flex items-center gap-1.5 cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                isUploading ? 'bg-[#F3F4F6]' : 'bg-[#415C85] hover:bg-[#354d6b] active:bg-[#2a3d55]'
              }`}
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Uploading...</span>
                </>
              ) : (
                <span>Save</span>
              )}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

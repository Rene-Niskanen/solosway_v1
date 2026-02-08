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
    <Dialog open={isOpen} onOpenChange={handleCancel}>
      <DialogContent
        className="rounded-none"
        style={{
          borderRadius: 0,
          border: '1px solid #E9E9EB',
          padding: '16px',
          backgroundColor: '#FFFFFF',
          maxWidth: '500px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
        }}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {/* Header */}
        <div style={{
          borderBottom: '1px solid #E9E9EB',
          paddingBottom: '12px',
          marginBottom: '16px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{
              fontSize: '14px',
              fontWeight: 600,
              color: '#415C85',
              margin: 0,
            }}>
              {title}
            </h2>
          </div>
        </div>

        {/* Content */}
        <div style={{ marginBottom: '16px' }}>
          {/* Image Preview */}
          {imageToShow && (
            <div style={{
              width: '100%',
              aspectRatio: aspectRatio.toString(),
              border: '1px solid #E9E9EB',
              borderRadius: 0,
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#F9F9F9',
              overflow: 'hidden',
            }}>
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
              style={{
                width: '100%',
                padding: '10px 16px',
                border: '1px solid #E9E9EB',
                borderRadius: 0,
                backgroundColor: '#F3F4F6',
                color: '#415C85',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'background-color 100ms',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#F0F6FF';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#F3F4F6';
              }}
            >
              <Upload className="w-4 h-4" />
              <span>Choose image</span>
            </button>
          )}

          {/* Error Message */}
          {error && (
            <div style={{
              fontSize: '10px',
              color: '#DC2626',
              marginTop: '8px',
              padding: '8px 12px',
              backgroundColor: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: 0,
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: '1px solid #E9E9EB',
          paddingTop: '12px',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '8px',
        }}>
          {onRemove && currentImageUrl && !selectedFile && (
            <button
              onClick={handleRemove}
              disabled={isUploading}
              style={{
                padding: '8px 16px',
                height: '32px',
                backgroundColor: 'transparent',
                color: '#DC2626',
                border: '1px solid #E9E9EB',
                borderRadius: '2px',
                fontSize: '11px',
                fontWeight: 500,
                cursor: isUploading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                opacity: isUploading ? 0.5 : 1,
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Remove</span>
            </button>
          )}
          <button
            onClick={handleCancel}
            disabled={isUploading}
            style={{
              padding: '8px 16px',
              height: '32px',
              backgroundColor: 'transparent',
              color: '#63748A',
              border: '1px solid #E9E9EB',
              borderRadius: '2px',
              fontSize: '11px',
              fontWeight: 500,
              cursor: isUploading ? 'not-allowed' : 'pointer',
              opacity: isUploading ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          {selectedFile && (
            <button
              onClick={handleSave}
              disabled={isUploading}
              style={{
                padding: '8px 16px',
                height: '32px',
                backgroundColor: isUploading ? '#F3F4F6' : '#415C85',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '2px',
                fontSize: '11px',
                fontWeight: 500,
                cursor: isUploading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                opacity: isUploading ? 0.5 : 1,
              }}
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

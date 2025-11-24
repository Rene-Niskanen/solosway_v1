"use client";

import * as React from "react";
import { Upload, X, FileText, Image as ImageIcon, File, Plus } from "lucide-react";

interface UploadedFile {
  id: string;
  file: File;
  documentId?: string;
  uploadProgress: number;
  uploadStatus: 'uploading' | 'complete' | 'error';
  extractedAddress?: string;
}

interface FileUploadCardProps {
  files: UploadedFile[];
  onFilesChange: (files: UploadedFile[]) => void;
  uploading: boolean;
  uploadProgress: Record<string, number>;
  onFileUpload: (file: File) => Promise<void>;
  onFileRemove: (fileId: string) => void;
}

export const FileUploadCard: React.FC<FileUploadCardProps> = ({
  files,
  onFilesChange,
  uploading,
  uploadProgress,
  onFileUpload,
  onFileRemove
}) => {
  const [isDragOver, setIsDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    for (const file of droppedFiles) {
      await handleFileAdd(file);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    for (const file of selectedFiles) {
      await handleFileAdd(file);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileAdd = async (file: File) => {
    const fileId = `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newFile: UploadedFile = {
      id: fileId,
      file,
      uploadProgress: 0,
      uploadStatus: 'uploading'
    };

    // Add to state immediately
    onFilesChange([...files, newFile]);

    // Start upload
    try {
      await onFileUpload(file);
      // Update status after upload
      onFilesChange(files.map(f => 
        f.id === fileId ? { ...f, uploadStatus: 'complete', uploadProgress: 100 } : f
      ));
    } catch (error) {
      console.error('Upload error:', error);
      onFilesChange(files.map(f => 
        f.id === fileId ? { ...f, uploadStatus: 'error' } : f
      ));
    }
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) {
      return <ImageIcon className="w-5 h-5 text-blue-500" />;
    }
    if (file.type.includes('pdf')) {
      return <FileText className="w-5 h-5 text-red-500" />;
    }
    return <File className="w-5 h-5 text-gray-500" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div 
      className="flex flex-col h-full w-full"
      style={{
        padding: 0,
        backgroundColor: 'transparent'
      }}
    >
      {/* Demo Documents Upload Area */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className="flex flex-col items-center justify-center cursor-pointer w-full h-full relative overflow-hidden group"
        style={{
          minHeight: '100%',
          backgroundColor: isDragOver ? '#2A2A2A' : 'transparent'
        }}
      >
        {/* Foreground Docs */}
        <div className="flex items-end justify-center z-10 mt-0 group-hover:-translate-y-2 transition-transform duration-300 w-full px-3 relative">
          
          {/* Left Doc (Background) */}
          <div 
            className="w-20 h-28 bg-white border border-gray-200 p-2.5 flex flex-col shadow-sm flex-shrink-0 absolute left-1/2 transform -translate-x-[130%] opacity-60 scale-90"
            style={{ borderRadius: 0 }}
          >
            <div className="w-2/3 h-1.5 bg-gray-800 mb-3" />
            <div className="w-full h-1 bg-gray-100 mb-1.5" />
            <div className="w-full h-1 bg-gray-100 mb-1.5" />
            <div className="w-4/5 h-1 bg-gray-100 mb-1.5" />
            <div className="w-1/2 h-1 bg-green-100 mt-auto" /> 
          </div>

          {/* Center Action Card (Foreground) */}
          <div 
            className="w-24 h-32 bg-white border-2 flex flex-col items-center justify-center shadow-md hover:shadow-lg transition-all flex-shrink-0 z-20 relative"
            style={{ 
              borderRadius: 0,
              borderColor: isDragOver ? '#3B82F6' : '#E5E7EB',
              marginBottom: '-8px'
            }}
          >
            <div className="w-9 h-9 flex items-center justify-center mb-2 rounded-full bg-gray-50 group-hover:bg-blue-50 transition-colors">
              <Plus className={`w-5 h-5 ${isDragOver ? 'text-blue-600' : 'text-gray-400 group-hover:text-blue-600'}`} />
            </div>
            <span className={`font-medium text-xs text-center px-1 leading-tight ${isDragOver ? 'text-blue-600' : 'text-gray-500 group-hover:text-blue-600'}`}>
              Add files
            </span>
          </div>

          {/* Right Doc (Background) */}
          <div 
            className="w-20 h-28 bg-white border border-gray-200 p-2.5 flex flex-col shadow-sm opacity-60 scale-90 flex-shrink-0 absolute right-1/2 transform translate-x-[130%]"
            style={{ borderRadius: 0 }}
          >
            <div className="w-1/2 h-1.5 bg-gray-400 mb-3" />
            <div className="w-full h-1 bg-gray-100 mb-1.5" />
            <div className="w-full h-1 bg-gray-100 mb-1.5" />
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* File List - Show when files are uploaded */}
      {files.length > 0 && (
      <div 
        className="absolute bottom-0 left-0 right-0 overflow-y-auto bg-white/95 backdrop-blur-sm"
        style={{
          maxHeight: '40%',
          padding: '16px',
          borderTop: '1px solid #E5E7EB'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {files.map((uploadedFile) => (
              <div
                key={uploadedFile.id}
                className="bg-gray-50"
                style={{
                  padding: '16px',
                  border: '1px solid #E5E7EB',
                  borderRadius: '0'
                }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {getFileIcon(uploadedFile.file)}
                    <div className="flex-1 min-w-0">
                      <p 
                        className="text-gray-800 truncate"
                        style={{ fontSize: '14px', fontWeight: 500 }}
                      >
                        {uploadedFile.file.name}
                      </p>
                      <p 
                        className="text-gray-500 mt-1"
                        style={{ fontSize: '12px', fontWeight: 400 }}
                      >
                        {formatFileSize(uploadedFile.file.size)}
                      </p>
                      {uploadedFile.extractedAddress && (
                        <div className="mt-2">
                          <span 
                            className="inline-flex items-center px-2 py-1 rounded"
                            style={{
                              fontSize: '12px',
                              backgroundColor: '#DBEAFE',
                              color: '#1E40AF',
                              fontWeight: 400
                            }}
                          >
                            Address: {uploadedFile.extractedAddress}
                          </span>
                        </div>
                      )}
                      {/* Upload Progress */}
                      {uploadedFile.uploadStatus === 'uploading' && (
                        <div className="mt-2">
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${uploadProgress[uploadedFile.id] || uploadedFile.uploadProgress}%` }}
                            />
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            Uploading... {uploadProgress[uploadedFile.id] || uploadedFile.uploadProgress}%
                          </p>
                        </div>
                      )}
                      {uploadedFile.uploadStatus === 'complete' && (
                        <p className="text-xs text-green-600 mt-1">✓ Uploaded</p>
                      )}
                      {uploadedFile.uploadStatus === 'error' && (
                        <p className="text-xs text-red-600 mt-1">✗ Upload failed</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onFileRemove(uploadedFile.id);
                    }}
                    className="ml-2 p-1 rounded transition-all duration-200"
                    style={{
                      color: '#6B7280'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#F3F4F6';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
        </div>
      </div>
      )}
    </div>
  );
};


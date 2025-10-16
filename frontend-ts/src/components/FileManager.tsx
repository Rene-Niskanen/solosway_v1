/**
 * FileManager Component
 * Displays all uploaded files with ability to view and delete
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  FileText, 
  Trash2, 
  Download, 
  Calendar, 
  File,
  Image as ImageIcon,
  FileSpreadsheet,
  FileCode,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { backendApi } from '@/services/backendApi';
import { format } from 'date-fns';

interface UploadedFile {
  id: string;
  filename: string;
  originalName: string;
  fileType: string;
  fileSize: number;
  uploadDate: string;
  url?: string;
  metadata?: any;
}

export const FileManager: React.FC = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);

  // Load files on mount
  useEffect(() => {
    loadFiles();
  }, []);

  const loadFiles = async () => {
    try {
      setLoading(true);
      
      const response = await backendApi.getUploadedFiles();
      
      if (response.success && response.data) {
        // Backend returns {success: true, data: [...]}
        // fetchApi wraps it as {success: true, data: {success: true, data: [...]}}
        // So we need to access response.data.data
        const filesData = response.data.data || response.data;
        
        if (Array.isArray(filesData)) {
          // Transform backend response to match frontend interface
          const transformedFiles = filesData.map((file: any) => ({
            id: file.id,
            filename: file.original_filename || file.filename,
            originalName: file.original_filename || file.filename,
            fileType: file.file_type || file.fileType || 'application/octet-stream',
            fileSize: file.file_size || file.fileSize || 0,
            uploadDate: file.created_at || file.uploadDate || new Date().toISOString(),
            url: file.url,
            metadata: file.metadata
          }));
          
          setFiles(transformedFiles as UploadedFile[]);
        } else {
          // Fallback to empty array if not an array
          console.warn('Files data is not an array:', filesData);
          setFiles([]);
        }
      } else {
        // Instead of showing error, just show empty state
        setFiles([]);
      }
    } catch (err) {
      console.error('Error loading files:', err);
      // Instead of showing error, just show empty state
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (fileId: string, filename: string) => {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) {
      return;
    }

    try {
      setDeletingFileId(fileId);
      
      const response = await backendApi.deleteFile(fileId);
      
      if (response.success) {
        // Remove file from list
        setFiles(files.filter(f => f.id !== fileId));
      } else {
        alert('Failed to delete file');
      }
    } catch (err) {
      console.error('Error deleting file:', err);
      alert('Error deleting file. Please try again.');
    } finally {
      setDeletingFileId(null);
    }
  };

  const handleDownload = async (file: UploadedFile) => {
    try {
      // If file has URL, open it
      if (file.url) {
        window.open(file.url, '_blank');
      } else {
        // Request download from backend
        const response = await backendApi.downloadFile(file.id);
        if (response.success && response.data) {
          const data = response.data as { url?: string };
          if (data.url) {
            window.open(data.url, '_blank');
          } else {
            alert('File not available for download');
          }
        } else {
          alert('File not available for download');
        }
      }
    } catch (err) {
      console.error('Error downloading file:', err);
      alert('Error downloading file. Please try again.');
    }
  };

  const getFileIcon = (fileType: string | undefined) => {
    if (!fileType) return File;
    if (fileType.startsWith('image/')) return ImageIcon;
    if (fileType.includes('pdf')) return FileText;
    if (fileType.includes('spreadsheet') || fileType.includes('excel')) return FileSpreadsheet;
    if (fileType.includes('code') || fileType.includes('text')) return FileCode;
    return File;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (dateString: string): string => {
    try {
      return format(new Date(dateString), 'MMM dd, yyyy HH:mm');
    } catch {
      return dateString;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
          <p className="text-slate-600 font-medium">Loading files...</p>
        </motion.div>
      </div>
    );
  }


  return (
    <div className="w-full min-h-screen">
      <div className="w-full max-w-none">
        
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">
              Uploaded Files
            </h1>
            <p className="text-gray-300">
              Manage your uploaded documents and files
            </p>
          </div>
          
          <motion.button
            onClick={loadFiles}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </motion.button>
        </div>

        {/* Files List */}
        {files.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="bg-white/90 backdrop-blur-xl rounded-3xl p-12 border-2 border-slate-200/60 shadow-[0_8px_32px_rgba(0,0,0,0.08)] text-center"
          >
            <div className="w-16 h-16 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-6 border-2 border-blue-100/60">
              <FileText className="w-8 h-8 text-blue-500" />
            </div>
            <h2 className="text-2xl font-semibold text-slate-800 mb-4">
              No Files Yet
            </h2>
            <p className="text-slate-600 leading-relaxed mb-6">
              You have no files uploaded yet.
            </p>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
              Ready to display files
            </div>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid gap-4"
          >
            <AnimatePresence mode="popLayout">
              {files.map((file, index) => {
                const FileIcon = getFileIcon(file.fileType);
                const isDeleting = deletingFileId === file.id;

                return (
                  <motion.div
                    key={file.id}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{
                      duration: 0.3,
                      delay: index * 0.05,
                      layout: { duration: 0.3 }
                    }}
                    className="bg-white/90 backdrop-blur-xl rounded-2xl p-6 border-2 border-slate-200/60 shadow-[0_4px_16px_rgba(0,0,0,0.06)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.1)] transition-all duration-300"
                  >
                    <div className="flex items-center justify-between gap-4">
                      {/* File Info */}
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        {/* Icon */}
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl flex items-center justify-center border-2 border-blue-100/60 flex-shrink-0">
                          <FileIcon className="w-6 h-6 text-blue-600" />
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg font-semibold text-slate-800 truncate">
                            {file.originalName || file.filename}
                          </h3>
                          <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5" />
                              {formatDate(file.uploadDate)}
                            </span>
                            <span>{formatFileSize(file.fileSize)}</span>
                            {file.fileType && (
                              <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs font-medium">
                                {file.fileType.split('/')[1]?.toUpperCase() || 'FILE'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {/* Download Button */}
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleDownload(file)}
                          className="p-2.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl transition-colors"
                          title="Download"
                        >
                          <Download className="w-5 h-5" />
                        </motion.button>

                        {/* Delete Button */}
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleDelete(file.id, file.originalName || file.filename)}
                          disabled={isDeleting}
                          className="p-2.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Delete"
                        >
                          {isDeleting ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <Trash2 className="w-5 h-5" />
                          )}
                        </motion.button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default FileManager;


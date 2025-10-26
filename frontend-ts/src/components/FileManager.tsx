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
        const filesData = (response.data as any).data || response.data;
        
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
    <div className="w-full h-screen bg-white">
      <div className="w-full h-full mx-8 max-w-full overflow-x-auto">
        
        {/* Header */}
        <div className="px-16 py-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              Uploaded Files
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage your uploaded documents and files
            </p>
          </div>
          
          <motion.button
            onClick={loadFiles}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors text-sm"
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
            className="flex-1 flex items-center justify-center"
          >
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-6">
                <FileText className="w-8 h-8 text-gray-500" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                No Files Yet
              </h2>
              <p className="text-gray-600 mb-4">
                You have no files uploaded yet.
              </p>
              <div className="inline-flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-600 rounded-md text-sm font-medium">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"></div>
                Ready to display files
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col bg-white"
          >
            {/* Header */}
            <div className="bg-gray-50 px-16 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <input type="checkbox" className="rounded border-gray-300" />
                <span className="text-sm font-medium text-gray-700">Name</span>
              </div>
              <div className="flex items-center space-x-6 mr-12">
                <div className="flex items-center space-x-2">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                  <input 
                    type="text" 
                    placeholder="Filter Items" 
                    className="text-sm border-none bg-transparent placeholder-gray-400 focus:outline-none w-32"
                  />
                </div>
                <span className="text-sm font-medium text-gray-700">Modified</span>
                <span className="text-sm font-medium text-gray-700">Size</span>
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
              </div>
            </div>
            
            {/* File List */}
            <div className="flex-1 overflow-y-auto">
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
                      className="flex items-center px-16 py-4 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                    >
                      {/* Document Icon */}
                      <div className="flex items-center space-x-3 flex-1 min-w-0">
                        <input type="checkbox" className="rounded border-gray-300" />
                        
                        {/* File Type Icon */}
                        <div className="flex-shrink-0">
                          {file.fileType?.includes('pdf') ? (
                            <div className="w-8 h-8 bg-red-500 rounded flex items-center justify-center">
                              <span className="text-white text-xs font-bold">A</span>
                            </div>
                          ) : file.fileType?.includes('word') || file.fileType?.includes('document') ? (
                            <div className="w-8 h-8 bg-blue-500 rounded flex items-center justify-center">
                              <span className="text-white text-xs font-bold">W</span>
                            </div>
                          ) : file.fileType?.includes('spreadsheet') || file.fileType?.includes('excel') ? (
                            <div className="w-8 h-8 bg-green-500 rounded flex items-center justify-center">
                              <span className="text-white text-xs font-bold">X</span>
                            </div>
                          ) : (
                            <div className="w-8 h-8 bg-gray-500 rounded flex items-center justify-center">
                              <FileIcon className="w-4 h-4 text-white" />
                            </div>
                          )}
                        </div>
                        
                        {/* Document Name */}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {file.originalName || file.filename}
                          </div>
                          <div className="text-xs text-gray-500">
                            {file.fileType?.split('/')[1]?.toUpperCase() || 'FILE'}
                          </div>
                        </div>
                      </div>
                      
                      {/* Document Details */}
                      <div className="flex items-center space-x-6 text-sm text-gray-500 mr-12">
                        <div className="text-right">
                          {formatDate(file.uploadDate)}
                        </div>
                        <div className="text-right">
                          {formatFileSize(file.fileSize)}
                        </div>
                        {/* Actions */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {/* Download Button */}
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handleDownload(file)}
                            className="p-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded transition-colors"
                            title="Download"
                          >
                            <Download className="w-4 h-4" />
                          </motion.button>

                          {/* Delete Button */}
                          <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handleDelete(file.id, file.originalName || file.filename)}
                            disabled={isDeleting}
                            className="p-1.5 bg-red-100 hover:bg-red-200 text-red-600 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Delete"
                          >
                            {isDeleting ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </motion.button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default FileManager;


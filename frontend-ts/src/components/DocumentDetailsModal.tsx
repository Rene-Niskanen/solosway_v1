/**
 * DocumentDetailsModal Component
 * Professional right-side modal for viewing document details
 */

import React from 'react';
import { motion } from 'framer-motion';
import { X, Download, Trash2, FileText, Calendar, HardDrive, User, CheckCircle, Clock } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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

interface DocumentDetailsModalProps {
  file: UploadedFile | null;
  isOpen: boolean;
  onClose: () => void;
  onDownload: (file: UploadedFile) => void;
  onDelete: (fileId: string, filename: string) => void;
  isDeleting?: boolean;
}

export const DocumentDetailsModal: React.FC<DocumentDetailsModalProps> = ({
  file,
  isOpen,
  onClose,
  onDownload,
  onDelete,
  isDeleting = false
}) => {
  if (!file) return null;

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (dateString: string): string => {
    try {
      return format(new Date(dateString), 'MMM dd, yyyy');
    } catch {
      return dateString;
    }
  };

  const formatDateTime = (dateString: string): string => {
    try {
      return format(new Date(dateString), 'MMM dd, yyyy HH:mm');
    } catch {
      return dateString;
    }
  };

  const getFileTypeLabel = (fileType: string): string => {
    if (fileType?.includes('pdf')) return 'PDF Document';
    if (fileType?.includes('word') || fileType?.includes('document')) return 'Word Document';
    if (fileType?.includes('spreadsheet') || fileType?.includes('excel')) return 'Spreadsheet';
    if (fileType?.startsWith('image/')) return 'Image';
    return 'File';
  };

  const getStatusBadge = () => {
    // You can add status logic here based on file metadata
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">
        <CheckCircle className="w-3 h-3 mr-1.5" />
        Available
      </span>
    );
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 overflow-y-auto">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="px-6 py-5 border-b border-gray-200 bg-white sticky top-0 z-10">
            <div className="flex items-center justify-between mb-4">
              <SheetTitle className="text-xl font-bold text-gray-900">
                Document Details
              </SheetTitle>
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-700">File ID:</span>
              <span className="text-sm text-gray-600 font-mono">#{file.id.slice(0, 8).toUpperCase()}</span>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 px-6 py-6 space-y-6 bg-gray-50">
            {/* File Preview/Icon */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center space-x-4 mb-4">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center shadow-md">
                  <FileText className="w-8 h-8 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-gray-900 truncate mb-1">
                    {file.originalName || file.filename}
                  </h3>
                  <p className="text-sm text-gray-500 font-medium">
                    {getFileTypeLabel(file.fileType)}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                {getStatusBadge()}
                <div className="flex items-center gap-2">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => onDownload(file)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => onDelete(file.id, file.originalName || file.filename)}
                    disabled={isDeleting}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </motion.button>
                </div>
              </div>
            </div>

            {/* File Information */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h4 className="text-base font-bold text-gray-900 mb-4">File Information</h4>
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <HardDrive className="w-5 h-5 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">File Size</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">
                    {formatFileSize(file.fileSize)}
                  </span>
                </div>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">Upload Date</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">
                    {formatDate(file.uploadDate)}
                  </span>
                </div>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">Last Modified</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">
                    {formatDateTime(file.uploadDate)}
                  </span>
                </div>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">File Type</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">
                    {file.fileType?.split('/')[1]?.toUpperCase() || 'FILE'}
                  </span>
                </div>
              </div>
            </div>

            {/* Additional Details */}
            {file.metadata && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h4 className="text-base font-bold text-gray-900 mb-4">Additional Details</h4>
                <div className="space-y-2">
                  {Object.entries(file.metadata).map(([key, value]) => (
                    <div key={key} className="flex items-start justify-between">
                      <span className="text-sm font-medium text-gray-700 capitalize">
                        {key.replace(/_/g, ' ')}
                      </span>
                      <span className="text-sm text-gray-900 font-semibold">
                        {String(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Security Note */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-blue-800 font-medium">
                All your transactions are secure and fast.
              </p>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};


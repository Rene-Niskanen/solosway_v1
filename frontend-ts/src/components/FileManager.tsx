/**
 * FileManager Component
 * Professional enterprise-grade file management interface
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
  RefreshCw,
  MoreVertical,
  Upload,
  HardDrive,
  Video,
  Music,
  Image,
  Folder,
  ArrowRight,
  Search,
  Filter,
  ChevronDown,
  Eye
} from 'lucide-react';
import { backendApi } from '@/services/backendApi';
import { format } from 'date-fns';
import { DocumentDetailsModal } from './DocumentDetailsModal';
import { UploadDocumentModal } from './UploadDocumentModal';

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
  const [userData, setUserData] = useState<any>(null);
  const [selectedFile, setSelectedFile] = useState<UploadedFile | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Load files on mount
  useEffect(() => {
    loadFiles();
    fetchUserData();
  }, []);

  const fetchUserData = async () => {
    try {
      const authResult = await backendApi.checkAuth();
      if (authResult.success && authResult.data?.user) {
        setUserData(authResult.data.user);
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    }
  };

  const loadFiles = async () => {
    try {
      setLoading(true);
      
      const response = await backendApi.getUploadedFiles();
      
      if (response.success && response.data) {
        const filesData = (response.data as any).data || response.data;
        
        if (Array.isArray(filesData)) {
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
          console.warn('Files data is not an array:', filesData);
          setFiles([]);
        }
      } else {
        setFiles([]);
      }
    } catch (err) {
      console.error('Error loading files:', err);
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
        // Deletion successful - remove from UI
        setFiles(files.filter(f => f.id !== fileId));
        if (selectedFile?.id === fileId) {
          setIsDetailsModalOpen(false);
          setSelectedFile(null);
        }
      } else {
        // Check if it's a 404 "Document not found" error
        // This means the file was already deleted, so treat it as success
        const errorMessage = response.error || '';
        if (errorMessage.includes('Document not found') || errorMessage.includes('not found')) {
          // File was already deleted - remove from UI
          setFiles(files.filter(f => f.id !== fileId));
          if (selectedFile?.id === fileId) {
            setIsDetailsModalOpen(false);
            setSelectedFile(null);
          }
          console.info(`File "${filename}" was already deleted, removing from UI`);
        } else {
          alert(`Failed to delete file: ${errorMessage || 'Unknown error'}`);
        }
      }
    } catch (err: unknown) {
      console.error('Error deleting file:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      alert(`Error deleting file: ${errorMessage}`);
    } finally {
      setDeletingFileId(null);
    }
  };

  const handleDownload = async (file: UploadedFile) => {
    try {
      if (file.url) {
        window.open(file.url, '_blank');
      } else {
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

  const handleFileClick = (file: UploadedFile) => {
    setSelectedFile(file);
    setIsDetailsModalOpen(true);
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
      return format(new Date(dateString), 'MMM dd, yyyy');
    } catch {
      return dateString;
    }
  };

  const getUserName = () => {
    if (userData?.first_name) {
      return userData.first_name;
    }
    if (userData?.email) {
      const emailPrefix = userData.email.split('@')[0];
      return emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);
    }
    return 'User';
  };

  // Filter files based on search
  const filteredFiles = files.filter(file => 
    file.originalName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    file.filename?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Get recently edited files (last 3, sorted by date)
  const recentlyEdited = [...files]
    .sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime())
    .slice(0, 3);

  // Calculate storage stats
  const totalSize = files.reduce((sum, file) => sum + file.fileSize, 0);
  const totalSizeGB = totalSize / (1024 * 1024 * 1024);
  const maxStorageGB = 256;
  const storagePercentage = (totalSizeGB / maxStorageGB) * 100;

  // Calculate file type breakdown
  const fileTypeStats = {
    documents: files.filter(f => f.fileType?.includes('pdf') || f.fileType?.includes('document') || f.fileType?.includes('word')).reduce((sum, f) => sum + f.fileSize, 0),
    videos: files.filter(f => f.fileType?.includes('video')).reduce((sum, f) => sum + f.fileSize, 0),
    audio: files.filter(f => f.fileType?.includes('audio')).reduce((sum, f) => sum + f.fileSize, 0),
    photos: files.filter(f => f.fileType?.startsWith('image/')).reduce((sum, f) => sum + f.fileSize, 0),
  };

  const handleFileUpload = (file: File) => {
    setTimeout(() => {
      loadFiles();
    }, 1000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] bg-gray-50">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center gap-4"
        >
          <Loader2 className="w-10 h-10 text-slate-400 animate-spin" />
          <p className="text-slate-600 font-medium text-base">Loading files...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-white flex overflow-hidden">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-y-auto bg-white min-h-0">
        {/* Professional Header */}
        <div className="px-8 pt-8 pb-6 bg-white border-b border-gray-200">
          <div className="flex items-center justify-between mb-6">
          <div>
              <h1 className="text-2xl font-semibold text-gray-900 tracking-tight mb-1">
                Files & Documents
            </h1>
              <p className="text-sm text-gray-500">
                Welcome Back, {getUserName()}
              </p>
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setIsUploadModalOpen(true)}
              className="px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg font-medium text-sm transition-colors flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Upload Document
            </motion.button>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-50 rounded-lg p-5 border border-gray-200">
              <p className="text-sm text-gray-600 mb-1">Total Files</p>
              <p className="text-2xl font-semibold text-gray-900">{files.length}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-5 border border-gray-200">
              <p className="text-sm text-gray-600 mb-1">Storage Used</p>
              <p className="text-2xl font-semibold text-gray-900">{totalSizeGB.toFixed(1)} GB</p>
            </div>
          </div>
          
          {/* Search and Filter Bar */}
          <div className="flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search name or file ID"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-transparent"
              />
            </div>
            <button className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Filter
            </button>
            <button className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2">
              {format(new Date(), 'MMM dd, yyyy')}
              <ChevronDown className="w-4 h-4" />
            </button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
              onClick={loadFiles}
              className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </motion.button>
        </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 px-8 py-6 bg-white min-h-0">
          {/* Recently Edited Section */}
          {recentlyEdited.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Recently Edited</h2>
                <button className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                  View All
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {recentlyEdited.map((file, index) => {
                  const FileIcon = getFileIcon(file.fileType);
                  const isImage = file.fileType?.startsWith('image/');
                  
                  return (
          <motion.div
                      key={file.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1, duration: 0.3 }}
                      onClick={() => handleFileClick(file)}
                      className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md hover:border-gray-300 transition-all duration-200 cursor-pointer relative group"
                    >
                      <button className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-gray-100 rounded-lg">
                        <MoreVertical className="w-4 h-4 text-gray-500" />
                      </button>
                      
                      {isImage && file.url ? (
                        <div className="w-full h-32 bg-gray-100 rounded-lg mb-3 overflow-hidden">
                          <img 
                            src={file.url} 
                            alt={file.originalName}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="w-full h-32 bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg mb-3 flex items-center justify-center">
                          {file.fileType?.includes('pdf') ? (
                            <div className="w-12 h-12 bg-red-600 rounded-lg flex items-center justify-center shadow-sm">
                              <span className="text-white text-lg font-semibold">A</span>
                            </div>
                          ) : file.fileType?.includes('word') || file.fileType?.includes('document') ? (
                            <div className="w-12 h-12 bg-gray-700 rounded-lg flex items-center justify-center shadow-sm">
                              <span className="text-white text-lg font-semibold">W</span>
                            </div>
                          ) : file.fileType?.includes('spreadsheet') || file.fileType?.includes('excel') ? (
                            <div className="w-12 h-12 bg-gray-700 rounded-lg flex items-center justify-center shadow-sm">
                              <span className="text-white text-lg font-semibold">X</span>
                            </div>
                          ) : (
                            <FileIcon className="w-8 h-8 text-gray-400" />
                          )}
              </div>
                      )}
                      
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900 truncate mb-1">
                          {file.originalName || file.filename}
                        </h3>
                        <p className="text-xs text-gray-500 font-medium">
                          {formatDate(file.uploadDate)}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Files Table - Professional Design */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            {/* Table Header */}
            <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
              <div className="grid grid-cols-12 gap-4 items-center">
                <div className="col-span-5">
                  <div className="flex items-center gap-2">
                <input type="checkbox" className="rounded border-gray-300" />
                    <span className="text-xs font-medium text-gray-600 uppercase tracking-wider">RESERVATION ID / NAME</span>
              </div>
                </div>
                <div className="col-span-2 text-xs font-medium text-gray-600 uppercase tracking-wider">SHARED USERS</div>
                <div className="col-span-2 text-xs font-medium text-gray-600 uppercase tracking-wider">FILE SIZE</div>
                <div className="col-span-2 text-xs font-medium text-gray-600 uppercase tracking-wider">LAST MODIFIED</div>
                <div className="col-span-1"></div>
              </div>
            </div>
            
            {/* File List */}
            <div className="divide-y divide-gray-100">
              {filteredFiles.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <FileText className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-gray-500 mb-2">No files found</p>
                  <button
                    onClick={() => setIsUploadModalOpen(true)}
                    className="text-sm text-gray-600 hover:text-gray-900 font-medium"
                  >
                    Upload your first document
                  </button>
                </div>
              ) : (
                filteredFiles.map((file, index) => {
                  const FileIcon = getFileIcon(file.fileType);
                  const isDeleting = deletingFileId === file.id;

                  return (
                    <motion.div
                      key={file.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03, duration: 0.2 }}
                      onClick={() => handleFileClick(file)}
                      className="px-6 py-3 grid grid-cols-12 gap-4 items-center hover:bg-gray-50 group cursor-pointer transition-colors duration-200"
                    >
                      <div className="col-span-5 flex items-center space-x-3 min-w-0">
                        <input 
                          type="checkbox" 
                          className="rounded border-gray-300"
                          onClick={(e) => e.stopPropagation()}
                        />
                          {file.fileType?.includes('pdf') ? (
                          <div className="w-9 h-9 bg-red-600 rounded flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-xs font-semibold">A</span>
                            </div>
                          ) : file.fileType?.includes('word') || file.fileType?.includes('document') ? (
                          <div className="w-9 h-9 bg-gray-700 rounded flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-xs font-semibold">W</span>
                            </div>
                          ) : file.fileType?.includes('spreadsheet') || file.fileType?.includes('excel') ? (
                          <div className="w-9 h-9 bg-gray-700 rounded flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-xs font-semibold">X</span>
                            </div>
                          ) : (
                          <div className="w-9 h-9 bg-gray-600 rounded flex items-center justify-center flex-shrink-0">
                              <FileIcon className="w-4 h-4 text-white" />
                            </div>
                          )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-medium text-gray-900 truncate">
                              #{file.id.slice(0, 8).toUpperCase()}
                            </span>
                            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full font-medium">
                              NEW
                            </span>
                        </div>
                          <div className="text-sm text-gray-600 truncate">
                            {file.originalName || file.filename}
                          </div>
                        </div>
                      </div>
                      
                      <div className="col-span-2 text-sm text-gray-500">
                        —
                        </div>
                      
                      <div className="col-span-2 text-sm text-gray-700">
                          {formatFileSize(file.fileSize)}
                        </div>
                      
                      <div className="col-span-2 text-sm text-gray-500">
                        {formatDate(file.uploadDate)}
                      </div>
                      
                      <div className="col-span-1 flex items-center justify-end">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <motion.button
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(file);
                            }}
                            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-all"
                            title="Download"
                          >
                            <Download className="w-4 h-4" />
                          </motion.button>
                          <motion.button
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(file.id, file.originalName || file.filename);
                            }}
                            disabled={isDeleting}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all disabled:opacity-50"
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
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right Sidebar - Refined Dark Theme */}
      <div className="w-80 h-full bg-slate-900 text-white flex flex-col shadow-xl flex-shrink-0">
        <div className="p-8 space-y-8 flex-1 overflow-y-auto pb-8">
          {/* Storage Section */}
          <div>
            <h3 className="text-base font-semibold text-white mb-5">Storage</h3>
            <div className="mb-4">
              <div className="flex items-center justify-between text-sm mb-3">
                <span className="text-gray-300">{totalSizeGB.toFixed(1)} GB / {maxStorageGB} GB</span>
                <span className="text-gray-400">{storagePercentage.toFixed(1)}%</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(storagePercentage, 100)}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className={`h-full ${
                    storagePercentage < 50 ? 'bg-emerald-500' : 
                    storagePercentage < 80 ? 'bg-yellow-500' : 
                    'bg-red-500'
                  }`}
                />
              </div>
            </div>
            <button className="w-full py-2.5 px-4 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors mb-2">
              Smart Optimizer
            </button>
            <button className="text-sm text-gray-400 hover:text-gray-300 transition-colors">
              View Details
            </button>
          </div>

          {/* File Type Section */}
          <div>
            <h3 className="text-base font-semibold text-white mb-5">File Type</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center">
                    <FileText className="w-4 h-4 text-gray-300" />
                  </div>
                  <span className="text-sm text-gray-200">Documents</span>
                </div>
                <span className="text-sm text-gray-400">
                  {(fileTypeStats.documents / (1024 * 1024 * 1024)).toFixed(1)} GB
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center">
                    <Video className="w-4 h-4 text-gray-300" />
                  </div>
                  <span className="text-sm text-gray-200">Video</span>
                </div>
                <span className="text-sm text-gray-400">
                  {(fileTypeStats.videos / (1024 * 1024 * 1024)).toFixed(1)} GB
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center">
                    <Music className="w-4 h-4 text-gray-300" />
                  </div>
                  <span className="text-sm text-gray-200">Audio</span>
                </div>
                <span className="text-sm text-gray-400">
                  {(fileTypeStats.audio / (1024 * 1024 * 1024)).toFixed(1)} GB
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center">
                    <Image className="w-4 h-4 text-gray-300" />
                  </div>
                  <span className="text-sm text-gray-200">Photos</span>
                </div>
                <span className="text-sm text-gray-400">
                  {(fileTypeStats.photos / (1024 * 1024 * 1024)).toFixed(1)} GB
                </span>
              </div>
            </div>
            <button className="mt-5 text-sm text-gray-400 hover:text-gray-300 transition-colors">
              View Details
            </button>
          </div>

          {/* Upgrade Storage Card */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="w-12 h-12 bg-gray-700 rounded-lg flex items-center justify-center mb-4">
              <Folder className="w-6 h-6 text-gray-300" />
            </div>
            <h4 className="text-base font-semibold text-white mb-2">Get More Space For Files</h4>
            <p className="text-sm text-gray-400 mb-5">
              More than 200 GB for your files
            </p>
            <button className="w-full py-2.5 px-4 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">
              Upgrade Storage
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      <DocumentDetailsModal
        file={selectedFile}
        isOpen={isDetailsModalOpen}
        onClose={() => {
          setIsDetailsModalOpen(false);
          setSelectedFile(null);
        }}
        onDownload={handleDownload}
        onDelete={handleDelete}
        isDeleting={deletingFileId === selectedFile?.id}
      />

      <UploadDocumentModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUpload={handleFileUpload}
        onContinueWithReport={loadFiles}
      />
    </div>
  );
};

export default FileManager;

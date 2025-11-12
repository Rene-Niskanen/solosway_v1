"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, X, Check, AlertCircle, Plus, Image, FileIcon, Camera, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSystem } from "@/contexts/SystemContext";
import { backendApi } from "@/services/backendApi";
export interface PropertyValuationUploadProps {
  className?: string;
  onUpload?: (file: File) => void;
  onContinueWithReport?: () => void;
  compact?: boolean; // When true, renders as a compact card instead of fullscreen
}
interface UploadedFile {
  id: string;
  name: string;
  size: string;
  type: string;
  status: 'uploading' | 'processing' | 'completed' | 'error';
  file: File;
  preview?: string;
}
const uploadSteps = [{
  id: 1,
  title: "Upload",
  completed: false,
  active: true
}, {
  id: 2,
  title: "Process",
  completed: false,
  active: false
}, {
  id: 3,
  title: "Analyze",
  completed: false,
  active: false
}];
export default function PropertyValuationUpload({
  className,
  onUpload,
  onContinueWithReport,
  compact = false
}: PropertyValuationUploadProps) {
  const { addDocument, updateDocumentStatus, addActivity } = useSystem();
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [uploadedFiles, setUploadedFiles] = React.useState<UploadedFile[]>([]);
  const [currentStep, setCurrentStep] = React.useState(1);
  const [steps, setSteps] = React.useState(uploadSteps);
  const [showCompletionTick, setShowCompletionTick] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const {
    toast
  } = useToast();
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(processFile);
  };
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(processFile);
    e.target.value = '';
  };
  const processFile = (file: File) => {
    const newFile: UploadedFile = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      name: file.name,
      size: formatFileSize(file.size),
      type: getFileType(file.type),
      status: 'uploading',
      file
    };

    // Create preview for images
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = e => {
        setUploadedFiles(prev => prev.map(f => f.id === newFile.id ? {
          ...f,
          preview: e.target?.result as string
        } : f));
      };
      reader.readAsDataURL(file);
    }
    setUploadedFiles(prev => [...prev, newFile]);
    
    // Add to system context
    const systemDocId = addDocument(file);
    
    onUpload?.(file);

    // Real upload process
    uploadFileToBackend(newFile.id, file);
  };
  const uploadFileToBackend = async (fileId: string, file: File) => {
    try {
      console.log(`🚀 Uploading file to backend: ${file.name}`);
      
      // Update status to uploading
      setUploadedFiles(prev => prev.map(f => f.id === fileId ? {
        ...f,
        status: 'uploading' as const
      } : f));

      // Use proxy upload directly (more reliable than presigned URLs)
      console.log(`🔄 Using proxy upload for: ${file.name}`);
      const response = await backendApi.uploadPropertyDocumentViaProxy(file);
      
      if (response.success) {
        console.log(`✅ File uploaded successfully: ${file.name}`, response.data);
        const documentId = (response.data as any).document_id;
        
        // Start polling for status
        const pollStatus = async () => {
          try {
            const statusResponse = await backendApi.getDocumentStatus(documentId);
            
            // FIXED: Add more detailed logging and error handling
            console.log(`📊 [POLL] Document ${documentId}:`, {
              success: statusResponse.success,
              status: statusResponse.data ? (statusResponse.data as any).status : 'NO DATA',
              fullResponse: statusResponse
            });
            
            if (statusResponse.success && statusResponse.data) {
              // FIXED: The response is double-nested: statusResponse.data.data.status
              const responseData = (statusResponse.data as any).data || statusResponse.data;
              const status = responseData.status;
              const progress = responseData.pipeline_progress;
              
              console.log(`📊 Document ${documentId} status: "${status}" (type: ${typeof status})`);
              
              // Update file status
              setUploadedFiles(prev => prev.map(f => f.id === fileId ? {
                ...f,
                status: status === 'completed' ? 'completed' as const : 'processing' as const
              } : f));
              
              // FIXED: Use strict equality check and add more conditions
              const isComplete = status === 'completed';
              const isFailed = status === 'failed';
              
              console.log(`📊 Polling decision: complete=${isComplete}, failed=${isFailed}`);
              
              // Continue polling if not complete
              if (!isComplete && !isFailed) {
                console.log(`🔄 Continuing poll in 5 seconds...`);
                setTimeout(pollStatus, 5000); // Poll every 5 seconds
              } else if (isComplete) {
                console.log(`✅ Polling stopped - document completed`);
                toast({
                  title: "Processing Complete",
                  description: `${file.name} has been processed successfully.`,
                  duration: 3000,
                  className: "border-emerald-200 bg-gradient-to-r from-emerald-50 to-green-50"
                });
              } else if (isFailed) {
                console.log(`❌ Polling stopped - document failed`);
                toast({
                  title: "Processing Failed",
                  description: `${file.name} failed to process.`,
                  variant: "destructive",
                  duration: 5000
                });
              }
            } else {
              console.error(`❌ Status response error:`, statusResponse);
              // Stop polling on error
              toast({
                title: "Status Check Failed",
                description: `Unable to check status for ${file.name}`,
                variant: "destructive",
                duration: 3000
              });
            }
          } catch (error) {
            console.error(`❌ Polling error:`, error);
            // Stop polling on error
          }
        };
        
        // Start polling after 2 seconds
        setTimeout(pollStatus, 2000);
        
        // Show initial upload toast
        toast({
          title: "File Uploaded Successfully",
          description: `${file.name} has been uploaded and is being processed.`,
          duration: 3000,
          className: "border-emerald-200 bg-gradient-to-r from-emerald-50 to-green-50"
        });
      } else {
        throw new Error(response.error || 'Upload failed');
      }
    } catch (error) {
      console.error(`❌ Upload failed for ${file.name}:`, error);
      
      // Update status to error
      setUploadedFiles(prev => prev.map(f => f.id === fileId ? {
        ...f,
        status: 'error' as const
      } : f));

      // Show error toast
      toast({
        title: "Upload Failed",
        description: `Failed to upload ${file.name}. Please try again.`,
        variant: "destructive",
        duration: 5000
      });
    }
  };

  const handleDelete = (id: string) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== id));
  };
  const handleContinue = () => {
    setCurrentStep(2);
    setSteps(prev => prev.map(step => step.id === 1 ? {
      ...step,
      completed: true,
      active: false
    } : step.id === 2 ? {
      ...step,
      active: true
    } : step));
    setTimeout(() => {
      setCurrentStep(3);
      setSteps(prev => prev.map(step => step.id === 2 ? {
        ...step,
        completed: true,
        active: false
      } : step.id === 3 ? {
        ...step,
        active: true
      } : step));
    }, 2000);

      // Show completion notification after 10 seconds
      setTimeout(() => {
        setSteps(prev => prev.map(step => step.id === 3 ? {
          ...step,
          completed: true,
          active: false
        } : step));
        
        // Add completion activity
        addActivity({
          action: `Successfully processed ${uploadedFiles.length} document${uploadedFiles.length !== 1 ? 's' : ''} and integrated into system`,
          documents: uploadedFiles.map(f => f.name),
          type: 'analysis',
          details: { 
            processingTime: '10.2s', 
            totalFiles: uploadedFiles.length,
            completionRate: '100%'
          }
        });
        
        toast({
          title: "Documents Successfully Processed",
          description: "Your files are now integrated and ready for intelligent analysis.",
          duration: 2500,
          className: "border-emerald-200 bg-gradient-to-r from-emerald-50 to-green-50 shadow-lg shadow-emerald-100/50 max-w-sm text-sm"
        });

      // Show tick animation
      setShowCompletionTick(true);

      // Reset to initial state after tick animation
      setTimeout(() => {
        setShowCompletionTick(false);
        setUploadedFiles([]);
        setCurrentStep(1);
        setSteps(uploadSteps);

        // Continue with report after reset
        setTimeout(() => {
          onContinueWithReport?.();
        }, 500);
      }, 2000);
    }, 10000);
  };
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };
  const getFileType = (mimeType: string): string => {
    if (mimeType === 'application/pdf') return 'PDF';
    if (mimeType.startsWith('image/')) return 'Image';
    return 'File';
  };
  const completedFiles = uploadedFiles.filter(f => f.status === 'completed');
  const canContinue = completedFiles.length > 0;
  
  // Compact mode rendering (for integration in FileManager)
  if (compact) {
    return (
      <div className={`w-full ${className || ''}`}>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-white rounded-xl border border-gray-200/80 shadow-sm overflow-hidden"
        >
          {/* Card Header - Enhanced */}
          <div className="flex-shrink-0 px-6 py-5 border-b border-gray-200/60">
            <div className="flex items-center space-x-4">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-100 to-blue-100 rounded-lg flex items-center justify-center shadow-sm">
                <Upload className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900 tracking-tight">Upload Documents</h2>
                <p className="text-sm text-gray-500 font-medium mt-0.5">Drag and drop or click to upload</p>
              </div>
            </div>
          </div>

          {/* Upload Section - Enhanced */}
          {currentStep === 1 && (
            <div className="p-6">
              <motion.div 
                onClick={() => fileInputRef.current?.click()} 
                onDragOver={handleDragOver} 
                onDragLeave={handleDragLeave} 
                onDrop={handleDrop} 
                className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-300 ${
                  isDragOver 
                    ? 'border-indigo-400 bg-gradient-to-br from-indigo-50 to-blue-50 shadow-md' 
                    : 'border-gray-300/80 hover:border-indigo-400 hover:bg-gradient-to-br hover:from-indigo-50/50 hover:to-blue-50/30 hover:shadow-sm'
                }`} 
                whileHover={{ scale: 1.005 }}
                whileTap={{ scale: 0.995 }}
              >
                <input 
                  ref={fileInputRef} 
                  type="file" 
                  multiple 
                  accept=".pdf,.jpg,.jpeg,.png" 
                  onChange={handleFileSelect} 
                  className="hidden" 
                />

                <div className="flex flex-col items-center space-y-4">
                  <motion.div 
                    className="w-14 h-14 bg-gradient-to-br from-indigo-100 to-blue-100 rounded-xl flex items-center justify-center shadow-sm"
                    animate={{
                      scale: isDragOver ? 1.1 : 1,
                      rotate: isDragOver ? 5 : 0
                    }}
                    transition={{ duration: 0.2 }}
                  >
                    <Plus className="w-7 h-7 text-indigo-600" />
                  </motion.div>
                  
                  <div>
                    <h3 className="text-base font-bold text-gray-900 mb-1.5 tracking-tight">
                      {isDragOver ? 'Drop your files here' : 'Choose files or drag and drop'}
                    </h3>
                    <p className="text-sm text-gray-500 font-medium">
                      PDF, JPG, PNG files up to 100MB each
                    </p>
                  </div>
                </div>
              </motion.div>

              {/* Uploaded Files List - Compact */}
              <AnimatePresence>
                {uploadedFiles.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    className="mt-4 overflow-hidden"
                  >
                    <h3 className="text-sm font-bold text-gray-900 mb-4 tracking-tight">
                      Uploaded Files ({uploadedFiles.length})
                    </h3>
                    <div className="space-y-3 max-h-48 overflow-y-auto pr-3">
                      <AnimatePresence>
                        {uploadedFiles.map(file => (
                          <motion.div 
                            key={file.id}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.2 }}
                            className="flex items-center p-4 bg-gray-50 rounded-lg border border-gray-200/80 group hover:shadow-md hover:border-gray-300 transition-all duration-200"
                          >
                            <div className="flex items-center space-x-3 flex-1 min-w-0">
                              <div className="relative flex-shrink-0">
                                {file.preview ? (
                                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100">
                                    <img src={file.preview} alt={file.name} className="w-full h-full object-cover" />
                                  </div>
                                ) : (
                                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                    file.type === 'PDF' 
                                      ? 'bg-gradient-to-br from-rose-100 to-orange-100' 
                                      : 'bg-gradient-to-br from-indigo-100 to-blue-100'
                                  }`}>
                                    {file.type === 'PDF' ? (
                                      <FileText className="w-5 h-5 text-rose-600" />
                                    ) : (
                                      <Image className="w-5 h-5 text-indigo-600" />
                                    )}
                                  </div>
                                )}
                                
                                {/* Status Indicator */}
                                <div className="absolute -top-1 -right-1">
                                  {file.status === 'completed' ? (
                                    <div className="w-4 h-4 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full flex items-center justify-center shadow-sm">
                                      <Check className="w-2.5 h-2.5 text-white" />
                                    </div>
                                  ) : file.status === 'uploading' ? (
                                    <div className="w-4 h-4 bg-gradient-to-br from-indigo-500 to-blue-500 rounded-full flex items-center justify-center">
                                      <motion.div
                                        animate={{ rotate: 360 }}
                                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                        className="w-2.5 h-2.5 border border-white border-t-transparent rounded-full"
                                      />
                                    </div>
                                  ) : (
                                    <div className="w-4 h-4 bg-gradient-to-br from-rose-500 to-red-500 rounded-full flex items-center justify-center">
                                      <AlertCircle className="w-2.5 h-2.5 text-white" />
                                    </div>
                                  )}
                                </div>
                              </div>
                              
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 truncate text-sm">{file.name}</p>
                                <div className="flex items-center space-x-2 mt-0.5">
                                  <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-700">
                                    {file.type}
                                  </span>
                                  <span className="text-xs text-gray-500">{file.size}</span>
                                  {file.status === 'uploading' && (
                                    <span className="text-xs text-indigo-600 font-medium">Uploading...</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            
                            <button 
                              onClick={() => handleDelete(file.id)} 
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Processing State - Compact */}
          {(currentStep === 2 || currentStep === 3 || showCompletionTick) && (
            <div className="p-6 text-center">
              {showCompletionTick ? (
                <motion.div 
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full mx-auto mb-3 flex items-center justify-center shadow-lg shadow-emerald-500/30"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, duration: 0.3, ease: "easeOut" }}
                  >
                    <CheckCircle className="w-6 h-6 text-white" />
                  </motion.div>
                </motion.div>
              ) : (
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="w-12 h-12 border-4 border-gray-200 border-t-indigo-500 rounded-full mx-auto mb-3"
                />
              )}
              
              <p className="text-sm text-gray-600">
                {showCompletionTick 
                  ? 'Documents successfully processed!' 
                  : currentStep === 2 
                    ? 'Extracting information...' 
                    : 'AI analyzing...'}
              </p>
            </div>
          )}

          {/* Action Button - Enhanced */}
          {uploadedFiles.length > 0 && currentStep === 1 && (
            <div className="flex-shrink-0 px-6 py-5 border-t border-gray-200/60 bg-gray-50/50">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600 font-medium">
                  <span>{completedFiles.length} of {uploadedFiles.length} files ready</span>
                </div>
                
                <motion.button 
                  onClick={handleContinue} 
                  disabled={!canContinue} 
                  className={`px-6 py-2.5 rounded-lg font-bold text-white transition-all duration-200 text-sm ${
                    canContinue 
                      ? 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 shadow-md hover:shadow-lg' 
                      : 'bg-gray-300 cursor-not-allowed'
                  }`}
                  whileHover={canContinue ? { scale: 1.02 } : {}}
                  whileTap={canContinue ? { scale: 0.98 } : {}}
                >
                  Continue Analysis
                </motion.button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  // Fullscreen mode rendering (original)
  return <div className={`fixed inset-0 flex items-center justify-center overflow-hidden z-50 ${className || ''}`} style={{
    background: `
             radial-gradient(ellipse at 20% 80%, rgba(16, 185, 129, 0.3) 0%, transparent 50%),
             radial-gradient(ellipse at 80% 20%, rgba(5, 150, 105, 0.2) 0%, transparent 50%),
             radial-gradient(ellipse at 40% 60%, rgba(6, 78, 59, 0.4) 0%, transparent 50%),
             linear-gradient(135deg, #000000 0%, #1a1a1a 100%)
           `
  }}>
      {/* Flowing wave overlay */}
      <div className="absolute inset-0 opacity-60" style={{
      background: `
            radial-gradient(ellipse 800px 400px at 30% 70%, rgba(16, 185, 129, 0.4) 0%, transparent 40%),
            radial-gradient(ellipse 600px 300px at 70% 30%, rgba(5, 150, 105, 0.3) 0%, transparent 40%),
            radial-gradient(ellipse 400px 200px at 50% 50%, rgba(6, 78, 59, 0.2) 0%, transparent 40%)
          `,
      filter: 'blur(1px)'
    }} />
      <div className="w-full max-w-2xl relative z-10 px-4">
        {/* Step Indicator */}
        <div className="flex-shrink-0 flex items-center justify-center mb-8">
          <div className="flex items-center space-x-8">
            {steps.map((step, index) => <React.Fragment key={step.id}>
                <div className="flex flex-col items-center">
                  <motion.div className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-500 ${step.completed ? 'bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600 text-white shadow-2xl shadow-emerald-500/40' : step.active ? 'bg-gradient-to-br from-slate-500 via-slate-600 to-slate-700 text-white shadow-2xl shadow-slate-400/30' : 'bg-slate-700/50 border-2 border-slate-600/50 text-slate-400'}`} whileHover={{
                scale: 1.05
              }} animate={{
                scale: step.active ? [1, 1.02, 1] : 1
              }} transition={{
                scale: {
                  duration: 2,
                  repeat: step.active ? Infinity : 0,
                  ease: "easeInOut"
                }
              }}>
                    {/* Glow effect for active/completed states */}
                    {(step.completed || step.active) && <div className={`absolute inset-0 rounded-full ${step.completed ? 'bg-gradient-to-br from-emerald-400 to-emerald-600' : 'bg-gradient-to-br from-slate-500 to-slate-700'} blur-sm opacity-60 -z-10`} />}
                    
                    {step.completed ? <CheckCircle className="w-5 h-5" /> : step.id === 1 ? <Upload className="w-5 h-5" /> : step.id === 2 ? <FileText className="w-5 h-5" /> : <Camera className="w-5 h-5" />}
                  </motion.div>
                  <span className={`text-xs mt-2 font-semibold tracking-wide ${step.active || step.completed ? 'text-white' : 'text-slate-400'}`}>
                    {step.title}
                  </span>
                </div>
                {index < steps.length - 1 && <div className="flex items-center">
                    <div className={`w-16 h-1 rounded-full transition-all duration-500 ${steps[index + 1].completed ? 'bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-lg shadow-emerald-500/30' : steps[index + 1].active ? 'bg-gradient-to-r from-slate-600 to-slate-500' : 'bg-slate-700/50'}`} />
                  </div>}
              </React.Fragment>)}
          </div>
        </div>

        {/* Main Upload Card - Compact when empty, expands with content */}
        <motion.div initial={{
        opacity: 0,
        y: 20
      }} animate={{
        opacity: 1,
        y: 0
      }} className="bg-white rounded-2xl overflow-hidden"
        style={{
          boxShadow: 'none',
          border: 'none'
        }}>
          {/* Card Header */}
          <div className="flex-shrink-0 p-4 border-b border-slate-100">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-br from-indigo-100 to-blue-100 rounded-lg flex items-center justify-center">
                <Upload className="w-4 h-4 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">Property Document Upload</h2>
                <p className="text-xs text-slate-500">Upload your property documents for analysis</p>
              </div>
            </div>
          </div>

          {/* Upload Section */}
          {currentStep === 1 && <div className="p-4">
              <motion.div onClick={() => fileInputRef.current?.click()} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-200 ${isDragOver ? 'border-indigo-400 bg-gradient-to-br from-indigo-50 to-blue-50' : 'border-slate-300 hover:border-indigo-400 hover:bg-gradient-to-br hover:from-indigo-50 hover:to-blue-50/50'}`} whileHover={{
            scale: 1.01
          }} whileTap={{
            scale: 0.99
          }}>
                <input ref={fileInputRef} type="file" multiple accept="*/*" onChange={handleFileSelect} className="hidden" />

                <div className="flex flex-col items-center space-y-3">
                  <motion.div className="w-12 h-12 bg-gradient-to-br from-indigo-100 to-blue-100 rounded-xl flex items-center justify-center" animate={{
                scale: isDragOver ? 1.1 : 1,
                rotate: isDragOver ? 5 : 0
              }}>
                    <Plus className="w-6 h-6 text-indigo-600" />
                  </motion.div>
                  
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 mb-1">
                      {isDragOver ? 'Drop your files here' : 'Choose files or drag and drop'}
                    </h3>
                    <p className="text-sm text-slate-500">
                      Any document up to 100MB
                    </p>
                  </div>

                  <div className="flex items-center space-x-4 text-xs text-slate-500">
                    <div className="flex items-center space-x-1">
                      <div className="w-1.5 h-1.5 bg-gradient-to-r from-emerald-500 to-green-500 rounded-full"></div>
                      <span>Secure Upload</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <div className="w-1.5 h-1.5 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-full"></div>
                      <span>AI Analysis</span>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Uploaded Files Grid - Only show when files exist */}
              <AnimatePresence>
                {uploadedFiles.length > 0 && <motion.div initial={{
              opacity: 0,
              height: 0
            }} animate={{
              opacity: 1,
              height: "auto"
            }} exit={{
              opacity: 0,
              height: 0
            }} transition={{
              duration: 0.3
            }} className="mt-4 overflow-hidden">
                    <h3 className="text-sm font-semibold text-slate-900 mb-3">
                      Uploaded Files ({uploadedFiles.length})
                    </h3>
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300 hover:scrollbar-thumb-slate-400">
                      <AnimatePresence>
                        {uploadedFiles.map(file => <motion.div key={file.id} initial={{
                    opacity: 0,
                    scale: 0.95
                  }} animate={{
                    opacity: 1,
                    scale: 1
                  }} exit={{
                    opacity: 0,
                    scale: 0.95
                  }} className="flex items-center p-3 bg-slate-50 rounded-lg border border-slate-200 group hover:shadow-md transition-all duration-200 mr-1">
                            <div className="flex items-center space-x-3 flex-1 min-w-0">
                              <div className="relative flex-shrink-0">
                                {file.preview ? <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-100">
                                     <img src={file.preview} alt={file.name} className="w-full h-full object-cover" />
                                   </div> : <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${file.type === 'PDF' ? 'bg-gradient-to-br from-rose-100 to-orange-100' : 'bg-gradient-to-br from-indigo-100 to-blue-100'}`}>
                                     {file.type === 'PDF' ? <FileText className={`w-5 h-5 ${file.type === 'PDF' ? 'text-rose-600' : 'text-indigo-600'}`} /> : <Image className="w-5 h-5 text-indigo-600" />}
                                   </div>}
                                
                                {/* Status Indicator */}
                                 <div className="absolute -top-1 -right-1">
                                   {file.status === 'completed' ? <div className="w-4 h-4 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full flex items-center justify-center shadow-sm">
                                       <Check className="w-2.5 h-2.5 text-white" />
                                     </div> : file.status === 'uploading' ? <div className="w-4 h-4 bg-gradient-to-br from-indigo-500 to-blue-500 rounded-full flex items-center justify-center">
                                       <motion.div animate={{
                              rotate: 360
                            }} transition={{
                              duration: 1,
                              repeat: Infinity,
                              ease: "linear"
                            }} className="w-2.5 h-2.5 border border-white border-t-transparent rounded-full" />
                                     </div> : <div className="w-4 h-4 bg-gradient-to-br from-rose-500 to-red-500 rounded-full flex items-center justify-center">
                                       <AlertCircle className="w-2.5 h-2.5 text-white" />
                                     </div>}
                                 </div>
                              </div>
                              
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-slate-900 truncate text-sm">{file.name}</p>
                                 <div className="flex items-center space-x-2 mt-0.5">
                                   <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${file.type === 'PDF' ? 'bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700' : 'bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700'}`}>
                                     {file.type}
                                   </span>
                                   <span className="text-xs text-slate-500">{file.size}</span>
                                   {file.status === 'uploading' && <span className="text-xs text-indigo-600 font-medium">Uploading...</span>}
                                 </div>
                              </div>
                            </div>
                            
                            <button onClick={() => handleDelete(file.id)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </motion.div>)}
                      </AnimatePresence>
                    </div>
                  </motion.div>}
              </AnimatePresence>
            </div>}

          {/* Processing State */}
          {(currentStep === 2 || currentStep === 3 || showCompletionTick) && <div className="p-8 text-center">
              {showCompletionTick ? (
                <motion.div 
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full mx-auto mb-4 flex items-center justify-center shadow-lg shadow-emerald-500/30"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, duration: 0.3, ease: "easeOut" }}
                  >
                    <CheckCircle className="w-8 h-8 text-white" />
                  </motion.div>
                </motion.div>
              ) : (
                <motion.div animate={{
                  rotate: 360
                }} transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "linear"
                }} className="w-16 h-16 border-4 border-slate-200 border-t-indigo-500 rounded-full mx-auto mb-4" />
              )}
              
              <p className="text-slate-600 mb-3">
                {showCompletionTick ? 'Documents successfully processed!' : 
                 currentStep === 2 ? 'We\'re extracting information from your documents' : 'AI is analyzing your property details'}
              </p>
              
              {!showCompletionTick && (
                <div className="bg-emerald-700 border border-emerald-500 rounded-lg p-3 mx-auto max-w-md">
                  <p className="text-sm text-slate-200 font-medium">
                    💡 You can leave this screen and continue working
                  </p>
                  <p className="text-xs text-slate-300 mt-1">
                    We'll notify you when the analysis is complete
                  </p>
                </div>
              )}
            </div>}

          {/* Action Buttons - Only show when files exist */}
          {uploadedFiles.length > 0 && currentStep === 1 && <div className="flex-shrink-0 p-4 border-t border-slate-100 bg-slate-50">
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-500">
                  <span>{completedFiles.length} of {uploadedFiles.length} files ready</span>
                </div>
                
                <motion.button onClick={handleContinue} disabled={!canContinue} className={`px-4 py-2 rounded-lg font-semibold text-white transition-all duration-200 text-sm ${canContinue ? 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 shadow-lg hover:shadow-xl' : 'bg-slate-300 cursor-not-allowed'}`} whileHover={canContinue ? {
              scale: 1.02
            } : {}} whileTap={canContinue ? {
              scale: 0.98
            } : {}}>
                  Continue Analysis
                </motion.button>
              </div>
            </div>}
        </motion.div>
      </div>
    </div>;
}
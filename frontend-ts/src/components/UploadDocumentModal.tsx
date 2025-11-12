/**
 * UploadDocumentModal Component
 * Professional center modal for document upload
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, FileText, Image, Plus, CheckCircle, AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import PropertyValuationUpload from './PropertyValuationUpload';

interface UploadDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (file: File) => void;
  onContinueWithReport?: () => void;
}

export const UploadDocumentModal: React.FC<UploadDocumentModalProps> = ({
  isOpen,
  onClose,
  onUpload,
  onContinueWithReport
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        <div className="flex flex-col">
          {/* Header */}
          <div className="px-6 py-5 border-b border-gray-200 bg-white">
            <div className="flex items-center justify-between">
              <DialogHeader>
                <DialogTitle className="text-2xl font-bold text-gray-900">
                  Upload Documents
                </DialogTitle>
              </DialogHeader>
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mt-2 font-medium">
              Upload property documents for analysis and processing
            </p>
          </div>

          {/* Upload Component */}
          <div className="p-6 bg-white">
            <PropertyValuationUpload 
              compact={true}
              onUpload={onUpload}
              onContinueWithReport={() => {
                onContinueWithReport?.();
                onClose();
              }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};


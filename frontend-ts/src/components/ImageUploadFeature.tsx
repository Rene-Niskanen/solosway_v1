"use client";

import * as React from "react";
import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, X, Loader2, Image as ImageIcon, FileText } from "lucide-react";
import { ocrService } from '../services/ocrService';

export interface ImageUploadFeatureProps {
  onImageProcessed?: (searchQuery: string) => void;
  onClose?: () => void;
  isVisible?: boolean;
}

export const ImageUploadFeature = ({
  onImageProcessed,
  onClose,
  isVisible = false
}: ImageUploadFeatureProps) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [ocrStatus, setOcrStatus] = useState<{ available: boolean; service: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check OCR service status on component mount
  React.useEffect(() => {
    setOcrStatus(ocrService.getStatus());
  }, []);

  // Real OCR processing using Google Cloud Vision API
  const processImageWithOCR = async (imageFile: File): Promise<string> => {
    try {
      const result = await ocrService.extractTextFromImage(imageFile);
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      return result.text;
    } catch (error) {
      console.error('OCR processing failed:', error);
      throw error;
    }
  };

  // Mock AI processing to convert extracted text to search query
  const generateSearchQuery = async (extractedText: string): Promise<string> => {
    // Simulate AI processing delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Mock AI processing - extract key property details
    const bedrooms = extractedText.match(/(\d+)\s*bed/i)?.[1] || "";
    const location = extractedText.match(/in\s+([^,]+)/i)?.[1] || "";
    const price = extractedText.match(/£([\d,]+)/)?.[1] || "";
    
    let query = "";
    if (bedrooms) query += `${bedrooms} bed `;
    if (location) query += `in ${location} `;
    if (price) query += `under £${price}`;
    
    return query.trim() || "property search";
  };

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    setIsProcessing(true);
    
    try {
      // Create image preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setUploadedImage(e.target?.result as string);
      };
      reader.readAsDataURL(file);

      // Process image with OCR
      const extracted = await processImageWithOCR(file);
      setExtractedText(extracted);

      // Generate search query
      const query = await generateSearchQuery(extracted);
      setSearchQuery(query);
      
    } catch (error) {
      console.error('Error processing image:', error);
      alert('Error processing image. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleUseQuery = () => {
    if (searchQuery && onImageProcessed) {
      onImageProcessed(searchQuery);
      handleClose();
    }
  };

  const handleClose = () => {
    setUploadedImage(null);
    setExtractedText("");
    setSearchQuery("");
    setIsProcessing(false);
    if (onClose) onClose();
  };

  const handleRetake = () => {
    setUploadedImage(null);
    setExtractedText("");
    setSearchQuery("");
    setIsProcessing(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (!isVisible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={handleClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-200">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <ImageIcon className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Property Screenshot Analysis</h2>
                <p className="text-sm text-slate-600">Upload a screenshot to extract property details</p>
                {ocrStatus && (
                  <div className="flex items-center space-x-2 mt-1">
                    <div className={`w-2 h-2 rounded-full ${ocrStatus.available ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
                    <span className="text-xs text-slate-500">{ocrStatus.service}</span>
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4 text-slate-600" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {!uploadedImage ? (
              /* Upload Area */
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                  isDragOver 
                    ? 'border-blue-400 bg-blue-50' 
                    : 'border-slate-300 hover:border-slate-400'
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                <div className="space-y-4">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto">
                    <Upload className="w-8 h-8 text-slate-600" />
                  </div>
                  
                  <div>
                    <h3 className="text-lg font-medium text-slate-900 mb-2">
                      Drop your screenshot here
                    </h3>
                    <p className="text-slate-600 mb-4">
                      Upload a screenshot from Rightmove, Zoopla, or any property listing
                    </p>
                  </div>

                  <div className="space-y-3">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                    >
                      Choose File
                    </button>
                    <p className="text-sm text-slate-500">
                      or drag and drop your image
                    </p>
                  </div>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
              </div>
            ) : (
              /* Results Area */
              <div className="space-y-6">
                {/* Image Preview */}
                <div className="relative">
                  <img
                    src={uploadedImage}
                    alt="Uploaded property screenshot"
                    className="w-full h-48 object-cover rounded-lg border border-slate-200"
                  />
                  {isProcessing && (
                    <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                      <div className="flex items-center space-x-3 text-white">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>Processing image...</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Extracted Text */}
                {extractedText && (
                  <div className="space-y-3">
                    <div className="flex items-center space-x-2">
                      <FileText className="w-4 h-4 text-slate-600" />
                      <h4 className="font-medium text-slate-900">Extracted Text:</h4>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-4">
                      <p className="text-sm text-slate-700 leading-relaxed">{extractedText}</p>
                    </div>
                  </div>
                )}

                {/* Generated Search Query */}
                {searchQuery && (
                  <div className="space-y-3">
                    <h4 className="font-medium text-slate-900">Generated Search Query:</h4>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <p className="text-blue-900 font-medium">{searchQuery}</p>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                  <button
                    onClick={handleRetake}
                    className="px-4 py-2 text-slate-600 hover:text-slate-800 transition-colors"
                  >
                    Upload Different Image
                  </button>
                  
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={handleClose}
                      className="px-4 py-2 text-slate-600 hover:text-slate-800 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleUseQuery}
                      disabled={!searchQuery}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors font-medium"
                    >
                      Use This Search
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ImageUploadFeature;

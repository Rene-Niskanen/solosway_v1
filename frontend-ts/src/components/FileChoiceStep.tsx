"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Zap, BookOpen, FolderPlus, FileText, Loader2 } from "lucide-react";
import { FileAttachmentData } from "./FileAttachment";

export type ResponseModeChoice = 'fast' | 'detailed' | 'project';

export interface FileChoiceStepProps {
  attachedFiles: FileAttachmentData[];
  onChoice: (choice: ResponseModeChoice) => void;
  isVisible: boolean;
  isDisabled?: boolean;
}

/**
 * FileChoiceStep - Response mode selection UI for file attachments
 * 
 * Appears in the reasoning steps when a user submits a query with attached files.
 * Offers three choices:
 * 1. Fast Response - Quick answer using extracted text (no citations)
 * 2. Detailed Citations - Page-referenced answer
 * 3. Add to Project - Full processing + citations that link to document
 */
export const FileChoiceStep: React.FC<FileChoiceStepProps> = ({
  attachedFiles,
  onChoice,
  isVisible,
  isDisabled = false
}) => {
  const [selectedChoice, setSelectedChoice] = React.useState<ResponseModeChoice | null>(null);
  
  // Check if any files are still extracting
  const isExtracting = attachedFiles.some(f => f.extractionStatus === 'extracting' || f.extractionStatus === 'pending');
  const hasExtractionError = attachedFiles.some(f => f.extractionStatus === 'error');
  const hasExtractedText = attachedFiles.some(f => f.extractedText && f.extractedText.length > 0);
  
  // Get summary of attached files
  const fileCount = attachedFiles.length;
  const totalPages = attachedFiles.reduce((sum, f) => sum + (f.pageCount || 0), 0);
  const totalChars = attachedFiles.reduce((sum, f) => sum + (f.extractedText?.length || 0), 0);
  
  const handleChoice = (choice: ResponseModeChoice) => {
    if (isDisabled || isExtracting) return;
    setSelectedChoice(choice);
    onChoice(choice);
  };

  if (!isVisible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      style={{
        padding: '12px 0',
        marginTop: '8px'
      }}
    >
      {/* Question text */}
      <div style={{
        fontSize: '13px',
        color: '#374151',
        marginBottom: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        <FileText size={14} style={{ color: '#6B7280' }} />
        <span>
          {isExtracting ? (
            <>
              <Loader2 size={12} style={{ display: 'inline', marginRight: '4px', animation: 'spin 1s linear infinite' }} />
              Analyzing {fileCount} {fileCount === 1 ? 'file' : 'files'}...
            </>
          ) : hasExtractedText ? (
            <>
              Analyzed {fileCount} {fileCount === 1 ? 'file' : 'files'} 
              {totalPages > 0 && <span style={{ color: '#9CA3AF' }}> ({totalPages} pages)</span>}
              {' - How would you like to proceed?'}
            </>
          ) : hasExtractionError ? (
            <>Could not extract text from {fileCount === 1 ? 'file' : 'files'}. Please try a different file.</>
          ) : (
            <>Select how to use the attached {fileCount === 1 ? 'file' : 'files'}:</>
          )}
        </span>
      </div>

      {/* Choice buttons */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}>
        {/* Fast Response */}
        <motion.button
          whileHover={{ scale: isDisabled || isExtracting ? 1 : 1.01 }}
          whileTap={{ scale: isDisabled || isExtracting ? 1 : 0.99 }}
          onClick={() => handleChoice('fast')}
          disabled={isDisabled || isExtracting || !hasExtractedText}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 14px',
            border: selectedChoice === 'fast' ? '2px solid #10B981' : '1px solid #E5E7EB',
            borderRadius: '8px',
            background: selectedChoice === 'fast' ? '#ECFDF5' : '#FFFFFF',
            cursor: isDisabled || isExtracting || !hasExtractedText ? 'not-allowed' : 'pointer',
            opacity: isDisabled || isExtracting || !hasExtractedText ? 0.5 : 1,
            transition: 'all 0.15s ease',
            textAlign: 'left'
          }}
        >
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '6px',
            background: '#D1FAE5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <Zap size={16} style={{ color: '#059669' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>
              Fast Response
            </div>
            <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '2px' }}>
              Quick answer without citations
            </div>
          </div>
        </motion.button>

        {/* Detailed Citations */}
        <motion.button
          whileHover={{ scale: isDisabled || isExtracting ? 1 : 1.01 }}
          whileTap={{ scale: isDisabled || isExtracting ? 1 : 0.99 }}
          onClick={() => handleChoice('detailed')}
          disabled={isDisabled || isExtracting || !hasExtractedText}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 14px',
            border: selectedChoice === 'detailed' ? '2px solid #3B82F6' : '1px solid #E5E7EB',
            borderRadius: '8px',
            background: selectedChoice === 'detailed' ? '#EFF6FF' : '#FFFFFF',
            cursor: isDisabled || isExtracting || !hasExtractedText ? 'not-allowed' : 'pointer',
            opacity: isDisabled || isExtracting || !hasExtractedText ? 0.5 : 1,
            transition: 'all 0.15s ease',
            textAlign: 'left'
          }}
        >
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '6px',
            background: '#DBEAFE',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <BookOpen size={16} style={{ color: '#2563EB' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>
              Detailed with Page References
            </div>
            <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '2px' }}>
              Answer with (Page X) citations
            </div>
          </div>
        </motion.button>

        {/* Add to Project */}
        <motion.button
          whileHover={{ scale: isDisabled || isExtracting ? 1 : 1.01 }}
          whileTap={{ scale: isDisabled || isExtracting ? 1 : 0.99 }}
          onClick={() => handleChoice('project')}
          disabled={isDisabled || isExtracting}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 14px',
            border: selectedChoice === 'project' ? '2px solid #8B5CF6' : '1px solid #E5E7EB',
            borderRadius: '8px',
            background: selectedChoice === 'project' ? '#F5F3FF' : '#FFFFFF',
            cursor: isDisabled || isExtracting ? 'not-allowed' : 'pointer',
            opacity: isDisabled || isExtracting ? 0.5 : 1,
            transition: 'all 0.15s ease',
            textAlign: 'left'
          }}
        >
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '6px',
            background: '#EDE9FE',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <FolderPlus size={16} style={{ color: '#7C3AED' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>
              Add to Project & Get Citations
            </div>
            <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '2px' }}>
              Full processing with clickable citations
            </div>
          </div>
        </motion.button>
      </div>

      {/* Processing indicator */}
      {isExtracting && (
        <div style={{
          marginTop: '10px',
          fontSize: '11px',
          color: '#9CA3AF',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#10B981',
            animation: 'pulse 1.5s ease-in-out infinite'
          }} />
          Extracting text from documents...
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
    </motion.div>
  );
};

export default FileChoiceStep;


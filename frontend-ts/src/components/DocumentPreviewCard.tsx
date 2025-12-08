import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, File, FileSpreadsheet, Image } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';

// Vite handles this import and returns the correct URL for the worker
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set worker source immediately at module load time
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface DocumentMetadata {
  doc_id: string;
  original_filename: string;
  classification_type: string;
  page_range?: string;
  page_numbers?: number[];
  s3_path?: string;
  download_url?: string;
}

interface DocumentPreviewCardProps {
  metadata: DocumentMetadata;
  onClick?: () => void;
}

// Ultra-subtle loading indicator - OpenAI style
const LoadingIndicator: React.FC = () => (
  <div
    style={{
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: '#E4E7EB',
      flexShrink: 0,
      position: 'relative',
      overflow: 'hidden',
      opacity: 0.6
    }}
  >
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.8) 50%, transparent 100%)',
        animation: 'shimmer-sweep 2s ease-in-out infinite'
      }}
    />
  </div>
);

// Get file icon based on extension - OpenAI style refined icons
const getFileIcon = (filename: string, size: number = 13) => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const style = { color: '#8E94A0', opacity: 0.75, strokeWidth: 1.5 };
  
  if (['pdf'].includes(ext)) {
    return <FileText size={size} style={style} />;
  }
  if (['doc', 'docx'].includes(ext)) {
    return <FileText size={size} style={style} />;
  }
  if (['xls', 'xlsx', 'csv'].includes(ext)) {
    return <FileSpreadsheet size={size} style={style} />;
  }
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
    return <Image size={size} style={style} />;
  }
  
  return <File size={size} style={style} />;
};

/**
 * Render PDF first page as thumbnail image
 */
const renderPdfThumbnail = async (arrayBuffer: ArrayBuffer): Promise<string | null> => {
  try {
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return null;
    
    const viewport = page.getViewport({ scale: 0.5 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    // PDF.js v5 requires both canvas and canvasContext
    await page.render({
      canvasContext: context,
      viewport: viewport,
      canvas: canvas
    } as any).promise;
    
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch (error) {
    console.warn('Failed to render PDF thumbnail:', error);
    return null;
  }
};

/**
 * DocumentPreviewCard Component
 * 
 * A vertical card with title on top and full-width document preview below.
 * Shows loading animation + filename + actual document preview.
 */
export const DocumentPreviewCard: React.FC<DocumentPreviewCardProps> = ({ metadata, onClick }) => {
  const { doc_id, original_filename, s3_path, download_url } = metadata;
  
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfThumbnail, setPdfThumbnail] = useState<string | null>(null);
  
  // Determine file type
  const isImage = original_filename?.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp)$/i);
  const isPDF = original_filename?.toLowerCase().endsWith('.pdf');
  
  // Fetch document and generate preview
  useEffect(() => {
    if (!doc_id) {
      setLoading(false);
      return;
    }
    
    // Check cache first
    const cached = (window as any).__preloadedDocumentCovers?.[doc_id];
    if (cached?.thumbnailUrl) {
      console.log('📄 Using cached PDF thumbnail for:', original_filename);
      setPdfThumbnail(cached.thumbnailUrl);
      setLoading(false);
      return;
    }
    if (cached?.url && isImage) {
      console.log('🖼️ Using cached image for:', original_filename);
      setPreviewUrl(cached.url);
      setLoading(false);
      return;
    }
    
    // Fetch the document
    const fetchPreview = async () => {
      try {
        const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
        let fetchUrl: string;
        
        if (download_url) {
          fetchUrl = download_url.startsWith('http') ? download_url : `${backendUrl}${download_url}`;
        } else if (s3_path) {
          fetchUrl = `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(s3_path)}`;
        } else {
          fetchUrl = `${backendUrl}/api/files/download?document_id=${doc_id}`;
        }
        
        console.log('📥 Fetching document preview:', original_filename, 'Type:', isPDF ? 'PDF' : isImage ? 'Image' : 'Other');
        
        const response = await fetch(fetchUrl, {
          credentials: 'include'
        });
        
        if (!response.ok) {
          console.warn('❌ Failed to fetch document:', response.status, response.statusText);
          setLoading(false);
          return;
        }
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        console.log('✅ Fetched document blob:', original_filename, 'Size:', blob.size, 'Type:', blob.type);
        
        // Cache for future use
        if (!(window as any).__preloadedDocumentCovers) {
          (window as any).__preloadedDocumentCovers = {};
        }
        
        if (isPDF) {
          // Render PDF first page as thumbnail
          try {
            console.log('🔄 Generating PDF thumbnail for:', original_filename);
            const arrayBuffer = await blob.arrayBuffer();
            const thumbnailUrl = await renderPdfThumbnail(arrayBuffer);
            
            if (thumbnailUrl) {
              console.log('✅ PDF thumbnail generated successfully:', original_filename);
              setPdfThumbnail(thumbnailUrl);
              
              // Cache the thumbnail
              (window as any).__preloadedDocumentCovers[doc_id] = {
                url: url,
                thumbnailUrl: thumbnailUrl,
                type: blob.type,
                timestamp: Date.now()
              };
            } else {
              console.warn('⚠️ PDF thumbnail generation returned null for:', original_filename);
            }
          } catch (pdfError) {
            console.error('❌ Failed to generate PDF thumbnail:', pdfError);
          }
        } else if (isImage) {
          console.log('🖼️ Setting image preview URL for:', original_filename);
          setPreviewUrl(url);
          (window as any).__preloadedDocumentCovers[doc_id] = {
            url: url,
            type: blob.type,
            timestamp: Date.now()
          };
        } else {
          console.log('📄 Non-image/PDF file, showing icon only:', original_filename);
        }
        
        setLoading(false);
      } catch (err) {
        console.error('❌ Failed to fetch document preview:', err);
        setLoading(false);
      }
    };
    
    fetchPreview();
  }, [doc_id, s3_path, download_url, isPDF, isImage, original_filename]);
  
  // Determine what to show in the thumbnail
  const thumbnailSrc = pdfThumbnail || (isImage && previewUrl ? previewUrl : null);
  
  // Debug logging
  useEffect(() => {
    if (thumbnailSrc) {
      console.log('🖼️ Thumbnail source available for:', original_filename, 'Type:', pdfThumbnail ? 'PDF thumbnail' : 'Image URL');
    } else if (!loading) {
      console.log('📄 No thumbnail, showing icon for:', original_filename, 'isPDF:', isPDF, 'isImage:', isImage);
    }
  }, [thumbnailSrc, loading, original_filename, isPDF, isImage, pdfThumbnail]);
  
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ 
          duration: 0.2, 
          ease: [0.16, 1, 0.3, 1]
        }}
        onClick={onClick}
        style={{
          display: 'flex',
          flexDirection: 'column',
          marginTop: '6px',
          marginLeft: '0',
          backgroundColor: '#FFFFFF',
          borderRadius: '12px',
          border: '1px solid rgba(0, 0, 0, 0.08)',
          cursor: onClick ? 'pointer' : 'default',
          width: '100%',
          maxWidth: '340px',
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.04)',
          transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          overflow: 'hidden'
        }}
        whileHover={onClick ? {
          borderColor: 'rgba(0, 0, 0, 0.12)',
          boxShadow: '0 4px 12px 0 rgba(0, 0, 0, 0.08), 0 2px 4px -1px rgba(0, 0, 0, 0.04)',
          transform: 'translateY(-1px)'
        } : undefined}
      >
        {/* Header with filename and loading indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 12px',
            borderBottom: '1px solid rgba(0, 0, 0, 0.04)',
            backgroundColor: '#2D2D2D'
          }}
        >
          {/* Loading spinner */}
          {loading && (
            <div
              style={{
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                border: '2px solid rgba(255, 255, 255, 0.2)',
                borderTopColor: '#888888',
                animation: 'doc-spinner 0.8s linear infinite',
                flexShrink: 0
              }}
            />
          )}
          
          {/* Document Filename */}
          <span
            style={{
              fontSize: '12px',
              fontWeight: 500,
              color: '#888888',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              letterSpacing: '-0.01em',
              lineHeight: '1.4',
              flex: 1
            }}
          >
            {original_filename}
          </span>
        </div>
        
        {/* Full-width Document Preview Area */}
        <div
          style={{
            width: '100%',
            height: '100px',
            overflow: 'hidden',
            backgroundColor: '#FFFFFF',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            position: 'relative'
          }}
        >
          {loading ? (
            <div style={{
              width: '100%',
              height: '100%',
              background: 'linear-gradient(90deg, #F5F5F5 0%, #EBEBEB 50%, #F5F5F5 100%)',
              backgroundSize: '200% 100%',
              animation: 'preview-shimmer 1.5s ease-in-out infinite'
            }} />
          ) : thumbnailSrc ? (
            <img
              src={thumbnailSrc}
              alt=""
              style={{
                width: '100%',
                height: 'auto',
                objectFit: 'cover',
                objectPosition: 'top center',
                transform: 'scale(1.02)',
                transformOrigin: 'top center'
              }}
              onLoad={() => console.log('✅ Thumbnail image loaded successfully:', original_filename)}
              onError={(e) => {
                console.error('❌ Failed to load thumbnail image:', original_filename, e);
                setPdfThumbnail(null);
                setPreviewUrl(null);
              }}
            />
          ) : (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              width: '100%',
              backgroundColor: '#F9FAFB',
              gap: '8px'
            }}>
              {getFileIcon(original_filename, 32)}
              <span style={{
                fontSize: '10px',
                color: '#9CA3AF',
                fontWeight: 500
              }}>
                Preview not available
              </span>
            </div>
          )}
        </div>
      </motion.div>
      
      <style>{`
        @keyframes preview-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes doc-spinner {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes shimmer-sweep {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </>
  );
};

/**
 * StackedDocumentPreviews Component
 * 
 * Displays multiple documents in a compact stacked layout with light cards
 * matching the background. No preview image - just document names with outlines.
 * 
 * Used for the final response state to save vertical space.
 */
export const StackedDocumentPreviews: React.FC<{
  documents: Array<{
    doc_id: string;
    original_filename: string;
    classification_type: string;
    page_range?: string;
    page_numbers?: number[];
    s3_path?: string;
    download_url?: string;
  }>;
  onDocumentClick?: (metadata: any) => void;
  isAnimating?: boolean; // True when transitioning from spread to stacked
}> = ({ documents, onDocumentClick, isAnimating = false }) => {
  
  if (documents.length === 0) return null;
  
  return (
    <motion.div
      initial={isAnimating ? { 
        opacity: 0,
        scale: 0.95,
        y: 10
      } : false}
      animate={{ 
        opacity: 1,
        scale: 1,
        y: 0
      }}
      transition={{ 
        duration: 0.4, 
        delay: isAnimating ? 0.2 : 0,
        ease: [0.16, 1, 0.3, 1] 
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        marginTop: '4px',
        width: '100%',
        maxWidth: '340px',
        gap: '4px' // Subtle space between stacked cards
      }}
    >
      {/* Stacked Document Headers - Light cards matching background */}
      {documents.map((doc, index) => {
        const totalDocs = documents.length;
        // Stacking animation: cards drop in from above with staggered timing
        // Higher cards drop from further away for a cascading effect
        const dropDistance = (totalDocs - index) * 25;
        
        return (
          <motion.div
            key={doc.doc_id || `stacked-doc-${index}`}
            initial={isAnimating ? { 
              y: -dropDistance - 40, 
              opacity: 0,
              scale: 0.8,
              rotateZ: -2 // Slight rotation for dynamic effect
            } : false}
            animate={{ 
              y: 0, 
              opacity: 1,
              scale: 1,
              rotateZ: 0
            }}
            transition={{ 
              duration: 0.5, 
              delay: isAnimating ? index * 0.1 : 0,
              ease: [0.34, 1.56, 0.64, 1] // Bouncy spring effect
            }}
            onClick={() => onDocumentClick?.(doc)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 12px',
              backgroundColor: 'transparent', // Match background
              borderRadius: '6px',
              border: '1px solid rgba(0, 0, 0, 0.1)', // Subtle outline
              cursor: onDocumentClick ? 'pointer' : 'default',
              transition: 'all 0.15s ease'
            }}
            whileHover={onDocumentClick ? { 
              backgroundColor: 'rgba(0, 0, 0, 0.03)',
              borderColor: 'rgba(0, 0, 0, 0.15)'
            } : undefined}
          >
            {/* File icon */}
            <div style={{ flexShrink: 0, opacity: 0.5 }}>
              {getFileIcon(doc.original_filename, 14)}
            </div>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 400,
                color: '#6B7280', // Grey text matching other UI
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                letterSpacing: '-0.01em',
                lineHeight: '1.4',
                flex: 1
              }}
            >
              {doc.original_filename}
            </span>
          </motion.div>
        );
      })}
    </motion.div>
  );
};

export default DocumentPreviewCard;

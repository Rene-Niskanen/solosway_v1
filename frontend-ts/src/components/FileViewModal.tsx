"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Download, Loader2, BookOpen } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { backendApi } from '../services/backendApi';
import { getDocumentBlobUrl, setDocumentBlobUrl } from '../services/documentBlobCache';
import {
  mapPipelineProgressToStages,
  PipelineStagesDetail,
  type PipelineProgressData,
} from './PipelineStagesHoverPreview';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const POPUP_BG = '#6F6F6F';

const KEY_FACT_VALUE_MAX_LENGTH = 60;

export interface FileViewDocument {
  id: string;
  original_filename: string;
  file_type?: string;
  file_size?: number;
  created_at?: string;
  updated_at?: string;
  property_id?: string;
  folder_id?: string;
  s3_path?: string;
  status?: string;
}

export interface KeyFact {
  label: string;
  value: string;
}

interface FileViewModalProps {
  document: FileViewDocument | null;
  isOpen: boolean;
  onClose: () => void;
  onViewDocument: (docId: string, filename: string) => void;
  onAnalyseWithAI: (docId: string, filename: string) => void;
  /** Ref to an element (e.g. FilingSidebar container) that should NOT close the modal when clicked */
  clickOutsideExcludeRef?: React.RefObject<HTMLElement | null>;
  /** Display name for uploader (fallback when backend doesn't return user) */
  uploaderName?: string;
  /** Avatar URL or placeholder */
  uploaderAvatarUrl?: string | null;
  /** Job title / role from user profile (e.g. "Property Manager", "Senior Product Engineer") */
  uploaderTitle?: string | null;
}

export const FileViewModal: React.FC<FileViewModalProps> = ({
  document: doc,
  isOpen,
  onClose,
  onViewDocument,
  onAnalyseWithAI,
  clickOutsideExcludeRef,
  uploaderName = 'User',
  uploaderAvatarUrl = null,
  uploaderTitle = null,
}) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  /** Key facts from backend (address, type, parties); null = not loaded, [] = loaded but empty */
  const [keyFacts, setKeyFacts] = useState<KeyFact[] | null>(null);
  /** Narrative summary paragraph from backend; null = not loaded or not available */
  const [keyFactsSummary, setKeyFactsSummary] = useState<string | null>(null);
  const [keyFactsLoading, setKeyFactsLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // View details: pipeline stages modal
  const [showPipelineModal, setShowPipelineModal] = useState(false);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [pipelineProgress, setPipelineProgress] = useState<PipelineProgressData | null>(null);

  // File size resolved from blob when doc.file_size is missing (e.g. older records)
  const [resolvedFileSize, setResolvedFileSize] = useState<number | null>(null);

  const lastDocIdRef = useRef<string | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  const exitingDocRef = useRef<FileViewDocument | null>(null);
  const modalContainerRef = useRef<HTMLDivElement | null>(null);
  const pipelineModalRef = useRef<HTMLDivElement | null>(null);

  const formatDate = useCallback((dateStr: string | undefined) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '—';
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    } catch {
      return '—';
    }
  }, []);

  const formatFileSize = useCallback((bytes: number | undefined): string => {
    if (bytes == null || bytes === 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  const displayFileType = doc?.file_type
    ? (doc.file_type.includes('/') ? doc.file_type.split('/').pop()?.toUpperCase() ?? doc.file_type : doc.file_type)
    : '—';

  const displayFileSize = formatFileSize(doc?.file_size ?? resolvedFileSize ?? undefined);
  const lastUpdated = doc?.updated_at || doc?.created_at;

  // Fetch file blob (use cache if preloaded) and create object URL
  useEffect(() => {
    if (!isOpen || !doc) {
      setPreviewUrl(null);
      setPdfDocument(null);
      setTotalPages(1);
      setCurrentPage(1);
      setKeyFacts(null);
      setKeyFactsSummary(null);
      setKeyFactsLoading(false);
      setError(null);
      setResolvedFileSize(null);
      lastDocIdRef.current = null;
      return;
    }
    if (lastDocIdRef.current === doc.id) return;
    lastDocIdRef.current = doc.id;
    setResolvedFileSize(null);

    const cachedUrl = getDocumentBlobUrl(doc.id);
    if (cachedUrl) {
      setPreviewUrl(cachedUrl);
      setLoading(false);
      setError(null);
      if (doc.file_size == null || doc.file_size === 0) {
        const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
        const headUrl = doc.s3_path
          ? `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(doc.s3_path)}`
          : `${backendUrl}/api/files/download?document_id=${doc.id}`;
        fetch(headUrl, { method: 'HEAD', credentials: 'include' })
          .then((res) => {
            const len = res.headers.get('Content-Length');
            if (len != null) setResolvedFileSize(parseInt(len, 10));
          })
          .catch(() => {});
      }
      return;
    }

    setLoading(true);
    setError(null);
    let objectUrl: string | null = null;

    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
    const downloadUrl = doc.s3_path
      ? `${backendUrl}/api/files/download?s3_path=${encodeURIComponent(doc.s3_path)}`
      : `${backendUrl}/api/files/download?document_id=${doc.id}`;

    fetch(downloadUrl, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('Download failed');
        return res.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setDocumentBlobUrl(doc.id, objectUrl);
        setPreviewUrl(objectUrl);
        if (doc.file_size == null || doc.file_size === 0) setResolvedFileSize(blob.size);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load document');
        setLoading(false);
      });

    return () => {
      if (objectUrl && !getDocumentBlobUrl(doc.id)) URL.revokeObjectURL(objectUrl);
    };
  }, [isOpen, doc?.id, doc?.s3_path]);

  // Load PDF and render single page (defer one frame so modal shell paints first)
  useEffect(() => {
    if (!previewUrl || !doc || loading) return;

    const isPdf = (doc.file_type || '').toLowerCase().includes('pdf');
    if (!isPdf) {
      setPdfDocument(null);
      setTotalPages(1);
      return;
    }

    let cancelled = false;
    const frameId = requestAnimationFrame(() => {
      if (cancelled) return;
      const loadPdf = async () => {
        try {
          const loadingTask = pdfjs.getDocument({ url: previewUrl });
          const pdf = await loadingTask.promise;
          if (cancelled) {
            pdf.destroy();
            return;
          }
          setPdfDocument(pdf);
          setTotalPages(pdf.numPages);
          setCurrentPage(1);
        } catch (e) {
          console.error('Failed to load PDF:', e);
          if (!cancelled) setError('Failed to load PDF');
        }
      };
      loadPdf();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [previewUrl, doc?.id, doc?.file_type, loading]);

  // Fetch key facts when modal opens with a document
  useEffect(() => {
    if (!isOpen || !doc) return;
    setKeyFactsLoading(true);
    setKeyFacts(null);
    setKeyFactsSummary(null);
    let cancelled = false;
    backendApi
      .getDocumentKeyFacts(doc.id)
      .then((res) => {
        if (cancelled) return;
        setKeyFactsLoading(false);
        if (res.success && res.data) {
          setKeyFacts(res.data.key_facts);
          setKeyFactsSummary(res.data.summary ?? null);
        } else {
          setKeyFacts([]);
          setKeyFactsSummary(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setKeyFactsLoading(false);
          setKeyFacts([]);
          setKeyFactsSummary(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, doc?.id]);

  useEffect(() => {
    if (!pdfDocument || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 0 || height <= 0) return;

    // Use devicePixelRatio for sharp rendering on retina/high-DPI (cap at 3 to avoid huge canvases)
    const pixelRatio = Math.min(window.devicePixelRatio || 2, 3);

    let cancelled = false;
    pdfDocument.getPage(currentPage).then((page) => {
      if (cancelled) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const scaleToFit = Math.min(width / baseViewport.width, height / baseViewport.height);
      const scale = scaleToFit * pixelRatio;
      const viewport = page.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      page.render({ canvasContext: ctx, viewport, canvas }).promise.then(() => {}).catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [pdfDocument, currentPage]);

  const handlePrevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
  const handleNextPage = () => setCurrentPage((p) => Math.min(totalPages, p + 1));

  const handleDownload = useCallback(() => {
    if (!previewUrl || !doc) return;
    const a = document.createElement('a');
    a.href = previewUrl;
    a.download = doc.original_filename || 'document.pdf';
    a.click();
  }, [previewUrl, doc]);

  const handleViewDocument = () => {
    if (!doc) return;
    onViewDocument(doc.id, doc.original_filename);
    onClose();
  };

  const handleAnalyseWithAI = () => {
    if (!doc) return;
    onAnalyseWithAI(doc.id, doc.original_filename);
    onClose();
  };

  const handleViewDetails = async () => {
    if (!doc) return;
    setShowPipelineModal(true);
    setPipelineLoading(true);
    setPipelineProgress(null);
    try {
      const res = await backendApi.getDocumentStatus(doc.id);
      if (res?.success && res?.data) {
        const data = res.data as { pipeline_progress?: PipelineProgressData; status?: string };
        setPipelineProgress(data.pipeline_progress ?? null);
      }
    } catch (e) {
      console.error('Failed to fetch document status:', e);
    } finally {
      setPipelineLoading(false);
    }
  };

  const pipelineState = doc
    ? mapPipelineProgressToStages(pipelineProgress, doc.status)
    : { completedStages: 0, currentStageIndex: null };
  const isPipelineComplete = pipelineState.completedStages === 5;

  // Focus pipeline modal when opened (accessibility: focus trap start)
  useEffect(() => {
    if (showPipelineModal && pipelineModalRef.current) {
      pipelineModalRef.current.focus();
    }
  }, [showPipelineModal]);

  // Reset exiting when opened; capture doc when starting exit so we can render during animation
  useEffect(() => {
    if (isOpen) {
      setIsExiting(false);
      exitingDocRef.current = null;
    }
  }, [isOpen]);

  const handleCloseRequest = useCallback(() => {
    if (isExiting) return;
    exitingDocRef.current = doc;
    setIsExiting(true);
  }, [doc, isExiting]);

  const handleAnimationComplete = useCallback(() => {
    if (isExiting) {
      setIsExiting(false);
      exitingDocRef.current = null;
      onClose();
    }
  }, [isExiting, onClose]);

  const visible = isOpen || isExiting;

  // Click-outside-to-close (allows hover to pass through to sidebar when overlay uses pointer-events: none)
  // Clicks inside clickOutsideExcludeRef (e.g. FilingSidebar) do not close so user can switch documents
  useEffect(() => {
    if (!visible) return;
    const handleDocumentClick = (e: MouseEvent) => {
      if (isExiting) return;
      const target = e.target as Node;
      if (clickOutsideExcludeRef?.current?.contains(target)) return;
      if (modalContainerRef.current && !modalContainerRef.current.contains(target)) {
        handleCloseRequest();
      }
    };
    document.addEventListener('click', handleDocumentClick, true);
    return () => document.removeEventListener('click', handleDocumentClick, true);
  }, [visible, isExiting, handleCloseRequest, clickOutsideExcludeRef]);
  const displayDoc = doc ?? exitingDocRef.current;
  if (!visible || !displayDoc) return null;

  const ANIM_DURATION = 0.12;
  const panel = (
    <div
      ref={modalContainerRef}
      className="fixed inset-0"
      style={{ zIndex: 10000, pointerEvents: 'none' }}
      aria-hidden
    >
      {/* Invisible overlay - pointer-events: none so hover reaches sidebar; click-outside handled by document listener */}
      <motion.div
        className="fixed inset-0"
        style={{ background: 'transparent', pointerEvents: 'none' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: isExiting ? 0 : 1 }}
        transition={{ duration: ANIM_DURATION, ease: 'easeOut' }}
      />
      <motion.div
        className="fixed left-1/2 top-1/2 flex flex-col items-center gap-3"
        style={{
          zIndex: 10001,
          pointerEvents: 'auto',
          x: '-50%',
          y: '-50%',
          willChange: 'transform, opacity',
        }}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: isExiting ? 0 : 1, scale: isExiting ? 0.96 : 1 }}
        transition={{ duration: ANIM_DURATION, ease: 'easeOut' }}
        onAnimationComplete={handleAnimationComplete}
        onClick={(e) => e.stopPropagation()}
      >
      <div
        className="flex flex-col rounded-xl overflow-hidden shadow-2xl"
        style={{
          width: 'min(50vw, 540px)',
          maxHeight: '62vh',
          backgroundColor: POPUP_BG,
        }}
      >
        {/* Header - extra right padding so role text doesn't sit under close button */}
        <div className="relative flex items-center justify-between pl-3 pr-10 py-2.5 shrink-0" style={{ backgroundColor: POPUP_BG }}>
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <Avatar
              className="w-10 h-10 flex-shrink-0 rounded-lg overflow-hidden"
              style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
            >
              <AvatarImage
                src={uploaderAvatarUrl || '/default profile icon.png'}
                alt=""
                className="object-cover"
              />
              <AvatarFallback
                className="text-white text-sm font-medium bg-transparent"
                style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}
              >
                {(uploaderName || 'U').charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="text-white font-medium text-sm truncate" style={{ fontFamily: 'system-ui, sans-serif' }}>
                {uploaderName}
              </div>
              <div className="text-white/80 text-xs truncate" style={{ fontFamily: 'system-ui, sans-serif' }}>
                Last updated on {formatDate(lastUpdated)}
              </div>
            </div>
          </div>
          <div className="flex items-end flex-col flex-shrink-0 min-w-0 max-w-[60%] overflow-visible">
            <div className="text-white/90 text-xs truncate text-right" style={{ fontFamily: 'system-ui, sans-serif' }}>
              {displayFileType}{displayFileSize !== '—' ? ` · ${displayFileSize}` : ''}
            </div>
            <div className="text-white/70 text-[11px] text-right flex items-center justify-end gap-1.5 pl-2.5 overflow-visible" style={{ fontFamily: 'system-ui, sans-serif' }}>
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: '#34C759',
                  boxShadow: '0 0 4px #34C759, 0 0 8px rgba(52, 199, 89, 0.4)',
                }}
                aria-hidden
              />
              {displayFileSize !== '—' && <span>{displayFileSize} · </span>}
              <span className="truncate min-w-0">Full Extraction</span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCloseRequest}
            className="absolute right-2 top-2 p-1 rounded text-white/80 hover:bg-white/10 flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>

        {/* Body: two panes - scrollable when content exceeds available space (e.g. small viewport) */}
        <div className="flex flex-1 min-h-0 overflow-y-auto" style={{ backgroundColor: POPUP_BG }}>
          {/* Left: Document preview - fixed aspect ratio so loading state matches document area size */}
          <div className="flex flex-col flex-1 min-w-0 p-2" style={{ backgroundColor: POPUP_BG }}>
            <div
              ref={containerRef}
              className="w-full bg-white/10 rounded-lg flex items-center justify-center overflow-hidden relative flex-1 min-h-0"
              style={{ aspectRatio: '210/297' }}
            >
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-white animate-spin" />
                </div>
              )}
              {error && (
                <div className="text-white/90 text-xs p-2 text-center">{error}</div>
              )}
              {!loading && !error && pdfDocument && (
                <canvas ref={canvasRef} className="w-full h-full object-contain" />
              )}
              {!loading && !error && !pdfDocument && previewUrl && (doc?.file_type || '').toLowerCase().includes('pdf') && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-white animate-spin" />
                </div>
              )}
              {!loading && !error && !pdfDocument && previewUrl && !(doc?.file_type || '').toLowerCase().includes('pdf') && (
                <div className="text-white/80 text-xs">Preview not available for this file type.</div>
              )}
            </div>
            {/* Footer: page counter + prev/next left, download right */}
            <div
              className="flex items-center justify-between gap-2 mt-1.5 px-2 py-1.5 rounded-lg"
              style={{ backgroundColor: 'rgba(0,0,0,0.2)' }}
            >
              <div className="flex items-center gap-2 ml-3">
                <span className="text-white text-xs" style={{ fontFamily: 'system-ui, sans-serif' }}>
                  {currentPage}/{totalPages} pages
                </span>
                <button
                  type="button"
                  onClick={handlePrevPage}
                  disabled={currentPage <= 1 || !pdfDocument}
                  className="p-1 rounded text-white hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={handleNextPage}
                  disabled={currentPage >= totalPages || !pdfDocument}
                  className="p-1 rounded text-white hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>
              <button
                type="button"
                onClick={handleDownload}
                className="p-1 rounded text-white hover:bg-white/20"
                aria-label="Download"
              >
                <Download className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* Right: Key facts - scrollable list */}
          <div
            className="w-56 shrink-0 flex flex-col min-h-0"
            style={{ backgroundColor: POPUP_BG }}
          >
            <div className="flex-1 min-h-0 overflow-y-auto py-2 pl-2 pr-2">
              <div className="text-white text-xs font-medium px-1 pb-2" style={{ fontFamily: 'system-ui, sans-serif' }}>
                Key facts
              </div>
              {keyFactsLoading && (
                <div className="text-white/70 text-xs px-2 py-1" style={{ fontFamily: 'system-ui, sans-serif' }}>
                  Loading…
                </div>
              )}
              {!keyFactsLoading && keyFacts !== null && !keyFactsSummary && keyFacts.length === 0 && (
                <div className="text-white/70 text-xs px-2 py-1" style={{ fontFamily: 'system-ui, sans-serif' }}>
                  No key facts extracted for this document.
                </div>
              )}
              {!keyFactsLoading && keyFactsSummary && (
                <p
                  className="text-white/90 text-xs leading-relaxed px-1 pb-2 break-words"
                  style={{ fontFamily: 'system-ui, sans-serif' }}
                >
                  {keyFactsSummary}
                </p>
              )}
              {!keyFactsLoading && keyFacts && keyFacts.length > 0 && (
                <div className="flex flex-col gap-2">
                  {keyFacts.map((fact, index) => {
                    const displayValue =
                      fact.value.length > KEY_FACT_VALUE_MAX_LENGTH
                        ? `${fact.value.slice(0, KEY_FACT_VALUE_MAX_LENGTH)}…`
                        : fact.value;
                    return (
                      <div
                        key={index}
                        className="px-3 py-2.5 rounded-lg text-white text-xs flex-shrink-0 flex flex-col gap-0.5"
                        style={{ backgroundColor: 'rgba(0,0,0,0.15)', fontFamily: 'system-ui, sans-serif' }}
                        title={fact.value}
                      >
                        <span className="text-white/80 font-medium">{fact.label}</span>
                        <span className="text-white break-words">{displayValue}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Floating bar below panel */}
      <div
        className="flex gap-2 rounded-lg overflow-hidden shadow-lg"
        style={{
          backgroundColor: POPUP_BG,
          padding: '6px 10px',
        }}
      >
        <button
          type="button"
          onClick={handleViewDocument}
          className="px-3 py-1.5 rounded-lg text-white text-xs font-medium hover:bg-white/10 transition-colors"
          style={{ fontFamily: 'system-ui, sans-serif' }}
        >
          View Document
        </button>
        <button
          type="button"
          onClick={handleAnalyseWithAI}
          className="px-3 py-1.5 rounded-lg text-white text-xs font-medium hover:bg-white/10 transition-colors flex items-center gap-1.5"
          style={{ fontFamily: 'system-ui, sans-serif' }}
        >
          <BookOpen className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          Analyse with AI
        </button>
        <button
          type="button"
          onClick={handleViewDetails}
          className="px-3 py-1.5 rounded-lg text-white text-xs font-medium hover:bg-white/10 transition-colors"
          style={{ fontFamily: 'system-ui, sans-serif' }}
        >
          View details
        </button>
      </div>
      </motion.div>

      {/* Pipeline stages modal (View details) - uses shared PipelineStagesDetail */}
      {showPipelineModal && (
        <>
          <div
            className="fixed inset-0 bg-black/40"
            style={{ zIndex: 10003, pointerEvents: 'auto' }}
            onClick={() => setShowPipelineModal(false)}
            onKeyDown={(e) => e.key === 'Escape' && setShowPipelineModal(false)}
            aria-hidden
          />
          <div
            ref={pipelineModalRef}
            tabIndex={-1}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl overflow-hidden shadow-xl outline-none"
            style={{
              zIndex: 10004,
              pointerEvents: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Escape' && setShowPipelineModal(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Pipeline processing details"
          >
            <PipelineStagesDetail
              variant="modal"
              completedStages={pipelineState.completedStages}
              currentStageIndex={pipelineState.currentStageIndex}
              isComplete={isPipelineComplete}
              documentName={displayDoc?.original_filename}
              pipelineProgress={pipelineProgress}
              isLoading={pipelineLoading}
              onClose={() => setShowPipelineModal(false)}
            />
          </div>
        </>
      )}
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(panel, document.body) : null;
};

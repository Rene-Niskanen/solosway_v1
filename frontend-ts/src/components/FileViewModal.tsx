"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react';
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

const POPUP_BG = '#F2F2EF';

const KEY_FACT_VALUE_MAX_LENGTH = 80;

/** Match date in text like "REEMENT is made the 28th February 2023 between..." or "28 February 2023" */
const DATE_IN_VALUE_REGEX =
  /\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}/gi;

/** Clean key fact label: strip backend prefixes (e.g. "tenancy_agreement. ") and normalise to title case */
function formatKeyFactLabel(label: string): string {
  if (!label || !label.trim()) return '';
  let s = label.trim();
  // Strip schema-style prefix: "word_with_underscores. " or "Word. "
  s = s.replace(/^[a-z][a-z0-9_]*\.\s*/i, '');
  s = s.replace(/^\s*\.\s*/, '');
  s = s.trim();
  if (!s) return '';
  // Title case for display (e.g. "DOCUMENT TYPE" -> "Document type", "date" -> "Date")
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Extract a clean date from value if it looks like contract boilerplate; otherwise return trimmed value */
function formatKeyFactValue(value: string): string {
  if (!value || typeof value !== 'string') return '';
  let s = value.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // If value looks like a sentence fragment containing a date, show only the date
  if (/\b(?:is\s+made\s+the|between|dated?|agreement\s+is)\b/i.test(s)) {
    const dateMatch = s.match(DATE_IN_VALUE_REGEX);
    if (dateMatch && dateMatch[0]) {
      return dateMatch[0].trim();
    }
  }
  if (s.length > KEY_FACT_VALUE_MAX_LENGTH) {
    s = s.slice(0, KEY_FACT_VALUE_MAX_LENGTH).trim();
    if (!/[\s.,;:)]$/.test(s)) s += '…';
  }
  return s;
}

/** True if summary is a backend placeholder like "tenancy_agreement. Document summary." */
function isSummaryPlaceholder(summary: string | null | undefined): boolean {
  if (!summary || !summary.trim()) return true;
  const t = summary.trim();
  return /^[a-z][a-z0-9_]*\.\s*Document\s+summary\.?\s*$/i.test(t) || /^Document\s+summary\.?\s*$/i.test(t);
}

function formatSummaryForDisplay(summary: string | null | undefined): string | null {
  if (!summary || !summary.trim()) return null;
  if (isSummaryPlaceholder(summary)) return null;
  return summary.trim();
}

/** Filter and format key facts for display: clean labels/values, skip redundant or empty entries */
function formatKeyFactsForDisplay(facts: KeyFact[] | null): KeyFact[] {
  if (!Array.isArray(facts) || facts.length === 0) return [];
  const out: KeyFact[] = [];
  const seenLabels = new Set<string>();
  for (const fact of facts) {
    const value = formatKeyFactValue(fact.value);
    if (!value) continue;
    let label = formatKeyFactLabel(fact.label);
    // Skip entries that are clearly "Document summary" as a fact (redundant with summary block)
    if (!label || /^Document\s+summary\.?$/i.test(label)) continue;
    // Dedupe by normalised label
    const key = label.toLowerCase();
    if (seenLabels.has(key)) continue;
    seenLabels.add(key);
    out.push({ label, value });
  }
  return out;
}

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
  /** When present (from list API), key facts show immediately without a separate request */
  key_facts?: KeyFact[];
  /** When present (from list API), summary shows immediately */
  summary?: string | null;
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
  /** DOCX: Office Online viewer URL (from docx-preview-url or temp-preview) */
  const [docxViewerUrl, setDocxViewerUrl] = useState<string | null>(null);
  const [docxLoading, setDocxLoading] = useState(false);

  const lastDocIdRef = useRef<string | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  const exitingDocRef = useRef<FileViewDocument | null>(null);
  const modalContainerRef = useRef<HTMLDivElement | null>(null);
  const pipelineModalRef = useRef<HTMLDivElement | null>(null);

  /** Stable container size for PDF canvas; only updated when size changes by more than 2px to avoid resize loops */
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);
  const lastContainerSizeRef = useRef<{ w: number; h: number } | null>(null);

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

  // Load document as soon as this screen (modal) is open. We fetch or use cache, then populate
  // __preloadedDocumentBlobs so "Analyse with AI" opens the preview instantly. If the user closes
  // the modal without clicking "Analyse with AI", we do not clear the cache – the document stays
  // cached for the next time they open it or use Analyse with AI.
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
      setDocxViewerUrl(null);
      setDocxLoading(false);
      setContainerSize(null);
      lastContainerSizeRef.current = null;
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
      // Populate preview cache so "Analyse with AI" opens document instantly
      if (!(window as any).__preloadedDocumentBlobs) (window as any).__preloadedDocumentBlobs = {};
      const filename = doc.original_filename || (doc as { filename?: string }).filename || 'Document';
      const mimeType = (doc.file_type || '').startsWith('application/') ? doc.file_type : 'application/pdf';
      (window as any).__preloadedDocumentBlobs[doc.id] = {
        url: cachedUrl,
        type: mimeType || 'application/pdf',
        filename,
        timestamp: Date.now(),
      };
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
        // Populate preview cache so "Analyse with AI" opens document instantly
        if (!(window as any).__preloadedDocumentBlobs) (window as any).__preloadedDocumentBlobs = {};
        const filename = doc.original_filename || (doc as { filename?: string }).filename || 'Document';
        (window as any).__preloadedDocumentBlobs[doc.id] = {
          url: objectUrl,
          type: blob.type || 'application/pdf',
          filename,
          timestamp: Date.now(),
        };
      })
      .catch((err) => {
        setError(err.message || 'Failed to load document');
        setLoading(false);
      });

    return () => {
      // Only revoke if we never stored this URL in documentBlobCache (e.g. fetch failed).
      // We never clear __preloadedDocumentBlobs on close – document stays cached if user exits without "Analyse with AI".
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

  // DOCX: get Office Online viewer URL (no download/re-upload when using docx-preview-url)
  useEffect(() => {
    if (!isOpen || !doc?.id) {
      setDocxViewerUrl(null);
      setDocxLoading(false);
      return;
    }
    const ft = (doc.file_type || '').toLowerCase();
    const fn = (doc.original_filename || '').toLowerCase();
    const isDocx =
      ft.includes('word') ||
      ft.includes('document') ||
      fn.endsWith('.docx') ||
      fn.endsWith('.doc');
    if (!isDocx) {
      setDocxViewerUrl(null);
      setDocxLoading(false);
      return;
    }
    setDocxLoading(true);
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5002';
    fetch(`${backendUrl}/api/documents/docx-preview-url`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_id: doc.id }),
    })
      .then((r) => r.json())
      .then((data) => {
        const url = data.open_in_word_url || data.presigned_url;
        if (url) setDocxViewerUrl(url);
        else setError('Could not load Word preview');
      })
      .catch(() => setError('Could not load Word preview'))
      .finally(() => setDocxLoading(false));
  }, [isOpen, doc?.id, doc?.file_type, doc?.original_filename]);

  // Fetch key facts from API (used when list didn't provide them or when user clicks Refresh).
  const fetchKeyFacts = useCallback((cancelledRef?: React.MutableRefObject<boolean | null>) => {
    if (!doc) return;
    setKeyFactsLoading(true);
    setKeyFacts(null);
    setKeyFactsSummary(null);
    backendApi
      .getDocumentKeyFacts(doc.id)
      .then((res) => {
        if (cancelledRef?.current) return;
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
        if (cancelledRef?.current) return;
        setKeyFactsLoading(false);
        setKeyFacts([]);
        setKeyFactsSummary(null);
      });
  }, [doc?.id]);

  const keyFactsCancelledRef = useRef<boolean | null>(false);
  useEffect(() => {
    if (!isOpen || !doc) return;
    keyFactsCancelledRef.current = false;
    // Use list-embedded key_facts/summary when present (same pattern as document blob cache).
    if (Array.isArray(doc.key_facts)) {
      setKeyFacts(doc.key_facts);
      setKeyFactsSummary(doc.summary ?? null);
      setKeyFactsLoading(false);
      return;
    }
    fetchKeyFacts(keyFactsCancelledRef);
    return () => {
      keyFactsCancelledRef.current = true;
    };
  }, [isOpen, doc?.id, doc?.key_facts, doc?.summary, fetchKeyFacts]);

  // Observe preview container size and update state only when it changes by more than 2px.
  // This avoids render loops from subpixel/fractional sizes (e.g. 299.5 vs 300) and defers
  // updates so we don't set state during layout (ResizeObserver runs synchronously in layout).
  // We also run an initial measurement after layout (double rAF) so the first open gets a valid
  // size even when the first ResizeObserver callback fires with 0x0 before layout is complete.
  const SIZE_THRESHOLD_PX = 2;
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    const container = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        if (w <= 0 || h <= 0) continue;
        const last = lastContainerSizeRef.current;
        const changed =
          last == null ||
          Math.abs(w - last.w) > SIZE_THRESHOLD_PX ||
          Math.abs(h - last.h) > SIZE_THRESHOLD_PX;
        if (changed) {
          lastContainerSizeRef.current = { w, h };
          queueMicrotask(() => setContainerSize({ w, h }));
        }
      }
    });
    ro.observe(container);

    // Capture initial size after layout; first open often has 0x0 until layout completes.
    let cancelled = false;
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled || !containerRef.current) return;
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        if (w > 0 && h > 0) {
          const last = lastContainerSizeRef.current;
          const changed =
            last == null ||
            Math.abs(w - last.w) > SIZE_THRESHOLD_PX ||
            Math.abs(h - last.h) > SIZE_THRESHOLD_PX;
          if (changed) {
            lastContainerSizeRef.current = { w, h };
            setContainerSize({ w, h });
          }
        }
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      ro.disconnect();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!pdfDocument || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    // Prefer stable size from ResizeObserver to avoid reading during layout thrash; fallback to ref
    const width = containerSize ? containerSize.w : container.clientWidth;
    const height = containerSize ? containerSize.h : container.clientHeight;
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
  }, [pdfDocument, currentPage, containerSize]);

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
    const filename = doc.original_filename || (doc as { filename?: string }).filename || 'Document';
    onViewDocument(doc.id, filename);
    onClose();
  };

  const handleAnalyseWithAI = () => {
    if (!doc?.id) return;
    // Some list APIs return "filename" instead of "original_filename" – support both
    const filename = doc.original_filename || (doc as { filename?: string }).filename || 'Document';
    onAnalyseWithAI(doc.id, filename);
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
          border: '2px solid #E4E4E1',
        }}
      >
        {/* Header - extra right padding so role text doesn't sit under close button */}
        <div className="relative flex items-center justify-between pl-3 pr-10 py-2.5 shrink-0" style={{ backgroundColor: POPUP_BG }}>
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <Avatar
              className="w-10 h-10 flex-shrink-0 rounded-lg overflow-hidden"
              style={{ backgroundColor: 'rgba(0,0,0,0.08)' }}
            >
              <AvatarImage
                src={uploaderAvatarUrl || '/default profile icon.png'}
                alt=""
                className="object-cover"
              />
              <AvatarFallback
                className="text-gray-700 text-sm font-medium bg-transparent"
                style={{ backgroundColor: 'rgba(0,0,0,0.08)' }}
              >
                {(uploaderName || 'U').charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="text-gray-900 font-medium text-sm truncate" style={{ fontFamily: 'system-ui, sans-serif' }}>
                {uploaderName}
              </div>
              <div className="text-gray-600 text-xs truncate" style={{ fontFamily: 'system-ui, sans-serif' }}>
                Last updated on {formatDate(lastUpdated)}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0 min-w-0 max-w-[60%] overflow-visible">
            <div className="text-gray-700 text-xs font-medium truncate text-right" style={{ fontFamily: 'system-ui, sans-serif' }}>
              {displayFileType}{displayFileSize !== '—' ? ` · ${displayFileSize}` : ''}
            </div>
            <div
              className="flex items-center justify-end gap-2 rounded-md px-2 py-1 overflow-visible"
              style={{ fontFamily: 'system-ui, sans-serif', backgroundColor: 'rgba(52, 199, 89, 0.12)' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: '#22c55e',
                  boxShadow: '0 0 0 1px rgba(34, 197, 94, 0.3)',
                }}
                aria-hidden
              />
              <span className="text-gray-700 text-[11px] font-medium truncate">Full Extraction</span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCloseRequest}
            className="absolute right-2 top-2 p-1 rounded text-gray-600 hover:bg-black/10 flex-shrink-0"
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
              className="w-full bg-black/5 rounded-lg flex items-center justify-center overflow-hidden relative flex-1 min-h-0"
              style={{ aspectRatio: '210/297' }}
            >
              {loading && !docxViewerUrl && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-gray-600 animate-spin" />
                </div>
              )}
              {error && !docxViewerUrl && (
                <div className="text-gray-700 text-xs p-2 text-center">{error}</div>
              )}
              {!loading && !error && pdfDocument && (
                <canvas ref={canvasRef} className="w-full h-full object-contain" />
              )}
              {!loading && !error && !pdfDocument && previewUrl && (doc?.file_type || '').toLowerCase().includes('pdf') && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-gray-600 animate-spin" />
                </div>
              )}
              {docxViewerUrl && (
                <>
                  <iframe
                    src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(docxViewerUrl)}&action=embedview&wdEmbedCode=0&ui=2`}
                    className="w-full h-full border-0"
                    title={doc?.original_filename || 'Word document'}
                  />
                  {(docxViewerUrl.startsWith('http://localhost') || docxViewerUrl.startsWith('http://127.0.0.1')) && (
                    <div className="absolute bottom-0 left-0 right-0 py-1.5 px-2 bg-amber-50 border-t border-amber-200 text-amber-800 text-xs text-center">
                      Word preview may not load when the backend is on localhost (Office must reach your server). Use &quot;View Document&quot; below to open the file.
                    </div>
                  )}
                </>
              )}
              {docxLoading && !docxViewerUrl && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-gray-600 animate-spin" />
                </div>
              )}
              {!loading && !error && !pdfDocument && !docxViewerUrl && !docxLoading && previewUrl && !(doc?.file_type || '').toLowerCase().includes('pdf') && (
                <div className="text-gray-600 text-xs">Preview not available for this file type.</div>
              )}
            </div>
            {/* Footer: page counter + prev/next left, download right */}
            <div
              className="flex items-center justify-between gap-2 mt-1.5 px-2 py-1.5 rounded-lg"
              style={{ backgroundColor: 'rgba(0,0,0,0.06)' }}
            >
              <div className="flex items-center gap-2 ml-3">
                <span
                  className="text-gray-700 text-xs tabular-nums min-w-[5.25rem] inline-block text-left"
                  style={{ fontFamily: 'system-ui, sans-serif' }}
                >
                  {currentPage}/{totalPages} pages
                </span>
                <button
                  type="button"
                  onClick={handlePrevPage}
                  disabled={currentPage <= 1 || !pdfDocument}
                  className="p-1 rounded text-gray-700 hover:bg-black/10 disabled:opacity-40 disabled:pointer-events-none"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={handleNextPage}
                  disabled={currentPage >= totalPages || !pdfDocument}
                  className="p-1 rounded text-gray-700 hover:bg-black/10 disabled:opacity-40 disabled:pointer-events-none"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>
              <button
                type="button"
                onClick={handleDownload}
                className="p-1 rounded text-gray-700 hover:bg-black/10"
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
              <div className="flex items-center justify-between gap-2 px-1 pb-2 border-b border-gray-200/80">
                <span className="text-gray-900 text-xs font-semibold tracking-tight" style={{ fontFamily: 'system-ui, sans-serif' }}>
                  Key facts
                </span>
                <button
                  type="button"
                  onClick={() => fetchKeyFacts()}
                  disabled={keyFactsLoading || !doc}
                  className="text-[11px] text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed rounded px-2 py-1 -mr-1 transition-colors focus:outline-none focus:ring-1 focus:ring-gray-300"
                  style={{ fontFamily: 'system-ui, sans-serif' }}
                  title="Regenerate summary and key facts"
                >
                  {keyFactsLoading ? '…' : 'Refresh'}
                </button>
              </div>
              {keyFactsLoading && (
                <div className="text-gray-600 text-xs px-2 py-1" style={{ fontFamily: 'system-ui, sans-serif' }}>
                  Loading…
                </div>
              )}
              {!keyFactsLoading && keyFacts !== null && (() => {
                const displaySummary = formatSummaryForDisplay(keyFactsSummary);
                const displayFacts = formatKeyFactsForDisplay(keyFacts);
                const hasSummary = !!displaySummary;
                const hasFacts = displayFacts.length > 0;
                if (!hasSummary && !hasFacts) {
                  return (
                    <div className="text-gray-500 text-xs px-2 py-1" style={{ fontFamily: 'system-ui, sans-serif' }}>
                      No key facts or summary for this document.
                    </div>
                  );
                }
                return (
                  <div className="space-y-3">
                    {hasSummary && (
                      <div className="rounded-md border border-gray-200/80 bg-white/60 px-2.5 py-2">
                        <p
                          className="text-gray-700 text-xs leading-relaxed break-words m-0"
                          style={{ fontFamily: 'system-ui, sans-serif' }}
                        >
                          {displaySummary}
                        </p>
                      </div>
                    )}
                    {hasFacts && (
                      <div className="rounded-md border border-gray-200/80 bg-white/60 px-2.5 py-2">
                        <p
                          className="text-gray-800 text-xs leading-relaxed break-words m-0"
                          style={{ fontFamily: 'system-ui, sans-serif' }}
                        >
                          {displayFacts
                            .map((fact) => `${fact.label}: ${fact.value}`)
                            .join('. ')}
                          {displayFacts.length > 0 ? '.' : ''}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()}
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
          border: '2px solid #E4E4E1',
        }}
      >
        <button
          type="button"
          onClick={handleViewDocument}
          className="px-3 py-1.5 rounded-lg text-gray-800 text-xs font-medium hover:bg-black/10 transition-colors"
          style={{ fontFamily: 'system-ui, sans-serif' }}
        >
          View Document
        </button>
        <button
          type="button"
          onClick={handleAnalyseWithAI}
          className="px-3 py-1.5 rounded-lg text-gray-800 text-xs font-medium hover:bg-black/10 transition-colors flex items-center gap-1.5"
          style={{ fontFamily: 'system-ui, sans-serif' }}
        >
          <img src="/analysewithai.png?v=2" alt="" className="w-4 h-4 flex-shrink-0 object-contain" />
          Analyse with AI
        </button>
        <button
          type="button"
          onClick={handleViewDetails}
          className="px-3 py-1.5 rounded-lg text-gray-800 text-xs font-medium hover:bg-black/10 transition-colors"
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

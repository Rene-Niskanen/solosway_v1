/**
 * Types and utilities for saving citation content (bbox screenshot or user-selected region)
 * for inclusion in exported Word documents.
 */

export type CitationExportEntry = { type: 'choose' | 'copy'; imageDataUrl: string };

export type CitationExportData = Record<string, Record<string, CitationExportEntry>>;

export type SavedCitationContext = {
  messageId: string;
  citationNumber: string;
  citationData: {
    doc_id?: string;
    document_id?: string;
    page?: number;
    page_number?: number;
    bbox?: { left: number; top: number; width: number; height: number; page?: number };
    cited_text?: string;
    block_content?: string;
    original_filename?: string;
    [key: string]: unknown;
  };
};

const DEFAULT_BBOX = { left: 0, top: 0, width: 1, height: 1 };

/**
 * Crop a full-page image (data URL) to the citation bbox (normalized 0-1).
 * Returns a new data URL for the cropped region.
 */
export function cropPageImageToBbox(
  pageImageDataUrl: string,
  imageWidth: number,
  imageHeight: number,
  bbox: { left: number; top: number; width: number; height: number }
): Promise<string> {
  const b = bbox ?? DEFAULT_BBOX;
  const x = Math.max(0, Math.floor(b.left * imageWidth));
  const y = Math.max(0, Math.floor(b.top * imageHeight));
  const w = Math.max(1, Math.min(Math.floor(b.width * imageWidth), imageWidth - x));
  const h = Math.max(1, Math.min(Math.floor(b.height * imageHeight), imageHeight - y));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(pageImageDataUrl);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.crossOrigin = 'anonymous';
    img.src = pageImageDataUrl;
  });
}

/** Mat (white frame) width in pixels around citation images in Word export. */
const CITATION_IMAGE_PADDING = 18;
/** Max width for citation images in the document (so they fit nicely in a column). */
const CITATION_IMAGE_MAX_WIDTH = 520;
/** Beveled matte: highlight and shadow on all sides for a raised frame. */
const BEVEL_HIGHLIGHT = 'rgba(255, 255, 255, 0.95)';
const BEVEL_SHADOW = 'rgba(0, 0, 0, 0.14)';
const BEVEL_WIDTH = 6;

/**
 * Draw a beveled matte white frame around the image: white mat with highlight
 * and shadow on all four sides (thick frame) for a raised look. Scale to max
 * width if needed. Returns as data URL.
 */
export function addOutlineToCitationImage(imageDataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;
      const pad = CITATION_IMAGE_PADDING;
      const cw = w + pad * 2;
      const ch = h + pad * 2;

      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(imageDataUrl);
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, w, h, pad, pad, w, h);
      // Bevel on all sides: thicker stroke; top/left highlight, bottom/right shadow
      const lw = BEVEL_WIDTH;
      const x0 = pad;
      const y0 = pad;
      const x1 = cw - pad;
      const y1 = ch - pad;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Top edge (highlight)
      ctx.strokeStyle = BEVEL_HIGHLIGHT;
      ctx.beginPath();
      ctx.moveTo(x0, y0 + lw / 2);
      ctx.lineTo(x1, y0 + lw / 2);
      ctx.stroke();
      // Left edge (highlight)
      ctx.beginPath();
      ctx.moveTo(x0 + lw / 2, y0);
      ctx.lineTo(x0 + lw / 2, y1);
      ctx.stroke();
      // Bottom edge (shadow)
      ctx.strokeStyle = BEVEL_SHADOW;
      ctx.beginPath();
      ctx.moveTo(x0, y1 - lw / 2);
      ctx.lineTo(x1, y1 - lw / 2);
      ctx.stroke();
      // Right edge (shadow)
      ctx.beginPath();
      ctx.moveTo(x1 - lw / 2, y0);
      ctx.lineTo(x1 - lw / 2, y1);
      ctx.stroke();

      if (cw <= CITATION_IMAGE_MAX_WIDTH) {
        resolve(canvas.toDataURL('image/png'));
        return;
      }
      const outW = CITATION_IMAGE_MAX_WIDTH;
      const outH = Math.round((ch * CITATION_IMAGE_MAX_WIDTH) / cw);
      const out = document.createElement('canvas');
      out.width = outW;
      out.height = outH;
      const outCtx = out.getContext('2d');
      if (!outCtx) {
        resolve(canvas.toDataURL('image/png'));
        return;
      }
      outCtx.drawImage(canvas, 0, 0, cw, ch, 0, 0, outW, outH);
      resolve(out.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.crossOrigin = 'anonymous';
    img.src = imageDataUrl;
  });
}

/**
 * Normalize document text for consistent layout: trim lines, collapse excessive
 * newlines, remove leading/trailing blanks so the docx doesn't have odd indentation or gaps.
 */
function normalizeDocxText(s: string): string {
  if (!s || typeof s !== 'string') return '';
  return s
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * Build markdown string for docx export: response text with citation markers
 * replaced by optional images (from citationExportData). Citation images get an
 * outline (border only) and are laid out consistently (one line before/after, optional label).
 */
export async function buildDocxMarkdownWithCitationImages(
  text: string,
  messageId: string,
  citationExportData: CitationExportData
): Promise<string> {
  const perMessage = citationExportData[messageId];
  const normalized = normalizeDocxText(text || '');
  if (!perMessage) {
    return normalized.replace(/\s*\[\d+\]\s*/g, ' ');
  }

  const parts = normalized.split(/(\[\d+\])/);
  const out: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const match = part.match(/^\[(\d+)\]$/);
    if (match) {
      const num = match[1];
      const entry = perMessage[num];
      if (entry?.imageDataUrl) {
        const outlinedDataUrl = await addOutlineToCitationImage(entry.imageDataUrl);
        // Consistent layout: one blank line before and after so citation images don't create huge gaps or uneven spacing
        out.push('\n\n');
        out.push(`![Citation ${num}](${outlinedDataUrl})\n\n`);
      }
      continue;
    }
    out.push(part);
  }

  const joined = out.join('');
  return joined
    .replace(/\s*\[\d+\]\s*/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

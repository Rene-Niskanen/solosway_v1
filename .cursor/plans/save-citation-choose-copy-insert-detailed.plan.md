---
name: ""
overview: ""
todos: []
isProject: false
---

# Save Citation: Choose / Copy / Insert — Detailed Build Plan

This plan is designed for first-try success: every integration point, data shape, and edit location is specified so implementation can proceed without guesswork or conflicts.

---

## 1. Behavior Summary (What We Are Building)


| Step | What happens                                                                                                                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | User clicks a citation (e.g. [1]) in a response → citation panel opens with "Ask follow up", "View in document", and **Save citation**.                                                                                                                                                                |
| 2    | User clicks **Save citation** → panel closes; a **menu bar** appears above the chat input (top-right) with three options: **Choose**, **Copy**, **Insert**.                                                                                                                                            |
| 3a   | **Copy**: App automatically takes a screenshot of the **citation bbox only** (the already-highlighted region). No drag. Image is stored for that citation. Menu closes.                                                                                                                                |
| 3b   | **Choose**: User opens the document (if not open), then drags a rectangle in the document preview. On mouse up, that region is captured as an image and stored for that citation. Menu closes.                                                                                                         |
| 3c   | **Insert**: Placeholder for now (no-op or "Coming soon").                                                                                                                                                                                                                                              |
| 4    | When user clicks **Word document (.docx)** for that response, the generated docx includes: response text with citation markers removed; for each citation that has saved data, the corresponding **image** (bbox screenshot or chosen region) is inserted below the text where that citation appeared. |


**Important**: Both **Copy** and **Choose** produce an **image** that goes into the docx. Copy = auto bbox crop; Choose = user-drawn region crop.

---

## 2. Data Structures and Types

### 2.1 Saved citation context (shown after "Save citation", until user picks an option or cancels)

```ts
type SavedCitationContext = {
  messageId: string;       // message.id or `msg-${idx}` (same as finalKey in renderedMessages)
  citationNumber: string; // "1", "2", ...
  citationData: CitationData; // doc_id, bbox (normalized 0-1), page, cited_text, etc.
};
```

- **Where**: `SideChatPanel` state: `savedCitationContext: SavedCitationContext | null`.
- When non-null, show `CitationSaveMenuBar` and (for Choose) enable screenshot mode in document view.

### 2.2 Per-citation export data (what gets written into the docx)

```ts
type CitationExportEntry = { type: 'choose' | 'copy'; imageDataUrl: string };
type CitationExportData = Record<string, Record<string, CitationExportEntry>>;
// First key = messageId, second key = citationNumber (e.g. "1", "2")
```

- **Where**: `SideChatPanel` state: `citationExportData: CitationExportData`.
- Initialize: `{}`. When user completes Copy or Choose, set `citationExportData[messageId][citationNumber] = { type, imageDataUrl }`.
- Pass `citationExportData` and `messageId` (and `message.citations`) into the docx builder so it can inject images after the right segments.

### 2.3 Citation data shape (already in codebase)

- `CitationClickPanelData` / `CitationData`: `doc_id`, `bbox: { left, top, width, height, page? }` (normalized 0–1), `page` / `page_number`, `cited_text`, `block_content`, `original_filename`, etc.
- Message citations: `message.citations` is `Record<string, CitationData>` (keys "1", "2", ...).

---

## 3. Copy Flow (Auto Bbox Screenshot)

Copy does **not** require the document preview to be open. We use the **same page image** already loaded for the citation panel (or from `hoverPreviewCache`).

### 3.1 Page image source

- Cache key: `hover-${docId}-${pageNum}` (see `preloadHoverPreview` in SideChatPanel ~2376).
- Entry: `{ pageImage: string (data URL), imageWidth: number, imageHeight: number }`.
- When the citation panel was open, we had `citationPanelLoadedImage` or `hoverPreviewCache.get(cacheKey)`. When user clicks "Save citation", we still have `citationClickPanel.citationData` (doc_id, page, bbox) **before** we clear the panel. So when we set `savedCitationContext`, we have everything needed. For Copy we need the page image: either it’s already in `hoverPreviewCache` (same key), or we call `preloadHoverPreview(docId, pageNum)` and await it.

### 3.2 Crop utility (pure function)

Add a small utility (e.g. in `frontend-ts/src/utils/citationExport.ts` or inline in SideChatPanel):

```ts
function cropPageImageToBbox(
  pageImageDataUrl: string,
  imageWidth: number,
  imageHeight: number,
  bbox: { left: number; top: number; width: number; height: number }
): Promise<string> {
  const x = Math.max(0, Math.floor(bbox.left * imageWidth));
  const y = Math.max(0, Math.floor(bbox.top * imageHeight));
  const w = Math.max(1, Math.floor(bbox.width * imageWidth));
  const h = Math.max(1, Math.floor(bbox.height * imageHeight));
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
```

Call with `await cropPageImageToBbox(...)` before storing the result.

### 3.3 Copy click handler (in SideChatPanel)

When user clicks **Copy** in the menu bar:

1. Read `savedCitationContext` (messageId, citationNumber, citationData).
2. Get `docId` = citationData.document_id ?? citationData.doc_id, `pageNum` = citationData.page ?? citationData.bbox?.page ?? 1.
3. Get page image: `cacheKey = 'hover-${docId}-${pageNum}'`; if `hoverPreviewCache.has(cacheKey)` use it; else `await preloadHoverPreview(docId, pageNum)`.
4. If no entry, toast error and return.
5. Call `cropPageImageToBbox(entry.pageImage, entry.imageWidth, entry.imageHeight, citationData.bbox)` (ensure bbox has left, top, width, height; default to full page if missing).
6. Set `citationExportData`:
  - `setCitationExportData(prev => ({ ...prev, [messageId]: { ...(prev[messageId] ?? {}), [citationNumber]: { type: 'copy', imageDataUrl: cropped } } }));`
7. Clear menu: `setSavedCitationContext(null)`.

---

## 4. Choose Flow (User Drag in Document Preview)

Choose requires the **document preview** (StandaloneExpandedCardView) to be open. The user draws a rectangle; we capture that region from the **rendered PDF canvas(es)**.

### 4.1 Communication: SideChatPanel ↔ StandaloneExpandedCardView

- **SideChatPanel** and **StandaloneExpandedCardView** are siblings (panel in SideChatPanel, doc view in MainContent). They do not share props. Use **React Context** so both can read/write the same state.
- Add `CitationExportContext` in `frontend-ts/src/contexts/CitationExportContext.tsx`.

**Context value:**

```ts
type CitationExportContextValue = {
  savedCitationContext: SavedCitationContext | null;
  setSavedCitationContext: (v: SavedCitationContext | null) => void;
  screenshotModeActive: boolean;           // true when user clicked Choose and we're waiting for a drag
  setScreenshotModeActive: (v: boolean) => void;
  onChooseCapture: (dataUrl: string) => void;  // called by StandaloneExpandedCardView when region captured
  onChooseCancel: () => void;
  citationExportData: CitationExportData;
  setCitationExportData: React.Dispatch<React.SetStateAction<CitationExportData>>;
};
```

- **Provider**: Wrap the layout in **MainContent** so that both the main content area (which contains the chat panel ref / content) and the StandaloneExpandedCardView are inside the provider. Easiest: wrap the parent that contains both the chat and the doc preview (the fragment or div that has SideChatPanel and the AnimatePresence for expandedCardViewDoc). State for `savedCitationContext`, `screenshotModeActive`, and `citationExportData` can live in the **provider** (MainContent), and SideChatPanel uses `useContext(CitationExportContext)` to read/write. Alternatively, keep state in SideChatPanel and pass a **ref** or **callback** up to MainContent so MainContent can pass “screenshot mode” and “onCapture” down to StandaloneExpandedCardView; that requires MainContent to have a way to receive those from SideChatPanel (e.g. a ref on SideChatPanel that exposes `getCitationExportState()` or a context that SideChatPanel sets). Cleanest: **state in a provider in MainContent**, and SideChatPanel consumes the context to set savedCitationContext, screenshotModeActive, and citationExportData. So the **provider holds** `savedCitationContext`, `screenshotModeActive`, `citationExportData`, and setters. SideChatPanel uses the context to show the menu bar and to run Copy/Choose handlers; when it builds the docx it needs `citationExportData` and `messageId` — it already has the message, so it can get citationExportData from context.
- **MainContent**: Create `CitationExportProvider` that holds the state above. Wrap the tree that includes both the chat panel and the document preview (so the provider is a parent of both). Then in SideChatPanel, replace local state for these with `useContext(CitationExportContext)`.
- **StandaloneExpandedCardView**: Use `useContext(CitationExportContext)`. When `screenshotModeActive` is true, render an overlay that captures mouse events and draws a selection rect; on mouseup, compute the selection in **viewport coordinates**, then map that to the **canvas coordinates** of the visible PDF page(s), draw the selected region to an offscreen canvas, `toDataURL('image/png')`, call `onChooseCapture(dataUrl)`, then parent (provider) sets `citationExportData[messageId][citationNumber] = { type: 'choose', imageDataUrl }` and clears `screenshotModeActive` and `savedCitationContext`.

### 4.2 Where state lives (recommended)

- **Option A**: State in MainContent provider; SideChatPanel and StandaloneExpandedCardView both use context. Docx builder runs inside SideChatPanel and reads `citationExportData` from context.
- **Option B**: State in SideChatPanel; pass to MainContent via a ref or a “callback context” that MainContent provides and SideChatPanel calls. More complex.

**Recommendation**: Option A. Add `CitationExportProvider` in MainContent; state: `savedCitationContext`, `screenshotModeActive`, `citationExportData`, plus setters. SideChatPanel: use context for all of these; when building docx, use `citationExportData` from context keyed by `messageId`.

### 4.3 StandaloneExpandedCardView: drag overlay and capture

- When `screenshotModeActive` is true:
  - Render a full-size overlay (position absolute, inset 0) on top of the PDF scroll area, with a high z-index (e.g. 50). Cursor: crosshair. Capture mousedown, mousemove, mouseup (and optionally escape to cancel).
  - On mousedown: record start (clientX, clientY). On mousemove: update end (clientX, clientY); draw a semi-transparent selection rectangle (e.g. a div or canvas overlay) from (min(start.x,end.x), min(start.y,end.y)) to (max, max).
  - On mouseup: selection rect in viewport is (x1, y1, width, height). Now we need to map this to the PDF canvas(es). The PDF is rendered in a scrollable container; each page is a canvas. Get the scroll container’s scrollTop, scrollLeft, and the position of each canvas in the container. For each canvas, compute the intersection of the viewport rect with that canvas’s bounding rect; then in canvas pixel space, draw that portion of the canvas to an offscreen canvas, then append (e.g. vertically) to a combined image, or capture only the first intersecting page for simplicity. Simpler approach: **single-page capture**. If the selection overlaps multiple pages, take only the page that has the largest overlap, or the first page that intersects. Then: get that canvas element, get its bounding rect and the intersection with the viewport selection, convert to canvas-relative coordinates (account for canvas size vs displayed size), use drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh) on an offscreen canvas, then toDataURL.
  - **Coordinate mapping**: viewport selection (clientX/clientY) → getBoundingClientRect of the scroll container and of each canvas; selection in container coords = (clientX - container.left + scrollLeft, clientY - container.top + scrollTop). Canvas in container has offsetTop/offsetLeft and width/height. Intersection of selection rect with canvas rect gives (sx, sy, sw, sh) in container coordinates. Canvas has natural width/height (canvas.width, canvas.height). Scale factor = canvas.width / displayedWidth. So source in canvas pixels: sx_canvas = (sx / displayedWidth) * canvas.width, etc. Then drawImage(canvas, sx_canvas, sy_canvas, sw_canvas, sh_canvas, 0, 0, outWidth, outHeight) on the output canvas (outWidth = sw_canvas, outHeight = sh_canvas to keep resolution).
  - Call `onChooseCapture(offscreenCanvas.toDataURL('image/png'))`. Then in the provider (or in SideChatPanel if you pass the callback from context), set citationExportData and clear screenshotModeActive and savedCitationContext.

### 4.4 Choose click handler (in SideChatPanel, using context)

1. Set `screenshotModeActive` to true (via context). Optionally open the document view if not already open (e.g. call `openCitationInDocumentView(citationData, false)` so the right doc is shown).
2. Menu bar can stay visible until capture or cancel; or hide the menu bar as soon as Choose is clicked and show a small “Draw a rectangle on the document” hint. On capture or cancel, clear savedCitationContext and screenshotModeActive.

---

## 5. UI: Citation Panel + Menu Bar

### 5.1 Add "Save citation" to CitationClickPanel

- **File**: `frontend-ts/src/components/CitationClickPanel.tsx`
- **Props**: Add `onSaveCitation?: () => void`.
- **UI**: In the button row (currently two buttons: "Ask follow up", "View in document"), add a **third** button: icon **Save** or **Scissors** (per reference), label "Save citation". Same style as the other two (padding, border, borderRadius 20px, etc.). Order: e.g. Ask follow up | View in document | Save citation.
- **Click**: Call `onSaveCitation?.()`.

### 5.2 SideChatPanel: wire onSaveCitation and show menu bar

- **File**: `frontend-ts/src/components/SideChatPanel.tsx`
- Where CitationClickPanel is rendered (~12941): add `onSaveCitation={() => { ... }}`.
  - In the handler: read `citationClickPanel.citationData`, `messageId`, `citationNumber`. Build `SavedCitationContext` and set it (via context: `setSavedCitationContext({ messageId, citationNumber, citationData })`). Close the panel: `setCitationClickPanel(null)`. Optionally open document view: `openCitationInDocumentView(citationClickPanel.citationData, false)` so for Choose the doc is already open.
- **CitationSaveMenuBar** (new component): Rendered only when `savedCitationContext !== null`. Position: inside the **chat input container** (the div with `ref={chatInputContainerRef}`), as a sibling **above** the form. Use `position: absolute; bottom: 100%; right: 16px; marginBottom: 8px; zIndex: 11` (or align to match reference: top-right of chat bar). Three buttons: Choose (scissors icon), Copy (document icon), Insert (document-plus icon). Insert can be disabled or no-op for now.
- **Z-index**: Chat input container already has zIndex 5 (or 10051 when citation panel open). Menu bar zIndex 11 so it appears above the scroll-to-bottom button (10) and above the input.

### 5.3 CitationSaveMenuBar component

- **File**: `frontend-ts/src/components/CitationSaveMenuBar.tsx` (new).
- **Props**: `onChoose: () => void; onCopy: () => void; onInsert?: () => void; onCancel?: () => void;` and optionally `context: CitationExportContextValue` to read savedCitationContext for labels.
- **Layout**: Horizontal bar, light background, border-radius, padding. Three items: [Scissors icon] Choose | [FileText icon] Copy | [FilePlus icon] Insert. Optional small “Cancel” or X to clear savedCitationContext.
- Use Lucide: `Scissors`, `FileText`, `FilePlus` (or `ImagePlus`).

---

## 6. Docx Export with Citation Images

### 6.1 Current behavior (to replace)

- `handleDownloadResponseAsDocx(text: string, messageId: string)` in SideChatPanel (~3560):
  - `textWithoutCitations = (text || '').replace(/\s*\[\d+\]\s*/g, ' ')`;
  - `blob = await convertMarkdownToDocx(textWithoutCitations)`;
  - `downloadDocx(blob, filename)`.

### 6.2 New behavior

- **Inputs**: `text` (message text), `messageId`, `citationExportData` (from context), and optionally `message.citations` (for fallback or labels).
- **Algorithm**:
  1. Split the text by citation markers, keeping the markers. Example: split by `/(\[\d+\])/` to get segments like `["Some text ", "[1]", " more text ", "[2]", " end"]`.
  2. Build a new string for docx:
    - For each segment:
      - If it’s text, append it.
      - If it’s a marker like `[1]`, look up `citationExportData[messageId]?.["1"]`. If present, append the marker (or remove it, see below) then append `\n\n![Citation 1](<imageDataUrl>)\n\n`. If not present, append nothing (or just remove the marker) to match current behavior.
  3. Use `convertMarkdownToDocx(builtMarkdown)`. The library supports `![alt](url)` with data URLs.
- **Citation marker in docx**: You can either keep “[1]” in the text and add the image below, or remove “[1]” and only add the image. Reference says “screenshot appears below the text where that citation would appear” — so keep the surrounding text and insert the image after the marker; optionally remove the marker so the doc doesn’t show “[1]”. Recommended: remove the marker and insert `\n\n![Citation 1](dataUrl)\n\n` so the doc shows the image where the citation was.
- **Implementation**: Add a helper `buildDocxMarkdownWithCitationImages(text: string, messageId: string, citationExportData: CitationExportData): string`. Use it in `handleDownloadResponseAsDocx` and pass `citationExportData` from context. Ensure `handleDownloadResponseAsDocx` is called with the same `messageId` used as key in `citationExportData` (i.e. `finalKey`).

### 6.3 Image size (optional)

- Large data URLs can make the docx big. Optionally resize the image (e.g. max width 800px) before embedding by drawing to a smaller canvas and using that data URL. Can be a follow-up.

---

## 7. File-by-File Checklist


| #   | File                                                        | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `frontend-ts/src/utils/citationExport.ts`                   | **New**. Export `cropPageImageToBbox` (async) and type `CitationExportEntry`, `CitationExportData`.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2   | `frontend-ts/src/contexts/CitationExportContext.tsx`        | **New**. Create context + provider with state: savedCitationContext, screenshotModeActive, citationExportData; setters; onChooseCapture, onChooseCancel (implemented in provider to update citationExportData and clear mode/context).                                                                                                                                                                                                                                                                                            |
| 3   | `frontend-ts/src/components/MainContent.tsx`                | Wrap the tree that contains both SideChatPanel and the StandaloneExpandedCardView with `CitationExportProvider`. Ensure provider state is used so SideChatPanel and StandaloneExpandedCardView can consume it.                                                                                                                                                                                                                                                                                                                    |
| 4   | `frontend-ts/src/components/CitationClickPanel.tsx`         | Add prop `onSaveCitation?: () => void`. Add third button "Save citation" with icon (e.g. Save or Scissors).                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 5   | `frontend-ts/src/components/CitationSaveMenuBar.tsx`        | **New**. Three buttons (Choose, Copy, Insert); position via props or internal absolute positioning; call onChoose, onCopy, onInsert.                                                                                                                                                                                                                                                                                                                                                                                              |
| 6   | `frontend-ts/src/components/SideChatPanel.tsx`              | Use CitationExportContext. Add state or context for savedCitationContext/citationExportData if not fully in provider. Render CitationSaveMenuBar when savedCitationContext != null. Wire onSaveCitation on CitationClickPanel. Implement Copy handler (get page image, crop, set citationExportData). Implement Choose handler (set screenshotModeActive; open doc if needed). Add buildDocxMarkdownWithCitationImages and use it in handleDownloadResponseAsDocx; pass messageId (finalKey) and citationExportData from context. |
| 7   | `frontend-ts/src/components/StandaloneExpandedCardView.tsx` | Use CitationExportContext. When screenshotModeActive, render overlay; handle mousedown/move/up; compute selection; map to canvas; capture image; call onChooseCapture(dataUrl). On Escape or cancel button, call onChooseCancel.                                                                                                                                                                                                                                                                                                  |


---

## 8. Order of Implementation (Minimize Risk)

1. **Types and crop utility** — Add `citationExport.ts` with types and `cropPageImageToBbox`. Unit-test or manually test crop with a sample data URL and bbox.
2. **Context and provider** — Add CitationExportContext with state in MainContent; no UI yet. Verify provider wraps both chat and doc preview.
3. **Citation panel + Save citation** — Add button and onSaveCitation; in SideChatPanel set savedCitationContext (from context) and close panel. No menu bar yet.
4. **Menu bar** — Add CitationSaveMenuBar; show when savedCitationContext != null; position above chat input. Wire Copy only: get page image (cache or preload), crop, set citationExportData, clear savedCitationContext. Test Copy flow end-to-end (no docx yet).
5. **Docx with images** — Implement buildDocxMarkdownWithCitationImages; call from handleDownloadResponseAsDocx; read citationExportData from context. Test: Save citation → Copy → download docx; image should appear.
6. **Choose: context + overlay** — In StandaloneExpandedCardView, when screenshotModeActive, show overlay; implement drag and capture; call onChooseCapture. In provider, onChooseCapture: set citationExportData[messageId][citationNumber] = { type: 'choose', imageDataUrl }, clear mode and context. Test Choose flow and docx with Choose image.
7. **Insert** — Leave as no-op or “Coming soon” for now.

---

## 9. Edge Cases and Conflicts

- **Z-index**: Menu bar 11; scroll-to-bottom 10; chat input container 5 (or 10051). Citation overlay in StandaloneExpandedCardView use a high local z-index (e.g. 50) so it’s above the PDF canvases.
- **Escape**: When citation panel is open, Escape already closes it. When menu bar is open, Escape should clear savedCitationContext (and screenshotModeActive if Choose was active). When drag is active in doc view, Escape should call onChooseCancel.
- **Document not open for Choose**: If user clicks Choose and the document preview isn’t open, open it via openCitationInDocumentView(citationData, false) so the right document is shown; then set screenshotModeActive so the overlay appears when the doc is ready.
- **Copy when cache miss**: If hoverPreviewCache doesn’t have the page, preloadHoverPreview is async. Show a short loading state (e.g. “Preparing…” on the Copy button or a toast) and await; then crop and store.
- **Message ID stability**: Use the same key for citationExportData as for the download button: `message.id || \`msg-${idx}` (finalKey). When building docx we’re in the same render cycle as the message list, so messageId is consistent.
- **Multiple citations per message**: citationExportData[messageId] is Record<string, CitationExportEntry>; each citation number "1", "2" can have its own image. Docx builder iterates segments and for each [N] looks up citationExportData[messageId][N].

---

## 10. Testing Checklist

- Click citation [1] → panel opens with three buttons; click Save citation → panel closes, menu bar appears above chat input.
- Click Copy → menu closes; no error; (optional) open download dropdown and download docx → document contains one image (bbox crop) for that citation.
- Click Choose → (doc opens if needed) overlay appears; drag a rect; release → overlay disappears, menu closes; download docx → document contains chosen region image.
- Save Copy for [1], then Choose for [2] in same message → download docx → both images appear in correct places.
- Escape during menu bar open → menu closes, savedCitationContext cleared.
- Escape during Choose drag → overlay closes, screenshotModeActive cleared.
- Download docx for a message with no saved citations → behavior unchanged (no images, markers removed).

---

This plan gives you exact types, state location, and step-by-step implementation order so the feature can be built once and work as intended on the first try.
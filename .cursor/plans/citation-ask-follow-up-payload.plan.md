---
name: Citation Ask follow up – full implementation
overview: Implement 'Ask follow up' so it inserts an orange citation-snippet chip (distinct from blue file/property chips) and passes block_id, cited_text (snippet), and optional source message to the LLM. Chip must not interfere with file/property segment selection.
todos:
  - id: types
    content: Add citation_snippet to SegmentKind and QueryContentSegment; extend citationContext type with block_id and source_message_text
    status: pending
  - id: chip-ui
    content: Add citation_snippet to AtMentionChip with orange styling (distinct from blue file/property)
    status: pending
  - id: segment-hook
    content: Handle citation_snippet in useSegmentInput insert/backspace/remove (no property/document callbacks)
    status: pending
  - id: panel-state
    content: Extend citation panel state with sourceMessageText; pass message text from citation click into panel
    status: pending
  - id: ask-follow-up
    content: "onAskFollowUp: insert citation_snippet chip with snippet + full citationData + sourceMessageText; close panel; focus input"
    status: pending
  - id: submit-context
    content: Compute effectiveCitationContext from prop or first citation_snippet chip; use in contentSegments, newQueryMessage, and API
    status: pending
  - id: query-bubble
    content: Render citation_snippet in contentSegments and in query bubble (orange pill)
    status: pending
  - id: segment-input-remove
    content: "SegmentInput: citation_snippet chip uses removeChipAtSegmentIndex only (no property/document remove)"
    status: pending
  - id: backend-optional
    content: "Backend: accept source_message_text in citation_context and include in citation prompt (optional)"
    status: pending
isProject: false
---

# Citation "Ask follow up" – implementation plan

## Goal

When the user clicks **"Ask follow up"** on the citation panel:

1. An **orange chip** appears in the chat input showing the citation snippet (e.g. "£2,400,000 as of February 2024"). Orange is used so it is visually distinct from blue file/property @-mention chips and does not interfere with file/property segment selection.
2. On submit, the backend receives **citation context** with:
  - **block_id** – exact block reference
  - **cited_text** – the snippet (same as chip label)
  - **document_id, page_number, bbox, original_filename** – for highlight/open
  - **source_message_text** (optional) – full message that contained the citation

**Non-interference with file/property:** The citation-snippet segment is independent: it does not use document or property selection state (`atMentionDocumentChips`, `selectedDocumentIds`, `propertyAttachments`). It is only used to pass citation context to the LLM. Orange styling keeps it visually separate from blue @-mention file/property chips.

---

## 1. Types

**File: [frontend-ts/src/types/segmentInput.ts**](frontend-ts/src/types/segmentInput.ts)

- Change `SegmentKind` from `"property" | "document"` to `"property" | "document" | "citation_snippet"`.
- Add to `QueryContentSegment`:
  - `| { type: 'citation_snippet'; snippet: string; citationData?: CitationBboxShape }`
- Define (or reuse) a minimal `CitationBboxShape` for the optional payload: `document_id`, `page_number`, `bbox`, `original_filename`, `block_id`, `cited_text`, `source_message_text?`.

**File: [frontend-ts/src/services/backendApi.ts**](frontend-ts/src/services/backendApi.ts)

- Extend `citationContext` type to include:
  - `block_id?: string`
  - `source_message_text?: string`

---

## 2. Chip UI (orange for citation snippet; no interference with file/property)

**File: [frontend-ts/src/components/AtMentionChip.tsx**](frontend-ts/src/components/AtMentionChip.tsx)

- Set `AtMentionChipType = "property" | "document" | "citation_snippet"`.
- **Citation snippet uses orange styling** so it is distinct from blue file/property chips and does not interfere with file/property segment selection:
  - Add constants for citation chip: `CITATION_CHIP_BG = "#F7F1E5"` (orange highlight colour) and `CITATION_CHIP_TEXT = "#3B3B3B"` (same dark text as other chips).
  - In the component, when `type === "citation_snippet"`, use background `#F7F1E5` (and same padding/radius/size as other chips). Property and document keep existing blue (`#D6E7FF`).
- No shared selection state: citation_snippet does not use `onInsertDocumentChip` / `onRemoveDocumentChip` or property callbacks (see useSegmentInput); it is independent of file/property segment selection.

---

## 3. useSegmentInput

**File: [frontend-ts/src/hooks/useSegmentInput.ts**](frontend-ts/src/hooks/useSegmentInput.ts)

- **insertChipAtCursor:** In the `if (chip.kind === ...)` block, do not call `onInsertPropertyChip` or `onInsertDocumentChip` when `chip.kind === "citation_snippet"`. Still perform the segment insert and cursor update.
- **backspace (and delete-forward / removeSegmentRange):** When the removed segment is a chip with `kind === "citation_snippet"`, do not call `onRemovePropertyChip` or `onRemoveDocumentChip`; only remove the segment.
- **removeChipAtIndex:** When the segment at index is `citation_snippet`, do not call property/document remove callbacks; only remove the segment.

---

## 4. SideChatPanel – citation panel state and source message

**File: [frontend-ts/src/components/SideChatPanel.tsx**](frontend-ts/src/components/SideChatPanel.tsx)

- **State shape:** Change `citationClickPanel` from `{ citationData: CitationData; anchorRect: DOMRect } | null` to also allow `sourceMessageText?: string` (the full text of the message that contains the citation).
- **Who sets it:** When opening the panel we need the message text. So:
  - Either extend the callback passed to citations: e.g. `handleCitationClick(data, anchorRect, sourceMessageText?)`.
  - Or keep a ref that stores "last message text for citation" and set it when rendering the message that contains the citation.
- **Recommended:** Add an optional third parameter to the handler used by the citation link. In the place that renders `StreamingResponseTextMemo` (inside `renderedMessages`), we have `message`. Create a wrapper: when rendering a response message, pass `(data, anchorRect) => handleUserCitationClick(data, anchorRect, message.text)`. Then in `handleUserCitationClick`, call `setCitationClickPanel({ citationData, anchorRect, sourceMessageText })` (and keep existing logic when `anchorRect == null`).
- **CitationLink / renderTextWithCitations:** The click handler is currently `handleCitationClick` (e.g. `onClick={() => handleCitationClick(citationData, anchorRect)}`). We need to pass the message text. So the component that has access to `message.text` must pass it. That is the parent of `StreamingResponseTextMemo`, which receives `handleCitationClick={handleUserCitationClick}`. So we need to pass a callback that includes message text. E.g. in the useMemo for renderedMessages, for each message we have `message`; for response messages pass `handleCitationClick={(data, anchorRect) => handleUserCitationClick(data, anchorRect, message.text)}`. Then `handleUserCitationClick` signature becomes `(data, anchorRect?, sourceMessageText?: string) => void`, and we store `sourceMessageText` in citationClickPanel state.

---

## 5. SideChatPanel – onAskFollowUp

**File: [frontend-ts/src/components/SideChatPanel.tsx**](frontend-ts/src/components/SideChatPanel.tsx)

- In the portal where `CitationClickPanel` is rendered, the `onAskFollowUp` callback currently does: `setCitationClickPanel(null); // TODO: prefill`.
- **Replace with:**
  1. Take `citationClickPanel.citationData` and `citationClickPanel.sourceMessageText` (if state has it).
  2. Snippet: `const snippet = (citationData.cited_text || citationData.block_content || 'this citation').trim().slice(0, 200)`.
  3. Stable id: e.g. `const id = \`cite-{citationData.doc_id ?? citationData.document_id ?? 'doc'}-{citationData.page ?? citationData.page_number ?? 0}-{Date.now()}`.
  4. Insert chip: `segmentInput.insertChipAtCursor({ type: 'chip', kind: 'citation_snippet', id, label: snippet, payload: { citationData: { ...citationData, block_id: citationData.block_id, cited_text: snippet, ... }, sourceMessageText: citationClickPanel.sourceMessageText != null ? citationClickPanel.sourceMessageText.slice(-2000) : undefined } }, { trailingSpace: true })`.
  5. Close panel: `setCitationClickPanel(null)`.
  6. Focus input: `requestAnimationFrame(() => { inputRef.current?.focus(); restoreSelectionRef.current?.(); })`.
- Ensure `citationData` includes `block_id` when the backend sends it (no change if already present in API responses).

---

## 6. SideChatPanel – effectiveCitationContext and submit

**File: [frontend-ts/src/components/SideChatPanel.tsx**](frontend-ts/src/components/SideChatPanel.tsx)

- **Where:** At the start of the submit block (right after we have `segmentInput.segments` and before building `contentSegments`), compute:
  - `effectiveCitationContext = citationContext ?? (() => { const first = segmentInput.segments.find(s => isChipSegment(s) && s.kind === 'citation_snippet'); if (!first || !isChipSegment(first)) return undefined; const p = first.payload as { citationData?: any; sourceMessageText?: string }; const c = p?.citationData; if (!c) return undefined; return { document_id: c.document_id ?? c.doc_id, page_number: c.page ?? c.page_number ?? c.bbox?.page ?? 1, bbox: c.bbox ?? { left: 0, top: 0, width: 0, height: 0 }, original_filename: c.original_filename ?? '', cited_text: first.label || c.cited_text || c.block_content || '', block_id: c.block_id, source_message_text: p?.sourceMessageText }; })();`
- **Use effectiveCitationContext (not citationContext) in:**
  - Building **contentSegments:** when `seg.kind === 'citation_snippet'`, push `{ type: 'citation_snippet', snippet: seg.label, citationData: (seg.payload as any)?.citationData }`.
  - **newQueryMessage:** `fromCitation: !!effectiveCitationContext`, and `citationBboxData` built from `effectiveCitationContext` (same shape as today: document_id, page_number, bbox, original_filename, block_id).
  - The **backendApi.queryDocumentsStreamFetch** call in the same submit flow: pass `effectiveCitationContext || undefined` as the citationContext argument (replace `citationContext || undefined` in that call only).
- **All other streaming call sites** that currently pass `citationContext`: either leave them as-is (prop-only) or, if they can ever be called with a citation_snippet in the input, pass effectiveCitationContext there too. For the main handleSubmit path, the only call is the one in the same block; use effectiveCitationContext there.

---

## 7. contentSegmentsToLinkedQuery (optional)

**File: [frontend-ts/src/types/segmentInput.ts**](frontend-ts/src/types/segmentInput.ts)

- In `contentSegmentsToLinkedQuery`, add a branch for `seg.type === 'citation_snippet'`: return `seg.snippet` (so the linked query string includes the snippet text in order). This keeps the sentence the user sees consistent.

---

## 8. Query bubble rendering

**File: [frontend-ts/src/components/SideChatPanel.tsx**](frontend-ts/src/components/SideChatPanel.tsx)

- Where `message.contentSegments` are mapped (query bubble), we currently handle `text`, `property`, `document`. Add:
  - `if (seg.type === 'citation_snippet')` then render an **orange** pill: e.g. `<span key=... style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: '6px' }}><AtMentionChip type="citation_snippet" label={seg.snippet.length > 50 ? seg.snippet.slice(0, 47) + '...' : seg.snippet} /></span>`. AtMentionChip will apply the orange styling for `type="citation_snippet"` (same as in the input).

---

## 9. SegmentInput – remove behavior for citation_snippet

**File: [frontend-ts/src/components/SegmentInput.tsx**](frontend-ts/src/components/SegmentInput.tsx)

- When rendering a chip, `onRemove` is currently: `removeChipAtSegmentIndex ? () => removeChipAtSegmentIndex(i) : (seg.kind === "property" ? ... : onRemoveDocumentChip)`. So when `removeChipAtSegmentIndex` is provided, all chips use it. When it is not provided, citation_snippet would fall through to document. So: for `seg.kind === 'citation_snippet'`, set `onRemove` to `removeChipAtSegmentIndex ? () => removeChipAtSegmentIndex(i) : undefined` (no-op when no remove prop), so we never call `onRemoveDocumentChip` for citation_snippet.

---

## 10. Backend (optional)

**Files: backend views and routing/LLM graph**

- In the view that receives `citationContext`, allow `source_message_text` in the payload and pass it through to the graph state (e.g. `citation_context['source_message_text']`).
- In the citation follow-up prompt (e.g. in `routing_nodes.py` or wherever the citation query prompt is built), add a line like: "Message containing the citation: {source_message_text}" when `source_message_text` is present, so the LLM can use the full message as context.

---

## Order of implementation (recommended)

1. Types (segmentInput.ts, backendApi.ts)
2. AtMentionChip – add citation_snippet type
3. useSegmentInput – handle citation_snippet in insert and remove paths
4. SideChatPanel – extend citation panel state with sourceMessageText; pass message text from citation click (handleUserCitationClick + render callback)
5. SideChatPanel – onAskFollowUp: insert chip, close panel, focus input
6. SideChatPanel – compute effectiveCitationContext and use in contentSegments, newQueryMessage, and queryDocumentsStreamFetch
7. contentSegmentsToLinkedQuery – handle citation_snippet
8. Query bubble – render citation_snippet segment as blue pill
9. SegmentInput – citation_snippet onRemove only via removeChipAtSegmentIndex
10. Backend – source_message_text (optional)

---

## Payload summary (what the LLM receives)


| Field               | Source                                      | Required |
| ------------------- | ------------------------------------------- | -------- |
| document_id         | citationData.doc_id / document_id           | Yes      |
| page_number         | citationData.page / page_number / bbox.page | Yes      |
| bbox                | citationData.bbox                           | Yes      |
| original_filename   | citationData.original_filename              | Yes      |
| cited_text          | Snippet (chip label)                        | Yes      |
| block_id            | citationData.block_id                       | Yes      |
| source_message_text | Stored message text (truncated)             | Optional |


This plan is self-contained; follow the steps in order for a clean implementation.
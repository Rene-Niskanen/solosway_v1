---
name: ""
overview: ""
todos: []
isProject: false
---

# Cited text in citation preview (container like reference)

## Goal

Show the cited text **inside the citation preview** (the popup panel and the inline callout card) in a container that matches the reference: light grey background, thin dashed light blue border, and padding — like the "THIS AGREEMENT is made the 28th February 2023..." block in your screenshot.

## Where to add it

1. **Citation click panel** (floating popup when you click a citation)
  **File:** [frontend-ts/src/components/CitationClickPanel.tsx](frontend-ts/src/components/CitationClickPanel.tsx)  
  - Right now: header (filename, page) → optional debug → page image only.  
  - Add: a **cited text block** after the header (and after debug if present), **before** the image area.  
  - Content: `citationData.cited_text ?? citationData.block_content`, sanitized (strip markdown/refs like the callout).  
  - Style: one scrollable block with the reference container (light grey bg, dashed light blue border, padding).  
  - Panel layout becomes: header → [optional debug] → **cited text in container** → page preview image (so the excerpt is visible without scrolling the image).
2. **Citation callout** (inline card in the chat with preview image + doc bar)
  **File:** [frontend-ts/src/components/SideChatPanel.tsx](frontend-ts/src/components/SideChatPanel.tsx) — `CitationCallout` component  
  - Right now: preview image → document bar (filename, Page N, actions). The callout has `displayText` (excerpt) but it is **not** rendered in the card.  
  - Add: a **cited text block** in the same container style, e.g. **above** the preview image (so order: excerpt in container → image → doc bar), matching the reference.

## Shared container style

Use the same styling in both places so the citation preview looks like the reference:

- **Background:** light grey (e.g. `#f3f4f6` or `#f9fafb`)
- **Border:** `1px dashed` light blue (e.g. `#93c5fd` or `#bfdbfe`)
- **Padding:** e.g. `10px 12px` or `12px 14px` so text has space
- **Border radius:** e.g. `6px`
- **Text:** normal colour, readable line-height; allow wrap and optional max-height + scroll if content is long

You can define a small shared style object or CSS class (e.g. in a shared constants/styles file or at top of one of the components) and reuse it in both the panel and the callout.

## Optional: inline message highlight

The green highlight in the **message body** for the “current citation” span can stay as-is, or be switched to the same container style for consistency. The main ask is the citation preview; inline is secondary.

## Files to change


| File                                                                        | Change                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CitationClickPanel.tsx](frontend-ts/src/components/CitationClickPanel.tsx) | Add cited text section (citationData.cited_text / block_content) in the reference-style container, between header and image area. Add simple sanitization for display (or reuse from SideChatPanel). |
| [SideChatPanel.tsx](frontend-ts/src/components/SideChatPanel.tsx)           | In `CitationCallout`, when rendering the card (hasCalloutCard): add excerpt block using `displayText` in the same container style, placed above the preview image.                                   |


## Summary

- **Citation preview** = the popup panel + the inline callout card.
- **Change:** In both, show the cited text excerpt **inside** a light grey box with dashed light blue border and padding, like the reference.
- **Result:** When users open a citation preview, they see the excerpt in that container, then the document preview (and in the panel, the page image) below.


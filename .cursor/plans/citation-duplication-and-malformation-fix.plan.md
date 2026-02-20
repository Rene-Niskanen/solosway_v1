# Fix citation duplication, white box below, and malformation

## What the images show

**Image 1 (Windy Ridge):**
- Bullet shows short text: "**Windy Ridge:** 1.2 acres... Sold for KES 102 million."
- A **white box appears below** the bullet with longer text: "Windy Ridge: 1.2 acres... in 2022, with an asking price of KES 120 million [1]"
- So: (1) same start duplicated in bullet and box, (2) box has more info, (3) box is a **separate block below** instead of wrapping the bullet text.

**Image 2 (Market Overview):**
- Same pattern: response text (short) then white box below with more text and [1].
- Second case: a whole paragraph appears **only** inside a white box with no corresponding text in the main response (malformed: content only in box).

**Image 3 (Property Characteristics):**
- "**Property Characteristics**" and ":" appear **outside** the white highlight; only the following paragraph is inside the box with [2].
- Citations [3] and [4] appear **orphaned** (no text, just the numbers).

---

## Root causes

### 1. White box below = CitationCallout is still rendered under blocks

We only removed the per-item **CitationCallout** for **list items** in **perplexityMarkdownComponents**. The **CitationCallout** (grey/white card with excerpt + doc preview) is still rendered below **p, h1, h2, h3, blockquote** when `!citationBarMode` in **both** component sets:

- [SideChatPanel.tsx](frontend-ts/src/components/SideChatPanel.tsx): **markdownComponents** (lines ~2066, 2088, 2108, 2130, 2217) and **perplexityMarkdownComponents** (lines ~2288, 2308, 2325, 2344, 2383) still have `showCitationPreviewBar && showInResponseCitationCallouts && !citationBarMode && ... map(... CitationCallout)` for p, h1, h2, h3, blockquote (and in perplexity, still for blockquote and others).

So every paragraph (and heading/blockquote) gets a **CitationCallout** below it when that block contains citations. That card is the “white box” in the screenshots. It shows the same or longer excerpt than the response, so it looks like duplication and “more info in the box.”

**Fix:** Remove the per-block **CitationCallout** for **all** block types when `!citationBarMode` in **both** `markdownComponents` and `perplexityMarkdownComponents`. Keep only:
- Citation bar (one callout when `citationBarMode`)
- Clicking the citation number (floating panel)

So: no in-response card below p, h1, h2, h3, li, blockquote. The only highlight is the **inline** CitedTextContainer (when green/blue/orange), and “more info” is only via the bar or the click panel.

### 2. Response vs callout text mismatch

We already use `citationRun` (cited_text/block_content) in `processFlattenedWithCitations` when non-empty. So the **run** we render can be the full citation text. But:

- When **inHighlight** is false we still push that run (good).
- The **CitationCallout** below still shows its own excerpt (message or citation), so until we remove it (above), the visual “duplication” and “more in the box” remain.

After removing per-block callouts, the only place the cited text appears is in the **response** (and in the inline highlight when active). So we should keep the current rule: when `citationRun` is non-empty, use it for the run so the response shows the same full text the backend has for that citation.

**Refinement:** If we use `citationRun` for every citation we can **lose bold/italic** from the message (e.g. "**Property Characteristics**" becomes plain text). So: prefer **citation run only when the message run is empty or missing**; when the message run has content (especially React elements like strong/em), keep using **pending segments** so we preserve formatting and avoid “label outside highlight” (Image 3). Concretely: set `useCitationRun = citationRun.length > 0 && (pendingIsOnlyStrings || messageRunEmpty)` or equivalent so we don’t replace rich runs with plain citation text.

### 3. Bold/label outside highlight (Image 3)

The run before [2] should include "**Property Characteristics** :" so the label is inside the same CitedTextContainer. That happens when we **don’t** replace with `citationRun` and instead use **pending** (which includes the strong element). So the “label outside” issue is fixed by the refinement above: when we have rich content (strong/em) in pending, use pending, not citation run. And ensure **flattenSegments** / **processFlattenedWithCitations** keep strong/em in the same run as the following text (already the case with `explodeInlineByCitation` for strong/em).

### 4. Orphaned citations [3] and [4] (Image 3)

Orphans happen when the “run” before [3] and [4] is empty: we push only the citation node (or an empty highlight). So either:

- The message really has no text between [2] and [3] and between [3] and [4] (LLM/backend issue), or
- We’re accidentally clearing or not accumulating segments for those citations.

We must **never** drop content (no “return null” that removes nodes). In `processFlattenedWithCitations`, when we flush and the run is empty (`pending.length === 0` is already handled by `if (pending.length === 0) return false`), we don’t push an empty CitedTextContainer. So we only push the citation node when `!consumed`. That can look like “orphaned” [3] [4] if there is no text between citations in the source. If the source has text between them, ensure we’re not splitting or dropping segments (e.g. only one segment type goes to pending). No structural change beyond “don’t drop nodes”; if orphans persist, the message content between [2]–[3] and [3]–[4] is empty and that’s a data/backend concern.

### 5. Content only in highlight (Image 2 – malformation)

A paragraph that appears **only** inside the white box with no text in the main response suggests either:

- That block’s content was rendered only inside a **CitationCallout** (so removing per-block callouts removes this “second copy” and we must ensure the same content is in the main flow), or
- Some logic (e.g. isOnlyCitationExcerpt) is **hiding** the paragraph and only showing the callout.

So: (1) Remove per-block callouts so we don’t have “content only in callout.” (2) Ensure we never hide the main block content when it’s “only” a citation excerpt; the response should always show the run (from message or citation) and the inline highlight, if any, should wrap that same run.

---

## Implementation plan

1. **Remove all per-block CitationCallout when !citationBarMode**
   - In **markdownComponents**: remove the `showCitationPreviewBar && showInResponseCitationCallouts && !citationBarMode && citationNumbers.filter(showCalloutForNum).map(... CitationCallout)` blocks for **p, h1, h2, h3, blockquote** (li already has no per-item callout there). Keep only `citationBarMode && renderSingleCalloutIfHere(...)`.
   - In **perplexityMarkdownComponents**: same — remove the per-block CitationCallout for **p, h1, h2, h3, blockquote** (li already removed). Keep only `citationBarMode && renderSingleCalloutIfHere(...)`.
   - Result: no white card below any block; only citation bar or click panel for “more info.”

2. **Use citation run only when it doesn’t remove formatting**
   - In `processFlattenedWithCitations`, set `useCitationRun = citationRun.length > 0` only when we’re not losing important structure: e.g. when **pending has no React elements** (all strings) or when the message run for this citation is empty. If pending contains strong/em (or other elements), prefer **pending** so the label and bold stay in the same run and inside the highlight.
   - Implementation: e.g. `const pendingHasOnlyStrings = pending.every(s => typeof s === 'string');` and `useCitationRun = citationRun.length > 0 && (pendingHasOnlyStrings || pendingMessageRunEmpty)`. If we don’t have a cheap “message run empty” signal, use only `pendingHasOnlyStrings` so we use citation run only when the run is plain text.

3. **No empty highlights, no dropping nodes**
   - Keep current behavior: when `pending.length === 0` we don’t push a CitedTextContainer. When we have pending, we never “return null” or drop segments; we only push content (or wrapped content) and citation node. This avoids malformation and keeps citations [3] [4] with text if the message has text between them.

4. **Ensure full run includes label in flattened path**
   - Keep using **processChildrenWithCitationsFlattened** for p, h1, h2, h3, li, blockquote and **flushPending** so the run before each citation is the full accumulated pending (including strong/em from explodeInlineByCitation). No change needed except the useCitationRun refinement so we don’t replace a rich run with plain citation run.

5. **Optional: keep CitedTextContainer inline**
   - CitedTextContainer is already `display: 'inline-block'`; no change. After removing CitationCallout below blocks, the only “white” highlight is this inline one.

---

## Files to change

- [frontend-ts/src/components/SideChatPanel.tsx](frontend-ts/src/components/SideChatPanel.tsx):
  - Remove per-block CitationCallout for p, h1, h2, h3, blockquote in **markdownComponents** (five places).
  - Remove per-block CitationCallout for p, h1, h2, h3, blockquote in **perplexityMarkdownComponents** (five places).
  - In `processFlattenedWithCitations` (`flushPending`): set `useCitationRun` only when citation run is non-empty **and** pending has no React elements (e.g. `pending.every(s => typeof s === 'string')`), so we preserve bold/label and avoid “label outside highlight” and orphaned-looking runs.

---

## Summary

| Issue | Cause | Fix |
|-------|--------|-----|
| White box below bullet/paragraph | CitationCallout still rendered below p, h1, h2, h3, blockquote | Remove all per-block CitationCallout when !citationBarMode in both component sets |
| Duplication / more info in box | Same callout shows same or longer excerpt than response | Removing callout removes duplication; keep using citation run only when safe so response has full text |
| Label/bold outside highlight | Replacing run with plain citation run drops strong/em | Use citation run only when pending is all strings; otherwise use pending so label is in run |
| Orphaned [3] [4] | Empty run or missing text between citations | Don’t drop nodes; if message has no text between citations, that’s data/LLM |
| Content only in highlight | Block content only in callout or hidden | Remove callout; ensure main flow always shows run (no hiding of “only excerpt” blocks in a way that leaves content only in callout) |

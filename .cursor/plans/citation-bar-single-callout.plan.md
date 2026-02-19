---
name: Citation bar and single-callout design
overview: One citation callout in the response, driven by a chat-bar strip (X of N, View Document, Accept / Review Next Citation). Remove the old per-block 'max 2 citations' limit.
todos:
  - id: citation-order-helper
    content: Add getOrderedCitationNumbersFromMessageText(text) and citation review state in SideChatPanel
    status: pending
  - id: single-callout-render
    content: "StreamingResponseText: render only one message-level callout for current citation; remove per-block callout limit"
    status: pending
  - id: cleanup-two-citation-limit
    content: Remove all citationNumbers.length <= 2 guards so we no longer cap at 2 citations per block
    status: pending
  - id: callout-no-bar-actions
    content: "CitationCallout: hide Accept/View document in callout; Ask Question on hover"
    status: pending
  - id: chat-bar-strip
    content: Add citation strip in chat bar (X of N, arrows, View Document, Accept / Review Next Citation)
    status: pending
  - id: citation-panel-hover
    content: "CitationClickPanel: remove View in document; Ask follow up on hover only"
    status: pending
  - id: remove-closed-callout-state
    content: "Remove closedCitationCallouts and handleCloseCitationCallout; align memo deps and excerpt logic per plan"
    status: pending
isProject: false
---

# Citation Bar and Single-Callout Design

## Cleanup: Remove the "no more than 2 citations" limit

The current code in [SideChatPanel.tsx](frontend-ts/src/components/SideChatPanel.tsx) restricts callouts to **at most 2 per block** using `citationNumbers.length <= 2` in the markdown components:

- **p** (line ~1454): `{citationNumbers.length <= 2 && citationNumbers.map(...)}`
- **h1** (line ~1475): same
- **h2** (line ~1494): same
- **h3** (line ~1515): same
- **li** (line ~1552): same
- **blockquote** (line ~1603): same

**Implementation must:**

1. **Remove every `citationNumbers.length <= 2` condition** in those components. With the new design we either:
  - Render **no** per-block callouts (single message-level callout only), or
  - If any per-block rendering remains for backwards compatibility, do **not** cap at 2 — the single visible callout is controlled by the bar, not by a per-block limit.
2. **Do not replace** the limit with another arbitrary cap (e.g. 5 or 10). The citation bar drives which one citation is shown; the list of citations is unbounded.

So: delete the `<= 2` check in all six places (and any similar “max citations” logic) as part of this feature.

---

## Codebase alignment and cleanup (nothing left behind)

Everything that must be aligned or removed so the new flow works and no previous logic conflicts:

### 1. SideChatPanel.tsx – StreamingResponseText and callouts

- **Six `citationNumbers.length <= 2`** (components `p`, `h1`, `h2`, `h3`, `li`, `blockquote` ~1454–1603): Remove the condition. In single-callout mode do not render per-block callouts at all.
- **Per-block CitationCallout rendering:** In single-callout mode stop rendering any callouts inside markdown blocks. Render exactly one message-level callout after the markdown for `orderedCitationNumbers[currentCitationIndex]`, only when not `showReviewNextOnly`.
- **closedCitationCallouts** (state ~4251, passed ~13919, used as `isCalloutClosed`): Remove or repurpose. New flow uses `acceptedCitationIndices` + `showReviewNextOnly`. Do not pass into the single callout.
- **handleCloseCitationCallout** (~4252–4258, passed ~13920): Remove when removing closedCitationCallouts.
- **StreamingResponseText props** (~672–705): Add `orderedCitationNumbersForMessage`, `currentCitationIndex`, `acceptedCitationIndices`, `showReviewNextOnly`, and optionally `citationBarMode`.
- **StreamingResponseTextMemo equality** (~1750–1755): Add the new props to the memo dependency/equality check.
- **Excerpt-hiding logic** (~741, 1429–1440): Keep. Still valid with one callout.

### 2. SideChatPanel.tsx – CitationCallout component

- **Accept / View document on callout** (~2473–2616): For the single bar-driven callout do not show these. Add prop e.g. `hideBarActions`; when true do not render those two buttons.
- **Ask Question:** Keep but show only on hover over the callout card.
- For the single message-level callout pass `hideBarActions={true}` and omit or no-op `onCloseCallout` and `onViewInDocument`.

### 3. SideChatPanel.tsx – Chat bar and citation strip

- Add citation strip (X of N, arrows, View Document, Accept or Review Next Citation). Reuse CitationCallout button styles. Visible only when `citationReviewMessageId` is set and that message has citations.
- View Document from bar: open document for current citation via `openCitationInDocumentView`. Accept: update `acceptedCitationIndices`, set `showReviewNextOnly`. Review Next: clear `showReviewNextOnly`, increment `currentCitationIndex`.
- Set citation review state when latest assistant message has citations and text has placeholders; clear on new message or chat switch.

### 4. SideChatPanel.tsx – Citation click panel (popup)

- **handleUserCitationClick** and **citationClickPanel:** Keep. Optionally set `currentCitationIndex` from clicked citation so bar and single callout stay in sync.

### 5. CitationClickPanel.tsx

- **View in document button** (~597–620): Remove from panel (lives in chat bar).
- **Ask follow up:** Keep but show only on hover over the preview card.

### 6. No other callers or tests

- CitationCallout and StreamingResponseText are only used in SideChatPanel. No tests reference the citation limit. savedCitationNumbersForMessage unchanged. No backend changes.

### 7. Done checklist

- getOrderedCitationNumbersFromMessageText implemented and used
- Citation review state added and cleared correctly
- All six `<= 2` checks removed; per-block callouts removed in single-callout mode
- One message-level callout; bar drives which citation and Accept / Review Next
- CitationCallout: bar actions hidden in bar-driven mode; Ask Question on hover
- Chat bar strip implemented
- closedCitationCallouts / handleCloseCitationCallout removed or unused for this flow
- CitationClickPanel: View in document removed; Ask follow up on hover only
- StreamingResponseText memo deps include new props

---

## Rest of the plan (summary)

- **Message-level citation order:** Helper that scans `message.text` for `%%CITATION_...%%` and returns ordered citation numbers (first occurrence).
- **State:** `citationReviewMessageId`, `currentCitationIndex`, `acceptedCitationIndices`, `showReviewNextOnly` to drive bar and single callout.
- **Response:** Show only **one** callout for the current citation (message-level slot). No Accept/View document on the callout; Ask Question on hover.
- **Chat bar:** Strip with "X of N", up/down arrows, View Document, Accept or Review Next Citation (same button styles as CitationCallout).
- **CitationClickPanel:** Remove View in document; Ask follow up on hover over the card.


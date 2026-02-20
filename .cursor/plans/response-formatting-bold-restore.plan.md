---
name: ""
overview: ""
todos: []
isProject: false
---

# Plan: Restore Original Response Formatting (Bold / Titles / Key Facts)

## Problem

Response text is losing default markdown formatting: titles and key facts (e.g. **Market Value £1,950,000**, **Evidence and Comparables**, **KES 102 million**) should render bold by default. Currently they often render as normal weight. Formatting should stay consistent whether or not a citation is highlighted/clicked.

## Root Cause (Analysis)

1. **Pipeline**
  - Backend sends text with `**bold`** and `[1]` citations.
  - `cleanResponseText` does not strip `**`.
  - `prepareResponseTextForDisplay` keeps `**` (e.g. via `ensureBalancedBoldForDisplay`).
  - `processCitationsBeforeMarkdown` replaces `[1]` with `%%CITATION_BRACKET_1%%`; leaves `**` intact.
  - `ReactMarkdown` receives `textWithCitationPlaceholders` and parses `**` into elements.
  - Custom block components (`p`, `li`, `h1`, `h2`, `h3`, `blockquote`) call `processChildrenWithCitationsFlattened(children, key)`.
2. **Where formatting is lost**
  - **Flatten step**: `flattenSegments` preserves only intrinsic `strong`/`em` via `tag === 'strong' || tag === 'em'`.
  - The **custom markdown `strong` component** is a **function** (returns `MainAnswerHighlight > strong > processChildrenWithCitations(children)`). So `child.type` is that function, not the string `"strong"`.
  - So `preserveInline` is false for custom strong/em, and we **recurse** into their children. That replaces the bold wrapper with the raw text segment (e.g. `"bold"`), so **bold is lost**.
3. **Clone step (already fixed)**
  - When rebuilding content from segments, we clone element segments with `cloneElement(seg, { key, children })`. We now spread `...(seg.props as object)` so intrinsic `strong`/`em` keep `style={{ fontWeight: 600 }}`. That fix is correct but does not help when the segment was never preserved (because it was a function component and we recursed into it).

## Original Formatting Logic (Desired)

- **Source of truth**: Markdown in the response (`**...`**, `*...*`).
- **Rendering**: ReactMarkdown turns these into elements; our code must preserve those elements through citation processing.
- **Citation behaviour**: Only the highlight (green/blue/orange container) changes on click; weight/style of text must not change.
- **Default**: All `*`* and `*` in the response are visible as bold/italic regardless of citation state.

## Implementation Plan

### Step 1: Preserve custom strong/em in `flattenSegments` (primary fix)

- In `flattenSegments`, treat **custom components** (e.g. our markdown `strong`/`em`) as inline to preserve, so we do not recurse into them and lose the wrapper.
- Safe approach: preserve any element whose `type` is a function (custom component), so we keep our custom `strong`/`em` as single segments and do not replace them with raw text.
- Code change: set `preserveInline = (tag === 'strong' || tag === 'em' || typeof tag === 'function')` (or equivalent) so that both intrinsic and custom strong/em are preserved.

### Step 2: Keep cloneElement props spread

- Already done: when building content from segments, use `React.cloneElement(seg, { ...(seg.props as object), key, children: processed })` so intrinsic elements keep their styles.

### Step 3: Ensure string segments still parse `*`*

- `renderStringSegment` → `renderTextSegment` already parses `**` and `*` for any string segment. No change needed; only relevant when a segment is still a string (e.g. from a part of the tree that was never wrapped in strong by ReactMarkdown).

### Step 4: CSS fallback (already in place)

- `.streaming-response-text strong { font-weight: 600 !important; }` and same for `em` so that any remaining `strong`/`em` nodes always render with correct weight/style.

### Step 5: Verification

- Test responses that include: title in bold, key figures in bold, and citations (e.g. `**Market Value** £1,950,000 [1]`).
- Confirm bold is visible by default (no citation click).
- Confirm bold is unchanged when toggling citation highlight on/off.
- Confirm no regression for MAIN highlight or citation callouts.

## Files to Touch

- `frontend-ts/src/components/SideChatPanel.tsx`
  - `flattenSegments`: preserve elements with `typeof tag === 'function'` so custom strong/em are not recursed into.
  - (Optional) Add a short comment at `flattenSegments` and at the custom `strong`/`em` components explaining that custom components must be preserved to keep default formatting.

## Out of Scope

- Changing how the backend or `prepareResponseTextForDisplay` handles markdown.
- Changing citation highlight behaviour (green/blue/orange); only ensuring they do not alter bold/italic.


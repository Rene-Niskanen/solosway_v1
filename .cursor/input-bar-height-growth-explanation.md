# Why both chat bars grow in height when typing

## Summary

Both bars grow because:

1. The **bar container** uses `height: 'auto'` (and only `minHeight`), so its height follows its content.
2. The **input area** (SegmentInput or its wrapper) is allowed to grow with content instead of having a fixed height and scrolling.

The exact mechanism differs slightly between SearchBar and SideChatPanel.

---

## 1. Bar container (both)

**SearchBar** (pill div, ~line 1416):

- `height: 'auto'`
- `minHeight: isMapVisible ? 'fit-content' : '44px'`
- `maxHeight: 220px` (dashboard) or similar

**SideChatPanel** (both empty-state and bottom bar):

- `height: 'auto'`
- `minHeight: '44px'` (bottom bar) or `'160px'` (empty state)

So in both cases the bar has no fixed height; it sizes to its children. Anything that makes the inner content taller will make the bar taller.

---

## 2. SearchBar: explicit resize effect

**File:** `SearchBar.tsx` (~720–817)

A layout effect runs when the input value/segments change and:

1. Gets the SegmentInput root element via `inputRef.current?.getRootElement()`.
2. Reads `el.scrollHeight`.
3. Sets **inline height** on that element:  
   `el.style.height = \`${Math.min(scrollHeight, maxHeight)}px\``  
   so the input is explicitly resized to match content (capped at `maxHeight`).
4. Sets `el.style.overflowY` to `'auto'` or `'hidden'` depending on whether content exceeds `maxHeight`.

So in SearchBar the **positioning logic that makes the bar grow** is: “resize the input element to its content height.” Because the bar has `height: 'auto'`, the bar grows with the resized input.

---

## 3. SideChatPanel: no explicit resize; SegmentInput wrapper grows

**File:** `SideChatPanel.tsx`  
No effect sets the input’s height. It just passes something like:

- `style={{ minHeight: '28px', maxHeight: '120px', ... }}`  
  (or `minHeight: '100px'`, `maxHeight: '120px'` for empty state)

to **SegmentInput**.

**File:** `SegmentInput.tsx` (~404–422, 477–481)

When `style.maxHeight` is present:

- The contentEditable is wrapped in a **scroll wrapper** div.
- The wrapper gets:
  - `maxHeight: style.maxHeight`
  - `overflowY: 'auto'` (or from style)
  - **no** `height` or `minHeight` (only `maxHeight`).

So the wrapper’s height is “as tall as the content, but no more than maxHeight.” As you type, the contentEditable grows, so the wrapper grows until it hits `maxHeight`, then it scrolls. Because the bar has `height: 'auto'`, the bar grows with the wrapper.

So in SideChatPanel the **positioning logic that makes the bar grow** is: “bar is auto height; SegmentInput’s scroll wrapper has only `maxHeight`, so it grows with content; therefore the bar grows with content until the wrapper hits its max.”

---

## 4. SegmentInput contentEditable

The actual input is a `contentEditable` div with:

- `minHeight: '22px'`
- no fixed `height`

So it naturally expands with lines of text. That expansion either:

- (SearchBar) drives the explicit `el.style.height = …` in the effect, which then makes the bar (auto height) grow, or  
- (SideChatPanel) makes the scroll wrapper (which has only `maxHeight`) grow, which again makes the bar (auto height) grow.

---

## What would stop the bar from growing?

To keep the bar a fixed height while typing:

1. Give the **bar container** a fixed height (e.g. one or two lines) instead of `height: 'auto'`, and
2. Give the **input area** a fixed height and `overflow: auto` so only the inner content scrolls:
   - In **SearchBar**: stop setting `el.style.height` to `scrollHeight`; use a fixed height (or a small max like one line) and let the input scroll.
   - In **SegmentInput**: when used in these bars, pass a fixed `height` (or a small “default” height) for the scroll wrapper, not only `maxHeight`, so the wrapper doesn’t grow with content and the bar stays fixed.

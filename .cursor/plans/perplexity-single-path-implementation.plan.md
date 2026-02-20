---
name: Perplexity single-path implementation
overview: "Robust implementation plan to fix Perplexity-style streaming by using one content representation and one render path: chunk the formatted string into 2-word substrings, render each with markdown/citation pipeline inside motion.span (opacity 0→1), so formatting is preserved and there is no switch at stream end."
todos:
  - id: getChunkSubstrings
    content: Add getChunkSubstrings(str) returning exact 2-word (or 1-word tail) substrings
    status: pending
  - id: chunkMarkdownComponents
    content: Add chunkMarkdownComponents (inline-only, no callouts) derived from markdownComponents
    status: pending
  - id: perplexity-branch
    content: "Perplexity-style branch: chunk textWithCitationPlaceholders, render each chunk with ReactMarkdown + chunkMarkdownComponents inside motion.span"
    status: pending
  - id: single-branch
    content: Ensure same branch runs during and after stream (no switch at end)
    status: pending
  - id: edge-cases
    content: Handle empty/single-word and optional performance tuning if needed
    status: pending
isProject: false
---

# Perplexity-style streaming: single-path implementation plan

This plan implements the fix described in the analysis: **one content representation**, **one render path** for Perplexity-style messages. Chunk the **formatted** string, render each chunk with the same markdown/citation pipeline inside a `motion.span` (opacity 0→1, duration 0.75). No switch at stream end, so no formatting "break."

**Reference:** [SideChatPanel.tsx](frontend-ts/src/components/SideChatPanel.tsx) — `StreamingResponseText`, `textWithCitationPlaceholders`, `markdownComponents`, current Perplexity branch ~lines 2120–2135.

---

## 1. Single source of truth for content

- Use `**textWithCitationPlaceholders`** as the only string we chunk and render when `usePerplexityStyle && !skipRevealAnimation`.
- It is already derived from `textWithTagsStripped` via `processCitationsBeforeMarkdown` and contains markdown + citation placeholders.
- No separate "plain" branch; remove the current plain `chunkString(citationPlaceholdersToBrackets(text))` path for this condition.

---

## 2. Split formatted string into 2-word substrings

- **Add a helper** in [SideChatPanel.tsx](frontend-ts/src/components/SideChatPanel.tsx) near `chunkString` / `citationPlaceholdersToBrackets` (e.g. after line ~488):
  **`getChunkSubstrings(str: string): string[]`**
  - **Behavior:** Walk the string by **word boundaries** (whitespace vs non-whitespace). Count words; every 2 words push the **exact substring** `str.slice(pairStart, currentIndex)` so that newlines, `*`*, and spaces are preserved.
  - **Word:** Maximal run of non-whitespace (same idea as repo). Exact slice means `"**bold**\n\nword"` stays intact when it forms one chunk.
  - **Trailing odd word:** If the string ends with an odd word count, include a final chunk of 1 word so the last word still gets its own opacity reveal.
  - **Do not** use `chunkString` for this: `chunkString` uses `words.join(' ')` and collapses whitespace; we need exact substrings.
- **Pseudocode:**

```ts
  function getChunkSubstrings(str: string): string[] {
    if (!str || !str.trim()) return [];
    const chunks: string[] = [];
    let wordCount = 0, pairStart = 0, i = 0;
    while (i < str.length) {
      while (i < str.length && /\s/.test(str[i])) i++;
      if (i >= str.length) break;
      while (i < str.length && !/\s/.test(str[i])) i++;
      wordCount++;
      if (wordCount === 2) {
        chunks.push(str.slice(pairStart, i));
        pairStart = i;
        wordCount = 0;
      }
    }
    if (wordCount === 1) chunks.push(str.slice(pairStart));
    return chunks;
  }
  

```

---

## 3. Chunk-level markdown + citation rendering

- Each chunk must be rendered with **the same** formatting and citation resolution as the full message, but **inline** so consecutive chunks flow (no block margins inside a chunk).
- **Approach:** Use ReactMarkdown per chunk with **inline-friendly components** that:
  - Resolve citation placeholders via `processChildrenWithCitationsFlattened` (same as full message).
  - Render block elements as inline (`p`, `h1`, `h2`, `h3`, `div`, `blockquote`, `li` → `<span>` or inline wrapper) so layout doesn't break between chunks.
  - **Omit callouts** in chunk view: do not render `CitationCallout` or `renderSingleCalloutIfHere` inside chunk components.
- **Implement** `chunkMarkdownComponents` inside `StreamingResponseText` (e.g. `React.useMemo` depending on `markdownComponents` and chunk index or a stable prefix):
  - Spread `markdownComponents`.
  - Override block components (`p`, `h1`, `h2`, `h3`, `div`, `blockquote`, `li`, etc.) to render only:
    - `<span style={{ display: 'inline', margin: 0 }}>{processChildrenWithCitationsFlattened(children ?? null,` chunk-${block}-${chunkIndex}`)}</span>`.
  - Do not render the callout blocks (no `CitationCallout`, no `renderSingleCalloutIfHere`).
  - Because each chunk is rendered with its own `chunkIndex`, you need either a component that receives `chunkIndex` and returns the right components, or a factory: `getChunkMarkdownComponents(chunkIndex)` used inside the map. Simplest: build `chunkMarkdownComponents` once with a generic key prefix like `chunk-p-` and pass the chunk index when calling `processChildrenWithCitationsFlattened` via a closure (e.g. pass chunk index into the component overrides).
- Use a **stable key** per chunk: e.g. `key={\`chunk-${index}}`so React doesn't remount`motion.span` unnecessarily.

---

## 4. Single branch for Perplexity-style

- In the render branch (around lines 2120–2135 in [SideChatPanel.tsx](frontend-ts/src/components/SideChatPanel.tsx)):
  - **When** `usePerplexityStyle && !skipRevealAnimation` **and** there is content to show (`textWithCitationPlaceholders` non-empty after trim):
    - Compute `chunks = getChunkSubstrings(textWithCitationPlaceholders)`.
    - Render:
      - `chunks.map((chunk, index) => (   <motion.span key={\`chunk-${index}} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.75 }} style={{ display: 'inline' }}>
      {chunk}
        </motion.span>
      ))`
    - Use a memoized or stable `chunkMarkdownComponentsForIndex(index)` that returns components with the correct key prefix for that chunk.
  - **Else** (non-Perplexity or skip reveal): keep current behavior: single `<ReactMarkdown key={markdownKey} skipHtml components={markdownComponents}>{textWithCitationPlaceholders}</ReactMarkdown>`.
- **Critical:** For Perplexity-style, **always** use the chunked + ReactMarkdown path when the condition holds — both **during** stream and **after** stream. When streaming ends, do **not** switch to the non-chunked branch; keep showing the same chunk list (all chunks visible, all with opacity 1). So the condition is **not** `isStreaming && usePerplexityStyle`; it is `**usePerplexityStyle && !skipRevealAnimation`** (and optionally `textWithCitationPlaceholders` non-empty). Remove any dependency on `isStreaming` for choosing the chunked path so the same path runs after stream end.

---

## 5. Edge cases and robustness

- **Empty or whitespace-only:** `getChunkSubstrings('')` or only-whitespace → `[]`; render nothing (or a single empty wrapper if layout requires it).
- **Single word:** Return one chunk containing that word so it still gets 0→1 reveal (handled by trailing-odd-word logic).
- **Chunk with only whitespace/newlines:** Possible if two "words" are separated by many newlines. Accept; ReactMarkdown will treat as spacing. If it causes layout issues, consider collapsing runs of whitespace when building substrings (only for display), or leave as-is and test.
- **Citation placeholders in chunks:** Already in `textWithCitationPlaceholders`; `chunkMarkdownComponents` uses `processChildrenWithCitationsFlattened`, so placeholders are resolved to `CitationLink` the same way as in the full message.
- **Performance:** Many small ReactMarkdown instances may be costly for very long messages. Start with one ReactMarkdown per chunk; if profiling shows issues, consider virtualizing or batching (e.g. group every N chunks into one `motion.span` and one ReactMarkdown).
- **Parent pacing:** The parent already drives revealed word count and passes the prefix as `text`. The child uses `textWithCitationPlaceholders` (derived from that `text`). Parent pacing unchanged; child only changes **rendering** (chunked + formatted instead of plain).

---

## 6. Optional fallback

- If ReactMarkdown-per-chunk causes bugs (callouts, list structure, parsing): **fallback** to rendering each chunk without full ReactMarkdown by splitting the chunk on `citationPlaceholderRe` and using `renderTextSegment(part)` for text and `renderCitationPlaceholder(part, key)` for placeholders. That gives bold/italic + citations per chunk but no block structure. Prefer the ReactMarkdown path first for full fidelity.

---

## 7. Summary checklist

- Add `getChunkSubstrings(str)` returning exact 2-word (or 1-word tail) substrings.
- Add `chunkMarkdownComponents` (or per-index factory) — inline-only, no callouts — derived from `markdownComponents`.
- Perplexity-style branch: chunk `textWithCitationPlaceholders` with `getChunkSubstrings`; render each chunk with ReactMarkdown + chunk components inside `motion.span` (opacity 0→1, 0.75s).
- Ensure the same branch runs during and after stream: condition is `usePerplexityStyle && !skipRevealAnimation` (and content non-empty), **not** `isStreaming && usePerplexityStyle`.
- Handle empty/single-word; add performance tuning only if needed.


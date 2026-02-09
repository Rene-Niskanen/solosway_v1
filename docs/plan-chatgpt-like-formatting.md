# Plan: ChatGPT-like response formatting

This plan updates how AI responses are structured and rendered so they look and read more like ChatGPT: clear title, proper headings, label-value on separate lines, numbered lists, and consistent citations.

---

## Scope

- **Frontend**: Where response text is rendered (Markdown components and any pre-processing).
- **Backend**: System and formatting prompts that guide structure (main title, headings, lists, citations).
- **Touchpoints**: `FloatingChatBubble.tsx`, `SideChatPanel.tsx` (StreamingResponseText), `backend/llm/prompts.py`, `backend/llm/utils/system_prompts.py`, `backend/llm/nodes/agent_node.py`.

---

## Phase 1: Frontend – enable and style headings (h2, h3)

**Goal**: Headings create clear hierarchy; no headings are hidden.

**Current state**:
- **SideChatPanel** (`StreamingResponseText`): `h2` and `h3` are rendered as `() => null`, so `##` and `###` never show.
- **FloatingChatBubble**: `h2` is `() => null`; `h3` is rendered with small styling.

**Tasks**:

1. **SideChatPanel.tsx** (around 969–991)
   - Replace `h2: () => null` with a real `h2` component (same pattern as `h1`): process citations, style with e.g. `fontSize: '16px'`, `fontWeight: 600`, `margin: '12px 0 8px 0'`, `color: '#111827'`.
   - Replace `h3: () => null` with a real `h3` component: e.g. `fontSize: '14px'`, `fontWeight: 600`, `margin: '10px 0 6px 0'`, `color: '#111827'`.
   - Reuse the same citation-processing pattern used for `h1`/`p`/`li` (e.g. `processChildrenWithCitationsFlattened`) so citation placeholders work inside headings.

2. **FloatingChatBubble.tsx** (around 908–910)
   - Replace `h2: () => null` with a styled `h2` (e.g. slightly smaller than `h1`, consistent margins) and pass through citation processing where applicable.
   - Ensure `h3` remains visible and, if needed, align its styles with the new hierarchy (e.g. `h1 > h2 > h3` by size/spacing).

**Acceptance**: Responses that use `##` and `###` show visible, properly styled section headings in both the side panel and the floating bubble.

---

## Phase 2: Frontend – list and blockquote styling (ChatGPT-like)

**Goal**: Lists and blockquotes look like ChatGPT: readable spacing and alignment.

**Current state**:
- **SideChatPanel**: `ul`/`ol` use `paddingLeft: 0` and `listStylePosition: 'inside'`, which can look cramped.
- **FloatingChatBubble**: Lists have `paddingLeft: '14px'`; blockquote has a left border.

**Tasks**:

1. **SideChatPanel.tsx** – list components (around 1009–1015)
   - Set `paddingLeft: '20px'` (or similar) for `ul` and `ol`.
   - Set `listStylePosition: 'outside'` so bullets/numbers sit outside the content block.
   - Optionally add a small `marginBottom` to `li` if not already sufficient for readability.

2. **FloatingChatBubble.tsx** – list and blockquote (around 910–952)
   - Align list styling with the same idea: `paddingLeft` so list markers are clear, and `listStylePosition: 'outside'` if appropriate for the compact layout.
   - Keep or slightly tune blockquote (left border, padding, color) so definitions or quoted text are clearly distinct.

**Acceptance**: Numbered and bullet lists are easy to scan; blockquotes are visually distinct and readable.

---

## Phase 3: Frontend – label-value separation (bold section on its own line)

**Goal**: When the model outputs “**Short Title:** Description on same line…”, we optionally normalize so the description starts on the next line for a more ChatGPT-like layout.

**Current state**:
- `ensureParagraphBreaksBeforeBoldSections` in SideChatPanel adds `\n\n` only when the pattern is preceded by `. ` or ` - ` (e.g. after a sentence or dash). It does not handle “**Label:** Description…” on one line.

**Tasks**:

1. **SideChatPanel.tsx**
   - Add a small helper, e.g. `ensureNewlineAfterBoldLabel(text: string)`, that inserts a double newline after `**Something:**` when followed by non-whitespace (so the following text becomes a new paragraph). Use a regex that avoids breaking in the middle of markdown (e.g. only when the next character is a letter or number).
   - Run this after `ensureParagraphBreaksBeforeBoldSections` (or combine into one pass) in the same pipeline that produces `textWithCitationPlaceholders`.
   - Ensure this runs on the string before citation processing so placeholders are not corrupted.

2. **FloatingChatBubble.tsx**
   - If the bubble receives the same `message.text` as the side panel, no change. If it receives raw text and does its own preprocessing, add the same “newline after **Label:**” step before passing to ReactMarkdown.

**Acceptance**: Responses with “**Short Title:** The full title is…” render with “Short Title” as a bold line and “The full title is…” as a separate paragraph below.

---

## Phase 4: Frontend – citation style (optional normalizer)

**Goal**: Circled or superscript-style references are normalized to a single citation style (e.g. `[1]`) so the UI is consistent and clickable.

**Current state**:
- Citations are already processed as `[1]`, `[2]`, etc., and placeholder components render them. Some content may still contain Unicode circled numbers (①②) or superscript digits (¹²³) from pasted or legacy content.

**Tasks**:

1. **SideChatPanel.tsx** (in the text pipeline before `processCitationsBeforeMarkdown`)
   - Add an optional normalizer that maps Unicode circled numbers (①–⑳ or similar) and common superscript digits to `[1]`, `[2]`, etc., so they can be picked up by the existing citation logic if desired. Only do this if you have a clear mapping and do not conflict with existing `[n]` patterns.
   - Alternatively, document that citations should be `[1]` in prompts and skip this step if no circled numbers appear in practice.

**Acceptance**: If you implement it, any circled/superscript references in the text are consistently shown as the same citation style as `[1]`, `[2]`.

---

## Phase 5: Backend – prompts for structure and citations

**Goal**: Model output consistently uses a main title, headings, label on own line, numbered lists for provisions, and `[1]`-style citations; avoid orphan lines.

**Current state**:
- `system_prompts.py` (TASK_GUIDANCE) already encourages `##`, `###`, bullets, bold, short paragraphs.
- `prompts.py` (`get_response_formatting_prompt`) enforces # / ## / ### and vertical “**Label:**\nValue”.
- `agent_node.py` (generate_conversational_answer) has Markdown and list-formatting rules.

**Tasks**:

1. **backend/llm/utils/system_prompts.py**
   - In the “MARKDOWN FORMATTING” / “OUTPUT STRUCTURE” section, add explicit guidance:
     - Start with a clear main title when the response is a structured overview (e.g. “Use a single `#` heading at the top when the answer is a structured overview or has multiple sections”).
     - For “key provisions” or list-of-points style answers, use a **numbered list** (1., 2., 3.) with each item’s title as a **bold** or subheading, and the description on the next line(s).
     - Use `##` for main sections and `###` for subsections so the hierarchy is clear.
   - Add one line on citations: “Use inline citation markers like [1], [2] immediately after the fact; do not use circled numbers or superscript for citations.”

2. **backend/llm/prompts.py** – `get_response_formatting_prompt`
   - Under “FORMATTING STANDARDS” or “CANONICAL TEMPLATE”, add:
     - “Start with one main # heading for the topic when the response is a structured overview.”
     - “For lists of provisions or key points: use a numbered list (1., 2., 3.); put each provision title on its own line (or as ###), then the description in the following paragraph.”
     - “Avoid orphan lines: do not leave a short fragment (e.g. ‘of 2025’) on a line by itself; attach it to the previous sentence or heading.”
   - Keep existing citation rules ([1], [2], no periods before citations).

3. **backend/llm/nodes/agent_node.py** – `generate_conversational_answer`
   - In “FORMATTING RULES” or “Markdown Features”, add a single line: “When the answer has multiple key points or provisions, use a clear # title and numbered list (1., 2., …) with bold or ### for each point’s title and description on the next line.”

**Acceptance**: New or formatted responses tend to have a main title, proper ##/### hierarchy, label-value on separate lines, numbered lists for provisions, and [1]-style citations without orphan fragments.

---

## Phase 6: Optional – orphan line cleanup (frontend or backend)

**Goal**: Single-word or very short orphan lines (e.g. “of 2025”) are merged with the previous line so the response doesn’t look broken.

**Tasks**:

1. **Option A – Frontend** (e.g. SideChatPanel text pipeline):
   - Add a helper that detects “orphan” lines: a line that is very short (e.g. &lt; 20 characters, no sentence-ending punctuation) and preceded by a line that ends with a comma or “of” or similar. Merge the orphan into the previous line with a space. Apply this only to plain-text lines (e.g. not inside code blocks or list items) to avoid breaking markdown.
   - Run after other text normalization and before citation processing.

2. **Option B – Backend**:
   - In the formatting prompt, add: “Do not leave a single short phrase on its own line when it clearly belongs to the previous sentence (e.g. ‘of 2025’ should follow the previous line).”

**Acceptance**: Orphan fragments like “of 2025” no longer appear on a separate line when the source is under our control (prompt) or after frontend cleanup.

---

## Implementation order

| Order | Phase | Rationale |
|-------|--------|-----------|
| 1 | Phase 1 – Headings | Quick win; headings are currently hidden and are central to ChatGPT-like structure. |
| 2 | Phase 2 – Lists & blockquotes | Purely styling; no prompt or text changes. |
| 3 | Phase 5 – Backend prompts | Ensures new/refreshed content is generated with the right structure. |
| 4 | Phase 3 – Label-value newline | Improves layout for existing and new content. |
| 5 | Phase 4 – Citation normalizer | Optional; only if you see circled/superscript refs. |
| 6 | Phase 6 – Orphan cleanup | Optional polish; can be backend-only. |

---

## Files to touch (summary)

- **frontend-ts/src/components/SideChatPanel.tsx**: Enable and style `h2`/`h3`; adjust `ul`/`ol`/`li`; add `ensureNewlineAfterBoldLabel` (and optional citation normalizer + orphan cleanup).
- **frontend-ts/src/components/FloatingChatBubble.tsx**: Enable and style `h2`; optionally apply same newline-after-bold-label and list/blockquote tweaks.
- **backend/llm/utils/system_prompts.py**: Add main title, numbered provisions, ##/###, and citation-style guidance.
- **backend/llm/prompts.py**: Add main title, numbered provisions, label-on-own-line, and no-orphan-line to formatting prompt.
- **backend/llm/nodes/agent_node.py**: Add one line on # title and numbered list for multi-point answers.

---

## Testing

- Manually: Ask a question that triggers a multi-section or “key provisions” style answer; confirm main title, ##/###, numbered list, label-value separation, and [1] citations in both FloatingChatBubble and SideChatPanel.
- Regression: Ensure existing citations and <<<MAIN>>> highlighting still work; ensure streaming and non-streaming paths both use the updated components and preprocessing.

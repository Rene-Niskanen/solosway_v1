---
name: ""
overview: ""
todos: []
isProject: false
---

# USER.md dialog UI redesign

## Scope (agreed)

- Redesign the USER.md (user context) dialog in [ProjectsPage.tsx](frontend-ts/src/components/ProjectsPage.tsx) to match the reference layout: **single toolbar row** + separator + content area.
- **No** custom overlay (no light gradient behind popup).
- **No** extra “white rounded panel, soft shadow” styling beyond default dialog.
- **No** “Save as draft” button — only one green **Save** (save and close).
- **No** Image button or “insert image by URL” — toolbar has no image control.

## Toolbar (one row)

- **Left:** Hamburger menu icon + label “User context (USER.md)”.
- **Middle:** Paragraph dropdown (Paragraph, H1, H2, bullet list), **B** (bold), *I* (italic), alignment (left / center / right).
- **Right:** Single green **Save** button (save and close).

## Toolbar behavior (for user.md)

- **Paragraph dropdown:** Insert at line/selection: nothing, `#` , `##` , `-`  (markdown).
- **Bold:** Wrap selection in `**`; if no selection, insert `**|`** and place cursor in the middle.
- **Italic:** Wrap selection in `*`.
- **Alignment:** Local state; apply `text-left` / `text-center` / `text-right` to the textarea (visual only in editor).

## Content area

- Thin separator below toolbar.
- Optional short hint (“This text is shown to Velora…”) can stay subtle or move to menu.
- Textarea: controlled, same API; character count and errors below.
- Keep existing load/save/error handling and `getBootstrapUserContext` / `putBootstrapUserContext`.

## Files to change

- [frontend-ts/src/components/ProjectsPage.tsx](frontend-ts/src/components/ProjectsPage.tsx): Add toolbar row, alignment state, textarea ref, Paragraph/Bold/Italic/alignment handlers; single Save button; no Image, no Save as draft.


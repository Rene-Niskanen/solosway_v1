# Searching step UI: match Google’s (overlap + border)

## Correction

Google’s “Searching” icons **overlap** (they are not separate with gaps). Our current carousel already uses an overlapping layout (`OVERLAP_PX = 10`, negative margin, `zIndex: i`). **Keep the overlapping behaviour**; do not switch to side-by-side with gaps.

## Changes to make

### 1. Border colour only

In [frontend-ts/src/components/SearchingSourcesCarousel.tsx](frontend-ts/src/components/SearchingSourcesCarousel.tsx):

- In the circle wrapper `span` (around line 185), change:
  - `border: '1px solid #E5E7EB'` → `border: '1px solid #FCFCF9'`
- `#FCFCF9` is the chat background colour used in the app, so the circle border will read as a soft, translucent edge and blend with the background.

### 2. Leave layout as-is

- **Overlap**: Keep `OVERLAP_PX`, negative `marginLeft`, and `zIndex: i` so icons stack/overlap like Google’s.
- **Max 3 visible**: Already correct (viewport shows 3 at a time; strip of 4 used only for slide animation).
- No changes to `CONTAINER_WIDTH_PX`, `SLOT_WIDTH_PX`, or animation logic.

## Summary

Single change: set circle border to `#FCFCF9` in `SearchingSourcesCarousel.tsx`. Overlapping layout stays as it is.

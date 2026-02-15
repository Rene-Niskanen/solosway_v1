# Pipeline popup: narrower card, per-step times, footer summary

## Goal

1. **Narrower card** – Reduce width to remove wasted space.
2. **Per-step duration** – Show the time each step took next to each stage (e.g. "Classify · 2s").
3. **Footer commentary** – When complete, show a short summary: total extraction time and total chunks generated.

---

## 1. Narrower card

**File:** [frontend-ts/src/components/PipelineStagesHoverPreview.tsx](frontend-ts/src/components/PipelineStagesHoverPreview.tsx)

- Reduce `CARD_WIDTH` from 280 to **220** (or 240). This keeps the five stage labels and a compact progress area without excess horizontal space.
- Optionally reduce horizontal padding in header and body (e.g. 16px to 12px) so content is proportional to the new width.
- Keep `CARD_MIN_HEIGHT` or adjust slightly if the new footer adds height.

---

## 2. Per-step duration

**Data:** Backend already returns `pipeline_progress.history` with `duration_seconds` and `step_name` per record (from [DocumentProcessingHistory.serialize()](backend/models.py)). Map backend step names to the 5 UI stages (Classify → classification, Extract → extraction, Normalize → normalization, Link → linking, Index → vectorization) and take each step’s `duration_seconds`.

**PipelineStagesHoverPreview:**

- Extend props with optional `stageDurations?: (number | null)[]` (length 5). `null` or missing = no duration for that stage.
- In the stage list, for each completed stage with a duration, show it next to the label (e.g. "Classify · 2s" or "Classify" with a small grey "2s" to the right). Use compact formatting (e.g. "Xs" for seconds, "Xm Xs" only if needed).

**FilingSidebar:**

- When building props for the popup, compute `stageDurations` from `pipelineProgress?.history`: map each backend step to a UI stage index and set `stageDurations[index] = record.duration_seconds`. For full pipeline use 1:1 mapping; for minimal pipeline only stages 0 and 1 have backend steps (classification, minimal_extraction).
- Pass `stageDurations` into `PipelineStagesHoverPreview`.

**Types:**

- In PipelineStagesHoverPreview (or shared type), extend `PipelineProgressData.history` so each item may include `duration_seconds?: number`. FilingSidebar already receives the API response; ensure the type used for `pipeline_progress.history` includes `duration_seconds`.

---

## 3. Footer commentary (total time + chunks)

**Copy (when complete):** Two lines at the bottom of the card, e.g.  
- "The document has successfully gone through full extraction in a total time of: **Xs**."  
- "**X** chunks generated."  
Use friendly wording; if chunk count is missing, show only the total time line or "Chunks: —".

**Data:**

- **Total time:** Sum of `stageDurations` (or sum of `pipeline_progress.history[].duration_seconds`) when complete. Pass as optional prop `totalDurationSeconds?: number` from FilingSidebar so the component stays presentational.
- **Chunk count:** Not currently in the status API response. The document in Supabase has `document_summary.reducto_chunk_count` (or similar) set by [tasks](backend/tasks.py). The status endpoint returns `document` from `doc_service.get_document_by_id()` but only sends `status`, `classification_type`, `classification_confidence`, and `pipeline_progress` to the client.

**Backend (minimal change):**

- In [views.py](backend/views.py) `get_document_status`, add to the response `data` a field `chunk_count`: from `document.get('document_summary') or {}` then `document_summary.get('reducto_chunk_count')` (or equivalent). Send as a number or `null` if missing. This avoids sending the whole `document_summary`.

**Frontend:**

- PipelineStagesHoverPreview: optional props `totalDurationSeconds?: number` and `chunkCount?: number | null`. When `isComplete` and at least one of these is present, render a footer section (e.g. light grey band or subtle top border, small font) with the two lines. Omit "chunks" line if `chunkCount == null` or undefined.
- FilingSidebar: when rendering the popup, pass `totalDurationSeconds` (sum of history durations or of `stageDurations`) and `chunkCount` from the last status response (e.g. `response.data.chunk_count`) when available.

---

## 4. Summary

| Change | Where | Action |
|--------|--------|--------|
| Narrower card | PipelineStagesHoverPreview | CARD_WIDTH 280 → 220 (or 240); optional padding 16 → 12 |
| Per-step time | PipelineStagesHoverPreview + FilingSidebar | New optional prop `stageDurations`; show "· Xs" per completed stage; FilingSidebar derives from pipeline_progress.history |
| Footer | PipelineStagesHoverPreview + FilingSidebar + backend | New optional props `totalDurationSeconds`, `chunkCount`; footer with total time and chunks when complete; backend status response includes chunk_count from document_summary |
| Types | PipelineProgressData / status response | history[].duration_seconds; data.chunk_count |

---

## 5. File list

- [frontend-ts/src/components/PipelineStagesHoverPreview.tsx](frontend-ts/src/components/PipelineStagesHoverPreview.tsx) – width, padding, stageDurations display, footer block, new props.
- [frontend-ts/src/components/FilingSidebar.tsx](frontend-ts/src/components/FilingSidebar.tsx) – compute stageDurations and totalDurationSeconds from pipelineProgress; pass chunkCount from status response; pass new props to preview.
- [backend/views.py](backend/views.py) – in `get_document_status`, add `chunk_count` to response `data` from document’s document_summary when available.

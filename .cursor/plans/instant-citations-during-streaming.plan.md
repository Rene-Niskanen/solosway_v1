---
name: Instant citations during streaming
overview: Run the citation pipeline incrementally during the responder's LLM stream so citation events are emitted as each citation appears; clean up the existing fake/pending citation UI so it does not conflict with the new behavior.
todos:
  - id: views-buffer
    content: "Views: create citation_events_buffer, add to config, drain after each event and yield citation SSE"
    status: pending
  - id: responder-callback
    content: "Responder: read buffer from config, pass callback into generate_answer_with_direct_citations"
    status: pending
  - id: stream-loop-extract
    content: "Stream loop: run extraction on buffer after each chunk, emit new citations via callback"
    status: pending
  - id: frontend-cleanup
    content: "Frontend: remove or simplify PENDING/fake citation logic so it does not conflict"
    status: pending
isProject: false
---

# Instant citation rendering during streaming

## Goal

1. Call the citation pipeline each time a citation marker appears in the streamed text (instead of only at the end), and emit citation events immediately so the frontend can render clickable pills during streaming.
2. Clean up the existing "fake citation during streaming" logic so there is no conflicting behavior once real citations arrive incrementally.

---

## Part 1: Backend – incremental citation emission

### Approach

Use a **shared buffer** passed through the graph config: the responder appends citation events to it as it streams; views.py drains the buffer after each graph event and yields those events to the client.

- **Before stream:** views creates `citation_events_buffer = []` and sets `config_dict["citation_events_buffer"] = citation_events_buffer`.
- **Event loop:** after processing each event from `astream_events`, views drains `citation_events_buffer` and yields each item as a citation SSE event (`data: {"type": "citation", ...}\n\n`).
- **Responder:** reads buffer from `runnable_config`, passes it (or an `on_citation_resolved` callback that appends to it) into `generate_answer_with_direct_citations` and thence into `generate_conversational_answer_with_citations`.
- **Stream loop:** in `generate_conversational_answer_with_citations`, after each chunk append to `full_content`, run `extract_citations_with_positions(full_content, short_id_lookup, metadata_lookup_tables)`, track already-emitted citations by position, assign sequential numbers for new ones, format and append one event per new citation to the buffer.

### Files and changes


| File                                                                       | Changes                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [backend/views.py](backend/views.py)                                       | Create `citation_events_buffer`, put in config, drain after each event and yield citation SSE events. Handle both main and any retry stream paths.                                                                                      |
| [backend/llm/nodes/responder_node.py](backend/llm/nodes/responder_node.py) | Read buffer from config; pass buffer/callback from `responder_node` into `generate_answer_with_direct_citations`; add optional params and incremental extraction + emit in `generate_conversational_answer_with_citations` stream loop. |


### Details (backend)

- **Event shape:** Same as today: `{"type": "citation", "citation_number": N, "data": { "doc_id", "document_id", "page", "bbox", "method", "block_id", "cited_text", "original_filename" }}`.
- **Idempotency:** Track emitted citations by `(start_position, end_position)` (or stable id); only emit once per citation. Number by order of position in current buffer.
- **Partial markers:** If buffer ends mid-marker, regex won't match; next chunk will complete it.
- **No buffer:** If `citation_events_buffer` is None, keep current behavior (no callback, citations only at end).
- **Final batch:** Responder still returns same `chunk_citations`; complete event unchanged.

---

## Part 2: Frontend – clean up fake citation logic

Once citation events are emitted during streaming, `message.citations` will be populated as each citation appears. The current "fake" (PENDING) path was added so that when citation data was not yet available, we still showed a pill that looked like the final one to avoid a visual snap. With incremental events, that gap is minimal or absent, so the PENDING path can be simplified to avoid two competing ways of rendering citations.

### Current logic to adjust

**File:** [frontend-ts/src/components/SideChatPanel.tsx](frontend-ts/src/components/SideChatPanel.tsx)

1. **processCitationsBeforeMarkdown** (~1348–1404)
  - Replaces `[N]` with `%%CITATION_BRACKET_N%%` when `citations[N]` exists, else `%%CITATION_PENDING_N%%`.  
  - With incremental streaming, `citations[N]` will usually exist by the time `[N]` is rendered; PENDING is only for a brief window or dropped event.
2. **renderCitationPlaceholder** (~1419–1478)
  - For `%%CITATION_PENDING_*%%`: if `citations[num]` exists, render `CitationLink`; else render a **gray pill** styled to match `CitationLink` ("fake" so streaming looks like final form).  
  - For `%%CITATION_BRACKET_*%%` / `%%CITATION_SUPERSCRIPT_*%%`: render `CitationLink` when data exists.

### Cleanup approach

- **Single placeholder type when data is missing:** Keep using a placeholder (e.g. `%%CITATION_PENDING_N%%`) when `citations[N]` is not yet available so we never flash raw `[N]`. Do **not** render a fake pill that visually matches `CitationLink`; instead render a **minimal fallback** (e.g. a simple `[N]` in brackets, or a small neutral pill that is clearly not clickable). This removes the "two ways to show a citation" conflict: either we have data → `CitationLink`, or we don’t → minimal placeholder.
- **Simplify renderCitationPlaceholder:** For PENDING, if `citations[num]` exists (e.g. event arrived between render and now), render `CitationLink`. Otherwise render the minimal fallback only. Remove the gray pill that deliberately matched CitationLink size/style.
- **flushSync in onCitation:** Keep the `flushSync` around the citation merge in the main stream’s `onCitation` handler so citation updates commit before the complete event. No conflict with incremental events; it only helps when multiple citation events and complete arrive in the same tick.
- **Comments:** Update comments that refer to "fake pill" or "match final form during streaming" to state that citations are now supplied during streaming and the placeholder is only for the brief case where data is not yet available.

### Optional (if minimal fallback feels too plain)

- Keep a single, clearly non-clickable placeholder style (e.g. muted `[N]` or a small gray pill) that is **visually distinct** from `CitationLink` so users don’t try to click it. Avoid duplicating CitationLink’s exact styling so there is no conflicting "fake" path.

### Summary of frontend cleanup

- Retain: placeholder replacement so we never show raw `[1]`; `CitationLink` when `citations[N]` exists; flushSync when merging citations.
- Remove/simplify: the fake pill that matches `CitationLink` style for PENDING; replace with a minimal fallback when data is missing.
- Result: one clear rule — has citation data → clickable pill; no data → minimal placeholder. No conflicting "fake" rendering once the instant-citation backend is in place.


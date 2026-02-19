---
name: ""
overview: ""
todos: []
isProject: false
---

# Robust implementation plan: streaming + citation efficiency

## Goal

Fix the three issues (9s no text, citation PDF storm, duplicate loads) without breaking responses. Every change must preserve final answer quality, citation correctness, and message completion behavior.

---

## Principles

- **Never destroy responses:** Final text, citation numbers, and citation data must match current behavior. Streaming is an optimization for time-to-first-token; completion payload (final_summary, citations) must still be correct.
- **Fallback on failure:** If streaming fails (e.g. LLM stream error), fall back to the existing non-streaming path and send the full answer when ready.
- **Single source of truth:** One place triggers preview load; one place writes final_summary and citations. Remove duplicate paths and dead code.
- **Incremental rollout:** Backend streaming can be feature-flagged (e.g. env or request flag) so it can be turned off if issues appear.

---

## Phase 1: Backend – true token streaming (without breaking responses)

### 1.1 Current behavior to preserve

- Responder returns `final_summary` (formatted answer with `[1]`, `[2]` etc.), `chunk_citations` (list of citation dicts with doc_id, page, bbox, cited_text, original_filename, etc.), and `personality_id`.
- View captures these from the responder node output, then yields citation events and chunks of `final_summary` as `type: 'token'`, and at the end sends a complete event with summary + citations.
- Frontend and history expect one final message with full text and citations.

### 1.2 Streaming approach (safe)

- **Constraint:** The current path uses structured output (`PersonalityResponse`: `response` + `personality_id`). Streaming and structured output cannot be done in one call.
- **Approach:** Add a **streaming path** that uses `llm.astream()` (no structured output) with the **same** system/human prompt as today. As chunks arrive, the view yields `type: 'token'` so the client shows text immediately.
- **After stream ends:** Use the **accumulated** full content and run the **existing** citation pipeline on it:
  - `extract_citations_with_positions(accumulated_content, short_id_lookup, metadata_lookup_tables)`
  - Sort by position, assign citation numbers 1,2,3…
  - `replace_ids_with_citation_numbers(accumulated_content, citations)`
  - `format_citations_for_frontend(citations)`
- So citation extraction and formatting are unchanged; only the way we get the raw LLM text changes (streamed vs one shot).
- **Personality:** When streaming, set `personality_id = DEFAULT_PERSONALITY_ID` (or keep previous turn’s). Optionally later add a tiny follow-up call to infer personality from the streamed text if needed. Document that streaming mode uses default/previous personality.
- **Final payload:** When the stream finishes, set `final_result['final_summary'] = accumulated_content` (after ID replacement) and `final_result['chunk_citations']` / processed citations, then yield citation events and the same `complete` payload as today. This keeps history and frontend unchanged.

### 1.3 Implementation steps (backend)

1. **responder_node.py**
  - Add a helper e.g. `generate_answer_with_direct_citations_streaming()` that:
    - Builds the same prompt as `generate_conversational_answer_with_citations()` but uses `llm.astream()` instead of `structured_llm.ainvoke()`.
    - Is an async generator that yields token chunks (or a callback that the view can pass to receive chunks).
  - In `responder_node`, when a streaming config/flag is set, call this streaming helper and return a marker (e.g. `streaming_answer: True`) plus the metadata needed for post-stream citation extraction (e.g. `short_id_lookup`, `metadata_lookup_tables`, `chunks_metadata`). The view will consume the stream and then run citation extraction in the same process.
  - **Simpler alternative:** Keep the responder node as-is (returns full answer). In the **view**, add a parallel path: when the graph is about to run the responder, optionally start a **separate** streaming LLM call with the same prompt and pipe its tokens to the client; when the responder node **finishes**, ignore the streamed copy for the final payload and use the responder’s `final_summary` and `chunk_citations`. That way the responder contract is unchanged and we only add a “preview” stream. Downside: two LLM calls per request. Prefer the first approach (streaming inside responder, then post-stream citation extraction) to avoid double cost.
2. **views.py**
  - In the event loop where you handle responder / RunnableSequence output:
    - If streaming: consume the stream from the responder (or from the generator), yield each chunk as `data: {"type": "token", "token": chunk}\n\n`, and accumulate into `accumulated_summary`.
    - When the stream ends, run citation extraction (reuse the same functions from responder_node or import them) on `accumulated_summary`, then yield citation events and set `final_result['final_summary']` and `final_result['chunk_citations']` from that. Then continue with the rest of the loop (complete event, etc.).
  - **Fallback:** If streaming is disabled (flag/env) or if the streaming call raises, run the existing non-streaming responder path and send the full answer when ready (current behavior). No change to final payload shape.
3. **Feature flag**
  - Add e.g. `STREAM_LLM_TOKENS=true` (env) or a request body flag. When false or unset, use current `ainvoke` path only. This allows quick rollback.

### 1.4 What not to break

- Citation numbers and order (1, 2, 3 by appearance).
- Citation payload (doc_id, page, bbox, cited_text, original_filename).
- final_summary content (same formatting, same [1] [2] in text).
- Complete event and message persistence (same structure as today).

---

## Phase 2: Frontend – defer and deduplicate citation preview load

### 2.1 Single trigger for preview load

- **Today:** Both `onCitation` (in streaming handlers) and `CitationCallout`’s `useEffect` call `preloadHoverPreview(docId, pageNum)`. That causes duplicate requests.
- **Target:** Only **CitationCallout** should trigger the load, and only when the preview is actually needed (deferred, see below). Remove all `preloadHoverPreview` calls from `onCitation` in:
  - The main streaming path (~8710),
  - The initial-query path (~10849),
  - Any other path that calls it (e.g. ~5724 if it’s for the same purpose).
- **Keep** `preloadHoverPreview` in:
  - CitationCallout (when we decide to load, see 2.2),
  - CitationClickPanel / citation panel open flow (when user opens the panel we need the image),
  - Any “View in document” or export path that explicitly needs the full PDF (e.g. saveCitationForDocx). Those are on-demand and not triggered by every citation event.

### 2.2 Defer load in CitationCallout

- **Today:** `useEffect` runs as soon as the callout mounts and calls `preloadHoverPreview` if `canShowPreview` is true.
- **Change:** Do **not** call `preloadHoverPreview` on mount. Instead:
  - **Option A (recommended):** Load when the callout enters the viewport. Use `IntersectionObserver` on the callout root; when `isIntersecting` becomes true, call `preloadHoverPreview` and set state so the preview image appears when ready. Unobserve on unmount.
  - **Option B:** Load when the user hovers the callout (or focuses it). Reduces work further but preview appears slightly later.
  - **Option C:** Load after a short delay (e.g. 1–2 s) after mount, or after the parent reports “stream ended” (if available). Simpler but less precise than viewport.
- Keep the same cache and promise-dedup logic: `hoverPreviewCache` and `hoverPreviewLoadingPromises` so that when we do load, we still avoid duplicate requests.

### 2.3 Optional: lighter preview (backend thumbnail)

- **Later:** Add an endpoint e.g. `GET /api/documents/<id>/page/<n>/thumbnail` that returns a small image (or use an existing one if you have it). In CitationCallout, when loading preview, first try the thumbnail URL; only if missing or for “View in document” use the full PDF path. This is a separate, smaller change and can be Phase 3.

### 2.4 Cleanup

- Remove every `preloadHoverPreview(docId, pageNum).catch(() => {})` (and similar) from the `onCitation` callbacks in SideChatPanel (all streaming paths). Search for `preloadHoverPreview` and remove calls that are only “preload on citation received.”
- Ensure `CitationCallout` is the only component that starts a preview load for the inline card (except panel open / export as above). Document in code that “preview load is triggered only by CitationCallout (deferred) or when opening citation panel / export.”

---

## Phase 3: Backend / frontend – no duplicate requests

### 3.1 Already present

- `hoverPreviewLoadingPromises` and `hoverPreviewCache` in SideChatPanel ensure that if two callers ask for the same (docId, pageNum), the second awaits the first and gets the cached result. So once we have a single trigger (CitationCallout only), duplicate requests from the frontend disappear.

### 3.2 Verify

- After Phase 2, run a query that returns multiple citations from the same document. Confirm in network tab that each (document_id, page) appears at most once for the inline preview. Citation panel open and “View in document” may still request the full PDF; that is expected and once per user action.

---

## Phase 4: Testing and rollback

### 4.1 Response correctness

- For a fixed query that returns citations:
  - With streaming **on:** Compare final message in UI (and in history if applicable) with the message when streaming is **off**. Text and citation numbers and “View in document” behavior must be the same.
- Test fallback: disable streaming (flag/env) and confirm behavior matches current production (no regression).

### 4.2 Performance

- With streaming on: measure time to first token (TTFT) and full response time. TTFT should drop sharply; full response time may be similar or slightly better.
- With deferred preview: confirm no full-PDF requests for citation callouts until they enter viewport (or your chosen trigger). Confirm no duplicate document_id requests for the same page.

### 4.3 Rollback

- Backend: set `STREAM_LLM_TOKENS=false` (or equivalent) to use only the non-streaming path.
- Frontend: if needed, revert CitationCallout to “load on mount” and re-add preload in onCitation (not recommended long term; only for emergency rollback).

---

## Summary checklist

- **Backend:** Add streaming path (astream + post-stream citation extraction), preserve final_summary and chunk_citations shape and content.
- **Backend:** Fallback to ainvoke path on stream error or when flag disabled.
- **Backend:** Feature flag for streaming (env or request).
- **Frontend:** Remove preloadHoverPreview from all onCitation handlers.
- **Frontend:** CitationCallout triggers preview load only when deferred condition is met (e.g. viewport visible); keep cache and promise dedup.
- **Cleanup:** No leftover preload calls; single trigger documented.
- **Testing:** Response equality (streaming vs non-streaming); TTFT and no duplicate PDF requests; rollback verified.

This plan keeps responses intact, removes duplicate work and leftover triggers, and makes the three fixes (streaming, deferred/lightened previews, single load) possible without destroying behavior.
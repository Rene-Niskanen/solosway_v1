# Pull Request Summary

**Branch:** `velora/working-well-new-version.streaming` → main

---

| **Backend** | **Frontend** | **Infra** |
|-------------|--------------|-----------|
| Graph & retrieval | Mem0 | Docker, env, workflows |
| Citations & evidence | Response streaming | Migrations |
| Prompts & config | Save citations | Docs |
| | Citation pop-up | |
| | Document preview | |
| | Bbox highlights | |
| | Word export | |
| | Chat bar & search | |

---

## Why responses feel quicker

- **Streaming (SSE):** Plan → reasoning → thinking → answer stream incrementally. “Analysing…” and pipeline-stage updates stay in sync so the UI doesn’t feel stuck. Users see content within 1–2s instead of waiting for the full response.
- **Two-level retrieval:** Find documents first (hybrid search on summaries), then search chunks *only* in those docs. Smaller, focused chunk search and better relevance. “Summarize” queries get all chunks in page order instead of over-fetching.
- **Chip path:** With documents already chosen (@-mention or property chips), the planner is skipped and we use a 1-step plan (retrieve_chunks only). No planner LLM → retrieval starts sooner.
- **Force chunk step:** If the agent has docs but no chunks, the graph runs chunk retrieval once before the responder. Avoids failed answers and retries.

---

## Backend

**Graph & orchestration**  
Planner → Executor → Responder. Planner emits steps (e.g. retrieve_docs, retrieve_chunks); executor runs them as tool calls; responder turns chunks into answer + citations. When docs exist but no chunks, a “force chunk” step runs so the model always has passage-level context.

**Two-level retrieval**  
1. **Documents:** Hybrid (vector on summary embeddings + keyword on summary/filename/metadata), score fusion → document IDs.  
2. **Chunks:** Within those docs only — vector (`match_chunks` RPC) + keyword on chunk text; “summarize” = all chunks in page order. Merge, dedupe, rerank to top 8–15. Query type (fact/explanation/summary) sets top_k and thresholds.

**Citations & evidence**  
Mapping, evidence extractor, document store, validators. Citations are structured and traceable to chunks/pages.

**Prompts & config**  
Modular prompt files (agent, planner, responder, routing, personalities, human templates). Auth, Supabase, vector/embeddings, checkpointer; new services (summaries, key facts, section headers).

---

## Mem0 integration

**What it is**  
Persistent user memory via Mem0. `search(query, user_id)` returns relevant memories; `add(messages, user_id)` stores a turn for fact extraction/dedup. Configurable storage (default Qdrant on-disk). Search has a short timeout (e.g. 2s) so it doesn’t block replies.

**What gets stored**  
Custom fact-extraction prompt: only facts *about the user* (name, role, preferences, style, location). Not document content (EPC, valuations, contract terms, filenames). “I’m Thomas, property management” → stored; “The valuation says 450k” → not stored.

**How it’s used**  
- **Conversation:** Before the reply we search and inject a few memories (e.g. 5) into the system prompt (“What you know about this user”). Model uses them naturally, never mentions “memory” or “recalling.”  
- **Document (responder):** Optional memory search so answers can be personalised (“Given you prefer concise…”).  
- **After each turn:** Fire-and-forget `add([user_msg, assistant_msg], user_id)` so Mem0 extracts new facts. Non-blocking; errors logged only.

**Result**  
Follow-ups and new sessions can use name, preferences, and past context; document answers can match stated style.

---

## Conversation mode and personality (no retrieval every time)

**Intent classification**  
After context_manager we run `classify_intent(state)` → `"conversation"` or `"document"`. Heuristic only (no LLM); we default to **document** so retrieval is never skipped by mistake.

- **→ document:** Files attached, property selected, or any doc/real-estate keyword (“search”, “valuation”, “EPC”, “lease”, “summarise”, “find”, “report”).  
- **→ conversation:** No files/property and: exact greeting (“hi”, “thanks”, “bye”…), or “hey velora”, or personal start (“who are you”, “what can you do”, “my name is”, “remember that i…”), or very short (≤3 words) with no doc keywords (“ok”, “cool”).

**Conversation path**  
Intent `"conversation"` → **conversation node** (not planner). Node: reads messages + optional Mem0 memories; builds system prompt (base role + conversation rules + writing/formatting + memories + personality instruction + previous personality); one LLM call with `PersonalityResponse` (personality_id + response); writes final_summary, personality_id, empty citations, appends message, → END. No planner, executor, or retrieve_docs/retrieve_chunks — ~1s instead of 6–12s.

**Conversation rules**  
Natural chat; no document search unless the user explicitly asks. Answer general questions from model knowledge; if the question needs their docs, offer to look it up. Never “based on the documents” in conversation mode. Use prior context and memories naturally, no “memory”/“recalling” wording.

**Personality**  
Same system in conversation and document responder: tone overlays (default, friendly, efficient, professional, nerdy, candid, cynical, listener, robot, quirky); pick one per turn (user request > first-message inference > previous). One call returns personality_id + response. “Be concise” or “be friendly” applies to following replies without triggering retrieval.

**Summary**  
Greetings and personal chat → conversation node → fast reply. Doc-style wording or attached files/property → full retrieval pipeline.

---

## Response streaming

SSE streams plan, reasoning, thinking, and answer. Execution events and pipeline stages stream too, so the frontend shows “Analysing…” and stage-specific UI (“Retrieving documents…”). First content appears sooner even if total time is unchanged.

---

## Save citations

CitationSaveMenuBar + CitationExportContext: save bbox screenshots or user-selected regions for export. Choose/copy flow per citation; data stored for Word. Helpers: crop page to bbox, add frame for citation images in the doc.

---

## Citation pop-up

Clicking a citation opens **CitationClickPanel** (side panel with document, page, and cited text/region). **CitationActionMenu** in the panel offers copy, insert, and related actions to reuse the citation elsewhere.

---

## Citation buttons and follow-up highlight

**CitationClickPanel** (side panel, bottom):  
- **Ask follow up** — Adds a citation-snippet chip to the input and sends citation context (doc, page, bbox, cited text) with the next query. An orange highlight in the response (see below) shows which part the follow-up refers to.  
- **View in document** — Opens the document in 50/50 view at the cited page with a bbox highlight; the citation stays highlighted (blue) in the chat while the document is open.  
- **Save** — Starts the save-citation flow (copy as image for Word export).

**CitationActionMenu** (floating menu on citation click):  
- **Ask a question** — Inline field "Ask follow up"; you type a question and submit. The query is sent with citation context and a citation-snippet chip can be added. The orange highlight then marks the text next to that citation.  
- **Save citation** — Save-citation flow. **Close** — Closes the menu.

**Orange highlight**  
When you use “Ask follow up” or “Ask a question”, a citation-snippet chip appears in the input. The run of text *immediately before* that citation in the response gets an orange/beige swoop highlight so you see which sentence or paragraph the follow-up is about. This is driven by citation-snippet chips: we store message id + citation number; any segment right before that citation number gets the orange background.

**CitationSaveMenuBar** (when saving for Word): **Copy** (FileText icon) — copy the citation as an image (bbox region); **Cancel** (X) — close the bar.

---

## New document preview design

DocumentPreviewCard + DocumentPreviewModal: consistent layout and styling. PreviewContext + preloaded covers where needed. Same preview in chat, filing sidebar, and property details.

---

## New bbox highlight design

Citation view: bbox overlay on the page marks the cited region. CitationClickPanel and DocumentPreviewModal use page/bbox/block data so the highlight lines up with what was cited.

---

## Open response as Word doc

Export response (+ optional citations) to .docx. citationExport: crop to bbox, frame citation images, build Word content. Option to include citation images (auto bbox or user region). docxPictureEffects for image formatting in Word.

---

## Chat bar & search UI

SegmentInput (property + document chips, @-mentions) on MapChatBar, SearchBar, SideChatPanel. ChatBarToolsDropdown: Search the web, Dashboard, Chat. ModeSelector, ModelSelector. Attach, Voice, WebSearchPill.

---

## Projects section

**ProjectsPage** shows project cards (folders) and a Files bar. Clicking a **project (folder)** opens a 50/50 split: property details on one side and chat on the other, so you can ask about that project’s documents without leaving the view. Clicking a **file** in the Files section does the same: it opens the document in 50/50 view with chat alongside, so you can start a conversation about that file immediately. Both flows use the same split layout and chat context (projects context, recent projects).

---

## Other frontend

PlanViewer, ReasoningSteps, ThinkingBlock, ExecutionTrace, AnalysingIndicator, FilingSidebar, AtMentionChip/Popover, etc. Contexts: Mode, Model, Projects, CitationExport, FilingSidebar, Feedback. status-chip + small UI tweaks.

---

## Infra & docs

Docker, .env.example, GitHub workflow. Migrations (embeddings, projects). Docs: TEST_QUERIES, RAG/data separation, setup, WhatsApp.

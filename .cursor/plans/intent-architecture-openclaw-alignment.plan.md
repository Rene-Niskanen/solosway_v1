# Intent Architecture Analysis & OpenClaw Alignment Plan

**Purpose:** Analyse the current intent architecture, cross-reference with OpenClaw (and the existing OpenClaw-style implementation plan), and define a plan to make the system more similar where beneficial.

---

## 1. Current Intent Architecture (Summary)

### 1.1 Two-Level Routing

| Layer | Where | Purpose |
|-------|--------|---------|
| **Fast router** | `route_query()` in `routing_nodes.py` | Execution path: navigation_action, attachment_fast, citation_query, direct_document, property_document, simple_search, complex_search. Decides *how* to run (skip expansion, skip retrieval, etc.). |
| **Intent classifier** | `classify_intent()` in `routing_nodes.py` | Conversation vs document: used **after** `context_manager`. Decides *whether* to hit the conversation node (no retrieval) or the document path (planner → executor → responder). |

Flow: **START → route_query → [fast paths] OR context_manager → classify_intent → conversation | document_cached | document_simple | document.**

### 1.2 Intent Classification Rules (Current)

- **Inputs:** `state` (user_query, document_ids, property_id, conversation_history).
- **Output:** `"conversation"` or `"document"`.
- **Order of rules:**
  1. **document_ids** present → `"document"`.
  2. **Conversation cues** (checked even with property): exact greetings (`_GREETING_EXACT`), “velora” greeting after strip, `_PERSONAL_STARTS`, word_count ≤ 3 → `"conversation"`.
  3. **property_id** present → `"document"`.
  4. **Doc keywords** (`_DOC_KEYWORDS`) in query → `"document"`.
  5. **Optional LLM fallback** (only when `config.use_llm_intent_fallback` and 4 ≤ word_count ≤ 25): call `get_query_classification_prompt`; labels `general_query` | `text_transformation` | `document_search` | `follow_up_document_search` | `hybrid`. Only `general_query` → `"conversation"`; all others → `"document"`.
  6. **Default** → `"document"` (conservative).

No other routing uses the fine-grained labels (text_transformation, follow_up_document_search, hybrid); they only affect the binary conversation vs document.

### 1.3 State & Conversation Context

- **conversation_history:** `Annotated[list[dict], operator.add]`. Entries from `summary_nodes` have `query`, `summary`, and optional `timestamp`, `document_ids`, etc.
- **prior_turn_content**, **format_instruction**, **use_cached_results:** used for turn context and cache-first path.
- **Turn context:** `system_builder._section_turn_context(mode, state)` derives turn_type (e.g. `initial_question`, `same_doc_follow_up`, `format_or_refine`, `conversation`) and reply_goal; prepended via `build_system_content(mode, state, ...)` in both conversation and responder paths.
- **Prior exchange:** In `responder_node`, `prior_exchange_summary` is built from `conversation_history[-1]` (or `prior_turn_content`), truncated with `MAX_PRIOR_QUERY_CHARS` (100) and `MAX_PRIOR_ANSWER_CHARS` (400), and passed as `conversation_context` into the block-citation `generate_conversational_answer_with_citations`, which injects it into the human message as “**Previous exchange:** … **Current user message:** …”.

### 1.4 Where Intent Touches the Graph

- **context_manager → classify_intent:** Decides conversation vs document (and document_cached / document_simple / document).
- **conversation_node:** Uses `build_system_content("conversation", state, ...)` (turn context + conversation system content); no prior-exchange block (conversation is standalone).
- **responder_node:** Uses `build_system_content("responder", state, ...)`; builds `prior_exchange_summary` and passes it as `conversation_context`; block-citation function uses both.

---

## 2. OpenClaw Cross-Reference

### 2.1 OpenClaw Concepts (Relevant to Intent & Context)

- **Input types (triggers):** Messages, heartbeats, cron, webhooks, hooks, agent-to-agent. Intent in OpenClaw is partly “what kind of input triggered this turn,” not only “conversation vs document.”
- **Single agent runtime:** One loop: assemble context → LLM → execute tools → persist. No separate “conversation” vs “document” graph branches; one agent with tools.
- **Context vs memory:** Context = temporary (recent messages, tool outputs, system instructions). Memory = persistent (prior session summaries, preferences, daily notes). Clear separation.
- **Composite prompting:** Workspace files (USER.md, IDENTITY.md, SOUL.md, AGENTS.md, TOOLS.md); skills injected at runtime; not dumping everything into the prompt.
- **Session & lane queue:** Session-scoped state; serialised handling per session.

### 2.2 Mapping to Your System

| OpenClaw | Your system |
|----------|-------------|
| Input types | Partially: messages (and property/attachments) drive routing; no heartbeats/cron/webhooks/hooks/agent-to-agent as first-class triggers. |
| Single agent vs branches | You have **two** high-level branches: conversation (no tools) and document (planner → executor → responder with tools). OpenClaw is single-agent with tools. |
| Context vs memory | You have: **context** = turn context + prior exchange + workspace + current message; **memory** = Mem0 (persistent). Aligned in spirit. |
| Composite prompting | You have: system_builder (turn context) + conversation/responder prompts + workspace + Mem0. Skills/tools are not “discovered and injected” by intent; they’re fixed per path. |
| Session | You have session_id, conversation_history, checkpointer. Aligned. |

### 2.3 Existing “OpenClaw-Style” Plan (Already Implemented)

The plan in `openclaw-intent-conversation-implementation.plan.md` is implemented:

- **Stage 1:** Modular system prompt builder + turn context — **DONE** (`system_builder.py`, conversation_node and block-citation responder use `build_system_content`).
- **Stage 2:** Prior exchange in responder — **DONE** (`prior_exchange_summary` from `conversation_history`/`prior_turn_content`, `conversation_context` in block-citation human message).
- **Stage 3:** Optional LLM intent fallback — **DONE** (`use_llm_intent_fallback` in config, LLM branch in `classify_intent` with 4 ≤ word_count ≤ 25, `get_query_classification_prompt`).

So the *existing* OpenClaw-style plan is fully in place. The remainder is “make it more similar” in additional dimensions.

---

## 3. Gaps and Deviations (vs Plan & OpenClaw)

### 3.1 Minor / Verification

- **conversation_history guard:** Plan says “if state.get('conversation_history') and len(state['conversation_history']) > 0”. Code uses `isinstance(conv_hist, list) and len(conv_hist) > 0` — equivalent and safe.
- **Entry keys:** Plan says `entry.get("query", "")` and `entry.get("summary", "")` with truncation; code uses `(entry.get("query") or "")[:MAX_PRIOR_QUERY_CHARS]` — aligned.
- **Human message format:** Plan specifies exact format with “**Previous exchange:**” and “**Current user message:**”; implementation matches.

### 3.2 Intent Labels Not Used Downstream

- **Gap:** `get_query_classification_prompt` returns one of: `general_query`, `text_transformation`, `document_search`, `follow_up_document_search`, `hybrid`. Only `general_query` is used (→ conversation). The other labels are not stored in state or used by responder/planner (e.g. to set turn_type or reply_goal).
- **OpenClaw alignment:** OpenClaw doesn’t use these exact labels, but “intent” there influences what gets assembled into context. Storing and using a structured intent (e.g. `query_category`) would make your system more OpenClaw-like (explicit intent driving context/behavior).

### 3.3 Single Agent vs Two Branches

- **Structural difference:** OpenClaw is one agent with tools; you have conversation (no retrieval) vs document (retrieval + tools). Moving to a single agent that always has tools but “chooses” not to call them for greetings would be a large refactor and may not be desirable for latency/cost.
- **Recommendation:** Keep two branches; treat “more similar” as: clearer intent representation, turn context, and prior exchange (already done), plus optional use of finer intent labels downstream.

### 3.4 Richer Turn Context from Intent

- **Gap:** Turn context today is derived only from `use_cached_results`, `format_instruction`, `prior_turn_content`. It does not use the LLM intent label (e.g. `follow_up_document_search` → reply_goal “Answer the follow-up in continuity with the previous answer” could be reinforced if we had that label in state).
- **Opportunity:** If we persist `query_category` from the LLM fallback (and optionally from heuristics), `_section_turn_context` could use it for more precise reply_goal or turn_type.

---

## 4. Plan to Make Intent Architecture More Similar to OpenClaw

### 4.1 Already Aligned (No Work)

- Turn context in system prompt (conversation + responder).
- Prior exchange in responder (last Q + last A in human message).
- Optional LLM intent fallback with correct labels and mapping (general_query → conversation).
- Config flag `use_llm_intent_fallback`, default off.
- Constants and guards as in the original plan.

### 4.2 Recommended Next Steps (Prioritised)

**A. Persist and expose intent label in state (small, high value)**  
- In `classify_intent`, when using the LLM fallback, set a state field e.g. `query_category` to the parsed label (`general_query`, `text_transformation`, `document_search`, `follow_up_document_search`, `hybrid`). When using heuristics only, set a derived value (e.g. `"document_search"` for document, `"general_query"` for conversation).  
- Ensure `MainWorkflowState` includes `query_category: Optional[str]` (already present in types).  
- **Benefit:** Downstream nodes (responder, future observability) can use intent explicitly; closer to OpenClaw’s “intent influences context.”

**B. Use query_category in turn context (optional)**  
- In `_section_turn_context("responder", state)`, if `state.get("query_category")` is e.g. `follow_up_document_search`, prefer `turn_type = "same_doc_follow_up"` (or keep current logic and use query_category only when it adds information). Avoid overwriting `use_cached_results`-driven same_doc_follow_up.  
- **Benefit:** Finer intent drives reply_goal/turn_type when available.

**C. Observability and logging**  
- Log `query_category` (and route_decision) at graph level so analytics and debugging can see intent vs path.  
- **Benefit:** Easier to tune heuristics and LLM fallback and to compare with OpenClaw-style “input type” thinking.

**D. (Optional) Skill / tool hints from intent**  
- OpenClaw injects skills based on relevance. You could later use `query_category` (e.g. `text_transformation`) to add a short hint in system or human message (e.g. “User may be asking to reformat prior answer”) without changing graph structure.  
- Low priority; do after A–C.

### 4.3 Explicitly Out of Scope (Unless You Decide Otherwise)

- Merging conversation and document into a single agent that sometimes doesn’t call tools (large change, different product tradeoffs).
- Adding OpenClaw-style input types (heartbeats, cron, webhooks, hooks, agent-to-agent) as first-class triggers.
- Replacing your fast router with an OpenClaw-style gateway; keep your existing fast paths for latency.

---

## 5. Implementation Checklist (New Work Only)

- [ ] **A1** In `classify_intent`, when returning, set state update with `query_category`: from LLM when fallback runs (parsed label), from heuristics when not (`"general_query"` for conversation, `"document_search"` or similar for document). Return type of `classify_intent` is currently `str`; graph needs to merge this into state — either return a dict from a wrapper node (e.g. context_manager or a tiny “after_classify” node) or have the node that calls `classify_intent` write `query_category` into state.
- [ ] **A2** Ensure `MainWorkflowState.query_category` is documented as “intent label from classify_intent (e.g. general_query, document_search, follow_up_document_search).”
- [ ] **B1** In `system_builder._section_turn_context("responder", state)`, if `state.get("query_category") == "follow_up_document_search"` and we didn’t already set same_doc_follow_up from `use_cached_results`, consider using same_doc_follow_up turn_type/reply_goal (or a dedicated follow_up type).
- [ ] **C1** Add structured log (or event) after classify_intent: `query_category`, `intent` (conversation/document), and `route_decision` / path name for the current request.

---

## 6. Files to Touch (New Work)

| Item | File(s) |
|------|--------|
| A1, A2 | `backend/llm/nodes/routing_nodes.py` (classify_intent return or wrapper), `backend/llm/graphs/main_graph.py` (merge query_category into state), `backend/llm/types.py` (doc only if needed) |
| B1 | `backend/llm/prompts/system_builder.py` |
| C1 | `backend/llm/graphs/main_graph.py` and/or `backend/llm/nodes/routing_nodes.py` |

---

## 7. Summary

- Your **intent architecture** is already aligned with the existing OpenClaw-style plan: turn context, prior exchange, and optional LLM intent fallback are in place.
- **OpenClaw** differs mainly in having a single agent with tools and multiple input types; your two-branch (conversation vs document) design is kept, with intent only deciding which branch and cache/simple/full path.
- To make it **more similar** without big structural changes: persist and use **query_category** in state, optionally feed it into **turn context**, and add **observability** for intent and path. That gives you explicit intent-driven context (OpenClaw-like) while keeping your current routing and performance characteristics.

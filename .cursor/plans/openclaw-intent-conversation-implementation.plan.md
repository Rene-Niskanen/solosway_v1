---
name: ""
overview: ""
todos: []
isProject: false
---

# OpenClaw-Style Intent and Conversation — Implementation Plan

Single plan with three stages. Implement in order. Each stage is self-contained with clear steps and verification. **Reorganized to match the current codebase.**

**Checklist:** [ ] Stage 1  [ ] Stage 2  [ ] Stage 3 (optional)

---

## Robustness and Edge Cases (must follow)

- **Identify the block-citation function by signature, not line number.** There are two functions named `generate_conversational_answer_with_citations` in `responder_node.py`. Modify only the one with signature `(user_query, formatted_chunks, metadata_lookup_tables, previous_personality, is_first_message, user_id, workspace_section, paste_context)` returning `Tuple[str, str]`. Do **not** modify the one with signature `(user_query, chunks_metadata: List[Dict])` returning `Tuple[str, List]` (tool-based).
- **State and None:** When `state` is `None` in the block-citation path, keep current behaviour (no turn context, no prior exchange). When `state` is an empty dict `{}`, `_section_turn_context` should treat missing keys as falsy and derive `turn_type = "initial_question"` for responder; for prior_exchange_summary use `""`.
- **conversation_history shape:** `conversation_history` is a list (operator.add). Use the last entry only when `conversation_history` is truthy and non-empty: `entry = state["conversation_history"][-1]`. If the list is empty or state has no `conversation_history`, do not index; fall through to `prior_turn_content` or `""`. Guard: `if state.get("conversation_history") and len(state["conversation_history"]) > 0:`.
- **Entry keys:** Use `entry.get("query", "")` and `entry.get("summary", "")`; entries from summary_nodes have `"query"` and `"summary"`. Truncate with `[:100]` and `[:400]` respectively (constants below).
- **No duplicate workspace in responder:** When building system content via `build_system_content("responder", state, ...)`, the builder already includes `workspace_section`. In the block-citation function, when `state` is not None and you use the builder, do **not** append `workspace_section` again. Only append workspace when using the legacy path (`state is None`).
- **Mem0:** Mem0 injection must remain in the block-citation function **after** system_content is set (whether from builder or legacy). Append memory to `system_content` in the same place as today; do not put Mem0 inside `system_builder.py`.
- **Constants:** Define `MAX_PRIOR_QUERY_CHARS = 100` and `MAX_PRIOR_ANSWER_CHARS = 400` once (e.g. at top of `responder_node.py` or in a shared constants block) and use them when building `prior_exchange_summary`. Do not magic-number in multiple places.
- **Human message with conversation_context:** When `conversation_context` is non-empty, the human message must be exactly: `"**Previous exchange:**\n" + conversation_context + "\n\n**Current user message:**\n**User Question:**\n" + user_query + "\n" + paste_section + doc_section + "**Instructions:**\n" + instructions`. So the existing "User Question:" block is preserved and follows "Current user message".
- **Stage 3 label mapping:** `get_query_classification_prompt` returns one of: `general_query`, `text_transformation`, `document_search`, `follow_up_document_search`, `hybrid`. Map to routing: `general_query` → `"conversation"`; any other label (including unparseable or empty) → `"document"`. Parse LLM response: strip whitespace, lowercase; if result not in the five labels, default to `"document"`.
- **Stage 3 ambiguous definition:** Only invoke the LLM when (a) heuristics would otherwise return `"document"` (i.e. we did not already return `"conversation"` earlier in `classify_intent`), and (b) the query is ambiguous: e.g. `4 <= word_count <= 25` and no document keyword matched (we are in the "default: document" branch). So the LLM branch is reached only after rules 1–5 have not matched and we are about to return `"document"`; then restrict to word_count in range so we do not call LLM for very short (already conversation) or very long queries.
- **Failure mode:** If `build_system_content` or any new code raises, do not swallow exceptions; let them propagate so the graph can handle them. Do not fall back to empty turn context silently on exception unless the plan explicitly requires it.

---

## Current Codebase (Reference)

- **Conversation path:** [backend/llm/nodes/conversation_node.py](backend/llm/nodes/conversation_node.py) builds system prompt via `get_conversation_system_content(personality_context, memories_section, workspace_section)` from [backend/llm/prompts/conversation.py](backend/llm/prompts/conversation.py). That function already assembles: BASE_ROLE, CONVERSATION_RULES, about_velora, WRITING_RULES, OUTPUT_FORMATTING_RULES, workspace_section, memories_section, personality instruction, personality_context.
- **Document answer path:** [backend/llm/nodes/responder_node.py](backend/llm/nodes/responder_node.py) calls `generate_answer_with_direct_citations(user_query, execution_results, ...)`. That function internally calls the **block-citation** `generate_conversational_answer_with_citations(user_query, formatted_chunks, metadata_lookup_tables, previous_personality, is_first_message, user_id, workspace_section, paste_context)` (returns `(personality_id, answer_text)`). The **tool-based** `generate_conversational_answer_with_citations(user_query, chunks_metadata)` (returns `(answer_text, citations_list)`) must not be modified.
- **Block-citation system prompt:** In the block-citation `generate_conversational_answer_with_citations`, system_content is set from `get_responder_block_citation_system_content(personality_context)` then workspace_section appended if present, then Mem0 appended. [backend/llm/prompts/responder.py](backend/llm/prompts/responder.py) defines `get_responder_block_citation_system_content(personality_context)`.
- **State:** [backend/llm/types.py](backend/llm/types.py) `MainWorkflowState` has `conversation_history` (list of dicts, operator.add), `prior_turn_content`, `format_instruction`, `use_cached_results`, etc. Entries in `conversation_history` have `"query"`, `"summary"`, and optionally `"timestamp"` (see [backend/llm/nodes/summary_nodes.py](backend/llm/nodes/summary_nodes.py) ~1725 and routing_nodes return values).
- **Config:** [backend/llm/config.py](backend/llm/config.py) — `LLMConfig` (pydantic-settings, env_file=".env").
- **Intent classification:** [backend/llm/nodes/routing_nodes.py](backend/llm/nodes/routing_nodes.py) `classify_intent(state)` — heuristics only; returns `"conversation"` or `"document"`. [backend/llm/prompts/human_templates.py](backend/llm/prompts/human_templates.py) has `get_query_classification_prompt(user_query, conversation_history: str = "")` for an LLM-based classification (currently unused in this flow).

---

## Overview


| Stage | What                                         | Delivers                                                                                   |
| ----- | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **1** | Modular system prompt builder + turn context | One place to build prompts; AI sees "what this turn is" (turn_type + reply_goal).          |
| **2** | Prior exchange in responder                  | AI sees last user question + last answer when answering from docs (follow-ups make sense). |
| **3** | Optional LLM intent fallback                 | Smarter conversation vs document for edge cases (config flag, default off).                |


**Dependencies:** Stage 2 builds on Stage 1. Stage 3 is independent.

---

## Stage 1: Modular System Prompt Builder + Turn Context

**Goal:** One module prepends a "turn context" (turn_type + reply_goal) to the existing system prompts; conversation and responder both use it. No new state keys; turn type is derived from existing state.

### 1.1 Add system prompt builder module

- **New file:** [backend/llm/prompts/system_builder.py](backend/llm/prompts/system_builder.py)
- **Contents:**
  - **`_section_turn_context(mode: str, state: dict) -> str`**  
    Require `state` to be a dict. If `state` is None or not a dict, return `""`. Otherwise derive from `state` and `mode`: **conversation:** `turn_type = "conversation"`, `reply_goal = "Answer in a warm, conversational way."` **responder:** (1) if `state.get("use_cached_results")` → `turn_type = "same_doc_follow_up"`, reply_goal = "Answer the follow-up in continuity with the previous answer."; (2) elif `state.get("format_instruction")` or `state.get("prior_turn_content")` → `turn_type = "format_or_refine"`, reply_goal = "Format or refine the prior answer as requested."; (3) else → `turn_type = "initial_question"`, reply_goal = "Answer the user's question clearly using the document content."  
    Format as `"# TURN CONTEXT\nTurn type: {turn_type}\nReply goal: {reply_goal}\n"`.
  - **`build_system_content(mode, state, *, personality_context=..., memories_section=..., workspace_section=...) -> str`**  
    **Conversation:** If `state` is None, return `get_conversation_system_content(...)` only. Else return `_section_turn_context("conversation", state) + get_conversation_system_content(...)`.  
    **Responder:** If `state` is None, return `(workspace_section + "\n\n" if workspace_section else "") + get_responder_block_citation_system_content(personality_context)`. Else return `_section_turn_context("responder", state) + (workspace_section + "\n\n" if workspace_section else "") + get_responder_block_citation_system_content(personality_context)`.  
    Mem0 must **not** be in system_builder; it stays in the block-citation function.
- **No new state keys.** Use only existing state: `use_cached_results`, `format_instruction`, `prior_turn_content`.

### 1.2 Refactor conversation node to use builder

- **File:** [backend/llm/nodes/conversation_node.py](backend/llm/nodes/conversation_node.py)
- **Change:** Replace:
  - `system_content = get_conversation_system_content(personality_context=..., memories_section=..., workspace_section=...)`
  - with: `system_content = build_system_content("conversation", state, personality_context=personality_context, memories_section=memories_section, workspace_section=workspace_section)`.
- **Import:** `from backend.llm.prompts.system_builder import build_system_content`. Remove or keep import of `get_conversation_system_content` (only used via builder now).

### 1.3 Refactor responder path to use builder (call chain)

- **Change 1 — block-citation function:** Add optional `state: Optional[dict] = None` as the **last** parameter. When `state` is not None: set `system_content = build_system_content("responder", state, personality_context=personality_context, workspace_section=workspace_section)` and do **not** append `workspace_section` again. When `state` is None: keep current logic (`system_content = get_responder_block_citation_system_content(personality_context)`; then `if workspace_section: system_content += "\n\n" + workspace_section`). In both branches, keep the existing Mem0 block that appends to `system_content`.
- **Change 2 — generate_answer_with_direct_citations:** Add optional `state: Optional[dict] = None`. In the call to the block-citation `generate_conversational_answer_with_citations(..., paste_context=paste_context)`, add `state=state`.
- **Change 3 — responder_node:** At the call to `generate_answer_with_direct_citations(...)`, add `state=state`.
- **Effect:** Turn context when state is provided; no duplicate workspace; Mem0 unchanged.

### 1.4 No duplication of rules

- **Conversation:** Builder only prepends `_section_turn_context("conversation", state)`; the rest is `get_conversation_system_content(...)` which already includes BASE_ROLE, rules, workspace, memory, personality. No duplication.
- **Responder:** Builder returns turn_context + workspace + `get_responder_block_citation_system_content(personality_context)`. Memory is still appended inside `generate_conversational_answer_with_citations` as today.

### 1.5 Verification (Stage 1)

- Conversation: send a greeting; system prompt should contain "Turn type: conversation" and a reply goal.
- Document: first question then follow-up "Put that in a list." Second reply system prompt should contain turn_type (e.g. same_doc_follow_up or format_or_refine) and reply goal.
- No regression: personality, memory, workspace still present; existing tests pass.

### Stage 1 done when

- [backend/llm/prompts/system_builder.py](backend/llm/prompts/system_builder.py) exists and exports `build_system_content`.
- [backend/llm/nodes/conversation_node.py](backend/llm/nodes/conversation_node.py) uses `build_system_content("conversation", state, ...)`.
- [backend/llm/nodes/responder_node.py](backend/llm/nodes/responder_node.py): `responder_node` passes `state` into `generate_answer_with_direct_citations`; `generate_answer_with_direct_citations` passes `state` into `generate_conversational_answer_with_citations` (block-citation version only); that function uses `build_system_content("responder", state, ...)` when state is provided.

---

## Stage 2: Prior Exchange in Responder

**Goal:** On the document path, the LLM sees a short "previous exchange" (last user question + last assistant answer) so follow-ups like "explain that" or "format as a list" are grounded.

### 2.1 Build prior-exchange summary in responder_node

- **File:** [backend/llm/nodes/responder_node.py](backend/llm/nodes/responder_node.py)
- **Where:** In `responder_node`, in the same block that builds `workspace_section` and `paste_context_str`, **before** the call to `generate_answer_with_direct_citations`.
- **Constants:** Define at module or function scope: `MAX_PRIOR_QUERY_CHARS = 100`, `MAX_PRIOR_ANSWER_CHARS = 400`. Use these for truncation only; do not hardcode 100/400 elsewhere.
- **Logic:** Build `prior_exchange_summary: str` from state. Use this exact order:
  1. If `state.get("conversation_history")` is a non-empty list: set `entry = state["conversation_history"][-1]`, then `prior_exchange_summary = "Previous user question: " + (entry.get("query", "") or "")[:MAX_PRIOR_QUERY_CHARS] + "\nPrevious answer (summary): " + (entry.get("summary", "") or "")[:MAX_PRIOR_ANSWER_CHARS]`.
  2. Else if `state.get("prior_turn_content")` is a non-empty string: `prior_exchange_summary = "Previous answer (summary): " + (state["prior_turn_content"] or "")[:MAX_PRIOR_ANSWER_CHARS]`.
  3. Else: `prior_exchange_summary = ""`.
- **Edge case:** If `conversation_history` exists but is not a list (e.g. None or wrong type), treat as missing and fall through to `prior_turn_content` or `""`.

### 2.2 Add conversation_context to block-citation generator and inject in human message

- **File:** [backend/llm/nodes/responder_node.py](backend/llm/nodes/responder_node.py)
- **Function:** The block-citation `generate_conversational_answer_with_citations` (the one with args `user_query, formatted_chunks, metadata_lookup_tables, previous_personality, is_first_message, user_id, workspace_section, paste_context`).
- **Change:** Add optional parameter `conversation_context: Optional[str] = None` (e.g. after `paste_context` or after `state`). When building the human message content: if `conversation_context` is truthy (non-empty after strip), set the human content to `"**Previous exchange:**\n" + conversation_context.strip() + "\n\n**Current user message:**\n**User Question:**\n" + user_query + "\n" + paste_section + doc_section + "**Instructions:**\n" + instructions`. If `conversation_context` is empty or None, keep the existing human message (no "Previous exchange" block).

### 2.3 Pass prior_exchange_summary through the call chain

- **generate_answer_with_direct_citations:** Add parameter `prior_exchange_summary: str = ""`. When calling the block-citation `generate_conversational_answer_with_citations(..., paste_context=paste_context, state=state)`, add `conversation_context=prior_exchange_summary`.
- **responder_node:** After building `prior_exchange_summary` (2.1), call `generate_answer_with_direct_citations(..., state=state, prior_exchange_summary=prior_exchange_summary)`.
- **Block-citation function:** Already updated in 2.2 to accept `conversation_context` and inject it into the human message when non-empty.

### 2.4 Verification (Stage 2)

- Same-doc follow-up: "What is the rent?" then "Explain that in simple terms." Second reply should refer to rent; logs should show non-empty `conversation_context`.
- First message: no conversation_history; `prior_exchange_summary` empty; behavior unchanged.
- Length caps enforced (100 + 400 chars for prior exchange).

### Stage 2 done when

- `responder_node` builds `prior_exchange_summary` from `conversation_history` and/or `prior_turn_content` with caps.
- `generate_conversational_answer_with_citations` (block-citation) accepts `conversation_context` and injects it into the human message when non-empty.
- `generate_answer_with_direct_citations` accepts and forwards `prior_exchange_summary`; `responder_node` passes it.

---

## Stage 3: Optional LLM Intent Fallback (Conversation vs Document)

**Goal:** When heuristics are ambiguous, optionally use one LLM call to decide conversation vs document. Default off.

### 3.1 Config flag

- **File:** [backend/llm/config.py](backend/llm/config.py)
- **Add to `LLMConfig`:** `use_llm_intent_fallback: bool = False`. Use the same pattern as other booleans (e.g. `mem0_enabled`): `os.getenv("USE_LLM_INTENT_FALLBACK", "false").lower() == "true"`. Do not add a new SettingsConfigDict key; follow existing env_file behaviour.

### 3.2 Conditional LLM in classify_intent

- **File:** [backend/llm/nodes/routing_nodes.py](backend/llm/nodes/routing_nodes.py)
- **Function:** `classify_intent(state) -> str`
- **Current:** Heuristics only; returns "conversation" or "document". Default is "document" at the end.
- **Change:** Do **not** change the order or logic of existing rules 1–5. Only add a **new** branch **after** the "very short message" rule (word_count <= 3 → conversation) and **before** the final `return "document"`. In that gap:
  1. If `not config.use_llm_intent_fallback`: skip and fall through to `return "document"`.
  2. Compute `word_count = len(user_query.split())`. If `word_count < 4` or `word_count > 25`: skip (fall through to document). So we only call the LLM when `4 <= word_count <= 25`.
  3. Build `conversation_history_str`: from `state.get("conversation_history")` take the last 3 entries; for each entry format as `"User: " + entry.get("query", "") + "\nAssistant: " + entry.get("summary", "")`; join with `"\n"`. If no history, use `""`.
  4. Call the LLM with `get_query_classification_prompt(user_query, conversation_history_str)`. Use a small, fast model (e.g. same as follow-up classifier) and low max_tokens. Parse the response: `label = (response.content or "").strip().lower()`. Allowed labels: `general_query`, `text_transformation`, `document_search`, `follow_up_document_search`, `hybrid`. If `label == "general_query"` return `"conversation"`; otherwise return `"document"`. On exception, timeout, or unparseable label, return `"document"`.
- **Import:** Use existing config import pattern in that file (e.g. `from backend.llm.config import config`).

### 3.3 Verification (Stage 3)

- Flag off: no LLM call; behavior unchanged.
- Flag on + ambiguous query: one LLM call; result used for routing.

### Stage 3 done when

- Config flag exists and defaults to False.
- When enabled and query ambiguous, LLM classification is used; otherwise heuristics only.

---

## Implementation Order

1. **Stage 1** — 1.1 → 1.2 → 1.3 → 1.4 → 1.5 verify.
2. **Stage 2** — 2.1 → 2.2 → 2.3 → 2.4 verify.
3. **Stage 3** — 3.1 → 3.2 → 3.3 verify.

Do not start Stage 2 until Stage 1 is verified. Stage 3 can be done anytime.

---

## Files Touched (Summary)


| Stage | Files                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **New:** [backend/llm/prompts/system_builder.py](backend/llm/prompts/system_builder.py). **Edit:** [backend/llm/nodes/conversation_node.py](backend/llm/nodes/conversation_node.py), [backend/llm/nodes/responder_node.py](backend/llm/nodes/responder_node.py) (add state param to `generate_answer_with_direct_citations` and block-citation `generate_conversational_answer_with_citations`; use builder when state present). |
| 2     | [backend/llm/nodes/responder_node.py](backend/llm/nodes/responder_node.py) only (prior_exchange_summary, conversation_context param and injection).                                                                                                                                                                                                                                                                              |
| 3     | [backend/llm/config.py](backend/llm/config.py), [backend/llm/nodes/routing_nodes.py](backend/llm/nodes/routing_nodes.py). Reuse [backend/llm/prompts/human_templates.py](backend/llm/prompts/human_templates.py).                                                                                                                                                                                                                |


---

## Out of Scope (By Design)

- No new graph nodes. No changes to planner/executor or HTTP/views beyond passing state/prior_exchange where needed.
- The tool-based `generate_conversational_answer_with_citations(user_query, chunks_metadata)` is unchanged.

---

## Implementation Risks (avoid these)

1. **Modifying the wrong function:** Search for both definitions of `generate_conversational_answer_with_citations`; only add parameters to the one that has `formatted_chunks` and `metadata_lookup_tables` and returns `Tuple[str, str]`. Do not add `state` or `conversation_context` to the two-argument tool-based version.
2. **Double workspace:** In the block-citation function, when `state` is not None you must not run `if workspace_section: system_content += "\n\n" + workspace_section` because the builder already included it.
3. **conversation_history not a list:** LangGraph can merge state in ways that leave `conversation_history` as something other than a list. Always check `isinstance(state.get("conversation_history"), list) and len(state["conversation_history"]) > 0` before indexing `[-1]`.
4. **Stage 3 changing heuristic order:** The LLM fallback must be inserted only between the "word_count <= 3 → conversation" rule and the final `return "document"`. Do not reorder or remove existing rules.
5. **Silent fallbacks:** Do not catch exceptions and fall back to "document" or empty string without logging; let exceptions propagate or log and re-raise.


---
name: ""
overview: ""
todos: []
isProject: false
---

# LobeHub-style follow-up context — implementation-ready plan

## Goal

Improve follow-up answers by giving the responder **multi-turn conversation context** (last N Q&A pairs with caps), by using **messageHistory** (or the new **messages** array) when the checkpointer is unavailable, by **persisting conversation from fast paths** (e.g. attachment_fast), and by **never short-circuiting the planner when conversation history exists** so the model can infer retrieval queries (LobeHub-style: the "brain" always sees the full conversation). The plan also makes the **request contract and server role identical to LobeHub** (Level A: client sends full `messages` array including current user message; Level B: when client sends conversation, server does not use or persist conversation in checkpoint for that request).

---

## LobeHub mechanics (verified from source)

Re-analysis of the LobeHub/lobe-chat repo shows how their follow-ups work. Our plan aligns with each of these.

### 1. Client is the source of truth for conversation

- **LobeHub:** In `conversationLifecycle.ts`, when the user sends a message they call `internal_execAgentRuntime({ context: execContext, messages: displayMessages, ... })`. `displayMessages` comes from `displayMessageSelectors.getDisplayMessagesByKey(contextKey)(this.#get())` — i.e. **all messages for the current topic/thread** from the client store. So every request carries the full conversation; the server does not "load" history from its own checkpoint for the message list.
- **Our alignment (identical):** When the client sends `messageHistory`, we **always** use it as the conversation for that request (convert to `conversation_history` and `messages`; set in initial_state). We do not use the checkpoint’s conversation for "what the model sees" when the client sent history — so the client is the single source of truth, like LobeHub.

### 2. Full conversation is passed into every LLM decision

- **LobeHub:** In `streamingExecutor.ts`, `internal_createAgentState` receives `messages: UIChatMessage[]` and builds `AgentRuntime.createInitialState({ messages, ... })`. When the agent issues `call_llm`, `ChatService.createAssistantMessage` is called with `params` that include `messages`. It then runs `contextEngineering({ messages, historyCount: ... + 2, ... })` (see `src/services/chat/mecha/contextEngineering.ts`). The `MessagesEngine` processes the full list (with optional trimming via `historyCount`). So the **model always receives the conversation** (possibly trimmed); there is no path where "no scope" causes a fixed literal query to be used without the model seeing the history.
- **Our alignment:** Our planner must **never** use the no-scope shortcut (`_canonical_two_step_plan(user_query)`) when we have **messages** (conversation history). When there is no document scope but `messages` is non-empty, we must run the planner LLM with the follow-up prompt so it can output a 2-step plan with an **inferred** keyword-rich query from the prior Q&A, not the literal user message (e.g. "can you give me more detail please" → "Thomas Horner dissertation AI appraisal methodology details").

### 3. No "empty checkpoint" for a turn that produced an answer

- **LobeHub:** There is no server-side checkpoint for "conversation history" in the same sense we have. The client re-sends the full thread each time. So a follow-up always has the previous exchange(s) in the request.
- **Our alignment:** With client as source of truth, the client sends the full thread every time (so "no missing history" when the frontend sends messageHistory). We still (a) persist `conversation_history` from attachment_fast for API clients that don’t send messageHistory, and (b) when we have messages but no scope, run the planner LLM (see above).

### 4. Summary: LobeHub → our fixes


| LobeHub mechanic                                | Our fix                                                                                                                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client sends full messages every time           | **Identical:** When client sends `messageHistory`, always use it as the conversation for this request; do not use checkpoint for conversation (views: set initial_state from messageHistory). |
| Model always sees conversation when deciding    | Planner: when `not has_document_scope` but `messages` is non-empty, do **not** use `_canonical_two_step_plan(user_query)`; fall through to LLM with follow-up prompt.                         |
| No "missing" history after a turn that answered | Persist `conversation_history` from `handle_attachment_fast` (one exchange: query + summary) so checkpoint has prior context.                                                                 |
| Context engineering can trim (historyCount)     | We already cap (last N exchanges, max chars) in responder and planner; no change needed.                                                                                                      |


---

## Re-verification: 100% same mechanics for Velora

Re-analysis of LobeHub source and Velora frontend confirms the following. Implementing the plan as written will match LobeHub’s mechanics for Velora.

### 1. When LobeHub sends, what do they pass?

- **conversationLifecycle.ts:** They call `internal_execAgentRuntime({ messages: displayMessages, ... })` where `displayMessages = displayMessageSelectors.getDisplayMessagesByKey(messageMapKey(execContext))(this.#get())`. This is evaluated **after** the server round-trip and `replaceMessages(data.messages)` — so the client store already contains the new user message and the new assistant message (or placeholder). So the array passed to the agent is the **full thread for that topic/thread**, including the **current user message** as the last user message.
- **contextEngineering.ts:** They pass that full `messages` array into `MessagesEngine`. The engine can trim by `historyCount`; the **input** is always the full thread from the client. So: client = source of truth; full thread (including current user message) is passed in every time.

### 2. Velora: current user message

- We build `messageHistory` from `chatMessages` in the same synchronous block where we just called `setChatMessages(prev => [...prev, newQueryMessage])`. React state updates are asynchronous, so `chatMessages` at that moment does **not** yet include the new user message. So `messageHistory` only contains **prior** exchanges (e.g. [user1, asst1]), not the current user message (user2).
- We **do** send the current text in the request body as `query` (user_query). So the backend has:
  - `user_query` = current user message (e.g. "can you give me more detail please"),
  - `message_history` = prior exchanges only (e.g. [user1, asst1]).
- We convert `message_history` to `conversation_history` and `messages` (prior Q&A only). The planner and responder use `state["user_query"]` for the current message and `state["messages"]` (and optionally `conversation_history`) for prior context. So we have the same information as LobeHub: **prior thread + current message**; we just carry the current message in `user_query` instead of as the last element of the messages array. No change required for correctness.

### 3. Optional: include current user in “messages” for planner (LobeHub-identical shape)

- To mirror LobeHub exactly (messages array includes the current user message), we could append one more `HumanMessage(content=user_query)` when building `initial_state["messages"]` from the client payload, so the planner sees `[...prior exchanges, Human(current_query)]`. The planner already receives `user_query` separately and uses it in the prompt; adding it to `messages` would be redundant but would match LobeHub’s shape. **Not required for 100% behaviour**; only for structural parity if desired later.

### 4. Edge cases confirmed

- **New chat / first message:** LobeHub still passes `messages` (may be empty or contain only the new user message after optimistic update). We send `messageHistory` (often empty) and `query`. When `message_history` is empty we don’t set conversation from it; we can load from checkpoint or leave empty. Plan already handles this (use checkpoint when no messageHistory).
- **Continue / regenerate:** LobeHub uses `mainAIChatsWithHistoryConfig` for continue (possibly different trimming). Velora’s “continue” path (if any) can use the same rule: conversation for this request = what the client sends (or checkpoint when client sends nothing).
- **Attachment / files:** LobeHub includes files in the message (e.g. `files: fileIdList`). We send attachment context and query separately. No change to conversation mechanics; our plan already persists conversation from attachment_fast so the next turn has prior context (or client sends messageHistory).

### 5. Checklist for 100% behaviour on Velora

- Client sends full prior thread (messageHistory); we treat it as the conversation for this request when present (views: prefer messageHistory over checkpoint).
- Current user message is available to the backend (user_query in request body); prior thread in messageHistory → conversation_history + messages.
- Planner never short-circuits when messages exist (run LLM for follow-up when no scope but messages non-empty).
- Persist conversation from attachment_fast so checkpoint isn’t the only source when client doesn’t send history.
- Responder and classifier get prior context from the same conversation (conversation_history / messages from initial_state).

No further changes to the plan are required for 100% alignment with LobeHub mechanics for Velora.

---

## Make conversation flow identical to LobeHub

In LobeHub the **client is the single source of truth for the conversation**: every request sends the full thread; the server does not "load" conversation from its own store. To make our flow **identical**:

### Rule: Client-sent messageHistory = conversation for this request

- **Current:** We load `conversation_history` from the checkpoint when available, and only use `messageHistory` when the checkpoint has no history ("fallback").
- **Identical to LobeHub:** For every request, **when the client sends `messageHistory`**, treat it as the canonical conversation for that request. Set `initial_state["conversation_history"]` and `initial_state["messages"]` from `messageHistory` (converted) and use that for the classifier, planner, and responder. Do **not** overwrite with the checkpoint’s `conversation_history` for the purpose of "what conversation does the model see."
- **Checkpoint** continues to store and load only **non-conversation** state: `execution_results`, `relevant_documents`, `document_ids`, etc. (for cache-first and scope). So: conversation = what the client sent (like LobeHub); cache/scope = what the server stored from the last run.

### Implementation (views.py)

1. **When building initial_state (before graph run):** If `message_history` is present and non-empty, **always** call `_message_history_to_conversation_history(message_history)` and set:
  - `initial_state["conversation_history"] = converted`
  - `initial_state["messages"] = _conversation_history_to_messages(converted)`
  - `loaded_conversation_history = converted` (so the follow-up classifier and any other code that reads "loaded" history sees the same client-sent thread).
2. **Do not** set conversation from checkpoint when we have client-sent messageHistory. Only load from checkpoint when `message_history` is missing or empty (e.g. API clients that don’t send it); then keep current behaviour (load from checkpoint, then fallback to messageHistory is irrelevant because we already prefer messageHistory when present).
3. **After graph run:** We can still let the graph merge `conversation_history` into the checkpoint (e.g. for backward compatibility or for clients that don’t send messageHistory next time). The important part is: for **this** request, the conversation the model sees is always from the client when the client sent it.

### Result

- **Conversation:** Same as LobeHub — client sends full thread; server uses it as the conversation for that request; no server-side "conversation memory" used when client sent history.
- **Cache/scope:** Unchanged — checkpoint still stores execution_results, document_ids, etc., for same-doc follow-up and scope.
- **Frontend:** Already sends `messageHistory`; no change required. Ensure it always sends the full thread (all query/response pairs for the current chat). With Level A below, frontend will also send `messages` (LobeHub shape) with current user message last.

---

## Level A & B: Identical request contract and server role (LobeHub-identical)

The following additions make the **request shape** and **server’s use of conversation** identical to LobeHub, without removing any existing behaviour. All existing plan steps (responder prior context, messageHistory fallback, attachment_fast persist, planner no-scope, classifier, etc.) remain required and are unchanged except where they are extended to support `messages` and Level B.

### Level A — Same request shape as LobeHub

**Intent:** Client sends a single `**messages`** array: `[{ role, content }, ...]` with the **current user message as the last element**. Backend derives `user_query` and conversation from this array. This matches LobeHub’s contract and avoids relying on React state timing for the current message.

**Backend (views.py):**

1. **Parse request body:** In the stream endpoint, read optional `messages` from the request (list of `{ role, content }`). Keep reading `messageHistory` and `query` for backward compatibility.
2. **Normalize to one source of conversation:**
  - If `messages` is present and non-empty: treat as LobeHub shape.  
    - Set `user_query` for this request: if the last element of `messages` has `role == "user"` (case-insensitive), set `user_query = (last["content"] or "").strip()`; otherwise keep `user_query` from request `query` (or "").  
    - Build conversation from **all but the last** message: run the same pairing logic as `_message_history_to_conversation_history` on `messages[:-1]` to get `conversation_history` (list of `{ query, summary }`), and from that build `messages` for the planner (LangChain HumanMessage/AIMessage).  
    - Set a flag `conversation_from_client = True` (used for Level B).
  - Else if `message_history` is present and non-empty: keep current behaviour (convert to conversation, set initial_state, etc.) and set `conversation_from_client = True`.  
  - Else: use checkpoint for conversation (if any) and set `conversation_from_client = False`.
3. **Helper:** Add `_messages_array_to_conversation_and_query(messages: list)` that:
  - Takes a list of `{ role, content }`.  
  - Returns `(user_query, conversation_history)` where `user_query` is the content of the last message if role is "user", else None (caller uses request `query`); `conversation_history` is from pairing messages **excluding the last** (so the “current” message is not in conversation_history).  
  - Uses same caps as existing helpers (e.g. 500/2000 per query/summary, max 10 turns).  
  - Handles empty list, non-dict entries, and missing role/content safely.

**Frontend (SideChatPanel.tsx / backendApi):**

1. **Build `messages` for each stream request:** When calling the stream API, build an array:
  - Prior messages: same as current messageHistory (from chatMessages: filter query/response with text, map to `{ role: 'user'|'assistant', content: msg.text }`).  
  - **Append the current user message:** `{ role: 'user', content: queryText }` (the text being sent in this request).  
  - So `messages = [...priorFromChatMessages, { role: 'user', content: queryText }]`.
2. **Send in request body:** Add `messages` to the payload. Keep sending `query` (or set it to queryText) and `messageHistory` for backward compatibility so old backend versions still work.
3. **When to send empty `messages`:** For a true new chat (no prior messages), send `messages: [{ role: 'user', content: queryText }]`. Do not omit `messages` so that the backend always receives LobeHub shape when the frontend is updated.

**Edge cases (Level A):**

- First message: `messages = [{ role: 'user', content: queryText }]`. Backend derives user_query from it; conversation_history is empty.
- Follow-up: `messages = [user1, asst1, user2]`. Backend derives user_query from user2; conversation_history = one exchange (user1, asst1).
- Malformed `messages` (e.g. empty role): skip or treat as empty; fall back to `query` and `message_history` if present.
- Backend receives only `query` (no `messages`, no messageHistory): existing behaviour (use query, load conversation from checkpoint if any).

### Level B — Server does not own conversation when client sends it

**Intent:** When the client sends conversation (via `messages` or `messageHistory`), the server must **not** use the checkpoint’s conversation for this request and must **not** persist conversation to the checkpoint for this request. So the server holds only cache/scope (execution_results, document_ids, etc.); conversation is owned entirely by the client for that request.

**Implementation:**

1. **Do not load conversation from checkpoint when client sent it (already in plan):** When `conversation_from_client` is True (i.e. we built conversation from `messages` or `message_history`), do not set `initial_state["conversation_history"]` or `initial_state["messages"]` from the checkpoint. Use only the client-derived conversation. This is already specified in section “Conversation from client (LobeHub-identical)” and in the new Level A flow.
2. **Do not persist conversation to checkpoint when client sent it:**
  - **Option (recommended):** Pass `conversation_from_client` in `initial_state` (e.g. as a reserved key or in configurable). In the graph, nodes that **add** to `conversation_history` (responder_node, handle_attachment_fast, etc.) check this flag: if True, they **do not** add to `conversation_history` for this run, so the checkpoint is not updated with conversation. Cache/scope (execution_results, document_ids, etc.) are still persisted by existing graph behaviour.  
  - **Alternative:** Leave graph behaviour as-is (it may still merge conversation_history). Then “server doesn’t own” is satisfied by “we never read it when client sends next time.” For strict identity, Option (recommended) is better so the checkpoint never contains conversation when the client is the source.

**Scope of Level B:**

- Applies only when the request included conversation from the client (`messages` or `message_history` non-empty and used).
- When the request has no client-sent conversation (e.g. API with only `query`), we continue to load from checkpoint and the graph may persist conversation as today (backward compatibility).

### Integration with existing plan (no removals)

- **Responder (section 1):** Unchanged. It still uses `state.get("conversation_history")` and `_build_prior_context_from_conversation_history`; that state is filled from client-sent data (Level A) or from checkpoint when client sent nothing.
- **Views (section 2):** Extend so that: (1) we first check for `messages` and, if present, use `_messages_array_to_conversation_and_query` and set user_query + conversation + `conversation_from_client = True`; (2) else if `message_history` present, keep current conversion and set `conversation_from_client = True`; (3) else load from checkpoint and set `conversation_from_client = False`. All existing logic (conversion helpers, setting initial_state, loaded_conversation_history, is_followup) remains; we only add the `messages` path and the flag.
- **attachment_fast (section 2b):** Unchanged. When Level B is in effect and we don’t persist conversation, attachment_fast’s return of `conversation_history` can be conditional on `not state.get("conversation_from_client")` so we don’t write when client owns conversation; or we leave it and rely on “don’t read when client sends.” Plan should state: when `conversation_from_client` is implemented in the graph, attachment_fast should also respect it and not add to conversation_history when True.
- **Planner (section 2c):** Unchanged. It still uses `state.get("messages")` and `user_query`; these are set from Level A or from existing messageHistory/checkpoint path.
- **Classifier (section 3):** Unchanged. It still receives `loaded_conversation_history` and current query; both are set from Level A or existing paths.
- **Verification (section 4):** Add one check: send a request with `messages` only (no messageHistory, no query except derived from last message) and confirm the reply uses prior context and correct user_query.

### Order of operations in views (single place, robust)

1. Parse body: `query`, `message_history`, `messages`, and other fields.
2. **Level A — Normalize conversation source:**
  - If `messages` is present and non-empty:  
    - `user_query_from_messages, conv_hist_from_messages = _messages_array_to_conversation_and_query(messages)`.  
    - If `user_query_from_messages` is not None, set `query = user_query_from_messages` (override request query).  
    - Set `loaded_conversation_history = conv_hist_from_messages`, `conversation_from_client = True`.
  - Elif `message_history` is present and non-empty:  
    - `converted = _message_history_to_conversation_history(message_history)`; set `loaded_conversation_history = converted`, `conversation_from_client = True`.  
    - Keep `query` from request.
  - Else:  
    - Load from checkpoint as today; set `loaded_conversation_history` and optionally `conversation_from_client = False`.
3. Build `initial_state`: set `user_query = query`; set `initial_state["conversation_history"]` and `initial_state["messages"]` from `loaded_conversation_history` (and from `_conversation_history_to_messages`); if implementing Level B strictly, set `initial_state["conversation_from_client"] = conversation_from_client`.
4. Proceed with existing flow (classifier, graph run, etc.). No other steps are removed or reordered.

### Summary Level A & B


| Item                                        | Implementation                                                                                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Level A — Request shape                     | Frontend sends `messages` (prior + current user message last). Backend accepts `messages`; derives user_query and conversation via `_messages_array_to_conversation_and_query`; prefers `messages` when present. |
| Level A — Backward compat                   | Backend still accepts `message_history` + `query`; when `messages` absent, behaviour unchanged.                                                                                                                  |
| Level B — Don’t use checkpoint conversation | When `conversation_from_client` is True, do not load conversation from checkpoint; use only client-sent data. (Already in plan; now explicit.)                                                                   |
| Level B — Don’t persist conversation        | When `conversation_from_client` is True, graph nodes that add to `conversation_history` do not add (so checkpoint is not updated with conversation). Optional but recommended for strict identity.               |


---

## Constants (single source of truth)

Add or reuse in `**backend/llm/nodes/responder_node.py`** near line 636 (with `MAX_PRIOR_QUERY_CHARS` / `MAX_PRIOR_ANSWER_CHARS`):

```python
# Prior context for follow-ups (LobeHub-style: last N exchanges, capped)
PRIOR_CONTEXT_MAX_EXCHANGES = 3          # Number of prior Q&A pairs to include
PRIOR_CONTEXT_MAX_TOTAL_CHARS = 2500     # Hard cap for entire prior context string
MAX_PRIOR_QUERY_CHARS = 150              # Per-exchange query cap (was 100; slight bump for multi-turn)
MAX_PRIOR_ANSWER_CHARS = 500             # Per-exchange summary cap (was 400)
```

Keep `MAX_PRIOR_QUERY_CHARS` and `MAX_PRIOR_ANSWER_CHARS` as the per-exchange caps when building the prior context string. `PRIOR_CONTEXT_MAX_TOTAL_CHARS` is a global cap: after building the string from the last N exchanges, truncate from the start (oldest content) if total length exceeds it.

---

## 1. Responder: multi-turn prior context

**File:** `backend/llm/nodes/responder_node.py`

### 1.1 Add helper (after constants, ~line 638)

```python
def _build_prior_context_from_conversation_history(
    conv_hist: list,
    max_exchanges: int = PRIOR_CONTEXT_MAX_EXCHANGES,
    max_total_chars: int = PRIOR_CONTEXT_MAX_TOTAL_CHARS,
    max_query_chars: int = MAX_PRIOR_QUERY_CHARS,
    max_summary_chars: int = MAX_PRIOR_ANSWER_CHARS,
) -> str:
    """
    Build a single string of prior Q&A for the responder (last N exchanges, capped).
    Oldest content is truncated first if total exceeds max_total_chars.
    """
    if not conv_hist or not isinstance(conv_hist, list):
        return ""
    # Take last N entries (most recent first when iterating backwards)
    recent = conv_hist[-(max_exchanges):]
    parts = []
    for entry in recent:
        if not isinstance(entry, dict):
            continue
        q = (entry.get("query") or "").strip()[:max_query_chars]
        s = (entry.get("summary") or "").strip()[:max_summary_chars]
        if q or s:
            parts.append("Previous user question: " + q + "\nPrevious answer (summary): " + s)
    if not parts:
        return ""
    combined = "\n\n".join(parts)
    if len(combined) > max_total_chars:
        combined = combined[-max_total_chars:].lstrip()
        # Avoid cutting mid-line; prefer starting at next "Previous user"
        idx = combined.find("Previous user question:")
        if idx > 0:
            combined = combined[idx:]
    return combined
```

### 1.2 Replace single-exchange prior logic (~lines 2504–2513)

**Current code:**

```python
            # Prior exchange for follow-ups: last user question + last answer (summary)
            prior_exchange_summary = ""
            conv_hist = state.get("conversation_history")
            if isinstance(conv_hist, list) and len(conv_hist) > 0:
                entry = conv_hist[-1]
                q = (entry.get("query") or "")[:MAX_PRIOR_QUERY_CHARS]
                s = (entry.get("summary") or "")[:MAX_PRIOR_ANSWER_CHARS]
                prior_exchange_summary = "Previous user question: " + q + "\nPrevious answer (summary): " + s
            elif state.get("prior_turn_content"):
                prior_exchange_summary = "Previous answer (summary): " + (state["prior_turn_content"] or "")[:MAX_PRIOR_ANSWER_CHARS]
```

**Replace with:**

```python
            # Prior context for follow-ups: last N exchanges (LobeHub-style), capped
            prior_exchange_summary = ""
            conv_hist = state.get("conversation_history")
            if isinstance(conv_hist, list) and len(conv_hist) > 0:
                prior_exchange_summary = _build_prior_context_from_conversation_history(conv_hist)
            if not prior_exchange_summary and state.get("prior_turn_content"):
                prior_exchange_summary = "Previous answer (summary): " + (
                    (state["prior_turn_content"] or "")[:MAX_PRIOR_ANSWER_CHARS]
                )
```

No change to the call site: `prior_exchange_summary` is still passed into `generate_answer_with_direct_citations(..., prior_exchange_summary=prior_exchange_summary)`.

**Edge cases:** Empty or non-list `conv_hist` returns `""`. Malformed entries (non-dict) are skipped. Total length is enforced by truncating from the start; the model always sees the most recent content first.

---

## 2. Views: messageHistory → initial_state when no checkpoint

**File:** `backend/views.py`

### 2.1 Add conversion helper (top of file or next to other stream helpers, before `generate_stream`)

```python
def _message_history_to_conversation_history(message_history: list, max_turns: int = 10) -> list:
    """
    Convert frontend messageHistory (list of {role, content}) into our conversation_history
    format (list of {query, summary}) for use when checkpointer is unavailable.
    Pairs consecutive user/assistant messages; ignores unpaired or non-dict entries.
    """
    if not message_history or not isinstance(message_history, list):
        return []
    out = []
    i = 0
    while i < len(message_history) and len(out) < max_turns:
        entry = message_history[i] if isinstance(message_history[i], dict) else None
        if not entry:
            i += 1
            continue
        role = (entry.get("role") or "").strip().lower()
        content = (entry.get("content") or "").strip()
        if role == "user" and content:
            # Look for next assistant reply
            j = i + 1
            next_entry = message_history[j] if j < len(message_history) and isinstance(message_history[j], dict) else None
            next_role = (next_entry.get("role") or "").strip().lower() if next_entry else ""
            next_content = (next_entry.get("content") or "").strip() if next_entry else ""
            if next_role == "assistant":
                out.append({"query": content[:500], "summary": next_content[:2000]})
                i = j + 1
            else:
                out.append({"query": content[:500], "summary": ""})
                i += 1
        else:
            i += 1
    return out[-max_turns:]  # Keep last max_turns pairs
```

### 2.2 Conversation from client (LobeHub-identical: client = source of truth)

**Location:** After we have determined `loaded_conversation_history` from checkpoint and built `initial_state`, and **before** the follow-up classifier.

**Logic (identical to LobeHub):** Full order of precedence is in **Level A & B** below: if the client sends `messages` (Level A), use that first; if it sends `message_history`, use that; otherwise use checkpoint. In all cases where the client sent conversation, do **not** use the checkpoint for "what the model sees" and set `conversation_from_client = True` (Level B).

- **When the client sends `message_history` (or `messages` per Level A):** Use it as the conversation for this request. Convert and set `initial_state["conversation_history"]`, `initial_state["messages"]`, and `loaded_conversation_history` from it. Do **not** use checkpoint’s conversation for this request.
- **When the client does not send conversation (no `messages`, no `message_history` or empty):** Use checkpoint’s `loaded_conversation_history` and build `initial_state["messages"]` from it when the checkpoint has no messages; set `conversation_from_client = False`.

**Code to add after the try/except that loads checkpoint state:**  
When Level A is implemented (step 8), the `messages` path runs first and this block is entered only when `messages` was absent (so the condition becomes `elif message_history` for the second branch). Until then, `if message_history` is correct.

```python
                        # LobeHub-identical: client-sent messageHistory = conversation for this request (client = source of truth)
                        if message_history:
                            converted = _message_history_to_conversation_history(message_history)
                            if converted:
                                loaded_conversation_history = converted
                                initial_state["conversation_history"] = converted
                                initial_state["messages"] = _conversation_history_to_messages(converted)
                                is_followup = True
                                logger.info("🟡 [STREAM] Using messageHistory as conversation (%d exchanges) [LobeHub-identical]", len(converted))
                        elif loaded_conversation_history:
                            initial_state["conversation_history"] = loaded_conversation_history
                            if history_from_checkpoint and existing_state and not (existing_state.values.get("messages")):
                                initial_state["messages"] = _conversation_history_to_messages(loaded_conversation_history)
```

**Edge cases:** `message_history` null/empty → use checkpoint conversation. Cap at 10 turns and 500/2000 chars per query/summary in conversion.

---

## 2b. Persist conversation_history from attachment_fast (LobeHub: no missing history)

**File:** `backend/llm/nodes/routing_nodes.py`

**Why:** After a turn that uses `handle_attachment_fast`, the graph goes to END without passing through the responder. The checkpoint never receives `conversation_history`, so the next turn has no prior context unless the client sends messageHistory. Persisting one exchange from attachment_fast ensures the checkpoint has prior Q&A and matches LobeHub’s “conversation always available” behaviour.

**Current:** `handle_attachment_fast` returns only `{"final_summary": final_summary}` (around line 667).

**Change:** Return conversation_history so the checkpointer can merge it (state uses `operator.add` for `conversation_history`). After building `final_summary`, add to the return dict:

```python
"conversation_history": [{"query": (user_query or "")[:500], "summary": (final_summary or "")[:2000]}]
```

Use the same shape and caps as in responder_node (500/2000). The next turn can then load this from the checkpoint; messageHistory remains the fallback when checkpoint is empty.

---

## 2c. Planner: run LLM when there is conversation history but no document scope (LobeHub: brain always sees conversation)

**File:** `backend/llm/nodes/planner_node.py`

**Why:** When `has_document_scope` is false (no document_ids, no property_id), the code currently always uses `_canonical_two_step_plan(user_query_stripped)` with the **literal** user message (e.g. "can you give me more detail please"). That produces a useless retrieval query. LobeHub never short-circuits the model when conversation exists; we must do the same.

**Current:** Lines 382–408: if `not has_document_scope`, we set `execution_plan = _canonical_two_step_plan(user_query_stripped)` and return without calling the LLM.

**Change:** When `not has_document_scope`, only use the no-scope shortcut when there are **no** prior messages. If `messages` is non-empty, treat as follow-up and **do not** return early: fall through to the existing block that builds `workspace_section`, `system_prompt`, and then chooses `get_planner_initial_prompt` vs `get_planner_followup_prompt` based on `messages`. For no-scope follow-ups, `workspace_section` will be empty; the planner prompt already describes using 2 steps and inferring from the conversation when there is no workspace.

Pseudocode:

```python
if not has_document_scope:
    is_refinement = state.get("execution_plan") is not None
    if is_refinement:
        plan_refinement_count += 1
        ...
    # Only use fixed plan when there is no conversation history (true new question with no scope)
    if not messages:
        user_query_stripped = (user_query or "").strip() or "Search documents"
        execution_plan = _canonical_two_step_plan(user_query_stripped)
        ...
        return planner_output
    # When we have messages, fall through to LLM planner (follow-up with no scope)
```

**Edge case:** Refinement loop (no results, we already have execution_plan): keep existing refinement logic; only skip the shortcut when `messages` is non-empty so we still run the LLM for follow-ups with no scope.

---

## 3. Follow-up classifier: optional multi-turn input

**File:** `backend/llm/utils/follow_up_classifier.py`

### 3.1 Constants (near line 66)

Add:

```python
MAX_PREV_EXCHANGES_FOR_CLASSIFIER = 2   # Last 2 exchanges for same_doc vs new_question
```

Existing `MAX_PREV_QUERY_CHARS` (200) and `MAX_PREV_ANSWER_CHARS` (400) stay; use them for each exchange when building the classifier prompt.

### 3.2 Change _build_user_prompt (lines 92–118)

**Current:** Uses only `conversation_history[-1]`.

**New behaviour:**

- Take the last `min(MAX_PREV_EXCHANGES_FOR_CLASSIFIER, len(conversation_history))` entries.
- For each entry, append lines like "Previous user question: {query}" and "Previous answer (summary): {summary}" (with existing char caps).
- Label older vs latest so the classifier can tell which turn had the docs (e.g. "Documents from that turn" still refers to the last turn’s `doc_names`).
- Keep "Current user message:" and "Reply SAME_DOC or NEW_QUESTION or PASTE_AND_DOCS." unchanged.

**Example implementation:**

```python
def _build_user_prompt(
    current_query: str,
    conversation_history: List[Dict[str, Any]],
    doc_names: List[str],
    has_attachment: bool = False,
) -> str:
    lines = []
    if conversation_history:
        recent = conversation_history[-MAX_PREV_EXCHANGES_FOR_CLASSIFIER:]
        for i, last in enumerate(recent):
            if not isinstance(last, dict):
                continue
            prev_query = (last.get("query") or "")[:MAX_PREV_QUERY_CHARS]
            prev_summary = (last.get("summary") or "")[:MAX_PREV_ANSWER_CHARS]
            if prev_query:
                lines.append(f"Previous user question: {prev_query}")
            if prev_summary:
                lines.append(f"Previous answer (summary): {prev_summary}")
            if i < len(recent) - 1:
                lines.append("")  # separate exchanges
    if doc_names:
        names = doc_names[:MAX_DOC_NAMES]
        lines.append(f"Documents from that turn: {', '.join(names)}")
    lines.append(f"Current user message: {current_query}")
    if has_attachment:
        lines.append("Current message includes an attached/pasted file.")
    lines.append("\nReply SAME_DOC or NEW_QUESTION or PASTE_AND_DOCS.")
    return "\n".join(lines)
```

This preserves backward compatibility (one exchange = same as before) while allowing two exchanges when available.

---

## 3b. Other parts of Velora (LobeHub analysis — ensure follow-ups work everywhere)

Re-analysis of LobeHub shows they rely on **context keying** (messageMapKey: agentId, topicId, threadId, scope) so the message list is always for the **active** conversation. The following Velora areas must be correct for follow-ups to work end-to-end.

### Session/thread identity (LobeHub: same context → same thread)

- **LobeHub:** They use the same (topicId, threadId) for the same conversation so `getDisplayMessagesByKey(context)` returns that conversation’s messages and the backend sees a stable thread.
- **Velora:** The backend uses `session_id` from the request to form `thread_id` (via SessionManager). For **the same chat**, we must send the **same** sessionId on every request (first and follow-ups).
- **Check:** In both stream paths (query-prop and handleSubmit), when it’s **not** a new chat we set `chatSessionId = existingChat.sessionId` from `getChatById(currentChatId)`. So follow-ups already use the chat’s sessionId. No change needed; only verify no other caller sends a different sessionId for the same conversation (e.g. plan mode or citation flow may intentionally use a different session).

### Message list is for the active chat only (LobeHub: getDisplayMessagesByKey(contextKey))

- **Velora:** `chatMessages` in SideChatPanel is the list for the **current** chat: either we’re in a new chat (and append to it) or we restored and did `setChatMessages(restoredMessages)`. So `messageHistory` built from `chatMessages` is always for the active chat. No change needed.

### Restore flow: history has sessionId and messages with content

- When we restore a chat we use `getChatById(restoreChatId)` and set `chatMessages` from `chat.messages`. Restored messages are mapped to `{ type, text, ... }` so they have `.text` and pass the `msg.text` filter when building messageHistory.
- **Check:** `updateChatInHistory` only updates `messages` (and title/timestamp); it does not overwrite `sessionId`. So the chat’s sessionId is preserved across updates. When the user reopens that chat from the sidebar we restore with that sessionId and subsequent follow-ups will send it. No change needed.

### Other callers of the stream API

- **Plan mode:** Passes `sessionId` (component default) and `isNewChat: true` (or equivalent). Plan is typically one-off; if a “plan follow-up” flow is added later, it should use the same chat’s sessionId and send messageHistory for that conversation.
- **Citation / “ask about this”:** May open a new chat or reuse current chat. If it reuses the current chat, use that chat’s sessionId and include messageHistory so the backend has context.
- **Recommendation:** Audit all call sites of `queryDocumentsStreamFetch` (or the same backend stream endpoint). For any path that is part of an ongoing conversation (same chat), pass that chat’s `sessionId` and the current chat’s `messageHistory`. The two main send paths (query-prop and handleSubmit) already do this for existing chats.

### Summary: other parts


| Area                               | LobeHub                          | Velora                              | Action                                                                      |
| ---------------------------------- | -------------------------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| Same thread for same conversation  | topicId/threadId → message key   | sessionId → thread_id               | Already: use chat’s sessionId for existing chat in both stream paths.       |
| Message list = active conversation | getDisplayMessagesByKey(context) | chatMessages for currentChatId      | Already: chatMessages are for current chat only.                            |
| Restore preserves sessionId        | N/A (client-only key)            | updateChatInHistory keeps sessionId | Already: no overwrite of sessionId.                                         |
| Restored messages have .text       | N/A                              | Restore maps content → text         | Already: restored messages pass messageHistory filter.                      |
| Other API callers                  | N/A                              | Plan, citation, etc.                | Audit: any “conversation” path should send chat sessionId + messageHistory. |


No implementation changes are required in these areas for the current plan; the above are verification points so follow-ups work 100% with the backend changes in the plan.

---

## 4. Verification and rollback

### 4.1 Manual checks

1. **Multi-turn responder:** Start a chat: "What's in the Highlands lease?" then "Key dates?" then "Format that as a list." The third answer should refer to the same doc and format the previous answer. Check logs for `[RESPONDER]` prior context length (should be <= 2500).
2. **messageHistory path:** With checkpointer disabled or a new session that has no checkpoint, send two messages (user + assistant) from the client; on the third (user) message, confirm backend logs "Using messageHistory as conversation_history" and that the responder receives non-empty prior context.
3. **Classifier:** No regression: "Summarise the lease" then "What about the Nzohe lease?" should still be classified as NEW_QUESTION and not reuse cache.
4. **Level A (messages-only request):** Send a request with only `messages` (e.g. `[{ role: "user", content: "First query" }, { role: "assistant", content: "..." }, { role: "user", content: "Give me more detail" }]`) and no `messageHistory` or `query`. Confirm the reply uses prior context and that `user_query` was derived from the last message ("Give me more detail").

### 4.2 Rollback

- Revert responder to single-exchange prior (single `conv_hist[-1]` and original caps).
- Remove the messageHistory → conversation_history block in views and the helper.
- Revert follow_up_classifier to single-exchange prompt if needed.
- **Level A/B:** Remove `messages` parsing and `_messages_array_to_conversation_and_query`; stop sending `messages` from frontend; remove `conversation_from_client` and graph logic that skips persisting conversation when it is set.

---

## 5. Implementation order


| Step | Task                                                                                                                                                                                                                                              | File(s)                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1    | Add constants and `_build_prior_context_from_conversation_history`                                                                                                                                                                                | `responder_node.py`                     |
| 2    | Replace prior_exchange_summary construction with call to helper                                                                                                                                                                                   | `responder_node.py`                     |
| 3    | Add `_message_history_to_conversation_history` and `_conversation_history_to_messages`                                                                                                                                                            | `views.py`                              |
| 4    | After checkpoint load, set initial_state + loaded_conversation_history from messageHistory when empty; when client sends history, do not use checkpoint for conversation                                                                          | `views.py`                              |
| 5    | Persist `conversation_history` from `handle_attachment_fast` (one exchange)                                                                                                                                                                       | `routing_nodes.py`                      |
| 6    | Planner: when no document scope but `messages` non-empty, run LLM (do not use _canonical_two_step_plan)                                                                                                                                           | `planner_node.py`                       |
| 7    | (Optional) Add classifier constant and multi-turn _build_user_prompt                                                                                                                                                                              | `follow_up_classifier.py`               |
| 8    | **Level A backend:** Add `_messages_array_to_conversation_and_query`; parse `messages` in stream path; normalize source (messages → message_history → checkpoint); set `conversation_from_client` and `initial_state["conversation_from_client"]` | `views.py`                              |
| 9    | **Level B:** In responder_node and handle_attachment_fast, when `conversation_from_client` is True do not add/return conversation for checkpoint persistence                                                                                      | `responder_node.py`, `routing_nodes.py` |
| 10   | **Level A frontend:** Build `messages` (prior + current user last); send in stream body; keep `query` and `messageHistory` for compatibility                                                                                                      | `SideChatPanel.tsx`, `backendApi.ts`    |


---

## 6. Files touched (summary)

- **backend/llm/nodes/responder_node.py**: Constants, helper, prior context build (replace 1-exchange with N-exchange). Level B: when `conversation_from_client` is True, do not add to conversation_history for persistence.
- **backend/views.py**: Helpers `_message_history_to_conversation_history`, `_conversation_history_to_messages`; set initial_state and loaded_conversation_history from messageHistory when client sent it (do not use checkpoint for conversation in that case). Level A: add `_messages_array_to_conversation_and_query`; parse `messages` in stream path; normalize conversation source (messages → message_history → checkpoint) and set `conversation_from_client`; set `initial_state["conversation_from_client"]`.
- **backend/llm/nodes/routing_nodes.py**: In `handle_attachment_fast`, return `conversation_history` (one exchange, capped) so checkpoint persists prior Q&A when client did not send conversation. Level B: when `conversation_from_client` is True, do not add conversation to state/checkpoint.
- **backend/llm/nodes/planner_node.py**: In the no-scope branch, only use `_canonical_two_step_plan(user_query)` when `messages` is empty; when `messages` is non-empty, fall through to the LLM planner (LobeHub: brain always sees conversation).
- **backend/llm/utils/follow_up_classifier.py** (optional): Multi-turn classifier prompt (last 2 exchanges).
- **frontend-ts/src/components/SideChatPanel.tsx**: Level A: build `messages` array (prior messages from chatMessages + current user message as last element); pass to stream API call.
- **frontend-ts/src/services/backendApi.ts**: Level A: accept and send `messages` in the stream request body alongside `query` and `messageHistory`.

Planner already receives full `messages` when we set them from client or checkpoint; the fix is to use them (no short-circuit when messages exist). Level A/B add the LobeHub-identical request shape and server role (no read/write of conversation when client sends it).
# Chat pipeline and personality (response tone)

This document describes how the chat pipeline works when a user submits a query, and how the system will decide **how** to respond (tone/personality). It is the reference for the personality feature before implementation.

---

## 1. Pipeline structure: what happens when a user submits a query

When a user sends a message, the graph does the following in order.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  USER SUBMITS QUERY                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  START → simple_route(state)                                                  │
│  Decide: fast path or main path?                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                    │
        ┌───────────┼───────────┬────────────────────┬─────────────────────┐
        ▼           ▼           ▼                    ▼                     ▼
   navigation   citation   attachment_fast    fetch_direct_chunks   context_manager
   _action      _query     (file + fast)       (direct doc fetch)    (main path)
        │           │           │                    │                     │
        ▼           ▼           ▼                    ▼                     │
   format_     END         END                 process_docs                 │
   response                                         │                      │
        │                                            ▼                      │
        ▼                                      summarize_results            │
       END                                            │                     │
                                                      ▼                     │
                                                    END                     │
                                                                            │
        ┌───────────────────────────────────────────────────────────────────┘
        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  MAIN PATH (document Q&A)                                                    │
│  context_manager → planner → executor / responder → evaluator → responder  │
└─────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  context_manager   Check/summarize conversation (e.g. 8k token limit).        │
└─────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  planner         Build execution plan (e.g. retrieve_documents, then         │
│                  retrieve_chunks) from user_query and state.                 │
└─────────────────────────────────────────────────────────────────────────────┘
        │
        ├── 0 steps (e.g. refine/format only) ──► responder
        │
        └── 1+ steps ──► executor
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  executor       Run plan steps (call retrieve_documents, retrieve_chunks).  │
│                 Emit execution events.                                       │
└─────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  evaluator      Decide: continue executor? refine plan? or generate answer?  │
└─────────────────────────────────────────────────────────────────────────────┘
        │
        ├── continue  ──► executor
        ├── refine     ──► planner
        └── answer     ──► responder
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  responder      Generate the final answer text from execution results and    │
│                 user query. This is the single place that produces the       │
│                 reply the user sees (on the main path).                      │
└─────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
       END  (final_summary returned to user)
```

**Summary**

- **Fast paths** (navigation, citation click, attachment fast, direct chunks): skip the main pipeline; response is produced by a dedicated handler and then END (or format_response → END).
- **Main path**: `context_manager → planner → executor → evaluator → responder → END`. The **responder** is where the final answer text is generated for normal document Q&A.

There is also an **agent** node (with tools and a loop: agent → tools → agent) used in other flows; personality can be applied there in the same way as in the responder when that path is used.

---

## 2. How the system will decide how to respond (tone/personality)

We add a **personality** (tone) so the same answer can be “friendly”, “efficient”, “professional”, “cynical”, etc. The system will decide tone **in the same LLM call that produces the reply** (no separate “orchestrator” call).

### 2.1 What we store

- **`personality_id`** in graph state (e.g. `"default"`, `"friendly"`, `"efficient"`). It is updated after each reply and passed into the next turn.

### 2.2 Decision rules (in order)

On each turn, when building the **final** reply, the model is instructed to choose a personality for **this turn** using:

1. **Explicit tone request**  
   If the user asks for a tone in their message (e.g. “answer in a friendly way”, “be more concise”, “from now on be professional”), use that personality for this reply.
2. **First message, no tone request**  
   If this is the first message in the conversation and they did not ask for a tone, infer a suitable personality from the **content** of the message (e.g. short factual question → efficient; “explain like I’m new” → friendly).
3. **Otherwise**  
   Use the **previous** personality (the one we stored in state from the last reply).

So: **tone request > first-message inference > previous personality**.

### 2.3 How we get the chosen personality from the model (same call as the response)

- The **same** LLM call that generates the reply must also **output** the chosen personality so we can save it for the next turn.
- We use **structured output**: the model returns both `personality_id` and the reply text, e.g.  
  `{"personality_id": "friendly", "response": "Here’s the answer..."}`  
- We then:
  - save `personality_id` to state for the next turn,
  - show the user only the `response` part.

So: one call per “final answer” → model picks tone and writes reply → we parse `personality_id` + `response` → persist `personality_id`, return `response`.

### 2.4 Where this runs in the pipeline

- **Main path**: In the **responder** node (the node that produces the final answer). The responder’s single LLM call will (1) choose personality using the rules above and (2) generate the reply; its output format will include `personality_id` + `response`.
- **Agent path** (if used): Same idea in the agent’s final turn (the turn where it does not call tools and only outputs the answer). That turn’s output will be structured as `personality_id` + `response`, and we persist `personality_id` for the next turn.

The **system prompt** for that final-answer call will include:

- A short description of each available personality (default, friendly, efficient, professional, nerdy, candid, cynical, listener, robot, quirky).
- The rule: “This turn, choose one personality: if the user asked for a tone use that; if this is the first message and they didn’t ask, infer from the message; otherwise use the previous personality. Then reply in that tone. Output your answer in the required format: `personality_id` + `response`.”

---

## 3. Examples of what this looks like

### Example 1: First message, no tone requested

- **User:** “What’s the market value of the Highlands property?”
- **State:** `messages` empty, no `personality_id` yet.
- **Behaviour:** First message; no explicit tone request. Model infers from content (direct factual question) → e.g. **efficient**.
- **Model output (structured):**  
  `{"personality_id": "efficient", "response": "£2,300,000 — the Market Value for the Highlands property (vacant possession, normal marketing period)."}`
- **After the call:** We set `personality_id = "efficient"` in state and return the `response` to the user.
- **User sees:** “£2,300,000 — the Market Value for the Highlands property (vacant possession, normal marketing period).”

---

### Example 2: First message, user asks for a tone

- **User:** “Explain the lease terms in a friendly way.”
- **State:** First message; no previous `personality_id`.
- **Behaviour:** Explicit tone request (“friendly”) → use **friendly**.
- **Model output:**  
  `{"personality_id": "friendly", "response": "Sure — here’s the lowdown on the lease. The key bits are ..."}`
- **After the call:** We set `personality_id = "friendly"` and return the reply.
- **User sees:** A friendly explanation of the lease terms.

---

### Example 3: Follow-up, no new tone request (reuse previous)

- **User:** “What about the break clause?”
- **State:** `personality_id = "friendly"` from the previous turn.
- **Behaviour:** No new tone request; not first message → keep **friendly**.
- **Model output:**  
  `{"personality_id": "friendly", "response": "The break clause allows ..."}`
- **After the call:** We keep (or re-set) `personality_id = "friendly"`.
- **User sees:** Answer in the same friendly tone.

---

### Example 4: Follow-up, user changes tone

- **User:** “From now on just give me the facts, no fluff.”
- **State:** `personality_id = "friendly"` from before.
- **Behaviour:** Explicit tone request (“just the facts”, “no fluff”) → switch to **efficient** (or **robot**).
- **Model output:**  
  `{"personality_id": "efficient", "response": "Break option at year 5. Notice 6 months. No penalty if conditions met."}`
- **After the call:** We set `personality_id = "efficient"`.
- **User sees:** Short, factual answer. Next turn will also use **efficient** until the user asks for another tone.

---

### Example 5: First message, “explain simply” (inference)

- **User:** “I’m new to this — can you explain what the valuation means in simple terms?”
- **State:** First message; no `personality_id`.
- **Behaviour:** No explicit tone name, but “new to this” and “simple terms” → infer **friendly** (or **listener**).
- **Model output:**  
  `{"personality_id": "friendly", "response": "No problem. Think of the valuation as ..."}`
- **After the call:** We set `personality_id = "friendly"`.
- **User sees:** A simple, approachable explanation.

---

## 4. Summary table

| Situation                          | How personality is chosen       | Example `personality_id` |
|-----------------------------------|----------------------------------|---------------------------|
| First message, user says “be X”   | Explicit request                 | Whatever they asked for   |
| First message, no tone request    | Inferred from message content   | e.g. efficient / friendly |
| Later message, user says “be Y”   | New explicit request             | Y                         |
| Later message, no tone request   | Previous personality             | Same as last turn         |

The pipeline structure (who runs when) is fixed; the only change is that the **final-answer node** (responder, or agent on its final turn) uses the rules above and returns structured `personality_id` + `response`, and we persist `personality_id` in state for the next turn.

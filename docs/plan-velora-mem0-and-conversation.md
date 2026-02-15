# Plan: Mem0 Memory + Conversation Mode for Velora

## Overview

Two goals:
1. **Conversation mode** — Velora can chat naturally without document retrieval unless the user explicitly asks.
2. **Mem0 memory** — Velora remembers user facts across sessions and uses them in replies.

Order: conversation mode first (so there's a chat path to enhance), then Mem0 (so chat becomes personalized).

---

## Current Architecture (for reference)

```
START
  ↓
simple_route() ──→ fast paths (navigation, citation, attachment) → END
  ↓ (everything else)
context_manager  (inject user message, summarize if >8k tokens)
  ↓
planner          (generate execution plan: retrieve_docs, retrieve_chunks steps)
  ↓
executor         (run plan steps, populate execution_results)
  ↓
evaluator        (check quality, route to responder or back to planner)
  ↓
responder        (build answer from execution_results with citations, pick personality)
  ↓
END
```

**Key state fields the API reads from the final state:**
- `final_summary` — answer text shown to user
- `citations` / `chunk_citations` — citation objects
- `personality_id` — chosen personality
- `messages` — conversation history (persisted via checkpointer)
- `agent_actions` — optional frontend actions (open doc, navigate)

---

## PHASE 1: Conversation Mode (no retrieval unless asked)

### 1.1 Intent classifier

**What:** Determine if the user's message is **conversational** (just chatting) or **document-seeking** (wants info from files).

**Where:** New function in `backend/llm/nodes/routing_nodes.py`, called from a new conditional edge after `context_manager` in `main_graph.py`.

**How it classifies:**

- **Document-seeking signals** (if ANY present → document path):
  - `document_ids` is non-empty (user attached a file chip)
  - `property_id` is set and message references documents/reports
  - Message contains retrieval keywords: "search", "find", "look up", "what does the document say", "in my filings", "in the report", "what's the EPC", "valuation", "summary of", "details from", etc.
  - `query_category` is `"document_search"` (if set by upstream)

- **Conversational signals** (if NONE of the above → conversation path):
  - Greetings: "hi", "hello", "how are you", "thanks"
  - Opinions: "what do you think", "do you agree"
  - Follow-ups without doc intent: "tell me more", "why?", "interesting"
  - General chat: no file/property/search keywords

**Implementation:** Start with a keyword/heuristic classifier (fast, no LLM call). Later optionally upgrade to a small LLM classification call if needed.

**Function signature:**
```python
def classify_intent(state: MainWorkflowState) -> str:
    """Return 'conversation' or 'document'."""
```

**File:** `backend/llm/nodes/routing_nodes.py` (add at end)

---

### 1.2 Conversation responder node

**What:** A node that generates a reply using only conversation history + personality — no document retrieval, no chunks, no citations.

**Where:** New file `backend/llm/nodes/conversation_node.py`

**What it does:**
1. Read `messages` from state (conversation history, managed by context_manager).
2. Build a system prompt:
   - Base Velora identity (from `base_system.py` `BASE_ROLE`).
   - Conversation-specific instruction (new prompt in `prompts/conversation.py`):
     "You are having a natural conversation. Do NOT search, retrieve, or reference documents unless the user explicitly asks. Respond in character."
   - Personality overlay: call `get_personality_overlay(previous_personality)` (from `personality.py`).
   - Personality choice instruction (from `get_personality_choice_instruction()`).
   - (Phase 2) Mem0 memories section.
3. Call LLM with `PersonalityResponse` structured output (same as responder uses) to get `personality_id` + `response`.
4. Write to state:
   - `final_summary` = response text
   - `personality_id` = chosen personality
   - `citations` = [] (empty — no documents)
   - `chunk_citations` = [] (empty)
   - `messages` = [AIMessage(content=response text)]

**Why a separate node (not reusing responder):** The responder is tightly coupled to `execution_results`, chunk formatting, and citation extraction. A conversation node is simpler, faster (~1s vs ~4-12s), and avoids all retrieval logic.

**State fields read:** `messages`, `personality_id` (previous), `user_query`
**State fields written:** `final_summary`, `personality_id`, `citations`, `chunk_citations`, `messages`

---

### 1.3 Conversation prompt

**Where:** New file `backend/llm/prompts/conversation.py`

**Contents:**
```python
CONVERSATION_SYSTEM = """
You are having a natural conversation with the user.

RULES:
- Respond naturally and in character (using your personality).
- Do NOT search, retrieve, or reference the user's documents
  unless they explicitly ask to search, look something up, or
  get information from their filings/documents.
- If they ask a general knowledge question, answer from your
  own knowledge. If you're unsure, say so honestly.
- If they ask something that clearly needs their documents,
  let them know you can look it up and suggest they ask
  specifically (e.g. "Would you like me to search your
  documents for that?").
- Keep conversation natural, contextual, and concise.
- Use the conversation history for continuity.
"""
```

---

### 1.4 Wire into the graph

**Where:** `backend/llm/graphs/main_graph.py`

**Changes:**

1. **Import** the new node and classifier:
   ```python
   from backend.llm.nodes.conversation_node import conversation_node
   from backend.llm.nodes.routing_nodes import classify_intent
   ```

2. **Register** the node:
   ```python
   builder.add_node("conversation", conversation_node)
   ```

3. **Replace** the edge `context_manager → planner` with a conditional edge:
   ```python
   # OLD:
   # builder.add_edge("context_manager", "planner")
   
   # NEW:
   def after_context_manager(state):
       intent = classify_intent(state)
       if intent == "conversation":
           return "conversation"
       return "planner"
   
   builder.add_conditional_edges(
       "context_manager",
       after_context_manager,
       {
           "conversation": "conversation",
           "planner": "planner",
       }
   )
   ```

4. **Add edge** from conversation to END:
   ```python
   builder.add_edge("conversation", END)
   ```

**Result:** The graph now looks like:
```
START
  ↓
simple_route() ──→ fast paths → END
  ↓
context_manager
  ↓
after_context_manager()
  ├─ "conversation" → conversation_node → END
  └─ "planner"      → planner → executor → evaluator → responder → END
```

---

### 1.5 State type (no changes needed)

The conversation node writes the **same state fields** as the responder (`final_summary`, `personality_id`, `citations`, `chunk_citations`, `messages`). No new fields required. The API in `views.py` reads these same fields, so the frontend works without changes.

---

### 1.6 Testing checklist (Phase 1)

- [ ] Send "Hi, how are you?" → gets conversation path, no retrieval, natural reply
- [ ] Send "What does my document say about the EPC?" → gets document path, retrieval runs
- [ ] Send "Thanks, that's helpful" → gets conversation path
- [ ] Send "Search my filings for the valuation" → gets document path
- [ ] Personality persists across conversation ↔ document turns
- [ ] `final_summary` is populated, `citations` is empty, frontend renders correctly
- [ ] Long conversation (>8k tokens) triggers context_manager summarization, then conversation path still works

---

## PHASE 2: Mem0 Memory Integration

### 2.1 Install Mem0

**Action:** Add `mem0ai` to requirements.

```bash
pip install mem0ai
```

**Where:** Add to `requirements.txt` (or `pyproject.toml`).

---

### 2.2 Memory service

**Where:** New file `backend/services/memory_service.py`

**What it provides:**
```python
from mem0 import Memory

class VeloraMemory:
    """Wraps Mem0 for Velora. Scoped per user_id."""
    
    def __init__(self):
        self.memory = Memory()  # Uses OpenAI by default
    
    async def search(self, query: str, user_id: str, limit: int = 5) -> list[str]:
        """Return relevant memories as a list of strings."""
        results = self.memory.search(query=query, user_id=user_id, limit=limit)
        return [entry["memory"] for entry in results.get("results", [])]
    
    async def add(self, messages: list[dict], user_id: str) -> None:
        """Store new memories from a conversation turn."""
        self.memory.add(messages, user_id=user_id)

# Singleton
velora_memory = VeloraMemory()
```

**Configuration:** Mem0 uses `gpt-4.1-nano` by default for extraction. You can configure it to use your existing `config.openai_api_key` and change the storage backend (e.g. PostgreSQL via Supabase) when ready for production.

---

### 2.3 Inject memories into prompts

**Where:** Both `conversation_node.py` (Phase 1 node) and `responder_node.py` (document path).

**How:**
1. Before building the system prompt, call:
   ```python
   from backend.services.memory_service import velora_memory
   
   memories = await velora_memory.search(
       query=state["user_query"],
       user_id=state["user_id"],
       limit=5
   )
   ```
2. If memories exist, add a section to the system prompt:
   ```
   ## What Velora Remembers About This User
   - [memory 1]
   - [memory 2]
   ...
   Use these to personalize your response where relevant. Do not
   mention that you have a memory system; just use the information
   naturally.
   ```
3. If no memories, skip the section entirely (no empty heading).

---

### 2.4 Store memories after each turn

**Where:** `backend/views.py` — in the streaming endpoint, after the graph has finished and the final answer is known.

**How:**
1. After `final_summary` is extracted (around line 1901 in views.py):
   ```python
   # Store memories from this turn
   try:
       await velora_memory.add(
           messages=[
               {"role": "user", "content": user_query},
               {"role": "assistant", "content": final_summary},
           ],
           user_id=str(current_user.id),
       )
   except Exception as e:
       logger.warning(f"[MEMORY] Failed to store memories: {e}")
   ```
2. Wrap in try/except so memory failures never break the main flow.
3. This runs after the response is sent (or can be fire-and-forget with `asyncio.create_task`).

---

### 2.5 Config

**Where:** `backend/llm/config.py`

**Add:**
```python
# Mem0 memory
mem0_enabled: bool = True          # Toggle memory on/off
mem0_search_limit: int = 5         # Max memories to inject
```

Use `config.mem0_enabled` as a guard in both injection (2.3) and storage (2.4) so you can turn memory off without code changes.

---

### 2.6 Testing checklist (Phase 2)

- [ ] "My name is Thomas" → stored as memory
- [ ] Next session: "What's my name?" → Velora recalls "Thomas" (from Mem0)
- [ ] Memory appears in system prompt (check logs/LangSmith)
- [ ] Memory failures don't crash the response
- [ ] `mem0_enabled = False` disables all memory calls
- [ ] Memories are scoped per user (user A can't see user B's memories)

---

## Files to create

| File | Purpose |
|------|---------|
| `backend/llm/nodes/conversation_node.py` | Conversation responder node (no retrieval) |
| `backend/llm/prompts/conversation.py` | System prompt for conversation mode |
| `backend/services/memory_service.py` | Mem0 wrapper (search + add) |

## Files to modify

| File | Change |
|------|--------|
| `backend/llm/nodes/routing_nodes.py` | Add `classify_intent()` function |
| `backend/llm/graphs/main_graph.py` | Register conversation node; replace `context_manager → planner` with conditional edge; add `conversation → END` |
| `backend/llm/config.py` | Add `mem0_enabled`, `mem0_search_limit` |
| `backend/views.py` | Add memory storage after response (Phase 2) |
| `requirements.txt` | Add `mem0ai` (Phase 2) |

## Files unchanged

| File | Why |
|------|-----|
| `backend/llm/nodes/responder_node.py` | Document path stays as-is; optionally add Mem0 injection in Phase 2 |
| `backend/llm/nodes/planner_node.py` | No changes needed |
| `backend/llm/nodes/executor_node.py` | No changes needed |
| `backend/llm/nodes/context_manager_node.py` | No changes needed (still manages tokens for both paths) |
| `backend/llm/prompts/personality.py` | No changes needed (both paths use existing personality system) |
| `frontend-ts/` | No changes needed (reads same `final_summary`, `citations`, `personality_id`) |

---

## Risk mitigation

| Risk | Mitigation |
|------|------------|
| Classifier sends doc questions to conversation path | Start conservative: only classify as "conversation" when clearly no doc intent. Default to document path when uncertain. |
| Conversation node missing state fields | Write the exact same fields as responder (`final_summary`, `personality_id`, `citations`, `chunk_citations`, `messages`). |
| Mem0 latency slows responses | Run memory search with a timeout (e.g. 2s). If it times out, proceed without memories. |
| Mem0 stores sensitive/wrong info | Mem0's extraction is LLM-driven; review what it stores in early testing. Add a "forget" capability later if needed. |
| Existing tests break | The document path is completely unchanged; only a new branch is added. Existing tests hit the same planner → executor → responder flow. |

---

## Success criteria

- **Phase 1:** "Hi, how are you?" gets a fast (~1s), natural reply with no retrieval. "What does my document say?" still triggers full retrieval. Frontend unchanged.
- **Phase 2:** Velora remembers "My name is Thomas" and uses it naturally in a later session. Memory failures never break responses.

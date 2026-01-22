# Checkpoint & Database Architecture Analysis

**Date:** 2026-01-20  
**Purpose:** Analyze current state before implementing Summarization + Tool Retry middleware

---

## 📊 Current Database Architecture

### 1. **LangGraph Checkpointer Tables** (Postgres/Supabase)

#### `checkpoints` Table
- **Purpose:** Stores full conversation state snapshots
- **Key Columns:**
  - `thread_id` TEXT - Session identifier (e.g., `session_1768917489584_4flmswhg6`)
  - `checkpoint_id` TEXT - Unique checkpoint UUID
  - `parent_checkpoint_id` TEXT - Previous checkpoint for state lineage
  - `checkpoint_ns` TEXT - Namespace (empty string for main graph)
  - `checkpoint` JSONB - Full serialized state (messages, outputs, etc.)
  - `metadata` JSONB - Step tracking (`{"step": 6, "source": "loop"}`)
  - `created_at` TIMESTAMPTZ - Timestamp

**Current Data:**
- 24 checkpoints stored
- Average size: ~2-3 KB per checkpoint
- Checkpoints accumulate per conversation step (step 1, 2, 3, etc.)

#### `checkpoint_writes` Table
- **Purpose:** Pending state updates before checkpoint finalization
- **Key Columns:**
  - `thread_id`, `checkpoint_id`, `task_id`, `channel`, `type`, `blob`
- **Current Data:** 57 writes stored

#### `checkpoint_blobs` Table
- **Purpose:** Binary large objects for checkpoints
- **Current Data:** 12 blobs stored

---

### 2. **Chat Sessions Table** (Empty - Ready for Use!)

```sql
CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL,
  business_uuid UUID NOT NULL,
  thread_id TEXT UNIQUE NOT NULL,  -- Links to checkpoints.thread_id
  session_name TEXT,                -- User-friendly name
  message_count INTEGER DEFAULT 0,
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);
```

**Status:** ✅ Table exists, **0 rows** (not yet used)

**Key Insight:** This table is perfectly designed for our Phase 2 work!

---

## 🏗️ Current LangGraph Architecture

### Graph Compilation

**File:** `backend/llm/graphs/main_graph.py`

**Current Approach:**
```python
# Lines 510-517
if use_checkpointer:
    checkpointer = await create_checkpointer_for_current_loop()
    main_graph = builder.compile(checkpointer=checkpointer)
else:
    main_graph = builder.compile()
```

**Key Components:**
1. **AsyncPostgresSaver** - Supabase-backed checkpointer
2. **StateGraph** - Uses custom state management
3. **ToolNode** - LangGraph's prebuilt tool executor
4. **No Middleware** - Currently zero middleware (this is what we'll add!)

---

### State Structure

**File:** `backend/llm/types.py`

**`MainWorkflowState` includes:**
```python
class MainWorkflowState(TypedDict, total=False):
    user_query: str
    relevant_documents: list[RetrievedDocument]
    document_outputs: Annotated[list[DocumentProcessingResult], operator.add]
    final_summary: str
    user_id: str
    business_id: str
    conversation_history: Annotated[list[dict], operator.add]
    session_id: str
    
    # NEW: Agent message history (what we need to summarize!)
    messages: Annotated[List[BaseMessage], operator.add]  # ← THIS!
    
    # ... other fields
```

**Critical Discovery:** ✅ We already have `messages: Annotated[List[BaseMessage], operator.add]`!

This is **perfect** for LangGraph's middleware - it's exactly what `SummarizationMiddleware` expects!

---

## 🔍 How Messages Are Currently Stored

### Checkpoints Structure

**Query Results:**
```sql
-- Checkpoint has only 1 key: "v"
SELECT jsonb_object_keys(checkpoint) FROM checkpoints;
-- Result: {"checkpoint_keys": "v"}
```

**What this means:**
- LangGraph serializes the entire state as a versioned blob under `checkpoint.v`
- The `messages` field is inside this blob
- We can't easily query individual messages (they're serialized)

**Implications for Summarization:**
- ✅ Summarization happens **in-memory** during graph execution
- ✅ Summarized messages get **saved back to checkpoint** automatically
- ❌ We can't query "show me all messages" from SQL easily
- ✅ This is fine - LangGraph handles deserialization for us!

---

## 🧠 Session Management (Current State)

### Frontend → Backend Flow

**Frontend (`SideChatPanel.tsx`):**
```typescript
const sessionId = `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
// Example: "chat-1737378000-abc123"
```

**Backend (`SessionManager`):**
```python
def get_thread_id(user_id, business_id, session_id):
    return f"user_{user_id}_business_{business_id}_session_{session_id}"
# Example: "user_1_business_65836ea9_sess_chat-1737378000-abc123"
```

**Checkpointer:**
```python
config = {"configurable": {"thread_id": thread_id}}
graph.invoke(state, config)
# Automatically saves to checkpoints table with this thread_id
```

### ✅ What Works
- Session IDs generated in frontend
- Backend maps to thread_id
- Checkpoints stored per thread_id
- Delete endpoint clears checkpoints

### ⚠️ What's Missing
- **No rows in `chat_sessions` table** - not being used yet
- **No message count tracking** - we don't know conversation length
- **No session names** - all show as "New Chat"
- **No last_message_at** - can't sort by recent activity

---

## 📏 Token Limit Analysis

### Current Issue: **No Context Window Protection**

**Problem:**
- OpenAI GPT-4o context: 128k tokens (~96k words)
- Text-embedding-3-small: 8k tokens
- Average message: ~200-500 tokens
- **After ~200-300 messages, we'll hit the limit and crash!**

**Current Behavior:**
```python
# No limit checking!
messages = state.get("messages", [])  # Could be 500+ messages!
llm.invoke(messages)  # 💥 Crashes if >128k tokens
```

### Token Growth Pattern

| Turn | Messages | Approx Tokens | Status |
|------|----------|---------------|--------|
| 1-10 | 20 msgs | 4,000 | ✅ Safe |
| 11-50 | 100 msgs | 20,000 | ✅ Safe |
| 51-100 | 200 msgs | 40,000 | ⚠️ Warning |
| 101-200 | 400 msgs | 80,000 | ⚠️ Getting close |
| 201+ | 500+ msgs | 100,000+ | 🔥 Will crash! |

**Solution:** Add `SummarizationMiddleware` to condense old messages when >8k tokens

---

## 🛠️ Tool Retry Analysis

### Current Tool Execution

**Tools:**
1. `retrieve_documents(query, broad=True/False)` - Vector search
2. `retrieve_chunks(doc_id, query)` - Chunk search

**Failure Modes (No Retry Currently):**
- Database timeout (Supabase query >10s)
- Network errors (intermittent connection)
- Empty results (could retry with broader search)
- Rate limits (429 errors from OpenAI embeddings)

**Current Behavior:**
```python
# ToolNode executes tools
tools_node = ToolNode(tools=[retrieve_documents, retrieve_chunks])
# If tool fails → ToolMessage with error → Agent sees it
# No automatic retry!
```

**Example Failure:**
```
User: "Find Highland property"
→ Agent calls retrieve_documents("Highland")
→ DB timeout (10.5s query)
→ ToolMessage: "Error: timeout"
→ Agent: "I encountered an error retrieving documents"
❌ Could have worked with a retry!
```

---

## 🎯 Implementation Requirements

### What We Need to Add

#### 1. **Summarization Middleware**

**Purpose:** Prevent token overflow by condensing old messages

**Integration Point:**
```python
# Option A: Use LangChain's create_agent (easiest)
from langchain.agents import create_agent
from langchain.agents.middleware import SummarizationMiddleware

agent = create_agent(
    model="gpt-4o",
    tools=tools,
    checkpointer=checkpointer,  # ✅ Already have
    middleware=[SummarizationMiddleware(...)]  # ← ADD THIS
)

# Option B: Custom node (more control)
builder.add_node("summarize_context", summarization_node)
```

**Trigger Logic:**
- Check message count or token count before agent call
- If >8k tokens → summarize old messages → replace in state
- Keep last 6 messages raw for context

#### 2. **Tool Retry Middleware**

**Purpose:** Auto-retry failed tool calls

**Integration Point:**
```python
from langchain.agents.middleware import ToolRetryMiddleware

agent = create_agent(
    model="gpt-4o",
    tools=tools,
    checkpointer=checkpointer,
    middleware=[
        ToolRetryMiddleware(max_retries=2),  # ← ADD THIS
        SummarizationMiddleware(...)
    ]
)
```

**Behavior:**
- Tool fails with timeout → Wait 1s → Retry
- Tool fails again → Wait 2s → Retry
- After 2 retries → Return error to agent

---

## 🔄 Compatibility Check

### Will Our Current Architecture Work with Middleware?

**✅ YES! Here's why:**

1. **We use `StateGraph`** - Middleware compatible ✅
2. **We have `messages: Annotated[List[BaseMessage], operator.add]`** - Required for summarization ✅
3. **We use `ToolNode`** - Middleware can wrap it ✅
4. **We have `AsyncPostgresSaver`** - Summaries will persist ✅
5. **We use `agent_node` + `tools` pattern** - Standard LangGraph flow ✅

### Migration Path

**Option A: Switch to `create_agent()` wrapper** (Recommended)
- **Pros:** Built-in middleware support, less code, tested
- **Cons:** Less control over graph structure, may need to adapt fast paths
- **Effort:** 2-3 hours (rewrite `main_graph.py`)

**Option B: Keep `StateGraph`, add custom middleware nodes** (More Control)
- **Pros:** Keep existing graph structure, full control
- **Cons:** More code to maintain, manual token counting
- **Effort:** 3-4 hours (create middleware nodes, integrate)

---

## 📊 Before/After Comparison

### Current State (Before Middleware)

```python
# main_graph.py
builder = StateGraph(MainWorkflowState)
builder.add_node("agent", agent_node)
builder.add_node("tools", ToolNode(tools))
graph = builder.compile(checkpointer=checkpointer)
```

**Issues:**
- ❌ No token limit protection
- ❌ No automatic tool retry
- ❌ Will crash after ~200 turns
- ❌ Manual retry logic in agent (semantic retries only)

### After Middleware (Proposed)

**Option A: create_agent wrapper**
```python
from langchain.agents import create_agent
from langchain.agents.middleware import SummarizationMiddleware, ToolRetryMiddleware

agent = create_agent(
    model="gpt-4o",
    tools=[retrieve_documents, retrieve_chunks],
    checkpointer=checkpointer,
    middleware=[
        SummarizationMiddleware(
            model="gpt-4o-mini",
            trigger={"tokens": 8000},
            keep={"messages": 6}
        ),
        ToolRetryMiddleware(max_retries=2)
    ]
)
graph = agent.compile(checkpointer=checkpointer)
```

**Benefits:**
- ✅ Automatic token limit (stays under 8k)
- ✅ Automatic tool retry (2 attempts)
- ✅ Summaries persist in checkpoints
- ✅ ~20 lines of code vs ~500 lines

**Option B: Custom nodes**
```python
builder = StateGraph(MainWorkflowState)
builder.add_node("check_context_length", check_context_node)
builder.add_node("summarize_context", summarization_node)
builder.add_node("agent", agent_node)
builder.add_node("tools", tools_with_retry_node)  # Wrap ToolNode

# Route: check → summarize (if needed) → agent → tools → agent
builder.add_conditional_edges("check_context_length", should_summarize)
```

---

## 🎯 Recommendation

### **Use Option A: `create_agent()` wrapper**

**Why:**
1. **Proven:** LangChain team maintains it
2. **Simple:** ~20 lines vs ~200 lines
3. **Automatic:** No manual token counting
4. **Persistent:** Summaries save to checkpoints
5. **Fast:** No performance overhead

**Migration Steps:**
1. Keep existing tools (`retrieve_documents`, `retrieve_chunks`)
2. Replace `StateGraph` with `create_agent()`
3. Add middleware config (5 lines)
4. Keep fast paths (citation, attachment, navigation) as separate graph routes
5. Test with long conversations

**Estimated Effort:** 2-3 hours

---

## 📋 Key Findings Summary

### ✅ What We Have
- Working checkpointer with Supabase
- `messages` field in state (ready for summarization)
- Session management (frontend → backend)
- Delete functionality (clears checkpoints)
- `chat_sessions` table (empty, ready to use)

### ⏳ What We Need
- **Summarization middleware** (prevent token overflow)
- **Tool retry middleware** (handle failures)
- **Session metadata tracking** (populate `chat_sessions` table)
- **Auto-generate session names** (from first message)

### 🔥 Highest Priority
1. **Add Summarization** - Prevents crashes on long conversations
2. **Add Tool Retry** - Improves reliability
3. **Session CRUD APIs** - Makes backend source of truth
4. **Context summarization UI** - Show users when context is condensed

---

## 🚀 Next Steps

1. Create TODO list for Summarization + Tool Retry implementation
2. Decide: Option A (create_agent) vs Option B (custom nodes)
3. Implement middleware
4. Test with 50+ message conversation
5. Move to Session CRUD APIs (Phase 2B)

---

**Ready to proceed with TODO list creation!**


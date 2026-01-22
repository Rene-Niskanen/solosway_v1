# Checkpointing and Query Priority Fix Plan

## 🔍 Root Cause Analysis

### Issue 1: Chunk Sizes Are Too Large
**Current State:**
- Average chunk size: **14,097 characters**
- Maximum chunk size: **29,144 characters**
- Median chunk size: **7,716 characters**
- 95th percentile: **27,001 characters**

**Problem:**
- Chunks are truncated to 8,000 characters in `generate_conversational_answer` (line 359)
- Large chunks are being cut off, losing important context
- Multiple large chunks can overwhelm the LLM even when truncated

### Issue 2: LLM Prioritizes History Over Current Query
**Current State:**
- Agent node passes **FULL message history** to LLM (line 585: `llm.ainvoke(messages)`)
- No explicit prioritization of current query
- Old conversation context can dominate the LLM's attention
- LLM sees all previous tool calls, responses, and reasoning

**Problem:**
- LLM focuses on patterns from previous messages
- Current query gets "lost" in the conversation history
- Agent may repeat previous answers instead of addressing new query

### Issue 3: Context Manager Not Triggering Properly
**Current State:**
- Context manager node exists but may not be routing correctly
- Summarization threshold: 8,000 tokens
- Keeps last 6 messages, summarizes older ones

**Problem:**
- May not be called before agent_node in the graph
- Token estimation might be inaccurate
- Summarization might not preserve query context

### Issue 4: Checkpoint Structure Unknown
**Current State:**
- Checkpoints table exists but structure unclear
- Need to verify what's being stored
- May be storing too much or too little

---

## 📋 Fix Plan

### Phase 1: Fix Chunk Size Issues (Priority: HIGH)

#### 1.1 Increase Chunk Truncation Limit
**File:** `backend/llm/nodes/agent_node.py`
- **Current:** `chunk_text[:8000]` (line 359)
- **Fix:** Increase to `chunk_text[:12000]` or use token-based truncation
- **Rationale:** Average chunk is 14k chars, truncating to 8k loses 43% of content

#### 1.2 Implement Smart Chunk Selection
**File:** `backend/llm/nodes/agent_node.py`
- **Current:** All chunks concatenated, then truncated
- **Fix:** Prioritize chunks by relevance score, limit to top 5-8 chunks
- **Rationale:** Better to have fewer complete chunks than many truncated ones

#### 1.3 Add Chunk Size Validation
**File:** `backend/llm/tools/chunk_retriever_tool.py`
- **Current:** No size limits on retrieved chunks
- **Fix:** Add max_chunk_size parameter (default: 12,000 chars)
- **Rationale:** Prevent retrieval of oversized chunks that will be truncated

---

### Phase 2: Prioritize Current Query Over History (Priority: CRITICAL)

#### 2.1 Add Query-First Prompt Structure
**File:** `backend/llm/nodes/agent_node.py`
- **Current:** Full message history passed directly to LLM
- **Fix:** Restructure prompt to emphasize current query:
  ```python
  # NEW STRUCTURE:
  # 1. System prompt (role definition)
  # 2. Current user query (HIGHLIGHTED)
  # 3. Recent context summary (last 2-3 exchanges)
  # 4. Full message history (for tool results)
  ```

#### 2.2 Implement Query Isolation for Answer Generation
**File:** `backend/llm/nodes/agent_node.py`
- **Current:** `generate_conversational_answer` receives full chunk text
- **Fix:** Add explicit current query emphasis:
  ```python
  user_prompt = f"""CURRENT USER QUESTION (ANSWER THIS FIRST): {user_query}

  Relevant document excerpts:
  {chunk_text[:12000]}

  IMPORTANT: Focus on answering the CURRENT question above. 
  Previous conversation context is provided for continuity only.
  """
  ```

#### 2.3 Add Query Priority Flag to System Prompt
**File:** `backend/llm/utils/system_prompts.py`
- **Current:** No explicit instruction about query priority
- **Fix:** Add section:
  ```
  ────────────────────────────
  QUERY PRIORITY (CRITICAL)
  ────────────────────────────
  
  The user's CURRENT question is the PRIMARY focus.
  
  - Answer the CURRENT question first and directly
  - Use conversation history ONLY for context and continuity
  - Do NOT repeat previous answers unless explicitly asked
  - If the current question is different from previous questions, 
    provide a NEW answer based on the current query
  ```

---

### Phase 3: Fix Context Manager Integration (Priority: HIGH)

#### 3.1 Verify Context Manager Routing
**File:** `backend/llm/graphs/main_graph.py`
- **Current:** Context manager may not be called before agent_node
- **Fix:** Ensure context_manager_node is called BEFORE agent_node:
  ```python
  builder.add_edge("context_manager", "agent")
  ```

#### 3.2 Improve Token Estimation
**File:** `backend/llm/nodes/context_manager_node.py`
- **Current:** Rough estimation (1 token ≈ 4 chars)
- **Fix:** Use tiktoken for accurate token counting
- **Rationale:** More accurate token counting = better summarization triggers

#### 3.3 Enhance Summarization Prompt
**File:** `backend/llm/nodes/context_manager_node.py`
- **Current:** Generic summarization prompt
- **Fix:** Add explicit instruction to preserve current query context:
  ```
  IMPORTANT: If there is a current user question in the recent messages,
  ensure the summary preserves enough context to answer it accurately.
  ```

---

### Phase 4: Fix Checkpoint Structure (Priority: MEDIUM)

#### 4.1 Analyze Checkpoint Schema
**Action:** Query Supabase to understand checkpoint structure
```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'checkpoints';
```

#### 4.2 Verify Checkpoint Content
**Action:** Sample checkpoint data to see what's stored
```sql
SELECT 
  thread_id,
  checkpoint_id,
  created_at,
  -- Check actual structure
FROM checkpoints
WHERE thread_id LIKE '%b4e2a985-828d-4769-8c41-37526d9e3035%'
LIMIT 1;
```

#### 4.3 Optimize Checkpoint Storage
**File:** `backend/llm/graphs/main_graph.py`
- **Current:** May be storing full message history
- **Fix:** Ensure checkpoints store only necessary state
- **Rationale:** Smaller checkpoints = faster loading, less memory

---

### Phase 5: Add Query Isolation Mode (Priority: MEDIUM)

#### 5.1 Create Query-Isolated Answer Path
**File:** `backend/llm/nodes/agent_node.py`
- **New Function:** `generate_query_isolated_answer()`
- **Purpose:** Generate answer using ONLY current query + chunks, ignoring history
- **Use Case:** When user asks a new question that's different from previous ones

#### 5.2 Add Query Similarity Detection
**File:** `backend/llm/nodes/agent_node.py`
- **New Function:** `is_query_similar_to_history()`
- **Purpose:** Detect if current query is similar to previous queries
- **Logic:** If similarity < 0.7, use query-isolated mode

---

## 🎯 Implementation Order

1. **Phase 2.1 & 2.2** (Query Priority) - **CRITICAL** - Fixes main issue
2. **Phase 1.1 & 1.2** (Chunk Size) - **HIGH** - Prevents information loss
3. **Phase 3.1 & 3.2** (Context Manager) - **HIGH** - Prevents token overflow
4. **Phase 2.3** (System Prompt) - **MEDIUM** - Reinforces query priority
5. **Phase 4** (Checkpoints) - **MEDIUM** - Optimization
6. **Phase 5** (Query Isolation) - **LOW** - Advanced feature

---

## 🧪 Testing Plan

### Test 1: Query Priority
1. Ask question: "What is the value of the offer from Chandni?"
2. Get answer
3. Ask NEW question: "Who signed the agreement?"
4. **Expected:** Agent answers NEW question, not repeating previous answer
5. **Current:** Agent may repeat previous answer

### Test 2: Chunk Size
1. Query document with large chunks
2. Check if answer includes information from end of chunks
3. **Expected:** All relevant information included
4. **Current:** Information may be truncated

### Test 3: Context Manager
1. Have long conversation (10+ exchanges)
2. Check token count logs
3. **Expected:** Summarization triggers at 8k tokens
4. **Current:** May not trigger or may trigger too late

### Test 4: Checkpoint Restoration
1. Start conversation
2. Make 5+ exchanges
3. Restart session with same thread_id
4. **Expected:** Conversation continues correctly
5. **Current:** May have issues with state restoration

---

## 📊 Success Metrics

- ✅ Agent answers CURRENT query, not previous ones
- ✅ Chunk information is not truncated unnecessarily
- ✅ Context manager triggers at correct token threshold
- ✅ Checkpoints store and restore state correctly
- ✅ Token usage stays under 8k per turn (after summarization)

---

## 🔧 Quick Wins (Can Implement Immediately)

1. **Increase chunk truncation** from 8k to 12k chars
2. **Add query emphasis** to `generate_conversational_answer` prompt
3. **Add query priority section** to system prompt
4. **Verify context manager routing** in main_graph.py

---

## ⚠️ Risks and Mitigations

### Risk 1: Token Overflow
- **Mitigation:** Ensure context manager triggers correctly
- **Fallback:** Hard limit on message history length

### Risk 2: Information Loss
- **Mitigation:** Smart chunk selection (top-k by score)
- **Fallback:** Increase truncation limit further

### Risk 3: Breaking Existing Conversations
- **Mitigation:** Test with existing checkpoints
- **Fallback:** Clear checkpoints if needed

---

## 📝 Notes

- Chunk sizes are significantly larger than expected (avg 14k vs assumed ~2-4k)
- Full message history may be overwhelming the LLM's attention mechanism
- Context manager exists but may not be integrated correctly
- Need to verify checkpoint structure before optimizing


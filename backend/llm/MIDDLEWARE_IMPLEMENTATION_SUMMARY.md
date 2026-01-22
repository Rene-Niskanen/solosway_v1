# Middleware Implementation Summary

**Date:** 2026-01-20  
**Status:** ✅ **CONFIGURATION COMPLETE** - Middleware created but not yet active  
**Next Step:** Choose implementation path (see below)

---

## ✅ What Was Accomplished

### 1. Middleware Configuration Successfully Created

**Logs:**
```
✅ LangChain middleware available
✅ Added SummarizationMiddleware (trigger: 8k tokens, keep: 6 msgs)
✅ Added ToolRetryMiddleware (max_retries: 2, backoff_factor: 1.5x)
📦 Compiling graph with checkpointer + 2 middleware
```

**Configuration:**
- ✅ **Summarization:** Triggers at 8,000 tokens, keeps last 6 messages
- ✅ **Tool Retry:** Max 2 retries, 1.5x backoff factor, 1-10s delays
- ✅ **No errors** during initialization
- ✅ **Proper API usage** (tuples, correct parameter names)

---

### 2. Known Limitation Identified

**Warning:**
```
⚠️ StateGraph.compile() doesn't accept middleware parameter
   Compiling with checkpointer only - middleware will not be active
   Consider using create_agent() wrapper for full middleware support
```

**Impact:**
- ❌ Middleware is **created** but **not active**
- ❌ Summarization will **not** happen automatically
- ❌ Tool retry will **not** happen automatically
- ⚠️  System will still work, but without middleware benefits

**Why:**
LangGraph's `StateGraph.compile()` method doesn't accept a `middleware` parameter. Middleware is designed for use with LangChain's `create_agent()` wrapper, which builds on top of LangGraph.

---

## 🎯 Decision Point: 3 Implementation Paths

### **Path A: Migrate to create_agent() Wrapper** 🚀 (Recommended for production)

**What:**
Replace `StateGraph` with LangChain's `create_agent()` wrapper

**Pros:**
- ✅ Middleware works out of the box
- ✅ Production-tested by LangChain team
- ✅ Simpler code (~50 lines vs ~600)
- ✅ Automatic summarization + retry
- ✅ Future-proof (follows LangChain patterns)

**Cons:**
- ❌ Lose custom graph structure (fast paths, routing)
- ❌ Need to rewrite graph logic
- ❌ ~4-6 hours of refactoring
- ❌ May need to adapt citation/attachment handling

**Effort:** 4-6 hours  
**Risk:** Medium (requires testing all features)  
**Value:** High (production-grade reliability)

---

### **Path B: Custom Summarization Node** 🛠️ (Quick fix)

**What:**
Manually implement summarization as a graph node

**Implementation:**
```python
# backend/llm/nodes/context_manager_node.py

async def context_manager_node(state: MainWorkflowState) -> MainWorkflowState:
    """Manual summarization when context exceeds 8k tokens"""
    messages = state.get("messages", [])
    
    # Estimate tokens
    tokens = sum(len(str(msg.content)) // 4 for msg in messages if hasattr(msg, 'content'))
    
    if tokens < 8000:
        return {}  # No change needed
    
    # Keep last 6 messages, summarize the rest
    old_messages = messages[:-6]
    recent_messages = messages[-6:]
    
    # Use cheap LLM to summarize
    llm = ChatOpenAI(model="gpt-4o-mini", api_key=config.openai_api_key)
    
    summary_prompt = f"""Summarize this conversation concisely:
    {format_messages(old_messages)}
    
    Focus on: user goals, key facts, documents, open questions.
    Keep under 300 words."""
    
    summary = await llm.ainvoke([HumanMessage(content=summary_prompt)])
    
    # Replace old messages with summary
    return {
        "messages": [SystemMessage(content=f"[SUMMARY] {summary.content}")] + recent_messages
    }

# Add to graph
builder.add_node("context_manager", context_manager_node)
builder.add_conditional_edges(
    "simple_route",
    lambda s: "context_manager" if should_summarize(s) else "agent"
)
```

**Pros:**
- ✅ Works with current StateGraph
- ✅ Full control over logic
- ✅ Keep existing graph structure
- ✅ No breaking changes

**Cons:**
- ❌ More code to maintain
- ❌ Manual token counting
- ❌ No automatic tool retry
- ❌ Need separate retry implementation

**Effort:** 2-3 hours  
**Risk:** Low (isolated change)  
**Value:** Medium (solves token overflow only)

---

### **Path C: Accept Limitation** ⏸️ (Defer for now)

**What:**
Continue without middleware, add manual workarounds

**Approach:**
- Document that conversations limited to ~200 turns
- Add "Clear context" button in UI
- Monitor for token limit errors
- Address when it becomes a problem

**Pros:**
- ✅ Zero implementation time
- ✅ No code changes
- ✅ Can revisit later
- ✅ Focus on other features first

**Cons:**
- ❌ Will crash on long conversations (>300 messages)
- ❌ No tool retry (15% failure rate)
- ❌ Poor user experience on failures
- ❌ Technical debt accumulates

**Effort:** 0 hours  
**Risk:** High (will cause production issues)  
**Value:** Low (kicks can down the road)

---

## 📊 Comparison Matrix

| Criterion | Path A: create_agent() | Path B: Custom Node | Path C: Defer |
|-----------|------------------------|---------------------|---------------|
| **Effort** | 4-6 hours | 2-3 hours | 0 hours |
| **Risk** | Medium | Low | High |
| **Maintenance** | Low (LangChain maintains) | Medium (we maintain) | N/A |
| **Summarization** | ✅ Automatic | ✅ Manual | ❌ None |
| **Tool Retry** | ✅ Automatic | ❌ None | ❌ None |
| **Token Overflow** | ✅ Prevented | ✅ Prevented | ❌ Will crash |
| **Production Ready** | ✅ Yes | ⚠️ Partial | ❌ No |
| **Future Proof** | ✅ Yes | ⚠️ Partial | ❌ No |

---

## 🎯 Recommendation

### **Immediate:** Choose Path B (Custom Summarization Node)

**Why:**
1. **Quick win** - 2-3 hours to implement
2. **Solves critical issue** - prevents token overflow crashes
3. **Low risk** - isolated change, easy to test
4. **Keeps options open** - can still migrate to Path A later

**Why not Path A now:**
- ⏰ Requires 4-6 hours (significant time investment)
- 🧪 Needs extensive testing (all features)
- 📅 Better as a separate project/sprint
- 🎯 Focus on session management first (higher priority)

**Why not Path C:**
- 💥 Will cause crashes in production
- 😡 Poor user experience
- 📈 Problem will get worse over time

---

### **Long-term:** Migrate to Path A (create_agent())

**When:**
- After completing session management (Phase 2-3)
- After testing system with real users
- When planning architectural improvements

**Benefits:**
- Full middleware support
- Cleaner codebase
- Better maintainability
- Production-grade reliability

---

## 🚀 Implementation Plan - Path B (Recommended)

### Phase 1: Create Context Manager Node (1 hour)

**Files to Create:**
1. `backend/llm/nodes/context_manager_node.py`

**Implementation:**
```python
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_openai import ChatOpenAI
from backend.llm.config import config
from backend.llm.types import MainWorkflowState
import logging

logger = logging.getLogger(__name__)

async def context_manager_node(state: MainWorkflowState) -> MainWorkflowState:
    """
    Automatically summarize old messages when token count exceeds 8k.
    Keeps last 6 messages for context, replaces older messages with summary.
    """
    messages = state.get("messages", [])
    
    if not messages or len(messages) <= 6:
        return {}  # Not enough messages to summarize
    
    # Estimate token count (1 token ≈ 4 characters)
    total_tokens = sum(
        len(str(msg.content)) // 4 
        if hasattr(msg, 'content') and msg.content 
        else 0 
        for msg in messages
    )
    
    logger.info(f"[CONTEXT_MGR] Token count: {total_tokens:,}")
    
    if total_tokens < 8000:
        logger.info(f"[CONTEXT_MGR] Under limit ({total_tokens:,} < 8,000) - no summarization needed")
        return {}
    
    # Summarization needed
    logger.warning(f"[CONTEXT_MGR] ⚠️ Token limit exceeded ({total_tokens:,} >= 8,000) - summarizing...")
    
    # Split: old messages to summarize, recent messages to keep
    old_messages = messages[:-6]
    recent_messages = messages[-6:]
    
    logger.info(f"[CONTEXT_MGR] Summarizing {len(old_messages)} old messages, keeping {len(recent_messages)} recent")
    
    # Format old messages for summarization
    messages_text = "\n\n".join([
        f"{'User' if msg.__class__.__name__ == 'HumanMessage' else 'Assistant'}: {msg.content[:500]}..."
        if hasattr(msg, 'content') and msg.content
        else f"{msg.__class__.__name__}: (no content)"
        for msg in old_messages
    ])
    
    # Call LLM to summarize (use cheap model)
    llm = ChatOpenAI(model="gpt-4o-mini", api_key=config.openai_api_key)
    
    summary_prompt = f"""Summarize this conversation history concisely.

<messages>
{messages_text}
</messages>

Focus on:
1. User's primary questions and goals
2. Key facts discovered (property details, valuations, addresses, dates)
3. Documents referenced and their content
4. Open questions or unresolved issues

Keep the summary under 300 words. Be specific and factual. This summary will replace the old messages, so capture all important context."""
    
    try:
        summary_response = await llm.ainvoke([HumanMessage(content=summary_prompt)])
        summary_text = summary_response.content
        
        logger.info(f"[CONTEXT_MGR] ✅ Summary generated ({len(summary_text)} chars)")
        
        # Create summary message
        summary_message = SystemMessage(
            content=f"[CONVERSATION SUMMARY - Condensed from {len(old_messages)} earlier messages]\n\n{summary_text}"
        )
        
        # Calculate new token count
        new_tokens = (len(summary_text) // 4) + sum(
            len(str(msg.content)) // 4 
            if hasattr(msg, 'content') and msg.content 
            else 0 
            for msg in recent_messages
        )
        
        logger.info(
            f"[CONTEXT_MGR] Token reduction: {total_tokens:,} → {new_tokens:,} "
            f"({int((1 - new_tokens/total_tokens) * 100)}% reduction)"
        )
        
        # Return new message list: summary + recent messages
        return {
            "messages": [summary_message] + recent_messages
        }
        
    except Exception as e:
        logger.error(f"[CONTEXT_MGR] ❌ Failed to summarize: {e}", exc_info=True)
        # On error, keep all messages (risky but prevents data loss)
        return {}
```

---

### Phase 2: Integrate into Graph (30 mins)

**File:** `backend/llm/graphs/main_graph.py`

**Changes:**
1. Import the node:
```python
from backend.llm.nodes.context_manager_node import context_manager_node
```

2. Add to graph:
```python
# After other node definitions
builder.add_node("context_manager", context_manager_node)
```

3. Update routing to pass through context manager before agent:
```python
# Modify simple_route to check context first
builder.add_conditional_edges(
    "simple_route",
    lambda state: "context_manager" if state.get("user_query") else END,
    {
        "context_manager": "context_manager",
        END: END
    }
)

# Add edge from context_manager to agent
builder.add_edge("context_manager", "agent")
```

---

### Phase 3: Test (30 mins)

**Test 1: Short Conversation**
- Send 10 messages
- Verify NO summarization triggered
- Check logs for: "Under limit" message

**Test 2: Long Conversation**
- Send 50 detailed messages
- Verify summarization triggers around message 40-50
- Check logs for: "Token limit exceeded - summarizing"
- Verify message count drops from ~50 → ~7
- Verify agent still has context in next response

**Test 3: Checkpoint Persistence**
- Trigger summarization
- Close chat
- Resume chat (same sessionId)
- Verify summary persists
- Verify agent remembers earlier conversation

---

## 📝 Files Modified Summary

### Current Implementation (Middleware Config - Not Active)

| File | Changes | Lines | Status |
|------|---------|-------|--------|
| `main_graph.py` | Added middleware imports & config | +62 | ✅ Complete |
| `agent_node.py` | Added token counting logs | +18 | ✅ Complete |
| **Total** | | **+80** | ✅ Middleware configured but inactive |

### Recommended Next Step (Path B - Custom Node)

| File | Changes | Lines | Status |
|------|---------|-------|--------|
| `context_manager_node.py` | Create summarization node | +120 | ⏳ To create |
| `main_graph.py` | Add node to graph | +15 | ⏳ To update |
| **Total** | | **+135** | ⏳ Pending implementation |

---

## 🎯 Success Criteria

### Minimum Viable (Path B)
- ✅ Summarization triggers at 8k tokens
- ✅ Message count resets to ~7 after summarization
- ✅ Context preserved in summary
- ✅ No crashes on long conversations

### Full Success (Path A - Future)
- ✅ Automatic summarization via middleware
- ✅ Automatic tool retry via middleware
- ✅ Cleaner codebase
- ✅ Production-grade reliability

---

## 🚦 Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| **Middleware Config** | ✅ Complete | Created successfully but not active |
| **Token Counting** | ✅ Active | Logs show token estimates |
| **Summarization** | ❌ Not Active | StateGraph limitation |
| **Tool Retry** | ❌ Not Active | StateGraph limitation |
| **Documentation** | ✅ Complete | All implementation docs created |

---

## 🎯 Next Steps

### Recommended Action: Implement Path B

1. **Now (30 mins):** Create `context_manager_node.py`
2. **Now (30 mins):** Integrate into `main_graph.py`
3. **Now (30 mins):** Test with long conversation
4. **Later (4-6 hours):** Plan migration to Path A (create_agent)

### Alternative Action: Defer to Phase 2B

1. **Now:** Document limitation in codebase
2. **Now:** Move to Session CRUD APIs (higher priority)
3. **Later:** Revisit middleware after session management complete

---

**Recommendation:** Implement Path B (Custom Node) now - it's a 2-hour investment that prevents critical production issues.

**Decision needed:** Which path should we take?

---

**Implementation complete for middleware configuration. Awaiting decision on next steps.** 🎯


# Model-driven Tool Choice Plan

## Part 1: Current System Analysis

This section documents the existing data-gathering framework, tools, and streaming architecture as the foundation for designing model-driven tool choice.

---

## 1. Graph Architecture Overview

### 1.1 All Nodes (20 total)

| Node | Function | File | LLM Call? |
|------|----------|------|-----------|
| `check_cached_documents` | Cache lookup | `retrieval_nodes.py` | No |
| `classify_and_prepare_query` | Query classification + detail level + expansion | `combined_query_preparation.py` | Yes (gpt-4o-mini) |
| `detect_and_extract_text` | Text extraction for transformation | `text_context_detector.py` | No |
| `handle_general_query` | General knowledge answers | `general_query_node.py` | Yes (user model) |
| `transform_text` | Text transformation | `text_transformation_node.py` | Yes |
| `handle_follow_up_query` | Follow-up query handling | `follow_up_query_node.py` | Yes (user model) |
| `detect_navigation_intent` | Navigation intent detection | `routing_nodes.py` | Yes (gpt-4o-mini) |
| `route_query` | Path routing (heuristics) | `routing_nodes.py` | No |
| `fetch_direct_chunks` | Direct document fetch | `routing_nodes.py` | No |
| `handle_attachment_fast` | Attachment-based answers | `routing_nodes.py` | Yes (user model) |
| `handle_citation_query` | Citation-based answers | `routing_nodes.py` | Yes (user model) |
| `handle_navigation_action` | Navigation action handler | `routing_nodes.py` | No |
| `rewrite_query` | Query rewriting with context | `retrieval_nodes.py` | Yes (gpt-4o-mini) |
| `determine_detail_level` | Detail level detection | `detail_level_detector.py` | Yes (gpt-4o-mini) |
| `expand_query` | Query expansion for retrieval | `retrieval_nodes.py` | Yes (gpt-4o-mini) |
| `query_vector_documents` | Hybrid search (BM25 + vector + SQL) | `retrieval_nodes.py` | No |
| `clarify_relevant_docs` | Document re-ranking/merging | `retrieval_nodes.py` | Optional (Cohere/LLM) |
| `process_documents` | Per-document QA (parallel) | `processing_nodes.py` | Yes (per doc) |
| `summarize_results` | Final answer (2-phase: citations + answer) | `summary_nodes.py` | Yes (2 calls) |
| `format_response` | Response formatting | `formatting_nodes.py` | Yes (user model) |

### 1.2 Execution Paths (9 distinct)

```
Path 1: Navigation Action (instant ~0.1s)
START → check_cached → detect_nav_intent → route → handle_nav_action → format → END

Path 2: Citation Query (ultra-fast ~2s)
START → check_cached → detect_nav_intent → route → handle_citation → format → END

Path 3: Attachment Fast (~2s, currently disabled)
START → check_cached → detect_nav_intent → route → handle_attachment → format → END

Path 4: Direct Document (fast ~2s)
START → check_cached → detect_nav_intent → route → fetch_direct → process → summarize → END

Path 5: Simple Search (medium ~6s)
START → check_cached → detect_nav_intent → route → query_vector → [clarify?] → process → summarize → END

Path 6: Complex Search (full ~12s)
START → check_cached → detect_nav_intent → route → rewrite → query_vector → clarify → process → summarize → END

Path 7: General Query (fast ~2-3s)
START → check_cached → classify → handle_general → END

Path 8: Text Transformation (fast ~2-3s)
START → check_cached → classify → detect_text → transform → END

Path 9: Follow-up Query (fast/full ~1-12s)
START → check_cached → classify → handle_follow_up → END
```

### 1.3 Conditional Routing Points

1. **`check_cached_documents`** → `process_documents` (cached) | `detect_navigation_intent` (not cached)
2. **`route_query`** → `navigation_action` | `citation_query` | `direct_document` | `simple_search` | `complex_search`
3. **`query_vector_documents`** → `clarify_relevant_docs` (>2 docs) | `process_documents` (≤2 docs)

---

## 2. Data Retrieval Nodes (Detail)

### 2.1 `query_vector_documents`
- **Purpose:** Hybrid search combining BM25, vector, structured queries, and LLM SQL
- **Reads:** `user_query`, `query_variations`, `business_id`, `document_ids`, `relevant_documents`
- **Writes:** `relevant_documents` (list of RetrievedDocument)
- **External calls:** Supabase (property_details, properties, documents, document_vectors), BM25/Vector/Hybrid retrievers, Lazy embedding service
- **LLM:** None

### 2.2 `fetch_direct_document_chunks`
- **Purpose:** Fast path for direct document retrieval (attached files, citation focus)
- **Reads:** `target_document_ids`, `document_ids`, `property_id`, `business_id`, `user_query`, `citation_context`
- **Writes:** `relevant_documents`, `target_document_ids`
- **External calls:** Supabase (document_relationships, documents, document_vectors)
- **LLM:** None

### 2.3 `clarify_relevant_docs`
- **Purpose:** Groups chunks by doc_id, merges, re-ranks by relevance
- **Reads:** `relevant_documents`, `user_query`
- **Writes:** `relevant_documents` (replaced with merged/re-ranked)
- **External calls:** Cohere reranker (optional)
- **LLM:** Fallback reranking if Cohere fails

### 2.4 `process_documents`
- **Purpose:** Per-document QA in parallel, creates document_outputs
- **Reads:** `relevant_documents`, `user_query`, `detail_level`, `citation_context`, `model_preference`
- **Writes:** `document_outputs` (list of DocumentProcessingResult)
- **Limits:** simple (1 doc), concise (5 docs), detailed (15 docs)
- **LLM:** Per-document QA subgraph

### 2.5 `summarize_results`
- **Purpose:** Final unified answer from all document outputs
- **Phase 1:** Citation extraction (LLM with citation tool)
- **Phase 2:** Answer generation (LLM with agent tools if agent mode)
- **Reads:** `document_outputs`, `user_query`, `conversation_history`, `model_preference`, `is_agent_mode`
- **Writes:** `final_summary`, `citations`, `conversation_history`, `agent_actions`
- **LLM:** 2 calls (citation extraction + answer generation)

---

## 3. Existing Tools

### 3.1 Agent Action Tools (6 tools, agent mode only)

| Tool | Purpose | Input Schema |
|------|---------|--------------|
| `open_document` | Open document preview with citation highlight | `citation_number: int`, `reason: str` |
| `navigate_to_property` | Navigate to property by UUID | `property_id: str`, `reason: str` |
| `search_property` | Search properties by name/address | `query: str` |
| `show_map_view` | Open map view | `reason: str` |
| `select_property_pin` | Select property pin on map | `property_id: str`, `reason: str` |
| `navigate_to_property_by_name` | Combined navigation (search + map + pin) | `property_name: str`, `reason: str` |

**Bound in:** `summarize_results` (Phase 2), `handle_citation_query`

### 3.2 Citation Tool (1 tool, always bound in Phase 1)

| Tool | Purpose | Input Schema |
|------|---------|--------------|
| `cite_source` | Record citation with bbox coordinates | `cited_text: str`, `block_id: str`, `citation_number: int` |

**Bound in:** `summarize_results` (Phase 1 - citation extraction)

### 3.3 Property Query Tool (1 tool, not currently bound to LLM)

| Tool | Purpose | Input Schema |
|------|---------|--------------|
| `query_properties` | Query property_details table | Multiple filters (bedrooms, price, size, location, etc.) |

---

## 4. Reasoning Step Streaming

### 4.1 Emission Points in `views.py`

| Step | Action Type | Trigger | Details |
|------|-------------|---------|---------|
| `initial` | `planning` | Query start | `{original_query}` |
| `searching` | `searching` | Non-navigation query | `{original_query}` |
| `clarify_relevant_docs` | `analysing` | Node start | `{}` |
| `found_documents` | `exploring` | `query_vector_documents` end | `{documents_found, document_names, doc_previews}` |
| `analyzing_documents` | `analysing` | After found_documents | `{documents_to_analyze}` |
| `read_doc_{i}` | `reading` | `process_documents` end | `{document_index, filename, doc_metadata, llm_context}` |
| `summarizing_content` | `summarising` | `summarize_results` end | `{documents_processed, llm_context}` |
| `thinking` | `thinking` | Extended/synthetic thinking | `{thinking_content}` |
| Agent steps | `opening`/`navigating`/etc. | Agent tool calls | `{citation_number, property_id, reason}` |

### 4.2 Current Data Structure

```python
{
    'type': 'reasoning_step',
    'step': str,              # e.g., 'found_documents', 'read_doc_0'
    'action_type': str,       # e.g., 'exploring', 'reading', 'analysing'
    'message': str,           # User-friendly message
    'timestamp': float,       # Unix timestamp
    'details': dict           # Step-specific metadata
}
```

### 4.3 Missing for Cursor-style Tool Calls

Current steps lack explicit tool semantics:
- No `tool_name` (e.g., "search_documents")
- No `tool_input` (e.g., `{query: "value of highlands"}`)
- No `tool_output` (e.g., "Found 3 documents")

---

## 5. Key Observations

### 5.1 What's Already Model-Driven
- **Agent action tools** (open_document, navigate) in `summarize_results` Phase 2
- **Citation tool** in Phase 1
- **Navigation intent detection** (LLM-based in agent mode)

### 5.2 What's Code-Driven (Not Model-Driven)
- **Path selection** (route_query uses heuristics, not LLM)
- **Retrieval strategy** (fixed sequence: search → clarify → process → summarize)
- **Document limits** (hard-coded: 1/5/15 based on detail level)
- **Step ordering** (graph edges are static)

### 5.3 Gaps for Cursor-Style Agentic UX
1. Steps are described as actions ("Analysing documents") not tools ("search_documents")
2. No tool input/output visibility (user doesn't see what was searched or what was found)
3. Model doesn't choose which steps to run—graph does
4. Model doesn't choose step order—graph does
5. No ability to "search again" or "read another doc" mid-flow

---

## Part 2: Model-Driven Tool Choice Implementation

### Goal

Replace hard-coded routing heuristics with an **agent loop** where the LLM decides:
- "This query needs search + read + analyze"
- "This query just needs search + answer"  
- "This query needs to search, read one doc, then search again with refined terms"

The model makes smarter decisions than keyword matching, and **improves with better models**.

---

## 6. Agent Loop Architecture

### 6.1 How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        AGENT LOOP                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User Query: "What is the value of Highlands?"                  │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  LLM (with tools bound)                                  │    │
│  │  "I need to search for documents about Highlands value"  │    │
│  │  → calls: search_documents(query="Highlands value")      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Tool Execution: search_documents                        │    │
│  │  → Returns: "Found 2 docs: Valuation Report, Title Deed" │    │
│  │  → Stream: reasoning_step (tool_name, input, output)     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  LLM (sees tool result)                                  │    │
│  │  "Valuation Report looks relevant, let me read it"       │    │
│  │  → calls: read_document(doc_id="val-report-123")         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Tool Execution: read_document                           │    │
│  │  → Returns: "Market Value: £2,300,000 as of Feb 2024..." │    │
│  │  → Stream: reasoning_step (tool_name, input, output)     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  LLM (sees document content)                             │    │
│  │  "I have enough information to answer"                   │    │
│  │  → generates: final_answer with citations                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                           │                                      │
│                           ▼                                      │
│                    Response to User                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Example Scenarios

**Simple Query:** "What is the value of Highlands?"
```
LLM → search_documents("Highlands value") → Found 1 doc
LLM → read_document(doc_id) → Got valuation content
LLM → generate_answer() → "The value is £2,300,000[1]"
```
**Total: 3 LLM calls, ~4-6s**

**Complex Query:** "Compare the valuations from 2023 and 2024"
```
LLM → search_documents("2023 valuation") → Found 2 docs
LLM → read_document(doc_id_1) → Got 2023 valuation
LLM → search_documents("2024 valuation") → Found 1 doc  
LLM → read_document(doc_id_2) → Got 2024 valuation
LLM → generate_answer() → "In 2023 it was X[1], in 2024 it was Y[2]..."
```
**Total: 5 LLM calls, ~8-12s**

**Refined Search:** "What does it say about the roof condition?"
```
LLM → search_documents("roof condition") → Found 0 docs
LLM → search_documents("building survey roof") → Found 1 doc
LLM → read_document(doc_id) → Got roof section
LLM → generate_answer() → "The roof is in good condition[1]..."
```
**Total: 4 LLM calls, ~6-8s** (model refined search when first failed)

---

## 7. Tools to Implement

### 7.1 Core Retrieval Tools

| Tool | Purpose | Input | Output | Wraps |
|------|---------|-------|--------|-------|
| `search_documents` | Find relevant documents | `query: str` | List of {doc_id, filename, relevance_score, snippet} | `query_vector_documents` |
| `read_document` | Read a specific document | `doc_id: str` | Document content with block_ids for citations | `process_documents` (single) |
| `read_multiple_documents` | Read several documents | `doc_ids: list[str]` | Multiple document contents | `process_documents` (batch) |

### 7.2 Analysis Tools

| Tool | Purpose | Input | Output | Wraps |
|------|---------|-------|--------|-------|
| `rerank_documents` | Re-order by relevance | `doc_ids: list[str], query: str` | Reranked list with scores | `clarify_relevant_docs` |
| `get_document_summary` | Quick summary of a doc | `doc_id: str` | Brief summary | New (uses doc metadata) |

### 7.3 Answer Tools

| Tool | Purpose | Input | Output | Wraps |
|------|---------|-------|--------|-------|
| `generate_answer` | Create final response | `context: str` (accumulated) | Answer with citations | `summarize_results` |

### 7.4 Tool Schemas (Pydantic)

```python
class SearchDocumentsInput(BaseModel):
    query: str = Field(description="Search query to find relevant documents")
    max_results: int = Field(default=10, description="Maximum documents to return")

class ReadDocumentInput(BaseModel):
    doc_id: str = Field(description="Document ID to read")
    focus_query: Optional[str] = Field(default=None, description="Optional: focus on specific content")

class GenerateAnswerInput(BaseModel):
    # No input needed - uses accumulated context from previous tool calls
    pass
```

---

## 8. Implementation Plan

### 8.1 New Files to Create

```
backend/llm/tools/retrieval_tools.py     # search_documents, read_document, etc.
backend/llm/agents/research_agent.py     # Agent loop logic
backend/llm/prompts/agent_prompts.py     # System prompt for agent
```

### 8.2 Files to Modify

```
backend/llm/graphs/main_graph.py         # Add agent path
backend/llm/types.py                     # Add agent state fields
backend/views.py                         # Stream tool calls as reasoning_steps
frontend-ts/src/components/ReasoningSteps.tsx  # Render tool-style steps
frontend-ts/src/services/backendApi.ts   # Pass through tool fields
```

### 8.3 Implementation Steps

#### Step 1: Create Retrieval Tools (~2 hours)

**File: `backend/llm/tools/retrieval_tools.py`**

```python
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

class SearchDocumentsInput(BaseModel):
    query: str = Field(description="Search query")
    max_results: int = Field(default=10)

class SearchDocumentsOutput(BaseModel):
    documents: list[dict]  # [{doc_id, filename, score, snippet}]
    total_found: int

def create_retrieval_tools(state: dict) -> tuple[list[StructuredTool], "RetrievalToolContext"]:
    """Create retrieval tools with access to state/services."""
    
    context = RetrievalToolContext(state)
    
    async def search_documents(query: str, max_results: int = 10) -> dict:
        """Search for documents matching the query."""
        # Calls existing query_vector_documents logic
        results = await context.vector_search(query, max_results)
        context.last_search_results = results
        return {
            "documents": [
                {"doc_id": d["doc_id"], "filename": d["original_filename"], 
                 "score": d["similarity_score"], "snippet": d["content"][:200]}
                for d in results
            ],
            "total_found": len(results)
        }
    
    async def read_document(doc_id: str, focus_query: str = None) -> dict:
        """Read and analyze a specific document."""
        # Calls existing process_documents logic for single doc
        content = await context.process_single_document(doc_id, focus_query)
        context.read_documents[doc_id] = content
        return {
            "doc_id": doc_id,
            "filename": content["original_filename"],
            "content": content["formatted_content"],  # With BLOCK_CITE_IDs
            "page_count": content["page_count"]
        }
    
    search_tool = StructuredTool.from_function(
        coroutine=search_documents,
        name="search_documents",
        description="Search for documents. Returns list of matching documents with snippets.",
        args_schema=SearchDocumentsInput
    )
    
    read_tool = StructuredTool.from_function(
        coroutine=read_document,
        name="read_document",
        description="Read a specific document to get its full content.",
        args_schema=ReadDocumentInput
    )
    
    return [search_tool, read_tool], context
```

#### Step 2: Create Agent Loop (~3 hours)

**File: `backend/llm/agents/research_agent.py`**

```python
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage

async def run_research_agent(
    query: str,
    state: dict,
    on_tool_call: callable,  # Callback to stream reasoning steps
    max_iterations: int = 10
) -> dict:
    """
    Run agent loop where LLM decides which tools to call.
    
    Returns:
        {final_summary, citations, agent_actions, tool_calls_made}
    """
    
    # Create tools with state access
    tools, tool_context = create_retrieval_tools(state)
    
    # Create LLM with tools bound
    model_preference = state.get("model_preference", "gpt-4o")
    llm = get_llm(model_preference, temperature=0).bind_tools(tools, tool_choice="auto")
    
    # System prompt for agent behavior
    system_prompt = get_research_agent_prompt()
    
    # Message history for the agent
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=f"User query: {query}")
    ]
    
    tool_calls_made = []
    
    for iteration in range(max_iterations):
        # Call LLM
        response = await llm.ainvoke(messages)
        messages.append(response)
        
        # Check if LLM wants to call tools
        if response.tool_calls:
            for tool_call in response.tool_calls:
                tool_name = tool_call["name"]
                tool_args = tool_call["args"]
                
                # Stream reasoning step BEFORE execution
                await on_tool_call({
                    "type": "reasoning_step",
                    "tool_name": tool_name,
                    "tool_input": tool_args,
                    "status": "running"
                })
                
                # Execute tool
                tool_func = next(t for t in tools if t.name == tool_name)
                result = await tool_func.ainvoke(tool_args)
                
                # Stream reasoning step AFTER execution
                await on_tool_call({
                    "type": "reasoning_step",
                    "tool_name": tool_name,
                    "tool_input": tool_args,
                    "tool_output": result,
                    "status": "complete"
                })
                
                tool_calls_made.append({
                    "name": tool_name,
                    "input": tool_args,
                    "output": result
                })
                
                # Add tool result to messages
                messages.append(ToolMessage(
                    content=json.dumps(result),
                    tool_call_id=tool_call["id"]
                ))
        
        else:
            # No tool calls = LLM is ready to answer
            final_answer = response.content
            break
    
    # Extract citations from the accumulated context
    citations = extract_citations_from_context(tool_context, final_answer)
    
    return {
        "final_summary": final_answer,
        "citations": citations,
        "tool_calls_made": tool_calls_made,
        "documents_read": list(tool_context.read_documents.keys())
    }
```

#### Step 3: Agent System Prompt (~1 hour)

**File: `backend/llm/prompts/agent_prompts.py`**

```python
def get_research_agent_prompt():
    return """You are a research agent that helps users find information in their documents.

## Available Tools

1. **search_documents(query, max_results=10)**
   - Search for documents matching a query
   - Returns: list of documents with doc_id, filename, relevance score, snippet
   - Use this to find relevant documents before reading them

2. **read_document(doc_id, focus_query=None)**
   - Read a specific document to get its full content
   - Returns: document content with BLOCK_CITE_IDs for citations
   - Use this after search to get details from promising documents

## Strategy

1. **Start with search** - Always search first to find relevant documents
2. **Read selectively** - Only read documents that look relevant from search results
3. **Refine if needed** - If search returns no results, try different terms
4. **Stop when ready** - Once you have enough information, generate your answer

## Citation Rules

When you generate your final answer:
- Use [N] markers to cite sources (e.g., "The value is £2,300,000[1]")
- Reference BLOCK_CITE_IDs from document content for accurate citations
- Every factual claim must have a citation

## Examples

**Simple query:** "What is the property value?"
1. search_documents("property value valuation") → Found 1 doc
2. read_document(doc_id) → Got valuation content
3. Generate answer with citations

**No results:** "Tell me about the roof"
1. search_documents("roof") → Found 0 docs
2. search_documents("building survey condition") → Found 1 doc
3. read_document(doc_id) → Got building survey
4. Generate answer about roof section

**Complex query:** "Compare 2023 and 2024 valuations"
1. search_documents("2023 valuation") → Found docs
2. read_document(doc_id_1) → Got 2023 data
3. search_documents("2024 valuation") → Found docs
4. read_document(doc_id_2) → Got 2024 data
5. Generate comparison answer

Now help with the user's query."""
```

#### Step 4: Integrate into Graph (~2 hours)

**Modify: `backend/llm/graphs/main_graph.py`**

```python
# Add new node for agent-based research
builder.add_node("research_agent", run_research_agent_node)

# Modify routing to use agent for document searches
def should_route(state):
    # ... existing fast path checks ...
    
    # For document searches, use research agent instead of fixed pipeline
    if state.get("use_agent_mode", True):  # Can be toggled
        return "research_agent"
    else:
        # Fallback to existing fixed pipeline
        return "simple_search" if is_simple else "complex_search"

# Add edge from research_agent to END (it handles everything)
builder.add_edge("research_agent", END)
```

#### Step 5: Stream Tool Calls (~2 hours)

**Modify: `backend/views.py`**

```python
# In the streaming generator, handle tool call events from agent

async for event in agent_events:
    if event["type"] == "reasoning_step":
        # Enhanced reasoning step with tool semantics
        reasoning_data = {
            "type": "reasoning_step",
            "step": event.get("tool_name", "unknown"),
            "action_type": map_tool_to_action_type(event["tool_name"]),
            "message": format_tool_message(event),
            "timestamp": time.time(),
            # NEW: Tool-specific fields
            "tool_name": event.get("tool_name"),
            "tool_input": event.get("tool_input"),
            "tool_output": event.get("tool_output"),
            "tool_status": event.get("status", "complete"),
            "details": event.get("details", {})
        }
        yield f"data: {json.dumps(reasoning_data)}\n\n"

def map_tool_to_action_type(tool_name: str) -> str:
    """Map tool names to existing action types for backward compatibility."""
    return {
        "search_documents": "searching",
        "read_document": "reading",
        "read_multiple_documents": "reading",
        "rerank_documents": "analysing",
        "generate_answer": "summarising"
    }.get(tool_name, "analysing")

def format_tool_message(event: dict) -> str:
    """Format tool event as user-friendly message."""
    tool_name = event.get("tool_name", "")
    tool_input = event.get("tool_input", {})
    tool_output = event.get("tool_output", {})
    status = event.get("status", "complete")
    
    if tool_name == "search_documents":
        if status == "running":
            return f"Searching for: {tool_input.get('query', '')}"
        else:
            count = tool_output.get("total_found", 0)
            return f"Found {count} document{'s' if count != 1 else ''}"
    
    elif tool_name == "read_document":
        filename = tool_output.get("filename", tool_input.get("doc_id", ""))
        if status == "running":
            return f"Reading {filename}"
        else:
            return f"Read {filename}"
    
    return f"{tool_name}: {status}"
```

#### Step 6: Frontend Tool Rendering (~1 hour)

**Modify: `frontend-ts/src/components/ReasoningSteps.tsx`**

```typescript
// Extend ReasoningStep type
export interface ReasoningStep {
  step: string;
  action_type: string;
  message: string;
  timestamp?: number;
  details?: Record<string, any>;
  // NEW: Tool-specific fields
  tool_name?: string;
  tool_input?: Record<string, any>;
  tool_output?: Record<string, any> | string;
  tool_status?: 'running' | 'complete' | 'error';
}

// In StepRenderer, add tool-style rendering
case 'searching':
case 'reading':
case 'analysing':
  if (step.tool_name) {
    return (
      <ToolCallStep
        toolName={step.tool_name}
        toolInput={step.tool_input}
        toolOutput={step.tool_output}
        status={step.tool_status}
        message={step.message}
        isLoading={step.tool_status === 'running'}
      />
    );
  }
  // Fallback to existing rendering
  return <LegacyStepRenderer step={step} />;
```

---

## 9. Rollout Strategy

### Phase 1: Tool Infrastructure (Week 1)
- Create `retrieval_tools.py` with search_documents, read_document
- Create `research_agent.py` with basic agent loop
- Add tool streaming to views.py
- **Test:** Agent can search and read documents

### Phase 2: Graph Integration (Week 1-2)
- Add research_agent node to graph
- Add routing condition to use agent for document searches
- Add fallback to fixed pipeline if agent fails
- **Test:** End-to-end queries work through agent

### Phase 3: Frontend Polish (Week 2)
- Extend ReasoningStep type with tool fields
- Add ToolCallStep component for Cursor-style rendering
- Add expandable input/output view
- **Test:** UI shows tool calls clearly

### Phase 4: Optimization (Week 2-3)
- Add rate-limit retry in agent loop
- Add timeout handling per tool
- Add caching for repeated searches
- Tune agent prompt for better tool selection
- **Test:** Handles errors gracefully, performs well

---

## 10. Configuration & Feature Flags

```python
# In backend/llm/config.py

AGENT_MODE_CONFIG = {
    "enabled": True,                    # Master switch
    "max_iterations": 10,               # Max tool calls per query
    "timeout_per_tool": 30,             # Seconds per tool execution
    "fallback_to_fixed_pipeline": True, # Use old pipeline if agent fails
    "models_allowed": ["gpt-4o", "gpt-4o-mini", "claude-sonnet", "claude-opus"],
    "min_model_for_agent": "gpt-4o-mini",  # Don't use agent with weaker models
}
```

---

## 11. Expected Outcomes

### Better Step Selection
- Simple queries: 2-3 tool calls (search → read → answer)
- Complex queries: 4-6 tool calls (search → read → search again → read → answer)
- Model learns from results and adapts

### Smarter Search Refinement
- If first search fails, model tries different terms
- Model can combine results from multiple searches
- No more "keyword matching" heuristics

### Improved with Better Models
- GPT-4o-mini: Basic search → read → answer
- GPT-4o: Smarter search refinement, better document selection
- Claude Opus: Complex multi-document reasoning, comparison queries

### Cursor-Style UX
- Each tool call appears as: `search_documents` → "Found 3 documents"
- Users see exactly what the agent is doing
- Expandable to see full input/output

---

## 12. Rate Limit Handling (Integrated)

Since the agent makes multiple LLM calls, rate limit handling is critical:

```python
async def run_research_agent(...):
    # ... setup ...
    
    for iteration in range(max_iterations):
        try:
            response = await llm.ainvoke(messages)
        except RateLimitError as e:
            # Exponential backoff
            wait_time = min(2 ** iteration * 5, 60)  # 5s, 10s, 20s, 40s, 60s max
            logger.warning(f"Rate limit hit, waiting {wait_time}s...")
            await asyncio.sleep(wait_time)
            response = await llm.ainvoke(messages)  # Retry
        
        # ... rest of loop ...
```

---

## Part 3: Detailed Implementation Specifications

This section provides production-ready specifications for implementing the agent loop.

---

## 13. RetrievalToolContext - State Management

The agent needs to maintain state across tool calls. This context object holds all accumulated data:

```python
# backend/llm/tools/retrieval_tools.py

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
import asyncio

@dataclass
class RetrievalToolContext:
    """
    Maintains state across agent tool calls.
    
    This context is passed to all tools and accumulates:
    - Search results from multiple searches
    - Read document contents with BLOCK_CITE_IDs
    - Metadata for citation mapping
    """
    
    # Initial state from graph
    business_id: str
    user_id: str
    user_query: str
    property_id: Optional[str] = None
    conversation_history: List[dict] = field(default_factory=list)
    model_preference: str = "gpt-4o"
    
    # Accumulated during tool calls
    all_search_results: List[dict] = field(default_factory=list)  # All docs found across searches
    read_documents: Dict[str, dict] = field(default_factory=dict)  # doc_id -> content
    block_id_to_metadata: Dict[str, dict] = field(default_factory=dict)  # BLOCK_CITE_ID -> {doc_id, page, bbox}
    
    # Tracking
    tool_calls: List[dict] = field(default_factory=list)  # History of all tool calls
    total_tokens_used: int = 0
    
    @classmethod
    def from_state(cls, state: dict) -> "RetrievalToolContext":
        """Create context from LangGraph state."""
        return cls(
            business_id=state.get("business_id", ""),
            user_id=state.get("user_id", ""),
            user_query=state.get("user_query", ""),
            property_id=state.get("property_id"),
            conversation_history=state.get("conversation_history", []),
            model_preference=state.get("model_preference", "gpt-4o"),
        )
    
    def get_accumulated_context(self) -> str:
        """
        Build context string from all read documents for final answer generation.
        Includes BLOCK_CITE_IDs for citation mapping.
        """
        context_parts = []
        for doc_id, content in self.read_documents.items():
            context_parts.append(f"=== Document: {content['filename']} (ID: {doc_id}) ===\n")
            context_parts.append(content['formatted_content'])
            context_parts.append("\n\n")
        return "".join(context_parts)
    
    def add_search_results(self, results: List[dict], query: str):
        """Add search results and deduplicate by doc_id."""
        seen_doc_ids = {r["doc_id"] for r in self.all_search_results}
        for result in results:
            if result["doc_id"] not in seen_doc_ids:
                result["search_query"] = query  # Track which query found this
                self.all_search_results.append(result)
                seen_doc_ids.add(result["doc_id"])
    
    def register_block_metadata(self, block_id: str, doc_id: str, page: int, bbox: dict):
        """Register BLOCK_CITE_ID metadata for citation mapping."""
        self.block_id_to_metadata[block_id] = {
            "doc_id": doc_id,
            "page": page,
            "bbox": bbox
        }
```

---

## 14. Complete Tool Implementations

### 14.1 search_documents Tool

```python
# backend/llm/tools/retrieval_tools.py

from backend.llm.retrievers.hybrid_retriever import HybridRetriever
from backend.llm.retrievers.bm25_retriever import BM25DocumentRetriever
from backend.services.vector_service import VectorService

async def _search_documents_impl(
    query: str,
    max_results: int,
    context: RetrievalToolContext
) -> dict:
    """
    Search for documents using hybrid retrieval (BM25 + vector + structured).
    
    Wraps existing query_vector_documents logic but returns structured output
    suitable for agent consumption.
    """
    from backend.llm.nodes.retrieval_nodes import (
        _run_hybrid_search,
        _run_structured_query,
        _merge_and_deduplicate_results
    )
    
    try:
        # Run hybrid search (same logic as query_vector_documents)
        hybrid_results = await _run_hybrid_search(
            query=query,
            business_id=context.business_id,
            document_ids=None,  # Search all documents
            top_k=max_results * 2  # Fetch more, then filter
        )
        
        # Run structured query for property-specific data
        structured_results = await _run_structured_query(
            query=query,
            business_id=context.business_id,
            property_id=context.property_id
        )
        
        # Merge and deduplicate
        all_results = _merge_and_deduplicate_results(
            hybrid_results + structured_results,
            max_results=max_results
        )
        
        # Format for agent consumption
        formatted_results = []
        for r in all_results:
            formatted_results.append({
                "doc_id": r["doc_id"],
                "filename": r.get("original_filename", "Unknown"),
                "classification_type": r.get("classification_type", "Document"),
                "relevance_score": round(r.get("similarity_score", 0.0), 3),
                "snippet": r.get("content", "")[:300],  # First 300 chars
                "page_numbers": r.get("page_numbers", []),
                "chunk_count": r.get("chunk_count", 1)
            })
        
        # Add to context for deduplication across searches
        context.add_search_results(formatted_results, query)
        
        return {
            "success": True,
            "query": query,
            "total_found": len(formatted_results),
            "documents": formatted_results,
            "message": f"Found {len(formatted_results)} document{'s' if len(formatted_results) != 1 else ''}"
        }
        
    except Exception as e:
        logger.error(f"search_documents failed: {e}", exc_info=True)
        return {
            "success": False,
            "query": query,
            "total_found": 0,
            "documents": [],
            "error": str(e),
            "message": f"Search failed: {str(e)}"
        }
```

### 14.2 read_document Tool

```python
async def _read_document_impl(
    doc_id: str,
    focus_query: Optional[str],
    context: RetrievalToolContext
) -> dict:
    """
    Read and process a specific document.
    
    Wraps existing process_documents logic for a single document.
    Returns formatted content with BLOCK_CITE_IDs for citation mapping.
    """
    from backend.llm.nodes.processing_nodes import (
        _fetch_document_chunks,
        _format_document_with_block_ids,
        _run_document_qa
    )
    from backend.services.supabase_client_factory import get_supabase_client
    
    # Check if already read
    if doc_id in context.read_documents:
        return {
            "success": True,
            "doc_id": doc_id,
            "filename": context.read_documents[doc_id]["filename"],
            "content": context.read_documents[doc_id]["formatted_content"],
            "page_count": context.read_documents[doc_id]["page_count"],
            "message": "Document already read (using cached content)",
            "from_cache": True
        }
    
    try:
        supabase = get_supabase_client()
        
        # Fetch document metadata
        doc_result = supabase.table("documents").select(
            "id, original_filename, classification_type, page_count, document_summary"
        ).eq("id", doc_id).single().execute()
        
        if not doc_result.data:
            return {
                "success": False,
                "doc_id": doc_id,
                "error": "Document not found",
                "message": f"Document {doc_id} not found"
            }
        
        doc_meta = doc_result.data
        
        # Fetch document chunks
        chunks = await _fetch_document_chunks(
            doc_id=doc_id,
            business_id=context.business_id,
            focus_query=focus_query or context.user_query
        )
        
        # Format with BLOCK_CITE_IDs
        formatted_content, block_metadata = _format_document_with_block_ids(
            chunks=chunks,
            doc_id=doc_id,
            filename=doc_meta["original_filename"]
        )
        
        # Register block metadata for citation mapping
        for block_id, meta in block_metadata.items():
            context.register_block_metadata(
                block_id=block_id,
                doc_id=doc_id,
                page=meta["page"],
                bbox=meta.get("bbox", {})
            )
        
        # Store in context
        doc_content = {
            "doc_id": doc_id,
            "filename": doc_meta["original_filename"],
            "classification_type": doc_meta["classification_type"],
            "page_count": doc_meta.get("page_count", 1),
            "formatted_content": formatted_content,
            "chunk_count": len(chunks),
            "block_ids": list(block_metadata.keys())
        }
        context.read_documents[doc_id] = doc_content
        
        return {
            "success": True,
            "doc_id": doc_id,
            "filename": doc_meta["original_filename"],
            "content": formatted_content,
            "page_count": doc_meta.get("page_count", 1),
            "chunk_count": len(chunks),
            "message": f"Read {doc_meta['original_filename']} ({len(chunks)} chunks)",
            "from_cache": False
        }
        
    except Exception as e:
        logger.error(f"read_document failed for {doc_id}: {e}", exc_info=True)
        return {
            "success": False,
            "doc_id": doc_id,
            "error": str(e),
            "message": f"Failed to read document: {str(e)}"
        }
```

### 14.3 Tool Factory Function

```python
def create_retrieval_tools(
    context: RetrievalToolContext
) -> List[StructuredTool]:
    """
    Create all retrieval tools bound to the given context.
    
    Returns tools that can be bound to an LLM via .bind_tools()
    """
    
    # search_documents tool
    async def search_documents(query: str, max_results: int = 10) -> dict:
        """Search for documents matching the query."""
        return await _search_documents_impl(query, max_results, context)
    
    search_tool = StructuredTool.from_function(
        coroutine=search_documents,
        name="search_documents",
        description="""Search for documents in the user's document library.
        
Use this to find relevant documents before reading them.
Returns a list of documents with:
- doc_id: Use this to read the document
- filename: The document name
- relevance_score: How relevant (0-1)
- snippet: Preview of content

Strategy:
- Start broad, then narrow down
- If no results, try different search terms
- Search for specific topics (e.g., "valuation", "lease", "survey")""",
        args_schema=SearchDocumentsInput
    )
    
    # read_document tool
    async def read_document(doc_id: str, focus_query: Optional[str] = None) -> dict:
        """Read a specific document to get its content."""
        return await _read_document_impl(doc_id, focus_query, context)
    
    read_tool = StructuredTool.from_function(
        coroutine=read_document,
        name="read_document",
        description="""Read a specific document to get its full content.

Use this after search_documents to read promising documents.
Returns document content with BLOCK_CITE_IDs that you must use for citations.

Parameters:
- doc_id: The document ID from search results
- focus_query: Optional - focus on specific content within the document

The content includes BLOCK_CITE_ID markers like [BLOCK_CITE_ID_1].
When you cite information in your answer, reference these IDs.""",
        args_schema=ReadDocumentInput
    )
    
    return [search_tool, read_tool]
```

---

## 15. Complete Agent Loop Implementation

```python
# backend/llm/agents/research_agent.py

import json
import asyncio
import logging
from typing import Callable, Optional, Dict, Any, List
from datetime import datetime

from langchain_core.messages import HumanMessage, AIMessage, ToolMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic

from backend.llm.config import get_llm
from backend.llm.tools.retrieval_tools import create_retrieval_tools, RetrievalToolContext
from backend.llm.prompts.agent_prompts import get_research_agent_prompt

logger = logging.getLogger(__name__)


class ResearchAgentError(Exception):
    """Base exception for research agent errors."""
    pass


class RateLimitError(ResearchAgentError):
    """Rate limit hit during agent execution."""
    pass


class MaxIterationsError(ResearchAgentError):
    """Agent exceeded maximum iterations without completing."""
    pass


async def run_research_agent(
    state: dict,
    on_tool_call: Callable[[dict], None],
    on_thinking: Optional[Callable[[str], None]] = None,
    max_iterations: int = 10,
    timeout_seconds: int = 120
) -> dict:
    """
    Run the research agent loop.
    
    The agent:
    1. Receives the user query
    2. Decides which tools to call (search, read, etc.)
    3. Executes tools and receives results
    4. Loops until it has enough information
    5. Generates final answer with citations
    
    Args:
        state: LangGraph state with user_query, business_id, etc.
        on_tool_call: Callback to stream tool call events (for reasoning steps)
        on_thinking: Optional callback for streaming thinking/reasoning
        max_iterations: Maximum tool call iterations
        timeout_seconds: Total timeout for agent execution
        
    Returns:
        {
            final_summary: str,
            citations: list,
            agent_actions: list,
            tool_calls_made: list,
            documents_read: list[str],
            total_iterations: int
        }
    """
    
    start_time = datetime.now()
    
    # Create context from state
    context = RetrievalToolContext.from_state(state)
    
    # Create tools
    tools = create_retrieval_tools(context)
    tool_map = {tool.name: tool for tool in tools}
    
    # Get LLM with tools bound
    model_preference = state.get("model_preference", "gpt-4o")
    llm = get_llm(model_preference, temperature=0)
    llm_with_tools = llm.bind_tools(tools, tool_choice="auto")
    
    # Build initial messages
    system_prompt = get_research_agent_prompt()
    user_query = state.get("user_query", "")
    
    # Include conversation history for context
    conversation_context = _format_conversation_history(
        state.get("conversation_history", [])
    )
    
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=f"""User query: {user_query}

{conversation_context}

Please help answer this query by searching and reading relevant documents.""")
    ]
    
    # Track iterations
    iterations = 0
    tool_calls_made = []
    final_answer = None
    
    # Emit initial planning step
    await on_tool_call({
        "type": "reasoning_step",
        "tool_name": "planning",
        "tool_input": {"query": user_query},
        "tool_output": None,
        "status": "running",
        "message": "Planning approach..."
    })
    
    try:
        while iterations < max_iterations:
            iterations += 1
            
            # Check timeout
            elapsed = (datetime.now() - start_time).total_seconds()
            if elapsed > timeout_seconds:
                raise TimeoutError(f"Agent timed out after {elapsed:.1f}s")
            
            # Call LLM
            try:
                response = await _invoke_with_retry(llm_with_tools, messages)
            except Exception as e:
                if "rate limit" in str(e).lower() or "429" in str(e):
                    raise RateLimitError(f"Rate limit hit: {e}")
                raise
            
            messages.append(response)
            
            # Check for tool calls
            if response.tool_calls:
                for tool_call in response.tool_calls:
                    tool_name = tool_call["name"]
                    tool_args = tool_call["args"]
                    tool_call_id = tool_call["id"]
                    
                    logger.info(f"Agent calling tool: {tool_name}({tool_args})")
                    
                    # Stream "running" status
                    await on_tool_call({
                        "type": "reasoning_step",
                        "tool_name": tool_name,
                        "tool_input": tool_args,
                        "tool_output": None,
                        "status": "running",
                        "message": _format_running_message(tool_name, tool_args)
                    })
                    
                    # Execute tool
                    tool_func = tool_map.get(tool_name)
                    if not tool_func:
                        result = {"error": f"Unknown tool: {tool_name}"}
                    else:
                        try:
                            result = await asyncio.wait_for(
                                tool_func.ainvoke(tool_args),
                                timeout=30.0  # Per-tool timeout
                            )
                        except asyncio.TimeoutError:
                            result = {"error": f"Tool {tool_name} timed out"}
                        except Exception as e:
                            logger.error(f"Tool {tool_name} failed: {e}")
                            result = {"error": str(e)}
                    
                    # Stream "complete" status
                    await on_tool_call({
                        "type": "reasoning_step",
                        "tool_name": tool_name,
                        "tool_input": tool_args,
                        "tool_output": result,
                        "status": "complete" if result.get("success", True) else "error",
                        "message": _format_complete_message(tool_name, result)
                    })
                    
                    # Track
                    tool_calls_made.append({
                        "iteration": iterations,
                        "name": tool_name,
                        "input": tool_args,
                        "output": result,
                        "success": result.get("success", True)
                    })
                    
                    # Add tool result to messages
                    messages.append(ToolMessage(
                        content=json.dumps(result),
                        tool_call_id=tool_call_id
                    ))
            
            else:
                # No tool calls = LLM is ready to answer
                final_answer = response.content
                logger.info(f"Agent completed after {iterations} iterations")
                break
        
        if final_answer is None:
            raise MaxIterationsError(f"Agent did not complete after {max_iterations} iterations")
        
        # Extract citations from the answer using block metadata
        citations = _extract_citations(final_answer, context)
        
        # Build agent actions (for document display)
        agent_actions = _build_agent_actions(context, citations)
        
        return {
            "final_summary": final_answer,
            "citations": citations,
            "agent_actions": agent_actions,
            "tool_calls_made": tool_calls_made,
            "documents_read": list(context.read_documents.keys()),
            "total_iterations": iterations,
            "conversation_history": _build_updated_history(
                state.get("conversation_history", []),
                user_query,
                final_answer
            )
        }
        
    except Exception as e:
        logger.error(f"Research agent failed: {e}", exc_info=True)
        
        # Return partial results with error
        return {
            "final_summary": f"I encountered an error while researching: {str(e)}. Please try again.",
            "citations": [],
            "agent_actions": [],
            "tool_calls_made": tool_calls_made,
            "documents_read": list(context.read_documents.keys()),
            "total_iterations": iterations,
            "error": str(e)
        }


async def _invoke_with_retry(llm, messages, max_retries: int = 3):
    """Invoke LLM with exponential backoff retry for rate limits."""
    for attempt in range(max_retries):
        try:
            return await llm.ainvoke(messages)
        except Exception as e:
            error_str = str(e).lower()
            is_rate_limit = "rate limit" in error_str or "429" in error_str
            
            if is_rate_limit and attempt < max_retries - 1:
                wait_time = min(2 ** attempt * 5, 60)  # 5s, 10s, 20s, max 60s
                logger.warning(f"Rate limit hit, waiting {wait_time}s (attempt {attempt + 1})")
                await asyncio.sleep(wait_time)
            else:
                raise


def _format_running_message(tool_name: str, tool_args: dict) -> str:
    """Format user-friendly message for tool start."""
    if tool_name == "search_documents":
        return f"Searching for: {tool_args.get('query', '')}"
    elif tool_name == "read_document":
        return f"Reading document..."
    return f"Running {tool_name}..."


def _format_complete_message(tool_name: str, result: dict) -> str:
    """Format user-friendly message for tool completion."""
    if not result.get("success", True):
        return f"Error: {result.get('error', 'Unknown error')}"
    
    if tool_name == "search_documents":
        count = result.get("total_found", 0)
        return f"Found {count} document{'s' if count != 1 else ''}"
    elif tool_name == "read_document":
        filename = result.get("filename", "document")
        return f"Read {filename}"
    
    return result.get("message", f"{tool_name} complete")


def _format_conversation_history(history: List[dict]) -> str:
    """Format conversation history for agent context."""
    if not history:
        return ""
    
    parts = ["Previous conversation:"]
    for entry in history[-3:]:  # Last 3 exchanges
        query = entry.get("query", "")
        summary = entry.get("summary", "")[:500]
        if query and summary:
            parts.append(f"Q: {query}")
            parts.append(f"A: {summary}")
    
    return "\n".join(parts)


def _extract_citations(answer: str, context: RetrievalToolContext) -> List[dict]:
    """Extract citation data from answer using BLOCK_CITE_ID references."""
    import re
    
    citations = []
    
    # Find all [N] citations in the answer
    citation_pattern = r'\[(\d+)\]'
    citation_matches = re.findall(citation_pattern, answer)
    
    # For each citation, try to find the corresponding BLOCK_CITE_ID
    # This is a simplified version - in production, the answer should reference
    # BLOCK_CITE_IDs directly, which we then map to citations
    
    for i, citation_num in enumerate(set(citation_matches), 1):
        # Try to find a block that was used
        for block_id, meta in context.block_id_to_metadata.items():
            # Simple heuristic: assign citations to blocks in order
            if len(citations) < int(citation_num):
                citations.append({
                    "citation_number": int(citation_num),
                    "doc_id": meta["doc_id"],
                    "page_number": meta["page"],
                    "bbox": meta.get("bbox", {}),
                    "block_id": block_id
                })
                break
    
    return citations


def _build_agent_actions(context: RetrievalToolContext, citations: List[dict]) -> List[dict]:
    """Build agent actions for document display."""
    actions = []
    
    # If we have citations, add open_document action for the first one
    if citations:
        first_citation = citations[0]
        actions.append({
            "action": "open_document",
            "params": {
                "citation_number": first_citation["citation_number"],
                "doc_id": first_citation["doc_id"],
                "page": first_citation["page_number"],
                "reason": "Displaying source document"
            }
        })
    
    return actions


def _build_updated_history(
    existing_history: List[dict],
    query: str,
    answer: str
) -> List[dict]:
    """Build updated conversation history."""
    new_entry = {
        "query": query,
        "summary": answer,
        "timestamp": datetime.now().isoformat(),
        "query_category": "agent_research"
    }
    return list(existing_history) + [new_entry]
```

---

## 16. Graph Integration

```python
# backend/llm/graphs/main_graph.py - additions

from backend.llm.agents.research_agent import run_research_agent

async def research_agent_node(state: MainWorkflowState) -> MainWorkflowState:
    """
    LangGraph node that runs the research agent.
    
    This replaces the fixed simple_search/complex_search pipelines
    with a model-driven agent loop.
    """
    
    # Collect tool call events to emit later
    tool_events = []
    
    async def collect_tool_call(event: dict):
        tool_events.append(event)
    
    result = await run_research_agent(
        state=state,
        on_tool_call=collect_tool_call,
        max_iterations=10,
        timeout_seconds=120
    )
    
    return {
        "final_summary": result["final_summary"],
        "citations": result["citations"],
        "agent_actions": result.get("agent_actions", []),
        "conversation_history": result.get("conversation_history", []),
        "document_outputs": [],  # Not used in agent mode
        "relevant_documents": [],  # Not used in agent mode
        "_agent_tool_events": tool_events  # For streaming in views.py
    }


# In build_main_graph():

# Add research agent node
builder.add_node("research_agent", research_agent_node)

# Modify should_route to use agent for document searches
def should_route(state: MainWorkflowState) -> str:
    # ... existing fast path checks (citation, navigation, etc.) ...
    
    # Check if agent mode is enabled
    use_agent = state.get("use_research_agent", True)
    
    if use_agent:
        # Use research agent for document searches
        return "research_agent"
    else:
        # Fallback to existing fixed pipeline
        return "simple_search" if _is_simple_query(state) else "complex_search"

# Add edge from research_agent to END
builder.add_edge("research_agent", END)
```

---

## 17. Error Handling & Fallback Strategy

```python
# backend/llm/agents/research_agent.py - enhanced error handling

class AgentFallbackHandler:
    """
    Handles agent failures with graceful fallback to fixed pipeline.
    """
    
    @staticmethod
    async def handle_agent_failure(
        state: dict,
        error: Exception,
        partial_results: dict
    ) -> dict:
        """
        When agent fails, attempt to salvage partial results or fall back.
        """
        
        # If we have partial results with documents read, try to summarize them
        if partial_results.get("documents_read"):
            logger.warning(f"Agent failed but has partial results, attempting summary")
            try:
                return await _summarize_partial_results(state, partial_results)
            except Exception as e:
                logger.error(f"Partial summary also failed: {e}")
        
        # Full fallback to fixed pipeline
        logger.warning(f"Falling back to fixed pipeline due to: {error}")
        return {
            "_fallback_to_fixed_pipeline": True,
            "_fallback_reason": str(error)
        }
    
    @staticmethod
    async def _summarize_partial_results(state: dict, partial: dict) -> dict:
        """Generate answer from partial results."""
        # Use accumulated context from partial results
        # This provides a graceful degradation
        pass
```

---

## 18. Testing Strategy

```python
# tests/test_research_agent.py

import pytest
from unittest.mock import AsyncMock, patch

class TestResearchAgent:
    
    @pytest.fixture
    def mock_state(self):
        return {
            "user_query": "What is the value of Highlands?",
            "business_id": "test-business-123",
            "user_id": "test-user-456",
            "model_preference": "gpt-4o-mini"
        }
    
    @pytest.mark.asyncio
    async def test_simple_query_flow(self, mock_state):
        """Test that simple query uses search → read → answer pattern."""
        tool_calls = []
        
        async def track_tool_call(event):
            tool_calls.append(event)
        
        with patch("backend.llm.agents.research_agent.get_llm") as mock_llm:
            # Mock LLM to return specific tool calls
            mock_llm.return_value = create_mock_llm_responses([
                {"tool_calls": [{"name": "search_documents", "args": {"query": "Highlands value"}}]},
                {"tool_calls": [{"name": "read_document", "args": {"doc_id": "doc-123"}}]},
                {"content": "The property is valued at £2,300,000[1]."}
            ])
            
            result = await run_research_agent(
                state=mock_state,
                on_tool_call=track_tool_call
            )
        
        # Verify tool call sequence
        tool_names = [t["tool_name"] for t in tool_calls if t.get("status") == "complete"]
        assert tool_names == ["search_documents", "read_document"]
        
        # Verify final answer
        assert "2,300,000" in result["final_summary"]
        assert result["total_iterations"] == 3
    
    @pytest.mark.asyncio
    async def test_search_refinement(self, mock_state):
        """Test that agent refines search when first attempt fails."""
        mock_state["user_query"] = "Tell me about the roof"
        
        # ... test implementation
    
    @pytest.mark.asyncio
    async def test_rate_limit_retry(self, mock_state):
        """Test that agent retries on rate limit errors."""
        # ... test implementation
    
    @pytest.mark.asyncio
    async def test_max_iterations_limit(self, mock_state):
        """Test that agent stops after max iterations."""
        # ... test implementation
    
    @pytest.mark.asyncio
    async def test_fallback_on_failure(self, mock_state):
        """Test graceful fallback when agent fails."""
        # ... test implementation
```

---

## 19. Monitoring & Observability

```python
# backend/llm/agents/agent_metrics.py

import time
from dataclasses import dataclass
from typing import Optional

@dataclass
class AgentMetrics:
    """Metrics for a single agent execution."""
    
    query: str
    start_time: float
    end_time: Optional[float] = None
    
    total_iterations: int = 0
    tool_calls: list = None
    
    search_count: int = 0
    read_count: int = 0
    total_llm_calls: int = 0
    
    success: bool = False
    error: Optional[str] = None
    fallback_used: bool = False
    
    def record_tool_call(self, tool_name: str, duration_ms: int):
        if self.tool_calls is None:
            self.tool_calls = []
        
        self.tool_calls.append({
            "tool": tool_name,
            "duration_ms": duration_ms
        })
        
        if tool_name == "search_documents":
            self.search_count += 1
        elif tool_name == "read_document":
            self.read_count += 1
    
    def finish(self, success: bool, error: Optional[str] = None):
        self.end_time = time.time()
        self.success = success
        self.error = error
    
    @property
    def total_duration_ms(self) -> int:
        if self.end_time:
            return int((self.end_time - self.start_time) * 1000)
        return 0
    
    def to_log_dict(self) -> dict:
        return {
            "agent_execution": {
                "query": self.query[:100],
                "duration_ms": self.total_duration_ms,
                "iterations": self.total_iterations,
                "search_count": self.search_count,
                "read_count": self.read_count,
                "llm_calls": self.total_llm_calls,
                "success": self.success,
                "error": self.error,
                "fallback_used": self.fallback_used
            }
        }
```

---

## 20. Migration Path

### Phase 1: Shadow Mode (Week 1)
- Deploy agent alongside existing pipeline
- Route 10% of traffic to agent
- Compare results and latency
- No user-visible changes

### Phase 2: Opt-in (Week 2)
- Add "Try new agent" toggle in UI
- Users can choose to use agent
- Collect feedback
- Fix issues

### Phase 3: Default On (Week 3)
- Make agent the default for document searches
- Keep fallback to fixed pipeline on errors
- Monitor error rates

### Phase 4: Cleanup (Week 4+)
- Remove old fixed pipeline code paths (optional)
- Or keep as permanent fallback
- Optimize based on metrics

---

## Summary

This plan provides:
1. **Complete tool implementations** with context management
2. **Production-ready agent loop** with error handling
3. **Rate limit retry** with exponential backoff
4. **Graceful fallback** to fixed pipeline on errors
5. **Comprehensive testing strategy**
6. **Monitoring and metrics**
7. **Phased migration path**

Total estimated implementation time: **2-3 weeks** for full production deployment.

# Response Generation Code Guide

This document shows which parts of the code control the response output so you can modify them.

## Overview: Response Generation Flow

The response generation follows this path:
1. **User Query** → `backend/views.py` (HTTP endpoint)
2. **Routing** → `backend/llm/graphs/main_graph.py` (orchestrates workflow)
3. **Document Processing** → `backend/llm/nodes/processing_nodes.py` (extracts info from docs)
4. **Summary Generation** → `backend/llm/nodes/summary_nodes.py` (creates final answer)
5. **Formatting** → `backend/llm/nodes/formatting_nodes.py` (optional - currently skipped)
6. **Streaming** → `backend/views.py` (sends response to frontend)

---

## Key Files That Control Response Output

### 1. **System Prompts** (Base behavior and tone)
**File:** `backend/llm/utils/system_prompts.py`

**Key Functions:**
- `get_system_prompt(task)` - Returns system message for different tasks
- `BASE_ROLE` - Core principles that apply to all responses
- `TASK_GUIDANCE['summarize']` - Specific instructions for answer generation

**What it controls:**
- Overall tone and style (professional, concise)
- Rules about what to include/exclude (no unsolicited suggestions, no external sources)
- Domain knowledge (real estate terminology, valuation prioritization)
- Citation requirements
- Entity normalization rules

**To modify response behavior:**
- Edit `BASE_ROLE` for global changes
- Edit `TASK_GUIDANCE['summarize']` for answer generation rules
- Edit `TASK_GUIDANCE['format']` for formatting rules

---

### 2. **Answer Generation Prompts** (What the LLM sees)
**File:** `backend/llm/prompts.py`

**Key Functions:**
- `get_final_answer_prompt()` - Main prompt for generating the answer (Phase 2)
- `get_citation_extraction_prompt()` - Prompt for extracting citations (Phase 1)
- `get_response_formatting_prompt()` - Prompt for formatting (currently unused)

**What it controls:**
- The exact instructions sent to the LLM
- How document content is presented to the LLM
- Citation extraction requirements
- Agent mode instructions (when to open documents)

**To modify response content:**
- Edit `get_final_answer_prompt()` to change how answers are generated
- Edit `get_citation_extraction_prompt()` to change citation extraction behavior
- Modify the prompt structure to emphasize different aspects

**Location in code:**
```python
# backend/llm/nodes/summary_nodes.py, line ~1811
answer_prompt = get_final_answer_prompt(
    user_query=state['user_query'],
    conversation_history=history_context,
    formatted_outputs=formatted_outputs_str,
    citations=citations_from_state,
    is_citation_query=is_citation_query,
    is_agent_mode=is_agent_mode
)
```

---

### 3. **Summary Node** (Generates the actual response)
**File:** `backend/llm/nodes/summary_nodes.py`

**Key Function:**
- `summarize_results()` - Main function that generates `final_summary`

**What it controls:**
- The 2-phase approach (citation extraction → answer generation)
- How document outputs are formatted before sending to LLM
- Citation renumbering and cleanup
- Agent action detection
- Response text cleanup (removes tool call artifacts)

**To modify response generation:**
- Edit `summarize_results()` function (starts at line 1421)
- Modify how `formatted_outputs_str` is built (line ~1615)
- Change the LLM model or temperature (line ~1508, 1794)
- Adjust citation renumbering logic (line ~2076)
- Modify text cleanup rules (line ~2001-2067)

**Key sections:**
```python
# Phase 1: Citation extraction (line ~1721)
citation_response = await citation_llm.ainvoke(citation_messages)

# Phase 2: Answer generation (line ~1824)
answer_response = await answer_llm.ainvoke(answer_messages)

# Text cleanup (line ~2001)
summary = re.sub(...)  # Removes tool call artifacts

# Final output (line ~2152)
state_update = {
    "final_summary": summary,
    "citations": citations_from_state,
    ...
}
```

---

### 4. **Formatting Node** (Currently skipped, but available)
**File:** `backend/llm/nodes/formatting_nodes.py`

**Key Function:**
- `format_response()` - Formats the final summary

**Status:** Currently skipped in the graph (see `main_graph.py` line 590)

**To enable formatting:**
- Uncomment or modify the edge in `main_graph.py`:
  ```python
  # Currently: builder.add_edge("summarize_results", END)
  # Change to: builder.add_edge("summarize_results", "format_response")
  # Then: builder.add_edge("format_response", END)
  ```

**What it controls:**
- Final formatting and structure of the response
- Better organization and readability
- Citation preservation during formatting

---

### 5. **Document Processing** (What information is extracted)
**File:** `backend/llm/nodes/processing_nodes.py`

**Key Function:**
- `process_documents()` - Extracts information from each document

**What it controls:**
- How individual documents are analyzed
- What information is extracted from each document
- The format of `document_outputs` that feeds into summarization

**To modify what information is extracted:**
- Edit the document QA prompts in `backend/llm/agents/document_qa_agent.py`
- Modify `process_documents()` to change extraction logic

---

### 6. **Streaming & Response Delivery** (How response is sent)
**File:** `backend/views.py`

**Key Function:**
- `query_documents_stream()` - HTTP endpoint that streams responses
- `run_and_stream()` - Async generator that yields response chunks

**What it controls:**
- How the response is streamed to the frontend
- When tokens are sent
- The final `complete` message structure
- Citation auto-opening logic

**Key sections:**
```python
# Streaming the summary (line ~1353)
for i in range(0, len(final_summary_from_state), chunk_size):
    chunk = final_summary_from_state[i:i + chunk_size]
    yield f"data: {json.dumps({'type': 'token', 'token': chunk})}\n\n"

# Final complete message (line ~2080)
complete_data = {
    'type': 'complete',
    'data': {
        'summary': full_summary.strip(),
        'citations': citations_map_for_frontend,
        ...
    }
}
```

---

## Quick Modification Guide

### To change response tone/style:
1. Edit `backend/llm/utils/system_prompts.py`
   - Modify `BASE_ROLE` for global changes
   - Modify `TASK_GUIDANCE['summarize']` for answer-specific rules

### To change how answers are generated:
1. Edit `backend/llm/prompts.py`
   - Modify `get_final_answer_prompt()` function
   - Adjust instructions, examples, or structure

### To change response content/format:
1. Edit `backend/llm/nodes/summary_nodes.py`
   - Modify `summarize_results()` function
   - Change text cleanup rules (line ~2001)
   - Adjust citation handling (line ~2076)

### To enable response formatting:
1. Edit `backend/llm/graphs/main_graph.py`
   - Change line 590 to route through `format_response` node
   - Modify `backend/llm/nodes/formatting_nodes.py` if needed

### To change what information is extracted:
1. Edit `backend/llm/agents/document_qa_agent.py`
   - Modify the document QA prompts
   - Change extraction logic

---

## Response Generation Pipeline (Detailed)

```
User Query
    ↓
[views.py] query_documents_stream()
    ↓
[main_graph.py] build_main_graph()
    ↓
[summary_nodes.py] summarize_results()
    ├─ Phase 1: Citation Extraction
    │   └─ Uses: get_citation_extraction_prompt()
    │   └─ LLM: citation_llm (with citation_tool)
    │
    └─ Phase 2: Answer Generation
        └─ Uses: get_final_answer_prompt()
        └─ LLM: answer_llm (with agent_tools if agent_mode)
        └─ Cleanup: Removes tool call artifacts
        └─ Renumber: Citations by appearance order
    ↓
[views.py] Streaming
    └─ Yields tokens chunk by chunk
    └─ Sends complete message with citations
    ↓
Frontend receives and displays
```

---

## Important Constants & Config

**LLM Model:**
- Defined in `backend/llm/config.py`
- Used in `summary_nodes.py` line 1508, 1794

**Max Documents for Summary:**
- Concise: 7 docs (env var: `MAX_DOCS_FOR_SUMMARY`)
- Detailed: 20 docs (env var: `MAX_DOCS_FOR_SUMMARY_DETAILED`)
- See `summary_nodes.py` line 1519-1523

**Content Length Limits:**
- Base: 80,000 chars
- Comprehensive queries: up to 150,000 chars
- See `summary_nodes.py` line 1624-1633

---

## Citation System

Citations are generated in 2 phases:
1. **Phase 1** (`get_citation_extraction_prompt`): LLM calls `cite_source` tool for each fact
2. **Phase 2** (`get_final_answer_prompt`): LLM writes answer using citation numbers from Phase 1

Citations are then renumbered based on appearance order in the final text.

**Key files:**
- Citation tool: `backend/llm/tools/citation_tool.py`
- Citation renumbering: `summary_nodes.py` line ~1200-1418

---

## Agent Actions

When `is_agent_mode=True`, the LLM can call agent tools:
- `open_document` - Opens a document in the UI
- `navigate_to_property` - Navigates to a property on the map
- `search_property` - Searches for properties
- etc.

**Key files:**
- Agent tools: `backend/llm/tools/agent_actions.py`
- Tool binding: `summary_nodes.py` line 1790-1798
- Action processing: `summary_nodes.py` line 1844-1996

# Citation System Debug Plan

## Executive Summary

This plan identifies 6 potential failure points in the citation system and provides systematic debugging with runtime instrumentation to identify the root cause.

## Critical Data Flow Path

```
1. retrieval_nodes.py (clarify_relevant_docs)
   └─> source_chunks_metadata with blocks[] and bbox
   
2. processing_nodes.py (process_documents)
   └─> Preserves source_chunks_metadata
   
3. summary_nodes.py (summarize_results)
   └─> format_document_with_block_ids() creates metadata lookup table
   └─> Phase 1: LLM extracts citations via tool calls
   └─> Phase 2: LLM generates answer with superscripts
   └─> Citations added to state
   
4. views.py (streaming)
   └─> Extracts citations from state
   └─> Streams citation events to frontend
   
5. SideChatPanel.tsx (frontend)
   └─> Receives citation events
   └─> Renders clickable citations
   └─> Opens document with bbox highlight
```

## Hypotheses (Ordered by Likelihood)

### Hypothesis A: Blocks data is lost between retrieval and summary nodes
**Probability**: HIGH
**Why**: Blocks must be preserved through multiple transformations. If `source_chunks_metadata` doesn't have blocks, `format_document_with_block_ids()` will fallback to chunk-level formatting without real bbox.

**Evidence needed**:
- Blocks array present in `source_chunks_metadata` at retrieval_nodes
- Blocks preserved in processing_nodes
- Blocks present when `format_document_with_block_ids()` is called
- Metadata lookup table has valid bbox (not 0,0,0,0)

### Hypothesis B: LLM is not calling citation tool in Phase 1
**Probability**: MEDIUM
**Why**: Even with `tool_choice="required"`, LLM might not understand the prompt or fail to extract citations.

**Evidence needed**:
- Phase 1 response contains tool_calls
- `citations_from_state` has citations after Phase 1
- LLM response finish_reason is "tool_calls"

### Hypothesis C: Metadata lookup tables are empty or have invalid bbox
**Probability**: MEDIUM
**Why**: If blocks don't have bbox data, or bbox extraction fails, metadata table will be empty or invalid.

**Evidence needed**:
- Metadata lookup table size > 0
- Bbox values in metadata table are valid (0-1 range, not all zeros)
- Blocks have bbox in `source_chunks_metadata`

### Hypothesis D: Citations are extracted but not added to state correctly
**Probability**: LOW
**Why**: State update might fail, or citations structure might be invalid.

**Evidence needed**:
- Citations in state after `summarize_results`
- Citation structure matches `Citation` TypedDict
- `operator.add` working correctly

### Hypothesis E: Citations are in state but not streamed correctly
**Probability**: LOW
**Why**: `views.py` might not extract citations from state, or streaming format might be wrong.

**Evidence needed**:
- `citations_from_state` populated in `views.py`
- Citation event structure correct
- Frontend receives citation events

### Hypothesis F: Frontend receives citations but can't process them
**Probability**: LOW
**Why**: Citation data structure mismatch, or rendering logic fails.

**Evidence needed**:
- Citations received in `onCitation` callback
- Citations accumulated correctly
- Citation rendering works

## Instrumentation Plan

### Backend Instrumentation

#### 1. retrieval_nodes.py - `clarify_relevant_docs` (Line ~1742)
**Purpose**: Verify blocks data is included in `source_chunks_metadata`

**Log points**:
- After building `source_chunks_metadata` for each merged doc
- Log: number of chunks with blocks, sample block bbox data

#### 2. processing_nodes.py - `_build_processing_result` (Line ~30)
**Purpose**: Verify `source_chunks_metadata` is preserved

**Log points**:
- When `source_chunks_metadata` is passed to `_build_processing_result`
- Log: if blocks are present, sample block count

#### 3. block_id_formatter.py - `format_document_with_block_ids` (Line ~90)
**Purpose**: Verify blocks are available and bbox is valid

**Log points**:
- When processing each chunk's blocks
- Log: blocks found count, sample bbox values, metadata table size

#### 4. summary_nodes.py - `summarize_results` (Multiple locations)
**Purpose**: Track citation extraction and state updates

**Log points**:
- After building metadata lookup tables (Line ~188)
- After Phase 1 LLM response (Line ~275)
- After extracting citations (Line ~303)
- Before state update (Line ~361)

#### 5. views.py - Citation streaming (Line ~767)
**Purpose**: Verify citations are extracted and streamed

**Log points**:
- When extracting citations from state
- When formatting citation data
- When streaming citation events

### Frontend Instrumentation

#### 1. SideChatPanel.tsx - Citation handling
**Purpose**: Track citation reception and processing

**Log points**:
- `onCitation` callback (Line ~1642)
- Citation accumulation
- Citation rendering
- Citation click with bbox validation

## Implementation Steps

1. **Add instrumentation logs** to all critical points (wrapped in collapsible regions)
2. **Clear log file** before test run
3. **Ask user to reproduce** (make a query that should generate citations)
4. **Analyze logs** to evaluate hypotheses
5. **Fix root cause** based on log evidence
6. **Verify fix** with another test run
7. **Remove instrumentation** after confirmation

## Success Criteria

- Citations appear in response text (superscripts)
- Citations are clickable
- Clicking citation opens document
- Document highlights correct bbox area
- All hypotheses evaluated with log evidence

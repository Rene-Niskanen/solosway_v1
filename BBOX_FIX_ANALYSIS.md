# BBOX Fix Analysis and Plan

## Problem Statement

When `clarify_relevant_docs` is skipped (for ≤2 documents), `source_chunks_metadata` is never created, causing BBOX highlighting to fail. However, attempts to fix this have broken response quality.

## Root Cause Analysis

### What `clarify_relevant_docs` Does (Two Coupled Functions)

1. **Document Merging/Ranking** (Affects LLM Response Quality):
   - Groups chunks by `doc_id` (line 1722-1726)
   - Sorts chunks by similarity and selects top 7 (line 1834)
   - Merges top chunks into single `merged_content` string (line 1835)
   - Creates merged document structure with `content`, `chunk_count`, `page_range`, etc. (line 1925-1942)
   - **This affects what the LLM sees** - merged content vs individual chunks

2. **Citation Metadata Creation** (Needed for BBOX):
   - Fetches `blocks` from database for chunks missing them (line 1728-1831)
   - Creates `source_chunks_metadata` array with blocks/bbox data (line 1852-1864)
   - Attaches `source_chunks_metadata` to merged document (line 1941)
   - **This is what we need for citations**

### Why Skipping Breaks Citations

When `should_skip_clarify` returns `"process_documents"` (for ≤2 documents):
- Individual chunks go directly to `process_documents`
- Each chunk is processed separately by the LLM
- No merging happens
- No `source_chunks_metadata` is created
- **Result**: Citations work (LLM calls tool) but BBOX is always fallback `{0,0,1,1,page:0}`

### Why My Fixes Broke Response Quality

**Fix Attempt 1: Modified `process_documents` to merge chunks**
- **Problem**: Changed the document structure passed to LLM
- **Impact**: LLM received merged content when it expected individual chunks
- **Result**: Response quality degraded (LLM couldn't find information in merged format)

**Fix Attempt 2: Modified `should_skip_clarify` to always run `clarify_relevant_docs`**
- **Problem**: Forced merging/ranking logic to run even when it shouldn't
- **Impact**: Changed which chunks the LLM sees (top 7 by similarity vs all chunks)
- **Result**: Response quality degraded (important chunks might be filtered out)

## The Core Issue: Tight Coupling

`clarify_relevant_docs` couples two concerns:
1. **Document processing optimization** (merging/ranking) - affects LLM input
2. **Citation metadata creation** (blocks/source_chunks_metadata) - needed for BBOX

We need `source_chunks_metadata` but can't change the document structure that affects LLM response quality.

## Solution Plan: Decouple Metadata Creation

### Strategy: Create `source_chunks_metadata` Without Changing Document Structure

**Key Insight**: We can create `source_chunks_metadata` as a **side effect** that doesn't affect the document content passed to the LLM.

### Implementation Plan

#### Phase 1: Create Lightweight Metadata Function

Create a new function `create_source_chunks_metadata()` that:
1. Takes individual chunks as input
2. Fetches missing `blocks` from database (same logic as `clarify_relevant_docs`)
3. Creates `source_chunks_metadata` array
4. **Does NOT merge or modify chunks** - just adds metadata

#### Phase 2: Call Metadata Function When Clarify is Skipped

In `process_documents`, when documents are individual chunks:
1. **Before processing**: Call `create_source_chunks_metadata()` to create metadata
2. **Attach metadata** to each chunk document (as a non-content field)
3. **Process documents normally** - LLM still sees individual chunks
4. **Preserve metadata** through processing pipeline

#### Phase 3: Ensure Metadata Flows Through Pipeline

1. In `_build_processing_result`: Preserve `source_chunks_metadata` if it exists
2. In `summarize_results`: Use `source_chunks_metadata` from `document_outputs` for citation mapping
3. Verify metadata reaches `format_document_with_block_ids` correctly

### Detailed Implementation Steps

#### Step 1: Extract Metadata Creation Logic

**File**: `backend/llm/nodes/retrieval_nodes.py`

Create new function:
```python
async def create_source_chunks_metadata_for_chunks(chunks: List[Dict], doc_id: str) -> List[Dict]:
    """
    Lightweight function to create source_chunks_metadata without merging chunks.
    Only fetches blocks and creates metadata structure.
    Does NOT modify chunk content or structure.
    """
    # 1. Fetch missing blocks from database (same logic as clarify_relevant_docs)
    # 2. Create source_chunks_metadata array with blocks/bbox
    # 3. Return metadata (doesn't modify input chunks)
```

#### Step 2: Call in `process_documents` When Needed

**File**: `backend/llm/nodes/processing_nodes.py`

In `process_documents`, before processing:
```python
# If documents are individual chunks without source_chunks_metadata
if relevant_docs and 'chunk_index' in relevant_docs[0] and not relevant_docs[0].get('source_chunks_metadata'):
    # Group chunks by doc_id
    # For each doc_id group:
    #   - Call create_source_chunks_metadata_for_chunks()
    #   - Attach metadata to each chunk (as non-content field)
    #   - Continue processing normally (don't merge chunks)
```

#### Step 3: Preserve Metadata Through Processing

**File**: `backend/llm/nodes/processing_nodes.py`

In `process_one`:
```python
# Extract source_chunks_metadata from doc (may have been created in step 2)
source_chunks_metadata = doc.get('source_chunks_metadata')

# Pass to _build_processing_result
result = _build_processing_result(output_state, source_chunks_metadata=source_chunks_metadata)
```

#### Step 4: Verify Metadata Reaches Citation System

**File**: `backend/llm/nodes/summary_nodes.py`

Ensure `format_document_with_block_ids` receives `source_chunks_metadata`:
- Already handled (line 160-181)
- Just need to verify it's populated

### Benefits of This Approach

1. **No Response Quality Impact**: LLM still sees individual chunks (unchanged input)
2. **Citations Work**: `source_chunks_metadata` is created with blocks
3. **BBOX Works**: Blocks data flows through to citation mapping
4. **Performance**: Only fetches blocks, doesn't do expensive merging/ranking
5. **Minimal Changes**: Reuses existing logic from `clarify_relevant_docs`

### Testing Plan

1. **Response Quality**: Verify LLM responses are identical to before
2. **Citations**: Verify citations are generated (already working)
3. **BBOX**: Verify clicking citations shows correct page with highlighting
4. **Performance**: Verify no significant latency increase

### Risk Mitigation

- **Risk**: Metadata creation adds latency
  - **Mitigation**: Only runs when needed (chunks without metadata), uses batch database queries

- **Risk**: Metadata not preserved through pipeline
  - **Mitigation**: Add instrumentation to verify metadata at each step

- **Risk**: Breaking existing flow
  - **Mitigation**: Only add metadata, don't modify existing document structure

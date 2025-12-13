# Retrieval Process Analysis

## Problem Identified

The LLM is not receiving valuation data because of **multiple filtering/limiting steps** in the retrieval pipeline:

### Issue 1: Initial Chunk Limit (20 chunks)
- **Location**: `retrieval_nodes.py` lines 1025, 1434
- **Problem**: Only 20 chunks are retrieved per document, ordered by `chunk_index`
- **Impact**: If valuation is on page 30, it's likely not in the first 20 chunks (which are typically pages 1-10)

### Issue 2: Aggressive Filtering in clarify_relevant_docs (Top 7 chunks)
- **Location**: `retrieval_nodes.py` line 1702
- **Problem**: `clarify_relevant_docs` only keeps the **top 7 most relevant chunks** (by similarity score)
- **Impact**: Even if 20 chunks were retrieved, only 7 make it through, and if the valuation page has lower similarity, it gets filtered out

### Issue 3: Content Truncation in Summary
- **Location**: `summary_nodes.py` line 247-251
- **Problem**: `MAX_CONTENT_LENGTH = 80000` chars (~20k tokens) truncates content
- **Impact**: If content exceeds this, it gets cut off

## Data Flow

1. **Initial Retrieval** (`query_vector_documents`, `query_structured`, `query_llm_sql`)
   - Retrieves chunks from database
   - **LIMIT: 20 chunks per document** (ordered by chunk_index)
   - Creates `content` field with combined chunks

2. **Clarify Relevant Docs** (`clarify_relevant_docs`)
   - Groups chunks by doc_id
   - **FILTERS: Top 7 chunks by similarity** (line 1702)
   - Creates `source_chunks_metadata` with only those 7 chunks
   - Merges content from those 7 chunks

3. **Process Documents** (`process_documents`)
   - Takes `doc.get("content")` (which is the merged content from 7 chunks)
   - Passes to document QA subgraph
   - LLM processes this limited content

4. **Summary Nodes** (`summarize_results`)
   - Formats document outputs with block IDs
   - **TRUNCATES: 80000 chars max** (line 247-251)
   - Passes to Phase 2 LLM

## Root Cause

**The valuation page (page 30) is never retrieved because:**
1. Only first 20 chunks are fetched (likely pages 1-10)
2. Even if page 30 was in those 20, it might have lower similarity and get filtered to top 7
3. The LLM never sees the valuation page content

## Solution

1. **For valuation queries, increase chunk limit or remove it**
2. **For valuation queries, don't filter to top 7 - keep more chunks**
3. **Or: Fetch chunks by page number when searching for valuations**
4. **Or: Use semantic search to find valuation-specific chunks**

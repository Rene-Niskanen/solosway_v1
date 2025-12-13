# Citation & BBOX Code Comparison: Current vs feature/citation-mapping

## Summary

This document compares the current citation and BBOX implementation with the `feature/citation-mapping` branch to identify differences and missing pieces.

## Key Differences Found

### 1. **Citation Type Definition** (`backend/llm/types.py`)

**Current:**
- `Citation` TypedDict is defined **before** `MainWorkflowState` (correct order)
- `citations` field in `MainWorkflowState` is `Optional[list[Citation]]`
- Added `blocks` field to `RetrievedDocument`

**Citation-mapping branch:**
- `Citation` TypedDict is defined **after** `DocumentProcessingResult` (before `MainWorkflowState`)
- `citations` field in `MainWorkflowState` is `Annotated[list[Citation], operator.add]` (accumulates)
- `blocks` field already in `RetrievedDocument`

**Issue:** Current implementation uses `Optional[list[Citation]]` instead of `Annotated[list[Citation], operator.add]`, which means citations won't accumulate across graph steps.

### 2. **Blocks Storage** (`backend/services/vector_service.py`)

**Current:**
- Simple block formatting:
  ```python
  blocks_for_storage = []
  for block in chunk_blocks:
      if isinstance(block, dict):
          block_data = {
              'content': block.get('content', ''),
              'type': block.get('type', 'text'),
              'bbox': block.get('bbox'),
              'confidence': block.get('confidence', 'medium')
          }
          blocks_for_storage.append(block_data)
  ```
- No validation of block content
- No logging of validation results

**Citation-mapping branch:**
- Comprehensive block validation:
  - Validates block has content (required for citation matching)
  - Validates block has bbox (warns if missing)
  - Cleans block bbox (removes None values, normalizes)
  - Tracks validation statistics (`blocks_validated`, `blocks_invalid`)
  - Logs warnings for missing content/bbox
  - More robust error handling

**Issue:** Current implementation doesn't validate blocks, which could lead to citations failing if blocks are missing content or bbox.

### 3. **Summary Nodes** (`backend/llm/nodes/summary_nodes.py`)

**Current:**
- Has `detail_level` optimization (limits docs based on concise/detailed mode)
- Uses `citations_from_tools` variable name
- Returns `citations: citations_from_tools` (list, not accumulated)
- Preserves `document_outputs` and `relevant_documents` in return

**Citation-mapping branch:**
- No `detail_level` optimization
- Uses `citations_from_state` variable name
- Returns citations as part of state (accumulated via `operator.add`)
- Simpler return structure

**Issue:** Current implementation doesn't use `operator.add` for citations, so they won't accumulate if there are multiple summarization steps.

### 4. **Prompt Functions** (`backend/llm/prompts.py`)

**Current:**
- `get_citation_extraction_prompt` - ✅ Present
- `get_final_answer_prompt` - ✅ Present
- Both functions are at the end of the file

**Citation-mapping branch:**
- Same functions present
- Located in the same position

**Status:** ✅ Match

### 5. **Citation Tool** (`backend/llm/tools/citation_mapping.py`)

**Current:**
- ✅ Present and matches citation-mapping branch

**Citation-mapping branch:**
- Same implementation

**Status:** ✅ Match

### 6. **Block ID Formatter** (`backend/llm/utils/block_id_formatter.py`)

**Current:**
- ✅ Present and matches citation-mapping branch

**Citation-mapping branch:**
- Same implementation

**Status:** ✅ Match

## Critical Issues to Fix

### 1. **Citation Accumulation**
**Problem:** Citations won't accumulate across graph steps because we're using `Optional[list[Citation]]` instead of `Annotated[list[Citation], operator.add]`.

**Fix:**
```python
# In backend/llm/types.py
citations: Annotated[list[Citation], operator.add]  # Accumulate citations
```

### 2. **Block Validation**
**Problem:** Blocks aren't validated before storage, which could cause citation failures.

**Fix:** Add validation similar to citation-mapping branch:
- Validate block has content
- Validate block has bbox (warn if missing)
- Track validation statistics
- Log warnings for invalid blocks

### 3. **Return Structure in summary_nodes.py**
**Problem:** Citations are returned as a simple list instead of being accumulated.

**Fix:** Ensure citations are properly added to state (LangGraph will handle accumulation if using `operator.add`).

## Recommendations

1. **Fix Citation Accumulation:** Change `citations` field to use `Annotated[list[Citation], operator.add]`
2. **Add Block Validation:** Implement comprehensive block validation like citation-mapping branch
3. **Test Citation Flow:** Verify citations are properly accumulated and passed to frontend
4. **Add Logging:** Add validation statistics logging for blocks (similar to citation-mapping branch)

## Files That Match

- ✅ `backend/llm/citation_mapping.py`
- ✅ `backend/llm/tools/citation_mapping.py`
- ✅ `backend/llm/utils/block_id_formatter.py`
- ✅ `backend/llm/prompts.py` (citation prompt functions)

## Files With Differences

- ⚠️ `backend/llm/types.py` (citation accumulation)
- ⚠️ `backend/services/vector_service.py` (block validation)
- ⚠️ `backend/llm/nodes/summary_nodes.py` (return structure, but has improvements)

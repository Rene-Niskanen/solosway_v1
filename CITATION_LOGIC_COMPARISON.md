# Citation Logic Comparison: Current vs citation-mapping Branch

This document compares the current citation logic implementation with the `feature/citation-mapping` branch to ensure they match.

## Summary

✅ **All core citation logic matches the citation-mapping branch**

## Detailed Comparison

### 1. Citation Mapping Service (`backend/llm/citation_mapping.py`)

**Status**: ✅ **IDENTICAL**

Both implementations are identical:
- `map_block_id_to_bbox()` function
- `process_citations_from_tools()` function
- Same logging and error handling

### 2. Citation Tool (`backend/llm/tools/citation_mapping.py`)

**Status**: ✅ **IDENTICAL**

Both implementations are identical:
- `CitationInput` schema
- `CitationTool` class with `add_citation()` method
- `create_citation_tool()` function
- Same bbox extraction logic
- Same metadata lookup logic

### 3. Summary Nodes (`backend/llm/nodes/summary_nodes.py`)

**Status**: ✅ **MATCHES** (with minor differences in logging)

**Key Components**:
- ✅ Two-phase citation process (Phase 1: extraction, Phase 2: answer generation)
- ✅ `format_document_with_block_ids()` call
- ✅ `create_citation_tool()` with metadata lookup tables
- ✅ `tool_choice="required"` for Phase 1
- ✅ Citation extraction via tool calls
- ✅ Final answer generation with citations
- ✅ Citations stored in state: `citations_from_state = citation_tool_instance.citations`
- ✅ Return structure includes `citations: citations_from_state`

**Minor Differences**:
- Current version has additional logging for debugging
- Current version has `import os` (unused, but harmless)

### 4. Prompts (`backend/llm/prompts.py`)

**Status**: ✅ **IDENTICAL**

Both implementations have:
- `get_citation_extraction_prompt()` - identical
- `get_final_answer_prompt()` - identical
- Same metadata lookup table formatting
- Same instructions for LLM

### 5. Types (`backend/llm/types.py`)

**Status**: ✅ **MATCHES**

**Citation TypedDict**:
```python
class Citation(TypedDict):
    citation_number: int
    block_id: str
    cited_text: str
    bbox: Optional[dict]  # {'left': float, 'top': float, 'width': float, 'height': float, 'page': int}
    page_number: int
    doc_id: str
    confidence: Optional[str]
    method: str
```

**MainWorkflowState**:
```python
citations: Annotated[list[Citation], operator.add]  # Accumulate citations
```

Both match the citation-mapping branch structure.

### 6. Block ID Formatter (`backend/llm/utils/block_id_formatter.py`)

**Status**: ✅ **MATCHES**

Both implementations:
- Format documents with `<BLOCK id="BLOCK_CITE_ID_X">` tags
- Build metadata lookup tables with bbox coordinates
- Extract block-level metadata from chunks

### 7. Views (`backend/views.py`)

**Status**: ✅ **MATCHES** (with enhanced logging)

**Citation Streaming**:
- ✅ Extracts citations from state: `citations_from_state = state_data.get('citations', [])`
- ✅ Formats citations for frontend
- ✅ Streams `citation` events
- ✅ Includes bbox data in citation payload

**Current version has additional logging** for debugging citation data flow.

### 8. Frontend (`frontend-ts/src/components/SideChatPanel.tsx`)

**Status**: ✅ **MATCHES** (with enhancements)

**Key Components**:
- ✅ Citation accumulation from SSE events
- ✅ Citation key normalization (string conversion)
- ✅ Recursive citation processing in ReactMarkdown
- ✅ `handleCitationClick` with bbox validation
- ✅ `CitationHighlight` type import
- ✅ File ID matching verification

**Enhancements in current version**:
- Enhanced logging for debugging
- Bbox normalization and validation
- Better error handling

### 9. Preview Context (`frontend-ts/src/contexts/PreviewContext.tsx`)

**Status**: ✅ **IDENTICAL**

Both implementations:
- `CitationHighlight` interface
- `addPreviewFile(file, highlight?)` signature
- Highlight state management
- File ID matching logic

### 10. Document Preview Modal (`frontend-ts/src/components/DocumentPreviewModal.tsx`)

**Status**: ✅ **MATCHES**

Both implementations:
- Bbox highlighting logic
- Page navigation for highlights
- Expanded bbox calculation
- Canvas-based PDF rendering

## Data Flow Verification

### Backend Flow:
1. ✅ Documents formatted with block IDs → `format_document_with_block_ids()`
2. ✅ Metadata lookup tables built → `metadata_lookup_tables[doc_id][block_id]`
3. ✅ Citation tool created → `create_citation_tool(metadata_lookup_tables)`
4. ✅ Phase 1: LLM calls `cite_source()` tool → `citation_tool_instance.add_citation()`
5. ✅ Bbox extracted from metadata → `map_block_id_to_bbox()`
6. ✅ Citations stored → `citation_tool_instance.citations`
7. ✅ Citations added to state → `citations: citations_from_state`
8. ✅ Phase 2: Final answer generated with superscripts
9. ✅ Citations streamed to frontend → `views.py` streams `citation` events

### Frontend Flow:
1. ✅ Citations received via SSE → `onCitation` callback
2. ✅ Citations accumulated → `accumulatedCitations[citationNumStr]`
3. ✅ Citations normalized → `normalizeCitations()`
4. ✅ Citations rendered → `renderTextWithCitations()`
5. ✅ Citation clicked → `handleCitationClick()`
6. ✅ Bbox validated → `validateBbox()`
7. ✅ Document opened → `addPreviewFile(fileData, highlightData)`
8. ✅ Highlight applied → `DocumentPreviewModal` renders bbox

## Potential Issues to Check

### 1. Citation Extraction
- **Check**: Are citations being extracted in Phase 1?
- **Log**: Look for `[SUMMARIZE_RESULTS] Phase 1: Extracted X citations`
- **Fix**: Ensure `tool_choice="required"` is set

### 2. Bbox Data
- **Check**: Are bboxes included in citations?
- **Log**: Look for `[CITATION_TOOL] ✅ Citation X added` with bbox coordinates
- **Fix**: Ensure metadata lookup tables have bbox data

### 3. Citation Streaming
- **Check**: Are citations being streamed to frontend?
- **Log**: Look for `[CITATION_STREAM] Citation X data` in backend logs
- **Fix**: Ensure `views.py` extracts citations from state

### 4. Frontend Rendering
- **Check**: Are citations clickable?
- **Log**: Look for `🔗 [CITATION] Matched superscript` in browser console
- **Fix**: Ensure recursive citation processing is working

### 5. Bbox Highlighting
- **Check**: Does clicking citation highlight document?
- **Log**: Look for `📚 [CITATION] Highlight payload prepared` in browser console
- **Fix**: Ensure `fileData.id === highlightData.fileId`

## Conclusion

✅ **All citation logic matches the citation-mapping branch**

The current implementation:
- Has the same core logic as citation-mapping branch
- Includes additional logging for debugging
- Has enhanced error handling and validation
- Maintains backward compatibility

The citation system should work correctly. If issues persist, they are likely due to:
1. Missing bbox data in metadata lookup tables
2. LLM not calling citation tool (check Phase 1 logs)
3. Frontend not receiving citations (check SSE events)
4. File ID mismatch (check `fileData.id === highlightData.fileId`)

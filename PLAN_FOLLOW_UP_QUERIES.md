# Plan: Dynamic Follow-Up Queries with Block ID Reuse

## Problem Analysis

### Current Issue
1. **Query**: "please find me the value of the highlands property"
   - ✅ Works correctly - returns valuation with citations

2. **Follow-up Query**: "please make it more detailed on the assumptions mentioned for each value"
   - ❌ Incorrectly classified as `text_transformation`
   - ❌ Fails because it can't find text to transform
   - ✅ Should be classified as `document_search` follow-up query

### Root Cause
- The classifier sees "make it more detailed" and assumes text transformation
- But this is actually a **follow-up document search** asking for more information
- We need to distinguish:
  - **Text Transformation**: "Make this text sharper" (transform existing text)
  - **Follow-up Query**: "Make it more detailed on X" (get more info from documents)

## Solution Overview

### Key Concepts
1. **Follow-up Query Detection**: Identify when a query is asking for more detail about previous document search results
2. **Block ID Storage**: Store block IDs from previous queries in conversation history
3. **Fast Block Retrieval**: Reuse block IDs to quickly "teleport" to relevant document sections
4. **Contextual Search**: Search around stored blocks for related information

## Implementation Plan

### Phase 1: Enhanced Query Classification

#### 1.1 Distinguish Follow-up Queries from Text Transformations

**File**: `backend/llm/nodes/query_classifier.py`

**Changes**:
- Add new category: `follow_up_document_search`
- Improve classification logic to detect follow-up queries:
  - "make it more detailed on X" → follow-up query (not text transformation)
  - "tell me more about X" → follow-up query
  - "what are the assumptions for X" → follow-up query
  - "expand on X" → follow-up query (if referring to previous response)
  
**Detection Patterns**:
```python
# Follow-up query indicators (NOT text transformation)
follow_up_indicators = [
    'make it more detailed on', 'tell me more about', 'what are the',
    'expand on', 'explain more about', 'give me more detail on',
    'what about', 'can you elaborate on', 'provide more information on'
]

# Text transformation indicators (transform existing text)
transformation_indicators = [
    'make this sharper', 'reorganize this', 'rewrite this',
    'make this more concise', 'rephrase this text'
]
```

**Key Distinction**:
- **Text Transformation**: References "this", "that", "the text" + transformation verb → transforms text
- **Follow-up Query**: References specific topic from previous response + "more detail" → searches documents

#### 1.2 Check Conversation History for Document Context

**Logic**:
```python
# If query references previous response AND asks for more detail on specific topic
# AND previous response had citations → it's a follow-up query, not text transformation

if has_follow_up_indicator and previous_response_has_citations:
    return "follow_up_document_search"
elif has_transformation_verb and references_text:
    return "text_transformation"
```

### Phase 2: Store Block IDs in Conversation History

#### 2.1 Update Conversation History Structure

**File**: `backend/llm/types.py`

**Add to conversation_history entry**:
```python
conversation_entry = {
    "query": user_query,
    "summary": summary,
    "timestamp": datetime.now().isoformat(),
    "document_ids": [...],
    "citations": [...],  # Already stored
    "block_ids": [...],  # NEW: Store all block IDs used in response
    "metadata_lookup_tables": {...},  # NEW: Store block metadata for fast lookup
    "relevant_document_ids": [...],  # NEW: Store doc IDs that were used
    "query_category": "document_search"  # NEW: Store what type of query this was
}
```

#### 2.2 Store Block IDs After summarize_results

**File**: `backend/llm/nodes/summary_nodes.py`

**Changes**:
- After generating summary with citations, extract all block IDs from citations
- Store block IDs and metadata in conversation_history entry
- Store doc_ids that were used

**Implementation**:
```python
# After summarize_results generates citations
block_ids = [cit.get('block_id') for cit in citations if cit.get('block_id')]
doc_ids_used = list(set([cit.get('doc_id') for cit in citations if cit.get('doc_id')]))

conversation_entry = {
    "query": user_query,
    "summary": summary,
    "citations": citations,
    "block_ids": block_ids,  # NEW
    "document_ids": doc_ids_used,  # NEW
    "metadata_lookup_tables": metadata_lookup_tables,  # NEW (or reference)
    "query_category": "document_search"  # NEW
}
```

### Phase 3: Fast Block Retrieval Node

#### 3.1 Create Follow-up Query Handler

**File**: `backend/llm/nodes/follow_up_query_node.py` (NEW)

**Purpose**: Handle follow-up queries by reusing block IDs from previous queries

**Flow**:
1. Extract block IDs from previous conversation entry
2. Extract topic from current query (e.g., "assumptions for each value")
3. Retrieve blocks using stored block IDs
4. Search around those blocks for related information
5. Generate detailed response

**Implementation**:
```python
async def handle_follow_up_query(state: MainWorkflowState) -> MainWorkflowState:
    """
    Handle follow-up queries that ask for more detail on previous responses.
    
    Examples:
    - "make it more detailed on the assumptions" → Get more detail on assumptions
    - "tell me more about the 90-day value" → Get more detail on 90-day value
    - "what are the assumptions for each value" → Get assumptions for all values
    """
    user_query = state.get("user_query", "")
    conversation_history = state.get("conversation_history", [])
    
    # Get previous conversation entry (last one with block_ids)
    previous_entry = _get_last_document_search_entry(conversation_history)
    
    if not previous_entry or not previous_entry.get('block_ids'):
        # Fallback to normal document search
        return {"query_category": "document_search"}
    
    # Extract topic from query
    topic = _extract_topic_from_query(user_query)
    # e.g., "assumptions for each value" → "assumptions"
    
    # Get block IDs from previous query
    block_ids = previous_entry.get('block_ids', [])
    doc_ids = previous_entry.get('document_ids', [])
    metadata_lookup_tables = previous_entry.get('metadata_lookup_tables', {})
    
    # Retrieve blocks using stored IDs
    relevant_blocks = _retrieve_blocks_by_ids(block_ids, doc_ids, metadata_lookup_tables)
    
    # Search around those blocks for related information
    expanded_blocks = _search_around_blocks(relevant_blocks, topic, doc_ids)
    
    # Process and generate detailed response
    detailed_response = await _generate_detailed_response(
        user_query, topic, expanded_blocks, conversation_history
    )
    
    return {
        "final_summary": detailed_response,
        "conversation_history": [...],
        "citations": [...]
    }
```

#### 3.2 Block Retrieval Functions

**Functions to implement**:
1. `_retrieve_blocks_by_ids()`: Fetch blocks using stored block IDs
2. `_search_around_blocks()`: Search adjacent blocks/pages for related info
3. `_extract_topic_from_query()`: Extract what the user wants more detail on
4. `_generate_detailed_response()`: Generate response with more detail

### Phase 4: Update Graph Routing

#### 4.1 Add Follow-up Query Path

**File**: `backend/llm/graphs/main_graph.py`

**Changes**:
- Add `follow_up_document_search` to classification categories
- Route follow-up queries to `handle_follow_up_query` node
- Connect to format_response

**Routing**:
```python
builder.add_conditional_edges(
    "classify_query_intent",
    route_by_category,
    {
        "general_query": "handle_general_query",
        "text_transformation": "detect_and_extract_text",
        "follow_up_document_search": "handle_follow_up_query",  # NEW
        "document_search": "route_query",
        "hybrid": "route_query"
    }
)

# Follow-up query path
builder.add_edge("handle_follow_up_query", "format_response")
```

### Phase 5: Block ID Storage and Retrieval

#### 5.1 Store Metadata Lookup Tables

**Challenge**: Metadata lookup tables are large - don't store full tables in conversation history

**Solution**: Store references or minimal metadata
- Option A: Store block IDs + doc_ids, reconstruct metadata on demand
- Option B: Store minimal metadata (page, doc_id) for each block
- Option C: Store reference to session/query that has full metadata

**Recommended**: Option B - Store minimal metadata
```python
block_metadata_summary = {
    block_id: {
        'doc_id': doc_id,
        'page': page_number,
        'chunk_index': chunk_index
    }
    for block_id, metadata in metadata_lookup_tables.items()
}
```

#### 5.2 Retrieve Blocks from Database

**File**: `backend/llm/nodes/follow_up_query_node.py`

**Function**: `_retrieve_blocks_by_ids()`

**Implementation**:
```python
def _retrieve_blocks_by_ids(block_ids: list, doc_ids: list, metadata_summary: dict):
    """
    Retrieve blocks from database using stored block IDs.
    
    Uses metadata_summary to know which doc_id, page, chunk_index to fetch.
    """
    # Group by doc_id for efficient fetching
    blocks_by_doc = {}
    for block_id in block_ids:
        meta = metadata_summary.get(block_id, {})
        doc_id = meta.get('doc_id')
        if doc_id:
            if doc_id not in blocks_by_doc:
                blocks_by_doc[doc_id] = []
            blocks_by_doc[doc_id].append(block_id)
    
    # Fetch chunks for each doc
    retrieved_blocks = []
    for doc_id, block_ids_for_doc in blocks_by_doc.items():
        # Fetch chunks containing these blocks
        chunks = _fetch_chunks_by_block_ids(doc_id, block_ids_for_doc, metadata_summary)
        retrieved_blocks.extend(chunks)
    
    return retrieved_blocks
```

#### 5.3 Search Around Blocks

**Function**: `_search_around_blocks()`

**Purpose**: Get adjacent blocks/pages for context

**Implementation**:
```python
def _search_around_blocks(blocks: list, topic: str, doc_ids: list):
    """
    Search around retrieved blocks for related information.
    
    Strategy:
    1. Get pages where blocks are located
    2. Fetch adjacent pages (±2 pages)
    3. Search for topic-related content in those pages
    4. Return expanded block set
    """
    # Get page numbers from blocks
    pages = set([block.get('page') for block in blocks])
    
    # Expand to adjacent pages
    expanded_pages = set()
    for page in pages:
        expanded_pages.add(page)
        expanded_pages.add(page - 1)
        expanded_pages.add(page + 1)
        expanded_pages.add(page - 2)
        expanded_pages.add(page + 2)
    
    # Fetch chunks from expanded pages
    expanded_chunks = _fetch_chunks_by_pages(doc_ids, expanded_pages)
    
    # Filter for topic relevance
    relevant_chunks = _filter_by_topic(expanded_chunks, topic)
    
    return relevant_chunks
```

### Phase 6: Topic Extraction

#### 6.1 Extract Topic from Query

**Function**: `_extract_topic_from_query()`

**Examples**:
- "make it more detailed on the assumptions" → "assumptions"
- "tell me more about the 90-day value" → "90-day value"
- "what are the assumptions for each value" → "assumptions for each value"

**Implementation**:
```python
def _extract_topic_from_query(user_query: str) -> str:
    """
    Extract what the user wants more detail on.
    
    Patterns:
    - "more detailed on X" → X
    - "tell me more about X" → X
    - "what are the X" → X
    - "expand on X" → X
    """
    query_lower = user_query.lower()
    
    # Pattern matching
    patterns = [
        r'more detailed on (.+)',
        r'tell me more about (.+)',
        r'what are the (.+)',
        r'expand on (.+)',
        r'elaborate on (.+)',
        r'provide more information on (.+)'
    ]
    
    for pattern in patterns:
        match = re.search(pattern, query_lower)
        if match:
            return match.group(1).strip()
    
    # Fallback: return query as-is
    return user_query
```

### Phase 7: Integration with Existing Flow

#### 7.1 Update Classification Logic

**File**: `backend/llm/nodes/query_classifier.py`

**Add follow-up detection**:
```python
# Check if this is a follow-up query
conversation_history = state.get("conversation_history", [])
previous_entry = _get_last_document_search_entry(conversation_history)

if previous_entry and previous_entry.get('block_ids'):
    # Check if query asks for more detail
    if _is_follow_up_query(user_query, previous_entry):
        return {"query_category": "follow_up_document_search"}
```

#### 7.2 Update Types

**File**: `backend/llm/types.py`

**Add to MainWorkflowState**:
```python
query_category: Optional[str]  # Add "follow_up_document_search"
previous_block_ids: Optional[list[str]]  # NEW: Block IDs from previous query
previous_doc_ids: Optional[list[str]]  # NEW: Doc IDs from previous query
```

## Benefits

1. **Speed**: Reuses block IDs - no need to search entire document again
2. **Accuracy**: Goes directly to relevant sections
3. **Context**: Searches around blocks for related information
4. **User Experience**: Handles natural follow-up questions correctly

## Implementation Order

1. **Phase 1**: Enhanced classification (distinguish follow-up from transformation)
2. **Phase 2**: Store block IDs in conversation history
3. **Phase 3**: Create follow-up query handler
4. **Phase 4**: Update graph routing
5. **Phase 5**: Implement block retrieval
6. **Phase 6**: Topic extraction
7. **Phase 7**: Integration and testing

## Success Criteria

- ✅ "make it more detailed on X" correctly classified as follow-up query
- ✅ Block IDs stored in conversation history
- ✅ Fast retrieval using stored block IDs
- ✅ Response time < 3s for follow-up queries
- ✅ Accurate responses with more detail on requested topics


# Plan: General LLM Capabilities + Document Search Hybrid System

## Overview
Transform the current document-search-only system into a hybrid assistant that can:
1. Answer general knowledge questions (e.g., "What is the date today?")
2. Transform/reorganize text (e.g., "Please make this writing appear sharper")
3. Search documents (existing functionality)
4. Intelligently route queries to the appropriate handler

## Current Architecture Analysis

### Existing Components
- **Routing System**: `backend/llm/nodes/routing_nodes.py` - Routes queries to document search paths
- **Query Classification**: `backend/llm/nodes/retrieval_nodes.py` - Classifies as semantic/structured/hybrid (for search only)
- **Conversation History**: Tracked in `MainWorkflowState.conversation_history`
- **Workflow Graph**: `backend/llm/graphs/main_graph.py` - LangGraph orchestration

### Current Limitations
- All queries route to document search paths
- No general LLM response capability
- No text transformation capability
- No context awareness for "previous response" or "pasted text"

## Implementation Plan

### Phase 1: Enhanced Query Classification

#### 1.1 Create New Classification Node
**File**: `backend/llm/nodes/query_classifier.py` (NEW)

**Purpose**: Classify queries into one of four categories:
- `general_query`: General knowledge questions (no document search needed)
- `text_transformation`: Requests to modify/reorganize text
- `document_search`: Queries requiring document search (existing)
- `hybrid`: Queries that might need both general knowledge + document search

**Implementation**:
```python
async def classify_query_intent(state: MainWorkflowState) -> MainWorkflowState:
    """
    Classify query intent using LLM:
    - general_query: "What is the date today?", "Explain quantum computing"
    - text_transformation: "Make this sharper", "Reorganize this text"
    - document_search: "What is the market value?", "Find properties with..."
    - hybrid: "Compare today's date with the valuation date in the documents"
    """
```

**Detection Patterns**:
- **General Query Indicators**:
  - Questions about current date/time
  - General knowledge questions (no property/document context)
  - Explanatory questions ("What is...", "How does...")
  - No document attachments or property context

- **Text Transformation Indicators**:
  - Imperative verbs: "make", "reorganize", "rewrite", "improve", "sharpen"
  - References to "this", "that", "the above", "previous response"
  - No question mark (often commands)
  - May include pasted text in query

- **Document Search Indicators**:
  - Property-specific terms
  - Document references
  - Attached files
  - Property ID in context

#### 1.2 Update MainWorkflowState
**File**: `backend/llm/types.py`

**Add new fields**:
```python
class MainWorkflowState(TypedDict, total=False):
    # ... existing fields ...
    query_category: str  # NEW: "general_query", "text_transformation", "document_search", "hybrid"
    text_to_transform: Optional[str]  # NEW: Text content to transform (from pasted text or previous response)
    transformation_instruction: Optional[str]  # NEW: How to transform the text
    requires_document_search: bool  # NEW: Whether document search is needed
    requires_general_llm: bool  # NEW: Whether general LLM response is needed
```

### Phase 2: Context Awareness System

#### 2.1 Detect Text Sources
**File**: `backend/llm/nodes/context_detector.py` (NEW)

**Purpose**: Identify what text the user is referring to:
- Previous assistant response
- Pasted text in current query
- Specific document content
- Conversation history

**Implementation**:
```python
def detect_text_source(state: MainWorkflowState) -> MainWorkflowState:
    """
    Detect what text user wants to transform:
    1. Check for pasted text in query (long text blocks, markdown, etc.)
    2. Check conversation history for previous response
    3. Check for document references
    4. Extract transformation instruction from query
    """
```

**Detection Logic**:
- **Pasted Text**: Look for text blocks > 100 chars that aren't part of the question
- **Previous Response**: Check `conversation_history[-1]` for assistant's last response
- **Document Reference**: Check for document IDs or "in the document" references
- **Transformation Instruction**: Extract imperative command from query

#### 2.2 Extract Text to Transform
**File**: `backend/llm/nodes/text_extractor.py` (NEW)

**Purpose**: Extract the actual text content to transform

**Implementation**:
```python
def extract_text_to_transform(state: MainWorkflowState) -> MainWorkflowState:
    """
    Extract text from:
    1. Pasted text in query (if detected)
    2. Previous assistant response (if referenced)
    3. Specific document content (if referenced)
    """
```

### Phase 3: General LLM Response Node

#### 3.1 Create General Query Handler
**File**: `backend/llm/nodes/general_query_node.py` (NEW)

**Purpose**: Handle general knowledge queries without document search

**Implementation**:
```python
async def handle_general_query(state: MainWorkflowState) -> MainWorkflowState:
    """
    Answer general knowledge questions using LLM.
    No document search required.
    
    Examples:
    - "What is the date today?" → Get current date and format response
    - "Explain quantum computing" → General explanation
    - "What is the capital of France?" → Factual answer
    """
```

**Features**:
- Use current date/time when relevant
- Access to general knowledge
- Can reference conversation history for context
- Fast response (no document search overhead)

**Prompt Template**: `backend/llm/prompts.py` - Add `get_general_query_prompt()`

### Phase 4: Text Transformation Node

#### 4.1 Create Text Transformation Handler
**File**: `backend/llm/nodes/text_transformation_node.py` (NEW)

**Purpose**: Transform/reorganize text based on user instructions

**Implementation**:
```python
async def transform_text(state: MainWorkflowState) -> MainWorkflowState:
    """
    Transform text based on user instruction.
    
    Examples:
    - "Make this sharper" → Improve clarity, remove fluff
    - "Reorganize this" → Better structure and flow
    - "Make this more concise" → Reduce length while keeping key points
    - "Add more detail" → Expand with additional context
    """
```

**Transformation Types**:
- **Sharpen**: Improve clarity, remove redundancy, tighten language
- **Reorganize**: Better structure, logical flow, headings
- **Concise**: Reduce length, keep essentials
- **Expand**: Add detail, examples, context
- **Rephrase**: Different tone, style, formality

**Prompt Template**: `backend/llm/prompts.py` - Add `get_text_transformation_prompt()`

**Input Sources**:
1. Pasted text in query
2. Previous assistant response (from conversation history)
3. Document content (if referenced)

### Phase 5: Update Workflow Graph

#### 5.1 Add New Routing Paths
**File**: `backend/llm/graphs/main_graph.py`

**New Flow**:
```
START
  ↓
classify_query_intent (NEW)
  ↓
  ├─→ general_query → handle_general_query → format_response → END
  ├─→ text_transformation → detect_text_source → extract_text_to_transform → transform_text → format_response → END
  ├─→ document_search → [existing document search flow]
  └─→ hybrid → [parallel: general_query + document_search] → merge_results → format_response → END
```

**Implementation**:
```python
# Add new nodes
builder.add_node("classify_query_intent", classify_query_intent)
builder.add_node("detect_text_source", detect_text_source)
builder.add_node("extract_text_to_transform", extract_text_to_transform)
builder.add_node("handle_general_query", handle_general_query)
builder.add_node("transform_text", transform_text)

# Add conditional routing
builder.add_conditional_edges(
    "classify_query_intent",
    lambda state: state.get("query_category", "document_search"),
    {
        "general_query": "handle_general_query",
        "text_transformation": "detect_text_source",
        "document_search": "route_query",  # Existing routing
        "hybrid": "parallel_hybrid_handler"  # NEW: Handle both
    }
)
```

#### 5.2 Hybrid Query Handler
**File**: `backend/llm/nodes/hybrid_query_node.py` (NEW)

**Purpose**: Handle queries that need both general knowledge and document search

**Implementation**:
```python
async def handle_hybrid_query(state: MainWorkflowState) -> MainWorkflowState:
    """
    Handle queries requiring both general knowledge and document search.
    
    Example: "Compare today's date with the valuation date in the documents"
    - General: Get today's date
    - Document: Find valuation date in documents
    - Merge: Compare and present
    """
```

### Phase 6: Frontend Integration

#### 6.1 Update Query Submission
**File**: `frontend-ts/src/components/SideChatPanel.tsx`

**Changes**:
- No changes needed initially (backend handles routing)
- May add UI hints for text transformation (e.g., "Paste text to transform")

#### 6.2 Handle Text Transformation Responses
**File**: `frontend-ts/src/components/SideChatPanel.tsx`

**Changes**:
- Display transformed text in same format as regular responses
- Preserve markdown formatting
- Show transformation applied (optional UI indicator)

### Phase 7: Prompt Engineering

#### 7.1 General Query Prompt
**File**: `backend/llm/prompts.py`

**Add**: `get_general_query_prompt()`
- Instructions for general knowledge questions
- Access to current date/time
- Reference conversation history
- Natural, conversational tone

#### 7.2 Text Transformation Prompt
**File**: `backend/llm/prompts.py`

**Add**: `get_text_transformation_prompt()`
- Instructions for different transformation types
- Preserve key information
- Improve clarity/structure
- Maintain original intent

#### 7.3 Query Classification Prompt
**File**: `backend/llm/prompts.py`

**Add**: `get_query_classification_prompt()`
- Examples of each category
- Clear decision criteria
- Context-aware classification

### Phase 8: Testing & Validation

#### 8.1 Test Cases

**General Query**:
- "What is the date today?"
- "Explain quantum computing"
- "What is the capital of France?"

**Text Transformation**:
- "Make this sharper" (with pasted text)
- "Reorganize the previous response"
- "Make this more concise" (referring to last response)

**Document Search** (existing):
- "What is the market value?"
- "Find properties with 3 bedrooms"

**Hybrid**:
- "Compare today's date with the valuation date"
- "What is the current interest rate and how does it compare to the property's mortgage rate?"

## Implementation Order

1. **Phase 1**: Query classification (foundation)
2. **Phase 2**: Context detection (needed for text transformation)
3. **Phase 3**: General query handler (simpler, test routing)
4. **Phase 4**: Text transformation (more complex)
5. **Phase 5**: Update workflow graph (integrate everything)
6. **Phase 6**: Frontend updates (if needed)
7. **Phase 7**: Prompt refinement (iterative)
8. **Phase 8**: Testing & validation

## Key Design Decisions

### 1. Classification Strategy
- **LLM-based**: More accurate, handles edge cases
- **Rule-based fallback**: For obvious cases (faster)

### 2. Text Source Priority
1. Pasted text in query (highest priority)
2. Previous assistant response
3. Referenced document content

### 3. Transformation Context
- Always preserve citations if transforming document-based response
- Maintain markdown structure
- Preserve key facts/numbers

### 4. Hybrid Queries
- Run general query and document search in parallel
- Merge results intelligently
- Present unified response

## Files to Create/Modify

### New Files
- `backend/llm/nodes/query_classifier.py`
- `backend/llm/nodes/context_detector.py`
- `backend/llm/nodes/text_extractor.py`
- `backend/llm/nodes/general_query_node.py`
- `backend/llm/nodes/text_transformation_node.py`
- `backend/llm/nodes/hybrid_query_node.py`

### Modified Files
- `backend/llm/types.py` - Add new state fields
- `backend/llm/graphs/main_graph.py` - Add new nodes and routing
- `backend/llm/prompts.py` - Add new prompts
- `frontend-ts/src/components/SideChatPanel.tsx` - Minor updates (if needed)

## Success Metrics

1. **Accuracy**: Correctly classify 95%+ of queries
2. **Speed**: General queries < 2s, transformations < 3s
3. **User Experience**: Natural conversation flow, no confusion about capabilities
4. **Context Awareness**: Correctly identify text source 90%+ of the time

## Future Enhancements

1. **Multi-turn Transformations**: "Make it sharper" → "Now make it more concise"
2. **Transformation History**: Track what transformations were applied
3. **Custom Instructions**: User-defined transformation preferences
4. **Batch Transformations**: Transform multiple pieces of text at once
5. **Transformation Templates**: Pre-defined transformation styles


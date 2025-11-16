# LLM Architecture - Vector-Only Mode

## Overview
The LLM agent uses a simplified vector-only retrieval pipeline optimized for semantic document search with conversation memory.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER QUERY                                │
│  "What documents have properties near the M1 with 5 bedrooms?"   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   NODE 1: VECTOR SEARCH                          │
│  - Embeds query using OpenAI text-embedding-ada-002              │
│  - Searches Supabase pgvector with HNSW index                    │
│  - Filters by business_id for multi-tenancy                      │
│  - Uses similarity threshold (0.35) with fallback (0.15)         │
│  - Returns top 30 document chunks                                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              NODE 2: CLARIFY & RE-RANK                           │
│  - LLM reads all retrieved chunks                                │
│  - Re-ranks by relevance to user query                           │
│  - Considers conversation history for context                    │
│  - Returns sorted list of most relevant documents                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│           NODE 3: PROCESS DOCUMENTS (Parallel)                   │
│  For each document chunk:                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Document QA Subgraph:                                   │    │
│  │  1. Fetch full document content                          │    │
│  │  2. LLM extracts relevant information                    │    │
│  │  3. Returns structured answer with citations            │    │
│  └─────────────────────────────────────────────────────────┘    │
│  Output: List of per-document analyses                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                NODE 4: SUMMARIZE RESULTS                         │
│  - LLM reads all document analyses                               │
│  - References conversation history (last 3 exchanges)            │
│  - Creates unified summary answering user query                  │
│  - Cites which documents support each claim                      │
│  - Stores Q&A in conversation_history for next query             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                       FINAL SUMMARY                              │
│  "Based on Documents 24, 56, and 57, the Highlands property      │
│   at Berden Road is a 5-bedroom detached house near the M11..."  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Initial State (Input)
```python
{
    "user_query": "What properties are near the M1?",
    "query_intent": None,  # Not used in vector-only mode
    "relevant_documents": [],
    "document_outputs": [],
    "final_summary": "",
    "user_id": "test_user",
    "business_id": "65836ea9-...",
    "conversation_history": [],  # Empty for first query
    "session_id": "session_1234567890"
}
```

### 2. After Vector Search
```python
{
    "relevant_documents": [
        {
            "doc_id": "d13bea9f...",
            "property_id": "28735699...",
            "content": "Property features: 5 bedrooms, good M11 connectivity...",
            "similarity": 0.78,
            "classification_type": "Appraisal Report"
        },
        # ... 29 more documents
    ]
}
```

### 3. After Clarify
```python
{
    "relevant_documents": [
        # Same documents, but re-ranked by LLM relevance
        # Less relevant docs moved to end or removed
    ]
}
```

### 4. After Process Documents
```python
{
    "document_outputs": [
        {
            "doc_id": "d13bea9f...",
            "property_id": "28735699...",
            "output": "The property is located at Highlands, Berden Road...",
            "source_chunks": ["chunk 1 text", "chunk 2 text"]
        },
        # ... one per document
    ]
}
```

### 5. Final State (Output)
```python
{
    "final_summary": "Based on Documents 24, 56, and 57...",
    "conversation_history": [
        {
            "query": "What properties are near the M1?",
            "summary": "Based on Documents 24, 56, and 57...",
            "document_ids": ["d13bea9f...", "525d30ff...", ...]
        }
    ],
    # ... other fields
}
```

---

## Key Features

### 1. Vector Similarity Search
- **Embedding Model**: OpenAI `text-embedding-ada-002` (1536 dimensions)
- **Vector Database**: Supabase pgvector with HNSW index
- **Similarity Metric**: Cosine similarity
- **Threshold Strategy**:
  - Primary: 0.35 (high quality matches)
  - Fallback: 0.15 (if no results at 0.35)
- **Multi-tenancy**: Filters by `business_id` automatically

### 2. Conversation Memory
- **Storage**: In-memory during session (not persisted yet)
- **Context Window**: Last 3 Q&A exchanges
- **Purpose**:
  - Resolve ambiguous follow-ups ("What about the price?")
  - Maintain context across queries
  - Enable natural conversation flow
- **Token Usage**: ~300-500 tokens per exchange (~1,500 total for 3)

### 3. Document Processing
- **Parallel Execution**: Each document analyzed independently
- **Simple Mode**: Optional stubbed responses for faster testing
- **Extraction Focus**: LLM extracts only relevant information
- **Fallback**: "No relevant information in this excerpt" if not found

### 4. Intelligent Summarization
- **Cross-Document Synthesis**: Combines findings from multiple sources
- **Citation**: References specific document IDs
- **Pattern Detection**: Highlights agreements/disagreements
- **Context-Aware**: References previous conversation when relevant

---

## Configuration

### Environment Variables
```bash
# Required
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
TEST_BUSINESS_UUID=65836ea9-...

# Optional
VECTOR_TOP_K=30                    # Max documents to retrieve
SIMILARITY_THRESHOLD=0.35          # Initial similarity threshold
MIN_SIMILARITY_THRESHOLD=0.15      # Fallback threshold
LLM_SIMPLE_MODE=false              # Use stubbed responses (faster)
```

### LLM Models
- **Embeddings**: `text-embedding-ada-002` (OpenAI)
- **Reasoning**: `gpt-4o` (OpenAI) - configurable via `OPENAI_MODEL`
- **Temperature**: 0 (deterministic for consistency)

---

## Performance

### Latency Breakdown (Single Query)
- Vector search: ~200-500ms
- Clarify/re-rank: ~1-2s (LLM call)
- Process documents: ~3-10s (parallel, depends on doc count)
- Summarize: ~2-5s (LLM call)
- **Total**: ~6-17s for 30 documents

### Token Usage (Typical Query)
- Vector search: 0 (embedding-only)
- Clarify: ~2,000 tokens
- Process documents: ~500 tokens × 30 docs = ~15,000 tokens
- Summarize: ~3,000 tokens
- **Total**: ~20,000 tokens per query (~$0.20 at GPT-4 rates)

### Optimization Opportunities
1. **Reduce doc count**: Lower `VECTOR_TOP_K` to 10-15
2. **Enable simple mode**: Set `LLM_SIMPLE_MODE=true` for testing
3. **Cache embeddings**: Reuse for identical queries
4. **Streaming**: Return partial results as they're processed

---

## Future Enhancements

### Planned Features (Not Yet Implemented)
- [ ] **SQL/Structured Retrieval**: Filter by exact attributes (bedrooms, price)
- [ ] **Hybrid Search**: Combine vector + SQL for better results
- [ ] **Property Comparables**: Find similar properties for valuation
- [ ] **Map Integration**: Highlight properties on frontend map
- [ ] **Document Upload**: Drop file in chat → auto-process
- [ ] **Session Persistence**: Store conversation in Supabase
- [ ] **Multi-Agent**: Specialized agents (lease, valuation, compliance)

### Infrastructure Improvements
- [ ] **Redis Caching**: Cache frequent queries
- [ ] **Batch Processing**: Group multiple queries
- [ ] **Rate Limiting**: Prevent OpenAI quota exhaustion
- [ ] **Monitoring**: Track latency, token usage, errors
- [ ] **A/B Testing**: Compare different prompts/thresholds

---

## Testing

### Interactive Testing
```bash
python tests/interactive_llm_test.py
```

**Test conversation memory:**
1. Ask: "Tell me about the Highlands property"
2. Follow up: "What's the price?"
3. Follow up: "How many bathrooms?"

The LLM should understand each follow-up refers to Highlands.

### Integration Testing
```bash
pytest tests/test_llm_graph_integration.py -v
```

Verifies the full pipeline executes without errors.

---

## Troubleshooting

### "No documents retrieved"
**Causes:**
- Wrong `business_id` (documents belong to different business)
- Empty vector store (no documents uploaded)
- Similarity threshold too high
- Query embedding mismatch

**Solutions:**
- Verify documents exist in Supabase `document_vectors` table
- Check `business_uuid` matches uploaded documents
- Lower `SIMILARITY_THRESHOLD` or `MIN_SIMILARITY_THRESHOLD`

### "Documents retrieved but no information extracted"
**Causes:**
- Document content doesn't match query
- Prompt too strict in document_qa_agent

**Solutions:**
- Review retrieved document content (check similarity scores)
- Adjust document QA prompt to be more lenient
- Verify embeddings are high quality

### Slow performance
**Causes:**
- Too many documents (high `VECTOR_TOP_K`)
- Large document chunks
- LLM model latency

**Solutions:**
- Reduce `VECTOR_TOP_K` to 10-15
- Enable `LLM_SIMPLE_MODE` for testing
- Use cheaper model (gpt-3.5-turbo) for development

---

## Directory Structure

```
backend/llm/
├── ARCHITECTURE.md           # This file
├── CONVERSATION_MEMORY.md    # Memory implementation guide
├── config.py                 # Environment config
├── types.py                  # LangGraph state types
├── agents/
│   └── document_qa_agent.py  # Per-document QA subgraph
├── graphs/
│   └── main_graph.py         # Main LangGraph orchestration
├── nodes/
│   ├── retrieval_nodes.py    # Vector search & clarify
│   ├── processing_nodes.py   # Document processing
│   └── summary_nodes.py      # Final summarization
└── retrievers/
    └── vector_retriever.py   # Supabase pgvector client

tests/
├── interactive_llm_test.py   # Interactive terminal chat
├── test_llm_graph_integration.py  # Pytest integration test
└── README_LLM_TESTING.md     # Testing guide
```

---

## References

- **LangGraph Docs**: https://langchain-ai.github.io/langgraph/
- **Supabase pgvector**: https://supabase.com/docs/guides/ai/vector-columns
- **OpenAI Embeddings**: https://platform.openai.com/docs/guides/embeddings
- **Conversation Memory**: See `CONVERSATION_MEMORY.md`

---

Last Updated: 2025-11-15  
Version: 2.0 (Vector-Only Mode)


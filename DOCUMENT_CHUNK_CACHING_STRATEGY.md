# Document-Level Chunk Caching Strategy

## Downsides of Fetching More Chunks

### 1. **Performance Impact**
- **Database Load**: More chunks = more database queries, slower response times
- **Network Transfer**: More data transferred from database to application
- **Memory Usage**: More chunks in memory = higher memory footprint
- **Processing Time**: More chunks to process, rank, and filter

### 2. **LLM Context Limits**
- **Token Limits**: More chunks = more tokens sent to LLM
- **Cost**: More tokens = higher API costs (OpenAI charges per token)
- **Quality Degradation**: Too many chunks can dilute relevance, making it harder for LLM to find the right answer

### 3. **Relevance Issues**
- **Signal Dilution**: More chunks might include less relevant content
- **Noise**: Irrelevant chunks can confuse the LLM
- **Ranking Complexity**: Harder to rank and select the best chunks when there are many

## Solution: Document-Level Chunk Cache

### Strategy
When a document is first queried, fetch **ALL chunks** for that document and cache them in the workflow state. Subsequent queries about the same document use cached chunks instead of querying the database.

### Benefits
1. **One-Time Cost**: Fetch all chunks once, reuse for all follow-up queries
2. **Fast Follow-ups**: No database queries needed for cached documents
3. **Complete Coverage**: All pages (including page 30) are available immediately
4. **Works for All Queries**: Not just valuations - any query about a cached document benefits

### Implementation

#### 1. Document Chunk Cache Structure
```python
# Request-scoped cache (per conversation/workflow run)
_document_chunks_cache: Dict[str, List[Dict]] = {}
# Key: doc_id
# Value: List of all chunks for that document
```

#### 2. Cache Population
- When a document is first retrieved (in `query_vector_documents`, `query_structured`, etc.)
- Fetch ALL chunks for that document in one query
- Store in cache with `doc_id` as key
- Chunks include: `chunk_text`, `chunk_index`, `page_number`, `bbox`, `blocks`, `embedding_status`

#### 3. Cache Usage
- Before querying database for chunks, check cache
- If document is cached, use cached chunks
- Filter/rank cached chunks based on query (similarity, page number, etc.)
- Only query database for documents not in cache

#### 4. Cache Invalidation
- Cache is request-scoped (cleared after workflow completes)
- For multi-turn conversations, cache persists in workflow state
- Can be manually cleared if needed

### Code Changes

1. **Add cache dictionary** at module level (request-scoped)
2. **Modify retrieval functions** to check cache first
3. **Fetch all chunks** when document is first encountered
4. **Use cached chunks** for subsequent queries about same document
5. **Store cache in workflow state** for multi-turn conversations

### Performance Impact

**First Query (Cache Miss)**:
- Fetch all chunks: ~200-500ms (one-time cost)
- Store in cache: ~10ms
- Total: ~210-510ms

**Follow-up Queries (Cache Hit)**:
- Check cache: ~1ms
- Filter/rank cached chunks: ~10-50ms
- Total: ~11-51ms (vs 200-500ms for database query)

**Savings**: ~190-450ms per follow-up query per document

### Memory Considerations

**Typical Document**:
- ~50-200 chunks per document
- ~1-5KB per chunk (text + metadata)
- Total: ~50KB - 1MB per document

**Memory Impact**:
- 10 cached documents: ~500KB - 10MB
- 100 cached documents: ~5MB - 100MB
- Acceptable for most applications

### Edge Cases

1. **Very Large Documents**: Documents with 1000+ chunks
   - Solution: Still cache all, but consider pagination for display
   
2. **Memory Limits**: Too many cached documents
   - Solution: LRU eviction policy (remove least recently used)
   - Or: Limit cache to N most recent documents

3. **Stale Data**: Document updated after cache
   - Solution: Cache is request-scoped, so new requests get fresh data
   - For multi-turn: Consider cache TTL or version checking

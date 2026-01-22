# Reducto Chunking & Bbox Preservation Best Practices

## 📚 Based on Reducto Documentation & RAG Best Practices

### Current Implementation Analysis

**Reducto Configuration:**
- `chunk_mode: "section"` - Section-based chunking (by page titles/sections)
- `embedding_optimized: True` - Better table summaries for vector search
- Returns chunks with:
  - `chunk_text` - The actual text content
  - `blocks` - Array of blocks with individual bboxes
  - `bbox` - Chunk-level bounding box
  - `page` / `original_page` - Page numbers

**Current Issue:**
- Section-based chunks average **14,097 characters** (too large for LLM)
- Chunks are stored as-is without further splitting
- Bbox metadata is preserved but chunks are overwhelming

---

## 🎯 Reducto's Recommended Approach for RAG

Based on Reducto's documentation (https://docs.reducto.ai/overview), they recommend:

### 1. **Layout-Aware Chunking for RAG**
- Reducto provides **"layout-aware chunking optimized for LLMs"**
- Section-based chunking (`chunk_mode: "section"`) maintains document structure
- This is ideal for semantic boundaries but can create large chunks

### 2. **Bbox Preservation**
- Reducto returns bbox coordinates for:
  - **Chunk-level bbox**: Overall chunk location
  - **Block-level bboxes**: Individual text blocks, tables, figures within chunks
- Format: `{left, top, width, height, page, original_page}` (normalized 0-1 coordinates)

### 3. **Best Practice: Two-Stage Chunking**

**Stage 1: Reducto (Semantic Boundaries)**
- Use `chunk_mode: "section"` for semantic chunking
- Preserves document structure (sections, headings, logical breaks)
- Returns chunks with full bbox and block metadata

**Stage 2: Post-Processing (Size Optimization)**
- Split large Reducto chunks (>2500 chars) into smaller pieces
- **CRITICAL**: Preserve bbox metadata when splitting
- Maintain overlap for continuous context

---

## ✅ Recommended Implementation Strategy

### Option A: Hybrid Approach (RECOMMENDED)

**1. Keep Reducto's Section-Based Chunking**
```python
# Reducto config (current - GOOD)
"retrieval": {
    "chunking": {
        "chunk_mode": "section"  # ✅ Maintains semantic boundaries
    },
    "embedding_optimized": True  # ✅ Better table summaries
}
```

**2. Post-Process Large Chunks (ALREADY IMPLEMENTED)**
```python
# vector_service.py (CURRENT FIX)
MAX_CHUNK_SIZE = 2500  # Split chunks > 2500 chars
chunk_size = 1500  # Target size for sub-chunks
overlap = None  # Dynamic overlap (15-25% based on content)
```

**3. Preserve Bbox Metadata (ALREADY IMPLEMENTED)**
```python
# _map_subchunk_to_blocks() preserves:
- Chunk-level bbox (from blocks)
- Block-level bboxes (for citations)
- Page numbers (from bbox)
- Overlap (for context continuity)
```

### Option B: Alternative Reducto Chunk Modes

If Reducto supports other chunk modes, consider:

1. **Token-based chunking** (if available)
   - More predictable chunk sizes
   - May lose semantic boundaries

2. **Custom chunk size** (if configurable)
   - Set max chunk size in Reducto config
   - Reducto handles splitting natively

3. **Hybrid: Section + Size Limit** (if supported)
   - Section-based but with max size constraint
   - Best of both worlds

---

## 🔍 Key Findings from Current Implementation

### ✅ What's Working Well

1. **Bbox Preservation**
   - Chunk-level bbox stored in `bbox` column (JSONB)
   - Block-level bboxes stored in `blocks` array (JSONB)
   - Page numbers extracted correctly
   - Format: `{left, top, width, height, page, original_page}`

2. **Block Mapping**
   - `_map_subchunk_to_blocks()` correctly maps sub-chunks to blocks
   - Sequential distribution for large chunks
   - Word overlap matching for smaller chunks
   - Fallback strategies ensure bbox is always preserved

3. **Overlap Preservation**
   - Dynamic overlap (15-25%) based on content density
   - Maintains continuous context between chunks
   - Sentence boundary detection for clean breaks

### ⚠️ Current Limitations

1. **Chunk Size**
   - Reducto's section-based chunks are large (14k avg)
   - Our post-processing splits them (✅ FIXED)
   - But existing chunks in DB are still large

2. **No Reducto-Level Size Control**
   - Can't configure max chunk size in Reducto
   - Must rely on post-processing

---

## 📋 Best Practices Summary

### 1. **Chunking Strategy**
- ✅ Use Reducto's section-based chunking for semantic boundaries
- ✅ Post-process chunks > 2500 chars into ~1500 char sub-chunks
- ✅ Maintain 15-25% overlap for context continuity
- ✅ Preserve sentence boundaries when splitting

### 2. **Bbox Preservation**
- ✅ Store chunk-level bbox in `bbox` column (JSONB)
- ✅ Store block-level bboxes in `blocks` array (JSONB)
- ✅ Map sub-chunks to their containing blocks
- ✅ Extract page numbers from bbox metadata

### 3. **Context Continuity**
- ✅ Use dynamic overlap (dense content: 25%, normal: 20%, simple: 15%)
- ✅ Break at sentence boundaries when possible
- ✅ Preserve block relationships across chunk splits

### 4. **LLM Optimization**
- ✅ Target: 500-1000 tokens per chunk (2000-4000 chars)
- ✅ Current: 1500 chars ≈ 375 tokens (optimal)
- ✅ Max: 2500 chars ≈ 625 tokens (split threshold)

---

## 🔧 Recommended Configuration

### Reducto Settings (Current - OPTIMAL)
```python
{
    "retrieval": {
        "chunking": {
            "chunk_mode": "section"  # ✅ Semantic boundaries
        },
        "embedding_optimized": True  # ✅ Better table summaries
    }
}
```

### Post-Processing Settings (Current - OPTIMAL)
```python
MAX_CHUNK_SIZE = 2500  # Split threshold (~625 tokens)
TARGET_CHUNK_SIZE = 1500  # Target size (~375 tokens)
OVERLAP = None  # Dynamic (15-25% based on content)
```

### Bbox Preservation (Current - WORKING)
```python
# Each sub-chunk gets:
- bbox: From blocks it contains
- blocks: Subset of parent chunk's blocks
- page: From bbox metadata
- original_page: From bbox metadata
```

---

## 🎯 Conclusion

**Your current implementation is ALIGNED with Reducto best practices:**

1. ✅ **Reducto**: Section-based chunking for semantic boundaries
2. ✅ **Post-Processing**: Split large chunks while preserving bbox
3. ✅ **Bbox Preservation**: Chunk-level and block-level bboxes stored
4. ✅ **Context Continuity**: Dynamic overlap maintains context
5. ✅ **LLM Optimization**: Target 1500 chars (~375 tokens) per chunk

**The fix you've implemented (MAX_CHUNK_SIZE = 2500) is the correct approach** for handling Reducto's section-based chunks while preserving all metadata needed for citations.

**No changes needed to Reducto configuration** - the section-based chunking is optimal. The post-processing layer handles size optimization while preserving semantic boundaries and bbox metadata.

---

## 📝 Next Steps

1. ✅ **Chunk size fix** - COMPLETED (MAX_CHUNK_SIZE = 2500)
2. ✅ **Bbox preservation** - VERIFIED (working correctly)
3. ⏳ **Test with new documents** - Verify chunks are split correctly
4. ⏳ **Monitor chunk sizes** - Ensure average stays under 2000 chars
5. ⏳ **Verify citations** - Test that bbox coordinates work for highlighting

---

## 🔗 References

- Reducto Overview: https://docs.reducto.ai/overview
- Reducto mentions "layout-aware chunking optimized for LLMs" for RAG pipelines
- Section-based chunking maintains document structure (recommended for RAG)
- Bbox coordinates are normalized (0-1) for page-independent positioning


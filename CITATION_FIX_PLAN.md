# Citation Fix Plan - Based on Runtime Evidence

## Root Cause Analysis (From Debug Logs)

### Hypothesis A: CONFIRMED ✅
**Evidence from logs:**
- `total_chunks: 0` - `source_chunks_metadata` is empty
- `chunks_with_blocks: 0` - No chunks have blocks data
- `has_source_chunks_metadata: false` - Metadata is missing

**Root Cause:** Blocks data is not being retrieved from the database. The RPC functions (`match_documents`, `bm25_search_documents`) likely don't return the `blocks` field, or blocks aren't stored in the database.

### Hypothesis C: CONFIRMED ✅
**Evidence from logs:**
- Metadata lookup table only has 1 block (fallback)
- Bbox is invalid: `{left: 0.0, top: 0.0, width: 1.0, height: 1.0, page: 0}`
- This is the fallback bbox from `block_id_formatter.py` when no blocks are available

### Hypothesis B: CONFIRMED ✅
**Evidence from logs:**
- Citations ARE being extracted (5 citations)
- But all point to same fallback block `BLOCK_CITE_ID_1`
- All have invalid bbox `{0,0,1,1}`

### Hypothesis E: CONFIRMED ✅
**Evidence from logs:**
- Citations are being streamed to frontend
- Frontend receives citation events

### Hypothesis F: PARTIALLY CONFIRMED ⚠️
**Evidence from logs:**
- Citations are received and accumulated
- But citations have invalid bbox, so highlighting won't work

## Fix Strategy

### Fix 1: Fetch Blocks from Database When Missing
**Location:** `retrieval_nodes.py` - `clarify_relevant_docs`

**Problem:** Chunks from RPC don't have `blocks` data.

**Solution:** When `doc.get('blocks')` is None or empty, fetch blocks from `document_vectors` table using `vector_id` or `(doc_id, chunk_index)`.

**Implementation:**
1. After grouping chunks, check if blocks are missing
2. For chunks without blocks, batch fetch from `document_vectors` table
3. Merge blocks data into chunks before creating `source_chunks_metadata`

### Fix 2: Ensure Citation Rendering Matches citation-mapping Branch
**Location:** `SideChatPanel.tsx`

**Problem:** Citations might not be rendering as clickable links.

**Solution:** Verify `renderTextWithCitations` and `CitationLink` match the citation-mapping branch exactly.

### Fix 3: Fix BBOX Validation
**Location:** `SideChatPanel.tsx` - `handleCitationClick`

**Problem:** Invalid bbox `{0,0,1,1}` passes validation but highlights entire page.

**Solution:** Reject bbox that covers entire page (area > 0.9) as invalid.

## Implementation Steps

1. **Add blocks fetching logic** in `clarify_relevant_docs`
2. **Verify citation rendering** matches citation-mapping branch
3. **Improve bbox validation** to reject invalid bboxes
4. **Test with real query** to verify blocks are fetched and citations work

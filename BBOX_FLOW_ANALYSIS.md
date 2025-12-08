# BBOX Highlighting Flow Analysis

## Complete Flow: Query → BBOX Highlight

### Step 1: Document Retrieval (`retrieval_nodes.py` - `clarify_relevant_docs`)

**Location**: `backend/llm/nodes/retrieval_nodes.py:1667-1723`

1. **Chunks are selected** from vector search results
2. **Chunks are formatted with markers**:
   ```python
   def format_chunk_with_marker(chunk, idx):
       page = chunk.get('page_number', '?')
       return f"[CHUNK:{idx}:PAGE:{page}]\n{chunk['content']}"
   
   merged_content = "\n\n---\n\n".join([
       format_chunk_with_marker(chunk, i) 
       for i, chunk in enumerate(selected_chunks)  # idx = 0, 1, 2, 3...
   ])
   ```

3. **`source_chunks_metadata` is created** in the SAME order:
   ```python
   'source_chunks_metadata': [
       {
           'content': chunk['content'],
           'chunk_index': chunk['chunk_index'],  # Database chunk index (e.g., 7)
           'page_number': chunk['page_number'],
           'bbox': chunk.get('bbox'),  # BBOX from database
           'marker_index': i,  # Position in array (0, 1, 2...)
       }
       for i, chunk in enumerate(selected_chunks)
   ]
   ```

**Key Point**: 
- `marker_index` (0, 1, 2...) = position in `source_chunks_metadata` array
- `chunk_index` (7, 8, 9...) = database chunk index
- LLM sees: `[CHUNK:0:PAGE:4]`, `[CHUNK:1:PAGE:4]`, etc.

---

### Step 2: Document Processing (`processing_nodes.py`)

**Location**: `backend/llm/nodes/processing_nodes.py:35-162`

1. Each document's `content` (with `[CHUNK:X:PAGE:Y]` markers) is passed to `document_qa_agent`
2. The agent processes the content and should output citations like `[CHUNK:0]`, `[CHUNK:1]`, etc.
3. The output is stored in `document_outputs` with `source_chunks_metadata` preserved

---

### Step 3: LLM Final Summary (`views.py` - streaming)

**Location**: `backend/views.py:1217-1264`

1. **LLM sees the formatted document content** with `[CHUNK:X]` markers
2. **LLM is instructed** to cite using chunk markers:
   ```
   **CITATION REQUIREMENTS:**
   - Document excerpts contain [CHUNK:X] markers indicating the source section
   - When you use information from a document, cite it using the chunk marker: "£2,400,000[CHUNK:2]"
   ```

3. **LLM should respond** with: `"The sale price is £2,400,000[CHUNK:2]"`

---

### Step 4: Citation Parsing (`views.py`)

**Location**: `backend/views.py:1327-1404`

1. **Parse `[CHUNK:X]` citations** from LLM response:
   ```python
   chunk_citation_pattern = r'\[CHUNK:(\d+)(?::PAGE:\d+)?\]'
   chunk_citations_found = re.findall(chunk_citation_pattern, full_summary)
   # Example: ["2"] if LLM said [CHUNK:2]
   ```

2. **Map citation to chunk metadata**:
   ```python
   chunk_idx = int(chunk_idx_str)  # e.g., 2
   if chunk_idx < len(source_chunks):
       chunk = source_chunks[chunk_idx]  # source_chunks[2] = 3rd chunk in array
       chunk_metadata = {
           'chunk_index': chunk.get('chunk_index'),  # Database index (e.g., 7)
           'page_number': chunk.get('page_number'),  # e.g., 4
           'bbox': chunk.get('bbox'),  # BBOX from database
       }
   ```

**Key Point**: `chunk_idx` from `[CHUNK:2]` maps to `source_chunks[2]` (array position)

---

### Step 5: Frontend Citation Click (`SideChatPanel.tsx`)

**Location**: `frontend-ts/src/components/SideChatPanel.tsx:1528-1645`

1. User clicks citation `[1]`
2. Frontend receives `citations_data['1']` with:
   ```typescript
   {
     'matched_chunk_metadata': {
       'bbox': { left: 0.1, top: 0.07, width: 0.70, height: 0.15, page: 4 },
       'chunk_index': 7,
       'page_number': 4
     }
   }
   ```

3. Frontend opens document and highlights using the BBOX

---

## THE PROBLEM

### Issue 1: LLM May Not Output Citations
- If LLM doesn't output `[CHUNK:X]`, we fallback to smart matching
- But smart matching might pick the wrong chunk

### Issue 2: BBOX May Not Cover Exact Text
- The BBOX stored in database is an **aggregate** of all blocks in the chunk
- But the chunk might contain multiple paragraphs
- The specific figure "£2,400,000" might be in a small part of that chunk
- The BBOX covers the entire chunk, not just the figure

### Issue 3: Chunk Splitting
- Original Reducto chunks are split into sub-chunks for embedding
- Each sub-chunk gets a BBOX from one block
- But the LLM sees the merged content, not individual sub-chunks
- So the BBOX might be from a different sub-chunk than the one containing the figure

---

## ROOT CAUSE ANALYSIS

**The fundamental issue**: The BBOX stored in the database represents the **entire chunk's bounding box**, but the LLM is citing information from a **specific part** of that chunk (e.g., just the price figure).

**Example**:
- Chunk 7 contains: "There was an offer that was rejected at £2,300,000... There was a price reduction on 20th December to £2,400,000. The Selling Agent has reported that the Property is now under offer at £2,400,000 as of 9th February 2024."
- BBOX covers: The entire paragraph (70% width, 15% height)
- But "£2,400,000" is only a small part of that paragraph
- The highlight shows the whole paragraph, not just the figure

---

## SOLUTION APPROACHES

### Option 1: Block-Level Citations (Best) ✅ RECOMMENDED
- Store individual block BBOXes in `source_chunks_metadata`
- When LLM cites a chunk, find which block contains the cited information
- Use that specific block's BBOX for highlighting

**Implementation**:
1. In `retrieval_nodes.py`, include `blocks` in `source_chunks_metadata`
2. In `views.py` citation parsing, when `[CHUNK:X]` is found:
   - Extract the context around the citation (e.g., "£2,400,000[CHUNK:2]")
   - Search chunk's blocks for that value/text
   - Use matching block's BBOX instead of chunk aggregate

### Option 2: Content-Based BBOX Refinement (Simpler)
- When parsing citations, search the chunk content for the exact text/value
- Query database for blocks containing that text
- Use that block's BBOX instead of the chunk aggregate

### Option 3: Improve LLM Citation Precision
- Instruct LLM to cite at block level: `[CHUNK:2:BLOCK:5]`
- Map block citations to specific block BBOXes

---

## CURRENT STATE

✅ **Working**:
- Chunks are correctly marked with `[CHUNK:X]`
- Citations are parsed correctly
- BBOXes are mapped to the right chunks
- Frontend highlights the correct page

❌ **Not Working**:
- BBOX highlights the entire chunk, not the specific figure/text
- The highlight is too large and doesn't point to "£2,400,000" precisely

---

## SOLUTION IMPLEMENTED ✅

### Block-Level BBOX Matching

**Location**: `backend/views.py:1365-1405`

When parsing `[CHUNK:X]` citations:

1. **Extract citation context**: Find the text/value immediately before the citation
   - Example: `"£2,400,000[CHUNK:2]"` → extracts `"£2,400,000"`

2. **Query document's `reducto_chunks`**: Fetch blocks from `documents.document_summary.reducto_chunks`

3. **Find matching block**: Search blocks within the cited chunk for the extracted value

4. **Use block's BBOX**: If found, use the block's precise BBOX instead of chunk aggregate

**Code**:
```python
# Extract context around citation
citation_match = re.search(r'([£$€]?[\d,]+(?:\.\d+)?|[\w\s]{5,30})\[CHUNK:' + str(chunk_idx) + r'\]', full_summary)
if citation_match:
    citation_context = citation_match.group(1).strip()
    
    # Query reducto_chunks for block-level BBOX
    doc_result = supabase.table('documents').select('document_summary').eq('id', doc_id).single().execute()
    reducto_chunks = doc_result.data['document_summary'].get('reducto_chunks', [])
    
    # Find block containing the cited value
    for block in blocks:
        if citation_context.lower() in block_content.lower():
            precise_bbox = block.get('bbox')  # Use block BBOX
            break
```

**Result**: 
- ✅ Highlights the exact block containing "£2,400,000"
- ✅ Instead of highlighting the entire chunk paragraph
- ✅ Precise, accurate BBOX pointing to the cited information


# Merge Plan: feature/citation-mapping → feature/speed-accuracy-improvement-needs-works

## Objective
Merge citation-mapping features while **prioritizing our speed improvements** (document caching, property context handling, improved prompts).

## Strategy
1. **Keep our speed improvements** in conflict resolution
2. **Add citation mapping features** from citation-mapping branch
3. **Integrate both** without breaking functionality

---

## Files to PRIORITIZE (Keep Our Changes)

### Speed Improvement Files (MUST KEEP):
1. **`backend/llm/nodes/retrieval_nodes.py`**
   - ✅ KEEP: `check_cached_documents()` function (lines ~277-360)
   - ✅ KEEP: Enhanced `_extract_property_context()` functions
   - ✅ KEEP: `query_vector_documents()` optimization (skip if cached)
   - ⚠️ MERGE: Add citation mapping if present in citation-mapping branch

2. **`backend/llm/graphs/main_graph.py`**
   - ✅ KEEP: `check_cached_documents` node (line 155)
   - ✅ KEEP: Edge from START → check_cached_documents → rewrite_query
   - ⚠️ MERGE: Add citation mapping nodes/routing if present

3. **`backend/llm/prompts.py`**
   - ✅ KEEP: All our prompt improvements (valuation extraction, semantic authority, comprehensive search)
   - ✅ KEEP: Property context extraction improvements
   - ⚠️ MERGE: Add citation-related prompts if present

4. **`backend/llm/utils/system_prompts.py`**
   - ✅ KEEP: Our improvements to rewrite and analyze prompts
   - ⚠️ MERGE: Citation-related system prompts if present

5. **`backend/llm/nodes/detail_level_detector.py`**
   - ✅ KEEP: This entire file (exists in our branch, deleted in citation-mapping)

6. **`backend/llm/utils/section_header_detector.py`** & **`section_header_matcher.py`**
   - ✅ KEEP: These files (exist in our branch, deleted in citation-mapping)

7. **`DOCUMENT_PROCESSING_FLOW.md`**
   - ✅ KEEP: This file (exists in our branch, deleted in citation-mapping)

---

## Files to ADD from citation-mapping

### New Citation Mapping Files (MUST ADD):
1. **`backend/llm/citation_mapping.py`** (NEW)
   - Add: Citation mapping service for block ID to bbox coordinates

2. **`backend/llm/tools/citation_mapping.py`** (NEW)
   - Add: Citation mapping tool for LLM

3. **`backend/llm/utils/block_id_formatter.py`** (NEW)
   - Add: Block ID formatting utilities

4. **`backend/llm/nodes/routing_nodes.py`** (NEW)
   - Add: Routing nodes (if different from our implementation)

---

## Files to MERGE (Resolve Conflicts Carefully)

### High Priority Merges:
1. **`backend/llm/nodes/summary_nodes.py`**
   - KEEP: Our conversation history improvements
   - ADD: Citation mapping integration if present
   - Strategy: Merge both features

2. **`backend/llm/nodes/processing_nodes.py`**
   - KEEP: Our improvements
   - ADD: Citation mapping in document processing if present
   - Strategy: Merge both features

3. **`backend/llm/types.py`**
   - KEEP: Our state improvements
   - ADD: Citation-related types if present
   - Strategy: Merge both

4. **`backend/views.py`**
   - KEEP: Our streaming improvements
   - ADD: Citation mapping endpoints if present
   - Strategy: Merge both

5. **`backend/llm/retrievers/*.py`**
   - KEEP: Our retrieval improvements
   - ADD: Citation-related metadata if present
   - Strategy: Merge both

---

## Merge Steps

### Step 1: Create Merge Branch
```bash
git checkout feature/speed-accuracy-improvement-needs-works
git checkout -b feature/merge-citation-with-speed-improvements
```

### Step 2: Merge citation-mapping
```bash
git merge origin/feature/citation-mapping --no-commit
```

### Step 3: Resolve Conflicts (Priority Order)

#### 3.1 Speed-Critical Files (Keep Ours)
- `backend/llm/nodes/retrieval_nodes.py` → Keep our `check_cached_documents` and merge citation features
- `backend/llm/graphs/main_graph.py` → Keep our caching node, add citation nodes
- `backend/llm/prompts.py` → Keep our improvements, add citation prompts

#### 3.2 Add New Citation Files
- Add all new citation mapping files
- Ensure imports are correct

#### 3.3 Merge Other Files
- Resolve conflicts favoring our speed improvements
- Add citation features where they don't conflict

### Step 4: Integration
- Ensure citation mapping works with document caching
- Test that cached documents can still use citation mapping
- Verify graph flow: check_cached_documents → (if cached, skip to process) → citation mapping

### Step 5: Testing
- Test document caching still works
- Test citation mapping works
- Test both together
- Verify no regressions

### Step 6: Commit and Push
```bash
git commit -m "Merge citation-mapping with speed improvements

- Preserved document caching system (check_cached_documents)
- Added citation mapping features (citation_mapping.py, tools, block_id_formatter)
- Integrated citation mapping with caching flow
- Maintained all speed optimizations and prompt improvements"
git push origin feature/merge-citation-with-speed-improvements
```

---

## Conflict Resolution Rules

1. **Speed improvements ALWAYS win** in conflicts with citation-mapping
2. **Citation features are ADDITIVE** - add them alongside our improvements
3. **Graph structure**: Keep our caching node, add citation nodes after
4. **Prompts**: Keep our improvements, add citation instructions
5. **Types**: Merge both sets of type definitions

---

## Key Integration Points

1. **Document Caching + Citation Mapping**:
   - Cached documents should still support citation mapping
   - Citation block IDs should work with cached document metadata

2. **Graph Flow**:
   ```
   START → check_cached_documents → rewrite_query → ...
   If cached: skip retrieval → process_documents (with citation mapping) → summarize
   If not cached: normal flow → process_documents (with citation mapping) → summarize
   ```

3. **Metadata Preservation**:
   - Ensure citation mapping metadata (block IDs, bbox) is preserved in cached documents
   - Citation lookup tables should work with cached document state

---

## Testing Checklist

- [ ] Document caching works for follow-up questions
- [ ] Citation mapping works for new queries
- [ ] Citation mapping works with cached documents
- [ ] Property context extraction still works
- [ ] Valuation extraction improvements still work
- [ ] No performance regressions
- [ ] Graph executes correctly with both features

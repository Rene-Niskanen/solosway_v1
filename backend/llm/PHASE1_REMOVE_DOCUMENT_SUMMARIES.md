# Phase 1: Remove Document Summaries from Retrieval Tool

## 🎯 Objective
Remove the `summary` field from `retrieve_documents` tool output to force the LLM to call `retrieve_chunks` before answering.

**Why this works**: If the LLM has NO content from document retrieval, it physically cannot answer without retrieving chunks.

---

## 📊 Impact Assessment

**Before:**
```json
{
  "document_id": "53a9450a...",
  "filename": "Letter_of_Offer_Chandni.docx",
  "document_type": "other_documents",
  "score": 0.4404,
  "summary": "This document confirms the acceptance of an offer to purchase property..."
                ↑ LLM uses this to answer without calling retrieve_chunks!
}
```

**After:**
```json
{
  "document_id": "53a9450a...",
  "filename": "Letter_of_Offer_Chandni.docx",
  "document_type": "other_documents",
  "score": 0.4404
  // No summary = LLM MUST call retrieve_chunks to get content
}
```

---

## 🛠️ Implementation Steps

### Step 1: Locate Summary Fields (5 mins)

**File**: `backend/llm/tools/document_retriever_tool.py`

**Three locations to modify:**

1. **Line ~290** (Vector results processing)
2. **Line ~350** (Keyword results processing)
3. **Line ~395** (Final combined results)

---

### Step 2: Remove Summary from Vector Results (~Line 290)

**Current code:**
```python
{
    'document_id': doc_id,
    'filename': doc.get('original_filename', 'unknown'),
    'document_type': doc.get('classification_type'),
    'vector_score': float(doc.get('similarity', 0.0)),
    'keyword_score': 0.0,
    'summary': (doc.get('summary_text', '') or '')[:200]  # ← REMOVE THIS LINE
}
```

**New code:**
```python
{
    'document_id': doc_id,
    'filename': doc.get('original_filename', 'unknown'),
    'document_type': doc.get('classification_type'),
    'vector_score': float(doc.get('similarity', 0.0)),
    'keyword_score': 0.0
    # Summary removed - LLM must retrieve chunks to get content
}
```

---

### Step 3: Remove Summary from Keyword Results (~Line 350)

**Current code:**
```python
{
    'document_id': doc_id,
    'filename': doc.get('original_filename', 'unknown'),
    'document_type': doc.get('classification_type'),
    'vector_score': 0.0,
    'keyword_score': keyword_score,
    'summary': (doc.get('summary_text', '') or '')[:200]  # ← REMOVE THIS LINE
}
```

**New code:**
```python
{
    'document_id': doc_id,
    'filename': doc.get('original_filename', 'unknown'),
    'document_type': doc.get('classification_type'),
    'vector_score': 0.0,
    'keyword_score': keyword_score
    # Summary removed - LLM must retrieve chunks to get content
}
```

---

### Step 4: Remove Summary from Combined Results (~Line 395)

**Current code:**
```python
results.append({
    'document_id': doc_id,
    'filename': doc_data['filename'],
    'document_type': doc_data['document_type'],
    'score': round(combined_score, 4),
    'vector_score': round(doc_data['vector_score'], 4),
    'keyword_score': round(doc_data['keyword_score'], 4),
    'summary': doc_data['summary']  # ← REMOVE THIS LINE
})
```

**New code:**
```python
results.append({
    'document_id': doc_id,
    'filename': doc_data['filename'],
    'document_type': doc_data['document_type'],
    'score': round(combined_score, 4),
    'vector_score': round(doc_data['vector_score'], 4),
    'keyword_score': round(doc_data['keyword_score'], 4)
    # Summary removed - LLM must retrieve chunks to get content
})
```

---

### Step 5: Update Tool Documentation (~Line 615)

**Current documentation:**
```
## RETURN VALUE
List of documents with:
- document_id: UUID of the document
- filename: Original filename
- document_type: Classification type (e.g., "valuation_report")
- score: Combined relevance score (0.0-1.0)
- vector_score: Semantic similarity score
- keyword_score: Keyword match score
- summary: Brief summary of the document  # ← REMOVE THIS LINE
```

**New documentation:**
```
## RETURN VALUE
List of documents with:
- document_id: UUID of the document (for use with retrieve_chunks)
- filename: Original filename
- document_type: Classification type (e.g., "valuation_report")
- score: Combined relevance score (0.0-1.0)
- vector_score: Semantic similarity score
- keyword_score: Keyword match score

**NOTE**: This tool returns metadata only. Use retrieve_chunks() to get actual document content.
```

---

## 🧪 Testing Plan

### Test 1: Verify Tool Still Works
```python
# Test the tool directly
from backend.llm.tools.document_retriever_tool import create_document_retrieval_tool

tool = create_document_retrieval_tool(
    business_id="test-business-id",
    user_id="test-user-id"
)

result = tool.invoke({
    "query": "property valuation",
    "query_type": "specific"
})

# Expected: List of documents WITHOUT summary field
print(result)
```

**Expected output:**
```json
[
  {
    "document_id": "...",
    "filename": "...",
    "document_type": "valuation_report",
    "score": 0.85,
    "vector_score": 0.80,
    "keyword_score": 0.90
    // No 'summary' key
  }
]
```

---

### Test 2: Verify LLM Behavior Change

**Test Query**: "What is the value of the offer from Chandni?"

**Expected Flow:**

**Before Phase 1:**
```
1. User asks question
2. Agent calls retrieve_documents
   → Returns: metadata + summary
3. Agent answers using summary ❌ (bypasses chunks)
4. Response includes document metadata
```

**After Phase 1:**
```
1. User asks question
2. Agent calls retrieve_documents
   → Returns: metadata only (no summary)
3. Agent realizes it has no content
4. Agent calls retrieve_chunks ✅
   → Returns: actual document text
5. Agent answers from chunk content
6. Response is clean (no metadata shown per previous fix)
```

---

### Test 3: Integration Test with Full Chat

**Test in UI:**

1. Start new chat
2. Ask: "Can you give me the value of the offer from Chandni?"
3. Check Docker logs for tool calls:
   - Should see: `retrieve_documents` → `retrieve_chunks` → answer
   - Should NOT see: `retrieve_documents` → answer (skipping chunks)

**Success Criteria:**
- ✅ `retrieve_chunks` is ALWAYS called after `retrieve_documents` for content questions
- ✅ Agent cannot answer without chunk content
- ✅ Responses are still accurate (pulled from chunks)

---

## 📈 Expected Behavior Changes

### Scenario 1: Specific Question
**Query**: "What is the deposit amount?"

**OLD Behavior:**
```
Agent: *calls retrieve_documents*
Agent: *sees summary: "...deposit of 10%..."*
Agent: "The deposit is 10%" ❌ (vague, from summary)
```

**NEW Behavior:**
```
Agent: *calls retrieve_documents*
Agent: *sees only metadata, no content*
Agent: *calls retrieve_chunks*
Agent: *reads actual text*
Agent: "The deposit is Kshs. 11,700,000 (10% of purchase price)" ✅ (specific, from chunks)
```

---

### Scenario 2: Broad Question
**Query**: "Tell me about the Chandni offer"

**OLD Behavior:**
```
Agent: *calls retrieve_documents*
Agent: *answers from summary*
Agent: "This document confirms acceptance of offer..." ❌ (surface-level)
```

**NEW Behavior:**
```
Agent: *calls retrieve_documents*
Agent: *no content to summarize*
Agent: *calls retrieve_chunks*
Agent: *reads full details*
Agent: "The offer is for 3 plots at 90 Banda Lane. Sale price: Kshs. 117,000,000. Key terms: [detailed list]" ✅ (comprehensive)
```

---

### Scenario 3: Document List Query (Special Case)
**Query**: "What documents do you have?"

**OLD Behavior:**
```
Agent: *calls retrieve_documents*
Agent: Lists documents with summaries
```

**NEW Behavior:**
```
Agent: *calls retrieve_documents*
Agent: Lists documents (no summaries shown, per Phase 0 fix)
```

**Note**: This scenario doesn't need chunks because user only asked for document list, not content.

---

## ⚠️ Potential Issues & Solutions

### Issue 1: Agent Confusion
**Problem**: Agent might not know what to do with metadata-only results.

**Solution**: The existing prompt already tells the agent:
```
"Document metadata is ONLY for identifying which documents to read"
"YOU MUST ALWAYS CALL retrieve_chunks AFTER retrieve_documents"
```

This is already in place from the previous fix!

---

### Issue 2: Performance Impact
**Problem**: Extra `retrieve_chunks` call might slow responses.

**Reality Check**:
- Current: ~2-3 seconds for retrieve_documents, then answer (FAST but WRONG)
- New: ~2-3 seconds for retrieve_documents, ~2-3 seconds for retrieve_chunks, then answer (SLOWER but CORRECT)
- **Total increase**: ~2-3 seconds

**Verdict**: Acceptable trade-off for accuracy. Users prefer correct slow answers over fast incorrect ones.

---

### Issue 3: Tool Description Mismatch
**Problem**: Tool description still mentions summary in examples.

**Solution**: Already covered in Step 5 - update documentation strings.

---

## 🎯 Success Criteria

**Phase 1 is complete when:**

1. ✅ All 3 locations in `document_retriever_tool.py` have `summary` field removed
2. ✅ Tool documentation updated to reflect metadata-only return
3. ✅ Direct tool test shows no `summary` key in results
4. ✅ Integration test shows `retrieve_chunks` is called after `retrieve_documents`
5. ✅ User-facing responses are accurate and pulled from chunk content

---

## 🚀 Rollout Plan

### Pre-deployment Checklist
- [ ] Code changes made (3 locations + documentation)
- [ ] Direct tool test passes
- [ ] Integration test with sample queries passes
- [ ] Docker logs show correct tool call sequence
- [ ] User-facing responses are accurate

### Deployment
1. Apply changes to `document_retriever_tool.py`
2. Restart Docker container: `docker-compose restart web`
3. Test with 3-5 sample queries
4. Monitor logs for unexpected behavior
5. If issues: Revert and debug
6. If success: Document completion and move to Phase 2

---

## 📝 Implementation Checklist

```
Phase 1: Remove Document Summaries
├─ [ ] Step 1: Locate summary fields (Line 290, 350, 395)
├─ [ ] Step 2: Remove from vector results (~Line 290)
├─ [ ] Step 3: Remove from keyword results (~Line 350)
├─ [ ] Step 4: Remove from combined results (~Line 395)
├─ [ ] Step 5: Update tool documentation (~Line 615)
├─ [ ] Test 1: Direct tool test (verify no summary field)
├─ [ ] Test 2: Integration test (verify retrieve_chunks called)
├─ [ ] Test 3: UI test (verify accurate responses)
└─ [ ] Document completion (update this file with results)
```

---

## 📌 Quick Reference

**File to modify**: `backend/llm/tools/document_retriever_tool.py`

**Lines to change**:
- ~Line 290: Remove `'summary': ...` from vector results dict
- ~Line 350: Remove `'summary': ...` from keyword results dict  
- ~Line 395: Remove `'summary': ...` from final results append
- ~Line 615: Update documentation to remove summary description

**Time estimate**: 15-20 minutes
**Risk level**: Low (only removes a field, doesn't change logic)
**Rollback**: Easy (just re-add the lines)

---

## 🎓 Learning Points

**Why this works:**
- RAG systems need a "forcing function" to ensure proper retrieval
- Removing content from metadata makes two-phase retrieval mandatory
- Prompts alone are not enough - architecture must enforce the rule

**Key insight:**
"If the agent has no content, it cannot answer. Simple as that."

---

## ✅ Completion Criteria

Mark Phase 1 as complete when:
1. All code changes applied
2. All tests passing
3. User queries correctly trigger `retrieve_documents` → `retrieve_chunks` → answer flow
4. No regression in existing functionality

**Next step**: Move to Phase 2 (Add chunk presence guardrail)

---

## 📅 Implementation Date: _____________

**Implemented by**: _____________
**Tested by**: _____________
**Status**: ⬜ Not Started | ⬜ In Progress | ⬜ Complete | ⬜ Verified

---

## 📊 Results Log

### Before Phase 1:
- Queries answered without chunks: _____%
- Average response time: _____ seconds
- Accuracy issues reported: _____

### After Phase 1:
- Queries answered without chunks: _____%
- Average response time: _____ seconds
- Accuracy improvement: _____

---

**End of Phase 1 Implementation Guide**


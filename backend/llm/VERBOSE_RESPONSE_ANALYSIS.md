# 🔍 Verbose Response Analysis - Why Agent Gives Full Summaries

**Date**: 2026-01-20  
**Issue**: Agent provides comprehensive document summaries instead of concise, direct answers

---

## 📊 **Your Example**

### User Question:
```
What is the value mentioned in the letter of offer from chandni?
```

### Expected Answer:
```
Kshs. 117,000,000
```

### Actual Agent Response:
```
Here are the details from the letter of offer related to Chandni:

### Document: Letter of Offer from Chandni Solenki
- **Date:** 29th July 2023
- **Subject:** Sale of 3 x ½ Acre Plots - 5, 6 & 7 of L.R. Number 7792/2, 90 Banda Lane, Nairobi
- **Offer Accepted:** Kenya Shillings One Hundred & Seventeen Million (Kshs. 117,000,000)

### Key Terms and Conditions:
- Property: Plots 5, 6 & 7 of L.R. Number 7792/2, 90 Banda Lane, Nairobi
- Vendor: Guy & Marian Lawrence
- Vendor's Advocates: Bowmans Law (Coulson & Harney LLP)
- Vendor's Agent: Knight Frank Kenya Limited
- Purchasers: Chandni & Bharti Solanki
- Purchaser's Advocates: Taibjee & Bhalla Advocates
- Payment: All payments should be made in Kenya Shillings through Electronic Funds Wire Transfers to the Vendor's Advocates.

### Sale Price: Kshs. 117,000,000

### Mode of Payment:
- A deposit of 10% (Kshs. 11,700,000) is payable upon signing the Sale Agreement.
- The remaining 90% (Kshs. 105,300,000) is to be paid upon transfer of the title.

### Possession: Upon receipt of the entire price and full payment of costs.

### Completion Date: 30 Days from signing the Sale Agreement.

### Stamp Duty and Legal Fees: Each party is responsible for their own legal fees; the Purchaser will pay stamp duty and registration fees.

### Property Income: All rental income from the property will be due to the Vendor until completion of the sale.

### Confirmation: Acceptance of the letter must be confirmed by signing and returning two copies by 4th August 2023.

### Contact Information:
- Vendor's Agent: Tarquin Gross – Head of Residential Agency, Knight Frank Kenya Limited

If you need further details or specific sections from the document, feel free to ask!
```

**Issue**: User asked for "the value", agent provided entire document breakdown.

---

## 🎯 **Root Causes - Locations in Code**

### **1. System Prompt - BASE_ROLE (Encourages Detail)**

**File**: `backend/llm/utils/system_prompts.py`  
**Line**: 24

```python
CORE PRINCIPLES:
...
4. **Document-Based Reasoning**: Identify relevant passages, summarize them, reason step-by-step, provide final answer.
                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

**Issue**: Tells LLM to "summarize" passages, which encourages comprehensive responses.

---

### **2. 'analyze' Task Guidance (Most Critical Issue)**

**File**: `backend/llm/utils/system_prompts.py`  
**Lines**: 86-106

```python
'analyze': """Task: Answer question about a single document excerpt.

Guidelines:
- Answer ONLY from document content. Start directly with the answer - do NOT repeat the question.
- Always search through the entire excerpt, even after finding initial matches.
- Search comprehensively - information may appear in multiple sections or on different pages.
- For specific information (values, names, dates), search the entire document.

**CRITICAL**: Distinguish between marketing prices and professional valuations:
- Marketing prices (guide prices, "under offer" prices) are NOT professional valuations.
- Professional valuations (formal "Market Value" opinions) are authoritative.
- When asked about "value" or "valuation", prioritize professional valuations over marketing prices.
- "Under offer" prices are NEVER the Market Value - continue searching for the formal assessment.

**MUST**: Use semantic authority detection - prioritize professional assessment language over market activity descriptions.
**MUST**: Search thoroughly for names - use synonyms (valuer/appraiser/surveyor/inspector/MRICS/FRICS) and action phrases ("conducted by", "valued by").
**MUST**: Always include names and professional information when present.
**MUST**: If document starts with "PROPERTY DETAILS (VERIFIED FROM DATABASE):", that section contains VERIFIED property information.
**MUST**: Provide comprehensive answers with all relevant details - include all information that answers the question, not just a brief summary.
          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
**MUST**: Say "No relevant information in this excerpt" ONLY after thoroughly searching the entire excerpt.
**MUST**: Do NOT suggest external sources, add "Additional Context" sections, next steps, or unsolicited insights."""
```

**Issue - Line 104**: 
```
**MUST**: Provide comprehensive answers with all relevant details - include all information that answers the question, not just a brief summary.
```

**This is the main culprit.** It explicitly tells the LLM to:
1. ✅ Provide **comprehensive** answers
2. ✅ Include **all relevant details**
3. ❌ **NOT** just a brief summary

**Result**: LLM gives you the entire document breakdown, not just the requested value.

---

### **3. Agent Node Initial Prompt (Neutral - Not the Issue)**

**File**: `backend/llm/nodes/agent_node.py`  
**Lines**: 110-122

```python
initial_prompt = f"""USER QUERY: {user_query}

INSTRUCTIONS:
1. Decide your strategy based on the query
2. Call tools to retrieve information:
   - retrieve_documents(query, broad=True/False) - Find relevant documents
   - retrieve_chunks(doc_id, query) - Get text from known documents
3. You will see tool results in the conversation
4. Evaluate result quality:
   - If results are poor/empty, retry with a rewritten query
   - If results are good, generate your final answer directly

Think step-by-step. You control the entire retrieval process."""
```

**Assessment**: This is **neutral** - it doesn't encourage or discourage verbosity. It just tells the agent to generate a "final answer" after retrieval.

---

### **4. Extract Final Answer (Just a Passthrough - Not the Issue)**

**File**: `backend/llm/graphs/main_graph.py`  
**Lines**: 469-485

```python
def extract_final_answer(state: MainWorkflowState) -> MainWorkflowState:
    """
    Extract final answer from agent's last message.
    
    This is NOT manual extraction of tool results - it's just formatting
    the final output for the API response.
    """
    messages = state.get("messages", [])
    
    if messages:
        last_message = messages[-1]
        if hasattr(last_message, 'content') and last_message.content:
            logger.info(f"[EXTRACT_FINAL] Extracted final answer ({len(last_message.content)} chars)")
            return {"final_summary": last_message.content}
    
    logger.warning("[EXTRACT_FINAL] No final answer found in messages")
    return {"final_summary": "I apologize, but I couldn't generate a response."}
```

**Assessment**: This just **extracts** the agent's last message content. It doesn't modify or add to it. The verbosity is already present in the agent's message.

---

## 🎯 **Why This Happens**

### The LLM's Reasoning Chain:

1. **System Prompt** (from `get_system_prompt('analyze')` at line 108 in `agent_node.py`):
   ```
   BASE_ROLE: "Document-Based Reasoning: Identify relevant passages, summarize them..."
   TASK_GUIDANCE['analyze']: "Provide comprehensive answers with all relevant details..."
   ```

2. **User Query**:
   ```
   "What is the value mentioned in the letter of offer from chandni?"
   ```

3. **Tool Retrieval**:
   - Agent calls `retrieve_documents()` → Finds "Letter_of_Offer_Chandni_Solenki_on_Banda_Lane.docx"
   - Agent calls `retrieve_chunks()` → Gets full document chunk with all details

4. **Agent's Internal Reasoning** (influenced by prompts):
   ```
   System says: "Provide COMPREHENSIVE answers with ALL relevant details"
   System says: "Identify relevant passages, SUMMARIZE them"
   System says: "Include all information that answers the question, NOT just a brief summary"
   
   User asked about: "value"
   Document contains: Value, payment terms, parties, dates, conditions, etc.
   
   Decision: I should provide ALL of this information comprehensively! ✅
   ```

5. **Result**: Full document summary instead of just "Kshs. 117,000,000"

---

## 📍 **Summary of Locations**

| Location | File | Lines | Issue |
|----------|------|-------|-------|
| **1. BASE_ROLE** | `backend/llm/utils/system_prompts.py` | 14-55 | Line 24: "summarize them" |
| **2. 'analyze' TASK_GUIDANCE** | `backend/llm/utils/system_prompts.py` | 86-106 | **Line 104: "Provide comprehensive answers with all relevant details - NOT just a brief summary"** ← **MAIN CULPRIT** |
| 3. Agent Initial Prompt | `backend/llm/nodes/agent_node.py` | 110-122 | Neutral (not encouraging verbosity) |
| 4. Extract Final Answer | `backend/llm/graphs/main_graph.py` | 469-485 | Just a passthrough (not modifying response) |

---

## 🛠️ **What Needs to Change**

### **Critical Fix**: Line 104 in `backend/llm/utils/system_prompts.py`

**Current**:
```python
**MUST**: Provide comprehensive answers with all relevant details - include all information that answers the question, not just a brief summary.
```

**Should be**:
```python
**MUST**: Answer the question directly and concisely. For specific information requests (values, names, dates), provide ONLY what was asked - do not include additional details unless requested.
```

### **Secondary Fix**: Line 24 in `backend/llm/utils/system_prompts.py`

**Current**:
```python
4. **Document-Based Reasoning**: Identify relevant passages, summarize them, reason step-by-step, provide final answer.
```

**Should be**:
```python
4. **Document-Based Reasoning**: Identify relevant passages, extract the answer, provide concise response.
```

---

## 🎯 **Expected Behavior After Fix**

### User Question:
```
What is the value mentioned in the letter of offer from chandni?
```

### Expected Agent Response:
```
The value mentioned in the letter of offer from Chandni is **Kshs. 117,000,000** (Kenya Shillings One Hundred & Seventeen Million).
```

**Or even more concise**:
```
Kshs. 117,000,000
```

---

## 🔍 **Why LLM is "Willingly" Doing This**

**It's NOT willingly doing it** - it's following instructions!

The prompts explicitly tell it to:
1. ✅ "Summarize passages"
2. ✅ "Provide comprehensive answers"
3. ✅ "Include ALL relevant details"
4. ❌ "NOT just a brief summary"

**Conclusion**: The LLM is a good student following bad instructions. Fix the instructions, fix the behavior.

---

## 🎉 **Next Steps**

1. **Update** `backend/llm/utils/system_prompts.py` line 104 to encourage conciseness
2. **Update** `backend/llm/utils/system_prompts.py` line 24 to remove "summarize" language
3. **Test** with your "Chandni" query to verify concise responses
4. **Monitor** other queries to ensure quality doesn't degrade

---

**The fix is simple: change 2 lines in `system_prompts.py` to stop encouraging verbosity!** 🎯


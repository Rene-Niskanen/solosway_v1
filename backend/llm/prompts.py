"""
Centralized prompt templates for all LLM agents in the system.

This file contains human message content templates (task-specific instructions and examples).
System-level prompts are handled separately in backend.llm.utils.system_prompts.

This file ensures:
- Consistency across agents
- Easy maintenance and updates
- Better accuracy through prompt engineering
- Version control of prompt changes
"""

# ============================================================================
# QUERY REWRITING PROMPTS
# ============================================================================

def get_query_rewrite_human_content(user_query: str, conversation_history: str) -> str:
    """
    Human message content for rewriting follow-up or vague user queries.
    System prompt is handled separately via get_system_prompt('rewrite').
    
    Returns:
        Human message content string (without system-level instructions)
    """
    return f"""CONVERSATION HISTORY:
{conversation_history}

CURRENT FOLLOW-UP QUERY:
"{user_query}"

GOAL:
- If the current query refers ambiguously to prior parts of the conversation (e.g., "the document," "that file," "this property," "it," "them"), rewrite it to explicitly include the relevant context (property name/address, document title, features, values, etc.).
- If the query is already sufficiently self-contained and unambiguous, return it **unchanged**.

REWRITE GUIDELINES:
1. Include relevant entities from the conversation:
   - Property address, name, or identifier
   - Document or report name
   - Key property features (e.g., number of bedrooms, valuation, price)
2. Maintain the **user's original intent**. Don't change the meaning, only clarify.
3. Keep the rewritten query concise (preferably under ~200 words).
4. Do **not** add new questions or assumptions not present in the user's query or the conversation.
5. Do **not** include explanations, quotes, or internal commentary.  
6. Return **only** the rewritten query text.

### EXAMPLES:
- Input Query: "What's the appraised value?"  
  Rewritten: "What's the appraised value for the 5-bedroom, 4-bathroom property at Highlands, Berden Road, Bishop's Stortford?"

- Input Query: "Review the document and show me comparable prices"  
  Rewritten: "Review the Highlands_Berden_Bishops_Stortford valuation report and show comparable property sale prices."

- Input Query: "Find me properties with 5 bedrooms in London"  
  (If this is already specific) → Return unchanged.

**Now, provide the rewritten query:**"""


# ============================================================================
# QUERY EXPANSION PROMPTS
# ============================================================================

def get_query_expansion_human_content(original_query: str) -> str:
    """
    Human message content for generating query variations.
    System prompt is handled separately via get_system_prompt('expand').
    
    Returns:
        Human message content string (without system-level instructions)
    """
    return f"""Original Query:
"{original_query}"

GUIDELINES FOR EXPANSION:
1. Use **synonyms** or semantically related terms (e.g., "price" → "market value", "valuation", "asking price").  
2. Provide **related legal or real estate-domain terms** (e.g., "lease" → "rental agreement", "tenancy", "contract").  
3. Add **specification or context** where helpful (e.g., "sale price", "recent sale value", "transaction history").  
4. Use **chain-of-thought style reasoning** or step-by-step thinking (model it in your head) so that your expansions are grounded and reasoned.  
5. Avoid adding irrelevant or speculative terms ("query drift") — stay focused on the domain and the user's likely intent.  
6. Keep each expanded query under **50 words**.

Return **only** the two rewritten query variations, each on its own line, without numbering or explanations.

Variations:"""


# ============================================================================
# QUERY ROUTING PROMPTS
# ============================================================================

def get_query_routing_human_content(user_query: str, conversation_history: str = "") -> str:
    """
    Human message content for classifying query intent.
    System prompt is handled separately via get_system_prompt('classify').
    
    Returns:
        Human message content string (without system-level instructions)
    """
    history_section = f"\n\nConversation History:\n{conversation_history}" if conversation_history else ""
    return f"""Here is the context:  
{history_section}

**Current User Query:**  
"{user_query}"

**CLASSIFY** the intent as exactly one of the following — and return only that word:  
- `semantic`  
- `structured`  
- `hybrid`

Use the definitions below:

- **semantic**: The query seeks descriptive or condition-based information about properties, their defects, features, or qualitative states.  
  *Examples:* "foundation damage", "roof condition", "natural light in living room".

- **structured**: The query seeks explicit, filterable attributes or values (e.g., numerical or categorical).  
  *Examples:* "4 bedrooms", "under $500,000", "built after 2010", "has a pool".

- **hybrid**: The query mixes both descriptive/qualitative and structured/quantitative elements.  
  *Examples:* "4-bed homes with foundation issues", "inspection report for 3-bedroom property with water damage".

**Important:**  
- Focus on the **core informational need** in the user's question.  
- Ignore filler words ("please," "can you," etc.).  
- Do not produce any extra text: return *only* one of the three labels.

**Answer:**"""



# ============================================================================
# LLM SQL QUERY PROMPTS
# ============================================================================

def get_llm_sql_query_human_content(user_query: str) -> str:
    """
    Human message content for generating SQL query parameters.
    System prompt is handled separately via get_system_prompt('sql_query').
    
    Returns:
        Human message content string (without system-level instructions)
    """
    return f"""The user asked:  
"{user_query}"

**Background**:  
- A direct, exact-match SQL query returned no results.  
- Your job is to propose *alternative search criteria* for "similar" properties that are close to the user's intent, not exact duplicates.  
- Use only real estate-relevant attributes (e.g., number of bedrooms, bathrooms, property type, price, size).

**TASK**:  
1. Parse the user query and detect any mention of the following attributes (if present):  
   - Number of bedrooms  
   - Number of bathrooms  
   - Property type (detached, semi-detached, flat, etc.)  
   - Price or value  
   - Size (e.g., square feet / square meters)  

2. For any numeric attribute (bedrooms, bathrooms, price, size), suggest a **range around the target value** (e.g. ± 1 or ± 2 bedrooms, ± 10-20% price, etc.) to broaden the search and capture "similar" listings.

3. Return a **JSON object** (no additional text) with the following structure:

```json
{{
  "number_bedrooms": <int or null>,
  "number_bathrooms": <int or null>,
  "bedroom_range": [<min_int>, <max_int>] or null,
  "bathroom_range": [<min_int>, <max_int>] or null,
  "property_type": "<string or null>",
  "min_price": <float or null>,
  "max_price": <float or null>,
  "min_size_sqft": <float or null>,
  "max_size_sqft": <float or null>
}}```"""


# ============================================================================
# DOCUMENT QA AGENT PROMPTS
# ============================================================================

def get_document_qa_human_content(user_query: str, doc_content: str) -> str:
    """
    Human message content for per-document question answering.
    System prompt is handled separately via get_system_prompt('analyze').
    
    Returns:
        Human message content string (without system-level instructions)
    """
    return f"""Here is the document excerpt:  
```\n{doc_content}\n```

**USER QUESTION:**  
{user_query}

**INSTRUCTIONS & GUIDELINES**  
1. **Thorough Search for Names and Professional Information**  
   - **CRITICAL**: When asked about names (valuer, appraiser, surveyor, inspector, buyer, seller, agent), search the ENTIRE excerpt carefully
   - Look for synonyms: "valuer" = "appraiser" = "surveyor" = "inspector" = "registered valuer" = "MRICS" = "FRICS"
   - Names may appear in different formats: "John Smith", "Smith, John", "J. Smith", "Mr. Smith"
   - Professional qualifications (MRICS, FRICS) often appear with names
   - Search for phrases like "conducted by", "inspected by", "valued by", "prepared by", "author"
   - **Do NOT say "not found" until you have searched the entire excerpt thoroughly**

2. **Use Only Provided Context**  
   - Answer **only** using information in the excerpt above.  
   - **Before saying "not found"**: Re-read the excerpt carefully, looking for:
     - Any mention of the requested information
     - Synonyms or related terms
     - Different phrasings or formats
   - If the excerpt lacks enough evidence after thorough search, respond: **"I do not have complete information in this excerpt."**

3. **Prioritize Verified Property Details**  
   - If the document begins with a **"PROPERTY DETAILS (VERIFIED FROM DATABASE):"** section, that information is definitive.  
     - For questions about property attributes (e.g., bedrooms, bathrooms, size), if the answer is in that section, cite it directly and clearly.  
     - Example: "This property has 5 bedrooms and 3 bathrooms (from the PROPERTY DETAILS section)."  
   - Do **not** claim "no information" when the details are actually present in this verified section.

4. **Comprehensive & Structured Response**  
   - For relevant questions, extract and summarize:  
     - **Names**: Valuers, appraisers, surveyors, inspectors, buyers, sellers, agents, solicitors
     - Key numeric values (e.g., size, dates, price)  
     - Property features (bedrooms, bathrooms, amenities)  
     - Condition, risk, or opportunities (defects, professional assessments)  
     - Location details and connectivity (neighborhood, transport links)  
   - Use a *chain-of-thought style*:  
     1. Identify which parts of the text are relevant  
     2. Search for synonyms and related terms if the exact term isn't found
     3. Summarize or paraphrase those relevant parts  
     4. Then synthesize them into a final, concise answer.

5. **Cite Your Sources Using Chunk Markers** (CRITICAL)
   - The document contains [CHUNK:X:PAGE:Y] markers at the start of each section
   - EVERY fact you state MUST have its own [CHUNK:X] citation immediately after it
   - Place citations DIRECTLY after each specific piece of information:
     ✅ CORRECT: "The valuation is £2,300,000[CHUNK:2] as of 12th February 2024[CHUNK:0]"
     ❌ WRONG: "The valuation is £2,300,000 as of 12th February 2024[CHUNK:2]"
   - Each price, date, name, measurement, or key fact needs its own citation
   - Examples:
     - "5 bedrooms[CHUNK:0] and 3 bathrooms[CHUNK:0], valued at £2.4M[CHUNK:3]"
     - "Inspected on 6th February 2024[CHUNK:1] by John Smith MRICS[CHUNK:1]"

6. **Guard Against Hallucination**  
   - Do **not** guess or invent details not present in the excerpt.  
   - Avoid speculation or external recommendations (websites, agents, market data).

7. **Professional and Clear Tone**  
   - Use a professional, concise, and factual writing style.  
   - Focus on clarity: structured answers help real estate professionals quickly understand.

8. **No Unsolicited Content**  
   - Answer the question directly and stop.
   - Do NOT repeat the user's question as a heading or title - start directly with the answer.
   - Do NOT add "Additional Context" sections - only provide context if explicitly requested.
   - Do NOT add "Next steps:", "Let me know if...", or any follow-up suggestions.
   - Do NOT add unsolicited insights or recommendations.
   - Be prompt and precise: answer what was asked, nothing more.

---

**ANSWER (answer directly, no heading, no additional context, no next steps):**"""  


# ============================================================================
# SUMMARY/AGGREGATION PROMPTS
# ============================================================================

def get_summary_human_content(
    user_query: str,
    conversation_history: str,
    search_summary: str,
    formatted_outputs: str
) -> str:
    """
    Human message content for creating the final unified summary.
    System prompt is handled separately via get_system_prompt('summarize').
    
    Returns:
        Human message content string (without system-level instructions)
    """
    return f"""**USER QUESTION:**  
"{user_query}"

**CONVERSATION HISTORY:**  
{conversation_history}

**RETRIEVAL SUMMARY (how documents were found):**  
{search_summary}

**DOCUMENT CONTENT EXTRACTS (formatted):**  
{formatted_outputs}

---

### INSTRUCTIONS:

1. **Thorough Search for Names and Professional Information**  
   - **CRITICAL**: When asked about names (valuer, appraiser, surveyor, inspector, buyer, seller, agent), search ALL document excerpts carefully
   - Look for synonyms: "valuer" = "appraiser" = "surveyor" = "inspector" = "registered valuer" = "MRICS" = "FRICS"
   - Names may appear in different formats: "John Smith", "Smith, John", "J. Smith", "Mr. Smith"
   - Professional qualifications (MRICS, FRICS) often appear with names
   - Search for phrases like "conducted by", "inspected by", "valued by", "prepared by", "author"
   - **Do NOT say "not found" until you have searched all document excerpts thoroughly**

2. **Answer Directly & Professionally**  
   - Lead with the **direct answer** to the user's question.
   - Use **bold text** for key facts, figures, names, and values (e.g., **£1,250,000**, **MT Finance Ltd**)
   - Keep answers concise but complete - typically 1-3 sentences for simple queries.
   - **Before saying "not found"**: Re-read all document excerpts carefully for synonyms and related terms.

3. **Use Verified Property Details First**  
   - If any document excerpt includes a **"PROPERTY DETAILS (VERIFIED FROM DATABASE)"** section, treat that as authoritative.

4. **Professional Formatting**  
   - Start with the main answer/fact using bold for emphasis
   - If multiple items, use a brief bullet list
   - Cite the source document inline: "According to the Valuation Report..."
   - Keep the response structured and scannable for professionals

5. **Cite Document Sources**  
   - Reference documents naturally in the answer (e.g., "The Letter of Offer states...")
   - For key facts, mention where they were found

6. **Admit Uncertainty**  
   - If information is not found AFTER thorough search, respond with:  
     `"No documents in the system contain this information."`

7. **Tone & Style**  
   - Professional, factual, and confident
   - Write like a knowledgeable real estate assistant
   - Avoid hedging language ("I think", "It appears") when the information is clear

8. **No Unsolicited Content**  
   - Answer the question directly and stop
   - Do NOT repeat the user's question as a heading
   - Do NOT add "Additional Context", "Next steps:", or "Let me know if..." sections
   - Do NOT ask if the user needs more information
   - Be direct and precise: answer what was asked, nothing more

---

**Now provide your answer (start directly with the answer, use bold for key facts, no heading):**"""



# ============================================================================
# RERANKING PROMPTS
# ============================================================================

def get_reranking_human_content(user_query: str, doc_summary: str) -> str:
    """
    Human message content for reranking documents by relevance.
    System prompt is handled separately via get_system_prompt('rank').
    
    Returns:
        Human message content string (without system-level instructions)
    """
    return f"""**USER QUERY:**  
"{user_query}"

**DOCUMENT CANDIDATES:**  
{doc_summary}

**CONSIDER THE FOLLOWING FACTORS:**  
1. How directly the document addresses the user's question.  
2. The importance of the document type (e.g., valuation report, inspection report, lease).  
3. Quality and depth of content related to the query (not just matching keywords).  
4. The number of relevant passages / chunks in the document.  
5. Semantic alignment: whether the themes or issues in the document reflect the user's intent.

**TASK:**  
- Evaluate each document's relevance.  
- Rank them in descending order (most relevant first).  
- Output a **JSON array** of document IDs in the final ranked order, e.g.:

```json
["doc_id_4", "doc_id_1", "doc_id_3", "doc_id_2"]
```"""


# ============================================================================
# SQL RETRIEVER PROMPTS (if used)
# ============================================================================

def get_sql_retriever_human_content(user_query: str) -> str:
    """
    Human message content for extracting SQL query parameters.
    System prompt is handled separately via get_system_prompt('sql_query').
    
    Returns:
        Human message content string (without system-level instructions)
    """
    return f"""**USER QUERY:**  
"{user_query}"

**TASK:**  
1. Identify relevant property attributes from the query, including (but not limited to):  
   - Number of bedrooms  
   - Number of bathrooms  
   - Property type (e.g., detached, flat, semi-detached)  
   - Size (e.g., square feet, square meters)  
   - Price or value  
   - Location (e.g., city, postal code, neighborhood)  
   - Date or time constraints (e.g., "built after 2010", "sold in 2023")  

2. For each identified attribute, determine a structured representation (exact value or a plausible range).  
   - If the user specifies a number, use that.  
   - If the user indicates a vague range ("around 1.2 million", "about 3,000 sq ft"), try to convert to a meaningful numeric range (± 10–25% for price, ± ~10–20% for size, or other domain-sensible variance).  
   - If there is no explicit numeric value but a concept (e.g., "large house"), mark as *undefined range* or *null*, unless the context strongly implies a range.

3. Return a **JSON object** with these keys (or similar, based on what you detect):  
```json
{{
  "bedrooms": <int or null>,
  "bathroom": <int or null>,
  "bedroom_range": [<min>, <max>] or null,
  "bathroom_range": [<min>, <max>] or null,
  "property_type": "<string or null>",
  "min_price": <float or null>,
  "max_price": <float or null>,
  "min_size": <float or null>,
  "max_size": <float or null>,
  "location": "<string or null>",
  "date_from": "<YYYY-MM-DD or null>",
  "date_to": "<YYYY-MM-DD or null>"
}}```"""


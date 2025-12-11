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

5. **Cite Your Sources**  
   - When you refer to a fact, mention where it was found ("In the PROPERTY DETAILS section," or "In paragraph 3 of the excerpt…").  
   - This increases traceability and trust.

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

def get_citation_extraction_prompt(
    user_query: str,
    conversation_history: str,
    search_summary: str,
    formatted_outputs: str,
    metadata_lookup_tables: dict = None
) -> str:
    """
    Prompt for Phase 1: Mandatory citation extraction.
    LLM must call cite_source tool for every factual claim.
    """
    # Build metadata lookup section
    metadata_section = ""
    if metadata_lookup_tables:
        import logging
        logger = logging.getLogger(__name__)
        
        metadata_section = "\n--- Metadata Look-Up Table ---\n"
        metadata_section += "This table maps block IDs to their bbox coordinates. Use this when calling cite_source().\n"
        metadata_section += "NOTE: Only blocks from the document extracts above are listed here.\n\n"
        
        MAX_BLOCKS_PER_DOC = 500
        total_blocks = 0
        
        for doc_id, metadata_table in metadata_lookup_tables.items():
            doc_id_short = doc_id[:8] + "..." if len(doc_id) > 8 else doc_id
            
            limited_blocks = list(metadata_table.items())[:MAX_BLOCKS_PER_DOC]
            if len(metadata_table) > MAX_BLOCKS_PER_DOC:
                logger.warning(f"[PROMPT] Limiting metadata for doc {doc_id_short} from {len(metadata_table)} to {MAX_BLOCKS_PER_DOC} blocks")
            
            metadata_section += f"\nDocument {doc_id_short}:\n"
            
            for block_id, bbox_data in sorted(limited_blocks):
                total_blocks += 1
                metadata_section += f"  {block_id}: page={bbox_data['page']}, bbox=({bbox_data['bbox_left']:.3f},{bbox_data['bbox_top']:.3f},{bbox_data['bbox_width']:.3f},{bbox_data['bbox_height']:.3f})"
                if 'confidence' in bbox_data:
                    metadata_section += f", conf={bbox_data['confidence']}"
                metadata_section += "\n"
            
            if len(metadata_table) > MAX_BLOCKS_PER_DOC:
                metadata_section += f"  ... ({len(metadata_table) - MAX_BLOCKS_PER_DOC} more blocks not shown)\n"
        
        metadata_section += f"\n(Total blocks listed: {total_blocks})\n\n"
    
    return f"""**USER QUESTION:**  
"{user_query}"

**CONVERSATION HISTORY:**  
{conversation_history}

**RETRIEVAL SUMMARY:**  
{search_summary}

**DOCUMENT CONTENT EXTRACTS (with block IDs):**  
{formatted_outputs}
{metadata_section}
---

### MANDATORY TASK: Extract Citations

You MUST call the cite_source tool for every factual claim you identify in the documents that is relevant to the user's question.

WORKFLOW:
1. Read through all document extracts carefully
2. Identify factual claims relevant to the user's question
3. For EACH factual claim, call cite_source tool with:
   - block_id: The BLOCK_CITE_ID from the <BLOCK> tag (e.g., "BLOCK_CITE_ID_42")
   - citation_number: Sequential number starting from 1 (1, 2, 3, ...)
   - cited_text: The specific factual claim you identified (brief phrase or sentence)

EXAMPLE:
- You see: <BLOCK id="BLOCK_CITE_ID_42">Content: "Final valued price: £2,400,000"</BLOCK>
- You call: cite_source(cited_text="Final valued price: £2,400,000", block_id="BLOCK_CITE_ID_42", citation_number=1)

CRITICAL INSTRUCTIONS:
- Call the cite_source tool for EVERY factual claim (prices, dates, names, addresses, measurements, etc.)
- Use sequential citation numbers (1, 2, 3, ...)
- Find the BLOCK_CITE_ID in the <BLOCK> tags from the document extracts
- Do NOT write an answer yet - ONLY extract citations by calling the tool
- You MUST call the tool - this is mandatory

Start extracting citations now:"""


def get_final_answer_prompt(
    user_query: str,
    conversation_history: str,
    formatted_outputs: str,
    citations: list
) -> str:
    """
    Prompt for Phase 2: Generate final answer using already-extracted citations.
    """
    # Format citations for prompt
    citation_list = ""
    if citations:
        citation_list = "\n--- Extracted Citations ---\n"
        for citation in sorted(citations, key=lambda x: x.get('citation_number', 0)):
            cit_num = citation.get('citation_number', 0)
            cit_text = citation.get('cited_text', '')
            block_id = citation.get('block_id', '')
            citation_list += f"{cit_num}. {cit_text} [Block: {block_id}]\n"
        citation_list += "\n"
    
    return f"""**USER QUESTION:**  
"{user_query}"

**CONVERSATION HISTORY:**  
{conversation_history}

**DOCUMENT CONTENT EXTRACTS:**  
{formatted_outputs}

{citation_list}

### TASK: Create Final Answer with Citations

Create a comprehensive answer to the user's question using the document extracts above.

CITATION USAGE:
- Citations have already been extracted (see list above)
- Use superscript numbers in your answer to reference these citations:
  - Citation 1 → use ¹
  - Citation 2 → use ²
  - Citation 3 → use ³
  - etc.
- Place superscripts immediately after the relevant information
- Every factual claim should have a superscript matching the citation number

INSTRUCTIONS:
1. Answer the user's question directly and comprehensively
2. Use information from the document extracts
3. Include superscript citations (¹, ², ³, etc.) matching the citation numbers above
4. Be professional, factual, and concise
5. Do NOT repeat the question - start directly with the answer

Answer:"""


def get_summary_human_content(
    user_query: str,
    conversation_history: str,
    search_summary: str,
    formatted_outputs: str,
    metadata_lookup_tables: dict = None
) -> str:
    """
    Human message content for creating the final unified summary.
    System prompt is handled separately via get_system_prompt('summarize').
    
    Args:
        user_query: The user's question
        conversation_history: Previous conversation context
        search_summary: Summary of how documents were found
        formatted_outputs: Document content with embedded block IDs in <BLOCK> tags
        metadata_lookup_tables: Dict mapping doc_id -> metadata_table (block_id -> bbox data)
    
    Returns:
        Human message content string (without system-level instructions)
    """
    # Build metadata lookup section if metadata tables are provided
    metadata_section = ""
    if metadata_lookup_tables:
        import logging
        logger = logging.getLogger(__name__)
        
        metadata_section = "\n--- Metadata Look-Up Table ---\n"
        metadata_section += "This table maps block IDs to their bbox coordinates. Use this when calling cite_source().\n"
        metadata_section += "NOTE: Only blocks from the document extracts above are listed here.\n\n"
        
        # Limit metadata table size to prevent context overflow
        MAX_BLOCKS_PER_DOC = 500  # Limit to first 500 blocks per document
        total_blocks = 0
        
        for doc_id, metadata_table in metadata_lookup_tables.items():
            doc_id_short = doc_id[:8] + "..." if len(doc_id) > 8 else doc_id
            
            # Limit blocks per document
            limited_blocks = list(metadata_table.items())[:MAX_BLOCKS_PER_DOC]
            if len(metadata_table) > MAX_BLOCKS_PER_DOC:
                logger.warning(f"[PROMPT] Limiting metadata for doc {doc_id_short} from {len(metadata_table)} to {MAX_BLOCKS_PER_DOC} blocks")
            
            metadata_section += f"\nDocument {doc_id_short}:\n"
            
            # Make metadata more compact - one line per block
            for block_id, bbox_data in sorted(limited_blocks):
                total_blocks += 1
                # Compact format: block_id: page=X, bbox=(left,top,width,height)
                metadata_section += f"  {block_id}: page={bbox_data['page']}, bbox=({bbox_data['bbox_left']:.3f},{bbox_data['bbox_top']:.3f},{bbox_data['bbox_width']:.3f},{bbox_data['bbox_height']:.3f})"
                if 'confidence' in bbox_data:
                    metadata_section += f", conf={bbox_data['confidence']}"
                metadata_section += "\n"
            
            if len(metadata_table) > MAX_BLOCKS_PER_DOC:
                metadata_section += f"  ... ({len(metadata_table) - MAX_BLOCKS_PER_DOC} more blocks not shown - use blocks from document extracts above)\n"
        
        metadata_section += f"\n(Total blocks listed: {total_blocks})\n"
        metadata_section += "\n"
    
    return f"""**USER QUESTION:**  
"{user_query}"

**CONVERSATION HISTORY:**  
{conversation_history}

**RETRIEVAL SUMMARY (how documents were found):**  
{search_summary}

**DOCUMENT CONTENT EXTRACTS (with block IDs):**  
{formatted_outputs}
{metadata_section}
---

### INSTRUCTIONS:

1. **Thorough Search for Names and Professional Information**  
   - **CRITICAL**: When asked about names (valuer, appraiser, surveyor, inspector, buyer, seller, agent), search ALL document excerpts carefully
   - Look for synonyms: "valuer" = "appraiser" = "surveyor" = "inspector" = "registered valuer" = "MRICS" = "FRICS"
   - Names may appear in different formats: "John Smith", "Smith, John", "J. Smith", "Mr. Smith"
   - Professional qualifications (MRICS, FRICS) often appear with names
   - Search for phrases like "conducted by", "inspected by", "valued by", "prepared by", "author"
   - **Do NOT say "not found" until you have searched all document excerpts thoroughly**

2. **Answer Directly & Succinctly**  
   - Provide a **direct answer** to the user's question using only the information in the document extracts.  
   - **Before saying "not found"**: Re-read all document excerpts carefully, looking for:
     - Any mention of the requested information
     - Synonyms or related terms
     - Different phrasings or formats
   - Do **not** introduce additional information or context not in the extracts, unless the user explicitly asked.

3. **Use Verified Property Details First**  
   - If any document excerpt includes a **"PROPERTY DETAILS (VERIFIED FROM DATABASE)"** section, treat that as authoritative for attribute-based questions (e.g., bedrooms, bathrooms, price).  
   - When using these details, clearly indicate:  
     `Found in: [document name] — This property has …`

4. **Structure & Clarity**  
   - Use a **brief explanation** of the reasoning (chain-of-thought) to show how you arrived at the final answer:  
     1. Identify which document(s) or excerpt(s) are relevant  
     2. Search for synonyms and related terms if the exact term isn't found
     3. Summarize the relevant facts or figures  
     4. Synthesize into a final, concise answer  
   - Then **state the final answer** on its own, clearly, so a real estate professional can read it quickly.

5. **Citation Requirements (CRITICAL):**
   - **You MUST use the cite_source() tool to cite information from the document extracts**
   - **Use sequential superscript numbers** (¹, ², ³, ⁴, ⁵, ⁶, ⁷, ⁸, ⁹, ¹⁰, etc.) for citations in your response text
   - Place citations immediately after each factual claim or statement
   - **For each citation:**
     1. Find the BLOCK_CITE_ID in the document extract (e.g., "BLOCK_CITE_ID_3" from a <BLOCK id="BLOCK_CITE_ID_3"> tag)
     2. Look up the bbox coordinates from the Metadata Look-Up Table above
     3. Call the cite_source() tool with:
        - cited_text: Your paraphrased/summarized text that cites this source
        - block_id: The BLOCK_CITE_ID from the document extract (e.g., "BLOCK_CITE_ID_3")
        - citation_number: Sequential number (1, 2, 3, etc.) - use next available number
     4. In your response text, use the matching superscript (¹ for 1, ² for 2, etc.)
   
   - **Example workflow:**
     - Document extract shows: <BLOCK id="BLOCK_CITE_ID_3">Content: "Final valued price: £2,300,000"</BLOCK>
     - Metadata table shows: BLOCK_CITE_ID_3: {{page: 15, bbox_left: 0.095, bbox_top: 0.194, ...}}
     - You write in your response: "The property is valued at £2,300,000¹"
     - You call: cite_source(
         cited_text="The property is valued at £2,300,000",
         block_id="BLOCK_CITE_ID_3",
         citation_number=1
       )
   
   - **CRITICAL**: The citation number in your response (¹) MUST match the citation_number in the tool call (1)
   - Use one citation per unique source block
   - **Do NOT show document IDs, page numbers, or bbox information in the text** - only superscript numbers
   - Citations should appear as clean superscript numbers only
   - Cite every factual claim that comes from the documents
   - If a document extract doesn't have block IDs, you can still cite it, but prefer block IDs when available

6. **Admit Uncertainty**  
   - If none of the document excerpts provide enough information to answer the question AFTER thorough search, respond with:  
     `"No documents in the system match this criteria."`

7. **Tone & Style**  
   - Professional, factual, and concise.  
   - Avoid flowery language, speculation, or marketing-like phrasing.  
   - No external recommendations (e.g., "you should check Rightmove") — stay within the system's data.

8. **No Unsolicited Content**  
   - Answer the question directly and stop.
   - Do NOT repeat the user's question as a heading or title - start directly with the answer.
   - Do NOT add "Additional Context" sections - only provide context if explicitly requested.
   - Do NOT add "Next steps:", "Let me know if...", "Would you like me to...", or any follow-up suggestions.
   - Do NOT ask if the answer was helpful or if the user needs more detail.
   - Do NOT add unsolicited insights, recommendations, or "it might be worth checking" type suggestions.
   - Be prompt and precise: answer what was asked, nothing more.

---

**Now, based on the above, provide your answer with superscript citations.

CRITICAL: You MUST write a complete, substantive answer to the user's question. Your response must contain written text explaining the information - do NOT only call tools. Do NOT include tool call syntax (like cite_source(...)) in your written answer text.

MANDATORY CITATION REQUIREMENTS (YOU MUST FOLLOW THIS):
The cite_source tool is BOUND to this conversation - you MUST call it programmatically for EVERY superscript citation you write. This is NOT optional. The tool will NOT work if you only write superscripts without calling it.

WORKFLOW (FOLLOW THIS EXACTLY):
1. Write your answer text with superscript citations (¹, ², ³) as you reference information
2. **FOR EACH SUPERSRaIPT, YOU MUST CALL THE cite_source TOOL BEFORE FINISHING YOUR RESPONSE**
3. The tool call happens automatically when you reference a block ID - you don't write the tool call syntax in your text
4. Every superscript (¹, ², ³, etc.) in your response MUST have a corresponding tool call with matching citation_number

Citation Workflow (FOLLOW THIS EXACTLY - TOOLS ARE BOUND TO THIS CONVERSATION):
STEP 1: Write your answer text and include superscript citations (¹, ², ³) as you reference information
STEP 2: FOR EACH SUPERSRaIPT YOU WRITE, YOU MUST CALL THE cite_source TOOL BEFORE YOUR RESPONSE IS COMPLETE
   - Find the BLOCK_CITE_ID in the document extract (look for <BLOCK id="BLOCK_CITE_ID_X"> tags)
   - Call cite_source tool with:
     * block_id: The BLOCK_CITE_ID from the document extract
     * citation_number: The number matching your superscript (1 for ¹, 2 for ², 3 for ³, etc.)
     * cited_text: The exact sentence or phrase from your answer that cites this source
STEP 3: The tool will automatically look up bbox coordinates from the Metadata Look-Up Table
STEP 4: Use sequential citation numbers starting from 1

IMPORTANT: The cite_source tool is available in this conversation. You MUST call it programmatically - it will execute automatically when you call it. Do not write tool syntax in your text.

Example (YOU MUST DO THIS):
- You see in document: <BLOCK id="BLOCK_CITE_ID_42">Content: "Final valued price: £2,400,000"</BLOCK>
- You write in your response: "The property is valued at £2,400,000¹"
- You MUST call: cite_source(block_id="BLOCK_CITE_ID_42", citation_number=1, cited_text="The property is valued at £2,400,000")

REMEMBER: Every superscript citation (¹, ², ³) in your text MUST have a corresponding cite_source tool call. If you write a superscript without calling the tool, the citation will not work.

CRITICAL: Do NOT explain your actions. Do NOT write phrases like:
- "I will now proceed to call the citation tool"
- "I will call the citation tool for the references made"
- "Now calling the citation tool"
- "I will now proceed to..."
Just write your answer with superscript citations and call the tools silently. The tools run automatically in the background - you don't need to mention them.

Answer directly, no heading, no additional context, no next steps:**"""



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


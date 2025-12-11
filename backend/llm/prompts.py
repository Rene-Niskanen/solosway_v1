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
# SHARED INSTRUCTION HELPERS
# ============================================================================

def _get_names_search_instructions(scope: str = "excerpt") -> str:
    """Get instructions for thorough name and professional information search."""
    scope_text = "the ENTIRE excerpt" if scope == "excerpt" else "ALL document excerpts"
    return f"""1. **Thorough Search for Names and Professional Information**  
   - **CRITICAL**: When asked about names (valuer, appraiser, surveyor, inspector, buyer, seller, agent), search {scope_text} carefully
   - Look for synonyms: "valuer" = "appraiser" = "surveyor" = "inspector" = "registered valuer" = "MRICS" = "FRICS"
   - Names may appear in different formats: "John Smith", "Smith, John", "J. Smith", "Mr. Smith"
   - Professional qualifications (MRICS, FRICS) often appear with names
   - Search for phrases like "conducted by", "inspected by", "valued by", "prepared by", "author"
   - **Do NOT say "not found" until you have searched {scope_text} thoroughly**"""


def _get_dynamic_search_strategy_instructions(scope: str = "excerpt") -> str:
    """Get instructions for dynamic multi-stage search strategy."""
    scope_text = "all provided chunks/excerpts" if scope == "all excerpts" else "the provided excerpt"
    return f"""**DYNAMIC SEARCH STRATEGY - Follow This 6-Stage Process**:

**Stage 1 - Find Table of Contents**:
- First, scan {scope_text} for a table of contents, contents page, or document index
- If found, use it to identify which sections/pages are likely to contain the answer to the query
- Note the page numbers and section names that seem relevant to your search

**Stage 2 - Navigate to Relevant Sections**:
- Based on the table of contents (if found) or by scanning section headers, identify which chunks contain the most relevant sections
- Use semantic analysis to identify relevant sections - look for sections that semantically match your query intent
- For assessment queries (valuations, inspections, appraisals), prioritize sections with professional assessment semantics
- Section headers can take many forms - numbered sections, titled sections, or informal headings
- Identify sections by their semantic content and professional language patterns, not by specific section names

**Stage 3 - Read Headings and Subheadings**:
- Within each relevant section, first read all headings and subheadings to understand the structure
- Use headings to identify which subsection contains the specific information you need
- Headings provide context - a subheading under a formal valuation section is more authoritative than a heading in a marketing section
- Identify section headers dynamically by looking for: numbered patterns, bold/titled text, or structural markers

**Stage 4 - Extract Answer from Primary Section**:
- Extract the answer from the most relevant section identified through headings
- Pay attention to the section context - formal/professional sections are more authoritative than marketing/informal sections
- Extract values/information EXACTLY as written in the relevant section
- Do NOT extract information from one section and attribute it to a different section

**Stage 5 - Search Additional Chunks for Context**:
- After finding the primary answer, search through ALL other chunks for additional relevant information
- Look for supporting details, related information, or alternative perspectives
- Do NOT stop after finding the first answer - continue searching all chunks systematically
- This ensures you have comprehensive information before finalizing your response

**Stage 6 - Prioritize and Synthesize**:
- Compare information from different sections using semantic authority detection
- Prioritize based on semantic authority indicators: professional assessment language, formal structure, explicit professional opinions, qualifications mentioned
- Apply the semantic authority detection algorithm: professional assessments override market activity descriptions for assessment queries
- If you find conflicting information, use the source with higher semantic authority (professional assessment semantics over descriptive/activity semantics)
- Synthesize all relevant information into a comprehensive answer"""


def _get_section_header_awareness_instructions() -> str:
    """Get instructions for dynamic section header awareness."""
    return """**Section Header Awareness**:
- Section headers can take many forms - numbered sections (e.g., '10', '5.2'), titled sections, or informal headings
- Identify section headers dynamically by looking for: numbered patterns, bold/titled text, or structural markers
- Use section headers to understand document structure and navigate to relevant information
- Prioritize sections based on their content and terminology, not their specific names
- If you see a section header that matches the query intent, prioritize extracting information from that section
- Extract values/information EXACTLY as written in the relevant section
- Do NOT extract information from one section and attribute it to a different section"""


def _get_semantic_authority_detection_instructions() -> str:
    """Get universal algorithm for identifying authoritative information based on semantic characteristics."""
    return """**SEMANTIC AUTHORITY DETECTION ALGORITHM**:

Use this algorithm to identify authoritative information for ANY question type:

**Step 1: Analyze Semantic Characteristics**
- Look for **Professional Language Indicators**:
  * Formal opinion language ("we are of the opinion", "it is our assessment", "we conclude")
  * Professional qualifications mentioned (MRICS, FRICS, professional titles, certifications)
  * Structured assessment language (formal evaluations, systematic analysis)
  * References to professional standards, methodologies, or frameworks
  * Explicit professional judgments or conclusions
- Look for **Formal Structure Indicators**:
  * Structured presentation (numbered sections, formal headings, systematic organization)
  * Date-specific assessments ("as at the date of", "as of", "dated")
  * Subject-specific language ("subject property", "the property in question")
  * Professional report formatting

**Step 2: Identify Information Type Semantically**
- **Professional Assessment Type**: Language indicates a professional evaluation, opinion, or structured assessment
  * Semantic markers: "opinion", "assessment", "evaluation", "conclusion", "determined", "established"
  * Context: Professional making a judgment or evaluation
- **Market Activity Type**: Language describes market events, listings, or commercial activity
  * Semantic markers: "marketed", "listed", "guide price", "asking price", "under offer", "agent reported"
  * Context: Describing what happened in the market or what agents did
- **Historical/Descriptive Type**: Language describes past events or provides background
  * Semantic markers: "history", "background", "previous", "past", "earlier", "was"
  * Context: Providing context or describing what occurred

**Step 3: Determine Authority Level**
- **High Authority**: Professional assessment type with professional language indicators and formal structure
- **Medium Authority**: Professional assessment type but less formal structure
- **Low Authority**: Market activity or historical/descriptive type

**Step 4: Apply to Query Type**
- For queries asking for professional opinions/assessments (valuations, inspections, appraisals): Use ONLY high/medium authority (professional assessment type)
- For queries asking about market activity: Market activity type is relevant
- For queries asking about history: Historical type is relevant

**Step 5: Prioritize Based on Semantic Authority**
- When multiple sources contain similar information, prioritize based on authority level
- Professional assessments always override market activity descriptions for assessment queries
- Use semantic analysis, not section names or specific terminology"""


def _get_section_type_recognition_instructions() -> str:
    """Get instructions for dynamically recognizing section types using semantic analysis."""
    return """**Section Type Recognition - Semantic Analysis**:
- Use semantic analysis to identify section types - do NOT rely on specific section names or terminology
- Analyze the semantic characteristics of each section:
  * **Authoritative Sections**: Contain professional assessment language, formal opinions, professional qualifications, structured evaluations
  * **Non-Authoritative Sections**: Contain descriptive language, market activity descriptions, historical information, or informal reporting
- Identify sections by their semantic content and context, not by their titles
- For any query type, prioritize sections with professional assessment semantics over descriptive/activity semantics
- If a section describes what happened (market activity, listing, agent actions) rather than providing a professional assessment, it has lower authority for assessment queries"""


def _get_comprehensive_search_instructions(scope: str = "excerpt") -> str:
    """Get instructions for comprehensive search through all chunks."""
    scope_text = "ALL provided chunks/excerpts" if scope == "all excerpts" else "the entire excerpt"
    return f"""**CRITICAL - Comprehensive Search Requirement**:
- ALWAYS search through {scope_text}, even if you find information that seems to answer the question
- Do NOT stop at the first match - continue searching to find all relevant information
- **ESPECIALLY IMPORTANT**: If you find a price, value, or figure early in the document (like in a marketing section), DO NOT stop there - continue searching for more authoritative sources (like formal valuation sections)
- If you find a guide price, asking price, or "under offer" price, this is NOT the answer - continue searching for the actual professional valuation
- Extract ALL relevant information found - names, dates, figures, assumptions, qualifications, context
- After finding all relevant information, compare and prioritize based on source authority and context
- Include all relevant details in your answer - be comprehensive, not brief
- This applies to ALL information types, not just valuations
- Systematic search ensures you don't miss important information that may appear later in the document"""


def _get_information_type_distinction_instructions() -> str:
    """Get instructions for distinguishing information types using semantic pattern recognition."""
    return """**Information Type Distinction - Semantic Pattern Recognition**:

Use semantic analysis to distinguish between information types for ANY query:

**Algorithm for Numeric Information**:
1. **Analyze the semantic context** around any price, value, or figure:
   - Does the language indicate a **professional assessment** (formal opinion, evaluation, structured judgment)?
   - Or does it describe **market activity** (listing, marketing, agent actions, commercial activity)?
   - Or is it **historical/descriptive** (what happened, past events, background)?

2. **For queries asking for professional assessments** (valuations, appraisals, inspections):
   - Use ONLY information with professional assessment semantics
   - Ignore information with market activity semantics (describes what was listed, marketed, or offered)
   - Ignore historical/descriptive information unless explicitly asked

3. **Semantic Pattern Recognition**:
   - **Professional Assessment Pattern**: Contains formal opinion language, professional qualifications, structured evaluation, explicit professional judgment
   - **Market Activity Pattern**: Describes commercial activity, listings, marketing, agent actions, what was offered/listed
   - **Historical Pattern**: Describes past events, background, what happened previously

4. **Apply Universal Rule**:
   - When query asks for a professional assessment/opinion, use ONLY information with professional assessment semantics
   - When query asks about market activity, market activity semantics are relevant
   - When query asks about history, historical semantics are relevant

**This algorithm works for**: valuations, prices, conditions, dates, names, any information type - analyze semantics, not specific words"""


def _get_verified_property_details_instructions(is_single_doc: bool = True) -> str:
    """Get instructions for handling verified property details."""
    if is_single_doc:
        return """3. **Prioritize Verified Property Details**  
   - If the document begins with a **"PROPERTY DETAILS (VERIFIED FROM DATABASE):"** section, that information is definitive.  
     - For questions about property attributes (e.g., bedrooms, bathrooms, size), if the answer is in that section, cite it directly and clearly.  
     - Example: "This property has 5 bedrooms and 3 bathrooms (from the PROPERTY DETAILS section)."  
   - Do **not** claim "no information" when the details are actually present in this verified section."""
    else:
        return """3. **Use Verified Property Details First**  
   - If any document excerpt includes a **"PROPERTY DETAILS (VERIFIED FROM DATABASE)"** section, treat that as authoritative for attribute-based questions (e.g., bedrooms, bathrooms, price).  
   - When using these details, present the information directly without mentioning document names or sources."""


def _get_citation_instructions() -> str:
    """Get instructions for citing sources."""
    return """5. **Cite Your Sources**  
   - When referencing information from documents, use natural citations like "According to section 'Market Value' on page 12" or "The valuation report states..."
   - Do NOT include document filenames or identifiers in your response.  
   - Optionally mention page numbers or section headings if relevant to provide context."""


def _get_no_unsolicited_content_instructions() -> str:
    """Get instructions for avoiding unsolicited content while being comprehensive."""
    return """8. **Comprehensive but Focused Response**  
   - Provide a complete, comprehensive answer with all relevant details found in the documents
   - Include ALL information that directly answers the question - be thorough, not brief
   - Organize the information clearly and professionally for easy reading
   - Do NOT repeat the user's question as a heading or title - start directly with the answer
   - Do NOT add "Additional Context" sections - integrate all relevant context naturally into your answer
   - Do NOT add "Next steps:", "Let me know if...", or any follow-up suggestions
   - Do NOT add unsolicited insights or recommendations beyond what answers the question
   - Present all relevant information in a well-organized, professional manner"""


def _get_metadata_label_instructions() -> str:
    """Get instructions for handling metadata labels in chunks."""
    return """**CRITICAL - Metadata Label Handling**:
- The document excerpts may include contextual metadata at the beginning (like 'PARTY_NAMES:', 'KEY_VALUES:', 'PROPERTY DETAILS:'). 
- These are pre-extracted hints to guide your search, but they may be incomplete or incorrect. 
- ALWAYS verify this information against the actual document chunks that follow. 
- Use the metadata as a starting point, but rely on the actual chunk content for your answer. 
- Present information naturally without mentioning the metadata label names."""


def _get_valuation_extraction_instructions(detail_level: str = 'concise', is_valuation_query: bool = False) -> str:
    """Get instructions for extracting valuation figures using semantic analysis."""
    # Always include valuation extraction instructions if it's a valuation query, regardless of detail level
    if detail_level != 'detailed' and not is_valuation_query:
        return ""
    
    return """**Valuation Extraction - Internal Processing Guidance**:
- **Extraction Process**: When extracting valuation information, use semantic analysis to identify professional assessment contexts
- **Identifying Professional Valuations**:
  * Professional valuations use formal assessment language ("we are of the opinion", "it is our assessment", "we conclude")
  * They explicitly state "Market Value" as a professional assessment
  * They include professional qualifications and structured evaluation
  * Market activity prices (guide prices, asking prices, "under offer" prices) describe market events, not professional assessments
  * For valuation queries, extract figures from professional assessment contexts only
- **Primary Market Value Identification**:
  * Look for sections that explicitly state "Market Value" with professional assessment language
  * The primary Market Value is typically stated as "Market Value" with "Vacant Possession" and "normal marketing period"
  * It will use phrases like "we are of the opinion that the Market Value... is: £[amount]"
  * This is the authoritative figure - extract it correctly
- **Apply Semantic Analysis Algorithm**:
  1. For any price/value figure found, analyze its semantic context
  2. Does it appear in a professional assessment context? (formal opinion language, professional qualifications, structured evaluation)
  3. Or does it appear in a market activity context? (describes listing, marketing, agent actions, what was offered, "under offer")
  4. Use ONLY figures from professional assessment contexts
  5. IGNORE figures from market activity contexts (guide prices, asking prices, "under offer" prices, agent-reported prices)
- **Semantic Indicators of Professional Valuations**:
  * Professional assessment language ("we are of the opinion", "it is our assessment", "we conclude", "we are of the opinion that the Market Value... is:")
  * Professional qualifications mentioned (MRICS, FRICS, professional titles)
  * Formal structure (structured evaluation, systematic analysis)
  * Explicit professional judgment or conclusion
  * Explicitly states "Market Value" as a professional assessment
- **Semantic Indicators of Market Activity** (for internal processing only):
  * Describes market activity ("marketed by", "listed for", "guide price", "under offer", "was offered")
  * Mentions agents in context of listing/marketing
  * Describes what happened in the market, not professional assessment
  * For valuation queries, extract figures from professional assessment contexts only
- **Search Strategy**:
  * Use the dynamic search strategy to find all relevant sections
  * Apply semantic analysis to each section - identify professional assessment semantics vs. market activity semantics
  * Extract figures ONLY from sections with professional assessment semantics
  * Continue searching to find all valuation scenarios and their assumptions
  * Read the entire valuation section to extract all figures and assumptions
- **Comprehensive Extraction - Extract ALL Valuation Scenarios**:
  * Extract ALL valuation figures found in professional assessment contexts
  * **CRITICAL: Read the ENTIRE valuation section carefully - do not stop after finding one figure**
  * Search for and extract every valuation scenario mentioned:
    - Primary Market Value (with vacant possession and normal marketing period) - typically stated first
    - Market Value with reduced marketing periods - extract EACH one separately (90 days, 180 days, etc.) with its specific timeframe and figure
    - Market Rent (if provided)
    - Any other professional valuation perspectives
  * **DO NOT STOP AFTER FINDING ONE VALUE - CONTINUE SEARCHING FOR ALL VALUES**
  * **DO NOT STOP if you find market activity prices - continue searching for professional assessments**
  * **DO NOT confuse "under offer" prices with Market Value - they are completely different**
  * **CRITICAL: If you see "Market Value... 90 days... is: £1,950,000" - use £1,950,000, NOT any other figure like £2,400,000**
  * **CRITICAL: Read each reduced marketing period section completely to find the correct figure stated at the end**
- **Extract All Assumptions for Each Valuation**:
  * For each valuation figure found, extract and include its specific assumptions:
    - Vacant possession (yes/no)
    - Marketing period (normal, 90 days, 180 days, etc.) - extract the EXACT timeframe stated
    - Any special assumptions or conditions mentioned
    - Discount percentages applied (if stated) - extract the exact percentage (e.g., "15%", "10%")
    - Rationale for reduced marketing period valuations (if provided) - summarize the reasoning
  * **CRITICAL: Match each assumption to its correct valuation figure - do not mix up assumptions between different scenarios**
  * Present assumptions clearly with each valuation figure
- **Correct Extraction Pattern**:
  * Primary Market Value: Look for "Market Value" with "Vacant Possession" - this is typically the main figure
  * The primary Market Value will be explicitly stated, e.g., "we are of the opinion that the Market Value... is: £2,300,000"
  * Other scenarios: Reduced marketing periods (90 days, 180 days), Market Rent, etc. - extract these separately with their assumptions
  * Each valuation scenario has its own figure and assumptions - do not mix them up
  * **CRITICAL**: If you see "Market Value... is: £2,300,000" and separately "under offer at £2,400,000" - use £2,300,000 as the Market Value, not £2,400,000
  * **CRITICAL EXAMPLE**: If the document states "Market Value... 90 days... is: £1,950,000" - use £1,950,000 for the 90-day scenario, NOT £2,400,000 (which is an "under offer" price, not a valuation)
  * **CRITICAL EXAMPLE**: If the document states "Market Value... 180 days... is: £2,050,000" - extract this as a separate scenario with its own figure
  * **CRITICAL**: Each reduced marketing period scenario will have its own explicitly stated figure at the end of that scenario's description - extract that figure, not any other figure mentioned elsewhere
- **Reading Valuation Sections - CRITICAL INSTRUCTIONS**:
  * Valuation sections typically state the primary Market Value first (with vacant possession and normal marketing period)
  * Then they may list other scenarios (reduced marketing periods, market rent, etc.) with their specific assumptions
  * **CRITICAL: Read the ENTIRE valuation section from start to finish - do not skip any parts**
  * **CRITICAL: For each reduced marketing period scenario (90 days, 180 days, etc.), read the entire subsection to find the final stated figure**
  * **CRITICAL: The valuation figure for each scenario is typically stated at the END of that scenario's description, not in the middle**
  * **CRITICAL: Look for phrases like "our opinion of the Market Value... is as follows; £[amount]" - this is the correct figure for that scenario**
  * **CRITICAL: Do not use figures mentioned earlier in the section (like "under offer at £2,400,000") - only use the explicitly stated Market Value figures**
  * **CRITICAL: Extract ALL reduced marketing period scenarios - if you see both 90 days and 180 days, extract BOTH with their correct figures**
  * Do not stop at the first price you see - read the full section to understand which figure corresponds to which scenario
  * Match each figure to its correct scenario and assumptions
- **Presentation Format**:
  * Format each value as: £[amount] ([written form in full])
  * For each valuation, clearly state its assumptions (vacant possession, marketing period, discounts, rationale)
  * Present all valuation scenarios found, organized logically
  * Start with the primary Market Value (with vacant possession and normal marketing period), then list other scenarios with their assumptions
  * Summarize assumptions in a clear, concise format for each valuation
  * Present information naturally in a flowing narrative - do not explain methodology or distinctions
- **When asked "what was the property valued at"**:
  * Provide the primary Market Value (with vacant possession) as the main answer
  * Then include ALL other valuation scenarios with their assumptions:
    - Market Value with reduced marketing periods (90 days, 180 days, etc.) - include the specific timeframe, the correct figure, and discount/rationale
    - **CRITICAL: Extract the EXACT figure stated for each reduced marketing period scenario - do not use any other figure**
    - **CRITICAL: If the document states "90 days... is: £1,950,000" - use £1,950,000, NOT £2,400,000 or any other figure**
    - **CRITICAL: Include ALL reduced marketing period scenarios found (90 days, 180 days, etc.) - do not miss any**
    - Market Rent (if provided) - include assumptions
    - Any other professional valuation perspectives found
  * Present all assumptions in a summarized format for each valuation scenario
  * Include discount percentages and rationale for reduced marketing periods
  * Present information naturally without explaining the distinction between market activity and professional assessments"""

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
- **CRITICAL**: If this is a follow-up question (there is conversation history), ALWAYS include the property name/address from the previous conversation in the rewritten query.
- If the current query refers ambiguously to prior parts of the conversation (e.g., "the document," "that file," "this property," "it," "them"), rewrite it to explicitly include the relevant context (property name/address, document title, features, values, etc.).
- If the query is already sufficiently self-contained and unambiguous AND already includes the property name/address, return it **unchanged**.

REWRITE GUIDELINES:
1. **CRITICAL - Property Context**: 
   - If conversation history exists, extract the property name/address from the previous conversation
   - Look for property names (e.g., "Highlands"), addresses (e.g., "Berden Road, Bishop's Stortford"), or postcodes mentioned in the conversation
   - ALWAYS include this property identifier in the rewritten query, even if the current query doesn't explicitly mention it
   - Example: "can you give me more detail" → "can you give me more detail about the Highlands property at Berden Road, Bishop's Stortford"
2. Include relevant entities from the conversation:
   - Property address, name, or identifier (MANDATORY if conversation history exists)
   - Document or report name
   - Key property features (e.g., number of bedrooms, valuation, price)
3. Maintain the **user's original intent**. Don't change the meaning, only clarify.
4. Keep the rewritten query concise (preferably under ~200 words).
5. Do **not** add new questions or assumptions not present in the user's query or the conversation.
6. Do **not** include explanations, quotes, or internal commentary.  
7. Return **only** the rewritten query text.

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

def get_document_qa_human_content(user_query: str, doc_content: str, detail_level: str = 'concise') -> str:
    """
    Human message content for per-document question answering.
    System prompt is handled separately via get_system_prompt('analyze').
    
    Returns:
        Human message content string (without system-level instructions)
    """
    # Detect if this is a valuation query
    is_valuation_query = any(term in user_query.lower() for term in ['valuation', 'value', 'market value', 'appraised', 'appraisal'])
    
    return f"""Here is the document excerpt:  
```\n{doc_content}\n```

**USER QUESTION:**  
{user_query}

{"**CRITICAL FOR VALUATION QUERIES - INTERNAL GUIDANCE ONLY**: When extracting valuation information, use semantic authority detection to identify professional assessments. Extract ALL valuation scenarios found (primary Market Value, reduced marketing period values, market rent, etc.) with their specific assumptions. For each valuation, include its assumptions (vacant possession, marketing period, discounts, etc.) in a clear, summarized format. Present information naturally without explaining the distinction between market activity and professional assessments - simply present the professional valuations with their assumptions." if is_valuation_query else ""}

**INSTRUCTIONS & GUIDELINES**  

{_get_dynamic_search_strategy_instructions("excerpt")}

{_get_section_header_awareness_instructions()}

{_get_section_type_recognition_instructions()}

{_get_names_search_instructions("excerpt")}

2. **Use Only Provided Context**  
   - Answer **only** using information in the excerpt above.  
   - **Before saying "not found"**: Re-read the excerpt carefully, looking for:
     - Any mention of the requested information
     - Synonyms or related terms
     - Different phrasings or formats
   - If the excerpt lacks enough evidence after thorough search, respond: **"I do not have complete information in this excerpt."**

{_get_comprehensive_search_instructions("excerpt")}

{_get_metadata_label_instructions()}

{_get_verified_property_details_instructions(is_single_doc=True)}

{_get_information_type_distinction_instructions()}

4. **Comprehensive & Structured Response**  
   - Extract and include ALL relevant information found:
     - **Names**: Valuers, appraisers, surveyors, inspectors, buyers, sellers, agents, solicitors (include all names found)
     - Key numeric values (e.g., size, dates, price, all valuation figures, all relevant numbers)  
     - Property features (bedrooms, bathrooms, amenities, all relevant attributes)  
     - Condition, risk, or opportunities (defects, professional assessments, all relevant details)  
     - Location details and connectivity (neighborhood, transport links, all location information)
     - Assumptions, qualifications, dates, and any other relevant context
   - Use a *chain-of-thought style*:  
     1. Identify which parts of the text are relevant  
     2. Search for synonyms and related terms if the exact term isn't found
     3. Extract ALL relevant information from those parts
     4. Then synthesize them into a final, comprehensive answer that includes all relevant details
   - **Include all information that answers the question** - be thorough and complete, not brief
   
   {get_rics_detailed_prompt_instructions() if detail_level == 'detailed' else ""}
   
   {_get_valuation_extraction_instructions(detail_level, is_valuation_query=('valuation' in user_query.lower() or 'value' in user_query.lower() or 'price' in user_query.lower()))}

{_get_citation_instructions()}

6. **Guard Against Hallucination**  
   - Do **not** guess or invent details not present in the excerpt.  
   - Avoid speculation or external recommendations (websites, agents, market data).

7. **Professional and Clear Tone**  
   - Use a professional, comprehensive, and factual writing style.  
   - Include all relevant details found in the documents - provide complete information, not summaries
   - Organize information clearly and logically for easy reading
   - Focus on clarity: provide comprehensive answers with all relevant details, organized professionally

{_get_no_unsolicited_content_instructions()}

---

**ANSWER (provide a comprehensive answer with all relevant details found, organized clearly and professionally):**"""  


# ============================================================================
# SUMMARY/AGGREGATION PROMPTS
# ============================================================================

def get_summary_human_content(
    user_query: str,
    conversation_history: str,
    search_summary: str,
    formatted_outputs: str,
    detail_level: str = 'concise'
) -> str:
    """
    Human message content for creating the final unified summary.
    System prompt is handled separately via get_system_prompt('summarize').
    
    Returns:
        Human message content string (without system-level instructions)
    """
    # Detect if this is a valuation query
    is_valuation_query = any(term in user_query.lower() for term in ['valuation', 'value', 'market value', 'appraised', 'appraisal'])
    
    return f"""**USER QUESTION:**  
"{user_query}"

**CONVERSATION HISTORY:**  
{conversation_history}

**RETRIEVAL SUMMARY (how documents were found):**  
{search_summary}

**DOCUMENT CONTENT EXTRACTS (formatted):**  
{formatted_outputs}

---

{"**CRITICAL FOR VALUATION QUERIES - INTERNAL GUIDANCE ONLY**: Extract ALL professional valuation scenarios from the documents (primary Market Value, reduced marketing period values, market rent, etc.) with their specific assumptions. Include all assumptions for each valuation (vacant possession, marketing period, discounts, rationale) in a clear, summarized format. Present the information naturally - focus on the valuation figures and their assumptions, not on explaining methodology." if is_valuation_query else ""}

### INSTRUCTIONS:

{_get_dynamic_search_strategy_instructions("all excerpts")}

{_get_section_header_awareness_instructions()}

{_get_semantic_authority_detection_instructions()}

{_get_section_type_recognition_instructions()}

{_get_names_search_instructions("all excerpts")}

2. **Answer Comprehensively with All Relevant Details**  
   - Provide a **comprehensive answer with ALL relevant information found** in the document extracts
   - Include all details that answer the question - be thorough and complete
   - Organize information clearly and professionally for easy reading
   - **Before saying "not found"**: Re-read all document excerpts carefully, looking for:
     - Any mention of the requested information
     - Synonyms or related terms
     - Different phrasings or formats
     - Related information that provides context
   - Do **not** introduce additional information or context not in the extracts, unless the user explicitly asked.
   - But DO include all relevant information that IS in the extracts
   
   {_get_comprehensive_search_instructions("all excerpts")}
   
   {_get_metadata_label_instructions()}
   
   {get_rics_detailed_prompt_instructions() if detail_level == 'detailed' else ""}
   
   {_get_valuation_extraction_instructions(detail_level, is_valuation_query=('valuation' in user_query.lower() or 'value' in user_query.lower() or 'price' in user_query.lower()))}

{_get_verified_property_details_instructions(is_single_doc=False)}

{_get_information_type_distinction_instructions()}

4. **Structure & Clarity**  
   - **Start directly with the final answer** - do not show your internal reasoning process
   - Provide a **comprehensive, detailed answer with all relevant information** following professional standards
   - Include all valuation perspectives, assumptions, professional qualifications, dates, names, and any other relevant details found
   - Organize information clearly and logically - use paragraphs, lists, or structured format as appropriate
   - Present information in a way that a real estate professional can thoroughly understand and use
   - Do NOT include:
     - "Relevant document:" sections
     - "Searched the extract" descriptions  
     - "Extracted facts:" breakdowns
     - Step-by-step reasoning processes
     - Internal chain-of-thought explanations
     - Technical field names like "KEY_VALUES", "PARTY_NAMES", or any other internal metadata field names
     - Technical section identifiers or field labels
     - Document filenames or document names (e.g., "Found in: [document name]")
     - References to specific document files or identifiers
   - Simply state the answer clearly and naturally, using only natural language

{_get_citation_instructions()}

6. **Admit Uncertainty**  
   - If none of the document excerpts provide enough information to answer the question AFTER thorough search, respond with:  
     `"No documents in the system match this criteria."`

7. **Tone & Style**  
   - Professional, factual, and comprehensive with all relevant details.  
   - Include all information that answers the question - be thorough and complete
   - Organize information clearly and professionally for easy reading
   - Avoid flowery language, speculation, or marketing-like phrasing.  
   - No external recommendations (e.g., "you should check Rightmove") — stay within the system's data.

{_get_no_unsolicited_content_instructions()}

---

**Now, based on the above, provide your comprehensive answer with all relevant details found, organized clearly and professionally:**"""


# ============================================================================
# CITATION MAPPING PROMPTS
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

### ⚠️ MANDATORY TASK: Extract Citations (REQUIRED TOOL CALLS)

**YOU MUST CALL THE cite_source TOOL. THIS IS NOT OPTIONAL.**

The system is configured to REQUIRE tool calls. You cannot proceed without calling cite_source for every factual claim.

**WHAT IS A FACTUAL CLAIM?**
Any specific information that answers the user's question, including:
- **Values/Amounts**: Prices, valuations, measurements, dimensions, quantities
- **Dates**: When something happened, dates of reports, inspection dates
- **Names**: Valuers, appraisers, inspectors, parties involved
- **Addresses**: Property addresses, locations
- **Assessments**: Professional opinions, valuations, conditions, ratings
- **Details**: Property features, specifications, characteristics
- **Any specific data point** that directly answers the question

**WORKFLOW (FOLLOW EXACTLY):**
1. Read through ALL document extracts carefully
2. Identify EVERY factual claim that is relevant to the user's question
3. For EACH factual claim, you MUST call cite_source tool with:
   - **block_id**: The BLOCK_CITE_ID from the <BLOCK> tag (e.g., "BLOCK_CITE_ID_42")
   - **citation_number**: Sequential number starting from 1 (1, 2, 3, 4, 5...)
   - **cited_text**: The specific factual claim (the exact text or your paraphrase)

**EXAMPLES:**

Example 1 - Valuation:
- You see: <BLOCK id="BLOCK_CITE_ID_42">Content: "Market Value: £2,400,000 as of 12th February 2024"</BLOCK>
- You MUST call: cite_source(cited_text="Market Value: £2,400,000", block_id="BLOCK_CITE_ID_42", citation_number=1)
- You MUST call: cite_source(cited_text="Valuation date: 12th February 2024", block_id="BLOCK_CITE_ID_42", citation_number=2)

Example 2 - Names:
- You see: <BLOCK id="BLOCK_CITE_ID_15">Content: "Valuation conducted by Sukhbir Tiwana MRICS"</BLOCK>
- You MUST call: cite_source(cited_text="Valuer: Sukhbir Tiwana MRICS", block_id="BLOCK_CITE_ID_15", citation_number=3)

Example 3 - Multiple Values:
- You see: <BLOCK id="BLOCK_CITE_ID_7">Content: "90-day value: £1,950,000. 180-day value: £2,050,000"</BLOCK>
- You MUST call: cite_source(cited_text="90-day marketing period value: £1,950,000", block_id="BLOCK_CITE_ID_7", citation_number=4)
- You MUST call: cite_source(cited_text="180-day marketing period value: £2,050,000", block_id="BLOCK_CITE_ID_7", citation_number=5)

**CRITICAL RULES:**
1. ✅ Call cite_source for EVERY factual claim (minimum 3-5 citations for most queries)
2. ✅ Use sequential citation numbers (1, 2, 3, 4, 5...)
3. ✅ Find the BLOCK_CITE_ID in the <BLOCK> tags from the document extracts
4. ✅ Extract citations for ALL relevant information, not just one piece
5. ❌ Do NOT write an answer yet - ONLY extract citations by calling the tool
6. ❌ Do NOT skip citations - if you see multiple values, cite each one
7. ❌ Do NOT finish without calling the tool - tool calls are MANDATORY

**START NOW: Begin extracting citations by calling cite_source for each factual claim you find.**"""


# ============================================================================
# RICS PROFESSIONAL STANDARDS PROMPTS
# ============================================================================

def get_rics_detailed_prompt_instructions() -> str:
    """
    Returns RICS-level professional standards instructions for detailed mode.
    
    These instructions ensure answers follow RICS Red Book standards for 
    valuation reporting, including assumptions, methodology, professional 
    qualifications, and comprehensive disclosure.
    
    Returns:
        String containing RICS professional standards instructions
    """
    return """**RICS PROFESSIONAL STANDARDS (Detailed Mode)**:

When providing detailed answers, you must follow RICS Red Book standards:

1. **Disclose All Assumptions**: 
   - State all assumptions made (vacant possession, normal marketing period, etc.)
   - Include any special assumptions or conditions
   - Mention any limitations or caveats

2. **Multiple Valuation Perspectives**: 
   - Include ALL professional valuation figures mentioned (market value, reduced marketing period values, market rent, etc.)
   - For each valuation, extract and present its specific assumptions (vacant possession, marketing period, discounts, rationale)
   - Summarize assumptions clearly and concisely for each valuation scenario
   - State the primary market value first (with vacant possession), then other professional valuation scenarios
   - Present information naturally - focus on the figures and assumptions, not on explaining methodology

3. **Professional Qualifications**: 
   - Include valuer name, qualifications (MRICS/FRICS), firm name
   - Mention who conducted the valuation/inspection
   - Include professional credentials when available

4. **Date & Context**: 
   - State valuation date, report date, inspection date
   - Include temporal context (e.g., "as at 12 February 2024")
   - Mention if dates differ between documents

5. **Risk Factors & Caveats**: 
   - Mention material risks, limitations, special assumptions
   - Include any warnings or disclaimers
   - Note any conditions affecting the valuation

6. **Comparable Evidence**: 
   - Reference comparable properties used in valuation (if applicable)
   - Mention number of comparables and their relevance
   - Note any adjustments made to comparables

7. **Professional Format**: 
   - Use RICS Red Book terminology and structure
   - Follow professional valuation report format
   - Maintain consistency with industry standards

**FORMATTING GUIDELINES**:
When presenting valuation information, organize it clearly and comprehensively:

- Start with the primary Market Value (with vacant possession and normal marketing period) - this is typically the main valuation figure
- For each valuation scenario, clearly state the valuation figure and its specific assumptions
- List all additional valuation perspectives separately (reduced marketing periods, market rent, etc.)
- Do NOT include "under offer" prices as valuation figures - they are market activity, not professional valuations
- Include professional information (valuer name, qualifications, firm name)
- State all assumptions and conditions clearly
- Mention any risk factors, caveats, or limitations
- Include professional information (valuer name, qualifications, firm name) naturally within the response
- Present information in a flowing, natural narrative style

**CRITICAL**: If you find multiple valuation figures in the document, you MUST list ALL of them with their assumptions. Include every valuation perspective found (primary Market Value, reduced marketing period values, market rent, etc.) with their full written form and summarized assumptions. Present information naturally in a flowing narrative style, not as instructions or explanations of methodology.
"""


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


# ============================================================================
# CITATION MAPPING PROMPTS
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

### ⚠️ MANDATORY TASK: Extract Citations (REQUIRED TOOL CALLS)

**YOU MUST CALL THE cite_source TOOL. THIS IS NOT OPTIONAL.**

The system is configured to REQUIRE tool calls. You cannot proceed without calling cite_source for every factual claim.

**WHAT IS A FACTUAL CLAIM?**
Any specific information that answers the user's question, including:
- **Values/Amounts**: Prices, valuations, measurements, dimensions, quantities
- **Dates**: When something happened, dates of reports, inspection dates
- **Names**: Valuers, appraisers, inspectors, parties involved
- **Addresses**: Property addresses, locations
- **Assessments**: Professional opinions, valuations, conditions, ratings
- **Details**: Property features, specifications, characteristics
- **Any specific data point** that directly answers the question

**WORKFLOW (FOLLOW EXACTLY):**
1. Read through ALL document extracts carefully
2. Identify EVERY factual claim that is relevant to the user's question
3. For EACH factual claim, you MUST call cite_source tool with:
   - **block_id**: The BLOCK_CITE_ID from the <BLOCK> tag (e.g., "BLOCK_CITE_ID_42")
   - **citation_number**: Sequential number starting from 1 (1, 2, 3, 4, 5...)
   - **cited_text**: The specific factual claim (the exact text or your paraphrase)

**EXAMPLES:**

Example 1 - Valuation:
- You see: <BLOCK id="BLOCK_CITE_ID_42">Content: "Market Value: £2,400,000 as of 12th February 2024"</BLOCK>
- You MUST call: cite_source(cited_text="Market Value: £2,400,000", block_id="BLOCK_CITE_ID_42", citation_number=1)
- You MUST call: cite_source(cited_text="Valuation date: 12th February 2024", block_id="BLOCK_CITE_ID_42", citation_number=2)

Example 2 - Names:
- You see: <BLOCK id="BLOCK_CITE_ID_15">Content: "Valuation conducted by Sukhbir Tiwana MRICS"</BLOCK>
- You MUST call: cite_source(cited_text="Valuer: Sukhbir Tiwana MRICS", block_id="BLOCK_CITE_ID_15", citation_number=3)

Example 3 - Multiple Values:
- You see: <BLOCK id="BLOCK_CITE_ID_7">Content: "90-day value: £1,950,000. 180-day value: £2,050,000"</BLOCK>
- You MUST call: cite_source(cited_text="90-day marketing period value: £1,950,000", block_id="BLOCK_CITE_ID_7", citation_number=4)
- You MUST call: cite_source(cited_text="180-day marketing period value: £2,050,000", block_id="BLOCK_CITE_ID_7", citation_number=5)

**CRITICAL RULES:**
1. ✅ Call cite_source for EVERY factual claim (minimum 3-5 citations for most queries)
2. ✅ Use sequential citation numbers (1, 2, 3, 4, 5...)
3. ✅ Find the BLOCK_CITE_ID in the <BLOCK> tags from the document extracts
4. ✅ Extract citations for ALL relevant information, not just one piece
5. ❌ Do NOT write an answer yet - ONLY extract citations by calling the tool
6. ❌ Do NOT skip citations - if you see multiple values, cite each one
7. ❌ Do NOT finish without calling the tool - tool calls are MANDATORY

**START NOW: Begin extracting citations by calling cite_source for each factual claim you find.**"""


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
    
    # Check if this is a valuation query and add valuation extraction instructions
    is_valuation_query = any(term in user_query.lower() for term in ['valuation', 'value', 'price', 'worth', 'cost'])
    valuation_instructions = ""
    if is_valuation_query:
        valuation_instructions = _get_valuation_extraction_instructions(detail_level='detailed', is_valuation_query=True)
        valuation_instructions = f"\n{valuation_instructions}\n"
    
    return f"""**USER QUESTION:**  
"{user_query}"

**CONVERSATION HISTORY:**  
{conversation_history}

**DOCUMENT CONTENT EXTRACTS:**  
{formatted_outputs}

{citation_list}
{valuation_instructions}
### TASK: Create Final Answer with Citations

Create a comprehensive answer to the user's question using the document extracts above.

CITATION USAGE (CRITICAL - READ CAREFULLY):
- Citations have already been extracted (see list above)
- You MUST use the EXACT citation numbers that were extracted
- Format: Use individual superscript characters, NOT combined:
  - For Citation 1 → use ¹ (single character)
  - For Citation 2 → use ² (single character)  
  - For Citation 3 → use ³ (single character)
  - For Citation 4 → use ⁴ (single character)
  - For Citation 5 → use ⁵ (single character)
  - etc.
- IMPORTANT: If you need to cite multiple sources for one fact, use separate superscripts with SPACES: ¹ ² ³ (three separate characters with spaces between them)
- DO NOT use combined Unicode like ¹² or ¹²³ (which means 12 or 123) - ALWAYS use individual characters with spaces: ¹ ² ³
- EXAMPLE: "regulated by RICS¹ ² ³" NOT "regulated by RICS¹²³"
- Place superscripts immediately after the relevant information
- Every factual claim MUST have a superscript matching its citation number from the list above

INSTRUCTIONS:
1. **Answer the user's question directly and comprehensively** - the information IS available in the document extracts above
2. **CRITICAL: If citations were extracted (see list above), the information EXISTS in the documents** - you MUST use it
3. **NEVER say "information not provided" or "not available"** if citations were extracted - the data is in the document extracts
4. **For valuation queries, you MUST extract and include:**
   - **Market Value** (the primary valuation figure)
   - **All valuation scenarios** (e.g., 90-day, 180-day marketing periods)
   - **Valuation assumptions** (basis of valuation, assumptions made)
   - **Valuation date**
   - **Valuer details** (name, qualifications, firm)
   - **Any other relevant valuation information**
5. **Extract and include ALL relevant information**: prices, valuations, amounts, dates, names, addresses, assumptions, etc.
6. **Include superscript citations** (¹, ², ³, etc.) matching the citation numbers from the extracted citations list above
7. **Be professional, factual, and detailed** - include all relevant figures, dates, names, and details
8. **Do NOT repeat the question** - start directly with the answer
9. **Look carefully in the DOCUMENT CONTENT EXTRACTS section** - search through ALL the content, not just the first few lines
10. **If you see valuation-related terms** (Market Value, valuation, price, amount, £, assumptions, basis of valuation), extract that information

Answer:"""


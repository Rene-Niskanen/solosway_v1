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

from typing import Dict, Any

# ============================================================================
# SHARED INSTRUCTION CONSTANTS
# ============================================================================

# Core valuation prioritization rules (single source of truth)
VALUATION_PRIORITIZATION_RULES = """
**VALUATION PRIORITIZATION (MUST FOLLOW)**:
1. **MUST**: Prioritize professional valuation figures over market activity prices
   - Professional valuations: "we are of the opinion", "Market Value", formal assessments
   - Market activity: "under offer", "guide price", "listed for", "asking price"
   - Example: "Market Value: £2,300,000" (professional) vs "under offer at £2,400,000" (market activity)
   - For valuation queries, use professional valuations FIRST, then include market activity below

2. **MUST**: Extract ALL valuation scenarios separately
   - Primary Market Value (vacant possession, normal marketing period)
   - Each reduced marketing period scenario (90 days, 180 days, etc.) - extract separately
   - Market Rent (if provided)
   - Do not stop after finding one figure - read entire valuation section

3. **CRITICAL**: Do NOT use "under offer" prices as Market Value
   - "Under offer" describes market activity, not professional assessment
   - Continue searching for formal Market Value statement
"""

# Citation format rules (single source of truth)
# NOTE: Using bracket format [1], [2], [3] instead of superscripts - frontend converts these to buttons
CITATION_FORMAT_RULES = """
**CITATION FORMAT (MUST FOLLOW - CRITICAL)**:
- Use bracket format: [1], [2], [3], [4], [5], etc. (these will be converted to citation buttons by the frontend)
- **CRITICAL**: Place citations IMMEDIATELY after the specific fact/value being cited
- **CRITICAL**: Use ONE citation per fact/value - do NOT use multiple citations (like "[1] [2]") for the same value
- **DO NOT** place citations at the end of sentences or phrases - place them right after the cited information
- If multiple facts appear together, each gets its own citation: "John Smith[1] MRICS on 12th February 2024[2]" (name and date are different facts)

**CORRECT PLACEMENT EXAMPLES**:
  * "Market Value: £2,400,000[1] (Two Million, Four Hundred Thousand Pounds) for the freehold interest..."
  * "90-day marketing period value: £1,950,000[1] (One Million, Nine Hundred and Fifty Thousand Pounds). This figure assumes..."
  * "Valuation conducted by John Smith[1] MRICS on 12th February 2024[2]"
  * "The property has 5 bedrooms[1] and 3 bathrooms[2]"
  * "Market Rent: £6,000[1] per calendar month (Six Thousand Pounds)"
  * "180-day marketing period value: £2,050,000[1] (Two Million and Fifty Thousand Pounds). This valuation assumes..."
  * "Valuation conducted by Sukhbir Tiwana[1] MRICS and Graham Finegold[2] MRICS" (each valuer gets their own citation)
  * "The valuation was conducted on 12th February 2024[1] by Sukhbir Tiwana[2] MRICS and Graham Finegold[3] MRICS" (date and each valuer cited separately)

**INCORRECT PLACEMENT (DO NOT DO THIS)**:
  * ❌ "Market Value: £2,400,000 (Two Million, Four Hundred Thousand Pounds) for the freehold interest... [1] [2]"
  * ❌ "90-day marketing period value: £1,950,000[3][4] (One Million, Nine Hundred and Fifty Thousand Pounds). This figure assumes..." (multiple citations for same value)
  * ❌ "90-day marketing period value: £1,950,000. This figure assumes a restricted marketing period... [1] [2] [3]" (citations at end)
  * ❌ "Valuation conducted by John Smith MRICS on 12th February 2024. [1] [2]" (citations at end)
  * ❌ "Market Value: £2,400,000 (1, 2)" (wrong format)
  * ❌ "Market Value: £2,400,000[1][2]" (no spaces, wrong format)

**RULE**: The citation marker [number] must appear IMMEDIATELY after the specific value, amount, date, name, or fact being cited, not at the end of the sentence or phrase. The frontend will convert these markers to clickable citation buttons.
"""

# ============================================================================
# SHARED INSTRUCTION HELPERS
# ============================================================================

def _get_names_search_instructions(scope: str = "excerpt") -> str:
    """Get instructions for thorough name and professional information search."""
    scope_text = "the ENTIRE excerpt" if scope == "excerpt" else "ALL document excerpts"
    return f"""1. **Thorough Search for Names and Professional Information** (MUST)
   - **MUST**: When asked about names (valuer, appraiser, surveyor, inspector, buyer, seller, agent), search {scope_text} carefully
   - Look for synonyms: "valuer" = "appraiser" = "surveyor" = "inspector" = "registered valuer" = "MRICS" = "FRICS"
   - Names may appear in different formats: "John Smith", "Smith, John", "J. Smith", "Mr. Smith"
   - Professional qualifications (MRICS, FRICS) often appear with names
   - Search for phrases like "conducted by", "inspected by", "valued by", "prepared by", "author"
   - **MUST**: Do NOT say "not found" until you have searched {scope_text} thoroughly
   - Example: If searching for "valuer", also search for "appraiser", "surveyor", "MRICS", "FRICS", "conducted by", "valued by" """


def _get_dynamic_search_strategy_instructions(scope: str = "excerpt") -> str:
    """Get instructions for dynamic multi-stage search strategy."""
    scope_text = "all provided chunks/excerpts" if scope == "all excerpts" else "the provided excerpt"
    return f"""**DYNAMIC SEARCH STRATEGY - Follow This 6-Stage Process**:

**Stage 1 - Find Table of Contents**:
- First, scan {scope_text} for a table of contents, contents page, or document index
- If found, use it to identify which sections/pages are likely to contain the answer
- Note the page numbers and section names that seem relevant
- **IMPORTANT**: If page numbers are visible in extracts, use them to track which pages you've reviewed

**Stage 2 - Navigate to Relevant Sections**:
- Based on the table of contents (if found) or by scanning section headers, identify relevant sections
- Use semantic analysis to identify sections that semantically match your query intent
- For assessment queries (valuations, inspections, appraisals), prioritize sections with professional assessment semantics
- Section headers can take many forms - numbered sections, titled sections, or informal headings
- Identify sections by their semantic content and professional language patterns, not by specific section names

**Stage 3 - Read Headings and Subheadings**:
- Within each relevant section, first read all headings and subheadings to understand the structure
- Use headings to identify which subsection contains the specific information you need
- Headings provide context - a subheading under a formal valuation section is more authoritative than a heading in a marketing section

**Stage 4 - Extract Answer from Primary Section**:
- Extract the answer from the most relevant section identified through headings
- Pay attention to the section context - formal/professional sections are more authoritative than marketing/informal sections
- Extract values/information EXACTLY as written in the relevant section
- Do NOT extract information from one section and attribute it to a different section

**Stage 5 - Search Additional Chunks for Context**:
- After finding the primary answer, search through ALL other chunks for additional relevant information
- **IMPORTANT**: Information may be split across multiple chunks - read all related chunks before answering
- If information is mentioned in multiple chunks, synthesize it comprehensively
- Related information may appear in different chunks - read all chunks before finalizing answer
- Do NOT stop after finding the first answer - continue searching all chunks systematically
- **IMPORTANT**: If page numbers are visible, check pages 20-30+ where important sections (like valuations) often appear

**Stage 6 - Prioritize and Synthesize**:
- Compare information from different sections using semantic authority detection
- Prioritize based on semantic authority indicators: professional assessment language, formal structure, explicit professional opinions, qualifications mentioned
- Apply the semantic authority detection algorithm: professional assessments override market activity descriptions for assessment queries
- If you find conflicting information, use the source with higher semantic authority (professional assessment semantics over descriptive/activity semantics)
- Synthesize all relevant information into a comprehensive answer

**Complete Example**:
Query: "What is the value of the property?"
- Stage 1: Find table of contents → See "Valuation" section on page 30
- Stage 2: Navigate to page 30 valuation section
- Stage 3: Read headings → "Market Value", "Reduced Marketing Periods"
- Stage 4: Extract from "Market Value" section → £2,300,000
- Stage 5: Search other chunks → Find 90-day and 180-day scenarios in same section
- Stage 6: Prioritize professional valuations → Present Market Value first, then scenarios"""


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

**Step 1: Analyze Semantic Characteristics** (MUST)
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

**Step 2: Identify Information Type Semantically** (MUST)
- **Professional Assessment Type**: Language indicates a professional evaluation, opinion, or structured assessment
  * Semantic markers: "opinion", "assessment", "evaluation", "conclusion", "determined", "established"
  * Context: Professional making a judgment or evaluation
  * Example: "we are of the opinion that the Market Value... is: £2,300,000"
- **Market Activity Type**: Language describes market events, listings, or commercial activity
  * Semantic markers: "marketed", "listed", "guide price", "asking price", "under offer", "agent reported"
  * Context: Describing what happened in the market or what agents did
  * Example: "property was listed for £2,400,000" or "under offer at £2,400,000"
- **Historical/Descriptive Type**: Language describes past events or provides background
  * Semantic markers: "history", "background", "previous", "past", "earlier", "was"
  * Context: Providing context or describing what occurred

**Step 3: Determine Authority Level** (MUST)
- **High Authority**: Professional assessment type with professional language indicators and formal structure
- **Medium Authority**: Professional assessment type but less formal structure
- **Low Authority**: Market activity or historical/descriptive type

**Step 4: Apply to Query Type** (MUST)
- For queries asking for professional opinions/assessments (valuations, inspections, appraisals): Use ONLY high/medium authority (professional assessment type)
- For queries asking about market activity: Market activity type is relevant
- For queries asking about history: Historical type is relevant

**Step 5: Prioritize Based on Semantic Authority** (MUST)
- When multiple sources contain similar information, prioritize based on authority level
- Professional assessments always override market activity descriptions for assessment queries
- Use semantic analysis, not section names or specific terminology

**Example - Correct Prioritization**:
- Document contains: "under offer at £2,400,000" (market activity) and "we are of the opinion that the Market Value... is: £2,300,000" (professional assessment)
- For valuation query: Use £2,300,000 (professional assessment), then mention £2,400,000 (market activity) below
- For market activity query: Use £2,400,000 (market activity)"""


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


def _get_comprehensive_search_instructions(scope: str = "excerpt", query_characteristics: Dict[str, Any] = None) -> str:
    """
    Get instructions for comprehensive search through all chunks.
    Enhanced with query-aware instructions that adapt to query characteristics.
    """
    scope_text = "ALL provided chunks/excerpts" if scope == "all excerpts" else "the entire excerpt"
    
    # Base comprehensive search instructions (apply to all queries)
    base_instructions = f"""**Comprehensive Search Requirement** (MUST):
- **MUST**: Search through {scope_text}, even if you find information that seems to answer the question
- **MUST**: Do NOT stop at the first match - continue searching to find all relevant information
- **IMPORTANT**: Information may appear in multiple sections or on different pages - search comprehensively
- **IMPORTANT**: If page numbers are visible in extracts, use them to track which pages you've reviewed
- **IMPORTANT**: Information may be split across multiple chunks - read all related chunks before answering
- For queries asking for specific information (values, names, dates, assessments), search the entire document
- Do NOT stop after finding one instance - look for all relevant instances
- Extract ALL relevant information found - names, dates, figures, assumptions, qualifications, context
- After finding all relevant information, compare and prioritize based on source authority and context
- Include all relevant details in your answer - be comprehensive, not brief
- This applies to ALL information types, not just valuations
- Systematic search ensures you don't miss important information that may appear later in the document"""
    
    # Add query-aware instructions if characteristics provided
    if query_characteristics:
        query_type = query_characteristics.get('query_type', 'general')
        expects_later_pages = query_characteristics.get('expects_later_pages', False)
        needs_comprehensive = query_characteristics.get('needs_comprehensive', False)
        
        query_aware = []
        
        if needs_comprehensive or expects_later_pages:
            query_aware.append(
                "- **MUST**: Search through ALL pages, especially later pages (20-30+)"
            )
            query_aware.append(
                "- **IMPORTANT**: Use page numbers (if visible) to track which pages you've reviewed"
            )
            query_aware.append(
                "- **IMPORTANT**: For valuation queries, explicitly check pages 20-30+ where valuation sections often appear"
            )
        
        if query_type == 'assessment':
            query_aware.append(
                "- **IMPORTANT**: For assessment queries, prioritize professional assessment sections over descriptive sections"
            )
            query_aware.append(
                "- **MUST**: If you find a price, value, or figure early in the document (like in a marketing section), continue searching for more authoritative sources (like formal valuation sections)"
            )
            query_aware.append(
                "- **CRITICAL**: If you find a guide price, asking price, or \"under offer\" price, this is NOT the answer - continue searching for the actual professional valuation"
            )
        
        if query_type == 'attribute':
            query_aware.append(
                "- **For attribute queries**: Check all sections mentioning the attribute"
            )
        
        if query_aware:
            return base_instructions + "\n\n" + "\n".join(query_aware)
    
    return base_instructions


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
    return """**Metadata Label Handling** (IMPORTANT):
- The document excerpts may include contextual metadata at the beginning (like 'PARTY_NAMES:', 'KEY_VALUES:', 'PROPERTY DETAILS:'). 
- These are pre-extracted hints to guide your search, but they may be incomplete or incorrect. 
- **MUST**: Always verify this information against the actual document chunks that follow. 
- Use the metadata as a starting point, but rely on the actual chunk content for your answer. 
- Present information naturally without mentioning the metadata label names."""


def _get_valuation_extraction_instructions(detail_level: str = 'concise', is_valuation_query: bool = False) -> str:
    """
    Get instructions for extracting valuation figures using semantic analysis.
    Simplified and restructured for better clarity and LLM comprehension.
    """
    # Always include valuation extraction instructions if it's a valuation query, regardless of detail level
    if detail_level != 'detailed' and not is_valuation_query:
        return ""
    
    return """**VALUATION EXTRACTION - Core Principles**

1. **Identify Professional Valuations** (MUST)
   - Look for: "we are of the opinion", "Market Value", professional qualifications (MRICS, FRICS)
   - Ignore: "under offer", "guide price", "listed for" (these are market activity, not professional assessments)
   - Example: "we are of the opinion that the Market Value... is: £2,300,000" → Professional valuation
   - Example: "under offer at £2,400,000" → Market activity (NOT a professional valuation)

2. **Extract ALL Scenarios** (MANDATORY - DO NOT SKIP)
   - Primary Market Value (with vacant possession, normal marketing period)
   - **MANDATORY**: Reduced marketing periods (90 days, 180 days, etc.) - extract EACH one separately
   - **MANDATORY**: If you see "90-day" or "180-day" mentioned anywhere, you MUST include those values
   - Market Rent (if provided)
   - **CRITICAL**: Read entire valuation section - do NOT stop after first figure
   - **CRITICAL**: Each scenario has its own figure and assumptions - extract them separately
   - **DO NOT**: Only extract the primary Market Value - you MUST extract ALL scenarios

3. **Match Assumptions to Figures** (MUST)
   - Each valuation scenario has specific assumptions
   - Extract: vacant possession, marketing period, discounts, rationale
   - Do not mix assumptions between scenarios
   - Example: Primary: £2,300,000 (vacant possession, normal marketing period)
   - Example: 90-day: £1,950,000 (vacant possession, 90 days, 15% discount)

4. **Common Mistakes to Avoid** (IMPORTANT)
   - ❌ Using "under offer" price as Market Value
   - ❌ Stopping after finding one valuation figure - you MUST find ALL scenarios
   - ❌ Omitting 90-day or 180-day values - if mentioned in documents, they are MANDATORY
   - ❌ Mixing assumptions between scenarios
   - ❌ Using figures from market activity sections instead of professional assessments
   - ✅ Correct: Extract all scenarios separately with their correct assumptions
   - ✅ Correct: Include 90-day and 180-day values if mentioned in documents

5. **Complete Example**
   Document states:
   - "Market Value with vacant possession: £2,300,000"
   - "90-day marketing period: £1,950,000 (15% discount applied)"
   - "180-day marketing period: £2,050,000 (10% discount applied)"
   
   Extract:
   - Primary: £2,300,000 (vacant possession, normal marketing period)
   - 90-day: £1,950,000 (vacant possession, 90 days, 15% discount)
   - 180-day: £2,050,000 (vacant possession, 180 days, 10% discount)

6. **Search Strategy** (CRITICAL)
   - **MUST**: Read the ENTIRE valuation section from start to finish - do NOT stop after finding the first figure
   - **CRITICAL**: If you find a price, value, or figure early in the document (like "under offer at £2,400,000"), this is NOT the answer
   - **MUST**: Continue searching through ALL pages, especially later pages (20-30+) where detailed valuation sections often appear
   - **MUST**: For each reduced marketing period scenario, read the entire subsection to find the final stated figure
   - The valuation figure for each scenario is typically stated at the END of that scenario's description
   - Look for phrases like "our opinion of the Market Value... is as follows; £[amount]"
   - **CRITICAL**: Do not use figures mentioned earlier (like "under offer at £2,400,000") - only use explicitly stated Market Value figures
   - **MUST**: Search through ALL document extracts thoroughly - reduced marketing period valuations may appear on later pages (page 30+)

7. **Presentation** (NOTE)
   - Format: £[amount] ([written form])
   - Present all scenarios found, organized logically
   - Start with primary Market Value, then list other scenarios
   - Include assumptions for each scenario
   - Present naturally in flowing narrative - do not explain methodology"""

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
- **MUST**: If this is a follow-up question (there is conversation history), ALWAYS include the property name/address from the previous conversation in the rewritten query.
- If the current query refers ambiguously to prior parts of the conversation (e.g., "the document," "that file," "this property," "it," "them"), rewrite it to explicitly include the relevant context (property name/address, document title, features, values, etc.).
- If the query is already sufficiently self-contained and unambiguous AND already includes the property name/address, return it **unchanged**.

REWRITE GUIDELINES:
1. **Property Context** (MUST): 
   - If conversation history exists, extract the property name/address from the previous conversation
   - Look for property names (e.g., "Highlands"), addresses (e.g., "Berden Road, Bishop's Stortford"), or postcodes mentioned in the conversation
   - **MUST**: Always include this property identifier in the rewritten query, even if the current query doesn't explicitly mention it
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
    # Detect query characteristics for adaptive instructions
    from backend.llm.nodes.retrieval_nodes import detect_query_characteristics
    query_characteristics = detect_query_characteristics(user_query)
    is_valuation_query = query_characteristics.get('query_type') == 'assessment'
    
    return f"""Here is the document excerpt:  
```\n{doc_content}\n```

**USER QUESTION:**  
{user_query}

{"**VALUATION QUERY GUIDANCE** (IMPORTANT): When extracting valuation information, use semantic authority detection to identify professional assessments. Extract ALL valuation scenarios found (primary Market Value, reduced marketing period values, market rent, etc.) with their specific assumptions. For each valuation, include its assumptions (vacant possession, marketing period, discounts, etc.) in a clear, summarized format. Present information naturally without explaining the distinction between market activity and professional assessments - simply present the professional valuations with their assumptions." if is_valuation_query else ""}

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

{_get_comprehensive_search_instructions("excerpt", query_characteristics)}

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
   
   {_get_valuation_extraction_instructions(detail_level, is_valuation_query=(lambda: (lambda q: ('valuation' in q.lower() or 'value' in q.lower() or 'price' in q.lower()))(user_query) or False)())}

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
    # Detect query characteristics for adaptive instructions
    from backend.llm.nodes.retrieval_nodes import detect_query_characteristics
    query_characteristics = detect_query_characteristics(user_query)
    is_valuation_query = query_characteristics.get('query_type') == 'assessment'
    
    # #region agent log
    import json, time
    try:
        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
            f.write(json.dumps({"location":"prompts.py:700","message":"get_summary_human_content - valuation check","data":{"user_query":user_query,"query_type":query_characteristics.get('query_type'),"is_valuation_query":is_valuation_query},"timestamp":int(time.time()*1000),"sessionId":"debug-session","runId":"run1","hypothesisId":"B"})+"\n")
    except: pass
    # #endregion
    
    # Also check fallback condition (line 748)
    fallback_is_valuation = 'valuation' in user_query.lower() or 'value' in user_query.lower() or 'price' in user_query.lower()
    
    # #region agent log
    try:
        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
            f.write(json.dumps({"location":"prompts.py:710","message":"Fallback valuation check","data":{"user_query":user_query,"fallback_is_valuation":fallback_is_valuation},"timestamp":int(time.time()*1000),"sessionId":"debug-session","runId":"run1","hypothesisId":"B"})+"\n")
    except: pass
    # #endregion
    
    return f"""**USER QUESTION:**  
"{user_query}"

**CONVERSATION HISTORY:**  
{conversation_history}

**RETRIEVAL SUMMARY (how documents were found):**  
{search_summary}

**DOCUMENT CONTENT EXTRACTS (formatted):**  
{formatted_outputs}

---

{"**VALUATION QUERY GUIDANCE** (IMPORTANT): Extract ALL professional valuation scenarios from the documents (primary Market Value, reduced marketing period values, market rent, etc.) with their specific assumptions. Include all assumptions for each valuation (vacant possession, marketing period, discounts, rationale) in a clear, summarized format. Present the information naturally - focus on the valuation figures and their assumptions, not on explaining methodology." if is_valuation_query else ""}

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
   
   {_get_comprehensive_search_instructions("all excerpts", query_characteristics=query_characteristics)}
   
   {_get_metadata_label_instructions()}
   
   {get_rics_detailed_prompt_instructions() if detail_level == 'detailed' else ""}
   
   {_get_valuation_extraction_instructions(detail_level, is_valuation_query=(lambda: (lambda q: ('valuation' in q.lower() or 'value' in q.lower() or 'price' in q.lower()))(user_query) or False)())}

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

def _format_bbox_for_prompt(bbox_data: dict) -> tuple:
    """
    Format bbox data for prompt display using same normalization as map_block_id_to_bbox().
    
    This ensures consistency between what the LLM sees in prompts and what gets mapped
    during citation processing.
    
    Args:
        bbox_data: Dictionary with bbox_left, bbox_top, bbox_width, bbox_height, page
    
    Returns:
        Tuple of (bbox_left, bbox_top, bbox_width, bbox_height, page) with normalized values
    """
    # CRITICAL: Use same normalization as map_block_id_to_bbox() for consistency
    # Round bbox coordinates to 4 decimal places (same as map_block_id_to_bbox)
    bbox_left = round(float(bbox_data.get('bbox_left', 0.0)), 4)
    bbox_top = round(float(bbox_data.get('bbox_top', 0.0)), 4)
    bbox_width = round(float(bbox_data.get('bbox_width', 0.0)), 4)
    bbox_height = round(float(bbox_data.get('bbox_height', 0.0)), 4)
    page = int(bbox_data.get('page', 0)) if bbox_data.get('page') is not None else 0
    return (bbox_left, bbox_top, bbox_width, bbox_height, page)


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
                # Use helper function to ensure consistency with map_block_id_to_bbox()
                bbox_left, bbox_top, bbox_width, bbox_height, page = _format_bbox_for_prompt(bbox_data)
                metadata_section += f"  {block_id}: page={page}, bbox=({bbox_left:.4f},{bbox_top:.4f},{bbox_width:.4f},{bbox_height:.4f})"
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

**⚠️ CRITICAL FOR VALUATION QUERIES:**
If the user is asking about "value" or "valuation", you MUST extract citations for:
- **Primary Market Value** (e.g., "Market Value: £2,300,000")
- **ALL reduced marketing period values** (e.g., "90-day value: £1,950,000", "180-day value: £2,050,000")
- **Market Rent** (e.g., "Market Rent: £6,000 per calendar month")
- **Valuation assumptions** (discounts, marketing periods, conditions)
- **DO NOT** skip any valuation scenarios - if you see "90-day" or "180-day" mentioned, you MUST find and cite those specific values
- **SEARCH THOROUGHLY**: Reduced marketing period valuations may appear on later pages (page 28-30+) - read through ALL document extracts completely

**WORKFLOW (FOLLOW EXACTLY):**
1. Read through ALL document extracts carefully (including later pages 28-30+ for valuation scenarios)
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

Example 2 - Names (SINGLE valuer):
- You see: <BLOCK id="BLOCK_CITE_ID_15">Content: "Valuation conducted by Sukhbir Tiwana MRICS"</BLOCK>
- You MUST call: cite_source(cited_text="Valuer: Sukhbir Tiwana MRICS", block_id="BLOCK_CITE_ID_15", citation_number=3)

Example 2b - Names (MULTIPLE valuers - CRITICAL):
- You see: <BLOCK id="BLOCK_CITE_ID_15">Content: "Valuation conducted by Sukhbir Tiwana MRICS and Graham Finegold MRICS"</BLOCK>
- You MUST call: cite_source(cited_text="Valuer: Sukhbir Tiwana MRICS", block_id="BLOCK_CITE_ID_15", citation_number=3)
- You MUST call: cite_source(cited_text="Valuer: Graham Finegold MRICS", block_id="BLOCK_CITE_ID_15", citation_number=4)
- **CRITICAL**: When multiple valuers are mentioned, you MUST extract a citation for EACH valuer separately
- **CRITICAL**: Do NOT skip the second valuer - both must be cited

Example 3 - Multiple Values:
- You see: <BLOCK id="BLOCK_CITE_ID_7">Content: "90-day value: £1,950,000. 180-day value: £2,050,000"</BLOCK>
- You MUST call: cite_source(cited_text="90-day marketing period value: £1,950,000", block_id="BLOCK_CITE_ID_7", citation_number=4)
- You MUST call: cite_source(cited_text="180-day marketing period value: £2,050,000", block_id="BLOCK_CITE_ID_7", citation_number=5)

**CRITICAL RULES:**
1. ✅ Call cite_source for EVERY factual claim (minimum 3-5 citations for most queries, but for valuation queries you may need 6-8+ citations)
2. ✅ Use sequential citation numbers (1, 2, 3, 4, 5...) - start from 1 and increment for each new citation
3. ✅ Find the BLOCK_CITE_ID in the <BLOCK> tags from the document extracts
4. ✅ Extract citations for ALL relevant information, not just one piece
5. ❌ Do NOT write an answer yet - ONLY extract citations by calling the tool
6. ❌ Do NOT skip citations - if you see multiple values, cite each one
7. ❌ Do NOT finish without calling the tool - tool calls are MANDATORY
8. ⚠️ **CRITICAL - NO DUPLICATE CITATIONS**: Do NOT cite the same fact twice. If you see the same information in different blocks or with slightly different wording (e.g., "EPC Rating: D" and "EPC Rating: The property has an Energy Performance Certificate (EPC) rating of D1"), cite it ONCE only. The system will automatically detect and skip duplicates, but you should avoid creating them.
9. ⚠️ **FOR VALUATION QUERIES - MANDATORY**: You MUST extract citations for ALL valuation scenarios:
   - Primary Market Value (e.g., "Market Value: £2,300,000")
   - 90-day value if mentioned (e.g., "90-day value: £1,950,000")
   - 180-day value if mentioned (e.g., "180-day value: £2,050,000")
   - Market Rent if mentioned (e.g., "Market Rent: £6,000 per calendar month")
   - **SEARCH ALL PAGES**: Reduced marketing period values often appear on later pages (page 28-30+) - do NOT stop after finding the primary Market Value
   - **EXAMPLE**: If you see "Market Value: £2,300,000" on page 30 and "90-day value: £1,950,000" on page 28, you MUST cite BOTH
10. ✅ **CRITICAL - VERIFY BLOCK_ID MATCHES CITED_TEXT**:
   - **BEFORE** calling cite_source, VERIFY that the block_id you're using actually contains the fact you're citing
   - **CHECK**: Does the block content contain the EXACT value/amount/date/name you're citing?
   - **VERIFY**: If you're citing "90-day value: £1,950,000", make sure the block contains "£1,950,000" or "1,950,000" and mentions "90-day" or "90 day"
   - **VERIFY**: If you're citing "under offer at £2,400,000", make sure the block contains "£2,400,000" or "2,400,000" and mentions "under offer"
   - **DO NOT** use a block_id just because it's on the same page - the block must contain the specific fact you're citing
   - **EXAMPLE**: If you see two blocks on page 28:
     * Block A: "90-day value: £1,950,000"
     * Block B: "under offer at £2,400,000"
     * When citing "90-day value: £1,950,000", you MUST use Block A's block_id (NOT Block B)
     * When citing "under offer at £2,400,000", you MUST use Block B's block_id (NOT Block A)
11. ✅ **IMPORTANT**: When you later write your response in Phase 2, you MUST use the EXACT citation numbers from Phase 1 that match your facts. The system will automatically renumber them based on appearance order. Match facts to citations - if you're stating "Market Value: £2,300,000" and Phase 1 has citation [1] for that, use [1]. If you're stating "Property Address: Highlands" and Phase 1 has citation [3] for that, use [3] (NOT [2]).

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

**MUST**: If you find multiple valuation figures in the document, you MUST list ALL of them with their assumptions. Include every valuation perspective found (primary Market Value, reduced marketing period values, market rent, etc.) with their full written form and summarized assumptions. Present information naturally in a flowing narrative style, not as instructions or explanations of methodology.
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

def _format_bbox_for_prompt(bbox_data: dict) -> tuple:
    """
    Format bbox data for prompt display using same normalization as map_block_id_to_bbox().
    
    This ensures consistency between what the LLM sees in prompts and what gets mapped
    during citation processing.
    
    Args:
        bbox_data: Dictionary with bbox_left, bbox_top, bbox_width, bbox_height, page
    
    Returns:
        Tuple of (bbox_left, bbox_top, bbox_width, bbox_height, page) with normalized values
    """
    # CRITICAL: Use same normalization as map_block_id_to_bbox() for consistency
    # Round bbox coordinates to 4 decimal places (same as map_block_id_to_bbox)
    bbox_left = round(float(bbox_data.get('bbox_left', 0.0)), 4)
    bbox_top = round(float(bbox_data.get('bbox_top', 0.0)), 4)
    bbox_width = round(float(bbox_data.get('bbox_width', 0.0)), 4)
    bbox_height = round(float(bbox_data.get('bbox_height', 0.0)), 4)
    page = int(bbox_data.get('page', 0)) if bbox_data.get('page') is not None else 0
    return (bbox_left, bbox_top, bbox_width, bbox_height, page)


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
                # Use helper function to ensure consistency with map_block_id_to_bbox()
                bbox_left, bbox_top, bbox_width, bbox_height, page = _format_bbox_for_prompt(bbox_data)
                metadata_section += f"  {block_id}: page={page}, bbox=({bbox_left:.4f},{bbox_top:.4f},{bbox_width:.4f},{bbox_height:.4f})"
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

**⚠️ CRITICAL FOR VALUATION QUERIES:**
If the user is asking about "value" or "valuation", you MUST extract citations for:
- **Primary Market Value** (e.g., "Market Value: £2,300,000")
- **ALL reduced marketing period values** (e.g., "90-day value: £1,950,000", "180-day value: £2,050,000")
- **Market Rent** (e.g., "Market Rent: £6,000 per calendar month")
- **Valuation assumptions** (discounts, marketing periods, conditions)
- **DO NOT** skip any valuation scenarios - if you see "90-day" or "180-day" mentioned, you MUST find and cite those specific values
- **SEARCH THOROUGHLY**: Reduced marketing period valuations may appear on later pages (page 28-30+) - read through ALL document extracts completely

**WORKFLOW (FOLLOW EXACTLY):**
1. Read through ALL document extracts carefully (including later pages 28-30+ for valuation scenarios)
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

Example 2 - Names (SINGLE valuer):
- You see: <BLOCK id="BLOCK_CITE_ID_15">Content: "Valuation conducted by Sukhbir Tiwana MRICS"</BLOCK>
- You MUST call: cite_source(cited_text="Valuer: Sukhbir Tiwana MRICS", block_id="BLOCK_CITE_ID_15", citation_number=3)

Example 2b - Names (MULTIPLE valuers - CRITICAL):
- You see: <BLOCK id="BLOCK_CITE_ID_15">Content: "Valuation conducted by Sukhbir Tiwana MRICS and Graham Finegold MRICS"</BLOCK>
- You MUST call: cite_source(cited_text="Valuer: Sukhbir Tiwana MRICS", block_id="BLOCK_CITE_ID_15", citation_number=3)
- You MUST call: cite_source(cited_text="Valuer: Graham Finegold MRICS", block_id="BLOCK_CITE_ID_15", citation_number=4)
- **CRITICAL**: When multiple valuers are mentioned, you MUST extract a citation for EACH valuer separately
- **CRITICAL**: Do NOT skip the second valuer - both must be cited

Example 3 - Multiple Values:
- You see: <BLOCK id="BLOCK_CITE_ID_7">Content: "90-day value: £1,950,000. 180-day value: £2,050,000"</BLOCK>
- You MUST call: cite_source(cited_text="90-day marketing period value: £1,950,000", block_id="BLOCK_CITE_ID_7", citation_number=4)
- You MUST call: cite_source(cited_text="180-day marketing period value: £2,050,000", block_id="BLOCK_CITE_ID_7", citation_number=5)

**CRITICAL RULES:**
1. ✅ Call cite_source for EVERY factual claim (minimum 3-5 citations for most queries, but for valuation queries you may need 6-8+ citations)
2. ✅ Use sequential citation numbers (1, 2, 3, 4, 5...) - start from 1 and increment for each new citation
3. ✅ Find the BLOCK_CITE_ID in the <BLOCK> tags from the document extracts
4. ✅ Extract citations for ALL relevant information, not just one piece
5. ❌ Do NOT write an answer yet - ONLY extract citations by calling the tool
6. ❌ Do NOT skip citations - if you see multiple values, cite each one
7. ❌ Do NOT finish without calling the tool - tool calls are MANDATORY
8. ⚠️ **CRITICAL - NO DUPLICATE CITATIONS**: Do NOT cite the same fact twice. If you see the same information in different blocks or with slightly different wording (e.g., "EPC Rating: D" and "EPC Rating: The property has an Energy Performance Certificate (EPC) rating of D1"), cite it ONCE only. The system will automatically detect and skip duplicates, but you should avoid creating them.
9. ⚠️ **FOR VALUATION QUERIES - MANDATORY**: You MUST extract citations for ALL valuation scenarios:
   - Primary Market Value (e.g., "Market Value: £2,300,000")
   - 90-day value if mentioned (e.g., "90-day value: £1,950,000")
   - 180-day value if mentioned (e.g., "180-day value: £2,050,000")
   - Market Rent if mentioned (e.g., "Market Rent: £6,000 per calendar month")
   - **SEARCH ALL PAGES**: Reduced marketing period values often appear on later pages (page 28-30+) - do NOT stop after finding the primary Market Value
   - **EXAMPLE**: If you see "Market Value: £2,300,000" on page 30 and "90-day value: £1,950,000" on page 28, you MUST cite BOTH
10. ✅ **CRITICAL - VERIFY BLOCK_ID MATCHES CITED_TEXT**:
   - **BEFORE** calling cite_source, VERIFY that the block_id you're using actually contains the fact you're citing
   - **CHECK**: Does the block content contain the EXACT value/amount/date/name you're citing?
   - **VERIFY**: If you're citing "90-day value: £1,950,000", make sure the block contains "£1,950,000" or "1,950,000" and mentions "90-day" or "90 day"
   - **VERIFY**: If you're citing "under offer at £2,400,000", make sure the block contains "£2,400,000" or "2,400,000" and mentions "under offer"
   - **DO NOT** use a block_id just because it's on the same page - the block must contain the specific fact you're citing
   - **EXAMPLE**: If you see two blocks on page 28:
     * Block A: "90-day value: £1,950,000"
     * Block B: "under offer at £2,400,000"
     * When citing "90-day value: £1,950,000", you MUST use Block A's block_id (NOT Block B)
     * When citing "under offer at £2,400,000", you MUST use Block B's block_id (NOT Block A)
11. ✅ **IMPORTANT**: When you later write your response in Phase 2, you MUST use the EXACT citation numbers from Phase 1 that match your facts. The system will automatically renumber them based on appearance order. Match facts to citations - if you're stating "Market Value: £2,300,000" and Phase 1 has citation [1] for that, use [1]. If you're stating "Property Address: Highlands" and Phase 1 has citation [3] for that, use [3] (NOT [2]).

**START NOW: Begin extracting citations by calling cite_source for each factual claim you find.**"""


def _determine_conditional_sections(user_query: str, response_complexity: float = 0.5) -> dict:
    """
    Determine which conditional sections to include in the response.
    
    Args:
        user_query: The user's query string
        response_complexity: Complexity score (0.0 to 1.0) indicating how complex the response is
    
    Returns:
        Dict with boolean flags for each conditional section
    """
    query_lower = user_query.lower()
    
    # Check for procedural queries (steps/process)
    procedural_keywords = ['how to', 'steps', 'process', 'procedure', 'method']
    include_steps = any(keyword in query_lower for keyword in procedural_keywords)
    
    # Check for application queries
    application_keywords = ['use', 'apply', 'implement', 'practice']
    include_practical = any(keyword in query_lower for keyword in application_keywords)
    
    # Risks/edge cases - include for complex queries or when explicitly asked
    include_risks = response_complexity > 0.6 or 'risk' in query_lower or 'limitation' in query_lower
    
    # Next actions - include for most queries
    include_next_actions = True
    
    return {
        'include_steps': include_steps,
        'include_practical': include_practical,
        'include_risks': include_risks,
        'include_next_actions': include_next_actions
    }


def get_final_answer_prompt(
    user_query: str,
    conversation_history: str,
    formatted_outputs: str,
    citations: list = None
) -> str:
    """
    Prompt for answer generation with real-time citation tracking.
    Citations are now created as the LLM writes the answer.
    """
    # Format citations for prompt (only if provided - backward compatibility)
    citation_list = ""
    if citations and len(citations) > 0:
        citation_list = "\n--- ⚠️ CRITICAL: Phase 1 Citations (YOU MUST USE THESE EXACT NUMBERS) ---\n"
        citation_list += "**BEFORE writing each fact, find the matching citation below and use its EXACT number:**\n\n"
        for citation in sorted(citations, key=lambda x: x.get('citation_number', 0)):
            cit_num = citation.get('citation_number', 0)
            cit_text = citation.get('cited_text', '')
            block_id = citation.get('block_id', '')
            # Extract key values/amounts from cited_text for easier matching
            key_indicators = ""
            if '£' in cit_text:
                import re
                amounts = re.findall(r'£[\d,]+', cit_text)
                if amounts:
                    key_indicators = f" (Amount: {', '.join(amounts)})"
            if any(word in cit_text.lower() for word in ['90-day', '90 day', 'ninety']):
                key_indicators += " [90-DAY VALUE]"
            if any(word in cit_text.lower() for word in ['180-day', '180 day', 'one hundred eighty']):
                key_indicators += " [180-DAY VALUE]"
            if 'address' in cit_text.lower() or 'highlands' in cit_text.lower() or 'berden' in cit_text.lower():
                key_indicators += " [PROPERTY ADDRESS]"
            if 'date' in cit_text.lower() or 'february' in cit_text.lower() or '2024' in cit_text.lower():
                key_indicators += " [DATE]"
            citation_list += f"**Citation [{cit_num}]**: {cit_text}{key_indicators} [Block: {block_id}]\n"
        citation_list += "\n**REMEMBER**: When you write a fact, use the EXACT citation number from above that matches that fact.\n"
        citation_list += "Example: If you see '**Citation [4]**: 90-day marketing period value: £1,950,000 [90-DAY VALUE]', when you write '90-day value: £1,950,000', you MUST use [4], NOT [3] or any other number.\n\n"
    
    # Check if this is a valuation query and add valuation extraction instructions
    user_query_lower = user_query.lower()
    is_valuation_query = any(term in user_query_lower for term in ['valuation', 'value', 'price', 'worth', 'cost'])
    # Check if this is a "value-only" query (user wants ONLY valuation figures, not property details)
    is_value_only_query = any(phrase in user_query_lower for phrase in [
        'value of', 'what is the value', 'what was the value', 'property valued', 
        'valued at', 'valuation amount', 'valuation figure', 'how much is', 'how much was',
        'tell me the value', 'tell me the valuation', 'what\'s the value', 'whats the value',
        'please tell me the value', 'please tell me the valuation'
    ])
    valuation_instructions = ""
    if is_valuation_query:
        valuation_instructions = _get_valuation_extraction_instructions(detail_level='detailed', is_valuation_query=True)
        valuation_instructions = f"\n{valuation_instructions}\n"
    
    # Add value-only query instructions if applicable
    value_only_instructions = ""
    if is_value_only_query:
        value_only_instructions = """
**⚠️ VALUE-ONLY QUERY DETECTED - MANDATORY REQUIREMENTS ⚠️**

The user is asking specifically for the VALUE/VALUATION amount. You MUST include ALL valuation figures found in the documents.

**MANDATORY - Include ALL of the following (if found in documents):**
1. **Primary Market Value** - The main valuation figure (e.g., £2,300,000)
2. **90-Day Value** - If the document mentions a 90-day marketing period value, you MUST include it (e.g., £1,950,000 with 15% discount)
3. **180-Day Value** - If the document mentions a 180-day marketing period value, you MUST include it (e.g., £2,050,000 with 10% discount)
4. **Market Rent** - If provided (e.g., £6,000 per calendar month)
5. **Valuation Date** - When the valuation was conducted
6. **Valuer Information** - Names and qualifications of valuers
7. **Assumptions for EACH scenario** - Marketing periods, discounts, conditions for each value

**CRITICAL RULES:**
- ✅ **MUST**: If you see "90-day" or "180-day" mentioned anywhere in the documents, you MUST include those values
- ✅ **MUST**: Include the specific assumptions for each scenario (e.g., "15% discount", "90-day marketing period")
- ✅ **MUST**: Present ALL valuation scenarios found - do NOT skip any
- ❌ **DO NOT**: Only include the primary Market Value - you MUST include ALL scenarios
- ❌ **DO NOT**: Include property features (bedrooms, bathrooms, etc.) - focus ONLY on valuation figures

**Structure:**
1. Primary Market Value (with assumptions)
2. 90-Day Value (with assumptions) - IF MENTIONED IN DOCUMENTS
3. 180-Day Value (with assumptions) - IF MENTIONED IN DOCUMENTS
4. Market Rent (if provided)
5. Valuation Date and Valuer Information
6. Market Activity (guide prices, under offer prices) - AFTER professional valuations

**Example of what you MUST include:**
- Market Value: £2,300,000[1] (vacant possession, normal marketing period)
- 90-Day Value: £1,950,000[2] (vacant possession, 90-day marketing period, 15% discount applied)
- 180-Day Value: £2,050,000[3] (vacant possession, 180-day marketing period, 10% discount applied)
- Market Rent: £6,000[4] per calendar month
- Valuation Date: 12th February 2024[5]
- Valuers: Sukhbir Tiwana[6] MRICS and Graham Finegold[7] MRICS
"""
    
    # Determine conditional sections based on query characteristics
    conditional_sections = _determine_conditional_sections(user_query)
    
    # Build conditional sections instruction text for each section
    steps_note = " (INCLUDE THIS SECTION)" if conditional_sections['include_steps'] else ""
    practical_note = " (INCLUDE THIS SECTION)" if conditional_sections['include_practical'] else ""
    risks_note = " (INCLUDE THIS SECTION)" if conditional_sections['include_risks'] else ""
    next_actions_note = " (INCLUDE THIS SECTION)" if conditional_sections['include_next_actions'] else ""
    
    return f"""**USER QUESTION:**  
"{user_query}"

**CONVERSATION HISTORY:**  
{conversation_history}

**DOCUMENT CONTENT EXTRACTS:**  
{formatted_outputs}

{citation_list}
{valuation_instructions}
{value_only_instructions}

**CRITICAL - CITATION MARKERS (INVISIBLE)**:
- Citations have already been extracted in Phase 1 (see list above)
- As you write your answer, you MUST add invisible citation markers using bracket format [1], [2], [3], [4], [5]... for EACH fact you include
- **⚠️ CRITICAL - MATCHING FACTS TO CITATIONS (READ THIS CAREFULLY)**:
  * **STEP 1**: Look at the Phase 1 citation list above - each citation has a number and the fact it represents
  * **STEP 2**: Before writing each fact in your answer, STOP and find the EXACT matching citation in Phase 1
  * **STEP 3**: Use the EXACT citation number from Phase 1 that matches your fact
  * **STEP 4**: Write the fact with the citation marker immediately after it
  * **MATCHING RULES**:
    - Match by VALUE/AMOUNT: If you're writing "£1,950,000", find the citation that mentions "£1,950,000" and use its number
    - Match by CONCEPT: If you're writing "90-day value", find the citation that mentions "90-day" and use its number
    - Match by DATE: If you're writing "12th February 2024", find the citation that mentions this date and use its number
    - Match by NAME: If you're writing "Highlands", find the citation that mentions "Highlands" or "Property Address" and use its number
  * **EXAMPLES**:
    - If Phase 1 has "**Citation [4]**: 90-day marketing period value: £1,950,000 [90-DAY VALUE] [Block: BLOCK_CITE_ID_570]", when you write "90-day value: £1,950,000", you MUST use [4] (NOT [1], [2], [3], or any other number)
    - If Phase 1 has "**Citation [1]**: Market Value: £2,300,000 [Block: BLOCK_CITE_ID_566]", when you write "Market Value: £2,300,000", you MUST use [1]
    - If Phase 1 has "**Citation [3]**: Property Address: Highlands, Berden Road [PROPERTY ADDRESS] [Block: BLOCK_CITE_ID_50]", when you write "Property Address: Highlands, Berden Road", you MUST use [3] (NOT [1] or [2])
- **CRITICAL**: Use the ORIGINAL Phase 1 citation numbers - do NOT create sequential numbers. The system will automatically renumber them based on appearance order.
- **CRITICAL**: Place citation markers IMMEDIATELY after the specific value/amount/date/name being cited - NO SPACE between the fact and citation
- **CRITICAL**: Each citation marker is permanently attached to its fact - write them together as a unit with NO separation
- **CRITICAL**: Write fact and citation as ONE unit: "£2,300,000[1]" NOT "£2,300,000 [1]" and NOT "£2,300,000. [1]"
- **WORKFLOW**: Before writing each fact, check the Phase 1 citation list to find the matching citation number
- **Example CORRECT**: If Phase 1 has citations [1]=Market Value, [2]=Valuation date, [3]=Property Address, [4]=90-day value, write: "Market Value: £2,300,000[1]. Property Address: Highlands[3]. 90-day value: £1,950,000[4]. Valuation date: 12th February 2024[2]."
- **Example CORRECT (Multiple Valuers)**: If Phase 1 has [6]=Sukhbir Tiwana, [7]=Graham Finegold, write: "Valuation conducted by Sukhbir Tiwana[6] MRICS and Graham Finegold[7] MRICS"
- **Example INCORRECT**: "Market Value: £2,300,000[1]. Property Address: Highlands[2]. 90-day value: £1,950,000[3]." (WRONG - used [2] for property address when Phase 1 has it as [3], used [3] for 90-day value when Phase 1 has it as [4])
- **Example INCORRECT**: "Market Value: £2,300,000 [1]" (WRONG - space before citation)
- **Example INCORRECT**: "Market Value: £2,300,000. [1]" (WRONG - period and space before citation)
- **Example INCORRECT**: "Valuation conducted by Sukhbir Tiwana MRICS and Graham Finegold MRICS. [6] [7]" (WRONG - citations at end, should be: "Sukhbir Tiwana[6] MRICS and Graham Finegold[7] MRICS")
- **DO NOT** create sequential citation numbers - use the exact citation numbers from Phase 1 that match your facts

### TASK: Create Final Answer with Citations

Create a comprehensive answer to the user's question using the document extracts above.

**⚠️ CRITICAL FOR VALUATION QUERIES:**
- If the user is asking about "value" or "valuation", you MUST include ALL valuation scenarios found in the documents
- **MANDATORY**: If documents mention "90-day value" or "180-day value", you MUST include them with their assumptions
- **MANDATORY**: Include Market Rent if mentioned in documents
- **DO NOT**: Only include the primary Market Value - you MUST include ALL scenarios (90-day, 180-day, etc.)
- **DO NOT**: Skip assumption scenarios - they are REQUIRED if mentioned in documents

**CITATION MARKERS (BRACKET FORMAT - INVISIBLE TO USER)**:
- **MUST**: Use bracket format [1], [2], [3], [4], [5]... for citation markers (these will be converted to buttons by the frontend)
- **MUST**: Place citation markers IMMEDIATELY after the specific value/amount/date/name being cited - NO SPACE, NO PUNCTUATION between fact and citation
- **CRITICAL**: Write as ONE unit: "£2,300,000[1]" NOT "£2,300,000 [1]" and NOT "£2,300,000. [1]"
- **CRITICAL**: For multiple valuers, cite each separately: "Sukhbir Tiwana[6] MRICS and Graham Finegold[7] MRICS" (NOT "Sukhbir Tiwana and Graham Finegold MRICS. [6] [7]")
- **DO NOT** place citations at the end of sentences - place them right after the cited fact with NO separation
- **CRITICAL**: Match facts to citations extracted in Phase 1 - use the EXACT citation number from Phase 1 that corresponds to the fact you're stating
- **CRITICAL**: Use the ORIGINAL Phase 1 citation numbers - do NOT create sequential numbers. The system will automatically renumber them based on appearance order.
- **CRITICAL**: Each citation marker is permanently attached to its fact - they must always appear together as a single unit
- **DO NOT** place citations at the end of sentences, paragraphs, or after periods - place them immediately after the fact with no space or punctuation
- **Examples of correct usage** (using original Phase 1 citation numbers):
  * If Phase 1 has: "1. Market Value: £2,300,000", "2. Valuation date: 12th February 2024", "3. Property Address: Highlands"
  * Write: "Market Value: £2,300,000[1] (Two Million, Three Hundred Thousand Pounds) for the freehold interest. Property Address: Highlands[3]. Valuation date: 12th February 2024[2]."
  * Notice: [1] for market value, [3] for property address (not [2]), [2] for valuation date (not [3])
- **INCORRECT - DO NOT DO THIS**:
  * ❌ "Market Value: £2,300,000[1]. Market Rent: £6,000[1]" (reused [1])
  * ❌ "Market Value: £2,300,000[1][2]" (multiple citations for same value)
  * ❌ "Market Value: £2,300,000 (Two Million, Three Hundred Thousand Pounds) for the freehold interest. [1] [2]" (citations at end)
  * ❌ "Market Value: £2,300,000. Valuation date: 12th February 2024. [1] [2]" (citations separated from facts)
  * ❌ Using sequential numbers [1], [2], [3] when Phase 1 citations are [1], [3], [5] - you MUST use [1], [3], [5]

**⚠️ CRITICAL FOR VALUATION QUERIES:**
- If the user is asking about "value" or "valuation", you MUST include ALL valuation scenarios found in the documents
- **MANDATORY**: If documents mention "90-day value" or "180-day value", you MUST include them with their assumptions
- **MANDATORY**: Include Market Rent if mentioned in documents
- **DO NOT**: Only include the primary Market Value - you MUST include ALL scenarios (90-day, 180-day, etc.)
- **DO NOT**: Skip assumption scenarios - they are REQUIRED if mentioned in documents

**CANONICAL TEMPLATE STRUCTURE (MUST FOLLOW)**:

1. **Primary Answer (H1)**:
   - Use markdown heading # (single hash) for the final outcome/main answer
   - Short, direct answer that resolves the user's question immediately
   - No fluff, no justification yet
   - Maximum 2-3 sentences
   - Example: "# Market Value: £2,300,000[1]"

2. **Key Concepts (H2)**:
   - Use markdown heading ## (double hash) for "Key Concepts" section
   - List 3-5 key concepts with one-line explanations
   - Use bullet points (-) with **bold** concept names
   - Format: "- **Concept Name**: One-line explanation"
   - Maximum 5 bullet points
   - **CRITICAL - NO DUPLICATION**: Key Concepts should be a BRIEF summary. Do NOT repeat these exact same facts in Detailed Explanation
   - Example: "## Key Concepts\n- **Market Value**: £2,300,000[1] - The primary valuation figure"

3. **Detailed Explanation (H2)**:
   - Use markdown heading ## (double hash) for "Detailed Explanation"
   - Use markdown heading ### (triple hash) for each subtopic within this section
   - Each ### subtopic should have 1-3 paragraphs
   - Maximum 3 sentences per paragraph
   - Maximum ~50 words per paragraph (split if longer)
   - One idea per paragraph
   - **CRITICAL - NO DUPLICATION**: Detailed Explanation should EXPAND on Key Concepts with additional context, examples, and details. Do NOT repeat the exact same sentences from Key Concepts
   - **CRITICAL - NO DUPLICATION**: If Key Concepts says "No obvious signs of contamination[1]", Detailed Explanation should say something like "The valuation report indicates that no environmental reports were provided, but there were no visible signs of contamination during the inspection[1]" (expands with context, not repeats)

4. **Process/Steps (H2 - Conditional)**{steps_note}:
   - Only include if applicable (procedural queries)
   - Use markdown heading ## (double hash) for "Process / Steps"
   - Use numbered list (1., 2., 3.) for steps
   - Each step: "1. **Step 1:** Clear action"
   - Maximum 5 steps (split into sub-sections if more)

5. **Practical Application (H2 - Conditional)**{practical_note}:
   - Include if query requires real-world application guidance
   - Use markdown heading ## (double hash) for "Practical Application"
   - 1-2 paragraphs explaining how to use this information
   - Maximum 3 sentences per paragraph

6. **Risks/Edge Cases (H2 - Optional)**{risks_note}:
   - Include only if relevant limitations or risks exist
   - Use markdown heading ## (double hash) for "Risks / Edge Cases"
   - Use bullet points (-) for list of risks/limitations
   - Maximum 5 bullet points

7. **Next Actions (H2 - Optional)**{next_actions_note}:
   - Include if follow-up actions are suggested
   - Use markdown heading ## (double hash) for "Next Actions"
   - Use bullet points (-) for suggested follow-ups
   - Maximum 5 bullet points

**HEADING HIERARCHY RULES (CRITICAL)**:
- NEVER skip heading levels (# → ## → ###, not # → ###)
- If a section can be read independently → it deserves a ## (H2)
- # (H1) = Final outcome/main answer (only one H1 per response)
- ## (H2) = Major sections (Key Concepts, Detailed Explanation, etc.)
- ### (H3) = Sub-sections within H2 sections
- Regular paragraphs = Explanation text
- Bullet points (-) or numbered lists (1., 2., 3.) = Scannable information lists

**INFORMATION ORDERING (MUST FOLLOW)**:
1. Answer first (# H1 - primary answer)
2. Explain later (## H2 - Key Concepts, Detailed Explanation)
3. Justify last (if needed - within Detailed Explanation)
4. Extend optionally (Process, Practical Application, Risks, Next Actions)

**MINIMAL COGNITIVE LOAD RULES**:
- Maximum 3-5 bullet points per list
- Maximum 3 sentences per paragraph
- Maximum ~50 words per paragraph (automatically split if longer)
- One idea per paragraph
- Use lists instead of long paragraphs when possible

**CONDITIONAL SECTIONS LOGIC**:
- Include "Process / Steps" only if query involves procedures or sequential actions
- Include "Practical Application" only if query requires real-world usage guidance
- Include "Risks / Edge Cases" only if limitations or risks are relevant
- Include "Next Actions" only if follow-up actions are appropriate
- For simple queries: # H1 + ## Key Concepts + ## Brief Detailed Explanation may be sufficient

**CONTENT GENERATION INSTRUCTIONS**:

1. **Answer Directly and Comprehensively** (MUST)
   - The information IS available in the document extracts above
   - If citations were extracted (see list above), the information EXISTS in the documents - you MUST use it
   - NEVER say "information not provided" or "not available" if citations were extracted
   - Start directly with the answer - do NOT repeat the question

2. **Valuation Query Handling** (MUST for valuation queries)
   {VALUATION_PRIORITIZATION_RULES}
   
   - **CRITICAL**: Extract and include: Market Value (primary), ALL valuation scenarios (90-day, 180-day, etc.), assumptions for EACH scenario, valuation date, valuer details
   - **MANDATORY**: You MUST include ALL assumption figures - if the document mentions "90-day" or "180-day" marketing periods, you MUST find and extract those figures with their assumptions
   - **MANDATORY**: Include assumptions for EACH valuation scenario (e.g., "90-day value: £1,950,000 (15% discount, vacant possession, 90-day marketing period)")
   - **IMPORTANT**: Search through ALL document extracts thoroughly - reduced marketing period valuations may appear on later pages (page 30+)
   - **IMPORTANT**: If you see references to reduced marketing periods, the valuation figures MUST be present - continue searching until you find them
   - **IMPORTANT**: Read through ALL document extracts completely - valuation scenarios may be spread across multiple chunks or pages
   - **MUST**: Include citations for ALL valuation figures (including 90-day, 180-day, and all other scenarios)
   - **EXAMPLE**: If document has "90-day value: £1,950,000 (15% discount)" and "180-day value: £2,050,000 (10% discount)", you MUST include BOTH with their assumptions

3. **Value-Only Query Handling** (MUST for value-only queries)
   - **ONLY provide valuation information** - do NOT include property composition, features, floor areas, bedrooms, bathrooms
   - Focus ONLY on: Market Value figures (primary and all scenarios), valuation assumptions, valuation date, valuer information
   - Do NOT include: Property features, floor areas, property composition details, any non-valuation information

4. **General Information Extraction** (MUST)
   - Extract and include ALL relevant information: prices, valuations, amounts, dates, names, addresses, assumptions, etc.
   - **CRITICAL**: Include citation markers ([1], [2], [3], etc.) IMMEDIATELY after each specific fact/value being cited
   - **DO NOT** place citations at the end of sentences - place them right after the cited information
   - **Example**: "Market Value: £2,300,000[1] (Two Million, Three Hundred Thousand Pounds) for the freehold interest..."
   - Be professional, factual, and detailed - include all relevant figures, dates, names, and details

5. **Search Strategy** (IMPORTANT)
   - Look carefully in the DOCUMENT CONTENT EXTRACTS section
   - Search through ALL the content, especially later pages (like page 30) where important sections often appear
   - If you see valuation-related terms (Market Value, valuation, price, amount, £, assumptions), extract that information
   - If page numbers are visible, use them to ensure you've searched all pages

**COMMON MISTAKES TO AVOID**:
- ❌ Using "under offer" prices as Market Value
- ❌ Stopping after finding one valuation figure
- ❌ Omitting assumption figures (90-day, 180-day values) - these are MANDATORY if mentioned in documents
- ❌ Saying "not specified" when reduced marketing periods are mentioned
- ❌ Missing information on later pages (20-30+)
- ❌ Including only primary Market Value without assumption scenarios
- ✅ Search comprehensively, extract all scenarios WITH their assumptions, use professional valuations first

**CONTENT GENERATION (Focus on completeness and accuracy):**
- Organize information logically (primary information first, supporting details below)
- Include ALL relevant information found in document extracts
- Use citations inline (bracket format: [1], [2], [3]) - see citation rules above
- Ensure all valuation figures, assumptions, and details are included
- Present information clearly and comprehensively
- **Note: Formatting and structure will be handled in a separate step - focus on content completeness**

Generate the answer content:"""


# ============================================================================
# RESPONSE FORMATTING PROMPTS
# ============================================================================

def get_response_formatting_prompt(raw_response: str, user_query: str) -> str:
    """
    Get prompt for formatting and structuring LLM responses.
    
    Args:
        raw_response: Raw LLM response from summarize_results
        user_query: Original user query
    
    Returns:
        Formatting prompt string
    """
    return f"""**TASK**: Format and structure the following response to make it neater, more organized, and easier to read.

**ORIGINAL USER QUERY**:  
{user_query}

**RAW RESPONSE TO FORMAT**:  
{raw_response}

---

**YOUR ROLE** (MUST):
- The content is already complete and comprehensive
- Your job is ONLY to format and structure the existing content
- **MUST**: Do NOT add, remove, or modify any information
- **MUST**: Do NOT generate new content - only reorganize and format what's already there
- **CRITICAL**: When reorganizing, citations MUST move WITH their associated facts - never separate them
- **CRITICAL - AVOID DUPLICATION**: Do NOT repeat the same information in multiple sections. If a fact appears in Key Concepts, the Detailed Explanation should provide ADDITIONAL context, not repeat the same sentence
- **CRITICAL - AVOID DUPLICATION**: Key Concepts = brief summary (one line). Detailed Explanation = expanded context with more detail. They should complement each other, not duplicate

**CRITICAL CITATION PRESERVATION RULES** (MUST FOLLOW):

1. **Citation-to-Fact Mapping** (ABSOLUTELY CRITICAL):
   - Each citation marker ([1], [2], [3], etc.) is attached to a SPECIFIC fact/value/name/date
   - When you move or reorganize content, the citation marker MUST move WITH its fact
   - **NEVER** separate a citation marker from its fact
   - **Example**: If "£2,300,000[1]" appears in raw response, it must remain "£2,300,000[1]" in formatted response
   - **Example**: If "12th February 2024[2]" appears, it must remain "12th February 2024[2]"
   - **Example**: If "Sukhbir Tiwana[3] MRICS" appears, it must remain "Sukhbir Tiwana[3] MRICS"

2. **Citation Placement** (MUST PRESERVE):
   - Citation markers appear IMMEDIATELY after the specific fact being cited
   - If raw response has "Market Value: £2,300,000[1]", formatted must keep "Market Value: £2,300,000[1]"
   - If raw response has "valuation date: 12th February 2024[2]", formatted must keep "valuation date: 12th February 2024[2]"
   - **DO NOT** move citations to end of sentences or paragraphs
   - **DO NOT** group citations together - each stays with its fact

3. **Citation Sequence** (MUST PRESERVE):
   - Maintain the exact sequential order: [1], [2], [3], [4], [5], [6]...
   - Do NOT renumber citations
   - Do NOT reuse citation numbers
   - If raw response uses [1], [2], [3], formatted must use same sequence

4. **When Reorganizing Content**:
   - If moving "Market Value: £2,300,000[1]" to Key Concepts section, keep it as "Market Value: £2,300,000[1]"
   - If moving "12th February 2024[2]" to Detailed Explanation, keep it as "12th February 2024[2]"
   - Citations are part of the fact - they move together as a unit

**CANONICAL TEMPLATE ENFORCEMENT**:

1. **Verify Heading Hierarchy**:
   - Ensure H1 (# single hash) exists for primary answer at the start
   - Ensure H2 (## double hash) sections follow proper order
   - Ensure H3 (### triple hash) only appear within H2 sections
   - NEVER skip heading levels (# → ## → ###, not # → ###)
   - If response lacks proper heading structure, reorganize to match canonical template
   - **CRITICAL**: When creating H1 from primary answer, preserve all citations exactly as they appear

2. **Verify Information Ordering**:
   - H1 (#) primary answer must come first (with citations preserved)
   - H2 (##) Key Concepts should come early (if applicable) - extract key facts WITH their citations
   - H2 (##) Detailed Explanation should follow - preserve all citations when moving content
   - Optional sections (Process, Practical Application, Risks, Next Actions) come last
   - Reorganize content if ordering is incorrect, but keep citations with their facts

3. **Enforce Cognitive Load Rules**:
   - Split paragraphs longer than ~50 words into multiple paragraphs
   - **CRITICAL**: When splitting paragraphs, preserve citations with their facts
   - Limit lists to 3-5 items (split into multiple lists or sub-sections if longer)
   - Limit paragraphs to 3 sentences maximum
   - Break up long explanations into H3 (###) sub-sections
   - One idea per paragraph

4. **Apply Canonical Template Structure**:
   - If response lacks H1, create one from the primary answer - preserve all citations
   - **CRITICAL - AVOID DUPLICATION**: If response lacks "Key Concepts" section, extract 3-5 key points WITH their citations and create H2 section
   - **CRITICAL - AVOID DUPLICATION**: If response lacks "Detailed Explanation" section, organize remaining content under H2 with H3 sub-sections - preserve all citations
   - **CRITICAL - NO REPETITION**: Key Concepts should be a BRIEF summary (one-line per concept). Detailed Explanation should EXPAND on these concepts with more detail, NOT repeat the same information
   - **CRITICAL - NO REPETITION**: If a fact appears in Key Concepts, the Detailed Explanation should provide ADDITIONAL context/explanation, not repeat the exact same fact
   - **CRITICAL - NO REPETITION**: Do NOT copy the same sentences from Key Concepts into Detailed Explanation - use different wording and add more detail
   - Ensure all content follows: # H1 → ## H2 → ### H3 hierarchy
   - **CRITICAL**: When extracting key concepts, keep the citation with each concept (e.g., "- **Market Value**: £2,300,000[1] - The primary valuation figure")
   - **EXAMPLE - CORRECT (No Duplication)**:
     * Key Concepts: "- **Contamination Risk**: No obvious signs of contamination[1]"
     * Detailed Explanation: "The valuation report indicates that no environmental reports were provided, but there were no visible signs of contamination during the inspection[1]. The assumption is made that the property has not been contaminated previously[2]."
   - **EXAMPLE - INCORRECT (Duplication)**:
     * Key Concepts: "- **Contamination Risk**: No obvious signs of contamination[1]"
     * Detailed Explanation: "No obvious signs of contamination[1]. The assumption is made that the property has not been contaminated[2]." (WRONG - repeats the same fact)

**CITATION FORMAT** (MUST - Preserve Exactly):
{CITATION_FORMAT_RULES}

**CRITICAL - SEQUENTIAL CITATION ORDER**:
- Citations MUST be used in sequential order as they appear in the response
- First citation: [1], Second: [2], Third: [3], Fourth: [4], Fifth: [5], etc.
- **NEVER reuse a citation number** - once you use [1], the next must be [2], then [3], etc.
- **NEVER restart the sequence** - citations must always increase: [1] → [2] → [3] → [4] → [5] → ...

**FORMATTING STANDARDS**:
- Use markdown heading syntax: # for H1, ## for H2, ### for H3
- Use **bold** for key figures, names, and important values within paragraphs
- Use bullet points (-) for lists in Key Concepts and other sections
- Use numbered lists (1., 2., 3.) for Process/Steps sections
- **CRITICAL**: Maintain inline citation markers ([1], [2], [3]) IMMEDIATELY after the specific fact/value being cited
- **CRITICAL**: If citations appear at the end of sentences or phrases, move them to immediately after the cited information
- **NOTE**: Citation markers in bracket format will be converted to clickable buttons by the frontend - do not add visible superscripts

**CORRECT CITATION EXAMPLES** (Follow These Patterns):

✅ **CORRECT - H1 with citation**:
```
# Market Value: £2,300,000[1]

The property has a market value of £2,300,000[1] (Two Million, Three Hundred Thousand Pounds) for the freehold interest as of 12th February 2024[2].
```

✅ **CORRECT - Key Concepts with citations**:
```
## Key Concepts

- **Market Value**: £2,300,000[1] - The primary valuation figure for the freehold interest
- **Valuation Date**: 12th February 2024[2] - When the valuation was conducted
- **Valuers**: Sukhbir Tiwana[3] MRICS and Graham Finegold[4] MRICS - The qualified professionals
- **90-Day Value**: £1,950,000[5] - Reduced marketing period scenario (15% discount)
- **180-Day Value**: £2,050,000[6] - Extended marketing period scenario (10% discount)
```

✅ **CORRECT - Detailed Explanation with citations**:
```
## Detailed Explanation

### Primary Valuation
The market value of £2,300,000[1] represents the estimated amount the property would sell for in the open market. This valuation assumes standard marketing conditions and a willing buyer and seller. The valuation was conducted on 12th February 2024[2] by Sukhbir Tiwana[3] MRICS and Graham Finegold[4] MRICS.
```

❌ **INCORRECT - Citations separated from facts**:
```
# Market Value: £2,300,000

The property has a market value of £2,300,000 for the freehold interest. ¹ ² ³
```

❌ **INCORRECT - Citations at end of sentences**:
```
# Market Value: £2,300,000

The property has a market value of £2,300,000 (Two Million, Three Hundred Thousand Pounds) for the freehold interest.¹ The valuation was conducted on 12th February 2024.²
```

❌ **INCORRECT - Citations renumbered or reused**:
```
## Key Concepts

- **Market Value**: £2,300,000¹
- **Valuation Date**: 12th February 2024¹ (WRONG - should be ²)
- **Valuers**: Sukhbir Tiwana¹ MRICS (WRONG - should be ³)
```

**MUST**: Do NOT remove or omit any information from the raw response. Your job is to organize and format it better, not to filter it. The content is already complete - only format and structure it.

**FORMATTED RESPONSE**:"""


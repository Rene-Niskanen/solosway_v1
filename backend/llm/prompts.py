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


def _get_entity_normalization_instructions() -> str:
    """
    Shared instructions for entity normalization and duplication removal.
    Used across all response generation (summarize, format, general_query, etc.)
    Formats responses for end-user display with clean label-value layout.
    NOTE: Citation handling is separate - this function focuses on structure and normalization.
    """
    return """
**PRESENTATION FORMAT STRUCTURE**

**(CRITICAL — Apply to ALL responses)**

1. **Normalize Data into Unique Fields** (MUST):
   - Identify all entities (companies, people, properties, values, dates, etc.)
   - **CRITICAL**: Each piece of data must appear once and only once
   - Merge duplicate entities into a single, normalized representation
   - Use consistent naming across the response (choose the most appropriate label)
   - **Example**: "Company: X" and "Valuation Company: X" → ONE entity section

2. **Clear Section Headers with Logical Hierarchy** (MUST):
   - Use H1 (#) for the main title (e.g., "Property Valuation Summary")
   - Use H2 (##) for major sections (e.g., "Market Value", "Valuers")
   - Group related information under the appropriate section header
   - **Required structure**: Section Header → Primary value(s) → Secondary notes (if applicable)

3. **Clean Label–Value Layout for Immediate Clarity** (MUST):
   - **CRITICAL**: Values must be immediately visible and scannable
   - **CRITICAL - All Values Must Have Labels**: Every value, figure, amount, date, and name MUST have a clear label/title
   - Each data point must use a vertical label–value layout
   - **Required format**:
     ```
     **Label:**
     Value[1]
     ```
     (Label is bold, value is regular text)
   - **MUST**: Include labels for ALL values including:
     - Monetary values: "**Market Value:**", "**90-Day Value:**", "**Market Rent:**"
     - Dates: "**Valuation Date:**", "**Completion Date:**"
     - Names: "**Valuers:**", "**Property Owner:**", "**Agent:**"
     - Other data: "**Property Type:**", "**Address:**", etc.
   - **CRITICAL - Smart Bolding**: Only bold labels (e.g., **Market Value:**), NOT the actual values (e.g., £2,300,000[1] should be regular text)
   - **DO NOT** show values without labels - this is misleading and unclear
   - **DO NOT** use inline formats such as "Label: Value"
   - **DO NOT** embed assumptions or explanations inline with values
   - Labels must be bold and placed on their own line
   - Values must appear on a separate line directly below the label
   - Use blank lines between sections to improve visual separation
   - **CRITICAL - Use Bullet Points for Lists**: When a label has multiple items (e.g., amenities, features, structures), use bullet points:
     ```
     **Additional Structures:**
     - One-bedroom Coach House
     - Triple Carport
     - Store
     - Gym
     - Pond
     - Tennis Court
     - Outdoor Swimming Pool
     ```
   - **DO NOT** list multiple items on one line separated by commas
   - **DO NOT** list multiple items as plain text lines without bullets

4. **Assumptions and Explanatory Notes as Secondary Text** (MUST):
   - Place assumptions or explanatory notes below the primary value
   - Use italic formatting for all secondary text
   - **Required format**:
     ```
     **Label:**
     Primary Value
     *Assumption or explanatory note*
     ```
   - **DO NOT** combine values and explanations on the same line

5. **Citation Markers** (MUST):
   - **CRITICAL**: Include citation markers (e.g., [1], [2], [3]) in the text immediately after each fact
   - Citation markers are REQUIRED in the text - the frontend automatically converts them to clickable citation buttons
   - **IMPORTANT**: The markers will NOT appear as raw text "[1]" to users - they will be rendered as styled clickable buttons by the frontend
   - Place citations directly after the fact: "£2,300,000[1]" not "£2,300,000 [1]"
   - **DO NOT** remove citation markers - they are essential for proper citation rendering
   - **DO NOT** place citations at the end of sentences or paragraphs - they must be inline with the fact

6. **Remove Unnecessary Metadata and Descriptive Noise** (MUST):
   - Remove phrases such as "The firm responsible for…", "The phone number for…"
   - Eliminate redundant descriptions that do not add direct user value
   - Retain only information necessary for understanding and decision-making

7. **Example — Correct Format** (Follow Exactly - ALL values must have labels):
   ```
   # Property Valuation Summary
   
   ## Market Value
   **Market Value:**
   **£2,300,000[1]**
   *Market value with vacant possession, normal marketing period*
   
   ## 90-Day Value
   **90-Day Value:**
   **£1,950,000[2]**
   *Assumes a sale within 90 days, reflecting a 15% discount*
   
   ## 180-Day Value
   **180-Day Value:**
   **£2,050,000[3]**
   *Assumes a sale within 180 days, reflecting a 10% discount*
   
   ## Market Rent
   **Market Rent:**
   **£6,000[4]** per calendar month
   
   ## Valuation Date
   **Valuation Date:**
   **12th February 2024[5]**
   
   ## Valuers
   **Valuers:**
   **Sukhbir Tiwana[6]** MRICS
   **Graham Finegold[7]** MRICS
   *Registered valuers, MJ Group International*
   ```

8. **Example — Flood Risk Format**:
   ```
   # Flood Risk for Highlands Property: Medium Risk
   
   The property located at Highlands, Berden Road, Berden, Bishop's Stortford, CM23 1AB is classified as being in a medium risk area for flooding.
   
   ## Flood Risk Classification
   Zone 2
   *Land probability of river flooding between 1 in 100 and 1 in 1,000 annually*
   
   ## Surface Water Flooding
   Low risk
   
   ## Assessment Source
   Environment Agency
   *Uses multiple environmental risk factors*
   ```

10. **Example — Amenities with Bullet Points**:
   ```
   # Amenities for Highlands Property
   
   ## Property Type
   Five-bedroom detached house
   
   ## Additional Structures
   - One-bedroom Coach House
   - Triple Carport
   - Store
   - Gym
   - Pond
   - Tennis Court
   - Outdoor Swimming Pool
   
   ## Parking
   Ample parking for multiple cars at the front of the main house
   
   ## Security
   CCTV coverage throughout the external areas of the property
   
   ## Landscaping
   Well-maintained gardens with defined boundaries of timber fencing and mature hedging
   ```

9. **Example — Incorrect Format** (DO NOT USE):
   ```
   ❌ Market Value: £2,300,000 – inline value
   ❌ 90-Day Value: £1,950,000 – inline explanation
   ❌ Company: MJ Group International, Phone: +44...
   ❌ Valuation Company: MJ Group International – duplicate entity
   ```

**CRITICAL REQUIREMENT**:
The final output must be a clean, normalized, presentation-layer response optimized for:
- Readability
- Scanability
- UI and document rendering

It must not resemble an intermediate, raw, or internal data representation.
"""

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

def get_query_classification_prompt(user_query: str, conversation_history: str = "") -> str:
    """
    Prompt for classifying query intent.
    Returns classification prompt with examples.
    Pattern: Follow get_query_routing_human_content() structure
    """
    history_section = f"\n\nConversation History:\n{conversation_history}" if conversation_history else ""
    return f"""Here is the context:  
{history_section}

**Current User Query:**  
"{user_query}"

**CLASSIFY** the intent as exactly one of the following — and return only that word:  
- `general_query`  
- `text_transformation`  
- `document_search`
- `follow_up_document_search`  # NEW
- `hybrid`

Use the definitions below:

- **general_query**: General knowledge questions not requiring document search
  Examples: "What is the date today?", "Explain quantum computing", "What is the capital of France?"
  
- **text_transformation**: Requests to modify/reorganize EXISTING TEXT
  Examples: "Make this text sharper", "Reorganize the previous response", "Make this more concise"
  Key: Transforms text that is already provided (pasted or from previous response)
  
- **document_search**: Queries requiring document search (existing functionality)
  Examples: "What is the market value?", "Find properties with 3 bedrooms"
  
- **follow_up_document_search**: Asking for more detail on specific topic from previous document search
  Examples: "make it more detailed on the assumptions", "tell me more about the 90-day value",
            "what are the assumptions for each value"
  Key: Previous response had citations/block_ids AND query asks for more detail on specific topic
  
- **hybrid**: Queries needing both general knowledge and document search
  Examples: "Compare today's date with the valuation date in the documents"

**Important:**  
- Focus on the **core intent** of the user's question.  
- If the query asks to transform text (make sharper, reorganize, etc.), it's text_transformation
- If the query asks general knowledge questions with no document/property context, it's general_query
- If the query asks about properties, documents, or requires searching, it's document_search
- If the query asks for MORE DETAIL on a topic from a previous document search response, it's follow_up_document_search
- If the query combines general knowledge with document search, it's hybrid
- Do not produce any extra text: return *only* one of the four labels.

**Answer:**"""


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

def get_document_qa_human_content(user_query: str, doc_content: str, detail_level: str = 'concise', citation_context: dict = None) -> str:
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
    
    # Build citation context section if available
    citation_context_section = ""
    if citation_context:
        page_info = f" (page {citation_context.get('page_number', 'unknown')})" if citation_context.get('page_number') else ""
        doc_name = citation_context.get('original_filename', 'the document')
        cited_text = citation_context.get('cited_text', '')
        citation_context_section = f"""
**CITATION CONTEXT (for reference - user is asking about this specific location):**
- Document: {doc_name}{page_info}
- Cited text: "{cited_text[:200]}{'...' if len(cited_text) > 200 else ''}"
- User's question relates to this specific citation location in the document.

**IMPORTANT:** Use this citation context to:
1. Focus your search on information related to or near this cited text
2. Look for additional details, explanations, or related information around this citation
3. Provide context that expands on or clarifies what the user is asking about regarding this specific citation
"""
    
    return f"""Here is the document excerpt:  
```\n{doc_content}\n```

{citation_context_section}

**USER QUESTION:**  
{user_query}

{"**VALUATION QUERY GUIDANCE** (IMPORTANT): When extracting valuation information, use semantic authority detection to identify professional assessments. Extract ALL valuation scenarios found (primary Market Value, reduced marketing period values, market rent, etc.) with their specific assumptions. For each valuation, include its assumptions (vacant possession, marketing period, discounts, etc.) in a clear, summarized format. Present information naturally without explaining the distinction between market activity and professional assessments - simply present the professional valuations with their assumptions." if is_valuation_query else ""}

**INSTRUCTIONS & GUIDELINES**  

{_get_dynamic_search_strategy_instructions("excerpt")}

{_get_section_header_awareness_instructions()}

{_get_section_type_recognition_instructions()}

{_get_names_search_instructions("excerpt")}

2. **Use Only Provided Context**  
   - **CRITICAL**: Answer **ONLY** using information in the excerpt above
   - **CRITICAL**: DO NOT use general knowledge, common sense, or assumptions about what "properties typically have" or "common risks"
   - **CRITICAL**: If the excerpt doesn't mention something, DO NOT make it up or use generic examples
   - **CRITICAL**: DO NOT generate generic lists (e.g., "common risks that properties might face") - ONLY list what the excerpt actually says
   - **Before saying "not found"**: Re-read the excerpt carefully, looking for:
     - Any mention of the requested information
     - Synonyms or related terms
     - Different phrasings or formats
   - If the excerpt lacks enough evidence after thorough search, respond: **"This information is not mentioned in the document excerpt."**

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
   - **CRITICAL**: Do **NOT** guess, invent, or use general knowledge for details not present in the excerpt
   - **CRITICAL**: Do **NOT** generate generic lists or examples (e.g., "common risks that properties might face") - ONLY use what's in the excerpt
   - **CRITICAL**: If asked about risks, features, or issues, ONLY mention what the excerpt explicitly states - do NOT add generic examples
   - Avoid speculation or external recommendations (websites, agents, market data)
   - If information is not in the excerpt, explicitly state: "This is not mentioned in the document excerpt"

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

4. **Structure & Clarity - Maximum Readability**  
   - **Start directly with the final answer** - do not show your internal reasoning process
   - Provide a **comprehensive, detailed answer with all relevant information** following professional standards
   - Include all valuation perspectives, assumptions, professional qualifications, dates, names, and any other relevant details found
   - **CRITICAL**: Make values immediately clear and scannable
   - **CRITICAL**: Use clear section headers (##) for major topics, then place values on their own lines below
   - **Format for clarity**:
     - Use H1 (#) for main title/answer
     - Use H2 (##) for major sections (e.g., "Market Value", "Flood Risk Classification")
     - Place key values on their own line below section headers for immediate visibility
     - Use italic (*text*) for assumptions/explanatory notes beneath values
     - Use blank lines between sections for visual separation
   - **DO NOT**:
     - Use inline format like "Label: Value" - this makes values harder to scan
     - Embed values in long sentences - extract them to their own lines
     - Bury important data in paragraphs - use structured sections
     - Include "Relevant document:" sections
     - Include "Searched the extract" descriptions  
     - Include "Extracted facts:" breakdowns
     - Include step-by-step reasoning processes
     - Include internal chain-of-thought explanations
     - Include technical field names like "KEY_VALUES", "PARTY_NAMES", or any other internal metadata field names
     - Include technical section identifiers or field labels
     - Include document filenames or document names (e.g., "Found in: [document name]")
     - Include references to specific document files or identifiers
   - Present information in a way that values are immediately clear and easy to scan

{_get_entity_normalization_instructions()}

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
- **Values/Amounts**: Prices, valuations, measurements, dimensions, quantities, rents, fees
- **Dates**: When something happened, dates of reports, inspection dates, completion dates, valuation dates
- **Names**: Valuers, appraisers, inspectors, parties involved, agents, companies
- **Addresses**: Property addresses, locations, postcodes
- **Assessments**: Professional opinions, valuations, conditions, ratings, EPC ratings
- **Details**: Property features, specifications, characteristics, amenities, structures
- **Descriptive Facts**: Security features (CCTV, alarms, gates), landscaping details (gardens, fencing, boundaries), property conditions, maintenance details, any descriptive information about the property
- **Lists**: Each item in a list (amenities, features, structures) should be cited separately if relevant
- **Any specific data point** that directly answers the question
- **CRITICAL**: If you mention ANY fact that appears in the documents (even if it's descriptive like "CCTV coverage" or "well-maintained gardens"), you MUST cite it

**CRITICAL - EXTRACT CITATIONS FOR EVERY DISTINCT FACT:**
- If a block contains multiple facts (e.g., "Market Value: £2,300,000. Valuation date: 12th February 2024. Valuer: John Smith"), extract a SEPARATE citation for EACH fact
- If a block lists multiple items (e.g., "Amenities: Swimming pool, Tennis court, Gym"), extract a citation for EACH item if they're relevant to the query
- If a block mentions multiple values (e.g., "90-day: £1,950,000, 180-day: £2,050,000"), extract a citation for EACH value
- If a block mentions multiple names (e.g., "Valuers: John Smith MRICS and Jane Doe MRICS"), extract a citation for EACH name
- **DO NOT** combine multiple facts into one citation - each distinct piece of information needs its own citation number

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

Example 4 - Multiple Facts in One Block:
- You see: <BLOCK id="BLOCK_CITE_ID_20">Content: "Market Value: £2,300,000 as of 12th February 2024. Valuation conducted by Sukhbir Tiwana MRICS. Property address: Highlands, Berden Road, CM23 1AB"</BLOCK>
- You MUST call: cite_source(cited_text="Market Value: £2,300,000", block_id="BLOCK_CITE_ID_20", citation_number=6)
- You MUST call: cite_source(cited_text="Valuation date: 12th February 2024", block_id="BLOCK_CITE_ID_20", citation_number=7)
- You MUST call: cite_source(cited_text="Valuer: Sukhbir Tiwana MRICS", block_id="BLOCK_CITE_ID_20", citation_number=8)
- You MUST call: cite_source(cited_text="Property address: Highlands, Berden Road, CM23 1AB", block_id="BLOCK_CITE_ID_20", citation_number=9)
- **CRITICAL**: Extract a separate citation for EACH distinct fact, even if they're in the same block

Example 5 - Lists and Amenities:
- You see: <BLOCK id="BLOCK_CITE_ID_25">Content: "The property includes: Five-bedroom detached house, One-bedroom Coach House, Triple Carport, Store, Gym, Pond, Tennis Court, Outdoor Swimming Pool"</BLOCK>
- If the user asks about amenities, you MUST call cite_source for EACH relevant item:
- You MUST call: cite_source(cited_text="Five-bedroom detached house", block_id="BLOCK_CITE_ID_25", citation_number=10)
- You MUST call: cite_source(cited_text="One-bedroom Coach House", block_id="BLOCK_CITE_ID_25", citation_number=11)
- You MUST call: cite_source(cited_text="Triple Carport", block_id="BLOCK_CITE_ID_25", citation_number=12)
- You MUST call: cite_source(cited_text="Store", block_id="BLOCK_CITE_ID_25", citation_number=13)
- You MUST call: cite_source(cited_text="Gym", block_id="BLOCK_CITE_ID_25", citation_number=14)
- You MUST call: cite_source(cited_text="Pond", block_id="BLOCK_CITE_ID_25", citation_number=15)
- You MUST call: cite_source(cited_text="Tennis Court", block_id="BLOCK_CITE_ID_25", citation_number=16)
- You MUST call: cite_source(cited_text="Outdoor Swimming Pool", block_id="BLOCK_CITE_ID_25", citation_number=17)
- **CRITICAL**: When extracting citations for lists, cite EACH item separately - do NOT combine them into one citation

Example 6 - Descriptive Facts (Security, Landscaping, etc.):
- You see: <BLOCK id="BLOCK_CITE_ID_30">Content: "The property benefits from CCTV coverage throughout the external areas"</BLOCK>
- You MUST call: cite_source(cited_text="CCTV coverage throughout the external areas of the property", block_id="BLOCK_CITE_ID_30", citation_number=18)
- You see: <BLOCK id="BLOCK_CITE_ID_31">Content: "Well-maintained gardens with defined boundaries of timber fencing and mature hedging"</BLOCK>
- You MUST call: cite_source(cited_text="Well-maintained gardens with defined boundaries of timber fencing and mature hedging", block_id="BLOCK_CITE_ID_31", citation_number=19)
- **CRITICAL**: Descriptive facts about security, landscaping, property conditions, maintenance, or any property characteristics MUST be cited if they appear in the documents
- **CRITICAL**: Do NOT skip citations for descriptive information - if it's in the document and you mention it, you MUST cite it

**CRITICAL RULES:**
1. ✅ Call cite_source for EVERY factual claim (minimum 5-8 citations for most queries, 10-15+ for complex queries with lists/amenities)
2. ✅ Use sequential citation numbers (1, 2, 3, 4, 5...) - start from 1 and increment for each new citation
3. ✅ Find the BLOCK_CITE_ID in the <BLOCK> tags from the document extracts
4. ✅ Extract citations for ALL relevant information, not just one piece
5. ✅ **CRITICAL - ONE FACT PER CITATION**: Each distinct fact/value/date/name/item should get its own citation number
6. ✅ **CRITICAL - LISTS**: When you see lists (amenities, features, structures), extract a citation for EACH item in the list
7. ✅ **CRITICAL - MULTIPLE FACTS IN ONE BLOCK**: If a block contains multiple facts, extract a separate citation for EACH fact
8. ❌ Do NOT write an answer yet - ONLY extract citations by calling the tool
9. ❌ Do NOT skip citations - if you see multiple values, cite each one
10. ❌ Do NOT combine multiple facts into one citation - each fact needs its own citation number
11. ❌ Do NOT finish without calling the tool - tool calls are MANDATORY
8. ⚠️ **CRITICAL - NO DUPLICATE CITATIONS**: Do NOT cite the same fact twice. If you see the same information in different blocks or with slightly different wording (e.g., "EPC Rating: D" and "EPC Rating: The property has an Energy Performance Certificate (EPC) rating of D1"), cite it ONCE only. The system will automatically detect and skip duplicates, but you should avoid creating them.
9. ⚠️ **FOR VALUATION QUERIES - MANDATORY**: You MUST extract citations for ALL valuation scenarios:
   - Primary Market Value (e.g., "Market Value: £2,300,000")
   - 90-day value if mentioned (e.g., "90-day value: £1,950,000")
   - 180-day value if mentioned (e.g., "180-day value: £2,050,000")
   - Market Rent if mentioned (e.g., "Market Rent: £6,000 per calendar month")
   - **SEARCH ALL PAGES**: Reduced marketing period values often appear on later pages (page 28-30+) - do NOT stop after finding the primary Market Value
   - **EXAMPLE**: If you see "Market Value: £2,300,000" on page 30 and "90-day value: £1,950,000" on page 28, you MUST cite BOTH
10. ✅ **CRITICAL - VERIFY BLOCK_ID MATCHES CITED_TEXT EXACTLY**:
   - **BEFORE** calling cite_source, you MUST read the ENTIRE block content and verify it contains the EXACT fact you're citing
   - **STEP-BY-STEP VERIFICATION PROCESS**:
     1. Read the complete block content from start to finish
     2. Identify the core fact/statement in the block
     3. Compare it to the fact you want to cite
     4. Ask yourself: "Does this block actually state the same fact I'm citing?"
     5. Only use the block_id if the answer is YES
   - **CRITICAL RULES**:
     - The block must contain the SAME CORE MEANING as what you're citing
     - For values/amounts: The block must contain the exact number AND the context (e.g., "90-day value: £1,950,000" requires both "90-day" AND "£1,950,000" in the same block)
     - For negative statements: The block must contain BOTH the negative indicator (no/not/none) AND the core concept (e.g., "no planning history" requires both "no" and "planning history" in the block)
     - For decisions/status: The block must contain the exact decision word (e.g., "granted" vs "refused" - these are DIFFERENT facts)
   - **DO NOT**:
     - Use a block_id just because it's on the same page
     - Use a block_id just because it contains similar words
     - Use a block_id if the block talks about a DIFFERENT fact, even if related
     - Assume blocks are correct - always verify by reading the full block content
   - **EXAMPLE - CORRECT**:
     * You want to cite: "no recent planning history"
     * Block A content: "We note that the subject property has no recent planning history, within the last 10 years."
     * Block B content: "Planning consent is assumed for existing uses and is not affected by statutory notices."
     * ✅ CORRECT: Use Block A (it contains "no recent planning history")
     * ❌ WRONG: Do NOT use Block B (it talks about planning consent, not planning history)
   - **EXAMPLE - CORRECT**:
     * You want to cite: "Certificate of Lawfulness granted"
     * Block A content: "Certificate of Lawfulness granted for construction of games room"
     * Block B content: "Certificate of Lawfulness refused for construction of games room"
     * ✅ CORRECT: Use Block A (it says "granted")
     * ❌ WRONG: Do NOT use Block B (it says "refused" - this is a DIFFERENT fact)
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
- **PUNCTUATION**: Do NOT add periods at the end of standalone lines (headings, bullet points). Only use periods mid-sentence when text continues after

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
- **Values/Amounts**: Prices, valuations, measurements, dimensions, quantities, rents, fees
- **Dates**: When something happened, dates of reports, inspection dates, completion dates, valuation dates
- **Names**: Valuers, appraisers, inspectors, parties involved, agents, companies
- **Addresses**: Property addresses, locations, postcodes
- **Assessments**: Professional opinions, valuations, conditions, ratings, EPC ratings
- **Details**: Property features, specifications, characteristics, amenities, structures
- **Descriptive Facts**: Security features (CCTV, alarms, gates), landscaping details (gardens, fencing, boundaries), property conditions, maintenance details, any descriptive information about the property
- **Lists**: Each item in a list (amenities, features, structures) should be cited separately if relevant
- **Any specific data point** that directly answers the question
- **CRITICAL**: If you mention ANY fact that appears in the documents (even if it's descriptive like "CCTV coverage" or "well-maintained gardens"), you MUST cite it

**CRITICAL - EXTRACT CITATIONS FOR EVERY DISTINCT FACT:**
- If a block contains multiple facts (e.g., "Market Value: £2,300,000. Valuation date: 12th February 2024. Valuer: John Smith"), extract a SEPARATE citation for EACH fact
- If a block lists multiple items (e.g., "Amenities: Swimming pool, Tennis court, Gym"), extract a citation for EACH item if they're relevant to the query
- If a block mentions multiple values (e.g., "90-day: £1,950,000, 180-day: £2,050,000"), extract a citation for EACH value
- If a block mentions multiple names (e.g., "Valuers: John Smith MRICS and Jane Doe MRICS"), extract a citation for EACH name
- **DO NOT** combine multiple facts into one citation - each distinct piece of information needs its own citation number

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

Example 4 - Multiple Facts in One Block:
- You see: <BLOCK id="BLOCK_CITE_ID_20">Content: "Market Value: £2,300,000 as of 12th February 2024. Valuation conducted by Sukhbir Tiwana MRICS. Property address: Highlands, Berden Road, CM23 1AB"</BLOCK>
- You MUST call: cite_source(cited_text="Market Value: £2,300,000", block_id="BLOCK_CITE_ID_20", citation_number=6)
- You MUST call: cite_source(cited_text="Valuation date: 12th February 2024", block_id="BLOCK_CITE_ID_20", citation_number=7)
- You MUST call: cite_source(cited_text="Valuer: Sukhbir Tiwana MRICS", block_id="BLOCK_CITE_ID_20", citation_number=8)
- You MUST call: cite_source(cited_text="Property address: Highlands, Berden Road, CM23 1AB", block_id="BLOCK_CITE_ID_20", citation_number=9)
- **CRITICAL**: Extract a separate citation for EACH distinct fact, even if they're in the same block

Example 5 - Lists and Amenities:
- You see: <BLOCK id="BLOCK_CITE_ID_25">Content: "The property includes: Five-bedroom detached house, One-bedroom Coach House, Triple Carport, Store, Gym, Pond, Tennis Court, Outdoor Swimming Pool"</BLOCK>
- If the user asks about amenities, you MUST call cite_source for EACH relevant item:
- You MUST call: cite_source(cited_text="Five-bedroom detached house", block_id="BLOCK_CITE_ID_25", citation_number=10)
- You MUST call: cite_source(cited_text="One-bedroom Coach House", block_id="BLOCK_CITE_ID_25", citation_number=11)
- You MUST call: cite_source(cited_text="Triple Carport", block_id="BLOCK_CITE_ID_25", citation_number=12)
- You MUST call: cite_source(cited_text="Store", block_id="BLOCK_CITE_ID_25", citation_number=13)
- You MUST call: cite_source(cited_text="Gym", block_id="BLOCK_CITE_ID_25", citation_number=14)
- You MUST call: cite_source(cited_text="Pond", block_id="BLOCK_CITE_ID_25", citation_number=15)
- You MUST call: cite_source(cited_text="Tennis Court", block_id="BLOCK_CITE_ID_25", citation_number=16)
- You MUST call: cite_source(cited_text="Outdoor Swimming Pool", block_id="BLOCK_CITE_ID_25", citation_number=17)
- **CRITICAL**: When extracting citations for lists, cite EACH item separately - do NOT combine them into one citation

Example 6 - Descriptive Facts (Security, Landscaping, etc.):
- You see: <BLOCK id="BLOCK_CITE_ID_30">Content: "The property benefits from CCTV coverage throughout the external areas"</BLOCK>
- You MUST call: cite_source(cited_text="CCTV coverage throughout the external areas of the property", block_id="BLOCK_CITE_ID_30", citation_number=18)
- You see: <BLOCK id="BLOCK_CITE_ID_31">Content: "Well-maintained gardens with defined boundaries of timber fencing and mature hedging"</BLOCK>
- You MUST call: cite_source(cited_text="Well-maintained gardens with defined boundaries of timber fencing and mature hedging", block_id="BLOCK_CITE_ID_31", citation_number=19)
- **CRITICAL**: Descriptive facts about security, landscaping, property conditions, maintenance, or any property characteristics MUST be cited if they appear in the documents
- **CRITICAL**: Do NOT skip citations for descriptive information - if it's in the document and you mention it, you MUST cite it

**CRITICAL RULES:**
1. ✅ Call cite_source for EVERY factual claim (minimum 5-8 citations for most queries, 10-15+ for complex queries with lists/amenities)
2. ✅ Use sequential citation numbers (1, 2, 3, 4, 5...) - start from 1 and increment for each new citation
3. ✅ Find the BLOCK_CITE_ID in the <BLOCK> tags from the document extracts
4. ✅ Extract citations for ALL relevant information, not just one piece
5. ✅ **CRITICAL - ONE FACT PER CITATION**: Each distinct fact/value/date/name/item should get its own citation number
6. ✅ **CRITICAL - LISTS**: When you see lists (amenities, features, structures), extract a citation for EACH item in the list
7. ✅ **CRITICAL - MULTIPLE FACTS IN ONE BLOCK**: If a block contains multiple facts, extract a separate citation for EACH fact
8. ❌ Do NOT write an answer yet - ONLY extract citations by calling the tool
9. ❌ Do NOT skip citations - if you see multiple values, cite each one
10. ❌ Do NOT combine multiple facts into one citation - each fact needs its own citation number
11. ❌ Do NOT finish without calling the tool - tool calls are MANDATORY
8. ⚠️ **CRITICAL - NO DUPLICATE CITATIONS**: Do NOT cite the same fact twice. If you see the same information in different blocks or with slightly different wording (e.g., "EPC Rating: D" and "EPC Rating: The property has an Energy Performance Certificate (EPC) rating of D1"), cite it ONCE only. The system will automatically detect and skip duplicates, but you should avoid creating them.
9. ⚠️ **FOR VALUATION QUERIES - MANDATORY**: You MUST extract citations for ALL valuation scenarios:
   - Primary Market Value (e.g., "Market Value: £2,300,000")
   - 90-day value if mentioned (e.g., "90-day value: £1,950,000")
   - 180-day value if mentioned (e.g., "180-day value: £2,050,000")
   - Market Rent if mentioned (e.g., "Market Rent: £6,000 per calendar month")
   - **SEARCH ALL PAGES**: Reduced marketing period values often appear on later pages (page 28-30+) - do NOT stop after finding the primary Market Value
   - **EXAMPLE**: If you see "Market Value: £2,300,000" on page 30 and "90-day value: £1,950,000" on page 28, you MUST cite BOTH
10. ✅ **CRITICAL - VERIFY BLOCK_ID MATCHES CITED_TEXT EXACTLY**:
   - **BEFORE** calling cite_source, you MUST read the ENTIRE block content and verify it contains the EXACT fact you're citing
   - **STEP-BY-STEP VERIFICATION PROCESS**:
     1. Read the complete block content from start to finish
     2. Identify the core fact/statement in the block
     3. Compare it to the fact you want to cite
     4. Ask yourself: "Does this block actually state the same fact I'm citing?"
     5. Only use the block_id if the answer is YES
   - **CRITICAL RULES**:
     - The block must contain the SAME CORE MEANING as what you're citing
     - For values/amounts: The block must contain the exact number AND the context (e.g., "90-day value: £1,950,000" requires both "90-day" AND "£1,950,000" in the same block)
     - For negative statements: The block must contain BOTH the negative indicator (no/not/none) AND the core concept (e.g., "no planning history" requires both "no" and "planning history" in the block)
     - For decisions/status: The block must contain the exact decision word (e.g., "granted" vs "refused" - these are DIFFERENT facts)
   - **DO NOT**:
     - Use a block_id just because it's on the same page
     - Use a block_id just because it contains similar words
     - Use a block_id if the block talks about a DIFFERENT fact, even if related
     - Assume blocks are correct - always verify by reading the full block content
   - **EXAMPLE - CORRECT**:
     * You want to cite: "no recent planning history"
     * Block A content: "We note that the subject property has no recent planning history, within the last 10 years."
     * Block B content: "Planning consent is assumed for existing uses and is not affected by statutory notices."
     * ✅ CORRECT: Use Block A (it contains "no recent planning history")
     * ❌ WRONG: Do NOT use Block B (it talks about planning consent, not planning history)
   - **EXAMPLE - CORRECT**:
     * You want to cite: "Certificate of Lawfulness granted"
     * Block A content: "Certificate of Lawfulness granted for construction of games room"
     * Block B content: "Certificate of Lawfulness refused for construction of games room"
     * ✅ CORRECT: Use Block A (it says "granted")
     * ❌ WRONG: Do NOT use Block B (it says "refused" - this is a DIFFERENT fact)
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
    citations: list = None,
    is_citation_query: bool = False,
    is_agent_mode: bool = False
) -> str:
    """
    Prompt for answer generation with real-time citation tracking.
    Citations are now created as the LLM writes the answer.
    
    Args:
        is_agent_mode: If True, LLM has access to open_document tool for proactive display
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
    
    # Build conditional sourcing rules based on query type
    if is_citation_query:
        sourcing_rules = """**⚠️ CRITICAL RULE FOR CITATION QUERIES: ONLY USE DOCUMENT CONTENT ⚠️**

- **This is a citation query** - the user clicked on a specific citation and is asking about it
- You MUST ONLY use information that appears in the DOCUMENT EXTRACTS above
- Focus on information that relates to or expands on the cited text
- DO NOT use general knowledge, common sense, or assumptions about what "properties typically have" or "common risks"
- If the documents don't mention something related to the citation, DO NOT make it up or use generic examples
- If information is missing from the documents, explicitly state: "This information is not mentioned in the documents"
- DO NOT generate generic lists (e.g., "common risks that properties might face") - ONLY list what the documents actually say
- Search for information that links to or expands on the citation context

Create a comprehensive answer using ONLY the document extracts above, focusing on information related to the citation."""
        answer_instructions = """   - **CRITICAL (CITATION QUERY)**: You MUST ONLY use information from the DOCUMENT EXTRACTS above
   - **CRITICAL**: Focus on information that relates to or expands on the citation context
   - **CRITICAL**: DO NOT use general knowledge or make assumptions about what "properties in similar areas might face"
   - **CRITICAL**: If information is NOT in the document extracts, you MUST state that it's not mentioned in the documents
   - **CRITICAL**: If the documents don't mention specific risks, do NOT list generic risks - only mention what the documents actually say
   - Search for information that links to the citation - look for related details, explanations, or context around the cited text
   - The information IS available in the document extracts above (if citations were extracted)
   - If citations were extracted (see list above), the information EXISTS in the documents - you MUST use it
   - NEVER say "information not provided" or "not available" if citations were extracted
   - NEVER generate generic lists of "common risks" or "typical issues" - ONLY use what's in the documents
   - Start directly with the answer - do NOT repeat the question"""
        extraction_instructions = """   - **CRITICAL (CITATION QUERY)**: ONLY extract information that appears in the DOCUMENT EXTRACTS above
   - **CRITICAL**: Focus on information that relates to or expands on the citation context
   - **CRITICAL**: DO NOT use general knowledge or create generic lists (e.g., "common risks that properties might face")
   - **CRITICAL**: If the documents don't mention specific information, DO NOT make it up - state that it's not in the documents
   - Extract and include ALL relevant information FROM THE DOCUMENTS that links to the citation: prices, valuations, amounts, dates, names, addresses, assumptions, risks, etc.
   - **CRITICAL**: Include citation markers ([1], [2], [3], etc.) IMMEDIATELY after each specific fact/value being cited
   - **DO NOT** place citations at the end of sentences - place them right after the cited information
   - **Example**: "Market Value: £2,300,000[1] (Two Million, Three Hundred Thousand Pounds) for the freehold interest..."
   - Be professional, factual, and detailed - include all relevant figures, dates, names, and details FROM THE DOCUMENTS ONLY"""
    else:
        sourcing_rules = """**INFORMATION SOURCING RULES:**

- **PREFER document content**: Use information from the DOCUMENT EXTRACTS above whenever available
- **General knowledge is acceptable**: If the documents don't contain the information, you may use general knowledge to provide a helpful answer
- **Be clear about sources**: If using general knowledge, you can mention it's general information (but don't need citation markers for it)
- **Citation markers**: Only add citation markers [1], [2], [3]... for facts that come from the document extracts
- **Balance**: Provide helpful, comprehensive answers using document content when available, supplemented with general knowledge when needed

Create a comprehensive answer to the user's question, prioritizing information from the document extracts above."""
    
    # AGENT MODE: Add instructions for proactive document display and navigation
    agent_mode_instructions = ""
    if is_agent_mode:
        agent_mode_instructions = """

**🎯 AGENT MODE - AVAILABLE TOOLS:**

You have tools to proactively help the user with navigation and document display.

---
**1. 🧭 NAVIGATION TOOL (PREFERRED for property map requests)**

**navigate_to_property_by_name(property_name: str, reason: str)**

This is the MAIN tool for navigation requests. Use it when the user wants to go to a property on the map.

**WHEN TO USE:**
- "take me to [property name]"
- "go to [property]"
- "show me [property] on the map"
- "navigate to [property]"
- "where is [property]" (if they want to see it on map)
- "find [property] on the map"

**HOW TO USE:**
1. Write a brief response: "I'll take you to the Highlands property on the map."
2. Call the tool: navigate_to_property_by_name(property_name="highlands", reason="Navigating to Highlands property as requested")

**EXAMPLES:**
- User: "take me to the highlands pin"
  → Call: navigate_to_property_by_name(property_name="highlands", reason="Navigating to Highlands property as requested")

- User: "show me berden road on the map"
  → Call: navigate_to_property_by_name(property_name="berden road", reason="Showing Berden Road property on map")

**CRITICAL:**
- This tool handles EVERYTHING: search + map open + pin selection
- DO NOT also call search_property, show_map_view, or select_property_pin
- DO NOT try to answer navigation requests with document content

---
**2. 📄 DOCUMENT DISPLAY TOOL (for showing source documents)**

**open_document(citation_number: int, reason: str)**

Shows the user the source document for a citation. Use AFTER answering factual questions.

**WHEN TO USE:**
- ✅ After answering with citations - show the source
- ✅ When answer contains values (prices, valuations) - show evidence
- ✅ When user asks "what does it say about..."

**WHEN NOT TO USE:**
- ❌ For navigation requests (use navigate_to_property_by_name instead)
- ❌ For simple yes/no questions
- ❌ When you have no citations

---
**TOOL RULES:**
- Use actual TOOLS, not text - the tools perform the actions
- DO NOT write function calls as text in your response
- For navigation: brief response + call navigate_to_property_by_name
- For document display: full answer with citations + call open_document
"""
    
        answer_instructions = """   - **PREFER document content**: Use information from the DOCUMENT EXTRACTS above when available
   - **General knowledge allowed**: If documents don't contain the information, you may use general knowledge to provide a helpful answer
   - **Citation markers**: Only add [1], [2], [3]... for facts from document extracts (not general knowledge)
   - The information IS available in the document extracts above (if citations were extracted)
   - If citations were extracted (see list above), the information EXISTS in the documents - prioritize using it
   - If using general knowledge, provide helpful context but don't add citation markers for it
   - Start directly with the answer - do NOT repeat the question"""
        extraction_instructions = """   - **PREFER document content**: Extract information from the DOCUMENT EXTRACTS above when available
   - **General knowledge allowed**: If documents don't contain information, you may supplement with general knowledge
   - Extract and include ALL relevant information: prices, valuations, amounts, dates, names, addresses, assumptions, risks, etc.
   - **CRITICAL**: Include citation markers ([1], [2], [3], etc.) IMMEDIATELY after each specific fact/value FROM THE DOCUMENTS
   - **Note**: Don't add citation markers to general knowledge - only to facts from document extracts
   - **DO NOT** place citations at the end of sentences - place them right after the cited information
   - **Example**: "Market Value: £2,300,000[1] (Two Million, Three Hundred Thousand Pounds) for the freehold interest..."
   - Be professional, factual, and detailed - prioritize document content, supplement with general knowledge when helpful"""
    
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
- **⚠️ CRITICAL - EVERY FACT FROM DOCUMENTS MUST HAVE A CITATION**:
  * **ABSOLUTE RULE**: If you mention ANY fact, detail, feature, or information that comes from the document extracts above, you MUST include a citation marker for it
  * **NO EXCEPTIONS**: This includes descriptive facts like "CCTV coverage", "well-maintained gardens", "timber fencing", "mature hedging", security features, landscaping details, property conditions, maintenance information, or ANY other information from the documents
  * **CRITICAL**: If a fact appears in your answer and it's based on document content (not general knowledge), it MUST have a citation marker - there are NO exceptions
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
    - Match by DESCRIPTIVE FACT: If you're writing "CCTV coverage", find the citation that mentions "CCTV" or "security" and use its number. If you're writing "well-maintained gardens", find the citation that mentions "gardens" or "landscaping" and use its number
    - **CRITICAL**: For descriptive facts, search for keywords in the Phase 1 citations - if a citation mentions "CCTV" or "security", use it for security-related facts. If a citation mentions "gardens" or "landscaping", use it for landscaping facts
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
- **Example CORRECT (Descriptive Facts)**: If Phase 1 has [10]=CCTV coverage, [11]=Well-maintained gardens, write: "Security: CCTV coverage throughout the external areas of the property[10]. Landscaping: Well-maintained gardens with defined boundaries of timber fencing and mature hedging[11]."
- **CRITICAL**: Descriptive facts like security features and landscaping MUST have citations - do NOT write them without citation markers
- **Example INCORRECT**: "Market Value: £2,300,000[1]. Property Address: Highlands[2]. 90-day value: £1,950,000[3]." (WRONG - used [2] for property address when Phase 1 has it as [3], used [3] for 90-day value when Phase 1 has it as [4])
- **Example INCORRECT**: "Security: CCTV coverage throughout the external areas of the property. Landscaping: Well-maintained gardens with defined boundaries of timber fencing and mature hedging." (WRONG - missing citations for descriptive facts)
- **Example INCORRECT**: "Market Value: £2,300,000 [1]" (WRONG - space before citation)
- **Example INCORRECT**: "Market Value: £2,300,000. [1]" (WRONG - period and space before citation)
- **Example INCORRECT**: "Valuation conducted by Sukhbir Tiwana MRICS and Graham Finegold MRICS. [6] [7]" (WRONG - citations at end, should be: "Sukhbir Tiwana[6] MRICS and Graham Finegold[7] MRICS")
- **DO NOT** create sequential citation numbers - use the exact citation numbers from Phase 1 that match your facts

### TASK: Create Final Answer with Citations

**⚠️ CRITICAL - FORMATTING CONSISTENCY FOR ALL RESPONSES ⚠️**
- Apply the SAME formatting standards (headings, structure, citations, Key Concepts section) as if this were the FIRST response in the conversation
- DO NOT abbreviate, shorten, or reduce formatting quality because of conversation history
- Even for follow-up questions, you MUST use the full CANONICAL TEMPLATE STRUCTURE below
- ALWAYS include: H1 heading, Key Concepts section with vertical label-value format, and proper citations
- The fact that there's conversation history does NOT mean you should provide less formatted answers
- Each response should be comprehensive and well-structured on its own

{sourcing_rules}
{agent_mode_instructions}
**⚠️ CRITICAL FOR VALUATION QUERIES:**
- If the user is asking about "value" or "valuation", you MUST include ALL valuation scenarios found in the documents
- **MANDATORY**: If documents mention "90-day value" or "180-day value", you MUST include them with their assumptions
- **MANDATORY**: Include Market Rent if mentioned in documents
- **DO NOT**: Only include the primary Market Value - you MUST include ALL scenarios (90-day, 180-day, etc.)
- **DO NOT**: Skip assumption scenarios - they are REQUIRED if mentioned in documents

**CITATION MARKERS (BRACKET FORMAT - INVISIBLE TO USER)**:
- **MUST**: Use bracket format [1], [2], [3], [4], [5]... for citation markers (these will be converted to buttons by the frontend)
- **MUST**: Place citation markers IMMEDIATELY after the specific value/amount/date/name/descriptive fact being cited - NO SPACE, NO PUNCTUATION between fact and citation
- **CRITICAL**: Write as ONE unit: "£2,300,000[1]" NOT "£2,300,000 [1]" and NOT "£2,300,000. [1]"
- **CRITICAL**: For descriptive facts, also write as ONE unit: "CCTV coverage throughout the external areas of the property[10]" NOT "CCTV coverage throughout the external areas of the property [10]"
- **CRITICAL**: For multiple valuers, cite each separately: "Sukhbir Tiwana[6] MRICS and Graham Finegold[7] MRICS" (NOT "Sukhbir Tiwana and Graham Finegold MRICS. [6] [7]")
- **DO NOT** place citations at the end of sentences - place them right after the cited fact with NO separation
- **CRITICAL**: Match facts to citations extracted in Phase 1 - use the EXACT citation number from Phase 1 that corresponds to the fact you're stating
- **CRITICAL**: Use the ORIGINAL Phase 1 citation numbers - do NOT create sequential numbers. The system will automatically renumber them based on appearance order.
- **CRITICAL**: Each citation marker is permanently attached to its fact - they must always appear together as a single unit
- **DO NOT** place citations at the end of sentences, paragraphs, or after periods - place them immediately after the fact with no space or punctuation
- **CRITICAL - DESCRIPTIVE FACTS MUST BE CITED**: If you mention security features, landscaping, property conditions, maintenance details, or any descriptive information from the documents, you MUST include a citation marker. Examples:
  * ✅ CORRECT: "Security: CCTV coverage throughout the external areas of the property[10]"
  * ✅ CORRECT: "Landscaping: Well-maintained gardens with defined boundaries of timber fencing and mature hedging[11]"
  * ❌ WRONG: "Security: CCTV coverage throughout the external areas of the property" (missing citation)
  * ❌ WRONG: "Landscaping: Well-maintained gardens with defined boundaries of timber fencing and mature hedging" (missing citation)
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
   - Example: "# Property Valuation Summary"

2. **Key Concepts (H2)**:
   - Use markdown heading ## (double hash) for "Key Concepts" section
   - Use vertical label-value format (NOT inline format)
   - Format: "**Label:**\nValue[1]\n*Secondary note*"
   - Maximum 5 key concepts
   - Example: "## Key Concepts\n\n**Market Value:**\n£2,300,000[1]\n*The primary valuation figure*"

3. **Process/Steps (H2 - Conditional)**{steps_note}:
   - Only include if applicable (procedural queries)
   - Use markdown heading ## (double hash) for "Process / Steps"
   - Use numbered list (1., 2., 3.) for steps
   - Each step: "1. **Step 1:** Clear action"
   - Maximum 5 steps (split into sub-sections if more)

4. **Practical Application (H2 - Conditional)**{practical_note}:
   - Include if query requires real-world application guidance
   - Use markdown heading ## (double hash) for "Practical Application"
   - 1-2 paragraphs explaining how to use this information
   - Maximum 3 sentences per paragraph

5. **Risks/Edge Cases (H2 - Optional)**{risks_note}:
   - Include only if relevant limitations or risks exist
   - Use markdown heading ## (double hash) for "Risks / Edge Cases"
   - Use bullet points (-) for list of risks/limitations
   - Maximum 5 bullet points

6. **Next Actions (H2 - Optional)**{next_actions_note}:
   - Include if follow-up actions are suggested
   - Use markdown heading ## (double hash) for "Next Actions"
   - Use bullet points (-) for suggested follow-ups
   - Maximum 5 bullet points

**HEADING HIERARCHY RULES (CRITICAL)**:
- NEVER skip heading levels (# → ## → ###, not # → ###)
- If a section can be read independently → it deserves a ## (H2)
- # (H1) = Final outcome/main answer (only one H1 per response)
- ## (H2) = Major sections (Key Concepts, Process/Steps, Practical Application, etc.)
- ### (H3) = Sub-sections within H2 sections
- Regular paragraphs = Explanation text
- **CRITICAL - Use Bullet Points for Lists**: When presenting multiple items (amenities, features, structures, etc.), use bullet points:
  ```
  **Additional Structures:**
  - One-bedroom Coach House
  - Triple Carport
  - Store
  - Gym
  ```
- **DO NOT** list multiple items on one line separated by commas
- **DO NOT** list multiple items as plain text lines without bullets
- Numbered lists (1., 2., 3.) = Process/Steps sections only

**INFORMATION ORDERING (MUST FOLLOW)**:
1. Answer first (# H1 - primary answer)
2. Explain later (## H2 - Key Concepts)
3. Extend optionally (Process, Practical Application, Risks, Next Actions)

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
- For simple queries: # H1 + ## Key Concepts may be sufficient

**CONTENT GENERATION INSTRUCTIONS**:

1. **Answer Directly and Comprehensively** (MUST)
{answer_instructions}

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
{extraction_instructions}

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

{_get_entity_normalization_instructions()}

Generate the answer content:"""


# ============================================================================
# GENERAL QUERY PROMPTS
# ============================================================================

def get_general_query_prompt(
    user_query: str,
    conversation_history: str,
    current_date: str,
    current_time: str
) -> str:
    """
    Prompt for general knowledge queries.
    Includes current date/time context.
    Pattern: Follow get_summary_human_content() structure
    """
    return f"""**USER QUESTION:**  
"{user_query}"

**CONVERSATION HISTORY:**  
{conversation_history}

**CURRENT DATE/TIME CONTEXT:**
- Current Date: {current_date}
- Current Time: {current_time}

**INSTRUCTIONS:**
Answer the user's question using your general knowledge. If the question is about the current date or time, use the information provided above.

Be concise, accurate, and helpful. If your knowledge has a cutoff date, mention it when relevant.

{_get_entity_normalization_instructions()}

**Answer:**"""


# ============================================================================
# TEXT TRANSFORMATION PROMPTS
# ============================================================================

def get_text_transformation_prompt(
    text_to_transform: str,
    transformation_instruction: str,
    user_query: str
) -> str:
    """
    Prompt for text transformation.
    Handles: sharpen, reorganize, concise, expand, rephrase
    Pattern: Follow get_summary_human_content() structure
    """
    return f"""**USER REQUEST:**  
"{user_query}"

**TRANSFORMATION INSTRUCTION:**  
{transformation_instruction}

**TEXT TO TRANSFORM:**  
{text_to_transform}

**INSTRUCTIONS:**
Transform the text above according to the user's instruction. Preserve all key information, facts, and citations (if present). Follow the transformation instruction precisely while maintaining the original intent and meaning.

**Transformed Text:**"""


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
- **CRITICAL - AVOID DUPLICATION**: Do NOT repeat the same information in multiple sections. Key Concepts should be concise and comprehensive.

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
   - Ensure all content follows: # H1 → ## H2 → ### H3 hierarchy
   - **CRITICAL**: When extracting key concepts, use vertical label-value format:
     ```
     ## Key Concepts
     
     **Market Value:**
     £2,300,000[1]
     *The primary valuation figure for the freehold interest*
     ```
   - **DO NOT** use inline format like "- **Market Value**: £2,300,000[1] - The primary valuation figure"
   - **CRITICAL**: Key Concepts should be comprehensive and concise - include all important information using the vertical label-value layout

**CITATION HANDLING** (CRITICAL):
- **MUST INCLUDE citation markers** ([1], [2], [3], etc.) in the text immediately after each fact
- **CRITICAL**: Citation markers are REQUIRED in the text - the frontend automatically converts them to clickable citation buttons
- **IMPORTANT**: The markers will NOT appear as raw text "[1]" to users - they will be rendered as styled clickable buttons by the frontend
- Place citation markers directly after the fact they support: "£2,300,000[1]" not "£2,300,000 [1]" or "£2,300,000[1]."
- Use the EXACT citation numbers from Phase 1 (see citation list above)
- **DO NOT** remove citation markers - they are essential for the frontend to render citations correctly
- **DO NOT** place citations at the end of sentences or paragraphs - they must be inline with the fact

**FORMATTING STANDARDS - MAXIMUM CLARITY**:
- Use markdown heading syntax: # for H1, ## for H2, ### for H3
- **CRITICAL**: Make values immediately clear and scannable
- Use **bold** for section headers (## Header) - these should be clear and descriptive
- **CRITICAL - Smart Bolding**: Only bold what makes sense - labels and section headers, NOT all values
- For key data points, use this structure:
  ```
  ## Section Header
  
  **Key Label:**
  Value[1] (regular text, not bolded - only the label is bold)
  *Secondary note or assumption in italics*
  ```
- **CRITICAL - All Values Must Have Labels**: Every value, figure, amount, date, and name MUST have a clear label/title
  - Labels should be bold: "**Market Value:**", "**90-Day Value:**", "**Market Rent:**", "**Valuation Date:**", "**Valuers:**"
  - Values should be regular text (NOT bold): "£2,300,000[1]", "12th February 2024[2]", "Sukhbir Tiwana MRICS[3]"
  - **DO NOT** show values without labels - this is misleading and unclear
- **BOLD ONLY**:
  - Section headers (## Header)
  - Labels (e.g., **Market Value:**, **Parking:**, **Security:**)
  - Category names in lists (e.g., **Type:**, **Additional Structures:**)
- **DO NOT BOLD**:
  - Actual values (e.g., £2,300,000[1] should be regular text)
  - Dates (e.g., 12th February 2024[2] should be regular text)
  - Names (e.g., Sukhbir Tiwana MRICS[3] should be regular text)
  - List items (e.g., "Five-bedroom detached house[1]" should be regular text)
  - Descriptive text (e.g., "Ample parking for multiple cars[9]" should be regular text)
- **DO NOT** use inline format: "Label: Value" - this makes values harder to scan
- **DO NOT** embed multiple pieces of information in one line
- Place values on the line below the label with clear separation
- Use italic (*text*) for assumptions/explanatory notes beneath primary values
- Use blank lines between sections for better visual separation
- **CRITICAL - Use Bullet Points for Lists**: When a section contains multiple items (amenities, features, structures, etc.), use bullet points:
  ```
  **Additional Structures:**
  - Item 1[1]
  - Item 2[2]
  - Item 3[3]
  ```
- **DO NOT** list multiple items on one line separated by commas
- **DO NOT** list multiple items as plain text lines without bullets
- Use numbered lists (1., 2., 3.) for Process/Steps sections only
- **CRITICAL**: Each important data point should be on its own line for immediate clarity
- **PUNCTUATION**: Do NOT add periods/full stops at the end of standalone lines (headings, values, list items). Only use periods when text continues on the same line after the sentence. Example:
  - ✅ "## Market Value\n£2,300,000[1]" (no period - value on its own line)
  - ✅ "**Valuation Date:**\n12th February 2024[2]" (no period - value on its own line)
  - ✅ "The value is £2,300,000[1]. This represents the market value." (period needed - sentence continues)
  - ❌ "£2,300,000[1]." (unnecessary period on standalone value line)

**CORRECT FORMATTING EXAMPLES** (Follow These Patterns - Citations MUST be included in the output):

✅ **CORRECT - H1 with citation** (only labels are bolded, values are regular text):
```
# Property Valuation Summary

## Market Value

**Market Value:**
£2,300,000[1]

The property has a market value of £2,300,000[1] for the freehold interest as of 12th February 2024[2].
```

✅ **CORRECT - Key Concepts with vertical label-value format** (labels are bolded, values are regular text):
```
## Key Concepts

**Market Value:**
£2,300,000[1]
*The primary valuation figure for the freehold interest*

**Valuation Date:**
12th February 2024[2]
*When the valuation was conducted*

**Valuers:**
Sukhbir Tiwana MRICS[3]
Graham Finegold MRICS[4]
*Registered valuers*

**90-Day Value:**
£1,950,000[5]
*Reduced marketing period scenario (15% discount)*

**180-Day Value:**
£2,050,000[6]
*Extended marketing period scenario (10% discount)*
```

**CRITICAL - All Values Must Have Labels**:
- **MUST**: Every value, figure, amount, date, and name MUST have a clear label/title
- **MUST**: Use format "**Label:**" followed by "Value[1]" on the next line (label is bold, value is regular text)
- **MUST**: Include labels for names (e.g., "**Valuers:**", "**Property Owner:**", "**Agent:**")
- **MUST**: Include labels for dates (e.g., "**Valuation Date:**", "**Completion Date:**")
- **MUST**: Include labels for amounts (e.g., "**Market Value:**", "**90-Day Value:**", "**Market Rent:**")
- **DO NOT** show values without labels - this is misleading and unclear
- **DO NOT** bold the actual values - only bold the labels

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

{_get_entity_normalization_instructions()}

**MUST**: Do NOT remove or omit any information from the raw response. Your job is to organize and format it better, not to filter it. The content is already complete - only format and structure it.

**FORMATTED RESPONSE**:"""


# ============================================================================
# COMBINED CITATION + ANSWER PROMPT (SINGLE LLM CALL OPTIMIZATION)
# ============================================================================

def get_combined_citation_answer_prompt(
    user_query: str,
    conversation_history: str,
    search_summary: str,
    formatted_outputs: str,
    metadata_lookup_tables: dict = None
) -> str:
    """
    OPTIMIZED: Combined prompt for citation extraction AND answer generation in ONE LLM call.
    This saves ~4-6 seconds compared to the 2-phase approach.
    
    The LLM will:
    1. Call cite_source tool for each factual claim it wants to include
    2. Return the final answer text with citation markers [1], [2], etc.
    """
    # Build metadata lookup section
    metadata_section = ""
    if metadata_lookup_tables:
        import logging
        logger = logging.getLogger(__name__)
        
        metadata_section = "\n--- Block ID Reference Table ---\n"
        metadata_section += "Use these block IDs when calling cite_source().\n\n"
        
        MAX_BLOCKS_PER_DOC = 300  # Reduced for combined prompt
        total_blocks = 0
        
        for doc_id, metadata_table in metadata_lookup_tables.items():
            doc_id_short = doc_id[:8] + "..." if len(doc_id) > 8 else doc_id
            
            limited_blocks = list(metadata_table.items())[:MAX_BLOCKS_PER_DOC]
            if len(metadata_table) > MAX_BLOCKS_PER_DOC:
                logger.warning(f"[PROMPT] Limiting metadata for doc {doc_id_short} from {len(metadata_table)} to {MAX_BLOCKS_PER_DOC} blocks")
            
            metadata_section += f"\nDocument {doc_id_short}:\n"
            
            for block_id, bbox_data in sorted(limited_blocks):
                total_blocks += 1
                bbox_left, bbox_top, bbox_width, bbox_height, page = _format_bbox_for_prompt(bbox_data)
                metadata_section += f"  {block_id}: page={page}\n"
            
            if len(metadata_table) > MAX_BLOCKS_PER_DOC:
                metadata_section += f"  ... ({len(metadata_table) - MAX_BLOCKS_PER_DOC} more blocks not shown)\n"
    
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

### TASK: Answer the question WITH citations (SINGLE PASS)

You must answer the user's question while citing your sources. Do this in ONE response:

**STEP 1 - For EACH fact you include in your answer:**
- Call the `cite_source` tool with:
  - `block_id`: The BLOCK_CITE_ID from the document (e.g., "BLOCK_CITE_ID_42")
  - `citation_number`: Sequential number (1, 2, 3...) - MUST BE UNIQUE AND INCREMENT FOR EACH CALL
  - `cited_text`: The fact you're citing

**STEP 2 - Write your answer with citation markers:**
- Place [1], [2], [3]... immediately after each fact
- Example: "The Market Value is £2,300,000[1] as of February 2024[2]"

**⚠️ CRITICAL - CITATION NUMBERING RULES (MUST FOLLOW) ⚠️**
- EACH cite_source call MUST have a DIFFERENT citation_number
- citation_number MUST increment: first call = 1, second call = 2, third call = 3, etc.
- NEVER use the same citation_number twice - every fact gets a UNIQUE number
- In your answer text, use the SAME numbers: [1] for first fact, [2] for second fact, [3] for third fact
- **WRONG**: cite_source(..., citation_number=1), cite_source(..., citation_number=1), cite_source(..., citation_number=1)
- **CORRECT**: cite_source(..., citation_number=1), cite_source(..., citation_number=2), cite_source(..., citation_number=3)

**CRITICAL RULES:**
- Call cite_source for EVERY factual claim
- Use STRICTLY sequential citation numbers (1, 2, 3...) - NEVER repeat a number
- Place citations IMMEDIATELY after the fact, NO space
- For valuation queries: include ALL scenarios (90-day, 180-day, Market Rent)
- Do NOT add periods at the end of standalone lines, headings, or bullet points - only use periods when text continues on the same line

**EXAMPLE:**
If you see: <BLOCK id="BLOCK_CITE_ID_42">Content: "Market Value: £2,300,000"</BLOCK>
And: <BLOCK id="BLOCK_CITE_ID_43">Content: "Valuation date: 12th February 2024"</BLOCK>
1. Call: cite_source(block_id="BLOCK_CITE_ID_42", citation_number=1, cited_text="Market Value: £2,300,000")
2. Call: cite_source(block_id="BLOCK_CITE_ID_43", citation_number=2, cited_text="Valuation date: 12th February 2024")
3. Write: "The Market Value is £2,300,000[1] as of 12th February 2024[2]"

**IMPORTANT: You MUST return BOTH:**
1. Call cite_source() for each fact (tool calls) - with UNIQUE sequential citation_numbers
2. Write the complete answer text below (with [1], [2], [3]... markers matching the tool calls)

DO NOT return only tool calls - you MUST also write the answer text!

{_get_entity_normalization_instructions()}

**YOUR ANSWER (write the complete answer WITH citation markers below):**"""


# ============================================================================
# ATTACHMENT CONTEXT PROMPTS - For file attachments in chat
# ============================================================================

# Prompt for FAST response mode (no citations)
ATTACHMENT_CONTEXT_FAST_PROMPT = """
**USER-ATTACHED DOCUMENT CONTEXT:**
The user has attached the following document(s) to their query. Answer based on this content.

{attachment_context}

**INSTRUCTIONS:**
- Answer the user's question based ONLY on the attached document content
- Be concise and direct
- Do NOT include citation markers ([1], [2], etc.) - this is a fast response mode
- Do NOT reference page numbers or document structure
- Simply provide the answer as if having a conversation
- If the answer is not in the documents, say so clearly

**USER QUERY:** {query}
"""

# Prompt for DETAILED response mode (with page references)
ATTACHMENT_CONTEXT_DETAILED_PROMPT = """
**USER-ATTACHED DOCUMENT CONTEXT:**
The user has attached the following document(s) for detailed analysis.

{attachment_context}

**INSTRUCTIONS:**
- Answer the user's question based on the attached document content
- Include page references like "(Page 3)" or "(Pages 5-7)" when citing specific information
- Be thorough but organized
- Use headers and bullet points for clarity
- If information spans multiple pages, note the range
- If the answer is not in the documents, say so clearly

**REFERENCE FORMAT:**
- "(Page X)" for single page references
- "(Pages X-Y)" for ranges
- Example: "The property was valued at £2.3M (Page 12) with a 90-day value of £2.1M (Page 14)"

**USER QUERY:** {query}
"""

# Prompt for FULL/PROJECT response mode (with clickable citations after processing)
ATTACHMENT_CONTEXT_FULL_PROMPT = """
**USER-ATTACHED DOCUMENT CONTEXT:**
The user has attached document(s) that are being processed for full integration.
For now, answer based on the extracted text below. Citations will become clickable once processing completes.

{attachment_context}

**INSTRUCTIONS:**
- Answer the user's question based on the attached document content
- Include page references like "(Page X)" that will later become clickable citations
- Be thorough and professional
- Structure your answer with clear sections
- If the answer is not in the documents, say so clearly

**NOTE:** The documents are being processed in the background. Page references will become
clickable citations that open the document at the referenced location once processing completes.

**USER QUERY:** {query}
"""

def format_attachment_context(attachment_context: dict) -> str:
    """Format attachment context for inclusion in prompts."""
    if not attachment_context:
        return ""
    
    texts = attachment_context.get('texts', [])
    filenames = attachment_context.get('filenames', [])
    page_texts = attachment_context.get('pageTexts', [])
    
    formatted_parts = []
    
    for i, (text, filename) in enumerate(zip(texts, filenames)):
        formatted_parts.append(f"=== DOCUMENT {i+1}: {filename} ===")
        
        # If we have page-by-page text, use it for better structure
        if page_texts and i < len(page_texts) and page_texts[i]:
            for page_num, page_text in enumerate(page_texts[i], 1):
                if page_text.strip():
                    formatted_parts.append(f"\n--- Page {page_num} ---")
                    formatted_parts.append(page_text.strip())
        else:
            # Fall back to full text
            formatted_parts.append(text)
        
        formatted_parts.append("")  # Empty line between documents
    
    return "\n".join(formatted_parts)

def get_attachment_prompt(response_mode: str, attachment_context: dict, query: str) -> str:
    """Get the appropriate prompt based on response mode."""
    formatted_context = format_attachment_context(attachment_context)
    
    if response_mode == 'fast':
        return ATTACHMENT_CONTEXT_FAST_PROMPT.format(
            attachment_context=formatted_context,
            query=query
        )
    elif response_mode == 'detailed':
        return ATTACHMENT_CONTEXT_DETAILED_PROMPT.format(
            attachment_context=formatted_context,
            query=query
        )
    else:  # 'full' or default
        return ATTACHMENT_CONTEXT_FULL_PROMPT.format(
            attachment_context=formatted_context,
            query=query
        )

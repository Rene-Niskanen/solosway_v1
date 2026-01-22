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

VALUATION_PRIORITIZATION_RULES = """
**VALUATION PRIORITIZATION (MUST FOLLOW)**:
1. Prioritize professional valuation figures over market activity prices
   - Professional: "we are of the opinion", "Market Value", formal assessments
   - Market activity: "under offer", "guide price", "listed for", "asking price"
   - For valuation queries, use professional valuations FIRST, then include market activity below

2. Extract ALL valuation scenarios separately
   - Primary Market Value (vacant possession, normal marketing period)
   - Each reduced marketing period scenario (90 days, 180 days, etc.) - extract separately
   - Market Rent (if provided)
   - Do not stop after finding one figure - read entire valuation section

3. Do NOT use "under offer" prices as Market Value
   - "Under offer" describes market activity, not professional assessment
   - Continue searching for formal Market Value statement
"""

CITATION_FORMAT_RULES = """
**CITATION FORMAT (MUST FOLLOW)**:
- Use bracket format: [1], [2], [3], etc. (frontend converts these to buttons)
- Place citations IMMEDIATELY after the specific fact/value being cited
- Use ONE citation per fact/value - do NOT use multiple citations for the same value
- If multiple facts appear together, each gets its own citation: "Example Valuer[1] MRICS on DD Month YYYY[2]"

**CORRECT**: "Market Value: £X,XXX,XXX[1] (written form) for the freehold interest..."
**INCORRECT**: "Market Value: £X,XXX,XXX (written form) for the freehold interest... [1] [2]"
"""

# ============================================================================
# SHARED INSTRUCTION HELPERS (CONSOLIDATED)
# ============================================================================

def _get_search_instructions(scope: str = "excerpt") -> str:
    """Consolidated search instructions combining all search strategies."""
    scope_text = "ALL document excerpts" if scope == "all excerpts" else "the entire excerpt"
    return f"""**SEARCH STRATEGY**:
- Search through {scope_text} comprehensively - do NOT stop at the first match
- Information may appear in multiple sections or on different pages - search all pages, especially pages 20-30+ for valuation sections
- Use semantic analysis to identify relevant sections - prioritize professional assessment language over market activity descriptions
- Extract values/information EXACTLY as written in the relevant section
- For names/professional info: Search for synonyms (valuer/appraiser/surveyor/inspector/MRICS/FRICS) and phrases ("conducted by", "valued by")
- Names may appear in different formats - search for variations
- Do NOT say "not found" until you have thoroughly searched {scope_text}"""


def _get_valuation_extraction_instructions(detail_level: str = 'concise', is_valuation_query: bool = False) -> str:
    """Simplified valuation extraction instructions."""
    if detail_level != 'detailed' and not is_valuation_query:
        return ""
    
    return """**VALUATION EXTRACTION**:
1. Identify Professional Valuations: Look for "we are of the opinion", "Market Value", MRICS/FRICS. Ignore "under offer", "guide price".
2. Extract ALL Scenarios: Primary Market Value, 90-day value (if mentioned), 180-day value (if mentioned), Market Rent (if provided). Each with its assumptions.
3. Search Strategy: Read ENTIRE valuation section - do NOT stop after first figure. Check pages 20-30+ where detailed valuations often appear.
4. Presentation: Format as £[amount] with assumptions. Start with primary Market Value, then other scenarios."""


def _get_verified_property_details_instructions(is_single_doc: bool = True) -> str:
    """Simplified verified property details instructions."""
    if is_single_doc:
        return """3. **Prioritize Verified Property Details**: If document begins with "PROPERTY DETAILS (VERIFIED FROM DATABASE):", that information is definitive. Use it directly for attribute questions. Do not claim "no information" when details are present."""
    else:
        return """3. **Use Verified Property Details First**: If any excerpt includes "PROPERTY DETAILS (VERIFIED FROM DATABASE)" section, treat as authoritative for attribute-based questions. Present directly without mentioning document names."""


def _get_entity_normalization_instructions() -> str:
    """Simplified entity normalization instructions."""
    return """
**PRESENTATION FORMAT**:
1. **Normalize Data**: Each piece of data appears once. Merge duplicates (e.g., "Company: X" and "Valuation Company: X" → ONE section).
2. **Section Headers**: Use H1 (#) for main title, H2 (##) for major sections (e.g., "Market Value", "Valuers").
3. **Label-Value Layout**: Use vertical format - label on one line (bold), value on next line (regular text):
   ```
   **Market Value:**
   £X,XXX,XXX[1]
   *Market value with vacant possession, normal marketing period*
   ```
4. **Citation Markers**: Place [1], [2], [3] immediately after each fact - "£X,XXX,XXX[1]" NOT "£X,XXX,XXX [1]"
5. **Lists**: Use bullet points for multiple items. Each item on its own line with citation if applicable.
6. **Remove Noise**: Remove phrases like "The firm responsible for..." - keep only essential information.
"""


def _get_no_unsolicited_content_instructions() -> str:
    """Simplified instructions for avoiding unsolicited content."""
    return """**Comprehensive but Focused Response**: Provide complete answer with all relevant details. Do NOT repeat the question as a heading. Do NOT add "Additional Context" sections, "Next steps:", or follow-up suggestions. Present all information in well-organized, professional manner."""


# ============================================================================
# QUERY REWRITING PROMPTS
# ============================================================================

def get_query_rewrite_human_content(user_query: str, conversation_history: str) -> str:
    """Human message content for rewriting follow-up or vague user queries."""
    return f"""CONVERSATION HISTORY:
{conversation_history}

CURRENT FOLLOW-UP QUERY:
"{user_query}"

GOAL:
- If conversation history exists, ALWAYS include property name/address from previous conversation in rewritten query
- If query refers ambiguously to prior conversation (e.g., "the document", "this property", "it"), rewrite to explicitly include relevant context
- If query is already self-contained and includes property identifier, return it unchanged

REWRITE GUIDELINES:
1. Extract property name/address from conversation history (MANDATORY if history exists)
2. Include relevant entities: property addresses, document names, property features, prices/values mentioned
3. Maintain user's original intent - only clarify, don't change meaning
4. Keep under ~200 words
5. Return ONLY the rewritten query text, no explanations

**Now, provide the rewritten query:**"""


# ============================================================================
# QUERY EXPANSION PROMPTS
# ============================================================================

def get_query_expansion_human_content(original_query: str) -> str:
    """Human message content for generating query variations."""
    return f"""Original Query:
"{original_query}"

Generate 2 variations using:
1. Synonyms (e.g., "price" → "market value", "valuation", "asking price")
2. Related domain terms (e.g., "lease" → "rental agreement", "tenancy")
3. Different phrasing (e.g., "How many bedrooms?" → "bedroom count", "number of bedrooms")

Keep each under 50 words. Return ONLY the 2 variations, one per line, no numbering.

Variations:"""


# ============================================================================
# QUERY ROUTING PROMPTS
# ============================================================================

def get_query_classification_prompt(user_query: str, conversation_history: str = "") -> str:
    """Prompt for classifying query intent."""
    history_section = f"\n\nConversation History:\n{conversation_history}" if conversation_history else ""
    return f"""Here is the context:  
{history_section}

**Current User Query:**  
"{user_query}"

**CLASSIFY** the intent as exactly one of: `general_query`, `text_transformation`, `document_search`, `follow_up_document_search`, `hybrid`

- **general_query**: General knowledge questions not requiring document search (e.g., "What is the date today?")
- **text_transformation**: Requests to modify/reorganize EXISTING TEXT (e.g., "Make this text sharper")
- **document_search**: Queries requiring document search (e.g., "What is the market value?")
- **follow_up_document_search**: Asking for more detail on specific topic from previous document search
- **hybrid**: Queries needing both general knowledge and document search

Return ONLY one word: the classification label.

**Answer:**"""


def get_query_routing_human_content(user_query: str, conversation_history: str = "") -> str:
    """Human message content for classifying query intent (semantic/structured/hybrid)."""
    history_section = f"\n\nConversation History:\n{conversation_history}" if conversation_history else ""
    return f"""Here is the context:  
{history_section}

**Current User Query:**  
"{user_query}"

**CLASSIFY** as: `semantic`, `structured`, or `hybrid`

- **semantic**: Descriptive or condition-based information (e.g., "foundation damage", "roof condition")
- **structured**: Explicit, filterable attributes (e.g., "4 bedrooms", "under $500,000")
- **hybrid**: Mixes both (e.g., "4-bed homes with foundation issues")

Return ONLY one word: the classification label.

**Answer:**"""


# ============================================================================
# LLM SQL QUERY PROMPTS
# ============================================================================

def get_llm_sql_query_human_content(user_query: str) -> str:
    """Human message content for generating SQL query parameters."""
    return f"""The user asked:  
"{user_query}"

**TASK**: Propose alternative search criteria when exact match fails.
1. Parse query for: bedrooms, bathrooms, property type, price, size
2. For numeric attributes, suggest ranges (e.g., ±1-2 bedrooms, ±10-20% price)
3. Return JSON object:
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
    """Human message content for per-document question answering."""
    from backend.llm.utils.query_characteristics import detect_query_characteristics
    query_characteristics = detect_query_characteristics(user_query)
    is_valuation_query = query_characteristics.get('query_type') == 'assessment'
    
    citation_context_section = ""
    if citation_context:
        page_info = f" (page {citation_context.get('page_number', 'unknown')})" if citation_context.get('page_number') else ""
        doc_name = citation_context.get('original_filename', 'the document')
        cited_text = citation_context.get('cited_text', '')
        citation_context_section = f"""
**CITATION CONTEXT**: User is asking about this specific location in {doc_name}{page_info}
Cited text: "{cited_text[:200]}{'...' if len(cited_text) > 200 else ''}"
Focus your search on information related to or near this cited text.
"""
    
    return f"""Here is the document excerpt:  
```\n{doc_content}\n```

{citation_context_section}

**USER QUESTION:**  
{user_query}

{"**VALUATION QUERY**: Extract ALL valuation scenarios (primary Market Value, reduced marketing periods, market rent) with their specific assumptions. Present naturally without explaining methodology." if is_valuation_query else ""}

**INSTRUCTIONS**:

{_get_search_instructions("excerpt")}

2. **Use Only Provided Context**: Answer ONLY using information in the excerpt. Do NOT use general knowledge or assumptions. Do NOT generate generic lists. If not found after thorough search, respond: "This information is not mentioned in the document excerpt."

{_get_verified_property_details_instructions(is_single_doc=True)}

4. **Comprehensive Response**: Extract and include ALL relevant information (names, dates, values, features, conditions, locations, assumptions). Be thorough, not brief.
   
   {get_rics_detailed_prompt_instructions() if detail_level == 'detailed' else ""}
   
   {_get_valuation_extraction_instructions(detail_level, is_valuation_query=(lambda: (lambda q: ('valuation' in q.lower() or 'value' in q.lower() or 'price' in q.lower()))(user_query) or False)())}

5. **Cite Sources**: When referencing information, use natural citations. Do NOT include document filenames. Optionally mention page numbers if relevant.

6. **Guard Against Hallucination**: Do NOT guess, invent, or use general knowledge. Only use what's in the excerpt.

7. **Professional Tone**: Use professional, comprehensive, factual writing style. Organize clearly.

{_get_no_unsolicited_content_instructions()}

---

**ANSWER:**"""  


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
    """Human message content for creating the final unified summary."""
    from backend.llm.utils.query_characteristics import detect_query_characteristics
    query_characteristics = detect_query_characteristics(user_query)
    is_valuation_query = query_characteristics.get('query_type') == 'assessment'
    
    return f"""**USER QUESTION:**  
"{user_query}"

**CONVERSATION HISTORY:**  
{conversation_history}

**RETRIEVAL SUMMARY (how documents were found):**  
{search_summary}

**DOCUMENT CONTENT EXTRACTS (formatted):**  
{formatted_outputs}

---

{"**VALUATION QUERY**: Extract ALL professional valuation scenarios (primary Market Value, reduced marketing periods, market rent) with their specific assumptions." if is_valuation_query else ""}

### INSTRUCTIONS:

{_get_search_instructions("all excerpts")}

2. **Answer Comprehensively**: Provide complete answer with ALL relevant information found. Search all excerpts carefully. Include all details that answer the question - be thorough, not brief.

{_get_verified_property_details_instructions(is_single_doc=False)}
   
   {get_rics_detailed_prompt_instructions() if detail_level == 'detailed' else ""}
   
   {_get_valuation_extraction_instructions(detail_level, is_valuation_query=(lambda: (lambda q: ('valuation' in q.lower() or 'value' in q.lower() or 'price' in q.lower()))(user_query) or False)())}

4. **Structure & Clarity**: Start directly with the final answer. Use H1 (#) for main title, H2 (##) for major sections. Make values immediately clear and scannable. Use blank lines between sections.

{_get_entity_normalization_instructions()}

5. **Cite Sources**: When referencing information, use natural citations. Do NOT include document filenames or identifiers.

6. **Admit Uncertainty**: If no document excerpts provide enough information after thorough search, respond: "No documents in the system match this criteria."

7. **Tone & Style**: Professional, factual, comprehensive. Include all relevant details. Organize clearly. Avoid flowery language or speculation.

{_get_no_unsolicited_content_instructions()}

---

**Now, provide your comprehensive answer:**"""


# ============================================================================
# CITATION MAPPING PROMPTS
# ============================================================================

def _format_bbox_for_prompt(bbox_data: dict) -> tuple:
    """Format bbox data for prompt display using same normalization as map_block_id_to_bbox()."""
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
    """Prompt for Phase 1: Mandatory citation extraction."""
    metadata_section = ""
    if metadata_lookup_tables:
        import logging
        logger = logging.getLogger(__name__)
        
        metadata_section = "\n--- Metadata Look-Up Table ---\n"
        metadata_section += "This table maps block IDs to their bbox coordinates. Use this when calling cite_source().\n\n"
        
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

**WHAT IS A FACTUAL CLAIM?**
Any specific information: values/amounts, dates, names, addresses, assessments, property features, descriptive facts, list items. If you mention ANY fact from documents, you MUST cite it.

**CRITICAL - EXTRACT CITATIONS FOR EVERY DISTINCT FACT:**
- If a block contains multiple facts, extract a SEPARATE citation for EACH fact
- If a block lists multiple items, extract a citation for EACH relevant item
- If a block mentions multiple values/names, extract a citation for EACH value/name
- **DO NOT** combine multiple facts into one citation

**⚠️ CRITICAL FOR VALUATION QUERIES:**
If user asks about "value" or "valuation", you MUST extract citations for:
- Primary Market Value
- ALL reduced marketing period values (90-day, 180-day, etc.) if mentioned
- Market Rent if mentioned
- Valuation assumptions
- **SEARCH THOROUGHLY**: Reduced marketing period valuations may appear on later pages (page 28-30+)

**WORKFLOW**:
1. Read through ALL document extracts carefully (including pages 28-30+ for valuation scenarios)
2. Identify EVERY factual claim relevant to the question
3. For EACH factual claim, call cite_source with:
   - **block_id**: The BLOCK_CITE_ID from the <BLOCK> tag (e.g., "BLOCK_CITE_ID_42")
   - **citation_number**: Sequential number starting from 1 (1, 2, 3, 4, 5...)
   - **cited_text**: The specific factual claim

**EXAMPLES**:
- Block: <BLOCK id="BLOCK_CITE_ID_42">Content: "Market Value: £Y,YYY,YYY as of DD Month YYYY"</BLOCK>
  → cite_source(cited_text="Market Value: £Y,YYY,YYY", block_id="BLOCK_CITE_ID_42", citation_number=1)
  → cite_source(cited_text="Valuation date: DD Month YYYY", block_id="BLOCK_CITE_ID_42", citation_number=2)

- Block: <BLOCK id="BLOCK_CITE_ID_15">Content: "Valuation conducted by Example Valuer[1] MRICS and Example Valuer[2] MRICS"</BLOCK>
  → cite_source(cited_text="Valuer: Example Valuer[1] MRICS", block_id="BLOCK_CITE_ID_15", citation_number=3)
  → cite_source(cited_text="Valuer: Example Valuer[2] MRICS", block_id="BLOCK_CITE_ID_15", citation_number=4)
  → **CRITICAL**: Extract citation for EACH valuer separately

- Block: <BLOCK id="BLOCK_CITE_ID_7">Content: "90-day value: £Y,YYY,YYY. 180-day value: £Z,ZZZ,ZZZ"</BLOCK>
  → cite_source(cited_text="90-day marketing period value: £Y,YYY,YYY", block_id="BLOCK_CITE_ID_7", citation_number=5)
  → cite_source(cited_text="180-day marketing period value: £Z,ZZZ,ZZZ", block_id="BLOCK_CITE_ID_7", citation_number=6)

**CRITICAL RULES**:
1. Call cite_source for EVERY factual claim (minimum 5-8 citations for most queries)
2. Use sequential citation numbers (1, 2, 3, 4, 5...) - start from 1 and increment
3. Find the BLOCK_CITE_ID in the <BLOCK> tags from the document extracts
4. Extract citations for ALL relevant information, not just one piece
5. **ONE FACT PER CITATION**: Each distinct fact/value/date/name/item gets its own citation number
6. **VERIFY BLOCK_ID MATCHES CITED_TEXT**: Read ENTIRE block content before calling cite_source. Verify it contains the EXACT fact you're citing.
7. **NO DUPLICATE CITATIONS**: Do NOT cite the same fact twice. If you see same information in different blocks, cite it ONCE only.
8. Do NOT write an answer yet - ONLY extract citations by calling the tool

**START NOW: Begin extracting citations by calling cite_source for each factual claim you find.**"""


# ============================================================================
# RICS PROFESSIONAL STANDARDS PROMPTS
# ============================================================================

def get_rics_detailed_prompt_instructions() -> str:
    """Returns RICS-level professional standards instructions for detailed mode."""
    return """**RICS PROFESSIONAL STANDARDS (Detailed Mode)**:

1. **Disclose All Assumptions**: State all assumptions (vacant possession, normal marketing period, etc.), special assumptions, limitations, caveats.
2. **Multiple Valuation Perspectives**: Include ALL professional valuation figures. For each, extract and present specific assumptions (vacant possession, marketing period, discounts, rationale).
3. **Professional Qualifications**: Include valuer name, qualifications (MRICS/FRICS), firm name, who conducted the valuation.
4. **Date & Context**: State valuation date, report date, inspection date. Include temporal context.
5. **Risk Factors & Caveats**: Mention material risks, limitations, special assumptions, warnings, disclaimers.
6. **Comparable Evidence**: Reference comparables used in valuation (if applicable), number of comparables, adjustments made.
7. **Professional Format**: Use RICS Red Book terminology and structure.

**FORMATTING**: Start with primary Market Value, then other scenarios. State assumptions clearly. Present naturally in flowing narrative style."""


# ============================================================================
# RERANKING PROMPTS
# ============================================================================

def get_reranking_human_content(user_query: str, doc_summary: str) -> str:
    """Human message content for reranking documents by relevance."""
    return f"""**USER QUERY:**  
"{user_query}"

**DOCUMENT CANDIDATES:**  
{doc_summary}

**CONSIDER**: Direct relevance, document type importance, quality/depth of content, number of relevant chunks, semantic alignment.

**TASK**: Rank in descending order (most relevant first). Return JSON array of document IDs:
```json
["doc_id_4", "doc_id_1", "doc_id_3", "doc_id_2"]
```"""


# ============================================================================
# SQL RETRIEVER PROMPTS
# ============================================================================

def get_sql_retriever_human_content(user_query: str) -> str:
    """Human message content for extracting SQL query parameters."""
    return f"""**USER QUERY:**  
"{user_query}"

**TASK**: Identify property attributes and determine structured representation.
- For numeric attributes, suggest ranges (±1-2 or ±10-25% for prices)
- Return JSON object with: bedrooms, bathroom, bedroom_range, bathroom_range, property_type, min_price, max_price, min_size, max_size, location, date_from, date_to"""


# ============================================================================
# FINAL ANSWER PROMPT (SIMPLIFIED)
# ============================================================================

def get_final_answer_prompt(
    user_query: str,
    conversation_history: str,
    formatted_outputs: str,
    citations: list = None,
    is_citation_query: bool = False,
    is_agent_mode: bool = False
) -> str:
    """Simplified prompt for answer generation with citations."""
    citation_list = ""
    if citations and len(citations) > 0:
        citation_list = "\n--- Phase 1 Citations (USE THESE EXACT NUMBERS) ---\n"
        for citation in sorted(citations, key=lambda x: x.get('citation_number', 0)):
            cit_num = citation.get('citation_number', 0)
            cit_text = citation.get('cited_text', '')
            block_id = citation.get('block_id', '')
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
            if 'address' in cit_text.lower() or any(addr_term in cit_text.lower() for addr_term in ['street', 'road', 'avenue', 'property address', 'location', 'postcode']):
                key_indicators += " [PROPERTY ADDRESS]"
            if 'date' in cit_text.lower() or any(month in cit_text.lower() for month in ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']):
                key_indicators += " [DATE]"
            citation_list += f"**Citation [{cit_num}]**: {cit_text}{key_indicators} [Block: {block_id}]\n"
        citation_list += "\n**REMEMBER**: Use the EXACT citation number from above that matches your fact.\n\n"
    
    user_query_lower = user_query.lower()
    is_valuation_query = any(term in user_query_lower for term in ['valuation', 'value', 'price', 'worth', 'cost'])
    is_value_only_query = any(phrase in user_query_lower for phrase in [
        'value of', 'what is the value', 'what was the value', 'property valued', 
        'valued at', 'valuation amount', 'valuation figure', 'how much is', 'how much was',
        'tell me the value', 'tell me the valuation'
    ])
    
    valuation_instructions = ""
    if is_valuation_query:
        valuation_instructions = _get_valuation_extraction_instructions(detail_level='detailed', is_valuation_query=True)
        valuation_instructions = f"\n{valuation_instructions}\n"
    
    value_only_instructions = ""
    if is_value_only_query:
        value_only_instructions = """
**VALUE-ONLY QUERY**: User is asking specifically for VALUE/VALUATION. Include ALL valuation figures:
1. Primary Market Value
2. 90-Day Value (if mentioned)
3. 180-Day Value (if mentioned)
4. Market Rent (if provided)
5. Valuation Date and Valuer Information
6. Assumptions for EACH scenario

**CRITICAL**: If you see "90-day" or "180-day" mentioned, you MUST include those values. Focus ONLY on valuation figures - do NOT include property features."""
    
    if is_citation_query:
        sourcing_rules = """**CITATION QUERY**: ONLY use information from DOCUMENT EXTRACTS above. Focus on information related to the citation context. Do NOT use general knowledge or generic examples."""
        answer_instructions = "Use ONLY information from DOCUMENT EXTRACTS. Focus on citation context. Do NOT use general knowledge."
        extraction_instructions = "Extract ALL relevant information FROM DOCUMENTS that links to citation. Include citation markers ([1], [2], etc.) immediately after each fact."
    else:
        sourcing_rules = """**INFORMATION SOURCING**: Prefer document content when available. General knowledge is acceptable if documents don't contain the information. Only add citation markers [1], [2], [3]... for facts from document extracts."""
        answer_instructions = "Prefer document content when available. General knowledge allowed if documents don't contain info. Only add [1], [2], [3]... for facts from documents. Start directly with answer. Present each fact ONCE only."
        extraction_instructions = "Extract ALL relevant information from documents when available. Include citation markers ([1], [2], [3]) immediately after each fact FROM DOCUMENTS. Supplement with general knowledge when helpful."
    
    agent_mode_instructions = ""
    if is_agent_mode:
        agent_mode_instructions = """
**AGENT MODE - AVAILABLE TOOLS**:

1. **NAVIGATION TOOL**: navigate_to_property_by_name(property_name: str, reason: str)
   - Use for: "take me to [property]", "go to [property]", "show me [property] on map"
   - This handles: search + map open + pin selection
   - Example: navigate_to_property_by_name(property_name="example property", reason="Navigating as requested")

2. **DOCUMENT DISPLAY TOOL**: open_document(citation_number: int, reason: str)
   - **MANDATORY**: If you have citations in your response, you MUST call open_document
   - **CRITICAL**: Match citation_number to where PRIMARY information appears in your ACTUAL response
   - Identify PRIMARY request (ignore contextual words). Find citation number in your ACTUAL response where PRIMARY info appears. Use that number.
   - Example: User asks "phone number" → Your response: "Company: Example Company[1]. Phone: +XX...[3]" → Use citation_number=3 (NOT [1])
   
**TOOL RULES**: Call tools directly using tool interface - do NOT write prose about calling tools.
**CRITICAL**: You MUST generate a complete text answer even when using tools. Tools are for UI actions only - they do NOT replace your text response.
**IMPORTANT**: Always provide the full answer in your response text. Use tools for UI actions, but write the complete answer in text format.

**Document retrieval is automatic** - you don't need to call retrieval tools. Focus on synthesizing provided extracts and generating comprehensive answer.
"""
    
    return f"""**USER QUESTION:**  
"{user_query}"

**CONVERSATION HISTORY:**  
{conversation_history}

**DOCUMENT CONTENT EXTRACTS:**  
{formatted_outputs}

{citation_list}
{valuation_instructions}
{value_only_instructions}

**CRITICAL - CITATION MARKERS**:
- Use bracket format [1], [2], [3]... immediately after each fact
- Write as ONE unit: "£X,XXX,XXX[1]" NOT "£X,XXX,XXX [1]"
- Match facts to Phase 1 citations - use EXACT citation number from Phase 1 that matches your fact
- For multiple valuers: cite each separately - "Example Valuer[6] MRICS and Example Valuer[7] MRICS"

{sourcing_rules}
{agent_mode_instructions}

**⚠️ FOR VALUATION QUERIES**: Include ALL valuation scenarios found (primary Market Value, 90-day, 180-day, Market Rent) with their assumptions. Do NOT skip any scenarios.

**CANONICAL TEMPLATE STRUCTURE**:
1. **Primary Answer (H1)**: Use # for main title. Short, direct answer (2-3 sentences max).
2. **Present Information Directly**: No separate "Key Concepts" section. Present key facts directly in response with citations.
3. **Optional Sections (H2)**: Process/Steps (only if procedural), Practical Application (only if application guidance needed), Risks/Edge Cases (only if relevant), Next Actions (only if appropriate).

**HEADING HIERARCHY**: # H1 → ## H2 → ### H3 (never skip levels). Use bullet points for lists.

**CONTENT GENERATION**:

1. **Answer Directly and Comprehensively**:
{answer_instructions}

2. **Valuation Query Handling**:
   {VALUATION_PRIORITIZATION_RULES}
   
3. **Value-Only Query Handling** (if applicable): ONLY provide valuation information - do NOT include property features.

4. **General Information Extraction**:
{extraction_instructions}

5. **Search Strategy**: Look carefully in DOCUMENT CONTENT EXTRACTS. Search all pages, especially 20-30+ where important sections often appear.

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
    """Prompt for general knowledge queries."""
    return f"""**USER QUESTION:**  
"{user_query}"

**CONVERSATION HISTORY:**  
{conversation_history}

**CURRENT DATE/TIME**:
- Current Date: {current_date}
- Current Time: {current_time}

**INSTRUCTIONS**:
Answer using general knowledge. If question is about current date/time, use information provided above.
Be concise, accurate, helpful. If your knowledge has a cutoff date, mention it when relevant.

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
    """Prompt for text transformation."""
    return f"""**USER REQUEST:**  
"{user_query}"

**TRANSFORMATION INSTRUCTION:**  
{transformation_instruction}

**TEXT TO TRANSFORM:**  
{text_to_transform}

**INSTRUCTIONS**:
Transform the text according to user's instruction. Preserve all key information, facts, and citations (if present).
Follow transformation instruction precisely while maintaining original intent and meaning.

**Transformed Text:**"""


# ============================================================================
# RESPONSE FORMATTING PROMPTS
# ============================================================================

def get_response_formatting_prompt(raw_response: str, user_query: str) -> str:
    """Get prompt for formatting and structuring LLM responses."""
    return f"""**TASK**: Format and structure the following response to make it neater and easier to read.

**ORIGINAL USER QUERY**:  
{user_query}

**RAW RESPONSE TO FORMAT**:  
{raw_response}

---

**YOUR ROLE**: Content is already complete. ONLY format and structure it. Do NOT add, remove, or modify information.

**CRITICAL CITATION PRESERVATION**:
- Each citation marker ([1], [2], etc.) is attached to a SPECIFIC fact
- Citations MUST move WITH their facts when reorganizing - never separate them
- Maintain exact sequential order [1], [2], [3]...
- Place citations IMMEDIATELY after facts - "£X,XXX,XXX[1]" not "£X,XXX,XXX [1]"
- Do NOT add periods before citations

**CANONICAL TEMPLATE ENFORCEMENT**:
1. Verify H1 (#) exists for primary answer. Ensure H2 (##) sections follow proper order.
2. Verify information ordering: H1 primary answer first, key facts directly with citations, optional sections last.
3. Enforce cognitive load: Split paragraphs >50 words, limit lists to 3-5 items, limit paragraphs to 3 sentences.
4. Apply structure: # H1 → ## H2 → ### H3 hierarchy. Present information naturally - no separate "Key Concepts" sections.

**FORMATTING STANDARDS**:
- Use markdown: # for H1, ## for H2, ### for H3
- **BOLD**: Section headers (## Header), labels (**Market Value:**)
- **REGULAR TEXT**: Actual values (£X,XXX,XXX[1]), dates, names
- Use vertical label-value format:
  ```
  **Label:**
  Value[1]
  *Secondary note in italics*
  ```
- Use bullet points for lists (NOT comma-separated)
- Do NOT add periods at end of standalone lines (headings, values, list items)

{_get_entity_normalization_instructions()}

**MUST**: Do NOT remove or omit any information. Only format and structure it better.

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
    """Combined prompt for citation extraction AND answer generation in ONE LLM call."""
    metadata_section = ""
    if metadata_lookup_tables:
        import logging
        logger = logging.getLogger(__name__)
        
        metadata_section = "\n--- Block ID Reference Table ---\n"
        metadata_section += "Use these block IDs when calling cite_source().\n\n"
        
        MAX_BLOCKS_PER_DOC = 300
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

**STEP 1**: For EACH fact you include, call cite_source tool with:
- block_id: The BLOCK_CITE_ID from the document (e.g., "BLOCK_CITE_ID_42")
- citation_number: Sequential number (1, 2, 3...) - MUST BE UNIQUE AND INCREMENT
- cited_text: The fact you're citing

**STEP 2**: Write your answer with citation markers [1], [2], [3]... immediately after each fact.

**CRITICAL RULES**:
- Call cite_source for EVERY factual claim
- Use STRICTLY sequential citation numbers (1, 2, 3...) - NEVER repeat
- Place citations IMMEDIATELY after the fact, NO space
- For valuation queries: include ALL scenarios (90-day, 180-day, Market Rent)
- Do NOT add periods at end of standalone lines

**EXAMPLE**:
- Block: "Market Value: £X,XXX,XXX"
- Call: cite_source(block_id="BLOCK_CITE_ID_42", citation_number=1, cited_text="Market Value: £X,XXX,XXX")
- Write: "The Market Value is £X,XXX,XXX[1] as of DD Month YYYY[2]"

**IMPORTANT**: You MUST return BOTH tool calls AND answer text.

{_get_entity_normalization_instructions()}

**YOUR ANSWER (write the complete answer WITH citation markers below):**"""


# ============================================================================
# ATTACHMENT CONTEXT PROMPTS
# ============================================================================

ATTACHMENT_CONTEXT_FAST_PROMPT = """
**USER-ATTACHED DOCUMENT CONTEXT:**
The user has attached the following document(s) to their query. Answer based on this content.

{attachment_context}

**INSTRUCTIONS:**
- Answer based ONLY on attached document content
- Be concise and direct
- Do NOT include citation markers ([1], [2], etc.) - fast response mode
- Do NOT reference page numbers or document structure
- If answer is not in documents, say so clearly

**USER QUERY:** {query}
"""

ATTACHMENT_CONTEXT_DETAILED_PROMPT = """
**USER-ATTACHED DOCUMENT CONTEXT:**
The user has attached the following document(s) for detailed analysis.

{attachment_context}

**INSTRUCTIONS:**
- Answer based on attached document content
- Include page references like "(Page 3)" or "(Pages 5-7)"
- Be thorough but organized
- Use headers and bullet points
- If answer is not in documents, say so clearly

**USER QUERY:** {query}
"""

ATTACHMENT_CONTEXT_FULL_PROMPT = """
**USER-ATTACHED DOCUMENT CONTEXT:**
The user has attached document(s) being processed for full integration.
For now, answer based on extracted text below. Citations will become clickable once processing completes.

{attachment_context}

**INSTRUCTIONS:**
- Answer based on attached document content
- Include page references like "(Page X)" that will later become clickable citations
- Be thorough and professional
- Structure answer with clear sections
- If answer is not in documents, say so clearly

**NOTE:** Documents are being processed. Page references will become clickable citations once processing completes.

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
        
        if page_texts and i < len(page_texts) and page_texts[i]:
            for page_num, page_text in enumerate(page_texts[i], 1):
                if page_text.strip():
                    formatted_parts.append(f"\n--- Page {page_num} ---")
                    formatted_parts.append(page_text.strip())
        else:
            formatted_parts.append(text)
        
        formatted_parts.append("")
    
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
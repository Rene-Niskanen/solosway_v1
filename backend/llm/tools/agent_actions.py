"""
Agent Action Tools - LLM-callable tools for autonomous agent actions.

These tools allow the LLM to autonomously decide when to perform UI actions
like opening documents, highlighting citations, and navigating to properties.

In Agent mode, the LLM has access to these tools and can decide based on
query context whether to show documents proactively.
"""

import logging
from typing import List, Dict, Any, Tuple, Optional
from pydantic import BaseModel, Field
from langchain_core.tools import StructuredTool

logger = logging.getLogger(__name__)


class OpenDocumentInput(BaseModel):
    """Schema for open_document tool"""
    citation_number: int = Field(
        description=(
            "REQUIRED. Match the citation number to where the PRIMARY information ACTUALLY appears in your response. "
            "Step 1: Parse the query to find the PRIMARY object/information requested. "
            "  - IGNORE contextual words like 'company', 'property', 'that valued', 'of the' - these are just context. "
            "  - Focus on the MAIN thing: 'phone number', 'address', 'email', 'value', etc. "
            "  - Example: 'phone number of the company' → PRIMARY is 'phone number' (NOT 'company'). "
            "Step 2: Check your ACTUAL response text to find which citation number [N] is attached to the PRIMARY information. "
            "  - Look at what you ACTUALLY wrote, not what you intended to write. "
            "  - Example: User asks 'phone number' → Your ACTUAL response: 'Company: MJ Group[1]. Phone: +44...[3]' → Use citation_number=3 (NOT [1]) "
            "  - Example: User asks 'address' → Your ACTUAL response: 'Company: MJ Group[1]. Address: 15 Alfred[2]' → Use citation_number=2 (NOT [1]) "
            "Step 3: Use the citation number that matches the PRIMARY information in your ACTUAL response. "
            "CRITICAL: Match to your ACTUAL response text - if PRIMARY info is at [3], use citation_number=3 (even if you intended to put it at [1]). "
            "This ensures the correct citation opens automatically."
        )
    )
    reason: str = Field(
        description=(
            "REQUIRED. State what the user asked for AND which citation you matched it to. "
            "Format: 'Shows [TOPIC USER ASKED FOR] - citation [N] contains this information' "
            "Good: 'Shows the phone number the user asked for - citation [2] contains +44 203...' "
            "Bad: 'Opening document' (too vague)"
        )
    )


class NavigateToPropertyInput(BaseModel):
    """Schema for navigate_to_property tool"""
    property_id: str = Field(
        description=(
            "REQUIRED. The UUID of the property to navigate to. "
            "This should be extracted from the current context or property data. "
            "Format: UUID string like '993a4c9c-e759-4a44-9f6a-8e7f78c8b370'"
        )
    )
    reason: str = Field(
        description=("REQUIRED. A concise explanation (10-20 words) of why navigating helps the user. "
            
            "Focus on what the user will see on the map. "
            "Good: 'Centers map on the property location the user asked about' "
            "Bad: 'Navigating' (too vague)"
        )
    )


class SearchPropertyInput(BaseModel):
    """Schema for search_property tool"""
    query: str = Field(
        description=(
            "REQUIRED. The search term to find a property. "
            "Can be a property name, address, or partial match. "
            "Examples: 'highlands', 'berden road', '123 main street'"
        )
    )


class ShowMapViewInput(BaseModel):
    """Schema for show_map_view tool"""
    reason: str = Field(
        description=(
            "REQUIRED. A concise explanation (10-20 words) of why opening the map helps the user. "
            "Focus on what the user will see. "
            "Good: 'Opens map to show property locations as requested' "
            "Bad: 'Opening map' (too vague)"
        )
    )


class SelectPropertyPinInput(BaseModel):
    """Schema for select_property_pin tool"""
    property_id: str = Field(
        description=(
            "REQUIRED. The UUID of the property pin to select. "
            "Format: UUID string like '993a4c9c-e759-4a44-9f6a-8e7f78c8b370'"
        )
    )
    reason: str = Field(
        description=(
            "REQUIRED. A concise explanation (10-20 words) of why selecting this pin helps the user. "
            "Focus on what the user will see. "
            "Good: 'Selects Highlands property pin to show property card' "
            "Bad: 'Clicking pin' (too vague)"
        )
    )


class NavigateToPropertyByNameInput(BaseModel):
    """Schema for navigate_to_property_by_name tool - a combined navigation tool"""
    property_name: str = Field(
        description=(
            "REQUIRED. The property name or address to navigate to. "
            "Use the name/address as the user mentioned it. "
            "Examples: 'highlands', 'berden road', 'the cottage', '123 main street'"
        )
    )
    reason: str = Field(
        description=(
            "REQUIRED. A concise explanation (10-20 words) of why navigating helps the user. "
            "Good: 'Navigating to Highlands property as requested' "
            "Bad: 'Going there' (too vague)"
        )
    )


# =========================================================================
# DESKTOP AUTOMATION TOOLS (OpenCode Integration)
# =========================================================================
# These tools enable file management, document creation, and browser automation
# via the OpenCode CLI service.
# =========================================================================

class FileManagementInput(BaseModel):
    """Schema for file_management tool - organize, sort, rename, or move files"""
    action: str = Field(
        description=(
            "REQUIRED. The file operation to perform. "
            "Options: 'organize' (group by type/date), 'sort' (rename with pattern), "
            "'rename' (batch rename), 'move' (relocate files). "
            "Examples: 'organize', 'sort', 'rename', 'move'"
        )
    )
    path: str = Field(
        description=(
            "REQUIRED. The folder path to operate on. "
            "Must be an absolute path or relative to user's home. "
            "Examples: '/Users/name/Downloads', '~/Documents/Projects'"
        )
    )
    pattern: Optional[str] = Field(
        default=None,
        description=(
            "Optional. Pattern for organizing/renaming files. "
            "For organize: 'by_type', 'by_date', 'by_project'. "
            "For rename: pattern like '{date}_{name}' or '{index:03d}_{name}'. "
            "Examples: 'by_type', 'by_date', '{date}_{name}'"
        )
    )
    destination: Optional[str] = Field(
        default=None,
        description=(
            "Optional. Destination folder for move operations. "
            "Required when action='move'. "
            "Examples: '/Users/name/Documents/Archived', '~/Backup'"
        )
    )
    filter_pattern: Optional[str] = Field(
        default=None,
        description=(
            "Optional. Glob pattern to filter which files to process. "
            "Examples: '*.pdf', '*.jpg', 'report_*'"
        )
    )
    reason: str = Field(
        description=(
            "REQUIRED. A concise explanation (10-20 words) of what this operation achieves. "
            "Good: 'Organizing Downloads folder by file type for easier access' "
            "Bad: 'Organizing files' (too vague)"
        )
    )


class DocumentCreationInput(BaseModel):
    """Schema for document_creation tool - create, summarize, or rewrite documents"""
    action: str = Field(
        description=(
            "REQUIRED. The document operation to perform. "
            "Options: 'create' (new document), 'summarize' (summarize existing), "
            "'rewrite' (improve/transform document). "
            "Examples: 'create', 'summarize', 'rewrite'"
        )
    )
    content: Optional[str] = Field(
        default=None,
        description=(
            "Optional. Content or instructions for the document. "
            "For 'create': the content to write or instructions for generation. "
            "For 'rewrite': instructions on how to transform (e.g., 'make more formal'). "
            "Examples: 'Write a project proposal for...', 'Make this more concise'"
        )
    )
    source_path: Optional[str] = Field(
        default=None,
        description=(
            "Optional. Source document path for summarize/rewrite operations. "
            "Required when action='summarize' or 'rewrite'. "
            "Examples: '/Users/name/Documents/report.docx', '~/notes.md'"
        )
    )
    output_path: str = Field(
        description=(
            "REQUIRED. Where to save the output document. "
            "Include filename with extension. "
            "Examples: '/Users/name/Documents/summary.md', '~/Projects/proposal.docx'"
        )
    )
    template: Optional[str] = Field(
        default=None,
        description=(
            "Optional. Template or format for the document. "
            "Examples: 'report', 'memo', 'markdown', 'formal_letter'"
        )
    )
    reason: str = Field(
        description=(
            "REQUIRED. A concise explanation (10-20 words) of what this document achieves. "
            "Good: 'Creating project proposal document as requested by user' "
            "Bad: 'Creating document' (too vague)"
        )
    )


class BrowserAutomationInput(BaseModel):
    """Schema for browser_automation tool - research, fill forms, take screenshots"""
    action: str = Field(
        description=(
            "REQUIRED. The browser operation to perform. "
            "Options: 'research' (gather information), 'form_fill' (fill web forms), "
            "'screenshot' (capture webpage). "
            "Examples: 'research', 'form_fill', 'screenshot'"
        )
    )
    url: Optional[str] = Field(
        default=None,
        description=(
            "Optional. URL to navigate to. Required for form_fill and screenshot. "
            "For research, can be omitted to search the web. "
            "Examples: 'https://example.com/form', 'https://google.com'"
        )
    )
    instructions: str = Field(
        description=(
            "REQUIRED. Detailed instructions for the browser task. "
            "For research: what to find. For form_fill: what data to enter. "
            "For screenshot: what to capture. "
            "Examples: 'Find the latest property prices in London', "
            "'Fill the contact form with company details'"
        )
    )
    output_path: Optional[str] = Field(
        default=None,
        description=(
            "Optional. Where to save output (for research results or screenshots). "
            "Examples: '/Users/name/research_results.md', '~/screenshot.png'"
        )
    )
    reason: str = Field(
        description=(
            "REQUIRED. A concise explanation (10-20 words) of what this achieves. "
            "Good: 'Researching market data to support property valuation' "
            "Bad: 'Browsing' (too vague)"
        )
    )


class AgentActionTool:
    """
    Manages agent actions for document opening and navigation.
    
    The LLM calls these tools during response generation, and the actions
    are collected and emitted as agent_action events to the frontend.
    """
    
    def __init__(self):
        self.actions: List[Dict[str, Any]] = []
    
    def open_document(self, citation_number: int, reason: str) -> str:
        """
        Record an open_document action.
        
        Args:
            citation_number: The citation number (e.g., 1 for [1]) to open
            reason: Brief explanation of why showing this helps the user
        
        Returns:
            Confirmation message
        """
        logger.info(f"🎯 [AGENT_TOOL] open_document called: citation={citation_number}, reason={reason}")
        self.actions.append({
            'action': 'open_document',
            'citation_number': citation_number,
            'reason': reason
        })
        return f"Queued: Open citation [{citation_number}] - {reason}"
    
    def navigate_to_property(self, property_id: str, reason: str) -> str:
        """
        Record a navigate_to_property action.
        
        Args:
            property_id: The property ID to navigate to
            reason: Brief explanation of why navigating helps the user
        
        Returns:
            Confirmation message
        """
        logger.info(f"🎯 [AGENT_TOOL] navigate_to_property called: property_id={property_id}, reason={reason}")
        self.actions.append({
            'action': 'navigate_to_property',
            'property_id': property_id,
            'reason': reason
        })
        return f"Queued: Navigate to property {property_id} - {reason}"
    
    def search_property(self, query: str) -> str:
        """
        Record a search_property action.
        
        Args:
            query: Search term to find a property by name/address
        
        Returns:
            Confirmation message with found property info (if any)
        """
        logger.info(f"🎯 [AGENT_TOOL] search_property called: query={query}")
        self.actions.append({
            'action': 'search_property',
            'query': query
        })
        return f"Queued: Search for property matching '{query}'"
    
    def show_map_view(self, reason: str) -> str:
        """
        Record a show_map_view action.
        
        Args:
            reason: Brief explanation of why opening the map helps the user
        
        Returns:
            Confirmation message
        """
        logger.info(f"🎯 [AGENT_TOOL] show_map_view called: reason={reason}")
        self.actions.append({
            'action': 'show_map_view',
            'reason': reason
        })
        return f"Queued: Open map view - {reason}"
    
    def select_property_pin(self, property_id: str, reason: str) -> str:
        """
        Record a select_property_pin action.
        
        Args:
            property_id: The property ID whose pin to select
            reason: Brief explanation of why selecting this pin helps the user
        
        Returns:
            Confirmation message
        """
        logger.info(f"🎯 [AGENT_TOOL] select_property_pin called: property_id={property_id}, reason={reason}")
        self.actions.append({
            'action': 'select_property_pin',
            'property_id': property_id,
            'reason': reason
        })
        return f"Queued: Select property pin {property_id} - {reason}"
    
    def navigate_to_property_by_name(self, property_name: str, reason: str) -> str:
        """
        Record a navigate_to_property_by_name action.
        This is a combined navigation tool that searches for a property by name
        and navigates to it on the map.
        
        Args:
            property_name: The property name or address to search for
            reason: Brief explanation of why navigating helps the user
        
        Returns:
            Confirmation message
        """
        logger.info(f"🎯 [AGENT_TOOL] navigate_to_property_by_name called: property_name={property_name}, reason={reason}")
        self.actions.append({
            'action': 'navigate_to_property_by_name',
            'property_name': property_name,
            'reason': reason
        })
        return f"Queued: Navigate to property '{property_name}' - {reason}"
    
    # =========================================================================
    # DESKTOP AUTOMATION METHODS (OpenCode Integration)
    # =========================================================================
    
    def file_management(
        self, 
        action: str, 
        path: str, 
        reason: str,
        pattern: Optional[str] = None,
        destination: Optional[str] = None,
        filter_pattern: Optional[str] = None
    ) -> str:
        """
        Record a file_management action for organizing/sorting/moving files.
        
        Args:
            action: Operation type ('organize', 'sort', 'rename', 'move')
            path: Folder path to operate on
            reason: Explanation of what this achieves
            pattern: Optional pattern for organizing/renaming
            destination: Optional destination for move operations
            filter_pattern: Optional glob pattern to filter files
        
        Returns:
            Confirmation message
        """
        logger.info(f"🎯 [AGENT_TOOL] file_management called: action={action}, path={path}")
        self.actions.append({
            'action': 'file_management',
            'file_action': action,
            'path': path,
            'pattern': pattern,
            'destination': destination,
            'filter_pattern': filter_pattern,
            'reason': reason
        })
        return f"Queued: File {action} on '{path}' - {reason}"
    
    def document_creation(
        self,
        action: str,
        output_path: str,
        reason: str,
        content: Optional[str] = None,
        source_path: Optional[str] = None,
        template: Optional[str] = None
    ) -> str:
        """
        Record a document_creation action for creating/summarizing/rewriting documents.
        
        Args:
            action: Operation type ('create', 'summarize', 'rewrite')
            output_path: Where to save the document
            reason: Explanation of what this achieves
            content: Content or instructions for the document
            source_path: Source document for summarize/rewrite
            template: Optional template format
        
        Returns:
            Confirmation message
        """
        logger.info(f"🎯 [AGENT_TOOL] document_creation called: action={action}, output={output_path}")
        self.actions.append({
            'action': 'document_creation',
            'doc_action': action,
            'content': content,
            'source_path': source_path,
            'output_path': output_path,
            'template': template,
            'reason': reason
        })
        return f"Queued: Document {action} -> '{output_path}' - {reason}"
    
    def browser_automation(
        self,
        action: str,
        instructions: str,
        reason: str,
        url: Optional[str] = None,
        output_path: Optional[str] = None
    ) -> str:
        """
        Record a browser_automation action for research/form-fill/screenshot.
        
        Args:
            action: Operation type ('research', 'form_fill', 'screenshot')
            instructions: Detailed instructions for the task
            reason: Explanation of what this achieves
            url: Optional URL to navigate to
            output_path: Optional path to save output
        
        Returns:
            Confirmation message
        """
        logger.info(f"🎯 [AGENT_TOOL] browser_automation called: action={action}, url={url}")
        self.actions.append({
            'action': 'browser_automation',
            'browser_action': action,
            'url': url,
            'instructions': instructions,
            'output_path': output_path,
            'reason': reason
        })
        return f"Queued: Browser {action} - {reason}"
    
    def get_actions(self) -> List[Dict[str, Any]]:
        """Get all recorded actions"""
        return self.actions
    
    def clear_actions(self) -> None:
        """Clear all recorded actions"""
        self.actions = []


def create_agent_action_tools() -> Tuple[List[StructuredTool], AgentActionTool]:
    """
    Create agent action tools for LLM binding.
    
    These tools are only bound to the LLM in Agent mode, allowing the LLM
    to autonomously decide when to show documents and navigate.
    
    Returns:
        Tuple of (list of tools, AgentActionTool instance):
        - tools: List of LangChain StructuredTools for LLM to call
        - tool_instance: AgentActionTool instance to retrieve actions from
    """
    tool_instance = AgentActionTool()
    
    # =========================================================================
    # OPEN_DOCUMENT TOOL
    # =========================================================================
    # This tool opens a document preview panel showing the cited source.
    # The user will see the actual document with the citation highlighted.
    # =========================================================================
    
    open_document_description = """
## PURPOSE
Opens a document preview panel to display the source of a citation. The user will see the actual PDF/document with the relevant section highlighted and scrolled into view.

## DECISION FRAMEWORK: Should I call open_document?

**SIMPLE RULE: If you have citations in your response, automatically call open_document.**

Follow this decision tree:

1. DID I CREATE ANY CITATIONS in my response?
   - NO → DO NOT call open_document (nothing to show)
   - YES → CALL open_document with the most relevant citation (the one matching the user's PRIMARY request)

**THAT'S IT.** If you have citations, open them. This applies to ALL queries in agent mode that result in citations:
- Information queries: "What is the phone number?", "Where are the cables?", "What is the value?"
- General queries: "Tell me about the property", "What does it say about planning?"
- Any query that results in citations → automatically open the document

**ONLY EXCEPTION**: Purely conversational queries like "hello", "thanks", "okay" typically don't have citations, so they won't trigger open_document (which is correct).

## MANDATORY RULE: CALL ONLY ONCE PER RESPONSE
- You MUST call open_document AT MOST ONCE per response
- Choose the SINGLE MOST RELEVANT citation based on what the user asked for

## ⚠️ CRITICAL: MATCH CITATION NUMBER TO YOUR ACTUAL RESPONSE
Parse the query to find the PRIMARY object/information requested. IGNORE contextual words.

**CHECK YOUR ACTUAL RESPONSE** to find which citation number [N] has the PRIMARY information:
- User asks for "phone number of the company" → PRIMARY is "phone number"
  → Your ACTUAL response: "Company: MJ Group[1]. Phone: +44...[3]" → Use citation_number=3 (NOT [1])
- User asks for "address of the property" → PRIMARY is "address"
  → Your ACTUAL response: "Company: MJ Group[1]. Address: 15 Alfred[2]" → Use citation_number=2 (NOT [1])
- User asks for "email for the company" → PRIMARY is "email"
  → Your ACTUAL response: "Company: MJ Group[1]. Email: info@...[2]" → Use citation_number=2 (NOT [1])
- User asks for "value" or "valuation" or "price" → PRIMARY is "value"
  → Your ACTUAL response: "Property: Highlands[1]. Market Value: £2,300,000[2]" → Use citation_number=2 (NOT [1])
- User asks ONLY "company" or "who valued" (no other primary request) → PRIMARY is "company" → Start with "Company: MJ Group[1]..."
- User asks for "date" → PRIMARY is "date"
  → Your ACTUAL response: "Property: Highlands[1]. Date: 12th February 2024[2]" → Use citation_number=2 (NOT [1])

⚠️ KEY RULE: Match the citation number to where the PRIMARY information ACTUALLY appears in your response.
  Example: "phone number of the company" → PRIMARY = "phone number" → ACTUAL Response: "Company: MJ Group[1]. Phone: +44...[3]" → Use citation_number=3 (NOT [1])
  Example: "address of the property" → PRIMARY = "address" → ACTUAL Response: "Company: MJ Group[1]. Address: 15 Alfred[2]" → Use citation_number=2 (NOT [1])

**MATCH TO YOUR ACTUAL RESPONSE** - if PRIMARY info is at [3], use citation_number=3 (even if you intended to put it at [1]).

## PARAMETER REQUIREMENTS

### citation_number (integer, REQUIRED)
- Match the citation number to where the PRIMARY information ACTUALLY appears in your response
- Check your ACTUAL response text to find which citation [N] has the PRIMARY information
- Example: User asks "what is the address" → Your ACTUAL response: "Company: MJ Group[1]. Address: 123 Main St[2]..." → use citation_number=2 (NOT [1])
- Example: User asks "what is the phone number" → Your ACTUAL response: "Company: MJ Group[1]. Phone Number: 020 1234 5678[3]..." → use citation_number=3 (NOT [1])
- INVALID: citation_number=0, citation_number="1", citation_number=99 (if [99] not in response)

### reason (string, REQUIRED)
- 10-20 word explanation of what the user will see
- MUST describe the visual evidence being shown
- Good examples:
  * "Displays the valuation certificate showing £2,300,000 market value"
  * "Shows page 3 with the surveyor's signature and credentials"
  * "Opens the title deed section confirming freehold ownership"
- Bad examples:
  * "Opening document" (too vague)
  * "See citation" (not descriptive)
  * "Shows the thing" (meaningless)

## CONCRETE EXAMPLES

### Example 1: General Information Retrieval (AUTOMATIC - No keywords needed)
User: "What is the property valued at?"
Your response: "The property has a Market Value of £2,300,000[1] as of 12th February 2024[2]..."
→ CALL: open_document(citation_number=1, reason="Displays the official valuation figure from the RICS report")
  ✓ Information retrieval query with citations → automatically open

### Example 2: General Information Retrieval (AUTOMATIC - No keywords needed)
User: "What is the 90-day value?"
Your response: "The 90-day marketing period value is £1,950,000[3]..."
→ CALL: open_document(citation_number=3, reason="Shows the reduced value section with 90-day assumptions")
  ✓ Information retrieval query with citations → automatically open

### Example 3: General Information Retrieval (AUTOMATIC - No keywords needed)
User: "Who conducted the valuation?"
Your response: "The valuation was conducted by Sukhbir Tiwana MRICS[4]..."
→ CALL: open_document(citation_number=4, reason="Shows the valuer's name and RICS credentials on the report")
  ✓ Information retrieval query with citations → automatically open

### Example 4: Address Query (AUTOMATIC - Information retrieval)
User: "What is the address of the company?"
→ PRIMARY: "address" (ignore "company" - it's context)
Your ACTUAL response: "Company: MJ Group International Ltd[1]. Address: 15 Alfred Place, London[2]. Phone: +44 203 463 8725[3]..."
→ CALL: open_document(citation_number=2, reason="Highlights the company address on the document")
  ✓ Information retrieval query with citations → automatically open
  ✓ PRIMARY info (address) is at [2] in ACTUAL response → use citation_number=2

### Example 5: Phone Number Query (AUTOMATIC - Information retrieval)
User: "What is the phone number?"
→ PRIMARY: "phone number"
Your ACTUAL response: "Company: MJ Group International Ltd[1]. Address: 15 Alfred Place[2]. Phone Number: +44 203 463 8725[3]..."
→ CALL: open_document(citation_number=3, reason="Shows the contact phone number on the document")
  ✓ Information retrieval query with citations → automatically open
  ✓ PRIMARY info (phone) is at [3] in ACTUAL response → use citation_number=3

### Example 6: Complex Query with Context Words (AUTOMATIC - Information retrieval)
User: "please show me the phone number of the company that valued the highlands property"
→ PRIMARY REQUEST: "phone number" (ignore "company", "valued", "highlands", "property" - these are context)
Your ACTUAL response: "Company: MJ Group International Ltd[1]. Address: 15 Alfred Place[2]. Phone Number: +44 (0) 203 463 8725[3]..."
→ CALL: open_document(citation_number=3, reason="Shows the phone number the user requested on the document")
  ✓ Information retrieval query with citations → automatically open
  ✓ PRIMARY info (phone number) is at [3] in ACTUAL response → use citation_number=3
  ✓ Even though query mentions "company", PRIMARY is "phone number" so match to where it appears ([3])

### Example 7: Conversational Query (DO NOT CALL)
User: "Thanks for that information"
Your response: "You're welcome! Let me know if you need anything else."
→ DO NOT CALL open_document (no citations, conversational - not information retrieval)

### Example 8: No Citations (DO NOT CALL)
User: "What's the weather like?"
Your response: "I don't have weather information..."
→ DO NOT CALL open_document (no relevant citations - not information retrieval)
"""
    
    open_doc_tool = StructuredTool.from_function(
        func=tool_instance.open_document,
        name="open_document",
        description=open_document_description,
        args_schema=OpenDocumentInput
    )
    
    # =========================================================================
    # NAVIGATE_TO_PROPERTY TOOL
    # =========================================================================
    # This tool centers the map on a specific property location.
    # The user will see the property pin highlighted on the interactive map.
    # =========================================================================
    
    navigate_to_property_description = """
## PURPOSE
Centers the interactive map on a specific property location. The property pin will be highlighted and the map will zoom to show the property's position.

## DECISION FRAMEWORK: Should I call navigate_to_property?

Follow this decision tree IN ORDER:

1. IS THE QUERY ABOUT PROPERTY LOCATION OR MAP NAVIGATION?
   Check if query contains phrases like:
   - "show me on the map", "where is it located", "navigate to"
   - "find on map", "go to the property", "center on"
   - "zoom to", "display on map", "map view"
   → YES to any = CALL navigate_to_property

2. IS THE USER ASKING ABOUT A SPECIFIC PROPERTY'S POSITION?
   Examples:
   - "Where is Highlands property?"
   - "Show me where 123 Main Street is"
   - "Can you display this property on the map?"
   → YES = CALL navigate_to_property

3. IS THIS JUST A DOCUMENT/CONTENT QUERY?
   Examples:
   - "What is the valuation?" (document query)
   - "Tell me about the property features" (content query)
   - "Who is the surveyor?" (document query)
   → YES = DO NOT CALL navigate_to_property (use open_document instead if needed)

## MANDATORY RULE: REQUIRES VALID PROPERTY_ID
- You can ONLY call this tool if you have access to the property_id
- The property_id is a UUID (e.g., "993a4c9c-e759-4a44-9f6a-8e7f78c8b370")
- If no property_id is available in the context, DO NOT call this tool

## PARAMETER REQUIREMENTS

### property_id (string, REQUIRED)
- Must be a valid UUID from the current context
- Format: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
- Do NOT invent or guess property IDs
- If property_id is not available, DO NOT call this tool

### reason (string, REQUIRED)
- 10-20 word explanation of what the user will see on the map
- MUST describe the map action being performed
- Good examples:
  * "Centers map on Highlands property showing its location in Bishop's Stortford"
  * "Zooms to the property pin at 123 Main Street"
  * "Displays the property location the user requested"
- Bad examples:
  * "Navigating" (too vague)
  * "Map" (meaningless)
  * "Going there" (not descriptive)

## CONCRETE EXAMPLES

### Example 1: Explicit Map Request
User: "Show me this property on the map"
Context: property_id = "993a4c9c-e759-4a44-9f6a-8e7f78c8b370"
→ CALL: navigate_to_property(
    property_id="993a4c9c-e759-4a44-9f6a-8e7f78c8b370",
    reason="Centers map on the property to show its geographic location"
)

### Example 2: Location Query
User: "Where is the Highlands property located?"
Context: property_id = "abc-123-def-456"
→ CALL: navigate_to_property(
    property_id="abc-123-def-456",
    reason="Displays property location on map for Highlands, Berden Road"
)

### Example 3: Document Query (DO NOT CALL)
User: "What is the property value?"
→ DO NOT CALL navigate_to_property (this is a document query, use open_document)

### Example 4: No Property ID (DO NOT CALL)
User: "Show me properties in London"
Context: No specific property_id available
→ DO NOT CALL navigate_to_property (no specific property to navigate to)

## RELATIONSHIP WITH open_document
- open_document: Shows document content (citations, values, facts)
- navigate_to_property: Shows map location (geographic position)
- For document content queries → prefer open_document
- For location/map queries → prefer navigate_to_property
- You can call BOTH in rare cases where user wants to see document AND map
"""
    
    navigate_tool = StructuredTool.from_function(
        func=tool_instance.navigate_to_property,
        name="navigate_to_property",
        description=navigate_to_property_description,
        args_schema=NavigateToPropertyInput
    )
    
    # =========================================================================
    # SEARCH_PROPERTY TOOL
    # =========================================================================
    # This tool searches for properties by name or address.
    # Use this BEFORE select_property_pin when user mentions a property by name.
    # =========================================================================
    
    search_property_description = """
## PURPOSE
Searches for properties by name or address. Use this tool when the user mentions a property by name (like "highlands property") rather than by UUID. This tool finds the property and returns its ID so you can then navigate to it or select its pin.

## DECISION FRAMEWORK: Should I call search_property?

Follow this decision tree IN ORDER:

1. DID THE USER MENTION A PROPERTY BY NAME?
   Check if query contains phrases like:
   - "highlands property", "berden road property"
   - "the property at 123 Main Street"
   - "that highlands place", "the cottage"
   → YES to any = CALL search_property with the property name/address

2. DO I ALREADY HAVE THE PROPERTY_ID?
   Check if property_id is already available in context
   → YES = DO NOT call search_property (use the existing ID)
   → NO = CALL search_property to find the property

3. IS THE USER ASKING TO GO TO OR SEE A PROPERTY ON THE MAP?
   Check if query contains phrases like:
   - "take me to", "show me", "navigate to"
   - "go to the", "find the", "where is"
   → YES and property mentioned by name = CALL search_property FIRST

## MANDATORY RULES
- Call search_property BEFORE show_map_view or select_property_pin when property is mentioned by name
- The search query should be the property name or address as mentioned by the user
- After getting results, use the property_id for subsequent actions

## PARAMETER REQUIREMENTS

### query (string, REQUIRED)
- The search term to find the property
- Use the property name or address as the user mentioned it
- Examples: "highlands", "berden road", "123 main street", "the cottage"
- Keep it simple - just the key identifying words

## CONCRETE EXAMPLES

### Example 1: Property Navigation Request
User: "Take me to the highlands property"
→ CALL: search_property(query="highlands")
Then use the returned property_id for show_map_view and select_property_pin

### Example 2: Property Location Query
User: "Show me where the berden road property is"
→ CALL: search_property(query="berden road")
Then use results for navigation

### Example 3: Already Have Property ID (DO NOT CALL)
User: "Show me this property on the map"
Context: property_id = "993a4c9c-e759-4a44-9f6a-8e7f78c8b370"
→ DO NOT CALL search_property (already have the ID)

## WORKFLOW: Property Navigation by Name
When user says "take me to [property name]":
1. CALL search_property(query="[property name]") → get property_id
2. CALL show_map_view(reason="Opening map to display requested property")
3. CALL select_property_pin(property_id="...", reason="Selecting property pin to show details")
"""
    
    search_property_tool = StructuredTool.from_function(
        func=tool_instance.search_property,
        name="search_property",
        description=search_property_description,
        args_schema=SearchPropertyInput
    )
    
    # =========================================================================
    # SHOW_MAP_VIEW TOOL
    # =========================================================================
    # This tool opens the map view if it's not already visible.
    # Use this when the user wants to see properties on the map.
    # =========================================================================
    
    show_map_view_description = """
## PURPOSE
Opens the interactive map view if it's not already visible. Use this when the user wants to see property locations on the map. The map will display property pins and allow interaction.

## DECISION FRAMEWORK: Should I call show_map_view?

Follow this decision tree IN ORDER:

1. DOES THE USER WANT TO SEE THE MAP?
   Check if query contains phrases like:
   - "show me the map", "open the map", "go to map"
   - "take me to", "navigate to" (property)
   - "show on map", "display on map", "map view"
   - "where is", "find on map", "location of"
   → YES to any = CALL show_map_view

2. IS THE USER ASKING TO GO TO A PROPERTY PIN?
   Examples:
   - "Take me to the highlands property pin"
   - "Show me the property location"
   - "Navigate to this property"
   → YES = CALL show_map_view FIRST, then select_property_pin

3. IS THIS A DOCUMENT-ONLY QUERY?
   Examples:
   - "What is the valuation?"
   - "Show me the EPC rating"
   - "Who is the surveyor?"
   → YES = DO NOT CALL show_map_view (use open_document instead)

## MANDATORY RULES
- Call show_map_view BEFORE select_property_pin
- The map must be open before you can select a property pin
- Only call once per response (map stays open)

## PARAMETER REQUIREMENTS

### reason (string, REQUIRED)
- 10-20 word explanation of why opening the map helps the user
- Focus on what the user will see
- Good examples:
  * "Opens map to show property location the user requested"
  * "Displays map view to navigate to highlands property"
  * "Shows interactive map for property exploration"
- Bad examples:
  * "Opening map" (too vague)
  * "Map" (meaningless)

## CONCRETE EXAMPLES

### Example 1: Property Navigation Request
User: "Take me to the highlands property"
→ CALL: show_map_view(reason="Opens map to navigate to highlands property location")

### Example 2: Map View Request
User: "Show me the map"
→ CALL: show_map_view(reason="Displays interactive map with property pins as requested")

### Example 3: Location Query
User: "Where is this property located?"
→ CALL: show_map_view(reason="Opens map to display property's geographic location")

### Example 4: Document Query (DO NOT CALL)
User: "What is the property valued at?"
→ DO NOT CALL show_map_view (this is a document query)

## WORKFLOW: Combined with select_property_pin
1. CALL show_map_view first to ensure map is visible
2. CALL select_property_pin to highlight and center on the property
"""
    
    show_map_view_tool = StructuredTool.from_function(
        func=tool_instance.show_map_view,
        name="show_map_view",
        description=show_map_view_description,
        args_schema=ShowMapViewInput
    )
    
    # =========================================================================
    # SELECT_PROPERTY_PIN TOOL
    # =========================================================================
    # This tool selects a property pin on the map, centering the view and
    # showing the property card. Use after show_map_view.
    # =========================================================================
    
    select_property_pin_description = """
## PURPOSE
Selects a property pin on the map, centering the view on that property and displaying the property card. The map will animate to center on the pin, zoom to an appropriate level, and show the property information card.

## DECISION FRAMEWORK: Should I call select_property_pin?

Follow this decision tree IN ORDER:

1. DOES THE USER WANT TO GO TO A SPECIFIC PROPERTY PIN?
   Check if query contains phrases like:
   - "take me to the [property] pin"
   - "click on the [property] pin"
   - "select the [property]"
   - "show me [property] on the map"
   - "go to [property] location"
   → YES to any = CALL select_property_pin

2. DO I HAVE THE PROPERTY_ID?
   - YES = CALL select_property_pin with that property_id
   - NO = CALL search_property first to get the property_id

3. IS THE MAP ALREADY OPEN?
   - UNKNOWN or NO = CALL show_map_view BEFORE select_property_pin
   - YES = CALL select_property_pin directly

## MANDATORY RULES
- Call show_map_view BEFORE select_property_pin (map must be visible)
- Requires a valid property_id (UUID format)
- If property_id is not known, call search_property first
- Call only ONCE per response (one pin selection)

## PARAMETER REQUIREMENTS

### property_id (string, REQUIRED)
- Must be a valid UUID from search_property results or context
- Format: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
- Do NOT invent or guess property IDs

### reason (string, REQUIRED)
- 10-20 word explanation of why selecting this pin helps the user
- Focus on what the user will see
- Good examples:
  * "Selects highlands property pin to show property card and location"
  * "Centers map on requested property and displays details"
  * "Clicks property pin to reveal property information"
- Bad examples:
  * "Selecting" (too vague)
  * "Pin" (meaningless)

## CONCRETE EXAMPLES

### Example 1: Complete Property Navigation
User: "Take me to the highlands property pin"
1. search_property(query="highlands") → property_id="993a4c9c..."
2. show_map_view(reason="Opens map for property navigation")
3. select_property_pin(
    property_id="993a4c9c-e759-4a44-9f6a-8e7f78c8b370",
    reason="Selects highlands property pin to show details"
)

### Example 2: Pin Selection with Known ID
User: "Show me this property on the map"
Context: property_id = "abc-123-def-456"
1. show_map_view(reason="Opens map to display property")
2. select_property_pin(
    property_id="abc-123-def-456",
    reason="Centers map and shows property card"
)

### Example 3: Location Query
User: "Where is the berden road property?"
1. search_property(query="berden road") → property_id="xyz..."
2. show_map_view(reason="Opens map for location display")
3. select_property_pin(
    property_id="xyz...",
    reason="Shows berden road property location on map"
)

## RESULT
After calling select_property_pin:
- Map animates to center on the property
- Pin becomes highlighted/selected
- Property title card appears above the pin
- User can click the card for full property details
"""
    
    select_property_pin_tool = StructuredTool.from_function(
        func=tool_instance.select_property_pin,
        name="select_property_pin",
        description=select_property_pin_description,
        args_schema=SelectPropertyPinInput
    )
    
    # =========================================================================
    # NAVIGATE_TO_PROPERTY_BY_NAME TOOL (SIMPLIFIED COMBINED TOOL)
    # =========================================================================
    # This is the PREFERRED tool for navigation requests.
    # It combines search + map + pin selection into one call.
    # Use this when user says "take me to [property name]".
    # =========================================================================
    
    navigate_by_name_description = """
## PURPOSE
**THIS IS THE PREFERRED TOOL FOR NAVIGATION REQUESTS.**

This tool handles the complete navigation workflow when a user wants to go to a property by name. It will:
1. Search for the property by name
2. Open the map view
3. Center on and select the property pin

Use this ONE tool instead of calling search_property, show_map_view, and select_property_pin separately.

## WHEN TO USE (HIGH PRIORITY - CHECK THIS FIRST)

**ALWAYS USE THIS TOOL WHEN:**
- User says "take me to [property name]"
- User says "go to [property name]"
- User says "show me [property name] on the map"
- User says "navigate to [property name]"
- User says "find [property name] on the map"
- User asks "where is [property name]" (and wants to see it on map)

**EXAMPLE TRIGGERS:**
- "take me to the highlands property"
- "go to the highlands pin"
- "show me highlands on the map"
- "navigate to berden road"
- "find the cottage on the map"

## PARAMETERS

### property_name (string, REQUIRED)
- The property name or address as the user mentioned it
- Use keywords from the user's query
- Examples: "highlands", "berden road", "the cottage", "123 main street"

### reason (string, REQUIRED)
- Brief explanation of what you're doing
- Example: "Navigating to Highlands property as requested"

## EXAMPLES

### User: "take me to the highlands pin"
→ CALL: navigate_to_property_by_name(
    property_name="highlands",
    reason="Navigating to Highlands property as requested"
)

### User: "show me the berden road property on the map"
→ CALL: navigate_to_property_by_name(
    property_name="berden road",
    reason="Showing Berden Road property on map as requested"
)

### User: "go to the cottage"
→ CALL: navigate_to_property_by_name(
    property_name="cottage",
    reason="Navigating to cottage property as requested"
)

## IMPORTANT
- This is a ONE-CALL solution - don't also call search_property, show_map_view, or select_property_pin
- Provide a brief text response before calling: "I'll take you to the Highlands property on the map."
- The backend will handle the full workflow automatically
"""
    
    navigate_by_name_tool = StructuredTool.from_function(
        func=tool_instance.navigate_to_property_by_name,
        name="navigate_to_property_by_name",
        description=navigate_by_name_description,
        args_schema=NavigateToPropertyByNameInput
    )
    
    # =========================================================================
    # DESKTOP AUTOMATION TOOLS (OpenCode Integration)
    # =========================================================================
    
    file_management_description = """
## PURPOSE
Performs file management operations like organizing, sorting, renaming, or moving files.
Uses OpenCode's desktop automation to manipulate files on the user's system.

## WHEN TO USE
- User asks to "organize my files", "sort my downloads", "clean up folders"
- User wants to "rename files", "move documents", "group by type/date"
- User mentions specific folders like "Downloads", "Documents", "Desktop"

## ACTIONS
- 'organize': Group files by type (documents, images, etc.) or by date
- 'sort': Rename files with a consistent pattern
- 'rename': Batch rename files based on rules
- 'move': Relocate files to a different folder

## EXAMPLES
User: "Organize my downloads folder by file type"
→ file_management(action="organize", path="~/Downloads", pattern="by_type", reason="Organizing downloads by file type")

User: "Move all PDFs to my documents"
→ file_management(action="move", path="~/Downloads", destination="~/Documents", filter_pattern="*.pdf", reason="Moving PDFs to Documents folder")
"""
    
    file_management_tool = StructuredTool.from_function(
        func=tool_instance.file_management,
        name="file_management",
        description=file_management_description,
        args_schema=FileManagementInput
    )
    
    document_creation_description = """
## PURPOSE
Creates, summarizes, or rewrites documents using AI assistance.
Uses OpenCode to generate or transform documents on the user's system.

## WHEN TO USE
- User asks to "create a document", "write a report", "draft a memo"
- User wants to "summarize this document", "make a summary"
- User asks to "rewrite", "improve", "make more formal/concise"

## ACTIONS
- 'create': Generate a new document from scratch or instructions
- 'summarize': Create a summary of an existing document
- 'rewrite': Transform/improve an existing document

## EXAMPLES
User: "Create a project proposal for the new website"
→ document_creation(action="create", content="Project proposal for new website redesign...", output_path="~/Documents/proposal.md", reason="Creating project proposal")

User: "Summarize the meeting notes"
→ document_creation(action="summarize", source_path="~/Documents/meeting_notes.md", output_path="~/Documents/meeting_summary.md", reason="Summarizing meeting notes")
"""
    
    document_creation_tool = StructuredTool.from_function(
        func=tool_instance.document_creation,
        name="document_creation",
        description=document_creation_description,
        args_schema=DocumentCreationInput
    )
    
    browser_automation_description = """
## PURPOSE
Automates browser tasks like web research, form filling, or taking screenshots.
Uses OpenCode's browser automation capabilities.

## WHEN TO USE
- User asks to "research", "find information online", "look up"
- User wants to "fill out a form", "submit data to website"
- User asks to "take a screenshot", "capture webpage"

## ACTIONS
- 'research': Gather information from the web on a topic
- 'form_fill': Fill out web forms with provided data
- 'screenshot': Capture a webpage image

## EXAMPLES
User: "Research the latest property prices in London"
→ browser_automation(action="research", instructions="Find current property prices and market trends in London", output_path="~/research.md", reason="Researching London property prices")

User: "Take a screenshot of the company website"
→ browser_automation(action="screenshot", url="https://example.com", output_path="~/screenshot.png", reason="Capturing website screenshot")
"""
    
    browser_automation_tool = StructuredTool.from_function(
        func=tool_instance.browser_automation,
        name="browser_automation",
        description=browser_automation_description,
        args_schema=BrowserAutomationInput
    )
    
    return [
        open_doc_tool, 
        navigate_tool, 
        search_property_tool, 
        show_map_view_tool, 
        select_property_pin_tool, 
        navigate_by_name_tool,
        # Desktop automation tools
        file_management_tool,
        document_creation_tool,
        browser_automation_tool
    ], tool_instance

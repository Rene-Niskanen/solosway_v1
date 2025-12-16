"""
Citation Mapping Tool - LLM provides block IDs directly from document extracts.

This tool allows the LLM to cite specific blocks from document extracts by their block ID.
The LLM looks up the block ID in the Metadata Look-Up Table to get bbox coordinates.

Uses CitationTool class to store citations with bbox lookup and state management.
"""

import logging
from typing import Dict, List, Any, Tuple, Optional
from pydantic import BaseModel, Field
from langchain_core.tools import StructuredTool

from backend.llm.types import Citation

logger = logging.getLogger(__name__)


def verify_citation_match(cited_text: str, block_content: str) -> Dict[str, Any]:
    """
    Verify that cited_text matches block_content.
    
    Args:
        cited_text: Text the LLM is citing (e.g., "90-day value: £1,950,000")
        block_content: Actual content of the block being cited
    
    Returns:
        {
            'match': bool,
            'confidence': 'high'|'medium'|'low',
            'matched_terms': list,
            'missing_terms': list,
            'numeric_matches': list
        }
    """
    if not block_content:
        return {'match': False, 'confidence': 'low', 'matched_terms': [], 'missing_terms': ['block_content_missing'], 'numeric_matches': []}
    
    import re
    
    # Extract numeric values from cited_text (normalize formats: £1,950,000, 1950000, 1,950,000)
    numeric_pattern = r'£?([\d,]+\.?\d*)'
    cited_numbers = re.findall(numeric_pattern, cited_text)
    cited_numbers_normalized = [num.replace(',', '').replace('.', '') for num in cited_numbers]
    
    # Extract numeric values from block_content
    block_numbers = re.findall(numeric_pattern, block_content)
    block_numbers_normalized = [num.replace(',', '').replace('.', '') for num in block_numbers]
    
    # Check for numeric matches
    numeric_matches = [num for num in cited_numbers_normalized if num in block_numbers_normalized]
    
    # Extract key terms (non-numeric words, 3+ chars)
    cited_terms = [word.lower() for word in re.findall(r'\b\w{3,}\b', cited_text.lower())]
    block_terms = [word.lower() for word in re.findall(r'\b\w{3,}\b', block_content.lower())]
    
    # Check for term matches
    term_matches = [term for term in cited_terms if term in block_terms]
    missing_terms = [term for term in cited_terms if term not in block_terms]
    
    # Determine confidence
    has_numeric_match = len(numeric_matches) > 0
    has_term_match = len(term_matches) > 0
    
    if has_numeric_match and has_term_match:
        confidence = 'high'
        match = True
    elif has_numeric_match or (has_term_match and len(term_matches) >= len(cited_terms) * 0.5):
        confidence = 'medium'
        match = True
    else:
        confidence = 'low'
        match = False
    
    return {
        'match': match,
        'confidence': confidence,
        'matched_terms': term_matches,
        'missing_terms': missing_terms,
        'numeric_matches': numeric_matches
    }


class CitationInput(BaseModel):
    """Input schema for citation tool - LLM provides block ID directly."""
    
    cited_text: str = Field(
        ...,
        description="The text you generated that cites this source (your paraphrased/summarized version)"
    )
    
    block_id: str = Field(
        ...,
        description="The BLOCK_CITE_ID from the document extract (e.g., 'BLOCK_CITE_ID_3')"
    )
    
    citation_number: int = Field(
        ...,
        description="Sequential citation number (1, 2, 3, etc.) - use next available number. This must match the superscript number in your response text."
    )


class CitationTool:
    """Manages citations with bbox lookup and state storage"""
    
    def __init__(self, metadata_lookup_tables: Dict[str, Dict[str, Dict[str, Any]]]):
        """
        Initialize CitationTool with metadata lookup tables.
        
        Args:
            metadata_lookup_tables: Map of doc_id -> block_id -> metadata
                Format: {
                    'doc_123': {
                        'BLOCK_CITE_ID_1': {page: 1, bbox_left: 0.1, bbox_top: 0.2, ...},
                        'BLOCK_CITE_ID_2': {page: 1, bbox_left: 0.2, ...}
                    }
                }
        """
        self.metadata_lookup_tables = metadata_lookup_tables
        self.citations: List[Citation] = []
    
    def add_citation(
        self,
        cited_text: str,
        block_id: str,
        citation_number: int
    ) -> str:
        """
        Add citation with automatic bbox lookup.
        Called by LangChain tool, but citations stored separately for state update.
        
        Args:
            cited_text: The text from LLM's response that cites this source
            block_id: The BLOCK_CITE_ID from the document extract
            citation_number: Sequential citation number matching superscript
        
        Returns:
            Confirmation string
        """
        # Find block in metadata tables
        block_metadata = None
        doc_id = None
        
        for doc_id_candidate, metadata_table in self.metadata_lookup_tables.items():
            if block_id in metadata_table:
                block_metadata = metadata_table[block_id]
                doc_id = doc_id_candidate
                break
        
        if not block_metadata:
            logger.warning(
                f"[CITATION_TOOL] Block ID {block_id} (citation {citation_number}) "
                f"not found in metadata tables"
            )
            return f"⚠️ Citation {citation_number} recorded but block {block_id} not found"
        
        # Extract bbox coordinates
        bbox = {
            'left': round(float(block_metadata.get('bbox_left', 0.0)), 4),
            'top': round(float(block_metadata.get('bbox_top', 0.0)), 4),
            'width': round(float(block_metadata.get('bbox_width', 0.0)), 4),
            'height': round(float(block_metadata.get('bbox_height', 0.0)), 4),
            'page': int(block_metadata.get('page', 0))
        }
        
        page_number = int(block_metadata.get('page', 0))
        
        
        # Create citation object
        citation: Citation = {
            'citation_number': citation_number,
            'block_id': block_id,
            'cited_text': cited_text,
            'bbox': bbox,
            'page_number': page_number,
            'doc_id': doc_id,
            'confidence': block_metadata.get('confidence', 'medium'),
            'method': 'block-id-lookup'
        }
        
        self.citations.append(citation)
        
        logger.info(
            f"[CITATION_TOOL] ✅ Citation {citation_number} added: {block_id} "
            f"(doc: {doc_id[:8] if doc_id else 'UNKNOWN'}, page: {page_number}, "
            f"bbox: {bbox['left']:.3f},{bbox['top']:.3f})"
        )
        
        return f"✅ Citation {citation_number} recorded for {block_id}"


def create_citation_tool(
    metadata_lookup_tables: Dict[str, Dict[str, Dict[str, Any]]]
) -> Tuple[StructuredTool, CitationTool]:
    """
    Create citation tool bound to metadata lookup tables.
    
    Args:
        metadata_lookup_tables: Map of doc_id -> block_id -> metadata for bbox lookup
    
    Returns:
        Tuple of (tool, citation_tool_instance):
        - tool: LangChain StructuredTool for LLM to call
        - citation_tool_instance: CitationTool instance to get citations from
    """
    citation_tool_instance = CitationTool(metadata_lookup_tables)
    
    tool = StructuredTool.from_function(
        func=lambda cited_text, block_id, citation_number: citation_tool_instance.add_citation(
            cited_text=cited_text,
            block_id=block_id,
            citation_number=citation_number
        ),
        name="cite_source",
        description="""⚠️ MANDATORY TOOL CALL - YOU MUST USE THIS TOOL ⚠️

**PHASE 1 USAGE (Citation Extraction):**
You are in Phase 1: Citation Extraction. You MUST call this tool for EVERY factual claim you find in the documents.

**WHAT TO CITE:**
- Every value, price, amount, measurement
- Every date, time period
- Every name (valuer, inspector, party)
- Every address, location
- Every assessment, opinion, rating
- Any specific data that answers the user's question

**HOW TO USE:**
1. Find factual claims in the document extracts (look for <BLOCK> tags)
2. For EACH factual claim, call this tool:
   - block_id: The BLOCK_CITE_ID from the <BLOCK> tag (e.g., "BLOCK_CITE_ID_42")
   - citation_number: Sequential number (1, 2, 3, 4, 5...)
   - cited_text: The factual claim (exact text or your paraphrase)

**EXAMPLES:**
- cite_source(block_id="BLOCK_CITE_ID_42", citation_number=1, cited_text="Market Value: £2,300,000")
- cite_source(block_id="BLOCK_CITE_ID_15", citation_number=2, cited_text="Valuation date: 12th February 2024")
- cite_source(block_id="BLOCK_CITE_ID_7", citation_number=3, cited_text="Valuer: Sukhbir Tiwana MRICS")

**CRITICAL:**
- You MUST call this tool multiple times (minimum 3-5 calls for most queries)
- Use sequential citation numbers starting from 1
- Find BLOCK_CITE_ID in the <BLOCK> tags from document extracts
- Do NOT skip citations - cite every relevant factual claim
- Tool calls are MANDATORY - you cannot proceed without calling this tool""",
        args_schema=CitationInput
    )
    
    return tool, citation_tool_instance


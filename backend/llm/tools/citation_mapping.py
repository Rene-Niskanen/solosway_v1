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
        description="""MANDATORY TOOL CALL: You MUST call this tool programmatically for EVERY superscript citation in your answer.

CRITICAL: This tool is bound to your response - you MUST call it when you use superscript citations (¹, ², ³). The tool is executed automatically when you call it - do not write the tool syntax in your text.

WORKFLOW:
1. Write your answer with superscript citations as you cite information: "The property is valued at £2,400,000¹"
2. For EACH superscript, you MUST call this tool BEFORE finishing your response:
   - block_id: The BLOCK_CITE_ID from the document extract (find it in the <BLOCK> tags)
   - citation_number: The number matching your superscript (1 for ¹, 2 for ², 3 for ³)
   - cited_text: The specific sentence from your answer that cites this source

EXAMPLE:
- You see: <BLOCK id="BLOCK_CITE_ID_42">Content: "Final valued price: £2,400,000"</BLOCK>
- You write in response: "The property is valued at £2,400,000¹"
- You MUST call: cite_source(block_id="BLOCK_CITE_ID_42", citation_number=1, cited_text="The property is valued at £2,400,000")

MANDATORY: If you write a superscript (¹, ², ³) without calling this tool, the citation will fail. You MUST call this tool for every superscript you use.""",
        args_schema=CitationInput
    )
    
    return tool, citation_tool_instance


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
            # #region agent log
            try:
                import json
                with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                    f.write(json.dumps({
                        'sessionId': 'debug-session',
                        'runId': 'run1',
                        'hypothesisId': 'D',
                        'location': 'citation_mapping.py:86',
                        'message': 'Block ID not found in metadata tables',
                        'data': {
                            'block_id': block_id,
                            'citation_number': citation_number,
                            'available_doc_ids': list(self.metadata_lookup_tables.keys())[:3] if self.metadata_lookup_tables else []
                        },
                        'timestamp': int(__import__('time').time() * 1000)
                    }) + '\n')
            except Exception:
                pass
            # #endregion
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
        
        # #region agent log
        # Debug: Log bbox extraction from metadata for Hypothesis C, D
        try:
            is_fallback_bbox = (
                bbox['left'] == 0.0 and bbox['top'] == 0.0 and
                bbox['width'] == 1.0 and bbox['height'] == 1.0
            )
            import json
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({
                    'sessionId': 'debug-session',
                    'runId': 'run1',
                    'hypothesisId': 'C,D',
                    'location': 'citation_mapping.py:100',
                    'message': 'Bbox extracted from metadata table',
                    'data': {
                        'block_id': block_id,
                        'citation_number': citation_number,
                        'bbox': bbox,
                        'page_number': page_number,
                        'is_fallback_bbox': is_fallback_bbox,
                        'bbox_left': block_metadata.get('bbox_left'),
                        'bbox_top': block_metadata.get('bbox_top'),
                        'bbox_width': block_metadata.get('bbox_width'),
                        'bbox_height': block_metadata.get('bbox_height'),
                        'metadata_page': block_metadata.get('page'),
                        'doc_id': doc_id[:8] if doc_id else 'unknown'
                    },
                    'timestamp': int(__import__('time').time() * 1000)
                }) + '\n')
        except Exception:
            pass
        # #endregion
        
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


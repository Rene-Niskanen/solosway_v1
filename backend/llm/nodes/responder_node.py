"""
Responder Node - Generates final answer from execution results.

This node takes the execution results and generates a conversational answer.
It reuses the existing conversational answer generation logic but receives
structured results instead of tool messages.

Key Principle: Generate answer from operational results, not internal reasoning.
"""

import logging
import re
import uuid
import json
from typing import Dict, Any, List, Tuple, Optional, Literal
from dataclasses import dataclass
from pydantic import BaseModel, Field
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.prebuilt import ToolNode

from backend.llm.types import MainWorkflowState, Citation
from backend.llm.utils.execution_events import ExecutionEvent, ExecutionEventEmitter
from backend.llm.nodes.agent_node import generate_conversational_answer, extract_chunk_citations_from_messages, get_document_filename
from backend.llm.contracts.validators import validate_responder_output
from backend.llm.config import config
from backend.llm.tools.citation_mapping import create_chunk_citation_tool
from backend.services.supabase_client_factory import get_supabase_client

# Import from new citation architecture modules
from backend.llm.citation import (
    fetch_chunk_blocks,
    extract_evidence_blocks_from_chunks,
    deduplicate_evidence_blocks,
    rank_evidence_by_relevance,
    create_evidence_registry,
    format_evidence_table_for_llm,
    map_citation_numbers_to_citations,
    deduplicate_and_renumber_citations,
    extract_atomic_facts_from_block,
    extract_clause_evidence_from_block,
    EvidenceBlock
)

logger = logging.getLogger(__name__)

# Evidence-First Citation Architecture Types
EvidenceType = Literal["atomic", "clause"]


class EvidenceAnswerOutput(BaseModel):
    """Structured output for LLM answer with citation numbers (legacy - for backward compatibility)."""
    answer: str = Field(
        description="The conversational answer with citation numbers embedded (e.g., 'The property has a market value of [AMOUNT] [1] as of [DATE] [2].')"
    )
    citations: List[int] = Field(
        description="Array of citation numbers used in the answer (e.g., [1, 2, 3])"
    )
    unsupported_claims: List[str] = Field(
        default=[],
        description="Any claims the user asked about that have no supporting evidence"
    )


class EvidenceClaim(BaseModel):
    """Single claim with its supporting evidence."""
    claim: str = Field(
        description="The factual claim (e.g., 'Market value of the property')",
        max_length=200
    )
    citations: List[int] = Field(
        description="Citation numbers supporting this claim (e.g., [1, 2])",
        min_length=1,
        max_length=5
    )


class EvidenceSelectionOutput(BaseModel):
    """Structured output from Pass 1: Evidence selection."""
    facts: List[EvidenceClaim] = Field(
        description="List of claims with their supporting citations",
        max_length=10
    )
    unsupported_claims: List[str] = Field(
        default=[],
        description="Any claims the user asked about that have no supporting evidence",
        max_length=5
    )


class NaturalLanguageOutput(BaseModel):
    """Structured output from Pass 2: Natural language rendering."""
    answer: str = Field(
        description="Conversational answer with citation numbers embedded",
        max_length=2000
    )
    citations: List[int] = Field(
        description="Array of citation numbers used (e.g., [1, 2, 3])",
        max_length=10
    )


logger = logging.getLogger(__name__)


def extract_chunks_from_results(execution_results: list[Dict[str, Any]]) -> str:
    """
    Extract chunk text from execution results.
    
    Similar to extract_chunk_text_only but works with execution_results structure.
    """
    chunk_texts = []
    
    for result in execution_results:
        if result.get("action") == "retrieve_chunks" and result.get("success"):
            result_data = result.get("result", [])
            if isinstance(result_data, list):
                for chunk in result_data:
                    if isinstance(chunk, dict):
                        # Extract chunk text
                        chunk_text = chunk.get('chunk_text') or chunk.get('chunk_text_clean', '')
                        if chunk_text:
                            chunk_texts.append(chunk_text.strip())
    
    return "\n\n---\n\n".join(chunk_texts)


def extract_chunks_with_metadata(execution_results: list[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Extract chunks with metadata (chunk_id, chunk_text, document_id, bbox, page_number, blocks) from execution results.
    
    Returns:
        List of chunk dictionaries with full metadata for citation mapping
    """
    chunks_metadata = []
    
    for result in execution_results:
        if result.get("action") == "retrieve_chunks" and result.get("success"):
            result_data = result.get("result", [])
            if isinstance(result_data, list):
                for chunk in result_data:
                    if isinstance(chunk, dict):
                        chunk_text = chunk.get('chunk_text') or chunk.get('chunk_text_clean', '')
                        if chunk_text:
                            chunks_metadata.append({
                                'chunk_id': chunk.get('chunk_id'),
                                'chunk_text': chunk_text.strip(),
                                'document_id': chunk.get('document_id'),
                                'document_filename': chunk.get('document_filename'),
                                'page_number': chunk.get('page_number', 0),
                                'bbox': chunk.get('bbox'),  # Chunk-level bbox (fallback)
                                'blocks': chunk.get('blocks', [])  # Block-level data for precise citations
                            })
    
    return chunks_metadata


def format_chunks_with_ids(chunks_metadata: List[Dict[str, Any]]) -> str:
    """
    Format chunks with chunk_ids visible to LLM.
    
    Format: [CHUNK_ID: uuid] chunk text here
    
    This allows the LLM to see which chunk_id corresponds to which text,
    so it can call match_citation_to_chunk with the correct chunk_id and exact text.
    """
    formatted_chunks = []
    
    for chunk in chunks_metadata:
        chunk_id = chunk.get('chunk_id', '')
        chunk_text = chunk.get('chunk_text', '')
        if chunk_id and chunk_text:
            formatted_chunks.append(f"[CHUNK_ID: {chunk_id}]\n{chunk_text}")
    
    return "\n\n---\n\n".join(formatted_chunks)


def format_chunks_with_short_ids(chunks_metadata: List[Dict[str, Any]]) -> Tuple[str, Dict[str, Dict[str, Any]]]:
    """
    Format chunks with short integer IDs for LLM, creating a lookup mapping.
    
    Format: [SOURCE_ID: 1] chunk text here
           [SOURCE_ID: 2] chunk text here
    
    This allows the LLM to see simple numbers (1, 2, 3) instead of long UUIDs,
    dramatically improving citation accuracy and reducing token usage.
    
    Returns:
        - formatted_text: Chunks formatted with short IDs
        - short_id_lookup: Dict mapping short_id (str) -> full chunk metadata
    """
    formatted_chunks = []
    short_id_lookup = {}
    
    for idx, chunk in enumerate(chunks_metadata, start=1):
        short_id = str(idx)  # "1", "2", "3", etc.
        chunk_id = chunk.get('chunk_id', '')
        chunk_text = chunk.get('chunk_text', '')
        
        if chunk_id and chunk_text:
            # Format with short ID at the beginning
            formatted_chunks.append(f"[SOURCE_ID: {short_id}]\n{chunk_text}")
            
            # Store ALL blocks for this chunk (not just one bbox)
            # We'll select the best block when extracting citations based on context
            blocks = chunk.get('blocks', [])
            chunk_bbox = chunk.get('bbox')  # Fallback to chunk-level bbox
            
            # Map short_id -> full chunk metadata (including UUID, bbox, page_number, blocks)
            short_id_lookup[short_id] = {
                'chunk_id': chunk_id,  # Full UUID for database lookup
                'short_id': short_id,  # The simple number (1, 2, 3)
                'page_number': chunk.get('page_number', 0),
                'bbox': chunk_bbox,  # Chunk-level bbox (fallback)
                'blocks': blocks,  # All blocks for this chunk (for precise block selection)
                'doc_id': chunk.get('document_id'),
                'original_filename': chunk.get('document_filename', ''),
                'chunk_text': chunk_text
            }
            
            # Log block information for debugging
            if blocks and isinstance(blocks, list):
                logger.info(
                    f"[CITATION_DEBUG] Chunk {short_id} ({chunk_id[:8]}...): "
                    f"{len(blocks)} blocks, chunk_bbox={chunk_bbox is not None}"
                )
                for block_idx, block in enumerate(blocks[:3]):  # Log first 3 blocks
                    if isinstance(block, dict):
                        block_type = block.get('type', 'unknown')
                        block_content_preview = (block.get('content', '') or '')[:50]
                        block_bbox = block.get('bbox')
                        logger.debug(
                            f"  Block {block_idx}: type={block_type}, "
                            f"content_preview='{block_content_preview}...', "
                            f"bbox={block_bbox is not None}"
                        )
    
    formatted_text = "\n\n---\n\n".join(formatted_chunks)
    return formatted_text, short_id_lookup


def extract_citations_with_positions(
    llm_response: str, 
    short_id_lookup: Dict[str, Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Extract citations from LLM response using regex pattern matching.
    
    The LLM should include citations in the format [ID: X] where X is a short ID (1, 2, 3, etc.).
    This function extracts these citations and maps them to full chunk metadata.
    It also matches each citation to the best block within the chunk based on context.
    
    Args:
        llm_response: The LLM's response text containing [ID: X] citations
        short_id_lookup: Dictionary mapping short_id -> full chunk metadata
    
    Returns:
        List of citation dictionaries with position, metadata, and citation number
    """
    citations = []
    # Robust regex pattern: matches [ID: 1], [ID:1], [ID: 12], etc.
    pattern = r'\[ID:\s*([^\]]+)\]'
    matches = list(re.finditer(pattern, llm_response))
    
    logger.info(f"[CITATION_DEBUG] Extracting citations from LLM response ({len(matches)} matches found)")
    
    for idx, match in enumerate(matches, start=1):
        short_id = match.group(1).strip()
        start_position = match.start()
        end_position = match.end()
        
        # Extract context around the citation to help match to the right block
        # Use a smaller context window to get more specific context
        context_start = max(0, start_position - 50)
        context_end = min(len(llm_response), end_position + 50)
        citation_context = llm_response[context_start:context_end].lower()
        
        # Extract the sentence containing the citation for better matching
        # Find sentence boundaries around the citation
        sentence_start = citation_context.rfind('.', 0, start_position - context_start)
        sentence_end = citation_context.find('.', end_position - context_start)
        if sentence_start == -1:
            sentence_start = 0
        else:
            sentence_start += 1  # Skip the period
        if sentence_end == -1:
            sentence_end = len(citation_context)
        else:
            sentence_end += 1  # Include the period
        
        # Use the sentence containing the citation as the primary context
        sentence_context = citation_context[sentence_start:sentence_end].strip()
        
        # Look up full metadata for this short ID
        metadata = short_id_lookup.get(short_id)
        if metadata:
            # Find the best matching block for this citation
            best_bbox = metadata.get('bbox')  # Fallback to chunk-level bbox
            best_block_info = None
            
            blocks = metadata.get('blocks', [])
            if blocks and isinstance(blocks, list) and len(blocks) > 0:
                # Try to match citation context to the best block
                best_match_score = 0
                
                for block_idx, block in enumerate(blocks):
                    if not isinstance(block, dict):
                        continue
                    
                    block_content = (block.get('content', '') or '').lower()
                    block_type = block.get('type', '').lower()
                    block_bbox = block.get('bbox')
                    
                    if not block_content or not isinstance(block_bbox, dict):
                        continue
                    
                    # Skip headings/titles (they're usually not what we want to highlight)
                    if block_type in ['title', 'heading']:
                        continue
                    
                    # Calculate match score based on keyword overlap
                    # Extract keywords from citation context (words > 3 chars)
                    context_words = set(word for word in citation_context.split() if len(word) > 3)
                    block_words = set(word for word in block_content.split() if len(word) > 3)
                    
                    # Calculate overlap
                    overlap = len(context_words & block_words)
                    match_score = overlap
                    
                    # Use sentence context for more precise matching
                    if sentence_context:
                        sentence_words = set(word for word in sentence_context.split() if len(word) > 3)
                        sentence_overlap = len(sentence_words & block_words)
                        # Weight sentence context more heavily (it's more specific)
                        match_score += sentence_overlap * 2
                    
                    # Bonus for longer blocks (more content = more likely to be the main content)
                    if len(block_content) > 50:
                        match_score += 1
                    
                    # Bonus for exact phrase matches in the sentence context
                    if sentence_context and sentence_context in block_content:
                        match_score += 10
                    
                    # Update best match if this score is higher
                    if match_score > best_match_score:
                        best_match_score = match_score
                        best_bbox = block_bbox
                        best_block_info = {
                            'block_index': block_idx,
                            'block_type': block_type,
                            'content_preview': block.get('content', '')[:80],
                            'match_score': match_score
                        }
                
                # Log block selection for debugging
                if best_block_info:
                    logger.info(
                        f"[CITATION_DEBUG] Citation {idx} (short_id={short_id}): "
                        f"Selected block {best_block_info['block_index']} "
                        f"(type={best_block_info['block_type']}, "
                        f"score={best_block_info['match_score']}, "
                        f"bbox={best_bbox is not None})"
                    )
                    logger.debug(
                        f"  Block content preview: '{best_block_info['content_preview']}...'"
                    )
                else:
                    logger.warning(
                        f"[CITATION_DEBUG] Citation {idx} (short_id={short_id}): "
                        f"No matching block found, using chunk-level bbox"
                    )
            
            # Ensure bbox is a dict (not None or invalid)
            if not isinstance(best_bbox, dict):
                logger.warning(f"Citation {idx}: bbox is not a dict (got {type(best_bbox)}), using fallback")
                best_bbox = None
            
            citation = {
                'citation_number': idx,  # Sequential citation number [1], [2], [3]
                'short_id': short_id,
                'chunk_id': metadata.get('chunk_id'),
                'position': start_position,
                'end_position': end_position,
                'bbox': best_bbox,  # Best matching block bbox or chunk-level bbox
                'page_number': metadata.get('page_number', 0),
                'doc_id': metadata.get('doc_id'),
                'original_filename': metadata.get('original_filename', ''),
                'method': 'direct-id-extraction',
                'block_info': best_block_info  # For debugging
            }
            citations.append(citation)
            
            logger.info(
                f"[CITATION_DEBUG] Citation {idx} extracted: "
                f"doc_id={metadata.get('doc_id', '')[:8]}, "
                f"page={metadata.get('page_number', 0)}, "
                f"bbox_valid={isinstance(best_bbox, dict)}, "
                f"bbox_left={best_bbox.get('left', 'N/A') if isinstance(best_bbox, dict) else 'N/A'}, "
                f"bbox_top={best_bbox.get('top', 'N/A') if isinstance(best_bbox, dict) else 'N/A'}"
            )
        else:
            logger.warning(
                f"Short ID '{short_id}' not found in lookup. "
                f"Available IDs: {list(short_id_lookup.keys())}"
            )
    
    logger.info(f"[CITATION_DEBUG] Extracted {len(citations)} citations total")
    return citations


def replace_ids_with_citation_numbers(
    llm_response: str, 
    citations: List[Dict[str, Any]]
) -> str:
    """
    Replace [ID: X] with [1], [2], [3] in the LLM response using position-based string slicing.
    
    This prevents "overlapping replacement" bugs by replacing from end to start,
    ensuring positions remain valid during replacement.
    
    Args:
        llm_response: Original LLM response with [ID: X] citations
        citations: List of citation dictionaries with position and citation_number
    
    Returns:
        Response text with [ID: X] replaced by [1], [2], [3], etc.
    """
    if not citations:
        return llm_response
    
    response = llm_response
    # Sort by position in reverse order (end to start) to avoid position shifting
    sorted_citations = sorted(
        citations, 
        key=lambda c: c.get('position', 0), 
        reverse=True
    )
    
    for citation in sorted_citations:
        start = citation.get('position', 0)
        end = citation.get('end_position', start)
        citation_number = citation.get('citation_number')
        
        if citation_number and start is not None and end is not None:
            # Safe position-based replacement
            response = (
                response[:start] + 
                f'[{citation_number}]' + 
                response[end:]
            )
    
    return response


def format_citations_for_frontend(
    citations: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Format citations for frontend consumption.
    
    Converts internal citation dictionaries to Citation TypedDict format expected by the frontend.
    
    Args:
        citations: List of citation dictionaries from extract_citations_with_positions()
    
    Returns:
        List of Citation dictionaries for frontend
    """
    frontend_citations = []
    
    for citation in citations:
        # Extract bbox data - only include if valid
        bbox_data = citation.get('bbox')
        bbox = None
        
        if isinstance(bbox_data, dict):
            # Validate bbox has required fields
            left = bbox_data.get('left')
            top = bbox_data.get('top')
            width = bbox_data.get('width')
            height = bbox_data.get('height')
            
            # Only create bbox if all required fields are present and valid
            if (left is not None and top is not None and 
                width is not None and height is not None and
                width > 0 and height > 0):
                bbox = {
                    'left': float(left),
                    'top': float(top),
                    'width': float(width),
                    'height': float(height),
                    'page': bbox_data.get('page', citation.get('page_number', 0)),
                    'original_page': bbox_data.get('original_page', citation.get('page_number', 0))
                }
            else:
                logger.debug(
                    f"Citation {citation.get('citation_number', '?')}: Invalid bbox values "
                    f"(left={left}, top={top}, width={width}, height={height}), skipping bbox"
                )
        
        # Create Citation TypedDict-compatible dictionary
        # Note: bbox can be None - frontend will handle opening document on correct page without highlighting
        frontend_citation: Dict[str, Any] = {
            'citation_number': citation.get('citation_number', 0),
            'chunk_id': citation.get('chunk_id', ''),
            'block_id': None,  # Not used in direct citation system
            'block_index': None,  # Not used in direct citation system
            'cited_text': '',  # Not extracted in direct citation system
            'bbox': bbox,  # Can be None if bbox data is missing/invalid
            'page_number': citation.get('page_number', 0),
            'doc_id': citation.get('doc_id', ''),
            'original_filename': citation.get('original_filename', ''),
            'confidence': 'high',  # Direct citations are high confidence
            'method': citation.get('method', 'direct-id-extraction'),
            'block_content': None,  # Not used in direct citation system
            'verification': None,  # Not used in direct citation system
            'matched_block_content': None  # Not used in direct citation system
        }
        frontend_citations.append(frontend_citation)
    
    return frontend_citations


def validate_citations(
    citations: List[Dict[str, Any]], 
    short_id_lookup: Dict[str, Dict[str, Any]]
) -> bool:
    """
    Validate that all citations have valid short IDs in the lookup dictionary.
    
    Args:
        citations: List of citation dictionaries
        short_id_lookup: Dictionary mapping short_id -> full chunk metadata
    
    Returns:
        True if all citations are valid, False otherwise
    """
    if not citations:
        return True
    
    for citation in citations:
        short_id = citation.get('short_id')
        if not short_id or short_id not in short_id_lookup:
            logger.warning(f"Invalid citation: short_id '{short_id}' not found in lookup")
            return False
    
    return True


def extract_key_facts_from_text(text: str) -> List[Dict[str, Any]]:
    """
    Extract key facts (values, dates, names, amounts) from text.
    
    Only extracts distinct, high-value facts. Avoids generic patterns that create duplicates.
    
    Returns:
        List of facts with {'text': str, 'confidence': str, 'type': str, 'match_start': int, 'match_end': int}
    """
    facts = []
    seen_matches = set()  # Track match positions to avoid overlaps
    
    # Extract monetary values - ONLY specific patterns (no generic amounts)
    value_patterns = [
        (r'Market Value[:\s]+£?([\d,]+\.?\d*)', 'Market Value', 40),
        (r'90[- ]day[:\s]+value[:\s]+£?([\d,]+\.?\d*)', '90-day value', 40),
        (r'180[- ]day[:\s]+value[:\s]+£?([\d,]+\.?\d*)', '180-day value', 40),
        (r'Market Rent[:\s]+£?([\d,]+\.?\d*)', 'Market Rent', 40),
        (r'rent[:\s]+£?([\d,]+\.?\d*)\s*(?:per\s+)?(?:calendar\s+)?month', 'Monthly Rent', 50),
        (r'KSH\s+([\d,]+\.?\d*)', 'KSH Amount', 30),  # Kenyan Shillings
        (r'KSHS\s+([\d,]+\.?\d*)', 'KSHS Amount', 30),
    ]
    
    for pattern, label, context_size in value_patterns:
        matches = list(re.finditer(pattern, text, re.IGNORECASE))
        for match in matches:
            match_key = (match.start(), match.end())
            # Skip if this position was already matched
            if any(start <= match.start() < end or start < match.end() <= end 
                   for start, end in seen_matches):
                continue
            
            seen_matches.add(match_key)
            # Get context
            start = max(0, match.start() - context_size)
            end = min(len(text), match.end() + context_size)
            context = text[start:end].strip()
            
            facts.append({
                'text': context,
                'confidence': 'high',
                'type': 'value',
                'label': label,
                'match_start': match.start(),
                'match_end': match.end()
            })
    
    # Extract dates - ONLY specific date patterns
    date_patterns = [
        (r'Valuation date[:\s]+(\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4})', 'Valuation date', 30),
        (r'(\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4})', 'Date', 20),  # Generic date (but only if not already matched)
    ]
    
    for pattern, label, context_size in date_patterns:
        matches = list(re.finditer(pattern, text, re.IGNORECASE))
        for match in matches:
            match_key = (match.start(), match.end())
            # Skip if this position was already matched
            if any(start <= match.start() < end or start < match.end() <= end 
                   for start, end in seen_matches):
                continue
            
            seen_matches.add(match_key)
            start = max(0, match.start() - context_size)
            end = min(len(text), match.end() + context_size)
            context = text[start:end].strip()
            
            facts.append({
                'text': context,
                'confidence': 'high',
                'type': 'date',
                'label': label,
                'match_start': match.start(),
                'match_end': match.end()
            })
    
    # Extract names - ONLY specific name patterns
    name_patterns = [
        (r'Valuer[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+(?:\s+MRICS)?)', 'Valuer', 20),
        (r'conducted by[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+(?:\s+MRICS)?)', 'Conducted by', 20),
    ]
    
    for pattern, label, context_size in name_patterns:
        matches = list(re.finditer(pattern, text, re.IGNORECASE))
        for match in matches:
            match_key = (match.start(), match.end())
            # Skip if this position was already matched
            if any(start <= match.start() < end or start < match.end() <= end 
                   for start, end in seen_matches):
                continue
            
            seen_matches.add(match_key)
            start = max(0, match.start() - context_size)
            end = min(len(text), match.end() + context_size)
            context = text[start:end].strip()
            
            facts.append({
                'text': context,
                'confidence': 'high',
                'type': 'name',
                'label': label,
                'match_start': match.start(),
                'match_end': match.end()
            })
    
    # Sort by match position to maintain order
    facts.sort(key=lambda x: x.get('match_start', 0))
    
    return facts


# ============================================================================
# Evidence-First Citation Architecture Functions
# MOVED TO: backend.llm.citation modules
# ============================================================================

# All citation functions have been moved to:
# - backend.llm.citation.document_store
# - backend.llm.citation.evidence_extractor
# - backend.llm.citation.evidence_registry
# - backend.llm.citation.citation_mapper

# All citation functions have been moved to backend.llm.citation modules
# Functions removed:
# - fetch_chunk_blocks -> backend.llm.citation.document_store
# - extract_atomic_facts_from_block -> backend.llm.citation.evidence_extractor
# - extract_clause_evidence_from_block -> backend.llm.citation.evidence_extractor
# - extract_evidence_blocks_from_chunks -> backend.llm.citation.evidence_extractor
# - deduplicate_evidence_blocks -> backend.llm.citation.evidence_registry
# - rank_evidence_by_relevance -> backend.llm.citation.evidence_registry
# - create_evidence_registry -> backend.llm.citation.evidence_registry
# - format_evidence_table_for_llm -> backend.llm.citation.evidence_registry
# - extract_citations_from_answer_text -> backend.llm.citation.citation_mapper
# - map_citation_numbers_to_citations -> backend.llm.citation.citation_mapper
# - deduplicate_and_renumber_citations -> backend.llm.citation.citation_mapper


# ============================================================================
# Phase 4: Two-Pass Answer Generation
# ============================================================================

async def generate_evidence_selection(
    user_query: str,
    evidence_table: str,
    citation_num_to_evidence_id: Dict[int, str]
) -> EvidenceSelectionOutput:
    """
    Pass 1: Machine-like evidence selection.
    
    Token budget: ~500 tokens per call
    - System prompt: ~200 tokens
    - Human message: ~300 tokens (query + evidence table)
    
    LLM task:
    - Parse user query
    - Match query parts to evidence items
    - Return structured claims with citations
    
    NO prose. NO Markdown. NO creativity.
    """
    # Concise system prompt (~200 tokens)
    system_prompt_content = """You are a fact-mapping system. Match user questions to evidence.

**INPUT:**
- User question
- Evidence table with citations [1], [2], [3]...

**OUTPUT:**
- Structured JSON: claims + citations
- NO prose, NO Markdown

**RULES:**
1. For each question part, identify supporting evidence
2. Create one claim per fact
3. List citation numbers for each claim
4. If question asks about something NOT in evidence, add to unsupported_claims
5. Do NOT write prose - only structured claims

**EXAMPLE:**
Question: "What is the rent and when is it due?"
Output: {
  "facts": [
    {"claim": "Monthly rent amount", "citations": [1]},
    {"claim": "Rent due date", "citations": [2]}
  ],
  "unsupported_claims": []
}"""

    # Concise human message (~300 tokens)
    human_message_content = f"""Question: {user_query}

Evidence:
{evidence_table}

Map question to evidence. Return structured claims with citations."""

    # Create LLM with structured output
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,  # Deterministic
    )
    
    structured_llm = llm.with_structured_output(EvidenceSelectionOutput)
    
    # Invoke
    response = await structured_llm.ainvoke([
        SystemMessage(content=system_prompt_content),
        HumanMessage(content=human_message_content)
    ])
    
    return response

# All citation functions have been moved to backend.llm.citation modules
# These duplicate definitions have been removed - use imports from citation module instead


# Removed duplicate functions - now imported from backend.llm.citation:
# - extract_clause_evidence_from_block
# - extract_evidence_blocks_from_chunks
# - deduplicate_evidence_blocks
# - rank_evidence_by_relevance
# - create_evidence_registry
# - format_evidence_table_for_llm
# All these functions are now imported from backend.llm.citation module above


# ============================================================================
# Phase 4: Two-Pass Answer Generation
# ============================================================================

# Removed duplicate functions - now imported from backend.llm.citation:
# - deduplicate_evidence_blocks
# - rank_evidence_by_relevance
# - create_evidence_registry  
# - format_evidence_table_for_llm


# ============================================================================
# Phase 4: Two-Pass Answer Generation
# ============================================================================

async def generate_evidence_selection(
    user_query: str,
    evidence_table: str,
    citation_num_to_evidence_id: Dict[int, str]
) -> EvidenceSelectionOutput:
    """
    Pass 1: Machine-like evidence selection.
    
    Token budget: ~500 tokens per call
    - System prompt: ~200 tokens
    - Human message: ~300 tokens (query + evidence table)
    
    LLM task:
    - Parse user query
    - Match query parts to evidence items
    - Return structured claims with citations
    
    NO prose. NO Markdown. NO creativity.
    """
    # Concise system prompt (~200 tokens)
    system_prompt_content = """You are a fact-mapping system. Match user questions to evidence.

**INPUT:**
- User question
- Evidence table with citations [1], [2], [3]...

**OUTPUT:**
- Structured JSON: claims + citations
- NO prose, NO Markdown

**RULES:**
1. For each question part, identify supporting evidence
2. Create one claim per fact
3. List citation numbers for each claim
4. If question asks about something NOT in evidence, add to unsupported_claims
5. Do NOT write prose - only structured claims

**EXAMPLE:**
Question: "What is the rent and when is it due?"
Output: {
  "facts": [
    {"claim": "Monthly rent amount", "citations": [1]},
    {"claim": "Rent due date", "citations": [2]}
  ],
  "unsupported_claims": []
}"""

    # Concise human message (~300 tokens)
    human_message_content = f"""Question: {user_query}

Evidence:
{evidence_table}

Map question to evidence. Return structured claims with citations."""

    # Create LLM with structured output
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,  # Deterministic
    )
    
    structured_llm = llm.with_structured_output(EvidenceSelectionOutput)
    
    # Invoke
    response = await structured_llm.ainvoke([
        SystemMessage(content=system_prompt_content),
        HumanMessage(content=human_message_content)
    ])
    
    return response


async def generate_natural_language_answer(
    user_query: str,
    evidence_selection: EvidenceSelectionOutput,
    evidence_table: str
) -> NaturalLanguageOutput:
    """
    Pass 2: Natural language rendering.
    
    Token budget: ~1100 tokens per call
    - System prompt: ~300 tokens
    - Human message: ~800 tokens (query + claims + evidence ref)
    
    LLM task:
    - Convert structured claims into conversational prose
    - Embed citation numbers naturally
    - Format with Markdown
    
    DO NOT add or remove facts.
    """
    # Format claims for prompt (~500 tokens max for 10 claims)
    claims_text = "\n".join([
        f"- {claim.claim} [citations: {', '.join(map(str, claim.citations))}]"
        for claim in evidence_selection.facts
    ])
    
    # System prompt (~300 tokens)
    system_prompt_content = """You are a natural language renderer. Convert structured claims into conversational prose.

**INPUT:**
- User question
- Structured claims with citations (from Pass 1)
- Evidence table (for reference only)

**OUTPUT:**
- Conversational answer with citations embedded
- Markdown formatting
- Professional tone

**CRITICAL RULES:**
1. Use EXACTLY the claims provided - do NOT add facts
2. Do NOT remove any claims
3. Embed citations naturally: [1], [2], [3]
4. Use Markdown for structure
5. Minimum 2-3 sentences with context

**EXAMPLE:**
Claims:
- Monthly rent amount [citations: 1]
- Rent due date [citations: 2]

Answer: 'The monthly rent is **[AMOUNT]** [1], which is payable monthly in advance before the 5th day of each month [2].'"""

    # Human message (~800 tokens)
    human_message_content = f"""Question: {user_query}

Claims to render:
{claims_text}

Evidence reference:
{evidence_table}

Convert claims into conversational answer. Use Markdown. Do NOT add or remove facts."""

    # Create LLM with structured output
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0.3,  # Slight creativity for prose
    )
    
    structured_llm = llm.with_structured_output(NaturalLanguageOutput)
    
    # Invoke
    response = await structured_llm.ainvoke([
        SystemMessage(content=system_prompt_content),
        HumanMessage(content=human_message_content)
    ])
    
    return response


# ============================================================================
# Phase 4: Structured LLM Output with Evidence IDs (Legacy - Single-Pass)
# ============================================================================

async def generate_answer_with_evidence_ids(
    user_query: str,
    chunks_metadata: List[Dict[str, Any]],
    evidence_registry: Dict[str, EvidenceBlock],
    request_id: str,
    evidence_table: str,
    citation_num_to_evidence_id: Dict[int, str]
) -> Dict[str, Any]:
    """
    Generate answer with citation numbers [1], [2], [3] using two-pass approach.
    
    Total token budget: ~1600 tokens
    - Pass 1: ~500 tokens (evidence selection)
    - Pass 2: ~1100 tokens (natural language rendering)
    
    This ensures perfect citation accuracy by separating fact selection from prose generation.
    
    Args:
        user_query: User's question
        chunks_metadata: List of chunks with chunk_id, chunk_text, document_id
        evidence_registry: Dict mapping evidence_id -> EvidenceBlock
        request_id: UUID for request-scoped evidence IDs
        evidence_table: Pre-formatted evidence table string with citation numbers
        citation_num_to_evidence_id: Dict mapping citation_number (1, 2, 3...) -> evidence_id
        
    Returns:
        Dict with 'answer', 'citations', and 'unsupported_claims' keys:
        {
            "answer": str,  # Answer text with citation numbers embedded (e.g., "The value is [AMOUNT] [1]")
            "citations": List[int]  # Array of citation numbers used (e.g., [1, 2, 3])
            "unsupported_claims": List[str]  # Claims user asked about with no supporting evidence
        }
    """
    # Pass 1: Evidence selection (~500 tokens)
    logger.info("[EVIDENCE] Pass 1: Evidence selection...")
    evidence_selection = await generate_evidence_selection(
        user_query,
        evidence_table,
        citation_num_to_evidence_id
    )
    
    # Validate: Check for hallucinations
    if evidence_selection.unsupported_claims:
        logger.warning(
            f"[EVIDENCE] ⚠️ Unsupported claims detected: {evidence_selection.unsupported_claims}"
        )
    
    # Pass 2: Natural language rendering (~1100 tokens)
    logger.info("[EVIDENCE] Pass 2: Natural language rendering...")
    natural_language = await generate_natural_language_answer(
        user_query,
        evidence_selection,
        evidence_table
    )
    
    return {
        "answer": natural_language.answer,
        "citations": natural_language.citations,  # List[int]
        "unsupported_claims": evidence_selection.unsupported_claims
    }


# All citation mapping functions moved to backend.llm.citation.citation_mapper

def map_evidence_ids_to_citations(
    llm_output: Dict[str, Any],
    evidence_registry: Dict[str, EvidenceBlock],
    request_id: str
) -> Tuple[List[Citation], Dict[str, int]]:
    """
    Map evidence IDs from LLM output to Citation objects.
    
    Args:
        llm_output: Dict with 'answer' and 'citations' keys
        evidence_registry: Dict mapping evidence_id -> EvidenceBlock
        request_id: UUID for constructing full evidence IDs
        
    Returns:
        Tuple of:
        - List of Citation objects with exact bbox coordinates
        - Dict mapping evidence_id (e.g., "E1") -> citation_number (e.g., 1)
    """
    citations = []
    citation_number = 1
    evidence_id_to_citation_num = {}  # Map "E1" -> 1, "E2" -> 2, etc.
    
    evidence_ids = llm_output.get('citations', [])
    if not evidence_ids:
        logger.warning("[EVIDENCE] No citations found in LLM output")
        return citations, evidence_id_to_citation_num
    
    for evidence_id in evidence_ids:
        # Strip any whitespace
        evidence_id = evidence_id.strip()
        
        # Store mapping from evidence_id to citation_number (for text replacement)
        evidence_id_to_citation_num[evidence_id] = citation_number
        
        # Construct full evidence ID with request_id prefix
        if not evidence_id.startswith(request_id):
            # LLM only sees "E1", "E2", etc., so we need to add request_id prefix
            full_evidence_id = f"{request_id}:{evidence_id}"
        else:
            full_evidence_id = evidence_id
        
        # Look up EvidenceBlock in registry
        evidence_block = evidence_registry.get(full_evidence_id)
        
        if not evidence_block:
            logger.warning(
                f"[EVIDENCE] Evidence ID '{evidence_id}' (full: '{full_evidence_id}') not found in registry. "
                f"Available IDs: {list(evidence_registry.keys())[:5]}..."
            )
            continue
        
        # Create Citation object with exact bbox from EvidenceBlock
        citation: Citation = {
            'citation_number': citation_number,
            'chunk_id': evidence_block.chunk_id,
            'block_index': evidence_block.block_index,
            'block_id': None,  # Not used in evidence-id-mapping method
            'cited_text': evidence_block.text_preview,  # Use preview for display
            'bbox': evidence_block.bbox.copy(),  # Exact copy from Parse block
            'page_number': evidence_block.page,
            'doc_id': evidence_block.doc_id,
            'original_filename': None,  # Will be added later
            'confidence': 'high',  # Deterministic mapping
            'method': 'evidence-id-mapping',
            'block_content': evidence_block.exact_text,  # Store exact text for verification
            'verification': None,
            'matched_block_content': evidence_block.exact_text
        }
        
        citations.append(citation)
        citation_number += 1
    
    logger.info(f"[EVIDENCE] Mapped {len(citations)} citations from {len(evidence_ids)} evidence IDs")
    return citations, evidence_id_to_citation_num


def pre_extract_citation_candidates(chunks_metadata: List[Dict[str, Any]]) -> List[Citation]:
    """
    Pre-extract citation candidates from chunks by identifying key facts.
    
    This function:
    1. Iterates through all chunks
    2. Identifies key facts (values, dates, names, amounts, etc.) in each block
    3. Creates citation objects with bbox coordinates immediately
    4. Deduplicates citations from the same block/chunk
    5. Numbers them sequentially
    
    Returns:
        List of pre-created Citation objects with citation_number, chunk_id, 
        block_index, cited_text, bbox, page, doc_id, etc.
    """
    citations: List[Citation] = []
    citation_number = 1
    
    # Track citations by (chunk_id, block_index, cited_text_normalized) to avoid duplicates
    seen_citations = set()
    
    supabase = get_supabase_client()
    
    for chunk in chunks_metadata:
        chunk_id = chunk.get('chunk_id')
        doc_id = chunk.get('document_id')
        
        if not chunk_id or not doc_id:
            continue
        
        try:
            # Fetch chunk blocks from database
            response = supabase.table('document_vectors').select(
                'id, document_id, blocks, page_number, bbox'
            ).eq('id', chunk_id).single().execute()
            
            if not response.data:
                logger.warning(f"[CITATION_PRE_EXTRACT] Chunk {chunk_id[:20]}... not found in database")
                continue
            
            chunk_data = response.data
            blocks = chunk_data.get('blocks', [])
            
            if not blocks:
                # Fallback: create citation from chunk-level bbox
                chunk_bbox = chunk_data.get('bbox', {})
                page = chunk_data.get('page_number', chunk_bbox.get('page', 0))
                
                # Extract key facts from chunk_text using regex/pattern matching
                chunk_text = chunk.get('chunk_text', '')
                facts = extract_key_facts_from_text(chunk_text)
                
                # Limit to max 3 facts per chunk (if no blocks)
                facts = facts[:3]
                
                for fact in facts:
                    # Normalize cited_text for deduplication
                    cited_text_normalized = fact['text'].lower().strip()[:100]  # First 100 chars
                    citation_key = (chunk_id, None, cited_text_normalized)
                    
                    if citation_key in seen_citations:
                        continue
                    
                    seen_citations.add(citation_key)
                    
                    citation: Citation = {
                        'citation_number': citation_number,
                        'chunk_id': chunk_id,
                        'block_id': None,
                        'block_index': None,
                        'cited_text': fact['text'],
                        'bbox': {
                            'left': round(float(chunk_bbox.get('left', 0.0)), 4),
                            'top': round(float(chunk_bbox.get('top', 0.0)), 4),
                            'width': round(float(chunk_bbox.get('width', 0.0)), 4),
                            'height': round(float(chunk_bbox.get('height', 0.0)), 4),
                            'page': int(page) if page is not None else 0
                        },
                        'page_number': int(page) if page is not None else 0,
                        'doc_id': doc_id,
                        'original_filename': None,  # Will be filled later
                        'confidence': 'medium',  # Chunk-level is less precise
                        'method': 'pre-extracted-chunk-level',
                        'block_content': None,
                        'verification': None,
                        'matched_block_content': None
                    }
                    citations.append(citation)
                    citation_number += 1
            else:
                # Extract citations from each block
                for block_index, block in enumerate(blocks):
                    block_content = block.get('content', '')
                    if not block_content:
                        continue
                    
                    # Extract key facts from this block
                    facts = extract_key_facts_from_text(block_content)
                    
                    # Limit to max 2 facts per block to avoid over-citation
                    facts = facts[:2]
                    
                    for fact in facts:
                        # Normalize cited_text for deduplication
                        cited_text_normalized = fact['text'].lower().strip()[:100]  # First 100 chars
                        citation_key = (chunk_id, block_index, cited_text_normalized)
                        
                        if citation_key in seen_citations:
                            continue
                        
                        seen_citations.add(citation_key)
                        
                        block_bbox = block.get('bbox', {})
                        page = block_bbox.get('page', chunk_data.get('page_number', 0))
                        
                        citation: Citation = {
                            'citation_number': citation_number,
                            'chunk_id': chunk_id,
                            'block_id': None,
                            'block_index': block_index,
                            'cited_text': fact['text'],
                            'bbox': {
                                'left': round(float(block_bbox.get('left', 0.0)), 4),
                                'top': round(float(block_bbox.get('top', 0.0)), 4),
                                'width': round(float(block_bbox.get('width', 0.0)), 4),
                                'height': round(float(block_bbox.get('height', 0.0)), 4),
                                'page': int(page) if page is not None else 0
                            },
                            'page_number': int(page) if page is not None else 0,
                            'doc_id': doc_id,
                            'original_filename': None,  # Will be filled later
                            'matched_block_content': block_content,
                            'confidence': fact.get('confidence', 'high'),
                            'method': 'pre-extracted-block-level',
                            'block_content': None,
                            'verification': None
                        }
                        citations.append(citation)
                        citation_number += 1
                        
        except Exception as e:
            logger.error(f"[CITATION_PRE_EXTRACT] Error extracting citations from chunk {chunk_id[:20] if chunk_id else 'UNKNOWN'}...: {e}", exc_info=True)
            continue
    
    logger.info(f"[CITATION_PRE_EXTRACT] ✅ Pre-extracted {len(citations)} distinct citation candidates (deduplicated)")
    return citations


def format_pre_created_citations(citations: List[Citation]) -> str:
    """
    Format pre-created citations for LLM to reference.
    
    Returns:
        Formatted string showing available citations with their numbers
    """
    if not citations:
        return ""
    
    citation_lines = []
    citation_lines.append("**Available Citations (use citation numbers in your answer):**\n")
    
    for citation in citations:
        citation_num = citation.get('citation_number', 0)
        cited_text = citation.get('cited_text', '')
        # Truncate for display but keep enough context
        if len(cited_text) > 100:
            cited_text = cited_text[:100] + "..."
        
        citation_lines.append(f"[{citation_num}] {cited_text}")
    
    return "\n".join(citation_lines)


async def generate_conversational_answer_with_citations(
    user_query: str,
    chunks_metadata: List[Dict[str, Any]]
) -> Tuple[str, List]:
    """
    Generate conversational answer with citation tool access.
    
    This function:
    - Formats chunks with chunk_ids visible to LLM
    - Gives LLM access to match_citation_to_chunk tool
    - LLM calls tool with exact text from chunks
    - Extracts citations from tool calls
    
    Args:
        user_query: User's question
        chunks_metadata: List of chunks with chunk_id, chunk_text, document_id
    
    Returns:
        Tuple of (answer_text, citations_list)
    """
    # NOTE: This is a fallback function using tool-based citations
    # Raw chunk text removed - LLM will use citation tool based on question
    # This function is used when evidence extraction fails
    # System prompt - reuse existing prompt but add citation instructions
    system_prompt_content = """
You are an expert analytical assistant for professional documents. Your role is to help users understand information clearly, accurately, and neutrally based solely on the content provided.

# FORMATTING RULES

1. **Response Style**: Use clean Markdown. Use bolding for key terms and bullet points for lists to ensure scannability.

2. **List Formatting**: When creating numbered lists (1., 2., 3.) or bullet lists (-, -, -), keep all items on consecutive lines without blank lines between them. Blank lines between list items will break the list into separate lists.

   **CORRECT:**
   ```
   1. First item
   2. Second item
   3. Third item
   ```

   **WRONG:**
   ```
   1. First item

   2. Second item

   3. Third item
   ```

3. **Markdown Features**: 
   - Use `##` for main sections, `###` for subsections
   - Use `**bold**` for emphasis or labels
   - Use `-` for bullet points, `1.` for numbered lists
   - Use blank lines between sections (not between list items)

4. **No Hallucination**: If the answer is not contained within the provided excerpts, state: "I cannot find the specific information in the uploaded documents." Do not use outside knowledge.

# CITATION WORKFLOW

**SIMPLE RULE: Any information you use from chunks MUST be cited.**

Whether it's a fact, explanation, definition, or any other type of information - if it comes from a chunk, it needs a citation.

When you use information from chunks in your answer:
1. Use the EXACT text from the chunk (shown in [CHUNK_ID: ...] blocks)
2. For ANY information you use from a chunk, call match_citation_to_chunk with:
   - chunk_id: The CHUNK_ID from the chunk you're citing
   - cited_text: The EXACT text from that chunk (not a paraphrase)
3. Call this tool for EVERY piece of information you mention that comes from chunks
4. **CRITICAL**: After calling match_citation_to_chunk, include citation numbers in your answer text using [1], [2], [3] format
   - Example: "The offer value is [AMOUNT] [1]. This represents the purchase price [1]. The deposit amount is [AMOUNT] [2]."
   - Each citation number corresponds to a match_citation_to_chunk tool call you made
   - Number them sequentially: [1], [2], [3], etc.

**IMPORTANT:**
- Use the original text from chunks, not your paraphrased version
- Call match_citation_to_chunk BEFORE finishing your answer
- **Include citation numbers immediately after each piece of information from chunks** - place [1], [2], [3] right after the information within the same sentence or paragraph
- Example: "The property value is [AMOUNT] [1]. The lease term is one year [2]. The monthly rent is [AMOUNT] [3]."
- **DO NOT** wait until the end of your answer to include citations - they must appear inline with the information

# TONE & STYLE

- Be direct and professional.
- Avoid phrases like "Based on the documents provided..." or "According to chunk 1...". Just provide the answer.
- Do not mention document names, filenames, IDs, or retrieval steps.
- Do not reference "documents", "files", "chunks", "tools", or "searches".
- Speak as if the information is simply *known*, not retrieved.

# EXTRACTING INFORMATION

The excerpts provided ARE the source of truth. When the user asks a question:
1. Carefully read through ALL the excerpts provided
2. If the answer IS present, extract and present it directly
3. If the answer is NOT present, only then say it's not found

**DO NOT say "the excerpts do not contain" if the information IS actually in the excerpts.**
**DO NOT be overly cautious - if you see the information, extract and present it.**

When information IS in the excerpts:
- Extract specific details (names, values, dates, etc.)
- Present them clearly and directly
- Use the exact information from the excerpts
- Format it in a scannable way
- **Call match_citation_to_chunk for ANY information you use from chunks** - facts, explanations, definitions, everything

When information is NOT in the excerpts:
- State: "I cannot find the specific information in the uploaded documents."
- Provide helpful context about what type of information would answer the question
"""
    
    system_prompt = SystemMessage(content=system_prompt_content)
    
    # Create citation tool
    citation_tool = create_chunk_citation_tool()
    
    # Create LLM with citation tool
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    ).bind_tools([citation_tool], tool_choice="auto")
    
    # NOTE: Raw chunk text removed - LLM will use citation tool based on question and chunks_metadata
    # This fallback function is used when evidence extraction fails
    # The citation tool has access to chunk data internally
    human_message = HumanMessage(content=f"""User question: {user_query}

⚠️ IMPORTANT: 
- Answer the user's question using the citation tool to cite information from chunks
- **ANY information you use from chunks MUST be cited** - whether it's a fact, explanation, definition, or any other type of information
- For EVERY piece of information you mention that comes from chunks, call match_citation_to_chunk
- The citation tool will search chunks for the exact text you provide
- Call match_citation_to_chunk BEFORE finishing your answer
- **CRITICAL**: Include citation numbers [1], [2], [3] immediately after each piece of information from chunks - place them inline, not at the end
  * Example: "The property value is [AMOUNT] [1]. This represents the purchase price [1]. The deposit amount is [AMOUNT] [2]."
  * Number citations sequentially starting from [1]
  * **DO NOT** put all citations at the end - each citation must appear right after its corresponding information

Provide a helpful, conversational answer using Markdown formatting:
- Use `##` for main section headings, `###` for subsections
- Use `**bold**` for emphasis or labels
- Use `-` for bullet points when listing items
- Use line breaks between sections for better readability
- Extract and present information directly from the excerpts if it is present
- Only say information is not found if it is genuinely not in the excerpts
- Include appropriate context based on question type
- Is professional and polite
- Never mentions documents, files, or retrieval steps

Answer (use Markdown formatting for structure and clarity):""")
    
    # Invoke LLM
    logger.info(f"[RESPONDER] Invoking LLM with {len(chunks_metadata)} chunks (with citation tool)")
    response = await llm.ainvoke([system_prompt, human_message])
    
    # Extract answer text
    answer_text = response.content if hasattr(response, 'content') and response.content else ""
    
    # Initialize messages list for tool execution
    messages = [system_prompt, human_message, response]
    citations = []
    
    # If LLM made tool calls, execute them
    if hasattr(response, 'tool_calls') and response.tool_calls:
        logger.info(f"[RESPONDER] LLM made {len(response.tool_calls)} tool call(s) for citations")
        
        # Execute tool calls using ToolNode
        tool_node = ToolNode([citation_tool])
        tool_state = {"messages": messages}
        tool_result = await tool_node.ainvoke(tool_state)
        
        # Add tool results to messages
        if "messages" in tool_result:
            messages.extend(tool_result["messages"])
        
        # Extract citations from tool results
        citations = extract_chunk_citations_from_messages(messages)
        if citations:
            logger.info(f"[RESPONDER] ✅ Extracted {len(citations)} citations from tool calls")
            for i, citation in enumerate(citations, 1):
                logger.debug(
                    f"[RESPONDER] Citation {i}: chunk_id={citation.get('chunk_id', '')[:20]}..., "
                    f"page={citation.get('page_number', 0)}, confidence={citation.get('confidence', 'low')}"
                )
    
    # If no answer text but we have tool calls, we might need to continue the conversation
    if not answer_text and hasattr(response, 'tool_calls') and response.tool_calls:
        # LLM made tool calls but no text - continue to get answer
        logger.info("[RESPONDER] LLM made tool calls but no answer text, continuing conversation...")
        continue_response = await llm.ainvoke(messages)
        answer_text = continue_response.content if hasattr(continue_response, 'content') and continue_response.content else ""
        messages.append(continue_response)
        
        # Check for more tool calls
        if hasattr(continue_response, 'tool_calls') and continue_response.tool_calls:
            tool_node = ToolNode([citation_tool])
            tool_state = {"messages": messages}
            tool_result = await tool_node.ainvoke(tool_state)
            if "messages" in tool_result:
                messages.extend(tool_result["messages"])
            citations = extract_chunk_citations_from_messages(messages)
    
    return answer_text, citations


async def generate_conversational_answer_with_pre_citations(
    user_query: str,
    chunks_metadata: List[Dict[str, Any]],
    pre_created_citations: List[Citation]
) -> Tuple[str, List[Citation]]:
    """
    Generate answer with pre-created citations.
    
    LLM just references citation numbers [1], [2], [3] - no tool calling needed.
    
    Args:
        user_query: User's question
        chunks_metadata: List of chunks with chunk_id, chunk_text, document_id
        pre_created_citations: Pre-extracted citations with citation numbers
    
    Returns:
        Tuple of (answer_text, citations_list)
    """
    # NOTE: Raw chunk text removed - using pre-created citations only
    # This fallback function is used when evidence extraction fails
    # Format pre-created citations
    citations_display = format_pre_created_citations(pre_created_citations)
    
    system_prompt_content = """
You are an expert analytical assistant for professional documents. Your role is to help users understand information clearly, accurately, and neutrally based solely on the content provided.

# FORMATTING RULES

1. **Response Style**: Use clean Markdown. Use bolding for key terms and bullet points for lists to ensure scannability.

2. **List Formatting**: When creating numbered lists (1., 2., 3.) or bullet lists (-, -, -), keep all items on consecutive lines without blank lines between them. Blank lines between list items will break the list into separate lists.

   **CORRECT:**
   ```
   1. First item
   2. Second item
   3. Third item
   ```

   **WRONG:**
   ```
   1. First item

   2. Second item

   3. Third item
   ```

3. **Markdown Features**: 
   - Use `##` for main sections, `###` for subsections
   - Use `**bold**` for emphasis or labels
   - Use `-` for bullet points, `1.` for numbered lists
   - Use blank lines between sections (not between list items)

4. **No Hallucination**: If the answer is not contained within the provided excerpts, state: "I cannot find the specific information in the uploaded documents." Do not use outside knowledge.

# CITATION WORKFLOW

**SIMPLE RULE: Any information you use from chunks MUST be cited.**

Whether it's a fact, explanation, definition, or any other type of information - if it comes from a chunk, it needs a citation.

You have been provided with pre-created citations below. These citations are already mapped to exact locations in the documents.

**HOW TO USE CITATIONS:**
1. When you use ANY information that matches a citation, use the citation number: [1], [2], [3], etc.
2. The citation numbers correspond to the pre-created citations shown below
3. **DO NOT** call any citation tools - citations are already created
4. Simply include citation numbers in your answer where you reference information from chunks
5. Place citation numbers immediately after the information you're citing

**EXAMPLE:**
If citation [1] is "Market Value: [AMOUNT]" and citation [2] is "Valuation date: [DATE]",
your answer might be:
"The property has a Market Value of [AMOUNT] [1]. This represents the purchase price [1] as of [DATE] [2]."

**IMPORTANT:**
- Use citation numbers [1], [2], [3] when you reference ANY information from chunks - facts, explanations, definitions, everything
- Do NOT call any tools - citations are pre-created
- Include citation numbers immediately after the information you're citing
- Each citation number corresponds to a pre-created citation shown below

# TONE & STYLE

- Be direct and professional.
- Avoid phrases like "Based on the documents provided..." or "According to chunk 1...". Just provide the answer.
- Do not mention document names, filenames, IDs, or retrieval steps.
- Do not reference "documents", "files", "chunks", "tools", or "searches".
- Speak as if the information is simply *known*, not retrieved.

# EXTRACTING INFORMATION

The excerpts provided ARE the source of truth. When the user asks a question:
1. Carefully read through ALL the excerpts provided
2. If the answer IS present, extract and present it directly
3. If the answer is NOT present, only then say it's not found

**DO NOT say "the excerpts do not contain" if the information IS actually in the excerpts.**
**DO NOT be overly cautious - if you see the information, extract and present it.**

When information IS in the excerpts:
- Extract specific details (names, values, dates, etc.)
- Present them clearly and directly
- Use the exact information from the excerpts
- Format it in a scannable way
- **Use citation numbers [1], [2], [3] when referencing ANY information from chunks** - facts, explanations, definitions, everything

When information is NOT in the excerpts:
- State: "I cannot find the specific information in the uploaded documents."
- Provide helpful context about what type of information would answer the question
"""
    
    system_prompt = SystemMessage(content=system_prompt_content)
    
    # Create LLM WITHOUT citation tool (not needed - citations are pre-created)
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )
    
    # NOTE: Raw chunk text removed - using pre-created citations only
    # This fallback function is used when evidence extraction fails
    human_message = HumanMessage(content=f"""User question: {user_query}

{citations_display}

⚠️ IMPORTANT: 
- **ANY information you use from chunks MUST be cited** - whether it's a fact, explanation, definition, or any other type of information
- Use the citation numbers [1], [2], [3] shown above when you reference ANY information from chunks
- Do NOT call any tools - citations are pre-created
- Include citation numbers immediately after the information you're citing
- Example: "The property value is [AMOUNT] [1]. This represents the purchase price [1] located at [ADDRESS] [2]."

Provide a helpful, conversational answer using Markdown formatting:
- Use `##` for main section headings, `###` for subsections
- Use `**bold**` for emphasis or labels
- Use `-` for bullet points when listing items
- Use line breaks between sections for better readability
- Extract and present information directly from the excerpts if it is present
- Only say information is not found if it is genuinely not in the excerpts
- Include appropriate context based on question type
- Is professional and polite
- Never mentions documents, files, or retrieval steps

Answer (use Markdown formatting for structure and clarity):""")
    
    # Invoke LLM
    logger.info(f"[RESPONDER] Invoking LLM with {len(chunks_metadata)} chunks and {len(pre_created_citations)} pre-created citations")
    response = await llm.ainvoke([system_prompt, human_message])
    
    # Extract answer text
    answer_text = response.content if hasattr(response, 'content') and response.content else ""
    
    # Return answer and pre-created citations (already numbered)
    return answer_text, pre_created_citations


async def generate_conversational_answer_with_citations(
    user_query: str,
    formatted_chunks: str
) -> str:
    """
    Generate conversational answer with citation instructions.
    
    This version includes instructions for the LLM to use [ID: X] format for citations.
    The LLM should cite sources using short IDs (1, 2, 3) that correspond to the [SOURCE_ID: X] labels.
    
    Args:
        user_query: User's question
        formatted_chunks: Chunks formatted with [SOURCE_ID: X] labels
    
    Returns:
        LLM response with [ID: X] citations embedded
    """
    llm = ChatOpenAI(
        model=config.openai_model,
        temperature=0.3,
        max_tokens=2000
    )
    
    system_prompt = SystemMessage(content="""
You are an expert analytical assistant for professional documents. Your role is to help users understand information clearly, accurately, and neutrally based solely on the content provided.

# FORMATTING RULES

1. **Response Style**: Use clean Markdown. Use bolding for key terms and bullet points for lists to ensure scannability.

2. **List Formatting**: When creating numbered lists (1., 2., 3.) or bullet lists (-, -, -), keep all items on consecutive lines without blank lines between them. Blank lines between list items will break the list into separate lists.

   **CORRECT:**
   ```
   1. First item
   2. Second item
   3. Third item
   ```

   **WRONG:**
   ```
   1. First item

   2. Second item

   3. Third item
   ```

3. **Markdown Features**: 
   - Use `##` for main sections, `###` for subsections
   - Use `**bold**` for emphasis or labels
   - Use `-` for bullet points, `1.` for numbered lists
   - Use blank lines between sections (not between list items)

4. **No Hallucination**: If the answer is not contained within the provided excerpts, state: "I cannot find the specific information in the uploaded documents." Do not use outside knowledge.

# CITATION INSTRUCTIONS (CRITICAL)

**SIMPLE RULE: Any information you use from excerpts MUST be cited.**

Whether it's a fact, explanation, definition, or any other type of information - if it comes from an excerpt, it needs a citation.

You have been provided with document excerpts labeled with source IDs:
- [SOURCE_ID: 1] - First excerpt
- [SOURCE_ID: 2] - Second excerpt
- [SOURCE_ID: 3] - Third excerpt
- etc.

**HOW TO CITE SOURCES:**

When you use ANY information from a specific excerpt, you MUST include a citation using the format:
[ID: X]

Where X is the SOURCE_ID number (1, 2, 3, etc.) that corresponds to the excerpt you're referencing.

**EXAMPLES:**
- "The property has a Market Value of £500,000 [ID: 1]. This represents the purchase price [ID: 1]."
- "The rent is £2,000 per month [ID: 2]. This is payable in advance [ID: 2]."
- "The valuation date is 15th March 2024 [ID: 1], and the property address is 123 Main Street [ID: 3]."

**RULES:**
1. **ALWAYS cite when using ANY information from excerpts** - facts, explanations, definitions, everything
2. **Place citations immediately after the information you're citing** (e.g., "£500,000 [ID: 1]")
3. **Use the exact SOURCE_ID number** from the [SOURCE_ID: X] label
4. **You can cite the same source multiple times** if you reference different information from it
5. **If you're synthesizing information from multiple sources, cite all relevant sources**

**IMPORTANT:**
- Do NOT use [1], [2], [3] - use [ID: 1], [ID: 2], [ID: 3]
- Do NOT invent citations - only cite sources that were actually provided
- Do NOT cite sources for general knowledge or your own analysis

# TONE & STYLE

- Be direct and professional.
- Avoid phrases like "Based on the documents provided..." or "According to chunk 1...". Just provide the answer.
- Do not mention document names, filenames, IDs, or retrieval steps.
- Do not reference "documents", "files", "chunks", "tools", or "searches".
- Speak as if the information is simply *known*, but cite sources for transparency.

Answer (use Markdown formatting for structure and clarity, and include [ID: X] citations where appropriate):""")
    
    human_message = HumanMessage(content=f"""
**User Question:**
{user_query}

**Relevant Excerpts from Documents:**

{formatted_chunks}

**Instructions:**
- Answer the user's question based on the excerpts provided above
- Include [ID: X] citations when referencing specific facts from the excerpts
- Use Markdown formatting for clarity
- Be concise, accurate, and helpful
""")
    
    logger.info(f"[RESPONDER] Invoking LLM with citation instructions for {len(formatted_chunks.split('[SOURCE_ID:')) - 1} chunks")
    response = await llm.ainvoke([system_prompt, human_message])
    
    answer_text = response.content if hasattr(response, 'content') and response.content else ""
    return answer_text


async def generate_answer_with_direct_citations(
    user_query: str,
    execution_results: list[Dict[str, Any]]
) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Generate answer using direct citation system with short IDs.
    
    Flow:
    1. Extract chunks with metadata
    2. Format chunks with short IDs (1, 2, 3) and create lookup dictionary
    3. Generate LLM response (LLM includes [ID: 1] in text)
    4. Extract short IDs from response with positions
    5. Map short IDs to full chunk metadata (UUID, bbox, page_number)
    6. Replace [ID: 1] with [1], [ID: 2] with [2], etc. (safe position-based replacement)
    7. Format citations for frontend
    8. Return formatted answer and citations
    
    Args:
        user_query: User's question
        execution_results: Execution results from executor node
    
    Returns:
        Tuple of (formatted_answer, citations_list)
    """
    try:
        # Step 1: Extract chunks with metadata
        chunks_metadata = extract_chunks_with_metadata(execution_results)
        
        if not chunks_metadata:
            logger.warning("[DIRECT_CITATIONS] No chunks found in execution results")
            return "No relevant information found.", []
        
        logger.info(f"[DIRECT_CITATIONS] Extracted {len(chunks_metadata)} chunks with metadata")
        
        # Step 2: Format chunks with short IDs and create lookup
        formatted_chunks, short_id_lookup = format_chunks_with_short_ids(chunks_metadata)
        logger.info(f"[DIRECT_CITATIONS] Formatted chunks with short IDs: {list(short_id_lookup.keys())}")
        
        # Step 3: Generate LLM response (LLM will include [ID: 1], [ID: 2], etc.)
        logger.info(f"[DIRECT_CITATIONS] Generating LLM response with citation instructions...")
        llm_response = await generate_conversational_answer_with_citations(user_query, formatted_chunks)
        logger.info(f"[DIRECT_CITATIONS] LLM response generated ({len(llm_response)} chars)")
        
        # Step 4: Extract citations from response (maps short IDs to full metadata)
        citations = extract_citations_with_positions(llm_response, short_id_lookup)
        logger.info(f"[DIRECT_CITATIONS] Extracted {len(citations)} citations from response")
        
        # Step 5: Validate citations
        if not validate_citations(citations, short_id_lookup):
            logger.warning("[DIRECT_CITATIONS] Some citations failed validation, continuing anyway...")
        
        # Step 6: Replace [ID: 1] with [1], [ID: 2] with [2], etc. (safe replacement)
        formatted_response = replace_ids_with_citation_numbers(llm_response, citations)
        logger.info(f"[DIRECT_CITATIONS] Replaced citation IDs with numbers")
        
        # Step 7: Format citations for frontend
        frontend_citations = format_citations_for_frontend(citations)
        logger.info(f"[DIRECT_CITATIONS] Formatted {len(frontend_citations)} citations for frontend")
        
        return formatted_response, frontend_citations
        
    except Exception as e:
        logger.error(f"[DIRECT_CITATIONS] Error in citation generation: {e}", exc_info=True)
        # Fallback: return answer without citations
        chunks_metadata = extract_chunks_with_metadata(execution_results)
        if chunks_metadata:
            chunk_texts = [chunk.get('chunk_text', '') for chunk in chunks_metadata if chunk.get('chunk_text')]
            formatted_chunk_text = "\n\n---\n\n".join(chunk_texts)
            fallback_answer = await generate_conversational_answer(user_query, formatted_chunk_text)
            return fallback_answer, []
        return "I encountered an error while generating the answer. Please try again.", []


async def responder_node(state: MainWorkflowState, runnable_config=None) -> MainWorkflowState:
    """
    Responder node - generates final answer from execution results.
    
    This node:
    1. Extracts chunk text from execution results
    2. Generates conversational answer using existing logic
    3. Emits completion event
    4. Returns final answer
    
    Args:
        state: MainWorkflowState with execution_results, user_query
        runnable_config: Optional RunnableConfig from LangGraph
        
    Returns:
        Updated state with final_summary
    """
    user_query = state.get("user_query", "")
    execution_results = state.get("execution_results", [])
    emitter = state.get("execution_events")
    if emitter is None:
        logger.warning("[RESPONDER] ⚠️  Emitter is None - reasoning events will not be emitted")
    plan_refinement_count = state.get("plan_refinement_count", 0)
    refinement_limit_reached = plan_refinement_count >= 3
    
    logger.info(f"[RESPONDER] Generating answer from {len(execution_results)} execution results")
    
    # Extract chunks WITH metadata (chunk_id, chunk_text, document_id)
    chunks_metadata = extract_chunks_with_metadata(execution_results)
    has_chunks = len(chunks_metadata) > 0
    
    if has_chunks:
        logger.info(f"[RESPONDER] ✅ Chunks detected ({len(chunks_metadata)} chunks), generating answer with direct citations...")
        
        # Log document sources for debugging
        from collections import defaultdict
        doc_sources = defaultdict(int)
        for chunk in chunks_metadata:
            filename = chunk.get('document_filename', 'unknown')
            doc_sources[filename] += 1
        
        if doc_sources:
            logger.info(f"[RESPONDER] Chunk sources: {dict(doc_sources)}")
        
        # Emit "Analysing" reasoning event BEFORE generating answer
        if emitter:
            emitter.emit_reasoning(
                label="Analysing",
                detail=None
            )
        
        # Generate answer with direct citations
        try:
            logger.info(f"[RESPONDER] Generating answer with direct citation system...")
            formatted_answer, citations = await generate_answer_with_direct_citations(user_query, execution_results)
            
            logger.info(f"[RESPONDER] ✅ Answer generated ({len(formatted_answer)} chars) with {len(citations)} citations")
            
            # Prepare output with citations
            # Set both 'citations' and 'chunk_citations' for compatibility with views.py
            responder_output = {
                "final_summary": formatted_answer,
                "citations": citations if citations else [],
                "chunk_citations": citations if citations else []  # Also set chunk_citations for views.py processing
            }
            
            # Validate output against contract
            try:
                validate_responder_output(responder_output)
            except ValueError as e:
                logger.error(f"[RESPONDER] ❌ Contract violation: {e}")
                raise
            
            return responder_output
            
        except Exception as e:
            logger.error(f"[RESPONDER] ❌ Error generating answer with citations: {e}", exc_info=True)
            # Fallback to simple answer without citations
            try:
                chunk_texts = [chunk.get('chunk_text', '') for chunk in chunks_metadata if chunk.get('chunk_text')]
                formatted_chunk_text = "\n\n---\n\n".join(chunk_texts)
                fallback_answer = await generate_conversational_answer(user_query, formatted_chunk_text)
                error_answer = fallback_answer
            except Exception as fallback_error:
                logger.error(f"[RESPONDER] ❌ Fallback also failed: {fallback_error}", exc_info=True)
                error_answer = "I encountered an error while generating the answer. Please try again."
            
            # Prepare error output
            error_output = {
                "final_summary": error_answer
            }
            
            # Validate error output (should still be valid string)
            try:
                validate_responder_output(error_output)
            except ValueError as e:
                logger.error(f"[RESPONDER] ❌ Error output contract violation: {e}")
                # Fallback to minimal valid output
                error_output = {"final_summary": "I encountered an error. Please try again."}
            
            if emitter:
                emitter.emit_reasoning(
                    label="Error generating answer",
                    detail="Please try again"
                )
            
            return error_output
    
    else:
        # No chunks found - generate helpful message
        logger.warning("[RESPONDER] ⚠️ No chunks found in execution results")
        
        # Check if documents were found but chunks weren't retrieved
        has_documents = any(r.get("action") == "retrieve_docs" and r.get("result") for r in execution_results)
        
        # Check if refinement limit was reached
        if refinement_limit_reached:
            answer = "I've searched multiple times but couldn't find relevant information to answer your question. This might mean:\n\n- The information isn't in the available documents\n- The query needs to be rephrased with different keywords\n- The documents may need to be re-indexed\n\nPlease try rephrasing your question or providing more specific context."
        elif has_documents:
            answer = "I found relevant documents but couldn't retrieve specific content. Please try rephrasing your question or be more specific."
        else:
            answer = "I couldn't find relevant information to answer your question. Please try rephrasing or providing more context."
        
        # Prepare no-results output
        no_results_output = {
            "final_summary": answer
        }
        
        # Validate output
        try:
            validate_responder_output(no_results_output)
        except ValueError as e:
            logger.error(f"[RESPONDER] ❌ No-results output contract violation: {e}")
            raise
        
        if emitter:
            if has_documents:
                emitter.emit_reasoning(
                    label="No relevant information found",
                    detail="The documents don't contain the requested information"
                )
            else:
                emitter.emit_reasoning(
                    label="No relevant documents found",
                    detail="Please try rephrasing your question"
                )
        
        return no_results_output


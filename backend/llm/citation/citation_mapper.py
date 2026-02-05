"""
Citation Mapper - Layer 4: LLM boundary enforcement.

Maps LLM's citation numbers to Citation objects. Defends against hallucinations.
Responsibilities:
- Map citation numbers from LLM output to Citation objects
- Extract citations from answer text (fallback)
- Deduplicate citations (preserve original numbers when possible)
- Validate citation numbers against evidence registry

Rules:
- ✅ Enforce LLM boundary (no hallucinations)
- ✅ Validate citation numbers against evidence registry
- ✅ Preserve original citation numbers when possible
- ❌ No evidence extraction
- ❌ No evidence ranking
"""

import logging
import json
import re
from typing import List, Dict, Any, Optional
from backend.llm.citation.evidence_extractor import EvidenceBlock
from backend.llm.citation.document_store import fetch_document_filename
from backend.llm.types import Citation

logger = logging.getLogger(__name__)


def extract_citations_from_answer_text(answer_text: str) -> List[int]:
    """
    Extract citation numbers from answer text (e.g., [1], [2], [3]).
    
    Args:
        answer_text: Answer text that may contain citation numbers
        
    Returns:
        List of citation numbers as integers
    """
    citation_pattern = r'\[(\d+)\]'
    matches = re.findall(citation_pattern, answer_text)
    return [int(m) for m in matches]


def map_citation_numbers_to_citations(
    llm_output: Dict[str, Any],
    evidence_registry: Dict[str, EvidenceBlock],
    citation_num_to_evidence_id: Dict[int, str],
    answer_text: str = ""
) -> List[Citation]:
    """
    Map LLM's citation numbers to Citation objects with bbox coordinates.
    
    CRITICAL: Trust structured output over text extraction.
    Only use text extraction as fallback if structured output is missing.
    
    Args:
        llm_output: LLM output dict with 'answer' and 'citations' fields
        evidence_registry: Dict mapping evidence_id -> EvidenceBlock
        citation_num_to_evidence_id: Dict mapping citation_number -> evidence_id
        answer_text: Answer text (for fallback extraction)
        
    Returns:
        List of Citation objects with exact bbox coordinates
    """
    citations = []
    
    # Get citations from structured output
    citation_numbers = llm_output.get('citations', [])
    
    # Normalize to integers immediately
    if citation_numbers:
        citation_numbers = [
            int(c) if isinstance(c, str) else c 
            for c in citation_numbers 
            if isinstance(c, (int, str))
        ]
    
    # Fallback: Extract from answer text ONLY if structured output is missing
    if not citation_numbers and answer_text:
        text_citations = extract_citations_from_answer_text(answer_text)
        if text_citations:
            logger.info(f"[CITATION_MAPPER] No citations in structured output, extracted from text: {text_citations}")
            citation_numbers = text_citations
    
    # DON'T combine structured + text - trust structured output
    # Combining creates duplicates (int 2 vs str '2')
    
    if not citation_numbers:
        logger.warning("[CITATION_MAPPER] No citations found in LLM output or answer text")
        return citations
    
    # Remove duplicates while preserving order
    seen = set()
    unique_citation_numbers = []
    for num in citation_numbers:
        if num not in seen:
            seen.add(num)
            unique_citation_numbers.append(num)
    
    logger.info(f"[CITATION_MAPPER] Processing {len(unique_citation_numbers)} unique citation numbers: {unique_citation_numbers}")
    
    # Map to Citation objects
    for citation_number in unique_citation_numbers:
        # Look up evidence_id from citation number
        evidence_id = citation_num_to_evidence_id.get(citation_number)
        if not evidence_id:
            logger.warning(f"[CITATION_MAPPER] Citation number {citation_number} not found in mapping")
            continue
        
        # Get evidence block
        evidence_block = evidence_registry.get(evidence_id)
        if not evidence_block:
            logger.warning(f"[CITATION_MAPPER] Evidence ID {evidence_id} not found in registry")
            continue
        
        # Create citation object
        citation: Citation = {
            'citation_number': citation_number,  # PRESERVE original number
            'chunk_id': evidence_block.chunk_id,
            'block_id': None,
            'block_index': evidence_block.block_index,
            'cited_text': evidence_block.exact_text,  # Use exact_text for citation mapping
            'bbox': evidence_block.bbox,
            'page_number': evidence_block.bbox.get('page', 0) if evidence_block.bbox else 0,
            'doc_id': evidence_block.doc_id,
            'original_filename': None,  # Will be filled later
            'method': 'evidence-id-mapping',
            'block_content': None,
            'verification': None,
            'matched_block_content': None
        }
        citations.append(citation)
    
    logger.info(f"[CITATION_MAPPER] Mapped {len(citations)} citations from {len(unique_citation_numbers)} citation numbers")
    return citations


def deduplicate_and_renumber_citations(citations: List[Citation]) -> List[Citation]:
    """
    Deduplicate citations and ensure unique sequential numbering.
    
    CRITICAL: Only renumber if there are actual duplicates or gaps.
    If citations are already sequential and unique, preserve original numbers.
    
    Deduplication key: (chunk_id, block_index, bbox_hash)
    
    Args:
        citations: List of Citation objects (may have duplicate citation_numbers)
        
    Returns:
        List of unique Citation objects with sequential citation numbers
    """
    if not citations:
        return []
    
    seen = set()
    unique_citations = []
    
    # First pass: deduplicate by (chunk_id, block_index, bbox_hash)
    for citation in citations:
        chunk_id = citation.get('chunk_id', '')
        block_index = citation.get('block_index')
        bbox = citation.get('bbox', {})
        
        # Create deduplication key
        bbox_str = json.dumps(bbox, sort_keys=True) if bbox else ''
        dedup_key = (chunk_id, block_index, bbox_str)
        
        if dedup_key not in seen:
            seen.add(dedup_key)
            unique_citations.append(citation)
    
    # Second pass: check if renumbering is needed
    # Get all citation numbers from unique citations
    citation_numbers = [cit.get('citation_number') for cit in unique_citations]
    unique_numbers = sorted(set(citation_numbers))
    
    # Check if numbers are already sequential starting from 1
    is_sequential = unique_numbers == list(range(1, len(unique_numbers) + 1))
    has_duplicates = len(citation_numbers) != len(unique_numbers)
    
    needs_renumbering = has_duplicates or not is_sequential
    
    if needs_renumbering:
        # Renumber sequentially starting from 1
        new_number = 1
        for citation in unique_citations:
            citation['citation_number'] = new_number
            new_number += 1
        logger.info(
            f"[CITATION_MAPPER] Renumbered {len(citations)} → {len(unique_citations)} citations "
            f"(had duplicates: {has_duplicates}, was sequential: {is_sequential})"
        )
    else:
        # Preserve original numbers - they're already sequential and unique
        logger.info(
            f"[CITATION_MAPPER] Preserved original citation numbers "
            f"(already sequential and unique: {unique_numbers})"
        )
    
    logger.info(f"[CITATION_MAPPER] Deduplicated {len(citations)} → {len(unique_citations)} citations")
    return unique_citations


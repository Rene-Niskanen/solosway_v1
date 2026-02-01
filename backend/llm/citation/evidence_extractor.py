"""
Evidence Extractor - Layer 2: Intelligence layer.

Pure logic layer that extracts evidence from raw blocks. No IO, no database access.
Responsibilities:
- Extract atomic facts from blocks (regex-based)
- Extract clause evidence from blocks (structural detection)
- Convert blocks → EvidenceBlock objects

Rules:
- ✅ Pure functions (no side effects)
- ✅ Testable without database
- ✅ Regex patterns for atomic facts
- ✅ Structural detection for clauses
- ❌ No database queries
- ❌ No LLM calls
- ❌ No ranking/relevance
"""

import logging
import re
from typing import List, Dict, Any, Optional, Literal
from dataclasses import dataclass

from backend.llm.citation.document_store import fetch_chunk_blocks

logger = logging.getLogger(__name__)

EvidenceType = Literal["atomic", "clause"]


@dataclass
class EvidenceBlock:
    """Evidence block extracted from Parse blocks for deterministic citation mapping."""
    evidence_id: str  # "request_id:E1", "request_id:E2", ... (request-scoped)
    evidence_type: EvidenceType  # "atomic" or "clause"
    chunk_id: str  # UUID
    block_index: int  # Index in blocks array (or list for clause)
    block_ids: List[str]  # For clause evidence, may span multiple blocks
    exact_text: str  # Exact text from Parse block(s)
    text_preview: str  # Short preview for LLM display (first 80 chars)
    bbox: Dict[str, Any]  # Copy from Parse block bbox (or union for clause)
    fact_type: str  # "value", "date", "name", "clause", "obligation", etc.
    label: str  # "Market Value", "Valuation date", "Vendor's agent responsibilities", etc.
    confidence: str  # "high" or "medium"
    doc_id: str  # Document UUID
    page: int  # Page number from bbox
    section_title: Optional[str] = None  # Section header if available


def extract_atomic_facts_from_block(block: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Extract atomic facts from a Parse block using regex patterns.
    
    Args:
        block: Parse block dict with 'content', 'bbox', etc.
        
    Returns:
        List of fact dicts with 'text', 'fact_type', 'label', 'match_start', 'match_end'
    """
    content = block.get('content', '')
    if not content or not isinstance(content, str):
        return []
    
    facts = []
    seen_matches = set()
    
    # Monetary values
    value_patterns = [
        (r'Market Value[:\s]+£?([\d,]+\.?\d*)', 'Market Value', 'value', 40),
        (r'90[- ]day[:\s]+value[:\s]+£?([\d,]+\.?\d*)', '90-day value', 'value', 40),
        (r'180[- ]day[:\s]+value[:\s]+£?([\d,]+\.?\d*)', '180-day value', 'value', 40),
        (r'Market Rent[:\s]+£?([\d,]+\.?\d*)\s*(?:per\s+)?(?:calendar\s+)?month', 'Market Rent', 'value', 50),
        (r'rent[:\s]+£?([\d,]+\.?\d*)\s*(?:per\s+)?(?:calendar\s+)?month', 'Monthly Rent', 'value', 50),
        (r'KSH\s+([\d,]+\.?\d*)', 'KSH Amount', 'value', 30),
        (r'KSHS\s+([\d,]+\.?\d*)', 'KSHS Amount', 'value', 30),
    ]
    
    for pattern, label, fact_type, context_size in value_patterns:
        matches = list(re.finditer(pattern, content, re.IGNORECASE))
        for match in matches:
            match_key = (match.start(), match.end())
            if any(start <= match.start() < end or start < match.end() <= end 
                   for start, end in seen_matches):
                continue
            
            seen_matches.add(match_key)
            start = max(0, match.start() - context_size)
            end = min(len(content), match.end() + context_size)
            context = content[start:end].strip()
            
            facts.append({
                'text': context,
                'fact_type': fact_type,
                'label': label,
                'match_start': match.start(),
                'match_end': match.end()
            })
    
    # Dates
    date_patterns = [
        (r'Valuation date[:\s]+(\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4})', 'Valuation date', 'date', 30),
        (r'(\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4})', 'Date', 'date', 20),
    ]
    
    for pattern, label, fact_type, context_size in date_patterns:
        matches = list(re.finditer(pattern, content, re.IGNORECASE))
        for match in matches:
            match_key = (match.start(), match.end())
            if any(start <= match.start() < end or start < match.end() <= end 
                   for start, end in seen_matches):
                continue
            
            seen_matches.add(match_key)
            start = max(0, match.start() - context_size)
            end = min(len(content), match.end() + context_size)
            context = content[start:end].strip()
            
            facts.append({
                'text': context,
                'fact_type': fact_type,
                'label': label,
                'match_start': match.start(),
                'match_end': match.end()
            })
    
    # Names
    name_patterns = [
        (r'Valuer[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+(?:\s+MRICS)?)', 'Valuer', 'name', 30),
        (r'Inspector[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)', 'Inspector', 'name', 30),
        (r'conducted by[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+(?:\s+MRICS)?)', 'Conducted by', 'name', 30),
    ]
    
    for pattern, label, fact_type, context_size in name_patterns:
        matches = list(re.finditer(pattern, content, re.IGNORECASE))
        for match in matches:
            match_key = (match.start(), match.end())
            if any(start <= match.start() < end or start < match.end() <= end 
                   for start, end in seen_matches):
                continue
            
            seen_matches.add(match_key)
            start = max(0, match.start() - context_size)
            end = min(len(content), match.end() + context_size)
            context = content[start:end].strip()
            
            facts.append({
                'text': context,
                'fact_type': fact_type,
                'label': label,
                'match_start': match.start(),
                'match_end': match.end()
            })
    
    # Ratings
    rating_patterns = [
        (r'EPC\s+Rating[:\s]+([A-G]\d?)', 'EPC Rating', 'rating', 20),
    ]
    
    for pattern, label, fact_type, context_size in rating_patterns:
        matches = list(re.finditer(pattern, content, re.IGNORECASE))
        for match in matches:
            match_key = (match.start(), match.end())
            if any(start <= match.start() < end or start < match.end() <= end 
                   for start, end in seen_matches):
                continue
            
            seen_matches.add(match_key)
            start = max(0, match.start() - context_size)
            end = min(len(content), match.end() + context_size)
            context = content[start:end].strip()
            
            facts.append({
                'text': context,
                'fact_type': fact_type,
                'label': label,
                'match_start': match.start(),
                'match_end': match.end()
            })
    
    # Sort by match position
    facts.sort(key=lambda x: x.get('match_start', 0))
    
    return facts


def extract_clause_evidence_from_block(
    block: Dict[str, Any], 
    section_title: Optional[str],
    adjacent_blocks: List[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """
    Extract clause evidence from a Parse block using structural detection.
    
    Args:
        block: Parse block dict with 'content', 'bbox', etc.
        section_title: Section header if available
        adjacent_blocks: Adjacent blocks for clause grouping
        
    Returns:
        Dict with clause evidence data, or None if not a clause
    """
    content = block.get('content', '')
    if not content or not isinstance(content, str):
        return None
    
    content_lower = content.lower()
    section_lower = section_title.lower() if section_title else ""
    
    # Clause keywords
    clause_indicators = [
        "shall", "must", "will", "responsible for", "obligation",
        "duty", "required to", "agrees to", "warrants", "covenants"
    ]
    
    # Section types that typically contain clauses
    clause_section_types = [
        "obligations", "responsibilities", "terms", "conditions",
        "agreement", "covenant", "warranty", "indemnity"
    ]
    
    # Check if block contains clause indicators
    has_clause_keywords = any(indicator in content_lower for indicator in clause_indicators)
    is_clause_section = any(section_type in section_lower for section_type in clause_section_types)
    
    if not has_clause_keywords and not is_clause_section:
        return None
    
    # Determine fact type and label
    if "obligation" in content_lower or "obligations" in section_lower:
        fact_type = "obligation"
        label = section_title or "Obligation"
    elif "responsible" in content_lower or "responsibilities" in section_lower:
        fact_type = "responsibility"
        label = section_title or "Responsibility"
    else:
        fact_type = "clause"
        label = section_title or "Clause"
    
    # Extract preview (first 80 chars)
    text_preview = content[:80] + "..." if len(content) > 80 else content
    
    return {
        'exact_text': content,
        'text_preview': text_preview,
        'fact_type': fact_type,
        'label': label,
        'has_clause_keywords': has_clause_keywords,
        'is_clause_section': is_clause_section
    }


def extract_evidence_blocks_from_chunks(
    chunks_metadata: List[Dict[str, Any]], 
    request_id: str
) -> List[EvidenceBlock]:
    """
    Extract evidence blocks from chunks.
    
    Uses document_store to fetch blocks, then applies extraction logic.
    
    Args:
        chunks_metadata: List of chunk dicts with chunk_id, document_id, etc.
        request_id: UUID for request-scoped evidence IDs
        
    Returns:
        List of EvidenceBlock objects
    """
    evidence_blocks = []
    evidence_counter = 1
    
    for chunk in chunks_metadata:
        chunk_id = chunk.get('chunk_id')
        doc_id = chunk.get('document_id')
        
        if not chunk_id or not doc_id:
            continue
        
        # Fetch blocks using document_store
        chunk_data = fetch_chunk_blocks(chunk_id)
        if not chunk_data:
            continue
        
        blocks = chunk_data.get('blocks', [])
        if not blocks:
            continue
        
        # Get section title from metadata
        metadata = chunk_data.get('metadata', {})
        section_title = metadata.get('section_title') if isinstance(metadata, dict) else None
        
        # Process each block
        for block_index, block in enumerate(blocks):
            block_content = block.get('content', '')
            block_bbox = block.get('bbox', {})
            
            if not block_content or not block_bbox:
                continue
            
            page = block_bbox.get('page', chunk_data.get('page_number', 0))
            confidence = block.get('confidence', 'high')
            
            # Extract atomic facts
            atomic_facts = extract_atomic_facts_from_block(block)
            for fact in atomic_facts:
                evidence_id = f"{request_id}:E{evidence_counter}"
                evidence_counter += 1
                
                evidence_blocks.append(EvidenceBlock(
                    evidence_id=evidence_id,
                    evidence_type="atomic",
                    chunk_id=chunk_id,
                    block_index=block_index,
                    block_ids=[str(block_index)],
                    exact_text=fact['text'],
                    text_preview=fact['text'][:80] + "..." if len(fact['text']) > 80 else fact['text'],
                    bbox=block_bbox.copy(),
                    fact_type=fact['fact_type'],
                    label=fact['label'],
                    confidence=confidence,
                    doc_id=doc_id,
                    page=int(page) if page is not None else 0,
                    section_title=section_title
                ))
            
            # Extract clause evidence
            clause_evidence = extract_clause_evidence_from_block(
                block, 
                section_title, 
                blocks[max(0, block_index-1):block_index+2]  # Adjacent blocks
            )
            
            if clause_evidence:
                evidence_id = f"{request_id}:E{evidence_counter}"
                evidence_counter += 1
                
                evidence_blocks.append(EvidenceBlock(
                    evidence_id=evidence_id,
                    evidence_type="clause",
                    chunk_id=chunk_id,
                    block_index=block_index,
                    block_ids=[str(block_index)],
                    exact_text=clause_evidence['exact_text'],
                    text_preview=clause_evidence['text_preview'],
                    bbox=block_bbox.copy(),
                    fact_type=clause_evidence['fact_type'],
                    label=clause_evidence['label'],
                    confidence='high',
                    doc_id=doc_id,
                    page=int(page) if page is not None else 0,
                    section_title=section_title
                ))
    
    return evidence_blocks


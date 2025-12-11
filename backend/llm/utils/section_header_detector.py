"""
Universal Section Header Detection Utility

Detects section headers from document chunks using universal patterns.
Works for all document types: valuation reports, EPCs, tenancy agreements, etc.
"""
import re
import logging
from typing import Dict, Optional, List

logger = logging.getLogger(__name__)

# Common words to filter out when extracting keywords
COMMON_WORDS = {
    'the', 'a', 'an', 'of', 'in', 'for', 'to', 'and', 'or', 'but', 'is', 'are', 
    'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 
    'that', 'these', 'those', 'with', 'from', 'by', 'on', 'at', 'as', 'if', 'it',
    'its', 'they', 'them', 'their', 'there', 'then', 'than', 'so', 'up', 'down',
    'out', 'off', 'over', 'under', 'about', 'into', 'through', 'during', 'before',
    'after', 'above', 'below', 'between', 'among', 'within', 'without', 'throughout'
}


def detect_section_header(chunk_text: str) -> Optional[Dict[str, any]]:
    """
    Detect section header from chunk text using universal patterns.
    
    Args:
        chunk_text: The chunk text to analyze
        
    Returns:
        Dict with section header info, or None if no header detected:
        {
            "section_header": "10 Valuation",  # Full header as found
            "normalized_header": "valuation",  # Lowercase, no numbers (for matching)
            "section_keywords": ["valuation", "market", "value"],  # Extracted keywords
            "has_section_header": True
        }
    """
    if not chunk_text or not chunk_text.strip():
        return None
    
    # Get first few lines (headers are usually at the start)
    lines = chunk_text.strip().split('\n')
    first_lines = lines[:3]  # Check first 3 lines for header
    
    for line in first_lines:
        line = line.strip()
        if not line:
            continue
        
        # Pattern 1: Numbered sections (e.g., "10 Valuation", "5 Energy Performance")
        numbered_pattern = r'^\d+\s+([A-Z][a-zA-Z\s]+?)(?:\s*[:.]?\s*|$)'
        match = re.match(numbered_pattern, line)
        if match:
            header_text = match.group(1).strip()
            full_header = line.split(':')[0].split('.')[0].strip()  # Remove trailing colon/period
            normalized = _normalize_header(header_text)
            keywords = _extract_keywords(header_text)
            
            logger.debug(f"Detected numbered section header: '{full_header}' -> normalized: '{normalized}'")
            return {
                "section_header": full_header,
                "normalized_header": normalized,
                "section_keywords": keywords,
                "has_section_header": True
            }
        
        # Pattern 2: Title patterns (e.g., "Market Value", "Current Rating", "Rent")
        # Must start with capital letter, be reasonably short (max 50 chars), and not be a full sentence
        title_pattern = r'^([A-Z][a-zA-Z\s]{1,50}?)(?:\s*[:.]?\s*|$)'
        match = re.match(title_pattern, line)
        if match:
            header_text = match.group(1).strip()
            
            # Filter out lines that look like sentences (contain lowercase words in middle, end with period)
            if len(header_text) > 50 or '.' in header_text[:-1] or header_text.count(' ') > 5:
                continue
            
            # Check if it's all caps (common for section headers)
            is_all_caps = header_text.isupper() and len(header_text) > 3
            
            # Check if it starts with capital and has reasonable structure
            words = header_text.split()
            if len(words) >= 1 and len(words) <= 5:
                # First word should be capitalized, rest can be mixed case
                if words[0][0].isupper():
                    full_header = header_text.split(':')[0].split('.')[0].strip()
                    normalized = _normalize_header(full_header)
                    keywords = _extract_keywords(full_header)
                    
                    logger.debug(f"Detected title section header: '{full_header}' -> normalized: '{normalized}'")
                    return {
                        "section_header": full_header,
                        "normalized_header": normalized,
                        "section_keywords": keywords,
                        "has_section_header": True
                    }
        
        # Pattern 3: All caps short lines (common for section headers)
        if line.isupper() and 3 <= len(line) <= 50 and not line.endswith('.'):
            normalized = _normalize_header(line)
            keywords = _extract_keywords(line)
            
            logger.debug(f"Detected all-caps section header: '{line}' -> normalized: '{normalized}'")
            return {
                "section_header": line,
                "normalized_header": normalized,
                "section_keywords": keywords,
                "has_section_header": True
            }
    
    # No header detected
    return None


def _normalize_header(header: str) -> str:
    """
    Normalize section header for matching: lowercase, remove numbers, punctuation.
    
    Args:
        header: Raw header text
        
    Returns:
        Normalized header string
    """
    # Remove numbers at the start
    normalized = re.sub(r'^\d+\s+', '', header)
    
    # Remove trailing colons, periods, dashes
    normalized = normalized.rstrip(':.-\t ')
    
    # Convert to lowercase
    normalized = normalized.lower()
    
    # Remove extra spaces
    normalized = ' '.join(normalized.split())
    
    return normalized


def _extract_keywords(header: str) -> List[str]:
    """
    Extract meaningful keywords from section header for flexible matching.
    
    Args:
        header: Section header text
        
    Returns:
        List of keywords (lowercase, filtered)
    """
    # Normalize first
    normalized = _normalize_header(header)
    
    # Split into words
    words = normalized.split()
    
    # Filter out common words and keep meaningful terms
    keywords = [
        word for word in words 
        if word.lower() not in COMMON_WORDS 
        and len(word) > 2  # Skip very short words
    ]
    
    # Also include the full normalized header as a keyword for exact matching
    if normalized and normalized not in keywords:
        keywords.insert(0, normalized)
    
    return keywords


def extract_section_headers_from_chunks(chunks: List[Dict[str, any]]) -> List[Dict[str, any]]:
    """
    Extract section headers from a list of Reducto chunks.
    
    Args:
        chunks: List of chunk dicts with 'content' or 'text' field
        
    Returns:
        List of chunk metadata dicts with section header info added
    """
    chunk_metadata_list = []
    
    for chunk in chunks:
        # Get chunk text (Reducto chunks may have 'content' or 'text')
        chunk_text = chunk.get('content') or chunk.get('text') or ''
        
        # Detect section header
        header_info = detect_section_header(chunk_text)
        
        if header_info:
            # Merge with existing chunk metadata
            chunk_meta = chunk.copy()
            chunk_meta.update(header_info)
            chunk_metadata_list.append(chunk_meta)
        else:
            # No header detected, add flag
            chunk_meta = chunk.copy()
            chunk_meta['has_section_header'] = False
            chunk_metadata_list.append(chunk_meta)
    
    return chunk_metadata_list


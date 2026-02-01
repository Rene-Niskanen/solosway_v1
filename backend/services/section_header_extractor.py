"""
Section Header Extractor Utility

Extracts section headers from Reducto blocks array and provides utilities for
normalization, level inference, and keyword extraction.
"""

import re
import logging
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)


def extract_section_header_from_blocks(blocks: List[Dict]) -> Optional[Dict]:
    """
    Extract section header from blocks array.
    
    Finds the first block with type "Section Header" and extracts its information.
    
    Args:
        blocks: List of block dictionaries from Reducto parse result
        
    Returns:
        Dict with section header information:
        {
            "section_header": str,      # Raw header text
            "section_title": str,        # Normalized title (for section_id)
            "section_level": int,        # Hierarchy level (1, 2, 3)
            "page_number": int,         # Page where header appears
            "bbox": dict                 # Header bbox coordinates
        }
        Returns None if no section header found
    """
    if not blocks or not isinstance(blocks, list):
        return None
    
    # Find first Section Header block
    for block in blocks:
        if not isinstance(block, dict):
            continue
            
        block_type = block.get('type', '')
        if block_type == 'Section Header':
            header_content = block.get('content', '')
            if header_content and isinstance(header_content, str):
                header_content = header_content.strip()
                if header_content:
                    # Infer section level from content
                    section_level = infer_section_level(header_content)
                    
                    # Normalize header for section_id
                    section_title = normalize_section_title(header_content)
                    
                    # Extract bbox and page
                    block_bbox = block.get('bbox', {})
                    page_number = None
                    if isinstance(block_bbox, dict):
                        page_number = block_bbox.get('page') or block_bbox.get('original_page')
                    
                    return {
                        "section_header": header_content,
                        "section_title": section_title,
                        "section_level": section_level,
                        "page_number": page_number,
                        "bbox": block_bbox if isinstance(block_bbox, dict) else None
                    }
    
    return None


def infer_section_level(header_text: str) -> int:
    """
    Infer section hierarchy level from header text.
    
    Rules:
    - Level 3: Sub-numbered (e.g., "1.1.1", "2.3.4")
    - Level 2: Numbered (e.g., "1.1", "2.3", "10.1")
    - Level 1: Single number or title case (e.g., "1", "Introduction", "Definitions")
    - Default: Level 2
    
    Args:
        header_text: Section header text
        
    Returns:
        Section level (1, 2, or 3)
    """
    if not header_text:
        return 2  # Default
    
    header_text = header_text.strip()
    
    # Pattern 1: Sub-numbered sections (e.g., "1.1.1", "2.3.4") → Level 3
    sub_numbered_match = re.match(r'^\d+\.\d+\.\d+', header_text)
    if sub_numbered_match:
        return 3
    
    # Pattern 2: Numbered sections (e.g., "1.1", "2.3", "10.1") → Level 2
    numbered_match = re.match(r'^\d+\.\d+', header_text)
    if numbered_match:
        return 2
    
    # Pattern 3: Single number (e.g., "1", "10") → Level 1
    single_number_match = re.match(r'^\d+\s', header_text)  # Number followed by space
    if single_number_match:
        return 1
    
    # Pattern 4: All caps or title case at start → Level 1
    # Check if first word is all caps or title case
    first_word = header_text.split()[0] if header_text.split() else ""
    if first_word and (first_word.isupper() or first_word.istitle()):
        # But exclude if it's a numbered pattern we already checked
        if not re.match(r'^\d+', first_word):
            return 1
    
    # Default: Level 2 (most common for subsections)
    return 2


def normalize_section_title(header_text: str, max_length: int = 100) -> str:
    """
    Normalize section header text to create section_id.
    
    Rules:
    1. Convert to lowercase
    2. Replace spaces with underscores
    3. Remove special characters (keep alphanumeric and underscores)
    4. Limit length (default: 100 characters)
    
    Args:
        header_text: Raw section header text
        max_length: Maximum length for normalized title
        
    Returns:
        Normalized section title (e.g., "1_1_an_overview_of_google_clouds_agent_ecosystem")
    """
    if not header_text:
        return ""
    
    # Convert to lowercase
    normalized = header_text.lower().strip()
    
    # Replace spaces and common separators with underscores
    normalized = re.sub(r'[\s\-–—]+', '_', normalized)
    
    # Remove special characters (keep alphanumeric, underscores, and dots for numbers)
    # First, preserve number patterns (e.g., "1.1" → "1_1")
    normalized = re.sub(r'\.', '_', normalized)
    
    # Then remove all non-alphanumeric except underscores
    normalized = re.sub(r'[^a-z0-9_]', '', normalized)
    
    # Remove multiple consecutive underscores
    normalized = re.sub(r'_+', '_', normalized)
    
    # Remove leading/trailing underscores
    normalized = normalized.strip('_')
    
    # Limit length
    if len(normalized) > max_length:
        normalized = normalized[:max_length].rstrip('_')
    
    return normalized


def extract_keywords(header_text: str) -> List[str]:
    """
    Extract searchable keywords from section header text.
    
    Extracts:
    - Normalized header (primary keyword)
    - Individual significant words (excluding stop words)
    - Number patterns (e.g., "1.1" → ["1_1", "1", "1.1"])
    
    Args:
        header_text: Section header text
        
    Returns:
        List of keywords for searching
    """
    if not header_text:
        return []
    
    keywords = []
    
    # Add normalized header as primary keyword
    normalized = normalize_section_title(header_text)
    if normalized:
        keywords.append(normalized)
    
    # Extract significant words (3+ characters, not common stop words)
    stop_words = {'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'a', 'an'}
    words = re.findall(r'\b[a-z]{3,}\b', header_text.lower())
    significant_words = [w for w in words if w not in stop_words]
    keywords.extend(significant_words)
    
    # Extract number patterns (e.g., "1.1", "2.3.4")
    number_patterns = re.findall(r'\d+(?:\.\d+)+', header_text)
    for pattern in number_patterns:
        # Add both original and normalized versions
        keywords.append(pattern)
        keywords.append(pattern.replace('.', '_'))
    
    # Remove duplicates while preserving order
    seen = set()
    unique_keywords = []
    for kw in keywords:
        if kw and kw not in seen:
            seen.add(kw)
            unique_keywords.append(kw)
    
    return unique_keywords


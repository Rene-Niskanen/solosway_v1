"""
Citation Mapping Tool - LLM provides block IDs directly from document extracts.

This tool allows the LLM to cite specific blocks from document extracts by their block ID.
The LLM looks up the block ID in the Metadata Look-Up Table to get bbox coordinates.

Uses CitationTool class to store citations with bbox lookup and state management.
"""

import logging
import os
from typing import Dict, List, Any, Tuple, Optional
from pydantic import BaseModel, Field
from langchain_core.tools import StructuredTool

from backend.llm.types import Citation
from backend.services.supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)

# Local debug log writes are expensive and should be disabled in production.
_LLM_DEBUG = os.environ.get("LLM_DEBUG") == "1"
_DEBUG_LOG_PATH = os.environ.get("LLM_DEBUG_LOG_PATH", "/Users/thomashorner/solosway_v1/.cursor/debug.log")

def _debug_log(payload: dict) -> None:
    if not _LLM_DEBUG:
        return
    try:
        import json
        with open(_DEBUG_LOG_PATH, "a") as f:
            f.write(json.dumps(payload) + "\n")
    except Exception:
        pass


def verify_citation_match(cited_text: str, block_content: str) -> Dict[str, Any]:
    """
    Verify that cited_text matches block_content.
    
    Args:
        cited_text: Text the LLM is citing
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
    
    # CRITICAL: Check for exact phrase match FIRST (highest priority for all citations)
    # This ensures citations match the exact fact being stated, not just similar words
    cited_lower = cited_text.lower().strip()
    block_lower = block_content.lower()
    
    # Try exact phrase match first
    if cited_lower in block_lower:
        # Exact phrase found - highest confidence
        _debug_log({
            "location": "citation_mapping.verify_citation_match:exact_phrase_match",
            "data": {
                "cited_text": cited_text,
                "exact_match": True,
            },
        })
        return {
            'match': True,
            'confidence': 'high',
            'matched_terms': ['exact_phrase_match'],
            'missing_terms': [],
            'numeric_matches': []
        }
    
    # Try phrase match with normalized whitespace (multiple spaces -> single space)
    cited_normalized = re.sub(r'\s+', ' ', cited_lower)
    block_normalized = re.sub(r'\s+', ' ', block_lower)
    if cited_normalized in block_normalized:
        _debug_log({
            "location": "citation_mapping.verify_citation_match:exact_phrase_match_normalized",
            "data": {
                "cited_text": cited_text,
                "exact_match": True,
            },
        })
        return {
            'match': True,
            'confidence': 'high',
            'matched_terms': ['exact_phrase_match'],
            'missing_terms': [],
            'numeric_matches': []
        }
    
    # Extract numeric values from cited_text (normalize formats: £1,950,000, 1950000, 1,950,000)
    numeric_pattern = r'£?([\d,]+\.?\d*)'
    cited_numbers = re.findall(numeric_pattern, cited_text)
    cited_numbers_normalized = [num.replace(',', '').replace('.', '') for num in cited_numbers]
    
    # Extract numeric values from block_content
    block_numbers = re.findall(numeric_pattern, block_content)
    block_numbers_normalized = [num.replace(',', '').replace('.', '') for num in block_numbers]
    
    _debug_log({
        "location": "citation_mapping.verify_citation_match:number_extraction",
        "data": {
            "cited_text_preview": cited_text[:150],
            "block_content_preview": block_content[:150],
            "cited_numbers": cited_numbers,
            "cited_numbers_normalized": cited_numbers_normalized,
            "block_numbers": block_numbers,
            "block_numbers_normalized": block_numbers_normalized,
        },
    })
    
    # Check for numeric matches
    numeric_matches = [num for num in cited_numbers_normalized if num in block_numbers_normalized]
    
    # Extract key terms (non-numeric words, 3+ chars)
    cited_terms = [word.lower() for word in re.findall(r'\b\w{3,}\b', cited_text.lower())]
    block_terms = [word.lower() for word in re.findall(r'\b\w{3,}\b', block_content.lower())]
    
    # Check for term matches
    term_matches = [term for term in cited_terms if term in block_terms]
    missing_terms = [term for term in cited_terms if term not in block_terms]
    
    # CRITICAL: For negative statements (e.g., "no recent planning history"), require key phrase matching
    # Check if cited_text contains negative indicators
    negative_indicators = ['no ', 'not ', 'none', 'without', 'lack of', 'absence of']
    is_negative_statement = any(indicator in cited_text.lower() for indicator in negative_indicators)
    
    if is_negative_statement:
        # For negative statements, extract core semantic concept (remove negative indicators to get the concept)
        # Then verify the block contains both the negative indicator AND the core concept
        core_concept = cited_lower
        for indicator in negative_indicators:
            core_concept = core_concept.replace(indicator, '').strip()
        
        # Extract significant terms from core concept (4+ chars)
        core_terms = [word.lower() for word in re.findall(r'\b\w{4,}\b', core_concept)]
        
        # The block must contain ALL core concept terms
        # This ensures "no recent planning history" matches blocks that contain "planning history" concept
        if core_terms:
            core_terms_in_block = all(term in block_terms for term in core_terms)
            
            if not core_terms_in_block:
                # The block doesn't contain the core concept - this is a mismatch
                _debug_log({
                    "location": "citation_mapping.verify_citation_match:negative_statement_fail",
                    "data": {
                        "cited_text": cited_text,
                        "core_concept": core_concept,
                        "core_terms": core_terms,
                        "core_terms_in_block": core_terms_in_block,
                        "block_content_preview": block_content[:150],
                    },
                })
                return {
                    'match': False,
                    'confidence': 'low',
                    'matched_terms': term_matches,
                    'missing_terms': missing_terms + core_terms,
                    'numeric_matches': []
                }
            
            # If core terms match, check if the block also contains a negative indicator
            # This ensures we're matching the right semantic meaning
            block_has_negative = any(indicator in block_lower for indicator in negative_indicators)
            if block_has_negative and core_terms_in_block:
                # High confidence: block contains both negative indicator and core concept
                return {
                    'match': True,
                    'confidence': 'high',
                    'matched_terms': term_matches + ['negative_semantic_match'],
                    'missing_terms': [],
                    'numeric_matches': numeric_matches
                }
    
    # Determine confidence
    has_numeric_match = len(numeric_matches) > 0
    has_term_match = len(term_matches) > 0
    
    # CRITICAL: For ALL descriptive citations (no numbers), require strict term matching
    # This prevents "well-maintained gardens with defined boundaries" from matching blocks that only have "gardens"
    # Short descriptive (2-4 terms): require ALL terms
    # Longer descriptive (5+ terms): require 80%+ of key terms (excluding common words)
    is_descriptive = len(cited_numbers_normalized) == 0 and len(cited_terms) >= 2
    if is_descriptive:
        # Filter out common/stop words that don't add semantic meaning
        common_words = {'the', 'and', 'or', 'but', 'with', 'for', 'from', 'that', 'this', 'are', 'was', 'were', 'been', 'have', 'has', 'had', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'must', 'shall'}
        key_terms = [term for term in cited_terms if term not in common_words]
        
        if len(key_terms) == 0:
            # All terms were common words - use all terms
            key_terms = cited_terms
        
        matched_key_terms = [term for term in key_terms if term in block_terms]
        missing_key_terms = [term for term in key_terms if term not in block_terms]
        
        # For short descriptive (2-4 terms): require ALL key terms
        # For longer descriptive (5+ terms): require 80%+ of key terms
        if len(key_terms) <= 4:
            # Short descriptive: ALL key terms must match
            all_key_terms_match = len(missing_key_terms) == 0
            if not all_key_terms_match:
                _debug_log({
                    "location": "citation_mapping.verify_citation_match:short_descriptive_fail",
                    "data": {
                        "cited_text": cited_text,
                        "cited_terms": cited_terms,
                        "key_terms": key_terms,
                        "missing_key_terms": missing_key_terms,
                        "matched_key_terms": matched_key_terms,
                        "block_content_preview": block_content[:150],
                    },
                })
                return {
                    'match': False,
                    'confidence': 'low',
                    'matched_terms': term_matches,
                    'missing_terms': missing_terms + missing_key_terms,
                    'numeric_matches': []
                }
        else:
            # Longer descriptive: require 80%+ of key terms
            match_ratio = len(matched_key_terms) / len(key_terms) if len(key_terms) > 0 else 0
            if match_ratio < 0.8:
                _debug_log({
                    "location": "citation_mapping.verify_citation_match:long_descriptive_fail",
                    "data": {
                        "cited_text": cited_text,
                        "cited_terms": cited_terms,
                        "key_terms": key_terms,
                        "matched_key_terms": matched_key_terms,
                        "missing_key_terms": missing_key_terms,
                        "match_ratio": match_ratio,
                        "required_ratio": 0.8,
                        "block_content_preview": block_content[:150],
                    },
                })
                return {
                    'match': False,
                    'confidence': 'low',
                    'matched_terms': term_matches,
                    'missing_terms': missing_terms + missing_key_terms,
                    'numeric_matches': []
                }
    
    # CRITICAL: For valuation figures, require EXACT numeric match
    # If cited_text contains a specific amount (e.g., "£1,950,000"), the block MUST contain that exact amount
    is_valuation_figure = any(keyword in cited_text.lower() for keyword in ['value', 'valuation', 'price', 'rent', 'amount', 'worth'])
    has_specific_amount = len(cited_numbers_normalized) > 0
    
    _debug_log({
        "location": "citation_mapping.verify_citation_match:exact_amount_requirement",
        "data": {
            "is_valuation_figure": is_valuation_figure,
            "has_specific_amount": has_specific_amount,
            "cited_numbers_normalized": cited_numbers_normalized,
            "block_numbers_normalized": block_numbers_normalized,
            "cited_text_preview": cited_text[:100],
            "block_content_preview": block_content[:100],
        },
    })
    
    # If it's a valuation figure with a specific amount, require that amount to be in the block
    if is_valuation_figure and has_specific_amount:
        # CRITICAL FIX: Use the LARGEST number as primary amount (valuation figures are usually the largest)
        # This handles cases like "90-Day Value: £1,950,000" where "90" appears first but "1950000" is the actual amount
        primary_amount = max(cited_numbers_normalized, key=lambda x: (len(x), int(x) if x.isdigit() else 0))
        amount_in_block = primary_amount in block_numbers_normalized
        
        _debug_log({
            "location": "citation_mapping.verify_citation_match:primary_amount_check",
            "data": {
                "cited_numbers_normalized": cited_numbers_normalized,
                "primary_amount": primary_amount,
                "amount_in_block": amount_in_block,
                "block_numbers_normalized": block_numbers_normalized,
                "will_return_false": not amount_in_block,
            },
        })
        
        if not amount_in_block:
            # The block doesn't contain the specific amount being cited - this is a mismatch
            return {
                'match': False,
                'confidence': 'low',
                'matched_terms': term_matches,
                'missing_terms': missing_terms + [f'amount_{primary_amount}'],
                'numeric_matches': []
            }
    
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


def build_searchable_blocks_from_metadata_lookup_tables(
    metadata_lookup_tables: Dict[str, Dict[str, Dict[str, Any]]]
) -> List[Dict[str, Any]]:
    """
    Flatten metadata_lookup_tables into a list of blocks for anchor-quote search.
    Each block has content, bbox, page, doc_id, block_id for resolve_anchor_quote_to_bbox.
    """
    import re
    blocks = []
    for doc_id, meta_table in (metadata_lookup_tables or {}).items():
        for block_id, meta in (meta_table or {}).items():
            content = (meta.get('content') or '').strip()
            page = meta.get('page', 0)
            left = float(meta.get('bbox_left', 0))
            top = float(meta.get('bbox_top', 0))
            width = float(meta.get('bbox_width', 0))
            height = float(meta.get('bbox_height', 0))
            bbox = {
                'left': round(left, 4),
                'top': round(top, 4),
                'width': round(width, 4),
                'height': round(height, 4),
                'page': int(page) if page is not None else 0
            }
            blocks.append({
                'doc_id': doc_id,
                'block_id': block_id,
                'content': content,
                'page': int(page) if page is not None else 0,
                'bbox': bbox,
                'chunk_index': meta.get('chunk_index', 0),
                'confidence': meta.get('confidence', 'medium'),
            })
    return blocks


def resolve_block_id_to_bbox(
    block_id: str,
    metadata_lookup_tables: Dict[str, Dict[str, Dict[str, Any]]],
    doc_id_hint: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Resolve a block_id (and optional doc_id) to bbox from metadata lookup tables.
    Used when segments include optional block_id from the model.
    """
    if not block_id or not metadata_lookup_tables:
        return None
    tables_to_search = (
        [(doc_id_hint, metadata_lookup_tables[doc_id_hint])]
        if doc_id_hint and doc_id_hint in metadata_lookup_tables
        else list((metadata_lookup_tables or {}).items())
    )
    for doc_id, meta_table in tables_to_search:
        meta = (meta_table or {}).get(block_id)
        if not meta:
            continue
        page = meta.get('page', 0)
        left = float(meta.get('bbox_left', 0))
        top = float(meta.get('bbox_top', 0))
        width = float(meta.get('bbox_width', 0))
        height = float(meta.get('bbox_height', 0))
        bbox = {
            'left': round(left, 4),
            'top': round(top, 4),
            'width': round(width, 4),
            'height': round(height, 4),
            'page': int(page) if page is not None else 0
        }
        return {
            'doc_id': doc_id,
            'block_id': block_id,
            'page': int(page) if page is not None else 0,
            'bbox': bbox,
            'cited_text': (meta.get('content') or '')[:200],
            'content': (meta.get('content') or '').strip(),
            'confidence': meta.get('confidence', 'medium'),
            'method': 'block-id-lookup'
        }
    return None


def resolve_anchor_quote_to_bbox(
    anchor_quote: str,
    searchable_blocks: List[Dict[str, Any]],
    narrow_to_line: bool = True
) -> Optional[Dict[str, Any]]:
    """
    Resolve a verbatim anchor phrase to the block that contains it and return bbox.
    Uses exact substring match (with normalized whitespace). First matching block wins.
    Optionally narrows bbox to the line containing the anchor for sentence-level highlight.
    """
    import re
    if not anchor_quote or not searchable_blocks:
        return None
    anchor_normalized = re.sub(r'\s+', ' ', anchor_quote.strip().lower())
    if not anchor_normalized:
        return None
    for block in searchable_blocks:
        content = (block.get('content') or '').strip()
        if not content:
            continue
        content_normalized = re.sub(r'\s+', ' ', content.lower())
        if anchor_normalized in content_normalized:
            page = block.get('page', 0)
            bbox = block.get('bbox') or {}
            bbox = {
                'left': round(float(bbox.get('left', 0)), 4),
                'top': round(float(bbox.get('top', 0)), 4),
                'width': round(float(bbox.get('width', 0)), 4),
                'height': round(float(bbox.get('height', 0)), 4),
                'page': int(page) if page is not None else 0
            }
            if narrow_to_line and content and anchor_quote:
                try:
                    narrowed = _narrow_bbox_to_cited_line(
                        content, bbox, anchor_quote
                    )
                    if narrowed:
                        bbox = narrowed
                except Exception as e:
                    logger.debug("Could not narrow bbox to line: %s", e)
            return {
                'doc_id': block.get('doc_id', ''),
                'block_id': block.get('block_id', ''),
                'page': int(page) if page is not None else 0,
                'bbox': bbox,
                'cited_text': anchor_quote,
                'content': content,
                'confidence': block.get('confidence', 'medium'),
                'method': 'anchor-quote-lookup'
            }
    return None


def resolve_anchor_quote_to_bbox_fuzzy(
    anchor_quote: str,
    searchable_blocks: List[Dict[str, Any]],
    min_word_overlap_ratio: float = 0.4,
) -> Optional[Dict[str, Any]]:
    """
    Fallback when exact anchor match fails: find block with highest word overlap.
    Returns bbox with confidence 'low'. Used only when resolve_anchor_quote_to_bbox returns None.
    """
    import re
    if not anchor_quote or not searchable_blocks:
        return None
    anchor_normalized = re.sub(r'\s+', ' ', anchor_quote.strip().lower())
    words_anchor = set(re.findall(r'\w+', anchor_normalized))
    if not words_anchor:
        return None
    best_block = None
    best_score = 0.0
    for block in searchable_blocks:
        content = (block.get('content') or '').strip()
        if not content:
            continue
        content_normalized = re.sub(r'\s+', ' ', content.lower())
        words_block = set(re.findall(r'\w+', content_normalized))
        overlap = len(words_anchor & words_block) / len(words_anchor)
        if overlap >= min_word_overlap_ratio and overlap > best_score:
            best_score = overlap
            best_block = block
    if not best_block:
        return None
    page = best_block.get('page', 0)
    bbox = best_block.get('bbox') or {}
    bbox = {
        'left': round(float(bbox.get('left', 0)), 4),
        'top': round(float(bbox.get('top', 0)), 4),
        'width': round(float(bbox.get('width', 0)), 4),
        'height': round(float(bbox.get('height', 0)), 4),
        'page': int(page) if page is not None else 0
    }
    return {
        'doc_id': best_block.get('doc_id', ''),
        'block_id': best_block.get('block_id', ''),
        'page': int(page) if page is not None else 0,
        'bbox': bbox,
        'cited_text': anchor_quote,
        'content': (best_block.get('content') or '').strip(),
        'confidence': 'low',
        'method': 'anchor-quote-fuzzy'
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
    
    def _normalize_cited_text(self, text: str) -> str:
        """
        Normalize cited text for comparison - extract key facts.
        
        Args:
            text: The cited text to normalize
        
        Returns:
            Normalized string for comparison
        """
        import re
        # Convert to lowercase
        normalized = text.lower()
        # Extract key information: ratings (e.g., "D", "D1"), values, dates, names
        # For EPC ratings, extract the rating letter/number
        epc_match = re.search(r'epc\s*rating[:\s]*([a-g]\d?)', normalized, re.IGNORECASE)
        if epc_match:
            return f"epc rating: {epc_match.group(1).upper()}"
        # For values/amounts, extract the number
        value_match = re.search(r'£?([\d,]+\.?\d*)', normalized)
        if value_match:
            value = value_match.group(1).replace(',', '').replace('.', '')
            # Try to find context (e.g., "market value", "90-day")
            context = ''
            if 'market value' in normalized:
                context = 'market value'
            elif '90-day' in normalized or '90 day' in normalized:
                context = '90-day'
            elif '180-day' in normalized or '180 day' in normalized:
                context = '180-day'
            elif 'rent' in normalized:
                context = 'rent'
            return f"{context}: {value}" if context else value
        # For dates, extract date pattern
        date_match = re.search(r'(\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4})', normalized)
        if date_match:
            return f"date: {date_match.group(1)}"
        # For names, extract name pattern
        name_match = re.search(r'(?:valuer|inspector|by|conducted by)[:\s]+([a-z]+\s+[a-z]+)', normalized)
        if name_match:
            return f"name: {name_match.group(1)}"
        # Fallback: return first 50 chars of key terms
        key_terms = re.findall(r'\b\w{4,}\b', normalized)
        return ' '.join(key_terms[:5])
    
    def _is_duplicate_citation(self, cited_text: str, block_id: str) -> bool:
        """
        Check if a citation is a duplicate of an existing one.
        
        Args:
            cited_text: The text being cited
            block_id: The block ID being cited
        
        Returns:
            True if this is a duplicate, False otherwise
        """
        normalized_new = self._normalize_cited_text(cited_text)
        
        for existing_citation in self.citations:
            # CRITICAL: Same block_id with same normalized fact = duplicate
            # Even if block_id is different, if normalized facts match, it's likely a duplicate
            existing_block_id = existing_citation.get('block_id')
            normalized_existing = self._normalize_cited_text(existing_citation.get('cited_text', ''))
            
            # If same block_id, it's definitely a duplicate (same source)
            if existing_block_id == block_id:
                # Same block + same normalized fact = duplicate
                if normalized_new == normalized_existing:
                    logger.info(
                        f"[CITATION_TOOL] 🔍 Duplicate citation detected (same block + same fact): "
                        f"block_id={block_id}, existing='{existing_citation.get('cited_text', '')[:50]}...', "
                        f"new='{cited_text[:50]}...', normalized='{normalized_new}'"
                    )
                    return True
                # Same block + similar fact (subset) = duplicate
                if normalized_new in normalized_existing or normalized_existing in normalized_new:
                    logger.info(
                        f"[CITATION_TOOL] 🔍 Similar citation detected (same block + similar fact): "
                        f"block_id={block_id}, existing='{existing_citation.get('cited_text', '')[:50]}...', "
                        f"new='{cited_text[:50]}...'"
                    )
                    return True
            
            # Even if different block_id, if normalized facts match exactly, it's likely the same fact
            # (e.g., EPC rating D might appear in multiple blocks, but it's the same fact)
            if normalized_new == normalized_existing and normalized_new.startswith(('epc rating:', 'date:', 'name:')):
                logger.info(
                    f"[CITATION_TOOL] 🔍 Duplicate citation detected (same fact, different block): "
                    f"existing_block={existing_block_id}, new_block={block_id}, "
                    f"existing='{existing_citation.get('cited_text', '')[:50]}...', "
                    f"new='{cited_text[:50]}...', normalized='{normalized_new}'"
                )
                return True
        
        return False
    
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
        # Check for duplicate citations before processing
        if self._is_duplicate_citation(cited_text, block_id):
            existing_citation = next(
                (c for c in self.citations if c.get('block_id') == block_id),
                None
            )
            if existing_citation:
                logger.info(
                    f"[CITATION_TOOL] ⚠️ Skipping duplicate citation {citation_number}: "
                    f"block_id={block_id}, already exists as citation {existing_citation.get('citation_number')}. "
                    f"Existing: '{existing_citation.get('cited_text', '')[:50]}...', "
                    f"New: '{cited_text[:50]}...'"
                )
                return f"⚠️ Citation {citation_number} skipped - duplicate of citation {existing_citation.get('citation_number')} for same fact"
        
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
        
        # Prefer the LLM-provided block_id when it exists in the metadata table.
        # Only fall back to semantic "best match" when the direct block content doesn't verify.
        # The previous behavior (always overriding block_id) can cause citation # -> bbox mismatches,
        # where clicking a citation opens an unrelated location.
        direct_block_content = (block_metadata or {}).get('content', '') or ''
        direct_verification = verify_citation_match(cited_text, direct_block_content) if direct_block_content else {'confidence': 'low'}
        if direct_verification.get('confidence') in ('high', 'medium'):
            logger.info(
                f"[CITATION_TOOL] ✅ Using direct block_id for citation {citation_number}: {block_id} "
                f"(confidence: {direct_verification.get('confidence')})"
            )
        else:
            logger.info(
                f"[CITATION_TOOL] 🔍 Direct block_id verification low for citation {citation_number}; "
                f"falling back to semantic search. block_id={block_id}, confidence={direct_verification.get('confidence')}"
            )
        
        # Key semantic terms that indicate professional valuation vs market activity
        valuation_terms = ['market value', 'assessed', 'valuation', 'valued at', 'professional', 'valuer', 'mrics', '90-day', '180-day', 'marketing period']
        market_activity_terms = ['offer', 'rejected', 'marketing', 'guide price', 'under offer', 'viewing', 'savills']
        
        # Check if cited_text contains valuation terms
        cited_lower = cited_text.lower()
        is_valuation_query = any(term in cited_lower for term in valuation_terms)
        is_market_activity_query = any(term in cited_lower for term in market_activity_terms)
        
        # Search all blocks using Phase 2 semantic matching logic (only used as fallback)
        best_match = None
        best_score = -1
        best_confidence = 'low'
        
        if direct_verification.get('confidence') not in ('high', 'medium'):
            for search_doc_id, search_metadata_table in self.metadata_lookup_tables.items():
                for search_block_id, search_block_meta in search_metadata_table.items():
                    search_block_content = search_block_meta.get('content', '')
                    if not search_block_content:
                        continue
                
                block_lower = search_block_content.lower()
                
                # Verify match using same logic as Phase 2
                verification = verify_citation_match(cited_text, search_block_content)
                score = 0
                
                # Base score from verification (same as Phase 2)
                if verification['confidence'] == 'high':
                    score += 100
                elif verification['confidence'] == 'medium':
                    score += 50
                else:
                    score += 10
                
                # Semantic context bonus: prioritize blocks that match the semantic type (same as Phase 2)
                if is_valuation_query:
                    # Boost blocks that contain valuation terms
                    if any(term in block_lower for term in valuation_terms):
                        score += 50
                    # Penalize blocks that contain market activity terms (unless also in query)
                    if not is_market_activity_query and any(term in block_lower for term in market_activity_terms):
                        score -= 30
                
                if is_market_activity_query:
                    # Boost blocks that contain market activity terms
                    if any(term in block_lower for term in market_activity_terms):
                        score += 50
                
                # Bonus for matching key terms from cited_text (same as Phase 2)
                matched_terms = verification.get('matched_terms', [])
                if len(matched_terms) > 2:  # Multiple term matches = better semantic match
                    score += len(matched_terms) * 5
                
                # Penalty for missing important terms (same as Phase 2)
                missing_terms = verification.get('missing_terms', [])
                if len(missing_terms) > 3:  # Many missing terms = likely wrong match
                    score -= len(missing_terms) * 3
                
                # CRITICAL: Extra bonus for exact numeric matches (prioritize blocks with same numbers)
                numeric_matches = verification.get('numeric_matches', [])
                if numeric_matches:
                    score += len(numeric_matches) * 30  # Strong bonus for numeric matches
                
                # Update best match if this score is higher
                    if score > best_score:
                        best_score = score
                        best_match = {
                            'block_id': search_block_id,
                            'block_metadata': search_block_meta,
                            'doc_id': search_doc_id,
                            'verification': verification,
                            'score': score,
                            'content': search_block_content
                        }
                        # Update confidence based on score (same as Phase 2)
                        if score >= 100:
                            best_confidence = 'high'
                        elif score >= 50:
                            best_confidence = 'medium'
                        else:
                            best_confidence = 'low'
        
        # Use best match found (same logic as Phase 2) - only when direct verification failed.
        if direct_verification.get('confidence') not in ('high', 'medium') and best_match and best_confidence in ['high', 'medium']:
            if best_match['block_id'] != block_id:
                logger.warning(
                    f"[CITATION_TOOL] ✅ Phase 1: Found better block match for citation {citation_number}:\n"
                    f"  - LLM suggested: {block_id}\n"
                    f"  - Best match: {best_match['block_id']} (score: {best_score}, confidence: {best_confidence})\n"
                    f"  - cited_text: '{cited_text[:80]}...'\n"
                    f"  - Best block content: '{best_match['content'][:80]}...'\n"
                    f"  - Numeric matches: {best_match['verification']['numeric_matches']}\n"
                    f"  - Matched terms: {best_match['verification']['matched_terms']}"
                )
            else:
                logger.info(
                    f"[CITATION_TOOL] ✅ Phase 1: LLM's block_id {block_id} matches best semantic match "
                    f"(score: {best_score}, confidence: {best_confidence})"
                )
            
            # Use the best match found
            # CRITICAL: Update all three together to ensure they're in sync
            corrected_block_id = best_match['block_id']
            corrected_block_metadata = best_match['block_metadata']
            corrected_doc_id = best_match['doc_id']
            
            # Verify the corrected block_id exists in the metadata table for the corrected doc_id
            if corrected_block_id not in self.metadata_lookup_tables.get(corrected_doc_id, {}):
                logger.error(
                    f"[CITATION_TOOL] ❌ CRITICAL: Corrected block_id {corrected_block_id} not found in "
                    f"doc {corrected_doc_id[:8]} metadata table! This indicates a mismatch."
                )
                # Try to find it in any doc
                found_in_other_doc = False
                for fallback_doc_id, fallback_metadata_table in self.metadata_lookup_tables.items():
                    if corrected_block_id in fallback_metadata_table:
                        corrected_block_metadata = fallback_metadata_table[corrected_block_id]
                        corrected_doc_id = fallback_doc_id
                        found_in_other_doc = True
                        logger.warning(
                            f"[CITATION_TOOL] ✅ Recovered: Found block_id {corrected_block_id} in doc {fallback_doc_id[:8]}"
                        )
                        break
                if not found_in_other_doc:
                    logger.error(
                        f"[CITATION_TOOL] ❌❌❌ Could not recover - block_id {corrected_block_id} not found in any metadata table!"
                    )
                    # Fallback to original (shouldn't happen, but safety)
                    corrected_block_id = block_id
                    corrected_block_metadata = block_metadata
                    corrected_doc_id = doc_id
            
            # Update variables with corrected values (all in sync)
            block_id = corrected_block_id
            block_metadata = corrected_block_metadata
            doc_id = corrected_doc_id
            
            _debug_log({
                "location": "citation_mapping.add_citation:verified_block_sync",
                "data": {
                    "citation_number": citation_number,
                    "block_id": block_id,
                    "doc_id": (doc_id[:8] if doc_id else "UNKNOWN"),
                    "block_id_in_metadata": block_id in self.metadata_lookup_tables.get(doc_id, {}),
                    "block_content_preview": best_match['content'][:100] if best_match else None,
                    "numeric_matches": best_match['verification']['numeric_matches'] if best_match else None,
                    "matched_terms": best_match['verification']['matched_terms'] if best_match else None,
                    "score": best_score,
                    "confidence": best_confidence
                }
            })
        elif best_match:
            logger.error(
                f"[CITATION_TOOL] ❌ Phase 1: Low confidence match for citation {citation_number} "
                f"(score: {best_score}, confidence: {best_confidence})\n"
                f"  - cited_text: '{cited_text}'\n"
                f"  - Best match block: {best_match['block_id']}\n"
                f"  - Will use best match anyway (no better option)"
            )
            # Still use best match even if low confidence (better than nothing)
            # CRITICAL: Update all three together to ensure they're in sync
            corrected_block_id = best_match['block_id']
            corrected_block_metadata = best_match['block_metadata']
            corrected_doc_id = best_match['doc_id']
            
            # Verify sync
            if corrected_block_id not in self.metadata_lookup_tables.get(corrected_doc_id, {}):
                logger.error(
                    f"[CITATION_TOOL] ❌ CRITICAL: Low confidence block_id {corrected_block_id} not found in "
                    f"doc {corrected_doc_id[:8]} metadata table!"
                )
                # Try to find it in any doc
                for fallback_doc_id, fallback_metadata_table in self.metadata_lookup_tables.items():
                    if corrected_block_id in fallback_metadata_table:
                        corrected_block_metadata = fallback_metadata_table[corrected_block_id]
                        corrected_doc_id = fallback_doc_id
                        break
            
            block_id = corrected_block_id
            block_metadata = corrected_block_metadata
            doc_id = corrected_doc_id
        else:
            logger.error(
                f"[CITATION_TOOL] ❌❌❌ Phase 1: NO MATCH FOUND for citation {citation_number}!\n"
                f"  - cited_text: '{cited_text}'\n"
                f"  - Will use LLM's original block_id {block_id} (may be WRONG!)"
            )
            # Fallback to original (shouldn't happen, but safety)
        
        # CRITICAL: Use single source of truth for bbox extraction
        # Use map_block_id_to_bbox() to ensure consistent bbox extraction across codebase
        # Import from citation_mapping module (same package, different file)
        from backend.llm.citation_mapping import map_block_id_to_bbox
        
        # CRITICAL: Verify block_id and block_metadata are in sync after semantic search correction
        # After semantic search, block_id may have been corrected, so we must use the metadata
        # from the corrected block, not the original block
        # Verify: block_metadata should be from the same block as block_id
        if block_id not in self.metadata_lookup_tables.get(doc_id, {}):
            logger.error(
                f"[CITATION_TOOL] ❌ CRITICAL MISMATCH: block_id {block_id} not found in doc {doc_id[:8]} metadata table! "
                f"This indicates block_id and block_metadata are out of sync after semantic search."
            )
            # Fallback: try to find block_metadata from the corrected block_id
            for fallback_doc_id, fallback_metadata_table in self.metadata_lookup_tables.items():
                if block_id in fallback_metadata_table:
                    block_metadata = fallback_metadata_table[block_id]
                    doc_id = fallback_doc_id
                    logger.warning(
                        f"[CITATION_TOOL] ✅ Recovered: Found block_id {block_id} in doc {fallback_doc_id[:8]}"
                    )
                    break
            else:
                logger.error(
                    f"[CITATION_TOOL] ❌❌❌ Could not recover - block_id {block_id} not found in any metadata table!"
                )
                return f"⚠️ Citation {citation_number} recorded but block {block_id} not found in metadata tables"
        
        # CRITICAL: Double-check that block_metadata is actually for this block_id
        # Get the canonical metadata from the lookup table to ensure we're using the right one
        canonical_metadata = self.metadata_lookup_tables.get(doc_id, {}).get(block_id)
        if canonical_metadata:
            # Use canonical metadata to ensure 100% accuracy
            block_metadata = canonical_metadata
            logger.debug(
                f"[CITATION_TOOL] ✅ Using canonical metadata for block_id {block_id} from doc {doc_id[:8]}"
            )
        else:
            logger.warning(
                f"[CITATION_TOOL] ⚠️ Could not get canonical metadata for block_id {block_id} from doc {doc_id[:8]}, "
                f"using block_metadata from semantic search (may be correct but not verified)"
            )
        
        # Create lookup table with just this block for the mapping function
        # CRITICAL: Ensure block_id and block_metadata are from the same block
        single_block_table = {block_id: block_metadata}
        
        _debug_log({
            "location": "citation_mapping.add_citation:pre_bbox_mapping_sync_check",
            "data": {
                "citation_number": citation_number,
                "block_id": block_id,
                "doc_id": (doc_id[:8] if doc_id else "UNKNOWN"),
                "block_id_in_metadata_table": block_id in self.metadata_lookup_tables.get(doc_id, {}),
                "using_canonical_metadata": canonical_metadata is not None,
                "block_metadata_keys": list(block_metadata.keys()) if block_metadata else [],
                "has_bbox_left": ("bbox_left" in block_metadata) if block_metadata else False,
                "has_bbox_top": ("bbox_top" in block_metadata) if block_metadata else False,
            },
        })
        
        bbox_data = map_block_id_to_bbox(block_id, single_block_table)
        
        if not bbox_data:
            logger.error(
                f"[CITATION_TOOL] ❌ Could not map block_id {block_id} to BBOX for citation {citation_number}. "
                f"Block metadata keys: {list(block_metadata.keys()) if block_metadata else 'None'}"
            )
            return f"⚠️ Citation {citation_number} recorded but bbox mapping failed for {block_id}"
        
        bbox = bbox_data.get('bbox', {})
        page_number = bbox_data.get('page', 0)
        
        # Validate bbox coordinates - check for fallback/default values
        bbox_left = bbox.get('left', 0.0)
        bbox_top = bbox.get('top', 0.0)
        bbox_width = bbox.get('width', 0.0)
        bbox_height = bbox.get('height', 0.0)
        
        is_fallback_bbox = (
            bbox_left == 0.0 and
            bbox_top == 0.0 and
            bbox_width == 1.0 and
            bbox_height == 1.0
        )
        
        if is_fallback_bbox:
            logger.warning(
                f"[CITATION_TOOL] ⚠️ Citation {citation_number} uses fallback BBOX (0,0,1,1) "
                f"for block {block_id} - coordinates may be inaccurate. "
                f"Block content preview: {block_metadata.get('content', '')[:100]}..."
            )
        
        # Validate bbox dimensions are reasonable (not zero width/height unless it's a point)
        if bbox_width <= 0 or bbox_height <= 0:
            logger.warning(
                f"[CITATION_TOOL] ⚠️ Citation {citation_number} has invalid bbox dimensions "
                f"(width: {bbox_width}, height: {bbox_height}) for block {block_id}"
            )
        
        # Get block content for verification
        block_content = block_metadata.get('content', '')
        
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
        
        _debug_log({
            "location": "citation_mapping.add_citation:mismatch_check",
            "data": {
                "citation_number": citation_number,
                "block_id": block_id,
                "cited_text_preview": cited_text[:150],
                "block_content_preview": block_content[:150],
                "page": page_number,
                "bbox": bbox,
            },
        })
        
        logger.info(
            f"[CITATION_TOOL] ✅ Citation {citation_number} added: {block_id} "
            f"(doc: {doc_id[:8] if doc_id else 'UNKNOWN'}, page: {page_number}, "
            f"bbox: {bbox['left']:.3f},{bbox['top']:.3f}, size: {bbox['width']:.3f}x{bbox['height']:.3f}, "
            f"fallback: {is_fallback_bbox})"
        )
        
        _debug_log({
            "location": "citation_mapping.add_citation:finalized",
            "data": {
                "citation_number": citation_number,
                "block_id": block_id,
                "page": page_number,
                "doc_id": (doc_id[:8] if doc_id else "UNKNOWN"),
                "bbox": bbox,
            },
        })
        
        return f"✅ Citation {citation_number} recorded for {block_id}"


def match_citation_to_chunk(chunk_id: str, cited_text: str) -> Dict[str, Any]:
    """
    Match cited text to a specific block within a chunk and return bbox coordinates.
    
    This function:
    1. Fetches the chunk from the database using chunk_id
    2. Extracts the blocks array from the chunk
    3. Matches the cited_text to the best matching block
    4. Returns precise bbox coordinates for that block
    
    Args:
        chunk_id: The UUID of the chunk from retrieve_chunks tool
        cited_text: The exact text from the chunk that should be cited (use original chunk_text, not a paraphrase)
    
    Returns:
        Dict with citation data including bbox coordinates:
        {
            'chunk_id': str,
            'document_id': str,
            'block_id': int,  # Index in blocks array
            'bbox': {
                'left': float,
                'top': float,
                'width': float,
                'height': float,
                'page': int,
                'original_page': int (optional)
            },
            'page': int,
            'cited_text': str,
            'matched_block_content': str,
            'confidence': 'high'|'medium'|'low',
            'method': 'chunk-id-lookup'
        }
        
    Raises:
        ValueError: If chunk_id is invalid or chunk not found
    """
    if not chunk_id:
        raise ValueError("chunk_id is required")
    
    if not cited_text:
        raise ValueError("cited_text is required")
    
    try:
        # Fetch chunk from database
        supabase = get_supabase_client()
        response = supabase.table('document_vectors').select(
            'id, document_id, chunk_index, page_number, bbox, blocks'
        ).eq('id', chunk_id).single().execute()
        
        if not response.data:
            logger.warning(f"[CHUNK_CITATION] Chunk {chunk_id[:20]}... not found in database")
            raise ValueError(f"Chunk {chunk_id} not found in database")
        
        chunk_data = response.data
        document_id = chunk_data.get('document_id')
        blocks = chunk_data.get('blocks', [])
        
        if not blocks:
            logger.warning(
                f"[CHUNK_CITATION] Chunk {chunk_id[:20]}... has no blocks array. "
                f"Using chunk-level bbox as fallback."
            )
            # Fallback to chunk-level bbox if no blocks
            chunk_bbox = chunk_data.get('bbox', {})
            page = chunk_data.get('page_number', chunk_bbox.get('page', 0))
            
            return {
                'chunk_id': chunk_id,
                'document_id': document_id,
                'block_id': None,  # No block-level match
                'bbox': {
                    'left': chunk_bbox.get('left', 0.0),
                    'top': chunk_bbox.get('top', 0.0),
                    'width': chunk_bbox.get('width', 0.0),
                    'height': chunk_bbox.get('height', 0.0),
                    'page': page,
                    'original_page': chunk_bbox.get('original_page', page)
                },
                'page': page,
                'cited_text': cited_text,
                'matched_block_content': None,
                'confidence': 'low',
                'method': 'chunk-id-lookup-fallback'
            }
        
        # Match cited_text to best block within chunk
        best_match = None
        best_score = -1
        best_confidence = 'low'
        
        for block_index, block in enumerate(blocks):
            block_content = block.get('content', '')
            if not block_content:
                continue
            
            # Use existing verify_citation_match function
            verification = verify_citation_match(cited_text, block_content)
            
            # Calculate match score
            score = 0
            if verification['confidence'] == 'high':
                score += 100
            elif verification['confidence'] == 'medium':
                score += 50
            else:
                score += 10
            
            # Bonus for exact phrase match
            if verification.get('matched_terms') and 'exact_phrase_match' in verification['matched_terms']:
                score += 50
            
            # Bonus for numeric matches
            numeric_matches = verification.get('numeric_matches', [])
            if numeric_matches:
                score += len(numeric_matches) * 30
            
            # Update best match if this score is higher
            if score > best_score:
                best_score = score
                best_match = {
                    'block_index': block_index,
                    'block': block,
                    'verification': verification
                }
                best_confidence = verification['confidence']
        
        if not best_match:
            logger.warning(
                f"[CHUNK_CITATION] No matching block found for cited_text in chunk {chunk_id[:20]}... "
                f"cited_text: '{cited_text[:50]}...'"
            )
            # Fallback to chunk-level bbox
            chunk_bbox = chunk_data.get('bbox', {})
            page = chunk_data.get('page_number', chunk_bbox.get('page', 0))
            
            return {
                'chunk_id': chunk_id,
                'document_id': document_id,
                'block_id': None,
                'bbox': {
                    'left': chunk_bbox.get('left', 0.0),
                    'top': chunk_bbox.get('top', 0.0),
                    'width': chunk_bbox.get('width', 0.0),
                    'height': chunk_bbox.get('height', 0.0),
                    'page': page,
                    'original_page': chunk_bbox.get('original_page', page)
                },
                'page': page,
                'cited_text': cited_text,
                'matched_block_content': None,
                'confidence': 'low',
                'method': 'chunk-id-lookup-no-match'
            }
        
        # Extract bbox from best matching block
        block_bbox = best_match['block'].get('bbox', {})
        page = block_bbox.get('page', chunk_data.get('page_number', 0))
        
        result = {
            'chunk_id': chunk_id,
            'document_id': document_id,
            'block_id': best_match['block_index'],
            'bbox': {
                'left': round(float(block_bbox.get('left', 0.0)), 4),
                'top': round(float(block_bbox.get('top', 0.0)), 4),
                'width': round(float(block_bbox.get('width', 0.0)), 4),
                'height': round(float(block_bbox.get('height', 0.0)), 4),
                'page': int(page) if page is not None else 0,
            },
            'page': int(page) if page is not None else 0,
            'cited_text': cited_text,
            'matched_block_content': best_match['block'].get('content', ''),
            'confidence': best_confidence,
            'method': 'chunk-id-lookup'
        }
        
        # Add original_page if available
        if 'original_page' in block_bbox:
            result['bbox']['original_page'] = block_bbox['original_page']
        
        logger.info(
            f"[CHUNK_CITATION] ✅ Matched citation for chunk {chunk_id[:20]}... "
            f"(block_index: {best_match['block_index']}, confidence: {best_confidence}, "
            f"page: {result['page']})"
        )
        
        return result
        
    except Exception as e:
        logger.error(
            f"[CHUNK_CITATION] ❌ Error matching citation to chunk {chunk_id[:20]}...: {e}",
            exc_info=True
        )
        raise


def _narrow_bbox_to_cited_line(
    block_content: str,
    block_bbox: Dict[str, Any],
    cited_text: str,
) -> Dict[str, Any]:
    """
    Narrow a block's bbox to the line that best matches cited_text (sub-level bbox).
    Splits block content by newlines, finds best-matching line, returns proportional bbox for that line.
    """
    if not cited_text or not block_content or not block_bbox:
        return block_bbox or {}
    lines = [ln.strip() for ln in block_content.splitlines() if ln.strip()]
    if len(lines) <= 1:
        return block_bbox
    left = float(block_bbox.get('left', 0))
    top = float(block_bbox.get('top', 0))
    width = float(block_bbox.get('width', 0))
    height = float(block_bbox.get('height', 0))
    page = block_bbox.get('page', 0)
    # Normalize cited_text for matching: strip markdown, lower, keep numbers/currency
    cited_lower = cited_text.lower().strip()
    # Extract numbers/currency from cited text for robust match (e.g. 1,950,000 or £1.95m)
    import re
    cited_numbers = set(re.findall(r'[\d,]+(?:\.[\d]+)?', cited_text.replace(' ', '')))
    best_line_idx = 0
    best_score = -1
    for i, line in enumerate(lines):
        line_lower = line.lower()
        score = 0
        if cited_lower and cited_lower[:50] in line_lower:
            score += 100
        # Match numbers (e.g. 1,950,000 in line)
        line_numbers = set(re.findall(r'[\d,]+(?:\.[\d]+)?', line.replace(' ', '')))
        overlap = len(cited_numbers & line_numbers)
        if overlap:
            score += 50 * overlap
        # Word overlap (skip very short words)
        cited_words = set(w for w in cited_lower.split() if len(w) > 2)
        line_words = set(w for w in line_lower.split() if len(w) > 2)
        score += 10 * len(cited_words & line_words)
        if score > best_score:
            best_score = score
            best_line_idx = i
    if best_score <= 0:
        return block_bbox
    n = len(lines)
    line_height = height / n
    new_top = top + best_line_idx * line_height
    return {
        'left': round(left, 4),
        'top': round(new_top, 4),
        'width': round(width, 4),
        'height': round(line_height, 4),
        'page': int(page) if page is not None else 0
    }


def resolve_block_id_to_bbox(block_id: str, cited_text: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Resolve a synthetic block_id (e.g. chunk_<uuid>_block_1) to bbox.
    When cited_text is provided, returns a sub-level (line) bbox so the correct phrase is highlighted.

    Args:
        block_id: Format "chunk_<chunk_uuid>_block_<block_index>" (e.g. chunk_abc123_block_1)
        cited_text: Optional. When provided, narrows bbox to the line containing this text (e.g. "£1,950,000").

    Returns:
        Dict with doc_id, page, bbox (normalized 0-1), chunk_id, block_index; or None if not found.
    """
    if not block_id or not block_id.startswith("chunk_") or "_block_" not in block_id:
        return None
    try:
        # Parse "chunk_<chunk_uuid>_block_<index>" (chunk_uuid is document_vectors.id, UUID with hyphens)
        suffix = "_block_"
        idx = block_id.rfind(suffix)
        if idx == -1:
            return None
        chunk_id = block_id[len("chunk_"):idx]
        try:
            block_index = int(block_id[idx + len(suffix):])
        except ValueError:
            return None
        supabase = get_supabase_client()
        response = supabase.table('document_vectors').select(
            'id, document_id, page_number, bbox, blocks'
        ).eq('id', chunk_id).single().execute()
        if not response.data:
            logger.warning(f"[CITATION_BBOX] Chunk not found for block_id={block_id[:50]}...")
            return None
        chunk_data = response.data
        blocks = chunk_data.get('blocks') or []
        if not isinstance(blocks, list) or block_index < 0 or block_index >= len(blocks):
            bbox = chunk_data.get('bbox', {})
            page = chunk_data.get('page_number', bbox.get('page', 0))
            return {
                'doc_id': chunk_data.get('document_id', ''),
                'chunk_id': chunk_data.get('id', chunk_id),
                'block_index': 0,
                'page': int(page) if page is not None else 0,
                'bbox': {
                    'left': float(bbox.get('left', 0)),
                    'top': float(bbox.get('top', 0)),
                    'width': float(bbox.get('width', 0)),
                    'height': float(bbox.get('height', 0)),
                    'page': int(page) if page is not None else 0
                }
            }
        block = blocks[block_index]
        if not isinstance(block, dict):
            return None
        block_bbox_raw = block.get('bbox', {})
        page = block_bbox_raw.get('page', chunk_data.get('page_number', 0))
        block_bbox = {
            'left': round(float(block_bbox_raw.get('left', 0)), 4),
            'top': round(float(block_bbox_raw.get('top', 0)), 4),
            'width': round(float(block_bbox_raw.get('width', 0)), 4),
            'height': round(float(block_bbox_raw.get('height', 0)), 4),
            'page': int(page) if page is not None else 0
        }
        # Sub-level bbox: narrow to the line that contains cited_text (e.g. £1,950,000)
        block_content = (block.get('content') or '').strip()
        if cited_text and block_content:
            narrowed = _narrow_bbox_to_cited_line(block_content, block_bbox, cited_text)
            if narrowed != block_bbox:
                block_bbox = narrowed
                logger.info(
                    f"[CITATION_BBOX] Sub-level bbox for cited_text '{cited_text[:40]}...' "
                    f"(line match within block)"
                )
        return {
            'doc_id': chunk_data.get('document_id', ''),
            'chunk_id': chunk_data.get('id', chunk_id),
            'block_index': block_index,
            'page': int(page) if page is not None else 0,
            'bbox': block_bbox
        }
    except Exception as e:
        logger.warning(f"[CITATION_BBOX] resolve_block_id_to_bbox failed for block_id={block_id[:50]}...: {e}")
        return None


class ChunkCitationInput(BaseModel):
    """Input schema for chunk citation tool."""
    chunk_id: str = Field(
        ...,
        description="The UUID of the chunk from retrieve_chunks tool (e.g., '550e8400-e29b-41d4-a716-446655440000')"
    )
    cited_text: str = Field(
        ...,
        description="The exact text from the chunk that you want to cite. Use the original text from chunk_text, not a paraphrase. Example: 'Market Value: £1,950,000'"
    )


def create_chunk_citation_tool() -> StructuredTool:
    """
    Create a LangChain StructuredTool for matching citations to chunks.
    
    This tool allows the LLM to cite specific text from chunks by:
    1. Providing the chunk_id (from retrieve_chunks tool)
    2. Providing the exact cited_text (original text from chunk, not a paraphrase)
    3. Getting back precise bbox coordinates for that text
    
    Returns:
        LangChain StructuredTool instance
    """
    tool_description = """
## PURPOSE
Maps citations to precise bbox coordinates by matching cited text to blocks within a chunk.

This tool fetches the chunk's blocks from the database and finds the specific block that contains your cited text, returning precise bbox coordinates for highlighting.

## WHEN TO USE
- **IMMEDIATELY after receiving chunks from retrieve_chunks tool**
- When you identify a relevant chunk that contains information you want to cite
- **BEFORE generating your final answer** - capture citations during chunk analysis
- For each relevant fact in each chunk you receive

## HOW IT WORKS
1. You provide the chunk_id (from the chunk you received from retrieve_chunks)
2. You provide the exact cited_text (the original text from chunk_text, not a paraphrase)
3. The tool fetches the chunk's blocks from the database
4. The tool matches your cited_text to the specific block within the chunk
5. The tool returns precise bbox coordinates for that block

## PARAMETERS

### chunk_id (REQUIRED)
- The UUID of the chunk from retrieve_chunks tool
- Example: "550e8400-e29b-41d4-a716-446655440000"
- This is the 'chunk_id' field from the retrieve_chunks result

### cited_text (REQUIRED)
- The exact text from the chunk that you want to cite
- **CRITICAL: Use the original text from chunk_text, not a paraphrase**
- Example: "Market Value: £1,950,000"
- Example: "Valuation date: 15 March 2024"
- Example: "Valuer: John Smith MRICS"

## RETURN VALUE
{
    'chunk_id': str,
    'document_id': str,
    'block_id': int,  # Index in blocks array
    'bbox': {
        'left': float,
        'top': float,
        'width': float,
        'height': float,
        'page': int
    },
    'page': int,
    'cited_text': str,
    'matched_block_content': str,
    'confidence': 'high'|'medium'|'low',
    'method': 'chunk-id-lookup'
}

## EXAMPLES

### Example 1: Basic Usage
1. Call retrieve_chunks(query="property valuation", document_ids=["doc1"])
   → Returns: [{"chunk_id": "chunk1", "chunk_text": "Market Value: £1,950,000\\nValuation date: 15 March 2024", ...}]

2. **IMMEDIATELY** call match_citation_to_chunk(
       chunk_id="chunk1",
       cited_text="Market Value: £1,950,000"
   )
   → Returns: {bbox: {...}, page: 1, confidence: 'high', ...}

3. Then generate your answer with the citation

### Example 2: Multiple Citations from Same Chunk
1. Receive chunk from retrieve_chunks:
   {"chunk_id": "chunk1", "chunk_text": "Market Value: £1,950,000\\n90-day value: £1,800,000\\nValuation date: 15 March 2024", ...}

2. For each relevant fact, call match_citation_to_chunk:
   - match_citation_to_chunk(chunk_id="chunk1", cited_text="Market Value: £1,950,000")
   - match_citation_to_chunk(chunk_id="chunk1", cited_text="90-day value: £1,800,000")
   - match_citation_to_chunk(chunk_id="chunk1", cited_text="Valuation date: 15 March 2024")

3. Collect all citation results
4. Generate answer with citations

### Example 3: Multiple Chunks
1. Receive multiple chunks from retrieve_chunks
2. For each chunk, identify relevant facts
3. For each fact, call match_citation_to_chunk with that chunk's chunk_id
4. Generate answer with all citations

## IMPORTANT NOTES
- **Call this tool IMMEDIATELY after receiving chunks, not after generating your answer**
- Use the **original text from chunk_text**, not a paraphrase
- This ensures accurate citation mapping
- The tool automatically finds the best matching block within the chunk
- Confidence levels: 'high' (exact match), 'medium' (close match), 'low' (fuzzy match)
"""
    
    return StructuredTool.from_function(
        func=match_citation_to_chunk,
        name="match_citation_to_chunk",
        description=tool_description,
        args_schema=ChunkCitationInput
    )


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

**⚠️ CRITICAL FOR VALUATION QUERIES:**
If the user is asking about "value" or "valuation", you MUST cite:
- Primary Market Value (e.g., "Market Value: £X,XXX,XXX")
- ALL reduced marketing period values (e.g., "90-day value: £X,XXX,XXX", "180-day value: £X,XXX,XXX")
- Market Rent (e.g., "Market Rent: £X,XXX per calendar month")
- **DO NOT** skip any valuation scenarios - search through ALL document extracts, including later pages (28-30+)

**HOW TO USE:**
1. Find factual claims in the document extracts (look for <BLOCK> tags)
2. **CRITICAL - VERIFY BLOCK MATCHES FACT**: Before calling this tool, VERIFY that the block_id you're using actually contains the fact you're citing. Check that the block content contains the EXACT value/amount/date/name you're citing.
3. For EACH factual claim, call this tool:
   - block_id: The BLOCK_CITE_ID from the <BLOCK> tag (e.g., "BLOCK_CITE_ID_42") - **MUST contain the fact you're citing**
   - citation_number: Sequential number (1, 2, 3, 4, 5...)
   - cited_text: The factual claim (exact text or your paraphrase)

**EXAMPLES:**
- cite_source(block_id="BLOCK_CITE_ID_42", citation_number=1, cited_text="Market Value: £X,XXX,XXX")
  - ✅ CORRECT: Block 42 contains "Market Value: £X,XXX,XXX"
- cite_source(block_id="BLOCK_CITE_ID_15", citation_number=2, cited_text="Valuation date: DD Month YYYY")
  - ✅ CORRECT: Block 15 contains "DD Month YYYY"
- cite_source(block_id="BLOCK_CITE_ID_7", citation_number=3, cited_text="Valuer: Example Valuer MRICS")
  - ✅ CORRECT: Block 7 contains "Example Valuer MRICS"
- cite_source(block_id="BLOCK_CITE_ID_531", citation_number=3, cited_text="90-day value: £X,XXX,XXX")
  - ❌ WRONG: Block 531 contains "under offer at £X,XXX,XXX" (different value!)
  - ✅ CORRECT: Find the block that contains "£X,XXX,XXX" and "90-day" and use that block_id instead

**CRITICAL:**
- You MUST call this tool multiple times (minimum 3-5 calls for most queries)
- Use sequential citation numbers starting from 1
- Find BLOCK_CITE_ID in the <BLOCK> tags from document extracts
- Do NOT skip citations - cite every relevant factual claim
- Tool calls are MANDATORY - you cannot proceed without calling this tool""",
        args_schema=CitationInput
    )
    
    return tool, citation_tool_instance


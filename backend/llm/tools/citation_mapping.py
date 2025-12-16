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
    
    # #region agent log
    import json
    try:
        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
            f.write(json.dumps({
                'sessionId': 'debug-session',
                'runId': 'run1',
                'hypothesisId': 'I',
                'location': 'citation_mapping.py:49',
                'message': 'VERIFY_CITATION_MATCH: Number extraction',
                'data': {
                    'cited_text_preview': cited_text[:150],
                    'block_content_preview': block_content[:150],
                    'cited_numbers': cited_numbers,
                    'cited_numbers_normalized': cited_numbers_normalized,
                    'block_numbers': block_numbers,
                    'block_numbers_normalized': block_numbers_normalized
                },
                'timestamp': int(__import__('time').time() * 1000)
            }) + '\n')
    except: pass
    # #endregion
    
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
    
    # CRITICAL: For valuation figures, require EXACT numeric match
    # If cited_text contains a specific amount (e.g., "£1,950,000"), the block MUST contain that exact amount
    is_valuation_figure = any(keyword in cited_text.lower() for keyword in ['value', 'valuation', 'price', 'rent', 'amount', 'worth'])
    has_specific_amount = len(cited_numbers_normalized) > 0
    
    # #region agent log
    import json
    try:
        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
            f.write(json.dumps({
                'sessionId': 'debug-session',
                'runId': 'run1',
                'hypothesisId': 'I',
                'location': 'citation_mapping.py:68',
                'message': 'VERIFY_CITATION_MATCH: Checking exact amount requirement',
                'data': {
                    'is_valuation_figure': is_valuation_figure,
                    'has_specific_amount': has_specific_amount,
                    'cited_numbers_normalized': cited_numbers_normalized,
                    'block_numbers_normalized': block_numbers_normalized,
                    'cited_text_preview': cited_text[:100],
                    'block_content_preview': block_content[:100]
                },
                'timestamp': int(__import__('time').time() * 1000)
            }) + '\n')
    except: pass
    # #endregion
    
    # If it's a valuation figure with a specific amount, require that amount to be in the block
    if is_valuation_figure and has_specific_amount:
        # CRITICAL FIX: Use the LARGEST number as primary amount (valuation figures are usually the largest)
        # This handles cases like "90-Day Value: £1,950,000" where "90" appears first but "1950000" is the actual amount
        primary_amount = max(cited_numbers_normalized, key=lambda x: (len(x), int(x) if x.isdigit() else 0))
        amount_in_block = primary_amount in block_numbers_normalized
        
        # #region agent log
        try:
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({
                    'sessionId': 'debug-session',
                    'runId': 'run1',
                    'hypothesisId': 'I',
                    'location': 'citation_mapping.py:75',
                    'message': 'VERIFY_CITATION_MATCH: Checking if primary amount (LARGEST) is in block',
                    'data': {
                        'cited_numbers_normalized': cited_numbers_normalized,
                        'primary_amount': primary_amount,
                        'amount_in_block': amount_in_block,
                        'block_numbers_normalized': block_numbers_normalized,
                        'will_return_false': not amount_in_block
                    },
                    'timestamp': int(__import__('time').time() * 1000)
                }) + '\n')
        except: pass
        # #endregion
        
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
        
        # CRITICAL: Use Phase 2 semantic matching approach - ignore LLM's block_id
        # Search ALL blocks and find the best match using semantic scoring (same as Phase 2)
        logger.info(
            f"[CITATION_TOOL] 🔍 Phase 1: Searching for best block match for citation {citation_number}: "
            f"'{cited_text[:80]}...' (LLM suggested block_id: {block_id}, but will find best match)"
        )
        
        # Key semantic terms that indicate professional valuation vs market activity
        valuation_terms = ['market value', 'assessed', 'valuation', 'valued at', 'professional', 'valuer', 'mrics', '90-day', '180-day', 'marketing period']
        market_activity_terms = ['offer', 'rejected', 'marketing', 'guide price', 'under offer', 'viewing', 'savills']
        
        # Check if cited_text contains valuation terms
        cited_lower = cited_text.lower()
        is_valuation_query = any(term in cited_lower for term in valuation_terms)
        is_market_activity_query = any(term in cited_lower for term in market_activity_terms)
        
        # Search all blocks using Phase 2 semantic matching logic
        best_match = None
        best_score = -1
        best_confidence = 'low'
        
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
        
        # Use best match found (same logic as Phase 2)
        if best_match and best_confidence in ['high', 'medium']:
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
            
            # #region agent log
            import json
            try:
                with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                    f.write(json.dumps({
                        'sessionId': 'debug-session',
                        'runId': 'run1',
                        'hypothesisId': 'A',
                        'location': 'citation_mapping.py:268',
                        'message': 'Phase 1 citation created with verified block_id/block_metadata sync',
                        'data': {
                            'citation_number': citation_number,
                            'cited_text': cited_text,
                            'block_id': block_id,
                            'doc_id': doc_id[:8] if doc_id else 'UNKNOWN',
                            'block_id_in_metadata': block_id in self.metadata_lookup_tables.get(doc_id, {}),
                            'block_content_preview': best_match['content'][:100],
                            'numeric_matches': best_match['verification']['numeric_matches'],
                            'matched_terms': best_match['verification']['matched_terms'],
                            'score': best_score,
                            'confidence': best_confidence
                        },
                        'timestamp': int(__import__('time').time() * 1000)
                    }) + '\n')
            except: pass
            # #endregion
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
        
        # #region agent log
        import json
        try:
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({
                    'sessionId': 'debug-session',
                    'runId': 'run1',
                    'hypothesisId': 'F',
                    'location': 'citation_mapping.py:345',
                    'message': 'Verifying block_id and block_metadata sync before bbox mapping',
                    'data': {
                        'citation_number': citation_number,
                        'block_id': block_id,
                        'doc_id': doc_id[:8] if doc_id else 'UNKNOWN',
                        'block_id_in_metadata_table': block_id in self.metadata_lookup_tables.get(doc_id, {}),
                        'using_canonical_metadata': canonical_metadata is not None,
                        'block_metadata_keys': list(block_metadata.keys()) if block_metadata else [],
                        'has_bbox_left': 'bbox_left' in block_metadata if block_metadata else False,
                        'has_bbox_top': 'bbox_top' in block_metadata if block_metadata else False
                    },
                    'timestamp': int(__import__('time').time() * 1000)
                }) + '\n')
        except: pass
        # #endregion
        
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
        
        # #region agent log
        import json
        try:
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({
                    'sessionId': 'debug-session',
                    'runId': 'run1',
                    'hypothesisId': 'G',
                    'location': 'citation_mapping.py:360',
                    'message': 'CRITICAL: Phase 1 citation created - checking for £1.9m vs £2.4m mismatch',
                    'data': {
                        'citation_number': citation_number,
                        'cited_text': cited_text,
                        'block_id': block_id,
                        'block_content_preview': block_content[:150],
                        'cited_text_contains_1_9m': '1.9' in cited_text or '1,950' in cited_text,
                        'cited_text_contains_2_4m': '2.4' in cited_text or '2,400' in cited_text,
                        'block_content_contains_1_9m': '1.9' in block_content or '1,950' in block_content,
                        'block_content_contains_2_4m': '2.4' in block_content or '2,400' in block_content,
                        'page': page_number,
                        'bbox': bbox
                    },
                    'timestamp': int(__import__('time').time() * 1000)
                }) + '\n')
        except: pass
        # #endregion
        
        logger.info(
            f"[CITATION_TOOL] ✅ Citation {citation_number} added: {block_id} "
            f"(doc: {doc_id[:8] if doc_id else 'UNKNOWN'}, page: {page_number}, "
            f"bbox: {bbox['left']:.3f},{bbox['top']:.3f}, size: {bbox['width']:.3f}x{bbox['height']:.3f}, "
            f"fallback: {is_fallback_bbox})"
        )
        
        # #region agent log
        import json
        try:
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({
                    'sessionId': 'debug-session',
                    'runId': 'run1',
                    'hypothesisId': 'A',
                    'location': 'citation_mapping.py:330',
                    'message': 'Phase 1 citation finalized with BBOX',
                    'data': {
                        'citation_number': citation_number,
                        'cited_text': cited_text,
                        'block_id': block_id,
                        'bbox': bbox,
                        'page': page_number,
                        'doc_id': doc_id[:8] if doc_id else 'UNKNOWN'
                    },
                    'timestamp': int(__import__('time').time() * 1000)
                }) + '\n')
        except: pass
        # #endregion
        
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

**⚠️ CRITICAL FOR VALUATION QUERIES:**
If the user is asking about "value" or "valuation", you MUST cite:
- Primary Market Value (e.g., "Market Value: £2,300,000")
- ALL reduced marketing period values (e.g., "90-day value: £1,950,000", "180-day value: £2,050,000")
- Market Rent (e.g., "Market Rent: £6,000 per calendar month")
- **DO NOT** skip any valuation scenarios - search through ALL document extracts, including later pages (28-30+)

**HOW TO USE:**
1. Find factual claims in the document extracts (look for <BLOCK> tags)
2. **CRITICAL - VERIFY BLOCK MATCHES FACT**: Before calling this tool, VERIFY that the block_id you're using actually contains the fact you're citing. Check that the block content contains the EXACT value/amount/date/name you're citing.
3. For EACH factual claim, call this tool:
   - block_id: The BLOCK_CITE_ID from the <BLOCK> tag (e.g., "BLOCK_CITE_ID_42") - **MUST contain the fact you're citing**
   - citation_number: Sequential number (1, 2, 3, 4, 5...)
   - cited_text: The factual claim (exact text or your paraphrase)

**EXAMPLES:**
- cite_source(block_id="BLOCK_CITE_ID_42", citation_number=1, cited_text="Market Value: £2,300,000")
  - ✅ CORRECT: Block 42 contains "Market Value: £2,300,000"
- cite_source(block_id="BLOCK_CITE_ID_15", citation_number=2, cited_text="Valuation date: 12th February 2024")
  - ✅ CORRECT: Block 15 contains "12th February 2024"
- cite_source(block_id="BLOCK_CITE_ID_7", citation_number=3, cited_text="Valuer: Sukhbir Tiwana MRICS")
  - ✅ CORRECT: Block 7 contains "Sukhbir Tiwana MRICS"
- cite_source(block_id="BLOCK_CITE_ID_531", citation_number=3, cited_text="90-day value: £1,950,000")
  - ❌ WRONG: Block 531 contains "under offer at £2,400,000" (different value!)
  - ✅ CORRECT: Find the block that contains "£1,950,000" and "90-day" and use that block_id instead

**CRITICAL:**
- You MUST call this tool multiple times (minimum 3-5 calls for most queries)
- Use sequential citation numbers starting from 1
- Find BLOCK_CITE_ID in the <BLOCK> tags from document extracts
- Do NOT skip citations - cite every relevant factual claim
- Tool calls are MANDATORY - you cannot proceed without calling this tool""",
        args_schema=CitationInput
    )
    
    return tool, citation_tool_instance


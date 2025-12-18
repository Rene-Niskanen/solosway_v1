"""
Summarization code - create final unified answer from all document outputs.
"""

import logging
import os
import os
from datetime import datetime
from typing import List, Dict, Tuple, Any

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

from backend.llm.config import config
from backend.llm.types import MainWorkflowState
from backend.llm.utils.system_prompts import get_system_prompt
from backend.llm.prompts import get_summary_human_content, get_citation_extraction_prompt, get_final_answer_prompt
from backend.llm.utils.block_id_formatter import format_document_with_block_ids
from backend.llm.tools.citation_mapping import create_citation_tool
from backend.llm.nodes.retrieval_nodes import detect_query_characteristics

logger = logging.getLogger(__name__)

# Local debug log writes are expensive and should be disabled in production.
_LLM_DEBUG = os.environ.get("LLM_DEBUG") == "1"
# Default to /dev/null when debug is off to avoid disk I/O on the hot path.
_DEBUG_LOG_PATH = (
    os.environ.get("LLM_DEBUG_LOG_PATH", "/Users/thomashorner/solosway_v1/.cursor/debug.log")
    if _LLM_DEBUG
    else "/dev/null"
)

def _debug_log(payload: dict) -> None:
    if not _LLM_DEBUG:
        return
    try:
        import json
        with open(_DEBUG_LOG_PATH, "a") as f:
            f.write(json.dumps(payload) + "\n")
    except Exception:
        pass


def _extract_citations_from_text(
    summary: str,
    metadata_lookup_tables: Dict[str, Dict[str, Dict[str, Any]]],
    citation_tool_instance
) -> Tuple[List[Dict], str]:
    """
    Extract citations from generated text by matching facts/values to blocks.
    
    This is faster than real-time tool calls because:
    1. Single LLM call generates answer (~5s)
    2. Post-processing extracts citations by matching text to blocks (~0.1s)
    3. Total: ~5s instead of ~11s (5s + 5s follow-up)
    
    Args:
        summary: Generated answer text (may contain superscript citations like ¹, ², ³)
        metadata_lookup_tables: Map of doc_id -> block_id -> metadata
        citation_tool_instance: CitationTool instance to add citations to
    
    Returns:
        List of Citation dictionaries
    """
    import re
    from backend.llm.tools.citation_mapping import verify_citation_match
    
    citations = []
    
    # Find all citation superscripts with block IDs in the text
    # Pattern: "Fact¹ (BLOCK_CITE_ID_42)" or "Fact¹(BLOCK_CITE_ID_42)" or just "Fact¹" followed by block ID later
    # First, find all superscripts
    superscript_pattern = r'([¹²³⁴⁵⁶⁷⁸⁹]+)'
    superscript_to_num = {
        '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5, '⁶': 6, '⁷': 7, '⁸': 8, '⁹': 9, '¹⁰': 10
    }
    
    # Find all superscript citations
    superscript_matches = list(re.finditer(superscript_pattern, summary))
    
    # For each superscript, look for block ID nearby (within 100 chars after)
    matches = []
    for sup_match in superscript_matches:
        superscript = sup_match.group(1)
        citation_num = superscript_to_num.get(superscript[0], None)
        if not citation_num:
            continue
        
        # Look for block ID within 20 chars after the superscript (reduced from 100 for accuracy)
        search_start = sup_match.end()
        search_end = min(len(summary), search_start + 20)
        
        # Stop at next superscript if it appears first (prevents citation ¹ from finding block IDs belonging to citation ²)
        next_superscript_match = re.search(superscript_pattern, summary[search_start:])
        if next_superscript_match:
            search_end = min(search_end, search_start + next_superscript_match.start())
        
        text_after = summary[search_start:search_end]
        
        # Try to find block ID in parentheses
        block_id_match = re.search(r'\(BLOCK_CITE_ID_\d+\)', text_after)
        block_id = block_id_match.group(0).strip('()') if block_id_match else None
        
        matches.append({
            'match': sup_match,
            'citation_num': citation_num,
            'block_id': block_id,
            'block_id_match': block_id_match  # Keep reference to remove it later
        })
    
    # Track block IDs to remove from final response
    block_ids_to_remove = []
    
    for match_info in matches:
        match = match_info['match']
        citation_num = match_info['citation_num']
        block_id_from_text = match_info['block_id']
        
        # Track block ID location for removal
        if match_info['block_id_match']:
            block_id_start = match.end() + match_info['block_id_match'].start()
            block_id_end = block_id_start + len(match_info['block_id_match'].group(0))
            block_ids_to_remove.append((block_id_start, block_id_end))
        
        # If no block ID found within 20 chars, log warning
        if not block_id_from_text:
            logger.warning(
                f"[SUMMARIZE_RESULTS] ⚠️ No block ID found within 20 chars for citation {citation_num} "
                f"- will fall back to semantic matching"
            )
        
        # If LLM provided block ID, use it directly (this is the exact block it used!)
        if block_id_from_text:
            # Find this block in metadata tables
            found_block = None
            for doc_id, metadata_table in metadata_lookup_tables.items():
                if block_id_from_text in metadata_table:
                    found_block = {
                        'block_id': block_id_from_text,
                        'doc_id': doc_id,
                        'block_metadata': metadata_table[block_id_from_text]
                    }
                    break
            
            if found_block:
                # Validate BBOX coordinates (check not fallback 0,0,1,1)
                block_metadata = found_block['block_metadata']
                # CRITICAL: Use single source of truth for bbox extraction
                from backend.llm.citation_mapping import map_block_id_to_bbox
                single_block_table = {block_id_from_text: found_block['block_metadata']}
                bbox_data = map_block_id_to_bbox(block_id_from_text, single_block_table)
                
                if bbox_data:
                    bbox = bbox_data.get('bbox', {})
                    bbox_left = bbox.get('left', 0.0)
                    bbox_top = bbox.get('top', 0.0)
                    bbox_width = bbox.get('width', 1.0)
                    bbox_height = bbox.get('height', 1.0)
                else:
                    # Fallback if mapping fails
                    bbox_left = found_block['block_metadata'].get('bbox_left', 0.0)
                    bbox_top = found_block['block_metadata'].get('bbox_top', 0.0)
                    bbox_width = found_block['block_metadata'].get('bbox_width', 1.0)
                    bbox_height = found_block['block_metadata'].get('bbox_height', 1.0)
                
                is_fallback_bbox = (
                    bbox_left == 0.0 and
                    bbox_top == 0.0 and
                    bbox_width == 1.0 and
                    bbox_height == 1.0
                )
                
                if is_fallback_bbox:
                    logger.warning(
                        f"[SUMMARIZE_RESULTS] ⚠️ Citation {citation_num} uses fallback BBOX (0,0,1,1) "
                        f"for block {block_id_from_text} - coordinates may be inaccurate"
                    )
                
                # Extract cited text (text before the citation)
                citation_start = match.start()
                text_before = summary[max(0, citation_start - 200):citation_start].strip()
                # Find the sentence/phrase containing this citation
                sentence_start = text_before.rfind('.') + 1
                cited_text = text_before[sentence_start:].strip() if sentence_start > 0 else text_before[-100:].strip()
                
                try:
                    citation_tool_instance.add_citation(
                        cited_text=cited_text,
                        block_id=found_block['block_id'],
                        citation_number=citation_num
                    )
                    logger.info(
                        f"[SUMMARIZE_RESULTS] ✅ Citation {citation_num} → {block_id_from_text} "
                        f"(bbox_valid: {not is_fallback_bbox}): '{cited_text[:60]}...'"
                    )
                    continue  # Successfully used LLM's block ID, skip to next citation
                except Exception as e:
                    logger.warning(
                        f"[SUMMARIZE_RESULTS] Error adding citation {citation_num} with block {block_id_from_text}: {e}"
                    )
            else:
                logger.warning(
                    f"[SUMMARIZE_RESULTS] ⚠️ Block ID {block_id_from_text} not found in metadata "
                    f"for citation {citation_num} - falling back to semantic matching"
                )
        
        # Extract MORE context around citation (200 chars before, 50 chars after)
        # This captures semantic context like "Primary Market Value" vs "rejected offer"
        start = max(0, match.start() - 200)
        end = min(len(summary), match.end() + 100)  # Extended to capture block ID if present
        context = summary[start:end]
        
        # Extract the full phrase/sentence being cited (not just the number)
        # Look for the sentence or phrase containing the citation
        # Find sentence boundaries
        sentence_start = context.rfind('.', 0, match.start() - start) + 1
        sentence_end = context.find('.', match.end() - start)
        if sentence_end == -1:
            sentence_end = len(context)
        
        # Extract the full sentence/phrase
        full_phrase = context[sentence_start:sentence_end].strip()
        
        # Also extract just the immediate fact (for numeric matching)
        fact_pattern = r'([£$]?[\d,]+\.?\d*[^\s¹²³⁴⁵⁶⁷⁸⁹]*?)(?=[¹²³⁴⁵⁶⁷⁸⁹])'
        fact_match = re.search(fact_pattern, full_phrase)
        if fact_match:
            # Use the full phrase for semantic matching, but also keep the numeric part
            cited_text = full_phrase
            numeric_part = fact_match.group(1).strip()
        else:
            # Fallback: use the phrase we found
            cited_text = full_phrase
            numeric_part = None
        
        # Search for matching block in metadata tables with semantic prioritization
        best_match = None
        best_score = -1
        best_confidence = 'low'
        
        # Key semantic terms that indicate professional valuation vs market activity
        valuation_terms = ['market value', 'assessed', 'valuation', 'valued at', 'professional', 'valuer', 'mrics']
        market_activity_terms = ['offer', 'rejected', 'marketing', 'guide price', 'under offer', 'viewing']
        
        # Check if cited_text contains valuation terms
        cited_lower = cited_text.lower()
        is_valuation_query = any(term in cited_lower for term in valuation_terms)
        is_market_activity_query = any(term in cited_lower for term in market_activity_terms)
        
        for doc_id, metadata_table in metadata_lookup_tables.items():
            for block_id, block_metadata in metadata_table.items():
                block_content = block_metadata.get('content', '')
                if not block_content:
                    continue
                
                block_lower = block_content.lower()
                
                # Verify match
                verification = verify_citation_match(cited_text, block_content)
                score = 0
                
                # Base score from verification
                if verification['confidence'] == 'high':
                    score += 100
                elif verification['confidence'] == 'medium':
                    score += 50
                else:
                    score += 10
                
                # Semantic context bonus: prioritize blocks that match the semantic type
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
                
                # Bonus for matching key terms from cited_text
                matched_terms = verification.get('matched_terms', [])
                if len(matched_terms) > 2:  # Multiple term matches = better semantic match
                    score += len(matched_terms) * 5
                
                # Penalty for missing important terms
                missing_terms = verification.get('missing_terms', [])
                if len(missing_terms) > 3:  # Many missing terms = likely wrong match
                    score -= len(missing_terms) * 3
                
                # Update best match if this score is higher
                if score > best_score:
                    best_score = score
                    best_match = {
                        'block_id': block_id,
                        'doc_id': doc_id,
                        'block_metadata': block_metadata,
                        'verification': verification,
                        'score': score
                    }
                    # Update confidence based on score
                    if score >= 100:
                        best_confidence = 'high'
                    elif score >= 50:
                        best_confidence = 'medium'
                    else:
                        best_confidence = 'low'
        
        if best_match and best_confidence in ['high', 'medium']:
            try:
                citation_tool_instance.add_citation(
                    cited_text=cited_text,  # Use full phrase for better semantic matching
                    block_id=best_match['block_id'],
                    citation_number=citation_num
                )
                logger.debug(
                    f"[SUMMARIZE_RESULTS] ✅ Extracted citation {citation_num} from text: "
                    f"'{cited_text[:80]}...' -> {best_match['block_id']} "
                    f"(score: {best_match.get('score', 0)}, confidence: {best_confidence})"
                )
            except Exception as e:
                logger.warning(f"[SUMMARIZE_RESULTS] Error adding citation {citation_num}: {e}")
        elif best_match:
            logger.warning(
                f"[SUMMARIZE_RESULTS] ⚠️ Skipping citation {citation_num} - low confidence match "
                f"(score: {best_match.get('score', 0)}): '{cited_text[:50]}...'"
            )
    
    # Remove block IDs from summary (they were only for internal use)
    # Sort by position (descending) to remove from end to start (preserves indices)
    if block_ids_to_remove:
        block_ids_to_remove.sort(reverse=True)
        for start, end in block_ids_to_remove:
            # Remove the block ID and any surrounding whitespace/parentheses
            # Pattern: " (BLOCK_CITE_ID_XXX)" or "(BLOCK_CITE_ID_XXX)" or "BLOCK_CITE_ID_XXX"
            # Handle both formats: with parentheses and without
            summary = summary[:start].rstrip() + summary[end:].lstrip()
        
        # Clean up any extra spaces left behind (multiple spaces, spaces before punctuation)
        summary = re.sub(r'\s+([.,;:])', r'\1', summary)  # Remove spaces before punctuation
        summary = re.sub(r'\s{2,}', ' ', summary)  # Replace multiple spaces with single space
    
    return citation_tool_instance.citations, summary


def _renumber_citations_by_appearance(
    summary: str, 
    citations: List[Dict],
    metadata_lookup_tables: Dict[str, Dict[str, Dict[str, Any]]] = None
) -> Tuple[str, List[Dict]]:
    _debug_log({
        "location": "summary_nodes._renumber_citations_by_appearance:entry",
        "data": {
            "has_metadata_lookup_tables": metadata_lookup_tables is not None,
            "num_docs_in_tables": (len(metadata_lookup_tables) if metadata_lookup_tables else 0),
            "doc_ids": (list(metadata_lookup_tables.keys()) if metadata_lookup_tables else []),
            "num_citations": len(citations),
            "citation_numbers": [c.get("citation_number") for c in citations],
        },
    })
    """
    Renumber citations based on their order of appearance in the response text.
    
    This ensures citations are sequential (1, 2, 3...) based on when they first appear,
    not based on when they were extracted in Phase 1.
    
    CRITICAL: Validates that the fact in the text matches the Phase 1 cited_text.
    If they don't match, uses semantic search to find the correct block_id.
    
    Args:
        summary: The LLM response text with citation markers in bracket format [1], [2], [3]
        citations: List of citation dictionaries with citation_number, block_id, etc.
        metadata_lookup_tables: Map of doc_id -> block_id -> metadata (for semantic search if needed)
    
    Returns:
        Tuple of (renumbered_summary, renumbered_citations)
    """
    import re
    from backend.llm.tools.citation_mapping import verify_citation_match
    
    # Find all citation brackets in order of appearance: [1], [2], [3], etc.
    # Pattern matches bracket format: [1], [2], [123], etc.
    citation_pattern = r'\[(\d+)\]'
    matches = list(re.finditer(citation_pattern, summary))
    
    if not matches:
        logger.debug("[RENUMBER_CITATIONS] No citation brackets found in summary")
        return summary, citations
    
    # Extract citation numbers in order of appearance from brackets [1], [2], [3]
    appearance_order = []
    seen_citation_nums = set()
    
    # Log all citation numbers found in text
    all_citation_nums_in_text = [int(m.group(1)) for m in matches]
    logger.info(
        f"[RENUMBER_CITATIONS] Found {len(all_citation_nums_in_text)} citation markers in text: "
        f"{all_citation_nums_in_text[:20]}{'...' if len(all_citation_nums_in_text) > 20 else ''}"
    )
    
    for match in matches:
        citation_num = int(match.group(1))  # Extract number from [1], [2], etc.
        if citation_num not in seen_citation_nums:
            appearance_order.append(citation_num)
            seen_citation_nums.add(citation_num)
    
    logger.info(
        f"[RENUMBER_CITATIONS] Unique citation numbers in appearance order: {appearance_order}"
    )
    
    if not appearance_order:
        logger.debug("[RENUMBER_CITATIONS] No valid citation numbers extracted")
        return summary, citations
    
    # Renumber citations list
    # Create lookup: old citation_number -> citation dict
    citations_by_old_num = {cit.get('citation_number', 0): cit for cit in citations}
    
    # Log Phase 1 citations for debugging
    logger.info(
        f"[RENUMBER_CITATIONS] Phase 1 citations available: {list(citations_by_old_num.keys())} "
        f"({len(citations_by_old_num)} total)"
    )
    for old_num, cit in citations_by_old_num.items():
        block_id = cit.get('block_id', 'UNKNOWN')
        doc_id = cit.get('doc_id', 'UNKNOWN')[:8] if cit.get('doc_id') else 'UNKNOWN'
        page = cit.get('page_number', 0)
        logger.debug(
            f"[RENUMBER_CITATIONS] Phase 1 citation {old_num}: block_id={block_id}, "
            f"doc={doc_id}, page={page}"
        )
    
    # Deduplicate citations before renumbering - merge citations that refer to the same fact
    # This catches duplicates that might have slipped through Phase 1
    from backend.llm.tools.citation_mapping import CitationTool
    # Create a temporary CitationTool instance to use its normalization method
    temp_tool = CitationTool({})
    seen_normalized_facts = {}
    deduplicated_citations_by_old_num = {}
    duplicate_mappings = {}  # Map duplicate old_num -> original old_num
    
    for old_num, old_cit in citations_by_old_num.items():
        cited_text = old_cit.get('cited_text', '')
        normalized = temp_tool._normalize_cited_text(cited_text)
        
        # Check if we've seen this normalized fact before
        if normalized in seen_normalized_facts:
            # This is a duplicate - use the first citation number we saw for this fact
            existing_old_num = seen_normalized_facts[normalized]
            logger.info(
                f"[RENUMBER_CITATIONS] 🔍 Deduplicating: citation {old_num} is duplicate of {existing_old_num} "
                f"(normalized: '{normalized}')"
            )
            # Map this old_num to the existing one
            deduplicated_citations_by_old_num[old_num] = deduplicated_citations_by_old_num[existing_old_num]
            duplicate_mappings[old_num] = existing_old_num
        else:
            # First time seeing this fact
            seen_normalized_facts[normalized] = old_num
            deduplicated_citations_by_old_num[old_num] = old_cit
    
    # Update citations_by_old_num to use deduplicated version
    citations_by_old_num = deduplicated_citations_by_old_num
    
    # Update text to replace duplicate citation numbers with original ones
    if duplicate_mappings:
        for duplicate_old_num, original_old_num in duplicate_mappings.items():
            # Replace [duplicate] with [original] in the text
            summary = re.sub(rf'\[{duplicate_old_num}\]', f'[{original_old_num}]', summary)
            logger.info(
                f"[RENUMBER_CITATIONS] 🔄 Replaced duplicate citation [{duplicate_old_num}] with [{original_old_num}] in text"
            )
        
        # Recalculate appearance_order after text replacement
        matches = list(re.finditer(citation_pattern, summary))
        appearance_order = []
        seen_citation_nums = set()
        for match in matches:
            citation_num = int(match.group(1))
            if citation_num not in seen_citation_nums:
                appearance_order.append(citation_num)
                seen_citation_nums.add(citation_num)
    
    # Create mapping: old_citation_number -> new_sequential_number
    old_to_new = {}
    for new_num, old_num in enumerate(appearance_order, start=1):
        old_to_new[old_num] = new_num
    
    # Replace citation numbers in summary text with renumbered brackets
    def replace_citation(match):
        old_num = int(match.group(1))
        new_num = old_to_new.get(old_num, old_num)
        return f"[{new_num}]"
    
    renumbered_summary = re.sub(citation_pattern, replace_citation, summary)
    
    renumbered_citations = []
    seen_citation_objects = set()  # Track which citation objects we've already added
    for new_num, old_num in enumerate(appearance_order, start=1):
        if old_num in citations_by_old_num:
            old_cit = citations_by_old_num[old_num]
            
            # Check if we've already added this citation object (deduplication)
            # Use block_id + cited_text as unique identifier
            cit_id = (old_cit.get('block_id'), old_cit.get('cited_text', ''))
            if cit_id in seen_citation_objects:
                # This citation was already added - skip creating duplicate entry
                # But we still need to update the text to use the correct citation number
                logger.info(
                    f"[RENUMBER_CITATIONS] 🔍 Skipping duplicate citation entry: old_num={old_num} -> new_num={new_num}, "
                    f"already added as different number"
                )
                # Find which citation number this was already added as
                for existing_cit in renumbered_citations:
                    if (existing_cit.get('block_id'), existing_cit.get('cited_text', '')) == cit_id:
                        # Update text to use the existing citation number instead
                        existing_new_num = existing_cit.get('citation_number')
                        renumbered_summary = renumbered_summary.replace(f'[{new_num}]', f'[{existing_new_num}]')
                        break
                continue
            
            seen_citation_objects.add(cit_id)
            cited_text_from_phase1 = old_cit.get('cited_text', '')
            block_id_from_phase1 = old_cit.get('block_id', 'UNKNOWN')
            citation_appended = False  # Track if we've appended this citation
            
            # Extract the fact from the context around this citation in Phase 2 text
            citation_matches = list(re.finditer(rf'\[{old_num}\]', summary))
            if citation_matches:
                first_match = citation_matches[0]
                # Extract 100 chars before citation to get the fact
                context_start = max(0, first_match.start() - 100)
                context_before = summary[context_start:first_match.start()].strip()
                # Extract the fact (last sentence or phrase before citation)
                sentence_start = context_before.rfind('.') + 1
                fact_from_phase2_text = context_before[sentence_start:].strip() if sentence_start > 0 else context_before[-50:].strip()
                
                # Verify that the fact in Phase 2 text matches the ACTUAL BLOCK CONTENT from Phase 1
                # CRITICAL: We must verify against the block content, not just the cited_text
                # The cited_text might match, but the block might not contain the actual figure
                if cited_text_from_phase1 and fact_from_phase2_text:
                    # #region agent log
                    try:
                        with open(_DEBUG_LOG_PATH, 'a') as f:
                            f.write(json.dumps({
                                'sessionId': 'debug-session',
                                'runId': 'run1',
                                'hypothesisId': 'H',
                                'location': 'summary_nodes.py:438',
                                'message': f'BEFORE VALIDATION: Citation {old_num} -> {new_num}',
                                'data': {
                                    'old_citation_number': old_num,
                                    'new_citation_number': new_num,
                                    'fact_from_phase2_text': fact_from_phase2_text,
                                    'cited_text_from_phase1': cited_text_from_phase1,
                                    'block_id_from_phase1': block_id_from_phase1,
                                    'has_metadata_lookup_tables': metadata_lookup_tables is not None,
                                    'fact_contains_1_9m': '1.9' in fact_from_phase2_text or '1,950' in fact_from_phase2_text,
                                    'fact_contains_2_4m': '2.4' in fact_from_phase2_text or '2,400' in fact_from_phase2_text
                                },
                                'timestamp': int(__import__('time').time() * 1000)
                            }) + '\n')
                    except: pass
                    # #endregion
                    
                    # Get the actual block content from Phase 1 to verify what it contains
                    phase1_block_content = None
                    if metadata_lookup_tables and block_id_from_phase1:
                        for search_doc_id, search_metadata_table in metadata_lookup_tables.items():
                            if block_id_from_phase1 in search_metadata_table:
                                phase1_block_content = search_metadata_table[block_id_from_phase1].get('content', '')
                                # #region agent log
                                try:
                                    with open(_DEBUG_LOG_PATH, 'a') as f:
                                        f.write(json.dumps({
                                            'sessionId': 'debug-session',
                                            'runId': 'run1',
                                            'hypothesisId': 'H',
                                            'location': 'summary_nodes.py:448',
                                            'message': f'FOUND block content for citation {old_num}',
                                            'data': {
                                                'old_citation_number': old_num,
                                                'block_id': block_id_from_phase1,
                                                'doc_id': search_doc_id[:8],
                                                'block_content_preview': phase1_block_content[:200] if phase1_block_content else None,
                                                'block_contains_1_9m': '1.9' in (phase1_block_content or '') or '1,950' in (phase1_block_content or ''),
                                                'block_contains_2_4m': '2.4' in (phase1_block_content or '') or '2,400' in (phase1_block_content or '')
                                            },
                                            'timestamp': int(__import__('time').time() * 1000)
                                        }) + '\n')
                                except: pass
                                # #endregion
                                break
                    else:
                        # #region agent log
                        try:
                            with open(_DEBUG_LOG_PATH, 'a') as f:
                                f.write(json.dumps({
                                    'sessionId': 'debug-session',
                                    'runId': 'run1',
                                    'hypothesisId': 'H',
                                    'location': 'summary_nodes.py:448',
                                    'message': f'NO block content found for citation {old_num}',
                                    'data': {
                                        'old_citation_number': old_num,
                                        'block_id': block_id_from_phase1,
                                        'has_metadata_lookup_tables': metadata_lookup_tables is not None,
                                        'has_block_id': bool(block_id_from_phase1)
                                    },
                                    'timestamp': int(__import__('time').time() * 1000)
                                }) + '\n')
                        except: pass
                        # #endregion
                    
                    # Verify against the ACTUAL block content (not just cited_text)
                    # This ensures the block actually contains the figure being cited
                    if phase1_block_content:
                        verification = verify_citation_match(fact_from_phase2_text, phase1_block_content)
                    else:
                        # Fallback to cited_text if block content not available
                        verification = verify_citation_match(fact_from_phase2_text, cited_text_from_phase1)
                    
                    # #region agent log
                    import json
                    try:
                        with open(_DEBUG_LOG_PATH, 'a') as f:
                            f.write(json.dumps({
                                'sessionId': 'debug-session',
                                'runId': 'run1',
                                'hypothesisId': 'G',
                                'location': 'summary_nodes.py:441',
                                'message': 'CRITICAL: Validating citation fact match - checking block content contains figure',
                                'data': {
                                    'old_citation_number': old_num,
                                    'new_citation_number': new_num,
                                    'fact_from_phase2_text': fact_from_phase2_text,
                                    'cited_text_from_phase1': cited_text_from_phase1,
                                    'block_id_from_phase1': block_id_from_phase1,
                                    'phase1_block_content_preview': phase1_block_content[:150] if phase1_block_content else None,
                                    'verification_match': verification.get('match', False),
                                    'verification_confidence': verification.get('confidence', 'low'),
                                    'numeric_matches': verification.get('numeric_matches', []),
                                    'matched_terms': verification.get('matched_terms', []),
                                    'missing_terms': verification.get('missing_terms', []),
                                    'fact_contains_1_9m': '1.9' in fact_from_phase2_text or '1,950' in fact_from_phase2_text,
                                    'fact_contains_2_4m': '2.4' in fact_from_phase2_text or '2,400' in fact_from_phase2_text,
                                    'block_contains_1_9m': '1.9' in (phase1_block_content or '') or '1,950' in (phase1_block_content or ''),
                                    'block_contains_2_4m': '2.4' in (phase1_block_content or '') or '2,400' in (phase1_block_content or ''),
                                    'verified_against_block_content': phase1_block_content is not None
                                },
                                'timestamp': int(__import__('time').time() * 1000)
                            }) + '\n')
                    except: pass
                    # #endregion
                    
                    # If fact doesn't match, search for correct block_id using semantic search
                    if not verification.get('match', False) or verification.get('confidence', 'low') == 'low':
                        # #region agent log
                        try:
                            with open(_DEBUG_LOG_PATH, 'a') as f:
                                f.write(json.dumps({
                                    'sessionId': 'debug-session',
                                    'runId': 'run1',
                                    'hypothesisId': 'H',
                                    'location': 'summary_nodes.py:492',
                                    'message': f'VALIDATION FAILED: Starting semantic search for citation {old_num}',
                                    'data': {
                                        'old_citation_number': old_num,
                                        'verification_match': verification.get('match', False),
                                        'verification_confidence': verification.get('confidence', 'low'),
                                        'fact_from_phase2_text': fact_from_phase2_text,
                                        'phase1_block_content_preview': phase1_block_content[:200] if phase1_block_content else None,
                                        'numeric_matches': verification.get('numeric_matches', [])
                                    },
                                    'timestamp': int(__import__('time').time() * 1000)
                                }) + '\n')
                        except: pass
                        # #endregion
                        
                        logger.warning(
                            f"[RENUMBER_CITATIONS] ⚠️ Citation {old_num} fact mismatch detected!\n"
                            f"  Phase 2 fact: '{fact_from_phase2_text}'\n"
                            f"  Phase 1 cited_text: '{cited_text_from_phase1}'\n"
                            f"  Phase 1 block_id: {block_id_from_phase1}\n"
                            f"  Verification: match={verification.get('match')}, confidence={verification.get('confidence')}\n"
                            f"  Searching for correct block_id..."
                        )
                        
                        # Search for correct block_id using semantic matching (same logic as _extract_citations_from_text)
                        if metadata_lookup_tables:
                            best_match = None
                            best_score = -1
                            best_confidence = 'low'
                            
                            # Key semantic terms
                            valuation_terms = ['market value', 'assessed', 'valuation', 'valued at', 'professional', 'valuer', 'mrics', '90-day', '180-day', 'marketing period']
                            market_activity_terms = ['offer', 'rejected', 'marketing', 'guide price', 'under offer', 'viewing', 'savills']
                            
                            fact_lower = fact_from_phase2_text.lower()
                            is_valuation_query = any(term in fact_lower for term in valuation_terms)
                            is_market_activity_query = any(term in fact_lower for term in market_activity_terms)
                            
                            for search_doc_id, search_metadata_table in metadata_lookup_tables.items():
                                for search_block_id, search_block_meta in search_metadata_table.items():
                                    search_block_content = search_block_meta.get('content', '')
                                    if not search_block_content:
                                        continue
                                    
                                    block_lower = search_block_content.lower()
                                    
                                    # Verify match
                                    search_verification = verify_citation_match(fact_from_phase2_text, search_block_content)
                                    score = 0
                                    
                                    # Base score from verification
                                    if search_verification['confidence'] == 'high':
                                        score += 100
                                    elif search_verification['confidence'] == 'medium':
                                        score += 50
                                    else:
                                        score += 10
                                    
                                    # Semantic context bonus
                                    if is_valuation_query:
                                        if any(term in block_lower for term in valuation_terms):
                                            score += 50
                                        if not is_market_activity_query and any(term in block_lower for term in market_activity_terms):
                                            score -= 30
                                    
                                    if is_market_activity_query:
                                        if any(term in block_lower for term in market_activity_terms):
                                            score += 50
                                    
                                    # Bonus for matching key terms
                                    matched_terms = search_verification.get('matched_terms', [])
                                    if len(matched_terms) > 2:
                                        score += len(matched_terms) * 5
                                    
                                    # Penalty for missing important terms
                                    missing_terms = search_verification.get('missing_terms', [])
                                    if len(missing_terms) > 3:
                                        score -= len(missing_terms) * 3
                                    
                                    # CRITICAL: Extra bonus for exact numeric matches
                                    numeric_matches = search_verification.get('numeric_matches', [])
                                    if numeric_matches:
                                        score += len(numeric_matches) * 30
                                    
                                    # Update best match if this score is higher
                                    if score > best_score:
                                        best_score = score
                                        best_confidence = 'high' if score >= 100 else ('medium' if score >= 50 else 'low')
                                        best_match = {
                                            'block_id': search_block_id,
                                            'block_metadata': search_block_meta,
                                            'doc_id': search_doc_id,
                                            'verification': search_verification,
                                            'score': score,
                                            'content': search_block_content
                                        }
                            
                            # #region agent log
                            try:
                                with open(_DEBUG_LOG_PATH, 'a') as f:
                                    f.write(json.dumps({
                                        'sessionId': 'debug-session',
                                        'runId': 'run1',
                                        'hypothesisId': 'H',
                                        'location': 'summary_nodes.py:575',
                                        'message': f'SEMANTIC SEARCH RESULT for citation {old_num}',
                                        'data': {
                                            'old_citation_number': old_num,
                                            'found_best_match': best_match is not None,
                                            'best_confidence': best_confidence,
                                            'best_score': best_score if best_match else None,
                                            'best_block_id': best_match['block_id'] if best_match else None,
                                            'old_block_id': block_id_from_phase1,
                                            'block_ids_different': best_match['block_id'] != block_id_from_phase1 if best_match else False,
                                            'best_block_content_preview': best_match['content'][:200] if best_match else None,
                                            'best_block_contains_1_9m': '1.9' in (best_match['content'] if best_match else '') or '1,950' in (best_match['content'] if best_match else ''),
                                            'best_block_contains_2_4m': '2.4' in (best_match['content'] if best_match else '') or '2,400' in (best_match['content'] if best_match else ''),
                                            'numeric_matches': best_match['verification']['numeric_matches'] if best_match else []
                                        },
                                        'timestamp': int(__import__('time').time() * 1000)
                                    }) + '\n')
                            except: pass
                            # #endregion
                            
                            # Use best match if found and confidence is high/medium
                            if best_match and best_confidence in ['high', 'medium']:
                                if best_match['block_id'] != block_id_from_phase1:
                                    logger.warning(
                                        f"[RENUMBER_CITATIONS] ✅ Found better block match for citation {old_num}:\n"
                                        f"  Phase 1 block_id: {block_id_from_phase1} (WRONG - fact mismatch)\n"
                                        f"  Best match block_id: {best_match['block_id']} (score: {best_score}, confidence: {best_confidence})\n"
                                        f"  Phase 2 fact: '{fact_from_phase2_text}'\n"
                                        f"  Best block content: '{best_match['content'][:80]}...'\n"
                                        f"  Numeric matches: {best_match['verification']['numeric_matches']}\n"
                                        f"  Matched terms: {best_match['verification']['matched_terms']}"
                                    )
                                    
                                    # Update citation with correct block_id and bbox
                                    from backend.llm.citation_mapping import map_block_id_to_bbox
                                    correct_bbox_data = map_block_id_to_bbox(
                                        best_match['block_id'],
                                        {best_match['doc_id']: metadata_lookup_tables[best_match['doc_id']]}
                                    )
                                    
                                    if correct_bbox_data:
                                        # Update citation with correct block_id and bbox
                                        corrected_cit = old_cit.copy()
                                        corrected_cit['block_id'] = best_match['block_id']
                                        corrected_cit['doc_id'] = best_match['doc_id']
                                        corrected_cit['bbox'] = correct_bbox_data.get('bbox', old_cit.get('bbox', {}))
                                        corrected_cit['page_number'] = correct_bbox_data.get('page', old_cit.get('page_number', 0))
                                        corrected_cit['cited_text'] = fact_from_phase2_text  # Update to match Phase 2 fact
                                        corrected_cit['citation_number'] = new_num
                                        renumbered_citations.append(corrected_cit)
                                        citation_appended = True  # Mark as appended
                                        
                                        # #region agent log
                                        try:
                                            with open(_DEBUG_LOG_PATH, 'a') as f:
                                                f.write(json.dumps({
                                                    'sessionId': 'debug-session',
                                                    'runId': 'run1',
                                                    'hypothesisId': 'G',
                                                    'location': 'summary_nodes.py:573',
                                                    'message': 'CRITICAL: Corrected citation block_id - verifying it matches fact',
                                                    'data': {
                                                        'old_citation_number': old_num,
                                                        'new_citation_number': new_num,
                                                        'old_block_id': block_id_from_phase1,
                                                        'new_block_id': best_match['block_id'],
                                                        'fact_from_phase2_text': fact_from_phase2_text,
                                                        'corrected_block_content_preview': best_match['content'][:150],
                                                        'fact_contains_1_9m': '1.9' in fact_from_phase2_text or '1,950' in fact_from_phase2_text,
                                                        'fact_contains_2_4m': '2.4' in fact_from_phase2_text or '2,400' in fact_from_phase2_text,
                                                        'corrected_block_contains_1_9m': '1.9' in best_match['content'] or '1,950' in best_match['content'],
                                                        'corrected_block_contains_2_4m': '2.4' in best_match['content'] or '2,400' in best_match['content'],
                                                        'numeric_matches': best_match['verification']['numeric_matches'],
                                                        'score': best_score,
                                                        'confidence': best_confidence
                                                    },
                                                    'timestamp': int(__import__('time').time() * 1000)
                                                }) + '\n')
                                        except: pass
                                        # #endregion
                                    else:
                                        logger.error(
                                            f"[RENUMBER_CITATIONS] ❌ Could not map block_id {best_match['block_id']} to BBOX"
                                        )
                                else:
                                    logger.info(
                                        f"[RENUMBER_CITATIONS] ✅ Phase 1 block_id {block_id_from_phase1} matches best semantic match "
                                        f"(score: {best_score}, confidence: {best_confidence})"
                                    )
                            elif best_match:
                                logger.warning(
                                    f"[RENUMBER_CITATIONS] ⚠️ Low confidence match for citation {old_num} "
                                    f"(score: {best_score}, confidence: {best_confidence}) - using Phase 1 block_id anyway"
                                )
                            else:
                                logger.error(
                                    f"[RENUMBER_CITATIONS] ❌ No block match found for citation {old_num} fact: '{fact_from_phase2_text}'"
                                )
                        else:
                            logger.warning(
                                f"[RENUMBER_CITATIONS] ⚠️ Citation {old_num} fact mismatch but no metadata_lookup_tables provided for semantic search"
                            )
                    else:
                        logger.info(
                            f"[RENUMBER_CITATIONS] ✅ Citation {old_num} fact matches Phase 1 cited_text "
                            f"(confidence: {verification.get('confidence')})"
                        )
            
            # Use original Phase 1 citation (either matched or no metadata_lookup_tables for validation)
            # Only append if we haven't already appended a corrected citation above
            if not citation_appended:
                cit = old_cit.copy()
                cit['citation_number'] = new_num
                renumbered_citations.append(cit)
                logger.debug(
                    f"[RENUMBER_CITATIONS] ✅ Mapped citation {old_num} (block_id: {cit.get('block_id', 'UNKNOWN')}) "
                    f"→ new number {new_num}"
                )
        else:
            logger.error(
                f"[RENUMBER_CITATIONS] ❌ Citation {old_num} appears in text but NOT in Phase 1 citations! "
                f"Available: {list(citations_by_old_num.keys())}"
            )
    
    # Add any citations that weren't found in the text (shouldn't happen, but safety)
    for cit in citations:
        old_num = cit.get('citation_number', 0)
        if old_num not in old_to_new:
            # Assign next available number
            next_num = len(renumbered_citations) + 1
            cit_copy = cit.copy()
            cit_copy['citation_number'] = next_num
            renumbered_citations.append(cit_copy)
    
    logger.info(
        f"[RENUMBER_CITATIONS] Renumbered {len(renumbered_citations)} citations "
        f"based on appearance order. Citation order in text: {appearance_order}"
    )
    
    # Log citation mapping for debugging with block_id and bbox info
    for i, (old_num, new_num) in enumerate(old_to_new.items(), 1):
        old_cit = citations_by_old_num.get(old_num)
        if old_cit:
            block_id = old_cit.get('block_id', 'UNKNOWN')
            doc_id = old_cit.get('doc_id', 'UNKNOWN')[:8] if old_cit.get('doc_id') else 'UNKNOWN'
            page = old_cit.get('page_number', 0)
            bbox = old_cit.get('bbox', {})
            cited_text = old_cit.get('cited_text', '')[:80] if old_cit.get('cited_text') else 'N/A'
            bbox_str = f"{bbox.get('left', 0):.3f},{bbox.get('top', 0):.3f}" if bbox else "N/A"
            logger.info(
                f"[RENUMBER_CITATIONS] Citation {old_num} → {new_num} "
                f"(appeared {i} in text) | block_id: {block_id} | doc: {doc_id} | page: {page} | "
                f"bbox: {bbox_str} | cited_text: '{cited_text}...'"
            )
            
            # Find the context in the summary where this citation appears
            citation_matches = list(re.finditer(rf'\[{old_num}\]', summary))
            if citation_matches:
                first_match = citation_matches[0]
                context_start = max(0, first_match.start() - 50)
                context_end = min(len(summary), first_match.end() + 50)
                context = summary[context_start:context_end].replace('\n', ' ')
                logger.debug(
                    f"[RENUMBER_CITATIONS] Citation {old_num} context in text: '...{context}...'"
                )
                
                # #region agent log
                import json
                try:
                    with open(_DEBUG_LOG_PATH, 'a') as f:
                        f.write(json.dumps({
                            'sessionId': 'debug-session',
                            'runId': 'run1',
                            'hypothesisId': 'C',
                            'location': 'summary_nodes.py:451',
                            'message': 'Renumbering citation mapping',
                            'data': {
                                'old_citation_number': old_num,
                                'new_citation_number': new_num,
                                'appearance_order': i,
                                'cited_text_from_phase1': cited_text,
                                'context_in_phase2_text': context,
                                'block_id': block_id,
                                'bbox': bbox,
                                'page': page
                            },
                            'timestamp': int(__import__('time').time() * 1000)
                        }) + '\n')
                except: pass
                # #endregion
        else:
            logger.warning(
                f"[RENUMBER_CITATIONS] ⚠️ Citation {old_num} → {new_num} "
                f"but citation {old_num} not found in Phase 1 citations! "
                f"Available citation numbers: {list(citations_by_old_num.keys())}"
            )
    
    # Validate all citations were found
    missing_citations = [old_num for old_num in appearance_order if old_num not in citations_by_old_num]
    if missing_citations:
        logger.error(
            f"[RENUMBER_CITATIONS] ❌ CRITICAL: Citations {missing_citations} appear in text "
            f"but were NOT created in Phase 1! Available Phase 1 citations: {list(citations_by_old_num.keys())}"
    )
    
    return renumbered_summary, renumbered_citations


async def summarize_results(state: MainWorkflowState) -> MainWorkflowState:
    """
    Create a final unified answer from all document outputs.

    This node reads all the individual document answers and creates one coherant response that:
    1. Directly answers the users original question 
    2. Synthesizes findings accross documents
    3. Cites which documents support each claim
    4. Highlights key insights and differences

    Input:
    {
        "user_query": "What properties have foundation damage"
        "document_outputs": [
            {
                doc_id: "doc_1",
                output: "foundation shows minor cracks in basement corners",
            }
            {
                doc_id: "doc_2",
                output: "Significant foundation settling on east side detected."
            }
            {
                doc_id: "doc_3",
                output: "Foundation in excellent condition, no visible issues."
            }
        ]
    }

    Process:
    1. Create LLM with gpt-4-turbo
    2. Format all document outputs as readable text
    3. Send to LLM with prompt asking to synthesize
    4. LLM returns final unified answer

    Output:
    {
        "final_summary": "found 3 properties with varying foundation conditions:

        - Property A (doc_id): Minor cracks, monitor only
        - Property B (doc_id): Significant settling, needs evaluation 
        - Property C (doc_id): Excellent condition
        
        Recomended prioritizing Property B for further investigation."
    }

    Latency: ~1-2 seconds for LLM call
    """

    doc_outputs = state['document_outputs']
    user_query = state.get('user_query', '')

    if not doc_outputs:
        logger.warning("[SUMMARIZE_RESULTS] No document outputs to summarize")
        # Provide a helpful message when no documents are found
        return {
            "final_summary": f"I couldn't find any documents that directly match your query: \"{user_query}\".\n\n"
            "This could be because:\n"
            "- The information might be described differently in the documents\n"
            "- The documents may not contain this specific information\n"
            "- Try rephrasing your query or using more general terms\n\n"
            "For example, instead of \"5 bedroom and 5 bathroom\", try:\n"
            "- \"bedrooms and bathrooms\"\n"
            "- \"property specifications\"\n"
            "- \"property details\""
        }

    if config.simple_mode:
        logger.info(
            "[SUMMARIZE_RESULTS] Simple mode enabled - returning lightweight summary"
        )
        lines = [
            f"[Simple mode] Retrieved {len(doc_outputs)} document(s) "
            f"for business query: \"{state['user_query']}\"."
        ]
        for output in doc_outputs[:5]:
            snippet = output.get('output', '') or ''
            prop_id_display = (output.get('property_id') or 'none')[:8]
            lines.append(
                f"- Doc {output.get('doc_id', '')[:8]} "
                f"(property {prop_id_display}): "
                f"{snippet[:120]}{'...' if len(snippet) > 120 else ''}"
            )
        if len(doc_outputs) > 5:
            lines.append(f"...and {len(doc_outputs) - 5} more documents.")
        return {"final_summary": "\n".join(lines)}

    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )

    # PERFORMANCE OPTIMIZATION: Limit document outputs for summarization based on detail_level
    # Concise mode: 7 docs (fast summary)
    # Detailed mode: 20 docs (comprehensive summary)
    detail_level = state.get('detail_level', 'concise')
    if detail_level == 'detailed':
        max_docs_for_summary = int(os.getenv("MAX_DOCS_FOR_SUMMARY_DETAILED", "20"))
        logger.info(f"[SUMMARIZE_RESULTS] Detailed mode: summarizing up to {max_docs_for_summary} documents")
    else:
        max_docs_for_summary = int(os.getenv("MAX_DOCS_FOR_SUMMARY", "7"))
        logger.info(f"[SUMMARIZE_RESULTS] Concise mode: summarizing up to {max_docs_for_summary} documents")
    
    if len(doc_outputs) > max_docs_for_summary:
        logger.info(
            "[SUMMARIZE_RESULTS] Limiting summary to top %d documents (out of %d) for %s processing",
            max_docs_for_summary,
            len(doc_outputs),
            detail_level
        )
        doc_outputs = doc_outputs[:max_docs_for_summary]
    
    # Format outputs with block IDs and build metadata lookup tables (for citation mapping)
    # OPTIMIZATION: Pre-allocate metadata_lookup_tables with expected size to reduce reallocations
    expected_doc_count = len(doc_outputs)
    metadata_lookup_tables = {}  # doc_id -> block_id -> metadata
    # Pre-allocate structure (Python dicts grow dynamically, but this helps with memory planning)
    
    formatted_outputs_with_ids = []
    search_source_summary = {
        'structured_query': 0,
        'llm_sql_query': 0,
        'bm25': 0,
        'vector': 0,
        'hybrid': 0,
        'unknown': 0
    }
    
    for idx, output in enumerate(doc_outputs):
        doc_id = output.get('doc_id', '')
        doc_type = (output.get('classification_type') or 'Property Document').replace('_', ' ').title()
        filename = output.get('original_filename', f"Document {output['doc_id'][:8]}")
        prop_id = output.get('property_id') or 'Unknown'
        address = output.get('property_address', f"Property {prop_id[:8]}")
        page_info = output.get('page_range', 'multiple pages')
        search_source = output.get('search_source', 'unknown')
        similarity_score = output.get('similarity_score', 0.0)
        
        
        # Track search sources
        search_source_summary[search_source] = search_source_summary.get(search_source, 0) + 1
        
        # Format search source for display
        source_display = {
            'structured_query': 'Exact match (property details)',
            'llm_sql_query': 'Similar match (SQL query)',
            'bm25': 'Lexical search (BM25)',
            'vector': 'Semantic search (vector similarity)',
            'hybrid': 'Combined search (BM25 + Vector)',
            'unknown': 'Unknown source'
        }.get(search_source, search_source)
        
        # OPTIMIZATION: Skip formatting if already done during processing
        is_formatted = output.get('is_formatted', False)
        
        if is_formatted and output.get('formatted_content') and output.get('formatted_metadata_table'):
            # Use pre-formatted content from processing_nodes
            formatted_content = output.get('formatted_content')
            metadata_table = output.get('formatted_metadata_table')
            logger.debug(
                f"[SUMMARIZE_RESULTS] Using pre-formatted content for doc {doc_id[:8]}"
            )
        else:
            # Format document with block IDs (for citation mapping)
            formatted_content, metadata_table = format_document_with_block_ids(output)
            logger.debug(
                f"[SUMMARIZE_RESULTS] Formatted doc {doc_id[:8]} in summarize_results"
            )
        
        # Format with document header
        doc_header = f"\n### {doc_type}"
        if address and address != f"Property {prop_id[:8]}":
            doc_header += f" - {address}"
        doc_header += f"\n"
        doc_header += f"Pages: {page_info}\n"
        doc_header += f"Found via: {source_display}"
        if similarity_score > 0:
            doc_header += f" (relevance: {similarity_score:.2f})"
        doc_header += f"\n---------------------------------------------\n"
        
        formatted_outputs_with_ids.append(doc_header + formatted_content)
        
        # OPTIMIZATION: Build metadata lookup tables incrementally during formatting
        # Store metadata lookup table for this document (build incrementally)
        if doc_id and metadata_table:
            metadata_lookup_tables[doc_id] = metadata_table
            logger.info(
                f"[SUMMARIZE_RESULTS] Formatted doc {doc_id[:8]} with {len(metadata_table)} block IDs"
            )
    
    # Create citation tool with metadata lookup tables
    citation_tool, citation_tool_instance = create_citation_tool(metadata_lookup_tables)
    
    formatted_outputs_str = "\n".join(formatted_outputs_with_ids)
    
    # OPTIMIZATION: Adaptive content length based on query characteristics
    user_query = state.get('user_query', '')
    characteristics = detect_query_characteristics(user_query)
    complexity = characteristics['complexity_score']
    needs_comprehensive = characteristics['needs_comprehensive']
    
    # Base limit: 80,000 chars (~20k tokens)
    base_limit = 80000
    if needs_comprehensive:
        # For comprehensive queries, allow more content (120k-150k chars)
        MAX_CONTENT_LENGTH = int(base_limit * 1.5)  # 120,000 chars
    else:
        # Scale based on complexity: 80k-120k chars
        MAX_CONTENT_LENGTH = int(base_limit * (1 + complexity * 0.5))
    
    # Cap at 150k to prevent context overflow
    MAX_CONTENT_LENGTH = min(MAX_CONTENT_LENGTH, 150000)
    
    if len(formatted_outputs_str) > MAX_CONTENT_LENGTH:
        logger.warning(
            f"[SUMMARIZE_RESULTS] Truncating formatted outputs from {len(formatted_outputs_str)} to {MAX_CONTENT_LENGTH} chars "
            f"(complexity={complexity:.2f}, comprehensive={needs_comprehensive})"
        )
        
        # OPTIMIZATION: Truncate while maintaining page diversity
        # Group formatted outputs by document and page ranges
        # Truncate proportionally from each document to maintain diversity
        formatted_lines = formatted_outputs_str.split('\n')
        target_length = MAX_CONTENT_LENGTH - len("\n\n... (content truncated due to length limits) ...")
        
        # Simple proportional truncation: keep first N lines that fit
        truncated_lines = []
        current_length = 0
        for line in formatted_lines:
            if current_length + len(line) + 1 <= target_length:  # +1 for newline
                truncated_lines.append(line)
                current_length += len(line) + 1
            else:
                break
        
        formatted_outputs_str = '\n'.join(truncated_lines)
        formatted_outputs_str += "\n\n... (content truncated due to length limits) ..."
    
    # Build search summary for LLM context
    search_summary_parts = []
    if search_source_summary['structured_query'] > 0:
        search_summary_parts.append(f"{search_source_summary['structured_query']} exact match(es) from property database")
    if search_source_summary['llm_sql_query'] > 0:
        search_summary_parts.append(f"{search_source_summary['llm_sql_query']} similar match(es) from SQL query")
    if search_source_summary['bm25'] > 0:
        search_summary_parts.append(f"{search_source_summary['bm25']} from lexical search (BM25)")
    if search_source_summary['vector'] > 0:
        search_summary_parts.append(f"{search_source_summary['vector']} from semantic search (vector similarity)")
    if search_source_summary['hybrid'] > 0:
        search_summary_parts.append(f"{search_source_summary['hybrid']} from combined search (BM25 + Vector)")
    
    search_summary = "Documents found via: " + ", ".join(search_summary_parts) if search_summary_parts else "Documents found via various search methods"

    # Build conversation context if history exists
    history_context = ""
    if state.get('conversation_history'):
        recent_history = state['conversation_history'][-3:]  # Last 3 Q&A pairs
        history_lines = []
        for exchange in recent_history:
            # Handle different conversation history formats:
            # Format 1: From summary_nodes (has 'query' and 'summary')
            # Format 2: From frontend/views (has 'role' and 'content')
            if 'query' in exchange and 'summary' in exchange:
                # Format from summary_nodes
                history_lines.append(f"Previous Q: {exchange['query']}")
                history_lines.append(f"Previous A: {exchange['summary'][:300]}...\n")
            elif 'role' in exchange and 'content' in exchange:
                # Format from frontend (role-based messages)
                role = exchange['role']
                content = exchange['content']
                if role == 'user':
                    history_lines.append(f"Previous Q: {content}")
                elif role == 'assistant':
                    history_lines.append(f"Previous A: {content[:300]}...\n")
            # Skip malformed entries silently
        if history_lines:
            history_context = "CONVERSATION HISTORY:\n" + "\n".join(history_lines) + "\n\n"

    # Get system prompt for summarize task
    system_msg = get_system_prompt('summarize')
    
    # Create citation tool instance (needed for Phase 1 and Phase 2)
    citation_tool, citation_tool_instance = create_citation_tool(metadata_lookup_tables)
    
    # ============================================================
    # PHASE 1: CITATION EXTRACTION (MANDATORY TOOL CALLS)
    # ============================================================
    # Extract citations first by having LLM identify all factual claims
    # This ensures we have citations before generating the answer
    # ============================================================
    logger.info("[SUMMARIZE_RESULTS] Phase 1: Extracting citations from document extracts")
    
    # Create LLM with tool binding for Phase 1 (mandatory tool calls)
    # Use "auto" instead of "required" to allow LLM to return text if needed
    # "required" can cause issues if LLM fails to call tools
    phase1_llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    ).bind_tools(
        [citation_tool],
        tool_choice="auto"  # Auto - LLM will call tools but can also return text
    )
    
    # Get citation extraction prompt
    citation_prompt = get_citation_extraction_prompt(
        user_query=state['user_query'],
        conversation_history=history_context,
        search_summary=search_summary,
        formatted_outputs=formatted_outputs_str,
        metadata_lookup_tables=metadata_lookup_tables
    )
    
    phase1_messages = [system_msg, HumanMessage(content=citation_prompt)]
    
    # Process tool calls from Phase 1
    phase1_citations = []
    phase1_response = None
    
    try:
        logger.info("[SUMMARIZE_RESULTS] Phase 1: Invoking LLM for citation extraction...")
        phase1_response = await phase1_llm.ainvoke(phase1_messages)
        logger.info(f"[SUMMARIZE_RESULTS] Phase 1: LLM call completed successfully")
    except Exception as phase1_error:
        error_msg = str(phase1_error).lower()
        if "shutdown" in error_msg or "closed" in error_msg or "cannot schedule" in error_msg:
            logger.error(f"[SUMMARIZE_RESULTS] Phase 1: Event loop error - {phase1_error}")
            # Re-raise event loop errors - they indicate a serious problem
            raise
        else:
            logger.error(f"[SUMMARIZE_RESULTS] Phase 1: Error during LLM call: {phase1_error}", exc_info=True)
            # Fallback: continue without Phase 1 citations for other errors
            logger.warning("[SUMMARIZE_RESULTS] Phase 1: Continuing to Phase 2 without citations due to error")
            phase1_response = None
    
    if phase1_response:
        if hasattr(phase1_response, 'tool_calls') and phase1_response.tool_calls:
            logger.info(f"[SUMMARIZE_RESULTS] Phase 1: Processing {len(phase1_response.tool_calls)} citation tool calls...")
            for tool_call in phase1_response.tool_calls:
                tool_name = tool_call.get('name') if isinstance(tool_call, dict) else getattr(tool_call, 'name', None)
                if tool_name == 'cite_source':
                    tool_args = tool_call.get('args', {}) if isinstance(tool_call, dict) else getattr(tool_call, 'args', {})
                    if isinstance(tool_args, dict):
                        try:
                            citation_tool_instance.add_citation(
                                cited_text=tool_args.get('cited_text', ''),
                                block_id=tool_args.get('block_id', ''),
                                citation_number=tool_args.get('citation_number', 0)
                            )
                            logger.debug(
                                f"[SUMMARIZE_RESULTS] Phase 1: ✅ Citation {tool_args.get('citation_number')} extracted: "
                                f"block_id={tool_args.get('block_id')}"
                            )
                        except Exception as tool_error:
                            logger.error(f"[SUMMARIZE_RESULTS] Phase 1: Error processing citation tool call: {tool_error}", exc_info=True)
            
            # Get citations from tool instance
            phase1_citations = citation_tool_instance.citations
            logger.info(f"[SUMMARIZE_RESULTS] Phase 1: Extracted {len(phase1_citations)} citations")
        else:
            logger.warning("[SUMMARIZE_RESULTS] Phase 1: No citation tool calls in response")
            # With tool_choice="auto", the LLM might return text instead of tool calls
            # Check if there's text content that might indicate the LLM didn't understand the task
            if hasattr(phase1_response, 'content') and phase1_response.content:
                logger.warning(f"[SUMMARIZE_RESULTS] Phase 1: LLM returned text instead of tool calls: {str(phase1_response.content)[:200]}...")
            phase1_citations = []
    else:
        logger.warning("[SUMMARIZE_RESULTS] Phase 1: No response received, continuing without citations")
        phase1_citations = []
    
    # ============================================================
    # PHASE 2: GENERATE ANSWER WITH CITATIONS
    # ============================================================
    # Generate final answer using citations extracted in Phase 1
    # ============================================================
    logger.info("[SUMMARIZE_RESULTS] Phase 2: Generating final answer with citations")
    
    import time
    llm_call_start_time = time.time()
    
    # Generate answer WITHOUT tool binding (citations already extracted in Phase 1)
    final_llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )
    logger.info("[SUMMARIZE_RESULTS] Phase 2: Generating answer (citations from Phase 1)")
    
    # Log Phase 1 citations being passed to Phase 2
    logger.info(
        f"[SUMMARIZE_RESULTS] Phase 2: Passing {len(phase1_citations)} citations to LLM for answer generation"
    )
    for i, cit in enumerate(phase1_citations[:10], 1):  # Log first 10
        block_id = cit.get('block_id', 'UNKNOWN')
        doc_id = cit.get('doc_id', 'UNKNOWN')[:8] if cit.get('doc_id') else 'UNKNOWN'
        page = cit.get('page_number', 0)
        cited_text = cit.get('cited_text', '')[:50] if cit.get('cited_text') else 'N/A'
        logger.debug(
            f"[SUMMARIZE_RESULTS] Phase 1 citation {cit.get('citation_number', i)}: "
            f"block_id={block_id}, doc={doc_id}, page={page}, text='{cited_text}...'"
        )
    
    final_prompt = get_final_answer_prompt(
        user_query=state['user_query'],
        conversation_history=history_context,
        formatted_outputs=formatted_outputs_str,
        citations=phase1_citations  # Use citations extracted in Phase 1
    )
    
    final_messages = [system_msg, HumanMessage(content=final_prompt)]
    
    llm_invoke_start_time = time.time()
    final_response = await final_llm.ainvoke(final_messages)
    llm_call_end_time = time.time()
    llm_call_duration = llm_call_end_time - llm_invoke_start_time
    
    # Extract summary from answer generation
    summary = ''
    if hasattr(final_response, 'content'):
        summary = str(final_response.content).strip() if final_response.content else ''
    elif isinstance(final_response, str):
        summary = final_response.strip()
    
    # #region agent log
    # Log what citation numbers appear next to what facts in Phase 2 response
    import re
    import json
    try:
        citation_pattern = r'\[(\d+)\]'
        citation_matches = list(re.finditer(citation_pattern, summary))
        for match in citation_matches:
            citation_num = match.group(1)
            context_start = max(0, match.start() - 50)
            context_end = min(len(summary), match.end() + 50)
            context = summary[context_start:context_end].replace('\n', ' ')
            with open(_DEBUG_LOG_PATH, 'a') as f:
                f.write(json.dumps({
                    'sessionId': 'debug-session',
                    'runId': 'run1',
                    'hypothesisId': 'B',
                    'location': 'summary_nodes.py:919',
                    'message': 'Phase 2 citation in response text',
                    'data': {
                        'citation_number_in_text': citation_num,
                        'context_around_citation': context,
                        'fact_before_citation': summary[max(0, match.start() - 30):match.start()].strip()
                    },
                    'timestamp': int(__import__('time').time() * 1000)
                }) + '\n')
    except: pass
    # #endregion
    
    
    # Use citations from Phase 1 (already extracted)
    citations_from_state = phase1_citations
    logger.info(f"[SUMMARIZE_RESULTS] Phase 2: Using {len(citations_from_state)} citations from Phase 1")
    
    # Clean up any unwanted text
    import re
    summary = re.sub(
        r'(?i)(I will now proceed.*?\.|I will call.*?\.|Now calling.*?\.)',
        '',
        summary
    )
    summary = summary.strip()
    
    # Renumber citations based on order of appearance in response
    # This ensures citations are sequential (1, 2, 3...) based on when they appear in text
    # Only renumber if we have citations from Phase 1
    if citations_from_state and summary:
        summary, citations_from_state = _renumber_citations_by_appearance(summary, citations_from_state, metadata_lookup_tables)
    
    summary_complete_time = time.time()
    total_duration = summary_complete_time - llm_call_start_time
    
    logger.info(
        f"[SUMMARIZE_RESULTS] Generated answer with {len(citations_from_state)} citations from blocks used "
        f"({len(summary)} chars) - Total time: {round(total_duration, 2)}s"
    )
    
    # Add current exchange to conversation history
    # Include timestamp for checkpoint persistence (as per LangGraph documentation)
    conversation_entry = {
        "query": state['user_query'],
        "summary": summary,
        "timestamp": datetime.now().isoformat(),  # Add timestamp like LangGraph docs
        "document_ids": [output['doc_id'] for output in doc_outputs[:10]]  # Track which docs were used
    }
    
    # Preserve document_outputs and relevant_documents in state (LangGraph merges, but be explicit)
    state_update = {
        "final_summary": summary,
        "citations": citations_from_state,  # NEW: Citations stored in state (with bbox coordinates)
        "conversation_history": [conversation_entry],  # operator.add will append to existing history
        # Preserve existing state fields (LangGraph merges by default, but ensure they're not lost)
        "document_outputs": doc_outputs,  # Preserve document outputs for views.py
        "relevant_documents": state.get('relevant_documents', [])  # Preserve relevant docs
    }
    
    
    return state_update

        



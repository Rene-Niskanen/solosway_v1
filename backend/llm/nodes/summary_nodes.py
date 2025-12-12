"""
Summarization code - create final unified answer from all document outputs.
"""

import logging
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
                bbox_left = block_metadata.get('bbox_left', 0.0)
                bbox_top = block_metadata.get('bbox_top', 0.0)
                bbox_width = block_metadata.get('bbox_width', 1.0)
                bbox_height = block_metadata.get('bbox_height', 1.0)
                
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


def _renumber_citations_by_appearance(summary: str, citations: List[Dict]) -> Tuple[str, List[Dict]]:
    """
    Renumber citations based on their order of appearance in the response text.
    
    This ensures citations are sequential (1, 2, 3...) based on when they first appear,
    not based on when they were extracted in Phase 1.
    
    Args:
        summary: The LLM response text with citation superscripts
        citations: List of citation dictionaries with citation_number, block_id, etc.
    
    Returns:
        Tuple of (renumbered_summary, renumbered_citations)
    """
    import re
    
    # Map of superscript characters to numbers
    superscript_to_num = {
        '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5, '⁶': 6, '⁷': 7, '⁸': 8, '⁹': 9, '¹⁰': 10,
        '¹¹': 11, '¹²': 12, '¹³': 13, '¹⁴': 14, '¹⁵': 15, '¹⁶': 16, '¹⁷': 17, '¹⁸': 18, '¹⁹': 19, '²⁰': 20
    }
    
    # Find all citation superscripts in order of appearance
    # Pattern matches individual superscripts (¹, ², ³) or combined (¹², ¹²³)
    # We'll handle both individual and combined, but prefer individual
    citation_pattern = r'[¹²³⁴⁵⁶⁷⁸⁹]+'
    matches = list(re.finditer(citation_pattern, summary))
    
    if not matches:
        logger.debug("[RENUMBER_CITATIONS] No citation superscripts found in summary")
        return summary, citations
    
    # Extract citation numbers in order of appearance
    # For combined superscripts like "¹²³", we need to split them
    appearance_order = []
    seen_citation_nums = set()
    
    for match in matches:
        superscript_text = match.group()
        # Handle combined superscripts (e.g., "¹²" = 12, "¹²³" = 123)
        # But we want individual citations, so split them
        citation_nums = []
        
        # Try to parse as combined first (for backwards compatibility)
        if superscript_text in superscript_to_num:
            citation_nums = [superscript_to_num[superscript_text]]
        else:
            # Split combined superscripts into individual ones
            # "¹²" -> [1, 2], "¹²³" -> [1, 2, 3]
            for char in superscript_text:
                if char in superscript_to_num:
                    citation_nums.append(superscript_to_num[char])
        
        # Add citation numbers in order, avoiding duplicates
        for cit_num in citation_nums:
            if cit_num not in seen_citation_nums:
                appearance_order.append(cit_num)
                seen_citation_nums.add(cit_num)
    
    if not appearance_order:
        logger.debug("[RENUMBER_CITATIONS] No valid citation numbers extracted")
        return summary, citations
    
    # Create mapping: old_citation_number -> new_sequential_number
    old_to_new = {}
    for new_num, old_num in enumerate(appearance_order, start=1):
        old_to_new[old_num] = new_num
    
    # Create reverse mapping for superscript characters
    num_to_superscript = {
        1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', 10: '¹⁰',
        11: '¹¹', 12: '¹²', 13: '¹³', 14: '¹⁴', 15: '¹⁵', 16: '¹⁶', 17: '¹⁷', 18: '¹⁸', 19: '¹⁹', 20: '²⁰'
    }
    
    # Replace citation numbers in summary text
    def replace_citation(match):
        superscript_text = match.group()
        # Extract citation numbers from this superscript
        citation_nums = []
        if superscript_text in superscript_to_num:
            citation_nums = [superscript_to_num[superscript_text]]
        else:
            for char in superscript_text:
                if char in superscript_to_num:
                    citation_nums.append(superscript_to_num[char])
        
        # Map to new numbers and format with spaces
        new_nums = [old_to_new.get(num, num) for num in citation_nums]
        # Format as individual superscripts with spaces: "¹ ² ³"
        new_superscripts = ' '.join([num_to_superscript.get(num, str(num)) for num in new_nums])
        return new_superscripts
    
    renumbered_summary = re.sub(citation_pattern, replace_citation, summary)
    
    # Renumber citations list
    # Create lookup: old citation_number -> citation dict
    citations_by_old_num = {cit.get('citation_number', 0): cit for cit in citations}
    
    renumbered_citations = []
    for new_num, old_num in enumerate(appearance_order, start=1):
        if old_num in citations_by_old_num:
            cit = citations_by_old_num[old_num].copy()
            cit['citation_number'] = new_num
            renumbered_citations.append(cit)
    
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
        f"based on appearance order"
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
        
        # #region agent log
        # Debug: Log source_chunks_metadata before format_document_with_block_ids for Hypothesis A
        try:
            source_chunks_metadata = output.get('source_chunks_metadata', [])
            chunks_with_blocks = sum(1 for chunk in source_chunks_metadata if chunk.get('blocks') and isinstance(chunk.get('blocks'), list) and len(chunk.get('blocks')) > 0) if source_chunks_metadata else 0
            import json
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({
                    'sessionId': 'debug-session',
                    'runId': 'run1',
                    'hypothesisId': 'A',
                    'location': 'summary_nodes.py:147',
                    'message': 'source_chunks_metadata before format_document_with_block_ids',
                    'data': {
                        'doc_id': doc_id[:8] if doc_id else 'unknown',
                        'has_source_chunks_metadata': 'source_chunks_metadata' in output,
                        'source_chunks_metadata_type': type(source_chunks_metadata).__name__,
                        'source_chunks_metadata_length': len(source_chunks_metadata) if isinstance(source_chunks_metadata, list) else 0,
                        'chunks_with_blocks': chunks_with_blocks,
                        'output_keys': list(output.keys())[:10]
                    },
                    'timestamp': int(__import__('time').time() * 1000)
                }) + '\n')
        except Exception:
            pass
        # #endregion
        
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
            # #region agent log
            # Debug: Log metadata lookup table for Hypothesis C
            try:
                import json
                with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                    f.write(json.dumps({
                        'sessionId': 'debug-session',
                        'runId': 'run1',
                        'hypothesisId': 'C',
                        'location': 'summary_nodes.py:188',
                        'message': 'Metadata lookup table stored',
                        'data': {
                            'doc_id': doc_id[:8] if doc_id else 'unknown',
                            'metadata_table_size': len(metadata_table),
                            'total_lookup_tables': len(metadata_lookup_tables)
                        },
                        'timestamp': int(__import__('time').time() * 1000)
                    }) + '\n')
            except Exception:
                pass  # Silently fail instrumentation
            # #endregion
    
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
    
    # #region agent log
    # Debug: Log timing for Hypothesis E - LLM call duration
    import time
    llm_call_start_time = time.time()
    try:
        import json
        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
            f.write(json.dumps({
                'sessionId': 'debug-session',
                'runId': 'run1',
                'hypothesisId': 'E',
                'location': 'summary_nodes.py:485',
                'message': 'Starting LLM call for answer generation (no tool binding for speed)',
                'data': {
                    'formatted_outputs_length': len(formatted_outputs_str),
                    'prompt_length': 0  # Will be updated after prompt creation
                },
                'timestamp': int(__import__('time').time() * 1000)
            }) + '\n')
    except Exception:
        pass
    # #endregion
    
    # Generate answer WITHOUT tool binding (citations already extracted in Phase 1)
    final_llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )
    logger.info("[SUMMARIZE_RESULTS] Phase 2: Generating answer (citations from Phase 1)")
    
    final_prompt = get_final_answer_prompt(
        user_query=state['user_query'],
        conversation_history=history_context,
        formatted_outputs=formatted_outputs_str,
        citations=phase1_citations  # Use citations extracted in Phase 1
    )
    
    # #region agent log
    # Debug: Log prompt creation timing
    prompt_creation_time = time.time()
    try:
        import json
        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
            f.write(json.dumps({
                'sessionId': 'debug-session',
                'runId': 'run1',
                'hypothesisId': 'E',
                'location': 'summary_nodes.py:500',
                'message': 'Prompt created, about to call LLM',
                'data': {
                    'prompt_length': len(final_prompt),
                    'time_since_start_ms': int((prompt_creation_time - llm_call_start_time) * 1000)
                },
                'timestamp': int(__import__('time').time() * 1000)
            }) + '\n')
    except Exception:
        pass
    # #endregion
    
    final_messages = [system_msg, HumanMessage(content=final_prompt)]
    
    # #region agent log
    # Debug: Log just before LLM invoke
    llm_invoke_start_time = time.time()
    try:
        import json
        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
            f.write(json.dumps({
                'sessionId': 'debug-session',
                'runId': 'run1',
                'hypothesisId': 'E',
                'location': 'summary_nodes.py:506',
                'message': 'About to invoke LLM - this is where delay might occur',
                'data': {
                    'messages_count': len(final_messages),
                    'time_since_start_ms': int((llm_invoke_start_time - llm_call_start_time) * 1000)
                },
                'timestamp': int(__import__('time').time() * 1000)
            }) + '\n')
    except Exception:
        pass
    # #endregion
    
    final_response = await final_llm.ainvoke(final_messages)
    
    # #region agent log
    # Debug: Log LLM call completion timing
    llm_call_end_time = time.time()
    llm_call_duration = llm_call_end_time - llm_invoke_start_time
    try:
        import json
        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
            f.write(json.dumps({
                'sessionId': 'debug-session',
                'runId': 'run1',
                'hypothesisId': 'E',
                'location': 'summary_nodes.py:506',
                'message': 'LLM call completed',
                'data': {
                    'llm_call_duration_seconds': round(llm_call_duration, 2),
                    'total_time_since_start_ms': int((llm_call_end_time - llm_call_start_time) * 1000),
                    'has_response': final_response is not None
                },
                'timestamp': int(__import__('time').time() * 1000)
            }) + '\n')
    except Exception:
        pass
    # #endregion
    
    # #region agent log
    # Debug: Log final_response structure for Hypothesis A
    try:
        has_content = hasattr(final_response, 'content') and final_response.content
        has_tool_calls = hasattr(final_response, 'tool_calls') and final_response.tool_calls
        content_length = len(str(final_response.content)) if has_content else 0
        tool_calls_count = len(final_response.tool_calls) if has_tool_calls else 0
        import json
        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
            f.write(json.dumps({
                'sessionId': 'debug-session',
                'runId': 'run1',
                'hypothesisId': 'A',
                'location': 'summary_nodes.py:506',
                'message': 'Final response structure after LLM call',
                'data': {
                    'has_content': has_content,
                    'content_length': content_length,
                    'has_tool_calls': has_tool_calls,
                    'tool_calls_count': tool_calls_count,
                    'content_preview': str(final_response.content)[:200] if has_content else None
                },
                'timestamp': int(__import__('time').time() * 1000)
            }) + '\n')
    except Exception:
        pass
    # #endregion
    
    # Extract summary from answer generation
    summary = ''
    if hasattr(final_response, 'content'):
        summary = str(final_response.content).strip() if final_response.content else ''
    elif isinstance(final_response, str):
        summary = final_response.strip()
    
    # #region agent log
    # Debug: Log extracted summary for Hypothesis C
    try:
        import json
        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
            f.write(json.dumps({
                'sessionId': 'debug-session',
                'runId': 'run1',
                'hypothesisId': 'C',
                'location': 'summary_nodes.py:680',
                'message': 'Extracted summary from response',
                'data': {
                    'summary_length': len(summary),
                    'summary_preview': summary[:200] if summary else None,
                    'summary_empty': not summary
                },
                'timestamp': int(__import__('time').time() * 1000)
            }) + '\n')
    except Exception:
        pass
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
        summary, citations_from_state = _renumber_citations_by_appearance(summary, citations_from_state)
    
    # #region agent log
    # Debug: Log final summary completion timing
    summary_complete_time = time.time()
    total_duration = summary_complete_time - llm_call_start_time
    try:
        import json
        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
            f.write(json.dumps({
                'sessionId': 'debug-session',
                'runId': 'run1',
                'hypothesisId': 'E',
                'location': 'summary_nodes.py:690',
                'message': 'Summary generation complete',
                'data': {
                    'summary_length': len(summary),
                    'citations_count': len(citations_from_state),
                    'total_duration_seconds': round(total_duration, 2),
                    'summary_empty': not summary
                },
                'timestamp': int(__import__('time').time() * 1000)
            }) + '\n')
    except Exception:
        pass
    # #endregion
    
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
    
    # #region agent log
    # Debug: Log state update for Hypothesis D
    try:
        import json
        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
            f.write(json.dumps({
                'sessionId': 'debug-session',
                'runId': 'run1',
                'hypothesisId': 'D',
                'location': 'summary_nodes.py:361',
                'message': 'State update with citations',
                'data': {
                    'citations_count': len(citations_from_state),
                    'citations_in_state_update': 'citations' in state_update,
                    'summary_length': len(summary)
                },
                'timestamp': int(__import__('time').time() * 1000)
            }) + '\n')
    except Exception:
        pass  # Silently fail instrumentation
    # #endregion
    
    return state_update

        



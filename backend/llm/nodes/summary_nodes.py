"""
Summarization code - create final unified answer from all document outputs.
"""

import logging
import os
from datetime import datetime
from typing import List, Dict, Tuple

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

from backend.llm.config import config
from backend.llm.types import MainWorkflowState
from backend.llm.utils.system_prompts import get_system_prompt
from backend.llm.prompts import get_summary_human_content, get_citation_extraction_prompt, get_final_answer_prompt
from backend.llm.utils.block_id_formatter import format_document_with_block_ids
from backend.llm.tools.citation_mapping import create_citation_tool

logger = logging.getLogger(__name__)


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
    formatted_outputs_with_ids = []
    metadata_lookup_tables = {}  # doc_id -> block_id -> metadata
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
        
        # Format document with block IDs (for citation mapping)
        formatted_content, metadata_table = format_document_with_block_ids(output)
        
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
        
        # Store metadata lookup table for this document
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
    
    # Limit total content size to prevent context overflow
    MAX_CONTENT_LENGTH = 80000  # ~20k tokens, leave room for prompt + metadata + response
    if len(formatted_outputs_str) > MAX_CONTENT_LENGTH:
        logger.warning(f"[SUMMARIZE_RESULTS] Truncating formatted outputs from {len(formatted_outputs_str)} to {MAX_CONTENT_LENGTH} chars")
        formatted_outputs_str = formatted_outputs_str[:MAX_CONTENT_LENGTH]
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
    
    # ============================================================
    # PHASE 1: CITATION EXTRACTION (MANDATORY TOOL CALLS)
    # ============================================================
    logger.info("[SUMMARIZE_RESULTS] Phase 1: Starting citation extraction with block IDs")
    
    citation_llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    ).bind_tools(
        [citation_tool],
        tool_choice="required"  # Force tool calls
    )
    
    citation_prompt = get_citation_extraction_prompt(
        user_query=state['user_query'],
        conversation_history=history_context,
        search_summary=search_summary,
        formatted_outputs=formatted_outputs_str,
        metadata_lookup_tables=metadata_lookup_tables
    )
    
    try:
        # Phase 1: Extract citations with mandatory tool calls
        citation_messages = [system_msg, HumanMessage(content=citation_prompt)]
        citation_response = await citation_llm.ainvoke(citation_messages)
        
        logger.info(f"[SUMMARIZE_RESULTS] Phase 1: Response received, checking for tool calls...")
        
        # #region agent log
        # Debug: Log Phase 1 response for Hypothesis B
        try:
            has_tool_calls = hasattr(citation_response, 'tool_calls') and citation_response.tool_calls
            tool_calls_count = len(citation_response.tool_calls) if has_tool_calls else 0
            finish_reason = citation_response.response_metadata.get('finish_reason') if hasattr(citation_response, 'response_metadata') else 'unknown'
            import json
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({
                    'sessionId': 'debug-session',
                    'runId': 'run1',
                    'hypothesisId': 'B',
                    'location': 'summary_nodes.py:273',
                    'message': 'Phase 1 LLM response received',
                    'data': {
                        'has_tool_calls': has_tool_calls,
                        'tool_calls_count': tool_calls_count,
                        'finish_reason': finish_reason,
                        'response_type': type(citation_response).__name__
                    },
                    'timestamp': int(__import__('time').time() * 1000)
                }) + '\n')
        except Exception:
            pass  # Silently fail instrumentation
        # #endregion
        
        # Execute tool calls from Phase 1
        citations_extracted = 0
        if hasattr(citation_response, 'tool_calls') and citation_response.tool_calls:
            logger.info(f"[SUMMARIZE_RESULTS] Phase 1: Executing {len(citation_response.tool_calls)} tool calls...")
            for tool_call in citation_response.tool_calls:
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
                            citations_extracted += 1
                            logger.info(
                                f"[SUMMARIZE_RESULTS] Phase 1: ✅ Citation {tool_args.get('citation_number')} extracted: "
                                f"block_id={tool_args.get('block_id')}"
                            )
                        except Exception as tool_error:
                            logger.error(f"[SUMMARIZE_RESULTS] Phase 1: Error executing tool call: {tool_error}", exc_info=True)
        else:
            logger.warning("[SUMMARIZE_RESULTS] Phase 1: No tool calls found in response")
        
        # Get extracted citations
        citations_from_state = citation_tool_instance.citations
        logger.info(f"[SUMMARIZE_RESULTS] Phase 1: Extracted {len(citations_from_state)} citations")
        
        # #region agent log
        # Debug: Log citations extracted for Hypothesis B and D
        try:
            import json
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                citations_sample = []
                for cit in citations_from_state[:3]:  # Sample first 3
                    citations_sample.append({
                        'citation_number': cit.get('citation_number'),
                        'block_id': cit.get('block_id', '')[:20] if cit.get('block_id') else 'none',
                        'has_bbox': bool(cit.get('bbox')),
                        'doc_id': cit.get('doc_id', '')[:8] if cit.get('doc_id') else 'none'
                    })
                f.write(json.dumps({
                    'sessionId': 'debug-session',
                    'runId': 'run1',
                    'hypothesisId': 'B,D',
                    'location': 'summary_nodes.py:303',
                    'message': 'Citations extracted from Phase 1',
                    'data': {
                        'citations_count': len(citations_from_state),
                        'citations_sample': citations_sample
                    },
                    'timestamp': int(__import__('time').time() * 1000)
                }) + '\n')
        except Exception:
            pass  # Silently fail instrumentation
        # #endregion
        
        # ============================================================
        # PHASE 2: GENERATE FINAL ANSWER WITH CITATIONS
        # ============================================================
        logger.info("[SUMMARIZE_RESULTS] Phase 2: Generating final answer with citations")
        
        final_llm = ChatOpenAI(
            api_key=config.openai_api_key,
            model=config.openai_model,
            temperature=0,
        )
        # No tool binding needed - citations already collected
        
        final_prompt = get_final_answer_prompt(
            user_query=state['user_query'],
            conversation_history=history_context,
            formatted_outputs=formatted_outputs_str,
            citations=citations_from_state
        )
        
        final_messages = [system_msg, HumanMessage(content=final_prompt)]
        final_response = await final_llm.ainvoke(final_messages)
        
        # Extract summary from Phase 2
        summary = ''
        if hasattr(final_response, 'content'):
            summary = str(final_response.content).strip() if final_response.content else ''
        elif isinstance(final_response, str):
            summary = final_response.strip()
        
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
        if citations_from_state and summary:
            summary, citations_from_state = _renumber_citations_by_appearance(summary, citations_from_state)
        
        logger.info(
            f"[SUMMARIZE_RESULTS] Phase 2: Generated final summary ({len(summary)} chars, "
            f"{len(citations_from_state)} citations available)"
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
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("[SUMMARIZE_RESULTS] Error creating summary: %s", exc, exc_info=True)
        fallback = ["Summary based on retrieved documents:"]
        for output in doc_outputs:
            snippet = output["output"][:200].replace("\n", " ")
            fallback.append(f"- {snippet}...")
        return {"final_summary": "\n".join(fallback)}

        



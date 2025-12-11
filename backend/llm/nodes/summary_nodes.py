"""
Summarization code - create final unified answer from all document outputs.
"""

import logging
from datetime import datetime

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

from backend.llm.config import config
from backend.llm.types import MainWorkflowState
from backend.llm.utils.system_prompts import get_system_prompt
from backend.llm.prompts import get_summary_human_content, get_citation_extraction_prompt, get_final_answer_prompt
from backend.llm.utils.block_id_formatter import format_document_with_block_ids
from backend.llm.tools.citation_mapping import create_citation_tool

logger = logging.getLogger(__name__)


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

    # Format outputs with block IDs and build metadata lookup tables
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
        
        # Format document with block IDs
        formatted_content, metadata_table = format_document_with_block_ids(output)
        
        # Format with document header
        doc_header = f"\n### {doc_type}: {filename}\n"
        doc_header += f"Property: {address}\n"
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
    
    # Create citation tool with metadata lookup tables (bbox lookup happens in tool)
    citation_tool, citation_tool_instance = create_citation_tool(metadata_lookup_tables)
    
    # ============================================================
    # PHASE 1: MANDATORY CITATION EXTRACTION
    # ============================================================
    logger.info("[SUMMARIZE_RESULTS] Phase 1: Starting mandatory citation extraction")
    
    citation_llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    ).bind_tools(
        [citation_tool],
        tool_choice="required"  # ← FORCE TOOL CALLS!
    )
    
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
        
        logger.info(f"[SUMMARIZE_RESULTS] Phase 1: Response type: {type(citation_response)}")
        logger.info(f"[SUMMARIZE_RESULTS] Phase 1: finish_reason: {citation_response.response_metadata.get('finish_reason') if hasattr(citation_response, 'response_metadata') else 'unknown'}")
        
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
        return {
            "final_summary": summary,
            "citations": citations_from_state,  # NEW: Citations stored in state (with bbox coordinates)
            "conversation_history": [conversation_entry],  # operator.add will append to existing history
            # Preserve existing state fields (LangGraph merges by default, but ensure they're not lost)
            "document_outputs": doc_outputs,  # Preserve document outputs for views.py
            "relevant_documents": state.get('relevant_documents', [])  # Preserve relevant docs
        }
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("[SUMMARIZE_RESULTS] Error creating summary: %s", exc, exc_info=True)
        fallback = ["Summary based on retrieved documents:"]
        for output in doc_outputs:
            snippet = output["output"][:200].replace("\n", " ")
            fallback.append(f"- {snippet}...")
        return {"final_summary": "\n".join(fallback)}

        



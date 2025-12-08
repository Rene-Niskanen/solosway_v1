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
from backend.llm.prompts import get_summary_human_content
from backend.llm.evidence_feedback import (
    build_feedback_instruction,
    extract_feedback_from_answer,
    match_feedback_to_chunks,
)

logger = logging.getLogger(__name__)


def summarize_results(state: MainWorkflowState) -> MainWorkflowState:
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

    # OPTIMIZATION: Skip LLM summarization for single-document queries (much faster)
    # The document_qa_agent should have already added [CHUNK:X] citations
    if len(doc_outputs) == 1:
        logger.info("[SUMMARIZE_RESULTS] Single document - returning directly without LLM summarization")
        single_output = doc_outputs[0]
        summary = single_output.get('output', '')
        filename = single_output.get('original_filename', 'Document')
        address = single_output.get('property_address', '')
        
        # Check if [CHUNK:X] citations are already present (from document_qa_agent)
        import re
        has_chunk_citations = bool(re.search(r'\[CHUNK:\d+', summary))
        
        if summary and not has_chunk_citations:
            # IMPROVED: Find the chunk that best matches the LLM response content
            # Instead of defaulting to [CHUNK:0], find which chunk contains the information
            source_chunks = single_output.get('source_chunks_metadata', [])
            best_match_idx = 0
            best_match_score = 0
            
            # Extract key numbers/values from summary (prices, dates, percentages)
            summary_lower = summary.lower()
            price_pattern = r'£[\d,]+(?:\.\d+)?(?:\s*(?:million|m|k))?|\d+(?:,\d{3})+(?:\.\d+)?'
            summary_values = set(re.findall(price_pattern, summary, re.IGNORECASE))
            
            for idx, chunk in enumerate(source_chunks):
                chunk_content = (chunk.get('content') or '').lower()
                if not chunk_content:
                    continue
                
                score = 0
                # Check for matching values (prices, figures)
                for value in summary_values:
                    if value.lower() in chunk_content:
                        score += 10  # Strong match for exact values
                
                # Check for key phrase overlaps
                summary_words = set(summary_lower.split())
                chunk_words = set(chunk_content.split())
                common_words = summary_words & chunk_words
                # Filter out common words
                common_words -= {'the', 'a', 'an', 'is', 'was', 'are', 'were', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'at', 'by'}
                score += len(common_words)
                
                if score > best_match_score:
                    best_match_score = score
                    best_match_idx = idx
            
            summary = summary.rstrip() + f' [CHUNK:{best_match_idx}]'
            logger.info(f"[SUMMARIZE_RESULTS] Found best matching chunk [{best_match_idx}] (score: {best_match_score}) for citation")
        
        # Add minimal context header
        if address:
            summary = f"From {filename} ({address}):\n\n{summary}"
        else:
            summary = f"From {filename}:\n\n{summary}"
        
        conversation_entry = {
            "query": state['user_query'],
            "summary": summary,
            "timestamp": datetime.now().isoformat(),
            "document_ids": [single_output.get('doc_id', '')]
        }
        
        return {
            "final_summary": summary,
            "conversation_history": [conversation_entry]
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
        max_tokens=1000,  # Limit response length for faster generation
    )

    # Format outputs with natural names (filename and address)
    # Also include search source information to help LLM understand how documents were found
    formatted_outputs = []
    search_source_summary = {
        'structured_query': 0,
        'llm_sql_query': 0,
        'bm25': 0,
        'vector': 0,
        'hybrid': 0,
        'unknown': 0
    }
    
    for idx, output in enumerate(doc_outputs):
        doc_type = (output.get('classification_type') or 'Property Document').replace('_', ' ').title()
        filename = output.get('original_filename', f"Document {output['doc_id'][:8]}")
        prop_id = output.get('property_id') or 'Unknown'
        address = output.get('property_address', f"Property {prop_id[:8]}")
        page_info = output.get('page_range', 'multiple pages')
        search_source = output.get('search_source', 'unknown')
        similarity_score = output.get('similarity_score', 0.0)
        doc_id = output.get('doc_id') or f"doc-{idx+1}"
        
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
        
        header = f"\n### {doc_type}: {filename}\n"
        header += f"Document ID: {doc_id}\n"
        header += f"Property: {address}\n"
        header += f"Pages: {page_info}\n"
        header += f"Found via: {source_display}"
        if similarity_score > 0:
            header += f" (relevance: {similarity_score:.2f})"
        header += f"\n---------------------------------------------\n"
        
        # OPTIMIZATION: Truncate very long outputs to speed up summarization
        # Keep first 2000 chars (most important info is usually at the start)
        doc_content = output.get('output', '')
        if len(doc_content) > 2000:
            doc_content = doc_content[:2000] + "\n\n[Content truncated for speed - showing most relevant portion]"
        
        formatted_outputs.append(header + doc_content)
    
    formatted_outputs_str = "\n".join(formatted_outputs)
    
    # OPTIMIZATION: Limit total context to ~8000 chars for faster processing
    if len(formatted_outputs_str) > 8000:
        logger.info(f"[SUMMARIZE_RESULTS] Truncating context from {len(formatted_outputs_str)} to 8000 chars for speed")
        formatted_outputs_str = formatted_outputs_str[:8000] + "\n\n[Additional document content truncated for faster response]"
    
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
    
    # Get human message content
    human_content = get_summary_human_content(
        user_query=state['user_query'],
        conversation_history=history_context,
        search_summary=search_summary,
        formatted_outputs=formatted_outputs_str
    )
    human_content_with_feedback = f"{human_content}\n\n{build_feedback_instruction()}"
    
    try:
        # Use LangGraph message format
        messages = [system_msg, HumanMessage(content=human_content_with_feedback)]
        response = llm.invoke(messages)
        raw_summary = response.content.strip()

        summary, evidence_feedback = extract_feedback_from_answer(raw_summary, logger)
        matched_evidence = match_feedback_to_chunks(evidence_feedback, doc_outputs, logger) if evidence_feedback else []

        if evidence_feedback:
            matched_count = sum(1 for record in matched_evidence if record.get('matched_chunk'))
            logger.info(
                "[EVIDENCE_FEEDBACK] Captured %d record(s); matched %d chunk(s)",
                len(evidence_feedback),
                matched_count,
            )

        logger.info("[SUMMARIZE_RESULTS] Generated final summary")
        
        # Add current exchange to conversation history
        # Include timestamp for checkpoint persistence (as per LangGraph documentation)
        conversation_entry = {
            "query": state['user_query'],
            "summary": summary,
            "timestamp": datetime.now().isoformat(),  # Add timestamp like LangGraph docs
            "document_ids": [output['doc_id'] for output in doc_outputs[:10]]  # Track which docs were used
        }
        
        return {
            "final_summary": summary,
            "evidence_feedback": evidence_feedback,
            "matched_evidence": matched_evidence,
            "conversation_history": [conversation_entry]  # operator.add will append to existing history
        }
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("[SUMMARIZE_RESULTS] Error creating summary: %s", exc, exc_info=True)
        fallback = ["Summary based on retrieved documents:"]
        for output in doc_outputs:
            snippet = output["output"][:200].replace("\n", " ")
            fallback.append(f"- {snippet}...")
        return {"final_summary": "\n".join(fallback)}

        



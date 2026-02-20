"""
Unified Agent Node - Handles document/chunk retrieval and answer generation via tools.

This node replaces:
- query_analysis_node (query analysis done inline)
- document_retrieval_node (agent calls retrieve_documents tool)
- chunk_retrieval_node (agent calls retrieve_chunks tool)

The agent autonomously decides:
- When to search for documents
- When to search for chunks within documents
- When to retry with rewritten queries (semantic retries)
- When to generate final answer

CRITICAL: This node does NOT manually extract tool results.
It lets LangGraph handle ToolMessages naturally in the message history.
The LLM sees tool results and decides what to do next.
"""

import logging
from typing import Optional
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from backend.llm.config import config
from backend.llm.types import MainWorkflowState
from backend.llm.prompts import _get_main_answer_tagging_rule, ensure_main_tags_when_missing
from backend.llm.prompts.agent import (
    get_agent_chip_system_prompt,
    get_agent_chip_user_prompt,
    get_agent_initial_prompt,
)
from backend.llm.utils.system_prompts import get_system_prompt
from backend.llm.utils.workspace_context import build_workspace_context
from backend.llm.utils.node_logging import log_node_perf
from backend.llm.tools.document_retriever_tool import create_document_retrieval_tool
from backend.llm.tools.planning_tool import plan_step
from backend.llm.tools.citation_mapping import create_chunk_citation_tool

logger = logging.getLogger(__name__)

# Cache for document filenames to avoid repeated database queries
_filename_cache: dict[str, str] = {}

def extract_chunk_text_only(messages: list) -> str:
    """
    Extract ONLY chunk text from ToolMessages, stripping all metadata.
    
    Returns: Concatenated chunk text (no filenames, IDs, scores, or structure)
    """
    chunk_texts = []
    
    for msg in messages:
        if hasattr(msg, 'type') and msg.type == 'tool':
            tool_name = getattr(msg, 'name', '')
            
            # Handle retrieve_chunks tool
            if tool_name == 'retrieve_chunks':
                try:
                    import json
                    content = json.loads(msg.content) if isinstance(msg.content, str) else msg.content
                    if isinstance(content, list):
                        for chunk in content:
                            if isinstance(chunk, dict):
                                # Extract ONLY the text content
                                chunk_text = chunk.get('chunk_text') or chunk.get('chunk_text_clean', '')
                                if chunk_text:
                                    chunk_texts.append(chunk_text.strip())
                except (json.JSONDecodeError, AttributeError, TypeError):
                    pass
    
    # Join chunks with simple separator (no metadata)
    return "\n\n---\n\n".join(chunk_texts)


def get_document_filename(doc_id: str) -> str:
    """
    Fetch original_filename from documents table with caching.
    
    Uses an in-memory cache to avoid repeated database queries for the same document.
    
    Args:
        doc_id: Document ID to look up
        
    Returns:
        Original filename or 'document.pdf' as fallback
    """
    if not doc_id:
        return 'document.pdf'
    
    # Check cache first
    if doc_id in _filename_cache:
        return _filename_cache[doc_id]
    
    try:
        from backend.services.supabase_client_factory import get_supabase_client
        supabase = get_supabase_client()
        result = supabase.table('documents')\
            .select('original_filename')\
            .eq('id', doc_id)\
            .limit(1)\
            .execute()
        
        if result.data and len(result.data) > 0:
            filename = result.data[0].get('original_filename')
            if filename:
                # Cache the result
                _filename_cache[doc_id] = filename
                return filename
    except Exception as e:
        logger.warning(f"[AGENT_NODE] Failed to fetch filename for doc_id {doc_id[:8]}...: {e}")
    
    # Cache fallback value to avoid repeated failed queries
    fallback = 'document.pdf'
    _filename_cache[doc_id] = fallback
    return fallback


def extract_chunk_citations_from_messages(messages: list) -> list:
    """
    Extract chunk citations from match_citation_to_chunk tool calls in message history.
    
    Looks for ToolMessages from match_citation_to_chunk tool and extracts citation data.
    Includes original_filename by fetching from database.
    
    Returns:
        List of Citation dictionaries with chunk_id-based citation data
    """
    from backend.llm.types import Citation
    
    citations = []
    
    for msg in messages:
        if hasattr(msg, 'type') and msg.type == 'tool':
            if hasattr(msg, 'name') and msg.name == 'match_citation_to_chunk':
                try:
                    import json
                    content = json.loads(msg.content) if isinstance(msg.content, str) else msg.content
                    if isinstance(content, dict):
                        doc_id = content.get('document_id', '')
                        
                        # Fetch original_filename from database
                        original_filename = get_document_filename(doc_id)
                        
                        # Convert tool result to Citation format
                        citation: Citation = {
                            'citation_number': len(citations) + 1,  # Sequential numbering
                            'block_id': None,  # Not used for chunk-id-lookup
                            'chunk_id': content.get('chunk_id'),
                            'block_index': content.get('block_id'),  # Index in blocks array
                            'cited_text': content.get('cited_text', ''),
                            'bbox': content.get('bbox'),
                            'page_number': content.get('page', 0),
                            'doc_id': doc_id,
                            'original_filename': original_filename,  # NEW: Include filename
                            'confidence': content.get('confidence', 'low'),
                            'method': content.get('method', 'chunk-id-lookup'),
                            'block_content': None,
                            'verification': None,
                            'matched_block_content': content.get('matched_block_content')
                        }
                        citations.append(citation)
                        logger.info(
                            f"[AGENT_NODE] Extracted chunk citation: chunk_id={content.get('chunk_id', '')[:20]}..., "
                            f"page={content.get('page', 0)}, confidence={content.get('confidence', 'low')}, "
                            f"filename={original_filename}"
                        )
                except (json.JSONDecodeError, AttributeError, TypeError) as e:
                    logger.warning(f"[AGENT_NODE] Failed to extract chunk citation from tool message: {e}")
                    pass
    
    return citations

async def generate_conversational_answer(user_query: str, chunk_text: str) -> str:
    """
    Generate conversational, intent-aware answer from chunk text only.
    
    This function:
    - Receives ONLY chunk text (no metadata, filenames, IDs)
    - Uses intent-aware answer contract
    - Returns conversational, helpful answer
    - NEVER mentions metadata, filenames, or retrieval steps
    """
    # INTENT-AWARE ANSWER CONTRACT (Production-Grade)
    main_tagging_rule = _get_main_answer_tagging_rule()
    system_prompt = SystemMessage(content=get_agent_chip_system_prompt(main_tagging_rule))
    user_prompt = get_agent_chip_user_prompt(user_query, chunk_text)

    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0.3,  # Slightly higher for more natural responses
    )
    
    try:
        response = await llm.ainvoke([system_prompt, HumanMessage(content=user_prompt)])
        raw = response.content.strip()
        return ensure_main_tags_when_missing(raw, user_query)
    except Exception as e:
        logger.error(f"[AGENT_NODE] Error generating conversational answer: {e}")
        return "I encountered an error while generating the answer."


@log_node_perf("agent")
async def agent_node(state: MainWorkflowState, runnable_config=None) -> MainWorkflowState:
    """
    Unified agent - lets LLM see and react to tool results naturally.
    
    The agent feedback loop:
    1. Agent sees query (or previous conversation)
    2. Agent decides strategy and calls tools
    3. Agent sees ToolMessages with results
    4. Agent evaluates quality and decides to retry or answer
    
    Args:
        state: MainWorkflowState with user_query, messages, etc.
        runnable_config: Optional RunnableConfig from LangGraph
        
    Returns:
        Updated state with messages
    """
    user_query = state.get("user_query", "")
    is_agent_mode = state.get("is_agent_mode", False)
    messages = state.get("messages", [])
    
    logger.info(f"[AGENT_NODE] Processing query: '{user_query[:80]}...'")
    logger.info(f"[AGENT_NODE] Current message count: {len(messages)}")
    
    # Deduplicate messages (safety net against double invocation)
    if messages and len(messages) > 1:
        seen = set()
        deduped = []
        for msg in messages:
            # Create fingerprint: class name + content hash
            if hasattr(msg, 'content') and msg.content:
                # Hash content to avoid comparing large strings
                content_hash = hash(str(msg.content)[:200])
                fingerprint = f"{msg.__class__.__name__}:{content_hash}"
            elif hasattr(msg, 'tool_calls') and msg.tool_calls:
                # For tool calls, hash the tool call IDs
                tool_calls_str = str([tc.get('id', '') for tc in msg.tool_calls])
                fingerprint = f"{msg.__class__.__name__}:tools:{hash(tool_calls_str)}"
            else:
                # Use object id as fallback
                fingerprint = f"{msg.__class__.__name__}:{id(msg)}"
            
            if fingerprint not in seen:
                seen.add(fingerprint)
                deduped.append(msg)
        
        if len(deduped) < len(messages):
            logger.warning(
                f"[AGENT_NODE] ⚠️  Removed {len(messages) - len(deduped)} duplicate messages! "
                f"({len(messages)} → {len(deduped)})"
            )
            messages = deduped
    
    # NEW: Log message count and estimate token usage for summarization tracking
    if messages:
        logger.info(f"[AGENT_NODE] Message history: {len(messages)} messages")
        
        # Estimate token count (rough approximation: 1 token ≈ 4 characters)
        estimated_tokens = sum(len(str(msg.content)) // 4 if hasattr(msg, 'content') else 0 for msg in messages)
        logger.info(f"[AGENT_NODE] Estimated tokens: ~{estimated_tokens:,}")
        
        if estimated_tokens > 8000:
            logger.warning(
                f"⚠️  [AGENT_NODE] Token count ({estimated_tokens:,}) exceeds 8k threshold! "
                "Summarization middleware should trigger on this turn."
            )
        elif estimated_tokens > 6000:
            logger.info(
                f"🔔 [AGENT_NODE] Token count ({estimated_tokens:,}) approaching 8k limit "
                f"({int((estimated_tokens/8000)*100)}% of threshold)"
            )
    
    # NEW: Emit task header (high-level phase marker) on first call
    emitter = state.get("execution_events")
    if emitter and not messages:
        from backend.llm.utils.execution_events import ExecutionEvent
        task_header = ExecutionEvent(
            type="phase",
            description=f"Analyzing: {user_query[:80]}{'...' if len(user_query) > 80 else ''}"
        )
        emitter.emit(task_header)
    
    # First call only: build initial prompt with optional search-scope rails (no work on later turns)
    if not messages:
        system_prompt = get_system_prompt('analyze')
        property_id = state.get("property_id")
        raw_doc_ids = state.get("document_ids")
        # Normalize to a new list of strings (never mutate state); handle None, single value, or list
        if raw_doc_ids is None:
            document_ids = []
        elif isinstance(raw_doc_ids, list):
            document_ids = [str(d) for d in raw_doc_ids if d]
        else:
            document_ids = [str(raw_doc_ids)]
        has_document_scope = bool(document_ids)
        has_property_scope = bool(property_id) and not has_document_scope

        # Build scope block only when needed; strip/newline only when block is non-empty
        if has_document_scope:
            scope_text = f"""
🎯 **SEARCH SCOPE – DOCUMENT(S) (MANDATORY)**
The user has attached specific **document(s)**. You must search **only within these documents**.
- When you call **retrieve_chunks**, use **only** these document IDs: {document_ids}.
- Do not use document IDs from other sources. Your answer must be based solely on content from these documents.
- You may call retrieve_documents first to confirm metadata, but retrieve_chunks MUST use the IDs above.
"""
        elif has_property_scope:
            scope_text = """
🎯 **SEARCH SCOPE – PROPERTY (MANDATORY)**
The user has attached a **property** (e.g. a property pin or project). You must search **only within that property**.
- When you call **retrieve_documents**, search for information relevant to the user's question in the context of this property only (e.g. include property-related context in your query so results are limited to this property’s documents).
- When you call **retrieve_chunks**, use **only** document IDs that belong to this property (from your retrieve_documents results). Do not search or answer using documents from other properties.
"""
        else:
            scope_text = ""
        search_scope_block = ("\n" + scope_text.strip() + "\n") if scope_text else ""
        initial_prompt = get_agent_initial_prompt(user_query, search_scope_block)

        # Optional workspace context (current project / documents in scope)
        try:
            business_id = state.get("business_id")
            if business_id and (property_id or document_ids):
                workspace_section = build_workspace_context(
                    property_id, document_ids if document_ids else None, str(business_id)
                )
                if workspace_section:
                    system_prompt = SystemMessage(
                        content=system_prompt.content + "\n\n" + workspace_section
                    )
        except Exception as e:
            logger.warning("[AGENT_NODE] build_workspace_context failed: %s", e)

        messages = [
            system_prompt,
            HumanMessage(content=initial_prompt)
        ]
        
        logger.info("[AGENT_NODE] Initialized conversation with system prompt + user query")
    else:
        # Log message history for debugging
        logger.info("[AGENT_NODE] Message history:")
        for i, msg in enumerate(messages):
            msg_type = type(msg).__name__
            content_preview = ""
            if hasattr(msg, 'content') and msg.content:
                content_preview = str(msg.content)[:100]
            elif hasattr(msg, 'tool_calls') and msg.tool_calls:
                content_preview = f"{len(msg.tool_calls)} tool call(s)"
            
            logger.info(f"  [{i}] {msg_type}: {content_preview}")
    
    # Build tools list - include plan_step for visible intent sharing
    retrieval_tools = [
        create_document_retrieval_tool(),
        # Note: Using simple retrieve_chunks tool instead of document_explorer
    ]
    
    # Add citation tool for chunk-based citations
    citation_tool = create_chunk_citation_tool()
    
    # Add plan_step as the first tool (optional, agent decides when to use it)
    all_tools = [plan_step] + list(retrieval_tools) + [citation_tool]
    logger.info(f"[AGENT_NODE] Agent has {len(all_tools)} tools available (including plan_step and chunk citation tool)")
    
    # Create LLM with tools bound
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    ).bind_tools(all_tools, tool_choice="auto")
    
    logger.info("[AGENT_NODE] Invoking LLM with full message history...")
    
    try:
        # Invoke LLM with full message history
        # LLM sees: SystemMessage, HumanMessage, AIMessage (with tool_calls), ToolMessage, ...
        # LangGraph's ToolNode automatically adds ToolMessages to the conversation
        response = await llm.ainvoke(messages)
        
        # Check if agent made tool calls
        if hasattr(response, 'tool_calls') and response.tool_calls:
            logger.info(f"[AGENT_NODE] ✅ Agent made {len(response.tool_calls)} tool call(s):")
            for i, tool_call in enumerate(response.tool_calls):
                tool_name = tool_call.get('name', 'unknown')
                tool_args = str(tool_call.get('args', {}))[:100]
                logger.info(f"  [{i}] {tool_name}({tool_args}...)")
            
            # Return updated messages - ToolNode will execute tools and add ToolMessages
            return {"messages": [response]}
        
        # No tool calls - agent generated final answer or is done
        logger.info("[AGENT_NODE] ℹ️  Agent generated response (no tool calls)")
        
        # Extract chunk citations from message history
        chunk_citations = extract_chunk_citations_from_messages(messages)
        if chunk_citations:
            logger.info(f"[AGENT_NODE] ✅ Extracted {len(chunk_citations)} chunk citations from message history")
        
        # Check if chunks were retrieved - if yes, use conversational answer generation (no metadata visible)
        chunk_text = extract_chunk_text_only(messages)
        has_chunks = bool(chunk_text.strip())
        
        if has_chunks:
            # Chunks exist - use conversational answer generation (metadata hidden from answer LLM)
            logger.info("[AGENT_NODE] ✅ Chunks detected - using conversational answer generation (metadata hidden)")
            user_query = state.get("user_query", "")
            conversational_answer = await generate_conversational_answer(user_query, chunk_text)
            
            # Create clean AIMessage with conversational answer
            from langchain_core.messages import AIMessage
            clean_response = AIMessage(content=conversational_answer)
            
            logger.info(f"[AGENT_NODE] Conversational answer generated ({len(conversational_answer)} chars): {conversational_answer[:100]}...")
            
            # Return response with chunk citations if any
            result = {"messages": [clean_response]}
            if chunk_citations:
                result["chunk_citations"] = chunk_citations
            return result
        else:
            # No chunks - use agent's original response (for non-document questions)
            logger.info("[AGENT_NODE] No chunks detected - using agent's original response")
            if hasattr(response, 'content') and response.content:
                logger.info(f"[AGENT_NODE] Response preview: {str(response.content)[:200]}...")
            
            # Return response with chunk citations if any
            result = {"messages": [response]}
            if chunk_citations:
                result["chunk_citations"] = chunk_citations
            return result
        
    except Exception as e:
        logger.error(f"[AGENT_NODE] ❌ Error: {e}", exc_info=True)
        return {
            "messages": messages,
            "final_summary": f"I encountered an error while processing your query: {str(e)}"
        }

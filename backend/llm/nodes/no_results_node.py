"""
No Results Node: Shared failure handler for exhausted retries.

This node generates helpful failure messages when document or chunk retrieval
exhausts all retry attempts. Provides better UX by explaining what was searched,
asking clarification questions, and suggesting rephrasing.
"""

import logging
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from backend.llm.config import config
from backend.llm.types import MainWorkflowState

logger = logging.getLogger(__name__)


async def no_results_node(state: MainWorkflowState) -> MainWorkflowState:
    """
    Generate helpful failure message when retrieval exhausts all retries.
    
    This node:
    1. Determines failure context (document-level vs chunk-level vs both)
    2. Extracts failure information (failure reasons, retrieved_documents if any)
    3. Generates helpful failure message with LLM
    4. Suggests rephrasing based on failure reasons
    
    Args:
        state: MainWorkflowState with failure reasons and context
        
    Returns:
        Updated state with final_summary containing helpful failure message
    """
    user_query = state.get("user_query", "").strip()
    last_document_failure_reason = state.get("last_document_failure_reason")
    last_chunk_failure_reason = state.get("last_chunk_failure_reason")
    retrieved_documents = state.get("retrieved_documents", [])
    document_retry_count = state.get("document_retry_count", 0)
    chunk_retry_count = state.get("chunk_retry_count", 0)
    query_intent = state.get("query_intent", {})
    
    # Determine failure context
    document_level_failure = bool(last_document_failure_reason)
    chunk_level_failure = bool(last_chunk_failure_reason)
    
    if document_level_failure and chunk_level_failure:
        failure_context = "both"
        failure_description = f"Document retrieval failed: {last_document_failure_reason}. Chunk retrieval also failed: {last_chunk_failure_reason}."
    elif document_level_failure:
        failure_context = "document"
        failure_description = f"Document retrieval failed after {document_retry_count} attempts: {last_document_failure_reason}"
    elif chunk_level_failure:
        failure_context = "chunk"
        failure_description = f"Chunk retrieval failed after {chunk_retry_count} attempts: {last_chunk_failure_reason}"
        if retrieved_documents:
            failure_description += f" (Found {len(retrieved_documents)} documents but no relevant chunks)"
    else:
        failure_context = "unknown"
        failure_description = "Retrieval failed for unknown reason"
    
    # Extract document types if any documents were found (filter out None values)
    document_types_found = []
    if retrieved_documents:
        document_types_found = list(set([
            doc.get("document_type", "unknown") 
            for doc in retrieved_documents 
            if doc.get("document_type") is not None
        ]))
        # If all were None, use "unknown"
        if not document_types_found:
            document_types_found = ["unknown"]
    
    logger.info(
        f"[NO_RESULTS] Generating failure message for context: {failure_context}, "
        f"document_retries={document_retry_count}, chunk_retries={chunk_retry_count}"
    )
    
    # Generate helpful failure message using LLM
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )
    
    system_prompt = """You are a helpful assistant that explains search failures to users.

When document or chunk retrieval fails after multiple retry attempts, generate a helpful
failure message that:
1. Explains what was searched (query, document types, retry attempts)
2. Asks a clarification question if the query is ambiguous
3. Suggests rephrasing based on failure reasons
4. Mentions document types found (if any) that might be relevant
5. Is friendly, helpful, and actionable

Be concise but informative. Don't be overly technical."""

    # Safely join document types (already filtered for None values)
    document_types_str = ', '.join(document_types_found) if document_types_found else 'none'
    
    human_prompt = f"""The user asked: "{user_query}"

Search failed after retries:
{failure_description}

Failure context: {failure_context}
Document retry attempts: {document_retry_count}
Chunk retry attempts: {chunk_retry_count}
Document types found: {document_types_str}
Query intent: {query_intent.get('search_goal', 'unknown')} ({query_intent.get('query_type', 'unknown')} query)

Generate a helpful failure message that:
- Explains what was searched
- Suggests alternative queries or rephrasing
- Asks for clarification if needed
- Mentions any relevant document types found

Keep it concise and actionable."""

    try:
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=human_prompt)
        ]
        
        response = await llm.ainvoke(messages)
        failure_message = response.content.strip()
        
        logger.info(f"[NO_RESULTS] Generated failure message: {failure_message[:100]}...")
        
        return {
            "final_summary": failure_message,
            "agent_actions": []  # No document opening actions for failures
        }
        
    except Exception as e:
        logger.error(f"[NO_RESULTS] Error generating failure message: {e}", exc_info=True)
        # Fallback message
        fallback_message = (
            f"I couldn't find documents matching your query: \"{user_query}\".\n\n"
            "This could be because:\n"
            "- The information might be described differently in the documents\n"
            "- The documents may not contain this specific information\n"
            "- Try rephrasing your query or using more general terms"
        )
        return {
            "final_summary": fallback_message,
            "agent_actions": []
        }


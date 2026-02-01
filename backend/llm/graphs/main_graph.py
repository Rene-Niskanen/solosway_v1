"""
Main LangGraph orchestration for document analysis workflow.
Coordinates vector/SQL retrieval, document processing, and summarisation.

NOW WITH STATE PERSISTENCE via PostgreSQL checkpointer for conversation memory.
"""

from langgraph.graph import StateGraph, START, END
import logging
import os

logger = logging.getLogger(__name__)

# Conditional import for checkpointer
try:
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg_pool import AsyncConnectionPool
    CHECKPOINTER_AVAILABLE = True
except ImportError:
    CHECKPOINTER_AVAILABLE = False
    AsyncPostgresSaver = None
    AsyncConnectionPool = None
    logger.warning("langgraph.checkpoint.postgres not available - checkpointer features disabled")

from backend.llm.types import MainWorkflowState
from backend.llm.nodes.retrieval_nodes import (
    rewrite_query_with_context,
    query_vector_documents,
    clarify_relevant_docs
)
from backend.llm.nodes.processing_nodes import process_documents
from backend.llm.nodes.summary_nodes import summarize_results


async def create_checkpointer_for_current_loop():
    """Create checkpointer for current event loop; returns None if unavailable."""
    if not CHECKPOINTER_AVAILABLE:
        return None
    try:
        import asyncio
        from backend.services.supabase_client_factory import get_supabase_db_url
        db_url = get_supabase_db_url()
        if not db_url:
            return None
        conn_params = f"{db_url}?connect_timeout=5" if "?" not in db_url else f"{db_url}&connect_timeout=5"
        pool = AsyncConnectionPool(conninfo=conn_params, min_size=1, max_size=2, open=True, timeout=20)
        checkpointer = AsyncPostgresSaver(pool)
        await asyncio.wait_for(checkpointer.setup(), timeout=10.0)
        return checkpointer
    except Exception as e:
        logger.warning("Checkpointer unavailable: %s - using stateless mode", e)
        return None


async def build_main_graph(use_checkpointer: bool = True, checkpointer_instance=None):
    """
    Build and compile the main LangGraph orchestration (async for checkpointer setup).

    NEW: Now includes PostgreSQL checkpointer for conversation persistence
    and query rewriting for context-aware follow-up questions.

    Flow (Vector-Only with Context):
    1. Rewrite query (adds context from conversation history)
    2. Vector search (semantic similarity on document embeddings)
    3. Clarify (LLM re-rank by relevance, merge chunks)
    4. Process documents (parallel subgraph invocations per document)
    5. Summarize (LLM creates unified summary with conversation memory)

    Note: SQL/structured retrieval temporarily disabled until implemented.
    
    Args:
        use_checkpointer: If True, enables state persistence across conversation turns
                         via PostgreSQL. Requires DATABASE_URL environment variable.

    Returns:
        Compiled LangGraph StateGraph with optional checkpointer
    """

    # Create the state graph 
    builder = StateGraph(MainWorkflowState)

    # Add active nodes
    builder.add_node("rewrite_query", rewrite_query_with_context)
    """
    Node 1: Query Rewriting (NEW)
    - Input: user_query, conversation_history
    - Rewrites vague queries to be self-contained using conversation context
    - Example: "What's the price?" → "What's the price for Highlands property?"
    - Output: rewritten user_query (or original if no history)
    """

    builder.add_node("query_vector_documents", query_vector_documents)
    """
    Node 2: Vector Search
    - Input: user_query (potentially rewritten), business_id
    - Embeds query and searches Supabase pgvector with HNSW index
    - Uses similarity threshold with fallback
    - Output: vector results (replaces relevant_documents)
    """

    builder.add_node("clarify_relevant_docs", clarify_relevant_docs)
    """
    Node 3: Clarify/Re-rank
    - Input: relevant_documents, conversation_history
    - Groups chunks by doc_id into unique documents
    - LLM re-ranks documents by relevance to user query
    - Considers conversation context for follow-up questions
    - Output: deduplicated and sorted relevant_documents
    """

    builder.add_node("process_documents", process_documents)
    """
    Node 4: Process Documents (parallel subgraph invocations)
    - Input: relevant_documents, user_query, conversation_history
    - For each unique document:
        - Invokes document_qa_subgraph
        - LLM extracts relevant information from document
    - Output: document_outputs (list of per-document analyses)
    - Supports simple_mode for faster stubbed responses
    """

    builder.add_node("summarize_results", summarize_results)
    """
    Node 5: Summarize
    - Input: document_outputs, user_query, conversation_history
    - LLM creates unified summary from all document analyses
    - References previous conversation for follow-up questions
    - Uses natural language (addresses and filenames, not IDs)
    - Output: final_summary, updated conversation_history
    """

    # Build graph edges (execution flow)

    # NEW: Start -> Query Rewriting (adds context from conversation)
    builder.add_edge(START, 'rewrite_query')
    logger.debug("Edge: START -> rewrite_query")

    # Query Rewriting -> Vector Search
    builder.add_edge('rewrite_query', 'query_vector_documents')
    logger.debug("Edge: rewrite_query -> query_vector_documents")

    # Vector Search -> Clarify
    builder.add_edge("query_vector_documents", "clarify_relevant_docs")
    logger.debug("Edge: query_vector_documents -> clarify_relevant_docs")

    # Clarify -> Process Documents
    builder.add_edge("clarify_relevant_docs", "process_documents")
    logger.debug("Edge: clarify_relevant_docs -> process_documents")

    # Process Documents -> Summarize 
    builder.add_edge("process_documents", "summarize_results")
    logger.debug("Edge: process_documents -> summarize_results")

    # Summarize -> End 
    builder.add_edge("summarize_results", END)
    logger.debug("Edge: summarize_results -> END")

    checkpointer = checkpointer_instance if use_checkpointer else None
    if checkpointer:
        main_graph = builder.compile(checkpointer=checkpointer)
        logger.info("Main graph compiled WITH checkpointer (stateful)")
    else:
        main_graph = builder.compile()
        logger.info("Main graph compiled WITHOUT checkpointer (stateless)")

    return main_graph, checkpointer 

# Graph is built at runtime by graph_runner via build_main_graph()






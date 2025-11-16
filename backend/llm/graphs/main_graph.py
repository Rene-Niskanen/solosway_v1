"""
Main LangGraph orchestration for document analysis workflow.
Coordinates vector/SQL retrieval, document processing, and summarisation.

NOW WITH STATE PERSISTENCE via PostgreSQL checkpointer for conversation memory.
"""

from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from backend.llm.types import MainWorkflowState
from backend.llm.nodes.retrieval_nodes import (
    rewrite_query_with_context,
    query_vector_documents,
    clarify_relevant_docs
)
from backend.llm.nodes.processing_nodes import process_documents
from backend.llm.nodes.summary_nodes import summarize_results
import logging
import os

logger = logging.getLogger(__name__)

async def build_main_graph(use_checkpointer: bool = True):
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

    # NEW: Add PostgreSQL checkpointer for state persistence
    if use_checkpointer:
        try:
            # Use DATABASE_URL from environment (Supabase PostgreSQL connection)
            db_url = os.getenv("DATABASE_URL")
            if not db_url:
                logger.warning("DATABASE_URL not set, falling back to stateless mode")
                main_graph = builder.compile()
                logger.info("Main graph compiled WITHOUT checkpointer (stateless)")
                return main_graph
            
            # Create AsyncPostgreSQL checkpointer for async graph execution
            # Step 1: Setup tables using context manager
            async with AsyncPostgresSaver.from_conn_string(db_url) as setup_checkpointer:
                await setup_checkpointer.setup()
            
            # Step 2: Create persistent checkpointer for graph
            # We await the context manager to get the actual checkpointer instance
            checkpointer = await AsyncPostgresSaver.from_conn_string(db_url).__aenter__()
            
            # Compile WITH checkpointer (enables conversation memory)
            main_graph = builder.compile(checkpointer=checkpointer)
            logger.info("Main graph compiled WITH PostgreSQL checkpointer (stateful)")
            logger.info("   Conversation state will persist across turns")
            logger.info("   Use thread_id in config to maintain context")
            
        except Exception as e:
            logger.error(f"Failed to initialize checkpointer: {e}")
            logger.warning("   Falling back to stateless mode")
            main_graph = builder.compile()
            logger.info("Main graph compiled WITHOUT checkpointer (stateless)")
    else:
        # Compile WITHOUT checkpointer (for testing or stateless mode)
        main_graph = builder.compile()
        logger.info("Main graph compiled WITHOUT checkpointer (stateless)")

    return main_graph 

# Export and compile graph with checkpointer enabled
# Note: This needs to be called at module import time, so we use asyncio
import asyncio

def _build_graph_sync():
    """Synchronous wrapper for async graph building."""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    
    return loop.run_until_complete(build_main_graph(use_checkpointer=True))

main_graph = _build_graph_sync()






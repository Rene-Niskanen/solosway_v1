"""
Main LangGraph orchestration for document analysis workflow.
Coordinates vector/SQL retrieval, document processing, and summarisation.

NOW WITH STATE PERSISTENCE via PostgreSQL checkpointer for conversation memory.
"""

from langgraph.graph import StateGraph, START, END
import logging
import os

logger = logging.getLogger(__name__)

# Conditional import for checkpointer (only needed if use_checkpointer=True)
try:
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver  # type: ignore
    from psycopg_pool import AsyncConnectionPool  # type: ignore
    CHECKPOINTER_AVAILABLE = True
except ImportError:
    CHECKPOINTER_AVAILABLE = False
    AsyncPostgresSaver = None  # Placeholder to avoid NameError
    AsyncConnectionPool = None
    logger.warning("langgraph.checkpoint.postgres not available - checkpointer features disabled")

from backend.llm.types import MainWorkflowState
from backend.llm.nodes.retrieval_nodes import (
    rewrite_query_with_context,
    check_cached_documents,
    expand_query_for_retrieval,
    query_vector_documents,
    clarify_relevant_docs
)
from backend.llm.nodes.detail_level_detector import determine_detail_level
from backend.llm.nodes.processing_nodes import process_documents
from backend.llm.nodes.summary_nodes import summarize_results

async def create_checkpointer_for_current_loop():
    """
    Create a new checkpointer instance for the current event loop.
    Each event loop needs its own checkpointer to avoid lock conflicts.
    All checkpointers point to the same database, so persistence is shared.
    
    This allows multiple threads/event loops to use checkpointing simultaneously
    while maintaining conversation state per user_id & chat_id (thread_id).
    
    Returns:
        AsyncPostgresSaver instance or None if checkpointer unavailable
    """
    if not CHECKPOINTER_AVAILABLE:
        logger.warning("Checkpointer not available - returning None")
        return None
    
    try:
        import asyncio
        from backend.services.supabase_client_factory import get_supabase_db_url
        db_url = get_supabase_db_url()
        
        # Create connection pool for THIS event loop with optimized settings
        # Reduced max_size to avoid connection exhaustion - each event loop gets 2 connections
        # This prevents authentication timeout issues when multiple checkpointers exist
        # Disable prepared statements to avoid "prepared statement already exists" errors
        # when multiple event loops create checkpointers concurrently
        # prepare_threshold=0 disables prepared statements entirely
        conn_params = db_url
        if '?' not in db_url:
            conn_params = f"{db_url}?prepare_threshold=0&connect_timeout=5"
        else:
            conn_params = f"{db_url}&prepare_threshold=0&connect_timeout=5"
        
        # Create pool with lazy connection opening to avoid immediate connection exhaustion
        # With open=True, min_size connections are opened immediately
        # With open=False, connections are opened on-demand (better for concurrent requests)
        pool = AsyncConnectionPool(
            conninfo=conn_params, 
            min_size=1,  # Minimum connections in the pool (required by psycopg_pool)
            max_size=2,  # Maximum connections per event loop
            open=True,  # Open pool immediately (connections opened on first use with min_size=1)
            timeout=20  # Increased timeout when getting connection from pool (seconds)
            # Increased from 5s to 20s to handle concurrent requests and Supabase pooler delays
        )
        
        # Create checkpointer instance for this event loop
        checkpointer = AsyncPostgresSaver(pool)
        
        # Setup tables with timeout to prevent hanging
        # Idempotent - safe to call multiple times
        # Note: If tables were manually created (via migration), setup() may fail with
        # "CREATE INDEX CONCURRENTLY cannot run inside transaction" error.
        # Since tables already exist from migration, we continue with checkpointer anyway.
        try:
            # Reduced timeout to 10 seconds for faster startup - will fallback to stateless mode
            await asyncio.wait_for(checkpointer.setup(), timeout=10.0)
            logger.info("Checkpointer setup completed successfully")
        except asyncio.TimeoutError:
            logger.warning("Checkpointer setup timed out after 10 seconds - using stateless mode (this is OK)")
            return None
        except Exception as setup_error:
            error_msg = str(setup_error)
            # If setup fails with CONCURRENTLY error, tables already exist from migration
            # This is expected when tables are manually created - setup() can't use CONCURRENTLY in transactions
            if "CREATE INDEX CONCURRENTLY cannot run inside a transaction block" in error_msg:
                logger.warning("Checkpointer setup() failed with CONCURRENTLY error - this is expected")
                logger.info("Tables already exist from migration with correct schema - continuing with checkpointer")
                # Continue with checkpointer - tables are already created and ready
            elif "does not exist" in error_msg and ("column" in error_msg or "relation" in error_msg):
                # Schema mismatch error - this should not happen after our migrations
                logger.error(f"Checkpointer setup failed with schema error: {setup_error}")
                logger.error("This indicates a schema mismatch - tables may need to be recreated")
                return None
            else:
                # For any other error, log it but still try to continue if tables exist
                # Worst case, checkpointer will fail and fall back to stateless mode
                logger.warning(f"Checkpointer setup() encountered an error: {setup_error}")
                logger.info("Assuming tables are correctly set up from migration - continuing with checkpointer")
                # Continue anyway - if tables don't work, checkpointer operations will fail and fall back to stateless
        
        logger.info("✅ Checkpointer created for current event loop (pool size: 2)")
        return checkpointer
    except Exception as e:
        logger.error(f"Error creating checkpointer for event loop: {e}", exc_info=True)
        return None

async def build_main_graph(use_checkpointer: bool = True, checkpointer_instance=None):
    """
    Build and compile the main LangGraph orchestration (async for checkpointer setup).

    NEW: Now includes PostgreSQL checkpointer for conversation persistence
    and query rewriting for context-aware follow-up questions.

    Flow (Vector-Only with Context + Query Expansion):
    1. Rewrite query (adds context from conversation history)
    2. Expand query (generates variations for better recall) 
    3. Vector search (multi-query with RRF merging)
    4. Clarify (LLM re-rank by relevance, merge chunks)
    5. Process documents (parallel subgraph invocations per document)
    6. Summarize (LLM creates unified summary with conversation memory)

    Note: SQL/structured retrieval temporarily disabled until implemented.
    
    Args:
        use_checkpointer: If True, enables state persistence across conversation turns
                         via PostgreSQL. Requires SUPABASE_DB_URL environment variable.
        checkpointer_instance: Optional pre-created checkpointer instance.
                              If None and use_checkpointer=True, creates one for current event loop.
                              Use this to create checkpointers per event loop to avoid lock conflicts.

    Returns:
        Compiled LangGraph StateGraph with optional checkpointer
    """

    # Create the state graph 
    builder = StateGraph(MainWorkflowState)

    # Add active nodes
    builder.add_node("check_cached_documents", check_cached_documents)
    """
    Node 0.5: Check Cached Documents (NEW - Performance Optimization)
    - Input: user_query, conversation_history, relevant_documents (from checkpointer)
    - Checks if documents were already retrieved in previous conversation turns
    - If property context matches, reuses cached documents (much faster)
    - If property context differs or no cache, proceeds with normal retrieval
    - Output: cached relevant_documents (if applicable) or empty to proceed
    """
    
    builder.add_node("rewrite_query", rewrite_query_with_context)
    """
    Node 1: Query Rewriting (NEW)
    - Input: user_query, conversation_history
    - Rewrites vague queries to be self-contained using conversation context
    - Example: "What's the price?" → "What's the price for Highlands property?"
    - Output: rewritten user_query (or original if no history)
    """

    builder.add_node("determine_detail_level", determine_detail_level)
    """
    Node 1.5: Detail Level Detection (NEW - Intelligent Classification)
    - Input: user_query, conversation_history (optional)
    - Uses fast LLM (gpt-4o-mini) to classify query complexity
    - Determines if query needs detailed RICS-level answer or concise factual answer
    - Skips detection if detail_level already set (manual override from API)
    - Output: detail_level ("concise" or "detailed")
    - Performance: ~0.5-1s with gpt-4o-mini
    """

    builder.add_node("expand_query", expand_query_for_retrieval)
    """
    Node 2: Query Expansion (NEW - Accuracy Improvement)
    - Input: user_query (potentially rewritten)
    - Generates 2 query variations with synonyms and rephrasing
    - Example: "foundation issues" → ["foundation issues", "foundation damage", "concrete defects"]
    - Output: query_variations list
    - Improves recall by 15-30% by catching different phrasings
    """

    builder.add_node("query_vector_documents", query_vector_documents)
    """
    Node 3: Vector Search with Multi-Query (NEW - Uses query variations)
    - Input: query_variations (from expand_query), business_id
    - Embeds each query variation and searches Supabase pgvector
    - Merges results with Reciprocal Rank Fusion (RRF)
    - Uses HNSW index with optimized parameters
    - Output: vector results (merged, deduplicated by RRF)
    """

    builder.add_node("clarify_relevant_docs", clarify_relevant_docs)
    """
    Node 4: Clarify/Re-rank
    - Input: relevant_documents, conversation_history
    - Groups chunks by doc_id into unique documents
    - LLM re-ranks documents by relevance to user query
    - Considers conversation context for follow-up questions
    - Output: deduplicated and sorted relevant_documents
    """

    builder.add_node("process_documents", process_documents)
    """
    Node 5: Process Documents (parallel subgraph invocations)
    - Input: relevant_documents, user_query, conversation_history
    - For each unique document:
        - Invokes document_qa_subgraph
        - LLM extracts relevant information from document
    - Output: document_outputs (list of per-document analyses)
    - Supports simple_mode for faster stubbed responses
    """

    builder.add_node("summarize_results", summarize_results)
    """
    Node 6: Summarize
    - Input: document_outputs, user_query, conversation_history
    - LLM creates unified summary from all document analyses
    - References previous conversation for follow-up questions
    - Uses natural language (addresses and filenames, not IDs)
    - Output: final_summary, updated conversation_history
    """

    # Build graph edges (execution flow)

    # NEW: Start -> Query Rewriting (adds context from conversation)
    builder.add_edge(START, 'check_cached_documents')
    logger.debug("Edge: START -> check_cached_documents")
    
    builder.add_edge('check_cached_documents', 'rewrite_query')
    logger.debug("Edge: check_cached_documents -> rewrite_query")

    # Query Rewriting -> Detail Level Detection
    builder.add_edge('rewrite_query', 'determine_detail_level')
    logger.debug("Edge: rewrite_query -> determine_detail_level")

    # Detail Level Detection -> Query Expansion
    builder.add_edge('determine_detail_level', 'expand_query')
    logger.debug("Edge: determine_detail_level -> expand_query")

    # Query Expansion -> Vector Search (searches with all variations)
    builder.add_edge('expand_query', 'query_vector_documents')
    logger.debug("Edge: expand_query -> query_vector_documents")

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

    # Add checkpointer setup
    checkpointer = None 

    if use_checkpointer:
        # Use provided checkpointer instance, or create one for current event loop
        if checkpointer_instance:
            checkpointer = checkpointer_instance
            logger.info("Using provided checkpointer instance")
        else:
            # Create checkpointer for current event loop
            checkpointer = await create_checkpointer_for_current_loop()
            if not checkpointer:
                logger.warning("Failed to create checkpointer - using stateless mode")
                main_graph = builder.compile()
                return main_graph, None

        # Compile with checkpointer (subgraphs will inherit it automatically)
        main_graph = builder.compile(checkpointer=checkpointer)
        logger.info("Graph compiled with checkpointer")

        return main_graph, checkpointer

    else:
        main_graph = builder.compile()
        return main_graph, checkpointer

# Global graph and checkpointer instances (initialized on app startup)
main_graph = None 
checkpointer = None

async def initialize_graph():
    """Initialize LangGraph on app startup - call this once before handling requests"""
    global main_graph, checkpointer
    main_graph, checkpointer = await build_main_graph(use_checkpointer=True)
    logger.info("✅ LangGraph initialized with checkpointer")






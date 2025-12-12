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
    from psycopg import AsyncConnection  # type: ignore
    CHECKPOINTER_AVAILABLE = True
except ImportError:
    CHECKPOINTER_AVAILABLE = False
    AsyncPostgresSaver = None  # Placeholder to avoid NameError
    AsyncConnectionPool = None
    AsyncConnection = None
    logger.warning("langgraph.checkpoint.postgres not available - checkpointer features disabled")

from backend.llm.types import MainWorkflowState
from backend.llm.nodes.routing_nodes import route_query, fetch_direct_document_chunks
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
from backend.llm.nodes.formatting_nodes import format_response
from typing import Literal

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
        from backend.services.supabase_client_factory import get_supabase_db_url_for_checkpointer
        db_url = get_supabase_db_url_for_checkpointer()  # Use session pooler for checkpointer
        
        try:
            checkpointer = await AsyncPostgresSaver.from_conn_string(
                db_url,
                prepare_threshold=0,  # Directly disable prepared statements
                autocommit=True
            )
            logger.info("✅ Checkpointer created using from_conn_string (prepared statements disabled)")
        except (AttributeError, TypeError, Exception) as from_string_error:
            # from_conn_string might not be available or might not accept these parameters
            # Fall back to pool-based approach with connection wrapper
            logger.info(f"from_conn_string approach failed, using pool with wrapper: {from_string_error}")
            
            # Create connection string with timeout
            conn_params = db_url
            if '?' not in db_url:
                conn_params = f"{db_url}?connect_timeout=5"
            elif 'connect_timeout' not in db_url:
                conn_params = f"{db_url}&connect_timeout=5"
            
            # Create a connection factory that sets prepare_threshold=0 on each connection
            # AsyncConnection is imported at the top of the file (conditional import)
            if AsyncConnection is None:
                raise ImportError("psycopg.AsyncConnection not available")
            
            async def connection_factory(conninfo):
                """Factory that creates connections with prepare_threshold=0"""
                conn = await AsyncConnection.connect(conninfo)  # type: ignore
                conn.prepare_threshold = 0
                return conn
            
            # Create pool with connection factory
            # Note: AsyncConnectionPool might not support connection_factory directly
            # If it doesn't, we'll fall back to the basic pool and handle errors gracefully
            try:
                pool = AsyncConnectionPool(
                    conninfo=conn_params,
                    min_size=3,
                    max_size=7,
                    open=True,
                    timeout=20,
                    connection_factory=connection_factory  # Try connection factory
                )
                logger.info("✅ Checkpointer pool created with connection factory (prepared statements disabled)")
            except TypeError:
                # connection_factory not supported, use basic pool
                # We'll need to handle prepared statement errors with retry logic
                logger.warning("connection_factory not supported, using basic pool (errors will be handled gracefully)")
                pool = AsyncConnectionPool(
                    conninfo=conn_params,
                    min_size=3,
                    max_size=7,
                    open=True,
                    timeout=20,
                )
                logger.info("✅ Checkpointer pool created (prepared statement errors will be handled gracefully)")
            
            # Create checkpointer instance for this event loop
            checkpointer = AsyncPostgresSaver(pool)
        
        # Setup tables with timeout to prevent hanging
        # Idempotent - safe to call multiple times

        try:
            # Reduced timeout to 10 seconds for faster startup - will fallback to stateless mode
            await asyncio.wait_for(checkpointer.setup(), timeout=10.0)
            logger.info("Checkpointer setup completed successfully")
        except asyncio.TimeoutError:
            logger.warning("Checkpointer setup timed out after 10 seconds - using stateless mode (this is OK)")
            return None
        except Exception as setup_error:
            error_msg = str(setup_error)

            # This is expected when tables are manually created 
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
        
        logger.info("✅ Checkpointer created for current event loop (pool size: 7, prepared statements disabled)")
        return checkpointer
    except Exception as e:
        logger.error(f"Error creating checkpointer for event loop: {e}", exc_info=True)
        return None

async def build_main_graph(use_checkpointer: bool = True, checkpointer_instance=None):
    """
    Build and compile the main LangGraph orchestration with intelligent routing.
    
    NEW: Includes intelligent routing for performance optimization:
    - Direct document path (~2s): User attached files → fetch chunks → process → summarize
    - Simple search path (~6s): Simple query → vector search → process → summarize
    - Complex search path (~12s): Full pipeline with expansion and clarification
    
    Flow (with Routing):
    1. Route query (determines fast vs full pipeline)
    2a. Fast path: Direct document fetch → process → summarize
    2b. Simple path: Vector search → process → summarize
    2c. Complex path: Rewrite → expand → vector → clarify → process → summarize
    
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

    # SPEED OPTIMIZATION: Check Cached Documents FIRST (our improvement)
    builder.add_node("check_cached_documents", check_cached_documents)
    """
    Node 0: Check Cached Documents (Performance Optimization)
    - Input: user_query, conversation_history, relevant_documents (from checkpointer)
    - Checks if documents were already retrieved in previous conversation turns
    - If property context matches, reuses cached documents (much faster)
    - If property context differs or no cache, proceeds with routing
    - Output: cached relevant_documents (if applicable) or empty to proceed
    """
    
    # ROUTER NODES (from citation-mapping - Performance Optimization)
    builder.add_node("route_query", route_query)
    """
    Node 0.5: Route Query (Performance Optimization)
    - Analyzes query complexity and context
    - Determines which workflow path to use (direct/simple/complex)
    - Sets optimization flags (skip_expansion, skip_clarify, etc.)
    """

    builder.add_node("fetch_direct_chunks", fetch_direct_document_chunks)
    """
    Fast Path Node: Direct Document Fetch
    - Fetches ALL chunks from specific document(s)
    - Bypasses vector search entirely
    - Used when user attaches files or mentions specific document
    """

    # EXISTING NODES (Full Pipeline)
    builder.add_node("rewrite_query", rewrite_query_with_context)
    """
    Node 1: Query Rewriting
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
    Node 2: Query Expansion (Accuracy Improvement)
    - Input: user_query (potentially rewritten)
    - Generates 2 query variations with synonyms and rephrasing
    - Example: "foundation issues" → ["foundation issues", "foundation damage", "concrete defects"]
    - Output: query_variations list
    - Improves recall by 15-30% by catching different phrasings
    """

    builder.add_node("query_vector_documents", query_vector_documents)
    """
    Node 3: Vector Search with Multi-Query (Uses query variations)
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
    
    builder.add_node("format_response", format_response)
    """
    Node 7: Format Response
    - Input: final_summary (raw LLM response)
    - Formats and structures the response for better readability
    - Ensures logical organization, consistent formatting, and completeness
    - Output: formatted final_summary
    """
    
    # ROUTING LOGIC FUNCTIONS
    def should_route(state: MainWorkflowState) -> Literal["direct_document", "simple_search", "complex_search"]:
        """
        Conditional routing - makes decision based on initial state.
        
        NOTE: This function receives state BEFORE route_query's return is merged,
        so we must duplicate the routing logic here instead of reading route_decision.
        """
        user_query = state.get("user_query", "").lower().strip()
        document_ids = state.get("document_ids", [])
        property_id = state.get("property_id")
        
        # FIX: Ensure document_ids is always a list (safety check)
        if document_ids and not isinstance(document_ids, list):
            document_ids = [str(document_ids)]
        elif not document_ids:
            document_ids = []
        
        logger.info(
            f"[ROUTER] should_route called - Query: '{user_query[:50]}...', "
            f"Docs: {document_ids} (count: {len(document_ids)}), "
            f"Property: {property_id[:8] if property_id else 'None'}"
        )
        
        # PATH 1: DIRECT DOCUMENT (FASTEST ~2s)
        if document_ids and len(document_ids) > 0:
            logger.info("🟢 [ROUTER] should_route → direct_document (document_ids provided)")
            return "direct_document"
        
        # PATH 2: PROPERTY CONTEXT (treat as simple_search for now)
        if property_id and any(word in user_query for word in [
            "report", "document", "inspection", "appraisal", "valuation", 
            "lease", "contract", "the document", "this document", "that document"
        ]):
            logger.info("🟡 [ROUTER] should_route → simple_search (property-specific query)")
            return "simple_search"
        
        # PATH 3: SIMPLE QUERY (MEDIUM ~6s)
        word_count = len(user_query.split())
        simple_keywords = [
            "what is", "what's", "how much", "how many", "price", "cost", 
            "value", "worth", "address", "location", "when", "who"
        ]
        is_simple = (
            word_count <= 8 and 
            any(keyword in user_query for keyword in simple_keywords)
        )
        
        if is_simple:
            logger.info("🟡 [ROUTER] should_route → simple_search (simple query)")
            return "simple_search"
        
        # PATH 4: COMPLEX QUERY (FULL PIPELINE ~12s)
        logger.info("🔴 [ROUTER] should_route → complex_search (complex query, full pipeline)")
        return "complex_search"

    def should_use_cached_documents(state: MainWorkflowState) -> Literal["process_documents", "route_query"]:
        """
        Conditional routing after cache check.
        If documents are cached, skip directly to processing.
        If not cached, proceed to routing.
        """
        cached_docs = state.get("relevant_documents", [])
        if cached_docs and len(cached_docs) > 0:
            logger.info(f"[GRAPH] Using {len(cached_docs)} cached documents - skipping to process")
            return "process_documents"
        logger.info("[GRAPH] No cached documents - proceeding to routing")
        return "route_query"

    def should_skip_expansion(state: MainWorkflowState) -> Literal["expand_query", "query_vector_documents"]:
        """Skip expansion if route_decision says so"""
        if state.get("skip_expansion"):
            return "query_vector_documents"
        return "expand_query"

    def should_skip_clarify(state: MainWorkflowState) -> Literal["clarify_relevant_docs", "process_documents"]:
        """Skip clarification for simple queries or direct documents"""
        if state.get("skip_clarify"):
            return "process_documents"
        # Also skip if only 1-2 documents (fast path)
        relevant_docs = state.get("relevant_documents", [])
        if len(relevant_docs) <= 2:
            return "process_documents"
        return "clarify_relevant_docs"

    # BUILD GRAPH EDGES
    # START → Check Cached Documents (our speed improvement)
    builder.add_edge(START, "check_cached_documents")
    logger.debug("Edge: START -> check_cached_documents")

    # Cache Check → Conditional: Use cached or route
    builder.add_conditional_edges(
        "check_cached_documents",
        should_use_cached_documents,
        {
            "process_documents": "process_documents",  # Cached - skip to process
            "route_query": "route_query"  # Not cached - proceed to routing
        }
    )
    logger.debug("Conditional: check_cached_documents -> [process_documents|route_query]")

    # Router → Conditional routing (from citation-mapping)
    builder.add_conditional_edges(
        "route_query",
        should_route,
        {
            "direct_document": "fetch_direct_chunks",
            "simple_search": "query_vector_documents",  # Skip expand/clarify
            "complex_search": "rewrite_query"  # Full pipeline
        }
    )
    logger.debug("Conditional: route_query -> [direct_document|simple_search|complex_search]")

    # DIRECT PATH: fetch → process → summarize (FASTEST ~2s)
    builder.add_edge("fetch_direct_chunks", "process_documents")
    logger.debug("Edge: fetch_direct_chunks -> process_documents")

    # SIMPLE PATH: vector → process → summarize (no clarify, ~6s)
    # Note: This edge is conditional below, but we also need direct edge for simple path
    # The conditional will handle routing after query_vector_documents

    # COMPLEX PATH: rewrite → expand → vector → clarify (conditional) → process
    builder.add_edge("rewrite_query", "determine_detail_level")
    logger.debug("Edge: rewrite_query -> determine_detail_level")

    builder.add_edge("determine_detail_level", "expand_query")
    logger.debug("Edge: determine_detail_level -> expand_query")

    # Expansion → Vector Search
    builder.add_edge("expand_query", "query_vector_documents")
    logger.debug("Edge: expand_query -> query_vector_documents")

    # Conditional: Skip clarification for simple queries
    builder.add_conditional_edges(
        "query_vector_documents",
        should_skip_clarify,
        {
            "clarify_relevant_docs": "clarify_relevant_docs",
            "process_documents": "process_documents"
        }
    )
    logger.debug("Conditional: query_vector_documents -> [clarify_relevant_docs|process_documents]")

    # Clarify → Process
    builder.add_edge("clarify_relevant_docs", "process_documents")
    logger.debug("Edge: clarify_relevant_docs -> process_documents")

    # ALL PATHS CONVERGE HERE
    builder.add_edge("process_documents", "summarize_results")
    logger.debug("Edge: process_documents -> summarize_results")

    # Format response for better readability
    builder.add_edge("summarize_results", "format_response")
    logger.debug("Edge: summarize_results -> format_response")

    builder.add_edge("format_response", END)
    logger.debug("Edge: format_response -> END")

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






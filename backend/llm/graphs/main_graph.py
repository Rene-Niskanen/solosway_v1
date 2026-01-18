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
from backend.llm.nodes.routing_nodes import route_query, fetch_direct_document_chunks, handle_citation_query, handle_attachment_fast, handle_navigation_action, detect_navigation_intent_node
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
# from backend.llm.nodes.query_classifier import classify_query_intent  # Replaced by combined node
from backend.llm.nodes.combined_query_preparation import classify_and_prepare_query  # OPTIMIZED: Combined classification + detail + expansion
from backend.llm.nodes.text_context_detector import detect_and_extract_text
from backend.llm.nodes.general_query_node import handle_general_query
from backend.llm.nodes.text_transformation_node import transform_text
from backend.llm.nodes.follow_up_query_node import handle_follow_up_query
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
    - If property context differs or no cache, proceeds with classification
    - Output: cached relevant_documents (if applicable) or empty to proceed
    """
    
    # COMBINED: Query Classification + Detail Level + Expansion in ONE LLM call
    builder.add_node("classify_and_prepare_query", classify_and_prepare_query)
    """
    Node 0.25: Combined Query Preparation (OPTIMIZED - saves ~1-1.5s)
    - Input: user_query, conversation_history, document_ids, relevant_documents
    - Does ALL of these in ONE LLM call:
      1. Classifies query as: general_query, text_transformation, document_search, follow_up, or hybrid
      2. Determines detail_level (concise vs detailed)
      3. Generates query_variations for better retrieval (if needed)
    - Output: query_category, detail_level, query_variations, skip_expansion=True
    - PERFORMANCE: Replaces 3 separate LLM calls with 1 (~1-1.5s faster)
    """
    
    # NEW: Context Detection (for text transformation)
    builder.add_node("detect_and_extract_text", detect_and_extract_text)
    """
    Node 0.3: Detect and Extract Text (NEW)
    - Input: user_query, conversation_history
    - Detects what text user wants to transform AND extracts it
    - Output: text_to_transform, transformation_instruction
    """
    
    # NEW: General Query Handler
    builder.add_node("handle_general_query", handle_general_query)
    """
    Node 0.4: Handle General Query (NEW)
    - Input: user_query, conversation_history
    - Answers general knowledge questions
    - Output: final_summary, conversation_history, citations
    """
    
    # NEW: Text Transformation Handler
    builder.add_node("transform_text", transform_text)
    """
    Node 0.45: Transform Text (NEW)
    - Input: text_to_transform, transformation_instruction, user_query
    - Transforms text based on user instruction
    - Output: final_summary, conversation_history, citations
    """
    
    # NEW: Follow-up Query Handler
    builder.add_node("handle_follow_up_query", handle_follow_up_query)
    """
    Node 0.5: Handle Follow-up Query (NEW)
    - Input: user_query, conversation_history
    - Handles queries asking for more detail on previous document search responses
    - Output: final_summary, conversation_history, citations
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

    builder.add_node("handle_attachment_fast", handle_attachment_fast)
    """
    ULTRA-FAST Path Node: Attachment Fast Handler (~2s)
    - User attached file(s) and selected "fast response"
    - Uses extracted text directly - single LLM call with attachment prompt
    - Skips ALL retrieval and document search
    - ~5-10x faster than normal pipeline
    """
    
    builder.add_node("handle_citation_query", handle_citation_query)
    """
    ULTRA-FAST Path Node: Citation Query Handler (~2s)
    - User clicked on a citation and asked a question about it
    - We already have: doc_id, page, bbox, cited_text
    - Skips ALL retrieval - single LLM call with cited text + user query
    - ~5-10x faster than normal pipeline
    """
    
    builder.add_node("detect_navigation_intent", detect_navigation_intent_node)
    """
    Pre-Router Node: LLM-based Navigation Intent Detection
    Runs before routing to determine if query is navigation vs information-seeking.
    Sets navigation_intent in state for should_route to use.
    """
    
    builder.add_node("handle_navigation_action", handle_navigation_action)
    """
    INSTANT Path Node: Navigation Action Handler (~0.1s)
    - User wants to navigate to a property on the map
    - Examples: "take me to highlands", "show me on the map"
    - Skips ALL document retrieval - directly emits agent actions
    - Frontend handles map opening and pin selection
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
    def should_route(state: MainWorkflowState) -> Literal["navigation_action", "citation_query", "direct_document", "simple_search", "complex_search"]:
        """
        Conditional routing - makes decision based on initial state.
        
        NOTE: This function receives state BEFORE route_query's return is merged,
        so we must duplicate the routing logic here instead of reading route_decision.
        
        CRITICAL: Attachment/citation checks ONLY run if values exist AND have content.
        Normal queries use the original routing logic unchanged.
        """
        user_query = state.get("user_query", "").lower().strip()
        document_ids = state.get("document_ids", [])
        property_id = state.get("property_id")
        citation_context = state.get("citation_context")
        attachment_context = state.get("attachment_context")
        response_mode = state.get("response_mode")
        is_agent_mode = state.get("is_agent_mode", False)
        
        # DEBUG: Log is_agent_mode and query for navigation detection
        logger.info(f"🧭 [ROUTER DEBUG] is_agent_mode={is_agent_mode}, query='{user_query[:60]}...'")
        
        # PATH -1: NAVIGATION ACTION (INSTANT - NO DOCUMENT RETRIEVAL)
        # Uses LLM-based detection from navigation_intent state (set by detect_navigation_intent_node)
        # Only in agent mode - reader mode doesn't have navigation tools
        navigation_intent = state.get("navigation_intent")
        if is_agent_mode and navigation_intent and navigation_intent.get("is_navigation"):
            logger.info(f"⚡ [ROUTER] should_route → navigation_action (LLM detected: '{navigation_intent.get('reason')}')")
            return "navigation_action"
        
        # PATH 0: CITATION QUERY (ULTRA-FAST ~2s)
        # When user clicked on a citation and asked a question about it
        if citation_context and isinstance(citation_context, dict):
            cited_text = citation_context.get("cited_text", "")
            if cited_text and len(str(cited_text).strip()) > 0:
                logger.info("⚡ [ROUTER] should_route → citation_query (citation_context provided)")
                return "citation_query"
        
        # ORIGINAL ROUTING LOGIC - Restored from HEAD to match working version
        # NOTE: Citation and attachment routing handled in route_query node, not here
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
        # FIX: Match route_query logic exactly - use OR not AND, same keywords
        word_count = len(user_query.split())
        simple_keywords = [
            "what is", "what's", "how much", "how many", "price", "cost", 
            "value", "when", "where", "who"
        ]
        
        if word_count <= 8 or any(kw in user_query for kw in simple_keywords):
            logger.info("🟡 [ROUTER] should_route → simple_search (simple query)")
            return "simple_search"
        
        # PATH 4: COMPLEX QUERY (FULL PIPELINE ~12s)
        logger.info("🔴 [ROUTER] should_route → complex_search (complex query, full pipeline)")
        return "complex_search"

    def should_use_cached_documents(state: MainWorkflowState) -> Literal["process_documents", "route_query"]:
        """
        Conditional routing after cache check (RESTORED FROM HEAD).
        If documents are cached, skip directly to processing.
        If not cached, proceed directly to route_query.
        """
        cached_docs = state.get("relevant_documents", [])
        if cached_docs and len(cached_docs) > 0:
            logger.info(f"[GRAPH] Using {len(cached_docs)} cached documents - skipping to process")
            return "process_documents"
        logger.info("[GRAPH] No cached documents - proceeding to routing (HEAD behavior)")
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

    # Cache Check → Conditional: Use cached or detect navigation intent (then route)
    builder.add_conditional_edges(
        "check_cached_documents",
        should_use_cached_documents,
        {
            "process_documents": "process_documents",  # Cached - skip to process
            "route_query": "detect_navigation_intent"  # Not cached - detect navigation intent first
        }
    )
    logger.debug("Conditional: check_cached_documents -> [process_documents|detect_navigation_intent]")
    
    # Navigation Intent Detection → Route Query
    builder.add_edge("detect_navigation_intent", "route_query")
    logger.debug("Edge: detect_navigation_intent -> route_query (LLM-based intent detection)")

    # Router → Conditional routing (ORIGINAL - restored from HEAD)
    # NOTE: Citation routing is handled by should_route based on citation_context
    builder.add_conditional_edges(
        "route_query",
        should_route,
        {
            "navigation_action": "handle_navigation_action",  # INSTANT: Map navigation
            "citation_query": "handle_citation_query",  # ULTRA-FAST: Citation click query
            "direct_document": "fetch_direct_chunks",
            "simple_search": "query_vector_documents",  # Skip expand/clarify
            "complex_search": "rewrite_query"  # Full pipeline
        }
    )
    logger.debug("Conditional: route_query -> [navigation_action|citation_query|direct_document|simple_search|complex_search]")
    
    # NAVIGATION PATH: handle → format (INSTANT, skips ALL retrieval - just emits agent actions)
    builder.add_edge("handle_navigation_action", "format_response")
    logger.debug("Edge: handle_navigation_action -> format_response (INSTANT)")
    
    # ATTACHMENT FAST PATH: handle → format (ULTRA-FAST ~2s, skips ALL retrieval + processing)
    builder.add_edge("handle_attachment_fast", "format_response")
    logger.debug("Edge: handle_attachment_fast -> format_response (ULTRA-FAST)")
    
    # CITATION PATH: handle → format (ULTRA-FAST ~2s, skips ALL retrieval + processing)
    builder.add_edge("handle_citation_query", "format_response")
    logger.debug("Edge: handle_citation_query -> format_response (ULTRA-FAST)")

    # DIRECT PATH: fetch → process → summarize (FASTEST ~2s)
    builder.add_edge("fetch_direct_chunks", "process_documents")
    logger.debug("Edge: fetch_direct_chunks -> process_documents")

    # SIMPLE PATH: vector → process → summarize (no clarify, ~6s)
    # Note: This edge is conditional below, but we also need direct edge for simple path
    # The conditional will handle routing after query_vector_documents

    # COMPLEX PATH: rewrite → vector → clarify (conditional) → process
    # NOTE: detail_level and query_variations are already set by classify_and_prepare_query!
    # We skip determine_detail_level and expand_query nodes for document searches
    builder.add_edge("rewrite_query", "query_vector_documents")
    logger.debug("Edge: rewrite_query -> query_vector_documents (OPTIMIZED: skips detail_level + expand)")

    # Keep these nodes for backwards compatibility (may be used by other paths)
    # builder.add_edge("determine_detail_level", "expand_query")
    # builder.add_edge("expand_query", "query_vector_documents")

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

    # OPTIMIZATION: Skip format_response (saves ~6.5s) - summary is already well-formatted
    # Go directly to END from summarize_results
    builder.add_edge("summarize_results", END)
    logger.debug("Edge: summarize_results -> END (OPTIMIZED: skipped format_response)")
    
    # NEW: General Query Path: handle_general_query → END (skip format_response)
    builder.add_edge("handle_general_query", END)
    logger.debug("Edge: handle_general_query -> END (OPTIMIZED: skipped format_response)")
    
    # NEW: Text Transformation Path: detect_and_extract_text → transform_text → END
    builder.add_edge("detect_and_extract_text", "transform_text")
    logger.debug("Edge: detect_and_extract_text -> transform_text")
    builder.add_edge("transform_text", END)
    logger.debug("Edge: transform_text -> END (OPTIMIZED: skipped format_response)")
    
    # NEW: Follow-up Query Path: handle_follow_up_query → END (skip format_response)
    builder.add_edge("handle_follow_up_query", END)
    logger.debug("Edge: handle_follow_up_query -> END (OPTIMIZED: skipped format_response)")

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






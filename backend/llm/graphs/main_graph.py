"""
Main LangGraph orchestration for document analysis workflow.
Coordinates vector/SQL retrieval, document processing, and summarisation.

NOW WITH STATE PERSISTENCE via PostgreSQL checkpointer for conversation memory.
"""

from langgraph.graph import StateGraph, START, END
import logging
import os

logger = logging.getLogger(__name__)

# ============================================================================
# LangSmith Tracing Initialization
# ============================================================================
# Map LANGSMITH_* environment variables to LANGCHAIN_* (LangChain standard)
# This allows using either naming convention in .env file
if not os.getenv("LANGCHAIN_TRACING_V2") and os.getenv("LANGSMITH_TRACING"):
    os.environ["LANGCHAIN_TRACING_V2"] = os.getenv("LANGSMITH_TRACING", "false")
    
if not os.getenv("LANGCHAIN_API_KEY") and os.getenv("LANGSMITH_API_KEY"):
    os.environ["LANGCHAIN_API_KEY"] = os.getenv("LANGSMITH_API_KEY", "")
    
if not os.getenv("LANGCHAIN_PROJECT") and os.getenv("LANGSMITH_PROJECT"):
    os.environ["LANGCHAIN_PROJECT"] = os.getenv("LANGSMITH_PROJECT", "")

# Also check for direct LANGCHAIN_* variables (standard naming)
if os.getenv("LANGCHAIN_TRACING_V2", "").lower() == "true":
    project = os.getenv("LANGCHAIN_PROJECT", "default")
    api_key_set = bool(os.getenv("LANGCHAIN_API_KEY"))
    if api_key_set:
        logger.info(f"✅ LangSmith tracing enabled (project: {project})")
    else:
        logger.warning("⚠️ LangSmith tracing enabled but LANGCHAIN_API_KEY not set")
else:
    logger.info("ℹ️ LangSmith tracing disabled (set LANGCHAIN_TRACING_V2=true or LANGSMITH_TRACING=true to enable)")

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
from backend.llm.nodes.routing_nodes import fetch_direct_document_chunks, handle_citation_query, handle_attachment_fast, handle_navigation_action
from backend.llm.nodes.processing_nodes import process_documents
from backend.llm.nodes.summary_nodes import summarize_results
from backend.llm.nodes.formatting_nodes import format_response
# NEW: Unified agent node (replaces query_analysis_node, document_retrieval_node, chunk_retrieval_node, classify_and_prepare_query, check_cached_documents, determine_detail_level)
from backend.llm.nodes.agent_node import agent_node
from backend.llm.nodes.no_results_node import no_results_node
# NEW: Context manager for automatic summarization
from backend.llm.nodes.context_manager_node import context_manager_node
# NEW: Planner → Executor → Responder architecture
from backend.llm.nodes.planner_node import planner_node
from backend.llm.nodes.executor_node import executor_node
from backend.llm.nodes.evaluator_node import evaluator_node
from backend.llm.contracts.node_contracts import RouterContract
from backend.llm.nodes.responder_node import responder_node
# LangGraph prebuilt components
from langgraph.prebuilt import ToolNode
from backend.llm.nodes.tool_execution_node import ExecutionAwareToolNode
from langgraph.types import RetryPolicy
from typing import Literal
from langchain_core.messages import SystemMessage

# NEW: Middleware for context management and retry logic
try:
    from langchain.agents.middleware import (  # type: ignore[import-untyped]
        SummarizationMiddleware,
        ToolRetryMiddleware
    )
    MIDDLEWARE_AVAILABLE = True
    logger.info("✅ LangChain middleware available")
except ImportError as e:
    MIDDLEWARE_AVAILABLE = False
    SummarizationMiddleware = None
    ToolRetryMiddleware = None
    logger.warning(f"⚠️ LangChain middleware not available: {e}")

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
            raw_checkpointer = await AsyncPostgresSaver.from_conn_string(
                db_url,
                prepare_threshold=0,  # Directly disable prepared statements
                autocommit=True
            )
            # Wrap checkpointer to filter out execution_events before serialization
            from backend.llm.utils.checkpointer_wrapper import FilteredCheckpointSaver
            checkpointer = FilteredCheckpointSaver(raw_checkpointer)
            logger.info("✅ Checkpointer created using from_conn_string (prepared statements disabled, execution_events filtered)")
            pool = None  # Not needed for from_conn_string path
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
            
            # Create checkpointer instance for this event loop (pool path only)
            raw_checkpointer = AsyncPostgresSaver(pool)
            
            # Store pool reference in checkpointer for cleanup
            # This allows us to close the pool properly when the event loop shuts down
            raw_checkpointer._pool = pool
            
            # Wrap checkpointer to filter out execution_events before serialization
            from backend.llm.utils.checkpointer_wrapper import FilteredCheckpointSaver
            checkpointer = FilteredCheckpointSaver(raw_checkpointer)
            logger.info("✅ Wrapped checkpointer to exclude execution_events from serialization")
        
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

def create_middleware_config() -> list:
    """
    Create middleware configuration for the agent.
    Returns list of middleware instances or empty list if unavailable.
    
    Middleware includes:
    1. SummarizationMiddleware - Automatically summarizes old messages when token count exceeds 8k
    2. ToolRetryMiddleware - Automatically retries failed tool calls with exponential backoff
    """
    if not MIDDLEWARE_AVAILABLE:
        logger.warning("Middleware not available - returning empty list")
        return []
    
    middleware = []
    
    # 1. Summarization Middleware (prevent token overflow)
    try:
        from backend.llm.prompts.graph import get_middleware_summary_prompt

        summarization = SummarizationMiddleware(
            model="gpt-4o-mini",  # Cheap model for summaries
            trigger=("tokens", 8000),  # FIXED: Use tuple not dict
            keep=("messages", 6),  # FIXED: Use tuple not dict
            summary_prompt=get_middleware_summary_prompt(),
        )
        middleware.append(summarization)
        logger.info("✅ Added SummarizationMiddleware (trigger: 8k tokens, keep: 6 msgs)")
    except Exception as e:
        logger.error(f"❌ Failed to create SummarizationMiddleware: {e}")
    
    # 2. Tool Retry Middleware (auto-retry failures)
    try:
        tool_retry = ToolRetryMiddleware(
            max_retries=2,  # Retry up to 2 times (3 total attempts)
            backoff_factor=1.5,  # FIXED: Use backoff_factor not backoff
            initial_delay=1.0,  # Start with 1s delay
            max_delay=10.0,  # Cap at 10s
            jitter=True  # Add randomness to prevent thundering herd
        )
        middleware.append(tool_retry)
        logger.info("✅ Added ToolRetryMiddleware (max_retries: 2, backoff_factor: 1.5x)")
    except Exception as e:
        logger.error(f"❌ Failed to create ToolRetryMiddleware: {e}")
    
    return middleware

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

    # REMOVED: check_cached_documents, classify_and_prepare_query
    # These nodes pre-processed queries and stole the agent's first thought.
    # Agent now decides its own strategy inline.
    
    # REMOVED: detect_and_extract_text, handle_general_query, transform_text, handle_follow_up_query
    # These specialized handlers are no longer needed - agent handles all query types.
    
    # REMOVED: route_query
    # Routing is now handled by simple_route() which only handles fast paths.
    # Everything else goes directly to agent.

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
    
    # NEW: Context Manager Node (automatic summarization to prevent token overflow)
    builder.add_node("context_manager", context_manager_node)
    logger.info("✅ Added context_manager node (auto-summarize at 8k tokens)")
    
    # NEW: Planner → Executor → Responder architecture
    builder.add_node("planner", planner_node)
    """
    Planner Node
    - Generates structured JSON execution plan from user query
    - Output: execution_plan (structured plan with objective and steps)
    - Emits plan as execution event (visible to user)
    """
    
    builder.add_node("executor", executor_node)
    """
    Executor Node
    - Executes steps from execution plan sequentially
    - Calls tools directly (retrieve_documents, retrieve_chunks)
    - Emits execution events for each step
    - Output: execution_results (results from each step)
    """
    
    builder.add_node("evaluator", evaluator_node)
    """
    Evaluator Node
    - Evaluates plan execution and result sufficiency
    - Routes: executor (continue), planner (refine), or responder (answer)
    - Emits evaluation events
    """
    
    builder.add_node("responder", responder_node)
    """
    Responder Node
    - Generates final answer from execution results
    - Uses conversational answer generation
    - Output: final_summary
    """
    
    # KEEP: Unified Agent Node (fallback for non-planner paths)
    builder.add_node("agent", agent_node)
    """
    Unified Agent Node (Fallback)
    - Handles query analysis (inline)
    - Calls retrieve_documents() and retrieve_chunks() tools autonomously
    - Handles semantic retries (LLM decides when to retry)
    - Generates final answer from chunks
    - Output: messages (for tools_node), retrieved_documents, document_outputs, or final_summary
    """
    
    # Create tools for agent
    from backend.llm.tools.document_retriever_tool import create_document_retrieval_tool
    from backend.llm.tools.chunk_retriever_tool import create_chunk_retrieval_tool
    
    retrieval_tools = [
        create_document_retrieval_tool(),
        create_chunk_retrieval_tool(),
    ]
    
    # Add execution-aware tools node with retry policy for execution failures
    # NEW: ExecutionAwareToolNode wraps ToolNode to emit execution events
    execution_aware_tool_node = ExecutionAwareToolNode(tools=retrieval_tools)
    builder.add_node(
        "tools",
        execution_aware_tool_node,
        retry_policy=RetryPolicy(
            max_attempts=3,
            retry_on=(ConnectionError, TimeoutError, Exception)
        )
    )
    """
    Tools Node
    - Executes tool calls from agent (retrieve_documents, retrieve_chunks)
    - Handles execution failures (timeouts, DB errors) via RetryPolicy
    - Returns ToolMessages to agent for processing
    - Does NOT handle semantic retries (that's agent's job)
    """
    
    builder.add_node("no_results_node", no_results_node)
    """
    NEW: No Results Node (Shared Failure Handler)
    - Generates helpful failure messages when retries are exhausted
    - Explains what was searched, suggests rephrasing
    - Output: final_summary with helpful failure message
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
    # REMOVED: rewrite_query, expand_query, query_vector_documents, clarify_relevant_docs
    # These are replaced by agent tools in summarize_results node (retrieve_documents + retrieve_chunks)

    # REMOVED: determine_detail_level
    # Agent decides detail level based on query context.

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
    # REMOVED: should_route() and should_use_cached_documents()
    # These old routing functions are replaced by simple_route() which handles fast paths only.
    # Everything else goes directly to the agent.

    # BUILD GRAPH EDGES - SIMPLIFIED ROUTING
    # START → simple router (only handles fast paths, everything else → context_manager → agent)
    def simple_route(state: MainWorkflowState) -> Literal["handle_navigation_action", "handle_citation_query", "handle_attachment_fast", "context_manager"]:
        """
        Simplified routing from START.
        
        Fast paths (skip main agent):
        - Navigation actions
        - Citation queries
        - Attachment fast mode
        
        Everything else (including chip/@ document or property selection) → context_manager → planner → executor → responder,
        so response formatting is the same whether or not the user used @.
        """
        # Check for fast paths
        query_type = state.get("query_type")
        citation_context = state.get("citation_context")
        attached_document = state.get("attached_document")
        fast_mode = state.get("fast_mode", False)
        document_ids = state.get("document_ids")
        
        # Navigation action
        if query_type == "navigation_action":
            logger.info("[GRAPH] Fast path: navigation_action")
            return "handle_navigation_action"
        
        # Citation query (citation click)
        if citation_context or query_type == "citation_query":
            logger.info("[GRAPH] Fast path: citation_query")
            return "citation_query"
        
        # Attachment fast mode
        if attached_document and fast_mode:
            logger.info("[GRAPH] Fast path: attachment_fast")
            return "handle_attachment_fast"
        
        # Chip selection (@ property/document): use same route as regular queries so response formatting
        # is identical (planner → executor → responder). Planner already creates 1-step retrieve_chunks
        # when document_ids are in state, so we do not use fetch_direct_chunks → summarize_results here.
        # Everything (including when document_ids present) → context_manager → planner → executor → responder
        logger.info("[GRAPH] Routing to context_manager (check tokens before agent)%s", f" (doc_ids={len(document_ids)})" if document_ids and len(document_ids) > 0 else "")
        return "context_manager"
    
    builder.add_conditional_edges(
        START,
        simple_route,
        {
            "navigation_action": "handle_navigation_action",
            "citation_query": "handle_citation_query",
            "handle_attachment_fast": "handle_attachment_fast",
            "fetch_direct_chunks": "fetch_direct_chunks",
            "context_manager": "context_manager"
        }
    )
    logger.debug("START -> [navigation_action|citation_query|attachment_fast|direct_chunks|context_manager]")
    
    # Context manager → planner (NEW: Planner → Executor → Responder architecture)
    # OLD: builder.add_edge("context_manager", "agent") - replaced with planner flow
    builder.add_edge("context_manager", "planner")
    logger.debug("Edge: context_manager -> planner (after token check/summarization)")
    
    # NAVIGATION PATH: handle → format (INSTANT, skips ALL retrieval - just emits agent actions)
    builder.add_edge("handle_navigation_action", "format_response")
    logger.debug("Edge: handle_navigation_action -> format_response (INSTANT)")
    
    # Chip-query paths go directly to END so response formatting matches main path (summarize_results → END).
    # Skipping format_response keeps the same response text structure as normal (no extra LLM formatting pass).
    builder.add_edge("handle_attachment_fast", END)
    logger.debug("Edge: handle_attachment_fast -> END (same formatting as normal response)")
    
    builder.add_edge("handle_citation_query", END)
    logger.debug("Edge: handle_citation_query -> END (same formatting as normal response)")

    # DIRECT PATH: fetch → process → summarize (FASTEST ~2s)
    builder.add_edge("fetch_direct_chunks", "process_documents")
    logger.debug("Edge: fetch_direct_chunks -> process_documents")

    # Helper node to extract final answer from messages for API response
    def extract_final_answer(state: MainWorkflowState) -> MainWorkflowState:
        """
        Extract final answer from agent's last message.
        
        This is NOT manual extraction of tool results - it's just formatting
        the final output for the API response.
        """
        messages = state.get("messages", [])
        
        if messages:
            last_message = messages[-1]
            if hasattr(last_message, 'content') and last_message.content:
                logger.info(f"[EXTRACT_FINAL] Extracted final answer ({len(last_message.content)} chars)")
                return {"final_summary": last_message.content}
        
        logger.warning("[EXTRACT_FINAL] No final answer found in messages")
        return {"final_summary": "I apologize, but I couldn't generate a response."}
    
    builder.add_node("extract_final_answer", extract_final_answer)

    # Helper functions for Phase 2: Chunk presence detection
    def check_chunks_retrieved(messages: list) -> bool:
        """
        Check if retrieve_chunks was called and returned content.
        
        Returns True if chunks were retrieved with actual content, False otherwise.
        """
        for msg in messages:
            # Check if this is a ToolMessage from retrieve_chunks
            if hasattr(msg, 'type') and msg.type == 'tool':
                if hasattr(msg, 'name') and msg.name == 'retrieve_chunks':
                    # Check if content is non-empty
                    if msg.content:
                        try:
                            import json
                            # Parse content (could be string or already parsed)
                            content = json.loads(msg.content) if isinstance(msg.content, str) else msg.content
                            # Check if it's a list with items
                            if isinstance(content, list) and len(content) > 0:
                                # Verify it has actual chunk data (not just empty dicts)
                                if any(chunk.get('chunk_text') or chunk.get('chunk_text_clean') for chunk in content if isinstance(chunk, dict)):
                                    logger.debug("[GRAPH] ✅ Chunks detected in message history")
                                    return True
                        except (json.JSONDecodeError, AttributeError, TypeError) as e:
                            logger.debug(f"[GRAPH] Error parsing chunk content: {e}")
                            # If parsing fails but content exists, assume chunks are present
                            if msg.content and len(str(msg.content)) > 10:
                                return True
        logger.debug("[GRAPH] ❌ No chunks detected in message history")
        return False

    def check_documents_retrieved(messages: list) -> bool:
        """
        Check if retrieve_documents was called and returned results.
        
        Returns True if documents were found, False otherwise.
        """
        for msg in messages:
            # Check if this is a ToolMessage from retrieve_documents
            if hasattr(msg, 'type') and msg.type == 'tool':
                if hasattr(msg, 'name') and msg.name == 'retrieve_documents':
                    # Check if content is non-empty
                    if msg.content:
                        try:
                            import json
                            # Parse content (could be string or already parsed)
                            content = json.loads(msg.content) if isinstance(msg.content, str) else msg.content
                            # Check if it's a list with items
                            if isinstance(content, list) and len(content) > 0:
                                logger.debug(f"[GRAPH] ✅ Documents detected in message history ({len(content)} documents)")
                                return True
                        except (json.JSONDecodeError, AttributeError, TypeError) as e:
                            logger.debug(f"[GRAPH] Error parsing document content: {e}")
                            # If parsing fails but content exists, assume documents are present
                            if msg.content and len(str(msg.content)) > 10:
                                return True
        logger.debug("[GRAPH] ❌ No documents detected in message history")
        return False

    def force_chunk_retrieval_node(state: MainWorkflowState):
        """
        Inject a system message forcing the agent to retrieve chunks.
        
        This is called when documents were found but no chunks retrieved.
        The system message will force the agent to call retrieve_chunks before answering.
        """
        messages = state.get("messages", [])
        
        # Find the last document retrieval to get document IDs
        document_ids = []
        for msg in reversed(messages):
            if hasattr(msg, 'type') and msg.type == 'tool':
                if hasattr(msg, 'name') and msg.name == 'retrieve_documents':
                    try:
                        import json
                        content = json.loads(msg.content) if isinstance(msg.content, str) else msg.content
                        if isinstance(content, list):
                            document_ids = [doc.get('document_id') for doc in content if doc.get('document_id')]
                            if document_ids:
                                break
                    except (json.JSONDecodeError, AttributeError, TypeError):
                        pass
        
        from backend.llm.prompts.graph import (
            get_force_chunk_message_with_doc_ids,
            get_force_chunk_message_fallback,
        )

        # Create system message forcing chunk retrieval
        if document_ids:
            force_message = SystemMessage(
                content=get_force_chunk_message_with_doc_ids(document_ids)
            )
        else:
            force_message = SystemMessage(content=get_force_chunk_message_fallback())
        
        logger.warning(f"[GRAPH] ⚠️ FORCING chunk retrieval - {len(document_ids)} documents found but no chunks retrieved")
        
        return {"messages": [force_message]}
    
    # NEW: Agent-driven retrieval path (SIMPLIFIED)
    # Agent → tools → agent (loop) → extract_final_answer → END
    def should_continue(state: MainWorkflowState) -> Literal["tools", "force_chunks", "extract_final_answer"]:
        """
        Determine next step after agent node.
        
        ENHANCED ROUTING (Phase 2):
        - If agent made tool calls → execute them
        - If NO tool calls AND documents found BUT no chunks → force chunk retrieval
        - Else → extract final answer from messages
        
        This ensures chunks are ALWAYS retrieved before answering document questions.
        """
        messages = state.get("messages", [])
        
        if not messages:
            logger.warning("[GRAPH] No messages in state, routing to extract_final_answer")
            return "extract_final_answer"
        
        # Check last message for tool calls
        last_message = messages[-1]
        if hasattr(last_message, 'tool_calls') and last_message.tool_calls:
            logger.debug(f"[GRAPH] Agent made {len(last_message.tool_calls)} tool call(s), routing to tools")
            return "tools"
        
        # No tool calls - check if chunks were retrieved
        has_documents = check_documents_retrieved(messages)
        has_chunks = check_chunks_retrieved(messages)
        
        # Add debug logging
        logger.info(f"[GRAPH] should_continue check: has_documents={has_documents}, has_chunks={has_chunks}")
        
        # If documents found but no chunks → FORCE chunk retrieval
        if has_documents and not has_chunks:
            logger.warning("[GRAPH] ⚠️ Documents retrieved but NO chunks - routing to force_chunks")
            return "force_chunks"
        
        # Chunks exist or no documents needed - allow final answer
        if has_chunks:
            logger.info("[GRAPH] ✅ Chunks detected - allowing final answer extraction")
        logger.debug("[GRAPH] Agent finished (no tool calls), routing to extract_final_answer")
        return "extract_final_answer"
    
    builder.add_conditional_edges(
        "agent",
        should_continue,
        {
            "tools": "tools",
            "force_chunks": "force_chunks",  # ← NEW: Force chunk retrieval path
            "extract_final_answer": "extract_final_answer"
        }
    )
    logger.debug("Conditional: agent -> [tools|force_chunks|extract_final_answer]")

    # Add force_chunks node
    builder.add_node("force_chunks", force_chunk_retrieval_node)
    logger.debug("Node: force_chunks (forces chunk retrieval)")
    
    # Force_chunks always routes back to agent (so agent can call retrieve_chunks)
    builder.add_edge("force_chunks", "agent")
    logger.debug("Edge: force_chunks -> agent (loop back for chunk retrieval)")
    
    # NEW: Planner → Executor → Evaluator → Responder flow
    # Context manager → Planner (start planning flow)
    builder.add_edge("context_manager", "planner")
    logger.debug("Edge: context_manager -> planner")
    
    # Planner → Executor or Responder (0 steps = skip executor, go straight to responder for refine/format)
    def after_planner(state: MainWorkflowState) -> Literal["executor", "responder"]:
        steps = state.get("execution_plan") or {}
        step_list = steps.get("steps", []) if isinstance(steps, dict) else []
        if len(step_list) == 0:
            logger.info("[GRAPH] 0-step plan: routing planner → responder (refine/format)")
            return "responder"
        logger.debug(f"[GRAPH] {len(step_list)}-step plan: routing planner → executor")
        return "executor"
    
    builder.add_conditional_edges("planner", after_planner, {"executor": "executor", "responder": "responder"})
    logger.debug("Conditional: planner -> [executor|responder] (0 steps → responder)")
    
    # Executor → Evaluator (evaluate execution)
    builder.add_edge("executor", "evaluator")
    logger.debug("Edge: executor -> evaluator")
    
    # Evaluator → Routes based on execution status
    # CENTRALIZED ROUTER - Single owner of flow control
    def centralized_router(state: MainWorkflowState) -> Literal["executor", "planner", "responder", "END"]:
        """
        CENTRALIZED ROUTER - Single owner of "what happens next".
        
        This is the ONLY place that decides flow control.
        Nodes never decide routing - they only emit events.
        
        Uses RouterContract.route() for all routing decisions.
        """
        decision = RouterContract.route(state)
        logger.info(f"[ROUTER] Decision: {decision['next_node']} - {decision['reason']}")
        return decision["next_node"]
    
    builder.add_conditional_edges(
        "evaluator",
        centralized_router,  # ← Single source of truth
        {
            "executor": "executor",  # Continue executing steps
            "planner": "planner",  # Refine plan (if results insufficient)
            "responder": "responder",  # Generate answer
            "END": END  # Error state
        }
    )
    logger.debug("Conditional: evaluator -> [executor|planner|responder|END] (centralized router)")
    
    # Responder → END
    builder.add_edge("responder", END)
    logger.debug("Edge: responder -> END")
    
    # KEEP: Tools → Agent (loop back) for fallback agent path
    builder.add_edge("tools", "agent")
    logger.debug("Edge: tools -> agent (loop back)")
    
    # KEEP: Extract final answer → END (for fallback agent path)
    builder.add_edge("extract_final_answer", END)
    logger.debug("Edge: extract_final_answer -> END")
    
    # Format response → END (for fast paths that go through format_response)
    builder.add_edge("format_response", END)
    logger.debug("Edge: format_response -> END")

    # ALL PATHS CONVERGE HERE
    builder.add_edge("process_documents", "summarize_results")
    logger.debug("Edge: process_documents -> summarize_results")

    # Conditional edge from summarize_results: route to no_results_node if no documents
    def should_route_to_no_results(state: MainWorkflowState) -> Literal["no_results_node", "END"]:
        """Route to no_results_node if final_summary is None (no documents found)."""
        final_summary = state.get("final_summary")
        doc_outputs = state.get("document_outputs", []) or []
        
        if final_summary is None or (not doc_outputs and final_summary is None):
            logger.debug("[GRAPH] summarize_results returned None - routing to no_results_node")
            return "no_results_node"
        else:
            logger.debug(f"[GRAPH] summarize_results has summary ({len(final_summary) if final_summary else 0} chars) - routing to END")
            return "END"
    
    builder.add_conditional_edges(
        "summarize_results",
        should_route_to_no_results,
        {
            "no_results_node": "no_results_node",  # No documents - go to failure handler
            "END": END  # Success - end graph
        }
    )
    logger.debug("Conditional: summarize_results -> [no_results_node|END]")
    
    # REMOVED: Edges for removed nodes (handle_general_query, detect_and_extract_text, transform_text, handle_follow_up_query)

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

        # NEW: Create middleware config
        middleware = create_middleware_config()
        
        if middleware:
            logger.info(f"📦 Compiling graph with checkpointer + {len(middleware)} middleware")
            
            # Check if StateGraph.compile() accepts middleware parameter
            import inspect
            compile_sig = inspect.signature(builder.compile)
            
            if 'middleware' in compile_sig.parameters:
                # Direct middleware support
                main_graph = builder.compile(
                    checkpointer=checkpointer,
                    middleware=middleware
                )
                logger.info("✅ Graph compiled with checkpointer + middleware (direct)")
            else:
                # Fallback: compile without middleware parameter
                # NOTE: LangGraph's StateGraph may not directly support middleware in compile()
                # Middleware is typically applied through create_agent() wrapper
                logger.warning("⚠️ StateGraph.compile() doesn't accept middleware parameter")
                logger.warning("   Compiling with checkpointer only - middleware will not be active")
                logger.warning("   Consider using create_agent() wrapper for full middleware support")
                main_graph = builder.compile(checkpointer=checkpointer)
        else:
            logger.info("📦 Compiling graph with checkpointer only (no middleware)")
        main_graph = builder.compile(checkpointer=checkpointer)

        logger.info("Graph compiled successfully")
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






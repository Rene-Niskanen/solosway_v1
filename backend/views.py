from flask import Blueprint, render_template, request, flash, redirect, url_for, jsonify, current_app, Response
from flask_login import login_required, current_user, login_user, logout_user
from .models import Document, DocumentStatus, Property, DocumentRelationship, User, UserRole, UserStatus, PropertyCardCache, db
from .services.property_enrichment_service import PropertyEnrichmentService
from .services.supabase_document_service import SupabaseDocumentService
from .services.supabase_client_factory import get_supabase_client
from datetime import datetime
import os
import uuid
import requests
from requests_aws4auth import AWS4Auth
from werkzeug.utils import secure_filename
import sys
import logging
import boto3
import time
import re
from .tasks import process_document_task, process_document_fast_task
# NOTE: DeletionService is deprecated - use UnifiedDeletionService instead
# from .services.deletion_service import DeletionService
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, ProgrammingError, DatabaseError
import json
from uuid import UUID
def _ensure_business_uuid():
    """Ensure the current user has a business UUID and return it as a string."""
    existing = getattr(current_user, "business_id", None)
    if existing:
        try:
            # Handle legacy string IDs like "SoloSway" by validating
            normalized = UUID(str(existing))
            return str(normalized)
        except ValueError:
            pass  # Fall through to Supabase lookup and normalization

    company_name = getattr(current_user, "company_name", None)
    if not company_name:
        return None

    try:
        from .services.supabase_auth_service import SupabaseAuthService

        auth_service = SupabaseAuthService()
        business_uuid = auth_service.ensure_business_uuid(company_name)
        if business_uuid:
            try:
                # Persist UUID to the local user record for future requests
                current_user.business_id = UUID(str(business_uuid))
                db.session.commit()
            except Exception as commit_error:
                db.session.rollback()
                logger.warning(f"Failed to persist business UUID locally: {commit_error}")
            return str(business_uuid)
    except Exception as fetch_error:
        logger.warning(f"Failed to ensure business UUID: {fetch_error}")
    return None


def _normalize_uuid_str(value):
    """Convert various UUID-like inputs to a canonical string form."""
    if not value:
        return None
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError):
        return None


# DEPRECATED: This function has been moved to UnifiedDeletionService._cleanup_orphan_properties()
# Kept here for reference during migration. Can be removed after testing.
# def _cleanup_orphan_supabase_properties(property_ids: set[str] | set) -> list[str]:
#     """
#     Remove Supabase property hub records when no documents remain linked to a property.
#     Returns list of property IDs that were fully removed from Supabase.
#     
#     NOTE: This functionality is now handled by UnifiedDeletionService._cleanup_orphan_properties()
#     """
#     pass

views = Blueprint('views', __name__)

# Set up logging
logger = logging.getLogger(__name__)

# ============================================================================
# HEALTH & STATUS ENDPOINTS
# ============================================================================


@views.route('/api/health', methods=['GET'])
def health_check():
    """Basic health check endpoint"""
    try:
        from .services.health_check_service import health_checker
        from .services.response_formatter import APIResponseFormatter
        
        # Get quick health status
        health_data = health_checker.get_quick_health()
        
        return jsonify(APIResponseFormatter.format_health_response(
            health_data['status'],
            {'basic': health_data}
        )), 200
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return jsonify({
            'status': 'unhealthy',
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }), 503

@views.route('/api/health/detailed', methods=['GET'])
def detailed_health_check():
    """Detailed system health check"""
    try:
        from .services.health_check_service import health_checker
        from .services.response_formatter import APIResponseFormatter
        
        # Get comprehensive health status
        health_data = health_checker.get_comprehensive_health()
        
        return jsonify(APIResponseFormatter.format_health_response(
            health_data['status'],
            health_data['checks'],
            health_data
        )), 200 if health_data['status'] == 'healthy' else 503
        
    except Exception as e:
        logger.error(f"Detailed health check failed: {e}")
        return jsonify({
            'status': 'unhealthy',
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }), 503

@views.route('/api/performance', methods=['GET'])
@login_required
def get_performance_metrics():
    """Get system performance metrics"""
    try:
        from .services.performance_service import performance_service
        from .services.response_formatter import APIResponseFormatter
        
        # Get performance summary
        performance_data = performance_service.get_performance_summary()
        
        # Get slow endpoints
        slow_endpoints = performance_service.get_slow_endpoints(limit=10)
        
        return jsonify(APIResponseFormatter.format_success_response(
            {
                'performance_summary': performance_data,
                'slow_endpoints': slow_endpoints
            },
            'Performance metrics retrieved successfully'
        )), 200
        
    except Exception as e:
        logger.error(f"Error getting performance metrics: {e}")
        return jsonify(APIResponseFormatter.format_error_response(
            str(e),
            'PERFORMANCE_ERROR',
            500
        )), 500

# ============================================================================
# AI & LLM ENDPOINTS
# ============================================================================

@views.route('/api/llm/analyze-query', methods=['POST'])
@login_required
def analyze_query():
    """Analyze user query for intent and criteria extraction"""
    data = request.get_json()
    query = data.get('query', '')
    message_history = data.get('messageHistory', [])
    
    try:
        from .services.llm_service import LLMService
        llm = LLMService()
        result = llm.analyze_query(query, message_history)
        
        return jsonify({
            'success': True,
            'data': json.loads(result)
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/llm/chat', methods=['POST'])
@login_required
def chat_completion():
    """Generate AI chat response"""
    data = request.get_json()
    messages = data.get('messages', [])
    
    try:
        from .services.llm_service import LLMService
        llm = LLMService()
        result = llm.chat_completion(messages)
        
        return jsonify({
            'success': True,
            'data': result
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Add after_request handler for this blueprint to ensure CORS headers on all responses
@views.after_request
def add_cors_headers(response):
    """Ensure CORS headers are added to all responses from this blueprint"""
    # Only add if not already present (to avoid duplicates)
    if 'Access-Control-Allow-Origin' not in response.headers:
        origin = request.headers.get('Origin', '*')
        response.headers.add('Access-Control-Allow-Origin', origin)
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    return response

@views.route('/api/llm/query/stream', methods=['POST', 'OPTIONS'])
def query_documents_stream():
    """
    Streaming version of query_documents using Server-Sent Events (SSE).
    Streams LLM responses token-by-token in real-time.
    """
    logger.info("🔵 [STREAM] Received request to /api/llm/query/stream")
    # Handle CORS preflight - MUST be first, before any other code
    if request.method == 'OPTIONS':
        try:
            response = jsonify({})
            response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
            response.headers.add('Access-Control-Max-Age', '3600')
            return response, 200
        except Exception as e:
            # Even if there's an error, return a valid OPTIONS response
            logger.error(f"Error in OPTIONS handler: {e}")
            response = jsonify({})
            response.headers.add('Access-Control-Allow-Origin', '*')
            response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
            response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            return response, 200
    
    # Require login - only check after OPTIONS is handled
    try:
        if not current_user.is_authenticated:
            response = jsonify({
                'success': False,
                'error': 'Authentication required'
            })
            response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
            return response, 401
    except (AttributeError, RuntimeError):
        # current_user not available or not in request context
        response = jsonify({
            'success': False,
            'error': 'Authentication required'
        })
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response, 401
    
    # Wrap everything in try-except to ensure CORS headers are always set
    try:
        logger.info("🔵 [STREAM] Starting request processing")
        from flask import Response, stream_with_context
        import json
        import asyncio
        import time
        from langchain_openai import ChatOpenAI
        from backend.llm.config import config
        
        # Check API key configuration
        logger.info(f"🔑 [STREAM] OpenAI API Key check: {'✅ Set' if config.openai_api_key else '❌ Missing'}")
        logger.info(f"🔑 [STREAM] OpenAI Model: {config.openai_model}")
        if not config.openai_api_key:
            logger.error("❌ [STREAM] OpenAI API key is not configured!")
        
        data = request.get_json()
        if data is None:
            response = jsonify({
                'success': False,
                'error': 'Invalid or missing JSON in request body'
            })
            response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
            return response, 400
        
        query = data.get('query', '')
        property_id = data.get('propertyId')
        message_history = data.get('messageHistory', [])
        session_id = data.get('sessionId', f"session_{request.remote_addr}_{int(time.time())}")
        
        logger.info(f"🔵 [STREAM] Query: '{query[:50]}...', Property ID: {property_id}, Session: {session_id}")
        
        if not query:
            response = jsonify({
                'success': False,
                'error': 'Query is required'
            })
            response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            return response, 400
        
        def generate_stream():
            """Generator function for SSE streaming"""
            logger.info("🟢 [STREAM] generate_stream() called")
            # Always yield at least one chunk to ensure Response object is created
            # This prevents Flask from returning an error response without CORS headers
            try:
                logger.info("🟢 [STREAM] Getting business_id...")
                # Get business_id
                business_id = _ensure_business_uuid()
                logger.info(f"🟢 [STREAM] Business ID: {business_id}")
                if not business_id:
                    logger.error("❌ [STREAM] No business_id found")
                    yield f"data: {json.dumps({'type': 'error', 'message': 'User not associated with a business'})}\n\n"
                    return
            except Exception as early_error:
                # If error occurs before first yield, yield error immediately
                logger.error(f"❌ [STREAM] Early error in generate_stream: {early_error}")
                import traceback
                logger.error(f"❌ [STREAM] Traceback: {traceback.format_exc()}")
                traceback.print_exc()
                yield f"data: {json.dumps({'type': 'error', 'message': str(early_error)})}\n\n"
                return
            
            try:
                logger.info("🟢 [STREAM] Building initial state...")
                # Get document_id from property_id if provided
                document_id = None
                if property_id:
                    try:
                        logger.info(f"🟢 [STREAM] Looking for document for property {property_id}")
                        supabase = get_supabase_client()
                        result = supabase.table('document_relationships')\
                            .select('document_id')\
                            .eq('property_id', property_id)\
                            .limit(1)\
                            .execute()
                        if result.data and len(result.data) > 0:
                            document_id = result.data[0]['document_id']
                            logger.info(f"🟢 [STREAM] Found document_id: {document_id}")
                    except Exception as e:
                        logger.warning(f"⚠️ [STREAM] Could not find document for property {property_id}: {e}")
                
                # Build initial state for LangGraph
                # Note: conversation_history will be loaded from checkpoint if thread_id exists
                # Only provide minimal required fields - checkpointing will restore previous state
                initial_state = {
                    "user_query": query,
                    "user_id": str(current_user.id) if current_user.is_authenticated else "anonymous",
                    "business_id": business_id,
                    "session_id": session_id,
                    "property_id": property_id
                }
                logger.info(f"🟢 [STREAM] Initial state built: query='{query[:30]}...', business_id={business_id}")
                
                # Send initial status and FIRST reasoning step immediately
                logger.info("🟢 [STREAM] Yielding initial status message")
                yield f"data: {json.dumps({'type': 'status', 'message': 'Searching documents...'})}\n\n"
                
                # Emit initial reasoning step IMMEDIATELY when query is received
                initial_reasoning = {
                    'type': 'reasoning_step',
                    'step': 'initial',
                    'message': 'Starting document search...',
                    'details': {}
                }
                initial_reasoning_json = json.dumps(initial_reasoning)
                yield f"data: {initial_reasoning_json}\n\n"
                logger.info(f"🟡 [REASONING] Emitted initial reasoning step: {initial_reasoning_json}")
                
                async def run_and_stream():
                    """Run LangGraph and stream the final summary with reasoning steps"""
                    try:
                        logger.info("🟡 [STREAM] run_and_stream() async function started")
                        
                        # Create checkpointer for THIS event loop (the one in the thread)
                        # This avoids "bound to different event loop" errors
                        from backend.llm.graphs.main_graph import build_main_graph, create_checkpointer_for_current_loop
                        
                        checkpointer = None
                        try:
                            logger.info("🟡 [STREAM] Creating checkpointer for current event loop...")
                            checkpointer = await create_checkpointer_for_current_loop()
                        except Exception as checkpointer_error:
                            error_msg = str(checkpointer_error)
                            # Handle connection timeout errors gracefully
                            if "couldn't get a connection" in error_msg.lower() or "timeout" in error_msg.lower():
                                logger.warning(f"🟡 [STREAM] Connection pool timeout creating checkpointer: {checkpointer_error}")
                                logger.info("🟡 [STREAM] Falling back to stateless mode (no conversation memory)")
                                checkpointer = None
                            else:
                                # Re-raise unexpected errors
                                raise
                        
                        if checkpointer:
                            # Build graph with checkpointer for this event loop
                            # All checkpointers point to same database, so state is shared via thread_id
                            logger.info("🟡 [STREAM] Building graph with checkpointer for this event loop")
                            graph, _ = await build_main_graph(use_checkpointer=True, checkpointer_instance=checkpointer)
                        else:
                            logger.warning("🟡 [STREAM] Using stateless mode (no checkpointer)")
                            graph, _ = await build_main_graph(use_checkpointer=False)
                        
                        config_dict = {"configurable": {"thread_id": session_id}}
                        
                        # Use astream_events to capture node execution and emit reasoning steps
                        logger.info("🟡 [STREAM] Starting graph execution with event streaming...")
                        
                        # Track which nodes have been processed to avoid duplicate reasoning steps
                        processed_nodes = set()
                        
                        # Node name to user-friendly message mapping
                        node_messages = {
                            'rewrite_query': {
                                'message': 'Analyzing query and conversation context...',
                                'details': {}
                            },
                            'expand_query': {
                                'message': 'Generating query variations for better search...',
                                'details': {}
                            },
                            'query_vector_documents': {
                                'message': 'Searching documents...',
                                'details': {}
                            },
                            'clarify_relevant_docs': {
                                'message': 'Ranking and organizing results...',
                                'details': {}
                            },
                            'process_documents': {
                                'message': 'Analyzing document content...',
                                'details': {}
                            },
                            'summarize_results': {
                                'message': 'Synthesizing findings...',
                                'details': {}
                            }
                        }
                        
                        # Stream events from graph execution and track state
                        # IMPORTANT: astream_events executes the graph and emits events as nodes run
                        # We MUST emit reasoning steps immediately when nodes start
                        logger.info("🟡 [REASONING] Starting to stream events and emit reasoning steps...")
                        final_result = None
                        
                        # Execute graph with error handling for connection timeouts during execution
                        try:
                            event_stream = graph.astream_events(initial_state, config_dict, version="v2")
                            async for event in event_stream:
                                event_type = event.get('event')
                                node_name = event.get("name", "")
                                
                                # Capture node start events for reasoning steps - EMIT IMMEDIATELY
                                if event_type == "on_chain_start":
                                    if node_name in node_messages and node_name not in processed_nodes:
                                        processed_nodes.add(node_name)
                                        reasoning_data = {
                                            'type': 'reasoning_step',
                                            'step': node_name,
                                            'message': node_messages[node_name]['message'],
                                            'details': node_messages[node_name]['details']
                                        }
                                        reasoning_json = json.dumps(reasoning_data)
                                        yield f"data: {reasoning_json}\n\n"
                                        logger.info(f"🟡 [REASONING] ✅ Emitted step: {node_name} - {node_messages[node_name]['message']}")
                                        logger.debug(f"🟡 [REASONING] JSON: {reasoning_json}")
                                
                                # Capture node end events to update details and track state
                                elif event.get("event") == "on_chain_end":
                                    node_name = event.get("name", "")
                                    
                                    # Try to extract state from the event
                                    event_data = event.get("data", {})
                                    state_update = event_data.get("data", {})  # Full state update
                                    output = event_data.get("output", {})  # Node output only
                                    
                                    # Update details based on node output
                                    if node_name == "query_vector_documents":
                                        state_data = state_update if state_update else output
                                        doc_count = len(state_data.get("relevant_documents", []))
                                        if doc_count > 0:
                                            reasoning_data = {
                                                'type': 'reasoning_step',
                                                'step': node_name,
                                                'message': f'Found {doc_count} relevant document(s)',
                                                'details': {'documents_found': doc_count}
                                            }
                                            yield f"data: {json.dumps(reasoning_data)}\n\n"
                                    
                                    elif node_name == "process_documents":
                                        state_data = state_update if state_update else output
                                        doc_outputs_count = len(state_data.get("document_outputs", []))
                                        if doc_outputs_count > 0:
                                            reasoning_data = {
                                                'type': 'reasoning_step',
                                                'step': node_name,
                                                'message': f'Processed {doc_outputs_count} document(s)',
                                                'details': {'documents_processed': doc_outputs_count}
                                            }
                                            yield f"data: {json.dumps(reasoning_data)}\n\n"
                                    
                                    # Store the state from the last event (should be final state after summarize_results)
                                    if state_update:
                                        final_result = state_update
                        except Exception as exec_error:
                            error_msg = str(exec_error)
                            # Handle connection timeout errors during graph execution
                            if "couldn't get a connection" in error_msg.lower() or "timeout" in error_msg.lower():
                                logger.warning(f"🟡 [STREAM] Connection timeout during graph execution: {exec_error}")
                                logger.info("🟡 [STREAM] Retrying without checkpointer (stateless mode)")
                                # Retry without checkpointer
                                graph, _ = await build_main_graph(use_checkpointer=False)
                                config_dict = {}  # No thread_id needed for stateless mode
                                event_stream = graph.astream_events(initial_state, config_dict, version="v2")
                                async for event in event_stream:
                                    event_type = event.get('event')
                                    node_name = event.get("name", "")
                                    
                                    # Capture node start events for reasoning steps - EMIT IMMEDIATELY
                                    if event_type == "on_chain_start":
                                        if node_name in node_messages and node_name not in processed_nodes:
                                            processed_nodes.add(node_name)
                                            reasoning_data = {
                                                'type': 'reasoning_step',
                                                'step': node_name,
                                                'message': node_messages[node_name]['message'],
                                                'details': node_messages[node_name]['details']
                                            }
                                            reasoning_json = json.dumps(reasoning_data)
                                            yield f"data: {reasoning_json}\n\n"
                                    
                                    # Capture node end events to track state
                                    elif event.get("event") == "on_chain_end":
                                        node_name = event.get("name", "")
                                        event_data = event.get("data", {})
                                        state_update = event_data.get("data", {})
                                        
                                        if node_name == "query_vector_documents":
                                            state_data = state_update if state_update else event_data.get("output", {})
                                            doc_count = len(state_data.get("relevant_documents", []))
                                            if doc_count > 0:
                                                reasoning_data = {
                                                    'type': 'reasoning_step',
                                                    'step': node_name,
                                                    'message': f'Found {doc_count} relevant document(s)',
                                                    'details': {'documents_found': doc_count}
                                                }
                                                yield f"data: {json.dumps(reasoning_data)}\n\n"
                                        
                                        elif node_name == "process_documents":
                                            state_data = state_update if state_update else event_data.get("output", {})
                                            doc_outputs_count = len(state_data.get("document_outputs", []))
                                            if doc_outputs_count > 0:
                                                reasoning_data = {
                                                    'type': 'reasoning_step',
                                                    'step': node_name,
                                                    'message': f'Processed {doc_outputs_count} document(s)',
                                                    'details': {'documents_processed': doc_outputs_count}
                                                }
                                                yield f"data: {json.dumps(reasoning_data)}\n\n"
                                        
                                        # Store the state from the last event
                                        if state_update:
                                            final_result = state_update
                            else:
                                # Re-raise unexpected errors
                                raise
                        
                        # After astream_events completes, the graph has finished executing
                        # Get the final state from checkpointer (fast - graph already executed)
                        if final_result is None:
                            logger.warning("🟡 [STREAM] No final state from events, reading from checkpointer...")
                            try:
                                # Read the latest checkpoint which contains the final state
                                from langgraph.checkpoint.base import Checkpoint
                                latest_checkpoint = None
                                async for checkpoint_tuple in checkpointer.alist(config_dict, limit=1):
                                    if isinstance(checkpoint_tuple, tuple):
                                        checkpoint, checkpoint_id = checkpoint_tuple
                                    else:
                                        checkpoint = checkpoint_tuple
                                    
                                    if hasattr(checkpoint, 'channel_values'):
                                        latest_checkpoint = checkpoint.channel_values
                                    elif isinstance(checkpoint, dict):
                                        latest_checkpoint = checkpoint.get('channel_values', checkpoint)
                                    break
                                
                                if latest_checkpoint:
                                    final_result = latest_checkpoint
                                    logger.info("🟡 [STREAM] Retrieved final state from checkpointer")
                                else:
                                    # Fallback: use ainvoke (will be fast since graph already executed)
                                    logger.warning("🟡 [STREAM] No checkpoint found, using ainvoke...")
                                    final_result = await graph.ainvoke(initial_state, config_dict)
                            except Exception as e:
                                logger.warning(f"🟡 [STREAM] Could not read checkpointer: {e}, using ainvoke...")
                                final_result = await graph.ainvoke(initial_state, config_dict)
                        else:
                            logger.info("🟡 [STREAM] Using final state captured from events")
                        
                        # Extract data from final result
                        doc_outputs = final_result.get('document_outputs', []) if final_result else []
                        relevant_docs = final_result.get('relevant_documents', []) if final_result else []
                        
                        logger.info(f"🟡 [STREAM] Final state: {len(doc_outputs)} doc outputs, {len(relevant_docs)} relevant docs")
                        
                        # Send document count
                        yield f"data: {json.dumps({'type': 'documents_found', 'count': len(relevant_docs)})}\n\n"
                        
                        if not doc_outputs:
                            yield f"data: {json.dumps({'type': 'error', 'message': 'No relevant documents found'})}\n\n"
                            return
                        
                        # Stream the summary generation using OpenAI streaming
                        yield f"data: {json.dumps({'type': 'status', 'message': 'Generating response...'})}\n\n"
                        
                        # Build summary prompt (same as summarize_results node)
                        from backend.llm.nodes.summary_nodes import summarize_results
                        # Get the prompt from the summarize function logic
                        formatted_outputs = []
                        citation_map = {}  # NEW: Map citation number to doc_id and metadata
                        for idx, output in enumerate(doc_outputs, start=1):  # Start at 1 for citations
                            citation_number = idx  # [1], [2], [3], etc.
                            
                            # FIX: Get doc_id with fallback - check output, then source_chunks_metadata
                            doc_id = output.get('doc_id') or ''
                            if not doc_id:
                                # Try to get doc_id from first chunk's metadata
                                source_chunks = output.get('source_chunks_metadata', [])
                                if source_chunks and isinstance(source_chunks, list) and len(source_chunks) > 0:
                                    doc_id = source_chunks[0].get('doc_id') or ''
                            
                            if not doc_id:
                                logger.warning(f"🟡 [CITATIONS] No doc_id found in doc_output[{idx}], skipping citation mapping")
                                continue  # Skip documents without doc_id
                            
                            doc_type = (output.get('classification_type') or 'Property Document').replace('_', ' ').title()
                            filename = output.get('original_filename', f"Document {doc_id[:8]}")
                            prop_id = output.get('property_id') or 'Unknown'
                            address = output.get('property_address', f"Property {prop_id[:8]}")
                            page_info = output.get('page_range', 'multiple pages')
                            
                            # NEW: Store citation mapping for later use (includes bbox metadata)
                            citation_map[str(citation_number)] = {
                                'doc_id': doc_id,
                                'source_chunks_metadata': output.get('source_chunks_metadata', []),
                                'original_filename': filename,
                                'property_address': address,
                                'page_range': page_info,
                                'classification_type': doc_type
                            }
                            
                            # NEW: Number documents for citation reference
                            header = f"\n[Document {citation_number}] {doc_type}: {filename}\n"
                            header += f"Property: {address}\n"
                            header += f"Pages: {page_info}\n"
                            header += f"---------------------------------------------\n"
                            
                            formatted_outputs.append(header + output.get('output', ''))
                        
                        formatted_outputs_str = "\n".join(formatted_outputs)
                        
                        prompt = f"""You are an AI assistant for real estate and valuation professionals. You help them quickly understand what's inside their documents and how that information relates to their query.

CONTEXT

The user works in real estate (agent, valuer, acquisitions, asset manager, investor, or analyst).
They have uploaded {len(doc_outputs)} documents, which may include: valuation reports, leases, EPCs, offer letters, appraisals, inspections, legal documents, or correspondence.

The user has asked:

"{query}"

Below is the extracted content from the pages you analyzed:

{formatted_outputs_str}

GUIDELINES FOR YOUR RESPONSE

Speak naturally, like an experienced real estate professional giving you exactly what you need without excess detail unless explicitly asked for.

**CITATION REQUIREMENTS:**
- Each document is labeled with [Document 1], [Document 2], etc. at the top
- When you use information from a document, cite it immediately after the relevant sentence using the format [1], [2], [3], etc.
- Place citations right after the sentence that contains information from that document
- Example: "The property is approximately 2.5 acres[1]. The valuation was completed by John Smith[2]."
- If multiple documents support the same fact, cite all: "The property has 5 bedrooms[1][2]."
- Citations should appear inline, naturally within your response
- Always cite your sources - use [1], [2], etc. after each fact that comes from a document

Focus on what matters in real estate:
- Valuations, specifications, location, condition, risks, opportunities, deal terms, and comparable evidence.

CRITICAL RULES:
1. **Do NOT repeat the user's question as a heading or title** - The user can see their own query, so start directly with the answer.
2. **Do NOT add "Additional Context" sections** - Only provide context if the user explicitly asks for it.
3. **Do NOT add unsolicited insights or recommendations** - Answer only what was asked.
4. **Do NOT add "Next steps" or follow-up suggestions** - Answer the question and stop.
5. **Always cite your sources** - Use [1], [2], etc. after each fact that comes from a document.

Start with a clear, direct answer to the user's question. Provide only the information requested - nothing more.

TONE

Professional, concise, helpful, human, and grounded in the documents — not robotic or over-structured.

Now provide your response (answer directly, no heading, no additional context, with citations):"""
                        
                        # Use streaming LLM
                        logger.info("🟡 [STREAM] Creating ChatOpenAI instance...")
                        logger.info(f"🟡 [STREAM] API Key present: {bool(config.openai_api_key)}")
                        logger.info(f"🟡 [STREAM] Model: {config.openai_model}")
                        llm = ChatOpenAI(
                            api_key=config.openai_api_key,
                            model=config.openai_model,
                            temperature=0,
                            streaming=True,  # Enable streaming
                        )
                        logger.info("🟡 [STREAM] ChatOpenAI instance created, starting to stream...")
                        
                        # Stream tokens
                        full_summary = ""
                        chunk_count = 0
                        for chunk in llm.stream(prompt):
                            chunk_count += 1
                            if chunk_count == 1:
                                logger.info("🟡 [STREAM] First chunk received from LLM")
                            if chunk.content:
                                token = chunk.content
                                full_summary += token
                                yield f"data: {json.dumps({'type': 'token', 'token': token})}\n\n"
                        
                        # NEW: Parse citations from LLM response and map to bbox metadata
                        # Strategy: Number citations per unique chunk/bbox, not per document
                        # Each unique chunk gets its own sequential number (1, 2, 3...)
                        citations_data = {}  # Initialize to empty dict
                        try:
                            citation_pattern = r'\[(\d+)\]'
                            citations_found = re.findall(citation_pattern, full_summary)
                            
                            # If no documents, skip citation processing
                            if not citation_map:
                                logger.info("🟡 [CITATIONS] No documents found, skipping citation processing")
                            else:
                                # Step 1: Build a map of ALL unique chunks from ALL documents
                                # Key: (doc_id, chunk_index, page_number) -> unique chunk identifier
                                # Value: sequential citation number
                                all_chunks_map = {}  # Map chunk_signature to citation number
                                sequential_num = 1
                                chunk_to_citation = {}  # Map chunk_signature to citation number
                                citation_to_chunks = {}  # Map citation number to chunk metadata
                                
                                # First, collect ALL chunks from ALL documents in citation_map
                                for doc_num_str, doc_citation in citation_map.items():
                                    doc_id = doc_citation['doc_id']
                                    source_chunks_metadata = doc_citation.get('source_chunks_metadata', [])
                                    
                                    if isinstance(source_chunks_metadata, list):
                                        for chunk in source_chunks_metadata:
                                            if isinstance(chunk, dict):
                                                chunk_index = chunk.get('chunk_index')
                                                page_number = chunk.get('page_number')
                                                bbox = chunk.get('bbox')
                                                
                                                # Create unique chunk signature: (doc_id, chunk_index, page_number)
                                                # This uniquely identifies a chunk regardless of document
                                                chunk_signature = (doc_id, chunk_index, page_number)
                                                
                                                # If this is a new unique chunk, assign it a citation number
                                                if chunk_signature not in chunk_to_citation:
                                                    chunk_to_citation[chunk_signature] = sequential_num
                                                    citation_to_chunks[str(sequential_num)] = {
                                                        'doc_id': doc_id,
                                                        'chunk_index': chunk_index,
                                                        'page_number': page_number,
                                                        'chunk_metadata': chunk,  # Full chunk metadata including bbox
                                                        'original_filename': doc_citation.get('original_filename'),
                                                        'property_address': doc_citation.get('property_address'),
                                                        'page_range': doc_citation.get('page_range'),
                                                        'classification_type': doc_citation.get('classification_type')
                                                    }
                                                    logger.info(f"🟡 [CITATIONS] Assigned citation [{sequential_num}] to chunk: doc {doc_id[:8]}, chunk_idx {chunk_index}, page {page_number}")
                                                    sequential_num += 1
                                
                                # Step 2: Map LLM's document citations to chunk citations
                                # When LLM cites [1] (Document 1), we need to map it to all chunks from Document 1
                                citation_renumber_map = {}  # Map old doc citation -> new chunk citations
                                doc_to_chunk_citations = {}  # Map doc_num -> list of chunk citation numbers
                                
                                for doc_num_str, doc_citation in citation_map.items():
                                    doc_id = doc_citation['doc_id']
                                    source_chunks_metadata = doc_citation.get('source_chunks_metadata', [])
                                    
                                    # Get all chunk citation numbers for this document
                                    chunk_citations = []
                                    if isinstance(source_chunks_metadata, list):
                                        for chunk in source_chunks_metadata:
                                            if isinstance(chunk, dict):
                                                chunk_index = chunk.get('chunk_index')
                                                page_number = chunk.get('page_number')
                                                chunk_signature = (doc_id, chunk_index, page_number)
                                                
                                                if chunk_signature in chunk_to_citation:
                                                    chunk_cit_num = str(chunk_to_citation[chunk_signature])
                                                    if chunk_cit_num not in chunk_citations:
                                                        chunk_citations.append(chunk_cit_num)
                                    
                                    doc_to_chunk_citations[doc_num_str] = chunk_citations
                                
                                # Step 3: Replace document citations with chunk citations in the text
                                # When we see [1], replace it with [1], [2], [3] etc. based on chunks
                                # But actually, we should just use the first chunk citation number
                                # and let the frontend handle multiple chunks per document
                                
                                # For now, map each document citation to its first chunk citation
                                # (We can enhance this later to handle multiple chunks per document citation)
                                for doc_num_str in citations_found:
                                    if doc_num_str in doc_to_chunk_citations:
                                        chunk_citations = doc_to_chunk_citations[doc_num_str]
                                        if chunk_citations:
                                            # Use the first chunk citation number for this document
                                            citation_renumber_map[doc_num_str] = chunk_citations[0]
                                            logger.info(f"🟡 [CITATIONS] Mapped document citation [{doc_num_str}] to chunk citation [{chunk_citations[0]}] (from {len(chunk_citations)} chunks)")
                                
                                # Get unique chunk citation numbers that were actually used
                                unique_citations = sorted(set(citation_renumber_map.values()), key=int) if citation_renumber_map else []
                                
                                logger.info(f"🟡 [CITATIONS] Found {len(citations_found)} document citation(s), mapped to {len(unique_citations)} unique chunk citation(s): {unique_citations}")
                                
                                # Renumber citations in the text: replace document citations with chunk citations
                                if citation_renumber_map:
                                    def replace_citation(match):
                                        old_num = match.group(1)
                                        new_num = citation_renumber_map.get(old_num, old_num)
                                        return f'[{new_num}]'
                                    
                                    full_summary = re.sub(citation_pattern, replace_citation, full_summary)
                                    logger.debug(f"🟡 [CITATIONS] After renumbering to chunk citations, full_summary has {len(re.findall(citation_pattern, full_summary))} citations")
                                
                                # Deduplicate citations: same citation number in same sentence -> keep only first
                                def deduplicate_citations(text):
                                    sentences = re.split(r'([.!?]+\s+)', text)
                                    deduped_sentences = []
                                    
                                    for i in range(0, len(sentences), 2):
                                        sentence = sentences[i]
                                        delimiter = sentences[i + 1] if i + 1 < len(sentences) else ''
                                        
                                        if not sentence:
                                            deduped_sentences.append(sentence + delimiter)
                                            continue
                                        
                                        citation_pattern_local = r'\[(\d+)\]'
                                        citations = list(re.finditer(citation_pattern_local, sentence))
                                        
                                        if len(citations) <= 1:
                                            deduped_sentences.append(sentence + delimiter)
                                            continue
                                        
                                        seen_nums = set()
                                        parts = []
                                        last_end = 0
                                        
                                        for match in citations:
                                            citation_num = match.group(1)
                                            
                                            if match.start() > last_end:
                                                parts.append(sentence[last_end:match.start()])
                                            
                                            if citation_num not in seen_nums:
                                                parts.append(match.group(0))
                                                seen_nums.add(citation_num)
                                            
                                            last_end = match.end()
                                        
                                        if last_end < len(sentence):
                                            parts.append(sentence[last_end:])
                                        
                                        deduped_sentences.append(''.join(parts) + delimiter)
                                    
                                    return ''.join(deduped_sentences)
                                
                                # Deduplicate citations in the text
                                full_summary = deduplicate_citations(full_summary)
                                
                                # Build citations_data mapping: chunk citation number -> chunk metadata with bbox
                                citations_data = {}
                                for citation_num_str, chunk_info in citation_to_chunks.items():
                                    # Only include citations that were actually used in the response
                                    if citation_num_str in unique_citations:
                                        chunk_metadata = chunk_info.get('chunk_metadata', {})
                                        
                                        # FIX: Get doc_id from chunk_info or fallback to chunk_metadata
                                        # This handles cases where doc_id might be empty in citation_map
                                        doc_id = chunk_info.get('doc_id') or chunk_metadata.get('doc_id') or ''
                                        
                                        if not doc_id:
                                            logger.warning(f"🟡 [CITATIONS] No doc_id found for citation [{citation_num_str}], chunk_idx {chunk_info.get('chunk_index')}")
                                        
                                        # Ensure doc_id is in chunk_metadata for frontend
                                        if chunk_metadata and not chunk_metadata.get('doc_id'):
                                            chunk_metadata = {**chunk_metadata, 'doc_id': doc_id}
                                        
                                        # Build source_chunks_metadata array with just this chunk
                                        source_chunks_metadata = [chunk_metadata] if chunk_metadata else []
                                        
                                        citations_data[citation_num_str] = {
                                            'doc_id': doc_id,  # Use recovered doc_id
                                            'original_filename': chunk_info.get('original_filename'),
                                            'property_address': chunk_info.get('property_address'),
                                            'page_range': chunk_info.get('page_range'),
                                            'classification_type': chunk_info.get('classification_type'),
                                            'source_chunks_metadata': source_chunks_metadata  # Single chunk with bbox!
                                        }
                                        logger.info(
                                            f"🟡 [CITATIONS] Mapped chunk citation [{citation_num_str}] to doc {doc_id[:8] if doc_id else 'MISSING'}, "
                                            f"chunk_idx {chunk_info.get('chunk_index')}, page {chunk_info.get('page_number')}, "
                                            f"bbox: {bool(chunk_metadata.get('bbox'))}"
                                        )
                        except Exception as citation_error:
                            logger.error(f"🟡 [CITATIONS] Error parsing citations: {citation_error}", exc_info=True)
                            citations_data = {}  # Fallback to empty citations
                        
                        # Send complete message with metadata
                        complete_data = {
                            'type': 'complete',
                            'data': {
                                'summary': full_summary.strip(),
                                'relevant_documents': relevant_docs,
                                'document_outputs': doc_outputs,
                                'citations': citations_data,  # Citation mapping with bbox
                                'session_id': session_id
                            }
                        }
                        yield f"data: {json.dumps(complete_data)}\n\n"
                    
                    except Exception as e:
                        logger.error(f"Error in run_and_stream: {e}")
                        import traceback
                        traceback.print_exc()
                        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            
                # Run async stream
                # Note: run_and_stream() is an async generator, so we need to consume it properly
                # Use a thread-safe approach to run async code from sync generator
                import concurrent.futures
                import threading
                
                # Create a queue to pass chunks from async to sync
                from queue import Queue
                chunk_queue = Queue()
                error_occurred = threading.Event()
                error_message = [None]
                
                def run_async_gen():
                    """Run the async generator in a separate thread with its own event loop"""
                    try:
                        logger.info("🟠 [STREAM] run_async_gen() thread started")
                        # Create new event loop for this thread
                        new_loop = asyncio.new_event_loop()
                        asyncio.set_event_loop(new_loop)
                        logger.info("🟠 [STREAM] New event loop created")
                        
                        async def consume_async_gen():
                            try:
                                logger.info("🟠 [STREAM] consume_async_gen() started")
                                async_gen = run_and_stream()
                                logger.info("🟠 [STREAM] Async generator created, starting to consume...")
                                chunk_count = 0
                                async for chunk in async_gen:
                                    chunk_count += 1
                                    if chunk_count == 1:
                                        logger.info("🟠 [STREAM] First chunk received from async generator")
                                    # Log reasoning step chunks for debugging
                                    try:
                                        if chunk.startswith('data: '):
                                            chunk_data = json.loads(chunk[6:])
                                            if chunk_data.get('type') == 'reasoning_step':
                                                logger.info(f"🟡 [STREAM] Queueing reasoning_step: {chunk_data.get('step')} - {chunk_data.get('message')}")
                                    except:
                                        pass
                                    chunk_queue.put(('chunk', chunk))
                                logger.info(f"🟠 [STREAM] Async generator completed, received {chunk_count} chunks")
                                chunk_queue.put(('done', None))
                            except Exception as e:
                                logger.error(f"❌ [STREAM] Error in async generator: {e}")
                                import traceback
                                logger.error(f"❌ [STREAM] Traceback: {traceback.format_exc()}")
                                traceback.print_exc()
                                error_message[0] = str(e)
                                error_occurred.set()
                                chunk_queue.put(('error', str(e)))
                        
                        logger.info("🟠 [STREAM] Running async generator in event loop...")
                        new_loop.run_until_complete(consume_async_gen())
                        logger.info("🟠 [STREAM] Event loop completed")
                        new_loop.close()
                    except Exception as e:
                        logger.error(f"❌ [STREAM] Error in async thread: {e}")
                        import traceback
                        logger.error(f"❌ [STREAM] Traceback: {traceback.format_exc()}")
                        traceback.print_exc()
                        error_message[0] = str(e)
                        error_occurred.set()
                        chunk_queue.put(('error', str(e)))
                
                # Start async generator in background thread
                thread = threading.Thread(target=run_async_gen, daemon=True)
                thread.start()
                
                # Yield chunks as they arrive from the async generator
                while True:
                    try:
                        # Wait for chunk with timeout to allow checking thread status
                        try:
                            item_type, item_data = chunk_queue.get(timeout=0.1)
                        except:
                            # Check if thread is still alive
                            if not thread.is_alive() and chunk_queue.empty():
                                if error_occurred.is_set():
                                    yield f"data: {json.dumps({'type': 'error', 'message': error_message[0] or 'Unknown error'})}\n\n"
                                break
                            continue
                        
                        if item_type == 'chunk':
                            # Log reasoning step chunks being yielded for debugging
                            try:
                                if item_data.startswith('data: '):
                                    chunk_data = json.loads(item_data[6:])
                                    if chunk_data.get('type') == 'reasoning_step':
                                        logger.info(f"🟡 [STREAM] Yielding reasoning_step to client: {chunk_data.get('step')} - {chunk_data.get('message')}")
                            except:
                                pass
                            yield item_data
                        elif item_type == 'done':
                            break
                        elif item_type == 'error':
                            yield f"data: {json.dumps({'type': 'error', 'message': item_data})}\n\n"
                            break
                    except Exception as e:
                        logger.error(f"Error consuming stream chunks: {e}")
                        import traceback
                        traceback.print_exc()
                        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
                        break
            except Exception as e:
                logger.error(f"❌ [STREAM] Error in generate_stream: {e}")
                import traceback
                logger.error(f"❌ [STREAM] Full traceback: {traceback.format_exc()}")
                traceback.print_exc()
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        
        # Return SSE response with proper CORS headers
        # Note: generate_stream() already has internal error handling that yields error messages
        try:
            logger.info("🔵 [STREAM] Creating Response object with stream...")
            response = Response(
                stream_with_context(generate_stream()),
                mimetype='text/event-stream',
                headers={
                    'Cache-Control': 'no-cache',
                    'X-Accel-Buffering': 'no',  # Disable nginx buffering
                    'Access-Control-Allow-Origin': request.headers.get('Origin', '*'),
                    'Access-Control-Allow-Credentials': 'true',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                }
            )
            logger.info("🔵 [STREAM] Response object created successfully, returning...")
            return response
        except Exception as response_error:
            # If Response creation fails, return error with CORS headers
            logger.error(f"❌ [STREAM] Error creating streaming response: {response_error}")
            import traceback
            logger.error(f"❌ [STREAM] Response creation traceback: {traceback.format_exc()}")
            traceback.print_exc()
            error_response = jsonify({
                'success': False,
                'error': f'Failed to create streaming response: {str(response_error)}'
            })
            error_response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
            error_response.headers.add('Access-Control-Allow-Credentials', 'true')
            error_response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            error_response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
            return error_response, 500
    except Exception as e:
        # Catch any errors and return with CORS headers
        logger.error(f"❌ [STREAM] Outer exception in query_documents_stream: {e}")
        import traceback
        logger.error(f"❌ [STREAM] Full traceback: {traceback.format_exc()}")
        traceback.print_exc()
        response = jsonify({
            'success': False,
            'error': str(e)
        })
        # Ensure all CORS headers are present for error responses
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response, 500

@views.route('/api/llm/query', methods=['POST', 'OPTIONS'])
def query_documents():
    """
    Query documents using LangGraph main graph with hybrid search (BM25 + Vector)
    This endpoint connects the SideChatPanel to the RAG system.
    
    Accepts:
    - query: User's question
    - propertyId: Optional property ID from property attachment (used to find linked document)
    - messageHistory: Previous conversation messages
    - sessionId: Optional session ID for conversation persistence
    
    Returns:
    - summary: LLM-generated answer
    - relevant_documents: List of retrieved documents
    - document_outputs: Processed document information
    """
    # Handle CORS preflight - must be before authentication check
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200
    
    # Require login for actual POST request
    if not current_user.is_authenticated:
        return jsonify({
            'success': False,
            'error': 'Authentication required'
        }), 401
    
    import asyncio
    import time
    from backend.llm.graphs.main_graph import main_graph, checkpointer
    
    data = request.get_json()
    if data is None:
        response = jsonify({
            'success': False,
            'error': 'Invalid or missing JSON in request body'
        })
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response, 400
    
    query = data.get('query', '')
    property_id = data.get('propertyId')  # From property attachment
    message_history = data.get('messageHistory', [])
    session_id = data.get('sessionId', f"session_{request.remote_addr}_{int(time.time())}")
    
    if not query:
        return jsonify({
            'success': False,
            'error': 'Query is required'
        }), 400
    
    try:
        # Get business_id from session
        business_id = _ensure_business_uuid()
        if not business_id:
            return jsonify({
                'success': False,
                'error': 'User not associated with a business'
            }), 400
        
        # Get document_id from property_id if provided
        document_id = None
        if property_id:
            try:
                # Query document_relationships to find document linked to this property
                supabase = get_supabase_client()
                
                result = supabase.table('document_relationships')\
                    .select('document_id')\
                    .eq('property_id', property_id)\
                    .limit(1)\
                    .execute()
                
                if result.data and len(result.data) > 0:
                    document_id = result.data[0]['document_id']
                    logger.info(f"Found document {document_id} for property {property_id}")
            except Exception as e:
                logger.warning(f"Could not find document for property {property_id}: {e}")
        
        # Build initial state for LangGraph
        # Note: conversation_history will be loaded from checkpoint if thread_id exists
        # Only provide minimal required fields - checkpointing will restore previous state
        initial_state = {
            "user_query": query,
            "user_id": str(current_user.id) if current_user.is_authenticated else "anonymous",
            "business_id": business_id,
            "session_id": session_id,
            "property_id": property_id  # Pass property_id to filter results
        }
        
        # Use global graph instance (initialized on app startup)
        async def run_query():
            # Create checkpointer for THIS event loop (created by asyncio.run())
            # This avoids "bound to different event loop" errors
            from backend.llm.graphs.main_graph import build_main_graph, create_checkpointer_for_current_loop
            
            try:
                logger.info("Creating checkpointer for current event loop...")
                checkpointer = await create_checkpointer_for_current_loop()
                
                if checkpointer:
                    # Build graph with checkpointer for this event loop
                    # All checkpointers point to same database, so state is shared via thread_id
                    logger.info("Building graph with checkpointer for this event loop")
                    graph, _ = await build_main_graph(use_checkpointer=True, checkpointer_instance=checkpointer)
                else:
                    logger.warning("Failed to create checkpointer - using stateless mode")
                    graph, _ = await build_main_graph(use_checkpointer=False)
                
                config = {
                    "configurable": {
                        "thread_id": session_id  # For conversation persistence via checkpointing
                    }
                }
                result = await graph.ainvoke(initial_state, config)
                return result
            except Exception as graph_error:
                # Handle connection closed errors gracefully
                error_msg = str(graph_error)
                if "connection is closed" in error_msg.lower() or "operationalerror" in error_msg.lower():
                    logger.warning(f"Checkpointer connection error: {graph_error}")
                    # Try without checkpointer (will run in stateless mode)
                    logger.info("Retrying query without checkpointer (stateless mode)")
                    graph, _ = await build_main_graph(use_checkpointer=False)
                    result = await graph.ainvoke(initial_state, {})
                    return result
                else:
                    raise  # Re-raise if it's a different error
        
        # Run async graph
        logger.info(f"Running LangGraph query: '{query[:50]}...' (property_id: {property_id}, session: {session_id})")
        result = asyncio.run(run_query())
        
        # Format response for frontend
        final_summary = result.get("final_summary", "")
        
        # If summary is empty or generic, provide a better fallback
        if not final_summary or final_summary == "I found some information for you.":
            if result.get("relevant_documents"):
                final_summary = f"I found {len(result.get('relevant_documents', []))} relevant document(s), but couldn't extract a specific answer. Please try rephrasing your query."
            else:
                final_summary = f"I couldn't find any documents matching your query: \"{query}\". Try using more general terms or rephrasing your question."
        
        response_data = {
            "query": query,
            "summary": final_summary,
            "message": final_summary,  # Alias for compatibility
            "relevant_documents": result.get("relevant_documents", []),
            "document_outputs": result.get("document_outputs", []),
            "session_id": session_id
        }
        
        logger.info(f"LangGraph query completed: {len(result.get('relevant_documents', []))} documents found")
        
        return jsonify({
            'success': True,
            'data': response_data
        }), 200
        
    except Exception as e:
        logger.error(f"Error in query_documents: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/vector/search', methods=['POST'])
@login_required
def vector_search():
    """Semantic search using vector embeddings"""
    data = request.get_json()
    query = data.get('query', '')
    search_type = data.get('type', 'document')  # 'document' or 'property'
    limit = data.get('limit', 10)
    similarity_threshold = data.get('similarity_threshold', 0.7)
    
    try:
        from .services.vector_service import SupabaseVectorService
        
        vector_service = SupabaseVectorService()
        
        if search_type == 'document':
            results = vector_service.search_document_vectors(
                query, 
                current_user.company_name, 
                limit, 
                similarity_threshold
            )
        else:
            results = vector_service.search_property_vectors(
                query, 
                current_user.company_name, 
                limit, 
                similarity_threshold
            )
        
        return jsonify({
            'success': True,
            'data': {
                'results': results,
                'query': query,
                'type': search_type,
                'count': len(results)
            }
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ============================================================================
# PROPERTY SEARCH & ANALYSIS ENDPOINTS
# ============================================================================

@views.route('/api/properties', methods=['GET'])
@login_required
def get_all_properties():
    """Get all properties for the current user's business using Property Hub Service"""
    try:
        from .services.supabase_property_hub_service import SupabasePropertyHubService
        
        # Validate business access
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({
                'success': False,
                'error': 'User not associated with a business'
            }), 400
        
        # Get query parameters
        limit = request.args.get('limit', 1000, type=int)
        offset = request.args.get('offset', 0, type=int)
        sort_by = request.args.get('sort_by', 'created_at')
        sort_order = request.args.get('sort_order', 'desc')
        
        property_hub_service = SupabasePropertyHubService()
        property_hubs = property_hub_service.get_all_property_hubs(
            business_uuid_str,
            limit=limit,
            offset=offset,
            sort_by=sort_by,
            sort_order=sort_order
        )
        
        # Transform property hubs to match expected frontend format
        properties = []
        for hub in property_hubs:
            property_data = hub.get('property', {})
            property_details = hub.get('property_details', {})
            documents = hub.get('documents', [])
            
            # Combine property and property_details data
            combined_property = {
                'id': property_data.get('id'),
                'address_hash': property_data.get('address_hash'),
                'normalized_address': property_data.get('normalized_address'),
                'formatted_address': property_data.get('formatted_address'),
                'latitude': property_data.get('latitude'),
                'longitude': property_data.get('longitude'),
                'business_id': business_uuid_str,
                'created_at': property_data.get('created_at'),
                'updated_at': property_data.get('updated_at'),
                'last_enrichment_at': property_data.get('last_enrichment_at'),
                'completeness_score': property_data.get('completeness_score', 0.0),
                
                # Property details
                'property_type': property_details.get('property_type'),
                'size_sqft': property_details.get('size_sqft'),
                'number_bedrooms': property_details.get('number_bedrooms'),
                'number_bathrooms': property_details.get('number_bathrooms'),
                'tenure': property_details.get('tenure'),
                'epc_rating': property_details.get('epc_rating'),
                'condition': property_details.get('condition'),
                'other_amenities': property_details.get('other_amenities'),
                'asking_price': property_details.get('asking_price'),
                'sold_price': property_details.get('sold_price'),
                'rent_pcm': property_details.get('rent_pcm'),
                'last_transaction_date': property_details.get('last_transaction_date'),
                'last_valuation_date': property_details.get('last_valuation_date'),
                'data_quality_score': property_details.get('data_quality_score', 0.0),
                
                # Document and image data
                'document_count': len(documents),
                'has_images': any(doc.get('image_count', 0) > 0 for doc in documents),
                'image_count': sum(doc.get('image_count', 0) for doc in documents),
                'primary_image_url': next((doc.get('primary_image_url') for doc in documents if doc.get('primary_image_url')), None),
                
                # Hub metadata
                'hub_summary': hub.get('summary', {}),
                'comparable_data_count': len(hub.get('comparable_data', []))
            }
            properties.append(combined_property)
        
        # 🔍 DEBUG: Log API response data
        logger.info(f"🔍 DAY 5 DEBUG - Updated Properties API Response:")
        logger.info(f"   User business: {current_user.company_name}")
        logger.info(f"   Properties returned: {len(properties)}")
        
        if properties:
            sample_prop = properties[0]
            logger.info(f"   Sample property structure: {list(sample_prop.keys())}")
            logger.info(f"   Sample property prices: sold_price={sample_prop.get('sold_price')}, rent_pcm={sample_prop.get('rent_pcm')}, asking_price={sample_prop.get('asking_price')}")
            
            # Count properties with different price types
            price_counts = {
                'sold_price': sum(1 for p in properties if p.get('sold_price') and p['sold_price'] > 0),
                'rent_pcm': sum(1 for p in properties if p.get('rent_pcm') and p['rent_pcm'] > 0),
                'asking_price': sum(1 for p in properties if p.get('asking_price') and p['asking_price'] > 0),
                'no_price': sum(1 for p in properties if not (p.get('sold_price') or p.get('rent_pcm') or p.get('asking_price')))
            }
            logger.info(f"   Price type counts: {price_counts}")
            
            # Count properties with images
            image_counts = {
                'with_images': sum(1 for p in properties if p.get('image_count', 0) > 0),
                'without_images': sum(1 for p in properties if p.get('image_count', 0) == 0)
            }
            logger.info(f"   Image counts: {image_counts}")
        
        return jsonify({
            'success': True,
            'data': properties,
            'metadata': {
                'count': len(properties),
                'business_id': current_user.company_name,
                'timestamp': datetime.utcnow().isoformat(),
                'pagination': {
                    'limit': limit,
                    'offset': offset,
                    'sort_by': sort_by,
                    'sort_order': sort_order
                }
            }
        }), 200
    except Exception as e:
        logger.error(f"Error getting all properties: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/property-nodes', methods=['GET'])
@login_required
def get_property_nodes():
    """Get all property nodes for map visualization"""
    try:
        from .models import Property
        from .services.property_linking_service import PropertyLinkingService
        
        linking_service = PropertyLinkingService()
        properties = linking_service.get_all_properties_for_business(current_user.company_name)
        
        return jsonify({
            'success': True,
            'data': properties
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/property-nodes/<uuid:property_id>', methods=['GET'])
@login_required
def get_property_node_details(property_id):
    """Get property node with all linked documents"""
    try:
        from .services.property_linking_service import PropertyLinkingService
        
        linking_service = PropertyLinkingService()
        property_data = linking_service.get_property_with_documents(str(property_id), current_user.company_name)
        
        if not property_data:
            return jsonify({
                'success': False,
                'error': 'Property not found'
            }), 404
        
        return jsonify({
            'success': True,
            'data': property_data
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/properties/search', methods=['POST'])
@login_required
def search_properties():
    """Search properties with query and filters using Property Hub Service"""
    try:
        from .services.supabase_property_hub_service import SupabasePropertyHubService
        
        # Validate business access
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({
                'success': False,
                'error': 'User not associated with a business'
            }), 400
        
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'error': 'Request body is required'
            }), 400
        
        # Extract search parameters
        query = data.get('query', '')
        filters = data.get('filters', {})
        limit = data.get('limit', 50)
        offset = data.get('offset', 0)
        
        property_hub_service = SupabasePropertyHubService()
        results = property_hub_service.search_property_hubs(
            business_id=business_uuid_str,
            query=query,
            filters=filters,
            limit=limit,
            offset=offset
        )
        
        # Transform property hubs to match expected frontend format
        properties = []
        for hub in results:
            property_data = hub.get('property', {})
            property_details = hub.get('property_details', {})
            documents = hub.get('documents', [])
            
            # Combine property and property_details data
            combined_property = {
                'id': property_data.get('id'),
                'address_hash': property_data.get('address_hash'),
                'normalized_address': property_data.get('normalized_address'),
                'formatted_address': property_data.get('formatted_address'),
                'latitude': property_data.get('latitude'),
                'longitude': property_data.get('longitude'),
                'business_id': business_uuid_str,
                'created_at': property_data.get('created_at'),
                'updated_at': property_data.get('updated_at'),
                'last_enrichment_at': property_data.get('last_enrichment_at'),
                'completeness_score': property_data.get('completeness_score', 0.0),
                
                # Property details
                'property_type': property_details.get('property_type'),
                'size_sqft': property_details.get('size_sqft'),
                'number_bedrooms': property_details.get('number_bedrooms'),
                'number_bathrooms': property_details.get('number_bathrooms'),
                'tenure': property_details.get('tenure'),
                'epc_rating': property_details.get('epc_rating'),
                'condition': property_details.get('condition'),
                'other_amenities': property_details.get('other_amenities'),
                'asking_price': property_details.get('asking_price'),
                'sold_price': property_details.get('sold_price'),
                'rent_pcm': property_details.get('rent_pcm'),
                'last_transaction_date': property_details.get('last_transaction_date'),
                'last_valuation_date': property_details.get('last_valuation_date'),
                'data_quality_score': property_details.get('data_quality_score', 0.0),
                
                # Document and image data
                'document_count': len(documents),
                'has_images': any(doc.get('image_count', 0) > 0 for doc in documents),
                'image_count': sum(doc.get('image_count', 0) for doc in documents),
                'primary_image_url': next((doc.get('primary_image_url') for doc in documents if doc.get('primary_image_url')), None),
                
                # Hub metadata
                'hub_summary': hub.get('summary', {}),
                'comparable_data_count': len(hub.get('comparable_data', []))
            }
            properties.append(combined_property)
        
        return jsonify({
            'success': True,
            'data': properties,
            'metadata': {
                'count': len(properties),
                'business_id': business_uuid_str,
                'timestamp': datetime.utcnow().isoformat(),
                'search_params': {
                    'query': query,
                    'filters': filters,
                    'limit': limit,
                    'offset': offset
                }
            }
        }), 200
    except Exception as e:
        logger.error(f"Error searching properties: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/property/<uuid:property_id>/enriched', methods=['GET'])
@login_required
def get_enriched_property(property_id):
    """Get enriched property data using Property Hub Service"""
    try:
        from .services.supabase_property_hub_service import SupabasePropertyHubService
        
        # Validate business access
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({
                'success': False,
                'error': 'User not associated with a business'
            }), 400
        
        property_hub_service = SupabasePropertyHubService()
        property_hub = property_hub_service.get_property_hub(str(property_id), business_uuid_str)
        
        if not property_hub:
            return jsonify({
                'success': False,
                'error': 'Property hub not found'
            }), 404
        
        # Return the complete property hub as enriched data
        return jsonify({
            'success': True,
            'data': property_hub,
            'metadata': {
                'property_id': str(property_id),
                'business_id': business_uuid_str,
                'timestamp': datetime.utcnow().isoformat(),
                'enrichment_source': 'property_hub_service'
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting enriched property {property_id}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/properties/completeness', methods=['GET'])
@login_required
def get_properties_completeness():
    """Get completeness report for all properties"""
    try:
        enrichment_service = PropertyEnrichmentService()
        properties = Property.query.filter_by(
            business_id=current_user.company_name
        ).all()
        
        results = []
        for prop in properties:
            completeness = enrichment_service.get_property_completeness(str(prop.id))
            results.append(completeness)
            
        return jsonify({
            'success': True,
            'data': sorted(
                results,
                key=lambda x: x['completeness_score'],
                reverse=True
            )
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/properties/analyze', methods=['POST'])
@login_required
def analyze_property_query():
    """Analyze property query to refine search"""
    data = request.get_json()
    query = data.get('query', '')
    previous_results = data.get('previousResults', [])
    
    try:
        from .services.property_search_service import PropertySearchService
        service = PropertySearchService()
        analysis = service.analyze_property_query(query, previous_results)
        
        return jsonify({
            'success': True,
            'data': analysis
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/properties/<uuid:property_id>/comparables', methods=['POST'])
@login_required
def get_property_comparables(property_id):
    """Get comparable properties"""
    data = request.get_json()
    criteria = data.get('criteria', {})
    
    try:
        from .services.property_search_service import PropertySearchService
        service = PropertySearchService()
        comparables = service.find_comparables(str(property_id), criteria)
        
        return jsonify({
            'success': True,
            'data': comparables
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ============================================================================
# OCR & DOCUMENT PROCESSING ENDPOINTS
# ============================================================================

@views.route('/api/ocr/extract', methods=['POST'])
@login_required
def extract_text_from_image():
    """Extract text from uploaded image"""
    if 'image' not in request.files:
        return jsonify({
            'success': False,
            'error': 'No image file provided'
        }), 400
    
    image_file = request.files['image']
    
    try:
        from .services.ocr_service import OCRService
        ocr = OCRService()
        result = ocr.extract_text_from_image(image_file)
        
        return jsonify({
            'success': True,
            'data': result
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/simple-test', methods=['GET'])
def simple_test():
    """Simple test endpoint without database or auth"""
    return jsonify({
        'success': True,
        'message': 'Simple test endpoint working',
        'timestamp': datetime.utcnow().isoformat()
    }), 200

@views.route('/api/documents/presigned-url', methods=['POST'])
@login_required
def get_presigned_url():
    """Generate presigned URL for direct S3 upload (bypasses API Gateway size limits)"""
    try:
        data = request.get_json()
        filename = data.get('filename')
        file_type = data.get('file_type', 'application/octet-stream')
        
        if not filename:
            return jsonify({'error': 'Filename is required'}), 400
        
        # Generate unique S3 key
        s3_key = f"{current_user.company_name}/{uuid.uuid4()}/{secure_filename(filename)}"
        
        # Create document record first
        new_document = Document(
            original_filename=filename,
            s3_path=s3_key,
            file_type=file_type,
            file_size=0,  # Will be updated after upload
            uploaded_by_user_id=current_user.id,
            business_id=current_user.company_name
        )
        db.session.add(new_document)
        db.session.commit()
        
        # Generate presigned URL for direct S3 upload
        import boto3
        from botocore.exceptions import ClientError
        
        s3_client = boto3.client(
            's3',
            aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
            aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
            region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
        )
        
        try:
            presigned_url = s3_client.generate_presigned_url(
                'put_object',
                Params={
                    'Bucket': os.environ['S3_UPLOAD_BUCKET'],
                    'Key': s3_key,
                    'ContentType': file_type
                },
                ExpiresIn=3600  # 1 hour
            )
            
            return jsonify({
                'success': True,
                'document_id': str(new_document.id),
                'presigned_url': presigned_url,
                's3_key': s3_key
            }), 200
            
        except ClientError as e:
            # Clean up document record if presigned URL generation fails
            db.session.delete(new_document)
            db.session.commit()
            return jsonify({'error': f'Failed to generate presigned URL: {str(e)}'}), 500
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@views.route('/api/documents/proxy-upload', methods=['POST', 'OPTIONS'])
@login_required
def proxy_upload():
    """
    Proxy upload to S3 (alternative to presigned URLs if CORS issues)
    
    Fast Pipeline: If property_id is provided, automatically triggers fast processing:
    - Section-based chunking with Reducto
    - Document-level context generation
    - Immediate embedding and vector storage
    - Target: <30 seconds processing time
    
    Documents uploaded without property_id will remain in 'UPLOADED' status.
    """
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200
    
    logger.info(f"📤 [PROXY-UPLOAD] POST request received from {current_user.email}")
    logger.info(f"📤 [PROXY-UPLOAD] Form data keys: {list(request.form.keys())}")
    logger.info(f"📤 [PROXY-UPLOAD] Files keys: {list(request.files.keys())}")
    
    try:
        if 'file' not in request.files:
            logger.error("No 'file' key in request.files")
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            logger.error("Empty filename")
            return jsonify({'error': 'No file selected'}), 400

        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({'error': 'User is not associated with a business'}), 400
        business_uuid = UUID(business_uuid_str)
        
        # Generate unique S3 key
        filename = secure_filename(file.filename)
        s3_key = f"{current_user.company_name}/{uuid.uuid4()}/{filename}"
        
        # Upload to S3 FIRST (before creating database record)
        try:
            s3_client = boto3.client(
                's3',
                aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
                aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
                region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
            )
            
            # Read file content once (will be reused for fast processing task)
            file.seek(0)  # Reset file pointer
            file_content = file.read()
            
            # Upload file to S3
            s3_client.put_object(
                Bucket=os.environ['S3_UPLOAD_BUCKET'],
                Key=s3_key,
                Body=file_content,
                ContentType=file.content_type
            )
            
            
        except Exception as e:
            logger.error(f"Failed to upload to S3: {e}")
            return jsonify({'error': f'Failed to upload to S3: {str(e)}'}), 500
        
        # Create document record in Supabase ONLY (skip local PostgreSQL to avoid enum issues)
        try:
            from .services.document_storage_service import DocumentStorageService
            
            # Get property_id from form data if provided
            property_id_raw = request.form.get('property_id')
            logger.info(f"📤 [PROXY-UPLOAD] Raw property_id from form: {property_id_raw} (type: {type(property_id_raw).__name__})")
            property_id = None
            
            # Normalize property_id: handle "null", "", None, or invalid UUIDs
            if property_id_raw:
                property_id_raw = property_id_raw.strip()
                # Check if it's the string "null", "none", or empty
                if property_id_raw.lower() in ['null', 'none', '']:
                    property_id = None
                else:
                    # Try to validate it's a valid UUID
                    try:
                        UUID(property_id_raw)  # Validate UUID format
                        property_id = property_id_raw
                    except (ValueError, TypeError):
                        # Invalid UUID format - treat as None
                        logger.warning(f"Invalid property_id format: {property_id_raw}, treating as None")
                        property_id = None
            
            # Generate document ID (uuid already imported at top of file)
            document_id = str(uuid.uuid4())
            
            # Create document directly in Supabase
            doc_storage = DocumentStorageService()
            success, doc_id, error = doc_storage.create_document({
                'id': document_id,
                'original_filename': filename,
                's3_path': s3_key,
                'file_type': file.content_type,
                'file_size': file.content_length or 0,
                'uploaded_by_user_id': str(current_user.id),
                'business_id': current_user.company_name,  # Supabase documents.business_id is varchar
                'business_uuid': business_uuid_str,  # Also store as UUID type
                'status': 'uploaded',
                'property_id': property_id  # Already normalized to None or valid UUID string
            })
            
            if not success:
                logger.error(f"Failed to create document in Supabase: {error}")
                # Try to clean up S3 file
                try:
                    s3_client.delete_object(Bucket=os.environ['S3_UPLOAD_BUCKET'], Key=s3_key)
                except:
                    pass
                return jsonify({'error': f'Failed to create document in Supabase: {error}'}), 500
            
            logger.info(f"✅ Document {doc_id} created in Supabase documents table")
            logger.info(f"📤 [PROXY-UPLOAD] Normalized property_id: {property_id} (will trigger fast pipeline: {property_id is not None})")
            
            # If property_id was provided, create document_relationships entry in Supabase
            if property_id:
                try:
                    from .services.supabase_property_hub_service import SupabasePropertyHubService
                    property_hub_service = SupabasePropertyHubService()
                    
                    # Check if relationship already exists
                    existing_check = property_hub_service.supabase.table('document_relationships')\
                        .select('id')\
                        .eq('document_id', doc_id)\
                        .eq('property_id', property_id)\
                        .execute()
                    
                    if not existing_check.data or len(existing_check.data) == 0:
                        # Create relationship in Supabase
                        relationship_data = {
                            'id': str(uuid.uuid4()),
                            'document_id': doc_id,
                            'property_id': property_id,
                            'relationship_type': 'property_document',
                            'address_source': 'manual_upload',
                            'confidence_score': 1.0,
                            'relationship_metadata': {
                                'match_type': 'direct_upload',
                                'matching_service': 'manual_upload',
                                'match_timestamp': datetime.utcnow().isoformat()
                            },
                            'created_at': datetime.utcnow().isoformat(),
                            'last_updated': datetime.utcnow().isoformat()
                        }
                        
                        result = property_hub_service.supabase.table('document_relationships').insert(relationship_data).execute()
                        if result.data:
                            logger.info(f"✅ Created document_relationships entry linking document {doc_id} to property {property_id}")
                        else:
                            logger.warning("Failed to create document relationship in Supabase")
                    else:
                        logger.info(f"Document relationship already exists for document {doc_id} and property {property_id}")
                except Exception as rel_error:
                    logger.warning(f"Failed to create document relationship (non-fatal): {rel_error}")
            
            # Trigger fast processing if property_id is provided
            if property_id:
                try:
                    logger.info(f"⚡ [PROXY-UPLOAD] Property ID provided ({property_id}), queuing fast processing task...")
                    # Queue fast processing task (property_id already known - no extraction needed)
                    task = process_document_fast_task.delay(
                        document_id=doc_id,
                        file_content=file_content,
                        original_filename=filename,
                        business_id=str(business_uuid_str),
                        property_id=str(property_id)
                    )
                    logger.info(f"⚡ [PROXY-UPLOAD] ✅ Queued fast processing task {task.id} for document {doc_id} (property {property_id})")
                except Exception as e:
                    logger.error(f"❌ [PROXY-UPLOAD] Failed to queue fast processing task: {e}", exc_info=True)
                    # Don't fail the upload - document is already created and uploaded
            else:
                logger.warning(f"⚠️ [PROXY-UPLOAD] No property_id provided - document {doc_id} will remain in 'UPLOADED' status (no processing pipeline activated)")
            
            # Success - document created in Supabase and linked to property if provided
            return jsonify({
                'success': True,
                'document_id': doc_id,
                'message': 'Document uploaded and created in Supabase successfully.',
                'status': 'uploaded',
                'property_linked': property_id is not None,
                'processing_queued': property_id is not None  # Indicate if fast processing was queued
            }), 200
            
        except Exception as e:
            logger.error(f"Failed to create document record in Supabase: {e}", exc_info=True)
            # Try to clean up S3 file if database record creation fails
            try:
                s3_client.delete_object(Bucket=os.environ['S3_UPLOAD_BUCKET'], Key=s3_key)
            except:
                pass
            return jsonify({'error': f'Failed to create document record: {str(e)}'}), 500
            
    except Exception as e:
        logger.error(f"Proxy upload failed: {e}")
        return jsonify({'error': str(e)}), 500

@views.route('/api/documents/upload', methods=['POST', 'OPTIONS'])
@login_required
def upload_document():
    """
    General document upload endpoint for files NOT associated with a property.
    
    Full Pipeline: Always triggers full processing:
    - Document classification
    - Property extraction (if applicable)
    - Full schema extraction
    - Image processing
    - Section-based chunking
    - Document-level context generation
    - Embedding and vector storage
    
    This endpoint is for general file uploads (e.g., from FileManager) that need
    full processing, unlike proxy-upload which is optimized for property card uploads.
    """
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200
    
    logger.info(f"📤 [UPLOAD] POST request received from {current_user.email}")
    logger.info(f"📤 [UPLOAD] Form data keys: {list(request.form.keys())}")
    logger.info(f"📤 [UPLOAD] Files keys: {list(request.files.keys())}")
    
    try:
        if 'file' not in request.files:
            logger.error("No 'file' key in request.files")
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            logger.error("Empty filename")
            return jsonify({'error': 'No file selected'}), 400

        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({'error': 'User is not associated with a business'}), 400
        business_uuid = UUID(business_uuid_str)
        
        # Generate unique S3 key
        filename = secure_filename(file.filename)
        s3_key = f"{current_user.company_name}/{uuid.uuid4()}/{filename}"
        
        # Upload to S3 FIRST (before creating database record)
        try:
            s3_client = boto3.client(
                's3',
                aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
                aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
                region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
            )
            
            # Read file content once (will be reused for full processing task)
            file.seek(0)  # Reset file pointer
            file_content = file.read()
            
            # Upload file to S3
            s3_client.put_object(
                Bucket=os.environ['S3_UPLOAD_BUCKET'],
                Key=s3_key,
                Body=file_content,
                ContentType=file.content_type
            )
            
        except Exception as e:
            logger.error(f"Failed to upload to S3: {e}")
            return jsonify({'error': f'Failed to upload to S3: {str(e)}'}), 500
        
        # Create document record in Supabase
        try:
            from .services.document_storage_service import DocumentStorageService
            
            # Generate document ID
            document_id = str(uuid.uuid4())
            
            # Create document directly in Supabase (NO property_id for general uploads)
            doc_storage = DocumentStorageService()
            success, doc_id, error = doc_storage.create_document({
                'id': document_id,
                'original_filename': filename,
                's3_path': s3_key,
                'file_type': file.content_type,
                'file_size': file.content_length or 0,
                'uploaded_by_user_id': str(current_user.id),
                'business_id': current_user.company_name,  # Supabase documents.business_id is varchar
                'business_uuid': business_uuid_str,  # Also store as UUID type
                'status': 'uploaded',
                'property_id': None  # General uploads are not linked to properties initially
            })
            
            if not success:
                logger.error(f"Failed to create document in Supabase: {error}")
                # Try to clean up S3 file
                try:
                    s3_client.delete_object(Bucket=os.environ['S3_UPLOAD_BUCKET'], Key=s3_key)
                except:
                    pass
                return jsonify({'error': f'Failed to create document in Supabase: {error}'}), 500
            
            logger.info(f"✅ Document {doc_id} created in Supabase documents table")
            logger.info(f"🔄 [UPLOAD] Queuing FULL processing pipeline for document {doc_id}")
            
            # ALWAYS trigger full processing pipeline (classification → extraction → embedding)
            try:
                # Queue full processing task (process_document_task → process_document_classification → full extraction)
                task = process_document_task.delay(
                    document_id=doc_id,
                    file_content=file_content,
                    original_filename=filename,
                    business_id=str(business_uuid_str)
                )
                logger.info(f"🔄 [UPLOAD] ✅ Queued full processing task {task.id} for document {doc_id}")
                logger.info(f"   Pipeline: classification → extraction → embedding")
            except Exception as e:
                logger.error(f"❌ [UPLOAD] Failed to queue full processing task: {e}", exc_info=True)
                # Don't fail the upload - document is already created and uploaded
                # But log this as a critical error since processing won't happen
            
            # Success - document created in Supabase and full processing queued
            return jsonify({
                'success': True,
                'document_id': doc_id,
                'message': 'Document uploaded and full processing pipeline queued.',
                'status': 'uploaded',
                'processing_queued': True,  # Always true for this endpoint
                'pipeline': 'full'  # Indicate this uses the full pipeline
            }), 200
            
        except Exception as e:
            logger.error(f"Failed to create document record in Supabase: {e}", exc_info=True)
            # Try to clean up S3 file if database record creation fails
            try:
                s3_client.delete_object(Bucket=os.environ['S3_UPLOAD_BUCKET'], Key=s3_key)
            except:
                pass
            response = jsonify({'error': f'Failed to create document record: {str(e)}'})
            response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            return response, 500
            
    except Exception as e:
        logger.error(f"Document upload failed: {e}")
        response = jsonify({'error': str(e)})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 500

@views.route('/api/documents/temp-preview', methods=['POST'])
@login_required
def temp_preview():
    """Simple temp upload for preview - no DB save"""
    file = request.files.get('file')
    if not file:
        return jsonify({'error': 'No file'}), 400
    
    s3_key = f"temp-preview/{uuid.uuid4()}/{secure_filename(file.filename)}"
    s3_client = boto3.client('s3', 
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
        region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1'))
    
    file.seek(0)
    s3_client.put_object(Bucket=os.environ['S3_UPLOAD_BUCKET'], Key=s3_key, Body=file.read(), ContentType=file.content_type)
    url = s3_client.generate_presigned_url('get_object', Params={'Bucket': os.environ['S3_UPLOAD_BUCKET'], 'Key': s3_key}, ExpiresIn=3600)
    return jsonify({'presigned_url': url}), 200

@views.route('/api/documents/test-s3', methods=['POST'])
@login_required
def test_s3_upload():
    """Simple S3 upload test endpoint"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Generate unique S3 key
        filename = secure_filename(file.filename)
        s3_key = f"test-uploads/{current_user.company_name}/{uuid.uuid4()}/{filename}"
        
        # Upload to S3
        s3_client = boto3.client(
            's3',
            aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
            aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
            region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
        )
        
        file.seek(0)
        s3_client.put_object(
            Bucket=os.environ['S3_UPLOAD_BUCKET'],
            Key=s3_key,
            Body=file.read(),
            ContentType=file.content_type
        )
        
        return jsonify({
            'success': True,
            'message': 'File uploaded to S3 successfully',
            's3_key': s3_key,
            'filename': filename
        }), 200
        
    except Exception as e:
        return jsonify({'error': f'S3 upload failed: {str(e)}'}), 500

@views.route('/api/documents', methods=['GET'])
@login_required
def get_documents():
    """
    Fetches all documents associated with the current user's business.
    """
    business_uuid_str = _ensure_business_uuid()
    if not business_uuid_str:
        return jsonify({'error': 'User is not associated with a business'}), 400

    documents = (
        Document.query
        .filter_by(business_id=UUID(business_uuid_str))
        .order_by(Document.created_at.desc())
        .all()
    )
    
    return jsonify([doc.serialize() for doc in documents])

@views.route('/api/documents/<uuid:document_id>', methods=['DELETE', 'OPTIONS'])
def delete_document_standard(document_id):
    """
    Standardized deletion endpoint for documents.
    Matches RESTful pattern: /api/documents/<id> (DELETE)
    Deletes a document from S3, Supabase stores, and its metadata record from the database.
    """
    # Handle CORS preflight - MUST be first, before authentication check
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'DELETE, OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200
    
    # Require login for actual DELETE request
    if not current_user.is_authenticated:
        response = jsonify({
            'success': False,
            'error': 'Authentication required'
        })
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'DELETE, OPTIONS')
        return response, 401
    
    logger.info(f"🗑️ DELETE /api/documents/{document_id} called by {current_user.email}")
    result = _perform_document_deletion(document_id)
    
    # Ensure CORS headers are present in the response
    if isinstance(result, tuple):
        response_obj, status_code = result
    else:
        response_obj = result
        status_code = 200
    
    if hasattr(response_obj, 'headers'):
        response_obj.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response_obj.headers.add('Access-Control-Allow-Credentials', 'true')
        response_obj.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    
    return result

@views.route('/api/documents/<uuid:document_id>/processing-history', methods=['GET'])
@login_required
def get_document_processing_history(document_id):
    """Get processing history for a specific document"""
    try:
        # Verify document belongs to user's business
        document = Document.query.get(document_id)
        if not document:
            return jsonify({'error': 'Document not found'}), 404
        
        if document.business_id != current_user.company_name:
            return jsonify({'error': 'Unauthorized'}), 403
        
        # Get processing history
        from .services.processing_history_service import ProcessingHistoryService
        history_service = ProcessingHistoryService()
        history = history_service.get_document_processing_history(str(document_id))
        
        return jsonify({
            'success': True,
            'data': {
                'document_id': str(document_id),
                'document_filename': document.original_filename,
                'processing_history': history
            }
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@views.route('/api/documents/<uuid:document_id>/status', methods=['GET'])
@login_required
def get_document_status(document_id):
    """Get document processing status and history from Supabase"""
    try:
        # Get document from Supabase
        doc_service = SupabaseDocumentService()
        document = doc_service.get_document_by_id(str(document_id))
        
        if not document:
            return jsonify({'error': 'Document not found'}), 404
        
        if str(document.get('business_id')) != str(current_user.business_id):
            return jsonify({'error': 'Unauthorized'}), 403
        
        # Get processing history (still from PostgreSQL for now)
        from .services.processing_history_service import ProcessingHistoryService
        history_service = ProcessingHistoryService()
        progress = history_service.get_pipeline_progress(str(document_id))
        
        response_data = {
            'success': True,
            'data': {
                'status': document.get('status', 'unknown'),
                'classification_type': document.get('classification_type'),
                'classification_confidence': document.get('classification_confidence'),
                'pipeline_progress': progress
            }
        }
        
        # 🔍 DEBUG: Log what we're sending to frontend
        logger.info(f"📤 STATUS API RESPONSE for {document_id}:")
        logger.info(f"   status: '{document.get('status')}' (type: {type(document.get('status')).__name__})")
        logger.info(f"   classification: {document.get('classification_type')}")
        logger.info(f"   Full response: {response_data}")
        
        return jsonify(response_data), 200
        
    except Exception as e:
        logger.error(f"Error getting document status: {e}")
        return jsonify({'error': str(e)}), 500

@views.route('/api/documents/<uuid:document_id>/confirm-upload', methods=['POST'])
@login_required
def confirm_upload(document_id):
    """Confirm successful upload and trigger processing"""
    try:
        document = Document.query.get_or_404(document_id)
        
        if str(document.get('business_id')) != str(current_user.business_id):
            return jsonify({'error': 'Unauthorized'}), 403
        
        data = request.get_json()
        file_size = data.get('file_size', 0)
        
        # Update document with actual file size
        document.file_size = file_size
        document.status = DocumentStatus.UPLOADED
        db.session.commit()
        
        # Get file content from S3 for processing
        try:
            s3_client = boto3.client(
                's3',
                aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
                aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
                region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
            )
            
            # Download file from S3
            response = s3_client.get_object(
                Bucket=os.environ['S3_UPLOAD_BUCKET'],
                Key=document.s3_path
            )
            file_content = response['Body'].read()
            
            # Trigger processing task
            task = process_document_task.delay(
                document_id=new_document.id,
                file_content=file_content,
                original_filename=filename,
                business_id=new_document.business_id
            )
            
            return jsonify({
                'success': True,
                'message': 'Upload confirmed and processing started',
                'task_id': task.id,
                'document_id': str(document_id)
            }), 200
            
        except Exception as e:
            document.status = DocumentStatus.FAILED
            db.session.commit()
            return jsonify({'error': f'Failed to start processing: {str(e)}'}), 500
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ============================================================================
# LOCATION & GEOCODING ENDPOINTS
# ============================================================================

@views.route('/api/location/geocode', methods=['POST'])
@login_required
def geocode_address_endpoint():
    """Forward geocoding: address to coordinates"""
    data = request.get_json()
    address = data.get('address', '')
    
    try:
        from .services.geocoding_service import GeocodingService
        geo = GeocodingService()
        result = geo.geocode_address(address)
        
        return jsonify({
            'success': True,
            'data': result
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/location/reverse-geocode', methods=['POST'])
@login_required
def reverse_geocode_endpoint():
    """Reverse geocoding: coordinates to address"""
    data = request.get_json()
    lat = data.get('lat')
    lng = data.get('lng')
    
    try:
        from .services.geocoding_service import GeocodingService
        geo = GeocodingService()
        result = geo.reverse_geocode(lat, lng)
        
        return jsonify({
            'success': True,
            'data': result
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/location/search', methods=['POST'])
@login_required
def search_location():
    """Search for locations"""
    data = request.get_json()
    query = data.get('query', '')
    
    try:
        from .services.geocoding_service import GeocodingService
        geo = GeocodingService()
        results = geo.search_location(query)
        
        return jsonify({
            'success': True,
            'data': results
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ============================================================================
# ANALYTICS ENDPOINTS
# ============================================================================

@views.route('/api/analytics/activity', methods=['POST'])
@login_required
def log_activity():
    """Log user activity"""
    data = request.get_json()
    
    try:
        from .services.analytics_service import AnalyticsService
        analytics = AnalyticsService()
        result = analytics.log_activity(
            current_user.id,
            data.get('type'),
            data.get('details', {})
        )
        
        return jsonify({
            'success': True,
            'data': result
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/analytics', methods=['GET'])
@login_required
def get_analytics():
    """Get analytics summary"""
    filters = dict(request.args)
    
    try:
        from .services.analytics_service import AnalyticsService
        analytics = AnalyticsService()
        result = analytics.get_analytics(current_user.company_name, filters)
        
        return jsonify({
            'success': True,
            'data': result
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ============================================================================
# MULTI-AGENT SYSTEM ENDPOINTS
# ============================================================================

@views.route('/api/agents/execute', methods=['POST'])
@login_required
def execute_agent_task():
    """Execute multi-agent task"""
    data = request.get_json()
    task_type = data.get('taskType', '')
    task_data = data.get('taskData', {})
    
    try:
        from .services.agent_service import AgentService
        agent = AgentService()
        result = agent.execute_agent_task(task_type, task_data)
        
        return jsonify({
            'success': True,
            'data': result
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/agents/status/<task_id>', methods=['GET'])
@login_required
def get_agent_status(task_id):
    """Get agent task status"""
    try:
        from .services.agent_service import AgentService
        agent = AgentService()
        result = agent.get_task_status(task_id)
        
        return jsonify({
            'success': True,
            'data': result
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Redirect root to TypeScript app
@views.route('/')
def root():
    return redirect('http://localhost:8080')


@views.route('/api/dashboard', methods=['GET'])
@login_required
def api_dashboard():
    """Get dashboard data with documents and properties from Supabase"""
    try:
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({'error': 'User is not associated with a business'}), 400

        business_uuid = UUID(business_uuid_str)
        # Get user's documents from Supabase
        doc_service = SupabaseDocumentService()
        documents = doc_service.get_documents_for_business(business_uuid, limit=10)
        
        # Get user's properties (still from PostgreSQL for now)
        properties = []
        try:
            properties = (
                Property.query
                .filter_by(business_id=business_uuid)
                .order_by(Property.created_at.desc())
                .limit(10)
                .all()
            )
        except Exception as e:
            logger.warning(f"Error querying properties from PostgreSQL: {e}")
            properties = []
        
        # Convert documents to JSON-serializable format
        documents_data = []
        for doc in documents:
            documents_data.append({
                'id': str(doc.get('id')),
                'original_filename': doc.get('original_filename'),
                'status': doc.get('status'),
                'classification_type': doc.get('classification_type'),
                'created_at': doc.get('created_at'),
                'file_size': doc.get('file_size')
            })
        
        # Convert properties to JSON-serializable format
        properties_data = []
        for prop in properties:
            properties_data.append({
                'id': str(prop.id),
                'formatted_address': prop.formatted_address,
                'normalized_address': prop.normalized_address,
                'completeness_score': prop.completeness_score,
                'created_at': prop.created_at.isoformat() if prop.created_at else None,
                'document_count': len(prop.documents) if prop.documents else 0
            })
    
        # User data
        user_data = {
            'id': current_user.id,
            'email': current_user.email,
            'first_name': current_user.first_name,
            'company_name': current_user.company_name,
            'business_id': str(current_user.business_id) if current_user.business_id else None,
            'company_website': current_user.company_website,
            'role': current_user.role.name
        }
        
        return jsonify({
            'user': user_data,
            'documents': documents_data,
            'properties': properties_data,
            'summary': {
                'total_documents': len(documents_data),
                'total_properties': len(properties_data),
                'recent_uploads': len([d for d in documents_data if d['status'] == 'completed'])
            }
        })
        
    except Exception as e:
        current_app.logger.exception("Dashboard error")
        return jsonify({'error': str(e)}), 500

# API endpoint for creating appraisals
@views.route('/api/appraisal', methods=['POST'])
@login_required
def api_create_appraisal():
    data = request.get_json()
    
    address = data.get('address')
    if not address: 
        return jsonify({'error': 'Address is required'}), 400
    
    try:
        new_appraisal = Appraisal(
                address=address,
            bedrooms=data.get('bedrooms'),
            bathrooms=data.get('bathrooms'),
            property_type=data.get('property_type'),
            land_size=float(data.get('land_size')) if data.get('land_size') else None,
            floor_area=float(data.get('floor_area')) if data.get('floor_area') else None,
            condition=int(data.get('condition')) if data.get('condition') else None,
            features=','.join(data.get('features', [])) if data.get('features') else None,
                user_id=current_user.id,
                status='In Progress'
            )
        db.session.add(new_appraisal)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'appraisal_id': new_appraisal.id,
            'message': 'Appraisal created successfully'
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

# API endpoint for React frontend
@views.route('/api/appraisal/<int:id>', methods=['GET'])
@login_required
def api_appraisal(id):
    appraisal = Appraisal.query.get_or_404(id)
    if appraisal.user_id != current_user.id:
        return jsonify({'error': 'You do not have permission to view this appraisal.'}), 403

    comparable_properties = ComparableProperty.query.filter_by(appraisal_id=id).all()
    chat_messages = ChatMessage.query.filter_by(appraisal_id=id).order_by(ChatMessage.timestamp).all()

    # Convert to JSON-serializable format
    appraisal_data = {
        'id': appraisal.id,
        'address': appraisal.address,
        'bedrooms': appraisal.bedrooms,
        'bathrooms': appraisal.bathrooms,
        'property_type': appraisal.property_type,
        'land_size': appraisal.land_size,
        'floor_area': appraisal.floor_area,
        'condition': appraisal.condition,
        'features': appraisal.features,
        'status': appraisal.status,
        'date_created': appraisal.date_created.isoformat() if appraisal.date_created else None,
        'user_id': appraisal.user_id
    }

    comparable_data = []
    for prop in comparable_properties:
        comparable_data.append({
            'id': prop.id,
            'address': prop.address,
            'postcode': prop.postcode,
            'bedrooms': prop.bedrooms,
            'bathrooms': prop.bathrooms,
            'floor_area': prop.floor_area,
            'image_url': prop.image_url,
            'price': prop.price,
            'square_feet': prop.square_feet,
            'days_on_market': prop.days_on_market,
            'distance_to': prop.distance_to,
            'location_adjustment': prop.location_adjustment,
            'size_adjustment': prop.size_adjustment,
            'market_adjustment': prop.market_adjustment,
            'adjusted_value': prop.adjusted_value,
            'appraisal_id': prop.appraisal_id
        })

    chat_data = []
    for msg in chat_messages:
        chat_data.append({
            'id': msg.id,
            'content': msg.content,
            'is_user': msg.is_user,
            'timestamp': msg.timestamp.isoformat() if msg.timestamp else None,
            'appraisal_id': msg.appraisal_id
        })

    return jsonify({
        'appraisal': appraisal_data,
        'comparable_properties': comparable_data,
        'chat_messages': chat_data
    })


# API endpoint for chat messages
@views.route('/api/appraisal/<int:id>/chat', methods=['POST'])
@login_required
def api_chat(id):
    appraisal = Appraisal.query.get_or_404(id)
    if appraisal.user_id != current_user.id:
        return jsonify({'error': 'You do not have permission to access this appraisal.'}), 403

    data = request.get_json()
    message_content = data.get('message')

    if not message_content:
        return jsonify({'error': 'Message content is required.'}), 400

    # Save user message
    new_message = ChatMessage(
        content=message_content,
        is_user=True,
        appraisal_id=appraisal.id,
        timestamp=datetime.utcnow()
    )
    db.session.add(new_message)
    db.session.commit()
    
    # Generate AI response (placeholder for now)
    ai_response = ChatMessage(
        content="I've received your message and will analyze the property details. Please give me a moment to process this information.",
        is_user=False,
        appraisal_id=appraisal.id,
        timestamp=datetime.utcnow()
    )
    db.session.add(ai_response)
    db.session.commit()

    return jsonify({
        'success': True,
        'ai_response': ai_response.content,
        'message_id': new_message.id
    })

@views.route('/dashboard')
@login_required
def dashboard():
    return render_template("dashboard.html", user=current_user)

@views.route('/api/files', methods=['GET'])
@login_required
def get_files():
    """
    Alias for /api/documents - TypeScript frontend compatibility.
    Fetches all documents associated with the current user's business from Supabase.
    """
    business_uuid_str = _ensure_business_uuid()
    if not business_uuid_str:
        return jsonify({'error': 'User is not associated with a business'}), 400

    try:
        # Use Supabase document service
        doc_service = SupabaseDocumentService()
        documents = doc_service.get_documents_for_business(business_uuid_str)
        
        return jsonify({
            'success': True,
            'data': documents
        })
    except Exception as e:
        logger.error(f"Error fetching documents from Supabase: {e}")
        return jsonify({'error': str(e)}), 500

@views.route('/api/document/<uuid:document_id>', methods=['DELETE'])
@login_required
def delete_document(document_id):
    """
    Legacy deletion endpoint (backward compatibility).
    Use /api/documents/<uuid:document_id> instead for consistency.
    """
    return _perform_document_deletion(document_id)

@views.route('/api/files/<uuid:file_id>', methods=['DELETE', 'OPTIONS'])
def delete_file(file_id):
    """
    Alias for /api/documents/<uuid:document_id> DELETE - TypeScript frontend compatibility.
    Deletes a document from S3, Supabase stores, and its metadata record from the database.
    """
    if request.method == 'OPTIONS':
        # Handle CORS preflight - no auth needed
        return '', 200
    
    # Apply login_required check for actual DELETE
    if not current_user.is_authenticated:
        return jsonify({'error': 'Unauthorized'}), 401
    
    return _perform_document_deletion(file_id)

def _perform_document_deletion(document_id):
    """
    Centralized document deletion logic.
    Uses UnifiedDeletionService for complete deletion from S3, Supabase, and all related data stores.
    
    Args:
        document_id: UUID of the document to delete
        
    Returns:
        Flask Response with deletion results
    """
    # Authentication and authorization checks
    company_name = getattr(current_user, "company_name", None)
    if not company_name:
        logger.warning("Current user has no company_name; denying delete request.")
        return jsonify({'error': 'Unauthorized'}), 403

    user_business_uuid = _ensure_business_uuid()
    if not user_business_uuid:
        logger.warning("Current user has no business UUID; denying delete request.")
        return jsonify({'error': 'Unauthorized'}), 403

    # Get document from Supabase to verify ownership and get S3 path
    from .services.document_storage_service import DocumentStorageService
    doc_storage = DocumentStorageService()
    success, document_data, error = doc_storage.get_document(str(document_id), company_name)
    
    if not success:
        if error == "Document not found":
            return jsonify({'error': 'Document not found'}), 404
        return jsonify({'error': f'Failed to retrieve document: {error}'}), 500
    
    # Extract document fields and verify ownership
    s3_path = document_data.get('s3_path')
    original_filename = document_data.get('original_filename')
    document_business_uuid = _normalize_uuid_str(document_data.get('business_uuid'))
    
    if not document_business_uuid or document_business_uuid != user_business_uuid:
        logger.warning(
            "Document business mismatch (doc=%s, user=%s). Denying deletion.",
            document_business_uuid,
            user_business_uuid,
        )
        return jsonify({'error': 'Unauthorized'}), 403

    if not s3_path:
        logger.error(f"Document {document_id} missing s3_path")
        return jsonify({'error': 'Document missing S3 path'}), 400
    
    logger.info(f"🗑️ DELETE document {document_id} ({original_filename}) by {current_user.email}")
    
    # Use UnifiedDeletionService for all deletion operations
    from .services.unified_deletion_service import UnifiedDeletionService
    deletion_service = UnifiedDeletionService()
    
    result = deletion_service.delete_document_complete(
        document_id=str(document_id),
        business_id=document_business_uuid,
        s3_path=s3_path,
        delete_s3=True,
        recompute_properties=True,
        cleanup_orphans=True
    )
    
    # Build response
    response_data = result.to_dict()
    response_data['document_id'] = str(document_id)
    response_data['results'] = result.operations  # For backwards compatibility
    
    return jsonify(response_data), result.http_status

@views.route('/api/upload-file', methods=['POST'])
@login_required
def upload_file_to_gateway():
    """
    Handles file upload by proxying to API Gateway. This function also creates a
    Document record in the database and triggers a background task to process it.
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    # 1. Get AWS and API Gateway configuration from environment
    try:
        aws_access_key = os.environ['AWS_ACCESS_KEY_ID']
        aws_secret_key = os.environ['AWS_SECRET_ACCESS_KEY']
        aws_region = os.environ.get('AWS_REGION') or os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
        invoke_url = os.environ['API_GATEWAY_INVOKE_URL']
        bucket_name = os.environ['S3_UPLOAD_BUCKET']
    except KeyError as e:
        error_message = f"Missing environment variable: {e}"
        print(error_message, file=sys.stderr)
        return jsonify({'error': 'Server is not configured for file uploads.'}), 500

    # 2. Prepare file and S3 key
    filename = secure_filename(file.filename)
    # Generate a unique path for the file in S3 to avoid collisions
    s3_key = f"{current_user.company_name}/{uuid.uuid4()}/{filename}"
    
    # 2.5. Check for duplicate documents
    business_uuid_str = _ensure_business_uuid()
    if not business_uuid_str:
        return jsonify({'error': 'User is not associated with a business'}), 400
    business_uuid = UUID(business_uuid_str)
    
    existing_document = Document.query.filter_by(
        original_filename=filename,
        business_id=business_uuid
    ).first()

    if existing_document:
        return jsonify({
            'error': f'A document with the filename "{filename}" already exists in your account. Please rename the file or delete the existing document first.',
            'existing_document_id': str(existing_document.id)
        }), 409  # 409 Conflict
    
    # 3. Create and save the Document record BEFORE uploading
    try:
        if not current_user.business_id:
            raise ValueError("User is not associated with a business UUID")

        new_document = Document(
            original_filename=filename,
            s3_path=s3_key,
            file_type=file.mimetype,
            file_size=file.content_length,
            uploaded_by_user_id=current_user.id,
            business_id=business_uuid
        )
        db.session.add(new_document)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        print(f"Database error: {e}", file=sys.stderr)
        return jsonify({'error': 'Failed to create document record in database.'}), 500

    # 4. Sign and send the request to API Gateway
    try:
        # The URL for API Gateway should be structured to accept the bucket and key
        final_url = f"{invoke_url.rstrip('/')}/{bucket_name}/{s3_key}"
        
        # AWS V4 signing for the request
        auth = AWS4Auth(aws_access_key, aws_secret_key, aws_region, 's3')
        
        # Read file content once
        file_content = file.read()
        
        # Make the PUT request
        response = requests.put(final_url, data=file_content, auth=auth)
        response.raise_for_status() # Raise an exception for bad status codes

    except requests.exceptions.RequestException as e:
        # If the upload fails, we should delete the record we created
        db.session.delete(new_document)
        db.session.commit()
        print(f"Failed to upload file to S3 via API Gateway: {e}", file=sys.stderr)
        return jsonify({'error': 'Failed to upload file.'}), 502

    # 5. On successful upload, trigger the background processing task.
    # We now pass the file content directly to the task to ensure it is not
    # corrupted, while the file remains stored in S3.
    process_document_task.delay(
        document_id=new_document.id,
        file_content=file_content, 
        original_filename=filename, 
        business_id=business_uuid_str
    )

    # 6. Return the data of the newly created document to the client
    return jsonify(new_document.serialize()), 201

@views.route('/test-celery')
def test_celery():
    """A simple route to test if Celery is working."""
    from .tasks import process_document_task
    # This is a placeholder task, you might want to create a simpler task for testing
    # For now, we can try to trigger the document processing with a fake ID
    # In a real scenario, you'd have a test task that doesn't depend on a database object
    task = process_document_task.delay(1) # Using a fake document ID
    return jsonify({"message": "Test task sent to Celery!", "task_id": task.id})

@views.route('/api/process-document/<uuid:document_id>', methods=['POST'])
@login_required
def process_document(document_id):
    """
    Manually trigger processing of an existing document.
    """
    document = Document.query.get(document_id)
    if not document:
        return jsonify({'error': 'Document not found'}), 404
    
    if str(document.business_id) != str(current_user.business_id):
        return jsonify({'error': 'Unauthorized'}), 403
    
    if document.status == 'COMPLETED':
        return jsonify({'error': 'Document already processed'}), 400
    
    # Get file content from S3
    try:
        aws_access_key = os.environ['AWS_ACCESS_KEY_ID']
        aws_secret_key = os.environ['AWS_SECRET_ACCESS_KEY']
        aws_region = os.environ.get('AWS_REGION') or os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
        invoke_url = os.environ['API_GATEWAY_INVOKE_URL']
        bucket_name = os.environ['S3_UPLOAD_BUCKET']
        
        # Download file from S3
        final_url = f"{invoke_url.rstrip('/')}/{bucket_name}/{document.s3_path}"
        auth = AWS4Auth(aws_access_key, aws_secret_key, aws_region, 's3')
        response = requests.get(final_url, auth=auth)
        response.raise_for_status()
        file_content = response.content
        
    except Exception as e:
        return jsonify({'error': f'Failed to download file: {str(e)}'}), 500
    
    # Trigger processing task
    try:
        task = process_document_task.delay(
            document_id=document.id,
            file_content=file_content,
            original_filename=document.original_filename,
            business_id=document.business_id
        )
        
        return jsonify({
            'message': 'Document processing started',
            'task_id': task.id,
            'document_id': str(document_id)
        })
        
    except Exception as e:
        return jsonify({'error': f'Failed to start processing: {str(e)}'}), 500

# ============================================================================
# PROPERTY LINKING ENDPOINTS (Additional endpoints for property node management)
# ============================================================================

@views.route('/api/property-nodes/statistics', methods=['GET'])
@login_required
def get_property_node_statistics():
    """Get property node statistics for the current business"""
    try:
        from .services.property_linking_service import PropertyLinkingService
        
        linking_service = PropertyLinkingService()
        stats = linking_service.get_property_statistics(current_user.company_name)
        
        return jsonify({
            'success': True,
            'data': stats
        }), 200
    except Exception as e:
        logger.error(f"Error getting property statistics: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ============================================================================
# PROPERTY HUB API ENDPOINTS (Day 5 Implementation)
# ============================================================================

@views.route('/api/property-hub/<uuid:property_id>', methods=['GET'])
@login_required
def get_property_hub(property_id):
    """Get complete property hub with all related data"""
    try:
        from .services.supabase_property_hub_service import SupabasePropertyHubService
        
        # Validate business access
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({
                'success': False,
                'error': 'User not associated with a business'
            }), 400
        
        property_hub_service = SupabasePropertyHubService()
        property_hub = property_hub_service.get_property_hub(str(property_id), business_uuid_str)
        
        if not property_hub:
            return jsonify({
                'success': False,
                'error': 'Property hub not found'
            }), 404
        
        return jsonify({
            'success': True,
            'data': property_hub,
            'metadata': {
                'property_id': str(property_id),
                'business_id': business_uuid_str,
                'timestamp': datetime.utcnow().isoformat(),
                'completeness_score': property_hub.get('summary', {}).get('completeness_score', 0.0)
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting property hub {property_id}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/property-hub', methods=['GET'])
@login_required
def get_all_property_hubs():
    """Get all property hubs for current business"""
    try:
        from .services.supabase_property_hub_service import SupabasePropertyHubService
        from .services.response_formatter import APIResponseFormatter
        from .services.performance_service import performance_service, track_performance
        
        # Validate business access
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify(APIResponseFormatter.format_error_response(
                'User not associated with a business',
                'BUSINESS_REQUIRED'
            )), 400
        
        # Get query parameters
        limit = request.args.get('limit', 100, type=int)
        offset = request.args.get('offset', 0, type=int)
        sort_by = request.args.get('sort_by', 'created_at')  # created_at, completeness_score, formatted_address
        sort_order = request.args.get('sort_order', 'desc')  # asc, desc
        
        # Log sorting parameters for debugging
        logger.info(f"📊 Property hubs request - sort_by: {sort_by}, sort_order: {sort_order}, limit: {limit}, offset: {offset}")
        
        # Track performance
        start_time = time.time()
        
        # OPTIMIZATION: Use OptimizedSupabasePropertyHubService to eliminate N+1 queries
        # This reduces queries from 25+ (N+1) to just 4 batch queries (100x faster)
        from .services.optimized_property_hub_service import OptimizedSupabasePropertyHubService
        
        optimized_service = OptimizedSupabasePropertyHubService()
        property_hubs = optimized_service.get_all_property_hubs_optimized(
            business_uuid_str,
            limit=limit,
            offset=offset,
            sort_by=sort_by,
            sort_order=sort_order
        )
        
        # Calculate pagination info
        total_count = len(property_hubs)  # This is approximate since we're not getting total count
        pages = (total_count + limit - 1) // limit if limit > 0 else 1
        current_page = (offset // limit) + 1 if limit > 0 else 1
        
        pagination_data = {
            'page': current_page,
            'limit': limit,
            'total': total_count,
            'pages': pages,
            'has_next': offset + limit < total_count,
            'has_prev': offset > 0
        }
        
        # Track performance
        duration = time.time() - start_time
        performance_service.track_api_call(
            request.endpoint or 'get_all_property_hubs',
            request.method,
            duration,
            200,
            str(current_user.id) if current_user else None
        )
        
        # Use response formatter
        return jsonify(APIResponseFormatter.format_property_hubs_response(
            property_hubs, pagination_data
        )), 200
        
    except Exception as e:
        logger.error(f"Error getting all property hubs: {e}")
        
        # Track error performance
        try:
            duration = time.time() - start_time
            performance_service.track_api_call(
                request.endpoint or 'get_all_property_hubs',
                request.method,
                duration,
                500,
                str(current_user.id) if current_user else None
            )
        except:
            pass
        
        return jsonify(APIResponseFormatter.format_error_response(
            str(e),
            'INTERNAL_ERROR',
            500
        )), 500

@views.route('/api/property-hub/search', methods=['POST'])
@login_required
def search_property_hubs():
    """Search property hubs with advanced filters"""
    try:
        from .services.supabase_property_hub_service import SupabasePropertyHubService
        
        # Validate business access
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({
                'success': False,
                'error': 'User not associated with a business'
            }), 400
        
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'error': 'Request body is required'
            }), 400
        
        # Extract search parameters
        query = data.get('query', '')
        filters = data.get('filters', {})
        limit = data.get('limit', 50)
        offset = data.get('offset', 0)
        
        property_hub_service = SupabasePropertyHubService()
        results = property_hub_service.search_property_hubs(
            business_id=business_uuid_str,
            query=query,
            filters=filters,
            limit=limit,
            offset=offset
        )
        
        return jsonify({
            'success': True,
            'data': results,
            'metadata': {
                'count': len(results),
                'business_id': business_uuid_str,
                'timestamp': datetime.utcnow().isoformat(),
                'search_params': {
                    'query': query,
                    'filters': filters,
                    'limit': limit,
                    'offset': offset
                }
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error searching property hubs: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/properties/pins', methods=['GET', 'OPTIONS'])
def get_property_pins():
    # Handle CORS preflight - must be before @login_required
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET, OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200
    
    # Require login for actual GET request
    if not current_user.is_authenticated:
        return jsonify({'success': False, 'error': 'Authentication required'}), 401
    
    """Get lightweight property pin data (id, address, lat, lng) for map markers"""
    try:
        from .services.supabase_client_factory import get_supabase_client
        
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({
                'success': False,
                'error': 'User not associated with a business'
            }), 400
        
        supabase = get_supabase_client()
        
        # Single batch query - only fetch what's needed for pins
        properties_result = (
            supabase.table('properties')
            .select('id, formatted_address, latitude, longitude')
            .eq('business_uuid', business_uuid_str)
            .execute()
        )
        
        pins = []
        if properties_result.data:
            for prop in properties_result.data:
                pins.append({
                    'id': prop.get('id'),
                    'address': prop.get('formatted_address', ''),
                    'latitude': prop.get('latitude'),
                    'longitude': prop.get('longitude')
                })
        
        return jsonify({
            'success': True,
            'data': pins
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting property pins: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/properties/card-summary/<uuid:property_id>', methods=['GET', 'OPTIONS'])
def get_property_card_summary(property_id):
    # Handle CORS preflight - must be before @login_required
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET, OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200
    
    # Require login for actual GET request
    if not current_user.is_authenticated:
        return jsonify({'success': False, 'error': 'Authentication required'}), 401
    
    """Get property card summary data (everything needed for card display, no documents)"""
    # Wrap entire function in try-except to catch any database errors
    try:
        from .services.supabase_client_factory import get_supabase_client
        from concurrent.futures import ThreadPoolExecutor, as_completed
        
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({
                'success': False,
                'error': 'User not associated with a business'
            }), 400
        
        # OPTIMIZATION: Use cache by default (only bypass when explicitly requested)
        use_cache = request.args.get('use_cache', 'true').lower() == 'true'
        property_id_str = str(property_id)
        
        # Check cache first if requested (now default behavior)
        # Gracefully handle missing cache table - use db.session.execute with error handling
        cache_entry = None
        if use_cache:
            try:
                # Use db.session.query() for better error handling
                # Wrap in try-except to catch any database errors
                cache_entry = db.session.query(PropertyCardCache).filter_by(property_id=property_id).first()
                if cache_entry:
                    return jsonify({
                        'success': True,
                        'data': cache_entry.card_data,
                        'cached': True,
                        'cache_version': cache_entry.cache_version,
                        'updated_at': cache_entry.updated_at.isoformat() if cache_entry.updated_at else None
                    }), 200
            except Exception as cache_error:
                # Catch ALL exceptions - psycopg2 errors, SQLAlchemy errors, etc.
                # This ensures we never fail the request due to missing cache table
                error_str = str(cache_error).lower()
                error_type = type(cache_error).__name__.lower()
                
                # Check if it's a table-not-exist error (multiple patterns)
                is_table_missing = (
                    'property_card_cache' in error_str or 
                    'does not exist' in error_str or 
                    'undefinedtable' in error_str or
                    ('relation' in error_str and 'does not exist' in error_str) or
                    'programmingerror' in error_type or
                    'operationalerror' in error_type or
                    'databaseerror' in error_type or
                    'psycopg2' in error_type
                )
                
                if is_table_missing:
                    # Table doesn't exist - this is expected in some environments
                    # Log at debug level and disable cache for this request
                    logger.debug(f"Cache table not available (expected): {type(cache_error).__name__}")
                    use_cache = False  # Disable cache for rest of this request
                else:
                    # Other cache error - log but continue
                    logger.debug(f"Cache lookup failed: {type(cache_error).__name__}: {str(cache_error)[:200]}")
                
                # Rollback any partial transaction
                try:
                    db.session.rollback()
                except:
                    pass
                
                cache_entry = None  # Ensure it's None if query failed
                # Continue to fetch data without cache - don't raise the exception
                pass  # Explicitly do nothing - just continue
        
        supabase = get_supabase_client()
        
        # OPTIMIZATION: Execute queries in parallel using ThreadPoolExecutor
        # This reduces total latency from sum of queries to max of queries
        def fetch_property():
            return (
                supabase.table('properties')
                .select('id, formatted_address, latitude, longitude, geocoding_status')
                .eq('id', property_id_str)
                .eq('business_uuid', business_uuid_str)
                .execute()
            )
        
        def fetch_property_details():
            return (
                supabase.table('property_details')
                .select('*')
                .eq('property_id', property_id_str)
                .execute()
            )
        
        def fetch_document_count():
            return (
                supabase.table('document_relationships')
                .select('id', count='exact')
                .eq('property_id', property_id_str)
                .execute()
            )
        
        # Execute all queries in parallel
        with ThreadPoolExecutor(max_workers=3) as executor:
            property_future = executor.submit(fetch_property)
            details_future = executor.submit(fetch_property_details)
            doc_count_future = executor.submit(fetch_document_count)
            
            property_result = property_future.result()
            details_result = details_future.result()
            doc_count_result = doc_count_future.result()
        
        if not property_result.data:
            return jsonify({
                'success': False,
                'error': 'Property not found'
            }), 404
        
        property_data = property_result.data[0]
        property_details = details_result.data[0] if details_result.data else {}
        document_count = doc_count_result.count if doc_count_result.count else 0
        
        # OPTIMIZATION: Only query for image if primary_image_url doesn't exist
        # Skip the document_relationships query entirely if we have an image
        primary_image_url = property_details.get('primary_image_url')
        # Removed unnecessary image query - if primary_image_url exists, we're done
        # If it doesn't exist, we'll leave it as None (no need to query documents)
        
        # Calculate yield percentage
        rent_pcm = property_details.get('rent_pcm') or 0
        sold_price = property_details.get('sold_price') or 0
        asking_price = property_details.get('asking_price') or 0
        price = sold_price or asking_price
        yield_percentage = None
        if rent_pcm > 0 and price > 0:
            annual_rent = rent_pcm * 12
            yield_percentage = round((annual_rent / price) * 100, 1)
        
        # Build card summary data
        # geocoding_status: 'manual' indicates user-set pin location (final coordinates from Create Property Card confirmation)
        card_data = {
            'id': property_data.get('id'),
            'address': property_data.get('formatted_address', ''),
            'latitude': property_data.get('latitude'),
            'longitude': property_data.get('longitude'),
            'geocoding_status': property_data.get('geocoding_status'),  # Include geocoding_status to identify user-set pin locations
            'primary_image_url': primary_image_url,
            'property_type': property_details.get('property_type'),
            'tenure': property_details.get('tenure'),
            'number_bedrooms': property_details.get('number_bedrooms') or 0,
            'number_bathrooms': property_details.get('number_bathrooms') or 0,
            'epc_rating': property_details.get('epc_rating'),
            'document_count': document_count,
            'rent_pcm': rent_pcm,
            'sold_price': sold_price,
            'asking_price': asking_price,
            'yield_percentage': yield_percentage,
            'summary_text': property_details.get('notes', ''),
            'last_transaction_date': property_details.get('last_transaction_date')
        }
        
        # OPTIMIZATION: Lazy cache write - only write if data actually changed
        # Gracefully handle missing cache table
        try:
            # Use a fresh session to avoid transaction issues
            cache_entry = None
            should_update_cache = False
            
            try:
                cache_entry = db.session.query(PropertyCardCache).filter_by(property_id=property_id).first()
            except (OperationalError, ProgrammingError, DatabaseError) as query_error:
                # If query fails due to missing table or database error, cache_entry remains None
                error_str = str(query_error)
                if 'property_card_cache' in error_str.lower() or 'does not exist' in error_str.lower() or 'undefinedtable' in error_str.lower():
                    logger.debug(f"Cache table not available (expected in some environments): {query_error}")
                else:
                    logger.debug(f"Cache query failed (database error): {query_error}")
                cache_entry = None
            except Exception as query_error:
                # Catch any other unexpected errors
                logger.debug(f"Cache query failed (unexpected error): {query_error}")
                cache_entry = None
            if cache_entry:
                # Compare existing cache with new data to avoid unnecessary writes
                existing_data = cache_entry.card_data
                # Convert both to JSON strings for comparison (handles nested dicts)
                existing_json = json.dumps(existing_data, sort_keys=True) if existing_data else None
                new_json = json.dumps(card_data, sort_keys=True)
                
                if existing_json != new_json:
                    # Data changed - update cache
                    cache_entry.card_data = card_data
                    cache_entry.cache_version += 1
                    cache_entry.updated_at = datetime.utcnow()
                    should_update_cache = True
                # If data unchanged, skip the write operation
            else:
                # No cache entry exists - create one
                try:
                    cache_entry = PropertyCardCache(
                        property_id=property_id,
                        card_data=card_data,
                        cache_version=1
                    )
                    db.session.add(cache_entry)
                    should_update_cache = True
                except Exception as create_error:
                    logger.debug(f"Cache entry creation failed: {create_error}")
                    should_update_cache = False
            
            # Only commit if we need to update the cache
            if should_update_cache:
                try:
                    db.session.commit()
                    logger.debug(f"Property card cache updated for property {property_id}")
                except Exception as commit_error:
                    db.session.rollback()
                    logger.warning(f"Failed to update property card cache: {commit_error}")
        except Exception as cache_error:
            # Cache table doesn't exist - skip caching but continue with response
            logger.debug(f"Cache operations skipped (table may not exist): {cache_error}")
            db.session.rollback()  # Ensure transaction is rolled back
        
        return jsonify({
            'success': True,
            'data': card_data,
            'cached': False,
            'cache_version': cache_entry.cache_version if cache_entry else 1
        }), 200
        
    except Exception as e:
        # Check if this is a cache-related error that we should handle gracefully
        error_str = str(e).lower()
        error_type = type(e).__name__.lower()
        is_cache_error = (
            'property_card_cache' in error_str or 
            'does not exist' in error_str or 
            'undefinedtable' in error_str or
            ('relation' in error_str and 'does not exist' in error_str) or
            'programmingerror' in error_type or
            'operationalerror' in error_type
        )
        
        if is_cache_error:
            # Cache error - log at debug level and continue without cache
            logger.debug(f"Cache error in property card summary (non-fatal): {type(e).__name__}")
            # Try to return data without cache - but we need to fetch it first
            # For now, return a generic error but don't log as critical
            return jsonify({
                'success': False,
                'error': 'Cache unavailable, please try again',
                'cache_error': True
            }), 503  # Service Unavailable, not 500 Internal Server Error
        else:
            # Real error - log and return 500
            logger.error(f"Error getting property card summary {property_id}: {e}")
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500

@views.route('/api/properties/<uuid:property_id>/update-name', methods=['PUT', 'OPTIONS'])
@login_required
def update_property_name(property_id):
    """Update the custom display name for a property"""
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'PUT, OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200
    
    try:
        data = request.get_json()
        custom_name = data.get('custom_name', '').strip()
        
        if not custom_name:
            return jsonify({
                'success': False,
                'error': 'custom_name is required'
            }), 400
        
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({
                'success': False,
                'error': 'User not associated with a business'
            }), 400
        
        # Get property and verify business access
        # Property is already imported at the top of the file
        property = Property.query.get_or_404(property_id)
        
        if str(property.business_id) != business_uuid_str:
            return jsonify({
                'success': False,
                'error': 'Unauthorized'
            }), 403
        
        # Update property details with custom name in metadata
        # Store in PropertyDetails metadata or other_amenities as JSON
        property_details = PropertyDetails.query.filter_by(property_id=property_id).first()
        
        if property_details:
            # Store custom name in other_amenities as JSON if it's not already JSON
            # Or we could add a metadata field, but for now use other_amenities
            try:
                # Try to parse existing other_amenities as JSON
                if property_details.other_amenities:
                    try:
                        amenities_data = json.loads(property_details.other_amenities) if isinstance(property_details.other_amenities, str) else property_details.other_amenities
                        if not isinstance(amenities_data, dict):
                            amenities_data = {}
                    except:
                        amenities_data = {}
                else:
                    amenities_data = {}
                
                amenities_data['custom_name'] = custom_name
                property_details.other_amenities = json.dumps(amenities_data)
                property_details.updated_at = datetime.utcnow()
            except Exception as e:
                logger.warning(f"Error updating property name in metadata: {e}")
                # Fallback: store as simple string in other_amenities
                property_details.other_amenities = json.dumps({'custom_name': custom_name})
        else:
            # Create PropertyDetails if it doesn't exist
            property_details = PropertyDetails(
                property_id=property_id,
                other_amenities=json.dumps({'custom_name': custom_name})
            )
            db.session.add(property_details)
        
        # Also update formatted_address to include custom name for backward compatibility
        # Keep the original address but prepend custom name if different
        if property.formatted_address and custom_name.lower() not in property.formatted_address.lower():
            # Don't overwrite, just store custom name separately
            pass
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Property name updated successfully',
            'data': {
                'property_id': str(property_id),
                'custom_name': custom_name
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error updating property name: {e}")
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/properties/<uuid:property_id>/update-details', methods=['PUT', 'OPTIONS'])
@login_required
def update_property_details(property_id):
    """Update property details fields"""
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'PUT, OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200
    
    try:
        data = request.get_json()
        updates = data.get('updates', {})
        
        if not updates:
            return jsonify({
                'success': False,
                'error': 'updates object is required'
            }), 400
        
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({
                'success': False,
                'error': 'User not associated with a business'
            }), 400
        
        # Get property and verify business access
        # Property is already imported at the top of the file
        property = Property.query.get_or_404(property_id)
        
        if str(property.business_id) != business_uuid_str:
            return jsonify({
                'success': False,
                'error': 'Unauthorized'
            }), 403
        
        # Get Supabase client
        from .services.supabase_client_factory import get_supabase_client
        supabase = get_supabase_client()
        
        # Validate and prepare update data
        allowed_fields = {
            'number_bedrooms': int,
            'number_bathrooms': int,
            'size_sqft': float,
            'asking_price': float,
            'sold_price': float,
            'rent_pcm': float,
            'tenure': str,
            'epc_rating': str,
            'condition': str,
            'other_amenities': str,
            'notes': str
        }
        
        update_data = {}
        for field, value in updates.items():
            if field not in allowed_fields:
                continue
            
            # Handle None/empty values - set to None for database
            if value is None or value == '':
                update_data[field] = None
            else:
                # Type conversion and validation
                field_type = allowed_fields[field]
                try:
                    if field_type == int:
                        parsed_value = int(float(str(value)))  # Handle "5.0" -> 5
                        if parsed_value < 0:
                            continue  # Skip negative values
                        update_data[field] = parsed_value
                    elif field_type == float:
                        parsed_value = float(str(value))
                        if parsed_value < 0:
                            continue  # Skip negative values
                        update_data[field] = parsed_value
                    else:  # str
                        update_data[field] = str(value).strip()
                except (ValueError, TypeError):
                    # Skip invalid values
                    continue
        
        if not update_data:
            return jsonify({
                'success': False,
                'error': 'No valid fields to update'
            }), 400
        
        # Add timestamp
        from datetime import datetime
        update_data['updated_at'] = datetime.utcnow().isoformat()
        
        # Check if property_details exists
        logger.info(f"Updating property details for property_id: {property_id}, updates: {update_data}")
        existing_result = supabase.table('property_details').select('*').eq('property_id', str(property_id)).execute()
        
        logger.info(f"Existing property_details check result: {existing_result.data}")
        
        if existing_result.data and len(existing_result.data) > 0:
            # Update existing
            logger.info(f"Updating existing property_details with data: {update_data}")
            result = supabase.table('property_details').update(update_data).eq('property_id', str(property_id)).execute()
            logger.info(f"Update result: {result.data}")
            if result.data and len(result.data) > 0:
                return jsonify({
                    'success': True,
                    'message': 'Property details updated successfully',
                    'data': result.data[0]
                }), 200
            else:
                logger.error(f"Update returned no data: {result}")
                return jsonify({
                    'success': False,
                    'error': 'Failed to update property details - no data returned'
                }), 500
        else:
            # Create new property_details record
            logger.info(f"Creating new property_details record")
            create_data = {
                'property_id': str(property_id),
                'business_uuid': business_uuid_str,
                **update_data
            }
            result = supabase.table('property_details').insert(create_data).execute()
            logger.info(f"Insert result: {result.data}")
            if result.data and len(result.data) > 0:
                return jsonify({
                    'success': True,
                    'message': 'Property details created successfully',
                    'data': result.data[0]
                }), 200
            else:
                logger.error(f"Insert returned no data: {result}")
                return jsonify({
                    'success': False,
                    'error': 'Failed to create property details - no data returned'
                }), 500
        
    except Exception as e:
        logger.error(f"Error updating property details: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/properties/create', methods=['POST', 'OPTIONS'])
@login_required
def create_property():
    """Create a new property with location (without documents initially)"""
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200
    
    try:
        data = request.get_json()
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({
                'success': False,
                'error': 'User not associated with a business'
            }), 400
        
        # Validate required fields
        if not data.get('latitude') or not data.get('longitude'):
            return jsonify({
                'success': False,
                'error': 'Location required (latitude and longitude)'
            }), 400
        
        # Create property using existing service
        from .services.supabase_property_hub_service import SupabasePropertyHubService
        import hashlib
        
        service = SupabasePropertyHubService()
        
        # Normalize address
        address = data.get('address', '')
        normalized_address = data.get('normalized_address', address.lower() if address else '')
        formatted_address = data.get('formatted_address', address)
        address_hash = hashlib.sha256(normalized_address.encode()).hexdigest()
        
        # User-set pin location from property creation workflow - this is the authoritative property location
        # (final coordinates selected when user clicked Create Property Card)
        # Property pin location is set once during property creation and remains fixed
        address_data = {
            'address_hash': address_hash,
            'normalized_address': normalized_address,
            'formatted_address': formatted_address,
            'latitude': float(data['latitude']),
            'longitude': float(data['longitude']),
            'geocoding_status': 'manual',  # User-set pin location (authoritative - final selection from Create Property Card)
            'geocoding_confidence': 1.0
        }
        
        property_id = str(uuid.uuid4())
        property_data = service._create_supabase_property(property_id, address_data, business_uuid_str)
        
        # Create property_details record in Supabase (required for property hub)
        try:
            from datetime import datetime
            property_details_data = {
                'property_id': property_id,
                'property_address': formatted_address,
                'normalized_address': normalized_address,
                'address_hash': address_hash,
                'address_source': 'manual_creation',
                'latitude': float(data['latitude']),
                'longitude': float(data['longitude']),
                'geocoded_address': formatted_address,
                'geocoding_status': 'manual',
                'geocoding_confidence': 1.0,
                'business_uuid': business_uuid_str,
                'created_at': datetime.utcnow().isoformat(),
                'updated_at': datetime.utcnow().isoformat()
            }
            result = service.supabase.table('property_details').insert(property_details_data).execute()
            if result.data:
                logger.info(f"✅ Created property_details for property {property_id}")
            else:
                logger.warning(f"⚠️ Failed to create property_details for property {property_id}")
        except Exception as details_error:
            logger.warning(f"⚠️ Failed to create property_details (non-fatal): {details_error}")
        
        return jsonify({
            'success': True,
            'data': {
                'property_id': property_id,
                'property': property_data
            }
        }), 201
        
    except Exception as e:
        logger.error(f"Error creating property: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/documents/<uuid:document_id>/extract-address', methods=['POST', 'OPTIONS'])
@login_required
def extract_address_from_document(document_id):
    """Extract address from uploaded document (quick extraction)"""
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200
    
    try:
        # Verify business access first
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({
                'success': False,
                'error': 'User is not associated with a business'
            }), 400
        
        # Get document from Supabase (not local PostgreSQL)
        from .services.document_storage_service import DocumentStorageService
        doc_storage = DocumentStorageService()
        success, document_data, error = doc_storage.get_document(str(document_id), business_uuid_str)
        
        if not success:
            if error == "Document not found":
                return jsonify({
                    'success': False,
                    'error': 'Document not found'
                }), 404
            else:
                return jsonify({
                    'success': False,
                    'error': f'Failed to retrieve document: {error}'
                }), 500
        
        # Extract document fields
        s3_path = document_data.get('s3_path')
        original_filename = document_data.get('original_filename')
        
        if not s3_path or not original_filename:
            return jsonify({
                'success': False,
                'error': 'Document missing required fields (s3_path or original_filename)'
            }), 400
        
        # Get document text from S3 or use filename
        import boto3
        s3_client = boto3.client(
            's3',
            aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
            aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
            region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
        )
        
        # Try to get document text
        document_text = ''
        try:
            response = s3_client.get_object(
                Bucket=os.environ['S3_UPLOAD_BUCKET'],
                Key=s3_path
            )
            # For quick extraction, we'll use filename and basic text extraction
            # Full extraction would require processing the file
            document_text = response['Body'].read().decode('utf-8', errors='ignore')[:10000]  # First 10KB
        except Exception as e:
            logger.warning(f"Could not read document from S3 for address extraction: {e}")
        
        # PRIORITY 1: Try FilenameAddressService first (most reliable for filenames)
        from .services.filename_address_service import FilenameAddressService
        filename_service = FilenameAddressService()
        address = filename_service.extract_address_from_filename(original_filename)
        
        # PRIORITY 2: If filename extraction fails, try fallback extraction
        if not address:
            from .tasks import _fallback_text_extraction
            extracted_data = _fallback_text_extraction(document_text, original_filename)
            
            # Extract address from the properties array (correct return structure)
            if extracted_data.get('properties') and len(extracted_data['properties']) > 0:
                property_data = extracted_data['properties'][0]
                potential_address = property_data.get('property_address')
                
                # Validate address - reject obviously invalid ones
                if potential_address and potential_address != 'Address not found':
                    # Reject addresses that are too short or look like references
                    if len(potential_address) >= 10 and not potential_address.lower().startswith('xref'):
                        address = potential_address
        
        # PRIORITY 3: If still no address, try to extract from filename manually (for international addresses)
        if not address and original_filename:
            # Remove file extension
            name_without_ext = original_filename.rsplit('.', 1)[0] if '.' in original_filename else original_filename
            # Replace underscores and hyphens with spaces
            cleaned = name_without_ext.replace('_', ' ').replace('-', ' ').replace('.', ' ')
            # Remove common document prefixes and suffixes
            document_terms = ['particulars', 'valuation', 'report', 'appraisal', 'lease', 'contract', 'agreement', 'document']
            for term in document_terms:
                # Remove from start
                cleaned = re.sub(r'^' + re.escape(term) + r'\s+', '', cleaned, flags=re.IGNORECASE)
                # Remove from end
                cleaned = re.sub(r'\s+' + re.escape(term) + r'$', '', cleaned, flags=re.IGNORECASE)
            # Clean up whitespace
            cleaned = re.sub(r'\s+', ' ', cleaned).strip()
            # Validate it's a reasonable address (at least 10 chars, not just numbers)
            if len(cleaned) >= 10 and not cleaned.replace(' ', '').replace(',', '').isdigit():
                address = cleaned
                logger.info(f"✅ Extracted address from filename (manual): {address}")
        
        if address:
            return jsonify({
                'success': True,
                'data': address
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': 'No address found in document'
            }), 404
            
    except Exception as e:
        logger.error(f"Error extracting address from document: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/documents/<uuid:document_id>/link-property', methods=['PUT', 'OPTIONS'])
@login_required
def link_document_to_property(document_id):
    """Link an uploaded document to a property"""
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'PUT, OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200
    
    try:
        data = request.get_json()
        property_id = data.get('property_id')
        
        if not property_id:
            return jsonify({
                'success': False,
                'error': 'property_id required'
            }), 400
        
        # Get document
        document = Document.query.get_or_404(document_id)
        
        # Verify business access
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str or str(document.business_id) != business_uuid_str:
            return jsonify({
                'success': False,
                'error': 'Unauthorized'
            }), 403
        
        # Update document with property_id
        property_uuid = UUID(property_id)
        document.property_id = property_uuid
        db.session.commit()
        
        # Also create relationship in Supabase
        try:
            from .services.supabase_property_hub_service import SupabasePropertyHubService
            property_hub_service = SupabasePropertyHubService()
            
            relationship_data = {
                'id': str(uuid.uuid4()),
                'document_id': str(document_id),
                'property_id': property_id,
                'relationship_type': 'property_document',
                'address_source': 'manual_link',
                'confidence_score': 1.0,
                'relationship_metadata': {
                    'match_type': 'manual_link',
                    'matching_service': 'workflow',
                    'match_timestamp': datetime.utcnow().isoformat()
                },
                'created_at': datetime.utcnow().isoformat()
            }
            
            result = property_hub_service.supabase.table('document_relationships').insert(relationship_data).execute()
            if not result.data:
                logger.warning("Failed to create document relationship in Supabase")
        except Exception as rel_error:
            logger.warning(f"Failed to create Supabase relationship (non-fatal): {rel_error}")
        
        return jsonify({
            'success': True,
            'message': 'Document linked to property'
        }), 200
        
    except Exception as e:
        logger.error(f"Error linking document to property: {e}")
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/properties/<uuid:property_id>/documents', methods=['GET', 'OPTIONS'])
def get_property_documents_light(property_id):
    """Get lightweight document list for a property (only metadata, no full property hub)"""
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET, OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200
    
    # Require login for actual GET request
    if not current_user.is_authenticated:
        return jsonify({'success': False, 'error': 'Authentication required'}), 401
    
    try:
        from .services.supabase_client_factory import get_supabase_client
        from .services.optimized_property_hub_service import OptimizedSupabasePropertyHubService
        
        # Validate business access
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({
                'success': False,
                'error': 'User not associated with a business'
            }), 400
        
        property_id_str = str(property_id)
        supabase = get_supabase_client()
        
        # OPTIMIZATION: Use batch queries instead of N+1
        # 1. Get document relationships for this property (single query)
        relationships_result = (
            supabase.table('document_relationships')
            .select('document_id, relationship_type, confidence_score, created_at')
            .eq('property_id', property_id_str)
            .execute()
        )
        
        if not relationships_result.data:
            return jsonify({
                'success': True,
                'data': {
                    'property_id': property_id_str,
                    'documents': [],
                    'document_count': 0
                }
            }), 200
        
        # 2. Get all document IDs
        document_ids = [rel['document_id'] for rel in relationships_result.data]
        
        # 3. Batch fetch all documents (single query)
        optimized_service = OptimizedSupabasePropertyHubService()
        documents_map = optimized_service.get_documents_batch(document_ids)
        
        # 4. Combine documents with relationship data
        documents = []
        for rel in relationships_result.data:
            doc_id = rel['document_id']
            if doc_id in documents_map:
                doc = documents_map[doc_id].copy()
                doc['relationship_type'] = rel['relationship_type']
                doc['confidence_score'] = rel['confidence_score']
                doc['relationship_created_at'] = rel['created_at']
                documents.append(doc)
        
        return jsonify({
            'success': True,
            'data': {
                'property_id': property_id_str,
                'documents': documents,
                'document_count': len(documents)
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting property documents {property_id}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/property-hub/<uuid:property_id>/documents', methods=['GET'])
@login_required
def get_property_hub_documents(property_id):
    """Get all documents linked to a property hub (legacy endpoint - use /api/properties/<id>/documents instead)"""
    try:
        from .services.supabase_property_hub_service import SupabasePropertyHubService
        
        # Validate business access
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({
                'success': False,
                'error': 'User not associated with a business'
            }), 400
        
        property_hub_service = SupabasePropertyHubService()
        property_hub = property_hub_service.get_property_hub(str(property_id), business_uuid_str)
        
        if not property_hub:
            return jsonify({
                'success': False,
                'error': 'Property hub not found'
            }), 404
        
        # Extract documents from property hub
        documents = property_hub.get('documents', [])
        
        return jsonify({
            'success': True,
            'data': {
                'property_id': str(property_id),
                'property_address': property_hub.get('property', {}).get('formatted_address'),
                'documents': documents,
                'document_count': len(documents)
            },
            'metadata': {
                'property_id': str(property_id),
                'business_id': business_uuid_str,
                'timestamp': datetime.utcnow().isoformat()
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting property hub documents {property_id}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/files/presigned-download', methods=['GET'])
@login_required
def get_presigned_download_url():
    """Generate a presigned URL for direct S3 download (faster than proxying through backend)"""
    try:
        from .services.supabase_document_service import SupabaseDocumentService
        import boto3
        from botocore.exceptions import ClientError
        
        document_id = request.args.get('document_id')
        s3_path = request.args.get('s3_path')
        
        if not document_id and not s3_path:
            return jsonify({'error': 'Either document_id or s3_path is required'}), 400
        
        # If document_id is provided, fetch the document to get s3_path
        if document_id and not s3_path:
            doc_service = SupabaseDocumentService()
            document = doc_service.get_document_by_id(document_id)
            
            if not document:
                return jsonify({'error': 'Document not found'}), 404
            
            # Verify business access
            business_uuid_str = _ensure_business_uuid()
            if not business_uuid_str:
                return jsonify({'error': 'User not associated with a business'}), 400
            
            if str(document.get('business_uuid')) != business_uuid_str:
                return jsonify({'error': 'Unauthorized'}), 403
            
            s3_path = document.get('s3_path')
            if not s3_path:
                return jsonify({'error': 'Document has no s3_path'}), 404
            
            original_filename = document.get('original_filename', 'document')
            file_type = document.get('file_type', 'application/octet-stream')
        else:
            # If only s3_path is provided, we still need to verify access
            # For now, we'll allow it if the user is authenticated
            original_filename = s3_path.split('/')[-1] if s3_path else 'document'
            file_type = 'application/octet-stream'
        
        # Generate presigned URL for direct S3 download
        try:
            s3_client = boto3.client(
                's3',
                aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
                aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
                region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
            )
            
            bucket_name = os.environ['S3_UPLOAD_BUCKET']
            
            # Generate presigned URL (valid for 1 hour)
            presigned_url = s3_client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': bucket_name,
                    'Key': s3_path,
                    'ResponseContentDisposition': f'inline; filename="{original_filename}"'
                },
                ExpiresIn=3600  # 1 hour
            )
            
            return jsonify({
                'success': True,
                'presigned_url': presigned_url,
                'filename': original_filename,
                'file_type': file_type
            }), 200
            
        except ClientError as e:
            logger.error(f"Error generating presigned URL: {e}")
            return jsonify({'error': f'Failed to generate download URL: {str(e)}'}), 500
            
    except Exception as e:
        logger.error(f"Error in get_presigned_download_url endpoint: {e}")
        return jsonify({'error': str(e)}), 500

@views.route('/api/files/download', methods=['GET'])
@login_required
def download_file():
    """Download a file from S3 by document ID or s3_path (fallback if presigned URL fails)"""
    try:
        from .services.supabase_document_service import SupabaseDocumentService
        import boto3
        from botocore.exceptions import ClientError
        
        document_id = request.args.get('document_id')
        s3_path = request.args.get('s3_path')
        
        if not document_id and not s3_path:
            return jsonify({'error': 'Either document_id or s3_path is required'}), 400
        
        # If document_id is provided, fetch the document to get s3_path
        if document_id and not s3_path:
            doc_service = SupabaseDocumentService()
            document = doc_service.get_document_by_id(document_id)
            
            if not document:
                return jsonify({'error': 'Document not found'}), 404
            
            # Verify business access
            business_uuid_str = _ensure_business_uuid()
            if not business_uuid_str:
                return jsonify({'error': 'User not associated with a business'}), 400
            
            if str(document.get('business_uuid')) != business_uuid_str:
                return jsonify({'error': 'Unauthorized'}), 403
            
            s3_path = document.get('s3_path')
            if not s3_path:
                return jsonify({'error': 'Document has no s3_path'}), 404
            
            original_filename = document.get('original_filename', 'document')
            file_type = document.get('file_type', 'application/octet-stream')
        else:
            # If only s3_path is provided, we still need to verify access
            # For now, we'll allow it if the user is authenticated
            original_filename = s3_path.split('/')[-1] if s3_path else 'document'
            file_type = 'application/octet-stream'
        
        # Download file from S3
        try:
            s3_client = boto3.client(
                's3',
                aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
                aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
                region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
            )
            
            bucket_name = os.environ['S3_UPLOAD_BUCKET']
            response = s3_client.get_object(Bucket=bucket_name, Key=s3_path)
            file_content = response['Body'].read()
            
            # Determine content type
            content_type = response.get('ContentType', file_type)
            
            # Create Flask response with file content
            return Response(
                file_content,
                mimetype=content_type,
                headers={
                    'Content-Disposition': f'inline; filename="{original_filename}"',
                    'Content-Type': content_type
                }
            )
            
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', '')
            
            # Handle "file not found" errors gracefully with 404
            if error_code in ('NoSuchKey', '404', 'NotFound'):
                logger.warning(f"File not found in S3: {s3_path}")
                return jsonify({
                    'error': 'File not found',
                    'message': 'The requested file does not exist or has been deleted.',
                    's3_path': s3_path
                }), 404
            
            # Log and return 500 for other S3 errors
            logger.error(f"Error downloading file from S3: {e}")
            return jsonify({'error': f'Failed to download file: {str(e)}'}), 500
            
    except Exception as e:
        logger.error(f"Error in download_file endpoint: {e}")
        return jsonify({'error': str(e)}), 500

@views.route('/api/property-matching/reviews', methods=['GET'])
@login_required
def get_pending_property_reviews():
    """Get all pending manual property reviews for the current business"""
    try:
        from .services.manual_property_review_service import ManualPropertyReviewService
        
        review_service = ManualPropertyReviewService()
        business_id = current_user.company_name  # Assuming company_name is used as business_id
        
        pending_reviews = review_service.get_pending_reviews(business_id)
        
        return jsonify({
            'success': True,
            'reviews': pending_reviews,
            'count': len(pending_reviews)
        })
        
    except Exception as e:
        logger.error(f"Error getting pending reviews: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/property-matching/reviews/<review_id>/decision', methods=['POST'])
@login_required
def process_property_review_decision(review_id):
    """Process a manual review decision"""
    try:
        data = request.get_json()
        decision = data.get('decision')  # 'link_to_existing', 'create_new', 'reject'
        selected_property_id = data.get('selected_property_id')
        reviewer_notes = data.get('reviewer_notes')
        
        if not decision:
            return jsonify({
                'success': False,
                'error': 'Decision is required'
            }), 400
        
        from .services.manual_property_review_service import ManualPropertyReviewService
        
        review_service = ManualPropertyReviewService()
        result = review_service.process_review_decision(
            review_id=review_id,
            decision=decision,
            selected_property_id=selected_property_id,
            reviewer_notes=reviewer_notes
        )
        
        if result['success']:
            return jsonify({
                'success': True,
                'message': 'Review decision processed successfully',
                'result': result
            })
        else:
            return jsonify({
                'success': False,
                'error': result.get('error', 'Unknown error')
            }), 400
        
    except Exception as e:
        logger.error(f"Error processing review decision: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/property-matching/statistics', methods=['GET'])
@login_required
def get_property_matching_statistics():
    """Get property matching statistics"""
    try:
        from .services.enhanced_property_matching_service import EnhancedPropertyMatchingService
        from .services.manual_property_review_service import ManualPropertyReviewService
        
        business_id = current_user.company_name
        
        # Get matching statistics
        matching_service = EnhancedPropertyMatchingService()
        matching_stats = matching_service.get_matching_statistics(business_id)
        
        # Get review statistics
        review_service = ManualPropertyReviewService()
        review_stats = review_service.get_review_statistics(business_id)
        
        return jsonify({
            'success': True,
            'matching_statistics': matching_stats,
            'review_statistics': review_stats
        })
        
    except Exception as e:
        logger.error(f"Error getting matching statistics: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/property-matching/test', methods=['POST'])
@login_required
def test_property_matching():
    """Test property matching with sample data"""
    try:
        data = request.get_json()
        test_address = data.get('address')
        
        if not test_address:
            return jsonify({
                'success': False,
                'error': 'Test address is required'
            }), 400
        
        from .services.enhanced_property_matching_service import EnhancedPropertyMatchingService
        from .services.address_service import AddressNormalizationService
        
        # Process the test address
        address_service = AddressNormalizationService()
        address_data = address_service.geocode_and_normalize(test_address)
        
        # Test matching
        matching_service = EnhancedPropertyMatchingService()
        business_id = current_user.company_name
        
        # Create a test document ID
        test_document_id = str(uuid.uuid4())
        
        match_result = matching_service.find_or_create_property(
            address_data=address_data,
            document_id=test_document_id,
            business_id=business_id
        )
        
        return jsonify({
            'success': True,
            'test_address': test_address,
            'processed_address': address_data,
            'match_result': match_result
        })
        
    except Exception as e:
        logger.error(f"Error testing property matching: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


from flask import Blueprint, render_template, request, flash, redirect, url_for, jsonify, current_app, Response
from flask_login import login_required, current_user, login_user, logout_user
from .models import Document, DocumentStatus, Property, PropertyDetails, DocumentRelationship, User, UserRole, UserStatus, PropertyCardCache, db
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
# Citations are now stored directly in graph state with bbox coordinates - no processing needed
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
        # json is already imported at module level (line 23)
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
        document_ids = data.get('documentIds') or data.get('document_ids', [])  # NEW: Get attached document IDs
        message_history = data.get('messageHistory', [])
        session_id = data.get('sessionId', f"session_{request.remote_addr}_{int(time.time())}")
        
        # Handle documentIds as comma-separated string, array, or single value
        if isinstance(document_ids, str):
            document_ids = [d.strip() for d in document_ids.split(',') if d.strip()]
        elif isinstance(document_ids, (int, float)):
            # Handle single number
            document_ids = [str(document_ids)]
        elif isinstance(document_ids, list):
            # Ensure all IDs are strings
            document_ids = [str(doc_id) for doc_id in document_ids if doc_id]
        else:
            document_ids = []
        
        logger.info(
            f"🔵 [STREAM] Query: '{query[:50]}...', "
            f"Property ID: {property_id}, "
            f"Document IDs: {document_ids} (count: {len(document_ids)}), "
            f"Session: {session_id}"
        )
        
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
                    "property_id": property_id,
                    "document_ids": document_ids if document_ids else None  # NEW: Pass document IDs for fast path
                }
                logger.info(
                    f"🟢 [STREAM] Initial state built: query='{query[:30]}...', "
                    f"business_id={business_id}, "
                    f"document_ids={len(document_ids) if document_ids else 0}"
                )
                
                # Send initial status and FIRST reasoning step immediately
                logger.info("🟢 [STREAM] Yielding initial status message")
                yield f"data: {json.dumps({'type': 'status', 'message': 'Searching documents...'})}\n\n"
                
                # Extract intent from query for contextual reasoning step
                # Simple heuristic: identify what user is looking for and where
                def extract_query_intent(q: str) -> str:
                    """Extract a human-readable intent from the query."""
                    q_lower = q.lower().strip()
                    words_in_query = q_lower.split()
                    
                    # Common search targets
                    targets = []
                    
                    # Check for "who" questions first - these ask about people/companies
                    is_who_question = 'who' in words_in_query
                    
                    if is_who_question:
                        # "Who valued/surveyed/wrote/prepared" etc.
                        if any(word in q_lower for word in ['valued', 'valuation', 'value ']):
                            targets.append('valuer')
                        elif any(word in q_lower for word in ['surveyed', 'survey', 'inspected']):
                            targets.append('surveyor')
                        elif any(word in q_lower for word in ['wrote', 'write', 'prepared', 'created', 'authored']):
                            targets.append('author')
                        elif any(word in q_lower for word in ['sold', 'sell', 'sale']):
                            targets.append('seller')
                        elif any(word in q_lower for word in ['bought', 'buy', 'purchase']):
                            targets.append('buyer')
                        elif any(word in q_lower for word in ['owns', 'own', 'owner']):
                            targets.append('owner')
                        else:
                            targets.append('person/company')
                    else:
                        # Standard value/price checks - but not if asking about who valued
                        if any(word in words_in_query for word in ['price', 'cost', 'worth', 'sale']):
                            targets.append('price')
                        elif 'value' in words_in_query and 'valued' not in q_lower:
                            targets.append('value')
                        elif 'valuation' in q_lower and 'who' not in q_lower:
                            targets.append('valuation details')
                    
                    # Other common targets
                    if any(word in q_lower for word in ['bedroom', 'bed', 'beds']):
                        targets.append('bedrooms')
                    if any(word in q_lower for word in ['bathroom', 'bath', 'baths']):
                        targets.append('bathrooms')
                    if any(word in q_lower for word in ['epc', 'energy']):
                        targets.append('EPC rating')
                    if any(word in q_lower for word in ['survey', 'report']) and 'surveyor' not in targets:
                        targets.append('report details')
                    if any(word in q_lower for word in ['issue', 'problem', 'defect', 'damage']):
                        targets.append('issues')
                    if any(word in q_lower for word in ['amenity', 'amenities', 'feature', 'features']):
                        targets.append('amenities')
                    if any(word in q_lower for word in ['date', 'when', 'dated']):
                        targets.append('date')
                    if any(word in q_lower for word in ['size', 'sqft', 'square', 'area', 'footage']):
                        targets.append('size')
                    if any(word in q_lower for word in ['address', 'location', 'where']):
                        targets.append('location')
                    
                    # Extract potential document/property names (capitalized words)
                    import re
                    # Look for capitalized words that might be names (excluding common words)
                    common_words = {'the', 'a', 'an', 'of', 'in', 'for', 'to', 'and', 'or', 'please', 'find', 'me', 'what', 'is', 'are', 'show', 'get', 'tell', 'who', 'how', 'why', 'when', 'where'}
                    words = q.split()
                    potential_names = [w for w in words if len(w) > 2 and w[0].isupper() and w.lower() not in common_words]
                    
                    # Build the intent message
                    target_str = ', '.join(targets) if targets else 'information'
                    if potential_names:
                        name_str = ' '.join(potential_names[:2])  # Max 2 names
                        return f"Searching for {target_str} in documents"
                    else:
                        return f"Searching for {target_str}"
                
                intent_message = extract_query_intent(query)
                
                # Emit initial reasoning step with extracted intent
                initial_reasoning = {
                    'type': 'reasoning_step',
                    'step': 'initial',
                    'action_type': 'searching',
                    'message': intent_message,
                    'details': {'original_query': query}
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
                        
                        # Check for existing session state (follow-up detection)
                        is_followup = False
                        existing_doc_count = 0
                        try:
                            if checkpointer:
                                existing_state = await graph.aget_state(config_dict)
                                if existing_state and existing_state.values:
                                    conv_history = existing_state.values.get('conversation_history', [])
                                    prev_docs = existing_state.values.get('relevant_documents', [])
                                    if conv_history and len(conv_history) > 0:
                                        is_followup = True
                                    if prev_docs:
                                        existing_doc_count = len(prev_docs)
                        except Exception as state_err:
                            logger.warning(f"Could not check existing state: {state_err}")
                        
                        # Use astream_events to capture node execution and emit reasoning steps
                        logger.info("🟡 [STREAM] Starting graph execution with event streaming...")
                        
                        # Track which nodes have been processed to avoid duplicate reasoning steps
                        processed_nodes = set()
                        
                        # Track if this is a follow-up for dynamic step generation
                        followup_context = {
                            'is_followup': is_followup,
                            'existing_doc_count': existing_doc_count,
                            'docs_already_shown': False  # Track if we've shown "Using cached" message
                        }
                        
                        # Node name to user-friendly message mapping with action types for Cursor-style UI
                        # These are minimal - most steps are dynamically generated from on_chain_end events
                        node_messages = {
                            # Only emit for clarify_relevant_docs start (brief step before detailed Found X)
                            'clarify_relevant_docs': {
                                'action_type': 'analyzing',
                                'message': 'Ranking results',
                                'details': {}
                            },
                            'summarize_results': {
                                'action_type': 'planning',
                                'message': 'Preparing response',
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
                                            'action_type': node_messages[node_name].get('action_type', 'analyzing'),
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
                                        relevant_docs = state_data.get("relevant_documents", [])
                                        doc_count = len(relevant_docs)
                                        if doc_count > 0:
                                            # Build document names and previews for found_documents step
                                            doc_names = []
                                            doc_previews = []
                                            
                                            for doc in relevant_docs[:10]:  # Limit to first 10 for display
                                                filename = doc.get('original_filename', '') or ''
                                                classification_type = doc.get('classification_type', 'Document') or 'Document'
                                                doc_id = doc.get('doc_id', '')
                                                
                                                # Build display name
                                                if filename:
                                                    display_name = filename
                                                    if len(display_name) > 35:
                                                        display_name = display_name[:32] + '...'
                                                else:
                                                    display_name = classification_type.replace('_', ' ').title()
                                                
                                                    doc_names.append(display_name)
                                                    
                                                # Build doc_preview metadata
                                                doc_preview = {
                                                        'doc_id': doc_id,
                                                    'original_filename': filename if filename else None,
                                                        'classification_type': classification_type,
                                                        'page_range': doc.get('page_range', ''),
                                                        'page_numbers': doc.get('page_numbers', []),
                                                        's3_path': doc.get('s3_path', ''),
                                                        'download_url': f"/api/files/download?document_id={doc_id}" if doc_id else ''
                                                }
                                                doc_previews.append(doc_preview)
                                            
                                            # Build message - different for follow-ups vs first query
                                            if followup_context['is_followup'] and not followup_context['docs_already_shown']:
                                                # For follow-up queries, show a more contextual message
                                                if doc_names:
                                                    names_str = ', '.join(doc_names[:3])  # Show fewer names for cleaner display
                                                    message = f'Using documents: {names_str}'
                                                else:
                                                    message = f'Using {doc_count} existing documents'
                                                followup_context['docs_already_shown'] = True
                                            else:
                                                # First query - show full "Found X documents" message
                                                if doc_names:
                                                    names_str = ', '.join(doc_names)
                                                    message = f'Found {doc_count} documents: {names_str}'
                                                else:
                                                    message = f'Found {doc_count} documents'
                                            
                                            reasoning_data = {
                                                'type': 'reasoning_step',
                                                'step': 'found_documents',
                                                'action_type': 'exploring',
                                                'message': message,
                                                'count': doc_count,
                                                'details': {
                                                    'documents_found': doc_count, 
                                                    'document_names': doc_names,
                                                    'doc_previews': doc_previews  # Full metadata for preview cards
                                                }
                                            }
                                            yield f"data: {json.dumps(reasoning_data)}\n\n"
                                    
                                    elif node_name == "process_documents":
                                        state_data = state_update if state_update else output
                                        doc_outputs = state_data.get("document_outputs", [])
                                        doc_outputs_count = len(doc_outputs)
                                        if doc_outputs_count > 0:
                                            # Get relevant_documents from state to match doc_ids
                                            relevant_docs = state_data.get("relevant_documents", [])
                                            
                                            # For follow-ups, show a single "Analyzing documents" step
                                            # For first queries, show individual "Read [filename]" steps with preview cards
                                            if followup_context['is_followup']:
                                                # Single step for follow-up - documents already read before
                                                reasoning_data = {
                                                    'type': 'reasoning_step',
                                                    'step': 'analyzing_for_followup',
                                                    'action_type': 'analyzing',
                                                    'message': f'Analyzing {doc_outputs_count} documents for your question',
                                                    'details': {'documents_analyzed': doc_outputs_count}
                                                }
                                                yield f"data: {json.dumps(reasoning_data)}\n\n"
                                            else:
                                                # First query - show individual read steps with preview cards
                                                for i, doc_output in enumerate(doc_outputs):
                                                    filename = doc_output.get('original_filename', '') or ''
                                                    classification_type = doc_output.get('classification_type', 'Document') or 'Document'
                                                    
                                                    # Build display name with classification_type fallback
                                                    if filename:
                                                        display_filename = filename
                                                        # Truncate long filenames for display
                                                        if len(display_filename) > 35:
                                                            display_filename = display_filename[:32] + '...'
                                                    else:
                                                        # Use classification_type as display name (e.g., "valuation_report" -> "Valuation Report")
                                                        display_filename = classification_type.replace('_', ' ').title()
                                                    
                                                    # Extract document metadata for preview card (include download URL)
                                                    doc_id_for_meta = doc_output.get('doc_id', '')
                                                    doc_metadata = {
                                                        'doc_id': doc_id_for_meta,
                                                        'original_filename': filename if filename else None,
                                                        'classification_type': classification_type,
                                                        'page_range': doc_output.get('page_range', ''),
                                                        'page_numbers': doc_output.get('page_numbers', []),
                                                        's3_path': doc_output.get('s3_path', ''),
                                                        'download_url': f"/api/files/download?document_id={doc_id_for_meta}" if doc_id_for_meta else ''
                                                    }
                                                    
                                                    reasoning_data = {
                                                        'type': 'reasoning_step',
                                                        'step': f'read_doc_{i}',
                                                        'action_type': 'reading',
                                                        'message': f'Read {display_filename}',
                                                        'details': {
                                                            'document_index': i, 
                                                            'filename': filename if filename else None,
                                                            'doc_metadata': doc_metadata
                                                        }
                                                    }
                                                    yield f"data: {json.dumps(reasoning_data)}\n\n"
                                    
                                    # Handle summarize_results node completion - citations already have bbox coordinates
                                    if node_name == "summarize_results":
                                        state_data = state_update if state_update else output
                                        
                                        # Initialize final_result if needed
                                        if final_result is None:
                                            final_result = {}
                                        
                                        # Explicitly capture final_summary (critical for streaming)
                                        final_summary_from_state = state_data.get('final_summary', '')
                                        if final_summary_from_state:
                                            final_result['final_summary'] = final_summary_from_state
                                            logger.info(f"🟢 [STREAM] Captured final_summary from summarize_results ({len(final_summary_from_state)} chars)")
                                        
                                        # Capture document_outputs (preserved in summarize_results return)
                                        doc_outputs_from_state = state_data.get('document_outputs', [])
                                        if doc_outputs_from_state:
                                            final_result['document_outputs'] = doc_outputs_from_state
                                            logger.info(f"🟢 [STREAM] Captured {len(doc_outputs_from_state)} document_outputs from summarize_results")
                                        
                                        # Capture relevant_documents if available
                                        relevant_docs_from_state = state_data.get('relevant_documents', [])
                                        if relevant_docs_from_state:
                                            final_result['relevant_documents'] = relevant_docs_from_state
                                            logger.info(f"🟢 [STREAM] Captured {len(relevant_docs_from_state)} relevant_documents from summarize_results")
                                        
                                        # Extract citations from state (already have bbox coordinates from CitationTool)
                                        citations_from_state = state_data.get('citations', [])
                                        
                                        # #region agent log
                                        # Debug: Log citations extraction for Hypothesis E
                                        try:
                                            # json is already imported at module level
                                            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                                                f.write(json.dumps({
                                                    'sessionId': 'debug-session',
                                                    'runId': 'run1',
                                                    'hypothesisId': 'E',
                                                    'location': 'views.py:767',
                                                    'message': 'Citations extracted from state',
                                                    'data': {
                                                        'citations_count': len(citations_from_state) if citations_from_state else 0,
                                                        'has_citations': bool(citations_from_state),
                                                        'state_has_citations_key': 'citations' in state_data
                                                    },
                                                    'timestamp': int(__import__('time').time() * 1000)
                                                }) + '\n')
                                        except Exception:
                                            pass  # Silently fail instrumentation
                                        # #endregion
                                        
                                        if citations_from_state:
                                            logger.info(
                                                f"🟢 [CITATION_STREAM] Processing {len(citations_from_state)} citations "
                                                f"from summarize_results node (bbox coordinates already included)"
                                            )
                                            
                                            try:
                                                # Format citations for frontend (convert List[Citation] to Dict[str, CitationData])
                                                processed_citations = {}
                                                
                                                # Stream citation events immediately
                                                for citation in citations_from_state:
                                                    citation_num_str = str(citation['citation_number'])
                                                    
                                                    # Format citation data for frontend
                                                    # CRITICAL: Ensure bbox is included and properly structured
                                                    citation_bbox = citation.get('bbox')
                                                    citation_page = citation.get('page_number') or (citation_bbox.get('page') if citation_bbox and isinstance(citation_bbox, dict) else None) or 0
                                                    
                                                    # #region agent log
                                                    # Debug: Log citation data before streaming for Hypothesis E
                                                    try:
                                                        is_fallback_bbox = (
                                                            citation_bbox and isinstance(citation_bbox, dict) and
                                                            citation_bbox.get('left') == 0.0 and
                                                            citation_bbox.get('top') == 0.0 and
                                                            citation_bbox.get('width') == 1.0 and
                                                            citation_bbox.get('height') == 1.0
                                                        )
                                                        # json is already imported at module level
                                                        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                                                            f.write(json.dumps({
                                                                'sessionId': 'debug-session',
                                                                'runId': 'run1',
                                                                'hypothesisId': 'E',
                                                                'location': 'views.py:810',
                                                                'message': 'Citation data prepared for streaming',
                                                                'data': {
                                                                    'citation_number': citation_num_str,
                                                                    'doc_id': citation.get('doc_id', '')[:8] if citation.get('doc_id') else 'unknown',
                                                                    'citation_bbox': citation_bbox,
                                                                    'citation_page': citation_page,
                                                                    'is_fallback_bbox': is_fallback_bbox,
                                                                    'has_bbox': bool(citation_bbox),
                                                                    'page_from_bbox': citation_bbox.get('page') if citation_bbox and isinstance(citation_bbox, dict) else None,
                                                                    'page_from_citation': citation.get('page_number')
                                                                },
                                                                'timestamp': int(__import__('time').time() * 1000)
                                                            }) + '\n')
                                                    except Exception:
                                                        pass
                                                    # #endregion
                                                    
                                                    citation_data = {
                                                        'doc_id': citation.get('doc_id'),
                                                        'page': citation_page,
                                                        'bbox': citation_bbox,  # Should already have bbox from CitationTool
                                                        'method': citation.get('method', 'block-id-lookup')
                                                    }
                                                    
                                                    logger.info(
                                                        f"🟢 [CITATION_STREAM] Citation {citation_num_str} data: "
                                                        f"doc_id={citation_data.get('doc_id', '')[:8]}, "
                                                        f"page={citation_data.get('page')}, "
                                                        f"has_bbox={bool(citation_bbox)}, "
                                                        f"bbox_keys={list(citation_bbox.keys()) if citation_bbox and isinstance(citation_bbox, dict) else 'none'}"
                                                    )
                                                    
                                                    # #region agent log
                                                    # Debug: Log citation event for Hypothesis E
                                                    try:
                                                        # json is already imported at module level
                                                        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                                                            f.write(json.dumps({
                                                                'sessionId': 'debug-session',
                                                                'runId': 'run1',
                                                                'hypothesisId': 'E',
                                                                'location': 'views.py:801',
                                                                'message': 'Citation event prepared for streaming',
                                                                'data': {
                                                                    'citation_number': citation_num_str,
                                                                    'doc_id': citation_data.get('doc_id', '')[:8] if citation_data.get('doc_id') else 'none',
                                                                    'page': citation_data.get('page'),
                                                                    'has_bbox': bool(citation_bbox),
                                                                    'bbox': citation_bbox if citation_bbox and isinstance(citation_bbox, dict) else None
                                                                },
                                                                'timestamp': int(__import__('time').time() * 1000)
                                                            }) + '\n')
                                                    except Exception:
                                                        pass  # Silently fail instrumentation
                                                    # #endregion
                                                    
                                                    processed_citations[citation_num_str] = citation_data
                                                    
                                                    # Stream citation event
                                                    citation_event = {
                                                        'type': 'citation',
                                                        'citation_number': citation['citation_number'],
                                                        'data': citation_data
                                                    }
                                                    yield f"data: {json.dumps(citation_event)}\n\n"
                                                    logger.info(
                                                        f"🟢 [CITATION_STREAM] Streamed citation {citation_num_str} "
                                                        f"(doc: {citation_data.get('doc_id', '')[:8]}, page: {citation_data.get('page')})"
                                                    )
                                                
                                                # Store processed citations in final_result for later use
                                                final_result['processed_citations'] = processed_citations
                                                
                                            except Exception as citation_error:
                                                logger.error(
                                                    f"🟡 [CITATION_STREAM] Error processing citations: {citation_error}",
                                                    exc_info=True
                                                )
                                                # Continue without citations rather than failing
                                        
                                        # Debug: Log what we captured
                                        logger.info(
                                            f"🟢 [STREAM] summarize_results state captured: "
                                            f"summary={bool(final_result.get('final_summary'))}, "
                                            f"doc_outputs={len(final_result.get('document_outputs', []))}, "
                                            f"relevant_docs={len(final_result.get('relevant_documents', []))}, "
                                            f"citations={len(citations_from_state)}"
                                        )
                                    
                                    # MERGE state updates from each node (don't overwrite!)
                                    if state_update:
                                        if final_result is None:
                                            final_result = {}
                                        final_result.update(state_update)  # Merge instead of overwrite
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
                                                'action_type': node_messages[node_name].get('action_type', 'analyzing'),
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
                                            relevant_docs = state_data.get("relevant_documents", [])
                                            doc_count = len(relevant_docs)
                                            if doc_count > 0:
                                                # Build document names and previews for found_documents step
                                                doc_names = []
                                                doc_previews = []
                                                
                                                for doc in relevant_docs[:10]:  # Limit to first 10 for display
                                                    filename = doc.get('original_filename', '') or ''
                                                    classification_type = doc.get('classification_type', 'Document') or 'Document'
                                                    doc_id = doc.get('doc_id', '')
                                                    
                                                    # Build display name
                                                    if filename:
                                                        display_name = filename
                                                        if len(display_name) > 35:
                                                            display_name = display_name[:32] + '...'
                                                    else:
                                                        display_name = classification_type.replace('_', ' ').title()
                                                    
                                                    doc_names.append(display_name)
                                                    
                                                    # Build doc_preview metadata
                                                    doc_preview = {
                                                        'doc_id': doc_id,
                                                        'original_filename': filename if filename else None,
                                                        'classification_type': classification_type,
                                                        'page_range': doc.get('page_range', ''),
                                                        'page_numbers': doc.get('page_numbers', []),
                                                        's3_path': doc.get('s3_path', ''),
                                                        'download_url': f"/api/files/download?document_id={doc_id}" if doc_id else ''
                                                    }
                                                    doc_previews.append(doc_preview)
                                                
                                                # Create found_documents step with exploring action_type
                                                message = f'Found {doc_count} document{"s" if doc_count > 1 else ""}'
                                                if doc_names:
                                                    message += f': {", ".join(doc_names[:3])}'
                                                    if doc_count > 3:
                                                        message += '...'
                                                
                                                reasoning_data = {
                                                    'type': 'reasoning_step',
                                                    'step': 'found_documents',
                                                    'action_type': 'exploring',
                                                    'message': message,
                                                    'count': doc_count,
                                                    'details': {
                                                        'documents_found': doc_count,
                                                        'document_names': doc_names,
                                                        'doc_previews': doc_previews  # Full metadata for preview cards
                                                    }
                                                }
                                                yield f"data: {json.dumps(reasoning_data)}\n\n"
                                        
                                        elif node_name == "process_documents":
                                            state_data = state_update if state_update else event_data.get("output", {})
                                            doc_outputs = state_data.get("document_outputs", [])
                                            doc_outputs_count = len(doc_outputs)
                                            if doc_outputs_count > 0:
                                                # Create individual reading steps for each document (for preview cards)
                                                for i, doc_output in enumerate(doc_outputs):
                                                    filename = doc_output.get('original_filename', '') or ''
                                                    classification_type = doc_output.get('classification_type', 'Document') or 'Document'
                                                    
                                                    # Build display name with classification_type fallback
                                                    if filename:
                                                        display_filename = filename
                                                        # Truncate long filenames for display
                                                        if len(display_filename) > 35:
                                                            display_filename = display_filename[:32] + '...'
                                                    else:
                                                        # Use classification_type as display name (e.g., "valuation_report" -> "Valuation Report")
                                                        display_filename = classification_type.replace('_', ' ').title()
                                                    
                                                    # Extract document metadata for preview card (include download URL)
                                                    doc_id_for_meta = doc_output.get('doc_id', '')
                                                    doc_metadata = {
                                                        'doc_id': doc_id_for_meta,
                                                        'original_filename': filename if filename else None,
                                                        'classification_type': classification_type,
                                                        'page_range': doc_output.get('page_range', ''),
                                                        'page_numbers': doc_output.get('page_numbers', []),
                                                        's3_path': doc_output.get('s3_path', ''),
                                                        'download_url': f"/api/files/download?document_id={doc_id_for_meta}" if doc_id_for_meta else ''
                                                    }
                                                    
                                                reasoning_data = {
                                                    'type': 'reasoning_step',
                                                        'step': f'read_doc_{i}',
                                                        'action_type': 'reading',
                                                        'message': f'Read {display_filename}',
                                                        'details': {
                                                            'document_index': i, 
                                                            'filename': filename if filename else None,
                                                            'doc_metadata': doc_metadata
                                                        }
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
                                    # Checkpointer returns (state, config) tuple or just state
                                    if isinstance(latest_checkpoint, tuple) and len(latest_checkpoint) == 2:
                                        final_result, _ = latest_checkpoint
                                        logger.info("🟡 [STREAM] Retrieved final state from checkpointer (tuple)")
                                    else:
                                        # Single value returned
                                        final_result = latest_checkpoint
                                        logger.info("🟡 [STREAM] Retrieved final state from checkpointer (single value)")
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
                        # FIX: Handle case where final_result might be tuple or have different structure
                        if isinstance(final_result, tuple):
                            # If checkpointer returns tuple, extract the dict
                            if len(final_result) >= 1:
                                final_result = final_result[0]
                                doc_outputs = final_result.get('document_outputs', []) if isinstance(final_result, dict) else []
                                relevant_docs = final_result.get('relevant_documents', []) if isinstance(final_result, dict) else []
                            else:
                                doc_outputs = []
                                relevant_docs = []
                        elif final_result is None:
                            doc_outputs = []
                            relevant_docs = []
                        else:
                            doc_outputs = final_result.get('document_outputs', []) if final_result else []
                            relevant_docs = final_result.get('relevant_documents', []) if final_result else []
                        
                        logger.info(f"🟡 [STREAM] Final state: {len(doc_outputs)} doc outputs, {len(relevant_docs)} relevant docs")
                        
                        # Get the summary that was already generated by summarize_results node
                        full_summary = final_result.get('final_summary', '')
                        
                        # Check if we have a summary (even if doc_outputs is empty, summary means we processed documents)
                        if not full_summary:
                            # Only error if we have neither summary nor documents
                            if not doc_outputs:
                                logger.error("🟡 [STREAM] No summary and no documents - cannot proceed")
                                yield f"data: {json.dumps({'type': 'error', 'message': 'No relevant documents found'})}\n\n"
                                return
                            else:
                                logger.warning("🟡 [STREAM] No final_summary found in result, generating fallback")
                                full_summary = "I couldn't generate a summary from the retrieved documents. Please try rephrasing your query."
                        
                        # Send document count (use doc_outputs if available, otherwise relevant_docs)
                        doc_count = len(doc_outputs) if doc_outputs else len(relevant_docs)
                        yield f"data: {json.dumps({'type': 'documents_found', 'count': doc_count})}\n\n"
                        
                        # If we have a summary, proceed even if doc_outputs is empty (documents were already processed)
                        if not doc_outputs and not full_summary:
                            yield f"data: {json.dumps({'type': 'error', 'message': 'No relevant documents found'})}\n\n"
                            return
                        
                        logger.info(f"🟡 [STREAM] Using existing summary from summarize_results node ({len(full_summary)} chars)")
                        
                        # Stream the existing summary token by token (simulate streaming for UX)
                        logger.info("🟡 [STREAM] Streaming existing summary (no redundant LLM call)")
                        yield f"data: {json.dumps({'type': 'status', 'message': 'Streaming response...'})}\n\n"
                        
                        # Split summary into words and stream them (no delay needed - already fast)
                        words = full_summary.split()
                        for i, word in enumerate(words):
                            if i == 0:
                                logger.info("🟡 [STREAM] First token streamed from existing summary")
                            # Add space after word (except last word)
                            token = word + (' ' if i < len(words) - 1 else '')
                            yield f"data: {json.dumps({'type': 'token', 'token': token})}\n\n"
                        
                        # Check if we have processed citations from block IDs (new approach)
                        processed_citations = final_result.get('processed_citations', {})
                                    
                        # Build citations_map_for_frontend and structured_citations from block ID citations
                        citations_map_for_frontend = {}
                        structured_citations = []
                        
                        if processed_citations:
                            logger.info(
                                f"🟢 [CITATIONS] Using block ID citations ({len(processed_citations)} citations)"
                            )
                            # Convert processed citations from block IDs to frontend format
                            for citation_num, citation_data in processed_citations.items():
                                bbox = citation_data.get('bbox', {})
                                page = citation_data.get('page', 0)
                                doc_id = citation_data.get('doc_id', '')
                                
                                # Build structured citation for array format
                                structured_citations.append({
                                    'id': int(citation_num),
                                    'document_id': doc_id,
                                    'page': page,
                                    'bbox': bbox
                                })
                                
                                # Build citation map entry for frontend
                                citations_map_for_frontend[citation_num] = {
                                    'doc_id': doc_id,
                                    'page': page,
                                    'bbox': bbox,
                                    'method': citation_data.get('method', 'block-id-lookup')
                                }
                        else:
                            logger.info("🟡 [CITATIONS] No block ID citations found - citations will be empty")
                        
                        logger.info(f"🟡 [CITATIONS] Final citation count: {len(structured_citations)} structured, {len(citations_map_for_frontend)} map entries")
                        
                        # Send complete message with metadata
                        complete_data = {
                            'type': 'complete',
                            'data': {
                                'summary': full_summary.strip(),
                                'relevant_documents': relevant_docs,
                                'document_outputs': doc_outputs,
                                'citations': citations_map_for_frontend,  # Frontend expects Record<string, CitationDataType>
                                'citations_array': structured_citations,  # NEW: Structured array format (for future use)
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
                        import asyncio
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
                                    chunk_queue.put(chunk)
                                logger.info(f"🟠 [STREAM] Finished consuming async generator ({chunk_count} chunks)")
                            except Exception as e:
                                logger.error(f"🟠 [STREAM] Error in consume_async_gen: {e}", exc_info=True)
                                error_occurred.set()
                                error_message[0] = str(e)
                                chunk_queue.put(f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n")
                        
                        new_loop.run_until_complete(consume_async_gen())
                        logger.info("🟠 [STREAM] Event loop completed")
                    except Exception as e:
                        logger.error(f"🟠 [STREAM] Error in run_async_gen: {e}", exc_info=True)
                        error_occurred.set()
                        error_message[0] = str(e)
                        chunk_queue.put(f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n")
                    finally:
                        chunk_queue.put(None)  # Signal completion
                
                # Start async generator in a separate thread
                thread = threading.Thread(target=run_async_gen, daemon=True)
                thread.start()
                logger.info("🟠 [STREAM] Thread started")
                
                # Yield chunks from queue
                while True:
                    try:
                        chunk = chunk_queue.get(timeout=1.0)
                        if chunk is None:  # Completion signal
                            break
                        yield chunk
                    except:
                        # Timeout or error - check if thread is still alive
                        if not thread.is_alive():
                            if error_occurred.is_set():
                                yield f"data: {json.dumps({'type': 'error', 'message': error_message[0] or 'Unknown error'})}\n\n"
                            break
                        continue
                        
            except Exception as e:
                # Handle any errors in the main generate_stream logic
                logger.error(f"❌ [STREAM] Error in generate_stream: {e}")
                import traceback
                logger.error(f"❌ [STREAM] Traceback: {traceback.format_exc()}")
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        
        # Return SSE response with proper CORS headers
        # Note: generate_stream() already has internal error handling that yields error messages
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
    except Exception as e:
        logger.error(f"❌ [STREAM] Error in query_documents_stream: {e}")
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
    document_ids = data.get('documentIds') or data.get('document_ids', [])  # NEW: Get attached document IDs
    message_history = data.get('messageHistory', [])
    session_id = data.get('sessionId', f"session_{request.remote_addr}_{int(time.time())}")
    
    # Handle documentIds as comma-separated string, array, or single value
    if isinstance(document_ids, str):
        document_ids = [d.strip() for d in document_ids.split(',') if d.strip()]
    elif isinstance(document_ids, (int, float)):
        # Handle single number
        document_ids = [str(document_ids)]
    elif isinstance(document_ids, list):
        # Ensure all IDs are strings
        document_ids = [str(doc_id) for doc_id in document_ids if doc_id]
    else:
        document_ids = []
    
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
        
        # Get document_id from property_id if provided (fallback if document_ids not provided)
        document_id = None
        if property_id and not document_ids:
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
            "property_id": property_id,
            "document_ids": document_ids if document_ids else None  # NEW: Pass document IDs for fast path
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
                document_id=document.id,
                file_content=file_content,
                original_filename=document.original_filename,
                business_id=document.business_id
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


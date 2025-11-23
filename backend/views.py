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
from .tasks import process_document_task
from .services.deletion_service import DeletionService
from sqlalchemy import text
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


def _cleanup_orphan_supabase_properties(property_ids: set[str] | set) -> list[str]:
    """
    Remove Supabase property hub records when no documents remain linked to a property.
    Returns list of property IDs that were fully removed from Supabase.
    """
    cleaned_properties = []
    if not property_ids:
        return cleaned_properties

    supabase = None
    for property_id in property_ids:
        if not property_id:
            continue

        # Check if any local document relationships still reference this property
        remaining_relationships = DocumentRelationship.query.filter_by(property_id=property_id).count()
        if remaining_relationships > 0:
            continue

        try:
            if supabase is None:
                supabase = get_supabase_client()

            pid_str = str(property_id)

            # Delete property vectors first
            try:
                supabase.table('property_vectors').delete().eq('property_id', pid_str).execute()
            except Exception as e:
                logger.warning(f"Failed to delete property vectors for property {pid_str}: {e}")

            # Delete property details rows
            try:
                supabase.table('property_details').delete().eq('property_id', pid_str).execute()
            except Exception as e:
                logger.warning(f"Failed to delete property details for property {pid_str}: {e}")

            # Delete supabase document_relationships (if any remain)
            try:
                supabase.table('document_relationships').delete().eq('property_id', pid_str).execute()
            except Exception as e:
                logger.warning(f"Failed to delete Supabase document relationships for property {pid_str}: {e}")

            # Finally delete the property record itself
            try:
                supabase.table('properties').delete().eq('id', pid_str).execute()
            except Exception as e:
                logger.warning(f"Failed to delete property {pid_str} from Supabase properties table: {e}")

            cleaned_properties.append(pid_str)
            logger.info(f"Cleaned Supabase property hub data for property {pid_str}")
        except Exception as e:
            logger.warning(f"Could not clean Supabase property {property_id}: {e}")

    return cleaned_properties

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

@views.route('/api/llm/query/stream', methods=['POST', 'OPTIONS'])
def query_documents_stream():
    """
    Streaming version of query_documents using Server-Sent Events (SSE).
    Streams LLM responses token-by-token in real-time.
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
    
    # Require login
    if not current_user.is_authenticated:
        return jsonify({
            'success': False,
            'error': 'Authentication required'
        }), 401
    
    from flask import Response, stream_with_context
    import json
    import asyncio
    import time
    from backend.llm.graphs.main_graph import build_main_graph
    from langchain_openai import ChatOpenAI
    from backend.llm.config import config
    
    data = request.get_json()
    query = data.get('query', '')
    property_id = data.get('propertyId')
    message_history = data.get('messageHistory', [])
    session_id = data.get('sessionId', f"session_{request.remote_addr}_{int(time.time())}")
    
    if not query:
        return jsonify({
            'success': False,
            'error': 'Query is required'
        }), 400
    
    def generate_stream():
        """Generator function for SSE streaming"""
        try:
            # Get business_id
            business_id = _ensure_business_uuid()
            if not business_id:
                yield f"data: {json.dumps({'type': 'error', 'message': 'User not associated with a business'})}\n\n"
                return
            
            # Get document_id from property_id if provided
            document_id = None
            if property_id:
                try:
                    supabase = get_supabase_client()
                    result = supabase.table('document_relationships')\
                        .select('document_id')\
                        .eq('property_id', property_id)\
                        .limit(1)\
                        .execute()
                    if result.data and len(result.data) > 0:
                        document_id = result.data[0]['document_id']
                except Exception as e:
                    logger.warning(f"Could not find document for property {property_id}: {e}")
            
            # Convert message history
            conversation_history = []
            for msg in message_history:
                conversation_history.append({
                    'role': msg.get('role', 'user'),
                    'content': msg.get('content', '')
                })
            
            # Build initial state
            initial_state = {
                "user_query": query,
                "query_intent": None,
                "relevant_documents": [],
                "document_outputs": [],
                "final_summary": "",
                "user_id": str(current_user.id) if current_user.is_authenticated else "anonymous",
                "business_id": business_id,
                "session_id": session_id,
                "conversation_history": conversation_history,
                "property_id": property_id
            }
            
            # Send initial status
            yield f"data: {json.dumps({'type': 'status', 'message': 'Searching documents...'})}\n\n"
            
            async def run_and_stream():
                """Run LangGraph and stream the final summary"""
                try:
                    # Build graph (without checkpointer for streaming)
                    graph = await build_main_graph(use_checkpointer=False)
                    config_dict = {"configurable": {"thread_id": session_id}}
                    
                    # Run graph to get document outputs
                    result = await graph.ainvoke(initial_state, config_dict)
                    
                    doc_outputs = result.get('document_outputs', [])
                    relevant_docs = result.get('relevant_documents', [])
                    
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
                    for idx, output in enumerate(doc_outputs):
                        doc_type = (output.get('classification_type') or 'Property Document').replace('_', ' ').title()
                        filename = output.get('original_filename', f"Document {output['doc_id'][:8]}")
                        prop_id = output.get('property_id') or 'Unknown'
                        address = output.get('property_address', f"Property {prop_id[:8]}")
                        page_info = output.get('page_range', 'multiple pages')
                        
                        header = f"\n### {doc_type}: {filename}\n"
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

Focus on what matters in real estate:
- Valuations, specifications, location, condition, risks, opportunities, deal terms, and comparable evidence.

When referencing a document, keep it light and natural:
→ "One of the valuation reports mentions…"
→ "In the lease document, there's a note that…"
→ "The report highlights…"
→ "Page 7 shows that…"

Only cite pages if the information is clearly page-specific. Otherwise keep it general.

CRITICAL RULES:
1. **Do NOT repeat the user's question as a heading or title** - The user can see their own query, so start directly with the answer.
2. **Do NOT add "Additional Context" sections** - Only provide context if the user explicitly asks for it.
3. **Do NOT add unsolicited insights or recommendations** - Answer only what was asked.
4. **Do NOT add "Next steps" or follow-up suggestions** - Answer the question and stop.

Start with a clear, direct answer to the user's question. Provide only the information requested - nothing more.

TONE

Professional, concise, helpful, human, and grounded in the documents — not robotic or over-structured.

Now provide your response (answer directly, no heading, no additional context):"""
                    
                    # Use streaming LLM
                    llm = ChatOpenAI(
                        api_key=config.openai_api_key,
                        model=config.openai_model,
                        temperature=0,
                        streaming=True,  # Enable streaming
                    )
                    
                    # Stream tokens
                    full_summary = ""
                    for chunk in llm.stream(prompt):
                        if chunk.content:
                            token = chunk.content
                            full_summary += token
                            yield f"data: {json.dumps({'type': 'token', 'token': token})}\n\n"
                    
                    # Send complete message with metadata
                    complete_data = {
                        'type': 'complete',
                        'data': {
                            'summary': full_summary.strip(),
                            'relevant_documents': relevant_docs,
                            'document_outputs': doc_outputs,
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
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                async_gen = run_and_stream()
                while True:
                    try:
                        chunk = loop.run_until_complete(async_gen.__anext__())
                        yield chunk
                    except StopAsyncIteration:
                        break
            finally:
                loop.close()
                
        except Exception as e:
            logger.error(f"Error in generate_stream: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
    
    # Return SSE response
    response = Response(
        stream_with_context(generate_stream()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',  # Disable nginx buffering
            'Access-Control-Allow-Origin': request.headers.get('Origin', '*'),
            'Access-Control-Allow-Credentials': 'true',
        }
    )
    return response

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
    from backend.llm.graphs.main_graph import build_main_graph
    
    data = request.get_json()
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
        
        # Convert message history to conversation history format
        conversation_history = []
        for msg in message_history:
            conversation_history.append({
                'role': msg.get('role', 'user'),
                'content': msg.get('content', '')
            })
        
        # Build initial state for LangGraph
        initial_state = {
            "user_query": query,
            "query_intent": None,
            "relevant_documents": [],
            "document_outputs": [],
            "final_summary": "",
            "user_id": str(current_user.id) if current_user.is_authenticated else "anonymous",
            "business_id": business_id,
            "session_id": session_id,
            "conversation_history": conversation_history,
            "property_id": property_id  # Pass property_id to filter results
        }
        
        # Build and run the graph
        async def run_query():
            try:
                graph = await build_main_graph(use_checkpointer=True)
                config = {
                    "configurable": {
                        "thread_id": session_id  # For conversation persistence
                    }
                }
                result = await graph.ainvoke(initial_state, config)
                return result
            except Exception as graph_error:
                # Handle connection closed errors gracefully
                error_msg = str(graph_error)
                if "connection is closed" in error_msg.lower() or "operationalerror" in error_msg.lower():
                    logger.warning("Checkpointer connection error, retrying without checkpointer")
                    # Retry without checkpointer
                    graph = await build_main_graph(use_checkpointer=False)
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

@views.route('/api/documents/upload', methods=['POST'])
@login_required
def upload_property_document():
    """Upload property document (wrapper for existing upload-file)"""
    # Redirect to existing upload-file endpoint
    return upload_file_to_gateway()

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

@views.route('/api/documents/proxy-upload', methods=['POST'])
@login_required
def proxy_upload():
    """Proxy upload to S3 (alternative to presigned URLs if CORS issues)"""
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
            
            # Upload file to S3
            file.seek(0)  # Reset file pointer
            s3_client.put_object(
                Bucket=os.environ['S3_UPLOAD_BUCKET'],
                Key=s3_key,
                Body=file.read(),
                ContentType=file.content_type
            )
            
            
        except Exception as e:
            logger.error(f"Failed to upload to S3: {e}")
            return jsonify({'error': f'Failed to upload to S3: {str(e)}'}), 500
        
        # Only create document record AFTER successful S3 upload
        try:
            # Ensure user exists in local PostgreSQL database (sync from Supabase if needed)
            local_user = User.query.filter_by(id=current_user.id).first()
            if not local_user:
                logger.info(f"User {current_user.id} not found in local DB, syncing from Supabase...")
                # Sync user from Supabase to local PostgreSQL
                from .services.supabase_auth_service import SupabaseAuthService
                auth_service = SupabaseAuthService()
                supabase_user = auth_service.get_user_by_id(current_user.id)
                
                if supabase_user:
                    local_user = User(
                        id=supabase_user['id'],
                        email=supabase_user['email'],
                        first_name=supabase_user.get('first_name', ''),
                        company_name=supabase_user.get('company_name', ''),
                        company_website=supabase_user.get('company_website', ''),
                        role=UserRole.ADMIN if supabase_user.get('role') == 'admin' else UserRole.USER,
                        status=UserStatus.ACTIVE if supabase_user.get('status') == 'active' else UserStatus.INVITED
                    )
                    if supabase_user.get('business_uuid'):
                        try:
                            local_user.business_id = UUID(supabase_user['business_uuid'])
                        except (ValueError, TypeError):
                            pass
                    db.session.add(local_user)
                    db.session.flush()  # Flush to ensure user is available for foreign key
                    logger.info(f"✅ Synced user {current_user.id} from Supabase to local DB")
                else:
                    logger.error(f"User {current_user.id} not found in Supabase either!")
                    return jsonify({'error': 'User not found'}), 404
            
            # Check if this is a manual upload to a property card
            property_id = request.form.get('property_id')
            manual_upload_metadata = None
            if property_id:
                # Mark as manually linked to property (uploaded via property card)
                manual_upload_metadata = {
                    "manually_linked_to_property_id": property_id,
                    "upload_source": "property_card"
                }
            
            new_document = Document(
                original_filename=filename,
                s3_path=s3_key,
                file_type=file.content_type,
                file_size=file.content_length or 0,
                uploaded_by_user_id=current_user.id,
                business_id=business_uuid
            )
            
            # Store manual upload metadata if present
            if manual_upload_metadata:
                new_document.metadata_json = json.dumps(manual_upload_metadata)
            
            # Link to property if property_id is provided
            if property_id:
                try:
                    property_uuid = UUID(property_id)
                    # Check if property exists before linking
                    existing_property = Property.query.filter_by(id=property_uuid).first()
                    if existing_property:
                        new_document.property_id = property_uuid
                    else:
                        # Property doesn't exist - create it with provided data
                        # This ensures files uploaded to a property card stay with that property
                        property_address = request.form.get('property_address')
                        property_latitude = request.form.get('property_latitude')
                        property_longitude = request.form.get('property_longitude')
                        
                        if property_address:
                            logger.info(f"Creating property {property_id} with address: {property_address}")
                            
                            # Normalize address and compute hash
                            from .services.address_service import AddressNormalizationService
                            address_service = AddressNormalizationService()
                            normalized_address = address_service.normalize_address(property_address)
                            address_hash = address_service.compute_address_hash(normalized_address)
                            
                            # Parse coordinates if provided
                            latitude = None
                            longitude = None
                            if property_latitude:
                                try:
                                    latitude = float(property_latitude)
                                except (ValueError, TypeError):
                                    pass
                            if property_longitude:
                                try:
                                    longitude = float(property_longitude)
                                except (ValueError, TypeError):
                                    pass
                            
                            # Create property with the provided ID
                            new_property = Property(
                                id=property_uuid,
                                business_id=business_uuid,
                                address_hash=address_hash,
                                normalized_address=normalized_address,
                                formatted_address=property_address,
                                latitude=latitude,
                                longitude=longitude,
                                geocoding_status='provided' if latitude and longitude else 'pending',
                                geocoding_confidence=1.0 if latitude and longitude else 0.0
                            )
                            
                            db.session.add(new_property)
                            db.session.flush()  # Flush to ensure property is available for foreign key
                            
                            logger.info(f"✅ Created property {property_id} for upload")
                            
                        # Link document to property (whether existing or newly created)
                        new_document.property_id = property_uuid
                except (ValueError, TypeError) as e:
                    logger.warning(f"Invalid property_id provided: {property_id}, error: {e}")
            
            db.session.add(new_document)
            
            # Try to commit - if it fails due to missing column, use raw SQL insert
            try:
                db.session.commit()
            except Exception as commit_error:
                error_str = str(commit_error)
                # Check if it's a foreign key violation for user
                if 'uploaded_by_user_id_fkey' in error_str or ('foreign key constraint' in error_str.lower() and 'user' in error_str.lower()):
                    # User might not exist - ensure it does
                    if not User.query.filter_by(id=current_user.id).first():
                        logger.warning(f"User {current_user.id} missing in commit path, syncing...")
                        # Sync user (same logic as above)
                        from .services.supabase_auth_service import SupabaseAuthService
                        auth_service = SupabaseAuthService()
                        supabase_user = auth_service.get_user_by_id(current_user.id)
                        if supabase_user:
                            local_user = User(
                                id=supabase_user['id'],
                                email=supabase_user['email'],
                                first_name=supabase_user.get('first_name', ''),
                                company_name=supabase_user.get('company_name', ''),
                                company_website=supabase_user.get('company_website', ''),
                                role=UserRole.ADMIN if supabase_user.get('role') == 'admin' else UserRole.USER,
                                status=UserStatus.ACTIVE if supabase_user.get('status') == 'active' else UserStatus.INVITED
                            )
                            if supabase_user.get('business_uuid'):
                                try:
                                    local_user.business_id = UUID(supabase_user['business_uuid'])
                                except (ValueError, TypeError):
                                    pass
                            db.session.add(local_user)
                            db.session.flush()
                            logger.info(f"✅ Synced user {current_user.id} in commit path")
                        # Retry the commit
                        try:
                            db.session.commit()
                        except Exception as retry_error:
                            error_str = str(retry_error)
                            if 'classification_reasoning' in error_str or 'UndefinedColumn' in error_str:
                                logger.warning(f"Schema mismatch detected, using raw SQL insert: {error_str}")
                                db.session.rollback()
                            else:
                                raise
                    else:
                        raise  # Re-raise if it's a different error
                
                if 'classification_reasoning' in error_str or 'UndefinedColumn' in error_str:
                    logger.warning(f"Schema mismatch detected, using raw SQL insert: {error_str}")
                    db.session.rollback()
                    # Use raw SQL insert with only columns that exist
                    from sqlalchemy import text
                    # Generate UUID for id if not already set
                    document_id = new_document.id if new_document.id else uuid.uuid4()
                    # Handle property_id - create property if needed (same logic as above)
                    property_id_value = new_document.property_id
                    if property_id_value:
                        existing_property_check = Property.query.filter_by(id=property_id_value).first()
                        if not existing_property_check:
                            # Try to create property in raw SQL path too
                            property_address = request.form.get('property_address')
                            property_latitude = request.form.get('property_latitude')
                            property_longitude = request.form.get('property_longitude')
                            
                            if property_address:
                                from .services.address_service import AddressNormalizationService
                                address_service = AddressNormalizationService()
                                normalized_address = address_service.normalize_address(property_address)
                                address_hash = address_service.compute_address_hash(normalized_address)
                                
                                latitude = None
                                longitude = None
                                if property_latitude:
                                    try:
                                        latitude = float(property_latitude)
                                    except (ValueError, TypeError):
                                        pass
                                if property_longitude:
                                    try:
                                        longitude = float(property_longitude)
                                    except (ValueError, TypeError):
                                        pass
                                
                                # Insert property using raw SQL
                                # Property table is 'property' (lowercase, no __tablename__ override)
                                property_insert_sql = text("""
                                    INSERT INTO property (id, business_id, address_hash, normalized_address, formatted_address, latitude, longitude, geocoding_status, geocoding_confidence, created_at, updated_at)
                                    VALUES (CAST(:id AS UUID), CAST(:business_id AS UUID), :address_hash, :normalized_address, :formatted_address, :latitude, :longitude, :geocoding_status, :geocoding_confidence, now(), now())
                                    ON CONFLICT (id) DO NOTHING
                                """)
                                db.session.execute(property_insert_sql, {
                                    'id': str(property_id_value),
                                    'business_id': str(business_uuid),
                                    'address_hash': address_hash,
                                    'normalized_address': normalized_address,
                                    'formatted_address': property_address,
                                    'latitude': latitude,
                                    'longitude': longitude,
                                    'geocoding_status': 'provided' if latitude and longitude else 'pending',
                                    'geocoding_confidence': 1.0 if latitude and longitude else 0.0
                                })
                                db.session.flush()
                                logger.info(f"✅ Created property {property_id_value} in raw SQL path")
                            else:
                                logger.warning(f"Property {property_id_value} does not exist and no address provided, using NULL")
                                property_id_value = None
                    
                    if property_id_value:
                        insert_sql = text("""
                            INSERT INTO document (id, original_filename, s3_path, file_type, file_size, 
                                                 business_id, created_at, status, uploaded_by_user_id, property_id)
                            VALUES (CAST(:id AS UUID), :original_filename, :s3_path, :file_type, :file_size, 
                                    CAST(:business_id AS UUID), now(), :status, :uploaded_by_user_id, CAST(:property_id AS UUID))
                            RETURNING id, created_at
                        """)
                        result = db.session.execute(insert_sql, {
                            'id': str(document_id),
                            'original_filename': filename,
                            's3_path': s3_key,
                            'file_type': file.content_type,
                            'file_size': file.content_length or 0,
                            'business_id': str(business_uuid),
                            'status': 'UPLOADED',
                            'uploaded_by_user_id': current_user.id,
                            'property_id': str(property_id_value)
                        })
                    else:
                        insert_sql = text("""
                            INSERT INTO document (id, original_filename, s3_path, file_type, file_size, 
                                                 business_id, created_at, status, uploaded_by_user_id, property_id)
                            VALUES (CAST(:id AS UUID), :original_filename, :s3_path, :file_type, :file_size, 
                                    CAST(:business_id AS UUID), now(), :status, :uploaded_by_user_id, NULL)
                            RETURNING id, created_at
                        """)
                        result = db.session.execute(insert_sql, {
                            'id': str(document_id),
                            'original_filename': filename,
                            's3_path': s3_key,
                            'file_type': file.content_type,
                            'file_size': file.content_length or 0,
                            'business_id': str(business_uuid),
                            'status': 'UPLOADED',
                            'uploaded_by_user_id': current_user.id
                        })
                    db.session.commit()
                    # Don't reload document object - it will try to SELECT all columns including classification_reasoning
                    # Instead, create a minimal document object with just the ID for the rest of the code
                    new_document = Document()
                    new_document.id = document_id
                    new_document.original_filename = filename
                    new_document.s3_path = s3_key
                    new_document.file_type = file.content_type
                    new_document.file_size = file.content_length or 0
                    new_document.business_id = business_uuid
                    new_document.uploaded_by_user_id = current_user.id
                    new_document.property_id = property_id_value
                    new_document.status = DocumentStatus.UPLOADED
                else:
                    raise  # Re-raise if it's a different error
            
            
            # Sync document to Supabase
            try:
                from .services.document_storage_service import DocumentStorageService
                doc_storage = DocumentStorageService()
                success, doc_id, error = doc_storage.create_document({
                    'id': str(new_document.id),
                    'original_filename': filename,
                    's3_path': s3_key,
                    'file_type': file.content_type,
                    'file_size': file.content_length or 0,
                    'uploaded_by_user_id': str(current_user.id),
                    'business_id': current_user.company_name,
                    'business_uuid': business_uuid_str,
                    'status': 'uploaded'
                })
                if success:
                    # If property_id was provided, create document relationship in Supabase
                    if property_id:
                        try:
                            from .services.supabase_property_hub_service import SupabasePropertyHubService
                            property_hub_service = SupabasePropertyHubService()
                            
                            # Create relationship directly in Supabase
                            relationship_data = {
                                'id': str(uuid.uuid4()),
                                'document_id': str(new_document.id),
                                'property_id': property_id,
                                'relationship_type': 'property_document',
                                'address_source': 'manual_upload',
                                'confidence_score': 1.0,
                                'relationship_metadata': {
                                    'match_type': 'direct_upload',
                                    'matching_service': 'manual_upload',
                                    'match_timestamp': datetime.utcnow().isoformat()
                                },
                                'created_at': datetime.utcnow().isoformat()
                            }
                            
                            result = property_hub_service.supabase.table('document_relationships').insert(relationship_data).execute()
                            if not result.data:
                                logger.warning("Failed to create document relationship in Supabase")
                        except Exception as rel_error:
                            logger.warning(f"Failed to create document relationship (non-fatal): {rel_error}")
                else:
                    logger.warning(f"Failed to sync document to Supabase: {error}")
            except Exception as e:
                logger.warning(f"Supabase sync failed (non-fatal): {e}")
            
            # Trigger processing task (optional - don't fail upload if Redis/Celery unavailable)
            task_id = None
            try:
                file.seek(0)  # Reset file pointer again
                file_content = file.read()

                task = process_document_task.delay(
                    document_id=new_document.id,
                    file_content=file_content,
                    original_filename=filename,
                    business_id=business_uuid_str
                )
                task_id = task.id
            except Exception as e:
                # Don't fail the upload if Celery/Redis is unavailable
                # The document is already created, processing can be retried later
                logger.warning(f"Failed to create processing task (non-fatal): {e}")
            
            # Invalidate/update property card cache if document is linked to a property
            if new_document.property_id:
                try:
                    # Delete existing cache entry - it will be regenerated on next card view
                    try:
                        cache_entry = PropertyCardCache.query.filter_by(property_id=new_document.property_id).first()
                        if cache_entry:
                            db.session.delete(cache_entry)
                            db.session.commit()
                            logger.info(f"Invalidated property card cache for property {new_document.property_id}")
                    except Exception as cache_error:
                        # Cache table doesn't exist - skip cache invalidation
                        logger.debug(f"Cache invalidation skipped (table may not exist): {cache_error}")
                    # Note: Cache will be automatically regenerated when card is next viewed
                except Exception as cache_error:
                    logger.warning(f"Failed to invalidate property card cache: {cache_error}")
                    db.session.rollback()
            
            return jsonify({
                'success': True,
                'document_id': str(new_document.id),
                'message': 'File uploaded successfully' + (' and processing started' if task_id else ' (processing will start when Redis is available)'),
                'task_id': task_id
            }), 200
            
        except Exception as e:
            logger.error(f"Failed to create document record: {e}")
            # Try to clean up S3 file if database record creation fails
            try:
                s3_client.delete_object(Bucket=os.environ['S3_UPLOAD_BUCKET'], Key=s3_key)
            except:
                pass
            return jsonify({'error': f'Failed to create document record: {str(e)}'}), 500
            
    except Exception as e:
        logger.error(f"Proxy upload failed: {e}")
        return jsonify({'error': str(e)}), 500

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

@views.route('/api/files/<uuid:file_id>', methods=['DELETE', 'OPTIONS'])
def delete_file(file_id):
    """
    Alias for /api/document/<uuid:document_id> DELETE - TypeScript frontend compatibility.
    Deletes a document from S3, Supabase stores, and its metadata record from the database.
    """
    if request.method == 'OPTIONS':
        # Handle CORS preflight - no auth needed
        return '', 200
    
    # Apply login_required check for actual DELETE
    if not current_user.is_authenticated:
        return jsonify({'error': 'Unauthorized'}), 401
    
    return delete_document(file_id)

@views.route('/api/document/<uuid:document_id>', methods=['DELETE'])
@login_required
def delete_document(document_id):
    """
    Deletes a document from S3, Supabase stores, and its metadata record from the database.
    """
    document = Document.query.get(document_id)
    if not document:
        return jsonify({'error': 'Document not found'}), 404

    user_business_uuid = _normalize_uuid_str(getattr(current_user, "business_id", None)) or _ensure_business_uuid()
    document_business_uuid = _normalize_uuid_str(getattr(document, "business_id", None))

    if not user_business_uuid:
        logger.warning("Current user has no business UUID; denying delete request.")
        return jsonify({'error': 'Unauthorized'}), 403

    if document_business_uuid != user_business_uuid:
        logger.warning(
            "Document business mismatch (doc=%s, user=%s). Falling back to Supabase verification.",
            document_business_uuid,
            user_business_uuid,
        )
        supabase_business_uuid = None
        try:
            doc_service = SupabaseDocumentService()
            supabase_doc = doc_service.get_document_by_id(str(document_id))
            if supabase_doc:
                supabase_business_uuid = _normalize_uuid_str(
                    supabase_doc.get('business_uuid') or supabase_doc.get('business_id')
                )
        except Exception as supabase_error:
            logger.warning(f"Failed to verify document ownership via Supabase: {supabase_error}")
            supabase_business_uuid = None

        if supabase_business_uuid != user_business_uuid:
            return jsonify({'error': 'Unauthorized'}), 403

        # Align local document row for future requests if missing business_id
        if not document_business_uuid and supabase_business_uuid:
            try:
                document.business_id = UUID(supabase_business_uuid)
                db.session.commit()
                document_business_uuid = supabase_business_uuid
            except Exception as sync_error:
                db.session.rollback()
                logger.warning(f"Failed to sync document business_id locally: {sync_error}")

    deletion_results = {
        's3': False,
        'supabase': False,
        'postgresql': False
    }

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
        return jsonify({'error': 'Server is not configured for file deletion.'}), 500
    
    logger.info("=" * 100)
    logger.info(f"VIEWS.PY - DELETE DOCUMENT ENDPOINT CALLED")
    logger.info(f"Document ID: {document_id}")
    logger.info(f"Filename: {document.original_filename}")
    logger.info(f"Business ID: {document.business_id}")
    logger.info(f"User: {current_user.email}")
    logger.info("=" * 100)
    
    # 2. Delete the object from S3
    logger.info("[S3 DELETION]")
    try:
        s3_key = document.s3_path
        final_url = f"{invoke_url.rstrip('/')}/{bucket_name}/{s3_key}"
        service = 'execute-api'
        aws_auth = AWS4Auth(aws_access_key, aws_secret_key, aws_region, service)

        logger.info(f"   S3 Key: {s3_key}")
        response = requests.delete(final_url, auth=aws_auth)
        response.raise_for_status()
        deletion_results['s3'] = True
        logger.info(f"   SUCCESS: Deleted S3 file: {s3_key}")

    except requests.exceptions.RequestException as e:
        error_message = f"Failed to delete file from S3: {e}"
        logger.error(f"   FAILED: S3 deletion - {e}")
        # Don't return error - continue with other deletions

    # 3. Delete from ALL database stores (Supabase + PostgreSQL properties)
    logger.info("[DATABASE STORES DELETION]")
    try:
        deletion_service = DeletionService()
        all_stores_success, store_results = deletion_service.delete_document_from_all_stores(
            str(document_id), 
            document.business_id
        )
        
        # Update deletion results with individual store statuses
        deletion_results.update(store_results)
        
        if all_stores_success:
            logger.info(f"SUCCESS: All database stores deleted for document {document_id}")
        else:
            logger.warning(f"PARTIAL: Some stores failed for document {document_id}")
            logger.warning(f"   Store results: {store_results}")
            
    except Exception as e:
        error_message = f"Failed to delete from data stores: {e}"
        logger.error(f"   FAILED: Database stores deletion - {e}")
        import traceback
        traceback.print_exc()
        # Don't return error - continue with PostgreSQL document deletion

    # 4. Collect impacted properties, then delete relationships FIRST (before document)
    logger.info("[POSTGRESQL RELATIONSHIPS DELETION]")
    impacted_property_ids = set()
    try:
        from .models import DocumentRelationship
        relationships = DocumentRelationship.query.filter_by(document_id=document_id).all()
        relationship_count = len(relationships)
        impacted_property_ids = {str(rel.property_id) for rel in relationships}
        logger.info(f"   Found {relationship_count} document relationships; impacted properties: {len(impacted_property_ids)}")
        
        # Delete all document relationships for this document
        DocumentRelationship.query.filter_by(document_id=document_id).delete()
        db.session.commit()
        logger.info(f"   SUCCESS: Deleted {relationship_count} document relationships")
    except Exception as e:
        logger.warning(f"   WARNING: Failed to delete document relationships - {e}")
        db.session.rollback()
        # Continue anyway - don't fail the whole deletion
    
    # 5. Delete vectors linked to this document (document vectors + property vectors by source doc)
    logger.info("[VECTORS DELETION]")
    try:
        from .services.vector_service import SupabaseVectorService
        vector_service = SupabaseVectorService()

        dv_ok = vector_service.delete_document_vectors(str(document_id))
        logger.info(f"   Deleted document vectors for {document_id}: {'OK' if dv_ok else 'FAIL'}")

        # Attempt fine-grained property vector deletion per impacted property
        pv_any_ok = False
        if impacted_property_ids:
            for pid in impacted_property_ids:
                pv_ok = vector_service.delete_property_vectors_by_source_document(str(document_id), pid)
                pv_any_ok = pv_any_ok or pv_ok
                logger.info(f"   Property vectors by source doc for property {pid}: {'OK' if pv_ok else 'SKIP/FAIL'}")
        else:
            # If we don't know which property was impacted, attempt global delete by source document id
            pv_any_ok = vector_service.delete_property_vectors_by_source_document(str(document_id))
            logger.info(f"   Property vectors by source doc (no property scope): {'OK' if pv_any_ok else 'SKIP/FAIL'}")
    except Exception as e:
        logger.warning(f"   WARNING: Vector deletion step failed - {e}")

    # 6. Delete local PostgreSQL processing history (after relationships)
    logger.info("[POSTGRESQL PROCESSING HISTORY DELETION]")
    try:
        from .models import DocumentProcessingHistory
        history_count = DocumentProcessingHistory.query.filter_by(document_id=document_id).count()
        logger.info(f"   Found {history_count} processing history entries")
        
        # Delete all processing history entries for this document
        DocumentProcessingHistory.query.filter_by(document_id=document_id).delete()
        db.session.commit()
        logger.info(f"   SUCCESS: Deleted {history_count} processing history entries")
    except Exception as e:
        logger.warning(f"   WARNING: Failed to delete processing history - {e}")
        db.session.rollback()
        # Continue anyway - don't fail the whole deletion
    
    # 7. Recompute property hubs impacted by this deletion
    logger.info("[PROPERTY RECOMPUTE AFTER DOCUMENT DELETION]")
    try:
        if impacted_property_ids:
            from .services.supabase_property_hub_service import SupabasePropertyHubService
            hub_service = SupabasePropertyHubService()
            for pid in impacted_property_ids:
                res = hub_service.recompute_property_after_document_deletion(pid, str(document_id))
                logger.info(f"   Recomputed property {pid}: {res}")
        else:
            logger.info("   No impacted properties detected; skipping recompute")
    except Exception as e:
        logger.warning(f"   WARNING: Property recompute failed - {e}")

    # 8. Remove Supabase property hub records when no documents remain
    logger.info("[SUPABASE PROPERTY HUB CLEANUP]")
    orphaned_supabase_props = _cleanup_orphan_supabase_properties(impacted_property_ids)
    if orphaned_supabase_props:
        logger.info(f"   Removed Supabase property hub data for properties: {orphaned_supabase_props}")
    else:
        logger.info("   No Supabase properties required cleanup")

    # 8. Delete the PostgreSQL document record
    logger.info("[POSTGRESQL DOCUMENT RECORD DELETION]")
    try:
        logger.info(f"   Deleting document record: {document_id}")
        db.session.delete(document)
        db.session.commit()
        deletion_results['postgresql'] = True
        logger.info(f"   SUCCESS: Deleted PostgreSQL record")
        
    except Exception as e:
        db.session.rollback()
        error_message = f"Failed to delete database record: {e}"
        logger.error(f"   FAILED: PostgreSQL record deletion - {e}")
        return jsonify({'error': 'Failed to delete database record.'}), 500

    # 9. Return comprehensive results
    success_count = sum(deletion_results.values())
    total_operations = len(deletion_results)
    
    logger.info("=" * 100)
    logger.info(f"FINAL DELETION RESULTS:")
    logger.info(f"   Total operations: {total_operations}")
    logger.info(f"   Successful: {success_count}")
    logger.info(f"   Failed: {total_operations - success_count}")
    logger.info(f"   Details: {deletion_results}")
    logger.info("=" * 100)
    
    response_data = {
        'message': f'Deletion completed: {success_count}/{total_operations} operations successful',
        'results': deletion_results,
        'document_id': str(document_id)
    }
    
    if success_count == total_operations:
        return jsonify(response_data), 200
    else:
        response_data['warning'] = 'Some deletion operations failed'
        return jsonify(response_data), 207  # 207 Multi-Status

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
        sort_by = request.args.get('sort_by', 'created_at')  # created_at, completeness_score, address
        sort_order = request.args.get('sort_order', 'desc')  # asc, desc
        
        # Track performance
        start_time = time.time()
        
        # OPTIMIZATION: Use OptimizedSupabasePropertyHubService to eliminate N+1 queries
        # This reduces queries from 25+ (N+1) to just 4 batch queries (100x faster)
        from .services.optimized_property_hub_service import OptimizedSupabasePropertyHubService
        
        optimized_service = OptimizedSupabasePropertyHubService()
        property_hubs = optimized_service.get_all_property_hubs_optimized(
            business_uuid_str,
            limit=limit,
            offset=offset
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
        # Gracefully handle missing cache table
        if use_cache:
            try:
                cache_entry = PropertyCardCache.query.filter_by(property_id=property_id).first()
                if cache_entry:
                    return jsonify({
                        'success': True,
                        'data': cache_entry.card_data,
                        'cached': True,
                        'cache_version': cache_entry.cache_version,
                        'updated_at': cache_entry.updated_at.isoformat() if cache_entry.updated_at else None
                    }), 200
            except Exception as cache_error:
                # Cache table doesn't exist or other cache error - continue without cache
                logger.debug(f"Cache lookup failed (table may not exist): {cache_error}")
                pass
        
        supabase = get_supabase_client()
        
        # OPTIMIZATION: Execute queries in parallel using ThreadPoolExecutor
        # This reduces total latency from sum of queries to max of queries
        def fetch_property():
            return (
                supabase.table('properties')
                .select('id, formatted_address, latitude, longitude')
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
        card_data = {
            'id': property_data.get('id'),
            'address': property_data.get('formatted_address', ''),
            'latitude': property_data.get('latitude'),
            'longitude': property_data.get('longitude'),
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
                cache_entry = PropertyCardCache.query.filter_by(property_id=property_id).first()
            except Exception as query_error:
                # If query fails, cache_entry remains None
                logger.debug(f"Cache query failed (table may not exist): {query_error}")
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
        logger.error(f"Error getting property card summary {property_id}: {e}")
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
        
        address_data = {
            'address_hash': address_hash,
            'normalized_address': normalized_address,
            'formatted_address': formatted_address,
            'latitude': float(data['latitude']),
            'longitude': float(data['longitude']),
            'geocoding_status': 'manual',
            'geocoding_confidence': 1.0
        }
        
        property_id = str(uuid.uuid4())
        property_data = service._create_supabase_property(property_id, address_data, business_uuid_str)
        
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
        # Get document
        document = Document.query.get_or_404(document_id)
        
        # Verify business access
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str or str(document.business_id) != business_uuid_str:
            return jsonify({
                'success': False,
                'error': 'Unauthorized'
            }), 403
        
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
                Key=document.s3_path
            )
            # For quick extraction, we'll use filename and basic text extraction
            # Full extraction would require processing the file
            document_text = response['Body'].read().decode('utf-8', errors='ignore')[:10000]  # First 10KB
        except Exception as e:
            logger.warning(f"Could not read document from S3 for address extraction: {e}")
        
        # Use fallback extraction to get address
        from .tasks import _fallback_text_extraction
        extracted_data = _fallback_text_extraction(document_text, document.original_filename)
        
        # Get address from extracted data
        address = None
        if extracted_data.get('extracted_address'):
            address = extracted_data['extracted_address']
        elif extracted_data.get('address'):
            address = extracted_data['address']
        
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


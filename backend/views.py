from flask import Blueprint, render_template, request, flash, redirect, url_for, jsonify, current_app, Response, make_response
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
import tempfile
from .tasks import process_document_task, process_document_fast_task
from backend.llm.evidence_feedback import (
    build_feedback_instruction,
    extract_feedback_from_answer,
    match_feedback_to_chunks,
    EVIDENCE_FEEDBACK_START,
)
from backend.utils.bbox import ensure_bbox_dict, summarize_bbox
from .services.deletion_service import DeletionService
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, ProgrammingError, DatabaseError
from sqlalchemy.orm import load_only
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


def _extract_citation_context(text: str, citation_num: str, context_chars: int = 150) -> str:
    """
    Extract text immediately preceding a citation to identify what's being cited.
    
    Args:
        text: The full text containing citations
        citation_num: The citation number to look for (e.g., "1" for [1])
        context_chars: Number of characters to extract before the citation
        
    Returns:
        The text context before the citation, or None if not found
    """
    import re
    # Pattern to find text before the specific citation
    pattern = rf'(.{{0,{context_chars}}})\[{citation_num}\]'
    match = re.search(pattern, text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return None


def _find_best_chunk_for_citation(context_text: str, source_chunks: list, logger=None) -> dict:
    """
    Find the chunk that best matches the citation context using text matching.
    
    This solves the problem where citations were always mapped to the first chunk,
    even when the actual cited information (like "£2,400,000") is in a different chunk.
    
    Args:
        context_text: Text extracted from near the citation (e.g., "The sale price is £2,400,000")
        source_chunks: List of chunk metadata dicts with 'content', 'page_number', 'bbox', etc.
        logger: Optional logger for debugging
        
    Returns:
        The best matching chunk dict, or the first chunk if no match found
    """
    import re
    from difflib import SequenceMatcher
    
    if not source_chunks:
        return None
    
    if not context_text:
        if logger:
            logger.debug("[CHUNK_MATCH] No context text, using first chunk")
        return source_chunks[0]
    
    # Extract key patterns that are likely to be unique identifiers
    key_patterns = [
        r'£[\d,]+(?:\.\d{2})?',  # Prices: £2,400,000
        r'\$[\d,]+(?:\.\d{2})?',  # Dollar prices
        r'\d{1,2}(?:st|nd|rd|th)?\s+\w+\s+\d{4}',  # Dates: 9th February 2024
        r'\d+(?:,\d{3})+(?:\.\d+)?',  # Large numbers with commas: 5,691
        r'\d+\.\d+\s*(?:sq\s*ft|sqft|acres?|hectares?)',  # Measurements
        r'\b\d{4,}\b',  # 4+ digit numbers (years, codes, etc.)
    ]
    
    key_phrases = []
    for pattern in key_patterns:
        matches = re.findall(pattern, context_text, re.IGNORECASE)
        key_phrases.extend(matches)
    
    # Also extract significant words (4+ chars, excluding common words)
    common_words = {'this', 'that', 'with', 'from', 'have', 'been', 'were', 'will', 'their', 'would', 'about', 'which', 'there', 'other'}
    words = re.findall(r'\b[A-Za-z]{4,}\b', context_text)
    significant_words = [w for w in words if w.lower() not in common_words][-5:]  # Last 5 significant words
    key_phrases.extend(significant_words)
    
    # Separate numeric/currency phrases from generic words
    numeric_phrases = []
    word_phrases = []
    for phrase in key_phrases:
        if re.search(r'[£$]|\d', phrase):
            numeric_phrases.append(phrase)
        else:
            word_phrases.append(phrase)
    
    if logger:
        logger.info(
            "[CHUNK_MATCH] Context excerpt='%s...' | numeric=%s | words=%s",
            context_text[:120],
            numeric_phrases[:5],
            word_phrases[:5]
        )
    
    context_text_lower = context_text.lower()
    # Score each chunk by how many key phrases it contains
    best_chunk = source_chunks[0]
    best_score = 0
    
    for chunk in source_chunks:
        chunk_content = chunk.get('content', '')
        if not chunk_content:
            continue
            
        score = 0
        matched_phrases = []
        lowered_chunk = chunk_content.lower()
        
        # Numeric/currency matches get highest weight
        for phrase in numeric_phrases:
            if phrase and phrase in chunk_content:
                score += 5
                matched_phrases.append(phrase)
        
        # Word/phrase matches (case-insensitive)
        for phrase in word_phrases:
            if phrase.lower() in lowered_chunk:
                score += 1
                matched_phrases.append(phrase)
        
        # Fuzzy overlap between context text and chunk snippet
        snippet_length = max(200, len(context_text) * 2)
        snippet = lowered_chunk[:snippet_length]
        if snippet:
            similarity = SequenceMatcher(None, context_text_lower, snippet).ratio()
            if similarity > 0.2:
                score += similarity * 2  # modest boost for contextual overlap
        
        # Bonus if chunk page already referenced by citation number (page heuristics)
        if chunk.get('page_number') and str(chunk.get('page_number')) in context_text:
            score += 1
        
        if logger:
            logger.debug(
                "[CHUNK_MATCH] Chunk idx=%s page=%s score=%.3f matches=%s",
                chunk.get('chunk_index'),
                chunk.get('page_number'),
                score,
                matched_phrases[:5]
            )
        
        if score > best_score:
            best_score = score
            best_chunk = chunk
            if logger:
                logger.debug(f"[CHUNK_MATCH] New best chunk: page {chunk.get('page_number')}, score {score}, matches: {matched_phrases[:5]}")
    
    # If no score improvements but we have numeric phrases, fall back to first chunk containing them
    if best_score == 0 and numeric_phrases:
        for phrase in numeric_phrases:
            for chunk in source_chunks:
                if phrase in chunk.get('content', ''):
                    if logger:
                        logger.info(f"[CHUNK_MATCH] Fallback: selecting chunk on page {chunk.get('page_number')} for numeric phrase {phrase}")
                    return chunk
    
    if logger:
        logger.info(
            "[CHUNK_MATCH] Selected chunk idx=%s page=%s score=%.3f for context='%s...'",
            best_chunk.get('chunk_index'),
            best_chunk.get('page_number'),
            best_score,
            context_text[:80]
        )
    
    return best_chunk


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
                        return f"Searching for {target_str} in {name_str} documents"
                    else:
                        return f"Searching for {target_str}"
                
                intent_message = extract_query_intent(query)
                
                # Helper function to generate contextual narration using fast LLM
                async def generate_context_narration(moment: str, context_data: dict) -> str:
                    """Generate a short contextual sentence explaining what's happening."""
                    try:
                        from openai import AsyncOpenAI
                        
                        client = AsyncOpenAI()
                        
                        # Build prompt based on moment
                        if moment == 'documents_found':
                            doc_count = context_data.get('doc_count', 0)
                            doc_names = context_data.get('doc_names', [])
                            doc_types = context_data.get('doc_types', [])
                            user_query = context_data.get('user_query', '')
                            
                            prompt = f"""Based on this user query: "{user_query}"
I found {doc_count} document(s): {', '.join(doc_names[:3])}.
Document types: {', '.join(set(doc_types[:3])) if doc_types else 'various'}.

Generate a single, natural sentence (max 20 words) explaining what I found and why it might be relevant. 
Start with "I found" or "Looking at". Be specific about the document types if relevant.
Do not use quotes around the response."""
                        
                        elif moment == 'documents_processed':
                            doc_count = context_data.get('doc_count', 0)
                            user_query = context_data.get('user_query', '')
                            
                            prompt = f"""User asked: "{user_query}"
I just finished reading {doc_count} document(s).

Generate a single, natural sentence (max 15 words) saying I extracted the relevant information.
Start with "Extracted" or "Found". Be brief and confident.
Do not use quotes around the response."""
                        
                        else:
                            return ""
                        
                        # Use gpt-4o-mini for speed
                        response = await client.chat.completions.create(
                            model="gpt-4o-mini",
                            messages=[
                                {"role": "system", "content": "You are a helpful assistant that generates brief, natural explanations. Be concise and conversational."},
                                {"role": "user", "content": prompt}
                            ],
                            max_tokens=50,
                            temperature=0.7
                        )
                        
                        result = response.choices[0].message.content.strip()
                        # Remove any quotes that might have been added
                        result = result.strip('"\'')
                        return result
                    except Exception as e:
                        logger.warning(f"Failed to generate context narration: {e}")
                        return ""
                
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
                                        existing_doc_count = len(prev_docs) if prev_docs else 0
                                        logger.info(f"🟡 [STREAM] Follow-up query detected! Previous docs: {existing_doc_count}")
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
                                            'action_type': node_messages[node_name]['action_type'],
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
                                            # Extract document names and metadata for display and preview cards
                                            doc_names = []
                                            doc_previews = []  # Full metadata for preview cards
                                            for doc in relevant_docs[:5]:  # Max 5 documents
                                                filename = doc.get('original_filename', '')
                                                classification_type = doc.get('classification_type', 'Document')
                                                doc_id = doc.get('doc_id', '')
                                                
                                                if filename:
                                                    # Truncate long filenames for the message
                                                    display_name = filename
                                                    if len(display_name) > 30:
                                                        display_name = display_name[:27] + '...'
                                                    doc_names.append(display_name)
                                                    
                                                    # Full metadata for preview card (include download URL for frontend)
                                                    doc_previews.append({
                                                        'doc_id': doc_id,
                                                        'original_filename': filename,
                                                        'classification_type': classification_type,
                                                        'page_range': doc.get('page_range', ''),
                                                        'page_numbers': doc.get('page_numbers', []),
                                                        's3_path': doc.get('s3_path', ''),
                                                        'download_url': f"/api/files/download?document_id={doc_id}" if doc_id else ''
                                                    })
                                            
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
                                            
                                            # Generate contextual narration for documents found
                                            try:
                                                doc_types = [doc.get('classification_type', 'Document') for doc in relevant_docs[:5]]
                                                context_message = await generate_context_narration('documents_found', {
                                                    'doc_count': doc_count,
                                                    'doc_names': doc_names,
                                                    'doc_types': doc_types,
                                                    'user_query': query
                                                })
                                                if context_message:
                                                    context_data = {
                                                        'type': 'reasoning_context',
                                                        'message': context_message,
                                                        'moment': 'documents_found'
                                                    }
                                                    yield f"data: {json.dumps(context_data)}\n\n"
                                            except Exception as ctx_err:
                                                logger.warning(f"Failed to generate context narration: {ctx_err}")
                                    
                                    elif node_name == "process_documents":
                                        state_data = state_update if state_update else output
                                        doc_outputs = state_data.get("document_outputs", [])
                                        doc_outputs_count = len(doc_outputs)
                                        if doc_outputs_count > 0:
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
                                                    filename = doc_output.get('original_filename', '')
                                                    display_filename = filename
                                                    if not display_filename:
                                                        display_filename = f'Document {i + 1}'
                                                    else:
                                                        # Truncate long filenames for display
                                                        if len(display_filename) > 35:
                                                            display_filename = display_filename[:32] + '...'
                                                    
                                                    # Extract document metadata for preview card (include download URL)
                                                    doc_id_for_meta = doc_output.get('doc_id', '')
                                                    doc_metadata = {
                                                        'doc_id': doc_id_for_meta,
                                                        'original_filename': filename,
                                                        'classification_type': doc_output.get('classification_type', 'Document'),
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
                                                            'filename': filename,
                                                            'doc_metadata': doc_metadata
                                                        }
                                                    }
                                                    yield f"data: {json.dumps(reasoning_data)}\n\n"
                                            
                                            # Generate contextual narration after all documents processed
                                            try:
                                                context_message = await generate_context_narration('documents_processed', {
                                                    'doc_count': doc_outputs_count,
                                                    'user_query': query
                                                })
                                                if context_message:
                                                    context_data = {
                                                        'type': 'reasoning_context',
                                                        'message': context_message,
                                                        'moment': 'documents_processed'
                                                    }
                                                    yield f"data: {json.dumps(context_data)}\n\n"
                                            except Exception as ctx_err:
                                                logger.warning(f"Failed to generate context narration: {ctx_err}")
                                    
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
                                                'action_type': node_messages[node_name]['action_type'],
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
                                        output = event_data.get("output", {})
                                        
                                        if node_name == "query_vector_documents":
                                            state_data = state_update if state_update else output
                                            relevant_docs = state_data.get("relevant_documents", [])
                                            doc_count = len(relevant_docs)
                                            if doc_count > 0:
                                                # Extract document names
                                                doc_names = []
                                                for doc in relevant_docs[:5]:
                                                    filename = doc.get('original_filename', '')
                                                    if filename:
                                                        if len(filename) > 30:
                                                            filename = filename[:27] + '...'
                                                        doc_names.append(filename)
                                                
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
                                                    'details': {'documents_found': doc_count, 'document_names': doc_names}
                                                }
                                                yield f"data: {json.dumps(reasoning_data)}\n\n"
                                        
                                        elif node_name == "process_documents":
                                            state_data = state_update if state_update else output
                                            doc_outputs = state_data.get("document_outputs", [])
                                            doc_outputs_count = len(doc_outputs)
                                            if doc_outputs_count > 0:
                                                # Emit individual "Read [filename]" steps with metadata
                                                for i, doc_output in enumerate(doc_outputs):
                                                    filename = doc_output.get('original_filename', '')
                                                    display_filename = filename
                                                    if not display_filename:
                                                        display_filename = f'Document {i + 1}'
                                                    else:
                                                        if len(display_filename) > 35:
                                                            display_filename = display_filename[:32] + '...'
                                                    
                                                    # Extract document metadata for preview card (include download URL)
                                                    doc_id_for_meta = doc_output.get('doc_id', '')
                                                    doc_metadata = {
                                                        'doc_id': doc_id_for_meta,
                                                        'original_filename': filename,
                                                        'classification_type': doc_output.get('classification_type', 'Document'),
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
                                                            'filename': filename,
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
                        
                        prompt_body = f"""You are an AI assistant for real estate and valuation professionals. You help them quickly understand what's inside their documents and how that information relates to their query.

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
- Document excerpts contain [CHUNK:X] markers indicating the source section
- When you use information from a document, cite it using the chunk marker: "£2,400,000[CHUNK:2]" or "5 bedrooms[CHUNK:0]"
- Place citations directly after the figure/knowledge you are citing
- Example: "The asking price is £2,400,000[CHUNK:3] for the property."
- For names, dates, prices, values, measurements: place citation immediately after that specific information
- If information comes from multiple chunks, cite all: "The property has 5 bedrooms[CHUNK:0][CHUNK:4]"
- Citations should appear inline, naturally within your response
- Only cite when you actually use information from a chunk - do not add unnecessary citations
- IMPORTANT: Use the exact [CHUNK:X] format where X is the chunk number

Focus on what matters in real estate:
- Valuations, specifications, location, condition, risks, opportunities, deal terms, and comparable evidence.

CRITICAL RULES:
1. **Do NOT repeat the user's question as a heading or title** - The user can see their own query, so start directly with the answer.
2. **Do NOT add "Additional Context" sections** - Only provide context if the user explicitly asks for it.
3. **Do NOT add unsolicited insights or recommendations** - Answer only what was asked.
4. **Do NOT add "Next steps" or follow-up suggestions** - Answer the question and stop.
5. **Always cite your sources** - Use [CHUNK:X] markers after each fact that comes from a document.

Start with a clear, direct answer to the user's question. Provide only the information requested - nothing more.

TONE

Professional, concise, helpful, human, and grounded in the documents — not robotic or over-structured.

Now provide your response (answer directly, no heading, no additional context, with citations):"""
                        prompt = f"{prompt_body}\n\n{build_feedback_instruction()}"
                        
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
                        visible_sent_length = 0
                        feedback_started = False
                        for chunk in llm.stream(prompt):
                            chunk_count += 1
                            if chunk_count == 1:
                                logger.info("🟡 [STREAM] First chunk received from LLM")
                            if chunk.content:
                                token = chunk.content
                                full_summary += token

                                if feedback_started:
                                    continue

                                feedback_idx = full_summary.find(EVIDENCE_FEEDBACK_START)
                                if feedback_idx != -1:
                                    feedback_started = True
                                    visible_segment = full_summary[visible_sent_length:feedback_idx]
                                    if visible_segment:
                                        yield f"data: {json.dumps({'type': 'token', 'token': visible_segment})}\n\n"
                                    visible_sent_length = feedback_idx
                                else:
                                    new_segment = full_summary[visible_sent_length:]
                                    if new_segment:
                                        yield f"data: {json.dumps({'type': 'token', 'token': new_segment})}\n\n"
                                        visible_sent_length = len(full_summary)
                        
                        # NEW: Parse citations from LLM response and map to bbox metadata
                        # Strategy: Number citations per unique chunk/bbox, not per document
                        # Each unique chunk gets its own sequential number (1, 2, 3...)
                        feedback_records = []
                        matched_feedback_records = []
                        try:
                            full_summary, feedback_records = extract_feedback_from_answer(full_summary, logger)
                            if feedback_records:
                                matched_feedback_records = match_feedback_to_chunks(feedback_records, doc_outputs, logger)
                                matched_count = sum(1 for record in matched_feedback_records if record.get('matched_chunk'))
                                logger.info(
                                    "[EVIDENCE_FEEDBACK] Streaming summary produced %d feedback record(s); matched %d chunk(s)",
                                    len(feedback_records),
                                    matched_count,
                                )
                        except Exception as feedback_err:
                            logger.warning(f"[EVIDENCE_FEEDBACK] Failed to parse streaming feedback: {feedback_err}")
                            feedback_records = []
                            matched_feedback_records = []

                        citations_data = {}  # Initialize to empty dict
                        try:
                            # NEW: First try to parse [CHUNK:X] citations (direct chunk mapping)
                            chunk_citation_pattern = r'\[CHUNK:(\d+)(?::PAGE:\d+)?\]'
                            chunk_citations_found = re.findall(chunk_citation_pattern, full_summary)
                            
                            if chunk_citations_found and doc_outputs:
                                # Direct chunk citation mapping - map [CHUNK:X] to source_chunks_metadata[X]
                                logger.info(f"🟢 [CITATIONS] Found {len(chunk_citations_found)} chunk citations: {chunk_citations_found}")
                                
                                # Build citations_data directly from chunk indices
                                sequential_cit_num = 1
                                chunk_idx_to_cit_num = {}  # Map chunk index to citation number
                                
                                # For now, assume all chunks come from the first document (most common case)
                                # TODO: Handle multi-document chunk citations if needed
                                primary_output = doc_outputs[0]
                                doc_id = primary_output.get('doc_id') or ''
                                source_chunks = primary_output.get('source_chunks_metadata', [])
                                
                                for chunk_idx_str in chunk_citations_found:
                                    chunk_idx = int(chunk_idx_str)
                                    
                                    # Skip if already processed
                                    if chunk_idx in chunk_idx_to_cit_num:
                                        continue
                                    
                                    # Map to sequential citation number
                                    cit_num = str(sequential_cit_num)
                                    chunk_idx_to_cit_num[chunk_idx] = cit_num
                                    sequential_cit_num += 1
                                    
                                    # Get the chunk metadata - chunk_idx is the marker index (0, 1, 2...)
                                    # which corresponds to position in source_chunks array
                                    if chunk_idx < len(source_chunks):
                                        chunk = source_chunks[chunk_idx]
                                        chunk_content_preview = (chunk.get('content') or '')[:100].replace('\n', ' ')
                                        
                                        # IMPROVED: Extract the MAIN value from the clause containing this citation
                                        # LLM often puts citation at end: "£2,300,000 as of 12th February 2024 [1]"
                                        # We need to find the PRICE in that clause, not just what's immediately before
                                        citation_context = None
                                        citation_value = None  # Extracted numeric value for precise matching
                                        value_type = None  # 'price', 'date', or 'other'
                                        
                                        # Step 1: Extract the clause/sentence containing this [CHUNK:X]
                                        # Look for text between previous citation (or start) and this citation
                                        clause_pattern = r'(?:^|[.!?]\s*|\[CHUNK:\d+\]\s*)([^.!?]*?)\[CHUNK:' + str(chunk_idx) + r'\]'
                                        clause_match = re.search(clause_pattern, full_summary, re.IGNORECASE)
                                        clause_text = clause_match.group(1) if clause_match else full_summary
                                        
                                        logger.info(f"🔍 [CITATIONS] Clause for CHUNK:{chunk_idx}: '{clause_text[:80]}...'")
                                        
                                        # Step 2: Find ALL prices in this clause (prioritize prices over dates)
                                        prices_in_clause = re.findall(r'[£$€]([\d,]+(?:\.\d+)?(?:\s*(?:million|m|k|thousand))?)', clause_text, re.IGNORECASE)
                                        
                                        if prices_in_clause:
                                            # Pick the largest price (main value)
                                            best_price = None
                                            best_value = 0
                                            for price in prices_in_clause:
                                                try:
                                                    numeric = int(re.sub(r'[,.\s]', '', re.sub(r'[a-zA-Z]', '', price)))
                                                    if numeric > best_value:
                                                        best_value = numeric
                                                        best_price = price
                                                except:
                                                    pass
                                            
                                            if best_price:
                                                citation_context = f"£{best_price}"
                                                citation_value = str(best_value)
                                                value_type = 'price'
                                                logger.info(f"💰 [CITATIONS] Extracted price for CHUNK:{chunk_idx}: {citation_context} -> {citation_value}")
                                        
                                        # Step 3: If no price found, look for dates
                                        if not citation_value:
                                            date_match = re.search(
                                                r'(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})',
                                                clause_text, re.IGNORECASE
                                            )
                                            if date_match:
                                                citation_context = date_match.group(1)
                                                citation_value = citation_context.lower()
                                                value_type = 'date'
                                                logger.info(f"📅 [CITATIONS] Extracted date for CHUNK:{chunk_idx}: {citation_context}")
                                        
                                        # Step 4: Fallback - extract any significant number
                                        if not citation_value:
                                            num_match = re.search(r'([\d,]+(?:\.\d+)?)', clause_text)
                                            if num_match:
                                                citation_context = num_match.group(1)
                                                citation_value = re.sub(r'[,]', '', citation_context)
                                                value_type = 'other'
                                                logger.info(f"📝 [CITATIONS] Extracted number for CHUNK:{chunk_idx}: {citation_context}")
                                        
                                        # Try to find matching block with precise BBOX
                                        precise_bbox = chunk.get('bbox')  # Default to chunk BBOX
                                        precise_page = chunk.get('page_number')
                                        if citation_context:
                                            try:
                                                # Query document's reducto_chunks for block-level BBOX
                                                from backend.services.supabase_client_factory import get_supabase_client
                                                supabase = get_supabase_client()
                                                doc_result = supabase.table('documents').select('document_summary').eq('id', doc_id).single().execute()
                                                
                                                if doc_result.data and doc_result.data.get('document_summary'):
                                                    reducto_chunks = doc_result.data['document_summary'].get('reducto_chunks', [])
                                                    
                                                    # Prepare search value based on type
                                                    search_value = citation_value if citation_value else re.sub(r'[£$€,\s]', '', citation_context.lower())
                                                    logger.info(f"🔍 [CITATIONS] Searching for '{search_value}' (type={value_type}, context='{citation_context}')")
                                                    
                                                    # Search ALL blocks in ALL chunks to find the exact value
                                                    best_block = None
                                                    best_score = float('inf')  # Lower score = more precise (smaller area)
                                                    
                                                    for rc in reducto_chunks:
                                                        blocks = rc.get('blocks', [])
                                                        for block in blocks:
                                                            block_content = block.get('content', '')
                                                            block_content_lower = block_content.lower()
                                                            block_content_normalized = re.sub(r'[£$€,\s]', '', block_content_lower)
                                                            
                                                            # Check if block contains the cited value
                                                            block_matches = False
                                                            match_quality = 1.0  # Lower = better
                                                            
                                                            if value_type == 'price':
                                                                # For prices, match the numeric value
                                                                if citation_value and citation_value in block_content_normalized:
                                                                    block_matches = True
                                                                    # Bonus if currency symbol is present
                                                                    if re.search(r'[£$€]', block_content):
                                                                        match_quality *= 0.5
                                                            
                                                            elif value_type == 'date':
                                                                # For dates, match the date text more flexibly
                                                                # Extract just month and year for matching
                                                                date_parts = re.search(r'(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})', citation_value)
                                                                if date_parts:
                                                                    month = date_parts.group(1)
                                                                    year = date_parts.group(2)
                                                                    if month in block_content_lower and year in block_content:
                                                                        block_matches = True
                                                                        # Bonus if full date with day is present
                                                                        if re.search(r'\d{1,2}(st|nd|rd|th)?\s*' + month, block_content_lower):
                                                                            match_quality *= 0.5
                                                            
                                                            else:
                                                                # General matching
                                                                if citation_value and citation_value in block_content_normalized:
                                                                    block_matches = True
                                                                elif search_value in block_content_normalized:
                                                                    block_matches = True
                                                            
                                                            if block_matches:
                                                                block_bbox = block.get('bbox')
                                                                if block_bbox and isinstance(block_bbox, dict):
                                                                    # Calculate block area (width * height) - smaller = more precise
                                                                    block_width = block_bbox.get('width', 1) or 1
                                                                    block_height = block_bbox.get('height', 1) or 1
                                                                    block_area = block_width * block_height
                                                                    
                                                                    # Score combines area and match quality
                                                                    score = block_area * match_quality
                                                                    
                                                                    # Bonus for short blocks (more precise)
                                                                    if len(block_content) < 50:
                                                                        score *= 0.3
                                                                    elif len(block_content) < 100:
                                                                        score *= 0.5
                                                                    
                                                                    if score < best_score:
                                                                        best_score = score
                                                                        best_block = block
                                                    
                                                    if best_block:
                                                        precise_bbox = best_block.get('bbox')
                                                        precise_page = precise_bbox.get('page') or precise_bbox.get('original_page')
                                                        block_content_preview = (best_block.get('content') or '')[:80].replace('\n', ' ')
                                                        bbox_summary = summarize_bbox(precise_bbox)
                                                        logger.info(
                                                            f"🎯 [CITATIONS] Found PRECISE block BBOX for '{citation_context}' on page {precise_page}: "
                                                            f"bbox={bbox_summary}, content='{block_content_preview}'"
                                                        )
                                                    else:
                                                        logger.warning(f"⚠️ [CITATIONS] Could not find block containing '{search_value}' in document blocks")
                                            except Exception as e:
                                                logger.debug(f"Could not fetch block-level BBOX: {e}, using chunk BBOX")
                                        
                                        chunk_metadata = {
                                            'doc_id': doc_id,
                                            'chunk_index': chunk.get('chunk_index'),
                                            'page_number': precise_page or chunk.get('page_number'),  # Use precise block's page if found
                                            'bbox': precise_bbox,  # Use precise block BBOX if found
                                            'content': (chunk.get('content') or '')[:500],
                                            'match_reason': 'precise_block_citation' if precise_page else 'direct_chunk_citation'
                                        }
                                        
                                        citations_data[cit_num] = {
                                            'doc_id': doc_id,
                                            'original_filename': primary_output.get('original_filename'),
                                            'property_address': primary_output.get('property_address'),
                                            'page_range': primary_output.get('page_range'),
                                            'classification_type': primary_output.get('classification_type'),
                                            'source_chunks_metadata': [chunk_metadata],
                                            'matched_chunk_metadata': chunk_metadata,
                                            'chunk_metadata': chunk_metadata,
                                            'candidate_chunks_metadata': source_chunks,
                                            'match_reason': 'direct_chunk_citation',
                                            'evidence_feedback': []
                                        }
                                        
                                        bbox_summary = summarize_bbox(chunk.get('bbox'))
                                        logger.info(
                                            f"🟢 [CITATIONS] Mapped [CHUNK:{chunk_idx}] -> citation [{cit_num}], "
                                            f"db_chunk_index={chunk.get('chunk_index')}, page={chunk.get('page_number')}, "
                                            f"bbox={bbox_summary}, content_preview='{chunk_content_preview}...'"
                                        )
                                    else:
                                        logger.warning(f"🟡 [CITATIONS] Chunk index {chunk_idx} out of range (max: {len(source_chunks)-1})")
                                
                                # Replace [CHUNK:X] with [N] in the summary for frontend display
                                def replace_chunk_citation(match):
                                    chunk_idx = int(match.group(1))
                                    if chunk_idx in chunk_idx_to_cit_num:
                                        return f"[{chunk_idx_to_cit_num[chunk_idx]}]"
                                    return match.group(0)
                                
                                full_summary = re.sub(chunk_citation_pattern, replace_chunk_citation, full_summary)
                                logger.info(f"🟢 [CITATIONS] Replaced chunk citations in response. citations_data has {len(citations_data)} entries")
                            
                            # FALLBACK: If no chunk citations, try old [1], [2] format
                            elif not chunk_citations_found:
                                citation_pattern = r'\[(\d+)\]'
                                citations_found = re.findall(citation_pattern, full_summary)
                            else:
                                citations_found = []
                            
                            # If no documents, skip citation processing
                            if not citation_map and not chunk_citations_found:
                                logger.info("🟡 [CITATIONS] No documents found, skipping citation processing")
                            # If chunk citations were already processed, skip old logic
                            elif chunk_citations_found and citations_data:
                                logger.info(f"🟢 [CITATIONS] Chunk citations already processed ({len(citations_data)} entries), skipping old logic")
                            # OPTIMIZATION: For single document with [1] citation, create citation data directly
                            elif len(doc_outputs) == 1 and '1' in citations_found:
                                logger.info("🟡 [CITATIONS] Single document detected - creating citation [1] directly")
                                single_output = doc_outputs[0]
                                doc_id = single_output.get('doc_id') or ''
                                source_chunks = single_output.get('source_chunks_metadata', [])
                                
                                if doc_id and source_chunks:
                                    # IMPROVED: Find chunk that best matches the LLM response content
                                    best_chunk = None
                                    best_match_score = 0
                                    
                                    # Extract key values from summary (prices, dates, percentages)
                                    summary_lower = full_summary.lower()
                                    price_pattern = r'£[\d,]+(?:\.\d+)?(?:\s*(?:million|m|k))?|\d+(?:,\d{3})+(?:\.\d+)?'
                                    summary_values = set(re.findall(price_pattern, full_summary, re.IGNORECASE))
                                    
                                    for chunk in source_chunks:
                                        if not chunk.get('bbox'):
                                            continue
                                        chunk_content = (chunk.get('content') or '').lower()
                                        if not chunk_content:
                                            continue
                                        
                                        score = 0
                                        # Strong match for exact values (prices, figures)
                                        for value in summary_values:
                                            if value.lower() in chunk_content:
                                                score += 10
                                        
                                        # Word overlap scoring
                                        summary_words = set(summary_lower.split())
                                        chunk_words = set(chunk_content.split())
                                        common = summary_words & chunk_words - {'the', 'a', 'an', 'is', 'was', 'are', 'were', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'at', 'by'}
                                        score += len(common)
                                        
                                        if score > best_match_score:
                                            best_match_score = score
                                            best_chunk = chunk
                                    
                                    # Fallback to first chunk with bbox if no good match
                                    if not best_chunk:
                                        for chunk in source_chunks:
                                            if chunk.get('bbox'):
                                                best_chunk = chunk
                                                break
                                    if not best_chunk and source_chunks:
                                        best_chunk = source_chunks[0]
                                    
                                    logger.info(f"🔍 [CITATIONS] Best chunk match score: {best_match_score}, chunk_idx: {best_chunk.get('chunk_index') if best_chunk else 'none'}")
                                    
                                    if best_chunk:
                                        matched_chunk_metadata = {
                                            'doc_id': doc_id,
                                            'chunk_index': best_chunk.get('chunk_index'),
                                            'page_number': best_chunk.get('page_number'),
                                            'bbox': best_chunk.get('bbox'),
                                            'content': (best_chunk.get('content') or '')[:500],
                                            'match_reason': 'single_document_fallback'
                                        }
                                        
                                        citations_data['1'] = {
                                            'doc_id': doc_id,
                                            'original_filename': single_output.get('original_filename'),
                                            'property_address': single_output.get('property_address'),
                                            'page_range': single_output.get('page_range'),
                                            'classification_type': single_output.get('classification_type'),
                                            'source_chunks_metadata': [matched_chunk_metadata],
                                            'matched_chunk_metadata': matched_chunk_metadata,
                                            'candidate_chunks_metadata': source_chunks,
                                            'match_reason': 'single_document_fallback',
                                            'evidence_feedback': []
                                        }
                                        logger.info(f"🟢 [CITATIONS] Created citation [1] for single document {doc_id[:8]}, chunk_idx {best_chunk.get('chunk_index')}, bbox: {bool(best_chunk.get('bbox'))}")
                                    else:
                                        logger.warning("🟡 [CITATIONS] Single document has no source_chunks_metadata")
                                else:
                                    logger.warning(f"🟡 [CITATIONS] Single document missing doc_id or source_chunks: doc_id={bool(doc_id)}, chunks={len(source_chunks) if source_chunks else 0}")
                            else:
                                # Step 1: Lazy citation assignment - only create citations for chunks that are actually cited
                                # Key: (doc_id, chunk_index, page_number) -> unique chunk identifier
                                # Value: sequential citation number
                                sequential_num = 1
                                chunk_to_citation = {}  # Map chunk_signature to citation number
                                citation_to_chunks = {}  # Map citation number to chunk metadata
                                
                                # DO NOT pre-assign citations to all chunks
                                # Citations will be created on-demand when:
                                # 1. Evidence feedback matches a chunk
                                # 2. Context matching finds a chunk for a citation
                                # 3. A chunk is explicitly referenced
                                
                                doc_id_to_doc_num = {
                                    meta.get('doc_id'): doc_num_str
                                    for doc_num_str, meta in citation_map.items()
                                    if meta.get('doc_id')
                                }

                                def ensure_chunk_citation_entry(doc_id, chunk, doc_meta, match_source="feedback"):
                                    chunk_index = chunk.get('chunk_index')
                                    page_number = chunk.get('page_number')
                                    signature = (doc_id, chunk_index, page_number)
                                    if signature in chunk_to_citation:
                                        citation_number = str(chunk_to_citation[signature])
                                        entry = citation_to_chunks.get(citation_number)
                                    else:
                                        next_cit_num = (max(chunk_to_citation.values()) if chunk_to_citation else 0) + 1
                                        chunk_to_citation[signature] = next_cit_num
                                        citation_number = str(next_cit_num)
                                        entry = None
                                    
                                    normalized_chunk = {
                                        'doc_id': doc_id,
                                        'chunk_index': chunk_index,
                                        'page_number': page_number,
                                        'bbox': chunk.get('bbox'),
                                        'content': (chunk.get('content') or '')[:500],
                                        'match_reason': chunk.get('match_reason') or match_source
                                    }
                                    bbox_summary = summarize_bbox(normalized_chunk.get('bbox'))
                                    logger.info(
                                        "[BBOX TRACE] %s doc=%s chunk_idx=%s page=%s bbox=%s",
                                        match_source.upper(),
                                        (doc_id or 'unknown')[:8],
                                        chunk_index,
                                        page_number,
                                        bbox_summary,
                                    )
                                    
                                    if entry:
                                        entry['matched_chunk_metadata'] = normalized_chunk
                                        entry['chunk_metadata'] = normalized_chunk
                                        entry['match_reason'] = normalized_chunk['match_reason']
                                        logger.info(
                                            "🟢 [CITATIONS] %s reused citation [%s] for doc %s, chunk_idx %s, page %s (bbox: %s)",
                                            match_source.upper(),
                                            citation_number,
                                            (doc_id or '')[:8],
                                            chunk_index,
                                            page_number,
                                            bool(normalized_chunk.get('bbox')),
                                        )
                                    else:
                                        citation_to_chunks[citation_number] = {
                                            'doc_id': doc_id,
                                            'original_filename': doc_meta.get('original_filename') if doc_meta else None,
                                            'property_address': doc_meta.get('property_address') if doc_meta else None,
                                            'page_range': doc_meta.get('page_range') if doc_meta else None,
                                            'classification_type': doc_meta.get('classification_type') if doc_meta else None,
                                            'chunk_index': chunk_index,
                                            'page_number': page_number,
                                            'candidate_chunks_metadata': doc_meta.get('source_chunks_metadata', []) if doc_meta else [],
                                            'matched_chunk_metadata': normalized_chunk,
                                            'chunk_metadata': normalized_chunk,
                                            'match_reason': normalized_chunk['match_reason']
                                        }
                                        logger.info(
                                            "🟢 [CITATIONS] %s created citation [%s] for doc %s, chunk_idx %s, page %s (bbox: %s)",
                                            match_source.upper(),
                                            citation_number,
                                            (doc_id or '')[:8],
                                            chunk_index,
                                            page_number,
                                            bool(normalized_chunk.get('bbox')),
                                        )
                                    return citation_number

                                feedback_override_map = {}
                                if matched_feedback_records:
                                    for matched_record in matched_feedback_records:
                                        feedback_entry = matched_record.get('feedback') or {}
                                        matched_chunk = matched_record.get('matched_chunk')
                                        if not matched_chunk:
                                            continue
                                        doc_id = feedback_entry.get('doc_id') or matched_chunk.get('doc_id')
                                        if not doc_id:
                                            continue
                                        doc_num_str = doc_id_to_doc_num.get(doc_id)
                                        if not doc_num_str:
                                            continue
                                        doc_meta = citation_map.get(doc_num_str, {})
                                        matched_chunk = {
                                            **matched_chunk,
                                            'match_reason': matched_chunk.get('match_reason') or 'feedback_snippet'
                                        }
                                        citation_number = ensure_chunk_citation_entry(doc_id, matched_chunk, doc_meta, match_source="feedback")
                                        entry = citation_to_chunks.get(citation_number)
                                        if entry:
                                            entry.setdefault('evidence_feedback', []).append(feedback_entry)
                                        label = (feedback_entry.get('citation_label') or '').strip()
                                        if label.startswith('[') and label.endswith(']'):
                                            label_num = label[1:-1]
                                            if label_num == doc_num_str:
                                                feedback_override_map[doc_num_str] = citation_number
                                                logger.info(
                                                    "[EVIDENCE_FEEDBACK] Overriding citation [%s] with chunk citation [%s] based on feedback snippet '%s...'",
                                                    doc_num_str,
                                                    citation_number,
                                                    feedback_entry.get('snippet', '')[:40]
                                                )
                                
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
                                # When we see [1], replace it with the chunk that best matches the cited content
                                # This uses text matching to find the chunk containing the actual cited information
                                
                                # For each document citation, find the BEST matching chunk (not just the first)
                                # by analyzing the text context around the citation
                                for doc_num_str in citations_found:
                                    # Check if feedback override exists first
                                    if doc_num_str in feedback_override_map:
                                        citation_renumber_map[doc_num_str] = feedback_override_map[doc_num_str]
                                        logger.info(
                                            "[EVIDENCE_FEEDBACK] Using feedback override for citation [%s] -> chunk citation [%s]",
                                            doc_num_str,
                                            feedback_override_map[doc_num_str],
                                        )
                                        continue
                                    
                                    # Get the source chunks for this document
                                    doc_citation = citation_map.get(doc_num_str, {})
                                    source_chunks = doc_citation.get('source_chunks_metadata', [])
                                    doc_id = doc_citation.get('doc_id')
                                    
                                    # Extract context text before this citation to identify what's being cited
                                    context_text = _extract_citation_context(full_summary, doc_num_str)
                                    
                                    # Check if we already have chunk citations for this document
                                    chunk_citations = doc_to_chunk_citations.get(doc_num_str, [])
                                    
                                    logger.info(f"🟡 [CITATIONS] Doc [{doc_num_str}]: {len(source_chunks)} chunks available, context: '{context_text[:50] if context_text else 'None'}...', pre-assigned citations: {len(chunk_citations)}")
                                    
                                    # If we only have 1 chunk but have context, try fetching more chunks from DB
                                    if context_text and doc_id and len(source_chunks) <= 1:
                                        logger.info(f"🟡 [CITATIONS] Only {len(source_chunks)} chunk(s) for doc [{doc_num_str}], fetching more from DB...")
                                        try:
                                            # Query Supabase for more chunks from this document
                                            supabase_client = get_supabase_client()
                                            chunks_response = supabase_client.from_('document_vectors')\
                                                .select('chunk_text, chunk_index, page_number, bbox')\
                                                .eq('document_id', doc_id)\
                                                .order('chunk_index')\
                                                .limit(50)\
                                                .execute()
                                            
                                            if chunks_response.data:
                                                # Build extended source_chunks with bbox parsing
                                                extended_chunks = []
                                                for chunk_row in chunks_response.data:
                                                    bbox_val = ensure_bbox_dict(chunk_row.get('bbox'))
                                                    extended_chunks.append({
                                                        'content': chunk_row.get('chunk_text', ''),
                                                        'chunk_index': chunk_row.get('chunk_index'),
                                                        'page_number': chunk_row.get('page_number'),
                                                        'bbox': bbox_val,
                                                        'doc_id': doc_id
                                                    })
                                                source_chunks = extended_chunks
                                                logger.info(f"🟡 [CITATIONS] Fetched {len(extended_chunks)} chunks from DB for doc [{doc_num_str}]")
                                        except Exception as fetch_err:
                                            logger.warning(f"🟡 [CITATIONS] Failed to fetch more chunks: {fetch_err}")
                                    
                                    # Try to match citation to a chunk via context
                                    if context_text and source_chunks and len(source_chunks) > 0:
                                        # Find the chunk that best matches the citation context
                                        best_chunk = _find_best_chunk_for_citation(context_text, source_chunks, logger)
                                        
                                        if best_chunk:
                                                    best_chunk = {
                                                        **best_chunk,
                                                        'match_reason': best_chunk.get('match_reason') or 'context_match'
                                                    }
                                                    # Get the citation number for this specific chunk
                                                    best_doc_id = best_chunk.get('doc_id') or doc_citation.get('doc_id')
                                                    chunk_signature = (
                                                        best_doc_id,
                                                        best_chunk.get('chunk_index'),
                                                        best_chunk.get('page_number')
                                                    )
                                                    
                                                    # Check if this chunk's citation exists, if not create one
                                                    if chunk_signature in chunk_to_citation:
                                                        matched_cit_num = str(chunk_to_citation[chunk_signature])
                                                        citation_renumber_map[doc_num_str] = matched_cit_num
                                                        normalized_best_chunk = {
                                                            **best_chunk,
                                                            'doc_id': best_doc_id
                                                        }
                                                        entry = citation_to_chunks.get(matched_cit_num)
                                                        if entry:
                                                            entry['matched_chunk_metadata'] = normalized_best_chunk
                                                            entry['chunk_metadata'] = normalized_best_chunk
                                                            entry['candidate_chunks_metadata'] = source_chunks
                                                            entry['match_reason'] = best_chunk.get('match_reason') or entry.get('match_reason')
                                                            logger.info(
                                                                "[BBOX TRACE] CONTEXT doc=%s chunk_idx=%s page=%s bbox=%s",
                                                                (best_doc_id or 'unknown')[:8],
                                                                best_chunk.get('chunk_index'),
                                                                best_chunk.get('page_number'),
                                                                summarize_bbox(best_chunk.get('bbox')),
                                                            )
                                                            logger.info(
                                                                f"🟡 [CITATIONS] HEURISTIC matched citation [{doc_num_str}] to chunk on page {best_chunk.get('page_number')} "
                                                                f"(context: '{context_text[:40]}...') -> citation [{matched_cit_num}], "
                                                                f"bbox: {bool(best_chunk.get('bbox'))}"
                                                            )
                                                        else:
                                                            # Create a new citation entry for this chunk
                                                            # Structure must match what the citations_data builder expects:
                                                            # - Top-level: doc_id, original_filename, property_address, page_range, classification_type
                                                            # - chunk_metadata: chunk details including bbox
                                                            next_cit_num = max([int(x) for x in chunk_to_citation.values()] + [0]) + 1
                                                            chunk_to_citation[chunk_signature] = next_cit_num
                                                            
                                                            page_num = best_chunk.get('page_number')
                                                            normalized_best_chunk = {
                                                                'doc_id': best_doc_id,
                                                                'chunk_index': best_chunk.get('chunk_index'),
                                                                'page_number': page_num,
                                                                'bbox': best_chunk.get('bbox'),
                                                                'content': best_chunk.get('content', '')[:500]
                                                            }
                                                            citation_to_chunks[str(next_cit_num)] = {
                                                                'doc_id': best_doc_id,
                                                                'original_filename': doc_citation.get('original_filename'),
                                                                'property_address': doc_citation.get('property_address'),
                                                                'page_range': f"page {page_num}" if page_num else None,
                                                                'classification_type': doc_citation.get('classification_type'),
                                                                'chunk_index': best_chunk.get('chunk_index'),
                                                                'page_number': page_num,
                                                                # Keep the full chunk list we evaluated for traceability
                                                                'candidate_chunks_metadata': source_chunks,
                                                                # chunk_metadata is what gets extracted for source_chunks_metadata
                                                                'matched_chunk_metadata': normalized_best_chunk,
                                                                'chunk_metadata': normalized_best_chunk,
                                                                'match_reason': best_chunk.get('match_reason') or 'context_match'
                                                            }
                                                            citation_renumber_map[doc_num_str] = str(next_cit_num)
                                                            logger.info(
                                                                "[BBOX TRACE] CONTEXT doc=%s chunk_idx=%s page=%s bbox=%s",
                                                                (best_doc_id or 'unknown')[:8],
                                                                best_chunk.get('chunk_index'),
                                                                page_num,
                                                                summarize_bbox(best_chunk.get('bbox')),
                                                            )
                                                            logger.info(
                                                                f"🟡 [CITATIONS] HEURISTIC created NEW citation [{next_cit_num}] for doc {best_doc_id[:8] if best_doc_id else 'unknown'}, "
                                                                f"page {page_num}, chunk_idx {best_chunk.get('chunk_index')}, bbox: {bool(best_chunk.get('bbox'))}"
                                                            )
                                        else:
                                            # No best chunk found via context matching
                                            if chunk_citations:
                                                # Use first pre-assigned chunk citation as fallback
                                                citation_renumber_map[doc_num_str] = chunk_citations[0]
                                                logger.info(
                                                    f"🟡 [CITATIONS] Fallback to first chunk citation [{chunk_citations[0]}] "
                                                    "(no best match found)"
                                                )
                                            elif source_chunks:
                                                # No pre-assigned citations, but we have chunks - create citation for first chunk
                                                first_chunk = source_chunks[0]
                                                chunk_signature = (doc_id, first_chunk.get('chunk_index'), first_chunk.get('page_number'))
                                                if chunk_signature not in chunk_to_citation:
                                                    next_cit_num = max([int(x) for x in chunk_to_citation.values()] + [0]) + 1
                                                    chunk_to_citation[chunk_signature] = next_cit_num
                                                    citation_to_chunks[str(next_cit_num)] = {
                                                        'doc_id': doc_id,
                                                        'original_filename': doc_citation.get('original_filename'),
                                                        'property_address': doc_citation.get('property_address'),
                                                        'page_range': f"page {first_chunk.get('page_number')}" if first_chunk.get('page_number') else None,
                                                        'classification_type': doc_citation.get('classification_type'),
                                                        'chunk_index': first_chunk.get('chunk_index'),
                                                        'page_number': first_chunk.get('page_number'),
                                                        'matched_chunk_metadata': {
                                                            'doc_id': doc_id,
                                                            'chunk_index': first_chunk.get('chunk_index'),
                                                            'page_number': first_chunk.get('page_number'),
                                                            'bbox': first_chunk.get('bbox'),
                                                            'content': (first_chunk.get('content') or '')[:500]
                                                        },
                                                        'chunk_metadata': {
                                                            'doc_id': doc_id,
                                                            'chunk_index': first_chunk.get('chunk_index'),
                                                            'page_number': first_chunk.get('page_number'),
                                                            'bbox': first_chunk.get('bbox'),
                                                            'content': (first_chunk.get('content') or '')[:500]
                                                        },
                                                        'candidate_chunks_metadata': source_chunks,
                                                        'match_reason': 'fallback_first_chunk'
                                                    }
                                                    citation_renumber_map[doc_num_str] = str(next_cit_num)
                                                    logger.info(f"🟡 [CITATIONS] Created fallback citation [{next_cit_num}] for first chunk (no context match)")
                                    elif chunk_citations:
                                        # No context but we have pre-assigned citations, use first one
                                        citation_renumber_map[doc_num_str] = chunk_citations[0]
                                        logger.info(f"🟡 [CITATIONS] Using first chunk citation [{chunk_citations[0]}] (no context, single chunk: {len(source_chunks)})")
                                    elif source_chunks:
                                        # No pre-assigned citations and no context, but we have chunks - skip this citation
                                        logger.warning(f"🟡 [CITATIONS] Citation [{doc_num_str}] found but no matching chunk identified (no context, {len(source_chunks)} chunks available)")
                                
                                # Get unique chunk citation numbers that were actually used
                                unique_citations = sorted(set(citation_renumber_map.values()), key=int) if citation_renumber_map else []
                                
                                if unique_citations:
                                    citation_number_remap = {
                                        old_num: str(idx + 1)
                                        for idx, old_num in enumerate(unique_citations)
                                    }
                                    citation_renumber_map = {
                                        doc_num: citation_number_remap.get(chunk_num, chunk_num)
                                        for doc_num, chunk_num in citation_renumber_map.items()
                                    }
                                    remapped_citation_to_chunks = {}
                                    for old_num, chunk_info in citation_to_chunks.items():
                                        new_num = citation_number_remap.get(old_num)
                                        if new_num:
                                            remapped_citation_to_chunks[new_num] = chunk_info
                                    citation_to_chunks = remapped_citation_to_chunks
                                    unique_citations = list(citation_number_remap.values())
                                
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
                                        matched_chunk_metadata = chunk_info.get('matched_chunk_metadata') or chunk_info.get('chunk_metadata', {})
                                        candidate_chunks = chunk_info.get('candidate_chunks_metadata', [])
                                        
                                        # FIX: Get doc_id from chunk_info or fallback to chunk_metadata
                                        # This handles cases where doc_id might be empty in citation_map
                                        doc_id = chunk_info.get('doc_id') or matched_chunk_metadata.get('doc_id') or ''
                                        
                                        if not doc_id:
                                            logger.warning(f"🟡 [CITATIONS] No doc_id found for citation [{citation_num_str}], chunk_idx {chunk_info.get('chunk_index')}")
                                        
                                        # Ensure doc_id is in matched chunk metadata for frontend
                                        if matched_chunk_metadata and not matched_chunk_metadata.get('doc_id'):
                                            matched_chunk_metadata = {**matched_chunk_metadata, 'doc_id': doc_id}
                                        
                                        has_bbox = bool(matched_chunk_metadata.get('bbox'))
                                        if not has_bbox:
                                            logger.warning(
                                                "⚠️ [CITATIONS] Citation [%s] missing bbox (doc %s, chunk_idx %s, match_reason=%s)",
                                                citation_num_str,
                                                (doc_id or '')[:8],
                                                chunk_info.get('chunk_index'),
                                                chunk_info.get('match_reason') or 'unknown',
                                            )
                                        
                                        # Build source_chunks_metadata array with just the matched chunk
                                        source_chunks_metadata = [matched_chunk_metadata] if matched_chunk_metadata else []
                                        
                                        citations_data[citation_num_str] = {
                                            'doc_id': doc_id,  # Use recovered doc_id
                                            'original_filename': chunk_info.get('original_filename'),
                                            'property_address': chunk_info.get('property_address'),
                                            'page_range': chunk_info.get('page_range'),
                                            'classification_type': chunk_info.get('classification_type'),
                                            'source_chunks_metadata': source_chunks_metadata,  # Matched chunk with bbox
                                            'matched_chunk_metadata': matched_chunk_metadata,
                                            # Optional: include all candidate chunks for debugging/analysis
                                            'candidate_chunks_metadata': candidate_chunks,
                                            'match_reason': chunk_info.get('match_reason'),
                                            'evidence_feedback': chunk_info.get('evidence_feedback', []),
                                        }
                                        logger.info(
                                            f"🟡 [CITATIONS] Mapped chunk citation [{citation_num_str}] to doc {doc_id[:8] if doc_id else 'MISSING'}, "
                                            f"chunk_idx {chunk_info.get('chunk_index')}, page {chunk_info.get('page_number')}, "
                                            f"bbox: {bool(matched_chunk_metadata.get('bbox'))}"
                                        )
                        except Exception as citation_error:
                            logger.error(f"🟡 [CITATIONS] Error parsing citations: {citation_error}", exc_info=True)
                            citations_data = {}  # Fallback to empty citations
                        
                        # Send complete message with metadata
                        # IMPORTANT: Strip any remaining EVIDENCE_FEEDBACK tags from the summary
                        clean_summary = full_summary.strip()
                        if EVIDENCE_FEEDBACK_START in clean_summary:
                            # Double-check cleanup - remove any EVIDENCE_FEEDBACK block
                            start_idx = clean_summary.find(EVIDENCE_FEEDBACK_START)
                            if start_idx != -1:
                                end_tag = '</EVIDENCE_FEEDBACK>'
                                end_idx = clean_summary.find(end_tag)
                                if end_idx != -1:
                                    clean_summary = (clean_summary[:start_idx] + clean_summary[end_idx + len(end_tag):]).strip()
                                else:
                                    # No end tag, just remove from start tag onwards
                                    clean_summary = clean_summary[:start_idx].strip()
                                logger.info(f"🧹 [CLEANUP] Stripped EVIDENCE_FEEDBACK from summary")
                        
                        complete_data = {
                            'type': 'complete',
                            'data': {
                                'summary': clean_summary,
                                'relevant_documents': relevant_docs,
                                'document_outputs': doc_outputs,
                                'citations': citations_data,  # Citation mapping with bbox
                                'evidence_feedback': feedback_records,
                                'matched_evidence': matched_feedback_records,
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

        if document_id:
            # Hint downstream nodes to focus on the specific document linked to this property
            initial_state["document_ids"] = [document_id]
        
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
            "evidence_feedback": result.get("evidence_feedback", []),
            "matched_evidence": result.get("matched_evidence", []),
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
    """
    Proxy upload to S3 (alternative to presigned URLs if CORS issues)
    
    Fast Pipeline: If property_id is provided, automatically triggers fast processing:
    - Section-based chunking with Reducto
    - Document-level context generation
    - Immediate embedding and vector storage
    - Target: <30 seconds processing time
    
    Documents uploaded without property_id will remain in 'UPLOADED' status.
    """
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
                'business_id': str(business_uuid),  # Supabase documents.business_id is varchar
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
                    # Queue fast processing task (property_id already known - no extraction needed)
                    task = process_document_fast_task.delay(
                        document_id=doc_id,
                        file_content=file_content,
                        original_filename=filename,
                        business_id=str(business_uuid_str),
                        property_id=str(property_id)
                    )
                    
                    logger.info(f"⚡ Queued fast processing task {task.id} for document {doc_id} (property {property_id})")
                except Exception as e:
                    logger.warning(f"Failed to queue fast processing task: {e}")
                    # Don't fail the upload - document is already created and uploaded
            
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
        
        if str(document.business_id) != str(current_user.business_id):
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
                .filter_by(business_id=business_uuid_str)
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
    """Legacy endpoint - not implemented (models missing)"""
    return jsonify({'error': 'This endpoint is not implemented'}), 501

# API endpoint for React frontend
@views.route('/api/appraisal/<int:id>', methods=['GET'])
@login_required
def api_appraisal(id):
    """Legacy endpoint - not implemented (models missing)"""
    return jsonify({'error': 'This endpoint is not implemented'}), 501

# API endpoint for chat messages
@views.route('/api/appraisal/<int:id>/chat', methods=['POST'])
@login_required
def api_chat(id):
    """Legacy endpoint - not implemented (models missing)"""
    return jsonify({'error': 'This endpoint is not implemented'}), 501

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
        .filter_by(business_id=business_uuid_str)
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

@views.route('/api/document/<uuid:document_id>', methods=['DELETE', 'OPTIONS'])
def delete_document(document_id):
    """
    Deletes a document from S3, Supabase stores, and its metadata record from the database.
    """
    if request.method == 'OPTIONS':
        # Handle CORS preflight - no auth needed
        response = make_response('', 200)
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Methods', 'DELETE, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response
    
    # Apply login_required check for actual DELETE
    if not current_user.is_authenticated:
        return jsonify({'error': 'Unauthorized'}), 401
    
    # Get document from Supabase (not local PostgreSQL)
    user_business_uuid = _normalize_uuid_str(getattr(current_user, "business_id", None)) or _ensure_business_uuid()
    
    if not user_business_uuid:
        logger.warning("Current user has no business UUID; denying delete request.")
        return jsonify({'error': 'Unauthorized'}), 403
    
    # Get document from Supabase
    from .services.document_storage_service import DocumentStorageService
    from .services.supabase_client_factory import get_supabase_client
    doc_storage = DocumentStorageService()
    
    document_id_str = str(document_id)
    logger.info(f"DELETE: Attempting to retrieve document {document_id_str} for business {user_business_uuid}")
    
    success, document_data, error = doc_storage.get_document(document_id_str, user_business_uuid)
    
    if not success:
        # Try to fetch document without business_id filter to see if it exists with different business_id
        logger.warning(f"DELETE: Document not found with business_id filter. Checking if document exists and is linked to user's properties...")
        try:
            supabase = get_supabase_client()
            # First check if document exists at all
            check_result = supabase.table('documents').select('id, business_id, s3_path, original_filename').eq('id', document_id_str).execute()
            if check_result.data and len(check_result.data) > 0:
                doc_business_id = check_result.data[0].get('business_id')
                logger.info(f"DELETE: Document exists with business_id: {doc_business_id}, User business_id: {user_business_uuid}")
                
                # Check if document is linked to any property that belongs to user's business
                relationships_result = supabase.table('document_relationships').select('property_id').eq('document_id', document_id_str).execute()
                if relationships_result.data and len(relationships_result.data) > 0:
                    property_ids = [rel.get('property_id') for rel in relationships_result.data if rel.get('property_id')]
                    logger.info(f"DELETE: Document is linked to {len(property_ids)} properties")
                    
                    # Check if any of these properties belong to user's business
                    if property_ids:
                        from .services.supabase_property_hub_service import SupabasePropertyHubService
                        hub_service = SupabasePropertyHubService()
                        for prop_id in property_ids:
                            prop_hub = hub_service.get_property_hub(str(prop_id), user_business_uuid)
                            if prop_hub:
                                logger.info(f"DELETE: Document is linked to property {prop_id} which belongs to user's business. Allowing deletion.")
                                # Use the document data we found (with its actual business_id)
                                document_data = check_result.data[0]
                                # Continue with deletion using the document's actual business_id
                                break
                        else:
                            logger.warning(f"DELETE: Document is not linked to any property in user's business")
                            return jsonify({'error': 'Document not found or access denied'}), 404
                    else:
                        logger.warning(f"DELETE: Document has no property relationships")
                        return jsonify({'error': 'Document not found or access denied'}), 404
                else:
                    logger.warning(f"DELETE: Document exists but is not linked to any property")
                    return jsonify({'error': 'Document not found or access denied'}), 404
            else:
                logger.warning(f"DELETE: Document {document_id_str} does not exist in database")
                return jsonify({'error': 'Document not found'}), 404
        except Exception as check_error:
            logger.error(f"DELETE: Error checking document existence: {check_error}")
            import traceback
            traceback.print_exc()
        
        if not document_data:
            if error == "Document not found":
                return jsonify({'error': 'Document not found'}), 404
            else:
                return jsonify({'error': f'Failed to retrieve document: {error}'}), 500
    
    # Extract document fields
    s3_path = document_data.get('s3_path')
    original_filename = document_data.get('original_filename')
    document_business_uuid = _normalize_uuid_str(document_data.get('business_uuid') or document_data.get('business_id'))
    
    # Verify business ownership - but allow if document is linked to user's property
    if document_business_uuid != user_business_uuid:
        # Check if document is linked to a property in user's business
        logger.info(f"DELETE: Document business mismatch. Checking property relationships...")
        try:
            supabase = get_supabase_client()
            relationships_result = supabase.table('document_relationships').select('property_id').eq('document_id', document_id_str).execute()
            if relationships_result.data and len(relationships_result.data) > 0:
                property_ids = [rel.get('property_id') for rel in relationships_result.data if rel.get('property_id')]
                if property_ids:
                    from .services.supabase_property_hub_service import SupabasePropertyHubService
                    hub_service = SupabasePropertyHubService()
                    for prop_id in property_ids:
                        prop_hub = hub_service.get_property_hub(str(prop_id), user_business_uuid)
                        if prop_hub:
                            logger.info(f"DELETE: Document is linked to property {prop_id} which belongs to user's business. Allowing deletion.")
                            # Use document's actual business_id for deletion operations
                            break
                    else:
                        logger.warning(f"DELETE: Document business mismatch and not linked to user's properties. Denying deletion.")
                        return jsonify({'error': 'Unauthorized'}), 403
                else:
                    logger.warning(f"DELETE: Document business mismatch and has no valid property relationships. Denying deletion.")
                    return jsonify({'error': 'Unauthorized'}), 403
            else:
                logger.warning(f"DELETE: Document business mismatch and not linked to any property. Denying deletion.")
                return jsonify({'error': 'Unauthorized'}), 403
        except Exception as rel_check_error:
            logger.error(f"DELETE: Error checking property relationships: {rel_check_error}")
            return jsonify({'error': 'Unauthorized'}), 403
    
    if not s3_path:
        logger.error(f"Document {document_id} missing s3_path")
        return jsonify({'error': 'Document missing S3 path'}), 400

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
    logger.info(f"Filename: {original_filename}")
    logger.info(f"Business ID: {document_business_uuid}")
    logger.info(f"User: {current_user.email}")
    logger.info("=" * 100)
    
    # 2. Delete the object from S3
    logger.info("[S3 DELETION]")
    try:
        s3_key = s3_path
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
            document_business_uuid
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
    logger.info("[SUPABASE DOCUMENT RELATIONSHIPS DELETION]")
    impacted_property_ids = set()
    try:
        from .services.supabase_client_factory import get_supabase_client
        supabase = get_supabase_client()
        
        # Get relationships from Supabase
        relationships_result = supabase.table('document_relationships').select('property_id').eq('document_id', str(document_id)).execute()
        relationships = relationships_result.data if relationships_result.data else []
        relationship_count = len(relationships)
        impacted_property_ids = {str(rel.get('property_id')) for rel in relationships if rel.get('property_id')}
        logger.info(f"   Found {relationship_count} document relationships; impacted properties: {len(impacted_property_ids)}")
        
        # Delete all document relationships for this document from Supabase
        if relationship_count > 0:
            delete_result = supabase.table('document_relationships').delete().eq('document_id', str(document_id)).execute()
            logger.info(f"   SUCCESS: Deleted {relationship_count} document relationships from Supabase")
        else:
            logger.info(f"   No document relationships found for this document")
    except Exception as e:
        logger.warning(f"   WARNING: Failed to delete document relationships - {e}")
        import traceback
        traceback.print_exc()
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

    # 8. PostgreSQL document record deletion (SKIPPED - documents are in Supabase)
    # Documents are now stored in Supabase, not local PostgreSQL
    # The deletion service already handles Supabase document deletion
    logger.info("[POSTGRESQL DOCUMENT RECORD DELETION]")
    logger.info("   SKIPPED: Documents are stored in Supabase, not local PostgreSQL")
    deletion_results['postgresql'] = True  # Mark as success since there's nothing to delete

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
        response = jsonify(response_data)
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 200
    else:
        response_data['warning'] = 'Some deletion operations failed'
        response = jsonify(response_data)
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 207  # 207 Multi-Status

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


@views.route('/api/documents/<uuid:document_id>/reprocess', methods=['POST', 'OPTIONS'])
@login_required
def reprocess_document(document_id):
    """
    Reprocess a document to extract BBOX data using Reducto.
    
    Modes:
    - 'full': Re-embed + extract bbox (complete reprocessing)
    - 'bbox_only': Just update bbox data, preserve embeddings
    """
    # Get the origin for CORS
    origin = request.headers.get('Origin', 'http://localhost:3000')
    
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        response = jsonify({'success': True})
        response.headers.add('Access-Control-Allow-Origin', origin)
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'POST,OPTIONS')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 200
    
    try:
        data = request.get_json() or {}
        mode = data.get('mode', 'full')
        
        if mode not in ['full', 'bbox_only']:
            response = jsonify({'error': 'Invalid mode. Use "full" or "bbox_only"'})
            response.headers.add('Access-Control-Allow-Origin', origin)
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            return response, 400
        
        # Connect to Supabase (primary source of truth)
        supabase = get_supabase_client()
        
        doc_result = supabase.table('documents')\
            .select('id,business_id,business_uuid,s3_path,original_filename,file_type')\
            .eq('id', str(document_id))\
            .single()\
            .execute()
        
        document_record = doc_result.data if doc_result else None
        if not document_record:
            response = jsonify({'error': 'Document not found'})
            response.headers.add('Access-Control-Allow-Origin', origin)
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            return response, 404
        
        # Validate business ownership using Supabase data
        document_business = document_record.get('business_id') or document_record.get('business_uuid')
        if document_business and str(document_business) != str(current_user.business_id):
            response = jsonify({'error': 'Unauthorized'})
            response.headers.add('Access-Control-Allow-Origin', origin)
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            return response, 403
        
        logger.info(f"🔄 Reprocessing document {document_id} in {mode} mode...")
        
        # Get the S3 file URL
        s3_path = document_record.get('s3_path')
        if not s3_path:
            response = jsonify({'error': 'Document has no S3 path'})
            response.headers.add('Access-Control-Allow-Origin', origin)
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            return response, 400
        
        # Generate presigned URL for the file
        import boto3
        from botocore.exceptions import ClientError
        
        bucket_name = os.environ.get('S3_UPLOAD_BUCKET')
        aws_region = os.environ.get('AWS_REGION', 'us-east-1')
        
        s3_client = boto3.client(
            's3',
            region_name=aws_region,
            aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID'),
            aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY')
        )

        # Download the file locally
        file_ext = os.path.splitext(s3_path)[1]
        temp_fd, temp_file_path = tempfile.mkstemp(suffix=file_ext or '.pdf')
        os.close(temp_fd)
        s3_client.download_file(bucket_name, s3_path, temp_file_path)

        try:
            # Use Reducto to parse with BBOX
            from .services.reducto_service import ReductoService
            reducto = ReductoService()
            
            logger.info("📄 Parsing document with Reducto (fast mode)...")
            
            parse_result = reducto.parse_document_fast(
                file_path=temp_file_path,
                use_sync_for_small=True,
                timeout=300
            )
            
            chunks = parse_result.get('chunks', [])
        finally:
            os.remove(temp_file_path)
        
        if not chunks:
            response = jsonify({
                'error': 'Reducto returned no chunks',
                'success': False
            })
            response.headers.add('Access-Control-Allow-Origin', origin)
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            return response, 500
        
        logger.info(f"✅ Reducto returned {len(chunks)} chunks")
        
        # Count chunks with bbox
        chunks_with_bbox = 0
        chunks_updated = 0
        
        for i, chunk in enumerate(chunks):
            bbox = chunk.get('bbox')
            page_number = chunk.get('page_number', i + 1)
            chunk_text = chunk.get('content', '')
            
            if bbox:
                chunks_with_bbox += 1
            
            if mode == 'bbox_only':
                # Update bbox plus metadata to keep chunk_text + bbox in sync
                update_payload = {
                    'bbox': ensure_bbox_dict(bbox),
                    'page_number': page_number,
                    'chunk_text': (chunk_text or '')[:10000]
                }
                update_result = (
                    supabase.table('document_vectors')
                    .update(update_payload)
                    .eq('document_id', str(document_id))
                    .eq('chunk_index', i)
                    .select('id')
                    .execute()
                )
                
                if update_result.data:
                    chunks_updated += 1
            else:
                # Full mode: upsert chunk with all data
                # First try to update existing chunk
                existing = supabase.table('document_vectors')\
                    .select('id')\
                    .eq('document_id', str(document_id))\
                    .eq('chunk_index', i)\
                    .execute()
                
                if existing.data:
                    # Update existing
                    updated = (
                        supabase.table('document_vectors')
                        .update({
                            'chunk_text': (chunk_text or '')[:10000],  # Limit chunk size
                            'page_number': page_number,
                            'bbox': ensure_bbox_dict(bbox)
                        })
                        .eq('document_id', str(document_id))
                        .eq('chunk_index', i)
                        .select('id')
                        .execute()
                    )
                    if updated.data:
                        chunks_updated += 1
                else:
                    # Insert new chunk (without embedding for now)
                    inserted = supabase.table('document_vectors').insert({
                        'document_id': str(document_id),
                        'chunk_index': i,
                        'chunk_text': (chunk_text or '')[:10000],
                        'page_number': page_number,
                        'bbox': ensure_bbox_dict(bbox),
                        'embedding_status': 'pending'
                    }).execute()
                    if inserted.data:
                        chunks_updated += 1
        
        logger.info(f"✅ Reprocessing complete: {chunks_updated} chunks updated, {chunks_with_bbox} with bbox")
        
        response = jsonify({
            'success': True,
            'message': f'Successfully reprocessed document with {chunks_with_bbox} chunks containing BBOX',
            'chunks_total': len(chunks),
            'chunks_with_bbox': chunks_with_bbox,
            'chunks_updated': chunks_updated,
            'mode': mode
        })
        response.headers.add('Access-Control-Allow-Origin', origin)
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 200
        
    except Exception as e:
        logger.error(f"❌ Reprocess error: {e}", exc_info=True)
        response = jsonify({
            'success': False,
            'error': str(e)
        })
        response.headers.add('Access-Control-Allow-Origin', origin)
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 500


@views.route('/api/documents/<uuid:document_id>/reprocess/progress', methods=['GET', 'OPTIONS'])
def reprocess_progress(document_id):
    """
    SSE endpoint for real-time reprocess progress updates.
    Note: Not using @login_required for SSE compatibility.
    """
    origin = request.headers.get('Origin', 'http://localhost:3000')
    
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        response = jsonify({'success': True})
        response.headers.add('Access-Control-Allow-Origin', origin)
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET,OPTIONS')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 200
    
    def generate():
        # For now, just send a simple progress stream
        # In a full implementation, this would track actual progress
        import time
        
        for i in range(0, 101, 10):
            yield f"data: {json.dumps({'progress': i, 'status': 'processing'})}\n\n"
            time.sleep(0.5)
        
        yield f"data: {json.dumps({'progress': 100, 'status': 'complete'})}\n\n"
    
    response = Response(generate(), mimetype='text/event-stream')
    response.headers.add('Access-Control-Allow-Origin', origin)
    response.headers.add('Access-Control-Allow-Credentials', 'true')
    response.headers.add('Cache-Control', 'no-cache')
    return response


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


@views.route('/api/admin/migrate_bbox', methods=['GET'])
def run_bbox_migration():
    """Run the SQL migration to fix match_documents function"""
    try:
        from sqlalchemy import text
        from backend import db
        import os
        
        logger.info("🚀 Starting migration to fix match_documents function via API...")
        
        # Read SQL file
        # Note: Path is relative to where the app is run from (root)
        sql_file_path = os.path.join('backend', 'migrations', 'fix_match_documents_bbox.sql')
        with open(sql_file_path, 'r') as f:
            sql_content = f.read()
            
        logger.info(f"📜 Read SQL file: {sql_file_path}")
        
        # Execute SQL using SQLAlchemy raw connection
        with db.engine.connect() as conn:
            # Need to use execution_options to allow autocommit for some operations if needed
            # But for CREATE FUNCTION it should be fine in a transaction
            conn.execute(text(sql_content))
            conn.commit()
            
            # Verify
            result = conn.execute(text("SELECT proargnames, prorettype::regtype FROM pg_proc WHERE proname = 'match_documents'")).fetchone()
            verification = str(result)
            
        logger.info("✅ Migration executed successfully!")
        return jsonify({
            'success': True,
            'message': 'Migration executed successfully',
            'verification': verification
        })
        
    except Exception as e:
        logger.error(f"❌ Migration failed: {e}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/admin/check_bbox/<document_id>', methods=['GET'])
def check_bbox_data(document_id):
    """Check if bbox data exists in document_vectors for a document"""
    try:
        supabase = get_supabase_client()
        result = supabase.table('document_vectors')\
            .select('id, chunk_index, page_number, bbox')\
            .eq('document_id', document_id)\
            .order('chunk_index')\
            .limit(20)\
            .execute()
        
        chunks_with_bbox = sum(1 for r in result.data if r.get('bbox'))
        
        # Also check what the bbox looks like for chunks that have it
        bbox_samples = []
        for r in result.data:
            if r.get('bbox'):
                bbox_samples.append({
                    'chunk_index': r.get('chunk_index'),
                    'page_number': r.get('page_number'),
                    'bbox': r.get('bbox')
                })
        
        return jsonify({
            'success': True,
            'document_id': document_id,
            'total_chunks': len(result.data),
            'chunks_with_bbox': chunks_with_bbox,
            'bbox_samples': bbox_samples[:5],  # First 5 chunks with bbox
            'sample_chunks': [
                {
                    'chunk_index': r.get('chunk_index'),
                    'page_number': r.get('page_number'),
                    'has_bbox': bool(r.get('bbox')),
                    'bbox_type': type(r.get('bbox')).__name__ if r.get('bbox') else None
                }
                for r in result.data[:10]
            ]
        })
        
    except Exception as e:
        logger.error(f"❌ Check bbox failed: {e}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

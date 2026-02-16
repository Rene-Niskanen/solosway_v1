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
import math
import queue
from .tasks import process_document_task, process_document_fast_task, process_document_after_parse_task
# NOTE: DeletionService is deprecated - use UnifiedDeletionService instead
# from .services.deletion_service import DeletionService
from sqlalchemy import text, cast, String
from sqlalchemy.exc import OperationalError, ProgrammingError, DatabaseError
import json
import traceback
from uuid import UUID
# Citations are now stored directly in graph state with bbox coordinates - no processing needed
# SessionManager for LangGraph checkpointer thread_id management
from backend.llm.utils.session_manager import session_manager
from backend.config import Config

def _strip_intent_fragment_from_response(text):
    """Remove leading 'of [property name]' leakage from response (e.g. 'of Highlands' from intent phrase)."""
    if not text or not isinstance(text, str):
        return text or ""
    stripped = text.lstrip()
    # Remove first line if it is only "of [Word]" or "of [Word1 Word2]" (case-insensitive)
    m = re.match(r"^of\s+[A-Za-z]+(?:\s+[A-Za-z]+)?\s*(\n|$)", stripped, re.IGNORECASE)
    if m:
        stripped = stripped[m.end() :].lstrip()
    return stripped


def _citation_numbers_in_response(response_text):
    """Return set of citation numbers (as str) that actually appear in the response text.
    Only documents cited in the response should be shown as sources.
    Uses bracket format [1], [2] (and optional superscript ¹²³) to avoid false positives from (1), (2) in prose.
    """
    if not response_text or not isinstance(response_text, str):
        return set()
    seen = set()
    # Bracket format: [1], [2], [12] (primary citation format from responder/summary)
    for m in re.finditer(r"\[(\d+)\]", response_text):
        seen.add(m.group(1))
    # Superscript ¹²³ if used in display
    if "\u00B9" in response_text:
        seen.add("1")
    if "\u00B2" in response_text:
        seen.add("2")
    if "\u00B3" in response_text:
        seen.add("3")
    return seen


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


views = Blueprint('views', __name__)

# Set up logging
logger = logging.getLogger(__name__)

# Stream response pacing: delay in ms between chunks (0 = no delay); chunk size in characters
STREAM_CHUNK_DELAY_MS = int(os.environ.get("STREAM_CHUNK_DELAY_MS", "0"))
STREAM_CHUNK_SIZE = int(os.environ.get("STREAM_CHUNK_SIZE", "32"))

# ---------------------------------------------------------------------------
# Performance timing helpers (lightweight, server-side only)
# ---------------------------------------------------------------------------
def _perf_ms(start: float, end: float) -> int:
    """Return elapsed milliseconds as int (clamped >= 0)."""
    return max(0, int(round((end - start) * 1000)))

class _Timing:
    """Tiny timing utility for per-request performance logs."""
    def __init__(self) -> None:
        self._t0 = time.perf_counter()
        self.marks: dict[str, float] = {"t0": self._t0}

    def mark(self, name: str) -> None:
        self.marks[name] = time.perf_counter()

    def to_ms(self) -> dict[str, int]:
        # Convert sequential mark deltas to ms for quick reading.
        ordered = sorted(self.marks.items(), key=lambda kv: kv[1])
        out: dict[str, int] = {}
        prev_name, prev_t = ordered[0]
        for name, t in ordered[1:]:
            out[f"{prev_name}->{name}_ms"] = _perf_ms(prev_t, t)
            prev_name, prev_t = name, t
        out["total_ms"] = _perf_ms(self._t0, time.perf_counter())
        return out


# ---------------------------------------------------------------------------
# SINGLE SOURCE OF TRUTH: Citation Selection Based on User Intent
# ---------------------------------------------------------------------------
def select_best_citation_for_query(query: str, citations_map: dict, preferred_citation_key: str = None) -> tuple[str, dict]:
    """
    Select the best citation that matches the user's query intent.
    
    Args:
        query: The user's query text
        citations_map: Dict of citation_key -> citation_data
        preferred_citation_key: Optional preferred citation (from LLM), will verify it matches intent
    
    Returns:
        Tuple of (selected_key, selected_citation) or (None, None) if no citations
    """
    if not citations_map:
        return None, None
    
    query_lower = query.lower() if query else ''
    
    # Detect query intent
    is_phone_query = any(kw in query_lower for kw in ['phone', 'telephone', 'call', 'contact number', 'tel'])
    is_email_query = any(kw in query_lower for kw in ['email', 'e-mail', 'mail address'])
    is_address_query = any(kw in query_lower for kw in ['address', 'location', 'where is', 'office'])
    
    # If we have a preferred citation and it matches intent, use it
    if preferred_citation_key and preferred_citation_key in citations_map:
        preferred_cit = citations_map[preferred_citation_key]
        cit_text = preferred_cit.get('cited_text', '').lower()
        
        # Check if preferred citation matches query intent
        matches_intent = True
        if is_phone_query:
            has_phone = bool(re.search(r'\+?\d[\d\s\-\(\)]{8,}', cit_text)) or 'phone' in cit_text or 'tel' in cit_text
            if not has_phone:
                matches_intent = False
                logger.info(f"🎯 [CITATION_SELECT] Preferred [{preferred_citation_key}] doesn't match phone intent")
        elif is_email_query:
            has_email = bool(re.search(r'[\w\.-]+@[\w\.-]+\.\w+', cit_text)) or 'email' in cit_text
            if not has_email:
                matches_intent = False
                logger.info(f"🎯 [CITATION_SELECT] Preferred [{preferred_citation_key}] doesn't match email intent")
        elif is_address_query:
            has_address = bool(re.search(r'\d+\s+[\w\s]+(?:street|road|avenue|place|lane|drive|way|close|court)', cit_text, re.IGNORECASE)) or 'address' in cit_text
            if not has_address:
                matches_intent = False
                logger.info(f"🎯 [CITATION_SELECT] Preferred [{preferred_citation_key}] doesn't match address intent")
        
        if matches_intent:
            logger.info(f"🎯 [CITATION_SELECT] Using preferred citation [{preferred_citation_key}]")
            return preferred_citation_key, preferred_cit
    
    # Need to find a better citation - score all citations
    best_key = None
    best_score = -1
    best_cit = None
    
    for cit_key, cit in citations_map.items():
        cit_text = cit.get('cited_text', '').lower()
        cit_page = cit.get('page', 0)
        cit_method = cit.get('method', '')
        score = 0
        
        # Score based on content match with query intent
        if is_phone_query:
            if re.search(r'\+?\d[\d\s\-\(\)]{8,}', cit_text):
                score += 100  # Has phone number pattern
            if 'phone' in cit_text or 'tel' in cit_text:
                score += 50  # Has phone keyword
        elif is_email_query:
            if re.search(r'[\w\.-]+@[\w\.-]+\.\w+', cit_text):
                score += 100  # Has email pattern
            if 'email' in cit_text:
                score += 50  # Has email keyword
        elif is_address_query:
            if re.search(r'\d+\s+[\w\s]+(?:street|road|avenue|place|lane|drive|way|close|court)', cit_text, re.IGNORECASE):
                score += 100  # Has address pattern
            if 'address' in cit_text:
                score += 50  # Has address keyword
        else:
            # No specific intent - prefer higher-numbered citations (usually more specific)
            score = 10
        
        # Penalize page 0 (cover pages)
        if cit_page == 0:
            score -= 50
        
        # Penalize orphan citations (less reliable)
        if 'orphan' in cit_method.lower():
            score -= 20
        
        # Boost for later pages (more likely to be actual content)
        if cit_page >= 2:
            score += 10
        
        if score > best_score:
            best_score = score
            best_key = cit_key
            best_cit = cit
    
    if best_key:
        logger.info(f"🎯 [CITATION_SELECT] Selected citation [{best_key}] with score {best_score}")
        return best_key, best_cit
    
    # Fallback to first available
    first_key = next(iter(citations_map.keys()), None)
    logger.info(f"🎯 [CITATION_SELECT] Fallback to first citation [{first_key}]")
    return first_key, citations_map.get(first_key) if first_key else None

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


@views.route('/api/internal/reducto-webhook', methods=['POST'])
def reducto_webhook():
    """
    Webhook called by Reducto when an async parse job completes. Do not protect with @login_required.
    Validates REDUCTO_WEBHOOK_SECRET from payload metadata; enqueues process_document_after_parse_task on success.
    """
    try:
        data = request.get_json(silent=True) or {}
        status = data.get('status')
        job_id = data.get('job_id')
        metadata = data.get('metadata') or {}
        secret = os.environ.get('REDUCTO_WEBHOOK_SECRET')
        if secret and metadata.get('webhook_secret') != secret:
            logger.warning("Reducto webhook: invalid or missing webhook_secret")
            return jsonify({'error': 'Unauthorized'}), 401
        if status != 'Completed':
            logger.info(f"Reducto webhook: job_id={job_id} status={status}, acknowledging")
            return jsonify({'received': True}), 200
        document_id = metadata.get('document_id')
        business_id = metadata.get('business_id')
        property_id = metadata.get('property_id')
        pipeline_type = metadata.get('pipeline_type', 'fast')
        original_filename = metadata.get('original_filename', '')
        if not document_id or not business_id or not job_id:
            logger.warning(f"Reducto webhook: missing document_id/business_id/job_id in metadata")
            return jsonify({'error': 'Bad request', 'message': 'Missing document_id, business_id, or job_id'}), 400
        # Idempotency: skip re-enqueueing if this job_id was already processed (Reducto may retry)
        try:
            import redis
            redis_host = os.environ.get('REDIS_HOST', 'redis')
            redis_port = int(os.environ.get('REDIS_PORT', 6379))
            r = redis.Redis(host=redis_host, port=redis_port, db=0)
            key = f"reducto_webhook:job_id:{job_id}"
            if not r.set(key, "1", nx=True, ex=86400):
                logger.info(f"Reducto webhook: job_id={job_id} already processed, skipping")
                return jsonify({'received': True}), 200
        except Exception:
            pass
        after_parse_task = process_document_after_parse_task.delay(
            document_id=document_id,
            job_id=job_id,
            business_id=business_id,
            property_id=property_id or None,
            pipeline_type=pipeline_type,
            original_filename=original_filename
        )
        try:
            from .services.document_processing_tasks import set_document_processing_task_id
            set_document_processing_task_id(str(document_id), after_parse_task.id)
        except Exception:
            pass
        logger.info(f"Reducto webhook: enqueued after-parse task for document_id={document_id} job_id={job_id}")
        return jsonify({'received': True}), 200
    except Exception as e:
        logger.exception("Reducto webhook error")
        return jsonify({'error': 'Internal server error'}), 500


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


@views.route('/api/projects', methods=['GET', 'OPTIONS'])
def get_projects():
    """Minimal projects endpoint so frontend does not hit CORS on missing route. Returns empty list."""
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET, OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200
    if not current_user.is_authenticated:
        return jsonify({'success': False, 'error': 'Authentication required'}), 401
    return jsonify({'success': True, 'data': {'projects': []}}), 200


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


@views.route('/api/chat-feedback', methods=['POST', 'OPTIONS'])
@login_required
def submit_chat_feedback():
    """
    Accept chat feedback (thumbs down) and send email to connect@solosway.co.
    Body: category (required), details (optional), messageId (optional), conversationSnippet (optional).
    If SMTP env vars are not set, payload is logged and 200 is returned so the UI still works.
    """
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    data = request.get_json() or {}
    category = (data.get('category') or '').strip()
    if not category:
        return jsonify({'success': False, 'error': 'category is required'}), 400
    details = (data.get('details') or '').strip()
    message_id = data.get('messageId')
    conversation_snippet = (data.get('conversationSnippet') or '')[:2000]
    screenshot_bytes = None
    screenshot_base64 = data.get('screenshotBase64')
    if isinstance(screenshot_base64, str) and screenshot_base64:
        import base64
        raw = screenshot_base64
        if raw.startswith('data:'):
            raw = raw.split(',', 1)[-1] if ',' in raw else ''
        try:
            decoded = base64.b64decode(raw, validate=True)
            if len(decoded) <= 3 * 1024 * 1024:  # 3 MB
                screenshot_bytes = decoded
        except Exception:
            pass
    user_email = getattr(current_user, 'email', None) or 'unknown'
    from_email = os.environ.get('FEEDBACK_FROM_EMAIL') or os.environ.get('SMTP_USER') or 'feedback@solosway.co'
    to_email = 'connect@solosway.co'
    body_lines = [
        f'Chat feedback from {user_email}',
        f'Category: {category}',
        f'Message ID: {message_id or "(none)"}',
        '',
        'Details:',
        details or '(none)',
        '',
        'Conversation snippet:',
        conversation_snippet or '(none)',
    ]
    body = '\n'.join(body_lines)
    smtp_host = os.environ.get('SMTP_HOST')
    smtp_port = int(os.environ.get('SMTP_PORT', '587'))
    smtp_user = os.environ.get('SMTP_USER')
    smtp_password = os.environ.get('SMTP_PASSWORD')
    if smtp_host and smtp_user and smtp_password:
        try:
            import smtplib
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart
            from email.mime.image import MIMEImage
            msg = MIMEMultipart()
            msg['Subject'] = f'Chat feedback: {category[:50]}'
            msg['From'] = from_email
            msg['To'] = to_email
            msg.attach(MIMEText(body, 'plain'))
            if screenshot_bytes:
                img = MIMEImage(screenshot_bytes, _subtype='png')
                img.add_header('Content-Disposition', 'attachment', filename='feedback-screenshot.png')
                msg.attach(img)
            with smtplib.SMTP(smtp_host, smtp_port) as server:
                server.starttls()
                server.login(smtp_user, smtp_password)
                server.sendmail(from_email, [to_email], msg.as_string())
            logger.info(f'Chat feedback email sent to {to_email} from {user_email}')
        except Exception as e:
            logger.exception('Failed to send chat feedback email')
            return jsonify({'success': False, 'error': str(e)}), 500
    else:
        logger.info('Chat feedback (SMTP not configured): category=%s user=%s messageId=%s', category, user_email, message_id)
    return jsonify({'success': True}), 200


# Add before_request handler to respond to OPTIONS (CORS preflight) with 200 so browser gets HTTP OK
@views.before_request
def handle_options_request():
    """Respond to OPTIONS (CORS preflight) with 200 and CORS headers so preflight always passes."""
    if request.method == 'OPTIONS':
        resp = jsonify({})
        resp.status_code = 200
        origin = request.headers.get('Origin')
        if origin and origin in Config.CORS_ORIGINS:
            resp.headers['Access-Control-Allow-Origin'] = origin
        resp.headers['Access-Control-Allow-Credentials'] = 'true'
        resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
        resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
        resp.headers['Access-Control-Max-Age'] = '3600'
        return resp

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
        
        timing = _Timing()
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
        
        timing.mark("parsed_request")
        query = data.get('query', '')
        property_id = data.get('propertyId')
        document_ids = data.get('documentIds') or data.get('document_ids', [])  # NEW: Get attached document IDs
        message_history = data.get('messageHistory', [])
        
        # NEW: Use SessionManager to generate thread_id for LangGraph checkpointer
        # This ensures consistent session identification between frontend and backend
        frontend_session_id = data.get('sessionId')  # Chat ID from frontend (e.g., "chat-1234567890-xyz")
        business_id = _ensure_business_uuid()
        
        # Generate thread_id using SessionManager (resumes conversation if session_id provided)
        session_id = session_manager.get_thread_id(
            user_id=current_user.id,
            business_id=business_id or "no_business",  # Fallback if business not found
            session_id=frontend_session_id
        )
        
        citation_context = data.get('citationContext')  # NEW: Get structured citation metadata (hidden from user)
        response_mode = data.get('responseMode')  # NEW: Response mode for file attachments (fast/detailed/full)
        attachment_context = data.get('attachmentContext')  # NEW: Extracted text from attached files
        is_agent_mode = data.get('isAgentMode', True)  # AGENT MODE: Enable LLM tool-based actions (default to True for new architecture)
        
        # CRITICAL: Log agent mode setting for debugging
        logger.info(f"🔑 [STREAM] isAgentMode from request: {data.get('isAgentMode', 'not provided')}, final is_agent_mode: {is_agent_mode}")
        
        # CRITICAL: Normalize undefined/null/empty values to None for Python
        # Frontend sends undefined which becomes null in JSON, but we want None in Python
        # Also handle empty strings and empty dicts
        if not response_mode or response_mode == 'null' or response_mode == '':
            response_mode = None
        if not attachment_context or attachment_context == 'null' or attachment_context == {} or (isinstance(attachment_context, dict) and not attachment_context.get('texts')):
            attachment_context = None
        
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
        
        # CRITICAL: Log routing parameters for debugging
        attachment_info = "None"
        if attachment_context:
            if isinstance(attachment_context, dict):
                texts = attachment_context.get('texts', [])
                attachment_info = f"Present (texts: {len(texts)}, has_content: {any(len(str(t).strip()) > 0 for t in texts)})"
            else:
                attachment_info = f"Present (type: {type(attachment_context).__name__})"
        
        logger.info(
            f"🔵 [STREAM] Query: '{query[:50]}...', "
            f"Property ID: {property_id}, "
            f"Document IDs: {document_ids} (count: {len(document_ids)}), "
            f"Session: {session_id}, "
            f"Response Mode: {response_mode or 'None'}, "
            f"Attachment Context: {attachment_info}"
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
                timing.mark("business_id")
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
                
                # When request sent no document_ids but we resolved one from property_id, pass it to the graph
                effective_document_ids = document_ids if document_ids else ([document_id] if document_id else None)

                # Scope resolution: when user sent document_ids but no property_id, resolve property_id from first document
                resolved_property_id = None
                if (not property_id) and effective_document_ids and len(effective_document_ids) > 0:
                    try:
                        first_doc_id = effective_document_ids[0] if isinstance(effective_document_ids[0], str) else str(effective_document_ids[0])
                        rel_result = supabase.table('document_relationships')\
                            .select('property_id')\
                            .eq('document_id', first_doc_id)\
                            .limit(1)\
                            .execute()
                        if rel_result.data and len(rel_result.data) > 0 and rel_result.data[0].get('property_id'):
                            resolved_property_id = rel_result.data[0]['property_id']
                            logger.info(f"Resolved property_id from document(s): {resolved_property_id}")
                    except Exception as e:
                        logger.warning("Could not resolve property_id from document_ids: %s", e)

                # Use request property_id or resolved from first document
                effective_property_id = property_id or resolved_property_id

                # NEW: Create execution event emitter with queue for streaming
                from queue import Queue
                from backend.llm.utils.execution_events import ExecutionEventEmitter
                event_queue = Queue()
                emitter = ExecutionEventEmitter()
                emitter.set_stream_queue(event_queue)
                
                # Build initial state for LangGraph
                # Note: conversation_history will be loaded from checkpoint if thread_id exists
                # Only provide minimal required fields - checkpointing will restore previous state.
                # Do NOT pass document_ids when request has none – so checkpoint keeps responder-persisted
                # document_ids from the previous turn (follow-up stays on same doc(s)).
                initial_state = {
                    "user_query": query,
                    "user_id": str(current_user.id) if current_user.is_authenticated else "anonymous",
                    "business_id": business_id,
                    "session_id": session_id,
                    "property_id": effective_property_id,
                    "citation_context": citation_context,  # NEW: Pass structured citation metadata (bbox, page, text)
                    "response_mode": response_mode if response_mode else None,  # NEW: Response mode for file attachments (fast/detailed/full) - ensure None not empty string
                    "attachment_context": attachment_context if attachment_context else None,  # NEW: Extracted text from attached files - ensure None not empty dict
                    "is_agent_mode": is_agent_mode,  # AGENT MODE: Enable LLM tool-based actions for proactive document display
                    "execution_events": emitter,  # NEW: Execution event emitter for execution trace
                    # Reset retry counts and refined query for new queries (prevents stale state)
                    "document_retry_count": 0,
                    "chunk_retry_count": 0,
                    "plan_refinement_count": 0,  # NEW: Reset plan refinement count for new queries
                    "refined_query": None,  # Reset refined_query to use original user_query
                    "retrieved_documents": [],  # Reset retrieved_documents
                    "document_outputs": [],  # Reset document_outputs
                    "last_document_failure_reason": None,
                    "last_chunk_failure_reason": None,
                    # conversation_history will be loaded from checkpointer or passed via messageHistory workaround
                }
                # Only set document_ids when request provided them (attachment or property). Otherwise leave unset so checkpoint keeps previous turn’s document_ids for follow-ups.
                if effective_document_ids is not None and (not isinstance(effective_document_ids, list) or len(effective_document_ids) > 0):
                    initial_state["document_ids"] = effective_document_ids
                # #region agent log
                try:
                    import json as json_module
                    with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                        f.write(json_module.dumps({
                            'sessionId': 'debug-session',
                            'runId': 'run1',
                            'hypothesisId': 'A',
                            'location': 'views.py:433',
                            'message': 'Initial state document_ids check',
                            'data': {
                                'document_ids': document_ids,
                                'document_ids_type': type(document_ids).__name__,
                                'document_ids_len': len(document_ids) if document_ids else 0,
                                'document_ids_is_none': document_ids is None,
                                'document_ids_bool': bool(document_ids),
                                'query': query[:50]
                            },
                            'timestamp': int(__import__('time').time() * 1000)
                        }) + '\n')
                except: pass
                # #endregion
                logger.info(
                    f"🟢 [STREAM] Initial state built: query='{query[:30]}...', "
                    f"business_id={business_id}, "
                    f"document_ids={len(document_ids) if document_ids else 0}"
                )
                
                # Send initial status and FIRST reasoning step immediately
                logger.info("🟢 [STREAM] Yielding initial status message")
                yield f"data: {json.dumps({'type': 'status', 'message': 'Searching documents...'})}\n\n"
                
                # Generate and stream chat title from query (so everything shown to user is streamed)
                def generate_chat_title_from_query(q: str) -> str:
                    """Generate a short chat title from the user query (mirrors frontend logic)."""
                    if not q or not (q := q.strip()):
                        return "New chat"
                    # Extract topic: look for "of X" / "for X" or capitalized words
                    q_lower = q.lower()
                    title = None
                    for sep in (" of ", " for "):
                        if sep in q_lower:
                            parts = q_lower.split(sep, 1)
                            if len(parts) == 2 and parts[1].strip():
                                # Take 1-2 words from the part after of/for
                                words = parts[1].strip().split()[:2]
                                title = " ".join(w.title() for w in words)
                                break
                    if not title:
                        words = q.split()
                        caps = [w for w in words if len(w) > 2 and w[0].isupper() and w.lower() not in {"the", "a", "an", "of", "in", "for", "to", "and", "or", "please", "find", "me", "what", "is", "are", "show", "get", "tell", "who", "how", "why", "when", "where"}]
                        if caps:
                            title = " ".join(caps[:2])
                    if not title:
                        if len(q) > 50:
                            last_space = q[:47].rfind(" ")
                            title = (q[:last_space] + "...") if last_space > 20 else q[:47] + "..."
                        else:
                            title = q
                    return title[:50] if len(title) > 50 else title
                
                # Stream title in one chunk so the client gets it immediately (no char-by-char delay)
                streamed_chat_title = generate_chat_title_from_query(query)
                if streamed_chat_title:
                    yield f"data: {json.dumps({'type': 'title_chunk', 'token': streamed_chat_title})}\n\n"
                
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
                    
                    # Build the intent message: rephrase query as "Finding the [X] of [Y]" (e.g. "Finding the EPC rating of highlands")
                    target_str = ', '.join(targets) if targets else 'information'
                    # Subject from " of X" / " for X" (works for lowercase: "value of highlands")
                    name_str = None
                    q_lower = q.lower().strip()
                    for sep in (' of ', ' for '):
                        if sep in q_lower:
                            parts = q_lower.split(sep, 1)
                            if len(parts) == 2 and parts[1].strip():
                                name_str = parts[1].strip().split()[0:2]  # 1–2 words
                                name_str = ' '.join(name_str).title()
                                break
                    if not name_str and potential_names:
                        name_str = ' '.join(potential_names[:2])
                    if name_str and target_str:
                        return f"Finding the {target_str} of {name_str}"
                    if target_str:
                        return f"Finding the {target_str}"
                    return "Planning next moves"
                
                def detect_action_intent(q: str) -> dict:
                    """
                    Detect if user wants agent to perform UI actions.
                    
                    Agent-native principle: "Whatever the user can do through the UI, 
                    the agent should be able to achieve through tools."
                    
                    Returns dict with:
                        - wants_action: bool - whether user wants agent to perform UI action
                        - action_type: str - type of action ('show', 'save', 'navigate', None)
                        - target: str - what they want to see/save/navigate to
                    """
                    q_lower = q.lower().strip()
                    
                    # Patterns that indicate user wants agent to PERFORM an action
                    show_patterns = [
                        'show me', 'display', 'open the', 'let me see', 'view the',
                        'show the', 'pull up', 'bring up', 'show me the', 'can you show',
                        'could you show', 'please show', 'i want to see', 'show citations',
                        'show where', 'show evidence', 'open citation', 'open document'
                    ]
                    save_patterns = [
                        'save', 'add to', 'remember', 'keep this', 'store',
                        'add citation', 'save citation', 'save this', 'bookmark'
                    ]
                    navigate_patterns = [
                        'go to', 'navigate to', 'take me to', 'open property',
                        'show property', 'go to property'
                    ]
                    
                    # Check for action patterns
                    for pattern in show_patterns:
                        if pattern in q_lower:
                            # Try to extract what they want to see
                            target = 'citation'  # Default
                            if 'citation' in q_lower or 'source' in q_lower:
                                target = 'citation'
                            elif 'document' in q_lower or 'report' in q_lower or 'epc' in q_lower:
                                target = 'document'
                            elif 'property' in q_lower:
                                target = 'property'
                            return {'wants_action': True, 'action_type': 'show', 'target': target}
                    
                    for pattern in save_patterns:
                        if pattern in q_lower:
                            return {'wants_action': True, 'action_type': 'save', 'target': 'citation'}
                    
                    for pattern in navigate_patterns:
                        if pattern in q_lower:
                            return {'wants_action': True, 'action_type': 'navigate', 'target': 'property'}
                    
                    # No action intent detected
                    return {'wants_action': False, 'action_type': None, 'target': None}
                
                # ULTRA-FAST PATH: Only citation queries skip reasoning steps 
                # This allows follow-up queries to still show agentic reasoning
                # (Previously follow-ups skipped reasoning, but users want to see the agent "thinking")
                is_citation_query = citation_context and citation_context.get('cited_text')
                
                # NOTE: is_likely_followup detection removed from fast path
                # Follow-up queries should still show reasoning steps for an agentic experience
                # The keywords were too broad ('why', 'how', 'can you') and matched most questions
                
                # Citation queries still show reasoning steps (Planning next moves, then Summarising content)
                is_fast_path = is_citation_query
                
                if is_fast_path:
                    timing.mark("intent_extracted")
                else:
                    # Detect if this is a navigation query (similar to should_route logic)
                    query_lower = query.lower().strip()
                    # is_agent_mode is already defined at the top level (line 354)
                    is_navigation_query = False
                    
                    if is_agent_mode:
                        navigation_patterns = [
                            "take me to the", "take me to ", "go to the map", "navigate to the",
                            "show me on the map", "show on map", "find on map", "open the map",
                            "go to map", "click on the", "select the pin", "click the pin"
                        ]
                        pin_patterns = [" pin", "property pin", "map pin"]
                        info_keywords = ["value", "price", "cost", "worth", "valuation", "report", 
                                       "inspection", "document", "tell me about", "what is", "how much",
                                       "summary", "details", "information", "data"]
                        
                        is_info_query = any(keyword in query_lower for keyword in info_keywords)
                        
                        if not is_info_query:
                            has_navigation_intent = any(pattern in query_lower for pattern in navigation_patterns)
                            has_pin_intent = any(pattern in query_lower for pattern in pin_patterns)
                            is_navigation_query = has_navigation_intent or has_pin_intent
                    
                    timing.mark("intent_extracted")
                
                # Step (1): Planning next moves (all queries including citation - immediate feedback)
                initial_reasoning = {
                    'type': 'reasoning_step',
                    'step': 'planning_next_moves',
                    'action_type': 'planning',
                    'message': 'Planning next moves',
                    'details': {}
                }
                yield f"data: {json.dumps(initial_reasoning)}\n\n"
                logger.debug("🟡 [REASONING] Emitted step (1): Planning next moves")
                
                # Detect if user wants agent to perform UI actions (show me, save, navigate)
                action_intent = detect_action_intent(query)
                if action_intent['wants_action']:
                    logger.info(f"🎯 [ACTION_INTENT] Detected action intent: {action_intent}")
                
                async def run_and_stream():
                    """Run LangGraph and stream the final summary with reasoning steps"""
                    try:
                        logger.info("🟡 [STREAM] run_and_stream() async function started")
                        # Yield immediately so the client gets feedback while we build the graph (reduces perceived latency)
                        if effective_document_ids:
                            # Include first document's filename so UI shows real name instead of "Document"
                            reading_details = {}
                            try:
                                from backend.services.document_storage_service import DocumentStorageService
                                doc_storage = DocumentStorageService()
                                first_id = effective_document_ids[0]
                                ok, doc, _ = doc_storage.get_document(first_id, business_id)
                                if ok and doc:
                                    fn = (doc.get('original_filename') or '').strip()
                                    if fn:
                                        display_fn = fn[:32] + '...' if len(fn) > 35 else fn
                                        reading_details = {
                                            'filename': fn,
                                            'doc_metadata': {
                                                'doc_id': first_id,
                                                'original_filename': fn,
                                                'classification_type': doc.get('classification_type') or 'Document',
                                            },
                                        }
                            except Exception as e:
                                logger.debug(f"Could not resolve filename for reading step: {e}")
                            yield f"data: {json.dumps({'type': 'reasoning_step', 'step': 'reading_documents', 'action_type': 'reading', 'message': 'Reading selected documents...', 'details': reading_details, 'timestamp': time.time()})}\n\n"
                        else:
                            yield f"data: {json.dumps({'type': 'reasoning_step', 'step': 'preparing', 'action_type': 'planning', 'message': 'Preparing...', 'details': {}, 'timestamp': time.time()})}\n\n"
                        
                        # Create a new checkpointer and graph for current event loop.
                        # This avoids "Lock bound to different event loop" errors.
                        # All checkpointers use the same database, so conversation_history is still shared.
                        graph = None
                        checkpointer = None
                        try:
                            from backend.llm.runtime.graph_runner import graph_runner
                            # Check if GraphRunner has a checkpointer (to know if checkpointing is available)
                            has_checkpointer = graph_runner.get_checkpointer() is not None
                            if has_checkpointer:
                                # Create a new checkpointer for this event loop (shares same DB, different instance)
                                from backend.llm.graphs.main_graph import build_main_graph, create_checkpointer_for_current_loop
                                checkpointer = await create_checkpointer_for_current_loop()
                                if checkpointer:
                                    graph, _ = await build_main_graph(use_checkpointer=True, checkpointer_instance=checkpointer)
                                    logger.info("🟡 [STREAM] Created new checkpointer for current loop (shares DB with GraphRunner)")
                                else:
                                    graph, _ = await build_main_graph(use_checkpointer=False)
                                    logger.info("🟡 [STREAM] Failed to create checkpointer, using stateless graph")
                            else:
                                # No checkpointer available, create stateless graph
                                from backend.llm.graphs.main_graph import build_main_graph
                                graph, _ = await build_main_graph(use_checkpointer=False)
                                logger.info("🟡 [STREAM] GraphRunner has no checkpointer, using stateless graph")
                            timing.mark("checkpointer_created")
                            timing.mark("graph_built")
                        except Exception as runner_err:
                            logger.warning(f"🟡 [STREAM] GraphRunner unavailable, falling back to legacy per-request graph: {runner_err}")
                            from backend.llm.graphs.main_graph import build_main_graph, create_checkpointer_for_current_loop
                            checkpointer = await create_checkpointer_for_current_loop()
                            timing.mark("checkpointer_created")
                        if checkpointer:
                            graph, _ = await build_main_graph(use_checkpointer=True, checkpointer_instance=checkpointer)
                        else:
                            graph, _ = await build_main_graph(use_checkpointer=False)
                            timing.mark("graph_built")
                            logger.info("🟡 [STREAM] Using per-request graph and checkpointer")
                        
                        # Build config with metadata for LangSmith tracing
                        # Use user_id from initial_state (already captured before async context)
                        user_id_from_state = initial_state.get("user_id", "anonymous")
                        config_dict = {
                            "configurable": {
                                "thread_id": session_id,
                                # Add metadata for LangSmith traces (user context)
                                "metadata": {
                                    "user_id": user_id_from_state,
                                    "business_id": str(business_id) if business_id else "unknown",
                                    "query_preview": query[:100] if query else "",  # First 100 chars for context
                                    "endpoint": "stream"
                                }
                            },
                            # Allow planner->executor->evaluator refinement loops (up to 3) without hitting limit
                            "recursion_limit": 50,
                        }
                        
                        # Check for existing session state (follow-up detection)
                        is_followup = False
                        existing_doc_count = 0
                        loaded_conversation_history = []
                        existing_state = None
                        try:
                            if checkpointer:
                                existing_state = await graph.aget_state(config_dict)
                                if existing_state and existing_state.values:
                                    conv_history = existing_state.values.get('conversation_history', [])
                                    prev_docs = existing_state.values.get('relevant_documents', [])
                                    if conv_history and len(conv_history) > 0:
                                        is_followup = True
                                        loaded_conversation_history = conv_history
                                    if prev_docs:
                                        existing_doc_count = len(prev_docs)
                        except Exception as state_err:
                            logger.warning(f"Could not check existing state: {state_err}")
                        
                        # Cache-first for follow-ups: reuse execution_results from checkpoint to skip planner+executor
                        if is_followup and existing_state is not None and getattr(existing_state, "values", None):
                            cached_results = existing_state.values.get("execution_results") or []
                            if cached_results and len(cached_results) > 0:
                                initial_state["use_cached_results"] = True
                                initial_state["execution_results"] = list(cached_results)  # copy, do not mutate checkpoint
                                logger.info(f"🟢 [STREAM] Cache-first: reusing {len(cached_results)} execution_results from checkpoint (skipping planner+executor)")
                        
                        # WORKAROUND: If checkpointer unavailable, try to use messageHistory from request
                        # This is a temporary solution until checkpointer is properly configured
                        if not loaded_conversation_history and not checkpointer and message_history:
                            logger.info(f"🟡 [STREAM] Checkpointer unavailable, but messageHistory provided ({len(message_history)} messages)")
                            # Note: messageHistory format is different from conversation_history format
                            # We can't fully reconstruct block_ids from messageHistory, but we can at least
                            # pass it through so the query classifier can see there was a previous query
                            # For now, we'll rely on the checkpointer being enabled for full functionality
                        
                        # Use astream_events to capture node execution and emit reasoning steps
                        logger.info("🟡 [STREAM] Starting graph execution with event streaming...")
                        
                        # Track which nodes have been processed to avoid duplicate reasoning steps
                        processed_nodes = set()
                        # Emit "Found N documents" + "Reading Document" only once (executor on_chain_end fires after each step)
                        executor_found_docs_emitted = False
                        # Emit only one "Preparing ..." / searching step per request (avoid duplicate from planner + executor)
                        searching_step_emitted = False
                        
                        # Track reading timestamp - set when documents are first seen (before summarizing)
                        # This ensures reading steps appear before summarizing in the UI
                        reading_timestamp = None
                        
                        # Track if this is a follow-up for dynamic step generation
                        followup_context = {
                            'is_followup': is_followup,
                            'existing_doc_count': existing_doc_count,
                            'docs_already_shown': False  # Track if we've shown "Using cached" message
                        }
                        
                        # Node name to user-friendly message mapping with action types for Cursor-style UI
                        # Main path (context_manager → planner → executor → responder) and direct path (summarize_results)
                        # Chip queries: use document-focused steps instead of "Searching for documents" / "Reviewed relevant sections"
                        is_chip_query = bool(effective_document_ids)
                        node_messages = {
                            'clarify_relevant_docs': {
                                'action_type': 'analysing',
                                'message': 'Ranking results',
                                'details': {}
                            },
                            'summarize_results': {
                                'action_type': 'planning',
                                'message': 'Summarising content',
                                'details': {}
                            },
                            # Main retrieval path: step (1) "Planning next moves" from initial_reasoning; (2) from phase "Searching for {query}"
                            # planner/executor not in node_messages to avoid duplicates
                            'responder': {
                                'action_type': 'analysing',
                                'message': 'Summarising content',
                                'details': {}
                            },
                        }
                        
                        # Stream events from graph execution and track state
                        # IMPORTANT: astream_events executes the graph and emits events as nodes run
                        # We MUST emit reasoning steps immediately when nodes start
                        if is_fast_path:
                            logger.info("🟡 [REASONING] Citation path - emitting Planning next moves + Summarising content")
                        else:
                            logger.info("🟡 [REASONING] Starting to stream events and emit reasoning steps...")
                        final_result = None
                        summary_already_streamed = False  # Track if we've already streamed the summary
                        streamed_summary = None  # Store the exact summary that was streamed to ensure consistency
                        memory_storage_scheduled = False  # Track if Mem0 memory storage has been scheduled for this request
                        
                        # Execute graph with error handling for connection timeouts during execution
                        # Since we create a new graph for the current loop, we can use astream_events directly
                        timing.mark("graph_execution_start")
                        node_timings = {}  # Track timing per node
                        
                        # NEW: Helper to consume execution events from queue
                        def consume_execution_events():
                            """Consume execution events from queue and yield them (non-blocking)"""
                            events_yielded = []
                            while True:
                                try:
                                    event = event_queue.get_nowait()  # Non-blocking
                                    events_yielded.append(event)
                                except:
                                    break
                            return events_yielded
                        
                        try:
                            event_stream = graph.astream_events(initial_state, config_dict, version="v2")
                            async for event in event_stream:
                                # NEW: Consume execution events from queue (non-blocking, after each graph event)
                                execution_events = consume_execution_events()
                                for exec_event in execution_events:
                                    payload = exec_event.to_dict()
                                    # When executor/planner emits phase events with reasoning (e.g. "Searched documents", "Reviewed selected document(s)"),
                                    # emit a reasoning_step so the UI shows the step when the toggle is on
                                    if not is_fast_path and payload.get('type') == 'phase' and (payload.get('metadata') or {}).get('reasoning'):
                                        label = (payload.get('metadata') or {}).get('label') or payload.get('description', '')
                                        label_stripped = (label or '').strip()
                                        if label_stripped.startswith('Planning search for') or label_stripped.startswith('Finding the ') or label_stripped.startswith('Finding '):
                                            # Normal retrieval uses "Planning next moves" (step 1) from initial_reasoning; skip duplicate from phase
                                            pass
                                        elif label and ('Searched' in label or 'search' in label.lower() or label_stripped.startswith('Preparing ') or label_stripped.startswith('Finding ') or label_stripped.startswith('Searching for ') or label_stripped.startswith('Locating ')):
                                            # Emit only one searching step per request to avoid duplicate
                                            if not searching_step_emitted:
                                                searching_step_emitted = True
                                                # Use the label from the executor ("Finding {intent}", "Scanning selected document", or legacy "Searching for ...")
                                                if is_chip_query:
                                                    search_message = 'Scanning selected document'
                                                else:
                                                    search_message = label_stripped or 'Searching for documents'
                                                reasoning_data = {
                                                    'type': 'reasoning_step',
                                                    'step': 'searching_documents',
                                                    'action_type': 'searching',
                                                    'message': search_message,
                                                    'timestamp': time.time(),
                                                    'details': {}
                                                }
                                                yield f"data: {json.dumps(reasoning_data)}\n\n"
                                                logger.info(f"🟡 [REASONING] Emitted searching step (from executor): {search_message}")
                                        elif label and ('Reviewed' in label or 'review' in label.lower()):
                                            # Normal retrieval: skip "Reviewed relevant sections" so steps match (1) Planning (2) Searching for query (3) Found x docs (4) Read
                                            pass
                                    event_data = {
                                        'type': 'execution_event',
                                        'payload': payload
                                    }
                                    yield f"data: {json.dumps(event_data)}\n\n"
                                event_type = event.get('event')
                                node_name = event.get("name", "")
                                
                                # Track node start times for performance analysis
                                if event_type == "on_chain_start":
                                    node_timings[node_name] = time.perf_counter()
                                    timing.mark(f"node_{node_name}_start")
                                
                                # Capture node start events for reasoning steps - EMIT IMMEDIATELY
                                # Only emit steps for phases that are actually happening (searching, reading, etc.)
                                # Do NOT emit "Summarising content" when responder starts - emit it when we actually start streaming
                                if event_type == "on_chain_start":
                                    if is_fast_path and node_name == "handle_citation_query":
                                        # Citation path: replace "Planning next moves" with "Summarising content"
                                        reasoning_data = {
                                            'type': 'reasoning_step',
                                            'step': 'handle_citation_query',
                                            'action_type': 'analysing',
                                            'message': 'Summarising content',
                                            'details': {}
                                        }
                                        yield f"data: {json.dumps(reasoning_data)}\n\n"
                                        logger.info("🟡 [REASONING] ✅ Emitted citation step: Summarising content")
                                    elif not is_fast_path and node_name in node_messages and node_name not in processed_nodes:
                                        # Skip responder: "Summarising content" is emitted when we actually start streaming (first token), not when node starts
                                        if node_name == "responder":
                                            pass
                                        else:
                                            processed_nodes.add(node_name)
                                            reasoning_data = {
                                                'type': 'reasoning_step',
                                                'step': node_name,
                                                'action_type': node_messages[node_name].get('action_type', 'analysing'),
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
                                    
                                    # Track node end times and log duration
                                    if node_name in node_timings:
                                        node_duration = time.perf_counter() - node_timings[node_name]
                                        timing.mark(f"node_{node_name}_end")
                                        # Log slow nodes (>1s) for performance analysis
                                        if node_duration > 1.0:
                                            logger.info(f"⏱️ [PERF] Node '{node_name}' took {node_duration:.2f}s")
                                    
                                    # Try to extract state from the event
                                    # LangGraph astream_events: event["data"] is often the node return value directly (e.g. executor returns {execution_results, ...})
                                    event_data = event.get("data", {})
                                    state_update = event_data.get("data", {})  # Nested state (if present)
                                    output = event_data.get("output", {})  # Nested output (if present)
                                    
                                    # Update details based on node output
                                    # SKIP reasoning step emissions for citation queries (ultra-fast path)
                                    # but still capture state updates for final result
                                    if node_name == "query_vector_documents" and not is_fast_path:
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
                                                    # Fix grammar: "1 document" vs "X documents"
                                                    doc_word = "document" if doc_count == 1 else "documents"
                                                    message = f'Using {doc_count} existing {doc_word}'
                                                followup_context['docs_already_shown'] = True
                                            else:
                                                # First query - show full "Found X documents" message
                                                if doc_names:
                                                    names_str = ', '.join(doc_names)
                                                    # Fix grammar: "1 document" vs "X documents"
                                                    doc_word = "document" if doc_count == 1 else "documents"
                                                    message = f'Found {doc_count} {doc_word}: {names_str}'
                                                else:
                                                    # Fix grammar: "1 document" vs "X documents"
                                                    doc_word = "document" if doc_count == 1 else "documents"
                                                    message = f'Found {doc_count} {doc_word}'
                                            
                                            # Set reading timestamp when documents are first found (before analyzing/summarizing)
                                            # This ensures reading steps appear in correct order (after found, before summarizing)
                                            if reading_timestamp is None:
                                                reading_timestamp = time.time() + 0.1  # Slightly after "Found documents", before "Analyzing"
                                            
                                            reasoning_data = {
                                                'type': 'reasoning_step',
                                                'step': 'found_documents',
                                                'action_type': 'exploring',
                                                'message': message,
                                                'count': doc_count,
                                                'timestamp': time.time(),  # Ensure proper ordering
                                                'details': {
                                                    'documents_found': doc_count, 
                                                    'document_names': doc_names,
                                                    'doc_previews': doc_previews  # Full metadata for preview cards
                                                }
                                            }
                                            yield f"data: {json.dumps(reasoning_data)}\n\n"
                                            
                                            # IMMEDIATELY emit "Analyzing" step after found_documents for faster UI feedback
                                            # Only for non-follow-ups (follow-ups get their own "Analyzing" step during process_documents)
                                            if not followup_context.get('is_followup'):
                                                doc_word_analyzing = "document" if doc_count == 1 else "documents"
                                                analyzing_data = {
                                                    'type': 'reasoning_step',
                                                    'step': 'analyzing_documents',
                                                    'action_type': 'analysing',
                                                    'message': f'Analysing {doc_count} {doc_word_analyzing} for your question',
                                                    'timestamp': time.time(),  # Ensure proper ordering
                                                    'details': {'documents_to_analyze': doc_count}
                                                }
                                                yield f"data: {json.dumps(analyzing_data)}\n\n"
                                    
                                            # EARLY DOCUMENT PREPARATION: In agent mode, emit prepare_document action
                                            # This allows frontend to start loading the document BEFORE answer generation
                                            if is_agent_mode and doc_previews:
                                                first_doc = doc_previews[0]
                                                prepare_action = {
                                                    'type': 'prepare_document',
                                                    'doc_id': first_doc.get('doc_id'),
                                                    'filename': first_doc.get('original_filename', ''),
                                                    'download_url': first_doc.get('download_url', '')
                                                }
                                                yield f"data: {json.dumps(prepare_action)}\n\n"
                                                logger.info(f"📂 [EARLY_PREP] Emitted prepare_document for {first_doc.get('doc_id', '')[:8]}...")
                                    
                                    elif node_name == "executor" and not is_fast_path:
                                        # Planner/Executor path: emit "Found N relevant document(s):" + "Reading" only for
                                        # documents we actually read (have chunks for). Wait until we have retrieve_chunks
                                        # result so we don't show docs we never read.
                                        state_data = state_update or output or event_data
                                        execution_results = state_data.get("execution_results", []) or []
                                        docs_result = None
                                        chunks_result = None
                                        for r in execution_results:
                                            if r.get("action") == "retrieve_docs" and r.get("result"):
                                                docs_result = r["result"]
                                            if r.get("action") == "retrieve_chunks" and r.get("result"):
                                                chunks_result = r["result"]
                                        # Build set of document_ids we actually have chunks for
                                        doc_ids_with_chunks = set()
                                        if chunks_result and isinstance(chunks_result, list):
                                            for item in chunks_result:
                                                if isinstance(item, dict):
                                                    did = item.get("document_id") or item.get("doc_id")
                                                    if did:
                                                        doc_ids_with_chunks.add(str(did))
                                        # Only emit once, and only when we have retrieve_chunks so we can filter
                                        if docs_result and not executor_found_docs_emitted and chunks_result is not None:
                                            # Restrict to docs we actually read (have chunks for); preserve order from docs_result
                                            docs_read = [d for d in docs_result if str(d.get("document_id") or d.get("doc_id") or "") in doc_ids_with_chunks]
                                            if not docs_read and docs_result and len(doc_ids_with_chunks) == 0:
                                                # Chunks result was empty list - we "read" no docs
                                                docs_read = []
                                            executor_found_docs_emitted = True
                                            doc_names = []
                                            doc_previews = []
                                            for doc in docs_read[:10]:
                                                doc_id = doc.get("document_id") or doc.get("doc_id", "")
                                                filename = doc.get("filename") or doc.get("original_filename", "") or ""
                                                classification_type = doc.get("document_type") or doc.get("classification_type", "Document") or "Document"
                                                display_name = (filename[:32] + "...") if len(filename) > 35 else (filename or classification_type.replace("_", " ").title())
                                                doc_names.append(display_name)
                                                doc_previews.append({
                                                    "doc_id": doc_id,
                                                    "original_filename": filename if filename else None,
                                                    "classification_type": classification_type,
                                                    "page_range": doc.get("page_range", ""),
                                                    "page_numbers": doc.get("page_numbers", []),
                                                    "s3_path": doc.get("s3_path", ""),
                                                    "download_url": f"/api/files/download?document_id={doc_id}" if doc_id else ""
                                                })
                                            doc_count = len(docs_read)
                                            if doc_count == 0:
                                                logger.debug("🟡 [REASONING] No documents had chunks; skipping found_documents + reading steps")
                                            else:
                                                doc_word = "document" if doc_count == 1 else "documents"
                                                message = f'Found {doc_count} relevant {doc_word}:'
                                                if reading_timestamp is None:
                                                    reading_timestamp = time.time() + 0.1
                                                reasoning_data = {
                                                    'type': 'reasoning_step',
                                                    'step': 'found_documents',
                                                    'action_type': 'exploring',
                                                    'message': message,
                                                    'count': doc_count,
                                                    'timestamp': time.time(),
                                                    'details': {
                                                        'documents_found': doc_count,
                                                        'document_names': doc_names,
                                                        'doc_previews': doc_previews
                                                    }
                                                }
                                                yield f"data: {json.dumps(reasoning_data)}\n\n"
                                                # Emit one reading step per document we actually read
                                                for i, doc_preview in enumerate(doc_previews):
                                                    display_filename = (doc_preview.get('original_filename') or doc_preview.get('classification_type', 'Document') or 'Document')
                                                    if display_filename and len(display_filename) > 35:
                                                        display_filename = display_filename[:32] + '...'
                                                    if not display_filename:
                                                        display_filename = (doc_preview.get('classification_type') or 'Document').replace('_', ' ').title()
                                                    doc_metadata = {
                                                        'doc_id': doc_preview.get('doc_id', ''),
                                                        'original_filename': doc_preview.get('original_filename') if doc_preview.get('original_filename') else None,
                                                        'classification_type': doc_preview.get('classification_type', 'Document') or 'Document',
                                                        'page_range': doc_preview.get('page_range', ''),
                                                        'page_numbers': doc_preview.get('page_numbers', []),
                                                        's3_path': doc_preview.get('s3_path', ''),
                                                        'download_url': doc_preview.get('download_url', '') or (f"/api/files/download?document_id={doc_preview.get('doc_id')}" if doc_preview.get('doc_id') else '')
                                                    }
                                                    reading_step_timestamp = reading_timestamp + (i * 0.01) if reading_timestamp else time.time()
                                                    reading_data = {
                                                        'type': 'reasoning_step',
                                                        'step': f'read_doc_exec_{i}',
                                                        'action_type': 'reading',
                                                        'message': f'Read {display_filename}',
                                                        'timestamp': reading_step_timestamp,
                                                        'details': {
                                                            'document_index': i,
                                                            'filename': doc_preview.get('original_filename'),
                                                            'doc_metadata': doc_metadata
                                                        }
                                                    }
                                                    yield f"data: {json.dumps(reading_data)}\n\n"
                                                logger.debug(f"🟡 [REASONING] Emitted executor found_documents + {len(doc_previews)} reading steps ({doc_count} docs we read)")
                                    
                                    elif node_name == "process_documents" and not is_fast_path:
                                        state_data = state_update if state_update else output
                                        doc_outputs = state_data.get("document_outputs", [])
                                        doc_outputs_count = len(doc_outputs)
                                        if doc_outputs_count > 0:
                                            # Use reading timestamp set when documents were found (before analyzing/summarizing)
                                            # Fallback if not set (shouldn't happen, but safety check)
                                            if reading_timestamp is None:
                                                reading_timestamp = time.time() - 2.0  # Fallback: 2 seconds before current time
                                            
                                            # Get relevant_documents from state to match doc_ids
                                            relevant_docs = state_data.get("relevant_documents", [])
                                            
                                            # For follow-ups, show a single "Analyzing documents" step
                                            # For first queries, show individual "Read [filename]" steps with preview cards
                                            if followup_context['is_followup']:
                                                # Single step for follow-up - documents already read before
                                                reasoning_data = {
                                                    'type': 'reasoning_step',
                                                    'step': 'analyzing_for_followup',
                                                    'action_type': 'analysing',
                                                    'message': f'Analysing {doc_outputs_count} documents for your question',
                                                    'timestamp': time.time(),  # Ensure proper ordering
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
                                                    
                                                    # Use reading_timestamp to ensure reading steps appear before summarizing
                                                    # Increment slightly for each document to maintain order
                                                    reading_step_timestamp = reading_timestamp + (i * 0.01) if reading_timestamp else time.time()
                                                    
                                                    reasoning_data = {
                                                        'type': 'reasoning_step',
                                                        'step': f'read_doc_{i}',
                                                        'action_type': 'reading',
                                                        'message': f'Read {display_filename}',
                                                        'timestamp': reading_step_timestamp,  # Use tracked reading timestamp
                                                        'details': {
                                                            'document_index': i, 
                                                            'filename': filename if filename else None,
                                                            'doc_metadata': doc_metadata
                                                        }
                                                    }
                                                    yield f"data: {json.dumps(reasoning_data)}\n\n"
                                    
                                    # Handle citation query completion (ULTRA-FAST path)
                                    if node_name == "handle_citation_query":
                                        state_data = state_update if state_update else output
                                        
                                        # Initialize final_result if needed
                                        if final_result is None:
                                            final_result = {}
                                        
                                        # Capture final_summary from citation query handler
                                        final_summary_from_citation = state_data.get('final_summary', '')
                                        if final_summary_from_citation:
                                            final_result['final_summary'] = final_summary_from_citation
                                            logger.info(f"⚡ [CITATION_QUERY] Captured final_summary ({len(final_summary_from_citation)} chars)")
                                        
                                        # Capture citations
                                        citations_from_citation = state_data.get('citations', [])
                                        if citations_from_citation:
                                            final_result['citations'] = citations_from_citation
                                            logger.info(f"⚡ [CITATION_QUERY] Captured {len(citations_from_citation)} citations")
                                    
                                    # Handle responder node completion (main path: planner → executor → responder, including chip/@ queries)
                                    # Use same citation mapping as summarize path: capture chunk_citations with bbox, block_id, doc_id
                                    elif node_name == "responder":
                                        state_data = state_update if state_update else output
                                        if final_result is None:
                                            final_result = {}
                                        final_summary_from_responder = state_data.get('final_summary', '')
                                        if final_summary_from_responder:
                                            final_result['final_summary'] = final_summary_from_responder
                                            logger.info(f"🟢 [STREAM] Captured final_summary from responder ({len(final_summary_from_responder)} chars)")
                                        chunk_citations_from_responder = state_data.get('chunk_citations', []) or state_data.get('citations', [])
                                        if chunk_citations_from_responder:
                                            final_result['chunk_citations'] = chunk_citations_from_responder
                                            final_result['citations'] = chunk_citations_from_responder
                                            logger.info(
                                                f"🟢 [CITATION_STREAM] Captured {len(chunk_citations_from_responder)} citations from responder "
                                                "(same citation mapping as regular queries)"
                                            )
                                            # Stream citation events so frontend gets same real-time citation handling
                                            try:
                                                for citation in chunk_citations_from_responder:
                                                    citation_num_str = str(citation.get('citation_number', ''))
                                                    citation_bbox = citation.get('bbox')
                                                    citation_page = citation.get('page_number', 0)
                                                    if citation_bbox and isinstance(citation_bbox, dict):
                                                        citation_bbox = citation_bbox.copy()
                                                        citation_bbox['page'] = citation_bbox.get('page', citation_page)
                                                    citation_data = {
                                                        'doc_id': citation.get('doc_id', ''),
                                                        'document_id': citation.get('doc_id', ''),
                                                        'page': citation_page,
                                                        'bbox': citation_bbox,
                                                        'method': citation.get('method', 'block-id-lookup'),
                                                        'block_id': citation.get('block_id'),
                                                        'cited_text': citation.get('cited_text', ''),
                                                        'original_filename': citation.get('original_filename', '')
                                                    }
                                                    citation_event = {'type': 'citation', 'citation_number': citation.get('citation_number'), 'data': citation_data}
                                                    yield f"data: {json.dumps(citation_event)}\n\n"
                                            except Exception as cit_err:
                                                logger.warning(f"🟡 [CITATION_STREAM] Error streaming responder citations: {cit_err}")
                                    
                                    # Handle conversation node completion (chat-only path, no doc retrieval)
                                    elif node_name == "conversation":
                                        state_data = state_update if state_update else output
                                        if final_result is None:
                                            final_result = {}
                                        final_summary_from_conversation = state_data.get('final_summary', '')
                                        if final_summary_from_conversation:
                                            final_result['final_summary'] = final_summary_from_conversation
                                            logger.info(f"🟢 [STREAM] Captured final_summary from conversation ({len(final_summary_from_conversation)} chars)")
                                        if state_data.get('personality_id'):
                                            final_result['personality_id'] = state_data['personality_id']

                                    # Handle summarize_results node completion - citations already have bbox coordinates
                                    elif node_name == "summarize_results":
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
                                        
                                        if citations_from_state:
                                            logger.info(
                                                f"🟢 [CITATION_STREAM] Processing {len(citations_from_state)} citations "
                                                f"from summarize_results node (bbox coordinates already included)"
                                            )
                                            
                                            try:
                                                # Format citations for frontend (convert List[Citation] to Dict[str, CitationData])
                                                processed_citations = {}
                                                # Jan28th-style: build doc_id -> original_filename from document_outputs for citation display
                                                doc_filename_map = {}
                                                for doc_output in (doc_outputs_from_state or []):
                                                    doc_id = doc_output.get('doc_id')
                                                    filename = doc_output.get('original_filename')
                                                    if doc_id and filename:
                                                        doc_filename_map[doc_id] = filename
                                                
                                                # Stream citation events immediately
                                                for citation in citations_from_state:
                                                    citation_num_str = str(citation['citation_number'])
                                                    
                                                    # Format citation data for frontend
                                                    # CRITICAL: Ensure bbox is included and properly structured
                                                    citation_bbox = citation.get('bbox')
                                                    citation_page = citation.get('page_number') or (citation_bbox.get('page') if citation_bbox and isinstance(citation_bbox, dict) else None) or 0
                                                    
                                                    # CRITICAL: Ensure bbox page matches citation page_number
                                                    # This prevents mismatches where bbox has page 0 but citation has page 1
                                                    if citation_bbox and isinstance(citation_bbox, dict):
                                                        citation_bbox = citation_bbox.copy()  # Don't modify original
                                                        citation_bbox['page'] = citation_page  # Update bbox page to match citation page
                                                    
                                                    citation_doc_id = citation.get('doc_id')
                                                    citation_filename = doc_filename_map.get(citation_doc_id, '')
                                                    citation_data = {
                                                        'doc_id': citation_doc_id,
                                                        'document_id': citation_doc_id,  # Frontend download/panel may expect document_id
                                                        'page': citation_page,
                                                        'bbox': citation_bbox,  # Bbox now has correct page number
                                                        'method': citation.get('method', 'block-id-lookup'),
                                                        'block_id': citation.get('block_id'),  # Include block_id for debugging
                                                        'cited_text': citation.get('cited_text', ''),  # Include cited_text for sub-level bbox
                                                        'original_filename': citation_filename  # Jan28th: filename for frontend display
                                                    }
                                                    
                                                    block_id = citation.get('block_id', 'UNKNOWN')
                                                    logger.info(
                                                        f"🟢 [CITATION_STREAM] Citation {citation_num_str} data: "
                                                        f"block_id={block_id}, "
                                                        f"doc_id={citation_data.get('doc_id', '')[:8]}, "
                                                        f"page={citation_data.get('page')}, "
                                                        f"has_bbox={bool(citation_bbox)}, "
                                                        f"bbox_keys={list(citation_bbox.keys()) if citation_bbox and isinstance(citation_bbox, dict) else 'none'}"
                                                    )
                                                    
                                                    processed_citations[citation_num_str] = citation_data
                                                    if citation_num_str == '1':
                                                        logger.info(
                                                            "[CITATION_DEBUG] views: citation 1 -> block_id=%s doc_id=%s page=%s cited_text=%s",
                                                            citation.get('block_id'), (citation_doc_id or '')[:12], citation_page,
                                                            (citation.get('cited_text') or '')[:100]
                                                        )
                                                    
                                                    # #region agent log
                                                    try:
                                                        import json as json_module
                                                        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                                                            f.write(json_module.dumps({
                                                                'sessionId': 'debug-session',
                                                                'runId': 'run1',
                                                                'hypothesisId': 'D',
                                                                'location': 'views.py:815',
                                                                'message': 'Backend sending citation to frontend',
                                                                'data': {
                                                                    'citation_number': citation_num_str,
                                                                    'cited_text': citation.get('cited_text', ''),
                                                                    'block_id': block_id,
                                                                    'bbox': citation_bbox,
                                                                    'page': citation_page,
                                                                    'doc_id': citation_data.get('doc_id', '')[:8] if citation_data.get('doc_id') else 'UNKNOWN'
                                                                },
                                                                'timestamp': int(__import__('time').time() * 1000)
                                                            }) + '\n')
                                                    except: pass
                                                    # #endregion
                                                    
                                                    # Stream citation event
                                                    citation_event = {
                                                        'type': 'citation',
                                                        'citation_number': citation['citation_number'],
                                                        'data': citation_data
                                                    }
                                                    yield f"data: {json.dumps(citation_event)}\n\n"
                                                    logger.info(
                                                        f"🟢 [CITATION_STREAM] Streamed citation {citation_num_str} "
                                                        f"(block_id: {block_id}, doc: {citation_data.get('doc_id', '')[:8]}, page: {citation_data.get('page')})"
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
                                        
                                        # 🚀 IMMEDIATE STREAMING: Stream the summary NOW, don't wait for checkpointer!
                                        # This eliminates the 20+ second delay caused by checkpointer saving
                                        if final_summary_from_state and not summary_already_streamed:
                                            logger.info("🚀 [STREAM] IMMEDIATE: Streaming summary directly from summarize_results (skipping checkpointer wait)")
                                            
                                            # Send document count
                                            doc_count = len(doc_outputs_from_state) if doc_outputs_from_state else len(relevant_docs_from_state)
                                            yield f"data: {json.dumps({'type': 'documents_found', 'count': doc_count})}\n\n"
                                            
                                            # Emit "Summarizing content" reasoning step (like Cursor's wand sparkles)
                                            # Use timestamp to ensure it comes after all reading steps
                                            summarize_timestamp = time.time()
                                            summarizing_data = {
                                                'type': 'reasoning_step',
                                                'step': 'summarizing_content',
                                                'action_type': 'summarising',
                                                'message': 'Summarising content',
                                                'timestamp': summarize_timestamp,  # After reading steps
                                                'details': {'documents_processed': doc_count}
                                            }
                                            yield f"data: {json.dumps(summarizing_data)}\n\n"
                                            logger.info("✨ [STREAM] Emitted 'Summarizing content' reasoning step")
                                            
                                            # AGENT-NATIVE: Agent actions are now emitted from frontend when they actually happen
                                            # This ensures "Opening citation view" appears when document actually opens, not before
                                            # (Reasoning steps for agent actions removed - they'll be added by frontend on actual execution)
                                            
                                            # Stream status
                                            yield f"data: {json.dumps({'type': 'status', 'message': 'Streaming response...'})}\n\n"
                                            
                                            # Stream the final response text directly - preserve all formatting
                                            # Strip leading "of [property]" leakage (intent phrase fragment) before streaming
                                            final_summary_from_state = _strip_intent_fragment_from_response(final_summary_from_state or "")
                                            streamed_summary = final_summary_from_state
                                            logger.info("🚀 [STREAM] Streaming final response directly (preserving formatting)")
                                            
                                            # Stream in chunks to maintain formatting while still providing smooth streaming
                                            for i in range(0, len(final_summary_from_state), STREAM_CHUNK_SIZE):
                                                if i == 0:
                                                    logger.info("🚀 [STREAM] First chunk streamed IMMEDIATELY from summarize_results")
                                                chunk = final_summary_from_state[i:i + STREAM_CHUNK_SIZE]
                                                yield f"data: {json.dumps({'type': 'token', 'token': chunk})}\n\n"
                                                if STREAM_CHUNK_DELAY_MS > 0:
                                                    time.sleep(STREAM_CHUNK_DELAY_MS / 1000.0)
                                            
                                            summary_already_streamed = True
                                            logger.info(f"🚀 [STREAM] Summary fully streamed ({len(final_summary_from_state)} chars) - continuing event loop for cleanup")
                                    
                                    # MERGE state updates from each node (don't overwrite!)
                                    # CRITICAL: This captures final_summary from extract_final_answer and other nodes
                                    if state_update:
                                        if final_result is None:
                                            final_result = {}
                                        final_result.update(state_update)  # Merge instead of overwrite
                                        
                                        # Log important captures for debugging
                                        if node_name == "extract_final_answer" and state_update.get("final_summary"):
                                            logger.info(f"🟢 [STREAM] Captured final_summary from extract_final_answer ({len(state_update.get('final_summary', ''))} chars)")
                                        elif node_name == "agent" and state_update.get("messages"):
                                            logger.info(f"🟢 [STREAM] Captured messages from agent node ({len(state_update.get('messages', []))} messages)")
                                    # Also try output field as fallback
                                    elif output and isinstance(output, dict):
                                        if final_result is None:
                                            final_result = {}
                                        final_result.update(output)
                                        logger.info(f"🟢 [STREAM] Captured state from {node_name} output field")
                        except Exception as exec_error:
                            error_msg = str(exec_error)
                            # Handle connection timeout errors during graph execution
                            if "couldn't get a connection" in error_msg.lower() or "timeout" in error_msg.lower():
                                logger.warning(f"🟡 [STREAM] Connection timeout during graph execution: {exec_error}")
                                logger.info("🟡 [STREAM] Retrying without checkpointer (stateless mode)")
                                # Retry without checkpointer
                                graph, _ = await build_main_graph(use_checkpointer=False)
                                config_dict = {"recursion_limit": 50}  # No thread_id needed for stateless mode
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
                                                'action_type': node_messages[node_name].get('action_type', 'analysing'),
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
                                                
                                                # Set reading timestamp when documents are first found (before analyzing/summarizing)
                                                # This ensures reading steps appear in correct order (after found, before summarizing)
                                                if reading_timestamp is None:
                                                    reading_timestamp = time.time() + 0.1  # Slightly after "Found documents", before "Analyzing"
                                                
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
                                                    'timestamp': time.time(),  # Ensure proper ordering
                                                    'details': {
                                                        'documents_found': doc_count,
                                                        'document_names': doc_names,
                                                        'doc_previews': doc_previews  # Full metadata for preview cards
                                                    }
                                                }
                                                yield f"data: {json.dumps(reasoning_data)}\n\n"
                                                
                                                # IMMEDIATELY emit "Analyzing" step after found_documents for faster UI feedback
                                                # Only for non-follow-ups (follow-ups get their own "Analyzing" step during process_documents)
                                                if not followup_context.get('is_followup'):
                                                    doc_word_analyzing = "document" if doc_count == 1 else "documents"
                                                    analyzing_data = {
                                                        'type': 'reasoning_step',
                                                        'step': 'analyzing_documents',
                                                        'action_type': 'analysing',
                                                        'message': f'Analysing {doc_count} {doc_word_analyzing} for your question',
                                                        'timestamp': time.time(),  # Ensure proper ordering
                                                        'details': {'documents_to_analyze': doc_count}
                                                    }
                                                    yield f"data: {json.dumps(analyzing_data)}\n\n"
                                        
                                        elif node_name == "process_documents":
                                            state_data = state_update if state_update else event_data.get("output", {})
                                            doc_outputs = state_data.get("document_outputs", [])
                                            doc_outputs_count = len(doc_outputs)
                                            if doc_outputs_count > 0:
                                                # Use reading timestamp set when documents were found (before analyzing/summarizing)
                                                # Fallback if not set (shouldn't happen, but safety check)
                                                if reading_timestamp is None:
                                                    reading_timestamp = time.time() - 2.0  # Fallback: 2 seconds before current time
                                                
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
                                                    
                                                    # Use reading_timestamp to ensure reading steps appear before summarizing
                                                    # Increment slightly for each document to maintain order
                                                    reading_step_timestamp = reading_timestamp + (i * 0.01) if reading_timestamp else time.time()
                                                    
                                                    reasoning_data = {
                                                        'type': 'reasoning_step',
                                                        'step': f'read_doc_{i}',
                                                        'action_type': 'reading',
                                                        'message': f'Read {display_filename}',
                                                        'timestamp': reading_step_timestamp,  # Use tracked reading timestamp
                                                        'details': {
                                                            'document_index': i, 
                                                            'filename': filename if filename else None,
                                                            'doc_metadata': doc_metadata
                                                        }
                                                    }
                                                    yield f"data: {json.dumps(reasoning_data)}\n\n"
                                        
                                        # Store the state from ALL node completions (especially extract_final_answer)
                                        # CRITICAL: This captures the final_summary from extract_final_answer node
                                        if state_update:
                                            final_result = state_update
                                            if node_name == "extract_final_answer":
                                                logger.info(f"🟢 [STREAM] Captured final state from extract_final_answer node")
                                        # Also try output field as fallback
                                        elif event_data.get("output"):
                                            output = event_data.get("output", {})
                                            if isinstance(output, dict):
                                                final_result = output
                                                logger.info(f"🟢 [STREAM] Captured final state from {node_name} output")
                            else:
                                # Re-raise unexpected errors
                                raise
                        
                        # After astream_events completes, the graph has finished executing
                        # Get the final state from checkpointer (fast - graph already executed)
                        if final_result is None:
                            logger.warning("🟡 [STREAM] No final state from events, reading from checkpointer...")
                            # Check if checkpointer exists (might be None in stateless mode)
                            if checkpointer is None:
                                logger.warning("🟡 [STREAM] No checkpointer available (stateless mode) - using initial_state")
                                final_result = initial_state
                            else:
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
                                        # ❌ REMOVED: Don't invoke graph again - causes duplicate messages!
                                        # Instead use initial_state (graph already executed via astream_events)
                                        logger.warning("🟡 [STREAM] No checkpoint found, using initial_state (graph already executed)")
                                        final_result = initial_state
                                except Exception as e:
                                    # ❌ REMOVED: Don't invoke graph again - causes duplicate messages!
                                    logger.warning(f"🟡 [STREAM] Could not read checkpointer: {e}, using initial_state")
                                    final_result = initial_state
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
                        # CRITICAL: Use streamed_summary if available (the exact text we streamed) to ensure consistency
                        # Otherwise use final_summary from result
                        full_summary = streamed_summary if streamed_summary else final_result.get('final_summary', '')
                        # Strip leading "of [property]" leakage (intent phrase fragment) before streaming/complete
                        full_summary = _strip_intent_fragment_from_response(full_summary or "")

                        # --- Mem0: Schedule memory storage (fire-and-forget) ---
                        if not memory_storage_scheduled and full_summary:
                            try:
                                from backend.llm.config import config as llm_config
                                if getattr(llm_config, "mem0_enabled", False):
                                    from backend.services.memory_service import velora_memory
                                    user_id_for_mem = initial_state.get("user_id", "anonymous")
                                    asyncio.create_task(
                                        velora_memory.add(
                                            messages=[
                                                {"role": "user", "content": query},
                                                {"role": "assistant", "content": full_summary},
                                            ],
                                            user_id=str(user_id_for_mem),
                                            metadata={"thread_id": str(session_id)},
                                        )
                                    )
                                    memory_storage_scheduled = True
                                    logger.info(f"[MEMORY] Scheduled memory storage for user={str(user_id_for_mem)[:8]}...")
                            except Exception as mem_err:
                                logger.warning(f"[MEMORY] Failed to schedule memory storage: {mem_err}")
                        
                        # Check if we have a summary (even if doc_outputs is empty, summary means we processed documents)
                        if not full_summary:
                            # Only error if we have neither summary nor documents
                            if not doc_outputs:
                                logger.error("🟡 [STREAM] No summary and no documents - cannot proceed")
                                yield f"data: {json.dumps({'type': 'error', 'message': 'No relevant documents found'})}\n\n"
                                return
                            else:
                                logger.warning("🟡 [STREAM] No final_summary found in result")
                                full_summary = ""  # Let agent handle empty responses naturally
                        
                        # Send document count (use doc_outputs if available, otherwise relevant_docs)
                        doc_count = len(doc_outputs) if doc_outputs else len(relevant_docs)
                        yield f"data: {json.dumps({'type': 'documents_found', 'count': doc_count})}\n\n"
                        
                        # If we have a summary, proceed even if doc_outputs is empty (documents were already processed)
                        if not doc_outputs and not full_summary:
                            yield f"data: {json.dumps({'type': 'error', 'message': 'No relevant documents found'})}\n\n"
                            return
                        
                        logger.info(f"🟡 [STREAM] Using existing summary from summarize_results node ({len(full_summary)} chars)")
                        
                        # Check if summary was already streamed immediately from summarize_results
                        if summary_already_streamed:
                            logger.info("🟡 [STREAM] Summary already streamed immediately - skipping duplicate streaming")
                        else:
                            # Stream the existing summary token by token (simulate streaming for UX)
                            logger.info("🟡 [STREAM] Streaming existing summary (no redundant LLM call)")
                            # Emit "Summarising content" only when we actually start streaming (so UI shows it as the step happening now, not for the whole LLM call)
                            summarizing_data = {
                                'type': 'reasoning_step',
                                'step': 'summarizing_content',
                                'action_type': 'analysing',
                                'message': 'Summarising content',
                                'timestamp': time.time(),
                                'details': {}
                            }
                            yield f"data: {json.dumps(summarizing_data)}\n\n"
                            logger.info("✨ [STREAM] Emitted 'Summarising content' reasoning step (at stream start)")
                            yield f"data: {json.dumps({'type': 'status', 'message': 'Streaming response...'})}\n\n"
                            
                            # Stream the final response text directly - preserve all formatting
                            # Stream character-by-character in chunks to maintain exact formatting (markdown, newlines, spaces)
                            logger.info("🟡 [STREAM] Streaming final response directly (preserving formatting)")
                            
                            # Stream in chunks to maintain formatting while still providing smooth streaming
                            for i in range(0, len(full_summary), STREAM_CHUNK_SIZE):
                                if i == 0:
                                    logger.info("🟡 [STREAM] First chunk streamed from existing summary")
                                chunk = full_summary[i:i + STREAM_CHUNK_SIZE]
                                yield f"data: {json.dumps({'type': 'token', 'token': chunk})}\n\n"
                                if STREAM_CHUNK_DELAY_MS > 0:
                                    time.sleep(STREAM_CHUNK_DELAY_MS / 1000.0)
                        
                        # Build citations_map_for_frontend to match the SOURCE of the displayed answer.
                        # Conflict fix: citation numbers (¹²³) in the text must map to the same pipeline
                        # that produced that text. Prefer processed_citations only when we streamed from
                        # summarize_results; otherwise the displayed text is from responder → use chunk_citations.
                        processed_citations = final_result.get('processed_citations', {})
                        chunk_citations_list = final_result.get('chunk_citations', [])
                        citations_map_for_frontend = {}
                        structured_citations = []
                        
                        use_processed = (
                            summary_already_streamed
                            and processed_citations
                        )
                        if use_processed:
                            logger.info(
                                f"🟢 [CITATIONS] Using block ID citations ({len(processed_citations)} citations) "
                                f"(answer streamed from summarize_results)"
                            )
                            # Convert processed citations from block IDs to frontend format
                            for citation_num, citation_data in processed_citations.items():
                                bbox = citation_data.get('bbox', {})
                                page = citation_data.get('page', 0)
                                doc_id = citation_data.get('doc_id', '')
                                block_id = citation_data.get('block_id', 'UNKNOWN')
                                cited_text = citation_data.get('cited_text', '')[:60] if citation_data.get('cited_text') else 'N/A'
                                
                                # Log citation details for debugging
                                bbox_str = f"{bbox.get('left', 0):.3f},{bbox.get('top', 0):.3f},{bbox.get('width', 0):.3f}x{bbox.get('height', 0):.3f}" if bbox else "N/A"
                                logger.info(
                                    f"🟢 [CITATIONS] Citation {citation_num} (FINAL): block_id={block_id}, "
                                    f"doc={doc_id[:8] if doc_id else 'UNKNOWN'}, page={page}, bbox={bbox_str}, "
                                    f"cited_text='{cited_text}...'"
                                )
                                
                                # Validate BBOX coordinates
                                if bbox:
                                    bbox_left = bbox.get('left', 0)
                                    bbox_top = bbox.get('top', 0)
                                    bbox_width = bbox.get('width', 0)
                                    bbox_height = bbox.get('height', 0)
                                    
                                    # Check for fallback BBOX
                                    is_fallback = (
                                        bbox_left == 0.0 and bbox_top == 0.0 and
                                        bbox_width == 1.0 and bbox_height == 1.0
                                    )
                                    if is_fallback:
                                        logger.warning(
                                            f"⚠️ [CITATIONS] Citation {citation_num} (block_id: {block_id}) "
                                            f"uses fallback BBOX (0,0,1,1) - coordinates may be inaccurate"
                                        )
                                    
                                    # Check for invalid dimensions
                                    if bbox_width <= 0 or bbox_height <= 0:
                                        logger.warning(
                                            f"⚠️ [CITATIONS] Citation {citation_num} (block_id: {block_id}) "
                                            f"has invalid BBOX dimensions: {bbox_width}x{bbox_height}"
                                        )
                                
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
                                    'document_id': doc_id,  # Frontend download/panel may expect document_id
                                    'page': page,
                                    'bbox': bbox,
                                    'method': citation_data.get('method', 'block-id-lookup'),
                                    'block_id': block_id,  # Include block_id for debugging
                                    'cited_text': citation_data.get('cited_text', ''),  # Include for sub-level bbox
                                    'original_filename': citation_data.get('original_filename', '')  # Jan28th: for display
                                }
                        elif chunk_citations_list:
                            # Answer is from responder; citation numbers in text match chunk_citations
                            logger.info(f"🟢 [CITATIONS] Using chunk_citations from responder_node ({len(chunk_citations_list)} citations)")
                            
                            # OPTIMIZATION: Batch filename lookups - collect unique doc_ids that need filenames
                            doc_ids_needing_filenames = set()
                            citation_doc_id_map = {}  # Map citation_num to doc_id for filename lookup
                            
                            for cit in chunk_citations_list:
                                citation_num = str(cit.get('citation_number', 1))
                                doc_id = cit.get('doc_id', '')
                                original_filename = cit.get('original_filename')
                                
                                # Track citations that need filename lookup
                                if doc_id and not original_filename:
                                    doc_ids_needing_filenames.add(doc_id)
                                    if citation_num not in citation_doc_id_map:
                                        citation_doc_id_map[citation_num] = doc_id
                            
                            # Batch fetch all missing filenames in one query
                            filename_map = {}
                            if doc_ids_needing_filenames:
                                try:
                                    supabase = get_supabase_client()
                                    # Fetch all filenames in one query using .in() filter
                                    doc_result = supabase.table('documents')\
                                        .select('id, original_filename')\
                                        .in_('id', list(doc_ids_needing_filenames))\
                                        .execute()
                                    
                                    # Build map of doc_id -> filename
                                    for doc in (doc_result.data or []):
                                        doc_id = doc.get('id')
                                        filename = doc.get('original_filename', 'document.pdf')
                                        if doc_id:
                                            filename_map[doc_id] = filename
                                    
                                    logger.info(f"🟢 [CITATIONS] Batch fetched {len(filename_map)} filenames for {len(doc_ids_needing_filenames)} unique documents")
                                except Exception as e:
                                    logger.warning(f"⚠️ [CITATIONS] Failed to batch fetch filenames: {e}")
                            
                            # Process citations with batched filenames
                            for cit in chunk_citations_list:
                                citation_num = str(cit.get('citation_number', 1))
                                doc_id = cit.get('doc_id', '')
                                page = cit.get('page_number', 0)
                                bbox = cit.get('bbox', {})
                                chunk_id = cit.get('chunk_id', '')
                                block_index = cit.get('block_index')
                                cited_text = cit.get('cited_text', '')[:60] if cit.get('cited_text') else 'N/A'
                                
                                # Get original_filename from citation, batch lookup, or fallback
                                original_filename = cit.get('original_filename')
                                if not original_filename and doc_id:
                                    # Use batched filename lookup result
                                    original_filename = filename_map.get(doc_id, 'document.pdf')
                                elif not original_filename:
                                    original_filename = 'document.pdf'
                                
                                # Log citation details for debugging
                                bbox_str = f"{bbox.get('left', 0):.3f},{bbox.get('top', 0):.3f},{bbox.get('width', 0):.3f}x{bbox.get('height', 0):.3f}" if bbox else "N/A"
                                logger.info(
                                    f"🟢 [CITATIONS] Citation {citation_num} (chunk-id): chunk_id={chunk_id[:20] if chunk_id else 'UNKNOWN'}..., "
                                    f"block_index={block_index}, doc={doc_id[:8] if doc_id else 'UNKNOWN'}, page={page}, bbox={bbox_str}, "
                                    f"filename={original_filename}, cited_text='{cited_text}...'"
                                )
                                
                                # Validate BBOX coordinates
                                if bbox:
                                    bbox_left = bbox.get('left', 0)
                                    bbox_top = bbox.get('top', 0)
                                    bbox_width = bbox.get('width', 0)
                                    bbox_height = bbox.get('height', 0)
                                    
                                    # Check for fallback BBOX
                                    is_fallback = (
                                        bbox_left == 0.0 and bbox_top == 0.0 and
                                        bbox_width == 1.0 and bbox_height == 1.0
                                    )
                                    if is_fallback:
                                        logger.warning(
                                            f"⚠️ [CITATIONS] Citation {citation_num} (chunk_id: {chunk_id[:20] if chunk_id else 'UNKNOWN'}...) "
                                            f"uses fallback BBOX (0,0,1,1) - coordinates may be inaccurate"
                                        )
                                    
                                    # Check for invalid dimensions
                                    if bbox_width <= 0 or bbox_height <= 0:
                                        logger.warning(
                                            f"⚠️ [CITATIONS] Citation {citation_num} (chunk_id: {chunk_id[:20] if chunk_id else 'UNKNOWN'}...) "
                                            f"has invalid BBOX dimensions: {bbox_width}x{bbox_height}"
                                        )
                                
                                # Build structured citation for array format
                                structured_citations.append({
                                    'id': int(citation_num),
                                    'document_id': doc_id,
                                    'page': page,
                                    'bbox': bbox
                                })
                                
                                # Citation mapping fix: include block_id in response for frontend mapping/highlighting
                                block_id = cit.get('block_id')
                                if not block_id and (chunk_id or block_index is not None):
                                    block_id = f"chunk_{chunk_id or 'unknown'}_block_{block_index if block_index is not None else 0}"
                                # Build citation map entry for frontend
                                citations_map_for_frontend[citation_num] = {
                                    'doc_id': doc_id,
                                    'document_id': doc_id,  # Frontend download/panel may expect document_id
                                    'original_filename': original_filename,  # NEW: Include filename for frontend
                                    'page': page,
                                    'bbox': bbox,
                                    'method': cit.get('method', 'chunk-id-lookup'),
                                    'block_id': block_id,  # Include block_id for citation mapping (frontend)
                                    'chunk_id': chunk_id,  # Include chunk_id for debugging
                                    'block_index': block_index,  # Include block_index for debugging
                                    'cited_text': cit.get('cited_text', '')  # Include for smart citation selection
                                }
                        else:
                            # FALLBACK: Check for citations list format (used by citation_query handler or direct citations)
                            citations_list = final_result.get('citations', [])
                            if citations_list:
                                logger.info(f"🟢 [CITATIONS] Using citations list ({len(citations_list)} citations) - likely from citation_query or direct citations")
                                
                                # OPTIMIZATION: Batch filename lookups for direct citations
                                doc_ids_needing_filenames = set()
                                citation_doc_id_map = {}
                                
                                for cit in citations_list:
                                    citation_num = str(cit.get('citation_number', 1))
                                    doc_id = cit.get('doc_id', '')
                                    original_filename = cit.get('original_filename')
                                    
                                    # Track citations that need filename lookup
                                    if doc_id and not original_filename:
                                        doc_ids_needing_filenames.add(doc_id)
                                        if citation_num not in citation_doc_id_map:
                                            citation_doc_id_map[citation_num] = doc_id
                                
                                # Batch filename lookup
                                filename_cache = {}
                                if doc_ids_needing_filenames:
                                    try:
                                        from backend.services.supabase_client_factory import get_supabase_client
                                        supabase = get_supabase_client()
                                        filename_response = supabase.table('documents').select(
                                            'id, original_filename'
                                        ).in_('id', list(doc_ids_needing_filenames)).execute()
                                        
                                        for doc in filename_response.data or []:
                                            filename_cache[doc['id']] = doc.get('original_filename', 'unknown')
                                    except Exception as e:
                                        logger.warning(f"🟡 [CITATIONS] Failed to batch lookup filenames: {e}")
                                
                                # Process citations with filenames
                                for cit in citations_list:
                                    citation_num = str(cit.get('citation_number', 1))
                                    doc_id = cit.get('doc_id', '')
                                    page = cit.get('page_number', 0)
                                    bbox = cit.get('bbox', {})
                                    
                                    # Get original_filename from citation, cache, or fallback
                                    original_filename = cit.get('original_filename')
                                    if not original_filename and doc_id in filename_cache:
                                        original_filename = filename_cache[doc_id]
                                    if not original_filename:
                                        original_filename = 'unknown'
                                    
                                    citations_map_for_frontend[citation_num] = {
                                        'doc_id': doc_id,
                                        'document_id': doc_id,  # Frontend download/panel may expect document_id
                                        'original_filename': original_filename,  # Include filename for frontend
                                        'page': page,
                                        'bbox': bbox,
                                        'method': cit.get('method', 'direct-id-extraction'),
                                        'block_id': cit.get('block_id', ''),  # Include block_id for citation mapping (frontend)
                                        'chunk_id': cit.get('chunk_id', ''),
                                        'cited_text': cit.get('cited_text', '')
                                    }
                                    structured_citations.append({
                                        'id': int(citation_num),
                                        'document_id': doc_id,
                                        'page': page,
                                        'bbox': bbox
                                    })
                                    logger.info(f"🟢 [CITATIONS] Citation {citation_num}: doc={doc_id[:8] if doc_id else 'UNKNOWN'}, page={page}, filename={original_filename}")
                            else:
                                logger.info("🟡 [CITATIONS] No citations found (checked processed_citations, chunk_citations, and citations) - citations will be empty")
                                
                        # Only keep citations that actually appear in the response text (sources = documents cited in answer)
                        cited_nums = _citation_numbers_in_response(full_summary)
                        if citations_map_for_frontend:
                            before_count = len(citations_map_for_frontend)
                            citations_map_for_frontend = {k: v for k, v in citations_map_for_frontend.items() if k in cited_nums}
                            structured_citations = [c for c in structured_citations if str(c.get("id")) in cited_nums]
                            if before_count != len(citations_map_for_frontend):
                                logger.info(f"🟡 [CITATIONS] Filtered to citations used in response: {before_count} -> {len(citations_map_for_frontend)} (cited numbers: {sorted(cited_nums)})")
                        
                        logger.info(f"🟡 [CITATIONS] Final citation count: {len(structured_citations)} structured, {len(citations_map_for_frontend)} map entries")
                        
                        timing.mark("prepare_complete")
                        
                        # AGENT-NATIVE (TOOL-BASED): Process LLM tool-called agent actions
                        # The LLM autonomously decides when to call open_document, navigate_to_property, etc.
                        # based on query context and available citations
                        agent_actions = final_result.get('agent_actions', [])
                        
                        # DEBUG: Log agent_actions and is_agent_mode
                        logger.info(f"🎯 [AGENT_DEBUG] agent_actions from final_result: {agent_actions}")
                        logger.info(f"🎯 [AGENT_DEBUG] is_agent_mode: {is_agent_mode}")
                        logger.info(f"🎯 [AGENT_DEBUG] final_result keys: {list(final_result.keys()) if final_result else 'None'}")
                        
                        if agent_actions and is_agent_mode:
                            logger.info(f"🎯 [AGENT_TOOLS] Processing {len(agent_actions)} LLM-requested agent actions")
                            
                            for action in agent_actions:
                                action_type = action.get('action')
                                
                                if action_type == 'open_document':
                                    # LLM requested to open a specific citation
                                    llm_citation_number = action.get('citation_number')
                                    reason = action.get('reason', '')
                                    
                                    # Use SINGLE SOURCE OF TRUTH for citation selection
                                    # This ensures the best citation is selected based on user intent
                                    preferred_key = str(llm_citation_number) if llm_citation_number else None
                                    citation_key, citation = select_best_citation_for_query(
                                        query, 
                                        citations_map_for_frontend, 
                                        preferred_key
                                    )
                                    
                                    if citation_key and citation:
                                        citation_number = int(citation_key)
                                        citation_page = citation.get('page', 1)
                                        bbox = citation.get('bbox')
                                        
                                        # Ensure bbox page matches citation page
                                        if bbox and isinstance(bbox, dict):
                                            bbox = bbox.copy()
                                            bbox['page'] = citation_page
                                        
                                        # Emit reasoning step
                                        opening_step = {
                                            'type': 'reasoning_step',
                                            'step': 'agent_open_document',
                                            'action_type': 'opening',
                                            'message': 'Opening citation view & Highlighting content',
                                            'details': {'citation_number': citation_number, 'reason': reason}
                                        }
                                        yield f"data: {json.dumps(opening_step)}\n\n"
                                        
                                        # Emit open_document action
                                        open_doc_action = {
                                            'type': 'agent_action',
                                            'action': 'open_document',
                                            'params': {
                                                'doc_id': citation.get('doc_id'),
                                                'page': citation_page,
                                                'filename': citation.get('original_filename', ''),
                                                'bbox': bbox if bbox and isinstance(bbox, dict) else None,
                                                'reason': reason
                                            }
                                        }
                                        yield f"data: {json.dumps(open_doc_action)}\n\n"
                                        logger.info(f"🎯 [AGENT_TOOLS] Emitted open_document for citation [{citation_number}]: {reason}")
                                    else:
                                        logger.warning(f"🎯 [AGENT_TOOLS] No citations available to open")
                                
                                elif action_type == 'navigate_to_property':
                                    # LLM requested to navigate to a property
                                    target_property_id = action.get('property_id') or property_id
                                    reason = action.get('reason', '')
                                    
                                    if target_property_id:
                                        # Emit reasoning step for navigation
                                        nav_step = {
                                            'type': 'reasoning_step',
                                            'step': 'agent_navigate',
                                            'action_type': 'navigating',
                                            'message': 'Navigating to property',
                                            'details': {'property_id': target_property_id, 'reason': reason}
                                        }
                                        yield f"data: {json.dumps(nav_step)}\n\n"
                                        
                                        nav_action = {
                                            'type': 'agent_action',
                                            'action': 'navigate_to_property',
                                            'params': {
                                                'property_id': target_property_id,
                                                'center_map': True,
                                                'reason': reason
                                            }
                                        }
                                        yield f"data: {json.dumps(nav_action)}\n\n"
                                        logger.info(f"🎯 [AGENT_TOOLS] Emitted navigate_to_property: {reason}")
                                
                                elif action_type == 'search_property':
                                    # LLM requested to search for a property by name
                                    search_query = action.get('query', '')
                                    
                                    if search_query:
                                        # Emit reasoning step for search
                                        search_step = {
                                            'type': 'reasoning_step',
                                            'step': 'agent_search_property',
                                            'action_type': 'searching',
                                            'message': f'Searching for property: {search_query}',
                                            'details': {'query': search_query}
                                        }
                                        yield f"data: {json.dumps(search_step)}\n\n"
                                        
                                        # Perform property search
                                        from backend.services.property_search_service import PropertySearchService
                                        property_service = PropertySearchService()
                                        search_results = property_service.search_properties(
                                            business_id=business_id or '',
                                            query=search_query
                                        )
                                        
                                        if search_results:
                                            found_property = search_results[0]  # Take top result
                                            found_property_id = found_property.get('id') or found_property.get('property_id')
                                            found_address = found_property.get('formatted_address', 'Unknown')
                                            found_lat = found_property.get('latitude')
                                            found_lng = found_property.get('longitude')
                                            
                                            search_action = {
                                                'type': 'agent_action',
                                                'action': 'search_property_result',
                                                'params': {
                                                    'property_id': found_property_id,
                                                    'formatted_address': found_address,
                                                    'latitude': found_lat,
                                                    'longitude': found_lng,
                                                    'query': search_query
                                                }
                                            }
                                            yield f"data: {json.dumps(search_action)}\n\n"
                                            logger.info(f"🎯 [AGENT_TOOLS] Property search found: {found_address} ({found_property_id})")
                                        else:
                                            logger.warning(f"🎯 [AGENT_TOOLS] No property found for query: {search_query}")
                                
                                elif action_type == 'show_map_view':
                                    # LLM requested to show the map view
                                    reason = action.get('reason', 'Opening map view')
                                    
                                    # Emit reasoning step for opening map
                                    map_step = {
                                        'type': 'reasoning_step',
                                        'step': 'agent_show_map',
                                        'action_type': 'opening_map',
                                        'message': 'Opening map view',
                                        'details': {'reason': reason}
                                    }
                                    yield f"data: {json.dumps(map_step)}\n\n"
                                    
                                    show_map_action = {
                                        'type': 'agent_action',
                                        'action': 'show_map_view',
                                        'params': {
                                            'reason': reason
                                        }
                                    }
                                    yield f"data: {json.dumps(show_map_action)}\n\n"
                                    logger.info(f"🎯 [AGENT_TOOLS] Emitted show_map_view: {reason}")
                                
                                elif action_type == 'select_property_pin':
                                    # LLM requested to select a property pin on the map
                                    target_property_id = action.get('property_id')
                                    reason = action.get('reason', '')
                                    
                                    if target_property_id:
                                        # Emit reasoning step for pin selection
                                        pin_step = {
                                            'type': 'reasoning_step',
                                            'step': 'agent_select_pin',
                                            'action_type': 'selecting_pin',
                                            'message': 'Selecting property pin',
                                            'details': {'property_id': target_property_id, 'reason': reason}
                                        }
                                        yield f"data: {json.dumps(pin_step)}\n\n"
                                        
                                        # Get property coordinates if available
                                        property_lat = None
                                        property_lng = None
                                        property_address = None
                                        
                                        # Try to get property details for coordinates
                                        try:
                                            from backend.services.property_search_service import PropertySearchService
                                            property_service = PropertySearchService()
                                            # Search by property_id
                                            search_results = property_service.search_properties(
                                                business_id=business_id or '',
                                                query=target_property_id
                                            )
                                            if search_results:
                                                prop = search_results[0]
                                                property_lat = prop.get('latitude')
                                                property_lng = prop.get('longitude')
                                                property_address = prop.get('formatted_address')
                                        except Exception as e:
                                            logger.warning(f"🎯 [AGENT_TOOLS] Could not fetch property details: {e}")
                                        
                                        select_pin_action = {
                                            'type': 'agent_action',
                                            'action': 'select_property_pin',
                                            'params': {
                                                'property_id': target_property_id,
                                                'latitude': property_lat,
                                                'longitude': property_lng,
                                                'address': property_address,
                                                'reason': reason
                                            }
                                        }
                                        yield f"data: {json.dumps(select_pin_action)}\n\n"
                                        logger.info(f"🎯 [AGENT_TOOLS] Emitted select_property_pin: {target_property_id}")
                                
                                elif action_type == 'navigate_to_property_by_name':
                                    # Combined navigation tool: search + show map + select pin
                                    property_name = action.get('property_name', '')
                                    reason = action.get('reason', '')
                                    
                                    if property_name:
                                        logger.info(f"🎯 [AGENT_TOOLS] navigate_to_property_by_name: searching for '{property_name}'")
                                        
                                        # Step 1: Search for the property
                                        from backend.services.property_search_service import PropertySearchService
                                        property_service = PropertySearchService()
                                        search_results = property_service.search_properties(
                                            business_id=business_id or '',
                                            query=property_name
                                        )
                                        
                                        if search_results:
                                            found_property = search_results[0]
                                            found_property_id = found_property.get('id') or found_property.get('property_id')
                                            found_address = found_property.get('formatted_address', property_name)
                                            found_lat = found_property.get('latitude')
                                            found_lng = found_property.get('longitude')
                                            
                                            logger.info(f"🎯 [AGENT_TOOLS] Found property: {found_address} (ID: {found_property_id})")
                                            
                                            # Emit combined reasoning step
                                            nav_step = {
                                                'type': 'reasoning_step',
                                                'step': 'agent_navigate_to_property',
                                                'action_type': 'navigating',
                                                'message': f'Navigating to {found_address}',
                                                'details': {'property_name': property_name, 'property_id': found_property_id, 'reason': reason}
                                            }
                                            yield f"data: {json.dumps(nav_step)}\n\n"
                                            
                                            # Step 2: Emit show_map_view action
                                            show_map_action = {
                                                'type': 'agent_action',
                                                'action': 'show_map_view',
                                                'params': {
                                                    'reason': f'Opening map to navigate to {found_address}'
                                                }
                                            }
                                            yield f"data: {json.dumps(show_map_action)}\n\n"
                                            logger.info(f"🎯 [AGENT_TOOLS] Emitted show_map_view for navigation")
                                            
                                            # Step 3: Emit select_property_pin action
                                            select_pin_action = {
                                                'type': 'agent_action',
                                                'action': 'select_property_pin',
                                                'params': {
                                                    'property_id': found_property_id,
                                                    'latitude': found_lat,
                                                    'longitude': found_lng,
                                                    'address': found_address,
                                                    'reason': reason
                                                }
                                            }
                                            yield f"data: {json.dumps(select_pin_action)}\n\n"
                                            logger.info(f"🎯 [AGENT_TOOLS] Emitted select_property_pin: {found_property_id}")
                                        else:
                                            logger.warning(f"🎯 [AGENT_TOOLS] No property found for: '{property_name}'")
                        
                        # AUTOMATIC CITATION OPENING: DISABLED
                        # Citations should be clickable by the user, not automatically opened
                        # Users can click on citation numbers [1], [2], etc. in the response to open them
                        # has_open_doc = any(a.get('action') == 'open_document' for a in (agent_actions or []))
                        # if is_agent_mode and citations_map_for_frontend and not has_open_doc:
                        #     logger.info(f"🎯 [AUTO_OPEN] Citations present but no open_document action - automatically opening")
                        #     ... (auto-open logic disabled - citations are clickable instead)
                        
                        # Send complete message with metadata (include streamed title for persistence)
                        complete_data = {
                            'type': 'complete',
                            'data': {
                                'summary': full_summary.strip(),
                                'relevant_documents': relevant_docs,
                                'document_outputs': doc_outputs,
                                'citations': citations_map_for_frontend,  # Frontend expects Record<string, CitationDataType>
                                'citations_array': structured_citations,  # NEW: Structured array format (for future use)
                                'session_id': session_id,
                                'title': streamed_chat_title  # Streamed earlier as title_chunk; include for persistence
                            }
                        }
                        yield f"data: {json.dumps(complete_data)}\n\n"
                        timing.mark("complete_sent")
                        logger.info("🟣 [PERF][STREAM] %s", json.dumps({
                            "endpoint": "/api/llm/query/stream",
                            "session_id": session_id,
                            "doc_ids_count": len(document_ids) if document_ids else 0,
                            "timing": timing.to_ms()
                        }))
                    
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
                # Signal for stream thread to stop when client disconnects (e.g. pause/stop)
                client_disconnected = threading.Event()
                
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
                            except asyncio.CancelledError:
                                logger.info("🔴 [STREAM] consume_async_gen cancelled (client disconnected)")
                                raise
                            except Exception as e:
                                logger.error(f"🟠 [STREAM] Error in consume_async_gen: {e}", exc_info=True)
                                error_occurred.set()
                                error_message[0] = str(e)
                                chunk_queue.put(f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n")
                        
                        async def watch_client_disconnect():
                            """Exit when client disconnects so we can cancel the consumer."""
                            while not client_disconnected.is_set():
                                await asyncio.sleep(0.3)
                            logger.info("🔴 [STREAM] Client disconnected - cancelling backend retrieval/stream")
                        
                        async def run_with_cancellation():
                            consume_task = new_loop.create_task(consume_async_gen())
                            watch_task = new_loop.create_task(watch_client_disconnect())
                            done, pending = await asyncio.wait(
                                [consume_task, watch_task],
                                return_when=asyncio.FIRST_COMPLETED
                            )
                            if watch_task in done:
                                consume_task.cancel()
                                try:
                                    await consume_task
                                except asyncio.CancelledError:
                                    pass
                            else:
                                watch_task.cancel()
                                try:
                                    await watch_task
                                except asyncio.CancelledError:
                                    pass
                        
                        try:
                            new_loop.run_until_complete(run_with_cancellation())
                        finally:
                            # Cleanup: Let pending tasks (e.g. Mem0 memory storage) finish, then cancel any left
                            try:
                                pending = [t for t in asyncio.all_tasks(new_loop) if not t.done()]
                                if pending:
                                    # Give tasks time to complete (e.g. Mem0 add runs as create_task)
                                    try:
                                        new_loop.run_until_complete(
                                            asyncio.wait_for(
                                                asyncio.gather(*pending, return_exceptions=True),
                                                timeout=3.0
                                            )
                                        )
                                    except asyncio.TimeoutError:
                                        # After 3s, cancel any still pending
                                        for task in pending:
                                            if not task.done():
                                                task.cancel()
                                        new_loop.run_until_complete(
                                            asyncio.gather(*pending, return_exceptions=True)
                                        )
                                    except Exception:
                                        pass
                            except Exception:
                                pass
                            
                            # Close the event loop
                            try:
                                new_loop.close()
                            except Exception:
                                # Ignore close errors
                                pass
                            
                            logger.info("🟠 [STREAM] Event loop completed and cleaned up")
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
                    except (BrokenPipeError, ConnectionResetError):
                        # Client disconnected (e.g., pause, stop, navigated away)
                        # Signal stream thread to cancel so backend retrieval/LLM stop
                        client_disconnected.set()
                        logger.info("🔴 [STREAM] Client disconnected (broken pipe), stopping stream")
                        break
                    except queue.Empty:
                        # Timeout - check if thread is still alive
                        if not thread.is_alive():
                            if error_occurred.is_set():
                                try:
                                    yield f"data: {json.dumps({'type': 'error', 'message': error_message[0] or 'Unknown error'})}\n\n"
                                except (BrokenPipeError, ConnectionResetError):
                                    logger.info("🔴 [STREAM] Client disconnected while sending error")
                            break
                        continue
                    except Exception as queue_err:
                        # Other queue errors - check thread status
                        logger.warning(f"⚠️ [STREAM] Queue error: {queue_err}")
                        if not thread.is_alive():
                            break
                        continue
                        
            except (BrokenPipeError, ConnectionResetError):
                # Client disconnected at outer level - signal stream thread to stop
                try:
                    client_disconnected.set()
                except NameError:
                    pass  # client_disconnected not in scope (e.g. error before thread setup)
                logger.info("🔴 [STREAM] Client disconnected (broken pipe), stream ended")
            except Exception as e:
                # Handle any errors in the main generate_stream logic
                logger.error(f"❌ [STREAM] Error in generate_stream: {e}")
                import traceback
                logger.error(f"❌ [STREAM] Traceback: {traceback.format_exc()}")
                try:
                    yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
                except (BrokenPipeError, ConnectionResetError):
                    logger.info("🔴 [STREAM] Client disconnected while sending error")
        
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

@views.route('/api/llm/sessions/<session_id>', methods=['DELETE', 'OPTIONS'])
@login_required
def delete_session(session_id):
    """
    Delete all checkpoint data for a session.
    
    This allows users to:
    - Start fresh conversations (clear polluted history)
    - Clean up old/abandoned sessions
    - Free up database space
    
    Args:
        session_id: Session ID from frontend chat history (e.g., "chat-1234567890-xyz")
    
    Returns:
        JSON response with success status and deleted thread_id
    
    Example:
        DELETE /api/llm/sessions/chat-1234567890-xyz
        
        Response:
        {
            "success": true,
            "message": "Session deleted successfully",
            "thread_id": "user_1_biz_abc123_sess_chat-1234567890-xyz",
            "deleted_checkpoints": 5
        }
    """
    # Handle OPTIONS preflight request
    if request.method == 'OPTIONS':
        response = jsonify({'status': 'ok'})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'DELETE, OPTIONS')
        return response, 200
    
    try:
        logger.info(f"🗑️ [SESSION_DELETE] ========== DELETE SESSION REQUEST ==========")
        logger.info(f"🗑️ [SESSION_DELETE] Session ID from frontend: {session_id}")
        logger.info(f"🗑️ [SESSION_DELETE] User ID: {current_user.id}")
        
        # Build thread_id from session components
        business_id = _ensure_business_uuid()
        logger.info(f"🗑️ [SESSION_DELETE] Business ID: {business_id}")
        
        thread_id = session_manager.build_thread_id_for_session(
            user_id=current_user.id,
            business_id=business_id or "no_business",
            session_id=session_id
        )
        
        logger.info(f"🗑️ [SESSION_DELETE] Built thread_id: {thread_id}")
        logger.info(f"🗑️ [SESSION_DELETE] Starting deletion process...")
        
        # Delete from checkpoints tables using Supabase
        supabase = get_supabase_client()
        logger.info(f"🗑️ [SESSION_DELETE] Supabase client obtained")
        
        # Count checkpoints before deletion (for response)
        logger.info(f"🗑️ [SESSION_DELETE] Counting checkpoints...")
        checkpoints_count = supabase.table('checkpoints')\
            .select('id', count='exact')\
            .eq('thread_id', thread_id)\
            .execute()
        
        num_checkpoints = checkpoints_count.count if hasattr(checkpoints_count, 'count') else 0
        logger.info(f"🗑️ [SESSION_DELETE] Found {num_checkpoints} checkpoints to delete")
        
        # Delete checkpoints
        logger.info(f"🗑️ [SESSION_DELETE] Deleting checkpoints...")
        checkpoints_result = supabase.table('checkpoints')\
            .delete()\
            .eq('thread_id', thread_id)\
            .execute()
        logger.info(f"🗑️ [SESSION_DELETE] Checkpoints deleted: {len(checkpoints_result.data) if checkpoints_result.data else 0} rows")
        
        # Delete checkpoint writes
        logger.info(f"🗑️ [SESSION_DELETE] Deleting checkpoint_writes...")
        writes_result = supabase.table('checkpoint_writes')\
            .delete()\
            .eq('thread_id', thread_id)\
            .execute()
        logger.info(f"🗑️ [SESSION_DELETE] Checkpoint writes deleted: {len(writes_result.data) if writes_result.data else 0} rows")
        
        # Delete from chat_sessions table (if exists)
        logger.info(f"🗑️ [SESSION_DELETE] Deleting from chat_sessions table...")
        try:
            chat_sessions_result = supabase.table('chat_sessions')\
                .delete()\
                .eq('id', session_id)\
                .eq('user_id', current_user.id)\
                .execute()
            logger.info(f"🗑️ [SESSION_DELETE] Chat sessions deleted: {len(chat_sessions_result.data) if chat_sessions_result.data else 0} rows")
        except Exception as chat_session_error:
            # Non-fatal - checkpoints are more important
            logger.warning(f"🗑️ [SESSION_DELETE] Could not delete from chat_sessions: {chat_session_error}")
        
        logger.info(f"🗑️ [SESSION_DELETE] ✅ ========== DELETE COMPLETE ==========")
        logger.info(f"🗑️ [SESSION_DELETE] Session: {session_id}")
        logger.info(f"🗑️ [SESSION_DELETE] Thread ID: {thread_id}")
        logger.info(f"🗑️ [SESSION_DELETE] Checkpoints removed: {num_checkpoints}")
        logger.info(f"🗑️ [SESSION_DELETE] ==========================================")
        
        response = jsonify({
            'success': True,
            'message': f'Session {session_id} deleted successfully',
            'thread_id': thread_id,
            'deleted_checkpoints': num_checkpoints
        })
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 200
        
    except Exception as e:
        logger.error(f"[SESSION_DELETE] ❌ Error deleting session {session_id}: {e}", exc_info=True)
        response = jsonify({
            'success': False,
            'error': str(e)
        })
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 500

@views.route('/api/llm/sessions', methods=['POST', 'OPTIONS'])
@login_required
def create_session():
    """
    Create a new chat session record in chat_sessions table.
    
    This creates metadata for tracking conversations, including:
    - Session name/title
    - Message count
    - Creation and last message timestamps
    - Links to checkpointer thread_id
    
    Request body:
        - session_name: Optional name for the session (default: "New Chat")
        - session_id: Optional frontend session ID (will be auto-generated if not provided)
    
    Returns:
        JSON response with created session record
    """
    # Handle OPTIONS preflight
    if request.method == 'OPTIONS':
        response = jsonify({'status': 'ok'})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response, 200
    
    try:
        data = request.get_json() or {}
        session_name = data.get('session_name', 'New Chat')
        frontend_session_id = data.get('session_id')
        
        # Build thread_id
        business_id = _ensure_business_uuid()
        thread_id = session_manager.get_thread_id(
            user_id=current_user.id,
            business_id=business_id or "no_business",
            session_id=frontend_session_id
        )
        
        # Extract session_id from thread_id for consistency
        # thread_id format: "user_{user_id}_business_{business_id}_session_{session_id}"
        parts = thread_id.split('_session_')
        actual_session_id = parts[1] if len(parts) > 1 else frontend_session_id
        
        logger.info(f"[SESSION_CREATE] Creating session for user {current_user.id}: {actual_session_id}")
        
        # Create session record in Supabase
        supabase = get_supabase_client()
        
        session_data = {
            'id': actual_session_id,
            'user_id': current_user.id,
            'business_uuid': business_id or "no_business",
            'thread_id': thread_id,
            'session_name': session_name,
            'message_count': 0,
            'is_archived': False,
            'created_at': datetime.utcnow().isoformat(),
            'last_message_at': datetime.utcnow().isoformat()
        }
        
        result = supabase.table('chat_sessions').insert(session_data).execute()
        
        logger.info(f"[SESSION_CREATE] ✅ Created session {actual_session_id} in chat_sessions table")
        
        response = jsonify({
            'success': True,
            'data': result.data[0] if result.data else session_data,
            'session_id': actual_session_id,
            'thread_id': thread_id
        })
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 201
        
    except Exception as e:
        logger.error(f"[SESSION_CREATE] ❌ Error creating session: {e}", exc_info=True)
        response = jsonify({
            'success': False,
            'error': str(e)
        })
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 500

@views.route('/api/llm/sessions', methods=['GET', 'OPTIONS'])
@login_required
def list_sessions():
    """
    List all chat sessions for the current user.
    
    Query parameters:
        - include_archived: Include archived sessions (default: false)
        - limit: Max number of sessions to return (default: 50)
        - offset: Pagination offset (default: 0)
    
    Returns:
        JSON response with array of session records sorted by last_message_at (desc)
    """
    # Handle OPTIONS preflight
    if request.method == 'OPTIONS':
        response = jsonify({'status': 'ok'})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET, OPTIONS')
        return response, 200
    
    try:
        # Get query parameters
        include_archived = request.args.get('include_archived', 'false').lower() == 'true'
        limit = int(request.args.get('limit', 50))
        offset = int(request.args.get('offset', 0))
        
        logger.info(f"[SESSION_LIST] Fetching sessions for user {current_user.id} (archived: {include_archived})")
        
        # Query chat_sessions from Supabase
        supabase = get_supabase_client()
        
        query = supabase.table('chat_sessions')\
            .select('*')\
            .eq('user_id', current_user.id)\
            .order('last_message_at', desc=True)\
            .limit(limit)\
            .range(offset, offset + limit - 1)
        
        if not include_archived:
            query = query.eq('is_archived', False)
        
        result = query.execute()
        
        logger.info(f"[SESSION_LIST] ✅ Found {len(result.data)} sessions for user {current_user.id}")
        
        response = jsonify({
            'success': True,
            'data': result.data,
            'count': len(result.data),
            'limit': limit,
            'offset': offset
        })
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 200
        
    except Exception as e:
        logger.error(f"[SESSION_LIST] ❌ Error listing sessions: {e}", exc_info=True)
        response = jsonify({
            'success': False,
            'error': str(e)
        })
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 500

@views.route('/api/llm/sessions/<session_id>', methods=['GET', 'OPTIONS'])
@login_required
def get_session(session_id):
    """
    Get a specific chat session with its metadata and optionally load conversation history.
    
    Query parameters:
        - include_messages: Load conversation from checkpointer (default: false)
    
    Returns:
        JSON response with session metadata and optionally messages
    """
    # Handle OPTIONS preflight
    if request.method == 'OPTIONS':
        response = jsonify({'status': 'ok'})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET, OPTIONS')
        return response, 200
    
    try:
        include_messages = request.args.get('include_messages', 'false').lower() == 'true'
        
        logger.info(f"[SESSION_GET] Fetching session {session_id} for user {current_user.id}")
        
        # Get session from Supabase
        supabase = get_supabase_client()
        
        result = supabase.table('chat_sessions')\
            .select('*')\
            .eq('id', session_id)\
            .eq('user_id', current_user.id)\
            .execute()
        
        if not result.data or len(result.data) == 0:
            logger.warning(f"[SESSION_GET] Session {session_id} not found for user {current_user.id}")
            response = jsonify({
                'success': False,
                'error': 'Session not found or access denied'
            })
            response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            return response, 404
        
        session_data = result.data[0]
        response_data = {
            'success': True,
            'data': session_data
        }
        
        # Optionally load messages from checkpointer
        if include_messages:
            try:
                # Load conversation from checkpointer
                from backend.llm.graphs.main_graph import main_graph, checkpointer
                
                if checkpointer:
                    thread_id = session_data['thread_id']
                    config = {"configurable": {"thread_id": thread_id}}
                    
                    # Get latest checkpoint
                    checkpoint_tuple = checkpointer.get_tuple(config)
                    
                    if checkpoint_tuple and checkpoint_tuple.checkpoint:
                        channel_values = checkpoint_tuple.checkpoint.get('channel_values', {})
                        messages = channel_values.get('messages', [])
                        
                        # Convert messages to serializable format
                        serialized_messages = []
                        for msg in messages:
                            msg_dict = {
                                'type': msg.__class__.__name__,
                                'content': getattr(msg, 'content', None)
                            }
                            serialized_messages.append(msg_dict)
                        
                        response_data['messages'] = serialized_messages
                        logger.info(f"[SESSION_GET] Loaded {len(serialized_messages)} messages for session {session_id}")
                else:
                    logger.warning("[SESSION_GET] Checkpointer not available, cannot load messages")
            except Exception as msg_error:
                logger.warning(f"[SESSION_GET] Could not load messages: {msg_error}")
                response_data['messages_error'] = str(msg_error)
        
        response = jsonify(response_data)
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 200
        
    except Exception as e:
        logger.error(f"[SESSION_GET] ❌ Error getting session {session_id}: {e}", exc_info=True)
        response = jsonify({
            'success': False,
            'error': str(e)
        })
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 500

@views.route('/api/llm/sessions/<session_id>', methods=['PUT', 'OPTIONS'])
@login_required
def update_session(session_id):
    """
    Update a chat session's metadata (name, archive status, etc.).
    
    Request body (all optional):
        - session_name: New name for the session
        - is_archived: Archive/unarchive the session
        - message_count: Update message count (usually handled automatically)
    
    Returns:
        JSON response with updated session record
    """
    # Handle OPTIONS preflight
    if request.method == 'OPTIONS':
        response = jsonify({'status': 'ok'})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'PUT, OPTIONS')
        return response, 200
    
    try:
        data = request.get_json() or {}
        
        logger.info(f"[SESSION_UPDATE] Updating session {session_id} for user {current_user.id}")
        
        # Build update data
        update_data = {}
        
        if 'session_name' in data:
            update_data['session_name'] = data['session_name']
        
        if 'is_archived' in data:
            update_data['is_archived'] = data['is_archived']
        
        if 'message_count' in data:
            update_data['message_count'] = data['message_count']
        
        if not update_data:
            response = jsonify({
                'success': False,
                'error': 'No update fields provided'
            })
            response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            return response, 400
        
        # Add updated timestamp
        update_data['last_message_at'] = datetime.utcnow().isoformat()
        
        # Update session in Supabase
        supabase = get_supabase_client()
        
        result = supabase.table('chat_sessions')\
            .update(update_data)\
            .eq('id', session_id)\
            .eq('user_id', current_user.id)\
            .execute()
        
        if not result.data or len(result.data) == 0:
            logger.warning(f"[SESSION_UPDATE] Session {session_id} not found for user {current_user.id}")
            response = jsonify({
                'success': False,
                'error': 'Session not found or access denied'
            })
            response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            return response, 404
        
        logger.info(f"[SESSION_UPDATE] ✅ Updated session {session_id}")
        
        response = jsonify({
            'success': True,
            'data': result.data[0]
        })
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 200
        
    except Exception as e:
        logger.error(f"[SESSION_UPDATE] ❌ Error updating session {session_id}: {e}", exc_info=True)
        response = jsonify({
            'success': False,
            'error': str(e)
        })
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
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
    
    timing = _Timing()
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
    
    timing.mark("parsed_request")
    query = data.get('query', '')
    property_id = data.get('propertyId')  # From property attachment
    document_ids = data.get('documentIds') or data.get('document_ids', [])  # NEW: Get attached document IDs
    message_history = data.get('messageHistory', [])
    
    # NEW: Use SessionManager to generate thread_id for LangGraph checkpointer
    frontend_session_id = data.get('sessionId')
    business_id = _ensure_business_uuid()
    session_id = session_manager.get_thread_id(
        user_id=current_user.id,
        business_id=business_id or "no_business",
        session_id=frontend_session_id
    )
    
    citation_context = data.get('citationContext')  # Get structured citation metadata (hidden from user)
    response_mode = data.get('responseMode')  # NEW: Response mode for file attachments (fast/detailed/full)
    attachment_context = data.get('attachmentContext')  # NEW: Extracted text from attached files
    
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
        timing.mark("business_id")
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
        
        # When request sent no document_ids but we resolved one from property_id, pass it to the graph
        effective_document_ids = document_ids if document_ids else ([document_id] if document_id else None)
        
        # Scope resolution: when user sent document_ids but no property_id, resolve property_id from first document
        resolved_property_id = None
        if (not property_id) and effective_document_ids and len(effective_document_ids) > 0:
            try:
                supabase = get_supabase_client()
                first_doc_id = effective_document_ids[0] if isinstance(effective_document_ids[0], str) else str(effective_document_ids[0])
                rel_result = supabase.table('document_relationships')\
                    .select('property_id')\
                    .eq('document_id', first_doc_id)\
                    .limit(1)\
                    .execute()
                if rel_result.data and len(rel_result.data) > 0 and rel_result.data[0].get('property_id'):
                    resolved_property_id = rel_result.data[0]['property_id']
                    logger.info(f"Resolved property_id from document(s): {resolved_property_id}")
            except Exception as e:
                logger.warning("Could not resolve property_id from document_ids: %s", e)
        
        effective_property_id = property_id or resolved_property_id
        
        # Build initial state for LangGraph
        # Note: conversation_history will be loaded from checkpoint if thread_id exists.
        # Do NOT pass document_ids when request has none – so checkpoint keeps responder-persisted
        # document_ids from the previous turn (follow-up stays on same doc(s)).
        initial_state = {
            "user_query": query,
            "user_id": str(current_user.id) if current_user.is_authenticated else "anonymous",
            "business_id": business_id,
            "session_id": session_id,
            "property_id": effective_property_id,
            "citation_context": citation_context,
            "response_mode": response_mode if response_mode else None,
            "attachment_context": attachment_context if attachment_context else None,
        }
        # Only set document_ids when request provided them (attachment or property). Otherwise leave unset so checkpoint keeps previous turn's document_ids for follow-ups.
        if effective_document_ids is not None and (not isinstance(effective_document_ids, list) or len(effective_document_ids) > 0):
            initial_state["document_ids"] = effective_document_ids
        
        async def run_query():
            try:
                # Prefer persistent GraphRunner graph (compiled once on startup).
                # Falls back to legacy behavior if runner isn't available.
                graph = None
                checkpointer = None
                try:
                    from backend.llm.runtime.graph_runner import graph_runner
                    graph = graph_runner.get_graph()
                    checkpointer = graph_runner.get_checkpointer()
                    timing.mark("checkpointer_created")
                    timing.mark("graph_built")
                except Exception as runner_err:
                    logger.warning(f"GraphRunner unavailable, falling back to legacy per-request graph: {runner_err}")
                    from backend.llm.graphs.main_graph import build_main_graph, create_checkpointer_for_current_loop
                    logger.info("Creating checkpointer for current event loop...")
                    checkpointer = await create_checkpointer_for_current_loop()
                    timing.mark("checkpointer_created")
                    if checkpointer:
                        logger.info("Building graph with checkpointer for this event loop")
                        graph, _ = await build_main_graph(use_checkpointer=True, checkpointer_instance=checkpointer)
                    else:
                        logger.warning("Failed to create checkpointer - using stateless mode")
                        graph, _ = await build_main_graph(use_checkpointer=False)
                    timing.mark("graph_built")
                
                # Build config with metadata for LangSmith tracing
                user_id = str(current_user.id) if current_user.is_authenticated else "anonymous"
                config = {
                    "configurable": {
                        "thread_id": session_id,  # For conversation persistence via checkpointing
                        # Add metadata for LangSmith traces (user context)
                        "metadata": {
                            "user_id": user_id,
                            "business_id": str(business_id) if business_id else "unknown",
                            "query_preview": query[:100] if query else "",  # First 100 chars for context
                            "endpoint": "query"
                        }
                    }
                }
                result = await graph.ainvoke(initial_state, config)
                timing.mark("graph_done")
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
        timing.mark("response_ready")
        
        # Format response for frontend
        final_summary = result.get("final_summary", "")
        
        # --- Mem0: Schedule memory storage (non-streaming path) ---
        if final_summary:
            try:
                from backend.llm.config import config as llm_config
                if getattr(llm_config, "mem0_enabled", False):
                    from backend.services.memory_service import velora_memory
                    _ns_user_id = str(current_user.id) if current_user.is_authenticated else "anonymous"
                    import asyncio as _aio
                    _aio.run(
                        velora_memory.add(
                            messages=[
                                {"role": "user", "content": query},
                                {"role": "assistant", "content": final_summary},
                            ],
                            user_id=_ns_user_id,
                            metadata={"thread_id": str(session_id)},
                        )
                    )
                    logger.info(f"[MEMORY] Stored memories (non-streaming) for user={_ns_user_id[:8]}...")
            except Exception as mem_err:
                logger.warning(f"[MEMORY] Failed to store memories (non-streaming): {mem_err}")
        
        # Let agent handle empty responses naturally - no hard-coded fallbacks
        
        response_data = {
            "query": query,
            "summary": final_summary,
            "message": final_summary,  # Alias for compatibility
            "relevant_documents": result.get("relevant_documents", []),
            "document_outputs": result.get("document_outputs", []),
            "session_id": session_id
        }
        
        logger.info(f"LangGraph query completed: {len(result.get('relevant_documents', []))} documents found")
        
        logger.info("🟣 [PERF][QUERY] %s", json.dumps({
            "endpoint": "/api/llm/query",
            "session_id": session_id,
            "doc_ids_count": len(effective_document_ids) if effective_document_ids and isinstance(effective_document_ids, list) else 0,
            "timing": timing.to_ms()
        }))
        
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


@views.route('/api/citation/block-bbox', methods=['POST', 'OPTIONS'])
@login_required
def citation_block_bbox():
    """
    Resolve block_id (e.g. chunk_<uuid>_block_1) to block-level bbox for citation highlighting.
    Used by frontend for block1.1 logic: map citation buttons to the correct sub-block bbox.
    """
    if request.method == 'OPTIONS':
        return '', 200
    try:
        data = request.get_json() or {}
        block_id = data.get('block_id') or (request.args.get('block_id') if request.args else None)
        cited_text = data.get('cited_text') or (request.args.get('cited_text') if request.args else None)
        if not block_id:
            return jsonify({'success': False, 'error': 'block_id required'}), 400
        from backend.llm.tools.citation_mapping import resolve_block_id_to_bbox
        result = resolve_block_id_to_bbox(block_id, cited_text=cited_text)
        if not result:
            return jsonify({'success': False, 'error': 'Block not found', 'block_id': block_id}), 404
        return jsonify({'success': True, 'data': result}), 200
    except Exception as e:
        logger.exception("citation_block_bbox failed")
        return jsonify({'success': False, 'error': str(e)}), 500


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
        
        # Check for exact duplicates before uploading (safety net - frontend should catch this first)
        # Only block duplicates from the SAME user AND business
        from .services.supabase_document_service import SupabaseDocumentService
        doc_service = SupabaseDocumentService()
        supabase = doc_service.supabase
        
        existing_docs = supabase.table('documents')\
            .select('id, original_filename, file_size')\
            .eq('original_filename', filename)\
            .eq('business_uuid', business_uuid_str)\
            .eq('uploaded_by_user_id', current_user.id)\
            .execute()
        
        if existing_docs.data:
            # Check for exact duplicate (same filename and size from same user)
            file_size = file.content_length or 0
            exact_duplicate = next((doc for doc in existing_docs.data if doc.get('file_size') == file_size), None)
            
            if exact_duplicate:
                logger.warning(f"🛑 [PROXY-UPLOAD] Blocked exact duplicate: {filename} ({file_size} bytes) for user {current_user.id}")
                return jsonify({
                    'success': False,
                    'error': f'You already have a document with the same name and size: "{filename}". Please rename the file or delete your existing document first.',
                    'is_duplicate': True,
                    'existing_document_id': exact_duplicate['id']
                }), 409  # 409 Conflict
        
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
                    # Queue fast processing task (file loaded from S3 in worker - avoids blocking upload with large Celery payload)
                    task = process_document_fast_task.delay(
                        document_id=doc_id,
                        original_filename=filename,
                        business_id=str(business_uuid_str),
                        property_id=str(property_id)
                    )
                    try:
                        from .services.document_processing_tasks import set_document_processing_task_id
                        set_document_processing_task_id(str(doc_id), task.id)
                    except Exception:
                        pass
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

@views.route('/api/documents/check-duplicate', methods=['POST', 'OPTIONS'])
@login_required
def check_duplicate_document():
    """
    Check if a document with the same filename and size already exists.
    Returns information about potential duplicates.
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
    
    try:
        data = request.get_json()
        filename = data.get('filename')
        file_size = data.get('file_size')
        
        if not filename or file_size is None:
            return jsonify({'error': 'Filename and file_size are required'}), 400
        
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({'error': 'User is not associated with a business'}), 400
        
        # Check for duplicates in Supabase
        # Only check for duplicates from the SAME user AND business
        from .services.supabase_document_service import SupabaseDocumentService
        doc_service = SupabaseDocumentService()
        supabase = doc_service.supabase
        
        # Query for documents with same filename, business, AND user
        result = supabase.table('documents')\
            .select('id, original_filename, file_size, created_at')\
            .eq('original_filename', filename)\
            .eq('business_uuid', business_uuid_str)\
            .eq('uploaded_by_user_id', current_user.id)\
            .execute()
        
        if result.data and len(result.data) > 0:
            # Check if any have the same size (exact duplicate)
            exact_duplicate = next((doc for doc in result.data if doc.get('file_size') == file_size), None)
            
            if exact_duplicate:
                # Exact duplicate - same filename and size from same user
                return jsonify({
                    'is_duplicate': True,
                    'is_exact_duplicate': True,
                    'existing_document': {
                        'id': exact_duplicate['id'],
                        'filename': exact_duplicate['original_filename'],
                        'file_size': exact_duplicate['file_size'],
                        'created_at': exact_duplicate.get('created_at')
                    }
                }), 200
            else:
                # Same filename but different size - likely updated version
                return jsonify({
                    'is_duplicate': True,
                    'is_exact_duplicate': False,
                    'existing_documents': result.data,
                    'message': f'You already have a document named "{filename}" with a different file size.'
                }), 200
        
        # No duplicates found
        return jsonify({
            'is_duplicate': False
        }), 200
        
    except Exception as e:
        logger.error(f"Error checking for duplicate document: {e}", exc_info=True)
        return jsonify({'error': f'Failed to check for duplicates: {str(e)}'}), 500


@views.route('/api/documents/quick-extract', methods=['POST', 'OPTIONS'])
@login_required
def quick_extract_document():
    """
    Quick text extraction endpoint for chat file attachments.
    
    Extracts text from PDF/DOCX files without full processing pipeline.
    Used for immediate AI responses when users attach files to chat.
    
    Optionally stores file in S3 for later full processing if user chooses
    to add the document to a project.
    
    Returns:
        - success: bool
        - text: Full extracted text
        - page_texts: List of text per page
        - page_count: Number of pages
        - temp_file_id: UUID for later full processing (if store_temp=true)
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
    
    logger.info(f"🔍 [QUICK-EXTRACT] Request received from {current_user.email}")
    
    try:
        if 'file' not in request.files:
            logger.error("No 'file' key in request.files")
            return jsonify({'success': False, 'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            logger.error("Empty filename")
            return jsonify({'success': False, 'error': 'No file selected'}), 400
        
        # Read file bytes
        file_bytes = file.read()
        filename = secure_filename(file.filename)
        
        # Check if we should store temp file
        store_temp = request.form.get('store_temp', 'true').lower() == 'true'
        
        logger.info(f"🔍 [QUICK-EXTRACT] Processing {filename} ({len(file_bytes)} bytes, store_temp={store_temp})")
        
        # Import and use quick extract service
        from .services.quick_extract_service import quick_extract, store_temp_file
        
        # Extract text
        result = quick_extract(file_bytes, filename, store_temp=store_temp)
        
        if not result['success']:
            logger.error(f"❌ [QUICK-EXTRACT] Extraction failed: {result.get('error')}")
            return jsonify(result), 400
        
        # Store temp file in S3 if requested and extraction succeeded
        if store_temp and result.get('temp_file_id'):
            temp_result = store_temp_file(file_bytes, filename, result['temp_file_id'])
            if temp_result['success']:
                logger.info(f"✅ [QUICK-EXTRACT] Stored temp file: {result['temp_file_id']}")
            else:
                # Non-fatal - extraction still succeeded, just temp storage failed
                logger.warning(f"⚠️ [QUICK-EXTRACT] Temp storage failed: {temp_result.get('error')}")
                result['temp_file_id'] = None
        
        logger.info(f"✅ [QUICK-EXTRACT] Success: {result.get('page_count')} pages, {result.get('char_count')} chars")
        
        return jsonify(result), 200
        
    except Exception as e:
        logger.error(f"❌ [QUICK-EXTRACT] Error: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'error': f'Quick extraction failed: {str(e)}'
        }), 500


@views.route('/api/documents/process-temp-files', methods=['POST', 'OPTIONS'])
@login_required
def process_temp_files():
    """
    Process temp files that were uploaded via quick-extract.
    
    Links them to a property and queues full document processing pipeline.
    Used when user selects "Add to Project" after quick text extraction.
    
    Request body:
        - tempFileIds: List of temp file IDs from quick-extract
        - propertyId: Property ID to link documents to
        
    Returns:
        - success: bool
        - documentIds: List of created document IDs
        - error: Error message if failed
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
    
    logger.info(f"🔄 [PROCESS-TEMP] Request received from {current_user.email}")
    
    try:
        data = request.get_json()
        temp_file_ids = data.get('tempFileIds', [])
        property_id = data.get('propertyId')
        
        if not temp_file_ids:
            return jsonify({'success': False, 'error': 'No temp file IDs provided'}), 400
        
        if not property_id:
            return jsonify({'success': False, 'error': 'Property ID is required'}), 400
        
        logger.info(f"🔄 [PROCESS-TEMP] Processing {len(temp_file_ids)} files for property {property_id}")
        
        # Get business UUID
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({'success': False, 'error': 'User is not associated with a business'}), 400
        
        # Import required services
        from .services.quick_extract_service import get_temp_file, delete_temp_file
        from .services.supabase_document_service import SupabaseDocumentService
        from backend.tasks import process_document_fast_task
        
        doc_service = SupabaseDocumentService()
        document_ids = []
        
        for temp_file_id in temp_file_ids:
            try:
                # Get file from S3 temp storage
                file_bytes, filename = get_temp_file(temp_file_id)
                
                if not file_bytes:
                    logger.warning(f"⚠️ [PROCESS-TEMP] Temp file not found: {temp_file_id}")
                    continue
                
                # Generate S3 key for permanent storage
                s3_key = f"{current_user.company_name}/{uuid.uuid4()}/{filename}"
                
                # Upload to permanent S3 location
                import boto3
                s3_client = boto3.client('s3')
                bucket_name = os.environ.get('S3_UPLOAD_BUCKET')
                
                s3_client.put_object(
                    Bucket=bucket_name,
                    Key=s3_key,
                    Body=file_bytes,
                    ContentType='application/octet-stream'
                )
                
                # Create document record in Supabase
                file_type = filename.lower().split('.')[-1] if '.' in filename else 'unknown'
                
                document_data = {
                    'original_filename': filename,
                    'file_type': file_type,
                    'file_size': len(file_bytes),
                    's3_path': s3_key,
                    'business_id': current_user.company_name,
                    'business_uuid': business_uuid_str,
                    'created_by': current_user.email,
                    'processing_status': 'UPLOADED',
                    'property_id': property_id
                }
                
                result = doc_service.create_document(document_data)
                
                if result.get('success') and result.get('data'):
                    document_id = result['data'].get('id')
                    document_ids.append(document_id)
                    
                    # Queue full processing
                    task = process_document_fast_task.delay(
                        document_id=document_id,
                        original_filename=filename,
                        business_id=business_uuid_str,
                        property_id=property_id
                    )
                    try:
                        from .services.document_processing_tasks import set_document_processing_task_id
                        set_document_processing_task_id(str(document_id), task.id)
                    except Exception:
                        pass
                    logger.info(f"✅ [PROCESS-TEMP] Created document {document_id} and queued processing")
                    
                    # Clean up temp file
                    delete_temp_file(temp_file_id)
                else:
                    logger.error(f"❌ [PROCESS-TEMP] Failed to create document: {result.get('error')}")
                    
            except Exception as file_error:
                logger.error(f"❌ [PROCESS-TEMP] Error processing {temp_file_id}: {str(file_error)}")
                continue
        
        if document_ids:
            return jsonify({
                'success': True,
                'document_ids': document_ids,
                'message': f'Successfully queued {len(document_ids)} documents for processing'
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': 'No documents could be processed'
            }), 500
            
    except Exception as e:
        logger.error(f"❌ [PROCESS-TEMP] Error: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'error': f'Failed to process temp files: {str(e)}'
        }), 500


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
        
        # Check for exact duplicates before uploading (safety net - frontend should catch this first)
        # Only block duplicates from the SAME user AND business
        from .services.supabase_document_service import SupabaseDocumentService
        doc_service = SupabaseDocumentService()
        supabase = doc_service.supabase
        
        existing_docs = supabase.table('documents')\
            .select('id, original_filename, file_size')\
            .eq('original_filename', filename)\
            .eq('business_uuid', business_uuid_str)\
            .eq('uploaded_by_user_id', current_user.id)\
            .execute()
        
        if existing_docs.data:
            # Check for exact duplicate (same filename and size from same user)
            file_size = file.content_length or 0
            exact_duplicate = next((doc for doc in existing_docs.data if doc.get('file_size') == file_size), None)
            
            if exact_duplicate:
                logger.warning(f"🛑 [UPLOAD] Blocked exact duplicate: {filename} ({file_size} bytes) for user {current_user.id}")
                return jsonify({
                    'success': False,
                    'error': f'You already have a document with the same name and size: "{filename}". Please rename the file or delete your existing document first.',
                    'is_duplicate': True,
                    'existing_document_id': exact_duplicate['id']
                }), 409  # 409 Conflict
        
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
                # Queue full processing task (file loaded from S3 in worker - avoids blocking upload with large Celery payload)
                task = process_document_task.delay(
                    document_id=doc_id,
                    original_filename=filename,
                    business_id=str(business_uuid_str)
                )
                try:
                    from .services.document_processing_tasks import set_document_processing_task_id
                    set_document_processing_task_id(str(doc_id), task.id)
                except Exception as track_err:
                    logger.warning(f"Could not store processing task id for revoke: {track_err}")
                logger.info(f"🔄 [UPLOAD] ✅ Queued full processing task {task.id} for document {doc_id}")
                logger.info(f"   Pipeline: classification → extraction → embedding")
            except Exception as e:
                logger.error(f"❌ [UPLOAD] Failed to queue full processing task: {e}", exc_info=True)
                # Don't fail the upload - document is already created and uploaded
                # But log this as a critical error since processing won't happen
            
            # Success - document created in Supabase and full processing queued
            # Note: processing runs in a Celery worker; if no worker is running, doc stays 'uploaded'
            return jsonify({
                'success': True,
                'document_id': doc_id,
                'message': 'Document uploaded and full processing pipeline queued. Processing runs in the background (Celery worker must be running).',
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

# One-time tokens for "open in Word Online" - token -> (bucket, key, expiry_ts). Office Online needs a URL it can fetch; presigned S3 URLs often fail.
_temp_preview_tokens = {}
_TEMP_PREVIEW_TOKEN_TTL_SEC = 3600


@views.route('/api/documents/temp-preview', methods=['POST'])
@login_required
def temp_preview():
    """Simple temp upload for preview - no DB save. Returns presigned_url and open_in_word_url (proxy URL so Office Online can open the doc)."""
    file = request.files.get('file')
    if not file:
        return jsonify({'error': 'No file'}), 400

    bucket = os.environ['S3_UPLOAD_BUCKET']
    s3_key = f"temp-preview/{uuid.uuid4()}/{secure_filename(file.filename)}"
    s3_client = boto3.client('s3',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
        region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1'))

    file.seek(0)
    content_type = file.content_type or 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    s3_client.put_object(Bucket=bucket, Key=s3_key, Body=file.read(), ContentType=content_type)
    presigned_url = s3_client.generate_presigned_url('get_object', Params={'Bucket': bucket, 'Key': s3_key}, ExpiresIn=3600)

    token = uuid.uuid4().hex
    _temp_preview_tokens[token] = (bucket, s3_key, time.time() + _TEMP_PREVIEW_TOKEN_TTL_SEC)
    base = request.url_root.rstrip('/')
    open_in_word_url = f"{base}/api/documents/open-in-word?token={token}"

    return jsonify({'presigned_url': presigned_url, 'open_in_word_url': open_in_word_url}), 200


@views.route('/api/documents/docx-preview-url', methods=['POST'])
@login_required
def docx_preview_url():
    """Get a one-time Office Online viewer URL for an existing document (no download/re-upload). Faster for just-uploaded docs."""
    try:
        data = request.get_json() or {}
        document_id = data.get('document_id')
        if not document_id:
            return jsonify({'error': 'document_id required'}), 400
        from .services.supabase_document_service import SupabaseDocumentService
        doc_service = SupabaseDocumentService()
        document = doc_service.get_document_by_id(document_id)
        if not document:
            return jsonify({'error': 'Document not found'}), 404
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str or str(document.get('business_uuid')) != business_uuid_str:
            return jsonify({'error': 'Unauthorized'}), 403
        s3_path = document.get('s3_path')
        if not s3_path:
            return jsonify({'error': 'Document has no s3_path'}), 404
        bucket = os.environ.get('S3_UPLOAD_BUCKET')
        if not bucket:
            return jsonify({'error': 'Server misconfigured'}), 500
        token = uuid.uuid4().hex
        _temp_preview_tokens[token] = (bucket, s3_path, time.time() + _TEMP_PREVIEW_TOKEN_TTL_SEC)
        base = request.url_root.rstrip('/')
        open_in_word_url = f"{base}/api/documents/open-in-word?token={token}"
        return jsonify({'open_in_word_url': open_in_word_url, 'presigned_url': None}), 200
    except Exception as e:
        logger.exception("docx_preview_url failed: %s", e)
        return jsonify({'error': str(e)}), 500


@views.route('/api/documents/open-in-word', methods=['GET'])
def open_in_word():
    """Stream a temp-preview doc by token so Office Online can open it (no auth; token is the secret).
    Token is reused until expiry so Office's multiple requests (initial load + retries) all succeed."""
    token = request.args.get('token')
    if not token:
        return jsonify({'error': 'Missing token'}), 400
    entry = _temp_preview_tokens.get(token)
    if not entry:
        return jsonify({'error': 'Invalid or expired token'}), 404
    bucket, key, expiry = entry
    if time.time() > expiry:
        return jsonify({'error': 'Link expired'}), 410
    try:
        s3_client = boto3.client('s3',
            aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
            aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
            region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1'))
        resp = s3_client.get_object(Bucket=bucket, Key=key)
        body = resp['Body']
        content_type = resp.get('ContentType') or 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        return Response(body.read(), mimetype=content_type, headers={'Content-Disposition': 'inline'})
    except Exception as e:
        logging.exception("open_in_word get_object failed: %s", e)
        return jsonify({'error': 'Failed to load document'}), 500

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

@views.route('/api/documents', methods=['GET', 'OPTIONS'])
def get_documents():
    """
    Fetches all documents associated with the current user's business.
    """
    # Handle OPTIONS preflight - return early to bypass authentication
    if request.method == 'OPTIONS':
        # Flask-CORS will add headers via after_request handler
        return '', 200
    
    # Require login for actual GET request
    if not current_user.is_authenticated:
        # Flask-CORS will add headers automatically via after_request handler
        return jsonify({'error': 'Authentication required'}), 401
    
    business_uuid_str = _ensure_business_uuid()
    if not business_uuid_str:
        # Flask-CORS will add headers automatically via after_request handler
        return jsonify({'error': 'User is not associated with a business'}), 400

    documents = (
        Document.query
        .filter_by(business_id=UUID(business_uuid_str))
        .order_by(Document.created_at.desc())
        .all()
    )
    
    # Flask-CORS will add headers automatically via after_request handler
    return jsonify([doc.serialize() for doc in documents])

@views.route('/api/documents/folders', methods=['POST', 'OPTIONS'])
def create_folder():
    """
    Creates a new folder for organizing documents.
    """
    # Handle OPTIONS preflight
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
        error_response = jsonify({'error': 'Authentication required'})
        error_response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        error_response.headers.add('Access-Control-Allow-Credentials', 'true')
        return error_response, 401
    
    business_uuid_str = _ensure_business_uuid()
    if not business_uuid_str:
        error_response = jsonify({'error': 'User is not associated with a business'})
        error_response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        error_response.headers.add('Access-Control-Allow-Credentials', 'true')
        return error_response, 400
    
    try:
        data = request.get_json()
        name = data.get('name', 'New Folder')
        parent_id = data.get('parent_id')
        property_id = data.get('property_id')
        
        # Validate name
        if not name or not name.strip():
            return jsonify({'error': 'Folder name is required'}), 400
        
        # Generate folder ID
        folder_id = str(uuid.uuid4())
        
        # Get Supabase client
        supabase = get_supabase_client()
        
        # Prepare folder data
        folder_data = {
            'id': folder_id,
            'name': name.strip(),
            'business_id': business_uuid_str,
            'parent_id': parent_id if parent_id else None,
            'property_id': property_id if property_id else None,
            'created_at': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow().isoformat(),
        }
        
        # Insert into Supabase (assuming a 'folders' table exists)
        # If table doesn't exist, we'll use a simple storage approach
        try:
            result = supabase.table('folders').insert(folder_data).execute()
            logger.info(f"✅ Folder {folder_id} created in Supabase")
        except Exception as supabase_error:
            # If folders table doesn't exist, log and return the folder data anyway
            # The frontend will handle persistence via localStorage
            logger.warning(f"⚠️ Folders table may not exist in Supabase: {supabase_error}")
            logger.info(f"📁 Folder {folder_id} created (local storage only)")
        
        return jsonify({
            'success': True,
            'data': {
                'id': folder_id,
                'name': name.strip(),
                'parent_id': parent_id,
                'property_id': property_id,
                'document_count': 0,
            }
        }), 201
        
    except Exception as e:
        logger.error(f"Error creating folder: {e}", exc_info=True)
        error_response = jsonify({'error': f'Failed to create folder: {str(e)}'})
        error_response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        error_response.headers.add('Access-Control-Allow-Credentials', 'true')
        return error_response, 500

@views.route('/api/documents/folders/<uuid:folder_id>', methods=['DELETE', 'OPTIONS'])
@login_required
def delete_folder(folder_id):
    """
    Delete a folder from Supabase.
    Also deletes all child folders recursively.
    """
    # Handle OPTIONS preflight
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'DELETE, OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200
    
    business_uuid_str = _ensure_business_uuid()
    if not business_uuid_str:
        error_response = jsonify({'error': 'User is not associated with a business'})
        error_response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        error_response.headers.add('Access-Control-Allow-Credentials', 'true')
        return error_response, 400
    
    try:
        supabase = get_supabase_client()
        
        # Recursively delete folder and all its children
        def delete_folder_recursive(folder_id_to_delete):
            # First, get all child folders
            children = supabase.table('folders')\
                .select('id')\
                .eq('parent_id', str(folder_id_to_delete))\
                .eq('business_id', business_uuid_str)\
                .execute()
            
            # Delete all children first
            if children.data:
                for child in children.data:
                    delete_folder_recursive(child['id'])
            
            # Then delete this folder
            supabase.table('folders')\
                .delete()\
                .eq('id', str(folder_id_to_delete))\
                .eq('business_id', business_uuid_str)\
                .execute()
            
            logger.info(f"✅ Deleted folder {folder_id_to_delete} from Supabase")
        
        # Delete the folder and its children
        delete_folder_recursive(folder_id)
        
        return jsonify({
            'success': True,
            'message': 'Folder deleted successfully'
        }), 200
        
    except Exception as e:
        logger.error(f"Error deleting folder: {e}", exc_info=True)
        # Don't fail if folder doesn't exist in Supabase (might be localStorage only)
        return jsonify({
            'success': True,
            'message': 'Folder deletion attempted (may have been localStorage only)'
        }), 200

def _add_cors_headers(response):
    """Add CORS headers to a response so browser allows cross-origin requests."""
    if hasattr(response, 'headers'):
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    return response


@views.route('/api/documents/<uuid:document_id>', methods=['GET', 'OPTIONS'])
def get_document_by_id(document_id):
    """
    Get a single document's metadata by ID.
    Matches RESTful pattern: /api/documents/<id> (GET)
    """
    if request.method == 'OPTIONS':
        response = jsonify({})
        _add_cors_headers(response)
        response.headers.add('Access-Control-Allow-Methods', 'GET, OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200

    if not current_user.is_authenticated:
        r = jsonify({'error': 'Authentication required'})
        _add_cors_headers(r)
        return r, 401

    business_uuid_str = _ensure_business_uuid()
    if not business_uuid_str:
        r = jsonify({'error': 'User is not associated with a business'})
        _add_cors_headers(r)
        return r, 400

    try:
        document = Document.query.get(document_id)
        if not document:
            r = jsonify({'error': 'Document not found'})
            _add_cors_headers(r)
            return r, 404
        if str(document.business_id) != business_uuid_str:
            r = jsonify({'error': 'Forbidden'})
            _add_cors_headers(r)
            return r, 403
        r = jsonify(document.serialize())
        _add_cors_headers(r)
        return r
    except Exception as e:
        logger.exception("GET /api/documents/<id> failed: %s", e)
        r = jsonify({'error': 'Internal server error'})
        _add_cors_headers(r)
        return r, 500


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

@views.route('/api/documents/<uuid:document_id>/key-facts', methods=['GET'])
@login_required
def get_document_key_facts(document_id):
    """Get key facts for a document. Returns stored key facts when present (no re-generation on refresh)."""
    try:
        doc_service = SupabaseDocumentService()
        document = doc_service.get_document_by_id(str(document_id))
        if not document:
            return jsonify({'success': False, 'error': 'Document not found'}), 404
        doc_business_id = document.get('business_id')
        doc_business_uuid = document.get('business_uuid')
        user_business_id = str(current_user.business_id) if current_user.business_id else None
        user_company_name = current_user.company_name
        is_authorized = (
            (doc_business_id and user_company_name and str(doc_business_id) == str(user_company_name)) or
            (doc_business_uuid and user_business_id and str(doc_business_uuid) == user_business_id) or
            (doc_business_id and user_business_id and str(doc_business_id) == user_business_id)
        )
        if not is_authorized:
            return jsonify({'success': False, 'error': 'Unauthorized'}), 403

        doc_summary = document.get('document_summary') or {}
        if isinstance(doc_summary, str):
            try:
                doc_summary = json.loads(doc_summary)
            except Exception:
                doc_summary = {}
        if doc_summary is None:
            doc_summary = {}

        from .services.key_facts_service import build_key_facts_from_document, sanitise_key_facts_list

        # Return stored key facts when present (generated once at processing time)
        if 'stored_key_facts' in doc_summary and isinstance(doc_summary.get('stored_key_facts'), list):
            key_facts = sanitise_key_facts_list(doc_summary['stored_key_facts'])
            summary = doc_summary.get('summary') or None
            return jsonify({'success': True, 'data': {'key_facts': key_facts, 'summary': summary}}), 200

        # Fallback: build on the fly (e.g. legacy docs) and optionally persist for next time
        key_facts, llm_summary = build_key_facts_from_document(document, document_id=str(document_id))
        key_facts = sanitise_key_facts_list(key_facts)
        summary = doc_summary.get('summary') or llm_summary or None
        # Lazy write-back so future loads use stored key facts
        try:
            business_id = doc_business_uuid or doc_business_id
            if business_id:
                from .services.document_storage_service import DocumentStorageService
                doc_storage = DocumentStorageService()
                doc_storage.update_document_summary(
                    document_id=str(document_id),
                    business_id=str(business_id),
                    updates={'stored_key_facts': key_facts, 'summary': summary or ''},
                    merge=True,
                )
        except Exception as write_err:
            logger.debug("Key facts write-back failed (non-fatal): %s", write_err)
        return jsonify({'success': True, 'data': {'key_facts': key_facts, 'summary': summary}}), 200
    except Exception as e:
        logger.error(f"Error getting document key facts: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


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
        
        # Check authorization - document can have business_id (varchar) or business_uuid (uuid)
        # Compare against both current_user.business_id and company_name
        doc_business_id = document.get('business_id')
        doc_business_uuid = document.get('business_uuid')
        user_business_id = str(current_user.business_id) if current_user.business_id else None
        user_company_name = current_user.company_name
        
        # Allow access if any of these match
        is_authorized = (
            (doc_business_id and user_company_name and str(doc_business_id) == str(user_company_name)) or
            (doc_business_uuid and user_business_id and str(doc_business_uuid) == user_business_id) or
            (doc_business_id and user_business_id and str(doc_business_id) == user_business_id)
        )
        
        if not is_authorized:
            logger.warning(f"Unauthorized access to document {document_id}: doc_business_id={doc_business_id}, doc_business_uuid={doc_business_uuid}, user_business_id={user_business_id}, user_company_name={user_company_name}")
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
        
        # Minimal logging - only log if status is not completed (reduces log noise)
        # Completed documents are polled frequently by frontend, so we skip logging them
        doc_status = document.get('status', 'unknown')
        if doc_status != 'completed':
            logger.info(f"📊 Document {document_id} status: {doc_status}")
        # Completed documents: no logging (frontend will stop polling soon)
        
        return jsonify(response_data), 200
        
    except Exception as e:
        logger.error(f"Error getting document status: {e}")
        return jsonify({'error': str(e)}), 500


@views.route('/api/documents/<uuid:document_id>/reprocess', methods=['POST', 'OPTIONS'])
@login_required
def reprocess_document(document_id):
    """Reprocess a document (e.g. after failed or stuck). Fetches from Supabase, downloads from S3, queues full pipeline."""
    # Handle CORS preflight so browser gets HTTP OK
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200

    try:
        doc_service = SupabaseDocumentService()
        document = doc_service.get_document_by_id(str(document_id))
        if not document:
            return jsonify({'success': False, 'error': 'Document not found'}), 404

        doc_business_id = document.get('business_id')
        doc_business_uuid = document.get('business_uuid')
        user_business_id = str(current_user.business_id) if current_user.business_id else None
        user_company_name = current_user.company_name
        is_authorized = (
            (doc_business_id and user_company_name and str(doc_business_id) == str(user_company_name))
            or (doc_business_uuid and user_business_id and str(doc_business_uuid) == user_business_id)
            or (doc_business_id and user_business_id and str(doc_business_id) == user_business_id)
        )
        if not is_authorized:
            return jsonify({'success': False, 'error': 'Unauthorized'}), 403

        s3_path = document.get('s3_path')
        if not s3_path:
            return jsonify({'success': False, 'error': 'Document has no S3 path'}), 400

        original_filename = document.get('original_filename', 'document')
        business_id = str(doc_business_uuid or doc_business_id or user_business_id or user_company_name)

        doc_service.update_document(str(document_id), {'status': 'processing'})

        task = process_document_task.delay(
            document_id=str(document_id),
            original_filename=original_filename,
            business_id=business_id,
        )
        logger.info(f"Reprocess queued for document {document_id} (task_id={task.id})")
        return jsonify({
            'success': True,
            'message': 'Reprocessing started',
            'task_id': task.id,
            'document_id': str(document_id),
        }), 200
    except Exception as e:
        logger.exception("Reprocess document failed: %s", e)
        return jsonify({'success': False, 'error': str(e)}), 500


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
        
        # Trigger processing task (worker will download file from S3)
        try:
            task = process_document_task.delay(
                document_id=str(document.id),
                original_filename=document.original_filename,
                business_id=str(document.business_id)
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


@views.route('/api/dashboard', methods=['GET', 'OPTIONS'])
@login_required
def api_dashboard():
    """Get dashboard data with documents and properties from Supabase"""
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET, OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200
    
    try:
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({'error': 'User is not associated with a business'}), 400

        try:
            business_uuid = UUID(business_uuid_str)
        except (ValueError, TypeError) as e:
            current_app.logger.warning(f"Dashboard: invalid business_uuid {business_uuid_str!r}: {e}")
            return jsonify({'error': 'Invalid business configuration'}), 400

        # Get user's documents from Supabase
        documents = []
        try:
            doc_service = SupabaseDocumentService()
            documents = doc_service.get_documents_for_business(business_uuid, limit=10)
        except Exception as doc_err:
            current_app.logger.warning(f"Dashboard: failed to fetch documents: {doc_err}")
            documents = []

        # Get user's properties (still from PostgreSQL for now)
        properties = []
        try:
            # Compare as text so we work whether properties.business_id is UUID or TEXT in the DB
            business_id_str = str(business_uuid) if business_uuid else None
            if business_id_str:
                properties = (
                    Property.query
                    .filter(cast(Property.business_id, String(36)) == business_id_str)
                    .order_by(Property.created_at.desc())
                    .limit(10)
                    .all()
                )
        except Exception as e:
            logger.warning(f"Error querying properties from PostgreSQL: {e}")
            properties = []

        # Document count per property without loading Document ORM (avoids missing column classification_reasoning)
        document_count_by_property_id = {}
        if properties:
            try:
                for prop in properties:
                    r = db.session.execute(
                        text("SELECT COUNT(*) AS cnt FROM documents WHERE property_id = :pid"),
                        {"pid": str(prop.id)},
                    )
                    document_count_by_property_id[prop.id] = r.scalar() or 0
            except Exception as count_err:
                logger.warning(f"Dashboard: document count by property failed: {count_err}")

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
        
        # Convert properties to JSON-serializable format (use precomputed counts to avoid loading Document ORM)
        properties_data = []
        for prop in properties:
            properties_data.append({
                'id': str(prop.id),
                'formatted_address': prop.formatted_address,
                'normalized_address': prop.normalized_address,
                'completeness_score': prop.completeness_score,
                'created_at': prop.created_at.isoformat() if prop.created_at else None,
                'document_count': document_count_by_property_id.get(prop.id, 0)
            })
    
        # User data (include profile picture and title from Supabase if available)
        profile_picture_url = None
        title = None
        try:
            from .services.supabase_auth_service import SupabaseAuthService
            auth_service = SupabaseAuthService()
            supabase_user = auth_service.get_user_by_id(current_user.id)
            if supabase_user:
                s3_key = supabase_user.get('profile_picture_url')
                title = supabase_user.get('title')
                # Return profile picture as API URL so frontend can use it in <img src>
                if s3_key and s3_key.strip():
                    profile_picture_url = request.host_url.rstrip('/') + 'api/user/profile-picture'
        except Exception:
            pass
        role_name = 'user'
        if getattr(current_user, 'role', None) is not None:
            try:
                role_name = current_user.role.name
            except (AttributeError, ValueError):
                pass
        user_data = {
            'id': current_user.id,
            'email': current_user.email,
            'first_name': current_user.first_name,
            'company_name': current_user.company_name,
            'business_id': str(current_user.business_id) if current_user.business_id else None,
            'company_website': current_user.company_website,
            'role': role_name,
            'profile_picture_url': profile_picture_url,
            'title': title
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
        body = {'error': str(e)}
        if current_app.debug:
            body['traceback'] = traceback.format_exc()
        return jsonify(body), 500


@views.route('/api/user/profile-picture', methods=['GET'])
@login_required
def serve_profile_picture():
    """Serve the current user's profile picture from S3 (for img src)."""
    try:
        from .services.supabase_auth_service import SupabaseAuthService
        from botocore.exceptions import ClientError
        auth_service = SupabaseAuthService()
        supabase_user = auth_service.get_user_by_id(current_user.id)
        if not supabase_user:
            return jsonify({'error': 'User not found'}), 404
        s3_key = supabase_user.get('profile_picture_url')
        if not s3_key or not s3_key.strip():
            return jsonify({'error': 'No profile picture'}), 404
        s3_client = boto3.client(
            's3',
            aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID'),
            aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY'),
            region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
        )
        obj = s3_client.get_object(Bucket=os.environ['S3_UPLOAD_BUCKET'], Key=s3_key)
        return Response(
            obj['Body'].read(),
            mimetype=obj.get('ContentType', 'image/jpeg'),
            headers={'Cache-Control': 'private, max-age=300'}
        )
    except ClientError as e:
        if e.response.get('Error', {}).get('Code') == 'NoSuchKey':
            return jsonify({'error': 'Profile picture not found'}), 404
        raise
    except Exception as e:
        current_app.logger.exception("Error serving profile picture")
        return jsonify({'error': str(e)}), 500


@views.route('/api/user/profile-picture', methods=['POST', 'OPTIONS'])
@login_required
def upload_profile_picture():
    """Upload and set the current user's profile picture (S3 + Supabase)."""
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response, 200
    file = request.files.get('image')
    if not file or file.filename == '':
        return jsonify({'error': 'No image file provided'}), 400
    ext = os.path.splitext(secure_filename(file.filename))[1].lower() or '.jpg'
    if ext not in ('.jpg', '.jpeg', '.png', '.webp'):
        return jsonify({'error': 'Invalid image type. Use JPEG, PNG, or WebP.'}), 400
    s3_key = f"profile_pictures/{current_user.id}/{uuid.uuid4()}{ext}"
    try:
        s3_client = boto3.client(
            's3',
            aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID'),
            aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY'),
            region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1')
        )
        file.seek(0)
        s3_client.put_object(
            Bucket=os.environ['S3_UPLOAD_BUCKET'],
            Key=s3_key,
            Body=file.read(),
            ContentType=file.content_type or 'image/jpeg'
        )
        from .services.supabase_auth_service import SupabaseAuthService
        auth_service = SupabaseAuthService()
        auth_service.update_user(current_user.id, {'profile_picture_url': s3_key})
        base_url = request.host_url.rstrip('/')
        profile_url = f"{base_url}api/user/profile-picture"
        return jsonify({'profile_image_url': profile_url, 'avatar_url': profile_url})
    except Exception as e:
        current_app.logger.exception("Error uploading profile picture")
        return jsonify({'error': str(e)}), 500


@views.route('/api/user/profile-picture', methods=['DELETE'])
@login_required
def delete_profile_picture():
    """Remove the current user's profile picture."""
    try:
        from .services.supabase_auth_service import SupabaseAuthService
        auth_service = SupabaseAuthService()
        auth_service.update_user(current_user.id, {'profile_picture_url': None})
        return jsonify({'success': True})
    except Exception as e:
        current_app.logger.exception("Error removing profile picture")
        return jsonify({'error': str(e)}), 500


@views.route('/dashboard')
@login_required
def dashboard():
    return render_template("dashboard.html", user=current_user)

@views.route('/api/files', methods=['GET', 'OPTIONS'])
def get_files():
    """
    Alias for /api/documents - TypeScript frontend compatibility.
    Fetches all documents associated with the current user's business from Supabase.
    """
    # Handle OPTIONS preflight - return early to bypass authentication
    if request.method == 'OPTIONS':
        # Flask-CORS will add headers via after_request handler
        return '', 200
    
    # Require login for actual GET request
    if not current_user.is_authenticated:
        return jsonify({'error': 'Authentication required'}), 401
    
    business_uuid_str = _ensure_business_uuid()
    if not business_uuid_str:
        return jsonify({'error': 'User is not associated with a business'}), 400

    try:
        # Use Supabase document service
        doc_service = SupabaseDocumentService()
        raw_documents = doc_service.get_documents_for_business(business_uuid_str)
        # Expose key_facts and summary at top level so frontend can show them without a separate request
        documents = []
        for doc in raw_documents or []:
            d = dict(doc) if isinstance(doc, dict) else {}
            doc_summary = d.get('document_summary')
            if isinstance(doc_summary, str):
                try:
                    doc_summary = json.loads(doc_summary)
                except Exception:
                    doc_summary = {}
            if doc_summary is None:
                doc_summary = {}
            d['key_facts'] = doc_summary.get('stored_key_facts') if isinstance(doc_summary.get('stored_key_facts'), list) else []
            d['summary'] = doc_summary.get('summary') or None
            documents.append(d)
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
    s3_path = document_data.get('s3_path') or None
    original_filename = document_data.get('original_filename')
    document_business_uuid = _normalize_uuid_str(document_data.get('business_uuid'))

    if not document_business_uuid or document_business_uuid != user_business_uuid:
        logger.warning(
            "Document business mismatch (doc=%s, user=%s). Denying deletion.",
            document_business_uuid,
            user_business_uuid,
        )
        return jsonify({'error': 'Unauthorized'}), 403

    # If document is in the processing pipeline, revoke the Celery task so the worker stops
    try:
        from .services.document_processing_tasks import get_and_clear_document_processing_task_id
        task_id = get_and_clear_document_processing_task_id(str(document_id))
        if task_id:
            from flask import current_app
            celery_app = current_app.extensions.get("celery")
            if celery_app:
                celery_app.control.revoke(task_id, terminate=True)
                logger.info(f"Revoked processing task {task_id} for document {document_id}")
    except Exception as e:
        logger.warning(f"Could not revoke processing task for document {document_id}: {e}")

    # Allow deletion even when s3_path is missing (e.g. document still processing or created via another path).
    # UnifiedDeletionService skips S3 deletion when s3_path is None and still removes DB records.
    if not s3_path:
        logger.info(f"Document {document_id} has no s3_path; will delete DB record only")

    logger.info(f"🗑️ DELETE document {document_id} ({original_filename}) by {current_user.email}")

    # Use UnifiedDeletionService for all deletion operations
    from .services.unified_deletion_service import UnifiedDeletionService
    deletion_service = UnifiedDeletionService()

    result = deletion_service.delete_document_complete(
        document_id=str(document_id),
        business_id=document_business_uuid,
        s3_path=s3_path,
        delete_s3=bool(s3_path),
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
    # Worker loads file from S3 to avoid passing large payload through Celery.
    process_document_task.delay(
        document_id=str(new_document.id),
        original_filename=filename,
        business_id=str(business_uuid_str)
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
    task = process_document_task.delay(
        document_id='00000000-0000-0000-0000-000000000001',
        original_filename='test.pdf',
        business_id='test'
    )
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
    
    # Trigger processing task (worker will download file from S3)
    try:
        task = process_document_task.delay(
            document_id=str(document.id),
            original_filename=document.original_filename,
            business_id=str(document.business_id)
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

@views.route('/api/property-hub', methods=['GET', 'OPTIONS'])
@login_required
def get_all_property_hubs():
    """Get all property hubs for current business"""
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET, OPTIONS')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response, 200
    
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
        
        # Extract documents from property hub; add key_facts and summary at top level for instant modal display
        raw_docs = property_hub.get('documents', [])
        documents = []
        for doc in raw_docs:
            d = dict(doc) if isinstance(doc, dict) else {}
            doc_summary = d.get('document_summary')
            if isinstance(doc_summary, str):
                try:
                    doc_summary = json.loads(doc_summary)
                except Exception:
                    doc_summary = {}
            if doc_summary is None:
                doc_summary = {}
            d['key_facts'] = doc_summary.get('stored_key_facts') if isinstance(doc_summary.get('stored_key_facts'), list) else []
            d['summary'] = doc_summary.get('summary') or None
            documents.append(d)
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

@views.route('/api/documents/remove-duplicates', methods=['POST', 'OPTIONS'])
@login_required
def remove_duplicate_documents():
    """
    Remove duplicate documents from the database.
    Duplicates are identified by: original_filename + file_size + business_uuid.
    For each duplicate group, keeps the oldest document (by created_at) and deletes the rest.
    """
    # Handle OPTIONS preflight
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        return response, 200
    
    try:
        business_uuid_str = _ensure_business_uuid()
        if not business_uuid_str:
            return jsonify({'error': 'User is not associated with a business'}), 400
        
        from .services.supabase_document_service import SupabaseDocumentService
        from .services.unified_deletion_service import UnifiedDeletionService
        
        doc_service = SupabaseDocumentService()
        supabase = doc_service.supabase
        deletion_service = UnifiedDeletionService()
        
        # Get all documents for this business
        logger.info(f"🔍 [REMOVE-DUPLICATES] Fetching all documents for business {business_uuid_str}")
        all_docs = supabase.table('documents')\
            .select('id, original_filename, file_size, created_at, s3_path, business_uuid')\
            .eq('business_uuid', business_uuid_str)\
            .order('created_at', desc=False)\
            .execute()
        
        if not all_docs.data:
            return jsonify({
                'success': True,
                'message': 'No documents found',
                'duplicates_removed': 0,
                'details': []
            })
        
        logger.info(f"📄 [REMOVE-DUPLICATES] Found {len(all_docs.data)} total documents")
        
        # Group documents by (original_filename, file_size)
        # This identifies duplicates
        duplicate_groups = {}
        for doc in all_docs.data:
            key = (doc.get('original_filename'), doc.get('file_size'))
            if key not in duplicate_groups:
                duplicate_groups[key] = []
            duplicate_groups[key].append(doc)
        
        # Find groups with duplicates (more than 1 document)
        duplicates_to_remove = []
        for key, docs in duplicate_groups.items():
            if len(docs) > 1:
                # Sort by created_at (oldest first)
                docs_sorted = sorted(docs, key=lambda x: x.get('created_at', ''))
                # Keep the oldest (first), mark the rest for deletion
                keep_doc = docs_sorted[0]
                remove_docs = docs_sorted[1:]
                
                duplicates_to_remove.append({
                    'filename': key[0],
                    'file_size': key[1],
                    'keep': {
                        'id': keep_doc.get('id'),
                        'created_at': keep_doc.get('created_at')
                    },
                    'remove': [
                        {
                            'id': doc.get('id'),
                            'created_at': doc.get('created_at'),
                            's3_path': doc.get('s3_path')
                        }
                        for doc in remove_docs
                    ]
                })
        
        if not duplicates_to_remove:
            return jsonify({
                'success': True,
                'message': 'No duplicate documents found',
                'duplicates_removed': 0,
                'details': []
            })
        
        logger.info(f"🔄 [REMOVE-DUPLICATES] Found {len(duplicates_to_remove)} duplicate groups")
        
        # Delete duplicates
        deletion_results = []
        total_deleted = 0
        total_failed = 0
        
        for group in duplicates_to_remove:
            filename = group['filename']
            keep_id = group['keep']['id']
            
            for doc_to_remove in group['remove']:
                doc_id = doc_to_remove['id']
                s3_path = doc_to_remove.get('s3_path')
                
                try:
                    logger.info(f"🗑️ [REMOVE-DUPLICATES] Deleting duplicate: {filename} (ID: {doc_id})")
                    
                    # Use UnifiedDeletionService to properly delete the document
                    result = deletion_service.delete_document_complete(
                        document_id=doc_id,
                        business_id=business_uuid_str,
                        s3_path=s3_path,
                        delete_s3=True,
                        recompute_properties=True,
                        cleanup_orphans=True
                    )
                    
                    if result.success:
                        total_deleted += 1
                        deletion_results.append({
                            'filename': filename,
                            'deleted_id': doc_id,
                            'kept_id': keep_id,
                            'status': 'success'
                        })
                        logger.info(f"✅ [REMOVE-DUPLICATES] Successfully deleted duplicate {doc_id}")
                    else:
                        total_failed += 1
                        deletion_results.append({
                            'filename': filename,
                            'deleted_id': doc_id,
                            'kept_id': keep_id,
                            'status': 'failed',
                            'errors': result.errors
                        })
                        logger.error(f"❌ [REMOVE-DUPLICATES] Failed to delete duplicate {doc_id}: {result.errors}")
                        
                except Exception as e:
                    total_failed += 1
                    deletion_results.append({
                        'filename': filename,
                        'deleted_id': doc_id,
                        'kept_id': keep_id,
                        'status': 'error',
                        'error': str(e)
                    })
                    logger.error(f"❌ [REMOVE-DUPLICATES] Error deleting duplicate {doc_id}: {e}", exc_info=True)
        
        logger.info(f"✅ [REMOVE-DUPLICATES] Completed: {total_deleted} deleted, {total_failed} failed")
        
        return jsonify({
            'success': True,
            'message': f'Removed {total_deleted} duplicate document(s)',
            'duplicates_removed': total_deleted,
            'duplicates_failed': total_failed,
            'duplicate_groups_found': len(duplicates_to_remove),
            'details': deletion_results
        })
        
    except Exception as e:
        logger.error(f"❌ [REMOVE-DUPLICATES] Error: {e}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


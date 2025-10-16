from flask import Blueprint, render_template, request, flash, redirect, url_for, jsonify
from flask_login import login_required, current_user
from .models import Appraisal, ComparableProperty, ChatMessage, Document, db
from datetime import datetime
import os
import uuid
import requests
from requests_aws4auth import AWS4Auth
from werkzeug.utils import secure_filename
import sys
import logging
from .tasks import process_document_task
from .services.deletion_service import DeletionService
from sqlalchemy import text
import json

views = Blueprint('views', __name__)

# Set up logging
logger = logging.getLogger(__name__)

# ============================================================================
# HEALTH & STATUS ENDPOINTS
# ============================================================================

@views.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint for frontend connection testing"""
    try:
        # Quick database checks
        db.session.execute(text('SELECT 1'))
        
        return jsonify({
            'success': True,
            'data': {
                'status': 'healthy',
                'timestamp': datetime.utcnow().isoformat(),
                'version': '1.0.0'
            }
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

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

# ============================================================================
# PROPERTY SEARCH & ANALYSIS ENDPOINTS
# ============================================================================

@views.route('/api/properties', methods=['GET'])
@login_required
def get_all_properties():
    """Get all properties for the current user's business"""
    try:
        from .services.property_search_service import PropertySearchService
        service = PropertySearchService()
        
        # Get all properties (no query, no filters)
        results = service.search_properties(
            current_user.company_name,
            query="",
            filters={'limit': 1000}  # Get up to 1000 properties
        )
        
        # 🔍 PHASE 1 DEBUG: Log API response data
        logger.info(f"🔍 PHASE 1 DEBUG - API Response:")
        logger.info(f"   User business: {current_user.company_name}")
        logger.info(f"   Properties returned: {len(results)}")
        
        if results:
            sample_prop = results[0]
            logger.info(f"   Sample property structure: {list(sample_prop.keys())}")
            logger.info(f"   Sample property prices: sold_price={sample_prop.get('sold_price')}, rent_pcm={sample_prop.get('rent_pcm')}, asking_price={sample_prop.get('asking_price')}")
            
            # Count properties with different price types
            price_counts = {
                'sold_price': sum(1 for p in results if p.get('sold_price') and p['sold_price'] > 0),
                'rent_pcm': sum(1 for p in results if p.get('rent_pcm') and p['rent_pcm'] > 0),
                'asking_price': sum(1 for p in results if p.get('asking_price') and p['asking_price'] > 0),
                'no_price': sum(1 for p in results if not (p.get('sold_price') or p.get('rent_pcm') or p.get('asking_price')))
            }
            logger.info(f"   Price type counts: {price_counts}")
        
        return jsonify({
            'success': True,
            'data': results
        }), 200
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@views.route('/api/properties/search', methods=['POST'])
@login_required
def search_properties():
    """Search properties with query and filters"""
    data = request.get_json()
    query = data.get('query', '')
    filters = data.get('filters', {})
    
    try:
        from .services.property_search_service import PropertySearchService
        service = PropertySearchService()
        results = service.search_properties(
            current_user.company_name,
            query,
            filters
        )
        
        return jsonify({
            'success': True,
            'data': results
        }), 200
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


# API endpoint for React dashboard
@views.route('/api/dashboard', methods=['GET'])
@login_required
def api_dashboard():
    # Get user's appraisals
    appraisals = Appraisal.query.filter_by(user_id=current_user.id).order_by(Appraisal.date_created.desc()).all()
    
    # Convert appraisals to JSON-serializable format
    appraisals_data = []
    for appraisal in appraisals:
        appraisals_data.append({
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
        })
    
    # User data
    user_data = {
        'id': current_user.id,
        'email': current_user.email,
        'first_name': current_user.first_name,
        'company_name': current_user.company_name,
        'company_website': current_user.company_website,
        'role': current_user.role.name  # Add the user's role here
    }
    
    return jsonify({
        'user': user_data,
        'appraisals': appraisals_data
    })

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
    if not current_user.company_name:
        return jsonify({'error': 'User is not associated with a business'}), 400

    documents = Document.query.filter_by(business_id=current_user.company_name).order_by(Document.created_at.desc()).all()
    
    return jsonify([doc.serialize() for doc in documents])

@views.route('/api/files', methods=['GET'])
@login_required
def get_files():
    """
    Alias for /api/documents - TypeScript frontend compatibility.
    Fetches all documents associated with the current user's business.
    """
    if not current_user.company_name:
        return jsonify({'error': 'User is not associated with a business'}), 400

    documents = Document.query.filter_by(business_id=current_user.company_name).order_by(Document.created_at.desc()).all()
    
    return jsonify({
        'success': True,
        'data': [doc.serialize() for doc in documents]
    })

@views.route('/api/files/<uuid:file_id>', methods=['DELETE', 'OPTIONS'])
def delete_file(file_id):
    """
    Alias for /api/document/<uuid:document_id> DELETE - TypeScript frontend compatibility.
    Deletes a document from S3, AstraDB stores, and its metadata record from the database.
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
    Deletes a document from S3, AstraDB stores, and its metadata record from the database.
    """
    document = Document.query.get(document_id)
    if not document:
        return jsonify({'error': 'Document not found'}), 404

    if document.business_id != current_user.company_name:
        return jsonify({'error': 'Unauthorized'}), 403

    deletion_results = {
        's3': False,
        'astra_tabular': False,
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

    # 3. Delete from ALL database stores (AstraDB + PostgreSQL properties)
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

    # 4. Delete the PostgreSQL record
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

    # 5. Return comprehensive results
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
    existing_document = Document.query.filter_by(
        original_filename=filename,
        business_id=current_user.company_name
    ).first()

    if existing_document:
        return jsonify({
            'error': f'A document with the filename "{filename}" already exists in your account. Please rename the file or delete the existing document first.',
            'existing_document_id': str(existing_document.id)
        }), 409  # 409 Conflict
    
    # 3. Create and save the Document record BEFORE uploading
    try:
        new_document = Document(
            original_filename=filename,
            s3_path=s3_key,
            file_type=file.mimetype,
            file_size=file.content_length,
            uploaded_by_user_id=current_user.id,
            business_id=current_user.company_name
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
        business_id=current_user.company_name
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
    
    if document.business_id != current_user.company_name:
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


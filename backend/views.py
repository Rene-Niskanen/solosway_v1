from flask import Blueprint, render_template, request, flash, redirect, url_for, jsonify
from flask_login import login_required, current_user
from .models import Document, DocumentStatus, Property, db
from .services.property_enrichment_service import PropertyEnrichmentService
from .services.supabase_document_service import SupabaseDocumentService
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
        if not current_user.company_name:
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
            current_user.company_name,
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
                'business_id': property_data.get('business_id'),
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
        if not current_user.company_name:
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
        property_hubs = property_hub_service.search_property_hubs(
            business_id=current_user.company_name,
            query=query,
            filters=filters,
            limit=limit,
            offset=offset
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
                'business_id': property_data.get('business_id'),
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
                'business_id': current_user.company_name,
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
        if not current_user.company_name:
            return jsonify({
                'success': False,
                'error': 'User not associated with a business'
            }), 400
        
        property_hub_service = SupabasePropertyHubService()
        property_hub = property_hub_service.get_property_hub(str(property_id), current_user.company_name)
        
        if not property_hub:
            return jsonify({
                'success': False,
                'error': 'Property not found'
            }), 404
        
        # Return the complete property hub as enriched data
        return jsonify({
            'success': True,
            'data': property_hub,
            'metadata': {
                'property_id': str(property_id),
                'business_id': current_user.company_name,
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
        # Debug logging
        logger.info(f"🔍 Proxy upload request received")
        logger.info(f"   Content-Type: {request.content_type}")
        logger.info(f"   Files in request: {list(request.files.keys())}")
        logger.info(f"   Form data: {list(request.form.keys())}")
        
        if 'file' not in request.files:
            logger.error(f"❌ No 'file' key in request.files")
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            logger.error(f"❌ Empty filename")
            return jsonify({'error': 'No file selected'}), 400
        
        logger.info(f"✅ File received: {file.filename} ({file.content_length} bytes)")
        
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
            
            logger.info(f"✅ Successfully uploaded {filename} to S3: {s3_key}")
            
        except Exception as e:
            logger.error(f"❌ Failed to upload {filename} to S3: {e}")
            return jsonify({'error': f'Failed to upload to S3: {str(e)}'}), 500
        
        # Only create document record AFTER successful S3 upload
        try:
            new_document = Document(
                original_filename=filename,
                s3_path=s3_key,
                file_type=file.content_type,
                file_size=file.content_length or 0,
                uploaded_by_user_id=current_user.id,
                business_id=current_user.company_name
            )
            db.session.add(new_document)
            db.session.commit()
            
            logger.info(f"✅ Created document record: {new_document.id}")
            
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
                    'status': 'uploaded'
                })
                if success:
                    logger.info(f"✅ Synced document to Supabase: {doc_id}")
                else:
                    logger.warning(f"⚠️ Failed to sync document to Supabase: {error}")
            except Exception as e:
                logger.warning(f"⚠️ Supabase sync failed (non-fatal): {e}")
            
            # Trigger processing task
            file.seek(0)  # Reset file pointer again
            file_content = file.read()

            logger.info(f"🔄 Starting document processing pipeline for {filename} (ID: {new_document.id})")

            try:
                task = process_document_task.delay(
                    document_id=new_document.id,
                    file_content=file_content,
                    original_filename=filename,
                    business_id=new_document.business_id
                )
                logger.info(f"✅ Processing task created: {task.id}")
            except Exception as e:
                logger.error(f"❌ Failed to create processing task: {e}")
                new_document.status = DocumentStatus.FAILED
                db.session.commit()
                raise
            
            return jsonify({
                'success': True,
                'document_id': str(new_document.id),
                'message': 'File uploaded and processing started',
                'task_id': task.id
            }), 200
            
        except Exception as e:
            logger.error(f"❌ Failed to create document record: {e}")
            # Try to clean up S3 file if database record creation fails
            try:
                s3_client.delete_object(Bucket=os.environ['S3_UPLOAD_BUCKET'], Key=s3_key)
                logger.info(f"🗑️ Cleaned up S3 file: {s3_key}")
            except:
                pass
            return jsonify({'error': f'Failed to create document record: {str(e)}'}), 500
            
    except Exception as e:
        logger.error(f"❌ Proxy upload failed: {e}")
        return jsonify({'error': str(e)}), 500

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
        
        if document.get('business_id') != current_user.company_name:
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
        
        if document.business_id != current_user.company_name:
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
        # Get user's documents from Supabase
        doc_service = SupabaseDocumentService()
        documents = doc_service.get_documents_for_business(current_user.company_name, limit=10)
        
        # Get user's properties (still from PostgreSQL for now)
        from .models import Property
        properties = Property.query.filter_by(business_id=current_user.company_name).order_by(Property.created_at.desc()).limit(10).all()
        
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
    if not current_user.company_name:
        return jsonify({'error': 'User is not associated with a business'}), 400

    documents = Document.query.filter_by(business_id=current_user.company_name).order_by(Document.created_at.desc()).all()
    
    return jsonify([doc.serialize() for doc in documents])

@views.route('/api/files', methods=['GET'])
@login_required
def get_files():
    """
    Alias for /api/documents - TypeScript frontend compatibility.
    Fetches all documents associated with the current user's business from Supabase.
    """
    if not current_user.company_name:
        return jsonify({'error': 'User is not associated with a business'}), 400

    try:
        # Use Supabase document service
        doc_service = SupabaseDocumentService()
        documents = doc_service.get_documents_for_business(current_user.company_name)
        
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

    if document.business_id != current_user.company_name:
        return jsonify({'error': 'Unauthorized'}), 403

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

    # 4. Delete local PostgreSQL relationships FIRST (before document)
    logger.info("[POSTGRESQL RELATIONSHIPS DELETION]")
    try:
        from .models import DocumentRelationship
        relationship_count = DocumentRelationship.query.filter_by(document_id=document_id).count()
        logger.info(f"   Found {relationship_count} document relationships")
        
        # Delete all document relationships for this document
        DocumentRelationship.query.filter_by(document_id=document_id).delete()
        db.session.commit()
        logger.info(f"   SUCCESS: Deleted {relationship_count} document relationships")
    except Exception as e:
        logger.warning(f"   WARNING: Failed to delete document relationships - {e}")
        db.session.rollback()
        # Continue anyway - don't fail the whole deletion
    
    # 5. Delete local PostgreSQL processing history (after relationships)
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
    
    # 6. Delete the PostgreSQL document record
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

    # 7. Return comprehensive results
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
        if not current_user.company_name:
            return jsonify({
                'success': False,
                'error': 'User not associated with a business'
            }), 400
        
        property_hub_service = SupabasePropertyHubService()
        property_hub = property_hub_service.get_property_hub(str(property_id), current_user.company_name)
        
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
                'business_id': current_user.company_name,
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
        if not current_user.company_name:
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
        
        property_hub_service = SupabasePropertyHubService()
        property_hubs = property_hub_service.get_all_property_hubs(
            current_user.company_name,
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
        if not current_user.company_name:
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
            business_id=current_user.company_name,
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
                'business_id': current_user.company_name,
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

@views.route('/api/property-hub/<uuid:property_id>/documents', methods=['GET'])
@login_required
def get_property_hub_documents(property_id):
    """Get all documents linked to a property hub"""
    try:
        from .services.supabase_property_hub_service import SupabasePropertyHubService
        
        # Validate business access
        if not current_user.company_name:
            return jsonify({
                'success': False,
                'error': 'User not associated with a business'
            }), 400
        
        property_hub_service = SupabasePropertyHubService()
        property_hub = property_hub_service.get_property_hub(str(property_id), current_user.company_name)
        
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
                'business_id': current_user.company_name,
                'timestamp': datetime.utcnow().isoformat()
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting property hub documents {property_id}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

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


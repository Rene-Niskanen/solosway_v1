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
from .tasks import process_document_task
from .services.deletion_service import DeletionService

views = Blueprint('views', __name__)

# Redirect root to React app
@views.route('/')
def root():
    return redirect('http://localhost:3000')


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
        'astra_vector': False,
        'postgresql': False
    }

    # 1. Get AWS and API Gateway configuration from environment
    try:
        aws_access_key = os.environ['AWS_ACCESS_KEY_ID']
        aws_secret_key = os.environ['AWS_SECRET_ACCESS_KEY']
        aws_region = os.environ['AWS_REGION']
        invoke_url = os.environ['API_GATEWAY_INVOKE_URL']
        bucket_name = os.environ['S3_UPLOAD_BUCKET']
    except KeyError as e:
        error_message = f"Missing environment variable: {e}"
        print(error_message, file=sys.stderr)
        return jsonify({'error': 'Server is not configured for file deletion.'}), 500
    
    # 2. Delete the object from S3
    try:
        s3_key = document.s3_path
        final_url = f"{invoke_url.rstrip('/')}/{bucket_name}/{s3_key}"
        service = 'execute-api'
        aws_auth = AWS4Auth(aws_access_key, aws_secret_key, aws_region, service)

        response = requests.delete(final_url, auth=aws_auth)
        response.raise_for_status()
        deletion_results['s3'] = True
        print(f"Successfully deleted S3 file: {s3_key}")

    except requests.exceptions.RequestException as e:
        error_message = f"Failed to delete file from S3: {e}"
        print(error_message, file=sys.stderr)
        # Don't return error - continue with other deletions

    # 3. Delete from AstraDB stores
    try:
        deletion_service = DeletionService()
        astra_success = deletion_service.delete_document_from_astra_stores(
            str(document_id), 
            document.business_id
        )
        deletion_results['astra_tabular'] = astra_success
        deletion_results['astra_vector'] = astra_success
        
        if astra_success:
            print(f"Successfully deleted AstraDB data for document {document_id}")
        else:
            print(f"Failed to delete some AstraDB data for document {document_id}")
            
    except Exception as e:
        error_message = f"Failed to delete from AstraDB: {e}"
        print(error_message, file=sys.stderr)
        # Don't return error - continue with PostgreSQL deletion

    # 4. Delete the PostgreSQL record
    try:
        db.session.delete(document)
        db.session.commit()
        deletion_results['postgresql'] = True
        print(f"Successfully deleted PostgreSQL record for document {document_id}")
        
    except Exception as e:
        db.session.rollback()
        error_message = f"Failed to delete database record: {e}"
        print(error_message, file=sys.stderr)
        return jsonify({'error': 'Failed to delete database record.'}), 500

    # 5. Return comprehensive results
    success_count = sum(deletion_results.values())
    total_operations = len(deletion_results)
    
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
        aws_region = os.environ['AWS_REGION']
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
    # corrupted, while the pristine file remains stored in S3.
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


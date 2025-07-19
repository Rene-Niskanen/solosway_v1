from flask import Blueprint, render_template, request, flash, redirect, url_for, jsonify
from flask_login import login_required, current_user
from .models import Appraisal, ComparableProperty, ChatMessage, Document
from . import db
from datetime import datetime
import os
import uuid
import requests
from requests_aws4auth import AWS4Auth
from werkzeug.utils import secure_filename
import sys

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
    Deletes a document from S3 and its metadata record from the database.
    """
    document = Document.query.get(document_id)
    if not document:
        return jsonify({'error': 'Document not found'}), 404

    if document.business_id != current_user.company_name:
        return jsonify({'error': 'Unauthorized'}), 403

    # 1. Get AWS and API Gateway configuration from environment
    try:
        aws_access_key = os.environ['AWS_ACCESS_KEY_ID']
        aws_secret_key = os.environ['AWS_SECRET_ACCESS_KEY']
        aws_region = os.environ['AWS_REGION']
        invoke_url = os.environ['API_GATEWAY_INVOKE_URL']
        bucket_name = os.environ['S3_BUCKET_NAME']
    except KeyError as e:
        error_message = f"Missing environment variable: {e}"
        print(error_message, file=sys.stderr)
        return jsonify({'error': 'Server is not configured for file deletion.'}), 500
    
    # 2. Delete the object from S3 by making a signed DELETE request
    try:
        # The S3 Key is the path to the file within the bucket
        s3_key = document.s3_path
        
        # We will target a simpler API Gateway endpoint, e.g., /<bucket_name>/<s3_key>
        final_url = f"{invoke_url.rstrip('/')}/{bucket_name}/{s3_key}"
        service = 'execute-api'
        aws_auth = AWS4Auth(aws_access_key, aws_secret_key, aws_region, service)

        response = requests.delete(final_url, auth=aws_auth)
        response.raise_for_status()

    except requests.exceptions.RequestException as e:
        error_message = f"Failed to delete file from S3: {e}"
        print(error_message, file=sys.stderr)
        return jsonify({'error': 'Failed to delete file from storage.'}), 502

    # 3. If S3 deletion was successful, delete the database record
    db.session.delete(document)
    db.session.commit()

    return jsonify({'success': True, 'message': 'Document deleted successfully'}), 200


@views.route('/api/upload-file', methods=['POST'])
@login_required
def upload_file_to_gateway():
    """
    Receives a file from the frontend and proxies it to a secure AWS API Gateway endpoint.
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No file part in the request'}), 400
    
    file = request.files['file']

    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    # 1. Get AWS and API Gateway configuration from environment
    aws_access_key = os.getenv('AWS_ACCESS_KEY_ID')
    aws_secret_key = os.getenv('AWS_SECRET_ACCESS_KEY')
    aws_region = os.getenv('AWS_REGION')
    invoke_url = os.getenv('API_GATEWAY_INVOKE_URL')
    bucket_name = os.getenv('S3_UPLOAD_BUCKET')

    # --- Start of Debugging ---
    print("--- API Gateway Upload Debug Info ---")
    print(f"Invoke URL: {invoke_url}")
    print(f"Bucket Name: {bucket_name}")
    print(f"AWS Region: {aws_region}")
    print(f"Access Key ID: {'Exists' if aws_access_key else 'MISSING'}")
    print(f"Secret Key: {'Exists' if aws_secret_key else 'MISSING'}")
    print("------------------------------------")
    # --- End of Debugging ---

    if not all([aws_access_key, aws_secret_key, aws_region, invoke_url, bucket_name]):
        print("ERROR: One or more required AWS/API Gateway environment variables are missing.")
        return jsonify({'error': 'Server is not configured for file uploads'}), 500

    # 2. Construct the full URL for the API Gateway
    safe_filename = secure_filename(file.filename)
    business_id = current_user.company_name or 'default-business'
    
    # Create the S3 object path (without the 'uploads/' prefix)
    s3_path = f"{business_id}/{current_user.id}/{safe_filename}"
    
    # Example: https://.../solosway-s3-fileupload/soloswayofficialbucket/default-business/1/file.pdf
    # Strip any trailing slash from invoke_url to prevent double slashes
    final_url = f"{invoke_url.rstrip('/')}/{bucket_name}/{s3_path}"
    
    # 3. Create the AWS Auth object
    service = 'execute-api'
    aws_auth = AWS4Auth(aws_access_key, aws_secret_key, aws_region, service)

    # 4. Make the PUT request from the backend to the API Gateway
    try:
        file_content = file.read()
        
        # The requests_aws4auth library, when passed to the `auth` param,
        # will correctly sign the request payload (the file_content).
        response = requests.put(
            final_url,
            auth=aws_auth,
            data=file_content,
            headers={'Content-Type': file.mimetype}
        )
        response.raise_for_status() # Raise an exception for bad status codes (4xx or 5xx)

        # 5. Create a metadata record in our PostgreSQL database
        new_document = Document(
            original_filename=safe_filename,
            s3_path=s3_path,
            file_type=file.mimetype,
            file_size=file.content_length,
            business_id=business_id,
            uploaded_by_user_id=current_user.id
        )
        db.session.add(new_document)
        db.session.commit()

        return jsonify({
            'success': True,
            'message': f'File {safe_filename} uploaded successfully.',
            'document_id': new_document.id,
            'url': final_url
        }), 200

    except requests.exceptions.RequestException as e:
        # Handle network errors or errors from the API Gateway
        error_message = f"Failed to upload file to S3 via API Gateway: {e}"
        print(error_message, file=sys.stderr) # Log the detailed error
        return jsonify({'error': error_message}), 502 # 502 Bad Gateway

    except Exception as e:
        # Handle other potential errors
        error_message = f"An unexpected error occurred during file upload: {e}"
        print(error_message, file=sys.stderr)
        return jsonify({'error': error_message}), 500


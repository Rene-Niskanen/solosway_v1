from flask import Blueprint, render_template, request, flash, redirect, url_for, jsonify
from flask_login import login_user, login_required, logout_user, current_user
from .models import Note, Appraisal, ComparableProperty, ChatMessage
from . import db
from datetime import datetime

views = Blueprint('views', __name__)

# Redirect root to React app
@views.route('/')
def root():
    return redirect('http://localhost:3000')

# Temporarily disabled HTML routes - using React frontend instead
# @views.route('/')
# def landing_page():
#     return render_template("landing.html")

# @views.route('/dashboard', methods=['GET', 'POST'])
# @login_required
# def home():
#     if request.method == 'POST':
#         note = request.form.get('note')
#         if len(note) < 1:
#             flash('Note is too short!', category='error')
#         else:
#             new_note = Note(data=note, user_id=current_user.id)
#             db.session.add(new_note)
#             db.session.commit()
#             flash('Note added!', category='success')
    
#     # Get user's appraisals
#     appraisals = Appraisal.query.filter_by(user_id=current_user.id).order_by(Appraisal.date_created.desc()).all()
#     return render_template("home2.html", user=current_user, appraisals=appraisals)

# @views.route('/create-appraisal', methods=['GET', 'POST'])
# @login_required
# def create_appraisal():
#     if request.method == 'POST':
#         address = request.form.get('address')
#         bedrooms = request.form.get('bedrooms')
#         bathrooms = request.form.get('bathrooms')
#         property_type = request.form.get('property_type')
#         land_size = request.form.get('land_size')
#         floor_area = request.form.get('floor_area')
#         condition = request.form.get('condition')
#         features = request.form.getlist('features')  # Get list of selected features
        
#         if not address:
#             flash('Address is required!', category='error')
#         else:
#             new_appraisal = Appraisal(
#                 address=address,
#                 bedrooms=bedrooms if bedrooms else None,
#                 bathrooms=bathrooms if bathrooms else None,
#                 property_type=property_type if property_type else None,
#                 land_size=float(land_size) if land_size else None,
#                 floor_area=float(floor_area) if floor_area else None,
#                 condition=int(condition) if condition else None,
#                 features=','.join(features) if features else None,
#                 user_id=current_user.id,
#                 status='In Progress'
#             )
#             db.session.add(new_appraisal)
#             db.session.commit()
#             flash('Appraisal created successfully!', category='success')
#             return redirect(url_for('views.current_appraisal', id=new_appraisal.id))
            
#     return render_template("create_appraisal.html", user=current_user)

# @views.route('/appraisal/<int:id>', methods=['GET', 'POST'])
# @login_required
# def current_appraisal(id):
#     appraisal = Appraisal.query.get_or_404(id)
#     if appraisal.user_id != current_user.id:
#         flash('You do not have permission to view this appraisal.', category='error')
#         return redirect(url_for('views.home'))

#     tab = request.args.get('tab', 'overview')

#     if request.method == 'POST':
#         message_content = request.form.get('message')
#         if message_content:
#             new_message = ChatMessage(
#                 content=message_content,
#                 is_user=True,
#                 appraisal_id=appraisal.id,
#                 timestamp=datetime.utcnow()
#             )
#             db.session.add(new_message)
#             db.session.commit()
            
#             # Here you would typically add your AI response logic
#             # For now, we'll just add a placeholder response
#             ai_response = ChatMessage(
#                 content="I've received your message and will analyze the property details. Please give me a moment to process this information.",
#                 is_user=False,
#                 appraisal_id=appraisal.id,
#                 timestamp=datetime.utcnow()
#             )
#             db.session.add(ai_response)
#             db.session.commit()
#             return redirect(url_for('views.current_appraisal', id=id, tab=tab))

#     comparable_properties = ComparableProperty.query.filter_by(appraisal_id=id).all()
#     chat_messages = ChatMessage.query.filter_by(appraisal_id=id).order_by(ChatMessage.timestamp).all()

#     # For comparables tab, calculate metrics
#     comparable_count = len(comparable_properties)
#     average_price = sum(p.price for p in comparable_properties) / comparable_count if comparable_count > 0 else 0
#     price_per_sqft = sum(p.price / p.square_feet for p in comparable_properties if p.square_feet) / comparable_count if comparable_count > 0 else 0

#     return render_template(
#         "current_appraisal.html",
#         user=current_user,
#         appraisal=appraisal,
#         comparable_properties=comparable_properties,
#         chat_messages=chat_messages,
#         tab=tab,
#         comparable_count=comparable_count,
#         average_price=average_price,
#         price_per_sqft=price_per_sqft
#     )

# @views.route('/appraisal/<int:id>/comparables')
# @login_required
# def comparables(id):
#     appraisal = Appraisal.query.get_or_404(id)
    
#     # Ensure user can only access their own appraisals
#     if appraisal.user_id != current_user.id:
#         flash('You do not have permission to view this appraisal.', category='error')
#         return redirect(url_for('views.home'))
    
#     # Get comparable properties
#     comparable_properties = ComparableProperty.query.filter_by(appraisal_id=id).all()
    
#     # Calculate market analysis metrics
#     comparable_count = len(comparable_properties)
#     average_price = sum(p.price for p in comparable_properties) / comparable_count if comparable_count > 0 else 0
#     price_per_sqft = sum(p.price / p.square_feet for p in comparable_properties) / comparable_count if comparable_count > 0 else 0
    
#     return render_template("comparables.html",
#                          user=current_user,
#                          appraisal=appraisal,
#                          properties=comparable_properties,
#                          comparable_count=comparable_count,
#                          average_price=average_price,
#                          price_per_sqft=price_per_sqft)

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
        'company_website': current_user.company_website
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
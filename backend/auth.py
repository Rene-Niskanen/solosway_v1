from flask import Blueprint, render_template, request, flash, redirect, url_for, jsonify
from .models import User, UserRole, UserStatus
from werkzeug.security import generate_password_hash, check_password_hash
from . import db
from flask_login import login_user, login_required, logout_user, current_user
from .services.supabase_auth_service import SupabaseAuthService
import logging
from uuid import UUID, uuid4

auth = Blueprint('auth', __name__)
logger = logging.getLogger(__name__)


# Test endpoint to check database connection
@auth.route('/api/test-db', methods=['GET'])
def test_db():
    try:
        # Test Supabase connection
        auth_service = SupabaseAuthService()
        # Try to get a user to test connection
        test_user = auth_service.get_user_by_email('admin@solosway.com')
        return jsonify({'success': True, 'message': f'Supabase connected. Test user found: {test_user is not None}'}), 200
    except Exception as e:
        return jsonify({'success': False, 'message': f'Supabase error: {str(e)}'}), 500


@auth.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        
        # Use Supabase for authentication
        auth_service = SupabaseAuthService()
        user_data = auth_service.get_user_by_email(email)
        
        if user_data and auth_service.verify_password(user_data, password):
            business_uuid = user_data.get('business_uuid')
            if not business_uuid:
                legacy_business = user_data.get('business_id') or user_data.get('company_name')
                business_uuid = auth_service.ensure_business_uuid(legacy_business)
                auth_service.update_user(user_data['id'], {'business_uuid': business_uuid})

            user = User()
            user.id = user_data['id']
            user.email = user_data['email']
            user.first_name = user_data['first_name']
            user.company_name = user_data['company_name']
            user.company_website = user_data['company_website']
            user.role = UserRole.ADMIN if user_data['role'] == 'admin' else UserRole.USER
            user.status = UserStatus.ACTIVE if user_data['status'] == 'active' else UserStatus.INVITED
            user.business_id = UUID(business_uuid) if business_uuid else None
            
            flash('Logged in successfully!', category='success')
            login_user(user, remember=True)
            return redirect(url_for('views.home'))
        else:
            flash('Invalid email or password.', category='error')
            
    return render_template("login.html", user=current_user)

# API endpoint for React login
@auth.route('/api/login', methods=['POST'])
def api_login():
    try:
        # Debug logging
        logger.info(f"Login attempt from: {request.remote_addr}")
        logger.info(f"Request headers: {dict(request.headers)}")
        
        data = request.get_json()
        if not data:
            logger.error("No JSON data received")
            return jsonify({'success': False, 'message': 'No data received.'}), 400
            
        logger.info(f"Login data received: {data}")
        
        email = data.get('email')
        password = data.get('password')
        
        if not email or not password:
            logger.error(f"Missing credentials: email={email}, password={'*' if password else None}")
            return jsonify({'success': False, 'message': 'Email and password required.'}), 400
        
        # Use Supabase for authentication
        auth_service = SupabaseAuthService()
        user_data = auth_service.get_user_by_email(email)
        logger.info(f"User found: {user_data is not None}")
        
        if user_data and auth_service.verify_password(user_data, password):
            legacy_business = user_data.get('business_id') or user_data.get('company_name')
            business_uuid = user_data.get('business_uuid') or auth_service.ensure_business_uuid(legacy_business)
            if not user_data.get('business_uuid'):
                auth_service.update_user(user_data['id'], {'business_uuid': business_uuid})

            user = User()
            user.id = user_data['id']
            user.email = user_data['email']
            user.first_name = user_data['first_name']
            user.company_name = user_data['company_name']
            user.company_website = user_data['company_website']
            user.role = UserRole.ADMIN if user_data['role'] == 'admin' else UserRole.USER
            user.status = UserStatus.ACTIVE if user_data['status'] == 'active' else UserStatus.INVITED
            user.business_id = UUID(business_uuid) if business_uuid else None
            
            login_user(user, remember=True)
            logger.info(f"Login successful for user: {email}")
            return jsonify({'success': True, 'message': 'Logged in successfully.'}), 200
        else:
            logger.warning(f"Login failed for email: {email}")
            return jsonify({'success': False, 'message': 'Invalid email or password.'}), 401
            
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        return jsonify({'success': False, 'message': 'Server error.'}), 500

# API endpoint for signup
@auth.route('/api/signup', methods=['POST'])
def api_signup():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')
    first_name = data.get('firstName')
    company_name = data.get('companyName')
    
    # Validate input
    if not all([email, password, first_name, company_name]):
        return jsonify({'success': False, 'error': 'All fields are required'}), 400
    
    # Check if user exists in Supabase
    auth_service = SupabaseAuthService()
    if auth_service.get_user_by_email(email):
        return jsonify({'success': False, 'error': 'User already exists'}), 409
    
    try:
        # Create user in Supabase
        business_uuid = auth_service.ensure_business_uuid(company_name)

        user_data = {
            'email': email,
            'password': generate_password_hash(password),
            'first_name': first_name,
            'company_name': company_name,
            'business_uuid': business_uuid,
            'business_id': business_uuid,
            'role': 'user',
            'status': 'active',
            'created_at': 'now()',
            'updated_at': 'now()'
        }
        
        new_user_data = auth_service.create_user(user_data)
        if not new_user_data:
            return jsonify({'success': False, 'error': 'Failed to create user in Supabase'}), 500
        
        # Create User object for Flask-Login
        business_uuid = new_user_data.get('business_uuid')
        if not business_uuid:
            business_uuid = auth_service.ensure_business_uuid(company_name)
            auth_service.update_user(new_user_data['id'], {'business_uuid': business_uuid})

        user = User()
        user.id = new_user_data['id']
        user.email = new_user_data['email']
        user.first_name = new_user_data['first_name']
        user.company_name = new_user_data['company_name']
        user.company_website = new_user_data.get('company_website')
        user.role = UserRole.USER
        user.status = UserStatus.ACTIVE
        user.business_id = UUID(business_uuid) if business_uuid else None
        
        # Automatically log in the user after successful signup
        login_user(user, remember=True)
        logger.info(f"User {email} signed up and automatically logged in")
        
        return jsonify({
            'success': True,
            'message': 'Account created successfully'
        }), 201
        
    except Exception as e:
        logger.error(f"Error creating user: {e}")
        return jsonify({
            'success': False,
            'error': 'Failed to create account. Please try again.'
        }), 500

@auth.route('/logout', methods=['GET', 'POST'])
@login_required
def logout():
    logout_user()
    return redirect(url_for('auth.login'))


@auth.route('/sign-up', methods=['GET', 'POST'])
def sign_up():
    if request.method == "POST":
        email = request.form.get("email")
        first_name = request.form.get("first_name")
        password1 = request.form.get("password1")
        password2 = request.form.get("password2")
        company_name = request.form.get("company_name")
        company_website = request.form.get("company_website")
        special_characters = ['!@#$%^&*()_+-=[]{}|;:,.<>?']
        user = User.query.filter_by(email=email).first()
        if user:
            flash('Email already exists.', category="error")
        elif len(email) < 4:
            flash("The email must be greater than 3 characters.", category="error")
        elif len(first_name) < 2:
            flash("Your name must be greater than 1 character.", category="error")
        elif password1 != password2:
            flash("The passwords do not match", category="error")
        elif len(password1) < 7:
            flash("The password must be atleast 7 characters long.", category="error")
        else:
            new_user = User(
                email=email, 
                first_name=first_name, 
                password=generate_password_hash(password1, method='pbkdf2:sha256'),
                company_name=company_name,
                company_website=company_website,
                business_id=uuid4()
            )
            db.session.add(new_user)
            db.session.commit()
            login_user(new_user, remember=True)
            flash("Account created successfully!", category="success")
            return redirect(url_for('views.home'))
        
    return render_template("signup.html", user=current_user)

# API endpoint for React signup
@auth.route('/api/sign-up', methods=['POST'])
def api_sign_up():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'message': 'No data provided'}), 400
            
        email = data.get('email')
        first_name = data.get('first_name')
        password1 = data.get('password1')
        password2 = data.get('password2')
        company_name = data.get('company_name')
        company_website = data.get('company_website')
        
        # Debug logging
        logger.info(f"New user signup: {email}")
        
    except Exception as e:
        print(f"Error parsing signup data: {str(e)}")
        return jsonify({'success': False, 'message': f'Error parsing request: {str(e)}'}), 400
    user = User.query.filter_by(email=email).first()
    if user:
        return jsonify({'success': False, 'message': 'Email already exists.'}), 400
    elif len(email) < 4:
        return jsonify({'success': False, 'message': 'The email must be greater than 3 characters.'}), 400
    elif len(first_name) < 2:
        return jsonify({'success': False, 'message': 'Your name must be greater than 1 character.'}), 400
    elif password1 != password2:
        return jsonify({'success': False, 'message': 'The passwords do not match.'}), 400
    elif len(password1) < 7:
        return jsonify({'success': False, 'message': 'The password must be at least 7 characters long.'}), 400
    else:
        new_user = User(
            email=email, 
            first_name=first_name, 
            password=generate_password_hash(password1, method='pbkdf2:sha256'),
            company_name=company_name,
            company_website=company_website,
            role=UserRole.USER,
            status=UserStatus.ACTIVE,
            business_id=uuid4()
        )
        try:
            db.session.add(new_user)
            db.session.commit()
            login_user(new_user, remember=True)
            return jsonify({'success': True, 'message': 'Account created successfully!'}), 200
        except Exception as e:
            db.session.rollback()
            return jsonify({'success': False, 'message': f'Error creating account: {str(e)}'}), 500


# Simple web interface routes for testing
@auth.route('/web/login', methods=['GET', 'POST'])
def web_login():
    """Simple web login page"""
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        
        user = User.query.filter_by(email=email).first()
        if user:
            if check_password_hash(user.password, password):
                login_user(user, remember=True)
                flash('Logged in successfully!', category='success')
                # Redirect to admin panel if admin, otherwise to dashboard
                if user.role == UserRole.ADMIN:
                    return redirect(url_for('admin.admin_panel'))
                else:
                    return redirect(url_for('views.api_dashboard'))
            else:
                flash('Incorrect password, try again.', category='error')
        else:
            flash('Email does not exist.', category='error')
    
    return render_template('web_login.html', user=current_user)


@auth.route('/web/signup', methods=['GET', 'POST'])
def web_signup():
    """Simple web signup page"""
    if request.method == 'POST':
        email = request.form.get('email')
        first_name = request.form.get('first_name')
        password1 = request.form.get('password1')
        password2 = request.form.get('password2')
        company_name = request.form.get('company_name', '')
        
        user = User.query.filter_by(email=email).first()
        if user:
            flash('Email already exists.', category='error')
        elif len(email) < 4:
            flash('Email must be greater than 3 characters.', category='error')
        elif len(first_name) < 2:
            flash('Name must be greater than 1 character.', category='error')
        elif password1 != password2:
            flash('Passwords do not match', category='error')
        elif len(password1) < 7:
            flash('Password must be at least 7 characters long.', category='error')
        else:
            new_user = User(
                email=email, 
                first_name=first_name, 
                password=generate_password_hash(password1, method='pbkdf2:sha256'),
                company_name=company_name,
                role=UserRole.USER,
                status=UserStatus.ACTIVE,
                business_id=uuid4()
            )
            db.session.add(new_user)
            db.session.commit()
            login_user(new_user, remember=True)
            flash('Account created successfully!', category='success')
            return redirect(url_for('views.api_dashboard'))
    
    return render_template('web_signup.html', user=current_user)



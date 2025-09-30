from flask import Blueprint, request, jsonify, render_template, flash, redirect, url_for
from flask_login import login_required, current_user
from .models import User, UserRole, UserStatus
from .decorators import admin_required
from . import db
import secrets
from datetime import datetime, timedelta, timezone

admin = Blueprint('admin', __name__)


@admin.route('/api/admin/invite-user', methods=['POST'])
@login_required
@admin_required
def invite_user():
    data = request.get_json()
    email = data.get('email')
    company_name = data.get('company_name')

    if not email or not company_name:
        return jsonify({'error': 'Email and company name are required'}), 400

    existing_user = User.query.filter_by(email=email).first()
    if existing_user:
        return jsonify({'error': 'A user with this email already exists'}), 409

    # Create the new user record
    new_user = User(
        email=email,
        company_name=company_name,
        status=UserStatus.INVITED,
        invitation_token=secrets.token_urlsafe(32),
        invitation_token_expires=datetime.now(timezone.utc) + timedelta(hours=72)
    )

    db.session.add(new_user)
    db.session.commit()

    # For now, we return the link for testing.
    # Later, this will be replaced with an email-sending service like twilio, sendgrid or mailgun.
    registration_link = f"http://localhost:3000/register/{new_user.invitation_token}"

    return jsonify({
        'success': True,
        'message': f'Invitation created for {email}.',
        'registration_link': registration_link # For testing purposes
    }), 201


# Admin Panel Routes
@admin.route('/admin', methods=['GET'])
@login_required
@admin_required
def admin_panel():
    """Admin panel dashboard"""
    users = User.query.all()
    return render_template('admin_panel.html', users=users, current_user=current_user)


@admin.route('/admin/users', methods=['GET'])
@login_required
@admin_required
def admin_users():
    """Get all users for admin panel"""
    users = User.query.all()
    users_data = []
    for user in users:
        users_data.append({
            'id': user.id,
            'email': user.email,
            'first_name': user.first_name,
            'company_name': user.company_name,
            'role': user.role.name if user.role else 'USER',
            'status': user.status.name if user.status else 'INVITED',
            'created_at': user.id  # Using ID as proxy for creation time
        })
    return jsonify(users_data)


@admin.route('/admin/create-user', methods=['POST'])
@login_required
@admin_required
def admin_create_user():
    """Create a new user directly from admin panel"""
    data = request.get_json()
    email = data.get('email')
    first_name = data.get('first_name', '')
    company_name = data.get('company_name', '')
    password = data.get('password')
    role = data.get('role', 'USER')
    
    if not email or not password:
        return jsonify({'success': False, 'message': 'Email and password are required'}), 400
    
    # Check if user already exists
    existing_user = User.query.filter_by(email=email).first()
    if existing_user:
        return jsonify({'success': False, 'message': 'User with this email already exists'}), 400
    
    # Create new user
    from werkzeug.security import generate_password_hash
    new_user = User(
        email=email,
        first_name=first_name,
        company_name=company_name,
        password=generate_password_hash(password, method='pbkdf2:sha256'),
        role=UserRole.ADMIN if role == 'ADMIN' else UserRole.USER,
        status=UserStatus.ACTIVE
    )
    
    try:
        db.session.add(new_user)
        db.session.commit()
        return jsonify({'success': True, 'message': f'User {email} created successfully'}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Error creating user: {str(e)}'}), 500


@admin.route('/admin/make-admin', methods=['POST'])
@login_required
@admin_required
def admin_make_admin():
    """Make a user an admin"""
    data = request.get_json()
    user_id = data.get('user_id')
    
    if not user_id:
        return jsonify({'success': False, 'message': 'User ID is required'}), 400
    
    user = User.query.get(user_id)
    if not user:
        return jsonify({'success': False, 'message': 'User not found'}), 404
    
    user.role = UserRole.ADMIN
    try:
        db.session.commit()
        return jsonify({'success': True, 'message': f'{user.email} is now an admin'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Error updating user: {str(e)}'}), 500


@admin.route('/admin/delete-user', methods=['POST'])
@login_required
@admin_required
def admin_delete_user():
    """Delete a user"""
    data = request.get_json()
    user_id = data.get('user_id')
    
    if not user_id:
        return jsonify({'success': False, 'message': 'User ID is required'}), 400
    
    # Prevent deleting yourself
    if user_id == current_user.id:
        return jsonify({'success': False, 'message': 'Cannot delete your own account'}), 400
    
    user = User.query.get(user_id)
    if not user:
        return jsonify({'success': False, 'message': 'User not found'}), 404
    
    try:
        db.session.delete(user)
        db.session.commit()
        return jsonify({'success': True, 'message': f'User {user.email} deleted successfully'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': f'Error deleting user: {str(e)}'}), 500
from flask import Blueprint, request, jsonify
from flask_login import login_required
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
    # Later, this will be replaced with an email-sending service.
    registration_link = f"http://localhost:3000/register/{new_user.invitation_token}"

    return jsonify({
        'success': True,
        'message': f'Invitation created for {email}.',
        'registration_link': registration_link # For testing purposes
    }), 201 
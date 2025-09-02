from functools import wraps
from flask import jsonify
from flask_login import current_user
from .models import UserRole

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated:
            return jsonify({'error': 'Authentication required'}), 401
            
        if current_user.role != UserRole.ADMIN:
            return jsonify({'error': 'Admin access required'}), 403
            
        return f(*args, **kwargs)
    return decorated_function 
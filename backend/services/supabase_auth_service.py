import os
from supabase import create_client
from werkzeug.security import check_password_hash
import logging

logger = logging.getLogger(__name__)

class SupabaseAuthService:
    """Authentication service using Supabase as primary database"""
    
    def __init__(self):
        self.supabase = create_client(
            os.environ['SUPABASE_URL'],
            os.environ['SUPABASE_SERVICE_KEY']
        )
    
    def get_user_by_email(self, email):
        """Get user by email from Supabase"""
        try:
            result = self.supabase.table('users').select('*').eq('email', email).execute()
            if result.data:
                return result.data[0]
            return None
        except Exception as e:
            logger.error(f"Error fetching user from Supabase: {e}")
            return None
    
    def get_user_by_id(self, user_id):
        """Get user by ID from Supabase"""
        try:
            result = self.supabase.table('users').select('*').eq('id', user_id).execute()
            if result.data:
                return result.data[0]
            return None
        except Exception as e:
            logger.error(f"Error fetching user by ID from Supabase: {e}")
            return None
    
    def verify_password(self, user, password):
        """Verify user password"""
        if user and user.get('password'):
            return check_password_hash(user['password'], password)
        return False
    
    def create_user(self, user_data):
        """Create a new user in Supabase"""
        try:
            result = self.supabase.table('users').insert(user_data).execute()
            if result.data:
                return result.data[0]
            return None
        except Exception as e:
            logger.error(f"Error creating user in Supabase: {e}")
            return None
    
    def update_user(self, user_id, user_data):
        """Update user in Supabase"""
        try:
            result = self.supabase.table('users').update(user_data).eq('id', user_id).execute()
            if result.data:
                return result.data[0]
            return None
        except Exception as e:
            logger.error(f"Error updating user in Supabase: {e}")
            return None

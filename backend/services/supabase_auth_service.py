import os
from supabase import create_client
from werkzeug.security import check_password_hash
import logging
import uuid

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

    # Business mapping helpers -------------------------------------------------
    def get_business_uuid(self, legacy_id: str) -> str | None:
        """Lookup business UUID from mapping table."""
        if not legacy_id:
            return None
        try:
            result = (
                self.supabase
                .table('business_id_map')
                .select('uuid_id')
                .eq('legacy_id', legacy_id)
                .limit(1)
                .execute()
            )
            if result.data:
                return result.data[0]['uuid_id']
        except Exception as e:
            logger.error(f"Error fetching business UUID for {legacy_id}: {e}")
        return None

    def ensure_business_uuid(self, legacy_id: str) -> str:
        """Get or create a business UUID for the given legacy identifier."""
        existing = self.get_business_uuid(legacy_id)
        if existing:
            return existing

        new_uuid = str(uuid.uuid4())
        try:
            self.supabase.table('business_id_map').insert({
                'legacy_id': legacy_id,
                'uuid_id': new_uuid
            }).execute()
            return new_uuid
        except Exception as e:
            logger.error(f"Error creating business UUID for {legacy_id}: {e}")
            return new_uuid

from werkzeug.security import check_password_hash
import logging
import uuid
import os
import time
from datetime import datetime, timedelta
from typing import Optional, Tuple
import httpx

from .supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)

# In-memory cache for business UUID lookups (TTL: 5 minutes)
# Format: {legacy_id: (uuid, timestamp)}
_business_uuid_cache: dict[str, Tuple[str, datetime]] = {}
_cache_ttl = timedelta(minutes=5)


class SupabaseAuthService:
    """Authentication service using Supabase as primary database"""
    
    def __init__(self):
        # #region agent log
        import json, time
        try:
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"A","location":"supabase_auth_service.py:21","message":"SupabaseAuthService.__init__ entry","data":{},"timestamp":int(time.time()*1000)}) + '\n')
        except: pass
        # #endregion
        self.supabase = get_supabase_client()
        # #region agent log
        try:
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"A","location":"supabase_auth_service.py:23","message":"SupabaseAuthService.__init__ exit","data":{"client_type":type(self.supabase).__name__},"timestamp":int(time.time()*1000)}) + '\n')
        except: pass
        # #endregion
    
    def get_user_by_email(self, email):
        """Get user by email from Supabase with retry logic for timeout errors
        
        Returns:
            dict: User data if found
            None: User not found or other error
        Raises:
            TimeoutError: If database connection times out after all retries
            Exception: For other database errors
        """
        # #region agent log
        import json, time
        query_start = time.time()
        try:
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({"sessionId":"debug-session","runId":"post-fix","hypothesisId":"E","location":"supabase_auth_service.py:35","message":"get_user_by_email entry","data":{"email":email},"timestamp":int(time.time()*1000)}) + '\n')
        except: pass
        # #endregion
        
        max_retries = 2
        retry_delay = 1.0
        
        for attempt in range(max_retries):
            try:
                # #region agent log
                try:
                    with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                        f.write(json.dumps({"sessionId":"debug-session","runId":"post-fix","hypothesisId":"E","location":"supabase_auth_service.py:45","message":"Before Supabase query","data":{"attempt":attempt+1,"max_retries":max_retries},"timestamp":int(time.time()*1000)}) + '\n')
                except: pass
                # #endregion
                start_time = time.time()
                # Optimize query: only select needed fields and limit to 1 result
                result = self.supabase.table('users').select('id,email,password,first_name,company_name,company_website,role,status,business_id,business_uuid').eq('email', email).limit(1).execute()
                elapsed = time.time() - start_time
                # #region agent log
                try:
                    with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                        f.write(json.dumps({"sessionId":"debug-session","runId":"post-fix","hypothesisId":"E","location":"supabase_auth_service.py:50","message":"After Supabase query","data":{"elapsed_seconds":elapsed,"has_data":result.data is not None,"data_length":len(result.data) if result.data else 0,"attempt":attempt+1},"timestamp":int(time.time()*1000)}) + '\n')
                except: pass
                # #endregion
                logger.debug(f"Supabase query for {email} took {elapsed:.2f}s (attempt {attempt + 1})")
                
                if result.data:
                    # #region agent log
                    try:
                        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                            f.write(json.dumps({"sessionId":"debug-session","runId":"post-fix","hypothesisId":"E","location":"supabase_auth_service.py:58","message":"get_user_by_email success","data":{"attempt":attempt+1},"timestamp":int(time.time()*1000)}) + '\n')
                    except: pass
                    # #endregion
                    return result.data[0]
                # #region agent log
                try:
                    with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                        f.write(json.dumps({"sessionId":"debug-session","runId":"post-fix","hypothesisId":"E","location":"supabase_auth_service.py:63","message":"get_user_by_email no data","data":{"attempt":attempt+1},"timestamp":int(time.time()*1000)}) + '\n')
                except: pass
                # #endregion
                return None
            except Exception as e:
                error_msg = str(e)
                elapsed_total = time.time() - query_start
                is_timeout = (
                    'timeout' in error_msg.lower() or 
                    'timed out' in error_msg.lower() or
                    isinstance(e, (TimeoutError, httpx.ReadTimeout, httpx.ConnectTimeout)) or
                    'ReadTimeout' in type(e).__name__ or
                    'ConnectTimeout' in type(e).__name__
                )
                
                # #region agent log
                try:
                    with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                        f.write(json.dumps({"sessionId":"debug-session","runId":"post-fix","hypothesisId":"E","location":"supabase_auth_service.py:75","message":"get_user_by_email exception","data":{"error_type":type(e).__name__,"error_msg":error_msg[:200],"elapsed_seconds":elapsed_total,"is_timeout":is_timeout,"attempt":attempt+1,"max_retries":max_retries},"timestamp":int(time.time()*1000)}) + '\n')
                except: pass
                # #endregion
                
                # Retry on timeout errors
                if is_timeout and attempt < max_retries - 1:
                    logger.warning(f"⚠️ Supabase timeout for {email} (attempt {attempt + 1}/{max_retries}), retrying in {retry_delay}s...")
                    # #region agent log
                    try:
                        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                            f.write(json.dumps({"sessionId":"debug-session","runId":"post-fix","hypothesisId":"E","location":"supabase_auth_service.py:82","message":"Retrying after timeout","data":{"retry_delay":retry_delay,"next_attempt":attempt+2},"timestamp":int(time.time()*1000)}) + '\n')
                    except: pass
                    # #endregion
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                    continue
                
                # Log timeout errors specifically
                if is_timeout:
                    logger.error(f"❌ Supabase TIMEOUT fetching user {email} after {max_retries} attempts: {e}")
                    logger.error(f"   Query took {elapsed_total:.2f}s total")
                    raise TimeoutError(f"Database connection timeout after {max_retries} attempts: {e}") from e
                elif '401' in error_msg or 'unauthorized' in error_msg.lower():
                    logger.error(f"❌ Supabase AUTH ERROR for user {email}: {e}")
                    logger.error(f"   Check SUPABASE_SERVICE_KEY in .env file")
                    raise Exception(f"Database authentication error: {e}") from e
                else:
                    logger.error(f"❌ Error fetching user from Supabase: {e}")
                    raise
    
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
        """
        Lookup business UUID from mapping table with in-memory TTL cache.
        
        Cache TTL: 5 minutes (configurable via _cache_ttl)
        This eliminates 55s hangs on connection errors and reduces database load.
        """
        if not legacy_id:
            return None
        
        # Check cache first
        enable_cache = os.getenv("ENABLE_BUSINESS_UUID_CACHE", "true").lower() == "true"
        if enable_cache:
            cache_key = legacy_id
            if cache_key in _business_uuid_cache:
                cached_uuid, timestamp = _business_uuid_cache[cache_key]
                if datetime.now() - timestamp < _cache_ttl:
                    logger.debug(f"[CACHE_HIT] Business UUID for {legacy_id[:8]}...")
                    return cached_uuid
                else:
                    # Cache expired, remove it
                    del _business_uuid_cache[cache_key]
        
        # Cache miss or disabled - fetch from database
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
                uuid_value = result.data[0]['uuid_id']
                # Store in cache
                if enable_cache:
                    _business_uuid_cache[legacy_id] = (uuid_value, datetime.now())
                    logger.debug(f"[CACHE_MISS] Business UUID for {legacy_id[:8]}... cached")
                return uuid_value
        except Exception as e:
            logger.error(f"Error fetching business UUID for {legacy_id}: {e}")
        return None

    def ensure_business_uuid(self, legacy_id: str) -> str:
        """
        Get or create a business UUID for the given legacy identifier.
        Updates cache when creating new UUID.
        """
        existing = self.get_business_uuid(legacy_id)
        if existing:
            return existing

        new_uuid = str(uuid.uuid4())
        try:
            self.supabase.table('business_id_map').insert({
                'legacy_id': legacy_id,
                'uuid_id': new_uuid
            }).execute()
            # Cache the new UUID
            enable_cache = os.getenv("ENABLE_BUSINESS_UUID_CACHE", "true").lower() == "true"
            if enable_cache:
                _business_uuid_cache[legacy_id] = (new_uuid, datetime.now())
            return new_uuid
        except Exception as e:
            logger.error(f"Error creating business UUID for {legacy_id}: {e}")
            return new_uuid

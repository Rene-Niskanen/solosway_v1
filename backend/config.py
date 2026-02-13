import os
from datetime import timedelta

class Config:
    """Base configuration class"""
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'a-very-secret-key'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # Use Supabase PostgreSQL connection (same function as LangGraph checkpointer)
    @staticmethod
    def _get_database_uri() -> str:
        """Get Supabase PostgreSQL URI for SQLAlchemy using SUPABASE_DB_URL"""
        from backend.services.supabase_client_factory import get_supabase_db_url
        return get_supabase_db_url()
    
    SQLALCHEMY_DATABASE_URI = _get_database_uri()
    
    # SQLAlchemy connection pool settings optimized for Supabase Pro tier transaction pooler
    # Transaction mode pooler (port 6543) supports ~500+ connections on Pro tier
    # This pool is SHARED across all users/requests, so it needs to handle high concurrency
    # 
    # Capacity planning for multiple accounts/users:
    # - 25 base connections + 25 overflow = 50 total SQLAlchemy connections
    # - Supports ~100-150 concurrent users (each user typically uses 1 connection per request)
    # - Leaves ~450 connections available for checkpointer pools (per-request, temporary)
    # - Checkpointer pools are short-lived (released when request completes)
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_size': 25,  # Base pool size - handles ~100 concurrent users
        'max_overflow': 25,  # Overflow for traffic spikes - total 50 connections
        'pool_timeout': 30,  # Timeout when getting connection (seconds)
        'pool_recycle': 3600,  # Recycle connections after 1 hour (prevents stale connections)
        'pool_pre_ping': True,  # Check connections before using (validates connection is alive)
    }
    
    # CORS settings (add your deployed frontend origins e.g. https://app.veloraview.com)
    CORS_ORIGINS = [
        'http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080',
        'http://localhost:8081', 'http://localhost:8083', 'http://localhost:5002',
        'https://veloraview.com', 'https://www.veloraview.com',
        'https://app.veloraview.com', 'https://dev.veloraview.com',
        'https://your-frontend-domain.com'
    ]
    
    # Session configuration
    PERMANENT_SESSION_LIFETIME = timedelta(days=7)
    
    # File upload settings
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB max file size

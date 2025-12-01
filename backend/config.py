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
    
    # SQLAlchemy connection pool settings to prevent connection exhaustion
    # Important: Limits SQLAlchemy connections to avoid hitting Supabase pool limits
    # Transaction mode pooler supports ~200 connections (free tier) or ~500+ (Pro tier)
    # Session mode pooler supports ~15 connections (free tier) or ~100-200 (Pro tier)
    # Recommended: Use Transaction mode (port 6543) for better connection limits
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_size': 2,  # Maximum connections in pool (reduced to leave room for LangGraph)
        'max_overflow': 2,  # Additional connections when pool is exhausted
        'pool_timeout': 30,  # Timeout when getting connection (seconds)
        'pool_recycle': 3600,  # Recycle connections after 1 hour (prevents stale connections)
        'pool_pre_ping': True,  # Check connections before using (validates connection is alive)
    }
    
    # CORS settings
    CORS_ORIGINS = ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080', 'http://localhost:8081', 'http://localhost:8083', 'http://localhost:5002', 'https://your-frontend-domain.com']
    
    # Session configuration
    PERMANENT_SESSION_LIFETIME = timedelta(days=7)
    
    # File upload settings
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB max file size

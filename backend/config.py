import os
from datetime import timedelta

class Config:
    """Base configuration class"""
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'a-very-secret-key'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # This will be set in __init__.py after dotenv has loaded
    SQLALCHEMY_DATABASE_URI = None 
    
    # CORS settings
    CORS_ORIGINS = ['http://localhost:3000', 'https://your-frontend-domain.com']
    
    # Session configuration
    PERMANENT_SESSION_LIFETIME = timedelta(days=7)
    
    # File upload settings
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB max file size

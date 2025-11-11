from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from os import path
from flask_login import LoginManager
from dotenv import load_dotenv
import os
import logging
# flask_migrate removed - using Supabase for schema management
from flask_cors import CORS
from .config import Config
from .celery_utils import celery_init_app

logger = logging.getLogger(__name__)


# Create the database connection
db = SQLAlchemy()

def create_app():
    load_dotenv() # Load environment variables from .env file

    app = Flask(__name__, template_folder='../frontend/public')
    app.config['SECRET_KEY'] = 'hjshjhdjah kjshkjdhjs'
    
    # Ensure the DATABASE_URL is loaded correctly
    database_url = os.environ.get('DATABASE_URL')
    if not database_url:
        raise ValueError("No DATABASE_URL set for Flask application")
    
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    
    # Session cookie configuration for cross-origin requests
    app.config['SESSION_COOKIE_SAMESITE'] = 'None'
    app.config['SESSION_COOKIE_SECURE'] = False  # Set to True if using HTTPS
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['PERMANENT_SESSION_LIFETIME'] = Config.PERMANENT_SESSION_LIFETIME
    
    # Celery Configuration
    redis_url = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
    app.config.from_mapping(
        CELERY=dict(
            broker_url=redis_url,
            result_backend=redis_url,
            task_ignore_result=True,
        ),
    )
    
    # Initialize extensions
    db.init_app(app)
    
    # Celery initialization
    celery_app = celery_init_app(app)
    
    # Make celery_app available globally for worker
    app.celery_app = celery_app

    # Enable CORS for React frontend with explicit methods
    CORS(app, 
         resources={r"/api/*": {"origins": Config.CORS_ORIGINS}},
         supports_credentials=True,
         methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
         allow_headers=['Content-Type', 'Authorization'])

    login_manager = LoginManager()
    login_manager.login_view = 'auth.login'
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(id):
        """Load user from Supabase (not PostgreSQL)"""
        try:
            from .services.supabase_auth_service import SupabaseAuthService
            auth_service = SupabaseAuthService()
            user_data = auth_service.get_user_by_id(id)
            
            if user_data:
                # Create User object from Supabase data
                from .models import User, UserRole, UserStatus
                user = User()
                user.id = user_data['id']
                user.email = user_data['email']
                user.first_name = user_data.get('first_name', '')
                user.company_name = user_data.get('company_name', '')
                user.company_website = user_data.get('company_website', '')
                user.role = UserRole.ADMIN if user_data.get('role') == 'admin' else UserRole.USER
                user.status = UserStatus.ACTIVE if user_data.get('status') == 'active' else UserStatus.INVITED
                return user
            return None
        except Exception as e:
            logger.error(f"Error loading user {id}: {e}")
            return None

    from .views import views
    from .auth import auth

    app.register_blueprint(auth, url_prefix='/')
    app.register_blueprint(views, url_prefix='/')

    from .admin import admin
    app.register_blueprint(admin, url_prefix='/')


    from .models import User, Document
    
    # Import tasks to register them with Celery
    from . import tasks
    
    with app.app_context():
        # Database schema managed by Supabase
        pass

    return app

def create_database(app):
    # Database tables are managed by Supabase schema
    pass



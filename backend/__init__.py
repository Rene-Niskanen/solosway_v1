from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from os import path
from flask_login import LoginManager
from dotenv import load_dotenv
import os
import logging
# flask_migrate removed - using Supabase for schema management
from flask_cors import CORS

# Load .env from project root before Config (which reads SUPABASE_DB_URL etc.)
_load_env_path = path.abspath(path.join(path.dirname(__file__), "..", ".env"))
load_dotenv(_load_env_path)
# If EXTRACTION_SERVICE_URL still missing, try .env in cwd (e.g. when running from project root)
if not os.environ.get("EXTRACTION_SERVICE_URL"):
    load_dotenv(path.join(os.getcwd(), ".env"))

# Ensure EXTRACTION_SERVICE_URL is set from .env file if missing (load_dotenv can miss it if var was set empty)
def _read_env_key(env_path, key):
    if not path.isfile(env_path):
        return None
    try:
        with open(env_path, "r", encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                if k.strip() != key:
                    continue
                v = v.strip().strip("'\"").strip()
                if " #" in v:
                    v = v.split(" #")[0].strip()
                if v:
                    return v.rstrip("/")
    except Exception:
        pass
    return None

if not (os.environ.get("EXTRACTION_SERVICE_URL") or "").strip():
    for env_file in (_load_env_path, path.join(os.getcwd(), ".env")):
        val = _read_env_key(env_file, "EXTRACTION_SERVICE_URL")
        if val:
            os.environ["EXTRACTION_SERVICE_URL"] = val
            logging.info("EXTRACTION_SERVICE_URL set from %s", env_file)
            break

# Log extraction URL status at startup so it's visible in console (logging may not be configured yet)
_EXTRACTION_URL = (os.environ.get("EXTRACTION_SERVICE_URL") or "").strip()
if not _EXTRACTION_URL:
    print(
        "[BACKEND] EXTRACTION_SERVICE_URL is NOT SET — quick-extract (PDF/PPTX/XLSX) will return 400. "
        "Add EXTRACTION_SERVICE_URL=http://localhost:5002 to project root .env and restart."
    )
    logging.warning(
        "EXTRACTION_SERVICE_URL is not set. Document extraction (PDF/PPTX/XLSX) will fail. "
        "Add EXTRACTION_SERVICE_URL=http://localhost:5002 to the project root .env and restart the backend."
    )
else:
    print(f"[BACKEND] EXTRACTION_SERVICE_URL is set: {_EXTRACTION_URL}")
    logging.info("EXTRACTION_SERVICE_URL is set (doc-extraction Node service will be used for quick-extract).")

from .config import Config
from .celery_utils import celery_init_app

logger = logging.getLogger(__name__)


# Create the database connection
db = SQLAlchemy()

def create_app():
    load_dotenv() # Load environment variables from .env file

    app = Flask(__name__, template_folder='../frontend/public')
    app.config['SECRET_KEY'] = 'hjshjhdjah kjshkjdhjs'
    
    # CRITICAL: Prevent Flask debug mode from showing HTML error pages for API routes
    # This ensures our JSON error handlers are used instead
    app.config['PROPAGATE_EXCEPTIONS'] = True
    
    # Use Supabase PostgreSQL connection (via Config class)
    # Uses SUPABASE_DB_URL environment variable (same as LangGraph checkpointer)
    # Recommended connection modes:
    # - Transaction mode (port 6543): ~200 connections free tier, ~500+ Pro tier - BEST for production
    # - Session mode (port 5432): ~15 connections free tier, ~100-200 Pro tier
    # - Direct connection: ~60 connections free tier, ~200+ Pro tier
    app.config['SQLALCHEMY_DATABASE_URI'] = Config.SQLALCHEMY_DATABASE_URI
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    
    # Apply SQLAlchemy pool size limits to prevent connection exhaustion
    if hasattr(Config, 'SQLALCHEMY_ENGINE_OPTIONS'):
        app.config['SQLALCHEMY_ENGINE_OPTIONS'] = Config.SQLALCHEMY_ENGINE_OPTIONS
    
    # Session cookie configuration for cross-origin requests
    # For localhost (HTTP), use Lax instead of None to avoid Secure requirement
    # In production (HTTPS), use None with Secure=True
    is_production = os.environ.get('FLASK_ENV') == 'production' or os.environ.get('ENVIRONMENT') == 'production'
    if is_production:
        app.config['SESSION_COOKIE_SAMESITE'] = 'None'
        app.config['SESSION_COOKIE_SECURE'] = True  # Required for SameSite=None
    else:
        app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'  # Works for localhost without Secure
        app.config['SESSION_COOKIE_SECURE'] = False
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

    # Single source of truth for Node doc-extraction service (quick_extract uses this for POST {url}/extract).
    # Port 5002 is reserved for doc-extraction; do not run the embedding server on 5002.
    app.config['EXTRACTION_SERVICE_URL'] = (os.environ.get('EXTRACTION_SERVICE_URL') or '').strip().rstrip('/')

    # Optional startup check: warn if extraction URL is set but service is not reachable (do not block startup)
    _url = app.config['EXTRACTION_SERVICE_URL']
    if _url:
        try:
            import requests
            r = requests.get(f"{_url.rstrip('/')}/health", timeout=2)
            if r.status_code != 200:
                logging.warning(
                    "EXTRACTION_SERVICE_URL is set but extraction service returned %s; quick-extract may fail.",
                    r.status_code,
                )
        except Exception as e:
            logging.warning(
                "EXTRACTION_SERVICE_URL is set but extraction service is not reachable: %s; quick-extract may fail.",
                e,
            )
    
    # Initialize extensions
    db.init_app(app)
    
    # Celery initialization
    celery_app = celery_init_app(app)
    
    # Make celery_app available globally for worker
    app.celery_app = celery_app

    # Enable CORS for React frontend with explicit methods
    # Configure CORS to handle all origins and methods explicitly
    CORS(app, 
         resources={r"/api/*": {
             "origins": Config.CORS_ORIGINS,
             "methods": ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
             "allow_headers": ['Content-Type', 'Authorization'],
             "supports_credentials": True
         }},
         supports_credentials=True,
         methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
         allow_headers=['Content-Type', 'Authorization'],
         expose_headers=['Content-Type'],
         max_age=3600)

    login_manager = LoginManager()
    login_manager.login_view = 'auth.login'
    login_manager.init_app(app)

    @login_manager.unauthorized_handler
    def unauthorized():
        """Handle unauthorized requests with CORS headers"""
        from flask import request, jsonify
        # CRITICAL: OPTIONS requests should be handled by Flask-CORS, not blocked by auth
        # Return None to let Flask-CORS handle OPTIONS preflight requests
        if request.method == 'OPTIONS':
            return None
        
        response = jsonify({
            'success': False,
            'error': 'Authentication required'
        })
        response.status_code = 401
        
        # CRITICAL: Add CORS headers for all origins in the allowed list
        # flask_cors might not catch this since it's called from login_required decorator
        origin = request.headers.get('Origin') if request else None
        if origin:
            # Check if origin is in allowed list
            if origin in Config.CORS_ORIGINS:
                response.headers['Access-Control-Allow-Origin'] = origin
                response.headers['Access-Control-Allow-Credentials'] = 'true'
                response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
                response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
                # Also add Vary header to indicate origin-based response
                # Include Cookie in Vary since we're using credentials
                response.headers['Vary'] = 'Origin, Cookie'
        
        return response

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

    # Request timing: log elapsed time per request for performance analysis
    import time
    import uuid

    @app.before_request
    def _request_timing_start():
        from flask import g
        g.request_start_time = time.perf_counter()
        g.request_id = uuid.uuid4().hex[:8]

    @app.after_request
    def _request_timing_log(response):
        from flask import g, request
        if hasattr(g, "request_start_time"):
            elapsed_ms = max(0, int(round((time.perf_counter() - g.request_start_time) * 1000)))
            request_id = getattr(g, "request_id", "")
            logger.info("[PERF] %s %s %s %d ms%s", request.method, request.path, response.status_code, elapsed_ms, f" request_id=%s" % request_id if request_id else "")
        return response

    # Add error handler to ensure CORS headers on all error responses
    # This catches exceptions that escape route-level error handling
    @app.errorhandler(500)
    def handle_500_error(e):
        """Ensure CORS headers on 500 errors - CRITICAL for CORS"""
        from flask import request, jsonify
        import traceback
        logger.error(f"500 error: {e}", exc_info=True)
        traceback.print_exc()
        
        # Create JSON error response (not HTML)
        response = jsonify({
            'success': False,
            'error': str(e) if e else 'Internal server error'
        })
        response.status_code = 500
        
        # CRITICAL: Add CORS headers - this is what the browser needs!
        # With supports_credentials=True, we cannot use '*' - must use specific origin
        try:
            origin = request.headers.get('Origin') if request else None
            if origin and origin in Config.CORS_ORIGINS:
                response.headers['Access-Control-Allow-Origin'] = origin
                response.headers['Access-Control-Allow-Credentials'] = 'true'
                response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
                response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
                response.headers['Vary'] = 'Origin, Cookie'
            else:
                # Even if origin not in list, add CORS headers if origin is present
                # This prevents CORS errors when debugging
                if origin:
                    response.headers['Access-Control-Allow-Origin'] = origin
                    response.headers['Access-Control-Allow-Credentials'] = 'true'
                    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
                    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
        except Exception as cors_error:
            logger.error(f"Error adding CORS headers in 500 handler: {cors_error}")
            # Still try to add basic CORS
            try:
                if request and hasattr(request, 'headers'):
                    origin = request.headers.get('Origin')
                    if origin:
                        response.headers['Access-Control-Allow-Origin'] = origin
                        response.headers['Access-Control-Allow-Credentials'] = 'true'
            except:
                pass
        
        return response


    from .models import User, Document
    
    # Import tasks to register them with Celery
    from . import tasks
    # Import celery tasks to register context generation tasks
    from . import celery_tasks
    
    with app.app_context():
        # Database schema managed by Supabase
        pass

    return app

def create_database(app):
    # Database tables are managed by Supabase schema
    pass



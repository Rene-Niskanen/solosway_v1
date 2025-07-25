from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from os import path
from flask_login import LoginManager
from dotenv import load_dotenv
import os
from flask_migrate import Migrate
from flask_cors import CORS
from .config import Config
from .celery_utils import celery_init_app


# Create the database connection
db = SQLAlchemy()
migrate = Migrate()

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
    migrate.init_app(app, db)
    
    # Celery initialization
    celery_init_app(app)

    # Enable CORS for React frontend
    CORS(app, origins=Config.CORS_ORIGINS, supports_credentials=True)

    login_manager = LoginManager()
    login_manager.login_view = 'auth.login'
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(id):
        # This function needs the User model, so we import it here to avoid circular imports.
        from .models import User
        return User.query.get(int(id))

    from .views import views
    from .auth import auth

    app.register_blueprint(auth, url_prefix='/')
    app.register_blueprint(views, url_prefix='/')

    from .admin import admin
    app.register_blueprint(admin, url_prefix='/')


    from .models import User, Appraisal, ComparableProperty, ChatMessage, PropertyData, Document
    with app.app_context():
        # db.create_all() is now handled by flask db migrate
        pass

    return app

def create_database(app):
    # This function is deprecated in favor of using Flask-Migrate.
    # The database tables are now created and managed via migration scripts.
    pass



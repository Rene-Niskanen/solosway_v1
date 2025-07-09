from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from os import path
from flask_login import LoginManager
from flask_migrate import Migrate
from flask_cors import CORS
from .config import get_config

# once the dataabse is created we can then use the db. whatever to input into the database 
db = SQLAlchemy()
migrate = Migrate()

def create_app():
    app = Flask(__name__)
    
    # Load configuration
    config = get_config()
    app.config.from_object(config)
    
    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)

    # Enable CORS for React frontend
    CORS(app, origins=config.CORS_ORIGINS, supports_credentials=True)

    login_manager = LoginManager()
    login_manager.login_view = 'auth.login'
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(id):
        return User.query.get(int(id))

    from .views import views
    from .auth import auth

    app.register_blueprint(auth, url_prefix='/')
    app.register_blueprint(views, url_prefix='/')

    from .models import User, Note, Appraisal, ComparableProperty, ChatMessage, PropertyData
    create_database(app)

    return app

def create_database(app):
    # Only create database if it doesn't exist (for SQLite)
    if app.config['SQLALCHEMY_DATABASE_URI'].startswith('sqlite:///'):
        db_path = app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', '')
        if not path.exists(db_path):
            with app.app_context():
                db.create_all()
                print('Created Database!')
    else:
        # For PostgreSQL, just ensure tables exist
        with app.app_context():
            db.create_all()
            print('Database tables ensured!')



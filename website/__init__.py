from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from os import path
from flask_login import LoginManager
from flask_migrate import Migrate

# once the dataabse is created we can then use the db. whatever to input into the database 
db = SQLAlchemy()
migrate = Migrate()

DB_name = 'database.db'

def create_app():
    app = Flask(__name__)
    app.config['SECRET_KEY'] = 'finrv3r3-efibv43-3f4cds'
    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{DB_name}'
    db.init_app(app)
    migrate.init_app(app, db)

    login_manager = LoginManager()
    login_manager.login_view = 'auth.login'
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(id):
        return User.query.get(int(id))

    from .views import views
    from .auth import auth

    app.register_blueprint(views, url_prefix='/')
    app.register_blueprint(auth, url_prefix='/')

    from .models import User, Note
    create_database(app)

    return app

def create_database(app):
    if not path.exists('website/' + DB_name):
        with app.app_context():
            db.create_all()
            print('Created Database!')



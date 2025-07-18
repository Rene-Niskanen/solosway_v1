from flask import Blueprint, render_template, request, flash, redirect, url_for, jsonify
from .models import User
from werkzeug.security import generate_password_hash, check_password_hash
from . import db
from flask_login import login_user, login_required, logout_user, current_user

auth = Blueprint('auth', __name__)


@auth.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        
        user = User.query.filter_by(email=email).first()
        if user:
            if check_password_hash(user.password, password):
                flash('Logged in successfully!', category='success')
                login_user(user, remember=True)
                return redirect(url_for('views.home'))
            else:
                flash('Incorrect password, try again.', category='error')
        else:
            flash('Email does not exist.', category='error')
            
    return render_template("login.html", user=current_user)

# API endpoint for React login
@auth.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')
    user = User.query.filter_by(email=email).first()
    if user and check_password_hash(user.password, password):
        login_user(user, remember=True)
        return jsonify({'success': True, 'message': 'Logged in successfully.'}), 200
    return jsonify({'success': False, 'message': 'Invalid email or password.'}), 401

@auth.route('/logout', methods=['GET', 'POST'])
@login_required
def logout():
    logout_user()
    return redirect(url_for('auth.login'))


@auth.route('/sign-up', methods=['GET', 'POST'])
def sign_up():
    if request.method == "POST":
        email = request.form.get("email")
        first_name = request.form.get("first_name")
        password1 = request.form.get("password1")
        password2 = request.form.get("password2")
        company_name = request.form.get("company_name")
        company_website = request.form.get("company_website")
        special_characters = ['!@#$%^&*()_+-=[]{}|;:,.<>?']
        user = User.query.filter_by(email=email).first()
        if user:
            flash('Email already exists.', category="error")
        elif len(email) < 4:
            flash("The email must be greater than 3 characters.", category="error")
        elif len(first_name) < 2:
            flash("Your name must be greater than 1 character.", category="error")
        elif password1 != password2:
            flash("The passwords do not match", category="error")
        elif len(password1) < 7:
            flash("The password must be atleast 7 characters long.", category="error")
        else:
            new_user = User(
                email=email, 
                first_name=first_name, 
                password=generate_password_hash(password1, method='pbkdf2:sha256'),
                company_name=company_name,
                company_website=company_website
            )
            db.session.add(new_user)
            db.session.commit()
            login_user(new_user, remember=True)
            flash("Account created successfully!", category="success")
            return redirect(url_for('views.home'))
        
    return render_template("signup.html", user=current_user)

# API endpoint for React signup
@auth.route('/api/sign-up', methods=['POST'])
def api_sign_up():
    data = request.get_json()
    email = data.get('email')
    first_name = data.get('first_name')
    password1 = data.get('password1')
    password2 = data.get('password2')
    company_name = data.get('company_name')
    company_website = data.get('company_website')
    user = User.query.filter_by(email=email).first()
    if user:
        return jsonify({'success': False, 'message': 'Email already exists.'}), 400
    elif len(email) < 4:
        return jsonify({'success': False, 'message': 'The email must be greater than 3 characters.'}), 400
    elif len(first_name) < 2:
        return jsonify({'success': False, 'message': 'Your name must be greater than 1 character.'}), 400
    elif password1 != password2:
        return jsonify({'success': False, 'message': 'The passwords do not match.'}), 400
    elif len(password1) < 7:
        return jsonify({'success': False, 'message': 'The password must be at least 7 characters long.'}), 400
    else:
        new_user = User(
            email=email, 
            first_name=first_name, 
            password=generate_password_hash(password1, method='pbkdf2:sha256'),
            company_name=company_name,
            company_website=company_website
        )
        db.session.add(new_user)
        db.session.commit()
        login_user(new_user, remember=True)
        return jsonify({'success': True, 'message': 'Account created successfully!'}), 200



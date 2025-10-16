#!/usr/bin/env python3
"""
Reset user password script
"""
import os
import sys
sys.path.append('/Users/reneniskanen/Documents/solosway_mvp')

from backend import create_app
from backend.models import User
from werkzeug.security import generate_password_hash

def reset_password():
    app = create_app()
    
    with app.app_context():
        # Find the user
        user = User.query.filter_by(email='reneniskanen03@gmail.com').first()
        
        if not user:
            print("❌ User not found")
            return
            
        # Reset password to something simple
        new_password = "password123"
        user.password = generate_password_hash(new_password)
        
        from backend import db
        db.session.commit()
        
        print(f"✅ Password reset for {user.email}")
        print(f"📧 Email: {user.email}")
        print(f"🔑 New password: {new_password}")
        print(f"🏢 Company: {user.company_name}")

if __name__ == "__main__":
    reset_password()

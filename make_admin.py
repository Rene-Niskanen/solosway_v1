import os
from backend import create_app, db
from backend.models import User, UserRole
from dotenv import load_dotenv

load_dotenv()

# --- IMPORTANT ---
# Change this to the email address of the user you want to make an admin.
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL")
# ---

app = create_app()

with app.app_context():
    user = User.query.filter_by(email=ADMIN_EMAIL).first()
    
    if user:
        print(f"Found user: {user.email} (Role: {user.role.name})")
        if user.role == UserRole.ADMIN:
            print("This user is already an admin.")
        else:
            user.role = UserRole.ADMIN
            db.session.commit()
            print(f"Successfully promoted {user.email} to ADMIN.")
    else:
        print(f"Error: Could not find a user with the email '{ADMIN_EMAIL}'.")
        print("Please make sure the user exists and the email is correct.") 
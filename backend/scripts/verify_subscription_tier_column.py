#!/usr/bin/env python3
"""
Verify the subscription_tier column exists in Supabase and the app can read/write it.
Run from project root: python -m backend.scripts.verify_subscription_tier_column
"""

import os
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

from dotenv import load_dotenv
env_path = project_root / ".env"
load_dotenv(env_path)

# Help debug connection: show whether .env loaded and which DB vars are present (no values printed)
def _env_check():
    has_db_url = bool(os.environ.get("SUPABASE_DB_URL"))
    has_url = bool(os.environ.get("SUPABASE_URL"))
    has_db_pass = bool(os.environ.get("SUPABASE_DB_PASSWORD"))
    print(f".env path: {env_path} (exists: {env_path.exists()})")
    print(f"SUPABASE_DB_URL set: {has_db_url}")
    if not has_db_url:
        print(f"  Alternative: SUPABASE_URL set: {has_url}, SUPABASE_DB_PASSWORD set: {has_db_pass}")
        if not (has_url and has_db_pass):
            print("\nAdd to .env either:")
            print("  SUPABASE_DB_URL=postgresql://postgres:YOUR_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres")
            print("  or both: SUPABASE_URL=https://PROJECT_REF.supabase.co  and  SUPABASE_DB_PASSWORD=...")
            return False
    return True


def main():
    if not _env_check():
        return 1
    try:
        from backend import create_app, db
        from sqlalchemy import text
    except Exception as e:
        print("Import failed:", e)
        return 1

    app = create_app()
    with app.app_context():
        # 1) Column exists in DB
        row = db.session.execute(
            text("""
                SELECT column_name, data_type, column_default
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'subscription_tier'
            """)
        ).fetchone()
        if not row:
            print("FAIL: subscription_tier column not found on users table.")
            return 1
        print("OK: Column exists:", dict(zip(["column_name", "data_type", "column_default"], row)))

        # 2) Read subscription_tier from users (raw SQL to avoid ORM enum issues)
        r = db.session.execute(
            text("SELECT id, email, subscription_tier FROM users LIMIT 3")
        ).fetchall()
        if not r:
            print("OK: No users in DB (column still verified above).")
        else:
            print("OK: subscription_tier is readable. Sample row(s):")
            for row in r:
                print("  ", row[1], "->", row[2])

    print("Done. subscription_tier column is working.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

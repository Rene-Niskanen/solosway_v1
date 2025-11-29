#!/usr/bin/env python3
"""
Celery worker entry point for Docker deployment.
This script properly initializes the Flask app and starts the Celery worker.
"""
import os
import sys
from dotenv import load_dotenv

# Load environment variables first
load_dotenv()

# Add the current directory to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def main():
    """Start the Celery worker"""
    try:
        from backend import create_app
        
        # Create Flask app
        app = create_app()
        
        # Get Celery instance from Flask app
        celery_app = app.extensions["celery"]
        
        print("🚀 Starting Celery worker...")
        print(f"📊 Redis URL: {os.environ.get('REDIS_URL', 'redis://redis:6379/0')}")
        
        # Log Supabase DB URL (mask password for security)
        supabase_db_url = os.environ.get('SUPABASE_DB_URL', 'Not set')
        if supabase_db_url != 'Not set' and '@' in supabase_db_url:
            # Mask password in connection string
            masked_url = supabase_db_url.split('@')[0].rsplit(':', 1)[0] + ':***@' + supabase_db_url.split('@')[1]
            print(f"📊 Supabase DB URL: {masked_url}")
        else:
            print(f"📊 Supabase DB URL: {supabase_db_url}")
        
        # Start the worker
        celery_app.start(['worker', '--loglevel=info', '--concurrency=1'])
        
    except Exception as e:
        print(f"❌ Failed to start Celery worker: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()

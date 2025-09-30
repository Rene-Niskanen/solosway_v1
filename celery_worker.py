#!/usr/bin/env python3
"""
Celery Worker Configuration
=========================

This file configures the Celery worker for background task processing.
"""

from dotenv import load_dotenv
load_dotenv()  # Load environment variables from .env file

from backend import create_app

# Create Flask app
app = create_app()

# Get Celery instance - this is the celery app that will be imported
celery_app = app.extensions["celery"]

# For command line usage: python celery_worker.py
if __name__ == '__main__':
    celery_app.start()

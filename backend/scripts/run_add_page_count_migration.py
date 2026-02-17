#!/usr/bin/env python3
"""
Add page_count column to documents table for document/page stats.
Run from project root: python -m backend.scripts.run_add_page_count_migration
"""

import os
import sys
import logging
from pathlib import Path

# Load env before any backend import (config reads DB URL at import time)
project_root = Path(__file__).resolve().parent.parent.parent
from dotenv import load_dotenv
load_dotenv(project_root / ".env")

# Add project root
sys.path.insert(0, str(project_root))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def run_migration():
    try:
        from backend import create_app, db
        from sqlalchemy import text

        app = create_app()
        with app.app_context():
            logger.info("Adding page_count column to documents table (if not exists)...")
            db.session.execute(text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS page_count integer;"))
            db.session.commit()
            logger.info("Done. documents.page_count is ready.")
        return True
    except Exception as e:
        logger.error("Migration failed: %s", e)
        return False


if __name__ == "__main__":
    ok = run_migration()
    sys.exit(0 if ok else 1)

#!/usr/bin/env python3
"""
Add subscription_tier column to users table (Starter / Pro / Business).
Run from project root: python -m backend.scripts.run_subscription_tier_migration
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
            # Idempotent: add column only if it doesn't exist (PostgreSQL)
            logger.info("Adding subscription_tier column to users table (if not exists)...")
            db.session.execute(text("""
                DO $$
                BEGIN
                  IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'users' AND column_name = 'subscription_tier'
                  ) THEN
                    ALTER TABLE users ADD COLUMN subscription_tier VARCHAR(32) NOT NULL DEFAULT 'professional';
                  END IF;
                END $$;
            """))
            db.session.commit()
            logger.info("Done. users.subscription_tier is ready.")
        return True
    except Exception as e:
        logger.error("Migration failed: %s", e)
        return False


if __name__ == "__main__":
    ok = run_migration()
    sys.exit(0 if ok else 1)

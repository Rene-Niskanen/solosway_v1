#!/usr/bin/env python3
"""
Add stripe_customer_id column to users table for Stripe billing.
Run from project root: python -m backend.scripts.run_stripe_customer_id_migration
"""

import os
import sys
import logging
from pathlib import Path

# Load env before any backend import
project_root = Path(__file__).resolve().parent.parent.parent
from dotenv import load_dotenv
load_dotenv(project_root / ".env")

sys.path.insert(0, str(project_root))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def run_migration():
    try:
        from backend import create_app, db
        from sqlalchemy import text

        app = create_app()
        with app.app_context():
            logger.info("Adding stripe_customer_id column to users table (if not exists)...")
            db.session.execute(text("""
                DO $$
                BEGIN
                  IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'stripe_customer_id'
                  ) THEN
                    ALTER TABLE users ADD COLUMN stripe_customer_id VARCHAR(255) NULL;
                  END IF;
                END $$;
            """))
            db.session.execute(text("CREATE INDEX IF NOT EXISTS ix_users_stripe_customer_id ON users (stripe_customer_id)"))
            db.session.commit()
            logger.info("Done. users.stripe_customer_id is ready.")
        return True
    except Exception as e:
        logger.error("Migration failed: %s", e)
        return False


if __name__ == "__main__":
    ok = run_migration()
    sys.exit(0 if ok else 1)

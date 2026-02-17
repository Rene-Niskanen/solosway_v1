#!/usr/bin/env python3
"""
Add subscription_period_ends_at column to users table (plan period = 30 days from switch).
Run from project root: python -m backend.scripts.run_subscription_period_ends_at_migration
"""

import sys
import logging
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(project_root))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def run_migration():
    try:
        from backend import create_app, db
        from sqlalchemy import text

        app = create_app()
        with app.app_context():
            logger.info("Adding subscription_period_ends_at column to users table (if not exists)...")
            db.session.execute(text("""
                DO $$
                BEGIN
                  IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'subscription_period_ends_at'
                  ) THEN
                    ALTER TABLE users ADD COLUMN subscription_period_ends_at DATE NULL;
                  END IF;
                END $$;
            """))
            db.session.commit()
            logger.info("Done. users.subscription_period_ends_at is ready.")
        return True
    except Exception as e:
        logger.error("Migration failed: %s", e)
        return False


if __name__ == "__main__":
    ok = run_migration()
    sys.exit(0 if ok else 1)

#!/usr/bin/env python3
"""
Run the add_privacy_mode_to_users migration (adds privacy_mode column to users).
Uses SUPABASE_DB_URL or SUPABASE_URL + SUPABASE_DB_PASSWORD from .env.
"""

import os
import sys
import logging
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root
project_root = Path(__file__).resolve().parent.parent.parent
env_path = project_root / '.env'
if env_path.exists():
    load_dotenv(env_path)
else:
    load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def run_migration():
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        supabase_url = os.environ.get("SUPABASE_URL")
        db_password = os.environ.get("SUPABASE_DB_PASSWORD")
        if supabase_url and db_password:
            project_ref = supabase_url.replace("https://", "").replace("http://", "").rstrip("/").split(".supabase.co")[0].strip()
            db_url = f"postgresql://postgres:{db_password}@db.{project_ref}.supabase.co:5432/postgres"
            logger.info("Using constructed DB URL from SUPABASE_URL + SUPABASE_DB_PASSWORD")
        else:
            logger.error("Set SUPABASE_DB_URL or SUPABASE_URL + SUPABASE_DB_PASSWORD in .env")
            return False

    try:
        import psycopg2
        from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
    except ImportError:
        logger.error("Install psycopg2: pip install psycopg2-binary")
        return False

    migration_sql = """
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'privacy_mode') THEN
    ALTER TABLE public.users ADD COLUMN privacy_mode VARCHAR(32) NOT NULL DEFAULT 'privacy';
  END IF;
END $$;
"""

    try:
        logger.info("Connecting to database...")
        conn = psycopg2.connect(db_url)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()
        cursor.execute(migration_sql)
        conn.close()
        logger.info("Privacy mode migration completed successfully.")
        return True
    except Exception as e:
        logger.exception("Migration failed: %s", e)
        return False


if __name__ == "__main__":
    ok = run_migration()
    sys.exit(0 if ok else 1)

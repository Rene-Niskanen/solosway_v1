#!/usr/bin/env python3
"""
Run the add_match_chunks_hybrid migration.
Creates the match_chunks_hybrid SQL function for consolidated chunk retrieval.

Uses SUPABASE_DB_URL or SUPABASE_URL + SUPABASE_DB_PASSWORD from .env.
Run from project root: python -m backend.scripts.run_match_chunks_hybrid_migration
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

    migration_path = project_root / "backend" / "migrations" / "add_match_chunks_hybrid.sql"
    if not migration_path.exists():
        logger.error("Migration file not found: %s", migration_path)
        return False

    migration_sql = migration_path.read_text()

    try:
        import psycopg2
        from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
    except ImportError:
        logger.error("Install psycopg2: pip install psycopg2-binary")
        return False

    try:
        logger.info("Connecting to database...")
        conn = psycopg2.connect(db_url)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()
        cursor.execute(migration_sql)
        conn.close()
        logger.info("match_chunks_hybrid migration completed successfully.")
        print("✓ match_chunks_hybrid migration completed successfully.")
        return True
    except Exception as e:
        logger.exception("Migration failed: %s", e)
        print(f"✗ Migration failed: {e}")
        return False


if __name__ == "__main__":
    ok = run_migration()
    sys.exit(0 if ok else 1)

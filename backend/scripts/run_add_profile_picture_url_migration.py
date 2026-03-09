#!/usr/bin/env python3
"""
Migration script to add profile_picture_url column to users table.
Run this script to add the column in Supabase.
"""

import os
import sys
import logging
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
env_path = Path(__file__).parent.parent.parent / '.env'
if env_path.exists():
    load_dotenv(env_path)
else:
    load_dotenv()

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def run_migration():
    """Add profile_picture_url column to users table"""
    try:
        db_url = os.environ.get("SUPABASE_DB_URL")

        if not db_url:
            supabase_url = os.environ.get("SUPABASE_URL")
            db_password = os.environ.get("SUPABASE_DB_PASSWORD")

            if supabase_url and db_password:
                project_ref = supabase_url.replace("https://", "").replace(".supabase.co", "")
                db_url = f"postgresql://postgres:{db_password}@db.{project_ref}.supabase.co:5432/postgres"
                logger.info("Constructed database connection string")
            else:
                logger.error("Set SUPABASE_DB_URL or SUPABASE_URL + SUPABASE_DB_PASSWORD")
                return False

        import psycopg2
        from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

        logger.info("Connecting to database...")
        conn = psycopg2.connect(db_url)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()

        # Check if column already exists
        cursor.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'profile_picture_url'
            );
        """)
        if cursor.fetchone()[0]:
            logger.info("Column profile_picture_url already exists. Nothing to do.")
            cursor.close()
            conn.close()
            return True

        logger.info("Adding profile_picture_url column to users table...")
        cursor.execute("ALTER TABLE public.users ADD COLUMN profile_picture_url TEXT;")

        cursor.close()
        conn.close()

        logger.info("Migration completed successfully!")
        return True

    except ImportError as e:
        logger.error(f"Missing dependency: {e}. Run: pip install psycopg2-binary")
        return False
    except Exception as e:
        logger.error(f"Migration failed: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return False


if __name__ == "__main__":
    success = run_migration()
    sys.exit(0 if success else 1)

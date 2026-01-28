#!/usr/bin/env python3
"""
Script to create the projects table in Supabase.
Run this to ensure the projects table exists with all required columns.
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

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def create_projects_table():
    """Create the projects table if it doesn't exist"""
    try:
        # Get database connection string
        db_url = os.environ.get("SUPABASE_DB_URL")
        
        if not db_url:
            supabase_url = os.environ.get("SUPABASE_URL")
            db_password = os.environ.get("SUPABASE_DB_PASSWORD")
            
            if supabase_url and db_password:
                project_ref = supabase_url.replace("https://", "").replace(".supabase.co", "")
                db_url = f"postgresql://postgres:{db_password}@db.{project_ref}.supabase.co:5432/postgres"
                logger.info(f"✅ Constructed database connection string (project: {project_ref})")
            else:
                logger.error("❌ No database connection string found.")
                return False
        else:
            logger.info("✅ Got database connection string from SUPABASE_DB_URL")
        
        import psycopg2
        from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
        
        logger.info("🔄 Connecting to database...")
        conn = psycopg2.connect(db_url)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()
        
        # Read the migration SQL file
        migration_file = Path(__file__).parent.parent / 'migrations' / 'create_projects_table.sql'
        with open(migration_file, 'r') as f:
            migration_sql = f.read()
        
        logger.info("🔄 Creating enum type and projects table...")
        cursor.execute(migration_sql)
        
        logger.info("🔄 Verifying table creation...")
        cursor.execute("""
            SELECT column_name, data_type, udt_name 
            FROM information_schema.columns 
            WHERE table_name = 'projects'
            ORDER BY ordinal_position;
        """)
        columns = cursor.fetchall()
        logger.info(f"✅ Projects table created with columns: {[col[0] for col in columns]}")
        
        cursor.close()
        conn.close()
        
        logger.info("✅ Projects table creation completed successfully!")
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to create projects table: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return False

if __name__ == "__main__":
    logger.info("🚀 Creating projects table...")
    success = create_projects_table()
    sys.exit(0 if success else 1)

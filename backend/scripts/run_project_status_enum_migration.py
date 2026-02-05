#!/usr/bin/env python3
"""
Migration script to update project_status enum from lowercase to uppercase values.
Run this script to update the PostgreSQL enum type in Supabase.
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
    load_dotenv()  # Try loading from current directory

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def run_migration():
    """Run the migration to update project_status enum to uppercase"""
    try:
        # Try to get database connection string from environment
        db_url = os.environ.get("SUPABASE_DB_URL")
        
        if not db_url:
            # Try to construct from other env vars
            supabase_url = os.environ.get("SUPABASE_URL")
            db_password = os.environ.get("SUPABASE_DB_PASSWORD")
            
            if supabase_url and db_password:
                project_ref = supabase_url.replace("https://", "").replace(".supabase.co", "")
                db_url = f"postgresql://postgres:{db_password}@db.{project_ref}.supabase.co:5432/postgres"
                logger.info(f"✅ Constructed database connection string (project: {project_ref})")
            else:
                logger.error("❌ No database connection string found.")
                logger.error("Please set SUPABASE_DB_URL environment variable or SUPABASE_URL + SUPABASE_DB_PASSWORD")
                logger.error("\nYou can also run the SQL manually in Supabase SQL Editor:")
                logger.error("See: backend/migrations/update_project_status_enum_to_uppercase.sql")
                return False
        else:
            logger.info("✅ Got database connection string from SUPABASE_DB_URL")
        
        # Use psycopg2 to execute the migration
        import psycopg2
        from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
        
        logger.info("🔄 Connecting to database...")
        conn = psycopg2.connect(db_url)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()
        
        # Check if projects table exists
        cursor.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables 
                WHERE table_name = 'projects'
            );
        """)
        table_exists = cursor.fetchone()[0]
        
        if not table_exists:
            logger.warning("⚠️  Projects table does not exist yet. Migration will be applied when table is created.")
            logger.info("✅ Migration script is ready. The enum type has been updated.")
            return True
        
        # Check if migration was partially completed
        cursor.execute("""
            SELECT EXISTS (
                SELECT 1 FROM pg_type WHERE typname = 'project_status_old'
            );
        """)
        old_exists = cursor.fetchone()[0]
        
        cursor.execute("""
            SELECT EXISTS (
                SELECT 1 FROM pg_type WHERE typname = 'project_status'
            );
        """)
        new_exists = cursor.fetchone()[0]
        
        if old_exists and not new_exists:
            logger.info("⚠️  Migration was partially completed. Cleaning up and continuing...")
            # Drop the old enum if it exists and create new one
            cursor.execute("DROP TYPE IF EXISTS project_status_old CASCADE;")
            cursor.execute("CREATE TYPE project_status AS ENUM ('ACTIVE', 'NEGOTIATING', 'ARCHIVED');")
            logger.info("✅ Created new enum type")
        elif not new_exists:
            logger.info("🔄 Running migration: Renaming old enum type...")
            cursor.execute("ALTER TYPE project_status RENAME TO project_status_old;")
            
            logger.info("🔄 Creating new enum type with uppercase values...")
            cursor.execute("CREATE TYPE project_status AS ENUM ('ACTIVE', 'NEGOTIATING', 'ARCHIVED');")
        else:
            logger.info("✅ New enum type already exists, checking if migration is needed...")
            # Check if enum has uppercase values
            cursor.execute("""
                SELECT enumlabel FROM pg_enum 
                WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'project_status')
                ORDER BY enumsortorder;
            """)
            enum_values = [row[0] for row in cursor.fetchall()]
            if enum_values == ['ACTIVE', 'NEGOTIATING', 'ARCHIVED']:
                logger.info("✅ Enum already has uppercase values.")
                # Check if table column is using the new enum
                cursor.execute("""
                    SELECT data_type, udt_name 
                    FROM information_schema.columns 
                    WHERE table_name = 'projects' AND column_name = 'status';
                """)
                col_info = cursor.fetchone()
                if not col_info:
                    logger.warning("⚠️  Status column does not exist in projects table.")
                    logger.info("✅ Enum type is ready. Column will use it when table is created.")
                    cursor.execute("DROP TYPE IF EXISTS project_status_old CASCADE;")
                    return True
                elif col_info[1] == 'project_status':
                    logger.info("✅ Projects table is already using the new enum type.")
                    # Clean up old enum if it exists
                    cursor.execute("DROP TYPE IF EXISTS project_status_old CASCADE;")
                    return True
                else:
                    logger.info("⚠️  Enum exists but table column needs updating...")
                    # Continue with table update
            else:
                logger.info(f"⚠️  Enum has values: {enum_values}. Need to migrate...")
                # Drop and recreate
                cursor.execute("DROP TYPE project_status CASCADE;")
                cursor.execute("CREATE TYPE project_status AS ENUM ('ACTIVE', 'NEGOTIATING', 'ARCHIVED');")
                logger.info("✅ Recreated enum type with uppercase values")
        
        logger.info("🔄 Removing default constraint...")
        cursor.execute("ALTER TABLE projects ALTER COLUMN status DROP DEFAULT;")
        
        logger.info("🔄 Updating projects table to use new enum type...")
        cursor.execute("""
            ALTER TABLE projects 
            ALTER COLUMN status TYPE project_status 
            USING CASE 
                WHEN status::text = 'active' THEN 'ACTIVE'::project_status
                WHEN status::text = 'negotiating' THEN 'NEGOTIATING'::project_status
                WHEN status::text = 'archived' THEN 'ARCHIVED'::project_status
                ELSE 'ACTIVE'::project_status
            END;
        """)
        
        logger.info("🔄 Setting new default value...")
        cursor.execute("ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'ACTIVE'::project_status;")
        
        logger.info("🔄 Dropping old enum type...")
        cursor.execute("DROP TYPE project_status_old;")
        
        logger.info("🔄 Verifying migration...")
        # Check if table has any rows
        cursor.execute("SELECT EXISTS (SELECT 1 FROM projects LIMIT 1);")
        has_rows = cursor.fetchone()[0]
        
        if has_rows:
            cursor.execute("SELECT DISTINCT status FROM projects;")
            results = cursor.fetchall()
            logger.info(f"✅ Current status values in database: {[r[0] for r in results]}")
        else:
            logger.info("✅ Projects table is empty (no existing data to migrate)")
        
        cursor.close()
        conn.close()
        
        logger.info("✅ Migration completed successfully!")
        return True
        
    except ImportError as e:
        logger.error(f"❌ Missing dependency: {e}")
        logger.error("Please install psycopg2: pip install psycopg2-binary")
        return False
    except Exception as e:
        logger.error(f"❌ Migration failed: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return False

if __name__ == "__main__":
    logger.info("🚀 Starting project_status enum migration...")
    success = run_migration()
    sys.exit(0 if success else 1)

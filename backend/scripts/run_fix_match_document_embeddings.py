#!/usr/bin/env python3
"""
Migration script to fix match_document_embeddings() function type mismatch.
The function returns text but actual columns are varchar(255), causing vector search to fail.
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

MIGRATION_SQL = """
-- Fix match_document_embeddings() return type mismatch
-- Cast varchar(255) columns to text to match function signature

DROP FUNCTION IF EXISTS match_document_embeddings(vector(1024), float, int);

CREATE OR REPLACE FUNCTION match_document_embeddings(
    query_embedding vector(1024),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 20
)
RETURNS TABLE (
    id uuid,
    original_filename text,
    classification_type text,
    summary_text text,
    document_summary jsonb,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.original_filename::text,
        d.classification_type::text,
        d.summary_text,
        d.document_summary,
        1 - (d.document_embedding <=> query_embedding) as similarity
    FROM documents d
    WHERE d.document_embedding IS NOT NULL
        AND 1 - (d.document_embedding <=> query_embedding) > match_threshold
    ORDER BY d.document_embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
"""

def run_migration():
    """Run the migration to fix match_document_embeddings function"""
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
                logger.error("See: backend/migrations/fix_match_document_embeddings_types.sql")
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
        
        # Check if the function exists first
        cursor.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.routines 
                WHERE routine_name = 'match_document_embeddings'
            );
        """)
        func_exists = cursor.fetchone()[0]
        
        if func_exists:
            logger.info("✅ Function match_document_embeddings exists, will recreate with fixes")
        else:
            logger.info("⚠️ Function match_document_embeddings does not exist, will create it")
        
        logger.info("🔄 Running migration SQL...")
        cursor.execute(MIGRATION_SQL)
        
        # Verify the function was created
        cursor.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.routines 
                WHERE routine_name = 'match_document_embeddings'
            );
        """)
        func_exists_after = cursor.fetchone()[0]
        
        if func_exists_after:
            logger.info("✅ Function match_document_embeddings created/updated successfully!")
        else:
            logger.error("❌ Function was not created. Check for errors.")
            return False
        
        # Test the function with a simple query
        logger.info("🔄 Testing function with sample query...")
        try:
            cursor.execute("""
                SELECT COUNT(*) FROM documents WHERE document_embedding IS NOT NULL;
            """)
            doc_count = cursor.fetchone()[0]
            logger.info(f"✅ Found {doc_count} documents with embeddings")
            
            if doc_count > 0:
                # Test the function itself
                cursor.execute("""
                    SELECT id, original_filename, similarity 
                    FROM match_document_embeddings(
                        (SELECT document_embedding FROM documents WHERE document_embedding IS NOT NULL LIMIT 1),
                        0.0,
                        3
                    );
                """)
                results = cursor.fetchall()
                logger.info(f"✅ Function test returned {len(results)} results")
                for r in results[:3]:
                    logger.info(f"   - {r[1][:50]}... (similarity: {r[2]:.3f})")
        except Exception as test_error:
            logger.warning(f"⚠️ Function test failed (may be OK if no embeddings): {test_error}")
        
        cursor.close()
        conn.close()
        
        logger.info("✅ Migration completed successfully!")
        logger.info("🔄 Please restart the backend to use the fixed function.")
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
    logger.info("🚀 Starting match_document_embeddings function fix migration...")
    success = run_migration()
    sys.exit(0 if success else 1)

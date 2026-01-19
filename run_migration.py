#!/usr/bin/env python3
"""
Run the projects table migration.
This script executes the SQL migration file to create the projects table.

You can run this in two ways:
1. If you have SUPABASE_DB_URL set: python run_migration.py
2. Or run the SQL directly in Supabase SQL Editor (recommended)
"""

import os
import sys
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def run_migration_with_psycopg2():
    """Run migration using psycopg2 directly."""
    try:
        import psycopg2
        from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
    except ImportError:
        print("❌ psycopg2 not installed. Installing...")
        os.system("pip install psycopg2-binary")
        import psycopg2
        from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
    
    # Get database URL from environment
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        print("❌ SUPABASE_DB_URL not found in environment variables.")
        print("\n📋 To run this migration, you have two options:")
        print("\nOption 1: Set SUPABASE_DB_URL in your .env file")
        print("  SUPABASE_DB_URL=postgresql://user:password@host:port/database")
        print("\nOption 2: Run the SQL directly in Supabase SQL Editor (recommended)")
        print("  1. Go to your Supabase dashboard")
        print("  2. Navigate to SQL Editor")
        print("  3. Copy and paste the contents of backend/migrations/create_projects_table.sql")
        print("  4. Click 'Run'")
        sys.exit(1)
    
    # Read the migration SQL file
    migration_file = os.path.join(
        os.path.dirname(__file__),
        'backend',
        'migrations',
        'create_projects_table.sql'
    )
    
    if not os.path.exists(migration_file):
        print(f"❌ Migration file not found: {migration_file}")
        sys.exit(1)
    
    print(f"📄 Reading migration file: {migration_file}")
    with open(migration_file, 'r') as f:
        migration_sql = f.read()
    
    print(f"🔗 Connecting to database...")
    try:
        # Connect to database
        conn = psycopg2.connect(db_url)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()
        
        print(f"✅ Connected successfully!")
        print(f"🚀 Executing migration SQL...")
        
        # Execute the entire SQL script
        cursor.execute(migration_sql)
        
        print("\n✅ Migration completed successfully!")
        print("📊 Projects table should now be available.")
        
        cursor.close()
        conn.close()
        
    except psycopg2.Error as e:
        print(f"\n❌ Database error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    run_migration_with_psycopg2()

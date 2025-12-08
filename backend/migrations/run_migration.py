import os
import sys
import psycopg2
from dotenv import load_dotenv

# Add parent directory to path to import backend modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.services.supabase_client_factory import get_supabase_db_url

def run_migration():
    """Run the SQL migration to fix match_documents function"""
    print("🚀 Starting migration to fix match_documents function...")
    
    try:
        # Load environment variables
        load_dotenv()
        
        # Get database connection string
        db_url = get_supabase_db_url()
        print(f"✅ Got database URL: {db_url[:15]}...{db_url[-10:]}")
        
        # Connect to database
        conn = psycopg2.connect(db_url)
        conn.autocommit = True
        cursor = conn.cursor()
        print("✅ Connected to database")
        
        # Read SQL file
        sql_file_path = os.path.join(os.path.dirname(__file__), 'fix_match_documents_bbox.sql')
        with open(sql_file_path, 'r') as f:
            sql_content = f.read()
            
        print(f"📜 Read SQL file: {sql_file_path}")
        
        # Execute SQL
        print("⏳ Executing migration...")
        cursor.execute(sql_content)
        print("✅ Migration executed successfully!")
        
        # Verification query
        print("🔍 Verifying function signature...")
        verify_sql = """
        SELECT proargnames, prorettype::regtype
        FROM pg_proc
        WHERE proname = 'match_documents';
        """
        cursor.execute(verify_sql)
        result = cursor.fetchone()
        print(f"✅ Verification result: {result}")
        
        cursor.close()
        conn.close()
        print("🎉 Migration complete!")
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        sys.exit(1)

if __name__ == '__main__':
    run_migration()

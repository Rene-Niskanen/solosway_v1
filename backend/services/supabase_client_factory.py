"""
Utilities for creating Supabase clients with consistent settings.
"""

import os
from functools import lru_cache
from supabase import create_client, Client
import logging

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    """
    Create (and cache) a Supabase client with shared configuration.

    Returns:
        Supabase Client instance configured with service role credentials.
    """
    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_SERVICE_KEY"]

    return create_client(supabase_url, supabase_key)


def get_supabase_db_url() -> str:
    """
    Get Supabase PostgreSQL connection string for direct database access.
    Used by LangGraph checkpointer and other services that need direct DB access.
    
    For production databases, use SUPABASE_DB_URL (direct connection string).
    
    Priority:
    1. SUPABASE_DB_URL (direct connection string - recommended for production)
    2. Construct from SUPABASE_URL + SUPABASE_DB_PASSWORD (if SUPABASE_URL available)
    
    Connection string formats:
    - Transaction mode pooler (RECOMMENDED): postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
      • ~200 connections (free tier) or ~500+ (Pro tier)
      • Best for production workloads
      • Works with IPv4 and IPv6
    - Session mode pooler: postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
      • ~15 connections (free tier) or ~100-200 (Pro tier)
      • Good for environments without IPv6 support
    - Direct connection: postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
      • ~60 connections (free tier) or ~200+ (Pro tier)
      • Bypasses pooler entirely
    
    Returns:
        PostgreSQL connection string (postgresql://user:pass@host:port/dbname)
        
    Raises:
        ValueError: If no valid Supabase connection string can be constructed
    """
    # Priority 1: Direct connection string (SUPABASE_DB_URL)
    # This is the recommended approach for production databases
    # Format: postgresql://user:password@host:port/database
    direct_url = os.environ.get("SUPABASE_DB_URL")
    if direct_url:
        logger.info("Using SUPABASE_DB_URL for LangGraph checkpointer")
        return direct_url
    
    # Priority 2: Construct from SUPABASE_URL + SUPABASE_DB_PASSWORD (optional)
    # Only works if you have SUPABASE_URL (not available in all production setups)
    supabase_url = os.environ.get("SUPABASE_URL")
    db_password = os.environ.get("SUPABASE_DB_PASSWORD")
    
    if supabase_url and db_password:
        # Extract project reference from SUPABASE_URL
        # Format: https://[PROJECT_REF].supabase.co
        try:
            # Remove https:// and .supabase.co
            project_ref = supabase_url.replace("https://", "").replace(".supabase.co", "")
            
            # Construct direct connection string
            # Format: postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
            db_url = f"postgresql://postgres:{db_password}@db.{project_ref}.supabase.co:5432/postgres"
            
            logger.info(f"Constructed Supabase DB URL for LangGraph checkpointer (project: {project_ref})")
            return db_url
            
        except Exception as e:
            logger.error(f"Failed to construct Supabase DB URL from SUPABASE_URL: {e}")
            raise ValueError(f"Cannot construct Supabase DB URL: {e}")
    
    # No valid Supabase connection string found
    error_msg = (
        "No Supabase database connection string available. "
        "Please set SUPABASE_DB_URL with your direct PostgreSQL connection string.\n\n"
        "Format: postgresql://user:password@host:port/database\n\n"
        "You can find this in your Supabase dashboard under:\n"
        "  Settings > Database > Connection string (Direct connection)\n\n"
    )
    raise ValueError(error_msg)


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


def get_supabase_db_url_for_checkpointer() -> str:
    """
    Get Supabase Session Pooler connection string for LangGraph checkpointer.
    Session pooler maintains session state, so prepared statements work correctly.
    Also IPv4 compatible (unlike direct connections).
    
    This is separate from get_supabase_db_url() because:
    - Checkpointer needs session pooler (prepared statements work, IPv4 compatible)
    - SQLAlchemy uses transaction pooler (more connections, via get_supabase_db_url())
    
    Priority:
    1. SUPABASE_DB_URL_SESSION (session pooler - explicitly set for checkpointer)
    2. SUPABASE_DB_URL (fallback - will auto-convert transaction pooler to session pooler if needed)
    3. Construct from SUPABASE_URL + SUPABASE_DB_PASSWORD
    
    Returns:
        PostgreSQL connection string using session pooler (port 5432 on pooler)
        
    Raises:
        ValueError: If no valid Supabase connection string can be constructed
    """
    # Priority 1: Explicit session pooler URL for checkpointer
    session_url = os.environ.get("SUPABASE_DB_URL_SESSION")
    if session_url:
        logger.info("Using SUPABASE_DB_URL_SESSION (session pooler) for LangGraph checkpointer")
        return session_url
    
    # Priority 2: Use SUPABASE_DB_URL and convert transaction pooler to session pooler if needed
    db_url = os.environ.get("SUPABASE_DB_URL")
    if db_url:
        # If it's a transaction pooler URL (port 6543), convert to session pooler (port 5432)
        if ":6543" in db_url:
            session_url = db_url.replace(":6543", ":5432")
            logger.info("Converted transaction pooler to session pooler for checkpointer (prepared statements will work)")
            return session_url
        
        # If already session pooler, use it
        if ":5432" in db_url and "pooler" in db_url:
            logger.info("Using SUPABASE_DB_URL (session pooler) for checkpointer")
            return db_url
        
        # If it's a direct connection, that's also fine (but IPv6 only)
        if "db." in db_url and ".supabase.co" in db_url:
            logger.info("Using SUPABASE_DB_URL (direct connection) for checkpointer")
            return db_url
    
    # Priority 3: Construct session pooler from SUPABASE_URL + SUPABASE_DB_PASSWORD
    supabase_url = os.environ.get("SUPABASE_URL")
    db_password = os.environ.get("SUPABASE_DB_PASSWORD")
    
    if supabase_url and db_password:
        try:
            # Extract project reference from SUPABASE_URL
            project_ref = supabase_url.replace("https://", "").replace(".supabase.co", "")
            
            # Construct session pooler connection string (port 5432 on pooler)
            # Try to extract region from SUPABASE_DB_URL if available
            region = "eu-north-1"  # Default region
            # db_url might be None if SUPABASE_DB_URL wasn't set, so check it
            url_to_check = db_url or os.environ.get("SUPABASE_DB_URL")
            if url_to_check and "aws-" in url_to_check:
                import re
                region_match = re.search(r'aws-\d+-([^.]+)', url_to_check)
                if region_match:
                    region = region_match.group(1)
            
            session_url = f"postgresql://postgres.{project_ref}:{db_password}@aws-1-{region}.pooler.supabase.com:5432/postgres"
            logger.info(f"Constructed session pooler URL for checkpointer (project: {project_ref}, region: {region})")
            return session_url
        except Exception as e:
            logger.error(f"Failed to construct session pooler URL: {e}")
    
    # Final fallback: use regular get_supabase_db_url()
    logger.warning("Could not construct session pooler URL, falling back to regular DB URL")
    return get_supabase_db_url()


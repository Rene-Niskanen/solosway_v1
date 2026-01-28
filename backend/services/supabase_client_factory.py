"""
Utilities for creating Supabase clients with consistent settings.
"""

import os
from functools import lru_cache
from supabase import create_client, Client
import logging
import httpx

logger = logging.getLogger(__name__)

# Configure timeout to prevent long hangs (default httpx timeout is 5s connect, but can hang longer on errors)
# These timeouts prevent the 55s hangs mentioned in the codebase
# Increased read timeout to 15s to handle slow Supabase queries, with retry logic for reliability
SUPABASE_TIMEOUT = httpx.Timeout(
    connect=10.0,  # Time to establish connection (increased for slow networks)
    read=20.0,     # Time to read response (increased for slow Supabase queries)
    write=10.0,    # Time to send request
    pool=10.0      # Time to get connection from pool (increased)
)


@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    """
    Create (and cache) a Supabase client with shared configuration.
    Includes timeout settings to prevent long hangs during authentication and queries.
    
    The Supabase Python client uses httpx internally. By configuring timeouts, we prevent
    the 55-second hangs that occur on connection errors.

    Returns:
        Supabase Client instance configured with service role credentials and timeouts.
    """
    # #region agent log
    import json, time
    try:
        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
            f.write(json.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"A","location":"supabase_client_factory.py:24","message":"get_supabase_client entry","data":{"has_url":"SUPABASE_URL" in os.environ,"has_key":"SUPABASE_SERVICE_KEY" in os.environ},"timestamp":int(time.time()*1000)}) + '\n')
    except: pass
    # #endregion
    
    try:
        supabase_url = os.environ["SUPABASE_URL"]
        supabase_key = os.environ["SUPABASE_SERVICE_KEY"]
    except KeyError as e:
        # #region agent log
        try:
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"B","location":"supabase_client_factory.py:35","message":"Missing env var","data":{"missing":str(e)},"timestamp":int(time.time()*1000)}) + '\n')
        except: pass
        # #endregion
        raise

    # #region agent log
    try:
        with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
            f.write(json.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"A","location":"supabase_client_factory.py:40","message":"Creating httpx client","data":{"timeout_connect":SUPABASE_TIMEOUT.connect,"timeout_read":SUPABASE_TIMEOUT.read,"timeout_write":SUPABASE_TIMEOUT.write,"timeout_pool":SUPABASE_TIMEOUT.pool},"timestamp":int(time.time()*1000)}) + '\n')
    except: pass
    # #endregion

    # Create httpx client with timeout configuration
    # The supabase-py library accepts a custom httpx client via SyncClientOptions
    http_client = httpx.Client(timeout=SUPABASE_TIMEOUT)
    
    try:
        # Import SyncClientOptions to properly configure the client
        from supabase.lib.client_options import SyncClientOptions
        
        # #region agent log
        try:
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"A","location":"supabase_client_factory.py:50","message":"Using SyncClientOptions path","data":{},"timestamp":int(time.time()*1000)}) + '\n')
        except: pass
        # #endregion
        
        # Create client with custom httpx client and timeout settings
        # This prevents the 55s hangs on connection errors
        options = SyncClientOptions(
            httpx_client=http_client,
            # Additional timeout settings for specific clients
            postgrest_client_timeout=20.0,  # PostgREST API timeout (increased for slow queries)
            storage_client_timeout=10.0,    # Storage API timeout
            function_client_timeout=10.0    # Functions API timeout
        )
        
        client = create_client(supabase_url, supabase_key, options=options)
        # #region agent log
        import socket
        url_host = supabase_url.split('//')[1].split('/')[0] if '//' in supabase_url else "unknown"
        dns_ok = False
        try:
            socket.gethostbyname(url_host)
            dns_ok = True
        except: pass
        try:
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"C","location":"supabase_client_factory.py:62","message":"Client created with SyncClientOptions","data":{"url_host":url_host,"dns_resolves":dns_ok},"timestamp":int(time.time()*1000)}) + '\n')
        except: pass
        # #endregion
        return client
    except (ImportError, TypeError, ValueError) as e:
        # #region agent log
        try:
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"A","location":"supabase_client_factory.py:65","message":"SyncClientOptions failed, using fallback","data":{"error":str(e)},"timestamp":int(time.time()*1000)}) + '\n')
        except: pass
        # #endregion
        # Fallback if SyncClientOptions import fails or doesn't work
        logger.warning(f"Could not configure custom httpx client: {e}. Using default client with limited timeout control.")
        # Fallback: create client without custom http_client
        # Note: This may still experience long hangs on connection errors
        client = create_client(supabase_url, supabase_key)
        # #region agent log
        try:
            with open('/Users/thomashorner/solosway_v1/.cursor/debug.log', 'a') as f:
                f.write(json.dumps({"sessionId":"debug-session","runId":"run1","hypothesisId":"A","location":"supabase_client_factory.py:72","message":"Client created with fallback (no timeout config)","data":{},"timestamp":int(time.time()*1000)}) + '\n')
        except: pass
        # #endregion
        return client


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


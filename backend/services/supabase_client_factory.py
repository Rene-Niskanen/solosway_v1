"""
Utilities for creating Supabase clients with consistent settings.
"""

import os
from functools import lru_cache
from supabase import create_client, Client


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


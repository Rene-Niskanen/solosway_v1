"""
Configuration and environment settings for LLM pipeline
"""

import os 
from pydantic_settings import BaseSettings, SettingsConfigDict

class LLMConfig(BaseSettings):
    """LLM and vector search configuration"""

    model_config = SettingsConfigDict(
        extra="allow",
        env_file = ".env",
        case_sensitive = False
        )

    # OpenAI 
    openai_api_key: str = os.environ.get('OPENAI_API_KEY')
    openai_model: str = os.environ.get('OPENAI_MODEL', 'gpt-4o')
    # Using text-embedding-3-small for speed + HNSW compatibility (1536 dimensions)
    openai_embedding_model: str = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")

    # Supabase
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_service_key: str = os.getenv("SUPABASE_SERVICE_KEY", "")
    
    # LangGraph
    streaming_enabled: bool = os.getenv("STREAMING_ENABLED", "true").lower() == "true"
    max_parallel_docs: int = int(os.getenv("MAX_PARALLEL_DOCS", "25"))
    vector_top_k: int = int(os.getenv("VECTOR_TOP_K", "30"))
    similarity_threshold: float = float(os.getenv("SIMILARITY_THRESHOLD", "0.35"))
    min_similarity_threshold: float = float(os.getenv("MIN_SIMILARITY_THRESHOLD", "0.15"))

    # Cohere Reranker
    cohere_api_key: str = os.getenv("COHERE_API_KEY", "")
    cohere_rerank_model: str = os.getenv("COHERE_RERANKER_MODEL", "rerank-english-v3.0")
    cohere_rerank_enabled: bool = os.getenv("COHERE_RERANK_ENABLED", "false").lower() == "true"
    
    # Developer/testing helpers
    simple_mode: bool = os.getenv("LLM_SIMPLE_MODE", "false").lower() == "true"


config = LLMConfig()

    
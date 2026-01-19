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
    openai_model: str = os.environ.get('OPENAI_MODEL', 'gpt-4o-mini')
    # Using text-embedding-3-small for speed + HNSW compatibility (1536 dimensions)
    openai_embedding_model: str = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")

    # Additional LLM Providers (for OpenCode integration)
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    google_api_key: str = os.getenv("GOOGLE_API_KEY", "")
    xai_api_key: str = os.getenv("XAI_API_KEY", "")
    ollama_base_url: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    
    # OpenCode Desktop Automation Settings
    opencode_enabled: bool = os.getenv("OPENCODE_ENABLED", "false").lower() == "true"
    opencode_serve_url: str = os.getenv("OPENCODE_SERVE_URL", "http://localhost:3333")
    opencode_allowed_folders: str = os.getenv("OPENCODE_ALLOWED_FOLDERS", "")
    opencode_provider: str = os.getenv("OPENCODE_PROVIDER", "openai")  # Provider for OpenCode: openai, anthropic, google, xai, ollama
    opencode_model: str = os.getenv("OPENCODE_MODEL", "gpt-4o")  # Model for OpenCode operations

    # Voyage AI embeddings
    voyage_api_key: str = os.getenv("VOYAGE_API_KEY", "")
    voyage_embedding_model: str = os.getenv("VOYAGE_EMBEDDING_MODEL", "voyage-law-2")
    use_voyage_embeddings: bool = os.getenv("USE_VOYAGE_EMBEDDINGS", "true").lower() == "true"

    # Supabase
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_service_key: str = os.getenv("SUPABASE_SERVICE_KEY", "")
    
    # LangGraph
    streaming_enabled: bool = os.getenv("STREAMING_ENABLED", "true").lower() == "true"
    max_parallel_docs: int = int(os.getenv("MAX_PARALLEL_DOCS", "25"))
    vector_top_k: int = int(os.getenv("VECTOR_TOP_K", "30"))
    similarity_threshold: float = float(os.getenv("SIMILARITY_THRESHOLD", "0.35"))
    min_similarity_threshold: float = float(os.getenv("MIN_SIMILARITY_THRESHOLD", "0.15"))

    # Chunk Expansion (adjacency-based context retrieval)
    # Expands retrieved chunks with adjacent neighbors to improve accuracy for multi-paragraph concepts
    # (e.g., lease clauses, covenants) that are split across multiple chunks during chunking
    chunk_expansion_enabled: bool = os.getenv("CHUNK_EXPANSION_ENABLED", "true").lower() == "true"
    chunk_expansion_size: int = int(os.getenv("CHUNK_EXPANSION_SIZE", "2"))  # ±2 chunks by default

    # Cohere Reranker
    cohere_api_key: str = os.getenv("COHERE_API_KEY", "")
    cohere_rerank_model: str = os.getenv("COHERE_RERANKER_MODEL", "rerank-english-v3.0")
    cohere_rerank_enabled: bool = os.getenv("COHERE_RERANK_ENABLED", "false").lower() == "true"
    
    # Developer/testing helpers
    simple_mode: bool = os.getenv("LLM_SIMPLE_MODE", "false").lower() == "true"


config = LLMConfig()

    
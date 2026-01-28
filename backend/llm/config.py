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
    
    # Anthropic (Claude) - for extended thinking
    anthropic_api_key: str = os.environ.get('ANTHROPIC_API_KEY', '')
    anthropic_model: str = os.environ.get('ANTHROPIC_MODEL', 'claude-sonnet-4-20250514')
    anthropic_thinking_budget: int = int(os.getenv('ANTHROPIC_THINKING_BUDGET', '5000'))  # Max thinking tokens
    use_extended_thinking: bool = os.getenv('USE_EXTENDED_THINKING', 'false').lower() == 'true'

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
    
    # Research Agent (Model-driven tool choice)
    # When enabled, document searches use the research agent which decides
    # which tools to call (search, read, etc.) based on the query
    research_agent_enabled: bool = os.getenv("RESEARCH_AGENT_ENABLED", "false").lower() == "true"
    research_agent_max_iterations: int = int(os.getenv("RESEARCH_AGENT_MAX_ITERATIONS", "10"))
    research_agent_timeout_seconds: int = int(os.getenv("RESEARCH_AGENT_TIMEOUT_SECONDS", "120"))


config = LLMConfig()

    
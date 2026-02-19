"""
Shared TypedDict definitions for LangGraph state management.
"""

from typing import TypedDict, Optional, Annotated, Any, List, Literal, Dict
import operator
from langchain_core.messages import BaseMessage

class ExecutionStep(TypedDict, total=False):
    """Single step in execution plan"""
    id: str  # Unique step identifier
    action: Literal["retrieve_docs", "retrieve_chunks", "query_db", "analyze"]  # Action type
    query: Optional[str]  # For search/retrieve actions
    query_type: Optional[Literal["broad", "specific"]]  # For retrieve_docs
    document_ids: Optional[List[str]]  # For retrieve_chunks (populated from previous steps)
    reasoning_label: Optional[str]  # NEW: User-facing reasoning label (e.g., "Checked letter of offer")
    reasoning_detail: Optional[str]  # NEW: User-facing reasoning detail (e.g., "Looking for vendor agent information")
    top_k: Optional[int]  # For retrieve actions
    min_score: Optional[float]  # For retrieve actions
    focus: Optional[str]  # For analyze action
    metadata: Optional[Dict[str, Any]]  # Additional step-specific data
    use_agent_retrieval: Optional[bool]  # NEW: LLM-determined complexity for retrieve_chunks (True = agent-based, False = direct)

class ExecutionPlan(TypedDict, total=False):
    """Structured plan from planner node"""
    objective: str  # High-level goal
    steps: List[ExecutionStep]  # Ordered list of actions (0, 1, or 2)
    use_prior_context: Optional[bool]  # True when user asks to restructure/format prior answer
    format_instruction: Optional[str]  # User-requested output format (e.g. "one concise paragraph")

class RetrievedDocument(TypedDict):
    """Result from vector or SQL retrieval"""
    vector_id: str
    doc_id: str
    property_id: Optional[str]  # Some documents may not be linked to a property
    content: str
    classification_type: str    
    chunk_index: int
    page_number: int
    bbox: Optional[dict]
    similarity_score: float
    source: str # "vector" or "structured"
    address_hash: Optional[str]
    business_id: Optional[str]
    original_filename: Optional[str]  # NEW: Document filename
    property_address: Optional[str]  # NEW: Property address
    blocks: Optional[list[dict]]  # NEW: Block-level metadata for citation mapping

class Citation(TypedDict):
    """Citation stored in graph state with bbox coordinates"""
    citation_number: int
    block_id: Optional[str]  # Block ID (for block-id-lookup method) or None (for chunk-id-lookup)
    chunk_id: Optional[str]  # NEW: Chunk ID (for chunk-id-lookup method) or None (for block-id-lookup)
    block_index: Optional[int]  # NEW: Index in blocks array (for chunk-id-lookup method)
    cited_text: str
    bbox: Optional[dict]  # {'left': float, 'top': float, 'width': float, 'height': float, 'page': int}
    page_number: int
    doc_id: str
    original_filename: Optional[str]  # NEW: Document filename for frontend display
    confidence: Optional[str]  # 'high', 'medium', 'low'
    method: str  # 'block-id-lookup' or 'chunk-id-lookup'
    block_content: Optional[str]  # Store actual block content for verification
    verification: Optional[dict]  # Store verification result
    matched_block_content: Optional[str]  # NEW: The actual block content that matched (for chunk-id-lookup)

class DocumentProcessingResult(TypedDict, total=False):
    """Result from processing a single document with LLM"""
    doc_id: str
    property_id: Optional[str]  # Some documents may not be linked to a property
    output: str
    source_chunks: list[str]  # Keep for backward compatibility
    source_chunks_metadata: Optional[list[dict[str, Any]]]  # NEW: Full metadata including bbox for citation/highlighting
    # Search source information
    search_source: Optional[str]  # "structured_query", "llm_sql_query", "bm25", "vector", "hybrid"
    similarity_score: Optional[float]  # Relevance score from search
    original_filename: Optional[str]
    property_address: Optional[str]
    classification_type: Optional[str]
    page_range: Optional[str]
    page_numbers: Optional[list[int]]

class MainWorkflowState(TypedDict, total=False):
    """Main orchestration graph state"""
    user_query: str
    query_intent: Optional[dict]  # NEW: Structured intent from query analysis node (search_goal, query_type, document_types, domain_terms, retry_budget)
    query_variations: list[str]  # NEW: Query expansion for better recall
    # FIXED: Remove operator.add so clarify_relevant_docs REPLACES chunks with merged docs
    relevant_documents: list[RetrievedDocument]
    document_outputs: Annotated[list[DocumentProcessingResult], operator.add]
    final_summary: str
    user_id: str
    business_id: str
    conversation_history: Annotated[list[dict], operator.add]  # New: stores Q&A history
    session_id: str  # New: unique chat session identifier
    document_ids: Optional[list[str]]  # Optional list of document IDs to filter search results (DEPRECATED: use retrieved_documents instead)
    # NEW: Query rewriting and retry tracking
    refined_query: Optional[str]  # Rewritten query for retries
    document_retry_count: int  # Track document retrieval retries (default: 0, max: 3)
    chunk_retry_count: int  # Track chunk retrieval retries (default: 0, max: 3)
    last_document_failure_reason: Optional[str]  # Why document retrieval failed (e.g., "no documents above threshold")
    last_chunk_failure_reason: Optional[str]  # Why chunk retrieval failed (e.g., "no chunks above threshold")
    retrieved_documents: Optional[list[dict]]  # NEW: Full document metadata from Level 1 retrieval (replaces document_ids)
    # Structure: [{"document_id": str, "score": float, "document_type": str, "filename": str, "summary": str}]
    search_hint: Optional[str]  # NEW: Search mode hint for chunk retrieval ("numeric" | "section" | "literal")
    detail_level: Optional[str]  # NEW: "concise" (default) or "detailed" - controls number of chunks/docs processed
    citations: Annotated[list[Citation], operator.add]  # NEW: Accumulate citations in graph state (with bbox coordinates)
    chunk_citations: Annotated[list[Citation], operator.add]  # NEW: Citations from chunk-id-based matching (immediate citation capture)
    query_category: Optional[str]  # NEW: "general_query", "text_transformation", "document_search", "hybrid"
    text_to_transform: Optional[str]  # NEW: Text content to transform
    transformation_instruction: Optional[str]  # NEW: How to transform (extracted from query)
    citation_context: Optional[dict]  # NEW: Structured citation metadata (bbox, page, text, doc_id) - hidden from user
    response_mode: Optional[str]  # NEW: Response mode for file attachments ("fast", "detailed", "full")
    attachment_context: Optional[dict]  # NEW: Extracted text from attached files (texts, pageTexts, filenames)
    is_agent_mode: Optional[bool]  # AGENT MODE: Enable LLM tool-based actions for proactive document display
    agent_actions: Optional[list[dict]]  # AGENT MODE: Actions requested by LLM (open_document, navigate, etc.)
    messages: Annotated[List[BaseMessage], operator.add]  # NEW: Message history for agent conversation (includes tool calls and responses)
    execution_events: Optional[Any]  # NEW: ExecutionEventEmitter for execution trace (not serialized in checkpoints)
    # NEW: Planner → Executor → Responder architecture
    execution_plan: Optional[ExecutionPlan]  # Current plan from planner node
    current_step_index: int  # Which step executor is on (default: 0)
    execution_results: List[Dict[str, Any]]  # Results from each executed step
    use_cached_results: Optional[bool]  # When True, skip planner+executor and use execution_results from checkpoint (cache-first for follow-ups)
    use_paste_plus_docs: Optional[bool]  # When True, use pasted/attachment context together with other documents (classifier=PASTE_AND_DOCS)
    paste_requested_but_missing: Optional[bool]  # When True, classifier said paste_and_docs but no attachment_context; responder may prepend explanation
    plan_refinement_count: int  # Track how many times plan has been refined (circuit breaker, default: 0, max: 3)
    prior_turn_content: Optional[str]  # Previous assistant answer when use_prior_context (for refine/format)
    format_instruction: Optional[str]  # User-requested output format (e.g. "one concise paragraph")
    personality_id: Optional[str]  # Chosen response tone (e.g. "default", "friendly", "efficient"); set by responder from LLM structured output

class DocumentQAState(TypedDict, total=False):
    """State for per-document Q&A subgraph"""
    doc_type: str
    property_id: Optional[str]  # Some documents may not be linked to a property
    doc_content: str
    user_query: str
    answer: str
    detail_level: Optional[str]  # NEW: "concise" or "detailed" - controls prompt instructions
    citation_context: Optional[dict]  # NEW: Structured citation metadata (bbox, page, text, doc_id) - hidden from user







"""
Shared TypedDict definitions for LangGraph state management.
"""

from typing import TypedDict, Optional, Annotated, Any
import operator

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
    query_intent: str
    query_variations: list[str]  # NEW: Query expansion for better recall
    # FIXED: Remove operator.add so clarify_relevant_docs REPLACES chunks with merged docs
    relevant_documents: list[RetrievedDocument]
    document_outputs: Annotated[list[DocumentProcessingResult], operator.add]
    final_summary: str
    evidence_feedback: list[dict[str, Any]]  # Raw evidence feedback records from LLM
    matched_evidence: list[dict[str, Any]]   # Feedback records aligned to specific chunks/bboxes
    user_id: str
    business_id: str
    conversation_history: Annotated[list[dict], operator.add]  # New: stores Q&A history
    session_id: str  # New: unique chat session identifier
    document_ids: Optional[list[str]]  # Optional list of document IDs to filter search results

class DocumentQAState(TypedDict):
    """State for per-document Q&A subgraph"""
    doc_id: str  # Document ID for the document being processed
    property_id: Optional[str]  # Some documents may not be linked to a property
    doc_content: str
    user_query: str
    answer: str







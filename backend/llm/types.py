"""
Shared TypedDict definitions for LangGraph state management.
"""

from typing import TypedDict, Optional, Annotated, Any
import operator

class RetrievedDocument(TypedDict):
    """Result from vector or SQL retrieval"""
    vector_id: str
    doc_id: str
    property_id: str
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

class DocumentProcessingResult(TypedDict):
    """Result from processing a single document with LLM"""
    doc_id: str
    property_id: str
    output: str
    source_chunks: list[str]

class MainWorkflowState(TypedDict):
    """Main orchestration graph state"""
    user_query: str
    query_intent: str
    # FIXED: Remove operator.add so clarify_relevant_docs REPLACES chunks with merged docs
    relevant_documents: list[RetrievedDocument]
    document_outputs: Annotated[list[DocumentProcessingResult], operator.add]
    final_summary: str
    user_id: str
    business_id: str
    conversation_history: Annotated[list[dict], operator.add]  # New: stores Q&A history
    session_id: str  # New: unique chat session identifier

class DocumentQAState(TypedDict):
    """State for per-document Q&A subgraph"""
    doc_type: str
    property_id: str
    doc_content: str
    user_query: str
    answer: str







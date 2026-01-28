"""
Retrieval Tools - LLM-callable tools for document search and reading.

These tools allow the LLM to autonomously decide how to gather information
from the user's document library. The agent can:
- Search for documents matching a query
- Read specific documents to get full content
- Refine searches based on results

This enables model-driven tool choice where the LLM decides:
- "This query needs search + read + answer"
- "This query needs search, read, search again with refined terms, read, answer"
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Tuple

from pydantic import BaseModel, Field
from langchain_core.tools import StructuredTool

from backend.services.supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)


# =============================================================================
# Tool Input Schemas
# =============================================================================

class SearchDocumentsInput(BaseModel):
    """Schema for search_documents tool"""
    query: str = Field(
        description=(
            "The search query to find relevant documents. "
            "Be specific and include key terms from the user's question. "
            "Examples: 'property valuation market value', 'lease agreement terms', "
            "'building survey roof condition'"
        )
    )
    max_results: int = Field(
        default=10,
        description="Maximum number of documents to return (1-20). Default is 10."
    )


class ReadDocumentInput(BaseModel):
    """Schema for read_document tool"""
    doc_id: str = Field(
        description=(
            "The document ID to read. Get this from search_documents results. "
            "Format: UUID string like 'abc123-def456-...'"
        )
    )
    focus_query: Optional[str] = Field(
        default=None,
        description=(
            "Optional: A specific question to focus on within the document. "
            "If provided, the tool will prioritize content related to this query. "
            "Example: 'What is the market value?' when reading a valuation report."
        )
    )


class ReadMultipleDocumentsInput(BaseModel):
    """Schema for read_multiple_documents tool"""
    doc_ids: List[str] = Field(
        description="List of document IDs to read. Maximum 5 documents at once."
    )
    focus_query: Optional[str] = Field(
        default=None,
        description="Optional: A specific question to focus on within the documents."
    )


# =============================================================================
# Retrieval Tool Context - State Management Across Tool Calls
# =============================================================================

@dataclass
class RetrievalToolContext:
    """
    Maintains state across agent tool calls.
    
    This context is passed to all tools and accumulates:
    - Search results from multiple searches
    - Read document contents with BLOCK_CITE_IDs
    - Metadata for citation mapping
    """
    
    # Initial state from graph
    business_id: str
    user_id: str
    user_query: str
    property_id: Optional[str] = None
    conversation_history: List[dict] = field(default_factory=list)
    model_preference: str = "gpt-4o"
    
    # Accumulated during tool calls
    all_search_results: List[dict] = field(default_factory=list)
    read_documents: Dict[str, dict] = field(default_factory=dict)
    block_id_to_metadata: Dict[str, dict] = field(default_factory=dict)
    
    # Tracking
    tool_calls: List[dict] = field(default_factory=list)
    total_tokens_used: int = 0
    
    @classmethod
    def from_state(cls, state: dict) -> "RetrievalToolContext":
        """Create context from LangGraph state."""
        return cls(
            business_id=state.get("business_id", ""),
            user_id=state.get("user_id", ""),
            user_query=state.get("user_query", ""),
            property_id=state.get("property_id"),
            conversation_history=state.get("conversation_history", []),
            model_preference=state.get("model_preference", "gpt-4o"),
        )
    
    def get_accumulated_context(self) -> str:
        """
        Build context string from all read documents for final answer generation.
        Includes BLOCK_CITE_IDs for citation mapping.
        """
        context_parts = []
        for doc_id, content in self.read_documents.items():
            context_parts.append(f"=== Document: {content.get('filename', 'Unknown')} (ID: {doc_id}) ===\n")
            context_parts.append(content.get('formatted_content', ''))
            context_parts.append("\n\n")
        return "".join(context_parts)
    
    def add_search_results(self, results: List[dict], query: str):
        """Add search results and deduplicate by doc_id."""
        seen_doc_ids = {r["doc_id"] for r in self.all_search_results}
        for result in results:
            if result["doc_id"] not in seen_doc_ids:
                result["search_query"] = query
                self.all_search_results.append(result)
                seen_doc_ids.add(result["doc_id"])
    
    def register_block_metadata(self, block_id: str, doc_id: str, page: int, bbox: dict):
        """Register BLOCK_CITE_ID metadata for citation mapping."""
        self.block_id_to_metadata[block_id] = {
            "doc_id": doc_id,
            "page": page,
            "bbox": bbox
        }
    
    def get_search_result_by_doc_id(self, doc_id: str) -> Optional[dict]:
        """Get search result metadata for a document."""
        for result in self.all_search_results:
            if result["doc_id"] == doc_id:
                return result
        return None


# =============================================================================
# Tool Implementation Functions
# =============================================================================

async def _search_documents_impl(
    query: str,
    max_results: int,
    context: RetrievalToolContext
) -> dict:
    """
    Search for documents using hybrid retrieval (BM25 + vector).
    
    Wraps existing query_vector_documents logic but returns structured output
    suitable for agent consumption.
    """
    from backend.llm.retrievers.hybrid_retriever import HybridDocumentRetriever
    
    start_time = time.time()
    
    try:
        # Validate inputs
        if not context.business_id:
            return {
                "success": False,
                "query": query,
                "total_found": 0,
                "documents": [],
                "error": "No business_id available",
                "message": "Cannot search: no business context"
            }
        
        # Clamp max_results
        max_results = max(1, min(max_results, 20))
        
        # Run hybrid search
        retriever = HybridDocumentRetriever()
        
        logger.info(f"[SEARCH_DOCUMENTS] Searching for: '{query[:50]}...' (max_results={max_results})")
        
        results = retriever.query_documents(
            user_query=query,
            top_k=max_results * 2,  # Fetch more, then filter
            business_id=context.business_id,
            property_id=context.property_id,
            trigger_lazy_embedding=False
        )
        
        # Format results for agent consumption
        formatted_results = []
        seen_doc_ids = set()
        
        for r in results:
            doc_id = r.get("doc_id", "")
            if not doc_id or doc_id in seen_doc_ids:
                continue
            seen_doc_ids.add(doc_id)
            
            formatted_results.append({
                "doc_id": doc_id,
                "filename": r.get("original_filename") or r.get("classification_type", "Document"),
                "classification_type": r.get("classification_type", "Document"),
                "relevance_score": round(r.get("similarity_score", 0.0), 3),
                "snippet": (r.get("content") or r.get("chunk_text", ""))[:300],
                "page_numbers": r.get("page_numbers", []),
            })
            
            if len(formatted_results) >= max_results:
                break
        
        # Add to context for deduplication across searches
        context.add_search_results(formatted_results, query)
        
        elapsed_ms = int((time.time() - start_time) * 1000)
        
        logger.info(f"[SEARCH_DOCUMENTS] Found {len(formatted_results)} documents in {elapsed_ms}ms")
        
        return {
            "success": True,
            "query": query,
            "total_found": len(formatted_results),
            "documents": formatted_results,
            "elapsed_ms": elapsed_ms,
            "message": f"Found {len(formatted_results)} document{'s' if len(formatted_results) != 1 else ''}"
        }
        
    except Exception as e:
        logger.error(f"[SEARCH_DOCUMENTS] Search failed: {e}", exc_info=True)
        return {
            "success": False,
            "query": query,
            "total_found": 0,
            "documents": [],
            "error": str(e),
            "message": f"Search failed: {str(e)}"
        }


async def _read_document_impl(
    doc_id: str,
    focus_query: Optional[str],
    context: RetrievalToolContext
) -> dict:
    """
    Read and process a specific document.
    
    Returns formatted content with BLOCK_CITE_IDs for citation mapping.
    """
    start_time = time.time()
    
    # Check if already read
    if doc_id in context.read_documents:
        cached = context.read_documents[doc_id]
        return {
            "success": True,
            "doc_id": doc_id,
            "filename": cached.get("filename", "Unknown"),
            "content": cached.get("formatted_content", ""),
            "page_count": cached.get("page_count", 1),
            "chunk_count": cached.get("chunk_count", 0),
            "message": "Document already read (using cached content)",
            "from_cache": True
        }
    
    try:
        supabase = get_supabase_client()
        
        # Fetch document metadata (page_count removed - doesn't exist in schema)
        doc_result = supabase.table("documents").select(
            "id, original_filename, classification_type, document_summary"
        ).eq("id", doc_id).single().execute()
        
        if not doc_result.data:
            return {
                "success": False,
                "doc_id": doc_id,
                "error": "Document not found",
                "message": f"Document {doc_id[:8]}... not found"
            }
        
        doc_meta = doc_result.data
        filename = doc_meta.get("original_filename") or doc_meta.get("classification_type", "Document")
        
        # Fetch document chunks (column is chunk_text, not content)
        chunks_result = supabase.table("document_vectors").select(
            "id, chunk_text, chunk_index, page_number, metadata"
        ).eq("document_id", doc_id).order("chunk_index").execute()
        
        if not chunks_result.data:
            return {
                "success": False,
                "doc_id": doc_id,
                "filename": filename,
                "error": "No content found",
                "message": f"No content chunks found for {filename}"
            }
        
        chunks = chunks_result.data
        
        # Calculate page_count from chunk page numbers (since column doesn't exist in documents table)
        page_numbers = set(chunk.get("page_number", 1) for chunk in chunks)
        calculated_page_count = max(page_numbers) if page_numbers else 1
        
        # Format chunks with BLOCK_CITE_IDs for the agent
        # Simpler format than full block_id_formatter - concatenate chunks with markers
        formatted_parts = []
        block_metadata = {}
        
        for i, chunk in enumerate(chunks):
            block_id = f"BLOCK_CITE_ID_{i + 1}"
            page_num = chunk.get("page_number", 1)
            content = chunk.get("chunk_text", "")  # Column is chunk_text in DB
            
            # Extract bbox from metadata if available
            chunk_meta = chunk.get("metadata", {}) or {}
            bbox = chunk_meta.get("bbox", {})
            
            formatted_parts.append(f"[{block_id}] (Page {page_num})\n{content}\n")
            
            block_metadata[block_id] = {
                "page": page_num,
                "bbox": bbox,
                "chunk_index": chunk.get("chunk_index", i)
            }
        
        formatted_content = "\n".join(formatted_parts)
        
        # Register block metadata for citation mapping
        for block_id, meta in block_metadata.items():
            context.register_block_metadata(
                block_id=block_id,
                doc_id=doc_id,
                page=meta.get("page", 1),
                bbox=meta.get("bbox", {})
            )
        
        # Store in context
        doc_content = {
            "doc_id": doc_id,
            "filename": filename,
            "classification_type": doc_meta.get("classification_type", "Document"),
            "page_count": calculated_page_count,
            "formatted_content": formatted_content,
            "chunk_count": len(chunks),
            "block_ids": list(block_metadata.keys())
        }
        context.read_documents[doc_id] = doc_content
        
        elapsed_ms = int((time.time() - start_time) * 1000)
        
        logger.info(f"[READ_DOCUMENT] Read {filename} ({len(chunks)} chunks) in {elapsed_ms}ms")
        
        return {
            "success": True,
            "doc_id": doc_id,
            "filename": filename,
            "content": formatted_content,
            "page_count": calculated_page_count,
            "chunk_count": len(chunks),
            "elapsed_ms": elapsed_ms,
            "message": f"Read {filename} ({len(chunks)} chunks)",
            "from_cache": False
        }
        
    except Exception as e:
        logger.error(f"[READ_DOCUMENT] Failed for {doc_id}: {e}", exc_info=True)
        return {
            "success": False,
            "doc_id": doc_id,
            "error": str(e),
            "message": f"Failed to read document: {str(e)}"
        }


async def _read_multiple_documents_impl(
    doc_ids: List[str],
    focus_query: Optional[str],
    context: RetrievalToolContext
) -> dict:
    """Read multiple documents in parallel."""
    
    # Limit to 5 documents
    doc_ids = doc_ids[:5]
    
    # Read documents in parallel
    tasks = [
        _read_document_impl(doc_id, focus_query, context)
        for doc_id in doc_ids
    ]
    
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Collect results
    documents = []
    errors = []
    
    for doc_id, result in zip(doc_ids, results):
        if isinstance(result, Exception):
            errors.append({"doc_id": doc_id, "error": str(result)})
        elif result.get("success"):
            documents.append({
                "doc_id": doc_id,
                "filename": result.get("filename", "Unknown"),
                "content": result.get("content", ""),
                "chunk_count": result.get("chunk_count", 0)
            })
        else:
            errors.append({"doc_id": doc_id, "error": result.get("error", "Unknown error")})
    
    return {
        "success": len(documents) > 0,
        "documents_read": len(documents),
        "documents": documents,
        "errors": errors if errors else None,
        "message": f"Read {len(documents)} of {len(doc_ids)} documents"
    }


# =============================================================================
# Tool Factory Function
# =============================================================================

def create_retrieval_tools(
    context: RetrievalToolContext
) -> List[StructuredTool]:
    """
    Create all retrieval tools bound to the given context.
    
    Returns tools that can be bound to an LLM via .bind_tools()
    """
    
    # search_documents tool
    async def search_documents(query: str, max_results: int = 10) -> str:
        """Search for documents matching the query."""
        result = await _search_documents_impl(query, max_results, context)
        # Return as JSON string for LLM consumption
        return json.dumps(result, indent=2)
    
    search_tool = StructuredTool.from_function(
        coroutine=search_documents,
        name="search_documents",
        description="""Search for documents in the user's document library.

PREREQUISITES: None - this tool can always be called.

Use this FIRST to find relevant documents before reading them.

Returns a list of documents with:
- doc_id: SAVE THIS - you need it to read the document
- filename: The document name
- relevance_score: How relevant (0-1, higher is better)
- snippet: Preview of content

IMPORTANT: After calling this, you will receive doc_ids that you can use with read_document.

Strategy:
- Start with specific search terms from the user's question
- If no results, try broader or alternative terms
- Search for document types (e.g., "valuation report", "lease agreement")""",
        args_schema=SearchDocumentsInput
    )
    
    # read_document tool
    async def read_document(doc_id: str, focus_query: Optional[str] = None) -> str:
        """Read a specific document to get its full content."""
        result = await _read_document_impl(doc_id, focus_query, context)
        return json.dumps(result, indent=2)
    
    read_tool = StructuredTool.from_function(
        coroutine=read_document,
        name="read_document",
        description="""Read a specific document to get its full content.

PREREQUISITES (MANDATORY):
- You MUST have called search_documents first
- The doc_id MUST be from a search_documents result
- If you use a doc_id not from search results, you will get a PREREQUISITE_ERROR

The content includes BLOCK_CITE_ID markers like [BLOCK_CITE_ID_1].
When you cite information in your final answer, reference these IDs.

Parameters:
- doc_id: The document ID from search_documents results (REQUIRED)
- focus_query: Optional - helps prioritize relevant content

WORKFLOW:
1. Call search_documents("your query") -> Returns list with doc_ids
2. Pick a doc_id from the results
3. Call read_document(doc_id="...") -> Returns document content""",
        args_schema=ReadDocumentInput
    )
    
    # read_multiple_documents tool
    async def read_multiple_documents(doc_ids: List[str], focus_query: Optional[str] = None) -> str:
        """Read multiple documents at once (max 5)."""
        result = await _read_multiple_documents_impl(doc_ids, focus_query, context)
        return json.dumps(result, indent=2)
    
    read_multiple_tool = StructuredTool.from_function(
        coroutine=read_multiple_documents,
        name="read_multiple_documents",
        description="""Read multiple documents at once (maximum 5).

PREREQUISITES (MANDATORY):
- ALL doc_ids MUST be from previous search_documents results
- If ANY doc_id is not from search results, you will get a PREREQUISITE_ERROR

Use this when you need to compare or gather information from several documents.
More efficient than calling read_document multiple times.""",
        args_schema=ReadMultipleDocumentsInput
    )
    
    return [search_tool, read_tool, read_multiple_tool]

"""
Combined search tool: retrieve_documents + retrieve_chunks in one call.

Reduces latency by eliminating 1-2 LLM round-trips for content queries.
Uses the same query for both steps to maximize embedding cache reuse (HyDE).
"""

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Top N documents from retrieve_documents to pass to retrieve_chunks
SEARCH_MAX_DOCS_FOR_CHUNKS = 3


def search(
    query: str,
    business_id: Optional[str] = None,
    property_id: Optional[str] = None,
    document_ids: Optional[List[str]] = None,
    user_query_for_entity: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Search documents and get relevant chunks in one call.

    Runs retrieve_documents, takes top N docs by score, then retrieve_chunks.
    Same query is used for both steps (embedding cache reuse).

    Args:
        query: Search query (property names, document types, keywords)
        business_id: Optional business UUID for multi-tenancy
        property_id: Optional property scope for document search
        document_ids: Optional document scope (when user attached files)
        user_query_for_entity: Optional user query for entity gating

    Returns:
        {"documents": [...], "chunks": [...]}
        - documents: list from retrieve_documents (document_id, filename, score, etc.)
        - chunks: list from retrieve_chunks (chunk_id, document_id, chunk_text, blocks, etc.)
    """
    from backend.llm.tools.document_retriever_tool import retrieve_documents
    from backend.llm.tools.chunk_retriever_tool import retrieve_chunks

    if not query or not query.strip():
        logger.warning("[SEARCH] Empty query provided")
        return {"documents": [], "chunks": []}

    # 1. Document-level retrieval
    doc_list = retrieve_documents(
        query=query,
        business_id=business_id,
        property_id=property_id,
        document_ids=document_ids if document_ids else None,
        user_query_for_entity=user_query_for_entity,
    )

    if not doc_list:
        logger.info("[SEARCH] No documents found for query: %s", query[:50])
        return {"documents": [], "chunks": []}

    # 2. Take top N documents by score
    top_docs = doc_list[:SEARCH_MAX_DOCS_FOR_CHUNKS]
    top_doc_ids = []
    for d in top_docs:
        if isinstance(d, dict) and d.get("document_id"):
            top_doc_ids.append(str(d["document_id"]))

    if not top_doc_ids:
        logger.warning("[SEARCH] No valid document_ids in top docs")
        return {"documents": doc_list, "chunks": []}

    # 3. Chunk-level retrieval (same query for embedding cache reuse)
    chunk_list = retrieve_chunks(
        query=query,
        document_ids=top_doc_ids,
        business_id=business_id,
    )

    logger.info(
        "[SEARCH] query=%s: %d docs -> top %d -> %d chunks",
        query[:40],
        len(doc_list),
        len(top_doc_ids),
        len(chunk_list) if isinstance(chunk_list, list) else 0,
    )

    return {"documents": doc_list, "chunks": chunk_list if isinstance(chunk_list, list) else []}

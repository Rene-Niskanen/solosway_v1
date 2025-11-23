"""
Document processing nodes - handles per-document LLM analysis.
This is where each document gets processed with the user's question.
"""

import asyncio
import logging
from typing import List

from backend.llm.types import (
    DocumentProcessingResult,
    MainWorkflowState,
)
from backend.llm.agents.document_qa_agent import build_document_qa_subgraph
from backend.llm.config import config

logger = logging.getLogger(__name__)


def _build_processing_result(output_state) -> DocumentProcessingResult:
    return DocumentProcessingResult(
        doc_id=output_state.get("doc_id", ""),
        property_id=output_state.get("property_id", ""),
        output=output_state.get("answer", "Not found in this document."),
        source_chunks=[output_state.get("doc_content", "")[:1500]],  # Increased for 1200-char chunks
    )


async def process_documents(state: MainWorkflowState) -> MainWorkflowState:
    """Process each relevant document with the QA subgraph in parallel."""

    relevant_docs = state.get("relevant_documents", [])
    if not relevant_docs:
        logger.warning("[PROCESS_DOCUMENTS] No relevant documents to process")
        return {"document_outputs": []}

    # Fast path for frontend plumbing / smoke tests
    if config.simple_mode:
        logger.info(
            "[PROCESS_DOCUMENTS] Simple mode enabled - returning stubbed answers for %d docs",
            len(relevant_docs),
        )
        stubbed = []
        for doc in relevant_docs:
            result = DocumentProcessingResult(
                doc_id=doc.get("doc_id", ""),
                property_id=doc.get("property_id", ""),
                output=(
                    f"[Simple mode] Top snippet:\n"
                    f"{(doc.get('content') or '')[:1500] or 'No text captured.'}"  # Increased for 1200-char chunks
                ),
                source_chunks=[(doc.get("content") or "")[:1500]],  # Increased for 1200-char chunks
            )
            # Add metadata
            result['classification_type'] = doc.get('classification_type', 'Unknown')
            result['page_range'] = doc.get('page_range', 'unknown')
            result['page_numbers'] = doc.get('page_numbers', [])
            result['original_filename'] = doc.get('original_filename')
            result['property_address'] = doc.get('property_address')
            # Preserve search source information
            result['search_source'] = doc.get('source', 'unknown')
            result['similarity_score'] = doc.get('similarity_score', 0.0)
            stubbed.append(result)
        return {"document_outputs": stubbed}

    logger.info(
        "[PROCESS_DOCUMENTS] Processing %d documents in parallel", len(relevant_docs)
    )

    qa_subgraph = build_document_qa_subgraph()

    async def process_one(doc) -> DocumentProcessingResult:
        doc_content = doc.get("content", "").strip()
        
        # Log content length for debugging
        if not doc_content or len(doc_content) < 50:
            logger.warning(
                "[PROCESS_DOCUMENTS] Document %s has very short or empty content (%d chars). "
                "This may result in a generic response.",
                doc.get("doc_id", "")[:8],
                len(doc_content)
            )
        
        subgraph_state = {
            "doc_id": doc.get("doc_id", ""),
            "property_id": doc.get("property_id", ""),
            "doc_content": doc_content,
            "user_query": state.get("user_query", ""),
            "answer": "",
        }

        try:
            output_state = await qa_subgraph.ainvoke(subgraph_state)
            result = _build_processing_result(output_state)
            
            # Add metadata from original doc (page numbers, classification, filename, address)
            result['classification_type'] = doc.get('classification_type', 'Unknown')
            result['page_range'] = doc.get('page_range', 'unknown')
            result['page_numbers'] = doc.get('page_numbers', [])
            result['original_filename'] = doc.get('original_filename')
            result['property_address'] = doc.get('property_address')
            # Preserve search source information (BM25, SQL, Vector, Hybrid)
            result['search_source'] = doc.get('source', 'unknown')
            result['similarity_score'] = doc.get('similarity_score', 0.0)
            
            logger.info(
                "[PROCESS_DOCUMENTS] Completed doc %s (%s)", 
                result["doc_id"][:8],
                result.get('page_range', '')
            )
            # TODO: stream partial result to frontend if streaming enabled
            return result
        except Exception as exc:  # pylint: disable=broad-except
            logger.error(
                "[PROCESS_DOCUMENTS] Error processing doc %s: %s",
                subgraph_state["doc_id"],
                exc,
                exc_info=True,
            )
            return DocumentProcessingResult(
                doc_id=subgraph_state["doc_id"],
                property_id=subgraph_state["property_id"],
                output=f"Error processing document: {exc}",
                source_chunks=[],
            )

    results: List[DocumentProcessingResult] = await asyncio.gather(
        *(process_one(doc) for doc in relevant_docs)
    )

    logger.info("[PROCESS_DOCUMENTS] Completed all %d documents", len(results))
    return {"document_outputs": results}





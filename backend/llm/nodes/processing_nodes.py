"""
Document processing nodes - handles per-document LLM analysis.
This is where each document gets processed with the user's question.
"""

import asyncio
import logging
import os
from typing import List

from backend.llm.types import (
    DocumentProcessingResult,
    MainWorkflowState,
)
from backend.llm.agents.document_qa_agent import build_document_qa_subgraph
from backend.llm.config import config

logger = logging.getLogger(__name__)


def _build_processing_result(output_state, source_chunks_metadata=None) -> DocumentProcessingResult:
    result = DocumentProcessingResult(
        doc_id=output_state.get("doc_id", ""),
        property_id=output_state.get("property_id", ""),
        output=output_state.get("answer", "Not found in this document."),
        source_chunks=[output_state.get("doc_content", "")[:1500]],  # Keep for backward compatibility
    )
    
    # NEW: Store source chunks metadata with bbox for citation/highlighting
    if source_chunks_metadata:
        result['source_chunks_metadata'] = source_chunks_metadata
    
    return result


async def process_documents(state: MainWorkflowState) -> MainWorkflowState:
    """Process each relevant document with the QA subgraph in parallel."""

    relevant_docs = state.get("relevant_documents", [])
    if not relevant_docs:
        logger.warning("[PROCESS_DOCUMENTS] No relevant documents to process")
        return {"document_outputs": []}
    
    # PERFORMANCE OPTIMIZATION: Limit number of documents processed based on detail_level
    # Concise mode: 5 docs (fast, precise answers)
    # Detailed mode: 15 docs (comprehensive, thorough answers)
    detail_level = state.get('detail_level', 'concise')
    logger.info(f"[PROCESS_DOCUMENTS] Detail level from state: {detail_level} (type: {type(detail_level).__name__})")
    if detail_level == 'detailed':
        max_docs_to_process = int(os.getenv("MAX_DOCS_TO_PROCESS_DETAILED", "15"))
        logger.info(f"[PROCESS_DOCUMENTS] Detailed mode: processing up to {max_docs_to_process} documents")
    else:
        max_docs_to_process = int(os.getenv("MAX_DOCS_TO_PROCESS", "5"))
        logger.info(f"[PROCESS_DOCUMENTS] Concise mode: processing up to {max_docs_to_process} documents")
    
    if len(relevant_docs) > max_docs_to_process:
        logger.info(
            "[PROCESS_DOCUMENTS] Limiting processing to top %d documents (out of %d) for %s response",
            max_docs_to_process,
            len(relevant_docs),
            detail_level
        )
        relevant_docs = relevant_docs[:max_docs_to_process]

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
            # NEW: Preserve source chunks metadata if available
            if doc.get('source_chunks_metadata'):
                result['source_chunks_metadata'] = doc.get('source_chunks_metadata')
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
            "detail_level": state.get("detail_level", "concise"),  # Pass detail_level to document QA
        }

        try:
            output_state = await qa_subgraph.ainvoke(subgraph_state)
            
            # NEW: Extract source chunks metadata from doc (preserved from clarify_relevant_docs)
            source_chunks_metadata = doc.get('source_chunks_metadata')
            
            result = _build_processing_result(output_state, source_chunks_metadata=source_chunks_metadata)
            
            # Add metadata from original doc (page numbers, classification, filename, address)
            # Ensure doc_id comes from original doc (subgraph may not preserve it)
            result['doc_id'] = doc.get('doc_id', '')
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

    # PERFORMANCE OPTIMIZATION: Process documents and collect results as they complete
    # This allows the frontend to see progress, though we still need to return all results
    # Note: Individual completions can't be streamed from here, but we process efficiently
    tasks = [asyncio.create_task(process_one(doc)) for doc in relevant_docs]
    results: List[DocumentProcessingResult] = []
    
    # Collect results as they complete (faster than gather for user perception)
    # Even though we can't stream from here, processing happens as fast as possible
    for coro in asyncio.as_completed(tasks):
        result = await coro
        results.append(result)
        logger.info(
            "[PROCESS_DOCUMENTS] ✅ Document %s completed (%d/%d)", 
            result["doc_id"][:8],
            len(results),
            len(relevant_docs)
        )
    
    # Sort results to maintain original document order (as_completed returns in completion order)
    doc_id_to_result = {r['doc_id']: r for r in results}
    results = [doc_id_to_result.get(doc.get('doc_id'), r) for doc, r in zip(relevant_docs, results) if doc.get('doc_id') in doc_id_to_result]
    
    logger.info("[PROCESS_DOCUMENTS] Completed all %d documents", len(results))
    return {"document_outputs": results}





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
from backend.llm.utils.block_id_formatter import format_document_with_block_ids

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
    document_outputs = state.get("document_outputs", []) or []
    
    # CRITICAL: If relevant_docs is empty but we have document_outputs from agent node,
    # trust the retrieval system - if chunks were retrieved, they're from the current query.
    # State is reset in views.py for each new query, so these are not stale.
    if not relevant_docs and document_outputs:
        logger.info(
            f"[PROCESS_DOCUMENTS] No relevant_documents, but found {len(document_outputs)} "
            f"document_outputs from chunk retrieval - using those (trusting retrieval ranking)"
        )
        return {"document_outputs": document_outputs}
    
    if not relevant_docs:
        logger.warning("[PROCESS_DOCUMENTS] No relevant documents to process")
        # CRITICAL: Clear any stale document_outputs from previous queries
        return {"document_outputs": []}
    
    # Process ALL relevant documents (no artificial limits)
    # Performance limits were removed to restore original retrieval behavior
    logger.info(f"[PROCESS_DOCUMENTS] Processing ALL {len(relevant_docs)} relevant documents")

    # NEW: Create source_chunks_metadata for individual chunks when clarify_relevant_docs was skipped
    # This ensures BBOX highlighting works without affecting LLM response quality (chunks remain individual)
    if relevant_docs and len(relevant_docs) > 0:
        first_doc = relevant_docs[0]
        is_individual_chunks = 'chunk_index' in first_doc
        
        if is_individual_chunks:
            # Import helper function
            from backend.llm.utils.chunk_metadata import create_source_chunks_metadata_for_single_chunk
            
            # Count chunks needing metadata
            chunks_needing_metadata = [chunk for chunk in relevant_docs if not chunk.get('source_chunks_metadata')]
            
            if chunks_needing_metadata:
                logger.info(
                    "[PROCESS_DOCUMENTS] Creating source_chunks_metadata for %d individual chunks (out of %d total)",
                    len(chunks_needing_metadata),
                    len(relevant_docs)
                )
                
                # OPTIMIZATION: Batch fetch metadata for all chunks in parallel
                if chunks_needing_metadata:
                    try:
                        from backend.llm.utils.chunk_metadata import batch_create_source_chunks_metadata
                        
                        # Extract doc_ids for batch fetching
                        chunk_doc_ids = []
                        valid_chunks = []
                        for chunk in chunks_needing_metadata:
                            doc_id = chunk.get('doc_id') or chunk.get('document_id')
                            if doc_id:
                                chunk_doc_ids.append(doc_id)
                                valid_chunks.append(chunk)
                            else:
                                logger.warning(
                                    "[PROCESS_DOCUMENTS] Chunk %s missing doc_id, skipping metadata creation",
                                    chunk.get('chunk_index', 'unknown')
                                )
                                chunk['source_chunks_metadata'] = []
                        
                        if valid_chunks:
                            # Batch fetch all metadata
                            batch_metadata = await batch_create_source_chunks_metadata(valid_chunks, chunk_doc_ids)
                            
                            # Attach metadata to chunks using (doc_id, chunk_index) key
                            for chunk, doc_id in zip(valid_chunks, chunk_doc_ids):
                                chunk_index = chunk.get('chunk_index', 0)
                                metadata_key = (doc_id, chunk_index)
                                
                                if metadata_key in batch_metadata:
                                    chunk_metadata = batch_metadata[metadata_key]
                                    chunk['source_chunks_metadata'] = [chunk_metadata]
                                    
                                    blocks_count = len(chunk_metadata.get('blocks', [])) if chunk_metadata.get('blocks') else 0
                                    logger.debug(
                                        "[PROCESS_DOCUMENTS] Created metadata for chunk %d (doc %s, %d blocks)",
                                        chunk_index,
                                        doc_id[:8],
                                        blocks_count
                                    )
                                else:
                                    logger.warning(
                                        "[PROCESS_DOCUMENTS] No metadata found for chunk %d (doc %s)",
                                        chunk_index,
                                        doc_id[:8]
                                    )
                                    chunk['source_chunks_metadata'] = []
                    except Exception as e:
                        logger.warning(
                            "[PROCESS_DOCUMENTS] Batch metadata creation failed, falling back to individual: %s",
                            str(e)
                        )
                        # Fallback to individual processing
                        for chunk in chunks_needing_metadata:
                            doc_id = chunk.get('doc_id') or chunk.get('document_id')
                            if not doc_id:
                                chunk['source_chunks_metadata'] = []
                                continue
                            
                            try:
                                chunk_metadata = await create_source_chunks_metadata_for_single_chunk(chunk, doc_id)
                                chunk['source_chunks_metadata'] = [chunk_metadata]
                            except Exception as e2:
                                logger.warning(
                                    "[PROCESS_DOCUMENTS] Failed to create metadata for chunk %s: %s",
                                    chunk.get('chunk_index', 'unknown'),
                                    str(e2)
                                )
                                chunk['source_chunks_metadata'] = []
            else:
                logger.debug(
                    "[PROCESS_DOCUMENTS] All %d chunks already have source_chunks_metadata",
                    len(relevant_docs)
                )

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
            "citation_context": state.get("citation_context"),  # NEW: Pass citation context for focused retrieval
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
            
            # OPTIMIZATION: Pre-format document during processing to parallelize with LLM calls
            # This saves time in summarize_results by doing formatting work in parallel
            # Format after all metadata is added to ensure complete data
            # NOTE: Block IDs start from 1 per-document here. They will be renumbered
            # in summary_nodes.py to ensure global uniqueness across all documents.
            try:
                # Format document with block IDs and create metadata lookup table
                formatted_content, metadata_table, _ = format_document_with_block_ids(result)
                
                # Store formatted content and metadata in result
                result['formatted_content'] = formatted_content
                result['formatted_metadata_table'] = metadata_table
                result['is_formatted'] = True  # Flag to skip formatting in summarize_results
                
                logger.debug(
                    "[PROCESS_DOCUMENTS] Pre-formatted doc %s with %d block IDs",
                    result.get("doc_id", "")[:8],
                    len(metadata_table) if metadata_table else 0
                )
            except Exception as format_error:
                logger.warning(
                    "[PROCESS_DOCUMENTS] Failed to pre-format doc %s: %s (will format in summarize_results)",
                    result.get("doc_id", "")[:8],
                    str(format_error)
                )
                result['is_formatted'] = False
            
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





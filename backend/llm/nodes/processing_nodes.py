"""
Document processing nodes - handles per-document LLM analysis.
This is where each document gets processed with the user's question.
"""

import asyncio
import logging
from typing import List, Optional

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


async def process_documents(
    state: MainWorkflowState,
    graph_config: Optional[dict] = None  # LangGraph passes config as second parameter
) -> MainWorkflowState:
    """
    Process each relevant document with the QA subgraph in parallel.
    
    Args:
        state: Main workflow state containing relevant_documents
        graph_config: LangGraph config dict with thread_id (passed automatically by LangGraph)
                     Format: {"configurable": {"thread_id": "user_123"}}
                     Subgraphs inherit parent's checkpointer when this is provided.
    """

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
            # NEW: Preserve source chunks metadata if available
            if doc.get('source_chunks_metadata'):
                result['source_chunks_metadata'] = doc.get('source_chunks_metadata')
            stubbed.append(result)
        return {"document_outputs": stubbed}

    # NEW: Group chunks by doc_id to avoid processing same document multiple times
    # This is critical for fast path where all chunks from one document are fetched
    # Instead of 150 LLM calls (one per chunk), we make 1 LLM call (one per document)
    from collections import defaultdict
    docs_by_id = defaultdict(lambda: {
        'chunks': [],
        'metadata': {}
    })
    
    for doc in relevant_docs:
        doc_id = doc.get("doc_id", "")
        if doc_id:
            docs_by_id[doc_id]['chunks'].append(doc)
            # Store metadata from first chunk (they should all be the same for same doc)
            if not docs_by_id[doc_id]['metadata']:
                docs_by_id[doc_id]['metadata'] = {
                    'property_id': doc.get("property_id"),
                    'classification_type': doc.get('classification_type', 'Unknown'),
                    'original_filename': doc.get('original_filename'),
                    'property_address': doc.get('property_address'),
                    'source': doc.get('source', 'unknown'),
                }
    
    # Combine chunks for each document
    combined_docs = []
    for doc_id, doc_data in docs_by_id.items():
        chunks = doc_data['chunks']
        metadata = doc_data['metadata']
        
        if len(chunks) == 1:
            # Single chunk - use as is but ensure bbox metadata is preserved
            chunk = chunks[0]
            chunk['source_chunks_metadata'] = [{
                'chunk_index': chunk.get('chunk_index'),
                'page_number': chunk.get('page_number'),
                'bbox': chunk.get('bbox'),
                'content': chunk.get('content', ''),  # Full content for accurate position mapping
                'vector_id': chunk.get('vector_id')
            }]
            combined_docs.append(chunk)
        else:
            # Multiple chunks from same document - combine them
            # Sort by page_number and chunk_index to maintain order
            sorted_chunks = sorted(
                chunks,
                key=lambda x: (
                    x.get('page_number', 0),
                    x.get('chunk_index', 0)
                )
            )
            
            # Combine all chunk texts with page markers for better context
            # Format: [Page X] content... [Page Y] content...
            combined_content_parts = []
            current_page = None
            
            for chunk in sorted_chunks:
                chunk_text = chunk.get("content", "").strip()
                if not chunk_text:
                    continue
                
                page_num = chunk.get('page_number', 0)
                
                # Add page marker if page changed
                if page_num != current_page:
                    combined_content_parts.append(f"\n[Page {page_num}]\n")
                    current_page = page_num
                
                combined_content_parts.append(chunk_text)
            
            combined_content = "\n".join(combined_content_parts)
            
            # Create combined document with all metadata preserved
            combined_doc = {
                "doc_id": doc_id,
                "content": combined_content,
                "property_id": metadata.get('property_id'),
                "classification_type": metadata.get('classification_type', 'Unknown'),
                "original_filename": metadata.get('original_filename'),
                "property_address": metadata.get('property_address'),
                "source": metadata.get('source', 'unknown'),
                "similarity_score": max([chunk.get('similarity_score', 0.0) for chunk in chunks]),
                # CRITICAL: Store all chunks metadata with bbox and blocks for citations
                "source_chunks_metadata": [
                    {
                        'chunk_index': chunk.get('chunk_index'),
                        'page_number': chunk.get('page_number'),
                        'bbox': chunk.get('bbox'),  # Chunk-level bbox (fallback)
                        'blocks': chunk.get('blocks', []),  # Block-level bboxes for precise citations
                        'content': chunk.get('content', ''),  # Full content for accurate position mapping
                        'vector_id': chunk.get('vector_id')  # For reference
                    }
                    for chunk in sorted_chunks
                ],
                # Store page range for display
                "page_numbers": sorted(list(set([
                    chunk.get('page_number', 0) for chunk in sorted_chunks
                ]))),
                "page_range": f"pages {min([chunk.get('page_number', 0) for chunk in sorted_chunks])}-{max([chunk.get('page_number', 0) for chunk in sorted_chunks])}"
            }
            combined_docs.append(combined_doc)
            
            logger.info(
                "[PROCESS_DOCUMENTS] Combined %d chunks from document %s (%s) into single processing task",
                len(chunks),
                doc_id[:8],
                metadata.get('original_filename', 'Unknown')
            )
    
    logger.info(
        "[PROCESS_DOCUMENTS] Processing %d documents in parallel (reduced from %d chunks)",
        len(combined_docs),
        len(relevant_docs)
    )

    # Build subgraph once (inherits parent's checkpointer automatically)
    qa_subgraph = build_document_qa_subgraph()
    
    # Use provided config or empty dict (for stateless mode)
    # LangGraph automatically passes config to nodes when graph has checkpointer
    subgraph_config = graph_config if graph_config else {}

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
            # CRITICAL: Pass config to subgraph so it inherits checkpointer and uses same thread_id
            # This ensures all subgraphs checkpoint correctly under the same thread_id
            # Each subgraph gets unique step_path: main_graph.process_documents.doc1, doc2, etc.
            output_state = await qa_subgraph.ainvoke(subgraph_state, config=subgraph_config)
            
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
            # Handle prepared statement errors gracefully (non-fatal, LangGraph retries internally)
            error_msg = str(exc)
            if "DuplicatePreparedStatement" in error_msg or "_pg3_" in error_msg:
                logger.debug(
                    "[PROCESS_DOCUMENTS] Prepared statement conflict for doc %s (non-fatal, retrying): %s",
                    subgraph_state["doc_id"][:8],
                    error_msg[:100]
                )
                # Retry once - LangGraph's checkpointer will handle the retry
                try:
                    await asyncio.sleep(0.1)  # Brief delay to avoid immediate retry conflict
                    output_state = await qa_subgraph.ainvoke(subgraph_state, config=subgraph_config)
                    source_chunks_metadata = doc.get('source_chunks_metadata')
                    result = _build_processing_result(output_state, source_chunks_metadata=source_chunks_metadata)
                    # Add metadata
                    result['doc_id'] = doc.get('doc_id', '')
                    result['classification_type'] = doc.get('classification_type', 'Unknown')
                    result['page_range'] = doc.get('page_range', 'unknown')
                    result['page_numbers'] = doc.get('page_numbers', [])
                    result['original_filename'] = doc.get('original_filename')
                    result['property_address'] = doc.get('property_address')
                    result['search_source'] = doc.get('source', 'unknown')
                    result['similarity_score'] = doc.get('similarity_score', 0.0)
                    return result
                except Exception as retry_exc:
                    logger.warning(
                        "[PROCESS_DOCUMENTS] Retry also failed for doc %s: %s",
                        subgraph_state["doc_id"][:8],
                        retry_exc
                    )
            
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

    # Run all subgraphs concurrently - each gets unique step_path in checkpoints
    # All share same thread_id from config, so they checkpoint under same conversation
    # Process combined documents (not individual chunks)
    results: List[DocumentProcessingResult] = await asyncio.gather(
        *(process_one(doc) for doc in combined_docs)
    )

    logger.info("[PROCESS_DOCUMENTS] Completed all %d documents", len(results))
    return {"document_outputs": results}





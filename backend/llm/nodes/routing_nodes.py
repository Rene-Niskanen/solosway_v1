"""
Intelligent routing nodes for optimizing query processing.
Routes queries to fast paths or full pipeline based on complexity and context.

FAST ROUTER: 4 execution paths for speed optimization
- direct_document: ~2s (user attached files)
- property_document: ~4s (property-specific query)
- simple_search: ~6s (simple query, skip expansion/clarify)
- complex_search: ~12s (full pipeline)
"""

import logging
import re
from typing import List
from backend.llm.types import MainWorkflowState, RetrievedDocument
from backend.services.supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)


def _query_for_direct_document_retrieval(user_query: str, document_filenames: List[str]) -> str:
    """
    Strip document filename references from the query so retrieval is intent-based.
    When the user asks "what is the EPC rating of [document chip: Highlands_Berden_...]",
    the chip text is the document name; using that in semantic search can match the wrong
    chunks (filename-style text instead of the EPC section). We keep only the intent
    part (e.g. "what is the EPC rating") for retrieve_chunks.
    """
    if not user_query or not document_filenames:
        return user_query or ""
    q = user_query.strip()
    for filename in document_filenames:
        if not filename:
            continue
        # Exact filename (with or without extension)
        name_no_ext = re.sub(r"\.[a-zA-Z0-9]+$", "", filename)
        for candidate in (filename, name_no_ext):
            if not candidate:
                continue
            # Case-insensitive remove; also remove truncated form (chip often shows shortened name)
            pattern = re.escape(candidate)
            q = re.sub(pattern, " ", q, flags=re.IGNORECASE)
        # Chip display is often truncated (e.g. "Highlands_Berden_Bishops_St..."); try filename prefixes
        for length in (35, 30, 25, 20):
            prefix = (name_no_ext or filename)[:length]
            if len(prefix) >= 10:
                q = re.sub(re.escape(prefix) + r"\.?\.?\.?", " ", q, flags=re.IGNORECASE)
    # Strip trailing segment that looks like a chip/filename (Word_Word_...)
    q = re.sub(r"\s+[A-Za-z0-9]+_[A-Za-z0-9_]+\.?\.?\.?\s*$", " ", q)
    # Collapse spaces and strip; remove trailing "of" / "for" so we don't end with "what is the EPC rating of"
    q = re.sub(r"\s+", " ", q).strip()
    q = re.sub(r"\s+(of|for)\s*$", "", q, flags=re.IGNORECASE).strip()
    return q


def route_query(state: MainWorkflowState) -> MainWorkflowState:
    """
    FAST ROUTER: Determines execution path based on query complexity and context.
    
    Routing decisions (in order):
    0. "navigation_action": Navigation queries in agent mode → INSTANT path (~0.1s)
    1. "attachment_fast": ONLY if attachment_context has content AND response_mode='fast' → FASTEST path (~2s)
    2. "citation_query": ONLY if citation_context has content → FASTEST path (~2s)
    3. "direct_document": User attached file(s) → Fastest path (~2s)
    4. "property_document": Property-specific query → Fast path (~4s)
    5. "simple_search": Simple query → Medium path (~6s)
    6. "complex_search": Complex query → Full pipeline (~12s)
    
    CRITICAL: Attachment/citation checks ONLY run if values exist AND have actual content.
    Normal queries (None values) skip these checks entirely and use original routing.
    
    Returns:
        State with route_decision and optimization flags
    """
    user_query = state.get("user_query", "").lower().strip()
    document_ids = state.get("document_ids", [])
    property_id = state.get("property_id")
    citation_context = state.get("citation_context")
    attachment_context = state.get("attachment_context")
    response_mode = state.get("response_mode")
    is_agent_mode = state.get("is_agent_mode", False)
    
    # PATH -1: NAVIGATION ACTION (INSTANT - NO DOCUMENT RETRIEVAL)
    # Check for navigation queries FIRST to avoid any document processing
    if is_agent_mode:
        navigation_patterns = [
            "take me to the", "take me to ", "please take me to", "please take me to the",
            "go to the map", "navigate to the", "please navigate to", "please navigate to the",
            "show me on the map", "show on map", "find on map", "open the map",
            "go to map", "click on the", "select the pin", "click the pin",
            "please show me", "please go to", "please find"
        ]
        pin_patterns = [" pin", "property pin", "map pin"]
        info_keywords = ["value", "price", "cost", "worth", "valuation", "report", 
                       "inspection", "document", "tell me about", "what is", "how much",
                       "summary", "details", "information", "data"]
        
        is_info_query = any(keyword in user_query for keyword in info_keywords)
        if not is_info_query:
            has_navigation_intent = any(pattern in user_query for pattern in navigation_patterns)
            has_pin_intent = any(pattern in user_query for pattern in pin_patterns)
            
            if has_navigation_intent or has_pin_intent:
                logger.info(f"⚡ [ROUTER] INSTANT PATH: Navigation action detected: '{user_query}'")
                return {
                    "route_decision": "navigation_action",
                    "workflow": "navigation",
                    "skip_expansion": True,
                    "skip_vector_search": True,
                    "skip_clarify": True,
                    "skip_process_documents": True,
                    "skip_retrieval": True
                }
    
    # PATH 0: ATTACHMENT FAST - DISABLED FOR DEBUGGING NORMAL QUERIES
    # Check if attachment_context exists AND has actual text content AND response_mode is 'fast'
    # TEMPORARILY DISABLED to focus on normal query routing
    # if attachment_context and response_mode:
    #     # Normalize empty values to None
    #     if attachment_context == {} or attachment_context == 'null' or attachment_context == '':
    #         attachment_context = None
    #     if response_mode == '' or response_mode == 'null':
    #         response_mode = None
    #     
    #     # Only proceed if both are still valid after normalization
    #     if attachment_context and response_mode == 'fast':
    #         # Verify attachment_context has actual content (not just empty dict)
    #         if isinstance(attachment_context, dict):
    #             texts = attachment_context.get('texts', [])
    #             if texts and len(texts) > 0 and any(len(str(text).strip()) > 0 for text in texts):
    #                 logger.info("⚡ [ROUTER] ATTACHMENT FAST PATH: Using attached file content directly")
    #                 logger.info(f"[ROUTER] Attachment context: {len(texts)} file(s)")
    #                 return {
    #                     "route_decision": "attachment_fast",
    #                     "workflow": "attachment_direct",
    #                     "skip_expansion": True,
    #                     "skip_vector_search": True,
    #                     "skip_clarify": True,
    #                     "skip_process_documents": True,
    #                     "skip_retrieval": True
    #                 }
    
    # ORIGINAL ROUTING LOGIC - Restored from HEAD (citation routing removed for normal queries)
    # FIX: Ensure document_ids is always a list (safety check)
    if document_ids and not isinstance(document_ids, list):
        document_ids = [str(document_ids)]
        logger.warning(f"[ROUTER] document_ids was not a list, converted: {document_ids}")
    elif not document_ids:
        document_ids = []
    
    logger.info(
        f"[ROUTER] Query: '{user_query[:50]}...' | "
        f"Docs: {document_ids} (count: {len(document_ids)}) | "
        f"Property: {property_id[:8] if property_id else 'None'}"
    )
    
    # PATH 1: DIRECT DOCUMENT (FASTEST ~2s)
    if document_ids and len(document_ids) > 0:
        logger.info("🟢 [ROUTER] FAST PATH: Direct document processing")
        logger.info(f"[ROUTER] Setting route_decision='direct_document', target_document_ids={document_ids}")
        return {
            "route_decision": "direct_document",
            "workflow": "direct",
            "target_document_ids": document_ids,
            "skip_expansion": True,
            "skip_vector_search": True,
            "skip_clarify": True
        }
    
    # PATH 2: PROPERTY CONTEXT (FAST ~4s)
    if property_id and any(word in user_query for word in [
        "report", "document", "inspection", "appraisal", "valuation", 
        "lease", "contract", "the document", "this document", "that document"
    ]):
        logger.info("🟢 [ROUTER] FAST PATH: Property-specific document search")
        return {
            "route_decision": "property_document",
            "workflow": "property_docs",
            "target_property_id": property_id,
            "skip_expansion": True,
            "skip_clarify": True,
            "skip_vector_search": False
        }
    
    # PATH 3: SIMPLE QUERY (MEDIUM ~6s)
    word_count = len(user_query.split())
    simple_keywords = [
        "what is", "what's", "how much", "how many", "price", "cost", 
        "value", "when", "where", "who"
    ]
    
    if word_count <= 8 or any(kw in user_query for kw in simple_keywords):
        logger.info("🟡 [ROUTER] MEDIUM PATH: Simple query (vector only)")
        return {
            "route_decision": "simple_search",
            "workflow": "simple_vector",
            "skip_expansion": True,
            "skip_clarify": False,
            "skip_vector_search": False
        }
    
    # PATH 4: COMPLEX QUERY (FULL ~12s)
    logger.info("🔴 [ROUTER] FULL PATH: Complex research query")
    return {
        "route_decision": "complex_search",
        "workflow": "full_research",
        "skip_expansion": False,
        "skip_clarify": False,
        "skip_vector_search": False
    }


async def _fetch_citation_focused_chunks(
    state: MainWorkflowState,
    citation_context: dict,
    doc_id: str,
    user_query: str
) -> list:
    """
    OPTIMIZED: Fast citation-focused retrieval.
    
    Strategy:
    1. Find chunk containing the citation block_id (same page)
    2. Search chunks on same page first (fastest)
    3. Expand to ±2 pages if not enough results
    4. Fall back to normal vector search if still insufficient
    
    Returns:
        List of RetrievedDocument chunks focused around citation
    """
    from backend.llm.types import RetrievedDocument
    from backend.services.supabase_client_factory import get_supabase_client
    
    page_number = citation_context.get("page_number", 0)
    block_id = citation_context.get("block_id", "")
    business_id = state.get("business_id")
    
    logger.info(f"⚡ [CITATION_FOCUSED] Starting focused search - doc: {doc_id[:8]}, page: {page_number}, block_id: {block_id[:20] if block_id else 'none'}")
    
    supabase = get_supabase_client()
    retrieved_docs: list[RetrievedDocument] = []
    
    try:
        # Get document metadata
        doc_result = supabase.table('documents')\
            .select('id, original_filename, classification_type, property_id, document_summary')\
            .eq('id', doc_id)\
            .eq('business_uuid', business_id)\
            .limit(1)\
            .execute()
        
        if not doc_result.data:
            logger.warning(f"[CITATION_FOCUSED] Document {doc_id[:8]} not found")
            return []
        
        doc_metadata = doc_result.data[0]
        filename = doc_metadata.get('original_filename', 'Unknown')
        doc_type = doc_metadata.get('classification_type', 'unknown')
        doc_property_id = doc_metadata.get('property_id')
        
        # STEP 1: Find chunks on the same page (fastest - no vector search needed)
        logger.info(f"⚡ [CITATION_FOCUSED] Step 1: Fetching chunks from page {page_number}")
        page_chunks_result = supabase.table('document_vectors')\
            .select('id, chunk_text, chunk_index, page_number, bbox, blocks, embedding_status')\
            .eq('document_id', doc_id)\
            .eq('page_number', page_number)\
            .order('chunk_index', desc=False)\
            .limit(50)\
            .execute()
        
        page_chunks = page_chunks_result.data if page_chunks_result.data else []
        logger.info(f"⚡ [CITATION_FOCUSED] Found {len(page_chunks)} chunks on page {page_number}")
        
        # Convert to RetrievedDocument format
        for chunk in page_chunks:
            # Check if this chunk contains the citation block_id
            blocks = chunk.get('blocks', [])
            contains_citation = False
            if block_id and blocks:
                # Check if any block in this chunk matches the citation block_id
                block_ids_in_chunk = [b.get('id', '') for b in blocks if isinstance(b, dict)]
                contains_citation = block_id in block_ids_in_chunk
            
            retrieved_doc: RetrievedDocument = {
                "vector_id": chunk.get('id', ''),
                "doc_id": doc_id,
                "property_id": doc_property_id,
                "content": chunk.get('chunk_text', ''),
                "classification_type": doc_type,
                "chunk_index": chunk.get('chunk_index', 0),
                "page_number": chunk.get('page_number', 0),
                "bbox": chunk.get('bbox'),
                "blocks": blocks,
                "similarity_score": 1.0 if contains_citation else 0.9,  # Boost citation chunk
                "source": "citation_focused",
                "address_hash": None,
                "business_id": business_id,
                "original_filename": filename,
                "property_address": None
            }
            retrieved_docs.append(retrieved_doc)
        
        # STEP 2: Expand to nearby pages first (±2 pages for high relevance)
        if user_query and len(retrieved_docs) < 10:
            logger.info(f"⚡ [CITATION_FOCUSED] Step 2: Expanding to nearby pages (±2 pages)")
            nearby_pages = [page_number - 2, page_number - 1, page_number + 1, page_number + 2]
            nearby_pages = [p for p in nearby_pages if p > 0]  # Remove invalid pages
            
            for nearby_page in nearby_pages:
                nearby_result = supabase.table('document_vectors')\
                    .select('id, chunk_text, chunk_index, page_number, bbox, blocks, embedding_status')\
                    .eq('document_id', doc_id)\
                    .eq('page_number', nearby_page)\
                    .order('chunk_index', desc=False)\
                    .limit(20)\
                    .execute()
                
                if nearby_result.data:
                    for chunk in nearby_result.data:
                        # Skip if we already have this chunk
                        if any(doc.get('chunk_index') == chunk.get('chunk_index') 
                               and doc.get('doc_id') == doc_id 
                               for doc in retrieved_docs):
                            continue
                        
                        retrieved_doc: RetrievedDocument = {
                            "vector_id": chunk.get('id', ''),
                            "doc_id": doc_id,
                            "property_id": doc_property_id,
                            "content": chunk.get('chunk_text', ''),
                            "classification_type": doc_type,
                            "chunk_index": chunk.get('chunk_index', 0),
                            "page_number": chunk.get('page_number', 0),
                            "bbox": chunk.get('bbox'),
                            "blocks": chunk.get('blocks'),
                            "similarity_score": 0.8,  # Lower score for nearby pages
                            "source": "citation_focused",
                            "address_hash": None,
                            "business_id": business_id,
                            "original_filename": filename,
                            "property_address": None
                        }
                        retrieved_docs.append(retrieved_doc)
            
            logger.info(f"⚡ [CITATION_FOCUSED] After ±2 page expansion: {len(retrieved_docs)} total chunks")
        
        # STEP 3: ALWAYS search the ENTIRE document to ensure we don't miss relevant info
        # This prioritizes the cited document over fallback to generic vector search
        if len(retrieved_docs) < 15:
            logger.info(f"⚡ [CITATION_FOCUSED] Step 3: Searching ENTIRE document for more context")
            
            # Get ALL chunks from the document that we don't already have
            all_chunks_result = supabase.table('document_vectors')\
                .select('id, chunk_text, chunk_index, page_number, bbox, blocks, embedding_status')\
                .eq('document_id', doc_id)\
                .order('page_number', desc=False)\
                .order('chunk_index', desc=False)\
                .limit(100)\
                .execute()
            
            if all_chunks_result.data:
                existing_chunk_indices = {doc.get('chunk_index') for doc in retrieved_docs}
                
                for chunk in all_chunks_result.data:
                    chunk_idx = chunk.get('chunk_index', 0)
                    # Skip if we already have this chunk
                    if chunk_idx in existing_chunk_indices:
                        continue
                    
                    # Calculate distance from citation page for scoring
                    chunk_page = chunk.get('page_number', 0)
                    page_distance = abs(chunk_page - page_number)
                    # Score decreases with distance: 0.7 for adjacent pages, down to 0.5 for far pages
                    distance_score = max(0.5, 0.7 - (page_distance * 0.02))
                    
                    retrieved_doc: RetrievedDocument = {
                        "vector_id": chunk.get('id', ''),
                        "doc_id": doc_id,
                        "property_id": doc_property_id,
                        "content": chunk.get('chunk_text', ''),
                        "classification_type": doc_type,
                        "chunk_index": chunk_idx,
                        "page_number": chunk_page,
                        "bbox": chunk.get('bbox'),
                        "blocks": chunk.get('blocks'),
                        "similarity_score": distance_score,
                        "source": "citation_focused_full_doc",
                        "address_hash": None,
                        "business_id": business_id,
                        "original_filename": filename,
                        "property_address": None
                    }
                    retrieved_docs.append(retrieved_doc)
                
                logger.info(f"⚡ [CITATION_FOCUSED] After full document search: {len(retrieved_docs)} total chunks")
        
        # Sort by similarity (citation chunk first, then same page, then nearby, then rest of doc)
        retrieved_docs.sort(key=lambda x: x.get('similarity_score', 0), reverse=True)
        
        logger.info(f"⚡ [CITATION_FOCUSED] ✅ Focused retrieval complete: {len(retrieved_docs)} chunks from SAME document")
        return retrieved_docs[:30]  # Limit to top 30 for performance
        
    except Exception as e:
        logger.error(f"[CITATION_FOCUSED] Error in focused retrieval: {e}", exc_info=True)
        return []


async def fetch_direct_document_chunks(state: MainWorkflowState) -> MainWorkflowState:
    """
    Fast path: Fetch chunks from specific document(s) by reusing the normal retrieval path.
    
    When a user_query is provided, delegates to query_vector_documents (normal retrieval path)
    which already handles document_ids filtering, header retrieval, hybrid search, etc.
    When no query is provided, falls back to fetching all chunks sequentially.
    Used when user attaches file(s) to chat.
    
    Returns:
        State with relevant_documents populated from direct chunk fetch
    """
    # Check both target_document_ids (from route_query) and document_ids (from initial state)
    document_ids = state.get("target_document_ids") or state.get("document_ids", [])
    
    # FIX: Ensure document_ids is always a list (safety check)
    if document_ids and not isinstance(document_ids, list):
        document_ids = [str(document_ids)]
        logger.info(f"[DIRECT_DOC] Converted document_ids to list: {document_ids}")
    elif not document_ids:
        document_ids = []
    
    property_id = state.get("target_property_id") or state.get("property_id")
    business_id = state.get("business_id")
    user_query = state.get("user_query", "").strip()
    
    logger.info(
        f"[DIRECT_DOC] Fetching chunks - document_ids: {document_ids}, "
        f"property_id: {property_id[:8] if property_id else 'None'}, "
        f"has_query: {bool(user_query)}"
    )
    
    # If no document_ids but property_id provided, try to find document
    if not document_ids and property_id:
        try:
            supabase = get_supabase_client()
            result = supabase.table('document_relationships')\
                .select('document_id')\
                .eq('property_id', property_id)\
                .limit(1)\
                .execute()
            if result.data:
                document_ids = [result.data[0]['document_id']]
                logger.info(f"[DIRECT_DOC] Found document {document_ids[0][:8]} for property {property_id[:8]}")
        except Exception as e:
            logger.warning(f"[DIRECT_DOC] Could not find document for property: {e}")
    
    if not document_ids:
        logger.warning(
            f"[DIRECT_DOC] No document_ids to fetch. "
            f"State keys: {list(state.keys())}, "
            f"target_document_ids: {state.get('target_document_ids')}, "
            f"document_ids: {state.get('document_ids')}"
        )
        return {"relevant_documents": []}
    
    # OPTIMIZATION: If citation_context is present, use focused citation retrieval first
    citation_context = state.get("citation_context")
    if citation_context and citation_context.get("cited_text") and len(document_ids) == 1:
        doc_id = document_ids[0]
        logger.info(f"⚡ [DIRECT_DOC] Citation query detected - using focused citation retrieval")
        
        # Try focused citation retrieval first (fast - searches around citation)
        focused_chunks = await _fetch_citation_focused_chunks(
            state, citation_context, doc_id, user_query
        )
        
        if focused_chunks and len(focused_chunks) >= 1:
            # We have focused results from the cited document - ALWAYS use them!
            # This ensures citation queries ALWAYS prioritize the cited document
            logger.info(f"⚡ [DIRECT_DOC] ✅ Focused retrieval successful: {len(focused_chunks)} chunks from cited document")
            return {
                "relevant_documents": focused_chunks,
                "target_document_ids": document_ids
            }
        else:
            # No results at all - fall back to normal vector search
            logger.info(f"⚡ [DIRECT_DOC] Focused retrieval found 0 chunks, falling back to vector search")
            # Continue to normal retrieval below
    
    # Query-aware branch: when user_query is non-empty, use retrieve_chunks (vector/hybrid within docs) instead of fetch-all
    if user_query and business_id:
        from backend.llm.tools.chunk_retriever_tool import retrieve_chunks
        # When the query was built from a document chip, it often contains the document name
        # (e.g. "what is the EPC rating of Highlands_Berden_Bishops_St..."). Use intent-only
        # query for retrieval so we match content (EPC section) not filename-style text.
        retrieval_query = user_query
        try:
            doc_result = get_supabase_client().table("documents").select("original_filename").in_("id", document_ids).eq("business_uuid", business_id).execute()
            if doc_result.data:
                filenames = [r.get("original_filename") or "" for r in doc_result.data if r.get("original_filename")]
                if filenames:
                    intent_query = _query_for_direct_document_retrieval(user_query, filenames)
                    if intent_query and len(intent_query.strip()) >= 5:
                        retrieval_query = intent_query.strip()
                        logger.info(
                            "[DIRECT_DOC] Using intent-only query for retrieval: %r -> %r",
                            user_query[:60],
                            retrieval_query[:60],
                        )
        except Exception as e:  # pylint: disable=broad-except
            logger.debug("[DIRECT_DOC] Could not normalize query for retrieval: %s", e)
        logger.info(
            "[DIRECT_DOC] Query provided; using retrieve_chunks document_ids=%s query=%s",
            document_ids,
            retrieval_query[:80] if len(retrieval_query) > 80 else retrieval_query,
        )
        chunks_result = retrieve_chunks(
            query=retrieval_query,
            document_ids=document_ids,
            business_id=business_id,
        )
        if chunks_result:
            # Convert retrieve_chunks return to List[RetrievedDocument]
            retrieved_docs: List[RetrievedDocument] = []
            for c in chunks_result:
                retrieved_docs.append({
                    "vector_id": c.get("chunk_id", ""),
                    "doc_id": c.get("document_id", ""),
                    "property_id": None,
                    "content": c.get("chunk_text") or c.get("chunk_text_clean") or "",
                    "classification_type": c.get("document_type") or "unknown",
                    "chunk_index": c.get("chunk_index", 0),
                    "page_number": c.get("page_number", 0),
                    "bbox": c.get("bbox"),
                    "similarity_score": float(c.get("score", 0.0)),
                    "source": "direct_document",
                    "address_hash": None,
                    "business_id": business_id,
                    "original_filename": c.get("document_filename") or "Unknown",
                    "property_address": None,
                    "blocks": c.get("blocks"),
                })
            logger.info("[DIRECT_DOC] Retrieved %d chunks (query-based).", len(retrieved_docs))
            return {
                "relevant_documents": retrieved_docs,
                "target_document_ids": document_ids,
            }
        logger.warning("[DIRECT_DOC] Query-based retrieval returned 0 chunks; falling back to fetch-all.")
    
    # Fetch chunks directly from documents (agent will handle query filtering in summarize_results)
    # This is the fast path - we fetch chunks and let the agent use tools to filter if needed
    try:
        supabase = get_supabase_client()
        retrieved_docs: List[RetrievedDocument] = []
        
        # Fetch chunks for each document
        for doc_id in document_ids:
            # Get document metadata
            doc_result = supabase.table('documents')\
                .select('id, original_filename, classification_type, property_id')\
                .eq('id', doc_id)\
                .eq('business_uuid', business_id)\
                .limit(1)\
                .execute()
            
            if not doc_result.data:
                logger.warning(f"[DIRECT_DOC] Document {doc_id[:8]} not found or unauthorized")
                continue
            
            doc_metadata = doc_result.data[0]
            filename = doc_metadata.get('original_filename', 'Unknown')
            doc_type = doc_metadata.get('classification_type', 'unknown')
            doc_property_id = doc_metadata.get('property_id')
            
            # Fetch ALL chunks sequentially (for cases where user just wants to see the document)
            logger.info(f"[DIRECT_DOC] No query provided, fetching all chunks from document: {filename}")
            
            chunks_result = supabase.table('document_vectors')\
                .select('id, chunk_text, chunk_index, page_number, bbox, blocks, embedding_status')\
                .eq('document_id', doc_id)\
                .order('chunk_index', desc=False)\
                .execute()
            
            if not chunks_result.data:
                logger.warning(f"[DIRECT_DOC] No chunks found for document {doc_id[:8]}")
                continue
            
            logger.info(f"[DIRECT_DOC] Fetched {len(chunks_result.data)} chunks from {filename}")
            
            # Convert to RetrievedDocument format
            for chunk in chunks_result.data:
                retrieved_doc: RetrievedDocument = {
                    "vector_id": chunk.get('id', ''),
                    "doc_id": doc_id,
                    "property_id": doc_property_id,
                    "content": chunk.get('chunk_text', ''),
                    "classification_type": doc_type,
                    "chunk_index": chunk.get('chunk_index', 0),
                    "page_number": chunk.get('page_number', 0),
                    "bbox": chunk.get('bbox'),
                    "blocks": chunk.get('blocks'),
                    "similarity_score": 1.0,  # Perfect match (direct document, no query)
                    "source": "direct_document",
                    "address_hash": None,
                    "business_id": business_id,
                    "original_filename": filename,
                    "property_address": None
                }
                retrieved_docs.append(retrieved_doc)
        
        logger.info(f"[DIRECT_DOC] Total chunks fetched: {len(retrieved_docs)}")
        return {
            "relevant_documents": retrieved_docs,
            "target_document_ids": document_ids
        }
        
    except Exception as e:
        logger.error(f"[DIRECT_DOC] Error fetching document chunks: {e}", exc_info=True)
        return {"relevant_documents": []}


async def handle_attachment_fast(state: MainWorkflowState) -> MainWorkflowState:
    """
    ULTRA-FAST attachment query handler (~2s).
    
    When user attaches file(s) and selects "fast response", we use the extracted text
    directly with a single LLM call. No retrieval, no document search - just answer
    based on the attached file content.
    
    Returns:
        State with final_summary (ready for format_response)
    """
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage, SystemMessage
    from backend.llm.config import config
    from backend.llm.prompts import get_attachment_prompt
    
    attachment_context = state.get("attachment_context", {})
    response_mode = state.get("response_mode", "fast")
    user_query = state.get("user_query", "")
    
    logger.info(f"⚡ [ATTACHMENT_FAST] Processing attachment query - mode: {response_mode}")
    logger.info(f"[ATTACHMENT_FAST] Files: {len(attachment_context.get('texts', []))}")
    
    if not attachment_context or not attachment_context.get('texts'):
        logger.warning("[ATTACHMENT_FAST] No attachment context - falling back to normal flow")
        return {"final_summary": "I couldn't find any attached document content to analyze."}
    
    # Get the attachment prompt
    prompt = get_attachment_prompt(response_mode, attachment_context, user_query)
    
    # Single fast LLM call
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )
    
    from backend.llm.prompts.routing import get_attachment_fast_system_prompt

    system_msg = SystemMessage(content=get_attachment_fast_system_prompt())
    human_msg = HumanMessage(content=prompt)
    
    logger.info(f"[ATTACHMENT_FAST] Calling LLM with {len(prompt)} chars of context")
    response = await llm.ainvoke([system_msg, human_msg])
    
    final_summary = response.content.strip()
    logger.info(f"[ATTACHMENT_FAST] Response generated: {len(final_summary)} chars")
    
    return {"final_summary": final_summary}


async def handle_citation_query(state: MainWorkflowState) -> MainWorkflowState:
    """
    Citation query handler (user asked a follow-up from a citation chip).
    
    When user asks about a specific citation, we already have:
    - The exact document ID, page, bbox, and cited text
    
    We do a single LLM call with the cited text + user query (no retrieval).
    No automatic document opening: answer only, no agent tools (user preference).
    
    Returns:
        State with final_summary (ready for format_response)
    """
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage
    from backend.llm.config import config
    from backend.llm.utils.system_prompts import get_system_prompt
    from datetime import datetime
    
    citation_context = state.get("citation_context", {})
    user_query = state.get("user_query", "")
    is_agent_mode = state.get("is_agent_mode", False)
    
    cited_text = citation_context.get("cited_text", "")
    page_number = citation_context.get("page_number", "unknown")
    doc_id = citation_context.get("document_id", "")
    filename = citation_context.get("original_filename", "the document")
    bbox = citation_context.get("bbox", {})
    
    logger.info(f"⚡ [CITATION_QUERY] Processing citation query - doc: {doc_id[:8] if doc_id else 'unknown'}, page: {page_number}, agent_mode: {is_agent_mode}")
    logger.info(f"⚡ [CITATION_QUERY] Cited text length: {len(cited_text)} chars")
    logger.info(f"⚡ [CITATION_QUERY] User query: {user_query[:100]}...")
    
    if not cited_text:
        logger.warning("[CITATION_QUERY] No cited text provided, falling back to generic response")
        return {
            "final_summary": "I couldn't find the specific citation context. Please try asking your question again.",
            "citations": [],
            "conversation_history": [{
                "query": user_query,
                "summary": "Citation context not found.",
                "timestamp": datetime.now().isoformat(),
                "query_category": "citation_query"
            }]
        }
    
    # Citation chip queries: answer only, no automatic document opening (no agent tools)
    # User asked to deactivate auto document preview for citation follow-ups
    agent_actions = []
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )
    
    from backend.llm.prompts.routing import get_citation_query_human_prompt

    system_msg = get_system_prompt('analyze')
    human_content = get_citation_query_human_prompt(filename, page_number, cited_text, user_query)

    try:
        messages = [system_msg, HumanMessage(content=human_content)]
        response = await llm.ainvoke(messages)
        answer = response.content.strip()
        
        logger.info(f"⚡ [CITATION_QUERY] Generated answer ({len(answer)} chars)")
        
        # Build a simple citation for the source
        citation = {
            "citation_number": 1,
            "doc_id": doc_id,
            "page_number": page_number,
            "cited_text": cited_text[:200] + "..." if len(cited_text) > 200 else cited_text,
            "original_filename": filename,
            "bbox": bbox,
            "block_id": f"citation_source_{doc_id[:8] if doc_id else 'unknown'}"
        }
        
        # Add citation reference to answer if not already present
        if "[1]" not in answer:
            answer = f"{answer} [1]"
        
        return {
            "final_summary": answer,
            "citations": [citation],
            "conversation_history": [{
                "query": user_query,
                "summary": answer,
                "timestamp": datetime.now().isoformat(),
                "document_ids": [doc_id] if doc_id else [],
                "query_category": "citation_query"
            }],
            "agent_actions": agent_actions if agent_actions else None  # AGENT MODE: Actions for frontend
        }
        
    except Exception as e:
        logger.error(f"[CITATION_QUERY] Error generating answer: {e}", exc_info=True)
        return {
            "final_summary": f"I encountered an error processing your question about this citation. Please try again.",
            "citations": [],
            "conversation_history": [{
                "query": user_query,
                "summary": f"Error: {str(e)}",
                "timestamp": datetime.now().isoformat(),
                "query_category": "citation_query"
            }]
        }


async def handle_navigation_action(state: MainWorkflowState) -> MainWorkflowState:
    """
    NAVIGATION ACTION HANDLER (INSTANT - NO DOCUMENT RETRIEVAL)
    
    Handles navigation requests like:
    - "take me to the highlands property"
    - "go to the map"
    - "show me highlands on the map"
    
    This is an ULTRA-FAST path that:
    1. Extracts property name from query
    2. Returns agent actions directly (no document search)
    3. Frontend will handle map opening and pin selection
    """
    import re
    from datetime import datetime
    
    user_query = state.get("user_query", "").strip()
    user_query_lower = user_query.lower()
    
    logger.info(f"🧭 [NAVIGATION] Handling navigation action: '{user_query}'")
    
    # Extract property name from query
    property_name = None
    
    # Common patterns for property names
    patterns = [
        r"take me to (?:the )?([a-zA-Z\s]+?)(?:\s+(?:property|pin|on the map))?$",
        r"go to (?:the )?([a-zA-Z\s]+?)(?:\s+(?:property|pin))?$",
        r"navigate to (?:the )?([a-zA-Z\s]+?)(?:\s+(?:property|pin))?$",
        r"show me (?:the )?([a-zA-Z\s]+?)(?:\s+(?:property|pin|on the map))?$",
        r"find (?:the )?([a-zA-Z\s]+?)(?:\s+(?:property|pin|on the map))?$",
        r"where is (?:the )?([a-zA-Z\s]+?)(?:\s+(?:property|pin))?$",
    ]
    
    for pattern in patterns:
        match = re.search(pattern, user_query_lower)
        if match:
            property_name = match.group(1).strip()
            # Clean up common trailing words (including filler words like "please")
            property_name = re.sub(r'\s+(property|pin|map|on|the|please|now|quickly|asap).*$', '', property_name, flags=re.IGNORECASE).strip()
            # Also clean if property_name ends with these words
            property_name = re.sub(r'\s*(property|pin|map|please|now)$', '', property_name, flags=re.IGNORECASE).strip()
            if property_name:
                break
    
    # If no pattern matched, try to find property-like words
    if not property_name:
        # Look for known property keywords
        property_keywords = ["highlands", "highland", "berden", "cottage"]
        for kw in property_keywords:
            if kw in user_query_lower:
                property_name = kw
                break
    
    # If still no property name, it might just be "show me the map"
    if not property_name and any(phrase in user_query_lower for phrase in ["the map", "go to map", "open map"]):
        # Just open the map, no specific property
        logger.info("🧭 [NAVIGATION] Map-only navigation (no specific property)")
        return {
            "final_summary": "Sure thing!\n\nOpening the map for you now...",
            "citations": [],
            "conversation_history": [{
                "query": user_query,
                "summary": "Opening map view",
                "timestamp": datetime.now().isoformat(),
                "query_category": "navigation_action"
            }],
            "agent_actions": [{
                "action": "show_map_view",
                "reason": "Opening map view as requested"
            }]
        }
    
    if property_name:
        logger.info(f"🧭 [NAVIGATION] Extracted property name: '{property_name}'")
        
        # Create navigation action
        agent_actions_list = [{
            "action": "navigate_to_property_by_name",
            "property_name": property_name,
            "reason": f"Navigating to {property_name.title()} property as requested"
        }]
        logger.info(f"🧭 [NAVIGATION] Created agent_actions: {agent_actions_list}")
        
        return {
            "final_summary": f"Sure thing!\n\nNavigating to the {property_name.title()} property now...",
            "citations": [],
            "conversation_history": [{
                "query": user_query,
                "summary": f"Navigating to {property_name.title()} property",
                "timestamp": datetime.now().isoformat(),
                "query_category": "navigation_action"
            }],
            "agent_actions": agent_actions_list
        }
    
    # Fallback - couldn't understand the navigation request
    logger.warning(f"🧭 [NAVIGATION] Could not extract property name from: '{user_query}'")
    return {
        "final_summary": "I couldn't understand which property you want to navigate to. Could you please specify the property name?",
        "citations": [],
        "conversation_history": [{
            "query": user_query,
            "summary": "Navigation request not understood",
            "timestamp": datetime.now().isoformat(),
            "query_category": "navigation_action"
        }],
        "agent_actions": None
        }


# =============================================================================
# INTENT CLASSIFIER (conservative, hardcoded-first)
# =============================================================================
#
# Philosophy: NEVER let a document question slip through to conversation.
# Only pure chat (greetings, small talk, personal info, opinions) goes to
# conversation. Everything else — including anything even slightly ambiguous
# — goes to the document/retrieval path. This preserves the retrieval
# behaviour from the branch while still giving Velora a chat mode.
#
# Decision order:
#   1. document_ids present            → document (hard rule)
#   2. property_id present             → document (user has a property open)
#   3. any real-estate / doc keyword   → document
#   4. query is an obvious greeting    → conversation
#   5. query is very short & personal  → conversation
#   6. everything else                 → document (safe default)
# =============================================================================

# Greeting patterns that are CLEARLY just chat (no info request)
_GREETING_EXACT = frozenset({
    "hi", "hello", "hey", "yo", "hiya", "howdy",
    "good morning", "good afternoon", "good evening",
    "morning", "afternoon", "evening",
    "hey there", "hi there", "hello there",
    "whats up", "what's up", "sup",
    "thanks", "thank you", "cheers", "ta",
    "bye", "goodbye", "see you", "see ya",
})

# Short personal / about-velora patterns (only match when NO property is selected)
_PERSONAL_STARTS = (
    "who are you", "what are you", "what's your name", "what is your name",
    "how are you", "how do you work", "what can you do",
    "tell me about yourself", "introduce yourself",
    "my name is", "i'm called", "i am called", "call me",
    "remember that i", "remember my", "can you remember",
    "do you remember",
)

def _strip_velora_greeting(query: str) -> str:
    """
    Strip greeting prefix + 'velora' so 'hey velora, how are you?' becomes 'how are you'.
    This lets the classifier match personal/greeting patterns even when the user addresses Velora by name.
    """
    import re
    # Remove leading greeting + optional 'velora' + optional punctuation/comma
    # e.g. "hey velora, how are you" -> "how are you"
    # e.g. "hi velora" -> ""
    # e.g. "hello there velora, what can you do" -> "what can you do"
    cleaned = re.sub(
        r"^(hey|hi|hello|yo|hiya|howdy|good morning|good afternoon|good evening|morning|afternoon|evening)"
        r"(\s+there)?"
        r"(\s+velora)?"
        r"[,!.\s]*",
        "", query, flags=re.IGNORECASE,
    ).strip()
    return cleaned

# Keywords that signal the query is about documents / real-estate data
_DOC_KEYWORDS = frozenset({
    # document types
    "lease", "valuation", "report", "epc", "inspection", "contract", "filing",
    "document", "certificate", "appraisal", "survey", "assessment",
    # property / real-estate terms
    "property", "value", "price", "worth", "rent", "tenant", "landlord",
    "freehold", "leasehold", "planning", "permission", "building",
    "floor area", "sq ft", "square", "hectare", "acre",
    "market value", "gross internal", "net internal",
    # actions that need documents
    "summarise", "summarize", "summary", "overview", "details",
    "compare", "comparison", "list", "table",
    "find", "search", "look up", "look for", "show me", "give me",
    "fetch", "retrieve", "pull", "get me",
    # specific names users might ask about (will also match via property_id rule)
    "highlands", "berden",
})


async def classify_intent(state: MainWorkflowState) -> str:
    """
    Classify user message as 'conversation' or 'document'.

    VERY conservative: defaults to 'document' so retrieval is never skipped
    by accident. Only obvious greetings / personal chat goes to 'conversation'.

    No LLM call — pure heuristic for speed and reliability.
    """
    document_ids = state.get("document_ids") or []

    # ── Rule 1: files attached → always document ──
    if document_ids:
        logger.info("[CLASSIFY] document_ids present -> document")
        return "document"

    user_query = (state.get("user_query") or "").strip()
    query_lower = user_query.lower().strip("!?.,' ")
    property_id = state.get("property_id")

    # ── Rule 2: property selected → always document ──
    # If the user has a property open, any question is very likely about it.
    if property_id:
        logger.info("[CLASSIFY] property_id present (%s) -> document", property_id[:8])
        return "document"

    # ── Rule 3: any document / real-estate keyword → document ──
    if any(kw in query_lower for kw in _DOC_KEYWORDS):
        logger.info("[CLASSIFY] doc keyword found -> document (query: '%s')", user_query[:60])
        return "document"

    # ── Rule 4: exact greeting match → conversation ──
    # Also try after stripping "velora" address (e.g. "hey velora" → "hey" → match)
    if query_lower in _GREETING_EXACT:
        logger.info("[CLASSIFY] greeting -> conversation (query: '%s')", user_query[:60])
        return "conversation"

    # Strip greeting prefix + "velora" so "hey velora, how are you?" → "how are you"
    stripped = _strip_velora_greeting(query_lower)

    # Check if the whole message was just a greeting to velora (e.g. "hey velora" → stripped is empty)
    if not stripped and "velora" in query_lower:
        logger.info("[CLASSIFY] greeting to Velora -> conversation (query: '%s')", user_query[:60])
        return "conversation"

    # ── Rule 5: short personal / about-velora question → conversation ──
    # Check both the original query and the stripped version (after removing greeting prefix)
    if any(query_lower.startswith(p) for p in _PERSONAL_STARTS):
        logger.info("[CLASSIFY] personal/about-velora -> conversation (query: '%s')", user_query[:60])
        return "conversation"
    if stripped and any(stripped.startswith(p) for p in _PERSONAL_STARTS):
        logger.info("[CLASSIFY] personal/about-velora (after stripping greeting) -> conversation (query: '%s')", user_query[:60])
        return "conversation"

    # ── Rule 6: very short message with no doc keywords → conversation ──
    # e.g. "ok", "cool", "nice one", "lol", "haha"
    word_count = len(user_query.split())
    if word_count <= 3:
        logger.info("[CLASSIFY] short message (%d words), no doc keywords -> conversation (query: '%s')", word_count, user_query[:60])
        return "conversation"

    # ── Default: document (safe — better to search and find nothing) ──
    logger.info("[CLASSIFY] default -> document (query: '%s')", user_query[:60])
    return "document"
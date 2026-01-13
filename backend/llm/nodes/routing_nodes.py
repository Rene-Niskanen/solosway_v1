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
from typing import List
from backend.llm.types import MainWorkflowState, RetrievedDocument
from backend.services.supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)


def route_query(state: MainWorkflowState) -> MainWorkflowState:
    """
    FAST ROUTER: Determines execution path based on query complexity and context.
    
    Routing decisions (in order):
    0. "attachment_fast": ONLY if attachment_context has content AND response_mode='fast' → FASTEST path (~2s)
    1. "citation_query": ONLY if citation_context has content → FASTEST path (~2s)
    2. "direct_document": User attached file(s) → Fastest path (~2s)
    3. "property_document": Property-specific query → Fast path (~4s)
    4. "simple_search": Simple query → Medium path (~6s)
    5. "complex_search": Complex query → Full pipeline (~12s)
    
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
    
    # If user_query is provided, delegate to normal retrieval path (query_vector_documents)
    # This reuses all the proven logic: header retrieval, hybrid search, header detection, etc.
    if user_query:
        logger.info(f"[DIRECT_DOC] Delegating to normal retrieval path (query_vector_documents) with document_ids={document_ids}")
        
        # Ensure document_ids is set in state for query_vector_documents to use
        state_with_doc_ids = {**state, "document_ids": document_ids}
        
        # Call the normal retrieval function - it already handles document_ids filtering
        from backend.llm.nodes.retrieval_nodes import query_vector_documents
        result_state = await query_vector_documents(state_with_doc_ids)
        
        # Return the results (query_vector_documents returns {"relevant_documents": [...]})
        logger.info(f"[DIRECT_DOC] Normal retrieval path returned {len(result_state.get('relevant_documents', []))} chunks")
        return result_state
    
    # Fallback: No query provided - fetch ALL chunks sequentially
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
    
    system_msg = SystemMessage(content="You are a helpful assistant that answers questions based on provided document content.")
    human_msg = HumanMessage(content=prompt)
    
    logger.info(f"[ATTACHMENT_FAST] Calling LLM with {len(prompt)} chars of context")
    response = await llm.ainvoke([system_msg, human_msg])
    
    final_summary = response.content.strip()
    logger.info(f"[ATTACHMENT_FAST] Response generated: {len(final_summary)} chars")
    
    return {"final_summary": final_summary}


async def handle_citation_query(state: MainWorkflowState) -> MainWorkflowState:
    """
    ULTRA-FAST citation query handler (~2s).
    
    When user asks about a specific citation, we already have:
    - The exact document ID
    - The exact page number
    - The exact bounding box
    - The cited text itself
    
    So we skip ALL retrieval and do a SINGLE LLM call with just the cited text + user query.
    This is ~5-10x faster than the normal pipeline.
    
    AGENT MODE: When is_agent_mode is True, binds agent action tools (open_document, navigate)
    to allow the LLM to proactively open the document for the user.
    
    Returns:
        State with final_summary (ready for format_response)
    """
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage
    from backend.llm.config import config
    from backend.llm.utils.system_prompts import get_system_prompt
    from backend.llm.tools.agent_actions import create_agent_action_tools
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
    
    # Create LLM - bind agent tools if in agent mode
    agent_action_instance = None
    agent_actions = []
    
    if is_agent_mode:
        # Create agent action tools for proactive document display
        agent_tools, agent_action_instance = create_agent_action_tools()
        logger.info(f"⚡ [CITATION_QUERY] Agent mode enabled - binding {len(agent_tools)} agent tools")
        llm = ChatOpenAI(
            api_key=config.openai_api_key,
            model=config.openai_model,
            temperature=0,
        ).bind_tools(agent_tools, tool_choice="auto")
    else:
        llm = ChatOpenAI(
            api_key=config.openai_api_key,
            model=config.openai_model,
            temperature=0,
        )
    
    system_msg = get_system_prompt('analyze')
    
    # Build focused prompt with just the citation context
    agent_instructions = ""
    if is_agent_mode:
        agent_instructions = """

**AGENT MODE INSTRUCTIONS:**
You have access to the `open_document` tool. Since this is a citation query (the user clicked on a citation):
- If the user is asking about the content of the citation, CALL open_document to show them the source
- Use citation_number=1 (this citation) with a reason explaining what they'll see
- Example: open_document(citation_number=1, reason="Displays the source text the user is asking about")
"""
    
    human_content = f"""You are answering a question about a specific piece of text from a document.

**CITATION CONTEXT:**
- Document: {filename}
- Page: {page_number}
- Cited text: "{cited_text}"

**USER'S QUESTION:**
{user_query}

**INSTRUCTIONS:**
1. Answer the user's question based on the cited text and your knowledge
2. If the cited text contains the answer, quote relevant parts
3. If the user is asking for more context or explanation, provide helpful information
4. If the question cannot be answered from the cited text alone, provide relevant general knowledge
5. Be concise but thorough
6. Do NOT say you need to search documents - you already have the relevant text above
7. Include [1] citation marker when referencing the cited text{agent_instructions}

Provide a direct, helpful answer:"""

    try:
        messages = [system_msg, HumanMessage(content=human_content)]
        response = await llm.ainvoke(messages)
        answer = response.content.strip()
        
        # Process agent tool calls if in agent mode
        if is_agent_mode and agent_action_instance:
            # Check for tool calls in the response
            if hasattr(response, 'tool_calls') and response.tool_calls:
                for tool_call in response.tool_calls:
                    tool_name = tool_call.get('name', '')
                    tool_args = tool_call.get('args', {})
                    
                    if tool_name == 'open_document':
                        citation_number = tool_args.get('citation_number', 1)
                        reason = tool_args.get('reason', 'Displaying source document')
                        agent_action_instance.open_document(citation_number, reason)
                        logger.info(f"⚡ [CITATION_QUERY] Agent tool call: open_document({citation_number}, '{reason}')")
                    elif tool_name == 'navigate_to_property':
                        property_id = tool_args.get('property_id', '')
                        reason = tool_args.get('reason', 'Navigating to property')
                        agent_action_instance.navigate_to_property(property_id, reason)
                        logger.info(f"⚡ [CITATION_QUERY] Agent tool call: navigate_to_property({property_id}, '{reason}')")
            
            agent_actions = agent_action_instance.get_actions()
            logger.info(f"⚡ [CITATION_QUERY] Collected {len(agent_actions)} agent actions")
            
            # If no tools were called but this is a citation query in agent mode,
            # automatically add an open_document action (the user is asking about a citation)
            if not agent_actions:
                logger.info("⚡ [CITATION_QUERY] No agent tool calls - auto-adding open_document for citation query")
                agent_actions = [{
                    'action': 'open_document',
                    'citation_number': 1,
                    'reason': 'Displaying the source document for this citation'
                }]
        
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
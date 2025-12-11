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
    
    Routing decisions:
    1. "direct_document": User attached file(s) → Fastest path (~2s)
    2. "property_document": Property-specific query → Fast path (~4s)
    3. "simple_search": Simple query → Medium path (~6s)
    4. "complex_search": Complex query → Full pipeline (~12s)
    
    Returns:
        State with route_decision and optimization flags
    """
    user_query = state.get("user_query", "").lower().strip()
    document_ids = state.get("document_ids", [])
    property_id = state.get("property_id")
    
    # FIX: Ensure document_ids is always a list (safety check)
    if document_ids and not isinstance(document_ids, list):
        # Convert single value to list
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
            "skip_vector_search": False  # Still need to find document
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
            "skip_clarify": False,  # Still clarify if multiple docs
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


async def fetch_direct_document_chunks(state: MainWorkflowState) -> MainWorkflowState:
    """
    Fast path: Fetch ALL chunks from specific document(s).
    
    This bypasses vector search entirely and gets all chunks directly.
    Used when user attaches file(s) to chat.
    
    Returns:
        State with relevant_documents populated from direct chunk fetch
    """
    # Check both target_document_ids (from route_query) and document_ids (from initial state)
    document_ids = state.get("target_document_ids") or state.get("document_ids", [])
    
    # FIX: Ensure document_ids is always a list (safety check)
    if document_ids and not isinstance(document_ids, list):
        # Convert single value to list
        document_ids = [str(document_ids)]
        logger.info(f"[DIRECT_DOC] Converted document_ids to list: {document_ids}")
    elif not document_ids:
        document_ids = []
    
    property_id = state.get("target_property_id") or state.get("property_id")
    business_id = state.get("business_id")
    
    logger.info(
        f"[DIRECT_DOC] Fetching chunks - document_ids: {document_ids} (type: {type(document_ids).__name__}), "
        f"property_id: {property_id[:8] if property_id else 'None'}, "
        f"business_id: {business_id[:8] if business_id else 'None'}"
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
    
    try:
        supabase = get_supabase_client()
        retrieved_docs: List[RetrievedDocument] = []
        
        # Fetch all chunks for each document
        for doc_id in document_ids:
            # Get document metadata
            # Note: business_id from state is a UUID, so we query by business_uuid (not business_id which is varchar)
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
            
            logger.info(f"[DIRECT_DOC] Fetching all chunks from document: {filename}")
            
            # Fetch ALL chunks for this document (ordered by chunk_index)
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
                    "similarity_score": 1.0,  # Perfect match (direct document)
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
"""
Retrieval nodes: Query classification, vector search, SQL search, deduplication, clarification.
"""

import json
import logging
from typing import Optional, List, Dict

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

from backend.llm.config import config
from backend.llm.types import MainWorkflowState, RetrievedDocument
from backend.llm.retrievers.vector_retriever import VectorDocumentRetriever
from backend.llm.retrievers.hybrid_retriever import HybridDocumentRetriever
from backend.llm.utils import reciprocal_rank_fusion
from backend.llm.utils.system_prompts import get_system_prompt
from backend.llm.prompts import (
    get_query_rewrite_human_content,
    get_query_expansion_human_content,
    get_query_routing_human_content,
    get_llm_sql_query_human_content,
    get_reranking_human_content
)
# SQLDocumentRetriever is still under development. Import when ready.
# from backend.llm.retrievers.sql_retriever import SQLDocumentRetriever

logger = logging.getLogger(__name__)


def rewrite_query_with_context(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Query Rewriting with Conversation Context
    
    Rewrites vague follow-up queries to be self-contained using conversation history.
    This ensures vector search understands references like "the document", "that property".
    
    Examples:
        "What's the price?" → "What's the price for Highlands, Berden Road property?"
        "Review the document" → "Review Highlands_Berden_Bishops_Stortford valuation report"
        "Show amenities" → "Show amenities for the 5-bedroom property at Highlands"
    
    Args:
        state: MainWorkflowState with user_query and conversation_history
        
    Returns:
        Updated state with rewritten user_query (or unchanged if no context needed)
    """
    
    # Skip if no conversation history
    if not state.get('conversation_history') or len(state['conversation_history']) == 0:
        logger.info("[REWRITE_QUERY] No conversation history, using original query")
        return {}  # No changes to state
    
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )
    
    # Build conversation context (last 2 exchanges)
    recent_history = state['conversation_history'][-2:]
    history_lines = []
    for exchange in recent_history:
        # Handle different conversation history formats:
        # Format 1: From summary_nodes (has 'query' and 'summary')
        # Format 2: From frontend/views (has 'role' and 'content')
        if 'query' in exchange and 'summary' in exchange:
            # Format from summary_nodes
            history_lines.append(f"User asked: {exchange['query']}")
            summary_preview = exchange['summary'][:400].replace('\n', ' ')
            history_lines.append(f"Assistant responded: {summary_preview}...")
        elif 'role' in exchange and 'content' in exchange:
            # Format from frontend (role-based messages)
            role = exchange['role']
            content = exchange['content']
            if role == 'user':
                history_lines.append(f"User asked: {content}")
            elif role == 'assistant':
                content_preview = content[:400].replace('\n', ' ')
                history_lines.append(f"Assistant responded: {content_preview}...")
        else:
            # Skip malformed entries
            logger.warning(f"[REWRITE_QUERY] Skipping malformed conversation entry: {exchange.keys()}")
            continue
    
    history_context = "\n".join(history_lines)
    
    # Get system prompt for rewrite task
    system_msg = get_system_prompt('rewrite')
    
    # Get human message content
    human_content = get_query_rewrite_human_content(
        user_query=state['user_query'],
        conversation_history=history_context
    )
    
    try:
        # Use LangGraph message format
        messages = [system_msg, HumanMessage(content=human_content)]
        response = llm.invoke(messages)
        rewritten = response.content.strip().strip('"').strip("'")  # Clean quotes
        
        # Only use rewritten if it's different and not too long
        if rewritten != state['user_query'] and len(rewritten) < 500:
            logger.info(f"[REWRITE_QUERY]   Original: '{state['user_query']}'")
            logger.info(f"[REWRITE_QUERY]  Rewritten: '{rewritten}'")
            return {"user_query": rewritten}
        else:
            logger.info("[REWRITE_QUERY]   No rewrite needed")
            return {}
            
    except Exception as exc:
        logger.error(f"[REWRITE_QUERY]  Failed to rewrite: {exc}")
        return {}  # Keep original query on error


def expand_query_for_retrieval(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Query Expansion for Better Recall
    
    Generates query variations to catch different phrasings and synonyms.
    This dramatically improves recall for ambiguous queries.
    
    Examples:
        "foundation issues" → ["foundation issues", "foundation damage and structural problems", 
                               "concrete defects and settlement issues"]
        "What's the price?" → ["What's the price?", "property sale price and valuation",
                               "market value and asking price"]
    
    Args:
        state: MainWorkflowState with user_query
        
    Returns:
        Updated state with query_variations list
    """
    
    original_query = state['user_query']
    
    # Skip expansion for very specific/long queries (already clear)
    if len(original_query.split()) > 15:
        logger.info("[EXPAND_QUERY] Query already specific, skipping expansion")
        return {"query_variations": [original_query]}
    
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0.4,  # Slight creativity for variations
    )
    
    # Get system prompt for expansion task
    system_msg = get_system_prompt('expand')
    
    # Get human message content
    human_content = get_query_expansion_human_content(original_query=original_query)
    
    try:
        # Use LangGraph message format
        messages = [system_msg, HumanMessage(content=human_content)]
        response = llm.invoke(messages)
        variations = [v.strip() for v in response.content.strip().split('\n') if v.strip()]
        
        # Limit to 2 variations
        variations = variations[:2]
        
        # Combine: original + variations
        all_queries = [original_query] + variations
        
        logger.info(f"[EXPAND_QUERY] Generated {len(variations)} variations:")
        for i, q in enumerate(all_queries, 1):
            logger.info(f"  {i}. {q}")
        
        return {"query_variations": all_queries}
        
    except Exception as exc:
        logger.error(f"[EXPAND_QUERY] Failed to expand query: {exc}")
        return {"query_variations": [original_query]}


def route_query(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Route/Classify Query Intent 

    Uses LLM to classify query as semantic, structured, or hybrid.
    This determines which retrieval paths to activate.
    Now includes conversation history for context-aware classification.

    Args:
        state: MainWorkflowState with user_query and conversation_history

    Returns:
        Updated state with query_intent
    """
    
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )

    # Build conversation context if history exists
    history_context = ""
    if state.get('conversation_history'):
        recent_history = state['conversation_history'][-3:]  # Last 3 exchanges
        history_lines = []
        for exchange in recent_history:
            # Handle different conversation history formats
            if 'query' in exchange and 'summary' in exchange:
                # Format from summary_nodes
                history_lines.append(f"User: {exchange['query']}")
                history_lines.append(f"Assistant: {exchange['summary'][:200]}...")
            elif 'role' in exchange and 'content' in exchange:
                # Format from frontend (role-based messages)
                role = exchange['role']
                content = exchange['content']
                if role == 'user':
                    history_lines.append(f"User: {content}")
                elif role == 'assistant':
                    history_lines.append(f"Assistant: {content[:200]}...")
        if history_lines:
            history_context = f"\n\nPrevious conversation:\n" + "\n".join(history_lines)

    # Get system prompt for classification task
    system_msg = get_system_prompt('classify')
    
    # Get human message content
    human_content = get_query_routing_human_content(
        user_query=state['user_query'],
        conversation_history=history_context
    )
    
    # Use LangGraph message format
    messages = [system_msg, HumanMessage(content=human_content)]
    response = llm.invoke(messages)
    intent = response.content.lower().strip()

    if intent not in {"semantic", "structured", "hybrid"}:
        logger.warning("Invalid intent '%s', defaulting to 'hybrid'", intent)
        intent = "hybrid"

    logger.info("[ROUTE_QUERY] Classified query as: %s", intent)
    return {"query_intent": intent}


def query_vector_documents(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Hybrid Search (BM25 + Vector) with Lazy Embedding Support + Structured Query Fallback

    Uses hybrid retriever combining:
    - BM25 (lexical) for exact matches (addresses, postcodes, IDs) - works on ALL chunks
    - Vector (semantic) for conceptual matches - only embedded chunks
    - Triggers lazy embedding for unembedded chunks found by BM25
    - Structured query fallback: For property-specific queries (bedrooms, bathrooms, etc.), 
      queries property_details table directly for fast, accurate results
    
    This dramatically improves recall and handles lazy embedding seamlessly.

    Args:
        state: MainWorkflowState with user_query, query_variations, business_id

    Returns:
        Updated state with hybrid search results appended to relevant_documents
    """

    try:
        # STEP 1: Check if query is property-specific (bedrooms, bathrooms, price, etc.)
        # If so, query property_details table directly for fast, accurate results
        user_query = state.get('user_query', '').lower()
        business_id = state.get("business_id")
        
        structured_results = []
        if business_id and any(term in user_query for term in ['bedroom', 'bathroom', 'bed', 'bath', 'price', 'square', 'sqft', 'sq ft']):
            try:
                from backend.services.supabase_client_factory import get_supabase_client
                supabase = get_supabase_client()
                
                # Extract numbers from query (e.g., "5 bedroom" -> 5)
                # Handle plurals, abbreviations, and variations
                import re
                # Match: "5 bedroom", "5 bedrooms", "5 bed", "5 beds", "5BR", "5 br", etc.
                bedroom_patterns = [
                    r'(\d+)\s*(?:bedroom|bedrooms|bed|beds|br|brs)\b',
                    r'(\d+)\s*-\s*(?:bedroom|bed|br)',
                    r'(?:bedroom|bed|br)\s*[:=]\s*(\d+)',
                ]
                bedroom_match = None
                for pattern in bedroom_patterns:
                    bedroom_match = re.search(pattern, user_query, re.IGNORECASE)
                    if bedroom_match:
                        break
                
                # Match: "5 bathroom", "5 bathrooms", "5 bath", "5 baths", "5BA", "5 ba", etc.
                bathroom_patterns = [
                    r'(\d+)\s*(?:bathroom|bathrooms|bath|baths|ba|bas)\b',
                    r'(\d+)\s*-\s*(?:bathroom|bath|ba)',
                    r'(?:bathroom|bath|ba)\s*[:=]\s*(\d+)',
                ]
                bathroom_match = None
                for pattern in bathroom_patterns:
                    bathroom_match = re.search(pattern, user_query, re.IGNORECASE)
                    if bathroom_match:
                        break
                
                logger.info(f"[QUERY_STRUCTURED] Extracted - Bedrooms: {bedroom_match.group(1) if bedroom_match else None}, Bathrooms: {bathroom_match.group(1) if bathroom_match else None}")
                
                # Build property_details query
                property_query = supabase.table('property_details')\
                    .select('property_id, number_bedrooms, number_bathrooms')
                
                if bedroom_match:
                    bedrooms = int(bedroom_match.group(1))
                    property_query = property_query.eq('number_bedrooms', bedrooms)
                
                if bathroom_match:
                    bathrooms = int(bathroom_match.group(1))
                    property_query = property_query.eq('number_bathrooms', bathrooms)
                
                # Get properties matching criteria (exact match first)
                property_results = property_query.execute()
                
                # RETRY LOGIC: If no exact matches, try similarity-based search
                if not property_results.data and (bedroom_match or bathroom_match):
                    logger.info(f"[QUERY_STRUCTURED] No exact matches found, trying similarity-based search...")
                    
                    # Try ranges: ±1 bedroom/bathroom
                    similarity_query = supabase.table('property_details')\
                        .select('property_id, number_bedrooms, number_bathrooms')
                    
                    if bedroom_match:
                        bedrooms = int(bedroom_match.group(1))
                        # Try range: bedrooms-1 to bedrooms+1
                        similarity_query = similarity_query.gte('number_bedrooms', max(1, bedrooms - 1))\
                            .lte('number_bedrooms', bedrooms + 1)
                        logger.info(f"[QUERY_STRUCTURED] Trying bedroom range: {max(1, bedrooms - 1)}-{bedrooms + 1}")
                    
                    if bathroom_match:
                        bathrooms = int(bathroom_match.group(1))
                        # Try range: bathrooms-1 to bathrooms+1
                        similarity_query = similarity_query.gte('number_bathrooms', max(1, bathrooms - 1))\
                            .lte('number_bathrooms', bathrooms + 1)
                        logger.info(f"[QUERY_STRUCTURED] Trying bathroom range: {max(1, bathrooms - 1)}-{bathrooms + 1}")
                    
                    property_results = similarity_query.execute()
                    if property_results.data:
                        logger.info(f"[QUERY_STRUCTURED] Found {len(property_results.data)} similar properties (not exact matches)")
                
                if property_results.data:
                    # Get document_ids for these properties
                    property_ids = [p['property_id'] for p in property_results.data]
                    
                    # Get documents linked to these properties
                    doc_results = supabase.table('document_relationships')\
                        .select('document_id, property_id')\
                        .in_('property_id', property_ids)\
                        .execute()
                    
                    if doc_results.data:
                        # Get document details including document_summary for party names
                        doc_ids = list(set([d['document_id'] for d in doc_results.data]))
                        docs = supabase.table('documents')\
                            .select('id, original_filename, classification_type, document_summary')\
                            .in_('id', doc_ids)\
                            .eq('business_uuid', business_id)\
                            .execute()
                        
                        # Get property addresses
                        addresses = supabase.table('properties')\
                            .select('id, formatted_address')\
                            .in_('id', property_ids)\
                            .execute()
                        
                        address_map = {a['id']: a['formatted_address'] for a in addresses.data}
                        
                        # Get property_details for each property to prepend to content
                        property_details_map = {}
                        if property_ids:
                            try:
                                prop_details = supabase.table('property_details')\
                                    .select('property_id, number_bedrooms, number_bathrooms, property_type, size_sqft, size_unit, asking_price, sold_price, rent_pcm, epc_rating, tenure, condition, other_amenities, notes')\
                                    .in_('property_id', property_ids)\
                                    .execute()
                                property_details_map = {pd['property_id']: pd for pd in prop_details.data}
                                logger.info(f"[QUERY_STRUCTURED] Fetched property_details for {len(property_details_map)} properties")
                            except Exception as e:
                                logger.warning(f"[QUERY_STRUCTURED] Failed to fetch property_details: {e}")
                        
                        # Fetch actual chunks from document_vectors for each document
                        for doc in docs.data:
                            # Find property_id for this document
                            prop_id = next((dr['property_id'] for dr in doc_results.data if dr['document_id'] == doc['id']), None)
                            
                            # Get property details for this property
                            prop_details = property_details_map.get(prop_id, {}) if prop_id else {}
                            
                            # Extract party names from document_summary
                            party_names_context = ""
                            try:
                                import json
                                document_summary = doc.get('document_summary')
                                if document_summary:
                                    # Handle both dict and JSON string formats
                                    if isinstance(document_summary, str):
                                        try:
                                            document_summary = json.loads(document_summary)
                                            if isinstance(document_summary, str):
                                                document_summary = json.loads(document_summary)
                                        except (json.JSONDecodeError, TypeError):
                                            document_summary = None
                                    
                                    if isinstance(document_summary, dict):
                                        party_names = document_summary.get('party_names', {})
                                        if party_names:
                                            name_parts = []
                                            if valuer := party_names.get('valuer'):
                                                name_parts.append(f"Valuer: {valuer}")
                                            if seller := party_names.get('seller'):
                                                name_parts.append(f"Seller: {seller}")
                                            if buyer := party_names.get('buyer'):
                                                name_parts.append(f"Buyer: {buyer}")
                                            if agent := party_names.get('estate_agent'):
                                                name_parts.append(f"Estate Agent: {agent}")
                                            
                                            if name_parts:
                                                party_names_context = "PARTY_NAMES: " + " | ".join(name_parts) + "\n\n"
                            except Exception as e:
                                logger.debug(f"[QUERY_STRUCTURED] Could not extract party names: {e}")
                            
                            # Build property details context to prepend to chunks
                            # This is VERIFIED information from the property database (including manually updated values)
                            property_context = ""
                            if prop_details:
                                context_parts = []
                                if prop_details.get('number_bedrooms') is not None:
                                    context_parts.append(f"{prop_details['number_bedrooms']} bedroom(s)")
                                if prop_details.get('number_bathrooms') is not None:
                                    context_parts.append(f"{prop_details['number_bathrooms']} bathroom(s)")
                                if prop_details.get('property_type'):
                                    context_parts.append(f"Type: {prop_details['property_type']}")
                                if prop_details.get('size_sqft'):
                                    size_value = prop_details['size_sqft']
                                    size_unit = prop_details.get('size_unit', '').lower() if prop_details.get('size_unit') else ''
                                    # Only show as acres if explicitly stated in size_unit field
                                    if size_unit in ('acres', 'acre'):
                                        context_parts.append(f"Size: {size_value:,.2f} acres")
                                    else:
                                        context_parts.append(f"Size: {size_value:,.0f} sqft")
                                if prop_details.get('asking_price'):
                                    context_parts.append(f"Asking price: £{prop_details['asking_price']:,.0f}")
                                if prop_details.get('sold_price'):
                                    context_parts.append(f"Sold price: £{prop_details['sold_price']:,.0f}")
                                if prop_details.get('rent_pcm'):
                                    context_parts.append(f"Rent (pcm): £{prop_details['rent_pcm']:,.0f}")
                                if prop_details.get('tenure'):
                                    context_parts.append(f"Tenure: {prop_details['tenure']}")
                                if prop_details.get('epc_rating'):
                                    context_parts.append(f"EPC: {prop_details['epc_rating']}")
                                if prop_details.get('condition'):
                                    context_parts.append(f"Condition: {prop_details['condition']}")
                                
                                if context_parts:
                                    # Make it very clear this is verified property information
                                    property_context = f"""PROPERTY DETAILS (VERIFIED FROM DATABASE - INCLUDES MANUALLY UPDATED VALUES):
This property has: {', '.join(context_parts)}.

This information has been verified and extracted from the property database, including any manually updated values. The document below may contain additional details about this property.

"""
                            
                            # Fetch chunks for this document
                            # First, try to find chunks that contain bedroom/bathroom keywords for better relevance
                            keyword_chunks = []
                            if bedroom_match or bathroom_match:
                                keywords = []
                                if bedroom_match:
                                    keywords.extend(['bedroom', 'bedrooms', 'bed', 'beds'])
                                if bathroom_match:
                                    keywords.extend(['bathroom', 'bathrooms', 'bath', 'baths'])
                                
                                # Fetch all chunks for this document to search for keywords
                                all_chunks = supabase.table('document_vectors')\
                                    .select('chunk_text, chunk_index, page_number, embedding_status')\
                                    .eq('document_id', doc['id'])\
                                    .execute()
                                
                                # Filter chunks that contain bedroom/bathroom keywords
                                for chunk in all_chunks.data:
                                    chunk_text_lower = (chunk.get('chunk_text', '') or '').lower()
                                    if any(kw in chunk_text_lower for kw in keywords):
                                        keyword_chunks.append(chunk)
                                
                                # Sort by chunk_index and take up to 10 keyword chunks
                                keyword_chunks.sort(key=lambda x: x.get('chunk_index', 0))
                                keyword_chunks = keyword_chunks[:10]
                                
                                # Use the keyword chunks as the base, then add sequential chunks for context
                                chunk_indices_seen = set(c.get('chunk_index') for c in keyword_chunks)
                                all_chunks_list = list(keyword_chunks)
                                
                                # Add sequential chunks that weren't already included (for context)
                                for chunk in all_chunks.data:
                                    if chunk.get('chunk_index') not in chunk_indices_seen and len(all_chunks_list) < 20:
                                        all_chunks_list.append(chunk)
                                        chunk_indices_seen.add(chunk.get('chunk_index'))
                                
                                # Sort by chunk_index for proper ordering
                                all_chunks_list.sort(key=lambda x: x.get('chunk_index', 0))
                                
                                # Create a mock result object with the combined chunks
                                class MockResult:
                                    def __init__(self, data):
                                        self.data = data
                                chunks_result = MockResult(all_chunks_list[:20])
                            else:
                                # No keyword search needed, just fetch sequential chunks
                                chunks_result = (supabase.table('document_vectors')
                                    .select('chunk_text, chunk_index, page_number, embedding_status')
                                    .eq('document_id', doc['id'])
                                    .order('chunk_index')
                                    .limit(20)  # Get more chunks for better context
                                    .execute())
                            
                            # Combine chunks into content
                            chunk_texts = []
                            has_unembedded = False
                            
                            if chunks_result.data:
                                for chunk in chunks_result.data:
                                    chunk_text = chunk.get('chunk_text', '').strip()
                                    if chunk_text and len(chunk_text) > 10:  # Filter out very short chunks
                                        chunk_texts.append(chunk_text)
                                    
                                    # Track unembedded chunks for lazy embedding
                                    if chunk.get('embedding_status') == 'pending':
                                        has_unembedded = True
                                
                                # Combine chunks with separators and prepend party names + property context
                                if chunk_texts:
                                    combined_content = party_names_context + property_context + "\n\n---\n\n".join(chunk_texts)
                                    logger.debug(f"[QUERY_STRUCTURED] Fetched {len(chunk_texts)} chunks for doc {doc['id'][:8]}, total length: {len(combined_content)} chars")
                                else:
                                    # Fallback: use property details if chunks are empty
                                    combined_content = party_names_context + property_context + f"Property with matching criteria from {doc.get('original_filename', 'document')}. Document chunks are being processed."
                                
                                # Trigger lazy embedding for this document if chunks are unembedded
                                if has_unembedded:
                                    try:
                                        from backend.tasks import embed_document_chunks_lazy
                                        embed_document_chunks_lazy.delay(str(doc['id']), business_id)
                                        logger.info(f"[QUERY_STRUCTURED] Triggered lazy embedding for document {doc['id'][:8]}")
                                    except Exception as e:
                                        logger.warning(f"[QUERY_STRUCTURED] Failed to trigger lazy embedding: {e}")
                            else:
                                # No chunks found, use property details as fallback
                                combined_content = party_names_context + property_context + f"Property with matching criteria from {doc.get('original_filename', 'document')}. Document chunks are being processed."
                                logger.warning(f"[QUERY_STRUCTURED] No chunks found for document {doc['id'][:8]}, using property details only")
                            
                            # Get page numbers from chunks
                            page_numbers = sorted(set(
                                c.get('page_number') for c in chunks_result.data 
                                if c.get('page_number') and c.get('page_number') > 0
                            )) if chunks_result.data else []
                            
                            structured_results.append({
                                'doc_id': doc['id'],
                                'document_id': doc['id'],
                                'property_id': prop_id,
                                'property_address': address_map.get(prop_id, 'Unknown'),
                                'original_filename': doc.get('original_filename', ''),
                                'classification_type': doc.get('classification_type', ''),
                                'content': combined_content,  # Actual chunk content!
                                'similarity_score': 1.0,  # High score for exact matches
                                'source': 'structured_query',
                                'chunk_index': 0,  # Single merged result
                                'page_number': page_numbers[0] if page_numbers else None,
                                'page_numbers': page_numbers
                            })
                        
                        logger.info(f"[QUERY_STRUCTURED] Found {len(structured_results)} documents via property_details query with {sum(len(r.get('content', '').split('---')) for r in structured_results)} chunks")
                else:
                    logger.warning(f"[QUERY_STRUCTURED] No properties found matching criteria")
            except Exception as e:
                logger.warning(f"[QUERY_STRUCTURED] Structured query failed: {e}")
                import traceback
                logger.debug(traceback.format_exc())
        
        # STEP 2: Use hybrid retriever (BM25 + Vector with lazy embedding triggers)
        retriever = HybridDocumentRetriever()
        
        # Get query variations (or just original if expansion didn't run)
        queries = state.get('query_variations', [state['user_query']])
        
        # Search with each query variation using hybrid retriever
        all_results = []
        for query in queries:
            results = retriever.query_documents(
                user_query=query,
                top_k=20,  # Fetch fewer per query, merge later
                business_id=business_id,
                property_id=state.get("property_id"),
                classification_type=state.get("classification_type"),
                trigger_lazy_embedding=True  # Enable lazy embedding triggers
            )
            all_results.append(results)
            logger.info(f"[QUERY_HYBRID] Query '{query[:40]}...' → {len(results)} docs")
        
        # Merge results using Reciprocal Rank Fusion
        if len(all_results) > 1:
            merged_results = reciprocal_rank_fusion(all_results)
            logger.info(
                f"[QUERY_HYBRID] Merged {len(merged_results)} unique documents from {len(queries)} query variations"
            )
        else:
            merged_results = all_results[0] if all_results else []
            logger.info(
                f"[QUERY_HYBRID] Retrieved {len(merged_results)} documents via hybrid search"
            )
        
        # STEP 3: LLM-Driven SQL Query with Tool (if structured query found nothing or needs refinement)
        # Let LLM agent use the SQL query tool directly to find properties
        llm_sql_results = []
        if (not structured_results or len(structured_results) < 3) and business_id:
            try:
                from langchain_openai import ChatOpenAI
                from backend.llm.tools.sql_query_tool import create_property_query_tool, SQLQueryTool
                from backend.services.supabase_client_factory import get_supabase_client
                
                supabase = get_supabase_client()  # Get supabase client for LLM SQL queries
                
                # Create the tool
                property_tool = create_property_query_tool(business_id=business_id)
                
                # Create LLM with tool binding (agent can invoke tool directly)
                llm = ChatOpenAI(
                    api_key=config.openai_api_key,
                    model=config.openai_model,
                    temperature=0.3,
                ).bind_tools([property_tool])
                
                # Use centralized prompt
                # Get system prompt for SQL query task
                system_msg_sql = get_system_prompt('sql_query')
                
                # Get human message content
                human_content_sql = get_llm_sql_query_human_content(user_query=state['user_query'])
                
                # Use LangGraph message format
                messages_sql = [system_msg_sql, HumanMessage(content=human_content_sql)]
                prompt = messages_sql  # Keep variable name for compatibility
                
                response = llm.invoke(prompt)
                import json
                import re
                
                # Extract JSON from response
                json_match = re.search(r'\{[^}]+\}', response.content, re.DOTALL)
                if json_match:
                    query_params = json.loads(json_match.group(0))
                    logger.info(f"[QUERY_LLM_SQL] LLM generated query params: {query_params}")
                    
                    # Execute SQL query with LLM-generated parameters
                    similar_properties = sql_tool.query_properties(
                        number_bedrooms=query_params.get('number_bedrooms'),
                        number_bathrooms=query_params.get('number_bathrooms'),
                        bedroom_min=query_params['bedroom_range'][0] if query_params.get('bedroom_range') else None,
                        bedroom_max=query_params['bedroom_range'][1] if query_params.get('bedroom_range') else None,
                        bathroom_min=query_params['bathroom_range'][0] if query_params.get('bathroom_range') else None,
                        bathroom_max=query_params['bathroom_range'][1] if query_params.get('bathroom_range') else None,
                        property_type=query_params.get('property_type'),
                        min_price=query_params.get('min_price'),
                        max_price=query_params.get('max_price'),
                        min_size_sqft=query_params.get('min_size_sqft'),
                        max_size_sqft=query_params.get('max_size_sqft'),
                        limit=20
                    )
                    
                    if similar_properties:
                        # Convert to document results (same format as structured_results)
                        property_ids = [p['property_id'] for p in similar_properties]
                        
                        # Get documents linked to these properties
                        doc_results = supabase.table('document_relationships')\
                            .select('document_id, property_id')\
                            .in_('property_id', property_ids)\
                            .execute()
                        
                        if doc_results.data:
                            doc_ids = list(set([d['document_id'] for d in doc_results.data]))
                            docs = supabase.table('documents')\
                                .select('id, original_filename, classification_type, document_summary')\
                                .in_('id', doc_ids)\
                                .eq('business_uuid', business_id)\
                                .execute()
                            
                            addresses = supabase.table('properties')\
                                .select('id, formatted_address')\
                                .in_('id', property_ids)\
                                .execute()
                            
                            address_map = {a['id']: a['formatted_address'] for a in addresses.data}
                            property_details_map = {p['property_id']: p for p in similar_properties}
                            
                            for doc in docs.data:
                                prop_id = next((dr['property_id'] for dr in doc_results.data if dr['document_id'] == doc['id']), None)
                                prop_details = property_details_map.get(prop_id, {}) if prop_id else {}
                                
                                # Build property context (include all fields for completeness)
                                property_context = ""
                                if prop_details:
                                    context_parts = []
                                    if prop_details.get('number_bedrooms') is not None:
                                        context_parts.append(f"{prop_details['number_bedrooms']} bedroom(s)")
                                    if prop_details.get('number_bathrooms') is not None:
                                        context_parts.append(f"{prop_details['number_bathrooms']} bathroom(s)")
                                    if prop_details.get('property_type'):
                                        context_parts.append(f"Type: {prop_details['property_type']}")
                                    if prop_details.get('size_sqft'):
                                        size_value = prop_details['size_sqft']
                                        size_unit = prop_details.get('size_unit', '').lower() if prop_details.get('size_unit') else ''
                                        # Only show as acres if explicitly stated in size_unit field
                                        if size_unit in ('acres', 'acre'):
                                            context_parts.append(f"Size: {size_value:,.2f} acres")
                                        else:
                                            context_parts.append(f"Size: {size_value:,.0f} sqft")
                                    if prop_details.get('asking_price'):
                                        context_parts.append(f"Asking price: £{prop_details['asking_price']:,.0f}")
                                    if prop_details.get('sold_price'):
                                        context_parts.append(f"Sold price: £{prop_details['sold_price']:,.0f}")
                                    if prop_details.get('rent_pcm'):
                                        context_parts.append(f"Rent (pcm): £{prop_details['rent_pcm']:,.0f}")
                                    if prop_details.get('tenure'):
                                        context_parts.append(f"Tenure: {prop_details['tenure']}")
                                    if prop_details.get('epc_rating'):
                                        context_parts.append(f"EPC: {prop_details['epc_rating']}")
                                    if prop_details.get('condition'):
                                        context_parts.append(f"Condition: {prop_details['condition']}")
                                    if context_parts:
                                        property_context = f"""PROPERTY DETAILS (VERIFIED FROM DATABASE - INCLUDES MANUALLY UPDATED VALUES):
This property has: {', '.join(context_parts)}.

This information has been verified and extracted from the property database, including any manually updated values. The document below may contain additional details about this property.

"""
                                
                                # Get chunks
                                chunks_result = supabase.table('document_vectors')\
                                    .select('chunk_text, chunk_index, page_number')\
                                    .eq('document_id', doc['id'])\
                                    .order('chunk_index')\
                                    .limit(20)\
                                    .execute()
                                
                                chunk_texts = [c.get('chunk_text', '').strip() for c in chunks_result.data if c.get('chunk_text', '').strip() and len(c.get('chunk_text', '').strip()) > 10]
                                # Extract party names for this document (similar to structured query above)
                                party_names_context_llm = ""
                                try:
                                    import json
                                    document_summary_llm = doc.get('document_summary')
                                    if document_summary_llm:
                                        if isinstance(document_summary_llm, str):
                                            try:
                                                document_summary_llm = json.loads(document_summary_llm)
                                                if isinstance(document_summary_llm, str):
                                                    document_summary_llm = json.loads(document_summary_llm)
                                            except (json.JSONDecodeError, TypeError):
                                                document_summary_llm = None
                                        
                                        if isinstance(document_summary_llm, dict):
                                            party_names_llm = document_summary_llm.get('party_names', {})
                                            if party_names_llm:
                                                name_parts_llm = []
                                                if valuer := party_names_llm.get('valuer'):
                                                    name_parts_llm.append(f"Valuer: {valuer}")
                                                if seller := party_names_llm.get('seller'):
                                                    name_parts_llm.append(f"Seller: {seller}")
                                                if buyer := party_names_llm.get('buyer'):
                                                    name_parts_llm.append(f"Buyer: {buyer}")
                                                if agent := party_names_llm.get('estate_agent'):
                                                    name_parts_llm.append(f"Estate Agent: {agent}")
                                                
                                                if name_parts_llm:
                                                    party_names_context_llm = "PARTY_NAMES: " + " | ".join(name_parts_llm) + "\n\n"
                                except Exception as e:
                                    logger.debug(f"[QUERY_LLM_SQL] Could not extract party names: {e}")
                                
                                combined_content = party_names_context_llm + property_context + "\n\n---\n\n".join(chunk_texts) if chunk_texts else party_names_context_llm + property_context + f"Similar property from {doc.get('original_filename', 'document')}."
                                
                                llm_sql_results.append({
                                    'doc_id': doc['id'],
                                    'document_id': doc['id'],
                                    'property_id': prop_id,
                                    'property_address': address_map.get(prop_id, 'Unknown'),
                                    'original_filename': doc.get('original_filename', ''),
                                    'classification_type': doc.get('classification_type', ''),
                                    'content': combined_content,
                                    'similarity_score': 0.8,  # Lower than exact matches
                                    'source': 'llm_sql_query',
                                    'chunk_index': 0,
                                    'page_number': None,
                                    'page_numbers': []
                                })
                        
                        logger.info(f"[QUERY_LLM_SQL] Found {len(llm_sql_results)} documents via LLM-driven SQL query")
            except Exception as e:
                logger.warning(f"[QUERY_LLM_SQL] LLM SQL query failed: {e}")
                import traceback
                logger.debug(traceback.format_exc())
        
        # STEP 4: Combine ALL search results (structured + LLM SQL + hybrid)
        # Priority: Structured (exact) > LLM SQL (similar) > Hybrid (semantic)
        seen_doc_ids = set()
        final_results = []
        
        # 1. Add structured results first (exact matches, highest priority)
        for doc in structured_results:
            doc_id = doc.get('doc_id') or doc.get('document_id')
            if doc_id and doc_id not in seen_doc_ids:
                final_results.append(doc)
                seen_doc_ids.add(doc_id)
        
        # 2. Add LLM SQL results (similar matches, medium priority)
        for doc in llm_sql_results:
            doc_id = doc.get('doc_id') or doc.get('document_id')
            if doc_id and doc_id not in seen_doc_ids:
                final_results.append(doc)
                seen_doc_ids.add(doc_id)
        
        # 3. Add hybrid results (semantic matches, lower priority, avoid duplicates)
        for doc in merged_results:
            doc_id = doc.get('doc_id') or doc.get('document_id')
            if doc_id and doc_id not in seen_doc_ids:
                final_results.append(doc)
                seen_doc_ids.add(doc_id)
        
        # STEP 5: Filter by document_ids if provided (for document-specific search)
        document_ids = state.get('document_ids')
        if document_ids and len(document_ids) > 0:
            # Convert to set for faster lookup
            document_ids_set = set(document_ids)
            filtered_results = [
                doc for doc in final_results
                if (doc.get('doc_id') or doc.get('document_id')) in document_ids_set
            ]
            logger.info(f"[QUERY_FILTERED] Filtered from {len(final_results)} to {len(filtered_results)} documents by document_ids")
            final_results = filtered_results
        
        logger.info(f"[QUERY_COMBINED] Structured: {len(structured_results)}, LLM SQL: {len(llm_sql_results)}, Hybrid: {len(merged_results)}, Final: {len(final_results)}")
        return {"relevant_documents": final_results[:config.vector_top_k]}

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("[QUERY_HYBRID] Hybrid search failed: %s", exc, exc_info=True)
        # Fallback to vector-only search if hybrid fails
        try:
            logger.info("[QUERY_HYBRID] Falling back to vector-only search")
            retriever = VectorDocumentRetriever()
            results = retriever.query_documents(
                user_query=state['user_query'],
                top_k=config.vector_top_k,
                business_id=state.get("business_id"),
            )
            return {"relevant_documents": results}
        except Exception as fallback_exc:
            logger.error("[QUERY_HYBRID] Fallback also failed: %s", fallback_exc, exc_info=True)
            return {"relevant_documents": []}


def query_structured_documents(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: SQL search (Structured Attributes)

    Converts natural language query to SQL and queries extracted property attributes.
    Only executes if query_intent includes "structured".
    
    Args:
        state: MainWorkflowState with user_query, query_intent
    
    Returns:
        Updated state with SQL results appended to relevant_documents
    """

    # Skip if not a structured query 
    if "structured" not in state['query_intent']:
        logger.debug("[QUERY_SQL] Skipping - not a structured query")
        return {"relevant_documents": []}

    logger.warning(
        "[QUERY_SQL] Structured retrieval not implemented yet; returning no results"
    )
    return {"relevant_documents": []}


def combine_and_deduplicate(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Combine and Deduplicate Results
    
    Merges vector and SQL results, removes duplicates by doc_id.
    If same document appears in both, marks as "hybrid" and merges metadata.
    
    Args:
        state: MainWorkflowState with relevant_documents (from both retrievers)
    
    Returns:
        Updated state with deduplicated relevant_documents
    """
    
    combined = state['relevant_documents']
    
    if not combined:
        logger.debug("[COMBINE] No documents to combine")
        return {"relevant_documents": []}

    seen = {}
    for doc in combined:
        key = (doc.get("doc_id"), doc.get("property_id"))
        existing = seen.get(key)
        if existing is None:
            seen[key] = doc
            continue

        # Mark as hybrid if sourced from multiple retrievers
        if doc.get("source") != existing.get("source"):
            existing["source"] = "hybrid"

        # Keep maximum similarity score (if available)
        existing["similarity_score"] = max(
            existing.get("similarity_score", 0.0),
            doc.get("similarity_score", 0.0),
        )

    deduplicated = list(seen.values())
    logger.info(
        "[COMBINE] Deduplicated %d documents to %d unique results",
        len(combined),
        len(deduplicated),
    )
    return {"relevant_documents": deduplicated}


def clarify_relevant_docs(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Clarify/Re-rank Documents
    
    1. Groups chunks by doc_id (merges chunks from same document)
    2. Uses LLM to re-rank documents by relevance to the original query
    3. Goes beyond vector similarity to semantic understanding
    
    Args:
        state: MainWorkflowState with relevant_documents
    
    Returns:
        Updated state with re-ranked, deduplicated relevant_documents
    """
    
    docs = state['relevant_documents']
    
    if not docs:
        logger.debug("[CLARIFY] No documents to clarify")
        return {"relevant_documents": []}
    
    # Step 1: Group chunks by doc_id
    doc_groups = {}
    for doc in docs:
        doc_id = doc.get('doc_id')
        if not doc_id:
            logger.warning("[CLARIFY] Skipping document with no doc_id")
            continue
        
        # Log first occurrence for debugging
        if doc_id not in doc_groups:
            logger.debug(f"[CLARIFY] Creating new group for doc_id: {doc_id[:8]}...")
            
        if doc_id not in doc_groups:
            # Initialize with first chunk's metadata
            doc_groups[doc_id] = {
                'doc_id': doc_id,
                'property_id': doc.get('property_id'),
                'classification_type': doc.get('classification_type'),
                'business_id': doc.get('business_id'),
                'address_hash': doc.get('address_hash'),
                'source': doc.get('source'),
                'chunks': [],
                'max_similarity': doc.get('similarity_score', 0.0),
                # NEW: Store filename and address from first chunk
                'original_filename': doc.get('original_filename'),
                'property_address': doc.get('property_address'),
            }
        
        # Append chunk content WITH bbox metadata
        doc_groups[doc_id]['chunks'].append({
            'content': doc.get('content', ''),
            'chunk_index': doc.get('chunk_index', 0),
            'page_number': doc.get('page_number', 0),
            'similarity': doc.get('similarity_score', 0.0),
            'bbox': doc.get('bbox'),  # NEW: Preserve bbox for citation/highlighting
            'vector_id': doc.get('vector_id'),  # NEW: Preserve vector_id for lookup
        })
        
        # Track highest similarity score across all chunks
        doc_groups[doc_id]['max_similarity'] = max(
            doc_groups[doc_id]['max_similarity'],
            doc.get('similarity_score', 0.0)
        )
    
    # Step 2: Merge chunks and create single document entry per doc_id
    merged_docs = []
    for doc_id, group in doc_groups.items():
        # Sort chunks by chunk_index for proper ordering
        group['chunks'].sort(key=lambda x: x['chunk_index'])
        
        # Merge chunk content (keep top 7 most relevant chunks for better context with 1200-char chunks)
        top_chunks = sorted(group['chunks'], key=lambda x: x['similarity'], reverse=True)[:7]
        merged_content = "\n\n".join([chunk['content'] for chunk in top_chunks])
        
        # Extract page numbers from top chunks (filter out 0 and None)
        page_numbers = sorted(set(
            chunk['page_number'] for chunk in top_chunks 
            if chunk.get('page_number') and chunk.get('page_number') > 0
        ))
        
        if len(page_numbers) > 1:
            page_range = f"pages {min(page_numbers)}-{max(page_numbers)}"
        elif len(page_numbers) == 1:
            page_range = f"page {page_numbers[0]}"
        else:
            # No valid page numbers, show chunk count instead
            page_range = f"{len(group['chunks'])} chunks"
        
        merged_docs.append({
            'doc_id': doc_id,
            'property_id': group['property_id'],
            'content': merged_content,
            'classification_type': group['classification_type'],
            'business_id': group['business_id'],
            'address_hash': group['address_hash'],
            'source': group['source'],
            'similarity_score': group['max_similarity'],
            'chunk_count': len(group['chunks']),
            'page_numbers': page_numbers,  # List of page numbers
            'page_range': page_range,  # Human-readable page range
            # NEW: Pass through filename and address
            'original_filename': group.get('original_filename'),
            'property_address': group.get('property_address'),
            # NEW: Store source chunks with full metadata for citation/highlighting
            'source_chunks_metadata': [
                {
                    'content': chunk['content'],
                    'chunk_index': chunk['chunk_index'],
                    'page_number': chunk['page_number'],
                    'bbox': chunk.get('bbox'),
                    'vector_id': chunk.get('vector_id'),
                    'similarity': chunk['similarity'],
                    'doc_id': doc_id  # NEW: Include doc_id in each chunk for citation recovery
                }
                for chunk in top_chunks  # Only top chunks used in summary
            ]
        })
    
    logger.info(
        "[CLARIFY] Grouped %d chunks into %d unique documents:",
        len(docs),
        len(merged_docs)
    )
    
    # Log unique doc IDs for debugging
    for idx, doc in enumerate(merged_docs[:10], 1):
        property_id = doc.get('property_id') or 'none'
        logger.info(
            f"  {idx}. Doc {doc['doc_id'][:8]}... | Property {property_id[:8]}... | "
            f"{doc.get('page_range', 'unknown')} | {doc.get('chunk_count', 0)} chunks"
        )
    
    # If only a few documents, skip reranking (not worth the cost/latency)
    if len(merged_docs) <= 3:
        logger.info("[CLARIFY] Only %d documents, skipping re-ranking", len(merged_docs))
        return {"relevant_documents": merged_docs}

    # Step 3: Cohere reranking (replaces expensive LLM reranking)
    try:
        from backend.llm.retrievers.cohere_reranker import CohereReranker
        
        reranker = CohereReranker()
        
        if reranker.is_enabled() and config.cohere_rerank_enabled:
            logger.info("[CLARIFY] Using Cohere reranker for %d documents", len(merged_docs))
            
            # Rerank documents using Cohere
            reranked_docs = reranker.rerank(
                query=state['user_query'],
                documents=merged_docs,
                top_n=min(len(merged_docs), 20)  # Limit to top 20
            )
            
            logger.info("[CLARIFY] Cohere reranked %d documents", len(reranked_docs))
            return {"relevant_documents": reranked_docs}
        else:
            logger.info("[CLARIFY] Cohere reranker disabled, using original order")
            return {"relevant_documents": merged_docs}
            
    except ImportError:
        logger.warning("[CLARIFY] Cohere reranker not available, falling back to LLM")
        # Fallback to LLM reranking if Cohere not available
        return _llm_rerank_fallback(state, merged_docs)
    except Exception as exc:
        logger.error("[CLARIFY] Cohere reranker failed: %s", exc)
        logger.warning("[CLARIFY] Falling back to original order")
        return {"relevant_documents": merged_docs}


def _llm_rerank_fallback(state: MainWorkflowState, merged_docs: List[Dict]) -> MainWorkflowState:
    """Fallback LLM reranking if Cohere fails."""
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )

    # LLM re-ranking (for merged documents)
    doc_summary = "\n".join(
        (
            f"- Doc {idx + 1}: ID={(doc.get('doc_id') or 'unknown')[:8]} | "
            f"Property={(doc.get('property_id') or 'none')[:8]} | "
            f"Type={doc.get('classification_type', '')} | "
            f"Chunks={doc.get('chunk_count', 1)} | "
            f"Similarity={doc.get('similarity_score', 0.0):.2f} | "
            f"Source={doc.get('source', 'unknown')}"
        )
        for idx, doc in enumerate(merged_docs)
    )

    # Get system prompt for ranking task
    system_msg = get_system_prompt('rank')
    
    # Get human message content
    human_content = get_reranking_human_content(
        user_query=state['user_query'],
        doc_summary=doc_summary
    )
    
    try:
        # Use LangGraph message format
        messages = [system_msg, HumanMessage(content=human_content)]
        response = llm.invoke(messages)
        ranked_ids = json.loads(response.content)
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("[CLARIFY] Failed to parse ranking; returning original order: %s", exc)
        return {"relevant_documents": merged_docs}

    doc_map = {doc["doc_id"]: doc for doc in merged_docs if doc.get("doc_id")}
    reordered = [doc_map[doc_id] for doc_id in ranked_ids if doc_id in doc_map]

    # Append any documents missing from LLM output
    for doc in merged_docs:
        if doc not in reordered:
            reordered.append(doc)

    logger.info("[CLARIFY] LLM fallback re-ranked %d unique documents", len(reordered))
    return {"relevant_documents": reordered}




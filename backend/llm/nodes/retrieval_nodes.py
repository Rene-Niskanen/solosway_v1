"""
Retrieval nodes: Query classification, vector search, SQL search, deduplication, clarification.
"""

import json
import logging
from typing import Optional

from langchain_openai import ChatOpenAI

from backend.llm.config import config
from backend.llm.types import MainWorkflowState, RetrievedDocument
from backend.llm.retrievers.vector_retriever import VectorDocumentRetriever
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
        history_lines.append(f"User asked: {exchange['query']}")
        # Include summary for context
        summary_preview = exchange['summary'][:400].replace('\n', ' ')
        history_lines.append(f"Assistant responded: {summary_preview}...")
    
    history_context = "\n".join(history_lines)
    
    prompt = f"""You are helping rewrite a user's follow-up query to include missing context from the conversation.

CONVERSATION HISTORY:
{history_context}

CURRENT QUERY:
"{state['user_query']}"

TASK:
If the current query contains vague references like:
- "the document", "that report", "this file", "it"
- "the property", "that building", "this place", "there"
- "those", "these", "them"

Then rewrite the query to be self-contained by including specific details from the conversation:
- Property addresses (e.g., "Highlands, Berden Road, Bishop's Stortford")
- Document names (e.g., "Highlands_Berden_Bishops_Stortford valuation report")
- Property features (e.g., "5 bedroom, 5 bathroom property")
- Prices or values mentioned (e.g., "£2,400,000 property")

If the query is already specific and complete, return it UNCHANGED.

IMPORTANT: 
- Return ONLY the rewritten query text
- No explanations, quotes, or extra formatting
- Keep the query concise (under 200 words)
- Preserve the user's intent and tone

Examples:
Input: "What's the appraised value?"
Output: What's the appraised value for the Highlands, Berden Road property?

Input: "Review the document and show me comparable prices"
Output: Review the Highlands_Berden_Bishops_Stortford_CM23_1AB valuation report and show comparable property prices

Input: "Find me properties with 5 bedrooms in London"
Output: Find me properties with 5 bedrooms in London
(no rewrite needed - already specific)

Rewritten query:"""
    
    try:
        response = llm.invoke(prompt)
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
            history_lines.append(f"User: {exchange['query']}")
            history_lines.append(f"Assistant: {exchange['summary'][:200]}...")
        history_context = f"\n\nPrevious conversation:\n" + "\n".join(history_lines)

    prompt = f"""Classify this user query as ONE of these types:

        - "semantic": Query describes appearance, features, or condition (fuzzy/descriptive search)
        Examples: "foundation damage", "natural light", "roof condition", "water damage"
        
        - "structured": Query asks for specific attributes (numeric or categorical filters)
        Examples: "4 bedrooms", "under $500k", "built after 2010", "has pool"
        
        - "hybrid": Query combines both semantic and structured elements
        Examples: "4 bed homes with foundation issues", "inspection documents with damage reports"
{history_context}

        Current User Query: "{state['user_query']}"

    Return ONLY a single word: "semantic", "structured", or "hybrid"."""

    response = llm.invoke(prompt)
    intent = response.content.lower().strip()

    if intent not in {"semantic", "structured", "hybrid"}:
        logger.warning("Invalid intent '%s', defaulting to 'hybrid'", intent)
        intent = "hybrid"

    logger.info("[ROUTE_QUERY] Classified query as: %s", intent)
    return {"query_intent": intent}


def query_vector_documents(state: MainWorkflowState) -> MainWorkflowState:
    """
    Node: Vector Search (semantic similarity)

    Uses embeddings + Supabase pgvector HNSW index for semantic similarity search.
    In vector-only mode, this always executes (no intent check needed).

    Args:
        state: MainWorkflowState with user_query, business_id

    Returns:
        Updated state with vector results appended to relevant_documents
    """

    try:
        retriever = VectorDocumentRetriever()
        results = retriever.query_documents(
            user_query=state["user_query"],
            top_k=config.vector_top_k,
            business_id=state.get("business_id"),
        )
        logger.info(
            "[QUERY_VECTOR] Retrieved %d documents via vector search",
            len(results),
        )
        return {"relevant_documents": results}

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("[QUERY_VECTOR] Vector search failed: %s", exc, exc_info=True)
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
        
        # Append chunk content
        doc_groups[doc_id]['chunks'].append({
            'content': doc.get('content', ''),
            'chunk_index': doc.get('chunk_index', 0),
            'page_number': doc.get('page_number', 0),
            'similarity': doc.get('similarity_score', 0.0),
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
        
        # Merge chunk content (keep top 5 most relevant chunks to avoid token overflow)
        top_chunks = sorted(group['chunks'], key=lambda x: x['similarity'], reverse=True)[:5]
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
        })
    
    logger.info(
        "[CLARIFY] Grouped %d chunks into %d unique documents:",
        len(docs),
        len(merged_docs)
    )
    
    # Log unique doc IDs for debugging
    for idx, doc in enumerate(merged_docs[:10], 1):
        logger.info(
            f"  {idx}. Doc {doc['doc_id'][:8]}... | Property {doc.get('property_id', '')[:8]}... | "
            f"{doc.get('page_range', 'unknown')} | {doc.get('chunk_count', 0)} chunks"
        )
    
    # If only a few documents, skip LLM re-ranking (not worth the cost/latency)
    if len(merged_docs) <= 3:
        logger.info("[CLARIFY] Only %d documents, skipping re-ranking", len(merged_docs))
        return {"relevant_documents": merged_docs}

    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )

    # Step 3: LLM re-ranking (for merged documents)
    doc_summary = "\n".join(
        (
            f"- Doc {idx + 1}: ID={doc.get('doc_id', '')[:8]} | "
            f"Property={doc.get('property_id', '')[:8]} | "
            f"Type={doc.get('classification_type', '')} | "
            f"Chunks={doc.get('chunk_count', 1)} | "
            f"Similarity={doc.get('similarity_score', 0.0):.2f} | "
            f"Source={doc.get('source', 'unknown')}"
        )
        for idx, doc in enumerate(merged_docs)
    )

    prompt = f"""Given the user query, rank these documents by relevance (most relevant first).

User Query: "{state['user_query']}"

Available Documents (unique documents, chunks already merged):
{doc_summary}

Consider:
1. Direct relevance to the query
2. Document type and classification
3. Similarity score from retrieval
4. Number of matching chunks (more chunks = more relevant)

Return ONLY a JSON array of document IDs in order of relevance:
["doc_id_1", "doc_id_2", "doc_id_3", ...]"""
    
    try:
        response = llm.invoke(prompt)
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

    logger.info("[CLARIFY] Re-ranked %d unique documents", len(reordered))
    return {"relevant_documents": reordered}




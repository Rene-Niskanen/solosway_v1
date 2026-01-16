"""
Follow-up Query Handler Node: Handles queries asking for more detail on previous document search responses.

Examples:
- "make it more detailed on the assumptions" → Get more detail on assumptions
- "tell me more about the 90-day value" → Get more detail on 90-day value
- "what are the assumptions for each value" → Get assumptions for all values
"""

import logging
import re
import json
from typing import Optional, Dict, List, Any
from datetime import datetime
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

from backend.llm.config import config
from backend.llm.types import MainWorkflowState
from backend.llm.utils.system_prompts import get_system_prompt

logger = logging.getLogger(__name__)


def _get_last_document_search_entry(conversation_history: list) -> Optional[dict]:
    """Get last conversation entry that was a document search (has block_ids)"""
    if not conversation_history:
        return None
    
    # Search backwards for entry with block_ids
    for entry in reversed(conversation_history):
        if isinstance(entry, dict) and entry.get('block_ids'):
            return entry
    
    return None


def _extract_topic_from_query(user_query: str) -> str:
    """
    Extract what the user wants more detail on.
    
    Examples:
    - "make it more detailed on the assumptions" → "assumptions"
    - "tell me more about the 90-day value" → "90-day value"
    - "what are the assumptions for each value" → "assumptions for each value"
    """
    query_lower = user_query.lower()
    
    # Pattern matching
    patterns = [
        r'more detailed on (.+)',
        r'tell me more about (.+)',
        r'what are the (.+)',
        r'expand on (.+)',
        r'elaborate on (.+)',
        r'provide more information on (.+)',
        r'give me more detail on (.+)',
        r'can you explain more about (.+)',
        r'what about (.+)'
    ]
    
    for pattern in patterns:
        match = re.search(pattern, query_lower)
        if match:
            topic = match.group(1).strip()
            # Clean up common trailing phrases
            topic = re.sub(r'\s+(mentioned|stated|shown|given|above|below|here).*$', '', topic, flags=re.IGNORECASE)
            return topic
    
    # Fallback: return query as-is (will be used for filtering)
    return user_query


async def _retrieve_blocks_by_positions(
    block_positions: list[dict],
    doc_ids: list[str]
) -> list[dict]:
    """
    Retrieve chunks using stored block positions.
    
    Uses (doc_id, chunk_index) to fetch chunks directly from document_summary.reducto_chunks.
    """
    from backend.services.supabase_client_factory import get_supabase_client
    
    # Group by (doc_id, chunk_index)
    chunks_to_fetch = {}
    for pos in block_positions:
        doc_id = pos.get('doc_id')
        chunk_index = pos.get('chunk_index', 0)
        
        if doc_id:
            key = (doc_id, chunk_index)
            if key not in chunks_to_fetch:
                chunks_to_fetch[key] = []
            chunks_to_fetch[key].append(pos)
    
    # Fetch chunks for each document
    retrieved_chunks = []
    supabase = get_supabase_client()
    
    for (doc_id, chunk_index), positions in chunks_to_fetch.items():
        try:
            # Fetch document to get document_summary
            doc_result = supabase.table('documents')\
                .select('id, document_summary')\
                .eq('id', doc_id)\
                .single()\
                .execute()
            
            if not doc_result.data:
                continue
            
            document_summary = doc_result.data.get('document_summary')
            if isinstance(document_summary, str):
                document_summary = json.loads(document_summary)
            
            # Get reducto_chunks
            reducto_chunks = document_summary.get('reducto_chunks', [])
            if not reducto_chunks or chunk_index >= len(reducto_chunks):
                continue
            
            # Get the specific chunk
            chunk = reducto_chunks[chunk_index]
            blocks = chunk.get('blocks', [])
            
            # Extract page number from chunk bbox
            chunk_bbox = chunk.get('bbox', {})
            page_number = chunk_bbox.get('page', 0) if isinstance(chunk_bbox, dict) else 0
            
            retrieved_chunks.append({
                'doc_id': doc_id,
                'chunk_index': chunk_index,
                'content': chunk.get('content', ''),
                'blocks': blocks,
                'page_number': page_number,
                'bbox': chunk_bbox,
                'block_positions': positions  # Store positions for reference
            })
            
        except Exception as e:
            logger.warning(f"[FOLLOW_UP] Error retrieving chunk for doc {doc_id[:8]}, chunk {chunk_index}: {e}")
            continue
    
    return retrieved_chunks


async def _determine_search_strategy(
    user_query: str,
    topic: str,
    previous_summary: str,
    valuation_pages: list[int]
) -> dict:
    """
    Use LLM to determine search strategy for follow-up queries.
    
    Returns:
        {
            "search_direction": "backwards" | "forwards" | "both",
            "page_range": {"start": int, "end": int},
            "search_keywords": list[str],
            "focus": str (description of what to focus on)
        }
    """
    min_page = min(valuation_pages) if valuation_pages else 1
    max_page = max(valuation_pages) if valuation_pages else 1
    
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
        streaming=False
    )
    
    strategy_prompt = f"""You are analyzing a follow-up query to determine how to search a document.

**USER QUERY:** "{user_query}"
**TOPIC EXTRACTED:** "{topic}"
**PREVIOUS RESPONSE:** {previous_summary[:500]}...
**VALUATION PAGES:** Pages {min_page}-{max_page} contain the values/figures from the previous response.

**TASK:**
Determine the search strategy to find the information the user is asking for.

**EXAMPLES:**
- If user asks about "assumptions" or "conditions" that were stated BEFORE the valuation: search BACKWARDS from the valuation pages
- If user asks about "implications" or "consequences" AFTER the valuation: search FORWARDS from the valuation pages
- If user asks about the valuation figures themselves: search AROUND the valuation pages

**OUTPUT FORMAT (JSON):**
{{
    "search_direction": "backwards" | "forwards" | "both" | "around",
    "page_range": {{
        "start": <page number to start from>,
        "end": <page number to end at>
    }},
    "search_keywords": ["keyword1", "keyword2", ...],
    "focus": "Brief description of what information to look for"
}}

**IMPORTANT:**
- For "assumptions", "conditions", "basis", "special assumptions" - these are typically stated BEFORE the valuation figures, so search backwards from page {min_page}
- For "implications", "consequences", "next steps" - these are typically AFTER, so search forwards
- Include relevant synonyms and related terms in search_keywords
- The page_range should be reasonable (e.g., if searching backwards for assumptions, start from page 1 and go up to the valuation pages)

**Your analysis:**"""
    
    try:
        response = await llm.ainvoke([HumanMessage(content=strategy_prompt)])
        strategy_text = response.content.strip()
        
        # Extract JSON from response (might be wrapped in markdown code blocks)
        if "```json" in strategy_text:
            strategy_text = strategy_text.split("```json")[1].split("```")[0].strip()
        elif "```" in strategy_text:
            strategy_text = strategy_text.split("```")[1].split("```")[0].strip()
        
        strategy = json.loads(strategy_text)
        logger.info(f"[FOLLOW_UP] LLM search strategy: {strategy}")
        return strategy
    except Exception as e:
        logger.warning(f"[FOLLOW_UP] Failed to get LLM search strategy: {e}, using default")
        # Default strategy: search around valuation pages
        return {
            "search_direction": "both",
            "page_range": {"start": max(1, min_page - 5), "end": max_page + 5},
            "search_keywords": topic.lower().split(),
            "focus": f"Information about {topic}"
        }


async def _search_around_blocks(
    chunks: list[dict],
    topic: str,
    user_query: str,
    previous_summary: str,
    doc_ids: list[str]
) -> list[dict]:
    """
    Search around retrieved chunks for related information using LLM-determined strategy.
    
    Strategy:
    1. Use LLM to determine search direction and keywords
    2. Fetch pages based on LLM strategy
    3. Filter for topic relevance using LLM-determined keywords
    """
    if not chunks:
        return []
    
    # Get unique page numbers from valuation chunks
    pages = set()
    for chunk in chunks:
        page = chunk.get('page_number', 0)
        if page > 0:
            pages.add(page)
    
    if not pages:
        return chunks  # Return original if no pages
    
    # Use LLM to determine search strategy
    strategy = await _determine_search_strategy(
        user_query=user_query,
        topic=topic,
        previous_summary=previous_summary,
        valuation_pages=list(pages)
    )
    
    # Determine page range based on LLM strategy
    expanded_pages = set()
    direction = strategy.get("search_direction", "both")
    page_range = strategy.get("page_range", {})
    
    if page_range and "start" in page_range and "end" in page_range:
        # Use explicit page range from LLM
        start_page = max(1, page_range["start"])
        end_page = page_range["end"]
        for page in range(start_page, end_page + 1):
            expanded_pages.add(page)
        logger.info(f"[FOLLOW_UP] Using LLM page range: {start_page}-{end_page}")
    else:
        # Fallback: use direction-based expansion
        min_page = min(pages)
        max_page = max(pages)
        
        if direction == "backwards":
            # Search from page 1 to valuation pages
            for page in range(1, max_page + 3):
                expanded_pages.add(page)
        elif direction == "forwards":
            # Search from valuation pages onwards
            for page in range(min_page, max_page + 10):
                expanded_pages.add(page)
        elif direction == "both":
            # Search both directions
            for page in range(max(1, min_page - 5), max_page + 5):
                expanded_pages.add(page)
        else:  # "around"
            # Standard ±2 pages
            for page in pages:
                expanded_pages.add(page)
                if page > 1:
                    expanded_pages.add(page - 1)
                    expanded_pages.add(page - 2)
                expanded_pages.add(page + 1)
                expanded_pages.add(page + 2)
    
    # Fetch chunks from expanded pages
    from backend.services.supabase_client_factory import get_supabase_client
    
    expanded_chunks = list(chunks)  # Start with original chunks
    supabase = get_supabase_client()
    
    for doc_id in doc_ids:
        try:
            # Fetch document
            doc_result = supabase.table('documents')\
                .select('id, document_summary')\
                .eq('id', doc_id)\
                .single()\
                .execute()
            
            if not doc_result.data:
                continue
            
            document_summary = doc_result.data.get('document_summary')
            if isinstance(document_summary, str):
                document_summary = json.loads(document_summary)
            
            reducto_chunks = document_summary.get('reducto_chunks', [])
            
            # Add chunks from expanded pages
            for chunk_idx, chunk in enumerate(reducto_chunks):
                chunk_bbox = chunk.get('bbox', {})
                chunk_page = chunk_bbox.get('page', 0) if isinstance(chunk_bbox, dict) else 0
                
                if chunk_page in expanded_pages:
                    # Check if we already have this chunk
                    if not any(c.get('doc_id') == doc_id and c.get('chunk_index') == chunk_idx 
                              for c in expanded_chunks):
                        expanded_chunks.append({
                            'doc_id': doc_id,
                            'chunk_index': chunk_idx,
                            'content': chunk.get('content', ''),
                            'blocks': chunk.get('blocks', []),
                            'page_number': chunk_page,
                            'bbox': chunk_bbox
                        })
        except Exception as e:
            logger.warning(f"[FOLLOW_UP] Error fetching expanded chunks for doc {doc_id[:8]}: {e}")
            continue
    
    # Filter for topic relevance using LLM-determined keywords
    search_keywords = strategy.get("search_keywords", [])
    if not search_keywords and topic:
        # Fallback to topic words
        search_keywords = [kw for kw in topic.lower().split() if len(kw) > 3]
    
    if search_keywords:
        relevant_chunks = []
        for chunk in expanded_chunks:
            content_lower = chunk.get('content', '').lower()
            # Check if chunk contains any search keywords
            if any(keyword.lower() in content_lower for keyword in search_keywords):
                relevant_chunks.append(chunk)
        
        if relevant_chunks:
            logger.info(f"[FOLLOW_UP] Filtered to {len(relevant_chunks)} relevant chunks using keywords: {search_keywords[:5]}")
            # Sort by page number (earlier pages first for backwards searches)
            if direction == "backwards":
                relevant_chunks.sort(key=lambda c: c.get('page_number', 0))
            return relevant_chunks
    
    return expanded_chunks


async def _generate_detailed_response(
    user_query: str,
    topic: str,
    chunks: list[dict],
    conversation_history: list,
    previous_entry: dict
) -> str:
    """
    Generate detailed response using retrieved chunks and LLM understanding.
    
    Uses an LLM to understand what the user is asking for and generate appropriate instructions.
    """
    # Format chunks for LLM
    formatted_chunks = []
    for chunk in chunks:
        content = chunk.get('content', '')
        doc_id = chunk.get('doc_id', '')[:8]
        page = chunk.get('page_number', 0)
        formatted_chunks.append(f"[Doc {doc_id}, Page {page}]\n{content}\n")
    
    formatted_outputs = "\n---\n".join(formatted_chunks)
    
    # Build conversation context
    history_context = ""
    if conversation_history:
        recent_history = conversation_history[-2:]  # Last 2 exchanges
        history_lines = []
        for exchange in recent_history:
            if isinstance(exchange, dict):
                if 'query' in exchange and 'summary' in exchange:
                    history_lines.append(f"Previous Q: {exchange['query']}")
                    history_lines.append(f"Previous A: {exchange['summary'][:300]}...\n")
        if history_lines:
            history_context = "CONVERSATION HISTORY:\n" + "\n".join(history_lines) + "\n\n"
    
    # Use LLM to understand what the user wants and generate appropriate instructions
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
        streaming=False
    )
    
    instruction_prompt = f"""Analyze the user's follow-up query and determine what they are asking for.

**USER QUERY:** "{user_query}"
**TOPIC:** "{topic}"
**PREVIOUS RESPONSE:** {previous_entry.get('summary', '')[:500]}...

**TASK:**
Generate specific instructions for answering this query. The user is asking for more detail, but you need to understand:
1. What specific information are they looking for?
2. What should be emphasized vs. what should be avoided?
3. What context from the previous response is relevant?

**EXAMPLES:**
- If user asks about "assumptions" after seeing valuation figures: They want the assumptions/conditions stated BEFORE the valuation, NOT the same figures again
- If user asks about "implications": They want information AFTER the valuation
- If user asks to "make it more detailed": They want more comprehensive information on the same topic

**OUTPUT:**
Provide clear, specific instructions for answering this query. Focus on what information to extract and what to avoid repeating.

**Instructions:**"""
    
    try:
        instruction_response = await llm.ainvoke([HumanMessage(content=instruction_prompt)])
        specific_instructions = instruction_response.content.strip()
        logger.info(f"[FOLLOW_UP] LLM-generated instructions: {specific_instructions[:200]}...")
    except Exception as e:
        logger.warning(f"[FOLLOW_UP] Failed to get LLM instructions: {e}, using default")
        specific_instructions = f"Provide a detailed answer focused specifically on: {topic}. Extract all relevant information about this topic from the document sections above. Be comprehensive and detailed. Include specific values, assumptions, conditions, or details mentioned. Cite which document sections support your answer."
    
    # Get system prompt (use 'summarize' task)
    system_msg = get_system_prompt('summarize')
    
    # Create focused prompt for follow-up query
    human_prompt = f"""**USER QUESTION:**  
"{user_query}"

**CONTEXT:**
The user is asking for more detailed information on: {topic}

**PREVIOUS RESPONSE:**
{previous_entry.get('summary', '')[:500]}...

**CONVERSATION HISTORY:**  
{history_context}

**DOCUMENT CONTENT (from relevant sections):**  
{formatted_outputs}

**SPECIFIC INSTRUCTIONS:**
{specific_instructions}

**Answer:**"""
    
    # Call LLM
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
        streaming=False
    )
    
    response = await llm.ainvoke([system_msg, HumanMessage(content=human_prompt)])
    return response.content.strip()


async def handle_follow_up_query(state: MainWorkflowState) -> MainWorkflowState:
    """
    Main follow-up query router - decides between fast and full modes.
    
    FAST MODE (~1-2s): When we have good conversation context, use single LLM call
    FULL MODE (~8-12s): When we need to retrieve more document context
    
    Fast mode is used for:
    - Simple clarification questions
    - Questions about what was already discussed
    - Requests for reformatting/rephrasing
    
    Full mode is used for:
    - Requests for NEW information not in previous response
    - Questions requiring document re-analysis
    """
    user_query = state.get("user_query", "").lower()
    conversation_history = state.get("conversation_history", [])
    
    # Check if we have previous context
    previous_entry = _get_last_document_search_entry(conversation_history)
    
    if not previous_entry:
        logger.info("[FOLLOW_UP_ROUTER] No previous entry, using full mode")
        return await handle_follow_up_query_full(state)
    
    # Heuristics for fast mode eligibility
    fast_mode_triggers = [
        "explain",
        "clarify", 
        "what do you mean",
        "can you expand",
        "tell me more",
        "more detail",
        "elaborate",
        "in other words",
        "rephrase",
        "summarize",
        "shorter",
        "longer",
        "simpler",
        "what about",
        "how about",
        "and the",
        "what's the",
        "whats the",
    ]
    
    # Full mode triggers (need document re-retrieval)
    full_mode_triggers = [
        "show me the exact",
        "quote from",
        "page number",
        "which document",
        "find me",
        "search for",
        "look for",
        "different section",
        "other part",
        "elsewhere in"
    ]
    
    # Check for full mode triggers first
    if any(trigger in user_query for trigger in full_mode_triggers):
        logger.info(f"[FOLLOW_UP_ROUTER] Full mode trigger detected, using full mode")
        return await handle_follow_up_query_full(state)
    
    # Check for fast mode triggers or short questions
    is_fast_eligible = (
        any(trigger in user_query for trigger in fast_mode_triggers) or
        len(user_query.split()) <= 10  # Short questions are usually fast-eligible
    )
    
    if is_fast_eligible and previous_entry.get('summary'):
        logger.info(f"⚡ [FOLLOW_UP_ROUTER] Using FAST mode (single LLM call)")
        return await handle_follow_up_query_fast(state)
    
    logger.info(f"[FOLLOW_UP_ROUTER] Using full mode (document retrieval)")
    return await handle_follow_up_query_full(state)


async def handle_follow_up_query_fast(state: MainWorkflowState) -> MainWorkflowState:
    """
    ULTRA-FAST follow-up query handler (~1-2 seconds).
    
    Uses cached conversation context to answer follow-up questions in a SINGLE LLM call.
    No retrieval, no search strategy, no instructions - just direct Q&A with context.
    
    Returns:
        State with final_summary (ready for format_response)
    """
    user_query = state.get("user_query", "")
    conversation_history = state.get("conversation_history", [])
    
    logger.info(f"⚡ [FAST_FOLLOW_UP] Processing follow-up query: '{user_query[:50]}...'")
    
    # Get previous conversation context
    previous_entry = _get_last_document_search_entry(conversation_history)
    if not previous_entry:
        # Fallback to full follow-up handler
        logger.info("[FAST_FOLLOW_UP] No previous entry, falling back to full handler")
        return await handle_follow_up_query_full(state)
    
    previous_summary = previous_entry.get('summary', '')
    previous_query = previous_entry.get('query', '')
    doc_ids = previous_entry.get('document_ids', [])
    
    if not previous_summary:
        logger.info("[FAST_FOLLOW_UP] No previous summary, falling back to full handler")
        return await handle_follow_up_query_full(state)
    
    # Build conversation context from recent history
    context_parts = []
    for entry in conversation_history[-3:]:  # Last 3 exchanges
        if isinstance(entry, dict) and entry.get('query') and entry.get('summary'):
            context_parts.append(f"Q: {entry['query']}\nA: {entry['summary'][:1000]}")
    
    conversation_context = "\n\n---\n\n".join(context_parts) if context_parts else f"Q: {previous_query}\nA: {previous_summary}"
    
    # Single fast LLM call
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )
    
    prompt = f"""You are answering a follow-up question based on a previous conversation about documents.

**PREVIOUS CONVERSATION:**
{conversation_context}

**USER'S FOLLOW-UP QUESTION:**
{user_query}

**INSTRUCTIONS:**
1. Answer the follow-up question based on the conversation context above
2. If the question asks for more detail on something mentioned, provide that detail
3. If the question asks about something not in the context, say so clearly
4. Be concise but thorough
5. Use the same formatting style as the previous response
6. IMPORTANT: Do NOT include citation numbers like [1], [2], etc. in your response. Just provide the information directly without citations.

**Answer:**"""

    try:
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        answer = response.content.strip()
        
        logger.info(f"⚡ [FAST_FOLLOW_UP] Generated answer in single LLM call ({len(answer)} chars)")
        
        # Update conversation history
        conversation_entry = {
            "query": user_query,
            "summary": answer,
            "timestamp": datetime.now().isoformat(),
            "document_ids": doc_ids,
            "query_category": "follow_up_fast"
        }
        
        updated_history = list(conversation_history) + [conversation_entry]
        
        return {
            "final_summary": answer,
            "conversation_history": updated_history,
            "document_outputs": [],
            "citations": []
        }
        
    except Exception as e:
        logger.error(f"[FAST_FOLLOW_UP] Error: {e}, falling back to full handler")
        return await handle_follow_up_query_full(state)


async def handle_follow_up_query_full(state: MainWorkflowState) -> MainWorkflowState:
    """
    Full follow-up query handler with document retrieval (slower but more thorough).
    
    Examples:
    - "make it more detailed on the assumptions" → Get more detail on assumptions
    - "tell me more about the 90-day value" → Get more detail on 90-day value
    - "what are the assumptions for each value" → Get assumptions for all values
    
    Flow:
    1. Extract block positions from previous conversation entry
    2. Extract topic from current query
    3. Retrieve blocks using stored positions
    4. Search around those blocks for related information
    5. Generate detailed response
    """
    user_query = state.get("user_query", "")
    conversation_history = state.get("conversation_history", [])
    
    # Get previous document search entry
    logger.info(f"[FOLLOW_UP] Checking conversation history (length: {len(conversation_history)})")
    previous_entry = _get_last_document_search_entry(conversation_history)
    
    if not previous_entry:
        logger.warning("[FOLLOW_UP] No previous document search entry found in conversation history")
        logger.debug(f"[FOLLOW_UP] Conversation history length: {len(conversation_history)}")
        if conversation_history:
            logger.debug(f"[FOLLOW_UP] Last entry keys: {list(conversation_history[-1].keys()) if isinstance(conversation_history[-1], dict) else 'not a dict'}")
            logger.debug(f"[FOLLOW_UP] Last entry: {conversation_history[-1]}")
        return {"query_category": "document_search"}  # Fallback to normal search
    
    logger.info(f"[FOLLOW_UP] Found previous entry with query: '{previous_entry.get('query', 'N/A')[:50]}...'")
    logger.info(f"[FOLLOW_UP] Previous entry has block_ids: {bool(previous_entry.get('block_ids'))}, count: {len(previous_entry.get('block_ids', []))}")
    logger.info(f"[FOLLOW_UP] Previous entry has block_positions: {bool(previous_entry.get('block_positions'))}, count: {len(previous_entry.get('block_positions', []))}")
    logger.info(f"[FOLLOW_UP] Previous entry has document_ids: {bool(previous_entry.get('document_ids'))}, count: {len(previous_entry.get('document_ids', []))}")
    
    if not previous_entry.get('block_ids'):
        logger.warning(f"[FOLLOW_UP] Previous entry found but no block_ids. Entry keys: {list(previous_entry.keys())}")
        logger.debug(f"[FOLLOW_UP] Previous entry query_category: {previous_entry.get('query_category')}")
        logger.debug(f"[FOLLOW_UP] Previous entry full content: {previous_entry}")
        # Even without block_ids, if we have document_ids from previous query, use them for fallback
        prev_doc_ids = previous_entry.get('document_ids', [])
        if prev_doc_ids:
            logger.info(f"[FOLLOW_UP] Falling back to document_search but using previous document_ids: {prev_doc_ids}")
            return {
                "query_category": "document_search",
                "document_ids": prev_doc_ids  # Pass document_ids to help with search
            }
        return {"query_category": "document_search"}  # Fallback to normal search
    
    # Extract topic from query
    topic = _extract_topic_from_query(user_query)
    logger.info(f"[FOLLOW_UP] Extracted topic: '{topic}' from query: '{user_query[:50]}...'")
    
    # Get stored data from previous query
    block_ids = previous_entry.get('block_ids', [])
    block_positions = previous_entry.get('block_positions', [])
    block_metadata_summary = previous_entry.get('block_metadata_summary', {})
    doc_ids = previous_entry.get('document_ids', [])
    
    logger.info(f"[FOLLOW_UP] Reusing {len(block_ids)} block IDs from previous query")
    
    try:
        # Use block_positions if available, otherwise fall back to block_metadata_summary
        if block_positions:
            # Retrieve chunks using stored positions
            relevant_chunks = await _retrieve_blocks_by_positions(
                block_positions, doc_ids
            )
        else:
            # Fallback: use block_metadata_summary to reconstruct positions
            logger.warning("[FOLLOW_UP] block_positions not found, reconstructing from block_metadata_summary")
            reconstructed_positions = []
            for block_id in block_ids:
                meta = block_metadata_summary.get(block_id, {})
                if meta.get('doc_id'):
                    reconstructed_positions.append({
                        'doc_id': meta['doc_id'],
                        'chunk_index': meta.get('chunk_index', 0),
                        'page': meta.get('page', 0),
                        'block_id': block_id
                    })
            relevant_chunks = await _retrieve_blocks_by_positions(
                reconstructed_positions, doc_ids
            )
        
        if not relevant_chunks:
            logger.warning("[FOLLOW_UP] No chunks retrieved from block positions, falling back to document_search")
            # Pass document_ids to help with fallback search
            if doc_ids:
                logger.info(f"[FOLLOW_UP] Falling back with document_ids: {doc_ids}")
                return {
                    "query_category": "document_search",
                    "document_ids": doc_ids
                }
            return {"query_category": "document_search"}
        
        # Search around those blocks for related information using LLM strategy
        previous_summary = previous_entry.get('summary', '')
        expanded_chunks = await _search_around_blocks(
            relevant_chunks, topic, user_query, previous_summary, doc_ids
        )
        
        if not expanded_chunks:
            logger.warning("[FOLLOW_UP] No expanded chunks found, using original chunks")
            expanded_chunks = relevant_chunks
        
        # Generate detailed response
        detailed_response = await _generate_detailed_response(
            user_query, topic, expanded_chunks, conversation_history, previous_entry
        )
        
        # Update conversation history
        conversation_entry = {
            "query": user_query,
            "summary": detailed_response,
            "timestamp": datetime.now().isoformat(),
            "document_ids": doc_ids,
            "query_category": "follow_up_document_search"
        }
        
        logger.info(f"[FOLLOW_UP] Generated detailed response ({len(detailed_response)} chars)")
        
        # Append to existing conversation history (don't replace)
        updated_history = list(conversation_history) + [conversation_entry]
        
        return {
            "final_summary": detailed_response,
            "conversation_history": updated_history,
            "document_outputs": [],  # Empty list to satisfy views.py check
            "citations": []  # Will be populated by format_response if needed
        }
        
    except Exception as exc:
        logger.error(f"[FOLLOW_UP] Error handling follow-up query: {exc}", exc_info=True)
        # Fallback to normal document search, but try to pass document_ids if available
        if doc_ids:
            logger.info(f"[FOLLOW_UP] Error fallback with document_ids: {doc_ids}")
            return {
                "query_category": "document_search",
                "document_ids": doc_ids
            }
        return {"query_category": "document_search"}


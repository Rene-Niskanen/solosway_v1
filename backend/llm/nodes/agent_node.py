"""
Unified Agent Node - Handles document/chunk retrieval and answer generation via tools.

This node replaces:
- query_analysis_node (query analysis done inline)
- document_retrieval_node (agent calls retrieve_documents tool)
- chunk_retrieval_node (agent calls retrieve_chunks tool)

The agent autonomously decides:
- When to search for documents
- When to search for chunks within documents
- When to retry with rewritten queries (semantic retries)
- When to generate final answer

CRITICAL: This node does NOT manually extract tool results.
It lets LangGraph handle ToolMessages naturally in the message history.
The LLM sees tool results and decides what to do next.
"""

import logging
from typing import Optional
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from backend.llm.config import config
from backend.llm.types import MainWorkflowState
from backend.llm.prompts import _get_main_answer_tagging_rule
from backend.llm.utils.system_prompts import get_system_prompt
from backend.llm.tools.document_retriever_tool import create_document_retrieval_tool
from backend.llm.tools.planning_tool import plan_step
from backend.llm.tools.citation_mapping import create_chunk_citation_tool

logger = logging.getLogger(__name__)

# Cache for document filenames to avoid repeated database queries
_filename_cache: dict[str, str] = {}

def extract_chunk_text_only(messages: list) -> str:
    """
    Extract ONLY chunk text from ToolMessages, stripping all metadata.
    
    Returns: Concatenated chunk text (no filenames, IDs, scores, or structure)
    """
    chunk_texts = []
    
    for msg in messages:
        if hasattr(msg, 'type') and msg.type == 'tool':
            tool_name = getattr(msg, 'name', '')
            
            # Handle retrieve_chunks tool
            if tool_name == 'retrieve_chunks':
                try:
                    import json
                    content = json.loads(msg.content) if isinstance(msg.content, str) else msg.content
                    if isinstance(content, list):
                        for chunk in content:
                            if isinstance(chunk, dict):
                                # Extract ONLY the text content
                                chunk_text = chunk.get('chunk_text') or chunk.get('chunk_text_clean', '')
                                if chunk_text:
                                    chunk_texts.append(chunk_text.strip())
                except (json.JSONDecodeError, AttributeError, TypeError):
                    pass
    
    # Join chunks with simple separator (no metadata)
    return "\n\n---\n\n".join(chunk_texts)


def get_document_filename(doc_id: str) -> str:
    """
    Fetch original_filename from documents table with caching.
    
    Uses an in-memory cache to avoid repeated database queries for the same document.
    
    Args:
        doc_id: Document ID to look up
        
    Returns:
        Original filename or 'document.pdf' as fallback
    """
    if not doc_id:
        return 'document.pdf'
    
    # Check cache first
    if doc_id in _filename_cache:
        return _filename_cache[doc_id]
    
    try:
        from backend.services.supabase_client_factory import get_supabase_client
        supabase = get_supabase_client()
        result = supabase.table('documents')\
            .select('original_filename')\
            .eq('id', doc_id)\
            .limit(1)\
            .execute()
        
        if result.data and len(result.data) > 0:
            filename = result.data[0].get('original_filename')
            if filename:
                # Cache the result
                _filename_cache[doc_id] = filename
                return filename
    except Exception as e:
        logger.warning(f"[AGENT_NODE] Failed to fetch filename for doc_id {doc_id[:8]}...: {e}")
    
    # Cache fallback value to avoid repeated failed queries
    fallback = 'document.pdf'
    _filename_cache[doc_id] = fallback
    return fallback


def extract_chunk_citations_from_messages(messages: list) -> list:
    """
    Extract chunk citations from match_citation_to_chunk tool calls in message history.
    
    Looks for ToolMessages from match_citation_to_chunk tool and extracts citation data.
    Includes original_filename by fetching from database.
    
    Returns:
        List of Citation dictionaries with chunk_id-based citation data
    """
    from backend.llm.types import Citation
    
    citations = []
    
    for msg in messages:
        if hasattr(msg, 'type') and msg.type == 'tool':
            if hasattr(msg, 'name') and msg.name == 'match_citation_to_chunk':
                try:
                    import json
                    content = json.loads(msg.content) if isinstance(msg.content, str) else msg.content
                    if isinstance(content, dict):
                        doc_id = content.get('document_id', '')
                        
                        # Fetch original_filename from database
                        original_filename = get_document_filename(doc_id)
                        
                        # Convert tool result to Citation format
                        citation: Citation = {
                            'citation_number': len(citations) + 1,  # Sequential numbering
                            'block_id': None,  # Not used for chunk-id-lookup
                            'chunk_id': content.get('chunk_id'),
                            'block_index': content.get('block_id'),  # Index in blocks array
                            'cited_text': content.get('cited_text', ''),
                            'bbox': content.get('bbox'),
                            'page_number': content.get('page', 0),
                            'doc_id': doc_id,
                            'original_filename': original_filename,  # NEW: Include filename
                            'confidence': content.get('confidence', 'low'),
                            'method': content.get('method', 'chunk-id-lookup'),
                            'block_content': None,
                            'verification': None,
                            'matched_block_content': content.get('matched_block_content')
                        }
                        citations.append(citation)
                        logger.info(
                            f"[AGENT_NODE] Extracted chunk citation: chunk_id={content.get('chunk_id', '')[:20]}..., "
                            f"page={content.get('page', 0)}, confidence={content.get('confidence', 'low')}, "
                            f"filename={original_filename}"
                        )
                except (json.JSONDecodeError, AttributeError, TypeError) as e:
                    logger.warning(f"[AGENT_NODE] Failed to extract chunk citation from tool message: {e}")
                    pass
    
    return citations

async def generate_conversational_answer(user_query: str, chunk_text: str) -> str:
    """
    Generate conversational, intent-aware answer from chunk text only.
    
    This function:
    - Receives ONLY chunk text (no metadata, filenames, IDs)
    - Uses intent-aware answer contract
    - Returns conversational, helpful answer
    - NEVER mentions metadata, filenames, or retrieval steps
    """
    # INTENT-AWARE ANSWER CONTRACT (Production-Grade)
    main_tagging_rule = _get_main_answer_tagging_rule()
    system_prompt = SystemMessage(content=f"""
You are an expert analytical assistant for professional documents. Your role is to help users understand information clearly, accurately, and neutrally based solely on the content provided.

# FORMATTING RULES

1. **Response Style**: Use clean Markdown. Use bolding for key terms and bullet points for lists to ensure scannability.

2. **List Formatting**: When creating numbered lists (1., 2., 3.) or bullet lists (-, -, -), keep all items on consecutive lines without blank lines between them. Blank lines between list items will break the list into separate lists.

   **CORRECT:**
   ```
   1. First item
   2. Second item
   3. Third item
   ```

   **WRONG:**
   ```
   1. First item

   2. Second item

   3. Third item
   ```

3. **Markdown Features**: 
   - Use `##` for main sections, `###` for subsections
   - Use `**bold**` for emphasis or labels
   - Use `-` for bullet points, `1.` for numbered lists
   - Use blank lines between sections (not between list items)

4. **No Hallucination**: If the answer is not contained within the provided excerpts, state: "I cannot find the specific information in the uploaded documents." Do not use outside knowledge.

# TONE & STYLE

- Be direct and professional.
- Avoid phrases like "Based on the documents provided..." or "According to chunk 1...". Just provide the answer.
- Do not mention document names, filenames, IDs, or retrieval steps.
- Do not reference "documents", "files", "chunks", "tools", or "searches".
- Speak as if the information is simply *known*, not retrieved.
- **MAIN ANSWER TAGGING (required)** –
{main_tagging_rule}

# EXTRACTING INFORMATION

The excerpts provided ARE the source of truth. When the user asks a question:
1. Carefully read through ALL the excerpts provided
2. If the answer IS present, extract and present it directly – put the key figure or fact in the opening words
3. If the answer is NOT present, only then say it's not found

**DO NOT say "the excerpts do not contain" if the information IS actually in the excerpts.**
**DO NOT be overly cautious - if you see the information, extract and present it.**

When information IS in the excerpts:
- Put the key figure or fact first (amount, number, date), then add what it refers to
- Extract specific details (names, values, dates, etc.)
- Present them clearly and directly
- Use the exact information from the excerpts
- Format it in a scannable way

When information is NOT in the excerpts:
- State: "I cannot find the specific information in the uploaded documents."
- Provide helpful context about what type of information would answer the question
""")
    
    user_prompt = f"""User question: {user_query}

Relevant document excerpts:

{chunk_text[:8000]}

⚠️ IMPORTANT: Read the excerpts carefully. If the answer to the user's question is present in the excerpts above, extract and present it directly. Do NOT say the information is not found if it is actually in the excerpts.

Provide a helpful, conversational answer using Markdown formatting:
- Use `##` for main section headings, `###` for subsections
- Use `**bold**` for emphasis or labels
- Use `-` for bullet points when listing items
- Use line breaks between sections for better readability
- **Extract and present information directly from the excerpts if it is present**
- Only say information is not found if it is genuinely not in the excerpts
- Includes appropriate context based on question type
- Is professional and polite
- Never mentions documents, files, or retrieval steps

Answer (use Markdown formatting for structure and clarity):"""

    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0.3,  # Slightly higher for more natural responses
    )
    
    try:
        response = await llm.ainvoke([system_prompt, HumanMessage(content=user_prompt)])
        return response.content.strip()
    except Exception as e:
        logger.error(f"[AGENT_NODE] Error generating conversational answer: {e}")
        return "I encountered an error while generating the answer."


async def agent_node(state: MainWorkflowState, runnable_config=None) -> MainWorkflowState:
    """
    Unified agent - lets LLM see and react to tool results naturally.
    
    The agent feedback loop:
    1. Agent sees query (or previous conversation)
    2. Agent decides strategy and calls tools
    3. Agent sees ToolMessages with results
    4. Agent evaluates quality and decides to retry or answer
    
    Args:
        state: MainWorkflowState with user_query, messages, etc.
        runnable_config: Optional RunnableConfig from LangGraph
        
    Returns:
        Updated state with messages
    """
    user_query = state.get("user_query", "")
    is_agent_mode = state.get("is_agent_mode", False)
    messages = state.get("messages", [])
    
    logger.info(f"[AGENT_NODE] Processing query: '{user_query[:80]}...'")
    logger.info(f"[AGENT_NODE] Current message count: {len(messages)}")
    
    # Deduplicate messages (safety net against double invocation)
    if messages and len(messages) > 1:
        seen = set()
        deduped = []
        for msg in messages:
            # Create fingerprint: class name + content hash
            if hasattr(msg, 'content') and msg.content:
                # Hash content to avoid comparing large strings
                content_hash = hash(str(msg.content)[:200])
                fingerprint = f"{msg.__class__.__name__}:{content_hash}"
            elif hasattr(msg, 'tool_calls') and msg.tool_calls:
                # For tool calls, hash the tool call IDs
                tool_calls_str = str([tc.get('id', '') for tc in msg.tool_calls])
                fingerprint = f"{msg.__class__.__name__}:tools:{hash(tool_calls_str)}"
            else:
                # Use object id as fallback
                fingerprint = f"{msg.__class__.__name__}:{id(msg)}"
            
            if fingerprint not in seen:
                seen.add(fingerprint)
                deduped.append(msg)
        
        if len(deduped) < len(messages):
            logger.warning(
                f"[AGENT_NODE] ⚠️  Removed {len(messages) - len(deduped)} duplicate messages! "
                f"({len(messages)} → {len(deduped)})"
            )
            messages = deduped
    
    # NEW: Log message count and estimate token usage for summarization tracking
    if messages:
        logger.info(f"[AGENT_NODE] Message history: {len(messages)} messages")
        
        # Estimate token count (rough approximation: 1 token ≈ 4 characters)
        estimated_tokens = sum(len(str(msg.content)) // 4 if hasattr(msg, 'content') else 0 for msg in messages)
        logger.info(f"[AGENT_NODE] Estimated tokens: ~{estimated_tokens:,}")
        
        if estimated_tokens > 8000:
            logger.warning(
                f"⚠️  [AGENT_NODE] Token count ({estimated_tokens:,}) exceeds 8k threshold! "
                "Summarization middleware should trigger on this turn."
            )
        elif estimated_tokens > 6000:
            logger.info(
                f"🔔 [AGENT_NODE] Token count ({estimated_tokens:,}) approaching 8k limit "
                f"({int((estimated_tokens/8000)*100)}% of threshold)"
            )
    
    # NEW: Emit task header (high-level phase marker) on first call
    emitter = state.get("execution_events")
    if emitter and not messages:
        from backend.llm.utils.execution_events import ExecutionEvent
        task_header = ExecutionEvent(
            type="phase",
            description=f"Analyzing: {user_query[:80]}{'...' if len(user_query) > 80 else ''}"
        )
        emitter.emit(task_header)
    
    # First call: Initialize conversation with system prompt + user query
    if not messages:
        system_prompt = get_system_prompt('analyze')
        
        initial_prompt = f"""USER QUERY: {user_query}

🔍 **CRITICAL TWO-STEP RETRIEVAL PROCESS**:

**STEP 1: Find Relevant Documents (INTERNAL ONLY - DO NOT SHOW TO USER)**
→ Call: retrieve_documents(query="...", query_type="broad"/"specific")
→ This returns document metadata (filename, ID, score, summary) to help you identify relevant documents
→ **⚠️ CRITICAL**: This metadata is FOR YOUR INTERNAL USE ONLY - DO NOT include it in your response to the user
→ Document metadata is like a library catalog - it helps you find the book, but it's not the book content itself

**STEP 2: Read the Actual Content (USE THIS TO ANSWER USER)**
→ Call: retrieve_chunks(document_ids=[...], query="...")
→ This retrieves the ACTUAL TEXT from inside the documents
→ **ANSWER THE USER BASED ON CHUNK CONTENT ONLY**

**🚫 PROHIBITED ACTIONS**:
❌ DO NOT show document metadata (IDs, filenames, scores, summaries) to the user
❌ DO NOT say "I found a document called X with ID Y"
❌ DO NOT say "Here are the documents related to..." followed by metadata
❌ DO NOT answer using only document metadata/summary
❌ DO NOT skip retrieve_chunks - always get actual content

**✅ CORRECT RESPONSE PATTERNS**:

Example 1 (Specific Question):
User: "What is the value of the offer from Chandni?"
You (internally): Call retrieve_documents → Found Letter_of_Offer_Chandni_Solenki.docx
You (internally): Call retrieve_chunks → Got actual text with value
You (to user): "The offer value is KSh 117,000,000. This represents the sale price for 3 plots at 90 Banda Lane, Nairobi. Would you like more details about the payment terms or other conditions?"
  ↑ Conversational answer with context, NO metadata shown

Example 2 (Broad Question):
User: "Tell me about the offer from Chandni"
You (internally): Call retrieve_documents → Found document
You (internally): Call retrieve_chunks → Got full offer details
You (to user): "The offer is for the sale of 3 plots at 90 Banda Lane, Nairobi. Key details: [extracted info from chunks]"
  ↑ Comprehensive answer from chunks, NO metadata shown

**❌ INCORRECT RESPONSE PATTERN (NEVER DO THIS)**:
User: "What is the value of the offer?"
You: "The document related to the offer from Chandni is titled 'Letter_of_Offer_Chandni_Solenki_on_Banda_Lane.docx'. Here are the details:
- Document ID: 53a9450a-8b4c-4068-a416-e62e5d328104
- Filename: Letter_of_Offer_Chandni_Solenki_on_Banda_Lane.docx
- Score: 0.4404
- Summary: [...]"
  ↑ WRONG - This shows metadata that should be internal only

**WHEN YOU CAN MENTION DOCUMENTS** (Only these specific cases):
- User explicitly asks: "What documents do you have?"
- User explicitly asks: "Which document contains X?"
- User explicitly asks: "List the documents about Y"
→ In these cases, you can list document names (but still no IDs or scores)

**REQUIRED WORKFLOW**:
1. Call retrieve_documents (results are INTERNAL - don't show to user)
2. Call retrieve_chunks (use this content to answer)
3. **CITATION WORKFLOW - IMMEDIATELY after receiving chunks:**
   - Analyze each chunk to identify relevant information
   - For each relevant fact, IMMEDIATELY call match_citation_to_chunk:
     * chunk_id: The chunk's ID from the retrieve_chunks result
     * cited_text: The EXACT text from chunk_text (not a paraphrase)
   - Collect all citation results
   - This ensures accurate citation mapping before generating your answer
4. Provide answer based ONLY on chunk content
5. Do NOT preface your answer with document metadata

**CRITICAL - EXTRACTING ANSWERS FROM CHUNKS**:
- When you retrieve chunks, extract the answer from the chunk text and provide it with appropriate context
- Be conversational, professional, and helpful - adapt your response length to the question type
- For factual questions: Provide direct answer with brief, natural context
- For broad questions: Provide comprehensive answer with reasoning and considerations
- If chunks contain the answer, provide it with appropriate explanation based on question intent
- If chunks don't contain the answer, clearly explain what information is missing

**MANDATORY**: After retrieving chunks, you MUST:
1. Read the chunk text carefully
2. **IMMEDIATELY call match_citation_to_chunk for each relevant fact:**
   - Use the original chunk text (from chunk_text), not a paraphrase
   - Call the tool right after receiving chunks, before generating your answer
   - This captures citations at the point of analysis for maximum accuracy
3. Identify the question type (factual lookup, definition, explanation, analysis, exploration)
4. Provide a conversational answer that directly addresses the question with appropriate context
5. Be natural and helpful - include brief context or follow-up questions when they add value

**Evaluate Quality**:
- If documents list is empty, retry retrieve_documents with rewritten query
- If chunks list is empty or poor, retry retrieve_chunks with different/broader query
- If chunks are good, answer directly from chunk content (no metadata)

**OPTIONAL PLANNING**:
You can use the plan_step tool to share your intent before taking action.
This helps the user understand what you're doing and why.

Example:
- plan_step(
    intent="I'm going to search for documents related to the property valuation to find the specific figures you requested.",
    next_action="Search valuation-related documents"
  )

Use plan_step when it adds clarity, but don't overuse it. 
Focus on WHAT you're doing and WHY it matters, not HOW you're thinking.

Think step-by-step. You control the entire retrieval process."""
        
        messages = [
            system_prompt,
            HumanMessage(content=initial_prompt)
        ]
        
        logger.info("[AGENT_NODE] Initialized conversation with system prompt + user query")
    else:
        # Log message history for debugging
        logger.info("[AGENT_NODE] Message history:")
        for i, msg in enumerate(messages):
            msg_type = type(msg).__name__
            content_preview = ""
            if hasattr(msg, 'content') and msg.content:
                content_preview = str(msg.content)[:100]
            elif hasattr(msg, 'tool_calls') and msg.tool_calls:
                content_preview = f"{len(msg.tool_calls)} tool call(s)"
            
            logger.info(f"  [{i}] {msg_type}: {content_preview}")
    
    # Build tools list - include plan_step for visible intent sharing
    retrieval_tools = [
        create_document_retrieval_tool(),
        # Note: Using simple retrieve_chunks tool instead of document_explorer
    ]
    
    # Add citation tool for chunk-based citations
    citation_tool = create_chunk_citation_tool()
    
    # Add plan_step as the first tool (optional, agent decides when to use it)
    all_tools = [plan_step] + list(retrieval_tools) + [citation_tool]
    logger.info(f"[AGENT_NODE] Agent has {len(all_tools)} tools available (including plan_step and chunk citation tool)")
    
    # Create LLM with tools bound
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    ).bind_tools(all_tools, tool_choice="auto")
    
    logger.info("[AGENT_NODE] Invoking LLM with full message history...")
    
    try:
        # Invoke LLM with full message history
        # LLM sees: SystemMessage, HumanMessage, AIMessage (with tool_calls), ToolMessage, ...
        # LangGraph's ToolNode automatically adds ToolMessages to the conversation
        response = await llm.ainvoke(messages)
        
        # Check if agent made tool calls
        if hasattr(response, 'tool_calls') and response.tool_calls:
            logger.info(f"[AGENT_NODE] ✅ Agent made {len(response.tool_calls)} tool call(s):")
            for i, tool_call in enumerate(response.tool_calls):
                tool_name = tool_call.get('name', 'unknown')
                tool_args = str(tool_call.get('args', {}))[:100]
                logger.info(f"  [{i}] {tool_name}({tool_args}...)")
            
            # Return updated messages - ToolNode will execute tools and add ToolMessages
            return {"messages": [response]}
        
        # No tool calls - agent generated final answer or is done
        logger.info("[AGENT_NODE] ℹ️  Agent generated response (no tool calls)")
        
        # Extract chunk citations from message history
        chunk_citations = extract_chunk_citations_from_messages(messages)
        if chunk_citations:
            logger.info(f"[AGENT_NODE] ✅ Extracted {len(chunk_citations)} chunk citations from message history")
        
        # Check if chunks were retrieved - if yes, use conversational answer generation (no metadata visible)
        chunk_text = extract_chunk_text_only(messages)
        has_chunks = bool(chunk_text.strip())
        
        if has_chunks:
            # Chunks exist - use conversational answer generation (metadata hidden from answer LLM)
            logger.info("[AGENT_NODE] ✅ Chunks detected - using conversational answer generation (metadata hidden)")
            user_query = state.get("user_query", "")
            conversational_answer = await generate_conversational_answer(user_query, chunk_text)
            
            # Create clean AIMessage with conversational answer
            from langchain_core.messages import AIMessage
            clean_response = AIMessage(content=conversational_answer)
            
            logger.info(f"[AGENT_NODE] Conversational answer generated ({len(conversational_answer)} chars): {conversational_answer[:100]}...")
            
            # Return response with chunk citations if any
            result = {"messages": [clean_response]}
            if chunk_citations:
                result["chunk_citations"] = chunk_citations
            return result
        else:
            # No chunks - use agent's original response (for non-document questions)
            logger.info("[AGENT_NODE] No chunks detected - using agent's original response")
            if hasattr(response, 'content') and response.content:
                logger.info(f"[AGENT_NODE] Response preview: {str(response.content)[:200]}...")
            
            # Return response with chunk citations if any
            result = {"messages": [response]}
            if chunk_citations:
                result["chunk_citations"] = chunk_citations
            return result
        
    except Exception as e:
        logger.error(f"[AGENT_NODE] ❌ Error: {e}", exc_info=True)
        return {
            "messages": messages,
            "final_summary": f"I encountered an error while processing your query: {str(e)}"
        }

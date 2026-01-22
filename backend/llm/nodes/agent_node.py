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
from backend.llm.utils.system_prompts import get_system_prompt
from backend.llm.tools.document_retriever_tool import create_document_retrieval_tool
from backend.llm.tools.chunk_retriever_tool import create_chunk_retrieval_tool

logger = logging.getLogger(__name__)

def extract_chunk_text_only(messages: list) -> str:
    """
    Extract ONLY chunk text from ToolMessages, stripping all metadata.
    
    Returns: Concatenated chunk text (no filenames, IDs, scores, or structure)
    """
    chunk_texts = []
    
    for msg in messages:
        if hasattr(msg, 'type') and msg.type == 'tool':
            if hasattr(msg, 'name') and msg.name == 'retrieve_chunks':
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
    system_prompt = SystemMessage(content="""
You are an expert analytical assistant for professional documents.

Your role is to help the user understand information clearly, accurately, and neutrally, based solely on the content provided — without favoring any specific document, interpretation, or outcome.

You are not an advocate. You are an explainer and analyst.

You will be given:
- A user question
- Relevant excerpts from documents (content only — no filenames, IDs, scores, or retrieval context)

Your task is to reason over the provided information and respond in a way that best matches the user’s intent.

────────────────────────────
1. IDENTIFY QUESTION INTENT
────────────────────────────

First, determine the type of question being asked:

- **Factual lookup**  
  (e.g., values, dates, names, figures)

- **Definition**  
  (e.g., “What is…”, “Define…”)

- **Explanation**  
  (e.g., “How does this work?”, “Why does this matter?”)

- **Analysis / Evaluation**  
  (e.g., risks, implications, trade-offs, consequences)

- **Broad exploration / Summary**  
  (e.g., overviews, thematic questions, open-ended prompts)

────────────────────────────
2. RESPONSE STRATEGY & FORMATTING (FLEXIBLE)
────────────────────────────

You decide the appropriate structure and formatting based on the question type and content.

**FACTUAL LOOKUP**:

Choose a structure that makes the answer scannable:
- Consider using labels for values
- Consider line breaks between answer and context
- Consider brief context when helpful
- Keep it concise but not abrupt

Example approaches (you choose what fits):
- Labeled value with brief context
- Direct answer with explanatory sentence
- Structured breakdown if multiple related facts

**DEFINITION**:

Provide clear definition with appropriate context:
- Consider sectioned explanation if complex
- Consider bullet points for key characteristics
- Consider implications if relevant

**EXPLANATION**:

Use structured reasoning:
- Consider sectioned breakdown
- Consider bullet points for steps or factors
- Consider short paragraphs for flow

**ANALYSIS / EVALUATION**:

Present balanced considerations:
- Consider sectioned analysis
- Consider bullet points for key points
- Consider structured implications
- Avoid walls of text

**BROAD EXPLORATION**:

Provide organized overview:
- Consider sectioned narrative
- Consider bullet points for key ideas
- Consider structured considerations
- Keep paragraphs short (max 2-3 lines)

────────────────────────────
3. FORMATTING PRINCIPLES
────────────────────────────

Use formatting tools as appropriate:
- **Labels** for factual answers
- **Line breaks** between logical sections
- **Bullet points** when listing details
- **Bold headers** when presenting structured information
- **Short paragraphs** (max 2-3 lines each)

The goal is scannability and clarity, not rigid templates.

────────────────────────────
4. MARKDOWN FORMATTING (ENCOURAGED)
────────────────────────────

Your responses will be rendered as Markdown in the frontend. Use Markdown formatting to create structured, scannable responses.

Available Markdown features:
- **Headings**: Use `##` for main sections, `###` for subsections
- **Bold text**: Use `**text**` for emphasis or labels
- **Lists**: Use `-` for bullet points, `1.` for numbered lists
- **Line breaks**: Use blank lines between sections for better readability
- **Horizontal rules**: Use `---` to separate major sections (optional)

Examples of good markdown usage:

**Factual Question:**
```
## Offer Value

- **Amount:** [currency] [price]

**Context**

This is the proposed purchase price for [property description] located at [property address].
```

**Analysis Question:**
```
## Key Considerations

- [Consideration 1]
- [Consideration 2]
- [Consideration 3]

## Implications

[Brief analysis of implications]
```

**Structured Breakdown:**
```
## Payment Terms

### Deposit
- **Amount:** [currency] [amount]
- **Due Date:** [date]

### Balance
- **Amount:** [currency] [amount]
- **Due Date:** [date]
```

Choose markdown formatting that best serves the question type and content. Use headings to create clear hierarchy, bullet points for lists, and bold text for emphasis.

────────────────────────────
5. FOLLOW-UP GUIDANCE
────────────────────────────

Follow-up prompts are OPTIONAL.

Only include them when they clearly add value.

Prefer a soft closing statement over a direct question.

Examples:
✅ Good: "If you'd like, I can also summarise the payment terms or any conditions attached to the offer."
❌ Bad: "Would you like more details?" (appears on every answer)

────────────────────────────
6. NEUTRALITY & BIAS SAFEGUARDS
────────────────────────────

You MUST:
- Base statements strictly on the provided content
- Avoid assuming intent, preference, or outcome
- Avoid favoring one document, party, or interpretation unless explicitly supported
- Clearly signal when information is partial, conditional, or context-dependent

You MUST NOT:
- Invent facts or fill gaps with assumptions
- Treat examples as real-world data
- Imply endorsement, advice, or decision-making unless asked

────────────────────────────
7. CRITICAL CONSTRAINTS (NON-NEGOTIABLE)
────────────────────────────

- Do NOT mention document names, filenames, IDs, or retrieval steps
- Do NOT reference “documents”, “files”, “chunks”, “tools”, or “searches”
- Do NOT expose metadata (IDs, scores, filenames, system behavior)
- Do NOT quote long passages verbatim
- Do NOT say “according to the document” or similar phrasing

You should speak as if the information is simply *known*, not retrieved.

────────────────────────────
8. FINAL CHECK BEFORE RESPONDING
────────────────────────────

Before sending your response, verify:

- Is the answer scannable in under 5 seconds?
- Can the key information be identified without reading the full response?
- Is the structure appropriate for the question type?
- Are there any paragraphs longer than 3 lines that could be broken up?
- Does the formatting help or hinder understanding?

If the answer is not scannable or clear, restructure it using appropriate formatting tools (labels, breaks, bullets, headers).

────────────────────────────
9. EXAMPLES (ILLUSTRATIVE ONLY — NOT REAL DATA)
────────────────────────────

⚠️ All examples below are hypothetical.  
⚠️ Any addresses, figures, names, or values are placeholders only.

**Factual Lookup - Example 1 (Markdown Structure)**

User: "What is the value of the offer?"

Good:
## Offer Value

- **Amount:** [currency] [price]

**Context**

This is the proposed purchase price for [property description] located at [property address].

If you'd like, I can also summarise the payment terms or any conditions attached to the offer.

**Factual Lookup - Example 2 (Direct with Context)**

User: "Who signed the agreement?"

Good:
The agreement was signed by [party name 1] and [party name 2].

This represents the [vendor/purchaser] parties for the transaction involving [property description].

**Definition**

User: "What is market value?"

Good:
## Market Value

- **Definition:** [definition text]

**Context**

In professional practice, this typically relies on comparable sales and normal market conditions.

Bad:
"Market value is [definition]."  
(Insufficient context, no structure)

**Analysis**

User: "What are the risks of accepting this offer?"

Good:
## Key Considerations

- [Consideration 1]
- [Consideration 2]
- [Consideration 3]

## Implications

[Brief analysis of implications]

Bad:
"The risks are [risk 1], [risk 2], and [risk 3]."  
(Mechanical, no structure, wall of text)

Bad:
"The value of the offer from [party name] is [currency] [price]. This represents the sale price for [property description] at [property address]. Would you like more details about the payment terms or other conditions?"
(Wall of text, not scannable)

────────────────────────────
REMEMBER
────────────────────────────

You are reasoning *with evidence*, not merely repeating it.

Your goal is to help the user understand — clearly, neutrally, and intelligently — while keeping the interaction natural and professional.""")
    
    user_prompt = f"""User question: {user_query}

Relevant document excerpts:

{chunk_text[:8000]}

Provide a helpful, conversational answer using Markdown formatting:
- Use `##` for main section headings, `###` for subsections
- Use `**bold**` for emphasis or labels
- Use `-` for bullet points when listing items
- Use line breaks between sections for better readability
- Directly answers the question
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
3. Provide answer based ONLY on chunk content
4. Do NOT preface your answer with document metadata

**CRITICAL - EXTRACTING ANSWERS FROM CHUNKS**:
- When you retrieve chunks, extract the answer from the chunk text and provide it with appropriate context
- Be conversational, professional, and helpful - adapt your response length to the question type
- For factual questions: Provide direct answer with brief, natural context
- For broad questions: Provide comprehensive answer with reasoning and considerations
- If chunks contain the answer, provide it with appropriate explanation based on question intent
- If chunks don't contain the answer, clearly explain what information is missing

**MANDATORY**: After retrieving chunks, you MUST:
1. Read the chunk text carefully
2. Identify the question type (factual lookup, definition, explanation, analysis, exploration)
3. Provide a conversational answer that directly addresses the question with appropriate context
4. Be natural and helpful - include brief context or follow-up questions when they add value

**Evaluate Quality**:
- If documents list is empty, retry retrieve_documents with rewritten query
- If chunks list is empty or poor, retry retrieve_chunks with different/broader query
- If chunks are good, answer directly from chunk content (no metadata)

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
    
    # Build tools list - only retrieval tools for now
    # TODO: Add citation and agent action tools back when properly integrated with ToolNode
    retrieval_tools = [
        create_document_retrieval_tool(),
        create_chunk_retrieval_tool(),
    ]
    
    all_tools = list(retrieval_tools)
    logger.info(f"[AGENT_NODE] Agent has {len(all_tools)} tools available")
    
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
            return {"messages": [clean_response]}
        else:
            # No chunks - use agent's original response (for non-document questions)
            logger.info("[AGENT_NODE] No chunks detected - using agent's original response")
            if hasattr(response, 'content') and response.content:
                logger.info(f"[AGENT_NODE] Response preview: {str(response.content)[:200]}...")
            return {"messages": [response]}
        
    except Exception as e:
        logger.error(f"[AGENT_NODE] ❌ Error: {e}", exc_info=True)
        return {
            "messages": messages,
            "final_summary": f"I encountered an error while processing your query: {str(e)}"
        }

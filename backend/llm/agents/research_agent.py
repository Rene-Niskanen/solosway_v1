"""
Research Agent - Model-driven document research with tool calling.

This agent allows the LLM to autonomously decide how to gather information
by calling tools (search_documents, read_document) in a loop until it has
enough context to answer the user's query.

Key behaviors:
- Model decides which tools to call and in what order
- Model can refine searches based on results
- Model can read multiple documents if needed
- Model generates final answer with citations when ready
"""

import asyncio
import json
import logging
import time
from datetime import datetime
from typing import Callable, Optional, Dict, Any, List, Awaitable

from langchain_core.messages import (
    HumanMessage, 
    AIMessage, 
    ToolMessage, 
    SystemMessage,
    BaseMessage
)

from backend.llm.config import config
from backend.llm.utils.model_factory import get_llm
from backend.llm.tools.retrieval_tools import (
    create_retrieval_tools, 
    RetrievalToolContext
)

logger = logging.getLogger(__name__)


# =============================================================================
# Agent Configuration - Uses config.py settings
# =============================================================================

def get_agent_config() -> dict:
    """Get agent configuration from config.py settings."""
    return {
        "max_iterations": config.research_agent_max_iterations,
        "timeout_seconds": config.research_agent_timeout_seconds,
        "tool_timeout_seconds": 30,     # Per-tool timeout (fixed)
        "fallback_on_error": True,      # Fall back to fixed pipeline on error
    }

# Default config for module-level access
AGENT_CONFIG = get_agent_config()


# =============================================================================
# Exceptions
# =============================================================================

class ResearchAgentError(Exception):
    """Base exception for research agent errors."""
    pass


class RateLimitError(ResearchAgentError):
    """Rate limit hit during agent execution."""
    pass


class MaxIterationsError(ResearchAgentError):
    """Agent exceeded maximum iterations without completing."""
    pass


class AgentTimeoutError(ResearchAgentError):
    """Agent timed out."""
    pass


class QuotaExhaustedError(ResearchAgentError):
    """API quota exhausted - need to add credits or switch provider."""
    pass


# =============================================================================
# Agent System Prompt
# =============================================================================

def get_research_agent_prompt() -> str:
    """Get the system prompt for the research agent."""
    return """You are a research agent that helps users find information in their documents.

## Available Tools

1. **search_documents(query, max_results=10)**
   - Search for documents matching a query
   - Returns: list of documents with doc_id, filename, relevance_score, snippet
   - Use this FIRST to find relevant documents

2. **read_document(doc_id, focus_query=None)**
   - Read a specific document to get its full content
   - Returns: document content with BLOCK_CITE_IDs for citations
   - Use this AFTER search to get details from promising documents

3. **read_multiple_documents(doc_ids, focus_query=None)**
   - Read up to 5 documents at once
   - Use for comparing information across documents

## Strategy

1. **Start with search** - Always search first to find relevant documents
2. **Read selectively** - Only read documents that look relevant from search results
3. **Refine if needed** - If search returns no results or poor results, try different terms
4. **Stop when ready** - Once you have enough information, generate your answer

## Citation Rules

When you generate your final answer:
- Use [N] markers to cite sources (e.g., "The value is £2,300,000[1]")
- Reference BLOCK_CITE_IDs from document content for accurate citations
- Every factual claim must have a citation

## Examples

**Simple query:** "What is the property value?"
1. search_documents("property value valuation") → Found 1 doc
2. read_document(doc_id) → Got valuation content
3. Generate answer with citations

**No results:** "Tell me about the roof"
1. search_documents("roof") → Found 0 docs
2. search_documents("building survey condition") → Found 1 doc
3. read_document(doc_id) → Got building survey
4. Generate answer about roof section

**Complex query:** "Compare 2023 and 2024 valuations"
1. search_documents("2023 valuation") → Found docs
2. read_document(doc_id_1) → Got 2023 data
3. search_documents("2024 valuation") → Found docs
4. read_document(doc_id_2) → Got 2024 data
5. Generate comparison answer

## Important Notes

- Be efficient: don't read documents that aren't relevant
- Be thorough: if the user asks for specific information, make sure you find it
- If you can't find the information after reasonable searching, say so clearly
- Always cite your sources with [N] markers

## EXECUTION STATE MACHINE (ENFORCED BY SYSTEM)

Your execution follows a strict state machine. The system ENFORCES these rules.

### State Flow

```
START (No documents available) 
    │
    ▼ MUST call search_documents first
SEARCH COMPLETED (Documents now available with doc_ids)
    │
    ▼ CAN NOW call read_document with valid doc_ids
DOCUMENT READ (Have content, can answer OR search again)
    │
    ▼ Generate final answer when ready
COMPLETE (Answer generated with citations)
```

### PREREQUISITE RULES (SYSTEM-ENFORCED)

These rules are ENFORCED by the system. Violations return errors, NOT results.

| Tool | Prerequisites | Violation Result |
|------|---------------|------------------|
| search_documents | None | N/A (always allowed) |
| read_document | doc_id from search results | PREREQUISITE_ERROR |
| read_multiple_documents | ALL doc_ids from search results | PREREQUISITE_ERROR |

### BEFORE EACH TOOL CALL - CHECKLIST

Before calling read_document or read_multiple_documents, verify:
□ Have I called search_documents?
□ Did search return the doc_id I want to use?
□ Is the doc_id EXACTLY as returned (including full UUID)?

If ANY answer is NO → call search_documents first.

### ON ERROR RECOVERY

- PREREQUISITE_ERROR: You tried to read a document not in your search results.
  → Call search_documents with appropriate terms, THEN read.
  
- Search returns 0 results: Try different/broader search terms.
  → Example: "property value" instead of "market value assessment"
  
- Read fails after successful search: Document may have no content.
  → Try a different document from search results.

Now help with the user's query."""


# =============================================================================
# Plan Generation
# =============================================================================

def get_plan_generation_prompt(query: str) -> str:
    """Get the prompt for generating a research plan."""
    return f"""Create a research plan for the following query. Be specific about what you will search for and why.

Query: {query}

## Research Plan

### Objective
[What specific information we need to find to answer this query]

### Strategy
1. **Initial Search**: [What search terms to use and why]
2. **Document Analysis**: [What to look for in the documents]
3. **Synthesis**: [How to combine findings into a coherent answer]

### Expected Documents
[Types of documents that might contain this information, e.g., valuation reports, surveys, leases]

### Expected Outcome
[What the final answer will include: key data points, citations, confidence level]

Write a clear, concise plan that shows your research approach."""


async def generate_research_plan(
    state: dict,
    on_plan_chunk: Optional[Callable[[str], Awaitable[None]]] = None
) -> tuple[str, str]:
    """
    Generate a research plan and stream it chunk by chunk.
    
    Returns:
        tuple[str, str]: (plan_content, plan_id)
    """
    from uuid import uuid4
    
    user_query = state.get("user_query", "")
    model_preference = state.get("model_preference", "gpt-4o")
    
    logger.info(f"[RESEARCH_AGENT] Generating plan for query: '{user_query[:50]}...'")
    
    # Get LLM for plan generation
    llm = get_llm(model_preference, temperature=0.3)  # Slightly higher temp for creative planning
    
    # Build prompt
    prompt = get_plan_generation_prompt(user_query)
    messages = [
        SystemMessage(content="You are a research planning assistant. Create clear, actionable research plans."),
        HumanMessage(content=prompt)
    ]
    
    plan_content = ""
    plan_id = str(uuid4())
    
    try:
        # Stream the plan
        async for chunk in llm.astream(messages):
            if hasattr(chunk, 'content') and chunk.content:
                plan_content += chunk.content
                if on_plan_chunk:
                    await on_plan_chunk(chunk.content)
        
        logger.info(f"[RESEARCH_AGENT] Plan generated: {len(plan_content)} chars, id={plan_id[:8]}")
        return plan_content, plan_id
        
    except Exception as e:
        logger.error(f"[RESEARCH_AGENT] Plan generation failed: {e}")
        raise


def get_plan_update_prompt(existing_plan: str, update_instruction: str) -> str:
    """Get the prompt for updating an existing research plan."""
    return f"""Update the following research plan based on the user's instruction. 
Preserve unchanged sections as much as possible - only modify what needs to change.
Return the complete updated plan.

## Current Plan
{existing_plan}

## Update Instruction
{update_instruction}

## Guidelines
1. Integrate the user's feedback into the plan
2. Keep the same structure and format
3. Only change sections that need updating based on the instruction
4. Be specific about what changed

Return the complete updated plan with all sections (unchanged sections should be preserved exactly)."""


async def update_research_plan(
    state: dict,
    existing_plan: str,
    update_instruction: str,
    on_plan_chunk: Optional[Callable[[str], Awaitable[None]]] = None
) -> tuple[str, str]:
    """
    Update an existing research plan based on user feedback.
    Streams the updated plan chunk by chunk.
    
    Args:
        state: Workflow state containing model_preference
        existing_plan: The current plan content to update
        update_instruction: User's instruction for how to modify the plan
        on_plan_chunk: Optional callback for streaming chunks
    
    Returns:
        tuple[str, str]: (updated_plan_content, plan_id)
    """
    from uuid import uuid4
    
    model_preference = state.get("model_preference", "gpt-4o")
    
    logger.info(f"[RESEARCH_AGENT] Updating plan with instruction: '{update_instruction[:50]}...'")
    
    # Get LLM for plan update
    llm = get_llm(model_preference, temperature=0.3)
    
    # Build prompt
    prompt = get_plan_update_prompt(existing_plan, update_instruction)
    messages = [
        SystemMessage(content="You are a research planning assistant. Update the plan to incorporate the user's feedback while preserving unchanged sections."),
        HumanMessage(content=prompt)
    ]
    
    updated_plan = ""
    plan_id = str(uuid4())
    
    try:
        # Stream the updated plan
        async for chunk in llm.astream(messages):
            if hasattr(chunk, 'content') and chunk.content:
                updated_plan += chunk.content
                if on_plan_chunk:
                    await on_plan_chunk(chunk.content)
        
        logger.info(f"[RESEARCH_AGENT] Plan updated: {len(updated_plan)} chars, id={plan_id[:8]}")
        return updated_plan, plan_id
        
    except Exception as e:
        logger.error(f"[RESEARCH_AGENT] Plan update failed: {e}")
        raise


# =============================================================================
# Agent Loop
# =============================================================================

async def run_research_agent(
    state: dict,
    on_tool_call: Callable[[dict], Awaitable[None]],
    on_thinking: Optional[Callable[[str], Awaitable[None]]] = None,
    on_plan_chunk: Optional[Callable[[str], Awaitable[None]]] = None,
    max_iterations: Optional[int] = None,
    timeout_seconds: Optional[int] = None
) -> dict:
    """
    Run the research agent loop.
    
    The agent:
    1. Receives the user query
    2. (Plan Mode) Generates and streams a research plan, then waits for build
    3. Decides which tools to call (search, read, etc.)
    4. Executes tools and receives results
    5. Loops until it has enough information
    6. Generates final answer with citations
    
    Args:
        state: LangGraph state with user_query, business_id, etc.
        on_tool_call: Async callback to stream tool call events
        on_thinking: Optional async callback for streaming thinking/reasoning
        on_plan_chunk: Optional async callback for streaming plan content
        max_iterations: Maximum tool call iterations (default from config)
        timeout_seconds: Total timeout (default from config)
        
    Returns:
        {
            final_summary: str,
            citations: list,
            agent_actions: list,
            tool_calls_made: list,
            documents_read: list[str],
            total_iterations: int,
            conversation_history: list,
            plan: str (if plan_mode),
            plan_id: str (if plan_mode),
            awaiting_build: bool (if plan_mode)
        }
    """
    
    max_iterations = max_iterations or AGENT_CONFIG["max_iterations"]
    timeout_seconds = timeout_seconds or AGENT_CONFIG["timeout_seconds"]
    
    start_time = time.time()
    user_query = state.get("user_query", "")
    plan_mode = state.get("plan_mode", False)
    build_confirmed = state.get("build_confirmed", False)
    
    # PLAN MODE: Generate plan and return early (wait for build confirmation)
    if plan_mode and not build_confirmed:
        logger.info(f"[RESEARCH_AGENT] Plan mode active - generating plan")
        try:
            plan_content, plan_id = await generate_research_plan(state, on_plan_chunk)
            return {
                "plan": plan_content,
                "plan_id": plan_id,
                "awaiting_build": True,
                "final_summary": "",
                "citations": [],
                "agent_actions": [],
                "tool_calls_made": [],
                "documents_read": [],
                "total_iterations": 0,
                "conversation_history": state.get("conversation_history", [])
            }
        except Exception as e:
            logger.error(f"[RESEARCH_AGENT] Plan generation failed: {e}")
            return {
                "error": str(e),
                "final_summary": f"Failed to generate research plan: {str(e)}",
                "citations": [],
                "agent_actions": [],
                "tool_calls_made": [],
                "documents_read": [],
                "total_iterations": 0,
                "conversation_history": state.get("conversation_history", [])
            }
    
    logger.info(f"[RESEARCH_AGENT] Starting for query: '{user_query[:50]}...'")
    
    # Create context from state
    context = RetrievalToolContext.from_state(state)
    
    # Create tools
    tools = create_retrieval_tools(context)
    tool_map = {tool.name: tool for tool in tools}
    
    # Get LLM with tools bound
    model_preference = state.get("model_preference", "gpt-4o")
    llm = get_llm(model_preference, temperature=0)
    llm_with_tools = llm.bind_tools(tools, tool_choice="auto")
    
    # Build initial messages
    system_prompt = get_research_agent_prompt()
    
    # Include conversation history for context
    conversation_context = _format_conversation_history(
        state.get("conversation_history", [])
    )
    
    human_content = f"User query: {user_query}"
    if conversation_context:
        human_content = f"{conversation_context}\n\n{human_content}"
    
    messages: List[BaseMessage] = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=human_content)
    ]
    
    # Track iterations
    iterations = 0
    tool_calls_made = []
    final_answer = None
    
    # Emit initial planning step
    await on_tool_call({
        "type": "reasoning_step",
        "tool_name": "planning",
        "tool_input": {"query": user_query},
        "tool_output": None,
        "status": "running",
        "message": "Planning approach...",
        "action_type": "planning"
    })
    
    try:
        while iterations < max_iterations:
            iterations += 1
            
            # Check timeout
            elapsed = time.time() - start_time
            if elapsed > timeout_seconds:
                raise AgentTimeoutError(f"Agent timed out after {elapsed:.1f}s")
            
            logger.info(f"[RESEARCH_AGENT] Iteration {iterations}/{max_iterations}")
            
            # Call LLM (pass tools for potential fallback)
            try:
                response = await _invoke_with_retry(llm_with_tools, messages, tools=tools)
            except QuotaExhaustedError:
                raise  # Re-raise with clear message
            except Exception as e:
                error_str = str(e).lower()
                if _is_quota_error(str(e)):
                    raise QuotaExhaustedError(f"API quota exceeded: {e}")
                if _is_rate_limit_error(str(e)):
                    raise RateLimitError(f"Rate limit hit: {e}")
                raise
            
            messages.append(response)
            
            # Check for tool calls
            if response.tool_calls:
                for tool_call in response.tool_calls:
                    tool_name = tool_call["name"]
                    tool_args = tool_call["args"]
                    tool_call_id = tool_call["id"]
                    
                    logger.info(f"[RESEARCH_AGENT] Tool call: {tool_name}({json.dumps(tool_args)[:100]}...)")
                    
                    # ===== PREREQUISITE VALIDATION (BEFORE EXECUTION) =====
                    validation_error = _validate_tool_prerequisites(tool_name, tool_args, context)
                    
                    if validation_error:
                        # DO NOT EXECUTE - return validation error to LLM
                        result_str = json.dumps({
                            "success": False,
                            "error": validation_error,
                            "message": validation_error
                        })
                        logger.warning(f"[RESEARCH_AGENT] Prerequisite validation failed for {tool_name}: {validation_error[:100]}...")
                        
                        # Emit error reasoning step
                        await on_tool_call({
                            "type": "reasoning_step",
                            "tool_name": tool_name,
                            "tool_input": tool_args,
                            "tool_output": {"error": "Prerequisite not met"},
                            "status": "error",
                            "message": f"Error: {validation_error.split(':')[0]}",
                            "action_type": "error"
                        })
                        
                        # Parse for tracking
                        result = json.loads(result_str)
                    else:
                        # ===== PREREQUISITES MET - EXECUTE TOOL =====
                        # Stream "running" status
                        await on_tool_call({
                            "type": "reasoning_step",
                            "tool_name": tool_name,
                            "tool_input": tool_args,
                            "tool_output": None,
                            "status": "running",
                            "message": _format_running_message(tool_name, tool_args),
                            "action_type": _map_tool_to_action_type(tool_name)
                        })
                        
                        # REAL-TIME: Emit directly to stream queue
                        _emit_to_stream_queue(state, tool_name, tool_args, None, "running")
                        
                        # Execute tool
                        tool_func = tool_map.get(tool_name)
                        if not tool_func:
                            result_str = json.dumps({"error": f"Unknown tool: {tool_name}"})
                        else:
                            try:
                                result_str = await asyncio.wait_for(
                                    tool_func.ainvoke(tool_args),
                                    timeout=AGENT_CONFIG["tool_timeout_seconds"]
                                )
                            except asyncio.TimeoutError:
                                result_str = json.dumps({"error": f"Tool {tool_name} timed out"})
                            except Exception as e:
                                logger.error(f"[RESEARCH_AGENT] Tool {tool_name} failed: {e}")
                                result_str = json.dumps({"error": str(e)})
                        
                        # Parse result for logging
                        try:
                            result = json.loads(result_str)
                        except:
                            result = {"raw": result_str}
                        
                        # Stream "complete" status
                        await on_tool_call({
                            "type": "reasoning_step",
                            "tool_name": tool_name,
                            "tool_input": tool_args,
                            "tool_output": result,
                            "status": "complete" if result.get("success", True) else "error",
                            "message": _format_complete_message(tool_name, result),
                            "action_type": _map_tool_to_action_type(tool_name)
                        })
                        
                        # REAL-TIME: Emit directly to stream queue
                        status = "complete" if result.get("success", True) else "error"
                        _emit_to_stream_queue(state, tool_name, tool_args, result, status)
                    
                    # Track
                    tool_calls_made.append({
                        "iteration": iterations,
                        "name": tool_name,
                        "input": tool_args,
                        "output": result,
                        "success": result.get("success", True)
                    })
                    
                    # Add tool result to messages
                    messages.append(ToolMessage(
                        content=result_str,
                        tool_call_id=tool_call_id
                    ))
                    
                    # ===== STATE INJECTION (after successful search) =====
                    # Inject current state so LLM always knows available documents
                    if tool_name == "search_documents" and result.get("success"):
                        docs_found = result.get("documents", [])
                        if docs_found:
                            state_summary = (
                                f"\n[SYSTEM STATE UPDATE]\n"
                                f"Documents now available for reading ({len(docs_found)} found):\n"
                            )
                            for i, doc in enumerate(docs_found[:5], 1):
                                state_summary += f"  {i}. doc_id='{doc['doc_id']}' - {doc.get('filename', 'Unknown')}\n"
                            
                            state_summary += (
                                f"\nYou can now call read_document(doc_id='...') with any of these doc_ids.\n"
                                f"[END STATE UPDATE]\n"
                            )
                            
                            # Add as system message for LLM awareness
                            messages.append(SystemMessage(content=state_summary))
                            logger.info(f"[RESEARCH_AGENT] Injected state: {len(docs_found)} docs available")
            
            else:
                # No tool calls = LLM is ready to answer
                final_answer = response.content
                logger.info(f"[RESEARCH_AGENT] Completed after {iterations} iterations")
                
                # Emit completion step
                await on_tool_call({
                    "type": "reasoning_step",
                    "tool_name": "generate_answer",
                    "tool_input": {},
                    "tool_output": {"answer_length": len(final_answer) if final_answer else 0},
                    "status": "complete",
                    "message": "Generated answer",
                    "action_type": "summarising"
                })
                
                # REAL-TIME: Emit directly to stream queue
                _emit_to_stream_queue(state, "generate_answer", {}, {"answer_length": len(final_answer) if final_answer else 0}, "complete")
                
                break
        
        if final_answer is None:
            raise MaxIterationsError(f"Agent did not complete after {max_iterations} iterations")
        
        # Extract citations from the answer using block metadata
        # This also converts BLOCK_CITE_ID_X to [N] format if needed
        final_answer, citations = _extract_citations(final_answer, context)
        
        # Build agent actions (for document display)
        agent_actions = _build_agent_actions(context, citations)
        
        elapsed_total = time.time() - start_time
        logger.info(f"[RESEARCH_AGENT] Success in {elapsed_total:.1f}s, {iterations} iterations, {len(tool_calls_made)} tool calls")
        
        return {
            "final_summary": final_answer,
            "citations": citations,
            "agent_actions": agent_actions,
            "tool_calls_made": tool_calls_made,
            "documents_read": list(context.read_documents.keys()),
            "total_iterations": iterations,
            "conversation_history": _build_updated_history(
                state.get("conversation_history", []),
                user_query,
                final_answer
            )
        }
        
    except QuotaExhaustedError as e:
        elapsed_total = time.time() - start_time
        logger.error(f"[RESEARCH_AGENT] Quota exhausted after {elapsed_total:.1f}s: {e}")
        
        # Provide helpful message for quota errors
        return {
            "final_summary": (
                "I'm unable to complete this research because the AI service quota has been exceeded. "
                "This is a billing issue with the AI provider. Please try selecting a different AI model "
                "(like Claude) in the settings, or contact your administrator to add credits to the API account."
            ),
            "citations": [],
            "agent_actions": [],
            "tool_calls_made": tool_calls_made,
            "documents_read": list(context.read_documents.keys()),
            "total_iterations": iterations,
            "error": str(e),
            "error_type": "quota_exhausted",
            "_fallback_requested": False  # Don't retry, it's a billing issue
        }
        
    except Exception as e:
        elapsed_total = time.time() - start_time
        logger.error(f"[RESEARCH_AGENT] Failed after {elapsed_total:.1f}s: {e}", exc_info=True)
        
        # Check if it's a quota error that wasn't caught earlier
        if _is_quota_error(str(e)):
            return {
                "final_summary": (
                    "I'm unable to complete this research because the AI service quota has been exceeded. "
                    "Please try selecting a different AI model (like Claude) in the settings, "
                    "or contact your administrator to add credits to the API account."
                ),
                "citations": [],
                "agent_actions": [],
                "tool_calls_made": tool_calls_made,
                "documents_read": list(context.read_documents.keys()),
                "total_iterations": iterations,
                "error": str(e),
                "error_type": "quota_exhausted",
                "_fallback_requested": False
            }
        
        # Return partial results with error
        return {
            "final_summary": f"I encountered an error while researching: {str(e)}. Please try again.",
            "citations": [],
            "agent_actions": [],
            "tool_calls_made": tool_calls_made,
            "documents_read": list(context.read_documents.keys()),
            "total_iterations": iterations,
            "error": str(e),
            "_fallback_requested": AGENT_CONFIG["fallback_on_error"]
        }


# =============================================================================
# Helper Functions
# =============================================================================

def _is_quota_error(error_str: str) -> bool:
    """Check if error is a quota/billing error (not retryable)."""
    quota_indicators = [
        "insufficient_quota",
        "exceeded your current quota",
        "billing",
        "exceeded quota",
        "quota exceeded"
    ]
    error_lower = error_str.lower()
    return any(indicator in error_lower for indicator in quota_indicators)


def _is_rate_limit_error(error_str: str) -> bool:
    """Check if error is a temporary rate limit (retryable)."""
    return ("rate limit" in error_str.lower() or "429" in error_str) and not _is_quota_error(error_str)


async def _invoke_with_retry(
    llm, 
    messages: List[BaseMessage], 
    max_retries: int = 3,
    fallback_model: str = None,
    tools: list = None
):
    """
    Invoke LLM with exponential backoff retry for rate limits.
    Falls back to Anthropic/Claude on quota errors if available.
    """
    for attempt in range(max_retries):
        try:
            return await llm.ainvoke(messages)
        except Exception as e:
            error_str = str(e)
            
            # Check for quota errors (not retryable - need to switch provider)
            if _is_quota_error(error_str):
                logger.warning(f"[RESEARCH_AGENT] OpenAI quota exceeded, attempting fallback to Claude")
                
                # Try to fallback to Anthropic
                try:
                    from backend.llm.config import config
                    if config.anthropic_api_key:
                        from langchain_anthropic import ChatAnthropic
                        fallback_llm = ChatAnthropic(
                            api_key=config.anthropic_api_key,
                            model='claude-sonnet-4-20250514',
                            temperature=0
                        )
                        # Bind tools if provided
                        if tools:
                            fallback_llm = fallback_llm.bind_tools(tools, tool_choice="auto")
                        logger.info("[RESEARCH_AGENT] Successfully switched to Claude fallback")
                        return await fallback_llm.ainvoke(messages)
                    else:
                        logger.error("[RESEARCH_AGENT] No Anthropic API key configured for fallback")
                        raise QuotaExhaustedError(
                            "OpenAI API quota exceeded. Please check your OpenAI billing, "
                            "add credits, or configure ANTHROPIC_API_KEY for Claude fallback."
                        )
                except ImportError:
                    raise QuotaExhaustedError(
                        "OpenAI API quota exceeded and Claude fallback unavailable. "
                        "Please add credits to your OpenAI account."
                    )
            
            # Check for temporary rate limits (retryable)
            if _is_rate_limit_error(error_str) and attempt < max_retries - 1:
                wait_time = min(2 ** attempt * 5, 60)  # 5s, 10s, 20s, max 60s
                logger.warning(f"[RESEARCH_AGENT] Rate limit hit, waiting {wait_time}s (attempt {attempt + 1})")
                await asyncio.sleep(wait_time)
            else:
                raise


def _map_tool_to_action_type(tool_name: str) -> str:
    """Map tool names to action types for reasoning steps."""
    return {
        "search_documents": "searching",
        "read_document": "reading",
        "read_multiple_documents": "reading",
        "planning": "planning",
        "generate_answer": "summarising"
    }.get(tool_name, "analysing")


def _format_running_message(tool_name: str, tool_args: dict) -> str:
    """Format user-friendly message for tool start."""
    if tool_name == "search_documents":
        return f"Searching for: {tool_args.get('query', '')}"
    elif tool_name == "read_document":
        return "Reading document..."
    elif tool_name == "read_multiple_documents":
        count = len(tool_args.get("doc_ids", []))
        return f"Reading {count} documents..."
    return f"Running {tool_name}..."


def _format_complete_message(tool_name: str, result: dict) -> str:
    """Format user-friendly message for tool completion."""
    if not result.get("success", True):
        return f"Error: {result.get('error', 'Unknown error')}"
    
    if tool_name == "search_documents":
        count = result.get("total_found", 0)
        if count == 0:
            return "No documents found"
        docs = result.get("documents", [])
        if docs:
            names = [d.get("filename", "Unknown")[:30] for d in docs[:3]]
            return f"Found {count} document{'s' if count != 1 else ''}: {', '.join(names)}"
        return f"Found {count} document{'s' if count != 1 else ''}"
    
    elif tool_name == "read_document":
        filename = result.get("filename", "document")
        chunk_count = result.get("chunk_count", 0)
        return f"Read {filename} ({chunk_count} chunks)"
    
    elif tool_name == "read_multiple_documents":
        count = result.get("documents_read", 0)
        return f"Read {count} documents"
    
    return result.get("message", f"{tool_name} complete")


def _emit_to_stream_queue(state: dict, tool_name: str, tool_args: dict, result: Optional[dict], status: str):
    """Emit reasoning step directly to stream queue for real-time display."""
    stream_queue = state.get("_stream_queue")
    if not stream_queue:
        return
    
    if status == "running":
        message = _format_running_message(tool_name, tool_args)
        tool_output = None
    else:
        message = _format_complete_message(tool_name, result or {})
        tool_output = result
    
    reasoning_data = {
        'type': 'reasoning_step',
        'step': f"agent_{tool_name}",
        'action_type': _map_tool_to_action_type(tool_name),
        'message': message,
        'details': {
            'tool_name': tool_name,
            'tool_input': tool_args,
            'tool_output': tool_output,
            'status': status
        }
    }
    stream_queue.put(f"data: {json.dumps(reasoning_data)}\n\n")


def _validate_tool_prerequisites(
    tool_name: str,
    tool_args: dict,
    context: RetrievalToolContext
) -> Optional[str]:
    """
    Validate tool prerequisites BEFORE execution.
    
    Returns:
        None if valid (proceed with execution)
        Error string if invalid (do NOT execute, return error to LLM)
    
    Rules:
        - search_documents: ALWAYS allowed (no prerequisites)
        - read_document: doc_id MUST exist in context.all_search_results
        - read_multiple_documents: ALL doc_ids MUST exist in context.all_search_results
    """
    
    # search_documents has no prerequisites
    if tool_name == "search_documents":
        return None
    
    # read_document requires doc_id from search results
    if tool_name == "read_document":
        doc_id = tool_args.get("doc_id")
        
        if not doc_id:
            return (
                "VALIDATION_ERROR: 'doc_id' parameter is required. "
                "ACTION: Call search_documents first to find documents, "
                "then use a doc_id from the search results."
            )
        
        # Check if doc_id exists in search results
        found = context.get_search_result_by_doc_id(doc_id)
        if not found:
            # Build helpful error with available doc_ids
            available_docs = context.all_search_results
            if available_docs:
                available_info = [
                    f"  - {d['doc_id'][:12]}... ({d.get('filename', 'Unknown')})"
                    for d in available_docs[:5]
                ]
                available_str = "\n".join(available_info)
                return (
                    f"PREREQUISITE_ERROR: Cannot read document '{doc_id[:12]}...' - "
                    f"this doc_id was NOT returned by any previous search_documents call.\n\n"
                    f"AVAILABLE DOCUMENTS (from your searches):\n{available_str}\n\n"
                    f"ACTION: Use one of the available doc_ids above, "
                    f"OR call search_documents with different terms to find the document you need."
                )
            else:
                return (
                    f"PREREQUISITE_ERROR: Cannot read document '{doc_id[:12]}...' - "
                    f"you have NOT called search_documents yet.\n\n"
                    f"AVAILABLE DOCUMENTS: None (no search performed)\n\n"
                    f"ACTION: You MUST call search_documents first to find documents. "
                    f"Example: search_documents(query='valuation report')"
                )
        
        return None  # Valid - proceed with execution
    
    # read_multiple_documents requires ALL doc_ids from search results
    if tool_name == "read_multiple_documents":
        doc_ids = tool_args.get("doc_ids", [])
        
        if not doc_ids:
            return (
                "VALIDATION_ERROR: 'doc_ids' list is required. "
                "ACTION: Call search_documents first, then provide doc_ids from results."
            )
        
        # Check each doc_id
        missing = []
        for doc_id in doc_ids:
            if not context.get_search_result_by_doc_id(doc_id):
                missing.append(doc_id[:12])
        
        if missing:
            available_docs = context.all_search_results
            available_ids = [d['doc_id'][:12] for d in available_docs[:5]]
            return (
                f"PREREQUISITE_ERROR: Cannot read documents - "
                f"{len(missing)} doc_id(s) NOT found in search results: {missing}\n\n"
                f"AVAILABLE doc_ids: {available_ids if available_ids else 'None'}\n\n"
                f"ACTION: Only use doc_ids from search_documents results."
            )
        
        return None  # Valid
    
    # Unknown tool - allow (don't block)
    return None


def _format_conversation_history(history: List[dict]) -> str:
    """Format conversation history for agent context."""
    if not history:
        return ""
    
    parts = ["Previous conversation:"]
    for entry in history[-3:]:  # Last 3 exchanges
        query = entry.get("query", "")
        summary = entry.get("summary", "")[:500]
        if query and summary:
            parts.append(f"Q: {query}")
            parts.append(f"A: {summary}...")
    
    if len(parts) == 1:
        return ""
    
    return "\n".join(parts)


def _convert_block_cite_ids_to_numbered(answer: str, context: RetrievalToolContext) -> tuple[str, dict]:
    """
    Convert BLOCK_CITE_ID_X references to numbered [N] citations.
    Returns (converted_answer, block_id_to_citation_number_mapping).
    
    The LLM sometimes outputs [BLOCK_CITE_ID_89] instead of [1].
    This function normalizes these to proper numbered citations.
    """
    import re
    
    # Find all BLOCK_CITE_ID references (various formats)
    # Matches: [BLOCK_CITE_ID_89], (BLOCK_CITE_ID_89), BLOCK_CITE_ID_89
    block_cite_pattern = r'[\[\(]?BLOCK_CITE_ID_(\d+)[\]\)]?'
    
    # Find unique block IDs mentioned in the answer, in order of appearance
    found_block_ids = []
    for match in re.finditer(block_cite_pattern, answer):
        block_num = match.group(1)
        block_id = f"BLOCK_CITE_ID_{block_num}"
        if block_id not in found_block_ids:
            found_block_ids.append(block_id)
    
    # Create mapping from block_id to citation number
    block_id_to_citation = {}
    for i, block_id in enumerate(found_block_ids, start=1):
        block_id_to_citation[block_id] = i
    
    # Replace all BLOCK_CITE_ID references with numbered citations
    def replace_block_cite(match):
        block_num = match.group(1)
        block_id = f"BLOCK_CITE_ID_{block_num}"
        citation_num = block_id_to_citation.get(block_id, 1)
        return f"[{citation_num}]"
    
    converted_answer = re.sub(block_cite_pattern, replace_block_cite, answer)
    
    return converted_answer, block_id_to_citation


def _extract_citations(answer: str, context: RetrievalToolContext) -> tuple[str, List[dict]]:
    """
    Extract citation data from answer using BLOCK_CITE_ID references.
    Also converts BLOCK_CITE_ID_X to [N] format if needed.
    Returns (processed_answer, citations_list).
    """
    import re
    
    citations = []
    processed_answer = answer
    
    # First, check if there are BLOCK_CITE_ID references and convert them
    if 'BLOCK_CITE_ID_' in answer:
        processed_answer, block_id_to_citation = _convert_block_cite_ids_to_numbered(answer, context)
        
        # Build citations from the block_id mapping
        for block_id, citation_num in block_id_to_citation.items():
            # Look up metadata for this block
            if block_id in context.block_id_to_metadata:
                meta = context.block_id_to_metadata[block_id]
                citations.append({
                    "citation_number": citation_num,
                    "doc_id": meta["doc_id"],
                    "page_number": meta.get("page", 1),
                    "bbox": meta.get("bbox", {}),
                    "block_id": block_id
                })
        
        # Sort by citation number
        citations.sort(key=lambda x: x["citation_number"])
        return processed_answer, citations
    
    # Fallback: Look for [N] citations in the answer
    citation_pattern = r'\[(\d+)\]'
    citation_matches = list(set(re.findall(citation_pattern, answer)))
    citation_matches.sort(key=int)
    
    # Map citations to block metadata
    block_ids = list(context.block_id_to_metadata.keys())
    
    for citation_num in citation_matches:
        citation_idx = int(citation_num) - 1  # Convert to 0-indexed
        
        if citation_idx < len(block_ids):
            block_id = block_ids[citation_idx]
            meta = context.block_id_to_metadata[block_id]
            
            citations.append({
                "citation_number": int(citation_num),
                "doc_id": meta["doc_id"],
                "page_number": meta.get("page", 1),
                "bbox": meta.get("bbox", {}),
                "block_id": block_id
            })
    
    return processed_answer, citations


def _build_agent_actions(context: RetrievalToolContext, citations: List[dict]) -> List[dict]:
    """Build agent actions for document display."""
    actions = []
    
    # If we have citations, add open_document action for the first one
    if citations:
        first_citation = citations[0]
        actions.append({
            "action": "open_document",
            "params": {
                "citation_number": first_citation["citation_number"],
                "doc_id": first_citation["doc_id"],
                "page": first_citation.get("page_number", 1),
                "reason": "Displaying source document"
            }
        })
    
    return actions


def _build_updated_history(
    existing_history: List[dict],
    query: str,
    answer: str
) -> List[dict]:
    """Build updated conversation history."""
    new_entry = {
        "query": query,
        "summary": answer,
        "timestamp": datetime.now().isoformat(),
        "query_category": "agent_research"
    }
    return list(existing_history) + [new_entry]


# =============================================================================
# LangGraph Node Wrapper
# =============================================================================

async def research_agent_node(state: dict, on_tool_call: Callable = None) -> dict:
    """
    LangGraph node that runs the research agent.
    
    This replaces the fixed simple_search/complex_search pipelines
    with a model-driven agent loop.
    """
    
    # Collect tool call events
    tool_events = []
    
    async def collect_tool_call(event: dict):
        tool_events.append(event)
        # If external callback provided, call it too
        if on_tool_call:
            await on_tool_call(event)
    
    result = await run_research_agent(
        state=state,
        on_tool_call=collect_tool_call
    )
    
    # Build return state
    return_state = {
        "final_summary": result.get("final_summary", ""),
        "citations": result.get("citations", []),
        "agent_actions": result.get("agent_actions", []),
        "conversation_history": result.get("conversation_history", []),
        "document_outputs": [],  # Not used in agent mode
        "relevant_documents": [],  # Not used in agent mode
        "_agent_tool_events": tool_events,
        "_agent_error": result.get("error"),
        "_agent_iterations": result.get("total_iterations", 0),
        "_agent_documents_read": result.get("documents_read", [])
    }
    
    # Add plan mode fields if present
    if result.get("plan"):
        return_state["plan_content"] = result.get("plan")
        return_state["plan_id"] = result.get("plan_id")
        return_state["awaiting_build"] = result.get("awaiting_build", False)
    
    return return_state

"""
Executor Node - Executes steps from the execution plan.

This node takes the structured plan from the planner and executes each step sequentially.
It emits execution events for each step (what Cursor shows - operational reasoning).

Key Principle: Show what the system does, not how it thinks.

SIMPLE TWO-STEP RETRIEVAL ARCHITECTURE:
- retrieve_docs: Finds relevant documents using hybrid search (vector + keyword)
- retrieve_chunks: Gets chunks from those documents using vector similarity + keyword search
- This proven approach is simpler and more reliable than complex multi-tool exploration
"""

import logging
import json
from typing import Dict, Any, List, Optional
# Removed unused imports for document explorer tools:
# from langchain_openai import ChatOpenAI
# from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
# from langgraph.prebuilt import ToolNode

from backend.llm.types import MainWorkflowState, ExecutionPlan, ExecutionStep
from backend.llm.utils.execution_events import ExecutionEvent, ExecutionEventEmitter
from backend.llm.tools.document_retriever_tool import retrieve_documents
from backend.llm.tools.chunk_retriever_tool import retrieve_chunks
from backend.llm.contracts.validators import validate_executor_output
from backend.llm.config import config
# Document explorer tools removed - using simple retrieve_chunks() instead
# from backend.llm.tools.document_explorer import create_document_explorer_tools
from backend.services.supabase_client_factory import get_supabase_client

logger = logging.getLogger(__name__)

# Prefixes to strip from user-style requests so the remainder reads well
_REASONING_QUERY_STRIP_PREFIXES = (
    "give me ", "get me ", "can you ", "could you ", "would you ", "will you ",
    "i need ", "i want ", "i'd like ", "i would like ", "please ", "tell me ",
    "show me ", "help me ", "i'm looking for ", "find ", "analyse ", "analyze ",
    "what is ", "what are ", "what's ", "where is ", "how do ", "how does ",
    "how can ", "when did ", "why does ", "which ",
)


def _rephrase_query_for_reasoning_step(raw_query: str) -> str:
    """
    Turn a raw user query into a short phrase that reads naturally in a search-step message,
    e.g. "overview of the Koch market appraisal" so we can show "Preparing overview of the Koch market appraisal".
    Strips request phrasing, trailing punctuation, and normalizes for clear English.
    """
    if not raw_query or not isinstance(raw_query, str):
        return "documents"
    s = raw_query.strip()
    if not s:
        return "documents"
    lower = s.lower()
    for prefix in _REASONING_QUERY_STRIP_PREFIXES:
        if lower.startswith(prefix):
            s = s[len(prefix):].strip()
            lower = s.lower()
            break
    # Strip trailing question marks and periods so it reads as a statement
    s = s.rstrip("?. ")
    if not s:
        return "documents"
    # Optional: drop leading "the " when followed by "X of Y" so we get "value of Highlands" not "the value of highlands"
    lower = s.lower()
    if lower.startswith("the ") and " of " in lower:
        s = s[4:].strip()
    if not s:
        return "documents"
    # Capitalise first letter only; keep the rest (e.g. "value of highlands" -> "Value of highlands")
    s = s[0].upper() + s[1:] if len(s) > 1 else s.upper()
    # Cap length for display
    max_len = 60
    if len(s) > max_len:
        s = s[: max_len - 3].rstrip() + "..."
    return s if s else "documents"


def _choose_search_intro(intent: str) -> str:
    """
    Choose the intro that flows best for this intent: Finding, Searching for, or Locating.
    Returns the full label (e.g. "Locating Koch market appraisal", "Finding value of highlands").
    """
    if not intent or intent.lower() == "documents":
        return "Searching for documents"
    lower = intent.lower()
    words = lower.split()
    # Document / report / appraisal by name → "Locating" (we're locating that doc)
    doc_like = any(t in lower for t in ("document", "appraisal", "report", "valuation", "file"))
    if doc_like or (len(words) >= 3 and words[0] not in ("the", "a", "an", "overview", "value", "summary")):
        return f"Locating {intent}"
    # Short or content-focused (value, overview, summary, EPC, etc.) → "Finding"
    content_like = any(t in lower for t in ("value", "overview", "summary", "rating", "epc", "assumption", "disclaimer"))
    if content_like or len(words) <= 3:
        return f"Finding {intent}"
    # Longer or query-like → "Searching for"
    return f"Searching for {intent}"


def resolve_step_references(step: ExecutionStep, execution_results: List[Dict[str, Any]]) -> ExecutionStep:
    """
    Resolve references like '<from_step_X>' in step parameters.
    
    For example, if step has document_ids=["<from_step_search_docs>"],
    this will look up the result from step with id "search_docs" and replace it.
    """
    resolved_step = step.copy()
    
    # Resolve document_ids references
    if resolved_step.get("document_ids"):
        resolved_ids = []
        for doc_id_ref in resolved_step["document_ids"]:
            if isinstance(doc_id_ref, str) and doc_id_ref.startswith("<from_step_") and doc_id_ref.endswith(">"):
                # Extract step ID from reference
                # "<from_step_search_docs>" -> "search_docs"
                step_id = doc_id_ref[11:-1]  # Remove "<from_step_" (11 chars) and ">" (1 char)
                logger.debug(f"[RESOLVE] Resolving reference '{doc_id_ref}' -> step_id: '{step_id}'")
                
                # Find result from that step
                found_result = None
                for result in execution_results:
                    if result.get("step_id") == step_id:
                        found_result = result
                        logger.debug(f"[RESOLVE] Found result for step_id '{step_id}': action={result.get('action')}, result_type={type(result.get('result'))}")
                        break
                
                if found_result:
                    # Extract document IDs from result
                    if found_result.get("action") == "retrieve_docs":
                        docs = found_result.get("result", [])
                        if isinstance(docs, list):
                            doc_ids = [doc.get("document_id") for doc in docs if doc.get("document_id")]
                            logger.debug(f"[RESOLVE] Extracted {len(doc_ids)} document IDs from step '{step_id}'")
                            resolved_ids.extend(doc_ids)
                        else:
                            logger.warning(f"[RESOLVE] Result from step '{step_id}' is not a list: {type(docs)}")
                    else:
                        logger.warning(f"[RESOLVE] Step '{step_id}' has action '{found_result.get('action')}', not 'retrieve_docs'")
                else:
                    logger.warning(f"[RESOLVE] Could not find result for step_id '{step_id}' in execution_results. Available step_ids: {[r.get('step_id') for r in execution_results]}")
            else:
                # Not a reference, use as-is
                resolved_ids.append(doc_id_ref)
        
        if resolved_ids:
            resolved_step["document_ids"] = resolved_ids
            logger.debug(f"[RESOLVE] Resolved document_ids: {len(resolved_ids)} IDs")
        else:
            resolved_step["document_ids"] = None
            logger.warning(f"[RESOLVE] No document IDs resolved, setting to None")
    
    return resolved_step


def is_complex_query(query: str, document_ids: List[str]) -> bool:
    """
    DEPRECATED: This function is no longer used.
    
    All retrieve_chunks actions now use the LLM autonomous agent with document explorer tools.
    The LLM makes autonomous decisions about document exploration.
    
    This function is kept for reference only.
    
    Args:
        query: User query
        document_ids: List of document IDs to search
    
    Returns:
        True (always use agent)
    """
    query_lower = query.lower()
    
    # Complex query indicators:
    complex_indicators = [
        "summarize", "summary", "overview", "what does it say",
        "all", "entire", "complete", "full",
        "section", "chapter", "part",
        "compare", "difference", "similar",
        "how", "why", "explain", "describe",
        "list", "enumerate", "what are",
    ]
    
    # Check if query contains complex indicators
    is_complex = any(indicator in query_lower for indicator in complex_indicators)
    
    # Multiple documents = more complex (may need cross-document navigation)
    is_multi_doc = len(document_ids) > 1
    
    # Long queries are often more complex
    is_long_query = len(query.split()) > 10
    
    # DEPRECATED: Always return True since we always use agent now
    return True


# DEPRECATED: Document explorer tools removed - using simple retrieve_chunks() instead
# def convert_explorer_chunks_to_retriever_format(
#     explorer_results: List[Dict[str, Any]],
#     document_ids: List[str]
# ) -> List[Dict[str, Any]]:
#     """
#     Convert chunks from document explorer tools to retrieve_chunks() format.
#     ...
#     """
#     ... (commented out - no longer used)


# DEPRECATED: Document explorer tools removed - using simple retrieve_chunks() instead
# The executor_agent_node function has been removed.
# If you need to restore it, check git history or restore from backup.


async def executor_node(state: MainWorkflowState, runnable_config=None) -> MainWorkflowState:
    """
    Executor node - executes next step(s) from execution plan.
    
    This node:
    1. Gets current execution plan and step index
    2. Executes next step (or batch if parallelizable)
    3. Emits execution events for each step
    4. Stores results in execution_results
    5. Updates current_step_index
    
    Args:
        state: MainWorkflowState with execution_plan, current_step_index, execution_results
        runnable_config: Optional RunnableConfig from LangGraph
        
    Returns:
        Updated state with execution_results and current_step_index
    """
    execution_plan = state.get("execution_plan")
    current_step_index = state.get("current_step_index", 0)
    # CRITICAL: Capture original state for validation BEFORE modifying
    original_execution_results = state.get("execution_results", [])
    original_state_for_validation = {
        "current_step_index": current_step_index,
        "execution_results": list(original_execution_results)  # Copy for safety
    }
    
    # Create a copy of execution_results to avoid mutating state directly
    # LangGraph merges state, so we need to return a new list
    execution_results = list(original_execution_results)
    emitter = state.get("execution_events")
    if emitter is None:
        logger.warning("[EXECUTOR] ⚠️  Emitter is None - reasoning events will not be emitted")
    business_id = state.get("business_id")
    user_query = state.get("user_query", "")  # Get user's original query for context
    
    if not execution_plan:
        logger.warning("[EXECUTOR] No execution plan found, skipping execution")
        return {}
    
    steps = execution_plan.get("steps", [])
    if current_step_index >= len(steps):
        logger.info("[EXECUTOR] All steps completed")
        return {}
    
    # Get current step
    current_step = steps[current_step_index]
    logger.info(f"[EXECUTOR] Executing step {current_step_index + 1}/{len(steps)}: {current_step['id']} ({current_step['action']})")
    
    # Resolve step references (e.g., "<from_step_search_docs>")
    resolved_step = resolve_step_references(current_step, execution_results)
    
    # Emit user-facing reasoning events (not internal tool metadata)
    if emitter:
        action = resolved_step["action"]
        reasoning_label = resolved_step.get("reasoning_label", "")
        reasoning_detail = resolved_step.get("reasoning_detail")
        
        if action == "retrieve_docs":
            # Emit a short, natural sentence; choose intro (Finding / Searching for / Locating) by what flows best
            step_query = (resolved_step.get("query") or "").strip()
            if step_query and "execution plan" not in step_query.lower() and "user's query" not in step_query.lower():
                intent = _rephrase_query_for_reasoning_step(step_query)
                reasoning_label = _choose_search_intro(intent)
            elif reasoning_label:
                # Use plan's reasoning_label if step query is empty or meta
                pass
            else:
                reasoning_label = "Searching for documents"
            emitter.emit_reasoning(
                label=reasoning_label,
                detail=reasoning_detail
            )
            
        elif action == "retrieve_chunks":
            document_ids = resolved_step.get("document_ids") or []
            doc_count = len(document_ids) if document_ids else 0
            
            # Use the reasoning_label from the plan
            if not reasoning_label:
                reasoning_label = f"Reviewed {doc_count} document{'' if doc_count == 1 else 's'}"
            
            emitter.emit_reasoning(
                label=reasoning_label,
                detail=reasoning_detail
            )
        
    # Execute step based on action type
    result = None
    try:
        action = resolved_step["action"]
        
        if action == "retrieve_docs":
            # Simple call - let retriever decide parameters
            result = retrieve_documents(
                query=resolved_step.get("query", ""),
                business_id=business_id
            )
            
        elif action == "retrieve_chunks":
            document_ids = resolved_step.get("document_ids")
            if document_ids is None or (isinstance(document_ids, list) and len(document_ids) == 0):
                logger.warning(f"[EXECUTOR] Step {resolved_step['id']} has no document_ids, skipping")
                result = []
            else:
                query = resolved_step.get("query", "")
                logger.info(f"[EXECUTOR] Calling retrieve_chunks: '{query[:50]}...' ({len(document_ids)} documents)")
                
                # Simple call - let retriever decide all parameters (query profile, top_k, min_score)
                result = retrieve_chunks(
                    query=query,
                    document_ids=document_ids,
                    business_id=business_id
                )
                
                # Fail loudly if no results - no retry, no interpretation
                if not result or len(result) == 0:
                    logger.warning(f"[EXECUTOR] ⚠️ No chunks found for query: '{query[:50]}...'")
                
        elif action == "query_db":
            # TODO: Implement database query execution
            logger.warning(f"[EXECUTOR] query_db action not yet implemented")
            result = []
            
        elif action == "analyze":
            # Analyze action is handled by responder node
            logger.info(f"[EXECUTOR] Analyze action will be handled by responder")
            result = {"status": "pending", "focus": resolved_step.get("focus")}
            
        else:
            logger.warning(f"[EXECUTOR] Unknown action: {action}")
            result = []
        
        # Store result
        execution_results.append({
            "step_id": resolved_step["id"],
            "action": action,
            "result": result,
            "success": True
        })
        
        # Emit user-facing reasoning for results
        if emitter:
            action = resolved_step["action"]
            result_count = 0
            if isinstance(result, list):
                result_count = len(result)
            elif isinstance(result, dict) and "status" in result:
                result_count = 1  # Analyze action
            
            if action == "retrieve_docs":
                if result_count > 0:
                    emitter.emit_reasoning(
                        label=f"Found {result_count} relevant document{'' if result_count == 1 else 's'}",
                        detail=None
                    )
                else:
                    emitter.emit_reasoning(
                        label="No relevant documents found",
                        detail="Trying alternative search terms"
                    )
            elif action == "retrieve_chunks":
                doc_ids = resolved_step.get("document_ids") or []
                doc_count = len(doc_ids) if doc_ids else 0
                
                if result_count > 0:
                    emitter.emit_reasoning(
                        label=f"Found {result_count} relevant section{'' if result_count == 1 else 's'}",
                        detail=f"From {doc_count} document{'' if doc_count == 1 else 's'}"
                    )
                else:
                    emitter.emit_reasoning(
                        label="No relevant information found",
                        detail="The document doesn't contain the requested information"
                    )
        logger.info(f"[EXECUTOR] ✅ Step {resolved_step['id']} completed successfully")
        
    except Exception as e:
        logger.error(f"[EXECUTOR] ❌ Error executing step {resolved_step['id']}: {e}", exc_info=True)
        
        # Store error result
        execution_results.append({
            "step_id": resolved_step["id"],
            "action": resolved_step["action"],
            "result": None,
            "success": False,
            "error": str(e)
        })
        
        # Emit error reasoning event (user-facing)
        if emitter:
            emitter.emit_reasoning(
                label="Error occurred while searching",
                detail="Please try rephrasing your question"
            )
    
    # Move to next step
    next_step_index = current_step_index + 1
    
    # Prepare output with a copy of execution_results to avoid state mutation issues
    executor_output = {
        "current_step_index": next_step_index,
        "execution_results": list(execution_results)  # Ensure we return a new list
    }
    
    # Validate output against contract
    # IMPORTANT: Pass the original state (before modifications) for validation
    try:
        validate_executor_output(executor_output, original_state_for_validation)
    except ValueError as e:
        logger.error(f"[EXECUTOR] ❌ Contract violation: {e}")
        logger.error(f"[EXECUTOR] Original state: current_step_index={current_step_index}, results_count={len(state.get('execution_results', []))}")
        logger.error(f"[EXECUTOR] Output: current_step_index={next_step_index}, results_count={len(executor_output['execution_results'])}")
        raise
    
    return executor_output


"""
Agent Loop Node - LobeHub-style single agent loop.

The model sees the full conversation + tool definitions and decides:
- call tools (retrieve_docs, retrieve_chunks) -> execute and loop
- finish (no tool calls) -> hand off to responder with execution_results

No separate planner, executor, or intent classifier. Routing is identical to LobeHub.
"""

import json
import logging
from typing import Any, Dict, List, Optional

from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_openai import ChatOpenAI

from backend.llm.config import config
from backend.llm.types import MainWorkflowState
from backend.llm.utils.execution_events import ExecutionEventEmitter
from backend.llm.utils.node_logging import log_node_perf
from backend.llm.utils.workspace_context import get_document_ids_for_property

logger = logging.getLogger(__name__)

MAX_ITERATIONS = 6

# Tool names (must match function names in _execute_tool)
RETRIEVE_DOCS = "retrieve_docs"
RETRIEVE_CHUNKS = "retrieve_chunks"


def _get_agent_loop_system_prompt() -> str:
    """System prompt instructing the model on when to use tools vs reply directly."""
    return """You are an assistant with access to a document search system. Your job is to decide when to search documents and when to reply from context alone.

You have two tools:
1. retrieve_docs(query) - Search for relevant documents. Returns document IDs and filenames. Use this FIRST when the user asks about documents, property information, valuations, leases, etc.
2. retrieve_chunks(query, document_ids) - Get detailed text from specific documents. Use AFTER retrieve_docs. Pass the document_ids from the retrieve_docs result.

When to use tools:
- User asks about documents, property, valuations, leases, contracts, summaries, details, etc. -> Call retrieve_docs, then retrieve_chunks with the returned document_ids
- User attaches documents (document_ids will be in scope) -> Call retrieve_chunks directly with those document_ids
- Short follow-up like "more detail", "expand", "key dates?" -> Call retrieve_chunks with the same document_ids from the previous turn (they are in scope)
- User asks to compare, find similar properties -> Call retrieve_docs with a broad query, then retrieve_chunks

When to finish (no tools):
- Obvious greeting with no info request: "hi", "thanks", "bye"
- You already have sufficient chunk results from prior tool calls and the user's question can be answered from them (the system will generate the answer separately)
- Question about yourself/capabilities with no document context

If the user's message is ambiguous, prefer using tools (search) over finishing. Better to search and find nothing than miss relevant documents.

After calling retrieve_chunks and receiving results, you may finish - the system will generate the final answer with citations from those chunks."""


def _build_tool_definitions() -> List[Dict[str, Any]]:
    """OpenAI function-calling format for retrieve_docs and retrieve_chunks."""
    return [
        {
            "type": "function",
            "function": {
                "name": RETRIEVE_DOCS,
                "description": "Search for relevant documents by query. Returns document IDs and filenames. Use this first before retrieve_chunks.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query - include property names, document types, or keywords",
                        },
                    },
                    "required": ["query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": RETRIEVE_CHUNKS,
                "description": "Get detailed text chunks from specific documents. Requires document_ids from retrieve_docs or from the user's attached documents.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "What to search for within the documents",
                        },
                        "document_ids": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "List of document UUIDs from retrieve_docs or attached files",
                        },
                    },
                    "required": ["query", "document_ids"],
                },
            },
        },
    ]


def _choose_search_intro(query: str) -> str:
    """Choose a short reasoning label for search steps (matches executor style)."""
    if not (query or "").strip():
        return "Searching for documents"
    q = (query or "").strip()[:60].lower()
    if any(t in q for t in ("value", "valuation", "worth", "price")):
        return "Finding valuation information"
    if any(t in q for t in ("summar", "overview", "main")):
        return "Finding document summary"
    if any(t in q for t in ("lease", "rent", "term")):
        return "Finding lease details"
    return "Searching for documents"


def _summarize_tool_result_for_context(tool_name: str, result: Any) -> str:
    """
    Create a short summary of tool result for the model's next call.
    Full result is stored in execution_results for the responder.
    """
    if tool_name == RETRIEVE_DOCS:
        if not isinstance(result, list):
            return json.dumps({"document_ids": [], "count": 0, "message": "No documents found"})
        doc_ids = [d.get("document_id") for d in result if isinstance(d, dict) and d.get("document_id")]
        filenames = [d.get("filename", d.get("original_filename", "")) for d in result if isinstance(d, dict)]
        return json.dumps({
            "document_ids": doc_ids,
            "count": len(doc_ids),
            "filenames": filenames[:10],
            "message": f"Found {len(doc_ids)} documents. Use these document_ids for retrieve_chunks.",
        })
    elif tool_name == RETRIEVE_CHUNKS:
        count = len(result) if isinstance(result, list) else 0
        return json.dumps({
            "count": count,
            "message": f"Found {count} relevant text sections. The system will now generate the answer with citations.",
        })
    return json.dumps({"message": "Tool executed"})


def _inject_state_context(args: Dict[str, Any], state: MainWorkflowState, tool_name: str) -> Dict[str, Any]:
    """Inject business_id, property_id, document_ids from state into tool args."""
    injected = dict(args)
    business_id = state.get("business_id")
    property_id = state.get("property_id")
    document_ids = state.get("document_ids")
    
    if business_id:
        injected["business_id"] = business_id
    if tool_name == RETRIEVE_CHUNKS:
        existing_doc_ids = injected.get("document_ids") or []
        if not existing_doc_ids and document_ids:
            injected["document_ids"] = [str(d) for d in document_ids] if isinstance(document_ids, list) else []
        elif not existing_doc_ids and property_id:
            try:
                resolved = get_document_ids_for_property(property_id, business_id or "")
                if resolved:
                    injected["document_ids"] = resolved
                    logger.info("[AGENT_LOOP] Injected document_ids from property_id: %d docs", len(resolved))
            except Exception as e:
                logger.warning("[AGENT_LOOP] Failed to resolve property_id to document_ids: %s", e)
    return injected


def _execute_tool(tool_name: str, args: Dict[str, Any], state: MainWorkflowState) -> Any:
    """Execute retrieve_docs or retrieve_chunks. Returns result in executor-compatible shape."""
    from backend.llm.tools.document_retriever_tool import retrieve_documents
    from backend.llm.tools.chunk_retriever_tool import retrieve_chunks
    
    args = _inject_state_context(args, state, tool_name)
    business_id = args.get("business_id") or state.get("business_id")
    user_query = state.get("user_query") or ""
    
    if tool_name == RETRIEVE_DOCS:
        query = (args.get("query") or user_query or "").strip()
        if not query:
            logger.warning("[AGENT_LOOP] retrieve_docs called with empty query")
            return []
        document_ids = args.get("document_ids")
        if isinstance(document_ids, list) and len(document_ids) == 0:
            document_ids = None
        result = retrieve_documents(
            query=query,
            business_id=business_id,
            property_id=state.get("property_id"),
            document_ids=document_ids,
            user_query_for_entity=user_query or None,
        )
        return result
    
    elif tool_name == RETRIEVE_CHUNKS:
        query = (args.get("query") or user_query or "").strip()
        document_ids = args.get("document_ids") or []
        if isinstance(document_ids, list):
            document_ids = [str(d) for d in document_ids if d]
        else:
            document_ids = []
        if not document_ids:
            logger.warning("[AGENT_LOOP] retrieve_chunks called with no document_ids")
            return []
        if not query:
            query = user_query or "relevant content"
        result = retrieve_chunks(
            query=query,
            document_ids=document_ids,
            business_id=business_id,
        )
        return result
    
    logger.warning("[AGENT_LOOP] Unknown tool: %s", tool_name)
    return []


def _build_messages_for_llm(state: MainWorkflowState) -> List:
    """Build messages array for the LLM: system + conversation history + current user query."""
    system_content = _get_agent_loop_system_prompt()
    messages = [SystemMessage(content=system_content)]
    
    # Add workspace context if document_ids or property_id in scope
    document_ids = state.get("document_ids") or []
    property_id = state.get("property_id")
    if document_ids or property_id:
        workspace_parts = []
        if document_ids:
            doc_list = "\n".join(f"  - {d}" for d in document_ids[:20])
            workspace_parts.append(f"Documents in scope (document_ids):\n{doc_list}")
        if property_id:
            workspace_parts.append(f"Property selected: {property_id}")
        if workspace_parts:
            messages.append(SystemMessage(content="Context:\n" + "\n".join(workspace_parts)))
    
    # Add conversation history
    conv_messages = state.get("messages") or []
    for msg in conv_messages:
        if hasattr(msg, "content") and msg.content:
            messages.append(msg)
    
    # Ensure current user query is last
    user_query = (state.get("user_query") or "").strip()
    if user_query and (
        not messages
        or not (
            hasattr(messages[-1], "content")
            and isinstance(getattr(messages[-1], "content", None), str)
            and user_query in (getattr(messages[-1], "content", "") or "")
        )
    ):
        messages.append(HumanMessage(content=user_query))
    
    return messages


@log_node_perf("agent_loop")
async def agent_loop_node(state: MainWorkflowState, runnable_config=None) -> MainWorkflowState:
    """
    LobeHub-style agent loop. Model decides tool use via tool_calls.
    Accumulates execution_results for the responder's citation pipeline.
    """
    messages = _build_messages_for_llm(state)
    tools = _build_tool_definitions()
    execution_results: List[Dict[str, Any]] = []
    emitter = state.get("execution_events")
    
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )
    
    # Bind tools for OpenAI function calling
    llm_with_tools = llm.bind_tools(tools)
    
    for iteration in range(MAX_ITERATIONS):
        if emitter and iteration == 0:
            emitter.emit_reasoning(label="Planning next moves", detail=None)
        
        try:
            response = await llm_with_tools.ainvoke(messages)
        except Exception as e:
            logger.error("[AGENT_LOOP] LLM invocation failed: %s", e, exc_info=True)
            return {
                "execution_results": execution_results,
                "messages": messages,
            }
        
        if not isinstance(response, AIMessage):
            logger.warning("[AGENT_LOOP] Unexpected response type: %s", type(response))
            break
        
        messages.append(response)
        
        tool_calls = getattr(response, "tool_calls", None) or []
        if not tool_calls:
            logger.info("[AGENT_LOOP] No tool calls - finishing (iteration %d)", iteration + 1)
            break
        
        for tc in tool_calls:
            tool_name = tc.get("name") or tc.get("function", {}).get("name", "")
            tool_args_raw = tc.get("args") or tc.get("function", {}).get("arguments", "{}")
            if isinstance(tool_args_raw, str):
                try:
                    tool_args = json.loads(tool_args_raw)
                except json.JSONDecodeError:
                    tool_args = {}
            else:
                tool_args = tool_args_raw or {}
            
            tool_call_id = tc.get("id", f"call_{iteration}_{tool_name}")
            
            if emitter:
                query = tool_args.get("query", "")
                emitter.emit_reasoning(
                    label=_choose_search_intro(query),
                    detail=None,
                )
            
            result = _execute_tool(tool_name, tool_args, state)
            
            summary = _summarize_tool_result_for_context(tool_name, result)
            messages.append(
                ToolMessage(
                    content=summary,
                    tool_call_id=tool_call_id,
                )
            )
            
            execution_results.append({
                "step_id": f"tool_{iteration}_{tool_name}",
                "action": "retrieve_docs" if tool_name == RETRIEVE_DOCS else "retrieve_chunks",
                "query": tool_args.get("query", ""),
                "result": result,
                "success": bool(result) if isinstance(result, list) else result is not None,
            })
            
            if emitter and isinstance(result, list):
                if tool_name == RETRIEVE_DOCS:
                    emitter.emit_reasoning(
                        label=f"Analysing {len(result)} document{'s' if len(result) != 1 else ''}",
                        detail=None,
                    )
                elif tool_name == RETRIEVE_CHUNKS:
                    doc_ids = tool_args.get("document_ids") or []
                    emitter.emit_reasoning(
                        label=f"Found {len(result)} relevant section{'s' if len(result) != 1 else ''}",
                        detail=f"From {len(doc_ids)} document{'s' if len(doc_ids) != 1 else ''}" if doc_ids else None,
                    )
    
    logger.info("[AGENT_LOOP] Finished after %d iterations, %d execution results", iteration + 1, len(execution_results))
    
    return {
        "execution_results": execution_results,
        "messages": messages,
    }

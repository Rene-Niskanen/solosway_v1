"""
Agent Loop Node - LobeHub-style single agent loop.

The model sees the full conversation + tool definitions and decides:
- call tools (retrieve_docs, retrieve_chunks) -> execute and loop
- finish (no tool calls) -> hand off to responder with execution_results

No separate planner, executor, or intent classifier. Routing is identical to LobeHub.
"""

import json
import logging
from typing import Any, Dict, List, Optional, Tuple

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
FETCH_CHUNKS_BY_IDS = "fetch_chunks_by_ids"
ADD_RESEARCH_NOTE = "add_research_note"
WEB_SEARCH = "web_search"


def _get_agent_loop_system_prompt(web_search_enabled: bool = False) -> str:
    """System prompt instructing the model on when to use tools vs reply directly."""
    base = """You are an assistant with access to a document search system. Your job is to decide when to search documents and when to reply from context alone.

You have four tools:
1. retrieve_docs(query) - Search for relevant documents. Returns document IDs and filenames. Use this FIRST when the user asks about documents, property information, valuations, leases, etc.
2. retrieve_chunks(query, document_ids) - Get detailed text from specific documents. Use AFTER retrieve_docs. Pass the document_ids from the retrieve_docs result.
3. fetch_chunks_by_ids(chunk_ids) - Get full chunk text by exact chunk IDs (UUIDs). Use for FOLLOW-UP questions when prior_chunk_context lists chunk_ids from a previous answer. No semantic search - direct lookup. Use when the user asks for more detail, expansion, or clarification about specific content already cited.
4. add_research_note(content, chunk_id, cited_text) - Record a finding for a curated piece of writing. Use ONLY when the user asks for a curated piece (brief, report, summary from multiple findings). See "Research-then-write" below.

When to use tools:
- User asks about documents, property, valuations, leases, contracts, summaries, details, etc. -> Call retrieve_docs, then retrieve_chunks with the returned document_ids
- User attaches documents (document_ids will be in scope) -> Call retrieve_chunks directly with those document_ids
- Short follow-up like "more detail", "expand", "key dates?" -> Use fetch_chunks_by_ids with chunk_ids from prior_chunk_context (if provided), else retrieve_chunks with document_ids from the previous turn
- User asks to compare, find similar properties -> Call retrieve_docs with a broad query, then retrieve_chunks

When to finish (no tools):
- Obvious greeting with no info request: "hi", "thanks", "bye"
- You already have sufficient chunk results from prior tool calls and the user's question can be answered from them (the system will generate the answer separately)
- Question about yourself/capabilities with no document context

If the user's message is ambiguous, prefer using tools (search) over finishing. Better to search and find nothing than miss relevant documents.

After calling retrieve_chunks and receiving results, you may finish - the system will generate the final answer with citations from those chunks.

---
RESEARCH-THEN-WRITE (curated piece)
---
When the user asks for a **curated piece of writing** from multiple pieces of information (e.g. "write a one-page brief on X", "summarise the key findings into a report", "draft a summary that pulls together the valuations", "create a curated summary"), do this:
1. Call retrieve_docs then retrieve_chunks to find relevant content.
2. After each retrieve_chunks that yields useful content, call add_research_note for each distinct finding: content = a short summary of the finding, chunk_id = the exact chunk_id from that chunk in the retrieve_chunks result, cited_text = a **verbatim** excerpt from that chunk's chunk_text (the exact phrase or sentence that supports the note).
3. If you need more information, call retrieve_chunks again (or retrieve_docs first if needed), then add_research_note for any new findings.
4. When you have enough notes to write the piece, stop calling tools (finish). The system will generate the curated piece from your notes with working citations.

CITATION FORMATTING (mandatory for add_research_note):
- chunk_id: Use the exact **chunk_id** from the retrieve_chunks result for the chunk you are noting (the UUID string).
- cited_text: Use an **exact** substring from that chunk's **chunk_text** — the exact words that support the note. Do NOT paraphrase. Do NOT reword. If the chunk says "Market Value: £1,950,000", then cited_text must be exactly that (or a contiguous substring of it), not "market value of 1.95M". The system uses cited_text to attach the correct source and highlight in the document. If you paraphrase, the citation will not match and the reader will not see the correct highlight."""

    if web_search_enabled:
        base += """

---
WEB SEARCH (enabled)
---
You also have a web_search(query) tool. Use it to find real-time information from the internet.

When to use web_search:
- The user's question requires current/external knowledge not found in uploaded documents (e.g. market trends, news, regulations, comparable data from external sources)
- After searching documents and finding insufficient information, supplement with web results
- The user explicitly asks about something external to their documents

Strategy:
- If the question could be answered by uploaded documents, try retrieve_docs/retrieve_chunks FIRST
- Use web_search to supplement or when documents don't have the answer
- You may call both document tools and web_search in the same turn if the question benefits from both internal and external information
- After web_search returns results, you may finish — the system will generate the final answer citing both document and web sources"""

    return base


def _build_tool_definitions(web_search_enabled: bool = False) -> List[Dict[str, Any]]:
    """OpenAI function-calling format for retrieve_docs, retrieve_chunks, and optionally web_search."""
    tools = [
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
        {
            "type": "function",
            "function": {
                "name": FETCH_CHUNKS_BY_IDS,
                "description": "Get full chunk text by exact chunk IDs (UUIDs). Use for follow-up questions when prior_chunk_context lists chunk_ids. No semantic search - direct lookup.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chunk_ids": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "List of chunk UUIDs from prior answer (prior_chunk_context or retrieve_chunks result)",
                        },
                    },
                    "required": ["chunk_ids"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": ADD_RESEARCH_NOTE,
                "description": "Record a finding for a curated piece of writing. Use after retrieve_chunks when the user asked for a brief, report, or summary from multiple findings. Required for citations: pass chunk_id and cited_text exactly as in the retrieve_chunks result.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "content": {
                            "type": "string",
                            "description": "Short summary of the finding (one or two sentences)",
                        },
                        "chunk_id": {
                            "type": "string",
                            "description": "Exact chunk_id (UUID) from the retrieve_chunks result for the chunk this note comes from",
                        },
                        "cited_text": {
                            "type": "string",
                            "description": "Exact verbatim excerpt from that chunk's chunk_text — do not paraphrase; use the exact words so the system can attach the correct citation and highlight",
                        },
                    },
                    "required": ["content", "chunk_id", "cited_text"],
                },
            },
        },
    ]

    if web_search_enabled:
        tools.append({
            "type": "function",
            "function": {
                "name": WEB_SEARCH,
                "description": "Search the web for real-time information using Exa. Use when the user's question requires current or external knowledge not found in uploaded documents, or to supplement document findings with broader context.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query — be specific and include relevant keywords for best results",
                        },
                    },
                    "required": ["query"],
                },
            },
        })

    return tools


def _get_chunk_doc_and_page(chunk_id: str, execution_results: List[Dict[str, Any]]) -> Tuple[Optional[str], Optional[int]]:
    """Get document filename and page number for a chunk_id from the most recent retrieve_chunks result. Returns (filename, page_number) or (None, None)."""
    for item in reversed(execution_results):
        if item.get("action") != "retrieve_chunks" or not item.get("success"):
            continue
        result = item.get("result") or []
        if not isinstance(result, list):
            continue
        for chunk in result:
            if isinstance(chunk, dict) and (chunk.get("chunk_id") or chunk.get("id")) == chunk_id:
                filename = chunk.get("document_filename") or chunk.get("original_filename") or chunk.get("filename")
                page = chunk.get("page_number")
                if page is not None:
                    try:
                        page = int(page)
                    except (TypeError, ValueError):
                        page = None
                return (filename or None, page)
    return (None, None)


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
    elif tool_name in (RETRIEVE_CHUNKS, FETCH_CHUNKS_BY_IDS):
        count = len(result) if isinstance(result, list) else 0
        return json.dumps({
            "count": count,
            "message": f"Found {count} relevant text sections. The system will now generate the answer with citations.",
        })
    elif tool_name == ADD_RESEARCH_NOTE:
        return json.dumps({"message": "Research note recorded. Add more notes or finish to generate the curated piece."})
    elif tool_name == WEB_SEARCH:
        if not isinstance(result, list) or len(result) == 0:
            return json.dumps({"count": 0, "message": "No web results found."})
        summaries = []
        for i, r in enumerate(result[:5]):
            entry = f"[{i+1}] {r.get('title', 'Untitled')} — {r.get('url', '')}"
            s = r.get("summary", "")
            if s:
                entry += f"\nSummary: {s}"
            highlights = r.get("highlights") or []
            if highlights:
                entry += f"\nHighlight: {highlights[0][:300]}"
            summaries.append(entry)
        return json.dumps({
            "count": len(result),
            "message": f"Found {len(result)} web results. The system will cite these as web sources.",
            "results": "\n\n".join(summaries),
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

    elif tool_name == FETCH_CHUNKS_BY_IDS:
        from backend.llm.citation.document_store import fetch_chunks_by_ids as fetch_by_ids
        chunk_ids = args.get("chunk_ids") or []
        if isinstance(chunk_ids, list):
            chunk_ids = [str(c) for c in chunk_ids if c]
        else:
            chunk_ids = []
        if not chunk_ids:
            logger.warning("[AGENT_LOOP] fetch_chunks_by_ids called with no chunk_ids")
            return []
        result = fetch_by_ids(chunk_ids=chunk_ids, business_id=business_id)
        return result

    elif tool_name == ADD_RESEARCH_NOTE:
        # No external call; handled in the loop by appending to research_notes
        return None

    elif tool_name == WEB_SEARCH:
        from backend.llm.tools.web_search_tool import exa_web_search
        query = (args.get("query") or user_query or "").strip()
        if not query:
            logger.warning("[AGENT_LOOP] web_search called with empty query")
            return []
        return exa_web_search(query=query, num_results=5)

    logger.warning("[AGENT_LOOP] Unknown tool: %s", tool_name)
    return []


def _build_messages_for_llm(state: MainWorkflowState) -> List:
    """Build messages array for the LLM: system + conversation history + current user query."""
    web_search_enabled = state.get("web_search_enabled", False)
    system_content = _get_agent_loop_system_prompt(web_search_enabled=web_search_enabled)
    messages = [SystemMessage(content=system_content)]
    
    # Add prior chunk context for follow-ups (chunk_ids the agent can fetch with fetch_chunks_by_ids)
    prior_chunk_context = (state.get("prior_chunk_context") or "").strip()
    if prior_chunk_context:
        ctx_msg = prior_chunk_context + "\n\nUse fetch_chunks_by_ids with these chunk_ids to re-read that content for follow-up questions."
        messages.append(SystemMessage(content=ctx_msg))
    
    # When user selected Web search: treat as general web query only (no document/property context).
    # Answer from the internet via Exa—e.g. "what is the size of new york", facts, etc.
    document_ids = state.get("document_ids") or []
    property_id = state.get("property_id")
    if web_search_enabled:
        messages.append(SystemMessage(
            content="The user has selected Web search. Answer using ONLY the web_search(query) tool. "
            "Do not use retrieve_docs or retrieve_chunks. Do not finish without calling web_search."
        ))
    elif document_ids or property_id:
        # Document/property scope only when Web search is NOT selected
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
    web_search_enabled = state.get("web_search_enabled", False)
    tools = _build_tool_definitions(web_search_enabled=web_search_enabled)
    execution_results: List[Dict[str, Any]] = []
    research_notes: List[Dict[str, Any]] = []  # Fresh per turn for research-then-write
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
                "research_notes": research_notes,
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
            
            if tool_name == ADD_RESEARCH_NOTE:
                content = (tool_args.get("content") or "").strip()
                chunk_id = (tool_args.get("chunk_id") or "").strip()
                cited_text = (tool_args.get("cited_text") or "").strip()
                if not chunk_id or not cited_text:
                    summary = "Error: chunk_id and cited_text are required. Use the exact chunk_id and a verbatim excerpt from chunk_text from the retrieve_chunks result so citations work."
                else:
                    research_notes.append({
                        "content": content or "(no content)",
                        "chunk_id": chunk_id,
                        "cited_text": cited_text,
                    })
                    summary = _summarize_tool_result_for_context(ADD_RESEARCH_NOTE, None)
                    if emitter:
                        # Cursor-style sequence: Reading (page, doc) -> Read -> Thinking -> Note summary (faint)
                        filename, page = _get_chunk_doc_and_page(chunk_id, execution_results)
                        if filename or page is not None:
                            reading_detail = "Page %s, %s" % (page if page is not None else "?", filename or "document")
                            emitter.emit_reasoning(label="Reading", detail=reading_detail)
                        emitter.emit_reasoning(label="Read", detail=None)
                        emitter.emit_reasoning(label="Thinking", detail=None)
                        note_preview = (content or "(no content)").strip()[:80]
                        if len((content or "").strip()) > 80:
                            note_preview += "..."
                        emitter.emit_reasoning(
                            label="Making a note for the curated piece",
                            detail=note_preview if note_preview else None,
                        )
                messages.append(ToolMessage(content=summary, tool_call_id=tool_call_id))
                continue
            
            if emitter:
                if tool_name == WEB_SEARCH:
                    emitter.emit_reasoning(label="Searching the web...", detail=None)
                elif tool_name == FETCH_CHUNKS_BY_IDS:
                    emitter.emit_reasoning(label="Fetching cited chunks", detail=None)
                else:
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
            
            action_label = tool_name
            if tool_name == RETRIEVE_DOCS:
                action_label = "retrieve_docs"
            elif tool_name in (RETRIEVE_CHUNKS, FETCH_CHUNKS_BY_IDS):
                action_label = "retrieve_chunks"
            elif tool_name == WEB_SEARCH:
                action_label = "web_search"

            execution_results.append({
                "step_id": f"tool_{iteration}_{tool_name}",
                "action": action_label,
                "query": tool_args.get("query", ""),
                "result": result,
                "success": bool(result) if isinstance(result, list) else result is not None,
            })
            
            if emitter and isinstance(result, list):
                if tool_name == WEB_SEARCH:
                    n = len(result)
                    emitter.emit_reasoning(
                        label=f"Found {n} web result{'s' if n != 1 else ''}",
                        detail=None,
                    )
                elif tool_name == RETRIEVE_DOCS:
                    emitter.emit_reasoning(label="Analysing documents...", detail=None)
                elif tool_name in (RETRIEVE_CHUNKS, FETCH_CHUNKS_BY_IDS):
                    unique_doc_ids = set()
                    for item in result:
                        if isinstance(item, dict):
                            did = item.get("document_id") or item.get("doc_id")
                            if did is not None:
                                unique_doc_ids.add(str(did))
                    n_docs_used = len(unique_doc_ids)
                    doc_word = "document" if n_docs_used == 1 else "documents"
                    emitter.emit_reasoning(
                        label=f"Analysing {n_docs_used} {doc_word}",
                        detail=None,
                    )
                    emitter.emit_reasoning(
                        label=f"Retrieved {len(result)} passage{'s' if len(result) != 1 else ''} from {n_docs_used} {doc_word}",
                        detail=None,
                    )
    
    logger.info("[AGENT_LOOP] Finished after %d iterations, %d execution results, %d research notes", iteration + 1, len(execution_results), len(research_notes))
    
    return {
        "execution_results": execution_results,
        "messages": messages,
        "research_notes": research_notes,
    }

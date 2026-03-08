"""
Focused Task Graph - Lightweight LangGraph for agent task orchestration.

A stripped-down 2-node pipeline (retrieve_and_rerank -> responder) designed for
parallel, document-scoped Q&A tasks dispatched from the frontend orchestration layer.

Skips routing, context management, agent loops, and conversation handling.
"""

import logging
import json
from typing import TypedDict, Optional, Any, List, Dict
from datetime import datetime

from langgraph.graph import StateGraph, START, END
from backend.llm.prompts.output_formatting import OUTPUT_FORMATTING_RULES

logger = logging.getLogger(__name__)


def _fetch_citation_page_chunks(
    document_id: str,
    page_number: int,
    business_id: str,
    block_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Fetch chunks from document_vectors for the given document and page.
    Returns chunks in the same shape as retrieve_chunks (chunk_text, document_id, page_number, bbox, etc.)
    so focused_responder_node can consume them. If block_id is provided, the chunk containing it is
    returned first.
    """
    from backend.services.supabase_client_factory import get_supabase_client

    supabase = get_supabase_client()
    out: List[Dict[str, Any]] = []
    try:
        result = (
            supabase.table("document_vectors")
            .select("id, chunk_text, chunk_index, page_number, bbox, blocks")
            .eq("document_id", document_id)
            .eq("page_number", page_number)
            .order("chunk_index", desc=False)
            .limit(50)
            .execute()
        )
    except Exception as e:
        logger.warning("[FOCUSED_TASK] Citation page fetch failed: %s", e)
        return []

    rows = result.data if result.data else []
    doc_result = supabase.table("documents").select("original_filename, classification_type").eq("id", document_id).eq("business_uuid", business_id).limit(1).execute()
    doc_row = doc_result.data[0] if doc_result.data else {}
    doc_filename = doc_row.get("original_filename", "document")
    doc_type = doc_row.get("classification_type", "unknown")

    for chunk in rows:
        chunk_id = str(chunk.get("id", ""))
        if not chunk_id:
            chunk_id = f"{document_id}_{chunk.get('chunk_index', 0)}"
        chunk_text = chunk.get("chunk_text") or ""
        bbox = chunk.get("bbox")
        if isinstance(bbox, str):
            try:
                bbox = json.loads(bbox) if bbox else {}
            except Exception:
                bbox = {}
        blocks = chunk.get("blocks") or []
        contains_citation = False
        if block_id and blocks:
            block_ids_in_chunk = [b.get("id", "") for b in blocks if isinstance(b, dict)]
            contains_citation = block_id in block_ids_in_chunk

        out.append({
            "chunk_id": chunk_id,
            "document_id": document_id,
            "document_filename": doc_filename,
            "document_type": doc_type,
            "chunk_index": chunk.get("chunk_index", 0),
            "chunk_text": chunk_text,
            "chunk_text_clean": chunk_text,
            "page_number": chunk.get("page_number", page_number),
            "bbox": bbox if isinstance(bbox, dict) else {},
            "blocks": blocks,
            "block_id": block_id if contains_citation else (blocks[0].get("id") if blocks and isinstance(blocks[0], dict) else None),
            "section_title": None,
            "score": 1.0 if contains_citation else 0.9,
            "metadata": {},
            "_contains_citation": contains_citation,
        })

    if block_id and len(out) > 1:
        cited = next((c for c in out if c.get("_contains_citation")), None)
        if cited:
            out = [cited] + [c for c in out if c.get("chunk_id") != cited.get("chunk_id")]
    elif out:
        out[0]["_contains_citation"] = True

    for c in out:
        c.pop("_contains_citation", None)
    return out


class FocusedTaskState(TypedDict, total=False):
    user_query: str
    document_ids: list[str]
    business_id: str
    user_id: str
    session_id: str
    execution_events: Any  # ExecutionEventEmitter
    execution_results: List[Dict[str, Any]]
    final_summary: str
    citations: list
    conversation_history: list
    property_id: Optional[str]
    citation_context: Optional[Dict[str, Any]]


async def retrieve_and_rerank_node(state: FocusedTaskState) -> FocusedTaskState:
    """
    Retrieve chunks from the scoped document_ids and rerank them.
    When citation_context is present, fetches the cited page/block first and puts that chunk first
    so citation [1] in the response maps to the citation the user hovered (same as main chat).
    """
    from backend.llm.tools.chunk_retriever_tool import retrieve_chunks
    from backend.llm.utils.retrieval_rerank import apply_value_seeking_rerank
    from backend.llm.utils.execution_events import ExecutionEventEmitter

    user_query = state.get("user_query", "")
    document_ids = state.get("document_ids", [])
    business_id = state.get("business_id", "")
    citation_context = state.get("citation_context")
    emitter: Optional[ExecutionEventEmitter] = state.get("execution_events")

    if emitter:
        emitter.emit_reasoning(
            f"Searching {len(document_ids)} document{'s' if len(document_ids) != 1 else ''}",
            detail=user_query[:80],
        )

    if not document_ids:
        logger.warning("[FOCUSED_TASK] No document_ids provided")
        return {
            "execution_results": [],
            "final_summary": "No documents were specified to search.",
            "citations": [],
        }

    citation_chunks: List[Dict[str, Any]] = []
    if citation_context and isinstance(citation_context, dict):
        doc_id = citation_context.get("document_id") or citation_context.get("doc_id")
        page_number = citation_context.get("page_number", 0)
        block_id = citation_context.get("block_id") or ""
        if doc_id and page_number and str(doc_id) in [str(d) for d in document_ids]:
            citation_chunks = _fetch_citation_page_chunks(
                document_id=str(doc_id),
                page_number=int(page_number),
                business_id=business_id,
                block_id=block_id or None,
            )
            if citation_chunks:
                logger.info("[FOCUSED_TASK] Citation context: using %s chunk(s) from page %s first", len(citation_chunks), page_number)

    chunks = retrieve_chunks(
        query=user_query,
        document_ids=[str(d) for d in document_ids],
        business_id=business_id,
    )

    if citation_chunks:
        seen_ids = {c.get("chunk_id") for c in citation_chunks if c.get("chunk_id")}
        extra = [c for c in (chunks or []) if c.get("chunk_id") not in seen_ids]
        chunks = citation_chunks + extra[:14]
        seen_ids = {c.get("chunk_id") for c in chunks if c.get("chunk_id")}
        apply_value_seeking_rerank(user_query, chunks)
        cited_id = citation_chunks[0].get("chunk_id") if citation_chunks else None
        if cited_id and len(chunks) > 1:
            cited = next((c for c in chunks if c.get("chunk_id") == cited_id), None)
            if cited:
                chunks = [cited] + [c for c in chunks if c.get("chunk_id") != cited_id]
    else:
        if not chunks:
            logger.info("[FOCUSED_TASK] No chunks found for query: %s", user_query[:60])
            return {
                "execution_results": [],
                "final_summary": "I couldn't find relevant information in the specified documents for that question.",
                "citations": [],
            }
        apply_value_seeking_rerank(user_query, chunks)

    if emitter:
        emitter.emit_reasoning(
            f"Analysing {len(chunks)} sections from {len(document_ids)} document{'s' if len(document_ids) != 1 else ''}",
        )

    execution_result = {
        "action": "retrieve_chunks",
        "success": True,
        "result": chunks,
        "query": user_query,
        "document_ids": document_ids,
    }

    return {"execution_results": [execution_result]}


async def focused_responder_node(state: FocusedTaskState) -> FocusedTaskState:
    """
    Generate a cited answer from the retrieved chunks.
    Uses the same citation logic as normal responses: match_citation_to_chunk tool.
    LLM calls the tool with chunk_id and cited_text; we extract citations from tool calls.
    """
    import re

    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage, SystemMessage
    from langgraph.prebuilt import ToolNode
    from backend.llm.config import config
    from backend.llm.utils.execution_events import ExecutionEventEmitter
    from backend.llm.tools.citation_mapping import create_chunk_citation_tool
    from backend.llm.nodes.agent_node import extract_chunk_citations_from_messages

    emitter: Optional[ExecutionEventEmitter] = state.get("execution_events")
    user_query = state.get("user_query", "")
    execution_results = state.get("execution_results", [])

    all_chunks = []
    for er in execution_results:
        if er.get("action") == "retrieve_chunks" and er.get("success"):
            result = er.get("result") or []
            if isinstance(result, list):
                all_chunks.extend(result)

    if not all_chunks:
        return {
            "final_summary": "I couldn't find relevant information to answer that question.",
            "citations": [],
            "conversation_history": [{
                "query": user_query,
                "summary": "No relevant chunks found.",
                "timestamp": datetime.now().isoformat(),
                "query_category": "focused_task",
            }],
        }

    # Format chunks with [CHUNK_ID: xxx] so LLM can pass chunk_id to match_citation_to_chunk (same as normal responses)
    chunk_context_parts = []
    for chunk in all_chunks[:15]:
        chunk_id = str(chunk.get("chunk_id") or chunk.get("id") or "")
        text = (chunk.get("chunk_text") or chunk.get("chunk_text_clean") or "").strip()
        if not text or not chunk_id:
            continue
        filename = chunk.get("document_filename") or chunk.get("original_filename") or "document"
        page = chunk.get("page_number", "?")
        chunk_context_parts.append(
            f"[CHUNK_ID: {chunk_id}]\n({filename}, page {page})\n{text}"
        )
    chunk_context = "\n\n---\n\n".join(chunk_context_parts)

    system_prompt = (
        "You are a document analysis assistant. Answer the user's question based ONLY on the provided document chunks. "
        "**CITATION WORKFLOW (MANDATORY)**: For ANY information you use from chunks, you MUST call match_citation_to_chunk with:\n"
        "  - chunk_id: The CHUNK_ID from the [CHUNK_ID: ...] block you're citing\n"
        "  - cited_text: The EXACT text from that chunk (not a paraphrase)\n"
        "Call the tool for EVERY fact you cite. Then include citation numbers [1], [2], [3] in your answer, numbered by tool call order.\n"
        "Be concise and factual. If the answer is not in the provided chunks, say so.\n\n"
        + OUTPUT_FORMATTING_RULES
    )

    human_prompt = (
        f"Question: {user_query}\n\n"
        f"Document chunks:\n\n{chunk_context}\n\n"
        "Answer using the chunks above. For each fact you cite, call match_citation_to_chunk with chunk_id and cited_text, "
        "then include [1], [2], [3] in your answer."
    )

    citation_tool = create_chunk_citation_tool()
    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    ).bind_tools([citation_tool], tool_choice="auto")

    if emitter:
        emitter.emit_reasoning("Generating answer")

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=human_prompt),
    ]

    try:
        response = await llm.ainvoke(messages)
        messages.append(response)
        answer_parts = []
        if hasattr(response, "content") and response.content:
            answer_parts.append(response.content)

        # Handle tool calls (same as normal responder)
        while hasattr(response, "tool_calls") and response.tool_calls:
            tool_node = ToolNode([citation_tool])
            tool_result = await tool_node.ainvoke({"messages": messages})
            messages.extend(tool_result.get("messages", []))
            response = await llm.ainvoke(messages)
            messages.append(response)
            if hasattr(response, "content") and response.content:
                answer_parts.append(response.content)

        answer = "".join(answer_parts).strip() if answer_parts else ""

        # Extract citations from tool calls (identical to normal responses)
        raw_citations = extract_chunk_citations_from_messages(messages)

        # Convert to output format expected by frontend/views
        citations = []
        if raw_citations:
            for i, cit in enumerate(raw_citations, 1):
                chunk_id = cit.get("chunk_id") or ""
                block_idx = cit.get("block_index")
                block_id = f"chunk_{chunk_id}_block_{block_idx}" if block_idx is not None else chunk_id
                bbox = cit.get("bbox") or {}
                if isinstance(bbox, dict) and bbox and "page" not in bbox:
                    bbox = {**bbox, "page": cit.get("page_number", 0)}
                citations.append({
                    "citation_number": i,
                    "doc_id": cit.get("doc_id") or "",
                    "page_number": cit.get("page_number", 0),
                    "bbox": bbox,
                    "block_id": block_id,
                    "original_filename": cit.get("original_filename"),
                    "cited_text": cit.get("cited_text", ""),
                    "method": "focused-task",
                })
        else:
            # Fallback: LLM cited but didn't call tool - map [N] to chunk N by order of appearance
            appearance: List[int] = []
            seen: set[int] = set()
            for m in re.finditer(r"\[(\d+)\]", answer):
                n = int(m.group(1))
                idx = n - 1
                if 0 <= idx < len(all_chunks) and n not in seen:
                    appearance.append(n)
                    seen.add(n)
            old_to_new: Dict[int, int] = {old: i + 1 for i, old in enumerate(appearance)}
            for i, num in enumerate(appearance, 1):
                idx = num - 1
                ch = all_chunks[idx]
                doc_id = ch.get("document_id") or ch.get("doc_id") or ""
                page_num = ch.get("page_number", 0)
                bbox = ch.get("bbox") or {}
                if isinstance(bbox, str):
                    try:
                        bbox = json.loads(bbox) if bbox else {}
                    except Exception:
                        bbox = {}
                if isinstance(bbox, dict) and bbox and "page" not in bbox:
                    bbox = {**bbox, "page": page_num}
                chunk_id = str(ch.get("chunk_id") or ch.get("id") or "")
                citations.append({
                    "citation_number": i,
                    "doc_id": doc_id,
                    "page_number": page_num,
                    "bbox": bbox,
                    "block_id": chunk_id,
                    "original_filename": ch.get("document_filename") or ch.get("original_filename"),
                    "cited_text": (ch.get("chunk_text") or "")[:200],
                    "method": "focused-task-fallback",
                })

            def _repl(m: re.Match) -> str:
                return f"[{old_to_new.get(int(m.group(1)), m.group(1))}]"

            answer = re.sub(r"\[(\d+)\]", _repl, answer)

        # Normalize [Chunk N] → [N] in case LLM echoed old format
        answer = re.sub(r"\[Chunk\s+(\d+)\]", r"[\1]", answer, flags=re.IGNORECASE)

        # Stream the final answer so frontend still gets typing effect
        if emitter and answer:
            chunk_size = 8
            for i in range(0, len(answer), chunk_size):
                token = answer[i : i + chunk_size]
                if token:
                    emitter.emit_stream_token(token)

        return {
            "final_summary": answer,
            "citations": citations,
            "conversation_history": [{
                "query": user_query,
                "summary": answer,
                "timestamp": datetime.now().isoformat(),
                "document_ids": state.get("document_ids", []),
                "query_category": "focused_task",
            }],
        }
    except Exception as e:
        logger.error("[FOCUSED_TASK] LLM error: %s", e, exc_info=True)
        return {
            "final_summary": "I encountered an error generating the answer. Please try again.",
            "citations": [],
            "conversation_history": [{
                "query": user_query,
                "summary": f"Error: {str(e)}",
                "timestamp": datetime.now().isoformat(),
                "query_category": "focused_task",
            }],
        }


def build_focused_task_graph():
    """Build and compile the focused task graph (no checkpointer needed)."""
    builder = StateGraph(FocusedTaskState)

    builder.add_node("retrieve_and_rerank", retrieve_and_rerank_node)
    builder.add_node("responder", focused_responder_node)

    builder.add_edge(START, "retrieve_and_rerank")
    builder.add_edge("retrieve_and_rerank", "responder")
    builder.add_edge("responder", END)

    graph = builder.compile()
    logger.info("[FOCUSED_TASK] Graph compiled: START -> retrieve_and_rerank -> responder -> END")
    return graph

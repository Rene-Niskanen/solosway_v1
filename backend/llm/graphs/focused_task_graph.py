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
    Reuses the responder node's core logic but in a simplified form.
    """
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage, SystemMessage
    from backend.llm.config import config
    from backend.llm.utils.execution_events import ExecutionEventEmitter

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

    chunk_context_parts = []
    for i, chunk in enumerate(all_chunks[:15]):
        text = (chunk.get("chunk_text") or chunk.get("chunk_text_clean") or "").strip()
        if not text:
            continue
        doc_id = chunk.get("document_id") or chunk.get("doc_id") or ""
        page = chunk.get("page_number", "?")
        filename = chunk.get("document_filename") or chunk.get("original_filename") or "document"
        chunk_context_parts.append(
            f"[{i+1}] (doc: {filename}, page {page}, doc_id: {doc_id})\n{text}"
        )

    chunk_context = "\n\n---\n\n".join(chunk_context_parts)

    system_prompt = (
        "You are a document analysis assistant. Answer the user's question based ONLY on the provided document chunks. "
        "Cite your sources using [N] notation where N corresponds to the chunk number. "
        "Be concise and factual. If the answer is not in the provided chunks, say so.\n\n"
        "Formatting: Use **bold** markdown for key facts and figures such as: names (people, companies, organisations), "
        "dates, monetary amounts, percentages, addresses, property identifiers, qualifications (e.g. MRICS, RICS), "
        "standards or definitions (e.g. Red Book), and other important values. This helps readers quickly scan for "
        "the most important information. Do not add colons after qualifications (MRICS, FRICS) or company names (Ltd) "
        "in running text—e.g. write 'Sukhbir Tiwana MRICS and Graham Finegold MRICS at MJ Group International Ltd' "
        "not 'Sukhbir Tiwana MRICS: and Graham Finegold MRICS: at MJ Group International Ltd:'."
    )

    human_prompt = (
        f"Question: {user_query}\n\n"
        f"Document chunks:\n\n{chunk_context}\n\n"
        "Answer the question using the document chunks above. Use [N] citations."
    )

    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
        streaming=True,
    )

    if emitter:
        emitter.emit_reasoning("Generating answer")

    try:
        answer = ""
        async for chunk in llm.astream([
            SystemMessage(content=system_prompt),
            HumanMessage(content=human_prompt),
        ]):
            token = chunk.content if hasattr(chunk, "content") else str(chunk)
            if token:
                answer += token
                if emitter:
                    emitter.emit_stream_token(token)
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

    citations = []
    import re

    # Normalize [Chunk N] → [N] in case the LLM echoed the old chunk label format
    answer = re.sub(r'\[Chunk\s+(\d+)\]', r'[\1]', answer, flags=re.IGNORECASE)

    citation_nums = set(re.findall(r'\[(\d+)\]', answer))
    for num_str in citation_nums:
        idx = int(num_str) - 1
        if 0 <= idx < len(all_chunks):
            chunk = all_chunks[idx]
            doc_id = chunk.get("document_id") or chunk.get("doc_id") or ""
            page_number = chunk.get("page_number", 0)
            bbox = chunk.get("bbox") or {}
            if isinstance(bbox, str):
                try:
                    bbox = json.loads(bbox)
                except Exception:
                    bbox = {}

            # Ensure bbox has page field for frontend document preview
            if isinstance(bbox, dict) and bbox and "page" not in bbox and page_number:
                bbox = {**bbox, "page": page_number}

            citations.append({
                "citation_number": int(num_str),
                "doc_id": doc_id,
                "page_number": page_number,
                "cited_text": (chunk.get("chunk_text") or "")[:200],
                "original_filename": chunk.get("document_filename") or chunk.get("original_filename"),
                "bbox": bbox,
                "block_id": chunk.get("block_id") or chunk.get("chunk_id") or f"focused_{doc_id[:8]}_{num_str}",
                "method": "focused-task",
            })

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

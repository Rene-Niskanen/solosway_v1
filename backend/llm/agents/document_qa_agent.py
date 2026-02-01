"""Document QA subgraph – per-document question answering."""

import logging

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage
from langgraph.graph import START, END, StateGraph

from backend.llm.config import config
from backend.llm.types import DocumentQAState
from backend.llm.utils.system_prompts import get_system_prompt
from backend.llm.prompts import get_document_qa_human_content

logger = logging.getLogger(__name__)


async def answer_question(state: DocumentQAState) -> DocumentQAState:
    """Answer the user query using only the supplied document content.
      Input:
    {
        "doc_id": "doc_123",
        "property_id": "prop_abc",
        "doc_content": "Full document text...",
        "user_query": "What properties have foundation damage?",
        "answer": ""
    }
    
    Process:
    1. Create LLM (gpt-4-turbo)
    2. Send prompt with:
       - The full document content
       - The user's question
       - Instructions to answer ONLY based on document
    3. LLM reads document and generates answer
    
    Output:
    {
        "doc_id": "doc_123",
        "property_id": "prop_abc",
        "doc_content": "...",
        "user_query": "...",
        "answer": "Foundation shows minor cracks in basement corners. 
                   No structural damage detected. Recommend monitoring."
    }
    
    Latency: ~1-2 seconds (LLM reasoning) - NOW PARALLEL!
    """

    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )

    # Get system prompt for analyze task
    system_msg = get_system_prompt('analyze')
    
    # Get human message content
    detail_level = state.get('detail_level', 'concise')
    citation_context = state.get('citation_context')
    logger.info(f"[DOCUMENT_QA] Detail level from state: {detail_level} (type: {type(detail_level).__name__})")
    if citation_context:
        logger.info(f"[DOCUMENT_QA] Citation context provided: doc={citation_context.get('document_id', 'unknown')}, page={citation_context.get('page_number', 'unknown')}")
    human_content = get_document_qa_human_content(
        user_query=state['user_query'],
        doc_content=state['doc_content'],
        detail_level=detail_level,
        citation_context=citation_context
    )
    
    try:
        # Use LangGraph message format - ASYNC for true parallelism!
        messages = [system_msg, HumanMessage(content=human_content)]
        response = await llm.ainvoke(messages)
        answer = response.content.strip()
        logger.info(
            "[DOCUMENT_QA] Generated answer for doc %s", state.get("doc_id", "")[:8]
        )
        return {
            **state,
            "answer": answer or "",  # Let LLM handle empty responses naturally
        }

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("[DOCUMENT_QA] Error generating answer: %s", exc, exc_info=True)
        # Return empty answer - let summarize_results handle error naturally
        return {**state, "answer": ""}


def build_document_qa_subgraph():
    """Compile the per-document QA subgraph."""

    builder = StateGraph(DocumentQAState)
    builder.add_node("answer_question", answer_question)
    builder.add_edge(START, "answer_question")
    builder.add_edge("answer_question", END)

    subgraph = builder.compile()
    logger.info("Document QA subgraph compiled")
    return subgraph





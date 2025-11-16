"""Document QA subgraph – per-document question answering."""

import logging

from langchain_openai import ChatOpenAI
from langgraph.graph import START, END, StateGraph

from backend.llm.config import config
from backend.llm.types import DocumentQAState

logger = logging.getLogger(__name__)


def answer_question(state: DocumentQAState) -> DocumentQAState:
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
    
    Latency: ~1-2 seconds (LLM reasoning)
    """

    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )

    # Create the prompt
    prompt = f"""You are a property document analyst. Read this document excerpt and extract any information relevant to the user's question.
    
    IMPORTANT RULES:
1. Extract and summarize ONLY information found in the document
2. If the document contains relevant information, provide comprehensive details including:
   - Specific values, prices, measurements, dates
   - Property features, specifications, condition details
   - Location information, connectivity, amenities
   - Professional assessments, ratings, or opinions
   - Any risks, opportunities, or notable findings
3. If this specific excerpt doesn't contain relevant information, say "No relevant information in this excerpt"
4. Be thorough but focused - include all relevant details, not just a brief summary
5. Do not speculate beyond what's written
    
DOCUMENT EXCERPT:
    _____________________________________________________________
    {state['doc_content']}
    _____________________________________________________________
    
USER QUESTION: {state['user_query']}
    
ANSWER (extract all relevant information or state if not found):"""

    try:
        response = llm.invoke(prompt)
        answer = response.content.strip()
        logger.info(
            "[DOCUMENT_QA] Generated answer for doc %s", state.get("doc_id", "")[:8]
        )
        return {
            **state,
            "answer": answer or "Not found in this document.",
        }

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("[DOCUMENT_QA] Error generating answer: %s", exc, exc_info=True)
        return {**state, "answer": f"Could not process document: {exc}"}


def build_document_qa_subgraph():
    """Compile the per-document QA subgraph."""

    builder = StateGraph(DocumentQAState)
    builder.add_node("answer_question", answer_question)
    builder.add_edge(START, "answer_question")
    builder.add_edge("answer_question", END)

    subgraph = builder.compile()
    logger.info("Document QA subgraph compiled")
    return subgraph





"""
Summarization code - create final unified answer from all document outputs.
"""

import logging

from langchain_openai import ChatOpenAI

from backend.llm.config import config
from backend.llm.types import MainWorkflowState

logger = logging.getLogger(__name__)


def summarize_results(state: MainWorkflowState) -> MainWorkflowState:
    """
    Create a final unified answer from all document outputs.

    This node reads all the individual document answers and creates one coherant response that:
    1. Directly answers the users original question 
    2. Synthesizes findings accross documents
    3. Cites which documents support each claim
    4. Highlights key insights and differences

    Input:
    {
        "user_query": "What properties have foundation damage"
        "document_outputs": [
            {
                doc_id: "doc_1",
                output: "foundation shows minor cracks in basement corners",
            }
            {
                doc_id: "doc_2",
                output: "Significant foundation settling on east side detected."
            }
            {
                doc_id: "doc_3",
                output: "Foundation in excellent condition, no visible issues."
            }
        ]
    }

    Process:
    1. Create LLM with gpt-4-turbo
    2. Format all document outputs as readable text
    3. Send to LLM with prompt asking to synthesize
    4. LLM returns final unified answer

    Output:
    {
        "final_summary": "found 3 properties with varying foundation conditions:

        - Property A (doc_id): Minor cracks, monitor only
        - Property B (doc_id): Significant settling, needs evaluation 
        - Property C (doc_id): Excellent condition
        
        Recomended prioritizing Property B for further investigation."
    }

    Latency: ~1-2 seconds for LLM call
    """

    doc_outputs = state['document_outputs']

    if not doc_outputs:
        logger.warning("[SUMMARIZE_RESULTS] No document outputs to summarize")
        return {"final_summary": "No relevant documents matched the query."}

    if config.simple_mode:
        logger.info(
            "[SUMMARIZE_RESULTS] Simple mode enabled - returning lightweight summary"
        )
        lines = [
            f"[Simple mode] Retrieved {len(doc_outputs)} document(s) "
            f"for business query: \"{state['user_query']}\"."
        ]
        for output in doc_outputs[:5]:
            snippet = output.get('output', '') or ''
            lines.append(
                f"- Doc {output.get('doc_id', '')[:8]} "
                f"(property {output.get('property_id', '')[:8]}): "
                f"{snippet[:120]}{'...' if len(snippet) > 120 else ''}"
            )
        if len(doc_outputs) > 5:
            lines.append(f"...and {len(doc_outputs) - 5} more documents.")
        return {"final_summary": "\n".join(lines)}

    llm = ChatOpenAI(
        api_key=config.openai_api_key,
        model=config.openai_model,
        temperature=0,
    )

    # Format outputs with natural names (filename and address)
    formatted_outputs = []
    for idx, output in enumerate(doc_outputs):
        doc_type = output.get('classification_type', 'Property Document').replace('_', ' ').title()
        filename = output.get('original_filename', f"Document {output['doc_id'][:8]}")
        address = output.get('property_address', f"Property {output.get('property_id', 'Unknown')[:8]}")
        page_info = output.get('page_range', 'multiple pages')
        
        header = f"\n### {doc_type}: {filename}\n"
        header += f"Property: {address}\n"
        header += f"Pages: {page_info}\n"
        header += f"---------------------------------------------\n"
        
        formatted_outputs.append(header + output.get('output', ''))
    
    formatted_outputs_str = "\n".join(formatted_outputs)

    # Build conversation context if history exists
    history_context = ""
    if state.get('conversation_history'):
        recent_history = state['conversation_history'][-3:]  # Last 3 Q&A pairs
        history_lines = []
        for exchange in recent_history:
            history_lines.append(f"Previous Q: {exchange['query']}")
            history_lines.append(f"Previous A: {exchange['summary'][:300]}...\n")
        history_context = "CONVERSATION HISTORY:\n" + "\n".join(history_lines) + "\n\n"

    # Create the summarization prompt
    prompt = f"""You are an AI assistant for real estate and valuation professionals. You help them quickly understand what's inside their documents and how that information relates to their query.

CONTEXT

The user works in real estate (agent, valuer, acquisitions, asset manager, investor, or analyst).
They have uploaded {len(doc_outputs)} documents, which may include: valuation reports, leases, EPCs, offer letters, appraisals, inspections, legal documents, or correspondence.

The user has asked:

"{state['user_query']}"

{history_context}
Below is the extracted content from the pages you analyzed:

{formatted_outputs_str}

GUIDELINES FOR YOUR RESPONSE

Speak naturally, like an experienced colleague summarising the key points — not like you're writing an academic paper or following a rigid checklist.

Focus on what matters in real estate:
- Valuations, specifications, location, condition, risks, opportunities, deal terms, and comparable evidence.

When referencing a document, keep it light and natural:
→ "One of the valuation reports mentions…"
→ "In the lease document, there's a note that…"
→ "The Highlands_Berden_Bishops_Stortford report highlights…"
→ "Page 7 shows that…"

Only cite pages if the information is clearly page-specific. Otherwise keep it general.

Start with a clear, direct answer to the user's question.
Then add helpful context and details that support the answer.

If useful, point out inconsistencies across documents or missing information.

Feel free to offer insights or next steps the way a real estate professional would:
- "It might be worth checking…"
- "You may want to confirm whether…"
- "Based on the valuation assumptions, the property seems…"

Structure your response with a brief heading that directly addresses the query, followed by the details.

TONE

Professional, concise, helpful, human, and grounded in the documents — not robotic or over-structured.

Now provide your response:"""

    try:
        # Call the LLM
        response = llm.invoke(prompt)
        summary = response.content.strip()
        logger.info("[SUMMARIZE_RESULTS] Generated final summary")
        
        # Add current exchange to conversation history
        conversation_entry = {
            "query": state['user_query'],
            "summary": summary,
            "document_ids": [output['doc_id'] for output in doc_outputs[:10]]  # Track which docs were used
        }
        
        return {
            "final_summary": summary,
            "conversation_history": [conversation_entry]
        }
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("[SUMMARIZE_RESULTS] Error creating summary: %s", exc, exc_info=True)
        fallback = ["Summary based on retrieved documents:"]
        for output in doc_outputs:
            snippet = output["output"][:200].replace("\n", " ")
            fallback.append(f"- {snippet}...")
        return {"final_summary": "\n".join(fallback)}

        



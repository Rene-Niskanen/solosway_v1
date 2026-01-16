"""
General Query Handler Node: Handles general knowledge queries without document search.

Answers general knowledge questions like "What is the date today?" or "Explain quantum computing".
"""

import logging
from datetime import datetime
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

from backend.llm.config import config
from backend.llm.types import MainWorkflowState
from backend.llm.utils.system_prompts import get_system_prompt
from backend.llm.prompts import get_general_query_prompt

logger = logging.getLogger(__name__)


async def handle_general_query(state: MainWorkflowState) -> MainWorkflowState:
    """
    Handle general knowledge queries without document search.
    
    Examples:
    - "What is the date today?" → Get current date and format response
    - "Explain quantum computing" → General explanation
    - "What is the capital of France?" → Factual answer
    
    CRITICAL: Updates conversation_history like summarize_results does
    """
    user_query = state.get("user_query", "")
    conversation_history = state.get("conversation_history", [])
    
    if not user_query:
        logger.warning("[GENERAL_QUERY] No user_query found")
        return {
            "final_summary": "I don't have a question to answer. Please provide a question.",
            "conversation_history": [],
            "citations": []
        }
    
    # Get current date/time if query asks for it
    current_date = datetime.now().strftime("%d %B %Y")
    current_time = datetime.now().strftime("%H:%M")
    
    # Build conversation context (handle both formats like summarize_results)
    history_context = ""
    if conversation_history:
        recent_history = conversation_history[-3:]  # Last 3 exchanges
        history_lines = []
        for exchange in recent_history:
            # Handle both formats (same logic as summarize_results lines 1236-1256)
            if isinstance(exchange, dict):
                if 'query' in exchange and 'summary' in exchange:
                    history_lines.append(f"Previous Q: {exchange['query']}")
                    history_lines.append(f"Previous A: {exchange['summary'][:300]}...\n")
                elif 'role' in exchange and 'content' in exchange:
                    role = exchange['role']
                    content = exchange['content']
                    if role == 'user':
                        history_lines.append(f"Previous Q: {content}")
                    elif role == 'assistant':
                        history_lines.append(f"Previous A: {content[:300]}...\n")
        if history_lines:
            history_context = "CONVERSATION HISTORY:\n" + "\n".join(history_lines) + "\n\n"
    
    try:
        # Get system prompt and format with current date/time
        # We need to format the content before creating SystemMessage
        from backend.llm.utils.system_prompts import TASK_GUIDANCE
        from langchain_core.messages import SystemMessage
        
        task_guidance = TASK_GUIDANCE.get('general_query', '')
        # Replace placeholders in task guidance
        task_guidance = task_guidance.replace('{current_date}', current_date)
        task_guidance = task_guidance.replace('{current_time}', current_time)
        
        # Create a more general base role for general queries (less document-focused)
        # This allows the LLM to use its general knowledge, not just documents
        general_base_role = """You are Velora, an expert AI assistant that helps users with both general knowledge questions and property document analysis.

YOUR MISSION:
- Provide accurate, concise, and professional responses
- For general knowledge questions, use your training data to provide helpful answers
- For property document questions, use only the provided documents and platform-verified database entries
- Be helpful, clear, and direct

CORE PRINCIPLES:
1. **Accuracy & Helpfulness**
   Provide accurate, helpful answers based on your knowledge or the provided context.

2. **Clarity & Precision**
   Provide direct answers. Use simple, professional language.

3. **No Unsolicited Suggestions**
   - Answer the question directly and stop. Do NOT add:
     - "Next steps:" sections
     - "Let me know if you need anything else"
     - "Would you like me to..." suggestions
     - Follow-up questions unless the user explicitly asks for them
   - Be prompt and precise: answer what was asked, nothing more.

TONE & STYLE:
- Professional, neutral, and confident
- Clear and structured
- Concise: answer the question and stop
"""
        
        system_content = f"""{general_base_role}

---

{task_guidance}"""
        
        system_msg = SystemMessage(content=system_content)
        
        # Get human prompt
        human_prompt = get_general_query_prompt(
            user_query=user_query,
            conversation_history=history_context,
            current_date=current_date,
            current_time=current_time
        )
        
        # Call LLM (use correct config)
        llm = ChatOpenAI(
            api_key=config.openai_api_key,
            model=config.openai_model,
            temperature=0,
            streaming=False
        )
        
        response = await llm.ainvoke([system_msg, HumanMessage(content=human_prompt)])
        summary = response.content.strip()
        
        # Update conversation_history (same pattern as summarize_results line 1463-1474)
        conversation_entry = {
            "query": user_query,
            "summary": summary,
            "timestamp": datetime.now().isoformat(),
            "document_ids": []  # No documents for general queries
        }
        
        logger.info(f"[GENERAL_QUERY] Generated response ({len(summary)} chars)")
        
        return {
            "final_summary": summary,
            "conversation_history": [conversation_entry],  # operator.add will append
            "citations": []  # No citations for general queries
        }
        
    except Exception as exc:
        logger.error(f"[GENERAL_QUERY] Error handling general query: {exc}", exc_info=True)
        return {
            "final_summary": "I encountered an error while processing your query. Please try again.",
            "conversation_history": [],
            "citations": []
        }


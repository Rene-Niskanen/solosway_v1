"""
Context manager node prompts: conversation summarization when token limit is exceeded.

Callables:
- get_context_summary_prompt(messages_text) -> str
- get_context_summary_message_content(summary_text, old_message_count) -> str
"""


def get_context_summary_prompt(messages_text: str) -> str:
    """Build human prompt for summarizing old conversation messages."""
    return f"""Summarize this conversation history concisely and accurately.

<conversation_history>
{messages_text}
</conversation_history>

<instructions>
Focus on:
1. User's primary questions and goals
2. Key facts discovered (property details, valuations, addresses, dates, names)
3. Documents referenced and their content/relevance
4. Tool calls made and their results
5. Open questions or unresolved issues

Keep the summary under 300 words but capture ALL important context.
Be specific and factual - this summary will replace the old messages,
so include enough detail that the agent can continue the conversation naturally.
</instructions>

Respond ONLY with the summary. Do not include any preamble or commentary."""


def get_context_summary_message_content(summary_text: str, old_message_count: int) -> str:
    """Content for the SystemMessage that replaces summarized messages."""
    return (
        f"[CONVERSATION SUMMARY - Condensed from {old_message_count} earlier messages]\n\n"
        f"{summary_text}"
    )
